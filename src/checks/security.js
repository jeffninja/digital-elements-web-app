// Passive security scan of the fetched homepage. Because we fetch server-side
// (no JS runs), we see the raw markup an attacker's injection lives in. This
// looks for the *fingerprints* of a WordPress compromise — obfuscated code,
// off-site redirects, and hidden/cloaked external link blocks (the casino/pharma
// SEO-spam pattern) — rather than keyword presence, so it won't false-alarm on
// sites whose legitimate content mentions sensitive words.
//
// It cannot see server-side payloads in PHP files (e.g. base64_decode in a
// backdoor) — that needs the helper plugin's deep scan. It catches the visible
// symptoms those payloads produce.

const OBFUSCATION = [
  { re: /eval\s*\(\s*(?:atob|unescape|String\.fromCharCode|decodeURIComponent)/i, msg: "Obfuscated eval() decoding a hidden payload" },
  { re: /document\.write\s*\(\s*(?:unescape|atob|String\.fromCharCode)/i, msg: "document.write() of an encoded payload (injected redirect/ad)" },
  { re: /eval\s*\(\s*function\s*\(\s*p\s*,\s*a\s*,\s*c\s*,\s*k\s*,\s*e/i, msg: "Packed/obfuscated JavaScript (eval-packer)" },
  { re: /\bbase64_decode\s*\(/i, msg: "base64_decode() in page output — likely an injected PHP payload leaking" },
  { re: /\b(?:gzinflate|str_rot13|gzuncompress)\s*\(\s*base64_decode/i, msg: "Chained PHP decoders (gzinflate/str_rot13 + base64) — classic backdoor" },
  { re: /String\.fromCharCode\((?:\s*\d+\s*,){20,}/i, msg: "Long String.fromCharCode() chain (script obfuscation)" },
];

function hostOf(u) {
  try { return new URL(u).host.replace(/^www\./, ""); } catch { return null; }
}
function truncate(s, n) { return s.length > n ? s.slice(0, n) + "\u2026" : s; }

export function checkSecurity(fetchResult) {
  if (!fetchResult.ok) return { status: "skip", label: "Not scanned", detail: "Site unreachable" };

  const html = fetchResult.body || "";
  const headers = fetchResult.headers || {};
  const baseHost = hostOf(fetchResult.finalUrl || "");
  const findings = [];

  // 1. Obfuscated / injected code (strong signal, vertical-agnostic).
  for (const p of OBFUSCATION) if (p.re.test(html)) findings.push({ sev: "high", msg: p.msg });

  // 2. Off-site auto-redirect via <meta http-equiv="refresh">.
  const meta = html.match(/<meta[^>]+http-equiv=["']?refresh["']?[^>]*content=["'][^"']*url=([^"'>]+)/i);
  if (meta) {
    const dest = meta[1].trim();
    const h = hostOf(dest);
    if (/^https?:\/\//i.test(dest) && h && baseHost && h !== baseHost) {
      findings.push({ sev: "high", msg: `Page auto-redirects off-site to ${truncate(dest, 60)}` });
    }
  }

  // 3. Hidden/cloaked blocks that contain EXTERNAL links (the SEO-spam pattern).
  //    Only external links count, so hidden nav menus (internal links) don't trip it.
  const hiddenRe = /<(div|span|p|section)\b[^>]*style=["'][^"']*(?:display\s*:\s*none|visibility\s*:\s*hidden|text-indent\s*:\s*-\s*\d{3,}|(?:left|top)\s*:\s*-\s*\d{3,}px)[^"']*["'][^>]*>([\s\S]{0,4000}?)<\/\1>/gi;
  let hiddenExternal = 0;
  let sample = null;
  let m;
  while ((m = hiddenRe.exec(html)) !== null) {
    const inner = m[2] || "";
    const hrefs = inner.match(/href=["'](https?:\/\/[^"']+)["']/gi) || [];
    for (const raw of hrefs) {
      const url = raw.replace(/^href=["']/i, "").replace(/["']$/, "");
      const h = hostOf(url);
      if (h && baseHost && h !== baseHost) { hiddenExternal++; if (!sample) sample = h; }
    }
  }
  if (hiddenExternal >= 3) findings.push({ sev: "high", msg: `${hiddenExternal} hidden off-site links found (cloaked spam injection${sample ? `, e.g. ${sample}` : ""})` });
  else if (hiddenExternal >= 1) findings.push({ sev: "med", msg: `${hiddenExternal} hidden off-site link(s) found${sample ? ` (e.g. ${sample})` : ""}` });

  // 4. Hidden/off-screen iframe pointing off-site.
  const iframeRe = /<iframe\b[^>]*src=["'](https?:\/\/[^"']+)["'][^>]*>/gi;
  while ((m = iframeRe.exec(html)) !== null) {
    const tag = m[0];
    const h = hostOf(m[1]);
    const hidden = /(?:display\s*:\s*none|visibility\s*:\s*hidden|width\s*=?["']?\s*0|height\s*=?["']?\s*0|width\s*:\s*0|height\s*:\s*0)/i.test(tag);
    if (hidden && h && baseHost && h !== baseHost) {
      findings.push({ sev: "med", msg: `Hidden off-site iframe to ${h}` });
      break;
    }
  }

  // 5. Security-header posture — informational only, never changes status.
  const missing = [];
  const csp = headers["content-security-policy"] || "";
  if (!headers["strict-transport-security"]) missing.push("HSTS");
  if (!headers["x-content-type-options"]) missing.push("X-Content-Type-Options");
  if (!headers["x-frame-options"] && !/frame-ancestors/i.test(csp)) missing.push("X-Frame-Options");
  if (!csp) missing.push("CSP");

  const high = findings.filter((f) => f.sev === "high");
  const med = findings.filter((f) => f.sev === "med");

  let status = "ok", label = "Clean", detail;
  if (high.length) { status = "fail"; label = "Threats found"; detail = high[0].msg; }
  else if (med.length) { status = "warn"; label = "Suspicious"; detail = med[0].msg; }
  else { detail = missing.length ? `No threats · missing headers: ${missing.join(", ")}` : "No threats · security headers present"; }

  return { status, label, detail, meta: { findings, missingHeaders: missing } };
}
