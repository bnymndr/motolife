'use strict';
/* MÜZİK + RADYO paneli (harita ekranı). Çekirdekler: AudioCore (durum/öncelik), MediaCore (geçiş/kısma).
   Sağ düğme sütununda ♪ düğmesi; alt panelin üstünde kompakt şerit; düğmeye basınca alt sayfa (Müzik | Radyo). Grup interkomu burada DEĞİL: public/room.js (Sosyal › Gruplarım › grup › İnterkom).
   Odadaki konuşma bilgisi window 'ml:room' {on, speaking} olayıyla gelir → müzik/radyo kısılır. Harita bağı: host üzerinde 'mm:ride' {on}, 'mm:speed' {kmh}. */
(function (root) {
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function mount(host, opts) {
    const o = opts || {}, AC = root.AudioCore, MD = root.MediaCore, ICON = (root.MotoMap && root.MotoMap.ICON) || {};
    const fetchF = o.fetchF || ((...a) => fetch(...a)), E = AC && AC.Events;
    const mm = host.querySelector('#mm'), side = host.querySelector('#mm-side'), bottom = host.querySelector('.mm-bottom');
    if (!AC || !MD || !mm || !side || !bottom) return { unavailable: true, destroy() {} };
    const core = AC.create(), $ = id => host.querySelector('#' + id), toast = m => { const t = host.querySelector('#mm-toast'); if (t) { t.textContent = m; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, 4000); } };
    // ---------- müzik oynatıcı ----------
    const au = new Audio(); au.preload = 'auto'; au.setAttribute('playsinline', '');
    // Radyo AYRI öğede çalar: Web Audio'ya bağlanmaz (kaynak sunucular CORS vermediği için Web Audio sessiz çıkar).
    const ra = new Audio(); ra.preload = 'none'; ra.setAttribute('playsinline', '');
    // iOS (Safari, Chrome, tüm iOS tarayıcıları = WebKit): <audio>.volume yazılabilir görünse bile SESİ DEĞİŞTİRMEZ → okuyarak güvenme, doğrudan iOS'u tanı.
    const IOS = (() => { try { const n = root.navigator || {}; return /iP(hone|ad|od)/.test(n.userAgent || '') || (n.platform === 'MacIntel' && n.maxTouchPoints > 1); } catch (e) { return false; } })();
    const raSettable = !IOS && (() => { try { ra.volume = 0.5; const ok = Math.abs(ra.volume - 0.5) < 0.01; ra.volume = 1; return ok; } catch (e) { return false; } })();   // iOS Safari'de volume salt okunur
    const el = () => (cur === 'radio' ? ra : au);
    // Kullanıcı ses düzeyi (uvol) × otomatik kısma (dv): iki çarpan ayrı tutulur, ikisi de her tarayıcıda çalışır.
    let uvol = 1, dv = 1, umuted = false;
    try { const sv = parseFloat(root.localStorage.getItem('ml_vol')); if (sv >= 0 && sv <= 1) uvol = sv; } catch (e) {}
    function applyVol() {
      const eff = Math.min(1, Math.max(0, dv * uvol));
      ytVol = Math.round(eff * 100); if (yt && yt.setVolume) { try { yt.setVolume(ytVol); umuted ? yt.mute() : yt.unMute(); } catch (e) {} }
      ensureGain(); if (gain) gain.gain.value = eff; else au.volume = eff; au.muted = umuted;
      if (raSettable) ra.volume = eff; ra.muted = umuted || (!raSettable && eff === 0);
    }
    const setUvol = v => { uvol = Math.min(1, Math.max(0, v)); try { root.localStorage.setItem('ml_vol', String(uvol)); } catch (e) {} if (uvol > 0) umuted = false; applyVol(); try { if (actx && actx.state === 'suspended') actx.resume(); } catch (e) {} };
    let gain = null, actx = null; const tracks = []; let idx = -1;
    function ensureGain() {                                              // iOS'ta <audio>.volume salt okunur → Web Audio kazancı
      if (gain || actx === false) return; if (!IOS) { au.volume = 0.5; if (Math.abs(au.volume - 0.5) < 0.01) { au.volume = 1; actx = false; return; } }
      try { const AC2 = root.AudioContext || root.webkitAudioContext; actx = new AC2(); const src = actx.createMediaElementSource(au); gain = actx.createGain(); src.connect(gain); gain.connect(actx.destination); } catch (e) { actx = false; }
    }
    let cur = null, yt = null, ytReady = null, ytPlaying = false, ytVol = 100, radio = null;   // cur: çalan kaynak 'file' | 'radio' | 'yt' | null
    const isPlaying = () => (cur === 'yt' ? ytPlaying : !!cur && !el().paused);
    const musicAdapter = {
      play() { if (cur === 'yt') { if (yt && yt.playVideo) yt.playVideo(); return; } const e = el(); if (e === au) { ensureGain(); if (actx && actx.resume) actx.resume(); } applyVol(); if (e.src) { const r = e.play(); if (r && r.catch) r.catch(() => {}); } },
      pause() { if (cur === 'yt') { if (yt && yt.pauseVideo) yt.pauseVideo(); } else el().pause(); },
      setVolume(v) { dv = Math.min(1, Math.max(0, v)); applyVol(); },
    };
    // Çalan kaynağı tamamen durdurur (ses kesilir, kaynak seçimi sıfırlanır). Dosya listesi korunur.
    function stopSource() {
      clearTimeout(rto); try { au.pause(); ra.pause(); } catch (e) {} if (cur === 'radio') { ra.removeAttribute('src'); try { ra.load(); } catch (e) {} }
      if (yt && yt.stopVideo) { try { yt.stopVideo(); } catch (e) {} } ytPlaying = false; cur = null; radio = null;
      core.dispatch({ type: E.MUSIC_WANTED, on: false }); paint();
    }
    function useSource(kind) { if (cur && cur !== kind) { try { au.pause(); ra.pause(); } catch (e) {} if (yt && yt.stopVideo) { try { yt.stopVideo(); } catch (e) {} } ytPlaying = false; } cur = kind; if (kind !== 'radio') radio = null; }
    function ytId(u) {
      const t = String(u || '').trim(); let m;
      if ((m = t.match(/[?&]list=([\w-]{10,})/)) && !/[?&]v=/.test(t)) return { list: m[1] };
      if ((m = t.match(/(?:youtu\.be\/|[?&]v=|\/shorts\/|\/embed\/|\/live\/)([\w-]{11})(?![\w-])/))) return { id: m[1] };
      return /^[\w-]{11}$/.test(t) ? { id: t } : null;
    }
    function loadYT() {
      if (ytReady) return ytReady;
      return (ytReady = new Promise((res, rej) => {
        if (root.YT && root.YT.Player) return res(root.YT);
        const prev = root.onYouTubeIframeAPIReady; root.onYouTubeIframeAPIReady = () => { if (prev) try { prev(); } catch (e) {} res(root.YT); };
        const sc = document.createElement('script'); sc.src = 'https://www.youtube.com/iframe_api'; sc.onerror = () => { ytReady = null; rej(new Error('YouTube yüklenemedi (çevrimiçi misin?)')); }; document.head.appendChild(sc);
      }));
    }
    async function playYT(link) {
      const k = ytId(link); if (!k) { toast('Geçerli bir YouTube bağlantısı gir.'); return; }
      try {
        const YT = await loadYT(); useSource('yt'); au.pause(); ra.pause();
        let box = host.querySelector('#mm-ytbox'); if (!box) { box = document.createElement('div'); box.id = 'mm-ytbox'; box.style.cssText = 'position:fixed;left:-9999px;top:0;width:200px;height:200px'; const d = document.createElement('div'); box.appendChild(d); (host.querySelector('#mm') || host).appendChild(box); }
        const onState = ev => { ytPlaying = ev.data === 1; if (ev.data === 0 && k.id) { ytPlaying = false; } paint(); };
        const onErr = () => { toast('Bu video burada oynatılamıyor (yayıncı izin vermemiş olabilir).'); stopSource(); };
        if (yt && yt.loadVideoById) { if (k.list) yt.loadPlaylist({ list: k.list }); else yt.loadVideoById(k.id); }
        else yt = new YT.Player(box.firstChild, { height: '200', width: '200', videoId: k.id, playerVars: Object.assign({ playsinline: 1, autoplay: 1 }, k.list ? { listType: 'playlist', list: k.list } : {}), events: { onReady: e => { try { e.target.setVolume(ytVol); e.target.playVideo(); } catch (x) {} }, onStateChange: onState, onError: onErr } });
        core.dispatch({ type: E.MUSIC_WANTED, on: true }); radioName = ''; ytName = k.id ? 'YouTube · ' + k.id : 'YouTube listesi'; paint();
      } catch (e) { toast(e.message || 'YouTube açılamadı'); }
    }
    let ytName = '', radioName = '';
    // ---- internet radyosu: ücretsiz, açık Radio Browser dizini (radio-browser.info) → Türkiye kanalları, A-Z
    const RB = o.radioUrl || 'https://de1.api.radio-browser.info/json/stations/search?countrycode=TR&hidebroken=true&is_https=true&order=clickcount&reverse=true&lastcheckok=1&limit=400';
    const RMAX = o.radioMax || 150;                                 // yalnız en popüler (tıklama sayısı) aktif kanallar
    const DEAD_KEY = 'ml_radio_dead', DEAD_TTL = 7 * 864e5; let dead = {};          // çalmayan kanallar bu cihazda 7 gün listeden gizlenir
    try { dead = JSON.parse(root.localStorage.getItem(DEAD_KEY) || '{}') || {}; } catch (e) { dead = {}; } Object.keys(dead).forEach(k => { if (Date.now() - dead[k] > DEAD_TTL) delete dead[k]; });
    const saveDead = () => { try { root.localStorage.setItem(DEAD_KEY, JSON.stringify(dead)); } catch (e) {} };
    let rto = null, rtries = 0;
    let radios = null, radioErr = '';
    let radioBusy = false;
    async function loadRadios() {
      if (radios !== null || radioBusy) return; radioBusy = true; radioErr = '';
      try {
        const r = await fetchF(RB, { headers: { Accept: 'application/json' } }); if (!r.ok) throw new Error('Kanal listesi alınamadı');
        const j = await r.json(), seen = new Set(), out = [];
        (Array.isArray(j) ? j : []).forEach(x => { const name = String(x.name || '').replace(/\s+/g, ' ').trim(), url = x.url_resolved || x.url || ''; if (!name || !/^https:\/\//i.test(url) || x.lastcheckok === 0 || dead[url]) return; const k = name.toLocaleLowerCase('tr'); if (seen.has(k)) return; seen.add(k); out.push({ name, url }); });
        out.length = Math.min(out.length, RMAX);      // API tıklama sırasıyla verir: ilk RMAX = en popüler
        out.sort((a, b) => a.name.localeCompare(b.name, 'tr')); radios = out;      // gösterim A-Z if (!out.length) radioErr = 'Kanal bulunamadı.';
      } catch (e) { radios = null; radioErr = 'Kanal listesi alınamadı. İnternetini kontrol edip tekrar dene.'; }
      radioBusy = false; paint();
    }
    // Çalmayan kanalı listeden çıkarır (7 gün), sıradakini dener; üst üste 3 kez başarısızsa durur.
    function radioFail() {
      clearTimeout(rto); const bad = radio; if (!bad || !radios) { stopSource(); return; }
      dead[bad.url] = Date.now(); saveDead(); const at = radios.indexOf(bad); if (at >= 0) radios.splice(at, 1); rlast = -1; radio = null;
      toast('«' + bad.name + '» çalmıyor, listeden çıkarıldı.'); rtries++;
      if (rtries >= 3 || !radios.length) { rtries = 0; stopSource(); return; }
      playRadio(Math.min(Math.max(at, 0), radios.length - 1));
    }
    function playRadio(i) {
      const c = radios && radios[i]; if (!c) return; useSource('radio'); radio = c; rlast = i; radioName = c.name; ytName = '';
      au.pause(); ra.src = c.url; clearTimeout(rto); rto = setTimeout(() => { if (cur === 'radio' && radio === c && !ra.paused) radioFail(); }, 15000); core.dispatch({ type: E.MUSIC_WANTED, on: true }); musicAdapter.play(); paint();
    }

    function loadTrack(i, autoplay) { if (!tracks.length) return; useSource('file'); idx = (i + tracks.length) % tracks.length; au.src = tracks[idx].url; paint(); if (autoplay) { core.dispatch({ type: E.MUSIC_WANTED, on: true }); musicAdapter.play(); } }
    au.addEventListener('ended', () => { if (cur === 'file') loadTrack(idx + 1, true); });
    ra.addEventListener('error', () => { if (cur === 'radio') radioFail(); });
    ra.addEventListener('playing', () => { clearTimeout(rto); rtries = 0; });
    [au, ra].forEach(x => { x.addEventListener('playing', () => paint()); x.addEventListener('pause', () => paint()); });
    // ---------- iletişim ----------
    let ride = false, roomOn = false, kmh = null;      // grup interkom odası artık ayrı modül (room.js); burada yalnız 'ml:room' olayıyla öncelik/kısma bilgisi alınır
    const noop = { play() {}, pause() {}, setVolume() {} };
    const bind = MD.bind(core, { music: musicAdapter, intercom: noop, phone: noop, assistant: noop }, { now: () => Date.now() }); bind.start(40);
    function recompute() { const want = roomOn ? 'G' : ride ? 'S' : 'I'; core.dispatch({ type: want === 'G' ? E.START_GROUP : want === 'S' ? E.START_SOLO : E.END_RIDE }); }
    // ---------- arayüz ----------
    const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'mm-btn'; btn.id = 'mm-icbtn'; btn.setAttribute('aria-label', 'Müzik ve Radyo'); btn.innerHTML = ICON.music || '♪';
    side.insertBefore(btn, $('mm-mbtn'));
    const strip = document.createElement('div'); strip.className = 'mm-icstrip'; strip.id = 'mm-icstrip'; strip.hidden = true; bottom.insertBefore(strip, bottom.firstChild);
    const sheet = document.createElement('div'); sheet.className = 'mm-gsheet mm-icsheet'; sheet.id = 'mm-icsheet'; sheet.hidden = true; mm.appendChild(sheet);
    let view = 'home', lastView = '', open = false, rq = '', rlast = -1;
    function stripHtml() {
      if (!cur) return '';
      const mu = '<small>' + (cur === 'radio' ? '📻 ' + esc(radioName) : cur === 'yt' ? '▶ ' + esc(ytName) : '♪ ' + esc(tracks[idx] ? tracks[idx].name : '')) + '</small>';
      return '<div class="mm-icmid"><b>' + (cur === 'radio' ? 'Radyo' : 'Müzik') + '</b>' + mu + '</div>'
        + '<button type="button" class="mm-icmini" id="mm-icpp" aria-label="Çal / Duraklat">⏯</button>' + (cur === 'file' ? '<button type="button" class="mm-icmini" id="mm-icnext" aria-label="Sonraki">⏭</button>' : '') + '<button type="button" class="mm-icmini" id="mm-icstop" aria-label="Yayını durdur">⏹</button>';
    }
    // ---------- panel: ana ekran (3 kutu) → ayrıntı ekranları; sabit boyutlu, yalnız iç liste kayar ----------
    const rIdx = () => (radios && rlast >= 0 && rlast < radios.length ? rlast : -1);
    function rlistHtml() {
      if (!radios) return '<p class="mm-icnote">' + (radioErr ? esc(radioErr) : 'Kanallar yükleniyor…') + '</p>' + (radioErr ? '<button type="button" class="mm-icbig sec" id="mm-icrretry">Tekrar Dene</button>' : '');
      const q = rq.trim().toLocaleLowerCase('tr'); let last = '', h = '';
      radios.forEach((c, i) => { if (q && !c.name.toLocaleLowerCase('tr').includes(q)) return; const L = c.name.charAt(0).toLocaleUpperCase('tr'); if (L !== last) { last = L; h += '<li class="mm-icletter">' + esc(L) + '</li>'; }
        h += '<li><button type="button" data-ri="' + i + '" class="' + (radio && radio.name === c.name ? 'cur' : '') + '">' + esc(c.name) + '</button></li>'; });
      return h ? '<ul class="mm-icrl">' + h + '</ul>' : '<p class="mm-icnote">Eşleşen kanal yok.</p>';
    }
    const head = (title, back) => '<div class="mm-gh">' + (back ? '<button type="button" class="mm-icback" id="mm-icback" aria-label="Geri">←</button>' : '') + '<span>' + title + '</span><button type="button" class="mm-gx" id="mm-icx" aria-label="Kapat">✕</button></div>';
    function sheetHtml() {
      if (view === 'home') {
        const musicTxt = cur === 'file' || cur === 'yt' ? esc(cur === 'yt' ? ytName : (tracks[idx] ? tracks[idx].name : '')) : 'Kapalı', radioTxt = cur === 'radio' ? esc(radioName) : 'Kapalı';
        return head('Müzik ve Radyo', false) + '<div class="mm-icbody"><div class="mm-ictiles"><div class="mm-ictile' + (cur === 'file' || cur === 'yt' ? ' on' : '') + '"><button type="button" class="mm-ictile-b" data-v="mu"><i>♪</i><b>Müzik</b><small>' + musicTxt + '</small></button>' + (cur === 'file' || cur === 'yt' ? '<button type="button" class="mm-ictile-x" id="mm-icstop2" aria-label="Müziği durdur">⏹</button>' : '') + '</div>'
          + '<div class="mm-ictile' + (cur === 'radio' ? ' on' : '') + '"><button type="button" class="mm-ictile-b" data-v="ra"><i>📻</i><b>Radyo</b><small>' + radioTxt + '</small></button>' + (cur === 'radio' ? '<button type="button" class="mm-ictile-x" id="mm-icstop2" aria-label="Radyoyu durdur">⏹</button>' : '') + '</div></div>'
          + '<p class="mm-icnote">Biri konuşurken müzik/radyo kısılır, telefon çalınca durur ve arama bitince kendiliğinden devam eder. Grup interkomu: Sosyal › Gruplarım › (grup) › İnterkom.</p></div>';
      }
      if (view === 'list') return head('Tüm kanallar', true) + '<div class="mm-icbody mm-icfullbody"><input type="search" id="mm-icq" class="mm-icq" placeholder="Kanal ara" value="' + esc(rq) + '" autocomplete="off" enterkeyhint="search"><div id="mm-rlist" class="mm-rlistwrap">' + rlistHtml() + '</div></div>';
      let body = '';
      if (view === 'ra') {
        const n = radios ? radios.length : 0, i = rIdx(), on = cur === 'radio';
        const nm = on ? radioName : i >= 0 ? radios[i].name : radios === null && !radioErr ? 'Yükleniyor…' : n ? 'Kanal seç' : 'Kanal yok';
        return head('Radyo', true) + '<div class="mm-icbody mm-icradio"><div class="mm-icname">' + esc(nm) + '</div><div class="mm-icsub">' + (n ? (i >= 0 ? (i + 1) + ' / ' + n : n + ' kanal') + (on ? ' · Çalıyor' : '') : esc(radioErr || ' ')) + '</div>'
          + '<div class="mm-iczap"><button type="button" id="mm-rprev" aria-label="Önceki kanal">◀</button><button type="button" id="mm-rpp" class="pp" aria-label="Çal / Duraklat">' + (on && isPlaying() ? '⏸' : '▶') + '</button><button type="button" id="mm-rnext" aria-label="Sonraki kanal">▶</button></div>'
          + '<div class="mm-iczrow"><button type="button" class="mm-icbig sec" data-v="list">☰ Tüm kanallar</button><button type="button" class="mm-icbig sec" id="mm-icstop2">⏹ Durdur</button></div>'
          + (radioErr ? '<button type="button" class="mm-icbig sec" id="mm-icrretry">Tekrar Dene</button>' : '<p class="mm-icnote">Türkiye\'nin en çok dinlenen, şu an yayında olan ücretsiz kanalları (radio-browser.info), A-Z. Çalmayan kanal listeden otomatik çıkar. Yayın internet verisi kullanır.</p>') + '</div>' + volHtml() + (cur === 'radio' ? exitHtml() : '');
      }
      body = '<label class="mm-icbig" for="mm-icfiles">Müzik Dosyası Seç</label><input type="file" id="mm-icfiles" accept="audio/*" multiple hidden>'
        + (tracks.length ? '<div class="mm-icrow"><div>Çalıyor<small>' + esc(tracks[idx] ? tracks[idx].name : '') + '</small></div><div class="mm-icctl"><button type="button" class="mm-icmini" id="mm-icprev" aria-label="Önceki">⏮</button><button type="button" class="mm-icmini" id="mm-icpp2" aria-label="Çal / Durdur">⏯</button><button type="button" class="mm-icmini" id="mm-icnext2" aria-label="Sonraki">⏭</button></div></div>'
          + '<ul class="mm-iclist">' + tracks.map((t, i) => '<li><button type="button" data-ti="' + i + '" class="' + (i === idx ? 'cur' : '') + '">' + esc(t.name) + '</button></li>').join('') + '</ul>' : '<p class="mm-icnote">Telefondaki müzik dosyalarını seç.</p>')
        + '<div class="mm-icyt"><input type="url" id="mm-icyt" inputmode="url" placeholder="YouTube bağlantısı yapıştır" autocomplete="off"><button type="button" class="mm-icytb" id="mm-icytgo" aria-label="YouTube bağlantısını çal">Çal</button>' + (cur === 'yt' ? '<button type="button" class="mm-icytb pp" id="mm-ytpp" aria-label="' + (ytPlaying ? 'Duraklat' : 'Devam ettir') + '">' + (ytPlaying ? '⏸' : '▶') + '</button>' : '') + '</div>';
      return head('Müzik', true) + '<div class="mm-icbody">' + body + '</div>' + volHtml() + (cur === 'file' || cur === 'yt' ? exitHtml() : '');
    }
    const exitHtml = () => '<button type="button" class="mm-icexit" id="mm-icexit">⏏ Yayından Çık</button>';
    function volHtml() {
      const pct = Math.round(uvol * 100), mu = '<button type="button" id="mm-vmute" class="' + (umuted ? 'on' : '') + '" aria-label="' + (umuted ? 'Sesi aç' : 'Sessiz') + '">' + (umuted ? '🔇' : '🔊') + '</button>';
      if ((view === 'ra' || (view === 'mu' && cur === 'yt')) && !raSettable)      // iPhone/Safari: sayfa radyo ve YouTube ses düzeyini değiştiremez (YouTube iframe'i iOS'ta setVolume'u yok sayar) → çalışmayan düğme göstermiyoruz; yönlendiriyoruz
        return '<div class="mm-icvol"><div class="mm-icvolr mm-ichw"><div class="mm-ichwt"><b>📱 Ses: telefonun yan tuşları</b><small>iPhone\'da bu yayının sesi fiziksel ses tuşlarıyla ayarlanır</small></div>' + mu + '</div></div>';
      return '<div class="mm-icvol"><div class="mm-icvolr"><button type="button" id="mm-vdn" aria-label="Sesi kıs">−</button><input type="range" id="mm-vol" min="0" max="100" step="5" value="' + pct + '" aria-label="Ses düzeyi"><button type="button" id="mm-vup" aria-label="Sesi aç">+</button>'
        + mu + '</div><small id="mm-vpct">Ses %' + (umuted ? 0 : pct) + '</small></div>';
    }
    function go(v) { view = v; if ((v === 'ra' || v === 'list') && radios === null) loadRadios(); if (v === 'list') rq = ''; paint(); }
    function zap(d) { if (!radios || !radios.length) { loadRadios(); return; } const n = radios.length, i = rIdx(); playRadio(i < 0 ? 0 : (i + d + n) % n); }
    function paint() {
      btn.classList.toggle('on', !!cur); const h = stripHtml(); strip.hidden = !h; strip.innerHTML = h; sheet.hidden = !open; sheet.classList.toggle('mm-icfull', open && view === 'list'); if (open) { const keep = sheet.querySelector('.mm-icbody'), st = keep ? keep.scrollTop : 0; sheet.innerHTML = sheetHtml(); const nb = sheet.querySelector('.mm-icbody'); if (nb && lastView === view) nb.scrollTop = st; lastView = view; }
    }
    const toggleMusic = () => { const w = core.ctx.musicWanted; if (w && isPlaying()) { core.dispatch({ type: E.MUSIC_WANTED, on: false }); } else { core.dispatch({ type: E.MUSIC_WANTED, on: true }); musicAdapter.play(); } paint(); };
    btn.addEventListener('click', () => { open = !open; view = 'home'; paint(); });
    strip.addEventListener('click', e => { const t = e.target.closest('button'); if (!t) return; if (t.id === 'mm-icpp') toggleMusic(); else if (t.id === 'mm-icnext') loadTrack(idx + 1, true); else if (t.id === 'mm-icstop') stopSource(); });
    sheet.addEventListener('click', e => {
      const t = e.target.closest('button'); if (!t) return;
      if (t.id === 'mm-icx') { open = false; view = 'home'; paint(); }
      else if (t.id === 'mm-icback') go(view === 'list' ? 'ra' : 'home');
      else if (t.dataset.v) go(t.dataset.v);
      else if (t.dataset.ri != null) { playRadio(Number(t.dataset.ri)); view = 'ra'; paint(); }
      else if (t.id === 'mm-vdn' || t.id === 'mm-vup') { setUvol(Math.round((uvol + (t.id === 'mm-vup' ? 0.1 : -0.1)) * 20) / 20); vpaint(); }
      else if (t.id === 'mm-vmute') { umuted = !umuted; applyVol(); paint(); }
      else if (t.id === 'mm-rprev') zap(-1); else if (t.id === 'mm-rnext') zap(1);
      else if (t.id === 'mm-rpp') { if (cur === 'radio') toggleMusic(); else if (radios && radios.length) playRadio(rIdx() < 0 ? 0 : rIdx()); else loadRadios(); }
      else if (t.id === 'mm-icrretry') { radios = null; loadRadios(); paint(); }
      else if (t.id === 'mm-icexit') { stopSource(); view = 'home'; paint(); }
      else if (t.id === 'mm-ytpp') toggleMusic();
      else if (t.id === 'mm-icstop2') stopSource(); else if (t.id === 'mm-icytgo') { const v = sheet.querySelector('#mm-icyt'); playYT(v && v.value); }
      else if (t.id === 'mm-icpp2') toggleMusic(); else if (t.id === 'mm-icnext2') loadTrack(idx + 1, true); else if (t.id === 'mm-icprev') loadTrack(idx - 1, true);
      else if (t.dataset.ti != null) loadTrack(Number(t.dataset.ti), true);
    });
    function vpaint() { const r = sheet.querySelector('#mm-vol'), l = sheet.querySelector('#mm-vpct'), m = sheet.querySelector('#mm-vmute'); if (r) r.value = Math.round(uvol * 100); if (l) l.textContent = 'Ses %' + (umuted ? 0 : Math.round(uvol * 100)); if (m) { m.textContent = umuted ? '🔇' : '🔊'; m.classList.toggle('on', umuted); } }
    sheet.addEventListener('input', e => { if (e.target.id === 'mm-vol') { setUvol(Number(e.target.value) / 100); vpaint(); return; } if (e.target.id !== 'mm-icq') return; rq = e.target.value; const l = sheet.querySelector('#mm-rlist'); if (l) l.innerHTML = rlistHtml(); });
    sheet.addEventListener('change', e => {
      if (e.target.id !== 'mm-icfiles') return; const fs = [...e.target.files].filter(f => /^audio\//.test(f.type) || /\.(mp3|m4a|aac|wav|ogg|flac)$/i.test(f.name)); if (!fs.length) return;
      const first = tracks.length; fs.forEach(f => tracks.push({ name: f.name.replace(/\.[^.]+$/, ''), url: URL.createObjectURL(f) })); loadTrack(idx < 0 ? 0 : first, true);
    });
    // ---------- harita olayları ----------
    host.addEventListener('mm:ride', e => { ride = !!(e.detail && e.detail.on); recompute(); });
    host.addEventListener('mm:speed', e => { kmh = e.detail ? e.detail.kmh : null; bind.setSpeed(kmh); });
    const onRoom = e => { const d = e.detail || {}; if ('on' in d) { roomOn = !!d.on; recompute(); } if ('speaking' in d) core.dispatch({ type: E.SPEECH, on: !!d.speaking }); };
    root.addEventListener('ml:room', onRoom);
    paint();
    return {
      core, setSpeed: v => bind.setSpeed(v), callStarted: () => core.dispatch({ type: E.CALL_START }), callEnded: () => core.dispatch({ type: E.CALL_END }),   // native/telefon köprüsü bunları çağıracak
      destroy() { root.removeEventListener('ml:room', onRoom); bind.stop(); au.pause(); ra.pause(); if (yt && yt.destroy) { try { yt.destroy(); } catch (e) {} } tracks.forEach(t => URL.revokeObjectURL(t.url)); btn.remove(); strip.remove(); sheet.remove(); },
    };
  }
  root.Intercom = { mount };
})(typeof window !== 'undefined' ? window : globalThis);
