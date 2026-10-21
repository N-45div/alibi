import { useEffect, useMemo, useState } from "react";
import { ClaimRow, Loading } from "../components";
import { KINDS, VERDICTS, VERDICT_LABEL, dayLabel, fmt, useData, type IndexRow } from "../lib";

const PAGE = 50;
const FILTERS = ["day", "agent", "kind", "verdict", "q"] as const;

/** Filters and the page live in the link (#/claims?q=colony&verdict=no_record&page=2), so a shared link, a reload
 * or Back from a claim lands on the same view. */
const param = (name: string) => new URLSearchParams(window.location.hash.split("?")[1] ?? "").get(name) ?? "";
const pageParam = () => { const n = Math.floor(Number(param("page"))); return n >= 1 ? n - 1 : 0; };

export default function Claims() {
  const { data, error } = useData<IndexRow[]>("index.json");
  const [day, setDay] = useState(() => param("day"));
  const [agent, setAgent] = useState(() => param("agent"));
  const [kind, setKind] = useState(() => param("kind"));
  const [verdict, setVerdict] = useState(() => param("verdict"));
  const [q, setQ] = useState(() => param("q"));
  const [page, setPage] = useState(pageParam);

  // The "Ledger" link (#/claims) or Back/Forward between ledger views re-reads the link
  useEffect(() => {
    const onHash = () => {
      if (!window.location.hash.startsWith("#/claims")) return;
      setDay(param("day")); setAgent(param("agent")); setKind(param("kind")); setVerdict(param("verdict"));
      setQ(param("q")); setPage(pageParam());
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

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

  // A stale or hand-edited link can name a day, agent, kind or verdict the data doesn't have: drop it, rather than
  // show an empty ledger under a select that reads "All"
  useEffect(() => {
    if (!data) return;
    if (day && !options.days.includes(day)) setDay("");
    if (agent && !options.agents.includes(agent)) setAgent("");
    if (kind && !(KINDS as string[]).includes(kind)) setKind("");
    if (verdict && !(VERDICTS as string[]).includes(verdict)) setVerdict("");
  }, [data, options, day, agent, kind, verdict]);

  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const at = Math.min(page, pages - 1);

  // Write the view back into the link without a hashchange, so typing doesn't scroll or add history entries.
  // Waits for the data: until then every link would look like page 1.
  useEffect(() => {
    if (!data) return;
    const values = { day, agent, kind, verdict, q };
    const p = new URLSearchParams();
    for (const k of FILTERS) if (values[k]) p.set(k, values[k]);
    if (at > 0) p.set("page", String(at + 1));
    const s = p.toString();
    const hash = `#/claims${s ? `?${s}` : ""}`;
    if (window.location.hash !== hash) history.replaceState(history.state, "", hash);
  }, [data, day, agent, kind, verdict, q, at]);

  if (!data) return <div className="wrap"><Loading error={error} /></div>;
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
