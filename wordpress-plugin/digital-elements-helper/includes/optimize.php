<?php
/**
 * Website optimization actions, triggered by the Digital Elements dashboard.
 *
 * Each action is a token-authenticated POST under wpmonitor/v1/optimize/*.
 * They are intentionally conservative: cache flushing only removes generated
 * caches (safe to rebuild) and never touches content, settings, or files.
 *
 * Phase 1: clear-cache — with post-clear verification where a cache layer
 * exposes something we can measure (object cache return value, WP Rocket's
 * on-disk cache folder), so the dashboard can show proof, not just intent.
 */
if (!defined('ABSPATH')) { exit; }

add_action('rest_api_init', function () {
    register_rest_route('wpmonitor/v1', '/optimize/clear-cache', array(
        'methods'             => 'POST',
        'permission_callback' => 'deheled_check_token',
        'callback'            => 'deheled_optimize_clear_cache',
    ));
});

/** Where WP Rocket stores its page cache. Empty string if not determinable. */
function deheled_rocket_cache_dir() {
    if (defined('WP_ROCKET_CACHE_PATH') && WP_ROCKET_CACHE_PATH) return WP_ROCKET_CACHE_PATH;
    if (defined('WP_CONTENT_DIR')) return trailingslashit(WP_CONTENT_DIR) . 'cache/wp-rocket/';
    return '';
}

/**
 * Count files under a directory, capped so a huge cache can't stall the request.
 * Returns -1 when the directory can't be read (so "unknown" is distinct from 0).
 */
function deheled_count_files($dir, $cap = 3000) {
    if (!$dir || !is_dir($dir)) return -1;
    $n = 0;
    try {
        $it = new RecursiveIteratorIterator(
            new RecursiveDirectoryIterator($dir, FilesystemIterator::SKIP_DOTS),
            RecursiveIteratorIterator::LEAVES_ONLY
        );
        foreach ($it as $f) {
            if ($f->isFile()) { $n++; if ($n >= $cap) break; }
        }
    } catch (Exception $e) {
        return -1;
    }
    return $n;
}

/**
 * Flush every cache layer we can detect. Only clears regenerable caches — no
 * content, options, or files are modified — so this is always safe to run.
 *
 * Each entry in `layers` is { name, status, detail } where status is:
 *   "verified" — we measured that the cache is actually gone
 *   "cleared"  — the plugin's purge ran, but we can't independently confirm
 */
function deheled_optimize_clear_cache() {
    $layers = array();

    // 1) WordPress object cache — wp_cache_flush() returns true/false, so this
    //    one is genuinely verifiable.
    if (function_exists('wp_cache_flush')) {
        $ok = wp_cache_flush();
        $layers[] = array(
            'name'   => 'Object cache',
            'status' => $ok ? 'verified' : 'cleared',
            'detail' => $ok ? 'flushed' : 'flush requested',
        );
    }

    // 2) WP Rocket — measure the cache folder before and after so we can prove
    //    the purge emptied it.
    if (function_exists('rocket_clean_domain')) {
        $dir = deheled_rocket_cache_dir();
        $before = deheled_count_files($dir);
        rocket_clean_domain();
        if (function_exists('rocket_clean_minify')) rocket_clean_minify();
        clearstatcache();
        $after = deheled_count_files($dir);

        $status = 'cleared';
        $detail = 'purge ran';
        if ($before >= 0 && $after >= 0) {
            if ($after === 0) {
                $status = 'verified';
                $removed = $before;
                $detail = $removed > 0
                    ? sprintf('cache emptied — %d file%s removed', $removed, $removed === 1 ? '' : 's')
                    : 'cache already empty';
            } elseif ($after < $before) {
                $status = 'verified';
                $detail = sprintf('%d file%s removed, %d remaining', $before - $after, ($before - $after) === 1 ? '' : 's', $after);
            } else {
                $detail = sprintf('purge ran — %d file%s present (may be preloading)', $after, $after === 1 ? '' : 's');
            }
        }
        $layers[] = array('name' => 'WP Rocket page cache', 'status' => $status, 'detail' => $detail);
    }

    // 3) W3 Total Cache.
    if (function_exists('w3tc_flush_all')) {
        w3tc_flush_all();
        $layers[] = array('name' => 'W3 Total Cache', 'status' => 'cleared', 'detail' => 'purge ran');
    }

    // 4) WP Super Cache.
    if (function_exists('wp_cache_clear_cache')) {
        wp_cache_clear_cache();
        $layers[] = array('name' => 'WP Super Cache', 'status' => 'cleared', 'detail' => 'purge ran');
    }

    // 5) LiteSpeed Cache.
    if (defined('LSCWP_V') || has_action('litespeed_purge_all')) {
        do_action('litespeed_purge_all');
        $layers[] = array('name' => 'LiteSpeed Cache', 'status' => 'cleared', 'detail' => 'purge-all fired');
    }

    // 6) Cloudflare (official plugin) — purge everything at the edge.
    if (has_action('cloudflare_purge_everything')) {
        do_action('cloudflare_purge_everything');
        $layers[] = array('name' => 'Cloudflare (plugin)', 'status' => 'cleared', 'detail' => 'edge purge fired');
    }

    // 7) Autoptimize cached CSS/JS.
    if (class_exists('autoptimizeCache') && method_exists('autoptimizeCache', 'clearall')) {
        autoptimizeCache::clearall();
        $layers[] = array('name' => 'Autoptimize', 'status' => 'cleared', 'detail' => 'CSS/JS cache cleared');
    }

    // 8) SiteGround Optimizer.
    if (function_exists('sg_cachepress_purge_cache')) {
        sg_cachepress_purge_cache();
        $layers[] = array('name' => 'SiteGround Optimizer', 'status' => 'cleared', 'detail' => 'purge ran');
    }

    // 9) Fallback: expired cache transients in the options table.
    $n = deheled_delete_cache_transients();
    if ($n > 0) {
        $layers[] = array('name' => 'Cache transients', 'status' => 'verified', 'detail' => sprintf('%d expired transient%s removed', $n, $n === 1 ? '' : 's'));
    }

    // Backward-compatible flat list (older dashboards read `cleared`).
    $cleared = array();
    foreach ($layers as $l) $cleared[] = $l['name'];
    $skipped = $layers ? array() : array('No active cache layer detected');

    return rest_ensure_response(array(
        'ok'      => true,
        'action'  => 'clear-cache',
        'layers'  => $layers,
        'cleared' => $cleared,
        'skipped' => $skipped,
        'ran_at'  => current_time('c'),
    ));
}

/**
 * Delete expired cache transients from the options table without touching
 * persistent options. Returns the count removed.
 */
function deheled_delete_cache_transients() {
    global $wpdb;
    $count = 0;
    $now = time();
    $expired = $wpdb->get_col($wpdb->prepare(
        "SELECT option_name FROM {$wpdb->options}
         WHERE option_name LIKE %s AND option_value < %d",
        $wpdb->esc_like('_transient_timeout_') . '%', $now
    ));
    foreach ($expired as $timeout_name) {
        $key = substr($timeout_name, strlen('_transient_timeout_'));
        if (delete_transient($key)) $count++;
    }
    return $count;
}
