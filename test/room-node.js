// Grup interkom odası (Node): GERÇEK server.js + grouproom.js, sahte express/socket.io. node test/room-node.js
const fs = require('fs'), os = require('os'), path = require('path'), { spawn } = require('child_process');
let p = 0, f = 0; const ok = (c, m) => { c ? p++ : f++; console.log((c ? 'ok: ' : 'FAIL: ') + m); };
const root = path.join(__dirname, '..'), tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'grp-'));
for (const n of fs.readdirSync(root)) if (!['data', 'node_modules', 'test', '.git'].includes(n)) fs.cpSync(path.join(root, n), path.join(tmp, n), { recursive: true });
fs.cpSync(path.join(__dirname, 'fake-modules'), path.join(tmp, 'node_modules'), { recursive: true });
const PORT = 3800 + Math.floor(Math.random() * 40), P2 = PORT + 50; let base = 'http://127.0.0.1:' + PORT;
const srv = spawn('node', ['server.js'], { cwd: tmp, env: { ...process.env, REG_LIMIT: '1000', PORT }, stdio: 'ignore' });
const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), 'grp2-')); for (const n of fs.readdirSync(tmp)) fs.cpSync(path.join(tmp, n), path.join(tmp2, n), { recursive: true });
const srv2 = spawn('node', ['server.js'], { cwd: tmp2, env: { ...process.env, REG_LIMIT: '1000', PORT: P2, ROOM_TTL_MS: '2500' }, stdio: 'ignore' });   // kısa ömürlü oda (24 saat dolumu testi)
const capSolve = q => { const m = String(q).match(/(\d+)\s*([+−×])\s*(\d+)/); const a = +m[1], b = +m[3]; return m[2] === '+' ? a + b : m[2] === '−' ? a - b : a * b; };
const call = async (m, u, b, ck, raw) => { if (/^\/api\/(login|register|forgot)$/.test(u) && b) { const c = await (await fetch(base + '/api/captcha')).json(); b = { ...b, cToken: c.token, cAns: String(capSolve(c.q)) }; } const r = await fetch(base + u, { method: m, headers: { ...(raw ? { 'content-type': 'image/jpeg' } : b ? { 'content-type': 'application/json' } : {}), ...(ck ? { cookie: ck } : {}) }, body: raw ? raw : b ? JSON.stringify(b) : undefined }); let j = {}; const t = r.status === 200 && /image/.test(r.headers.get('content-type') || ''); try { j = t ? {} : await r.json(); } catch {} return { s: r.status, j, ck: (r.headers.get('set-cookie') || '').split(';')[0], img: t }; };
let n = 0;
const reg = async un => { const r = await call('POST', '/api/register', { username: un, firstName: un, lastName: 'T', gender: 'erkek', bikeBrand: 'Honda', bikeModel: 'CB', email: un + '@x.com', password: 'Kx9.Mq2!Zw4', phone: '0533' + String(2000000 + ++n) }); if (!r.ck) console.log('REG', r.s, JSON.stringify(r.j)); return r.ck; };
const jpeg = () => Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), Buffer.alloc(1500, 7)]);
(async () => {
  for (const b of ['http://127.0.0.1:' + PORT, 'http://127.0.0.1:' + P2]) for (let i = 0; i < 50; i++) { try { await fetch(b + '/api/me'); break; } catch { await new Promise(r => setTimeout(r, 200)); } }
  const A = await reg('lider'), B = await reg('uye1'), C = await reg('uye2'), D = await reg('yabanci');
  let r = await call('POST', '/api/rgroups', { name: 'Hafta Sonu' }, A); const gid = r.j.group.id, code = r.j.group.code;
  await call('POST', '/api/rgroups/join', { code }, B); await call('POST', '/api/rgroups/join', { code }, C);
  const R = '/api/rgroups/' + gid + '/rooms', ls = u => call('GET', R, null, u), rm = (m, rid, s, b, u) => call(m, R + '/' + rid + s, b, u);
  r = await ls(A); ok(r.s === 200 && Array.isArray(r.j.rooms) && r.j.rooms.length === 0 && r.j.mine === null, 'başta oda yok');
  r = await ls(D); ok(r.s === 404, 'grup üyesi olmayan odaları göremez');
  r = await call('POST', R, { name: '', password: 'abcd' }, A); ok(r.s === 400, 'oda adı zorunlu');
  r = await call('POST', R, { name: 'Yol', password: 'ab' }, A); ok(r.s === 400, 'kısa şifre reddedilir');
  r = await call('POST', R, { name: 'Yol Arkadaşları', password: 'gizli1' }, D); ok(r.s === 404, 'üye olmayan oda kuramaz');
  r = await call('POST', R, { name: 'Yol Arkadaşları', password: 'gizli1' }, A); ok(r.s === 200 && r.j.room.in && r.j.room.lead && r.j.room.parts.length === 1, 'üye oda kurar, lider olur');
  ok(!JSON.stringify(r.j).includes('gizli1') && !/hash|salt/i.test(JSON.stringify(r.j)), 'şifre/özet yanıtta yok');
  const room1 = r.j.room, rid1 = room1.rid, uidA = room1.parts[0].uid;
  ok(/^[0-9a-f]{12}$/.test(rid1) && room1.exp - Date.now() > 23.9 * 3600000 && room1.exp - Date.now() <= 24 * 3600000, 'oda kimliği var; ömrü 24 saat');
  // ÇOKLU ODA
  r = await call('POST', R, { name: 'yol arkadaşları', password: 'abcd12' }, B); ok(r.s === 409, 'aynı adda ikinci oda kurulamaz (büyük/küçük harf duyarsız)');
  r = await call('POST', R, { name: 'Başka Oda', password: 'gizli2' }, B); ok(r.s === 200 && r.j.room.lead, 'başka üye kendi odasını kurar ve onun lideri olur');
  const rid2 = r.j.room.rid;
  r = await ls(C); ok(r.j.rooms.length === 2 && r.j.mine === null && r.j.rooms.every(x => !x.in && x.name && x.count === 1 && x.leaderName && x.exp), 'oda listesi: ad, lider, kişi sayısı, bitiş zamanı');
  ok(!JSON.stringify(r.j).includes('gizli'), 'liste şifre/özet içermez');
  r = await ls(A); ok(r.j.mine === rid1, 'listede kendi odan işaretli');
  r = await rm('GET', rid1, '', null, C); ok(r.s === 200 && !r.j.room.in && r.j.room.parts === undefined && r.j.room.name === 'Yol Arkadaşları', 'girmeyen üye katılımcıları görmez');
  r = await rm('GET', 'ffffffffffff', '', null, C); ok(r.s === 404, 'olmayan oda 404');
  r = await rm('POST', rid1, '/join', { password: 'yanlis' }, C); ok(r.s === 403, 'yanlış şifre reddedilir');
  r = await rm('POST', rid1, '/join', { password: 'gizli1' }, D); ok(r.s === 404, 'üye olmayan giremez');
  r = await rm('POST', rid2, '/join', { password: 'gizli1' }, C); ok(r.s === 403, 'bir odanın şifresi öbürüne uymaz');
  r = await rm('POST', rid1, '/join', { password: 'gizli1' }, C); ok(r.s === 200 && r.j.room.in && !r.j.room.lead && r.j.room.parts.length === 2, 'doğru şifreyle girer');
  const uidC = r.j.room.parts.find(x => x.you).uid; ok(r.j.room.members === undefined, 'lider olmayan davet listesi görmez');
  r = await rm('POST', rid2, '/join', { password: 'gizli2' }, C); ok(r.s === 200, 'başka odaya girer');
  r = await rm('GET', rid1, '', null, A); ok(r.j.room.parts.length === 1, 'kişi aynı grupta tek odada: eski odadan düştü');
  r = await ls(C); ok(r.j.mine === rid2, 'listede şimdiki oda işaretli');
  r = await rm('POST', rid1, '/join', { password: 'gizli1' }, C); ok(r.s === 200, 'C yeniden ilk odaya geçer');
  // yetki
  r = await rm('POST', rid1, '/kick', { uid: uidA }, C); ok(r.s === 403, 'lider olmayan atamaz');
  r = await rm('POST', rid1, '/user', { uid: uidA, muted: true }, C); ok(r.s === 403, 'lider olmayan susturamaz');
  r = await rm('POST', rid1, '/source', { type: 'radio', url: 'https://r.example/x', title: 'R' }, C); ok(r.s === 403, 'lider olmayan yayın paylaşamaz');
  r = await rm('POST', rid1, '/close', {}, C); ok(r.s === 403, 'üye odayı kapatamaz');
  r = await rm('POST', rid1, '/kick', { uid: uidA }, B); ok(r.s === 404, 'başka odanın lideri bu odada işlem yapamaz');
  // lider işlemleri
  r = await rm('POST', rid1, '/user', { uid: uidC, vol: 30, muted: true }, A); const pc = r.j.room.parts.find(x => x.uid === uidC); ok(r.s === 200 && pc.vol === 30 && pc.muted === true, 'lider kişi sesini kısar + konuşmasını kapatır');
  r = await rm('POST', rid1, '/user', { uid: uidC, vol: 500 }, A); ok(r.j.room.parts.find(x => x.uid === uidC).vol === 100, 'ses 0-100 arasına sıkıştırılır');
  r = await rm('POST', rid1, '/user', { uid: uidC, vol: 'abc' }, A); ok(r.s === 400, 'geçersiz ses reddedilir');
  r = await rm('GET', rid1, '', null, C); ok(r.j.room.parts.find(x => x.you).muted === true, 'üye kendi susturulduğunu görür');
  r = await rm('POST', rid1, '/source', { type: 'radio', url: 'http://r.example/x', title: 'R' }, A); ok(r.s === 400, 'http radyo reddedilir');
  r = await rm('POST', rid1, '/source', { type: 'yt', id: 'kısa', title: 'V' }, A); ok(r.s === 400, 'geçersiz YouTube kimliği reddedilir');
  r = await rm('POST', rid1, '/source', { type: 'radio', url: 'https://r.example/x', title: 'Radyo X' }, A); ok(r.s === 200 && r.j.room.src.type === 'radio', 'lider radyo paylaşır');
  r = await rm('GET', rid1, '', null, C); ok(r.j.room.src && r.j.room.src.title === 'Radyo X', 'üye paylaşılan yayını görür');
  r = await rm('POST', rid1, '/source', { type: 'yt', id: 'dQw4w9WgXcQ', title: 'Video' }, A); ok(r.j.room.src.type === 'yt', 'YouTube paylaşımı');
  r = await rm('POST', rid1, '/source', { type: 'file', title: 'Şarkı' }, A); ok(r.j.room.src.type === 'file', 'dosya yayını duyurusu');
  r = await rm('DELETE', rid1, '/source', null, A); ok(r.j.room.src === null, 'yayın durdurulur');
  // davet
  r = await rm('GET', rid1, '', null, A); ok(r.j.room.members.length === 1 && r.j.room.members[0].name === 'uye1', 'lider odada olmayan grup üyelerini davet için görür');
  r = await rm('POST', rid1, '/invite', { uid: uidC }, A); ok(r.s === 400, 'odadaki davet edilemez');
  const uidB = r.j && null; const bU = (await rm('GET', rid1, '', null, A)).j.room.members[0].uid;
  r = await rm('POST', rid1, '/invite', { uid: bU }, A); ok(r.s === 200, 'lider grup üyesine davet gönderir');
  r = await ls(B); ok(r.j.rooms.find(x => x.rid === rid1).invited === true, 'davetli listede davetini görür (şifre yine gerekir)');
  r = await rm('POST', rid1, '/join', { password: 'x1x1x1' }, B); ok(r.s === 403, 'davet şifre yerine geçmez');
  r = await rm('POST', rid1, '/invite', { uid: 'yok' }, A); ok(r.s === 404, 'grup dışı kişi davet edilemez');
  // at
  r = await rm('POST', rid1, '/kick', { uid: uidA }, A); ok(r.s === 400, 'lider kendini atamaz');
  r = await rm('POST', rid1, '/kick', { uid: uidC }, A); ok(r.s === 200, 'lider katılımcıyı atar');
  r = await rm('GET', rid1, '', null, C); ok(!r.j.room.in, 'atılan odada değil');
  r = await rm('POST', rid1, '/join', { password: 'gizli1' }, C); ok(r.s === 403, 'atılan doğru şifreyle bile giremez');
  r = await ls(C); ok(r.j.rooms.find(x => x.rid === rid1).banned === true, 'atılan listede «çıkarıldın» görür');
  await rm('POST', rid1, '/invite', { uid: uidC }, A);
  r = await rm('POST', rid1, '/join', { password: 'gizli1' }, C); ok(r.s === 200, 'yeniden davet edilen girebilir');
  // deneme sınırı
  for (let i = 0; i < 5; i++) await rm('POST', rid1, '/join', { password: 'yok' + i }, B);
  r = await rm('POST', rid1, '/join', { password: 'gizli1' }, B); ok(r.s === 429, '5 yanlış denemeden sonra geçici engel');
  // lider çıkınca en eski katılımcıya devir; boş oda sürer
  r = await rm('POST', rid1, '/leave', {}, A); ok(r.s === 200, 'lider ayrılır');
  r = await rm('GET', rid1, '', null, C); ok(r.j.room.in && r.j.room.lead && r.j.room.parts.length === 1, 'liderlik odadaki en eski üyeye geçti, oda sürüyor');
  r = await rm('POST', rid1, '/leave', {}, C); ok(r.s === 200, 'son kişi de çıkar');
  r = await ls(A); const e1 = r.j.rooms.find(x => x.rid === rid1); ok(e1 && e1.count === 0 && e1.leaderName === '', 'BOŞ ODA SİLİNMEZ: 24 saat dolana dek listede durur');
  r = await rm('POST', rid1, '/join', { password: 'gizli1' }, A); ok(r.s === 200 && r.j.room.lead && r.j.room.parts.length === 1, 'boş odaya ilk giren lider olur');
  r = await rm('POST', rid1, '/close', {}, A); ok(r.s === 200, 'lider odayı kapatır');
  r = await rm('GET', rid1, '', null, A); ok(r.s === 404, 'kapanan oda silindi');
  r = await ls(A); ok(r.j.rooms.length === 1 && r.j.rooms[0].rid === rid2, 'diğer oda etkilenmedi');
  // oda sayısı sınırı
  for (let i = 0; i < 9; i++) r = await call('POST', R, { name: 'Oda ' + i, password: 'abcd12' }, [A, B, C][i % 3]);
  r = await call('POST', R, { name: 'Fazla', password: 'abcd12' }, A); ok(r.s === 409, 'grup başına en çok 10 oda');
  // SÜRÜŞ (odaya bağlı grup sürüşü)
  const G2 = await call('POST', '/api/rgroups', { name: 'Sürüş Grubu' }, A); const gid2 = G2.j.group.id; await call('POST', '/api/rgroups/join', { code: G2.j.group.code }, B); await call('POST', '/api/rgroups/join', { code: G2.j.group.code }, C);
  const R2 = '/api/rgroups/' + gid2 + '/rooms', rr = (m, rid, s, b, u) => call(m, R2 + '/' + rid + s, b, u);
  r = await call('POST', R2, { name: 'Sürüş Odası', password: 'gizli1' }, A); const sr = r.j.room.rid; ok(r.j.room.ride === null, 'başta sürüş yok');
  await rr('POST', sr, '/join', { password: 'gizli1' }, B); await rr('POST', sr, '/join', { password: 'gizli1' }, C);
  r = await rr('POST', sr, '/ride/start', {}, B); ok(r.s === 403, 'yalnız oda lideri sürüşü başlatır');
  r = await rr('POST', sr, '/ride/number', { n: 7 }, B); ok(r.s === 409, 'sürüş yokken numara yazılamaz');
  r = await rr('POST', sr, '/ride/start', {}, A); ok(r.s === 200 && r.j.room.ride && r.j.room.ride.mine === null && r.j.room.ride.startedAt > 0, 'lider sürüşü başlatır; herkesin numarası henüz yok');
  r = await rr('GET', sr, '', null, B); ok(r.j.room.ride && r.j.room.ride.mine === null, 'üye de sürüşü görür (numara sorusu çıkar)');
  r = await rr('POST', sr, '/ride/start', {}, A); ok(r.s === 409, 'sürüş zaten sürüyor');
  r = await rr('POST', sr, '/ride/number', { n: 'abc' }, B); ok(r.s === 400, 'sayı olmayan numara reddedilir');
  r = await rr('POST', sr, '/ride/number', { n: 0 }, B); ok(r.s === 400, '0 reddedilir');
  r = await rr('POST', sr, '/ride/number', { n: 100 }, B); ok(r.s === 400, '100 reddedilir');
  r = await rr('POST', sr, '/ride/number', { n: 7 }, B); ok(r.s === 200 && r.j.room.ride.mine === 7 && r.j.n === 7, 'üye kendi numarasını yazar');
  r = await rr('POST', sr, '/ride/number', { n: 7 }, C); ok(r.s === 409, 'aynı numara iki kişide olamaz');
  r = await rr('POST', sr, '/ride/number', { n: '07' }, C); ok(r.s === 409, '«07» de 7 sayılır (çakışır)');
  r = await rr('POST', sr, '/ride/number', { n: '' }, C); ok(r.s === 200 && r.j.n === 1, 'boş bırakılırsa ilk boş numara (1)');
  r = await rr('POST', sr, '/ride/number', {}, A); ok(r.s === 200 && r.j.n === 2, 'numara verilmezse sıradaki boş numara (2)');
  r = await rr('POST', sr, '/ride/number', { n: 7 }, B); ok(r.s === 200 && r.j.n === 7, 'kendi numarasını yeniden yazabilir');
  r = await rr('POST', sr, '/ride/number', { n: 9 }, B); ok(r.s === 200 && r.j.room.ride.mine === 9, 'numara değiştirilebilir');
  r = await rr('POST', sr, '/ride/number', { n: 7 }, C); ok(r.s === 200, 'boşalan numara başkasına verilebilir');
  r = await rr('GET', sr, '', null, A); const nums = r.j.room.ride.nums, vals = Object.values(nums); ok(vals.length === 3 && new Set(vals).size === 3 && nums[uidA] === 2, 'numaralar benzersiz ve odadakilerde görünür');
  r = await rr('POST', sr, '/ride/number', { n: 5 }, D); ok(r.s === 404, 'odada olmayan numara yazamaz');
  r = await call('GET', '/api/rgroups/' + gid2, null, A); ok(r.j.group.ride && r.j.group.ride.id === (await rr('GET', sr, '', null, A)).j.room.ride.id, 'grup sürüşü gerçekten başladı (aynı sürüş kimliği)');
  r = await rr('POST', sr, '/ride/end', {}, B); ok(r.s === 403, 'yalnız lider sürüşü bitirir');
  r = await rr('POST', sr, '/ride/end', {}, A); ok(r.s === 200 && r.j.room.ride === null, 'lider sürüşü bitirir');
  r = await call('GET', '/api/rgroups/' + gid2, null, A); ok(!r.j.group.ride, 'grup sürüşü kapandı');
  await rr('POST', sr, '/ride/start', {}, A); r = await rr('POST', sr, '/close', {}, A);
  r = await call('GET', '/api/rgroups/' + gid2, null, A); ok(r.s === 200 && !r.j.group.ride, 'oda kapanınca bağlı sürüş de biter');
  // livekit kapısı
  r = await call('POST', '/api/livekit/token', { gid }, D); ok(r.s === 503 || r.s === 403 || r.s === 404, 'livekit belirteci odaya girmeden verilmez');
  // 24 SAAT DOLUMU (ikinci sunucu, ömür 2,5 sn)
  base = 'http://127.0.0.1:' + P2; n += 10;
  const A2 = await reg('lider2'), B2 = await reg('uye3');
  r = await call('POST', '/api/rgroups', { name: 'Kısa Ömür' }, A2); const g3 = r.j.group.id; await call('POST', '/api/rgroups/join', { code: r.j.group.code }, B2);
  const R3 = '/api/rgroups/' + g3 + '/rooms'; r = await call('POST', R3, { name: 'Geçici', password: 'abcd12' }, A2); const xr = r.j.room.rid;
  await call('POST', R3 + '/' + xr + '/ride/start', {}, A2);
  r = await call('GET', R3, null, B2); ok(r.j.rooms.length === 1, 'süre dolmadan oda listede');
  await new Promise(res => setTimeout(res, 3000));
  r = await call('GET', R3, null, B2); ok(r.s === 200 && r.j.rooms.length === 0, 'süre dolunca oda otomatik kapanır ve silinir (kimse işlem yapmasa da)');
  r = await call('GET', R3 + '/' + xr, null, A2); ok(r.s === 404, 'süresi dolan odaya erişilemez');
  r = await call('POST', R3 + '/' + xr + '/join', { password: 'abcd12' }, B2); ok(r.s === 404, 'süresi dolan odaya girilemez');
  r = await call('GET', '/api/rgroups/' + g3, null, A2); ok(!r.j.group.ride, 'oda süresi dolunca bağlı sürüş de biter');
  srv.kill(); srv2.kill(); fs.rmSync(tmp, { recursive: true, force: true }); fs.rmSync(tmp2, { recursive: true, force: true });
  console.log(`\n${p} geçti, ${f} kaldı`); process.exit(f ? 1 : 0);
})().catch(e => { console.error(e); srv.kill(); srv2.kill(); process.exit(1); });
