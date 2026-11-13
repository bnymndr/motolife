<?php
// Hava durumu vekili (weather.js karşılığı): önbellek (5 dk) → Open-Meteo → MET Norway → bayat önbellek (≤6 sa, "stale" işaretli).
declare(strict_types=1);

const WX_TTL = 300000, WX_STALE_MAX = 21600000, WX_TIMEOUT = 6;
const WX_MET_MAP = [['/thunder/', 95], ['/heavysnow/', 75], ['/snowshowers|lightsnowshowers/', 85], ['/lightsnow/', 71], ['/snow/', 73], ['/sleet/', 67], ['/heavyrain/', 65], ['/lightrainshowers|lightrain/', 61],
    ['/rainshowers|^rain/', 63], ['/fog/', 45], ['/partlycloudy/', 2], ['/fair/', 1], ['/clearsky/', 0], ['/cloudy/', 3]];
function wx_met_code($s): ?int {
    $k = preg_replace('/_(day|night|polartwilight)$/', '', (string)($s ?? ''));
    foreach (WX_MET_MAP as [$re, $c]) if (preg_match($re, $k)) return $c;
    return null;
}
function wx_n($v): ?float { return (is_int($v) || is_float($v)) && is_finite((float)$v) ? (float)$v : null; }
function wx_r1(?float $v): ?float { return $v === null ? null : jsround($v * 10) / 10; }
function wx_ep(string $s, float $off): int { return (int)(strtotime($s . ':00Z') * 1000 - $off * 1000); }
function wx_from_open_meteo($j): array {
    $c = $j['current'] ?? null; $h = $j['hourly'] ?? null; $off = wx_n($j['utc_offset_seconds'] ?? null);
    if (!is_array($c) || !is_array($h) || $off === null || !is_array($h['time'] ?? null)) throw new RuntimeException('openmeteo biçim');
    $hourly = [];
    foreach ($h['time'] as $i => $t) $hourly[] = ['t' => wx_ep($t, $off), 'temp' => wx_n($h['temperature_2m'][$i] ?? null), 'code' => wx_n($h['weather_code'][$i] ?? null) === null ? null : (int)$h['weather_code'][$i],
        'pop' => wx_n($h['precipitation_probability'][$i] ?? null), 'mm' => null];
    $temp = wx_n($c['temperature_2m'] ?? null); if ($temp === null) throw new RuntimeException('openmeteo sıcaklık yok');
    $code = wx_n($c['weather_code'] ?? null);
    return ['provider' => 'Open-Meteo', 'attribution' => 'Open-Meteo.com', 'tz' => (int)$off,
        'current' => ['t' => wx_ep($c['time'], $off), 'temp' => $temp, 'feels' => wx_n($c['apparent_temperature'] ?? null), 'code' => $code === null ? null : (int)$code, 'wind' => wx_n($c['wind_speed_10m'] ?? null)], 'hourly' => $hourly];
}
function wx_from_met($j): array {
    $ts = $j['properties']['timeseries'] ?? null; if (!is_array($ts) || !$ts) throw new RuntimeException('met biçim');
    $rows = [];
    foreach ($ts as $x) {
        if (!isset($x['data']['instant']['details'])) continue;
        $d = $x['data']; $i = $d['instant']['details']; $n = $d['next_1_hours'] ?? null;
        $rows[] = ['t' => (int)(strtotime($x['time']) * 1000), 'temp' => wx_n($i['air_temperature'] ?? null), 'code' => $n ? wx_met_code($n['summary']['symbol_code'] ?? null) : null,
            'wind' => wx_n($i['wind_speed'] ?? null) === null ? null : wx_r1((float)$i['wind_speed'] * 3.6), 'mm' => $n && isset($n['details']) ? wx_n($n['details']['precipitation_amount'] ?? null) : null];
    }
    $now = now_ms(); $cur = null;
    foreach ($rows as $r) if ($r['t'] <= $now + 1800000) $cur = $r;
    $cur = $cur ?? ($rows[0] ?? null);
    if (!$cur || $cur['temp'] === null) throw new RuntimeException('met sıcaklık yok');
    return ['provider' => 'MET Norway', 'attribution' => 'MET Norway (CC BY 4.0)', 'tz' => null, 'current' => ['t' => $cur['t'], 'temp' => $cur['temp'], 'feels' => null, 'code' => $cur['code'], 'wind' => $cur['wind']],
        'hourly' => array_values(array_map(fn($r) => ['t' => $r['t'], 'temp' => $r['temp'], 'code' => $r['code'], 'pop' => null, 'mm' => $r['mm']], array_filter($rows, fn($r) => $r['code'] !== null || $r['temp'] !== null)))];
}
function wx_fetch_fresh(float $lat, float $lon): array {
    $ua = ['User-Agent: MotoLife/1.0 (' . (cfg('WEATHER_CONTACT', '') ?: cfg('APP_URL', '') ?: 'moto-life') . ')'];
    $errs = [];
    try {
        $q = http_build_query(['latitude' => $lat, 'longitude' => $lon, 'timezone' => 'auto', 'forecast_days' => 2, 'wind_speed_unit' => 'kmh',
            'current' => 'temperature_2m,apparent_temperature,weather_code,wind_speed_10m', 'hourly' => 'temperature_2m,weather_code,precipitation_probability']);
        $r = http_json('https://api.open-meteo.com/v1/forecast?' . $q, $ua, WX_TIMEOUT);
        if (!$r['ok']) throw new RuntimeException('http ' . $r['status']);
        return wx_from_open_meteo($r['body']);
    } catch (Throwable $e) { $errs[] = 'open-meteo: ' . $e->getMessage(); }
    try {
        $r = http_json('https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=' . number_format($lat, 4, '.', '') . '&lon=' . number_format($lon, 4, '.', ''), $ua, WX_TIMEOUT);
        if (!$r['ok']) throw new RuntimeException('http ' . $r['status']);
        return wx_from_met($r['body']);
    } catch (Throwable $e) { $errs[] = 'met: ' . $e->getMessage(); }
    throw new RuntimeException(implode(' | ', $errs));
}
function h_weather(): never {
    $u = need_user();
    if (rl('wx:' . $u['id'], 20, 60000)) fail(429, 'Çok sık istek.');
    $la = $_GET['lat'] ?? null; $lo = $_GET['lon'] ?? null;
    if (!is_numeric($la) || !is_numeric($lo) || abs((float)$la) > 90 || abs((float)$lo) > 180) fail(400, 'Geçersiz konum.');
    $lat = (float)$la; $lon = (float)$lo;
    $key = 'wx:' . number_format($lat, 2, '.', '') . ',' . number_format($lon, 2, '.', '');
    $hit = json_decode(kv_get($key) ?? 'null', true); $t = now_ms();
    header('Cache-Control: no-store');
    if ($hit && $t - $hit['at'] < WX_TTL) out($hit['data'] + ['stale' => false, 'ageMs' => $t - $hit['at']]);
    try {
        $data = wx_fetch_fresh($lat, $lon);
        kv_set($key, json_encode(['at' => now_ms(), 'data' => $data], JSON_PRESERVE_ZERO_FRACTION), WX_STALE_MAX);
        out($data + ['stale' => false, 'ageMs' => 0]);
    } catch (Throwable $e) {
        if ($hit && now_ms() - $hit['at'] < WX_STALE_MAX) out($hit['data'] + ['stale' => true, 'ageMs' => now_ms() - $hit['at']]);
        fail(502, 'Hava durumu şu an alınamadı.');
    }
}
