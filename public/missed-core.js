'use strict';
/* Kaçırılan grup konuşması: tampon + sesli bilgilendirme akışı (tarayıcı + Node ortak; STT/TTS/ağ dışarıdan verilir). Aşama 4.
   GİZLİLİK: başkalarının konuşması metne dönüşür ve özet için sunucuya (→ Claude API) gider; bu yüzden YALNIZ kullanıcı açıkça
   açarsa çalışır (enabled()), tampon yalnız bellekte tutulur (disk/localStorage YOK), sınırlıdır (süre + karakter) ve özetten
   sonra / sürüş bitince / hata olunca SİLİNİR.
   Akış: CALL_START (grup + enabled) → tampon dinler, HOLD_AFTER_CALL → CALL_END: grup sesi geri gelmez, `briefing` başlar →
   özet iste → uyarı sesi → özeti oku → BRIEFING_END (grup sesi geri gelir). Hata/zaman aşımında özet okunmaz, yine BRIEFING_END. */
(function (root) {
  const clean = s => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  function createBuffer({ now = () => Date.now(), maxAgeMs = 10 * 60 * 1000, maxChars = 3000, maxLine = 300 } = {}) {
    let rows = [], on = false;
    const trim = () => { const t = now(); rows = rows.filter(r => t - r.t <= maxAgeMs); let n = rows.reduce((a, r) => a + r.text.length, 0); while (rows.length && n > maxChars) n -= rows.shift().text.length; };
    return {
      start() { rows = []; on = true; }, stop() { on = false; },
      add(who, text) { if (!on) return false; const x = clean(text).slice(0, maxLine); if (!x) return false; rows.push({ t: now(), who: clean(who).slice(0, 32) || '?', text: x }); trim(); return true; },
      lines() { trim(); return rows.map(r => ({ who: r.who, text: r.text })); },
      clear() { rows = []; on = false; }, get active() { return on; }, get size() { return rows.length; },
    };
  }
  const withTimeout = (p, ms) => new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('zaman aşımı')), ms); Promise.resolve(p).then(v => { clearTimeout(t); res(v); }, e => { clearTimeout(t); rej(e); }); });
  function createBriefing({ core, buffer, summarize, speak, chime, stt, enabled, events, timeoutMs = 8000, speakMs = 15000, onError }) {
    const E = events || (root.AudioCore || require('./audio-core.js')).Events; let busy = false;
    const unsub = core.subscribe(async (plan, ev) => {
      const t = ev && ev.type;
      if (t === E.CALL_START && core.ctx.base === 'GROUP_RIDE' && enabled()) { buffer.start(); if (stt) stt.start((who, text) => buffer.add(who, text)); core.dispatch({ type: E.HOLD_AFTER_CALL, on: true }); }
      else if (t === E.END_RIDE) { if (stt) stt.stop(); buffer.clear(); }
      else if (t === E.CALL_END && core.ctx.briefing && !busy) {
        busy = true;
        try {
          if (stt) stt.stop(); buffer.stop(); const lines = buffer.lines();
          if (lines.length) {
            let text = ''; try { text = clean(await withTimeout(summarize(lines), timeoutMs)).slice(0, 240); } catch (e) { if (onError) onError(e); }
            if (text && core.ctx.briefing) { try { if (chime) await withTimeout(chime(), 3000); await withTimeout(speak(text), speakMs); } catch (e) { if (onError) onError(e); } }
          }
        } finally { buffer.clear(); busy = false; if (core.ctx.briefing) core.dispatch({ type: E.BRIEFING_END }); }
      }
    });
    return { stop() { unsub(); buffer.clear(); } };
  }
  // İstemci: sunucu uç noktasından özet iste (anahtar istemcide YOK).
  function serverSummarizer(fetchF) { return async lines => { const r = await fetchF('/api/assist/summarize', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lines }) }); if (!r.ok) throw new Error('özet ' + r.status); const j = await r.json(); return j.summary; }; }
  const api = { createBuffer, createBriefing, serverSummarizer, clean };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.MissedCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
