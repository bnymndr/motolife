'use strict';
/* Sürüş analizi çekirdeği (saf mantık). Tarayıcıda window.AnalysisCore, Node'da require('./public/analysis-core.js').
   YENİ VERİ SİSTEMİ YOKTUR: yalnızca mevcut kayıtları okur ve ride-core.js'in AYNI kuralıyla (Recorder.replay) hesaplar.
     • bireysel sürüş  : {v:1,id,startedAt,endedAt,events,fixes}  (cihazda IndexedDB / sunucuda data/rides)
     • telemetri       : {meta,bins,evs} sürüşe kimlikle bağlı eş kayıt (telemetry-core.js biçimi)
     • grup sürüşü     : data/rgroup-rides/<grup>/<sürüş>.ndjson  (ridegroups.js başlığındaki biçim)
   Ölçülmeyen değer asla 0 yazılmaz: yoksa null döner ve arayüz «—» + nedenini gösterir.
   Hız kaynağı: 'd' = cihazın ölçtüğü GPS hızı, 'p' = ardışık konumlardan türetilmiş (daha kaba). */
(function (root) {
  const RC = typeof module !== 'undefined' && module.exports ? require('./ride-core.js') : root.RideCore;
  const TC = typeof module !== 'undefined' && module.exports ? require('./telemetry-core.js') : root.TelemetryCore;
  const MAX_SPEED = 83;
  const tr = (n, d) => (n == null || !isFinite(n) ? '—' : n.toLocaleString('tr-TR', { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 }));

  // ---------- Biçimleyiciler (null → «—») ----------
  const fmt = {
    dist: m => (m == null ? '—' : m >= 1000 ? tr(m / 1000, m >= 100000 ? 0 : 1) + ' km' : Math.round(m) + ' m'),
    dur: s => { if (s == null) return '—'; s = Math.round(s); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return h ? h + ' sa ' + String(m).padStart(2, '0') + ' dk' : m ? m + ' dk ' + String(x).padStart(2, '0') + ' sn' : x + ' sn'; },
    clock: s => { s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0'); },
    kmh: v => (v == null ? '—' : tr(v, 0) + ' km/sa'),
    date: t => (t ? new Date(t).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', weekday: 'short' }) : '—'),
    time: t => (t ? new Date(t).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }) : '—'),
    timeS: t => (t ? new Date(t).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—'),
    coord: (lat, lon) => (lat == null || lon == null ? '—' : tr(Math.abs(lat), 4) + '° ' + (lat >= 0 ? 'K' : 'G') + ', ' + tr(Math.abs(lon), 4) + '° ' + (lon >= 0 ? 'D' : 'B')),
    ms2: v => (v == null ? '—' : tr(v, 1) + ' m/s²'),
    lean: v => (v == null ? '—' : '≈ ' + Math.round(Math.abs(v)) + '° ' + (Math.abs(v) < 2 ? '' : v > 0 ? 'sol' : 'sağ') + ' (tahmini)')
  };
  const SEV = { b: ['orta', 'sert', 'acil'], a: ['orta', 'sert'] };

  // ---------- Yardımcılar ----------
  function lowerBound(a, x) { let lo = 0, hi = a.length; while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] < x) lo = m + 1; else hi = m; } return lo; }
  // t anına en yakın örnek dizini (boş dizi → -1)
  function nearestIdx(S, t) { const n = S.t.length; if (!n) return -1; const i = lowerBound(S.t, t); if (i <= 0) return 0; if (i >= n) return n - 1; return t - S.t[i - 1] <= S.t[i] - t ? i - 1 : i; }
  // t anındaki konum: ardışık iki örnek arası ≤15 sn ve ikinci örnek yeni referans değilse doğrusal ara değer; değilse en yakın örnek
  function posAt(S, t) {
    const n = S.t.length; if (!n) return null;
    const i = lowerBound(S.t, t);
    if (i > 0 && i < n && S.t[i] - S.t[i - 1] <= 15000 && !S.ref[i]) { const k = (t - S.t[i - 1]) / (S.t[i] - S.t[i - 1]); return { lat: S.lat[i - 1] + k * (S.lat[i] - S.lat[i - 1]), lon: S.lon[i - 1] + k * (S.lon[i] - S.lon[i - 1]), i: k < 0.5 ? i - 1 : i }; }
    const j = nearestIdx(S, t); return { lat: S.lat[j], lon: S.lon[j], i: j };
  }
  function distAt(S, t) { const n = S.t.length; if (!n) return null; const i = lowerBound(S.t, t); if (i <= 0) return S.d[0]; if (i >= n) return S.d[n - 1]; const k = (t - S.t[i - 1]) / (S.t[i] - S.t[i - 1]); return S.d[i - 1] + k * (S.d[i] - S.d[i - 1]); }
  function tAtDist(S, d) { const n = S.d.length; if (!n) return null; const i = lowerBound(S.d, d); if (i <= 0) return S.t[0]; if (i >= n) return S.t[n - 1]; const dd = S.d[i] - S.d[i - 1]; return dd > 0 ? S.t[i - 1] + (d - S.d[i - 1]) / dd * (S.t[i] - S.t[i - 1]) : S.t[i]; }
  function speedAt(S, t) { const i = nearestIdx(S, t); return i < 0 ? null : S.v[i]; }
  // Douglas-Peucker (harita çizgisi için; metre cinsinden düzlemsel yaklaşım)
  function simplify(pts, tolM, maxPts) {
    if (pts.length <= 2) return pts.map((_, i) => i);
    const my = 111320, keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
    const cosL = Math.cos(pts[0][0] * Math.PI / 180), stack = [[0, pts.length - 1]];
    const dseg = (p, a, b) => { const ax = (a[1] - p[1]) * my * cosL, ay = (a[0] - p[0]) * my, bx = (b[1] - p[1]) * my * cosL, by = (b[0] - p[0]) * my, dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy; const t = l2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2)) : 0; return Math.hypot(ax + t * dx, ay + t * dy); };
    while (stack.length) { const [s, e] = stack.pop(); let mx = 0, mi = -1; for (let i = s + 1; i < e; i++) { const d = dseg(pts[i], pts[s], pts[e]); if (d > mx) { mx = d; mi = i; } } if (mi > 0 && mx > tolM) { keep[mi] = 1; stack.push([s, mi], [mi, e]); } }
    let idx = []; for (let i = 0; i < pts.length; i++) if (keep[i]) idx.push(i);
    if (maxPts && idx.length > maxPts) return simplify(pts, tolM * 1.6, maxPts);
    return idx;
  }

  // ---------- Bireysel sürüş ----------
  // data: sürüş kaydı. tele: {meta,bins,evs} | null. Dönüş: seri nesnesi (aşağıdaki alanlar).
  function soloSeries(data, tele) {
    const rec = RC.Recorder.replay(data, { samples: true }), sum = rec.summary(data.endedAt), Sm = rec.samples, n = Sm.length;
    const o = { id: data.id, kind: 'solo', t0: data.startedAt, t1: data.endedAt, n, t: new Array(n), lat: new Array(n), lon: new Array(n), v: new Array(n), d: new Array(n), src: new Array(n), ref: new Array(n), sum, pauses: [], events: [], tele: null, quality: {} };
    let derived = 0, withV = 0;
    for (let i = 0; i < n; i++) {
      const s = Sm[i]; o.t[i] = s[0]; o.lat[i] = s[1]; o.lon[i] = s[2]; o.v[i] = s[3] != null && s[3] >= 0 && s[3] <= MAX_SPEED ? s[3] : null; o.d[i] = s[4]; o.src[i] = s[5]; o.ref[i] = s[6];
      if (o.v[i] != null) { withV++; if (s[5] === 'p') derived++; }
    }
    o.quality = { derivedPct: withV ? Math.round(derived / withV * 100) : null, rejectedAcc: sum.rejectedAcc, rejectedJump: sum.rejectedJump, gaps: sum.gaps, reanchors: sum.reanchors, limitReached: sum.limitReached };
    o.start = n ? { t: o.t[0], lat: o.lat[0], lon: o.lon[0] } : null; o.end = n ? { t: o.t[n - 1], lat: o.lat[n - 1], lon: o.lon[n - 1] } : null;
    // duraklatmalar
    let p0 = null; for (const [t, k] of data.events) { if (k === 'pause') p0 = t; else if ((k === 'resume' || k === 'end') && p0 != null) { o.pauses.push([p0, t]); p0 = null; } }
    // zaman çizelgesi
    const ev = o.events, add = (t, kind, label, extra) => { const p = n ? posAt(o, t) : null; ev.push(Object.assign({ t, kind, label, lat: p ? p.lat : null, lon: p ? p.lon : null }, extra || {})); };
    for (const [t, k] of data.events) add(t, k, { start: 'Sürüş başladı', pause: 'Duraklatıldı', resume: 'Devam edildi', end: 'Sürüş bitti' }[k]);
    data.fixes.forEach(f => { if (f[5] === 3) add(f[0], 'gap', 'GPS kesintisi / yeni referans (aradaki mesafe ölçülmedi)'); });
    if (sum.maxKmh != null && n) { let bi = -1, bd = 1e9; for (let i = 0; i < n; i++) if (o.v[i] != null) { const dd = Math.abs(o.v[i] * 3.6 - sum.maxKmh); if (dd < bd) { bd = dd; bi = i; } } if (bi >= 0 && bd < 1.5) add(o.t[bi], 'maxspeed', 'En yüksek hız · ' + fmt.kmh(sum.maxKmh), { v: sum.maxKmh }); }
    if (tele) o.tele = attachTele(o, tele, add);
    ev.sort((a, b) => a.t - b.t);
    return o;
  }
  // Telemetri eş kaydını bağla: seriler + olaylar + durum sınıflandırması
  function attachTele(S, tele, add) {
    const bins = Array.isArray(tele.bins) ? tele.bins : [], evs = Array.isArray(tele.evs) ? tele.evs : [], meta = tele.meta || {};
    const sm = TC.summarizeTele({ bins, evs, meta });
    const T = { meta, status: sm, lean: [], leanExt: [], aLon: [], aLat: [], yaw: [], evs: [], hasData: bins.length > 0 || evs.length > 0 };
    for (const r of bins) {
      if (r[5] != null && (r[9] & 4)) { T.lean.push([r[0], r[5]]); T.leanExt.push([r[0], r[6]]); }
      if (r[1] != null) T.aLon.push([r[0], r[1]]); if (r[3] != null) T.aLat.push([r[0], r[3]]); if (r[7] != null) T.yaw.push([r[0], r[7]]);
    }
    for (const e of evs) {
      const p = e[10] != null && e[11] != null ? { lat: e[10], lon: e[11] } : posAt(S, e[0]);
      const ev = { t: e[0], kind: e[1] === 'b' ? 'brake' : 'accel', sev: e[2], peak: e[3], durMs: e[4], v0: e[5], v1: e[6], src: e[8] === 'i' ? 'imu' : 'gps', flags: e[9], lat: p ? p.lat : null, lon: p ? p.lon : null };
      ev.label = (e[1] === 'b' ? 'Ani Frenleme' : 'Ani Hızlanma') + ' · ' + SEV[e[1]][e[2] - 1] + ' · ' + (e[1] === 'b' ? '−' : '+') + tr(e[3], 1) + ' m/s²' + (e[5] != null && e[6] != null ? ' · ' + Math.round(e[5] * 3.6) + ' → ' + Math.round(e[6] * 3.6) + ' km/sa' : '') + (e[8] === 'g' ? ' (GPS hız farkı)' : '');
      T.evs.push(ev); S.events.push(ev);
    }
    if (T.leanExt.length) {
      let m = T.leanExt[0]; for (const x of T.leanExt) if (Math.abs(x[1]) > Math.abs(m[1])) m = x;
      const p = posAt(S, m[0]); S.events.push({ t: m[0], kind: 'maxlean', label: 'En yüksek tahmini yatış · ' + fmt.lean(m[1]), lat: p ? p.lat : null, lon: p ? p.lon : null, lean: m[1] });
    }
    return T;
  }

  // ---------- İki sürüşü karşılaştır ----------
  function compareSolo(A, B) {
    const sa = A.sum, sb = B.sum, ta = A.tele && A.tele.hasData ? A.tele.status : null, tb = B.tele && B.tele.hasData ? B.tele.status : null;
    const row = (key, label, a, b, f, note) => ({ key, label, a: a == null ? null : a, b: b == null ? null : b, f, delta: a != null && b != null ? b - a : null, pct: a != null && b != null && a !== 0 ? (b - a) / Math.abs(a) * 100 : null, note: note || null });
    return [
      row('dist', 'Mesafe', sa.distM, sb.distM, 'dist'), row('dur', 'Aktif Süre', sa.durationS, sb.durationS, 'dur'), row('mov', 'Hareket Süresi', sa.movingS, sb.movingS, 'dur'),
      row('avgm', 'Ort. Hız (hareket)', sa.avgMovingKmh, sb.avgMovingKmh, 'kmh'), row('avgt', 'Ort. Hız (toplam)', sa.avgTotalKmh, sb.avgTotalKmh, 'kmh'), row('max', 'Maks. Hız', sa.maxKmh, sb.maxKmh, 'kmh'),
      row('pause', 'Duraklatma', sa.pausedS, sb.pausedS, 'dur'),
      row('brk', 'Ani Frenleme', ta ? ta.events.brake.n : null, tb ? tb.events.brake.n : null, 'n', ta && tb ? null : 'Sensör/GPS olay verisi iki sürüşte de yoksa karşılaştırılmaz'),
      row('acc', 'Ani Hızlanma', ta ? ta.events.accel.n : null, tb ? tb.events.accel.n : null, 'n', ta && tb ? null : 'Sensör/GPS olay verisi iki sürüşte de yoksa karşılaştırılmaz'),
      row('leanL', 'En Yüksek Yatış, Sol (tahmini)', ta && ta.lean.state === 'estimated' ? ta.lean.leftMax : null, tb && tb.lean.state === 'estimated' ? tb.lean.leftMax : null, 'deg'),
      row('leanR', 'En Yüksek Yatış, Sağ (tahmini)', ta && ta.lean.state === 'estimated' ? ta.lean.rightMax : null, tb && tb.lean.state === 'estimated' ? tb.lean.rightMax : null, 'deg')
    ];
  }

  // ---------- Grup sürüşü (ridegroups.js NDJSON) ----------
  const PALETTE = ['#EA8621', '#4FA3E0', '#5CC48E', '#E8675D', '#B58CF0', '#F2C94C', '#4DD0C8', '#F28BB0', '#9DB2C0', '#C0A37A'];
  function parseGroupRide(text) {
    const lines = String(text || '').split('\n').filter(Boolean); if (!lines.length) return null;
    let head; try { head = JSON.parse(lines[0]); } catch { return null; }
    if (!head || head.k !== 'h') return null;
    const members = new Map(), events = [], routes = [];
    let endT = null, lastT = head.startedAt, route = Array.isArray(head.route) ? head.route : null;
    const leaderTl = [[head.startedAt, head.leader]];
    const M = u => { let m = members.get(u); if (!m) { m = { u, rec: null, status: 'new', alerts: { behind: 0, away: 0, off: 0 }, flagged: [], fixes: 0, first: null, last: null }; members.set(u, m); } return m; };
    for (const u of head.members || []) M(u);
    const startRec = (m, t) => { if (!m.rec) { m.rec = new RC.Recorder('r_group' + m.u.replace(/[^a-z0-9]/gi, '').slice(0, 12).padEnd(8, 'x')); m.rec.samples = []; } if (m.rec.status === 'idle') m.rec.start(t); else if (m.rec.status === 'paused') m.rec.resume(t); };
    for (let i = 1; i < lines.length; i++) {
      let r; try { r = JSON.parse(lines[i]); } catch { continue; }                  // yarım yazılmış son satır
      if (!Array.isArray(r)) continue;
      const t = r[1]; if (typeof t === 'number') lastT = Math.max(lastT, t);
      if (r[0] === 'f') {
        const m = M(r[2]); if (!m.rec || m.rec.status === 'idle') startRec(m, t);
        if (m.rec.status === 'active') { m.rec.addFix({ t, lat: r[3], lon: r[4], acc: r[5], speed: r[6] }); m.fixes++; m.first = m.first == null ? t : m.first; m.last = t; }
      } else if (r[0] === 'e') {
        const kind = r[2], u = r[3], extra = r[4];
        if (kind === 'share-on' && u) { const m = M(u); startRec(m, t); }
        else if (kind === 'share-off' && u) { const m = members.get(u); if (m && m.rec && m.rec.status === 'active') m.rec.pause(t); }
        else if (kind === 'leader' && u) leaderTl.push([t, u]);
        else if (kind === 'end') endT = t;
        else if (kind.startsWith('alert-') && u && kind !== 'alert-clear') { const m = M(u), f = kind.slice(6); if (m.alerts[f] != null) { m.alerts[f]++; m.flagged.push([t, f, extra]); } }
        events.push({ t, kind, u: u || null, extra: extra == null ? null : extra });
      } else if (r[0] === 'r') { route = Array.isArray(r[2]) ? r[2] : null; routes.push([t, route]); events.push({ t, kind: 'route', u: null, extra: route ? route.length : null }); }
    }
    const tEnd = endT || lastT;
    for (const m of members.values()) {
      if (m.rec && m.rec.status !== 'idle' && m.rec.status !== 'ended') m.rec.end(Math.max(tEnd, m.rec.activeSince || 0));
      m.sum = m.rec && m.rec.samples && m.rec.samples.length ? m.rec.summary(tEnd) : null;
      const Sm = m.rec && m.rec.samples ? m.rec.samples : []; const n = Sm.length;
      m.S = { t: new Array(n), lat: new Array(n), lon: new Array(n), v: new Array(n), d: new Array(n), src: new Array(n), ref: new Array(n) };
      for (let i = 0; i < n; i++) { const s = Sm[i]; m.S.t[i] = s[0]; m.S.lat[i] = s[1]; m.S.lon[i] = s[2]; m.S.v[i] = s[3] != null && s[3] <= MAX_SPEED ? s[3] : null; m.S.d[i] = s[4]; m.S.src[i] = s[5]; m.S.ref[i] = s[6]; }
      m.start = n ? { t: m.S.t[0], lat: m.S.lat[0], lon: m.S.lon[0] } : null; m.end = n ? { t: m.S.t[n - 1], lat: m.S.lat[n - 1], lon: m.S.lon[n - 1] } : null;
    }
    const list = [...members.values()].map((m, i) => Object.assign(m, { color: PALETTE[i % PALETTE.length] }));
    // lider ile mesafe (5 sn ızgarada; iki konum da ≤15 sn tazelikteyse)
    const leaderAt = t => { let l = leaderTl[0][1]; for (const [lt, u] of leaderTl) if (lt <= t) l = u; return l; };
    const gap = new Map();
    for (const m of list) {
      const ser = [];
      for (let t = head.startedAt; t <= tEnd; t += 5000) {
        const L = members.get(leaderAt(t)); if (m.u === (L && L.u) || !L || !L.S.t.length || !m.S.t.length) { ser.push([t, null]); continue; }
        const a = freshPos(m.S, t), b = freshPos(L.S, t);
        ser.push([t, a && b ? Math.round(RC.haversine(a.lat, a.lon, b.lat, b.lon)) : null]);
      }
      gap.set(m.u, ser);
    }
    let routeLen = null; if (route && route.length > 1) { routeLen = 0; for (let i = 1; i < route.length; i++) routeLen += RC.haversine(route[i - 1][0], route[i - 1][1], route[i][0], route[i][1]); }
    return { id: head.rideId, groupId: head.groupId, name: head.groupName, startedAt: head.startedAt, endedAt: endT, open: !endT, tEnd, leader: head.leader, leaders: leaderTl, members: list, events, route, routeLen, routes, gap, gapM: head.gap || null };
  }
  // yalnızca iki komşu örnek ≤15 sn arayla ve ikinci yeni referans değilse konum; aksi halde null (eski konumla mesafe uydurulmaz)
  function freshPos(S, t) { const n = S.t.length; if (!n) return null; const i = lowerBound(S.t, t); if (i <= 0 || i >= n) return null; if (S.t[i] - S.t[i - 1] > 15000 || S.ref[i]) return null; const k = (t - S.t[i - 1]) / (S.t[i] - S.t[i - 1]); return { lat: S.lat[i - 1] + k * (S.lat[i] - S.lat[i - 1]), lon: S.lon[i - 1] + k * (S.lon[i] - S.lon[i - 1]) }; }

  const api = { fmt, SEV, PALETTE, lowerBound, nearestIdx, posAt, distAt, tAtDist, speedAt, simplify, soloSeries, attachTele, compareSolo, parseGroupRide, freshPos, MAX_SPEED };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.AnalysisCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
