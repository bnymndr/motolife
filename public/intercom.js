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
    const o = opts || {}, AC = root.AudioCore, MD = root.MediaCore, CC = root.CommCore, LA = root.LiveKitAdapter, ICON = (root.MotoMap && root.MotoMap.ICON) || {};
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
    const musicAdapter = { play() { ensureGain(); if (actx && actx.resume) actx.resume(); if (au.src) { const r = au.play(); if (r && r.catch) r.catch(() => {}); } }, pause() { au.pause(); }, setVolume(v) { ensureGain(); if (gain) gain.gain.value = v; else au.volume = Math.min(1, Math.max(0, v)); } };
    function loadTrack(i, autoplay) { if (!tracks.length) return; idx = (i + tracks.length) % tracks.length; au.src = tracks[idx].url; paint(); if (autoplay) { core.dispatch({ type: E.MUSIC_WANTED, on: true }); musicAdapter.play(); } }
    au.addEventListener('ended', () => loadTrack(idx + 1, true));
    // ---------- iletişim ----------
    let ride = false, gid = null, gname = '', svc = null, comm = null, tr = null, state = 'off', speakers = [], groups = null, kmh = null;
    const voice = { play() {}, pause() {}, setVolume(v) { if (tr && tr.setVolume) tr.setVolume(v); } }, noop = { play() {}, pause() {}, setVolume() {} };
    const bind = MD.bind(core, { music: musicAdapter, intercom: voice, phone: noop, assistant: noop }, { now: () => Date.now() }); bind.start(40);
    function recompute() { const want = gid ? 'G' : ride ? 'S' : 'I'; core.dispatch({ type: want === 'G' ? E.START_GROUP : want === 'S' ? E.START_SOLO : E.END_RIDE }); }
    async function join(g) {
      if (gid) return; state = 'connecting'; gid = g.id; gname = g.name; speakers = []; paint();
      try {
        const LK = await loadLib();
        const getToken = async () => { const r = await fetchF('/api/livekit/token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ gid: g.id }) }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'İnterkom bağlantısı kurulamadı'); return j; };
        tr = LA.createLiveKitTransport({ Room: LK.Room, RoomEvent: LK.RoomEvent, getToken });
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
    let tab = 'ic', open = false;
    const micOn = () => svc && !svc.muted;
    function stripHtml() {
      const conn = !!gid, hasTrack = tracks.length > 0; if (!conn && !hasTrack) return '';
      const sp = speakers.length ? '<small class="sp">🔊 ' + esc(speakers.join(', ')) + ' konuşuyor</small>' : '';
      const st = conn ? '<b>' + esc(gname) + '</b><small>' + (state === 'on' ? 'Bağlı' : 'Bağlanıyor…') + '</small>' + sp : '<b>Müzik</b>';
      const mu = hasTrack ? '<small>♪ ' + esc(tracks[idx] ? tracks[idx].name : '') + '</small>' : '';
      return (conn ? '<button type="button" class="mm-icmic' + (micOn() ? '' : ' mute') + '" id="mm-icmic" aria-label="' + (micOn() ? 'Mikrofonu kapat' : 'Mikrofonu aç') + '">' + (micOn() ? ICON.mic : ICON.micoff) + '</button>' : '')
        + '<div class="mm-icmid">' + st + mu + '</div>'
        + (hasTrack ? '<button type="button" class="mm-icmini" id="mm-icpp" aria-label="Çal / Durdur">⏯</button><button type="button" class="mm-icmini" id="mm-icnext" aria-label="Sonraki">⏭</button>' : '');
    }
    function sheetHtml() {
      const tabs = '<div class="mm-ictabs"><button type="button" data-t="ic" class="' + (tab === 'ic' ? 'a' : '') + '">İnterkom</button><button type="button" data-t="mu" class="' + (tab === 'mu' ? 'a' : '') + '">Müzik</button></div>';
      let body = '';
      if (tab === 'ic') {
        if (gid) body = '<div class="mm-icrow"><div>Grup<small>' + esc(gname) + '</small></div><span class="mm-icpill">' + (state === 'on' ? 'Bağlı' : 'Bağlanıyor…') + '</span></div>'
          + '<div class="mm-icrow"><div>Mikrofon<small>' + (micOn() ? 'Açık' : 'Kapalı') + '</small></div></div>'
          + '<button type="button" class="mm-icbig" id="mm-icmic2">' + (micOn() ? 'Mikrofonu Kapat' : 'Mikrofonu Aç') + '</button><button type="button" class="mm-icbig sec" id="mm-icleave">Gruptan Ayrıl</button>'
          + '<p class="mm-icnote">Telefon aramasında gruptan çıkılmaz; ses ve mikrofon duraklar, arama bitince kendiliğinden döner.</p>';
        else if (groups === null) body = '<p class="mm-icnote">Gruplar yükleniyor…</p>';
        else if (!groups.length) body = '<p class="mm-icnote">Henüz bir sürüş grubun yok. Sosyal › Gruplarım bölümünden grup kur ya da davet koduyla katıl. Tek sürüşte yalnız müzik çalar.</p>';
        else body = '<p class="mm-icnote">Tek sürüşte yalnız müzik çalar. Grup interkomu için bir grup seç:</p>' + groups.map(g => '<button type="button" class="mm-icgrp" data-g="' + esc(g.id) + '"><b>' + esc(g.name) + '</b><small>' + esc(g.count) + ' üye</small></button>').join('');
      } else {
        body = '<label class="mm-icbig" for="mm-icfiles">Müzik Dosyası Seç</label><input type="file" id="mm-icfiles" accept="audio/*" multiple hidden>'
          + (tracks.length ? '<div class="mm-icrow"><div>Çalıyor<small>' + esc(tracks[idx] ? tracks[idx].name : '') + '</small></div><div class="mm-icctl"><button type="button" class="mm-icmini" id="mm-icprev" aria-label="Önceki">⏮</button><button type="button" class="mm-icmini" id="mm-icpp2" aria-label="Çal / Durdur">⏯</button><button type="button" class="mm-icmini" id="mm-icnext2" aria-label="Sonraki">⏭</button></div></div>'
            + '<ul class="mm-iclist">' + tracks.map((t, i) => '<li><button type="button" data-ti="' + i + '" class="' + (i === idx ? 'cur' : '') + '">' + esc(t.name) + '</button></li>').join('') + '</ul>' : '<p class="mm-icnote">Telefondaki müzik dosyalarını seç. Biri konuşurken müzik kısılır, telefon çalınca durur ve arama bitince kendiliğinden devam eder.</p>');
      }
      return '<div class="mm-gh"><span>İnterkom ve Müzik</span><button type="button" class="mm-gx" id="mm-icx" aria-label="Kapat">✕</button></div>' + tabs + body;
    }
    function paint() {
      btn.classList.toggle('on', !!gid || tracks.length > 0); const h = stripHtml(); strip.hidden = !h; strip.innerHTML = h; sheet.hidden = !open; if (open) sheet.innerHTML = sheetHtml();
    }
    async function loadGroups() { try { const r = await fetchF('/api/rgroups'); const j = await r.json(); groups = Array.isArray(j.groups) ? j.groups : []; } catch (e) { groups = []; } paint(); }
    const toggleMic = () => { if (!svc) return; if (svc.muted) svc.unmute(); else svc.mute(); paint(); };
    const toggleMusic = () => { const w = core.ctx.musicWanted; if (w && !au.paused) { core.dispatch({ type: E.MUSIC_WANTED, on: false }); } else { core.dispatch({ type: E.MUSIC_WANTED, on: true }); musicAdapter.play(); } paint(); };
    btn.addEventListener('click', () => { open = !open; if (open && groups === null) loadGroups(); paint(); });
    strip.addEventListener('click', e => { const t = e.target.closest('button'); if (!t) return; if (t.id === 'mm-icmic') toggleMic(); else if (t.id === 'mm-icpp') toggleMusic(); else if (t.id === 'mm-icnext') loadTrack(idx + 1, true); });
    sheet.addEventListener('click', e => {
      const t = e.target.closest('button'); if (!t) return;
      if (t.id === 'mm-icx') { open = false; paint(); } else if (t.dataset.t) { tab = t.dataset.t; paint(); }
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
      leave, destroy() { root.removeEventListener('online', onOnline); bind.stop(); if (comm) comm.stop(); au.pause(); tracks.forEach(t => URL.revokeObjectURL(t.url)); btn.remove(); strip.remove(); sheet.remove(); },
    };
  }
  root.Intercom = { mount, loadLK };
})(typeof window !== 'undefined' ? window : globalThis);
