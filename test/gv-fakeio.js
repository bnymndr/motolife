'use strict';
// TEST ALTYAPISI: socket.io benzeri sahte sunucu (oda, ack, to/emit). Gerçek groupvoice.js bunun üstünde çalışır.
class FSocket {
  constructor(io, user) { this.io = io; this.id = 's' + (++io.n); this.data = { user }; this.h = {}; this.rooms = new Set([this.id]); this.out = () => {}; io.sockets.sockets.set(this.id, this); io._join(this.id, this.id); }
  on(ev, f) { this.h[ev] = f; return this; }
  join(r) { this.rooms.add(r); this.io._join(r, this.id); } leave(r) { this.rooms.delete(r); const s = this.io.rooms.get(r); if (s) s.delete(this.id); }
  emit(ev, d) { this.out(ev, d); }
  to(room) { return { emit: (ev, d) => { for (const sid of this.io.rooms.get(room) || []) if (sid !== this.id) this.io.sockets.sockets.get(sid).out(ev, d); } }; }
  // istemci tarafı: olay gönder, ack'i bekle
  send(ev, data) { return new Promise(res => { const f = this.h[ev]; if (!f) return res({ error: 'handler yok' }); let done = false; f(data, r => { done = true; res(r); }); setTimeout(() => !done && res(undefined), 0); }); }
  disconnect() { if (this.h.disconnect) this.h.disconnect(); for (const r of [...this.rooms]) this.leave(r); this.io.sockets.sockets.delete(this.id); }
}
class FakeIO {
  constructor() { this.n = 0; this.sockets = { sockets: new Map() }; this.rooms = new Map(); this.conn = []; }
  _join(r, id) { if (!this.rooms.has(r)) this.rooms.set(r, new Set()); this.rooms.get(r).add(id); }
  on(ev, f) { if (ev === 'connection') this.conn.push(f); } use() {}
  to(room) { return { emit: (ev, d) => { for (const sid of [...(this.rooms.get(room) || [])]) { const s = this.sockets.sockets.get(sid); if (s) s.out(ev, d); } } }; }
  connect(user) { const s = new FSocket(this, user); s.log = []; s.out = (ev, d) => s.log.push([ev, d]); this.conn.forEach(f => f(s)); return s; }
}
module.exports = { FakeIO };
