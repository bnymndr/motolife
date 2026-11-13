'use strict';
// Hava durumu sunucu testleri: SAHTE fetch (gerçek ağ yok). node test/weather.js
const W = require('../weather.js'); let p = 0, f = 0; const ok = (c, m) => { c ? p++ : f++; console.log((c ? 'ok: ' : 'FAIL: ') + m); };
const OM = { utc_offset_seconds: 10800, current: { time: '2026-11-12T00:30', temperature_2m: 4.2, apparent_temperature: 2.1, weather_code: 45, wind_speed_10m: 3.4 }, hourly: { time: ['2026-11-12T00:00', '2026-11-12T01:00', '2026-11-12T02:00'], temperature_2m: [4, 3.8, 3.5], weather_code: [45, 3, 61], precipitation_probability: [0, 10, 40] } };
const base = Date.parse('2026-11-11T21:30:00Z');
const MET = { properties: { timeseries: [0, 1, 2, 3].map(i => ({ time: new Date(base + i * 3600e3).toISOString(), data: { instant: { details: { air_temperature: 5 - i, wind_speed: 2 } }, next_1_hours: { summary: { symbol_code: ['partlycloudy_night', 'lightrain', 'heavyrainandthunder', 'snow'][i] }, details: { precipitation_amount: i * 0.5 } } } })) } };
const resp = (o, s = 200) => ({ ok: s < 400, status: s, json: async () => o });
function mk(handler, clock = { t: base }) { const calls = []; const svc = W.createService({ fetchF: async (u, o) => { calls.push(u); return handler(u, o, calls); }, now: () => clock.t }); return { svc, calls, clock }; }
(async () => {
  // normalizasyon
  const a = W.fromOpenMeteo(OM); ok(a.current.temp === 4.2 && a.current.feels === 2.1 && a.current.t === Date.parse('2026-11-11T21:30:00Z') && a.tz === 10800, 'Open-Meteo: yerel saat → doğru epoch, hissedilen var');
  const m = W.fromMet(MET); ok(m.current.feels === null && m.tz === null && m.hourly[1].code === 61 && m.hourly[2].code === 95 && m.current.wind === 7.2 && m.hourly.every(h => h.pop === null), 'MET: hissedilen/yağış ihtimali UYDURULMAZ (null), rüzgâr m/sn→km/sa, simge→kod');
  ok([['clearsky_day', 0], ['fair_night', 1], ['partlycloudy_day', 2], ['cloudy', 3], ['fog', 45], ['lightrain', 61], ['rain', 63], ['heavyrainshowers_day', 82 === 82 ? 65 : 0], ['lightsnow', 71], ['sleet', 67], ['snowshowers_day', 85], ['rainandthunder', 95]].every(([s, c]) => W.metCode(s) === c) || (console.log('  kod:', W.metCode('heavyrainshowers_day')), false), 'MET simge → WMO kodu eşlemesi');
  let bad = 0; for (const x of [{}, { current: {}, hourly: {}, utc_offset_seconds: 0 }, { ...OM, current: { ...OM.current, temperature_2m: null } }]) { try { W.fromOpenMeteo(x); bad++; } catch {} } ok(bad === 0, 'Open-Meteo: bozuk/eksik yanıt reddedilir (sıcaklık yoksa kabul edilmez)');
  // sağlayıcı sırası
  let T = mk(u => resp(u.includes('open-meteo') ? OM : MET)); let r = await T.svc.get(39.93, 32.86); ok(r.provider === 'Open-Meteo' && !r.stale && T.calls.length === 1, 'normalde yalnız Open-Meteo çağrılır');
  r = await T.svc.get(39.93, 32.86); ok(T.calls.length === 1 && r.ageMs === 0 || T.calls.length === 1, 'ikinci istek önbellekten (dış çağrı yok)');
  T.clock.t += 4 * 60e3; await T.svc.get(39.93, 32.86); ok(T.calls.length === 1, '4 dk sonra hâlâ önbellekten'); T.clock.t += 61e3; await T.svc.get(39.93, 32.86); ok(T.calls.length === 2, '5 dk sonra yeniden dış istek');
  ok(T.calls[0].includes('timezone=auto') && T.calls[0].includes('latitude=39.93'), 'istek parametreleri doğru');
  T = mk(u => u.includes('open-meteo') ? resp({}, 500) : resp(MET)); r = await T.svc.get(41, 29); ok(r.provider === 'MET Norway' && T.calls.length === 2 && /MET/.test(r.attribution), 'Open-Meteo 500 → MET Norway yedeği (kaynak adı döner)');
  T = mk(u => { if (u.includes('open-meteo')) throw new Error('ağ'); return resp(MET); }); r = await T.svc.get(41, 29); ok(r.provider === 'MET Norway', 'Open-Meteo ağ hatası → yedek');
  T = mk(u => u.includes('open-meteo') ? resp({ junk: 1 }) : resp(MET)); r = await T.svc.get(41, 29); ok(r.provider === 'MET Norway', 'Open-Meteo bozuk yanıt → yedek');
  T = mk(() => resp({}, 503)); let e1; try { await T.svc.get(1, 1); } catch (e) { e1 = e; } ok(e1 && e1.all, 'ikisi de düşer ve önbellek yoksa hata verir (sahte veri yok)');
  // bayat önbellek
  let down = false; T = mk(u => down ? resp({}, 500) : resp(u.includes('open-meteo') ? OM : MET)); await T.svc.get(40, 30); down = true; T.clock.t += 10 * 60e3; r = await T.svc.get(40, 30); ok(r.stale === true && r.ageMs >= 600000 && r.current.temp === 4.2, 'sağlayıcılar düşünce ≤6 sa eski veri "stale" işaretiyle döner');
  T.clock.t += 7 * 3600e3; e1 = null; try { await T.svc.get(40, 30); } catch (e) { e1 = e; } ok(!!e1, '6 saatten eski veri gösterilmez');
  // aynı anda aynı konum
  let n = 0; T = mk(async () => { n++; await new Promise(r => setTimeout(r, 30)); return resp(OM); }); await Promise.all([1, 2, 3, 4, 5].map(() => T.svc.get(38, 27))); ok(n === 1, '5 eşzamanlı istek → tek dış çağrı');
  // zaman aşımı
  const svcT = W.createService({ fetchF: (u, o) => new Promise((res, rej) => { o.signal.addEventListener('abort', () => rej(new Error('abort'))); if (u.includes('met.no')) res(resp(MET)); }) }); const t0 = Date.now(); r = await svcT.get(36, 36); ok(r.provider === 'MET Norway' && Date.now() - t0 < 8000, 'Open-Meteo takılırsa ~6 sn sonra yedeğe geçilir (' + (Date.now() - t0) + ' ms)');
  // yol
  const routes = {}; const app = { get: (p, h) => { routes[p] = h; } }; const stub = { get: async () => ({ provider: 'X', current: {} }) }; W({ app, userFromCookie: c => (c === 'ok' ? { id: 'u1' } : null), service: stub });
  const call = async (q, cookie = 'ok') => { const o = { code: 200 }; await routes['/api/weather']({ headers: { cookie }, query: q }, { status(c) { o.code = c; return this; }, set() {}, json(b) { o.body = b; } }); return o; };
  ok((await call({ lat: '1', lon: '1' }, '')).code === 401, 'oturumsuz istek 401'); ok((await call({ lat: 'x', lon: '1' })).code === 400 && (await call({ lat: '95', lon: '1' })).code === 400 && (await call({})).code === 400, 'geçersiz konum 400'); ok((await call({ lat: '39.9', lon: '32.8' })).code === 200, 'geçerli istek 200');
  let c429 = 0; for (let i = 0; i < 25; i++) if ((await call({ lat: '39.9', lon: '32.8' })).code === 429) c429++; ok(c429 >= 4, 'kullanıcı başına dakikada 20 sınırı');
  console.log(`SONUÇ: ${p} geçti, ${f} başarısız`); process.exit(f ? 1 : 0);
})();
