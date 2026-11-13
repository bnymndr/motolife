'use strict';
// GRUP SESİ (sunucu): sesin KENDİSİ sunucudan geçmez; tarayıcılar WebRTC ile birbirine doğrudan bağlanır (mesh). Sunucu yalnızca:
// oda üyeliği (ridegroups üyeleri), sinyalleşme aktarımı, lider modu (open|ptt), bas-konuş söz hakkı ve ICE ayarı verir.
// Soket olayları (hepsi ack'li): gv:join, gv:signal, gv:leave, gv:mode (lider), gv:status, gv:floor, gv:revoke (lider).
// Yayın: gv:peer-joined/-left, gv:mode, gv:floor, gv:status, gv:revoked, gv:kicked, gv:taken.
// SINIR: mesh'te herkes herkese bağlanır → oda üst sınırı GV_MAX (varsayılan 6, en çok 8). PTT hakkı istemci tarafında uygulanır
// (sunucu ses akışını kesemez): hak sahibi dışındakilerin sesi alıcıda susturulur; bozuk istemci hakkı aşabilir (sesi yine P2P gider).
// ICE: Google STUN + isteğe bağlı TURN (GV_TURN_URLS virgülle, GV_TURN_USER, GV_TURN_CREDENTIAL). TURN bilgisi yalnız giriş yapmış üyeye /api/gvoice/ice ile verilir.
const LEASE_MS = 20000, MAX_HOLD_MS = 120000, SWEEP_MS = 2000, MEMBER_SWEEP_MS = 30000, SIG_MAX = 16384, RATE_N = 300, RATE_MS = 10000;

module.exports = function mountGroupVoice({ app, io, userFromCookie, uname, rg, now = () => Date.now(), env = process.env, timers = true }) {
  const max = Math.min(8, Math.max(2, parseInt(env.GV_MAX, 10) || 6));
  const rooms = new Map();   // gid → { mode, floor: {sid,uid,name,since,until}|null, peers: Map(sid → {uid,name,mic}) }
  const room = gid => { let r = rooms.get(gid); if (!r) rooms.set(gid, r = { mode: 'ptt', floor: null, peers: new Map() }); return r; };
  const sio = gid => 'gv:' + gid;
  const grp = gid => (rg && rg.groupOf ? rg.groupOf(String(gid)) : null);
  const isMember = (g, uid) => !!g && g.members.some(m => m.uid === uid);
  const holderView = r => (r.floor ? { id: r.floor.sid, uid: r.floor.uid, name: r.floor.name } : null);
  const peerList = r => [...r.peers].map(([id, p]) => ({ id, uid: p.uid, name: p.name, mic: !!p.mic }));
  const err = (cb, error, code) => typeof cb === 'function' && cb({ error, code });

  app.get('/api/gvoice/ice', (req, res) => {
    const u = userFromCookie(req.headers.cookie); if (!u) return res.status(401).json({ error: 'Oturum gerekli.' });
    const iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
    const urls = String(env.GV_TURN_URLS || '').split(',').map(s => s.trim()).filter(Boolean);
    if (urls.length && env.GV_TURN_USER && env.GV_TURN_CREDENTIAL) iceServers.push({ urls, username: env.GV_TURN_USER, credential: env.GV_TURN_CREDENTIAL });
    res.set('Cache-Control', 'no-store'); res.json({ iceServers, turn: iceServers.length > 1, max });
  });

  function clearFloor(r, gid, why) { if (!r.floor) return; const f = r.floor; r.floor = null; io.to(sio(gid)).emit('gv:floor', { holder: null, why }); if (why === 'revoked') io.to(f.sid).emit('gv:revoked', {}); }
  function removePeer(socket, why) {
    const gid = socket.data.gvGid; if (!gid) return;
    const r = rooms.get(gid); socket.data.gvGid = null; try { socket.leave(sio(gid)); } catch {}
    if (!r) return; r.peers.delete(socket.id);
    if (r.floor && r.floor.sid === socket.id) clearFloor(r, gid, 'left');
    io.to(sio(gid)).emit('gv:peer-left', { id: socket.id, why: why || 'left' });
    if (!r.peers.size) rooms.delete(gid);
  }

  io.on('connection', socket => {
    const u = socket.data && socket.data.user; if (!u) return;
    const hits = []; const limited = () => { const t = now(); while (hits.length && t - hits[0] > RATE_MS) hits.shift(); if (hits.length >= RATE_N) return true; hits.push(t); return false; };
    const cur = () => { const gid = socket.data.gvGid, r = gid && rooms.get(gid); return r ? { gid, r } : null; };

    socket.on('gv:join', (p, cb) => {
      if (limited()) return err(cb, 'Çok sık istek.', 'rate');
      const gid = String((p && p.gid) || ''), g = grp(gid);
      if (!g || !isMember(g, u.id)) return err(cb, 'Bu grubun üyesi değilsin.', 'forbidden');
      if (socket.data.gvGid && socket.data.gvGid !== gid) removePeer(socket, 'switch');
      const r = room(gid);
      for (const [sid, pr] of r.peers) if (pr.uid === u.id && sid !== socket.id) {          // aynı kullanıcı başka sekmede/cihazda: eskisi düşer
        const old = io.sockets && io.sockets.sockets && io.sockets.sockets.get(sid); if (old) { old.emit('gv:taken', {}); removePeer(old, 'taken'); } else { r.peers.delete(sid); io.to(sio(gid)).emit('gv:peer-left', { id: sid, why: 'taken' }); }
      }
      if (!r.peers.has(socket.id) && r.peers.size >= max) return err(cb, `Sesli oda dolu (en fazla ${max} kişi).`, 'full');
      const others = peerList(r).filter(x => x.id !== socket.id);
      r.peers.set(socket.id, { uid: u.id, name: uname(u), mic: false }); socket.data.gvGid = gid; socket.join(sio(gid));
      socket.to(sio(gid)).emit('gv:peer-joined', { id: socket.id, uid: u.id, name: uname(u) });
      if (typeof cb === 'function') cb({ ok: true, id: socket.id, uid: u.id, peers: others, mode: r.mode, holder: holderView(r), max, leader: g.leader === u.id });
    });

    socket.on('gv:signal', (p, cb) => {
      const c = cur(); if (!c) return err(cb, 'Sesli odada değilsin.', 'notin');
      if (limited()) return err(cb, 'Çok sık istek.', 'rate');
      const to = p && String(p.to || ''); if (!to || !c.r.peers.has(to) || to === socket.id) return err(cb, 'Hedef odada değil.', 'nopeer');
      let size = 0; try { size = JSON.stringify(p.data || null).length; } catch {} if (!p.data || size > SIG_MAX) return err(cb, 'Geçersiz sinyal.', 'bad');
      io.to(to).emit('gv:signal', { from: socket.id, data: p.data }); if (typeof cb === 'function') cb({ ok: true });
    });

    socket.on('gv:leave', (p, cb) => { removePeer(socket, 'left'); if (typeof cb === 'function') cb({ ok: true }); });

    socket.on('gv:mode', (p, cb) => {
      const c = cur(); if (!c) return err(cb, 'Sesli odada değilsin.', 'notin');
      const g = grp(c.gid); if (!g || g.leader !== u.id) return err(cb, 'Yalnızca grup lideri modu değiştirebilir.', 'leader');
      const m = p && p.mode; if (m !== 'open' && m !== 'ptt') return err(cb, 'Geçersiz mod.', 'bad');
      if (c.r.mode !== m) { c.r.mode = m; c.r.floor = null; for (const pr of c.r.peers.values()) pr.mic = false; io.to(sio(c.gid)).emit('gv:mode', { mode: m, by: uname(u) }); io.to(sio(c.gid)).emit('gv:floor', { holder: null, why: 'mode' }); }
      if (typeof cb === 'function') cb({ ok: true, mode: c.r.mode });
    });

    socket.on('gv:status', (p, cb) => {
      const c = cur(); if (!c) return err(cb, 'Sesli odada değilsin.', 'notin'); if (limited()) return err(cb, 'Çok sık istek.', 'rate');
      const me = c.r.peers.get(socket.id), on = !!(p && p.mic);
      if (c.r.mode === 'ptt' && on && !(c.r.floor && c.r.floor.sid === socket.id)) return err(cb, 'Bas-konuş modunda söz hakkın yok.', 'nofloor');   // istemci yalan söylemesin
      if (me && me.mic !== on) { me.mic = on; socket.to(sio(c.gid)).emit('gv:status', { id: socket.id, mic: on }); }
      if (typeof cb === 'function') cb({ ok: true });
    });

    socket.on('gv:floor', (p, cb) => {
      const c = cur(); if (!c) return err(cb, 'Sesli odada değilsin.', 'notin'); if (limited()) return err(cb, 'Çok sık istek.', 'rate');
      const { r, gid } = c, act = p && p.act, t = now();
      if (r.mode !== 'ptt') return err(cb, 'Oda açık mikrofon modunda.', 'mode');
      if (r.floor && r.floor.until <= t) clearFloor(r, gid, 'expired');
      if (act === 'acquire') {
        if (r.floor && r.floor.sid !== socket.id) return typeof cb === 'function' && cb({ granted: false, holder: holderView(r) });
        const since = r.floor && r.floor.sid === socket.id ? r.floor.since : t;
        r.floor = { sid: socket.id, uid: u.id, name: uname(u), since, until: t + LEASE_MS };
        io.to(sio(gid)).emit('gv:floor', { holder: holderView(r) }); return typeof cb === 'function' && cb({ granted: true, leaseMs: LEASE_MS });
      }
      if (act === 'renew') {
        if (!r.floor || r.floor.sid !== socket.id) return typeof cb === 'function' && cb({ granted: false, holder: holderView(r) });
        if (t - r.floor.since >= MAX_HOLD_MS) { clearFloor(r, gid, 'max'); return typeof cb === 'function' && cb({ granted: false, why: 'max' }); }
        r.floor.until = t + LEASE_MS; return typeof cb === 'function' && cb({ granted: true, leaseMs: LEASE_MS });
      }
      if (act === 'release') { if (r.floor && r.floor.sid === socket.id) clearFloor(r, gid, 'released'); return typeof cb === 'function' && cb({ ok: true }); }
      return err(cb, 'Geçersiz işlem.', 'bad');
    });

    socket.on('gv:revoke', (p, cb) => {
      const c = cur(); if (!c) return err(cb, 'Sesli odada değilsin.', 'notin');
      const g = grp(c.gid); if (!g || g.leader !== u.id) return err(cb, 'Yalnızca grup lideri söz hakkını geri alabilir.', 'leader');
      clearFloor(c.r, c.gid, 'revoked'); if (typeof cb === 'function') cb({ ok: true });
    });

    socket.on('disconnect', () => removePeer(socket, 'disconnect'));
  });

  // süresi dolan söz hakkını temizle; gruptan çıkarılan/grubu silinen üyeleri sesten at
  function sweepFloor() { const t = now(); for (const [gid, r] of rooms) if (r.floor && r.floor.until <= t) clearFloor(r, gid, 'expired'); }
  function sweepMembers() {
    for (const [gid, r] of [...rooms]) { const g = grp(gid);
      for (const [sid, p] of [...r.peers]) if (!isMember(g, p.uid)) { const s = io.sockets && io.sockets.sockets && io.sockets.sockets.get(sid); if (s) { s.emit('gv:kicked', {}); removePeer(s, 'kicked'); } else { r.peers.delete(sid); io.to(sio(gid)).emit('gv:peer-left', { id: sid, why: 'kicked' }); } }
      if (!r.peers.size) rooms.delete(gid); }
  }
  let t1 = null, t2 = null; if (timers) { t1 = setInterval(sweepFloor, SWEEP_MS); t2 = setInterval(sweepMembers, MEMBER_SWEEP_MS); t1.unref && t1.unref(); t2.unref && t2.unref(); }
  return { _rooms: rooms, sweepFloor, sweepMembers, max, stop() { clearInterval(t1); clearInterval(t2); } };
};
