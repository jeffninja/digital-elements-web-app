<?php
/**
 * Plugin Name: WP Monitor Helper
 * Description: Exposes a token-secured REST endpoint reporting pending core,
 *              plugin and theme updates for the WP Monitor dashboard.
 * Version:     1.0.0
 * Author:      Your Agency
 *
 * INSTALL (recommended): drop this file in  wp-content/mu-plugins/wpmonitor-helper.php
 * (create the mu-plugins folder if it does not exist). mu-plugins auto-activate
 * and cannot be deactivated by the client.
 *
 * Alternatively install as a normal plugin: put this file in a folder, zip it,
 * and upload via Plugins > Add New > Upload, then activate.
 *
 * SECURITY: set a long, unique token per site below (or define WPMONITOR_TOKEN
 * in wp-config.php). Put the SAME token in the dashboard's config/sites.json.
 */

if (!defined('ABSPATH')) {
    exit;
}

// Set a unique token per site. A wp-config.php constant overrides this value.
if (!defined('WPMONITOR_TOKEN')) {
    define('WPMONITOR_TOKEN', 'CHANGE_ME_set_a_long_random_token');
}

add_action('rest_api_init', function () {
    register_rest_route('wpmonitor/v1', '/status', array(
        'methods'             => 'GET',
        'permission_callback' => 'wpmonitor_check_token',
        'callback'            => 'wpmonitor_status',
    ));
});

/**
 * Accepts the token from an Authorization: Bearer header or X-WPMonitor-Token.
 */
function wpmonitor_check_token($request) {
    $provided = '';

    $auth = $request->get_header('authorization');
    if ($auth && stripos($auth, 'Bearer ') === 0) {
        $provided = trim(substr($auth, 7));
    }
    if ($provided === '') {
        $provided = (string) $request->get_header('x-wpmonitor-token');
    }

    if ($provided !== '' && hash_equals(WPMONITOR_TOKEN, $provided)) {
        return true;
    }

    return new WP_Error('wpmonitor_forbidden', 'Invalid token', array('status' => 403));
}

/**
 * Builds the status payload: core, plugin and theme updates plus versions.
 */
function wpmonitor_status() {
    require_once ABSPATH . 'wp-admin/includes/update.php';
    require_once ABSPATH . 'wp-admin/includes/plugin.php';
    require_once ABSPATH . 'wp-admin/includes/theme.php';

    // Refresh the update caches so counts are current.
    wp_update_plugins();
    wp_update_themes();
    wp_version_check();

    // ---- Plugins ----
    $plugin_updates = array();
    if (function_exists('get_plugin_updates')) {
        foreach (get_plugin_updates() as $file => $data) {
            $plugin_updates[] = array(
                'name'        => isset($data->Name) ? $data->Name : $file,
                'current'     => isset($data->Version) ? $data->Version : null,
                'new_version' => isset($data->update->new_version) ? $data->update->new_version : null,
            );
        }
    }

    // ---- Themes ----
    $theme_updates = array();
    if (function_exists('get_theme_updates')) {
        foreach (get_theme_updates() as $stylesheet => $theme) {
            $theme_updates[] = array(
                'name'        => $theme->get('Name'),
                'current'     => $theme->get('Version'),
                'new_version' => isset($theme->update['new_version']) ? $theme->update['new_version'] : null,
            );
        }
    }

    // ---- Core ----
    $core_update_available = false;
    $core_new_version = null;
    if (function_exists('get_preferred_from_update_core')) {
        $core = get_preferred_from_update_core();
        if (is_object($core) && isset($core->response) && $core->response === 'upgrade') {
            $core_update_available = true;
            $core_new_version = isset($core->current) ? $core->current : null;
        }
    }

    return rest_ensure_response(array(
        'generated_at'          => current_time('c'),
        'wp_version'            => get_bloginfo('version'),
        'php_version'           => PHP_VERSION,
        'core_update_available' => $core_update_available,
        'core_new_version'      => $core_new_version,
        'plugin_updates'        => $plugin_updates,
        'theme_updates'         => $theme_updates,
    ));
}
