'use strict';
/* My Moto: bakım takibi + yakıt/tüketim. Tarayıcıda window.MyMoto.mount(kök, { user }), Node'da require() ile hesap çekirdeği.
   GERÇEK VERİ İLKESİ: hiçbir değer varsayılan/örnek olarak gösterilmez. Kilometre, son bakım km'si, yakıt alımları ve tarihleri kullanıcı girer;
   girilmeyen değer "—" / "girilmedi" görünür, 0 gibi gösterilmez. Hesaplar yalnızca girilen kayıtlardan yapılır.
   Saklama: bu cihazın localStorage'ı (kullanıcı adına göre ayrı anahtar). Sunucuya eşitleme YOK: tarayıcı verisi silinirse kayıtlar gider. */
(function (root) {
  const KEY = u => 'mymoto:' + String(u || 'anon');
  const DEFAULT_INTERVALS = { oil: 5000, chain: 500, air: 15000 };   // yalnızca başlangıç önerisi; kullanıcı kendi motoruna göre düzenler
  const NAMES = { oil: 'Motor Yağı ve Filtre', chain: 'Zincir Yağlama ve Gerginlik', air: 'Hava Filtresi' };
  const MAX_KM = 999999, MAX_FUEL = 400;
  const fresh = () => ({ v: 1, km: null, maint: { oil: { interval: DEFAULT_INTERVALS.oil, last: null }, chain: { interval: DEFAULT_INTERVALS.chain, last: null }, air: { interval: DEFAULT_INTERVALS.air, last: null } }, dates: { insurance: '', inspection: '' }, fuel: [] });
  const isNum = (x, lo, hi) => typeof x === 'number' && isFinite(x) && x >= lo && x <= hi;

  // Saklanan veriyi doğrula (bozuk/elle değiştirilmiş kayıt arayüzü bozmasın)
  function clean(d) {
    const o = fresh(); if (!d || typeof d !== 'object') return o;
    if (isNum(d.km, 0, MAX_KM)) o.km = Math.round(d.km);
    for (const k of Object.keys(o.maint)) { const m = d.maint && d.maint[k]; if (m) { if (isNum(m.interval, 50, MAX_KM)) o.maint[k].interval = Math.round(m.interval); if (isNum(m.last, 0, MAX_KM)) o.maint[k].last = Math.round(m.last); } }
    for (const k of ['insurance', 'inspection']) { const v = d.dates && d.dates[k]; if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) o.dates[k] = v; }
    if (Array.isArray(d.fuel)) o.fuel = d.fuel.filter(f => f && isNum(f.liters, 0.1, 100) && isNum(f.cost, 0.01, 100000) && isNum(f.km, 0, MAX_KM) && isNum(f.t, 1e12, 4e12)).slice(-MAX_FUEL)
      .map(f => ({ id: String(f.id || f.t).slice(0, 20), t: f.t, liters: f.liters, cost: f.cost, km: Math.round(f.km), full: f.full !== false }));
    return o;
  }

  // Bakım durumu: km ya da son bakım km'si girilmemişse "unknown" (ilerleme uydurulmaz)
  function maintState(item, km) {
    if (km == null || item.last == null) return { state: 'unknown' };
    const used = Math.max(0, km - item.last), pct = used / item.interval;
    return { state: pct >= 1 ? 'due' : pct >= 0.8 ? 'soon' : 'ok', used, remaining: item.interval - used, pct: Math.min(1, pct) };
  }

  // Tüketim: «depoyu doldur» kayıtları arasındaki mesafe ve o aralıkta alınan toplam yakıt. İlk dolum referanstır (tüketim hesaplanamaz).
  function fuelStats(fuel) {
    const list = fuel.slice().sort((a, b) => a.km - b.km || a.t - b.t), segs = new Map();
    let prev = null, acc = { l: 0, c: 0 }, sl = 0, sc = 0, sd = 0;
    for (const e of list) {
      acc.l += e.liters; acc.c += e.cost;
      if (e.full) {
        if (prev) {
          const d = e.km - prev.km;
          if (d > 0) {
            const l100 = acc.l / d * 100, seg = { l100, costKm: acc.c / d, dist: d, suspect: l100 > 30 || l100 < 1 };
            segs.set(e.id, seg); if (!seg.suspect) { sl += acc.l; sc += acc.c; sd += d; }
          }
        }
        prev = e; acc = { l: 0, c: 0 };
      }
    }
    const last = list[list.length - 1];
    return { list, segs, avgL100: sd > 0 ? sl / sd * 100 : null, avgCostKm: sd > 0 ? sc / sd : null, pricePerL: last ? last.cost / last.liters : null, n: segs.size };
  }

  // Yeni yakıt kaydı doğrulaması: hata metni ya da null
  function checkFuel(e, fuel) {
    if (!isNum(e.liters, 0.5, 50)) return 'Litre 0,5 ile 50 arasında olmalı.';
    if (!isNum(e.cost, 1, 20000)) return 'Tutar geçersiz.';
    if (!isNum(e.km, 0, MAX_KM) || !Number.isInteger(e.km)) return 'Kilometre geçersiz.';
    const lower = fuel.filter(f => f.km < e.km).sort((a, b) => b.km - a.km)[0], higher = fuel.filter(f => f.km > e.km).sort((a, b) => a.km - b.km)[0];
    if (fuel.some(f => f.km === e.km)) return 'Bu kilometre için zaten bir yakıt kaydı var.';
    if (lower && e.km - lower.km < 5 && false) return '';
    if (higher && false) return '';
    return null;
  }

  function daysLeft(str, now) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(str || '')) return null;
    const [y, m, d] = str.split('-').map(Number), t = Date.UTC(y, m - 1, d), n = new Date(now || Date.now()), today = Date.UTC(n.getFullYear(), n.getMonth(), n.getDate());
    return Math.round((t - today) / 864e5);
  }

  const core = { clean, fresh, maintState, fuelStats, checkFuel, daysLeft, NAMES, DEFAULT_INTERVALS };
  if (typeof module !== 'undefined' && module.exports) { module.exports = core; return; }

  /* ===================== Arayüz ===================== */
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nf = (x, d) => x == null ? '—' : x.toLocaleString('tr-TR', { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 });
  const parseNum = s => { const t = String(s == null ? '' : s).trim().replace(',', '.'); return t === '' ? NaN : Number(t); };

  function mount(el, opts) {
    const user = (opts && opts.user) || 'anon';
    let D = fresh(), storeOk = true, showAll = false, delArm = '', msgT = 0, tab = 'sum';
    try { D = clean(JSON.parse(localStorage.getItem(KEY(user)) || 'null')); } catch { storeOk = false; }
    const save = () => { try { localStorage.setItem(KEY(user), JSON.stringify(D)); return true; } catch { storeOk = false; render(); return false; } };
    const msg = (t, bad) => { const m = el.querySelector('#mm2-msg'); if (!m) return; m.textContent = t; m.className = 'rounded-xl px-3 py-2 text-sm ' + (bad ? 'bg-rose-500/15 text-rose-300' : 'bg-emerald-500/15 text-emerald-300'); clearTimeout(msgT); msgT = setTimeout(() => { m.textContent = ''; m.className = 'hidden'; }, 4500); };

    const BAR = { ok: ['bg-emerald-500', 'text-emerald-400', 'Normal'], soon: ['bg-amber-400', 'text-amber-400', 'Bakım Zamanı Yaklaşıyor'], due: ['bg-rose-500', 'text-rose-400', 'Bakım Zamanı Geçti'], unknown: ['bg-zinc-600', 'text-zinc-400', 'Veri girilmedi'] };
    function maintCard(k) {
      const it = D.maint[k], st = maintState(it, D.km), c = BAR[st.state];
      const body = st.state === 'unknown'
        ? `<p class="mt-3 text-xs text-zinc-400">${D.km == null ? 'Önce motorun güncel kilometresini gir.' : 'Son bakım kilometresini gir; kalan ömür buradan hesaplanır.'}</p>`
        : `<div class="mt-3 space-y-1"><div class="flex justify-between text-xs"><span class="text-zinc-400">Son Bakımdan Beri</span><span class="${c[1]}">${nf(st.used)} / ${nf(it.interval)} km</span></div>
           <div class="h-2 w-full overflow-hidden rounded-full bg-white/10"><div class="h-full rounded-full ${c[0]}" style="width:${Math.round(st.pct * 100)}%"></div></div>
           <p class="text-[11px] text-zinc-400">${st.remaining >= 0 ? 'Kalan: ' + nf(st.remaining) + ' km' : nf(-st.remaining) + ' km geçti'}</p></div>`;
      return `<section class="card" data-k="${k}"><div class="flex items-start justify-between gap-2"><div class="min-w-0"><h4 class="font-semibold">${esc(NAMES[k])}</h4>
        <p class="text-[11px] text-zinc-400">Son bakım: ${it.last == null ? 'girilmedi' : nf(it.last) + ' km'} · Periyot: ${nf(it.interval)} km</p></div>
        <span class="shrink-0 rounded-md px-2 py-0.5 text-[10px] font-semibold ${c[1]} bg-white/10">${c[2]}</span></div>${body}
        <div class="mt-3 flex gap-2"><button type="button" data-a="done" data-k="${k}" class="btn-sm min-h-[44px] flex-1" ${D.km == null ? 'disabled' : ''}>Şimdi Yapıldı</button></div>
        <details class="mt-1"><summary class="min-h-[44px] text-sm text-zinc-300">Değerleri Düzenle</summary><div class="grid grid-cols-2 gap-2 pb-1 pt-1">
        <label class="text-xs text-zinc-400">Son Bakım (km)<input class="field mt-1" inputmode="numeric" data-f="last" value="${it.last == null ? '' : it.last}"></label>
        <label class="text-xs text-zinc-400">Periyot (km)<input class="field mt-1" inputmode="numeric" data-f="interval" value="${it.interval}"></label></div>
        <button type="button" data-a="maint-save" data-k="${k}" class="btn-sec min-h-[44px]">Kaydet</button></details></section>`;
    }
    function dateRow(k, label) {
      const dl = daysLeft(D.dates[k]), txt = dl == null ? 'girilmedi' : dl < 0 ? Math.abs(dl) + ' gün önce bitti' : dl === 0 ? 'bugün bitiyor' : dl + ' gün kaldı', cls = dl == null ? 'text-zinc-400' : dl < 0 ? 'text-rose-400' : dl <= 30 ? 'text-amber-400' : 'text-emerald-400';
      return `<label class="block text-xs text-zinc-400">${label} bitiş tarihi<input type="date" class="field mt-1" data-d="${k}" value="${esc(D.dates[k])}"></label><p class="-mt-1 mb-1 text-xs ${cls}">${txt}</p>`;
    }
    function summaryTab() {
      return `<section class="card space-y-3"><div class="flex items-center justify-between"><div><p class="text-xs text-zinc-400">Toplam Kilometre</p><p class="road text-3xl font-semibold">${D.km == null ? '—' : nf(D.km)} <span class="text-base text-zinc-400">km</span></p></div></div>
        <div class="flex gap-2"><input id="mm2-km" class="field" inputmode="numeric" placeholder="Güncel Km" aria-label="Güncel Kilometre"><button type="button" data-a="km-save" class="btn-sm min-h-[44px] px-4">Güncelle</button></div></section>
        <div class="flex items-center justify-between pt-1"><h3 class="road text-xl font-semibold">Bakım Durumu</h3><span class="text-[11px] text-zinc-400">Periyotlar düzenlenebilir</span></div>
        ${['oil', 'chain', 'air'].map(maintCard).join('')}
        <section class="card space-y-2"><h3 class="road text-xl font-semibold">Sigorta ve Muayene</h3>${dateRow('insurance', 'Sigorta')}${dateRow('inspection', 'Muayene')}</section>`;
    }
    function fuelTab() {
      const S = fuelStats(D.fuel), rows = S.list.slice().reverse(), shown = showAll ? rows : rows.slice(0, 8);
      const card = (l, v, u, sub) => `<div class="card flex flex-col justify-between"><p class="text-xs text-zinc-400">${l}</p><p class="my-1"><span class="road text-2xl font-semibold">${v}</span> <span class="text-xs text-zinc-400">${u}</span></p><p class="text-[10px] text-zinc-500">${sub}</p></div>`;
      const list = shown.map(e => {
        const sg = S.segs.get(e.id), dt = new Date(e.t).toLocaleDateString('tr-TR', { day: '2-digit', month: 'short', year: 'numeric' });
        const right = sg ? `<span class="font-mono text-xs font-bold ${sg.suspect ? 'text-amber-400' : 'text-emerald-400'}">${nf(sg.l100, 1)} L/100km</span><span class="block text-[10px] text-zinc-400">${nf(sg.costKm, 2)} TL/km${sg.suspect ? ' · olağan dışı, kayıtları kontrol et' : ''}</span>`
          : `<span class="block text-[10px] text-zinc-400">${e.full ? 'tüketim için sonraki dolum gerekir' : 'kısmi dolum'}</span>`;
        return `<div class="card flex items-center justify-between gap-2"><div class="min-w-0"><p class="text-sm font-semibold">${nf(e.liters, 2)} L <span class="ml-1 rounded bg-white/10 px-1.5 py-0.5 font-mono text-[10px] text-zinc-300">${nf(e.cost, 2)} TL</span></p><p class="text-[10px] text-zinc-400">${nf(e.km)} km · ${esc(dt)}${e.full ? '' : ' · kısmi'}</p></div>
          <div class="text-right">${right}<button type="button" data-a="del" data-id="${esc(e.id)}" class="mt-1 min-h-[44px] px-2 text-xs ${delArm === e.id ? 'text-rose-400' : 'text-zinc-400'}">${delArm === e.id ? 'Emin misin? Sil' : 'Sil'}</button></div></div>`;
      }).join('');
      return `<div class="grid grid-cols-2 gap-3">${card('Ortalama Tüketim', nf(S.avgL100, 1), 'L/100km', S.n ? S.n + ' aralıktan hesaplandı' : 'en az 2 «depoyu doldur» kaydı gerekir')}${card('Km Başına Maliyet', nf(S.avgCostKm, 2), 'TL/km', S.pricePerL ? 'Son alım: ' + nf(S.pricePerL, 2) + ' TL/L' : 'kayıt yok')}</div>
        <form id="mm2-fuel" class="card space-y-3" novalidate><h3 class="road text-xl font-semibold">Yakıt Alımı Ekle</h3>
        <div class="grid grid-cols-2 gap-3"><label class="text-xs text-zinc-400">Litre<input class="field mt-1" id="mm2-l" inputmode="decimal" placeholder="12,5"></label><label class="text-xs text-zinc-400">Toplam Tutar (TL)<input class="field mt-1" id="mm2-c" inputmode="decimal" placeholder="538,75"></label></div>
        <label class="block text-xs text-zinc-400">Kilometre<input class="field mt-1" id="mm2-k" inputmode="numeric" placeholder="${D.km == null ? 'örn: 24700' : esc(D.km)}" value="${D.km == null ? '' : esc(D.km)}"></label>
        <label class="flex min-h-[44px] items-center gap-3 text-sm"><input type="checkbox" id="mm2-full" checked class="h-5 w-5 accent-amber-400"><span>Depoyu Doldurdum <span class="text-xs text-zinc-400">(tüketim bu kayıtlar arasından hesaplanır)</span></span></label>
        <button class="btn min-h-[44px]" type="submit">Kaydet</button></form>
        <div class="flex items-center justify-between"><h3 class="road text-xl font-semibold">Yakıt Alımları</h3>${rows.length > 8 ? `<button type="button" data-a="all" class="min-h-[44px] px-2 text-sm text-amber-300">${showAll ? 'Daha Az' : 'Tümü (' + rows.length + ')'}</button>` : ''}</div>
        <div class="space-y-2">${list || '<p class="card text-center text-sm text-zinc-400">Henüz yakıt kaydı yok.</p>'}</div>`;
    }
    function render() {
      const on = 'bg-amber-400 text-ink font-semibold', off = 'bg-white/[.07] text-zinc-300';
      el.innerHTML = `<div class="space-y-3">${storeOk ? '' : '<p class="rounded-xl bg-rose-500/15 px-3 py-2 text-sm text-rose-300">Bu tarayıcı veri saklamaya izin vermiyor; girdiklerin kalıcı olmaz.</p>'}
        <div class="grid grid-cols-2 gap-2" role="tablist"><button type="button" role="tab" aria-selected="${tab === 'sum'}" data-a="tab" data-t="sum" class="min-h-[44px] rounded-xl text-sm ${tab === 'sum' ? on : off}">Bakım</button><button type="button" role="tab" aria-selected="${tab === 'fuel'}" data-a="tab" data-t="fuel" class="min-h-[44px] rounded-xl text-sm ${tab === 'fuel' ? on : off}">Yakıt ve Tüketim</button></div>
        <div id="mm2-msg" class="hidden" role="status"></div>${tab === 'sum' ? summaryTab() : fuelTab()}
        <p class="pb-2 text-center text-[11px] text-zinc-500">Kayıtlar yalnızca bu cihazda saklanır; sunucuya eşitlenmez.</p></div>`;
    }
    const fieldNum = (box, f) => parseNum(box.querySelector('[data-f="' + f + '"]').value);
    el.addEventListener('click', e => {
      const b = e.target.closest('[data-a]'); if (!b) return; const a = b.dataset.a;
      if (a === 'tab') { tab = b.dataset.t; delArm = ''; render(); }
      else if (a === 'all') { showAll = !showAll; render(); }
      else if (a === 'km-save') {
        const v = parseNum(el.querySelector('#mm2-km').value);
        if (!isNum(v, 0, MAX_KM) || !Number.isInteger(v)) return msg('Geçerli bir kilometre gir (tam sayı).', true);
        if (D.km != null && v < D.km) return msg('Kilometre önceki değerden (' + nf(D.km) + ') küçük olamaz.', true);
        D.km = v; if (save()) { render(); msg('Kilometre güncellendi.'); }
      } else if (a === 'done') {
        if (D.km == null) return msg('Önce güncel kilometreyi gir.', true);
        D.maint[b.dataset.k].last = D.km; if (save()) { render(); msg(NAMES[b.dataset.k] + ' bakımı ' + nf(D.km) + ' km\'de kaydedildi.'); }
      } else if (a === 'maint-save') {
        const box = b.closest('[data-k]'), k = b.dataset.k, last = box.querySelector('[data-f="last"]').value.trim() === '' ? null : fieldNum(box, 'last'), iv = fieldNum(box, 'interval');
        if (!isNum(iv, 50, MAX_KM) || (last != null && !isNum(last, 0, MAX_KM))) return msg('Değerler geçersiz (periyot en az 50 km).', true);
        if (last != null && D.km != null && last > D.km) return msg('Son bakım km\'si güncel kilometreden büyük olamaz.', true);
        D.maint[k].interval = Math.round(iv); D.maint[k].last = last == null ? null : Math.round(last); if (save()) { render(); msg('Kaydedildi.'); }
      } else if (a === 'del') {
        const id = b.dataset.id; if (delArm !== id) { delArm = id; render(); return; }
        D.fuel = D.fuel.filter(f => f.id !== id); delArm = ''; if (save()) { render(); msg('Kayıt silindi.'); }
      }
    });
    el.addEventListener('change', e => {
      const k = e.target.dataset && e.target.dataset.d; if (!k) return;
      D.dates[k] = /^\d{4}-\d{2}-\d{2}$/.test(e.target.value) ? e.target.value : ''; if (save()) render();
    });
    el.addEventListener('submit', e => {
      e.preventDefault(); if (e.target.id !== 'mm2-fuel') return;
      const q = i => el.querySelector(i), entry = { liters: parseNum(q('#mm2-l').value), cost: parseNum(q('#mm2-c').value), km: parseNum(q('#mm2-k').value), full: q('#mm2-full').checked };
      const err = checkFuel(entry, D.fuel); if (err) return msg(err, true);
      const t = Date.now(); D.fuel.push({ id: 'f' + t.toString(36), t, liters: entry.liters, cost: entry.cost, km: entry.km, full: entry.full });
      if (D.km == null || entry.km > D.km) D.km = entry.km;
      if (save()) { const s = fuelStats(D.fuel), sg = s.segs.get(D.fuel[D.fuel.length - 1].id); tab = 'fuel'; render(); msg(sg ? 'Kaydedildi: ' + nf(sg.l100, 1) + ' L/100km' : 'Kaydedildi. Tüketim, sonraki «depoyu doldur» kaydından hesaplanır.'); }
    });
    render();
    return { refresh() { try { D = clean(JSON.parse(localStorage.getItem(KEY(user)) || 'null')); } catch {} render(); }, _D: () => D };
  }
  root.MyMoto = Object.assign({ mount }, core);
})(typeof window !== 'undefined' ? window : globalThis);
