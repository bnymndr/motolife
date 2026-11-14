'use strict';
// Grup sürüşü: kalıcı sürüş grupları (REST), canlı üye konumu (Socket.IO) ve analiz için sürüş kaydı.
// Interkom "grup"larından (server.js, bellekte, şifreli ses odası) BAĞIMSIZDIR; burada gruplar kalıcıdır, davet koduyla katılınır.
//
// Veri:  data/ridegroups.json                      gruplar, üyeler, lider, davet kodu, ayarlar, sürüş geçmişi indeksi
//        data/rgroup-rides/<grup>/route.json       grubun ana güzergâhı (nokta listesi)
//        data/rgroup-rides/<grup>/<sürüş>.ndjson   sürüş kaydı: 1. satır başlık, sonra satır satır olaylar ve üye konumları
//        data/rgroup-rides/<grup>/<sürüş>.sum.json sürüş bitince özet (üye başına nokta sayısı, ilk/son zaman)
//   NDJSON satırları:  {"v":1,"k":"h",...} başlık | ["f",t,kullanıcı,lat,lon,acc,hız_m/sn|null,tahmini_hız_m/sn|null] konum
//                      ["e",t,tür,kullanıcı,ek] olay (start,end,join,leave,kick,leader,share-on,share-off,alert-*,rec-limit) | ["r",t,[[lat,lon],…]] güzergâh değişti
// Soket: grp:watch/unwatch (haritayı izle), grp:share (konumu gruba aç/kapat; yalnız aktif sürüşte, her açılış açık rıza ister), grp:update (konum).
//        sunucu → grp:state (üye konumları, değişince, ≤3 sn), grp:alert (geride kaldı/uzaklaştı/güzergâh dışı), grp:changed (kullanıcı odasına: liste yenile).
// Yetki: her uç nokta ve her soket olayı grup üyeliğini sunucuda denetler; üye olmayan için grup "yok" gibi davranır (404).
// server.js içinden: require('./ridegroups')({ app, express, io, users, userFromCookie, uname, dataDir })
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // karışan harfler (0/O, 1/I) yok
const MAX_MEMBERS = 25, MAX_GROUPS_PER_USER = 8, GAPS = [500, 1000, 2000, 3000], DEFAULT_GAP = 1000;
const STALE_MS = 30000, LOST_MS = 60000, MIN_GAP_MS = 1500, TICK_MS = 3000, OFF_ROUTE_M = 300, NEED_TICKS = 2, ALERT_COOLDOWN = 60000;
const IDLE_END_MS = 20 * 60000, REC_MAX = 15 * 1024 * 1024, MAX_ROUTE_PTS = 5000, MAX_ACC = 200;

const rad = Math.PI / 180;
function hav(lat1, lon1, lat2, lon2) {   // metre
  const a = Math.sin((lat2 - lat1) * rad / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin((lon2 - lon1) * rad / 2) ** 2;
  return 12742000 * Math.asin(Math.sqrt(a));
}
const num = v => (typeof v === 'number' && isFinite(v) ? v : null);
const r5 = v => Math.round(v * 1e5) / 1e5;

// Güzergâh üzerinde en yakın nokta: { d: yan mesafe (m), along: başlangıçtan yol boyunca mesafe (m), i: parça indeksi }
function nearestOnRoute(c, lat, lon, hint) {
  const pts = c.pts, cum = c.cum, my = 111320, mx = 111320 * Math.cos(lat * rad);
  const scan = (from, to) => {
    let best = null;
    for (let i = from; i < to; i++) {
      const ax = (pts[i][1] - lon) * mx, ay = (pts[i][0] - lat) * my, bx = (pts[i + 1][1] - lon) * mx, by = (pts[i + 1][0] - lat) * my;
      const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
      const t = l2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2)) : 0;
      const px = ax + t * dx, py = ay + t * dy, d = Math.sqrt(px * px + py * py);
      if (!best || d < best.d) best = { d, along: cum[i] + t * (cum[i + 1] - cum[i]), i };
    }
    return best;
  };
  const n = pts.length - 1;
  if (n < 1) return null;
  if (hint != null) {                         // önce önceki konumun çevresi (gidiş-dönüş güzergâhlarda karışmasın, hızlı olsun)
    const b = scan(Math.max(0, hint - 100), Math.min(n, hint + 400));
    if (b && b.d <= 150) return b;
  }
  return scan(0, n);
}

module.exports = function mountRideGroups({ app, express, io, users, userFromCookie, uname, dataDir, social }) {
  const FILE = path.join(dataDir, 'ridegroups.json');
  const REC = path.join(dataDir, 'rgroup-rides');
  fs.mkdirSync(REC, { recursive: true });

  // ---------- Depo (gecikmeli, atomik yazım) ----------
  const db = { groups: {} };
  try { const j = JSON.parse(fs.readFileSync(FILE, 'utf8')); if (j && j.groups) db.groups = j.groups; } catch {}
  let timer = null;
  const flush = () => {
    if (!timer) return;
    clearTimeout(timer); timer = null;
    try { fs.writeFileSync(FILE + '.tmp', JSON.stringify(db)); fs.renameSync(FILE + '.tmp', FILE); }
    catch (e) { console.error('Sürüş grupları yazılamadı:', e.message); }
  };
  const save = () => { if (!timer) timer = setTimeout(flush, 400); };
  const writeAtomic = (file, text) => { const tmp = file + '.' + process.pid + '.tmp'; fs.writeFileSync(tmp, text); fs.renameSync(tmp, file); };

  // ---------- Yardımcılar ----------
  const rid = () => crypto.randomBytes(8).toString('hex');
  const ID_RE = /^[0-9a-f]{16}$/;
  const txt = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001F\u007F]/g, '').replace(/\s+/g, ' ').trim().slice(0, n);
  const lower = s => String(s || '').toLocaleLowerCase('tr');
  const fail = (res, code, msg) => res.status(code).json({ error: msg });
  const nameOf = uid => { const u = users.get(uid); return u ? uname(u) : 'silinmis'; };
  const fullOf = uid => { const u = users.get(uid); return u ? ([u.firstName, u.lastName].filter(Boolean).join(' ') || uname(u)) : 'Silinmiş Kullanıcı'; };
  const isMember = (g, uid) => g.members.some(m => m.uid === uid);
  const toUser = (uid, ev, p) => io.to('u:' + uid).emit(ev, p);
  const notify = (g, kind, extra) => g.members.forEach(m => toUser(m.uid, 'grp:changed', { gid: g.id, kind, ...extra }));
  const hits = new Map();
  const limited = (key, max, ms) => {
    const now = Date.now(), a = (hits.get(key) || []).filter(t => now - t < ms);
    const over = a.length >= max; if (!over) a.push(now); hits.set(key, a); return over;
  };
  setInterval(() => { const now = Date.now(); for (const [k, a] of hits) if (!a.length || now - a[a.length - 1] > 3600000) hits.delete(k); }, 600000).unref();
  const codes = new Map();                                     // davet kodu → grup id
  const newCode = () => { let c; do { c = Array.from(crypto.randomBytes(8), b => ALPHA[b % 32]).join(''); } while (codes.has(c)); return c; };
  for (const g of Object.values(db.groups)) codes.set(g.code, g.id);
  const normCode = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);

  // ---------- Güzergâh (nokta listesi ayrı dosyada; bellekte önbellek) ----------
  const routeFile = gid => path.join(REC, gid, 'route.json');
  const rcache = new Map();                                    // gid → { v, pts, cum }
  function routeOf(g) {
    if (!g.route) return null;
    let c = rcache.get(g.id);
    if (c && c.v === g.route.v) return c;
    try {
      const pts = JSON.parse(fs.readFileSync(routeFile(g.id), 'utf8'));
      const cum = new Float64Array(pts.length);
      for (let i = 1; i < pts.length; i++) cum[i] = cum[i - 1] + hav(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]);
      c = { v: g.route.v, pts, cum }; rcache.set(g.id, c); return c;
    } catch { return null; }
  }

  // ---------- Sürüş kaydı (NDJSON, ek yazım) ----------
  const recs = new Map();                                      // gid → { id, file, buf, bytes, full, members: Map }
  const liveG = new Map();                                     // gid → { m: Map(uid→giriş), key, alerts: Map, }
  const recDir = g => path.join(REC, g.id);
  function openRec(g, header) {
    fs.mkdirSync(recDir(g), { recursive: true });
    const file = path.join(recDir(g), g.ride.id + '.ndjson');
    let bytes = 0;
    if (header) { const line = JSON.stringify(header) + '\n'; fs.appendFileSync(file, line); bytes = line.length; }
    else { try { bytes = fs.statSync(file).size; } catch {} }
    recs.set(g.id, { id: g.ride.id, file, buf: [], bytes, full: false, members: new Map() });
  }
  function rec(g, row) {
    const r = recs.get(g.id); if (!r) return;
    const line = JSON.stringify(row) + '\n';
    if (r.bytes + line.length > REC_MAX) { if (!r.full) { r.full = true; r.buf.push(JSON.stringify(['e', Date.now(), 'rec-limit', null, null]) + '\n'); } return; }
    r.bytes += line.length; r.buf.push(line);
  }
  const flushRec = r => { if (!r || !r.buf.length) return; try { fs.appendFileSync(r.file, r.buf.join('')); } catch (e) { console.error('Sürüş kaydı yazılamadı:', e.message); } r.buf = []; };
  const flushAllRecs = () => { for (const r of recs.values()) flushRec(r); };
  setInterval(flushAllRecs, 10000).unref();
  process.on('exit', () => { flushAllRecs(); flush(); });
  for (const g of Object.values(db.groups)) if (g.ride) { liveG.set(g.id, { m: new Map(), key: '', alerts: new Map() }); openRec(g, null); g.ride.idleSince = Date.now(); }

  // ---------- Görünümler ----------
  const sharingNow = (gid, uid) => { const L = liveG.get(gid), e = L && L.m.get(uid); return !!e; };
  const roleOf = (g, uid) => (g.leader === uid ? 'leader' : (g.members.find(m => m.uid === uid) || {}).role === 'admin' ? 'admin' : 'member');
  const isStaff = (g, uid) => roleOf(g, uid) !== 'member';          // lider + yönetici
  const picVer = (g, k) => { const c = g[k]; if (!c) return ''; let h = c.length; for (let i = 0; i < c.length; i += 997) h = (h * 31 + c.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };
  const picUrl = (g, k) => (g[k] ? '/api/rgroups/' + g.id + '/pic/' + k + '?v=' + picVer(g, k) : '');
  const MAX_GPOSTS = 300, MAX_DESC = 200;
  const memberView = (g, m) => {
    const c = social ? social.cardOf(m.uid) : {};
    return { username: nameOf(m.uid), name: fullOf(m.uid), role: roleOf(g, m.uid), sharing: sharingNow(g.id, m.uid), av: c.av || '', bike: c.bike || '', joinedAt: m.at };
  };
  const gpostView = (g, p, viewer) => ({
    id: p.id, author: social ? social.cardOf(p.uid) : { username: nameOf(p.uid), name: fullOf(p.uid), av: '', bike: '' }, text: p.text, at: p.at, mood: p.mood || '',
    image: p.image ? '/api/social/img/' + p.image : '', likes: p.likes.length, liked: p.likes.includes(viewer), commentCount: p.comments.length,
    mine: p.uid === viewer, canDelete: p.uid === viewer || isStaff(g, viewer),
    comments: p.comments.slice(-20).map(c => ({ id: c.id, author: social ? social.cardOf(c.uid) : { username: nameOf(c.uid), name: fullOf(c.uid), av: '', bike: '' }, text: c.text, at: c.at, canDelete: c.uid === viewer || isStaff(g, viewer) }))
  });
  const dropPost = p => { if (p.image && social) social.dropImage(p.image); };
  const brief = (g, u) => ({ id: g.id, photo: picUrl(g, 'photo'), name: g.name, desc: g.desc || '', role: roleOf(g, u.id), leader: nameOf(g.leader), count: g.members.length, active: !!g.ride, hasRoute: !!g.route, posts: (g.posts || []).length, lastAt: (g.posts || []).length ? g.posts[g.posts.length - 1].at : 0 });
  const view = (g, u) => ({
    id: g.id, photo: picUrl(g, 'photo'), cover: picUrl(g, 'cover'), name: g.name, desc: g.desc || '', role: roleOf(g, u.id), leader: nameOf(g.leader), createdAt: g.createdAt, gap: g.gap, postCount: (g.posts || []).length,
    members: [...g.members].sort((a, b) => (b.uid === g.leader) - (a.uid === g.leader)).map(m => memberView(g, m)),
    ride: g.ride ? { id: g.ride.id, startedAt: g.ride.startedAt } : null,
    route: g.route ? { v: g.route.v, len: g.route.len, n: g.route.n, name: g.route.name } : null,
    code: isStaff(g, u.id) ? g.code : undefined
  });
  const authed = (req, res) => { const u = userFromCookie(req.headers.cookie); if (!u) { fail(res, 401, 'Giriş gerekli.'); return null; } return u; };
  function ctxOf(req, res, need) {            // need: true = yalnız lider, 'staff' = lider ya da yönetici
    const u = authed(req, res); if (!u) return null;
    const g = db.groups[req.params.id];
    if (!g || !isMember(g, u.id)) { fail(res, 404, 'Grup bulunamadı.'); return null; }
    if (need === true && g.leader !== u.id) { fail(res, 403, 'Bu işlem için grup lideri olmalısın.'); return null; }
    if (need === 'staff' && !isStaff(g, u.id)) { fail(res, 403, 'Bu işlem için grup lideri ya da yöneticisi olmalısın.'); return null; }
    return { u, g };
  }
  const memberByName = (g, n) => g.members.find(m => lower(nameOf(m.uid)) === lower(n));

  // ---------- Canlı durum ----------
  function stopShare(g, uid, why, silent) {
    const L = liveG.get(g.id), e = L && L.m.get(uid); if (!e) return false;
    L.m.delete(uid);
    const s = io.sockets.sockets.get(e.sid); if (s && s.data.gshare) s.data.gshare.delete(g.id);
    rec(g, ['e', Date.now(), 'share-off', nameOf(uid), why || null]);
    if (!silent) emitState(g, true);
    return true;
  }
  function computeState(g) {
    const L = liveG.get(g.id), now = Date.now(), rows = [];
    const le = L && L.m.get(g.leader), lf = !!(le && le.lat != null && now - le.at <= STALE_MS);
    if (L) for (const [uid, e] of L.m) {
      const u = nameOf(uid), lead = uid === g.leader;
      if (e.lat == null) { rows.push({ u, lead, wait: true }); continue; }   // paylaşım açık ama henüz konum gelmedi
      const age = now - e.at;
      if (age > LOST_MS) { rows.push({ u, lead, lost: true, age: Math.round(age / 1000) }); continue; }   // eski konum canlı gösterilmez
      const kmh = e.spd != null ? e.spd * 3.6 : e.est != null ? e.est * 3.6 : null;
      rows.push({ u, lead, lat: r5(e.lat), lon: r5(e.lon), spd: kmh == null ? null : Math.round(kmh), est: e.spd == null && e.est != null,
        age: Math.round(age / 1000), f: age <= STALE_MS && e.fl ? e.fl : undefined,   // bayat konumla uyarı gösterilmez
        dl: lf && !lead ? Math.round(hav(e.lat, e.lon, le.lat, le.lon)) : undefined });
    }
    rows.sort((a, b) => (b.lead ? 1 : 0) - (a.lead ? 1 : 0) || a.u.localeCompare(b.u));
    return { rows, ref: lf, key: lf + '|' + rows.map(r => [r.u, r.lat, r.lon, r.spd, r.f || '', r.lost ? 1 : 0, r.lead ? 1 : 0, r.wait ? 1 : 0].join(',')).join(';') };
  }
  const payload = (g, s) => ({ gid: g.id, rv: g.route ? g.route.v : 0, ref: s.ref, gap: g.gap, ride: !!g.ride, members: s.rows, t: Date.now() });
  function emitState(g, force) {
    const L = liveG.get(g.id); if (!L) return;
    const s = computeState(g);
    if (!force && s.key === L.key) return;
    L.key = s.key;
    io.to('rg:' + g.id).emit('grp:state', payload(g, s));
  }
  function evalFlags(g, now) {
    const L = liveG.get(g.id); if (!L) return;
    const le = L.m.get(g.leader), lf = !!(le && le.lat != null && now - le.at <= STALE_MS), rc = routeOf(g);
    for (const [uid, e] of L.m) {
      let want = null, meters = 0;
      if (uid !== g.leader && e.lat != null && now - e.at <= STALE_MS) {      // bayat konumla uyarı üretilmez
        const onRoute = x => rc && x && x.rt && x.rt.d <= OFF_ROUTE_M;
        const dl = lf ? hav(e.lat, e.lon, le.lat, le.lon) : null;
        const sticky = e.fl ? 0.8 : 1;                                       // histerezis: bir kez işaretlenince eşiğin %80'inin altına inmeden kalkmaz
        if (rc && e.rt && e.rt.d > OFF_ROUTE_M * (e.fl === 'off' ? 0.8 : 1)) { want = 'off'; meters = e.rt.d; }
        else if (lf && onRoute(e) && onRoute(le)) {
          const lag = le.rt.along - e.rt.along, thr = g.gap * sticky;
          if (lag > thr) { want = 'behind'; meters = lag; } else if (-lag > thr) { want = 'away'; meters = -lag; }
        } else if (lf && dl > g.gap * sticky) { want = 'away'; meters = dl; }
      }
      if (want === e.fl) { e.pend = null; continue; }
      e.pend = e.pend && e.pend.f === want ? { f: want, n: e.pend.n + 1, m: meters } : { f: want, n: 1, m: meters };
      if (e.pend.n < NEED_TICKS) continue;                                   // titreşim önleme: ardışık 2 taramada aynıysa değişir
      e.fl = want; e.pend = null;
      if (want) {
        const k = uid + ':' + want, last = L.alerts.get(k) || 0;
        if (now - last >= ALERT_COOLDOWN) {
          L.alerts.set(k, now);
          io.to('rg:' + g.id).emit('grp:alert', { gid: g.id, u: nameOf(uid), f: want, m: Math.round(meters) });
          rec(g, ['e', now, 'alert-' + want, nameOf(uid), Math.round(meters)]);
        }
      } else rec(g, ['e', now, 'alert-clear', nameOf(uid), null]);
    }
  }
  setInterval(() => {
    const now = Date.now();
    for (const g of Object.values(db.groups)) {
      if (!g.ride) continue;
      const L = liveG.get(g.id); if (!L) continue;
      evalFlags(g, now);
      emitState(g, false);
      if (L.m.size) g.ride.idleSince = now;
      else if (now - (g.ride.idleSince || now) > IDLE_END_MS) endRide(g, null, 'otomatik: 20 dk kimse paylaşmadı');   // unutulmuş sürüş kapanır
    }
  }, TICK_MS).unref();

  // ---------- Sürüş başlat / bitir, üyelik ----------
  function startRide(g, u) {
    const id = rid(), t = Date.now();
    g.ride = { id, startedAt: t, by: u.id, idleSince: t };
    liveG.set(g.id, { m: new Map(), key: '', alerts: new Map() });
    const rc = routeOf(g);
    openRec(g, { v: 1, k: 'h', rideId: id, groupId: g.id, groupName: g.name, startedAt: t, leader: nameOf(g.leader), gap: g.gap,
      members: g.members.map(m => nameOf(m.uid)), route: rc ? rc.pts : null });
    rec(g, ['e', t, 'start', uname(u), null]);
    save(); notify(g, 'ride-start');
  }
  function endRide(g, by, why) {
    const R = g.ride; if (!R) return;
    const r = recs.get(g.id), t = Date.now(), L = liveG.get(g.id);
    if (L) for (const uid of [...L.m.keys()]) stopShare(g, uid, 'ride-end', true);   // önce paylaşımlar kapanır, sonra «end» satırı yazılır
    rec(g, ['e', t, 'end', by ? uname(by) : null, why || null]);
    flushRec(r);
    try {
      writeAtomic(path.join(recDir(g), R.id + '.sum.json'), JSON.stringify({ v: 1, rideId: R.id, groupId: g.id, name: g.name, startedAt: R.startedAt, endedAt: t,
        endedBy: by ? uname(by) : null, reason: why || null, recFull: !!(r && r.full), route: g.route ? { len: g.route.len, v: g.route.v } : null,
        members: r ? [...r.members].map(([u, m]) => ({ username: u, fixes: m.n, firstAt: m.first, lastAt: m.last })) : [] }));
    } catch (e) { console.error('Sürüş özeti yazılamadı:', e.message); }
    if (R.music) io.to('rg:' + g.id).emit('grp:music', { gid: g.id, music: null });
    g.ride = null;
    if (L) emitState(g, true);                                              // izleyiciler boş durumu görür
    recs.delete(g.id); liveG.delete(g.id);
    (g.rides = g.rides || []).unshift({ id: R.id, startedAt: R.startedAt, endedAt: t });
    g.rides.length = Math.min(g.rides.length, 50);
    save(); notify(g, 'ride-end');
  }
  function destroyGroup(g, kind) {
    if (g.ride) endRide(g, null, 'grup silindi');
    notify(g, kind);
    io.in('rg:' + g.id).socketsLeave('rg:' + g.id);
    (g.posts || []).forEach(dropPost);
    codes.delete(g.code); rcache.delete(g.id); delete db.groups[g.id]; save();
  }
  function removeMember(g, uid, kind) {
    toUser(uid, 'grp:changed', { gid: g.id, kind: 'removed' });
    stopShare(g, uid, kind, true);
    io.in('u:' + uid).socketsLeave('rg:' + g.id);
    rec(g, ['e', Date.now(), kind, nameOf(uid), null]);
    g.members = g.members.filter(m => m.uid !== uid);
    g.posts = (g.posts || []).filter(p => { if (p.uid !== uid) return true; dropPost(p); return false; });
    for (const p of g.posts) { p.likes = p.likes.filter(x => x !== uid); p.comments = p.comments.filter(c => c.uid !== uid); }
    if (!g.members.length) return destroyGroup(g, 'deleted');
    if (g.leader === uid) { const nx = g.members.find(m => m.role === 'admin') || g.members[0]; delete nx.role; g.leader = nx.uid; rec(g, ['e', Date.now(), 'leader', nameOf(g.leader), 'otomatik']); }
    save(); notify(g, kind); if (g.ride) emitState(g, true);
  }

  // ---------- REST ----------
  app.get('/api/rgroups', (req, res) => {
    const u = authed(req, res); if (!u) return;
    res.json({ groups: Object.values(db.groups).filter(g => isMember(g, u.id)).map(g => brief(g, u)) });
  });
  app.post('/api/rgroups', (req, res) => {
    const u = authed(req, res); if (!u) return;
    const name = txt((req.body || {}).name, 40);
    if (name.length < 2) return fail(res, 400, 'Grup adı en az 2 karakter olmalı.');
    if (limited('rgc:' + u.id, 10, 3600000)) return fail(res, 429, 'Çok fazla grup oluşturdun, biraz bekle.');
    if (Object.values(db.groups).filter(g => isMember(g, u.id)).length >= MAX_GROUPS_PER_USER) return fail(res, 400, 'En fazla ' + MAX_GROUPS_PER_USER + ' grupta olabilirsin.');
    const g = { id: rid(), name, desc: txt((req.body || {}).desc, MAX_DESC), posts: [], code: newCode(), leader: u.id, createdAt: Date.now(), gap: DEFAULT_GAP, members: [{ uid: u.id, at: Date.now() }], route: null, ride: null, rides: [] };
    db.groups[g.id] = g; codes.set(g.code, g.id); save();
    res.json({ group: view(g, u) });
  });
  const codeGuard = (req, res, u) => {
    if (limited('rgj:' + u.id, 10, 600000) || limited('rgi:' + req.ip, 40, 600000)) { fail(res, 429, 'Çok fazla deneme. Biraz bekle.'); return null; }
    const g = db.groups[codes.get(normCode((req.body || {}).code || req.query.code))];
    if (!g) { fail(res, 404, 'Davet kodu geçersiz.'); return null; }
    return g;
  };
  app.post('/api/rgroups/join', (req, res) => {
    const u = authed(req, res); if (!u) return;
    const g = codeGuard(req, res, u); if (!g) return;
    if (isMember(g, u.id)) return res.json({ group: view(g, u), already: true });
    if (g.members.length >= MAX_MEMBERS) return fail(res, 409, 'Grup dolu (en fazla ' + MAX_MEMBERS + ' üye).');
    if (Object.values(db.groups).filter(x => isMember(x, u.id)).length >= MAX_GROUPS_PER_USER) return fail(res, 400, 'En fazla ' + MAX_GROUPS_PER_USER + ' grupta olabilirsin.');
    g.members.push({ uid: u.id, at: Date.now() });
    rec(g, ['e', Date.now(), 'join', uname(u), null]);
    save(); notify(g, 'join', { u: uname(u) });
    res.json({ group: view(g, u) });
  });
  app.get('/api/rgroups/preview', (req, res) => {          // davet bağlantısı onayı için: yalnızca ad, lider, üye sayısı
    const u = authed(req, res); if (!u) return;
    const g = codeGuard(req, res, u); if (!g) return;
    res.json({ name: g.name, leader: nameOf(g.leader), count: g.members.length, full: g.members.length >= MAX_MEMBERS, member: isMember(g, u.id), id: isMember(g, u.id) ? g.id : undefined });
  });
  app.get('/api/rgroups/:id', (req, res) => { const c = ctxOf(req, res); if (c) res.json({ group: view(c.g, c.u) }); });
  app.patch('/api/rgroups/:id', (req, res) => {
    const c = ctxOf(req, res, 'staff'); if (!c) return;
    const b = req.body || {};
    if (b.name !== undefined) { const n = txt(b.name, 40); if (n.length < 2) return fail(res, 400, 'Grup adı en az 2 karakter olmalı.'); c.g.name = n; }
    if (b.desc !== undefined) c.g.desc = txt(b.desc, MAX_DESC);
    if (b.gap !== undefined) { if (!GAPS.includes(Number(b.gap))) return fail(res, 400, 'Geçersiz mesafe.'); c.g.gap = Number(b.gap); }
    save(); notify(c.g, 'settings');
    res.json({ group: view(c.g, c.u) });
  });
  app.delete('/api/rgroups/:id', (req, res) => { const c = ctxOf(req, res, true); if (!c) return; destroyGroup(c.g, 'deleted'); res.json({ ok: true }); });
  // ---- Grup içi gönderi / beğeni / yorum (yalnız üyeler) ----
  if (social) social.setImageGate((uid, pid) => Object.values(db.groups).some(g => isMember(g, uid) && (g.posts || []).some(p => p.id === pid)));
  const findGPost = (c, req, res) => { const p = (c.g.posts || []).find(x => x.id === req.params.pid); if (!p) { fail(res, 404, 'Gönderi bulunamadı.'); return null; } return p; };
  app.get('/api/rgroups/:id/posts', (req, res) => {
    const c = ctxOf(req, res); if (!c) return;
    const before = Number(req.query.before) || Infinity, size = 20;
    const rows = (c.g.posts || []).filter(p => p.at < before).sort((a, b) => b.at - a.at);
    res.json({ posts: rows.slice(0, size).map(p => gpostView(c.g, p, c.u.id)), more: rows.length > size });
  });
  app.post('/api/rgroups/:id/posts', (req, res) => {
    const c = ctxOf(req, res); if (!c) return;
    const b = req.body || {}, t = txt(b.text, 500), img = String(b.image || '');
    if (!t && !img) return fail(res, 400, 'Gönderi boş olamaz.');
    if (limited('rgp:' + c.u.id, 8, 60000)) return fail(res, 429, 'Çok sık paylaşım yapıyorsun, biraz bekle.');
    const p = { id: rid(), uid: c.u.id, text: t, at: Date.now(), likes: [], comments: [], mood: social ? social.mood(b.mood) : '', image: '' };
    if (img) { if (!social || !social.claimImage(img, c.u.id, p.id)) return fail(res, 400, 'Fotoğraf bulunamadı, tekrar yükle.'); p.image = img; }
    (c.g.posts = c.g.posts || []).push(p);
    if (c.g.posts.length > MAX_GPOSTS) c.g.posts.splice(0, c.g.posts.length - MAX_GPOSTS).forEach(dropPost);
    save(); notify(c.g, 'post', { u: uname(c.u) });
    res.json({ post: gpostView(c.g, p, c.u.id) });
  });
  app.delete('/api/rgroups/:id/posts/:pid', (req, res) => {
    const c = ctxOf(req, res); if (!c) return;
    const p = findGPost(c, req, res); if (!p) return;
    if (p.uid !== c.u.id && !isStaff(c.g, c.u.id)) return fail(res, 403, 'Bu gönderiyi silemezsin.');
    dropPost(p); c.g.posts = c.g.posts.filter(x => x !== p); save(); res.json({ ok: true });
  });
  app.post('/api/rgroups/:id/posts/:pid/like', (req, res) => {
    const c = ctxOf(req, res); if (!c) return;
    const p = findGPost(c, req, res); if (!p) return;
    const i = p.likes.indexOf(c.u.id); if (i >= 0) p.likes.splice(i, 1); else p.likes.push(c.u.id);
    save(); res.json({ liked: i < 0, likes: p.likes.length });
  });
  app.post('/api/rgroups/:id/posts/:pid/comments', (req, res) => {
    const c = ctxOf(req, res); if (!c) return;
    const p = findGPost(c, req, res); if (!p) return;
    const t = txt((req.body || {}).text, 300);
    if (!t) return fail(res, 400, 'Yorum boş olamaz.');
    if (limited('rgm:' + c.u.id, 20, 60000)) return fail(res, 429, 'Çok sık yorum yapıyorsun, biraz bekle.');
    const cm = { id: rid(), uid: c.u.id, text: t, at: Date.now() };
    p.comments.push(cm); save();
    res.json({ comment: { id: cm.id, author: social ? social.cardOf(c.u.id) : { username: uname(c.u), name: uname(c.u), av: '', bike: '' }, text: cm.text, at: cm.at, canDelete: true }, commentCount: p.comments.length });
  });
  app.delete('/api/rgroups/:id/posts/:pid/comments/:cid', (req, res) => {
    const c = ctxOf(req, res); if (!c) return;
    const p = findGPost(c, req, res); if (!p) return;
    const cm = p.comments.find(x => x.id === req.params.cid);
    if (!cm) return fail(res, 404, 'Yorum bulunamadı.');
    if (cm.uid !== c.u.id && !isStaff(c.g, c.u.id)) return fail(res, 403, 'Bu yorumu silemezsin.');
    p.comments = p.comments.filter(x => x !== cm); save(); res.json({ ok: true });
  });
  app.post('/api/rgroups/:id/leave', (req, res) => { const c = ctxOf(req, res); if (!c) return; removeMember(c.g, c.u.id, 'leave'); res.json({ ok: true }); });
  app.post('/api/rgroups/:id/kick', (req, res) => {
    const c = ctxOf(req, res, 'staff'); if (!c) return;
    const m = memberByName(c.g, (req.body || {}).username);
    if (!m) return fail(res, 404, 'Üye bulunamadı.');
    if (m.uid === c.u.id) return fail(res, 400, 'Kendini çıkaramazsın; gruptan ayrıl.');
    if (m.uid === c.g.leader || (roleOf(c.g, m.uid) === 'admin' && c.g.leader !== c.u.id)) return fail(res, 403, 'Bu üyeyi çıkarma yetkin yok.');
    removeMember(c.g, m.uid, 'kick'); res.json({ ok: true });
  });
  app.post('/api/rgroups/:id/leader', (req, res) => {
    const c = ctxOf(req, res, true); if (!c) return;
    const m = memberByName(c.g, (req.body || {}).username);
    if (!m) return fail(res, 404, 'Üye bulunamadı.');
    if (m.uid === c.g.leader) return res.json({ group: view(c.g, c.u) });
    delete m.role; c.g.leader = m.uid; rec(c.g, ['e', Date.now(), 'leader', nameOf(m.uid), uname(c.u)]);
    save(); notify(c.g, 'leader'); if (c.g.ride) emitState(c.g, true);
    res.json({ group: view(c.g, c.u) });
  });
  app.post('/api/rgroups/:id/role', (req, res) => {          // yalnız lider: Yönetici ata / geri al
    const c = ctxOf(req, res, true); if (!c) return;
    const b = req.body || {}, m = memberByName(c.g, b.username);
    if (!m) return fail(res, 404, 'Üye bulunamadı.');
    if (m.uid === c.g.leader) return fail(res, 400, 'Liderin rolü değiştirilemez; önce lideri devret.');
    if (b.role !== 'admin' && b.role !== 'member') return fail(res, 400, 'Geçersiz rol.');
    if (b.role === 'admin') m.role = 'admin'; else delete m.role;
    rec(c.g, ['e', Date.now(), 'role', nameOf(m.uid), b.role]); save(); notify(c.g, 'role');
    res.json({ group: view(c.g, c.u) });
  });
  // Grup fotoğrafı (photo) ve grup içi kapak (cover): JPEG ham gövde ≤150 KB, boş gövde = kaldır; lider/yönetici. Yalnız üyeler okur.
  const PIC = { photo: 1, cover: 1 };
  app.put('/api/rgroups/:id/pic/:kind', express.raw({ type: 'application/octet-stream', limit: '200kb' }), (req, res) => {
    const c = ctxOf(req, res, 'staff'); if (!c) return;
    if (!PIC[req.params.kind]) return fail(res, 404, 'Bilinmeyen görsel türü.');
    const b = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!b.length) delete c.g[req.params.kind];
    else {
      if (b.length > 150000 || b[0] !== 0xff || b[1] !== 0xd8 || b[2] !== 0xff) return fail(res, 400, 'Fotoğraf geçersiz ya da çok büyük.');
      c.g[req.params.kind] = b.toString('base64');
    }
    save(); notify(c.g, 'settings'); res.json({ group: view(c.g, c.u) });
  });
  app.get('/api/rgroups/:id/pic/:kind', (req, res) => {
    const c = ctxOf(req, res); if (!c) return;
    const d = PIC[req.params.kind] && c.g[req.params.kind];
    if (!d) return res.status(404).end();
    res.set({ 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=86400' }); res.send(Buffer.from(d, 'base64'));
  });
  app.post('/api/rgroups/:id/code', (req, res) => {
    const c = ctxOf(req, res, 'staff'); if (!c) return;
    codes.delete(c.g.code); c.g.code = newCode(); codes.set(c.g.code, c.g.id); save();     // eski kod/bağlantı geçersiz olur
    res.json({ code: c.g.code });
  });
  app.post('/api/rgroups/:id/start', (req, res) => {
    const c = ctxOf(req, res, 'staff'); if (!c) return;
    if (c.g.ride) return fail(res, 409, 'Grup sürüşü zaten başlamış.');
    startRide(c.g, c.u); res.json({ group: view(c.g, c.u) });
  });
  app.post('/api/rgroups/:id/end', (req, res) => {
    const c = ctxOf(req, res, 'staff'); if (!c) return;
    if (!c.g.ride) return fail(res, 409, 'Aktif grup sürüşü yok.');
    endRide(c.g, c.u, null); res.json({ group: view(c.g, c.u) });
  });
  // Ana güzergâh: liderin haritada oluşturduğu rota. İçerik türü octet-stream (genel 10 KB JSON sınırına takılmasın; rides.js ile aynı yöntem).
  app.put('/api/rgroups/:id/route', express.raw({ type: 'application/octet-stream', limit: '400kb' }), (req, res) => {
    const c = ctxOf(req, res, 'staff'); if (!c) return;
    if (limited('rgr:' + c.u.id, 6, 600000)) return fail(res, 429, 'Güzergâh çok sık değiştirildi, biraz bekle.');
    let b = req.body;
    try { if (Buffer.isBuffer(b)) b = JSON.parse(b.toString('utf8')); } catch { return fail(res, 400, 'Güzergâh okunamadı.'); }
    const raw = b && b.pts;
    if (!Array.isArray(raw) || raw.length < 2 || raw.length > MAX_ROUTE_PTS) return fail(res, 400, 'Güzergâh 2–' + MAX_ROUTE_PTS + ' nokta olmalı.');
    const pts = [];
    for (const p of raw) {
      const la = Array.isArray(p) ? num(p[0]) : null, lo = Array.isArray(p) ? num(p[1]) : null;
      if (la == null || lo == null || Math.abs(la) > 90 || Math.abs(lo) > 180) return fail(res, 400, 'Güzergâhta geçersiz nokta var.');
      const q = [r5(la), r5(lo)], last = pts[pts.length - 1];
      if (!last || last[0] !== q[0] || last[1] !== q[1]) pts.push(q);
    }
    if (pts.length < 2) return fail(res, 400, 'Güzergâh en az 2 farklı nokta olmalı.');
    let len = 0; for (let i = 1; i < pts.length; i++) len += hav(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]);   // uzunluk istemciye güvenilmeden hesaplanır
    const g = c.g;
    fs.mkdirSync(recDir(g), { recursive: true }); writeAtomic(routeFile(g.id), JSON.stringify(pts));
    g.route = { v: ((g.route && g.route.v) || 0) + 1, len: Math.round(len), n: pts.length, name: txt(b.name, 60), at: Date.now() };
    rcache.delete(g.id);
    if (g.ride) rec(g, ['r', Date.now(), pts]);
    save(); notify(g, 'route'); if (g.ride) emitState(g, true);
    res.json({ route: g.route });
  });
  app.get('/api/rgroups/:id/route', (req, res) => {
    const c = ctxOf(req, res); if (!c) return;
    const rc = routeOf(c.g); if (!rc) return fail(res, 404, 'Grubun güzergâhı yok.');
    res.json({ v: c.g.route.v, name: c.g.route.name, len: c.g.route.len, pts: rc.pts });
  });
  app.delete('/api/rgroups/:id/route', (req, res) => {
    const c = ctxOf(req, res, 'staff'); if (!c) return;
    if (c.g.route) { c.g.route = null; rcache.delete(c.g.id); fs.unlink(routeFile(c.g.id), () => {}); if (c.g.ride) rec(c.g, ['r', Date.now(), null]); save(); notify(c.g, 'route'); if (c.g.ride) emitState(c.g, true); }
    res.json({ ok: true });
  });
  // Kayıtlı grup sürüşleri (analiz aşaması için): yalnızca şu anki üyeler okuyabilir
  app.get('/api/rgroups/:id/rides', (req, res) => {
    const c = ctxOf(req, res); if (!c) return;
    const list = (c.g.rides || []).map(r => {
      let sum = null; try { sum = JSON.parse(fs.readFileSync(path.join(recDir(c.g), r.id + '.sum.json'), 'utf8')); } catch {}
      return { ...r, members: sum ? sum.members : [], endedBy: sum ? sum.endedBy : null };
    });
    if (c.g.ride) list.unshift({ id: c.g.ride.id, startedAt: c.g.ride.startedAt, endedAt: null, members: [] });
    res.json({ rides: list });
  });
  app.get('/api/rgroups/:id/rides/:rid', (req, res) => {
    const c = ctxOf(req, res); if (!c) return;
    const id = req.params.rid;
    if (!ID_RE.test(id) || !((c.g.rides || []).some(r => r.id === id) || (c.g.ride && c.g.ride.id === id))) return fail(res, 404, 'Sürüş bulunamadı.');
    if (c.g.ride && c.g.ride.id === id) flushRec(recs.get(c.g.id));
    const file = path.join(recDir(c.g), id + '.ndjson');
    if (!fs.existsSync(file)) return fail(res, 404, 'Kayıt dosyası yok.');
    res.set('Content-Type', 'application/x-ndjson; charset=utf-8');
    fs.createReadStream(file).on('error', () => res.end()).pipe(res);
  });

  const YT_ID = /^[A-Za-z0-9_-]{11}$/, YT_LIST = /^[A-Za-z0-9_-]{10,64}$/;
  const musicView = m => ({ video: m.video, list: m.list, playing: m.playing, seq: m.seq, by: m.by });
  // ---------- Etkinlikler (grup içi plan: başlangıç, mola/uğrak noktaları, varış) ----------
  const MAX_EVENTS = 20, MAX_STOPS = 8;
  const cleanPt = (p, withKind) => {
    if (!p || typeof p !== 'object') return null;
    const la = num(p.lat), lo = num(p.lon), name = txt(p.name, 60);
    if (la == null || lo == null || Math.abs(la) > 90 || Math.abs(lo) > 180 || !name) return null;
    const o = { name, lat: r5(la), lon: r5(lo) }; if (withKind) o.kind = 'mola'; return o;
  };
  function cleanEvent(b) {
    b = b || {};
    const title = txt(b.title, 60); if (title.length < 2) return { error: 'Etkinlik adı en az 2 karakter olmalı.' };
    let at = null; if (b.at != null && b.at !== '') { at = num(b.at); const now = Date.now(); if (at == null || at < now - 86400000 || at > now + 3 * 365 * 86400000) return { error: 'Etkinlik tarihi geçersiz.' }; }
    const start = cleanPt(b.start), dest = cleanPt(b.dest);
    if (!start) return { error: 'Başlangıç yeri seçilmeli.' }; if (!dest) return { error: 'Varış noktası seçilmeli.' };
    const raw = Array.isArray(b.stops) ? b.stops : []; if (raw.length > MAX_STOPS) return { error: 'En fazla ' + MAX_STOPS + ' mola noktası eklenebilir.' };
    const stops = []; for (const x of raw) { const c = cleanPt(x, true); if (!c) return { error: 'Mola noktalarından birinde ad ya da konum eksik.' }; stops.push(c); }
    return { ev: { title, at, start, dest, stops, note: txt(b.note, 200) } };
  }
  const evView = (g, e) => ({ id: e.id, title: e.title, at: e.at, start: e.start, dest: e.dest, stops: e.stops, note: e.note || '', by: nameOf(e.by), createdAt: e.createdAt });
  const evList = g => [...(g.events || [])].sort((a, b) => (a.at == null) - (b.at == null) || (a.at || 0) - (b.at || 0) || a.createdAt - b.createdAt).map(e => evView(g, e));
  app.get('/api/rgroups/:id/events', (req, res) => { const c = ctxOf(req, res); if (c) res.json({ events: evList(c.g), canEdit: isStaff(c.g, c.u.id) }); });
  app.post('/api/rgroups/:id/events', (req, res) => {
    const c = ctxOf(req, res, 'staff'); if (!c) return;
    if (limited('rge:' + c.u.id, 20, 600000)) return fail(res, 429, 'Çok sık etkinlik değiştirildi, biraz bekle.');
    const r = cleanEvent(req.body); if (r.error) return fail(res, 400, r.error);
    c.g.events = c.g.events || []; if (c.g.events.length >= MAX_EVENTS) return fail(res, 409, 'En fazla ' + MAX_EVENTS + ' etkinlik olabilir; eskilerini sil.');
    const e = { id: rid(), ...r.ev, by: c.u.id, createdAt: Date.now() }; c.g.events.push(e); save(); notify(c.g, 'events');
    res.json({ event: evView(c.g, e), events: evList(c.g) });
  });
  app.put('/api/rgroups/:id/events/:eid', (req, res) => {
    const c = ctxOf(req, res, 'staff'); if (!c) return;
    const e = (c.g.events || []).find(x => x.id === req.params.eid); if (!e) return fail(res, 404, 'Etkinlik bulunamadı.');
    const r = cleanEvent(req.body); if (r.error) return fail(res, 400, r.error);
    Object.assign(e, r.ev); save(); notify(c.g, 'events'); res.json({ event: evView(c.g, e), events: evList(c.g) });
  });
  app.delete('/api/rgroups/:id/events/:eid', (req, res) => {
    const c = ctxOf(req, res, 'staff'); if (!c) return;
    const n = (c.g.events || []).length; c.g.events = (c.g.events || []).filter(x => x.id !== req.params.eid);
    if (c.g.events.length === n) return fail(res, 404, 'Etkinlik bulunamadı.');
    save(); notify(c.g, 'events'); res.json({ ok: true, events: evList(c.g) });
  });

  // ---------- Soket ----------
  io.on('connection', socket => {
    const u = socket.data.user; if (!u) return;
    const last = {};
    const tooFast = (ev, ms) => { const now = Date.now(); if (last[ev] && now - last[ev] < ms) return true; last[ev] = now; return false; };
    const memberOf = gid => { const g = db.groups[String(gid)]; return g && isMember(g, u.id) ? g : null; };
    const ok = cb => (typeof cb === 'function' ? cb : () => {});

    socket.on('grp:watch', (p = {}, cb) => {                        // haritayı izle: odaya katıl, anlık görüntüyü al
      cb = ok(cb);
      const g = memberOf(p && p.gid); if (!g) return cb({ error: 'Grup bulunamadı.' });
      if (tooFast('watch', 800)) return cb({ error: 'Çok sık deneme.' });
      socket.join('rg:' + g.id);
      socket.emit('grp:state', payload(g, computeState(g)));
      socket.emit('grp:music', { gid: g.id, music: g.ride && g.ride.music ? musicView(g.ride.music) : null });
      cb({ ok: true, ride: !!g.ride });
    });
    // Müzik paylaşımı (yalnız lider, yalnız aktif sürüşte): YouTube video/liste kimliği + oynuyor/duraklat + sonraki/önceki. Ses üyelerin kendi cihazında çalar.
    socket.on('grp:music', (p = {}, cb) => {
      cb = ok(cb);
      const g = memberOf(p && p.gid); if (!g) return cb({ error: 'Grup bulunamadı.' });
      if (!g.ride) return cb({ error: 'Aktif grup sürüşü yok.' });
      if (g.leader !== u.id) return cb({ error: 'Müziği yalnız grup lideri paylaşır.' });
      if (tooFast('music', 300)) return cb({ error: 'Çok sık deneme.' });
      const old = g.ride.music;
      if (p.src === null) { if (old) { g.ride.music = null; io.to('rg:' + g.id).emit('grp:music', { gid: g.id, music: null }); } return cb({ ok: true, shared: false }); }
      if (p.src && typeof p.src === 'object') {
        const video = YT_ID.test(String(p.src.video || '')) ? String(p.src.video) : null, list = YT_LIST.test(String(p.src.list || '')) ? String(p.src.list) : null;
        if (!video && !list) return cb({ error: 'Geçersiz YouTube bağlantısı.' });
        g.ride.music = { video, list, playing: p.playing !== false, seq: ((old && old.seq) || 0) + 1, by: nameOf(u.id), at: Date.now() };
        io.to('rg:' + g.id).emit('grp:music', { gid: g.id, music: musicView(g.ride.music) });
        return cb({ ok: true, shared: true });
      }
      if (!old) return cb({ error: 'Paylaşılan müzik yok.' });
      const cmd = p.cmd === 'next' || p.cmd === 'prev' ? p.cmd : null;
      if (typeof p.playing === 'boolean') old.playing = p.playing; else if (!cmd) return cb({ error: 'Geçersiz komut.' });
      old.seq++; old.at = Date.now();
      io.to('rg:' + g.id).emit('grp:music', { gid: g.id, music: musicView(old), cmd: cmd || undefined });
      cb({ ok: true, shared: true });
    });
    socket.on('grp:unwatch', (p = {}) => { const g = memberOf(p && p.gid); if (g) socket.leave('rg:' + g.id); });

    // Konumu gruba paylaş. Yalnızca aktif sürüşte; açmak için istemci açık rıza bildirmek zorunda.
    socket.on('grp:share', (p = {}, cb) => {
      cb = ok(cb);
      const g = memberOf(p && p.gid); if (!g) return cb({ error: 'Grup bulunamadı.' });
      if (tooFast('share', 400)) return cb({ error: 'Çok sık deneme.' });
      if (p.on !== true) { stopShare(g, u.id, 'kullanıcı'); return cb({ ok: true, sharing: false }); }
      if (p.consent !== true) return cb({ error: 'Paylaşım için açık onay gerekli.' });
      const L = liveG.get(g.id);
      if (!g.ride || !L) return cb({ error: 'Aktif grup sürüşü yok.' });
      const old = L.m.get(u.id);
      if (old && old.sid !== socket.id) { const o = io.sockets.sockets.get(old.sid); if (o) { o.emit('grp:taken', { gid: g.id }); if (o.data.gshare) o.data.gshare.delete(g.id); } }
      if (!old) rec(g, ['e', Date.now(), 'share-on', uname(u), null]);
      const same = old && old.sid === socket.id;
      L.m.set(u.id, { sid: socket.id, lat: same ? old.lat : null, lon: same ? old.lon : null, acc: same ? old.acc : null, spd: same ? old.spd : null, est: same ? old.est : null, at: same ? old.at : 0,
        rt: same ? old.rt : null, fl: same ? old.fl : null, pend: null });
      (socket.data.gshare = socket.data.gshare || new Set()).add(g.id);
      g.ride.idleSince = Date.now();
      emitState(g, true);
      cb({ ok: true, sharing: true });
    });

    socket.on('grp:update', (p = {}) => {
      const g = memberOf(p && p.gid), L = g && liveG.get(g.id), e = L && L.m.get(u.id);
      if (!g || !g.ride || !e || e.sid !== socket.id) return;
      const lat = num(p.lat), lon = num(p.lon), acc = p.acc == null ? 0 : num(p.acc);
      if (lat == null || lon == null || Math.abs(lat) > 90 || Math.abs(lon) > 180 || acc == null || acc > MAX_ACC) return;
      const now = Date.now();
      if (e.at && now - e.at < MIN_GAP_MS) return;                           // gereksiz sıklıkta gönderim
      const sp = num(p.spd), spd = sp != null && sp >= 0 && sp <= 120 ? Math.round(sp * 10) / 10 : null;   // yalnızca cihazın ölçtüğü hız
      let est = null;                                                         // cihaz hız vermezse ardışık konumlardan tahmin (arayüzde «~» ile ayrılır)
      if (spd == null && e.lat != null && e.at && acc <= 50) { const dt = (now - e.at) / 1000; if (dt >= 2 && dt <= 30) { const v = hav(e.lat, e.lon, lat, lon) / dt; if (v < 60) est = Math.round(v * 10) / 10; } }
      e.lat = lat; e.lon = lon; e.acc = Math.round(acc); e.spd = spd; e.est = est; e.at = now;
      const rc = routeOf(g); e.rt = rc ? nearestOnRoute(rc, lat, lon, e.rt ? e.rt.i : null) : null;
      const name = uname(u), r = recs.get(g.id);
      rec(g, ['f', now, name, r5(lat), r5(lon), e.acc, spd, est]);
      if (r) { const m = r.members.get(name) || { n: 0, first: now, last: now }; m.n++; m.last = now; r.members.set(name, m); }
    });

    socket.on('disconnect', () => {
      if (!socket.data.gshare) return;
      for (const gid of [...socket.data.gshare]) { const g = db.groups[gid]; if (g) stopShare(g, u.id, 'bağlantı koptu'); }
    });
  });

  // Hesap silinirken: kullanıcı tüm gruplardan çıkar (lider ise devir, son üye ise grup kapanır)
  function removeUser(uid) { for (const g of Object.values(db.groups)) if (isMember(g, uid)) removeMember(g, uid, 'leave'); }
  return { removeUser, groupOf: gid => db.groups[String(gid)] || null, _db: db, _liveG: liveG, _recs: recs, _routeOf: routeOf, _tick: () => { const now = Date.now(); for (const g of Object.values(db.groups)) if (g.ride) { evalFlags(g, now); emitState(g, false); } }, _flush: () => { flushAllRecs(); flush(); } };
};
