'use strict';
// Grup sesi — Chromium: GERÇEK group-voice.js + GERÇEK groupvoice.js + GERÇEK WebRTC (sahte mikrofon cihazı, sahte soket taşıyıcısı ws üstünde).
// Aynı makinede ağ yolu (host adayları): gerçek operatör NAT/TURN senaryosu TEST EDİLMEZ. node test/gv-browser.js
const { chromium } = require(process.env.PLAYWRIGHT_PATH || '/opt/npm-tools/node_modules/playwright'); const http = require('http'), fs = require('fs'), path = require('path');
const { WebSocketServer } = require(process.env.WS_PATH || '/opt/npm-tools/node_modules/ws'); const { FakeIO } = require('./gv-fakeio.js'); const mount = require('../groupvoice.js');
let p = 0, f = 0; const ok = (c, m) => { c ? p++ : f++; console.log((c ? 'ok: ' : 'FAIL: ') + m); };
const users = { a: { id: 'a', username: 'Ali' }, b: { id: 'b', username: 'Bora' }, c: { id: 'c', username: 'Cem' } };
const groups = { g1: { id: 'g1', leader: 'a', members: [{ uid: 'a' }, { uid: 'b' }, { uid: 'c' }] } };
const routes = {}; const io = new FakeIO(); const svc = mount({ app: { get: (pth, h) => { routes[pth] = h; } }, io, userFromCookie: c => users[c] || null, uname: u => u.username, rg: { groupOf: id => groups[id] || null }, env: {}, timers: true });
const mime = { '.html': 'text/html', '.js': 'text/javascript' };
const srv = http.createServer((q, r) => { const u = new URL(q.url, 'http://x'); if (u.pathname === '/api/gvoice/ice') { const o = { c: 200 }; routes['/api/gvoice/ice']({ headers: { cookie: 'a' } }, { status(c) { o.c = c; return this; }, set() {}, json(b) { r.writeHead(o.c, { 'content-type': 'application/json' }); r.end(JSON.stringify(b)); } }); return; }
  const pa = u.pathname === '/host.html' ? path.join(__dirname, 'gv-host.html') : path.join(__dirname, '../public', u.pathname); if (!fs.existsSync(pa)) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': mime[path.extname(pa)] || 'text/plain' }); r.end(fs.readFileSync(pa)); });
const wss = new WebSocketServer({ noServer: true }); srv.on('upgrade', (req, sock, head) => wss.handleUpgrade(req, sock, head, ws => { const uid = new URL(req.url, 'http://x').searchParams.get('u'); const s = io.connect(users[uid]); s.out = (e, d) => { try { ws.send(JSON.stringify({ e, d })); } catch {} }; ws.send(JSON.stringify({ hello: s.id }));
  ws.on('message', m => { const j = JSON.parse(m); const h = s.h[j.e]; if (h) h(j.d, r => { try { j.id && ws.send(JSON.stringify({ ack: j.id, res: r })); } catch {} }); }); ws.on('close', () => s.disconnect()); }));
const sleep = ms => new Promise(r => setTimeout(r, ms));
srv.listen(0, async () => {
  const base = 'http://127.0.0.1:' + srv.address().port;
  const b = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--disable-features=WebRtcHideLocalIpsWithMdns', '--allow-loopback-in-peer-connection'] });
  const errs = []; const open = async (u, extra = '') => { const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, permissions: ['microphone'], hasTouch: true }); const pg = await ctx.newPage(); pg.on('pageerror', e => errs.push(u + ': ' + e.message)); await pg.goto(`${base}/host.html?u=${u}${extra}`); await pg.waitForFunction(() => window.__ready && window.__sock.connected, null, { timeout: 8000 }); return pg; };
  const st = pg => pg.evaluate(() => window.__ctl.state()); const waitS = (pg, fn, arg, ms = 12000) => pg.waitForFunction(fn, arg, { timeout: ms });
  const A = await open('a'), B = await open('b');
  // katıl
  const rb = await A.evaluate(() => window.__ctl.join('g1', 'Hafta Sonu')); ok(rb.ok, 'lider katıldı (mikrofon izni sahte cihazdan alındı)');
  ok(!(await A.evaluate(() => window.__ctl.track().enabled)), 'katılınca mikrofon KAPALI başlar');
  await B.evaluate(() => window.__ctl.join('g1', 'Hafta Sonu')); await waitS(A, () => window.__ctl.state().peers.some(x => x.conn === 'connected')); await waitS(B, () => window.__ctl.state().peers.some(x => x.conn === 'connected'));
  let sa = await st(A), sb = await st(B); ok(sa.peers.length === 1 && sa.peers[0].conn === 'connected' && sb.peers[0].name === 'Ali' && sa.count === 2, 'iki üye GERÇEK WebRTC ile birbirine bağlandı (ICE bağlı)');
  ok(sa.mode === 'ptt' && sa.leader === true && sb.leader === false, 'varsayılan mod bas-konuş; lider/üye ayrımı doğru');
  // bar
  const bar = pg => pg.evaluate(() => { const b = document.getElementById('gvBar'), m = b.querySelector('.main'), r = m.getBoundingClientRect(); return { vis: b.classList.contains('on') && b.getBoundingClientRect().height > 0, main: m.textContent, h: Math.round(r.height), w: Math.round(r.width), spk: b.querySelector('.spk').textContent, sub: b.querySelector('.s').textContent, tools: [...b.querySelectorAll('.tools button')].map(x => x.textContent), small: [...b.querySelectorAll('button')].filter(x => x.offsetParent && x.getBoundingClientRect().height < 44).length, ov: document.documentElement.scrollWidth - innerWidth, bottom: Math.round(innerHeight - b.getBoundingClientRect().bottom) }; });
  let ba = await bar(A), bb = await bar(B); ok(ba.vis && /Basılı Tut ve Konuş/.test(ba.main) && ba.h >= 80 && ba.small === 0 && ba.ov <= 0, `konuşma çubuğu görünür; ana düğme ${ba.h} px; tüm düğmeler ≥44 px; taşma yok`);
  ok(ba.tools.some(t => /Açık Mikrofon/.test(t)) && !bb.tools.some(t => /Açık Mikrofon|Bas-Konuş/.test(t)), 'mod düğmeleri yalnız lidere görünür'); ok(/2 kişi/.test(ba.sub) && /1\/1 bağlı/.test(ba.sub), 'çubukta kişi sayısı ve bağlantı durumu');
  await A.screenshot({ path: '/tmp/gv_bar.png' });
  // ses ayarları: küçük simge + panel, konuşma/müzik sesi ayrı, mikrofon filtre zinciri
  ok(await A.evaluate(() => { const v = document.querySelector('#gvBar .vs'), r = v.getBoundingClientRect(); return !!v && r.width <= 48 && r.height <= 48 && !document.querySelector('#gvBar .vp').hidden === false; }), 'ses simgesi küçük (≤48 px); panel kapalı başlar');
  await A.click('#gvBar .vs'); ok(await A.evaluate(() => !document.querySelector('#gvBar .vp').hidden && document.querySelector('#gvBar .vs').getAttribute('aria-expanded') === 'true' && ['gvGate', 'gvVoice', 'gvMusic'].every(i => !!document.getElementById(i))), 'simgeye dokununca panel açılır: hassasiyet, konuşma sesi, müzik sesi'); await A.screenshot({ path: '/tmp/gv_bar_open.png' });
  await A.evaluate(() => { window.__mv = []; addEventListener('ml:music-volume', e => window.__mv.push(e.detail.v)); });
  await B.evaluate(() => { document.querySelector('#gvBar .vs').click(); }); const setR = (pg, id, v) => pg.evaluate(([i, x]) => { const r = document.getElementById(i); r.value = x; r.dispatchEvent(new Event('input', { bubbles: true })); }, [id, v]);
  await setR(B, 'gvVoice', 40); ok(await B.evaluate(() => Math.abs(document.querySelector('audio[data-peer]').volume - 0.4) < 0.01 && localStorage.getItem('ml_vol_voice') === '40'), 'konuşma sesi kaydırıcısı karşı sesin düzeyini değiştirir ve saklanır');
  await setR(A, 'gvMusic', 25); ok(await A.evaluate(() => window.__mv.includes(25) && localStorage.getItem('ml_vol_music') === '25') && await A.evaluate(() => window.__ctl.cfg.voice === 100), 'müzik sesi AYRI ayarlanır (konuşma sesi değişmez), olay yayılır');
  await setR(A, 'gvGate', 80); ok(await A.evaluate(() => window.__ctl.cfg.gate === 80 && localStorage.getItem('ml_gv_gate') === '80'), 'mikrofon hassasiyeti ayarlanır ve saklanır');
  await A.click('#gvBar .vt [data-v=ns]'); ok(await A.evaluate(() => window.__ctl.cfg.ns === false && document.querySelector('#gvBar [data-v=ns]').dataset.st === 'Kapalı'), 'gürültü filtresi kapatılıp açılabilir'); await A.click('#gvBar .vt [data-v=ns]');
  await sleep(300); const lv = await A.evaluate(() => window.__ctl.level()); ok(lv && isFinite(lv.db) && lv.thr < 0, 'mikrofon filtre zinciri (alçak geçiren + sıkıştırıcı + gürültü kapısı) çalışıyor; seviye okunuyor');
  // Vazgeç / Kaydet ve Çık: panelin en altında
  await A.click('#gvBar .vb [data-vb=save]'); await A.click('#gvBar .vs');   // yeniden aç: anlık görüntü gate=80 ile alınır
  await A.evaluate(() => { const r = document.getElementById('gvGate'); r.value = 20; r.dispatchEvent(new Event('input', { bubbles: true })); });
  ok(await A.evaluate(() => { const vb = document.querySelector('#gvBar .vp .vb'), vp = document.querySelector('#gvBar .vp').getBoundingClientRect(), r = vb.getBoundingClientRect(); const bar = document.getElementById('gvBar').getBoundingClientRect(); return r.bottom <= bar.bottom + 1 && r.bottom > bar.bottom - 40 && r.top >= bar.top && r.bottom <= innerHeight && [...vb.querySelectorAll('button')].every(x => x.getBoundingClientRect().height >= 44); }), 'ses ayarları panelinin en altında, kaydırmadan görünen Vazgeç / Kaydet ve Çık düğmeleri var (≥44 px)');
  await A.click('#gvBar .vb [data-vb=cancel]');
  ok(await A.evaluate(() => document.querySelector('#gvBar .vp').hidden && window.__ctl.cfg.gate === 80 && localStorage.getItem('ml_gv_gate') === '80' && document.querySelector('#gvBar .vs').getAttribute('aria-expanded') === 'false'), 'Vazgeç: panel kapanır, panel açılırken kayıtlı ayarlar geri yüklenir');
  await A.click('#gvBar .vs'); await A.evaluate(() => { const r = document.getElementById('gvGate'); r.value = 35; r.dispatchEvent(new Event('input', { bubbles: true })); });
  await A.click('#gvBar .vb [data-vb=save]');
  ok(await A.evaluate(() => document.querySelector('#gvBar .vp').hidden && window.__ctl.cfg.gate === 35 && localStorage.getItem('ml_gv_gate') === '35'), 'Kaydet ve Çık: değişiklik saklanır, panel kapanır');
  await A.click('#gvBar .vs'); await A.evaluate(() => { const r = document.getElementById('gvGate'); r.value = 80; r.dispatchEvent(new Event('input', { bubbles: true })); }); await A.click('#gvBar .vs');
  ok(await A.evaluate(() => document.querySelector('#gvBar .vp').hidden && window.__ctl.cfg.gate === 80), 'üstteki ayar simgesiyle kapatınca değişiklikler korunur');
  await A.click('#gvBar .vs'); await A.click('#gvBar .vb [data-vb=save]');
  // PTT: Ali bas
  const press = pg => pg.evaluate(() => document.querySelector('#gvBar .main').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, pointerType: 'touch' }))), rel = pg => pg.evaluate(() => document.querySelector('#gvBar .main').dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, pointerType: 'touch' })));
  await press(A); await waitS(A, () => window.__ctl.state().ptt === 'talking'); ok(await A.evaluate(() => window.__ctl.track().enabled), 'BASILI TUT: söz hakkı alındı ve mikrofon gerçekten açıldı'); ba = await bar(A); ok(/^Konuşuyorsun/.test(ba.main) && /Sen/.test(ba.spk), 'Ali\'de «Konuşuyorsun», konuşanlarda «Sen»');
  await waitS(B, () => window.__ctl.state().holder && window.__ctl.state().holder.name === 'Ali'); bb = await bar(B); ok(/Ali konuşuyor/.test(bb.main) && /Konuşuyor: Ali/.test(bb.spk), 'Bora\'da «Ali konuşuyor» görünür');
  ok(await B.evaluate(() => { const a = document.querySelector('audio[data-peer]'); return !!a && a.muted === false && !!a.srcObject; }), 'Bora hak sahibinin sesini alıyor (ses öğesi açık, akış bağlı)');
  await waitS(B, () => window.__ctl.state().peers[0].speaking, null, 8000).then(() => ok(true, 'ALINAN SES düzeyinden «konuşuyor» göstergesi çalıştı (sahte cihaz tonu)'), () => ok(false, 'alınan ses düzeyi algılanamadı (sahte cihaz tonu gelmedi)'));
  await press(B); await waitS(B, () => window.__ctl.state().ptt === 'denied'); bb = await bar(B); ok(/Ali konuşuyor/.test(bb.main) && !(await B.evaluate(() => window.__ctl.track().enabled)), 'söz Ali\'deyken Bora alamaz; mikrofonu kapalı kalır'); await rel(B);
  await rel(A); await waitS(A, () => window.__ctl.state().ptt === 'idle'); ok(!(await A.evaluate(() => window.__ctl.track().enabled)), 'bırakınca mikrofon KAPANDI'); await waitS(B, () => !window.__ctl.state().holder); ok(await B.evaluate(() => document.querySelector('audio[data-peer]').muted === true), 'söz boşalınca Bora\'da ses öğesi susturulur');
  // Bora konuşur
  await press(B); await waitS(B, () => window.__ctl.state().ptt === 'talking'); await waitS(A, () => window.__ctl.state().holder && window.__ctl.state().holder.name === 'Bora'); ok(true, 'söz boşalınca Bora alabilir'); await rel(B); await waitS(B, () => window.__ctl.state().ptt === 'idle');
  // kilit modu
  await B.evaluate(() => window.__ctl.setLatch(true)); await press(B); await rel(B); await sleep(500); ok((await st(B)).ptt === 'talking' && await B.evaluate(() => window.__ctl.track().enabled), 'KİLİT modu: parmak çekilince konuşma sürer'); await press(B); await rel(B); await waitS(B, () => window.__ctl.state().ptt === 'idle'); ok(!(await B.evaluate(() => window.__ctl.track().enabled)), 'tekrar dokununca biter'); await B.evaluate(() => window.__ctl.setLatch(false));
  // lider modu açık mikrofona alır
  await A.evaluate(() => window.__ctl.setMode('open')); await waitS(B, () => window.__ctl.state().mode === 'open'); bb = await bar(B); ok(/Mikrofonu Aç/.test(bb.main) && !bb.tools.some(t => /Açık Mikrofon|Bas-Konuş/.test(t)), 'mod değişti: Bora\'da «Mikrofonu Aç» (herkese yayıldı)');
  const rr = await B.evaluate(() => window.__ctl.setMode('ptt')); ok(rr && rr.code === 'leader', 'lider olmayan sunucuda da modu değiştiremez');
  await B.click('#gvBar .main'); await waitS(A, () => window.__ctl.state().peers[0].mic === true); ok(await B.evaluate(() => window.__ctl.track().enabled) && await A.evaluate(() => document.querySelector('audio[data-peer]').muted === false), 'açık mikrofon: Bora açtı, Ali duyuyor');
  await waitS(A, () => window.__ctl.state().peers[0].speaking, null, 8000).then(() => ok(true, 'açık modda konuşan göstergesi çalışıyor'), () => ok(false, 'açık modda konuşan algılanamadı'));
  await B.click('#gvBar .main'); await waitS(A, () => window.__ctl.state().peers[0].mic === false); ok(!(await B.evaluate(() => window.__ctl.track().enabled)), 'tek dokunuşla kapandı');
  await A.evaluate(() => window.__ctl.setMode('ptt')); await waitS(B, () => window.__ctl.state().mode === 'ptt');
  // üçüncü üye: 3 kişilik mesh
  const C = await open('c'); await C.evaluate(() => window.__ctl.join('g1', 'Hafta Sonu')); await waitS(C, () => window.__ctl.state().peers.length === 2 && window.__ctl.state().peers.every(x => x.conn === 'connected')); await waitS(A, () => window.__ctl.state().peers.length === 2 && window.__ctl.state().peers.every(x => x.conn === 'connected')); ok((await st(A)).count === 3, '3 kişilik mesh: herkes herkese bağlı');
  await press(A); await waitS(A, () => window.__ctl.state().ptt === 'talking'); await waitS(C, () => window.__ctl.state().holder && window.__ctl.state().holder.name === 'Ali'); await rel(A); ok(true, 'üçüncü üye de söz hakkı duyurusunu alır');
  await C.evaluate(() => window.__ctl.leave()); await waitS(A, () => window.__ctl.state().peers.length === 1); ok(!(await C.evaluate(() => window.__stream.getTracks().some(t => t.readyState === 'live'))), 'AYRILINCA mikrofon izleri durdu (tarayıcı mikrofon göstergesi söner)'); ok(!(await C.evaluate(() => document.getElementById('gvBar').classList.contains('on'))), 'ayrılınca çubuk kapanır');
  // bağlantı kopması ve geri gelme
  await A.evaluate(() => window.__ws.close()); await waitS(A, () => window.__ctl.state().status === 'reconnecting', null, 4000); ok(true, 'bağlantı kopunca «yeniden bağlanıyor» gösterilir'); await waitS(A, () => window.__ctl.state().status === 'connected' && window.__ctl.state().peers.length === 1 && window.__ctl.state().peers[0].conn === 'connected', null, 15000); ok(true, 'bağlantı gelince odaya otomatik girildi ve eşler yeniden kuruldu');
  await waitS(B, () => window.__ctl.state().peers.length === 1 && window.__ctl.state().peers[0].conn === 'connected', null, 15000); ok(true, 'Bora tarafı da yeniden bağlandı');
  // izin reddi
  const D = await open('c', '&deny=1'); const rd = await D.evaluate(() => window.__ctl.join('g1', 'x')); const sd = await st(D); ok(rd.error && /Mikrofon izni/.test(sd.error) && sd.status === 'failed' && !(await D.evaluate(() => document.getElementById('gvBar').classList.contains('on'))), 'mikrofon izni verilmezse açık hata mesajı; odaya girilmez');
  ok((await st(A)).peers.length === 1, 'izin reddi başkalarını etkilemedi');
  // üyelikten çıkarılma
  groups.g1.members = groups.g1.members.filter(m => m.uid !== 'b'); svc.sweepMembers(); await waitS(B, () => window.__ctl.state().status === 'idle'); ok((await B.evaluate(() => window.__log)).some(t => /çıkarıldığın/.test(t)), 'gruptan çıkarılan sesten de düşer ve bilgilendirilir'); await waitS(A, () => window.__ctl.state().peers.length === 0); ok(true, 'diğerlerinde eş listesi güncellendi');
  ok(errs.length === 0, 'sayfa hatası yok ' + JSON.stringify(errs.slice(0, 2)));
  await b.close(); svc.stop(); srv.close(); wss.close(); console.log(`SONUÇ: ${p} geçti, ${f} başarısız`); process.exit(f ? 1 : 0);
});
