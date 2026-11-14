<?php
// Grup sürüşü (ridegroups.js karşılığı): kalıcı gruplar (REST), canlı üye konumu (yoklama ile), sürüş kaydı (NDJSON satırları ml_rgrec tablosunda).
// "Zamanlayıcı" işler (uyarı taraması, boşta kapanma) arka plan süreci olmadığı için yoklayan oturumlar tarafından, grup başına ≤2,5 sn'de bir yürütülür.
declare(strict_types=1);

const RG_ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', RG_MAX_MEMBERS = 25, RG_MAX_GROUPS = 8, RG_DEFAULT_GAP = 1000;
const RG_GAPS = [500, 1000, 2000, 3000];
const RG_STALE_MS = 30000, RG_LOST_MS = 60000, RG_MIN_GAP_MS = 1500, RG_TICK_MS = 2500, RG_OFF_ROUTE_M = 300, RG_NEED_TICKS = 2, RG_ALERT_COOLDOWN = 60000;
const RG_IDLE_END_MS = 1200000, RG_REC_MAX = 15728640, RG_MAX_ROUTE_PTS = 5000, RG_MAX_ACC = 200;

function rg_hav(float $lat1, float $lon1, float $lat2, float $lon2): float {
    $rad = M_PI / 180;
    $a = sin(($lat2 - $lat1) * $rad / 2) ** 2 + cos($lat1 * $rad) * cos($lat2 * $rad) * sin(($lon2 - $lon1) * $rad / 2) ** 2;
    return 12742000 * asin(sqrt($a));
}
function rg_txt($s, int $n): string { return mb_substr(trim(preg_replace('/\s+/u', ' ', preg_replace('/[\x00-\x1F\x7F]/u', '', (string)($s ?? '')))), 0, $n); }
function rg_name(string $uid): string { static $c = []; if (!isset($c[$uid])) { $u = user_by_id($uid); $c[$uid] = $u ? uname($u) : 'silinmis'; } return $c[$uid]; }
function rg_full(string $uid): string { $u = user_by_id($uid); return $u ? full_name($u) : 'Silinmiş Kullanıcı'; }
function rg_group(string $gid): ?array { return one('SELECT * FROM ml_rg WHERE id = ?', [$gid]); }
function rg_is_member(string $gid, string $uid): bool { return (bool)val('SELECT 1 FROM ml_rgm WHERE gid = ? AND uid = ?', [$gid, $uid]); }
function rg_members(string $gid): array { return all('SELECT * FROM ml_rgm WHERE gid = ? ORDER BY at, uid', [$gid]); }
function rg_group_count(string $uid): int { return (int)val('SELECT COUNT(*) FROM ml_rgm WHERE uid = ?', [$uid]); }
function rg_notify(array $g, string $kind, array $extra = []): void { foreach (rg_members($g['id']) as $m) rt_to_user($m['uid'], 'grp:changed', ['gid' => $g['id'], 'kind' => $kind] + $extra); }
function rg_role(array $g, string $uid): string {
    if ($g['leader'] === $uid) return 'leader';
    return val('SELECT role FROM ml_rgm WHERE gid = ? AND uid = ?', [$g['id'], $uid]) === 'admin' ? 'admin' : 'member';
}
function rg_is_staff(array $g, string $uid): bool { return rg_role($g, $uid) !== 'member'; }
function rg_pic_url(string $gid, string $k): string { $v = pic_ver($k === 'photo' ? 'gphoto' : 'gcover', $gid); return $v === '' ? '' : "/api/rgroups/$gid/pic/$k?v=$v"; }
function rg_new_code(): string { do { $c = ''; foreach (str_split(random_bytes(8)) as $b) $c .= RG_ALPHA[ord($b) % 32]; } while (val('SELECT 1 FROM ml_rg WHERE code = ?', [$c])); return $c; }
function rg_norm_code($s): string { return substr(preg_replace('/[^A-Z0-9]/', '', strtoupper((string)$s)), 0, 8); }

const RG_MAX_GPOSTS = 300, RG_MAX_DESC = 200;
function rg_desc(string $gid): string { return (string)(val('SELECT descr FROM ml_rgx WHERE gid = ?', [$gid]) ?? ''); }
function rg_set_desc(string $gid, string $d): void { q('DELETE FROM ml_rgx WHERE gid = ?', [$gid]); q('INSERT INTO ml_rgx (gid, descr) VALUES (?, ?)', [$gid, $d]); }
function rg_gpost_drop(array $ids): void {
    foreach (array_chunk($ids, 100) as $ch) {
        $in = implode(',', array_fill(0, count($ch), '?'));
        q("DELETE FROM ml_gpl WHERE post IN ($in)", $ch); q("DELETE FROM ml_gpc WHERE post IN ($in)", $ch);
        q("DELETE FROM ml_images WHERE post IN ($in)", $ch); q("DELETE FROM ml_gp WHERE id IN ($in)", $ch);
    }
}
function rg_gpost_view(array $g, array $rows, string $viewer): array {
    if (!$rows) return [];
    $ids = array_column($rows, 'id'); $in = implode(',', array_fill(0, count($ids), '?'));
    $likes = []; foreach (all("SELECT post, uid FROM ml_gpl WHERE post IN ($in)", $ids) as $l) $likes[$l['post']][] = $l['uid'];
    $cms = []; foreach (all("SELECT * FROM ml_gpc WHERE post IN ($in) ORDER BY at, id", $ids) as $c) $cms[$c['post']][] = $c;
    $uids = array_column($rows, 'uid'); foreach ($cms as $l) foreach ($l as $c) $uids[] = $c['uid'];
    $cards = cards_for($uids);
    return array_map(function ($p) use ($g, $likes, $cms, $cards, $viewer) {
        $lk = $likes[$p['id']] ?? []; $cm = $cms[$p['id']] ?? [];
        return ['id' => $p['id'], 'author' => $cards[$p['uid']] ?? SO_GONE, 'text' => $p['text'], 'at' => (int)$p['at'], 'mood' => $p['mood'],
            'image' => $p['image'] !== '' ? '/api/social/img/' . $p['image'] : '', 'likes' => count($lk), 'liked' => in_array($viewer, $lk, true), 'commentCount' => count($cm),
            'mine' => $p['uid'] === $viewer, 'canDelete' => $p['uid'] === $viewer || rg_is_staff($g, $viewer),
            'comments' => array_map(fn($c) => ['id' => $c['id'], 'author' => $cards[$c['uid']] ?? SO_GONE, 'text' => $c['text'], 'at' => (int)$c['at'], 'canDelete' => $c['uid'] === $viewer || rg_is_staff($g, $viewer)], array_slice($cm, -20))];
    }, $rows);
}
function rg_brief(array $g, array $u): array { return ['id' => $g['id'], 'photo' => rg_pic_url($g['id'], 'photo'), 'name' => $g['name'], 'desc' => rg_desc($g['id']), 'posts' => (int)val('SELECT COUNT(*) FROM ml_gp WHERE gid = ?', [$g['id']]), 'lastAt' => (int)val('SELECT MAX(at) FROM ml_gp WHERE gid = ?', [$g['id']]), 'role' => rg_role($g, $u['id']), 'leader' => rg_name($g['leader']), 'count' => count(rg_members($g['id'])), 'active' => (bool)$g['ride_id'], 'hasRoute' => (int)$g['route_v'] > 0 && $g['route_pts'] !== null]; }
function rg_view(array $g, array $u): array {
    $mem = rg_members($g['id']); $live = array_flip(array_column(all('SELECT uid FROM ml_rglive WHERE gid = ?', [$g['id']]), 'uid'));
    usort($mem, fn($a, $b) => (int)($b['uid'] === $g['leader']) <=> (int)($a['uid'] === $g['leader']));
    $hasRoute = $g['route_pts'] !== null && (int)$g['route_v'] > 0;
    $cards = cards_for(array_column($mem, 'uid'));
    return ['id' => $g['id'], 'photo' => rg_pic_url($g['id'], 'photo'), 'cover' => rg_pic_url($g['id'], 'cover'), 'name' => $g['name'], 'desc' => rg_desc($g['id']), 'role' => rg_role($g, $u['id']), 'leader' => rg_name($g['leader']), 'createdAt' => (int)$g['created_at'], 'gap' => (int)$g['gap'], 'postCount' => (int)val('SELECT COUNT(*) FROM ml_gp WHERE gid = ?', [$g['id']]),
        'members' => array_map(fn($m) => ['username' => rg_name($m['uid']), 'name' => rg_full($m['uid']), 'role' => rg_role($g, $m['uid']), 'sharing' => isset($live[$m['uid']]), 'av' => ($cards[$m['uid']] ?? SO_GONE)['av'], 'bike' => ($cards[$m['uid']] ?? SO_GONE)['bike'], 'joinedAt' => (int)$m['at']], $mem),
        'ride' => $g['ride_id'] ? ['id' => $g['ride_id'], 'startedAt' => (int)$g['ride_started']] : null,
        'route' => $hasRoute ? ['v' => (int)$g['route_v'], 'len' => (int)$g['route_len'], 'n' => (int)$g['route_n'], 'name' => $g['route_name']] : null]
        + (rg_is_staff($g, $u['id']) ? ['code' => $g['code']] : []);
}

// ---------- Güzergâh ----------
function rg_route(array $g): ?array {
    if ($g['route_pts'] === null || (int)$g['route_v'] < 1) return null;
    $pts = json_decode((string)$g['route_pts'], true); if (!is_array($pts) || count($pts) < 2) return null;
    $cum = [0.0]; for ($i = 1, $n = count($pts); $i < $n; $i++) $cum[$i] = $cum[$i - 1] + rg_hav($pts[$i - 1][0], $pts[$i - 1][1], $pts[$i][0], $pts[$i][1]);
    return ['pts' => $pts, 'cum' => $cum];
}
function rg_nearest(array $c, float $lat, float $lon, ?int $hint): ?array {
    $pts = $c['pts']; $cum = $c['cum']; $my = 111320; $mx = 111320 * cos($lat * M_PI / 180);
    $scan = function (int $from, int $to) use ($pts, $cum, $lat, $lon, $my, $mx) {
        $best = null;
        for ($i = $from; $i < $to; $i++) {
            $ax = ($pts[$i][1] - $lon) * $mx; $ay = ($pts[$i][0] - $lat) * $my; $bx = ($pts[$i + 1][1] - $lon) * $mx; $by = ($pts[$i + 1][0] - $lat) * $my;
            $dx = $bx - $ax; $dy = $by - $ay; $l2 = $dx * $dx + $dy * $dy;
            $t = $l2 > 0 ? max(0, min(1, -($ax * $dx + $ay * $dy) / $l2)) : 0;
            $px = $ax + $t * $dx; $py = $ay + $t * $dy; $d = sqrt($px * $px + $py * $py);
            if ($best === null || $d < $best['d']) $best = ['d' => $d, 'along' => $cum[$i] + $t * ($cum[$i + 1] - $cum[$i]), 'i' => $i];
        }
        return $best;
    };
    $n = count($pts) - 1; if ($n < 1) return null;
    if ($hint !== null) { $b = $scan(max(0, $hint - 100), min($n, $hint + 400)); if ($b && $b['d'] <= 150) return $b; }
    return $scan(0, $n);
}

// ---------- Sürüş kaydı ----------
function rg_rec(array $g, array $row): void {
    if (!$g['ride_id']) return;
    $line = json_encode($row, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRESERVE_ZERO_FRACTION) . "\n"; $len = strlen($line);
    $st = q('UPDATE ml_rg SET rec_bytes = rec_bytes + ? WHERE id = ? AND rec_bytes + ? <= ?', [$len, $g['id'], $len, RG_REC_MAX]);
    if ($st->rowCount() === 0) {
        if (q('UPDATE ml_rg SET rec_full = 1 WHERE id = ? AND rec_full = 0', [$g['id']])->rowCount() === 1)
            q('INSERT INTO ml_rgrec (rideid, line) VALUES (?, ?)', [$g['ride_id'], json_encode(['e', now_ms(), 'rec-limit', null, null]) . "\n"]);
        return;
    }
    q('INSERT INTO ml_rgrec (rideid, line) VALUES (?, ?)', [$g['ride_id'], $line]);
}
function rg_ev(string $gid, string $kind, ?string $who, $extra = null): void { $g = rg_group($gid); if ($g) rg_rec($g, ['e', now_ms(), $kind, $who, $extra]); }

// ---------- Canlı durum ----------
function rg_stop_share(string $gid, string $uid, ?string $why = null): bool {
    if (!q('DELETE FROM ml_rglive WHERE gid = ? AND uid = ?', [$gid, $uid])->rowCount()) return false;
    rg_ev($gid, 'share-off', rg_name($uid), $why);
    return true;
}
function rg_compute_state(array $g): array {
    $now = now_ms(); $live = all('SELECT * FROM ml_rglive WHERE gid = ?', [$g['id']]); $rows = []; $le = null;
    foreach ($live as $e) if ($e['uid'] === $g['leader']) $le = $e;
    $lf = (bool)($le && $le['lat'] !== null && $now - (int)$le['at'] <= RG_STALE_MS);
    foreach ($live as $e) {
        $u = rg_name($e['uid']); $lead = $e['uid'] === $g['leader'];
        if ($e['lat'] === null) { $rows[] = ['u' => $u, 'lead' => $lead, 'wait' => true]; continue; }
        $age = $now - (int)$e['at'];
        if ($age > RG_LOST_MS) { $rows[] = ['u' => $u, 'lead' => $lead, 'lost' => true, 'age' => (int)jsround($age / 1000)]; continue; }
        $kmh = $e['spd'] !== null ? (float)$e['spd'] * 3.6 : ($e['est'] !== null ? (float)$e['est'] * 3.6 : null);
        $r = ['u' => $u, 'lead' => $lead, 'lat' => r5((float)$e['lat']), 'lon' => r5((float)$e['lon']), 'spd' => $kmh === null ? null : (int)jsround($kmh),
            'est' => $e['spd'] === null && $e['est'] !== null, 'age' => (int)jsround($age / 1000)];
        if ($age <= RG_STALE_MS && $e['fl']) $r['f'] = $e['fl'];
        if ($lf && !$lead) $r['dl'] = (int)jsround(rg_hav((float)$e['lat'], (float)$e['lon'], (float)$le['lat'], (float)$le['lon']));
        $rows[] = $r;
    }
    usort($rows, fn($a, $b) => ((int)$b['lead'] <=> (int)$a['lead']) ?: strcmp($a['u'], $b['u']));
    $key = ($g['ride_id'] ? 1 : 0) . '|' . (int)$g['route_v'] . '|' . (int)$g['gap'] . '|' . (int)$lf . '|' . implode(';', array_map(fn($r) => implode(',', [$r['u'], $r['lat'] ?? '', $r['lon'] ?? '', $r['spd'] ?? '', $r['f'] ?? '', !empty($r['lost']) ? 1 : 0, $r['lead'] ? 1 : 0, !empty($r['wait']) ? 1 : 0]), $rows));
    return ['rows' => $rows, 'ref' => $lf, 'key' => $key];
}
function rg_payload(array $g, array $s): array { return ['gid' => $g['id'], 'rv' => (int)$g['route_v'], 'ref' => $s['ref'], 'gap' => (int)$g['gap'], 'ride' => (bool)$g['ride_id'], 'members' => $s['rows'], 't' => now_ms()]; }
function grp_push(string $sid, string $gid, ?string $skey): void {
    $g = rg_group($gid); if (!$g) return;
    rg_tick($g);
    $g = rg_group($gid) ?? $g;
    $s = rg_compute_state($g);
    if ($skey !== null && $s['key'] === $skey) return;
    q('UPDATE ml_rtr SET skey = ? WHERE sid = ? AND room = ?', [$s['key'], $sid, 'rg:' . $gid]);
    rt_to_sid($sid, 'grp:state', rg_payload($g, $s));
}
function rg_tick(array $g): void {
    if (!$g['ride_id']) return;
    $now = now_ms();
    if (q('UPDATE ml_rg SET tick_at = ? WHERE id = ? AND tick_at <= ?', [$now, $g['id'], $now - RG_TICK_MS])->rowCount() !== 1) return;
    rg_eval_flags($g, $now);
    if ((int)val('SELECT COUNT(*) FROM ml_rglive WHERE gid = ?', [$g['id']]) > 0) q('UPDATE ml_rg SET ride_idle = ? WHERE id = ?', [$now, $g['id']]);
    elseif ($now - (int)$g['ride_idle'] > RG_IDLE_END_MS) rg_end_ride($g, null, 'otomatik: 20 dk kimse paylaşmadı');
}
function rg_eval_flags(array $g, int $now): void {
    $live = all('SELECT * FROM ml_rglive WHERE gid = ?', [$g['id']]); if (!$live) return;
    $rc = rg_route($g); $le = null;
    foreach ($live as &$e) {                                   // güzergâh üzerindeki konum (yalnız taze konumlar)
        $e['rt'] = null;
        if ($rc && $e['lat'] !== null && $now - (int)$e['at'] <= RG_STALE_MS) {
            $e['rt'] = rg_nearest($rc, (float)$e['lat'], (float)$e['lon'], $e['rt_i'] !== null ? (int)$e['rt_i'] : null);
            if ($e['rt']) q('UPDATE ml_rglive SET rt_d = ?, rt_along = ?, rt_i = ? WHERE gid = ? AND uid = ?', [$e['rt']['d'], $e['rt']['along'], $e['rt']['i'], $g['id'], $e['uid']]);
        }
    }
    unset($e);
    foreach ($live as $x) if ($x['uid'] === $g['leader']) $le = $x;
    $lf = (bool)($le && $le['lat'] !== null && $now - (int)$le['at'] <= RG_STALE_MS);
    foreach ($live as $e) {
        $uid = $e['uid']; $want = null; $meters = 0.0; $fl = $e['fl'] ?: null;
        if ($uid !== $g['leader'] && $e['lat'] !== null && $now - (int)$e['at'] <= RG_STALE_MS) {
            $onRoute = fn($x) => $rc && $x && $x['rt'] && $x['rt']['d'] <= RG_OFF_ROUTE_M;
            $dl = $lf ? rg_hav((float)$e['lat'], (float)$e['lon'], (float)$le['lat'], (float)$le['lon']) : null;
            $sticky = $fl ? 0.8 : 1; $gap = (int)$g['gap'];
            if ($rc && $e['rt'] && $e['rt']['d'] > RG_OFF_ROUTE_M * ($fl === 'off' ? 0.8 : 1)) { $want = 'off'; $meters = $e['rt']['d']; }
            elseif ($lf && $onRoute($e) && $onRoute($le)) {
                $lag = $le['rt']['along'] - $e['rt']['along']; $thr = $gap * $sticky;
                if ($lag > $thr) { $want = 'behind'; $meters = $lag; } elseif (-$lag > $thr) { $want = 'away'; $meters = -$lag; }
            } elseif ($lf && $dl > $gap * $sticky) { $want = 'away'; $meters = $dl; }
        }
        if ($want === $fl) { if ($e['pend_f'] !== null || (int)$e['pend_n']) q('UPDATE ml_rglive SET pend_f = NULL, pend_n = 0 WHERE gid = ? AND uid = ?', [$g['id'], $uid]); continue; }
        $n = ($e['pend_f'] === ($want ?? '') && $e['pend_f'] !== null) ? (int)$e['pend_n'] + 1 : 1;
        if ($n < RG_NEED_TICKS) { q('UPDATE ml_rglive SET pend_f = ?, pend_n = ?, pend_m = ? WHERE gid = ? AND uid = ?', [$want ?? '', $n, $meters, $g['id'], $uid]); continue; }
        q('UPDATE ml_rglive SET fl = ?, pend_f = NULL, pend_n = 0 WHERE gid = ? AND uid = ?', [$want, $g['id'], $uid]);
        if ($want) {
            $k = 'rgal:' . $g['id'] . ':' . $uid . ':' . $want;
            if ($now - (int)(kv_get($k) ?? 0) >= RG_ALERT_COOLDOWN) {
                kv_set($k, (string)$now, RG_ALERT_COOLDOWN);
                rt_to_room('rg:' . $g['id'], 'grp:alert', ['gid' => $g['id'], 'u' => rg_name($uid), 'f' => $want, 'm' => (int)jsround($meters)]);
                rg_rec($g, ['e', $now, 'alert-' . $want, rg_name($uid), (int)jsround($meters)]);
            }
        } else rg_rec($g, ['e', $now, 'alert-clear', rg_name($uid), null]);
    }
}

// ---------- Sürüş başlat / bitir, üyelik ----------
function rg_start_ride(array $g, array $u): void {
    $id = rid(); $t = now_ms(); $rc = rg_route($g);
    q('UPDATE ml_rg SET ride_id = ?, ride_started = ?, ride_by = ?, ride_idle = ?, rec_bytes = 0, rec_full = 0 WHERE id = ?', [$id, $t, $u['id'], $t, $g['id']]);
    $g = rg_group($g['id']);
    $hdr = json_encode(['v' => 1, 'k' => 'h', 'rideId' => $id, 'groupId' => $g['id'], 'groupName' => $g['name'], 'startedAt' => $t, 'leader' => rg_name($g['leader']), 'gap' => (int)$g['gap'],
        'members' => array_map(fn($m) => rg_name($m['uid']), rg_members($g['id'])), 'route' => $rc ? $rc['pts'] : null], JSON_UNESCAPED_UNICODE | JSON_PRESERVE_ZERO_FRACTION) . "\n";
    q('INSERT INTO ml_rgrec (rideid, line) VALUES (?, ?)', [$id, $hdr]);
    q('UPDATE ml_rg SET rec_bytes = ? WHERE id = ?', [strlen($hdr), $g['id']]);
    rg_rec($g, ['e', $t, 'start', uname($u), null]);
    rg_notify($g, 'ride-start');
}
function rg_end_ride(array $g, ?array $by, ?string $why): void {
    if (!$g['ride_id']) return;
    $rid = $g['ride_id']; $t = now_ms();
    foreach (all('SELECT uid FROM ml_rglive WHERE gid = ?', [$g['id']]) as $r) rg_stop_share($g['id'], $r['uid'], 'ride-end');    // önce paylaşımlar kapanır, sonra «end» satırı yazılır
    rg_rec($g, ['e', $t, 'end', $by ? uname($by) : null, $why]);
    $members = array_map(fn($r) => ['username' => $r['uname'], 'fixes' => (int)$r['n'], 'firstAt' => (int)$r['first_at'], 'lastAt' => (int)$r['last_at']], all('SELECT * FROM ml_rgstat WHERE rideid = ?', [$rid]));
    $sum = json_encode(['v' => 1, 'rideId' => $rid, 'groupId' => $g['id'], 'name' => $g['name'], 'startedAt' => (int)$g['ride_started'], 'endedAt' => $t, 'endedBy' => $by ? uname($by) : null,
        'reason' => $why, 'recFull' => (bool)$g['rec_full'], 'route' => (int)$g['route_v'] > 0 ? ['len' => (int)$g['route_len'], 'v' => (int)$g['route_v']] : null, 'members' => $members], JSON_UNESCAPED_UNICODE | JSON_PRESERVE_ZERO_FRACTION);
    q('INSERT INTO ml_rgrides (id, gid, started, ended, sum) VALUES (?, ?, ?, ?, ?)', [$rid, $g['id'], (int)$g['ride_started'], $t, $sum]);
    if (rg_music_get($g['id'])) { q('DELETE FROM ml_kv WHERE k = ?', ['rgmus:' . $g['id']]); rt_to_room('rg:' . $g['id'], 'grp:music', ['gid' => $g['id'], 'music' => null]); }
    q('UPDATE ml_rg SET ride_id = NULL, ride_started = 0, ride_by = NULL, ride_idle = 0 WHERE id = ?', [$g['id']]);
    q('DELETE FROM ml_rgstat WHERE rideid = ?', [$rid]);
    foreach (all('SELECT id FROM ml_rgrides WHERE gid = ? ORDER BY started DESC LIMIT 1000 OFFSET 50', [$g['id']]) as $old) { q('DELETE FROM ml_rgrec WHERE rideid = ?', [$old['id']]); q('DELETE FROM ml_rgrides WHERE id = ?', [$old['id']]); }
    rg_notify($g, 'ride-end');
}
function rg_destroy(array $g, string $kind): void {
    if ($g['ride_id']) { rg_end_ride($g, null, 'grup silindi'); $g = rg_group($g['id']) ?? $g; }
    rg_notify($g, $kind);
    gv_destroy_group($g['id']);
    rt_leave_all('rg:' . $g['id']);
    foreach (all('SELECT id FROM ml_rgrides WHERE gid = ?', [$g['id']]) as $r) q('DELETE FROM ml_rgrec WHERE rideid = ?', [$r['id']]);
    rg_gpost_drop(array_column(all('SELECT id FROM ml_gp WHERE gid = ?', [$g['id']]), 'id'));
    foreach (['ml_rgrides', 'ml_rgm', 'ml_rglive', 'ml_rgx'] as $t) q("DELETE FROM $t WHERE gid = ?", [$g['id']]);
    q("DELETE FROM ml_pics WHERE kind IN ('gphoto','gcover') AND ref = ?", [$g['id']]);
    q('DELETE FROM ml_kv WHERE k IN (?, ?)', ['rgev:' . $g['id'], 'rgmus:' . $g['id']]);
    q('DELETE FROM ml_rg WHERE id = ?', [$g['id']]);
}
function rg_remove_member(array $g, string $uid, string $kind): void {
    rt_to_user($uid, 'grp:changed', ['gid' => $g['id'], 'kind' => 'removed']);
    rg_stop_share($g['id'], $uid, $kind);
    rt_leave_user($uid, 'rg:' . $g['id']);
    gv_kick_user($g['id'], $uid);
    rg_ev($g['id'], $kind, rg_name($uid));
    q('DELETE FROM ml_rgm WHERE gid = ? AND uid = ?', [$g['id'], $uid]);
    rg_gpost_drop(array_column(all('SELECT id FROM ml_gp WHERE gid = ? AND uid = ?', [$g['id'], $uid]), 'id'));
    q('DELETE FROM ml_gpl WHERE uid = ? AND post IN (SELECT id FROM ml_gp WHERE gid = ?)', [$uid, $g['id']]);
    q('DELETE FROM ml_gpc WHERE uid = ? AND post IN (SELECT id FROM ml_gp WHERE gid = ?)', [$uid, $g['id']]);
    $rest = rg_members($g['id']);
    if (!$rest) { rg_destroy($g, 'deleted'); return; }
    if ($g['leader'] === $uid) { $nx = $rest[0]; foreach ($rest as $r0) if (($r0['role'] ?? '') === 'admin') { $nx = $r0; break; } q("UPDATE ml_rgm SET role = '' WHERE gid = ? AND uid = ?", [$g['id'], $nx['uid']]); q('UPDATE ml_rg SET leader = ? WHERE id = ?', [$nx['uid'], $g['id']]); rg_ev($g['id'], 'leader', rg_name($nx['uid']), 'otomatik'); }
    $g = rg_group($g['id']);
    rg_notify($g, $kind);
}
function rg_remove_user(string $uid): void { foreach (all('SELECT gid FROM ml_rgm WHERE uid = ?', [$uid]) as $r) { $g = rg_group($r['gid']); if ($g) rg_remove_member($g, $uid, 'leave'); } }
function rg_disconnect(string $sid, array $u): void { foreach (all('SELECT gid FROM ml_rglive WHERE sid = ?', [$sid]) as $r) rg_stop_share($r['gid'], $u['id'], 'bağlantı koptu'); }

// ---------- Gerçek zamanlı olaylar ----------
function rg_member_group($gid, array $u): ?array { $gid = (string)$gid; if (!preg_match('/^[0-9a-f]{16}$/', $gid) || !rg_is_member($gid, $u['id'])) return null; return rg_group($gid); }
function grp_watch(array $S, array $u, array $p): array {
    $g = rg_member_group($p['gid'] ?? '', $u); if (!$g) return ['error' => 'Grup bulunamadı.'];
    rt_join($S['sid'], 'rg:' . $g['id']);
    rg_tick($g); $g = rg_group($g['id']) ?? $g;
    $s = rg_compute_state($g);
    q('UPDATE ml_rtr SET skey = ? WHERE sid = ? AND room = ?', [$s['key'], $S['sid'], 'rg:' . $g['id']]);
    rt_to_sid($S['sid'], 'grp:state', rg_payload($g, $s));
    rt_to_sid($S['sid'], 'grp:music', ['gid' => $g['id'], 'music' => $g['ride_id'] ? rg_music_view(rg_music_get($g['id'])) : null]);
    return ['ok' => true, 'ride' => (bool)$g['ride_id']];
}
function grp_unwatch(array $S, array $u, array $p): void { $g = rg_member_group($p['gid'] ?? '', $u); if ($g) rt_leave($S['sid'], 'rg:' . $g['id']); }
function grp_share(array $S, array $u, array $p): array {
    $g = rg_member_group($p['gid'] ?? '', $u); if (!$g) return ['error' => 'Grup bulunamadı.'];
    if (($p['on'] ?? null) !== true) { rg_stop_share($g['id'], $u['id'], 'kullanıcı'); return ['ok' => true, 'sharing' => false]; }
    if (($p['consent'] ?? null) !== true) return ['error' => 'Paylaşım için açık onay gerekli.'];
    if (!$g['ride_id']) return ['error' => 'Aktif grup sürüşü yok.'];
    $old = one('SELECT * FROM ml_rglive WHERE gid = ? AND uid = ?', [$g['id'], $u['id']]);
    if ($old && $old['sid'] !== $S['sid'] && val('SELECT 1 FROM ml_rts WHERE sid = ?', [$old['sid']])) rt_to_sid($old['sid'], 'grp:taken', ['gid' => $g['id']]);
    if (!$old) rg_rec($g, ['e', now_ms(), 'share-on', uname($u), null]);
    $same = $old && $old['sid'] === $S['sid'];
    q('REPLACE INTO ml_rglive (gid, uid, sid, lat, lon, acc, spd, est, at, rt_d, rt_along, rt_i, fl, pend_f, pend_n, pend_m) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, 0)',
        [$g['id'], $u['id'], $S['sid'], $same ? $old['lat'] : null, $same ? $old['lon'] : null, $same ? $old['acc'] : null, $same ? $old['spd'] : null, $same ? $old['est'] : null,
         $same ? (int)$old['at'] : 0, $same ? $old['rt_d'] : null, $same ? $old['rt_along'] : null, $same ? $old['rt_i'] : null, $same ? $old['fl'] : null]);
    q('UPDATE ml_rg SET ride_idle = ? WHERE id = ?', [now_ms(), $g['id']]);
    return ['ok' => true, 'sharing' => true];
}
function grp_update(array $S, array $u, array $p): void {
    $g = rg_member_group($p['gid'] ?? '', $u); if (!$g || !$g['ride_id']) return;
    $e = one('SELECT * FROM ml_rglive WHERE gid = ? AND uid = ?', [$g['id'], $u['id']]);
    if (!$e || $e['sid'] !== $S['sid']) return;
    $lat = lv_num($p['lat'] ?? null); $lon = lv_num($p['lon'] ?? null); $acc = array_key_exists('acc', $p) && $p['acc'] !== null ? lv_num($p['acc']) : 0.0;
    if ($lat === null || $lon === null || abs($lat) > 90 || abs($lon) > 180 || $acc === null || $acc > RG_MAX_ACC) return;
    $now = now_ms();
    if ($e['at'] && $now - (int)$e['at'] < RG_MIN_GAP_MS) return;
    $sp = lv_num($p['spd'] ?? null); $spd = $sp !== null && $sp >= 0 && $sp <= 120 ? jsround($sp * 10) / 10 : null;
    $est = null;                                               // cihaz hız vermezse ardışık konumlardan tahmin (arayüzde «~» ile ayrılır)
    if ($spd === null && $e['lat'] !== null && $e['at'] && $acc <= 50) {
        $dt = ($now - (int)$e['at']) / 1000;
        if ($dt >= 2 && $dt <= 30) { $v = rg_hav((float)$e['lat'], (float)$e['lon'], $lat, $lon) / $dt; if ($v < 60) $est = jsround($v * 10) / 10; }
    }
    $accI = (int)jsround($acc);
    q('UPDATE ml_rglive SET lat = ?, lon = ?, acc = ?, spd = ?, est = ?, at = ? WHERE gid = ? AND uid = ?', [$lat, $lon, $accI, $spd, $est, $now, $g['id'], $u['id']]);
    $name = uname($u);
    rg_rec($g, ['f', $now, $name, r5($lat), r5($lon), $accI, $spd, $est]);
    if (q('UPDATE ml_rgstat SET n = n + 1, last_at = ? WHERE rideid = ? AND uname = ?', [$now, $g['ride_id'], $name])->rowCount() === 0)
        q('INSERT INTO ml_rgstat (rideid, uname, n, first_at, last_at) VALUES (?, ?, 1, ?, ?)', [$g['ride_id'], $name, $now, $now]);
}

// ---------- REST ----------
function rg_ctx(string $id, $need = false): array {   // $need: true = yalnız lider, 'staff' = lider ya da yönetici
    $u = need_user(); $g = preg_match('/^[0-9a-f]{16}$/', $id) ? rg_group($id) : null;
    if (!$g || !rg_is_member($g['id'], $u['id'])) fail(404, 'Grup bulunamadı.');
    if ($need === true && $g['leader'] !== $u['id']) fail(403, 'Bu işlem için grup lideri olmalısın.');
    if ($need === 'staff' && !rg_is_staff($g, $u['id'])) fail(403, 'Bu işlem için grup lideri ya da yöneticisi olmalısın.');
    return [$u, $g];
}
// ---------- Etkinlikler (grup içi plan) + liderin müzik paylaşımı ----------
// Etkinlikler ml_kv içinde JSON (anahtar rgev:<grup>); şema değişikliği YOK. Müzik durumu rgmus:<grup> (12 sa).
const RG_MAX_EVENTS = 20, RG_MAX_STOPS = 8;
function rg_pt($p, bool $kind = false): ?array {
    if (!is_array($p)) return null;
    $la = $p['lat'] ?? null; $lo = $p['lon'] ?? null; $name = rg_txt($p['name'] ?? '', 60);
    if (!is_numeric($la) || !is_numeric($lo) || is_string($la) || is_string($lo) || abs((float)$la) > 90 || abs((float)$lo) > 180 || $name === '') return null;
    $o = ['name' => $name, 'lat' => round((float)$la, 5), 'lon' => round((float)$lo, 5)];
    if ($kind) $o['kind'] = 'mola';
    return $o;
}
function rg_clean_event(array $b): array {
    $title = rg_txt($b['title'] ?? '', 60); if (mb_strlen($title) < 2) return ['error' => 'Etkinlik adı en az 2 karakter olmalı.'];
    $at = null;
    if (($b['at'] ?? null) !== null && $b['at'] !== '') { $now = now_ms(); if (!is_numeric($b['at']) || is_string($b['at']) || $b['at'] < $now - 86400000 || $b['at'] > $now + 3 * 365 * 86400000) return ['error' => 'Etkinlik tarihi geçersiz.']; $at = (int)$b['at']; }
    $start = rg_pt($b['start'] ?? null); $dest = rg_pt($b['dest'] ?? null);
    if (!$start) return ['error' => 'Başlangıç yeri seçilmeli.']; if (!$dest) return ['error' => 'Varış noktası seçilmeli.'];
    $raw = is_array($b['stops'] ?? null) ? array_values($b['stops']) : [];
    if (count($raw) > RG_MAX_STOPS) return ['error' => 'En fazla ' . RG_MAX_STOPS . ' mola noktası eklenebilir.'];
    $stops = []; foreach ($raw as $x) { $c = rg_pt($x, true); if (!$c) return ['error' => 'Mola noktalarından birinde ad ya da konum eksik.']; $stops[] = $c; }
    return ['ev' => ['title' => $title, 'at' => $at, 'start' => $start, 'dest' => $dest, 'stops' => $stops, 'note' => rg_txt($b['note'] ?? '', 200)]];
}
function rg_events_load(string $gid): array { $a = json_decode(kv_get('rgev:' . $gid) ?? '[]', true); return is_array($a) ? $a : []; }
function rg_events_save(string $gid, array $a): void { kv_set('rgev:' . $gid, json_encode(array_values($a), JSON_UNESCAPED_UNICODE | JSON_PRESERVE_ZERO_FRACTION)); }
function rg_event_view(array $e): array { return ['id' => $e['id'], 'title' => $e['title'], 'at' => $e['at'], 'start' => $e['start'], 'dest' => $e['dest'], 'stops' => $e['stops'], 'note' => $e['note'] ?? '', 'by' => rg_name($e['by']), 'createdAt' => $e['createdAt']]; }
function rg_event_list(string $gid): array {
    $a = rg_events_load($gid);
    usort($a, fn($x, $y) => (($x['at'] === null) <=> ($y['at'] === null)) ?: (($x['at'] ?? 0) <=> ($y['at'] ?? 0)) ?: ($x['createdAt'] <=> $y['createdAt']));
    return array_map('rg_event_view', $a);
}
function h_rg_events(string $id): never { [$u, $g] = rg_ctx($id); out(['events' => rg_event_list($g['id']), 'canEdit' => rg_is_staff($g, $u['id'])]); }
function h_rg_event_create(string $id): never {
    [$u, $g] = rg_ctx($id, 'staff');
    if (rl('rge:' . $u['id'], 20, 600000)) fail(429, 'Çok sık etkinlik değiştirildi, biraz bekle.');
    $r = rg_clean_event(body()); if (isset($r['error'])) fail(400, $r['error']);
    $a = rg_events_load($g['id']); if (count($a) >= RG_MAX_EVENTS) fail(409, 'En fazla ' . RG_MAX_EVENTS . ' etkinlik olabilir; eskilerini sil.');
    $e = ['id' => rid()] + $r['ev'] + ['by' => $u['id'], 'createdAt' => now_ms()]; $a[] = $e; rg_events_save($g['id'], $a); rg_notify($g, 'events');
    out(['event' => rg_event_view($e), 'events' => rg_event_list($g['id'])]);
}
function h_rg_event_put(string $id, string $eid): never {
    [$u, $g] = rg_ctx($id, 'staff'); $a = rg_events_load($g['id']); $i = null;
    foreach ($a as $k => $x) if ($x['id'] === $eid) $i = $k;
    if ($i === null) fail(404, 'Etkinlik bulunamadı.');
    $r = rg_clean_event(body()); if (isset($r['error'])) fail(400, $r['error']);
    $a[$i] = $r['ev'] + $a[$i]; rg_events_save($g['id'], $a); rg_notify($g, 'events');
    out(['event' => rg_event_view($a[$i]), 'events' => rg_event_list($g['id'])]);
}
function h_rg_event_delete(string $id, string $eid): never {
    [$u, $g] = rg_ctx($id, 'staff'); $a = rg_events_load($g['id']); $n = count($a);
    $a = array_values(array_filter($a, fn($x) => $x['id'] !== $eid)); if (count($a) === $n) fail(404, 'Etkinlik bulunamadı.');
    rg_events_save($g['id'], $a); rg_notify($g, 'events'); out(['ok' => true, 'events' => rg_event_list($g['id'])]);
}
function rg_music_get(string $gid): ?array { $m = json_decode(kv_get('rgmus:' . $gid) ?? 'null', true); return is_array($m) ? $m : null; }
function rg_music_view(?array $m): ?array { return $m ? ['video' => $m['video'], 'list' => $m['list'], 'playing' => (bool)$m['playing'], 'seq' => (int)$m['seq'], 'by' => $m['by']] : null; }
function grp_music(array $S, array $u, array $p): array {
    $g = rg_member_group($p['gid'] ?? '', $u); if (!$g) return ['error' => 'Grup bulunamadı.'];
    if (!$g['ride_id']) return ['error' => 'Aktif grup sürüşü yok.'];
    if ($g['leader'] !== $u['id']) return ['error' => 'Müziği yalnız grup lideri paylaşır.'];
    if (rl('gmus:' . $u['id'], 6, 1000)) return ['error' => 'Çok sık deneme.'];
    $old = rg_music_get($g['id']); $room = 'rg:' . $g['id'];
    if (array_key_exists('src', $p) && $p['src'] === null) { if ($old) { q('DELETE FROM ml_kv WHERE k = ?', ['rgmus:' . $g['id']]); rt_to_room($room, 'grp:music', ['gid' => $g['id'], 'music' => null]); } return ['ok' => true, 'shared' => false]; }
    if (is_array($p['src'] ?? null)) {
        $v = (string)($p['src']['video'] ?? ''); $l = (string)($p['src']['list'] ?? '');
        $video = preg_match('/^[A-Za-z0-9_-]{11}$/', $v) ? $v : null; $list = preg_match('/^[A-Za-z0-9_-]{10,64}$/', $l) ? $l : null;
        if (!$video && !$list) return ['error' => 'Geçersiz YouTube bağlantısı.'];
        $m = ['video' => $video, 'list' => $list, 'playing' => ($p['playing'] ?? true) !== false, 'seq' => (int)($old['seq'] ?? 0) + 1, 'by' => rg_name($u['id'])];
        kv_set('rgmus:' . $g['id'], json_encode($m), 12 * 3600000); rt_to_room($room, 'grp:music', ['gid' => $g['id'], 'music' => rg_music_view($m)]);
        return ['ok' => true, 'shared' => true];
    }
    if (!$old) return ['error' => 'Paylaşılan müzik yok.'];
    $cmd = in_array($p['cmd'] ?? null, ['next', 'prev'], true) ? $p['cmd'] : null;
    if (is_bool($p['playing'] ?? null)) $old['playing'] = $p['playing']; elseif (!$cmd) return ['error' => 'Geçersiz komut.'];
    $old['seq'] = (int)$old['seq'] + 1; kv_set('rgmus:' . $g['id'], json_encode($old), 12 * 3600000);
    $pl = ['gid' => $g['id'], 'music' => rg_music_view($old)]; if ($cmd) $pl['cmd'] = $cmd;
    rt_to_room($room, 'grp:music', $pl);
    return ['ok' => true, 'shared' => true];
}
function rg_member_by_name(array $g, $n): ?array { foreach (rg_members($g['id']) as $m) if (lower(rg_name($m['uid'])) === lower((string)$n)) return $m; return null; }
function h_rg_list(): never {
    $u = need_user();
    $gs = all('SELECT g.* FROM ml_rg g JOIN ml_rgm m ON m.gid = g.id WHERE m.uid = ? ORDER BY g.created_at', [$u['id']]);
    out(['groups' => array_map(fn($g) => rg_brief($g, $u), $gs)]);
}
function h_rg_create(): never {
    $u = need_user(); $name = rg_txt(body()['name'] ?? '', 40);
    if (mb_strlen($name) < 2) fail(400, 'Grup adı en az 2 karakter olmalı.');
    if (rl('rgc:' . $u['id'], 10, 3600000)) fail(429, 'Çok fazla grup oluşturdun, biraz bekle.');
    if (rg_group_count($u['id']) >= RG_MAX_GROUPS) fail(400, 'En fazla ' . RG_MAX_GROUPS . ' grupta olabilirsin.');
    $id = rid(); $t = now_ms();
    q('INSERT INTO ml_rg (id, name, code, leader, created_at, gap) VALUES (?, ?, ?, ?, ?, ?)', [$id, $name, rg_new_code(), $u['id'], $t, RG_DEFAULT_GAP]);
    q('INSERT INTO ml_rgm (gid, uid, at) VALUES (?, ?, ?)', [$id, $u['id'], $t]);
    rg_set_desc($id, rg_txt(body()['desc'] ?? '', RG_MAX_DESC));
    out(['group' => rg_view(rg_group($id), $u)]);
}
function rg_code_guard(array $u): array {
    if (rl('rgj:' . $u['id'], 10, 600000) || rl('rgi:' . client_ip(), 40, 600000)) fail(429, 'Çok fazla deneme. Biraz bekle.');
    $code = rg_norm_code(body()['code'] ?? ($_GET['code'] ?? ''));
    $g = $code !== '' ? one('SELECT * FROM ml_rg WHERE code = ?', [$code]) : null;
    if (!$g) fail(404, 'Davet kodu geçersiz.');
    return $g;
}
function h_rg_join(): never {
    $u = need_user(); $g = rg_code_guard($u);
    if (rg_is_member($g['id'], $u['id'])) out(['group' => rg_view($g, $u), 'already' => true]);
    if (count(rg_members($g['id'])) >= RG_MAX_MEMBERS) fail(409, 'Grup dolu (en fazla ' . RG_MAX_MEMBERS . ' üye).');
    if (rg_group_count($u['id']) >= RG_MAX_GROUPS) fail(400, 'En fazla ' . RG_MAX_GROUPS . ' grupta olabilirsin.');
    q(ins_ignore() . ' INTO ml_rgm (gid, uid, at) VALUES (?, ?, ?)', [$g['id'], $u['id'], now_ms()]);
    rg_rec($g, ['e', now_ms(), 'join', uname($u), null]);
    rg_notify($g, 'join', ['u' => uname($u)]);
    out(['group' => rg_view($g, $u)]);
}
function h_rg_preview(): never {
    $u = need_user(); $g = rg_code_guard($u); $mem = rg_is_member($g['id'], $u['id']); $c = count(rg_members($g['id']));
    out(['name' => $g['name'], 'leader' => rg_name($g['leader']), 'count' => $c, 'full' => $c >= RG_MAX_MEMBERS, 'member' => $mem] + ($mem ? ['id' => $g['id']] : []));
}
function h_rg_get(string $id): never { [$u, $g] = rg_ctx($id); out(['group' => rg_view($g, $u)]); }
function h_rg_patch(string $id): never {
    [$u, $g] = rg_ctx($id, 'staff'); $b = body();
    if (array_key_exists('name', $b)) { $n = rg_txt($b['name'], 40); if (mb_strlen($n) < 2) fail(400, 'Grup adı en az 2 karakter olmalı.'); q('UPDATE ml_rg SET name = ? WHERE id = ?', [$n, $id]); }
    if (array_key_exists('desc', $b)) rg_set_desc($id, rg_txt($b['desc'], RG_MAX_DESC));
    if (array_key_exists('gap', $b)) { if (!in_array((int)$b['gap'], RG_GAPS, true) || !is_numeric($b['gap'])) fail(400, 'Geçersiz mesafe.'); q('UPDATE ml_rg SET gap = ? WHERE id = ?', [(int)$b['gap'], $id]); }
    $g = rg_group($id); rg_notify($g, 'settings');
    out(['group' => rg_view($g, $u)]);
}
function h_rg_delete(string $id): never { [$u, $g] = rg_ctx($id, true); rg_destroy($g, 'deleted'); out(['ok' => true]); }
function h_rg_leave(string $id): never { [$u, $g] = rg_ctx($id); rg_remove_member($g, $u['id'], 'leave'); out(['ok' => true]); }
function h_rg_kick(string $id): never {
    [$u, $g] = rg_ctx($id, 'staff'); $m = rg_member_by_name($g, body()['username'] ?? '');
    if (!$m) fail(404, 'Üye bulunamadı.');
    if ($m['uid'] === $u['id']) fail(400, 'Kendini çıkaramazsın; gruptan ayrıl.');
    if ($m['uid'] === $g['leader'] || (rg_role($g, $m['uid']) === 'admin' && $g['leader'] !== $u['id'])) fail(403, 'Bu üyeyi çıkarma yetkin yok.');
    rg_remove_member($g, $m['uid'], 'kick'); out(['ok' => true]);
}
function h_rg_leader(string $id): never {
    [$u, $g] = rg_ctx($id, true); $m = rg_member_by_name($g, body()['username'] ?? '');
    if (!$m) fail(404, 'Üye bulunamadı.');
    if ($m['uid'] === $g['leader']) out(['group' => rg_view($g, $u)]);
    q("UPDATE ml_rgm SET role = '' WHERE gid = ? AND uid = ?", [$id, $m['uid']]);
    q('UPDATE ml_rg SET leader = ? WHERE id = ?', [$m['uid'], $id]);
    rg_rec($g, ['e', now_ms(), 'leader', rg_name($m['uid']), uname($u)]);
    $g = rg_group($id); rg_notify($g, 'leader');
    out(['group' => rg_view($g, $u)]);
}
function h_rg_role(string $id): never {            // yalnız lider: Yönetici ata / geri al
    [$u, $g] = rg_ctx($id, true); $b = body(); $m = rg_member_by_name($g, $b['username'] ?? '');
    if (!$m) fail(404, 'Üye bulunamadı.');
    if ($m['uid'] === $g['leader']) fail(400, 'Liderin rolü değiştirilemez; önce lideri devret.');
    $r = $b['role'] ?? ''; if ($r !== 'admin' && $r !== 'member') fail(400, 'Geçersiz rol.');
    q('UPDATE ml_rgm SET role = ? WHERE gid = ? AND uid = ?', [$r === 'admin' ? 'admin' : '', $id, $m['uid']]);
    rg_ev($id, 'role', rg_name($m['uid']), $r); rg_notify($g, 'role');
    out(['group' => rg_view(rg_group($id), $u)]);
}
function h_rg_pic_put(string $id, string $kind): never {      // grup fotoğrafı (photo) / grup içi kapak (cover): lider ya da yönetici
    [$u, $g] = rg_ctx($id, 'staff');
    if ($kind !== 'photo' && $kind !== 'cover') fail(404, 'Bilinmeyen görsel türü.');
    pic_put($kind === 'photo' ? 'gphoto' : 'gcover', $id, raw_body(200000));
    rg_notify($g, 'settings'); out(['group' => rg_view(rg_group($id), $u)]);
}
function h_rg_pic_get(string $id, string $kind): never {
    rg_ctx($id); if ($kind !== 'photo' && $kind !== 'cover') { http_response_code(404); exit; }
    pic_send($kind === 'photo' ? 'gphoto' : 'gcover', $id);
}
function h_rg_code(string $id): never {
    [$u, $g] = rg_ctx($id, 'staff'); $c = rg_new_code();
    q('UPDATE ml_rg SET code = ? WHERE id = ?', [$c, $id]);       // eski kod/bağlantı geçersiz olur
    out(['code' => $c]);
}
function h_rg_start(string $id): never {
    [$u, $g] = rg_ctx($id, 'staff');
    if ($g['ride_id']) fail(409, 'Grup sürüşü zaten başlamış.');
    rg_start_ride($g, $u); out(['group' => rg_view(rg_group($id), $u)]);
}
function h_rg_end(string $id): never {
    [$u, $g] = rg_ctx($id, 'staff');
    if (!$g['ride_id']) fail(409, 'Aktif grup sürüşü yok.');
    rg_end_ride($g, $u, null); out(['group' => rg_view(rg_group($id), $u)]);
}
function h_rg_route_put(string $id): never {
    [$u, $g] = rg_ctx($id, 'staff');
    if (rl('rgr:' . $u['id'], 6, 600000)) fail(429, 'Güzergâh çok sık değiştirildi, biraz bekle.');
    $b = json_decode(raw_body(409600), true);
    if (!is_array($b)) fail(400, 'Güzergâh okunamadı.');
    $raw = $b['pts'] ?? null;
    if (!is_array($raw) || count($raw) < 2 || count($raw) > RG_MAX_ROUTE_PTS) fail(400, 'Güzergâh 2–' . RG_MAX_ROUTE_PTS . ' nokta olmalı.');
    $pts = [];
    foreach ($raw as $p) {
        $la = is_array($p) ? lv_num($p[0] ?? null) : null; $lo = is_array($p) ? lv_num($p[1] ?? null) : null;
        if ($la === null || $lo === null || abs($la) > 90 || abs($lo) > 180) fail(400, 'Güzergâhta geçersiz nokta var.');
        $qq = [r5($la), r5($lo)]; $last = end($pts);
        if (!$last || $last[0] !== $qq[0] || $last[1] !== $qq[1]) $pts[] = $qq;
    }
    if (count($pts) < 2) fail(400, 'Güzergâh en az 2 farklı nokta olmalı.');
    $len = 0.0; for ($i = 1, $n = count($pts); $i < $n; $i++) $len += rg_hav($pts[$i - 1][0], $pts[$i - 1][1], $pts[$i][0], $pts[$i][1]);   // uzunluk istemciye güvenilmeden hesaplanır
    q('UPDATE ml_rg SET route_pts = ?, route_v = route_v + 1, route_len = ?, route_n = ?, route_name = ? WHERE id = ?',
        [json_encode($pts, JSON_PRESERVE_ZERO_FRACTION), (int)jsround($len), count($pts), txt($b['name'] ?? '', 60), $id]);
    $g = rg_group($id);
    if ($g['ride_id']) rg_rec($g, ['r', now_ms(), $pts]);
    rg_notify($g, 'route');
    out(['route' => ['v' => (int)$g['route_v'], 'len' => (int)$g['route_len'], 'n' => (int)$g['route_n'], 'name' => $g['route_name'], 'at' => now_ms()]]);
}
function h_rg_route_get(string $id): never {
    [$u, $g] = rg_ctx($id); $rc = rg_route($g);
    if (!$rc) fail(404, 'Grubun güzergâhı yok.');
    out(['v' => (int)$g['route_v'], 'name' => $g['route_name'], 'len' => (int)$g['route_len'], 'pts' => $rc['pts']]);
}
function h_rg_route_delete(string $id): never {
    [$u, $g] = rg_ctx($id, 'staff');
    if ($g['route_pts'] !== null) {
        q('UPDATE ml_rg SET route_pts = NULL, route_len = 0, route_n = 0, route_name = \'\', route_v = route_v + 1 WHERE id = ?', [$id]);
        $g = rg_group($id); if ($g['ride_id']) rg_rec($g, ['r', now_ms(), null]);
        rg_notify($g, 'route');
    }
    out(['ok' => true]);
}
function h_rg_rides(string $id): never {
    [$u, $g] = rg_ctx($id);
    $list = array_map(function ($r) {
        $sum = $r['sum'] ? json_decode($r['sum'], true) : null;
        return ['id' => $r['id'], 'startedAt' => (int)$r['started'], 'endedAt' => (int)$r['ended'], 'members' => $sum['members'] ?? [], 'endedBy' => $sum['endedBy'] ?? null];
    }, all('SELECT * FROM ml_rgrides WHERE gid = ? ORDER BY started DESC LIMIT 50', [$id]));
    if ($g['ride_id']) array_unshift($list, ['id' => $g['ride_id'], 'startedAt' => (int)$g['ride_started'], 'endedAt' => null, 'members' => []]);
    out(['rides' => $list]);
}
function h_rg_ride_get(string $id, string $rideId): never {
    [$u, $g] = rg_ctx($id);
    if (!preg_match('/^[0-9a-f]{16}$/', $rideId) || !(($g['ride_id'] === $rideId) || val('SELECT 1 FROM ml_rgrides WHERE id = ? AND gid = ?', [$rideId, $id]))) fail(404, 'Sürüş bulunamadı.');
    $first = all('SELECT id, line FROM ml_rgrec WHERE rideid = ? ORDER BY id LIMIT 500', [$rideId]);
    if (!$first) fail(404, 'Kayıt dosyası yok.');
    header('Content-Type: application/x-ndjson; charset=utf-8'); header('Cache-Control: no-store');
    $rows = $first;
    while ($rows) { $last = 0; foreach ($rows as $r) { echo $r['line']; $last = (int)$r['id']; } if (count($rows) < 500) break; $rows = all('SELECT id, line FROM ml_rgrec WHERE rideid = ? AND id > ? ORDER BY id LIMIT 500', [$rideId, $last]); }
    exit;
}

// ---------- Grup içi gönderi / beğeni / yorum (yalnız üyeler) ----------
function rg_find_gpost(array $g, string $pid): array {
    $p = preg_match('/^[0-9a-f]{16}$/', $pid) ? one('SELECT * FROM ml_gp WHERE id = ? AND gid = ?', [$pid, $g['id']]) : null;
    if (!$p) fail(404, 'Gönderi bulunamadı.');
    return $p;
}
function h_rg_posts(string $id): never {
    [$u, $g] = rg_ctx($id); $before = (int)($_GET['before'] ?? 0); $size = 20;
    $rows = $before > 0 ? all('SELECT * FROM ml_gp WHERE gid = ? AND at < ? ORDER BY at DESC LIMIT ' . ($size + 1), [$g['id'], $before]) : all('SELECT * FROM ml_gp WHERE gid = ? ORDER BY at DESC LIMIT ' . ($size + 1), [$g['id']]);
    out(['posts' => rg_gpost_view($g, array_slice($rows, 0, $size), $u['id']), 'more' => count($rows) > $size]);
}
function h_rg_post_create(string $id): never {
    [$u, $g] = rg_ctx($id); $b = body(); $t = txt($b['text'] ?? '', 500); $img = (string)($b['image'] ?? '');
    if ($t === '' && $img === '') fail(400, 'Gönderi boş olamaz.');
    if (rl('rgp:' . $u['id'], 8, 60000)) fail(429, 'Çok sık paylaşım yapıyorsun, biraz bekle.');
    $rec = $img !== '' ? one('SELECT uid, post FROM ml_images WHERE id = ?', [$img]) : null;
    if ($img !== '' && (!$rec || $rec['uid'] !== $u['id'] || $rec['post'])) fail(400, 'Fotoğraf bulunamadı, tekrar yükle.');
    $p = ['id' => rid(), 'gid' => $g['id'], 'uid' => $u['id'], 'text' => $t, 'at' => now_ms(), 'mood' => so_mood($b['mood'] ?? ''), 'image' => $img];
    q('INSERT INTO ml_gp (id, gid, uid, text, at, mood, image) VALUES (?, ?, ?, ?, ?, ?, ?)', array_values($p));
    if ($rec) q('UPDATE ml_images SET post = ? WHERE id = ?', [$p['id'], $img]);
    $cut = val('SELECT at FROM ml_gp WHERE gid = ? ORDER BY at DESC LIMIT 1 OFFSET ' . RG_MAX_GPOSTS, [$g['id']]);
    if ($cut !== null) rg_gpost_drop(array_column(all('SELECT id FROM ml_gp WHERE gid = ? AND at <= ?', [$g['id'], $cut]), 'id'));
    rg_notify($g, 'post', ['u' => uname($u)]);
    out(['post' => rg_gpost_view($g, [$p], $u['id'])[0]]);
}
function h_rg_post_delete(string $id, string $pid): never {
    [$u, $g] = rg_ctx($id); $p = rg_find_gpost($g, $pid);
    if ($p['uid'] !== $u['id'] && $g['leader'] !== $u['id']) fail(403, 'Bu gönderiyi silemezsin.');
    rg_gpost_drop([$p['id']]); out(['ok' => true]);
}
function h_rg_post_like(string $id, string $pid): never {
    [$u, $g] = rg_ctx($id); $p = rg_find_gpost($g, $pid);
    if (val('SELECT 1 FROM ml_gpl WHERE post = ? AND uid = ?', [$p['id'], $u['id']])) { q('DELETE FROM ml_gpl WHERE post = ? AND uid = ?', [$p['id'], $u['id']]); $liked = false; }
    else { q(ins_ignore() . ' INTO ml_gpl (post, uid) VALUES (?, ?)', [$p['id'], $u['id']]); $liked = true; }
    out(['liked' => $liked, 'likes' => (int)val('SELECT COUNT(*) FROM ml_gpl WHERE post = ?', [$p['id']])]);
}
function h_rg_post_comment(string $id, string $pid): never {
    [$u, $g] = rg_ctx($id); $p = rg_find_gpost($g, $pid); $t = txt(body()['text'] ?? '', 300);
    if ($t === '') fail(400, 'Yorum boş olamaz.');
    if (rl('rgm:' . $u['id'], 20, 60000)) fail(429, 'Çok sık yorum yapıyorsun, biraz bekle.');
    $c = ['id' => rid(), 'post' => $p['id'], 'uid' => $u['id'], 'text' => $t, 'at' => now_ms()];
    q('INSERT INTO ml_gpc (id, post, uid, text, at) VALUES (?, ?, ?, ?, ?)', array_values($c));
    out(['comment' => ['id' => $c['id'], 'author' => card($u), 'text' => $t, 'at' => $c['at'], 'canDelete' => true], 'commentCount' => (int)val('SELECT COUNT(*) FROM ml_gpc WHERE post = ?', [$p['id']])]);
}
function h_rg_comment_delete(string $id, string $pid, string $cid): never {
    [$u, $g] = rg_ctx($id); $p = rg_find_gpost($g, $pid);
    $c = preg_match('/^[0-9a-f]{16}$/', $cid) ? one('SELECT * FROM ml_gpc WHERE id = ? AND post = ?', [$cid, $p['id']]) : null;
    if (!$c) fail(404, 'Yorum bulunamadı.');
    if ($c['uid'] !== $u['id'] && $g['leader'] !== $u['id']) fail(403, 'Bu yorumu silemezsin.');
    q('DELETE FROM ml_gpc WHERE id = ?', [$cid]); out(['ok' => true]);
}
