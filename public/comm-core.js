'use strict';
/* İletişim katmanı çekirdeği (tarayıcı + Node ortak; ağ/ses YOK, taşıma dışarıdan verilir). Aşama 3.
   ICommunicationService (tek arayüz): connect() disconnect() mute() unmute() pausePlayback() resumePlayback()
     + olaylar on('speakers', fn(kimlikler[])) / on('state', fn('connected'|'disconnected'|'reconnecting')) ; alanlar connected, muted.
   Taşıma (transport) sözleşmesi: { connect():Promise, disconnect():Promise, setMic(bool), setPlayback(bool), onSpeakers(fn), onState(fn) }.
   Tek sürüş: ağ yok (createSoloService). Grup: createGroupService(transport) — LiveKit/WebRTC bağdaştırıcısı taşımayı sağlar.
   KRİTİK KURAL (bindComms): telefon araması BAĞLANTIYI KOPARMAZ; yalnız oynatma durdurulur + mikrofon susturulur
   (karar audio-core plan()'ından gelir: interkom 'pause'). Arama bitince oynatma/mikrofon geri gelir; bağlantı bu arada
   düşmüşse hemen yeniden bağlanılır. Kullanıcının kendi sessize alması aramadan etkilenmez (aramadan sonra da sessiz kalır). */
(function (root) {
  function emitter() { const m = {}; return { on(e, fn) { (m[e] = m[e] || []).push(fn); return () => { m[e] = (m[e] || []).filter(x => x !== fn); }; }, emit(e, a) { (m[e] || []).slice().forEach(fn => { try { fn(a); } catch (_) {} }); } }; }
  function createSoloService() {
    const em = emitter(); const s = { connected: false, muted: false, playback: true, mic: false };
    return Object.assign(s, {
      on: em.on, async connect() { s.connected = true; em.emit('state', 'connected'); }, async disconnect() { s.connected = false; em.emit('state', 'disconnected'); },
      mute() { s.muted = true; }, unmute() { s.muted = false; }, pausePlayback() { s.playback = false; }, resumePlayback() { s.playback = true; },
    });
  }
  function createGroupService(tr) {
    const em = emitter(); const s = { connected: false, muted: false, playback: true, mic: false };
    const applyMic = () => { const on = s.connected && !s.muted && s.playback; s.mic = on; if (s.connected) tr.setMic(on); };   // oynatma askıdaysa mikrofon da kapalı
    tr.onSpeakers(ids => em.emit('speakers', ids));
    tr.onState(st => { if (st === 'connected') s.connected = true; else if (st === 'disconnected') s.connected = false;   // 'reconnecting': taşıma kendi toparlıyor, oda hâlâ bizim
      em.emit('state', st); if (s.connected) { tr.setPlayback(s.playback); applyMic(); } });
    return Object.assign(s, {
      on: em.on,
      async connect() { if (s.connected) return; await tr.connect(); s.connected = true; tr.setPlayback(s.playback); applyMic(); em.emit('state', 'connected'); },
      async disconnect() { if (!s.connected) return; await tr.disconnect(); s.connected = false; s.mic = false; em.emit('state', 'disconnected'); },
      mute() { s.muted = true; applyMic(); }, unmute() { s.muted = false; applyMic(); },
      pausePlayback() { s.playback = false; if (s.connected) tr.setPlayback(false); applyMic(); },
      resumePlayback() { s.playback = true; if (s.connected) tr.setPlayback(true); applyMic(); },
    });
  }
  // Ses durum makinesine bağlar. `localSpeaking` (isteğe bağlı) kendi konuşmanı da ducking'e katar.
  // Ağ kesintisi: tünel/köprüde oda düşerse üstel geri çekilme (0,5→1→2→4→8→10 sn, ±%20 sapma) ile yeniden bağlanır;
  // çevrimdışıyken deneme HARCAMAZ (1 sn'de bir bakar), `notifyOnline()` ile hemen dener; aramadayken denemez (telefon önceliği).
  const BACKOFF = [500, 1000, 2000, 4000, 8000, 10000];
  function bindComms(core, service, opts) {
    const o = opts || {}, E = (o.events || root.AudioCore || require('./audio-core.js')).Events || (o.events || {}).Events;
    const setT = o.setTimer || ((fn, ms) => setTimeout(fn, ms)), clrT = o.clearTimer || (t => clearTimeout(t)), rnd = o.random || Math.random, online = o.online || (() => true);
    let wasGroup = false, wantConn = false, conn = Promise.resolve(), attempt = 0, timer = null;
    const run = fn => (conn = conn.then(fn).catch(e => { if (o.onError) o.onError(e); }));
    const canTry = () => wantConn && core.ctx.base === 'GROUP_RIDE' && core.plan().channels.intercom.act === 'play';
    const connectNow = () => run(async () => {
      if (service.connected || !wantConn) return;
      try { await service.connect(); attempt = 0; } catch (e) { if (o.onError) o.onError(e); attempt++; schedule(); }
    });
    function schedule(immediate) {
      if (timer) { if (!immediate) return; clrT(timer); timer = null; }
      const d = immediate ? 0 : BACKOFF[Math.min(attempt, BACKOFF.length - 1)] * (0.8 + 0.4 * rnd());
      timer = setT(() => { timer = null; if (!wantConn || service.connected) return; if (!canTry()) return; if (!online()) { schedule1s(); return; } connectNow(); }, d);
    }
    function schedule1s() { if (!timer) timer = setT(() => { timer = null; if (wantConn && !service.connected && canTry()) { if (online()) connectNow(); else schedule1s(); } }, 1000); }
    const sync = () => {
      const plan = core.plan(), ic = plan.channels.intercom.act, group = core.ctx.base === 'GROUP_RIDE';
      if (group && !wasGroup) { wantConn = true; attempt = 0; connectNow(); }
      if (!group && wasGroup) { wantConn = false; if (timer) { clrT(timer); timer = null; } run(() => service.disconnect()); }
      wasGroup = group;
      if (!group) return;
      if (ic === 'pause') { service.pausePlayback(); }                         // arama: kopma YOK, yalnız durdur + mikrofon kapat
      else if (ic === 'play') { service.resumePlayback(); if (!service.connected && wantConn) connectNow(); }   // dönüş: düşmüşse hemen yeniden bağlan
    };
    const unsubCore = core.subscribe(sync);
    const unsubSp = service.on('speakers', ids => core.dispatch({ type: E.SPEECH, on: !!(ids && ids.length) }));
    const unsubSt = service.on('state', st => { if (st === 'disconnected' && wantConn && canTry()) { attempt = 0; schedule(); } });
    sync();
    return {
      stop() { unsubCore(); unsubSp(); unsubSt(); if (timer) { clrT(timer); timer = null; } },
      notifyOnline() { if (wantConn && !service.connected && canTry()) { attempt = 0; schedule(true); } },   // window 'online' olayına bağlanır
      get attempts() { return attempt; },
    };
  }
  const api = { createSoloService, createGroupService, bindComms };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.CommCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
