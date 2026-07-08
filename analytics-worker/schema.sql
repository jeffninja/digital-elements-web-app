-- Digital Elements Analytics — D1 schema.
-- Already applied to the "de-analytics" database (id 26f8e5d3-01c3-432a-944f-7c555276fa69).
-- Kept here for reference / re-creation:  npx wrangler d1 execute de-analytics --remote --file=schema.sql

CREATE TABLE IF NOT EXISTS pageviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site TEXT NOT NULL,          -- hostname, www. stripped (e.g. example.com)
  path TEXT NOT NULL,          -- pathname only, no query string
  ref TEXT,                    -- external referrer hostname, NULL if direct/self
  visitor TEXT NOT NULL,       -- salted daily hash (no PII, rotates every UTC day)
  country TEXT,                -- ISO code from Cloudflare edge
  device TEXT,                 -- mobile | desktop
  ts INTEGER NOT NULL          -- unix seconds
);

CREATE INDEX IF NOT EXISTS idx_pv_site_ts ON pageviews(site, ts);
CREATE INDEX IF NOT EXISTS idx_pv_site_path_ts ON pageviews(site, path, ts);
