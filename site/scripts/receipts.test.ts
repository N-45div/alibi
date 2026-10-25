import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { judge, readResult, suiteSize } from "./receipts.ts";

describe("reading TestSprite's status", () => {
  it("reads the wordings TestSprite posts on this repo's pull requests", () => {
    expect(readResult("All 23 tests passed")).toEqual({ passed: 23, total: 23, failed: 0, blocked: 0 });
    expect(readResult("24/30 passed · 6 failed")).toEqual({ passed: 24, total: 30, failed: 6, blocked: 0 });
    expect(readResult("28/30 passed · 1 failed · 1 blocked")).toEqual({ passed: 28, total: 30, failed: 1, blocked: 1 });
  });

  it("returns nothing for wording it doesn't know", () => {
    expect(readResult("Tests look good")).toBeNull();
    expect(readResult("")).toBeNull();
  });
});

describe("the receipts check", () => {
  it("passes only when every test passed and the count matches the suite in the repo", () => {
    expect(judge("success", "All 23 tests passed", 23)).toEqual({ state: "success", description: "All 23 tests passed, matching the 23 in the repo" });
  });

  it("fails a green run that ran fewer tests than the repo keeps", () => {
    expect(judge("success", "All 20 tests passed", 23)).toMatchObject({ state: "failure", description: "TestSprite ran 20 tests; the suite in the repo has 23" });
  });

  it("fails a run with failed or blocked tests, even if TestSprite calls it a success", () => {
    expect(judge("success", "21/23 passed · 1 failed · 1 blocked", 23)).toMatchObject({ state: "failure", description: "21 of 23 passed: 1 failed, 1 blocked" });
    expect(judge("failure", "22/23 passed · 1 failed", 23).state).toBe("failure");
  });

  it("fails closed when it can't read the result", () => {
    expect(judge("success", "Tests look good", 23).state).toBe("failure");
  });

  it("fails a run TestSprite itself errored, whatever the counts say", () => {
    expect(judge("error", "All 23 tests passed", 23).state).toBe("failure");
  });

  it("waits while TestSprite is still running", () => {
    expect(judge("pending", "23 tests queued", 23)).toEqual({ state: "pending", description: "Waiting for TestSprite to finish" });
  });

  it("counts the suite file in the repo, one test per line", () => {
    expect(suiteSize('{"a":1}\n{"b":2}\n\n')).toBe(2);
    expect(suiteSize(readFileSync("../testsprite/suite.jsonl", "utf-8"))).toBe(23);
  });
});
