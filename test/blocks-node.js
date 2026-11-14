'use strict';
// Engellenen kullanıcılar + çevrimdışı harita listesi (Node): GERÇEK server.js/social.js/live.js/offline.js, sahte express/socket.io. node test/blocks-node.js
const fs = require('fs'), os = require('os'), path = require('path'), { spawn } = require('child_process');
let p = 0, f = 0; const ok = (c, m) => { c ? p++ : f++; console.log((c ? 'ok: ' : 'FAIL: ') + m); };
const root = path.join(__dirname, '..'), tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'blk-'));
for (const n of fs.readdirSync(root)) if (!['data', 'node_modules', 'test', '.git'].includes(n)) fs.cpSync(path.join(root, n), path.join(tmp, n), { recursive: true });
fs.cpSync(path.join(__dirname, 'fake-modules'), path.join(tmp, 'node_modules'), { recursive: true });
const PORT = 3800 + Math.floor(Math.random() * 90), base = 'http://127.0.0.1:' + PORT;
const srv = spawn('node', ['server.js'], { cwd: tmp, env: { ...process.env, REG_LIMIT: '1000', PORT }, stdio: 'ignore' });
const capSolve = q => { const m = String(q).match(/(\d+)\s*([+−×])\s*(\d+)/); const a = +m[1], b = +m[3]; return m[2] === '+' ? a + b : m[2] === '−' ? a - b : a * b; };
const call = async (m, u, b, ck, raw) => { if (/^\/api\/(login|register|forgot)$/.test(u) && b) { const c = await (await fetch(base + '/api/captcha')).json(); b = { ...b, cToken: c.token, cAns: String(capSolve(c.q)) }; } const r = await fetch(base + u, { method: m, headers: { ...(raw ? { 'content-type': 'image/jpeg' } : b ? { 'content-type': 'application/json' } : {}), ...(ck ? { cookie: ck } : {}) }, body: raw ? raw : b ? JSON.stringify(b) : undefined }); let j = {}; const t = r.status === 200 && /image/.test(r.headers.get('content-type') || ''); try { j = t ? {} : await r.json(); } catch {} return { s: r.status, j, ck: (r.headers.get('set-cookie') || '').split(';')[0], img: t }; };
let n = 0;
const reg = async un => { const r = await call('POST', '/api/register', { username: un, firstName: un, lastName: 'T', gender: 'erkek', bikeBrand: 'Honda', bikeModel: 'CB', email: un + '@x.com', password: 'Kx9.Mq2!Zw4', phone: '0533' + String(2000000 + ++n) }); if (!r.ck) console.log('REG', r.s, JSON.stringify(r.j)); return r.ck; };
const fsx = require('fs');
(async () => {
  fsx.mkdirSync(path.join(tmp, 'offline-maps'), { recursive: true });
  fsx.writeFileSync(path.join(tmp, 'offline-maps', '34.pmtiles'), Buffer.alloc(5000, 1)); fsx.writeFileSync(path.join(tmp, 'offline-maps', 'x.txt'), 'a');
  for (let i = 0; i < 50; i++) { try { await fetch(base + '/api/me'); break; } catch { await new Promise(r => setTimeout(r, 200)); } }
  const A = await reg('ayse'), B = await reg('berk'), C = await reg('cem');
  let r = await call('POST', '/api/social/requests', { username: 'berk' }, A); ok(r.s === 200 && r.j.rel === 'outgoing', 'istek gönderilir');
  const rid = r.j.requestId; r = await call('POST', '/api/social/requests/' + rid + '/accept', null, B); ok(r.s === 200, 'kabul edilir (arkadaş)');
  r = await call('POST', '/api/social/messages/ayse', { text: 'selam' }, B); ok(r.s === 200, 'arkadaşken mesaj gider');
  r = await call('POST', '/api/social/blocks', { username: 'berk' }, A); ok(r.s === 200 && r.j.rel === 'blocked', 'ayşe berk\'i engeller');
  r = await call('GET', '/api/social/friends', null, A); ok(JSON.stringify(r.j).indexOf('berk') < 0, 'engelle: arkadaşlık silinir');
  r = await call('GET', '/api/social/messages/berk', null, A); ok(r.s === 403, 'engelle: mesajlaşma kapanır');
  r = await call('POST', '/api/social/messages/ayse', { text: 'hey' }, B); ok(r.s >= 400, 'engellenen mesaj gönderemez');
  r = await call('POST', '/api/social/requests', { username: 'ayse' }, B); ok(r.s === 404, 'engellenen istek gönderemez (kullanıcı görünmez: 404)');
  r = await call('POST', '/api/social/requests', { username: 'berk' }, A); ok(r.s === 403, 'engelleyen de engelliyken istek atamaz (önce kaldırmalı)');
  r = await call('GET', '/api/social/search?q=berk', null, A); ok(r.s === 200 && r.j.users.length === 0, 'engellenen aramada çıkmaz');
  r = await call('GET', '/api/social/search?q=ayse', null, B); ok(r.s === 200 && r.j.users.length === 0, 'engelleyen de engellenene aramada çıkmaz');
  r = await call('GET', '/api/social/users/ayse', null, B); ok(r.s === 404, 'engellenen engelleyenin profilini göremez');
  r = await call('GET', '/api/social/users/berk', null, A); ok(r.s === 200 && r.j.rel === 'blocked' && r.j.locked === true, 'engelleyen profili görür: rel=blocked, kilitli');
  r = await call('GET', '/api/social/blocks', null, A); ok(r.s === 200 && r.j.blocks.length === 1 && r.j.blocks[0].username === 'berk', 'engel listesi');
  r = await call('GET', '/api/social/blocks', null, B); ok(r.j.blocks.length === 0, 'liste kişiye özel (berk kimseyi engellemedi)');
  r = await call('POST', '/api/social/blocks', { username: 'ayse' }, A); ok(r.s === 400, 'kendini engelleyemez');
  r = await call('POST', '/api/social/blocks', { username: 'yok' }, A); ok(r.s === 404, 'olmayan kullanıcı engellenemez');
  r = await call('POST', '/api/social/blocks', { username: 'berk' }, A); r = await call('GET', '/api/social/blocks', null, A); ok(r.j.blocks.length === 1, 'tekrar engelleme listeyi çoğaltmaz');
  r = await call('DELETE', '/api/social/blocks/berk', null, A); ok(r.s === 200 && r.j.rel === 'none', 'engel kaldırılır');
  r = await call('DELETE', '/api/social/blocks/berk', null, A); ok(r.s === 404, 'ikinci kaldırma 404');
  r = await call('GET', '/api/social/search?q=berk', null, A); ok(r.j.users.length === 1 && r.j.users[0].rel === 'none', 'kaldırınca aramada çıkar, arkadaşlık geri gelmez');
  r = await call('POST', '/api/social/requests', { username: 'berk' }, A); ok(r.s === 200, 'kaldırınca yeniden istek atılabilir');
  r = await call('GET', '/api/social/blocks', null, ''); ok(r.s === 401, 'giriş olmadan liste yok');
  // hesap silme engel kayıtlarını temizler
  await call('POST', '/api/social/blocks', { username: 'cem' }, B);
  r = await call('POST', '/api/account/delete', { confirm: 'cem', password: 'Kx9.Mq2!Zw4' }, C); r = await call('GET', '/api/social/blocks', null, B); ok(r.j.blocks.length === 0, 'silinen hesap engel listesinden düşer (' + r.s + ')');
  // çevrimdışı harita listesi
  r = await call('GET', '/api/offline/manifest', null, ''); ok(r.s === 401, 'harita listesi giriş ister');
  r = await call('GET', '/api/offline/manifest', null, A); ok(r.s === 200 && r.j.packs.length === 1 && r.j.packs[0].id === '34' && r.j.packs[0].bytes === 5000 && r.j.packs[0].url === '/offline/34.pmtiles' && /^5000-\d+$/.test(r.j.packs[0].ver), 'liste yalnız geçerli adlı paketleri verir (x.txt yok)');
  const f3 = await fetch(base + '/offline/34.pmtiles'); ok(f3.status === 401, 'paket girişsiz indirilemez');
  srv.kill(); console.log(`SONUÇ: ${p} geçti, ${f} başarısız`); process.exit(f ? 1 : 0);
})();
