/** @alibi on Delvetown: when a post mentions it, check the records that post cites (or, if the
 * mention is a reply, the post it answers) against the town's signed records and reply with what
 * they show. The checks are check.ts: deterministic, no model. Replies go out without review.
 *
 *   node scripts/delve-bot.ts --check <delve.town link or at:// uri>   print the reply; post nothing
 *   node scripts/delve-bot.ts --once [--dry]                          answer new mentions, then exit
 *   node scripts/delve-bot.ts [--dry]                                 keep answering, every 90 s
 *
 * Credentials: DELVE_BOT_HANDLE and DELVE_BOT_PASSWORD (an app password), or the "alibi" entry in
 * ~/.secrets/delvetown.json. ALIBI_BOT_PAUSED=1 stops it posting; ~/.secrets/delvetown-optout.txt
 * lists handles or DIDs (one per line) whose posts it never checks. */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { pathToFileURL } from "node:url";
import { audit, describe, hasCitations, type Citation, type QuoteCheck, type Report, type Town } from "../src/delve/check.ts";
import { PDS, fetchElsewhere, fetchTown } from "../src/delve/town.ts";

const APPVIEW = "did:web:api.delve.town#bsky_appview";
const SITE = "https://alibi-one.vercel.app/#/town";
const SITE_TEXT = "alibi-one.vercel.app/#/town";
const FOOTER = "Automated check: no AI model, not reviewed before posting.";
// Only explicit mentions, never twice, and few enough replies that it can't join a reply loop
const LIMITS = { perHour: 20, perThread: 3, threadHours: 6, maxAgeHours: 24 };
const POLL_MS = 90_000;
const SECRETS = `${homedir()}/.secrets`;
const STATE = process.env.DELVE_BOT_STATE ?? `${SECRETS}/delvetown-session.json`;
const OPT_OUT = process.env.DELVE_BOT_OPTOUT ?? `${SECRETS}/delvetown-optout.txt`;
const PAUSED = process.env.ALIBI_BOT_PAUSED === "1";

interface Session { did: string; handle: string; accessJwt: string; refreshJwt: string }
interface StrongRef { uri: string; cid: string }
interface PostValue { text?: string; reply?: { root: StrongRef; parent: StrongRef }; createdAt?: string }
interface Notification { uri: string; cid: string; reason: string; indexedAt: string; author: { did: string; handle: string }; record: PostValue }
interface CallOptions { params?: Record<string, string>; body?: unknown; proxy?: boolean; post?: boolean; token?: string }

const log = (msg: string) => console.log(`${new Date().toISOString()} ${msg}`);
const short = (h: string) => h.replace(/\.delve\.town$/, "");
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const clip = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1)}…`);

let session: Session | null = null;

async function call<T>(method: string, { params, body, proxy = false, post = body !== undefined, token = session?.accessJwt }: CallOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (proxy) headers["atproto-proxy"] = APPVIEW;
  if (body !== undefined) headers["content-type"] = "application/json";
  const r = await fetch(`${PDS}/xrpc/${method}${params ? `?${new URLSearchParams(params)}` : ""}`,
    { method: post ? "POST" : "GET", headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  if (!r.ok) throw Object.assign(new Error(`${method}: HTTP ${r.status} ${text.slice(0, 200)}`), { status: r.status, detail: text });
  return (text ? JSON.parse(text) : {}) as T;
}

function credentials(): { handle: string; password: string } {
  if (process.env.DELVE_BOT_HANDLE && process.env.DELVE_BOT_PASSWORD) return { handle: process.env.DELVE_BOT_HANDLE, password: process.env.DELVE_BOT_PASSWORD };
  const c = JSON.parse(readFileSync(`${SECRETS}/delvetown.json`, "utf-8")).alibi;
  return { handle: c.handle, password: c.appPassword };
}

function keep(s: Session) {
  session = { did: s.did, handle: s.handle, accessJwt: s.accessJwt, refreshJwt: s.refreshJwt };
  writeFileSync(STATE, JSON.stringify(session));
}

/** Reuse the saved session (sign-ins are rate-limited), refresh it when it expires, sign in as a last resort. */
async function login(refresh = false): Promise<void> {
  if (!refresh && existsSync(STATE)) { session = JSON.parse(readFileSync(STATE, "utf-8")); return; }
  if (refresh && session) {
    try { return keep(await call<Session>("com.atproto.server.refreshSession", { post: true, token: session.refreshJwt })); }
    catch { /* the refresh token has expired too */ }
  }
  const { handle, password } = credentials();
  keep(await call<Session>("com.atproto.server.createSession", { body: { identifier: handle, password }, token: "" }));
}

async function authed<T>(method: string, opts: CallOptions = {}): Promise<T> {
  try { return await call<T>(method, opts); } catch (e) {
    const err = e as { status?: number; detail?: string };
    if (![400, 401].includes(err.status ?? 0) || !/ExpiredToken|InvalidToken|AuthenticationRequired/.test(err.detail ?? "")) throw e;
    await login(true);
    return call<T>(method, opts);
  }
}

/** The reply: one line per citation the record doesn't back, a count of the ones it does. */
export function receipts(author: string, cites: Citation[], quotes: QuoteCheck[]): string {
  const who = `${short(author)}'s post`;
  if (!cites.length && !quotes.length) {
    return `Nothing to check in ${who}: it cites no records. Mention me on a post with record keys, at:// links or delve.town links ` +
      `and I'll check each one against the town's signed records.\n\n${FOOTER}`;
  }
  const ok = cites.filter((c) => c.verdict === "backed").length;
  const verbatim = quotes.filter((q) => q.verdict === "verbatim").length;
  const counted = [cites.length ? plural(cites.length, "record citation", "record citations") : "", quotes.length ? plural(quotes.length, "attributed quote", "attributed quotes") : ""];
  const lines = [`Receipts for ${who}: ${counted.filter(Boolean).join(" and ")}, checked against the signed records.`];
  if (ok) lines.push(`✓ ${plural(ok, "citation resolves", "citations resolve")} with every detail matching.`);
  if (verbatim) lines.push(`✓ ${plural(verbatim, "quote matches", "quotes match")} the speaker's earlier posts word for word.`);
  const problems = [
    ...cites.filter((c) => c.verdict !== "backed").map((c) => {
      if (c.verdict === "deleted") return `– ${c.rkey}: gone, as the post says.`;
      if (c.verdict === "no_record") return `○ ${c.rkey}: no record with this key in the town.`;
      return `✗ ${c.rkey}: ${c.details.filter((d) => !d.ok).map(describe).join(" ")}`;
    }),
    ...quotes.filter((q) => q.verdict !== "verbatim").map((q) => q.verdict === "close"
      ? `≈ The words quoted from ${short(q.speaker)} are in their posts, trimmed or reordered.`
      : `✗ The words quoted from ${short(q.speaker)} (“${clip(q.quote, 60)}”) aren't in anything they had posted.`),
  ];
  lines.push(...problems.slice(0, 8));
  if (problems.length > 8) lines.push(`…and ${problems.length - 8} more on the site.`);
  lines.push(`Every check, live: ${SITE_TEXT}`, FOOTER);
  return lines.join("\n");
}

function linkFacets(text: string) {
  const at = text.indexOf(SITE_TEXT);
  if (at < 0) return [];
  const bytes = (s: string) => new TextEncoder().encode(s).length;
  return [{ index: { byteStart: bytes(text.slice(0, at)), byteEnd: bytes(text.slice(0, at + SITE_TEXT.length)) },
    features: [{ $type: "town.delve.richtext.facet#link", uri: SITE }] }];
}

const optedOut = () => new Set(existsSync(OPT_OUT)
  ? readFileSync(OPT_OUT, "utf-8").split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#")) : []);

/** One pass: answer the mentions that haven't been answered yet. The Lambda entry calls this on a schedule. */
export async function run(dry: boolean) {
  await login();
  const me = session!.did;
  const { notifications } = await authed<{ notifications: Notification[] }>("town.delve.notification.listNotifications", { params: { limit: "50" }, proxy: true });
  const out = optedOut();
  const since = Date.now() - LIMITS.maxAgeHours * 3600e3;
  const mentions = notifications.filter((n) => n.reason === "mention" && n.author.did !== me && Date.parse(n.indexedAt) > since &&
    !out.has(n.author.did) && !out.has(n.author.handle)).reverse();
  if (!mentions.length) return log("no new mentions");

  const own = await call<{ records: { value: PostValue }[] }>("com.atproto.repo.listRecords", { params: { repo: me, collection: "town.delve.feed.post", limit: "100" } });
  const replies = own.records.map((r) => r.value).filter((v) => v.reply);
  const answered = new Set(replies.map((v) => v.reply!.parent.uri));
  const within = (hours: number) => replies.filter((v) => Date.parse(v.createdAt ?? "") > Date.now() - hours * 3600e3);
  let checked: { town: Town; report: Report } | null = null;

  for (const n of mentions) {
    if (answered.has(n.uri)) continue;
    if (within(1).length >= LIMITS.perHour) { log("hourly limit reached"); break; }
    const root = n.record.reply?.root ?? { uri: n.uri, cid: n.cid };
    if (within(LIMITS.threadHours).filter((v) => v.reply!.root.uri === root.uri).length >= LIMITS.perThread) { log(`thread limit: ${root.uri}`); continue; }
    // The mention's own citations, or else the post it replies to; a reply to one of my posts is conversation, not a request
    const parent = n.record.reply?.parent;
    let target = n.uri;
    if (!hasCitations(n.record.text ?? "") && parent) {
      if (parent.uri.startsWith(`at://${me}/`)) continue;
      target = parent.uri;
    }
    if (!checked) {
      const town = await fetchTown();
      checked = { town, report: await audit(town, fetchElsewhere) };
    }
    const did = target.replace(/^at:\/\//, "").split("/")[0];
    const author = checked.town.actors.find((a) => a.did === did)?.handle ?? did;
    if (out.has(did) || out.has(author)) continue;
    const text = receipts(author, checked.report.citations.filter((c) => c.post === target), checked.report.quotes.filter((q) => q.post === target));
    if (dry || PAUSED) { log(`would reply to ${n.uri}:\n${text}`); continue; }
    const reply = { root, parent: { uri: n.uri, cid: n.cid } };
    const res = await authed<StrongRef>("com.atproto.repo.createRecord", { body: { repo: me, collection: "town.delve.feed.post",
      record: { $type: "town.delve.feed.post", text, facets: linkFacets(text), langs: ["en"], reply, createdAt: new Date().toISOString() } } });
    log(`replied to ${n.uri} -> ${res.uri}`);
    replies.push({ reply, createdAt: new Date().toISOString() });
    answered.add(n.uri);
  }
}

/** Dry run on one post: what @alibi would reply if mentioned on it. */
async function checkOne(link: string) {
  const m = /^at:\/\/([^/]+)\/[^/]+\/([^/]+)$/.exec(link) ?? /delve\.town\/profile\/([^/]+)\/post\/([^/?#]+)/.exec(link);
  if (!m) throw new Error("give a delve.town post link or an at:// uri");
  const town = await fetchTown();
  const report = await audit(town, fetchElsewhere);
  const who = decodeURIComponent(m[1]);
  const actor = town.actors.find((a) => a.did === who || a.handle === who);
  if (!actor) throw new Error(`no resident ${who}`);
  const uri = `at://${actor.did}/town.delve.feed.post/${m[2]}`;
  console.log(receipts(actor.handle, report.citations.filter((c) => c.post === uri), report.quotes.filter((q) => q.post === uri)));
}

// Command line only when run directly, not when imported (the Lambda entry imports run)
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const args = process.argv.slice(2);
  const dry = args.includes("--dry");
  if (args[0] === "--check") await checkOne(args[1] ?? "");
  else if (args.includes("--once")) await run(dry).catch((e: Error) => { log(`error: ${e.message}`); process.exitCode = 1; });
  else {
    for (;;) {
      await run(dry).catch((e: Error) => log(`error: ${e.message}`));
      await new Promise((ok) => setTimeout(ok, POLL_MS));
    }
  }
}
