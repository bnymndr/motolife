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
const reg = async un => { const r = await call('POST', '/api/register', { username: un, firstName: un, lastName: 'T', gender: 'erkek', bikeBrand: 'Honda', bikeModel: 'CB', email: un + '@x.com', password: 'Kx9.Mq2!Zw4', phone: '0533' + String(2000000 + ++n) }); if (!r.ck) console.log('REG', r.s, JSON.stringify(r.j)); return r.ck; };
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
  // ---- Roller (Lider / Yönetici / Üye) + grup fotoğrafı/kapağı + profil kapağı ----
  const D = await reg('dis');
  r = await call('POST', '/api/rgroups', { name: 'Roller' }, A); const g2 = r.j.group.id, code2 = r.j.group.code;
  await call('POST', '/api/rgroups/join', { code: code2 }, B); await call('POST', '/api/rgroups/join', { code: code2 }, C);
  r = await call('PUT', `/api/rgroups/${g2}/pic/photo`, null, B, jpeg()); ok(r.s === 403, 'üye grup fotoğrafı değiştiremez');
  r = await call('PUT', `/api/rgroups/${g2}/pic/photo`, null, A, Buffer.from('bu jpeg degil')); ok(r.s === 400, 'JPEG olmayan dosya reddedilir');
  r = await call('PUT', `/api/rgroups/${g2}/pic/photo`, null, A, jpeg()); ok(r.s === 200 && /\/pic\/photo\?v=/.test(r.j.group.photo), 'lider grup fotoğrafı yükler');
  r = await call('PUT', `/api/rgroups/${g2}/pic/cover`, null, A, jpeg()); ok(r.s === 200 && /\/pic\/cover\?v=/.test(r.j.group.cover), 'lider grup kapağı yükler');
  r = await call('GET', `/api/rgroups/${g2}/pic/photo`, null, B); ok(r.s === 200 && r.img, 'üye grup fotoğrafını görür');
  r = await call('GET', `/api/rgroups/${g2}/pic/cover`, null, D); ok(r.s === 404, 'üye olmayan grup kapağını göremez');
  r = await call('GET', '/api/rgroups', null, B); ok(!!r.j.groups.find(x => x.id === g2).photo, 'liste grup fotoğrafı adresini verir');
  r = await call('POST', `/api/rgroups/${g2}/role`, { username: 'uye', role: 'admin' }, B); ok(r.s === 403, 'üye rol atayamaz');
  r = await call('POST', `/api/rgroups/${g2}/role`, { username: 'lider', role: 'member' }, A); ok(r.s === 400, 'liderin rolü değiştirilemez');
  r = await call('POST', `/api/rgroups/${g2}/role`, { username: 'uye', role: 'admin' }, A); ok(r.s === 200 && r.j.group.members.find(m => m.username === 'uye').role === 'admin', 'lider yönetici atar');
  r = await call('GET', `/api/rgroups/${g2}`, null, B); ok(r.j.group.role === 'admin' && !!r.j.group.code, 'yönetici rolünü ve davet kodunu görür');
  r = await call('PUT', `/api/rgroups/${g2}/pic/cover`, null, B, jpeg()); ok(r.s === 200, 'yönetici grup kapağını değiştirir');
  r = await call('PATCH', `/api/rgroups/${g2}`, { name: 'Roller 2' }, B); ok(r.s === 200 && r.j.group.name === 'Roller 2', 'yönetici grup adını düzenler');
  r = await call('POST', `/api/rgroups/${g2}/kick`, { username: 'lider' }, B); ok(r.s === 403, 'yönetici lideri çıkaramaz');
  r = await call('POST', `/api/rgroups/${g2}/role`, { username: 'yabanci', role: 'admin' }, A);
  r = await call('POST', `/api/rgroups/${g2}/kick`, { username: 'yabanci' }, B); ok(r.s === 403, 'yönetici başka yöneticiyi çıkaramaz');
  r = await call('POST', `/api/rgroups/${g2}/role`, { username: 'yabanci', role: 'member' }, A);
  r = await call('POST', `/api/rgroups/${g2}/leader`, { username: 'uye' }, B); ok(r.s === 403, 'yönetici lider devredemez');
  r = await call('DELETE', `/api/rgroups/${g2}`, null, B); ok(r.s === 403, 'yönetici grubu silemez');
  r = await call('POST', `/api/rgroups/${g2}/kick`, { username: 'yabanci' }, B); ok(r.s === 200, 'yönetici üyeyi çıkarır');
  r = await call('PUT', `/api/rgroups/${g2}/pic/photo`, null, A, Buffer.alloc(0)); ok(r.s === 200 && r.j.group.photo === '', 'boş gövde grup fotoğrafını kaldırır');
  r = await call('POST', `/api/rgroups/${g2}/leader`, { username: 'uye' }, A); r = await call('GET', `/api/rgroups/${g2}`, null, B);
  ok(r.j.group.role === 'leader' && r.j.group.members.find(m => m.username === 'lider').role === 'member', 'lider devrinde eski lider üye olur, yeni lider yönetici rolünden çıkar');
  r = await call('PUT', '/api/social/cover', null, A, jpeg()); ok(r.s === 200 && r.j.me.cv, 'profil kapağı yüklenir (profilde cv sürümü)');
  r = await call('GET', '/api/social/cover/lider', null, D); ok(r.s === 200 && r.img, 'başka kullanıcı profil kapağını görür');
  r = await call('PUT', '/api/social/cover', null, A, Buffer.from('x')); ok(r.s === 400, 'geçersiz kapak reddedilir');
  r = await call('PUT', '/api/social/cover', null, A, Buffer.alloc(0)); r = await call('GET', '/api/social/cover/lider', null, D); ok(r.s === 404, 'kapak kaldırılır');
  r = await call('POST', '/api/avatar', { image: '' }, A); ok(r.s === 200 && !r.j.user.avatar, 'profil resmi boş gönderilince kaldırılır');
  srv.kill(); fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\n${p} geçti, ${f} kaldı`); process.exit(f ? 1 : 0);
})().catch(e => { console.error(e); srv.kill(); process.exit(1); });
