'use strict';
// LiveKit bağdaştırıcısı: SAHTE Room/RoomEvent/document ile (gerçek livekit-client/sunucu YOK). node test/livekit-adapter.js
const LK = require('../public/livekit-adapter.js'), CC = require('../public/comm-core.js'), AC = require('../public/audio-core.js'); const E = AC.Events;
let p = 0, f = 0; const ok = (c, m) => { c ? p++ : f++; console.log((c ? 'ok: ' : 'FAIL: ') + m); };
const tick = () => new Promise(r => setImmediate(r));
const RoomEvent = { ActiveSpeakersChanged: 'as', Reconnecting: 'rc', Reconnected: 'rd', Disconnected: 'dc', TrackSubscribed: 'ts', TrackUnsubscribed: 'tu' };
let last; class Room { constructor(o) { this.opts = o; this.h = {}; this.mic = []; this.connected = 0; this.disc = 0; this.localParticipant = { setMicrophoneEnabled: v => this.mic.push(v) }; last = this; }
  on(e, fn) { this.h[e] = fn; return this; } emit(e, ...a) { this.h[e] && this.h[e](...a); } async connect(u, t) { this.url = u; this.token = t; this.connected++; } async disconnect() { this.disc++; } }
const body = []; global.document = { body: { appendChild: el => body.push(el) } };
const mkTrack = sid => ({ kind: 'audio', sid, attach() { return { muted: false, remove() { this.removed = true; } }; }, detach() { return [this._el]; } });
(async () => {
  const tr = LK.createLiveKitTransport({ Room, RoomEvent, url: 'wss://x', getToken: async () => 'tok' });
  const core = AC.create(), svc = CC.createGroupService(tr); CC.bindComms(core, svc);
  core.dispatch({ type: E.START_GROUP }); await tick(); await tick();
  ok(last.url === 'wss://x' && last.token === 'tok' && svc.connected, 'bağlanır: url + belirteç (istemci üretmez, getToken verir)');
  const o = last.opts.audioCaptureDefaults; ok(o.autoGainControl && o.echoCancellation && o.noiseSuppression && last.opts.adaptiveStream, 'mikrofon varsayılanları: AGC + yankı + gürültü bastırma');
  last.emit('ts', mkTrack('t1'), null, { identity: 'ali' }); ok(body.length === 1 && body[0].autoplay === true && body[0].muted === false, 'gelen ses parçası elemente bağlanır ve çalar');
  last.emit('as', [{ identity: 'ali' }]); ok(core.ctx.speech === true, 'ActiveSpeakersChanged → konuşma bayrağı');
  last.emit('as', []); ok(core.ctx.speech === false, 'konuşan kalmayınca bayrak kalkar');
  last.mic.length = 0; core.dispatch({ type: E.CALL_START }); await tick();
  ok(body[0].muted === true && last.mic.includes(false) && last.disc === 0, 'arama: gelen ses sessize, mikrofon kapalı, odadan çıkılmaz');
  core.dispatch({ type: E.CALL_END }); await tick(); ok(body[0].muted === false && last.mic[last.mic.length - 1] === true && last.connected === 1, 'arama bitti: ses ve mikrofon geri, yeniden bağlanma yok');
  svc.mute(); core.dispatch({ type: E.CALL_START }); core.dispatch({ type: E.CALL_END }); await tick(); ok(last.mic[last.mic.length - 1] === false, 'kullanıcı sessizdeyse arama sonrası mikrofon AÇILMAZ (taslaktaki koşulsuz açma hatası yok)');
  svc.unmute(); last.emit('ts', mkTrack('t2'), null, { identity: 'veli' }); core.dispatch({ type: E.CALL_START }); await tick(); ok(body.every(e => e.muted), 'arama sırasında sonradan gelen parça da sessiz başlar');
  core.dispatch({ type: E.CALL_END }); await tick();
  last.emit('rc'); ok(svc.connected === true, 'Reconnecting olayı bağlantıyı düşmüş saymaz (LiveKit kendi toparlar)');
  core.dispatch({ type: E.END_RIDE }); await tick(); ok(last.disc === 1 && !svc.connected, 'sürüş bitince odadan ayrılır');
  const t2 = LK.createLiveKitTransport({ Room, RoomEvent, url: 'u', getToken: async () => 't', roomOptions: { adaptiveStream: false } }); await t2.connect(); ok(last.opts.adaptiveStream === false && last.opts.audioCaptureDefaults.noiseSuppression, 'roomOptions varsayılanların üstüne yazar');
  console.log(`\nSONUÇ: ${p} geçti, ${f} başarısız`); process.exit(f ? 1 : 0);
})();
