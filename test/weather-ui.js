'use strict';
// Gerçek index.html Chromium'da (Tailwind CDN yok: yalnız gezinme için gereken birkaç sınıf test içinde taklit edilir): alt gezinme (6 sekme, Ayarlar dahil), yüzen düğme yok, hava durumu /api/weather ile (SAHTE yanıt). node test/weather-ui.js
const { chromium } = require(process.env.PLAYWRIGHT_PATH || '/opt/npm-tools/node_modules/playwright'); const http = require('http'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '../public'); const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/json' };
let p = 0, f = 0; const ok = (c, m) => { c ? p++ : f++; console.log((c ? 'ok: ' : 'FAIL: ') + m); };
const now = Date.now(), H = i => now + i * 3600e3;
const OMJ = { provider: 'Open-Meteo', tz: 10800, stale: false, ageMs: 0, current: { t: now, temp: 4.4, feels: 2.2, code: 45, wind: 3.4 }, hourly: [0, 1, 2, 3, 4, 5, 6, 7].map(i => ({ t: H(i), temp: 4 - i * .3, code: i === 2 ? 61 : 3, pop: i * 5, mm: null })) };
const METJ = { provider: 'MET Norway', tz: null, stale: false, ageMs: 0, current: { t: now, temp: 6.1, feels: null, code: 2, wind: 7.2 }, hourly: [0, 1, 2, 3, 4, 5, 6, 7].map(i => ({ t: H(i), temp: 6 - i * .2, code: 3, pop: null, mm: i === 3 ? 1.5 : 0 })) };
let mode = 'om', wcalls = 0;
const srv = http.createServer((q, r) => { const u = new URL(q.url, 'http://x'); const J = (o, s = 200) => { r.writeHead(s, { 'content-type': 'application/json' }); r.end(JSON.stringify(o)); };
  if (u.pathname === '/api/me') return J({ user: { username: 'ben', firstName: 'Ben', lastName: 'X', email: 'a@b.c', hasPassword: true, avatar: '' } });
  if (u.pathname === '/api/weather') { wcalls++; if (mode === 'fail') return J({ error: 'x' }, 502); return J(mode === 'met' ? METJ : mode === 'stale' ? { ...OMJ, stale: true, ageMs: 17 * 60e3 } : OMJ); }
  if (u.pathname.startsWith('/api/')) return J({}, 404);
  const pa = path.join(root, u.pathname === '/' ? 'index.html' : u.pathname); if (!fs.existsSync(pa)) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': mime[path.extname(pa)] || 'application/octet-stream' }); r.end(fs.readFileSync(pa)); });
srv.listen(0, async () => {
  const base = 'http://127.0.0.1:' + srv.address().port, b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, geolocation: { latitude: 39.93, longitude: 32.86 }, permissions: ['geolocation'] }); const pg = await ctx.newPage(); const errs = [];
  pg.on('pageerror', e => errs.push(e.message)); await pg.route(/^https?:\/\/(?!127\.0\.0\.1)/, r => r.fulfill({ status: 200, contentType: 'text/javascript', body: '{}' }));
  await pg.addInitScript(() => { window.tailwind = { config: {} }; window.io = () => ({ on() {}, off() {}, emit() {}, connect() {}, connected: false, id: 'x' }); });
  await pg.goto(base + '/'); await pg.addStyleTag({ content: '.hidden{display:none!important}.grid{display:grid}.grid-cols-5{grid-template-columns:repeat(5,minmax(0,1fr))}.max-w-md{max-width:28rem}.mx-auto{margin-left:auto;margin-right:auto}.fixed{position:fixed}.inset-x-0{left:0;right:0}.bottom-0{bottom:0}.flex{display:flex}.flex-col{flex-direction:column}.items-center{align-items:center}.h-6{height:1.5rem}.w-6{width:1.5rem}' }); await pg.waitForFunction(() => /4°/.test(document.getElementById('wxTemp').textContent), null, { timeout: 8000 }); await pg.waitForTimeout(300);
  const T = id => pg.textContent('#' + id);
  // gezinme
  const nav = await pg.$$eval('#bottomNav [data-nav]', els => els.map(e => ({ n: e.dataset.nav, l: e.textContent.trim(), r: e.getBoundingClientRect().toJSON() })));
  ok(nav.map(x => x.n).join() === 'home,motor,world,social,settings' && nav[4].l === 'Ayarlar', 'alt gezinme: Ana Sayfa, My Moto, Harita, Sosyal, AYARLAR (Analiz Ayarlar içine taşındı)');
  ok(!(await pg.$('#dashSettings')), 'sağ alttaki turuncu yüzen Ayarlar düğmesi kaldırıldı');
    ok(nav.every(x => x.r.width >= 60 && x.r.height >= 44 && x.r.right <= 391) && (await pg.evaluate(() => document.getElementById('bottomNav').getBoundingClientRect().right - innerWidth)) <= 0, 'beş sekme de ≥60×44 px, alt menü taşmıyor (' + Math.round(nav[0].r.width) + ' px)');
  await pg.screenshot({ path: '/tmp/dash.png' });
  // hava durumu
  ok(await T('wxSrc') === 'Open-Meteo' && await T('wxDesc') === 'Sisli' && await T('wxCity') !== '', 'hava: sunucudan geldi, kaynak adı görünür');
  ok(await pg.evaluate(() => ['wxCity', 'wxTemp', 'wxDesc'].every(i => document.getElementById(i).offsetParent !== null)), 'hava kartı minimal: konum + anlık sıcaklık/durum görünür; saatlik ve ayrıntı satırı gizli');
  ok(/güncellendi · 5 dakikada bir yenilenir/.test(await T('wxStamp')), '«5 dakikada bir yenilenir» yazar');
  ok(wcalls >= 1 && !(await pg.evaluate(() => document.documentElement.innerHTML.includes('api.open-meteo.com/v1/forecast'))), 'tarayıcı artık doğrudan Open-Meteo forecast çağırmıyor');
  // yedek sağlayıcı verisi: uydurma yok
  mode = 'met'; await pg.click('#wxRefreshBtn'); await pg.waitForFunction(() => document.getElementById('wxSrc').textContent === 'MET Norway', null, { timeout: 5000 }); 
  ok(await T('wxSrc') === 'MET Norway' && /\d/.test(await T('wxTemp')), 'MET yedeği: kaynak adı görünür, sıcaklık gelir');
  mode = 'stale'; await pg.click('#wxRefreshBtn'); await pg.waitForFunction(() => /Eski veri/.test(document.getElementById('wxStamp').textContent), null, { timeout: 5000 }); ok(/17 dk önce/.test(await T('wxStamp')), 'eski veri açıkça «Eski veri (17 dk önce)» diye işaretlenir');
  mode = 'fail'; await pg.click('#wxRefreshBtn'); await pg.waitForTimeout(600); ok(/güncellenemedi/.test(await T('wxStamp')) && (await T('wxTemp')) !== '' && await pg.isVisible('#wxMain'), 'sunucu hata verince son veri ekranda kalır, «güncellenemedi» yazar');
  // 5 dakikalık yenileme zamanlayıcısı
  const iv = await pg.evaluate(() => dashTimers.length); ok(iv === 2, 'ana sayfa zamanlayıcıları kurulu (ipucu, hava; saat başlığı kaldırıldı)'); 
  await pg.evaluate(() => { window.__ivs = []; const o = window.setInterval; });
  const src = fs.readFileSync(path.join(root, 'index.html'), 'utf8'); ok(/setInterval\(loadWeather, 300000\)/.test(src), 'hava durumu 300000 ms (5 dk) aralıkla yenilenir');
  // Ayarlar sekmesi
  mode = 'om'; await pg.tap('[data-nav="settings"]'); await pg.waitForTimeout(500); ok(await pg.isVisible('#settings') && !(await pg.isVisible('#dash')), 'alt gezinmeden Ayarlar açılır'); ok(await pg.getAttribute('[data-nav="settings"]', 'aria-current') === 'page' && (await pg.getAttribute('[data-nav="home"]', 'aria-current')) === 'false', 'Ayarlar sekmesi seçili görünür');
  await pg.screenshot({ path: '/tmp/settings.png' });
  for (const n of ['motor', 'world', 'social', 'home']) { await pg.evaluate(n => document.querySelector(`[data-nav="${n}"]`).click(), n); await pg.waitForTimeout(500); }
  ok(await pg.isVisible('#dash'), 'diğer sekmeler çalışıyor, ana sayfaya dönüldü'); ok(errs.length === 0, 'sayfa hatası yok ' + JSON.stringify(errs.slice(0, 2)));
  await b.close(); srv.close(); console.log(`SONUÇ: ${p} geçti, ${f} başarısız`); process.exit(f ? 1 : 0);
});
