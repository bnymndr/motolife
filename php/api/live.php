<?php
// Canlı sürücü konumu (live.js karşılığı). Paylaşım açık rızaya bağlıdır; konum oturuma (sid) bağlıdır, bağlantı kopunca silinir.
declare(strict_types=1);

const LV_AGE_MS = 90000, LV_MIN_GAP = 4000, LV_MAX_RIDERS = 100, LV_MAX_KM = 500, LV_MAX_ACC = 200;

function lv_num($v): ?float { return (is_int($v) || is_float($v)) && is_finite((float)$v) ? (float)$v : null; }
function dist_km(float $lat1, float $lon1, float $lat2, float $lon2): float {
    $rad = M_PI / 180; $dLa = ($lat2 - $lat1) * $rad; $dLo = ($lon2 - $lon1) * $rad;
    $a = sin($dLa / 2) ** 2 + cos($lat1 * $rad) * cos($lat2 * $rad) * sin($dLo / 2) ** 2;
    return 2 * 6371 * asin(min(1, sqrt($a)));
}
function loc_share(array $S, array $u, array $p): array {
    if (($p['on'] ?? null) !== true) { q('DELETE FROM ml_live WHERE uid = ? AND sid = ?', [$u['id'], $S['sid']]); return ['ok' => true, 'sharing' => false]; }
    if (($p['consent'] ?? null) !== true) return ['error' => 'Paylaşım için açık onay gerekli.'];
    $aud = $p['aud'] ?? null;
    if (!in_array($aud, ['friends', 'all'], true)) return ['error' => 'Geçersiz paylaşım kapsamı.'];
    $old = one('SELECT * FROM ml_live WHERE uid = ?', [$u['id']]);
    if ($old && $old['sid'] !== $S['sid'] && val('SELECT 1 FROM ml_rts WHERE sid = ?', [$old['sid']])) rt_to_sid($old['sid'], 'loc:taken', null);   // başka sekmede açıktı: paylaşım bu sekmeye geçer
    $keep = $old && $old['lat'] !== null && $old['sid'] === $S['sid'] ? $old : null;
    q('REPLACE INTO ml_live (uid, sid, name, aud, lat, lon, riding, at, seen) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)',
        [$u['id'], $S['sid'], uname($u), $aud, $keep ? (float)$keep['lat'] : null, $keep ? (float)$keep['lon'] : null, $keep ? (int)$keep['riding'] : 0, $keep ? (int)$keep['at'] : 0]);
    return ['ok' => true, 'sharing' => true, 'aud' => $aud];
}
function loc_update(array $S, array $u, array $p): void {
    $e = one('SELECT * FROM ml_live WHERE uid = ? AND sid = ?', [$u['id'], $S['sid']]); if (!$e) return;
    $lat = lv_num($p['lat'] ?? null); $lon = lv_num($p['lon'] ?? null); $acc = array_key_exists('acc', $p) && $p['acc'] !== null ? lv_num($p['acc']) : 0.0;
    if ($lat === null || $lon === null || abs($lat) > 90 || abs($lon) > 180 || $acc === null || $acc > LV_MAX_ACC) return;
    $now = now_ms(); $riding = !empty($p['riding']) ? 1 : 0; $change = $riding !== (int)$e['riding'];
    if ($e['at'] && $now - (int)$e['at'] < LV_MIN_GAP && !$change) return;
    q('UPDATE ml_live SET lat = ?, lon = ?, riding = ?, at = ?, seen = 1 WHERE uid = ? AND sid = ?', [$lat, $lon, $riding, $now, $u['id'], $S['sid']]);
}
function loc_watch(array $S, array $p): array {
    if (!$p || !empty($p['off'])) { q('UPDATE ml_rts SET w_lat = NULL, w_lon = NULL, w_km = NULL, w_key = NULL WHERE sid = ?', [$S['sid']]); return ['ok' => true]; }
    $lat = lv_num($p['lat'] ?? null); $lon = lv_num($p['lon'] ?? null); $km = lv_num($p['km'] ?? null);
    if ($lat === null || $lon === null || $km === null || abs($lat) > 90 || abs($lon) > 180) return ['error' => 'Geçersiz konum.'];
    q('UPDATE ml_rts SET w_lat = ?, w_lon = ?, w_km = ?, w_fo = ?, w_key = NULL WHERE sid = ?', [$lat, $lon, min(LV_MAX_KM, max(1, $km)), ($p['fo'] ?? null) === true ? 1 : 0, $S['sid']]);
    loc_push(one('SELECT * FROM ml_rts WHERE sid = ?', [$S['sid']]), true);
    return ['ok' => true];
}
// İzleyicinin görebileceği sürücüler: yetki (arkadaş/herkes), mesafe ve tazelik sunucuda uygulanır
function loc_snapshot(array $S): array {
    if ($S['w_lat'] === null) return ['list' => [], 'key' => ''];
    $me = $S['uid']; $now = now_ms(); $rows = [];
    foreach (all('SELECT * FROM ml_live WHERE uid <> ? AND lat IS NOT NULL AND at > ?', [$me, $now - LV_AGE_MS]) as $e) {
        if (is_blocked($me, $e['uid'])) continue;                                          // engelli kullanıcılar birbirini görmez
        $fr = is_friend($me, $e['uid']);
        if ($e['aud'] === 'friends' && !$fr) continue;
        if ($S['w_fo'] && !$fr) continue;
        $lat = $fr ? (float)$e['lat'] : jsround((float)$e['lat'] * 1000) / 1000;           // arkadaş olmayanlara ≈100 m yuvarlanmış konum
        $lon = $fr ? (float)$e['lon'] : jsround((float)$e['lon'] * 1000) / 1000;
        $km = dist_km((float)$S['w_lat'], (float)$S['w_lon'], $lat, $lon);
        if ($km > (float)$S['w_km']) continue;
        $rows[] = ['u' => $e['name'], 'rel' => $fr ? 'friend' : 'other', 'riding' => (bool)$e['riding'], 'lat' => $lat, 'lon' => $lon, 'approx' => !$fr,
            'km' => jsround($km * 10) / 10, 'age' => (int)jsround(($now - (int)$e['at']) / 1000)];
    }
    usort($rows, fn($a, $b) => $a['km'] <=> $b['km']);
    $list = array_slice($rows, 0, LV_MAX_RIDERS);
    return ['list' => $list, 'key' => implode(';', array_map(fn($r) => implode(',', [$r['u'], $r['lat'], $r['lon'], $r['riding'] ? 1 : 0, $r['rel']]), $list))];
}
function loc_push(array $S, bool $force): void {
    $s = loc_snapshot($S);
    if (!$force && $S['w_key'] !== null && $s['key'] === $S['w_key']) return;
    q('UPDATE ml_rts SET w_key = ? WHERE sid = ?', [$s['key'], $S['sid']]);
    rt_to_sid($S['sid'], 'loc:riders', $s['list']);
}
function live_stop_by_sid(string $sid, array $u): void { q('DELETE FROM ml_live WHERE sid = ?', [$sid]); }
