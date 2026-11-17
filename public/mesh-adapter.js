'use strict';
/* İNTERKOM YEDEĞİ: WebRTC mesh taşıma (comm-core `transport` sözleşmesi). LiveKit hesabı/sunucusu GEREKMEZ.
   Ses tarayıcılar arasında doğrudan gider (sunucudan geçmez, kaydedilmez); sunucu yalnız sinyal aktarır (gv:join/gv:signal/gv:leave, bkz. meshvoice.js / php meshvoice.php).
   Teklifi (offer) odaya SONRADAN katılan verir → çakışma (glare) olmaz. Konuşan tespiti: gelen akışta Web Audio seviye ölçümü.
   SINIRLAR: oda ≤6 kişi (mesh); TURN yoksa bazı operatör ağlarında eşler birbirine bağlanamaz (bağlanamayan eş atlanır, diğerleri sürer);
   ekran kilitlenince/arka plana gidince tarayıcı sesi kesebilir (PWA sınırı). TEST EDİLMEDİ: gerçek cihaz/ağ/TURN. */
(function (root) {
  const THRESH = 0.02, HOLD_MS = 350;
  function createMeshTransport(o) {
    const sock = o.sock, gid = o.gid || o.room, RTC = o.RTC || root.RTCPeerConnection, fetchF = o.fetch || ((...a) => root.fetch(...a));
    const getMedia = o.getMedia || (c => root.navigator.mediaDevices.getUserMedia(c)), makeAudio = o.makeAudio || (() => { const a = new root.Audio(); a.autoplay = true; a.setAttribute('playsinline', ''); return a; });
    const meter = o.meter || defaultMeter, tick = o.tick || ((f, ms) => root.setInterval(f, ms)), untick = o.untick || (h => root.clearInterval(h)), now = o.now || (() => Date.now());
    const ack = (ev, data, ms = 8000) => new Promise((res, rej) => { let done = false; const t = setTimeout(() => { if (!done) { done = true; rej(new Error('Sunucuya ulaşılamadı.')); } }, ms);
      try { sock.emit(ev, data, r => { if (done) return; done = true; clearTimeout(t); r && r.error ? rej(new Error(r.error)) : res(r || {}); }); } catch (e) { done = true; clearTimeout(t); rej(e); } });
    const music = o.music || null; let pst = {}, mfrom = '', mvol = 1; let blocked = false, stream = null, track = null, ice = [{ urls: 'stun:stun.l.google.com:19302' }], meId = '', up = false, playbackOn = true, vol = 1, timer = null, speakersCb = () => {}, stateCb = () => {}, last = '';
    const peers = new Map();      // sid → { name, pc, audio, cand:[], remote:false, lvl, spoke }
    const offs = [];
    function on(ev, fn) { sock.on(ev, fn); offs.push([ev, fn]); }
    function defaultMeter(ms) {
      try { const AC = root.AudioContext || root.webkitAudioContext; if (!AC) return null; const ctx = defaultMeter.ctx || (defaultMeter.ctx = new AC()), src = ctx.createMediaStreamSource(ms), an = ctx.createAnalyser(); an.fftSize = 512; src.connect(an);
        const b = new Float32Array(an.fftSize); return () => { an.getFloatTimeDomainData(b); let s = 0; for (let i = 0; i < b.length; i++) s += b[i] * b[i]; return Math.sqrt(s / b.length); }; } catch (e) { return null; }
    }
    function playEl(a) { try { const r = a.play && a.play(); if (r && r.catch) r.catch(e => { if (e && (e.name === 'NotAllowedError' || /not allowed/i.test(String(e.message)))) { blocked = true; if (o.onBlocked) o.onBlocked(); } }); } catch (e) { /* oynatma hatası ses yokluğuna döner */ } }
    function applyEl(p) { if (!p.audio) return; const st = pst[p.uid] || {}; p.audio.muted = !playbackOn || !!st.muted; try { p.audio.volume = Math.min(1, Math.max(0, vol * (st.vol == null ? 1 : st.vol))); } catch (e) {} }
    function applyM(p) { if (!p.maudio) return; p.maudio.muted = !(mfrom && p.uid === mfrom); try { p.maudio.volume = mvol; } catch (e) {} }
    function mk(sid, name, uid) {
      let p = peers.get(sid); if (p) { if (uid && !p.uid) p.uid = uid; return p; }
      const pc = new RTC({ iceServers: ice }); p = { name: name || '', uid: uid || '', pc, audio: null, maudio: null, musicId: '', cand: [], remote: false, lvl: null, spoke: 0 }; peers.set(sid, p);
      if (track) pc.addTrack(track, stream);
      if (music && music.track) pc.addTrack(music.track, music.stream);          // oda müziği için ikinci (başta sessiz) parça; yalnız lider besler
      pc.onicecandidate = e => { if (e.candidate) sock.emit('gv:signal', { to: sid, data: { t: 'ice', c: e.candidate.toJSON ? e.candidate.toJSON() : e.candidate } }, () => {}); };
      pc.ontrack = e => { const ms = (e.streams && e.streams[0]) || null; if (!ms) return;
        if (p.musicId && ms.id === p.musicId) { if (!p.maudio) p.maudio = makeAudio(); p.maudio.srcObject = ms; applyM(p); playEl(p.maudio); return; }
        if (!p.audio) { p.audio = makeAudio(); } p.audio.srcObject = ms; applyEl(p); playEl(p.audio); p.lvl = meter(ms); };
      pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed') drop(sid); };
      return p;
    }
    function drop(sid) { const p = peers.get(sid); if (!p) return; peers.delete(sid); try { p.pc.close(); } catch (e) {} if (p.audio) { try { p.audio.pause(); p.audio.srcObject = null; } catch (e) {} } if (p.maudio) { try { p.maudio.pause(); p.maudio.srcObject = null; } catch (e) {} } }
    async function flush(p) { p.remote = true; const q = p.cand.splice(0); for (const c of q) { try { await p.pc.addIceCandidate(c); } catch (e) {} } }
    async function onSignal(m) {
      const sid = m && m.from, d = m && m.data; if (!sid || !d) return; const p = mk(sid);
      try {
        if (d.t === 'offer') { if (d.ms) p.musicId = d.ms; await p.pc.setRemoteDescription(d.sdp); await flush(p); const ans = await p.pc.createAnswer(); await p.pc.setLocalDescription(ans); sock.emit('gv:signal', { to: sid, data: { t: 'answer', sdp: p.pc.localDescription || ans, ms: music && music.stream ? music.stream.id : undefined } }, () => {}); }
        else if (d.t === 'answer') { if (d.ms) p.musicId = d.ms; await p.pc.setRemoteDescription(d.sdp); await flush(p); }
        else if (d.t === 'ice') { if (p.remote) await p.pc.addIceCandidate(d.c); else p.cand.push(d.c); }
      } catch (e) { /* bozuk sinyal: o eş atlanır */ }
    }
    async function offerTo(sid, name, uid) { const p = mk(sid, name, uid); try { const of = await p.pc.createOffer(); await p.pc.setLocalDescription(of); sock.emit('gv:signal', { to: sid, data: { t: 'offer', sdp: p.pc.localDescription || of, ms: music && music.stream ? music.stream.id : undefined } }, () => {}); } catch (e) { drop(sid); } }
    function poll() {
      const t = now(), ids = [], names = [];
      peers.forEach((p, sid) => { if (!p.lvl) return; const v = p.lvl(); if (v > THRESH) p.spoke = t; if (t - p.spoke < HOLD_MS) { ids.push(sid); names.push(p.name || sid); } });
      const key = ids.sort().join(','); if (key !== last) { last = key; ids.names = names; speakersCb(ids); }
    }
    return {
      async connect() {
        try { const r = await fetchF('/api/gvoice/ice', { credentials: 'same-origin' }); if (r.ok) { const j = await r.json(); if (j && Array.isArray(j.iceServers) && j.iceServers.length) ice = j.iceServers; } } catch (e) { /* STUN varsayılanı */ }
        if (!stream) {
          try { stream = await getMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false }); }
          catch (e) { throw new Error('Mikrofon izni verilmedi. Tarayıcı ayarlarından izin ver.'); }
          track = stream.getAudioTracks()[0]; if (track) track.enabled = false;           // katılmak mikrofonu açmaz
        }
        cleanup();                                                                         // yeniden bağlanmada eski dinleyici/eşler kalmasın
        on('disconnect', () => { if (up) { cleanup(); stateCb('disconnected'); } });
        on('gv:peer-joined', m => { mk(m.id, m.name, m.uid); });
        on('gv:peer-left', m => { drop(m.id); });
        on('gv:signal', onSignal);
        on('gv:taken', () => { cleanup(); if (o.onFatal) o.onFatal('Başka bir cihazdan bağlandın; bu cihazda interkom kapatıldı.'); });
        on('gv:kicked', () => { cleanup(); if (o.onFatal) o.onFatal('Gruptan çıkarıldın; interkom kapatıldı.'); });
        let j; try { j = await ack('gv:join', o.room ? { room: o.room } : { gid }); } catch (e) { offs.forEach(([ev, fn]) => sock.off && sock.off(ev, fn)); offs.length = 0; throw e; }
        meId = j.id || ''; up = true; timer = tick(poll, 150);
        for (const x of (j.peers || [])) await offerTo(x.id, x.name, x.uid);
        stateCb('connected');
      },
      async disconnect() { try { if (up) sock.emit('gv:leave', {}, () => {}); } catch (e) {} cleanup(); if (stream) { stream.getTracks().forEach(t => { try { t.stop(); } catch (e) {} }); stream = null; track = null; } },
      setMic(on) { if (track) track.enabled = !!on; },
      setPlayback(on) { playbackOn = !!on; peers.forEach(applyEl); },
      setVolume(v) { vol = Math.min(1, Math.max(0, v)); peers.forEach(applyEl); },
      setPeerState(st) { pst = st || {}; peers.forEach(applyEl); },                // {uid:{vol 0-1, muted}} — oda liderinin kişi başı ayarı
      setMusicFrom(uid) { mfrom = uid || ''; peers.forEach(applyM); },             // hangi eşin müzik parçası duyulsun ('' = hiçbiri)
      setMusicVolume(v) { mvol = Math.min(1, Math.max(0, v)); peers.forEach(applyM); },
      resumeAudio() { blocked = false; try { const c = defaultMeter.ctx; if (c && c.state === 'suspended') c.resume(); } catch (e) {} peers.forEach(p => { if (p.audio) playEl(p.audio); if (p.maudio) playEl(p.maudio); }); },
      get blocked() { return blocked; },
      onSpeakers(fn) { speakersCb = fn; }, onState(fn) { stateCb = fn; },
      _peers: peers,
    };
    function cleanup() { if (timer) { untick(timer); timer = null; } offs.forEach(([ev, fn]) => sock.off && sock.off(ev, fn)); offs.length = 0; [...peers.keys()].forEach(drop); up = false; last = ''; }
  }
  const api = { createMeshTransport };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.MeshAdapter = api;
})(typeof window !== 'undefined' ? window : globalThis);
