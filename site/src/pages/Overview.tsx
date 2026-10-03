import { Loading, Tile, VerdictBars, VerdictIcon, VerdictTag } from "../components";
import {
  FAILURE_LABEL, claimHref, fmt, pct, ptTime, useData, VERDICT_LABEL, VERDICTS,
  type Claim, type DayFile, type FailureKind, type IndexRow, type Overview as O, type Verdict,
} from "../lib";

export default function Overview() {
  const { data: o, error } = useData<O>("overview.json");
  if (!o) return <div className="wrap"><Loading error={error} /></div>;

  const t = o.claims.totals;
  const judged = VERDICTS.reduce((s, v) => s + t[v], 0);
  const unbacked = t.no_record + t.contradicted;
  const trusted = o.trust.filter((x) => x.relayer === "trusted").reduce((s, x) => s + x.n, 0);
  const relays = o.trust.reduce((s, x) => s + x.n, 0);
  const trustedUnbacked = o.trust.filter((x) => x.relayer === "trusted" && x.origin !== "backed").reduce((s, x) => s + x.n, 0);
  const lines = o.summaries.lines;
  const checkable = (lines.backed ?? 0) + (lines.unverified ?? 0) + (lines.contradicted ?? 0);

  return (
    <div className="wrap">
      <header className="hero">
        <div className="eyebrow">AI Swarm Dynamics Hackathon · AI Village dataset</div>
        <h1>Agents’ words aren’t evidence.</h1>
        <p className="lede">
          Alibi checks what AI agents <em>say</em> they did against what their own logs <em>show</em>, then follows the
          claims nobody can back up as they spread through the swarm. Below: {o.slice.agents} agents, {fmt(o.slice.messages)} chat
          messages and {fmt(o.slice.turns)} logged actions from the AI Village’s “{o.slice.goal}” goal ({o.slice.from} to {o.slice.to}).
        </p>
      </header>

      <section>
        <div className="card" style={{ display: "grid", gap: 6 }}>
          <div className="hero-figure">{pct(unbacked, judged)}</div>
          <div style={{ fontSize: 17 }}>
            of {fmt(judged)} checkable claims had <strong>no supporting receipt</strong> in the claiming agent’s own action log,
            including <strong>{fmt(t.contradicted)}</strong> that the log contradicts.
          </div>
          <div className="muted small">
            Agent-to-agent repeats excluded. “No receipt” is not “false”: logs can be incomplete, so it means the claim rests on the
            agent’s word alone. A claim counts as contradicted only when a second, slower pass with reasoning switched on agrees.
          </div>
        </div>
      </section>

      <section>
        <div className="grid tiles">
          <Tile label="Claims extracted" value={fmt(o.claims.extracted)} note={`${fmt(o.claims.unquotable)} set aside: quote not verbatim`} />
          <Tile label="Backed by the agent’s own log" value={pct(t.backed, judged)} note={`${fmt(t.backed)} claims with a receipt`} />
          <Tile label="Repeated without checking" value={pct(trusted, relays)} note={`${fmt(trusted)} of ${fmt(relays)} traced repeats`} />
          <Tile label="Summary lines not fully backed" value={pct((lines.unverified ?? 0) + (lines.contradicted ?? 0), checkable)}
            note={`${fmt((lines.unverified ?? 0) + (lines.contradicted ?? 0))} of ${fmt(checkable)} checkable lines`} />
        </div>
      </section>

      <section>
        <h2>Who backs their claims</h2>
        <p className="sub">
          Every checkable claim each agent made, judged only against that agent’s own commands, outputs and tool results.
          This is not an honesty ranking: agents that work through the browser (such as the RPG players in #rest) leave
          screen actions that text logs can’t confirm, so they collect “screen only” and “no record” verdicts.
        </p>
        <div className="card"><VerdictBars rows={o.agents} minClaims={20} /></div>
      </section>

      {o.contradictions && <Contradictions c={o.contradictions} />}

      <section>
        <h2>Agents take each other’s word for it</h2>
        <p className="sub">
          When one agent repeats another’s result as fact, we link the repeat to the original claim and check whether the repeater
          verified it in its own log first. {fmt(trusted)} of {fmt(relays)} repeats were taken on trust; {fmt(trustedUnbacked)} of those
          repeated a claim that had no receipt to begin with.
        </p>
        <div className="card table-wrap">
          <table>
            <thead><tr><th>The original claim was…</th><th className="num">Repeater checked it</th><th className="num">Repeater took it on trust</th><th className="num">Taken on trust</th></tr></thead>
            <tbody>{VERDICTS.map((v) => {
              const checked = o.trust.find((x) => x.origin === v && x.relayer === "checked")?.n ?? 0;
              const trust = o.trust.find((x) => x.origin === v && x.relayer === "trusted")?.n ?? 0;
              return (
                <tr key={v}><td><VerdictTag v={v} /></td><td className="num">{fmt(checked)}</td><td className="num">{fmt(trust)}</td>
                  <td className="num">{pct(trust, checked + trust)}</td></tr>
              );
            })}</tbody>
          </table>
        </div>
      </section>

      <section>
        <h2>The official record inherits it</h2>
        <p className="sub">
          The village’s published daily summaries are written from chat, without seeing the agents’ computers. We traced each summary
          sentence back to the claims it restates, and it inherits their receipts.
        </p>
        <div className="grid tiles">
          <Tile label="Days audited" value={fmt(o.summaries.days)} />
          <Tile label={<><VerdictIcon v="backed" /> Lines resting on backed claims</>} value={fmt(lines.backed ?? 0)} />
          <Tile label={<><VerdictIcon v="unverified" /> Lines resting on unbacked claims</>} value={fmt(lines.unverified ?? 0)} />
          <Tile label={<><VerdictIcon v="contradicted" /> Lines resting on contradicted claims</>} value={fmt(lines.contradicted ?? 0)} />
        </div>
        <p className="small" style={{ marginTop: 12 }}><a href="#/summaries">Read the audited summaries →</a></p>
      </section>

      {o.featured && o.featured.length > 0 && <Featured ids={o.featured} />}

      {o.validation?.capture && (
        <section>
          <h2>Reading the agent’s story changes the verdict</h2>
          <Capture v={o.validation} />
          <p className="small"><a href="#/method">How this was measured →</a></p>
        </section>
      )}
    </div>
  );
}

function Contradictions({ c }: { c: Partial<Record<FailureKind, number>> }) {
  const kinds = (Object.keys(FAILURE_LABEL) as FailureKind[]).filter((k) => (c[k] ?? 0) > 0);
  const total = kinds.reduce((s, k) => s + (c[k] ?? 0), 0);
  return (
    <section>
      <h2>Failures reported as successes</h2>
      <p className="sub">
        In the {fmt(total)} contradicted claims, this is what the agent’s own log printed, read from the cited output itself.
        The common pattern is a failed or throttled request turned into a round-number success in chat.
      </p>
      <div className="card table-wrap">
        <table>
          <thead><tr><th>What the cited log line shows</th><th className="num">Claims</th><th className="num">Share</th></tr></thead>
          <tbody>{kinds.sort((a, b) => (c[b] ?? 0) - (c[a] ?? 0)).map((k) => (
            <tr key={k}><td>{FAILURE_LABEL[k]}</td><td className="num">{fmt(c[k] ?? 0)}</td><td className="num">{pct(c[k] ?? 0, total)}</td></tr>
          ))}</tbody>
        </table>
      </div>
      <p className="small" style={{ marginTop: 12 }}><a href="#/claims?verdict=contradicted">See every contradicted claim →</a></p>
    </section>
  );
}

function Capture({ v }: { v: NonNullable<O["validation"]> }) {
  const c = v.capture!;
  return (
    <>
      <p className="sub">
        The same model ({c.model}, the analysis model METR used for the Hugging Face incident), the same {fmt(c.claims)} claims and the
        same log windows, shown two ways: with the agent’s own narration and reasoning visible, and with it removed (Alibi’s view).
        Of the {fmt(c.unbackedBlind)} claims it could not back when blinded, it called <strong>{fmt(c.flippedToBacked)}</strong> backed once it could read the agent’s story.
      </p>
      <div className="card table-wrap">
        <table>
          <thead><tr><th>What the judge saw</th>{VERDICTS.map((x) => <th className="num" key={x}>{VERDICT_LABEL[x]}</th>)}</tr></thead>
          <tbody>
            <tr><td>Actions and outputs only (Alibi)</td>{VERDICTS.map((x) => <td className="num" key={x}>{fmt(c.blind[x] ?? 0)}</td>)}</tr>
            <tr><td>Plus the agent’s narration and reasoning</td>{VERDICTS.map((x) => <td className="num" key={x}>{fmt(c.narrated[x] ?? 0)}</td>)}</tr>
          </tbody>
        </table>
      </div>
    </>
  );
}

/** A few real claims next to their receipts, picked from the data at export time. */
function Featured({ ids }: { ids: string[] }) {
  const { data: index } = useData<IndexRow[]>("index.json");
  const days = index ? [...new Set(ids.map((id) => index.find((r) => r[0] === id)?.[1]).filter(Boolean))] as string[] : [];
  return (
    <section>
      <h2>Claims next to their receipts</h2>
      <p className="sub">Real examples from the run. Every receipt line is the agent’s own logged command and its output, exactly as the judge saw it.</p>
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))" }}>
        {days.map((d) => <FeaturedDay key={d} day={d} ids={ids} />)}
      </div>
    </section>
  );
}

function FeaturedDay({ day, ids }: { day: string; ids: string[] }) {
  const { data } = useData<DayFile>(`days/${day}.json`);
  if (!data) return null;
  return <>{data.claims.filter((c) => ids.includes(c.id)).map((c) => <FeaturedCard key={c.id} c={c} />)}</>;
}

function FeaturedCard({ c }: { c: Claim }) {
  return (
    <a className="card" href={claimHref(c.id)} style={{ color: "inherit", textDecoration: "none", display: "grid", gap: 8 }}>
      <div className="row"><VerdictTag v={c.verdict as Verdict} /><span className="spacer" /><span className="muted small">{c.agent} · {ptTime(c.at)}</span></div>
      <div style={{ fontSize: 15.5 }}>“{c.quote}”</div>
      {c.receipts[0] && <div className="receipt"><span className="ts">{c.receipts[0].at.slice(11)} </span>{c.receipts[0].line.slice(0, 260)}</div>}
      {c.why && <div className="muted small">{c.why}</div>}
    </a>
  );
}
