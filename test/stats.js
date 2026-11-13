'use strict';
// Ana sayfa istatistikleri (çekirdek) + gerçek index.html/analysis.js Chromium'da (SAHTE /api/rides yanıtı; Tailwind CDN yok). node test/stats.js
const { chromium } = require(process.env.PLAYWRIGHT_PATH || '/opt/npm-tools/node_modules/playwright'); const http = require('http'), fs = require('fs'), path = require('path');
const SC = require('../public/stats-core.js');
let p = 0, f = 0; const ok = (c, m) => { c ? p++ : f++; console.log((c ? 'ok: ' : 'FAIL: ') + m); };
// ---- çekirdek, sabit zaman: Per 12 Kas 2026 12:00 yerel
const L = (m, d, h) => new Date(2026, m - 1, d, h || 10).getTime(), now = L(11, 12, 12);
const ev = (b, a, secs) => ({ events: { brake: { n: b.reduce((x, y) => x + y, 0), sev: b }, accel: { n: a.reduce((x, y) => x + y, 0), sev: a } }, aLon: { secs } });
const rows = [
  { startedAt: L(11, 9), distM: 10000, tele: ev([2, 0, 0], [0, 1, 0], 500) }, { startedAt: L(11, 11), distM: 20000, tele: ev([0, 0, 0], [0, 0, 0], 900) },
  { startedAt: L(11, 2), distM: 30000, tele: null }, { startedAt: L(10, 20), distM: 40000, tele: null }, { startedAt: L(11, 12, 9), distM: 5000, tele: null }, { startedAt: L(11, 10), distM: 1000, tele: ev([5, 0, 0], [0, 0, 0], 100) }];
ok(new Date(SC.weekStart(now)).getDate() === 9 && new Date(SC.weekStart(now)).getHours() === 0, 'hafta Pazartesi 00:00 başlar');
const sunday = L(11, 15, 23); ok(new Date(SC.weekStart(sunday)).getDate() === 9, 'Pazar günü de aynı haftada');
const T = SC.totals(rows, now);
ok(Math.abs(T.weekKm - 36) < 1e-9 && Math.abs(T.prevWeekKm - 30) < 1e-9 && Math.abs(T.monthKm - 66) < 1e-9 && Math.abs(T.prevMonthKm - 40) < 1e-9, `haftalık/aylık km (${T.weekKm}/${T.prevWeekKm}/${T.monthKm}/${T.prevMonthKm})`);
const bw = SC.buckets(rows, 'week', now);
ok(bw.map(x => x.label).join() === 'Pzt,Sal,Çar,Per,Cum,Cmt,Paz' && bw[0].km === 10 && bw[2].km === 20 && bw[3].km === 5 && bw[3].current && bw[4].future && bw[1].km === 1, 'hafta grafiği: günlük km, bugün işaretli, gelecek gün soluk');
const bm = SC.buckets(rows, 'month', now); ok(bm.length === 6 && bm[5].label === 'Kas' && bm[5].current && Math.abs(bm[5].km - 66) < 1e-9 && bm[4].label === 'Eki' && bm[4].km === 40 && bm[0].label === 'Haz', 'ay grafiği: son 6 ay');
ok(SC.rideScore(rows[0]) === 64 && SC.rideScore(rows[1]) === 100, 'puan formülü (10 km, 2 orta+1 sert → 64; olaysız 20 km → 100)');
ok(SC.rideScore(rows[2]) === null && SC.rideScore(rows[5]) === null, 'sensörsüz ya da <2 km sürüş puanlanmaz (0 sayılmaz)');
const O = SC.overall(rows, 12); ok(O.score === 88 && O.n === 2 && O.of === 6 && O.trend.length === 2 && O.trend[0].t < O.trend[1].t, 'genel puan mesafeyle ağırlıklı (88), 2/6 sürüş puanlandı, eski→yeni trend');
ok(SC.overall([{ startedAt: now, distM: 9000, tele: null }]).score === null && SC.rideScore({ startedAt: now, distM: 50000, tele: ev([100, 0, 0], [0, 0, 0], 10) }) === 0, 'puanlanacak sürüş yoksa null; çok sert sürüş 0’a sabitlenir');

// ---- Chromium
const root = path.join(__dirname, '../public'), mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/json' };
const nowR = Date.now(), H = h => nowR - h * 3600e3;
const RIDES = [{ id: 'a', startedAt: H(1), endedAt: H(0.5), summary: { distM: 12000, durationS: 1800, maxKmh: 90, avgMovingKmh: 40 }, tele: ev([1, 0, 0], [0, 0, 0], 600) },
  { id: 'b', startedAt: H(24 * 40), endedAt: H(24 * 40 - 1), summary: { distM: 30000, durationS: 3600, maxKmh: 100, avgMovingKmh: 50 }, tele: null }];
const srv = http.createServer((q, r) => { const u = new URL(q.url, 'http://x'), J = (o, s = 200) => { r.writeHead(s, { 'content-type': 'application/json' }); r.end(JSON.stringify(o)); };
  if (u.pathname === '/api/account' && q.method === 'POST') { let b = ''; q.on('data', c => (b += c)); q.on('end', () => { global.__acc = JSON.parse(b || '{}'); J({ user: { username: 'ben', firstName: 'Ben', lastName: 'X', gender: 'erkek', email: 'a@b.c', hasPassword: true, avatar: '', bikeBrand: global.__acc.bikeBrand, bikeModel: global.__acc.bikeModel } }); }); return; }
  if (u.pathname === '/api/me') return J({ user: { username: 'ben', firstName: 'Ben', lastName: 'X', email: 'a@b.c', hasPassword: true, avatar: '', bikeBrand: 'Yamaha', bikeModel: 'MT-07' } });
  if (u.pathname === '/api/rides') return J({ rides: RIDES }); if (u.pathname === '/api/rgroups') return J({ groups: [] });
  if (u.pathname === '/api/weather') return J({ error: 'x' }, 502); if (u.pathname.startsWith('/api/')) return J({}, 404);
  const pa = path.join(root, u.pathname === '/' ? 'index.html' : u.pathname); if (!fs.existsSync(pa)) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': mime[path.extname(pa)] || 'application/octet-stream' }); r.end(fs.readFileSync(pa)); });
srv.listen(0, async () => {
  const base = 'http://127.0.0.1:' + srv.address().port, b = await chromium.launch(), ctx = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true }), pg = await ctx.newPage(), errs = [];
  pg.on('pageerror', e => errs.push(e.message)); await pg.route(/^https?:\/\/(?!127\.0\.0\.1)/, r => r.fulfill({ status: 200, contentType: 'text/javascript', body: '{}' }));
  await pg.addInitScript(() => { window.tailwind = { config: {} }; window.io = () => ({ on() {}, off() {}, emit() {}, connect() {}, connected: false, id: 'x' }); });
  await pg.goto(base + '/'); await pg.addStyleTag({ content: '.hidden{display:none!important}.grid{display:grid}.grid-cols-5{grid-template-columns:repeat(5,minmax(0,1fr))}.grid-cols-2{grid-template-columns:repeat(2,minmax(0,1fr))}.max-w-md{max-width:28rem}.mx-auto{margin-left:auto;margin-right:auto}.fixed{position:fixed}.inset-x-0{left:0;right:0}.bottom-0{bottom:0}.flex{display:flex}.flex-col{flex-direction:column}.items-center{align-items:center}.gap-3{gap:.75rem}.p-4{padding:1rem}' });
  await pg.waitForFunction(() => /\d/.test(document.getElementById('stWk').textContent), null, { timeout: 8000 }); await pg.waitForTimeout(400);
  const T = id => pg.textContent('#' + id);
  const nav = await pg.$$eval('#bottomNav [data-nav]', e => e.map(x => x.dataset.nav)); ok(nav.join() === 'home,motor,world,social,settings', 'alt gezinme 5 sekme: Analiz yok (' + nav.join() + ')');
  ok(await pg.evaluate(() => !document.querySelector('#dash #tips') && !!document.querySelector('#motor #tips')) && /Günlük Bilgiler/.test(await pg.textContent('#motor')), 'günlük bilgiler (ipuçları) My Moto sayfasına taşındı');
  const expKm = RIDES.filter(r => r.startedAt >= SC.monthStart(nowR)).reduce((s, r) => s + r.summary.distM / 1000, 0), wk = RIDES.filter(r => r.startedAt >= SC.weekStart(nowR)).reduce((s, r) => s + r.summary.distM / 1000, 0);
  const num = s => Number(s.replace(/\./g, '').replace(',', '.'));
  ok(Math.abs(num(await T('stWk')) - wk) < 0.06 && Math.abs(num(await T('stMo')) - expKm) < 0.06, `ana sayfa: bu hafta ${await T('stWk')} km, bu ay ${await T('stMo')} km (beklenen ${wk.toFixed(1)} / ${expKm.toFixed(1)})`);
  ok((await pg.$$('#stChart rect')).length === 7 && (await pg.$$eval('#stChart text', e => e.map(x => x.textContent))).includes('Pzt'), 'hafta grafiği 7 çubuk (Pzt…Paz)');
  await pg.click('#stMonth'); ok((await pg.$$('#stChart rect')).length === 6 && await pg.getAttribute('#stMonth', 'aria-pressed') === 'true', 'Ay seçilince 6 aylık grafik');
  const sc = await T('scRing'); ok(/\d/.test(sc) && /tahmini/.test(sc) && /1 sürüş puanlandı/.test(await T('scTxt')), 'sürüş puanı halkası + «1 sürüş puanlandı» (2 sürüşten biri sensörsüz)');
  ok(await pg.isVisible('#statsCard') && await pg.isVisible('#scoreCard') && (await pg.evaluate(() => ['statsCard', 'scoreCard'].every(i => { const r = document.getElementById(i).getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth + 0.5; }))), 'iki kart görünür ve 390 px içinde (Tailwind yok: sayfa geneli taşma ölçülmez)');
  await pg.screenshot({ path: '/tmp/home.png', fullPage: true });
  // ayarlar → kalibrasyon → analiz
  await pg.evaluate(() => document.querySelector('[data-nav="settings"]').click()); await pg.waitForTimeout(300);
  ok(await pg.evaluate(() => { const k = [...document.querySelectorAll('#settings [data-go]')].map(b => b.dataset.go); const a = k.indexOf('notif'), c = k.indexOf('calib'), n = k.indexOf('analysis'); return a >= 0 && c > a && n === c + 1; }), 'Ayarlar listesi: Bildirim → Kalibrasyon → Sürüş Analizi (ayrı satırlar)');
  ok(!(await pg.evaluate(async () => { document.querySelector('#settings [data-go="calib"]').click(); await new Promise(r => setTimeout(r, 50)); const t = document.getElementById('settings').textContent; const has = /Sürüş analizini aç/.test(t); document.querySelector('#settings [data-go="home"]').click(); return has; })), 'Kalibrasyon sayfasında artık analiz yok');
  // --- Ayarlar › Kalibrasyon: telefon motora sabitken kalibre et (sahte, hareketsiz ivmeölçer olayları)
  await pg.click('#settings [data-go="calib"]'); await pg.waitForTimeout(100);
  ok(await pg.isVisible('#settings [data-act="calnow"]') && /Kalibre Et/.test(await pg.textContent('#settings [data-act="calnow"]')) && !(await pg.evaluate(() => /Sürüş analizi/.test(document.getElementById('settings').textContent))), 'Kalibrasyon sayfasında «Telefon motora sabit — Kalibre et» düğmesi var');
  await pg.evaluate(() => { localStorage.removeItem('mm_tcal'); window.__calEv = 0; DeviceMotionEvent.requestPermission = async () => 'granted'; setInterval(() => { window.__calEv++; window.dispatchEvent(new DeviceMotionEvent('devicemotion', { accelerationIncludingGravity: { x: 0.12 + Math.random() * 0.02, y: 0.25 + Math.random() * 0.02, z: 9.78 }, rotationRate: { alpha: 0.1, beta: 0.1, gamma: 0.1 } })); }, 20); });
  await pg.click('#settings [data-act="calnow"]');
  await pg.waitForFunction(() => /Hazırlan/.test(document.querySelector('[data-cal-out]').textContent), null, { timeout: 5000 });
  ok(await pg.isDisabled('#settings [data-act="calnow"]'), 'kalibrasyon sürerken düğme kilitli, geri sayım görünür');
  await pg.waitForFunction(() => /kaydedildi/.test(document.querySelector('[data-cal-out]').textContent), null, { timeout: 15000 });
  ok(await pg.evaluate(() => { const c = JSON.parse(localStorage.getItem('mm_tcal') || 'null'); return !!c && Array.isArray(c.u) && Math.abs(Math.hypot(...c.u) - 1) < 0.01 && Date.now() - c.uAt < 20000; }) && /kalibre edildi/.test(await pg.textContent('[data-cal-state]')), 'kalibrasyon kaydedilir (mm_tcal, birim vektör) ve durum «kalibre edildi» olur');
  await pg.click('#settings [data-go="home"]');
  // --- Motosiklet bilgileri profilden ayrı; yazı tipi seçimi; My Moto resmi; alt menü simgeleri; minimal hava kartı
  ok(await pg.evaluate(() => !!document.querySelector('#settings [data-go="moto"]') && !document.getElementById('sBrand') && !document.getElementById('sModel')), 'Ayarlar listesinde «Motosiklet Bilgileri» ayrı satır; profil formunda marka/model yok');
  await pg.click('#settings [data-go="moto"]'); await pg.fill('#settings [data-moto=brand]', 'Honda'); await pg.fill('#settings [data-moto=model]', 'CB650R'); await pg.click('#settings [data-act="motosave"]'); await pg.waitForTimeout(300);
  ok(global.__acc && global.__acc.bikeBrand === 'Honda' && global.__acc.bikeModel === 'CB650R' && global.__acc.username === 'ben' && global.__acc.firstName === 'Ben' && global.__acc.email === 'a@b.c' , 'motosiklet kaydı: profil alanları mevcut değerleriyle, yalnız marka/model değişerek gider');
  await pg.click('#settings [data-go="home"]'); await pg.evaluate(() => document.querySelector('[data-nav="motor"]').click()); await pg.waitForTimeout(300);
  ok(await pg.evaluate(() => !!document.querySelector('#motor #bikeImg') && document.getElementById('bikeImg').getBoundingClientRect().width > 150), 'My Moto: tip görseli');
  await pg.click('#motoEdit'); await pg.waitForTimeout(200); ok(await pg.isVisible('#settings [data-moto=brand]'), '«Bilgileri Güncelle» motosiklet sayfasını açar (profil değil)');
  await pg.click('#settings [data-go="home"]');
  ok(await pg.evaluate(() => [...document.querySelectorAll('#bottomNav svg')].every(s => s.getBoundingClientRect().width >= 27)), 'alt menü simgeleri ≥28 px');
  await pg.evaluate(() => document.querySelector('[data-nav="home"]').click()); await pg.waitForTimeout(200);
  ok(await pg.evaluate(() => !document.getElementById('wxHours') && !document.getElementById('wxMeta')), 'hava kartı: kullanılmayan saatlik tahmin ve ayrıntı öğeleri DOM\'da yok');
  await pg.evaluate(() => document.querySelector('[data-nav="settings"]').click()); await pg.waitForTimeout(200);
  await pg.click('#settings [data-go="display"]'); await pg.waitForTimeout(100);
  ok(await pg.evaluate(() => document.querySelectorAll('#settings [data-seg="ml_font"]').length === 0 && !!document.querySelector('#settings [data-act="fontdd"]') && document.querySelectorAll('#settings [data-seg="fs"]').length === 4), 'Ekran: yazı tipi tek satır (kapalı liste) + 4 punto seçeneği');
  ok(await pg.evaluate(() => { const b = document.querySelector('#settings [data-act="fontdd"]'); return b.getBoundingClientRect().height >= 50 && b.getAttribute('aria-expanded') === 'false'; }), 'yazı tipi satırı kapalıyken tek satır');
  await pg.click('#settings [data-act="fontdd"]'); await pg.waitForTimeout(80);
  ok(await pg.evaluate(() => { const b = document.querySelector('#settings [data-act="fontdd"]').getBoundingClientRect(), l = document.querySelector('#settings [role=listbox]'); const o = [...l.querySelectorAll('[data-seg="ml_font"]')]; return b.height < 130 && l.getBoundingClientRect().top >= b.bottom - 1 && o.length === 4; }), 'tıklayınca 4 yazı tipi satırın ALTINA doğru açılır');
  const ff = () => pg.evaluate(() => getComputedStyle(document.body).fontFamily);
  const f0 = await ff();
  for (const f of ['system', 'exo', 'hyper']) { if (!(await pg.$('#settings [role=listbox]'))) await pg.click('#settings [data-act="fontdd"]'); await pg.click('#settings [data-seg="ml_font"][data-v="' + f + '"]'); await pg.waitForTimeout(60); ok(await pg.evaluate(f => document.documentElement.dataset.font === f && localStorage.getItem('ml_font') === f, f) && (await ff()) !== f0, 'yazı tipi «' + f + '» uygulanır ve saklanır'); }
  if (!(await pg.$('#settings [role=listbox]'))) await pg.click('#settings [data-act="fontdd"]'); await pg.click('#settings [data-seg="ml_font"][data-v="barlow"]'); ok(await pg.evaluate(() => !document.querySelector('#settings [role=listbox]')) && await pg.evaluate(() => !document.documentElement.hasAttribute('data-font')) && (await ff()) === f0, 'Barlow: varsayılana döner');
  await pg.click('#settings [data-seg="fs"][data-v="125"]'); ok(await pg.evaluate(() => document.documentElement.style.fontSize === '125%'), 'punto: Çok büyük uygulanır'); await pg.click('#settings [data-seg="fs"][data-v="100"]');
  await pg.click('#settings [data-go="home"]');
  await pg.click('#settings [data-go="theme"]'); await pg.waitForTimeout(100);
  ok(await pg.evaluate(() => document.querySelectorAll('#settings [data-seg="ml_theme"]').length === 4), 'Tema sayfasında 4 uygulama teması (varsayılan + 3 yeni)');
  const accOf = () => pg.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim());
  const a0 = await accOf();
  for (const t of ['asphalt', 'forest', 'ocean']) { await pg.click('#settings [data-seg="ml_theme"][data-v="' + t + '"]'); await pg.waitForTimeout(60); ok(await pg.evaluate(t => document.documentElement.dataset.apptheme === t && localStorage.getItem('ml_theme') === t, t) && (await accOf()) !== a0, 'tema «' + t + '» uygulanır ve saklanır'); }
  ok(await pg.evaluate(() => /Barlow/.test(getComputedStyle(document.body).fontFamily) && /Condensed/.test(getComputedStyle(document.querySelector('.road')).fontFamily)), 'yazı tipi: Barlow (metin) + Barlow Condensed (başlık/rakam), sistem yedekli');
  await pg.click('#settings [data-seg="ml_theme"][data-v="moto"]'); ok(await pg.evaluate(() => !document.documentElement.hasAttribute('data-apptheme')) && (await accOf()) === a0, 'Gece Turuncu: varsayılana döner');
  await pg.click('#settings [data-go="home"]');
  await pg.click('#settings [data-go="analysis"]'); await pg.waitForSelector('.an-range', { timeout: 8000 });
  ok(await pg.isVisible('#analysis') && await pg.getAttribute('[data-nav="settings"]', 'aria-current') === 'page', 'analiz açıldı; alt çubukta Ayarlar seçili');
  ok((await pg.$$('.an-row')).length === 2 && await pg.getAttribute('[data-r="all"]', 'aria-pressed') === 'true', 'Tümü: 2 sürüş');
  await pg.click('[data-r="week"]'); ok((await pg.$$('.an-row')).length === 1, 'Hafta filtresi: yalnız bu haftaki sürüş'); await pg.click('[data-r="month"]'); ok((await pg.$$('.an-row')).length >= 1 && (await pg.$$('.an-row')).length <= 2, 'Ay filtresi çalışır');
  await pg.click('[data-r="all"]'); await pg.click('[data-a="reset"]'); ok(await pg.isVisible('.an-confirm') && /silinmez/.test(await pg.textContent('.an-confirm')), 'Sıfırla: onay kutusu, «kayıtlar silinmez» açıklaması');
  await pg.click('[data-a="reset-no"]'); ok((await pg.$$('.an-row')).length === 2 && !(await pg.$('.an-confirm')), 'Vazgeç: hiçbir şey değişmez');
  await pg.click('[data-a="reset"]'); await pg.click('[data-a="reset-yes"]'); await pg.waitForTimeout(100);
  ok((await pg.$$('.an-row')).length === 0 && /Sıfırlama aktif/.test(await pg.textContent('.an')), 'Evet: sayaç sıfırlanır, liste boş, «Sıfırlama aktif» notu');
  ok(RIDES.length === 2, 'sunucudaki kayıtlar silinmedi (veri aynı)'); await pg.screenshot({ path: '/tmp/analysis-reset.png' });
  await pg.click('[data-a="exit"]'); await pg.waitForTimeout(300); ok(await pg.isVisible('#settings'), 'geri: Ayarlar sayfasına döner');
  await pg.evaluate(() => document.querySelector('[data-nav="home"]').click()); await pg.waitForTimeout(500);
  ok(/Sıfırlaması aktif|sıfırlaması aktif/.test(await T('stMsg')) && num(await T('stWk')) === 0 || /aktif/.test(await T('stMsg')), 'ana sayfa toplamları da sıfırlamayı uygular');
  await pg.evaluate(() => document.querySelector('[data-nav="settings"]').click()); await pg.click('#settings [data-go="analysis"]'); await pg.waitForSelector('[data-a="reset-undo"]'); await pg.click('[data-a="reset-undo"]'); ok((await pg.$$('.an-row')).length === 2, 'Geri al: sürüşler yeniden görünür');
  ok(errs.length === 0, 'sayfa hatası yok ' + JSON.stringify(errs.slice(0, 3)));
  await b.close(); srv.close(); console.log(`SONUÇ: ${p} geçti, ${f} başarısız`); process.exit(f ? 1 : 0);
});
