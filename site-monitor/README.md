# WP Monitor

A self-hosted dashboard for maintaining multiple WordPress sites. For every site it checks, in one sweep:

- **HTTPS response** — reachability, status code, response time, HTTP→HTTPS
- **SSL certificate** — days until expiry (warns before it lapses)
- **Cloudflare** — whether traffic is served through Cloudflare
- **CTM script** — whether the CallTrackingMetrics tracking script is present
- **Google Tag** — whether GTM / GA4 (gtag.js) is present, and the container IDs
- **PageSpeed** — Google PageSpeed Insights performance score + Core Web Vitals
- **Updates** — pending WordPress core, plugin and theme updates (via a helper plugin)

Checks run **on demand** from the dashboard and **on a schedule** in the background, with **alerts** (Slack and/or email) when a site's status changes.

---

## Requirements

- Node.js 18 or newer (`node -v`)
- A Google PageSpeed Insights API key (free, optional but recommended)
- Admin access to each WordPress site to install the small helper plugin (only needed for the update counts)

## Setup

```bash
npm install

cp .env.example .env                       # then edit .env
cp config/sites.example.json config/sites.json   # then edit your sites
```

Edit `.env` (PageSpeed key, schedule, alert channels) and `config/sites.json` (your sites). Then:

```bash
npm start          # dashboard at http://localhost:4000
```

Open the URL, hit **Run checks**, and click any site row for full detail. To run a one-off sweep from the terminal instead:

```bash
npm run check
```

## PageSpeed API key

Without a key you share a tiny anonymous quota and will be rate-limited fast. Create a free key at
https://developers.google.com/speed/docs/insights/v5/get-started and put it in `.env` as `PAGESPEED_API_KEY`.

## WordPress helper plugin (for update counts)

The public-facing checks need no login, but reading pending updates requires talking to each site. Install the helper:

1. Open `wordpress-plugin/wpmonitor-helper.php`.
2. Set a long, unique token per site — change the `WPMONITOR_TOKEN` value (or define `WPMONITOR_TOKEN` in that site's `wp-config.php`, which takes priority).
3. Upload it to the site at `wp-content/mu-plugins/wpmonitor-helper.php`. The `mu-plugins` folder auto-activates the file and clients can't disable it. (Create the folder if it doesn't exist.)
   *Alternative:* put the file in its own folder, zip it, and upload via **Plugins → Add New → Upload**, then activate.
4. In `config/sites.json`, set the matching token and endpoint for that site:

```json
"helper": {
  "enabled": true,
  "endpoint": "https://clientsite.com/wp-json/wpmonitor/v1/status",
  "token": "the-same-token-you-set-in-the-plugin"
}
```

Sites with `"helper": { "enabled": false }` simply show "Not set up" for the Updates column; every other check still runs.

Quick test from your machine:

```bash
curl -H "Authorization: Bearer YOUR_TOKEN" https://clientsite.com/wp-json/wpmonitor/v1/status
```

## Per-site expectations

Each site can declare what it *should* have, so optional integrations don't flag as problems:

```json
"expect": { "cloudflare": true, "ctm": true, "googleTag": true }
```

Set any of these to `false` and a missing script/integration shows a neutral "Not used" instead of a warning or failure.

## Scheduling & alerts

In `.env`:

- `CHECK_CRON` — when background sweeps run (default `0 */6 * * *`, every 6 hours)
- `CHECK_ON_START` — run one sweep immediately when the server boots
- `SLACK_WEBHOOK_URL` — incoming webhook for Slack alerts
- `SMTP_*` + `ALERT_EMAIL_TO` — email alerts via SMTP

Alerts fire only on **status changes** (a check newly degrading, or recovering), so you're not paged about the same issue every cycle. With no channel configured, changes are logged to the console.

## Status meaning

- **OK** (green) — passing
- **Warn** (amber) — needs attention (updates pending, SSL expiring soon, PageSpeed below target, expected integration missing)
- **Fail** (red) — broken (site down, SSL expired/error, required script missing, helper unreachable)
- **Skip** (grey) — not configured for this site (e.g. helper disabled)

Thresholds (`PAGESPEED_WARN`, `PAGESPEED_FAIL`, `SSL_WARN_DAYS`) are tunable in `.env`.

## Keeping it running

For a server, run it under a process manager so it restarts on reboot/crash:

```bash
npm install -g pm2
pm2 start src/server.js --name wp-monitor
pm2 save && pm2 startup
```

## Project layout

```
src/
  server.js        Express API + serves the dashboard
  scheduler.js     cron sweeps + alert dispatch
  runner.js        runs every check per site, rolls up status
  store.js         config + results persistence
  alerts.js        Slack / email, with change detection
  cli.js           one-off terminal sweep
  checks/          one module per check
public/index.html  the dashboard UI
config/sites.json  your sites (you create this)
wordpress-plugin/  the helper plugin to install on each site
```

## Notes

- Script detection reads the homepage HTML. If a tag only loads on inner pages or is injected late by JavaScript, it may read as missing — point the site `url` at a page where the tag is present, or rely on your tag manager's own reporting for those edge cases.
- All checks have timeouts and per-check error handling, so one slow or broken site never blocks the others.
