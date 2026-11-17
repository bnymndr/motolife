'use strict';
/* Harita ve Navigasyon ekranı.
   index.html ilk açılışta /map.css ve bu dosyayı yükler → window.MotoMap.mount(kök, {}) → activate()/deactivate().
   Harita: Leaflet 1.9.4 (cdnjs, sabit sürüm). Karo adresi, arama ve rota sunucudan (maps.js) gelir.
   Dışa açık API:  MotoMap.mount(root, { user, ... }) → { activate, deactivate, flyToMe, startEvent, prefs, openSensors } */
(function () {
  /* ================= Çekirdek: tarayıcıdan bağımsız hesaplar (Node ile test edilir) ================= */
  const toRad = d => d * Math.PI / 180;
  function haversine(lat1, lon1, lat2, lon2) {
    const a = Math.sin(toRad(lat2 - lat1) / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(toRad(lon2 - lon1) / 2) ** 2;
    return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(a)));
  }
  const nf1 = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  function fmtDist(m) {
    if (!isFinite(m)) return '—';
    if (m < 1000) return Math.round(m) + ' m';
    return m < 100000 ? nf1.format(m / 1000) + ' km' : Math.round(m / 1000) + ' km';
  }
  function fmtClock(sec) {
    sec = Math.max(0, Math.floor(sec));
    const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60, p = n => String(n).padStart(2, '0');
    return h ? `${h}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`;
  }
  function fmtEta(sec) {
    if (!isFinite(sec)) return '—';
    const m = Math.max(1, Math.round(sec / 60));
    return m < 60 ? m + ' dk' : Math.floor(m / 60) + ' sa ' + (m % 60) + ' dk';
  }
  const kmh = ms => (ms == null || !isFinite(ms) ? null : ms * 3.6);

  class RouteTracker {
    // distance (sağlayıcının verdiği gerçek rota mesafesi, m) verilirse, sadeleştirilmiş geometrinin kısalığı oranla düzeltilir
    constructor(coords, duration, distance) {
      this.c = coords; this.dur = duration; this.cum = [0];
      for (let i = 1; i < coords.length; i++) this.cum.push(this.cum[i - 1] + haversine(coords[i - 1][0], coords[i - 1][1], coords[i][0], coords[i][1]));
      const geo = this.cum[this.cum.length - 1] || 0;
      this.scale = distance > 0 && geo > 0 && distance / geo > 0.8 && distance / geo < 1.25 ? distance / geo : 1;
      if (this.scale !== 1) this.cum = this.cum.map(v => v * this.scale);
      this.total = this.cum[this.cum.length - 1] || 0;
    }
    // Konumun rotaya en yakın noktası: rotadan sapma (m) ve kalan mesafe (m)
    progress(lat, lon) {
      if (this.c.length < 2) return { off: 0, remaining: 0 };
      const kx = 111320 * Math.cos(toRad(lat)), ky = 110540;
      let best = Infinity, along = 0;
      for (let i = 0; i < this.c.length - 1; i++) {
        const ax = (this.c[i][1] - lon) * kx, ay = (this.c[i][0] - lat) * ky;
        const dx = (this.c[i + 1][1] - lon) * kx - ax, dy = (this.c[i + 1][0] - lat) * ky - ay, l2 = dx * dx + dy * dy;
        const t = l2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2)) : 0;
        const d = Math.hypot(ax + t * dx, ay + t * dy);
        if (d < best) { best = d; along = this.cum[i] + t * (this.cum[i + 1] - this.cum[i]); }
      }
      return { off: best, remaining: Math.max(0, this.total - along) };
    }
  }
  // Tahmini kalan süre (sn): planlanan ortalama hız ile, gidilen yolda ölçülen gerçek hareket hızının karışımı.
  // Ölçüm yetersizse (<500 m / <60 sn) yalnızca plan; ölçüm arttıkça (3 km'de tam) gerçek hıza kayar. API çağrısı gerektirmez.
  function estimateEta(o) {
    const remaining = o.remaining, planDist = o.planDist, planDur = o.planDur, movedM = o.movedM || 0, movingS = o.movingS || 0;
    if (!(remaining >= 0) || !(planDist > 0) || !(planDur > 0)) return NaN;
    const vPlan = planDist / planDur, w = movedM >= 500 && movingS >= 60 ? Math.min(1, movedM / 3000) : 0;
    const v = Math.min(40, Math.max(2, (1 - w) * vPlan + w * (movingS > 0 ? movedM / movingS : vPlan)));
    return remaining / v;
  }

  // Konum düzeltici (ekranda gösterilen konum için; ham GPS kaydı/paylaşımı DEĞİŞMEZ): tek varyanslı Kalman süzgeci.
  // Süreç gürültüsü hızla büyür (hızlıyken çabuk takip, dururken titreme bastırılır); ölçüm gürültüsü cihazın bildirdiği doğruluktur.
  // Reddedilen: son 30 sn içinde iyi konum varken doğruluğu >100 m olan nokta; 3 kez üst üste gelmedikçe imkânsız sıçrama (>70 m/sn ve >60 m).
  class Smoother {
    constructor() { this.reset(); }
    reset() { this.lat = this.lon = null; this.v = 0; this.t = 0; this.bad = 0; }
    push(f) {
      const acc = Math.max(Number.isFinite(f.acc) ? f.acc : 50, 3);
      if (this.lat != null) {
        const age = (f.t - this.t) / 1000;
        if (age >= 30 || age < -5) this.reset();
        else if (acc > 100) return null;
      }
      if (this.lat == null) { this.lat = f.lat; this.lon = f.lon; this.v = acc * acc; this.t = f.t; this.bad = 0; return this.out(); }
      const dt = Math.max(0, (f.t - this.t) / 1000), d = haversine(this.lat, this.lon, f.lat, f.lon);
      if (dt > 0 && d > Math.max(3 * Math.max(acc, Math.sqrt(this.v)), 60) && d / dt > 70) {
        if (++this.bad < 3) return null;
        this.reset(); return this.push(f);
      }
      this.bad = 0;
      const q = Math.max(f.speed != null && isFinite(f.speed) ? f.speed : 3, 1.5);
      this.v += dt * q * q;
      const k = this.v / (this.v + acc * acc);
      this.lat += k * (f.lat - this.lat); this.lon += k * (f.lon - this.lon);
      this.v = (1 - k) * this.v; this.t = Math.max(this.t, f.t);
      return this.out();
    }
    out() { return { lat: this.lat, lon: this.lon }; }
  }
  // Yol tarifi: konumun rota üzerindeki yeri (along, m) verilince sıradaki manevra. steps[i].at = manevranın rota üzerindeki konumu (m).
  function nextStep(steps, along) {
    if (!steps || !steps.length) return null;
    let i = 0; while (i < steps.length && steps[i].at <= along + 12) i++;
    if (i >= steps.length) i = steps.length - 1;
    if (along < 25 && i === 1 && steps[0].mod === 'depart') return { i: 0, step: steps[0], dist: Math.max(0, steps[1].at - along) };
    return { i, step: steps[i], dist: Math.max(0, steps[i].at - along) };
  }

  const Core = { haversine, fmtDist, fmtClock, fmtEta, RouteTracker, estimateEta, Smoother, nextStep };
  if (typeof module !== 'undefined' && module.exports) module.exports = Core;
  if (typeof window === 'undefined') return;

  /* ================= Tarayıcı: harita ekranı ================= */
  const LEAFLET = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} }
  };
  const ic = d => `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const ICON = {
    search: ic('<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>'),
    plus: ic('<path d="M12 5v14M5 12h14"/>'),
    minus: ic('<path d="M5 12h14"/>'),
    headset: ic('<path d="M4 14v-2a8 8 0 0116 0v2"/><rect x="3" y="14" width="4" height="6" rx="1.5"/><rect x="17" y="14" width="4" height="6" rx="1.5"/><path d="M19 20c0 1.5-2 2-5 2"/>'),
    mic: ic('<rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0014 0M12 18v3"/>'),
    micoff: ic('<path d="M3 3l18 18"/><path d="M9 9v2a3 3 0 005 2M15 10V6a3 3 0 00-5.6-1.5"/><path d="M5 11a7 7 0 0011 5M12 18v3"/>'),
    music: ic('<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>'),
    locate: ic('<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>'),
    back: ic('<path d="M15 5l-7 7 7 7"/>'),
    route: ic('<circle cx="6" cy="18" r="2.4"/><circle cx="18" cy="6" r="2.4"/><path d="M8.4 18H14a3.5 3.5 0 0 0 0-7h-4a3.5 3.5 0 0 1 0-7h5.6"/>'),
    menu: ic('<path d="M4 7h16M4 12h16M4 17h16"/>'),
    close: ic('<path d="M6 6l12 12M18 6L6 18"/>'),
    play: '<svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>',
    nav: ic('<path d="M3 11l18-8-8 18-2-8-8-2z"/>'),
    chev: ic('<path d="M6 9l6 6 6-6"/>'),
  };
  const arrow = (deg, w) => `<svg viewBox="0 0 24 24" width="${w || 26}" height="${w || 26}" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><g transform="rotate(${deg} 12 12)"><path d="M12 20V5M6 11l6-6 6 6"/></g></svg>`;
  const svg24 = (d, w) => `<svg viewBox="0 0 24 24" width="${w || 26}" height="${w || 26}" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const STEP_ICON = (m, w) => ({
    left: arrow(-90, w), right: arrow(90, w), 'slight-left': arrow(-40, w), 'slight-right': arrow(40, w), 'sharp-left': arrow(-135, w), 'sharp-right': arrow(135, w),
    uturn: svg24('<path d="M8 21V9a4 4 0 0 1 8 0v8M12 13l4 4 4-4"/>', w), roundabout: svg24('<circle cx="12" cy="15" r="5"/><path d="M12 10V3M9 6l3-3 3 3"/>', w),
    arrive: svg24('<path d="M12 21s-6-5.5-6-10a6 6 0 0 1 12 0c0 4.5-6 10-6 10z"/><circle cx="12" cy="11" r="2"/>', w), depart: svg24('<path d="M3 11l18-8-8 18-2-8-8-2z"/>', w),
    ferry: svg24('<path d="M3 17c2 2 4 2 6 0s4-2 6 0 4 2 6 0M5 13l1-6h12l1 6z"/>', w)
  }[m] || arrow(0, w));
  const accent = () => { try { return getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#EA8621'; } catch { return '#EA8621'; } };
  const accentLight = () => { try { return getComputedStyle(document.documentElement).getPropertyValue('--accent-2').trim() || '#F2A64E'; } catch { return '#F2A64E'; } };
  const PIN = () => '<svg viewBox="0 0 32 40" width="32" height="40" aria-hidden="true"><path d="M16 39S3 26.5 3 15a13 13 0 0 1 26 0c0 11.500-13 24-13 24z" fill="'+accent()+'" stroke="#031420" stroke-width="2"/><circle cx="16" cy="15" r="5" fill="#031420"/></svg>';

  function loadScripts(list) {
    return list.reduce((p, src) => p.then(() => new Promise((res, rej) => {
      const name = src.includes('core') ? 'RideCore' : 'RideStore';
      if (window[name]) return res();
      const sc = document.createElement('script'); sc.src = src;
      sc.onload = () => res(); sc.onerror = () => { sc.remove(); rej(new Error('Sürüş modülü yüklenemedi.')); };
      document.head.appendChild(sc);
    })), Promise.resolve());
  }
  let leafletP = null;
  function loadLeaflet() {
    if (window.L && window.L.map) return Promise.resolve();
    if (leafletP) return leafletP;
    leafletP = new Promise((res, rej) => {
      if (!document.getElementById('mm-leaflet-css')) {
        const l = document.createElement('link'); l.id = 'mm-leaflet-css'; l.rel = 'stylesheet'; l.href = LEAFLET + 'css'; l.crossOrigin = 'anonymous';
        document.head.appendChild(l);
      }
      const s = document.createElement('script'); s.src = LEAFLET + 'js'; s.crossOrigin = 'anonymous';
      s.onload = () => (window.L && window.L.map ? res() : (leafletP = null, rej(new Error('Harita kütüphanesi hazır değil.'))));
      s.onerror = () => { leafletP = null; s.remove(); rej(new Error('Harita kütüphanesi yüklenemedi. İnternet bağlantını kontrol et.')); };
      document.head.appendChild(s);
    });
    return leafletP;
  }

  const TEMPLATE = `
  <div class="mm" id="mm" data-theme="dark">
    <div class="mm-map" id="mm-map"></div>
    <button type="button" class="mm-ctr" id="mm-ctr" hidden aria-label="Konumuma Ortala"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4"/></svg>Ortala</button>
    <div class="mm-load" id="mm-load"><p id="mm-load-msg">Harita yükleniyor…</p><button type="button" class="mm-retry" id="mm-retry" hidden>Tekrar Dene</button></div>

    <div class="mm-top">
      <div id="mm-head">
        <div class="mm-navbar" id="mm-navbar" hidden>
          <button type="button" class="mm-turn" id="mm-turn" hidden aria-label="Yol Tarifini Aç"><span class="mm-ti" id="mm-turn-i"></span><span class="mm-tt"><b id="mm-turn-d">—</b><span id="mm-turn-x"></span></span></button>
          <div class="mm-navinfo">
            <div class="mm-navto" id="mm-navto"></div>
            <div class="mm-navnums"><b id="mm-navrem">—</b><span id="mm-naveta"></span></div>
            <div class="mm-navnote" id="mm-navnote"></div>
          </div>
          <div class="mm-nbtns">
            <button type="button" class="mm-nb" id="mm-newdest">Yeni Hedef</button>
            <button type="button" class="mm-nb stop" id="mm-navstop">Bitir</button>
          </div>
        </div>
      </div>
      <div class="mm-chiprow">
        <div class="mm-chip" id="mm-gps" data-s="warn">GPS aranıyor…</div>
        <div class="mm-chip" id="mm-grp" data-s="warn" hidden></div>
      </div>
    </div>

    <div class="mm-side" id="mm-side">
      <button type="button" class="mm-btn" id="mm-zin" aria-label="Yakınlaştır">${ICON.plus}</button>
      <button type="button" class="mm-btn" id="mm-zout" aria-label="Uzaklaştır">${ICON.minus}</button>
      <button type="button" class="mm-btn" id="mm-loc" aria-label="Konumuma Dön">${ICON.locate}</button>
      <button type="button" class="mm-btn" id="mm-rtbtn" aria-label="Ara ve Rota Oluştur">${ICON.route}</button>
      <button type="button" class="mm-btn" id="mm-mbtn" aria-label="Harita Ayarları" aria-expanded="false">${ICON.menu}</button>
      <div class="mm-menu" id="mm-menu" hidden>
        <div class="mm-mrow"><span>Harita Teması</span>
          <div class="mm-seg"><button type="button" data-th="dark">Koyu</button><button type="button" data-th="light">Açık</button></div></div>
        <label class="mm-mrow"><span>Sürüşte Ekranı Açık Tut</span><input type="checkbox" id="mm-wake"></label>
        <div class="mm-mrow"><span>Sürüş Ekranı</span><div class="mm-seg mm-segs" id="mm-hudseg"><button type="button" data-hud="full">Tam</button><button type="button" data-hud="bar">Şerit</button><button type="button" data-hud="speed">Hız</button><button type="button" data-hud="card">Kart</button></div></div>
        <div class="mm-mrow"><span>Sensörler (yatış, ivme)</span><button type="button" class="mm-mini" id="mm-tbtn">Kapalı</button></div>
        <div class="mm-mrow mm-saved"><span id="mm-savedtxt">Kayıtlı Sürüş: —</span><button type="button" class="mm-mini" id="mm-syncbtn" hidden>Eşitle</button></div>
        <p class="mm-note" id="mm-synchint" hidden></p>
        <p class="mm-note" id="mm-wakenote">Konum kaydı için sürüş boyunca uygulamayı ön planda ve ekranı açık tut. Ekran kilitlenirse ya da başka uygulamaya geçersen konum alınamayabilir.</p>
      </div>
    </div>

    <div class="mm-rt" id="mm-rt" hidden role="dialog" aria-label="Rota">
      <div class="mm-rthead"><button type="button" class="mm-rtback" id="mm-rtback" aria-label="Haritaya Dön">${ICON.back}<span>Harita</span></button><b>Rota</b></div>
      <form class="mm-search" id="mm-form" role="search" autocomplete="off">
          <span class="mm-sico">${ICON.search}</span>
          <input id="mm-q" type="search" inputmode="search" enterkeyhint="search" placeholder="Nereye gidiyorsun?" aria-label="Gidilecek Yeri Ara" maxlength="120">
          <button type="submit" class="mm-go" id="mm-go">Ara</button>
      </form>
      <div class="mm-results" id="mm-results" hidden></div>
      <div class="mm-rtbody" id="mm-rtbody">
      <div class="mm-card" id="mm-dest" hidden>
        <div class="mm-dtop">
          <div class="mm-dtxt"><div class="mm-dtitle" id="mm-dtitle"></div><div class="mm-dsub" id="mm-dsub"></div></div>
          <button type="button" class="mm-x" id="mm-dclear" aria-label="Hedefi Kaldır">${ICON.close}</button>
        </div>
        <div class="mm-dline" id="mm-dline"></div>
        <div class="mm-rinfo" id="mm-rinfo" hidden>
          <div class="mm-rnums"><b id="mm-rdist">—</b><span id="mm-reta"></span></div>
          <div class="mm-rlabel" id="mm-rlabel"></div>
        </div>
        <div class="mm-chips" id="mm-chips" hidden></div>
        <button type="button" class="mm-stoggle" id="mm-stoggle" aria-expanded="true" hidden><span id="mm-stoggle-t">Yol Tarifi</span>${ICON.chev}</button>
        <div class="mm-steps" id="mm-steps" hidden></div>
        <div class="mm-dbtns">
          <button type="button" class="mm-navgo" id="mm-navgo">${ICON.nav}<span>Rota Oluştur</span></button>
          <button type="button" class="mm-rcancel" id="mm-rcancel" aria-label="Rotayı İptal Et" hidden>${ICON.close}</button>
        </div>
        <p class="mm-dnote" id="mm-dnote" hidden></p>
      </div>
      </div>
      <p class="mm-rtempty" id="mm-rtempty">Gitmek istediğin yeri yaz. Seçince rota ve adım adım yol tarifi burada çıkar, güzergâh aşağıdaki haritada sokaklar üzerinde görünür.</p>
    </div>
    <div class="mm-toast" id="mm-toast" hidden></div>
    <button type="button" class="mm-spill" id="mm-spill" hidden aria-label="Sürüş Panelini Aç"><b id="mm-spill-v">—</b><small>km/sa</small></button>

    <div class="mm-attr" id="mm-attr"></div>
    <div class="mm-bottom">
      <div class="mm-panel" id="mm-panel">
        <button type="button" class="mm-pcol" id="mm-pcol" hidden aria-label="Paneli Küçült">${ICON.chev}<span>Küçült</span></button>
        <button type="button" class="mm-start" id="mm-start">${ICON.play}<span>Sürüşü Başlat</span></button>
        <div class="mm-ride" id="mm-ride" hidden>
          <div class="mm-spd"><b id="mm-spd">0</b><small id="mm-spdu">km/h</small></div>
          <div class="mm-stats">
            <div><small>Mesafe</small><b id="mm-sd">0 m</b></div>
            <div><small>Süre</small><b id="mm-st">00:00</b></div>
            <button type="button" class="mm-savg" id="mm-savg" aria-label="Ortalama Hız Türünü Değiştir"><small id="mm-savgl">Ort. hareket</small><b id="mm-sa">—</b></button>
            <div><small>Maks.</small><b id="mm-sm">—</b></div>
            <button type="button" class="mm-lean" id="mm-lean" aria-label="Yatış Açısı Ayrıntıları"><small>Yatış (tahmini)</small><b id="mm-lean-v">—</b><span class="mm-lg" aria-hidden="true"><i id="mm-lean-m"></i></span><small class="mm-ln" id="mm-lean-n"></small></button>
          </div>
          <div class="mm-rbtns">
            <button type="button" class="mm-rb mm-pause" id="mm-pause" aria-label="Sürüşü Duraklat"><span id="mm-pausel">Duraklat</span></button>
            <button type="button" class="mm-rb mm-stop" id="mm-stop" aria-label="Sürüşü Bitir"><span>Bitir</span></button>
          </div>
          <button type="button" class="mm-tel" id="mm-tel" hidden aria-label="Sensör Ayrıntıları">
            <span class="mm-tl"><small>Yatış (tahmini)</small><b id="mm-tel-lean">—</b></span>
            <span class="mm-tl"><small>Yanal</small><b id="mm-tel-lat">—</b></span>
            <span class="mm-tl"><small>Boylamsal</small><b id="mm-tel-lon">—</b></span>
            <span class="mm-tl"><small>Fren / Hızlanma</small><b id="mm-tel-ev">0 / 0</b></span>
            <small class="mm-tnote" id="mm-tel-note"></small>
          </button>
        </div>
      </div>
    </div>
    <div class="mm-gsheet" id="mm-tsheet" hidden></div>
    <div class="mm-gsheet" id="mm-ssheet" hidden></div>
    <div class="mm-modal" id="mm-modal" hidden></div>
  </div>`;

  function mount(host, opts) {
    host.innerHTML = TEMPLATE;
    const $ = id => host.querySelector('#' + id);
    const el = { root: $('mm'), map: $('mm-map'), load: $('mm-load'), loadMsg: $('mm-load-msg'), retry: $('mm-retry'),
      form: $('mm-form'), q: $('mm-q'), go: $('mm-go'), head: $('mm-head'), navbar: $('mm-navbar'), results: $('mm-results'), rt: $('mm-rt'), rtbody: $('mm-rtbody'), gps: $('mm-gps'),
      menu: $('mm-menu'), mbtn: $('mm-mbtn'), toast: $('mm-toast'), attr: $('mm-attr'), dest: $('mm-dest'), start: $('mm-start'), ride: $('mm-ride'), modal: $('mm-modal') };

    const S = { cfg: null, map: null, ready: false, active: false, watch: null, me: null, hadFix: false, follow: true,
      meMarker: null, accCircle: null, smooth: new Smoother(), raw: null, fixAt: 0, hadGood: false, hdv: null, staleT: 0, pendingRoute: false, dest: null, destMarker: null, route: null, routeLines: [], nav: null,
      ride: null, riding: false, trail: null, tick: null, wl: null, hiddenAt: 0, toastT: 0, theme: store.get('mm_theme', 'dark'),
      keepAwake: store.get('mm_wake', '1') === '1',
      user: (opts && opts.user) || 'anon', rec: null, trailGroup: null, trailSeg: null, trailBreak: true, sumId: null, persistWarned: false, avgMode: store.get('mm_avg', 'mov'), syncTimer: 0 };

    /* ---------- Yardımcılar ---------- */
    function toast(msg, ms) {
      el.toast.textContent = msg; el.toast.hidden = false;
      clearTimeout(S.toastT); S.toastT = setTimeout(() => { el.toast.hidden = true; }, ms || 4500);
    }
    function chip(text, state) { el.gps.textContent = text; el.gps.dataset.s = state; }
    function setTheme(t) {
      S.theme = t === 'light' ? 'light' : 'dark'; el.root.dataset.theme = S.theme; store.set('mm_theme', S.theme);
      if (S.gl) { try { S.gl.getMaplibreMap().setStyle(S.theme === 'dark' ? S.cfg.vecDark : S.cfg.vecLight); } catch {} delete el.root.dataset.nd; el.root.dataset.vec = '1'; }
      else if (S.tiles && S.cfg) {                                           // hazır koyu karo tanımlıysa onu kullan (CSS filtresi gerekmez)
        const nd = !S.fbUrl && S.theme === 'dark' && !!S.cfg.tileUrlDark, url = S.fbUrl || (nd ? S.cfg.tileUrlDark : S.cfg.tileUrl);
        if (S.tiles._url !== url) S.tiles.setUrl(url);
        if (nd) el.root.dataset.nd = '1'; else delete el.root.dataset.nd;
      }
      el.menu.querySelectorAll('[data-th]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.th === S.theme)));
    }
    function measureHead() { const nb = el.navbar.parentNode !== el.head && !el.navbar.hidden ? Math.round(el.navbar.getBoundingClientRect().height) : 0; el.root.style.setProperty('--navh', nb + 'px'); { const bt = el.root.querySelector('.mm-bottom'); if (bt) el.root.style.setProperty('--both', Math.round(bt.getBoundingClientRect().height) + 'px'); } const h = el.head.getBoundingClientRect(), r = el.root.getBoundingClientRect(); if (r.height) el.root.style.setProperty('--head', Math.round(h.bottom - r.top) + 'px'); }

    /* Vektör harita (OpenFreeMap: anahtarsız, ücretsiz): MapLibre GL, Leaflet içinde. Kütüphane/WebGL/stil yüklenemezse raster OSM kalır. */
    const MLGL = 'https://cdn.jsdelivr.net/npm/maplibre-gl@4/dist/maplibre-gl.', MLPL = 'https://cdn.jsdelivr.net/npm/@maplibre/maplibre-gl-leaflet@0.0/leaflet-maplibre-gl.js';
    function loadTag(tag, url) { return new Promise((res, rej) => { const e = document.createElement(tag); if (tag === 'link') { e.rel = 'stylesheet'; e.href = url; } else e.src = url; e.crossOrigin = 'anonymous'; e.onload = res; e.onerror = () => rej(new Error('yüklenemedi')); document.head.appendChild(e); }); }
    function glOk() { try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; } }
    async function tryVector(cfg) {
      if (!cfg.vecLight || !glOk()) return;
      try {
        if (!window.maplibregl) { loadTag('link', MLGL + 'css').catch(() => {}); await loadTag('script', MLGL + 'js'); }
        if (!window.L.maplibreGL) await loadTag('script', MLPL);
        if (!window.maplibregl || !window.L.maplibreGL || !S.map) return;
        const gl = window.L.maplibreGL({ style: S.theme === 'dark' ? cfg.vecDark : cfg.vecLight, attributionControl: false });
        gl.addTo(S.map); const m = gl.getMaplibreMap();
        let done = false, bad = 0;
        m.on('load', () => { if (done) return; done = true; S.gl = gl; if (S.tiles) S.map.removeLayer(S.tiles); el.root.dataset.vec = '1'; delete el.root.dataset.nd; el.attr.innerHTML = '&copy; <a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> &copy; <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a> &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>' + (cfg.route && cfg.route.attr ? ' · ' + cfg.route.attr : ''); });
        m.on('error', () => { if (done || ++bad < 3) return; S.map.removeLayer(gl); });   // stil yüklenemedi: raster kalır
        setTimeout(() => { if (!done) { try { S.map.removeLayer(gl); } catch {} } }, 15000);
      } catch { /* raster OSM kalır */ }
    }

    /* ---------- Harita ---------- */
    function initMap(cfg) {
      S.cfg = cfg;
      const L = window.L;
      S.map = L.map(el.map, { zoomControl: false, attributionControl: false, worldCopyJump: true, maxZoom: cfg.tileMax || 19, preferCanvas: true, zoomSnap: 0.5, zoomDelta: 1, wheelPxPerZoomLevel: 90, tapTolerance: 18, bounceAtZoomLimits: false }).setView([39, 35], 5);   // karşılama görünümü (Türkiye); konum işareti değil
      S.tiles = L.tileLayer(cfg.tileUrl, { subdomains: cfg.tileSub || 'abc', maxZoom: cfg.tileMax || 19, maxNativeZoom: cfg.tileMax || 19, updateWhenIdle: true, updateWhenZooming: false, keepBuffer: 1, detectRetina: /@2x|\{r\}/.test(cfg.tileUrl) ? false : (window.devicePixelRatio || 1) > 1.5 && !!cfg.tileRetina }).addTo(S.map);
      /* Karolar hiç yüklenmezse (engel, kota, ağ) ücretsiz yedek sağlayıcılara sırayla geç */
      { const FB = [['https://tile-a.openstreetmap.fr/hot/{z}/{x}/{y}.png', '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> &middot; HOT'],
          ['https://a.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png', '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> &middot; CyclOSM']];
        let good = 0, bad = 0, i = 0;
        S.tiles.on('tileload', () => { good++; if (S.tileMsg) { S.tileMsg = 0; el.load.hidden = true; } });
        S.tiles.on('tileerror', () => { if (good || ++bad < 4) return; if (i >= FB.length) { if (!S.tileMsg) { S.tileMsg = 1; el.load.hidden = false; el.load.textContent = 'Harita karoları yüklenemedi. Reklam engelleyici/VPN veya internet bağlantısını kontrol et.'; } return; } bad = 0; S.fbUrl = FB[i][0]; el.attr.innerHTML = FB[i][1]; i++; delete el.root.dataset.nd; S.tiles.setUrl(S.fbUrl); }); }
      tryVector(cfg);
      el.attr.innerHTML = (cfg.tileAttr || '') + (cfg.route && cfg.route.attr ? ' · ' + cfg.route.attr : '');
      S.map.on('dragstart', () => { S.follow = false; paintLocate(); paintRot(); });
      el.map.addEventListener('pointerdown', flattenForTouch, true);
      el.load.hidden = true;
      S.ready = true;
      if (S.pendingEvent) { const e = S.pendingEvent; S.pendingEvent = null; setTimeout(() => startEvent(e), 300); }
      paintLocate(); setTheme(S.theme);
      if ('ResizeObserver' in window) new ResizeObserver(() => { if (S.boxOn) rotBox(true); else S.map && S.map.invalidateSize(); measureHead(); }).observe(el.root); if ('ResizeObserver' in window) { const ro = new ResizeObserver(() => measureHead()); ro.observe(el.navbar); ro.observe(el.root.querySelector('.mm-bottom')); }
      measureHead();
      if (S.active) startWatch();
    }
    function paintLocate() { $('mm-loc').classList.toggle('on', S.follow && !!S.me); $('mm-ctr').hidden = !(S.nav && !S.follow && S.me); }

    /* ---------- Yön-yukarı (heading-up) harita: navigasyonda harita dönerek işaret hep ileriye bakar ----------
       Leaflet dönmeyi desteklemez: harita kabı ekran köşegeni kadar büyütülür ve CSS ile döndürülür.
       Dokununca düz (kuzey-yukarı) görünüme dönülür (sürükleme doğruluğu için), «Ortala» ile geri gelinir. */
    function rotBox(on) {
      const m = el.map;
      if (!on) { ['left', 'top', 'width', 'height', 'inset', 'transform', 'transition'].forEach(k => m.style.removeProperty(k)); el.root.classList.remove('rotated'); S.rotCur = null; S.boxOn = false; }
      else {
        const W = el.root.clientWidth, H = el.root.clientHeight, d = Math.ceil(Math.hypot(W, H)) + 4;
        m.style.inset = 'auto'; m.style.width = d + 'px'; m.style.height = d + 'px'; m.style.left = Math.round((W - d) / 2) + 'px'; m.style.top = Math.round((H - d) / 2) + 'px';
        el.root.classList.add('rotated'); S.boxOn = true; if (S.rotCur == null) S.rotCur = 0;
      }
      S.map && S.map.invalidateSize({ animate: false });
    }
    function setRot(deg, instant) {
      const m = el.map; m.style.transition = instant ? 'none' : 'transform .6s linear'; m.style.transform = `rotate(${deg}deg)`;
      m.style.setProperty('--unrot', `rotate(${-deg}deg)`);
    }
    function bearingTo(a, b, c, d) {
      const y = Math.sin(toRad(d - b)) * Math.cos(toRad(c)), x = Math.cos(toRad(a)) * Math.sin(toRad(c)) - Math.sin(toRad(a)) * Math.cos(toRad(c)) * Math.cos(toRad(d - b));
      return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
    }
    function navHeading() {
      if (S.hdv != null && Date.now() - (S.hdvAt || 0) < 8000) return S.hdv;      // hareket ederken ölçülen yön
      const t = S.route && S.route.tracker; if (!t || !S.me) return S.hdv;          // duruyorsa rotadaki yön
      const along = t.total - t.progress(S.me.lat, S.me.lon).remaining; let i = 1;
      while (i < t.c.length - 1 && t.cum[i] < along + 40) i++;
      return bearingTo(S.me.lat, S.me.lon, t.c[i][0], t.c[i][1]);
    }
    const rotOn = () => !!S.nav || rideOpen();     // navigasyon, sürüş (tek/grup/etkinlik) ya da grup konum paylaşımı: harita gidiş yönüne döner
    function paintRot() {
      if (!S.map) return;
      if (!rotOn()) { if (S.boxOn) { rotBox(false); const mk = S.meMarker && S.meMarker.getElement && S.meMarker.getElement(), bx = mk && mk.querySelector('.mm-me'); if (bx) bx.classList.remove('up'); } return; }
      if (!S.me) return;
      if (!S.boxOn) rotBox(true);
      const m = S.meMarker && S.meMarker.getElement && S.meMarker.getElement(), box = m && m.querySelector('.mm-me'), rot = m && m.querySelector('.rot');
      if (!S.follow) { if (S.rotCur) { S.rotCur = 0; setRot(0, true); } return; }
      const h = navHeading(); if (h == null) return;
      S.rotCur = (S.rotCur || 0) + (((-h - (S.rotCur || 0)) % 360 + 540) % 360 - 180);
      setRot(S.rotCur);
      if (box) box.classList.add('hd', 'up'); if (rot) rot.style.transform = `rotate(${h}deg)`;
    }
    function flattenForTouch() {          // dokunuş başlayınca düz görünüm; bırakılınca takip sürüyorsa yeniden döner
      if (!rotOn() || !S.boxOn || !S.rotCur) return;
      S.rotCur = 0; setRot(0, true);
      const back = () => { document.removeEventListener('pointerup', back, true); document.removeEventListener('pointercancel', back, true); setTimeout(() => { if (rotOn() && S.follow) paintRot(); }, 60); };
      document.addEventListener('pointerup', back, true); document.addEventListener('pointercancel', back, true);
    }

    function meIcon() {
      return window.L.divIcon({ className: 'mm-icon', iconSize: [28, 28], iconAnchor: [14, 14],
        html: '<div class="mm-me"><s></s><div class="rot"><i></i></div><b></b></div>' });
    }
    function drawMe(p, f) {
      const L = window.L, ll = [p.lat, p.lon];
      if (!S.meMarker) S.meMarker = L.marker(ll, { icon: meIcon(), keyboard: false, interactive: false, zIndexOffset: 1000 }).addTo(S.map);
      else S.meMarker.setLatLng(ll);
      const m = S.meMarker.getElement && S.meMarker.getElement();
      if (m) {
        const hd = f.heading != null && f.speed != null && f.speed > 1.5;
        if (hd) {                                                       // yönü yumuşat
          S.hdvAt = Date.now();   // (en kısa açı yolu)
          const d = ((f.heading - (S.hdv == null ? f.heading : S.hdv) + 540) % 360) - 180;
          S.hdv = (S.hdv == null ? f.heading : S.hdv + d * 0.5 + 360) % 360;
        }
        const box = m.querySelector('.mm-me'); if (box) { box.classList.toggle('hd', hd); box.classList.remove('stale'); }
        const rot = m.querySelector('.rot'); if (rot && hd) rot.style.transform = `rotate(${S.hdv}deg)`;
      }
      paintRot();
      if (f.acc >= 12 && f.acc < 500) {
        if (!S.accCircle) S.accCircle = L.circle(ll, { radius: f.acc, weight: 1, color: accent(), opacity: 0.5, fillColor: accent(), fillOpacity: 0.1, interactive: false }).addTo(S.map);
        else { S.accCircle.setLatLng(ll); S.accCircle.setRadius(f.acc); }
      } else if (S.accCircle) { S.accCircle.remove(); S.accCircle = null; }
    }
    // Takip: işaret ekran merkezinden belirgin uzaklaşınca kaydır (her konumda kaydırma titreme yapar)
    function followTo(p) {
      const m = S.map, pt = m.latLngToContainerPoint([p.lat, p.lon]), sz = m.getSize();
      if (Math.hypot(pt.x - sz.x / 2, pt.y - sz.y / 2) > 24) m.panTo([p.lat, p.lon], { animate: true, duration: 0.8, easeLinearity: 1 });
    }
    function checkStale() {
      if (!S.raw || el.root.hidden) return;
      const age = Date.now() - S.fixAt, stale = age > 12000;
      const m = S.meMarker && S.meMarker.getElement && S.meMarker.getElement(), box = m && m.querySelector('.mm-me');
      if (box) box.classList.toggle('stale', stale);
      if (stale) chip('Sinyal zayıf · son konum ' + Math.round(age / 1000) + ' sn önce', 'bad');
    }

    /* ---------- GPS ---------- */
    function startWatch() {
      if (S.watch != null || !S.ready) return;
      if (!('geolocation' in navigator)) return chip('Bu cihaz konumu desteklemiyor', 'bad');
      if (window.isSecureContext === false) return chip('Konum için HTTPS gerekli', 'bad');
      chip('GPS aranıyor…', 'warn');
      S.watch = navigator.geolocation.watchPosition(onFix, onGeoErr, { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 });
      clearInterval(S.staleT); S.staleT = setInterval(checkStale, 3000);
    }
    function stopWatch() {
      if (S.watch != null) { try { navigator.geolocation.clearWatch(S.watch); } catch {} S.watch = null; }
      clearInterval(S.staleT); S.staleT = 0;
    }
    function onGeoErr(e) {
      if (e.code === 1) { chip('Konum izni kapalı', 'bad'); toast('Konum izni verilmedi. Telefon/tarayıcı ayarlarından bu site için konumu aç.', 7000); stopWatch(); }
      else if (e.code === 2) chip('GPS sinyali yok', 'bad');
      else chip('GPS aranıyor…', 'warn');
    }
    function onFix(pos) {
      const c = pos.coords;
      const f = { lat: c.latitude, lon: c.longitude, acc: c.accuracy, t: pos.timestamp || Date.now(),
        speed: c.speed != null && isFinite(c.speed) && c.speed >= 0 ? c.speed : null,
        heading: c.heading != null && isFinite(c.heading) ? c.heading : null };
      S.raw = f; S.fixAt = Date.now(); emit('mm:speed', { kmh: f.speed == null ? null : f.speed * 3.6 });
      const sm = S.smooth.push(f);                                      // ekran/rota için düzeltilmiş konum; null = bu nokta reddedildi
      if (sm) S.me = { ...f, lat: sm.lat, lon: sm.lon };
      chip(f.acc <= 50 ? `GPS ±${Math.round(f.acc)} m` : `Zayıf sinyal ±${Math.round(f.acc)} m`, f.acc <= 20 ? 'ok' : f.acc <= 50 ? 'warn' : 'bad');
      if (sm) {
        drawMe(S.me, f);
        if (!S.hadFix) { S.hadFix = true; S.follow = true; S.map.setView([S.me.lat, S.me.lon], f.acc > 100 ? 14 : 16); }
        else if (!S.hadGood && f.acc <= 50 && S.follow) S.map.setView([S.me.lat, S.me.lon], Math.max(S.map.getZoom(), 16));   // ilk kaba (baz istasyonu) konumdan sonra iyi konuma yaklaş
        else if (S.follow) followTo(S.me);
        if (f.acc <= 50) S.hadGood = true;
        paintLocate();
      }
      if (S.grp) grpSend(f);                                            // grup sürüşünde konum odadaki sürücülere gider
      if (rideActive()) { recordFix(f); paintRide(); }                  // kayıt HAM noktalarla (kendi filtreleri ride-core'da)
      if (sm && S.nav) updateNav(S.me);
      if (S.nav) paintPill();
      if (sm && S.pendingRoute && S.dest && !S.route && !S.routeBusy) { S.pendingRoute = false; previewRoute(); }
      if (S.tele) S.tele.onFix(f);
      if (S.dest && !S.route) $('mm-dline').textContent = destDistText();
    }
    function flyToMe() {
      if (!S.ready) return;
      if (!S.me) { toast(el.gps.dataset.s === 'bad' ? el.gps.textContent + '. Konum alınamadı.' : 'Konum henüz bulunamadı, GPS aranıyor…'); startWatch(); return; }
      S.follow = true; paintLocate();
      S.map.setView([S.me.lat, S.me.lon], Math.max(S.map.getZoom(), 16), { animate: true }); paintRot();
    }

    /* ---------- Arama ---------- */
    function showResults(html) { el.results.innerHTML = html; el.results.hidden = !html; if (html) el.toast.hidden = true; }
    el.form.addEventListener('submit', async e => {
      e.preventDefault();
      const q = el.q.value.trim();
      if (!S.ready) return toast('Harita henüz hazır değil.');
      if (q.length < 3) return toast('En az 3 karakter yaz.');
      el.go.disabled = true; el.go.textContent = '…';
      showResults('<div class="mm-rmsg">Aranıyor…</div>');
      try {
        const p = new URLSearchParams({ q });
        if (S.me) { p.set('lat', S.me.lat.toFixed(4)); p.set('lon', S.me.lon.toFixed(4)); }
        const r = await fetch('/api/geocode?' + p, { credentials: 'same-origin' });
        const j = await r.json().catch(() => ({}));
        if (r.status === 401) throw new Error('Oturum süresi dolmuş. Sayfayı yenile.');
        if (!r.ok) throw new Error(j.error || 'Arama başarısız.');
        const list = j.results || [];
        if (!list.length) return showResults('<div class="mm-rmsg">Sonuç bulunamadı. Daha açık yazmayı dene.</div>');
        if (list.length === 1) { showResults(''); el.q.blur(); pickResult(list[0]); return; }   // tek sonuç: seç ve rotayı çıkar
        showResults(list.map((x, i) => `<button type="button" class="mm-ritem" data-i="${i}"><b>${esc(x.title)}${S.me ? `<em>${fmtDist(haversine(S.me.lat, S.me.lon, x.lat, x.lon))}</em>` : ''}</b><span>${esc(x.subtitle)}</span></button>`).join(''));
        el.results._list = list;
      } catch (err) { showResults(`<div class="mm-rmsg err">${esc(err.message || 'Arama başarısız.')}</div>`); }
      finally { el.go.disabled = false; el.go.textContent = 'Ara'; }
    });
    el.results.addEventListener('click', e => {
      const b = e.target.closest('.mm-ritem'); if (!b) return;
      const x = (el.results._list || [])[Number(b.dataset.i)]; if (!x) return;
      showResults(''); el.q.blur(); pickResult(x);
    });
    el.q.addEventListener('keydown', e => { if (e.key === 'Escape') { showResults(''); el.q.blur(); } });

    /* ---------- Hedef, rota ve navigasyon ----------
       Akış: hedef seç (API çağrısı YOK) → "Rota Oluştur" (1 çağrı) → önizleme (mesafe, süre, varış) → "Navigasyonu Başlat" (çağrı YOK)
       → konum değiştikçe kalan mesafe/süre yerelde hesaplanır; yalnızca rotadan sapınca (ve sınırlı sıklıkta) yeni rota istenir. */
    const AVOID_TXT = { highways: 'Otoyoldan Kaçın', tolls: 'Ücretli Yoldan Kaçın', ferries: 'Feribotsuz' };
    const rcfg = () => (S.cfg && S.cfg.route) || null;
    const routingOn = () => !!(S.cfg && S.cfg.routing && rcfg());
    const hhmm = sec => new Date(Date.now() + sec * 1000).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
    Object.assign(S, { stepsOpen: store.get('mm_steps', '1') === '1', avoid: new Set((store.get('mm_avoid', '') || '').split(',').filter(Boolean)), route: null, routeLines: [], routeBusy: false, routeMsg: '', routeTimer: 0, reqId: 0, lastReq: { key: '', t: 0 } });

    // Arama sonucu seçilince: hedefi koy ve rotayı otomatik çıkar (konum yoksa ilk konumda; rota servisi kapalıysa yalnız hedef)
    function rtOpen() { return !el.rt.hidden; }
    function wide() { return window.matchMedia && window.matchMedia('(min-width:768px)').matches; }
    // Rota sayfası açıkken rota, sayfanın kapatmadığı (alttaki / masaüstünde sağdaki) alana sığdırılır
    function fitPad() {
      if (!rtOpen()) return null;
      const w = wide(), r = el.rt.getBoundingClientRect(), m = el.root.getBoundingClientRect();
      return w ? { paddingTopLeft: [Math.round(r.right - m.left) + 24, 30], paddingBottomRight: [70, 30] }
               : { paddingTopLeft: [30, Math.round(r.bottom - m.top) + 16], paddingBottomRight: [70, 30] };
    }
    function refit() { const r = S.route; if (!r || !S.map) return; const p = fitPad(); S.map.invalidateSize(); S.map.fitBounds(r.coords, Object.assign({ maxZoom: 17 }, p || { paddingTopLeft: [40, 110], paddingBottomRight: [70, 200] })); }
    function paintRtEmpty() { $('mm-rtempty').hidden = !!S.dest; }
    function openRt(focus) {
      el.rt.hidden = false; el.root.classList.add('rtopen'); el.menu.hidden = true; paintRtEmpty();
      if (S.route) requestAnimationFrame(refit);
      if (focus === 'force' || (focus && !S.dest)) setTimeout(() => el.q.focus(), 60);
    }
    function closeRt() { if (!rtOpen()) return; el.rt.hidden = true; el.root.classList.remove('rtopen'); showResults(''); el.q.blur(); if (S.map) S.map.invalidateSize(); }
    $('mm-rtbtn').addEventListener('click', () => (rtOpen() ? closeRt() : openRt(true)));
    $('mm-rtback').addEventListener('click', closeRt);
    function pickResult(x) { setDest(x); autoRoute(); }
    function autoRoute() {
      if (!S.dest || !routingOn()) return;
      if (!S.me) { S.pendingRoute = true; startWatch(); paintDest(); return; }
      previewRoute();
    }
    function setDest(x) {
      dropRoute();
      S.dest = { lat: x.lat, lon: x.lon, title: x.title, subtitle: x.subtitle };
      if (S.destMarker) S.destMarker.remove();
      S.destMarker = window.L.marker([x.lat, x.lon], { keyboard: false, icon: window.L.divIcon({ className: 'mm-icon', iconSize: [32, 40], iconAnchor: [16, 38], html: PIN() }) }).addTo(S.map);
      S.follow = false; paintLocate();
      el.dest.hidden = false; paintDest(); paintRtEmpty();
      const pad = Object.assign({ maxZoom: 16 }, fitPad() || { paddingTopLeft: [40, 110], paddingBottomRight: [70, 260] });
      if (routingOn() && S.me) return;                                     // rota gelince zaten sığdırılır; çifte hareket olmasın
      if (S.me) S.map.fitBounds([[S.me.lat, S.me.lon], [x.lat, x.lon]], pad); else S.map.setView([x.lat, x.lon], 14);
    }
    function clearDest() {
      dropRoute();
      if (S.destMarker) { S.destMarker.remove(); S.destMarker = null; }
      S.dest = null; el.dest.hidden = true; paintRtEmpty();
      if (!S.evAdv) { S.evq = null; evChainClear(); }                      // etkinlik rotası yalnızca «sıradaki noktaya geç» ile korunur
    }
    function destDistText() { return S.me && S.dest ? 'Kuş uçuşu: ' + fmtDist(haversine(S.me.lat, S.me.lon, S.dest.lat, S.dest.lon)) + ' (yol mesafesi değildir)' : 'Mesafe için konumun bekleniyor…'; }
    function paintDest() {
      const d = S.dest, r = S.route; if (!d) return;
      const on = routingOn(), opts = on ? (rcfg().avoid || []) : [];
      $('mm-dtitle').textContent = d.title || 'Seçilen konum';
      $('mm-dsub').textContent = d.subtitle || ''; $('mm-dsub').hidden = !!r;
      $('mm-dline').hidden = !!r; $('mm-dline').textContent = destDistText();
      $('mm-rinfo').hidden = !r;
      const nst = r && r.steps ? r.steps.length : 0, tg = $('mm-stoggle'), sl = $('mm-steps');
      tg.hidden = !nst; sl.hidden = !nst || !S.stepsOpen; tg.setAttribute('aria-expanded', String(S.stepsOpen));
      if (nst) { $('mm-stoggle-t').textContent = 'Yol tarifi · ' + nst + ' adım'; sl.innerHTML = '<ol class="mm-sl">' + stepsHtml(r, -1) + '</ol>'; }
      if (r) {
        $('mm-rdist').textContent = fmtDist(r.distance);
        $('mm-reta').textContent = '≈ ' + fmtEta(r.duration) + ' · Varış ' + hhmm(r.duration);
        $('mm-rlabel').textContent = r.label + (r.toll === true ? ' · ücretli yol içerir' : '') + (r.ferry === true ? ' · feribot içerir' : '') + ' · trafiksiz tahmin';
      }
      const ch = $('mm-chips'); ch.hidden = !opts.length;
      ch.innerHTML = opts.map(o => `<button type="button" class="mm-chip2" data-av="${o}" aria-pressed="${S.avoid.has(o)}">${AVOID_TXT[o] || o}</button>`).join('');
      const go = $('mm-navgo'); go.disabled = !on || S.routeBusy;
      go.querySelector('span').textContent = S.routeBusy ? 'Rota hesaplanıyor…' : r ? 'Navigasyonu Başlat' : 'Rota Oluştur';
      $('mm-rcancel').hidden = !r;
      const note = $('mm-dnote');
      const ntxt = S.routeMsg || (S.pendingRoute ? 'Konumun bekleniyor; bulununca rota otomatik çıkarılacak.' : on ? '' : 'Rota hesaplama bu sunucuda henüz etkin değil; şimdilik yalnızca hedef gösterilir.');
      note.hidden = !ntxt;
      note.classList.toggle('err', !!S.routeMsg);
      note.textContent = ntxt;
    }

    const stepDist = d => (d < 100 ? Math.round(d / 10) * 10 : d < 1000 ? Math.round(d / 50) * 50 : d) ;
    function stepsHtml(r, cur) {
      return r.steps.map((s, i) => `<li class="mm-step${i === cur ? ' cur' : ''}${cur >= 0 && i < cur ? ' done' : ''}"><span class="mm-si">${STEP_ICON(s.mod, 22)}</span><span class="mm-sx">${esc(s.text)}</span>${s.dist > 0 && s.mod !== 'arrive' ? '<em>' + fmtDist(stepDist(s.dist)) + '</em>' : ''}</li>`).join('');
    }
    function openSteps() {
      const r = S.route, sh = $('mm-ssheet'); if (!r || !r.steps || !r.steps.length) return;
      const cur = S.nav && S.nav.turnI != null ? S.nav.turnI : -1;
      sh.innerHTML = '<div class="mm-gh"><span>Yol Tarifi</span><button type="button" class="mm-gx" id="mm-sclose" aria-label="Kapat">✕</button></div><ol class="mm-sl">' + stepsHtml(r, cur) + '</ol>';
      sh.hidden = false; const c = sh.querySelector('.cur'); if (c) c.scrollIntoView({ block: 'center' });
      $('mm-sclose').addEventListener('click', closeSteps);
    }
    function closeSteps() { const sh = $('mm-ssheet'); sh.hidden = true; sh.innerHTML = ''; }
    $('mm-turn').addEventListener('click', openSteps);
    $('mm-stoggle').addEventListener('click', () => { S.stepsOpen = !S.stepsOpen; store.set('mm_steps', S.stepsOpen ? '1' : '0'); paintDest(); });
    function clearRouteLayers() { S.routeLines.forEach(l => l.remove()); S.routeLines = []; }
    function drawRoute(coords) {
      clearRouteLayers();
      const L = window.L;
      S.routeLines = [L.polyline(coords, { color: '#031420', weight: 12, opacity: 0.8, lineCap: 'round', interactive: false }).addTo(S.map),
                      L.polyline(coords, { color: accent(), weight: 7, opacity: 1, lineCap: 'round', interactive: false }).addTo(S.map)];
    }
    // Rotayı, navigasyonu ve bekleyen istekleri bırak (hedef kalır)
    function dropRoute() {
      clearTimeout(S.routeTimer); S.reqId++; S.routeBusy = false; S.routeMsg = ''; S.pendingRoute = false; closeSteps(); $('mm-turn').hidden = true;
      clearRouteLayers(); S.route = null;
      if (S.nav) { S.nav = null; el.navbar.hidden = true; S.spOpen = false; if (!rotOn()) rotBox(false); paintNavMode(); paintLocate(); }
      $('mm-form').hidden = false; measureHead();
      if (!S.active && !rideActive()) stopWatch();
    }

    // Tek yetkili rota isteği: gereksiz çağrıları burada engelliyoruz
    async function requestRoute(auto, from) {
      if (!routingOn() || !S.dest) return null;
      from = from || S.me;
      if (!from) { if (!auto) throw new Error('Önce konumun bulunmalı. GPS bekleniyor…'); return null; }
      if (navigator.onLine === false) { if (!auto) throw new Error('Çevrimdışısın; rota hesaplanamıyor.'); return null; }
      const avoid = (rcfg().avoid || []).filter(x => S.avoid.has(x));
      const key = [from.lat.toFixed(4), from.lon.toFixed(4), S.dest.lat.toFixed(4), S.dest.lon.toFixed(4), avoid.join(',')].join('|');
      if (!auto && S.route && S.lastReq.key === key && Date.now() - S.lastReq.t < 30000) return S.route;   // aynı istek 30 sn içinde: yeniden sorma
      if (S.routeBusy) return null;
      const id = ++S.reqId, dest = S.dest; S.routeBusy = true; S.routeMsg = ''; if (!auto) paintDest();
      try {
        const p = new URLSearchParams({ from: from.lat.toFixed(6) + ',' + from.lon.toFixed(6), to: dest.lat.toFixed(6) + ',' + dest.lon.toFixed(6) });
        if (avoid.length) p.set('avoid', avoid.join(','));
        const r = await fetch('/api/route?' + p, { credentials: 'same-origin' });
        const j = await r.json().catch(() => ({}));
        if (id !== S.reqId || S.dest !== dest) return null;           // bu arada hedef değişti / rota iptal edildi: yanıtı yok say
        if (r.status === 503) { S.cfg.routing = false; throw new Error('Rota servisi bu sunucuda etkin değil.'); }
        if (r.status === 401) throw new Error('Oturum süresi dolmuş. Sayfayı yenile.');
        if (!r.ok || !Array.isArray(j.coords) || j.coords.length < 2) throw new Error(j.error || 'Rota alınamadı.');
        S.lastReq = { key, t: Date.now() };
        const tr = new RouteTracker(j.coords, j.duration, j.distance);
        const steps = (Array.isArray(j.steps) ? j.steps : []).filter(x => x && isFinite(x.lat) && isFinite(x.lon) && x.text)
          .map(x => ({ text: String(x.text), dist: Number(x.dist) || 0, time: Number(x.time) || 0, mod: x.mod || 'straight', at: Math.max(0, tr.total - tr.progress(x.lat, x.lon).remaining) }));
        S.route = { provider: j.provider, profile: j.profile, label: j.label, distance: j.distance, duration: j.duration, toll: j.toll, ferry: j.ferry,
          avoid: j.avoid || [], coords: j.coords, tracker: tr, steps };
        if (S.nav) S.nav.turnKey = '';
        if (j.attr && S.cfg) el.attr.innerHTML = (S.cfg.tileAttr || '') + ' · ' + j.attr;
        drawRoute(j.coords);
        return S.route;
      } finally { if (id === S.reqId) S.routeBusy = false; }
    }
    async function previewRoute() {
      let r = null;
      try { r = await requestRoute(false); }
      catch (err) { S.routeMsg = err.message || 'Rota alınamadı.'; clearRouteLayers(); S.route = null; }
      paintDest();
      if (r && S.route === r && S.evq && S.evq.autoNav) { S.evq.autoNav = false; startNav(); return; }       // etkinlikte 2. noktadan itibaren navigasyon kesintisiz sürer
      if (r && S.route === r) requestAnimationFrame(refit);                 // rota sayfası ölçülünce güzergâhı kalan harita alanına sığdır
    }
    $('mm-navgo').addEventListener('click', async () => {
      if (!S.dest || !routingOn() || S.routeBusy) return;
      if (!S.route) return previewRoute();
      // Önizlemeden bu yana rotadan uzaklaştıysa başlamadan önce yeni rota al
      const pr = S.me && S.route.tracker.progress(S.me.lat, S.me.lon);
      if (pr && pr.off > 150) { S.route = null; await previewRoute(); if (!S.route) return; }
      startNav();
    });
    $('mm-rcancel').addEventListener('click', () => { dropRoute(); paintDest(); });
    $('mm-dclear').addEventListener('click', clearDest);
    $('mm-chips').addEventListener('click', e => {
      const b = e.target.closest('[data-av]'); if (!b) return;
      const id = b.dataset.av; if (S.avoid.has(id)) S.avoid.delete(id); else S.avoid.add(id);
      store.set('mm_avoid', [...S.avoid].join(',')); paintDest();
      if (S.route) { clearTimeout(S.routeTimer); S.routeTimer = setTimeout(previewRoute, 700); }   // art arda dokunuşlar tek istek olur; nihai tercih aynıysa hiç istek atılmaz
    });

    function setNote(t) { $('mm-navnote').textContent = t || (S.route ? S.route.label : ''); }
    // Navigasyonda alt panel küçülür: yalnız sol altta anlık hız (dokununca tam sürüş paneli açılır; sürüş kaydı varsa kırmızı nokta)
    function paintPill() { if (!S.nav) return; const ok = S.raw && S.raw.speed != null && Date.now() - S.fixAt < 6000; $('mm-spill-v').textContent = ok ? String(Math.round(kmh(S.raw.speed))) : '—'; }
    function paintNavMode() {
      const on = !!S.nav; el.root.classList.toggle('navmode', on && !S.spOpen); el.root.classList.toggle('navon', on);
      { const host = on ? el.root.querySelector('.mm-bottom') : el.head; if (el.navbar.parentNode !== host) { if (on) host.appendChild(el.navbar); else host.insertBefore(el.navbar, host.firstChild); } }   // yol tarifi navigasyonda ALT şeritte; üst kısım tamamen harita
      $('mm-spill').hidden = !(on && !S.spOpen); $('mm-pcol').hidden = !(on && S.spOpen);
      $('mm-spill').classList.toggle('rec', !!(S.rec && (S.rec.status === 'active' || S.rec.status === 'paused'))); paintPill(); measureHead();
    }
    $('mm-spill').addEventListener('click', () => { S.spOpen = true; paintNavMode(); });
    $('mm-pcol').addEventListener('click', () => { S.spOpen = false; paintNavMode(); });
    /* ---------- Etkinlik rotası: noktalar (başlangıç → mola/uğrak → varış) sırayla NORMAL navigasyona bağlanır (her ayak: konum → sıradaki nokta) ---------- */
    const evLabel = (q, i) => { const n = q.pts[i], last = i === q.pts.length - 1; return (i === 0 ? 'Başlangıç' : last ? 'Varış' : 'Mola') + ': ' + n.name; };
    function evGo(i, autoNav) {
      const q = S.evq; if (!q || i >= q.pts.length) return;
      q.i = i; q.autoNav = !!autoNav; const n = q.pts[i];
      setDest({ lat: n.lat, lon: n.lon, title: evLabel(q, i), subtitle: 'Etkinlik: ' + q.title + ' · nokta ' + (i + 1) + '/' + q.pts.length });
      if (!autoNav) openRt(false);
      autoRoute(); evChain();
    }
    /* Etkinlik ön izleme: başlangıç → molalar → varış TÜM yol tarifi tek haritada; onaylanınca sırayla navigasyon başlar */
    const evKey = p => p.lat.toFixed(4) + ',' + p.lon.toFixed(4);
    S.evLegs = S.evLegs || {};                                               // ayak önbelleği: «a>b» → {coords, distance, duration} (ön izleme ve navigasyon aynı yolu kullanır, ek istek yok)
    async function evLeg(a, b) {
      const key = evKey(a) + '>' + evKey(b); if (S.evLegs[key]) return S.evLegs[key];
      if (!routingOn()) return null;
      const p = new URLSearchParams({ from: a.lat.toFixed(6) + ',' + a.lon.toFixed(6), to: b.lat.toFixed(6) + ',' + b.lon.toFixed(6) });
      const r = await fetch('/api/route?' + p, { credentials: 'same-origin' }); const j = await r.json().catch(() => ({}));
      if (!r.ok || !Array.isArray(j.coords) || j.coords.length < 2) return null;
      return (S.evLegs[key] = { coords: j.coords, distance: Number(j.distance) || 0, duration: Number(j.duration) || 0 });
    }
    function evChainClear() { (S.evChain || []).forEach(l => l.remove()); S.evChain = []; }
    async function evChain() {                                               // navigasyonda: sıradaki ayaklar (nokta → nokta) soluk kesikli çizgiyle haritada görünür
      const q = S.evq; evChainClear(); if (!q) return; const tok = q.ctok = (q.ctok || 0) + 1;
      for (let j = q.i; j < q.pts.length - 1; j++) {
        let leg = null; try { leg = await evLeg(q.pts[j], q.pts[j + 1]); } catch {}
        if (S.evq !== q || q.ctok !== tok) return; if (!leg) continue;
        S.evChain.push(window.L.polyline(leg.coords, { color: '#F4EFE6', weight: 4, opacity: 0.55, dashArray: '2 9', lineCap: 'round', interactive: false }).addTo(S.map));
      }
    }
    function evUpdated(ev) {                                                 // etkinlik düzenlendi (mola eklendi/silindi/sırası değişti): ön izleme ve navigasyon otomatik yenilenir
      if (S.evOv && S.evOv.ev && S.evOv.ev.id === ev.id) { evOverview(ev); toast('Etkinlik güncellendi.', 3000); return; }
      const q = S.evq; if (!q || q.id !== ev.id) return;
      const pts = [ev.start, ...(ev.stops || []), ev.dest]; q.done = q.done || new Set();
      let i = pts.findIndex(x => !q.done.has(evKey(x))); if (i < 0) i = pts.length - 1;
      const navWas = !!S.nav; q.title = ev.title || q.title; q.pts = pts;
      S.evAdv = true; clearDest(); S.evAdv = false;
      toast('Etkinlik değişti: rota yeni sıraya göre güncellendi.', 6000); evGo(i, navWas);
    }
    window.addEventListener('ml:event-changed', e => { const ev = e.detail && e.detail.event; if (ev && ev.start && ev.dest && ev.id) evUpdated(ev); });
    function evOvClear() { const o = S.evOv; if (!o) return; o.tok = -1; o.layers.forEach(l => l.remove()); if (o.mini) { try { o.mini.remove(); } catch {} } const sh = $('mm-evov'); if (sh) sh.remove(); S.evOv = null; }
    async function evOverview(ev) {
      const L = window.L, pts = [ev.start, ...(ev.stops || []), ev.dest];
      evOvClear();
      const o = S.evOv = { tok: Date.now(), layers: [], ev }; const tok = o.tok;
      const sh = document.createElement('div'); sh.className = 'mm-gsheet'; sh.id = 'mm-evov'; el.root.appendChild(sh);
      const paint = (legs, busy) => {
        const tot = legs.reduce((a, l) => (l ? { d: a.d + l.distance, t: a.t + l.duration } : a), { d: 0, t: 0 }), miss = legs.some(l => l === false);
        const role = i => (i === 0 ? 'Başlangıç' : i === pts.length - 1 ? 'Varış' : 'Mola ' + i);
        let rows = '';
        pts.forEach((n, i) => {
          rows += '<li class="mm-ovp"><span class="mm-ovn" style="background:' + (i === 0 ? '#2E9E5B' : i === pts.length - 1 ? '#D64545' : 'var(--accent,#EA8621)') + '">' + (i + 1) + '</span><span><b>' + esc(role(i)) + '</b> · ' + esc(n.name) + '</span></li>';
          if (i < pts.length - 1) { const l = legs[i]; rows += '<li class="mm-ovl">' + (l ? fmtDist(l.distance) + ' · ' + fmtEta(l.duration) : l === false ? 'Yol çizilemedi' : '…') + '</li>'; }
        });
        $('mm-ovdyn').innerHTML = '<ol class="mm-ovlist">' + rows + '</ol>';
        $('mm-ovfoot').innerHTML = '<p class="mm-ovtot">' + (busy ? 'Rota hesaplanıyor…' : 'Toplam: <b>' + fmtDist(tot.d) + '</b> · <b>' + fmtEta(tot.t) + '</b>' + (miss ? ' <span class="warn">(bazı bölümlerin yolu çizilemedi)</span>' : '')) + '</p>'
          + '<div class="mm-grow2"><button type="button" class="mm-mb" data-ov="x">Vazgeç</button><button type="button" class="mm-mb primary" data-ov="ok"' + (busy ? ' disabled' : '') + '>Onayla ve Başla</button></div>';
      };
      sh.innerHTML = '<div class="mm-gh"><span>' + esc(ev.title || 'Etkinlik') + '</span><button type="button" class="mm-gx" data-ov="x" aria-label="Kapat">✕</button></div><div class="mm-ovrow"><div id="mm-ovdyn"></div><div class="mm-ovmini" id="mm-ovmini"></div></div><div id="mm-ovfoot"></div>';
      const legs = pts.slice(1).map(() => null); paint(legs, true);
      sh.addEventListener('click', e => { const b = e.target.closest('[data-ov]'); if (!b) return; if (b.dataset.ov === 'x') evOvClear(); else if (!b.disabled) { evOvClear(); beginEvent(ev); } });
      const bounds = []; pts.forEach(n => bounds.push([n.lat, n.lon]));
      try {                                                                  // sağda küçük gerçek harita (sayfa yerleşimi büyümez: sabit 132×178)
        const mm = L.map($('mm-ovmini'), { zoomControl: false, attributionControl: false, dragging: false, touchZoom: false, scrollWheelZoom: false, doubleClickZoom: false, boxZoom: false, keyboard: false, tap: false, zoomSnap: 0.25 });
        const tu = (S.tiles && S.tiles._url) || S.cfg.tileUrl;
        L.tileLayer(tu, { subdomains: S.cfg.tileSub || 'abc', maxZoom: S.cfg.tileMax || 19, maxNativeZoom: S.cfg.tileMax || 19, updateWhenIdle: true }).addTo(mm);
        o.mini = mm; if (mm.invalidateSize) mm.invalidateSize(); mm.fitBounds(bounds, { padding: [18, 18], maxZoom: 15 });
        $('mm-ovmini').insertAdjacentHTML('beforeend', '<span class="mm-ovattr">© OpenStreetMap</span>');
        pts.forEach((n, i) => L.marker([n.lat, n.lon], { icon: L.divIcon({ className: 'mm-ovpin mm-ovpin-s', html: '<b style="background:' + (i === 0 ? '#2E9E5B' : i === pts.length - 1 ? '#D64545' : '#EA8621') + '">' + (i + 1) + '</b>', iconSize: [20, 20], iconAnchor: [10, 10] }), interactive: false }).addTo(mm));
      } catch { o.mini = o.mini || null; }
      S.follow = false; paintLocate(); S.map.fitBounds(bounds, { paddingTopLeft: [40, 90], paddingBottomRight: [40, 330], maxZoom: 15 });
      pts.forEach((n, i) => o.layers.push(L.marker([n.lat, n.lon], { icon: L.divIcon({ className: 'mm-ovpin', html: '<b style="background:' + (i === 0 ? '#2E9E5B' : i === pts.length - 1 ? '#D64545' : '#EA8621') + '">' + (i + 1) + '</b>', iconSize: [28, 28], iconAnchor: [14, 14] }), title: n.name, interactive: false }).addTo(S.map)));
      for (let i = 0; i < pts.length - 1; i++) {
        if (S.evOv === null || o.tok !== tok) return;
        try {
          const leg = await evLeg(pts[i], pts[i + 1]); if (o.tok !== tok) return; if (!leg) throw new Error('x');
          legs[i] = { distance: leg.distance, duration: leg.duration }; const coords = leg.coords;
          if (o.mini) { try { o.layers.push(L.polyline(coords, { color: '#031420', weight: 7, opacity: 0.8, lineCap: 'round', interactive: false }).addTo(o.mini), L.polyline(coords, { color: accent(), weight: 4, opacity: 1, lineCap: 'round', interactive: false }).addTo(o.mini)); } catch {} }
          o.layers.push(L.polyline(coords, { color: '#031420', weight: 10, opacity: 0.8, lineCap: 'round', interactive: false }).addTo(S.map), L.polyline(coords, { color: accent(), weight: 6, opacity: 1, lineCap: 'round', interactive: false }).addTo(S.map));
        } catch { if (o.tok !== tok) return; legs[i] = false; }
        paint(legs, i < pts.length - 2);
      }
      if (o.tok === tok) paint(legs, false);
    }
    function startEvent(ev) {
      if (!ev || !ev.start || !ev.dest) return;
      if (!S.ready) { S.pendingEvent = ev; return; }
      if (S.nav) { toast('Önce mevcut navigasyonu bitir.', 4000); return; }
      evOverview(ev);
    }
    function beginEvent(ev) {
      if (S.nav) { toast('Önce mevcut navigasyonu bitir.', 4000); return; }
      const pts = [ev.start, ...(ev.stops || []), ev.dest]; S.evq = { id: ev.id, title: ev.title || 'Etkinlik', pts, i: 0, autoNav: false, done: new Set() };
      let i = 0; if (S.me && haversine(S.me.lat, S.me.lon, ev.start.lat, ev.start.lon) < 500) i = 1;        // zaten başlangıçtaysan 2. noktadan başla
      if (i === 1) S.evq.done.add(evKey(pts[0]));
      toast('Etkinlik rotası: ' + pts.length + ' nokta. Sırayla yol tarifi alacaksın.', 5000);
      evGo(i, false);
    }
    function startNav() {
      const r = S.route; if (!r || S.nav) return;
      S.nav = { turnKey: '', turnI: null, offSince: 0, lastReroute: Date.now(), backoff: 30000, reroutes: 0, busy: false, prev: null, movedM: 0, movingS: 0 };
      closeRt(); el.dest.hidden = true; el.navbar.hidden = false; $('mm-form').hidden = true;
      $('mm-navto').textContent = S.dest.title || 'Hedef'; setNote('');
      S.follow = true; paintLocate();
      if (S.me) S.map.setView([S.me.lat, S.me.lon], Math.max(S.map.getZoom(), 16));
      startWatch(); measureHead(); S.spOpen = false; paintNavMode();
      if (S.me) { paintRot(); S.map.setView([S.me.lat, S.me.lon], Math.max(S.map.getZoom(), 16)); }
      paintLocate();
      if (S.me) updateNav(S.me);
    }
    function updateNav(f) {
      const n = S.nav, r = S.route; if (!n || !r) return;
      if (f.acc <= 50) {                                               // gerçek hareket hızını ETA için biriktir
        if (n.prev) {
          const dt = (f.t - n.prev.t) / 1000;
          if (dt > 0 && dt <= 30) { const d = haversine(n.prev.lat, n.prev.lon, f.lat, f.lon), sp = f.speed != null ? f.speed : d / dt; if (sp >= 1) { n.movedM += d; n.movingS += dt; } }
        }
        n.prev = f;
      }
      const p = r.tracker.progress(f.lat, f.lon);
      const eta = estimateEta({ remaining: p.remaining, planDist: r.distance, planDur: r.duration, movedM: n.movedM, movingS: n.movingS });
      const ns = nextStep(r.steps, r.tracker.total - p.remaining), tb = $('mm-turn');
      tb.hidden = !ns;
      if (ns) {
        const dd = ns.dist, key = ns.i + '|' + (dd < 100 ? Math.round(dd / 10) : dd < 1000 ? Math.round(dd / 50) : Math.round(dd / 100));
        if (n.turnKey !== key) {
          n.turnKey = key; const idx = n.turnI !== ns.i; n.turnI = ns.i;
          $('mm-turn-i').innerHTML = STEP_ICON(ns.step.mod, 34); $('mm-turn-d').textContent = fmtDist(stepDist(dd)); $('mm-turn-x').textContent = ns.step.text;
          if (idx && !$('mm-ssheet').hidden) openSteps();
        }
      }
      $('mm-navrem').textContent = fmtDist(p.remaining);
      $('mm-naveta').textContent = '≈ ' + fmtEta(eta) + ' · Varış ' + hhmm(eta);
      if (p.remaining < Math.max(40, f.acc * 1.5) && r.distance > 100) {
        const q = S.evq;
        if (q && q.i + 1 < q.pts.length) { q.done = q.done || new Set(); q.done.add(evKey(q.pts[q.i])); toast('Ulaştın: ' + q.pts[q.i].name + '. Sıradaki nokta için yol tarifi hazırlanıyor.', 6000); S.evAdv = true; clearDest(); S.evAdv = false; return evGo(q.i + 1, true); }
        const fin = () => { if (rideOpen() && el.modal.hidden) modal('<h3>' + (q ? 'Etkinlik Tamamlandı' : 'Hedefe Ulaştın') + '</h3><p>Sürüşü bitirip performans raporunu görmek ister misin?</p><div class="mm-mbtns"><button type="button" class="mm-mb" data-act="cancel">Sürmeye Devam</button><button type="button" class="mm-mb primary" data-act="end" data-focus>Sürüşü Bitir</button></div>'); };
        toast(q ? 'Etkinlik rotası tamamlandı: ' + q.title : 'Hedefe ulaştın.', 6000); clearDest(); return fin();
      }
      if (f.acc > 50) return;                                          // zayıf konumla sapma kararı verme
      const now = Date.now();
      if (p.off > Math.max(80, f.acc * 2)) {
        n.offSince = n.offSince || now;
        if (navigator.onLine === false) setNote('Çevrimdışı: rota güncellenemiyor, eski rota gösteriliyor.');
        else if (!n.busy && now - n.offSince > 10000 && now - n.lastReroute > n.backoff && n.reroutes < 12) reroute(f);
      } else { n.offSince = 0; if (!n.busy) setNote(''); }
    }
    // Rotadan çıkınca: en geç 30 sn'de bir (hata olursa üstel bekleme), oturum başına en çok 12 kez
    async function reroute(f) {
      const n = S.nav; if (!n || !S.dest) return;
      n.busy = true; n.lastReroute = Date.now(); n.reroutes++; setNote('Rotadan çıktın · yeni rota hesaplanıyor…');
      try {
        const route = await requestRoute(true, f);
        if (S.nav === n) { if (route) { n.offSince = 0; n.backoff = 30000; setNote(''); } else { n.backoff = Math.min(n.backoff * 2, 300000); setNote('Rota yenilenemedi · eski rota gösteriliyor.'); } }
      } catch { if (S.nav === n) { n.backoff = Math.min(n.backoff * 2, 300000); setNote('Rota yenilenemedi · eski rota gösteriliyor.'); } }
      finally { if (S.nav === n) n.busy = false; }
    }
    $('mm-navstop').addEventListener('click', () => { dropRoute(); if (S.dest) { el.dest.hidden = false; paintDest(); } });   // Bitir: rota silinir, hedef kalır
    $('mm-newdest').addEventListener('click', () => {                                                                           // Yeni hedef: rotayı bozmadan arama kutusunu aç
      $('mm-form').hidden = false; el.dest.hidden = !S.dest || !!S.nav; openRt('force');
    });

    /* ---------- Sürüş kaydı: ölçüm = ride-core.js (Recorder), cihazda saklama + eşitleme = ride-store.js ---------- */
    const RC = () => window.RideCore, RS = () => window.RideStore;
    function rideOpen() { return !!S.rec && (S.rec.status === 'active' || S.rec.status === 'paused'); }
    function rideActive() { return !!S.rec && S.rec.status === 'active'; }
    async function acquireWake() {
      if (!S.keepAwake || !('wakeLock' in navigator) || S.wl || !rideActive()) return;
      try { S.wl = await navigator.wakeLock.request('screen'); S.wl.addEventListener('release', () => { S.wl = null; }); } catch {}
    }
    function releaseWake() { try { S.wl && S.wl.release(); } catch {} S.wl = null; }

    // Cihaza yazılamazsa bir kez uyar; sürüş bellekte ve ekranda sürer
    function persistFail() { if (S.persistWarned) return; S.persistWarned = true; toast('Sürüş cihaza yazılamadı; sayfayı kapatırsan veri kaybolabilir.', 8000); }
    function metaOf(r) {
      const ended = r.status === 'ended', now = Date.now();
      return { id: r.id, owner: S.user, status: r.status, startedAt: r.startedAt, endedAt: r.endedAt, events: r.events.slice(),
        fixCount: r.fixes.length, sync: ended ? 'pending' : 'local', summary: r.summary(ended ? r.endedAt : now), updatedAt: now };
    }
    const persistMeta = r => RS().saveMeta(metaOf(r || S.rec)).catch(persistFail);

    /* iz çizgisi: boşluk/duraklatma sonrası yeni parça başlar (aradaki düz çizgi çizilmez) */
    function newTrail() { clearTrail(); S.trailGroup = window.L.layerGroup().addTo(S.map); S.trailBreak = true; S.trailSeg = null; }
    function clearTrail() { if (S.trailGroup) { S.trailGroup.clearLayers(); S.trailGroup.remove(); } S.trailGroup = null; S.trailSeg = null; }
    function trailAdd(lat, lon, brk) {
      if (!S.trailGroup) return;
      if (brk || S.trailBreak || !S.trailSeg) {
        S.trailSeg = window.L.polyline([[lat, lon]], { color: accentLight(), weight: 4, opacity: 0.9, interactive: false });
        S.trailGroup.addLayer(S.trailSeg); S.trailBreak = false;
      } else S.trailSeg.addLatLng([lat, lon]);
    }
    function recordFix(f) {
      const rec = S.rec.addFix(f);
      if (S.rec.limitReached && !S.limitToast) { S.limitToast = true; toast('Kayıt sınırına ulaşıldı (≈8 saat). Sürüşü bitirip yenisini başlat.', 9000); }
      if (!rec) return null;
      RS().addFix(S.rec.id, rec[0], rec).catch(persistFail);          // anahtar = zaman damgası: çakışmaz, sıralı okunur
      if (rec[5] === 0 || rec[5] === 3) trailAdd(rec[1], rec[2], rec[5] === 3);
      return rec;
    }

    const emit = (n, d) => { try { host.dispatchEvent(new CustomEvent(n, { detail: d })); } catch {} };   // interkom/müzik modülü için (gevşek bağ)
    function showRidePanel() {
      el.start.hidden = true; el.ride.hidden = false; emit('mm:ride', { on: true });
      if (!S.tick) S.tick = setInterval(paintRide, 1000);
      acquireWake(); startWatch(); paintRide();
    }
    function startRide() {
      if (rideOpen() || !S.ready) return !S.ready && toast('Harita henüz hazır değil.');
      if (!RS().persistent && !S.memWarned) { S.memWarned = true; toast('Bu tarayıcı kalıcı kayıt vermiyor: sürüş yalnızca sayfa açıkken saklanır.', 8000); }
      try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch {}   // tarayıcının sürüş verisini depolama baskısında silmesini zorlaştırır
      S.rec = new (RC().Recorder)(); S.limitToast = false;
      S.rec.start(Date.now());
      if (S.tele) S.tele.begin(S.rec.id, S.rec.startedAt);               // dokunma olayı içinde: iOS sensör izni burada istenir
      newTrail(); persistMeta();
      if (S.raw && Date.now() - S.fixAt < 5000) recordFix(S.raw);       // GPS tazeyse ilk noktayı hemen al
      S.follow = true; paintLocate();
      if (S.me) { S.map.setView([S.me.lat, S.me.lon], Math.max(S.map.getZoom(), 16)); paintRot(); }
      showRidePanel();
      if (el.gps.dataset.s === 'bad') toast('GPS sinyali zayıf ya da yok; konum geldikçe kayıt başlar.');
    }
    function pauseRide() {
      if (!rideActive()) return;
      S.rec.pause(Date.now()); S.trailBreak = true; persistMeta(); releaseWake(); paintRide(); if (S.tele) S.tele.pause();
      if (!S.active && !S.nav) stopWatch();
    }
    function resumeRide() {
      if (!S.rec || S.rec.status !== 'paused') return;
      S.rec.resume(Date.now()); S.trailBreak = true; persistMeta();
      if (S.tele) S.tele.resume(S.rec.id, S.rec.startedAt);
      S.follow = true; paintLocate(); startWatch(); acquireWake(); paintRide();
    }
    function paintRide() {
      const r = S.rec; if (!r) return;
      const now = Date.now(), sm = r.summary(now), paused = r.status === 'paused';
      const fresh = !paused && r.speed != null && now - r.speedAt < 6000;
      $('mm-spd').textContent = fresh ? String(Math.round(kmh(r.speed))) : '—';
      $('mm-spdu').textContent = paused ? 'duraklatıldı' : 'km/h';
      el.ride.classList.toggle('paused', paused);
      $('mm-sd').textContent = fmtDist(sm.distM);
      $('mm-st').textContent = fmtClock(sm.durationS);
      const mov = S.avgMode === 'mov', a = mov ? sm.avgMovingKmh : sm.avgTotalKmh;
      $('mm-savgl').textContent = mov ? 'Ort. hareket' : 'Ort. toplam';
      $('mm-sa').textContent = a == null ? '—' : Math.round(a) + ' km/h';
      $('mm-sm').textContent = sm.maxKmh == null ? '—' : Math.round(sm.maxKmh) + ' km/h';
      $('mm-pausel').textContent = paused ? 'Devam' : 'Duraklat';
      $('mm-pause').classList.toggle('resume', paused);
      $('mm-pause').setAttribute('aria-label', paused ? 'Sürüşe Devam Et' : 'Sürüşü Duraklat');
      if (S.nav) $('mm-spill').classList.add('rec');
    }
    $('mm-savg').addEventListener('click', () => { S.avgMode = S.avgMode === 'mov' ? 'tot' : 'mov'; store.set('mm_avg', S.avgMode); paintRide(); });
    $('mm-pause').addEventListener('click', () => (S.rec && S.rec.status === 'paused' ? resumeRide() : pauseRide()));
    el.start.addEventListener('click', startRide);

    function modal(html) { el.modal.innerHTML = '<div class="mm-mcard" role="dialog" aria-modal="true">' + html + '</div>'; el.modal.hidden = false; const b = el.modal.querySelector('[data-focus]'); if (b) b.focus(); }
    function closeModal() { el.modal.hidden = true; el.modal.innerHTML = ''; }
    function closeSummary() { closeModal(); clearTrail(); S.sumId = null; }
    $('mm-stop').addEventListener('click', () => {
      if (!rideOpen()) return;
      modal('<h3>Sürüş Bitirilsin mi?</h3><p>Sürüş cihaza kaydedilir ve özeti gösterilir.</p><div class="mm-mbtns"><button type="button" class="mm-mb" data-act="cancel">Devam Et</button><button type="button" class="mm-mb danger" data-act="end" data-focus>Bitir</button></div>');
    });
    el.modal.addEventListener('click', e => {
      const a = e.target.closest('[data-act]'); if (!a) return;
      const k = a.dataset.act;
      if (k === 'cancel') closeModal();
      else if (k === 'close') closeSummary();
      else if (k === 'end') endRide();
      else if (k === 'rec-end') endRide(S.recLastT);
      else if (k === 'rec-resume') { closeModal(); resumeRide(); }
      else if (k === 'analyze') { closeModal(); if (opts && opts.onAnalyze && S.sumRide) opts.onAnalyze(S.sumRide); }
      else if (k === 'live-no') closeModal();
      else if (k === 'live-yes') { closeModal(); liveConsented(a.dataset.aud === 'all' ? 'all' : 'friends'); }
    });

    const SYNC_TXT = { sending: 'Sunucuya gönderiliyor…', synced: 'Sunucuya kaydedildi ✓', offline: 'Çevrimdışı: sürüş cihazda güvende, bağlantı gelince otomatik gönderilecek.',
      auth: 'Oturum süresi dolmuş: giriş yapınca otomatik gönderilecek.', retry: 'Sunucu şu an yanıt vermiyor; otomatik tekrar denenecek.' };
    const savedLine = () => RS().persistent ? 'Cihaza kaydedildi ✓' : 'Bu tarayıcı kalıcı kayıt vermiyor';
    function onSyncState(id, state, msg) {
      if (id !== S.sumId) return;
      const p = host.querySelector('#mm-syncst'); if (!p) return;
      p.textContent = savedLine() + ' · ' + (state === 'failed' ? 'Sunucu sürüşü kabul etmedi: ' + (msg || '') + ' (veri cihazda saklanıyor)' : SYNC_TXT[state] || '');
      p.dataset.s = state;
    }
    function syncNow() { return RS().sync(S.user, onSyncState).then(r => { refreshCounts(); return r; }).catch(() => {}); }
    async function refreshCounts() {
      try {
        const c = await RS().counts(S.user), bad = c.pending + c.failed;
        $('mm-savedtxt').textContent = 'Kayıtlı Sürüş: ' + c.total + (bad ? ' · gönderilmeyi bekleyen: ' + bad : '');
        $('mm-syncbtn').hidden = !bad;
        const h = $('mm-synchint'), msgs = [];
        if (c.failed) msgs.push(c.failed + ' sürüş sunucu tarafından kabul edilmedi; cihazda saklanıyor.');
        if (!RS().persistent) msgs.push('Bu tarayıcı cihaz kaydı vermiyor.');
        h.hidden = !msgs.length; h.textContent = msgs.join(' ');
      } catch {}
    }
    $('mm-syncbtn').addEventListener('click', async () => { await RS().retryFailed(S.user); toast('Eşitleniyor…', 2500); const r = await syncNow(); if (r && r.offline) toast('Çevrimdışısın; bağlantı gelince otomatik gönderilecek.', 5000); });
    window.addEventListener('online', () => syncNow());
    S.syncTimer = setInterval(() => { if (document.body.contains(host)) syncNow(); }, 60000);

    const dur = s => fmtClock(s);
    function showSummary(sm, id, mode) {
      if (mode === 'empty') {
        return modal('<h3>Sürüş Özeti</h3><p>Hiç geçerli konum alınamadığı için kaydedilecek sürüş verisi yok; bu sürüş kaydedilmedi. Konum iznini ve GPS sinyalini kontrol et.</p><div class="mm-mbtns"><button type="button" class="mm-mb primary" data-act="close" data-focus>Tamam</button></div>');
      }
      const row = (k, v) => `<div><small>${k}</small><b>${v}</b></div>`, kh = v => (v == null ? '—' : Math.round(v) + ' km/h');
      const notes = [];
      if (sm.rejectedAcc || sm.rejectedJump) notes.push(`Elenen konum: ${sm.rejectedAcc} zayıf doğruluk, ${sm.rejectedJump} GPS sıçraması.`);
      if (sm.gaps || sm.reanchors) notes.push(`Konum alınamayan ${sm.gaps + sm.reanchors} kesinti oldu; o aralıklardaki mesafe ölçülmedi.`);
      if (sm.limitReached) notes.push('Kayıt sınırına ulaşıldı; sonrası kaydedilmedi.');
      const can = opts && opts.onAnalyze && mode === 'saved';
      modal('<h3>Sürüş Özeti</h3><div class="mm-sum mm-sum3">' +
        row('Mesafe', fmtDist(sm.distM)) + row('Süre', dur(sm.durationS)) + row('Ort. Hız', kh(sm.avgMovingKmh)) + '</div>' +
        (mode === 'saved' ? '<div class="mm-perf" id="mm-perf"><p>Performans raporu hazırlanıyor…</p></div>' : '') +
        notes.map(n => `<p class="warn">${esc(n)}</p>`).join('') +
        '<details class="mm-more"><summary>Daha fazla</summary><div class="mm-sum">' +
        row('Hareket', dur(sm.movingS)) + row('Duruş', dur(sm.stoppedS)) + row('Ort. Hız (toplam)', kh(sm.avgTotalKmh)) + row('Maks. Hız', kh(sm.maxKmh)) +
        row('Duraklatma', sm.pausedS >= 1 ? sm.pauseCount + ' × ' + dur(sm.pausedS) : '—') + row('Rota noktası', sm.points) + '</div><div id="mm-telsum"></div></details>' +
        `<p class="mm-sync" id="mm-syncst" data-s="local">${savedLine()}</p>` +
        '<div class="mm-mbtns">' + (can ? '<button type="button" class="mm-mb" data-act="analyze">Sürüş Analizi</button>' : '') + '<button type="button" class="mm-mb primary" data-act="close" data-focus>Tamam</button></div>');
      S.sumRide = id;
    }
    function endRide(at) {
      const r = S.rec; if (!rideOpen()) return;
      clearInterval(S.tick); S.tick = null; releaseWake();
      r.end(at || Date.now());
      const sm = r.summary(r.endedAt), id = r.id, hasData = r.track.length > 0;
      S.rec = null; el.ride.hidden = true; el.start.hidden = false; emit('mm:ride', { on: false });
      if (S.grp) grpStop();                                              // kişisel sürüş bitince grup konum paylaşımı da kapanır
      if (!S.active && !S.nav) stopWatch();
      if (r.track.length > 1) S.map.fitBounds(r.track, { paddingTopLeft: [40, 100], paddingBottomRight: [40, 330], maxZoom: 17 });
      S.follow = false; paintLocate(); S.sumId = id; paintRot();
      if (!hasData) { if (S.tele) S.tele.discard(); RS().remove(id).catch(() => {}); showSummary(sm, id, 'empty'); S.sumId = null; refreshCounts(); return; }
      showSummary(sm, id, 'saved');
      RS().saveMeta(metaOf(r)).then(() => syncNow(), persistFail);   // önce cihaza yaz, sonra gönder
      if (S.tele) S.tele.end(id, r.endedAt).then(res => {            // sensör verisi: eş kayıt olarak cihaza yazılır, sürüş sunucuya gidince gönderilir
        const box = el.modal.querySelector('#mm-telsum'); if (res && box) box.innerHTML = S.tele.summaryHtml(res);
        const pf = el.modal.querySelector('#mm-perf'); if (pf) pf.innerHTML = S.tele.perfHtml ? S.tele.perfHtml(res) : '';
        return syncNow();
      }).catch(() => {});
    }
    // Sayfa kapandı/yenilendiyse yarım kalan sürüşü cihazdan kurtar
    async function checkRecovery() {
      if (rideOpen()) return;
      const open = await RS().findOpen(S.user); if (!open.length) return;
      const lastAct = d => Math.max(d.startedAt, ...d.events.map(e => e[0]), ...(d.fixes.length ? [d.fixes[d.fixes.length - 1][0]] : []));
      for (const m of open.slice(1)) {                                  // olmaması gereken eski açık kayıtlar: son bilinen anda kapat
        const l = await RS().load(m.id); if (!l) continue;
        const r = RC().Recorder.replay(l.data), t = lastAct(l.data);
        if (r.status === 'active') r.pause(t); r.end(t);
        if (r.track.length) await RS().saveMeta(metaOf(r)); else await RS().remove(m.id);
      }
      const l = await RS().load(open[0].id); if (!l) return;
      const rec = RC().Recorder.replay(l.data), t = lastAct(l.data);
      if (rec.status === 'active') rec.pause(t);                         // kopma anında duraklatılmış say
      S.rec = rec; S.recLastT = t; S.limitToast = false;
      newTrail(); rec.track.forEach((p, i) => trailAdd(p[0], p[1], i === 0));
      persistMeta(); showRidePanel();
      if (rec.track.length > 1) S.map.fitBounds(rec.track, { paddingTopLeft: [40, 100], paddingBottomRight: [40, 330], maxZoom: 17 });
      const sm = rec.summary(t), when = new Date(rec.startedAt).toLocaleString('tr-TR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
      modal('<h3>Yarım Kalan Sürüş</h3><p>' + esc(when) + ' tarihli sürüş sayfa kapanınca/yenilenince yarıda kalmış. Cihazda saklanan ' + sm.points + ' GPS noktası, ' + fmtDist(sm.distM) + ' korundu. Sürüş son kayıt anında duraklatıldı.</p>' +
        '<div class="mm-mbtns"><button type="button" class="mm-mb" data-act="rec-end">Bitir ve Kaydet</button><button type="button" class="mm-mb primary" data-act="rec-resume" data-focus>Devam Et</button></div>');
    }
    document.addEventListener('visibilitychange', () => {
      if (!rideActive()) return;
      if (document.hidden) S.hiddenAt = Date.now();
      else {
        if (S.hiddenAt && Date.now() - S.hiddenAt > 5000) toast('Uygulama arka plandaydı; bu sürede konum kaydı olmayabilir.', 6000);
        S.hiddenAt = 0; acquireWake();
      }
    });

    /* ---------- Kontroller ---------- */
    $('mm-zin').addEventListener('click', () => S.ready && S.map.zoomIn());
    $('mm-zout').addEventListener('click', () => S.ready && S.map.zoomOut());
    $('mm-loc').addEventListener('click', flyToMe);
    $('mm-ctr').addEventListener('click', flyToMe);

    el.mbtn.addEventListener('click', e => { e.stopPropagation(); const o = el.menu.hidden; el.menu.hidden = !o; el.mbtn.setAttribute('aria-expanded', String(o)); });
    /* Sürüş ekranı yerleşimi (tam / ince şerit / yalnız hız / köşe kartı) ve grup bilgi boyutu: kullanıcı seçer, tarayıcıda saklanır */
    function setHud(v) { v = ['full', 'bar', 'speed', 'card'].includes(v) ? v : 'full'; el.root.dataset.hud = v; store.set('mm_hud', v); el.menu.querySelectorAll('[data-hud]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.hud === v))); }
    el.menu.addEventListener('click', e => { const h = e.target.closest('[data-hud]'); if (h) setHud(h.dataset.hud); });
    setHud(store.get('mm_hud', 'full'));
    el.menu.addEventListener('click', e => { e.stopPropagation(); const t = e.target.closest('[data-th]'); if (t) setTheme(t.dataset.th); });
    $('mm-wake').checked = S.keepAwake;
    $('mm-wake').addEventListener('change', e => { S.keepAwake = e.target.checked; store.set('mm_wake', S.keepAwake ? '1' : '0'); if (rideActive()) (S.keepAwake ? acquireWake() : releaseWake()); });
    if (!('wakeLock' in navigator)) { $('mm-wake').disabled = true; $('mm-wake').checked = false; $('mm-wakenote').textContent = 'Bu tarayıcı ekranı açık tutmayı desteklemiyor. Sürüş boyunca ekranı kendin açık tut; ekran kilitlenirse konum alınamayabilir.'; }
    host.addEventListener('click', e => { if (!el.menu.hidden && !el.menu.contains(e.target)) { el.menu.hidden = true; el.mbtn.setAttribute('aria-expanded', 'false'); } if (!el.results.hidden && !el.form.contains(e.target) && !el.results.contains(e.target)) showResults(''); });
    host.addEventListener('keydown', e => { if (e.key === 'Escape') { el.menu.hidden = true; if (!el.modal.hidden && el.modal.querySelector('[data-act=close]')) closeSummary(); } });
    setTheme(S.theme);

    /* ---------- Başlatma ---------- */
    /* ---------- Telemetri (public/telemetry-core.js + telemetry.js): sensör verisi sürüş kaydına eş kayıt olarak bağlanır ---------- */
    function initTele() {
      if (S.tele) return;
      const load = src => new Promise((res, rej) => { if (document.querySelector('script[data-tele="' + src + '"]')) return res(); const sc = document.createElement('script'); sc.src = src; sc.dataset.tele = src; sc.onload = res; sc.onerror = () => rej(new Error(src)); document.head.appendChild(sc); });
      const start = () => { S.tele = window.Telemetry.mount({ $, esc, toast, store, TC: window.TelemetryCore, me: () => S.me }); if (rideActive()) S.tele.resume(S.rec.id, S.rec.startedAt); S.tele.sweep(S.user); };
      (window.TelemetryCore ? Promise.resolve() : load('/telemetry-core.js')).then(() => (window.Telemetry ? null : load('/telemetry.js'))).then(start).catch(() => {});   // yüklenemezse harita ve sürüş kaydı yine çalışır
    }
    $('mm-tbtn').addEventListener('click', () => { if (S.tele) { S.tele.openSheet(); } else toast('Sensör modülü yükleniyor…'); });
    function boot() {
      el.load.hidden = false; el.retry.hidden = true; el.loadMsg.textContent = 'Harita yükleniyor…';
      const cfgP = fetch('/api/maps/config', { credentials: 'same-origin' }).then(r => { if (!r.ok) throw new Error(r.status === 401 ? 'Oturum süresi dolmuş. Sayfayı yenile.' : 'Harita ayarları alınamadı.'); return r.json(); });
      const ridesP = loadScripts(['/ride-core.js', '/ride-store.js']).then(() => window.RideStore.init());
      Promise.all([cfgP, loadLeaflet(), ridesP]).then(([cfg]) => { initMap(cfg); initTele(); checkRecovery().catch(() => {}); refreshCounts(); syncNow(); }).catch(err => {
        el.loadMsg.textContent = err.message || 'Harita yüklenemedi.'; el.retry.hidden = false;
      });
    }
    el.retry.addEventListener('click', boot);
    boot();

    // ---------- Grup sürüşü modu (Sosyal › İnterkom ve Sürüş › «Haritada Aç») ----------
    // Aynı sürüş sistemi (kayıt, hız, ortalama hız, mesafe, güzergâh); ek olarak odadaki sürücüler NUMARALI canlı işaretle görünür ve konum odaya paylaşılır.
    // Sunucu: grp:watch/grp:share/grp:update → grp:state (ridegroups.js). Yalnız sürüş odasındakiler izler/paylaşır.
    const GRP_TXT = { behind: 'geride kaldı', away: 'gruptan uzaklaştı', off: 'güzergâh dışında' };
    function grpChip() {
      const c = $('mm-grp'); if (!c) return; const g = S.grp;
      if (!g) { c.hidden = true; return; }
      const n = (g.rows || []).filter(r => r.lat != null && !r.lost).length;
      c.hidden = false; c.dataset.s = g.sharing ? 'ok' : 'warn'; c.textContent = 'Grup · No ' + g.n + ' · ' + Math.max(n, 1) + ' sürücü';
    }
    function riderIcon(r) {
      return window.L.divIcon({ className: 'mm-icon mm-rider', iconSize: [34, 34], iconAnchor: [17, 17],
        html: '<b class="mm-rn' + (r.lead ? ' lead' : '') + '">' + (Number(r.n) || '?') + '</b>' + (r.spd != null && isFinite(r.spd) ? '<i>' + Math.round(Number(r.spd)) + '</i>' : '') });
    }
    function grpPaint(m) {
      const g = S.grp; if (!g || !m || m.gid !== g.gid || !S.map) return;
      g.rows = m.members || []; const seen = new Set();
      for (const r of g.rows) {
        if (r.lat == null || r.lost || r.n === g.n) continue;                  // kendi işaretimiz zaten çiziliyor
        const k = String(r.n || r.u); seen.add(k); let mk = g.mk.get(k);
        if (!mk) { mk = window.L.marker([r.lat, r.lon], { icon: riderIcon(r), title: r.u + (r.n ? ' · No ' + r.n : ''), keyboard: false, zIndexOffset: 500 }).addTo(S.map); g.mk.set(k, mk); }
        else { mk.setLatLng([r.lat, r.lon]); mk.setIcon(riderIcon(r)); }
      }
      for (const [k, mk] of [...g.mk]) if (!seen.has(k)) { mk.remove(); g.mk.delete(k); }
      grpChip();
    }
    function grpSend(f) {
      const g = S.grp; if (!g || !g.sharing || !g.sock) return;
      const t = Date.now(), last = g.last, far = !last || Math.abs(f.lat - last.lat) + Math.abs(f.lon - last.lon) > 0.00008;   // ≈8 m
      if (last && (t - last.at < 4000 || (!far && t - last.at < 20000))) return;
      g.last = { at: t, lat: f.lat, lon: f.lon };
      g.sock.emit('grp:update', { gid: g.gid, lat: f.lat, lon: f.lon, acc: f.acc, spd: f.speed });
    }
    function grpJoin() {
      const g = S.grp; if (!g) return;
      g.sock.emit('grp:watch', { gid: g.gid }, r => { if (r && r.error) { toast(r.error, 6000); grpStop(true); } });
      g.sock.emit('grp:share', { gid: g.gid, on: true, consent: true }, r => {
        if (!S.grp) return;
        if (r && r.error) { toast(r.error, 6000); S.grp.sharing = false; } else S.grp.sharing = true; grpChip();
      });
    }
    function grpStop(silent) {
      const g = S.grp; if (!g) return; S.grp = null;
      try { g.sock.emit('grp:share', { gid: g.gid, on: false }, () => {}); g.sock.emit('grp:unwatch', { gid: g.gid }); } catch {}
      for (const [, f] of g.hs) { try { g.sock.off(f[0], f[1]); } catch {} }
      for (const mk of g.mk.values()) mk.remove();
      grpChip(); if (!silent) toast('Grup paylaşımı kapandı.');
    }
    function grpStart(cfg) {
      if (!cfg || !cfg.sock || !cfg.gid || !cfg.n) return toast('Grup sürüşü için önce sürüş numaranı yaz.');
      if (!S.ready) return toast('Harita henüz hazır değil.');
      if (S.grp) grpStop(true);
      const g = S.grp = { gid: cfg.gid, n: cfg.n, sock: cfg.sock, mk: new Map(), rows: [], sharing: false, last: null, hs: [] };
      const on = (ev, fn) => { g.sock.on(ev, fn); g.hs.push([ev, [ev, fn]]); };
      on('grp:state', grpPaint);
      on('grp:alert', m => { if (m && m.gid === g.gid) toast(m.u + ' ' + (GRP_TXT[m.f] || 'uyarı'), 5000); });
      on('grp:taken', m => { if (m && m.gid === g.gid) { toast('Grup paylaşımı başka bir cihaza geçti.'); grpStop(true); } });
      on('grp:changed', m => {
        if (!m || m.gid !== g.gid) return;
        if (m.kind === 'ride-end') { toast('Grup sürüşü bitti.', 6000); const open = rideOpen(); grpStop(true); if (open) endRide(Date.now()); }
        else if (m.kind === 'removed') grpStop(true);
      });
      on('connect', grpJoin);                                                  // bağlantı koparsa yeniden izle/paylaş
      if (!rideOpen()) startRide();                                            // kişisel sürüş kaydı: ana ekrandaki sürüş sistemiyle aynı
      startWatch(); grpJoin(); grpChip();
    }
    return {
      activate() { S.active = true; if (S.ready) { S.map.invalidateSize(); measureHead(); startWatch(); } },
      deactivate() { S.active = false; if (!rideActive() && !S.nav) stopWatch(); },
      flyToMe, startEvent, groupRide: grpStart, groupRideStop: () => grpStop(), groupRideOn: () => !!S.grp,
      // Ayarlar ekranı: tercihleri (ekran açık tut, harita teması, ortalama hız) yeniden okur / sensör sayfasını açar
      prefs() {
        S.keepAwake = store.get('mm_wake', '1') === '1'; const w = $('mm-wake'); if (w && !w.disabled) w.checked = S.keepAwake;
        setTheme(store.get('mm_theme', 'dark')); S.avgMode = store.get('mm_avg', 'mov') === 'tot' ? 'tot' : 'mov';
        if (S.rec) paintRide(); if (rideActive()) (S.keepAwake ? acquireWake() : releaseWake());
      },
      openSensors() { if (S.tele) S.tele.openSheet(); else toast('Sensör modülü yükleniyor, birazdan tekrar dene.'); }
    };
  }

  window.MotoMap = { mount, _core: Core, ICON };
})();
