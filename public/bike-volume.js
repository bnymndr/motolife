'use strict';
// Moto Life — My Moto hacimli (3B) motosiklet: kütüphanesiz, tuval üzerinde katman+dilim işleme.
// İki ailesi var: yan katmanlar (z düzlemleri, public/bike3d/<tip>-<k>.webp — kalınlık haritasına göre aşındırılmış gövde)
// ve ön/arka dilimler (x düzlemleri, public/bike3d/<tip>-sl.webp — her sütunun kesiti). Açıya göre ikisi arasında yumuşak geçilir;
// böylece yandan, önden ve arkadan bakınca ince karton değil hacimli bir gövde görünür. Gerçek 3B model DEĞİLDİR (çizimden türetilmiş yaklaşık hacim).
(function (root) {
  const K = 7, STEP = 1.6, NSL = 84, D = K * 3.2, TW = 72, R = 1.6, PAD = 14;
  const smooth = x => { x = x < 0 ? 0 : x > 1 ? 1 : x; return x * x * (3 - 2 * x); };
  const load = src => new Promise((ok, no) => { const i = new Image(); i.decoding = 'async'; i.onload = () => ok(i); i.onerror = () => no(new Error('yüklenemedi: ' + src)); i.src = src; });
  // Çizim çekirdeği (DOM'dan bağımsız; test edilebilir): ctx, boyutlar, açı → tuvale çizer
  function paint(ctx, o) {
    const { w, h, dpr, ang, center, layers, slices } = o, c = Math.cos(ang), s = Math.sin(ang), cx = PAD + w / 2;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.globalAlpha = 1; ctx.clearRect(0, 0, w + PAD * 2, h + 8);
    const rx = (Math.abs(c) * w / 2 + Math.abs(s) * D) * 0.92, g = ctx.createRadialGradient(cx, h - 1, 0, cx, h - 1, rx);
    g.addColorStop(0, 'rgba(0,0,0,.5)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.save(); ctx.translate(0, h - 1); ctx.scale(1, 0.1); ctx.translate(0, -(h - 1)); ctx.fillStyle = g; ctx.fillRect(cx - rx, h - 1 - rx, rx * 2, rx * 2); ctx.restore();
    const fold = Math.acos(Math.min(1, Math.abs(c))) * 180 / Math.PI, wS = 1 - smooth((fold - 52) / 26);   // 1 = yan katmanlar (≤52°), 0 = ön/arka dilimler (≥78°)
    if (wS < 0.98 && slices) {
      const it = []; for (let i = 0; i < NSL; i++) { const xi = ((i + 0.5) / NSL - 0.5) * w; it.push([-xi * s, i, xi]); }
      it.sort((a, b) => a[0] - b[0]); ctx.globalAlpha = 1 - wS;
      for (const [, i, xi] of it) { ctx.setTransform(dpr * s, 0, 0, dpr, dpr * (cx + xi * c), 0); ctx.drawImage(slices, i * TW, 0, TW, slices.height, -D, 0, D * 2, h); }
    }
    if (wS > 0.02) {
      const it = [[0, 0, center]]; for (let j = 1; j <= K * 2; j++) { const im = layers[Math.ceil(j / 2) - 1]; if (im) for (const sg of [1, -1]) it.push([sg * j * STEP, sg * j * STEP, im]); }
      it.sort((a, b) => a[0] * c - b[0] * c); ctx.globalAlpha = wS;
      for (const [, z, im] of it) { ctx.setTransform(dpr * c, 0, 0, dpr, dpr * (cx + z * s), 0); ctx.drawImage(im, -w / 2, 0, w, h); }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1;
  }
  // host: .tt-spin öğesi (içinde merkez <img>). Başarısızlıkta null döner (CSS dönüşü yedek).
  function mount(host, o) {
    const img = o.center, cv = root.document.createElement('canvas'), ctx = cv.getContext && cv.getContext('2d'); if (!ctx) return null;
    let alive = true, paused = false, raf = 0, ang = 0.5, last = 0, ready = false, layers = [], slices = null, w = 0, h = 0, dpr = 1;
    cv.className = 'bv'; cv.setAttribute('aria-hidden', 'true'); cv.style.cssText = 'position:absolute;left:' + -PAD + 'px;top:0;pointer-events:none;opacity:0;transition:opacity .25s';
    host.appendChild(cv);
    const still = () => root.document.documentElement.hasAttribute('data-rm') || (root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);
    function size() {
      const asp = (img.naturalWidth || 788) / (img.naturalHeight || 522); w = Math.min(185, 112 * asp); h = w / asp; dpr = Math.min(2, root.devicePixelRatio || 1);
      host.style.width = w + 'px'; host.style.height = h + 'px'; cv.width = Math.round((w + PAD * 2) * dpr); cv.height = Math.round((h + 8) * dpr); cv.style.width = (w + PAD * 2) + 'px'; cv.style.height = (h + 8) + 'px';
    }
    const frame = () => paint(ctx, { w, h, dpr, ang, center: img, layers, slices });
    function loop(t) {
      if (!alive) return; raf = 0;
      if (!cv.offsetParent || root.document.hidden) { raf = root.setTimeout(() => loop(root.performance.now()), 400); return; }   // ekranda değilken çizme
      const dt = last ? Math.min(0.1, (t - last) / 1000) : 0; last = t;
      if (!still() && !paused) ang = (ang + dt * Math.PI * 2 / 16) % (Math.PI * 2);
      frame(); raf = root.requestAnimationFrame(loop);
    }
    const start = () => { if (!alive) return; size(); ready = true; cv.style.opacity = '1'; img.style.opacity = '0'; frame(); last = 0; raf = root.requestAnimationFrame(loop); };
    const k = o.key, base = '/bike3d/' + k;
    Promise.all([...Array.from({ length: K }, (_, i) => load(base + '-' + (i + 1) + '.webp')), load(base + '-sl.webp')]).then(r => { layers = r.slice(0, K); slices = r[K]; (img.complete && img.naturalWidth ? Promise.resolve() : new Promise(ok => { img.onload = ok; img.onerror = ok; })).then(start); }).catch(() => { if (alive && o.onFail) o.onFail(); });
    return { destroy() { alive = false; if (raf) { root.cancelAnimationFrame(raf); root.clearTimeout(raf); } cv.remove(); img.style.opacity = ''; }, redraw() { if (ready) { size(); frame(); } }, setAngle(a) { paused = true; ang = a; if (ready) frame(); } };
  }
  const api = { mount, paint, K, NSL, D, TW };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.BikeVolume = api;
})(typeof window !== 'undefined' ? window : globalThis);
