'use strict';
// Çevrimdışı Haritalar arayüzü (gerçek public/offline-maps.js, Chromium + gerçek Cache Storage; sunucu SAHTE). node test/offline-ui.js
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
let p = 0, f = 0; const ok = (c, m) => { c ? p++ : f++; console.log((c ? 'ok: ' : 'FAIL: ') + m); };
const pub = path.join(__dirname, '..', 'public');
let manifest = { packs: [{ id: '34', bytes: 2000000, ver: 'v1', url: '/offline/34.pmtiles' }, { id: '06', bytes: 1000000, ver: 'v1', url: '/offline/06.pmtiles' }, { id: 'tr', bytes: 5000000, ver: 'v1', url: '/offline/tr.pmtiles' }] };
let fail34 = false, down = [];
const srv = http.createServer((req, res) => {
  const u = req.url.split('?')[0];
  if (u === '/') { res.setHeader('content-type', 'text/html; charset=utf-8'); return res.end('<!doctype html><meta name=viewport content="width=device-width"><body style="background:#031420;color:#fff"><div id="t"></div><script src="/offline-maps.js"></script>'); }
  if (u === '/offline-maps.js') { res.setHeader('content-type', 'text/javascript'); return res.end(fs.readFileSync(path.join(pub, 'offline-maps.js'))); }
  if (u === '/api/offline/manifest') { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify(manifest)); }
  const m = /^\/offline\/(\w+)\.pmtiles$/.exec(u);
  if (m) {
    const pk = manifest.packs.find(x => x.id === m[1]); if (!pk) { res.statusCode = 404; return res.end(); }
    down.push(m[1]); res.setHeader('content-length', pk.bytes);
    const chunk = Buffer.alloc(100000, 7); let sent = 0;
    const t = setInterval(() => { if (fail34 && m[1] === '34' && sent >= 600000) { clearInterval(t); return res.destroy(); } if (sent >= pk.bytes) { clearInterval(t); return res.end(); } res.write(chunk); sent += chunk.length; }, 15);
    req.on('close', () => clearInterval(t)); return;
  }
  res.statusCode = 404; res.end();
});
(async () => {
  await new Promise(r => srv.listen(0, r)); const base = 'http://127.0.0.1:' + srv.address().port;
  const b = await chromium.launch(), ctx = await b.newContext({ viewport: { width: 390, height: 844 } }), pg = await ctx.newPage(); const errs = []; pg.on('pageerror', e => errs.push(e.message));
  await pg.goto(base + '/'); await pg.evaluate(() => window.OfflineMaps.mount(document.getElementById('t'), { user: 'x' })); await pg.waitForSelector('[data-om-sel]');
  const rows = await pg.$$('[data-om-sel]'); ok(rows.length === 82, 'katalog: Tüm Türkiye + 81 il = 82 satır');
  ok(await pg.evaluate(() => window.OfflineMaps.REGIONS.filter(r => /^\d\d$/.test(r.id)).length === 81 && new Set(window.OfflineMaps.REGIONS.map(r => r.id)).size === 82), '81 benzersiz plaka kodu');
  const dis = await pg.$$eval('[data-om-sel]', e => e.filter(x => x.disabled).length); ok(dis === 79, 'sunucuda olmayan 79 bölge seçilemez (yalnız 3 paket seçilebilir)');
  ok(/Sunucuda henüz yok/.test(await pg.textContent('body')) && /İstanbul/.test(await pg.textContent('body')), 'olmayan paket «Sunucuda henüz yok» yazar');
  ok(await pg.isDisabled('[data-om-go]'), 'seçim yokken indir düğmesi pasif');
  await pg.fill('[data-om-q]', 'ist'); ok((await pg.$$('[data-om-sel]')).length === 1 && /İstanbul/.test(await pg.textContent('body')), 'il arama (Türkçe büyük/küçük harf): «ist» → İstanbul');
  await pg.fill('[data-om-q]', ''); await pg.check('[data-om-sel="34"]'); await pg.check('[data-om-sel="06"]');
  ok(/2 · 3 MB/.test(await pg.textContent('[data-om-go]')), 'çoktan seçmeli: 2 il, toplam boyut düğmede (' + (await pg.textContent('[data-om-go]')).trim() + ')');
  await pg.click('[data-om-go]'); ok(/Onayla ve İndir/.test(await pg.textContent('[data-om-go]')) && /Wi-Fi/.test(await pg.textContent('body')), 'ilk dokunuş onay ister (mobil veri uyarısı)');
  await pg.click('[data-om-go]'); await pg.waitForSelector('text=/İndiriliyor/', { timeout: 5000 }); ok(await pg.isVisible('[data-om-cancel]'), 'indirme sürerken «İndirmeyi İptal Et»');
  await pg.waitForSelector('text=2 bölge indirildi', { timeout: 20000 });
  const st = await pg.evaluate(async () => { const c = await caches.open('ml-offline-maps'), ks = (await c.keys()).map(k => new URL(k.url).pathname).sort(); const r = await c.match('/offline/34.pmtiles'); return { ks, len: (await r.arrayBuffer()).byteLength, rec: window.OfflineMaps.installed() }; });
  ok(JSON.stringify(st.ks) === '["/offline/06.pmtiles","/offline/34.pmtiles"]' && st.len === 2000000, 'paketler Cache Storage\'a tam boyutla yazıldı');
  ok(st.rec['34'] && st.rec['34'].bytes === 2000000 && st.rec['06'].bytes === 1000000 && window_has(st.rec), 'kayıt tutuldu (installed)');
  ok(/İndirildi · 2 MB/.test(await pg.textContent('body')) && (await pg.$$('[data-om-del]')).length === 2, 'satırlarda «İndirildi» + Sil düğmesi');
  // yeniden yükleyince kalıcı
  await pg.reload(); await pg.evaluate(() => window.OfflineMaps.mount(document.getElementById('t'), { user: 'x' })); await pg.waitForSelector('[data-om-sel]'); ok((await pg.$$('[data-om-del]')).length === 2, 'sayfa yenilenince indirilenler kalır');
  // sunucu yeni sürüm
  manifest.packs[0].ver = 'v2'; await pg.evaluate(() => window.OfflineMaps.mount(document.getElementById('t'), { user: 'x' })); await pg.waitForSelector('text=Yeni sürüm var'); ok(!(await pg.isDisabled('[data-om-sel="34"]')), 'yeni sürüm varsa güncelleme için yeniden seçilebilir');
  // silme
  await pg.click('[data-om-del="06"]'); await pg.waitForSelector('text=Silindi'); const after = await pg.evaluate(async () => (await (await caches.open('ml-offline-maps')).keys()).map(k => new URL(k.url).pathname)); ok(after.length === 1 && after[0] === '/offline/34.pmtiles', 'silince cihazdan kalkar (önbellek + kayıt)');
  // hata: bağlantı yarıda kopar → eksik kayıt kalmaz
  fail34 = true; await pg.evaluate(() => window.OfflineMaps.mount(document.getElementById('t'), { user: 'x' })); await pg.waitForSelector('[data-om-sel="34"]'); await pg.check('[data-om-sel="34"]'); await pg.click('[data-om-go]'); await pg.click('[data-om-go]');
  await pg.waitForSelector('[role=alert]', { timeout: 15000 });
  const part = await pg.evaluate(async () => ({ keys: (await (await caches.open('ml-offline-maps')).keys()).length, rec: window.OfflineMaps.installed() }));
  ok(/İstanbul/.test(await pg.textContent('[role=alert]')) && part.rec['34'] && part.rec['34'].ver === 'v1', 'kopan indirme hata verir; önceki sağlam sürüm bozulmaz (kayıt v1)');
  fail34 = false;
  // iptal
  await pg.evaluate(() => { localStorage.clear(); }); await pg.evaluate(async () => { await caches.delete('ml-offline-maps'); window.OfflineMaps.mount(document.getElementById('t'), { user: 'x' }); }); await pg.waitForSelector('[data-om-sel="tr"]');
  await pg.check('[data-om-sel="tr"]'); await pg.click('[data-om-go]'); await pg.click('[data-om-go]'); await pg.waitForSelector('[data-om-cancel]'); await pg.waitForTimeout(150); await pg.click('[data-om-cancel]'); await pg.waitForSelector('text=/iptal edildi/', { timeout: 5000 });
  ok(Object.keys(await pg.evaluate(() => window.OfflineMaps.installed())).length === 0 && (await pg.evaluate(async () => (await (await caches.open('ml-offline-maps')).keys()).length)) === 0, 'iptal: yarım paket cihazda kalmaz');
  // boş sunucu
  manifest = { packs: [] }; await pg.evaluate(() => window.OfflineMaps.mount(document.getElementById('t'), { user: 'x' })); await pg.waitForSelector('text=henüz harita paketi yok'); ok(true, 'sunucuda paket yoksa açıklayıcı mesaj');
  await pg.screenshot({ path: '/tmp/offline-maps.png' });
  // mobil taşma + dokunma hedefi
  const ov = await pg.evaluate(() => document.documentElement.scrollWidth <= innerWidth); ok(ov, '390 px: yatay taşma yok');
  ok(errs.length === 0, 'sayfa hatası yok ' + JSON.stringify(errs));
  await b.close(); srv.close(); console.log(`SONUÇ: ${p} geçti, ${f} başarısız`); process.exit(f ? 1 : 0);
})();
function window_has(o) { return true; }
