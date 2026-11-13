'use strict';
// Grup sesi sunucu testleri: GERÇEK groupvoice.js, SAHTE io/ridegroups. node test/gv-server.js
const { FakeIO } = require('./gv-fakeio.js'); const mount = require('../groupvoice.js'); let p = 0, f = 0; const ok = (c, m) => { c ? p++ : f++; console.log((c ? 'ok: ' : 'FAIL: ') + m); };
const users = { a: { id: 'a', username: 'Ali' }, b: { id: 'b', username: 'Bora' }, c: { id: 'c', username: 'Cem' }, x: { id: 'x', username: 'Yabancı' } };
const groups = { g1: { id: 'g1', leader: 'a', members: [{ uid: 'a' }, { uid: 'b' }, { uid: 'c' }] }, g2: { id: 'g2', leader: 'x', members: [{ uid: 'x' }] } };
const routes = {}; const app = { get: (pth, h) => { routes[pth] = h; } };
let clock = 1e6; const io = new FakeIO(); const env = { GV_TURN_URLS: 'turn:t.example:3478, turns:t.example:5349', GV_TURN_USER: 'u', GV_TURN_CREDENTIAL: 'SIR' };
const svc = mount({ app, io, userFromCookie: c => users[c] || null, uname: u => u.username, rg: { groupOf: id => groups[id] || null }, now: () => clock, env, timers: false });
const mk = id => io.connect(users[id]); const ev = (s, n) => s.log.filter(([e]) => e === n).map(x => x[1]);
(async () => {
  // ICE
  const ice = async cookie => { const o = {}; routes['/api/gvoice/ice']({ headers: { cookie } }, { status(c) { o.c = c; return this; }, set() {}, json(b) { o.b = b; } }); return o; };
  let r = await ice(''); ok(r.c === 401 && !JSON.stringify(r.b).includes('SIR'), 'ICE: oturumsuz 401 ve TURN parolası sızmaz');
  r = await ice('a'); ok(r.b.iceServers.length === 2 && r.b.iceServers[1].credential === 'SIR' && r.b.iceServers[1].urls.length === 2 && r.b.turn, 'ICE: üyeye STUN + TURN verilir');
  // katılma
  const A = mk('a'), B = mk('b'), C = mk('c'), X = mk('x');
  r = await X.send('gv:join', { gid: 'g1' }); ok(r.code === 'forbidden', 'üye olmayan sesli odaya giremez'); r = await A.send('gv:join', { gid: 'yok' }); ok(r.code === 'forbidden', 'olmayan grup reddedilir');
  r = await A.send('gv:join', { gid: 'g1' }); ok(r.ok && r.peers.length === 0 && r.mode === 'ptt' && r.leader === true, 'lider katıldı: varsayılan mod bas-konuş');
  r = await B.send('gv:join', { gid: 'g1' }); ok(r.ok && r.peers.length === 1 && r.peers[0].name === 'Ali' && r.leader === false, 'ikinci üye katıldı, mevcut eşleri görür'); ok(ev(A, 'gv:peer-joined').length === 1 && ev(A, 'gv:peer-joined')[0].name === 'Bora', 'ilk üyeye «katıldı» bildirimi gider');
  // sinyal
  r = await A.send('gv:signal', { to: B.id, data: { sdp: 'x' } }); ok(r.ok && ev(B, 'gv:signal')[0].from === A.id, 'sinyal hedefe aktarılır');
  r = await A.send('gv:signal', { to: C.id, data: { sdp: 'x' } }); ok(r.code === 'nopeer', 'odada olmayana sinyal gönderilemez'); r = await C.send('gv:signal', { to: A.id, data: { sdp: 'x' } }); ok(r.code === 'notin', 'odada olmayan sinyal gönderemez');
  r = await A.send('gv:signal', { to: B.id, data: { s: 'x'.repeat(20000) } }); ok(r.code === 'bad', 'aşırı büyük sinyal reddedilir'); r = await A.send('gv:signal', { to: A.id, data: { s: 1 } }); ok(r.code === 'nopeer', 'kendine sinyal yok');
  // mod
  r = await B.send('gv:mode', { mode: 'open' }); ok(r.code === 'leader', 'lider olmayan modu değiştiremez'); r = await A.send('gv:mode', { mode: 'xx' }); ok(r.code === 'bad', 'geçersiz mod reddedilir');
  // söz hakkı (ptt)
  r = await A.send('gv:floor', { act: 'acquire' }); ok(r.granted && r.leaseMs === 20000, 'söz hakkı alındı'); ok(ev(B, 'gv:floor').pop().holder.name === 'Ali', 'diğerlerine hak sahibi bildirilir');
  r = await B.send('gv:floor', { act: 'acquire' }); ok(r.granted === false && r.holder.name === 'Ali', 'hak doluyken ikinci kişi alamaz, kimin konuştuğu söylenir');
  r = await B.send('gv:status', { mic: true }); ok(r.code === 'nofloor', 'PTT\'de hakkı olmayan «mikrofon açık» diyemez'); r = await A.send('gv:status', { mic: true }); ok(r.ok && ev(B, 'gv:status').pop().mic === true, 'hak sahibinin mikrofon durumu yayılır');
  clock += 15000; r = await A.send('gv:floor', { act: 'renew' }); ok(r.granted, 'süre dolmadan yenilenir'); clock += 15000; svc.sweepFloor(); ok(svc._rooms.get('g1').floor !== null, 'yenilenen hak 30 sn sonra hâlâ geçerli');
  clock += 21000; svc.sweepFloor(); ok(svc._rooms.get('g1').floor === null && ev(B, 'gv:floor').pop().holder === null, 'yenilenmeyen hak süresi dolunca otomatik düşer (takılı mikrofon yok)');
  r = await B.send('gv:floor', { act: 'acquire' }); ok(r.granted, 'hak boşalınca başkası alabilir'); r = await B.send('gv:floor', { act: 'release' }); ok(r.ok && svc._rooms.get('g1').floor === null, 'bırakınca hak boşalır');
  // en uzun tutma
  clock += 1000; await A.send('gv:floor', { act: 'acquire' }); let granted = true, n = 0; while (granted && n++ < 20) { clock += 15000; granted = (await A.send('gv:floor', { act: 'renew' })).granted; } ok(!granted && n <= 9 && svc._rooms.get('g1').floor === null, 'söz hakkı en çok 120 sn tutulur (sonra yeniden basmak gerekir)');
  // lider geri alma
  await B.send('gv:floor', { act: 'acquire' }); r = await B.send('gv:revoke', {}); ok(r.code === 'leader', 'lider olmayan hakkı geri alamaz'); r = await A.send('gv:revoke', {}); ok(r.ok && ev(B, 'gv:revoked').length === 1 && svc._rooms.get('g1').floor === null, 'lider hakkı geri alır, sahibine bildirilir');
  // mod değişimi mikrofonları kapatır
  await B.send('gv:floor', { act: 'acquire' }); await B.send('gv:status', { mic: true }); r = await A.send('gv:mode', { mode: 'open' }); ok(r.ok && r.mode === 'open' && ev(B, 'gv:mode').pop().mode === 'open' && svc._rooms.get('g1').floor === null && [...svc._rooms.get('g1').peers.values()].every(x => !x.mic), 'mod değişince herkese bildirilir, hak ve mikrofon durumları sıfırlanır');
  r = await B.send('gv:floor', { act: 'acquire' }); ok(r.code === 'mode', 'açık mikrofon modunda söz hakkı istenemez'); r = await B.send('gv:status', { mic: true }); ok(r.ok, 'açık modda mikrofon durumu serbest');
  await A.send('gv:mode', { mode: 'ptt' });
  // kapasite
  const env2 = {}; const io2 = new FakeIO(); const g = { id: 'big', leader: 'u0', members: Array.from({ length: 10 }, (_, i) => ({ uid: 'u' + i })) }; const s2 = mount({ app: { get() {} }, io: io2, userFromCookie: () => null, uname: u => u.username, rg: { groupOf: () => g }, now: () => clock, env: env2, timers: false });
  const socks = g.members.map(m => io2.connect({ id: m.uid, username: m.uid })); const res = []; for (const s of socks) res.push(await s.send('gv:join', { gid: 'big' })); ok(res.filter(x => x.ok).length === 6 && res[6].code === 'full' && s2.max === 6, 'oda 6 kişiyle sınırlı (mesh sınırı); 7. kişi «oda dolu» alır'); s2.stop();
  // tek sekme
  const A2 = mk('a'); r = await A2.send('gv:join', { gid: 'g1' }); ok(r.ok && ev(A, 'gv:taken').length === 1 && !svc._rooms.get('g1').peers.has(A.id), 'aynı kullanıcı ikinci cihazdan girince eski bağlantı düşer'); ok(ev(B, 'gv:peer-left').some(x => x.id === A.id && x.why === 'taken'), 'diğerlerine eski bağlantının ayrıldığı bildirilir');
  // ayrılma / kopma
  await B.send('gv:floor', { act: 'acquire' }); B.disconnect(); ok(svc._rooms.get('g1').floor === null && ev(A2, 'gv:peer-left').some(x => x.id === B.id), 'söz hakkı sahibi kopunca hak serbest kalır ve ayrılış duyurulur');
  r = await C.send('gv:join', { gid: 'g1' }); ok(r.ok, 'kopanın yerine yeni üye girer');
  // üyelik kaybı
  groups.g1.members = groups.g1.members.filter(m => m.uid !== 'c'); svc.sweepMembers(); ok(ev(C, 'gv:kicked').length === 1 && !svc._rooms.get('g1').peers.has(C.id), 'gruptan çıkarılan üye sesten de atılır');
  // grup silinirse
  delete groups.g1; svc.sweepMembers(); ok(!svc._rooms.has('g1') && ev(A2, 'gv:kicked').length === 1, 'grup silinince oda kapanır, herkes atılır');
  // hız sınırı
  groups.g3 = { id: 'g3', leader: 'a', members: [{ uid: 'a' }] }; const R = mk('a'); await R.send('gv:join', { gid: 'g3' }); let lim = 0; for (let i = 0; i < 350; i++) if ((await R.send('gv:status', { mic: false })).code === 'rate') lim++; ok(lim >= 40, 'istek hız sınırı (10 sn\'de 300) uygulanır');
  svc.stop(); console.log(`SONUÇ: ${p} geçti, ${f} başarısız`); process.exit(f ? 1 : 0);
})();
