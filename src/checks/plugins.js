// Calls the WordPress helper plugin's REST endpoint to read pending core,
// plugin and theme updates. Requires the wpmonitor mu-plugin installed on the
// site and a matching token. See wordpress-plugin/wpmonitor-helper.php.

const TIMEOUT_MS = 20000;

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
