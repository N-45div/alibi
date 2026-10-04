/** Read Delvetown's public records straight from its AT Protocol server. The server allows
 * cross-origin reads, so the same code runs in the browser (live checks) and in Node (snapshot). */
import type { Actor, Rec, Town } from "./check.ts";

export const PDS = "https://pds.delve.town";
export const COLLECTIONS = ["town.delve.feed.post", "town.delve.feed.like", "town.delve.feed.repost", "town.delve.graph.follow"];

// Profiles that say they are automated, or carry a model's name
const AI_HINT = /(?<![.\w-])(ai|agent|automated)(?![.\w])|run by grove research|\b(gpt|glm|grok|gemini|deepseek|kimi|mimo|mistral|claude|hy3)\b|muse spark|inkling/i;

export const isAI = (name: string, description: string) => AI_HINT.test(`${name} ${description}`);

type Params = Record<string, string | number | undefined>;

async function xrpc<T>(base: string, method: string, params: Params): Promise<T | null> {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) q.set(k, String(v));
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(`${base}/xrpc/${method}?${q}`);
    if (r.ok) return (await r.json()) as T;
    if (r.status === 400) return null; // RecordNotFound, RepoNotFound
    if ((r.status === 429 || r.status >= 500) && attempt < 5) {
      await new Promise((ok) => setTimeout(ok, 800 * 2 ** attempt));
      continue;
    }
    throw new Error(`${method}: HTTP ${r.status}`);
  }
}

interface Page { records: { uri: string; value: Record<string, unknown> }[]; cursor?: string }

async function listAll(did: string, collection: string): Promise<Rec[]> {
  const out: Rec[] = [];
  let cursor: string | undefined;
  do {
    const page = await xrpc<Page>(PDS, "com.atproto.repo.listRecords", { repo: did, collection, limit: 100, cursor });
    if (!page) break;
    for (const r of page.records) out.push({ uri: r.uri, did, collection, rkey: r.uri.slice(r.uri.lastIndexOf("/") + 1), value: r.value });
    cursor = page.records.length ? page.cursor : undefined;
  } while (cursor);
  return out;
}

/** Run jobs with a small concurrency limit, reporting progress as each finishes. */
async function pool<T>(jobs: (() => Promise<T>)[], size: number, tick?: () => void): Promise<T[]> {
  const out: T[] = new Array(jobs.length);
  let next = 0;
  await Promise.all(Array.from({ length: size }, async () => {
    while (next < jobs.length) {
      const i = next++;
      out[i] = await jobs[i]();
      tick?.();
    }
  }));
  return out;
}

export async function fetchTown(onProgress?: (done: number, total: number) => void): Promise<Town> {
  const repos: { did: string; active?: boolean }[] = [];
  let cursor: string | undefined;
  do {
    const page = await xrpc<{ repos: { did: string; active?: boolean }[]; cursor?: string }>(PDS, "com.atproto.sync.listRepos", { limit: 1000, cursor });
    if (!page) break;
    repos.push(...page.repos);
    cursor = page.repos.length ? page.cursor : undefined;
  } while (cursor);
  const dids = repos.filter((r) => r.active !== false).map((r) => r.did);

  let done = 0;
  const total = dids.length * (COLLECTIONS.length + 1);
  const tick = () => onProgress?.(++done, total);
  const actors = await pool(dids.map((did) => async () => {
    const [desc, profile] = await Promise.all([
      xrpc<{ handle: string }>(PDS, "com.atproto.repo.describeRepo", { repo: did }),
      xrpc<{ value: { displayName?: string; description?: string } }>(PDS, "com.atproto.repo.getRecord", { repo: did, collection: "town.delve.actor.profile", rkey: "self" }),
    ]);
    const name = profile?.value.displayName ?? "";
    const description = profile?.value.description ?? "";
    return { did, handle: desc?.handle ?? did, name, description, ai: isAI(name, description) } satisfies Actor;
  }), 6, tick);
  const lists = await pool(dids.flatMap((did) => COLLECTIONS.map((c) => () => listAll(did, c))), 6, tick);
  return { fetchedAt: new Date().toISOString(), actors, records: lists.flat() };
}

/** A record on another AT Protocol server: find its home through the DID directory, then read it. */
export async function fetchElsewhere(uri: string): Promise<Rec | null> {
  const m = /^at:\/\/(did:[^/]+)\/([^/]+)\/([^/]+)$/.exec(uri);
  if (!m) return null;
  const [, did, collection, rkey] = m;
  try {
    const res = await fetch(did.startsWith("did:plc:") ? `https://plc.directory/${did}` : `https://${did.slice("did:web:".length)}/.well-known/did.json`);
    const doc = (await res.json()) as { service?: { id: string; serviceEndpoint: string }[] };
    const pds = doc.service?.find((s) => s.id.endsWith("#atproto_pds"))?.serviceEndpoint;
    if (!pds) return null;
    const r = await xrpc<{ uri: string; value: Record<string, unknown> }>(pds, "com.atproto.repo.getRecord", { repo: did, collection, rkey });
    return r ? { uri: r.uri, did, collection, rkey, value: r.value } : null;
  } catch {
    return null;
  }
}
