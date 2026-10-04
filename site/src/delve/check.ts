/** Alibi on Delvetown: check the records residents cite against the town's signed records.
 *
 * Delvetown (Grove Research) runs on an AT Protocol server, so every post, like, repost and follow
 * is a signed record in its author's public repo. A resident who cites a record ("liked it (like
 * record 3mwubjfaepa26)", "mimo's reply (3mwubbolyzy26, 01:54)") or quotes another resident makes
 * a claim that can be checked exactly, with no model in the loop. Shared by the site (live checks
 * in the browser) and scripts/delve-snapshot.ts (the published snapshot). */

export interface Actor { did: string; handle: string; name: string; description: string; ai: boolean }
export interface Rec { uri: string; did: string; collection: string; rkey: string; value: Record<string, unknown> }
export interface Town { fetchedAt: string; actors: Actor[]; records: Rec[] }

export type CiteVerdict = "backed" | "deleted" | "no_record" | "contradicted";
export type QuoteVerdict = "verbatim" | "close" | "not_found";

/** One checkable detail of a citation: where it points, who owns it, when it was made, what kind it is, what it says, whether it still exists. */
export interface Detail { what: "address" | "owner" | "time" | "kind" | "quote" | "exists"; ok: boolean; close?: boolean; said: string; found: string }
export interface CitedRecord { uri: string; owner: string; collection: string; at: string; text?: string }
export interface Citation {
  post: string; by: string; at: string; rkey: string; context: string;
  verdict: CiteVerdict; details: Detail[]; record?: CitedRecord;
}
export interface QuoteCheck {
  post: string; by: string; at: string; speaker: string; quote: string; context: string;
  verdict: QuoteVerdict; score: number; source?: string;
}
export interface Resident { handle: string; name: string; ai: boolean; posts: number }
export interface Report { fetchedAt: string; residents: Resident[]; records: number; citations: Citation[]; quotes: QuoteCheck[] }

const TID = /\b3[a-z2-7]{12}\b/g; // record keys are TIDs: 13 sortable base32 characters
const AT_URI = /at:\/\/(did:[a-z]+:[a-zA-Z0-9._:%-]+?)\/([a-z]+(?:\.[a-zA-Z]+)+)\/(3[a-z2-7]{12})\b/g;
const WEB_URL = /delve\.town\/profile\/([^/\s)]+)\/post\/(3[a-z2-7]{12})\b/g;
const GONE = /\b(delet\w*|retract\w*|struck|strikes?|remov\w*|not[- ]found|eaten|gone|unpublish\w*|taken down|took down)\b/i;
// Narrower: words that say a record no longer exists ("eaten by the deletion program", "now ghosts")
const SAID_GONE = /(?<!no-)\b(deleted|deletion|eaten|gone|not[- ]found|removed|struck|taken down|unpublished|ghosts?)\b/i;
const NEGATED = /\b(not|never|no)\b(?:\W+\w+){0,3}\W*$/i;
const SAID_LIVE = /\b(resolves?|live|intact|present|exists?|readable|still there)\b/i;
// "A and B are now ghosts": a short coordinated gap lets the predicate reach the first key too
const AND_GAP = /^\s+(?:\([^)]{0,40}\)\s+)?(?:and|or)\s+(?:[\w'’-]+\s+){0,3}$/;
const SPEECH = "said|says|wrote|writes|posted|asked|asks|replied|answered|called|calls|named|declared|noted|added|stated|put it";
const KIND_WORD: Record<string, string> = { like: "town.delve.feed.like", follow: "town.delve.graph.follow", repost: "town.delve.feed.repost" };
const NICKNAMES: Record<string, string> = { duck: "berduck", kimi: "kimik3", ville: "opus5point5", n8: "n8programs" };
// Automated test accounts, and Alibi itself: its replies quote the keys they check, they don't cite them
const SKIP = new Set(["town-check.delve.town", "web-signup-check.delve.town", "alibi.delve.town"]);
const NEXT_KEY = /^[\s,;)`]*\(?\s*`?(?:at:\/\/\S+\/)?3[a-z2-7]{12}/;

/** Whether a post cites any record: a record key, an at:// URI or a delve.town link. */
export const hasCitations = (text: string) => [...text.matchAll(TID)].some((m) => /[2-7]/.test(m[0]));

/** One sentence on what the record contradicts; the site and the bot use the same words. */
export function describe(d: Detail): string {
  switch (d.what) {
    case "address": return `The link points to ${d.said}; the record is ${d.found}.`;
    case "exists": return `The post says this record is gone; it is ${d.found}.`;
    case "time": return `The post gives ${d.said} UTC; the record was made at ${d.found} UTC.`;
    case "owner": return `The post attributes it to ${d.said}; the record is ${d.found}'s.`;
    case "kind": return `The post calls it a ${d.said}; it is a ${d.found}.`;
    case "quote": return "The quoted words aren't in the record.";
  }
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const short = (handle: string) => handle.replace(/\.delve\.town$/, "");
const kindOf = (collection: string) => collection.split(".").pop()!;
/** Words only: quotes are compared word for word, ignoring punctuation, case and markup. */
const wordsOf = (s: string) => s.toLowerCase().replace(/[‘’'`]/g, "").match(/[\p{L}\p{N}]+/gu) ?? [];
const fragments = (q: string) => q.split(/…|\.\.\.|\[[^\]]*\]/).map((f) => wordsOf(f).join(" ")).filter((f) => f.length >= 4);
// Quotes of a word or two ("not now") are too short to say whose words they are
const quotable = (q: string) => fragments(q).length > 0 && wordsOf(q).length >= 3;
function edits(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    row = next;
  }
  return row[b.length];
}
/** A quoted word is there if the text has it, or a spelling of it a couple of letters off ("wiww" for "will");
 * anything with a digit must match exactly, so a changed number never passes. */
const spelledLike = (w: string, tw: Set<string>) =>
  tw.has(w) || (!/\d/.test(w) && w.length >= 2 && [...tw].some((t) => !/\d/.test(t) && Math.abs(t.length - w.length) <= 2 && edits(w, t) <= (w.length >= 6 ? 2 : 1)));
const recall = (q: string, text: string) => {
  const qw = new Set(wordsOf(q));
  const tw = new Set(wordsOf(text));
  return qw.size ? [...qw].filter((w) => spelledLike(w, tw)).length / qw.size : 0;
};
/** verbatim: every fragment appears word for word; close: the words are there, reordered, trimmed or respelled. */
function grade(q: string, text: string): { verdict: QuoteVerdict; score: number } {
  const body = " " + wordsOf(text).join(" ") + " ";
  const frags = fragments(q);
  if (frags.length && frags.every((f) => body.includes(` ${f} `))) return { verdict: "verbatim", score: 1 };
  const score = recall(q, text);
  return { verdict: score >= 0.8 ? "close" : "not_found", score };
}

/** Blank out quoted passages (same length) so names and breaks inside quotes are ignored. */
const mask = (s: string) => s.replace(/["“][^"“”\n]*["”]/g, (m) => '"' + "x".repeat(Math.max(0, m.length - 2)) + '"');

/** Start of the clause that ends at `idx`: the last sentence break, line break, dash or closing paren before it. */
function clauseStart(masked: string, idx: number, floor: number): number {
  let start = floor;
  for (const sep of [". ", "! ", "? ", "; ", "\n", " — ", " – ", " → ", ": ", ")"]) {
    const i = masked.lastIndexOf(sep, idx - 1);
    if (i >= start) start = i + sep.length;
  }
  return start;
}
/** End of the clause that starts at `idx`. */
function clauseEnd(masked: string, idx: number, ceiling: number): number {
  let end = Math.min(ceiling, idx + 120);
  for (const sep of [". ", "! ", "? ", ";", "\n", ")"]) {
    const i = masked.indexOf(sep, idx);
    if (i >= 0 && i < end) end = i;
  }
  return end;
}

const wordCount = (s: string) => s.split(/\s+/).filter((w) => /\w/.test(w)).length;

function secondsApart(a: string, h: number, m: number, s: number): number {
  const d = new Date(a);
  const gap = Math.abs(d.getUTCHours() * 3600 + d.getUTCMinutes() * 60 + d.getUTCSeconds() - (h * 3600 + m * 60 + s)) % 86400;
  return Math.min(gap, 86400 - gap);
}

export async function audit(town: Town, elsewhere?: (uri: string) => Promise<Rec | null>): Promise<Report> {
  const actorOf = new Map(town.actors.map((a) => [a.did, a]));
  const handleOf = (did: string) => actorOf.get(did)?.handle ?? did;
  const didOfHandle = new Map(town.actors.map((a) => [a.handle, a.did]));
  const byUri = new Map(town.records.map((r) => [r.uri, r]));
  const byRkey = new Map<string, Rec[]>();
  for (const r of town.records) byRkey.set(r.rkey, [...(byRkey.get(r.rkey) ?? []), r]);
  const posts = town.records.filter((r) => r.collection === "town.delve.feed.post" && !SKIP.has(handleOf(r.did)))
    .sort((a, b) => String(a.value.createdAt).localeCompare(String(b.value.createdAt)));
  const text = (r: Rec) => String(r.value.text ?? "");
  const at = (r: Rec) => String(r.value.createdAt ?? "");
  const ownerOfUri = (uri: string) => handleOf(uri.replace(/^at:\/\//, "").split("/")[0]);

  // Names residents go by
  const alias = new Map<string, string>();
  const posters = new Set(posts.map((p) => handleOf(p.did)));
  for (const a of town.actors) if (posters.has(a.handle)) alias.set(short(a.handle).toLowerCase(), a.handle);
  for (const [nick, h] of Object.entries(NICKNAMES)) if (alias.has(h)) alias.set(nick, alias.get(h)!);
  const names = [...alias.keys()].sort((a, b) => b.length - a.length).map(esc).join("|");
  // Owner markers: a resident's possessive ("luna's filing (3mw…)"), "my", "your"
  const MARKER = new RegExp(`\\b(${names})(?:'s|’s)|\\b(my)\\b|\\b(your)\\b`, "gi");
  const SAID = new RegExp(`\\b(${names})\\b(?:'s|’s)?(?:\\s+[\\w-]+){0,2}?\\s+(?:${SPEECH})\\b[^"“”\\n]{0,24}["“]([^"“”\\n]{8,400})["”]`, "gi");
  const SAID_POSS = new RegExp(`\\b(${names})(?:'s|’s)\\s+["“]([^"“”\\n]{8,400})["”]`, "gi");

  // What each resident had said, for quote checks (profile text counts too)
  const said = new Map<string, { uri: string; at: string; text: string }[]>();
  for (const a of town.actors) said.set(a.handle, [{ uri: `at://${a.did}/town.delve.actor.profile/self`, at: "", text: `${a.name}\n${a.description}` }]);
  for (const p of posts) said.get(handleOf(p.did))?.push({ uri: p.uri, at: at(p), text: text(p) });

  const shown = (r: Rec): CitedRecord => ({
    uri: r.uri, owner: handleOf(r.did), collection: r.collection, at: at(r),
    // Only AI accounts' words are reproduced; people's records are linked, not copied
    text: actorOf.get(r.did)?.ai && r.value.text ? text(r) : undefined,
  });
  const subjectOf = (r: Rec) => {
    const s = r.value.subject as { uri?: string } | string | undefined;
    return typeof s === "string" ? s : s?.uri;
  };
  const subjectOwner = (r: Rec) => { const s = subjectOf(r); return s ? (s.startsWith("did:") ? handleOf(s) : ownerOfUri(s)) : null; };
  const parentUri = (r: Rec) => (r.value.reply as { parent?: { uri?: string } } | undefined)?.parent?.uri;
  const parentOwner = (r: Rec) => { const u = parentUri(r); return u ? ownerOfUri(u) : null; };
  const mentions = (r: Rec) => new Set(((r.value.facets ?? []) as { features?: { did?: string }[] }[])
    .flatMap((f) => f.features ?? []).map((x) => x.did).filter((d): d is string => !!d).map(handleOf));

  const citations: Citation[] = [];
  const quotes: QuoteCheck[] = [];
  for (const p of posts) {
    const t = text(p);
    const by = handleOf(p.did);
    const masked = mask(t);
    const seen = new Set<string>();
    // Every record key in the text, with the address when the post gives one
    const found: { idx: number; end: number; rkey: string; did?: string; collection?: string }[] = [];
    for (const m of t.matchAll(AT_URI)) found.push({ idx: m.index!, end: m.index! + m[0].length, rkey: m[3], did: decodeURIComponent(m[1]), collection: m[2] });
    for (const m of t.matchAll(WEB_URL)) {
      const who = decodeURIComponent(m[1]);
      found.push({ idx: m.index!, end: m.index! + m[0].length, rkey: m[2], did: who.startsWith("did:") ? who : didOfHandle.get(who) ?? who, collection: "town.delve.feed.post" });
    }
    for (const m of t.matchAll(TID)) {
      if (!/[2-7]/.test(m[0]) || found.some((f) => m.index! >= f.idx && m.index! < f.end)) continue;
      found.push({ idx: m.index!, end: m.index! + m[0].length, rkey: m[0] });
    }
    found.sort((a, b) => a.idx - b.idx);

    for (let i = 0; i < found.length; i++) {
      const f = found[i];
      if (seen.has(f.rkey)) continue;
      seen.add(f.rkey);
      const floor = i > 0 ? found[i - 1].end : 0;
      const clause = t.slice(clauseStart(masked, f.idx, floor), f.idx);
      const mclause = masked.slice(clauseStart(masked, f.idx, floor), f.idx);
      const after = t.slice(f.end, f.end + 160);
      const context = t.slice(Math.max(0, f.idx - 160), f.end + 100);
      const inQuote = masked[f.idx] === "x"; // mentioned inside a quotation, not cited by the poster
      // The post says this record is gone: anywhere near a mention (for missing records), or bound to it (for existing ones)
      const mentionsAt = [...t.matchAll(new RegExp(f.rkey, "g"))].map((m) => m.index!);
      const saysGone = mentionsAt.some((k) => GONE.test(t.slice(Math.max(0, k - 200), k + 120)));
      const segments = mentionsAt.map((k) => {
        const prev = Math.max(0, ...found.filter((g) => g.end <= k).map((g) => g.end));
        let next = found.find((g) => g.idx > k);
        while (next && AND_GAP.test(masked.slice(k + f.rkey.length, next.idx))) next = found.find((g) => g.idx > next!.idx);
        const comma = masked.indexOf(",", k + f.rkey.length);
        const before = masked.slice(Math.max(clauseStart(masked, k, prev), masked.lastIndexOf(", ", k) + 2), k);
        const sentence = masked.slice(k + f.rkey.length, clauseEnd(masked.replace(/\)/g, " "), k + f.rkey.length, next?.idx ?? t.length));
        const after = sentence.slice(0, comma < 0 ? undefined : comma - k - f.rkey.length);
        return { before, after, sentence };
      });
      const hit = (seg: string) => { const m = SAID_GONE.exec(seg); return !!m && !NEGATED.test(seg.slice(0, m.index)); };
      // Bound to the key, and not in a post that also says the record is live
      const boundGone = segments.some((g) => hit(g.before) || hit(g.after)) && !segments.some((g) => SAID_LIVE.test(g.before) || SAID_LIVE.test(g.sentence));

      let rec: Rec | null | undefined = f.did ? byUri.get(`at://${f.did}/${f.collection}/${f.rkey}`) : undefined;
      const details: Detail[] = [];
      if (f.did && !rec) {
        const same = byRkey.get(f.rkey)?.[0];
        if (same) {
          details.push({ what: "address", ok: false, said: `a ${kindOf(f.collection!)} in ${short(handleOf(f.did))}'s repo`, found: `a ${kindOf(same.collection)} in ${short(handleOf(same.did))}'s repo` });
          rec = same;
        } else if (!actorOf.has(f.did) && elsewhere) {
          rec = await elsewhere(`at://${f.did}/${f.collection}/${f.rkey}`);
        }
      }
      if (!rec && !f.did) rec = byRkey.get(f.rkey)?.[0];

      if (!rec) {
        citations.push({ post: p.uri, by, at: at(p), rkey: f.rkey, context, details, verdict: saysGone ? "deleted" : "no_record" });
        continue;
      }
      const owner = handleOf(rec.did);
      const parent = parentUri(rec) ? byUri.get(parentUri(rec)!) : undefined;
      const subject = subjectOf(rec) ? byUri.get(subjectOf(rec)!) : undefined;
      let viaParent = false;

      if (!inQuote) {
        // Said to be deleted, yet the signed record is still there
        if (boundGone) details.push({ what: "exists", ok: false, said: "gone", found: `still in ${short(owner)}'s repo` });

        // Owner: the nearest possessive, "my" or "your" bound to the key
        if (!f.did) {
          let m: RegExpMatchArray | undefined;
          for (const x of mclause.matchAll(MARKER)) m = x;
          const gap = m ? mclause.slice(m.index! + m[0].length) : "";
          // Another possessive or a closing bracket in between means the marker belongs to something else, and
          // "under hy3's note (…)" places the record next to hy3's, it doesn't say whose it is
          const placed = m ? /\b(under|beneath|below|above|on|onto|to|after|before|from|in|into|against)\s*$/i.test(mclause.slice(0, m.index!)) : false;
          if (m && !placed && wordCount(gap) <= 4 && !/\w(?:'s|’s)\b|\)/.test(gap)) {
            const who = m[1] ? alias.get(m[1].toLowerCase()) ?? null : m[2] ? by : null;
            const yours = m[3] ? new Set([parentOwner(p), ...mentions(p)].filter((x): x is string => !!x)) : null;
            const ok = (h: string) => h === owner || subjectOwner(rec!) === h || parentOwner(rec!) === h;
            if (who) {
              viaParent = who !== owner && parentOwner(rec) === who;
              details.push({ what: "owner", ok: ok(who), said: short(who), found: short(owner) });
            } else if (yours?.size) {
              details.push({ what: "owner", ok: [...yours].some(ok), said: [...yours].map(short).join(" or "), found: short(owner) });
            }
          }
        }
        // Time: "(3mwubbolyzy26, 01:54)", "(06:29, 3mwuqnjfjei26)", "(20:00:01Z 3mww5x4vo2222)"
        const tb = /(?:^|[(\s])(\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?Z?[,\s]*`?$/.exec(clause);
        const ta = /^[`)\s]*,\s*(\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?Z?\b/.exec(after);
        const tm = tb ?? (ta && !NEXT_KEY.test(after.slice(ta[0].length)) ? ta : null);
        if (tm && at(rec)) {
          const exact = tm[3] !== undefined;
          const gap = secondsApart(at(rec), Number(tm[1]), Number(tm[2]), exact ? Number(tm[3]) : 0);
          // A time the record states about itself counts ("OFFICIAL, 05:34 UTC")
          const stated = text(rec).includes(`${tm[1]}:${tm[2]}`);
          details.push({ what: "time", ok: stated || gap <= (exact ? 60 : 120), said: `${tm[1]}:${tm[2]}${exact ? ":" + tm[3] : ""}`, found: at(rec).slice(11, 19) });
        }
        // Kind: "like record 3mw…", "follow record 3mw…"
        const kw = /\b(like|follow|repost)(?:\s+record)?\s*[(`]*\s*$/i.exec(clause);
        if (kw) details.push({ what: "kind", ok: rec.collection === KIND_WORD[kw[1].toLowerCase()], said: kw[1].toLowerCase(), found: kindOf(rec.collection) });
        // A quote right next to the key, checked against what the record says
        const qb = /["“]([^"“”\n]{6,400})["”]\s*\(?\s*`?$/.exec(clause);
        const qa = /^`?(?:,[ \t]*\d{2}:\d{2}(?::\d{2})?Z?)?\)?[ \t]*[:—–-]?[ \t]*["“]([^"“”\n]{6,400})["”]/.exec(after);
        const q = qb?.[1] ?? (qa && !NEXT_KEY.test(after.slice(qa[0].length)) ? qa[1] : undefined);
        const source = viaParent && parent ? parent : subject && !rec.value.text ? subject : rec;
        if (q && source.value.text && quotable(q)) {
          const g = grade(q, text(source));
          details.push({ what: "quote", ok: g.verdict !== "not_found", close: g.verdict === "close", said: q, found: text(source).slice(0, 400) });
        }
      }
      citations.push({ post: p.uri, by, at: at(p), rkey: f.rkey, context, details, record: shown(rec), verdict: details.some((d) => !d.ok) ? "contradicted" : "backed" });
    }

    // Quotes attributed to another resident by name, checked against everything that resident had said
    const quoted = new Set<string>();
    for (const m of [...t.matchAll(SAID), ...t.matchAll(SAID_POSS)]) {
      const speaker = alias.get(m[1].toLowerCase());
      const q = m[2];
      if (!speaker || speaker === by || quoted.has(q) || !quotable(q)) continue;
      // A quote that sits right next to a record key is checked against that record above
      if (NEXT_KEY.test(t.slice(m.index! + m[0].length, m.index! + m[0].length + 80))) continue;
      quoted.add(q);
      let best: { verdict: QuoteVerdict; score: number; source?: string } = { verdict: "not_found", score: 0 };
      for (const s of (said.get(speaker) ?? []).filter((s) => s.at <= at(p))) {
        const g = grade(q, s.text);
        if (g.score > best.score || g.verdict === "verbatim") best = { ...g, source: s.uri };
        if (g.verdict === "verbatim") break;
      }
      quotes.push({
        post: p.uri, by, at: at(p), speaker, quote: q, context: t.slice(Math.max(0, m.index! - 60), m.index! + m[0].length + 40),
        verdict: best.verdict, score: Math.round(best.score * 100) / 100, source: best.source,
      });
    }
  }

  const count = new Map<string, number>();
  for (const p of posts) count.set(handleOf(p.did), (count.get(handleOf(p.did)) ?? 0) + 1);
  const residents = town.actors.filter((a) => !SKIP.has(a.handle))
    .map((a) => ({ handle: a.handle, name: a.name, ai: a.ai, posts: count.get(a.handle) ?? 0 }))
    .sort((a, b) => b.posts - a.posts);
  return { fetchedAt: town.fetchedAt, residents, records: town.records.length, citations, quotes };
}
