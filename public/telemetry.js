/* Telemetri (tarayıcı bağdaştırıcısı + arayüz). window.Telemetry. map.js yükler ve mount(ctx) ile bağlar.
   Yalnızca GERÇEK sensör olaylarını (devicemotion) ve GPS'i işler; sensör yoksa/izin yoksa/güvenilmezse «veri yok» der, sahte değer üretmez.
   Hesaplama public/telemetry-core.js'te. Her değer ölçülen / tahmini / veri yok / desteklenmiyor olarak etiketlenir.
   Kayıt: sürüşle aynı kimlikle, cihazda IndexedDB 'tele' deposuna; sürüş sunucuya gidince eş kayıt olarak gönderilir (ride-store.js). */
(function () {
  'use strict';
  const D2R = Math.PI / 180, G = 9.80665, CAL_TTL = 12 * 3600 * 1000;
  const REASON = window.TelemetryCore.REASON_TR;      // neden kodları → Türkçe (telemetry-core.js)
  const STATE = { measured: ['Ölçülen', 'm'], estimated: ['Tahmini', 'e'], unavailable: ['Veri yok', 'u'], unsupported: ['Desteklenmiyor', 'x'] };
  const PERM = { unknown: 'Henüz denenmedi', granted: 'İzin verildi', denied: 'İzin verilmedi (tarayıcı/sistem ayarlarından «Hareket ve yönelim» iznini aç)', insecure: 'HTTPS gerekli (güvenli bağlantı değil)',
    unsupported: 'Bu tarayıcı hareket sensörü vermiyor', nodata: 'Sensör verisi gelmiyor (masaüstü cihaz ya da sensör engelli)' };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const fmt1 = v => String(Math.round(v * 10) / 10).replace('.', ','), fmt2 = v => String(Math.round(v * 100) / 100).replace('.', ',');
  const pad13 = t => String(t).padStart(13, '0');

  function mount(ctx) {
    const { $, esc, toast, store, TC } = ctx, RS = () => window.RideStore;
    const sheet = $('mm-tsheet'), hud = $('mm-tel'), origin = performance.timeOrigin || (Date.now() - performance.now());
    const T = { enabled: store.get('mm_tele', '1') === '1', perm: 'unknown', listening: false, evSeen: 0, linNZ: false, rotNZ: false, rate: null, rc: [0, 0],
      proc: null, rideId: null, recording: false, capture: null, cal: loadCal(), calUi: null, prevEvs: [], drainT: 0, hudT: 0, last: null, open: false, test: null, note: '' };
    function loadCal() { try { const c = JSON.parse(localStorage.getItem('mm_tcal') || 'null'); return c && Array.isArray(c.u) ? c : null; } catch { return null; } }
    function saveCal(c) { T.cal = c; try { if (c) localStorage.setItem('mm_tcal', JSON.stringify(c)); else localStorage.removeItem('mm_tcal'); } catch {} }
    const calValid = () => !!(T.cal && T.cal.u && Date.now() - (T.cal.uAt || 0) < CAL_TTL);
    const persistFail = () => { if (T.pf) return; T.pf = true; toast('Sensör verisi cihaza yazılamadı; sayfayı kapatırsan kaybolabilir.', 7000); };

    /* ---------- Sensör erişimi, izin, uyumluluk ---------- */
    function toEpoch(ts) { let t = ts > 1e12 ? ts : origin + ts; if (!isFinite(t) || Math.abs(t - Date.now()) > 5000) t = Date.now(); return Math.round(t); }
    async function ensurePermission() {         // iOS'ta bu çağrı bir dokunma olayının içinden başlatılmalıdır (başlat/kalibre et/dene düğmeleri)
      if (!('DeviceMotionEvent' in window)) { T.perm = 'unsupported'; return false; }
      if (window.isSecureContext === false) { T.perm = 'insecure'; return false; }
      const DME = window.DeviceMotionEvent;
      if (typeof DME.requestPermission === 'function') {
        try { const r = await DME.requestPermission(); T.perm = r === 'granted' ? 'granted' : 'denied'; } catch { T.perm = 'denied'; }
        return T.perm === 'granted';
      }
      T.perm = 'granted'; return true;           // izin penceresi yok (Android/Chrome): veri gelip gelmediği ilk olayla anlaşılır
    }
    function onMotion(e) {
      const ag = e.accelerationIncludingGravity;
      if (!ag || ag.x == null || ag.y == null || ag.z == null) return;
      T.evSeen++; T.rc[0]++;
      const a = e.acceleration, r = e.rotationRate;
      let lin = a && a.x != null && a.y != null && a.z != null ? [a.x, a.y, a.z] : null;
      if (lin) { if (lin[0] !== 0 || lin[1] !== 0 || lin[2] !== 0) T.linNZ = true; else if (!T.linNZ && T.evSeen > 40) lin = null; }       // hep sıfır = doğrusal ivme sensörü yok
      let rot = r && r.alpha != null && r.beta != null && r.gamma != null ? [r.beta * D2R, r.gamma * D2R, r.alpha * D2R] : null;           // beta=x, gamma=y, alpha=z (°/sn → rad/sn)
      if (rot) { if (rot[0] !== 0 || rot[1] !== 0 || rot[2] !== 0) T.rotNZ = true; else if (!T.rotNZ && T.evSeen > 40) rot = null; }
      const s = { t: toEpoch(e.timeStamp), ag: [ag.x, ag.y, ag.z], lin, rot };
      if (T.capture) T.capture.push(s);
      else if (T.recording && T.proc) T.proc.feedImu(s);
    }
    function listen() { if (T.listening) return; T.evSeen = 0; T.linNZ = T.rotNZ = false; window.addEventListener('devicemotion', onMotion); T.listening = true; T.rateT = setInterval(() => { T.rate = T.rc[0]; T.rc[0] = 0; }, 1000); }
    function unlisten() { if (!T.listening) return; if (T.rate) T.rateLast = T.rate; window.removeEventListener('devicemotion', onMotion); T.listening = false; clearInterval(T.rateT); }
    async function waitEvents(n, ms) { const t0 = Date.now(); while (T.evSeen < n && Date.now() - t0 < ms) await sleep(50); return T.evSeen >= n; }
    const caps = () => ({ api: 'DeviceMotionEvent' in window, secure: window.isSecureContext !== false, gyro: T.evSeen > 40 ? T.rotNZ : null, lin: T.evSeen > 40 ? T.linNZ : null, rate: T.rate });

    /* ---------- Sürüşe bağlama ---------- */
    async function begin(rideId, startedAt, resume) {
      if (!T.enabled || T.recording) return !!T.recording;
      T.rideId = rideId; T.note = '';
      if (!(await ensurePermission())) { T.note = PERM[T.perm] || ''; paint(); return false; }
      listen();
      if (!(await waitEvents(30, 2500))) { T.perm = 'nodata'; unlisten(); T.note = PERM.nodata; paint(); return false; }
      const proc = new TC.Processor();
      if (calValid()) proc.setCalibration(T.cal);
      T.proc = proc; T.prevEvs = [];
      if (resume) { try { const st = await RS().loadTele(rideId); T.prevEvs = st.evs || []; } catch {} }
      if (ctx.me()) feedFix(ctx.me());
      T.recording = true; T.drainT = setInterval(() => drain().catch(persistFail), 2000); T.hudT = setInterval(paintHud, 500);
      paint(); return true;
    }
    function feedFix(f) { if (T.proc) T.proc.feedFix({ t: f.t, lat: f.lat, lon: f.lon, acc: f.acc, speed: f.speed, hdg: f.heading }); }
    function onFix(f) { if (T.recording) feedFix(f); }
    async function drain() {
      if (!T.proc || !T.rideId) return;
      const d = T.proc.drain(), rows = d.bins.map(b => ['b' + pad13(b[0]), b]);
      rows.push(['e', mergeEvs(T.prevEvs, d.evs)]);
      await RS().addTele(T.rideId, rows);
    }
    function mergeEvs(prev, cur) { return prev.concat(cur).sort((a, b) => a[0] - b[0]).slice(0, 2000); }
    function pause() { if (!T.recording) return; T.recording = false; clearInterval(T.drainT); clearInterval(T.hudT); unlisten(); drain().catch(persistFail); paint(); }
    async function resume(rideId, startedAt) {
      if (!T.enabled || T.recording) return;
      if (T.proc && T.rideId === rideId) {                                   // aynı sayfada duraklat → devam
        if (!(await ensurePermission())) return paint(); listen(); await waitEvents(10, 1500);
        T.recording = true; T.drainT = setInterval(() => drain().catch(persistFail), 2000); T.hudT = setInterval(paintHud, 500); paint();
      } else await begin(rideId, startedAt, true);                            // sayfa yenilendi: kayıtlı satırların üzerine devam
    }
    // Sürüş bitti: işlemciyi bitir, satırları ve bitiş durumunu cihaza yaz → {summary, tele} (sensör yoksa null)
    async function end(rideId, endedAt) {
      const wasMine = T.proc && T.rideId === rideId;
      T.recording = false; clearInterval(T.drainT); clearInterval(T.hudT); unlisten();
      let meta, evs;
      if (wasMine) {
        const fin = T.proc.finish(); await drain().catch(persistFail);
        meta = fin.meta; evs = mergeEvs(T.prevEvs, fin.evs);
        learn(T.proc);
        T.proc = null;
      } else {
        const st = await RS().loadTele(rideId).catch(() => null);
        if (!st || (!st.bins.length && !st.evs.length)) { paint(); return null; }
        evs = st.evs; meta = { recovered: true, caps: { gyro: false, lin: false, rateHz: null, n: 0 }, cal: { u: calValid() ? T.cal.u : null, uAt: T.cal && T.cal.uAt || null }, status: {} };
      }
      const rows = [['e', evs]];
      const st = await RS().loadTele(rideId).catch(() => ({ bins: [] }));
      const tele = { v: 1, rideId, meta, bins: st.bins, evs };
      if (!tele.bins.length && !tele.evs.length && (!meta.caps || meta.caps.n < 60)) { T.rideId = null; paint(); return { summary: TC.summarizeTele(tele), tele, none: true }; }   // sensör verisi hiç gelmedi
      rows.push(['m', { final: true, sync: 'pending', endedAt, meta }]);
      await RS().addTele(rideId, rows).catch(persistFail);
      T.rideId = null; T.last = { summary: TC.summarizeTele(tele), meta };
      paint(); return { summary: T.last.summary, tele };
    }
    function discard() { T.recording = false; clearInterval(T.drainT); clearInterval(T.hudT); unlisten(); T.proc = null; T.rideId = null; paint(); }
    // Bitmiş ama telemetrisi sonlandırılmamış sürüşler (ör. kurtarma sırasında modül yüklenmeden «Bitir» denmişse): bitiş durumunu yaz ki gönderilebilsin
    async function sweep(owner) {
      try { for (const m of await RS().endedIds(owner, 15)) { if (T.rideId === m.id) continue; if (await RS().teleState(m.id)) continue; const st = await RS().loadTele(m.id); if (st.bins.length || st.evs.length) await end(m.id, m.endedAt); } } catch {}
    }
    // Bu sürüşte öğrenilenleri sonraki sürüş için sakla (montaj değişmediyse): ileri eksen, işaret/ölçek doğrulaması
    function learn(p) {
      if (p.mountMoved) { saveCal(null); return; }
      const c = p.exportCalibration();
      if (c.u) saveCal({ u: c.u, uAt: c.uAt || Date.now(), uQ: c.uQ, uFlipped: c.uFlipped, f: c.f, fSrc: c.fSrc, gyroOk: c.gyroOk });
      try { if (c.gyroOk === true) { localStorage.setItem('mm_tgyro', '1'); localStorage.setItem('mm_tinv', c.uFlipped ? '1' : '0'); } else if (c.gyroOk === false) localStorage.setItem('mm_tgyro', '0'); } catch {}
    }

    /* ---------- Kalibrasyon: motosiklet dik ve hareketsizken yerçekimi yönü ---------- */
    async function calibrate() {
      if (T.calUi && T.calUi.phase === 'capture') return;
      if (T.recording) return toast('Sürüş sırasında kalibre edilemez. Önce sürüşü bitir ya da duraklat.', 5000);
      T.calUi = { phase: 'wait' }; renderSheet();
      if (!(await ensurePermission())) { T.calUi = { phase: 'fail', msg: PERM[T.perm] }; return renderSheet(); }
      listen();
      if (!(await waitEvents(30, 2500))) { T.perm = 'nodata'; unlisten(); T.calUi = { phase: 'fail', msg: PERM.nodata }; return renderSheet(); }
      T.capture = []; T.calUi = { phase: 'capture', t0: Date.now(), dur: 4000 };
      const tick = setInterval(renderSheet, 250); await sleep(T.calUi.dur); clearInterval(tick);
      const samples = T.capture; T.capture = null; if (!T.recording) unlisten();
      const r = TC.staticCalibrate(samples);
      if (!r.ok) {
        const why = { moving: 'Hareket algılandı: motosikleti dik ve sabit tut, telefonu sıkıca tuttur.', 'gravity-magnitude': 'İvmeölçer yerçekimini okumuyor gibi görünüyor.', few: 'Yeterli sensör verisi gelmedi.' }[r.reason] || 'Kalibrasyon başarısız.';
        T.calUi = { phase: 'fail', msg: why }; return renderSheet();
      }
      let u = r.u, flipped = false;
      try { if (localStorage.getItem('mm_tinv') === '1') { u = u.map(x => -x); flipped = true; } } catch {}      // bu cihazda ivmeölçer işareti ters olduğu daha önce doğrulandıysa
      const gyroKnown = (() => { try { return localStorage.getItem('mm_tgyro') === '1'; } catch { return false; } })();
      saveCal({ u, uAt: Date.now(), uQ: { drift: r.drift, spread: r.spread, n: r.n }, uFlipped: flipped, f: null, fSrc: null, gyroOk: gyroKnown ? true : null });
      T.calUi = { phase: 'done', r }; renderSheet();
    }
    async function probe() {
      T.test = { phase: 'run' }; renderSheet();
      if (!(await ensurePermission())) { T.test = { phase: 'done' }; return renderSheet(); }
      const was = T.listening; listen();
      if (!(await waitEvents(30, 2500))) { T.perm = 'nodata'; if (!was && !T.recording) unlisten(); T.test = { phase: 'done' }; return renderSheet(); }
      await sleep(1200); T.test = { phase: 'done' }; if (!was && !T.recording) unlisten(); renderSheet();
    }

    /* ---------- Arayüz ---------- */
    const badge = (s, r) => { const b = STATE[s] || STATE.unavailable; return `<span class="tb ${b[1]}">${b[0]}</span>${r ? ' <small>' + esc(REASON[r] || r) + '</small>' : ''}`; };
    function liveRows() {
      const L = T.proc && T.recording ? T.proc.live : null, p = T.proc;
      if (!L) {
        const s = T.last && T.last.summary;
        if (s) return [['Boylamsal İvme', badge(s.aLon.state, s.reasons.aLon)], ['Yanal İvme', badge(s.aLat.state, s.reasons.aLat)], ['Yatış Açısı', badge(s.lean.state, s.reasons.lean)],
          ['Ani fren / hızlanma', s.events.brake.n + s.events.accel.n ? '<span class="tb m">Ölçülen</span> <small>' + (s.events.brake.imu + s.events.accel.imu ? 'ivmeölçer' : 'GPS Hız Farkı') + '</small>' : '<span class="tb u">Olay yok</span>'], ['Dönüş Hızı', badge(s.yaw.state)]];
        return null;
      }
      const sup = T.proc.sawRot || T.proc.nImu < 60;
      return [['Boylamsal İvme', L.aLon != null ? badge(T.proc.sawLin ? 'measured' : 'estimated') : badge('unavailable', L.aLonReason)],
        ['Yanal İvme', L.aLat != null ? badge('measured') : badge(!T.proc.sawLin && T.proc.nImu >= 60 ? 'unsupported' : 'unavailable', L.aLatReason)],
        ['Yatış Açısı', L.lean != null ? badge('estimated') : badge(!sup ? 'unsupported' : 'unavailable', L.leanReason)],
        ['Ani fren / hızlanma', L.aLon != null ? '<span class="tb m">Ölçülen</span> <small>ivmeölçer</small>' : '<span class="tb m">Ölçülen</span> <small>GPS Hız Farkı (kalibrasyon yok)</small>'],
        ['Dönüş Hızı', L.yaw != null ? badge('measured') : badge(!sup ? 'unsupported' : 'unavailable', p && p.gyroOk === false ? 'gyro-scale' : p && p.gyroOk == null ? 'verifying' : null)]];
    }
    function renderSheet() {
      if (!T.open) return;
      const c = caps(), keep = sheet.scrollTop, ago = T.cal && T.cal.uAt ? Math.round((Date.now() - T.cal.uAt) / 60000) : null;
      const calTxt = !T.cal ? '<span class="tb u">Yapılmadı</span>' : calValid() ? `<span class="tb m">Yapıldı</span> <small>${ago < 1 ? 'az önce' : ago < 120 ? ago + ' dk önce' : Math.round(ago / 60) + ' sa önce'}${T.cal.uFlipped ? ' · ters işaretli ivmeölçer' : ''}</small>` : '<span class="tb u">Eski (12 sa+)</span> <small>yeniden kalibre et</small>';
      const fTxt = T.proc && T.proc.cal.f ? `<span class="tb m">Bulundu</span> <small>${T.proc.cal.fSrc === 'saved' ? 'kayıtlı (doğrulanıyor)' : 'sürüşte bulundu · güven %' + Math.round((T.proc.cal.fQ ? T.proc.cal.fQ.rho : 0) * 100)}</small>` : T.cal && T.cal.f ? '<span class="tb e">Kayıtlı</span> <small>sürüşte doğrulanacak</small>' : '<span class="tb u">Bekliyor</span> <small>düz yolda hızlanıp frenleyince otomatik bulunur</small>';
      const cu = T.calUi; let calBlock = '';
      if (cu && cu.phase === 'wait') calBlock = '<p class="mm-note">İzin ve sensör kontrol ediliyor…</p>';
      else if (cu && cu.phase === 'capture') calBlock = `<p class="mm-note"><b>Kıpırdama.</b> Yerçekimi yönü ölçülüyor… ${Math.max(0, Math.ceil((cu.dur - (Date.now() - cu.t0)) / 1000))} sn</p><div class="mm-bar"><i style="width:${Math.min(100, (Date.now() - cu.t0) / cu.dur * 100)}%"></i></div>`;
      else if (cu && cu.phase === 'fail') calBlock = `<p class="mm-note warn">${esc(cu.msg)}</p>`;
      else if (cu && cu.phase === 'done') calBlock = `<p class="mm-note">Kaydedildi (sapma ${fmt1(cu.r.drift)}°, titreşim ${fmt1(cu.r.spread)}°). Yatış açısının «sıfır» noktası bu kalibrasyondur; yan ayakta kalibre edersen ≈5–10° sapma olur, mümkünse dik ve düz zeminde yap.</p>`;
      const rows = liveRows();
      sheet.innerHTML = `<div class="mm-gh"><b>Sensörler</b><button type="button" class="mm-gx" data-t="close" aria-label="Kapat">✕</button></div>
        <div class="mm-gsec"><label class="mm-mrow"><span>Sürüş Kaydına Sensör Verisi Ekle</span><input type="checkbox" id="mm-ten" ${T.enabled ? 'checked' : ''}></label>
          <p class="mm-note">Açıkken sürüşü başlattığında telefonun ivmeölçer ve jiroskobu da kaydedilir (iPhone'da izin penceresi çıkar). Kapalıyken yalnızca GPS kaydı tutulur.</p></div>
        <div class="mm-gsec"><b>Cihaz</b>
          <div class="mm-trow"><span>Hareket Sensörü</span><span>${esc(PERM[T.perm] || '')}</span></div>
          <div class="mm-trow"><span>Jiroskop</span><span>${c.gyro == null ? 'denenmedi' : c.gyro ? 'var' : 'yok / veri vermiyor'}</span></div>
          <div class="mm-trow"><span>Doğrusal İvme (işletim sistemi)</span><span>${c.lin == null ? 'denenmedi' : c.lin ? 'var' : 'yok (yalnızca tahmini boylamsal ivme)'}</span></div>
          <div class="mm-trow"><span>Örnekleme</span><span>${(T.listening ? T.rate : T.rateLast) ? '≈' + (T.listening ? T.rate : T.rateLast) + ' Hz' : '—'}</span></div>
          <button type="button" class="mm-mb mm-gwide" data-t="probe" ${T.test && T.test.phase === 'run' ? 'disabled' : ''}>${T.test && T.test.phase === 'run' ? 'Deneniyor…' : 'Sensörleri dene'}</button></div>
        <div class="mm-gsec"><b>Kalibrasyon</b>
          <div class="mm-trow"><span>Montaj (yerçekimi yönü)</span><span>${calTxt}</span></div>
          <div class="mm-trow"><span>İleri Yön</span><span>${fTxt}</span></div>
          <p class="mm-note">Telefonu motosiklete sabitle, motosikleti <b>dik ve düz zeminde hareketsiz</b> tut (motor çalışabilir), sonra kalibre et. Telefonu yeniden takarsan tekrarla; sürüş sırasında yerinden oynarsa uygulama bunu fark edip yatış/ivme verisini keser.</p>
          ${calBlock}<button type="button" class="mm-mb primary mm-gwide" data-t="cal" ${T.recording || (cu && (cu.phase === 'capture' || cu.phase === 'wait')) ? 'disabled' : ''}>${T.recording ? 'Sürüş sırasında yapılamaz' : 'Kalibre et'}</button></div>
        ${rows ? `<div class="mm-gsec"><b>${T.recording ? 'Şu An' : 'Son Sürüş'}</b>${rows.map(r => `<div class="mm-trow"><span>${r[0]}</span><span>${r[1]}</span></div>`).join('')}</div>` : ''}
        <div class="mm-gsec"><b>Nasıl Okunur?</b>
          <p class="mm-note"><span class="tb m">Ölçülen</span> sensörün ölçtüğü değer (kalibrasyona bağlı). <span class="tb e">Tahmini</span> bir modelden hesaplanır, gerçek değer kabul edilmez. <span class="tb u">Veri yok</span> güvenilir ölçüm yok (nedeni yazar). <span class="tb x">Desteklenmiyor</span> cihaz bu veriyi vermiyor.</p>
          <p class="mm-note"><b>Yatış açısı telefonun eğimi değildir.</b> İvmeölçer virajda yanıltır; bu yüzden yatış, GPS hızı ve jiroskoptaki dönüş hızından fiziksel modelle <b>tahmin</b> edilir ve sensörler birbiriyle tutarlıysa gösterilir. Sürücü duruşu, lastik profili ve montaj hataları nedeniyle gerçek yatıştan birkaç derece farklı olabilir; gerçek yatış ölçümüyle <b>doğrulanmadı</b>. Ani fren/hızlanma eşikleri (fren ≥3,5 · hızlanma ≥3,0 m/s²) başlangıç değerleridir, gerçek sürüşle ayarlanmadı.</p></div>`;
      sheet.scrollTop = keep;
    }
    function openSheet() { T.open = true; sheet.hidden = false; renderSheet(); }
    function closeSheet() { T.open = false; sheet.hidden = true; }
    sheet.addEventListener('click', e => {
      const b = e.target.closest('[data-t]'); if (!b || b.disabled) return;
      if (b.dataset.t === 'close') closeSheet(); else if (b.dataset.t === 'cal') calibrate(); else if (b.dataset.t === 'probe') probe();
    });
    sheet.addEventListener('change', async e => {
      if (e.target.id !== 'mm-ten') return;
      T.enabled = e.target.checked; store.set('mm_tele', T.enabled ? '1' : '0');
      if (T.enabled && !T.listening && !T.recording) await probe();            // açar açmaz izni/uyumluluğu kontrol et (dokunma olayı içinde)
      paint();
    });
    const leanText = L => {
      if (L.lean != null) return '≈ ' + Math.round(Math.abs(L.lean)) + '° ' + (Math.abs(L.lean) < 2 ? '' : L.lean > 0 ? 'sol' : 'sağ') + ' (tahmini)';
      return '—';
    };
    function paintLean() {                                    // sürüş panelindeki Yatış satırı (hız/mesafenin yanında)
      const tile = $('mm-lean'); if (!tile) return;
      const L = (T.enabled && T.proc && T.proc.live) || {}, v = $('mm-lean-v'), m = $('mm-lean-m'), n = $('mm-lean-n');
      const lean = T.enabled && T.recording && L.lean != null ? L.lean : null;
      if (lean != null) {
        const a = Math.round(Math.abs(lean));
        v.textContent = a < 2 ? 'Dik · 0°' : a + '° ' + (lean > 0 ? 'Sol' : 'Sağ');
        m.style.left = (50 - Math.max(-1, Math.min(1, lean / 50)) * 46) + '%';       // sol = sol tarafta
        n.textContent = 'Tahmindir; gerçek yatışla doğrulanmadı.'; tile.dataset.st = 'on';
      } else {
        v.textContent = '—'; m.style.left = '50%'; tile.dataset.st = 'off';
        n.textContent = !T.enabled ? 'Sensör verisi kapalı. Açmak için dokun.' : !T.recording ? (T.note || (T.proc ? 'Duraklatıldı.' : 'Sensör kaydı başlamadı.')) : !L.t ? 'Sensör verisi bekleniyor…' : (L.leanReason ? (REASON[L.leanReason] || L.leanReason) : 'Veri yok.');
      }
    }
    function paintHud() {
      paintLean();
      const on = T.enabled && (T.recording || (T.proc && T.rideId));
      hud.hidden = !on; if (!on) return;
      const L = T.proc && T.proc.live || {}, ev = T.proc ? T.proc.evs : [], nb = ev.filter(e => e[1] === 'b').length, na = ev.length - nb;
      $('mm-tel-lean').textContent = L.lean != null ? leanText(L) : '—';
      $('mm-tel-lat').textContent = L.aLat != null ? fmt2(Math.abs(L.aLat) / G) + ' g' : '—';
      $('mm-tel-lon').textContent = L.aLon != null ? (L.aLon > 0 ? '+' : L.aLon < 0 ? '−' : '') + fmt2(Math.abs(L.aLon) / G) + ' g' : '—';
      $('mm-tel-ev').textContent = nb + ' / ' + na;
      const why = L.lean == null ? (L.leanReason || null) : null;
      $('mm-tel-note').textContent = L.t ? (L.lean != null ? 'Yatış tahmindir.' : why ? 'Yatış: ' + (REASON[why] || why) : '') : 'Sensör verisi bekleniyor…';
      if (T.open) renderSheet();
    }
    function paint() { paintHud(); renderSheet(); const b = $('mm-tbtn'); if (b) b.textContent = T.recording ? 'Kaydediyor' : T.enabled ? 'Açık' : 'Kapalı'; }
    // Sürüş özeti bölümü (bitişte modalın içine yerleştirilir)
    function summaryHtml(res) {
      if (!res) return '';
      const s = res.summary;
      if (res.none) return '<div class="mm-tsum"><b>Sensör Verisi</b><p class="warn">Bu sürüşte sensör verisi gelmedi (izin verilmemiş ya da cihaz desteklemiyor). Yalnızca GPS kaydı var.</p></div>';
      const row = (k, v) => `<div class="mm-trow"><span>${k}</span><span>${v}</span></div>`, st = (x, r) => badge(x.state, r);
      const ev = (o, n) => (o.n ? o.n + ' (' + (o.imu ? o.imu + ' ivmeölçer' : '') + (o.imu && o.gps ? ', ' : '') + (o.gps ? o.gps + ' GPS' : '') + ')' + (o.sev[2] || o.sev[1] ? ' · sert+: ' + (o.sev[1] + o.sev[2]) : '') : '0');
      return `<div class="mm-tsum"><b>Sensör Verisi</b>
        ${row('Ani Frenleme', ev(s.events.brake))}${row('Ani Hızlanma', ev(s.events.accel))}
        ${row('Boylamsal İvme', s.aLon.state === 'unavailable' || s.aLon.state === 'unsupported' ? st(s.aLon, s.reasons.aLon) : st(s.aLon) + ' <small>' + fmt1(s.aLon.min) + ' … +' + fmt1(s.aLon.max) + ' m/s²</small>')}
        ${row('Yanal İvme', s.aLat.state === 'measured' ? st(s.aLat) + ' <small>en çok ' + fmt1(s.aLat.absMax) + ' m/s²</small>' : st(s.aLat, s.reasons.aLat))}
        ${row('Yatış Açısı', s.lean.state === 'estimated' ? st(s.lean) + ' <small>sol ≈' + (s.lean.leftMax == null ? '—' : Math.round(s.lean.leftMax)) + '° · sağ ≈' + (s.lean.rightMax == null ? '—' : Math.round(s.lean.rightMax)) + '° (tahmini, ' + s.lean.secs + ' sn)</small>' : st(s.lean, s.reasons.lean))}
        ${s.sync && s.sync.lagMs != null ? row('GPS–Sensör Eşleşmesi', 'gecikme ≈' + Math.round(s.sync.lagMs) + ' ms <small>(r=' + fmt2(s.sync.corr) + ')</small>') : ''}
        <p class="mm-note">Yatış değerleri tahmindir; gerçek yatış ölçümüyle doğrulanmadı. Ani fren/hızlanma eşikleri gerçek sürüşle ayarlanmadı.</p></div>`;
    }
    hud.addEventListener('click', openSheet);
    { const lt = $('mm-lean'); if (lt) lt.addEventListener('click', openSheet); }
    window.addEventListener('ml-cal-changed', () => { if (!T.recording) { T.cal = loadCal(); paint(); } });      // Ayarlar › Kalibrasyon'dan yapılan kalibrasyonu al
    paint();
    return { begin, pause, resume, end, discard, sweep, onFix, openSheet, closeSheet, summaryHtml, enabled: () => T.enabled, recording: () => T.recording, _T: T };
  }
  window.Telemetry = { mount };
})();
