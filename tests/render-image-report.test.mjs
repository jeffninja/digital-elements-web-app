// Tests the dashboard renderer for the image report, using the real functions
// lifted out of index.html and the real generator from src/imageReport.js.
// Every string in the report can originate from a client site, so escaping is
// the main risk being covered here.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { buildImageReport } from "../src/imageReport.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(ROOT, "public", "index.html"), "utf8");
const grab = (re) => { const m = html.match(re); if (!m) throw new Error("not found in index.html: " + re); return m[0]; };

const src = [
  grab(/^const esc = .*$/m),
  grab(/^const fmtBytes = [\s\S]*?^};$/m),
  grab(/^const CMP_LABELS = \{[\s\S]*?^\};$/m),
  grab(/^function renderComparison\(cmp\) \{[\s\S]*?^\}$/m),
  grab(/^function renderIssue\(iss\) \{[\s\S]*?^\}$/m),
  grab(/^function renderImageReport\(rep\) \{[\s\S]*?^\}$/m),
].join("\n");

const ctx = {};
vm.createContext(ctx);
new vm.Script(src + "\nglobalThis.out = { renderImageReport, renderIssue, renderComparison };").runInContext(ctx);
const { renderImageReport, renderComparison } = ctx.out;

let fail = 0;
const ok = (label, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${!cond && extra ? "  (" + extra + ")" : ""}`);
  if (!cond) fail++;
};

const MB = 1024 * 1024;
const payload = (over = {}) => ({
  images: {
    scanned: 300, total_bytes: 94 * MB, est_total_bytes: 36 * MB, missing_files: 0, partial: false,
    oversized: { count: 7, est_bytes: 16 * MB, threshold_px: 2560, samples: [
      { file: "2024/05/hero.jpg", width: 7148, height: 4771, bytes: 10 * MB, est_saved: 8.9 * MB }] },
    large: { count: 39, threshold_bytes: 512000, samples: [{ file: "2024/05/hero.jpg", bytes: 10 * MB }] },
    missing_webp: { count: 209, est_bytes: 20 * MB, samples: [] },
    ...over,
  },
  ...(over.__previous !== undefined ? { previous: over.__previous } : {}),
});

console.log("--- summary ---");
const out = renderImageReport(buildImageReport(payload()));
ok("renders the headline", out.includes("3 issues found"));
ok("shows library size", out.includes("94 MB"));
ok("shows priority chips", out.includes("ir-chip ir-critical") || out.includes("ir-chip ir-high") || out.includes("ir-chip ir-medium"));
ok("shows a status chip per issue", (out.match(/ir-status/g) || []).length >= 3);
ok("null report -> empty string", renderImageReport(null) === "");

console.log("\n--- each issue exposes all five sections ---");
for (const heading of ["Why it matters", "Recommended change", "What to do", "How to verify"]) {
  ok(`section present: ${heading}`, out.includes(heading));
}
ok("steps render as an ordered list", out.includes("<ol>") && (out.match(/<li>/g) || []).length >= 9);
ok("worst offenders listed", out.includes("2024/05/hero.jpg"));
ok("issues are collapsible", (out.match(/<details class="ir-issue">/g) || []).length === 3);

console.log("\n--- priority ordering is reflected in the markup ---");
const order = [...out.matchAll(/ir-chip ir-(critical|high|medium|low)"/g)].map((m) => m[1]);
const RANK = { critical: 0, high: 1, medium: 2, low: 3 };
// Skip the summary chips, then check the per-issue chips are non-decreasing.
const issueChips = order.slice(order.length - 3);
ok("worst issue rendered first", issueChips.every((p, i) => i === 0 || RANK[issueChips[i - 1]] <= RANK[p]), issueChips.join(","));

console.log("\n--- before / after ---");
const noBase = renderComparison({ available: false, reason: "This is the first scan, so there's nothing to compare against yet." });
ok("first scan explains the absence", noBase.includes("first scan"));
ok("first scan shows no table", !noBase.includes("<table"));

const withBase = renderImageReport(buildImageReport(payload({ __previous: {
  scanned_at_ts: 1780000000, total_bytes: 340 * MB, est_total_bytes: 210 * MB,
  oversized: 61, large: 70, missing_webp: 288, missing_files: 0 } })));
ok("renders a comparison table", withBase.includes("<table"));
ok("marks improvements", withBase.includes("ir-better"));
ok("uses a minus sign for reductions", withBase.includes("−"));
ok("labels both columns", withBase.includes("Before") && withBase.includes("Now"));

const worse = renderImageReport(buildImageReport(payload({ __previous: {
  scanned_at_ts: 1780000000, total_bytes: 40 * MB, est_total_bytes: 5 * MB,
  oversized: 1, large: 2, missing_webp: 10, missing_files: 0 } })));
ok("regressions are not styled as wins", worse.includes("ir-worse"));

const flat = renderImageReport(buildImageReport(payload({ __previous: {
  scanned_at_ts: 1780000000, total_bytes: 94 * MB, est_total_bytes: 36 * MB,
  oversized: 7, large: 39, missing_webp: 209, missing_files: 0 } })));
ok("an unchanged scan says 'no change'", flat.includes("no change"));
ok("unchanged is not styled as an improvement", !/ir-better/.test(flat));

console.log("\n--- escaping: file paths come from a client site ---");
const hostile = renderImageReport(buildImageReport(payload({
  oversized: { count: 1, est_bytes: 9 * MB, threshold_px: 2560, samples: [
    { file: `<img src=x onerror=alert(1)>'"&.jpg`, width: 5000, height: 3000, bytes: 9 * MB, est_saved: 7 * MB }] },
})));
ok("no raw tag injected", !hostile.includes("<img src=x"));
ok("angle bracket escaped", hostile.includes("&lt;img src=x"));
ok("quote escaped", hostile.includes("&#39;") || hostile.includes("&quot;"));
ok("ampersand escaped", hostile.includes("&amp;"));

console.log("\n--- clean library ---");
const clean = renderImageReport(buildImageReport({ images: {
  scanned: 40, total_bytes: 5 * MB, est_total_bytes: 0, missing_files: 0, partial: false,
  oversized: { count: 0, est_bytes: 0, threshold_px: 2560, samples: [] },
  large: { count: 0, threshold_bytes: 512000, samples: [] },
  missing_webp: { count: 0, est_bytes: 0, samples: [] },
} }));
ok("states no issues", /no issues found/i.test(clean));
ok("renders no issue blocks", !clean.includes("<details"));
ok("still carries the estimates caveat", /estimate/i.test(clean));

console.log("\n--- partial scan stays disclosed ---");
const partial = renderImageReport(buildImageReport(payload({ partial: true, timed_out: true })));
ok("partial scan warned", partial.includes("Partial scan"));
ok("reason named", /time budget/.test(partial));

console.log("\n" + (fail ? `FAILED: ${fail}` : "OK: all checks passed"));
process.exit(fail ? 1 : 0);
