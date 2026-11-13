'use strict';
/* Ayarlar ekranı (telefon ayarları düzeni): profil kartı + gruplanmış liste → alt sayfalar.
   window.Settings.mount(root, h). h = index.html'in sağladığı kancalar (me, ask, logout, setVoice, setVol, ...).
   İlke: yalnızca GERÇEKTEN çalışan seçenekler etkin; olmayanlar «Yakında» diye açıkça belirtilir. Hiçbir tercih sahte (görünüp işlemeyen) değildir.
   Tercihler yalnızca bu cihazın localStorage'ında (ml_* anahtarları; harita tercihleri mevcut mm_* anahtarlarıyla ORTAK). */
(function (root) {
  const LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} },
    del(k) { try { localStorage.removeItem(k); } catch {} }
  };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const FS = [[88, 'Küçük'], [100, 'Normal'], [112, 'Büyük'], [125, 'Çok büyük']];

  // Görünüm tercihleri (yazı boyutu, hareketi azalt) açılışta uygulanır
  const FONTS = [['barlow', 'Barlow', 'Sportif ve net (varsayılan)', "'Barlow',system-ui,sans-serif"], ['system', 'Sistem', 'Cihazın kendi yazı tipi, en hızlı', 'system-ui,-apple-system,Roboto,sans-serif'],
    ['exo', 'Exo 2', 'Teknik, gösterge paneli havası', "'Exo 2',system-ui,sans-serif"], ['hyper', 'Okunaklı', 'Atkinson Hyperlegible: harfler karışmaz', "'Atkinson Hyperlegible',system-ui,sans-serif"]];
  function applyFont() { const f = LS.get('ml_font', 'barlow'), de = document.documentElement; if (f !== 'barlow' && FONTS.some(x => x[0] === f)) de.setAttribute('data-font', f); else de.removeAttribute('data-font'); }
  function applyDisplay() {
    applyFont();
    const fs = Number(LS.get('ml_fs', '100')), de = document.documentElement;
    de.style.fontSize = FS.some(f => f[0] === fs) && fs !== 100 ? fs + '%' : '';
    if (LS.get('ml_rm', '0') === '1') de.setAttribute('data-rm', '1'); else de.removeAttribute('data-rm');
  }

  // Bakım hatırlatıcısı: My Moto verisinden (aynı hesap çekirdeği) zamanı gelen/yaklaşan bakımlar
  function maintDue(user) {
    if (LS.get('ml_maint', '1') === '0' || !root.MyMoto) return [];
    let d; try { d = root.MyMoto.clean(JSON.parse(LS.get('mymoto:' + user, 'null'))); } catch { return []; }
    const out = [];
    for (const k of ['oil', 'chain', 'air']) { const st = root.MyMoto.maintState(d.maint[k], d.km); if (st.state === 'due' || st.state === 'soon') out.push({ name: root.MyMoto.NAMES[k], state: st.state, remaining: st.remaining }); }
    for (const [k, label] of [['insurance', 'Sigorta'], ['inspection', 'Muayene']]) { const dl = root.MyMoto.daysLeft(d.dates[k]); if (dl != null && dl <= 30) out.push({ name: label, state: dl < 0 ? 'due' : 'soon', days: dl }); }
    return out;
  }

  const ICON = {
    display: 'M4 5h16v11H4zM9 20h6M12 16v4', sound: 'M11 5 6 9H3v6h3l5 4zM15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13',
    theme: 'M12 3a9 9 0 1 0 9 9 7 7 0 0 1-9-9z', lang: 'M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18',
    notif: 'M6 9a6 6 0 0 1 12 0c0 6 2 7 2 7H4s2-1 2-7M10 20a2 2 0 0 0 4 0', privacy: 'M12 21s7-6 7-11a7 7 0 0 0-14 0c0 5 7 11 7 11zM12 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4',
    calib: 'M12 3v4M12 17v4M3 12h4M17 12h4M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6', data: 'M4 6c0-1.5 3.6-3 8-3s8 1.5 8 3-3.6 3-8 3-8-1.5-8-3zM4 6v6c0 1.5 3.6 3 8 3s8-1.5 8-3V6M4 12v6c0 1.5 3.6 3 8 3s8-1.5 8-3v-6',
    support: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7M12 17h.01', logout: 'M9 4H5v16h4M16 8l4 4-4 4M20 12H9',
    moto: 'M5 18.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 18.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM5 15.5 9 9.5h5.5l2.2 3.4M14.5 9.5 13.3 6H16M9 9.5H6.5',
    analysis: 'M4 19V9M10 19V5M16 19v-8M3 20h18',
    trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3', user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0'
  };
  const ic = (k, cls) => `<svg class="${cls || 'h-5 w-5'}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${ICON[k]}"/></svg>`;
  const chev = '<svg class="h-4 w-4 shrink-0 text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>';

  function mount(el, h) {
    const me = () => h.me() || {};
    let cur = 'home', msgT = 0, motoH = null;
    const msg = (t, bad) => { const m = el.querySelector('[data-sp-msg]'); if (!m) return; m.textContent = t; m.className = 'rounded-xl px-3 py-2 text-sm ' + (bad ? 'bg-rose-500/15 text-rose-300' : 'bg-emerald-500/15 text-emerald-300'); clearTimeout(msgT); msgT = setTimeout(() => { m.textContent = ''; m.className = 'hidden'; }, 4500); };
    const sw = (label, key, def, sub, dis) => `<label class="flex min-h-[56px] items-center justify-between gap-3 px-4 py-2"><span class="min-w-0"><span class="block">${label}</span>${sub ? `<small class="block text-xs text-zinc-400">${sub}</small>` : ''}</span><input type="checkbox" data-pref="${key}" data-def="${def}" ${LS.get(key, def) === '1' ? 'checked' : ''} ${dis ? 'disabled' : ''} class="h-6 w-6 shrink-0 accent-amber-400" aria-label="${esc(label)}"></label>`;
    const seg = (key, opts, val) => `<div class="grid gap-2 px-4 py-3" style="grid-template-columns:repeat(${opts.length},minmax(0,1fr))" role="group">${opts.map(([v, t, dis]) => `<button type="button" data-seg="${key}" data-v="${v}" ${dis ? 'disabled' : ''} aria-pressed="${String(v) === String(val)}" class="min-h-[44px] rounded-xl px-2 text-sm ${String(v) === String(val) ? 'bg-amber-400 font-semibold text-ink' : 'bg-white/[.07] text-zinc-200'} ${dis ? 'opacity-40' : ''}">${t}</button>`).join('')}</div>`;
    const box = inner => `<div class="divide-y divide-white/[.07] overflow-hidden rounded-2xl bg-white/[.055]" style="box-shadow:inset 0 0 0 1px rgba(255,255,255,.07)">${inner}</div>`;
    const note = t => `<p class="px-1 text-xs leading-snug text-zinc-500">${t}</p>`;
    const btn = (a, t, extra) => `<button type="button" data-act="${a}" class="btn-sec min-h-[48px] ${extra || ''}">${t}</button>`;

    /* ---------- Ana liste ---------- */
    const THEMES = [['moto', 'Gece Turuncu', '#EA8621', '#0a2a40'], ['asphalt', 'Asfalt Kırmızı', '#F05448', '#23252a'], ['forest', 'Orman Yeşili', '#9CD24C', '#14352a'], ['ocean', 'Okyanus Mavi', '#2EBAE8', '#0f2f5c']];
    const themeKey = () => { const t = LS.get('ml_theme', 'moto'); return THEMES.some(x => x[0] === t) ? t : 'moto'; };
    const themeName = () => THEMES.find(x => x[0] === themeKey())[1];
    const applyTheme = () => { const t = themeKey(); if (t === 'moto') document.documentElement.removeAttribute('data-apptheme'); else document.documentElement.setAttribute('data-apptheme', t); };
    const themeCards = () => `<div class="grid grid-cols-2 gap-3 px-4 py-3" role="group" aria-label="Uygulama Teması">${THEMES.map(([k, n, ac, bg]) => `<button type="button" data-seg="ml_theme" data-v="${k}" aria-pressed="${k === themeKey()}" class="flex min-h-[88px] flex-col items-start justify-between rounded-2xl p-3 text-left" style="background:linear-gradient(160deg,${bg},#05090d);box-shadow:inset 0 0 0 ${k === themeKey() ? '2px ' + ac : '1px rgba(255,255,255,.12)'}"><span class="h-6 w-6 rounded-full" style="background:${ac}"></span><span class="text-sm font-semibold">${n}${k === themeKey() ? ' ✓' : ''}</span></button>`).join('')}</div>`;
    const fontKey = () => { const f = LS.get('ml_font', 'barlow'); return FONTS.some(x => x[0] === f) ? f : 'barlow'; };
    let fontOpen = false;
    const fontCards = () => { const cur = FONTS.find(x => x[0] === fontKey());
      return `<div class="px-4 py-3"><button type="button" data-act="fontdd" aria-haspopup="listbox" aria-expanded="${fontOpen}" class="flex min-h-[56px] w-full items-center justify-between gap-3 rounded-2xl bg-white/[.07] px-4 text-left" style="box-shadow:inset 0 0 0 ${fontOpen ? '1.5px rgb(var(--a4))' : '1px rgba(255,255,255,.12)'}"><span class="min-w-0"><span class="block text-lg font-semibold leading-tight" style="font-family:${cur[3]}">${cur[1]}</span><small class="block truncate text-xs text-zinc-400">${cur[2]}</small></span><svg class="h-5 w-5 shrink-0 text-zinc-300 transition-transform ${fontOpen ? 'rotate-180' : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></button>`
        + (fontOpen ? `<ul role="listbox" aria-label="Yazı Tipi" class="mt-2 overflow-hidden rounded-2xl bg-white/[.05]" style="box-shadow:inset 0 0 0 1px rgba(255,255,255,.1)">${FONTS.map(([k, n, d, css]) => `<li role="option" aria-selected="${k === fontKey()}"><button type="button" data-seg="ml_font" data-v="${k}" class="flex min-h-[60px] w-full items-center justify-between gap-3 px-4 py-2 text-left ${k === fontKey() ? 'bg-amber-400/15' : 'active:bg-white/[.06]'}"><span class="min-w-0"><span class="block text-base font-semibold" style="font-family:${css}">${n} <span class="font-normal text-zinc-300">· Sürüşe hazırım 123 km/sa</span></span><small class="block text-xs text-zinc-400">${d}</small></span>${k === fontKey() ? '<span class="text-amber-300">✓</span>' : ''}</button></li>`).join('')}</ul>` : '') + '</div>'; };
    const fsName = () => (FS.find(f => f[0] === Number(LS.get('ml_fs', '100'))) || FS[1])[1];
    const permTxt = () => ('Notification' in window ? { granted: 'Açık', denied: 'Engelli', default: 'İzin İstenmedi' }[Notification.permission] : 'Desteklenmiyor');
    /* ---------- Sensör kalibrasyonu (telefon motosiklete sabitliyken; ayrı sayfa gerekmez) ---------- */
    let cal = null, calT = 0;      // { phase: wait|prep|cap|done|fail, t0, dur, msg, r }
    const calBusy = () => !!cal && ['wait', 'prep', 'cap'].includes(cal.phase);
    function calHtml() {
      if (!cal) return '';
      const left = ms => Math.max(0, Math.ceil(ms / 1000));
      if (cal.phase === 'wait') return '<p class="rounded-xl bg-white/[.07] p-3 text-sm text-zinc-200">İzin ve sensör kontrol ediliyor…</p>';
      if (cal.phase === 'prep') return `<div class="rounded-xl bg-amber-400/15 p-3 text-sm"><b class="text-amber-300">Hazırlan: ${left(cal.dur - (Date.now() - cal.t0))} sn</b><br>Motosikleti dik ve düz zeminde hareketsiz tut, telefona dokunma.</div>`;
      if (cal.phase === 'cap') return `<div class="rounded-xl bg-amber-400/15 p-3 text-sm"><b class="text-amber-300">Kıpırdama… ${left(cal.dur - (Date.now() - cal.t0))} sn</b><br>Yerçekimi yönü ölçülüyor.</div>`;
      if (cal.phase === 'fail') return `<p class="rounded-xl bg-rose-500/15 p-3 text-sm text-rose-300">${esc(cal.msg)}</p>`;
      return `<p class="rounded-xl bg-emerald-500/15 p-3 text-sm text-emerald-300"><b>Kalibrasyon kaydedildi.</b> Sapma ${cal.r.drift}°, titreşim ${cal.r.spread}°. Yatış açısının «sıfır» noktası artık bu duruştur. Telefonu yeniden takarsan tekrarla.</p>`;
    }
    function calPaint() { const o = el.querySelector('[data-cal-out]'); if (o) o.innerHTML = calHtml(); const b = el.querySelector('[data-act="calnow"]'); if (b) { b.disabled = calBusy(); b.textContent = calBusy() ? 'Kalibre Ediliyor…' : 'Telefon Motora Sabit — Kalibre Et'; } }
    const calEnd = (phase, extra) => { clearInterval(calT); cal = Object.assign({ phase }, extra); calPaint(); if (cur === 'calib') { const t = el.querySelector('[data-cal-state]'); if (t) t.textContent = calSub(); } };
    async function calNow() {
      if (calBusy()) return;
      cal = { phase: 'wait' }; calPaint();
      let perm = true;                                  // iOS: izin penceresi dokunma olayı içinde, en başta istenmeli
      if (!('DeviceMotionEvent' in window)) return calEnd('fail', { msg: 'Bu tarayıcı hareket sensörü vermiyor.' });
      if (window.isSecureContext === false) return calEnd('fail', { msg: 'Sensörler için HTTPS gerekli.' });
      const DME = window.DeviceMotionEvent;
      if (typeof DME.requestPermission === 'function') { try { perm = (await DME.requestPermission()) === 'granted'; } catch { perm = false; } }
      if (!perm) return calEnd('fail', { msg: 'Hareket sensörü izni verilmedi. Tarayıcı/sistem ayarlarından «Hareket ve yönelim» iznini aç.' });
      try { if (!window.TelemetryCore) await new Promise((res, rej) => { const sc = document.createElement('script'); sc.src = '/telemetry-core.js'; sc.onload = res; sc.onerror = rej; document.head.appendChild(sc); }); }
      catch { return calEnd('fail', { msg: 'Kalibrasyon modülü yüklenemedi. Bağlantını kontrol et.' }); }
      const TC = window.TelemetryCore; let seen = 0, rotNZ = false, grab = null; const samples = [];
      const on = e => {
        const ag = e.accelerationIncludingGravity; if (!ag || ag.x == null || ag.y == null || ag.z == null) return;
        seen++; const r = e.rotationRate; let rot = r && r.alpha != null && r.beta != null && r.gamma != null ? [r.beta * Math.PI / 180, r.gamma * Math.PI / 180, r.alpha * Math.PI / 180] : null;
        if (rot) { if (rot[0] || rot[1] || rot[2]) rotNZ = true; else if (!rotNZ && seen > 40) rot = null; }
        if (grab) samples.push({ ag: [ag.x, ag.y, ag.z], rot });
      };
      window.addEventListener('devicemotion', on);
      const stop = () => window.removeEventListener('devicemotion', on), sleep = ms => new Promise(r => setTimeout(r, ms));
      try {
        const t0 = Date.now(); while (seen < 30 && Date.now() - t0 < 2500) await sleep(50);
        if (seen < 30) { stop(); return calEnd('fail', { msg: 'Sensör verisi gelmiyor (masaüstü cihaz ya da sensör engelli).' }); }
        cal = { phase: 'prep', t0: Date.now(), dur: 5000 }; calPaint(); calT = setInterval(calPaint, 250); await sleep(cal.dur);
        cal = { phase: 'cap', t0: Date.now(), dur: 4000 }; grab = true; calPaint(); await sleep(cal.dur); grab = null; clearInterval(calT); stop();
        const r = TC.staticCalibrate(samples);
        if (!r.ok) return calEnd('fail', { msg: { moving: 'Hareket algılandı: motosikleti dik ve sabit tut, telefonu sıkıca tuttur; tekrar dene.', 'gravity-magnitude': 'İvmeölçer yerçekimini okumuyor gibi görünüyor.', few: 'Yeterli sensör verisi gelmedi.' }[r.reason] || 'Kalibrasyon başarısız.' });
        let u = r.u, flipped = false;
        try { if (LS.get('mm_tinv', '0') === '1') { u = u.map(x => -x); flipped = true; } } catch {}
        const gyroOk = LS.get('mm_tgyro', '0') === '1' ? true : null;
        LS.set('mm_tcal', JSON.stringify({ u, uAt: Date.now(), uQ: { drift: r.drift, spread: r.spread, n: r.n }, uFlipped: flipped, f: null, fSrc: null, gyroOk }));
        try { window.dispatchEvent(new Event('ml-cal-changed')); } catch {}
        calEnd('done', { r });
      } catch (e) { stop(); calEnd('fail', { msg: 'Kalibrasyon başarısız oldu.' }); }
    }
    function calSub() { try { const c = JSON.parse(LS.get('mm_tcal', 'null')); return c && c.uAt ? 'Sensör kalibre edildi' : 'Sensör kalibre edilmedi'; } catch { return 'Sensör kalibre edilmedi'; } }
    function row(k, title, sub) { return `<button type="button" data-go="${k}" class="flex min-h-[60px] w-full items-center gap-3 px-4 py-2 text-left active:bg-white/[.06]"><span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-400/15 text-amber-300">${ic(k)}</span><span class="min-w-0 flex-1"><span class="block">${title}</span>${sub ? `<small class="block truncate text-xs text-zinc-400">${esc(sub)}</small>` : ''}</span>${chev}</button>`; }
    function home() {
      const m = me(), name = [m.firstName, m.lastName].filter(Boolean).join(' ');
      const av = m.avatar ? `<img src="${esc(m.avatar)}" alt="" class="h-full w-full object-cover">` : `<span class="road text-3xl font-semibold text-amber-300">${esc((m.username || '?').slice(0, 1).toUpperCase())}</span>`;
      return `<button type="button" data-go="profile" class="flex w-full items-center gap-4 rounded-2xl bg-white/[.055] p-4 text-left active:bg-white/[.09]" style="box-shadow:inset 0 0 0 1px rgba(255,255,255,.07)">
          <span class="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white/10">${av}</span>
          <span class="min-w-0 flex-1"><span class="road block truncate text-2xl font-semibold leading-tight">${esc(m.username || '—')}</span><small class="block truncate text-zinc-300">${esc(name || 'İsim girilmedi')}</small><small class="block truncate text-xs text-zinc-400">${esc(m.email || 'E-posta girilmedi')}</small>
          <span class="mt-1 inline-block rounded-lg bg-amber-400/15 px-2 py-0.5 text-xs text-amber-300">Profili Düzenle</span></span>${chev}</button>
        ${box(row('moto', 'Motosiklet Ayarları', [me().bikeBrand, me().bikeModel, me().bikeYear].filter(Boolean).join(' ') || 'Marka ve model girilmedi'))}
        ${box(row('display', 'Ekran', 'Yazı: ' + FONTS.find(x => x[0] === fontKey())[1] + ' · Boyut: ' + fsName()) + row('theme', 'Tema', 'Uygulama: ' + themeName() + ' · Harita: ' + (LS.get('mm_theme', 'dark') === 'light' ? 'Açık' : 'Koyu')) + row('lang', 'Uygulama Dili', 'Türkçe'))}
        ${box(row('notif', 'Bildirim', 'Tarayıcı bildirimi: ' + permTxt()) + row('privacy', 'Konum ve Gizlilik', 'Konum paylaşımı, izinler') + row('calib', 'Kalibrasyon', calSub()) + row('analysis', 'Sürüş Analizi', 'Haftalık / aylık istatistik, sıfırlama'))}
        ${box(row('data', 'Veri ve Depolama', 'Sürüş kayıtları, yedek') + row('support', 'Destek', 'Tanılama, ipuçları, hakkında'))}
        ${box(`<button type="button" data-act="logout" class="flex min-h-[56px] w-full items-center gap-3 px-4 text-left text-red-300 active:bg-white/[.06]"><span class="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10">${ic('logout')}</span>Çıkış Yap</button>
          <button type="button" data-go="delete" class="flex min-h-[56px] w-full items-center gap-3 px-4 text-left text-red-400 active:bg-white/[.06]"><span class="flex h-9 w-9 items-center justify-center rounded-xl bg-red-500/15">${ic('trash')}</span>Hesabı Sil</button>`)}`;
    }

    /* ---------- Alt sayfalar ---------- */
    const TITLES = { moto: 'Motosiklet Ayarları', profile: 'Profili Düzenle', display: 'Ekran', sound: 'Ses', theme: 'Tema', lang: 'Uygulama Dili', notif: 'Bildirim', privacy: 'Konum ve Gizlilik', calib: 'Kalibrasyon', data: 'Veri ve Depolama', support: 'Destek', delete: 'Hesabı Sil' };
    const PANELS = {
      display: () => box(`<div class="px-4 pt-3 text-sm text-zinc-300">Yazı Tipi</div>${fontCards()}<div class="px-4 pt-3 text-sm text-zinc-300">Yazı Boyutu (Punto)</div>${seg('fs', FS.map(([v, t]) => [v, t]), LS.get('ml_fs', '100'))}`
        + sw('Hareketi Azalt', 'ml_rm', '0', 'Geçiş efektlerini kapatır')
        + sw('Sürüşte Ekranı Açık Tut', 'mm_wake', '1', 'Konum kaydı için ekran kilitlenmez; pil tüketimini artırır')
        + `<div class="px-4 pt-3 text-sm text-zinc-300">Sürüş Ekranında Ortalama Hız</div>${seg('mm_avg', [['mov', 'Hareket'], ['tot', 'Toplam']], LS.get('mm_avg', 'mov'))}`) + note('Hareket: yalnızca giderken. Toplam: duruşlar dahil. Sürüş panelinde de dokunarak değişir.'),
      theme: () => box(`<div class="px-4 pt-3 text-sm text-zinc-300">Uygulama Teması</div>${themeCards()}`
        + `<div class="px-4 pt-3 text-sm text-zinc-300">Harita Teması</div>${seg('mm_theme', [['dark', 'Koyu'], ['light', 'Açık']], LS.get('mm_theme', 'dark') === 'light' ? 'light' : 'dark')}`) + note('Uygulama temaları renkleri ve zemini değiştirir; seçim bu cihazda saklanır. Harita teması harita menüsündeki ayarla aynıdır.'),
      lang: () => box(`<div class="flex min-h-[56px] items-center justify-between px-4"><span>Türkçe</span><span class="text-amber-300">✓</span></div><div class="flex min-h-[56px] items-center justify-between px-4 text-zinc-500"><span>Diğer Diller</span><span class="text-xs">Yakında</span></div>`) + note('Uygulama şu an yalnızca Türkçe. Başka diller eklendiğinde buradan seçilecek.'),
      notif: () => box(`<div class="flex min-h-[56px] items-center justify-between gap-3 px-4"><span>Tarayıcı Bildirimi<small class="block text-xs text-zinc-400">Durum: ${permTxt()}</small></span>${'Notification' in window && Notification.permission === 'default' ? `<button type="button" data-act="notifperm" class="btn-sm min-h-[44px]">İzin İste</button>` : ''}</div>`
        + sw('Bakım Hatırlatıcıları', 'ml_maint', '1', 'My Moto’da zamanı gelen bakım, sigorta ve muayene ana sayfada görünür')
        + sw('Titreşimli Grup Uyarıları', 'ml_vib', '1', navigator.vibrate ? 'Geride kaldın / uzaklaştın uyarılarında titreşir' : 'Bu cihaz titreşimi desteklemiyor (ör. iPhone)', !navigator.vibrate)) + note('Notification' in window && Notification.permission === 'denied' ? 'Bildirim engelli: tarayıcının site ayarlarından açabilirsin.' : 'Uygulama kapalıyken bildirim (push) gönderilmez; uyarılar uygulama açıkken gelir.'),
      privacy: () => `<div class="space-y-3"><p class="rounded-2xl bg-white/[.055] p-4 text-sm text-zinc-300">Canlı konum paylaşımı her açılışta <b>kapalı</b> başlar. Açarken kapsamı (arkadaşlar / herkes) için onay istenir. Grup sürüşünde konum, her sürüşte ayrıca onayınla paylaşılır ve sürüş bitince durur.</p>`
        + btn('resetcons', 'Konum Paylaşım Onaylarını Sıfırla') + `<div data-slot="perm"></div></div>`,
      moto: () => { const m = me(), D = root.MyMoto && root.MyMoto.read ? root.MyMoto.read(m.username) : { owner: '', km: null, dates: {} }, fld = (k, t, inner) => `<label class="block text-xs text-zinc-400">${t}${inner}</label>`,
          nm = [m.bikeBrand, m.bikeModel].filter((x, i, a) => x && a.indexOf(x) === i).join(' '), owner = D.owner || [m.firstName, m.lastName].filter(Boolean).join(' ');
        return `<div class="space-y-3"><h2 class="road text-xl font-semibold">Motosiklet Bilgileri</h2><div class="space-y-3 rounded-2xl bg-white/[.055] p-4">`
          + fld('owner', 'Motor Sahibi', `<input data-moto="owner" class="field mt-1" maxlength="60" autocomplete="name" value="${esc(owner)}">`)
          + fld('name', 'Motor Adı', `<input data-moto="name" class="field mt-1" maxlength="80" list="brands" placeholder="Yamaha MT-07" value="${esc(nm)}">`)
          + `<div class="grid grid-cols-2 gap-3">` + fld('year', 'Model Yılı', `<input data-moto="year" class="field mt-1" type="number" inputmode="numeric" min="1950" max="${new Date().getFullYear() + 1}" placeholder="2021" value="${esc(m.bikeYear || '')}">`)
          + fld('km', 'Km', `<input data-moto="km" class="field mt-1" type="number" inputmode="numeric" min="0" max="999999" placeholder="24500" value="${D.km == null ? '' : D.km}">`) + `</div>`
          + `<div class="grid grid-cols-2 gap-3">` + fld('cc', 'Motor Hacmi (cc)', `<input data-moto="cc" class="field mt-1" type="number" inputmode="numeric" min="20" max="3000" placeholder="689" value="${esc(m.bikeCc || '')}">`)
          + fld('inspection', 'Muayene Tarihi', `<input data-moto="inspection" class="field mt-1" type="date" value="${esc((D.dates && D.dates.inspection) || '')}">`) + `</div>`
          + `</div><div data-motobar style="display:none" class="grid grid-cols-2 gap-3">` + btn('motocancel', 'Değişiklikten Vazgeç') + btn('motosave', 'Kaydet', 'btn-accent') + `</div><p class="px-1 text-xs leading-snug text-zinc-500">Motor sahibi, km ve muayene tarihi yalnızca bu cihazda saklanır. Motosiklet tipi ve rengi My Moto sayfasında, resmin sağındaki görünüm düğmesinden seçilir.</p>`
          + `<h2 class="road pt-2 text-xl font-semibold">Bakım ile Yakıt ve Tüketim</h2><div data-slot="mymoto"></div></div>`; },
      calib: () => `<div class="space-y-3"><div class="rounded-2xl bg-white/[.055] p-4"><p class="font-medium">Sensör Kalibrasyonu</p><p class="mt-1 text-sm text-zinc-300">Durum: <span data-cal-state>${esc(calSub())}</span></p><p class="mt-1 text-xs text-zinc-400">Yatış, ivme ve ani fren/hızlanma için telefon motosiklete sabitlendikten sonra yapılır. Yatış açısı bir tahmindir.</p></div>`
        + `<ol class="space-y-1 rounded-2xl bg-white/[.055] p-4 text-sm text-zinc-300"><li>1. Telefonu motosiklete her zamanki gibi sıkıca sabitle.</li><li>2. Motosikleti dik ve düz zeminde hareketsiz tut (motor çalışabilir).</li><li>3. Aşağıdaki düğmeye bas; 5 sn hazırlık + 4 sn ölçüm sırasında dokunma.</li></ol>`
        + `<div data-cal-out>${calHtml()}</div>` + btn('calnow', calBusy() ? 'Kalibre Ediliyor…' : 'Telefon Motora Sabit — Kalibre Et', 'btn-accent') + btn('sensors', 'Gelişmiş Sensör Ayarları (Harita)') + `</div>`,
      data: () => `<div class="space-y-3"><div id="stRides" class="rounded-2xl bg-white/[.055] p-4 text-sm text-zinc-300">Sürüş kayıtları okunuyor…</div>${btn('syncnow', 'Bekleyen Sürüşleri Şimdi Gönder')}
        <div id="stStore" class="rounded-2xl bg-white/[.055] p-4 text-sm text-zinc-300">Depolama bilgisi okunuyor…</div>${btn('persist', 'Kalıcı Depolama İste')}
        <div class="rounded-2xl bg-white/[.055] p-4"><p class="font-medium">My Moto Verisi</p><p class="mt-1 text-xs text-zinc-400">Bakım, yakıt ve kilometre kayıtların yalnızca bu cihazda saklanır. Yedeği indirip başka cihaza yükleyebilirsin.</p></div>
        ${btn('motoexport', 'My Moto Yedeğini İndir')}${btn('motoimport', 'My Moto Yedeğini Yükle')}<input id="stFile" type="file" accept="application/json,.json" class="hidden">
        ${btn('clearcache', 'Önbelleği Temizle ve Yenile')}${note('Önbellek temizliği giriş, tercihler ve sürüş kayıtlarını silmez; yalnızca uygulama dosyalarını yeniler.')}</div>`,
      support: () => `<div class="space-y-3">${btn('diag', 'Tanılama Bilgisini Kopyala')}${note('Cihaz/tarayıcı bilgisi, izin ve depolama durumunu içerir; e-posta, konum veya kayıt içermez. Sorun bildirirken yapıştır.')}
        <details class="rounded-2xl bg-white/[.055] p-4"><summary class="min-h-[44px]">Sürüş Kaydı Neden Kesiliyor?</summary><p class="pt-2 text-sm text-zinc-300">Tarayıcı uygulaması ekran kilitlenince ya da arka plana alınınca konumu güvenilir alamaz. Sürüş boyunca uygulamayı ön planda, ekranı açık tut (Ekran → Sürüşte ekranı açık tut).</p></details>
        <details class="rounded-2xl bg-white/[.055] p-4"><summary class="min-h-[44px]">Yatış Açısı Doğru mu?</summary><p class="pt-2 text-sm text-zinc-300">Yatış, GPS hızı ve dönüş hızından hesaplanan bir tahmindir; gerçek ölçüm değildir. Güvenilir hesap yapılamazsa «veri yok» yazılır.</p></details>
        <details class="rounded-2xl bg-white/[.055] p-4"><summary class="min-h-[44px]">Konumum Kimlere Görünür?</summary><p class="pt-2 text-sm text-zinc-300">Yalnızca paylaşımı kendin açtığında; kapsamı arkadaşlar ya da herkes olarak seçersin. Arkadaş olmayanlara konum yaklaşık (≈100 m yuvarlanmış) gider.</p></details>
        <div class="rounded-2xl bg-white/[.055] p-4 text-sm text-zinc-300"><p class="font-medium">Hakkında</p><p class="mt-1">Moto Life · Harita verisi © OpenStreetMap katkıcıları.</p></div></div>`,
      delete: () => `<div class="space-y-3"><div class="rounded-2xl bg-red-500/10 p-4 text-sm text-red-200"><p class="font-semibold">Bu işlem geri alınamaz.</p><ul class="mt-2 list-disc space-y-1 pl-5 text-red-100/90"><li>Hesabın, sürüş ve telemetri kayıtların sunucudan silinir.</li><li>Gönderilerin, yorum/beğenilerin, arkadaşlıkların ve mesajların silinir.</li><li>Tüm gruplardan çıkarılırsın.</li><li>Bu cihazdaki My Moto, sürüş kayıtların ve tercihlerin silinir.</li><li>Başkalarıyla birlikte kaydedilen grup sürüşlerindeki konum izlerin diğer üyelerin analizinde kalabilir.</li></ul></div>
        <label class="block text-xs text-zinc-400">Onay için kullanıcı adını yaz (${esc(me().username)})<input id="stDelUser" class="field mt-1" autocomplete="off" autocapitalize="none"></label>
        ${me().hasPassword ? '<label class="block text-xs text-zinc-400">Şifre<input id="stDelPw" type="password" class="field mt-1" autocomplete="current-password"></label>' : ''}
        <button type="button" data-act="delete" class="btn min-h-[48px] !bg-red-500 !text-white">Hesabımı Kalıcı Olarak Sil</button></div>`
    };

    function show(name) {
      if (name !== cur) fontOpen = false;
      cur = name;
      for (const k of ['perm', 'cal', 'profile']) { const b = $('lg-' + k); if (b) $('setLegacy').appendChild(b); }   // eski bloklar (kimlikler korunur) saklama alanına dön
      if (name === 'home') { el.innerHTML = `<h1 class="road mb-3 text-3xl font-bold">Ayarlar</h1><div class="space-y-4">${home()}</div>`; window.scrollTo(0, 0); return; }
      const inner = name === 'profile' ? '<div data-slot="profile"></div>' : PANELS[name]();
      el.innerHTML = `<div class="mb-3 flex items-center gap-2"><button type="button" data-go="home" aria-label="Geri" class="flex h-11 w-11 items-center justify-center rounded-xl bg-white/10 text-xl">‹</button><h1 class="road text-3xl font-bold">${TITLES[name]}</h1></div><div data-sp-msg class="hidden" role="status"></div><div class="space-y-3 pb-2">${inner}</div>`;
      for (const [slot, id] of [['perm', 'lg-perm'], ['profile', 'lg-profile']]) { const s = el.querySelector(`[data-slot="${slot}"]`); if (s && $(id)) s.appendChild($(id)); }
      window.scrollTo(0, 0);
      if (name === 'display' || name === 'data' || name === 'moto') after(name);
    }
    function motoFields() { return [...el.querySelectorAll('[data-moto]')]; }
    function motoDirty() { const bar = el.querySelector('[data-motobar]'); if (bar) bar.style.display = motoFields().some(i => i.value !== i.dataset.v0) ? '' : 'none'; }
    function motoDirtyInit() { motoFields().forEach(i => { i.dataset.v0 = i.value; i.addEventListener('input', motoDirty); i.addEventListener('change', motoDirty); }); motoDirty(); }
    function after(name) {
      if (name === 'moto') { motoDirtyInit(); const sl = el.querySelector('[data-slot="mymoto"]'); motoH = sl && root.MyMoto && root.MyMoto.mount ? root.MyMoto.mount(sl, { user: me().username }) : null; return; }
      if (name === 'data') {
        const R = $('stRides');
        loadRides().then(RS => RS.counts(me().username).then(c => { R.textContent = `Bu cihazda ${c.total} tamamlanmış sürüş var. ${c.pending} tanesi sunucuya gönderilmeyi bekliyor${c.failed ? `, ${c.failed} tanesi sunucu tarafından reddedildi (cihazda duruyor)` : ''}.`; })).catch(() => { R.textContent = 'Sürüş kayıtları okunamadı.'; });
        const S = $('stStore');
        (async () => {
          let t = [];
          try { const p = navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted() : null; t.push(p == null ? 'Kalıcı depolama durumu bilinmiyor.' : p ? 'Kalıcı depolama: açık (tarayıcı verini kendiliğinden silmez).' : 'Kalıcı depolama: kapalı (tarayıcı yer açmak için verini silebilir).'); } catch { t.push('Kalıcı depolama durumu okunamadı.'); }
          try { if (navigator.storage && navigator.storage.estimate) { const e = await navigator.storage.estimate(); t.push('Kullanılan alan: ' + (e.usage / 1048576).toFixed(1).replace('.', ',') + ' MB.'); } } catch {}
          S.textContent = t.join(' ');
        })();
      }
    }
    let rsP = null;
    function loadRides() {
      if (rsP) return rsP;
      const load = src => new Promise((ok, no) => { if (document.querySelector(`script[data-lz="${src}"]`)) return ok(); const s = document.createElement('script'); s.src = src; s.dataset.lz = src; s.onload = ok; s.onerror = () => no(new Error(src)); document.head.appendChild(s); });
      return rsP = (root.RideStore ? Promise.resolve() : load('/ride-core.js').then(() => load('/ride-store.js'))).then(() => root.RideStore.init().then(() => root.RideStore)).catch(e => { rsP = null; throw e; });
    }

    /* ---------- Etkinlikler ---------- */
    el.addEventListener('click', async e => {
      const go = e.target.closest('[data-go]'); if (go) return go.dataset.go === 'analysis' ? h.openAnalysis() : show(go.dataset.go);
      const sg = e.target.closest('[data-seg]');
      if (sg && !sg.disabled) {
        const k = sg.dataset.seg, v = sg.dataset.v;
        if (k === 'ml_font') { LS.set('ml_font', v); applyFont(); fontOpen = false; } else if (k === 'ml_theme') { LS.set('ml_theme', v); applyTheme(); } else if (k === 'fs') { LS.set('ml_fs', v); applyDisplay(); } else if (k === 'mm_avg' || k === 'mm_theme') { LS.set(k, v); h.mapPrefs(); }
        return show(cur);
      }
      const b = e.target.closest('[data-act]'); if (!b) return; const a = b.dataset.act;
      if (a === 'logout') h.ask('Çıkış Yapılsın mı?', h.logout);
      else if (a === 'notifperm') { try { await Notification.requestPermission(); } catch {} show('notif'); }
      else if (a === 'resetcons') { LS.del('mm_cons_friends'); LS.del('mm_cons_all'); msg('Onaylar sıfırlandı. Bir sonraki paylaşımda yeniden sorulur.'); }
      else if (a === 'motocancel') { el.querySelectorAll('[data-moto]').forEach(i => { i.value = i.dataset.v0 || ''; }); motoDirty(); msg(''); }
      else if (a === 'motosave') {
        const g = k => (el.querySelector('[data-moto=' + k + ']').value || '').trim(), nm = g('name').replace(/\s+/g, ' '), M = root.MyMoto, u = me().username;
        const sp = nm.indexOf(' '), br = sp < 0 ? nm : nm.slice(0, sp), mo = !nm ? '' : sp < 0 ? nm : nm.slice(sp + 1);
        if (br.length > 40 || mo.length > 40) return msg('Motor adı çok uzun (marka ve model en çok 40 karakter).', true);
        const kmS = g('km').replace(',', '.'), km = kmS === '' ? null : Number(kmS), insp = g('inspection'), prev = M.read(u);
        if (km !== null && !(Number.isInteger(km) && km >= 0 && km <= 999999)) return msg('Kilometre geçersiz (0 ile 999999 arasında tam sayı).', true);
        if (km !== null && prev.km != null && km < prev.km) return msg('Kilometre önceki değerden (' + prev.km.toLocaleString('tr-TR') + ') küçük olamaz.', true);
        if (insp && !/^\d{4}-\d{2}-\d{2}$/.test(insp)) return msg('Muayene tarihi geçersiz.', true);
        try {
          b.disabled = true; await h.saveBike(br, mo, { year: g('year'), type: me().bikeType || '', cc: g('cc') });
          const ok = M.write(u, D => { D.owner = g('owner'); if (km !== null) D.km = km; D.dates.inspection = insp; });
          if (motoH && motoH.refresh) motoH.refresh(); if (h.motoRefresh) h.motoRefresh();
          motoFields().forEach(i => { i.dataset.v0 = i.value; }); motoDirty();
          msg(ok ? 'Kaydedildi.' : 'Motosiklet bilgileri kaydedildi; sahip, km ve muayene tarihi bu tarayıcıda saklanamadı.', !ok);
        } catch (err) { msg(err.message || 'Kaydedilemedi.', true); } finally { b.disabled = false; }
      }
      else if (a === 'fontdd') { fontOpen = !fontOpen; show(cur); }
      else if (a === 'calnow') calNow();
      else if (a === 'sensors') h.openSensors();
      else if (a === 'analysis') h.openAnalysis();
      else if (a === 'syncnow') { try { const RS = await loadRides(); if (!navigator.onLine) { msg('Çevrimdışısın; bağlantı gelince otomatik gönderilir.', true); return; } const r = await RS.sync(me().username); msg(r.offline ? 'Sunucuya ulaşılamadı.' : r.auth ? 'Oturum süresi dolmuş, tekrar giriş yap.' : `${r.sent} sürüş gönderildi${r.left ? ', ' + r.left + ' beklemede' : ''}${r.failed ? ', ' + r.failed + ' reddedildi' : ''}.`, !!(r.offline || r.auth)); after('data'); } catch { msg('Eşitleme başarısız.', true); } }
      else if (a === 'persist') { try { const ok = navigator.storage && navigator.storage.persist ? await navigator.storage.persist() : false; msg(ok ? 'Kalıcı depolama açıldı.' : 'Tarayıcı kalıcı depolamayı vermedi (sık kullanılan/yüklü uygulamalarda daha olasıdır).', !ok); after('data'); } catch { msg('İstek başarısız.', true); } }
      else if (a === 'motoexport') {
        const raw = LS.get('mymoto:' + me().username, null); if (!raw) return msg('Henüz My Moto verisi yok.', true);
        const url = URL.createObjectURL(new Blob([JSON.stringify({ app: 'moto-life', kind: 'mymoto', v: 1, data: JSON.parse(raw) })], { type: 'application/json' })), l = document.createElement('a');
        l.href = url; l.download = 'my-moto-yedek.json'; document.body.appendChild(l); l.click(); l.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000); msg('Yedek indirildi.');
      } else if (a === 'motoimport') $('stFile').click();
      else if (a === 'clearcache') h.ask('Önbellek Temizlenip Sayfa Yenilensin mi?', async () => { try { const rs = await navigator.serviceWorker.getRegistrations(); await Promise.all(rs.map(r => r.unregister())); for (const k of await caches.keys()) await caches.delete(k); } catch {} location.reload(); });
      else if (a === 'diag') {
        const q = async n => { try { return (await navigator.permissions.query({ name: n })).state; } catch { return '?'; } };
        const t = ['Moto Life Tanılama', 'Zaman: ' + new Date().toISOString(), 'Tarayıcı: ' + navigator.userAgent, 'Ekran: ' + screen.width + 'x' + screen.height + ' @' + (devicePixelRatio || 1) + ' / pencere ' + innerWidth + 'x' + innerHeight, 'Çevrimiçi: ' + navigator.onLine,
          'Konum izni: ' + await q('geolocation'), 'Mikrofon izni: ' + await q('microphone'), 'Bildirim izni: ' + ('Notification' in window ? Notification.permission : 'yok'), 'Wake Lock: ' + ('wakeLock' in navigator), 'Sensör (DeviceMotion): ' + ('DeviceMotionEvent' in window), 'Titreşim: ' + !!navigator.vibrate,
          'Service worker: ' + (navigator.serviceWorker && navigator.serviceWorker.controller ? 'aktif' : 'yok'), 'Kalıcı depolama: ' + (navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted() : '?'), 'Yazı boyutu: %' + LS.get('ml_fs', '100')].join('\n');
        try { await navigator.clipboard.writeText(t); msg('Tanılama bilgisi kopyalandı.'); } catch { const ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select(); let ok = false; try { ok = document.execCommand('copy'); } catch {} ta.remove(); msg(ok ? 'Tanılama bilgisi kopyalandı.' : 'Kopyalanamadı.', !ok); }
      } else if (a === 'delete') {
        const u = me().username, conf = $('stDelUser').value.trim(), pw = $('stDelPw') ? $('stDelPw').value : '';
        if (conf.toLocaleLowerCase('tr') !== String(u).toLocaleLowerCase('tr')) return msg('Onay için kullanıcı adını yaz.', true);
        if (me().hasPassword && !pw) return msg('Şifreni gir.', true);
        h.ask('Hesabın kalıcı olarak silinsin mi? Bu geri alınamaz.', async () => {
          try {
            const r = await fetch('/api/account/delete', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: conf, password: pw }) });
            const j = await r.json().catch(() => ({})); if (!r.ok) return msg(j.error || 'Silinemedi.', true);
            try { const RS = await loadRides(); for (const m of await RS.list(u)) await RS.remove(m.id); } catch {}
            LS.del('mymoto:' + u); LS.del('lastAcct'); location.reload();
          } catch { msg('Sunucuya ulaşılamadı; hesap silinmedi.', true); }
        });
      }
    });
    el.addEventListener('change', e => {
      const p = e.target.dataset && e.target.dataset.pref;
      if (p) { LS.set(p, e.target.checked ? '1' : '0'); if (p === 'ml_rm') applyDisplay(); if (p === 'mm_wake') h.mapPrefs(); if (p === 'ml_maint' && h.maintChanged) h.maintChanged(); return; }
      if (e.target.id === 'stFile') {
        const f = e.target.files && e.target.files[0]; e.target.value = ''; if (!f) return;
        if (f.size > 1048576) return msg('Dosya çok büyük.', true);
        f.text().then(t => {
          let d; try { d = JSON.parse(t); } catch { return msg('Dosya okunamadı.', true); }
          if (!d || d.kind !== 'mymoto' || !d.data || !root.MyMoto) return msg('Bu bir My Moto yedeği değil.', true);
          const c = root.MyMoto.clean(d.data);
          h.ask('Mevcut My Moto verisinin üzerine yazılsın mı?', () => { LS.set('mymoto:' + me().username, JSON.stringify(c)); if (h.motoRefresh) h.motoRefresh(); msg('Yedek yüklendi.'); });
        });
      }
    });
    show('home');
    return { show, home: () => show('home'), refresh: () => show(cur === 'profile' ? 'profile' : cur) };
  }
  applyDisplay();
  root.Settings = { mount, applyDisplay, maintDue };
})(window);
