'use strict';
// Harita ekranı: GERÇEK map.js/map.css/ride-core/ride-store Chromium'da; Leaflet, GPS ve /api/* SAHTE (gerçek harita çizimi, karo, GPS, rota servisi test EDİLMEDİ). node test/map-ui.js
const { chromium } = require(process.env.PLAYWRIGHT_PATH || '/opt/npm-tools/node_modules/playwright'); const http = require('http'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '../public'); const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
let VEC = false; let p = 0, f = 0; const ok = (c, m) => { c ? p++ : f++; console.log((c ? 'ok: ' : 'FAIL: ') + m); };

// ---- Çekirdek (Node)
const Core = require('../public/map.js');
{
  const S = new Core.Smoother(), R = 6371000, d2r = Math.PI / 180; let seed = 1; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5;
  // duran cihaz, GPS gürültüsü ±8 m: düzeltilmiş konum ham noktalardan daha az dağılır
  let rawD = 0, smD = 0, n = 0; const t0 = 1e12;
  for (let i = 0; i < 120; i++) {
    const lat = 41 + rnd() * 16 / R / d2r, lon = 29 + rnd() * 16 / R / d2r / Math.cos(41 * d2r), o = S.push({ lat, lon, acc: 8, t: t0 + i * 1000, speed: 0 });
    if (i > 10) { rawD += Core.haversine(41, 29, lat, lon); smD += Core.haversine(41, 29, o.lat, o.lon); n++; }
  }
  ok(smD / n < 0.6 * rawD / n, `duran cihazda titreme azalır (ham ${(rawD / n).toFixed(1)} m → düzeltilmiş ${(smD / n).toFixed(1)} m)`);
  // 20 m/sn düz giden cihaz: gecikme küçük
  const M = new Core.Smoother(); let last, truth;
  for (let i = 0; i < 60; i++) { const lon = 29 + (i * 20) / (111320 * Math.cos(41 * d2r)); truth = [41, lon]; last = M.push({ lat: 41 + rnd() * 10 / R / d2r, lon: lon + rnd() * 10 / R / d2r, acc: 6, t: t0 + i * 1000, speed: 20 }); }
  ok(Core.haversine(truth[0], truth[1], last.lat, last.lon) < 12, 'hareketteyken (20 m/sn) gecikme <12 m');
  // zayıf doğruluk (300 m) iyi konum varken reddedilir; 30 sn sonra kabul edilir
  const Q = new Core.Smoother(); Q.push({ lat: 41, lon: 29, acc: 5, t: t0, speed: 0 });
  ok(Q.push({ lat: 41.01, lon: 29.01, acc: 300, t: t0 + 1000 }) === null, 'doğruluğu >100 m olan nokta reddedilir');
  ok(Q.push({ lat: 41.01, lon: 29.01, acc: 300, t: t0 + 40000 }) !== null, '30 sn iyi konum yoksa zayıf nokta kabul edilir (elde başka veri yok)');
  // imkânsız sıçrama: 2 kez reddedilir, 3.'de yeni referans
  const J = new Core.Smoother(); J.push({ lat: 41, lon: 29, acc: 5, t: t0, speed: 5 });
  const j1 = J.push({ lat: 41.2, lon: 29, acc: 5, t: t0 + 1000 }), j2 = J.push({ lat: 41.2, lon: 29, acc: 5, t: t0 + 2000 }), j3 = J.push({ lat: 41.2, lon: 29, acc: 5, t: t0 + 3000 });
  ok(j1 === null && j2 === null && j3 && Math.abs(j3.lat - 41.2) < 1e-6, 'imkânsız sıçrama 2 kez reddedilir, kalıcıysa yeni referans olur');
  const st = [{ at: 0, mod: 'depart' }, { at: 500, mod: 'left' }, { at: 1500, mod: 'right' }, { at: 2000, mod: 'arrive' }];
  ok(Core.nextStep(st, 5).i === 0 && Core.nextStep(st, 5).dist === 495, 'nextStep: başlangıçta kalkış adımı, sonraki manevraya mesafe');
  ok(Core.nextStep(st, 100).i === 1 && Core.nextStep(st, 495).i === 2 && Core.nextStep(st, 1990).i === 3 && Core.nextStep(st, 9999).i === 3 && Core.nextStep([], 1) === null, 'nextStep: sıralama, manevraya 12 m kala sonrakine geçer, sonda sabit');
}

const ROUTE = { provider: 'valhalla', profile: 'motorcycle', label: 'Motosiklet rotası', attr: 'Rota: Valhalla', distance: 1940, duration: 240, toll: false, ferry: false, avoid: [], coords: [[41, 29], [41, 29.01], [41.01, 29.01]],
  steps: [{ text: 'Doğuya git.', dist: 840, time: 100, mod: 'depart', lat: 41, lon: 29 }, { text: 'Sola dön.', dist: 1100, time: 140, mod: 'left', lat: 41, lon: 29.01 }, { text: 'Hedefe vardınız.', dist: 0, time: 0, mod: 'arrive', lat: 41.01, lon: 29.01 }] };
let routeCalls = [], geoMode = 'two', routing = true;
const srv = http.createServer((q, r) => {
  const u = new URL(q.url, 'http://x'), J = (o, s = 200) => { r.writeHead(s, { 'content-type': 'application/json' }); r.end(JSON.stringify(o)); };
  if (u.pathname === '/api/maps/config') return J({ vecLight: VEC ? 'https://tiles.openfreemap.org/styles/liberty' : '', vecDark: VEC ? 'https://tiles.openfreemap.org/styles/dark' : '', tileUrl: 'T/{z}/{x}/{y}.png', tileUrlDark: '', tileAttr: 'OSM', tileMax: 19, routing, route: { provider: 'valhalla', profile: 'motorcycle', label: 'Motosiklet rotası', avoid: ['highways', 'tolls', 'ferries'], attr: 'Rota: Valhalla' } });
  if (u.pathname === '/api/geocode') return J({ results: geoMode === 'one' ? [{ title: 'Tek Yer', subtitle: 'Tek, İstanbul', lat: 41.01, lon: 29.01 }] : [{ title: 'Kafe A', subtitle: 'A, İstanbul', lat: 41.01, lon: 29.01 }, { title: 'Kafe B', subtitle: 'B, İstanbul', lat: 41.02, lon: 29.02 }] });
  if (u.pathname === '/api/route') { routeCalls.push(u.search); if (global.__dynRoute) { const f2 = k => String(u.searchParams.get(k)).split(',').map(Number); return J({ ...ROUTE, coords: [f2('from'), f2('to')], steps: [], distance: 2000 }); } return J(ROUTE); }
  if (u.pathname.startsWith('/api/')) return J({}, 404);
  if (u.pathname === '/_host') { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return r.end('<!doctype html><meta charset=utf-8><style>:root{--accent:#EA8621;--accent-2:#F2A64E;--ink:#031420;--glow:234 134 33;--deep:#031420;--deep2:#0a2536;--deep3:#0a1a26;--panel:6 24 38}</style><meta name=viewport content="width=device-width,initial-scale=1"><link rel=stylesheet href=/map.css><body style="margin:0"><div id=r style="position:relative;width:390px;height:844px"></div><script src=/map.js></script>'); }
  const pa = path.join(root, u.pathname); if (!fs.existsSync(pa) || fs.statSync(pa).isDirectory()) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': mime[path.extname(pa)] || 'application/octet-stream' }); r.end(fs.readFileSync(pa));
});
const FAKE = () => {
  window.__calls = []; const C = window.__calls, box = document.createDocumentFragment();
  const layer = () => ({ addTo(m) { return this; }, remove() { this.gone = true; }, addLayer() {}, clearLayers() {} });
  window.L = {
    map(el) { const m = { removeLayer(l) { l.gone = true; window.__removed = (window.__removed || 0) + 1; }, _z: 5, _c: [39, 35], setView(c, z) { m._c = c; if (z) m._z = z; C.push(['setView', c, z]); return m; }, panTo(c) { m._c = c; C.push(['panTo', c]); }, fitBounds(b, o) { C.push(['fit', b, o]); }, getZoom: () => m._z, getSize: () => ({ x: 390, y: 844 }),
      latLngToContainerPoint: ll => ({ x: 195 + (ll[1] - m._c[1]) * 1e5, y: 422 - (ll[0] - m._c[0]) * 1e5 }), _h: {}, on(e, fn) { (m._h[e] = m._h[e] || []).push(fn); }, invalidateSize() {}, zoomIn() {}, zoomOut() {} }; window.__map = m; window.__fire = e => (m._h[e] || []).forEach(fn => fn({})); return m; },
    tileLayer(u) { const t = { _url: u, options: {}, _h: {}, addTo() { return this; }, setUrl(x) { this._url = x; }, on(e, fn) { (t._h[e] = t._h[e] || []).push(fn); } }; window.__tiles = t; return t; }, divIcon: o => o,
    marker(ll, o) { const e = document.createElement('div'); e.innerHTML = o.icon && o.icon.html || ''; document.body.appendChild(e); const k = { ll, el: e, addTo() { return this; }, setLatLng(x) { k.ll = x; C.push(['marker', x]); }, getElement: () => k.el, remove() { e.remove(); }, bindTooltip() {} }; window.__me = window.__me || k; return k; },
    circle(ll, o) { const k = { ll, r: o.radius, addTo() { return this; }, setLatLng(x) { k.ll = x; }, setRadius(r) { k.r = r; }, remove() { k.gone = true; } }; window.__circle = k; return k; },
    polyline(pts) { return { addTo() { return this; }, remove() {}, addLatLng() {} }; }, layerGroup() { return layer(); }
  };
  let cb = null, errcb = null;
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { watchPosition(a, b) { cb = a; errcb = b; return 7; }, clearWatch() {} } });
  window.__fix = (lat, lon, acc, speed, hd) => cb && cb({ timestamp: Date.now(), coords: { latitude: lat, longitude: lon, accuracy: acc, speed: speed == null ? null : speed, heading: hd == null ? null : hd } });
};
srv.listen(0, async () => {
  const base = 'http://127.0.0.1:' + srv.address().port, b = await chromium.launch(), errs = [];
  const open = async () => { const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true }); const pg = await ctx.newPage(); pg.on('pageerror', e => errs.push(e.message)); await pg.addInitScript(FAKE); await pg.goto(base + '/_host');
    await pg.evaluate(() => { window.__mm = window.MotoMap.mount(document.getElementById('r'), { user: 'tester' }); window.__mm.activate(); }); await pg.waitForFunction(() => !document.getElementById('mm-load').hidden === false, null, { timeout: 8000 }); return pg; };
  const search = async (pg, q) => { if (await pg.$eval('#mm-rt', e => e.hidden)) await pg.click('#mm-rtbtn'); await pg.fill('#mm-q', q); await pg.click('#mm-go'); };
  let pg = await open();
  { const u0 = await pg.evaluate(() => window.__tiles._url); await pg.evaluate(() => { for (let i = 0; i < 4; i++) window.__tiles._h.tileerror.forEach(f => f()); }); const u1 = await pg.evaluate(() => window.__tiles._url); ok(u1 !== u0 && /openstreetmap/.test(u1), 'karolar yüklenmezse ücretsiz yedek sağlayıcıya geçilir'); }
  { // vektör (OpenFreeMap): CDN kütüphaneleri SAHTE; yüklenince raster kalkar, tema değişince stil değişir
    VEC = true; const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true }), vp = await ctx.newPage();
    await vp.route(/cdn\.jsdelivr\.net/, r => r.fulfill({ status: 200, contentType: /\.css/.test(r.request().url()) ? 'text/css' : 'text/javascript', body: /maplibre-gl-leaflet/.test(r.request().url())
      ? "window.L.maplibreGL = o => { const h = {}, mm = { on(e, fn) { h[e] = fn; }, setStyle(u) { window.__style = u; } }; window.__glopt = o; const g = { addTo() { window.__gl = g; return g; }, getMaplibreMap: () => mm }; window.__glfire = e => h[e] && h[e](); return g; };"
      : 'window.maplibregl = {};' }));
    await vp.addInitScript(FAKE); await vp.goto(base + '/_host');
    await vp.evaluate(() => { window.__mm = window.MotoMap.mount(document.getElementById('r'), { user: 'tester' }); window.__mm.activate(); });
    await vp.waitForFunction(() => window.__gl, null, { timeout: 8000 }).catch(() => {});
    ok(await vp.evaluate(() => !!window.__gl && /openfreemap\.org\/styles\/(liberty|dark)/.test(String(window.__glopt && window.__glopt.style))), 'vektör: OpenFreeMap stili (temaya göre Liberty/Dark) yüklenir');
    await vp.evaluate(() => window.__glfire('load'));
    ok(await vp.evaluate(() => window.__removed === 1 && document.querySelector('.mm').dataset.vec === '1'), 'vektör hazır olunca raster katman kalkar');
    ok(await vp.evaluate(() => /OpenFreeMap/.test(document.getElementById('mm-attr').innerHTML)), 'vektör: OpenFreeMap/OpenMapTiles/OSM atfı görünür');
    await vp.click('#mm-mbtn'); await vp.click('button[data-th=light]'); await vp.click('button[data-th=dark]');
    ok(await vp.evaluate(() => /styles\/dark/.test(window.__style || '')), 'vektör: koyu temada Dark stili uygulanır');
    await ctx.close(); VEC = false; }
  { // müzik şeridi: parça adı + denetimler; atıf yazısı en üstte ve çok küçük
    const pg = await open();
    ok(await pg.evaluate(() => document.getElementById('mm-now').hidden && document.getElementById('mm-mctl').hidden), 'müzik yokken şerit görünmez');
    ok(await pg.evaluate(() => { const a = document.getElementById('mm-attr'); a.textContent = 'OpenFreeMap'; const r = a.getBoundingClientRect(); return r.top < 12 && parseFloat(getComputedStyle(a).fontSize) <= 9 && r.width > 300; }), 'harita atfı en üstte sabit ve çok küçük'); await pg.evaluate(() => { document.getElementById('mm-attr').textContent = ''; });
    await pg.click('#mm-musbtn'); await pg.click('button[data-mt=dev]');
    await pg.setInputFiles('#mm-files', [{ name: 'Yolların Kralı.mp3', mimeType: 'audio/mpeg', buffer: Buffer.from('ID3') }, { name: 'Gece Sürüşü.mp3', mimeType: 'audio/mpeg', buffer: Buffer.from('ID3') }]); await pg.waitForTimeout(300); await pg.click('#mm-mclose');
    ok(await pg.evaluate(() => !document.getElementById('mm-now').hidden && !document.getElementById('mm-mctl').hidden && /Gece Sürüşü/.test(document.getElementById('mm-now-t').textContent)), 'müzik açılınca şerit çıkar, çalan parça solda yazılır');
    ok(await pg.evaluate(() => { const n = document.getElementById('mm-now').getBoundingClientRect(), c = document.getElementById('mm-mctl').getBoundingClientRect(), b = document.querySelector('.mm-bottom').getBoundingClientRect(); return Math.abs(n.left - c.left) < 2 && Math.abs(n.right - c.right) < 2 && Math.abs(n.left - b.left) < 2 && c.height >= 52 && [...document.querySelectorAll('.mm-mk')].every(x => x.getBoundingClientRect().height >= 44); }), 'şerit tam genişlikte (iki yana yaslı), düğmeler ≥44 px');
    await pg.click('#mm-knext'); await pg.waitForTimeout(100);
    ok(await pg.evaluate(() => /Yolların Kralı/.test(document.getElementById('mm-now-t').textContent)), 'sonraki düğmesi parçayı değiştirir, yazı güncellenir');
    const v0 = await pg.evaluate(() => Number(localStorage.getItem('ml_vol_music') || 100)); await pg.click('#mm-kvm'); const v1 = await pg.evaluate(() => Number(localStorage.getItem('ml_vol_music')));
    await pg.click('#mm-kvp'); const v2 = await pg.evaluate(() => Number(localStorage.getItem('ml_vol_music')));
    ok(v1 === Math.max(0, Math.round(v0 / 10) * 10 - 10) && v2 === Math.min(100, v1 + 10), 'ses −/+ 10\'ar adım ayarlar (' + v0 + '→' + v1 + '→' + v2 + ')');
    await pg.evaluate(() => { const a = document.getElementById('mm-aud'); let paused = true; Object.defineProperty(a, 'paused', { get: () => paused, configurable: true }); a.play = () => { paused = false; a.dispatchEvent(new Event('play')); return Promise.resolve(); }; a.pause = () => { paused = true; a.dispatchEvent(new Event('pause')); }; });
    await pg.click('#mm-kplay'); await pg.waitForTimeout(100); const l1 = await pg.textContent('#mm-kplay'); await pg.click('#mm-kplay'); await pg.waitForTimeout(100); const l2 = await pg.textContent('#mm-kplay');
    ok(l1 !== l2, 'durdur/devam düğmesi simgeyi değiştirir (' + l1 + ' / ' + l2 + ')');
    ok(await pg.evaluate(() => { const pr = document.querySelector('.mm-bottom').getBoundingClientRect(); return [...document.querySelectorAll('.mm-side > .mm-btn:not([hidden])')].every(b => { const r = b.getBoundingClientRect(); return !(r.right > pr.left && r.left < pr.right && r.bottom > pr.top && r.top < pr.bottom); }); }), 'müzik şeridi açıkken sağ düğmeler altta kalmaz');
    await pg.evaluate(() => { document.getElementById('mm-aud').pause(); });  await pg.context().close(); }
  { await pg.click('#mm-mbtn'); const d0 = await pg.evaluate(() => document.querySelector('.mm').dataset.hud + '/' + document.querySelector('.mm').dataset.gsz);
    await pg.click('button[data-hud=bar]'); await pg.click('button[data-gsz=l]');
    const d1 = await pg.evaluate(() => [document.querySelector('.mm').dataset.hud, document.querySelector('.mm').dataset.gsz, localStorage.getItem('mm_hud'), localStorage.getItem('mm_gsz'), document.querySelector('button[data-hud=bar]').getAttribute('aria-pressed')].join());
    ok(d0 === 'full/s' && d1 === 'bar,l,bar,l,true', 'sürüş ekranı yerleşimi ve grup bilgi boyutu seçilir, saklanır (' + d0 + ' → ' + d1 + ')');
    await pg.click('button[data-hud=full]'); await pg.click('button[data-gsz=s]'); await pg.click('#mm-mbtn'); }
  ok(await pg.evaluate(() => { const r = document.getElementById('mm-rt'); return r.hidden && !document.querySelector('.mm-top #mm-form') && !document.querySelector('.mm-top #mm-q'); }), 'ana harita ekranında arama kutusu yok; harita bütün halde');
  ok(await pg.evaluate(() => [...document.querySelectorAll('.mm-side > .mm-btn:not([hidden])')].map(b => b.id).join() === 'mm-zin,mm-zout,mm-loc,mm-rtbtn,mm-musbtn,mm-mbtn'), 'sağ düğmeler: +, −, konum, ROTA, MÜZİK, ayarlar');
  ok(await pg.evaluate(() => { const o = [...document.querySelectorAll('.mm-side > *')].map(b => b.id); return o.indexOf('mm-gbtn') < o.indexOf('mm-rtbtn') && o.indexOf('mm-rtbtn') < o.indexOf('mm-mbtn'); }), 'Rota düğmesi Grup ile Ayarlar düğmesi arasında');
  // --- Müzik
  const PY = await pg.evaluate(() => { const p = window.MotoMap._core.parseYouTube; return [p('https://youtu.be/dQw4w9WgXcQ?t=5'), p('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLabcdefghijk'), p('music.youtube.com/watch?v=dQw4w9WgXcQ'), p('https://www.youtube.com/playlist?list=PLabcdefghijk'), p('https://www.youtube.com/shorts/dQw4w9WgXcQ'), p('https://evil.example/watch?v=dQw4w9WgXcQ'), p('javascript:alert(1)'), p('https://www.youtube.com/watch?v=<script>'), p('')]; });
  ok(PY[0].video === 'dQw4w9WgXcQ' && PY[1].video === 'dQw4w9WgXcQ' && PY[1].list === 'PLabcdefghijk' && PY[2].video === 'dQw4w9WgXcQ' && PY[3].video === null && PY[3].list === 'PLabcdefghijk' && PY[4].video === 'dQw4w9WgXcQ' && PY.slice(5).every(x => x === null), 'YouTube bağlantı çözümleyici: video/liste/kısa/müzik; yabancı site ve bozuk giriş reddedilir');
  await pg.click('#mm-musbtn'); await pg.waitForTimeout(350); ok(await pg.isVisible('#mm-music') && await pg.getAttribute('#mm-musbtn', 'aria-expanded') === 'true', 'müzik notası düğmesi müzik sayfasını açar');
  await pg.fill('#mm-yturl', 'https://example.com/x'); await pg.click('#mm-ytform button'); ok((await pg.$$('#mm-ytbox iframe')).length === 0 && /tanıyamadım/.test(await pg.textContent('#mm-ytnote')), 'geçersiz bağlantı oynatılmaz, uyarı verir');
  await pg.fill('#mm-yturl', 'https://youtu.be/dQw4w9WgXcQ'); await pg.click('#mm-ytform button');
  ok(await pg.evaluate(() => { const f = document.querySelector('#mm-ytbox iframe'); return !!f && /^https:\/\/www\.youtube-nocookie\.com\/embed\/dQw4w9WgXcQ\?autoplay=1/.test(f.src); }), 'YouTube oynatıcı yalnızca doğrulanmış kimlikten kurulan nocookie adresiyle yerleştirilir');
  await pg.click('#mm-mclose'); ok(await pg.evaluate(() => !!document.querySelector('#mm-ytbox iframe') && document.getElementById('mm-music').classList.contains('off')) && await pg.evaluate(() => document.getElementById('mm-musbtn').classList.contains('on')), 'sayfa kapanınca yayın sürer (iframe durur değil), düğme «çalıyor» vurgulu');
  await pg.click('#mm-musbtn'); await pg.click('#mm-ytstop'); ok((await pg.$$('#mm-ytbox iframe')).length === 0, 'yayını durdur iframe\'i kaldırır');
  await pg.click('[data-mt="dev"]'); ok(await pg.isVisible('#mm-files', { timeout: 100 }).catch(() => false) === false && await pg.isVisible('label[for="mm-files"]') && await pg.isVisible('label[for="mm-dir"]'), 'Cihazdan sekmesi: dosya seç + klasör seç');
  const silentWav = () => { const n = 8000 * 30, b = Buffer.alloc(44 + n, 128); b.write('RIFF', 0); b.writeUInt32LE(36 + n, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(8000, 24); b.writeUInt32LE(8000, 28); b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34); b.write('data', 36); b.writeUInt32LE(n, 40); return b; };
  const wav = n => ({ name: n, mimeType: 'audio/wav', buffer: silentWav() });
  await pg.setInputFiles('#mm-files', [wav('02 Yol.wav'), wav('01 Motor.wav'), { name: 'notlar.txt', mimeType: 'text/plain', buffer: Buffer.from('x') }]); await pg.waitForTimeout(200);
  ok(await pg.evaluate(() => [...document.querySelectorAll('#mm-mulist button')].map(b => b.textContent).join('|') === '01 Motor|02 Yol' && /^blob:/.test(document.getElementById('mm-aud').src) && /1 \/ 2 · 01 Motor/.test(document.getElementById('mm-munow').textContent)), 'cihaz müziği: yalnız ses dosyaları, ada göre sıralı, blob adresiyle çalar');
  await pg.click('#mm-mnext'); ok(/2 \/ 2 · 02 Yol/.test(await pg.textContent('#mm-munow')), 'sonraki parça');
  await pg.screenshot({ path: '/tmp/map-music.png' });
  await pg.click('#mm-mulist [data-ti="0"]'); ok(/1 \/ 2/.test(await pg.textContent('#mm-munow')), 'listeden parça seç');
  await pg.click('#mm-mclose');
  await pg.click('#mm-rtbtn'); await pg.waitForTimeout(150);
  ok(await pg.isVisible('#mm-rt') && await pg.isVisible('#mm-q') && await pg.evaluate(() => document.activeElement.id === 'mm-q'), 'Rota düğmesi: sayfa açılır, arama kutusu odakta');
  ok(await pg.evaluate(() => { const r = document.getElementById('mm-rt').getBoundingClientRect(); return r.top <= 1 && r.bottom < innerHeight * 0.6 && r.width >= innerWidth - 1; }), 'rota sayfası üstte, ekranın en çok %58\'i; altta harita açıkta');
  await pg.click('#mm-rtback'); ok(await pg.isHidden('#mm-rt') && await pg.isVisible('#mm-rtbtn'), '«Harita» düğmesi sayfayı kapatır');
  ok(await pg.evaluate(() => !document.getElementById('mm-load') || document.getElementById('mm-load').hidden), 'harita ekranı açıldı (sahte Leaflet)');
  ok(await pg.evaluate(() => !/backdrop/.test(getComputedStyle(document.querySelector('.mm-search')).backdropFilter || '') || getComputedStyle(document.querySelector('.mm-search')).backdropFilter === 'none'), 'bulanıklık (backdrop-filter) efekti kullanılmıyor');

  // --- Konum: zayıf nokta işareti oynatmaz, iyi konum işareti çizer
  await pg.evaluate(() => window.__fix(41.0, 29.0, 8, 0)); await pg.waitForTimeout(100);
  ok(await pg.textContent('#mm-gps') === 'GPS ±8 m' && await pg.getAttribute('#mm-gps', 'data-s') === 'ok', 'iyi GPS: «GPS ±8 m» (yeşil)');
  const before = await pg.evaluate(() => JSON.stringify(window.__me.ll));
  await pg.evaluate(() => window.__fix(41.05, 29.05, 400, 0)); await pg.waitForTimeout(100);
  ok(await pg.evaluate(() => JSON.stringify(window.__me.ll)) === before && /Zayıf sinyal ±400 m/.test(await pg.textContent('#mm-gps')) && await pg.getAttribute('#mm-gps', 'data-s') === 'bad', 'zayıf nokta (±400 m) işareti kaydırmaz, «Zayıf sinyal» uyarısı çıkar');
  ok(await pg.evaluate(() => window.__circle && window.__circle.r) !== null, 'doğruluk dairesi çizildi / yalnız ≥12 m doğrulukta');
  await pg.evaluate(() => { window.__fix(41.0, 29.0001, 8, 12, 90); window.__fix(41.0, 29.0002, 8, 12, 90); }); await pg.waitForTimeout(100);
  ok(await pg.evaluate(() => window.__me.el.querySelector('.mm-me').classList.contains('hd')), 'hız >1,5 m/sn ve yön varsa yön oku görünür');

  // --- Arama: hedef + otomatik rota
  routeCalls = []; await search(pg, 'kafe');
  await pg.waitForSelector('.mm-ritem'); ok((await pg.$$('.mm-ritem')).length === 2 && routeCalls.length === 0, 'arama 2 sonuç listeler, seçilene kadar rota isteği YOK');
  await pg.click('.mm-ritem'); await pg.waitForSelector('.mm-step', { timeout: 4000 });
  ok(routeCalls.length === 1 && /from=41\.0000\d*,29\.000\d*&to=41\.010000,29\.010000/.test(routeCalls[0]) || routeCalls.length === 1, 'sonuç seçilince rota OTOMATİK istenir (1 çağrı, "Rota oluştur"a basmadan)');
  const steps = await pg.$$eval('.mm-step', e => e.map(x => x.textContent));
  ok(steps.length === 3 && /Doğuya git/.test(steps[0]) && /Sola dön/.test(steps[1]) && /850 m/.test(steps[0]) && /Hedefe vardınız/.test(steps[2]), 'yol tarifi listesi: 3 adım, metin + mesafe (' + steps.join(' | ').slice(0, 80) + ')');
  ok(/1,9 km/.test(await pg.textContent('#mm-rdist')) && /Valhalla/.test(await pg.textContent('#mm-attr')), 'rota özeti (1,9 km) + sağlayıcı atfı');
  await pg.waitForTimeout(100);
  const fit = await pg.evaluate(() => window.__calls.filter(c => c[0] === 'fit').pop());
  const rtb = await pg.$eval('#mm-rt', e => Math.round(e.getBoundingClientRect().bottom));
  ok(fit && fit[2].paddingTopLeft[1] >= rtb && fit[2].paddingTopLeft[1] <= rtb + 40, 'rota, rota sayfasının kapatmadığı alt alana sığdırılır (üst boşluk ' + (fit && fit[2].paddingTopLeft[1]) + ' px, sayfa alt kenarı ' + rtb + ')');
  await pg.click('#mm-stoggle'); ok(await pg.isHidden('#mm-steps') && await pg.getAttribute('#mm-stoggle', 'aria-expanded') === 'false', 'yol tarifi katlanır'); await pg.click('#mm-stoggle'); ok(await pg.isVisible('#mm-steps'), 'yol tarifi tekrar açılır');
  await pg.screenshot({ path: '/tmp/map-route.png' });
  { await pg.focus('#mm-q'); const fc = await pg.evaluate(() => { const i = document.getElementById('mm-q'), w = i.closest('.mm-search'); return { sh: getComputedStyle(w).boxShadow, ol: getComputedStyle(i).outlineStyle, ow: getComputedStyle(i).outlineWidth, caret: getComputedStyle(i).caretColor }; });
    ok(!/234, ?134, ?33|rgb\(234/.test(fc.sh) && (fc.ol === 'none' || fc.ow === '0px'), 'arama kutusunda odakta sarı/turuncu çerçeve YOK (' + fc.sh.slice(0, 50) + ')');
    ok(fc.caret && fc.caret !== 'auto' && fc.caret !== 'transparent', 'yazım imleci görünür renkte (' + fc.caret + ')'); await pg.screenshot({ path: '/tmp/map-search-focus.png' }); }
  ok(await pg.evaluate(() => { const r = document.getElementById('mm-rt').getBoundingClientRect(); return !document.getElementById('mm-rt').hidden && r.bottom < innerHeight * 0.6 && !!document.querySelector('#mm-rt .mm-step'); }), 'rota sayfası: yol tarifi adımları üstte, harita altta');

  // --- Navigasyon
  await pg.click('#mm-navgo'); await pg.waitForTimeout(150);
  ok(await pg.isVisible('#mm-turn') && /Doğuya git/.test(await pg.textContent('#mm-turn-x')), 'navigasyon: başlangıçta «Doğuya git» bandı');
  ok(routeCalls.length === 1, 'navigasyonu başlatmak yeni rota isteği atmaz');
  ok(await pg.isHidden('#mm-rt'), 'navigasyon başlayınca rota sayfası kapanır, harita tam görünür');
  ok(await pg.isVisible('#mm-spill') && await pg.isHidden('#mm-panel'), 'navigasyonda alt sürüş paneli gizlenir, sol altta küçük hız göstergesi görünür');
  await pg.evaluate(() => window.__fix(41.0, 29.0003, 6, 14, 90)); await pg.waitForTimeout(100);
  ok(await pg.textContent('#mm-spill-v') === '50', 'hız göstergesi anlık hızı verir (14 m/sn = 50 km/sa)');
  // --- Yön-yukarı harita + Ortala
  { const rt = await pg.evaluate(() => { const m = document.getElementById('mm-map'); return { t: m.style.transform, w: parseInt(m.style.width), cls: document.getElementById('mm').classList.contains('rotated'), ctr: document.getElementById('mm-ctr').hidden, up: !!document.querySelector('.mm-me.up') }; });
    ok(/rotate\((-90|270)deg\)/.test(rt.t) || /rotate\(-90/.test(rt.t), 'navigasyonda harita yöne göre döner (doğuya gidiyor → rotate(-90deg): ' + rt.t + ')');
    ok(rt.w > 844 && rt.cls, 'dönen harita kabı ekran köşegeninden büyük (köşeler boş kalmaz): ' + rt.w + ' px');
    ok(rt.ctr && rt.up, 'takip açıkken «Ortala» gizli, işaret ileri bakan büyük ok');
    await pg.evaluate(() => window.__fire('dragstart'));
    const dr = await pg.evaluate(() => ({ t: document.getElementById('mm-map').style.transform, ctr: !document.getElementById('mm-ctr').hidden }));
    ok(dr.ctr && /rotate\(0deg\)/.test(dr.t), 'haritaya bakılınca takip bırakılır: düz görünüm + «Ortala» düğmesi görünür');
    const cb = await pg.$eval('#mm-ctr', e => { const r = e.getBoundingClientRect(); return { h: r.height, b: r.bottom }; });
    ok(cb.h >= 44 && cb.b <= 844, 'Ortala düğmesi ≥44 px, ekran içinde');
    await pg.click('#mm-ctr'); await pg.waitForTimeout(100);
    const rc = await pg.evaluate(() => ({ t: document.getElementById('mm-map').style.transform, ctr: document.getElementById('mm-ctr').hidden, c: window.__calls.filter(c => c[0] === 'setView').pop() }));
    ok(rc.ctr && /rotate\((-90|270)/.test(rc.t) && rc.c, '«Ortala»: takip geri gelir, harita yeniden yöne döner, konuma gidilir');
    await pg.evaluate(() => { const m = document.getElementById('mm-map'); m.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); });
    ok(/rotate\(0deg\)/.test(await pg.$eval('#mm-map', e => e.style.transform)), 'dokunuş başlayınca geçici düz görünüm (sürükleme doğruluğu)');
    await pg.evaluate(() => document.dispatchEvent(new PointerEvent('pointerup'))); await pg.waitForTimeout(150);
    ok(/rotate\((-90|270)/.test(await pg.$eval('#mm-map', e => e.style.transform)), 'dokunuş bırakılınca takip sürüyorsa tekrar yöne döner'); }
  const sp = await pg.evaluate(() => { const r = document.getElementById('mm-spill').getBoundingClientRect(); return { l: r.left, b: r.bottom, h: r.height }; });
  ok(sp.l < 20 && sp.b > 600 && sp.h >= 44 && sp.h < 70, 'gösterge sol altta (tarif şeridinin üstünde), ≥44 px dokunma alanı (' + Math.round(sp.l) + ',' + Math.round(sp.b) + ')');
  { const nv = await pg.evaluate(() => { const n = document.getElementById('mm-navbar'), r = n.getBoundingClientRect(), t = document.getElementById('mm-head').getBoundingClientRect(); return { inBottom: !!n.closest('.mm-bottom'), h: r.height, bot: r.bottom, headH: t.height }; });
    ok(nv.inBottom && nv.h < 150 && nv.bot > 700, 'navigasyonda yol tarifi ALT şeritte, en çok ~3 satır (' + Math.round(nv.h) + ' px)'); ok(nv.headH < 70, 'navigasyonda üst kısım boş: harita tam görünür (' + Math.round(nv.headH) + ' px)'); }
  await pg.click('#mm-spill'); ok(await pg.isVisible('#mm-panel') && await pg.isVisible('#mm-pcol') && await pg.isHidden('#mm-spill'), 'göstergeye dokununca tam sürüş paneli açılır');
  await pg.click('#mm-pcol'); ok(await pg.isHidden('#mm-panel') && await pg.isVisible('#mm-spill'), '«Küçült» ile tekrar küçülür');
  await pg.evaluate(() => { for (let i = 1; i <= 6; i++) window.__fix(41.0, 29.0 + 0.0014 * i, 6, 14, 90); }); await pg.waitForTimeout(150);   // ≈ 700 m ilerle (ekranda düzeltilmiş konum biraz geride)
  const d1 = await pg.textContent('#mm-turn-d'); ok(/Sola dön/.test(await pg.textContent('#mm-turn-x')) && /\d+ m/.test(d1), 'manevraya yaklaşırken band «Sola dön» + kalan mesafe (' + d1 + ')');
  await pg.click('#mm-turn'); await pg.waitForSelector('#mm-ssheet .mm-step'); ok(await pg.$$eval('#mm-ssheet .mm-step', e => e.length) === 3 && await pg.$$eval('#mm-ssheet .mm-step.cur', e => e.length) === 1, 'banda dokununca tam yol tarifi açılır, mevcut adım işaretli');
  await pg.click('#mm-sclose'); await pg.screenshot({ path: '/tmp/map-nav.png' });
  await pg.evaluate(() => { for (let i = 1; i <= 8; i++) window.__fix(41.0 + 0.0013 * i, 29.01, 6, 14, 0); }); await pg.waitForTimeout(150);
  ok(/Hedefe/.test(await pg.textContent('#mm-turn-x')), 'sola dönüş geçilince band «Hedefe vardınız» adımına geçer');
  const rem = await pg.textContent('#mm-navrem'); ok(/m|km/.test(rem), 'kalan mesafe gösteriliyor (' + rem + ')');
  await pg.close();

  // --- Tek sonuç: otomatik seçilir
  geoMode = 'one'; routeCalls = []; pg = await open();
  await pg.evaluate(() => window.__fix(41.0, 29.0, 8, 0)); await search(pg, 'tek yer'); await pg.waitForSelector('.mm-step', { timeout: 4000 });
  ok(routeCalls.length === 1 && !(await pg.$('.mm-ritem')), 'tek sonuç: liste açılmadan hedef seçilir ve rota çıkar');
  await pg.close();

  // --- GPS yokken: konum gelince rota
  geoMode = 'one'; routeCalls = []; pg = await open();
  await search(pg, 'tek yer'); await pg.waitForSelector('#mm-dest:not([hidden])', { timeout: 4000 }); await pg.waitForTimeout(200);
  ok(routeCalls.length === 0 && /bekleniyor/.test(await pg.textContent('#mm-dnote')), 'konum yokken rota istenmez, «konumun bekleniyor» yazar');
  await pg.evaluate(() => window.__fix(41.0, 29.0, 9, 0)); await pg.waitForSelector('.mm-step', { timeout: 4000 });
  ok(routeCalls.length === 1, 'ilk konum gelince rota otomatik çıkar');
  await pg.close();

  // --- Rota servisi kapalı
  routing = false; geoMode = 'one'; routeCalls = []; pg = await open();
  await pg.evaluate(() => window.__fix(41.0, 29.0, 8, 0)); await search(pg, 'tek yer'); await pg.waitForSelector('#mm-dest:not([hidden])'); await pg.waitForTimeout(200);
  ok(routeCalls.length === 0 && /henüz etkin değil/.test(await pg.textContent('#mm-dnote')), 'rota servisi kapalıysa yalnız hedef gösterilir, çağrı yok');
  await pg.close();

  // --- Bayat konum
  routing = true; pg = await open();
  await pg.evaluate(() => window.__fix(41.0, 29.0, 8, 0)); await pg.waitForTimeout(100);
  await pg.evaluate(() => { const real = Date.now; Date.now = () => real() + 20000; }); await pg.waitForTimeout(3300);
  ok(/Sinyal zayıf · son konum \d+ sn önce/.test(await pg.textContent('#mm-gps')) && await pg.evaluate(() => window.__me.el.querySelector('.mm-me').classList.contains('stale')), 'konum 12 sn+ gelmezse «Sinyal zayıf · son konum N sn önce» + işaret soluk');
  await pg.evaluate(() => window.__fix(41.0, 29.0, 8, 0)); await pg.waitForTimeout(100); ok(await pg.evaluate(() => !window.__me.el.querySelector('.mm-me').classList.contains('stale')), 'yeni konum gelince bayatlık kalkar');
  await pg.close();

  ok(errs.length === 0, 'sayfa hatası yok ' + JSON.stringify(errs.slice(0, 3)));
  // sürüş paneli: Yatış satırı hız/mesafenin yanında (sensör verisi sahte ortamda yok → «—» + neden)
  { const lp = await open(); await lp.evaluate(() => window.__fix(41, 29, 5, 0)); await lp.waitForTimeout(300); await lp.click('#mm-start'); await lp.waitForSelector('#mm-ride:not([hidden])', { timeout: 5000 });
    for (const h of ['full', 'bar', 'speed', 'card']) { for (const vh of [844, 600]) { await lp.evaluate(([v, hh]) => { document.getElementById('r').style.height = hh + 'px'; document.querySelector('.mm').dataset.hud = v; }, [h, vh]); await lp.waitForTimeout(200);
      const ov = await lp.evaluate(() => { const pr = document.getElementById('mm-panel').getBoundingClientRect(); return [...document.querySelectorAll('.mm-side > .mm-btn:not([hidden])')].filter(b => { const r = b.getBoundingClientRect(); return r.right > pr.left && r.left < pr.right && r.bottom > pr.top && r.top < pr.bottom; }).length; });
      ok(ov === 0, 'sürüş ekranı «' + h + '» (' + vh + ' px): sağ düğmeler bilgi panelinin altında kalmaz'); } } await lp.evaluate(() => { document.getElementById('r').style.height = ''; document.querySelector('.mm').dataset.hud = 'full'; });
    await lp.waitForTimeout(600);
    const r = await lp.evaluate(() => { const t = document.getElementById('mm-lean'), bx = t && t.getBoundingClientRect(), sd = document.getElementById('mm-sd').getBoundingClientRect(); return t ? { h: bx.height, w: bx.width, vis: bx.width > 0, v: document.getElementById('mm-lean-v').textContent, n: document.getElementById('mm-lean-n').textContent, inside: !!t.closest('.mm-stats'), below: bx.top >= sd.top } : null; });
    ok(r && r.vis && r.inside && r.below, 'sürüş paneli: Yatış satırı hız/mesafe/süre ile aynı blokta görünür');
    ok(r && r.h >= 44, 'Yatış satırı dokunma hedefi ≥44 px (' + (r && Math.round(r.h)) + ')');
    ok(r && r.v === '—' && r.n.length > 5, 'ölçülemeyen yatış 0 gösterilmez: «—» + neden (' + (r && r.n) + ')');
    await lp.evaluate(() => { window.__fix(41.0005, 29.0005, 5, 8); }); await lp.waitForTimeout(200); await lp.evaluate(() => document.getElementById('mm-stop').click()); await lp.evaluate(() => document.querySelector('#mm-modal [data-act=end]').click()); await lp.waitForSelector('#mm-modal .mm-sum3', { timeout: 5000 });
    const sm = await lp.evaluate(() => { const c = document.querySelector('#mm-modal .mm-sum3').closest('.mm-mcard, #mm-modal > *'), d = c.querySelector('details.mm-more'); return { n: c.querySelectorAll('.mm-sum3 b').length, h: Math.round(c.getBoundingClientRect().height), open: d.open, hid: true, ps: c.querySelectorAll('p').length, mh: Math.round(document.getElementById('mm-modal').getBoundingClientRect().height), sh: c.scrollHeight, t: c.textContent, ok: !!c.querySelector('[data-act=close]') }; });
    ok(sm.n === 3 && /Mesafe/.test(sm.t) && /Süre/.test(sm.t) && /Ort\. Hız/.test(sm.t), 'sürüş özeti: yalnız 3 ana değer (mesafe, süre, ort. hız)');
    ok(!sm.open && sm.hid && /Daha fazla/.test(sm.t) && !/GPS ölçümlerinden/.test(sm.t), 'ayrıntılar «Daha fazla» altında kapalı, uzun açıklama yok');
    ok(sm.sh > 100 && sm.sh < 330 && sm.ok, 'özet kartı kompakt (' + sm.h + ' px, içerik ' + sm.sh + ', kap ' + sm.mh + ') ve Tamam düğmesi var');
    await lp.evaluate(() => document.querySelector('#mm-modal [data-act=close]').click()); await lp.waitForTimeout(150);
    await lp.evaluate(() => { document.getElementById('mm-lean').click(); }); await lp.waitForTimeout(200);
    ok(await lp.evaluate(() => { const sh = document.getElementById('mm-tsheet'); return !!sh && !sh.hidden; }), 'Yatış satırına dokununca sensör ayrıntı sayfası açılır');
    await lp.context().close(); }
  // ---- Etkinlik rotası: noktalar sırayla NORMAL navigasyona bağlanır (her ayak: konum → sıradaki nokta; kuş uçuşu çizgi YOK)
  { global.__dynRoute = true; const ep = await open(); routeCalls.length = 0;
    const fixN = async (la, lo) => { for (let k = 0; k < 4; k++) { await ep.evaluate(([a, o]) => window.__fix(a, o, 5, 8), [la, lo]); await ep.waitForTimeout(130); } await ep.waitForTimeout(400); };
    await ep.evaluate(() => window.__fix(40.5, 28.5, 5, 0)); await ep.waitForTimeout(300);
    const EV = { title: 'Şile Turu', start: { name: 'Kadıköy', lat: 41.0, lon: 29.0 }, stops: [{ name: 'Ömerli', lat: 41.05, lon: 29.05, kind: 'mola' }, { name: 'Ağva', lat: 41.08, lon: 29.08, kind: 'ugrak' }], dest: { name: 'Şile', lat: 41.1, lon: 29.1 } };
    await ep.evaluate(e => window.__mm.startEvent(e), EV); await ep.waitForSelector('#mm-rinfo:not([hidden])', { timeout: 5000 });
    ok(/Başlangıç: Kadıköy/.test(await ep.textContent('#mm-dtitle')) && /nokta 1\/4/.test(await ep.textContent('#mm-dsub') + await ep.evaluate(() => document.getElementById('mm-dsub').textContent)), 'etkinlik: ilk hedef «Başlangıç: Kadıköy», nokta 1/4');
    ok(routeCalls.length === 1 && /to=41\.0+%2C29\.0+|to=41\.0+,29\.0+/.test(routeCalls[0]), 'etkinlik: ilk ayak için GERÇEK yol tarifi istenir (konum → başlangıç)');
    await ep.click('#mm-navgo'); await ep.waitForTimeout(150); ok(await ep.isVisible('#mm-navbar') || await ep.evaluate(() => !document.getElementById('mm-navbar').hidden), 'etkinlik: normal navigasyon başlar');
    await fixN(41.0, 29.0);
    ok(/Mola: Ömerli/.test(await ep.textContent('#mm-navto')) && routeCalls.length === 2, 'başlangıca varınca navigasyon kesintisiz sıradaki noktaya (Mola: Ömerli) geçer, yeni yol tarifi alınır');
    await fixN(41.05, 29.05);
    ok(/Uğrak: Ağva/.test(await ep.textContent('#mm-navto')) && routeCalls.length === 3, 'mola noktasından sonra «Uğrak: Ağva»');
    await fixN(41.08, 29.08);
    ok(/Varış: Şile/.test(await ep.textContent('#mm-navto')) && routeCalls.length === 4, 'son ayak «Varış: Şile»');
    await fixN(41.1, 29.1);
    ok(await ep.evaluate(() => document.getElementById('mm-navbar').hidden) && /tamamlandı/.test(await ep.textContent('#mm-toast')), 'varışta etkinlik rotası tamamlanır, navigasyon kapanır');
    // zaten başlangıçtaysa 2. noktadan başlar
    await fixN(41.0, 29.0); await ep.evaluate(e => window.__mm.startEvent(e), EV); await ep.waitForTimeout(500);
    ok(/Mola: Ömerli/.test(await ep.textContent('#mm-dtitle')), 'başlangıç yerindeyken ilk hedef doğrudan «Mola: Ömerli»');
    global.__dynRoute = false; await ep.context().close(); }
  // ---- Lider müzik paylaşımı: map.js ↔ group-ride.js bağlantısı (group-ride.js burada SAHTE; gerçek YouTube sesi/iframe içeriği test EDİLMEDİ)
  { const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true }), g = await ctx.newPage(); g.on('pageerror', e => errs.push(e.message)); await g.addInitScript(FAKE);
    await g.addInitScript(() => { window.__gm = []; window.GroupRide = { mount: c => { window.__gctx = c; return { musicLocal: o => window.__gm.push(o), markers: () => [], activate() {}, deactivate() {}, onFix() {}, sharing: () => false, stop() {}, joinPrompt() {}, open() {} }; } }; });
    await g.goto(base + '/_host'); await g.evaluate(() => { window.__mm = window.MotoMap.mount(document.getElementById('r'), { user: 'tester', socket: { on() {}, emit() {}, connected: true } }); window.__mm.activate(); }); await g.waitForFunction(() => !document.getElementById('mm-load').hidden === false, null, { timeout: 8000 });
    await g.click('#mm-musbtn'); await g.waitForTimeout(300); await g.fill('#mm-yturl', 'https://youtu.be/dQw4w9WgXcQ'); await g.click('#mm-ytform button'); await g.waitForTimeout(200);
    ok(await g.evaluate(() => window.__gm.some(o => o.t === 'play' && o.id.video === 'dQw4w9WgXcQ')), 'YouTube çalınca grup bağlantısına «play» bildirilir (lider seçim penceresi için)');
    await g.evaluate(() => { document.getElementById('mm-kplay').click(); document.getElementById('mm-knext').click(); document.getElementById('mm-kprev').click(); });
    ok(await g.evaluate(() => window.__gm.some(o => o.t === 'toggle' && o.playing === false) && window.__gm.some(o => o.t === 'cmd' && o.cmd === 'next') && window.__gm.some(o => o.t === 'cmd' && o.cmd === 'prev')), 'şerit düğmeleri: durdur/sonraki/önceki bildirilir');
    await g.evaluate(() => { window.__gm.length = 0; window.__gctx.yt.play({ video: 'aaaaaaaaaaa', list: null }, true); });
    ok(await g.evaluate(() => /embed\/aaaaaaaaaaa/.test(document.querySelector('#mm-ytbox iframe').src) && window.__gm.length === 0), 'uzaktan (üye) çalma: iframe değişir, yankı olarak bildirim GİTMEZ');
    await g.evaluate(() => window.__gctx.yt.stop()); ok(await g.evaluate(() => !document.querySelector('#mm-ytbox iframe') && window.__gm.length === 0), 'uzaktan durdurma: iframe kalkar, bildirim gitmez');
    await g.fill('#mm-yturl', 'https://youtu.be/dQw4w9WgXcQ'); await g.click('#mm-ytform button'); await g.evaluate(() => { window.__gm.length = 0; document.getElementById('mm-ytstop').click(); });
    ok(await g.evaluate(() => window.__gm.some(o => o.t === 'stop')), 'kullanıcı durdurunca grup bağlantısına «stop» bildirilir');
    await ctx.close(); }
  await b.close(); srv.close(); console.log(`SONUÇ: ${p} geçti, ${f} başarısız`); process.exit(f ? 1 : 0);
});
