"""Where claims went after they were made.

relays     a relay claim ("Haiku already deployed the 175th milestone") is linked to the original
           claim it repeats, so we can ask: did the relayer check, and was the original backed?
memory     when a claim's specifics (hashes, URLs, amounts, counts) first appear in an agent's
           long-term memory after the claim, the claim was kept (own memory) or adopted (a peer's).
summaries  each sentence of the official daily summary is traced to the claims it restates, so a
           summary line inherits the receipt status of what it rests on.

relays and memory are pure string work; summaries uses one LLM call per summary.
Usage:  python -m alibi.spread relays | memory | summaries | all
"""
import bisect
import json
import re
import sys
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta

from .db import connect
from .llm import chat_json, spent
from .receipts import IDENT

COUNT = re.compile(r"\b\d[\d,]*\+?\s(?:dms|messages|comments|replies|posts|donors|supporters|donations|repos|emails)\b")
WORD = re.compile(r"[a-z][a-z0-9_.-]{3,}")


def keys_of(text):
    t = text.lower()
    return {m.group(0).rstrip(".,") for m in IDENT.finditer(t)} | {m.group(0) for m in COUNT.finditer(t)}


def words_of(text):
    return set(WORD.findall(text.lower()))


def load_claims(con):
    cols = ["id", "message_id", "agent_id", "created_at", "kind", "claim", "quote", "about", "verdict"]
    return [dict(zip(cols, r)) for r in con.execute("""
      SELECT c.id, c.message_id, c.agent_id, c.created_at, c.kind, c.claim, c.quote, c.about, r.verdict
      FROM claims c JOIN receipts r ON r.claim_id = c.id ORDER BY c.created_at""")]


def resolve_agent(about, agents):
    """Map a free-text agent mention ("Haiku", "GPT-5.4", "Opus 4.6") to one agent id, or None if ambiguous."""
    if not about:
        return None
    a = about.lower().replace("claude ", "").strip()
    short = {i: n.lower().replace("claude ", "") for i, n in agents.items()}
    exact = [i for i, n in short.items() if n == a]
    if exact:
        return exact[0]
    hits = [i for i, n in short.items() if a and (a in n or n in a)]
    return hits[0] if len(hits) == 1 else None


# ---------------------------------------------------------------- relays

def link_relays(con):
    con.executescript("""DROP TABLE IF EXISTS relay_links;
      CREATE TABLE relay_links (relay_id TEXT PRIMARY KEY, origin_id TEXT, subject_id TEXT, score REAL);""")
    claims = load_claims(con)
    active = {c["agent_id"] for c in claims}
    agents = {i: n for i, n in con.execute("SELECT id, name FROM agents") if i in active}
    by_agent = defaultdict(list)
    for c in claims:
        if c["kind"] != "relay":
            by_agent[c["agent_id"]].append(c)
    jobs = []
    for r in (c for c in claims if c["kind"] == "relay"):
        subject = resolve_agent(r["about"], agents)
        if not subject:
            continue
        t = datetime.fromisoformat(r["created_at"][:19])
        lo = (t - timedelta(hours=36)).isoformat(" ")
        rk, rw = keys_of(r["claim"] + " " + r["quote"]), words_of(r["claim"])
        scored = []
        for o in by_agent[subject]:
            if lo <= o["created_at"] < r["created_at"]:
                ok, ow = keys_of(o["claim"] + " " + o["quote"]), words_of(o["claim"])
                scored.append((3 * len(rk & ok) + len(rw & ow) / max(1, len(rw | ow)), o))
        top = [o for s, o in sorted(scored, key=lambda x: -x[0])[:8] if s > 0]
        jobs.append((r, subject, top))

    def pick(job):
        r, subject, top = job
        if not top:
            return (r["id"], None, subject, 0.0)
        cand = "\n".join(f"[{k}] ({o['created_at'][:16]}) {o['claim']}" for k, o in enumerate(top))
        out = chat_json(RELAY_SYSTEM, f"REPEATED CLAIM ({r['created_at'][:16]}): {r['claim']}\n\n"
                                      f"EARLIER CLAIMS BY {agents[subject]}:\n{cand}", max_tokens=200)
        k = out.get("match")
        ok = isinstance(k, int) and 0 <= k < len(top)
        return (r["id"], top[k]["id"] if ok else None, subject, 1.0 if ok else 0.0)

    with ThreadPoolExecutor(8) as pool:
        rows = list(pool.map(pick, jobs))
    con.executemany("INSERT INTO relay_links VALUES (?,?,?,?)", rows)
    con.commit()
    linked = sum(1 for r in rows if r[1])
    print(f"relays: {len(rows)} with a known subject, {linked} linked to an original claim  ${spent['usd']:.3f}")


RELAY_SYSTEM = """One AI agent repeated, as fact, something another agent did or found. Which earlier
claim by that other agent is it repeating? Pick only a claim stating the same fact (same action,
artifact or number), not one that is merely on the same topic.
Return JSON: {"match": <claim number>} or {"match": null} if none of them is the source."""


# ---------------------------------------------------------------- memory

def memory_adoption(con):
    con.executescript("""DROP TABLE IF EXISTS memory_hits;
      CREATE TABLE memory_hits (claim_id TEXT, agent_id TEXT, memory_id TEXT, created_at TEXT, key TEXT, own INTEGER);""")
    index = defaultdict(list)  # key -> [(created_at, agent_id, memory_id)] in time order
    for mid, aid, ts, content in con.execute("SELECT id, agent_id, created_at, content FROM memories ORDER BY created_at"):
        for k in keys_of(content):
            index[k].append((ts, aid, mid))
    rows = []
    for c in load_claims(con):
        if c["kind"] == "relay":
            continue
        horizon = (datetime.fromisoformat(c["created_at"][:19]) + timedelta(days=7)).isoformat(" ")
        first = {}
        for k in keys_of(c["claim"] + " " + c["quote"]):
            entries = index.get(k, [])
            # Only keys this claim introduced: present in no memory before the claim was made
            if not entries or entries[0][0] < c["created_at"]:
                continue
            for ts, aid, mid in entries[:bisect.bisect_left(entries, (horizon,))]:
                if aid not in first or ts < first[aid][0]:
                    first[aid] = (ts, mid, k)
        rows += [(c["id"], aid, mid, ts, k, int(aid == c["agent_id"])) for aid, (ts, mid, k) in first.items()]
    con.executemany("INSERT INTO memory_hits VALUES (?,?,?,?,?,?)", rows)
    con.commit()
    print(f"memory: {len(rows)} claim->memory adoptions across {len({r[0] for r in rows})} claims")


# ---------------------------------------------------------------- summaries

SUMMARY_SYSTEM = """You trace an official daily summary of an AI-agent village back to the agents' own claims.

Each summary sentence comes with candidate claims made that day, each with a key like C12. For
every sentence, list the keys of the claims it restates or directly depends on. A sentence can
rest on several claims or on none (scene-setting, plans, opinions). Only pick a claim if the
sentence really states the same fact (same agent, same action or number); topic overlap is not enough.

Return JSON: {"sentences": [{"s": <sentence number>, "claims": ["C12", ...]}]}"""


def line_status(verdicts):
    """A summary line is only as good as the weakest claim it rests on."""
    if not verdicts:
        return "not_checkable"
    if "contradicted" in verdicts:
        return "contradicted"
    return "backed" if verdicts == {"backed"} else "unverified"


def pt_date(utc):
    return (datetime.fromisoformat(utc[:19]) - timedelta(hours=7)).date().isoformat()


def sentences_of(text):
    """Sentences of a summary, skipping markdown headings and markup."""
    text = re.sub(r"</?[a-z_]+>", "\n", text)
    out = []
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        line = re.sub(r"^[•\-*]\s+", "", line).replace("**", "")
        out += [s.strip() for s in re.split(r"(?<=[.!?])\s+(?=[A-Z\[])", line) if len(s.strip()) > 25]
    return out


def audit_summaries(con, start="2026-04-02", end="2026-04-27"):
    con.executescript("""CREATE TABLE IF NOT EXISTS summary_lines (
      summary_id TEXT, n INTEGER, sentence TEXT, claim_ids TEXT, status TEXT, PRIMARY KEY (summary_id, n));""")
    names = dict(con.execute("SELECT id, name FROM agents"))
    claims = load_claims(con)
    by_day = defaultdict(list)
    for c in claims:
        by_day[pt_date(c["created_at"])].append(c)
    verdict = {c["id"]: c["verdict"] for c in claims}
    summaries = con.execute("""SELECT s.id, s.summary_date, s.content FROM summaries s
      WHERE s.type = 'daily' AND s.summary_date BETWEEN ? AND ?
        AND s.created_at = (SELECT MAX(created_at) FROM summaries t WHERE t.type = 'daily' AND t.summary_date = s.summary_date)
        AND s.id NOT IN (SELECT summary_id FROM summary_lines) ORDER BY s.summary_date""", (start, end)).fetchall()
    for sid, day, content in summaries:
        sents = sentences_of(content)
        blocks, key_of, id_of = [], {}, {}  # short keys: the model mangled "uuid:0"-style ids
        for n, s in enumerate(sents):
            sk, sw = keys_of(s), words_of(s)
            scored = []
            for c in by_day[day]:
                name_hit = 2 if names.get(c["agent_id"], "~").lower().replace("claude ", "") in s.lower() else 0
                score = name_hit + 3 * len(sk & keys_of(c["claim"])) + len(sw & words_of(c["claim"])) / 4
                scored.append((score, c))
            top = [c for score, c in sorted(scored, key=lambda x: -x[0])[:8] if score >= 2]
            for c in top:
                if c["id"] not in key_of:
                    key_of[c["id"]] = f"C{len(key_of) + 1}"
                    id_of[key_of[c["id"]]] = c["id"]
            cand = "\n".join(f"    {key_of[c['id']]}: [{names.get(c['agent_id'])}] {c['claim']}" for c in top) or "    (none)"
            blocks.append(f"[{n}] {s}\n  candidates:\n{cand}")
        out = chat_json(SUMMARY_SYSTEM, f"SUMMARY for {day}:\n\n" + "\n\n".join(blocks), max_tokens=6000)
        picked = {int(x["s"]): [id_of[k] for k in x.get("claims", []) if k in id_of] for x in out.get("sentences", [])
                  if str(x.get("s", "")).isdigit()}
        rows = []
        for n, s in enumerate(sents):
            ids = picked.get(n, [])
            rows.append((sid, n, s, json.dumps(ids), line_status({verdict[i] for i in ids})))
        con.executemany("INSERT OR REPLACE INTO summary_lines VALUES (?,?,?,?,?)", rows)
        con.commit()
        counts = defaultdict(int)
        for r in rows:
            counts[r[4]] += 1
        print(f"summary {day}: {dict(counts)}  ${spent['usd']:.3f}", flush=True)


if __name__ == "__main__":
    which = sys.argv[1] if len(sys.argv) > 1 else "all"
    con = connect()
    if which in ("relays", "all"):
        link_relays(con)
    if which in ("memory", "all"):
        memory_adoption(con)
    if which in ("summaries", "all"):
        audit_summaries(con, *sys.argv[2:4])
