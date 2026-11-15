'use strict';
/* Pil/ısı politikası (tarayıcı + Node ortak, saf mantık). Girdi: { state (audio-core durumu), kmh|null, battery:{level 0..1, charging}|null,
   thermal:'nominal'|'fair'|'serious'|'critical'|null, hidden:bool }. Çıktı: algılayıcıların ne kadar sık/ne kadar hassas çalışacağı.
   Eşikler TAHMİNİ — gerçek cihazda pil/ısı ölçümüyle ayarlanmadı. Kural: güvenlikle ilgili olan (aktif sürüşte konum) asla tamamen
   kapatılmaz; yalnız seyreltilir. Mikrofon/VAD yalnız grup sürüşünde ve arama dışında açılır.
   gps: { on, intervalMs, highAccuracy }   vad: 'off' | 'continuous' | 'duty' (duty = ~%25 görev döngüsü, ör. 100 ms dinle / 300 ms bekle)   ui: { levelMeterFps } */
(function (root) {
  function decide(i) {
    const st = i.state || 'IDLE', kmh = typeof i.kmh === 'number' && isFinite(i.kmh) ? i.kmh : null, b = i.battery, th = i.thermal;
    const riding = st === 'SOLO_RIDE' || st === 'GROUP_RIDE' || st === 'ON_PHONE_CALL';
    const lowBat = !!b && !b.charging && b.level < 0.2, critBat = !!b && !b.charging && b.level < 0.1;
    const hot = th === 'serious', crit = th === 'critical';
    // GPS: hıza göre (duran araç seyrek, hızlı araç sık), pil/ısıya göre seyreltilir
    let gps;
    if (!riding) gps = { on: false, intervalMs: 0, highAccuracy: false };
    else {
      let iv = kmh == null ? 2000 : kmh < 3 ? 5000 : kmh < 40 ? 2000 : kmh < 90 ? 1000 : 1000, hi = kmh == null || kmh >= 3;
      if (lowBat || hot) { iv *= 2; }
      if (critBat || crit) { iv = Math.max(iv, 5000); hi = false; }
      gps = { on: true, intervalMs: Math.round(iv), highAccuracy: hi };
    }
    // VAD: yalnız grup sürüşünde (arama dışı: arama sırasında mikrofon zaten kapalı)
    let vad = 'off';
    if (st === 'GROUP_RIDE') vad = (critBat || crit || lowBat || hot) ? 'duty' : 'continuous';
    if (st === 'GROUP_RIDE' && (critBat || crit)) vad = 'duty';
    const levelMeterFps = (i.hidden || lowBat || hot || crit) ? 0 : vad === 'continuous' ? 10 : 4;
    return { gps, vad, ui: { levelMeterFps }, reason: [lowBat && 'düşük pil', critBat && 'çok düşük pil', hot && 'ısınma', crit && 'kritik ısı', i.hidden && 'arka plan'].filter(Boolean) };
  }
  // Tarayıcı kaynaklarını politikaya çevirir (varsa): Battery Status API; ısı için standart API YOK (thermal null kalır).
  async function readBattery(nav) { try { if (nav && nav.getBattery) { const b = await nav.getBattery(); return { level: b.level, charging: b.charging }; } } catch (e) {} return null; }
  const api = { decide, readBattery };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.PowerCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
