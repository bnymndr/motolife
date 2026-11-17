'use strict';
// İNTERKOM YEDEĞİ (LiveKit hesabı yokken): sesin KENDİSİ sunucudan geçmez; tarayıcılar WebRTC ile birbirine doğrudan bağlanır (mesh).
// Sunucu yalnız oda üyeliği (sürüş grubu üyeleri), sinyal aktarımı ve ICE ayarı verir. Soket olayları (ack'li): gv:join, gv:signal, gv:leave.
// Yayın: gv:peer-joined, gv:peer-left, gv:signal, gv:taken, gv:kicked. Oda üst sınırı GV_MAX (varsayılan 6, en çok 8).
// ICE: Google STUN + isteğe bağlı TURN (GV_TURN_URLS virgülle, GV_TURN_USER, GV_TURN_CREDENTIAL); yalnız giriş yapmış üyeye /api/gvoice/ice ile verilir.
const SIG_MAX = 16384, RATE_N = 300, RATE_MS = 10000, MEMBER_SWEEP_MS = 30000;
module.exports = function mountMeshVoice({ app, io, userFromCookie, uname, rg, gate, resolve, now = () => Date.now(), env = process.env, timers = true }) {
  const max = Math.min(8, Math.max(2, parseInt(env.GV_MAX, 10) || 6));
  const rooms = new Map();   // gid → Map(sid → {uid,name})
  const sio = gid => 'gv:' + gid;
  const gidOf = key => (resolve ? resolve(String(key)) : String(key));          // ses anahtarı (oda kimliği) → grup
  const grp = key => { const gid = gidOf(key); return gid && rg && rg.groupOf ? rg.groupOf(String(gid)) : null; };
  const isMember = (g, uid) => !!g && g.members.some(m => m.uid === uid);
  const err = (cb, error, code) => typeof cb === 'function' && cb({ error, code });

  app.get('/api/gvoice/ice', (req, res) => {
    const u = userFromCookie(req.headers.cookie); if (!u) return res.status(401).json({ error: 'Oturum gerekli.' });
    const iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
    const urls = String(env.GV_TURN_URLS || '').split(',').map(s => s.trim()).filter(Boolean);
    if (urls.length && env.GV_TURN_USER && env.GV_TURN_CREDENTIAL) iceServers.push({ urls, username: env.GV_TURN_USER, credential: env.GV_TURN_CREDENTIAL });
    res.set('Cache-Control', 'no-store'); res.json({ iceServers, turn: iceServers.length > 1, max });
  });

  function removePeer(socket, why) {
    const gid = socket.data.gvGid; if (!gid) return;
    socket.data.gvGid = null; try { socket.leave(sio(gid)); } catch {}
    const r = rooms.get(gid); if (!r) return; r.delete(socket.id);
    io.to(sio(gid)).emit('gv:peer-left', { id: socket.id, why: why || 'left' });
    if (!r.size) rooms.delete(gid);
  }
  io.on('connection', socket => {
    const u = socket.data && socket.data.user; if (!u) return;
    const hits = []; const limited = () => { const t = now(); while (hits.length && t - hits[0] > RATE_MS) hits.shift(); if (hits.length >= RATE_N) return true; hits.push(t); return false; };
    socket.on('gv:join', (p, cb) => {
      if (limited()) return err(cb, 'Çok sık istek.', 'rate');
      const gid = String((p && (p.room || p.gid)) || ''), g = grp(gid);
      if (!g || !isMember(g, u.id)) return err(cb, resolve ? 'Bu oda yok ya da süresi doldu.' : 'Bu grubun üyesi değilsin.', 'forbidden');
      if (gate && !gate(gid, u.id)) return err(cb, 'Önce interkom odasına şifreyle gir.', 'noroom');
      if (socket.data.gvGid && socket.data.gvGid !== gid) removePeer(socket, 'switch');
      let r = rooms.get(gid); if (!r) rooms.set(gid, r = new Map());
      for (const [sid, pr] of [...r]) if (pr.uid === u.id && sid !== socket.id) {          // aynı kullanıcı başka sekme/cihazda: eskisi düşer
        const old = io.sockets && io.sockets.sockets && io.sockets.sockets.get(sid);
        if (old) { old.emit('gv:taken', {}); removePeer(old, 'taken'); } else { r.delete(sid); io.to(sio(gid)).emit('gv:peer-left', { id: sid, why: 'taken' }); }
      }
      if (!r.has(socket.id) && r.size >= max) return err(cb, `Sesli oda dolu (en fazla ${max} kişi).`, 'full');
      const others = [...r].filter(([id]) => id !== socket.id).map(([id, x]) => ({ id, uid: x.uid, name: x.name }));
      r.set(socket.id, { uid: u.id, name: uname(u) }); socket.data.gvGid = gid; socket.join(sio(gid));
      socket.to(sio(gid)).emit('gv:peer-joined', { id: socket.id, uid: u.id, name: uname(u) });
      if (typeof cb === 'function') cb({ ok: true, id: socket.id, peers: others, max });
    });
    socket.on('gv:signal', (p, cb) => {
      const gid = socket.data.gvGid, r = gid && rooms.get(gid); if (!r) return err(cb, 'Sesli odada değilsin.', 'notin');
      if (limited()) return err(cb, 'Çok sık istek.', 'rate');
      const to = p && String(p.to || ''); if (!to || to === socket.id || !r.has(to)) return err(cb, 'Hedef odada değil.', 'nopeer');
      let size = 0; try { size = JSON.stringify(p.data || null).length; } catch {} if (!p.data || size > SIG_MAX) return err(cb, 'Geçersiz sinyal.', 'bad');
      io.to(to).emit('gv:signal', { from: socket.id, data: p.data }); if (typeof cb === 'function') cb({ ok: true });
    });
    socket.on('gv:leave', (p, cb) => { removePeer(socket, 'left'); if (typeof cb === 'function') cb({ ok: true }); });
    socket.on('disconnect', () => removePeer(socket, 'disconnect'));
  });
  function sweepMembers() {          // gruptan çıkarılan/grubu silinen üyeleri sesten at
    for (const [gid, r] of [...rooms]) { const g = grp(gid);
      for (const [sid, p] of [...r]) if (!isMember(g, p.uid)) { const s = io.sockets && io.sockets.sockets && io.sockets.sockets.get(sid); if (s) { s.emit('gv:kicked', {}); removePeer(s, 'kicked'); } else { r.delete(sid); io.to(sio(gid)).emit('gv:peer-left', { id: sid, why: 'kicked' }); } }
      if (!r.size) rooms.delete(gid); }
  }
  let t = null; if (timers) { t = setInterval(sweepMembers, MEMBER_SWEEP_MS); t.unref && t.unref(); }
  function kickUid(gid, uid, why) {          // oda liderinin attığı / odadan çıkan kişiyi sesten düşür
    const r = rooms.get(String(gid)); if (!r) return;
    for (const [sid, p] of [...r]) if (p.uid === uid) { const s = io.sockets && io.sockets.sockets && io.sockets.sockets.get(sid); if (s) { if (why === 'kicked' || why === 'closed' || why === 'gone') s.emit('gv:kicked', {}); removePeer(s, why || 'left'); } else { r.delete(sid); io.to(sio(gid)).emit('gv:peer-left', { id: sid, why: why || 'left' }); } }
    if (!r.size) rooms.delete(String(gid));
  }
  return { kickUid, _rooms: rooms, sweepMembers, max, stop() { clearInterval(t); } };
};
