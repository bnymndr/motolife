'use strict';
// Medya denetimi + yumuşak geçiş + hıza duyarlı ses (çekirdek, Node; sahte saat ve sahte oynatıcı). node test/media-core.js
const AC = require('../public/audio-core.js'), M = require('../public/media-core.js'); const E = AC.Events;
let p = 0, f = 0; const ok = (c, m) => { c ? p++ : f++; console.log((c ? 'ok: ' : 'FAIL: ') + m); };
const near = (a, b, e) => Math.abs(a - b) <= (e || 0.01);
// ---- hız oranı
ok(M.speedFactor(null) === 0 && M.speedFactor(30) === 0 && M.speedFactor(60) === 0 && M.speedFactor(130) === 1 && M.speedFactor(200) === 1, 'hız faktörü: taban/tavan sınırlı, bilinmeyen hız = 0');
const l50 = M.levels(50), l100 = M.levels(100), l140 = M.levels(140);
ok(l50.intercom === 0.7 && l140.intercom === 1 && l100.intercom > l50.intercom && l100.intercom < l140.intercom, 'hız arttıkça interkom sesi artar (0.70→1.00)');
ok(l140.duck < l100.duck && l100.duck < l50.duck && near(l140.duck, 0.1), 'hız arttıkça kısılan müzik daha da kısılır (0.30→0.10)');
ok(M.levels(100).intercom > 0.7 && M.levels(100).intercom <= 1 && M.levels(1000).intercom <= 1, 'ses 1.0\'ı aşmaz');
// ---- fader
let fd = M.createFader(1); fd.setTarget(0.25, 0);
ok(fd.value(0) === 1 && near(fd.value(150), 0.625, 0.2) && fd.value(300) === 0.25 && fd.value(10000) === 0.25, 'kısma ~300 ms\'de biter, ani sıçrama yok');
ok(fd.value(100) < 1 && fd.value(100) > fd.value(200), 'kısma tek yönlü ve monoton');
fd = M.createFader(0.25); fd.setTarget(1, 0); ok(fd.value(300) < 0.9 && near(fd.value(1200), 1, 0.001), 'geri çıkış yavaş (~1.2 sn)');
fd = M.createFader(1); fd.setTarget(0.25, 0); const mid = fd.value(100); fd.setTarget(1, 100);
ok(near(fd.value(100), mid, 1e-9) && fd.value(100) === mid, 'ortada yön değişince mevcut seviyeden devam eder (sıçrama yok)');
// ---- bağlama: sahte oynatıcı + saat
let T = 0; const log = []; const fake = n => ({ play: () => log.push(n + ':play'), pause: () => log.push(n + ':pause'), setVolume: v => log.push(n + ':vol:' + v.toFixed(3)) });
const vols = n => log.filter(l => l.startsWith(n + ':vol:')).map(l => +l.split(':')[2]);
const core = AC.create(); const b = M.bind(core, { music: fake('m'), intercom: fake('i'), phone: fake('p') }, { now: () => T, duckProfile: 'smooth' });
const run = (ms) => { const end = T + ms; while (T < end) { T += 20; b.tick(); } };
core.dispatch({ type: E.START_GROUP }); run(2000);
ok(log.includes('m:play') && log.includes('i:play') && near(b.channels.music.volume, 1) && near(b.channels.intercom.volume, 0.7), 'grup başlayınca müzik ve interkom çalar; düşük hızda interkom 0.70');
log.length = 0; core.dispatch({ type: E.SPEECH, on: true }); run(400);
const mv = vols('m'); ok(near(b.channels.music.volume, 0.3, 0.005) && mv.length > 5 && mv.every((v, i) => i === 0 || v <= mv[i - 1] + 1e-9), 'konuşma: müzik 300 ms\'de 0.30\'a basamaksız iner');
log.length = 0; core.dispatch({ type: E.SPEECH, on: false }); run(300);
ok(b.channels.music.volume < 0.9, '300 ms sonra müzik hâlâ yükseliyor (yavaş çıkış)'); run(1500);
ok(near(b.channels.music.volume, 1), 'konuşma bitince müzik eski seviyesine döner');
b.setSpeed(140); run(1500); ok(near(b.channels.intercom.volume, 1) && near(b.channels.music.volume, 0.85), '140 km/s: interkom 1.00, müzik 0.85');
core.dispatch({ type: E.SPEECH, on: true }); run(1500); ok(near(b.channels.music.volume, 0.1, 0.005), '140 km/s + konuşma: müzik 0.10\'a kadar kısılır');
b.setSpeed(null); core.dispatch({ type: E.SPEECH, on: false }); run(2000);
log.length = 0; core.dispatch({ type: E.CALL_START }); run(1500);
ok(log.includes('p:play') && log.includes('m:pause') && log.includes('i:pause') && !b.channels.music.playing && !b.channels.intercom.playing && near(b.channels.phone.volume, 1), 'arama: telefon çalar, müzik ve interkom sönümle durdurulur');
ok(log.indexOf('m:pause') > log.findIndex(l => l.startsWith('m:vol:0.000')), 'durdurma ses sıfıra inince yapılır (pat sesi yok)');
log.length = 0; core.dispatch({ type: E.CALL_END }); run(2500);
ok(log.includes('m:play') && log.includes('i:play') && near(b.channels.music.volume, 1) && near(b.channels.intercom.volume, 0.7), 'arama bitince müzik ve interkom kendiliğinden geri gelir');
core.dispatch({ type: E.END_RIDE }); run(2000); ok(b.channels.music.playing && !b.channels.intercom.playing, 'sürüş bitince interkom durur, müzik sürer');
// ---- basamaklı profil (Gemini taslağı): 0.15 / 0.05 / 0, histerezis
ok(M.nextBand(50, 0) === 0 && M.nextBand(61, 0) === 1 && M.nextBand(101, 0) === 2 && M.nextBand(130, 1) === 2, 'bant: 60 ve 100 km/s eşikleri');
ok(M.nextBand(58, 1) === 1 && M.nextBand(54, 1) === 0 && M.nextBand(98, 2) === 2 && M.nextBand(94, 2) === 1 && M.nextBand(null, 2) === 0, 'histerezis: 58/98 km/s\'de bant değişmez; 54/94\'te iner; hız yoksa 0');
ok(M.levels(50, 'stepped').duck === 0.15 && M.levels(80, 'stepped').duck === 0.05 && M.levels(120, 'stepped').duck === 0, 'basamaklı duck: %15 / %5 / %0');
{ let T2 = 0; const lg = []; const mk = n => ({ play() {}, pause() {}, setVolume: v => lg.push([n, v]) }); const cr = AC.create(); const bb = M.bind(cr, { music: mk('m'), intercom: mk('i'), phone: mk('p'), assistant: mk('a') }, { now: () => T2 });
  const run2 = ms => { const e = T2 + ms; while (T2 < e) { T2 += 20; bb.tick(); } };
  cr.dispatch({ type: E.START_GROUP }); run2(2000); cr.dispatch({ type: E.SPEECH, on: true }); run2(1500); ok(near(bb.channels.music.volume, 0.15, 0.005), 'bind varsayılanı basamaklı: şehir içi konuşmada müzik 0.15');
  bb.setSpeed(120); run2(1500); ok(near(bb.channels.music.volume, 0, 0.005) && bb.channels.music.playing, '>100 km/s konuşmada müzik 0\'a iner ama çalmaya devam eder');
  bb.setSpeed(99); run2(500); ok(near(bb.channels.music.volume, 0, 0.005), '99 km/s\'de histerezis: hâlâ 0 (zıplama yok)'); }
// ---- htmlAudioAdapter
const el = { volume: 1, paused: true, play() { this.paused = false; return Promise.resolve(); }, pause() { this.paused = true; } };
const ad = M.htmlAudioAdapter(el); ad.play(); ad.setVolume(1.7); ok(!el.paused && el.volume === 1, 'adapter: play + sesi 0..1 sınırlar');
let g = -1; const ad2 = M.htmlAudioAdapter(el, { setGain: v => { g = v; } }); el.volume = 1; ad2.setVolume(0.4); ok(g === 0.4 && el.volume === 1, 'adapter: setGain verilirse (iOS) element.volume\'a dokunulmaz');
console.log(`\nSONUÇ: ${p} geçti, ${f} başarısız`); process.exit(f ? 1 : 0);
