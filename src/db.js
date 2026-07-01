// PostgreSQL data layer (Supabase). Uses a direct connection (DATABASE_URL).
// Enforcement of who-can-do-what lives in the app (see auth.js); this module is
// just typed data access.

import pg from "pg";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const { Pool } = pg;

let pool = null;

export function getPool() {
  if (pool) return pool;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set. Copy it from Supabase > Project Settings > Database.");
  }
  pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false }, // Supabase requires SSL
    max: 5,
  });
  return pool;
}

export function query(text, params) {
  return getPool().query(text, params);
}

// ---- Row -> runner shape --------------------------------------------------
// The checks/runner expect: { id, name, url, helper:{...}, expect:{...}, clickup:{...} }
function rowToSite(r) {
  return {
    id: r.id,
    name: r.name,
    url: r.url,
    helper: {
      enabled: r.helper_enabled,
      endpoint: r.helper_endpoint || undefined,
      token: r.helper_token || undefined,
    },
    expect: {
      cloudflare: r.expect_cloudflare,
      ctm: r.expect_ctm,
      googleTag: r.expect_google_tag,
    },
    clickup: {
      enabled: r.clickup_enabled,
      listIds: r.clickup_list_ids || [],
      folderId: r.clickup_folder_id || undefined,
      spaceId: r.clickup_space_id || undefined,
    },
  };
}

// ---- Websites -------------------------------------------------------------
export async function getWebsites() {
  const { rows } = await query("select * from websites order by name asc");
  return rows.map(rowToSite);
}

export async function getWebsiteRaw(id) {
  const { rows } = await query("select * from websites where id = $1", [id]);
  return rows[0] || null;
}

export async function getWebsiteSite(id) {
  const raw = await getWebsiteRaw(id);
  return raw ? rowToSite(raw) : null;
}

export async function createWebsite(d, userId) {
  const { rows } = await query(
    `insert into websites
      (name,url,helper_enabled,helper_endpoint,helper_token,
       expect_cloudflare,expect_ctm,expect_google_tag,
       clickup_enabled,clickup_list_ids,clickup_folder_id,clickup_space_id,created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     returning *`,
    [
      d.name, d.url, !!d.helper_enabled, d.helper_endpoint || null, d.helper_token || null,
      d.expect_cloudflare !== false, d.expect_ctm !== false, d.expect_google_tag !== false,
      !!d.clickup_enabled, d.clickup_list_ids || [], d.clickup_folder_id || null, d.clickup_space_id || null,
      userId || null,
    ]
  );
  return rowToSite(rows[0]);
}

export async function updateWebsite(id, d) {
  const { rows } = await query(
    `update websites set
       name=$2,url=$3,helper_enabled=$4,helper_endpoint=$5,helper_token=$6,
       expect_cloudflare=$7,expect_ctm=$8,expect_google_tag=$9,
       clickup_enabled=$10,clickup_list_ids=$11,clickup_folder_id=$12,clickup_space_id=$13,
       updated_at=now()
     where id=$1 returning *`,
    [
      id, d.name, d.url, !!d.helper_enabled, d.helper_endpoint || null, d.helper_token || null,
      d.expect_cloudflare !== false, d.expect_ctm !== false, d.expect_google_tag !== false,
      !!d.clickup_enabled, d.clickup_list_ids || [], d.clickup_folder_id || null, d.clickup_space_id || null,
    ]
  );
  return rows[0] ? rowToSite(rows[0]) : null;
}

export async function deleteWebsite(id) {
  await query("delete from websites where id = $1", [id]);
}

// ---- Users ----------------------------------------------------------------
export async function listUsers() {
  const { rows } = await query("select id,email,name,role,created_at,last_login from app_users order by email");
  return rows;
}
export async function getUserByEmail(email) {
  const { rows } = await query("select * from app_users where lower(email)=lower($1)", [email]);
  return rows[0] || null;
}
export async function getUserById(id) {
  const { rows } = await query("select * from app_users where id = $1", [id]);
  return rows[0] || null;
}
export async function createUser(email, role, name) {
  const { rows } = await query(
    "insert into app_users (email,role,name) values ($1,$2,$3) on conflict (email) do update set role=excluded.role returning *",
    [email.trim().toLowerCase(), role, name || null]
  );
  return rows[0];
}
export async function updateUserRole(id, role) {
  const { rows } = await query("update app_users set role=$2 where id=$1 returning *", [id, role]);
  return rows[0] || null;
}
export async function deleteUser(id) {
  await query("delete from app_users where id = $1", [id]);
}
export async function touchLogin(id, name) {
  await query("update app_users set last_login=now(), name=coalesce($2,name) where id=$1", [id, name || null]);
}

// ---- Social links ---------------------------------------------------------
export async function getSocialLinks(websiteId) {
  const { rows } = await query("select id,platform,url from social_links where website_id=$1 order by platform", [websiteId]);
  return rows;
}
export async function addSocialLink(websiteId, platform, url, userId) {
  const { rows } = await query(
    "insert into social_links (website_id,platform,url,created_by) values ($1,$2,$3,$4) returning id,platform,url",
    [websiteId, platform, url, userId || null]
  );
  return rows[0];
}
export async function deleteSocialLink(id) {
  await query("delete from social_links where id = $1", [id]);
}

// ---- Startup: bootstrap admins + migrate sites.json ------------------------
export async function bootstrap() {
  // Ensure schema essentials exist (idempotent) in case SQL wasn't run.
  await query(`create extension if not exists "pgcrypto"`);

  // Seed admin emails from env so someone can log in the first time.
  const admins = (process.env.ADMIN_EMAILS || "")
    .split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  for (const email of admins) {
    await query(
      "insert into app_users (email,role) values ($1,'admin') on conflict (email) do update set role='admin'",
      [email]
    );
  }

  // One-time import of an existing config/sites.json into the websites table.
  const { rows } = await query("select count(*)::int as n from websites");
  if (rows[0].n === 0) {
    const p = path.join(ROOT, "config", "sites.json");
    if (fs.existsSync(p)) {
      try {
        const { sites = [] } = JSON.parse(fs.readFileSync(p, "utf8"));
        for (const s of sites) {
          await createWebsite({
            name: s.name || s.id,
            url: s.url,
            helper_enabled: s.helper?.enabled,
            helper_endpoint: s.helper?.endpoint,
            helper_token: s.helper?.token,
            expect_cloudflare: s.expect?.cloudflare,
            expect_ctm: s.expect?.ctm,
            expect_google_tag: s.expect?.googleTag,
            clickup_enabled: s.clickup?.enabled,
            clickup_list_ids: s.clickup?.listIds || [],
            clickup_folder_id: s.clickup?.folderId,
            clickup_space_id: s.clickup?.spaceId,
          }, null);
        }
        console.log(`[db] Imported ${sites.length} site(s) from config/sites.json into the database.`);
      } catch (err) {
        console.error("[db] sites.json import skipped:", err.message);
      }
    }
  }
}
