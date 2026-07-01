// Scans the homepage HTML for the CallTrackingMetrics tracking script and for
// Google Tag (GTM container and/or GA4 gtag.js). Returns one verdict per check.

function uniq(arr) {
  return [...new Set(arr)];
}

export function checkCtm(fetchResult, expected = true) {
  if (!fetchResult.ok) return { status: "warn", label: "Unknown", detail: "Site unreachable" };

  const html = fetchResult.body || "";
  const present =
    /\.tctm\.co/i.test(html) ||
    /calltrackingmetrics\.com/i.test(html) ||
    /__ctm\b/i.test(html) ||
    /\b_ctm\b/i.test(html);

  if (present) {
    const idMatch = html.match(/\/\/(\d+)\.tctm\.co/i);
    const detail = idMatch ? `Account ${idMatch[1]} · tctm.co` : "CTM script detected";
    return { status: "ok", label: "Detected", detail };
  }

  if (!expected) {
    return { status: "ok", label: "Not used", detail: "CTM not expected on this site" };
  }
  return { status: "fail", label: "Missing", detail: "No CallTrackingMetrics script found" };
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
