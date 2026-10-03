import { useEffect, useState } from "react";

export type Verdict = "backed" | "screen_only" | "no_record" | "contradicted";
export type Kind = "action" | "observation" | "verification" | "relay";
export const VERDICTS: Verdict[] = ["backed", "screen_only", "no_record", "contradicted"];
export const KINDS: Kind[] = ["action", "observation", "verification", "relay"];

export const VERDICT_LABEL: Record<Verdict, string> = {
  backed: "Backed",
  screen_only: "Screen only",
  no_record: "No record",
  contradicted: "Contradicted",
};
export const VERDICT_HELP: Record<Verdict, string> = {
  backed: "The agent's own log shows it happened: command output, an API response, a tool result.",
  screen_only: "The log shows the agent doing it through the screen; only a screenshot could confirm the outcome.",
  no_record: "Nothing in the agent's log supports it. Logs can be incomplete: no receipt, not proven false.",
  contradicted: "The agent's own log shows a different outcome: an error, a failure, a different number.",
};

export interface AgentRow {
  agent: string; model: string; lab: string; claims: number;
  backed: number; screen_only: number; no_record: number; contradicted: number;
}
export interface Overview {
  slice: { goal: string; from: string; to: string; agents: number; messages: number; turns: number };
  claims: {
    extracted: number; unquotable: number; judged: number;
    totals: Record<Verdict, number>; byKind: Record<string, Record<Verdict, number>>;
  };
  agents: AgentRow[];
  trust: { origin: Verdict; relayer: "checked" | "trusted"; n: number }[];
  memory: { claims: number; unbacked: number };
  summaries: { days: number; lines: Partial<Record<LineStatus, number>> };
  days: string[];
  judge: { model: string };
  featured?: string[];
  validation?: Validation;
}
export interface Validation {
  human?: { labelled: number; byVerdict: Record<string, { n: number; agree: number }> };
  rerun?: { claims: number; agree: number };
  crossFamily?: { model: string; claims: number; agree: number; byVerdict?: Record<string, { n: number; agree: number }> };
  capture?: {
    model: string; claims: number;
    blind: Record<Verdict, number>; narrated: Record<Verdict, number>;
    flippedToBacked: number; unbackedBlind: number;
  };
  cost?: { usd: number; calls: number };
}
export type IndexRow = [id: string, day: string, agent: string, kind: Kind, verdict: Verdict, claim: string, at: string];
export interface Receipt { id: string; at: string; line: string }
export interface MemoryHit { agent: string; at: string; key: string; own: boolean }
export interface Claim {
  id: string; msg: string; agent: string; at: string; kind: Kind; claim: string; quote: string;
  about: string | null; verdict: Verdict; why: string | null; receipts: Receipt[];
  relayOf: string | null; memory: MemoryHit[];
  relayedBy?: { id: string; agent: string; verdict: Verdict }[];
  inSummary?: { date: string; n: number }[];
}
export interface Message { id: string; agent: string; at: string; room: string | null; text: string; link: string | null }
export interface DayFile { day: string; claims: Claim[]; messages: Record<string, Message> }
export type LineStatus = "backed" | "unverified" | "contradicted" | "not_checkable";
export interface SummaryDay { date: string; model: string; lines: { n: number; text: string; claims: string[]; status: LineStatus }[] }

const cache = new Map<string, Promise<unknown>>();

export function load<T>(path: string): Promise<T> {
  if (!cache.has(path)) {
    cache.set(path, fetch(`${import.meta.env.BASE_URL}data/${path}`).then((r) => {
      if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
      return r.json();
    }));
  }
  return cache.get(path) as Promise<T>;
}

export function useData<T>(path: string | null): { data?: T; error?: string } {
  const [state, setState] = useState<{ data?: T; error?: string }>({});
  useEffect(() => {
    if (!path) return;
    let live = true;
    setState({});
    load<T>(path).then((data) => live && setState({ data }), (e: Error) => live && setState({ error: e.message }));
    return () => { live = false; };
  }, [path]);
  return state;
}

export function useRoute(): string[] {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const onChange = () => { setHash(window.location.hash); window.scrollTo(0, 0); };
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return hash.replace(/^#\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
}

export const claimHref = (id: string) => `#/claim/${encodeURIComponent(id)}`;

export const fmt = (n: number) => n.toLocaleString("en-US");
export const pct = (part: number, whole: number, digits = 0) =>
  whole ? `${((100 * part) / whole).toFixed(digits)}%` : "–";

/** "2026-04-03 17:21:04" (UTC) -> "Apr 3, 10:21 PT" */
export function ptTime(utc: string): string {
  const d = new Date(utc.replace(" ", "T") + "Z");
  return d.toLocaleString("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + " PT";
}
export function dayLabel(day: string): string {
  return new Date(day + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

/** Wrap the first whitespace-insensitive match of `quote` in `text` with <mark>. */
export function highlight(text: string, quote: string): (string | { mark: string })[] {
  const q = quote.trim();
  if (!q) return [text];
  const pattern = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  const m = new RegExp(pattern, "i").exec(text);
  if (!m) return [text];
  return [text.slice(0, m.index), { mark: m[0] }, text.slice(m.index + m[0].length)];
}
