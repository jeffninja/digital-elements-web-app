// Schedules background checks and dispatches alerts when statuses change.

import cron from "node-cron";
import { loadSites, loadResults, saveResults } from "./store.js";
import { runAll } from "./runner.js";
import { diffRuns, dispatchAlerts } from "./alerts.js";

let isRunning = false;

// Runs a full sweep, persists it, and alerts on any change vs. the prior run.
export async function runOnce(settings, { alert = false } = {}) {
  if (isRunning) return { skipped: true };
  isRunning = true;
  try {
    const previous = loadResults();
    const sites = await loadSites();
    const fresh = await runAll(sites, settings);
    saveResults(fresh);

    if (alert) {
      const lines = diffRuns(previous, fresh);
      await dispatchAlerts(settings, lines);
    }
    return fresh;
  } finally {
    isRunning = false;
  }
}

export function isCheckRunning() {
  return isRunning;
}

export function startScheduler(settings) {
  if (!cron.validate(settings.cron)) {
    console.error(`[scheduler] Invalid CHECK_CRON "${settings.cron}" — scheduler disabled.`);
    return;
  }
  cron.schedule(settings.cron, () => {
    console.log("[scheduler] Running scheduled check…");
    runOnce(settings, { alert: true }).catch((err) =>
      console.error("[scheduler] Run failed:", err.message)
    );
  });
  console.log(`[scheduler] Background checks scheduled: "${settings.cron}"`);
}
