'use strict';
// Moto Life — My Moto motosiklet rengi. Fotoğraf dosyası DEĞİŞMEZ: boyalı gövde bölgesinin (public/motos/<tip>.m.webp maskesi)
// tonu/doygunluğu çalışma anında değiştirilir, parlaklık (gölge/yansıma) korunur. Orijinal = fotoğrafın kendisi.
(function (root) {
  const COLORS = [
    { k: 'orijinal', n: 'Orijinal', c: null },
    { k: 'siyah', n: 'Siyah', c: '#1b1f25' },
    { k: 'turuncu', n: 'Turuncu', c: '#ea8621', h: 24, s: .95 },
    { k: 'mavi', n: 'Mavi', c: '#2f6fd0', h: 214, s: .88 },
    { k: 'kirmizi', n: 'Kırmızı', c: '#c8312b', h: 356, s: .85 },
    { k: 'yesil', n: 'Yeşil', c: '#2e9b52', h: 140, s: .62 }
  ];
  const sm = (x, a, b) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  function toHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn; let h = 0, s = 0;
    if (d) { s = d / (1 - Math.abs(2 * l - 1) + 1e-9); h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60; if (h < 0) h += 360; }
    return [h, s, l];
  }
  function toRgb(h, s, l) {
    const c = (1 - Math.abs(2 * l - 1)) * s, hp = (((h % 360) + 360) % 360) / 60, x = c * (1 - Math.abs(hp % 2 - 1)), m = l - c / 2;
    const [r, g, b] = hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x] : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
    return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
  }
  // px: RGBA dizisi (yerinde değişir), mk: maske RGBA (kırmızı kanal = ağırlık), col: COLORS öğesi
  function apply(px, mk, col) {
    if (!col || !col.k || col.k === 'orijinal') return px;
    for (let i = 0; i < px.length; i += 4) {
      const w = mk[i] / 255; if (w < .004) continue;
      const [h, , l] = toHsl(px[i], px[i + 1], px[i + 2]); let o;
      if (col.k === 'siyah') o = toRgb(h, 0, .92 * Math.pow(l, 1.8));
      else { const f = (1 - sm(l, .72, .98)) * sm(l, .02, .14), l2 = Math.min(1, .10 + .82 * Math.pow(l, 1.15)) * (col.k === 'mavi' ? .92 : 1); o = toRgb(col.h, col.s * f, l2); }
      px[i] += (o[0] - px[i]) * w; px[i + 1] += (o[1] - px[i + 1]) * w; px[i + 2] += (o[2] - px[i + 2]) * w;
    }
    return px;
  }
  const load = u => new Promise((ok, no) => { const i = new root.Image(); i.onload = () => ok(i); i.onerror = no; i.src = u; });
  const cache = {}, maskCache = {};
  // Dönen değer: Promise<blob adresi>; orijinalde null (fotoğraf aynen kalır)
  async function url(type, key) {
    const col = COLORS.find(c => c.k === key); if (!col || col.k === 'orijinal') return null;
    const ck = type + ':' + col.k; if (cache[ck]) return cache[ck];
    const [im, mk] = await Promise.all([load('/motos/' + type + '.webp'), maskCache[type] || (maskCache[type] = load('/motos/' + type + '.m.webp'))]);
    const w = im.naturalWidth, h = im.naturalHeight, cv = root.document.createElement('canvas'); cv.width = w; cv.height = h;
    const x = cv.getContext('2d', { willReadFrequently: true }); x.drawImage(im, 0, 0); const d = x.getImageData(0, 0, w, h);
    const cm = root.document.createElement('canvas'); cm.width = w; cm.height = h; const mx = cm.getContext('2d', { willReadFrequently: true }); mx.drawImage(mk, 0, 0, w, h);
    apply(d.data, mx.getImageData(0, 0, w, h).data, col); x.putImageData(d, 0, 0);
    const blob = await new Promise(ok => cv.toBlob(ok, 'image/png')); return (cache[ck] = root.URL.createObjectURL(blob));
  }
  const api = { COLORS, apply, url };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.BikeColor = api;
})(typeof window !== 'undefined' ? window : globalThis);
