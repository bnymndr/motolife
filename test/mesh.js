'use strict';
// İnterkom yedeği (WebRTC mesh): meshvoice.js sinyalleşme sunucusu + public/mesh-adapter.js istemcisi; Socket.IO ve RTCPeerConnection SAHTE. node test/mesh.js
const assert = require('assert'); const mountMesh = require('../meshvoice'), { createMeshTransport } = require('../public/mesh-adapter.js');
let p = 0, f = 0; const ok = (c, m) => { c ? p++ : f++; console.log((c ? 'ok: ' : 'FAIL: ') + m); };
const wait = (ms = 10) => new Promise(r => setTimeout(r, ms));
// ---- sahte Socket.IO sunucusu
function fakeIO() {
  const conns = [], socks = new Map(), rooms = new Map(); let n = 0;
  const io = { sockets: { sockets: socks }, on(e, fn) { conns.push(fn); },
    to(t) { return { emit: (ev, d) => { const ids = socks.has(t) ? [t] : [...(rooms.get(t) || [])]; ids.forEach(i => socks.get(i)._deliver(ev, d)); } }; } };
  io.connect = user => {
    const id = 's' + (++n), srvH = {}, cliH = {};
    const s = { id, data: { user }, on(ev, fn) { srvH[ev] = fn; }, join(r) { (rooms.get(r) || rooms.set(r, new Set()).get(r)).add(id); }, leave(r) { (rooms.get(r) || new Set()).delete(id); },
      emit(ev, d) { s._deliver(ev, d); }, to(r) { return { emit: (ev, d) => [...(rooms.get(r) || [])].filter(i => i !== id).forEach(i => socks.get(i)._deliver(ev, d)) }; }, _deliver(ev, d) { (cliH[ev] || []).slice().forEach(fn => fn(d)); } };
    socks.set(id, s); conns.forEach(fn => fn(s));
    const cli = { id, on(ev, fn) { (cliH[ev] = cliH[ev] || []).push(fn); }, off(ev, fn) { cliH[ev] = (cliH[ev] || []).filter(x => x !== fn); }, emit(ev, d, cb) { setTimeout(() => srvH[ev] && srvH[ev](d, cb), 0); },
      drop() { (srvH.disconnect || (() => {}))(); (cliH.disconnect || []).slice().forEach(fn => fn('x')); socks.delete(id); } };
    return cli;
  };
  return io;
}
const GID = 'a'.repeat(16), grp = { id: GID, leader: 'u1', members: [{ uid: 'u1' }, { uid: 'u2' }, { uid: 'u3' }] };
let app = null, routes = {}; app = { get(p2, fn) { routes[p2] = fn; } };
(async () => {
  const io = fakeIO(); let G = grp; const m = mountMesh({ app, io, userFromCookie: c => (c ? { id: c } : null), uname: u => 'N' + u.id, rg: { groupOf: g => (g === GID ? G : null) }, env: { GV_MAX: '3', GV_TURN_URLS: 'turn:t.example:3478', GV_TURN_USER: 'a', GV_TURN_CREDENTIAL: 'b' }, timers: false });
  const call = (c, ev, d) => new Promise(r => c.emit(ev, d, r));
  // ---- sunucu
  const A = io.connect({ id: 'u1' }), B = io.connect({ id: 'u2' }), C = io.connect({ id: 'u3' }), X = io.connect({ id: 'ux' });
  let r = await call(X, 'gv:join', { gid: GID }); ok(r.code === 'forbidden', 'sunucu: üye olmayan odaya giremez');
  r = await call(A, 'gv:join', { gid: 'zz' }); ok(r.code === 'forbidden', 'sunucu: geçersiz grup reddedilir');
  const got = { A: [], B: [] }; A.on('gv:peer-joined', d => got.A.push(['j', d.id])); A.on('gv:peer-left', d => got.A.push(['l', d.id])); B.on('gv:signal', d => got.B.push(d));
  r = await call(A, 'gv:join', { gid: GID }); ok(r.ok && r.peers.length === 0 && r.max === 3, 'sunucu: ilk üye girer, eş yok');
  r = await call(B, 'gv:join', { gid: GID }); ok(r.ok && r.peers.length === 1 && r.peers[0].id === A.id && r.peers[0].name === 'Nu1', 'sunucu: ikinci üye mevcut eşi görür');
  await wait(); ok(got.A.some(x => x[0] === 'j' && x[1] === B.id), 'sunucu: mevcut üye yeni gelenden haberdar edilir');
  r = await call(A, 'gv:signal', { to: B.id, data: { t: 'offer', sdp: 'x' } }); await wait(); ok(r.ok && got.B.length === 1 && got.B[0].from === A.id, 'sunucu: sinyal hedefe aktarılır');
  r = await call(A, 'gv:signal', { to: 'yok', data: { t: 'x' } }); ok(r.code === 'nopeer', 'sunucu: odada olmayan hedefe sinyal gitmez');
  r = await call(C, 'gv:signal', { to: A.id, data: { t: 'x' } }); ok(r.code === 'notin', 'sunucu: odada olmayan sinyal gönderemez');
  r = await call(A, 'gv:signal', { to: B.id, data: { t: 'x', pad: 'a'.repeat(20000) } }); ok(r.code === 'bad', 'sunucu: aşırı büyük sinyal reddedilir');
  const D2 = io.connect({ id: 'u3' }), D3 = io.connect({ id: 'u3' }); await call(C, 'gv:join', { gid: GID }); const tk = []; C.on('gv:taken', () => tk.push(1));
  r = await call(D2, 'gv:join', { gid: GID }); await wait(); ok(r.ok && tk.length === 1, 'sunucu: aynı kullanıcı ikinci cihazdan girerse eskisi düşer');
  const E = io.connect({ id: 'u1' }); r = await call(E, 'gv:join', { gid: GID }); ok(r.ok, 'sunucu: u1 ikinci cihaz (eski düşer, oda dolmaz)');
  const F = io.connect({ id: 'u2' }); G = { ...grp, members: [...grp.members, { uid: 'u9' }] };
  const o9 = io.connect({ id: 'u9' }), o8 = io.connect({ id: 'u8' }); G.members.push({ uid: 'u8' });
  r = await call(o9, 'gv:join', { gid: GID }); ok(r.error && r.code === 'full', 'sunucu: oda dolunca (GV_MAX=3) girilmez');
  B.drop(); await wait(); ok(!m._rooms.get(GID).has(B.id), 'sunucu: bağlantı kopunca üye odadan düşer');
  G = { ...grp, members: [{ uid: 'u1' }] }; const kk = []; D2.on('gv:kicked', () => kk.push(1)); m.sweepMembers(); await wait(); ok(kk.length === 1 && !m._rooms.get(GID).has(D2.id), 'sunucu: gruptan çıkarılan üye sesten atılır');
  const ice = await new Promise(rs => routes['/api/gvoice/ice']({ headers: { cookie: 'u1' } }, { status: c => ({ json: o => rs({ s: c, o }) }), set() {}, json: o => rs({ s: 200, o }) }));
  ok(ice.s === 200 && ice.o.iceServers.length === 2 && ice.o.turn === true && ice.o.iceServers[1].username === 'a', 'sunucu: ICE (STUN + TURN) oturumlu üyeye verilir');
  const ice2 = await new Promise(rs => routes['/api/gvoice/ice']({ headers: {} }, { status: c => ({ json: o => rs({ s: c, o }) }), set() {}, json: o => rs({ s: 200, o }) })); ok(ice2.s === 401, 'sunucu: ICE oturumsuz verilmez');

  // ---- istemci (sahte RTC) — gerçek sinyalleşme sunucusu üzerinden
  const io2 = fakeIO(); G = grp; mountMesh({ app: { get() {} }, io: io2, userFromCookie: () => null, uname: u => u.id, rg: { groupOf: () => grp }, env: {}, timers: false });
  const made = []; class RTC { constructor(c) { this.cfg = c; this.sent = []; this.remote = null; this.cands = []; this.connectionState = 'new'; this.closed = false; this.tracks = []; made.push(this); }
    addTrack(t) { this.tracks.push(t); } async createOffer() { return { type: 'offer', sdp: 'O' }; } async createAnswer() { return { type: 'answer', sdp: 'A' }; }
    async setLocalDescription(d) { this.localDescription = d; } async setRemoteDescription(d) { this.remote = d; } async addIceCandidate(c) { if (!this.remote) throw new Error('uzak tanım yok'); this.cands.push(c); } close() { this.closed = true; } }
  const mkMedia = () => { const t = { enabled: true, stopped: false, stop() { this.stopped = true; } }; return { t, get: async () => ({ getAudioTracks: () => [t], getTracks: () => [t] }) }; };
  const audios = []; const mkAudio = () => { const a = { muted: false, volume: 1, srcObject: null, play() { return Promise.resolve(); }, pause() {} }; audios.push(a); return a; };
  const lvl = { v: 0 }; const meterF = () => () => lvl.v;
  const sa = io2.connect({ id: 'u1' }), sb = io2.connect({ id: 'u2' }); const ma = mkMedia(), mb = mkMedia(); let fatal = null, spA = null;
  const fetchOk = async () => ({ ok: true, json: async () => ({ iceServers: [{ urls: 'stun:s' }, { urls: ['turn:t'], username: 'a', credential: 'b' }] }) });
  const ta = createMeshTransport({ sock: sa, gid: GID, RTC, fetch: fetchOk, getMedia: ma.get, makeAudio: mkAudio, meter: meterF, tick: (fn) => setInterval(fn, 5), untick: clearInterval, onFatal: m2 => { fatal = m2; } });
  const tb = createMeshTransport({ sock: sb, gid: GID, RTC, fetch: fetchOk, getMedia: mb.get, makeAudio: mkAudio, meter: meterF, tick: (fn) => setInterval(fn, 5), untick: clearInterval });
  let stA = [], stB = []; ta.onState(s => stA.push(s)); tb.onState(s => stB.push(s)); ta.onSpeakers(ids => { spA = ids; });
  await ta.connect(); ok(stA[0] === 'connected' && ma.t.enabled === false && made.length === 0, 'istemci: ilk üye bağlanır; mikrofon KAPALI başlar; eş yok');
  await tb.connect(); await wait(30);
  ok(stB[0] === 'connected' && made.length === 2, 'istemci: sonradan gelen bağlanır, iki uçta da RTCPeerConnection kuruldu');
  const [pA, pB] = made; // pA: A'nın B'ye bağlantısı (cevap veren) ; pB: B'nin teklif veren bağlantısı
  ok(pB.localDescription.type === 'offer' && pA.remote && pA.remote.type === 'offer' && pA.localDescription.type === 'answer' && pB.remote && pB.remote.type === 'answer', 'istemci: teklif → cevap eşleşmesi (teklifi sonradan gelen verir)');
  ok(pA.cfg.iceServers.length === 2 && pA.cfg.iceServers[1].username === 'a', 'istemci: ICE (TURN dahil) sunucudan alındı');
  ok(pA.tracks.length === 1 && pB.tracks.length === 1, 'istemci: yerel mikrofon izi eşe eklendi');
  // ICE adayı: uzak tanımdan ÖNCE gelen sıraya alınır, sonra eklenir
  const pre = made.length; const x = pA; x.remote = null; x.cands.length = 0; sb.emit('gv:signal', { to: sa.id, data: { t: 'ice', c: { candidate: 'c1' } } }, () => {}); await wait(); ok(x.cands.length === 0, 'istemci: uzak tanım gelmeden aday eklenmez (sıraya alınır)');
  // konuşan tespiti + ses
  pA.ontrack({ streams: [{ id: 'ms' }] }); lvl.v = 0.1; await wait(30); ok(spA && spA.length === 1 && spA.names[0] === 'u2', 'istemci: gelen ses seviyesinden «konuşan» bulunur (adıyla)');
  lvl.v = 0; await wait(500); ok(spA.length === 0, 'istemci: susunca konuşan listesi boşalır');
  ta.setPlayback(false); ok(audios[0].muted === true, 'istemci: setPlayback(false) gelen sesi susturur (odadan çıkmaz)'); ta.setPlayback(true); ok(audios[0].muted === false, 'istemci: setPlayback(true) açar');
  ta.setVolume(0.4); ok(audios[0].volume === 0.4, 'istemci: setVolume gelen ses düzeyini ayarlar');
  ta.setMic(true); ok(ma.t.enabled === true, 'istemci: setMic(true) mikrofonu açar'); ta.setMic(false); ok(ma.t.enabled === false, 'istemci: setMic(false) kapatır');
  // eş ayrılır
  await tb.disconnect(); await wait(30); ok(pB.closed && mb.t.stopped, 'istemci: ayrılan mikrofonu bırakır, bağlantıları kapatır'); ok(pA.closed, 'istemci: eş ayrılınca onun bağlantısı kapanır');
  // yeniden bağlanma: kopma → disconnected durumu; yeniden connect çift dinleyici bırakmaz
  stA.length = 0; sa.drop(); await wait(); ok(stA.includes('disconnected'), 'istemci: soket kopunca «disconnected» bildirir (comm-core yeniden dener)');
  const sa2 = io2.connect({ id: 'u1' }); const tA2 = createMeshTransport({ sock: sa2, gid: GID, RTC, fetch: fetchOk, getMedia: ma.get, makeAudio: mkAudio, meter: meterF, tick: (fn) => setInterval(fn, 5), untick: clearInterval, onFatal: m2 => { fatal = m2; } });
  await tA2.connect(); await tA2.connect(); ok(true, 'istemci: art arda connect() hata vermez'); await tA2.disconnect();
  // taken → onFatal
  const sc = io2.connect({ id: 'u3' }), sd = io2.connect({ id: 'u3' }); let fat2 = null;
  const tc = createMeshTransport({ sock: sc, gid: GID, RTC, fetch: fetchOk, getMedia: mb.get, makeAudio: mkAudio, meter: meterF, tick: (fn) => setInterval(fn, 5), untick: clearInterval, onFatal: m2 => { fat2 = m2; } });
  const td = createMeshTransport({ sock: sd, gid: GID, RTC, fetch: fetchOk, getMedia: mb.get, makeAudio: mkAudio, meter: meterF, tick: (fn) => setInterval(fn, 5), untick: clearInterval });
  await tc.connect(); await td.connect(); await wait(30); ok(/Başka bir cihaz/.test(fat2 || ''), 'istemci: başka cihazdan girilince onFatal çağrılır'); await td.disconnect();
  // mikrofon izni yok / sunucu hatası
  const se = io2.connect({ id: 'u1' }); const te = createMeshTransport({ sock: se, gid: GID, RTC, fetch: fetchOk, getMedia: async () => { throw new Error('NotAllowed'); }, tick: () => 0, untick: () => {} });
  let er = null; try { await te.connect(); } catch (e) { er = e.message; } ok(/Mikrofon izni/.test(er || ''), 'istemci: mikrofon izni yoksa anlaşılır hata');
  const sg = io2.connect({ id: 'ux' }); const tg = createMeshTransport({ sock: sg, gid: GID, RTC, fetch: async () => { throw new Error('ağ'); }, getMedia: mb.get, makeAudio: mkAudio, meter: meterF, tick: () => 0, untick: () => {} });
  er = null; try { await tg.connect(); } catch (e) { er = e.message; } ok(/üyesi değilsin/.test(er || ''), 'istemci: üye olmayan «Bu grubun üyesi değilsin» hatası alır (ICE alınamasa da STUN ile denedi)');
  console.log(`SONUÇ: ${p} geçti, ${f} başarısız`); process.exit(f ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
