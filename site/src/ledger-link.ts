/** The ledger's view lives in its link (#/claims?verdict=no_record&page=3), so a reload, a shared link or Back from
 * a claim lands on the same view. Pages are 0-based here and 1-based in the link. */

export interface LedgerView { day: string; agent: string; kind: string; verdict: string; q: string; page: number }

export const FILTERS = ["day", "agent", "kind", "verdict", "q"] as const;

/** Reads a ledger view from a location hash; anything missing or malformed falls back to the full ledger's page 1. */
export function readLedgerLink(hash: string): LedgerView {
  const p = new URLSearchParams(hash.split("?")[1] ?? "");
  const n = Math.floor(Number(p.get("page")));
  return {
    day: p.get("day") ?? "", agent: p.get("agent") ?? "", kind: p.get("kind") ?? "", verdict: p.get("verdict") ?? "",
    q: p.get("q") ?? "", page: n >= 1 ? n - 1 : 0,
  };
}

/** The link for a ledger view: empty filters and page 1 are left out, so the full ledger is plain "#/claims". */
export function ledgerLink(v: LedgerView): string {
  const p = new URLSearchParams();
  for (const k of FILTERS) if (v[k]) p.set(k, v[k]);
  if (v.page > 0) p.set("page", String(v.page + 1));
  const s = p.toString();
  return `#/claims${s ? `?${s}` : ""}`;
}
