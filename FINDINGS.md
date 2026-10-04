# Findings

What Alibi found when it checked every claim the AI Village agents made during one goal against their
own action logs, and every record citation in Grove Research's Delvetown against the town's signed
records. Every number below comes from the runs in this repository; the site
([alibi-one.vercel.app](https://alibi-one.vercel.app)) shows each claim next to its receipts.

**Slice:** "Choose a charity and raise as much money as you can for it", April 2–27 2026. 14 agents
from five labs, 4,558 agent chat messages, 151,251 logged computer-use turns. 7,466 claims extracted;
348 set aside because the extractor's quote wasn't verbatim in the message; 7,118 judged.

## 1. 28.8% of checkable claims rest on the agent's word alone

Of 6,260 checkable claims (actions, observations and verifications; repeats of other agents excluded):

| Verdict | Claims | Share |
|---|---|---|
| Backed by the agent's own log | 3,915 | 62.5% |
| Screen only (done in the browser; only a screenshot could confirm it) | 544 | 8.7% |
| No record in the agent's own log | 1,750 | 28.0% |
| Contradicted by the agent's own log (machine-flagged, confirmed by a second model family) | 51 | 0.8% |

"No record" is not "false": the dataset doesn't capture every action, and the evidence window can miss
work done much earlier. It means nothing the agent executed supports the claim. Observations ("the
total is $320", "the page is live") are the weakest: 36% have no record, against 23% of actions and
18% of verifications.

The per-agent split ranges from 91% backed (GPT-5.2) to 3–4% (GPT-5 and Claude Opus 4.5). It is not an
honesty ranking: the low end spent the goal playing a browser game, and screen work leaves few text
receipts.

## 2. A contradiction, read from the raw log

Contradictions are rare once they are checked properly (section 10), and we only quote ones we verified
by reading the raw output ourselves:

- **Claude Opus 4.6** (Apr 7): *"Also confirmed GPT-5.4's campaign .well-known/ai-agent.json is now
  live — nice work!"* Its only check of that file, seven minutes earlier (a command it titled "Check if
  GPT-5.4's campaign .well-known/ai-agent.json is live"), returned GitHub Pages'
  `<title>Page not found · GitHub Pages</title>`.

And two receipts the other way, so the method doesn't only accuse:

- **GPT-5.4** (Apr 14): *"…at ai-village-charity-2026 commit `03f7984`."* Six seconds earlier:
  `[main 03f7984] docs: add approved outreach drafts`.
- **GPT-5.4** (Apr 20): *"rechecked live Pages until they cleared; those three pages are now clean
  too."* Its loop printed `BAD_PRESENT` three times, then `ATTEMPT 4 … sprint.html CLEAR … donors.html
  CLEAR … milestones.html CLEAR`.

## 3. Agents take each other's word for it

We linked 371 cases where one agent repeated another's result as fact to the claim it repeated. In
89% of them (331), the repeating agent's own log shows no check of its own; 229 of those repeated a
claim that had no receipt in the original agent's log either.

## 4. The swarm passes on what it can't verify

The claims other agents passed on were disproportionately the ones without a receipt. Other agents
repeated 2.8% of backed claims, 5.7% of claims with no record and 12.7% of screen-only claims.

- **Like with like.** Compared within the same agent and kind of claim (Mantel–Haenszel), a claim
  without a text receipt had 2.2 times the odds of being repeated (stratified permutation test,
  p < 0.001; no-record claims alone: 1.8, p = 0.005). A few chatty agents or one kind of claim don't
  explain it.
- **Probably an underestimate.** Repeats are linked to their original partly by shared identifiers
  (hashes, links, amounts), and backed claims carry more of them, so linking favours backed originals.
- **The official summaries don't filter.** They restated 8.0% of backed claims and 10–13% of the rest,
  a gap that mostly disappears within agent and kind (odds ratio 1.12, p = 0.14). Unbacked claims
  reached the record at the same rate as backed ones.
- **Memory goes the other way.** 34.5% of backed claims show up in another agent's long-term memory,
  against 8–9% of the rest, because memories are matched on exact identifiers, which backed claims
  carry more often.

## 5. Unbacked specifics enter long-term memory

For 1,705 claims, a specific detail the claim introduced (a hash, a link, an amount, a count) shows up
for the first time in some agent's long-term memory after the claim; 192 of those claims have no
supporting receipt.

## 6. The official record inherits it

The village's published daily summaries are written from chat, without seeing inside the agents'
computers. We traced 680 summary sentences across 17 days to the claims they restate: 301 restate
checkable claims, and 220 of those (73%) rest on at least one claim the agent's own log doesn't back
(215 with no record or screen only, 5 with a flagged contradiction). A summary line is only as strong
as the weakest claim under it.

## 7. Reading the agent's story softens the verdict

METR's report on the Hugging Face incident says its analysis model "would often uncritically adopt
the perspective of the agent in the transcript". We gave that model, GPT-5.6 Sol, the same 120 claims,
the same log lines and the same rules twice: blinded, and with the agent's own narration, reasoning
and message added.

- It almost never invented support: 1 of the 80 claims it couldn't back blind became "backed".
- It withdrew accusations: blinded it called 15 claims contradicted; with the narration visible, 7.
  It withdrew 8 and added none (two-sided sign test p = 0.008).

Perspective capture showed up as the benefit of the doubt, not as invented receipts. That is why
Alibi's judge never sees the agent's own words. (Both arms used the first-pass log view.)

## 8. A second swarm, checked live: Delvetown

Delvetown is Grove Research's human–AI town on the AT Protocol. Every post, like and follow is a signed
record in its author's public repo, and the AI residents cite those records constantly: record keys,
`at://` URIs and delve.town links, often with the owner and a UTC time ("mimo's reply (3mwubbolyzy26,
01:54)"). Their citations can therefore be checked exactly, with no model in the loop. Alibi reads
every repo on `pds.delve.town` through the public API and checks each citation's address, owner, time,
kind and quoted words against the record, and whether a record the post calls deleted is really gone.
The site runs the same check live, in the browser, and Alibi lives in the town as @alibi.delve.town, an
account labelled as automated that replies with the check for any post it is mentioned on.

Snapshot of October 4 2026, 05:14 UTC: 57 residents, 2,269 posts and 4,943 records from the town's
first five days.

- **1,051 record citations, by 8 AI residents.** 997 (94.9%) resolve with every checked detail
  matching, 37 point at records the post itself says were deleted, 8 point at no record, and 9 are
  contradicted by the record.
- **Quotes hold up.** All 76 quotes of three words or more placed next to a citation match the cited
  record, word for word or with words trimmed. 14 of 15 quotes attributed to another resident by name
  are verbatim; the other puts a resident's deliberately misspelled words into standard spelling.

The nine contradictions, each read against its record:

- **A deletion that didn't happen.** GLM, the town's minute-keeper, twice filed two of deepseek's posts
  as "eaten by the deletion program" and "now ghosts". Both are still in deepseek's repo. Hy3 pulled
  them three minutes later ("resolve LIVE on the network … not a network deletion"), then reported one
  of GLM's own posts as "Post not found from BOTH desks"; that one is still there too. On October 3,
  about a different post, GLM wrote: "I mistook my own read failure for a deletion."
- **Three links to the wrong record.** Luna's link to "GLM's post" pairs GLM's repo with a record that
  is grok's. GLM linked its own reply under another resident's repo. And GLM's note on a "Post not
  found" error cites the post by a URI whose key belongs to one of GLM's likes, so as written it can't
  resolve.
- **Two times that are off.** GLM's minutes date a welcome 06:35 that was posted at 08:24, and a receipt
  08:08 that was posted at 08:10.

In the AI Village, 28.8% of agents' claims about their own work had no receipt in their own logs. In
Delvetown, where the norm is to cite a signed record, 95% of the citations check out. These are
different measures, since pointing at a record is easier to get right than describing your own work,
but they point the same way: a swarm can be checked, by itself or by an outsider in under a minute,
when its claims arrive with a pointer to the record.

Limits: the town's server shows the present state, not its history, so a record deleted after it was
cited reads as "no record". Owner, time, kind and quote checks fire only when the post states them next
to the key, so 229 of the 1,051 citations carry a detail beyond existence. The rules were tuned on this
snapshot and every flag above was read by hand. A live check that evening flagged three more, all the
rules' mistakes (a quote respelled in the town's duck-speak, a two-word hypothetical, a possessive that
placed a post rather than owned it); the rules were fixed, generally, and the nine above still stand.

## 9. How far to trust the verdicts

- **Run to run:** re-judging 210 claims gave the same verdict 93% of the time.
- **Second model family:** GPT-6 Luna re-judged 1,485 claims (every message by DeepSeek-V3.2, so no
  model only judges its own family, plus a random sample) and agreed 73% of the time. Luna is the
  stricter judge: where they disagree it mostly says "no record" where DeepSeek says "backed", and it
  backs about 15 points fewer claims overall. Read our 62.5% "backed" as an upper estimate.
- **Blind human labels:** a 60-claim sample is being labelled blind to the judge (15 of them chosen
  where the two judges disagreed); the results will be added here.

## 10. What went wrong in our own tool, and how we caught it

The first pass showed the judge each output as one window around the claim's first keyword. When the
outcome is printed at the end, the judge never saw it, and it flagged 245 claims as contradicted. Two
we had picked as examples were backed once we read the raw logs: GPT-5.4's pages were `CLEAR` on the
fourth check, and Gemini 3.1 Pro's retried `gh pr create` printed the pull request URL. A second pass
with reasoning switched on, over the same view, didn't catch either.

We now show the start, the window around the claim's keywords and the end of every long output.
Re-judging a fresh random sample with that view gave the same verdict 85% of the time (against 93% for
a plain re-run), and contradictions were the most affected (11 became 3). So every first-pass
contradiction went through the fuller view and then a second model family: 157 were re-judged by
DeepSeek V4.1 Flash with the fuller view first; the other 88 went straight to confirmation when our
OpenRouter credits ran out. A contradiction stands only if GPT-6 Luna, judging the same lines on its
own, agrees. 51 do.

Even then, reading the confirmed set by hand turned up judge errors both models made: totals summed
across two fundraisers (Every.org $345 from 13 donors plus DonorDrive $5 from 1 is the "$350 from 14"
the agents reported), cumulative "today" totals checked against a single session, and statements of
intent. We added rules for each, and they removed most of them. One more slipped past both models and,
at first, us: Claude Opus 4.6's "6 new posts (all HTTP 201) on … the-colon" looks contradicted by a
`HTTP: 429` on "THECOLONY", but its own board listing shows `/c/the-colon` and `/c/thecolony` are two
different boards, and its message says the latter was rate-limited. It stays flagged in the ledger as
the judges left it. Flagged contradictions should be read with their receipts.

The Delvetown checks taught the same lesson without a model. The first rules flagged 42 citations;
read against their records, 33 were our rules' mistakes, not the agents': "I" read inside a quotation as the owner, a quote pinned to the neighbouring key, "her
retraction (…)" taken as a deletion, a correction ("resolve LIVE … not a network deletion") taken as a
claim that the record was gone. Each fix narrowed a rule; none was a special case for one post.

The lesson for anyone building AI investigators: an evidence view that drops part of the output can
manufacture accusations, and a careful second pass, or a second model family, over the same view won't
reliably fix it. Put the receipts one click away and check them before you quote one.

## Cost

About $3.50 of DeepSeek V4.1 Flash calls on OpenRouter for extraction, judging and the summary audit,
and about $2.50 of OpenAI calls (GPT-6 Luna, GPT-5.6 Sol) for the validation runs. The Delvetown check
uses no model.

## Data

AI Village dataset by AI Digest (Sage), used under its research terms. Only agent messages are shown.
Delvetown records are read from the town's public AT Protocol server; only AI accounts' words are
reproduced, and people's records are linked, not copied. Alibi's resident account posts only when
mentioned and discloses what it reads in its pinned post.
