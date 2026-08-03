// Tests for src/imageReport.js — the layer that turns raw image measurements
// into prioritised, actionable recommendations.
import { buildImageReport, buildComparison, formatBytes } from "../src/imageReport.js";

let fail = 0;
const ok = (label, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${!cond && extra ? "  (" + extra + ")" : ""}`);
  if (!cond) fail++;
};
const eq = (label, a, b) => ok(label, a === b, `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);

const MB = 1024 * 1024;

// Shape mirrors the plugin's `images` payload.
const mk = (over = {}) => ({
  images: {
    scanned: 300, candidates: 300, partial: false, capped: false, timed_out: false,
    total_bytes: 94 * MB, est_total_bytes: 36 * MB, missing_files: 0,
    oversized: { count: 7, est_bytes: 16 * MB, threshold_px: 2560, samples: [
      { file: "2024/05/hero.jpg", width: 7148, height: 4771, bytes: 10 * MB, est_saved: 8.9 * MB },
    ] },
    large: { count: 39, threshold_bytes: 512000, samples: [{ file: "2024/05/hero.jpg", bytes: 10 * MB }] },
    missing_webp: { count: 209, est_bytes: 20 * MB, samples: [] },
    duration_ms: 1200, scanned_at_ts: 1780000000,
    ...over,
  },
});

console.log("--- formatBytes ---");
eq("0", formatBytes(0), "0 B");
eq("512 B", formatBytes(512), "512 B");
eq("1.0 KB", formatBytes(1024), "1.0 KB");
eq("1.5 MB", formatBytes(1.5 * MB), "1.5 MB");

console.log("\n--- report structure ---");
ok("null payload -> null", buildImageReport(null) === null);
ok("payload with no images -> null", buildImageReport({ layers: [] }) === null);

const rep = buildImageReport(mk());
ok("has summary, issues, comparison", !!rep.summary && Array.isArray(rep.issues) && !!rep.comparison);
eq("issue count", rep.issues.length, 3); // oversized, webp, large — no missing files
ok("declares read-only", rep.readOnly === true);
ok("carries the estimates caveat", /estimate/i.test(rep.estimatesCaveat));

console.log("\n--- every issue is fully actionable ---");
for (const iss of rep.issues) {
  ok(`${iss.id}: stable id`, typeof iss.id === "string" && iss.id.startsWith("images."));
  ok(`${iss.id}: has priority`, ["critical", "high", "medium", "low"].includes(iss.priority));
  ok(`${iss.id}: has status`, iss.status === "pending");
  ok(`${iss.id}: explains why`, typeof iss.why === "string" && iss.why.length > 40);
  ok(`${iss.id}: states a recommendation`, typeof iss.recommendation === "string" && iss.recommendation.length > 10);
  ok(`${iss.id}: has numbered steps`, Array.isArray(iss.steps) && iss.steps.length >= 3);
  ok(`${iss.id}: says how to verify`, typeof iss.verify === "string" && /re-run/i.test(iss.verify));
}

console.log("\n--- priority is derived from impact, not hard-coded ---");
// 20 MB of a 94 MB library -> 21% and over 5 MB -> medium; but as a share of a
// small library the same absolute number should escalate.
const small = buildImageReport(mk({ total_bytes: 30 * MB, missing_webp: { count: 50, est_bytes: 20 * MB, samples: [] } }));
const webpSmall = small.issues.find((i) => i.id === "images.webp");
const webpBig = rep.issues.find((i) => i.id === "images.webp");
ok("same bytes rank higher on a smaller library",
  ["critical", "high"].includes(webpSmall.priority) && webpSmall.priority !== webpBig.priority,
  `${webpSmall.priority} vs ${webpBig.priority}`);

const huge = buildImageReport(mk({ total_bytes: 400 * MB, oversized: { count: 90, est_bytes: 150 * MB, threshold_px: 2560, samples: [] } }));
eq("150 MB is critical", huge.issues.find((i) => i.id === "images.oversized").priority, "critical");

const tiny = buildImageReport(mk({ total_bytes: 4000 * MB, oversized: { count: 1, est_bytes: 200 * 1024, threshold_px: 2560, samples: [] } }));
eq("200 KB of a 4 GB library is low", tiny.issues.find((i) => i.id === "images.oversized").priority, "low");

console.log("\n--- issues are ordered worst-first ---");
const RANK = { critical: 0, high: 1, medium: 2, low: 3 };
ok("sorted by priority then impact", (() => {
  for (let i = 1; i < rep.issues.length; i++) {
    const a = rep.issues[i - 1], b = rep.issues[i];
    if (RANK[a.priority] > RANK[b.priority]) return false;
    if (RANK[a.priority] === RANK[b.priority] && a.impact.bytes < b.impact.bytes) return false;
  }
  return true;
})(), rep.issues.map((i) => `${i.priority}/${i.impact.bytes}`).join(" "));

console.log("\n--- the headline total must not double-count overlapping rules ---");
// "Large files" describes the same bytes as the resize and WebP items, so it must
// contribute nothing; otherwise the total exceeds what is actually recoverable.
const large = rep.issues.find((i) => i.id === "images.large");
eq("large files contribute 0 bytes", large.impact.bytes, 0);
ok("large files flagged as not counting toward the total", large.impact.countsTowardTotal === false);
eq("recoverable == oversized + webp only", rep.summary.recoverableBytes, 36 * MB);
ok("recoverable never exceeds library size", rep.summary.recoverableBytes <= rep.summary.totalBytes);
ok("large files still explains itself", !!large.note && /already counted/i.test(large.note));

console.log("\n--- missing files: a correctness issue, not a size one ---");
const withMissing = buildImageReport(mk({ missing_files: 4 }));
const mf = withMissing.issues.find((i) => i.id === "images.missing_files");
ok("appears when present", !!mf);
eq("forced to high regardless of bytes", mf.priority, "high");
eq("contributes no bytes", mf.impact.bytes, 0);
ok("absent when there are none", !rep.issues.some((i) => i.id === "images.missing_files"));

console.log("\n--- clean library ---");
const clean = buildImageReport({ images: {
  scanned: 40, total_bytes: 5 * MB, est_total_bytes: 0, missing_files: 0, partial: false,
  oversized: { count: 0, est_bytes: 0, threshold_px: 2560, samples: [] },
  large: { count: 0, threshold_bytes: 512000, samples: [] },
  missing_webp: { count: 0, est_bytes: 0, samples: [] },
} });
eq("no issues", clean.issues.length, 0);
ok("headline says so plainly", /no issues found/i.test(clean.summary.headline), clean.summary.headline);
eq("nothing recoverable", clean.summary.recoverableBytes, 0);
eq("no top priority", clean.summary.topPriority, null);

console.log("\n--- partial scans stay disclosed in the summary ---");
const partial = buildImageReport(mk({ partial: true, timed_out: true, scanned: 5000, candidates: 9143 }));
ok("summary marks it partial", partial.summary.partial === true);
ok("names the reason", /time budget/i.test(partial.summary.partialReason), partial.summary.partialReason);

console.log("\n--- before / after ---");
const first = buildComparison(mk().images, null);
ok("first scan has no baseline", first.available === false);
ok("explains why rather than implying no change", /first scan/i.test(first.reason), first.reason);

const improved = buildComparison(mk().images, {
  scanned_at_ts: 1779000000, total_bytes: 150 * MB, est_total_bytes: 90 * MB,
  oversized: 25, large: 44, missing_webp: 280, missing_files: 0,
});
ok("available with a baseline", improved.available === true);
const byKey = Object.fromEntries(improved.metrics.map((m) => [m.key, m]));
ok("shrinking library counts as improved", byKey.total_bytes.improved === true);
eq("delta is signed", byKey.total_bytes.delta, (94 - 150) * MB);
ok("fewer oversized counts as improved", byKey.oversized.improved === true);
ok("fewer missing webp counts as improved", byKey.missing_webp.improved === true);

const worse = buildComparison(mk().images, {
  scanned_at_ts: 1779000000, total_bytes: 50 * MB, est_total_bytes: 10 * MB,
  oversized: 2, large: 5, missing_webp: 100, missing_files: 0,
});
ok("a growing library is not reported as improved",
  Object.fromEntries(worse.metrics.map((m) => [m.key, m])).total_bytes.improved === false);

const same = buildComparison(mk().images, {
  scanned_at_ts: 1779000000, total_bytes: 94 * MB, est_total_bytes: 36 * MB,
  oversized: 7, large: 39, missing_webp: 209, missing_files: 0,
});
ok("identical scan reads as unchanged, not improved",
  same.metrics.every((m) => m.unchanged === true && m.improved === false));

console.log("\n" + (fail ? `FAILED: ${fail}` : "OK: all checks passed"));
process.exit(fail ? 1 : 0);
