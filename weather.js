'use strict';
// HAVA DURUMU: sunucu tarafı vekil + önbellek + yedek sağlayıcı. İstemci tek adresi çağırır: GET /api/weather?lat=&lon=
// Sağlayıcılar (ikisi de ücretsiz, anahtarsız): 1) Open-Meteo  2) MET Norway (api.met.no, CC BY 4.0 — kaynak gösterilir).
// Sıra: taze önbellek (5 dk) → Open-Meteo → MET Norway → bayat önbellek (≤6 sa, "stale" işaretli). Hepsi yoksa 502.
// Çıktı sağlayıcıdan bağımsızdır; olmayan veri null gelir ve istemci uydurmaz (MET'te "hissedilen"/yağış ihtimali yoktur).
const TTL = 5 * 60 * 1000, STALE_MAX = 6 * 3600 * 1000, TIMEOUT = 6000, MAX_CACHE = 500;
const MET_MAP = [[/thunder/, 95], [/heavysnow/, 75], [/snowshowers|lightsnowshowers/, 85], [/lightsnow/, 71], [/snow/, 73], [/sleet/, 67], [/heavyrain/, 65], [/lightrainshowers|lightrain/, 61], [/rainshowers|^rain/, 63], [/fog/, 45], [/partlycloudy/, 2], [/fair/, 1], [/clearsky/, 0], [/cloudy/, 3]];
const metCode = s => { const k = String(s || '').replace(/_(day|night|polartwilight)$/, ''); for (const [re, c] of MET_MAP) if (re.test(k)) return c; return null; };
const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const r1 = v => (v == null ? null : Math.round(v * 10) / 10);

async function getJson(url, headers, fetchF, ms = TIMEOUT) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ms);
  try { const r = await fetchF(url, { headers, signal: ctl.signal }); if (!r.ok) throw new Error('http ' + r.status); return await r.json(); } finally { clearTimeout(t); }
}
// Open-Meteo → ortak biçim. Yerel saat dizgesi + utc_offset_seconds → epoch.
function fromOpenMeteo(j) {
  const c = j && j.current, h = j && j.hourly, off = num(j && j.utc_offset_seconds);
  if (!c || !h || off == null || !Array.isArray(h.time)) throw new Error('openmeteo biçim');
  const ep = s => Date.parse(s + ':00Z') - off * 1000;
  const hourly = h.time.map((t, i) => ({ t: ep(t), temp: num(h.temperature_2m[i]), code: num(h.weather_code[i]), pop: num(h.precipitation_probability && h.precipitation_probability[i]), mm: null }));
  const temp = num(c.temperature_2m); if (temp == null) throw new Error('openmeteo sıcaklık yok');
  return { provider: 'Open-Meteo', attribution: 'Open-Meteo.com', tz: off, current: { t: ep(c.time), temp, feels: num(c.apparent_temperature), code: num(c.weather_code), wind: num(c.wind_speed_10m) }, hourly };
}
// MET Norway → ortak biçim. Saatler UTC (tz null → istemci cihaz saatiyle gösterir); rüzgâr m/sn → km/sa.
function fromMet(j) {
  const ts = j && j.properties && j.properties.timeseries; if (!Array.isArray(ts) || !ts.length) throw new Error('met biçim');
  const row = x => { const d = x.data, i = d.instant.details, n = d.next_1_hours; return { t: Date.parse(x.time), temp: num(i.air_temperature), code: n ? metCode(n.summary && n.summary.symbol_code) : null, wind: i.wind_speed == null ? null : r1(i.wind_speed * 3.6), mm: n && n.details ? num(n.details.precipitation_amount) : null }; };
  const rows = ts.filter(x => x && x.data && x.data.instant && x.data.instant.details).map(row);
  const now = Date.now(), cur = rows.filter(r => r.t <= now + 30 * 60 * 1000).pop() || rows[0];
  if (!cur || cur.temp == null) throw new Error('met sıcaklık yok');
  return { provider: 'MET Norway', attribution: 'MET Norway (CC BY 4.0)', tz: null, current: { t: cur.t, temp: cur.temp, feels: null, code: cur.code, wind: cur.wind }, hourly: rows.filter(r => r.code != null || r.temp != null).map(r => ({ t: r.t, temp: r.temp, code: r.code, pop: null, mm: r.mm })) };
}

function createService({ fetchF = (...a) => fetch(...a), now = () => Date.now(), contact = process.env.WEATHER_CONTACT || process.env.APP_URL || 'moto-life' } = {}) {
  const cache = new Map();   // anahtar → { at, data }
  const inflight = new Map();
  const UA = { 'User-Agent': 'MotoLife/1.0 (' + contact + ')', Accept: 'application/json' };
  const key = (lat, lon) => lat.toFixed(2) + ',' + lon.toFixed(2);
  async function fetchFresh(lat, lon) {
    const errs = [];
    try {
      const q = new URLSearchParams({ latitude: lat, longitude: lon, timezone: 'auto', forecast_days: 2, wind_speed_unit: 'kmh', current: 'temperature_2m,apparent_temperature,weather_code,wind_speed_10m', hourly: 'temperature_2m,weather_code,precipitation_probability' });
      return fromOpenMeteo(await getJson('https://api.open-meteo.com/v1/forecast?' + q, UA, fetchF));
    } catch (e) { errs.push('open-meteo: ' + e.message); }
    try { return fromMet(await getJson('https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=' + lat.toFixed(4) + '&lon=' + lon.toFixed(4), UA, fetchF)); } catch (e) { errs.push('met: ' + e.message); }
    const err = new Error(errs.join(' | ')); err.all = true; throw err;
  }
  async function get(lat, lon) {
    const k = key(lat, lon), hit = cache.get(k), t = now();
    if (hit && t - hit.at < TTL) return { ...hit.data, stale: false, ageMs: t - hit.at };
    if (inflight.has(k)) return inflight.get(k);                       // aynı anda aynı konum: tek dış istek
    const p = (async () => {
      try {
        const data = await fetchFresh(lat, lon); cache.set(k, { at: now(), data });
        if (cache.size > MAX_CACHE) for (const [kk, v] of cache) { if (now() - v.at > STALE_MAX || cache.size > MAX_CACHE) cache.delete(kk); if (cache.size <= MAX_CACHE) break; }
        return { ...data, stale: false, ageMs: 0 };
      } catch (e) {
        if (hit && now() - hit.at < STALE_MAX) return { ...hit.data, stale: true, ageMs: now() - hit.at };
        throw e;
      } finally { inflight.delete(k); }
    })();
    inflight.set(k, p); return p;
  }
  return { get, _cache: cache };
}

module.exports = function mountWeather({ app, userFromCookie, service = createService() }) {
  const hits = new Map();   // kullanıcı → [zamanlar] (dakikada 20 istek)
  app.get('/api/weather', async (req, res) => {
    const u = userFromCookie(req.headers.cookie); if (!u) return res.status(401).json({ error: 'Oturum gerekli.' });
    const t = Date.now(), arr = (hits.get(u.id) || []).filter(x => t - x < 60000); if (arr.length >= 20) return res.status(429).json({ error: 'Çok sık istek.' }); arr.push(t); hits.set(u.id, arr);
    const lat = Number(req.query.lat), lon = Number(req.query.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return res.status(400).json({ error: 'Geçersiz konum.' });
    try { res.set('Cache-Control', 'no-store'); res.json(await service.get(lat, lon)); }
    catch (e) { res.status(502).json({ error: 'Hava durumu şu an alınamadı.' }); }
  });
  return service;
};
module.exports.createService = createService; module.exports.fromOpenMeteo = fromOpenMeteo; module.exports.fromMet = fromMet; module.exports.metCode = metCode;
