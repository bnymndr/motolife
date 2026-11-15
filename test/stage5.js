'use strict';
// Aşama 5 (çekirdek, Node): ağ kesintisinde otomatik yeniden bağlanma, pil/ısı politikası, gecikme ölçer, boşta zamanlayıcı yok.
// GERÇEK Bluetooth/pil/ısı ölçümü DEĞİL — bunlar cihazda yapılır (test/CIHAZ-TESTI.md). node test/stage5.js
const AC = require('../public/audio-core.js'), CC = require('../public/comm-core.js'), MC = require('../public/media-core.js'), PW = require('../public/power-core.js'), RP = require('../public/route-probe.js'); const E = AC.Events;
let p = 0, f = 0; const ok = (c, m) => { c ? p++ : f++; console.log((c ? 'ok: ' : 'FAIL: ') + m); };
const tick = () => new Promise(r => setImmediate(r));
// ---- sahte zamanlayıcı
function fakeTimers() { let t = 0, id = 0; const q = new Map(); return { setTimer: (fn, ms) => { q.set(++id, { at: t + ms, fn }); return id; }, clearTimer: i => q.delete(i), get pending() { return q.size; },
  async advance(ms) { const end = t + ms; for (;;) { let n = null; q.forEach((v, k) => { if (v.at <= end && (!n || v.at < q.get(n).at)) n = k; }); if (n == null) break; const v = q.get(n); q.delete(n); t = Math.max(t, v.at); v.fn(); await tick(); await tick(); } t = end; }, get now() { return t; } }; }
function fakeTr(net) { const t = { conn: 0, connected: false, st: () => {}, log: [] }; return Object.assign(t, {
  async connect() { t.conn++; if (!net.up) throw new Error('ağ yok'); t.connected = true; }, async disconnect() { t.connected = false; },
  setMic() {}, setPlayback() {}, onSpeakers() {}, onState(fn) { t.st = fn; } }); }
(async () => {
  // ---- tünel senaryosu
  let net = { up: true }, onl = true, ft = fakeTimers(), tr = fakeTr(net), svc = CC.createGroupService(tr), core = AC.create(); const errs = [];
  const H = CC.bindComms(core, svc, { setTimer: ft.setTimer, clearTimer: ft.clearTimer, random: () => 0.5, online: () => onl, onError: e => errs.push(e.message) });
  core.dispatch({ type: E.START_GROUP }); await tick(); await tick(); ok(svc.connected && tr.conn === 1, 'başlangıç: bağlı');
  net.up = false; tr.connected = false; tr.st('disconnected'); await tick();
  await ft.advance(600); ok(!svc.connected && tr.conn === 2, 'tünel: 0,5 sn sonra ilk yeniden deneme (başarısız)');
  await ft.advance(1100); ok(tr.conn === 3, '1 sn sonra ikinci deneme'); await ft.advance(2100); ok(tr.conn === 4, '2 sn sonra üçüncü (üstel geri çekilme)');
  await ft.advance(4100); await ft.advance(8100); ok(tr.conn === 6 && H.attempts >= 5, 'aralıklar 4 → 8 sn büyür (spam yok)');
  net.up = true; H.notifyOnline(); await ft.advance(10); await tick(); ok(svc.connected && H.attempts === 0, 'tünelden çıkınca (online olayı) hemen bağlanır, sayaç sıfırlanır');
  // ---- çevrimdışıyken deneme harcanmaz
  net.up = false; tr.connected = false; tr.st('disconnected'); await tick(); const c0 = tr.conn;
  onl = false; await ft.advance(20000); ok(tr.conn - c0 <= 2, 'ağ yokken gereksiz deneme yağmuru yok (' + (tr.conn - c0) + ' deneme / 20 sn)');
  // ---- arama sırasında düşme: denemez
  net.up = true; onl = true; await ft.advance(2000); core.dispatch({ type: E.CALL_START }); await tick(); tr.connected = false; tr.st('disconnected'); await tick();
  const c1 = tr.conn; await ft.advance(30000); ok(tr.conn === c1, 'aramadayken yeniden bağlanma denenmez');
  core.dispatch({ type: E.CALL_END }); await tick(); await tick(); ok(svc.connected, 'arama bitince bağlanır');
  core.dispatch({ type: E.END_RIDE }); await tick(); await ft.advance(60000); ok(ft.pending === 0, 'sürüş bitince bekleyen zamanlayıcı kalmaz');
  // ---- güç politikası
  const D = PW.decide;
  ok(D({ state: 'IDLE' }).gps.on === false && D({ state: 'IDLE' }).vad === 'off', 'IDLE: GPS ve mikrofon kapalı');
  ok(D({ state: 'SOLO_RIDE', kmh: 80 }).vad === 'off' && D({ state: 'SOLO_RIDE', kmh: 80 }).gps.intervalMs === 1000 && D({ state: 'SOLO_RIDE', kmh: 0 }).gps.intervalMs === 5000 && !D({ state: 'SOLO_RIDE', kmh: 0 }).gps.highAccuracy, 'tek sürüş: VAD yok; duran araçta GPS seyrek ve düşük hassasiyet');
  ok(D({ state: 'GROUP_RIDE', kmh: 80 }).vad === 'continuous', 'grup: VAD sürekli');
  ok(D({ state: 'ON_PHONE_CALL', kmh: 80 }).vad === 'off', 'aramada VAD kapalı');
  ok(D({ state: 'GROUP_RIDE', kmh: 80, battery: { level: 0.15, charging: false } }).vad === 'duty' && D({ state: 'GROUP_RIDE', kmh: 80, battery: { level: 0.15, charging: false } }).gps.intervalMs === 2000, 'pil <%20: VAD görev döngüsüne, GPS ×2 seyrek');
  ok(D({ state: 'GROUP_RIDE', kmh: 80, battery: { level: 0.15, charging: true } }).vad === 'continuous', 'şarjdayken pil tasarrufu uygulanmaz');
  const cr = D({ state: 'GROUP_RIDE', kmh: 80, thermal: 'critical' }); ok(cr.gps.on && cr.gps.intervalMs >= 5000 && !cr.gps.highAccuracy && cr.vad === 'duty' && cr.ui.levelMeterFps === 0, 'kritik ısı: GPS asla tamamen kapanmaz ama seyrelir; VAD duty; seviye çubuğu kapalı');
  ok(D({ state: 'GROUP_RIDE', hidden: true }).ui.levelMeterFps === 0 && D({ state: 'GROUP_RIDE', kmh: null }).gps.on, 'arka planda arayüz animasyonu yok; hız bilinmezken GPS yine açık');
  ok((await PW.readBattery({ getBattery: async () => ({ level: 0.5, charging: true }) })).level === 0.5 && (await PW.readBattery({})) === null, 'pil API yoksa null (uydurma yok)');
  // ---- gecikme ölçer
  let T = 0; const pr = RP.create({ now: () => T }); pr.mark('call_start'); T = 120; pr.mark('music_paused'); T = 900; pr.mark('phone_audible');
  const m1 = pr.measure('call_start', 'music_paused'), m2 = pr.measure('call_start', 'phone_audible');
  ok(m1.ms === 120 && m1.pass === true && m2.ms === 900 && m2.pass === true && pr.measure('x', 'y') === null, 'gecikme ölçer: ölçer, bütçeyle karşılaştırır, olmayan işareti uydurmaz');
  pr.mark('call_start'); T = 2000; pr.mark('music_paused'); pr.measure('call_start', 'music_paused'); ok(pr.report().find(r => r.key === 'call_start>music_paused').pass === false, 'bütçe aşılınca rapor başarısız işaretler');
  // ---- boşta zamanlayıcı yok (pil)
  const realST = global.setTimeout; let live = 0; global.setTimeout = (fn, ms) => { live++; return realST(() => { live--; fn(); }, ms); };
  const c2 = AC.create(), B = MC.bind(c2, { music: { play() {}, pause() {}, setVolume() {} }, intercom: { play() {}, pause() {}, setVolume() {} }, phone: { play() {}, pause() {}, setVolume() {} }, assistant: { play() {}, pause() {}, setVolume() {} } });
  c2.dispatch({ type: E.START_SOLO }); B.start(20); await new Promise(r => realST(r, 1500)); const idleTimers = live; B.setSpeed(100); await new Promise(r => realST(r, 10)); const wasBusy = live > 0 || B.busy(); await new Promise(r => realST(r, 1600));
  ok(idleTimers === 0 && wasBusy && live === 0 && !B.busy(), 'geçiş bitince medya zamanlayıcısı DURUR (boşta 0 zamanlayıcı)');
  c2.dispatch({ type: E.START_GROUP }); c2.dispatch({ type: E.SPEECH, on: true }); await new Promise(r => realST(r, 60)); ok(live >= 1 || B.busy(), 'yeni geçiş zamanlayıcıyı yeniden uyandırır'); B.stop(); global.setTimeout = realST;
  // ---- yazılım maliyeti (yalnız çekirdek CPU; PİL ÖLÇÜMÜ DEĞİL)
  const c3 = AC.create(); c3.dispatch({ type: E.START_GROUP }); const t0 = process.hrtime.bigint(); for (let i = 0; i < 20000; i++) { c3.dispatch({ type: E.SPEECH, on: i % 2 === 0 }); MC.targets(c3.plan(), 90); PW.decide({ state: 'GROUP_RIDE', kmh: 90 }); }
  const per = Number(process.hrtime.bigint() - t0) / 1e6 / 20000; console.log('bilgi: çekirdek karar maliyeti ≈ ' + (per * 1000).toFixed(1) + ' µs / olay'); ok(per < 0.5, 'çekirdek karar maliyeti ihmal edilebilir (<0.5 ms/olay)');
  console.log(`\nSONUÇ: ${p} geçti, ${f} başarısız`); process.exit(f ? 1 : 0);
})();
