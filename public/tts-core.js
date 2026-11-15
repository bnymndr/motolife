'use strict';
/* Sesli bilgilendirme: TTS + uyarı sesi (tarayıcı + Node ortak; synth/AudioContext DIŞARIDAN verilir, testte sahte).
   `speak(text)` konuşma bitince (veya hata/zaman aşımında) çözülür — asla takılı kalmaz; `cancel()` susturur.
   Varsayılan dil tr-TR, hız 1.1 (Gemini taslağı). TEST EDİLMEDİ: gerçek cihaz TTS sesleri/ekran kilidi/Bluetooth yönlendirme. */
(function (root) {
  function createSpeaker({ synth, Utterance, lang = 'tr-TR', rate = 1.1, volume = 1, maxMs = 15000 } = {}) {
    let cancelCur = null;
    const pick = () => { try { const v = synth.getVoices ? synth.getVoices() : []; return v.find(x => x.lang === lang) || v.find(x => (x.lang || '').toLowerCase().startsWith(lang.slice(0, 2))) || null; } catch (e) { return null; } };
    return {
      available: () => !!(synth && Utterance),
      speak(text) {
        return new Promise(res => {
          if (!synth || !Utterance || !text) return res(false);
          if (cancelCur) cancelCur();
          const u = new Utterance(String(text)); u.lang = lang; u.rate = rate; u.volume = volume; const v = pick(); if (v) u.voice = v;
          let done = false; const fin = ok => { if (done) return; done = true; clearTimeout(t); cancelCur = null; res(ok); };
          const t = setTimeout(() => { try { synth.cancel(); } catch (e) {} fin(false); }, maxMs);
          u.onend = () => fin(true); u.onerror = () => fin(false);
          cancelCur = () => { try { synth.cancel(); } catch (e) {} fin(false); };
          try { synth.speak(u); } catch (e) { fin(false); }
        });
      },
      cancel() { if (cancelCur) cancelCur(); },
    };
  }
  // Kısa çift bip (uyarı sesi). `ctxFactory()` bir AudioContext döndürür; yoksa sessizce geçer.
  function createChime(ctxFactory, { freq = 880, ms = 120, gap = 80, gain = 0.2 } = {}) {
    return () => new Promise(res => {
      let ctx; try { ctx = ctxFactory && ctxFactory(); } catch (e) { ctx = null; } if (!ctx) return res(false);
      try {
        const t0 = ctx.currentTime;
        [0, (ms + gap) / 1000].forEach(off => { const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.value = freq; g.gain.value = gain; o.connect(g); g.connect(ctx.destination); o.start(t0 + off); o.stop(t0 + off + ms / 1000); });
        setTimeout(() => res(true), ms * 2 + gap + 20);
      } catch (e) { res(false); }
    });
  }
  const api = { createSpeaker, createChime };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.TtsCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
