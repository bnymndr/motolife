<?php
// Moto Life — PHP + MySQL arka ucu: yapılandırma, veritabanı, oturum ve ortak yardımcılar.
declare(strict_types=1);
ini_set('serialize_precision', '-1');
ini_set('display_errors', '0');
mb_internal_encoding('UTF-8');

// ---------- Yapılandırma: api/config.php (dizi) → ortam değişkeni → varsayılan ----------
function cfg(string $k, $d = '') {
    static $c = null;
    if ($c === null) { $f = __DIR__ . '/config.php'; $c = is_file($f) ? (array)(require $f) : []; }
    if (isset($c[$k]) && $c[$k] !== '') return $c[$k];
    $e = getenv($k);
    return ($e !== false && $e !== '') ? $e : $d;
}
function now_ms(): int { return (int)floor(microtime(true) * 1000); }
function jsround(float $x): float { return floor($x + 0.5); }          // JavaScript Math.round
function r5(float $v): float { return jsround($v * 1e5) / 1e5; }

// ---------- Veritabanı (MySQL; yerel test için SQLite) ----------
function sqlite_mode(): bool { return cfg('DB_DRIVER', 'mysql') === 'sqlite'; }
function db(): PDO {
    static $pdo = null;
    if ($pdo) return $pdo;
    $opt = [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC, PDO::ATTR_EMULATE_PREPARES => false];
    if (sqlite_mode()) {
        $pdo = new PDO('sqlite:' . cfg('DB_FILE', sys_get_temp_dir() . '/motolife.sqlite'), null, null, $opt);
        $pdo->exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=OFF');
    } else {
        $dsn = 'mysql:host=' . cfg('DB_HOST', 'localhost') . ';port=' . cfg('DB_PORT', '3306') . ';dbname=' . cfg('DB_NAME') . ';charset=utf8mb4';
        $pdo = new PDO($dsn, (string)cfg('DB_USER'), (string)cfg('DB_PASS'), $opt);
        $pdo->exec("SET time_zone = '+00:00'");
    }
    ensure_schema($pdo);
    return $pdo;
}
function q(string $sql, array $p = []): PDOStatement {
    $st = db()->prepare($sql);
    foreach (array_values($p) as $i => $v) {
        if (is_int($v)) $st->bindValue($i + 1, $v, PDO::PARAM_INT);
        elseif ($v === null) $st->bindValue($i + 1, null, PDO::PARAM_NULL);
        elseif (is_bool($v)) $st->bindValue($i + 1, $v ? 1 : 0, PDO::PARAM_INT);
        elseif (is_float($v)) $st->bindValue($i + 1, $v);                // DOUBLE
        else $st->bindValue($i + 1, (string)$v);
    }
    $st->execute();
    return $st;
}
function one(string $sql, array $p = []): ?array { $r = q($sql, $p)->fetch(); return $r === false ? null : $r; }
function all(string $sql, array $p = []): array { return q($sql, $p)->fetchAll(); }
function val(string $sql, array $p = []) { $r = q($sql, $p)->fetch(PDO::FETCH_NUM); return $r === false ? null : $r[0]; }
function ins_ignore(): string { return sqlite_mode() ? 'INSERT OR IGNORE' : 'INSERT IGNORE'; }
function lob($v): string { if (is_resource($v)) return (string)stream_get_contents($v); return $v === null ? '' : (string)$v; }

const SCHEMA_VERSION = '6';
function ensure_schema(PDO $pdo): void {
    static $done = false;
    if ($done) return; $done = true;
    try { $v = $pdo->query("SELECT v FROM ml_kv WHERE k='schema'")->fetchColumn(); if ($v === SCHEMA_VERSION) return; } catch (Throwable $e) {}
    $ai = sqlite_mode() ? 'INTEGER PRIMARY KEY AUTOINCREMENT' : 'BIGINT AUTO_INCREMENT PRIMARY KEY';
    $eng = sqlite_mode() ? '' : ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';
    $t = [
        'ml_kv' => 'k VARCHAR(190) PRIMARY KEY, v MEDIUMTEXT, exp BIGINT NOT NULL DEFAULT 0',
        'ml_users' => 'id CHAR(24) PRIMARY KEY, username VARCHAR(40) NOT NULL, ulc VARCHAR(190) NOT NULL UNIQUE, email VARCHAR(190) NOT NULL UNIQUE, phone VARCHAR(30) NULL UNIQUE,
            first_name VARCHAR(80) NOT NULL DEFAULT \'\', last_name VARCHAR(80) NOT NULL DEFAULT \'\', gender VARCHAR(30) NOT NULL DEFAULT \'belirtmek-istemiyorum\',
            bike_brand VARCHAR(80) NOT NULL DEFAULT \'\', bike_model VARCHAR(80) NOT NULL DEFAULT \'\', bike_year INT NULL, bike_type VARCHAR(20) NOT NULL DEFAULT \'\', bike_cc INT NULL,
            emergency_name VARCHAR(80) NOT NULL DEFAULT \'\', emergency_phone VARCHAR(30) NOT NULL DEFAULT \'\', pw_hash VARCHAR(255) NULL,
            sv INT NOT NULL DEFAULT 0, reset_hash VARCHAR(64) NULL, reset_exp BIGINT NOT NULL DEFAULT 0,
            avatar MEDIUMTEXT NULL, created_at BIGINT NOT NULL DEFAULT 0, bio VARCHAR(255) NOT NULL DEFAULT \'\', status VARCHAR(255) NOT NULL DEFAULT \'\',
            mood VARCHAR(20) NOT NULL DEFAULT \'\', status_at BIGINT NOT NULL DEFAULT 0',
        'ml_posts' => 'id CHAR(16) PRIMARY KEY, uid CHAR(24) NOT NULL, text TEXT NOT NULL, at BIGINT NOT NULL, mood VARCHAR(20) NOT NULL DEFAULT \'\', image CHAR(16) NOT NULL DEFAULT \'\'',
        'ml_likes' => 'post CHAR(16) NOT NULL, uid CHAR(24) NOT NULL, PRIMARY KEY (post, uid)',
        'ml_comments' => 'id CHAR(16) PRIMARY KEY, post CHAR(16) NOT NULL, uid CHAR(24) NOT NULL, text TEXT NOT NULL, at BIGINT NOT NULL',
        'ml_images' => 'id CHAR(16) PRIMARY KEY, uid CHAR(24) NOT NULL, at BIGINT NOT NULL, post CHAR(16) NULL, data MEDIUMBLOB NOT NULL',
        'ml_friends' => 'a CHAR(24) NOT NULL, b CHAR(24) NOT NULL, PRIMARY KEY (a, b)',
        'ml_blocks' => 'a CHAR(24) NOT NULL, b CHAR(24) NOT NULL, at BIGINT NOT NULL DEFAULT 0, PRIMARY KEY (a, b)',
        'ml_requests' => 'id CHAR(16) PRIMARY KEY, from_uid CHAR(24) NOT NULL, to_uid CHAR(24) NOT NULL, at BIGINT NOT NULL',
        'ml_msgs' => 'id CHAR(16) PRIMARY KEY, pair VARCHAR(50) NOT NULL, from_uid CHAR(24) NOT NULL, to_uid CHAR(24) NOT NULL, text TEXT NOT NULL, at BIGINT NOT NULL, rd TINYINT NOT NULL DEFAULT 0',
        'ml_rides' => 'uid CHAR(24) NOT NULL, id VARCHAR(40) NOT NULL, started BIGINT NOT NULL, ended BIGINT NOT NULL, summary TEXT NOT NULL, data MEDIUMTEXT NOT NULL,
            tele MEDIUMTEXT NULL, telesum TEXT NULL, received BIGINT NOT NULL, PRIMARY KEY (uid, id)',
        'ml_rg' => 'id CHAR(16) PRIMARY KEY, name VARCHAR(80) NOT NULL, code CHAR(8) NOT NULL UNIQUE, leader CHAR(24) NOT NULL, created_at BIGINT NOT NULL, gap INT NOT NULL DEFAULT 1000,
            route_v INT NOT NULL DEFAULT 0, route_len INT NOT NULL DEFAULT 0, route_n INT NOT NULL DEFAULT 0, route_name VARCHAR(120) NOT NULL DEFAULT \'\', route_pts MEDIUMTEXT NULL,
            ride_id CHAR(16) NULL, ride_started BIGINT NOT NULL DEFAULT 0, ride_by CHAR(24) NULL, ride_idle BIGINT NOT NULL DEFAULT 0, rec_bytes BIGINT NOT NULL DEFAULT 0,
            rec_full TINYINT NOT NULL DEFAULT 0, tick_at BIGINT NOT NULL DEFAULT 0',
        'ml_rgm' => 'gid CHAR(16) NOT NULL, uid CHAR(24) NOT NULL, at BIGINT NOT NULL, role VARCHAR(8) NOT NULL DEFAULT \'\', PRIMARY KEY (gid, uid)',
        'ml_pics' => 'kind VARCHAR(8) NOT NULL, ref VARCHAR(24) NOT NULL, img MEDIUMTEXT NOT NULL, ver VARCHAR(12) NOT NULL DEFAULT \'\', at BIGINT NOT NULL DEFAULT 0, PRIMARY KEY (kind, ref)',
        'ml_rgx' => 'gid CHAR(16) PRIMARY KEY, descr VARCHAR(255) NOT NULL DEFAULT \'\'',
        'ml_gp' => 'id CHAR(16) PRIMARY KEY, gid CHAR(16) NOT NULL, uid CHAR(24) NOT NULL, text TEXT NOT NULL, at BIGINT NOT NULL, mood VARCHAR(20) NOT NULL DEFAULT \'\', image CHAR(16) NOT NULL DEFAULT \'\'',
        'ml_gpl' => 'post CHAR(16) NOT NULL, uid CHAR(24) NOT NULL, PRIMARY KEY (post, uid)',
        'ml_gpc' => 'id CHAR(16) PRIMARY KEY, post CHAR(16) NOT NULL, uid CHAR(24) NOT NULL, text TEXT NOT NULL, at BIGINT NOT NULL',
        'ml_rgrides' => 'id CHAR(16) PRIMARY KEY, gid CHAR(16) NOT NULL, started BIGINT NOT NULL, ended BIGINT NOT NULL, sum MEDIUMTEXT NULL',
        'ml_rgrec' => "id $ai, rideid CHAR(16) NOT NULL, line MEDIUMTEXT NOT NULL",
        'ml_rgstat' => 'rideid CHAR(16) NOT NULL, uname VARCHAR(40) NOT NULL, n INT NOT NULL DEFAULT 0, first_at BIGINT NOT NULL, last_at BIGINT NOT NULL, PRIMARY KEY (rideid, uname)',
        'ml_rglive' => 'gid CHAR(16) NOT NULL, uid CHAR(24) NOT NULL, sid CHAR(16) NOT NULL, lat DOUBLE NULL, lon DOUBLE NULL, acc INT NULL, spd DOUBLE NULL, est DOUBLE NULL, at BIGINT NOT NULL DEFAULT 0,
            rt_d DOUBLE NULL, rt_along DOUBLE NULL, rt_i INT NULL, fl VARCHAR(10) NULL, pend_f VARCHAR(10) NULL, pend_n INT NOT NULL DEFAULT 0, pend_m DOUBLE NOT NULL DEFAULT 0, PRIMARY KEY (gid, uid)',
        'ml_rts' => 'sid CHAR(16) PRIMARY KEY, uid CHAR(24) NOT NULL, last BIGINT NOT NULL, created BIGINT NOT NULL, w_lat DOUBLE NULL, w_lon DOUBLE NULL, w_km DOUBLE NULL, w_fo TINYINT NOT NULL DEFAULT 0, w_key TEXT NULL',
        'ml_rtr' => 'sid CHAR(16) NOT NULL, room VARCHAR(60) NOT NULL, skey TEXT NULL, PRIMARY KEY (sid, room)',
        'ml_rte' => "id $ai, sid CHAR(16) NOT NULL, ev VARCHAR(40) NOT NULL, payload MEDIUMTEXT NOT NULL, at BIGINT NOT NULL",
        'ml_live' => 'uid CHAR(24) PRIMARY KEY, sid CHAR(16) NOT NULL, name VARCHAR(40) NOT NULL, aud VARCHAR(10) NOT NULL, lat DOUBLE NULL, lon DOUBLE NULL, riding TINYINT NOT NULL DEFAULT 0, at BIGINT NOT NULL DEFAULT 0, seen TINYINT NOT NULL DEFAULT 0',
        'ml_gvr' => 'gid CHAR(16) PRIMARY KEY, mode VARCHAR(5) NOT NULL DEFAULT \'ptt\', f_sid CHAR(16) NULL, f_uid CHAR(24) NULL, f_name VARCHAR(40) NULL, f_since BIGINT NOT NULL DEFAULT 0, f_until BIGINT NOT NULL DEFAULT 0',
        'ml_gvp' => 'sid CHAR(16) PRIMARY KEY, gid CHAR(16) NOT NULL, uid CHAR(24) NOT NULL, name VARCHAR(40) NOT NULL, mic TINYINT NOT NULL DEFAULT 0',
    ];
    foreach ($t as $n => $cols) $pdo->exec("CREATE TABLE IF NOT EXISTS $n ($cols)$eng");
    try { $pdo->exec("ALTER TABLE ml_rgm ADD COLUMN role VARCHAR(8) NOT NULL DEFAULT ''"); } catch (Throwable $e) {}   // eski kurulumlar için (v5); yeni kurulumda sütun zaten var
    $idx = ['ml_posts(uid, at)', 'ml_posts(at)', 'ml_comments(post)', 'ml_images(uid)', 'ml_friends(b)', 'ml_requests(from_uid)', 'ml_requests(to_uid)', 'ml_msgs(pair, at)',
        'ml_rgm(uid)', 'ml_rgrides(gid)', 'ml_rgrec(rideid)', 'ml_rglive(sid)', 'ml_rts(uid)', 'ml_rtr(room)', 'ml_rte(sid)', 'ml_gvp(gid)', 'ml_rides(uid, started)', 'ml_kv(exp)', 'ml_gp(gid, at)', 'ml_gpc(post)'];
    foreach ($idx as $i => $def) { try { $pdo->exec('CREATE INDEX mlx' . $i . ' ON ' . $def); } catch (Throwable $e) {} }
    $pdo->prepare('REPLACE INTO ml_kv (k, v, exp) VALUES (?, ?, 0)')->execute(['schema', SCHEMA_VERSION]);
}

// ---------- Anahtar-değer deposu: sınırlar, önbellek, tek kullanımlık jetonlar ----------
function kv_get(string $k): ?string {
    $r = one('SELECT v, exp FROM ml_kv WHERE k = ?', [$k]);
    if (!$r || ($r['exp'] > 0 && $r['exp'] < now_ms())) return null;
    return (string)$r['v'];
}
function kv_set(string $k, string $v, int $ttlMs = 0): void {
    q('REPLACE INTO ml_kv (k, v, exp) VALUES (?, ?, ?)', [$k, $v, $ttlMs > 0 ? now_ms() + $ttlMs : 0]);
    if (random_int(1, 200) === 1) q('DELETE FROM ml_kv WHERE exp > 0 AND exp < ?', [now_ms()]);
}
// Kayan pencere: ms içinde en fazla $max işlem. true = sınır aşıldı.
function rl(string $key, int $max, int $ms): bool {
    $now = now_ms(); $a = json_decode(kv_get('rl:' . $key) ?? '[]', true) ?: [];
    $a = array_values(array_filter($a, fn($t) => $now - $t < $ms));
    $over = count($a) >= $max;
    if (!$over) $a[] = $now;
    kv_set('rl:' . $key, json_encode($a), $ms);
    return $over;
}

// ---------- Metin / kimlik yardımcıları ----------
function rid(): string { return bin2hex(random_bytes(8)); }
function clean($s, int $n): string { return mb_substr(trim((string)($s ?? '')), 0, $n); }
function txt($s, int $n): string { return mb_substr(trim(preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F]/u', '', (string)($s ?? ''))), 0, $n); }
function lower(string $s): string { return mb_strtolower(str_replace('İ', 'i', $s)); }
function b64u(string $s): string { return rtrim(strtr(base64_encode($s), '+/', '-_'), '='); }
function b64u_dec(string $s): string { return (string)base64_decode(strtr($s, '-_', '+/') . str_repeat('=', (4 - strlen($s) % 4) % 4)); }

// ---------- Yanıt ----------
function out($data, int $code = 200): never {
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRESERVE_ZERO_FRACTION | JSON_INVALID_UTF8_SUBSTITUTE);
    exit;
}
function fail(int $code, string $msg, array $extra = []): never { out(['error' => $msg] + $extra, $code); }
function body(int $limit = 10240): array {
    static $b = null;
    if ($b !== null) return $b;
    $raw = file_get_contents('php://input');
    if (strlen($raw) > $limit) fail(400, 'İstek hatalı.');
    $j = json_decode($raw, true);
    return $b = is_array($j) ? $j : [];
}
function raw_body(int $limit): string {
    $raw = file_get_contents('php://input');
    if (strlen($raw) > $limit) fail(400, 'İstek çok büyük.');
    return $raw;
}
function client_ip(): string {
    if (cfg('TRUST_PROXY', '') && !empty($_SERVER['HTTP_X_FORWARDED_FOR'])) return trim(explode(',', $_SERVER['HTTP_X_FORWARDED_FOR'])[0]);
    return $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';
}
function is_https(): bool { return (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https'); }
function app_url(): string {
    $u = rtrim((string)cfg('APP_URL', ''), '/');
    return $u !== '' ? $u : (is_https() ? 'https' : 'http') . '://' . ($_SERVER['HTTP_HOST'] ?? 'localhost');
}

// ---------- HTTP istemcisi (dış servisler) ----------
// Dönüş: ['status' => int, 'ok' => bool, 'body' => çözülmüş JSON | null]
function http_json(string $url, array $headers = [], int $timeout = 9, ?string $method = null, ?string $body = null): array {
    $h = array_merge(['Accept: application/json'], $headers);
    if (function_exists('curl_init')) {
        $c = curl_init($url);
        curl_setopt_array($c, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => $timeout, CURLOPT_CONNECTTIMEOUT => min(5, $timeout), CURLOPT_HTTPHEADER => $h, CURLOPT_FOLLOWLOCATION => false]);
        if ($method === 'POST') { curl_setopt($c, CURLOPT_POST, true); curl_setopt($c, CURLOPT_POSTFIELDS, (string)$body); }
        $raw = curl_exec($c); $st = (int)curl_getinfo($c, CURLINFO_HTTP_CODE); curl_close($c);
        if ($raw === false) return ['status' => 0, 'ok' => false, 'body' => null];
    } else {
        $ctx = stream_context_create(['http' => ['method' => $method ?? 'GET', 'header' => implode("\r\n", $h), 'content' => $body ?? '', 'timeout' => $timeout, 'ignore_errors' => true]]);
        $raw = @file_get_contents($url, false, $ctx); $st = 0;
        if ($raw === false) return ['status' => 0, 'ok' => false, 'body' => null];
        foreach ($http_response_header ?? [] as $l) if (preg_match('#^HTTP/\S+\s+(\d{3})#', $l, $m)) $st = (int)$m[1];
    }
    return ['status' => $st, 'ok' => $st >= 200 && $st < 300, 'body' => json_decode((string)$raw, true)];
}
function warn_once(string $msg): void {
    $k = 'warn:' . md5($msg);
    if (kv_get($k) === null) { kv_set($k, '1', 600000); error_log('[moto-life] ' . $msg); }
}

// ---------- Oturum: imzalı çerez  sid=<uid>.<exp ms>.<sv>.<imza> ----------
function secret(): string {
    static $s = null;
    if ($s !== null) return $s;
    $c = (string)cfg('SESSION_SECRET', '');
    if ($c === '') { $c = kv_get('secret'); if ($c === null) { $c = bin2hex(random_bytes(32)); kv_set('secret', $c); } }
    return $s = $c;
}
function sign(string $v): string { return b64u(hash_hmac('sha256', $v, secret(), true)); }
function set_session_cookie(array $u): void {
    $exp = now_ms() + 30 * 86400000; $v = $u['id'] . '.' . $exp . '.' . (int)$u['sv'];
    setcookie('sid', $v . '.' . sign($v), ['expires' => time() + 30 * 86400, 'path' => '/', 'secure' => is_https(), 'httponly' => true, 'samesite' => 'Lax']);
}
function clear_session_cookie(): void { setcookie('sid', '', ['expires' => time() - 3600, 'path' => '/', 'secure' => is_https(), 'httponly' => true, 'samesite' => 'Lax']); }
function me(): ?array {
    static $u = false;
    if ($u !== false) return $u;
    $u = null;
    $c = $_COOKIE['sid'] ?? '';
    $p = explode('.', (string)$c);
    if (count($p) !== 4) return null;
    [$uid, $exp, $sv, $mac] = $p;
    if (!ctype_xdigit($uid) || (int)$exp < now_ms() || !hash_equals(sign("$uid.$exp.$sv"), $mac)) return null;
    $r = one('SELECT * FROM ml_users WHERE id = ?', [$uid]);
    return $u = ($r && (int)$r['sv'] === (int)$sv) ? $r : null;
}
function need_user(): array { $u = me(); if (!$u) fail(401, 'Giriş gerekli.'); return $u; }
function uname(array $u): string { return (string)$u['username']; }
function full_name(array $u): string { $n = trim($u['first_name'] . ' ' . $u['last_name']); return $n !== '' ? $n : uname($u); }
function user_by_id(string $id): ?array { return one('SELECT * FROM ml_users WHERE id = ?', [$id]); }
function user_by_name(string $n): ?array { return one('SELECT * FROM ml_users WHERE ulc = ?', [lower($n)]); }
