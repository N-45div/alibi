"""Stream AI Village tables from Hugging Face and keep only the slice we study.

turns and memories are ~2.5 GB gzipped each (far more unpacked), so rows are filtered while
streaming and no table is ever written to disk whole. Lines are pre-screened with a byte regex
on the row's date before any JSON parsing, which keeps the pass download-bound.

Usage:  python -m alibi.fetch local       # small tables already downloaded to DATA_DIR
        python -m alibi.fetch sessions    # needed before turns (turns -> session -> agent)
        python -m alibi.fetch turns | memories | events
"""
import gzip
import json
import re
import sys
import time
import zlib

import requests
from huggingface_hub import get_token, hf_hub_url

from .config import DATA_DIR, FETCH_FROM, FETCH_TO, REPO_ID
from .db import connect

# Any row stamped inside the fetch window (March 31 to April 29 2026) mentions one of these dates.
DATE_HINT = re.compile(rb'"created_at":\s*"2026-0(3-31|4-\d\d)')


def in_window(ts: str | None) -> bool:
    return bool(ts) and FETCH_FROM <= ts[:10] < FETCH_TO


def clip(s, head=3000, tail=1000):
    if s is None:
        return None
    s = s if isinstance(s, str) else json.dumps(s, ensure_ascii=False)
    return s if len(s) <= head + tail else f"{s[:head]}\n...[{len(s) - head - tail} chars clipped]...\n{s[-tail:]}"


def stream_rows(filename, stats):
    """Yield raw JSON lines of a gzipped JSONL file straight from the Hub."""
    url = hf_hub_url(REPO_ID, filename, repo_type="dataset")
    with requests.get(url, headers={"Authorization": f"Bearer {get_token()}"}, stream=True, timeout=120) as r:
        r.raise_for_status()
        d = zlib.decompressobj(16 + zlib.MAX_WBITS)
        buf = b""
        for chunk in r.iter_content(1 << 20):
            stats["mb"] += len(chunk) / 1e6
            data = d.decompress(chunk)
            while d.eof and d.unused_data:  # multi-member gzip: start the next member
                rest = d.unused_data
                d = zlib.decompressobj(16 + zlib.MAX_WBITS)
                data += d.decompress(rest)
            buf += data
            *lines, buf = buf.split(b"\n")
            yield from lines
        if buf.strip():
            yield buf


def walk(node):
    if isinstance(node, dict):
        yield node
        for v in node.values():
            yield from walk(v)
    elif isinstance(node, list):
        for v in node:
            yield from walk(v)


def unpack_model_output(msgs):
    """Split a provider-shaped model response into (tool calls, narration, thinking).

    Shapes vary: Anthropic content blocks, OpenAI Responses items, OpenAI chat completions,
    Gemini candidates/parts. We match on block shape rather than provider.
    """
    calls, said, thought = [], [], []
    for n in walk(msgs):
        t = n.get("type")
        if t == "tool_use":
            calls.append({"name": n.get("name"), "input": n.get("input")})
        elif t == "function_call":
            calls.append({"name": n.get("name"), "input": n.get("arguments")})
        elif t == "computer_call":
            calls.append({"name": "computer", "input": n.get("action") or n.get("actions")})
        elif "functionCall" in n and isinstance(n["functionCall"], dict):
            calls.append({"name": n["functionCall"].get("name"), "input": n["functionCall"].get("args")})
        elif "function" in n and isinstance(n["function"], dict) and "arguments" in n["function"]:
            calls.append({"name": n["function"].get("name"), "input": n["function"].get("arguments")})
        elif t == "thinking":
            thought.append(n.get("thinking") or "")
        elif t in ("text", "output_text") and isinstance(n.get("text"), str):
            said.append(n["text"])
        elif "text" in n and "thought" in n and isinstance(n["text"], str):  # Gemini part
            (thought if n.get("thought") else said).append(n["text"])
        elif t == "summary_text" and isinstance(n.get("text"), str):  # OpenAI reasoning summary
            thought.append(n["text"])
    return calls, "\n".join(said), "\n".join(thought)


def clip_call(call):
    """Clip a tool call's input without breaking it: long values become clipped strings."""
    inp = call.get("input")
    if isinstance(inp, dict):
        inp = {k: clip(v, 1500, 300) if isinstance(v, str) else v for k, v in inp.items()}
    elif isinstance(inp, str):
        inp = clip(inp, 1500, 300)
    return {"name": call.get("name"), "input": inp}


def turn_row(r, session_agent):
    calls, said, thought = unpack_model_output(r.get("agent_messages"))
    calls = [clip_call(c) for c in calls]
    return (r["id"], r["session_id"], session_agent.get(r["session_id"]), r["created_at"],
            json.dumps(r.get("agent_action"), ensure_ascii=False) if r.get("agent_action") else None,
            clip(r.get("output")), clip(r.get("error"), 1500, 500), clip(r.get("system"), 1000, 0),
            int(bool(r.get("screenshot_is_redacted"))), int(bool(r.get("has_redaction_been_overruled"))),
            json.dumps(calls, ensure_ascii=False) if calls else None,
            clip(said, 2000, 500), clip(thought, 1500, 0))


def event_row(r):
    data = dict(r.get("data") or {})
    data.pop("output", None)  # raw provider response: huge, and the agent's words, not evidence
    return (r["id"], r.get("event_index"), r["created_at"], data.get("actionType"),
            data.get("speakerId") or data.get("agentId"), data.get("messageId"),
            json.dumps(data, ensure_ascii=False))


TABLES = {
    "turns": ("computer_use_turns.jsonl.gz", "INSERT OR REPLACE INTO turns VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)"),
    "memories": ("agent_memories.jsonl.gz", "INSERT OR REPLACE INTO memories VALUES (?,?,?,?)"),
    "events": ("events.jsonl.gz", "INSERT OR REPLACE INTO events VALUES (?,?,?,?,?,?,?)"),
    "sessions": ("computer_use_sessions.jsonl.gz", "INSERT OR REPLACE INTO sessions VALUES (?,?,?,?)"),
}


def fetch_remote(table):
    filename, sql = TABLES[table]
    con = connect()
    session_agent = dict(con.execute("SELECT id, agent_id FROM sessions")) if table == "turns" else {}
    if table == "turns" and not session_agent:
        sys.exit("fetch sessions first: turns are linked to agents through their session")
    stats = {"mb": 0.0, "seen": 0, "kept": 0, "last": ""}
    batch, t0, last_log = [], time.time(), 0.0
    for line in stream_rows(filename, stats):
        stats["seen"] += 1
        if table != "sessions" and not DATE_HINT.search(line):
            continue
        r = json.loads(line)
        stats["last"] = r.get("created_at", "")[:16]
        if table == "sessions":
            row = (r["id"], r["agent_id"], r.get("session_goal"), r["created_at"])
        elif not in_window(r.get("created_at")):
            continue
        elif table == "turns":
            row = turn_row(r, session_agent)
        elif table == "memories":
            row = (r["id"], r["agent_id"], r["created_at"], r["content"])
        else:
            row = event_row(r)
        batch.append(row)
        stats["kept"] += 1
        if len(batch) >= 1000:
            con.executemany(sql, batch)
            con.commit()
            batch.clear()
        if time.time() - last_log > 30:
            last_log = time.time()
            print(f"[{table}] {stats['mb']:,.0f} MB  seen {stats['seen']:,}  kept {stats['kept']:,}  "
                  f"last {stats['last']}  {time.time() - t0:,.0f}s", flush=True)
    if batch:
        con.executemany(sql, batch)
        con.commit()
    print(f"[{table}] DONE {stats['mb']:,.0f} MB  seen {stats['seen']:,}  kept {stats['kept']:,}  "
          f"{time.time() - t0:,.0f}s", flush=True)


def fetch_local():
    """Small tables, already downloaded whole by hf_hub_download into DATA_DIR."""
    rows = lambda f: (json.loads(l) for l in gzip.open(DATA_DIR / f, "rt", encoding="utf-8"))
    con = connect()
    con.executemany("INSERT OR REPLACE INTO agents VALUES (?,?,?)",
                    [(a["id"], a["name"], a["model_string"]) for a in rows("agents.jsonl.gz")])
    con.execute("DELETE FROM goals")
    con.executemany("INSERT INTO goals VALUES (?,?,?)",
                    [(g["goal"], g["start_time"], g["end_time"]) for g in rows("village_goals.jsonl.gz")])
    con.executemany("INSERT OR REPLACE INTO rooms VALUES (?,?)",
                    [(r["id"], r["name"]) for r in rows("chat_rooms.jsonl.gz")])
    con.executemany("INSERT OR REPLACE INTO chat VALUES (?,?,?,?,?,?)",
                    [(c["id"], c["speaker_type"], c.get("agent_speaker_id"), c["content"], c["room_id"],
                      c["created_at"]) for c in rows("chat_messages.jsonl.gz") if in_window(c["created_at"])])
    con.executemany("INSERT OR REPLACE INTO summaries VALUES (?,?,?,?,?,?,?)",
                    [(s["id"], s["type"], s.get("summary_target"), s.get("summary_date"), s["content"],
                      s.get("generated_by"), s["created_at"]) for s in rows("summaries.jsonl.gz")])
    con.commit()
    for t in ("agents", "goals", "rooms", "chat", "summaries"):
        print(t, con.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0])


if __name__ == "__main__":
    which = sys.argv[1] if len(sys.argv) > 1 else ""
    if which == "local":
        fetch_local()
    elif which in TABLES:
        fetch_remote(which)
    else:
        sys.exit(__doc__)
