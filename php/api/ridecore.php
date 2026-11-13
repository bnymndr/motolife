<?php
// public/ride-core.js ve public/telemetry-core.js'in sunucu tarafı PHP karşılığı: gelen sürüşü doğrular ve ham veriden özetini yeniden hesaplar.
// Kurallar JavaScript sürümüyle birebir aynıdır (test/php-api.js iki uygulamanın özetini karşılaştırır).
declare(strict_types=1);

const RC_MAX_ACC = 50, RC_MOVE_MS = 0.8, RC_MAX_SPEED = 83, RC_MAX_ACCEL = 12, RC_GAP_S = 30, RC_GAP_M = 100, RC_CONSEC = 3, RC_MAX_FIXES = 30000;
function rc_num($x): bool { return (is_int($x) || is_float($x)) && is_finite((float)$x); }
function rc_r1(float $v): float { return jsround($v * 10) / 10; }
function rc_r2(float $v): float { return jsround($v * 100) / 100; }
function rc_r6(float $v): float { return jsround($v * 1e6) / 1e6; }
function rc_hav(float $lat1, float $lon1, float $lat2, float $lon2): float {
    $r = M_PI / 180;
    $a = sin(($lat2 - $lat1) * $r / 2) ** 2 + cos($lat1 * $r) * cos($lat2 * $r) * sin(($lon2 - $lon1) * $r / 2) ** 2;
    return 2 * 6371000 * asin(min(1, sqrt($a)));
}

class RcRecorder {
    public string $status = 'idle'; public float $startedAt = 0, $endedAt = 0, $activeMs = 0, $activeSince = 0, $pausedMs = 0, $dist = 0, $movingMs = 0, $max = 0;
    public array $pauses = []; public int $fixes = 0, $rejAcc = 0, $rejJump = 0, $gaps = 0, $reanchors = 0, $consec = 0, $track = 0;
    public bool $limitReached = false; public float $lastFixT = 0;
    public ?array $last = null, $anchor = null; public ?float $speed = null, $prevDisp = null;

    function __construct(public string $id = '') {}
    function start(float $t): bool { if ($this->status !== 'idle') return false; $this->status = 'active'; $this->startedAt = $t; $this->activeSince = $t; return true; }
    function pause(float $t): bool {
        if ($this->status !== 'active') return false;
        $this->activeMs += max(0, $t - $this->activeSince); $this->pauses[] = ['from' => $t, 'to' => null];
        $this->status = 'paused'; $this->reset(); return true;
    }
    function resume(float $t): bool {
        if ($this->status !== 'paused') return false;
        $i = count($this->pauses) - 1; $this->pauses[$i]['to'] = $t; $this->pausedMs += max(0, $t - $this->pauses[$i]['from']);
        $this->activeSince = $t; $this->status = 'active'; return true;
    }
    function end(float $t): bool {
        if ($this->status === 'active') $this->activeMs += max(0, $t - $this->activeSince);
        elseif ($this->status === 'paused') { $i = count($this->pauses) - 1; $this->pauses[$i]['to'] = $t; $this->pausedMs += max(0, $t - $this->pauses[$i]['from']); }
        else return false;
        $this->status = 'ended'; $this->endedAt = $t; return true;
    }
    private function reset(): void { $this->last = null; $this->anchor = null; $this->speed = null; $this->prevDisp = null; $this->consec = 0; }
    private function ref(float $t, float $lat, float $lon, float $acc, ?float $sp): void {
        $this->last = ['lat' => $lat, 'lon' => $lon, 'acc' => $acc, 't' => $t, 'speed' => $sp]; $this->anchor = ['lat' => $lat, 'lon' => $lon, 't' => $t];
        $this->speed = $sp; $this->prevDisp = null; $this->consec = 0; $this->track++;
    }
    function addFix(array $f): void {
        if ($this->status !== 'active') return;
        if ($this->fixes >= RC_MAX_FIXES) { $this->limitReached = true; return; }
        $t = jsround((float)$f['t']); $lat = rc_r6((float)$f['lat']); $lon = rc_r6((float)$f['lon']); $acc = rc_r1((float)$f['acc']);
        if (abs($lat) > 90 || abs($lon) > 180) return;
        if ($t < $this->activeSince - 1000) return;
        $p = $this->last;
        if ($t <= $this->lastFixT) return;
        $sp = ($f['speed'] ?? null) !== null && rc_num($f['speed']) && $f['speed'] >= 0 && $f['speed'] <= RC_MAX_SPEED ? rc_r2((float)$f['speed']) : null;
        $this->fixes++; $this->lastFixT = $t;
        if (!($acc <= RC_MAX_ACC)) { $this->rejAcc++; return; }
        if (!$p) { $this->ref($t, $lat, $lon, $acc, $sp); return; }
        $dt = ($t - $p['t']) / 1000; $d = rc_hav($p['lat'], $p['lon'], $lat, $lon);
        if ($dt > RC_GAP_S && $d > RC_GAP_M) { $this->gaps++; $this->ref($t, $lat, $lon, $acc, $sp); return; }
        $maxD = (max($p['speed'] ?? 0, $sp ?? 0) + RC_MAX_ACCEL * $dt) * $dt + $p['acc'] + $acc + 10;
        if ($dt <= RC_GAP_S && ($d > $maxD || $d / $dt > RC_MAX_SPEED)) {
            $this->rejJump++; $this->consec++;
            if ($this->consec >= RC_CONSEC) { $this->reanchors++; $this->ref($t, $lat, $lon, $acc, $sp); }
            return;
        }
        $this->consec = 0; $disp = $sp; $moving = false;
        if ($sp !== null) {
            if ($sp >= RC_MOVE_MS) { $moving = true; $this->dist += $d; $this->movingMs += min($dt, 30) * 1000; $this->anchor = ['lat' => $lat, 'lon' => $lon, 't' => $t]; }
            else $disp = 0;
        } else {
            $a = $this->anchor ?? ['lat' => $p['lat'], 'lon' => $p['lon'], 't' => $p['t']];
            $da = rc_hav($a['lat'], $a['lon'], $lat, $lon); $dta = max(0.001, ($t - $a['t']) / 1000);
            if ($da > max($acc, 6)) { $moving = true; $this->dist += $da; $this->movingMs += min($dta, 30) * 1000; $disp = $da / $dta; $this->anchor = ['lat' => $lat, 'lon' => $lon, 't' => $t]; }
            else $disp = 0;
        }
        if ($moving && $disp !== null && $acc <= 30 && $disp <= RC_MAX_SPEED && $this->prevDisp !== null && abs($disp - $this->prevDisp) <= 15 * $dt + 2) $this->max = max($this->max, $disp);
        $this->prevDisp = $disp; $this->speed = $disp;
        $this->last = ['lat' => $lat, 'lon' => $lon, 'acc' => $acc, 't' => $t, 'speed' => $sp]; $this->track++;
    }
    function summary(float $now): array {
        $open = $this->status === 'paused' ? $this->pauses[count($this->pauses) - 1] : null;
        $act = $this->activeMs + ($this->status === 'active' ? max(0, $now - $this->activeSince) : 0);
        $pausedMs = $this->pausedMs + ($open ? max(0, $now - $open['from']) : 0);
        $durS = $act / 1000; $movS = min($this->movingMs / 1000, $durS);
        return ['status' => $this->status, 'startedAt' => $this->startedAt, 'endedAt' => $this->endedAt,
            'durationS' => rc_r1($durS), 'movingS' => rc_r1($movS), 'stoppedS' => rc_r1(max(0, $durS - $movS)), 'pausedS' => rc_r1($pausedMs / 1000), 'pauseCount' => count($this->pauses),
            'distM' => rc_r1($this->dist), 'avgTotalKmh' => $durS >= 10 ? rc_r1($this->dist / $durS * 3.6) : null, 'avgMovingKmh' => $movS >= 10 ? rc_r1($this->dist / $movS * 3.6) : null,
            'maxKmh' => $this->max > 0 ? rc_r1($this->max * 3.6) : null, 'points' => $this->track, 'rejectedAcc' => $this->rejAcc, 'rejectedJump' => $this->rejJump,
            'gaps' => $this->gaps, 'reanchors' => $this->reanchors, 'limitReached' => $this->limitReached];
    }
    static function replay(array $data): self {
        $r = new self((string)$data['id']); $fx = $data['fixes']; $j = 0; $nfx = count($fx);
        $feed = function (int $n) use (&$j, $fx, $nfx, $r) { while ($j < $n && $j < $nfx) { $f = $fx[$j++]; $r->addFix(['t' => $f[0], 'lat' => $f[1], 'lon' => $f[2], 'acc' => $f[3], 'speed' => $f[4]]); } };
        foreach ($data['events'] as [$t, $k, $n]) {
            $feed((int)$n);
            if ($k === 'start') $r->start($t); elseif ($k === 'pause') $r->pause($t); elseif ($k === 'resume') $r->resume($t); elseif ($k === 'end') $r->end($t);
        }
        $feed($nfx);
        return $r;
    }
}
function rc_summarize(array $data): array { return RcRecorder::replay($data)->summary((float)($data['endedAt'] ?: now_ms())); }

// Geri dönüş: hata metni ya da null
function rc_validate_ride($d): ?string {
    if (!is_array($d) || ($d['v'] ?? null) !== 1) return 'Sürüş verisi geçersiz.';
    if (!is_string($d['id'] ?? null) || !preg_match('/^r_[a-z0-9]{8,32}$/', $d['id'])) return 'Sürüş kimliği geçersiz.';
    if (!rc_num($d['startedAt'] ?? null) || !rc_num($d['endedAt'] ?? null) || $d['startedAt'] < 1.5e12 || $d['endedAt'] < $d['startedAt'] || $d['endedAt'] > now_ms() + 86400000) return 'Sürüş zamanları geçersiz.';
    $ev = $d['events'] ?? null; $fx = $d['fixes'] ?? null;
    if (!is_array($ev) || !array_is_list($ev) || count($ev) < 2 || count($ev) > 2000) return 'Sürüş olayları geçersiz.';
    if (!is_array($fx) || !array_is_list($fx) || count($fx) > RC_MAX_FIXES) return 'Konum sayısı sınırı aşıldı.';
    $st = 'idle'; $prevN = 0; $nfx = count($fx);
    $trans = ['idle' => ['start' => 'active'], 'active' => ['pause' => 'paused', 'end' => 'ended'], 'paused' => ['resume' => 'active', 'end' => 'ended'], 'ended' => []];
    foreach ($ev as $e) {
        $isInt = is_array($e) && count($e) === 3 && array_is_list($e) && (is_int($e[2]) || (is_float($e[2]) && floor($e[2]) == $e[2]));
        if (!$isInt || !rc_num($e[0]) || !in_array($e[1], ['start', 'pause', 'resume', 'end'], true) || $e[2] < $prevN || $e[2] > $nfx) return 'Sürüş olayları geçersiz.';
        $prevN = $e[2];
        $next = $trans[$st][$e[1]] ?? null;
        if (!$next) return 'Sürüş olay sırası geçersiz.';
        $st = $next;
    }
    if ($st !== 'ended' || $ev[0][0] != $d['startedAt'] || $ev[count($ev) - 1][0] != $d['endedAt']) return 'Sürüş tamamlanmamış.';
    $pt = 0;
    foreach ($fx as $f) {
        if (!is_array($f) || count($f) !== 6 || !array_is_list($f) || !rc_num($f[0]) || !rc_num($f[1]) || !rc_num($f[2]) || !rc_num($f[3]) || ($f[4] !== null && !rc_num($f[4])) || !rc_num($f[5])) return 'Konum kaydı geçersiz.';
        if (abs($f[1]) > 90 || abs($f[2]) > 180 || $f[3] < 0 || $f[3] > 1e5 || $f[0] < $pt || $f[5] < 0 || $f[5] > 3) return 'Konum kaydı geçersiz.';
        $pt = $f[0];
    }
    return null;
}

// ---------- Telemetri ----------
const TC_BRAKE = [3.5, 5.5, 7.5], TC_ACCEL = [3.0, 5.0], TC_MIN_DUR = 350, TC_MIN_LEAN_V = 5, TC_MAX_BINS = 40000, TC_MAX_EVS = 2000;
function tc_fin($x, float $lo, float $hi): bool { return rc_num($x) && $x >= $lo && $x <= $hi; }
function tc_opt($x, float $lo, float $hi): bool { return $x === null || tc_fin($x, $lo, $hi); }
function tc_r3(float $v): float { return jsround($v * 1000) / 1000; }
function tc_vec3($a): ?array { return is_array($a) && count($a) === 3 && array_is_list($a) && tc_fin($a[0], -1.001, 1.001) && tc_fin($a[1], -1.001, 1.001) && tc_fin($a[2], -1.001, 1.001) ? array_map(fn($x) => tc_r3((float)$x), $a) : null; }
function tc_arr($x): array { return is_array($x) ? $x : []; }
function tc_clean_meta($m): array {
    $m = is_array($m) ? $m : []; $c = tc_arr($m['cal'] ?? null); $caps = tc_arr($m['caps'] ?? null); $sy = tc_arr($m['sync'] ?? null); $st = tc_arr($m['status'] ?? null);
    $out = [];
    $out['caps'] = ['gyro' => !empty($caps['gyro']), 'lin' => !empty($caps['lin']), 'rateHz' => tc_opt($caps['rateHz'] ?? null, 0, 1000) ? ($caps['rateHz'] ?? null) : null, 'n' => tc_fin($caps['n'] ?? null, 0, 1e9) ? (int)jsround((float)$caps['n']) : 0];
    $uq = $c['uQ'] ?? null; $fq = $c['fQ'] ?? null;
    $out['cal'] = ['u' => tc_vec3($c['u'] ?? null), 'uAt' => tc_fin($c['uAt'] ?? null, 0, 4e12) ? $c['uAt'] : null, 'uFlipped' => !empty($c['uFlipped']), 'f' => tc_vec3($c['f'] ?? null),
        'fSrc' => in_array($c['fSrc'] ?? null, ['ride', 'saved'], true) ? $c['fSrc'] : null, 'recal' => !empty($c['recal']),
        'gyroOk' => ($c['gyroOk'] ?? null) === true ? true : (($c['gyroOk'] ?? null) === false ? false : null), 'mountMoved' => !empty($c['mountMoved']),
        'uQ' => is_array($uq) ? ['drift' => tc_opt($uq['drift'] ?? null, 0, 180) ? ($uq['drift'] ?? null) : null, 'spread' => tc_opt($uq['spread'] ?? null, 0, 180) ? ($uq['spread'] ?? null) : null, 'n' => tc_fin($uq['n'] ?? null, 0, 1e6) ? $uq['n'] : null] : null,
        'fQ' => is_array($fq) ? ['rho' => tc_opt($fq['rho'] ?? null, 0, 1) ? ($fq['rho'] ?? null) : null, 'ratio' => tc_opt($fq['ratio'] ?? null, 0, 1e6) ? ($fq['ratio'] ?? null) : null, 'n' => tc_fin($fq['n'] ?? null, 0, 1e6) ? $fq['n'] : null] : null];
    $out['sync'] = ['lagMs' => tc_opt($sy['lagMs'] ?? null, -5000, 5000) ? ($sy['lagMs'] ?? null) : null, 'corr' => tc_opt($sy['corr'] ?? null, -1, 1) ? ($sy['corr'] ?? null) : null];
    $out['cover'] = []; $out['status'] = [];
    foreach (['aLon', 'aLat', 'lean', 'yaw'] as $k) {
        $cv = tc_arr(tc_arr($m['cover'] ?? null)[$k] ?? null); $reasons = [];
        if (is_array($cv['reasons'] ?? null)) foreach (array_slice(array_keys($cv['reasons']), 0, 20) as $r) if (is_string($r) && preg_match('/^[a-z-]{1,20}$/', $r) && tc_fin($cv['reasons'][$r], 0, 1e6)) $reasons[$r] = $cv['reasons'][$r];
        $out['cover'][$k] = ['valid' => tc_fin($cv['valid'] ?? null, 0, 1e6) ? $cv['valid'] : 0, 'total' => tc_fin($cv['total'] ?? null, 0, 1e6) ? $cv['total'] : 0, 'reasons' => $reasons ?: new stdClass];
        $s = tc_arr($st[$k] ?? null);
        $out['status'][$k] = ['s' => in_array($s['s'] ?? null, ['measured', 'estimated', 'unavailable', 'unsupported'], true) ? $s['s'] : 'unavailable', 'r' => is_string($s['r'] ?? null) && preg_match('/^[a-z-]{1,20}$/', $s['r']) ? $s['r'] : null];
    }
    $out['noisyS'] = tc_fin($m['noisyS'] ?? null, 0, 1e6) ? $m['noisyS'] : 0;
    $out['th'] = ['brake' => TC_BRAKE, 'accel' => TC_ACCEL, 'minDurMs' => TC_MIN_DUR, 'minLeanV' => TC_MIN_LEAN_V];
    $th = $m['th'] ?? null; $nums = fn($a, $n) => array_values(array_filter(array_map(fn($x) => is_numeric($x) ? (float)$x : NAN, array_slice(array_values($a), 0, $n)), 'is_finite'));
    $out['thClient'] = is_array($th) ? ['brake' => is_array($th['brake'] ?? null) ? $nums($th['brake'], 3) : null, 'accel' => is_array($th['accel'] ?? null) ? $nums($th['accel'], 2) : null] : null;
    return $out;
}
// Geri dönüş: ['err' => metin] | ['tele' => dizi]
function tc_clean_tele($d, array $ride): array {
    if (!is_array($d) || ($d['v'] ?? null) !== 1) return ['err' => 'Telemetri biçimi desteklenmiyor.'];
    if (($d['rideId'] ?? null) !== $ride['id']) return ['err' => 'Telemetri, sürüş kimliğiyle eşleşmiyor.'];
    if (!is_array($d['bins'] ?? null) || !is_array($d['evs'] ?? null)) return ['err' => 'Telemetri satırları eksik.'];
    if (count($d['bins']) > TC_MAX_BINS) return ['err' => 'Telemetri çok uzun.'];
    if (count($d['evs']) > TC_MAX_EVS) return ['err' => 'Telemetri olay sayısı çok fazla.'];
    $lo = $ride['startedAt'] - 60000; $hi = ($ride['endedAt'] ?: now_ms()) + 60000; $bins = []; $evs = []; $last = 0;
    $lim = [[-30, 30], [-30, 30], [-30, 30], [-30, 30], [-90, 90], [-90, 90], [-1500, 1500], [-3000, 3000]];
    foreach ($d['bins'] as $r) {
        if (!is_array($r) || count($r) !== 10 || !array_is_list($r) || !tc_fin($r[0], $lo, $hi) || $r[0] <= $last) return ['err' => 'Telemetri satırı geçersiz (zaman).'];
        for ($i = 0; $i < 8; $i++) if (!tc_opt($r[$i + 1], $lim[$i][0], $lim[$i][1])) return ['err' => 'Telemetri satırı geçersiz (değer).'];
        if (!tc_fin($r[9], 0, 255)) return ['err' => 'Telemetri satırı geçersiz (bayrak).'];
        $last = $r[0]; $bins[] = [(int)jsround((float)$r[0]), ...array_slice($r, 1, 8), (int)jsround((float)$r[9])];
    }
    foreach ($d['evs'] as $e) {
        if (!is_array($e) || count($e) !== 12 || !array_is_list($e) || !tc_fin($e[0], $lo, $hi) || !in_array($e[1], ['b', 'a'], true) || !tc_fin($e[2], 1, 3) || !tc_fin($e[3], 0, 30) || !tc_fin($e[4], 0, 60000) ||
            !tc_opt($e[5], 0, 100) || !tc_opt($e[6], 0, 100) || !tc_fin($e[7], -100, 100) || !in_array($e[8], ['i', 'g'], true) || !tc_fin($e[9], 0, 255) || !tc_opt($e[10], -90, 90) || !tc_opt($e[11], -180, 180)) return ['err' => 'Telemetri olayı geçersiz.'];
        $evs[] = $e;
    }
    return ['tele' => ['v' => 1, 'rideId' => $d['rideId'], 'meta' => tc_clean_meta($d['meta'] ?? null), 'bins' => $bins, 'evs' => $evs]];
}
function tc_summarize(array $t): array {
    $B = $t['bins']; $E = $t['evs']; $m = $t['meta'] ?? [];
    $sum = ['v' => 1, 'bins' => count($B), 'events' => ['brake' => ['n' => 0, 'imu' => 0, 'gps' => 0, 'sev' => [0, 0, 0], 'maxPeak' => null], 'accel' => ['n' => 0, 'imu' => 0, 'gps' => 0, 'sev' => [0, 0, 0], 'maxPeak' => null]]];
    foreach ($E as $e) {
        $k = $e[1] === 'b' ? 'brake' : 'accel'; $o = &$sum['events'][$k]; $o['n']++; $o[$e[8] === 'i' ? 'imu' : 'gps']++; $o['sev'][(int)$e[2] - 1]++;
        $o['maxPeak'] = $o['maxPeak'] === null ? $e[3] : max($o['maxPeak'], $e[3]); unset($o);
    }
    $has = fn($i, $bit = null) => count(array_filter($B, fn($r) => $r[$i] !== null && ($bit === null || ($r[9] & $bit))));
    $lonN = count(array_filter($B, fn($r) => $r[1] !== null)); $latN = count(array_filter($B, fn($r) => $r[3] !== null));
    $leanRows = array_values(array_filter($B, fn($r) => $r[5] !== null && ($r[9] & 4)));
    $ext = function ($i, $f) use ($B) { $b = null; foreach ($B as $r) if ($r[$i] !== null && ($b === null || $f($r[$i], $b))) $b = $r[$i]; return $b; };
    $st = $m['status'] ?? [];
    $stS = fn($k) => $st[$k]['s'] ?? null; $stR = fn($k) => $st[$k]['r'] ?? null;
    $sum['aLon'] = ['state' => $lonN ? (count(array_filter($B, fn($r) => $r[9] & 1)) ? 'measured' : 'estimated') : ($stS('aLon') === 'unsupported' ? 'unsupported' : 'unavailable'), 'secs' => $lonN, 'min' => $ext(2, fn($a, $b) => $a < $b), 'max' => $ext(2, fn($a, $b) => $a > $b)];
    $latAbs = array_map(fn($r) => abs($r[4]), array_filter($B, fn($r) => $r[4] !== null));
    $sum['aLat'] = ['state' => $latN ? 'measured' : ($stS('aLat') === 'unsupported' ? 'unsupported' : 'unavailable'), 'secs' => $latN, 'absMax' => $latN && $latAbs ? max($latAbs) : null];
    $pos = array_filter(array_map(fn($r) => $r[6], $leanRows), fn($x) => $x > 0); $neg = array_filter(array_map(fn($r) => -$r[6], $leanRows), fn($x) => $x > 0);
    $leftMax = $leanRows ? max(0, ...($pos ?: [0])) : null; $rightMax = $leanRows ? max(0, ...($neg ?: [0])) : null;
    $sum['lean'] = ['state' => $leanRows ? 'estimated' : ($stS('lean') === 'unsupported' ? 'unsupported' : 'unavailable'), 'secs' => count($leanRows), 'leftMax' => $leftMax ?: null, 'rightMax' => $rightMax ?: null,
        'over15' => count(array_filter($leanRows, fn($r) => abs($r[6]) >= 15)), 'over30' => count(array_filter($leanRows, fn($r) => abs($r[6]) >= 30)), 'over45' => count(array_filter($leanRows, fn($r) => abs($r[6]) >= 45))];
    $sum['yaw'] = ['state' => $has(7) ? 'measured' : ($stS('yaw') === 'unsupported' ? 'unsupported' : 'unavailable'), 'secs' => $has(7)];
    $sum['reasons'] = ['aLon' => $stR('aLon'), 'aLat' => $stR('aLat'), 'lean' => $stR('lean')];
    $sum['sync'] = !empty($m['sync']) ? ['lagMs' => $m['sync']['lagMs'], 'corr' => $m['sync']['corr']] : null;
    $sum['cal'] = !empty($m['cal']) ? ['calibrated' => !empty($m['cal']['u']), 'fSrc' => $m['cal']['fSrc'] ?: null, 'mountMoved' => !empty($m['cal']['mountMoved']), 'gyroVerified' => ($m['cal']['gyroOk'] ?? null) === true] : null;
    $sum['caps'] = !empty($m['caps']) ? ['gyro' => !empty($m['caps']['gyro']), 'lin' => !empty($m['caps']['lin']), 'rateHz' => $m['caps']['rateHz']] : null;
    return $sum;
}
