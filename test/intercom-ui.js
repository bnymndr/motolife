'use strict';
// İnterkom + müzik arayüzü: GERÇEK map.js/intercom.js/çekirdekler Chromium'da; Leaflet, LiveKit (sahte Room), GPS ve /api SAHTE. node test/intercom-ui.js
const { chromium } = require(process.env.PLAYWRIGHT_PATH || '/opt/npm-tools/node_modules/playwright'); const http = require('http'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '../public'); const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json' };
let p = 0, f = 0; const ok = (c, m) => { c ? p++ : f++; console.log((c ? 'ok: ' : 'FAIL: ') + m); };
const mt = fs.readFileSync(path.join(__dirname, 'map-ui.js'), 'utf8'); const i0 = mt.indexOf('const FAKE = () => {'), FAKE = mt.slice(i0, mt.indexOf('\n};', i0) + 3) + '\nFAKE();';
const FAKE_LK = `window.LivekitClient = { RoomEvent: { ActiveSpeakersChanged: 'as', Reconnecting: 'rc', Reconnected: 'rd', Disconnected: 'dc', TrackSubscribed: 'ts', TrackUnsubscribed: 'tu' },
  Room: class { constructor(o) { this.opts = o; this.h = {}; this.mic = []; this.localParticipant = { setMicrophoneEnabled: v => { this.mic.push(v); window.__lk.mic = v; } }; const pv = window.__lk || { connected: 0, disc: 0 }; window.__lk = { room: this, mic: null, connected: pv.connected, disc: pv.disc }; }
    on(e, fn) { this.h[e] = fn; return this; } async connect(u, t) { window.__lk.connected++; window.__lk.url = u; window.__lk.token = t; } async disconnect() { window.__lk.disc++; } } };`;
const FAKE_MESH = `(() => { const H = {}; window.__sock = { em: [], on(e, f) { (H[e] = H[e] || []).push(f); return this; }, off(e, f) { H[e] = (H[e] || []).filter(x => x !== f); return this; },
    emit(e, d, cb) { this.em.push([e, d]); if (e === 'gv:join') setTimeout(() => cb && cb({ ok: true, id: 'me', peers: [{ id: 'p1', name: 'Ayşe' }] }), 5); else if (typeof cb === 'function') cb({ ok: true }); }, fire(e, d) { (H[e] || []).slice().forEach(f => f(d)); } };
  window.__rtc = { made: 0, closed: 0, tracks: 0 };
  window.RTCPeerConnection = class { constructor(c) { window.__rtc.made++; this.cfg = c; this.localDescription = null; } addTrack() { window.__rtc.tracks++; } async createOffer() { return { type: 'offer', sdp: 'o' }; } async setLocalDescription(d) { this.localDescription = d; } close() { window.__rtc.closed++; } };
  window.__trk = { enabled: true, stop() { window.__trk.stopped = true; } };
  try { Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: async () => ({ getAudioTracks: () => [window.__trk], getTracks: () => [window.__trk] }) }, configurable: true }); } catch (e) {}
})();`;
const FAKE_YT = `window.YT = { Player: class { constructor(el, o) { window.__yt = { opts: o, calls: [] , vol: null }; this.o = o; setTimeout(() => o.events.onReady({ target: this }), 5); } playVideo() { window.__yt.calls.push('play'); this.o.events.onStateChange({ data: 1 }); } pauseVideo() { window.__yt.calls.push('pause'); this.o.events.onStateChange({ data: 2 }); } stopVideo() { window.__yt.calls.push('stop'); this.o.events.onStateChange({ data: -1 }); } setVolume(v) { window.__yt.vol = v; } loadVideoById(i) { window.__yt.calls.push('load:' + i); } destroy() {} } }; setTimeout(() => window.onYouTubeIframeAPIReady && window.onYouTubeIframeAPIReady(), 5);`;
let tokenCalls = [], tokenStatus = 200;
const srv = http.createServer((q, r) => { const u = new URL(q.url, 'http://x'); const J = (o, s = 200) => { r.writeHead(s, { 'content-type': 'application/json' }); r.end(JSON.stringify(o)); };
  if (u.pathname === '/_host') { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return r.end('<!doctype html><meta charset=utf-8><style>:root{--accent:#EA8621;--accent-2:#F2A64E;--ink:#031420;--glow:234 134 33;--deep:#031420;--deep2:#0a2536;--deep3:#0a1a26;--panel:6 24 38}</style><meta name=viewport content="width=device-width,initial-scale=1"><link rel=stylesheet href=/map.css><body style="margin:0"><div id=r style="position:relative;width:390px;height:844px"></div><script src=/audio-core.js></script><script src=/media-core.js></script><script src=/comm-core.js></script><script src=/livekit-adapter.js></script><script src=/mesh-adapter.js></script><script src=/map.js></script><script src=/intercom.js></script>'); }
  if (u.pathname === '/_radio') return J([{ name: 'Zeta FM', url_resolved: 'https://r.example/z' }, { name: 'ağaç Radyo', url_resolved: 'https://r.example/a' }, { name: 'Bozuk', url_resolved: 'http://r.example/b' }, { name: 'Alfa', url_resolved: 'https://r.example/alfa' }, { name: 'Pasif', url_resolved: 'https://r.example/p', lastcheckok: 0 }, { name: 'Bozuk Yayın', url_resolved: 'https://r.example/404', lastcheckok: 1 }, { name: 'alfa ', url_resolved: 'https://r.example/alfa2' }]);
  if (u.pathname === '/api/maps/config') return J({ vecLight: '', vecDark: '', tileUrl: 'https://t/{z}/{x}/{y}.png', tileUrlDark: 'https://t/{z}/{x}/{y}.png', attribution: 'x' });
  if (u.pathname === '/api/rgroups') return J({ groups: [{ id: 'a'.repeat(16), name: 'Hafta Sonu Şile', count: 4 }, { id: 'b'.repeat(16), name: 'Pazar Turu', count: 2 }] });
  if (u.pathname === '/api/livekit/token') { let b = ''; q.on('data', c => (b += c)); q.on('end', () => { tokenCalls.push(JSON.parse(b || '{}')); tokenStatus === 200 ? J({ url: 'wss://lk.example', token: 'tok-1', room: 'ml-x', identity: 'u1' }) : J({ error: 'İnterkom yapılandırılmadı.' }, tokenStatus); }); return; }
  if (u.pathname.startsWith('/api/')) return J({}, 404);
  const pa = path.join(root, u.pathname); if (!fs.existsSync(pa)) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': mime[path.extname(pa)] || 'application/octet-stream' }); r.end(fs.readFileSync(pa)); });
srv.listen(0, async () => {
  const base = 'http://127.0.0.1:' + srv.address().port, b = await chromium.launch(), errs = [];
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true }); const pg = await ctx.newPage(); pg.on('pageerror', e => errs.push(e.message));
  await pg.route(/r\.example/, r => { if (/404/.test(r.request().url())) return r.fulfill({ status: 404, body: 'yok' }); const b = Buffer.alloc(44 + 160000, 1); b.write('RIFF', 0); b.writeUInt32LE(36 + 160000, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(8000, 24); b.writeUInt32LE(8000, 28); b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34); b.write('data', 36); b.writeUInt32LE(160000, 40); r.fulfill({ status: 200, contentType: 'audio/wav', body: b }); });
  await pg.route(/youtube\.com\/iframe_api/, r => r.fulfill({ status: 200, contentType: 'text/javascript', body: FAKE_YT }));
  await pg.route(/cdn\.jsdelivr\.net\/npm\/livekit-client/, r => r.fulfill({ status: 200, contentType: 'text/javascript', body: FAKE_LK }));
  await pg.addInitScript(FAKE); await pg.addInitScript(FAKE_MESH); await pg.addInitScript(`(() => { const A = window.Audio; window.__auds = []; window.Audio = function (...a) { const x = new A(...a); window.__auds.push(x); return x; }; })();`); await pg.goto(base + '/_host');
  await pg.evaluate(() => { window.__mm = window.MotoMap.mount(document.getElementById('r'), { user: 'tester' }); window.__ic = window.Intercom.mount(document.getElementById('r'), { user: 'tester', socket: window.__sock, radioUrl: location.origin + '/_radio' }); window.__mm.activate(); });
  await pg.waitForFunction(() => document.getElementById('mm-load').hidden, null, { timeout: 8000 });
  const clk = sel => pg.evaluate(s => document.querySelector(s).click(), sel), vis = sel => pg.evaluate(s => { const e = document.querySelector(s); return !!e && !e.hidden && e.getBoundingClientRect().height > 0; }, sel);
  const nav = async v => { if (!(await vis('#mm-icsheet'))) await clk('#mm-icbtn'); await pg.waitForTimeout(80); for (let k = 0; k < 2 && await vis('#mm-icback'); k++) await clk('#mm-icback'); await clk('[data-v=' + v + ']'); await pg.waitForTimeout(150); };
  // ---- yerleşim
  ok(await vis('#mm-icbtn') && await pg.evaluate(() => { const ids = [...document.querySelectorAll('.mm-side > *')].map(x => x.id); return ids.indexOf('mm-icbtn') === ids.indexOf('mm-mbtn') - 1 && ids.indexOf('mm-icbtn') > ids.indexOf('mm-rtbtn'); }), 'sağ düğme sütununda: Rota düğmesinden sonra, Menü\'den önce');
  ok(!(await vis('#mm-icstrip')) && !(await vis('#mm-icsheet')), 'başlangıçta şerit ve sayfa gizli');
  ok(await pg.evaluate(() => { const r = document.getElementById('mm-icbtn').getBoundingClientRect(); return r.width >= 44 && r.height >= 44; }), 'düğme ≥44 px (eldivenle basılır)');
  // ---- panel: yalnız Müzik + Radyo (interkom burada yok), düğme nota ikonlu
  ok(await pg.evaluate(() => /M9 18V5/.test(document.getElementById('mm-icbtn').innerHTML)), 'harita düğmesi nota (müzik) ikonu');
  await clk('#mm-icbtn'); await pg.waitForTimeout(200);
  ok(await pg.evaluate(() => document.querySelectorAll('#mm-icsheet .mm-ictile').length === 2 && !/İnterkom/.test(document.getElementById('mm-icsheet').textContent.replace(/Grup interkomu:[^<]*/, ''))), 'ana ekran: yalnız Müzik ve Radyo kutusu (İnterkom kutusu yok)');
  ok(await pg.evaluate(() => /Sosyal/.test(document.getElementById('mm-icsheet').textContent)), 'not: interkom Sosyal › Gruplarım içinde');
  await nav('mu'); ok(await vis('label[for=mm-icfiles]'), 'müzik sekmesi: dosya seç');
  const wav = n => { const b = Buffer.alloc(44 + 16000, 1); b.write('RIFF', 0); b.writeUInt32LE(36 + 16000, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(8000, 24); b.writeUInt32LE(8000, 28); b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34); b.write('data', 36); b.writeUInt32LE(16000, 40); return { name: n, mimeType: 'audio/wav', buffer: b }; };
  ok(await vis('#mm-vol') && await vis('#mm-vmute'), 'müzik: ses düzeyi altta görünür');
  await pg.setInputFiles('#mm-icfiles', [wav('Yol Şarkısı.wav'), wav('Gece Sürüşü.wav')]); await pg.waitForTimeout(500);
  ok((await pg.$$('.mm-iclist li')).length === 2 && /Yol Şarkısı/.test(await pg.textContent('#mm-icstrip')), 'dosyalar listelenir, şeritte parça adı');
  ok(await pg.evaluate(() => window.__ic.core.plan().channels.music.act === 'play'), 'müzik planı: çalıyor');
  // oda konuşması (room.js → window 'ml:room') müziği kısar, arama durdurur
  await pg.evaluate(() => window.dispatchEvent(new CustomEvent('ml:room', { detail: { on: true } }))); await pg.waitForTimeout(100);
  ok(await pg.evaluate(() => window.__ic.core.state === 'GROUP_RIDE'), 'odaya girilince ses motoru GROUP_RIDE');
  await pg.evaluate(() => window.dispatchEvent(new CustomEvent('ml:room', { detail: { speaking: true } }))); await pg.waitForTimeout(100);
  ok(await pg.evaluate(() => window.__ic.core.plan().channels.music.act === 'duck'), 'odada biri konuşurken müzik kısılır (duck)');
  await pg.evaluate(() => window.dispatchEvent(new CustomEvent('ml:room', { detail: { speaking: false } })));
  await pg.evaluate(() => window.__ic.callStarted()); ok(await pg.evaluate(() => window.__ic.core.plan().channels.music.act === 'pause'), 'aramada müzik askıda'); await pg.evaluate(() => window.__ic.callEnded());
  await pg.evaluate(() => window.dispatchEvent(new CustomEvent('ml:room', { detail: { on: false } }))); await pg.waitForTimeout(100);
  ok(await pg.evaluate(() => window.__ic.core.state === 'IDLE'), 'odadan çıkınca IDLE');
  await clk('#mm-icnext2'); ok(/Gece Sürüşü/.test(await pg.textContent('#mm-icstrip')), 'sonraki parça');
  ok(await vis('#mm-icexit'), 'müzik dosyası çalarken en altta «Yayından Çık» görünür');
  // ---- tek sürüş: yalnız müzik
  await pg.evaluate(() => document.getElementById('r').dispatchEvent(new CustomEvent('mm:ride', { detail: { on: true } }))); ok(await pg.evaluate(() => window.__ic.core.state === 'SOLO_RIDE' && window.__ic.core.plan().channels.intercom.act === 'off' && window.__ic.core.plan().channels.music.act === 'play'), 'tek sürüş: interkom kapalı, müzik açık');
  await pg.evaluate(() => document.getElementById('r').dispatchEvent(new CustomEvent('mm:ride', { detail: { on: false } }))); ok(await pg.evaluate(() => window.__ic.core.state === 'IDLE'), 'sürüş bitince IDLE');
  // ---- yeni: açılır bölüm seçici, durdur, YouTube, internet radyosu
  await clk('#mm-icbtn'); await pg.waitForTimeout(100); if (!(await vis('#mm-icsheet'))) await clk('#mm-icbtn');
  ok(await pg.evaluate(() => document.querySelectorAll('#mm-icsheet .mm-ictile').length === 2 && ['Müzik', 'Radyo'].every(t => document.querySelector('#mm-icsheet').textContent.includes(t))), 'ana ekran: Müzik / Radyo kutuları (durumlarıyla)');
  ok(await pg.evaluate(() => { const r = document.getElementById('mm-icsheet').getBoundingClientRect(); return r.height <= 550 && r.height > 200; }), 'panel sabit boyutlu (≤540 px), uzamaz');
  await nav('ra'); await pg.waitForTimeout(300);
  ok(await pg.evaluate(() => /Radyo/.test(document.querySelector('#mm-icsheet .mm-gh').textContent) && !!document.getElementById('mm-rprev') && !!document.getElementById('mm-rnext') && !document.querySelector('[data-ri]')), 'radyo: zaplama kumandası var, panelde liste YOK');
  ok(/4 kanal/.test(await pg.textContent('#mm-icsheet')), 'radyo: https olmayan, pasif (lastcheckok=0) ve aynı adlı kanallar elenir (4 kanal)');
  const szA = await pg.evaluate(() => document.getElementById('mm-icsheet').getBoundingClientRect().height);
  await clk('[data-v=list]'); await pg.waitForTimeout(200);
  ok(await pg.evaluate(() => { const r = document.getElementById('mm-icsheet').getBoundingClientRect(); return r.height >= innerHeight - 2 && r.width >= innerWidth - 2; }), 'tüm kanallar: tam ekran sayfa');
  ok(await pg.evaluate(() => [...document.querySelectorAll('[data-ri]')].map(b => b.textContent).join('|') === 'ağaç Radyo|Alfa|Bozuk Yayın|Zeta FM' && [...document.querySelectorAll('.mm-icletter')].map(x => x.textContent).join('') === 'ABZ'), 'liste A-Z (Türkçe sıralama), harf başlıklı');
  await pg.fill('#mm-icq', 'zet'); await pg.waitForTimeout(100); ok(await pg.evaluate(() => [...document.querySelectorAll('[data-ri]')].length === 1 && document.activeElement.id === 'mm-icq'), 'arama süzer ve klavye odağını kaybetmez');
  await pg.fill('#mm-icq', 'bozuk'); await clk('[data-ri="2"]'); await pg.waitForTimeout(1200);
  ok(/çalmıyor, listeden çıkarıldı/.test(await pg.evaluate(() => document.getElementById('mm-toast').textContent)) && await pg.evaluate(() => JSON.parse(localStorage.getItem('ml_radio_dead') || '{}')['https://r.example/404'] > 0), 'çalmayan kanal: uyarı + listeden çıkarılır + 7 gün hatırlanır');
  ok(await pg.evaluate(() => !!document.getElementById('mm-rprev') && !document.getElementById('mm-icq')) && /Zeta FM/.test(await pg.textContent('#mm-icstrip')) && await pg.evaluate(() => window.__ic.core.ctx.musicWanted === true), 'kanal seçilince kumandaya döner, şeritte kanal adı, yayın istenir');
  ok(/3 \/ 3/.test(await pg.textContent('#mm-icsheet')) && /Zeta FM/.test(await pg.textContent('.mm-icname')), 'kumanda: kanal adı büyük + sıra «3 / 3»');
  await clk('#mm-rnext'); await pg.waitForTimeout(200); ok(/ağaç Radyo/.test(await pg.textContent('.mm-icname')), '▶ sonraki kanala geçer (sona gelince başa sarar)');
  await clk('#mm-rprev'); await pg.waitForTimeout(200); ok(/Zeta FM/.test(await pg.textContent('.mm-icname')), '◀ önceki kanala geçer');
  // ---- ses düzeyi (radyo): slider, −/+, sessiz
  ok(await pg.evaluate(() => !!document.getElementById('mm-vol') && !!document.getElementById('mm-vdn') && !!document.getElementById('mm-vup') && !!document.getElementById('mm-vmute')) && await vis('#mm-vol'), 'radyo: ses düzeyi (slider, −, +, 🔇) altta görünür');
  await pg.evaluate(() => { const r = document.getElementById('mm-vol'); r.value = 40; r.dispatchEvent(new Event('input', { bubbles: true })); });
  const v1 = await pg.evaluate(() => ({ ra: window.__auds[1].volume, au: window.__auds[0].volume, ls: localStorage.getItem('ml_vol'), t: document.getElementById('mm-vpct').textContent }));
  ok(Math.abs(v1.ra - 0.4) < 0.02 && v1.ls === '0.4' && v1.t === 'Ses %40', 'slider radyo ses düzeyini ayarlar, hatırlanır');
  await clk('#mm-vup'); ok(Math.abs(await pg.evaluate(() => window.__auds[1].volume) - 0.5) < 0.02, '+ sesi artırır'); await clk('#mm-vdn'); await clk('#mm-vdn'); ok(Math.abs(await pg.evaluate(() => window.__auds[1].volume) - 0.3) < 0.02, '− sesi azaltır');
  await clk('#mm-vmute'); ok(await pg.evaluate(() => window.__auds[1].muted === true) && /Ses %0/.test(await pg.textContent('#mm-vpct')), '🔇 radyoyu susturur'); await clk('#mm-vmute'); ok(await pg.evaluate(() => window.__auds[1].muted === false), 'tekrar basınca sesi açar');
  await pg.evaluate(() => { const r = document.getElementById('mm-vol'); r.value = 0; r.dispatchEvent(new Event('input', { bubbles: true })); }); await pg.evaluate(() => { const r = document.getElementById('mm-vol'); r.value = 60; r.dispatchEvent(new Event('input', { bubbles: true })); });
  ok(Math.abs(await pg.evaluate(() => window.__auds[1].volume) - 0.6) < 0.02, 'slider 0 → 60 geri döner');
  await pg.evaluate(() => window.__ic.setSpeed(120)); await pg.waitForTimeout(1600); const dk = await pg.evaluate(() => window.__auds[1].volume); await pg.evaluate(() => window.__ic.setSpeed(0)); await pg.waitForTimeout(1600);
  ok(dk < 0.6 && Math.abs(await pg.evaluate(() => window.__auds[1].volume) - 0.6) < 0.05, 'otomatik kısma (hız) kullanıcı ses düzeyiyle çarpılır, sonra geri döner');
  ok(Math.abs(szA - await pg.evaluate(() => document.getElementById('mm-icsheet').getBoundingClientRect().height)) < 2, 'ekran değişse de panel boyu sabit');
  ok(await vis('#mm-icexit') && /Yayından Çık/.test(await pg.textContent('#mm-icexit')), 'radyo: en altta tek satır «Yayından Çık»');
  await clk('#mm-icexit'); await pg.waitForTimeout(100);
  ok(await pg.evaluate(() => window.__ic.core.ctx.musicWanted === false) && !(await vis('#mm-icstop')) && await vis('.mm-ictile'), 'radyo «Yayından Çık»: yayın kapanır, ana ekrana döner');
  await nav('mu');
  await pg.fill('#mm-icyt', 'https://youtu.be/dQw4w9WgXcQ?si=x'); await clk('#mm-icytgo'); await pg.waitForTimeout(300);
  ok(await pg.evaluate(() => window.__yt && window.__yt.opts.videoId === 'dQw4w9WgXcQ' && window.__yt.calls.includes('play')) && /YouTube/.test(await pg.textContent('#mm-icstrip')), 'YouTube bağlantısı oynatıcıya verilir, şeritte görünür');
  ok(await pg.evaluate(() => { const sh = document.getElementById('mm-icsheet').getBoundingClientRect(), bd = document.querySelector('.mm-icbody').getBoundingClientRect(); return ['mm-icyt', 'mm-icytgo', 'mm-ytpp', 'mm-icexit', 'mm-vol'].every(id => { const r = document.getElementById(id).getBoundingClientRect(); return r.top >= sh.top && r.bottom <= sh.bottom + 1 && (id === 'mm-icexit' || id === 'mm-vol' || (r.top >= bd.top && r.bottom <= bd.bottom + 1)); }); }), 'YouTube satırı, Çal, Duraklat, ses ve Çık kaydırmadan EKRANDA görünür');
  ok(await vis('#mm-ytpp') && await vis('#mm-icytgo') && await vis('#mm-icexit') && await pg.evaluate(() => { const a = document.getElementById('mm-icyt').getBoundingClientRect(), b = document.getElementById('mm-ytpp').getBoundingClientRect(), c = document.getElementById('mm-icexit').getBoundingClientRect(); return Math.abs(a.top - b.top) < 20 && c.top > b.bottom && c.height < 70 && document.getElementById('mm-icexit').textContent.trim() === '⏏ Yayından Çık'; }), 'YouTube: link satırında Çal + Duraklat/Devam; en altta tek satır «Yayından Çık»');
  await pg.evaluate(() => window.__yt.calls.length = 0); await clk('#mm-ytpp'); await pg.waitForTimeout(500); ok(await pg.evaluate(() => window.__yt.calls.includes('pause')) && /Devam/.test(await pg.getAttribute('#mm-ytpp', 'aria-label')), 'YouTube duraklat (düğme «Devam ettir»e döner)');
  await clk('#mm-ytpp'); await pg.waitForTimeout(500); ok(await pg.evaluate(() => window.__yt.calls.includes('play')) && /Duraklat/.test(await pg.getAttribute('#mm-ytpp', 'aria-label')), 'YouTube devam ettir');
  await pg.evaluate(() => window.__ic.callStarted()); await pg.waitForTimeout(600); ok(await pg.evaluate(() => window.__yt.calls.includes('pause')), 'aramada YouTube duraklar');
  await pg.evaluate(() => window.__ic.callEnded()); await pg.waitForTimeout(100);
  await clk('#mm-icexit'); await pg.waitForTimeout(100); ok(await pg.evaluate(() => window.__yt.calls.includes('stop') && window.__ic.core.ctx.musicWanted === false) && await vis('.mm-ictile') && !(await vis('#mm-icstrip .mm-icmid')), '«Yayından Çık» YouTube’u kapatır, ana ekrana döner, şerit kaybolur');
  await nav('mu'); ok(!(await vis('#mm-icexit')), 'yayın yokken «Yayından Çık» görünmez');
  await pg.fill('#mm-icyt', 'merhaba'); await clk('#mm-icytgo'); ok(/YouTube bağlantısı/.test(await pg.evaluate(() => document.getElementById('mm-toast').textContent)), 'geçersiz bağlantı uyarı verir');
  await pg.evaluate(() => window.__sock.em.length = 0);
  // ---- iPhone/Safari benzetimi: <audio>.volume salt okunur → çalışmayan kaydırıcı/−/+ GÖSTERİLMEZ, yönlendirme + 🔇 + ⏹ çalışır
  await pg.evaluate(() => { Object.defineProperty(navigator, 'userAgent', { get: () => 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1', configurable: true }); const h = document.getElementById('r'); window.__ic.destroy(); window.__ic = window.Intercom.mount(h, { user: 'tester', socket: window.__sock, radioUrl: location.origin + '/_radio' }); });
  await nav('ra'); await pg.waitForTimeout(400); await clk('#mm-rpp'); await pg.waitForTimeout(400);
  ok(await pg.evaluate(() => !document.getElementById('mm-vol') && !document.getElementById('mm-vdn') && !document.getElementById('mm-vup')) && /yan tuşları/.test(await pg.textContent('#mm-icsheet')) && await vis('#mm-vmute'), 'iPhone: kaydırıcı/−/+ yok (çalışmayan düğme yok), «yan tuşları» yönlendirmesi + 🔇 var');
  await clk('#mm-vmute'); ok(await pg.evaluate(() => window.__auds[window.__auds.length - 1].muted === true), 'iPhone: 🔇 radyoyu susturur'); await clk('#mm-vmute');
  await clk('#mm-icstop2'); await pg.waitForTimeout(100); ok(await pg.evaluate(() => window.__ic.core.ctx.musicWanted === false), 'iPhone: Durdur çalışır');
  await nav('mu'); ok(await vis('#mm-vol'), 'iPhone: müzik ekranında kaydırıcı (Web Audio kazancı) var');
  await pg.evaluate(() => { const r = document.getElementById('mm-vol'); r.value = 30; r.dispatchEvent(new Event('input', { bubbles: true })); });
  ok(await pg.evaluate(() => window.__auds[window.__auds.length - 2].volume === 1 && localStorage.getItem('ml_vol') === '0.3'), 'iPhone: müzik ses düzeyi <audio>.volume ile DEĞİL Web Audio kazancıyla uygulanır');
  await pg.fill('#mm-icyt', 'https://youtu.be/dQw4w9WgXcQ'); await clk('#mm-icytgo'); await pg.waitForTimeout(500);
  ok(await pg.evaluate(() => !document.getElementById('mm-vol') && !document.getElementById('mm-vdn') && !document.getElementById('mm-vup')) && /yan tuşları/.test(await pg.textContent('#mm-icsheet')) && await vis('#mm-vmute') && await vis('#mm-ytpp'), 'iPhone: YouTube çalarken çalışmayan kaydırıcı/−/+ yok, «yan tuşları» + 🔇 + duraklat var');
  // ---- tema/taşma
  ok(await pg.evaluate(() => { const s = document.getElementById('mm-icstrip').getBoundingClientRect(); return s.right <= 390 && s.left >= 0 && document.documentElement.scrollWidth <= 390; }), '390 px: yatay taşma yok');
  ok(errs.length === 0, 'sayfa hatası yok ' + errs.join(' | ')); await b.close(); srv.close(); console.log(`SONUÇ: ${p} geçti, ${f} başarısız`); process.exit(f ? 1 : 0);
});
