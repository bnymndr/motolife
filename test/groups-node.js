'use strict';
// Grup içi gönderi/beğeni/yorum (Node): GERÇEK server.js + social.js + ridegroups.js, sahte express/socket.io. node test/groups-node.js
const fs = require('fs'), os = require('os'), path = require('path'), { spawn } = require('child_process');
let p = 0, f = 0; const ok = (c, m) => { c ? p++ : f++; console.log((c ? 'ok: ' : 'FAIL: ') + m); };
const root = path.join(__dirname, '..'), tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'grp-'));
for (const n of fs.readdirSync(root)) if (!['data', 'node_modules', 'test', '.git'].includes(n)) fs.cpSync(path.join(root, n), path.join(tmp, n), { recursive: true });
fs.cpSync(path.join(__dirname, 'fake-modules'), path.join(tmp, 'node_modules'), { recursive: true });
const PORT = 3800 + Math.floor(Math.random() * 90), base = 'http://127.0.0.1:' + PORT;
const srv = spawn('node', ['server.js'], { cwd: tmp, env: { ...process.env, REG_LIMIT: '1000', PORT }, stdio: 'ignore' });
const capSolve = q => { const m = String(q).match(/(\d+)\s*([+−×])\s*(\d+)/); const a = +m[1], b = +m[3]; return m[2] === '+' ? a + b : m[2] === '−' ? a - b : a * b; };
const call = async (m, u, b, ck, raw) => { if (/^\/api\/(login|register|forgot)$/.test(u) && b) { const c = await (await fetch(base + '/api/captcha')).json(); b = { ...b, cToken: c.token, cAns: String(capSolve(c.q)) }; } const r = await fetch(base + u, { method: m, headers: { ...(raw ? { 'content-type': 'image/jpeg' } : b ? { 'content-type': 'application/json' } : {}), ...(ck ? { cookie: ck } : {}) }, body: raw ? raw : b ? JSON.stringify(b) : undefined }); let j = {}; const t = r.status === 200 && /image/.test(r.headers.get('content-type') || ''); try { j = t ? {} : await r.json(); } catch {} return { s: r.status, j, ck: (r.headers.get('set-cookie') || '').split(';')[0], img: t }; };
let n = 0;
const reg = async un => { const r = await call('POST', '/api/register', { username: un, firstName: un, lastName: 'T', gender: 'erkek', bikeBrand: 'Honda', bikeModel: 'CB', email: un + '@x.com', password: 'sifre123', phone: '0533' + String(2000000 + ++n) }); if (!r.ck) console.log('REG', r.s, JSON.stringify(r.j)); return r.ck; };
const jpeg = () => Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), Buffer.alloc(1500, 7)]);
(async () => {
  for (let i = 0; i < 50; i++) { try { await fetch(base + '/api/me'); break; } catch { await new Promise(r => setTimeout(r, 200)); } }
  const A = await reg('lider'), B = await reg('uye'), C = await reg('yabanci');
  let r = await call('POST', '/api/rgroups', { name: 'Hafta Sonu', desc: 'Pazar sürüşleri' }, A); ok(r.s === 200 && r.j.group.desc === 'Pazar sürüşleri', 'grup açıklamasıyla oluşur');
  const gid = r.j.group.id, code = r.j.group.code;
  r = await call('POST', '/api/rgroups/join', { code }, B); ok(r.s === 200, 'üye koduyla katılır');
  r = await call('GET', '/api/rgroups/' + gid, null, B); const m0 = r.j.group.members[0];
  ok(r.s === 200 && r.j.group.members.length === 2 && 'av' in m0 && m0.bike === 'Honda CB' && !('phone' in m0) && r.j.group.code === undefined, 'üye bilgisi: motor var, telefon/kod yok');
  r = await call('GET', '/api/rgroups', null, B); ok(r.j.groups[0].desc === 'Pazar sürüşleri' && r.j.groups[0].posts === 0, 'liste: açıklama + gönderi sayısı');
  // yetki
  r = await call('GET', '/api/rgroups/' + gid + '/posts', null, C); ok(r.s === 404, 'üye olmayan akışı göremez');
  r = await call('POST', '/api/rgroups/' + gid + '/posts', { text: 'merhaba' }, C); ok(r.s === 404, 'üye olmayan paylaşamaz');
  r = await call('POST', '/api/rgroups/' + gid + '/posts', { text: '' }, B); ok(r.s === 400, 'boş gönderi reddedilir');
  // fotoğraf
  r = await call('POST', '/api/social/upload', null, B, jpeg()); const img = r.j.image; ok(r.s === 200 && img, 'fotoğraf yüklenir');
  r = await call('POST', '/api/rgroups/' + gid + '/posts', { text: 'ilk', image: img, mood: 'mutlu' }, B); const pid = r.j.post && r.j.post.id;
  ok(r.s === 200 && r.j.post.image.endsWith(img) && r.j.post.mood === 'mutlu' && r.j.post.mine && r.j.post.canDelete, 'üye foto+ruh haliyle paylaşır');
  r = await call('POST', '/api/rgroups/' + gid + '/posts', { text: 'x', image: img }, B); ok(r.s === 400, 'aynı fotoğraf ikinci kez kullanılamaz');
  r = await call('GET', '/api/social/img/' + img, null, A); ok(r.s === 200 && r.img, 'grup üyesi (arkadaş olmasa da) fotoğrafı görür');
  r = await call('GET', '/api/social/img/' + img, null, C); ok(r.s === 404, 'üye olmayan fotoğrafı göremez');
  r = await call('GET', '/api/rgroups/' + gid + '/posts', null, A); ok(r.s === 200 && r.j.posts.length === 1 && !r.j.posts[0].mine && r.j.posts[0].canDelete, 'lider akışta görür, lider silebilir');
  r = await call('GET', '/api/social/feed', null, A); ok(!r.j.posts.some(x => x.id === pid), 'grup gönderisi genel akışa sızmaz');
  // beğeni/yorum
  r = await call('POST', '/api/rgroups/' + gid + '/posts/' + pid + '/like', {}, A); ok(r.j.liked === true && r.j.likes === 1, 'beğeni');
  r = await call('POST', '/api/rgroups/' + gid + '/posts/' + pid + '/like', {}, A); ok(r.j.liked === false && r.j.likes === 0, 'beğeni geri alınır');
  r = await call('POST', '/api/rgroups/' + gid + '/posts/' + pid + '/like', {}, C); ok(r.s === 404, 'yabancı beğenemez');
  r = await call('POST', '/api/rgroups/' + gid + '/posts/' + pid + '/comments', { text: 'süper' }, A); const cid = r.j.comment && r.j.comment.id; ok(r.s === 200 && r.j.commentCount === 1, 'yorum');
  r = await call('POST', '/api/rgroups/' + gid + '/posts/' + pid + '/comments', { text: ' ' }, A); ok(r.s === 400, 'boş yorum reddedilir');
  r = await call('POST', '/api/rgroups/' + gid + '/posts/' + pid + '/comments', { text: 'hayır' }, C); ok(r.s === 404, 'yabancı yorum yapamaz');
  r = await call('GET', '/api/rgroups/' + gid + '/posts', null, B); ok(r.j.posts[0].commentCount === 1 && r.j.posts[0].comments[0].text === 'süper', 'yorum akışta');
  // silme yetkisi
  r = await call('POST', '/api/rgroups/' + gid + '/posts', { text: 'lider yazdı' }, A); const pid2 = r.j.post.id;
  r = await call('DELETE', '/api/rgroups/' + gid + '/posts/' + pid2, null, B); ok(r.s === 403, 'üye başkasının gönderisini silemez');
  r = await call('DELETE', '/api/rgroups/' + gid + '/posts/' + pid + '/comments/' + cid, null, B); ok(r.s === 403, 'üye başkasının yorumunu silemez');
  r = await call('DELETE', '/api/rgroups/' + gid + '/posts/' + pid + '/comments/' + cid, null, A); ok(r.s === 200, 'yorum sahibi siler');
  r = await call('DELETE', '/api/rgroups/' + gid + '/posts/' + pid2, null, A); ok(r.s === 200, 'gönderi sahibi siler');
  // lider başkasının gönderisini siler
  r = await call('POST', '/api/rgroups/' + gid + '/posts', { text: 'uye yazdı' }, B); const pid3 = r.j.post.id;
  r = await call('DELETE', '/api/rgroups/' + gid + '/posts/' + pid3, null, A); ok(r.s === 200, 'lider üyenin gönderisini siler');
  // PATCH açıklama
  r = await call('PATCH', '/api/rgroups/' + gid, { desc: 'Yeni' }, B); ok(r.s === 403, 'açıklamayı yalnız lider değiştirir');
  r = await call('PATCH', '/api/rgroups/' + gid, { desc: 'Yeni' }, A); ok(r.j.group.desc === 'Yeni', 'lider açıklamayı değiştirir');
  // ayrılınca gönderiler/foto silinir
  r = await call('POST', '/api/rgroups/' + gid + '/leave', {}, B); ok(r.s === 200, 'üye ayrılır');
  r = await call('GET', '/api/rgroups/' + gid + '/posts', null, A); ok(r.j.posts.length === 0, 'ayrılan üyenin gönderileri silinir');
  r = await call('GET', '/api/social/img/' + img, null, B); ok(r.s === 404, 'ayrılan üye fotoğrafı göremez');
  const files = fs.existsSync(path.join(tmp, 'data', 'social-img')) ? fs.readdirSync(path.join(tmp, 'data', 'social-img')) : [];
  ok(!files.includes(img + '.jpg'), 'fotoğraf dosyası diskten silinir');
  srv.kill(); fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\n${p} geçti, ${f} kaldı`); process.exit(f ? 1 : 0);
})().catch(e => { console.error(e); srv.kill(); process.exit(1); });
