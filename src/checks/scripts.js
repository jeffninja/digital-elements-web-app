// Scans the homepage HTML for the CallTrackingMetrics tracking script and for
// Google Tag (GTM container and/or GA4 gtag.js). Returns one verdict per check.

function uniq(arr) {
  return [...new Set(arr)];
}

// Pulls the hardcoded phone number(s) out of the page HTML. Because we fetch
// server-side (no JS), this is the static/fallback number BEFORE CallTrackingMetrics
// swaps in a dynamic tracking number in the browser. tel: links are the most
// reliable source; visible text is a fallback. US 10-digit numbers only.
// Form fields, inline scripts/styles, and dummy/placeholder numbers are excluded.
function isDummyNumber(d) {
  if (/^(\d)\1{9}$/.test(d)) return true;              // 0000000000, 9999999999, …
  if (d === "1234567890" || d === "0123456789") return true;
  const area = d.slice(0, 3), exch = d.slice(3, 6), line = d.slice(6);
  if (area[0] < "2" || exch[0] < "2") return true;      // invalid NANP area/exchange
  if (exch === "555" && line >= "0100" && line <= "0199") return true; // fictional 555-01xx
  return false;
}
export function extractPhones(html) {
  if (!html) return [];
  // Drop scripts, styles, forms, noscript and comments so we don't pick up JS
  // config defaults, form input masks (e.g. Gravity Forms "(999) 999-9999"),
  // or placeholder/example numbers.
  const cleaned = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<form[\s\S]*?<\/form>/gi, " ");
  const found = [];
  const telRe = /(?:tel|callto):\+?([0-9().\-\s]{7,})/gi;
  let m;
  while ((m = telRe.exec(cleaned)) !== null) found.push(m[1]);
  const textRe = /(?:\+?1[\s.\-]?)?\(?\d{3}\)?[\s.\-]\d{3}[\s.\-]\d{4}/g;
  const text = cleaned.replace(/<[^>]+>/g, " ");
  found.push(...(text.match(textRe) || []));
  const norm = new Map();
  for (const raw of found) {
    let digits = raw.replace(/[^\d]/g, "");
    if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
    if (digits.length === 10 && !isDummyNumber(digits)) {
      if (!norm.has(digits)) norm.set(digits, `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`);
    }
  }
  return [...norm.values()].slice(0, 6);
}

export function checkCtm(fetchResult, expected = true) {
  if (!fetchResult.ok) return { status: "warn", label: "Unknown", detail: "Site unreachable" };

  const html = fetchResult.body || "";
  const phones = extractPhones(html);
  const present =
    /\.tctm\.co/i.test(html) ||
    /calltrackingmetrics\.com/i.test(html) ||
    /__ctm\b/i.test(html) ||
    /\b_ctm\b/i.test(html);

  if (present) {
    const idMatch = html.match(/\/\/(\d+)\.tctm\.co/i);
    const detail = idMatch ? `Account ${idMatch[1]} · tctm.co` : "CTM script detected";
    return { status: "ok", label: "Detected", detail, meta: { phones } };
  }

  if (!expected) {
    return { status: "ok", label: "Not used", detail: "CTM not expected on this site", meta: { phones } };
  }
  return { status: "fail", label: "Missing", detail: "No CallTrackingMetrics script found", meta: { phones } };
}

export function checkGoogleTag(fetchResult, expected = true) {
  if (!fetchResult.ok) return { status: "warn", label: "Unknown", detail: "Site unreachable" };

  const html = fetchResult.body || "";
  const hasGtm = /googletagmanager\.com\/gtm\.js/i.test(html);
  const hasGtag = /googletagmanager\.com\/gtag\/js/i.test(html) || /gtag\(/i.test(html);

  const gtmIds = uniq(html.match(/GTM-[A-Z0-9]+/g) || []);
  const ga4Ids = uniq(html.match(/\bG-[A-Z0-9]{6,}\b/g) || []);
  const uaIds = uniq(html.match(/UA-\d{4,}-\d+/g) || []);
  const ids = [...gtmIds, ...ga4Ids, ...uaIds];

  if (hasGtm || hasGtag || ids.length) {
    const detail = ids.length ? ids.join(", ") : "Google Tag script detected";
    return { status: "ok", label: "Detected", detail, ids };
  }

  if (!expected) {
    return { status: "ok", label: "Not used", detail: "Google Tag not expected on this site" };
  }
  return { status: "fail", label: "Missing", detail: "No Google Tag / GTM script found" };
}
