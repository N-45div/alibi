/** Pulls the published data files into public/data for a build: node scripts/fetch-data.ts
 * The data is derived from the gated AI Village dataset, so it never enters the repo. Git builds (previews and
 * production) copy what the live demo already serves. A local public/data/ is left alone. */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";

const origin = process.env.ALIBI_DATA_ORIGIN ?? "https://alibi-one.vercel.app";
const dir = "public/data";
if (existsSync(`${dir}/index.json`)) {
  console.log(`${dir} is already here, nothing to fetch`);
  process.exit(0);
}

async function get(path: string): Promise<string> {
  const r = await fetch(`${origin}/data/${path}`);
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  const text = await r.text();
  JSON.parse(text); // a broken file fails the build instead of shipping
  return text;
}

const index = await get("index.json");
const days = [...new Set((JSON.parse(index) as [string, string][]).map((r) => r[1]))];
const files = ["overview.json", "summaries.json", "delve.json", ...days.map((d) => `days/${d}.json`)];
const fetched = await Promise.all(files.map(get));
mkdirSync(`${dir}/days`, { recursive: true });
files.forEach((f, i) => writeFileSync(`${dir}/${f}`, fetched[i]));
writeFileSync(`${dir}/index.json`, index); // written last: its presence means the set is complete
console.log(`fetched ${files.length + 1} data files from ${origin}`);
