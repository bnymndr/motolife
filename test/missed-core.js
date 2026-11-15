'use strict';
// Kaçırılan konuşma: tampon + bilgilendirme akışı + ses motoru entegrasyonu (çekirdek, Node; sahte STT/özet/TTS). node test/missed-core.js
const AC = require('../public/audio-core.js'), MC = require('../public/missed-core.js'), CC = require('../public/comm-core.js'); const E = AC.Events;
let p = 0, f = 0; const ok = (c, m) => { c ? p++ : f++; console.log((c ? 'ok: ' : 'FAIL: ') + m); };
const tick = () => new Promise(r => setImmediate(r)); const wait = ms => new Promise(r => setTimeout(r, ms));
// ---- tampon
let T = 0; const bf = MC.createBuffer({ now: () => T, maxAgeMs: 1000, maxChars: 50 });
ok(bf.add('a', 'x') === false, 'dinleme açılmadan tampona yazılmaz'); bf.start();
bf.add('ali', '  Sağa\u0000   dön \n'); ok(bf.lines()[0].text === 'Sağa dön' && bf.lines()[0].who === 'ali', 'metin temizlenir');
T = 500; bf.add('veli', 'b'.repeat(40)); ok(bf.size === 2, '50 karakter altında ikisi de durur'); bf.add('x', 'c'.repeat(30)); ok(bf.lines().every(l => l.text.length) && bf.lines().reduce((a, l) => a + l.text.length, 0) <= 50, 'karakter sınırı: eskiler atılır');
T = 5000; ok(bf.lines().length === 0, 'süre sınırı: eski satırlar silinir'); bf.add('a', 'y'); bf.clear(); ok(bf.size === 0 && !bf.active, 'clear siler ve dinlemeyi kapatır');
// ---- audio-core: bilgilendirme tutması
const c0 = AC.create(); c0.dispatch({ type: E.START_GROUP }); c0.dispatch({ type: E.HOLD_AFTER_CALL, on: true }); c0.dispatch({ type: E.CALL_START }); c0.dispatch({ type: E.CALL_END });
let pl = c0.plan(); ok(c0.ctx.briefing && pl.channels.intercom.act === 'pause' && pl.channels.assistant.act === 'play' && pl.channels.music.act === 'duck', 'arama bitince grup sesi dönmez; asistan çalar, müzik kısık');
c0.dispatch({ type: E.BRIEFING_END }); pl = c0.plan(); ok(!c0.ctx.briefing && pl.channels.intercom.act === 'play' && pl.channels.music.act === 'play' && pl.channels.assistant.act === 'off', 'bilgilendirme bitince grup sesi ve müzik geri gelir');
const c1 = AC.create(); c1.dispatch({ type: E.START_SOLO }); c1.dispatch({ type: E.HOLD_AFTER_CALL, on: true }); ok(c1.ctx.hold === false, 'tek sürüşte tutma işaretlenmez');
// ---- tam akış
async function scenario(opts) {
  const core = AC.create(), buf = MC.createBuffer(), order = [], stt = { cb: null, start(cb) { this.cb = cb; order.push('stt:start'); }, stop() { order.push('stt:stop'); } };
  const errs = []; const tr = { log: [], connected: false, connect: async () => { tr.connected = true; }, disconnect: async () => { tr.connected = false; tr.log.push('disconnect'); }, setMic: v => tr.log.push('mic:' + v), setPlayback: v => tr.log.push('play:' + v), onSpeakers() {}, onState() {} };
  const svc = CC.createGroupService(tr); CC.bindComms(core, svc);
  const B = MC.createBriefing({ core, buffer: buf, stt, enabled: () => opts.enabled !== false, timeoutMs: opts.timeoutMs || 200, onError: e => errs.push(e.message),
    summarize: async lines => { order.push('summarize:' + lines.length); if (opts.sumErr) throw new Error('ağ yok'); if (opts.slow) await wait(opts.slow); return 'Yakıt molası 15 dakika sonra.'; },
    chime: async () => { order.push('chime'); }, speak: async t => { order.push('speak:' + t); await wait(10); } });
  core.dispatch({ type: E.START_GROUP }); await tick(); await tick();
  core.dispatch({ type: E.CALL_START }); await tick();
  if (stt.cb) { stt.cb('ali', 'Yakıt için mola veriyoruz'); stt.cb('veli', 'Tamam 15 dakika sonra'); }
  tr.log.length = 0; core.dispatch({ type: E.CALL_END }); await tick();
  const during = { play: tr.log.includes('play:true'), briefing: core.ctx.briefing };
  for (let i = 0; i < 40 && core.ctx.briefing; i++) await wait(10);
  await tick(); return { core, order, errs, tr, buf, during };
}
(async () => {
  let s = await scenario({});
  ok(s.order.join('|') === 'stt:start|stt:stop|summarize:2|chime|speak:Yakıt molası 15 dakika sonra.', 'sıra: dinle → durdur → özetle → uyarı sesi → oku');
  ok(s.during.briefing && !s.during.play, 'bilgilendirme sürerken grup sesi AÇILMAZ (play:true yok)');
  ok(!s.core.ctx.briefing && s.tr.log.includes('play:true') && s.tr.log.includes('mic:true') && s.tr.connected && !s.tr.log.includes('disconnect'), 'sonra grup sesi ve mikrofon geri gelir, odadan hiç çıkılmaz');
  ok(s.buf.size === 0, 'özetten sonra tampon silinir');
  s = await scenario({ sumErr: true }); ok(!s.order.some(x => x.startsWith('speak')) && !s.core.ctx.briefing && s.tr.log.includes('play:true') && s.errs.length === 1, 'özet hatasında sessizce grup sesine dönülür');
  s = await scenario({ slow: 500, timeoutMs: 60 }); ok(!s.order.some(x => x.startsWith('speak')) && !s.core.ctx.briefing && s.errs[0] === 'zaman aşımı', 'özet zaman aşımında takılmaz, grup sesine dönülür');
  s = await scenario({ enabled: false }); ok(s.order.length === 0 && !s.core.ctx.briefing && s.buf.size === 0 && s.tr.log.includes('play:true'), 'kapalıyken (izin yok) hiçbir şey dinlenmez/gönderilmez, normal dönüş');
  // sürüş bitince tampon silinir
  const core = AC.create(), buf = MC.createBuffer(); MC.createBriefing({ core, buffer: buf, enabled: () => true, summarize: async () => 'x', speak: async () => {} });
  core.dispatch({ type: E.START_GROUP }); core.dispatch({ type: E.CALL_START }); buf.add('a', 'merhaba'); ok(buf.size === 1, 'aramada satır birikir'); core.dispatch({ type: E.END_RIDE }); ok(buf.size === 0 && !core.ctx.briefing, 'sürüş biterse tampon silinir');
  const sm = await MC.serverSummarizer(async (u, o) => ({ ok: true, json: async () => ({ summary: 'ok' }) }))([{ who: 'a', text: 'b' }]); ok(sm === 'ok', 'istemci özetleyici sunucu uç noktasını çağırır');
  console.log(`\nSONUÇ: ${p} geçti, ${f} başarısız`); process.exit(f ? 1 : 0);
})();
