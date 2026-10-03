"""Export the analysis to static JSON for the site (site/public/data).

Everything here is read from the real AI Village tables and our verdicts. Human (non-agent) chat
messages are never exported, and the AI Village research terms are respected: no identities beyond
the agents' public model names.

Usage:  python -m alibi.export
"""
import json
from collections import Counter, defaultdict
from datetime import datetime, timedelta
from pathlib import Path

from .config import MODEL, ROOT
from .db import connect
from .receipts import evidence_line

OUT = ROOT / "site" / "public" / "data"
LAB = {"gpt": "OpenAI", "claude": "Anthropic", "gemini": "Google", "deepseek": "DeepSeek", "kimi": "Moonshot"}
VERDICTS = ["backed", "screen_only", "no_record", "contradicted"]


def lab_of(model_string):
    return next((v for k, v in LAB.items() if k in model_string.lower()), "Other")


def village_day_map(con):
    """Date -> AI Village day number, from the official daily summaries (day 1 = 2025-04-02)."""
    return {d: int(t) for d, t in con.execute(
        "SELECT summary_date, target FROM summaries WHERE type = 'daily' AND target GLOB '[0-9]*'")}


def viewer_link(day_map, utc):
    """Deep link into the AI Village's own replay at the moment a message was sent."""
    t = datetime.fromisoformat(utc[:19])
    day = day_map.get((t - timedelta(hours=7)).date().isoformat())
    if not day:
        return None
    ms = int((t - datetime(1970, 1, 1)).total_seconds() * 1000)
    return f"https://theaidigest.org/village?day={day}&time={ms}"


def write(name, obj):
    path = OUT / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    return path.stat().st_size


def main():
    con = connect()
    agents = {i: {"name": n, "model": m, "lab": lab_of(m)} for i, n, m in con.execute(
        "SELECT id, name, model_string FROM agents")}
    day_map = village_day_map(con)
    rooms = dict(con.execute("SELECT id, name FROM rooms"))

    claims = [dict(zip(["id", "message_id", "agent_id", "created_at", "kind", "claim", "quote", "about",
                        "verdict", "why", "turn_ids", "uncited"], r)) for r in con.execute("""
      SELECT c.id, c.message_id, c.agent_id, c.created_at, c.kind, c.claim, c.quote, c.about,
             r.verdict, r.why, r.turn_ids, r.uncited
      FROM claims c JOIN receipts r ON r.claim_id = c.id ORDER BY c.created_at""")]
    relay = {r[0]: r[1] for r in con.execute("SELECT relay_id, origin_id FROM relay_links WHERE origin_id IS NOT NULL")}
    memory = defaultdict(list)
    for cid, aid, ts, key, own in con.execute("SELECT claim_id, agent_id, created_at, key, own FROM memory_hits"):
        memory[cid].append({"agent": agents[aid]["name"], "at": ts[:19], "key": key, "own": bool(own)})

    # Receipts: render each cited turn with the same evidence renderer the judge saw
    turn_ids = {t for c in claims for t in json.loads(c["turn_ids"] or "[]")}
    turns = {}
    cols = ["id", "created_at", "action", "output", "error", "tool_calls"]
    ids = list(turn_ids)
    for i in range(0, len(ids), 900):
        chunk = ids[i:i + 900]
        for r in con.execute(f"SELECT {', '.join(cols)} FROM turns WHERE id IN ({','.join('?' * len(chunk))})", chunk):
            t = dict(zip(cols, r))
            turns[t["id"]] = {"at": t["created_at"][:19], "line": evidence_line("", t, ()) or ""}

    # Messages that carry claims (agent messages only)
    msg_ids = sorted({c["message_id"] for c in claims})
    messages = {}
    for i in range(0, len(msg_ids), 900):
        chunk = msg_ids[i:i + 900]
        for mid, aid, ts, content, room in con.execute(
                f"SELECT id, agent_id, created_at, content, room_id FROM chat WHERE id IN ({','.join('?' * len(chunk))}) "
                f"AND speaker_type = 'agent'", chunk):
            messages[mid] = {"id": mid, "agent": agents[aid]["name"], "at": ts[:19], "room": rooms.get(room),
                             "text": content, "link": viewer_link(day_map, ts)}

    # Per-day files: claims with their receipts, spread and source message
    by_day = defaultdict(list)
    for c in claims:
        day = (datetime.fromisoformat(c["created_at"][:19]) - timedelta(hours=7)).date().isoformat()
        cited = [turns[t] | {"id": t} for t in json.loads(c["turn_ids"] or "[]") if t in turns]
        by_day[day].append({
            "id": c["id"], "msg": c["message_id"], "agent": agents[c["agent_id"]]["name"], "at": c["created_at"][:19],
            "kind": c["kind"], "claim": c["claim"], "quote": c["quote"], "about": c["about"],
            "verdict": c["verdict"], "why": c["why"], "receipts": cited, "relayOf": relay.get(c["id"]),
            "memory": memory.get(c["id"], []),
        })
    size = 0
    for day, rows in by_day.items():
        msgs = {r["msg"]: messages[r["msg"]] for r in rows if r["msg"] in messages}
        size += write(f"days/{day}.json", {"day": day, "claims": rows, "messages": msgs})
    # Compact index for the ledger: one row per claim, details load per day
    size += write("index.json", [[r["id"], day, r["agent"], r["kind"], r["verdict"], r["claim"], r["at"]]
                                 for day, rows in sorted(by_day.items()) for r in rows])

    # Official daily summaries, sentence by sentence
    summaries = []
    for sid, date, gen in con.execute("""SELECT DISTINCT s.id, s.summary_date, s.generated_by FROM summaries s
        JOIN summary_lines l ON l.summary_id = s.id ORDER BY s.summary_date"""):
        lines = [{"n": n, "text": t, "claims": json.loads(ids), "status": st} for n, t, ids, st in con.execute(
            "SELECT n, sentence, claim_ids, status FROM summary_lines WHERE summary_id = ? ORDER BY n", (sid,))]
        summaries.append({"date": date, "model": gen, "lines": lines})
    size += write("summaries.json", summaries)

    # Headline numbers
    by_agent = defaultdict(Counter)
    for c in claims:
        if c["kind"] != "relay":
            by_agent[c["agent_id"]][c["verdict"]] += 1
    per_agent = sorted(({"agent": agents[a]["name"], "model": agents[a]["model"], "lab": agents[a]["lab"],
                         "claims": sum(v.values()), **{k: v.get(k, 0) for k in VERDICTS}}
                        for a, v in by_agent.items()), key=lambda r: -r["claims"])
    kinds = defaultdict(Counter)
    for c in claims:
        kinds[c["kind"]][c["verdict"]] += 1
    trust = Counter()
    by_id = {c["id"]: c for c in claims}
    for rid, oid in relay.items():
        if rid in by_id and oid in by_id:
            trust[(by_id[oid]["verdict"], "checked" if by_id[rid]["verdict"] == "backed" else "trusted")] += 1
    summary_status = Counter(l["status"] for s in summaries for l in s["lines"])
    totals = Counter(c["verdict"] for c in claims if c["kind"] != "relay")
    mem_claims = {cid for cid in memory}
    overview = {
        "slice": {"goal": "Choose a charity and raise as much money as you can for it",
                  "from": "2026-04-02", "to": "2026-04-27",
                  "agents": len({c["agent_id"] for c in claims}),
                  "messages": con.execute("SELECT COUNT(*) FROM claims_done").fetchone()[0],
                  "turns": con.execute("SELECT COUNT(*) FROM turns").fetchone()[0]},
        "claims": {"extracted": con.execute("SELECT COUNT(*) FROM claims").fetchone()[0],
                   "unquotable": con.execute("SELECT COUNT(*) FROM claims WHERE quote_ok = 0").fetchone()[0],
                   "judged": len(claims), "totals": {k: totals.get(k, 0) for k in VERDICTS},
                   "byKind": {k: {v: n.get(v, 0) for v in VERDICTS} for k, n in kinds.items()}},
        "agents": per_agent,
        "trust": [{"origin": o, "relayer": r, "n": n} for (o, r), n in trust.items()],
        "memory": {"claims": len(mem_claims),
                   "unbacked": sum(1 for cid in mem_claims if by_id.get(cid, {}).get("verdict") in ("no_record", "contradicted"))},
        "summaries": {"days": len(summaries), "lines": dict(summary_status)},
        "days": sorted(by_day),
        "judge": {"model": MODEL},
    }
    size += write("overview.json", overview)
    print(f"exported {len(claims)} claims over {len(by_day)} days, {len(summaries)} summaries ({size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
