// Pulls task counts for a site's ClickUp Space and buckets them by status type.
// Uses a ClickUp personal API token (CLICKUP_API_TOKEN). The workspace/team id
// is auto-detected from the token (or set CLICKUP_TEAM_ID to override).

const API = "https://api.clickup.com/api/v2";
const TIMEOUT_MS = 20000;

let cachedTeamId = null;

async function clickupGet(path, token) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(API + path, {
      signal: controller.signal,
      headers: { Authorization: token, "Content-Type": "application/json" },
    });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

async function resolveTeamId(token, override) {
  if (override) return override;
  if (cachedTeamId) return cachedTeamId;
  const res = await clickupGet("/team", token);
  if (!res.ok) throw new Error(`team lookup HTTP ${res.status}`);
  const data = await res.json();
  const teams = data.teams || [];
  if (!teams.length) throw new Error("no workspaces on this token");
  cachedTeamId = teams[0].id; // first workspace; set CLICKUP_TEAM_ID to pin a specific one
  return cachedTeamId;
}

// Fetches every task in a Space (paginated) via the filtered team-tasks endpoint.
async function fetchSpaceTasks(teamId, spaceId, token) {
  const tasks = [];
  for (let page = 0; page < 10; page++) {
    const qs = new URLSearchParams({
      include_closed: "true",
      subtasks: "false",
      page: String(page),
    });
    qs.append("space_ids[]", String(spaceId));
    const res = await clickupGet(`/team/${teamId}/task?${qs}`, token);
    if (res.status === 401) throw new Error("AUTH");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const batch = data.tasks || [];
    tasks.push(...batch);
    if (batch.length < 100) break; // last page
  }
  return tasks;
}

export async function checkClickUp(clickup, settings) {
  if (!settings || !settings.token) {
    return { status: "skip", label: "No token", detail: "ClickUp API token not set" };
  }
  if (!clickup || clickup.enabled === false || !clickup.spaceId) {
    return { status: "skip", label: "Not linked", detail: "No ClickUp Space set for this site" };
  }

  try {
    const teamId = await resolveTeamId(settings.token, settings.teamId);
    const tasks = await fetchSpaceTasks(teamId, clickup.spaceId, settings.token);

    let todo = 0, inProgress = 0, done = 0, overdue = 0;
    const byStatus = new Map();
    const now = Date.now();

    for (const t of tasks) {
      const type = t.status?.type || "open";
      const name = t.status?.status || "unknown";
      const isDone = type === "done" || type === "closed";

      if (isDone) done++;
      else if (type === "open") todo++;
      else inProgress++; // "custom" = in-progress / review / etc.

      if (!isDone && t.due_date && Number(t.due_date) < now) overdue++;

      const key = name;
      const entry = byStatus.get(key) || { name, type, count: 0 };
      entry.count++;
      byStatus.set(key, entry);
    }

    const active = todo + inProgress;
    const order = { open: 0, custom: 1, done: 2, closed: 3 };
    const breakdown = [...byStatus.values()].sort((a, b) => (order[a.type] ?? 1) - (order[b.type] ?? 1));

    const label = active > 0 ? `${active} open` : (done > 0 ? "All clear" : "No tasks");
    const detailParts = [];
    if (todo) detailParts.push(`${todo} to-do`);
    if (inProgress) detailParts.push(`${inProgress} in progress`);
    if (done) detailParts.push(`${done} done`);
    if (overdue) detailParts.push(`⚠ ${overdue} overdue`);

    return {
      status: "info",
      label,
      detail: detailParts.join(" · ") || "No tasks in this Space",
      meta: {
        active, todo, inProgress, done, overdue,
        total: tasks.length,
        byStatus: breakdown,
        spaceUrl: `https://app.clickup.com/${teamId}/v/s/${clickup.spaceId}`,
      },
    };
  } catch (err) {
    if (err.message === "AUTH") {
      return { status: "fail", label: "Auth failed", detail: "ClickUp token rejected" };
    }
    return {
      status: "warn",
      label: "No data",
      detail: err.name === "AbortError" ? "ClickUp timed out" : err.message,
    };
  }
}
