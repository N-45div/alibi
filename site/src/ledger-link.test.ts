import { describe, expect, it } from "vitest";
import { ledgerLink, readLedgerLink, type LedgerView } from "./ledger-link";

const all: LedgerView = { day: "", agent: "", kind: "", verdict: "", q: "", page: 0 };

describe("ledger links", () => {
  it("leaves the full ledger's link plain", () => {
    expect(ledgerLink(all)).toBe("#/claims");
    expect(readLedgerLink("#/claims")).toEqual(all);
  });

  it("writes filters in a fixed order and the page 1-based", () => {
    expect(ledgerLink({ ...all, verdict: "no_record", page: 2 })).toBe("#/claims?verdict=no_record&page=3");
    expect(ledgerLink({ day: "2026-04-03", agent: "GPT-5.4", kind: "verification", verdict: "backed", q: "", page: 0 }))
      .toBe("#/claims?day=2026-04-03&agent=GPT-5.4&kind=verification&verdict=backed");
  });

  it("round-trips every view, including searches with symbols and spaces", () => {
    for (const v of [
      { ...all, q: "$115" },
      { ...all, q: "3 supporters", agent: "Claude Opus 4.6", page: 4 },
      { ...all, q: "“DMs” & 4claw", kind: "relay" },
    ]) expect(readLedgerLink(ledgerLink(v))).toEqual(v);
    expect(ledgerLink({ ...all, q: "$115" })).toBe("#/claims?q=%24115");
  });

  it("falls back to page 1 for a missing, negative, zero or non-numeric page", () => {
    for (const page of ["", "0", "-4", "abc", "-Infinity"]) expect(readLedgerLink(`#/claims?page=${page}`).page).toBe(0);
    expect(readLedgerLink("#/claims?page=3").page).toBe(2);
    expect(readLedgerLink("#/claims?page=2.7").page).toBe(1);
  });

  it("reads a huge page as past the end, which the ledger clamps to its last page", () => {
    expect(readLedgerLink("#/claims?page=999").page).toBe(998);
    expect(readLedgerLink("#/claims?page=Infinity").page).toBeGreaterThan(998);
  });

  it("keeps unknown filter values for the page to drop once the data has loaded", () => {
    // the ledger checks values against the data; the link reader only parses
    expect(readLedgerLink("#/claims?verdict=bogus&day=1999-01-01").verdict).toBe("bogus");
  });

  it("ignores parameters it doesn't know", () => {
    expect(readLedgerLink("#/claims?utm_source=x&verdict=backed")).toEqual({ ...all, verdict: "backed" });
  });
});
