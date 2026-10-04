/** AWS Lambda entry for @alibi: one pass over new mentions per invocation, on a 2-minute schedule.
 * Needs DELVE_BOT_HANDLE, DELVE_BOT_PASSWORD (an app password) and DELVE_BOT_STATE under /tmp.
 * Bundle: npx esbuild scripts/delve-bot-lambda.ts --bundle --platform=node --format=esm --outfile=index.mjs */
import { run } from "./delve-bot.ts";

export const handler = async () => {
  await run(false);
};
