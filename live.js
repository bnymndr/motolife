'use strict';
// Canlı sürücü konumu (Socket.IO). Paylaşım açık rızaya bağlıdır ve her bağlantıda KAPALI başlar.
// Konumlar yalnızca bellekte tutulur, diske yazılmaz. Paylaşım soketle ilişkilidir: bağlantı kopunca/sekme kapanınca konum silinir.
// Olaylar: istemci → sunucu: loc:share, loc:update, loc:watch.  sunucu → istemci: loc:riders (yalnız izleyenlere, değişince).
// server.js içinden: require('./live')({ io, uname, isFriend })
module.exports = function mountLive({ io, uname, isFriend, isBlocked }) {
  const LIVE_MS = 90 * 1000;        // bundan eski konum canlı sayılmaz (istemci en geç 45 sn'de bir gönderir)
  const DROP_MS = 10 * 60 * 1000;   // bu kadar eski kayıt bellekten de silinir
  const MIN_GAP = 4000;             // aynı kullanıcıdan en sık konum güncellemesi
  const TICK_MS = 5000;             // izleyicilere değişiklik taraması
  const MAX_RIDERS = 100, MAX_KM = 500, MAX_ACC = 200;
  const AUD = ['friends', 'all'];

  const live = new Map();           // kullanıcı id → { sid, name, aud, lat, lon, riding, at }
  const num = v => (typeof v === 'number' && isFinite(v) ? v : null);
  const lastCall = new WeakMap();   // soket → { olay: zaman } (hız sınırı)
  const tooFast = (socket, ev, ms) => {
    const m = lastCall.get(socket) || {}, now = Date.now();
    if (m[ev] && now - m[ev] < ms) return true;
    m[ev] = now; lastCall.set(socket, m); return false;
  };

  function dist(lat1, lon1, lat2, lon2) {   // km (haversine)
    const R = 6371, rad = Math.PI / 180, dLa = (lat2 - lat1) * rad, dLo = (lon2 - lon1) * rad;
    const a = Math.sin(dLa / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLo / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  // İzleyicinin görebileceği sürücüler: yetki (arkadaş/herkes), mesafe ve tazelik burada sunucuda uygulanır
  function snapshot(sock) {
    const w = sock.data.watch; if (!w) return { list: [], key: '' };
    const me = sock.data.user.id, now = Date.now(), rows = [];
    for (const [uid, e] of live) {
      if (uid === me || e.lat == null || now - e.at > LIVE_MS || (isBlocked && isBlocked(me, uid))) continue;   // engelli kullanıcılar birbirini görmez
      const fr = isFriend(me, uid);
      if (e.aud === 'friends' && !fr) continue;                       // yalnız arkadaşlarına açmış
      if (w.fo && !fr) continue;                                      // izleyici yalnız arkadaşları istiyor
      const lat = fr ? e.lat : Math.round(e.lat * 1000) / 1000;       // arkadaş olmayanlara ≈100 m yuvarlanmış konum
      const lon = fr ? e.lon : Math.round(e.lon * 1000) / 1000;
      const km = dist(w.lat, w.lon, lat, lon);
      if (km > w.km) continue;
      rows.push({ u: e.name, rel: fr ? 'friend' : 'other', riding: e.riding, lat, lon, approx: !fr, km: Math.round(km * 10) / 10, age: Math.round((now - e.at) / 1000) });
    }
    rows.sort((a, b) => a.km - b.km);
    const list = rows.slice(0, MAX_RIDERS);
    return { list, key: list.map(r => [r.u, r.lat, r.lon, r.riding ? 1 : 0, r.rel].join(',')).join(';') };
  }

  function push(sock, force) {
    const s = snapshot(sock);
    if (!force && s.key === sock.data.watchKey) return;
    sock.data.watchKey = s.key;
    sock.emit('loc:riders', s.list);
  }
  function pushAll() {
    for (const sock of io.sockets.sockets.values()) if (sock.data.watch) push(sock, false);
  }
  setInterval(() => {
    const now = Date.now();
    for (const [uid, e] of live) if (e.lat != null && now - e.at > DROP_MS) live.delete(uid);
    pushAll();
  }, TICK_MS).unref();

  function stopShare(socket) {
    const uid = socket.data.user.id, e = live.get(uid);
    if (e && e.sid === socket.id) { live.delete(uid); pushAll(); }   // kapatınca konum hemen kaybolur
  }

  io.on('connection', socket => {
    const u = socket.data.user;
    if (!u) return;

    // Paylaşımı aç/kapat. Açmak için istemci açık rıza verdiğini bildirmek zorunda; sunucu hiçbir şeyi kendiliğinden açmaz.
    socket.on('loc:share', (p = {}, cb = () => {}) => {
      if (typeof cb !== 'function') cb = () => {};
      if (tooFast(socket, 'share', 400)) return cb({ error: 'Çok sık deneme.' });
      if (p.on !== true) { stopShare(socket); return cb({ ok: true, sharing: false }); }
      if (p.consent !== true) return cb({ error: 'Paylaşım için açık onay gerekli.' });
      if (!AUD.includes(p.aud)) return cb({ error: 'Geçersiz paylaşım kapsamı.' });
      const old = live.get(u.id);
      if (old && old.sid !== socket.id) {                        // başka sekmede açıktı: paylaşım bu sekmeye geçer
        const o = io.sockets.sockets.get(old.sid); if (o) o.emit('loc:taken');
      }
      const keep = old && old.lat != null && old.sid === socket.id ? old : null;
      live.set(u.id, { sid: socket.id, name: uname(u), aud: p.aud, lat: keep ? keep.lat : null, lon: keep ? keep.lon : null, riding: keep ? keep.riding : false, at: keep ? keep.at : 0 });
      pushAll();
      cb({ ok: true, sharing: true, aud: p.aud });
    });

    // Konum güncelle (yalnızca paylaşım açıkken ve paylaşımı açan bağlantıdan)
    socket.on('loc:update', (p = {}) => {
      const e = live.get(u.id);
      if (!e || e.sid !== socket.id) return;
      const lat = num(p.lat), lon = num(p.lon), acc = p.acc == null ? 0 : num(p.acc);
      if (lat == null || lon == null || Math.abs(lat) > 90 || Math.abs(lon) > 180 || acc == null || acc > MAX_ACC) return;
      const now = Date.now();
      const rideChange = !!p.riding !== e.riding;
      if (e.at && now - e.at < MIN_GAP && !rideChange) return;   // gereksiz sıklıkta gönderim
      e.lat = lat; e.lon = lon; e.riding = !!p.riding; e.at = now;
      if (rideChange || !e.seen) { e.seen = true; pushAll(); }   // sürüş durumu/ilk konum hemen yansır, diğerleri 5 sn'lik taramada
    });

    // Haritada görüntüleme: merkez (istemcinin yuvarlattığı konum), yarıçap, yalnız-arkadaş filtresi. p === null/off → izlemeyi bırak
    socket.on('loc:watch', (p = {}, cb = () => {}) => {
      if (typeof cb !== 'function') cb = () => {};
      if (!p || p.off) { delete socket.data.watch; delete socket.data.watchKey; return cb({ ok: true }); }
      if (tooFast(socket, 'watch', 1500)) return cb({ error: 'Çok sık deneme.' });
      const lat = num(p.lat), lon = num(p.lon), km = num(p.km);
      if (lat == null || lon == null || km == null || Math.abs(lat) > 90 || Math.abs(lon) > 180) return cb({ error: 'Geçersiz konum.' });
      socket.data.watch = { lat, lon, km: Math.min(MAX_KM, Math.max(1, km)), fo: p.fo === true };
      push(socket, true);
      cb({ ok: true });
    });

    socket.on('disconnect', () => stopShare(socket));
  });

  return { _live: live, _snapshot: snapshot };   // testler için
};
