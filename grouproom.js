'use strict';
// GRUP İNTERKOM ODALARI: bir grupta BİRDEN ÇOK sesli oda olabilir (en çok 10); her oda 24 SAAT yaşar (aktif olsun olmasın), süre dolunca kapanır ve silinir.
// Oda = ad + şifre; kuran kişi LİDERdir. Yalnız grup üyeleri girebilir; şifre scrypt ile saklanır, hiçbir yanıtta görünmez. Bellekte tutulur (kalıcı değil: sunucu yeniden başlarsa odalar gider).
// Uçlar (hepsi grup üyesi ister): GET /api/rgroups/:id/rooms (oda listesi) · POST rooms (oda kur) · GET|POST rooms/:rid[/join|/leave|/close|/kick|/invite|/user|/source] · DELETE rooms/:rid/source
// Ses odası anahtarı = oda kimliği (rid): meshvoice `gv:join {room}`. Kişi aynı anda grupta tek odada olur (başka odaya girince eskisinden düşer).
// Liderlik: lider çıkarsa odadaki EN ESKİ katılımcıya geçer; oda boşalırsa SÜRER (24 sa dolana dek) ve ilk giren lider olur. Kalp atışı: GET rooms/:rid?hb=1 (45 sn sessiz kalan düşer).
const crypto = require('crypto');
const NAME_MAX = 30, PW_MIN = 4, PW_MAX = 64, SEEN_MS = 45000, SWEEP_MS = 10000, FAIL_N = 5, FAIL_MS = 60000, INVITE_MS = 30 * 60000, TTL_MS = 24 * 3600000, ROOM_MAX = 10;
const hashPw = (pw, salt) => crypto.scryptSync(String(pw), salt, 32);
const YT_RE = /^[\w-]{11}$/;
module.exports = function mountGroupRoom({ app, io, userFromCookie, uname, nameOf, rg, now = () => Date.now(), timers = true, ttl = TTL_MS }) {
  const rooms = new Map();                     // rid → oda (oda.gid grubu gösterir)
  const fails = new Map();                     // uid|rid → [zaman]
  let closeHook = null;
  const fail = (res, code, msg) => res.status(code).json({ error: msg });
  const toUser = (uid, ev, p) => io && io.to('u:' + uid).emit(ev, p);
  const ofGroup = gid => [...rooms.values()].filter(r => r.gid === gid);
  const ctx = (req, res) => {
    const u = userFromCookie(req.headers.cookie); if (!u) { fail(res, 401, 'Giriş gerekli.'); return null; }
    const g = rg.groupOf(req.params.id);
    if (!g || !g.members.some(m => m.uid === u.id)) { fail(res, 404, 'Grup bulunamadı.'); return null; }
    let r = null;
    if (req.params.rid !== undefined) { r = rooms.get(String(req.params.rid)); if (r && now() >= r.exp) { closeRoom(g, r, 'expired'); r = null; } if (!r || r.gid !== g.id) { fail(res, 404, 'Oda bulunamadı ya da süresi doldu.'); return null; } }
    return { u, g, r };
  };
  const push = r => { r.ver++; for (const uid of r.p.keys()) toUser(uid, 'room:changed', { gid: r.gid, rid: r.rid, ver: r.ver }); };
  const pingGroup = (g, rid) => { for (const m of g.members) toUser(m.uid, 'room:changed', { gid: g.id, rid, list: true }); };
  const item = (r, uid) => { const inv = (r.inv.get(uid) || 0) > now(); return { rid: r.rid, name: r.name, count: r.p.size, leaderName: r.leader ? (r.p.get(r.leader) || {}).name || nameOf(r.leader) : '', exp: r.exp, in: r.p.has(uid), invited: inv, banned: !!(r.ban && r.ban.has(uid)) && !inv }; };
  const rideView = (g, r, uid) => { const R = g.ride && g.ride.room === r.rid ? g.ride : null; if (!R) return null; const nums = R.nums || {}; return { id: R.id, startedAt: R.startedAt, nums, mine: nums[uid] || null, by: nameOf(R.by) }; };
  function view(g, r, uid) {
    if (!r.p.has(uid)) return Object.assign(item(r, uid), { ver: r.ver });
    const parts = [...r.p].sort((a, b) => a[1].joined - b[1].joined).map(([id, x]) => ({ uid: id, name: x.name, lead: id === r.leader, vol: x.vol, muted: x.muted, you: id === uid }));
    return Object.assign(item(r, uid), { ver: r.ver, lead: r.leader === uid, leader: r.leader, parts, src: r.src, ride: rideView(g, r, uid),
      members: r.leader === uid ? g.members.filter(m => !r.p.has(m.uid)).map(m => ({ uid: m.uid, name: nameOf(m.uid), invited: (r.inv.get(m.uid) || 0) > now() })) : undefined });
  }
  let mv = null;
  function dropPart(g, r, uid, why) {
    if (!r.p.has(uid)) return;
    r.p.delete(uid); if (mv) mv.kickUid(r.rid, uid, why); rg.roomLeft && rg.roomLeft(g, uid);
    if (!r.p.size) { r.leader = null; r.src = null; pingGroup(g, r.rid); return; }       // boş oda 24 saat dolana dek sürer
    if (r.leader === uid) { r.leader = [...r.p].sort((a, b) => a[1].joined - b[1].joined)[0][0]; if (r.src && r.src.by === uid) r.src = null; }
    push(r); pingGroup(g, r.rid);
  }
  function closeRoom(g, r, why) {
    if (!rooms.has(r.rid)) return;
    for (const uid of [...r.p.keys()]) { toUser(uid, 'room:changed', { gid: r.gid, rid: r.rid, ver: 0, closed: why }); if (mv) mv.kickUid(r.rid, uid, 'closed'); }
    if (g && g.ride && g.ride.room === r.rid && rg.endRide) rg.endRide(g, null, why === 'expired' ? 'oda süresi doldu' : 'oda kapandı');
    rooms.delete(r.rid); if (closeHook) { try { closeHook(g, r, why); } catch (e) { /* kancadaki hata odayı kapatmayı bozmaz */ } }
    if (g) pingGroup(g, r.rid);
  }
  const leaveOthers = (g, uid, keep) => { for (const o of ofGroup(g.id)) if (o.rid !== keep && o.p.has(uid)) dropPart(g, o, uid, 'switch'); };
  const tooMany = (u, rid) => { const k = u.id + '|' + rid, t = now(), a = (fails.get(k) || []).filter(x => t - x < FAIL_MS); fails.set(k, a); return a.length >= FAIL_N; };
  const addFail = (u, rid) => { const k = u.id + '|' + rid; (fails.get(k) || fails.set(k, []).get(k)).push(now()); };
  const cleanName = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
  const passOk = (r, pw) => { try { const h = hashPw(pw, r.salt); return h.length === r.hash.length && crypto.timingSafeEqual(h, r.hash); } catch { return false; } };
  const sameName = (a, b) => cleanName(a).toLocaleLowerCase('tr') === cleanName(b).toLocaleLowerCase('tr');
  const enter = (g, r, u) => {                                             // gruptaki diğer odalardan çık, bu odaya gir (boşsa lider olur)
    leaveOthers(g, u.id, r.rid);
    r.p.set(u.id, { name: uname(u), joined: now(), seen: now(), vol: 100, muted: false }); r.inv.delete(u.id); if (r.ban) r.ban.delete(u.id);
    if (!r.leader || !r.p.has(r.leader)) r.leader = u.id;
  };

  app.get('/api/rgroups/:id/rooms', (req, res) => {
    const c = ctx(req, res); if (!c) return; res.set('Cache-Control', 'no-store'); sweep();
    const list = ofGroup(c.g.id).sort((a, b) => a.created - b.created).map(r => item(r, c.u.id));
    res.json({ rooms: list, mine: (list.find(x => x.in) || {}).rid || null, max: ROOM_MAX, ttl, now: now() });
  });
  app.post('/api/rgroups/:id/rooms', (req, res) => {          // oda kur: ad + şifre
    const c = ctx(req, res); if (!c) return; const b = req.body || {};
    const name = cleanName(b.name), pw = String(b.password == null ? '' : b.password);
    if (!name) return fail(res, 400, 'Oda adı gerekli.');
    if (pw.length < PW_MIN || pw.length > PW_MAX) return fail(res, 400, `Şifre ${PW_MIN}-${PW_MAX} karakter olmalı.`);
    const cur = ofGroup(c.g.id);
    if (cur.length >= ROOM_MAX) return fail(res, 409, `Bir grupta en çok ${ROOM_MAX} oda olabilir.`);
    if (cur.some(x => sameName(x.name, name))) return fail(res, 409, 'Bu adda bir oda zaten var.');
    const salt = crypto.randomBytes(16), t = now();
    const r = { rid: crypto.randomBytes(6).toString('hex'), gid: c.g.id, name, salt, hash: hashPw(pw, salt), leader: c.u.id, p: new Map(), inv: new Map(), ban: new Set(), src: null, ver: 1, created: t, exp: t + ttl, ride: null };
    rooms.set(r.rid, r); enter(c.g, r, c.u); pingGroup(c.g, r.rid); res.json({ room: view(c.g, r, c.u.id) });
  });
  app.get('/api/rgroups/:id/rooms/:rid', (req, res) => {
    const c = ctx(req, res); if (!c) return; res.set('Cache-Control', 'no-store');
    const p = c.r.p.get(c.u.id); if (p && req.query.hb) p.seen = now();
    res.json({ room: view(c.g, c.r, c.u.id) });
  });
  app.post('/api/rgroups/:id/rooms/:rid/join', (req, res) => {
    const c = ctx(req, res); if (!c) return; const b = req.body || {}, r = c.r;
    if (r.p.has(c.u.id)) return res.json({ room: view(c.g, r, c.u.id) });
    if (tooMany(c.u, r.rid)) return fail(res, 429, 'Çok fazla yanlış deneme. Bir dakika sonra tekrar dene.');
    const invited = (r.inv.get(c.u.id) || 0) > now();
    if (r.ban && r.ban.has(c.u.id) && !invited) return fail(res, 403, 'Oda liderince odadan çıkarıldın; lider yeniden davet etmeden giremezsin.');
    if (!passOk(r, b.password == null ? '' : b.password)) { addFail(c.u, r.rid); return fail(res, 403, 'Oda şifresi yanlış.'); }
    enter(c.g, r, c.u); push(r); pingGroup(c.g, r.rid); res.json({ room: view(c.g, r, c.u.id) });
  });
  app.post('/api/rgroups/:id/rooms/:rid/leave', (req, res) => { const c = ctx(req, res); if (!c) return; dropPart(c.g, c.r, c.u.id, 'left'); res.json({ ok: true }); });
  const leadCtx = (req, res) => { const c = ctx(req, res); if (!c) return null; if (!c.r.p.has(c.u.id)) { fail(res, 404, 'Odada değilsin.'); return null; } if (c.r.leader !== c.u.id) { fail(res, 403, 'Bu işlem için oda lideri olmalısın.'); return null; } return c; };
  const target = (c, b) => { const m = c.g.members.find(x => String(x.uid) === String(b.uid)); return m ? m.uid : undefined; };
  app.post('/api/rgroups/:id/rooms/:rid/close', (req, res) => { const c = leadCtx(req, res); if (!c) return; closeRoom(c.g, c.r, 'leader'); res.json({ ok: true }); });
  app.post('/api/rgroups/:id/rooms/:rid/kick', (req, res) => {
    const c = leadCtx(req, res); if (!c) return; const uid = target(c, req.body || {});
    if (uid === undefined || !c.r.p.has(uid)) return fail(res, 404, 'Katılımcı odada değil.');
    if (uid === c.u.id) return fail(res, 400, 'Kendini atamazsın; odadan ayrıl.');
    (c.r.ban || (c.r.ban = new Set())).add(uid); dropPart(c.g, c.r, uid, 'kicked'); toUser(uid, 'room:changed', { gid: c.g.id, rid: c.r.rid, ver: 0, kicked: true }); res.json({ room: view(c.g, c.r, c.u.id) });
  });
  app.post('/api/rgroups/:id/rooms/:rid/invite', (req, res) => {
    const c = leadCtx(req, res); if (!c) return; const uid = target(c, req.body || {});
    if (uid === undefined) return fail(res, 404, 'Bu grubun üyesi değil.');
    if (c.r.p.has(uid)) return fail(res, 400, 'Zaten odada.');
    c.r.inv.set(uid, now() + INVITE_MS); toUser(uid, 'room:invite', { gid: c.g.id, rid: c.r.rid, group: c.g.name, from: uname(c.u), room: c.r.name }); push(c.r); res.json({ ok: true });
  });
  app.post('/api/rgroups/:id/rooms/:rid/user', (req, res) => {          // lider: kişi başı ses düzeyi / konuşmayı kapatma
    const c = leadCtx(req, res); if (!c) return; const b = req.body || {}, uid = target(c, b), p = uid !== undefined && c.r.p.get(uid);
    if (!p) return fail(res, 404, 'Katılımcı odada değil.');
    if (b.vol !== undefined) { const v = Number(b.vol); if (!Number.isFinite(v)) return fail(res, 400, 'Geçersiz ses düzeyi.'); p.vol = Math.min(100, Math.max(0, Math.round(v))); }
    if (b.muted !== undefined) p.muted = !!b.muted;
    push(c.r); res.json({ room: view(c.g, c.r, c.u.id) });
  });
  app.post('/api/rgroups/:id/rooms/:rid/source', (req, res) => {          // lider: radyo / YouTube bağlantısı ya da dosya yayını duyurusu
    const c = leadCtx(req, res); if (!c) return; const b = req.body || {}, type = String(b.type || ''), title = cleanName(b.title).slice(0, 80) || 'Yayın';
    let src;
    if (type === 'radio') { const url = String(b.url || ''); if (!/^https:\/\/[^\s]{4,480}$/.test(url)) return fail(res, 400, 'Radyo bağlantısı https ile başlamalı.'); src = { type, url, title }; }
    else if (type === 'yt') { const id = String(b.id || ''); if (!YT_RE.test(id)) return fail(res, 400, 'Geçersiz YouTube bağlantısı.'); src = { type, id, title }; }
    else if (type === 'file') src = { type, title };
    else return fail(res, 400, 'Geçersiz yayın türü.');
    c.r.src = { ...src, by: c.u.id, at: now() }; push(c.r); res.json({ room: view(c.g, c.r, c.u.id) });
  });
  app.delete('/api/rgroups/:id/rooms/:rid/source', (req, res) => { const c = leadCtx(req, res); if (!c) return; c.r.src = null; push(c.r); res.json({ room: view(c.g, c.r, c.u.id) }); });

  app.post('/api/rgroups/:id/rooms/:rid/ride/start', (req, res) => {          // oda lideri: odaya bağlı grup sürüşünü başlatır; herkese «numaranı yaz» sorusu çıkar
    const c = leadCtx(req, res); if (!c) return;
    if (c.g.ride) return fail(res, 409, 'Bu grupta bir sürüş zaten sürüyor.');
    rg.startRideFor(c.g, c.u, { room: c.r.rid }); push(c.r); res.json({ room: view(c.g, c.r, c.u.id) });
  });
  app.post('/api/rgroups/:id/rooms/:rid/ride/end', (req, res) => {
    const c = leadCtx(req, res); if (!c) return;
    if (!c.g.ride || c.g.ride.room !== c.r.rid) return fail(res, 409, 'Bu odada aktif sürüş yok.');
    rg.endRide(c.g, c.u, 'oda lideri'); push(c.r); res.json({ room: view(c.g, c.r, c.u.id) });
  });
  app.post('/api/rgroups/:id/rooms/:rid/ride/number', (req, res) => {          // her katılımcı kendi numarasını yazar (1-99; boş = ilk boş numara)
    const c = ctx(req, res); if (!c) return;
    if (!c.r.p.has(c.u.id)) return fail(res, 404, 'Odada değilsin.');
    if (!c.g.ride || c.g.ride.room !== c.r.rid) return fail(res, 409, 'Bu odada aktif sürüş yok.');
    const out = rg.setNumber(c.g, c.u.id, (req.body || {}).n);
    if (out.error) return fail(res, out.code === 'taken' ? 409 : 400, out.error);
    push(c.r); res.json({ room: view(c.g, c.r, c.u.id), n: out.n });
  });

  function sweep() {
    const t = now();
    for (const r of [...rooms.values()]) {
      const g = rg.groupOf(r.gid);
      if (!g) { closeRoom(null, r, 'group'); continue; }
      if (t >= r.exp) { closeRoom(g, r, 'expired'); continue; }
      for (const [uid, p] of [...r.p]) if (!g.members.some(m => m.uid === uid) || t - p.seen > SEEN_MS) dropPart(g, r, uid, 'gone');
    }
  }
  let tm = null; if (timers) { tm = setInterval(sweep, SWEEP_MS); tm.unref && tm.unref(); }
  return {
    _rooms: rooms, sweep, ttl, ROOM_MAX,
    onClose(fn) { closeHook = fn; },
    resolve: rid => { const r = rooms.get(String(rid)); return r ? r.gid : null; },       // ses anahtarı (rid) → grup
    isIn: (gid, uid) => ofGroup(String(gid)).some(r => r.p.has(uid)),
    isInRoom: (rid, uid) => { const r = rooms.get(String(rid)); return !!(r && r.p.has(uid)); },
    roomOf: (gid, uid) => { const r = ofGroup(String(gid)).find(x => x.p.has(uid)); return r || null; },
    byRid: rid => rooms.get(String(rid)) || null,
    muted: (rid, uid) => { const r = rooms.get(String(rid)), p = r && r.p.get(uid); return !!(p && p.muted); },
    attach(m) { mv = m; }, stop() { clearInterval(tm); },
    hooks: { alive: rid => rooms.has(String(rid)), isIn: (rid, uid) => { const r = rooms.get(String(rid)); return !!(r && r.p.has(uid)); } }
  };
};
