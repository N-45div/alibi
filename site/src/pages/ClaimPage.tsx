import { Loading, VerdictTag } from "../components";
import {
  VERDICT_HELP, claimHref, dayLabel, highlight, ptTime, useData,
  type Claim, type DayFile, type IndexRow,
} from "../lib";

export default function ClaimPage({ id }: { id: string }) {
  const { data: index, error } = useData<IndexRow[]>("index.json");
  const row = index?.find((r) => r[0] === id);
  const { data: day } = useData<DayFile>(row ? `days/${row[1]}.json` : null);
  if (!index || (row && !day)) return <div className="wrap"><Loading error={error} /></div>;
  const c = day?.claims.find((x) => x.id === id);
  if (!row || !c || !day) return <div className="wrap"><div className="empty">That claim isn’t in this dataset.</div></div>;
  const msg = day.messages[c.msg];
  const origin = c.relayOf ? index.find((r) => r[0] === c.relayOf) : undefined;

  return (
    <div className="wrap">
      <header className="hero" style={{ paddingBottom: 0 }}>
        <div className="eyebrow"><a href="#/claims">Ledger</a> · {dayLabel(row[1])} · {c.kind}</div>
        <div className="claimline">{c.claim}</div>
        <div className="row"><VerdictTag v={c.verdict} /><span className="muted small">{VERDICT_HELP[c.verdict]}</span></div>
      </header>

      <section className="detail">
        <div className="card">
          <h3>What {c.agent} said</h3>
          <div className="muted small" style={{ marginBottom: 10 }}>
            {ptTime(c.at)}{msg?.room ? ` · #${msg.room}` : ""}
            {msg?.link && <> · <a href={msg.link} target="_blank" rel="noreferrer">Open in the AI Village replay ↗</a></>}
          </div>
          <div className="message">
            {msg ? highlight(msg.text, c.quote).map((p, i) => typeof p === "string" ? p : <mark key={i}>{p.mark}</mark>) : `“${c.quote}”`}
          </div>
        </div>

        <div className="card">
          <h3>What {c.agent}’s own log shows</h3>
          {c.receipts.length > 0 ? c.receipts.map((r) => (
            <div className="receipt" key={r.id}><span className="ts">{r.at.slice(11)} UTC  </span>{r.line}</div>
          )) : <div className="empty">No log line supports this claim in the window before the message was sent.</div>}
          {c.why && <p className="why">{c.why}</p>}
          <p className="muted small" style={{ marginTop: 12 }}>
            The judge saw only the agent’s executed commands, their output, GUI actions and tool results. The agent’s narration,
            reasoning and chat were withheld on purpose.
          </p>
        </div>
      </section>

      <section>
        <h2>Where it went</h2>
        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))" }}>
          <div className="card">
            <h3>Repeated by other agents</h3>
            {origin && (
              <p className="small">This claim repeats <a href={claimHref(origin[0])}>{origin[2]}’s claim</a>: “{origin[5]}” (<VerdictTag v={origin[4]} />)</p>
            )}
            {c.relayedBy && c.relayedBy.length > 0 ? (
              <ul className="list">{c.relayedBy.map((r) => (
                <li key={r.id}><a href={claimHref(r.id)}>{r.agent}</a> repeated it · <VerdictTag v={r.verdict} />
                  <span className="muted small"> {r.verdict === "backed" ? "(checked it first)" : "(took it on trust)"}</span></li>
              ))}</ul>
            ) : !origin && <div className="empty">No other agent repeated this claim.</div>}
          </div>
          <div className="card">
            <h3>Entered long-term memory</h3>
            {c.memory.length > 0 ? (
              <ul className="list">{c.memory.map((m, i) => (
                <li key={i}><b>{m.agent}</b>{m.own ? " (its own memory)" : ""} · <span className="muted small">{ptTime(m.at)}</span>
                  <div className="muted small">first memory containing <code>{m.key}</code></div></li>
              ))}</ul>
            ) : <div className="empty">None of this claim’s specifics (hashes, links, amounts, counts) first appear in a memory after it.</div>}
          </div>
          <div className="card">
            <h3>In the official summary</h3>
            {c.inSummary && c.inSummary.length > 0 ? (
              <ul className="list">{c.inSummary.map((s) => (
                <li key={`${s.date}-${s.n}`}><a href={`#/summaries/${s.date}/${s.n}`}>{dayLabel(s.date)} summary, line {s.n + 1}</a></li>
              ))}</ul>
            ) : <div className="empty">No sentence of the daily summary restates this claim.</div>}
          </div>
        </div>
      </section>
    </div>
  );
}

export type { Claim };
