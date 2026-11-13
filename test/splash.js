const { chromium } = require('/opt/npm-tools/node_modules/playwright'); const http = require('http'), fs = require('fs'), path = require('path');
const root = require('path').join(__dirname, '..', 'public') + '', mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.jpg': 'image/jpeg', '.json': 'application/json' };
const TW = fs.readFileSync('/opt/npm-tools/node_modules/@zenuml/core/dist/vendor/tailwindcss/tailwindcss.js', 'utf8');
const srv = http.createServer((q, r) => { const u = new URL(q.url, 'http://x'), J = (o, s = 200) => { r.writeHead(s, { 'content-type': 'application/json' }); r.end(JSON.stringify(o)); };
  if (u.pathname === '/api/me') return J({ user: { username: 'ben' } }); if (u.pathname.startsWith('/api/')) return J({ error: 'x' }, 404);
  const pa = path.join(root, u.pathname === '/' ? 'index.html' : u.pathname); if (!fs.existsSync(pa)) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': mime[path.extname(pa)] || 'application/octet-stream' }); r.end(fs.readFileSync(pa)); });
srv.listen(0, async () => {
  const b = await chromium.launch(), pg = await (await b.newContext({ viewport: { width: 390, height: 844 } })).newPage(); let ok = 0, bad = 0; const t = (c, m) => { c ? ok++ : bad++; console.log(c ? 'OK  ' : 'FAIL', m); };
  await pg.route('https://cdn.tailwindcss.com/**', r => r.fulfill({ status: 200, contentType: 'text/javascript', body: TW }));
  await pg.route(/^https?:\/\/(?!127\.0\.0\.1|cdn\.tailwindcss)/, r => r.fulfill({ status: 200, contentType: 'text/javascript', body: '{}' }));
  await pg.addInitScript(() => { window.io = () => ({ on() {}, off() {}, emit() {}, connect() {}, connected: false, id: 'x' }); });
  const t0 = Date.now(); await pg.goto('http://127.0.0.1:' + srv.address().port + '/');
  await pg.waitForFunction(() => !document.getElementById('splash'), null, { timeout: 5000 }); const dt = Date.now() - t0;
  t(dt < 2500, 'açılış resmi uygulama hazır olunca kalktı (' + dt + ' ms; sabit bekleme yok)');
  t(!(await pg.$('#dashClock')) && !(await pg.$('#dashDate')) && !(await pg.$('#dash header')), 'ana sayfada tarih/saat/Moto Life başlığı yok');
  console.log('SONUÇ', ok, 'geçti', bad, 'başarısız'); await b.close(); srv.close();
});
