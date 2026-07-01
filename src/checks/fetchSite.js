// Fetches a site's homepage once. HTTPS, Cloudflare, CTM and Google Tag checks
// all derive from this single request to avoid hammering the site.

const TIMEOUT_MS = 20000;
const USER_AGENT =
  "WP-Monitor/1.0 (+https://github.com/your-agency/wp-monitor) Node fetch";

export async function fetchSite(rawUrl) {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  // Normalise: default to https:// if no scheme given.
  let url = rawUrl.trim();
  if (!/^https?:\/\//i.test(url)) url = "https://" + url;

  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml",
      },
    });

    const body = await res.text();
    const responseTimeMs = Date.now() - startedAt;

    // Collect headers into a plain lowercase-keyed object.
    const headers = {};
    res.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });

    return {
      ok: true,
      requestedUrl: url,
      finalUrl: res.url,
      status: res.status,
      isHttps: res.url.startsWith("https://"),
      responseTimeMs,
      headers,
      body,
    };
  } catch (err) {
    return {
      ok: false,
      requestedUrl: url,
      finalUrl: null,
      status: null,
      isHttps: null,
      responseTimeMs: Date.now() - startedAt,
      headers: {},
      body: "",
      error: err.name === "AbortError" ? "Request timed out" : err.message,
    };
  } finally {
    clearTimeout(timer);
  }
}
