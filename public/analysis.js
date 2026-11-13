const accentC = () => { try { return getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#EA8621'; } catch { return '#EA8621'; } };
/* Sürüş analizi ve istatistik ekranı. window.Analysis.mount(root, { user }). index.html'deki «Analiz» sekmesi yükler.
   Veri KAYNAKLARI mevcut kayıtlardır (yeni veri sistemi yok): cihazdaki sürüşler (RideStore), sunucudaki sürüşler (/api/rides),
   telemetri eş kaydı (RideStore.loadTele · /api/rides/:id/tele), grup sürüşü kayıtları (/api/rgroups/:id/rides). Hesap analysis-core.js'te.
   Ölçülmeyen değer sıfır/gerçek değer gibi gösterilmez: «—» ve nedeni yazılır; yatış açısı her yerde «tahmini» etiketlidir.
   Grafikler kendi SVG bileşenimizdir (harici kütüphane yok); harita Leaflet'tir, yüklenemezse çizgi tabanlı yedek gösterilir. */
(function () {
  'use strict';
  const AC = window.AnalysisCore, RC = window.RideCore, TC = window.TelemetryCore, fmt = AC.fmt, REASON = TC.REASON_TR || {};
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const n1 = (v, d) => (v == null || !isFinite(v) ? '—' : v.toLocaleString('tr-TR', { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 }));
  const STATE = { measured: ['Ölçülen', 'm'], estimated: ['Tahmini', 'e'], unavailable: ['Veri yok', 'u'], unsupported: ['Desteklenmiyor', 'x'] };
  const badge = (s, r) => `<span class="an-tb ${(STATE[s] || STATE.unavailable)[1]}">${(STATE[s] || STATE.unavailable)[0]}</span>${r ? ' <small>' + esc(REASON[r] || r) + '</small>' : ''}`;
  const RAMP = [[0, [59, 130, 246]], [40, [34, 197, 94]], [80, [234, 179, 8]], [110, [249, 115, 22]], [140, [239, 68, 68]]];
  function speedColor(k) { if (k == null) return '#7C8B97'; if (k <= 0) return 'rgb(59,130,246)'; for (let i = 1; i < RAMP.length; i++) if (k <= RAMP[i][0]) { const a = RAMP[i - 1], b = RAMP[i], t = (k - a[0]) / (b[0] - a[0]); return 'rgb(' + a[1].map((x, j) => Math.round(x + t * (b[1][j] - x))).join(',') + ')'; } return 'rgb(239,68,68)'; }
  const LEAFLET = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.';
  let leafletP = null, cfgP = null;
  function ensureLeaflet() {
    if (window.L && window.L.map) return Promise.resolve();
    if (leafletP) return leafletP;
    leafletP = new Promise((res, rej) => {
      if (!document.getElementById('mm-leaflet-css')) { const l = document.createElement('link'); l.id = 'mm-leaflet-css'; l.rel = 'stylesheet'; l.href = LEAFLET + 'css'; l.crossOrigin = 'anonymous'; document.head.appendChild(l); }
      const s = document.createElement('script'); s.src = LEAFLET + 'js'; s.crossOrigin = 'anonymous';
      s.onload = () => (window.L && window.L.map ? res() : (leafletP = null, rej(new Error('Leaflet hazır değil'))));
      s.onerror = () => { leafletP = null; s.remove(); rej(new Error('Leaflet yüklenemedi')); };
      document.head.appendChild(s);
    });
    return leafletP;
  }
  const mapCfg = () => cfgP || (cfgP = fetch('/api/maps/config', { credentials: 'same-origin' }).then(r => (r.ok ? r.json() : Promise.reject(new Error('cfg')))).catch(e => { cfgP = null; throw e; }));

  /* ====================== SVG çizgi grafiği ====================== */
  function stepFor(span, max) { const steps = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 14400]; for (const s of steps) if (span / s <= max) return s; return 14400; }
  function niceStep(span, max) { const raw = span / max, mag = Math.pow(10, Math.floor(Math.log10(raw || 1))), f = raw / mag; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * mag; }
  class Chart {
    // o: { h, yFmt, xFmt, timeX (x saniye: zaman eksenli), gapX (bu kadar boşlukta çizgi kopar), zeroLine, yMin, yMax, label }
    constructor(host, o) {
      this.o = Object.assign({ h: 190, yFmt: v => n1(v), xFmt: v => n1(v), gapX: 0, zeroLine: false, yMin: null, yMax: null, label: '' }, o || {});
      this.host = host; host.classList.add('an-chart'); this.series = []; this.bands = []; this.marks = []; this.view = null; this.cx = null; this.cbs = [];
      host.innerHTML = `<svg class="an-svg" role="img" aria-label="${esc(this.o.label)}"></svg><div class="an-ctip" hidden></div><div class="an-zoom"><button type="button" data-z="pl" aria-label="Sola Kaydır" hidden>‹</button><button type="button" data-z="pr" aria-label="Sağa Kaydır" hidden>›</button><button type="button" data-z="in" aria-label="Yakınlaştır">+</button><button type="button" data-z="out" aria-label="Uzaklaştır">−</button><button type="button" data-z="all" aria-label="Tümünü Göster">⤢</button></div>`;
      this.svg = host.querySelector('svg'); this.tip = host.querySelector('.an-ctip');
      const move = e => { const r = this.svg.getBoundingClientRect(); this.setCursor(this.xOf(e.clientX - r.left)); };
      this.svg.addEventListener('pointermove', move); this.svg.addEventListener('pointerdown', move);
      host.querySelector('.an-zoom').addEventListener('click', e => { const b = e.target.closest('[data-z]'); if (b) this.zoom(b.dataset.z); });
      this.ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => { if (host.clientWidth !== this.w) this.draw(); }) : null; if (this.ro) this.ro.observe(host);
    }
    destroy() { if (this.ro) this.ro.disconnect(); }
    onCursor(f) { this.cbs.push(f); }
    setData(series, ex) {
      this.series = series.filter(Boolean); ex = ex || {}; this.bands = ex.bands || []; this.marks = ex.marks || [];
      let lo = Infinity, hi = -Infinity; for (const s of this.series) { const p = s.pts; if (p.length) { lo = Math.min(lo, p[0][0]); hi = Math.max(hi, p[p.length - 1][0]); } }
      this.full = ex.xDomain || (lo <= hi ? [lo, hi === lo ? lo + 1 : hi] : [0, 1]); this.view = null; this.draw();
    }
    get dom() { return this.view || this.full; }
    layout() { const W = Math.max(220, this.host.clientWidth || 300), H = this.o.h; this.w = this.host.clientWidth; return { W, H, l: 46, r: 12, t: 10, b: 26 }; }
    px(x) { const L = this.L, d = this.dom; return L.l + (x - d[0]) / (d[1] - d[0]) * (L.W - L.l - L.r); }
    xOf(px) { const L = this.L, d = this.dom; return Math.min(d[1], Math.max(d[0], d[0] + (px - L.l) / (L.W - L.l - L.r) * (d[1] - d[0]))); }
    py(y) { const L = this.L; return L.t + (this.y1 - y) / (this.y1 - this.y0) * (L.H - L.t - L.b); }
    zoom(k) {
      const d = this.dom, full = this.full, c = this.cx != null && this.cx >= d[0] && this.cx <= d[1] ? this.cx : (d[0] + d[1]) / 2, span = d[1] - d[0];
      let a, b;
      if (k === 'all') { this.view = null; } else {
        if (k === 'in') { const s2 = Math.max((full[1] - full[0]) / 200, span / 2); a = c - (c - d[0]) * s2 / span; b = a + s2; }
        else if (k === 'out') { const s2 = Math.min(full[1] - full[0], span * 2); a = c - (c - d[0]) * s2 / span; b = a + s2; }
        else { const sh = span * 0.5 * (k === 'pl' ? -1 : 1); a = d[0] + sh; b = d[1] + sh; }
        if (a < full[0]) { b += full[0] - a; a = full[0]; } if (b > full[1]) { a -= b - full[1]; b = full[1]; } a = Math.max(a, full[0]);
        this.view = b - a >= (full[1] - full[0]) * 0.999 ? null : [a, b];
      }
      this.draw();
    }
    draw() {
      const L = this.L = this.layout(), d = this.dom, iw = L.W - L.l - L.r, ih = L.H - L.t - L.b, o = this.o;
      this.host.querySelectorAll('[data-z=pl],[data-z=pr]').forEach(b => { b.hidden = !this.view; });
      // görünür aralıktaki noktalar ve y alanı
      let ylo = Infinity, yhi = -Infinity; const vis = [];
      for (const s of this.series) {
        const p = s.pts; let a = lb(p, d[0]), b = lb(p, d[1]); a = Math.max(0, a - 1); b = Math.min(p.length, b + 1); vis.push([a, b]);
        for (let i = a; i < b; i++) { const y = p[i][1]; if (y != null) { if (y < ylo) ylo = y; if (y > yhi) yhi = y; } }
      }
      if (o.yMin != null) ylo = Math.min(ylo === Infinity ? o.yMin : ylo, o.yMin); if (o.yMax != null) yhi = Math.max(yhi === -Infinity ? o.yMax : yhi, o.yMax);
      if (o.zeroLine) { ylo = Math.min(ylo, 0); yhi = Math.max(yhi, 0); }
      if (!isFinite(ylo)) { ylo = 0; yhi = 1; } if (yhi - ylo < 1e-6) { yhi += 1; ylo -= 1; }
      const padY = (yhi - ylo) * 0.08; this.y0 = ylo - (o.yMin != null && ylo === o.yMin ? 0 : padY); this.y1 = yhi + padY; if (o.yMin != null && ylo >= o.yMin && o.yMin === 0) this.y0 = 0;
      const ys = niceStep(this.y1 - this.y0, 4), yt = []; for (let v = Math.ceil(this.y0 / ys) * ys; v <= this.y1 + 1e-9; v += ys) yt.push(Math.round(v / ys * 1e6) / 1e6 * ys);
      const xs = o.timeX ? stepFor(d[1] - d[0], 6) : niceStep(d[1] - d[0], 5), xt = []; for (let v = Math.ceil(d[0] / xs) * xs; v <= d[1] + 1e-9; v += xs) xt.push(v);
      let g = `<rect x="${L.l}" y="${L.t}" width="${iw}" height="${ih}" class="an-plot"/>`;
      for (const v of yt) g += `<line x1="${L.l}" x2="${L.W - L.r}" y1="${this.py(v).toFixed(1)}" y2="${this.py(v).toFixed(1)}" class="an-grid"/><text x="${L.l - 6}" y="${(this.py(v) + 4).toFixed(1)}" class="an-ax" text-anchor="end">${esc(o.yFmt(v))}</text>`;
      for (const v of xt) g += `<line x1="${this.px(v).toFixed(1)}" x2="${this.px(v).toFixed(1)}" y1="${L.t}" y2="${L.H - L.b}" class="an-grid v"/><text x="${this.px(v).toFixed(1)}" y="${L.H - 8}" class="an-ax" text-anchor="middle">${esc((o.xFmt || n1)(v))}</text>`;
      if (o.zeroLine && this.y0 < 0 && this.y1 > 0) g += `<line x1="${L.l}" x2="${L.W - L.r}" y1="${this.py(0).toFixed(1)}" y2="${this.py(0).toFixed(1)}" class="an-zero"/>`;
      for (const b of this.bands) { const a = Math.max(b[0], d[0]), c = Math.min(b[1], d[1]); if (c > a) g += `<rect x="${this.px(a).toFixed(1)}" y="${L.t}" width="${Math.max(1, this.px(c) - this.px(a)).toFixed(1)}" height="${ih}" class="an-band"><title>${esc(b[2] || '')}</title></rect>`; }
      this.series.forEach((s, k) => {
        const p = s.pts, [a, b] = vis[k], segs = []; let cur = [];
        for (let i = a; i < b; i++) { const q = p[i]; if (q[1] == null) { if (cur.length) { segs.push(cur); cur = []; } continue; } if (cur.length && (q[2] || (o.gapX && q[0] - cur[cur.length - 1][0] > o.gapX))) { segs.push(cur); cur = []; } cur.push(q); }
        if (cur.length) segs.push(cur);
        let path = '', area = '';
        for (const sg of segs) {
          const pts = decimate(sg, Math.max(1, Math.floor(iw))), P = pts.map(q => this.px(q[0]).toFixed(1) + ' ' + this.py(q[1]).toFixed(1));
          if (pts.length === 1) { g += `<circle cx="${P[0].split(' ')[0]}" cy="${P[0].split(' ')[1]}" r="2.5" fill="${s.color}"/>`; continue; }
          path += 'M' + P.join(' L'); if (s.fill) { const y0 = this.py(Math.max(this.y0, Math.min(this.y1, 0))).toFixed(1); area += `M${P[0].split(' ')[0]} ${y0} L` + P.join(' L') + ` L${P[P.length - 1].split(' ')[0]} ${y0}Z`; }
        }
        if (area) g += `<path d="${area}" fill="${s.color}" opacity=".16"/>`;
        if (path) g += `<path d="${path}" fill="none" stroke="${s.color}" stroke-width="${s.width || 2}" ${s.dash ? 'stroke-dasharray="' + s.dash + '"' : ''} stroke-linejoin="round" stroke-linecap="round"/>`;
      });
      for (const m of this.marks) { if (m.x < d[0] || m.x > d[1]) continue; const x = this.px(m.x).toFixed(1), y = m.y != null ? this.py(m.y).toFixed(1) : null;
        if (m.shape === 'up') g += `<path d="M${x} ${L.H - L.b - 9} l5 9 h-10z" fill="${m.color}"><title>${esc(m.label || '')}</title></path>`;
        else if (m.shape === 'down') g += `<path d="M${x} ${L.t + 9} l5 -9 h-10z" fill="${m.color}"><title>${esc(m.label || '')}</title></path>`;
        else g += `<circle cx="${x}" cy="${y != null ? y : L.H - L.b - 4}" r="4.5" fill="${m.color}" stroke="#031420" stroke-width="1.5"><title>${esc(m.label || '')}</title></circle>`; }
      g += `<g class="an-cur" hidden><line class="an-cl" y1="${L.t}" y2="${L.H - L.b}"/>${this.series.map((s, k) => `<circle class="an-cd" r="4" fill="${s.color}" data-k="${k}" hidden/>`).join('')}</g>`;
      this.svg.setAttribute('viewBox', `0 0 ${L.W} ${L.H}`); this.svg.setAttribute('height', L.H); this.svg.innerHTML = g;
      if (this.cx != null) this.setCursor(this.cx, true);
    }
    valueAt(s, x) {
      const p = s.pts; if (!p.length) return null; let i = lb(p, x); if (i >= p.length) i = p.length - 1; if (i > 0 && Math.abs(p[i - 1][0] - x) <= Math.abs(p[i][0] - x)) i--;
      const tol = this.o.gapX || (this.full[1] - this.full[0]) / 40; return p[i][1] != null && Math.abs(p[i][0] - x) <= tol ? p[i] : null;
    }
    setCursor(x, silent) {
      this.cx = x; const L = this.L, d = this.dom, g = this.svg.querySelector('.an-cur'); if (!g || x == null) return;
      if (x < d[0] || x > d[1]) { g.setAttribute('hidden', ''); this.tip.hidden = true; return; }
      g.removeAttribute('hidden'); const px = this.px(x), cl = g.querySelector('.an-cl'); cl.setAttribute('x1', px); cl.setAttribute('x2', px);
      let rows = '';
      this.series.forEach((s, k) => { const dot = g.querySelector(`[data-k="${k}"]`), v = this.valueAt(s, x);
        if (v) { dot.removeAttribute('hidden'); dot.setAttribute('cx', px); dot.setAttribute('cy', this.py(v[1])); } else dot.setAttribute('hidden', '');
        if (s.name) rows += `<div><i style="background:${s.color}"></i>${esc(s.name)} <b>${v ? esc((s.fmt || this.o.yFmt)(v[1])) : '—'}</b></div>`; });
      this.tip.innerHTML = `<small>${esc((this.o.xFmt || n1)(x))}</small>${rows}`; this.tip.hidden = false;
      const tw = this.tip.offsetWidth || 110; this.tip.style.left = Math.max(2, Math.min(L.W - tw - 2, px + (px > L.W / 2 ? -tw - 8 : 8))) + 'px';
      if (!silent) this.cbs.forEach(f => f(x));
    }
  }
  function lb(p, x) { let lo = 0, hi = p.length; while (lo < hi) { const m = (lo + hi) >> 1; if (p[m][0] < x) lo = m + 1; else hi = m; } return lo; }
  // piksel başına en fazla min/maks korunur (uzun sürüşlerde tepe değerler kaybolmaz)
  function decimate(sg, cols) {
    if (sg.length <= cols * 2) return sg;
    const per = Math.ceil(sg.length / cols), out = [];
    for (let i = 0; i < sg.length; i += per) { const ch = sg.slice(i, i + per); let mn = ch[0], mx = ch[0]; for (const q of ch) { if (q[1] < mn[1]) mn = q; if (q[1] > mx[1]) mx = q; } if (mn === mx) out.push(mn); else if (mn[0] < mx[0]) out.push(mn, mx); else out.push(mx, mn); }
    return out;
  }

  /* ====================== Harita sarmalayıcıları (Leaflet / çizgi yedeği) ====================== */
  class LMap {
    constructor(host, cfg) {
      const L = window.L; this.L = L; host.dataset.kind = 'leaflet';
      this.m = L.map(host, { zoomControl: true, attributionControl: false, maxZoom: cfg.tileMax || 19 }).setView([39, 35], 5);
      L.tileLayer(cfg.tileUrl, { maxZoom: cfg.tileMax || 19, maxNativeZoom: cfg.tileMax || 19 }).addTo(this.m);
      this.g = L.layerGroup().addTo(this.m); this.cur = {}; this.attr = cfg.tileAttr || '';
    }
    clear() { this.g.clearLayers(); for (const k in this.cur) { try { this.cur[k].remove(); } catch {} } this.cur = {}; }
    line(pts, st, onClick) { const pl = this.L.polyline(pts, st).addTo(this.g); if (onClick) pl.on('click', e => onClick(e.latlng.lat, e.latlng.lng)); return pl; }
    dot(lat, lon, st, tip, onClick) { const mk = this.L.circleMarker([lat, lon], st).addTo(this.g); if (tip) mk.bindTooltip(esc(tip)); if (onClick) mk.on('click', () => onClick()); return mk; }
    cursor(key, lat, lon, color, label) {
      if (lat == null) { if (this.cur[key]) { try { this.cur[key].remove(); } catch {} delete this.cur[key]; } return; }
      let c = this.cur[key]; if (!c) { c = this.cur[key] = this.L.circleMarker([lat, lon], { radius: 8, color: '#fff', weight: 3, fillColor: color, fillOpacity: 1 }).addTo(this.m); if (label) c.bindTooltip(esc(label), { permanent: false }); } else c.setLatLng([lat, lon]);
    }
    fit(pts) { if (pts.length) this.m.fitBounds(this.L.latLngBounds(pts), { padding: [24, 24], maxZoom: 17 }); }
    panTo(lat, lon) { this.m.panTo([lat, lon]); }
    invalidate() { this.m.invalidateSize(); }
    destroy() { try { this.m.remove(); } catch {} }
  }
  class SvgMap {                                         // Leaflet/karo yüklenemezse: yalnızca güzergâh çizgileri (altlık harita yok)
    constructor(host) { host.dataset.kind = 'svg'; this.host = host; this.shapes = []; this.cur = {}; this.b = null; this.attr = ''; host.innerHTML = '<svg class="an-svgmap" viewBox="0 0 400 300" preserveAspectRatio="xMidYMid meet"></svg><p class="an-mapnote">Harita altlığı yüklenemedi (bağlantı yok olabilir); yalnızca güzergâh çizgisi gösteriliyor.</p>'; this.svg = host.querySelector('svg'); }
    clear() { this.shapes = []; this.cur = {}; this.render(); }
    line(pts, st, onClick) { this.shapes.push({ t: 'l', pts, st, onClick }); return {}; }
    dot(lat, lon, st, tip, onClick) { this.shapes.push({ t: 'd', lat, lon, st, tip, onClick }); return {}; }
    proj(lat, lon) { const b = this.b, cl = Math.cos((b.la0 + b.la1) / 2 * Math.PI / 180), w = Math.max(1e-9, (b.lo1 - b.lo0) * cl), h = Math.max(1e-9, b.la1 - b.la0), s = Math.min(370 / w, 270 / h); return [200 + ((lon - (b.lo0 + b.lo1) / 2) * cl) * s, 150 - (lat - (b.la0 + b.la1) / 2) * s]; }
    fit(pts) { if (!pts.length) return; let la0 = 90, la1 = -90, lo0 = 180, lo1 = -180; for (const [a, o] of pts) { la0 = Math.min(la0, a); la1 = Math.max(la1, a); lo0 = Math.min(lo0, o); lo1 = Math.max(lo1, o); } this.b = { la0, la1, lo0, lo1 }; this.render(); }
    render() {
      if (!this.b) return; let h = '';
      for (const s of this.shapes) { if (s.t === 'l') h += `<polyline fill="none" stroke="${s.st.color}" stroke-width="${Math.min(4, s.st.weight || 3)}" stroke-dasharray="${s.st.dashArray || ''}" stroke-linecap="round" points="${s.pts.map(p => this.proj(p[0], p[1]).map(v => v.toFixed(1)).join(',')).join(' ')}"/>`;
        else { const [x, y] = this.proj(s.lat, s.lon); h += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${s.st.radius || 5}" fill="${s.st.fillColor || s.st.color}" stroke="#031420" stroke-width="1"><title>${esc(s.tip || '')}</title></circle>`; } }
      for (const k in this.cur) { const c = this.cur[k], [x, y] = this.proj(c.lat, c.lon); h += `<circle class="an-sc" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="8" fill="${c.color}" stroke="#fff" stroke-width="3"/>`; }
      this.svg.innerHTML = h;
    }
    cursor(key, lat, lon, color) { if (lat == null) delete this.cur[key]; else this.cur[key] = { lat, lon, color }; this.render(); }
    panTo() {} invalidate() {} destroy() { this.host.innerHTML = ''; }
  }
  async function makeMap(host) {
    try { await ensureLeaflet(); const cfg = await mapCfg(); return new LMap(host, cfg); }
    catch { return new SvgMap(host); }
  }

  /* ====================== Veri erişimi (mevcut kayıtlar) ====================== */
  async function api(url, txt) { const r = await fetch(url, { credentials: 'same-origin' }); if (!r.ok) { const j = await r.json().catch(() => ({})); const e = new Error(j.error || 'İstek başarısız (' + r.status + ').'); e.status = r.status; throw e; } return txt ? r.text() : r.json(); }

  function mount(root, opts) {
    const user = opts && opts.user, RS = () => window.RideStore;
    const RKEY = () => 'an_reset:' + (user || ''), RNG = 'an_range';
    const lsg = k => { try { return localStorage.getItem(k); } catch { return null; } }, lss = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} };
    const A = { range: ['all', 'week', 'month'].includes(lsg(RNG)) ? lsg(RNG) : 'all', confirm: false, tab: 'solo', view: 'list', rides: [], groups: [], gRides: [], loading: false, err: '', sel: [], gFilter: null, cache: new Map(), gcache: new Map(), S: null, G: null, cmp: null, map: null, charts: [], t: null, hidden: new Set(), evFilter: 'all', active: false, loaded: false, scroll: 0, sumBusy: false };

    /* ---------- Listeleri yükle ---------- */
    async function loadRides() {
      A.loading = true; A.err = ''; if (A.view === 'list') render();
      await RS().init();
      const [dev, srv] = await Promise.allSettled([RS().list(user || ''), api('/api/rides')]);
      const m = new Map();
      if (dev.status === 'fulfilled') for (const d of dev.value) m.set(d.id, { id: d.id, startedAt: d.startedAt, endedAt: d.endedAt, onDevice: true, onServer: d.sync === 'synced', sync: d.sync, summary: null, tele: null });
      if (srv.status === 'fulfilled') for (const s of (srv.value.rides || [])) { const e = m.get(s.id) || { id: s.id, startedAt: s.startedAt, endedAt: s.endedAt, onDevice: false, sync: 'synced' }; e.onServer = true; e.summary = s.summary || null; e.tele = s.tele || null; m.set(s.id, e); }
      else A.err = 'Sunucudaki sürüş listesi alınamadı; yalnızca bu cihazdaki sürüşler gösteriliyor.';
      A.rides = [...m.values()].sort((a, b) => b.startedAt - a.startedAt); A.loading = false; A.loaded = true; if (A.view === 'list') render();
      ensureSummaries();
    }
    async function ensureSummaries() {                         // sunucuda özeti olmayan (henüz eşitlenmemiş) cihaz sürüşleri: aynı kuralla (RideCore) yerelde hesaplanır
      if (A.sumBusy) return; A.sumBusy = true;
      try {
        for (const e of A.rides.slice(0, 60)) {
          if (!e.summary && e.onDevice) { try { const l = await RS().load(e.id); if (l && l.data.fixes.length) { e.summary = RC.summarize(l.data); if (A.view === 'list') updateRow(e); } } catch {} }
          if (e.onDevice && e.tele == null) { try { const st = await RS().teleState(e.id); e.tele = st && st.final ? { local: true } : false; if (A.view === 'list') updateRow(e); } catch { e.tele = false; } }
        }
      } finally { A.sumBusy = false; }
    }
    async function loadGroups() {
      A.loading = true; A.err = ''; if (A.view === 'list') render();
      try {
        const g = (await api('/api/rgroups')).groups || []; A.groups = g;
        const lists = await Promise.allSettled(g.map(x => api('/api/rgroups/' + x.id + '/rides')));
        A.gRides = []; lists.forEach((r, i) => { if (r.status === 'fulfilled') for (const x of (r.value.rides || [])) A.gRides.push(Object.assign({ gid: g[i].id, gname: g[i].name, role: g[i].role }, x)); });
        A.gRides.sort((a, b) => b.startedAt - a.startedAt);
      } catch (e) { A.err = e.message || 'Grup sürüşleri alınamadı.'; A.gRides = []; }
      A.loading = false; A.gLoaded = true; if (A.view === 'list') render();
    }
    async function loadSolo(id) {
      if (A.cache.has(id)) return A.cache.get(id);
      const e = A.rides.find(r => r.id === id); let data = null, tele = null;
      await RS().init();
      if (!e || e.onDevice) { try { const l = await RS().load(id); if (l && l.data.fixes.length) data = l.data; } catch {} }
      if (!data) data = await api('/api/rides/' + encodeURIComponent(id));
      try { const local = await RS().loadTele(id); if (local && local.state && local.state.final && (local.bins.length || local.evs.length)) tele = { meta: local.state.meta, bins: local.bins, evs: local.evs }; } catch {}
      if (!tele && (!e || e.tele)) { try { const t = await api('/api/rides/' + encodeURIComponent(id) + '/tele'); tele = { meta: t.meta, bins: t.bins, evs: t.evs }; } catch {} }       // yalnızca sunucu özeti telemetri bildiriyorsa istenir
      const S = AC.soloSeries(data, tele); S.entry = e || null; A.cache.set(id, S); return S;
    }
    async function loadGroup(gid, rid) {
      const k = gid + '/' + rid; if (A.gcache.has(k)) return A.gcache.get(k);
      const text = await api('/api/rgroups/' + encodeURIComponent(gid) + '/rides/' + encodeURIComponent(rid), true), G = AC.parseGroupRide(text);
      if (!G) throw new Error('Grup sürüşü kaydı okunamadı.'); G.gid = gid; A.gcache.set(k, G); return G;
    }

    /* ---------- Yardımcı: render iskeleti ---------- */
    function teardown() { for (const c of A.charts) c.destroy(); A.charts = []; if (A.map) { A.map.destroy(); A.map = null; } A.t = null; }
    function toTop() { const sc = root.closest('main'); if (sc) sc.scrollTop = 0; window.scrollTo(0, 0); }                 // görünüm değişince başa dön (kaydırma kabı #analysis ya da sayfa)
    function shell(inner, cls) { root.innerHTML = `<div class="an ${cls || ''}">${inner}</div>`; toTop(); }
    const head = (title, sub, back, actions) => `<header class="an-head">${back === 'exit' ? '<button type="button" class="an-back" data-a="exit" aria-label="Geri">‹</button>' : back ? '<button type="button" class="an-back" data-a="back" aria-label="Geri">‹</button>' : ''}<div class="an-ht"><h1>${esc(title)}</h1>${sub ? '<p>' + sub + '</p>' : ''}</div>${actions || ''}</header>`;
    const card = (label, val, sub, cls, act) => `<${act ? 'button type="button" data-a="' + act + '"' : 'div'} class="an-card ${cls || ''}"><small>${esc(label)}</small><b>${val}</b>${sub ? '<span>' + sub + '</span>' : ''}</${act ? 'button' : 'div'}>`;
    const empty = (t, s) => `<div class="an-empty"><b>${esc(t)}</b>${s ? '<p>' + esc(s) + '</p>' : ''}</div>`;

    /* ====================== Liste ====================== */
    function rideRow(e) {
      const s = e.summary, picked = A.sel.includes(e.id), dur = s ? s.durationS : (e.endedAt - e.startedAt) / 1000;
      return `<div class="an-row ${picked ? 'sel' : ''}" data-id="${esc(e.id)}"><button type="button" class="an-rmain" data-a="open" data-id="${esc(e.id)}">
        <span class="an-rdate"><b>${esc(new Date(e.startedAt).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' }))}</b><small>${esc(fmt.time(e.startedAt))}–${esc(fmt.time(e.endedAt))}</small></span>
        <span class="an-rstats"><span><small>Mesafe</small><b>${s ? fmt.dist(s.distM) : '…'}</b></span><span><small>Süre</small><b>${s ? fmt.dur(dur) : '≈ ' + fmt.dur(dur)}</b></span><span><small>Ort.</small><b>${s ? fmt.kmh(s.avgMovingKmh) : '—'}</b></span><span><small>Maks.</small><b>${s ? fmt.kmh(s.maxKmh) : '—'}</b></span></span></button>
        <span class="an-rbadges">${e.onDevice ? '<i class="an-b">Cihazda</i>' : ''}${e.onServer ? '<i class="an-b ok">Sunucuda</i>' : '<i class="an-b warn">Eşitlenmedi</i>'}${e.tele ? '<i class="an-b sens">Sensör</i>' : ''}</span>
        <label class="an-pick"><input type="checkbox" data-a="pick" data-id="${esc(e.id)}" ${picked ? 'checked' : ''} aria-label="Karşılaştırmak için Seç"><span>Karşılaştır</span></label></div>`;
    }
    // Görünür sürüşler: sıfırlama anından sonrakiler + Hafta/Ay filtresi. Kayıtlar SİLİNMEZ; sıfırlama yalnızca sayacı/listeyi gizler.
    const resetAt = () => Number(lsg(RKEY())) || 0;
    function rangeStart() { const d = new Date(); d.setHours(0, 0, 0, 0); if (A.range === 'week') { d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.getTime(); } if (A.range === 'month') { d.setDate(1); return d.getTime(); } return 0; }
    function visible() { const lo = Math.max(resetAt(), rangeStart()); return A.rides.filter(r => r.startedAt >= lo); }
    function updateRow(e) { const row = root.querySelector(`.an-row[data-id="${CSS.escape(e.id)}"]`); if (row) row.outerHTML = rideRow(e); const k = root.querySelector('#an-agg'); if (k) k.innerHTML = aggHtml(); }
    function aggHtml() {
      const vis = visible(), done = vis.filter(r => r.summary), dist = done.reduce((a, r) => a + (r.summary.distM || 0), 0), dur = done.reduce((a, r) => a + (r.summary.durationS || 0), 0), mx = done.reduce((a, r) => (r.summary.maxKmh != null && r.summary.maxKmh > a ? r.summary.maxKmh : a), 0);
      const long = done.reduce((a, r) => (!a || r.summary.distM > a.summary.distM ? r : a), null);
      return card('Tamamlanan Sürüş', vis.length, done.length < vis.length ? done.length + ' tanesinin özeti hazır' : '') + card('Toplam mesafe', fmt.dist(done.length ? dist : null), 'özeti olan sürüşlerden') + card('Toplam süre', fmt.dur(done.length ? dur : null), 'aktif süre') +
        card('En Yüksek Hız', mx ? fmt.kmh(mx) : '—', 'tüm sürüşlerde') + card('En Uzun Sürüş', long ? fmt.dist(long.summary.distM) : '—', long ? esc(fmt.date(long.startedAt)) : '');
    }
    function groupRow(r) {
      const dur = r.endedAt ? (r.endedAt - r.startedAt) / 1000 : null, sharers = (r.members || []).length;
      return `<div class="an-row"><button type="button" class="an-rmain" data-a="gopen" data-gid="${esc(r.gid)}" data-id="${esc(r.id)}"><span class="an-rdate"><b>${esc(new Date(r.startedAt).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' }))}</b><small>${esc(fmt.time(r.startedAt))}${r.endedAt ? '–' + esc(fmt.time(r.endedAt)) : ''}</small></span>
        <span class="an-rstats"><span class="wide"><small>Grup</small><b>${esc(r.gname)}</b></span><span><small>Süre</small><b>${r.endedAt ? fmt.dur(dur) : 'devam ediyor'}</b></span><span><small>Konum Paylaşan</small><b>${sharers ? sharers + ' üye' : '—'}</b></span></span></button></div>`;
    }
    function renderList() {
      teardown();
      const solo = A.tab === 'solo';
      const body = A.loading && !(solo ? A.loaded : A.gLoaded) ? '<div class="an-empty"><b>Yükleniyor…</b></div>'
        : solo ? (visible().length ? `<div class="an-cards" id="an-agg">${aggHtml()}</div><div class="an-rows">${visible().map(rideRow).join('')}</div>`
          : A.rides.length ? empty(A.range === 'week' ? 'Bu hafta sürüş yok' : A.range === 'month' ? 'Bu ay sürüş yok' : 'Sıfırlamadan sonra sürüş yok', 'Filtreyi “Tümü” yap' + (resetAt() ? ' ya da sıfırlamayı geri al.' : '.')) : empty('Henüz tamamlanmış sürüşün yok', 'Harita ekranından bir sürüşü başlatıp bitirdiğinde burada listelenir.'))
        : (() => { const gl = A.gFilter ? A.gRides.filter(r => r.gid === A.gFilter) : A.gRides, gn = A.gFilter && (A.groups.find(g => g.id === A.gFilter) || {}).name;
          return (A.gFilter ? `<p class="an-note">Yalnızca “${esc(gn || 'seçili grup')}” grubunun sürüşleri. <button type="button" class="an-link" data-a="gall">Tüm Gruplar</button></p>` : '') +
            (gl.length ? `<div class="an-rows">${gl.map(groupRow).join('')}</div>` : empty('Kayıtlı grup sürüşü yok', 'Bir sürüş grubunda lider sürüşü başlatıp üyeler konum paylaştığında kayıt burada görünür.')); })();
      const rs = resetAt(), toolbar = solo ? `<div class="an-tools"><div class="an-range" role="group" aria-label="Zaman Aralığı">${[['all', 'Tümü'], ['week', 'Hafta'], ['month', 'Ay']].map(([k, t]) => `<button type="button" data-a="range" data-r="${k}" aria-pressed="${A.range === k}">${t}</button>`).join('')}</div><button type="button" class="an-reset" data-a="reset">Sıfırla</button></div>`
        + (A.confirm ? `<div class="an-confirm" role="alertdialog"><p>Analiz sayaçları sıfırlansın mı? Sürüş kayıtların <b>silinmez</b>; yalnızca bu ekranda ve ana sayfadaki toplamlarda bugünden önceki sürüşler sayılmaz. Sonradan geri alabilirsin.</p><div><button type="button" data-a="reset-no">Vazgeç</button><button type="button" class="go" data-a="reset-yes">Evet, Sıfırla</button></div></div>` : '')
        + (rs ? `<p class="an-note">Sıfırlama aktif: ${esc(new Date(rs).toLocaleDateString('tr-TR'))} öncesi sürüşler gizli. <button type="button" class="an-link" data-a="reset-undo">Geri Al</button></p>` : '') : '';
      shell(`${head('Sürüş Analizi', 'Geçmiş sürüşlerin ve grup sürüşlerinin istatistikleri', opts && opts.onExit ? 'exit' : false)}
        <div class="an-tabs" role="tablist"><button type="button" role="tab" aria-selected="${solo}" data-a="tab" data-tab="solo">Sürüşlerim</button><button type="button" role="tab" aria-selected="${!solo}" data-a="tab" data-tab="group">Grup Sürüşleri</button></div>
        ${toolbar}${A.err ? '<p class="an-warn">' + esc(A.err) + '</p>' : ''}${body}
        <div class="an-cmpbar" ${A.sel.length === 2 && solo ? '' : 'hidden'}><span>2 sürüş seçildi</span><button type="button" data-a="compare">Karşılaştır</button></div>`);
    }

    /* ====================== Tek sürüş ====================== */
    function readoutHtml(S, t) {
      if (t == null) return '<p class="an-note">Grafikte ya da haritada bir noktaya dokun / üzerine gel.</p>';
      const i = AC.nearestIdx(S, t), p = AC.posAt(S, t), v = i >= 0 ? S.v[i] : null, d = AC.distAt(S, t);
      let lean = null, aLon = null, aLat = null;
      if (S.tele) { const near = arr => { if (!arr.length) return null; const m = lb(arr, t); let b = null, bd = 2500; for (let k = Math.max(0, m - 2); k < Math.min(arr.length, m + 2); k++) { const dd = Math.abs(arr[k][0] - t); if (dd < bd) { bd = dd; b = arr[k][1]; } } return b; }; lean = near(S.tele.lean); aLon = near(S.tele.aLon); aLat = near(S.tele.aLat); }
      const sensNote = !S.tele || !S.tele.hasData ? 'sensör verisi yok' : null;
      return `<div class="an-rd"><span><small>Zaman</small><b>${esc(fmt.clock((t - S.t0) / 1000))}</b><em>${esc(fmt.timeS(t))}</em></span><span><small>Hız</small><b>${v == null ? '—' : esc(fmt.kmh(v * 3.6))}</b><em>${v == null ? '' : S.src[i] === 'd' ? 'cihaz ölçümü' : 'konumdan türetilmiş'}</em></span><span><small>Mesafe</small><b>${esc(fmt.dist(d))}</b></span>
        <span><small>Yatış</small><b>${lean == null ? '—' : esc(fmt.lean(lean))}</b><em>${lean == null ? esc(sensNote || 'bu anda geçerli tahmin yok') : ''}</em></span><span><small>Boylamsal / yanal</small><b>${aLon == null ? '—' : esc(fmt.ms2(aLon))} / ${aLat == null ? '—' : esc(fmt.ms2(aLat))}</b></span><span class="wide"><small>Konum</small><b>${p ? esc(fmt.coord(p.lat, p.lon)) : '—'}</b></span></div>`;
    }
    function teleCard(S) {
      const T = S.tele;
      if (!T || !T.hasData) {
        return `<section class="an-sec"><h2>Sensör Verisi</h2>${empty('Bu sürüşte sensör verisi yok', 'Sensör kaydı kapalıydı, izin verilmedi ya da cihaz desteklemiyor. Hız ve güzergâh yalnızca GPS kaydından hesaplanır.')}</section>`;
      }
      const st = T.status, row = (k, s, r, extra) => `<div class="an-trow"><span>${k}</span><span>${badge(s, r)}${extra ? ' <small>' + extra + '</small>' : ''}</span></div>`, rs = st.reasons || {};
      const evs = st.events;
      return `<section class="an-sec"><h2>Sensör Verisi</h2>${row('Boylamsal İvme', st.aLon.state, st.aLon.state === 'measured' ? null : rs.aLon, st.aLon.state === 'measured' ? fmt.ms2(st.aLon.min) + ' … +' + fmt.ms2(st.aLon.max) : '')}
        ${row('Yanal İvme', st.aLat.state, st.aLat.state === 'measured' ? null : rs.aLat, st.aLat.state === 'measured' ? 'en çok ' + fmt.ms2(st.aLat.absMax) : '')}
        ${row('Yatış Açısı', st.lean.state, st.lean.state === 'estimated' ? null : rs.lean, st.lean.state === 'estimated' ? 'sol ≈' + (st.lean.leftMax == null ? '—' : Math.round(st.lean.leftMax)) + '° · sağ ≈' + (st.lean.rightMax == null ? '—' : Math.round(st.lean.rightMax)) + '° · ' + st.lean.secs + ' sn' : '')}
        ${row('Dönüş Hızı', st.yaw.state)}
        <div class="an-trow"><span>Ani Frenleme</span><span><b>${evs.brake.n}</b> <small>${evs.brake.imu ? evs.brake.imu + ' ivmeölçer' : ''}${evs.brake.imu && evs.brake.gps ? ' · ' : ''}${evs.brake.gps ? evs.brake.gps + ' GPS hız farkı' : ''}${evs.brake.n ? ' · sert+: ' + (evs.brake.sev[1] + evs.brake.sev[2]) : ''}</small></span></div>
        <div class="an-trow"><span>Ani Hızlanma</span><span><b>${evs.accel.n}</b> <small>${evs.accel.imu ? evs.accel.imu + ' ivmeölçer' : ''}${evs.accel.imu && evs.accel.gps ? ' · ' : ''}${evs.accel.gps ? evs.accel.gps + ' GPS hız farkı' : ''}</small></span></div>
        ${st.sync && st.sync.lagMs != null ? `<div class="an-trow"><span>GPS–Sensör Eşleşmesi</span><span>gecikme ≈${Math.round(st.sync.lagMs)} ms <small>(r=${n1(st.sync.corr, 2)})</small></span></div>` : ''}
        <p class="an-note">Yatış değerleri <b>tahmindir</b> (GPS hızı × jiroskop dönüş hızı modeli); gerçek yatış ölçümüyle doğrulanmadı. Yalnızca sensörler tutarlıyken yazılır, aksi halde «veri yok» görünür. Ani fren/hızlanma eşikleri gerçek sürüşle ayarlanmadı.</p></section>`;
    }
    function qualityCard(S) {
      const q = S.quality, sm = S.sum, notes = [];
      if (q.derivedPct) notes.push(`Hız değerlerinin %${q.derivedPct}'i cihaz ölçümü değil, ardışık konumlardan türetilmiştir (daha kaba).`);
      if (sm.rejectedAcc || sm.rejectedJump) notes.push(`${sm.rejectedAcc} zayıf doğruluklu ve ${sm.rejectedJump} sıçrama yapan GPS noktası elendi.`);
      if (sm.gaps || sm.reanchors) notes.push(`${sm.gaps + sm.reanchors} konum kesintisi oldu; o aralıklardaki mesafe ölçülmedi ve grafikte çizgi kopar.`);
      if (q.limitReached) notes.push('Kayıt sınırına ulaşıldı; sonrası kaydedilmedi.');
      notes.push('Rakım bu kayıtlarda tutulmadığı için rakım grafiği yoktur.');
      if (S.start) notes.push('Başlangıç/bitiş konumları kayıtlı GPS noktalarının koordinatlarıdır (adres çözümlemesi yapılmaz).');
      return `<section class="an-sec"><h2>Veri Kapsamı</h2><ul class="an-notes">${notes.map(n => '<li>' + esc(n) + '</li>').join('')}</ul></section>`;
    }
    function eventsHtml(S, filter) {
      const f = filter || 'all', list = S.events.filter(e => f === 'all' || (f === 'sens' && (e.kind === 'brake' || e.kind === 'accel' || e.kind === 'maxlean')) || (f === 'stop' && (e.kind === 'pause' || e.kind === 'resume' || e.kind === 'gap')));
      const ico = { start: '▶', end: '■', pause: '⏸', resume: '⏵', gap: '⚠', maxspeed: '★', maxlean: '↺', brake: '▼', accel: '▲' };
      return list.length ? list.map((e, i) => `<button type="button" class="an-ev ev-${e.kind}" data-a="ev" data-t="${e.t}"><i>${ico[e.kind] || '•'}</i><span><b>${esc(e.label)}</b><small>${esc(fmt.clock((e.t - S.t0) / 1000))} · ${esc(fmt.timeS(e.t))}</small></span></button>`).join('') : '<p class="an-note">Bu filtrede olay yok.</p>';
    }

    async function openSolo(id) {
      teardown(); A.view = 'solo'; A.t = null; A.scroll = 0;
      shell(head('Sürüş Analizi', 'Yükleniyor…', true) + '<div class="an-empty"><b>Sürüş yükleniyor…</b></div>');
      let S; try { S = await loadSolo(id); } catch (e) { shell(head('Sürüş Analizi', '', true) + empty('Sürüş yüklenemedi', e.message)); return; }
      if (A.view !== 'solo') return; A.S = S; const sm = S.sum;
      if (!S.n) { shell(head(fmt.date(S.t0), '', true) + empty('Bu sürüşte geçerli konum noktası yok', 'GPS verisi alınamadığı için analiz edilecek veri bulunmuyor.')); return; }
      const total = (S.t1 - S.t0) / 1000;
      shell(`${head(fmt.date(S.t0), esc(fmt.time(S.t0)) + ' – ' + esc(fmt.time(S.t1)) + ' · ' + (S.entry && S.entry.onServer ? 'sunucuda kayıtlı' : 'yalnızca bu cihazda'), true, '<button type="button" class="an-act" data-a="cmpwith">Başka Sürüşle Karşılaştır</button>')}
        <div class="an-detail"><div class="an-left"><div class="an-cards">
          ${card('Mesafe', esc(fmt.dist(sm.distM)), '')}${card('Toplam süre', esc(fmt.dur(sm.durationS)), 'aktif · duraklatmalar dahil ' + esc(fmt.dur(total)))}${card('Hareket süresi', esc(fmt.dur(sm.movingS)), 'duruş ' + esc(fmt.dur(sm.stoppedS)))}
          ${card('Ortalama Hız', esc(fmt.kmh(sm.avgMovingKmh)), 'toplam süreye göre ' + esc(fmt.kmh(sm.avgTotalKmh)))}${card('Maksimum Hız', esc(fmt.kmh(sm.maxKmh)), '')}${card('Tarih', esc(fmt.date(S.t0)), '')}
          ${card('Başlangıç', S.start ? esc(fmt.coord(S.start.lat, S.start.lon)) : '—', S.start ? esc(fmt.timeS(S.start.t)) : '', 'loc', 'goStart')}${card('Bitiş', S.end ? esc(fmt.coord(S.end.lat, S.end.lon)) : '—', S.end ? esc(fmt.timeS(S.end.t)) : '', 'loc', 'goEnd')}</div>
          <div class="an-sticky"><div class="an-map" id="an-map"></div><div class="an-legend"><span>Rota rengi = hız</span><i style="background:linear-gradient(90deg,${[0, 40, 80, 110, 140].map(k => speedColor(k)).join(',')})"></i><span>0 → 140+ km/sa</span></div><div class="an-attr" id="an-attr"></div><div class="an-read" id="an-read">${readoutHtml(S, null)}</div></div></div>
          <div class="an-right"><section class="an-sec"><h2>Hız – Zaman</h2><div id="ch-st"></div></section><section class="an-sec"><h2>Hız – Mesafe</h2><div id="ch-sd"></div></section>
          <section class="an-sec"><h2>Yatış açısı <em class="an-est">tahmini</em></h2><div id="ch-lean"></div></section><section class="an-sec"><h2>İvme <em class="an-est m">ölçülen</em></h2><div id="ch-acc"></div></section>
          ${teleCard(S)}
          <section class="an-sec"><h2>Olay Zaman Çizelgesi</h2><div class="an-chips" id="an-evf">${[['all', 'Tümü'], ['sens', 'Fren / hızlanma / yatış'], ['stop', 'Duraklar ve Kesintiler']].map(([k, l]) => `<button type="button" data-a="evf" data-f="${k}" aria-pressed="${A.evFilter === k}">${l}</button>`).join('')}</div><div class="an-evs" id="an-evs">${eventsHtml(S, A.evFilter)}</div></section>
          ${qualityCard(S)}</div></div>`);
      buildSoloVisuals(S);
    }

    function buildSoloVisuals(S) {
      const xs = t => (t - S.t0) / 1000, sp = [], sd = [];
      for (let i = 0; i < S.n; i++) { const y = S.v[i] == null ? null : S.v[i] * 3.6; sp.push([xs(S.t[i]), y, S.ref[i] ? 1 : 0]); sd.push([S.d[i] / 1000, y, S.ref[i] ? 1 : 0]); }
      const bands = S.pauses.map(p => [xs(p[0]), xs(p[1]), 'Duraklatma']);
      const marks = S.events.filter(e => ['brake', 'accel', 'maxspeed', 'gap'].includes(e.kind)).map(e => ({ x: xs(e.t), shape: e.kind === 'brake' ? 'down' : e.kind === 'accel' ? 'up' : 'dot', color: e.kind === 'brake' ? '#E8675D' : e.kind === 'accel' ? '#5CC48E' : e.kind === 'gap' ? '#F2C94C' : '#F4EFE6', label: e.label, y: e.kind === 'maxspeed' ? e.v : null }));
      const mk = (id, o, series, ex, toX, fromX) => { const host = root.querySelector('#' + id); const c = new Chart(host, o); c.setData(series, ex); c.toX = toX; c.fromX = fromX; c.onCursor(x => setT(S, fromX(x), c)); A.charts.push(c); return c; };
      mk('ch-st', { h: 200, timeX: true, xFmt: v => fmt.clock(v), yFmt: v => n1(v), gapX: 15, yMin: 0, label: 'Hız Zaman Grafiği' }, [{ name: 'Hız', color: accentC(), pts: sp, fmt: v => n1(v) + ' km/sa', fill: true }], { bands, marks }, t => xs(t), x => S.t0 + x * 1000);
      mk('ch-sd', { h: 200, xFmt: v => n1(v, 1) + ' km', yFmt: v => n1(v), yMin: 0, label: 'Hız Mesafe Grafiği' }, [{ name: 'Hız', color: '#4FA3E0', pts: sd, fmt: v => n1(v) + ' km/sa', fill: true }], { marks: [] }, t => (AC.distAt(S, t) || 0) / 1000, x => AC.tAtDist(S, x * 1000));
      const T = S.tele, leanPts = T && T.lean.length ? T.lean.map(r => [xs(r[0]), r[1]]) : null;
      const lh = root.querySelector('#ch-lean');
      if (leanPts) mk('ch-lean', { h: 170, timeX: true, xFmt: v => fmt.clock(v), yFmt: v => Math.round(v) + '°', gapX: 3, zeroLine: true, label: 'Tahmini yatış grafiği' }, [{ name: 'Yatış (tahmini, + sol)', color: '#B58CF0', pts: leanPts, fmt: v => fmt.lean(v), fill: true }], { bands }, t => xs(t), x => S.t0 + x * 1000);
      else lh.innerHTML = empty('Yatış açısı: veri yok', leanReason(S));
      const ah = root.querySelector('#ch-acc');
      if (T && (T.aLon.length || T.aLat.length)) mk('ch-acc', { h: 170, timeX: true, xFmt: v => fmt.clock(v), yFmt: v => n1(v, 1), gapX: 3, zeroLine: true, label: 'İvme Grafiği' },
        [T.aLon.length ? { name: 'Boylamsal', color: '#5CC48E', pts: T.aLon.map(r => [xs(r[0]), r[1]]), fmt: v => fmt.ms2(v) } : null, T.aLat.length ? { name: 'Yanal', color: '#E8675D', pts: T.aLat.map(r => [xs(r[0]), r[1]]), fmt: v => fmt.ms2(v) } : null], { bands, marks: marks.filter(m => m.shape === 'up' || m.shape === 'down') }, t => xs(t), x => S.t0 + x * 1000);
      else ah.innerHTML = empty('İvme: veri yok', accReason(S));
      // harita
      makeMap(root.querySelector('#an-map')).then(m => { if (A.view !== 'solo' || A.S !== S) { m.destroy(); return; } A.map = m; root.querySelector('#an-attr').innerHTML = m.attr || ''; drawSoloMap(S); if (A.t != null) setT(S, A.t); });
    }
    function leanReason(S) { const T = S.tele; if (!T || !T.hasData) return 'Sensör verisi kaydedilmemiş.'; const st = T.status; return st.lean.state === 'unsupported' ? 'Telefon jiroskop vermiyor; yatış tahmin edilemez.' : st.reasons.lean ? 'Güvenilir tahmin yok: ' + (REASON[st.reasons.lean] || st.reasons.lean) + '.' : 'Bu sürüşte güvenilir yatış tahmini üretilemedi.'; }
    function accReason(S) { const T = S.tele; if (!T || !T.hasData) return 'Sensör verisi kaydedilmemiş.'; const r = T.status.reasons.aLon; return r ? 'Ölçülemedi: ' + (REASON[r] || r) + '.' : 'Bu sürüşte güvenilir ivme ölçümü yok.'; }

    function routeSegments(S, map, onPick) {
      const pts = S.lat.map((a, i) => [a, S.lon[i]]), keep = AC.simplify(pts, 6, 1600); let run = null, prev = -1;
      const flush = () => { if (run && run.p.length > 1) map.line(run.p, { color: run.c, weight: 5, opacity: 0.95, lineCap: 'round' }, onPick); run = null; };
      for (const i of keep) {
        let sum = 0, cnt = 0; for (let k = Math.max(0, prev); k <= i; k++) if (S.v[k] != null) { sum += S.v[k]; cnt++; }
        const c = speedColor(cnt ? sum / cnt * 3.6 : null), brk = prev >= 0 && S.ref[i];
        if (prev < 0) { run = { c, p: [pts[i]] }; } else if (brk) { flush(); run = { c, p: [pts[i]] }; } else if (c === run.c || Math.abs(colorKey(c) - colorKey(run.c)) < 1) { run.p.push(pts[i]); } else { run.p.push(pts[i]); flush(); run = { c, p: [pts[i]] }; }
        prev = i;
      }
      flush(); return pts;
    }
    const colorKey = c => { const m = /(\d+),(\d+),(\d+)/.exec(c); return m ? Math.round((+m[1] + +m[2] * 2 + +m[3]) / 40) : 0; };
    function nearestSample(S, lat, lon) { let bi = 0, bd = Infinity; const k = Math.cos(lat * Math.PI / 180); for (let i = 0; i < S.n; i++) { const dx = (S.lon[i] - lon) * k, dy = S.lat[i] - lat, d = dx * dx + dy * dy; if (d < bd) { bd = d; bi = i; } } return bi; }
    function drawSoloMap(S) {
      const m = A.map; m.clear();
      const pts = routeSegments(S, m, (lat, lon) => setT(S, S.t[nearestSample(S, lat, lon)], 'map'));
      m.dot(S.start.lat, S.start.lon, { radius: 8, color: '#031420', weight: 2, fillColor: '#5CC48E', fillOpacity: 1 }, 'Başlangıç');
      m.dot(S.end.lat, S.end.lon, { radius: 8, color: '#031420', weight: 2, fillColor: '#E8675D', fillOpacity: 1 }, 'Bitiş');
      for (const e of S.events.slice(0, 400)) if (e.lat != null && ['brake', 'accel', 'gap', 'maxlean', 'maxspeed'].includes(e.kind)) m.dot(e.lat, e.lon, { radius: 5, color: '#031420', weight: 1.5, fillColor: { brake: '#E8675D', accel: '#5CC48E', gap: '#F2C94C', maxlean: '#B58CF0', maxspeed: '#F4EFE6' }[e.kind], fillOpacity: 1 }, e.label, () => setT(S, e.t, 'map'));
      m.fit(pts); m.invalidate();
    }
    // Ortak imleç: zamana (epoch ms) göre; grafikler, harita ve okuma paneli birlikte güncellenir
    function setT(S, t, src) {
      if (t == null || !isFinite(t)) return; A.t = t = Math.max(S.t[0], Math.min(S.t[S.n - 1], t));
      for (const c of A.charts) if (c !== src && c.fromX && c.toX) c.setCursor(c.toX(t), true);
      const p = AC.posAt(S, t); if (A.map && p) A.map.cursor('c', p.lat, p.lon, '#fff');
      const r = root.querySelector('#an-read'); if (r) r.innerHTML = readoutHtml(S, t);
      const evs = root.querySelectorAll('.an-ev'); let best = null, bd = 4000; evs.forEach(b => { const dd = Math.abs(+b.dataset.t - t); if (dd < bd) { bd = dd; best = b; } b.classList.remove('near'); }); if (best) best.classList.add('near');
    }

    /* ====================== Karşılaştırma ====================== */
    async function openCompare(ida, idb) {
      teardown(); A.view = 'compare';
      shell(head('Sürüş Karşılaştırma', 'Yükleniyor…', true) + '<div class="an-empty"><b>Sürüşler yükleniyor…</b></div>');
      let SA, SB; try { [SA, SB] = await Promise.all([loadSolo(ida), loadSolo(idb)]); } catch (e) { shell(head('Sürüş Karşılaştırma', '', true) + empty('Sürüşler yüklenemedi', e.message)); return; }
      if (A.view !== 'compare') return;
      if (SA.t0 > SB.t0) [SA, SB] = [SB, SA];                  // A = eski, B = yeni: «Fark (B−A)» eskiden yeniye değişimi gösterir
      A.cmp = [SA, SB]; const rows = AC.compareSolo(SA, SB), CA = accentC(), CB = '#4FA3E0';
      const f = (r, v) => (v == null ? '—' : r.f === 'dist' ? fmt.dist(v) : r.f === 'dur' ? fmt.dur(v) : r.f === 'kmh' ? fmt.kmh(v) : r.f === 'deg' ? '≈ ' + Math.round(v) + '°' : String(v));
      const dl = r => (r.delta == null ? '—' : (r.delta > 0 ? '▲ ' : r.delta < 0 ? '▼ ' : '= ') + (r.f === 'dist' ? fmt.dist(Math.abs(r.delta)) : r.f === 'dur' ? fmt.dur(Math.abs(r.delta)) : r.f === 'kmh' ? fmt.kmh(Math.abs(r.delta)) : r.f === 'deg' ? Math.round(Math.abs(r.delta)) + '°' : Math.abs(r.delta)) + (r.pct != null && r.f !== 'n' ? ' (%' + n1(Math.abs(r.pct), 0) + ')' : ''));
      shell(`${head('Sürüş Karşılaştırma', `<span class="an-dot" style="background:${CA}"></span>${esc(fmt.date(SA.t0))} ${esc(fmt.time(SA.t0))} &nbsp; <span class="an-dot" style="background:${CB}"></span>${esc(fmt.date(SB.t0))} ${esc(fmt.time(SB.t0))}`, true)}
        <div class="an-detail"><div class="an-left"><div class="an-sticky"><div class="an-map" id="an-map"></div><div class="an-attr" id="an-attr"></div><div class="an-read" id="an-read"><p class="an-note">Grafikte bir noktaya dokun: iki sürüşün o andaki konumu haritada görünür.</p></div></div></div>
        <div class="an-right"><section class="an-sec"><h2>Özet Karşılaştırma</h2><div class="an-table"><div class="an-trh"><span></span><span style="color:${CA}">A</span><span style="color:${CB}">B</span><span>Fark (B−A)</span></div>
          ${rows.map(r => `<div class="an-tr"><span>${esc(r.label)}</span><span>${esc(f(r, r.a))}</span><span>${esc(f(r, r.b))}</span><span>${esc(dl(r))}</span>${r.note && (r.a == null || r.b == null) ? `<em>${esc(r.note)}</em>` : ''}</div>`).join('')}</div>
          <p class="an-note">Boş «—» alan o sürüşte ölçülmemiş demektir; sıfır sayılmaz ve fark hesaplanmaz. Yatış değerleri tahmindir.</p></section>
          <section class="an-sec"><h2>Hız – Mesafe</h2><div id="ch-d"></div></section><section class="an-sec"><h2>Hız – Süre</h2><div id="ch-t"></div></section></div></div>`);
      const ser = (S, c, k, name) => ({ name, color: c, pts: S.t.map((t, i) => [k === 'd' ? S.d[i] / 1000 : (t - S.t0) / 1000, S.v[i] == null ? null : S.v[i] * 3.6, S.ref[i] ? 1 : 0]), fmt: v => n1(v) + ' km/sa', width: 2 });
      const link = (c, toT) => c.onCursor(x => { for (const [S, k] of [[SA, 'a'], [SB, 'b']]) { const t = toT(S, x); const p = t == null ? null : AC.posAt(S, Math.min(S.t[S.n - 1], Math.max(S.t[0], t))); if (A.map) A.map.cursor(k, p && p.lat, p && p.lon, k === 'a' ? CA : CB); } const o = c.o.timeX ? 'zaman' : 'mesafe'; const rd = root.querySelector('#an-read'); if (rd) rd.innerHTML = `<div class="an-rd">${[[SA, 'A', CA], [SB, 'B', CB]].map(([S, nm, col]) => { const t = toT(S, x), i = t == null ? -1 : AC.nearestIdx(S, t); const v = i >= 0 && t <= S.t[S.n - 1] + 1000 ? S.v[i] : null; return `<span><small style="color:${col}">${nm} · ${o}</small><b>${v == null ? '—' : esc(fmt.kmh(v * 3.6))}</b><em>${i >= 0 ? esc(fmt.dist(S.d[i])) : ''}</em></span>`; }).join('')}</div>`; });
      const cd = new Chart(root.querySelector('#ch-d'), { h: 210, xFmt: v => n1(v, 1) + ' km', yMin: 0, label: 'Hız Mesafe Karşılaştırma' }); cd.setData([ser(SA, CA, 'd', 'A'), ser(SB, CB, 'd', 'B')]); link(cd, (S, x) => AC.tAtDist(S, x * 1000));
      const ct = new Chart(root.querySelector('#ch-t'), { h: 210, timeX: true, xFmt: v => fmt.clock(v), yMin: 0, gapX: 15, label: 'Hız Süre Karşılaştırma' }); ct.setData([ser(SA, CA, 't', 'A'), ser(SB, CB, 't', 'B')]); link(ct, (S, x) => S.t0 + x * 1000);
      A.charts.push(cd, ct);
      makeMap(root.querySelector('#an-map')).then(m => { if (A.view !== 'compare') { m.destroy(); return; } A.map = m; root.querySelector('#an-attr').innerHTML = m.attr || ''; m.clear(); const all = [];
        for (const [S, c] of [[SA, CA], [SB, CB]]) if (S.n) { const pts = S.lat.map((a, i) => [a, S.lon[i]]), keep = AC.simplify(pts, 6, 1500).map(i => pts[i]); m.line(keep, { color: c, weight: 4, opacity: 0.9 }); all.push(...keep); m.dot(S.start.lat, S.start.lon, { radius: 6, color: '#031420', weight: 2, fillColor: c, fillOpacity: 1 }, 'Başlangıç'); }
        m.fit(all); m.invalidate(); });
    }

    /* ====================== Grup analizi ====================== */
    const GL = { start: 'Grup sürüşü başladı', end: 'Grup sürüşü bitti', join: u => u + ' gruba katıldı', leave: u => u + ' gruptan ayrıldı', kick: u => u + ' gruptan çıkarıldı', leader: u => 'Lider: ' + u, 'share-on': u => u + ' konum paylaşmaya başladı', 'share-off': u => u + ' paylaşımı durdurdu', 'alert-behind': (u, x) => u + ' geride kaldı' + (x ? ' (' + fmt.dist(x) + ')' : ''), 'alert-away': (u, x) => u + ' gruptan uzaklaştı' + (x ? ' (' + fmt.dist(x) + ')' : ''), 'alert-off': (u, x) => u + ' güzergâhtan ayrıldı' + (x ? ' (' + fmt.dist(x) + ')' : ''), route: 'Grup güzergâhı güncellendi', 'rec-limit': 'Kayıt sınırına ulaşıldı' };
    function gEvents(G) { return G.events.filter(e => GL[e.kind] && e.kind !== 'alert-clear').map(e => { const l = GL[e.kind]; const m = e.u ? G.members.find(x => x.u === e.u) : null; const p = m && m.S.t.length ? AC.posAt(m.S, e.t) : null; return { t: e.t, kind: e.kind, u: e.u, label: typeof l === 'function' ? l(e.u, e.extra) : l, lat: p ? p.lat : null, lon: p ? p.lon : null }; }); }
    function barRows(G, key, label, f, getter) {
      const vals = G.members.map(m => getter(m)), mx = Math.max(0, ...vals.filter(v => v != null));
      return `<div class="an-bars"><h3>${esc(label)}</h3>${G.members.map((m, i) => { const v = vals[i]; return `<button type="button" class="an-bar ${A.hidden.has(m.u) ? 'off' : ''}" data-a="gm" data-u="${esc(m.u)}"><span class="an-bn"><i style="background:${m.color}"></i>${esc(m.u)}${m.u === G.leader ? ' <em>lider</em>' : ''}</span>${v == null ? '<span class="an-bv na">Konum paylaşmadı</span>' : `<span class="an-bt"><span style="width:${mx ? Math.max(2, v / mx * 100) : 2}%;background:${m.color}"></span></span><span class="an-bv">${esc(f(v))}</span>`}</button>`; }).join('')}</div>`;
    }
    async function openGroup(gid, rid) {
      teardown(); A.view = 'group'; A.hidden = new Set(); A.t = null;
      shell(head('Grup Sürüşü Analizi', 'Yükleniyor…', true) + '<div class="an-empty"><b>Grup sürüşü yükleniyor…</b></div>');
      let G; try { G = await loadGroup(gid, rid); } catch (e) { shell(head('Grup Sürüşü Analizi', '', true) + empty('Grup sürüşü yüklenemedi', e.status === 404 ? 'Bu kayda erişimin yok ya da kayıt silinmiş.' : e.message)); return; }
      if (A.view !== 'group') return; A.G = G;
      const withData = G.members.filter(m => m.sum), dur = (G.tEnd - G.startedAt) / 1000, alerts = G.members.reduce((a, m) => a + m.alerts.behind + m.alerts.away + m.alerts.off, 0), derived = m => { const k = m.S.v.filter(v => v != null).length; return k ? Math.round(m.S.src.filter((s, i) => s === 'p' && m.S.v[i] != null).length / k * 100) : null; };
      const gapStat = m => { const v = (G.gap.get(m.u) || []).filter(x => x[1] != null).map(x => x[1]); return v.length ? { avg: v.reduce((a, b) => a + b, 0) / v.length, max: Math.max(...v) } : null; };
      shell(`${head(G.name || 'Grup Sürüşü', esc(fmt.date(G.startedAt)) + ' · ' + esc(fmt.time(G.startedAt)) + (G.endedAt ? ' – ' + esc(fmt.time(G.endedAt)) : ' · devam ediyor'), true)}
        <div class="an-detail"><div class="an-left"><div class="an-cards">${card('Süre', G.endedAt ? esc(fmt.dur(dur)) : 'devam ediyor', '')}${card('Konum Paylaşan', withData.length + ' / ' + G.members.length, 'üye')}${card('Lider', esc(G.leader || '—'), G.leaders.length > 1 ? 'sürüş sırasında ' + (G.leaders.length - 1) + ' kez değişti' : '')}${card('Grup güzergâhı', G.route ? esc(fmt.dist(G.routeLen)) : '—', G.route ? '' : 'belirlenmedi')}${card('Uyarı', alerts, 'geride / uzak / rota dışı')}</div>
          <div class="an-sticky"><div class="an-map" id="an-map"></div><div class="an-legend"><span class="an-key"><i class="dash"></i> grup güzergâhı</span><span class="an-key"><i></i> üye izleri</span></div><div class="an-attr" id="an-attr"></div><div class="an-read" id="an-read"><p class="an-note">Grafikte bir zamana dokun: tüm üyelerin o andaki konumu haritada görünür.</p></div></div></div>
        <div class="an-right"><section class="an-sec"><h2>Üyeler</h2><div class="an-chips" id="an-mem">${G.members.map(m => `<button type="button" data-a="gm" data-u="${esc(m.u)}" aria-pressed="${!A.hidden.has(m.u)}" ${m.sum ? '' : 'class="na"'}><i style="background:${m.color}"></i>${esc(m.u)}</button>`).join('')}</div><p class="an-note">Üye adına dokunarak grafik ve haritada göster/gizle.</p></section>
          <section class="an-sec"><h2>Karşılaştırma</h2>${barRows(G, 'd', 'Sürüş Mesafesi', fmt.dist, m => (m.sum ? m.sum.distM : null))}${barRows(G, 's', 'Ortalama Hız (hareket)', fmt.kmh, m => (m.sum ? m.sum.avgMovingKmh : null))}${barRows(G, 'x', 'Maksimum Hız', fmt.kmh, m => (m.sum ? m.sum.maxKmh : null))}${barRows(G, 't', 'Paylaşım Süresi', fmt.dur, m => (m.sum ? m.sum.durationS : null))}</section>
          <section class="an-sec"><h2>Performans Tablosu</h2><div class="an-scroll"><table class="an-tbl"><thead><tr><th>Üye</th><th>Mesafe</th><th>Süre</th><th>Ort.</th><th>Maks.</th><th>Lider ile Mesafe</th><th>Uyarı</th></tr></thead><tbody>${G.members.map(m => { const gs = gapStat(m), s = m.sum; return `<tr><td><i style="background:${m.color}"></i>${esc(m.u)}${m.u === G.leader ? ' ★' : ''}</td>${s ? `<td>${esc(fmt.dist(s.distM))}</td><td>${esc(fmt.dur(s.durationS))}</td><td>${esc(fmt.kmh(s.avgMovingKmh))}</td><td>${esc(fmt.kmh(s.maxKmh))}</td><td>${m.u === G.leader ? 'lider' : gs ? 'ort. ' + esc(fmt.dist(gs.avg)) + ' · maks. ' + esc(fmt.dist(gs.max)) : '—'}</td><td>${m.alerts.behind + m.alerts.away + m.alerts.off ? `${m.alerts.behind} geride · ${m.alerts.away} uzak · ${m.alerts.off} rota dışı` : '0'}</td>` : '<td colspan="6" class="na">Konum paylaşmadı: veri yok</td>'}</tr>`; }).join('')}</tbody></table></div>
            <p class="an-note">Veriler yalnızca üyenin konum paylaştığı süre boyunca kayıtlıdır (paylaşım açma/kapama aralıkları süreden düşülür). Hız, cihaz ölçümü yoksa ardışık konumlardan türetilir${withData.some(m => derived(m)) ? ' (' + withData.filter(m => derived(m)).map(m => m.u + ' %' + derived(m)).join(', ') + ')' : ''}. Lider ile mesafe yalnızca iki konum da taze iken hesaplanır.</p></section>
          <section class="an-sec"><h2>Hız – Zaman</h2><div id="ch-gs"></div></section><section class="an-sec"><h2>Lider ile Mesafe</h2><div id="ch-gg"></div></section><section class="an-sec"><h2>Mesafe – Zaman</h2><div id="ch-gd"></div></section>
          <section class="an-sec"><h2>Olay Zaman Çizelgesi</h2><div class="an-evs" id="an-evs">${gEvents(G).map(e => `<button type="button" class="an-ev ev-${e.kind.startsWith('alert') ? 'gap' : e.kind}" data-a="gev" data-t="${e.t}" data-u="${esc(e.u || '')}"><i>${e.kind.startsWith('alert') ? '⚠' : e.kind === 'start' ? '▶' : e.kind === 'end' ? '■' : e.kind === 'leader' ? '★' : '•'}</i><span><b>${esc(e.label)}</b><small>${esc(fmt.clock((e.t - G.startedAt) / 1000))} · ${esc(fmt.timeS(e.t))}</small></span></button>`).join('') || '<p class="an-note">Kayıtlı olay yok.</p>'}</div></section></div></div>`);
      buildGroupVisuals(G);
    }
    function buildGroupVisuals(G) {
      const xs = t => (t - G.startedAt) / 1000, vis = () => G.members.filter(m => !A.hidden.has(m.u));
      const spd = m => m.S.t.map((t, i) => [xs(t), m.S.v[i] == null ? null : m.S.v[i] * 3.6, m.S.ref[i] ? 1 : 0]);
      const dst = m => m.S.t.map((t, i) => [xs(t), m.S.d[i] / 1000, m.S.ref[i] ? 1 : 0]);
      const gap = m => (G.gap.get(m.u) || []).map(x => [xs(x[0]), x[1]]);
      const defs = [['ch-gs', { h: 210, timeX: true, xFmt: v => fmt.clock(v), yMin: 0, gapX: 15, label: 'Üye Hız Grafiği' }, m => (m.sum ? { name: m.u, color: m.color, pts: spd(m), fmt: v => n1(v) + ' km/sa', width: m.u === G.leader ? 3 : 2 } : null)],
        ['ch-gg', { h: 200, timeX: true, xFmt: v => fmt.clock(v), yMin: 0, gapX: 6, yFmt: v => (v >= 1000 ? n1(v / 1000, 1) + ' km' : Math.round(v) + ' m'), label: 'Lider ile mesafe grafiği' }, m => (m.sum && m.u !== G.leader && gap(m).some(p => p[1] != null) ? { name: m.u, color: m.color, pts: gap(m), fmt: v => fmt.dist(v) } : null)],
        ['ch-gd', { h: 200, timeX: true, xFmt: v => fmt.clock(v), yMin: 0, gapX: 15, yFmt: v => n1(v, 1) + ' km', label: 'Üye Mesafe Grafiği' }, m => (m.sum ? { name: m.u, color: m.color, pts: dst(m), fmt: v => n1(v, 2) + ' km' } : null)]];
      const build = () => {
        for (const c of A.charts) c.destroy(); A.charts = [];
        for (const [id, o, f] of defs) {
          const host = root.querySelector('#' + id); if (!host) continue; const ser = vis().map(f).filter(Boolean);
          if (!ser.length) { host.innerHTML = empty(id === 'ch-gg' ? 'Lider ile mesafe: veri yok' : 'Veri yok', id === 'ch-gg' ? 'Lider ya da üye konumu aynı anda taze olmadığı için mesafe hesaplanamadı.' : 'Gösterilecek üye verisi yok.'); continue; }
          host.innerHTML = ''; const c = new Chart(host, o); const th = id === 'ch-gg' && G.gapM ? [{ name: '', color: '#F2C94C', pts: [[0, G.gapM], [(G.tEnd - G.startedAt) / 1000, G.gapM]], dash: '5 4', width: 1.5 }] : [];
          c.setData(ser.concat(th), { xDomain: [0, Math.max(1, (G.tEnd - G.startedAt) / 1000)] }); c.toX = xs; c.fromX = x => G.startedAt + x * 1000; c.onCursor(x => setG(G, G.startedAt + x * 1000, c)); A.charts.push(c);
        }
        if (A.t != null) setG(G, A.t, null);
      };
      A.gbuild = build; build();
      makeMap(root.querySelector('#an-map')).then(m => { if (A.view !== 'group' || A.G !== G) { m.destroy(); return; } A.map = m; root.querySelector('#an-attr').innerHTML = m.attr || ''; drawGroupMap(G); });
    }
    function drawGroupMap(G) {
      const m = A.map; if (!m) return; m.clear(); const all = [];
      if (G.route) { const rp = G.route; m.line(rp, { color: '#4FA3E0', weight: 6, opacity: 0.95, dashArray: '2 10', lineCap: 'round' }); all.push(...rp); }
      for (const mem of G.members) { if (!mem.S.t.length || A.hidden.has(mem.u)) continue; const pts = mem.S.lat.map((a, i) => [a, mem.S.lon[i]]), keep = AC.simplify(pts, 6, 1200); const out = []; let prev = -1;
        for (const i of keep) { if (prev >= 0 && mem.S.ref[i]) { if (out.length > 1) m.line(out.map(p => p), { color: mem.color, weight: 4, opacity: 0.9 }, (la, lo) => setG(G, mem.S.t[nearestSample(mem.S, la, lo)], 'map')); out.length = 0; } out.push(pts[i]); prev = i; }
        if (out.length > 1) m.line(out, { color: mem.color, weight: 4, opacity: 0.9 }, (la, lo) => setG(G, mem.S.t[nearestSample(mem.S, la, lo)], 'map')); all.push(...keep.map(i => pts[i]));
        m.dot(mem.start.lat, mem.start.lon, { radius: 5, color: '#031420', weight: 1.5, fillColor: mem.color, fillOpacity: 1 }, mem.u + ' · başlangıç'); }
      if (all.length) m.fit(all); m.invalidate();
    }
    function setG(G, t, src) {
      A.t = t; for (const c of A.charts) if (c !== src && c.fromX) c.setCursor(c.toX(t), true);
      const rows = [];
      for (const mem of G.members) {
        const hide = A.hidden.has(mem.u), p = !hide && mem.S.t.length ? AC.freshPos(mem.S, t) : null;
        if (A.map) A.map.cursor('g:' + mem.u, p && p.lat, p && p.lon, mem.color, mem.u);
        const i = mem.S.t.length ? AC.nearestIdx(mem.S, t) : -1, near = i >= 0 && Math.abs(mem.S.t[i] - t) <= 6000, v = near ? mem.S.v[i] : null, gp = (G.gap.get(mem.u) || [])[Math.round((t - G.startedAt) / 5000)];
        rows.push(`<tr class="${hide ? 'off' : ''}"><td><i style="background:${mem.color}"></i>${esc(mem.u)}</td><td>${!mem.sum ? 'paylaşmadı' : near ? (v == null ? '—' : esc(fmt.kmh(v * 3.6))) : 'konum yok'}</td><td>${mem.u === G.leader ? 'lider' : gp && gp[1] != null ? esc(fmt.dist(gp[1])) : '—'}</td></tr>`);
      }
      const r = root.querySelector('#an-read'); if (r) r.innerHTML = `<div class="an-rd"><span class="wide"><small>Zaman</small><b>${esc(fmt.clock((t - G.startedAt) / 1000))}</b><em>${esc(fmt.timeS(t))}</em></span></div><table class="an-tbl mini"><thead><tr><th>Üye</th><th>Hız</th><th>Lider ile</th></tr></thead><tbody>${rows.join('')}</tbody></table>`;
      const evs = root.querySelectorAll('.an-ev'); let best = null, bd = 6000; evs.forEach(b => { const dd = Math.abs(+b.dataset.t - t); if (dd < bd) { bd = dd; best = b; } b.classList.remove('near'); }); if (best) best.classList.add('near');
    }

    /* ====================== Olaylar ====================== */
    root.addEventListener('click', e => {
      const b = e.target.closest('[data-a]'); if (!b) return; const a = b.dataset.a;
      if (a === 'gall') { A.gFilter = null; renderList(); }
      else if (a === 'tab') { A.tab = b.dataset.tab; A.sel = []; A.gFilter = null; renderList(); if (A.tab === 'group' && !A.gLoaded) loadGroups(); }
      else if (a === 'open') { A.sel = []; openSolo(b.dataset.id); }
      else if (a === 'gopen') openGroup(b.dataset.gid, b.dataset.id);
      else if (a === 'exit') { if (opts && opts.onExit) opts.onExit(); }
      else if (a === 'range') { A.range = b.dataset.r; lss(RNG, A.range); A.sel = []; renderList(); }
      else if (a === 'reset') { A.confirm = true; renderList(); }
      else if (a === 'reset-no') { A.confirm = false; renderList(); }
      else if (a === 'reset-yes') { lss(RKEY(), String(Date.now())); A.confirm = false; A.sel = []; renderList(); }
      else if (a === 'reset-undo') { lss(RKEY(), null); renderList(); }
      else if (a === 'back') { A.view = 'list'; renderList(); if (A.tab === 'solo' && A.sumBusy === false) ensureSummaries(); }
      else if (a === 'compare') openCompare(A.sel[0], A.sel[1]);
      else if (a === 'cmpwith') { A.view = 'list'; A.tab = 'solo'; A.sel = [A.S.id]; renderList(); const bar = root.querySelector('.an-cmpbar span'); if (bar) bar.textContent = 'Karşılaştırmak için ikinci sürüşü seç'; }
      else if (a === 'goStart' && A.S && A.map) { setT(A.S, A.S.start.t, 'x'); A.map.panTo(A.S.start.lat, A.S.start.lon); }
      else if (a === 'goEnd' && A.S && A.map) { setT(A.S, A.S.end.t, 'x'); A.map.panTo(A.S.end.lat, A.S.end.lon); }
      else if (a === 'evf') { A.evFilter = b.dataset.f; root.querySelector('#an-evs').innerHTML = eventsHtml(A.S, A.evFilter); root.querySelectorAll('#an-evf button').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.f === A.evFilter))); }
      else if (a === 'ev' && A.S) { const t = +b.dataset.t; setT(A.S, t, 'x'); const e2 = A.S.events.find(x => x.t === t); if (A.map && e2 && e2.lat != null) A.map.panTo(e2.lat, e2.lon); const mp = root.querySelector('#an-map'); if (mp && mp.getBoundingClientRect().top < 0) mp.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
      else if (a === 'gev' && A.G) { const t = +b.dataset.t; setG(A.G, t, 'x'); const mem = A.G.members.find(m => m.u === b.dataset.u); const p = mem && mem.S.t.length ? AC.posAt(mem.S, t) : null; if (A.map && p) A.map.panTo(p.lat, p.lon); }
      else if (a === 'gm' && A.G) { const u = b.dataset.u; if (A.hidden.has(u)) A.hidden.delete(u); else A.hidden.add(u); root.querySelectorAll(`[data-a=gm][data-u="${CSS.escape(u)}"]`).forEach(x => { x.classList.toggle('off', A.hidden.has(u)); if (x.hasAttribute('aria-pressed')) x.setAttribute('aria-pressed', String(!A.hidden.has(u))); }); A.gbuild(); drawGroupMap(A.G); if (A.t != null) setG(A.G, A.t, null); }
    });
    root.addEventListener('change', e => {
      const b = e.target.closest('input[data-a=pick]'); if (!b) return; const id = b.dataset.id;
      if (b.checked) { if (A.sel.length >= 2) A.sel.shift(); if (!A.sel.includes(id)) A.sel.push(id); } else A.sel = A.sel.filter(x => x !== id);
      root.querySelectorAll('.an-row').forEach(r => { const on = A.sel.includes(r.dataset.id); r.classList.toggle('sel', on); const cb = r.querySelector('input[data-a=pick]'); if (cb) cb.checked = on; });
      const bar = root.querySelector('.an-cmpbar'); if (bar) { bar.hidden = A.sel.length !== 2; bar.querySelector('span').textContent = '2 sürüş seçildi'; }
    });
    const render = () => { if (A.view === 'list') renderList(); };
    renderList();
    return {
      activate() { A.active = true; if (A.view === 'list') { if (A.tab === 'solo') loadRides(); else loadGroups(); } else if (A.map) setTimeout(() => A.map && A.map.invalidate(), 50); },
      deactivate() { A.active = false; },
      openRide(id) { A.tab = 'solo'; if (!A.loaded) loadRides().then(() => openSolo(id)); else openSolo(id); },
      openGroupList(gid) { A.tab = 'group'; A.view = 'list'; A.gFilter = gid || null; renderList(); loadGroups(); },
      _A: A
    };
  }
  window.Analysis = { mount, Chart, speedColor };
})();
