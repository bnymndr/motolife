<?php
// LiveKit belirteci (livekit.js karşılığı): POST /api/livekit/token { gid } → { url, token, room, identity }.
// Yalnız grup üyesi; gizli bilgiler yalnız sunucuda (LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET), yoksa 503. HS256 JWT elle imzalanır.
declare(strict_types=1);

function lk_token(string $key, string $secret, string $identity, string $name, string $room, int $ttl = 3600): string {
    $t = time();
    $head = b64u(json_encode(['alg' => 'HS256', 'typ' => 'JWT']));
    $body = b64u(json_encode(['iss' => $key, 'sub' => $identity, 'name' => $name, 'nbf' => $t - 5, 'exp' => $t + $ttl,
        'video' => ['room' => $room, 'roomJoin' => true, 'canPublish' => true, 'canSubscribe' => true, 'canPublishData' => false]], JSON_UNESCAPED_UNICODE));
    return $head . '.' . $body . '.' . b64u(hash_hmac('sha256', $head . '.' . $body, $secret, true));
}
function h_livekit_token(): never {
    $u = need_user();
    if (rl('lk:' . $u['id'], 10, 60000)) fail(429, 'Çok sık istek.');
    $url = (string)cfg('LIVEKIT_URL'); $key = (string)cfg('LIVEKIT_API_KEY'); $secret = (string)cfg('LIVEKIT_API_SECRET');
    if ($url === '' || $key === '' || $secret === '') fail(503, 'İnterkom yapılandırılmadı.');
    $g = rg_member_group(body()['gid'] ?? '', $u);
    if (!$g) fail(404, 'Grup bulunamadı.');
    if (!room_in($g['id'], (string)$u['id'])) fail(403, 'Önce interkom odasına şifreyle gir.');
    $room = 'ml-' . $g['id'];
    header('Cache-Control: no-store');
    out(['url' => $url, 'room' => $room, 'identity' => (string)$u['id'], 'token' => lk_token($key, $secret, (string)$u['id'], uname($u), $room)]);
}
