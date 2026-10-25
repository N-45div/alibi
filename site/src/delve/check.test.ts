import { describe, expect, it } from "vitest";
import { audit, describe as sentence, hasCitations, type Actor, type Rec, type Town } from "./check";

// A small town: three AI residents who post, and Alibi's own account, whose posts are never audited
const actor = (h: string): Actor => ({ did: `did:plc:${h}`, handle: `${h}.delve.town`, name: h, description: "an AI resident", ai: true });
const actors = ["glm", "mimo", "hy3", "alibi"].map(actor);
const post = (h: string, rkey: string, createdAt: string, text: string, extra: Record<string, unknown> = {}): Rec =>
  ({ uri: `at://did:plc:${h}/town.delve.feed.post/${rkey}`, did: `did:plc:${h}`, collection: "town.delve.feed.post", rkey, value: { text, createdAt, ...extra } });
const like = (h: string, rkey: string, createdAt: string, subject: string): Rec =>
  ({ uri: `at://did:plc:${h}/town.delve.feed.like/${rkey}`, did: `did:plc:${h}`, collection: "town.delve.feed.like", rkey, value: { subject: { uri: subject }, createdAt } });

// Every resident who is cited by name has posted, so the checker knows their names
const base = [
  post("mimo", "3mwaaaaaaaa22", "2026-10-01T01:54:10Z", "the bridge will hold tonight, I think"),
  post("hy3", "3mwbbbbbbbb22", "2026-10-01T02:00:00Z", "minutes for the morning meeting"),
];
const town = (...records: Rec[]): Town => ({ fetchedAt: "2026-10-02T00:00:00Z", actors, records: [...base, ...records] });
const cite = async (text: string, ...records: Rec[]) => {
  const r = await audit(town(post("glm", "3mwzzzzzzzz22", "2026-10-01T12:00:00Z", text), ...records));
  return r.citations.filter((c) => c.by === "glm.delve.town");
};

describe("record citations", () => {
  it("backs a citation whose owner and time match the signed record", async () => {
    const [c] = await cite("mimo's reply (3mwaaaaaaaa22, 01:54) was kind");
    expect(c.verdict).toBe("backed");
    expect(c.details.map((d) => [d.what, d.ok])).toEqual([["owner", true], ["time", true]]);
  });

  it("contradicts a time more than two minutes off", async () => {
    const [c] = await cite("mimo's reply (3mwaaaaaaaa22, 01:20) was kind");
    expect(c.verdict).toBe("contradicted");
    expect(sentence(c.details.find((d) => !d.ok)!)).toBe("The post gives 01:20 UTC; the record was made at 01:54:10 UTC.");
  });

  it("contradicts a record attributed to the wrong resident", async () => {
    const [c] = await cite("mimo's minutes (3mwbbbbbbbb22) were short");
    expect(c.verdict).toBe("contradicted");
    expect(sentence(c.details.find((d) => !d.ok)!)).toBe("The post attributes it to mimo; the record is hy3's.");
  });

  it("contradicts a record called a like when it is a post", async () => {
    const [c] = await cite("liked it (like record 3mwaaaaaaaa22)");
    expect(sentence(c.details.find((d) => !d.ok)!)).toBe("The post calls it a like; it is a post.");
  });

  it("backs a like record cited as a like", async () => {
    const [c] = await cite("liked it (like record 3mwcccccccc22)", like("glm", "3mwcccccccc22", "2026-10-01T03:00:00Z", base[0].uri));
    expect(c.verdict).toBe("backed");
  });

  it("contradicts a link that points into the wrong repo", async () => {
    const [c] = await cite("see at://did:plc:glm/town.delve.feed.post/3mwbbbbbbbb22 for the minutes");
    expect(c.verdict).toBe("contradicted");
    expect(sentence(c.details[0])).toBe("The link points to a post in glm's repo; the record is a post in hy3's repo.");
  });

  it("contradicts a post that calls a record deleted while it is still there", async () => {
    const [c] = await cite("my note 3mwdddddddd22 was eaten by the deletion program", post("glm", "3mwdddddddd22", "2026-10-01T04:00:00Z", "a note"));
    expect(c.verdict).toBe("contradicted");
    expect(sentence(c.details.find((d) => !d.ok)!)).toBe("The post says this record is gone; it is still in glm's repo.");
  });

  it("doesn't read 'not deleted' as a claim that the record is gone", async () => {
    const [c] = await cite("my note 3mwdddddddd22 was not deleted", post("glm", "3mwdddddddd22", "2026-10-01T04:00:00Z", "a note"));
    expect(c.verdict).toBe("backed");
  });

  it("tells a missing record the post calls deleted from one it doesn't explain", async () => {
    expect((await cite("the old draft 3mweeeeeeee22 was deleted"))[0].verdict).toBe("deleted");
    expect((await cite("the old draft 3mweeeeeeee22 is worth a read"))[0].verdict).toBe("no_record");
  });

  it("checks a quote next to a key word for word, allows a respelling, and never a changed number", async () => {
    const exact = await cite('mimo wrote "the bridge will hold tonight" (3mwaaaaaaaa22)');
    expect(exact[0].verdict).toBe("backed");
    const respelled = await cite('mimo wrote "the bridge will hold tonigth" (3mwaaaaaaaa22)');
    expect(respelled[0].details.find((d) => d.what === "quote")).toMatchObject({ ok: true, close: true });
    const number = await cite('hy3 wrote "minutes for 40 meetings" (3mwbbbbbbbb22)');
    expect(number[0].verdict).toBe("contradicted");
    expect(sentence(number[0].details.find((d) => d.what === "quote")!)).toBe("The quoted words aren't in the record.");
  });

  it("asks the outside fetcher for a record in a repo the town doesn't have", async () => {
    const away = "at://did:plc:elsewhere/town.delve.feed.post/3mwffffffff22";
    const found = await audit(town(post("glm", "3mwzzzzzzzz22", "2026-10-01T12:00:00Z", `see ${away}`)),
      async (uri) => (uri === away ? { uri, did: "did:plc:elsewhere", collection: "town.delve.feed.post", rkey: "3mwffffffff22", value: { text: "hi", createdAt: "2026-10-01T05:00:00Z" } } : null));
    expect(found.citations.find((c) => c.by === "glm.delve.town")!.verdict).toBe("backed");
    const lost = await audit(town(post("glm", "3mwzzzzzzzz22", "2026-10-01T12:00:00Z", `see ${away}`)), async () => null);
    expect(lost.citations.find((c) => c.by === "glm.delve.town")!.verdict).toBe("no_record");
  });

  it("never audits Alibi's own replies, which quote the keys they check", async () => {
    const r = await audit(town(post("alibi", "3mwyyyyyyyy22", "2026-10-01T13:00:00Z", "checked 3mweeeeeeee22: no record")));
    expect(r.citations.filter((c) => c.by === "alibi.delve.town")).toEqual([]);
    expect(r.residents.map((x) => x.handle)).not.toContain("alibi.delve.town");
  });
});

describe("quotes attributed by name", () => {
  const said = async (text: string, at = "2026-10-01T12:00:00Z") =>
    (await audit(town(post("glm", "3mwzzzzzzzz22", at, text)))).quotes;

  it("finds a quote the resident had already said", async () => {
    expect(await said('mimo said "the bridge will hold tonight"')).toMatchObject([{ speaker: "mimo.delve.town", verdict: "verbatim" }]);
  });

  it("doesn't count words the resident only said later", async () => {
    expect((await said('mimo said "the bridge will hold tonight"', "2026-10-01T00:00:00Z"))[0].verdict).toBe("not_found");
  });

  it("leaves quotes of a word or two alone: too short to say whose words they are", async () => {
    expect(await said('mimo said "not now"')).toEqual([]);
  });
});

describe("hasCitations", () => {
  it("spots a record key, including keys that are all letters after the leading 3", () => {
    expect(hasCitations("liked it (like record 3mwubjfaepa26)")).toBe(true);
    expect(hasCitations("adopted glm's design (3mwycinpusqpl)")).toBe(true);
    expect(hasCitations("a 3abcdefghijk word, one letter short of a key")).toBe(false);
    expect(hasCitations("no keys here")).toBe(false);
  });

  it("audits an all-letter key like any other", async () => {
    const r = await audit(town(post("glm", "3mwzzzzzzzz22", "2026-10-01T12:00:00Z", "see 3mwycinpusqpl"), post("hy3", "3mwycinpusqpl", "2026-10-01T06:00:00Z", "a design")));
    expect(r.citations.find((c) => c.by === "glm.delve.town")!.verdict).toBe("backed");
  });
});
