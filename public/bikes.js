'use strict';
// Moto Life — motosiklet tipleri ve My Moto görselleri. Tip seçilmediyse model adından ipucu alınır; bulunamazsa görsel gösterilmez.
// 10 tip, her biri kullanıcının verdiği özgün fotoğraf (public/motos/<tip>.webp, yalnızca üstteki yazı kartı kırpıldı). Eski tipler: sport→supersport, classic→retro, enduro→motocross.
(function (root) {
  const TYPES = { supersport: 'Supersport', sporttouring: 'Sport Touring', naked: 'Naked', adventure: 'Adventure', touring: 'Touring', cruiser: 'Cruiser', cafe: 'Cafe Racer', retro: 'Standard / Retro', motocross: 'Motocross', scooter: 'Scooter' };
  const LEGACY = { sport: 'supersport', classic: 'retro', enduro: 'motocross' };   // eski kayıtlar yeni tiplere eşlenir
  const HINT = [[/gs|tenere|africa|versys|multistrada|tiger|desert|adv|dl\s?\d/i, 'adventure'], [/mt-|z\d{3}|monster|duke|street|speed|xsr|cb\d|hornet|svartpilen|mt\d/i, 'naked'], [/r1|r6|cbr|gsx-r|ninja|panigale|rsv|s1000rr|zx/i, 'supersport'], [/xmax|pcx|nmax|vespa|forza|sh\d|burgman|agility|scooter/i, 'scooter'], [/gold ?wing|rt|k1600|tracer|road glide|t-max/i, 'touring'], [/sportster|iron|fat|dyna|vulcan|rebel|shadow|boulevard|meteor/i, 'cruiser'], [/crf|exc|wr\d|kx|yz|rmz/i, 'motocross']];
  function typeOf(o) { const t = o && o.type; if (TYPES[t]) return t; if (LEGACY[t]) return LEGACY[t]; const m = HINT.find(h => h[0].test(String(o && o.model || ''))); return m ? m[1] : ''; }
  const src = o => { const t = typeOf(o); return t ? '/motos/' + t + '.webp' : ''; };
  const api = { TYPES, typeOf, src };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Bikes = api;
})(typeof window !== 'undefined' ? window : globalThis);
