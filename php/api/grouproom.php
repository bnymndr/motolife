<?php
// Grup interkom odaları (grouproom.js karşılığı): bir grupta BİRDEN ÇOK sesli oda (en çok 10); her oda 24 SAAT yaşar (aktif olsun olmasın), süre dolunca kapanır ve silinir.
// Oda = ad + şifre, kuran = lider. Şifre password_hash ile saklanır, yanıtlarda ASLA yok. Ses mesh ile (meshvoice.php, anahtar = oda kimliği); burası yetki/durum.
// Kalp atışı: GET rooms/:rid?hb=1 (45 sn sessiz kalan düşer). Süpürme (süre dolumu, sessiz katılımcı) her erişimde çalışır. Tablolar: ml_rm, ml_rmp, ml_rmx (SCHEMA_VERSION 9).
declare(strict_types=1);

const RM_SEEN_MS = 45000, RM_FAIL_N = 5, RM_FAIL_MS = 60000, RM_INVITE_MS = 1800000, RM_TTL_MS = 86400000, RM_MAX = 10;
function rm_clean($s): string { $s = trim(preg_replace('/\s+/u', ' ', (string)$s)); return mb_substr($s, 0, 30); }
function rm_same(string $a, string $b): bool { return mb_strtolower(rm_clean($a), 'UTF-8') === mb_strtolower(rm_clean($b), 'UTF-8'); }
function rm_room(string $rid): ?array { return preg_match('/^[0-9a-f]{12}$/', $rid) ? one('SELECT * FROM ml_rm WHERE rid = ?', [$rid]) : null; }
function rm_gid(string $rid): ?string { $r = rm_room($rid); return $r ? $r['gid'] : null; }                   // ses anahtarı (oda kimliği) → grup
function room_in(string $gid, string $uid): bool { return (bool)val('SELECT 1 FROM ml_rmp WHERE gid = ? AND uid = ?', [$gid, $uid]); }          // grupta herhangi bir odada mı
function room_in_rid(string $rid, string $uid): bool { return (bool)val('SELECT 1 FROM ml_rmp WHERE rid = ? AND uid = ?', [$rid, $uid]); }
function rm_push(array $r): void {
    q('UPDATE ml_rm SET ver = ver + 1 WHERE rid = ?', [$r['rid']]); $ver = (int)$r['ver'] + 1;
    foreach (all('SELECT uid FROM ml_rmp WHERE rid = ?', [$r['rid']]) as $p) rt_to_user($p['uid'], 'room:changed', ['gid' => $r['gid'], 'rid' => $r['rid'], 'ver' => $ver]);
}
function rm_ping(array $g, string $rid): void { foreach (rg_members($g['id']) as $m) rt_to_user($m['uid'], 'room:changed', ['gid' => $g['id'], 'rid' => $rid, 'list' => true]); }
function rm_drop(array $g, array $r, string $uid, string $why): void {
    $rid = $r['rid']; if (!room_in_rid($rid, $uid)) return;
    q('DELETE FROM ml_rmp WHERE rid = ? AND uid = ?', [$rid, $uid]); gv_kick_uid($rid, $uid, $why);
    if (function_exists('rm_ride_left')) rm_ride_left($g, $r, $uid);
    $next = one('SELECT uid FROM ml_rmp WHERE rid = ? ORDER BY joined, uid LIMIT 1', [$rid]);
    if (!$next) { q('UPDATE ml_rm SET leader = NULL, src = NULL WHERE rid = ?', [$rid]); rm_ping($g, $rid); return; }          // boş oda 24 saat dolana dek sürer
    if ($r['leader'] === $uid) {
        $src = json_decode((string)$r['src'], true);
        q('UPDATE ml_rm SET leader = ?, src = ? WHERE rid = ?', [$next['uid'], ($src && ($src['by'] ?? '') === $uid) ? null : $r['src'], $rid]);
    }
    rm_push(rm_room($rid) ?? $r); rm_ping($g, $rid);
}
function rm_close(?array $g, array $r, string $why): void {
    foreach (all('SELECT uid FROM ml_rmp WHERE rid = ?', [$r['rid']]) as $p) { rt_to_user($p['uid'], 'room:changed', ['gid' => $r['gid'], 'rid' => $r['rid'], 'ver' => 0, 'closed' => $why]); gv_kick_uid($r['rid'], $p['uid'], 'closed'); }
    q('DELETE FROM ml_rmp WHERE rid = ?', [$r['rid']]); q('DELETE FROM ml_rmx WHERE rid = ?', [$r['rid']]); q('DELETE FROM ml_rm WHERE rid = ?', [$r['rid']]);
    if (function_exists('rm_ride_closed')) rm_ride_closed($g, $r, $why);                      // sürüş aşaması: odaya bağlı grup sürüşünü bitirir
    if ($g) rm_ping($g, $r['rid']);
}
function rm_sweep(array $g): void {
    foreach (all('SELECT * FROM ml_rm WHERE gid = ?', [$g['id']]) as $r) {
        if (now_ms() >= (int)$r['exp']) { rm_close($g, $r, 'expired'); continue; }
        foreach (all('SELECT uid, seen FROM ml_rmp WHERE rid = ?', [$r['rid']]) as $p)
            if (!rg_is_member($g['id'], $p['uid']) || now_ms() - (int)$p['seen'] > RM_SEEN_MS) rm_drop($g, $r, $p['uid'], 'gone');
    }
}
function rm_inv(string $rid, string $uid): bool { return (int)(val("SELECT until FROM ml_rmx WHERE rid = ? AND uid = ? AND kind = 'inv'", [$rid, $uid]) ?? 0) > now_ms(); }
function rm_item(array $r, string $uid): array {
    $n = (int)val('SELECT COUNT(*) FROM ml_rmp WHERE rid = ?', [$r['rid']]); $inv = rm_inv($r['rid'], $uid);
    $ban = (bool)val("SELECT 1 FROM ml_rmx WHERE rid = ? AND uid = ? AND kind = 'ban'", [$r['rid'], $uid]);
    $ln = $r['leader'] ? (string)(val('SELECT name FROM ml_rmp WHERE rid = ? AND uid = ?', [$r['rid'], $r['leader']]) ?? rg_name($r['leader'])) : '';
    return ['rid' => $r['rid'], 'name' => $r['name'], 'count' => $n, 'leaderName' => $ln, 'exp' => (int)$r['exp'], 'in' => room_in_rid($r['rid'], $uid), 'invited' => $inv, 'banned' => $ban && !$inv];
}
function rm_view(array $g, array $r, string $uid): array {
    $o = rm_item($r, $uid); $o['ver'] = (int)$r['ver'];
    if (!$o['in']) return $o;
    $parts = all('SELECT uid, name, joined, vol, muted FROM ml_rmp WHERE rid = ? ORDER BY joined, uid', [$r['rid']]);
    $o['lead'] = $r['leader'] === $uid; $o['leader'] = $r['leader'];
    $o['parts'] = array_map(fn($p) => ['uid' => $p['uid'], 'name' => $p['name'], 'lead' => $p['uid'] === $r['leader'], 'vol' => (int)$p['vol'], 'muted' => (bool)$p['muted'], 'you' => $p['uid'] === $uid], $parts);
    $o['src'] = $r['src'] ? json_decode($r['src'], true) : null; $o['ride'] = rm_ride_view($g, $r, $uid);
    if ($r['leader'] === $uid) {
        $in = array_column($parts, 'uid'); $o['members'] = [];
        foreach (rg_members($g['id']) as $m) if (!in_array($m['uid'], $in, true)) $o['members'][] = ['uid' => $m['uid'], 'name' => rg_name($m['uid']), 'invited' => rm_inv($r['rid'], $m['uid'])];
    }
    return $o;
}
function rm_ride_view(array $g, array $r, string $uid): ?array {          // yalnız bu odaya bağlı ve hâlâ sürmekte olan sürüş
    if (empty($r['ride'])) return null; $x = json_decode((string)$r['ride'], true); $cur = rg_group($g['id']);
    if (!$x || !$cur || !$cur['ride_id'] || ($x['id'] ?? '') !== $cur['ride_id']) return null;
    $nums = (object)($x['nums'] ?? []); $mine = ((array)$nums)[$uid] ?? null;
    return ['id' => $x['id'], 'startedAt' => (int)$cur['ride_started'], 'nums' => $nums, 'mine' => $mine === null ? null : (int)$mine, 'by' => rg_name((string)($x['by'] ?? ''))];
}
function rm_ctx(string $id, string $rid): array {
    [$u, $g] = rg_ctx($id); rm_sweep($g); $r = rm_room($rid);
    if (!$r || $r['gid'] !== $g['id']) fail(404, 'Oda bulunamadı ya da süresi doldu.');
    return [$u, $g, $r];
}
function rm_lead(string $id, string $rid): array {
    [$u, $g, $r] = rm_ctx($id, $rid);
    if (!room_in_rid($rid, $u['id'])) fail(404, 'Odada değilsin.');
    if ($r['leader'] !== $u['id']) fail(403, 'Bu işlem için oda lideri olmalısın.');
    return [$u, $g, $r];
}
function rm_target(array $g, array $b): ?string { foreach (rg_members($g['id']) as $m) if ((string)$m['uid'] === (string)($b['uid'] ?? '')) return $m['uid']; return null; }
function rm_enter(array $g, array $u, array $r): void {          // gruptaki diğer odalardan çık, bu odaya gir (lider yoksa lider olur)
    foreach (all('SELECT * FROM ml_rm WHERE gid = ? AND rid <> ?', [$g['id'], $r['rid']]) as $o) if (room_in_rid($o['rid'], $u['id'])) rm_drop($g, $o, $u['id'], 'switch');
    q('REPLACE INTO ml_rmp (rid, gid, uid, name, joined, seen, vol, muted) VALUES (?, ?, ?, ?, ?, ?, 100, 0)', [$r['rid'], $g['id'], $u['id'], uname($u), now_ms(), now_ms()]);
    q('DELETE FROM ml_rmx WHERE rid = ? AND uid = ?', [$r['rid'], $u['id']]);
    if (!$r['leader'] || !room_in_rid($r['rid'], (string)$r['leader'])) q('UPDATE ml_rm SET leader = ? WHERE rid = ?', [$u['id'], $r['rid']]);
}
function h_rooms_list(string $id): never {
    [$u, $g] = rg_ctx($id); rm_sweep($g); header('Cache-Control: no-store');
    $list = array_map(fn($r) => rm_item($r, $u['id']), all('SELECT * FROM ml_rm WHERE gid = ? ORDER BY created, rid', [$g['id']]));
    $mine = null; foreach ($list as $x) if ($x['in']) $mine = $x['rid'];
    out(['rooms' => $list, 'mine' => $mine, 'max' => RM_MAX, 'ttl' => RM_TTL_MS, 'now' => now_ms()]);
}
function h_room_get(string $id, string $rid): never {
    [$u, $g, $r] = rm_ctx($id, $rid); header('Cache-Control: no-store');
    if (!empty($_GET['hb']) && room_in_rid($rid, $u['id'])) q('UPDATE ml_rmp SET seen = ? WHERE rid = ? AND uid = ?', [now_ms(), $rid, $u['id']]);
    out(['room' => rm_view($g, $r, $u['id'])]);
}
function h_room_create(string $id): never {
    [$u, $g] = rg_ctx($id); $b = body(); rm_sweep($g);
    $name = rm_clean($b['name'] ?? ''); $pw = (string)($b['password'] ?? '');
    if ($name === '') fail(400, 'Oda adı gerekli.');
    if (mb_strlen($pw) < 4 || mb_strlen($pw) > 64) fail(400, 'Şifre 4-64 karakter olmalı.');
    $cur = all('SELECT name FROM ml_rm WHERE gid = ?', [$g['id']]);
    if (count($cur) >= RM_MAX) fail(409, 'Bir grupta en çok ' . RM_MAX . ' oda olabilir.');
    foreach ($cur as $c) if (rm_same($c['name'], $name)) fail(409, 'Bu adda bir oda zaten var.');
    $rid = bin2hex(random_bytes(6)); $t = now_ms();
    q('INSERT INTO ml_rm (rid, gid, name, pw, leader, src, ver, created, exp, ride) VALUES (?, ?, ?, ?, ?, NULL, 1, ?, ?, NULL)', [$rid, $g['id'], $name, password_hash($pw, PASSWORD_DEFAULT), $u['id'], $t, $t + RM_TTL_MS]);
    $r = rm_room($rid); rm_enter($g, $u, $r); rm_ping($g, $rid); out(['room' => rm_view($g, rm_room($rid), $u['id'])]);
}
function h_room_join(string $id, string $rid): never {
    [$u, $g, $r] = rm_ctx($id, $rid); $b = body();
    if (room_in_rid($rid, $u['id'])) out(['room' => rm_view($g, $r, $u['id'])]);
    $k = 'rmf:' . $u['id'] . ':' . $rid; $a = array_values(array_filter(json_decode(kv_get($k) ?? '[]', true) ?: [], fn($t) => now_ms() - $t < RM_FAIL_MS));
    if (count($a) >= RM_FAIL_N) fail(429, 'Çok fazla yanlış deneme. Bir dakika sonra tekrar dene.');
    $x = one('SELECT kind, until FROM ml_rmx WHERE rid = ? AND uid = ?', [$rid, $u['id']]);
    $inv = rm_inv($rid, $u['id']);
    if ($x && $x['kind'] === 'ban' && !$inv) fail(403, 'Oda liderince odadan çıkarıldın; lider yeniden davet etmeden giremezsin.');
    if (!password_verify((string)($b['password'] ?? ''), $r['pw'])) { $a[] = now_ms(); kv_set($k, json_encode($a), RM_FAIL_MS); fail(403, 'Oda şifresi yanlış.'); }
    rm_enter($g, $u, $r); $r = rm_room($rid); rm_push($r); rm_ping($g, $rid);
    out(['room' => rm_view($g, rm_room($rid), $u['id'])]);
}
function h_room_leave(string $id, string $rid): never { [$u, $g, $r] = rm_ctx($id, $rid); rm_drop($g, $r, $u['id'], 'left'); out(['ok' => true]); }
function h_room_close(string $id, string $rid): never { [$u, $g, $r] = rm_lead($id, $rid); rm_close($g, $r, 'leader'); out(['ok' => true]); }
function h_room_kick(string $id, string $rid): never {
    [$u, $g, $r] = rm_lead($id, $rid); $t = rm_target($g, body());
    if ($t === null || !room_in_rid($rid, $t)) fail(404, 'Katılımcı odada değil.');
    if ($t === $u['id']) fail(400, 'Kendini atamazsın; odadan ayrıl.');
    q('REPLACE INTO ml_rmx (rid, uid, kind, until) VALUES (?, ?, ?, 0)', [$rid, $t, 'ban']);
    rm_drop($g, $r, $t, 'kicked'); rt_to_user($t, 'room:changed', ['gid' => $g['id'], 'rid' => $rid, 'ver' => 0, 'kicked' => true]);
    out(['room' => rm_view($g, rm_room($rid), $u['id'])]);
}
function h_room_invite(string $id, string $rid): never {
    [$u, $g, $r] = rm_lead($id, $rid); $t = rm_target($g, body());
    if ($t === null) fail(404, 'Bu grubun üyesi değil.');
    if (room_in_rid($rid, $t)) fail(400, 'Zaten odada.');
    q('REPLACE INTO ml_rmx (rid, uid, kind, until) VALUES (?, ?, ?, ?)', [$rid, $t, 'inv', now_ms() + RM_INVITE_MS]);
    rt_to_user($t, 'room:invite', ['gid' => $g['id'], 'rid' => $rid, 'group' => $g['name'], 'from' => uname($u), 'room' => $r['name']]); rm_push($r); out(['ok' => true]);
}
function h_room_user(string $id, string $rid): never {
    [$u, $g, $r] = rm_lead($id, $rid); $b = body(); $t = rm_target($g, $b);
    if ($t === null || !room_in_rid($rid, $t)) fail(404, 'Katılımcı odada değil.');
    if (array_key_exists('vol', $b)) { if (!is_numeric($b['vol'])) fail(400, 'Geçersiz ses düzeyi.'); q('UPDATE ml_rmp SET vol = ? WHERE rid = ? AND uid = ?', [max(0, min(100, (int)round((float)$b['vol']))), $rid, $t]); }
    if (array_key_exists('muted', $b)) q('UPDATE ml_rmp SET muted = ? WHERE rid = ? AND uid = ?', [$b['muted'] ? 1 : 0, $rid, $t]);
    rm_push($r); out(['room' => rm_view($g, rm_room($rid), $u['id'])]);
}
function h_room_source(string $id, string $rid): never {
    [$u, $g, $r] = rm_lead($id, $rid); $b = body(); $type = (string)($b['type'] ?? ''); $title = rm_clean($b['title'] ?? ''); $title = mb_substr($title === '' ? 'Yayın' : $title, 0, 80);
    if ($type === 'radio') { $url = (string)($b['url'] ?? ''); if (!preg_match('~^https://\S{4,480}$~', $url)) fail(400, 'Radyo bağlantısı https ile başlamalı.'); $src = ['type' => $type, 'url' => $url, 'title' => $title]; }
    elseif ($type === 'yt') { $yid = (string)($b['id'] ?? ''); if (!preg_match('/^[\w-]{11}$/', $yid)) fail(400, 'Geçersiz YouTube bağlantısı.'); $src = ['type' => $type, 'id' => $yid, 'title' => $title]; }
    elseif ($type === 'file') $src = ['type' => $type, 'title' => $title];
    else fail(400, 'Geçersiz yayın türü.');
    $src['by'] = $u['id']; $src['at'] = now_ms();
    q('UPDATE ml_rm SET src = ? WHERE rid = ?', [json_encode($src, JSON_UNESCAPED_UNICODE), $rid]); rm_push($r); out(['room' => rm_view($g, rm_room($rid), $u['id'])]);
}
function h_room_source_del(string $id, string $rid): never {
    [$u, $g, $r] = rm_lead($id, $rid); q('UPDATE ml_rm SET src = NULL WHERE rid = ?', [$rid]); rm_push($r); out(['room' => rm_view($g, rm_room($rid), $u['id'])]);
}
function h_room_ride_start(string $id, string $rid): never {
    [$u, $g, $r] = rm_lead($id, $rid);
    if ($g['ride_id']) fail(409, 'Bu grupta bir sürüş zaten sürüyor.');
    rg_start_ride($g, $u, $rid); rm_push(rm_room($rid) ?? $r); out(['room' => rm_view($g, rm_room($rid), $u['id'])]);
}
function h_room_ride_end(string $id, string $rid): never {
    [$u, $g, $r] = rm_lead($id, $rid); $cur = rg_group($g['id']);
    if (!rm_ride_view($g, $r, $u['id'])) fail(409, 'Bu odada aktif sürüş yok.');
    rg_end_ride($cur, $u, 'oda lideri'); rm_push(rm_room($rid) ?? $r); out(['room' => rm_view($g, rm_room($rid), $u['id'])]);
}
function h_room_ride_number(string $id, string $rid): never {
    [$u, $g, $r] = rm_ctx($id, $rid); $b = body();
    if (!room_in_rid($rid, $u['id'])) fail(404, 'Odada değilsin.');
    if (!rm_ride_view($g, $r, $u['id'])) fail(409, 'Bu odada aktif sürüş yok.');
    $o = rg_set_number(rg_group($g['id']), $u['id'], $b['n'] ?? null);
    if (isset($o['error'])) fail(($o['code'] ?? '') === 'taken' ? 409 : 400, $o['error']);
    rm_push(rm_room($rid) ?? $r); out(['room' => rm_view($g, rm_room($rid), $u['id']), 'n' => $o['n']]);
}
