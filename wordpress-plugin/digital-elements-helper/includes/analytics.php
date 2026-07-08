<?php
if (!defined('ABSPATH')) { exit; }

/**
 * Lightweight page-view analytics.
 *
 * Prints a tiny (<400 byte) inline beacon in the footer of front-end pages.
 * It fires once per page view via navigator.sendBeacon (non-blocking, runs
 * after the page is done, zero impact on load speed) to the Digital Elements
 * analytics endpoint (a Cloudflare Worker). No cookies, no external JS file,
 * no render-blocking requests.
 *
 * The endpoint URL is delivered automatically by the dashboard as part of
 * license validation (cached in the license status option), so client sites
 * need no configuration. Overrides:
 *   define('DEHELED_ANALYTICS_URL', 'https://...');   // force an endpoint
 *   add_filter('deheled_analytics_enabled', '__return_false');  // opt out
 */

function deheled_analytics_endpoint() {
    if (defined('DEHELED_ANALYTICS_URL')) {
        return rtrim(DEHELED_ANALYTICS_URL, '/');
    }
    $lic = get_option(DEHELED_LIC_STATUS, array());
    if (is_array($lic) && !empty($lic['analytics_url'])) {
        return rtrim((string) $lic['analytics_url'], '/');
    }
    return '';
}

add_action('wp_footer', 'deheled_analytics_snippet', 99);
function deheled_analytics_snippet() {
    // Front-end visitors only: skip admins/editors, previews, feeds, robots.
    if (is_user_logged_in() || is_admin() || is_preview() || is_feed() || is_robots()) {
        return;
    }
    $endpoint = deheled_analytics_endpoint();
    if ($endpoint === '' || !apply_filters('deheled_analytics_enabled', true)) {
        return;
    }
    $lic = get_option(DEHELED_LIC_STATUS, array());
    if (!is_array($lic) || empty($lic['valid']) || !empty($lic['expired'])) {
        return; // only track for sites with an active monitoring license
    }
    $url = esc_url_raw($endpoint . '/collect');
    // Sent as text/plain so sendBeacon never needs a CORS preflight.
    echo "<script>(function(){try{var d=JSON.stringify({s:location.hostname,p:location.pathname,r:document.referrer||''});" .
         "if(navigator.sendBeacon){navigator.sendBeacon('" . esc_js($url) . "',d)}" .
         "else{fetch('" . esc_js($url) . "',{method:'POST',body:d,keepalive:true})}}catch(e){}})();</script>\n";
}

// Revalidate the license once a day so the analytics endpoint stays in sync
// even on sites where nobody opens WP Admin.
add_action('deheled_analytics_refresh_event', 'deheled_analytics_refresh');
function deheled_analytics_refresh() {
    $key = get_option(DEHELED_LICENSE_OPTION, '');
    if ($key !== '' && function_exists('deheled_validate_license')) {
        deheled_validate_license($key);
    }
}
add_action('init', function () {
    if (!wp_next_scheduled('deheled_analytics_refresh_event')) {
        wp_schedule_event(time() + 300, 'daily', 'deheled_analytics_refresh_event');
    }
});
register_deactivation_hook(DEHELED_PLUGIN_FILE, function () {
    wp_clear_scheduled_hook('deheled_analytics_refresh_event');
});
