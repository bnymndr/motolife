<?php
// Sosyal modül: profil, gönderi akışı, arkadaşlık, mesajlaşma (social.js karşılığı).
declare(strict_types=1);

const SO_MAX_POSTS = 3000, SO_MAX_MSGS = 500, SO_MAX_IMG = 716800;
const SO_MOODS = ['mutlu', 'heyecanli', 'havali', 'huzurlu', 'asik', 'ozgur', 'enerjik', 'eglenceli', 'minnettar', 'yorgun', 'uzgun', 'kizgin'];
const SO_GONE = ['username' => 'silinmis', 'name' => 'Silinmiş Kullanıcı', 'av' => '', 'bike' => ''];

function so_mood($v): string { return in_array($v, SO_MOODS, true) ? $v : ''; }
function pair_key(string $a, string $b): string { return $a < $b ? $a . '_' . $b : $b . '_' . $a; }
function is_friend(string $a, string $b): bool { return (bool)val('SELECT 1 FROM ml_friends WHERE a = ? AND b = ?', [$a, $b]); }
function social_friend_ids(string $uid): array { return array_column(all('SELECT b FROM ml_friends WHERE a = ?', [$uid]), 'b'); }
function to_friends(string $uid, string $ev, $payload): void { foreach (social_friend_ids($uid) as $f) rt_to_user($f, $ev, $payload); }
function card(?array $u): array {
    if (!$u) return SO_GONE;
    $av = empty($u['avatar']) ? '' : base_convert((string)crc32($u['avatar']), 10, 36);
    return ['username' => uname($u), 'name' => full_name($u), 'av' => $av, 'bike' => trim(implode(' ', array_filter([$u['bike_brand'], $u['bike_model']])))];
}
function cards_for(array $uids): array {
    $uids = array_values(array_unique($uids)); $m = [];
    foreach (array_chunk($uids, 200) as $ch) foreach (all('SELECT * FROM ml_users WHERE id IN (' . implode(',', array_fill(0, count($ch), '?')) . ')', $ch) as $r) $m[$r['id']] = card($r);
    return $m;
}
function so_stats(string $uid): array {
    return ['posts' => (int)val('SELECT COUNT(*) FROM ml_posts WHERE uid = ?', [$uid]), 'friends' => (int)val('SELECT COUNT(*) FROM ml_friends WHERE a = ?', [$uid]),
        'likes' => (int)val('SELECT COUNT(*) FROM ml_likes WHERE post IN (SELECT id FROM ml_posts WHERE uid = ?)', [$uid])];
}
function so_profile(array $u): array {
    return card($u) + ['bio' => $u['bio'], 'status' => $u['status'], 'mood' => $u['mood'], 'statusAt' => (int)$u['status_at'], 'since' => (int)$u['created_at'], 'stats' => so_stats($u['id'])];
}
function relation(string $meId, array $o): array {
    if (is_friend($meId, $o['id'])) return ['rel' => 'friend'];
    if ($r = one('SELECT id FROM ml_requests WHERE from_uid = ? AND to_uid = ?', [$meId, $o['id']])) return ['rel' => 'outgoing', 'requestId' => $r['id']];
    if ($r = one('SELECT id FROM ml_requests WHERE from_uid = ? AND to_uid = ?', [$o['id'], $meId])) return ['rel' => 'incoming', 'requestId' => $r['id']];
    return ['rel' => 'none'];
}
function make_friends(string $a, string $b): void {
    q(ins_ignore() . ' INTO ml_friends (a, b) VALUES (?, ?)', [$a, $b]); q(ins_ignore() . ' INTO ml_friends (a, b) VALUES (?, ?)', [$b, $a]);
    q('DELETE FROM ml_requests WHERE (from_uid = ? AND to_uid = ?) OR (from_uid = ? AND to_uid = ?)', [$a, $b, $b, $a]);
}
function visible_to(string $viewer, string $author): bool { return $viewer === $author || is_friend($viewer, $author); }

function posts_view(array $rows, string $viewer): array {
    if (!$rows) return [];
    $ids = array_column($rows, 'id'); $ph = implode(',', array_fill(0, count($ids), '?'));
    $likes = []; foreach (all("SELECT post, COUNT(*) c FROM ml_likes WHERE post IN ($ph) GROUP BY post", $ids) as $r) $likes[$r['post']] = (int)$r['c'];
    $liked = array_flip(array_column(all("SELECT post FROM ml_likes WHERE uid = ? AND post IN ($ph)", [$viewer, ...$ids]), 'post'));
    $cc = []; foreach (all("SELECT post, COUNT(*) c FROM ml_comments WHERE post IN ($ph) GROUP BY post", $ids) as $r) $cc[$r['post']] = (int)$r['c'];
    $com = [];
    foreach ($ids as $pid) { $l = all('SELECT * FROM (SELECT * FROM ml_comments WHERE post = ? ORDER BY at DESC, id DESC LIMIT 20) t ORDER BY at, id', [$pid]); $com[$pid] = $l; }
    $uids = array_column($rows, 'uid'); foreach ($com as $l) foreach ($l as $c) $uids[] = $c['uid'];
    $cards = cards_for($uids);
    return array_map(fn($p) => [
        'id' => $p['id'], 'author' => $cards[$p['uid']] ?? SO_GONE, 'text' => $p['text'], 'at' => (int)$p['at'], 'mood' => $p['mood'],
        'image' => $p['image'] !== '' ? '/api/social/img/' . $p['image'] : '', 'likes' => $likes[$p['id']] ?? 0, 'liked' => isset($liked[$p['id']]),
        'commentCount' => $cc[$p['id']] ?? 0, 'mine' => $p['uid'] === $viewer,
        'comments' => array_map(fn($c) => ['id' => $c['id'], 'author' => $cards[$c['uid']] ?? SO_GONE, 'text' => $c['text'], 'at' => (int)$c['at']], $com[$p['id']]),
    ], $rows);
}
function posts_page(string $where, array $params, string $viewer): array {
    $before = isset($_GET['before']) && (float)$_GET['before'] > 0 ? (int)$_GET['before'] : PHP_INT_MAX;
    $rows = all("SELECT * FROM ml_posts WHERE $where AND at < ? ORDER BY at DESC LIMIT 21", [...$params, $before]);
    return ['posts' => posts_view(array_slice($rows, 0, 20), $viewer), 'more' => count($rows) > 20];
}
function post_children_delete(array $ids): void {
    foreach (array_chunk($ids, 200) as $ch) {
        $ph = implode(',', array_fill(0, count($ch), '?'));
        q("DELETE FROM ml_likes WHERE post IN ($ph)", $ch); q("DELETE FROM ml_comments WHERE post IN ($ph)", $ch); q("DELETE FROM ml_images WHERE post IN ($ph)", $ch);
    }
}

// ---------- Profil ----------
function h_so_me(): never { $u = need_user(); out(['me' => so_profile($u)]); }
function h_so_profile_put(): never {
    $u = need_user(); $b = body();
    $bio = array_key_exists('bio', $b) ? txt($b['bio'], 160) : $u['bio'];
    $mood = array_key_exists('mood', $b) ? so_mood($b['mood']) : $u['mood'];
    $status = array_key_exists('status', $b) ? txt($b['status'], 80) : $u['status'];
    $at = (int)$u['status_at'];
    if ($status . '|' . $mood !== $u['status'] . '|' . $u['mood']) $at = ($status !== '' || $mood !== '') ? now_ms() : 0;
    q('UPDATE ml_users SET bio = ?, mood = ?, status = ?, status_at = ? WHERE id = ?', [$bio, $mood, $status, $at, $u['id']]);
    to_friends($u['id'], 'social:status', ['username' => uname($u), 'status' => $status, 'mood' => $mood, 'statusAt' => $at]);
    out(['me' => so_profile(user_by_id($u['id']))]);
}
function h_so_avatar(string $name): never {
    need_user(); $o = user_by_name($name);
    if (!$o || !preg_match('#^data:(image/(?:jpeg|png|webp));base64,(.+)$#', (string)($o['avatar'] ?? ''), $m)) { http_response_code(404); exit; }
    header('Content-Type: ' . $m[1]); header('Cache-Control: private, max-age=86400'); echo base64_decode($m[2]); exit;
}
function h_so_user(string $name): never {
    $u = need_user(); $o = user_by_name($name);
    if (!$o) fail(404, 'Kullanıcı bulunamadı.');
    out(['profile' => so_profile($o)] + ($o['id'] === $u['id'] ? ['rel' => 'self'] : relation($u['id'], $o)) + ['locked' => !visible_to($u['id'], $o['id'])]);
}
function h_so_user_posts(string $name): never {
    $u = need_user(); $o = user_by_name($name);
    if (!$o) fail(404, 'Kullanıcı bulunamadı.');
    if (!visible_to($u['id'], $o['id'])) out(['posts' => [], 'more' => false, 'locked' => true]);
    out(posts_page('uid = ?', [$o['id']], $u['id']));
}

// ---------- Fotoğraf ----------
function h_so_upload(): never {
    $u = need_user();
    if (strncasecmp($_SERVER['CONTENT_TYPE'] ?? '', 'image/jpeg', 10) !== 0) fail(400, 'Geçerli bir JPEG fotoğraf gönder.');
    $raw = file_get_contents('php://input');
    if (strlen($raw) > SO_MAX_IMG) fail(400, 'Fotoğraf çok büyük.');
    if (strlen($raw) < 1000 || $raw[0] !== "\xFF" || $raw[1] !== "\xD8" || $raw[2] !== "\xFF") fail(400, 'Geçerli bir JPEG fotoğraf gönder.');
    if (rl('up:' . $u['id'], 10, 60000)) fail(429, 'Çok sık fotoğraf yüklüyorsun, biraz bekle.');
    $id = rid();
    $st = db()->prepare('INSERT INTO ml_images (id, uid, at, post, data) VALUES (?, ?, ?, NULL, ?)');
    $st->bindValue(1, $id); $st->bindValue(2, $u['id']); $st->bindValue(3, now_ms(), PDO::PARAM_INT); $st->bindValue(4, $raw, PDO::PARAM_LOB); $st->execute();
    if (random_int(1, 20) === 1) q('DELETE FROM ml_images WHERE post IS NULL AND at < ?', [now_ms() - 3600000]);   // 1 saatten eski, gönderiye eklenmemiş yüklemeler
    out(['image' => $id]);
}
function h_so_img(string $id): never {
    $u = need_user();
    $rec = preg_match('/^[0-9a-f]{16}$/', $id) ? one('SELECT id, uid, post FROM ml_images WHERE id = ?', [$id]) : null;
    $post = $rec && $rec['post'] ? one('SELECT uid FROM ml_posts WHERE id = ?', [$rec['post']]) : null;
    $gp = $rec && $rec['post'] && !$post ? one('SELECT gid FROM ml_gp WHERE id = ?', [$rec['post']]) : null;   // grup gönderisi fotoğrafı: yalnız grup üyeleri
    if (!$rec || !($rec['uid'] === $u['id'] || ($post && visible_to($u['id'], $post['uid'])) || ($gp && rg_is_member($gp['gid'], $u['id'])))) { http_response_code(404); exit; }
    $d = lob(val('SELECT data FROM ml_images WHERE id = ?', [$id]));
    header('Content-Type: image/jpeg'); header('Cache-Control: private, max-age=604800, immutable'); echo $d; exit;
}

// ---------- Akış ----------
function h_so_feed(): never {
    $u = need_user(); $ids = [$u['id'], ...social_friend_ids($u['id'])];
    out(posts_page('uid IN (' . implode(',', array_fill(0, count($ids), '?')) . ')', $ids, $u['id']));
}
function h_so_post_create(): never {
    $u = need_user(); $b = body(); $t = txt($b['text'] ?? '', 500); $img = (string)($b['image'] ?? '');
    $rec = $img !== '' ? one('SELECT uid, post FROM ml_images WHERE id = ?', [$img]) : null;
    if ($img !== '' && (!$rec || $rec['uid'] !== $u['id'] || $rec['post'])) fail(400, 'Fotoğraf bulunamadı, tekrar yükle.');
    if ($t === '' && $img === '') fail(400, 'Gönderi boş olamaz.');
    if (rl('post:' . $u['id'], 8, 60000)) fail(429, 'Çok sık paylaşım yapıyorsun, biraz bekle.');
    $p = ['id' => rid(), 'uid' => $u['id'], 'text' => $t, 'at' => now_ms(), 'mood' => so_mood($b['mood'] ?? ''), 'image' => $img];
    q('INSERT INTO ml_posts (id, uid, text, at, mood, image) VALUES (?, ?, ?, ?, ?, ?)', array_values($p));
    if ($rec) q('UPDATE ml_images SET post = ? WHERE id = ?', [$p['id'], $img]);
    $cut = val('SELECT at FROM ml_posts ORDER BY at DESC LIMIT 1 OFFSET ' . SO_MAX_POSTS);
    if ($cut !== null) { $old = array_column(all('SELECT id FROM ml_posts WHERE at <= ?', [$cut]), 'id'); post_children_delete($old); q('DELETE FROM ml_posts WHERE at <= ?', [$cut]); }
    to_friends($u['id'], 'social:post', ['id' => $p['id'], 'username' => uname($u)]);
    out(['post' => posts_view([$p], $u['id'])[0]]);
}
function so_find_post(array $u, string $id): array {
    $p = one('SELECT * FROM ml_posts WHERE id = ?', [$id]);
    if (!$p || !visible_to($u['id'], $p['uid'])) fail(404, 'Gönderi bulunamadı.');
    return $p;
}
function h_so_post_delete(string $id): never {
    $u = need_user(); $p = one('SELECT id FROM ml_posts WHERE id = ? AND uid = ?', [$id, $u['id']]);
    if (!$p) fail(404, 'Gönderi bulunamadı.');
    post_children_delete([$id]); q('DELETE FROM ml_posts WHERE id = ?', [$id]);
    out(['ok' => true]);
}
function h_so_like(string $id): never {
    $u = need_user(); $p = so_find_post($u, $id);
    if (val('SELECT 1 FROM ml_likes WHERE post = ? AND uid = ?', [$id, $u['id']])) { q('DELETE FROM ml_likes WHERE post = ? AND uid = ?', [$id, $u['id']]); $liked = false; }
    else { q(ins_ignore() . ' INTO ml_likes (post, uid) VALUES (?, ?)', [$id, $u['id']]); $liked = true; }
    out(['liked' => $liked, 'likes' => (int)val('SELECT COUNT(*) FROM ml_likes WHERE post = ?', [$id])]);
}
function h_so_comment(string $id): never {
    $u = need_user(); $p = so_find_post($u, $id); $t = txt(body()['text'] ?? '', 300);
    if ($t === '') fail(400, 'Yorum boş olamaz.');
    if (rl('cm:' . $u['id'], 20, 60000)) fail(429, 'Çok sık yorum yapıyorsun, biraz bekle.');
    $c = ['id' => rid(), 'post' => $id, 'uid' => $u['id'], 'text' => $t, 'at' => now_ms()];
    q('INSERT INTO ml_comments (id, post, uid, text, at) VALUES (?, ?, ?, ?, ?)', array_values($c));
    if ($p['uid'] !== $u['id']) rt_to_user($p['uid'], 'social:notify', ['type' => 'comment', 'by' => uname($u), 'postId' => $id]);
    out(['comment' => ['id' => $c['id'], 'author' => card($u), 'text' => $t, 'at' => $c['at']], 'commentCount' => (int)val('SELECT COUNT(*) FROM ml_comments WHERE post = ?', [$id])]);
}

// ---------- Arkadaşlık ----------
function h_so_search(): never {
    $u = need_user(); $q = lower(txt($_GET['q'] ?? '', 40));
    if (mb_strlen($q) < 2) out(['users' => []]);
    $where = []; $p = [$u['id']];
    foreach (preg_split('/\s+/', $q) as $tok) {
        $like = '%' . str_replace(['!', '%', '_'], ['!!', '!%', '!_'], $tok) . '%';
        $where[] = "(ulc LIKE ? ESCAPE '!' OR first_name LIKE ? ESCAPE '!' OR last_name LIKE ? ESCAPE '!')"; array_push($p, $like, $like, $like);
    }
    $rows = all('SELECT * FROM ml_users WHERE id <> ? AND ' . implode(' AND ', $where) . ' LIMIT 10', $p);
    out(['users' => array_map(fn($r) => card($r) + relation($u['id'], $r), $rows)]);
}
function so_unread(string $me, string $other): int { return (int)val('SELECT COUNT(*) FROM ml_msgs WHERE pair = ? AND to_uid = ? AND rd = 0', [pair_key($me, $other), $me]); }
function h_so_friends(): never {
    $u = need_user(); $id = $u['id']; $friends = [];
    foreach (social_friend_ids($id) as $fid) {
        $f = user_by_id($fid); if (!$f) continue;
        $last = one('SELECT * FROM ml_msgs WHERE pair = ? ORDER BY at DESC LIMIT 1', [pair_key($id, $fid)]);
        $friends[] = card($f) + ['online' => rt_online($fid), 'status' => $f['status'], 'unread' => so_unread($id, $fid),
            'last' => $last ? ['text' => $last['text'], 'at' => (int)$last['at'], 'mine' => $last['from_uid'] === $id] : null];
    }
    usort($friends, fn($a, $b) => (($b['last']['at'] ?? 0) <=> ($a['last']['at'] ?? 0)) ?: strcmp(lower($a['name']), lower($b['name'])));
    $reqs = fn($col) => all("SELECT * FROM ml_requests WHERE $col = ? ORDER BY at", [$id]);
    $in = $reqs('to_uid'); $outg = $reqs('from_uid');
    $cards = cards_for([...array_column($in, 'from_uid'), ...array_column($outg, 'to_uid')]);
    out(['friends' => $friends,
        'incoming' => array_map(fn($x) => ['id' => $x['id'], 'user' => $cards[$x['from_uid']] ?? SO_GONE, 'at' => (int)$x['at']], $in),
        'outgoing' => array_map(fn($x) => ['id' => $x['id'], 'user' => $cards[$x['to_uid']] ?? SO_GONE, 'at' => (int)$x['at']], $outg),
        'unreadTotal' => array_sum(array_column($friends, 'unread'))]);
}
function h_so_request_create(): never {
    $u = need_user(); $o = user_by_name((string)(body()['username'] ?? ''));
    if (!$o) fail(404, 'Kullanıcı bulunamadı.');
    if ($o['id'] === $u['id']) fail(400, 'Kendine istek gönderemezsin.');
    if (rl('rq:' . $u['id'], 20, 60000)) fail(429, 'Çok fazla istek gönderdin, biraz bekle.');
    $rel = relation($u['id'], $o);
    if ($rel['rel'] === 'friend') fail(409, 'Zaten arkadaşsınız.');
    if ($rel['rel'] === 'outgoing') fail(409, 'İstek zaten gönderilmiş.');
    if ($rel['rel'] === 'incoming') { make_friends($u['id'], $o['id']); rt_to_user($o['id'], 'social:friends', new stdClass); rt_to_user($u['id'], 'social:friends', new stdClass); out(['rel' => 'friend']); }
    $r = ['id' => rid(), 'from_uid' => $u['id'], 'to_uid' => $o['id'], 'at' => now_ms()];
    q('INSERT INTO ml_requests (id, from_uid, to_uid, at) VALUES (?, ?, ?, ?)', array_values($r));
    rt_to_user($o['id'], 'social:request', ['id' => $r['id'], 'from' => card($u)]);
    out(['rel' => 'outgoing', 'requestId' => $r['id']]);
}
function h_so_request_accept(string $id): never {
    $u = need_user(); $r = one('SELECT * FROM ml_requests WHERE id = ? AND to_uid = ?', [$id, $u['id']]);
    if (!$r) fail(404, 'İstek bulunamadı.');
    make_friends($r['from_uid'], $r['to_uid']);
    rt_to_user($r['from_uid'], 'social:friends', new stdClass); rt_to_user($r['to_uid'], 'social:friends', new stdClass);
    out(['rel' => 'friend']);
}
function h_so_request_delete(string $id): never {
    $u = need_user(); $r = one('SELECT * FROM ml_requests WHERE id = ? AND (to_uid = ? OR from_uid = ?)', [$id, $u['id'], $u['id']]);
    if (!$r) fail(404, 'İstek bulunamadı.');
    q('DELETE FROM ml_requests WHERE id = ?', [$id]);
    rt_to_user($r['from_uid'], 'social:friends', new stdClass); rt_to_user($r['to_uid'], 'social:friends', new stdClass);
    out(['rel' => 'none']);
}
function h_so_friend_delete(string $name): never {
    $u = need_user(); $o = user_by_name($name);
    if (!$o || !is_friend($u['id'], $o['id'])) fail(404, 'Arkadaş bulunamadı.');
    q('DELETE FROM ml_friends WHERE (a = ? AND b = ?) OR (a = ? AND b = ?)', [$u['id'], $o['id'], $o['id'], $u['id']]);
    q('DELETE FROM ml_msgs WHERE pair = ?', [pair_key($u['id'], $o['id'])]);
    rt_to_user($o['id'], 'social:friends', new stdClass); rt_to_user($u['id'], 'social:friends', new stdClass);
    out(['rel' => 'none']);
}

// ---------- Mesajlar ----------
function msg_out(array $m, $cid = null): array {
    static $names = [];
    foreach ([$m['from_uid'], $m['to_uid']] as $id) if (!isset($names[$id])) { $r = user_by_id($id); $names[$id] = $r ? uname($r) : 'silinmis'; }
    $o = ['id' => $m['id'], 'from' => $names[$m['from_uid']], 'to' => $names[$m['to_uid']], 'text' => $m['text'], 'at' => (int)$m['at'], 'read' => (bool)$m['rd']];
    if ($cid !== null) $o['cid'] = $cid;
    return $o;
}
function dm_send(array $u, string $toName, $text, $cid): array {
    $o = user_by_name($toName); $t = txt($text, 1000);
    if (!$o || $o['id'] === $u['id'] || !is_friend($u['id'], $o['id'])) return ['error' => 'Bu kullanıcıyla arkadaş değilsiniz.'];
    if ($t === '') return ['error' => 'Mesaj boş olamaz.'];
    if (rl('dm:' . $u['id'], 20, 10000)) return ['error' => 'Çok hızlı yazıyorsun, biraz bekle.'];
    $m = ['id' => rid(), 'pair' => pair_key($u['id'], $o['id']), 'from_uid' => $u['id'], 'to_uid' => $o['id'], 'text' => $t, 'at' => now_ms(), 'rd' => 0];
    q('INSERT INTO ml_msgs (id, pair, from_uid, to_uid, text, at, rd) VALUES (?, ?, ?, ?, ?, ?, ?)', array_values($m));
    $cut = val('SELECT at FROM ml_msgs WHERE pair = ? ORDER BY at DESC LIMIT 1 OFFSET ' . SO_MAX_MSGS, [$m['pair']]);
    if ($cut !== null) q('DELETE FROM ml_msgs WHERE pair = ? AND at <= ?', [$m['pair'], $cut]);
    $cid = is_scalar($cid) ? $cid : null;
    $out = msg_out($m, $cid);
    rt_to_user($o['id'], 'dm:new', $out); rt_to_user($u['id'], 'dm:new', $out);      // gönderenin diğer sekmeleri de görür
    return ['ok' => true, 'message' => $out];
}
function dm_mark_read(array $u, array $o): int {
    $st = q('UPDATE ml_msgs SET rd = 1 WHERE pair = ? AND to_uid = ? AND rd = 0', [pair_key($u['id'], $o['id']), $u['id']]);
    $n = $st->rowCount();
    if ($n) rt_to_user($o['id'], 'dm:read', ['by' => uname($u)]);
    return $n;
}
function dm_typing(array $u, string $toName, bool $typing): void {
    $o = user_by_name($toName);
    if ($o && is_friend($u['id'], $o['id']) && !rl('ty:' . $u['id'], 30, 10000)) rt_to_user($o['id'], 'dm:typing', ['from' => uname($u), 'typing' => $typing]);
}
function dm_read_ev(array $u, string $with): array { $o = user_by_name($with); if ($o && is_friend($u['id'], $o['id'])) { dm_mark_read($u, $o); return ['ok' => true]; } return ['ok' => false]; }
function h_so_messages_get(string $name): never {
    $u = need_user(); $o = user_by_name($name);
    if (!$o || !is_friend($u['id'], $o['id'])) fail(403, 'Bu kullanıcıyla arkadaş değilsiniz.');
    $before = isset($_GET['before']) && (float)$_GET['before'] > 0 ? (int)$_GET['before'] : PHP_INT_MAX;
    $rows = all('SELECT * FROM ml_msgs WHERE pair = ? AND at < ? ORDER BY at DESC LIMIT 51', [pair_key($u['id'], $o['id']), $before]);
    $slice = array_reverse(array_slice($rows, 0, 50));
    if (!isset($_GET['before']) || !(float)$_GET['before']) dm_mark_read($u, $o);
    out(['messages' => array_map(fn($m) => msg_out($m), $slice), 'more' => count($rows) > 50]);
}
function h_so_messages_post(string $name): never {
    $u = need_user(); $b = body(); $r = dm_send($u, $name, $b['text'] ?? '', $b['cid'] ?? null);
    if (isset($r['error'])) fail(400, $r['error']);
    out($r);
}

// Hesap silinirken: gönderiler, görseller, beğeni/yorumlar, arkadaşlık, istekler, mesajlar
function social_remove_user(string $uid): void {
    post_children_delete(array_column(all('SELECT id FROM ml_posts WHERE uid = ?', [$uid]), 'id'));
    q('DELETE FROM ml_posts WHERE uid = ?', [$uid]);
    q('DELETE FROM ml_likes WHERE uid = ?', [$uid]); q('DELETE FROM ml_comments WHERE uid = ?', [$uid]); q('DELETE FROM ml_images WHERE uid = ?', [$uid]);
    q('DELETE FROM ml_friends WHERE a = ? OR b = ?', [$uid, $uid]);
    q('DELETE FROM ml_requests WHERE from_uid = ? OR to_uid = ?', [$uid, $uid]);
    q('DELETE FROM ml_msgs WHERE from_uid = ? OR to_uid = ?', [$uid, $uid]);
}
