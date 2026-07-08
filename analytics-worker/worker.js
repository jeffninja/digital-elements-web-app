// Digital Elements Analytics — Cloudflare Worker
//
// Privacy-friendly, lightweight page-view analytics for the monitored sites
// (think "self-hosted Plausible in 200 lines"). Two endpoints:
//
//   POST /collect   public beacon hit from visitors' browsers (~0.3 KB, no
//                   cookies, no fingerprinting stored — visitors are counted
//                   with a salted daily hash that can't be reversed).
//   GET  /stats     read API for the dashboard. Requires
//                   "Authorization: Bearer <STATS_KEY>".
//
// Bindings (see wrangler.toml):
//   DB          D1 database "de-analytics"
//   STATS_KEY   secret — auth for /stats and salt input for visitor hashes
//               (set with: npx wrangler secret put STATS_KEY)
//   RETENTION_DAYS  optional var, default 180 — daily cron prunes older rows.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const BOT_RE = /bot|crawl|spider|slurp|preview|scan|monitor|curl|wget|python-requests|headless|lighthouse|pingdom|uptime|facebookexternalhit/i;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (url.pathname === "/collect" && request.method === "POST") return collect(request, env, ctx);
    if (url.pathname === "/stats" && request.method === "GET") return stats(request, env, url);
    return new Response("Not found", { status: 404 });
  },

  // Daily retention prune (cron in wrangler.toml).
  async scheduled(event, env, ctx) {
    const days = Math.max(30, Number(env.RETENTION_DAYS) || 180);
    const cutoff = Math.floor(Date.now() / 1000) - days * 86400;
    ctx.waitUntil(env.DB.prepare("DELETE FROM pageviews WHERE ts < ?").bind(cutoff).run());
  },
};

// ---------------------------------------------------------------------------
// Ingest
// ---------------------------------------------------------------------------
async function collect(request, env, ctx) {
  const done = new Response(null, { status: 204, headers: CORS });
  try {
    const ua = request.headers.get("user-agent") || "";
    if (!ua || BOT_RE.test(ua)) return done;

    // Site = hostname of the page that sent the beacon (Origin header is set
    // automatically by browsers on cross-origin POST; body value is fallback).
    let body = {};
    try { body = JSON.parse(await request.text()); } catch { return done; }
    const origin = request.headers.get("origin") || request.headers.get("referer") || "";
    let site = "";
    try { site = new URL(origin).hostname; } catch {}
    if (!site) site = String(body.s || "").toLowerCase().slice(0, 128);
    site = site.replace(/^www\./, "");
    if (!site || !/^[a-z0-9.-]+$/.test(site)) return done;

    let path = String(body.p || "/").slice(0, 512);
    if (!path.startsWith("/")) path = "/" + path;
    path = path.replace(/\/+$/, "") || "/";

    // Referrer: keep the external hostname only; drop self-referrals.
    let ref = null;
    try {
      const rh = new URL(String(body.r || "")).hostname.replace(/^www\./, "");
      if (rh && rh !== site) ref = rh.slice(0, 128);
    } catch {}

    // Privacy-friendly visitor id: salted daily hash of IP + UA + site.
    // Rotates every UTC day and cannot be reversed; no cookies involved.
    const ip = request.headers.get("cf-connecting-ip") || "";
    const day = new Date().toISOString().slice(0, 10);
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(`${env.STATS_KEY || "salt"}|${day}|${ip}|${ua}|${site}`)
    );
    const visitor = [...new Uint8Array(digest)].slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");

    const device = /mobile|android|iphone|ipad/i.test(ua) ? "mobile" : "desktop";
    const country = (request.cf && request.cf.country) || null;
    const ts = Math.floor(Date.now() / 1000);

    ctx.waitUntil(
      env.DB.prepare(
        "INSERT INTO pageviews (site, path, ref, visitor, country, device, ts) VALUES (?,?,?,?,?,?,?)"
      ).bind(site, path, ref, visitor, country, device, ts).run()
    );
  } catch {}
  return done; // never make the visitor's browser wait or error
}

// ---------------------------------------------------------------------------
// Stats API (dashboard only)
// ---------------------------------------------------------------------------
async function stats(request, env, url) {
  const auth = request.headers.get("authorization") || "";
  if (!env.STATS_KEY || auth !== `Bearer ${env.STATS_KEY}`) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }
  const site = String(url.searchParams.get("site") || "").toLowerCase().replace(/^www\./, "");
  if (!site) return json({ ok: false, error: "site required" }, 400);
  const days = Math.min(90, Math.max(1, Math.round(Number(url.searchParams.get("days")) || 7)));

  const now = Math.floor(Date.now() / 1000);
  const since = now - days * 86400;
  const live5m = now - 300;
  const last30m = now - 1800;
  const last24h = now - 86400;

  const [top, refs, daily, realtime, minutes, totals] = await Promise.all([
    env.DB.prepare(
      `SELECT path, COUNT(*) views, COUNT(DISTINCT visitor) visitors
       FROM pageviews WHERE site=? AND ts>=? GROUP BY path ORDER BY views DESC LIMIT 15`
    ).bind(site, since).all(),
    env.DB.prepare(
      `SELECT ref, COUNT(*) views FROM pageviews
       WHERE site=? AND ts>=? AND ref IS NOT NULL GROUP BY ref ORDER BY views DESC LIMIT 10`
    ).bind(site, since).all(),
    env.DB.prepare(
      `SELECT date(ts,'unixepoch') day, COUNT(*) views, COUNT(DISTINCT visitor) visitors
       FROM pageviews WHERE site=? AND ts>=? GROUP BY day ORDER BY day`
    ).bind(site, since).all(),
    env.DB.prepare(
      `SELECT COUNT(DISTINCT visitor) active, COUNT(*) views
       FROM pageviews WHERE site=? AND ts>=?`
    ).bind(site, live5m).first(),
    env.DB.prepare(
      `SELECT (ts/60)*60 minute, COUNT(*) views
       FROM pageviews WHERE site=? AND ts>=? GROUP BY minute ORDER BY minute`
    ).bind(site, last30m).all(),
    env.DB.prepare(
      `SELECT COUNT(*) views, COUNT(DISTINCT visitor) visitors
       FROM pageviews WHERE site=? AND ts>=?`
    ).bind(site, last24h).first(),
  ]);

  return json({
    ok: true,
    site,
    days,
    realtime: {
      activeVisitors: realtime?.active || 0,
      viewsLast5m: realtime?.views || 0,
      perMinute: minutes.results || [], // last 30 min, unix-minute buckets
    },
    last24h: { views: totals?.views || 0, visitors: totals?.visitors || 0 },
    topPages: top.results || [],
    topReferrers: refs.results || [],
    daily: daily.results || [],
    generatedAt: now,
  });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}
