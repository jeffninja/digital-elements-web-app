// Express server. Serves the dashboard and a small JSON API, and starts the
// background scheduler. On-demand checks are triggered from the dashboard.

import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadSettings, loadResults, loadSites } from "./store.js";
import { runOnce, startScheduler, isCheckRunning } from "./scheduler.js";
import { getClickUpTasks } from "./checks/clickup.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const settings = loadSettings();
const app = express();

app.use(express.static(path.join(__dirname, "..", "public")));

// Current results (whatever was last saved).
app.get("/api/results", (req, res) => {
  const results = loadResults();
  results.running = isCheckRunning();
  res.json(results);
});

// Trigger an on-demand sweep. Returns immediately; poll /api/results for output.
app.post("/api/check", async (req, res) => {
  if (isCheckRunning()) return res.json({ started: false, running: true });
  res.json({ started: true });
  runOnce(settings, { alert: false }).catch((err) =>
    console.error("[server] On-demand check failed:", err.message)
  );
});

app.get("/api/health", (req, res) => res.json({ ok: true }));

// Full task list for one site, fetched live from ClickUp (for the modal).
app.get("/api/tasks/:siteId", async (req, res) => {
  let site;
  try {
    site = loadSites().find((s) => s.id === req.params.siteId);
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
  if (!site) return res.status(404).json({ ok: false, error: "Unknown site" });
  const result = await getClickUpTasks(site.clickup, settings.clickup);
  res.json(result);
});

app.listen(settings.port, () => {
  console.log(`\n  WP Monitor running at http://localhost:${settings.port}\n`);
  startScheduler(settings);
  if (settings.checkOnStart) {
    console.log("[server] Running initial check on startup…");
    runOnce(settings, { alert: false }).catch((err) =>
      console.error("[server] Startup check failed:", err.message)
    );
  }
});
