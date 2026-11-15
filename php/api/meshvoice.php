<?php
// İnterkom yedeği (meshvoice.js karşılığı): LiveKit yokken üyeler arası WebRTC. Ses sunucudan geçmez; sunucu oda üyeliği ve sinyal aktarımı yapar.
// Sinyal aktarımı yoklama kadar gecikir (≈0,8 sn). Odada olan oturum hızlı yoklar.
declare(strict_types=1);

const GV_SIG_MAX = 16384;
function gv_max(): int { return min(8, max(2, (int)cfg('GV_MAX', 6) ?: 6)); }
function gv_err(string $m, string $code): array { return ['error' => $m, 'code' => $code]; }
function gv_remove_peer(string $sid, string $why): void {
    $p = one('SELECT gid FROM ml_gvp WHERE sid = ?', [$sid]); if (!$p) return;
    $gid = $p['gid'];
    q('DELETE FROM ml_gvp WHERE sid = ?', [$sid]);
    rt_to_room('gv:' . $gid, 'gv:peer-left', ['id' => $sid, 'why' => $why]);
    rt_leave($sid, 'gv:' . $gid);
    if (!val('SELECT 1 FROM ml_gvp WHERE gid = ? LIMIT 1', [$gid])) rt_leave_all('gv:' . $gid);
}
function gv_tick(string $gid): void {            // gruptan çıkarılan üyeleri sesten at
    foreach (all('SELECT sid, uid FROM ml_gvp WHERE gid = ?', [$gid]) as $r) {
        if (!rg_is_member($gid, $r['uid'])) { rt_to_sid($r['sid'], 'gv:kicked', new stdClass); gv_remove_peer($r['sid'], 'kicked'); }
    }
}
function gv_join(array $S, array $u, array $p): array {
    $gid = (string)($p['gid'] ?? '');
    if (!preg_match('/^[0-9a-f]{16}$/', $gid) || !rg_is_member($gid, $u['id'])) return gv_err('Bu grubun üyesi değilsin.', 'forbidden');
    $cur = one('SELECT gid FROM ml_gvp WHERE sid = ?', [$S['sid']]);
    if ($cur && $cur['gid'] !== $gid) gv_remove_peer($S['sid'], 'switch');
    foreach (all('SELECT sid FROM ml_gvp WHERE gid = ? AND uid = ? AND sid <> ?', [$gid, $u['id'], $S['sid']]) as $o) {   // aynı kullanıcı başka sekme/cihazda: eskisi düşer
        rt_to_sid($o['sid'], 'gv:taken', new stdClass); gv_remove_peer($o['sid'], 'taken');
    }
    $mine = (bool)val('SELECT 1 FROM ml_gvp WHERE sid = ?', [$S['sid']]);
    if (!$mine && (int)val('SELECT COUNT(*) FROM ml_gvp WHERE gid = ?', [$gid]) >= gv_max()) return gv_err('Sesli oda dolu (en fazla ' . gv_max() . ' kişi).', 'full');
    $others = all('SELECT sid, uid, name FROM ml_gvp WHERE gid = ? AND sid <> ? ORDER BY sid', [$gid, $S['sid']]);
    q('REPLACE INTO ml_gvp (sid, gid, uid, name) VALUES (?, ?, ?, ?)', [$S['sid'], $gid, $u['id'], uname($u)]);
    rt_join($S['sid'], 'gv:' . $gid);
    rt_to_room('gv:' . $gid, 'gv:peer-joined', ['id' => $S['sid'], 'uid' => $u['id'], 'name' => uname($u)], $S['sid']);
    return ['ok' => true, 'id' => $S['sid'], 'peers' => array_map(fn($x) => ['id' => $x['sid'], 'uid' => $x['uid'], 'name' => $x['name']], $others), 'max' => gv_max()];
}
function gv_signal(array $S, array $u, array $p): array {
    $me = one('SELECT gid FROM ml_gvp WHERE sid = ?', [$S['sid']]); if (!$me) return gv_err('Sesli odada değilsin.', 'notin');
    $to = (string)($p['to'] ?? '');
    if ($to === '' || $to === $S['sid'] || !val('SELECT 1 FROM ml_gvp WHERE sid = ? AND gid = ?', [$to, $me['gid']])) return gv_err('Hedef odada değil.', 'nopeer');
    $data = $p['data'] ?? null;
    if (!$data || strlen(json_encode($data)) > GV_SIG_MAX) return gv_err('Geçersiz sinyal.', 'bad');
    rt_to_sid($to, 'gv:signal', ['from' => $S['sid'], 'data' => $data]);
    return ['ok' => true];
}
function h_gv_ice(): never {
    need_user();
    $ice = [['urls' => 'stun:stun.l.google.com:19302']];
    $urls = array_values(array_filter(array_map('trim', explode(',', (string)cfg('GV_TURN_URLS', '')))));
    if ($urls && cfg('GV_TURN_USER', '') !== '' && cfg('GV_TURN_CREDENTIAL', '') !== '') $ice[] = ['urls' => $urls, 'username' => cfg('GV_TURN_USER'), 'credential' => cfg('GV_TURN_CREDENTIAL')];
    header('Cache-Control: no-store');
    out(['iceServers' => $ice, 'turn' => count($ice) > 1, 'max' => gv_max()]);
}
