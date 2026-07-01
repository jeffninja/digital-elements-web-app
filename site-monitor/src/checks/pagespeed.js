// Calls the Google PageSpeed Insights API and returns the performance score
// plus a few headline metrics. An API key is optional but recommended.

const TIMEOUT_MS = 60000; // PSI can be slow

export async function checkPageSpeed(url, opts = {}) {
  const { apiKey = "", strategy = "mobile", warn = 90, fail = 50 } = opts;

  const endpoint = new URL("https://www.googleapis.com/pagespeedonline/v5/runPagespeed");
  endpoint.searchParams.set("url", url);
  endpoint.searchParams.set("strategy", strategy);
  endpoint.searchParams.append("category", "performance");
  if (apiKey) endpoint.searchParams.set("key", apiKey);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(endpoint, { signal: controller.signal });
    if (!res.ok) {
      const body = await res.text();
      const reason = res.status === 429 ? "Rate limited (add an API key)" : `HTTP ${res.status}`;
      return { status: "warn", label: "No data", detail: reason, raw: body.slice(0, 200) };
    }

    const data = await res.json();
    const lh = data.lighthouseResult;
    const scoreRaw = lh?.categories?.performance?.score;
    if (scoreRaw == null) {
      return { status: "warn", label: "No data", detail: "PSI returned no performance score" };
    }

    const score = Math.round(scoreRaw * 100);
    const audits = lh.audits || {};
    const metrics = {
      lcp: audits["largest-contentful-paint"]?.displayValue || null,
      cls: audits["cumulative-layout-shift"]?.displayValue || null,
      tbt: audits["total-blocking-time"]?.displayValue || null,
      fcp: audits["first-contentful-paint"]?.displayValue || null,
    };
    const detail =
      `${strategy} · ` +
      [metrics.lcp && `LCP ${metrics.lcp}`, metrics.cls && `CLS ${metrics.cls}`]
        .filter(Boolean)
        .join(" · ");

    let status = "ok";
    if (score < fail) status = "fail";
    else if (score < warn) status = "warn";

    return { status, label: String(score), detail, score, strategy, metrics };
  } catch (err) {
    return {
      status: "warn",
      label: "No data",
      detail: err.name === "AbortError" ? "PSI timed out" : err.message,
    };
  } finally {
    clearTimeout(timer);
  }
}
