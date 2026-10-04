/** Snapshot of the Delvetown audit for the site: node scripts/delve-snapshot.ts [--cached]
 * Reads the town live, checks every cited record and attributed quote, writes public/data/delve.json. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { audit, type CiteVerdict, type QuoteVerdict, type Town } from "../src/delve/check.ts";
import { fetchElsewhere, fetchTown, isAI } from "../src/delve/town.ts";

// --cached re-checks the last fetch instead of reading the town again
const cache = process.env.ALIBI_DATA_DIR ? `${process.env.ALIBI_DATA_DIR}/delve-town.json` : null;
const cached = process.argv.includes("--cached") && cache && existsSync(cache);
const town: Town = cached
  ? JSON.parse(readFileSync(cache, "utf-8"))
  : await fetchTown((done, total) => { if (done % 50 === 0 || done === total) console.log(`read ${done}/${total}`); });
for (const a of town.actors) a.ai = isAI(a.name, a.description);
if (cache && !cached) writeFileSync(cache, JSON.stringify(town));
const report = await audit(town, fetchElsewhere);

// The page shows full receipts for flagged citations; the rest keep their context and verdict
for (const c of report.citations) {
  if (c.verdict === "contradicted") continue;
  if (c.record) delete c.record.text;
  for (const d of c.details) d.found = d.found.slice(0, 80);
}
mkdirSync("public/data", { recursive: true });
writeFileSync("public/data/delve.json", JSON.stringify(report));

const tally = <T extends string>(xs: { verdict: T }[]) => xs.reduce<Record<string, number>>((m, x) => ((m[x.verdict] = (m[x.verdict] ?? 0) + 1), m), {});
const cross = report.citations.filter((c) => c.record && c.record.owner !== c.by);
const detailed = report.citations.filter((c) => c.details.length);
console.log(`${report.residents.length} residents, ${report.records} records, ${report.residents.reduce((n, r) => n + r.posts, 0)} posts, as of ${report.fetchedAt}`);
console.log("citations:", report.citations.length, tally<CiteVerdict>(report.citations), "by", new Set(report.citations.map((c) => c.by)).size, "residents");
console.log("  with a checkable detail:", detailed.length, tally<CiteVerdict>(detailed));
console.log("  of another resident's record:", cross.length, tally<CiteVerdict>(cross));
const byWhat: Record<string, [number, number]> = {};
for (const c of report.citations) for (const d of c.details) { byWhat[d.what] ??= [0, 0]; byWhat[d.what][0]++; if (d.ok) byWhat[d.what][1]++; }
console.log("  details checked / matching:", byWhat);
console.log("quotes attributed to another resident:", report.quotes.length, tally<QuoteVerdict>(report.quotes));
