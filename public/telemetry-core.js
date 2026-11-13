'use strict';
/* Telemetri çekirdeği: telefon ivmeölçer/jiroskop + GPS → boylamsal/yanal ivme, tahmini yatış açısı, ani fren/hızlanma olayları.
   Tarayıcıda window.TelemetryCore, Node'da require('./public/telemetry-core.js') (sunucu aynı doğrulamayı kullanır).
   Sensör KAYNAĞI burada yoktur (tarayıcı bağdaştırıcısı public/telemetry.js'te); bu dosya yalnızca verilen örnekleri işler: sahte veri ÜRETMEZ.

   Her metrik dört durumdan birinde raporlanır:
     measured    = sensörün ölçtüğü değer (kalibrasyona bağlı bileşenler dahil)         ör. boylamsal/yanal ivme, dönüş hızı
     estimated   = fiziksel modelle TAHMİN; gerçek değer olduğu kabul edilmez           ör. yatış açısı
     unavailable = cihaz destekliyor ama güvenilir ölçüm yok (neden kodu ile)            ör. kalibrasyon yok, hız düşük
     unsupported = cihaz/tarayıcı bu veriyi vermiyor                                     ör. jiroskop yok
   Eksen sözleşmesi (motosiklet çerçevesi): x ileri, y sol, z yukarı. Yatış açısı: + = sola, − = sağa. Boylamsal ivme: + hızlanma, − frenleme.

   YATIŞ AÇISI NASIL TAHMİN EDİLİR (telefonun eğimi YATIŞ SAYILMAZ): dengeli viraj modelinde sin(yatış) = hız × W / g.
   W = jiroskopun motosikletin «yukarı» ekseni (statik kalibrasyonla bulunan) üzerindeki bileşeni, hız = GPS hızı. İvmeölçerden
   gelen yerçekimi yönü virajda yanıltıcıdır (görünür yerçekimi motosikletle birlikte yatar), bu yüzden eğim ondan okunmaz.
   Çapraz kontroller (biri tutmazsa «veri yok»): ivmeölçer büyüklüğü ≈ g·√(1+tan²yatış)+boylamsal bileşen; telefonun montajının kayması;
   jiroskop işareti/ölçeği GPS dönüş hızıyla uyumlu mu; hız ≥ 5 m/sn; GPS taze; ani fren/hızlanma sırasında değil.
   Kalan hatalar: sürücünün gövde duruşu, lastik profili, direksiyon açısı, geçiş (yatışa giriş/çıkış) anları, montajın esnemesi.
   Bu model gerçek yatış ölçümüyle DOĞRULANMADI. Eşikler gerçek sürüşle AYARLANMADI (TH altındaki değerler başlangıç değerleridir). */
(function (root) {
  const G = 9.80665, D2R = Math.PI / 180, R2D = 180 / Math.PI;
  const TH = Object.freeze({
    brake: [3.5, 5.5, 7.5],      // m/sn²: orta / sert / acil frenleme (≈0,36 / 0,56 / 0,76 g)
    accel: [3.0, 5.0],           // m/sn²: orta / sert hızlanma (≈0,31 / 0,51 g)
    endRatio: 0.5,               // olay, ivme eşiğin %50'sinin altına inince biter
    minDurMs: 350,               // daha kısa süreli tepe (çukur, titreşim) olay sayılmaz
    minBrakeV: 3,                // m/sn: frenleme olayı için olay öncesi minimum GPS hızı
    gpsBrake: 3.15, gpsAccel: 2.7, // GPS hız türevinden olay eşikleri (1 Hz türev tepeleri yumuşatır)
    gpsMinDurMs: 1000, gpsMinDv: 2.0,
    minLeanV: 5,                 // m/sn (18 km/sa): altında yatış tahmini yapılmaz
    maxLeanDeg: 65, maxLonForLean: 3.0,
    mountDeg: 18, mountHoldS: 3, // düz giderken yerçekimi yönü kalibrasyondan bu kadar sapar ve bu kadar sürerse montaj değişti
    vibLimit: 3.0,               // m/sn² RMS: üstü «gürültülü»
    maxBins: 40000, maxEvs: 2000
  });
  // Neden kodlarının kullanıcıya gösterilen Türkçe karşılıkları (telemetry.js ve analysis.js ortak kullanır)
  const REASON_TR = {
    'no-gyro': 'telefonda jiroskop yok', 'no-cal': 'kalibrasyon yapılmadı', 'mount-changed': 'telefon yerinden oynadı, yeniden kalibre et',
    'gyro-scale': 'jiroskop verisi GPS ile uyuşmuyor', verifying: 'doğrulanıyor (ilk virajlar bekleniyor)', 'gps-stale': 'GPS verisi eski',
    'low-speed': 'hız çok düşük (<18 km/sa)', braking: 'frenleme/hızlanma sırasında', inconsistent: 'sensörler tutarsız (montaj gevşek olabilir)',
    'out-of-range': 'değer geçerli aralığın dışında', 'no-f': 'ileri yön bulunuyor (düz yolda hızlanma/frenleme gerekir)', 'no-lin': 'cihaz doğrusal ivme vermiyor',
    'no-sensor': 'hareket sensörü yok', unknown: 'neden bilinmiyor'
  };
  const REASONS = ['no-gyro', 'no-cal', 'mount-changed', 'gyro-scale', 'verifying', 'gps-stale', 'low-speed', 'braking', 'inconsistent', 'out-of-range', 'no-f', 'no-lin', 'no-heading'];

  // ---------- Küçük matematik ----------
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm = a => Math.sqrt(dot(a, a));
  const unit = a => { const n = norm(a); return n > 1e-9 ? [a[0] / n, a[1] / n, a[2] / n] : null; };
  const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const angleDeg = (a, b) => Math.acos(Math.max(-1, Math.min(1, dot(a, b) / (norm(a) * norm(b) || 1)))) * R2D;
  const r1 = v => Math.round(v * 10) / 10, r2 = v => Math.round(v * 100) / 100, r3 = v => Math.round(v * 1000) / 1000;
  const wrapPi = a => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
  function hav(lat1, lon1, lat2, lon2) {
    const a = Math.sin((lat2 - lat1) * D2R / 2) ** 2 + Math.cos(lat1 * D2R) * Math.cos(lat2 * D2R) * Math.sin((lon2 - lon1) * D2R / 2) ** 2;
    return 12742000 * Math.asin(Math.sqrt(a));
  }
  function bearing(lat1, lon1, lat2, lon2) {
    const y = Math.sin((lon2 - lon1) * D2R) * Math.cos(lat2 * D2R), x = Math.cos(lat1 * D2R) * Math.sin(lat2 * D2R) - Math.sin(lat1 * D2R) * Math.cos(lat2 * D2R) * Math.cos((lon2 - lon1) * D2R);
    return Math.atan2(y, x);
  }
  const median = a => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

  // Düzensiz örneklemeye uygun, art arda iki tek kutuplu alçak geçiren süzgeç (≈2. derece, taşmasız)
  class LP {
    constructor(tau, n, stages) { this.tau = tau; this.n = n || 1; this.k = stages || 2; this.st = null; }
    reset() { this.st = null; }
    step(x, dt) {
      const a = 1 - Math.exp(-dt / this.tau);
      if (this.n === 1) {
        if (!this.st) this.st = new Array(this.k).fill(x);
        let v = x; for (let i = 0; i < this.k; i++) { this.st[i] += a * (v - this.st[i]); v = this.st[i]; } return v;
      }
      if (!this.st) this.st = Array.from({ length: this.k }, () => x.slice());
      let v = x; for (let i = 0; i < this.k; i++) { const s = this.st[i]; for (let j = 0; j < 3; j++) s[j] += a * (v[j] - s[j]); v = s; }
      return v.slice();
    }
  }
  // Tek örneklik sıçramaları (çukur, veri hatası) ayıkla: bileşen başına 3'lü ortanca
  class Med3 {
    constructor(n) { this.n = n; this.b = []; }
    reset() { this.b = []; }
    step(x) {
      const v = this.n === 1 ? [x] : x; this.b.push(v.slice()); if (this.b.length > 3) this.b.shift();
      if (this.b.length < 3) return this.n === 1 ? x : x.slice();
      const out = v.map((_, j) => { const t = [this.b[0][j], this.b[1][j], this.b[2][j]].sort((p, q) => p - q); return t[1]; });
      return this.n === 1 ? out[0] : out;
    }
  }

  // ---------- GPS izi: hız (cihazdan ya da konumdan türetilmiş), ivme, yön değişimi ----------
  class GpsTrack {
    constructor() { this.f = []; this.ac = []; this.yr = []; }
    add(fx) {
      if (!(fx.acc <= 50) || !isFinite(fx.lat) || !isFinite(fx.lon) || !isFinite(fx.t)) return null;    // zayıf doğruluk kullanılmaz
      let L = this.f[this.f.length - 1];
      if (L && fx.t <= L.t) { if (L.t - fx.t <= 5000) return null; this.f = []; this.ac = []; this.yr = []; L = null; }   // saat çok geri alındı: eski iz atılır (aksi halde tüm yeni konumlar düşerdi)
      let v = null, src = null;
      if (fx.speed != null && isFinite(fx.speed) && fx.speed >= 0 && fx.speed < 90) { v = fx.speed; src = 'd'; }               // cihazın ölçtüğü hız
      else if (L && fx.t - L.t >= 300 && fx.t - L.t <= 3000) { const vv = hav(L.lat, L.lon, fx.lat, fx.lon) / ((fx.t - L.t) / 1000); if (vv < 90) { v = vv; src = 'p'; } }   // konumdan türetilmiş (daha kaba)
      let h = null;
      if (v != null && v >= 3) {
        if (fx.hdg != null && isFinite(fx.hdg)) h = fx.hdg * D2R;                                                              // cihazın yönü (kuzeyden saat yönü)
        else if (L && hav(L.lat, L.lon, fx.lat, fx.lon) >= 12) h = bearing(L.lat, L.lon, fx.lat, fx.lon);
      }
      const rec = { t: fx.t, lat: fx.lat, lon: fx.lon, v, src, h };
      this.f.push(rec);
      while (this.f.length > 2 && fx.t - this.f[0].t > 150000) this.f.shift();
      const cut = fx.t - 150000;
      while (this.ac.length && this.ac[0].t < cut) this.ac.shift();
      while (this.yr.length && this.yr[0].t < cut) this.yr.shift();
      if (L) {
        const dt = (fx.t - L.t) / 1000;
        if (L.v != null && v != null && dt >= 0.4 && dt <= 2.5) this.ac.push({ t: (L.t + fx.t) / 2, a: (v - L.v) / dt, v1: L.v, v2: v, t1: L.t, t2: fx.t });
        if (L.h != null && h != null && dt >= 0.4 && dt <= 2.5) this.yr.push({ t: (L.t + fx.t) / 2, yr: -wrapPi(h - L.h) / dt });   // sola dönüş = +
      }
      return rec;
    }
    last() { return this.f[this.f.length - 1] || null; }
    at(t) {                                                       // hız: {v, src} ya da null (GPS bayat/boşluk)
      const f = this.f; if (!f.length) return null;
      const last = f[f.length - 1];
      if (t > last.t + 2500) return null;
      if (t >= last.t) return last.v != null ? { v: last.v, src: last.src } : null;
      for (let i = f.length - 2; i >= 0; i--) if (f[i].t <= t) {
        const a = f[i], b = f[i + 1];
        if (b.t - a.t > 3500 || a.v == null || b.v == null) return null;
        return { v: a.v + (t - a.t) / (b.t - a.t) * (b.v - a.v), src: a.src === 'd' && b.src === 'd' ? 'd' : 'p' };
      }
      return null;
    }
    posAt(t) {
      const f = this.f; if (!f.length) return null;
      const last = f[f.length - 1];
      if (t >= last.t) return t - last.t <= 2500 ? [last.lat, last.lon] : null;
      for (let i = f.length - 2; i >= 0; i--) if (f[i].t <= t) {
        const a = f[i], b = f[i + 1]; if (b.t - a.t > 3500) return null;
        const k = (t - a.t) / (b.t - a.t); return [a.lat + k * (b.lat - a.lat), a.lon + k * (b.lon - a.lon)];
      }
      return null;
    }
    accelAt(t) {                                                  // GPS hız türevi (m/sn²), ≈1 Hz çözünürlük
      const a = this.ac; if (!a.length) return null;
      if (t <= a[0].t) return a[0].t - t <= 1500 ? a[0].a : null;
      const l = a[a.length - 1]; if (t >= l.t) return t - l.t <= 1500 ? l.a : null;
      for (let i = a.length - 2; i >= 0; i--) if (a[i].t <= t) { const p = a[i], q = a[i + 1]; if (q.t - p.t > 3000) return null; return p.a + (t - p.t) / (q.t - p.t) * (q.a - p.a); }
      return null;
    }
    yawRateAt(t) {                                                // GPS yön değişimi (rad/sn, sola +)
      const y = this.yr; for (let i = y.length - 1; i >= 0; i--) if (y[i].t <= t) return t - y[i].t <= 1200 ? y[i].yr : null;
      return null;
    }
  }

  // ---------- Statik kalibrasyon: telefon montajdayken motosiklet dik ve hareketsizken yerçekimi yönü ----------
  // samples: [{ ag:[x,y,z] (m/sn², ivme+yerçekimi), rot:[x,y,z]|null (rad/sn) }]  → { ok, u, ... } ya da { ok:false, reason }
  function staticCalibrate(samples) {
    if (!samples || samples.length < 30) return { ok: false, reason: 'few' };
    const n = samples.length, mean = a => { const m = [0, 0, 0]; for (const s of a) { m[0] += s.ag[0]; m[1] += s.ag[1]; m[2] += s.ag[2]; } return scale(m, 1 / a.length); };
    const m = mean(samples), mag = norm(m);
    if (!(mag > 8.3 && mag < 11.3)) return { ok: false, reason: 'gravity-magnitude', mag };           // ivmeölçer ≈ g okumuyor
    const h = n >> 1, m1 = mean(samples.slice(0, h)), m2 = mean(samples.slice(h));
    const drift = angleDeg(m1, m2);                                                                   // yarılar arası yön kayması
    let s2 = 0; for (const s of samples) { const a = angleDeg(s.ag, m); s2 += a * a; }
    const spread = Math.sqrt(s2 / n);                                                                 // anlık gürültü/titreşim (rölantide normaldir)
    let gm = [0, 0, 0], gr = 0, gn = 0;
    for (const s of samples) if (s.rot) { gm = [gm[0] + s.rot[0], gm[1] + s.rot[1], gm[2] + s.rot[2]]; gr += dot(s.rot, s.rot); gn++; }
    const gyroMean = gn ? norm(scale(gm, 1 / gn)) : null, gyroRms = gn ? Math.sqrt(gr / gn) : null;
    if (drift > 2.5 || spread > 12 || (gyroMean != null && gyroMean > 0.06) || (gyroRms != null && gyroRms > 0.35)) return { ok: false, reason: 'moving', drift: r1(drift), spread: r1(spread), gyroMean, gyroRms };
    return { ok: true, u: unit(m).map(r3), mag: r2(mag), drift: r1(drift), spread: r1(spread), gyroRms: gyroRms == null ? null : r3(gyroRms), n };
  }

  const planeBasis = u => {                                       // u'ya dik düzlemde ortonormal b1, b2 (b2 = u × b1)
    const a = Math.abs(u[0]) < 0.8 ? [1, 0, 0] : [0, 1, 0];
    const b1 = unit(sub(a, scale(u, dot(a, u)))); return [b1, cross(u, b1)];
  };

  // ---------- İşlemci ----------
  class Processor {
    constructor() {
      this.gps = new GpsTrack(); this.lagMs = 0; this.lagQ = null;
      this.cal = { u: null, uAt: null, uQ: null, uFlipped: false, f: null, l: null, fSrc: null, fQ: null, recal: false };
      this.gyroOk = null;                                          // null = henüz doğrulanmadı, true/false = GPS yön değişimiyle doğrulandı
      this.mountMoved = false; this.mountBad = 0;
      this.sawRot = false; this.sawLin = false; this.nImu = 0; this.dts = [];
      this.mAg = new Med3(3); this.mLin = new Med3(3); this.mRot = new Med3(3);
      this.lpAg = new LP(0.4, 3); this.lpSlow = new LP(1.5, 3); this.lpBase = new LP(6, 3); this.lpLin = new LP(0.05, 3); this.lpW = new LP(0.1, 1); this.lpVib = new LP(1, 1, 1);
      this.lpRoll = new LP(0.1, 1); this.lpLean = new LP(0.08, 1);
      this.cons = 0; this.consN = 0;
      this.pca = null; this.pcaTick = 0; this.sgn = { swg: 0, syy: 0, sww: 0, n: 0 };
      this.corr = []; this.corrAt = 0; this.corrTick = 0;
      this.ev = { open: false }; this.gev = { open: false };
      this.bins = []; this.evs = []; this.pendB = 0; this.pendE = 0; this.b = null;
      this.cover = { lean: { v: 0, tot: 0, r: {} }, aLon: { v: 0, tot: 0, r: {} }, aLat: { v: 0, tot: 0, r: {} }, yaw: { v: 0, tot: 0, r: {} } };
      this.noisyS = 0; this.live = { lean: null, leanState: 'unavailable', leanReason: 'no-cal', aLon: null, aLat: null, v: null };
      this.lastT = 0; this.firstT = 0;
    }
    // Kayıtlı kalibrasyonu yükle (montaj değişmediği sürece geçerli). f, bu sürüşte yeniden bulunana kadar geçici kullanılır.
    setCalibration(c) {
      const u = c && c.u && c.u.length === 3 ? unit(c.u) : null;
      this.cal = { u, uAt: u ? (c.uAt || null) : null, uQ: u ? (c.uQ || null) : null, uFlipped: !!(u && c.uFlipped), f: null, l: null, fSrc: null, fQ: null, recal: false };
      if (u && c.f && c.f.length === 3) { const f0 = unit(sub(c.f, scale(u, dot(c.f, u)))); if (f0) { this.cal.f = f0; this.cal.l = cross(u, f0); this.cal.fSrc = 'saved'; } }
      this.gyroOk = u && c.gyroOk === true ? true : null;
      this.mountMoved = false; this.mountBad = 0; this.pca = null; this.sgn = { swg: 0, syy: 0, sww: 0, n: 0 }; this.cons = 0; this.consN = 0;
      this.basis = u ? planeBasis(u) : null;
    }
    exportCalibration() { const c = this.cal; return { u: c.u, uAt: c.uAt, uQ: c.uQ, uFlipped: c.uFlipped, f: c.f, fSrc: c.fSrc, gyroOk: this.gyroOk }; }
    rateHz() { const m = median(this.dts); return m ? Math.round(1000 / m) : null; }

    // ---- GPS ----
    feedFix(fx) {
      const rec = this.gps.add(fx); if (!rec) return;
      this._gpsEvent();
    }
    vAt(t) { return this.gps.at(t + this.lagMs); }

    // ---- IMU ----
    feedImu(s) {
      if (!s || !s.ag || !isFinite(s.t)) return;
      const t = s.t;
      if (this.lastT && t <= this.lastT) { if (this.lastT - t <= 5000) return; this._gap(t); this.lastT = 0; }   // saat çok geri alındı: süzgeçler yeniden başlar
      let dt = this.lastT ? (t - this.lastT) / 1000 : 0.02;
      if (this.lastT && dt > 1.5) { this._gap(t); dt = 0.02; }     // kesinti: süzgeçler yeniden başlar
      if (dt > 0.25) dt = 0.25;
      if (this.lastT) { if (this.dts.length < 300) this.dts.push(Math.round(dt * 1000)); else this.dts[this.nImu % 300] = Math.round(dt * 1000); }
      if (!this.firstT) this.firstT = t;
      this.lastT = t; this.nImu++;
      if (s.rot) this.sawRot = true;
      if (s.lin) this.sawLin = true;
      const ag = this.mAg.step(s.ag), lin = s.lin ? this.mLin.step(s.lin) : null, rot = s.rot ? this.mRot.step(s.rot) : null;
      const agLP = this.lpAg.step(ag, dt), agSlow = this.lpSlow.step(ag, dt);
      const vib = Math.sqrt(Math.max(0, this.lpVib.step(dot(sub(ag, agLP), sub(ag, agLP)), dt))), noisy = vib > TH.vibLimit;
      if (noisy) this.noisyS += dt;
      const cal = this.cal, u = cal.u, o = { aLon: null, aLat: null, lean: null, yaw: null, roll: null, q: 0 };
      const why = { aLon: null, aLat: null, lean: null, yaw: null };
      const gv = this.vAt(t), v = gv ? gv.v : null;

      // doğrusal ivme: işletim sisteminin yerçekimi çıkarılmış verisi (ölçülen) ya da yüksek geçiren tahmin
      let linX = lin, linSrc = 'os';
      if (!lin) { linX = sub(ag, this.lpBase.step(ag, dt)); linSrc = 'hp'; }
      const linLP = this.lpLin.step(linX, dt);
      const W = u && rot ? dot(rot, u) : null, Wlp = W != null ? this.lpW.step(W, dt) : null;

      if (!u) { why.aLon = why.aLat = why.lean = why.yaw = this.mountMoved ? 'mount-changed' : 'no-cal'; }
      else {
        // 1) boylamsal / yanal ivme (motosiklet çerçevesi; yanal bileşen yatık eksen boyuncadır: ≈ gerçek yatay ivme × cos(yatış))
        if (!cal.f) { why.aLon = why.aLat = 'no-f'; }
        else {
          o.aLon = dot(linLP, cal.f); o.q |= linSrc === 'os' ? 1 : 2;
          if (linSrc === 'os') o.aLat = dot(linLP, cal.l); else why.aLat = 'no-lin';
        }
        // 2) dönüş hızı (ölçülen): jiroskop, yukarı eksen etrafında
        if (Wlp != null) { if (this.gyroOk === false) why.yaw = 'gyro-scale'; else if (this.gyroOk !== true) why.yaw = 'verifying'; else o.yaw = Wlp * R2D; } else   // jiroskop ölçeği/işareti GPS ile doğrulanana kadar rapor edilmez
           why.yaw = this.sawRot || this.nImu < 60 ? 'verifying' : 'no-gyro';
        if (cal.f && rot && this.gyroOk === true) { const rr = this.lpRoll.step(dot(rot, cal.f), dt); o.roll = (cal.uFlipped ? -rr : rr) * R2D; }   // ters işaretli ivmeölçerde f de ters yönlüdür
        // 3) montaj kontrolü: düz giderken yerçekimi yönü kalibrasyondan çok saptıysa telefon yerinden oynamıştır
        const straight = Wlp != null && Math.abs(Wlp) < 0.05 && v != null && v >= TH.minLeanV && norm(linLP) < 1.5;
        if (straight) { if (angleDeg(agSlow, cal.uFlipped ? scale(u, -1) : u) > TH.mountDeg) { this.mountBad += dt; if (this.mountBad >= TH.mountHoldS) this.mountMoved = true; } else this.mountBad = Math.max(0, this.mountBad - dt); }
        if (this.mountMoved) { o.aLon = o.aLat = o.yaw = o.roll = null; o.q = 0; why.aLon = why.aLat = why.lean = why.yaw = 'mount-changed'; }
        else {
          // 4) yatış açısı TAHMİNİ
          const aLonChk = o.aLon != null ? o.aLon : (this.gps.accelAt(t + this.lagMs) || 0);
          let lean = null, reason = null;
          if (!this.sawRot && this.nImu >= 60) reason = 'no-gyro';
          else if (Wlp == null) reason = 'verifying';
          else if (this.gyroOk === false) reason = 'gyro-scale';
          else if (v == null) reason = 'gps-stale';
          else if (v < TH.minLeanV) reason = 'low-speed';
          else if (Math.abs(aLonChk) > TH.maxLonForLean) reason = 'braking';
          else {
            const sn = v * Wlp / G;
            if (Math.abs(sn) > 0.95) reason = 'out-of-range';
            else {
              const phi = Math.asin(sn), pred = Math.sqrt(G * G * (1 + Math.tan(phi) ** 2) + aLonChk * aLonChk), mag = norm(agLP);
              const ok = Math.abs(mag - pred) <= Math.max(0.9, 0.12 * mag);                     // ivmeölçer büyüklüğü, jiroskop+GPS tahminiyle uyuşuyor mu?
              const al = 1 - Math.exp(-dt / 1.0); this.cons += al * ((ok ? 1 : 0) - this.cons); this.consN++;
              if (this.consN > 40 && this.cons < 0.75) reason = 'inconsistent';
              else if (Math.abs(phi * R2D) > TH.maxLeanDeg) reason = 'out-of-range';
              else if (this.gyroOk == null) reason = 'verifying';                              // işaret/ölçek henüz GPS ile doğrulanmadı
              else lean = this.lpLean.step(phi * R2D, dt);
            }
          }
          if (lean != null) { o.lean = lean; o.q |= 4; } else { why.lean = reason; this.lpLean.reset(); }
          if (gv && gv.src === 'p' && lean != null) o.q |= 32;
          if (noisy) o.q |= 16;
          // 5) eksen/kalibrasyon öğrenme (düz yolda, belirgin ivmelenirken)
          this._learn(t, dt, linLP, Wlp, v, o);
        }
      }
      if (this.lagQ) o.q |= 8;
      // kapsama (hangi neden yüzünden ölçüm yoktu?)
      for (const k of ['aLon', 'aLat', 'lean', 'yaw']) { const c = this.cover[k]; c.tot += dt; if (o[k] != null) c.v += dt; else { const r = why[k] || 'unknown'; c.r[r] = (c.r[r] || 0) + dt; } }
      this.live = { t, lean: o.lean, leanState: o.lean != null ? 'estimated' : 'unavailable', leanReason: why.lean, aLon: o.aLon, aLat: o.aLat, yaw: o.yaw, v, noisy, aLatReason: why.aLat, aLonReason: why.aLon };
      this._bin(t, o);
      if (o.aLon != null) this._imuEvent(t, o.aLon, noisy, linSrc === 'hp');
      else if (this.ev.open) this._imuClose(this.ev.tIn);
      // eşzamanlama için 10 Hz IMU boylamsal ivmesi
      if (o.aLon != null && t - this.corrAt >= 100) { this.corrAt = t; this.corr.push([t, o.aLon]); while (this.corr.length > 1200) this.corr.shift(); if (++this.corrTick % 200 === 0) this._estLag(); }
    }
    _gap(t) {
      for (const f of [this.mAg, this.mLin, this.mRot, this.lpAg, this.lpSlow, this.lpBase, this.lpLin, this.lpW, this.lpVib, this.lpRoll, this.lpLean]) f.reset();
      if (this.ev.open) this._imuClose(this.ev.tIn);
    }

    // ---- Eksen ve işaret öğrenme ----
    _learn(t, dt, linLP, Wlp, v, o) {
      const cal = this.cal; if (!cal.u || v == null) return;
      // (a) jiroskop işareti/ölçeği: W ile GPS yön değişimi hızı uyumlu mu? (yukarı ekseninin işareti de buradan doğrulanır)
      if (Wlp != null && this.gyroOk == null) {
        const yr = this.gps.yawRateAt(t + this.lagMs);
        if (yr != null && Math.abs(yr) > 0.12 && v >= 3) {                                     // yalnızca belirgin dönüşler (GPS yön gürültüsü ≈0,04 rad/sn)
          const g = this.sgn; g.swg += Wlp * yr; g.syy += yr * yr; g.sww += Wlp * Wlp; g.n++;
          if (g.n >= 120 && g.syy >= 1.0) {
            const slope = g.swg / g.syy, rho = g.swg / Math.sqrt(g.sww * g.syy || 1);
            if (rho <= -0.5 && slope < 0 && Math.abs(slope) > 0.6 && Math.abs(slope) < 1.6) {     // yerçekimi işareti ters (bazı cihazlar): yukarı ekseni çevir
              cal.u = scale(cal.u, -1); cal.uFlipped = !cal.uFlipped; cal.f = cal.l = null; cal.fSrc = null; this.basis = planeBasis(cal.u); this.pca = null; this.sgn = { swg: 0, syy: 0, sww: 0, n: 0 }; this.lpW.reset();
            } else if (rho >= 0.5 && slope > 0.6 && slope < 1.6) this.gyroOk = true;
            else if (Math.abs(rho) >= 0.5) this.gyroOk = false;                                    // ölçek uyuşmuyor (ör. rad/sn ↔ °/sn karışıklığı)
            else if (g.n > 600) { g.swg = g.syy = g.sww = 0; g.n = 0; }                           // belirsiz: yeniden dene
          }
        }
      }
      // (b) ileri eksen: düz yolda GPS'in ölçtüğü belirgin ivmelenme/frenleme sırasında yatay ivmenin baskın yönü
      if (!this.basis) this.basis = planeBasis(cal.u);
      const straight = Wlp != null ? Math.abs(Wlp) < 0.06 : true;
      const ag = this.gps.accelAt(t + this.lagMs);
      if (straight && v >= 3 && ag != null && Math.abs(ag) >= 0.5 && this.gyroOk !== false) {
        const p = sub(linLP, scale(cal.u, dot(linLP, cal.u))), x1 = dot(p, this.basis[0]), x2 = dot(p, this.basis[1]);
        const P = this.pca || (this.pca = { c11: 0, c12: 0, c22: 0, s1: 0, s2: 0, sg: 0, n: 0 }), d = 0.999;
        P.c11 = P.c11 * d + x1 * x1; P.c12 = P.c12 * d + x1 * x2; P.c22 = P.c22 * d + x2 * x2; P.s1 = P.s1 * d + x1 * ag; P.s2 = P.s2 * d + x2 * ag; P.sg = P.sg * d + ag * ag; P.n = P.n * d + 1;
      }
      if (++this.pcaTick % 100 === 0 && this.pca && this.pca.n >= 120) this._updateForward();
    }
    _updateForward() {
      const P = this.pca, tr = P.c11 + P.c22, th = 0.5 * Math.atan2(2 * P.c12, P.c11 - P.c22), cs = Math.cos(th), sn = Math.sin(th);
      const l1 = P.c11 * cs * cs + 2 * P.c12 * cs * sn + P.c22 * sn * sn, l2 = Math.max(1e-9, tr - l1), proj = cs * P.s1 + sn * P.s2;
      const rho = proj / Math.sqrt(Math.max(1e-9, l1 * P.sg)), ratio = l1 / l2;
      if (Math.abs(rho) < 0.5 || ratio < 4) return;
      const sg = proj >= 0 ? 1 : -1, b = this.basis, f = scale([cs * b[0][0] + sn * b[1][0], cs * b[0][1] + sn * b[1][1], cs * b[0][2] + sn * b[1][2]], sg), cal = this.cal;
      if (cal.f && cal.fSrc === 'saved' && angleDeg(cal.f, f) > 25) cal.recal = true;          // kayıtlı yön artık tutmuyor: montaj döndürülmüş olabilir
      cal.f = f.map(r3); cal.l = cross(cal.u, f).map(r3); cal.fSrc = 'ride'; cal.fQ = { rho: r2(Math.abs(rho)), ratio: r1(ratio), n: Math.round(P.n) };
    }
    // GPS ile IMU saatleri arasındaki gecikme: boylamsal ivme ile GPS hız türevinin çapraz korelasyonu
    _estLag() {
      if (this.corr.length < 400) return;
      let best = null;
      for (let lag = -1500; lag <= 1500; lag += 100) {
        let n = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
        for (const [t, x] of this.corr) { const y = this.gps.accelAt(t + lag); if (y == null) continue; n++; sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y; }
        if (n < 150) continue;
        const vx = sxx - sx * sx / n, vy = syy - sy * sy / n; if (vx < 1 || vy < 1) continue;
        const c = (sxy - sx * sy / n) / Math.sqrt(vx * vy); if (!best || c > best.c) best = { lag, c, n };
      }
      if (best && best.c >= 0.55) { this.lagMs = Math.round(this.lagQ ? 0.5 * this.lagMs + 0.5 * best.lag : best.lag); this.lagQ = { corr: r2(best.c), n: best.n }; }
    }

    // ---- Ani fren / hızlanma (ivmeölçer) ----
    _imuEvent(t, a, noisy, hp) {
      const E = this.ev, thr = k => (k === 'b' ? TH.brake[0] : TH.accel[0]);
      if (!E.open) {
        if (a <= -TH.brake[0] || a >= TH.accel[0]) { Object.assign(E, { open: true, kind: a < 0 ? 'b' : 'a', t0: t, tIn: t, peak: a, area: 0, tLast: t, noisy: false, hp: false }); }
        else return;
      }
      const dts = (t - E.tLast) / 1000; E.tLast = t; E.area += a * dts; if (noisy) E.noisy = true; if (hp) E.hp = true;
      if (Math.abs(a) > Math.abs(E.peak) && (a < 0) === (E.peak < 0)) E.peak = a;
      const mag = E.kind === 'b' ? -a : a;
      if (mag >= thr(E.kind) * TH.endRatio) E.tIn = t;
      else if (t - E.tIn >= 150) this._imuClose(E.tIn);
    }
    _imuClose(tEnd) {
      const E = this.ev; if (!E.open) return; E.open = false;
      const dur = tEnd - E.t0; if (dur < TH.minDurMs) return;
      const peak = Math.abs(E.peak), sevs = E.kind === 'b' ? TH.brake : TH.accel;
      let sev = 1; for (let i = 1; i < sevs.length; i++) if (peak >= sevs[i]) sev = i + 1;
      const g0 = this.vAt(E.t0), g1 = this.vAt(tEnd), v0 = g0 ? g0.v : null, v1 = g1 ? g1.v : null;
      if (E.kind === 'b' && v0 != null && v0 < TH.minBrakeV) return;                           // duran/çok yavaş araçta fren «ani fren» sayılmaz
      let flags = 0; const dv = E.area;
      if (v0 != null && v1 != null && Math.abs((v1 - v0) - dv) <= Math.max(1.0, 0.5 * Math.abs(dv))) flags |= 1;   // GPS hız değişimi ivmeölçerle uyuşuyor
      if (E.noisy) flags |= 2; if (E.hp) flags |= 8;
      const pos = this.gps.posAt(E.t0 + this.lagMs);
      const ev = [Math.round(E.t0), E.kind, sev, r2(peak), Math.round(dur), v0 == null ? null : r1(v0), v1 == null ? null : r1(v1), r2(dv), 'i', flags, pos ? Math.round(pos[0] * 1e5) / 1e5 : null, pos ? Math.round(pos[1] * 1e5) / 1e5 : null];
      const prev = this.evs[this.evs.length - 1];
      if (prev && prev[8] === 'i' && prev[1] === ev[1] && ev[0] - (prev[0] + prev[4]) < 800) {   // aynı olayın parçaları birleşir
        prev[3] = Math.max(prev[3], ev[3]); prev[4] = ev[0] + ev[4] - prev[0]; prev[7] = r2(prev[7] + ev[7]); prev[6] = ev[6]; prev[9] |= ev[9] & ~1; prev[2] = Math.max(prev[2], ev[2]);
      } else if (this.evs.length < TH.maxEvs) this.evs.push(ev);
      this._dedupe();
    }
    // ---- Ani fren / hızlanma (GPS hız türevi; IMU yoksa/kalibre değilse tek kaynak) ----
    _gpsEvent() {
      const A = this.gps.ac, a = A[A.length - 1]; if (!a || a.t === this.lastAcT) return; this.lastAcT = a.t;      // her ivme aralığı bir kez işlenir
      const G2 = this.gev, thr = k => (k === 'b' ? TH.gpsBrake : TH.gpsAccel);
      const kind = a.a <= -TH.gpsBrake ? 'b' : a.a >= TH.gpsAccel ? 'a' : null;
      if (G2.open && (a.t1 - G2.tLast > 1500)) this._gpsClose();
      if (!G2.open) { if (!kind) return; Object.assign(G2, { open: true, kind, t0: a.t1, v0: a.v1, v1: a.v2, peak: a.a, tLast: a.t2 }); return; }
      const mag = G2.kind === 'b' ? -a.a : a.a;
      if (mag >= thr(G2.kind) * TH.endRatio && (a.a < 0) === (G2.kind === 'b')) { G2.v1 = a.v2; G2.tLast = a.t2; if (Math.abs(a.a) > Math.abs(G2.peak)) G2.peak = a.a; }
      else { this._gpsClose(); if (kind) Object.assign(G2, { open: true, kind, t0: a.t1, v0: a.v1, v1: a.v2, peak: a.a, tLast: a.t2 }); }
    }
    _gpsClose() {
      const E = this.gev; if (!E.open) return; E.open = false;
      const dur = E.tLast - E.t0, dv = E.v1 - E.v0;
      if (dur < TH.gpsMinDurMs || Math.abs(dv) < TH.gpsMinDv) return;
      if (E.kind === 'b' && E.v0 < TH.minBrakeV) return;
      const peak = Math.abs(E.peak), sevs = E.kind === 'b' ? TH.brake : TH.accel; let sev = 1; for (let i = 1; i < sevs.length; i++) if (peak >= sevs[i]) sev = i + 1;
      const pos = this.gps.posAt(E.t0);
      if (this.evs.length < TH.maxEvs) this.evs.push([Math.round(E.t0), E.kind, sev, r2(peak), Math.round(dur), r1(E.v0), r1(E.v1), r2(dv), 'g', 0, pos ? Math.round(pos[0] * 1e5) / 1e5 : null, pos ? Math.round(pos[1] * 1e5) / 1e5 : null]);
      this._dedupe();
    }
    _dedupe() {                                                    // aynı olayı hem IMU hem GPS görüyorsa IMU kaydı kalır
      const imu = this.evs.filter(e => e[8] === 'i');
      this.evs = this.evs.filter(e => e[8] !== 'g' || !imu.some(i => i[1] === e[1] && i[0] < e[0] + e[4] + 2500 && e[0] < i[0] + i[4] + 2500));
      this.evs.sort((x, y) => x[0] - y[0]);
    }

    // ---- 1 sn'lik özet satırları ----
    _bin(t, o) {
      const sec = Math.floor(t / 1000);
      if (this.b && this.b.sec !== sec) this._flushBin();
      const B = this.b || (this.b = { sec, lon: [0, 0, null], lat: [0, 0, null], lean: [0, 0, null], yaw: [0, 0, null], roll: [0, 0, null], q: 0 });
      const add = (a, x) => { if (x == null) return; a[0] += x; a[1]++; if (a[2] == null || Math.abs(x) > Math.abs(a[2])) a[2] = x; };
      add(B.lon, o.aLon); add(B.lat, o.aLat); add(B.lean, o.lean); add(B.yaw, o.yaw); add(B.roll, o.roll); B.q |= o.q;
    }
    _flushBin() {
      const B = this.b; this.b = null; if (!B) return;
      const m = a => (a[1] ? a[0] / a[1] : null);
      if (!B.lon[1] && !B.lat[1] && !B.lean[1] && !B.yaw[1]) return;
      if (this.bins.length >= TH.maxBins) return;
      const f2 = x => (x == null ? null : r2(x)), f1 = x => (x == null ? null : r1(x));
      this.bins.push([B.sec * 1000 + 500, f2(m(B.lon)), f2(B.lon[2]), f2(m(B.lat)), f2(B.lat[2]), f1(m(B.lean)), f1(B.lean[2]), f1(m(B.yaw)), f1(B.roll[2]), B.q]);
    }
    drain() { const out = { bins: this.bins.slice(this.pendB), evs: this.evs.slice() }; this.pendB = this.bins.length; return out; }

    // ---- Bitiş ----
    finish() {
      this._flushBin(); if (this.ev.open) this._imuClose(this.ev.tIn); this._gpsClose(); this._dedupe();
      const cov = {}, st = {};
      const top = r => { let b = null; for (const k in r) if (!b || r[k] > r[b]) b = k; return b; };
      for (const k of ['aLon', 'aLat', 'lean', 'yaw']) { const c = this.cover[k]; cov[k] = { valid: r1(c.v), total: r1(c.tot), reasons: Object.fromEntries(Object.entries(c.r).map(([a, b]) => [a, r1(b)])) }; }
      const hpOnly = !this.sawLin, noGyro = !this.sawRot && this.nImu >= 60, hasImu = this.nImu >= 60;
      const state = (k, kind) => (!hasImu ? { s: 'unsupported', r: 'no-sensor' } : this.cover[k].v >= 5 ? { s: kind } : { s: 'unavailable', r: top(this.cover[k].r) || 'unknown' });
      st.aLon = state('aLon', hpOnly ? 'estimated' : 'measured');
      st.aLat = hasImu && hpOnly ? { s: 'unsupported', r: 'no-lin' } : state('aLat', 'measured');
      st.lean = noGyro ? { s: 'unsupported', r: 'no-gyro' } : state('lean', 'estimated');
      st.yaw = noGyro ? { s: 'unsupported', r: 'no-gyro' } : state('yaw', 'measured');
      const imuEv = this.evs.some(e => e[8] === 'i'), gpsEv = this.evs.some(e => e[8] === 'g');
      st.events = { imu: this.cover.aLon.v >= 5, gps: this.gps.f.length >= 2, count: this.evs.length, imuN: this.evs.filter(e => e[8] === 'i').length, gpsN: this.evs.filter(e => e[8] === 'g').length, any: imuEv || gpsEv };
      const c = this.cal;
      return {
        meta: { caps: { gyro: this.sawRot, lin: this.sawLin, rateHz: this.rateHz(), n: this.nImu },
          cal: { u: c.u, uAt: c.uAt, uQ: c.uQ, uFlipped: c.uFlipped, f: c.f, fSrc: c.fSrc, fQ: c.fQ, recal: c.recal, gyroOk: this.gyroOk, mountMoved: this.mountMoved },
          sync: { lagMs: this.lagQ ? this.lagMs : null, corr: this.lagQ ? this.lagQ.corr : null },
          th: { brake: TH.brake, accel: TH.accel, minDurMs: TH.minDurMs, minLeanV: TH.minLeanV, gpsBrake: TH.gpsBrake, gpsAccel: TH.gpsAccel },
          cover: cov, status: st, noisyS: r1(this.noisyS) },
        bins: this.bins, evs: this.evs
      };
    }
  }

  // ---------- Doğrulama (sunucu istemciye güvenmez) ve özet ----------
  const finite = (x, lo, hi) => typeof x === 'number' && isFinite(x) && x >= lo && x <= hi;
  const optNum = (x, lo, hi) => x == null || finite(x, lo, hi);
  const ENUM_STATE = ['measured', 'estimated', 'unavailable', 'unsupported'];
  const vec3 = a => (Array.isArray(a) && a.length === 3 && a.every(x => finite(x, -1.001, 1.001)) ? a.map(r3) : null);
  function cleanMeta(m) {
    m = m && typeof m === 'object' ? m : {};
    const c = m.cal || {}, caps = m.caps || {}, sy = m.sync || {}, st = m.status || {}, out = { caps: {}, cal: {}, sync: {}, cover: {}, status: {} };
    out.caps = { gyro: !!caps.gyro, lin: !!caps.lin, rateHz: optNum(caps.rateHz, 0, 1000) ? caps.rateHz : null, n: finite(caps.n, 0, 1e9) ? Math.round(caps.n) : 0 };
    out.cal = { u: vec3(c.u), uAt: finite(c.uAt, 0, 4e12) ? c.uAt : null, uFlipped: !!c.uFlipped, f: vec3(c.f), fSrc: ['ride', 'saved'].includes(c.fSrc) ? c.fSrc : null, recal: !!c.recal,
      gyroOk: c.gyroOk === true ? true : c.gyroOk === false ? false : null, mountMoved: !!c.mountMoved,
      uQ: c.uQ && typeof c.uQ === 'object' ? { drift: optNum(c.uQ.drift, 0, 180) ? c.uQ.drift : null, spread: optNum(c.uQ.spread, 0, 180) ? c.uQ.spread : null, n: finite(c.uQ.n, 0, 1e6) ? c.uQ.n : null } : null,
      fQ: c.fQ && typeof c.fQ === 'object' ? { rho: optNum(c.fQ.rho, 0, 1) ? c.fQ.rho : null, ratio: optNum(c.fQ.ratio, 0, 1e6) ? c.fQ.ratio : null, n: finite(c.fQ.n, 0, 1e6) ? c.fQ.n : null } : null };
    out.sync = { lagMs: optNum(sy.lagMs, -5000, 5000) ? sy.lagMs : null, corr: optNum(sy.corr, -1, 1) ? sy.corr : null };
    for (const k of ['aLon', 'aLat', 'lean', 'yaw']) {
      const cv = m.cover && m.cover[k] || {};
      out.cover[k] = { valid: finite(cv.valid, 0, 1e6) ? cv.valid : 0, total: finite(cv.total, 0, 1e6) ? cv.total : 0, reasons: {} };
      if (cv.reasons && typeof cv.reasons === 'object') for (const r of Object.keys(cv.reasons).slice(0, 20)) if (/^[a-z-]{1,20}$/.test(r) && finite(cv.reasons[r], 0, 1e6)) out.cover[k].reasons[r] = cv.reasons[r];
      const s = st[k] || {}; out.status[k] = { s: ENUM_STATE.includes(s.s) ? s.s : 'unavailable', r: s.r && /^[a-z-]{1,20}$/.test(s.r) ? s.r : null };
    }
    out.noisyS = finite(m.noisyS, 0, 1e6) ? m.noisyS : 0;
    out.th = { brake: TH.brake, accel: TH.accel, minDurMs: TH.minDurMs, minLeanV: TH.minLeanV };     // sunucu kendi eşiklerini yazar; istemcinin bildirdiği değer güvenilmez
    out.thClient = m.th && typeof m.th === 'object' ? { brake: Array.isArray(m.th.brake) ? m.th.brake.slice(0, 3).map(Number).filter(isFinite) : null, accel: Array.isArray(m.th.accel) ? m.th.accel.slice(0, 2).map(Number).filter(isFinite) : null } : null;
    return out;
  }
  // d: {v:1, rideId, meta, bins, evs}; ride: {id, startedAt, endedAt}. → { err } | { tele }
  function cleanTele(d, ride) {
    if (!d || typeof d !== 'object' || d.v !== 1) return { err: 'Telemetri biçimi desteklenmiyor.' };
    if (d.rideId !== ride.id) return { err: 'Telemetri, sürüş kimliğiyle eşleşmiyor.' };
    if (!Array.isArray(d.bins) || !Array.isArray(d.evs)) return { err: 'Telemetri satırları eksik.' };
    if (d.bins.length > TH.maxBins) return { err: 'Telemetri çok uzun.' };
    if (d.evs.length > TH.maxEvs) return { err: 'Telemetri olay sayısı çok fazla.' };
    const lo = ride.startedAt - 60000, hi = (ride.endedAt || Date.now()) + 60000, bins = [], evs = [];
    let last = 0;
    for (const r of d.bins) {
      if (!Array.isArray(r) || r.length !== 10 || !finite(r[0], lo, hi) || r[0] <= last) return { err: 'Telemetri satırı geçersiz (zaman).' };
      const lim = [[-30, 30], [-30, 30], [-30, 30], [-30, 30], [-90, 90], [-90, 90], [-1500, 1500], [-3000, 3000]];
      for (let i = 0; i < 8; i++) if (!optNum(r[i + 1], lim[i][0], lim[i][1])) return { err: 'Telemetri satırı geçersiz (değer).' };
      if (!finite(r[9], 0, 255)) return { err: 'Telemetri satırı geçersiz (bayrak).' };
      last = r[0]; bins.push([Math.round(r[0]), ...r.slice(1, 9), Math.round(r[9])]);
    }
    for (const e of d.evs) {
      if (!Array.isArray(e) || e.length !== 12 || !finite(e[0], lo, hi) || !['b', 'a'].includes(e[1]) || !finite(e[2], 1, 3) || !finite(e[3], 0, 30) || !finite(e[4], 0, 60000) ||
        !optNum(e[5], 0, 100) || !optNum(e[6], 0, 100) || !finite(e[7], -100, 100) || !['i', 'g'].includes(e[8]) || !finite(e[9], 0, 255) || !optNum(e[10], -90, 90) || !optNum(e[11], -180, 180)) return { err: 'Telemetri olayı geçersiz.' };
      evs.push(e.slice());
    }
    return { tele: { v: 1, rideId: d.rideId, meta: cleanMeta(d.meta), bins, evs } };
  }
  // Sunucu özeti: ham satırlardan yeniden hesaplanır (meta'daki iddialar yalnızca ipucudur)
  function summarizeTele(t) {
    const B = t.bins, E = t.evs, m = t.meta || {}, sum = { v: 1, bins: B.length, events: { brake: { n: 0, imu: 0, gps: 0, sev: [0, 0, 0], maxPeak: null }, accel: { n: 0, imu: 0, gps: 0, sev: [0, 0, 0], maxPeak: null } } };
    for (const e of E) {
      const o = sum.events[e[1] === 'b' ? 'brake' : 'accel']; o.n++; o[e[8] === 'i' ? 'imu' : 'gps']++; o.sev[e[2] - 1]++; o.maxPeak = o.maxPeak == null ? e[3] : Math.max(o.maxPeak, e[3]);
    }
    const has = (i, bit) => B.filter(r => r[i] != null && (bit == null || (r[9] & bit))).length;
    const lonN = B.filter(r => r[1] != null).length, latN = B.filter(r => r[3] != null).length, leanRows = B.filter(r => r[5] != null && (r[9] & 4));
    const ext = (i, f) => { let b = null; for (const r of B) if (r[i] != null && (b == null || f(r[i], b))) b = r[i]; return b; };
    const st = m.status || {};
    sum.aLon = { state: lonN ? (B.some(r => r[9] & 1) ? 'measured' : 'estimated') : (st.aLon && st.aLon.s === 'unsupported' ? 'unsupported' : 'unavailable'), secs: lonN, min: ext(2, (a, b) => a < b), max: ext(2, (a, b) => a > b) };
    sum.aLat = { state: latN ? 'measured' : (st.aLat && st.aLat.s === 'unsupported' ? 'unsupported' : 'unavailable'), secs: latN, absMax: latN ? Math.max(...B.filter(r => r[4] != null).map(r => Math.abs(r[4]))) : null };
    sum.lean = { state: leanRows.length ? 'estimated' : (st.lean && st.lean.s === 'unsupported' ? 'unsupported' : 'unavailable'), secs: leanRows.length,
      leftMax: leanRows.length ? Math.max(0, ...leanRows.map(r => r[6]).filter(x => x > 0)) : null, rightMax: leanRows.length ? Math.max(0, ...leanRows.map(r => -r[6]).filter(x => x > 0)) : null,
      over15: leanRows.filter(r => Math.abs(r[6]) >= 15).length, over30: leanRows.filter(r => Math.abs(r[6]) >= 30).length, over45: leanRows.filter(r => Math.abs(r[6]) >= 45).length };
    if (sum.lean.leftMax === 0) sum.lean.leftMax = null; if (sum.lean.rightMax === 0) sum.lean.rightMax = null;
    sum.yaw = { state: has(7) ? 'measured' : (st.yaw && st.yaw.s === 'unsupported' ? 'unsupported' : 'unavailable'), secs: has(7) };
    sum.reasons = { aLon: st.aLon && st.aLon.r || null, aLat: st.aLat && st.aLat.r || null, lean: st.lean && st.lean.r || null };
    sum.sync = m.sync ? { lagMs: m.sync.lagMs, corr: m.sync.corr } : null;
    sum.cal = m.cal ? { calibrated: !!m.cal.u, fSrc: m.cal.fSrc || null, mountMoved: !!m.cal.mountMoved, gyroVerified: m.cal.gyroOk === true } : null;
    sum.caps = m.caps ? { gyro: !!m.caps.gyro, lin: !!m.caps.lin, rateHz: m.caps.rateHz } : null;
    return sum;
  }

  const api = { TH, REASONS, REASON_TR, G, Processor, GpsTrack, staticCalibrate, cleanTele, summarizeTele, hav, angleDeg, unit };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.TelemetryCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
