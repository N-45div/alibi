/** The published data has to agree with itself: the overview's totals, the ledger, the per-day files, the audited
 * summaries and the Delvetown audit are separate files, and a bad export or a truncated copy breaks one of them.
 * Reads public/data, which `npm run data` fills on a fresh checkout. */
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const load = (f: string) => JSON.parse(readFileSync(`public/data/${f}`, "utf-8"));
type Row = [id: string, day: string, agent: string, kind: string, verdict: string, claim: string];
const index: Row[] = load("index.json");
const overview = load("overview.json");
const summaries: { date: string; lines: { status: string; claims: string[] }[] }[] = load("summaries.json");
const delve = load("delve.json");
const days = readdirSync("public/data/days").map((f) => load(`days/${f}`));
const byId = new Map(index.map((r) => [r[0], r]));
const count = <T,>(xs: T[], key: (x: T) => string) => xs.reduce<Record<string, number>>((m, x) => ((m[key(x)] = (m[key(x)] ?? 0) + 1), m), {});

describe("the ledger", () => {
  it("holds every extracted claim except the ones set aside for a non-verbatim quote", () => {
    expect(index).toHaveLength(overview.claims.extracted - overview.claims.unquotable);
    expect(new Set(index.map((r) => r[0])).size).toBe(index.length);
  });

  it("matches the overview's verdict totals once agent-to-agent repeats are left out", () => {
    const own = index.filter((r) => r[3] !== "relay");
    expect(count(own, (r) => r[4])).toEqual(overview.claims.totals);
  });

  it("agrees row for row with the per-day files the claim pages read", () => {
    expect(days.reduce((n, d) => n + d.claims.length, 0)).toBe(index.length);
    for (const d of days) {
      const here = new Map<string, { verdict: string; agent: string; kind: string }>(d.claims.map((c: { id: string }) => [c.id, c]));
      for (const r of index.filter((x) => x[1] === d.day)) {
        expect(here.get(r[0]), r[0]).toMatchObject({ verdict: r[4], agent: r[2], kind: r[3] });
      }
    }
  });

  it("links every traced repeat both ways, as many as the overview reports", () => {
    type Claim = { id: string; kind: string; relayOf: string | null; relayedBy?: { id: string }[] };
    const claims: Claim[] = days.flatMap((d) => d.claims);
    const repeats = claims.filter((c) => c.relayOf);
    const traced = (overview.trust as { n: number }[]).reduce((n, t) => n + t.n, 0);
    expect(repeats.length).toBe(traced);
    expect(repeats.every((c) => c.kind === "relay")).toBe(true);
    // the original lists the repeat under "Repeated by other agents"
    const origin = new Map(claims.map((c) => [c.id, c]));
    for (const c of repeats) expect(origin.get(c.relayOf!)?.relayedBy?.map((r) => r.id), c.id).toContain(c.id);
  });
});

describe("the audited summaries", () => {
  const lines = summaries.flatMap((d) => d.lines);

  it("only point at claims that are in the ledger", () => {
    expect(lines.flatMap((l) => l.claims).filter((c) => !byId.has(c))).toEqual([]);
  });

  it("give each sentence the status its claims earn", () => {
    for (const l of lines) {
      const v = new Set(l.claims.map((c) => byId.get(c)![4]));
      const want = !v.size ? "not_checkable" : v.has("contradicted") ? "contradicted"
        : [...v].every((x) => x === "backed") ? "backed" : "unverified";
      expect(l.status, l.claims.join(",")).toBe(want);
    }
  });

  it("add up to the overview's summary figures", () => {
    expect(count(lines, (l) => l.status)).toEqual(overview.summaries.lines);
  });
});

describe("the Delvetown audit", () => {
  type Cite = { verdict: string; details: { ok: boolean }[]; record?: unknown };
  const cites: Cite[] = delve.citations;

  it("calls a citation contradicted exactly when one of its details fails", () => {
    for (const c of cites) expect(c.verdict === "contradicted").toBe(c.details.some((d) => !d.ok));
  });

  it("shows the record for every citation it found, and none for the ones it didn't", () => {
    for (const c of cites) expect(!!c.record).toBe(c.verdict === "backed" || c.verdict === "contradicted");
  });

  it("only uses the four verdicts the page explains", () => {
    expect(Object.keys(count(cites, (c) => c.verdict)).sort()).toEqual(["backed", "contradicted", "deleted", "no_record"]);
  });
});
