<?php
// Moto Life API girişi: .htaccess  /api/*  isteklerini buraya yönlendirir.
declare(strict_types=1);
foreach (['bootstrap', 'auth', 'social', 'rt', 'live', 'gvoice', 'rgroups', 'ridecore', 'rides', 'weather', 'maps', 'offline'] as $f) require __DIR__ . '/' . $f . '.php';

header('X-Content-Type-Options: nosniff'); header('Referrer-Policy: strict-origin-when-cross-origin'); header('Cache-Control: no-store');
if (is_https()) header('Strict-Transport-Security: max-age=15552000');
set_exception_handler(function (Throwable $e) {
    error_log('[moto-life] ' . get_class($e) . ': ' . $e->getMessage() . ' @ ' . basename($e->getFile()) . ':' . $e->getLine());
    if (!headers_sent()) { http_response_code(500); header('Content-Type: application/json; charset=utf-8'); }
    $msg = $e instanceof PDOException ? 'Veritabanına bağlanılamadı veya şema kurulamadı (kod ' . $e->getCode() . '). api/config.php içindeki DB_HOST / DB_NAME / DB_USER / DB_PASS değerlerini ve kullanıcının veritabanına yetkisini kontrol et. Ayrıntı: /api/health'
        : (cfg('DEBUG', '') ? $e->getMessage() : 'Sunucu hatası. Ayrıntı için /api/health adresini aç.');
    echo json_encode(['error' => $msg], JSON_UNESCAPED_UNICODE);
});

$path = (string)parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);
$pos = strpos($path, '/api/'); $path = $pos === false ? '/' : substr($path, $pos + 4);
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if ($method === 'OPTIONS') { http_response_code(204); exit; }

$U = '([^/]+)'; $I = '([0-9a-f]{16})';
$routes = [
    ['GET', '/health', 'h_health'], ['GET', '/me', 'h_me'], ['GET', '/captcha', 'h_captcha'], ['POST', '/register', 'h_register'], ['POST', '/login', 'h_login'], ['POST', '/logout', 'h_logout'],
    ['POST', '/account', 'h_account'], ['POST', '/account/delete', 'h_account_delete'], ['POST', '/avatar', 'h_avatar'], ['POST', '/forgot', 'h_forgot'], ['POST', '/reset', 'h_reset'],
    ['GET', '/social/me', 'h_so_me'], ['PUT', '/social/profile', 'h_so_profile_put'], ['GET', "/social/avatar/$U", 'h_so_avatar'], ['PUT', '/social/cover', 'h_so_cover_put'], ['GET', "/social/cover/$U", 'h_so_cover'], ['GET', "/social/users/$U/posts", 'h_so_user_posts'], ['GET', "/social/users/$U", 'h_so_user'],
    ['POST', '/social/upload', 'h_so_upload'], ['GET', "/social/img/$U", 'h_so_img'], ['GET', '/social/feed', 'h_so_feed'], ['POST', '/social/posts', 'h_so_post_create'],
    ['DELETE', "/social/posts/$U", 'h_so_post_delete'], ['POST', "/social/posts/$U/like", 'h_so_like'], ['POST', "/social/posts/$U/comments", 'h_so_comment'],
    ['GET', '/social/search', 'h_so_search'], ['GET', '/social/friends', 'h_so_friends'], ['POST', '/social/requests', 'h_so_request_create'], ['POST', "/social/requests/$U/accept", 'h_so_request_accept'],
    ['DELETE', "/social/requests/$U", 'h_so_request_delete'], ['DELETE', "/social/friends/$U", 'h_so_friend_delete'], ['GET', '/social/blocks', 'h_so_blocks'], ['POST', '/social/blocks', 'h_so_block_add'], ['DELETE', "/social/blocks/$U", 'h_so_block_del'], ['GET', "/social/messages/$U", 'h_so_messages_get'], ['POST', "/social/messages/$U", 'h_so_messages_post'],
    ['POST', '/rides', 'h_ride_post'], ['GET', '/rides', 'h_ride_list'], ['POST', "/rides/$U/tele", 'h_ride_tele_post'], ['GET', "/rides/$U/tele", 'h_ride_tele_get'], ['GET', "/rides/$U", 'h_ride_get'],
    ['GET', '/rgroups', 'h_rg_list'], ['POST', '/rgroups', 'h_rg_create'], ['POST', '/rgroups/join', 'h_rg_join'], ['GET', '/rgroups/preview', 'h_rg_preview'],
    ['GET', "/rgroups/$U", 'h_rg_get'], ['PATCH', "/rgroups/$U", 'h_rg_patch'], ['DELETE', "/rgroups/$U", 'h_rg_delete'],
    ['POST', "/rgroups/$U/leave", 'h_rg_leave'], ['POST', "/rgroups/$U/kick", 'h_rg_kick'], ['POST', "/rgroups/$U/leader", 'h_rg_leader'], ['POST', "/rgroups/$U/code", 'h_rg_code'], ['POST', "/rgroups/$U/role", 'h_rg_role'], ['PUT', "/rgroups/$U/pic/$U", 'h_rg_pic_put'], ['GET', "/rgroups/$U/pic/$U", 'h_rg_pic_get'],
    ['POST', "/rgroups/$U/start", 'h_rg_start'], ['POST', "/rgroups/$U/end", 'h_rg_end'],
    ['PUT', "/rgroups/$U/route", 'h_rg_route_put'], ['GET', "/rgroups/$U/route", 'h_rg_route_get'], ['DELETE', "/rgroups/$U/route", 'h_rg_route_delete'],
    ['GET', "/rgroups/$U/posts", 'h_rg_posts'], ['POST', "/rgroups/$U/posts", 'h_rg_post_create'], ['DELETE', "/rgroups/$U/posts/$U", 'h_rg_post_delete'],
    ['POST', "/rgroups/$U/posts/$U/like", 'h_rg_post_like'], ['POST', "/rgroups/$U/posts/$U/comments", 'h_rg_post_comment'], ['DELETE', "/rgroups/$U/posts/$U/comments/$U", 'h_rg_comment_delete'],
    ['GET', "/rgroups/$U/rides", 'h_rg_rides'], ['GET', "/rgroups/$U/rides/$U", 'h_rg_ride_get'],
    ['GET', '/gvoice/ice', 'h_gv_ice'], ['GET', '/weather', 'h_weather'], ['GET', '/maps/config', 'h_maps_config'], ['GET', '/offline/manifest', 'h_offline_manifest'], ['GET', '/geocode', 'h_geocode'], ['GET', '/route', 'h_route'],
    ['POST', '/rt', 'h_rt'],
];
foreach ($routes as [$m, $re, $fn]) {
    if ($m === $method && preg_match('#^' . $re . '$#', $path, $mm)) { array_shift($mm); $fn(...array_map('rawurldecode', $mm)); exit; }
}
fail(404, 'Bulunamadı.');

// Kurulum tanılaması: sır içermez; yalnızca PHP sürümü, uzantılar, yapılandırma dosyası ve veritabanı bağlantı durumu.
function h_health(): never {
    $r = ['php' => PHP_VERSION, 'phpOk' => PHP_VERSION_ID >= 80100, 'pdo_mysql' => extension_loaded('pdo_mysql'), 'curl' => extension_loaded('curl'), 'openssl' => extension_loaded('openssl'), 'mbstring' => extension_loaded('mbstring'),
        'configFile' => is_file(__DIR__ . '/config.php'), 'driver' => sqlite_mode() ? 'sqlite' : 'mysql', 'dbHostSet' => (string)cfg('DB_HOST', '') !== '', 'dbNameSet' => (string)cfg('DB_NAME', '') !== '', 'dbUserSet' => (string)cfg('DB_USER', '') !== ''];
    try { db(); $r['db'] = 'ok'; $r['tables'] = (int)val("SELECT COUNT(*) FROM ml_users") >= 0; }
    catch (Throwable $e) { $r['db'] = 'hata'; $r['dbCode'] = $e instanceof PDOException ? (string)$e->getCode() : get_class($e); }
    out($r);
}
