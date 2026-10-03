import { useMemo } from "react";
import { Loading, VerdictIcon, VerdictTag } from "../components";
import { claimHref, dayLabel, fmt, useData, type IndexRow, type LineStatus, type SummaryDay } from "../lib";

const STATUS_LABEL: Record<LineStatus, string> = {
  backed: "Rests on backed claims",
  unverified: "Rests on claims with no receipt",
  contradicted: "Rests on a contradicted claim",
  not_checkable: "No checkable claim behind it",
};

export default function Summaries({ date, line }: { date?: string; line?: number }) {
  const { data, error } = useData<SummaryDay[]>("summaries.json");
  const { data: index } = useData<IndexRow[]>("index.json");
  const byId = useMemo(() => new Map((index ?? []).map((r) => [r[0], r])), [index]);
  if (!data) return <div className="wrap"><Loading error={error} /></div>;
  const day = data.find((d) => d.date === date) ?? data.find((d) => d.lines.some((l) => l.status === "contradicted")) ?? data[0];
  if (!day) return <div className="wrap"><div className="empty">No audited summaries yet.</div></div>;
  const sel = day.lines.find((l) => l.n === line);
  const counts = day.lines.reduce<Record<string, number>>((m, l) => ({ ...m, [l.status]: (m[l.status] ?? 0) + 1 }), {});

  return (
    <div className="wrap">
      <header className="hero" style={{ paddingBottom: 0 }}>
        <div className="eyebrow">Official record</div>
        <h1>The daily summaries, audited</h1>
        <p className="lede">
          The AI Village publishes an LLM-written summary of each day, written from chat without seeing inside the agents’ computers.
          Each sentence below is traced to the claims it restates and inherits their receipts.
        </p>
      </header>
      <div className="days" role="group" aria-label="Day">
        {data.map((d) => (
          <button key={d.date} aria-pressed={d.date === day.date} onClick={() => { window.location.hash = `#/summaries/${d.date}`; }}>
            {dayLabel(d.date)}
          </button>
        ))}
      </div>
      <div className="summary">
        <div className="card">
          <div className="row small muted" style={{ marginBottom: 10 }}>
            <span>{dayLabel(day.date)} · written by {day.model}</span><span className="spacer" />
            {(["backed", "unverified", "contradicted"] as LineStatus[]).map((s) => (
              <span key={s} className="verdict"><VerdictIcon v={s} />{fmt(counts[s] ?? 0)}</span>
            ))}
          </div>
          {day.lines.map((l) => (
            <button key={l.n} className={`sline ${l.status}`} aria-pressed={l.n === sel?.n}
              title={STATUS_LABEL[l.status]} onClick={() => { window.location.hash = `#/summaries/${day.date}/${l.n}`; }}>
              {l.status !== "not_checkable" && <span className="icon"><VerdictIcon v={l.status} size={12} /></span>}{l.text}
            </button>
          ))}
        </div>
        <div className="card" style={{ position: "sticky", top: 72 }}>
          {sel ? (
            <>
              <h3>{STATUS_LABEL[sel.status]}</h3>
              <p className="small muted" style={{ marginTop: 0 }}>“{sel.text}”</p>
              {sel.claims.length > 0 ? (
                <ul className="list">{sel.claims.map((id) => {
                  const r = byId.get(id);
                  return r ? (
                    <li key={id}><div className="row"><VerdictTag v={r[4]} /><span className="muted small">{r[2]}</span></div>
                      <a href={claimHref(id)}>{r[5]}</a></li>
                  ) : null;
                })}</ul>
              ) : <div className="empty">This sentence doesn’t restate a checkable claim.</div>}
            </>
          ) : (
            <>
              <h3>Pick a sentence</h3>
              <p className="small muted">Coloured sentences rest on agents’ claims. Select one to see those claims and whether the agents’ own logs back them.</p>
              <div className="legend" style={{ display: "grid", gap: 8 }}>
                {(["backed", "unverified", "contradicted", "not_checkable"] as LineStatus[]).map((s) => (
                  <span key={s} className="verdict"><VerdictIcon v={s} />{STATUS_LABEL[s]}</span>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
