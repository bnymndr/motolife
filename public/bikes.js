'use strict';
// Moto Life — motosiklet tipleri ve My Moto görselleri. Tip seçilmediyse model adından ipucu alınır; bulunamazsa görsel gösterilmez.
// Görseli olmayan tipler en yakın görseli kullanır: touring → adventure, classic → cruiser.
(function (root) {
  const TYPES = { sport: 'Sport', naked: 'Naked', touring: 'Touring', cruiser: 'Cruiser', adventure: 'Adventure', scooter: 'Scooter', classic: 'Klasik', enduro: 'Enduro / Cross' };
  const IMG = { sport: 'sport', naked: 'naked', touring: 'adventure', cruiser: 'cruiser', adventure: 'adventure', scooter: 'scooter', classic: 'cruiser', enduro: 'enduro' };
  const HINT = [[/gs|tenere|africa|versys|multistrada|tiger|desert|adv|dl\s?\d/i, 'adventure'], [/mt-|z\d{3}|monster|duke|street|speed|xsr|cb\d|hornet|svartpilen|mt\d/i, 'naked'], [/r1|r6|cbr|gsx-r|ninja|panigale|rsv|s1000rr|zx/i, 'sport'], [/xmax|pcx|nmax|vespa|forza|sh\d|burgman|agility|scooter/i, 'scooter'], [/gold ?wing|rt|k1600|tracer|road glide|t-max/i, 'touring'], [/sportster|iron|fat|dyna|vulcan|rebel|shadow|boulevard|meteor/i, 'cruiser'], [/crf|exc|wr\d|kx|yz|rmz/i, 'enduro']];
  function typeOf(o) { if (o && TYPES[o.type]) return o.type; const m = HINT.find(h => h[0].test(String(o && o.model || ''))); return m ? m[1] : ''; }
  const src = o => { const t = typeOf(o); return t ? '/bike-' + IMG[t] + '.webp' : ''; };
  const layerKey = t => IMG[t] || '';
  const api = { TYPES, typeOf, src, layerKey };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Bikes = api;
})(typeof window !== 'undefined' ? window : globalThis);
