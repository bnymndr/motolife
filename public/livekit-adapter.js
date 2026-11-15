'use strict';
/* LiveKit taşıma bağdaştırıcısı (comm-core `transport` sözleşmesi). BAĞIMLILIK EKLEMEZ: `livekit-client` (Room, RoomEvent) ve belirteç
   (token) çağıran tarafından verilir; belirteç SUNUCUDA üretilmelidir (API sırrı istemciye gitmez). TEST EDİLMEDİ: gerçek LiveKit
   sunucusu/istemcisiyle denenmedi, API kullanımı belgeye göre yazıldı. */
(function (root) {
  // Mikrofon varsayılanları (Gemini taslağından): rüzgâr/yankı için AGC + yankı önleme + gürültü bastırma; `roomOptions` ile ezilebilir.
  const DEFAULT_ROOM = { adaptiveStream: true, dynacast: true, audioCaptureDefaults: { autoGainControl: true, echoCancellation: true, noiseSuppression: true } };
  function createLiveKitTransport({ Room, RoomEvent, url, getToken, roomOptions }) {
    let room = null, speakersCb = () => {}, stateCb = () => {}, playbackOn = true, vol = 1; const audioEls = new Map();
    const setEl = (el, on) => { el.muted = !on; try { el.volume = vol; } catch (e) {} };   // iOS'ta volume salt okunur olabilir: orada yalnız mute çalışır
    return {
      async connect() {
        room = new Room(Object.assign({}, DEFAULT_ROOM, roomOptions || {}));
        room.on(RoomEvent.ActiveSpeakersChanged, sp => { const ids = sp.map(x => x.identity); ids.names = sp.map(x => x.name || x.identity); speakersCb(ids); });
        room.on(RoomEvent.Reconnecting, () => stateCb('reconnecting'));
        room.on(RoomEvent.Reconnected, () => stateCb('connected'));
        room.on(RoomEvent.Disconnected, () => stateCb('disconnected'));
        room.on(RoomEvent.TrackSubscribed, (track, _pub, part) => { if (track.kind !== 'audio') return; const el = track.attach(); el.autoplay = true; setEl(el, playbackOn); audioEls.set(part.identity + ':' + track.sid, el); document.body.appendChild(el); });
        room.on(RoomEvent.TrackUnsubscribed, (track, _pub, part) => { const k = part.identity + ':' + track.sid; (track.detach() || []).forEach(e => e.remove()); audioEls.delete(k); });
        const tk = await getToken(), tok = typeof tk === 'string' ? tk : tk.token;   // getToken ya belirteç ya da { url, token } döndürür
        await room.connect((tk && tk.url) || url, tok);
      },
      async disconnect() { if (room) { await room.disconnect(); room = null; } audioEls.clear(); },
      setMic(on) { if (room) room.localParticipant.setMicrophoneEnabled(!!on); },
      setPlayback(on) { playbackOn = !!on; audioEls.forEach(el => setEl(el, on)); },   // odadan ÇIKMAZ: yalnız gelen sesi sessize alır
      setVolume(v) { vol = Math.min(1, Math.max(0, v)); audioEls.forEach(el => { try { el.volume = vol; } catch (e) {} }); },   // media-core 'intercom' kanalı bunu çağırır
      onSpeakers(fn) { speakersCb = fn; }, onState(fn) { stateCb = fn; },
    };
  }
  const api = { createLiveKitTransport, DEFAULT_ROOM };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.LiveKitAdapter = api;
})(typeof window !== 'undefined' ? window : globalThis);
