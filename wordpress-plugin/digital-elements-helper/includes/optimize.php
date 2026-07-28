<?php
/**
 * Website optimization actions, triggered by the Digital Elements dashboard.
 *
 * Each action is a token-authenticated POST under wpmonitor/v1/optimize/*.
 * They are intentionally conservative: cache flushing only removes generated
 * caches (safe to rebuild) and never touches content, settings, or files.
 *
 * Phase 1: clear-cache.
 */
if (!defined('ABSPATH')) { exit; }

add_action('rest_api_init', function () {
    register_rest_route('wpmonitor/v1', '/optimize/clear-cache', array(
        'methods'             => 'POST',
        'permission_callback' => 'deheled_check_token',
        'callback'            => 'deheled_optimize_clear_cache',
    ));
});

/**
 * Flush every cache layer we can detect. Only clears regenerable caches — no
 * content, options, or files are modified — so this is always safe to run.
 * Returns a per-layer report the dashboard shows to the developer.
 */
function deheled_optimize_clear_cache() {
    $cleared = array();
    $skipped = array();

    // 1) WordPress object cache (Redis/Memcached/APCu via drop-in, or the
    //    in-request default). Safe and instant.
    if (function_exists('wp_cache_flush')) {
        $ok = wp_cache_flush();
        if ($ok !== false) $cleared[] = 'Object cache';
    }

    // 2) WP Rocket — full page cache + minified assets.
    if (function_exists('rocket_clean_domain')) {
        rocket_clean_domain();
        if (function_exists('rocket_clean_minify')) rocket_clean_minify();
        $cleared[] = 'WP Rocket page cache';
    }

    // 3) W3 Total Cache.
    if (function_exists('w3tc_flush_all')) {
        w3tc_flush_all();
        $cleared[] = 'W3 Total Cache';
    }

    // 4) WP Super Cache.
    if (function_exists('wp_cache_clear_cache')) {
        wp_cache_clear_cache();
        $cleared[] = 'WP Super Cache';
    }

    // 5) LiteSpeed Cache (fires the purge-all action the plugin listens for).
    if (defined('LSCWP_V') || has_action('litespeed_purge_all')) {
        do_action('litespeed_purge_all');
        $cleared[] = 'LiteSpeed Cache';
    }

    // 6) Cloudflare (official plugin) — purge everything at the edge.
    if (has_action('cloudflare_purge_everything')) {
        do_action('cloudflare_purge_everything');
        $cleared[] = 'Cloudflare (plugin)';
    }

    // 7) Autoptimize cached CSS/JS.
    if (class_exists('autoptimizeCache') && method_exists('autoptimizeCache', 'clearall')) {
        autoptimizeCache::clearall();
        $cleared[] = 'Autoptimize';
    }

    // 8) SiteGround Optimizer.
    if (function_exists('sg_cachepress_purge_cache')) {
        sg_cachepress_purge_cache();
        $cleared[] = 'SiteGround Optimizer';
    }

    // 9) Fallback page-cache transients (themes/plugins that cache via the
    //    options table). Only deletes transients, never real options.
    $n = deheled_delete_cache_transients();
    if ($n > 0) $cleared[] = sprintf('%d cache transient%s', $n, $n === 1 ? '' : 's');

    if (!$cleared) $skipped[] = 'No active cache layer detected';

    return rest_ensure_response(array(
        'ok'       => true,
        'action'   => 'clear-cache',
        'cleared'  => $cleared,
        'skipped'  => $skipped,
        'ran_at'   => current_time('c'),
    ));
}

/**
 * Delete expired + our-safe cache transients from the options table without
 * touching persistent options. Returns the count removed.
 */
function deheled_delete_cache_transients() {
    global $wpdb;
    // Expired transients first (always safe to drop).
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
