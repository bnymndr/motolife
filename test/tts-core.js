'use strict';
// TTS + uyarı sesi (çekirdek, Node; sahte synth/AudioContext). node test/tts-core.js
const T = require('../public/tts-core.js'), AC = require('../public/audio-core.js'), MC = require('../public/missed-core.js'); const E = AC.Events;
let p = 0, f = 0; const ok = (c, m) => { c ? p++ : f++; console.log((c ? 'ok: ' : 'FAIL: ') + m); };
const wait = ms => new Promise(r => setTimeout(r, ms));
class U { constructor(t) { this.text = t; } }
function synth(mode) { const s = { spoken: [], cancelled: 0, getVoices: () => [{ lang: 'en-US' }, { lang: 'tr-TR', name: 'Yelda' }], speak(u) { s.spoken.push(u); if (mode === 'end') setTimeout(() => u.onend(), 20); if (mode === 'err') setTimeout(() => u.onerror(), 10); if (mode === 'throw') throw new Error('x'); }, cancel() { s.cancelled++; } }; return s; }
(async () => {
  let s = synth('end'), sp = T.createSpeaker({ synth: s, Utterance: U });
  ok(await sp.speak('Merhaba') === true && s.spoken[0].lang === 'tr-TR' && s.spoken[0].rate === 1.1 && s.spoken[0].voice.name === 'Yelda', 'konuşur: tr-TR, hız 1.1, Türkçe ses seçilir; bitince çözülür');
  s = synth('err'); sp = T.createSpeaker({ synth: s, Utterance: U }); ok(await sp.speak('x') === false, 'TTS hatasında çözülür (takılmaz)');
  s = synth('throw'); sp = T.createSpeaker({ synth: s, Utterance: U }); ok(await sp.speak('x') === false, 'synth.speak istisnasında çözülür');
  s = synth('none'); sp = T.createSpeaker({ synth: s, Utterance: U, maxMs: 60 }); const t0 = Date.now(); ok(await sp.speak('x') === false && Date.now() - t0 < 300 && s.cancelled === 1, 'bitmeyen TTS zaman aşımıyla kesilir');
  s = synth('none'); sp = T.createSpeaker({ synth: s, Utterance: U }); const pr = sp.speak('uzun'); sp.cancel(); ok(await pr === false && s.cancelled === 1, 'cancel() susturur ve söz çözülür');
  ok(await T.createSpeaker({}).speak('x') === false && T.createSpeaker({}).available() === false, 'TTS desteği yoksa sessizce false');
  // chime
  const osc = []; const ctx = { currentTime: 0, destination: {}, createOscillator: () => { const o = { frequency: {}, connect() {}, start(t) { o.t = t; }, stop() {} }; osc.push(o); return o; }, createGain: () => ({ gain: {}, connect() {} }) };
  ok(await T.createChime(() => ctx)() === true && osc.length === 2 && osc[1].t > osc[0].t, 'uyarı sesi: iki bip');
  ok(await T.createChime(() => null)() === false && await T.createChime(() => { throw new Error('x'); })() === false, 'AudioContext yoksa/hata verirse sessizce geçer');
  // tam akış: missed-core ile
  const core = AC.create(), buf = MC.createBuffer(), s2 = synth('end'), spk = T.createSpeaker({ synth: s2, Utterance: U }), order = [];
  MC.createBriefing({ core, buffer: buf, enabled: () => true, summarize: async () => 'Mola 15 dakika sonra.', chime: async () => { order.push('chime'); return true; }, speak: async t => { order.push('speak'); return spk.speak(t); } });
  core.dispatch({ type: E.START_GROUP }); core.dispatch({ type: E.CALL_START }); buf.add('ali', 'mola veriyoruz'); core.dispatch({ type: E.CALL_END });
  ok(core.ctx.briefing && core.plan().channels.assistant.act === 'play', 'bilgilendirme sürerken asistan kanalı çalıyor'); for (let i = 0; i < 30 && core.ctx.briefing; i++) await wait(10);
  ok(!core.ctx.briefing && order.join() === 'chime,speak' && s2.spoken[0].text === 'Mola 15 dakika sonra.', 'uyarı sesi → TTS → grup sesi geri');
  console.log(`\nSONUÇ: ${p} geçti, ${f} başarısız`); process.exit(f ? 1 : 0);
})();
