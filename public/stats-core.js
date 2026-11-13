'use strict';
/* Ana sayfa istatistik çekirdeği (tarayıcı + Node ortak). Yeni veri sistemi YOK: mevcut sürüş özetleri (distM, startedAt) ve
   telemetri özetlerinden (TC.summarizeTele çıktısı) hesaplanır.
   Girdi satırı: { startedAt (ms), distM (m|null), tele (summarizeTele çıktısı|null) }.
   SÜRÜŞ PUANI (TAHMİNİ, eşikler gerçek sürüşle ayarlanmadı): yalnızca ivme olayı ölçülebilen (sensör veya GPS) ve ≥2 km olan sürüşler puanlanır.
     ağırlıklı olay = orta×1 + sert×2,5 + acil×5 (fren + hızlanma); puan = 100 − 8 × (ağırlıklı olay / 10 km), 0–100 arası.
   Genel puan = mesafeyle ağırlıklı ortalama. Puanlanamayan sürüş 0 sayılmaz; puandan hariç tutulur. */
(function (root) {
  const DAYS = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'], MONTHS = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
  const W = [1, 2.5, 5], MIN_KM = 2;
  function dayStart(t) { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); }
  function weekStart(t) { const d = new Date(dayStart(t)); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.getTime(); }   // Pazartesi 00:00 (yerel)
  function monthStart(t) { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), 1).getTime(); }
  const km = r => (r && r.distM > 0 ? r.distM / 1000 : 0);
  const sumKm = (rs, a, b) => rs.reduce((s, r) => (r.startedAt >= a && r.startedAt < b ? s + km(r) : s), 0);

  // Puan: null = puanlanamaz (neden: sensör/olay verisi yok ya da sürüş çok kısa)
  function rideScore(r) {
    const k = km(r), t = r && r.tele;
    if (!t || !t.events || k < MIN_KM) return null;
    const measured = (t.aLon && t.aLon.secs > 0) || t.events.brake.n + t.events.accel.n > 0;
    if (!measured) return null;
    let w = 0; for (const o of [t.events.brake, t.events.accel]) for (let i = 0; i < 3; i++) w += (o.sev[i] || 0) * W[i];
    return Math.round(Math.max(0, Math.min(100, 100 - 8 * (w / (k / 10)))));
  }
  function overall(rs, trendN) {
    const sc = rs.map(r => ({ r, s: rideScore(r) })).filter(x => x.s != null).sort((a, b) => a.r.startedAt - b.r.startedAt);
    if (!sc.length) return { score: null, n: 0, of: rs.length, trend: [] };
    const dist = sc.reduce((s, x) => s + km(x.r), 0), score = Math.round(sc.reduce((s, x) => s + x.s * km(x.r), 0) / dist);
    return { score, n: sc.length, of: rs.length, trend: sc.slice(-(trendN || 12)).map(x => ({ t: x.r.startedAt, s: x.s })) };
  }
  function totals(rs, now) {
    const w0 = weekStart(now), m0 = monthStart(now), pw0 = w0 - 7 * 864e5, pm = new Date(m0); pm.setMonth(pm.getMonth() - 1);
    return { weekKm: sumKm(rs, w0, Infinity), prevWeekKm: sumKm(rs, pw0, w0), monthKm: sumKm(rs, m0, Infinity), prevMonthKm: sumKm(rs, pm.getTime(), m0),
      weekRides: rs.filter(r => r.startedAt >= w0).length, monthRides: rs.filter(r => r.startedAt >= m0).length };
  }
  // 'week': bu haftanın 7 günü (Pzt–Paz); 'month': son 6 ay
  function buckets(rs, mode, now) {
    if (mode === 'month') {
      const out = [], base = new Date(monthStart(now));
      for (let i = 5; i >= 0; i--) { const a = new Date(base.getFullYear(), base.getMonth() - i, 1), b = new Date(a.getFullYear(), a.getMonth() + 1, 1); out.push({ label: MONTHS[a.getMonth()], km: sumKm(rs, a.getTime(), b.getTime()), current: i === 0, future: false }); }
      return out;
    }
    const w0 = weekStart(now), today = dayStart(now), out = [];
    for (let i = 0; i < 7; i++) { const a = new Date(w0); a.setDate(a.getDate() + i); const b = new Date(a); b.setDate(b.getDate() + 1); out.push({ label: DAYS[i], km: sumKm(rs, a.getTime(), b.getTime()), current: a.getTime() === today, future: a.getTime() > today }); }
    return out;
  }
  const api = { weekStart, monthStart, dayStart, rideScore, overall, totals, buckets, MIN_KM };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.StatsCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
