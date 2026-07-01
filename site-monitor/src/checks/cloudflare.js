// Detects whether the site is served through Cloudflare, using response headers.

export function checkCloudflare(fetchResult, expected = true) {
  if (!fetchResult.ok) {
    return { status: "warn", label: "Unknown", detail: "Site unreachable" };
  }

  const h = fetchResult.headers;
  const server = (h["server"] || "").toLowerCase();
  const cfRay = h["cf-ray"];
  const cfCache = h["cf-cache-status"];

  const active = Boolean(cfRay) || server.includes("cloudflare");

  if (active) {
    const bits = [];
    if (cfRay) bits.push(`ray ${cfRay.split("-")[0]}`);
    if (cfCache) bits.push(`cache ${cfCache.toLowerCase()}`);
    return {
      status: "ok",
      label: "Active",
      detail: bits.length ? bits.join(" · ") : "Cloudflare headers present",
    };
  }

  if (!expected) {
    return { status: "ok", label: "Not used", detail: "Cloudflare not expected on this site" };
  }
  return { status: "warn", label: "Not detected", detail: "No Cloudflare headers in response" };
}
