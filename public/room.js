'use strict';
/* GRUP İNTERKOM ODASI motoru (uygulama düzeyi; ekran değişse de oda sürer). Arayüz: Sosyal › Gruplarım › (grup) › İnterkom sekmesi (React) bu motoru `MLRoom` ile sürer.
   Sunucu: /api/rgroups/:id/room… (grouproom.js / grouproom.php). Ses: MeshAdapter (WebRTC mesh, ≤6 kişi) + CommCore (yeniden bağlanma) + AudioCore.
   Oda yayını: lider RADYO/YOUTUBE bağlantısı paylaşır → her üyenin kendi cihazı aynı yayını çalar (zamanlama birebir DEĞİL); MÜZİK DOSYASI liderin telefonundan WebRTC ile akar.
   Üye «Yayını dinle»yi kapatabilir (interkom sürer); kendi müziği için Harita › ♪ paneli ayrı çalışır ve odadaki konuşma onu kısar ('ml:room' olayı).
   TEST EDİLMEDİ: gerçek cihaz/ağ/TURN, gerçek YouTube/radyo, iOS (Web Audio MediaStreamDestination), ekran kilidi. */
(function (root) {
  const POLL_MS = 2500, RMAX = 60;
  const friendly = e => { const m = e && e.message ? String(e.message) : ''; if ((e && e.name === 'NotAllowedError') || /not allowed by the user agent|denied permission|NotAllowedError/i.test(m)) return 'Ses için ekrana bir kez dokun (Sesi Başlat).'; return m; };
  const ytId = u => { const t = String(u || '').trim(); let m; if ((m = t.match(/(?:youtu\.be\/|[?&]v=|\/shorts\/|\/embed\/|\/live\/)([\w-]{11})(?![\w-])/))) return m[1]; return /^[\w-]{11}$/.test(t) ? t : ''; };
  function create(o) {
    const sock = o.socket, fetchF = o.fetchF || ((...a) => root.fetch(...a)), AC = root.AudioCore, CC = root.CommCore, MA = root.MeshAdapter;
    const E = AC && AC.Events, subs = new Set();
    const S = { view: null, act: null, actGid: null, lists: {}, rooms: {}, blocked: false, conn: 'off', mic: false, speakers: [], listen: true, err: '', busy: false, radios: null, radioErr: '', local: null, forced: false };
    let timer = null, pend = null, core = null, comm = null, svc = null, tr = null, actx = null, music = null, ra = null, yt = null, ytReady = null, fa = null, fgain = null, ftracks = [], fidx = -1, playing = '';
    const emit = () => subs.forEach(f => { try { f(S); } catch (e) {} });
    const toast = m => { S.err = m; emit(); };
    async function api(gid, path, method, body) {
      const r = await fetchF('/api/rgroups/' + gid + '/rooms' + path, { method: method || 'GET', credentials: 'same-origin', headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
      const j = await r.json().catch(() => ({})); if (!r.ok) { const er = new Error(j.error || 'İşlem başarısız.'); er.status = r.status; throw er; } return j;
    }
    const roomOf = () => (S.act && S.rooms[S.act]) || null;
    const rapi = (path, method, body) => api(S.actGid, '/' + S.act + path, method, body);
    function fire(d) { try { root.dispatchEvent(new CustomEvent('ml:room', { detail: d })); } catch (e) {} }
    // ---------- yoklama ----------
    async function refreshList(gid) {
      if (!gid) return; try { const j = await api(gid, ''); S.lists[gid] = { rooms: j.rooms || [], mine: j.mine || null, max: j.max || 10, skew: (j.now || Date.now()) - Date.now() }; } catch (e) { if (gid === S.view) S.err = friendly(e); }
      emit();
    }
    async function refreshRoom() {
      const rid = S.act, gid = S.actGid; if (!rid) return;
      try { const j = await api(gid, '/' + rid + '?hb=1'); if (S.act !== rid) return; S.rooms[rid] = j.room; reconcile(j.room); }
      catch (e) { if (S.act === rid) { if (e.status === 404) { stopVoice(true); S.err = 'Oda kapandı ya da süresi doldu.'; } else S.err = friendly(e); } }
      emit();
    }
    const refresh = gid => { refreshList(gid || S.view); if (S.act) refreshRoom(); };
    function tick() { if (S.view) refreshList(S.view); if (S.act) refreshRoom(); }
    function startPoll() { if (!timer) timer = setInterval(tick, POLL_MS); }
    function stopPollIfIdle() { if (!S.view && !S.act && timer) { clearInterval(timer); timer = null; } }
    // ---------- ses ----------
    function ensureCtx() {
      if (actx) return;
      const AX = root.AudioContext || root.webkitAudioContext; if (!AX) return;
      actx = new AX(); const dest = actx.createMediaStreamDestination(); const t = dest.stream.getAudioTracks()[0];
      music = t ? { track: t, stream: dest.stream, dest } : null;
    }
    async function startVoice(gid, rid) {
      if (S.act && S.act !== rid) await stopVoice();
      if (S.act === rid && tr) return; S.act = rid; S.actGid = gid; S.blocked = false; S.conn = 'connecting'; S.mic = false; S.speakers = []; emit();
      try {
        if (!MA || !CC || !AC) throw new Error('İnterkom bu cihazda kullanılamıyor.');
        ensureCtx(); if (actx && actx.state === 'suspended') { try { actx.resume(); } catch (e) {} }
        tr = MA.createMeshTransport({ sock, room: rid, music, onBlocked: () => { S.blocked = true; emit(); }, onFatal: m => { toast(m); stopVoice(true); } });
        svc = CC.createGroupService(tr); svc.mute();                                  // odaya mikrofon KAPALI girilir
        svc.on('state', st => { S.conn = st === 'connected' ? 'on' : 'connecting'; emit(); });
        svc.on('speakers', ids => { const n = (ids && ids.names) || ids || []; S.speakers = n; fire({ speaking: n.length > 0 }); applySrcVol(); emit(); });
        core = AC.create(); comm = CC.bindComms(core, svc, { online: () => root.navigator.onLine !== false, onError: e => { S.err = e && e.message ? e.message : 'İnterkom hatası'; emit(); } });
        core.dispatch({ type: E.START_GROUP }); fire({ on: true }); startPoll();
      } catch (e) { S.err = friendly(e) || 'İnterkom açılamadı'; await stopVoice(true); }
      emit();
    }
    async function stopVoice(skipLeave) {
      const rid = S.act, c = comm; S.act = null; S.actGid = null; S.blocked = false; pend = null; S.conn = 'off'; S.mic = false; S.speakers = []; S.forced = false;
      stopLocalSource(); stopFile(true); try { if (core) core.dispatch({ type: E.END_RIDE }); } catch (e) {}
      if (c) setTimeout(() => c.stop(), 0); comm = null; svc = null; tr = null; core = null; fire({ on: false, speaking: false });
      if (rid) delete S.rooms[rid]; if (S.view) refreshList(S.view); stopPollIfIdle(); emit();
    }
    function applySrcVol() {
      const v = (S.speakers.length ? 0.3 : 1) * 0.9;
      if (ra) { try { ra.volume = v; } catch (e) {} }
      if (yt && yt.setVolume) { try { yt.setVolume(Math.round(v * 100)); } catch (e) {} }
      if (fgain) fgain.gain.value = v; if (tr && tr.setMusicVolume) tr.setMusicVolume(v);
    }
    // ---------- oda durumu → yerel uygulama ----------
    function reconcile(rm) {
      if (!rm || !rm.in) { if (S.act) { const m = rm ? 'Odadan çıkarıldın ya da ayrıldın.' : 'Oda kapatıldı.'; stopVoice(true); S.err = m; } return; }
      const me = rm.parts.find(x => x.you); S.forced = !!(me && me.muted);
      if (S.forced && svc && !svc.muted) { svc.mute(); S.mic = false; }
      if (tr && tr.setPeerState) { const st = {}; rm.parts.forEach(p => { st[p.uid] = { vol: p.vol / 100, muted: p.muted }; }); tr.setPeerState(st); }
      const src = rm.src, key = src ? [src.type, src.url || src.id || src.title, src.by, src.at].join('|') : '';
      if (rm.lead) return;                                           // lider kendi yayınını kendisi çalıyor
      if (key === playing) { if (tr && tr.setMusicFrom) tr.setMusicFrom(S.listen && src && src.type === 'file' ? src.by : ''); return; }
      playing = key; stopLocalSource();
      if (tr && tr.setMusicFrom) tr.setMusicFrom(S.listen && src && src.type === 'file' ? src.by : '');
      if (S.listen && src) playLocal(src);
    }
    // ---------- yayın oynatıcıları (radyo / YouTube) ----------
    function stopLocalSource() { if (ra) { try { ra.pause(); ra.removeAttribute('src'); ra.load(); } catch (e) {} ra = null; } if (yt && yt.stopVideo) { try { yt.stopVideo(); } catch (e) {} } S.local = null; }
    function loadYT() {
      if (ytReady) return ytReady;
      return (ytReady = new Promise((res, rej) => { if (root.YT && root.YT.Player) return res(root.YT); const prev = root.onYouTubeIframeAPIReady; root.onYouTubeIframeAPIReady = () => { if (prev) try { prev(); } catch (e) {} res(root.YT); };
        const sc = document.createElement('script'); sc.src = 'https://www.youtube.com/iframe_api'; sc.onerror = () => { ytReady = null; rej(new Error('YouTube yüklenemedi')); }; document.head.appendChild(sc); }));
    }
    async function playLocal(src) {
      try {
        if (src.type === 'radio') { ra = new root.Audio(); ra.src = src.url; ra.addEventListener('error', () => { S.err = 'Radyo yayını açılamadı.'; emit(); }); applySrcVol(); await ra.play(); pend = null; S.local = src.title; }
        else if (src.type === 'yt') {
          const YT = await loadYT(); let box = document.getElementById('ml-roomyt');
          if (!box) { box = document.createElement('div'); box.id = 'ml-roomyt'; box.style.cssText = 'position:fixed;left:-9999px;top:0;width:200px;height:200px'; box.appendChild(document.createElement('div')); document.body.appendChild(box); }
          if (yt && yt.loadVideoById) yt.loadVideoById(src.id); else yt = new YT.Player(box.firstChild, { height: '200', width: '200', videoId: src.id, playerVars: { playsinline: 1, autoplay: 1 }, events: { onReady: e => { try { e.target.playVideo(); applySrcVol(); } catch (x) {} }, onError: () => { S.err = 'Bu video burada oynatılamıyor.'; emit(); } } });
          S.local = src.title;
        } else if (src.type === 'file') S.local = src.title + ' (liderden akıyor)';
      } catch (e) { if (e && (e.name === 'NotAllowedError' || /not allowed/i.test(String(e.message)))) { pend = src; S.blocked = true; } else S.err = friendly(e) || 'Yayın açılamadı.'; }
      emit();
    }
    // ---------- lider: dosya yayını ----------
    function stopFile(silent) { if (fa) { try { fa.pause(); } catch (e) {} fa = null; } ftracks.forEach(t => { try { root.URL.revokeObjectURL(t.url); } catch (e) {} }); ftracks = []; fidx = -1; if (!silent) emit(); }
    function fileLoad(i) {
      if (!ftracks.length) return; fidx = (i + ftracks.length) % ftracks.length;
      if (!fa) { fa = new root.Audio(); fa.addEventListener('ended', () => fileLoad(fidx + 1)); try { const src = actx.createMediaElementSource(fa); fgain = actx.createGain(); src.connect(fgain); fgain.connect(actx.destination); if (music && music.dest) fgain.connect(music.dest); } catch (e) { S.err = 'Bu cihaz dosya yayınını desteklemiyor.'; } }
      fa.src = ftracks[fidx].url; applySrcVol(); try { actx.resume(); } catch (e) {} fa.play().catch(() => {}); S.local = ftracks[fidx].name; emit();
    }
    // ---------- dış arayüz ----------
    const guard = async (fn) => { S.busy = true; S.err = ''; emit(); try { return await fn(); } catch (e) { S.err = friendly(e) || 'Hata'; return null; } finally { S.busy = false; emit(); } };
    const eng = {
      state: S, subscribe(f) { subs.add(f); return () => subs.delete(f); },
      watch(gid) { S.view = gid; startPoll(); refreshList(gid); }, unwatch() { S.view = null; stopPollIfIdle(); },
      refresh,
      create: (gid, gname, name, password) => guard(async () => { const j = await api(gid, '', 'POST', { name, password }); S.rooms[j.room.rid] = j.room; await startVoice(gid, j.room.rid); refreshList(gid); return true; }),
      join: (gid, gname, rid, password) => guard(async () => { const j = await api(gid, '/' + rid + '/join', 'POST', { password }); S.rooms[rid] = j.room; await startVoice(gid, rid); refreshList(gid); return true; }),
      leave: () => guard(async () => { if (S.act) { try { await rapi('/leave', 'POST', {}); } catch (e) {} } await stopVoice(true); return true; }),
      close: () => guard(async () => { await rapi('/close', 'POST', {}); await stopVoice(true); return true; }),
      kick: uid => guard(async () => { const j = await rapi('/kick', 'POST', { uid }); if (j.room) S.rooms[S.act] = j.room; return true; }),
      invite: uid => guard(async () => { await rapi('/invite', 'POST', { uid }); refreshRoom(); return true; }),
      setUser: (uid, p) => guard(async () => { const j = await rapi('/user', 'POST', Object.assign({ uid }, p)); S.rooms[S.act] = j.room; reconcile(j.room); return true; }),
      rideStart: () => guard(async () => { const j = await rapi('/ride/start', 'POST', {}); S.rooms[S.act] = j.room; return true; }),
      rideEnd: () => guard(async () => { const j = await rapi('/ride/end', 'POST', {}); S.rooms[S.act] = j.room; return true; }),
      rideNumber: n => guard(async () => { const j = await rapi('/ride/number', 'POST', { n }); S.rooms[S.act] = j.room; return true; }),
      resumeAudio() {                                                  // iOS/Safari: ses yalnız kullanıcı dokunuşuyla başlar
        S.blocked = false; try { if (actx) actx.resume(); } catch (e) {} try { if (tr && tr.resumeAudio) tr.resumeAudio(); } catch (e) {}
        if (ra) { try { const p = ra.play(); if (p && p.catch) p.catch(() => { S.blocked = true; emit(); }); } catch (e) {} }
        if (yt && yt.playVideo) { try { yt.playVideo(); } catch (e) {} }
        if (pend) { const s = pend; pend = null; playLocal(s); }
        emit();
      },
      toggleMic() { if (!svc || S.forced) return; if (svc.muted) svc.unmute(); else svc.mute(); S.mic = !svc.muted; emit(); },
      setListen(on) { S.listen = !!on; const rm = roomOf(); playing = ''; if (rm) reconcile(rm); else stopLocalSource(); emit(); },
      shareRadio: (url, title) => guard(async () => { stopFile(true); stopLocalSource(); const j = await rapi('/source', 'POST', { type: 'radio', url, title }); S.rooms[S.act] = j.room; await playLocal({ type: 'radio', url, title }); return true; }),
      shareYT: (link, title) => guard(async () => { const id = ytId(link); if (!id) throw new Error('Tek bir YouTube video bağlantısı gir (liste desteklenmiyor).'); stopFile(true); stopLocalSource(); const j = await rapi('/source', 'POST', { type: 'yt', id, title: title || 'YouTube' }); S.rooms[S.act] = j.room; await playLocal({ type: 'yt', id, title: title || 'YouTube' }); return true; }),
      shareFiles: files => guard(async () => {
        const fs = [...files].filter(f => /^audio\//.test(f.type) || /\.(mp3|m4a|aac|wav|ogg|flac)$/i.test(f.name)); if (!fs.length) throw new Error('Ses dosyası seç.');
        ensureCtx(); if (!actx || !music) throw new Error('Bu cihaz dosya yayınını desteklemiyor.');
        stopLocalSource(); stopFile(true); ftracks = fs.map(f => ({ name: f.name.replace(/\.[^.]+$/, ''), url: root.URL.createObjectURL(f) }));
        const j = await rapi('/source', 'POST', { type: 'file', title: ftracks[0].name }); S.rooms[S.act] = j.room; fileLoad(0); return true;
      }),
      filePlayPause() { if (!fa) return; if (fa.paused) { try { actx.resume(); } catch (e) {} fa.play().catch(() => {}); } else fa.pause(); emit(); },
      fileNext() { if (ftracks.length) fileLoad(fidx + 1); },
      stopShare: () => guard(async () => { stopFile(true); stopLocalSource(); const j = await rapi('/source', 'DELETE'); S.rooms[S.act] = j.room; playing = ''; return true; }),
      get filePlaying() { return !!(fa && !fa.paused); }, get fileName() { return fidx >= 0 ? ftracks[fidx].name : ''; },
      async loadRadios() {
        if (S.radios) return S.radios;
        try {
          const r = await fetchF(o.radioUrl || 'https://de1.api.radio-browser.info/json/stations/search?countrycode=TR&hidebroken=true&is_https=true&lastcheckok=1&order=clickcount&reverse=true&limit=200'); const j = await r.json(); const seen = new Set(), out = [];
          for (const c of j) { const u = c.url_resolved || c.url; if (!u || !/^https:/i.test(u) || c.lastcheckok === 0 || c.hls) continue; const n = String(c.name || '').trim(); if (!n || seen.has(n.toLowerCase())) continue; seen.add(n.toLowerCase()); out.push({ name: n, url: u }); if (out.length >= RMAX) break; }
          out.sort((a, b) => a.name.localeCompare(b.name, 'tr')); S.radios = out; S.radioErr = '';
        } catch (e) { S.radioErr = 'Radyo listesi alınamadı.'; }
        emit(); return S.radios;
      },
      clearErr() { S.err = ''; emit(); },
      ytId,
    };
    if (sock && sock.on) { sock.on('room:changed', m => { if (!m || !m.gid) return; if (m.gid === S.view) refreshList(m.gid); if (m.rid && m.rid === S.act) refreshRoom(); }); sock.on('room:invite', m => { S.invite = m; emit(); root.dispatchEvent(new CustomEvent('ml:room-invite', { detail: m })); }); }
    root.addEventListener && root.addEventListener('online', () => { if (comm) comm.notifyOnline(); });
    return eng;
  }
  root.RoomEngine = { create, ytId };
})(typeof window !== 'undefined' ? window : globalThis);
