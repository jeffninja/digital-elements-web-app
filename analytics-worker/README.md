# de-analytics — lightweight page-view analytics

A Cloudflare Worker + D1 database that gives the Digital Elements dashboard
Google-Analytics-style "Most visited pages" and "Real-time page views" without
slowing the monitored sites down at all.

How a page view flows:

1. The helper plugin (v2.1.0+) prints a ~300-byte inline script in the footer
   of front-end pages. After the page has finished loading, it fires a single
   `navigator.sendBeacon` POST to this Worker's `/collect` endpoint —
   non-blocking, no cookies, no external JS files, no impact on page speed.
2. The Worker filters bots, hashes the visitor (salted daily hash of
   IP + user agent — irreversible, rotates every UTC day, no PII stored), and
   inserts one row into the `de-analytics` D1 database.
3. The dashboard calls `GET /stats?site=<host>&days=<n>` (Bearer-key protected,
   proxied through `/api/analytics/:siteId` so the key stays server-side) and
   renders live visitors, 24 h totals, daily trend, top pages and referrers.

## Deploy / update

```bash
npx wrangler deploy                 # from this folder
npx wrangler secret put STATS_KEY   # once; same value as ANALYTICS_STATS_KEY in the app's .env
```

The D1 database (id `26f8e5d3-01c3-432a-944f-7c555276fa69`) and its schema
already exist; `schema.sql` is kept for reference. A daily cron prunes rows
older than `RETENTION_DAYS` (default 180).

## Endpoints

- `POST /collect` — public beacon. Body `{s: hostname, p: pathname, r: referrer}`
  as text/plain JSON (avoids CORS preflight). Site is taken from the Origin
  header when present. Always returns 204.
- `GET /stats?site=example.com&days=7` — requires
  `Authorization: Bearer <STATS_KEY>`. Returns realtime (active visitors last
  5 min, per-minute views last 30 min), last-24 h totals, daily series, top 15
  pages, top 10 referrers.
