import { useState, type ReactNode } from "react";
import {
  VERDICTS, VERDICT_HELP, VERDICT_LABEL, claimHref, fmt, pct, ptTime,
  type AgentRow, type IndexRow, type LineStatus, type Verdict,
} from "./lib";

const COLOR: Record<Verdict, string> = {
  backed: "var(--good)", screen_only: "var(--warning)", no_record: "var(--serious)", contradicted: "var(--critical)",
};

/** Status mark: a shape per verdict so identity never rests on color alone. */
export function VerdictIcon({ v, size = 14 }: { v: Verdict | LineStatus; size?: number }) {
  const c = v === "unverified" ? COLOR.no_record : v === "not_checkable" ? "var(--axis)" : COLOR[v as Verdict];
  const r = size / 2;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      {v === "backed" && (<>
        <circle cx={r} cy={r} r={r} fill={c} />
        <path d={`M${size * 0.28} ${size * 0.52} L${size * 0.44} ${size * 0.68} L${size * 0.73} ${size * 0.36}`}
          stroke="#fff" strokeWidth={size * 0.13} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </>)}
      {v === "screen_only" && (<>
        <circle cx={r} cy={r} r={r - 1} fill="none" stroke={c} strokeWidth="2" />
        <path d={`M${r} 1 A${r - 1} ${r - 1} 0 0 0 ${r} ${size - 1} Z`} fill={c} />
      </>)}
      {(v === "no_record" || v === "unverified" || v === "not_checkable") && (
        <circle cx={r} cy={r} r={r - 1.25} fill="none" stroke={c} strokeWidth="2.5" />
      )}
      {v === "contradicted" && (<>
        <circle cx={r} cy={r} r={r} fill={c} />
        <path d={`M${size * 0.32} ${size * 0.32} L${size * 0.68} ${size * 0.68} M${size * 0.68} ${size * 0.32} L${size * 0.32} ${size * 0.68}`}
          stroke="#fff" strokeWidth={size * 0.13} strokeLinecap="round" />
      </>)}
    </svg>
  );
}

export function VerdictTag({ v }: { v: Verdict }) {
  return <span className="verdict" title={VERDICT_HELP[v]}><VerdictIcon v={v} />{VERDICT_LABEL[v]}</span>;
}

export function Legend() {
  return (
    <div className="legend" role="list">
      {VERDICTS.map((v) => <span role="listitem" key={v}><VerdictTag v={v} /></span>)}
    </div>
  );
}

export function Tile({ label, value, note }: { label: ReactNode; value: ReactNode; note?: ReactNode }) {
  return (
    <div className="card tile">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {note && <div className="note">{note}</div>}
    </div>
  );
}

interface Tip { x: number; y: number; title: string; body: string }

/** 100% stacked bars of verdicts per agent, with hover/focus tooltips and a table twin. */
export function VerdictBars({ rows, minClaims = 0 }: { rows: AgentRow[]; minClaims?: number }) {
  const [tip, setTip] = useState<Tip | null>(null);
  const [table, setTable] = useState(false);
  const shown = rows.filter((r) => r.claims >= minClaims);
  const show = (e: { clientX: number; clientY: number }, r: AgentRow, v: Verdict) =>
    setTip({ x: e.clientX, y: e.clientY, title: `${r.agent} · ${VERDICT_LABEL[v]}`, body: `${fmt(r[v])} of ${fmt(r.claims)} claims (${pct(r[v], r.claims)})` });
  const focus = (el: HTMLElement, r: AgentRow, v: Verdict) => {
    const b = el.getBoundingClientRect();
    show({ clientX: b.left + b.width / 2, clientY: b.top }, r, v);
  };
  return (
    <div>
      <div className="row">
        <Legend />
        <span className="spacer" />
        <button className="toggle" onClick={() => setTable((t) => !t)} aria-pressed={table}>
          {table ? "Show chart" : "Show table"}
        </button>
      </div>
      {table ? (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Agent</th><th>Lab</th><th className="num">Claims</th>
              {VERDICTS.map((v) => <th className="num" key={v}>{VERDICT_LABEL[v]}</th>)}</tr></thead>
            <tbody>{shown.map((r) => (
              <tr key={r.agent}><td>{r.agent}</td><td>{r.lab}</td><td className="num">{fmt(r.claims)}</td>
                {VERDICTS.map((v) => <td className="num" key={v}>{fmt(r[v])} <span className="muted">({pct(r[v], r.claims)})</span></td>)}</tr>
            ))}</tbody>
          </table>
        </div>
      ) : (
        <div className="bars" onMouseLeave={() => setTip(null)}>
          {shown.map((r) => (
            <div key={r.agent} style={{ display: "contents" }}>
              <div className="who"><b>{r.agent}</b><span>{r.lab}</span></div>
              <div className="stack" role="img" aria-label={`${r.agent}: ` + VERDICTS.map((v) => `${VERDICT_LABEL[v]} ${pct(r[v], r.claims)}`).join(", ")}>
                {VERDICTS.filter((v) => r[v] > 0).map((v) => (
                  <div key={v} className="seg" tabIndex={0} style={{ flexGrow: r[v], flexBasis: 0, background: COLOR[v] }}
                    onMouseMove={(e) => show(e, r, v)} onFocus={(e) => focus(e.currentTarget, r, v)} onBlur={() => setTip(null)} />
                ))}
              </div>
              <div className="n">{pct(r.backed, r.claims)} backed <span className="muted">· {fmt(r.claims)}</span></div>
            </div>
          ))}
        </div>
      )}
      {tip && (
        <div className="tooltip" style={{ left: Math.min(tip.x + 12, window.innerWidth - 270), top: tip.y + 14 }}>
          <div className="t-title">{tip.title}</div>{tip.body}
        </div>
      )}
    </div>
  );
}

export function ClaimRow({ r }: { r: IndexRow }) {
  const [id, , agent, kind, verdict, claim, at] = r;
  return (
    <a className="claim-row" href={claimHref(id)}>
      <div className="meta">{ptTime(at)}<br />{agent}</div>
      <div>{claim}<div className="meta">{kind}</div></div>
      <div><VerdictTag v={verdict} /></div>
    </a>
  );
}

export function Loading({ error }: { error?: string }) {
  return <div className="loading">{error ? `Could not load data: ${error}` : "Loading…"}</div>;
}
