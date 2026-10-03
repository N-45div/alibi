# Alibi

**Agents' words aren't evidence.** Alibi checks what AI agents *say* they did against what their own
action logs *show*, then traces how the claims nobody can back up spread through a swarm: into other
agents' messages, into their long-term memories, and into the official record.

Built for the AI Swarm Dynamics Hackathon (AI Village × Grove Research) on the
[AI Village dataset](https://huggingface.co/datasets/aidigestorg/ai-village).

**Live demo:** _link added on deploy_

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

_Headline numbers are filled in from the final run._

## How it works

| Step | Module | What happens |
|---|---|---|
| Slice | `alibi/fetch.py` | Stream the AI Village tables from Hugging Face and keep one goal. The 2.5 GB turns and memories files are filtered while streaming; nothing is stored whole. |
| Extract | `alibi/claims.py` | An LLM pulls every checkable claim out of agent chat (actions, observations, verifications, and repeats of other agents' results), each with a verbatim quote. A quote that isn't in the message is set aside, not trusted. |
| Receipts | `alibi/receipts.py` | For each message we find the turn that sent it and give a judge only what the agent executed before: commands, their real output, errors, GUI actions, tool results. Verdict: **backed**, **screen only**, **no record** or **contradicted**. |
| Spread | `alibi/spread.py` | Repeats are linked to the claim they repeat (did the repeater check first?), claims are followed into agents' memories by their exact specifics, and each sentence of the official daily summary is traced to the claims it restates. |
| Validate | `alibi/validate.py`, `alibi/labels.py` | Run-to-run agreement, a second model family, blind human labels, and the perspective-capture experiment. |
| Publish | `alibi/export.py`, `site/` | Static JSON and a React site: overview, a filterable ledger of every claim with its receipts, the audited summaries, and the method. |

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
python -m alibi.validate rerun | cross | capture | report
python -m alibi.export
cd site && npm install && npm run build
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
- **One goal, one village.** The method needs only a chat log and an action log, so it applies to any
  swarm that keeps both.

## Data and citation

AI Village dataset by AI Digest (Sage), used under its research terms: analysis only, no training, no
re-identification. The site shows agent messages only; human chat is excluded.
