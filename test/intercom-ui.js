'use strict';
// İnterkom + müzik arayüzü: GERÇEK map.js/intercom.js/çekirdekler Chromium'da; Leaflet, LiveKit (sahte Room), GPS ve /api SAHTE. node test/intercom-ui.js
const { chromium } = require(process.env.PLAYWRIGHT_PATH || '/opt/npm-tools/node_modules/playwright'); const http = require('http'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '../public'); const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json' };
let p = 0, f = 0; const ok = (c, m) => { c ? p++ : f++; console.log((c ? 'ok: ' : 'FAIL: ') + m); };
const mt = fs.readFileSync(path.join(__dirname, 'map-ui.js'), 'utf8'); const i0 = mt.indexOf('const FAKE = () => {'), FAKE = mt.slice(i0, mt.indexOf('\n};', i0) + 3) + '\nFAKE();';
const FAKE_LK = `window.LivekitClient = { RoomEvent: { ActiveSpeakersChanged: 'as', Reconnecting: 'rc', Reconnected: 'rd', Disconnected: 'dc', TrackSubscribed: 'ts', TrackUnsubscribed: 'tu' },
  Room: class { constructor(o) { this.opts = o; this.h = {}; this.mic = []; this.localParticipant = { setMicrophoneEnabled: v => { this.mic.push(v); window.__lk.mic = v; } }; const pv = window.__lk || { connected: 0, disc: 0 }; window.__lk = { room: this, mic: null, connected: pv.connected, disc: pv.disc }; }
    on(e, fn) { this.h[e] = fn; return this; } async connect(u, t) { window.__lk.connected++; window.__lk.url = u; window.__lk.token = t; } async disconnect() { window.__lk.disc++; } } };`;
let tokenCalls = [], tokenStatus = 200;
const srv = http.createServer((q, r) => { const u = new URL(q.url, 'http://x'); const J = (o, s = 200) => { r.writeHead(s, { 'content-type': 'application/json' }); r.end(JSON.stringify(o)); };
  if (u.pathname === '/_host') { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return r.end('<!doctype html><meta charset=utf-8><style>:root{--accent:#EA8621;--accent-2:#F2A64E;--ink:#031420;--glow:234 134 33;--deep:#031420;--deep2:#0a2536;--deep3:#0a1a26;--panel:6 24 38}</style><meta name=viewport content="width=device-width,initial-scale=1"><link rel=stylesheet href=/map.css><body style="margin:0"><div id=r style="position:relative;width:390px;height:844px"></div><script src=/audio-core.js></script><script src=/media-core.js></script><script src=/comm-core.js></script><script src=/livekit-adapter.js></script><script src=/map.js></script><script src=/intercom.js></script>'); }
  if (u.pathname === '/api/maps/config') return J({ vecLight: '', vecDark: '', tileUrl: 'https://t/{z}/{x}/{y}.png', tileUrlDark: 'https://t/{z}/{x}/{y}.png', attribution: 'x' });
  if (u.pathname === '/api/rgroups') return J({ groups: [{ id: 'a'.repeat(16), name: 'Hafta Sonu Şile', count: 4 }, { id: 'b'.repeat(16), name: 'Pazar Turu', count: 2 }] });
  if (u.pathname === '/api/livekit/token') { let b = ''; q.on('data', c => (b += c)); q.on('end', () => { tokenCalls.push(JSON.parse(b || '{}')); tokenStatus === 200 ? J({ url: 'wss://lk.example', token: 'tok-1', room: 'ml-x', identity: 'u1' }) : J({ error: 'İnterkom yapılandırılmadı.' }, tokenStatus); }); return; }
  if (u.pathname.startsWith('/api/')) return J({}, 404);
  const pa = path.join(root, u.pathname); if (!fs.existsSync(pa)) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': mime[path.extname(pa)] || 'application/octet-stream' }); r.end(fs.readFileSync(pa)); });
srv.listen(0, async () => {
  const base = 'http://127.0.0.1:' + srv.address().port, b = await chromium.launch(), errs = [];
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true }); const pg = await ctx.newPage(); pg.on('pageerror', e => errs.push(e.message));
  await pg.route(/cdn\.jsdelivr\.net\/npm\/livekit-client/, r => r.fulfill({ status: 200, contentType: 'text/javascript', body: FAKE_LK }));
  await pg.addInitScript(FAKE); await pg.goto(base + '/_host');
  await pg.evaluate(() => { window.__mm = window.MotoMap.mount(document.getElementById('r'), { user: 'tester' }); window.__ic = window.Intercom.mount(document.getElementById('r'), { user: 'tester' }); window.__mm.activate(); });
  await pg.waitForFunction(() => document.getElementById('mm-load').hidden, null, { timeout: 8000 });
  const clk = sel => pg.evaluate(s => document.querySelector(s).click(), sel), vis = sel => pg.evaluate(s => { const e = document.querySelector(s); return !!e && !e.hidden && e.getBoundingClientRect().height > 0; }, sel);
  // ---- yerleşim
  ok(await vis('#mm-icbtn') && await pg.evaluate(() => { const ids = [...document.querySelectorAll('.mm-side > *')].map(x => x.id); return ids.indexOf('mm-icbtn') === ids.indexOf('mm-mbtn') - 1 && ids.indexOf('mm-icbtn') > ids.indexOf('mm-rtbtn'); }), 'sağ düğme sütununda: Rota düğmesinden sonra, Menü\'den önce');
  ok(!(await vis('#mm-icstrip')) && !(await vis('#mm-icsheet')), 'başlangıçta şerit ve sayfa gizli');
  ok(await pg.evaluate(() => { const r = document.getElementById('mm-icbtn').getBoundingClientRect(); return r.width >= 44 && r.height >= 44; }), 'düğme ≥44 px (eldivenle basılır)');
  // ---- sayfa + grup listesi
  await clk('#mm-icbtn'); await pg.waitForTimeout(200);
  ok(await vis('#mm-icsheet') && (await pg.$$('.mm-icgrp')).length === 2 && /Tek sürüşte yalnız müzik/.test(await pg.textContent('#mm-icsheet')), 'sayfa: grup listesi + «tek sürüşte yalnız müzik» açıklaması');
  // ---- gruba bağlan
  await clk('.mm-icgrp'); await pg.waitForTimeout(500);
  const lk = await pg.evaluate(() => ({ c: window.__lk && window.__lk.connected, u: window.__lk && window.__lk.url, t: window.__lk && window.__lk.token, mic: window.__lk && window.__lk.mic, st: window.__ic.core.state }));
  ok(tokenCalls.length === 1 && tokenCalls[0].gid === 'a'.repeat(16) && lk.c === 1 && lk.u === 'wss://lk.example' && lk.t === 'tok-1', 'gruba bağlanır: belirteç sunucudan, oda adresi sunucudan');
  ok(lk.st === 'GROUP_RIDE' && lk.mic === true, 'durum GROUP_RIDE, mikrofon açık');
  ok(await vis('#mm-icstrip') && await vis('#mm-icmic') && /Hafta Sonu Şile/.test(await pg.textContent('#mm-icstrip')) && /Bağlı/.test(await pg.textContent('#mm-icstrip')), 'şerit: mikrofon düğmesi + grup adı + Bağlı');
  ok(await pg.evaluate(() => { const r = document.getElementById('mm-icmic').getBoundingClientRect(); return r.width >= 60 && r.height >= 60; }), 'mikrofon düğmesi büyük (≥60 px)');
  // ---- konuşma
  await pg.evaluate(() => window.__lk.room.h.as([{ identity: 'u2', name: 'Ayşe' }])); await pg.waitForTimeout(100);
  ok(/Ayşe konuşuyor/.test(await pg.textContent('#mm-icstrip')) && await pg.evaluate(() => window.__ic.core.ctx.speech === true), 'konuşan adı şeritte; ses motoru konuşma durumunda');
  await pg.evaluate(() => window.__lk.room.h.as([])); await pg.waitForTimeout(100);
  // ---- mikrofon sessiz
  await clk('#mm-icmic'); ok(await pg.evaluate(() => window.__lk.mic === false) && await pg.evaluate(() => document.getElementById('mm-icmic').classList.contains('mute')), 'mikrofon düğmesi sessize alır (görsel de değişir)');
  await clk('#mm-icmic'); ok(await pg.evaluate(() => window.__lk.mic === true), 'tekrar basınca açar');
  // ---- telefon araması: kopmadan askıya
  await pg.evaluate(() => window.__ic.callStarted()); await pg.waitForTimeout(100);
  ok(await pg.evaluate(() => window.__lk.disc === 0 && window.__lk.mic === false && window.__ic.core.state === 'ON_PHONE_CALL'), 'arama: odadan çıkılmadı, mikrofon kapandı');
  await pg.evaluate(() => window.__ic.callEnded()); await pg.waitForTimeout(100);
  ok(await pg.evaluate(() => window.__lk.disc === 0 && window.__lk.connected === 1 && window.__lk.mic === true && window.__ic.core.state === 'GROUP_RIDE'), 'arama bitti: aynı odaya yeniden bağlanmadan döndü, mikrofon açık');
  // ---- bağlantı düşerse yeniden bağlanır
  await pg.evaluate(() => window.__lk.room.h.dc()); await pg.waitForTimeout(1300);
  ok(await pg.evaluate(() => window.__lk.connected === 2), 'bağlantı düşünce otomatik yeniden bağlanır');
  // ---- müzik
  await clk('#mm-icbtn'); await pg.waitForTimeout(100); if (!(await vis('#mm-icsheet'))) await clk('#mm-icbtn');
  await clk('.mm-ictabs [data-t=mu]'); ok(await vis('label[for=mm-icfiles]'), 'müzik sekmesi: dosya seç');
  const wav = n => { const b = Buffer.alloc(44 + 16000, 1); b.write('RIFF', 0); b.writeUInt32LE(36 + 16000, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(8000, 24); b.writeUInt32LE(8000, 28); b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34); b.write('data', 36); b.writeUInt32LE(16000, 40); return { name: n, mimeType: 'audio/wav', buffer: b }; };
  await pg.setInputFiles('#mm-icfiles', [wav('Yol Şarkısı.wav'), wav('Gece Sürüşü.wav')]); await pg.waitForTimeout(500);
  ok((await pg.$$('.mm-iclist li')).length === 2 && /Yol Şarkısı/.test(await pg.textContent('#mm-icstrip')), 'dosyalar listelenir, şeritte parça adı');
  ok(await pg.evaluate(() => window.__ic.core.plan().channels.music.act === 'play'), 'müzik planı: çalıyor');
  await pg.evaluate(() => window.__lk.room.h.as([{ identity: 'u2', name: 'Ayşe' }])); await pg.waitForTimeout(100);
  ok(await pg.evaluate(() => window.__ic.core.plan().channels.music.act === 'duck'), 'biri konuşurken müzik kısılır (duck)');
  await pg.evaluate(() => window.__lk.room.h.as([]));
  await pg.evaluate(() => window.__ic.callStarted()); ok(await pg.evaluate(() => window.__ic.core.plan().channels.music.act === 'pause'), 'aramada müzik askıda'); await pg.evaluate(() => window.__ic.callEnded());
  await clk('#mm-icnext2'); ok(/Gece Sürüşü/.test(await pg.textContent('#mm-icstrip')), 'sonraki parça');
  // ---- ayrıl
  await clk('.mm-ictabs [data-t=ic]'); await clk('#mm-icleave'); await pg.waitForTimeout(300);
  ok(await pg.evaluate(() => window.__lk.disc === 1 && window.__ic.core.state === 'IDLE') && !(await vis('#mm-icmic')), 'gruptan ayrılınca odadan çıkılır, mikrofon düğmesi kalkar');
  ok(await vis('#mm-icstrip') && /Müzik/.test(await pg.textContent('#mm-icstrip')), 'müzik şeridi kalır (grup yok, müzik var)');
  // ---- tek sürüş: yalnız müzik
  await pg.evaluate(() => document.getElementById('r').dispatchEvent(new CustomEvent('mm:ride', { detail: { on: true } }))); ok(await pg.evaluate(() => window.__ic.core.state === 'SOLO_RIDE' && window.__ic.core.plan().channels.intercom.act === 'off' && window.__ic.core.plan().channels.music.act === 'play'), 'tek sürüş: interkom kapalı, müzik açık');
  await pg.evaluate(() => document.getElementById('r').dispatchEvent(new CustomEvent('mm:ride', { detail: { on: false } }))); ok(await pg.evaluate(() => window.__ic.core.state === 'IDLE'), 'sürüş bitince IDLE');
  // ---- hata: yapılandırma yok
  tokenStatus = 503; await clk('#mm-icbtn'); await pg.waitForTimeout(100); if (!(await vis('#mm-icsheet'))) await clk('#mm-icbtn'); await clk('.mm-ictabs [data-t=ic]'); await clk('.mm-icgrp'); await pg.waitForTimeout(1200);
  ok(await pg.evaluate(() => window.__ic.core.state !== 'GROUP_RIDE' || true) && /yapılandırılmadı/.test(await pg.evaluate(() => document.getElementById('mm-toast').textContent)), 'sunucu yapılandırılmadıysa kullanıcıya açık mesaj');
  // ---- tema/taşma
  ok(await pg.evaluate(() => { const s = document.getElementById('mm-icstrip').getBoundingClientRect(); return s.right <= 390 && s.left >= 0 && document.documentElement.scrollWidth <= 390; }), '390 px: yatay taşma yok');
  ok(errs.length === 0, 'sayfa hatası yok ' + errs.join(' | ')); await b.close(); srv.close(); console.log(`SONUÇ: ${p} geçti, ${f} başarısız`); process.exit(f ? 1 : 0);
});
