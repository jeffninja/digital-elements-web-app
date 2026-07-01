// Sends alerts to Slack and/or email. Only called by the scheduler, and only
// for checks that have newly degraded (or recovered) since the previous run, so
// you are not paged about the same problem every cycle.
//
// Slack messages are grouped per site using Block Kit for readability:
//
//   WP Monitor — status changes
//   ──────────────────────────
//   Brandywine Mental Health
//     🔴 PageSpeed — 74  ·  mobile · LCP 2.2 s
//     🟡 Updates — 4 updates  ·  3 plugins, 1 theme
//   ──────────────────────────
//   Digital Elements Development Site
//     🟢 CTM script recovered — Detected

import nodemailer from "nodemailer";

const CHECK_LABELS = {
  https: "HTTPS",
  ssl: "SSL certificate",
  cloudflare: "Cloudflare",
  ctm: "CTM script",
  googleTag: "Google Tag",
  pagespeed: "PageSpeed",
  plugins: "Updates",
};

const RANK = { ok: 0, skip: 0, warn: 1, fail: 2 };
const EMOJI = { fail: "🔴", warn: "🟡", ok: "🟢", skip: "⚪" };

// Compares a fresh run to the previous one and returns an array of per-site
// groups, each holding the checks that changed. Array length = sites changed,
// so callers can still test `.length`.
export function diffRuns(previous, current) {
  const groups = [];

  for (const [id, site] of Object.entries(current.sites || {})) {
    const prevSite = previous?.sites?.[id];
    const changes = [];

    for (const [key, check] of Object.entries(site.checks || {})) {
      const was = prevSite?.checks?.[key]?.status || "ok";
      const now = check.status;
      if (was === now) continue;

      const name = CHECK_LABELS[key] || key;
      if (RANK[now] > RANK[was]) {
        // Newly degraded.
        changes.push({ now, name, label: check.label, detail: check.detail || "", recovered: false });
      } else if (RANK[now] < RANK[was] && now === "ok") {
        // Back to healthy.
        changes.push({ now, name, label: check.label, detail: check.detail || "", recovered: true });
      }
    }

    if (changes.length) {
      // Worst current change drives the site's headline emoji.
      changes.sort((a, b) => RANK[b.now] - RANK[a.now]);
      groups.push({ id, name: site.name, url: site.url, overall: site.overall, changes });
    }
  }
  return groups;
}

// ---- Formatting ----

function changeLine(c) {
  const head = c.recovered ? `${c.name} recovered` : c.name;
  const body = c.detail ? `${c.label}  ·  ${c.detail}` : c.label;
  return `${EMOJI[c.now]}  *${head}* — ${body}`;
}

function buildSlackBlocks(groups) {
  const total = groups.reduce((n, g) => n + g.changes.length, 0);
  const blocks = [
    {
      type: "header",
      text: { type: "plain_text", text: "🛠  WP Monitor — status changes", emoji: true },
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `${groups.length} site${groups.length > 1 ? "s" : ""} · ${total} change${total > 1 ? "s" : ""} · ${new Date().toLocaleString()}`,
        },
      ],
    },
    { type: "divider" },
  ];

  for (const g of groups) {
    const heading = `${EMOJI[g.overall] || "⚪"}  *<${g.url}|${g.name}>*`;
    const lines = g.changes.map(changeLine).join("\n");
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `${heading}\n${lines}` },
    });
    blocks.push({ type: "divider" });
  }
  blocks.pop(); // drop trailing divider
  return blocks;
}

function buildText(groups) {
  const out = ["WP Monitor — status changes", ""];
  for (const g of groups) {
    out.push(`${g.name} (${g.url})`);
    for (const c of g.changes) {
      const head = c.recovered ? `${c.name} recovered` : c.name;
      const body = c.detail ? `${c.label} — ${c.detail}` : c.label;
      out.push(`  ${EMOJI[c.now]} ${head}: ${body}`);
    }
    out.push("");
  }
  return out.join("\n").trim();
}

// ---- Channels ----

async function postSlack(webhook, payload) {
  try {
    const res = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) console.error("[alerts] Slack returned", res.status, await res.text());
  } catch (err) {
    console.error("[alerts] Slack error:", err.message);
  }
}

async function sendSlack(webhook, groups) {
  const total = groups.reduce((n, g) => n + g.changes.length, 0);
  const summary = `WP Monitor: ${groups.length} site(s), ${total} status change(s)`;

  // Slack caps a message at 50 blocks; send sites in chunks to stay safe.
  const CHUNK = 18; // ~2 blocks per site + header
  for (let i = 0; i < groups.length; i += CHUNK) {
    const slice = groups.slice(i, i + CHUNK);
    await postSlack(webhook, { text: summary, blocks: buildSlackBlocks(slice) });
  }
}

async function sendEmail(smtp, groups) {
  const transport = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
  });
  const total = groups.reduce((n, g) => n + g.changes.length, 0);
  try {
    await transport.sendMail({
      from: smtp.from || smtp.user,
      to: smtp.to,
      subject: `WP Monitor — ${total} status change(s) across ${groups.length} site(s)`,
      text: buildText(groups),
    });
  } catch (err) {
    console.error("[alerts] Email error:", err.message);
  }
}

export async function dispatchAlerts(settings, groups) {
  if (!groups || !groups.length) return;
  if (settings.slackWebhook) await sendSlack(settings.slackWebhook, groups);
  if (settings.smtp.host && settings.smtp.to) await sendEmail(settings.smtp, groups);
  if (!settings.slackWebhook && !settings.smtp.host) {
    console.log("[alerts] (no channel configured)\n" + buildText(groups));
  }
}
