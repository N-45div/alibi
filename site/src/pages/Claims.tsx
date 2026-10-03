import { useMemo, useState } from "react";
import { ClaimRow, Loading } from "../components";
import { KINDS, VERDICTS, VERDICT_LABEL, dayLabel, fmt, useData, type IndexRow } from "../lib";

const PAGE = 50;

export default function Claims() {
  const { data, error } = useData<IndexRow[]>("index.json");
  const [day, setDay] = useState("");
  const [agent, setAgent] = useState("");
  const [kind, setKind] = useState("");
  const [verdict, setVerdict] = useState(() => new URLSearchParams(window.location.hash.split("?")[1]).get("verdict") ?? "");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);

  const options = useMemo(() => {
    const rows = data ?? [];
    return { days: [...new Set(rows.map((r) => r[1]))].sort(), agents: [...new Set(rows.map((r) => r[2]))].sort() };
  }, [data]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (data ?? []).filter((r) =>
      (!day || r[1] === day) && (!agent || r[2] === agent) && (!kind || r[3] === kind) && (!verdict || r[4] === verdict) &&
      (!needle || r[5].toLowerCase().includes(needle) || r[2].toLowerCase().includes(needle)));
  }, [data, day, agent, kind, verdict, q]);

  if (!data) return <div className="wrap"><Loading error={error} /></div>;
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const at = Math.min(page, pages - 1);
  const set = (f: (v: string) => void) => (e: { target: { value: string } }) => { f(e.target.value); setPage(0); };

  return (
    <div className="wrap">
      <header className="hero" style={{ paddingBottom: 0 }}>
        <div className="eyebrow">Ledger</div>
        <h1>Every claim, with its receipt</h1>
        <p className="lede">{fmt(data.length)} claims the agents made in chat, each judged against the claiming agent’s own action log.</p>
      </header>
      <div className="filters" role="search">
        <select value={day} onChange={set(setDay)} aria-label="Day">
          <option value="">All days</option>
          {options.days.map((d) => <option key={d} value={d}>{dayLabel(d)}</option>)}
        </select>
        <select value={agent} onChange={set(setAgent)} aria-label="Agent">
          <option value="">All agents</option>
          {options.agents.map((a) => <option key={a}>{a}</option>)}
        </select>
        <select value={kind} onChange={set(setKind)} aria-label="Kind">
          <option value="">All kinds</option>
          {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
        <select value={verdict} onChange={set(setVerdict)} aria-label="Verdict">
          <option value="">All verdicts</option>
          {VERDICTS.map((v) => <option key={v} value={v}>{VERDICT_LABEL[v]}</option>)}
        </select>
        <input type="search" placeholder="Search claims, e.g. “commit”, “$115”, “DMs”" value={q} onChange={set(setQ)} aria-label="Search claims" />
      </div>
      <div className="muted small" style={{ marginBottom: 6 }}>{fmt(rows.length)} matching claims</div>
      <div className="claims">
        {rows.slice(at * PAGE, at * PAGE + PAGE).map((r) => <ClaimRow key={r[0]} r={r} />)}
        {rows.length === 0 && <div className="empty">No claims match these filters.</div>}
      </div>
      {pages > 1 && (
        <div className="pager">
          <button className="toggle" disabled={at === 0} onClick={() => setPage(at - 1)}>← Previous</button>
          <span className="muted small">Page {at + 1} of {fmt(pages)}</span>
          <button className="toggle" disabled={at >= pages - 1} onClick={() => setPage(at + 1)}>Next →</button>
        </div>
      )}
    </div>
  );
}
