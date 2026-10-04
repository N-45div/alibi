import { useMemo, useState } from "react";
import { Loading, Tile, VerdictIcon } from "../components";
import { fmt, pct, useData } from "../lib";
import { audit, type Citation, type CiteVerdict, type Detail, type Report } from "../delve/check.ts";
import { PDS, fetchElsewhere, fetchTown } from "../delve/town.ts";

const ORDER: CiteVerdict[] = ["backed", "deleted", "no_record", "contradicted"];
const LABEL: Record<CiteVerdict, string> = {
  backed: "Resolves", deleted: "Gone, as stated", no_record: "No record", contradicted: "Contradicted",
};
const HELP: Record<CiteVerdict, string> = {
  backed: "The cited record exists, and every detail the post gives about it (owner, time, kind, quoted words) matches.",
  deleted: "The record isn't there, and the post itself says it was deleted or retracted.",
  no_record: "No record with that key in the town: deleted without saying so, or kept on another server.",
  contradicted: "The record exists but a detail differs: the address, owner, time or words, or the post calls it gone while it is still there.",
};
const ICON = { backed: "backed", deleted: "not_checkable", no_record: "no_record", contradicted: "contradicted" } as const;
const PAGE = 40;
// Flags grouped by what the record contradicts, most telling first
const KINDS: [Detail["what"], string, string][] = [
  ["exists", "record called deleted that is still there", "records called deleted that are still there"],
  ["address", "link to the wrong record", "links to the wrong record"],
  ["owner", "record credited to the wrong resident", "records credited to the wrong resident"],
  ["quote", "misquote", "misquotes"], ["kind", "record of the wrong kind", "records of the wrong kind"],
  ["time", "time that is off", "times that are off"],
];

const short = (h: string) => h.replace(/\.delve\.town$/, "");
const parts = (uri: string) => uri.replace(/^at:\/\//, "").split("/");
const rawUrl = (uri: string) => { const [did, coll, rkey] = parts(uri); return `${PDS}/xrpc/com.atproto.repo.getRecord?repo=${did}&collection=${coll}&rkey=${rkey}`; };
const postUrl = (uri: string) => { const [did, , rkey] = parts(uri); return `https://delve.town/profile/${did}/post/${rkey}`; };
const utc = (iso: string) => (iso ? `${iso.slice(5, 10)} ${iso.slice(11, 16)} UTC` : "");

function explain(d: Detail): string {
  switch (d.what) {
    case "address": return `The link points to ${d.said}; the record is ${d.found}.`;
    case "exists": return `The post says this record is gone; it is ${d.found}.`;
    case "time": return `The post gives ${d.said} UTC; the record was made at ${d.found} UTC.`;
    case "owner": return `The post attributes it to ${d.said}; the record is ${d.found}'s.`;
    case "kind": return `The post calls it a ${d.said}; it is a ${d.found}.`;
    case "quote": return "The quoted words aren't in the record.";
  }
}

function Tag({ v }: { v: CiteVerdict }) {
  return <span className="verdict" title={HELP[v]}><VerdictIcon v={ICON[v]} />{LABEL[v]}</span>;
}

/** The post's words around the cited key, with the key marked. */
function Context({ text, mark }: { text: string; mark: string }) {
  const i = text.indexOf(mark);
  if (i < 0) return <>{text}</>;
  return <>…{text.slice(0, i)}<mark>{mark}</mark>{text.slice(i + mark.length)}…</>;
}

function Flag({ c, fresh }: { c: Citation; fresh?: boolean }) {
  return (
    <div className="card flag">
      <div className="row small muted">
        <b className="who">{short(c.by)}</b><span>{utc(c.at)}</span>
        {fresh && <span className="fresh" title="Found by this live check; not in the snapshot we read by hand">New, not yet reviewed</span>}
        <span className="spacer" />
        <a href={postUrl(c.post)} target="_blank" rel="noreferrer">Post ↗</a>
      </div>
      <p className="ctx"><Context text={c.context} mark={c.rkey} /></p>
      {c.details.filter((d) => !d.ok).map((d) => <p className="why" key={d.what}>{explain(d)}</p>)}
      {c.record && (
        <>
          <div className="receipt" style={{ marginTop: 10 }}>
            <span className="ts">{c.record.collection.split(".").pop()} by {short(c.record.owner)} · {utc(c.record.at)}</span>
            {c.record.text && <>{"\n"}{c.record.text.length > 500 ? c.record.text.slice(0, 500) + "…" : c.record.text}</>}
          </div>
          <div className="small" style={{ marginTop: 8 }}><a href={rawUrl(c.record.uri)} target="_blank" rel="noreferrer">The signed record ↗</a></div>
        </>
      )}
    </div>
  );
}

export default function Town() {
  const { data, error } = useData<Report>("delve.json");
  const [live, setLive] = useState<Report | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [who, setWho] = useState("");
  const [verdict, setVerdict] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  const r = live ?? data;

  const rows = useMemo(() => {
    const m = new Map<string, { by: string; n: number; others: number; v: Record<CiteVerdict, number>; quotes: number; verbatim: number }>();
    const row = (by: string) => {
      if (!m.has(by)) m.set(by, { by, n: 0, others: 0, v: { backed: 0, deleted: 0, no_record: 0, contradicted: 0 }, quotes: 0, verbatim: 0 });
      return m.get(by)!;
    };
    for (const c of r?.citations ?? []) {
      const x = row(c.by);
      x.n++; x.v[c.verdict]++;
      if (c.record && c.record.owner !== c.by) x.others++;
    }
    for (const qc of r?.quotes ?? []) { const x = row(qc.by); x.quotes++; if (qc.verdict === "verbatim") x.verbatim++; }
    return [...m.values()].sort((a, b) => b.n - a.n);
  }, [r]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (r?.citations ?? []).filter((c) => (!who || c.by === who) && (!verdict || c.verdict === verdict) &&
      (!needle || c.context.toLowerCase().includes(needle) || c.rkey.includes(needle)));
  }, [r, who, verdict, q]);

  if (!r) return <div className="wrap"><Loading error={error} /></div>;

  async function runLive() {
    setBusy(true);
    try {
      const town = await fetchTown((done, total) => setStatus(`Reading the town: ${done} of ${total} requests`));
      setStatus("Checking every citation…");
      setLive(await audit(town, fetchElsewhere));
      setStatus(null);
    } catch (e) {
      setStatus(`Could not read the town: ${(e as Error).message}`);
    }
    setBusy(false);
  }

  const cites = r.citations;
  const count = (v: CiteVerdict) => cites.filter((c) => c.verdict === v).length;
  const firstBad = (c: Citation) => KINDS.findIndex(([w]) => c.details.some((d) => d.what === w && !d.ok));
  const flags = cites.filter((c) => c.verdict === "contradicted").sort((a, b) => firstBad(a) - firstBad(b) || a.at.localeCompare(b.at));
  // Flags in the published snapshot were read by hand; a live check can find new ones
  const reviewed = new Set((data?.citations ?? []).filter((c) => c.verdict === "contradicted").map((c) => c.post + c.rkey));
  const byKind = KINDS.map(([w, one, many]) => {
    const n = flags.filter((c) => c.details.some((d) => d.what === w && !d.ok)).length;
    return [n, n === 1 ? one : many] as const;
  }).filter(([n]) => n > 0);
  const posts = r.residents.reduce((n, x) => n + x.posts, 0);
  const citers = new Set(cites.map((c) => c.by)).size;
  const near = cites.flatMap((c) => c.details.filter((d) => d.what === "quote"));
  const odd = r.quotes.filter((x) => x.verdict !== "verbatim");
  const pages = Math.max(1, Math.ceil(shown.length / PAGE));
  const at = Math.min(page, pages - 1);
  const set = (f: (v: string) => void) => (e: { target: { value: string } }) => { f(e.target.value); setPage(0); };

  return (
    <div className="wrap">
      <header className="hero">
        <div className="eyebrow">Second swarm · Delvetown by Grove Research · live</div>
        <h1>A town that cites its receipts</h1>
        <p className="lede">
          Delvetown is Grove Research’s human–AI town on the AT Protocol. Every post, like and follow is a signed record in its author’s
          public repo, and the AI residents cite those records all the time: “liked it (like record 3mwubjfaepa26)”, “mimo’s reply
          (3mwubbolyzy26, 01:54)”. Alibi checks every citation against the record itself. No model is involved, only the signed record.
        </p>
        <div className="live">
          <button className="primary" onClick={runLive} disabled={busy}>{busy ? "Checking…" : "Check the town now"}</button>
          <span className="muted small">
            {status ?? <>{live ? "Live check" : "Snapshot"} of {r.fetchedAt.slice(0, 16).replace("T", " ")} UTC · {r.residents.length} residents ·{" "}
              {fmt(posts)} posts · {fmt(r.records)} records. The live check runs in your browser against <code>pds.delve.town</code>.</>}
          </span>
        </div>
      </header>

      <section>
        <div className="grid tiles">
          <Tile label="Record citations checked" value={fmt(cites.length)} note={`in residents’ posts, by ${citers} AI residents`} />
          <Tile label="Resolve, every detail matching" value={pct(count("backed"), cites.length, 1)} note={`${fmt(count("backed"))} citations`} />
          <Tile label="Gone, as the post says" value={fmt(count("deleted"))} note={`${fmt(count("no_record"))} more point at no record`} />
          <Tile label="Contradicted by the record" value={fmt(flags.length)} note="each one below, with its signed record" />
        </div>
      </section>

      <section>
        <div className="card callout">
          <p style={{ margin: 0 }}>
            <strong>Two swarms, one lesson.</strong> In the AI Village, 28.8% of agents’ claims about their own work had no receipt in
            their own logs. Delvetown’s residents attach the receipt to the claim, a pointer to a signed record, and{" "}
            {pct(count("backed"), cites.length)} of those pointers resolve with every detail matching; most of the rest point at records the
            post itself says were deleted. The measures differ, but the lesson is the same: a swarm can check itself when its norm is to
            point at the record.
          </p>
        </div>
      </section>

      <section>
        <h2>What the record contradicts</h2>
        <p className="sub">
          {flags.length ? <>{fmt(flags.length)} citations where the signed record disagrees with the post:{" "}
            {byKind.map(([n, label], i) => <span key={label}>{i ? (i === byKind.length - 1 ? " and " : ", ") : ""}{n} {label}</span>)}.{" "}</> : null}
          The checks are mechanical, so read each flag next to its record.
        </p>
        {flags.length ? (
          <div className="flags">{flags.map((c) => <Flag key={c.post + c.rkey} c={c} fresh={!!live && !reviewed.has(c.post + c.rkey)} />)}</div>
        ) : <div className="empty">No citation in this check is contradicted by its record.</div>}
      </section>

      <section>
        <h2>Quotes</h2>
        <p className="sub">
          {near.length ? <>{fmt(near.filter((d) => d.ok).length)} of {fmt(near.length)} quotes placed next to a citation match the cited
            record word for word{near.some((d) => d.close) ? " or with words trimmed" : ""}. </> : null}
          {fmt(r.quotes.length - odd.length)} of {fmt(r.quotes.length)} quotes attributed to another resident by name are verbatim in
          something that resident had posted before.
          {odd.length > 0 && <> The rest:</>}
        </p>
        {odd.length > 0 && (
          <div className="card"><ul className="list">{odd.map((x) => (
            <li key={x.post + x.quote}>
              <span className="muted small">{short(x.by)} quoting {short(x.speaker)} · {utc(x.at)} · </span>“{x.quote}”
              <span className="muted small"> · {x.verdict === "close" ? "the words are there, trimmed or reordered" : "not in their posts"}</span>
              {x.source && <> · <a className="small" href={rawUrl(x.source)} target="_blank" rel="noreferrer">closest record ↗</a></>}
            </li>
          ))}</ul></div>
        )}
      </section>

      <section>
        <h2>Who cites what</h2>
        <div className="card table-wrap">
          <table>
            <thead><tr><th>Resident</th><th className="num">Citations</th><th className="num">Of others’ records</th>
              {ORDER.map((v) => <th className="num" key={v}>{LABEL[v]}</th>)}<th className="num">Quotes verbatim</th></tr></thead>
            <tbody>{rows.map((x) => (
              <tr key={x.by}><td>{short(x.by)}</td><td className="num">{fmt(x.n)}</td><td className="num">{fmt(x.others)}</td>
                {ORDER.map((v) => <td className="num" key={v}>{fmt(x.v[v])}</td>)}
                <td className="num">{x.quotes ? `${x.verbatim} of ${x.quotes}` : "–"}</td></tr>
            ))}</tbody>
          </table>
        </div>
      </section>

      <section>
        <h2>How the check works</h2>
        <div className="prose">
          <ul>
            <li><strong>Read, don’t ask.</strong> Alibi lists every repo on <code>pds.delve.town</code> and reads its posts, likes, reposts
              and follows through the public AT Protocol API. Records hosted elsewhere are resolved through the DID directory.</li>
            <li><strong>Find the citations.</strong> Record keys (13-character TIDs), <code>at://</code> URIs and delve.town links in each post.</li>
            <li><strong>Check what the post says about each one.</strong> The address (repo and record type), the owner (“luna’s filing”,
              “my reply”), the time given next to it, its kind (“like record”), the quoted words, and whether it still exists when the
              post calls it deleted.</li>
            <li><strong>No record isn’t fabricated.</strong> Residents delete posts, and most missing records are ones the post itself
              reports as deleted. The town’s server shows the present state, not its history.</li>
            <li><strong>Read-only, and people aren’t quoted.</strong> Alibi never posts or interacts. Only AI accounts’ words are reproduced;
              people’s records are linked, not copied.</li>
          </ul>
        </div>
      </section>

      <section>
        <h2>Every citation</h2>
        <div className="filters" role="search">
          <select value={who} onChange={set(setWho)} aria-label="Resident">
            <option value="">All residents</option>
            {rows.map((x) => <option key={x.by} value={x.by}>{short(x.by)}</option>)}
          </select>
          <select value={verdict} onChange={set(setVerdict)} aria-label="Verdict">
            <option value="">All verdicts</option>
            {ORDER.map((v) => <option key={v} value={v}>{LABEL[v]}</option>)}
          </select>
          <input type="search" placeholder="Search the posts, e.g. “errata”, “minutes”, a record key" value={q} onChange={set(setQ)} aria-label="Search citations" />
        </div>
        <div className="muted small" style={{ marginBottom: 6 }}>{fmt(shown.length)} citations</div>
        <div className="claims">
          {shown.slice(at * PAGE, at * PAGE + PAGE).map((c) => (
            <div className="cite-row" key={c.post + c.rkey}>
              <div className="meta">{utc(c.at)}<br />{short(c.by)}</div>
              <div className="ctx"><Context text={c.context} mark={c.rkey} />{" "}
                <a className="small" href={postUrl(c.post)} target="_blank" rel="noreferrer">post ↗</a>
                {c.record && <> · <a className="small" href={rawUrl(c.record.uri)} target="_blank" rel="noreferrer">{c.record.collection.split(".").pop()} by {short(c.record.owner)} ↗</a></>}
              </div>
              <div><Tag v={c.verdict} /></div>
            </div>
          ))}
          {shown.length === 0 && <div className="empty">No citations match these filters.</div>}
        </div>
        {pages > 1 && (
          <div className="pager">
            <button className="toggle" disabled={at === 0} onClick={() => setPage(at - 1)}>← Previous</button>
            <span className="muted small">Page {at + 1} of {fmt(pages)}</span>
            <button className="toggle" disabled={at >= pages - 1} onClick={() => setPage(at + 1)}>Next →</button>
          </div>
        )}
      </section>
    </div>
  );
}
