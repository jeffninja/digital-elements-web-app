// Loads runtime config from environment + config/sites.json, and persists the
// most recent check results to data/results.json so the dashboard has data on
// load and the scheduler can detect status changes.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const SITES_PATH = path.join(ROOT, "config", "sites.json");
const RESULTS_PATH = path.join(ROOT, "data", "results.json");

export function loadSites() {
  if (!fs.existsSync(SITES_PATH)) {
    throw new Error(
      "config/sites.json not found. Copy config/sites.example.json to config/sites.json and edit it."
    );
  }
  const parsed = JSON.parse(fs.readFileSync(SITES_PATH, "utf8"));
  if (!Array.isArray(parsed.sites)) throw new Error("config/sites.json must contain a 'sites' array");
  return parsed.sites;
}

export function loadSettings() {
  const num = (v, d) => (v === undefined || v === "" ? d : Number(v));
  const bool = (v, d) => (v === undefined ? d : String(v).toLowerCase() === "true");
  return {
    port: num(process.env.PORT, 4000),
    pageSpeed: {
      apiKey: process.env.PAGESPEED_API_KEY || "",
      strategy: process.env.PAGESPEED_STRATEGY || "mobile",
      warn: num(process.env.PAGESPEED_WARN, 90),
      fail: num(process.env.PAGESPEED_FAIL, 50),
    },
    sslWarnDays: num(process.env.SSL_WARN_DAYS, 14),
    clickup: {
      token: process.env.CLICKUP_API_TOKEN || "",
      teamId: process.env.CLICKUP_TEAM_ID || "",
    },
    cron: process.env.CHECK_CRON || "0 */6 * * *",
    checkOnStart: bool(process.env.CHECK_ON_START, true),
    slackWebhook: process.env.SLACK_WEBHOOK_URL || "",
    smtp: {
      host: process.env.SMTP_HOST || "",
      port: num(process.env.SMTP_PORT, 587),
      secure: bool(process.env.SMTP_SECURE, false),
      user: process.env.SMTP_USER || "",
      pass: process.env.SMTP_PASS || "",
      from: process.env.ALERT_EMAIL_FROM || "",
      to: process.env.ALERT_EMAIL_TO || "",
    },
  };
}

export function loadResults() {
  try {
    return JSON.parse(fs.readFileSync(RESULTS_PATH, "utf8"));
  } catch {
    return { lastRun: null, running: false, sites: {} };
  }
}

export function saveResults(results) {
  fs.mkdirSync(path.dirname(RESULTS_PATH), { recursive: true });
  fs.writeFileSync(RESULTS_PATH, JSON.stringify(results, null, 2));
}
