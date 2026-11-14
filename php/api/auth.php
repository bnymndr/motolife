<?php
// Hesaplar: kayıt, giriş, profil, şifre sıfırlama, hesap silme, şifre kuralları (server.js + accountdel.js karşılığı).
declare(strict_types=1);

const GENDERS = ['erkek', 'kadin', 'belirtmek-istemiyorum'];
const BIKE_TYPES = ['supersport', 'sporttouring', 'naked', 'adventure', 'touring', 'cruiser', 'cafe', 'retro', 'motocross', 'scooter', 'sport', 'classic', 'enduro'];   // ilk 10 = My Moto tipleri; son 3 = eski kayıtlar

function norm_phone($raw): ?string {
    $t = preg_replace('/[\s().\-]/', '', trim((string)$raw));
    if (str_starts_with($t, '00')) $t = '+' . substr($t, 2);
    if (str_starts_with($t, '+')) {
        if (preg_match('/^\+905\d{9}$/', $t)) return $t;
        return (preg_match('/^\+[1-9]\d{7,14}$/', $t) && !str_starts_with($t, '+90')) ? $t : null;
    }
    return preg_match('/^(?:90|0)?(5\d{9})$/', $t, $m) ? '+90' . $m[1] : null;
}
function pub_user(array $u): array {
    return [
        'username' => uname($u), 'firstName' => $u['first_name'], 'lastName' => $u['last_name'],
        'gender' => $u['gender'] ?: 'belirtmek-istemiyorum', 'bikeBrand' => $u['bike_brand'], 'bikeModel' => $u['bike_model'],
        'bikeYear' => $u['bike_year'] ?: '', 'bikeType' => $u['bike_type'], 'bikeCc' => $u['bike_cc'] ?: '',
        'phone' => (string)($u['phone'] ?? ''), 'emergencyName' => $u['emergency_name'], 'emergencyPhone' => $u['emergency_phone'],
        'email' => $u['email'], 'hasPassword' => !empty($u['pw_hash']),
        'avatar' => (string)($u['avatar'] ?? ''),
    ];
}
// Dönüş: ['f' => alanlar] | ['error' => metin]
function read_profile(array $b, bool $needPhone = false): array {
    $s = fn($k) => is_scalar($b[$k] ?? null) ? $b[$k] : '';
    $f = ['username' => clean($s('username'), 20), 'firstName' => clean($s('firstName'), 40), 'lastName' => clean($s('lastName'), 40),
        'gender' => (string)$s('gender'), 'bikeBrand' => clean($s('bikeBrand'), 40), 'bikeModel' => clean($s('bikeModel'), 40), 'email' => mb_strtolower(clean($s('email'), 120))];
    if (!preg_match('/^[A-Za-z0-9_.]{3,20}$/', $f['username'])) return ['error' => 'Kullanıcı adı 3-20 karakter olmalı (harf, rakam, _ ve . kullanılabilir).'];
    if ($f['firstName'] === '') return ['error' => 'İsmini gir.'];
    if ($f['lastName'] === '') return ['error' => 'Soyismini gir.'];
    if (!in_array($f['gender'], GENDERS, true)) return ['error' => 'Cinsiyet seç.'];
    if (!preg_match('/^[^@\s]+@[^@\s]+\.[^@\s]+$/', $f['email'])) return ['error' => 'Geçerli bir e-posta gir.'];
    $rawPh = clean($s('phone'), 30);
    if ($rawPh !== '') { $f['phone'] = norm_phone($rawPh); if (!$f['phone']) return ['error' => 'Geçerli bir telefon numarası gir (ör. 0532 123 45 67).']; }
    elseif ($needPhone) return ['error' => 'Telefon numaranı gir.'];
    else $f['phone'] = '';
    $en = clean($s('emergencyName'), 40); $ep = clean($s('emergencyPhone'), 30);
    if ($en !== '' || $ep !== '') {
        if ($en === '') return ['error' => 'Acil durum kişisinin adını da yaz.'];
        $f['emergencyPhone'] = norm_phone($ep);
        if (!$f['emergencyPhone']) return ['error' => 'Acil durum kişisi için geçerli bir telefon numarası gir.'];
        $f['emergencyName'] = $en;
    } else { $f['emergencyName'] = ''; $f['emergencyPhone'] = ''; }
    $maxY = (int)date('Y') + 1;
    $yv = $b['bikeYear'] ?? null;
    $yerr = ['error' => 'Model yılı 1950 ile ' . $maxY . ' arasında olmalı.'];
    if ($yv === '' || $yv === null) $f['bikeYear'] = null;
    else {
        if (!is_numeric($yv) || floor((float)$yv) != (float)$yv || (float)$yv < 1950 || (float)$yv > $maxY) return $yerr;
        $f['bikeYear'] = (int)$yv;
    }
    $ty = clean($s('bikeType'), 20);
    if ($ty !== '' && !in_array($ty, BIKE_TYPES, true)) return ['error' => 'Motosiklet tipi geçersiz.'];
    $f['bikeType'] = $ty;
    $cv = $b['bikeCc'] ?? null;
    $cc = ($cv === '' || $cv === null) ? null : str_replace(',', '.', (string)$cv);
    if ($cc !== null && (!is_numeric($cc) || !((float)$cc >= 20 && (float)$cc <= 3000))) return ['error' => 'Motor hacmi 20 ile 3000 cm³ arasında olmalı.'];
    $f['bikeCc'] = $cc === null ? null : (int)jsround((float)$cc);
    return ['f' => $f];
}
function user_set_cols(array $f): array {   // read_profile alanları → ml_users sütunları
    return ['username' => $f['username'], 'ulc' => lower($f['username']), 'first_name' => $f['firstName'], 'last_name' => $f['lastName'], 'gender' => $f['gender'],
        'bike_brand' => $f['bikeBrand'], 'bike_model' => $f['bikeModel'], 'bike_year' => $f['bikeYear'], 'bike_type' => $f['bikeType'], 'bike_cc' => $f['bikeCc'],
        'email' => $f['email'], 'phone' => $f['phone'] === '' ? null : $f['phone'], 'emergency_name' => $f['emergencyName'], 'emergency_phone' => $f['emergencyPhone']];
}
function user_insert(array $f, array $extra = []): array {
    $u = ['id' => bin2hex(random_bytes(12))] + user_set_cols($f) + ['pw_hash' => null, 'sv' => 0, 'created_at' => now_ms()];
    foreach ($extra as $k => $v) $u[$k] = $v;
    q('INSERT INTO ml_users (' . implode(',', array_keys($u)) . ') VALUES (' . implode(',', array_fill(0, count($u), '?')) . ')', array_values($u));
    return user_by_id($u['id']);
}
function start_session(array $u): never { set_session_cookie($u); out(['user' => pub_user($u)]); }

// ---------- Yanlış deneme kilidi (IP başına) ----------
function is_locked(string $ip): bool { $f = json_decode(kv_get('fail:' . $ip) ?? '{}', true) ?: []; return ($f['until'] ?? 0) > now_ms(); }
function add_fail(string $ip): void {
    $f = json_decode(kv_get('fail:' . $ip) ?? '{}', true) ?: []; $n = ($f['n'] ?? 0) + 1; $until = $f['until'] ?? 0;
    if ($n >= 5) { $until = now_ms() + 60000; $n = 0; }
    kv_set('fail:' . $ip, json_encode(['n' => $n, 'until' => $until]), 3600000);
}

// ---------- E-posta ----------
function send_mail(string $to, string $subject, string $text): bool {
    $from = (string)cfg('MAIL_FROM', 'noreply@' . preg_replace('/:\d+$/', '', $_SERVER['HTTP_HOST'] ?? 'localhost'));
    $host = (string)cfg('SMTP_HOST', '');
    $subj = '=?UTF-8?B?' . base64_encode($subject) . '?=';
    if ($host === '') {
        $h = "From: $from\r\nContent-Type: text/plain; charset=UTF-8\r\nMIME-Version: 1.0";
        return function_exists('mail') && @mail($to, $subj, $text, $h);
    }
    $port = (int)cfg('SMTP_PORT', 587); $user = (string)cfg('SMTP_USER', ''); $pass = (string)cfg('SMTP_PASS', '');
    $fp = @stream_socket_client(($port === 465 ? 'ssl://' : 'tcp://') . $host . ':' . $port, $en, $es, 10);
    if (!$fp) return false;
    stream_set_timeout($fp, 10);
    $rd = function () use ($fp) { $o = ''; while (($l = fgets($fp, 515)) !== false) { $o .= $l; if (strlen($l) < 4 || $l[3] === ' ') break; } return $o; };
    $cmd = function (string $c, string $ok) use ($fp, $rd) { if ($c !== '') fwrite($fp, $c . "\r\n"); return str_starts_with($rd(), $ok); };
    $ehlo = 'EHLO ' . preg_replace('/:\d+$/', '', $_SERVER['HTTP_HOST'] ?? 'localhost');
    $good = $cmd('', '220') && $cmd($ehlo, '250');
    if ($good && $port !== 465 && $port !== 25) { $good = $cmd('STARTTLS', '220') && stream_socket_enable_crypto($fp, true, STREAM_CRYPTO_METHOD_TLS_CLIENT) && $cmd($ehlo, '250'); }
    if ($good && $user !== '') $good = $cmd('AUTH LOGIN', '334') && $cmd(base64_encode($user), '334') && $cmd(base64_encode($pass), '235');
    if ($good) $good = $cmd("MAIL FROM:<$from>", '250') && $cmd("RCPT TO:<$to>", '25') && $cmd('DATA', '354');
    if ($good) {
        $msg = "From: $from\r\nTo: $to\r\nSubject: $subj\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n" . chunk_split(base64_encode($text));
        fwrite($fp, $msg . "\r\n.\r\n"); $good = str_starts_with($rd(), '250');
    }
    @fwrite($fp, "QUIT\r\n"); fclose($fp);
    return $good;
}

// ---------- Uç noktalar ----------
function h_me(): never { $u = me(); $u ? out(['user' => pub_user($u)]) : fail(401, 'Giriş gerekli.'); }

// Güvenlik sorusu (insan doğrulaması): imzalı, 5 dk geçerli, tek kullanımlık; harici servis yok.
function cap_mac(string $nonce, int $exp, int $ans): string { return b64u(hash_hmac('sha256', 'cap|' . $nonce . '|' . $exp . '|' . $ans, secret(), true)); }
function h_captcha(): never {
    $a = random_int(3, 9); $b = random_int(2, 9); $q = "$a + $b"; $ans = $a + $b;
    $nonce = b64u(random_bytes(9)); $exp = now_ms() + 300000;
    header('Cache-Control: no-store');
    out(['token' => $nonce . '.' . $exp . '.' . cap_mac($nonce, $exp, $ans), 'q' => $q . ' kaç eder?']);
}
function cap_check(array $b): void {
    $t = explode('.', (string)($b['cToken'] ?? '')); $ans = preg_replace('/\s+/', '', (string)($b['cAns'] ?? ''));
    $bad = !empty($b['website']) || count($t) !== 3 || !preg_match('/^\d{1,3}$/', $ans) || !ctype_digit($t[1]);
    if (!$bad) { [$nonce, $exp, $mac] = $t; $bad = (int)$exp < now_ms() || !hash_equals(cap_mac($nonce, (int)$exp, (int)$ans), $mac) || kv_get('cap:' . $nonce) !== null; if (!$bad) kv_set('cap:' . $nonce, '1', 330000); }
    if ($bad) fail(400, 'Güvenlik sorusunu doğru yanıtla.', ['code' => 'captcha']);
}

// ---------- Şifre gücü (public/password.js ile AYNI kurallar; biri değişirse ikisi birlikte değişir) ----------
const PW_MIN = 10, PW_MAX = 64;
const PW_COMMON = ['password', 'parola', 'sifre', 'şifre', 'qwerty', 'asdfgh', 'zxcvbn', '123456', '654321', 'abcdef', 'motolife', 'motosiklet', 'motor', 'admin', 'letmein', 'iloveyou', 'welcome', 'istanbul', 'ankara'];
function pw_lower(string $s): string { return mb_strtolower(strtr($s, ['İ' => 'i', 'I' => 'ı']), 'UTF-8'); }
function pw_seq(string $s): bool {
    $t = preg_replace('/[^\p{L}\p{N}]/u', '', pw_lower($s)); $c = preg_split('//u', (string)$t, -1, PREG_SPLIT_NO_EMPTY) ?: [];
    for ($i = 0; $i + 3 < count($c); $i++) {
        $d = mb_ord($c[$i + 1]) - mb_ord($c[$i]);
        if (($d === 1 || $d === -1) && mb_ord($c[$i + 2]) - mb_ord($c[$i + 1]) === $d && mb_ord($c[$i + 3]) - mb_ord($c[$i + 2]) === $d) return true;
    }
    return false;
}
/** Eksik kuralların kısa adları ([] = güçlü). */
function pw_check(string $pw, string $username = '', string $email = ''): array {
    $bad = []; $n = mb_strlen($pw); $low = pw_lower($pw); $user = pw_lower($username); $mail = pw_lower(explode('@', $email)[0]);
    if ($n < PW_MIN || $n > PW_MAX) $bad[] = 'En az ' . PW_MIN . ' karakter';
    if (!preg_match('/\p{Ll}/u', $pw)) $bad[] = 'Küçük harf';
    if (!preg_match('/\p{Lu}/u', $pw)) $bad[] = 'Büyük harf';
    if (!preg_match('/\p{N}/u', $pw)) $bad[] = 'Rakam';
    if (!preg_match('/[^\p{L}\p{N}\s]/u', $pw)) $bad[] = 'Özel karakter';
    $guess = $pw === '' || (mb_strlen($user) >= 3 && str_contains($low, $user)) || (mb_strlen($mail) >= 3 && str_contains($low, $mail)) || preg_match('/(.)\1\1/u', $pw) || pw_seq($pw);
    if (!$guess) foreach (PW_COMMON as $w) if (str_contains($low, $w)) { $guess = true; break; }
    if ($guess) $bad[] = 'Tahmin edilmesi kolay olmamalı';
    return $bad;
}
function pw_require(string $pw, string $username, string $email): void {
    $bad = pw_check($pw, $username, $email);
    if ($bad) fail(400, 'Şifre yeterince güçlü değil. Eksik: ' . implode(', ', $bad) . '.', ['code' => 'weakpw']);
}

function h_register(): never {
    $b = body(); cap_check($b); $r = read_profile($b, true); $pw = (string)($b['password'] ?? '');
    if (rl('reg:' . client_ip(), (int)cfg('REG_LIMIT', 10), 3600000)) fail(429, 'Çok fazla kayıt denemesi. Bir saat sonra tekrar dene.');
    if (isset($r['error'])) fail(400, $r['error']);
    $f = $r['f'];
    pw_require($pw, $f['username'], $f['email']);
    if (user_by_name($f['username'])) fail(409, 'Bu kullanıcı adı alınmış.');
    if (one('SELECT id FROM ml_users WHERE email = ?', [$f['email']])) fail(409, 'Bu e-posta ile zaten bir hesap var.');
    if (one('SELECT id FROM ml_users WHERE phone = ?', [$f['phone']])) fail(409, 'Bu telefon numarası başka bir hesapta kayıtlı.');
    try { $u = user_insert($f, ['pw_hash' => password_hash($pw, PASSWORD_DEFAULT)]); }
    catch (PDOException $e) { fail(409, 'Bu kullanıcı adı, e-posta ya da telefon zaten kayıtlı.'); }
    start_session($u);
}
function h_login(): never {
    $ip = client_ip(); $b = body(); cap_check($b);
    if (is_locked($ip)) fail(429, 'Çok fazla yanlış deneme. 1 dakika bekle.');
    $k = clean($b['login'] ?? '', 120);
    $u = one('SELECT * FROM ml_users WHERE email = ?', [mb_strtolower($k)]) ?? user_by_name($k);
    if (!$u && ($ph = norm_phone($k))) $u = one('SELECT * FROM ml_users WHERE phone = ?', [$ph]);
    if (!$u || empty($u['pw_hash']) || !password_verify((string)($b['password'] ?? ''), $u['pw_hash'])) { add_fail($ip); fail(401, 'Kullanıcı adı / e-posta veya şifre hatalı.'); }
    start_session($u);
}
function h_logout(): never { clear_session_cookie(); out(['ok' => true]); }

function h_account(): never {
    $u = need_user(); $b = body();
    $r = read_profile(array_merge(pub_user($u), $b));
    if (isset($r['error'])) fail(400, $r['error']);
    $f = $r['f'];
    $byName = user_by_name($f['username']); if ($byName && $byName['id'] !== $u['id']) fail(409, 'Bu kullanıcı adı alınmış.');
    $byMail = one('SELECT id FROM ml_users WHERE email = ?', [$f['email']]); if ($byMail && $byMail['id'] !== $u['id']) fail(409, 'Bu e-posta başka bir hesapta kullanılıyor.');
    if (!empty($u['phone']) && $f['phone'] === '') fail(400, 'Telefon numarası boş bırakılamaz.');
    if ($f['phone'] !== '') { $byPh = one('SELECT id FROM ml_users WHERE phone = ?', [$f['phone']]); if ($byPh && $byPh['id'] !== $u['id']) fail(409, 'Bu telefon numarası başka bir hesapta kayıtlı.'); }
    $newPw = array_key_exists('newPassword', $b) ? (string)$b['newPassword'] : '';
    if ($newPw !== '') pw_require($newPw, (string)$u['username'], $f['email']);
    if (!empty($u['pw_hash']) && ($f['email'] !== $u['email'] || $newPw !== '')) {
        $ip = client_ip();
        if (is_locked($ip)) fail(429, 'Çok fazla yanlış deneme. 1 dakika bekle.');
        if (!password_verify((string)($b['currentPassword'] ?? ''), $u['pw_hash'])) { add_fail($ip); fail(401, 'Mevcut şifre hatalı.'); }
    }
    $set = user_set_cols($f);
    if ($newPw !== '') { $set['pw_hash'] = password_hash($newPw, PASSWORD_DEFAULT); $set['sv'] = (int)$u['sv'] + 1; }
    try { q('UPDATE ml_users SET ' . implode(', ', array_map(fn($k) => "$k = ?", array_keys($set))) . ' WHERE id = ?', [...array_values($set), $u['id']]); }
    catch (PDOException $e) { fail(409, 'Bu kullanıcı adı, e-posta ya da telefon başka bir hesapta kayıtlı.'); }
    $nu = user_by_id($u['id']);
    if ($newPw !== '') set_session_cookie($nu);
    out(['user' => pub_user($nu)]);
}
function h_avatar(): never {
    $u = need_user(); $img = (string)(body(200000)['image'] ?? '');
    if ($img !== '' && (strlen($img) > 90000 || !preg_match('#^data:image/jpeg;base64,[A-Za-z0-9+/=]+$#', $img))) fail(400, 'Fotoğraf geçersiz ya da çok büyük.');
    q('UPDATE ml_users SET avatar = ? WHERE id = ?', [$img, $u['id']]);
    out(['user' => pub_user(user_by_id($u['id']))]);
}
function h_forgot(): never {
    cap_check(body());
    if (rl('forgot:' . client_ip(), 5, 600000)) fail(429, 'Çok fazla istek. Biraz bekleyip tekrar dene.');
    $u = one('SELECT * FROM ml_users WHERE email = ?', [mb_strtolower(clean(body()['email'] ?? '', 120))]);
    if ($u) {
        $token = b64u(random_bytes(32));
        q('UPDATE ml_users SET reset_hash = ?, reset_exp = ? WHERE id = ?', [hash('sha256', $token), now_ms() + 1800000, $u['id']]);
        $link = app_url() . '/?reset=' . $token;
        $ok = send_mail($u['email'], 'Moto Life şifre sıfırlama', 'Merhaba ' . uname($u) . ",\n\nŞifreni sıfırlamak için bu bağlantıyı aç (30 dakika geçerli):\n$link\n\nBu isteği sen yapmadıysan bu e-postayı yok sayabilirsin.");
        if (!$ok) error_log('[moto-life] Şifre sıfırlama e-postası gönderilemedi: ' . $u['email']);
    }
    out(['ok' => true]);
}
function h_reset(): never {
    $b = body(); $pw = (string)($b['password'] ?? '');
    $u = one('SELECT * FROM ml_users WHERE reset_hash = ? AND reset_exp > ?', [hash('sha256', (string)($b['token'] ?? '')), now_ms()]);
    if (!$u) fail(400, 'Bağlantı geçersiz ya da süresi dolmuş. Yeni bir bağlantı iste.');
    pw_require($pw, (string)$u['username'], (string)$u['email']);
    q('UPDATE ml_users SET pw_hash = ?, reset_hash = NULL, reset_exp = 0, sv = sv + 1 WHERE id = ?', [password_hash($pw, PASSWORD_DEFAULT), $u['id']]);
    out(['ok' => true]);
}

// ---------- Hesap silme ----------
function h_account_delete(): never {
    $u = need_user(); $ip = client_ip();
    if (is_locked($ip)) fail(429, 'Çok fazla yanlış deneme. 1 dakika bekle.');
    $b = body();
    if (lower(trim((string)($b['confirm'] ?? ''))) !== lower(uname($u))) fail(400, 'Onay için kullanıcı adını yaz.');
    if (!empty($u['pw_hash']) && !password_verify((string)($b['password'] ?? ''), $u['pw_hash'])) { add_fail($ip); fail(401, 'Şifre hatalı.'); }
    $uid = $u['id'];
    try {
        rg_remove_user($uid);
        social_remove_user($uid);
        q('DELETE FROM ml_rides WHERE uid = ?', [$uid]);
        rt_drop_user($uid);
        q('DELETE FROM ml_users WHERE id = ?', [$uid]);
        q("DELETE FROM ml_pics WHERE kind = 'cover' AND ref = ?", [$uid]);
    } catch (Throwable $e) { error_log('[moto-life] Hesap silinemedi: ' . $e->getMessage()); fail(500, 'Hesap silinirken hata oluştu. Tekrar dene.'); }
    clear_session_cookie();
    out(['ok' => true]);
}
