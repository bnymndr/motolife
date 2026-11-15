'use strict';
/* Medya denetimi + yumuşak ses geçişi + hıza duyarlı ses oranı (tarayıcı + Node ortak; DOM/ses YOK, zaman ve oynatıcı dışarıdan verilir).
   Aşama 2. Oynatıcı arayüzü (adapter): { play(), pause(), setVolume(0..1) } — yerel dosya, YouTube vb. aynı arayüze sarılır.
   Geçiş: kısma 300 ms, geri çıkma 1200 ms (smoothstep eğrisi, ortada yeni hedef gelirse MEVCUT seviyeden devam eder: sıçrama yok).
   Kısma profili varsayılan 'stepped' (bind), 'smooth' seçilebilir. Hız oranı (TAHMİNİ, gerçek sürüşle ayarlanmadı): 60 km/s altı = taban, 130 km/s üstü = tavan, arası yumuşak geçiş.
     interkom 0.70 → 1.00, kısılmış müzik 0.30 → 0.10, tam müzik 1.00 → 0.85. Hız yoksa/null ise taban değerler. */
(function (root) {
  const FADE_DOWN_MS = 300, FADE_UP_MS = 1200, V0 = 60, V1 = 130;
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x)), lerp = (a, b, t) => a + (b - a) * t;
  const ease = t => t * t * (3 - 2 * t);
  function speedFactor(kmh) { if (typeof kmh !== 'number' || !isFinite(kmh)) return 0; return ease(clamp((kmh - V0) / (V1 - V0), 0, 1)); }
  // Kısma profili: 'smooth' (sürekli eğri) | 'stepped' (Gemini taslağındaki basamaklar: ≤60 km/s %15, 60–100 %5, >100 %0 = müzik konuşmada tamamen susar).
  // Basamak sınırlarında ±5 km/s histerezis var (hız 99↔101 dalgalanınca ses zıplamaz). Müzik 'duck' iken çalmaya devam eder (sessiz).
  const STEPS = [0.15, 0.05, 0];
  function nextBand(kmh, prev) { if (typeof kmh !== 'number' || !isFinite(kmh)) return 0; let b = prev || 0; if (b < 2 && kmh > 100) b = 2; else if (b < 1 && kmh > 60) b = 1; else if (b > 1 && kmh < 95) b = 1; else if (b > 0 && b < 2 && kmh < 55) b = 0; else if (b === 2 && kmh >= 95) b = 2; return b; }
  function levels(kmh, profile, band) { const t = speedFactor(kmh), L = { intercom: lerp(0.7, 1, t), duck: lerp(0.3, 0.1, t), music: lerp(1, 0.85, t) }; if (profile === 'stepped') L.duck = STEPS[band == null ? nextBand(kmh, 0) : band]; return L; }
  // plan() çıktısı + hız → kanal başına hedef { play: bool, vol: 0..1 }
  function targets(plan, kmh, profile, band) {
    const L = levels(kmh, profile, band), c = plan.channels, o = {};
    o.music = { play: c.music.act === 'play' || c.music.act === 'duck', vol: c.music.act === 'duck' ? L.duck : c.music.act === 'play' ? L.music : 0 };
    o.intercom = { play: c.intercom.act === 'play', vol: c.intercom.act === 'play' ? L.intercom : 0 };
    o.assistant = { play: c.assistant.act === 'play', vol: c.assistant.act === 'play' ? 1 : 0 };
    o.phone = { play: c.phone.act === 'play', vol: c.phone.act === 'play' ? 1 : 0 };
    return o;
  }
  function createFader(v0) {
    let from = v0 || 0, to = from, t0 = 0, dur = 0;
    const value = now => (dur <= 0 || now >= t0 + dur) ? to : lerp(from, to, ease((now - t0) / dur));
    return {
      value, get target() { return to; },
      setTarget(v, now) {
        v = clamp(v, 0, 1); if (v === to) return;
        const cur = value(now); from = cur; to = v; t0 = now;
        dur = (v < cur ? FADE_DOWN_MS : FADE_UP_MS) * Math.min(1, Math.abs(v - cur) / 0.5 + 0.2);   // küçük değişim kısa sürer
      },
      done: now => now >= t0 + dur,
    };
  }
  // Tek kanal: hedef (play, vol) → fader + adapter. tick(now) ses seviyesini yazar; sessizliğe inince pause() çağırır.
  function createChannel(adapter) {
    const fd = createFader(0); let playing = false, lastVol = -1, wantPlay = false;
    return {
      set(tg, now) {
        wantPlay = tg.play;
        if (tg.play && !playing) { playing = true; adapter.play(); }
        fd.setTarget(tg.play ? tg.vol : 0, now);
      },
      tick(now) {
        const v = fd.value(now);
        if (Math.abs(v - lastVol) >= 0.005 || (v === 0 && lastVol !== 0) || (v === fd.target && v !== lastVol)) { lastVol = v; adapter.setVolume(v); }
        if (playing && !wantPlay && v === 0 && fd.done(now)) { playing = false; adapter.pause(); }
      },
      settled: now => fd.done(now) && (lastVol === fd.target),
      get playing() { return playing; }, get volume() { return lastVol; },
    };
  }
  // audio-core örneğine bağlar: plan değişince veya hız değişince hedefleri günceller. `now` ve zamanlayıcı dışarıdan.
  function bind(core, adapters, opts) {
    const o = opts || {}, now = o.now || (() => Date.now());
    const ch = {}; Object.keys(adapters).forEach(k => { ch[k] = createChannel(adapters[k]); });
    let kmh = null, band = 0, timer = null, wake = null, api2 = null; const profile = o.duckProfile || 'stepped';
    const apply = () => { band = nextBand(kmh, band); const tg = targets(core.plan(), kmh, profile, band), t = now(); Object.keys(ch).forEach(k => ch[k].set(tg[k], t)); tick(); if (wake) wake(); };
    const tick = () => { const t = now(); Object.keys(ch).forEach(k => ch[k].tick(t)); };
    const unsub = core.subscribe(apply);
    apply();
    return (api2 = {
      channels: ch, tick, apply,
      setSpeed(v) { kmh = (typeof v === 'number' && isFinite(v) && v >= 0) ? v : null; apply(); },
      busy() { const t = now(); return Object.keys(ch).some(k => !ch[k].settled(t)); },
      // PİL: sabit 40 ms zamanlayıcı yerine yalnız geçiş sürerken tikler; durağanken zamanlayıcı YOKTUR (apply() yeniden uyandırır).
      start(ms) { wake = () => { if (timer) return; const loop = () => { timer = null; tick(); if (api2.busy()) timer = setTimeout(loop, ms || 40); }; timer = setTimeout(loop, 0); }; wake(); },
      stop() { if (timer) { clearTimeout(timer); timer = null; } wake = null; unsub(); },
    });
  }
  // <audio>/<video> için hazır adapter. UYARI: iOS Safari'de element.volume salt okunur → orada Web Audio GainNode ile
  // `setGain` verilmeli (opts.setGain); aksi halde ses seviyesi değişmez. Gerçek cihazda DENENMEDİ.
  function htmlAudioAdapter(el, opts) {
    const setGain = opts && opts.setGain;
    return { play: () => { const r = el.play(); if (r && r.catch) r.catch(() => {}); }, pause: () => el.pause(), setVolume: v => { if (setGain) setGain(v); else el.volume = clamp(v, 0, 1); } };
  }
  const api = { FADE_DOWN_MS, FADE_UP_MS, STEPS, nextBand, speedFactor, levels, targets, createFader, createChannel, bind, htmlAudioAdapter };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.MediaCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
