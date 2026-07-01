# Deploying the Site Monitor (Supabase + Google login)

This is the launch guide for the multi-user version: Google sign-in, roles, and a
Supabase database. It assumes you've never deployed a Node app before. Follow it
top to bottom.

Because the app runs a background scheduler every few minutes and needs to stay
awake, it must run as a **persistent process** — not on Vercel. This guide uses
**Railway** (easiest persistent Node host), but any always-on server works
(Render paid tier, a DigitalOcean droplet with pm2, your own VPS).

---

## Overview of what you'll set up

1. A **Supabase** project (the database).
2. A **Google OAuth** client (so people can sign in with Google).
3. **Environment variables** (secrets the app reads).
4. The app running on **Railway** with a public HTTPS URL.
5. Your first **admin** login, then adding the rest of the team.

---

## Step 1 — Create the Supabase database

1. Go to https://supabase.com, sign up, and click **New project**. Pick a name, a
   strong database password (save it), and a region near you. Wait ~2 minutes for
   it to provision.
2. In the left sidebar open **SQL Editor → New query**. Open the file
   `db/schema.sql` from this project, paste its entire contents in, and click
   **Run**. This creates the `app_users`, `websites`, `social_links`, and
   `session` tables. You should see "Success".
3. Get the connection string: **Project Settings → Database → Connection string →
   URI**, and switch the toggle to **Connection pooling** (port 6543). Copy it. It
   looks like:
   `postgresql://postgres.xxxx:[YOUR-PASSWORD]@aws-0-...pooler.supabase.com:6543/postgres`
   Replace `[YOUR-PASSWORD]` with the database password from step 1. This whole
   string is your `DATABASE_URL`.

## Step 2 — Create the Google sign-in credentials

1. Go to https://console.cloud.google.com. Create a project (top bar → New
   Project) or pick one.
2. **APIs & Services → OAuth consent screen**: choose **Internal** if your company
   uses Google Workspace (recommended — only your org can sign in), otherwise
   **External**. Fill in the app name and your email. Save.
3. **APIs & Services → Credentials → Create Credentials → OAuth client ID**:
   - Application type: **Web application**
   - Authorized redirect URIs — add **both** of these (you'll get the real domain
     in Step 4; add it now or come back):
     - `http://localhost:4000/auth/google/callback` (for local testing)
     - `https://YOUR-APP.up.railway.app/auth/google/callback` (your live URL)
   - Click **Create**. Copy the **Client ID** and **Client secret**.

## Step 3 — Gather your environment variables

Copy `.env.example` to `.env` for local testing, and fill these in (you'll paste
the same values into Railway later):

```
PUBLIC_URL=http://localhost:4000          # locally; your Railway URL in production
DATABASE_URL=postgresql://...:6543/postgres
SESSION_SECRET=                            # generate with the command below
ADMIN_EMAILS=you@yourcompany.com           # your Google email = first admin
GOOGLE_CLIENT_ID=...apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=...
PAGESPEED_API_KEY=...                       # from before
CLICKUP_API_TOKEN=pk_...                    # from before
CHECK_CRON=*/2 * * * *
SLACK_WEBHOOK_URL=...
```

Generate a session secret:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

## Step 4 — Test locally first

```bash
npm install
npm start
```

Open http://localhost:4000 — you'll be redirected to the login page. Click **Sign
in with Google** and use the email you put in `ADMIN_EMAILS`. You should land on
the dashboard as an Administrator. Your existing `config/sites.json` (if present)
is imported into the database automatically on first run.

If it won't start, the console prints exactly which environment variable is
missing.

## Step 5 — Put the code on GitHub

1. Create a free account at https://github.com and a new **private** repository
   (e.g. `site-monitor`).
2. In the project folder:

```bash
git init
git add .
git commit -m "Site monitor"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/site-monitor.git
git push -u origin main
```

`.env` and `node_modules` are already git-ignored, so your secrets don't get
uploaded. Good.

## Step 6 — Deploy on Railway

1. Go to https://railway.app and sign in with GitHub.
2. **New Project → Deploy from GitHub repo →** pick your repo. Railway detects
   Node and runs `npm start` automatically.
3. Open the service → **Variables** tab → add every variable from your `.env`
   (Step 3). For `PUBLIC_URL`, use the domain Railway gives you (next step).
4. **Settings → Networking → Generate Domain**. Copy the URL
   (e.g. `https://site-monitor-production.up.railway.app`). Set `PUBLIC_URL` to it
   (no trailing slash), and add `PUBLIC_URL/auth/google/callback` to your Google
   OAuth **Authorized redirect URIs** (Step 2).
5. Railway redeploys on each `git push`. Once it's live, open the URL, sign in with
   your admin Google account, and you're running in production over HTTPS.

## Step 7 — Add your team

Signed in as admin, click **Users** in the header. Add each teammate by their
company Google email and pick a role. They sign in with Google; anyone whose email
isn't in the list is refused.

## Roles & permissions

| Role            | View | Add/edit sites | Delete sites | Manage users | Social links |
|-----------------|------|----------------|--------------|--------------|--------------|
| Administrator   | ✓    | ✓              | ✓            | ✓            | ✓            |
| Web Developer   | ✓    | ✓              | —            | —            | ✓            |
| Social Media    | ✓    | —              | —            | —            | ✓            |
| SEO             | ✓    | —              | —            | —            | —            |
| Publisher       | ✓    | —              | —            | —            | —            |

Permissions are enforced on the server, not just hidden in the UI — a viewer can't
add or delete anything even by calling the API directly.

## Adding websites (no more editing files)

Web Developers and Admins get a **+ Website** button in the header. It asks for the
name, URL, ClickUp List IDs (comma-separated — find them with
`node src/list-spaces.js`), the check expectations, and optional helper endpoint +
token. Edit and Delete live in each site's expanded detail panel.

## Notes & limits

- **Cost:** Supabase and Railway both have free tiers to start; Railway's free
  usage is limited and a persistent app may need its ~$5/mo hobby plan. Supabase's
  free tier is generous for this data volume.
- **Sessions** are stored in Supabase (the `session` table) and last 7 days.
- **HTTPS is required** in production for secure login cookies — Railway/Render
  give you HTTPS automatically. Don't run the public site on plain HTTP.
- **Check results** (`data/results.json`) are still a local file; they regenerate
  every sweep, so they don't need the database.
- To rotate any secret, change it in Railway's Variables and redeploy.
