'use strict';
/* İNTERKOM + MÜZİK arayüzü (harita ekranı). Çekirdekler: AudioCore (durum/öncelik), MediaCore (geçiş/kısma), CommCore (+LiveKitAdapter).
   Yerleşim: sağ düğme sütununda «İnterkom ve Müzik» düğmesi; alt panelin üstünde kompakt şerit (mikrofon, durum, müzik ⏯ ⏭); düğmeye basınca alt sayfa (İnterkom | Müzik).
   Tek sürüş: yalnız müzik. Grup: Sosyal'deki sürüş gruplarından biri seçilir → LiveKit odası «ml-<grup>» (belirteç sunucudan; anahtar istemcide YOK).
   Harita bağı: host üzerinde 'mm:ride' {on} ve 'mm:speed' {kmh} olayları. livekit-client yalnız gruba bağlanırken CDN'den (sabit sürüm) yüklenir.
   TEST EDİLMEDİ: gerçek LiveKit sunucusu/gerçek mikrofon/Bluetooth. */
(function (root) {
  const LK_URL = 'https://cdn.jsdelivr.net/npm/livekit-client@2.5.7/dist/livekit-client.umd.js';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function loadLK() {
    if (root.LivekitClient) return Promise.resolve(root.LivekitClient);
    return new Promise((res, rej) => { const s = document.createElement('script'); s.src = LK_URL; s.onload = () => (root.LivekitClient ? res(root.LivekitClient) : rej(new Error('LiveKit yüklenemedi'))); s.onerror = () => rej(new Error('LiveKit yüklenemedi (internet?)')); document.head.appendChild(s); });
  }
  function mount(host, opts) {
    const o = opts || {}, AC = root.AudioCore, MD = root.MediaCore, CC = root.CommCore, LA = root.LiveKitAdapter, MA = root.MeshAdapter, ICON = (root.MotoMap && root.MotoMap.ICON) || {};
    const fetchF = o.fetchF || ((...a) => fetch(...a)), loadLib = o.loadLK || loadLK, E = AC && AC.Events;
    const mm = host.querySelector('#mm'), side = host.querySelector('#mm-side'), bottom = host.querySelector('.mm-bottom');
    if (!AC || !MD || !CC || !LA || !mm || !side || !bottom) return { unavailable: true, destroy() {} };
    const core = AC.create(), $ = id => host.querySelector('#' + id), toast = m => { const t = host.querySelector('#mm-toast'); if (t) { t.textContent = m; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, 4000); } };
    // ---------- müzik oynatıcı ----------
    const au = new Audio(); au.preload = 'auto'; au.setAttribute('playsinline', '');
    let gain = null, actx = null; const tracks = []; let idx = -1;
    function ensureGain() {                                              // iOS'ta <audio>.volume salt okunur → Web Audio kazancı
      if (gain || actx === false) return; au.volume = 0.5; if (Math.abs(au.volume - 0.5) < 0.01) { au.volume = 1; actx = false; return; }
      try { const AC2 = root.AudioContext || root.webkitAudioContext; actx = new AC2(); const src = actx.createMediaElementSource(au); gain = actx.createGain(); src.connect(gain); gain.connect(actx.destination); } catch (e) { actx = false; }
    }
    let cur = null, yt = null, ytReady = null, ytPlaying = false, ytVol = 100, radio = null;   // cur: çalan kaynak 'file' | 'radio' | 'yt' | null
    const isPlaying = () => (cur === 'yt' ? ytPlaying : !!cur && !au.paused);
    const musicAdapter = {
      play() { if (cur === 'yt') { if (yt && yt.playVideo) yt.playVideo(); return; } ensureGain(); if (actx && actx.resume) actx.resume(); if (au.src) { const r = au.play(); if (r && r.catch) r.catch(() => {}); } },
      pause() { if (cur === 'yt') { if (yt && yt.pauseVideo) yt.pauseVideo(); } else au.pause(); },
      setVolume(v) { ytVol = Math.round(Math.min(1, Math.max(0, v)) * 100); if (yt && yt.setVolume) yt.setVolume(ytVol); ensureGain(); if (gain) gain.gain.value = v; else au.volume = Math.min(1, Math.max(0, v)); },
    };
    // Çalan kaynağı tamamen durdurur (ses kesilir, kaynak seçimi sıfırlanır). Dosya listesi korunur.
    function stopSource() {
      try { au.pause(); } catch (e) {} if (cur === 'radio') { au.removeAttribute('src'); try { au.load(); } catch (e) {} }
      if (yt && yt.stopVideo) { try { yt.stopVideo(); } catch (e) {} } ytPlaying = false; cur = null; radio = null;
      core.dispatch({ type: E.MUSIC_WANTED, on: false }); paint();
    }
    function useSource(kind) { if (cur && cur !== kind) { try { au.pause(); } catch (e) {} if (yt && yt.stopVideo) { try { yt.stopVideo(); } catch (e) {} } ytPlaying = false; } cur = kind; if (kind !== 'radio') radio = null; }
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
        const YT = await loadYT(); useSource('yt'); if (au) au.pause();
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
    const RB = o.radioUrl || 'https://de1.api.radio-browser.info/json/stations/search?countrycode=TR&hidebroken=true&is_https=true&order=name&limit=600';
    let radios = null, radioErr = '';
    let radioBusy = false;
    async function loadRadios() {
      if (radios !== null || radioBusy) return; radioBusy = true; radioErr = '';
      try {
        const r = await fetchF(RB, { headers: { Accept: 'application/json' } }); if (!r.ok) throw new Error('Kanal listesi alınamadı');
        const j = await r.json(), seen = new Set(), out = [];
        (Array.isArray(j) ? j : []).forEach(x => { const name = String(x.name || '').replace(/\s+/g, ' ').trim(), url = x.url_resolved || x.url || ''; if (!name || !/^https:\/\//i.test(url)) return; const k = name.toLocaleLowerCase('tr'); if (seen.has(k)) return; seen.add(k); out.push({ name, url }); });
        out.sort((a, b) => a.name.localeCompare(b.name, 'tr')); radios = out; if (!out.length) radioErr = 'Kanal bulunamadı.';
      } catch (e) { radios = null; radioErr = 'Kanal listesi alınamadı. İnternetini kontrol edip tekrar dene.'; }
      radioBusy = false; paint();
    }
    function playRadio(i) {
      const c = radios && radios[i]; if (!c) return; useSource('radio'); radio = c; radioName = c.name; ytName = '';
      ensureGain(); au.src = c.url; core.dispatch({ type: E.MUSIC_WANTED, on: true }); musicAdapter.play(); rmenu = false; paint();
    }

    function loadTrack(i, autoplay) { if (!tracks.length) return; useSource('file'); idx = (i + tracks.length) % tracks.length; au.src = tracks[idx].url; paint(); if (autoplay) { core.dispatch({ type: E.MUSIC_WANTED, on: true }); musicAdapter.play(); } }
    au.addEventListener('ended', () => { if (cur === 'file') loadTrack(idx + 1, true); });
    au.addEventListener('error', () => { if (cur === 'radio') { toast('Bu kanal şu an çalmıyor. Başka kanal dene.'); stopSource(); } });
    au.addEventListener('playing', () => paint()); au.addEventListener('pause', () => paint());
    // ---------- iletişim ----------
    let mode = '', ride = false, gid = null, gname = '', svc = null, comm = null, tr = null, state = 'off', speakers = [], groups = null, kmh = null;
    const voice = { play() {}, pause() {}, setVolume(v) { if (tr && tr.setVolume) tr.setVolume(v); } }, noop = { play() {}, pause() {}, setVolume() {} };
    const bind = MD.bind(core, { music: musicAdapter, intercom: voice, phone: noop, assistant: noop }, { now: () => Date.now() }); bind.start(40);
    function recompute() { const want = gid ? 'G' : ride ? 'S' : 'I'; core.dispatch({ type: want === 'G' ? E.START_GROUP : want === 'S' ? E.START_SOLO : E.END_RIDE }); }
    async function join(g) {
      if (gid) return; state = 'connecting'; gid = g.id; gname = g.name; speakers = []; paint();
      try {
        // Önce LiveKit belirteci denenir; sunucuda LiveKit yapılandırılmamışsa (503) ya da kütüphane yüklenemezse WebRTC mesh yedeğine geçilir.
        const tokReq = async () => { const r = await fetchF('/api/livekit/token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ gid: g.id }) }); const j = await r.json().catch(() => ({})); return { r, j }; };
        let first = null, useLK = false; try { first = await tokReq(); } catch (e) { first = null; }
        if (first && first.r.ok) useLK = true; else if (first && first.r.status !== 503) throw new Error((first.j && first.j.error) || 'İnterkom açılamadı');
        let LK = null; if (useLK) { try { LK = await loadLib(); } catch (e) { useLK = false; } }
        if (useLK) {
          const getToken = async () => { const x = first || await tokReq(); first = null; if (!x.r.ok) throw new Error((x.j && x.j.error) || 'İnterkom belirteci alınamadı'); return x.j; };
          tr = LA.createLiveKitTransport({ Room: LK.Room, RoomEvent: LK.RoomEvent, getToken }); mode = 'livekit';
        } else {
          if (!MA || !o.socket) throw new Error('İnterkom bu sunucuda kullanılamıyor.');
          tr = MA.createMeshTransport({ sock: o.socket, gid: g.id, onFatal: m => { toast(m); leave(); } }); mode = 'mesh';
        }
        svc = CC.createGroupService(tr);
        svc.on('state', st => { state = st === 'connected' ? 'on' : st === 'reconnecting' ? 'connecting' : gid ? 'connecting' : 'off'; paint(); });
        svc.on('speakers', ids => { speakers = (ids && ids.names) || ids || []; paint(); });
        comm = CC.bindComms(core, svc, { online: () => navigator.onLine !== false, onError: e => { toast(e && e.message ? e.message : 'İnterkom hatası'); } });
        recompute();
      } catch (e) { toast(e.message || 'İnterkom açılamadı'); await leave(); }
    }
    async function leave() { const c = comm; gid = null; gname = ''; state = 'off'; speakers = []; recompute(); if (c) setTimeout(() => c.stop(), 0); comm = null; svc = null; tr = null; paint(); }
    // ---------- arayüz ----------
    const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'mm-btn'; btn.id = 'mm-icbtn'; btn.setAttribute('aria-label', 'İnterkom ve Müzik'); btn.innerHTML = ICON.headset || 'İK';
    side.insertBefore(btn, $('mm-mbtn'));
    const strip = document.createElement('div'); strip.className = 'mm-icstrip'; strip.id = 'mm-icstrip'; strip.hidden = true; bottom.insertBefore(strip, bottom.firstChild);
    const sheet = document.createElement('div'); sheet.className = 'mm-gsheet mm-icsheet'; sheet.id = 'mm-icsheet'; sheet.hidden = true; mm.appendChild(sheet);
    let tab = 'ic', open = false, menu = false, rmenu = false;
    const TABS = { ic: 'İnterkom', mu: 'Müzik', ra: 'İnternet Radyosu' };
    const micOn = () => svc && !svc.muted;
    function stripHtml() {
      const conn = !!gid, hasTrack = !!cur; if (!conn && !hasTrack) return '';
      const sp = speakers.length ? '<small class="sp">🔊 ' + esc(speakers.join(', ')) + ' konuşuyor</small>' : '';
      const st = conn ? '<b>' + esc(gname) + '</b><small>' + (state === 'on' ? 'Bağlı' : 'Bağlanıyor…') + '</small>' + sp : '<b>' + (cur === 'radio' ? 'Radyo' : 'Müzik') + '</b>';
      const mu = hasTrack ? '<small>' + (cur === 'radio' ? '📻 ' + esc(radioName) : cur === 'yt' ? '▶ ' + esc(ytName) : '♪ ' + esc(tracks[idx] ? tracks[idx].name : '')) + '</small>' : '';
      return (conn ? '<button type="button" class="mm-icmic' + (micOn() ? '' : ' mute') + '" id="mm-icmic" aria-label="' + (micOn() ? 'Mikrofonu kapat' : 'Mikrofonu aç') + '">' + (micOn() ? ICON.mic : ICON.micoff) + '</button>' : '')
        + '<div class="mm-icmid">' + st + mu + '</div>'
        + (hasTrack ? '<button type="button" class="mm-icmini" id="mm-icpp" aria-label="Çal / Duraklat">⏯</button>' + (cur === 'file' ? '<button type="button" class="mm-icmini" id="mm-icnext" aria-label="Sonraki">⏭</button>' : '') + '<button type="button" class="mm-icmini" id="mm-icstop" aria-label="Yayını durdur">⏹</button>' : '')
        + (conn ? '<button type="button" class="mm-icmini" id="mm-icleave1" aria-label="İnterkomdan ayrıl">✕</button>' : '');
    }
    function sheetHtml() {
      const tabs = '<div class="mm-icsel"><button type="button" class="mm-icsel-b" id="mm-icmenu" aria-expanded="' + menu + '"><b>' + TABS[tab] + '</b><span>▾</span></button>'
        + (menu ? '<ul class="mm-icdrop">' + Object.keys(TABS).map(k => '<li><button type="button" data-t="' + k + '" class="' + (k === tab ? 'a' : '') + '">' + TABS[k] + '</button></li>').join('') + '</ul>' : '') + '</div>';
      let body = '';
      if (tab === 'ic') {
        if (gid) body = '<div class="mm-icrow"><div>Grup<small>' + esc(gname) + (mode === 'mesh' ? ' · doğrudan (P2P)' : '') + '</small></div><span class="mm-icpill">' + (state === 'on' ? 'Bağlı' : 'Bağlanıyor…') + '</span></div>'
          + '<div class="mm-icrow"><div>Mikrofon<small>' + (micOn() ? 'Açık' : 'Kapalı') + '</small></div></div>'
          + '<button type="button" class="mm-icbig" id="mm-icmic2">' + (micOn() ? 'Mikrofonu Kapat' : 'Mikrofonu Aç') + '</button><button type="button" class="mm-icbig sec" id="mm-icleave">Gruptan Ayrıl</button>'
          + '<p class="mm-icnote">Telefon aramasında gruptan çıkılmaz; ses ve mikrofon duraklar, arama bitince kendiliğinden döner.</p>';
        else if (groups === null) body = '<p class="mm-icnote">Gruplar yükleniyor…</p>';
        else if (!groups.length) body = '<p class="mm-icnote">Henüz bir sürüş grubun yok. Sosyal › Gruplarım bölümünden grup kur ya da davet koduyla katıl. Tek sürüşte yalnız müzik çalar.</p>';
        else body = '<p class="mm-icnote">Tek sürüşte yalnız müzik çalar. Grup interkomu için bir grup seç:</p>' + groups.map(g => '<button type="button" class="mm-icgrp" data-g="' + esc(g.id) + '"><b>' + esc(g.name) + '</b><small>' + esc(g.count) + ' üye</small></button>').join('');
      } else if (tab === 'ra') {
        const st = cur === 'radio' ? '<div class="mm-icrow"><div>Çalıyor<small>' + esc(radioName) + '</small></div><div class="mm-icctl"><button type="button" class="mm-icmini" id="mm-icpp2" aria-label="Çal / Duraklat">⏯</button><button type="button" class="mm-icmini" id="mm-icstop2" aria-label="Yayını durdur">⏹</button></div></div>' : '';
        const lab = radio ? radio.name : radios === null && !radioErr ? 'Kanallar yükleniyor…' : radios && radios.length ? 'Kanal seç (' + radios.length + ')' : 'Kanal listesi yok';
        body = st + '<div class="mm-icsel"><button type="button" class="mm-icsel-b" id="mm-icrmenu" aria-expanded="' + rmenu + '"><b>' + esc(lab) + '</b><span>▾</span></button>'
          + (rmenu && radios && radios.length ? '<ul class="mm-icdrop mm-icdrop-r">' + radios.map((c, i) => '<li><button type="button" data-ri="' + i + '" class="' + (radio && radio.name === c.name ? 'a' : '') + '">' + esc(c.name) + '</button></li>').join('') + '</ul>' : '') + '</div>'
          + (radioErr ? '<p class="mm-icnote">' + esc(radioErr) + '</p><button type="button" class="mm-icbig sec" id="mm-icrretry">Tekrar Dene</button>' : '<p class="mm-icnote">Türkiye\'deki ücretsiz, açık yayın yapan kanallar (radio-browser.info dizini), A-Z. Yayın internet verisi kullanır.</p>');
      } else {
        body = (cur ? '<button type="button" class="mm-icbig sec" id="mm-icstop2">Müzik Yayınını Durdur</button>' : '') + '<label class="mm-icbig" for="mm-icfiles">Müzik Dosyası Seç</label><input type="file" id="mm-icfiles" accept="audio/*" multiple hidden>'
          + (tracks.length ? '<div class="mm-icrow"><div>Çalıyor<small>' + esc(tracks[idx] ? tracks[idx].name : '') + '</small></div><div class="mm-icctl"><button type="button" class="mm-icmini" id="mm-icprev" aria-label="Önceki">⏮</button><button type="button" class="mm-icmini" id="mm-icpp2" aria-label="Çal / Durdur">⏯</button><button type="button" class="mm-icmini" id="mm-icnext2" aria-label="Sonraki">⏭</button></div></div>'
            + '<ul class="mm-iclist">' + tracks.map((t, i) => '<li><button type="button" data-ti="' + i + '" class="' + (i === idx ? 'cur' : '') + '">' + esc(t.name) + '</button></li>').join('') + '</ul>' : '<p class="mm-icnote">Telefondaki müzik dosyalarını seç. Biri konuşurken müzik kısılır, telefon çalınca durur ve arama bitince kendiliğinden devam eder.</p>')
          + '<div class="mm-icyt"><input type="url" id="mm-icyt" inputmode="url" placeholder="YouTube bağlantısı yapıştır" autocomplete="off"><button type="button" class="mm-icmini" id="mm-icytgo" aria-label="YouTube\'u çal">▶</button></div>';
      }
      return '<div class="mm-gh"><span>İnterkom · Müzik · Radyo</span><button type="button" class="mm-gx" id="mm-icx" aria-label="Kapat">✕</button></div>' + tabs + body;
    }
    function paint() {
      btn.classList.toggle('on', !!gid || tracks.length > 0); const h = stripHtml(); strip.hidden = !h; strip.innerHTML = h; sheet.hidden = !open; if (open) sheet.innerHTML = sheetHtml();
    }
    async function loadGroups() { try { const r = await fetchF('/api/rgroups'); const j = await r.json(); groups = Array.isArray(j.groups) ? j.groups : []; } catch (e) { groups = []; } paint(); }
    const toggleMic = () => { if (!svc) return; if (svc.muted) svc.unmute(); else svc.mute(); paint(); };
    const toggleMusic = () => { const w = core.ctx.musicWanted; if (w && isPlaying()) { core.dispatch({ type: E.MUSIC_WANTED, on: false }); } else { core.dispatch({ type: E.MUSIC_WANTED, on: true }); musicAdapter.play(); } paint(); };
    btn.addEventListener('click', () => { open = !open; menu = false; rmenu = false; if (open && groups === null) loadGroups(); if (open && tab === 'ra') loadRadios(); paint(); });
    strip.addEventListener('click', e => { const t = e.target.closest('button'); if (!t) return; if (t.id === 'mm-icmic') toggleMic(); else if (t.id === 'mm-icpp') toggleMusic(); else if (t.id === 'mm-icnext') loadTrack(idx + 1, true); else if (t.id === 'mm-icstop') stopSource(); else if (t.id === 'mm-icleave1') leave(); });
    sheet.addEventListener('click', e => {
      const t = e.target.closest('button'); if (!t) return;
      if (t.id === 'mm-icx') { open = false; menu = false; rmenu = false; paint(); }
      else if (t.id === 'mm-icmenu') { menu = !menu; paint(); }
      else if (t.dataset.t) { tab = t.dataset.t; menu = false; rmenu = false; if (tab === 'ra') loadRadios(); paint(); }
      else if (t.id === 'mm-icrmenu') { rmenu = !rmenu; if (radios === null) loadRadios(); paint(); } else if (t.dataset.ri != null) playRadio(Number(t.dataset.ri)); else if (t.id === 'mm-icrretry') { radios = null; loadRadios(); paint(); }
      else if (t.id === 'mm-icstop2') stopSource(); else if (t.id === 'mm-icytgo') { const v = sheet.querySelector('#mm-icyt'); playYT(v && v.value); }
      else if (t.dataset.g) { const g = (groups || []).find(x => x.id === t.dataset.g); if (g) join(g); }
      else if (t.id === 'mm-icmic2') toggleMic(); else if (t.id === 'mm-icleave') leave();
      else if (t.id === 'mm-icpp2') toggleMusic(); else if (t.id === 'mm-icnext2') loadTrack(idx + 1, true); else if (t.id === 'mm-icprev') loadTrack(idx - 1, true);
      else if (t.dataset.ti != null) loadTrack(Number(t.dataset.ti), true);
    });
    sheet.addEventListener('change', e => {
      if (e.target.id !== 'mm-icfiles') return; const fs = [...e.target.files].filter(f => /^audio\//.test(f.type) || /\.(mp3|m4a|aac|wav|ogg|flac)$/i.test(f.name)); if (!fs.length) return;
      const first = tracks.length; fs.forEach(f => tracks.push({ name: f.name.replace(/\.[^.]+$/, ''), url: URL.createObjectURL(f) })); loadTrack(idx < 0 ? 0 : first, true);
    });
    // ---------- harita olayları ----------
    host.addEventListener('mm:ride', e => { ride = !!(e.detail && e.detail.on); recompute(); });
    host.addEventListener('mm:speed', e => { kmh = e.detail ? e.detail.kmh : null; bind.setSpeed(kmh); });
    const onOnline = () => { if (comm) comm.notifyOnline(); }; root.addEventListener('online', onOnline);
    paint();
    return {
      core, setSpeed: v => bind.setSpeed(v), callStarted: () => core.dispatch({ type: E.CALL_START }), callEnded: () => core.dispatch({ type: E.CALL_END }),   // native/telefon köprüsü bunları çağıracak
      leave, destroy() { root.removeEventListener('online', onOnline); bind.stop(); if (comm) comm.stop(); au.pause(); if (yt && yt.destroy) { try { yt.destroy(); } catch (e) {} } tracks.forEach(t => URL.revokeObjectURL(t.url)); btn.remove(); strip.remove(); sheet.remove(); },
    };
  }
  root.Intercom = { mount, loadLK };
})(typeof window !== 'undefined' ? window : globalThis);
