"""How far to trust the verdicts.

rerun    the production judge re-judges a random sample of messages: same answer twice?
cross    a second model family (OpenAI) re-judges every message by DeepSeek-V3.2, so no model only
         judges its own family, plus a random sample of everyone else's.
capture  the perspective-capture experiment. One model judges the same claims over the same log
         lines twice under the same rules: blinded (Alibi's view) and with the agent's own words
         visible (bash comments, narration, reasoning, and the message itself).
report   write the agreement numbers to DATA_DIR/validation.json for the site.

Usage:  python -m alibi.validate rerun | cross | capture | report
"""
import json
import random
import sys
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from math import comb

from .config import DATA_DIR, MODEL
from .db import connect
from .llm import BudgetExceeded, spent
from .receipts import SYSTEM, SYSTEM_SHARED, AgentLog, judge_message

UNBACKED = {"no_record", "contradicted"}


def ensure_tables(con):
    con.executescript("""
    CREATE TABLE IF NOT EXISTS validation (run TEXT, claim_id TEXT, verdict TEXT, why TEXT, PRIMARY KEY (run, claim_id));
    CREATE TABLE IF NOT EXISTS run_usage (run TEXT PRIMARY KEY, model TEXT, calls INTEGER, tokens_in INTEGER, tokens_out INTEGER, usd REAL);
    """)


def claims_of(con, message_ids, only=None):
    cols = ["id", "message_id", "agent_id", "kind", "claim", "quote", "created_at"]
    out = defaultdict(list)
    q = ",".join("?" * len(message_ids))
    for r in con.execute(f"SELECT {', '.join(cols)} FROM claims WHERE quote_ok = 1 AND message_id IN ({q}) ORDER BY id", message_ids):
        c = dict(zip(cols, r))
        if only is None or c["id"] in only:
            out[c["message_id"]].append(c)
    return out


def run(con, name, by_msg, model, narrated=False, reasoning=False, system=SYSTEM, workers=8):
    """Judge each message's claims with the given setup and store verdicts under `name`. The log
    window is always built from all of the message's claims, exactly as in production."""
    done = {r[0] for r in con.execute("SELECT claim_id FROM validation WHERE run = ?", (name,))}
    todo = {m: cs for m, cs in by_msg.items() if any(c["id"] not in done for c in cs)}
    names = dict(con.execute("SELECT id, name FROM agents"))
    msgs = {r[0]: {"id": r[0], "agent_id": r[1], "created_at": r[2], "content": r[3]} for r in con.execute(
        f"SELECT id, agent_id, created_at, content FROM chat WHERE id IN ({','.join('?' * len(todo))})", list(todo))} if todo else {}
    logs = {}

    def log_for(m):
        key = (m["agent_id"], m["created_at"][:10])
        if key not in logs:
            logs[key] = AgentLog(con, key[0], key[1], key[1])
        return logs[key]

    print(f"[{name}] {sum(len(c) for c in todo.values())} claims in {len(todo)} messages", flush=True)
    jobs = {mid: (log_for(m), names.get(m["agent_id"]), m, todo[mid]) for mid, m in msgs.items()}
    window = claims_of(con, list(todo)) if todo else {}
    start_usd, start_calls, start_in, start_out = spent["usd"], spent["calls"], spent["in"], spent["out"]
    with ThreadPoolExecutor(workers) as pool:
        futures = {pool.submit(judge_message, *args, reasoning, model, narrated, system, window.get(mid)): mid
                   for mid, args in jobs.items()}
        for k, f in enumerate(as_completed(futures), 1):
            try:
                rows = f.result()
            except BudgetExceeded as e:
                print("stopping:", e)
                pool.shutdown(cancel_futures=True)
                break
            except RuntimeError as e:  # one message failed after retries: leave it for a resumed run
                print(f"  skipped a message: {str(e)[:120]}", flush=True)
                continue
            con.executemany("INSERT OR REPLACE INTO validation VALUES (?,?,?,?)", [(name, r[0], r[1], r[3]) for r in rows])
            con.commit()
            if k % 25 == 0 or k == len(futures):
                print(f"  {k}/{len(futures)}  ${spent['usd']:.3f}", flush=True)
    prev = con.execute("SELECT calls, tokens_in, tokens_out, usd FROM run_usage WHERE run = ?", (name,)).fetchone() or (0, 0, 0, 0.0)
    con.execute("INSERT OR REPLACE INTO run_usage VALUES (?,?,?,?,?,?)", (
        name, model, prev[0] + spent["calls"] - start_calls, prev[1] + spent["in"] - start_in,
        prev[2] + spent["out"] - start_out, prev[3] + spent["usd"] - start_usd))
    con.commit()


def sample_messages(con, n, seed, where="1=1", params=()):
    ids = [r[0] for r in con.execute(f"""SELECT DISTINCT c.message_id FROM claims c JOIN chat m ON m.id = c.message_id
      WHERE c.quote_ok = 1 AND {where} ORDER BY c.message_id""", params)]
    random.Random(seed).shuffle(ids)
    return ids[:n]


def cmd_rerun(con):
    run(con, "rerun", claims_of(con, sample_messages(con, 120, seed=7)), MODEL)


def cmd_rerender(con):
    """Re-judge a fresh random sample with the head/keyword/tail renderer: how much did it change?"""
    run(con, "rerender", claims_of(con, sample_messages(con, 150, seed=99)), MODEL, workers=6)


def cmd_cross(con, model="gpt-6-luna"):
    ds = con.execute("SELECT id FROM agents WHERE name = 'DeepSeek-V3.2'").fetchone()[0]
    mids = sample_messages(con, 10_000, seed=1, where="c.agent_id = ?", params=(ds,))
    mids += sample_messages(con, 150, seed=11, where="c.agent_id != ?", params=(ds,))
    run(con, f"cross:{model}", claims_of(con, mids), model, workers=3)  # stays under OpenAI's token-per-minute cap


def cmd_capture(con, models=("gpt-5.6-sol", MODEL)):
    """Stratified by the first-pass verdict (flips are measured within one model, blind vs narrated),
    one claim per message so both arms see identical context."""
    rng = random.Random(23)
    picked = []
    for verdict, n in (("contradicted", 40), ("no_record", 45), ("backed", 20), ("screen_only", 15)):
        rows = con.execute("""SELECT c.id, c.message_id FROM claims c JOIN receipts r ON r.claim_id = c.id
          WHERE c.kind != 'relay' AND c.quote_ok = 1 AND COALESCE(r.first_verdict, r.verdict) = ?
          ORDER BY c.id""", (verdict,)).fetchall()
        rng.shuffle(rows)
        seen = {m for _, m in picked}
        for cid, mid in rows:
            if mid not in seen and n:
                picked.append((cid, mid))
                seen.add(mid)
                n -= 1
    only = {cid for cid, _ in picked}
    by_msg = claims_of(con, [m for _, m in picked], only=only)
    for model in models:
        direct = "/" not in model  # OpenAI analysis model at low effort, as an investigator would run it
        workers = 3 if direct else 6
        run(con, f"capture-blind:{model}", by_msg, model, narrated=False, reasoning=direct, system=SYSTEM_SHARED, workers=workers)
        run(con, f"capture-narrated:{model}", by_msg, model, narrated=True, reasoning=direct, system=SYSTEM_SHARED, workers=workers)


def sign_test(a, b):
    """Two-sided exact sign test on discordant pairs (a one way, b the other)."""
    n, k = a + b, min(a, b)
    if n == 0:
        return 1.0
    return min(1.0, 2 * sum(comb(n, i) for i in range(k + 1)) / 2 ** n)


def agreement(pairs):
    return {"claims": len(pairs), "agree": sum(a == b for a, b in pairs)}


def cmd_report(con):
    prod = dict(con.execute("SELECT claim_id, COALESCE(first_verdict, verdict) FROM receipts"))
    final = dict(con.execute("SELECT claim_id, verdict FROM receipts"))
    runs = defaultdict(dict)
    for name, cid, v in con.execute("SELECT run, claim_id, verdict FROM validation"):
        runs[name][cid] = v
    out = {}
    if runs.get("rerun"):
        out["rerun"] = agreement([(prod[c], v) for c, v in runs["rerun"].items() if c in prod])
    if runs.get("rerender"):
        # Same judge, fuller view of long outputs (start, keyword window, end): first pass vs fresh run
        pairs = [(prod[c], v) for c, v in runs["rerender"].items() if c in prod]
        out["rerender"] = {**agreement(pairs),
                           "contradictedBefore": sum(a == "contradicted" for a, _ in pairs),
                           "contradictedAfter": sum(b == "contradicted" for _, b in pairs),
                           "backedBefore": sum(a == "backed" for a, _ in pairs),
                           "backedAfter": sum(b == "backed" for _, b in pairs)}
    cross = next((k for k in runs if k.startswith("cross:")), None)
    if cross:
        pairs = [(prod[c], v) for c, v in runs[cross].items() if c in prod]
        by = defaultdict(lambda: {"n": 0, "agree": 0})
        for a, b in pairs:
            by[a]["n"] += 1
            by[a]["agree"] += a == b
        ds = con.execute("SELECT id FROM agents WHERE name = 'DeepSeek-V3.2'").fetchone()[0]
        own = {r[0] for r in con.execute("SELECT id FROM claims WHERE agent_id = ?", (ds,))}
        rate = lambda judge, ids: sum(judge[c] == "backed" for c in ids) / max(1, len(ids))
        ds_ids = [c for c in runs[cross] if c in own and c in prod]
        out["crossFamily"] = {"model": cross.split(":", 1)[1], **agreement(pairs), "byVerdict": dict(by),
                              "deepseekAgentBackedRate": {"deepseekJudge": rate(prod, ds_ids), "otherJudge": rate(runs[cross], ds_ids),
                                                          "claims": len(ds_ids)}}
    capture = {}
    for name in runs:
        if name.startswith("capture-blind:"):
            model = name.split(":", 1)[1]
            blind, narr = runs[name], runs.get(f"capture-narrated:{model}", {})
            both = [c for c in blind if c in narr]
            unbacked = [c for c in both if blind[c] in UNBACKED]
            withdrawn = sum(blind[c] == "contradicted" and narr[c] != "contradicted" for c in both)
            added = sum(blind[c] != "contradicted" and narr[c] == "contradicted" for c in both)
            capture[model] = {
                "model": model, "claims": len(both),
                "blind": Counter(blind[c] for c in both), "narrated": Counter(narr[c] for c in both),
                "unbackedBlind": len(unbacked),
                "flippedToBacked": sum(narr[c] == "backed" for c in unbacked),
                "backedBlind": sum(blind[c] == "backed" for c in both),
                "flippedFromBacked": sum(blind[c] == "backed" and narr[c] != "backed" for c in both),
                # Seeing the agent's own words made the judge withdraw contradictions it had found blind
                "contradictedBlind": sum(blind[c] == "contradicted" for c in both),
                "contradictedNarrated": sum(narr[c] == "contradicted" for c in both),
                "withdrawn": withdrawn, "added": added,
                "signTestP": sign_test(withdrawn, added),
            }
    if capture:
        out["capture"] = capture.get("gpt-5.6-sol") or next(iter(capture.values()))
        out["captureAll"] = capture
    labels_path = DATA_DIR / "labels.json"
    if labels_path.exists():
        labels = json.loads(labels_path.read_text(encoding="utf-8"))
        by = defaultdict(lambda: {"n": 0, "agree": 0})
        for cid, human in labels.items():
            if cid in final and human != "skip":
                by[final[cid]]["n"] += 1
                by[final[cid]]["agree"] += final[cid] == human
        out["human"] = {"labelled": sum(x["n"] for x in by.values()), "byVerdict": dict(by)}
        if cross:
            # Where the two model families disagreed (backed vs no_record), whose side did the human take?
            split = [cid for cid, human in labels.items() if human != "skip" and final.get(cid) == "backed"
                     and runs[cross].get(cid) == "no_record"]
            out["human"]["arbitration"] = {
                "claims": len(split),
                "sidedWithJudge": sum(labels[c] == "backed" for c in split),
                "sidedWithSecondFamily": sum(labels[c] == "no_record" for c in split),
            }
    usage = con.execute("SELECT COUNT(*), COALESCE(SUM(calls), 0), COALESCE(SUM(usd), 0) FROM run_usage").fetchone()
    out["validationUsage"] = {"runs": usage[0], "calls": usage[1], "usd": round(usage[2], 3)}
    (DATA_DIR / "validation.json").write_text(json.dumps(out, indent=2, default=dict), encoding="utf-8")
    print(json.dumps(out, indent=2, default=dict))


if __name__ == "__main__":
    con = connect()
    ensure_tables(con)
    {"rerun": cmd_rerun, "rerender": cmd_rerender, "cross": cmd_cross, "capture": cmd_capture,
     "report": cmd_report}[sys.argv[1]](con)
