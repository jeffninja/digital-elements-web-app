// Turns the helper plugin's raw image measurements into an actionable report:
// what the problem is, what to do, what it's worth, how to confirm it worked, and
// how it compares to last time.
//
// This lives on the dashboard rather than in the plugin on purpose. Wording and
// thresholds get tuned often, and doing that here means no plugin release to every
// client site — the plugin stays a measurement provider. It also makes the whole
// thing testable without WordPress.
//
// Priority is DERIVED from measured impact, never hand-assigned, so it can't drift
// out of step with the numbers it sits next to. It deliberately reuses the same
// severity ordering the checks already use (see RANK in runner.js) rather than
// introducing a competing scale: fail -> Critical/High, warn -> Medium, info -> Low.

const KB = 1024;
const MB = 1024 * 1024;

export const PRIORITIES = ["critical", "high", "medium", "low"];
const PRIORITY_RANK = { critical: 0, high: 1, medium: 2, low: 3 };

export function formatBytes(n) {
  n = Number(n) || 0;
  if (n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(KB)), units.length - 1);
  const v = n / Math.pow(KB, i);
  return (i === 0 ? String(Math.round(n)) : v.toFixed(v < 10 ? 1 : 0)) + " " + units[i];
}

// Share of the scanned library a saving represents, 0..1.
function share(bytes, total) {
  return total > 0 ? Math.min(1, Math.max(0, bytes / total)) : 0;
}

/**
 * Impact -> priority. Both absolute size and proportion matter: 20 MB is worth
 * chasing on a 40 MB library and barely registers on a 4 GB one.
 *
 * Critical is deliberately hard to reach. If everything is urgent, nothing is.
 */
function priorityFor(bytes, total) {
  const pct = share(bytes, total);
  if (bytes >= 100 * MB || (pct >= 0.6 && bytes >= 50 * MB)) return "critical";
  if (bytes >= 25 * MB || pct >= 0.25) return "high";
  if (bytes >= 5 * MB || pct >= 0.1) return "medium";
  return "low";
}

function pctLabel(bytes, total) {
  const pct = share(bytes, total) * 100;
  if (!total || pct <= 0) return null;
  return pct < 1 ? "<1% of media weight" : `${Math.round(pct)}% of media weight`;
}

// ---------------------------------------------------------------- rule set
// Each rule reads the measurements and, when it applies, returns one issue.
// `id` is stable so workflow state can attach to it across scans.
const RULES = [
  {
    id: "images.oversized",
    build(im) {
      const o = im.oversized || {};
      if (!o.count) return null;
      const px = o.threshold_px || 2560;
      return {
        title: `${o.count} image${o.count === 1 ? "" : "s"} stored larger than they are ever displayed`,
        why: `These are stored at more than ${px}px wide. No theme renders them at that size, so every visitor downloads pixels that get thrown away by the browser. It is the single most common cause of a slow Largest Contentful Paint on image-heavy pages.`,
        recommendation: `Resize the originals down to a ${px}px maximum width and let WordPress regenerate its thumbnail sizes.`,
        estBytes: o.est_bytes || 0,
        steps: [
          "Take a full backup, or at minimum export the uploads folder. Resizing rewrites the original files.",
          "Install a bulk resize tool — Imsanity or ShortPixel both do this well.",
          `Set the maximum width to ${px}px and the JPEG quality to 82–85.`,
          "Run it on the media library, then spot-check a few of the largest files listed below.",
          "Re-run Scan images to confirm the count has dropped.",
        ],
        verify: `Re-run Scan images. "Oversized images" should report 0, and total media weight should fall by roughly ${formatBytes(o.est_bytes || 0)}.`,
        samples: o.samples || [],
        caveat: "Savings are estimated from pixel area. That model holds up well for PNG and is rougher for JPEG, where file size doesn't track dimensions as linearly.",
      };
    },
  },
  {
    id: "images.webp",
    build(im) {
      const w = im.missing_webp || {};
      if (!w.count) return null;
      return {
        title: `${w.count} JPEG/PNG image${w.count === 1 ? " has" : "s have"} no WebP version`,
        why: "WebP is supported by every current browser and is meaningfully smaller than JPEG or PNG at the same visual quality. Serving the older format to everyone leaves an easy win on the table, and PageSpeed Insights flags it directly as \"Serve images in modern formats\".",
        recommendation: "Generate WebP alongside each original and serve it with automatic fallback for anything that can't display it.",
        estBytes: w.est_bytes || 0,
        steps: [
          "Pick a conversion plugin — Converter for Media, ShortPixel, or Imagify.",
          "Configure it to KEEP the originals and add .webp alongside them, not replace them. That keeps the change reversible.",
          "Run the bulk conversion. On a large library this can take a while; let it finish.",
          "Confirm delivery is working: load a page, open DevTools → Network, and check that image responses are image/webp.",
          "Re-run Scan images to confirm coverage.",
        ],
        verify: `Re-run Scan images. "WebP coverage" should report every JPEG/PNG covered. Expect roughly ${formatBytes(w.est_bytes || 0)} less transferred.`,
        samples: w.samples || [],
        caveat: "The 28% estimate is conservative; PNG screenshots and flat graphics often do considerably better than that.",
      };
    },
  },
  {
    id: "images.large",
    build(im) {
      const l = im.large || {};
      if (!l.count) return null;
      const thr = l.threshold_bytes || 500 * KB;
      // Overlaps the two rules above by design — the same file can be oversized,
      // un-converted, AND simply heavy. Claiming its bytes a third time would
      // inflate the total, so this rule contributes none.
      return {
        title: `${l.count} file${l.count === 1 ? " is" : "s are"} over ${formatBytes(thr)}`,
        why: `Individually heavy files hurt whichever page they appear on, even when the library as a whole looks fine. A single ${formatBytes(l.samples && l.samples[0] ? l.samples[0].bytes : thr)} image above the fold will dominate that page's load time on mobile.`,
        recommendation: "Review the heaviest files individually. Most are either the wrong format for their content or exported at an unnecessarily high quality.",
        estBytes: 0, // counted by the rules above; see note
        countsTowardTotal: false,
        steps: [
          "Work down the list below, largest first.",
          "For photographs, re-export as JPEG at quality 82–85 rather than PNG. Photographic PNGs are usually several times larger for no visible gain.",
          "For screenshots, logos and flat graphics, PNG or SVG is right — but run them through a lossless optimiser.",
          "Replace each file via Media → Edit, or re-upload and repoint the reference.",
          "Anything decorative and very large is often better handled by a smaller crop plus a click-to-enlarge.",
        ],
        verify: "Re-run Scan images and confirm the over-threshold count has fallen. The largest-file name at the top of the report should change.",
        samples: l.samples || [],
        note: "Bytes for these files are already counted under the resize and WebP items above, so this issue adds nothing further to the estimated total.",
      };
    },
  },
  {
    id: "images.missing_files",
    build(im) {
      const n = im.missing_files || 0;
      if (!n) return null;
      return {
        title: `${n} attachment${n === 1 ? "" : "s"} point to a file that isn't on disk`,
        why: "The media library has a record but the underlying file is gone. Any page still referencing one serves a broken image, and it usually means an incomplete migration or a partially failed bulk operation.",
        recommendation: "Find out whether the files were lost or merely moved before deleting anything.",
        estBytes: 0,
        countsTowardTotal: false,
        forcedPriority: "high", // correctness problem, not a size one
        steps: [
          "Check whether the files exist in a backup — if the site was migrated, they may simply not have been copied across.",
          "If they are recoverable, restore them into the uploads folder; nothing else needs to change.",
          "If they are genuinely gone, search the site for pages referencing them and replace or remove the images.",
          "Only then clear the orphaned media entries.",
        ],
        verify: "Re-run Scan images. The missing-files line should disappear from the report entirely.",
        samples: [],
      };
    },
  },
];

// ------------------------------------------------------------ before / after
// Deltas are only meaningful against a prior scan; a first run has no baseline
// and must say so rather than implying nothing changed.
export function buildComparison(images, previous) {
  if (!previous || !previous.scanned_at_ts) {
    return { available: false, reason: "This is the first scan, so there's nothing to compare against yet. Re-run after applying changes to see the difference." };
  }
  const metric = (key, cur, prev, lowerIsBetter = true) => {
    const delta = cur - prev;
    return {
      key, current: cur, previous: prev, delta,
      improved: lowerIsBetter ? delta < 0 : delta > 0,
      unchanged: delta === 0,
    };
  };
  return {
    available: true,
    previousAt: previous.scanned_at_ts,
    metrics: [
      metric("total_bytes", images.total_bytes || 0, previous.total_bytes || 0),
      metric("est_total_bytes", images.est_total_bytes || 0, previous.est_total_bytes || 0),
      metric("oversized", (images.oversized || {}).count || 0, previous.oversized || 0),
      metric("missing_webp", (images.missing_webp || {}).count || 0, previous.missing_webp || 0),
      metric("large", (images.large || {}).count || 0, previous.large || 0),
    ],
  };
}

/**
 * Build the full report from a helper-plugin `images` payload.
 * Returns null when there is nothing to report on.
 */
export function buildImageReport(payload) {
  const im = payload && payload.images;
  if (!im) return null;

  const total = im.total_bytes || 0;

  const issues = RULES
    .map((rule) => {
      const built = rule.build(im);
      if (!built) return null;
      const priority = built.forcedPriority || priorityFor(built.estBytes || 0, total);
      return {
        id: rule.id,
        priority,
        // Workflow state is not tracked yet; every issue reads as pending so the
        // UI contract is stable when it is added.
        status: "pending",
        impact: {
          bytes: built.estBytes || 0,
          label: built.estBytes ? formatBytes(built.estBytes) : null,
          share: built.estBytes ? pctLabel(built.estBytes, total) : null,
          countsTowardTotal: built.countsTowardTotal !== false,
        },
        ...built,
      };
    })
    .filter(Boolean)
    .sort((a, b) => (PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]) || (b.impact.bytes - a.impact.bytes));

  // Only issues that own their bytes contribute, so overlapping rules can't
  // inflate the headline figure.
  const recoverable = issues.reduce((n, i) => n + (i.impact.countsTowardTotal ? i.impact.bytes : 0), 0);

  const counts = {};
  for (const p of PRIORITIES) counts[p] = issues.filter((i) => i.priority === p).length;

  return {
    summary: {
      scanned: im.scanned || 0,
      totalBytes: total,
      totalLabel: formatBytes(total),
      issueCount: issues.length,
      recoverableBytes: recoverable,
      recoverableLabel: formatBytes(recoverable),
      recoverableShare: pctLabel(recoverable, total),
      topPriority: issues.length ? issues[0].priority : null,
      counts,
      partial: !!im.partial,
      partialReason: im.partial
        ? (im.timed_out ? "the time budget was reached" : "the image cap was reached")
        : null,
      headline: issues.length
        ? `${issues.length} issue${issues.length === 1 ? "" : "s"} found · about ${formatBytes(recoverable)} recoverable of ${formatBytes(total)}`
        : `No issues found across ${im.scanned || 0} images (${formatBytes(total)}).`,
    },
    issues,
    comparison: buildComparison(im, payload.previous),
    readOnly: true,
    estimatesCaveat: "Every saving here is an estimate derived from image dimensions and typical WebP ratios — not a measured re-encode. Treat them as a guide to what to tackle first, not as a guarantee.",
  };
}
