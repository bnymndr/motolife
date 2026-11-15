'use strict';
/* Gecikme ölçer (cihaz testi için): olay işaretleri arasındaki süreyi ölçer ve bütçeyle karşılaştırır. Saf mantık; zaman dışarıdan
   (performance.now). Gerçek Bluetooth HFP/A2DP geçişi cihazda ölçülür; bu araç yalnız ÖLÇÜM yapar, sonucu uydurmaz.
   Kullanım: mark('call_start'); ... mark('music_paused'); measure('call_start','music_paused'). */
(function (root) {
  const BUDGET = { 'call_start>music_paused': 300, 'call_start>phone_audible': 1500, 'call_end>group_audible': 800, 'call_end>music_audible': 1500, 'offline>reconnected': 15000 };
  function create({ now = () => Date.now() } = {}) {
    const marks = {}, runs = [];
    return {
      mark(name) { marks[name] = now(); },
      measure(a, b) { if (marks[a] == null || marks[b] == null) return null; const ms = marks[b] - marks[a]; const key = a + '>' + b, bud = BUDGET[key] != null ? BUDGET[key] : null; const r = { key, ms, budget: bud, pass: bud == null ? null : ms <= bud }; runs.push(r); return r; },
      report() { const by = {}; runs.forEach(r => (by[r.key] = by[r.key] || []).push(r.ms)); return Object.keys(by).map(k => { const a = by[k].slice().sort((x, y) => x - y); return { key: k, n: a.length, min: a[0], median: a[Math.floor(a.length / 2)], max: a[a.length - 1], budget: BUDGET[k] != null ? BUDGET[k] : null, pass: BUDGET[k] == null ? null : a[a.length - 1] <= BUDGET[k] }; }); },
      reset() { Object.keys(marks).forEach(k => delete marks[k]); runs.length = 0; },
    };
  }
  const api = { create, BUDGET };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.RouteProbe = api;
})(typeof window !== 'undefined' ? window : globalThis);
