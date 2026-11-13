<?php
// Harita servisleri (maps.js karşılığı): istemci yapılandırması, hedef arama (Nominatim) ve rota vekili (Geoapify motosiklet / OpenRouteService / Valhalla).
// Anahtarlar yalnızca sunucuda (config.php) durur; istemciye hiç gönderilmez.
declare(strict_types=1);

const MP_OSM_TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const MP_OSM_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> katkıda bulunanlar';
const MP_PROVIDERS = [
    'geoapify' => ['profile' => 'motorcycle', 'label' => 'Motosiklet rotası', 'avoid' => ['ferries'], 'daily' => 2500, 'attr' => 'Rota: <a href="https://www.geoapify.com/" target="_blank" rel="noopener">Powered by Geoapify</a>'],
    'ors' => ['profile' => 'driving-car', 'label' => 'Araç rotası · motosiklet için optimize değil', 'avoid' => ['highways', 'tolls', 'ferries'], 'daily' => 1500, 'attr' => 'Rota: <a href="https://openrouteservice.org/" target="_blank" rel="noopener">openrouteservice.org</a> (HeiGIT)'],
    'valhalla' => ['profile' => 'motorcycle', 'label' => 'Motosiklet rotası', 'avoid' => ['highways', 'tolls', 'ferries'], 'daily' => 1500, 'attr' => 'Rota: <a href="https://valhalla.github.io/valhalla/" target="_blank" rel="noopener">Valhalla</a> · &copy; OpenStreetMap'],
];
const MP_VAL_TYPES = [1 => 'start', 2 => 'start', 3 => 'start', 4 => 'destination', 5 => 'destination', 6 => 'destination', 7 => 'straight', 8 => 'straight', 9 => 'slightright', 10 => 'right', 11 => 'sharpright',
    12 => 'uturn', 13 => 'uturn', 14 => 'sharpleft', 15 => 'left', 16 => 'slightleft', 17 => 'straight', 18 => 'slightright', 19 => 'slightleft', 20 => 'slightright', 21 => 'slightleft', 22 => 'straight',
    23 => 'slightright', 24 => 'slightleft', 25 => 'merge', 26 => 'roundabout', 27 => 'roundabout', 28 => 'ferry', 29 => 'ferry'];
const MP_ORS_TYPES = [0 => 'left', 1 => 'right', 2 => 'sharpleft', 3 => 'sharpright', 4 => 'slightleft', 5 => 'slightright', 6 => 'straight', 7 => 'roundabout', 8 => 'roundabout', 9 => 'uturn', 10 => 'goal', 11 => 'start', 12 => 'slightleft', 13 => 'slightright'];

class RouteError extends Exception { function __construct(public int $status, string $msg) { parent::__construct($msg); } }

function mp_mod($t): string {
    $s = preg_replace('/[^a-z]/', '', strtolower((string)($t ?? '')));
    if ($s === '') return 'straight';
    foreach (['uturn' => 'uturn', 'roundabout' => 'roundabout', 'ferry' => 'ferry', 'merge' => 'merge'] as $k => $v) if (str_contains($s, $k)) return $v;
    if (str_contains($s, 'destination') || str_contains($s, 'arrive') || str_contains($s, 'goal')) return 'arrive';
    if (str_contains($s, 'start') || str_contains($s, 'depart')) return 'depart';
    $side = str_contains($s, 'left') ? 'left' : (str_contains($s, 'right') ? 'right' : '');
    if ($side === '') return 'straight';
    if (str_contains($s, 'sharp')) return 'sharp-' . $side;
    foreach (['slight', 'keep', 'stay', 'exit', 'ramp'] as $k) if (str_contains($s, $k)) return 'slight-' . $side;
    return $side;
}
function mp_decode_poly(string $str, float $prec): array {
    $out = []; $i = 0; $lat = 0; $lon = 0; $n = strlen($str);
    while ($i < $n) {
        for ($k = 0; $k < 2; $k++) {
            $sh = 0; $r = 0;
            do { $b = ord($str[$i++]) - 63; $r += ($b & 31) * (2 ** $sh); $sh += 5; } while ($b >= 32 && $i < $n + 1 && $i <= $n);
            $d = $r % 2 ? -($r + 1) / 2 : $r / 2;
            if ($k === 0) $lat += $d; else $lon += $d;
        }
        $out[] = [$lat / $prec, $lon / $prec];
    }
    return $out;
}
function mp_clean_steps(array $list): array {
    $o = [];
    foreach ($list as $x) {
        if (!$x || ($x['text'] ?? '') === '' || !is_numeric($x['lat'] ?? null) || !is_numeric($x['lon'] ?? null)) continue;
        $o[] = ['text' => mb_substr((string)$x['text'], 0, 160), 'dist' => (int)jsround((float)($x['dist'] ?? 0)), 'time' => (int)jsround((float)($x['time'] ?? 0)), 'mod' => $x['mod'], 'lat' => round((float)$x['lat'], 6), 'lon' => round((float)$x['lon'], 6)];
        if (count($o) >= 400) break;
    }
    return $o;
}
function mp_simplify(array $pts, float $tol): array {
    $n = count($pts); if ($n < 3) return $pts;
    $kx = 111320 * cos($pts[0][0] * M_PI / 180); $ky = 110540;
    $xy = array_map(fn($p) => [$p[1] * $kx, $p[0] * $ky], $pts); $keep = array_fill(0, $n, false); $keep[0] = $keep[$n - 1] = true;
    $stack = [[0, $n - 1]];
    while ($stack) {
        [$s, $e] = array_pop($stack); $maxD = 0; $idx = -1;
        $ax = $xy[$s][0]; $ay = $xy[$s][1]; $dx = $xy[$e][0] - $ax; $dy = $xy[$e][1] - $ay; $l2 = $dx * $dx + $dy * $dy;
        for ($i = $s + 1; $i < $e; $i++) {
            $t = $l2 ? max(0, min(1, (($xy[$i][0] - $ax) * $dx + ($xy[$i][1] - $ay) * $dy) / $l2)) : 0;
            $d = hypot($xy[$i][0] - ($ax + $t * $dx), $xy[$i][1] - ($ay + $t * $dy));
            if ($d > $maxD) { $maxD = $d; $idx = $i; }
        }
        if ($maxD > $tol && $idx > 0) { $keep[$idx] = true; $stack[] = [$s, $idx]; $stack[] = [$idx, $e]; }
    }
    $o = []; foreach ($pts as $i => $p) if ($keep[$i]) $o[] = $p;
    return $o;
}
function mp_compact(array $pts): array { foreach ([4, 15, 40] as $tol) { $s = mp_simplify($pts, $tol); if (count($s) <= 5000) return $s; } return mp_simplify($pts, 100); }

function mp_state(): array {
    static $st = null; if ($st) return $st;
    $geo = (string)cfg('GEOAPIFY_API_KEY', ''); $ors = (string)cfg('ORS_API_KEY', '');
    $orsBase = rtrim((string)cfg('ORS_BASE_URL', 'https://api.heigit.org/openrouteservice'), '/');
    $valBase = rtrim((string)cfg('VALHALLA_URL', 'https://valhalla1.openstreetmap.de'), '/'); $valOn = strtolower($valBase) !== 'off';
    $want = strtolower((string)cfg('ROUTE_PROVIDER', 'auto'));
    $provider = $want === 'geoapify' ? ($geo ? 'geoapify' : null) : ($want === 'ors' ? ($ors ? 'ors' : null) : ($want === 'valhalla' ? ($valOn ? 'valhalla' : null) : ($geo ? 'geoapify' : ($ors ? 'ors' : ($valOn ? 'valhalla' : null)))));
    $P = $provider ? MP_PROVIDERS[$provider] : null;
    return $st = ['geo' => $geo, 'ors' => $ors, 'orsBase' => $orsBase, 'valBase' => $valBase, 'valOn' => $valOn, 'want' => $want, 'provider' => $provider, 'P' => $P,
        'dailyTotal' => (int)cfg('ROUTE_DAILY_LIMIT', 0) ?: ($P ? $P['daily'] : 0), 'dailyUser' => (int)cfg('ROUTE_USER_DAILY', 0) ?: 100,
        'ua' => 'MotoLife/1.0 (' . (cfg('APP_URL', '') ?: 'yerel gelistirme') . ')'];
}
function h_maps_config(): never {
    need_user(); $s = mp_state(); $P = $s['P']; $tile = (string)cfg('MAP_TILE_URL', MP_OSM_TILES);
    out(['tileUrl' => $tile, 'tileUrlDark' => (string)cfg('MAP_TILE_URL_DARK', ''), 'tileAttr' => (string)cfg('MAP_TILE_ATTRIBUTION', MP_OSM_ATTR), 'tileMax' => 19,
        'tileRetina' => (bool)preg_match('/@2x|\{r\}/', $tile), 'routing' => (bool)$P,
        'route' => $P ? ['provider' => $s['provider'], 'profile' => $P['profile'], 'label' => $P['label'], 'avoid' => $P['avoid'], 'attr' => $P['attr']] : null]);
}
function mp_num($v): float { return ($v === '' || $v === null || !is_numeric($v)) ? NAN : (float)$v; }
function mp_ok_lat(float $v): bool { return is_finite($v) && $v >= -90 && $v <= 90; }
function mp_ok_lon(float $v): bool { return is_finite($v) && $v >= -180 && $v <= 180; }

function h_geocode(): never {
    $u = need_user(); $q = trim(preg_replace('/\s+/u', ' ', (string)($_GET['q'] ?? '')));
    if (mb_strlen($q) < 3 || mb_strlen($q) > 120) fail(400, 'En az 3 karakter yaz.');
    if (rl('geo:' . $u['id'], 20, 60000)) fail(429, 'Çok sık arama yaptın. Biraz bekle.');
    $lat = mp_num($_GET['lat'] ?? null); $lon = mp_num($_GET['lon'] ?? null); $near = mp_ok_lat($lat) && mp_ok_lon($lon);
    $key = 'geo:' . md5(mb_strtolower($q) . ($near ? '|' . (int)round($lat * 2) . '|' . (int)round($lon * 2) : ''));
    if (($hit = kv_get($key)) !== null) out(['results' => json_decode($hit, true)]);
    $p = ['q' => $q, 'format' => 'jsonv2', 'limit' => '6', 'accept-language' => 'tr', 'addressdetails' => '0'];
    if ($near) $p['viewbox'] = implode(',', array_map(fn($v) => number_format($v, 4, '.', ''), [$lon - 1, $lat + 1, $lon + 1, $lat - 1]));
    $slot = max(now_ms(), (int)(kv_get('nom:slot') ?? 0) + 1100);                 // Nominatim politikası: tüm uygulama için saniyede en fazla 1 istek
    if ($slot - now_ms() > 4000) fail(429, 'Arama servisi şu an yoğun. Biraz bekle.');
    kv_set('nom:slot', (string)$slot, 60000);
    if ($slot > now_ms()) usleep(($slot - now_ms()) * 1000);
    $r = http_json('https://nominatim.openstreetmap.org/search?' . http_build_query($p), ['User-Agent: ' . mp_state()['ua']]);
    if (!$r['ok'] || !is_array($r['body'])) fail(502, $r['status'] === 0 ? 'Arama servisine ulaşılamadı.' : 'Arama servisi şu an yanıt vermiyor.');
    $results = [];
    foreach ($r['body'] as $x) {
        $full = (string)($x['display_name'] ?? ''); $la = (float)($x['lat'] ?? NAN); $lo = (float)($x['lon'] ?? NAN);
        if (!is_numeric($x['lat'] ?? null) || !mp_ok_lat($la) || !mp_ok_lon($lo)) continue;
        $results[] = ['title' => mb_substr((string)($x['name'] ?? '') !== '' ? (string)$x['name'] : trim(explode(',', $full)[0]), 0, 80), 'subtitle' => mb_substr($full, 0, 160), 'lat' => $la, 'lon' => $lo];
    }
    kv_set($key, json_encode($results), 6 * 3600000);
    out(['results' => $results]);
}

// ---------- Rota sağlayıcıları ----------
function mp_via_geoapify(array $a, array $b, array $avoid): array {
    $s = mp_state();
    $p = ['waypoints' => "{$a[0]},{$a[1]}|{$b[0]},{$b[1]}", 'mode' => 'motorcycle', 'format' => 'geojson', 'lang' => 'tr', 'details' => 'instruction_details', 'apiKey' => $s['geo']];
    if ($avoid) $p['avoid'] = implode('|', $avoid);
    $r = http_json('https://api.geoapify.com/v1/routing?' . http_build_query($p), [], 15);
    $f = $r['ok'] ? ($r['body']['features'][0] ?? null) : null;
    if (!$f || !is_array($f['geometry']['coordinates'] ?? null)) {
        if (in_array($r['status'], [401, 403], true)) warn_once('Geoapify anahtarı reddedildi (HTTP ' . $r['status'] . ').');
        if ($r['status'] === 429) throw new RouteError(429, 'Rota servisinin günlük kotası doldu. Daha sonra tekrar dene.');
        if (in_array($r['status'], [400, 404], true)) throw new RouteError(404, 'Bu iki nokta arasında rota bulunamadı. Hedefi bir yola daha yakın seç.');
        throw new RouteError(502, 'Rota servisi şu an yanıt vermiyor.');
    }
    $lines = $f['geometry']['type'] === 'MultiLineString' ? $f['geometry']['coordinates'] : [$f['geometry']['coordinates']]; $pts = [];
    foreach ($lines as $l) foreach ($l as $c) { $qq = [$c[1], $c[0]]; $last = end($pts); if (!$last || $last[0] !== $qq[0] || $last[1] !== $qq[1]) $pts[] = $qq; }
    $pr = $f['properties'] ?? []; $steps = [];
    foreach (is_array($pr['legs'] ?? null) ? $pr['legs'] : [] as $li => $leg) {
        $line = $lines[$li] ?? $lines[0] ?? [];
        foreach ($leg['steps'] ?? [] as $st) {
            $c = $line[(int)($st['from_index'] ?? -1)] ?? null; $ins = $st['instruction'] ?? [];
            if ($c) $steps[] = ['text' => $ins['text'] ?? '', 'dist' => $st['distance'] ?? 0, 'time' => $st['time'] ?? 0, 'mod' => mp_mod($ins['type'] ?? null), 'lat' => $c[1], 'lon' => $c[0]];
        }
    }
    return ['distance' => (float)($pr['distance'] ?? 0), 'duration' => (float)($pr['time'] ?? 0), 'coords' => $pts, 'toll' => !empty($pr['toll']), 'ferry' => !empty($pr['ferry']), 'steps' => mp_clean_steps($steps)];
}
function mp_via_ors(array $a, array $b, array $avoid): array {
    $s = mp_state();
    $body = ['coordinates' => [[$a[1], $a[0]], [$b[1], $b[0]]], 'instructions' => true, 'language' => 'tr', 'units' => 'm'];
    if ($avoid) $body['options'] = ['avoid_features' => array_map(fn($x) => $x === 'tolls' ? 'tollways' : $x, $avoid)];
    $r = http_json($s['orsBase'] . '/v2/directions/driving-car/geojson', ['Authorization: ' . $s['ors'], 'Content-Type: application/json', 'Accept: application/geo+json'], 15, 'POST', json_encode($body));
    $f = $r['ok'] ? ($r['body']['features'][0] ?? null) : null;
    if (!$f || !is_array($f['geometry']['coordinates'] ?? null)) {
        $err = $r['body']['error'] ?? null; $msg = is_array($err) ? (string)($err['message'] ?? '') : (string)$err;
        if (in_array($r['status'], [401, 403], true)) warn_once('OpenRouteService anahtarı/adresi reddedildi (HTTP ' . $r['status'] . '). Anahtarın api.heigit.org için geçerli olduğunu kontrol et.');
        if ($r['status'] === 429) throw new RouteError(429, 'Rota servisinin kotası doldu. Biraz sonra tekrar dene.');
        if ($r['status'] === 404 || (is_array($err) && ($err['code'] ?? null) === 2010)) {
            preg_match('/coordinate (\d)/', $msg, $m);
            throw new RouteError(404, ($m[1] ?? '') === '0' ? 'Bulunduğun konumun yakınında yol bulunamadı.' : (($m[1] ?? '') === '1' ? 'Seçtiğin hedefin yakınında yol bulunamadı. Hedefi bir yola daha yakın seç.' : 'Bu iki nokta arasında rota bulunamadı.'));
        }
        throw new RouteError(502, 'Rota servisi şu an yanıt vermiyor.');
    }
    $sm = $f['properties']['summary'] ?? []; $cs = $f['geometry']['coordinates']; $steps = [];
    foreach ($f['properties']['segments'] ?? [] as $seg) foreach ($seg['steps'] ?? [] as $st) {
        $c = $cs[$st['way_points'][0] ?? -1] ?? null;
        if ($c) $steps[] = ['text' => $st['instruction'] ?? '', 'dist' => $st['distance'] ?? 0, 'time' => $st['duration'] ?? 0, 'mod' => mp_mod(MP_ORS_TYPES[$st['type'] ?? -1] ?? null), 'lat' => $c[1], 'lon' => $c[0]];
    }
    return ['distance' => (float)($sm['distance'] ?? 0), 'duration' => (float)($sm['duration'] ?? 0), 'coords' => array_map(fn($c) => [$c[1], $c[0]], $cs), 'toll' => null, 'ferry' => null, 'steps' => mp_clean_steps($steps)];
}
function mp_via_valhalla(array $a, array $b, array $avoid): array {
    $s = mp_state(); $mc = [];
    if (in_array('highways', $avoid, true)) $mc['use_highways'] = 0; if (in_array('tolls', $avoid, true)) $mc['use_tolls'] = 0; if (in_array('ferries', $avoid, true)) $mc['use_ferry'] = 0;
    $body = ['locations' => [['lat' => $a[0], 'lon' => $a[1]], ['lat' => $b[0], 'lon' => $b[1]]], 'costing' => 'motorcycle', 'costing_options' => ['motorcycle' => $mc ?: new stdClass],
        'directions_options' => ['language' => 'tr-TR', 'units' => 'kilometers']];
    $r = http_json($s['valBase'] . '/route', ['Content-Type: application/json', 'User-Agent: ' . $s['ua']], 15, 'POST', json_encode($body));
    $trip = $r['ok'] ? ($r['body']['trip'] ?? null) : null; $leg = is_array($trip) ? ($trip['legs'][0] ?? null) : null;
    if (!$leg || !is_string($leg['shape'] ?? null)) {
        $code = $r['body']['error_code'] ?? null;
        if ($r['status'] === 429) throw new RouteError(429, 'Rota servisi şu an yoğun. Biraz sonra tekrar dene.');
        if ($r['status'] === 400 && in_array($code, [442, 171, 170, 443], true)) throw new RouteError(404, 'Seçtiğin nokta ile arasında yol bulunamadı. Hedefi bir yola daha yakın seç.');
        throw new RouteError(502, 'Rota servisi şu an yanıt vermiyor.');
    }
    $pts = mp_decode_poly($leg['shape'], 1e6); $sm = $trip['summary'] ?? []; $steps = [];
    foreach ($leg['maneuvers'] ?? [] as $m) {
        $c = $pts[$m['begin_shape_index'] ?? -1] ?? null;
        if ($c) $steps[] = ['text' => $m['instruction'] ?? '', 'dist' => ((float)($m['length'] ?? 0)) * 1000, 'time' => $m['time'] ?? 0, 'mod' => mp_mod(MP_VAL_TYPES[$m['type'] ?? -1] ?? null), 'lat' => $c[0], 'lon' => $c[1]];
    }
    $tri = fn($k) => ($sm[$k] ?? null) === true ? true : (($sm[$k] ?? null) === false ? false : null);
    return ['distance' => ((float)($sm['length'] ?? 0)) * 1000, 'duration' => (float)($sm['time'] ?? 0), 'coords' => $pts, 'toll' => $tri('has_toll'), 'ferry' => $tri('has_ferry'), 'steps' => mp_clean_steps($steps)];
}
function mp_spend(string $uid, int $cost): ?string {
    $s = mp_state(); $day = gmdate('Y-m-d'); $tk = 'rtd:' . $day; $uk = 'rtu:' . $day . ':' . $uid;
    $mine = (int)(kv_get($uk) ?? 0); $total = (int)(kv_get($tk) ?? 0);
    if ($mine >= $s['dailyUser']) return 'Bugünlük rota hakkın doldu. Yarın tekrar dene.';
    if ($total + $cost > $s['dailyTotal']) return 'Rota servisinin günlük kotası doldu. Daha sonra tekrar dene.';
    kv_set($tk, (string)($total + $cost), 172800000); kv_set($uk, (string)($mine + 1), 172800000);
    return null;
}
function h_route(): never {
    $u = need_user(); $s = mp_state(); $P = $s['P'];
    if (!$P) fail(503, 'Rota servisi yapılandırılmadı.', ['code' => 'not_configured']);
    $a = array_map('mp_num', explode(',', (string)($_GET['from'] ?? ''))); $b = array_map('mp_num', explode(',', (string)($_GET['to'] ?? '')));
    if (count($a) !== 2 || count($b) !== 2 || !mp_ok_lat($a[0]) || !mp_ok_lon($a[1]) || !mp_ok_lat($b[0]) || !mp_ok_lon($b[1])) fail(400, 'Geçersiz koordinat.');
    if (rl('rt:' . $u['id'], 12, 60000)) fail(429, 'Çok sık rota istedin. Biraz bekle.');
    $asked = array_values(array_unique(array_filter(array_map('trim', explode(',', (string)($_GET['avoid'] ?? ''))), fn($x) => in_array($x, ['highways', 'tolls', 'ferries'], true))));
    $avoid = array_values(array_filter($asked, fn($x) => in_array($x, $P['avoid'], true))); $ignored = array_values(array_filter($asked, fn($x) => !in_array($x, $P['avoid'], true)));
    $sorted = $avoid; sort($sorted);
    $key = 'rtc:' . md5($s['provider'] . '|' . implode('>', array_map(fn($c) => implode(',', array_map(fn($v) => number_format($v, 4, '.', ''), $c)), [$a, $b])) . '|' . implode(',', $sorted));
    if (($hit = kv_get($key)) !== null) out(json_decode($hit, true) + ['ignoredAvoid' => $ignored, 'cached' => true]);
    if ($over = mp_spend($u['id'], 1 + ($s['provider'] === 'geoapify' ? count($avoid) : 0))) fail(429, $over);
    $via = ['geoapify' => 'mp_via_geoapify', 'ors' => 'mp_via_ors', 'valhalla' => 'mp_via_valhalla'];
    try {
        $used = $s['provider'];
        try { $r = $via[$used]($a, $b, $avoid); }
        catch (RouteError $e) {                                          // sağlayıcı çöktü/yanıtsız (502): anahtarsız yedeğe düş; "rota yok"/kota hatalarında düşme
            if ($e->status !== 502 || $used === 'valhalla' || !$s['valOn'] || $s['want'] !== 'auto') throw $e;
            $used = 'valhalla'; $r = mp_via_valhalla($a, $b, array_values(array_filter($avoid, fn($x) => in_array($x, MP_PROVIDERS['valhalla']['avoid'], true))));
        }
        $U = MP_PROVIDERS[$used];
        $outp = ['provider' => $used, 'profile' => $U['profile'], 'label' => $U['label'], 'attr' => $U['attr'], 'distance' => $r['distance'], 'duration' => $r['duration'], 'toll' => $r['toll'], 'ferry' => $r['ferry'],
            'avoid' => $avoid, 'coords' => mp_compact($r['coords']), 'steps' => $r['steps']];
        kv_set($key, json_encode($outp, JSON_PRESERVE_ZERO_FRACTION), 300000);
        out($outp + ['ignoredAvoid' => $ignored]);
    } catch (RouteError $e) { fail($e->status, $e->getMessage()); }
    catch (Throwable $e) { fail(502, 'Rota servisine ulaşılamadı.'); }
}
