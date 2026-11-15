'use strict';
// İletişim katmanı (çekirdek, Node): tek arayüz, arama sırasında kopmama, hızlı dönüş. Sahte taşıma + sahte saat. node test/comm-core.js
const AC = require('../public/audio-core.js'), CC = require('../public/comm-core.js'); const E = AC.Events;
let p = 0, f = 0; const ok = (c, m) => { c ? p++ : f++; console.log((c ? 'ok: ' : 'FAIL: ') + m); };
const tick = () => new Promise(r => setImmediate(r));
function fakeTransport(sim) {
  const t = { log: [], conn: 0, disc: 0, mic: false, play: true, sp: () => {}, st: () => {}, connected: false };
  Object.assign(t, {
    async connect() { t.conn++; t.log.push('connect'); if (sim && sim.delay) await new Promise(r => setTimeout(r, sim.delay)); t.connected = true; },
    async disconnect() { t.disc++; t.log.push('disconnect'); t.connected = false; },
    setMic(v) { t.mic = v; t.log.push('mic:' + v); }, setPlayback(v) { t.play = v; t.log.push('play:' + v); },
    onSpeakers(fn) { t.sp = fn; }, onState(fn) { t.st = fn; },
  }); return t;
}
(async () => {
  // ---- ortak arayüz
  const solo = CC.createSoloService(), tr0 = fakeTransport(), grp = CC.createGroupService(tr0);
  const API = ['connect', 'disconnect', 'mute', 'unmute', 'pausePlayback', 'resumePlayback', 'on'];
  ok(API.every(k => typeof solo[k] === 'function' && typeof grp[k] === 'function'), 'tek ve grup servisi AYNI arayüzü sunar');
  // ---- grup akışı
  const core = AC.create(), tr = fakeTransport(), svc = CC.createGroupService(tr); const errs = []; const B = CC.bindComms(core, svc, { onError: e => errs.push(e) });
  core.dispatch({ type: E.START_GROUP }); await tick(); await tick();
  ok(svc.connected && tr.conn === 1 && tr.mic === true && tr.play === true, 'grup sürüşü başlayınca odaya bağlanır, mikrofon açık, ses açık');
  tr.sp(['ali']); ok(core.ctx.speech === true && core.plan().channels.music.act === 'duck', 'ActiveSpeakers → ses motoru tetiklenir, müzik kısılır');
  tr.sp([]); ok(core.ctx.speech === false && core.plan().channels.music.act === 'play', 'konuşan kalmayınca müzik normale döner');
  // ---- kritik: telefon kesilmesi
  tr.log.length = 0; tr.sp(['ali']); core.dispatch({ type: E.CALL_START }); await tick();
  ok(tr.disc === 0 && svc.connected, 'arama: gruptan KOPMA yok');
  ok(tr.play === false && tr.mic === false && tr.log.includes('play:false') && tr.log.includes('mic:false'), 'arama: ses akışı durdu + mikrofon susturuldu');
  const t0 = process.hrtime.bigint(); core.dispatch({ type: E.CALL_END }); await tick();
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  ok(tr.play === true && tr.mic === true && tr.conn === 1 && tr.disc === 0, 'arama bitince aynı odaya yeniden bağlanmadan dönülür (connect hâlâ 1)');
  ok(ms < 50, 'dönüş milisaniyeler içinde (' + ms.toFixed(2) + ' ms, sahte taşıma)');
  // ---- kullanıcı kendi sessizinde
  svc.mute(); core.dispatch({ type: E.CALL_START }); core.dispatch({ type: E.CALL_END }); await tick();
  ok(svc.muted && tr.mic === false && tr.play === true, 'kullanıcı sessizdeyse arama sonrası mikrofon kendiliğinden AÇILMAZ');
  svc.unmute(); ok(tr.mic === true, 'sessiz kaldırılınca mikrofon açılır');
  // ---- arama sırasında bağlantı düşerse
  core.dispatch({ type: E.CALL_START }); await tick(); tr.connected = false; tr.st('disconnected'); await tick();
  ok(tr.conn === 1, 'aramadayken düşen bağlantı için yeniden bağlanma ERTELENİR (telefon önceliği)');
  core.dispatch({ type: E.CALL_END }); await tick(); await tick();
  ok(tr.conn === 2 && svc.connected && tr.mic === true && tr.play === true, 'arama bitince düşen oda hemen yeniden kurulur, mikrofon/ses geri gelir');
  // ---- sürüş bitişi
  core.dispatch({ type: E.END_RIDE }); await tick();
  ok(tr.disc === 1 && !svc.connected && core.state === AC.States.IDLE, 'sürüş bitince odadan ayrılır');
  // ---- kesin zamanlı yeniden bağlanma ölçümü (sahte 30 ms ağ gecikmesi)
  const trB = fakeTransport({ delay: 30 }), svB = CC.createGroupService(trB), coreB = AC.create(); CC.bindComms(coreB, svB);
  coreB.dispatch({ type: E.START_GROUP }); await new Promise(r => setTimeout(r, 60));
  coreB.dispatch({ type: E.CALL_START }); await tick(); trB.connected = false; trB.st('disconnected'); await tick();
  const s = Date.now(); coreB.dispatch({ type: E.CALL_END }); while (!svB.connected && Date.now() - s < 500) await new Promise(r => setTimeout(r, 2));
  ok(svB.connected && Date.now() - s < 120, 'düşmüş odaya dönüş ≈ ağ gecikmesi kadar (' + (Date.now() - s) + ' ms)');
  // ---- tek sürüşte ağ yok
  const core2 = AC.create(), tr2 = fakeTransport(), g2 = CC.createGroupService(tr2); CC.bindComms(core2, g2);
  core2.dispatch({ type: E.START_SOLO }); core2.dispatch({ type: E.CALL_START }); core2.dispatch({ type: E.CALL_END }); await tick();
  ok(tr2.conn === 0 && tr2.log.length === 0, 'tek sürüşte hiçbir ağ/oda işlemi yapılmaz');
  ok(errs.length === 0, 'hata oluşmadı');
  console.log(`\nSONUÇ: ${p} geçti, ${f} başarısız`); process.exit(f ? 1 : 0);
})();
