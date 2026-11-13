'use strict';
// maps.js testi: sahte fetch/uygulama; GERÇEK Valhalla/Geoapify/ORS ile denenmedi.
const assert = require('assert');
let pass = 0; const ok = (c, m) => { assert(c, m); pass++; };
function enc(pts, prec = 1e6) { let pl = 0, po = 0, o = ''; const e = v => { v = v < 0 ? ~(v << 1) : v << 1; let s = ''; while (v >= 32) { s += String.fromCharCode((32 | (v & 31)) + 63); v >>= 5; } return s + String.fromCharCode(v + 63); };
  for (const [la, lo] of pts) { const a = Math.round(la * prec), b = Math.round(lo * prec); o += e(a - pl) + e(b - po); pl = a; po = b; } return o; }
const T = require('../maps')._test;
const pts = [[41.0, 29.0], [41.001, 29.002], [41.0, 29.01], [40.99, 29.011]];
const dec = T.decodePoly(enc(pts), 1e6);
ok(dec.length === 4 && pts.every((p, i) => Math.abs(p[0] - dec[i][0]) < 1e-6 && Math.abs(p[1] - dec[i][1]) < 1e-6), 'polyline6 çözümü');
ok(T.modOf('SharpLeft') === 'sharp-left' && T.modOf('uturn') === 'uturn' && T.modOf('RoundaboutEnter') === 'roundabout' && T.modOf('destination') === 'arrive' && T.modOf('exitright') === 'slight-right' && T.modOf('left') === 'left' && T.modOf(undefined) === 'straight', 'modOf');
ok(T.cleanSteps([{ text: 'a', lat: 1, lon: 2 }, { text: '', lat: 1, lon: 2 }, { text: 'b', lat: NaN, lon: 2 }]).length === 1, 'cleanSteps');

function load(env, fetchF) {
  for (const k of ['GEOAPIFY_API_KEY', 'ORS_API_KEY', 'VALHALLA_URL', 'ROUTE_PROVIDER']) delete process.env[k];
  Object.assign(process.env, env); global.fetch = fetchF;
  delete require.cache[require.resolve('../maps')];
  const h = {}; const app = { get: (p, f) => { h[p] = f; } };
  require('../maps')({ app, userFromCookie: () => ({ id: 'u' + Math.random() }) });
  return h;
}
async function call(h, path, q) {
  let code = 200, body; const res = { status(c) { code = c; return this; }, json(b) { body = b; return this; } };
  await h[path]({ headers: { cookie: 'x' }, query: q }, res); return { code, body };
}
const J = (b, status = 200) => ({ ok: status < 400, status, json: async () => b });
const Q = { from: '41,29', to: '40.99,29.011' };
const valBody = { trip: { summary: { length: 1.5, time: 200, has_toll: false, has_ferry: false }, legs: [{ shape: enc(pts), maneuvers: [
  { type: 2, instruction: 'Kuzeye git.', length: 0.5, time: 60, begin_shape_index: 0 }, { type: 10, instruction: 'Sağa dön.', length: 0.7, time: 90, begin_shape_index: 2 }, { type: 4, instruction: 'Varış', length: 0, time: 0, begin_shape_index: 3 }] }] } };

(async () => {
  // 1) Anahtarsız: Valhalla
  let seen;
  let h = load({}, async (u, o) => { seen = { u, o }; return J(valBody); });
  let c = await call(h, '/api/maps/config', {});
  ok(c.body.routing === true && c.body.route.provider === 'valhalla' && c.body.route.profile === 'motorcycle', 'anahtarsız yapılandırma: valhalla açık');
  let r = await call(h, '/api/route', { ...Q, avoid: 'highways,tolls' });
  ok(r.code === 200 && r.body.provider === 'valhalla' && r.body.steps.length === 3 && r.body.steps[1].mod === 'right' && r.body.steps[0].mod === 'depart' && r.body.steps[2].mod === 'arrive', 'valhalla adımları');
  ok(Math.abs(r.body.distance - 1500) < 1 && r.body.duration === 200 && r.body.coords.length >= 2, 'valhalla mesafe/süre');
  const sent = JSON.parse(seen.o.body);
  ok(sent.costing === 'motorcycle' && sent.costing_options.motorcycle.use_highways === 0 && sent.costing_options.motorcycle.use_tolls === 0 && sent.directions_options.language === 'tr-TR', 'valhalla istek gövdesi');
  const n0 = 1; let calls = 0;
  h = load({}, async () => { calls++; return J(valBody); });
  await call(h, '/api/route', Q); await call(h, '/api/route', Q);
  ok(calls === 1, 'ikinci aynı istek önbellekten');

  // 2) Valhalla "rota yok"
  h = load({}, async () => J({ error_code: 442, error: 'No suitable edges' }, 400));
  r = await call(h, '/api/route', Q); ok(r.code === 404, 'rota yok → 404');
  h = load({}, async () => { throw new Error('ağ'); });
  r = await call(h, '/api/route', Q); ok(r.code === 502, 'ağ hatası → 502');

  // 3) Geoapify varken adımlar; çöküşte Valhalla'ya düşer
  const geo = { features: [{ geometry: { type: 'MultiLineString', coordinates: [[[29, 41], [29.002, 41.001], [29.01, 41]]] },
    properties: { distance: 900, time: 100, legs: [{ steps: [{ from_index: 0, distance: 300, time: 30, instruction: { text: 'Kuzeye git', type: 'StartAt' } }, { from_index: 1, distance: 600, time: 70, instruction: { text: 'Sola dön', type: 'Left' } }] }] } }] };
  h = load({ GEOAPIFY_API_KEY: 'k' }, async (u) => { seen = u; return J(geo); });
  r = await call(h, '/api/route', Q);
  ok(r.body.provider === 'geoapify' && r.body.steps.length === 2 && r.body.steps[1].mod === 'left' && Math.abs(r.body.steps[1].lat - 41.001) < 1e-6 && /lang=tr/.test(seen), 'geoapify adımları');
  h = load({ GEOAPIFY_API_KEY: 'k' }, async (u) => (String(u).includes('geoapify') ? J({}, 500) : J(valBody)));
  r = await call(h, '/api/route', Q);
  ok(r.code === 200 && r.body.provider === 'valhalla' && r.body.steps.length === 3, 'geoapify 502 → valhalla yedeği');
  h = load({ GEOAPIFY_API_KEY: 'k' }, async (u) => (String(u).includes('geoapify') ? J({}, 404) : J(valBody)));
  r = await call(h, '/api/route', Q); ok(r.code === 404, '404 yedeğe düşmez');

  // 4) ORS adımları
  const ors = { features: [{ geometry: { coordinates: [[29, 41], [29.002, 41.001], [29.01, 41]] }, properties: { summary: { distance: 900, duration: 100 },
    segments: [{ steps: [{ distance: 300, duration: 30, type: 11, instruction: 'Kuzeye git', way_points: [0, 1] }, { distance: 600, duration: 70, type: 1, instruction: 'Sağa dön', way_points: [1, 2] }] }] } }] };
  h = load({ ORS_API_KEY: 'k' }, async (u, o) => { seen = o; return J(ors); });
  r = await call(h, '/api/route', Q);
  ok(r.body.provider === 'ors' && r.body.steps.length === 2 && r.body.steps[1].mod === 'right' && JSON.parse(seen.body).instructions === true, 'ors adımları');

  // 5) Kapalı
  h = load({ VALHALLA_URL: 'off' }, async () => J(valBody));
  c = await call(h, '/api/maps/config', {}); r = await call(h, '/api/route', Q);
  ok(c.body.routing === false && r.code === 503, 'valhalla kapalı + anahtarsız → 503');
  console.log('maps testi: ' + pass + ' kontrol geçti');
})().catch(e => { console.error('HATA', e.message, e.stack.split('\n')[1]); process.exit(1); });
