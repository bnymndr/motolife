<?php
// Grup sesi sinyalleşmesi (groupvoice.js karşılığı): ses sunucudan geçmez (WebRTC mesh); sunucu oda üyeliği, sinyal aktarımı,
// lider modu (open|ptt) ve bas-konuş söz hakkını yönetir. Sinyal aktarımı yoklama kadar gecikir (≈1 sn).
declare(strict_types=1);

const GV_LEASE_MS = 20000, GV_MAX_HOLD_MS = 120000, GV_SIG_MAX = 16384;

function gv_max(): int { return min(8, max(2, (int)cfg('GV_MAX', 6) ?: 6)); }
function gv_err(string $m, string $code): array { return ['error' => $m, 'code' => $code]; }
function gv_room(string $gid): array {
    $r = one('SELECT * FROM ml_gvr WHERE gid = ?', [$gid]);
    if (!$r) { q(ins_ignore() . " INTO ml_gvr (gid, mode) VALUES (?, 'ptt')", [$gid]); $r = one('SELECT * FROM ml_gvr WHERE gid = ?', [$gid]); }
    return $r;
}
function gv_holder(array $r): ?array { return $r['f_sid'] ? ['id' => $r['f_sid'], 'uid' => $r['f_uid'], 'name' => $r['f_name']] : null; }
function gv_peers(string $gid): array { return all('SELECT sid, uid, name, mic FROM ml_gvp WHERE gid = ? ORDER BY sid', [$gid]); }
function gv_cur(array $S): ?array {
    $p = one('SELECT * FROM ml_gvp WHERE sid = ?', [$S['sid']]); if (!$p) return null;
    $r = one('SELECT * FROM ml_gvr WHERE gid = ?', [$p['gid']]);
    return $r ? ['gid' => $p['gid'], 'r' => $r, 'peer' => $p] : null;
}
function gv_clear_floor(string $gid, string $why): void {
    $r = one('SELECT * FROM ml_gvr WHERE gid = ?', [$gid]); if (!$r || !$r['f_sid']) return;
    q('UPDATE ml_gvr SET f_sid = NULL, f_uid = NULL, f_name = NULL, f_since = 0, f_until = 0 WHERE gid = ?', [$gid]);
    rt_to_room('gv:' . $gid, 'gv:floor', ['holder' => null, 'why' => $why]);
    if ($why === 'revoked') rt_to_sid($r['f_sid'], 'gv:revoked', new stdClass);
}
function gv_remove_peer(string $sid, string $why): void {
    $p = one('SELECT * FROM ml_gvp WHERE sid = ?', [$sid]); if (!$p) return;
    $gid = $p['gid'];
    q('DELETE FROM ml_gvp WHERE sid = ?', [$sid]);
    $r = one('SELECT * FROM ml_gvr WHERE gid = ?', [$gid]);
    if ($r && $r['f_sid'] === $sid) gv_clear_floor($gid, 'left');
    rt_to_room('gv:' . $gid, 'gv:peer-left', ['id' => $sid, 'why' => $why]);
    rt_leave($sid, 'gv:' . $gid);
    if (!val('SELECT 1 FROM ml_gvp WHERE gid = ? LIMIT 1', [$gid])) { q('DELETE FROM ml_gvr WHERE gid = ?', [$gid]); rt_leave_all('gv:' . $gid); }
}
function gv_kick_user(string $gid, string $uid): void {         // gruptan çıkarılan/ayrılan üye sesten de düşer
    foreach (all('SELECT sid FROM ml_gvp WHERE gid = ? AND uid = ?', [$gid, $uid]) as $r) { rt_to_sid($r['sid'], 'gv:kicked', new stdClass); gv_remove_peer($r['sid'], 'kicked'); }
}
function gv_destroy_group(string $gid): void { foreach (all('SELECT DISTINCT uid FROM ml_gvp WHERE gid = ?', [$gid]) as $r) gv_kick_user($gid, $r['uid']); }
function gv_tick(string $gid): void {                            // süresi dolan söz hakkını temizle
    $r = one('SELECT f_sid, f_until FROM ml_gvr WHERE gid = ?', [$gid]);
    if ($r && $r['f_sid'] && (int)$r['f_until'] <= now_ms()) gv_clear_floor($gid, 'expired');
}

function gv_join(array $S, array $u, array $p): array {
    $gid = (string)($p['gid'] ?? '');
    if (!preg_match('/^[0-9a-f]{16}$/', $gid) || !rg_is_member($gid, $u['id'])) return gv_err('Bu grubun üyesi değilsin.', 'forbidden');
    $cur = one('SELECT gid FROM ml_gvp WHERE sid = ?', [$S['sid']]);
    if ($cur && $cur['gid'] !== $gid) gv_remove_peer($S['sid'], 'switch');
    $r = gv_room($gid);
    foreach (all('SELECT sid FROM ml_gvp WHERE gid = ? AND uid = ? AND sid <> ?', [$gid, $u['id'], $S['sid']]) as $o) {   // aynı kullanıcı başka sekmede/cihazda: eskisi düşer
        rt_to_sid($o['sid'], 'gv:taken', new stdClass); gv_remove_peer($o['sid'], 'taken');
    }
    $mine = (bool)val('SELECT 1 FROM ml_gvp WHERE sid = ?', [$S['sid']]);
    if (!$mine && (int)val('SELECT COUNT(*) FROM ml_gvp WHERE gid = ?', [$gid]) >= gv_max()) return gv_err('Sesli oda dolu (en fazla ' . gv_max() . ' kişi).', 'full');
    $others = array_values(array_filter(gv_peers($gid), fn($x) => $x['sid'] !== $S['sid']));
    q('REPLACE INTO ml_gvp (sid, gid, uid, name, mic) VALUES (?, ?, ?, ?, 0)', [$S['sid'], $gid, $u['id'], uname($u)]);
    rt_join($S['sid'], 'gv:' . $gid);
    rt_to_room('gv:' . $gid, 'gv:peer-joined', ['id' => $S['sid'], 'uid' => $u['id'], 'name' => uname($u)], $S['sid']);
    $r = gv_room($gid); $g = rg_group($gid);
    return ['ok' => true, 'id' => $S['sid'], 'uid' => $u['id'], 'peers' => array_map(fn($x) => ['id' => $x['sid'], 'uid' => $x['uid'], 'name' => $x['name'], 'mic' => (bool)$x['mic']], $others),
        'mode' => $r['mode'], 'holder' => gv_holder($r), 'max' => gv_max(), 'leader' => $g && $g['leader'] === $u['id']];
}
function gv_signal(array $S, array $u, array $p): array {
    $c = gv_cur($S); if (!$c) return gv_err('Sesli odada değilsin.', 'notin');
    $to = (string)($p['to'] ?? '');
    if ($to === '' || $to === $S['sid'] || !val('SELECT 1 FROM ml_gvp WHERE sid = ? AND gid = ?', [$to, $c['gid']])) return gv_err('Hedef odada değil.', 'nopeer');
    $data = $p['data'] ?? null;
    if (!$data || strlen(json_encode($data)) > GV_SIG_MAX) return gv_err('Geçersiz sinyal.', 'bad');
    rt_to_sid($to, 'gv:signal', ['from' => $S['sid'], 'data' => $data]);
    return ['ok' => true];
}
function gv_mode(array $S, array $u, array $p): array {
    $c = gv_cur($S); if (!$c) return gv_err('Sesli odada değilsin.', 'notin');
    $g = rg_group($c['gid']);
    if (!$g || $g['leader'] !== $u['id']) return gv_err('Yalnızca grup lideri modu değiştirebilir.', 'leader');
    $m = $p['mode'] ?? null;
    if ($m !== 'open' && $m !== 'ptt') return gv_err('Geçersiz mod.', 'bad');
    if ($c['r']['mode'] !== $m) {
        q('UPDATE ml_gvr SET mode = ?, f_sid = NULL, f_uid = NULL, f_name = NULL, f_since = 0, f_until = 0 WHERE gid = ?', [$m, $c['gid']]);
        q('UPDATE ml_gvp SET mic = 0 WHERE gid = ?', [$c['gid']]);
        rt_to_room('gv:' . $c['gid'], 'gv:mode', ['mode' => $m, 'by' => uname($u)]);
        rt_to_room('gv:' . $c['gid'], 'gv:floor', ['holder' => null, 'why' => 'mode']);
    }
    return ['ok' => true, 'mode' => $m];
}
function gv_status(array $S, array $u, array $p): array {
    $c = gv_cur($S); if (!$c) return gv_err('Sesli odada değilsin.', 'notin');
    $on = !empty($p['mic']);
    if ($c['r']['mode'] === 'ptt' && $on && $c['r']['f_sid'] !== $S['sid']) return gv_err('Bas-konuş modunda söz hakkın yok.', 'nofloor');
    if ((bool)$c['peer']['mic'] !== $on) {
        q('UPDATE ml_gvp SET mic = ? WHERE sid = ?', [$on ? 1 : 0, $S['sid']]);
        rt_to_room('gv:' . $c['gid'], 'gv:status', ['id' => $S['sid'], 'mic' => $on], $S['sid']);
    }
    return ['ok' => true];
}
function gv_floor(array $S, array $u, array $p): array {
    $c = gv_cur($S); if (!$c) return gv_err('Sesli odada değilsin.', 'notin');
    $gid = $c['gid']; $r = $c['r']; $act = $p['act'] ?? null; $t = now_ms();
    if ($r['mode'] !== 'ptt') return gv_err('Oda açık mikrofon modunda.', 'mode');
    if ($r['f_sid'] && (int)$r['f_until'] <= $t) { gv_clear_floor($gid, 'expired'); $r = one('SELECT * FROM ml_gvr WHERE gid = ?', [$gid]); }
    if ($act === 'acquire') {
        if ($r['f_sid'] && $r['f_sid'] !== $S['sid']) return ['granted' => false, 'holder' => gv_holder($r)];
        $since = $r['f_sid'] === $S['sid'] ? (int)$r['f_since'] : $t;
        q('UPDATE ml_gvr SET f_sid = ?, f_uid = ?, f_name = ?, f_since = ?, f_until = ? WHERE gid = ?', [$S['sid'], $u['id'], uname($u), $since, $t + GV_LEASE_MS, $gid]);
        rt_to_room('gv:' . $gid, 'gv:floor', ['holder' => ['id' => $S['sid'], 'uid' => $u['id'], 'name' => uname($u)]]);
        return ['granted' => true, 'leaseMs' => GV_LEASE_MS];
    }
    if ($act === 'renew') {
        if (!$r['f_sid'] || $r['f_sid'] !== $S['sid']) return ['granted' => false, 'holder' => gv_holder($r)];
        if ($t - (int)$r['f_since'] >= GV_MAX_HOLD_MS) { gv_clear_floor($gid, 'max'); return ['granted' => false, 'why' => 'max']; }
        q('UPDATE ml_gvr SET f_until = ? WHERE gid = ?', [$t + GV_LEASE_MS, $gid]);
        return ['granted' => true, 'leaseMs' => GV_LEASE_MS];
    }
    if ($act === 'release') { if ($r['f_sid'] === $S['sid']) gv_clear_floor($gid, 'released'); return ['ok' => true]; }
    return gv_err('Geçersiz işlem.', 'bad');
}
function gv_revoke(array $S, array $u): array {
    $c = gv_cur($S); if (!$c) return gv_err('Sesli odada değilsin.', 'notin');
    $g = rg_group($c['gid']);
    if (!$g || $g['leader'] !== $u['id']) return gv_err('Yalnızca grup lideri söz hakkını geri alabilir.', 'leader');
    gv_clear_floor($c['gid'], 'revoked');
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
