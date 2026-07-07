// Calls the WordPress helper plugin's REST endpoint to read pending core,
// plugin and theme updates. Requires the wpmonitor mu-plugin installed on the
// site and a matching token. See wordpress-plugin/wpmonitor-helper.php.

const TIMEOUT_MS = 20000;
const DEEP_TIMEOUT_MS = 25000; // first-ever scan may run inline on the site

export async function checkPlugins(helper) {
  if (!helper || helper.enabled === false || !helper.endpoint) {
    return { status: "skip", label: "Not set up", detail: "Helper plugin not configured for this site" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(helper.endpoint, {
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${helper.token || ""}`,
        "X-WPMonitor-Token": helper.token || "",
        Accept: "application/json",
      },
    });

    if (res.status === 401 || res.status === 403) {
      return { status: "fail", label: "Auth failed", detail: "Token rejected by helper plugin" };
    }
    if (!res.ok) {
      return { status: "fail", label: `HTTP ${res.status}`, detail: "Helper endpoint error" };
    }

    const data = await res.json();
    const pluginUpdates = Array.isArray(data.plugin_updates) ? data.plugin_updates : [];
    const themeUpdates = Array.isArray(data.theme_updates) ? data.theme_updates : [];
    const coreUpdate = Boolean(data.core_update_available);

    const total = pluginUpdates.length + themeUpdates.length + (coreUpdate ? 1 : 0);

    const meta = {
      wpVersion: data.wp_version || null,
      phpVersion: data.php_version || null,
      coreUpdate,
      coreNewVersion: data.core_new_version || null,
      pluginUpdates,
      themeUpdates,
    };

    if (total === 0) {
      return { status: "ok", label: "Up to date", detail: `WP ${meta.wpVersion || "?"} · PHP ${meta.phpVersion || "?"}`, meta };
    }

    const parts = [];
    if (pluginUpdates.length) parts.push(`${pluginUpdates.length} plugin${pluginUpdates.length > 1 ? "s" : ""}`);
    if (themeUpdates.length) parts.push(`${themeUpdates.length} theme${themeUpdates.length > 1 ? "s" : ""}`);
    if (coreUpdate) parts.push("core");

    return { status: "warn", label: `${total} update${total > 1 ? "s" : ""}`, detail: parts.join(", "), meta };
  } catch (err) {
    return {
      status: "fail",
      label: "Unreachable",
      detail: err.name === "AbortError" ? "Helper timed out" : err.message,
    };
  } finally {
    clearTimeout(timer);
  }
}

// Reads the helper plugin's deep server-side scan (/security). The plugin runs
// the heavy scan on a daily cron and caches it, so this call is normally instant.
// Returns null when there's no helper, or { ok, findings, ... } / { ok:false }.
export async function getDeepSecurity(helper) {
  if (!helper || helper.enabled === false || !helper.endpoint) return null;
  const url = helper.endpoint.replace(/\/status\/?$/, "/security");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEEP_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${helper.token || ""}`,
        "X-WPMonitor-Token": helper.token || "",
        Accept: "application/json",
      },
    });
    if (res.status === 404) return { ok: false, reason: "unsupported" }; // older plugin (<1.3)
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
    const data = await res.json();
    return {
      ok: true,
      scannedAt: data.scanned_at || null,
      filesScanned: data.files_scanned || 0,
      partial: !!data.partial,
      findings: Array.isArray(data.findings) ? data.findings : [],
    };
  } catch (err) {
    return { ok: false, reason: err.name === "AbortError" ? "timeout" : err.message };
  } finally {
    clearTimeout(timer);
  }
}
