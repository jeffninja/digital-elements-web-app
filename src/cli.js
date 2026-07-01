// One-off check from the terminal: `npm run check`.
// Useful for cron-on-the-host setups or a quick manual sweep.

import "dotenv/config";
import { loadSettings } from "./store.js";
import { runOnce } from "./scheduler.js";

const settings = loadSettings();

console.log("Running checks…");
const results = await runOnce(settings, { alert: true });

for (const site of Object.values(results.sites)) {
  console.log(`\n${site.overall.toUpperCase().padEnd(4)}  ${site.name}  (${site.url})`);
  for (const [key, c] of Object.entries(site.checks || {})) {
    console.log(`  - ${key.padEnd(11)} ${c.status.padEnd(5)} ${c.label}`);
  }
}
console.log("\nDone.");
