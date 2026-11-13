<?php
// Sürüş kayıtları (rides.js karşılığı): yükleme (doğrulama + özetin yeniden hesabı), listeleme, okuma, telemetri eş kaydı.
declare(strict_types=1);

const RIDES_MAX_BODY = 3145728, RIDES_MAX_PER_USER = 5000;
const RIDE_JSON = JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRESERVE_ZERO_FRACTION;

function rides_raw_json(string $err): mixed {
    $raw = file_get_contents('php://input');
    if (strlen($raw) > RIDES_MAX_BODY) fail(400, $err === 'Sürüş verisi okunamadı.' ? 'Sürüş verisi çok büyük.' : 'Telemetri verisi çok büyük.');
    if ($raw === '') fail(400, 'Boş istek.');
    $d = json_decode($raw, true);
    if ($d === null && trim($raw) !== 'null') fail(400, $err);
    return $d;
}
function h_ride_post(): never {
    $u = need_user();
    if (rl('rup:' . $u['id'], 30, 60000)) fail(429, 'Çok sık gönderim yaptın. Biraz bekle.');
    $d = rides_raw_json('Sürüş verisi okunamadı.');
    if ($err = rc_validate_ride($d)) fail(400, $err);
    $ex = one('SELECT summary FROM ml_rides WHERE uid = ? AND id = ?', [$u['id'], $d['id']]);
    if ($ex) out(['ok' => true, 'duplicate' => true, 'id' => $d['id'], 'summary' => json_decode($ex['summary'], true)]);
    if ((int)val('SELECT COUNT(*) FROM ml_rides WHERE uid = ?', [$u['id']]) >= RIDES_MAX_PER_USER) fail(400, 'Kayıtlı sürüş sınırına ulaşıldı.');
    $summary = rc_summarize($d);                                         // istemcinin özetine güvenilmez: ham veriden yeniden hesaplanır
    $full = ['v' => 1, 'id' => $d['id'], 'startedAt' => $d['startedAt'], 'endedAt' => $d['endedAt'], 'events' => $d['events'], 'fixes' => $d['fixes'], 'summary' => $summary, 'receivedAt' => now_ms()];
    try {
        q('INSERT INTO ml_rides (uid, id, started, ended, summary, data, received) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [$u['id'], $d['id'], (int)$d['startedAt'], (int)$d['endedAt'], json_encode($summary, RIDE_JSON), json_encode($full, RIDE_JSON), now_ms()]);
    } catch (PDOException $e) { fail(500, 'Sürüş sunucuya yazılamadı.'); }
    out(['ok' => true, 'id' => $d['id'], 'summary' => $summary]);
}
function h_ride_tele_post(string $id): never {
    $u = need_user();
    if (!preg_match('/^r_[a-z0-9]{8,32}$/', $id)) fail(400, 'Geçersiz sürüş kimliği.');
    if (rl('rtele:' . $u['id'], 30, 60000)) fail(429, 'Çok sık gönderim yaptın. Biraz bekle.');
    $ride = one('SELECT started, ended, telesum FROM ml_rides WHERE uid = ? AND id = ?', [$u['id'], $id]);
    if (!$ride) fail(404, 'Sürüş sunucuda yok; önce sürüş eşitlenmeli.');
    if ($ride['telesum'] !== null) out(['ok' => true, 'duplicate' => true, 'id' => $id, 'summary' => json_decode($ride['telesum'], true)]);
    $d = rides_raw_json('Telemetri verisi okunamadı.');
    $c = tc_clean_tele($d, ['id' => $id, 'startedAt' => (int)$ride['started'], 'endedAt' => (int)$ride['ended']]);
    if (isset($c['err'])) fail(400, $c['err']);
    $summary = tc_summarize($c['tele']);
    q('UPDATE ml_rides SET tele = ?, telesum = ? WHERE uid = ? AND id = ?', [json_encode($c['tele'] + ['summary' => $summary, 'receivedAt' => now_ms()], RIDE_JSON), json_encode($summary, RIDE_JSON), $u['id'], $id]);
    out(['ok' => true, 'id' => $id, 'summary' => $summary]);
}
function h_ride_tele_get(string $id): never {
    $u = need_user();
    if (!preg_match('/^r_[a-z0-9]{8,32}$/', $id)) fail(400, 'Geçersiz sürüş kimliği.');
    $t = val('SELECT tele FROM ml_rides WHERE uid = ? AND id = ?', [$u['id'], $id]);
    if ($t === null) fail(404, 'Bu sürüş için telemetri yok.');
    header('Content-Type: application/json; charset=utf-8'); echo lob($t); exit;
}
function h_ride_list(): never {
    $u = need_user(); $rides = [];
    foreach (all('SELECT id, started, ended, summary, telesum FROM ml_rides WHERE uid = ? ORDER BY started DESC LIMIT 100', [$u['id']]) as $r) {
        $o = ['id' => $r['id'], 'startedAt' => (int)$r['started'], 'endedAt' => (int)$r['ended'], 'summary' => json_decode($r['summary'], true)];
        if ($r['telesum'] !== null) $o['tele'] = json_decode($r['telesum'], true);
        $rides[] = $o;
    }
    out(['rides' => $rides]);
}
function h_ride_get(string $id): never {
    $u = need_user();
    if (!preg_match('/^r_[a-z0-9]{8,32}$/', $id)) fail(400, 'Geçersiz sürüş kimliği.');
    $d = val('SELECT data FROM ml_rides WHERE uid = ? AND id = ?', [$u['id'], $id]);
    if ($d === null) fail(404, 'Sürüş bulunamadı.');
    header('Content-Type: application/json; charset=utf-8'); echo lob($d); exit;
}
