import { useEffect, useMemo, useRef, useState } from "react";
import { ClaimRow, Loading } from "../components";
import { ledgerLink, readLedgerLink } from "../ledger-link";
import { KINDS, VERDICTS, VERDICT_LABEL, dayLabel, fmt, useData, type IndexRow } from "../lib";

const PAGE = 50;

/** The clipboard API needs focus and permission; the hidden-textarea copy covers browsers that refuse it. */
async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall back below */ }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  try { return document.execCommand("copy"); } catch { return false; } finally { ta.remove(); }
}

export default function Claims() {
  const { data, error } = useData<IndexRow[]>("index.json");
  const [start] = useState(() => readLedgerLink(window.location.hash));
  const [day, setDay] = useState(start.day);
  const [agent, setAgent] = useState(start.agent);
  const [kind, setKind] = useState(start.kind);
  const [verdict, setVerdict] = useState(start.verdict);
  const [q, setQ] = useState(start.q);
  const [page, setPage] = useState(start.page);
  const [copied, setCopied] = useState<"" | "ok" | "fail">("");
  const listTop = useRef<HTMLDivElement>(null);

  // The "Ledger" link (#/claims) or Back/Forward between ledger views re-reads the link
  useEffect(() => {
    const onHash = () => {
      if (!window.location.hash.startsWith("#/claims")) return;
      const v = readLedgerLink(window.location.hash);
      setDay(v.day); setAgent(v.agent); setKind(v.kind); setVerdict(v.verdict); setQ(v.q); setPage(v.page);
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
    const hash = ledgerLink({ day, agent, kind, verdict, q, page: at });
    if (window.location.hash !== hash) history.replaceState(history.state, "", hash);
  }, [data, day, agent, kind, verdict, q, at]);

  // "Link copied" belongs to the view it copied
  useEffect(() => setCopied(""), [day, agent, kind, verdict, q, at]);

  if (!data) return <div className="wrap"><Loading error={error} /></div>;
  const set = (f: (v: string) => void) => (e: { target: { value: string } }) => { f(e.target.value); setPage(0); };
  // A new page starts at its first row, not wherever the last page was scrolled to
  const turn = (to: number) => { setPage(to); listTop.current?.scrollIntoView({ block: "start" }); };

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
      <div className="row muted small" style={{ marginBottom: 6, scrollMarginTop: 72 }} ref={listTop}>
        <span>{fmt(rows.length)} matching claims</span>
        <span className="spacer" />
        <span role="status">{copied === "ok" ? "Link copied" : copied === "fail" ? "Couldn’t copy: the link is in the address bar" : ""}</span>
        <button className="toggle" onClick={async () => setCopied(await copyText(window.location.href) ? "ok" : "fail")}>
          Copy link to this view
        </button>
      </div>
      <div className="claims">
        {rows.slice(at * PAGE, at * PAGE + PAGE).map((r) => <ClaimRow key={r[0]} r={r} />)}
        {rows.length === 0 && <div className="empty">No claims match these filters.</div>}
      </div>
      {pages > 1 && (
        <div className="pager">
          <button className="toggle" disabled={at === 0} onClick={() => turn(at - 1)}>← Previous</button>
          <span className="muted small">Page {at + 1} of {fmt(pages)}</span>
          <button className="toggle" disabled={at >= pages - 1} onClick={() => turn(at + 1)}>Next →</button>
        </div>
      )}
    </div>
  );
}
