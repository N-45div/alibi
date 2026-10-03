import { Loading } from "../components";
import { VERDICTS, VERDICT_HELP, VERDICT_LABEL, fmt, pct, useData, type Overview } from "../lib";

const STEPS = [
  ["fetch", "Slice the village", "Stream the AI Village tables from Hugging Face and keep one goal: chat, 151k computer-use turns with their real command output, memories, events, summaries."],
  ["claims", "Extract claims", "An LLM pulls every checkable claim out of agent chat (actions, observations, verifications, repeats of other agents) with a verbatim quote. Quotes that aren’t in the message are set aside."],
  ["receipts", "Find receipts", "For each message we locate the turn that sent it and hand a judge only what the agent executed before: commands, outputs, errors, GUI actions, tool results. Never its narration."],
  ["spread", "Trace the spread", "Repeats are linked to the claim they repeat; claims are followed into agents’ long-term memories by their exact specifics (hashes, links, amounts, counts)."],
  ["audit", "Audit the record", "Each sentence of the official daily summary is traced to the claims it restates and inherits their verdicts."],
];

export default function Method() {
  const { data: o, error } = useData<Overview>("overview.json");
  if (!o) return <div className="wrap"><Loading error={error} /></div>;
  const v = o.validation;

  return (
    <div className="wrap">
      <header className="hero" style={{ paddingBottom: 0 }}>
        <div className="eyebrow">Method</div>
        <h1>How Alibi decides</h1>
        <p className="lede">
          Investigators of the 2026 Hugging Face incident had to delegate reading thousands of agent transcripts to AI, and found the
          analysis model “would often uncritically adopt the perspective of the agent in the transcript” (METR). Alibi’s rule is the
          fix: an agent’s words are a claim, and only its own executed actions count as evidence.
        </p>
      </header>

      <section>
        <div className="steps">
          {STEPS.map(([k, title, body]) => (
            <div className="card step" key={k}><div className="k">{k}</div><h3>{title}</h3><div className="small muted">{body}</div></div>
          ))}
        </div>
      </section>

      <section>
        <h2>The verdicts</h2>
        <div className="card table-wrap">
          <table><tbody>{VERDICTS.map((x) => (
            <tr key={x}><td style={{ width: 160 }}><b>{VERDICT_LABEL[x]}</b></td><td>{VERDICT_HELP[x]}</td>
              <td className="num">{fmt(o.claims.totals[x])}</td></tr>
          ))}</tbody></table>
        </div>
      </section>

      <section className="prose">
        <h2>What counts as evidence</h2>
        <ul>
          <li><strong>Counts:</strong> the agent’s executed shell commands and their real output and errors, its clicks, key presses and typed text, tool results, and the village’s human-approval events.</li>
          <li><strong>Never counts:</strong> chat messages, the agent’s narration and reasoning, the first-person comments agents were told to open each bash call with, its own session summaries and memories, and other AIs’ reports (history-search answers, codex sub-agent output). Those are all the agent, or another model, talking.</li>
          <li><strong>Checked in code:</strong> every verdict except “no record” must cite log lines that exist, belong to the claiming agent and precede the message. A verdict citing nothing real is downgraded to “no record”.</li>
          <li><strong>Blinded judge:</strong> the judge ({o.judge.model}, reasoning off) sees the claim sentence and the log lines, nothing else. Log windows run from the agent’s previous chat message (30–150 turns) plus same-day lines mentioning the claim’s identifiers.</li>
          <li><strong>Second look:</strong> every “contradicted” verdict is re-judged over the identical log lines with reasoning switched on. Only claims both passes call contradicted are published as contradicted; the rest take the second pass’s verdict. The fast pass over-calls contradictions, which is exactly why this step exists.</li>
        </ul>
      </section>

      <section className="prose">
        <h2>How much to trust it</h2>
        {v ? (
          <ul>
            {v.human && <li><strong>Human labels:</strong> {fmt(v.human.labelled)} claims labelled blind to the judge’s verdict. {Object.entries(v.human.byVerdict).map(([k, x]) => `${VERDICT_LABEL[k as keyof typeof VERDICT_LABEL] ?? k}: ${x.agree}/${x.n} agreed`).join("; ")}.</li>}
            {v.rerun && <li><strong>Run-to-run:</strong> re-judging {fmt(v.rerun.claims)} claims gave the same verdict {pct(v.rerun.agree, v.rerun.claims)} of the time.</li>}
            {v.rerender && <li><strong>A fuller view of long outputs:</strong> the first pass showed each output as one window around the claim’s first keyword, which can hide an outcome printed at the end (a retry that worked, a final status). Re-judging a fresh sample of {fmt(v.rerender.claims)} claims with the start, the keyword window and the end of each output gave the same verdict {pct(v.rerender.agree, v.rerender.claims)} of the time, against {v.rerun ? pct(v.rerun.agree, v.rerun.claims) : "–"} for a plain re-run. Contradictions were the most affected ({fmt(v.rerender.contradictedBefore)} became {fmt(v.rerender.contradictedAfter)}), so every contradicted claim was re-judged with the fuller view and reasoning on; other verdicts are from the first pass.</li>}
            {v.crossFamily && <li><strong>Cross-family:</strong> {v.crossFamily.model} re-judged {fmt(v.crossFamily.claims)} claims (all of DeepSeek-V3.2’s, so no model judges its own family, plus a random sample) and agreed {pct(v.crossFamily.agree, v.crossFamily.claims)} of the time.</li>}
            {v.capture && <li><strong>Perspective capture:</strong> the same {fmt(v.capture.claims)} claims and log lines judged twice by {v.capture.model}, blinded and with the agent’s narration visible. With the narration it withdrew {fmt(v.capture.withdrawn)} of {fmt(v.capture.contradictedBlind)} contradictions and added {fmt(v.capture.added)} (sign test p = {v.capture.signTestP.toFixed(3)}), and upgraded {fmt(v.capture.flippedToBacked)} of {fmt(v.capture.unbackedBlind)} unbacked claims to backed. That is why Alibi’s judge never sees the agent’s words.</li>}
            {v.cost && <li><strong>Cost:</strong> the whole run took {fmt(v.cost.calls)} model calls and about ${v.cost.usd.toFixed(2)}.</li>}
          </ul>
        ) : <p>Validation numbers are added once the labelled sample is complete.</p>}
      </section>

      <section className="prose">
        <h2>Limits</h2>
        <ul>
          <li><strong>No receipt is not false.</strong> The dataset captures most but not all activity, and claims about earlier days can fall outside the log window.</li>
          <li><strong>Screens aren’t read.</strong> Work done through the browser is marked “screen only” rather than guessed; screenshots exist in the dataset but this run doesn’t inspect them.</li>
          <li><strong>LLMs extract and judge.</strong> That’s why quotes are checked verbatim, citations are checked in code, and verdicts are validated against human labels, a re-run and a second model family.</li>
          <li><strong>One goal, one village.</strong> 25 days of the Charity 2026 goal, after the village moved agents to permanent computer use (March 2026). The method needs only a chat log and an action log, so it applies to any swarm that keeps both.</li>
        </ul>
      </section>

      <section className="prose">
        <h2>Data</h2>
        <p>
          AI Village dataset by AI Digest (<a href="https://huggingface.co/datasets/aidigestorg/ai-village" target="_blank" rel="noreferrer">aidigestorg/ai-village</a>),
          used under its research terms. Only agent messages are shown; human chat is excluded. Source code and the full pipeline:
          {" "}<a href="https://github.com/N-45div/alibi" target="_blank" rel="noreferrer">github.com/N-45div/alibi</a>.
        </p>
      </section>
    </div>
  );
}
