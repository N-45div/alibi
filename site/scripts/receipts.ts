/** Alibi's rule, applied to its own merges: a claim isn't evidence. TestSprite's commit status is a claim about a
 * run; this check reads the counts in it and only goes green when every test passed and the number of tests matches
 * the suite kept in the repo (testsprite/suite.jsonl), so a test skipped, blocked or deleted from the project can't
 * pass quietly. Run by .github/workflows/receipts.yml on every TestSprite status:
 *   node site/scripts/receipts.ts   (env: STATE, DESCRIPTION, SHA, REPO, TARGET_URL, GITHUB_TOKEN, SUITE_FILE)
 * The workflow runs this file from main and passes the suite file from the commit under test, so a pull request
 * can't rewrite its own check. */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export interface Result { passed: number; total: number; failed: number; blocked: number }
export interface Verdict { state: "success" | "failure" | "pending"; description: string }

/** "All 23 tests passed" or "24/30 passed · 6 failed" (· n blocked); null when the wording isn't one we know. */
export function readResult(description: string): Result | null {
  const all = /^All (\d+) tests? passed\b/i.exec(description);
  if (all) return { passed: Number(all[1]), total: Number(all[1]), failed: 0, blocked: 0 };
  const some = /\b(\d+)\s*\/\s*(\d+) passed\b/i.exec(description);
  if (!some) return null;
  const n = (word: string) => Number(new RegExp(String.raw`\b(\d+) ${word}\b`, "i").exec(description)?.[1] ?? 0);
  return { passed: Number(some[1]), total: Number(some[2]), failed: n("failed"), blocked: n("blocked") };
}

export function judge(state: string, description: string, suite: number): Verdict {
  if (state === "pending") return { state: "pending", description: "Waiting for TestSprite to finish" };
  const r = readResult(description);
  if (!r) return { state: "failure", description: `Can't read TestSprite's result: "${description}"`.slice(0, 140) };
  if (r.total !== suite) return { state: "failure", description: `TestSprite ran ${r.total} tests; the suite in the repo has ${suite}` };
  if (r.passed !== r.total) {
    const why = [r.failed && `${r.failed} failed`, r.blocked && `${r.blocked} blocked`].filter(Boolean).join(", ");
    const tail = why ? ": " + why : "";
    return { state: "failure", description: `${r.passed} of ${r.total} passed${tail}` };
  }
  if (state !== "success") return { state: "failure", description: `TestSprite reported ${state} with ${r.total}/${r.total} passed` };
  return { state: "success", description: `All ${r.total} tests passed, matching the ${suite} in the repo` };
}

/** Tests in the suite file: one JSON plan per non-empty line. */
export const suiteSize = (jsonl: string) => jsonl.split("\n").filter((l) => l.trim()).length;

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const env = (k: string) => process.env[k] ?? "";
  const suite = suiteSize(readFileSync(env("SUITE_FILE") || new URL("../../testsprite/suite.jsonl", import.meta.url), "utf-8"));
  const v = judge(env("STATE"), env("DESCRIPTION"), suite);
  console.log(`TestSprite said: ${env("STATE")} "${env("DESCRIPTION")}" -> receipts ${v.state}: ${v.description}`);
  const api = env("GITHUB_API_URL") || "https://api.github.com";
  const res = await fetch(`${api}/repos/${env("REPO")}/statuses/${env("SHA")}`, {
    method: "POST",
    headers: { authorization: `Bearer ${env("GITHUB_TOKEN")}`, accept: "application/vnd.github+json" },
    body: JSON.stringify({ state: v.state, context: "receipts", description: v.description, target_url: env("TARGET_URL") || undefined }),
  });
  if (!res.ok) throw new Error(`posting the receipts status failed: ${res.status} ${await res.text()}`);
}
