/* GRUP SESİ (istemci). Sunucu: groupvoice.js. Ses WebRTC ile üyeler arasında DOĞRUDAN gider (mesh), sunucudan geçmez ve kaydedilmez.
   Lider odanın modunu seçer: «bas-konuş» (tek kişi söz alır) ya da «açık mikrofon» (herkes kendi mikrofonunu açıp kapatır).
   Mikrofon varsayılan KAPALIDIR; katılmak mikrofonu açmaz. Bar, ses açıkken tüm ekranlarda görünür (gizli açık mikrofon olmasın diye).
   SINIRLAR: oda ≤6 kişi (mesh). TURN yoksa bazı operatör ağlarında eşler birbirine bağlanamaz → «bağlanamadı» gösterilir.
   PTT söz hakkı alıcıda uygulanır (hak sahibi dışındakilerin sesi susturulur); sunucu ses akışını kesemez.
   Telefonun ekranı kilitlenince/uygulama arka plana gidince tarayıcı sesi/mikrofonu kesebilir (PWA sınırı; yerel kabuk gerekir). */
(function (root) {
  'use strict';
  const MSG = { forbidden: 'Bu grubun üyesi değilsin.', full: 'Sesli oda dolu.', rate: 'Çok sık istek, biraz bekle.', notin: 'Sesli odada değilsin.', mic_denied: 'Mikrofon izni verilmedi. Tarayıcı/telefon ayarlarından izin ver.', mic_missing: 'Mikrofon bulunamadı.', mic_https: 'Mikrofon için HTTPS gerekir.', net: 'Sunucuya ulaşılamadı.', rtc: 'Bu tarayıcı sesli görüşmeyi desteklemiyor.' };
  const LS = { get: (k, d) => { try { const v = root.localStorage.getItem(k); return v == null ? d : v; } catch { return d; } }, set: (k, v) => { try { root.localStorage.setItem(k, v); } catch {} } };

  function create(o = {}) {
    const sock = o.sock, RTC = o.RTC || root.RTCPeerConnection, fetchF = o.fetch || ((...a) => root.fetch(...a));
    const getMedia = o.getMedia || (c => root.navigator.mediaDevices.getUserMedia(c));
    const setT = o.setTimeout || ((f, m) => root.setTimeout(f, m)), clrT = o.clearTimeout || (h => root.clearTimeout(h)), setI = o.setInterval || ((f, m) => root.setInterval(f, m)), clrI = o.clearInterval || (h => root.clearInterval(h));
    const S = { status: 'idle', gid: '', name: '', error: null, mode: 'ptt', leader: false, meId: '', meUid: '', holder: null, ptt: 'idle', mic: false, max: 6, latch: LS.get('ml_gv_latch', '0') === '1', turn: false };
    const peers = new Map();   // sid → { id, uid, name, mic, conn, pc, audio, speaking, tries, cand:[], haveRemote, an, buf, last }
    let stream = null, track = null, ice = [{ urls: 'stun:stun.l.google.com:19302' }], renewT = null, deniedT = null, cancelReq = false, actx = null, meterT = null, audioHost = o.audioHost || null, joinSeq = 0;
    const cbs = new Set(o.onChange ? [o.onChange] : []);
    // Kullanıcı ses ayarları (cihazda saklanır). gate: mikrofon hassasiyeti 0-100; voice/music: ses düzeyi 0-100; ns: güçlü gürültü filtresi; duck: konuşurken müziği kıs
    const num = (k, d) => { const v = Number(LS.get(k, String(d))); return isFinite(v) ? Math.max(0, Math.min(100, v)) : d; };
    const cfg = { gate: num('ml_gv_gate', 50), voice: num('ml_vol_voice', 100), music: num('ml_vol_music', 100), ns: LS.get('ml_gv_ns', '1') !== '0', duck: LS.get('ml_duck', '1') !== '0' };
    let rawStream = null, mic = null, gateT = null, lastActive = false;
    const fire = (n, detail) => { try { if (root.dispatchEvent && root.CustomEvent) root.dispatchEvent(new root.CustomEvent(n, { detail })); } catch {} };
    const view = () => ({ ...S, peers: [...peers.values()].map(p => ({ id: p.id, uid: p.uid, name: p.name, mic: p.mic, conn: p.conn, speaking: p.speaking })), count: peers.size + (S.status === 'connected' ? 1 : 0), talking: S.mic });
    let emitQ = 0; const emit = () => { if (emitQ) return; emitQ = 1; Promise.resolve().then(() => { emitQ = 0; const v = view(); cbs.forEach(f => { try { f(v); } catch {} });
      const act = v.status === 'connected' && (v.mic || v.peers.some(p => p.speaking) || (v.mode === 'ptt' && !!v.holder)); if (act !== lastActive) { lastActive = act; fire('ml:voice-activity', { active: act }); } }); };
    const setS = p => { Object.assign(S, p); emit(); };
    const ack = (ev, data, ms = 8000) => new Promise(res => { let done = false; const t = setT(() => { if (!done) { done = true; res({ error: MSG.net, code: 'timeout' }); } }, ms); try { sock.emit(ev, data, r => { if (done) return; done = true; clrT(t); res(r || { error: MSG.net, code: 'net' }); }); } catch { done = true; clrT(t); res({ error: MSG.net, code: 'net' }); } });
    const vibrate = p => { try { if (root.navigator.vibrate && LS.get('ml_vib', '1') !== '0') root.navigator.vibrate(p); } catch {} };
    function cue(f, ms = 70) { if (LS.get('ml_gv_beep', '1') === '0') return; try { const AC = root.AudioContext || root.webkitAudioContext; if (!AC) return; actx = actx || new AC(); const osc = actx.createOscillator(), g = actx.createGain(); osc.frequency.value = f; g.gain.value = 0.05; osc.connect(g); g.connect(actx.destination); osc.start(); osc.stop(actx.currentTime + ms / 1000); } catch {} }

    /* ---------- mikrofon ses işleme ----------
       Zincir: tarayıcının yankı/gürültü/otomatik kazanç süzgeci → alçak geçiren kes (130 Hz altı: motor uğultusu, rüzgâr) → 7 kHz üstü kes (tıslama)
       → sıkıştırıcı (yüksek/alçak ses farkını azaltır) → GÜRÜLTÜ KAPISI. Kapı, ortam gürültü tabanını kendisi öğrenir (yavaş izleyici); konuşma bu tabanın
       üstüne çıkınca açılır, susunca kısılır (tam kapanmaz, -24 dB: ses kesik kesik gelmesin). Hassasiyet yükseldikçe eşik düşer (kısık sesi de yakalar, gürültüyü de).
       SINIR: kapı konuşma sırasındaki sürekli gürültüyü (konuşurken rüzgâr) silemez; yalnız konuşma aralarını temizler. Gerçek kask/rüzgâr ile ayarlanmadı. */
    function buildMic(rs) {
      try {
        const AC = root.AudioContext || root.webkitAudioContext; if (!AC || !root.MediaStream) return rs;
        actx = actx || new AC(); if (actx.state === 'suspended') actx.resume().catch(() => {});
        if (!actx.createMediaStreamDestination || !actx.createDynamicsCompressor) return rs;
        const src = actx.createMediaStreamSource(rs), hp = actx.createBiquadFilter(), lp = actx.createBiquadFilter(), an = actx.createAnalyser(), comp = actx.createDynamicsCompressor(), gate = actx.createGain(), dest = actx.createMediaStreamDestination();
        hp.type = 'highpass'; hp.frequency.value = 130; hp.Q.value = 0.7; lp.type = 'lowpass'; lp.frequency.value = 7000; lp.Q.value = 0.7; an.fftSize = 1024;
        comp.threshold.value = -32; comp.knee.value = 24; comp.ratio.value = 4; comp.attack.value = 0.005; comp.release.value = 0.15; gate.gain.value = 1;
        src.connect(hp); hp.connect(lp); lp.connect(an); lp.connect(comp); comp.connect(gate); gate.connect(dest);
        mic = { src, hp, lp, an, comp, gate, dest, buf: new Float32Array(an.fftSize), floor: -65, lvl: -100, open: true, hold: 0, thr: -50 };
        if (!gateT) gateT = setI(gateTick, 25);
        return dest.stream;
      } catch { mic = null; return rs; }
    }
    function gateTick() {
      const m = mic; if (!m || !actx) return; const now = Date.now(), t = actx.currentTime;
      m.an.getFloatTimeDomainData(m.buf); let sum = 0; for (let i = 0; i < m.buf.length; i++) sum += m.buf[i] * m.buf[i];
      const db = 20 * Math.log10(Math.sqrt(sum / m.buf.length) + 1e-9); m.lvl = db;
      if (!cfg.ns) { m.hp.frequency.setTargetAtTime(20, t, 0.05); m.lp.frequency.setTargetAtTime(20000, t, 0.05); m.gate.gain.setTargetAtTime(1, t, 0.02); m.open = true; return; }
      m.hp.frequency.setTargetAtTime(130, t, 0.05); m.lp.frequency.setTargetAtTime(7000, t, 0.05);
      if (db < m.floor) m.floor += (db - m.floor) * 0.3; else if (!m.open) m.floor += (db - m.floor) * 0.004;      // konuşurken taban yükselmez
      m.floor = Math.max(-78, Math.min(-38, m.floor));
      const sens = cfg.gate / 100, abs = -30 - 28 * sens, margin = 15 - 9 * sens;
      m.thr = Math.max(m.floor + margin, abs);
      if (db > m.thr) { m.hold = now + 300; m.open = true; } else if (now > m.hold) m.open = false;
      m.gate.gain.setTargetAtTime(m.open ? 1 : 0.06, t, m.open ? 0.012 : 0.1);
    }
    function level() { return mic ? { db: mic.lvl, thr: mic.thr, open: mic.open, v: Math.max(0, Math.min(1, (mic.lvl + 80) / 70)), t: Math.max(0, Math.min(1, (mic.thr + 80) / 70)) } : null; }
    function setCfg(p) {
      if ('gate' in p) { cfg.gate = Math.max(0, Math.min(100, +p.gate || 0)); LS.set('ml_gv_gate', String(cfg.gate)); }
      if ('voice' in p) { cfg.voice = Math.max(0, Math.min(100, +p.voice || 0)); LS.set('ml_vol_voice', String(cfg.voice)); peers.forEach(applyAudio); }
      if ('music' in p) { cfg.music = Math.max(0, Math.min(100, +p.music || 0)); LS.set('ml_vol_music', String(cfg.music)); fire('ml:music-volume', { v: cfg.music }); }
      if ('ns' in p) { cfg.ns = !!p.ns; LS.set('ml_gv_ns', cfg.ns ? '1' : '0'); }
      if ('duck' in p) { cfg.duck = !!p.duck; LS.set('ml_duck', cfg.duck ? '1' : '0'); fire('ml:voice-activity', { active: lastActive }); }
    }

    /* ---------- mikrofon ---------- */
    function micOn(on) { if (track) track.enabled = !!on; }
    function setMic(on, announce = true) { micOn(on); if (S.mic !== on) { S.mic = !!on; emit(); } if (announce && S.status === 'connected') sock.emit('gv:status', { mic: !!on }, () => {}); }
    function stopTalk(why) {
      clrI(renewT); renewT = null; const was = S.ptt === 'talking' || S.ptt === 'requesting';
      setMic(false, S.mode !== 'ptt' ? true : false);    // PTT'de sunucu hak bırakınca zaten bilir; yine de durum bildir
      if (S.mode === 'ptt' && was && S.status === 'connected') { sock.emit('gv:status', { mic: false }, () => {}); if (why !== 'lost') sock.emit('gv:floor', { act: 'release' }, () => {}); }
      if (S.ptt !== 'idle' && S.ptt !== 'denied') setS({ ptt: 'idle' });
    }
    async function pttDown() {
      if (S.status !== 'connected' || S.mode !== 'ptt') return;
      if (S.latch && S.ptt === 'talking') return pttUp(true);                // kilit modunda ikinci basış keser
      if (S.ptt === 'requesting' || S.ptt === 'talking') return;
      cancelReq = false; clrT(deniedT); setS({ ptt: 'requesting' });
      const r = await ack('gv:floor', { act: 'acquire' }, 5000);
      if (S.status !== 'connected' || S.mode !== 'ptt') return;
      if (!r || !r.granted) { vibrate([60, 40, 60]); cue(220, 120); setS({ ptt: 'denied', holder: r && r.holder ? r.holder : S.holder, deniedBy: r && r.holder ? r.holder.name : '' }); deniedT = setT(() => { if (S.ptt === 'denied') setS({ ptt: 'idle' }); }, 1800); return; }
      if (cancelReq && !S.latch) { sock.emit('gv:floor', { act: 'release' }, () => {}); setS({ ptt: 'idle' }); return; }
      micOn(true); S.mic = true; S.ptt = 'talking'; sock.emit('gv:status', { mic: true }, () => {}); vibrate(25); cue(880, 50); emit();
      renewT = setI(async () => { const rr = await ack('gv:floor', { act: 'renew' }, 5000); if (!rr || !rr.granted) { stopTalk('lost'); cue(220, 120); vibrate([80, 40, 80]); } }, 7000);
    }
    function pttUp(force) { if (S.mode !== 'ptt') return; if (S.ptt === 'requesting') { cancelReq = true; return; } if (S.latch && !force) return; if (S.ptt === 'talking') { stopTalk('released'); cue(660, 40); } }
    function toggleMic() { if (S.status !== 'connected' || S.mode !== 'open') return; setMic(!S.mic); vibrate(20); }
    function setLatch(b) { S.latch = !!b; LS.set('ml_gv_latch', b ? '1' : '0'); if (!b && S.ptt === 'talking') stopTalk('released'); emit(); }
    async function setMode(m) { if (S.status !== 'connected') return { error: MSG.notin }; const r = await ack('gv:mode', { mode: m }); if (r && r.error) cbs.forEach(f => f({ ...view(), toast: r.error })); return r; }
    async function revoke() { return ack('gv:revoke', {}); }

    /* ---------- eşler ---------- */
    const sendSig = (to, data) => sock.emit('gv:signal', { to, data }, () => {});
    function applyAudio(p) { if (p.audio) { p.audio.muted = S.mode === 'ptt' ? !(S.holder && S.holder.id === p.id) : false; try { p.audio.volume = cfg.voice / 100; } catch {} } }
    function applyAll() { peers.forEach(applyAudio); }
    function closePc(p) { try { if (p.pc) { p.pc.onicecandidate = p.pc.ontrack = p.pc.onconnectionstatechange = null; p.pc.close(); } } catch {} p.pc = null; p.haveRemote = false; p.cand = []; if (p.audio) { try { p.audio.srcObject = null; p.audio.remove(); } catch {} p.audio = null; } p.an = null; p.speaking = false; }
    function newPc(p) {
      closePc(p); const pc = new RTC({ iceServers: ice }); p.pc = pc; p.conn = 'connecting';
      if (track) pc.addTrack(track, stream);
      pc.onicecandidate = e => { if (e.candidate) sendSig(p.id, { candidate: e.candidate }); };
      pc.ontrack = e => {
        const s = e.streams && e.streams[0] ? e.streams[0] : new root.MediaStream([e.track]);
        if (!p.audio) { const a = root.document.createElement('audio'); a.autoplay = true; a.playsInline = true; a.dataset.peer = p.id; (audioHost || root.document.body).appendChild(a); p.audio = a; }
        p.audio.srcObject = s; applyAudio(p); const pr = p.audio.play && p.audio.play(); if (pr && pr.catch) pr.catch(() => {}); meterFor(p, s);
      };
      pc.onconnectionstatechange = () => {
        const st = pc.connectionState;
        if (st === 'connected') { p.conn = 'connected'; p.tries = 0; clrT(p.dT); } else if (st === 'connecting') p.conn = 'connecting';
        else if (st === 'disconnected') { clrT(p.dT); p.dT = setT(() => { if (p.pc === pc && pc.connectionState === 'disconnected') retry(p); }, 6000); }
        else if (st === 'failed') retry(p);
        emit();
      };
      return pc;
    }
    async function call(p) {
      if (!RTC) return; const pc = newPc(p);
      try { const offer = await pc.createOffer(); await pc.setLocalDescription(offer); sendSig(p.id, { sdp: pc.localDescription }); } catch { p.conn = 'failed'; emit(); }
    }
    function retry(p) {
      p.conn = 'failed'; emit(); clrT(p.rT); if (S.status !== 'connected' || !peers.has(p.id) || (p.tries || 0) >= 4) return;
      p.tries = (p.tries || 0) + 1;
      if (S.meId < p.id) p.rT = setT(() => { if (S.status === 'connected' && peers.has(p.id)) call(p); }, 1500 * p.tries);   // yalnız bir taraf yeniden arar (çakışma olmasın)
    }
    async function onSignal({ from, data }) {
      const p = peers.get(from); if (!p || !data || S.status === 'idle') return;
      try {
        if (data.sdp && data.sdp.type === 'offer') {
          const pc = newPc(p); await pc.setRemoteDescription(data.sdp); p.haveRemote = true;
          for (const c of p.cand.splice(0)) await pc.addIceCandidate(c).catch(() => {});
          const ans = await pc.createAnswer(); await pc.setLocalDescription(ans); sendSig(from, { sdp: pc.localDescription });
        } else if (data.sdp && data.sdp.type === 'answer' && p.pc && p.pc.signalingState === 'have-local-offer') {
          await p.pc.setRemoteDescription(data.sdp); p.haveRemote = true; for (const c of p.cand.splice(0)) await p.pc.addIceCandidate(c).catch(() => {});
        } else if (data.candidate) {
          if (p.pc && p.haveRemote) await p.pc.addIceCandidate(data.candidate).catch(() => {}); else p.cand.push(data.candidate);
        }
      } catch { p.conn = 'failed'; emit(); }
    }
    function addPeer(i) { let p = peers.get(i.id); if (!p) { p = { id: i.id, uid: i.uid, name: i.name || 'Sürücü', mic: !!i.mic, conn: 'waiting', pc: null, audio: null, speaking: false, tries: 0, cand: [], haveRemote: false }; peers.set(i.id, p); } return p; }
    function dropPeer(id) { const p = peers.get(id); if (!p) return; clrT(p.rT); clrT(p.dT); closePc(p); peers.delete(id); emit(); }

    /* ---------- konuşan göstergesi (alınan sesin düzeyi) ---------- */
    function meterFor(p, s) {
      try { const AC = root.AudioContext || root.webkitAudioContext; if (!AC) return; actx = actx || new AC(); if (actx.state === 'suspended') actx.resume().catch(() => {});
        const src = actx.createMediaStreamSource(s), an = actx.createAnalyser(); an.fftSize = 512; src.connect(an); p.an = an; p.buf = new Uint8Array(an.fftSize);
      } catch {}
      if (!meterT) meterT = setI(meter, 150);
    }
    function meter() {
      let ch = false, any = false; const t = Date.now();
      for (const p of peers.values()) {
        if (!p.an) continue; any = true; p.an.getByteTimeDomainData(p.buf); let s = 0; for (let i = 0; i < p.buf.length; i++) { const d = (p.buf[i] - 128) / 128; s += d * d; }
        const rms = Math.sqrt(s / p.buf.length), audible = p.audio && !p.audio.muted;
        if (rms > 0.02 && audible) p.last = t; const sp = !!p.last && t - p.last < 500; if (sp !== p.speaking) { p.speaking = sp; ch = true; }
      }
      if (!any) { clrI(meterT); meterT = null; } if (ch) emit();
    }

    /* ---------- katıl / ayrıl ---------- */
    async function join(gid, name) {
      if (!RTC) { setS({ status: 'failed', error: MSG.rtc, errorCode: 'rtc' }); return { error: MSG.rtc }; }
      if (S.status === 'connected' && S.gid === gid) return { ok: true };
      if (S.status !== 'idle') await leave();
      const seq = ++joinSeq; setS({ status: 'connecting', gid, name: name || '', error: null, errorCode: '', holder: null, ptt: 'idle', mic: false });
      try { const r = await fetchF('/api/gvoice/ice', { credentials: 'same-origin' }); if (r.ok) { const j = await r.json(); if (Array.isArray(j.iceServers) && j.iceServers.length) ice = j.iceServers; S.turn = !!j.turn; S.max = j.max || S.max; } } catch {}
      if (!root.isSecureContext && root.location && !/^(localhost|127\.)/.test(root.location.hostname)) return fail('mic_https');
      try { rawStream = await getMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1,
        advanced: [{ googEchoCancellation: true, googNoiseSuppression: true, googNoiseSuppression2: true, googHighpassFilter: true, googAutoGainControl: true, voiceIsolation: true }] } }); }
      catch (e) { return fail(e && (e.name === 'NotFoundError' || e.name === 'OverconstrainedError') ? 'mic_missing' : 'mic_denied'); }
      if (!rawStream.getAudioTracks()[0]) { try { rawStream.getTracks().forEach(t => t.stop()); } catch {} rawStream = null; return fail('mic_missing'); }
      stream = buildMic(rawStream); track = stream.getAudioTracks()[0]; if (!track) return fail('mic_missing');
      try { track.contentHint = 'speech'; } catch {}                           // kodlayıcıya «konuşma» ipucu (müzik modu değil)
      track.enabled = false;
      if (seq !== joinSeq) { cleanupMedia(); return { error: 'iptal' }; }
      const r = await ack('gv:join', { gid }); if (seq !== joinSeq) { cleanupMedia(); return { error: 'iptal' }; }
      if (!r || r.error) { cleanupMedia(); return fail(r && r.code ? r.code : 'net', r && r.error); }
      setS({ status: 'connected', meId: r.id, meUid: r.uid, mode: r.mode, holder: r.holder, leader: !!r.leader, max: r.max || S.max });
      peers.clear(); for (const i of r.peers || []) { const p = addPeer(i); call(p); }
      applyAll(); cue(660, 60); emit(); return { ok: true };
    }
    function fail(code, text) { setS({ status: 'failed', error: MSG[code] || text || MSG.net, errorCode: code }); return { error: S.error, code }; }
    function cleanupMedia() {
      try { if (stream) stream.getTracks().forEach(t => t.stop()); } catch {} try { if (rawStream && rawStream !== stream) rawStream.getTracks().forEach(t => t.stop()); } catch {}
      if (mic) { try { mic.src.disconnect(); mic.gate.disconnect(); } catch {} } mic = null; clrI(gateT); gateT = null; stream = null; rawStream = null; track = null;
    }
    async function leave() {
      joinSeq++; clrI(renewT); renewT = null; clrT(deniedT);
      if (S.status === 'connected' && sock && sock.connected !== false) { try { sock.emit('gv:leave', {}, () => {}); } catch {} }
      for (const p of [...peers.values()]) { clrT(p.rT); clrT(p.dT); closePc(p); } peers.clear(); cleanupMedia(); clrI(meterT); meterT = null;
      setS({ status: 'idle', gid: '', name: '', error: null, errorCode: '', holder: null, ptt: 'idle', mic: false, meId: '', leader: false });
    }

    /* ---------- soket olayları ---------- */
    if (sock) {
      sock.on('gv:peer-joined', i => { if (S.status !== 'connected' || peers.has(i.id)) return; addPeer(i); cue(520, 40); emit(); });          // yeni gelen bize teklif gönderir
      sock.on('gv:peer-left', i => { dropPeer(i.id); if (S.status === 'connected') cue(330, 40); });
      sock.on('gv:signal', onSignal);
      sock.on('gv:mode', m => { if (S.status !== 'connected') return; stopTalk('lost'); setS({ mode: m.mode, holder: null }); applyAll(); cbs.forEach(f => f({ ...view(), toast: 'Mod: ' + (m.mode === 'ptt' ? 'bas-konuş' : 'açık mikrofon') })); });
      sock.on('gv:floor', f => { if (S.status !== 'connected') return; S.holder = f.holder || null; if (S.ptt === 'talking' && (!f.holder || f.holder.id !== S.meId)) stopTalk('lost'); applyAll(); emit(); });
      sock.on('gv:status', i => { const p = peers.get(i.id); if (p && p.mic !== i.mic) { p.mic = i.mic; emit(); } });
      sock.on('gv:revoked', () => { stopTalk('lost'); vibrate([80, 40, 80]); cbs.forEach(f => f({ ...view(), toast: 'Lider söz hakkını aldı.' })); });
      sock.on('gv:kicked', () => { leave().then(() => cbs.forEach(f => f({ ...view(), toast: 'Gruptan çıkarıldığın için sesten ayrıldın.' }))); });
      sock.on('gv:taken', () => { leave().then(() => cbs.forEach(f => f({ ...view(), toast: 'Sesli görüşme başka bir cihazda açıldı.' }))); });
      sock.on('disconnect', () => { if (S.status === 'connected') { stopTalk('lost'); setS({ status: 'reconnecting' }); } });
      sock.on('connect', async () => {   // bağlantı geri geldi: odaya yeniden gir, eşleri baştan kur
        if (S.status !== 'reconnecting') return; const gid = S.gid; for (const p of [...peers.values()]) { clrT(p.rT); clrT(p.dT); closePc(p); } peers.clear();
        const r = await ack('gv:join', { gid }); if (!r || r.error) { await leave(); setS({ status: 'failed', error: (r && r.error) || MSG.net }); return; }
        setS({ status: 'connected', meId: r.id, mode: r.mode, holder: r.holder, leader: !!r.leader }); for (const i of r.peers || []) call(addPeer(i)); applyAll(); emit();
      });
    }
    if (root.addEventListener) {
      root.addEventListener('pagehide', () => { if (S.status !== 'idle') leave(); });
      root.document && root.document.addEventListener('visibilitychange', () => { if (root.document.hidden && S.mode === 'ptt' && S.ptt === 'talking' && !S.latch) stopTalk('released'); });
    }
    return { track: () => track, cfg, setCfg, level, join, leave, pttDown, pttUp, toggleMic, setMode, setLatch, revoke, state: view, onChange: f => { cbs.add(f); return () => cbs.delete(f); }, setAudioHost: h => { audioHost = h; }, _peers: peers };
  }

  /* ---------- Konuşma çubuğu (ses açıkken her ekranda, nav'ın üstünde) ---------- */
  function mountBar(ctl, opts = {}) {
    const d = root.document; if (d.getElementById('gvBar')) return d.getElementById('gvBar')._api;
    const st = d.createElement('style'); st.textContent = `
#gvBar{position:fixed;left:8px;right:8px;bottom:calc(var(--nav,64px) + env(safe-area-inset-bottom,0px) + 8px);z-index:2000;max-width:30rem;margin:0 auto;background:linear-gradient(180deg,#0b2b3d 0%,var(--deep,#031420) 100%);color:#F4EFE6;border:1px solid rgba(255,255,255,.12);border-radius:24px;padding:14px;box-shadow:0 14px 40px rgba(0,0,0,.6),0 0 0 1px rgba(234,134,33,.25);font:14px/1.35 var(--font,system-ui,sans-serif);display:none;max-height:calc(100dvh - var(--nav,64px) - 24px);overflow:auto}
#gvBar.on{display:block}#gvBar .r1{display:flex;align-items:center;justify-content:space-between;gap:10px}#gvBar .ti{min-width:0}#gvBar .t{font-size:17px;font-weight:700;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#gvBar .sub{color:#9fb3c0;font-size:12.5px;min-height:17px;display:flex;align-items:center;gap:6px}#gvBar .sub::before{content:"";width:8px;height:8px;border-radius:50%;background:#5CC48E;flex:none}#gvBar[data-c=wait] .sub::before{background:#F2A64E}
#gvBar button{font:inherit;color:#F4EFE6;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.14);border-radius:14px;min-height:44px;padding:0 14px;cursor:pointer;touch-action:manipulation;transition:background .15s}
#gvBar .rb{display:flex;gap:8px;align-items:center;flex:none}#gvBar .vs{width:44px;padding:0;border-radius:50%;display:inline-flex;align-items:center;justify-content:center}#gvBar .vs[aria-expanded=true]{background:var(--accent,#EA8621);color:var(--ink,#031420);border-color:transparent}#gvBar .vs svg{width:22px;height:22px}
#gvBar .leave{font-size:13px;font-weight:600;color:#fca5a5;border-color:rgba(252,165,165,.35);background:rgba(220,38,38,.12)}
#gvBar .pp{display:flex;gap:10px;overflow-x:auto;padding:8px 2px 2px;scrollbar-width:none}#gvBar .pp::-webkit-scrollbar{display:none}
#gvBar .pe{flex:none;width:52px;text-align:center}#gvBar .av{width:40px;height:40px;margin:0 auto 2px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:17px;background:#123a52;color:#F4EFE6;box-shadow:0 0 0 2px transparent;transition:box-shadow .15s}
#gvBar .pe.sp .av{box-shadow:0 0 0 3px #5CC48E,0 0 14px rgba(92,196,142,.6)}#gvBar .pe.me .av{background:var(--accent,#EA8621);color:var(--ink,#031420)}#gvBar .pe.off{opacity:.5}
#gvBar .pe small{display:block;font-size:11px;color:#9fb3c0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#gvBar .spk{font-size:13.5px;min-height:18px;margin:2px 0 8px;color:#9fb3c0}#gvBar .spk.me{color:#5CC48E;font-weight:600}
#gvBar .main{width:100%;min-height:80px;display:flex;align-items:center;justify-content:center;gap:12px;font-size:18px;font-weight:700;background:var(--accent,#EA8621);color:var(--ink,#031420);border:0;border-radius:22px;box-shadow:0 6px 18px rgba(234,134,33,.35);user-select:none;-webkit-user-select:none;touch-action:none;-webkit-touch-callout:none}
#gvBar .main svg{width:30px;height:30px;flex:none}#gvBar .main[data-s=talk]{background:#5CC48E;box-shadow:0 0 0 6px rgba(92,196,142,.25),0 6px 18px rgba(92,196,142,.4)}#gvBar .main[data-s=wait]{background:#4b5f6c;color:#fff;box-shadow:none}#gvBar .main[data-s=deny]{background:#c2410c;color:#fff;box-shadow:none}#gvBar .main[data-s=open]{background:#5CC48E;box-shadow:0 6px 18px rgba(92,196,142,.4)}#gvBar .main[data-s=off]{background:#2c4252;color:#cbd5db;box-shadow:none}
#gvBar .tools{margin:0 0 14px;display:grid;gap:10px}#gvBar .tg small.lb{display:block;font-size:12px;color:#9fb3c0;margin:0 2px 4px}
#gvBar .seg{display:grid;grid-template-columns:1fr 1fr;gap:4px;padding:4px;border-radius:16px;background:rgba(255,255,255,.06)}#gvBar .seg button{border:0;background:transparent;min-height:44px;font-size:13.5px;font-weight:600;border-radius:12px;color:#C9D0D6}#gvBar .seg button[aria-pressed=true]{background:var(--accent,#EA8621);color:var(--ink,#031420)}
#gvBar .hint{font-size:12.5px;color:#9fb3c0;margin:6px 2px 0}#gvBar .tools .rv{width:100%;font-size:13px}
#gvBar .vp{margin:12px 0 2px;padding:12px;border-radius:18px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1)}#gvBar .vp[hidden]{display:none}
#gvBar .vp .vr{margin-bottom:12px}#gvBar .vp label{display:flex;justify-content:space-between;font-size:13.5px;font-weight:600;margin-bottom:2px}#gvBar .vp output{color:#F2A64E;font-weight:600}
#gvBar .vp input[type=range]{width:100%;min-height:32px;accent-color:#EA8621}#gvBar .vp small{display:block;color:#9fb3c0;font-size:12px;line-height:1.4}
#gvBar .vp .mt{position:relative;height:8px;border-radius:4px;background:rgba(255,255,255,.1);overflow:hidden;margin:2px 0 6px}#gvBar .vp .mt i{position:absolute;left:0;top:0;bottom:0;width:0;background:#5CC48E}#gvBar .vp .mt i.cl{background:#6b7c88}#gvBar .vp .mt b{position:absolute;top:0;bottom:0;width:2px;background:#EA8621}
#gvBar .vp .vt{display:grid;gap:8px}#gvBar .vp .vt button{display:flex;align-items:center;justify-content:space-between;min-height:48px;font-size:13.5px;text-align:left}#gvBar .vp .vt button::after{content:attr(data-st);font-weight:700;color:#9fb3c0}#gvBar .vp .vt button[aria-pressed=true]::after{color:#5CC48E}
#gvBar .vp .vb{position:sticky;bottom:-14px;z-index:2;display:flex;gap:8px;margin:14px -12px -12px;padding:10px 12px 12px;border-top:1px solid rgba(255,255,255,.12);background:#0b2b3d;border-radius:0 0 18px 18px}#gvBar .vp .vb button{flex:1;min-height:48px;border-radius:12px;font-weight:700;font-size:15px;background:rgba(255,255,255,.1);color:#F4EFE6}#gvBar .vp .vb button.sv{flex:1.4;background:#EA8621;color:#031420}
#gvBar .warn{color:#fdba74;font-size:12.5px;margin-top:10px}
@media (prefers-reduced-motion:reduce){#gvBar *{transition:none!important}}`;
    d.head.appendChild(st);
    const bar = d.createElement('div'); bar.id = 'gvBar'; bar.setAttribute('role', 'region'); bar.setAttribute('aria-label', 'Grup Sesi');
    bar.innerHTML = `<div class="r1"><div class="ti"><b class="t">Grup Sesi</b><div class="sub s"></div></div><div class="rb"><button type="button" class="vs" aria-label="Ses Ayarları" aria-expanded="false" title="Ses Ayarları"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/></svg></button><button type="button" class="leave" aria-label="Sesten Ayrıl">Ayrıl</button></div></div>
      <div class="pp" aria-label="Konuşmacılar"></div><div class="spk" aria-live="polite"></div>
      <button type="button" class="main"></button>
      <div class="vp" hidden>
        <div class="tools"></div>
        <div class="vr"><label for="gvGate">Mikrofon Hassasiyeti <output class="o-gate"></output></label><input id="gvGate" type="range" min="0" max="100" step="1"><div class="mt" aria-hidden="true"><i></i><b></b></div><small>Konuşurken çubuk turuncu çizgiyi geçmeli. Rüzgâr ve motor sesi karışıyorsa hassasiyeti düşür; sesin kesiliyorsa artır.</small></div>
        <div class="vr"><label for="gvVoice">Konuşma Sesi <output class="o-voice"></output></label><input id="gvVoice" type="range" min="0" max="100" step="1"></div>
        <div class="vr"><label for="gvMusic">Müzik Sesi <output class="o-music"></output></label><input id="gvMusic" type="range" min="0" max="100" step="1"></div>
        <div class="vt"><button type="button" data-v="ns" aria-pressed="true">Gürültü Filtresi</button><button type="button" data-v="duck" aria-pressed="true">Konuşurken Müziği Kıs</button></div>
        <div class="vb"><button type="button" class="cn" data-vb="cancel">Vazgeç</button><button type="button" class="sv" data-vb="save">Kaydet ve Çık</button></div>
      </div><div class="warn" hidden></div>`;
    d.body.appendChild(bar);
    const $ = s => bar.querySelector(s), main = $('.main'), tools = $('.tools'), warn = $('.warn'); let toastT = 0;
    const names = v => v.peers.filter(p => p.speaking).map(p => p.name);
    const MIC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>';
    const ini = n => (String(n || '?').trim()[0] || '?').toLocaleUpperCase('tr');
    const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const HINT = { ptt: 'Düğmeye basılı tutarak konuşursun. Aynı anda yalnızca bir kişi konuşabilir.', open: 'Herkes kendi mikrofonunu açıp kapatır. Aynı anda birden fazla kişi konuşabilir.' };
    function seg(label, key, items) { return `<div class="tg" data-k="${key}"><small class="lb">${label}</small><div class="seg" role="group" aria-label="${label}">${items.map(i => `<button type="button" data-act="${i[0]}" aria-pressed="${!!i[2]}">${i[1]}</button>`).join('')}</div></div>`; }
    function paint(v) {
      bar.classList.toggle('on', v.status !== 'idle' && v.status !== 'failed');
      if (!bar.classList.contains('on')) return;
      bar.dataset.c = v.status === 'connected' ? 'ok' : 'wait';
      $('.t').textContent = 'Grup Sesi' + (v.name ? ' · ' + v.name : '');
      const conn = v.peers.filter(p => p.conn === 'connected').length, bad = v.peers.filter(p => p.conn === 'failed').length;
      $('.s').textContent = v.status === 'connecting' ? 'Bağlanıyor…' : v.status === 'reconnecting' ? 'Bağlantı koptu, yeniden bağlanıyor…' : v.count + ' kişi · ' + (v.mode === 'ptt' ? 'Bas-Konuş' : 'Açık Mikrofon') + (v.peers.length ? ' · ' + conn + '/' + v.peers.length + ' bağlı' : '');
      // katılımcılar: konuşanın halkası yanar
      const talkId = v.mode === 'ptt' && v.holder ? v.holder.id : null, spkIds = new Set(v.mode === 'ptt' ? (talkId ? [talkId] : []) : v.peers.filter(p => p.speaking).map(p => p.id));
      const pk = 'me' + (v.mic ? 1 : 0) + '|' + v.peers.map(p => p.id + p.name + (spkIds.has(p.id) ? 1 : 0) + (p.conn === 'connected' ? 1 : 0)).join(',');
      const pp = $('.pp'); if (pp._k !== pk) { pp._k = pk;
        pp.innerHTML = `<div class="pe me${v.mic ? ' sp' : ''}"><div class="av">${esc(ini('Sen'))}</div><small>Sen</small></div>` + v.peers.map(p => `<div class="pe${spkIds.has(p.id) ? ' sp' : ''}${p.conn === 'connected' ? '' : ' off'}"><div class="av">${esc(ini(p.name))}</div><small>${esc(p.name)}</small></div>`).join(''); }
      const sp = v.mic ? ['Sen'] : []; (v.mode === 'ptt' && v.holder && v.holder.id !== v.meId ? [v.holder.name] : names(v)).forEach(n => sp.push(n));
      const spk = $('.spk'); spk.textContent = sp.length ? 'Konuşuyor: ' + sp.join(', ') : (v.peers.length ? 'Şu an kimse konuşmuyor' : 'Odada yalnızsın'); spk.classList.toggle('me', !!v.mic);
      // ana düğme
      let label, s;
      if (v.status !== 'connected') { label = v.status === 'connecting' ? 'Bağlanıyor…' : 'Yeniden Bağlanıyor…'; s = 'wait'; }
      else if (v.mode === 'ptt') {
        if (v.ptt === 'talking') { label = v.latch ? 'Konuşuyorsun · Bitirmek İçin Dokun' : 'Konuşuyorsun'; s = 'talk'; }
        else if (v.ptt === 'requesting') { label = 'Söz İsteniyor…'; s = 'wait'; }
        else if (v.ptt === 'denied') { label = (v.deniedBy ? v.deniedBy + ' konuşuyor' : 'Söz Alınamadı'); s = 'deny'; }
        else if (v.holder && v.holder.id !== v.meId) { label = v.holder.name + ' konuşuyor'; s = 'wait'; }
        else { label = v.latch ? 'Konuşmak İçin Dokun' : 'Basılı Tut ve Konuş'; s = 'idle'; }
      } else { label = v.mic ? 'Mikrofonu Kapat' : 'Mikrofonu Aç'; s = v.mic ? 'open' : 'off'; }
      main.innerHTML = MIC + '<span></span>'; main.lastChild.textContent = label; main.dataset.s = s; main.setAttribute('aria-pressed', String(!!v.mic)); main.disabled = v.status !== 'connected';
      // seçenekler: mod (yalnız lider değiştirir), düğme davranışı, söz hakkını al
      const tk = v.mode + (v.leader ? 'L' : '') + (v.latch ? '1' : '0') + (v.holder && v.leader ? 'h' : '');
      if (tools._k !== tk) { tools._k = tk; let h = '';
        if (v.leader) h += seg('Konuşma Modu', 'mode', [['m-ptt', 'Bas-Konuş', v.mode === 'ptt'], ['m-open', 'Açık Mikrofon', v.mode === 'open']]);
        if (v.mode === 'ptt') h += seg('Düğme Davranışı', 'latch', [['l-hold', 'Basılı Tut', !v.latch], ['l-tap', 'Dokun-Konuş', v.latch]]);
        h += `<p class="hint">${HINT[v.mode]}${v.leader ? '' : ' Modu grup lideri belirler.'}</p>`;
        if (v.leader && v.mode === 'ptt' && v.holder) h += '<button type="button" class="rv" data-act="revoke">Söz Hakkını Al</button>';
        tools.innerHTML = h; }
      warn.hidden = !(bad || v.error); warn.textContent = v.error ? v.error : bad ? bad + ' kişiyle bağlantı kurulamadı (ağ engelli olabilir). Yeniden deneniyor.' : '';
      if (v.toast) { warn.hidden = false; warn.textContent = v.toast; clearTimeout(toastT); toastT = setTimeout(() => paint(ctl.state()), 5000); }
    }
    const down = e => { e.preventDefault(); try { main.setPointerCapture(e.pointerId); } catch {} const v = ctl.state(); if (v.mode === 'ptt') ctl.pttDown(); };
    const up = e => { e.preventDefault(); const v = ctl.state(); if (v.mode === 'ptt') ctl.pttUp(); };
    main.addEventListener('pointerdown', down); main.addEventListener('pointerup', up); main.addEventListener('pointercancel', up); main.addEventListener('lostpointercapture', up); main.addEventListener('contextmenu', e => e.preventDefault());
    main.addEventListener('click', () => { const v = ctl.state(); if (v.mode === 'open') ctl.toggleMic(); });
    main.addEventListener('keydown', e => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); const v = ctl.state(); if (v.mode === 'ptt') ctl.pttDown(); else ctl.toggleMic(); } });
    main.addEventListener('keyup', e => { if (e.key === ' ' || e.key === 'Enter') { const v = ctl.state(); if (v.mode === 'ptt') ctl.pttUp(); } });
    tools.addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; const a = b.dataset.act; if (a === 'l-hold') ctl.setLatch(false); else if (a === 'l-tap') ctl.setLatch(true); else if (a === 'm-ptt') ctl.setMode('ptt'); else if (a === 'm-open') ctl.setMode('open'); else if (a === 'revoke') ctl.revoke(); });
    $('.leave').addEventListener('click', () => ctl.leave());
    // Ses ayarları paneli: küçük hoparlör simgesi açar; konuşma sesi, müzik sesi ve mikrofon hassasiyeti ayrı ayarlanır
    const vs = $('.vs'), vp = $('.vp'), rg = { gate: $('#gvGate'), voice: $('#gvVoice'), music: $('#gvMusic') }; let meterI = 0;
    const syncP = () => { const c = ctl.cfg; for (const k of ['gate', 'voice', 'music']) { rg[k].value = c[k]; $('.o-' + k).textContent = '%' + Math.round(c[k]); }
      vp.querySelectorAll('[data-v]').forEach(b => { const on = c[b.dataset.v]; b.setAttribute('aria-pressed', String(!!on)); b.textContent = b.dataset.v === 'ns' ? 'Gürültü Filtresi' : 'Konuşurken Müziği Kıs'; b.dataset.st = on ? 'Açık' : 'Kapalı'; }); };
    const tickM = () => { const l = ctl.level(), i = vp.querySelector('.mt i'), b = vp.querySelector('.mt b'); if (!l) { i.style.width = '0'; return; } i.style.width = Math.round(l.v * 100) + '%'; i.classList.toggle('cl', !l.open); b.style.left = Math.round(l.t * 100) + '%'; };
    let snap = null;   // panel açılırken ayarların kopyası: «Vazgeç» bunu geri yükler, «Kaydet ve Çık» mevcut değerleri korur
    const closeP = () => { vp.hidden = true; vs.setAttribute('aria-expanded', 'false'); clearInterval(meterI); snap = null; };
    vs.addEventListener('click', () => { const on = vp.hidden; if (!on) return closeP(); vp.hidden = false; vs.setAttribute('aria-expanded', 'true'); snap = { gate: ctl.cfg.gate, voice: ctl.cfg.voice, music: ctl.cfg.music, ns: ctl.cfg.ns, duck: ctl.cfg.duck }; clearInterval(meterI); syncP(); tickM(); meterI = setInterval(tickM, 100); });
    vp.querySelector('.vb').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; if (b.dataset.vb === 'cancel' && snap) ctl.setCfg(snap); syncP(); closeP(); vs.focus(); });
    for (const k of Object.keys(rg)) rg[k].addEventListener('input', () => { ctl.setCfg({ [k]: Number(rg[k].value) }); $('.o-' + k).textContent = '%' + Math.round(Number(rg[k].value)); });
    vp.querySelector('.vt').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; ctl.setCfg({ [b.dataset.v]: !ctl.cfg[b.dataset.v] }); syncP(); });
    ctl.setAudioHost(bar);
    const off = ctl.onChange(v => { paint(v); if (!bar.classList.contains('on') && !vp.hidden) { vp.hidden = true; vs.setAttribute('aria-expanded', 'false'); clearInterval(meterI); } }); const api = { el: bar, destroy() { clearInterval(meterI); off(); bar.remove(); st.remove(); } }; bar._api = api; paint(ctl.state()); return api;
  }

  root.GroupVoice = { create, mountBar, MSG };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.GroupVoice;
})(typeof window !== 'undefined' ? window : globalThis);
