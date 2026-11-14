'use strict';
// Grup etkinlikleri arayüzü + müzik paylaşımı seçimi: GERÇEK group-ride.js + group-events.js + map.css Chromium'da; soket, harita ve /api SAHTE. node test/events-ui.js
const { chromium } = require(process.env.PLAYWRIGHT_PATH || '/opt/npm-tools/node_modules/playwright'); const http = require('http'), fs = require('fs'), path = require('path');
let p = 0, f = 0; const ok = (c, m) => { c ? p++ : f++; console.log((c ? 'ok: ' : 'FAIL: ') + m); };
const mime = { '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const HOST = `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/map.css"><style>body{margin:0;background:#031420;color:#fff;--nav:64px}.mm{position:fixed;inset:0}</style></head><body>
<div class="mm" id="root"><div id="mm-gsheet" class="mm-gsheet" hidden></div><div id="mm-gchip" hidden></div><button id="mm-gbtn" hidden></button><div id="mm-modal" class="mm-modal" hidden></div></div>
<script>
(function () {
  const ROLE = new URLSearchParams(location.search).get('r') || 'leader';
  const H = {}; window.__emits = []; window.__toasts = []; window.__yt = []; window.__layers = 0; window.__fit = 0;
  const sock = { connected: true, id: 's1', on(e, f) { (H[e] = H[e] || []).push(f); return sock; }, emit(e, d, cb) { window.__emits.push([e, d]); if (typeof cb === 'function') setTimeout(() => cb(e === 'grp:music' && window.__nack ? { error: window.__nack } : { ok: true, shared: true }), 0); }, timeout() { return { emit: (e, d, cb) => sock.emit(e, d, (a) => cb(null, a)) }; } };
  window.__fire = (e, d) => (H[e] || []).forEach(f => f(d));
  const modalEl = document.getElementById('mm-modal');
  const layer = () => ({ addTo() { window.__layers++; return this; }, remove() { window.__layers--; } });
  const L = { polyline: layer, marker: layer, divIcon: o => o };
  const ctx = new Proxy({ sock, $: id => document.getElementById(id), esc: s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])), toast: t => window.__toasts.push(t),
    modal: h => { modalEl.innerHTML = '<div class="mm-mcard">' + h + '</div>'; modalEl.hidden = false; }, closeModal: () => { modalEl.hidden = true; modalEl.innerHTML = ''; }, modalEl,
    store: { get: (k, d) => d, set() {} }, haversine: () => 0, user: ROLE === 'leader' ? 'ayse' : 'burak', currentRoute: () => null, me: () => ({ lat: 41.01, lon: 29.02 }), isActive: () => true, refresh() {}, openAnalysis() {}, map: () => ({}), L: () => L, fitPoints: () => { window.__fit++; },
    yt: { play: (id, pl) => window.__yt.push(['play', id, pl]), stop: () => window.__yt.push(['stop']), cmd: c => window.__yt.push(['cmd', c]), playing: v => window.__yt.push(['playing', v]), active: () => window.__ytActive !== false } }, { get: (t, k) => (k in t ? t[k] : () => {}) });
  const sc = document.createElement('script'); sc.src = '/group-ride.js'; sc.onload = () => { window.__gr = GroupRide.mount(ctx); window.__ready = true; }; document.body.appendChild(sc);
})();
</script></body></html>`;
const pt = (n, la, lo) => ({ name: n, lat: la, lon: lo });
const srv = http.createServer((q, r) => {
  const u = new URL(q.url, 'http://x'), J = (o, s = 200) => { r.writeHead(s, { 'content-type': 'application/json' }); r.end(JSON.stringify(o)); };
  const leader = (u.searchParams.get('r') || (q.headers.referer || '').includes('r=member') ? 'member' : 'leader') === 'leader';
  if (u.pathname === '/host.html') { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return r.end(HOST); }
  if (u.pathname === '/api/rgroups') return J({ groups: [{ id: 'g1', name: 'Hafta Sonu', role: leader ? 'leader' : 'member', leader: 'ayse', count: 2, active: true, hasRoute: false }] });
  if (u.pathname === '/api/rgroups/g1') return J({ group: { id: 'g1', name: 'Hafta Sonu', role: leader ? 'leader' : 'member', leader: 'ayse', code: 'ABCD2345', gap: 1000, ride: { id: 'r1', startedAt: Date.now() }, route: null, members: [{ username: 'ayse', name: 'Ayse', role: 'leader' }, { username: 'burak', name: 'Burak', role: 'member' }] } });
  if (u.pathname === '/api/geocode') return J({ results: [{ title: u.searchParams.get('q') + ' Merkez', subtitle: 'İstanbul', lat: 41.1, lon: 29.5 }, { title: u.searchParams.get('q') + ' Sahil', subtitle: 'İstanbul', lat: 41.2, lon: 29.6 }] });
  if (u.pathname.startsWith('/api/rgroups/g1/events')) {
    const m = q.method; let body = ''; q.on('data', c => body += c); q.on('end', () => {
      srv.calls.push([m, u.pathname, body ? JSON.parse(body) : null]);
      if (m === 'GET') return J({ events: srv.events, canEdit: leader });
      if (m === 'POST') { const e = { id: 'e' + (srv.events.length + 1), by: 'ayse', createdAt: Date.now(), ...JSON.parse(body) }; srv.events.push(e); return J({ event: e, events: srv.events }); }
      if (m === 'PUT') { const id = u.pathname.split('/').pop(); srv.events = srv.events.map(e => (e.id === id ? { ...e, ...JSON.parse(body) } : e)); return J({ events: srv.events }); }
      if (m === 'DELETE') { const id = u.pathname.split('/').pop(); srv.events = srv.events.filter(e => e.id !== id); return J({ ok: true, events: srv.events }); }
    }); return;
  }
  if (u.pathname.startsWith('/api/')) return J({}, 404);
  const pa = path.join(__dirname, '../public', u.pathname); if (!fs.existsSync(pa)) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { 'content-type': mime[path.extname(pa)] || 'application/octet-stream' }); fs.createReadStream(pa).pipe(r);
});
srv.calls = []; srv.events = [];
srv.listen(0, async () => {
  const base = 'http://127.0.0.1:' + srv.address().port, b = await chromium.launch(), errs = [];
  const open = async role => { const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true }), pg = await ctx.newPage(); pg.on('pageerror', e => errs.push(role + ': ' + e.message)); await pg.goto(base + '/host.html?r=' + role); await pg.waitForFunction(() => window.__ready); await pg.waitForTimeout(500); return pg; };
  const T = pg => pg.evaluate(() => document.getElementById('mm-gsheet').innerText);
  const A = await open('leader');
  await A.evaluate(() => document.getElementById('mm-gbtn').click()); await A.waitForFunction(() => /Etkinlikler/.test(document.getElementById('mm-gsheet').innerText), null, { timeout: 5000 });
  ok(/Etkinlikler/.test(await T(A)) && await A.isVisible('[data-g=events]'), 'grup sayfasında «Etkinlikler» bölümü ve düğmesi var');
  await A.click('[data-g=events]'); await A.waitForFunction(() => /Henüz etkinlik yok/.test(document.getElementById('mm-gsheet').innerText), null, { timeout: 5000 });
  ok(await A.isVisible('[data-ev=new]'), 'lider: «Yeni Etkinlik» düğmesi görünür; liste boş');
  await A.click('[data-ev=new]'); await A.fill('#mm-ev-title', 'Şile Turu'); await A.fill('#mm-ev-at', '2099-01-01T09:00');
  ok(await A.evaluate(() => /Başlangıç yeri/.test(document.getElementById('mm-gsheet').innerText) && /Varış noktası/.test(document.getElementById('mm-gsheet').innerText)), 'form: başlangıç yeri ve varış noktası alanları');
  await A.click('[data-ev=save]'); ok(await A.evaluate(() => window.__toasts.some(t => /Başlangıç/.test(t))), 'başlangıç yeri seçilmeden kaydedilmez');
  await A.click('[data-ev=find][data-s=start]'); await A.fill('#mm-ev-q', 'Kadıköy'); await A.click('[data-ev=go]'); await A.waitForSelector('[data-ev=use]'); await A.click('[data-ev=use][data-i="0"]');
  ok(/Kadıköy Merkez/.test(await T(A)), 'arama sonucundan başlangıç yeri seçilir');
  await A.click('[data-ev=add]'); ok(await A.$$eval('[data-ev=rm]', e => e.length) === 1, 'mola/uğrak noktası eklenir');
  await A.selectOption('select[data-ef=kind]', 'ugrak'); await A.click('[data-ev=me][data-s="0"]'); ok(/Konumum/.test(await T(A)) && /Uğrak 1/.test(await T(A)), 'uğrak türü seçilir, «Konumum» ile nokta alınır');
  await A.click('[data-ev=find][data-s=dest]'); await A.fill('#mm-ev-q', 'Şile'); await A.click('[data-ev=go]'); await A.waitForSelector('[data-ev=use]'); await A.click('[data-ev=use][data-i="1"]');
  await A.fill('#mm-ev-note', 'Kask şart'); await A.click('[data-ev=save]'); await A.waitForFunction(() => /Şile Turu/.test(document.getElementById('mm-gsheet').innerText) && /durak/.test(document.getElementById('mm-gsheet').innerText), null, { timeout: 5000 });
  const post = srv.calls.find(c => c[0] === 'POST'); ok(post && post[2].title === 'Şile Turu' && post[2].start.name === 'Kadıköy Merkez' && post[2].dest.name === 'Şile Sahil' && post[2].stops.length === 1 && post[2].stops[0].kind === 'ugrak' && post[2].note === 'Kask şart' && post[2].at > Date.now(), 'kayıt isteği: başlangıç, varış, uğrak (tür), not, tarih');
  ok(/Kadıköy Merkez → Şile Sahil · 1 durak/.test(await T(A)), 'etkinlik kartı: güzergâh özeti');
  await A.click('[data-ev=map]'); await A.waitForTimeout(150); ok(await A.evaluate(() => window.__layers === 4 && window.__fit === 1), 'haritada göster: çizgi + başlangıç, uğrak, varış işaretleri (4 katman), harita sığdırılır');
  await A.evaluate(() => document.getElementById('mm-gbtn').click()); await A.waitForTimeout(100);
  await A.click('[data-g=events]'); await A.waitForSelector('[data-ev=edit]'); await A.click('[data-ev=edit]'); ok(await A.inputValue('#mm-ev-title') === 'Şile Turu' && await A.inputValue('#mm-ev-at') === '2099-01-01T09:00', 'düzenle: kayıtlı değerler forma dolar');
  await A.fill('#mm-ev-title', 'Şile Turu 2'); await A.click('[data-ev=save]'); await A.waitForFunction(() => /Şile Turu 2/.test(document.getElementById('mm-gsheet').innerText), null, { timeout: 5000 }); ok(srv.calls.some(c => c[0] === 'PUT' && c[2].title === 'Şile Turu 2'), 'düzenleme PUT ile kaydedilir');
  await A.click('[data-ev=del]'); await A.waitForSelector('[data-gact=yes]'); await A.click('[data-gact=yes]'); await A.waitForFunction(() => /Henüz etkinlik yok/.test(document.getElementById('mm-gsheet').innerText), null, { timeout: 5000 }); ok(srv.calls.some(c => c[0] === 'DELETE'), 'silme onaydan sonra yapılır');
  ok(await A.evaluate(() => { const s = document.getElementById('mm-gsheet'); return s.scrollWidth <= s.clientWidth + 1; }), 'etkinlik ekranı yatay taşmaz (390 px)');
  // ---- müzik (lider)
  const vid = { video: 'dQw4w9WgXcQ', list: null };
  await A.evaluate(v => window.__gr.musicLocal({ t: 'play', id: v }), vid); await A.waitForSelector('[data-gmu=share]');
  ok(await A.isVisible('[data-gmu=solo]') && /Etkinlikte Paylaş/.test(await A.textContent('[data-gmu=share]')) && /Sadece Kendim/.test(await A.textContent('[data-gmu=solo]')), 'lider çalmaya başlayınca iki seçenek sorulur: Etkinlikte Paylaş / Sadece Kendim Dinleyeyim');
  await A.click('[data-gmu=solo]'); ok(await A.evaluate(() => !window.__emits.some(e => e[0] === 'grp:music')), '«Sadece kendim»: sunucuya hiçbir şey gönderilmez');
  await A.evaluate(() => window.__gr.musicLocal({ t: 'toggle', playing: false })); ok(await A.evaluate(() => !window.__emits.some(e => e[0] === 'grp:music')), 'paylaşmıyorken durdur/devam üyelere gitmez');
  await A.evaluate(v => window.__gr.musicLocal({ t: 'play', id: v }), vid); await A.click('[data-gmu=share]'); await A.waitForTimeout(100);
  ok(await A.evaluate(() => window.__emits.some(e => e[0] === 'grp:music' && e[1].src && e[1].src.video === 'dQw4w9WgXcQ' && e[1].playing === true && e[1].gid === 'g1')), '«Etkinlikte paylaş»: grp:music src ile gider');
  await A.evaluate(() => { window.__emits.length = 0; window.__gr.musicLocal({ t: 'toggle', playing: false }); window.__gr.musicLocal({ t: 'cmd', cmd: 'next' }); });
  ok(await A.evaluate(() => window.__emits.some(e => e[1].playing === false) && window.__emits.some(e => e[1].cmd === 'next')), 'paylaşırken duraklat ve sonraki üyelere gider');
  await A.evaluate(() => window.__gr.open('main')); await A.waitForTimeout(200);
  ok(/paylaşılıyor/.test(await T(A)) && await A.isVisible('[data-g=mstop]'), 'sayfada «müzik paylaşılıyor» ve durdurma düğmesi');
  await A.click('[data-g=mstop]'); ok(await A.evaluate(() => window.__emits.some(e => e[0] === 'grp:music' && e[1].src === null)), 'paylaşımı durdur: src=null gider');
  await A.evaluate(() => { window.__emits.length = 0; window.__nack = 'Aktif grup sürüşü yok.'; }); await A.evaluate(v => window.__gr.musicLocal({ t: 'play', id: v }), vid); await A.click('[data-gmu=share]'); await A.waitForTimeout(150);
  ok(await A.evaluate(() => window.__toasts.some(t => /Aktif grup sürüşü yok/.test(t))), 'sunucu reddederse kullanıcıya bildirilir');
  // ---- üye
  const B = await open('member');
  await B.evaluate(() => document.getElementById('mm-gbtn').click()); await B.waitForFunction(() => /Etkinlikler/.test(document.getElementById('mm-gsheet').innerText), null, { timeout: 5000 });
  await B.click('[data-g=events]'); await B.waitForFunction(() => /Henüz etkinlik yok/.test(document.getElementById('mm-gsheet').innerText) || /Lider ya da yönetici/.test(document.getElementById('mm-gsheet').innerText), null, { timeout: 5000 });
  ok(!(await B.$('[data-ev=new]')) && /Lider ya da yönetici etkinlik ekleyebilir/.test(await T(B)), 'üye: «Yeni Etkinlik» yok, bilgi notu var');
  srv.events = [{ id: 'x1', title: 'Cumartesi Turu', at: Date.now() + 1e8, start: pt('A', 41, 29), dest: pt('B', 41.2, 29.6), stops: [{ ...pt('Mola', 41.1, 29.3), kind: 'mola' }], note: '', by: 'ayse', createdAt: 1 }];
  await B.evaluate(() => window.__fire('grp:changed', { gid: 'g1', kind: 'events' })); await B.waitForFunction(() => /Cumartesi Turu/.test(document.getElementById('mm-gsheet').innerText), null, { timeout: 5000 });
  ok(!(await B.$('[data-ev=edit]')) && !(await B.$('[data-ev=del]')) && await B.isVisible('[data-ev=map]'), 'üye: Düzenle/Sil yok, haritada gösterebilir; grp:changed ile liste canlı yenilenir');
  const mus = (extra) => B.evaluate(m => window.__fire('grp:music', m), extra);
  await mus({ gid: 'g1', music: { video: 'dQw4w9WgXcQ', list: null, playing: true, seq: 1, by: 'ayse' } }); await B.waitForSelector('[data-gml=on]');
  ok(/ayse/.test(await B.textContent('#mm-modal')) && await B.evaluate(() => window.__yt.length === 0), 'üye: lider paylaşınca önce sorulur, kendiliğinden çalmaz');
  await B.click('[data-gml=on]'); ok(await B.evaluate(() => window.__yt.some(y => y[0] === 'play' && y[1].video === 'dQw4w9WgXcQ' && y[2] === true)), '«Dinle»: lider müziği üyenin cihazında çalmaya başlar');
  await mus({ gid: 'g1', music: { video: 'dQw4w9WgXcQ', list: null, playing: true, seq: 2, by: 'ayse' }, cmd: 'next' }); ok(await B.evaluate(() => window.__yt.some(y => y[0] === 'cmd' && y[1] === 'next')), 'lider sonraki parçaya geçince üyede de geçer');
  await mus({ gid: 'g1', music: { video: 'dQw4w9WgXcQ', list: null, playing: false, seq: 3, by: 'ayse' } }); ok(await B.evaluate(() => window.__yt.some(y => y[0] === 'playing' && y[1] === false)), 'lider duraklatınca üyede de duraklar');
  await mus({ gid: 'g1', music: { video: 'aaaaaaaaaaa', list: null, playing: true, seq: 4, by: 'ayse' } }); ok(await B.evaluate(() => window.__yt.filter(y => y[0] === 'play').length === 2 && window.__yt.filter(y => y[0] === 'play')[1][1].video === 'aaaaaaaaaaa'), 'lider başka parça açınca üye otomatik geçer (tekrar sormaz)');
  await mus({ gid: 'g1', music: { video: 'aaaaaaaaaaa', list: null, playing: true, seq: 4, by: 'ayse' } }); ok(await B.evaluate(() => window.__yt.filter(y => y[0] === 'play').length === 2), 'aynı sıra numarası ikinci kez uygulanmaz');
  await mus({ gid: 'g1', music: null }); ok(await B.evaluate(() => window.__yt.some(y => y[0] === 'stop')), 'lider paylaşımı bırakınca üyenin müziği durur');
  await mus({ gid: 'zzz', music: { video: 'bbbbbbbbbbb', list: null, playing: true, seq: 9, by: 'x' } }); ok(await B.evaluate(() => !document.querySelector('[data-gml]') && window.__yt.filter(y => y[0] === 'play').length === 2), 'başka gruptan gelen müzik yok sayılır');
  const C = await open('member'); await mus.call(null, 0).catch(() => {});
  await C.evaluate(() => window.__fire('grp:music', { gid: 'g1', music: { video: 'dQw4w9WgXcQ', list: null, playing: true, seq: 1, by: 'ayse' } })); await C.waitForSelector('[data-gml=off]'); await C.click('[data-gml=off]');
  await C.evaluate(() => window.__fire('grp:music', { gid: 'g1', music: { video: 'dQw4w9WgXcQ', list: null, playing: true, seq: 2, by: 'ayse' } })); await C.waitForTimeout(150);
  ok(await C.evaluate(() => window.__yt.length === 0 && !document.querySelector('[data-gml]')), '«Şimdi Değil»: müzik çalmaz ve tekrar sorulmaz');
  ok(errs.length === 0, 'sayfa hatası yok ' + JSON.stringify(errs.slice(0, 3)));
  await b.close(); srv.close(); console.log(`SONUÇ: ${p} geçti, ${f} başarısız`); process.exit(f ? 1 : 0);
});
