<?php
// Gerçek zamanlı katman: Socket.IO yerine HTTP yoklaması (polling). İstemci (public/rt.js) POST /api/rt ile olay gönderir,
// sıradaki sunucu olaylarını alır. Olaylar ml_rte tablosunda oturum (sid) başına kuyruklanır; odalar ml_rtr tablosundadır.
// Bağlantı "kopması": oturum LIVE_MS boyunca yoklamazsa (ya da sayfa kapanırken sendBeacon ile bye gelirse) bağlantı kopmuş sayılır.
declare(strict_types=1);

const RT_LIVE_MS = 30000;

function rt_json($p): string { return json_encode($p, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRESERVE_ZERO_FRACTION | JSON_INVALID_UTF8_SUBSTITUTE); }
function rt_to_sid(string $sid, string $ev, $payload = null): void { q('INSERT INTO ml_rte (sid, ev, payload, at) VALUES (?, ?, ?, ?)', [$sid, $ev, rt_json($payload), now_ms()]); }
function rt_to_user(string $uid, string $ev, $payload = null): void {
    q('INSERT INTO ml_rte (sid, ev, payload, at) SELECT sid, ?, ?, ? FROM ml_rts WHERE uid = ? AND last > ?', [$ev, rt_json($payload), now_ms(), $uid, now_ms() - RT_LIVE_MS]);
}
function rt_to_room(string $room, string $ev, $payload = null, ?string $except = null): void {
    q('INSERT INTO ml_rte (sid, ev, payload, at) SELECT sid, ?, ?, ? FROM ml_rtr WHERE room = ? AND sid <> ?', [$ev, rt_json($payload), now_ms(), $room, $except ?? '']);
}
function rt_join(string $sid, string $room): void { q(ins_ignore() . ' INTO ml_rtr (sid, room, skey) VALUES (?, ?, NULL)', [$sid, $room]); }
function rt_leave(string $sid, string $room): void { q('DELETE FROM ml_rtr WHERE sid = ? AND room = ?', [$sid, $room]); }
function rt_leave_user(string $uid, string $room): void { q('DELETE FROM ml_rtr WHERE room = ? AND sid IN (SELECT sid FROM ml_rts WHERE uid = ?)', [$room, $uid]); }
function rt_leave_all(string $room): void { q('DELETE FROM ml_rtr WHERE room = ?', [$room]); }
function rt_online(string $uid): bool { return (bool)val('SELECT 1 FROM ml_rts WHERE uid = ? AND last > ? LIMIT 1', [$uid, now_ms() - RT_LIVE_MS]); }
function rt_presence(array $u, bool $on): void {
    foreach (social_friend_ids($u['id']) as $f) rt_to_user($f, 'social:presence', ['username' => uname($u), 'online' => $on]);
}

function rt_connect(array $u): string {
    $first = !rt_online($u['id']);
    $sid = rid(); $t = now_ms();
    q('INSERT INTO ml_rts (sid, uid, last, created) VALUES (?, ?, ?, ?)', [$sid, $u['id'], $t, $t]);
    if ($first) rt_presence($u, true);
    return $sid;
}
// Bağlantı koptu: o bağlantıya bağlı paylaşım/oda/ses kayıtlarını temizle
function rt_disconnect(string $sid): void {
    $S = one('SELECT * FROM ml_rts WHERE sid = ?', [$sid]); if (!$S) return;
    $u = user_by_id($S['uid']);
    q('DELETE FROM ml_rts WHERE sid = ?', [$sid]);                  // önce silinir: aşağıdaki işlemler bu oturuma olay yazmaz
    if ($u) {
        live_stop_by_sid($sid, $u);
        rg_disconnect($sid, $u);
        gv_remove_peer($sid, 'disconnect');
    }
    q('DELETE FROM ml_rtr WHERE sid = ?', [$sid]);
    q('DELETE FROM ml_rte WHERE sid = ?', [$sid]);
    if ($u && !rt_online($u['id'])) rt_presence($u, false);
}
function rt_drop_user(string $uid): void { foreach (all('SELECT sid FROM ml_rts WHERE uid = ?', [$uid]) as $r) rt_disconnect($r['sid']); }
function rt_sweep(): void {
    if (kv_get('rt:sweep') !== null) return;
    kv_set('rt:sweep', '1', 7000);
    foreach (all('SELECT sid FROM ml_rts WHERE last < ? LIMIT 50', [now_ms() - RT_LIVE_MS]) as $r) rt_disconnect($r['sid']);
    q('DELETE FROM ml_rte WHERE at < ?', [now_ms() - 300000]);
}

function rt_dispatch(array $S, array $u, string $ev, $d): array {
    $d = is_array($d) ? $d : [];
    switch ($ev) {
        case 'dm:send': return dm_send($u, (string)($d['to'] ?? ''), $d['text'] ?? '', $d['cid'] ?? null);
        case 'dm:typing': dm_typing($u, (string)($d['to'] ?? ''), !empty($d['typing'])); return ['ok' => true];
        case 'dm:read': return dm_read_ev($u, (string)($d['with'] ?? ''));
        case 'loc:share': return loc_share($S, $u, $d);
        case 'loc:update': loc_update($S, $u, $d); return ['ok' => true];
        case 'loc:watch': return loc_watch($S, $d);
        case 'grp:watch': return grp_watch($S, $u, $d);
        case 'grp:unwatch': grp_unwatch($S, $u, $d); return ['ok' => true];
        case 'grp:share': return grp_share($S, $u, $d);
        case 'grp:update': grp_update($S, $u, $d); return ['ok' => true];
        case 'gv:join': return gv_join($S, $u, $d);
        case 'gv:signal': return gv_signal($S, $u, $d);
        case 'gv:leave': gv_remove_peer($S['sid'], 'left'); return ['ok' => true];
        case 'gv:mode': return gv_mode($S, $u, $d);
        case 'gv:status': return gv_status($S, $u, $d);
        case 'gv:floor': return gv_floor($S, $u, $d);
        case 'gv:revoke': return gv_revoke($S, $u);
    }
    return ['error' => 'Bilinmeyen olay.'];
}

// POST /api/rt  { sid?, after, emits: [{ev, data, id?}], bye? }  →  { sid, fresh, events, acks, next, keep }
function h_rt(): never {
    $u = need_user(); $b = body(262144);
    $sid = is_string($b['sid'] ?? null) && preg_match('/^[0-9a-f]{16}$/', $b['sid']) ? $b['sid'] : '';
    $S = $sid !== '' ? one('SELECT * FROM ml_rts WHERE sid = ? AND uid = ?', [$sid, $u['id']]) : null;
    if (!empty($b['bye'])) { if ($S) rt_disconnect($sid); out(['ok' => true]); }
    $fresh = false; $t = now_ms();
    if ($S && $S['last'] < $t - RT_LIVE_MS) { rt_disconnect($sid); $S = null; }     // süresi dolmuş oturum yeniden kurulur
    if (!$S) { $sid = rt_connect($u); $S = one('SELECT * FROM ml_rts WHERE sid = ?', [$sid]); $fresh = true; }
    else q('UPDATE ml_rts SET last = ? WHERE sid = ?', [$t, $sid]);
    rt_sweep();

    $acks = []; $worked = false;
    foreach (array_slice(is_array($b['emits'] ?? null) ? $b['emits'] : [], 0, 60) as $e) {
        if (!is_array($e) || !is_string($e['ev'] ?? null)) continue;
        $worked = true;
        $S = one('SELECT * FROM ml_rts WHERE sid = ?', [$sid]) ?? $S;           // izleme/paylaşım durumu önceki olaylarla değişmiş olabilir
        try { $res = rt_dispatch($S, $u, $e['ev'], $e['data'] ?? null); }
        catch (Throwable $x) { error_log('[moto-life] rt ' . $e['ev'] . ': ' . $x->getMessage()); $res = ['error' => 'Sunucu hatası.']; }
        if (isset($e['id']) && is_int($e['id'])) $acks[(string)$e['id']] = $res;
    }

    // Sunucu taraflı "periyodik" işler bu oturum için burada yapılır (arka plan süreci yok)
    $S = one('SELECT * FROM ml_rts WHERE sid = ?', [$sid]) ?? $S;
    if ($S['w_lat'] !== null) loc_push($S, false);
    $rooms = all('SELECT room, skey FROM ml_rtr WHERE sid = ?', [$sid]);
    $inRg = false; $inGv = false;
    foreach ($rooms as $r) {
        if (str_starts_with($r['room'], 'rg:')) { $inRg = true; grp_push($sid, substr($r['room'], 3), $r['skey']); }
        elseif (str_starts_with($r['room'], 'gv:')) { $inGv = true; gv_tick(substr($r['room'], 3)); }
    }

    $after = is_int($b['after'] ?? null) ? $b['after'] : 0;
    if ($after > 0) q('DELETE FROM ml_rte WHERE sid = ? AND id <= ?', [$sid, $after]);
    $rows = all('SELECT id, ev, payload FROM ml_rte WHERE sid = ? AND id > ? ORDER BY id LIMIT 300', [$sid, $after]);
    $evs = [];
    foreach ($rows as $r) $evs[] = '{"id":' . $r['id'] . ',"ev":' . rt_json($r['ev']) . ',"data":' . $r['payload'] . '}';

    $sharing = (bool)val('SELECT 1 FROM ml_live WHERE sid = ? LIMIT 1', [$sid]) || (bool)val('SELECT 1 FROM ml_rglive WHERE sid = ? LIMIT 1', [$sid]);
    $next = $inGv ? 800 : ($inRg ? 1500 : (($S['w_lat'] !== null || $sharing) ? 3000 : 4500));
    if (($worked || $evs) && $next > 2000) $next = 2000;
    http_response_code(200);
    header('Content-Type: application/json; charset=utf-8');
    echo '{"sid":"' . $sid . '","fresh":' . ($fresh ? 'true' : 'false') . ',"events":[' . implode(',', $evs) . '],"acks":' . ($acks ? rt_json($acks) : '{}') . ',"next":' . $next . ',"keep":' . (($inGv || $inRg || $sharing) ? 'true' : 'false') . '}';
    exit;
}
