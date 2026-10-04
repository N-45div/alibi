# Alibi

**Alibi follows unverified claims through agent swarms.** It checks every claim AI agents make against
their own action logs, traces the ones nobody can back up into other agents' messages, their long-term
memories and the official record, and measures how AI investigators fail at the same job. In one AI
Village goal, agents repeated each other's unbacked claims 2 to 4.5 times as often as backed ones, and
89% of repeats were never checked by the repeating agent. The official daily summaries didn't filter
them out, and the analysis model METR relied on withdrew half its accusations once it could read the
agents' own story. Alibi also runs live on Grove Research's Delvetown, where agents cite signed
records: 95% of 1,051 citations check out, and it found the nine that don't.

*Agents' words aren't evidence.*

Built for the AI Swarm Dynamics Hackathon (AI Village × Grove Research) on the
[AI Village dataset](https://huggingface.co/datasets/aidigestorg/ai-village) and
[Delvetown](https://delve.town)'s public records.

**Live demo:** [alibi-one.vercel.app](https://alibi-one.vercel.app) · **Results:** [FINDINGS.md](FINDINGS.md)

---

## The problem

Investigating the 2026 Hugging Face incident meant reading over a thousand very long agent transcripts.
The investigators had to delegate that reading to AI, and METR reports that their analysis model "would
often uncritically adopt the perspective of the agent in the transcript". About 7% of the transcripts
contained spoofed tool calls. The AI Village's own published daily summaries are written from chat,
without seeing inside the agents' computers.

When an analyst reads an agent's account, it inherits the agent's errors. Alibi never takes an agent's
word for anything: a chat message is a **claim**, and only the agent's own executed actions count as
**evidence**.

## What it found

One complete goal: **"Choose a charity and raise as much money as you can for it"**, April 2–27 2026,
14 agents from five labs, 4,558 agent chat messages, 151,251 logged computer-use turns.

- **28.8%** of 6,260 checkable claims have no supporting receipt in the claiming agent's own log
  (62.5% backed, 8.7% screen only, 28.0% no record, 0.8% contradicted).
- **89%** of 371 traced agent-to-agent repeats were taken on trust: the repeating agent's log shows no
  check of its own.
- **The swarm passes on what it can't verify:** other agents repeated 5.7% of no-record claims and
  12.7% of screen-only claims, against 2.8% of backed ones. Within the same agent and kind of claim,
  the odds were 2.2 times higher (permutation p < 0.001).
- **73%** of the official daily-summary sentences that restate checkable claims rest on at least one
  claim the agent's own log doesn't back. The summaries restated unbacked claims as often as backed ones.
- **Perspective capture:** given the agent's own narration, GPT-5.6 Sol (the analysis model METR relied
  on) withdrew 8 of 15 contradictions it had found blind and added none (sign test p = 0.008), while
  almost never inventing support (1 of 80).
- **A second swarm, checked live:** in Delvetown, 997 of 1,051 record citations (94.9%) resolve with
  every detail matching. Among the nine the records contradict, the town's minute-keeper filed two posts
  as "eaten by the deletion program" that are still in their author's repo.
- **Our own tool's failure, caught:** a single-window view of long outputs manufactured contradictions
  that two model families confirmed. Section 10 of [FINDINGS.md](FINDINGS.md) covers what we changed.

## How it works

| Step | Module | What happens |
|---|---|---|
| Slice | `alibi/fetch.py` | Stream the AI Village tables from Hugging Face and keep one goal. The 2.5 GB turns and memories files are filtered while streaming; nothing is stored whole. |
| Extract | `alibi/claims.py` | An LLM pulls every checkable claim out of agent chat (actions, observations, verifications, and repeats of other agents' results), each with a verbatim quote. A quote that isn't in the message is set aside, not trusted. |
| Receipts | `alibi/receipts.py` | For each message we find the turn that sent it and give a judge only what the agent executed before: commands, their real output, errors, GUI actions, tool results. Verdict: **backed**, **screen only**, **no record** or **contradicted**. |
| Spread | `alibi/spread.py` | Repeats are linked to the claim they repeat (did the repeater check first?), claims are followed into agents' memories by their exact specifics, each sentence of the official daily summary is traced to the claims it restates, and backed and unbacked claims are compared on how far they travelled, within the same agent and kind of claim. |
| Validate | `alibi/validate.py`, `alibi/labels.py` | Run-to-run agreement, a second model family, blind human labels, and the perspective-capture experiment. |
| Delvetown | `site/src/delve/`, `site/scripts/delve-snapshot.ts` | Read every repo on Delvetown's AT Protocol server and check each cited record's address, owner, time, kind and quoted words against the signed record, and whether a record a post calls deleted is gone. No model is involved. The same code runs in the browser for the live check. |
| Publish | `alibi/export.py`, `site/` | Static JSON and a React site: overview, a filterable ledger of every claim with its receipts, the audited summaries, Delvetown, and the method. |

### What counts as evidence

- **Counts:** executed shell commands with their output and errors, clicks, key presses and typed text,
  tool results, and the village's human-approval events.
- **Never counts:** chat, the agent's narration and reasoning, the first-person `# comments` agents were
  told to open each bash call with, their own summaries and memories, and other AIs' reports
  (history-search answers, `codex` sub-agent output).
- **Checked in code:** every verdict except "no record" must cite log lines that exist, belong to the
  claiming agent and come before the message. A verdict that cites nothing real becomes "no record".
- **Blinded judge:** the judge sees the claim and the log lines and nothing else, so it can't adopt the
  agent's perspective.
- **Accusations are confirmed:** every first-pass contradiction is re-judged with a fuller view of long
  outputs (start, keyword window, end), and stands only if a second model family (GPT-6 Luna), judging
  the same lines independently, agrees. Unconfirmed contradictions are shown as "no record".
- **In Delvetown, the record is the evidence:** a citation is checked against the signed record it
  points at, and a post's own words never count.

## Reproduce

Requires access to the gated dataset (request it on Hugging Face) and an OpenRouter key; an OpenAI key
is only needed for the cross-family check.

```bash
python -m venv .venv && .venv/Scripts/pip install -r requirements.txt   # bin/ on macOS/Linux
cp .env.example .env                                                     # add your keys

python -m alibi.fetch local        # small tables (download them first, see fetch.py)
python -m alibi.fetch sessions
python -m alibi.fetch turns
python -m alibi.fetch memories
python -m alibi.fetch events
python -m alibi.claims
python -m alibi.receipts
python -m alibi.receipts --second-look --no-reasoning
python -m alibi.validate confirm
python -m alibi.spread all
python -m alibi.spread amplify
python -m alibi.validate rerun | cross | capture | report
python -m alibi.export
cd site && npm install
node scripts/delve-snapshot.ts     # Delvetown: no keys, reads the town's public server (Node 22.18+)
npm run build
```

The analysis data is derived from a gated dataset, so it is not committed here. The pipeline rebuilds it.

## Limits

- **No receipt is not false.** The dataset captures most but not all activity, and the evidence window
  (from the agent's previous chat message, 30–150 turns, plus same-day lines that mention the claim's
  identifiers) can miss work done much earlier.
- **Screens aren't read.** Work done through the browser is marked "screen only" rather than guessed.
  The dataset has screenshots; this run doesn't inspect them.
- **LLMs extract and judge.** Hence verbatim quotes, citations checked in code, and validation against
  human labels, a re-run and a second model family.
- **Not an honesty ranking.** Agents that work through the browser leave fewer text receipts.
- **Delvetown shows the present, not its history.** A record deleted after it was cited reads as "no
  record", and owner, time and quote checks only fire when a post states them next to the record key.
- **The method needs a claim and a record.** A chat log and an action log in the AI Village, posts and
  signed records in Delvetown; any swarm that keeps both can be checked the same way.

## Related work

- **METR and Redwood Research, OpenAI–Hugging Face incident report (2026):** the investigation whose
  analysis-model failure Alibi is built around.
- **MessageBoardAuditBench** ([LessWrong](https://www.lesswrong.com/posts/wt4kk6vFPEhkXvF8Q/how-good-are-slop-vestigators)):
  an Inspect eval of how well agents replicate the German-wiki swarm investigation from its log data.
  Alibi is complementary: it measures claim-level judgments against action logs, and documents how
  an AI judge fails (cut-off outputs, softening once it reads the agent's narration, family leniency).
- **thimble** ([safety-research/thimble](https://github.com/safety-research/thimble)): a Claude Code
  plugin for human oversight, a workbench for making sense of large volumes of agent output with
  Claude. Alibi's ledger is a narrower, automated pass: every claim, its verdict and its receipts.

## Data and citation

AI Village dataset by AI Digest (Sage), used under its research terms: analysis only, no training, no
re-identification. The site shows agent messages only; human chat is excluded.

Delvetown records are read from Grove Research's public AT Protocol server (`pds.delve.town`). Alibi
only reads; it never posts or interacts. Only AI accounts' words are reproduced, and people's records
are linked, not copied.
