/* Çevrimdışı haritalar: bölge kataloğu (Türkiye + 81 il), çoktan seçmeli indirme, silme, güncelleme.
   Paketler sunucudan (/api/offline/manifest + /offline/<id>.pmtiles) cihazın Cache Storage alanına indirilir (akış, belleğe yüklenmez).
   Bu dosya YALNIZ indirme/saklama yönetimidir; paketlerden harita ÇİZİMİ ayrı aşamadır (OfflineMaps.installed()/has() ona hazırdır). */
(function (root) {
  'use strict';
  const CACHE = 'ml-offline-maps', LSK = 'ml_offmaps';
  const PROV = '01 Adana|02 Adıyaman|03 Afyonkarahisar|04 Ağrı|05 Amasya|06 Ankara|07 Antalya|08 Artvin|09 Aydın|10 Balıkesir|11 Bilecik|12 Bingöl|13 Bitlis|14 Bolu|15 Burdur|16 Bursa|17 Çanakkale|18 Çankırı|19 Çorum|20 Denizli|21 Diyarbakır|22 Edirne|23 Elazığ|24 Erzincan|25 Erzurum|26 Eskişehir|27 Gaziantep|28 Giresun|29 Gümüşhane|30 Hakkâri|31 Hatay|32 Isparta|33 Mersin|34 İstanbul|35 İzmir|36 Kars|37 Kastamonu|38 Kayseri|39 Kırklareli|40 Kırşehir|41 Kocaeli|42 Konya|43 Kütahya|44 Malatya|45 Manisa|46 Kahramanmaraş|47 Mardin|48 Muğla|49 Muş|50 Nevşehir|51 Niğde|52 Ordu|53 Rize|54 Sakarya|55 Samsun|56 Siirt|57 Sinop|58 Sivas|59 Tekirdağ|60 Tokat|61 Trabzon|62 Tunceli|63 Şanlıurfa|64 Uşak|65 Van|66 Yozgat|67 Zonguldak|68 Aksaray|69 Bayburt|70 Karaman|71 Kırıkkale|72 Batman|73 Şırnak|74 Bartın|75 Ardahan|76 Iğdır|77 Yalova|78 Karabük|79 Kilis|80 Osmaniye|81 Düzce'.split('|');
  const REGIONS = [{ id: 'tr', name: 'Tüm Türkiye' }].concat(PROV.map(s => ({ id: s.slice(0, 2), name: s.slice(3) })));
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const mb = n => !(n > 0) ? '0 MB' : n >= 1073741824 ? (n / 1073741824).toFixed(1).replace('.', ',') + ' GB' : n >= 1048576 ? Math.round(n / 1048576) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
  const trLower = s => s.toLocaleLowerCase('tr');
  const LS = { get() { try { return JSON.parse(localStorage.getItem(LSK) || '{}') || {}; } catch { return {}; } }, set(o) { try { localStorage.setItem(LSK, JSON.stringify(o)); } catch {} } };
  const installed = () => LS.get();
  const has = id => !!LS.get()[id];

  async function manifest() {
    const r = await fetch('/api/offline/manifest', { credentials: 'same-origin' });
    if (!r.ok) throw new Error('Harita listesi alınamadı.');
    const j = await r.json(); const m = {};
    for (const p of j.packs || []) if (/^[a-z0-9-]{1,12}$/.test(p.id)) m[p.id] = p;
    return m;
  }
  async function remove(id) {
    const rec = LS.get()[id]; try { const c = await caches.open(CACHE); if (rec && rec.url) await c.delete(rec.url); } catch {}
    const o = LS.get(); delete o[id]; LS.set(o);
  }
  async function download(p, onProg, signal) {
    if (!('caches' in root)) throw new Error('Bu tarayıcı çevrimdışı depolamayı desteklemiyor.');
    const r = await fetch(p.url, { signal, credentials: 'same-origin' });
    if (!r.ok || !r.body) throw new Error('İndirilemedi (' + r.status + ').');
    const total = +r.headers.get('content-length') || p.bytes || 0, rd = r.body.getReader(); let got = 0;
    const rs = new ReadableStream({
      async pull(c) { const { done, value } = await rd.read(); if (done) return c.close(); got += value.length; onProg(got, total); c.enqueue(value); },
      cancel() { return rd.cancel(); } });
    const cache = await caches.open(CACHE);
    try {
      await cache.put(p.url, new Response(rs, { headers: { 'content-type': 'application/octet-stream' } }));
      if (total && got !== total) throw new Error('İndirme eksik kaldı, tekrar dene.');
    } catch (e) { try { await cache.delete(p.url); } catch {} throw e; }
    const o = LS.get(); o[p.id] = { url: p.url, bytes: got, ver: p.ver || '', at: Date.now() }; LS.set(o);
  }

  function mount(el, opts) {
    const S = { quota: null, man: null, err: '', sel: new Set(), q: '', busy: null, prog: {}, ctl: null, confirm: false, msg: '' };
    const quota = async () => { try { S.quota = await navigator.storage.estimate(); } catch { S.quota = null; } };
    function selBytes() { let n = 0; for (const id of S.sel) n += (S.man[id] && S.man[id].bytes) || 0; return n; }
    async function load() {
      quota();
      try { S.man = await manifest(); S.err = ''; } catch (e) { S.man = null; S.err = navigator.onLine ? (e.message || 'Harita listesi alınamadı.') : 'Çevrimdışısın; harita listesi için internet gerekir. İndirilmiş haritalar silinmeden durur.'; }
      paint();
    }
    function paint() {
      const inst = LS.get(), q = S.quota, man = S.man || {}, nIn = Object.keys(inst).length, usedMb = Object.values(inst).reduce((a, b) => a + (b.bytes || 0), 0);
      const list = REGIONS.filter(r => !S.q || trLower(r.name).includes(trLower(S.q)) || r.id === S.q);
      const row = r => {
        const m = man[r.id], d = inst[r.id], upd = d && m && m.ver && d.ver !== m.ver, bz = S.busy === r.id, pg = S.prog[r.id];
        const sub = bz ? `İndiriliyor… %${pg && pg.t ? Math.min(99, Math.round(pg.g / pg.t * 100)) : 0}${pg && pg.t ? ' · ' + mb(pg.g) + ' / ' + mb(pg.t) : ''}` : d ? `İndirildi · ${mb(d.bytes)}${upd ? ' · Yeni sürüm var' : ''}` : m ? mb(m.bytes) : 'Sunucuda henüz yok';
        const can = !!m && !d || upd;
        return `<div class="flex min-h-[56px] items-center gap-3 px-4 py-1"><input type="checkbox" data-om-sel="${r.id}" class="h-6 w-6 shrink-0 accent-amber-400" aria-label="${esc(r.name)} Seç" ${S.sel.has(r.id) ? 'checked' : ''} ${can && !S.busy ? '' : 'disabled'}>`
          + `<span class="min-w-0 flex-1"><span class="block truncate">${r.id !== 'tr' ? `<span class="mr-1.5 text-xs text-zinc-500">${r.id}</span>` : ''}${esc(r.name)}</span><small class="block truncate text-xs ${bz ? 'text-amber-300' : 'text-zinc-400'}">${esc(sub)}</small>${bz && pg && pg.t ? `<span class="mt-1 block h-1.5 overflow-hidden rounded-full bg-white/10"><span class="block h-full bg-amber-400" style="width:${Math.min(100, pg.g / pg.t * 100)}%"></span></span>` : ''}</span>`
          + (d && !bz ? `<button type="button" data-om-del="${r.id}" class="btn-sec min-h-[44px] !px-3 text-sm" ${S.busy ? 'disabled' : ''}>Sil</button>` : '') + `</div>`;
      };
      const need = selBytes();
      el.innerHTML = `<div class="space-y-3">`
        + `<p class="rounded-2xl bg-white/[.055] p-4 text-sm text-zinc-300">İnternetin çekmediği yerlerde kullanmak için bölgeleri cihazına indir. Veri OpenStreetMap katkıcılarına aittir (ODbL). <b>Not:</b> İndirilen paketlerden haritayı çizme bir sonraki aşamadır; şu an indirme, saklama ve silme çalışır.</p>`
        + `<div class="rounded-2xl bg-white/[.055] p-3 text-sm" data-om-info>İndirilen: <b>${nIn}</b> bölge · ${mb(usedMb)}${q && q.quota ? ` · Cihazda boş alan ≈ ${mb(Math.max(0, q.quota - q.usage))}` : ''}</div>`
        + (S.err ? `<p class="rounded-xl bg-rose-500/15 px-3 py-2 text-sm text-rose-300" role="alert">${esc(S.err)} <button type="button" data-om-retry class="underline">Tekrar Dene</button></p>` : '')
        + (S.man && !Object.keys(S.man).length ? `<p class="rounded-xl bg-amber-400/10 px-3 py-2 text-sm text-amber-200">Sunucuda henüz harita paketi yok. Yönetici paketleri <code>tools/offline-maps.js</code> ile hazırlayıp sunucuya koymalı (bkz. KURULUM).</p>` : '')
        + (S.msg ? `<p class="rounded-xl bg-emerald-500/15 px-3 py-2 text-sm text-emerald-300" role="status">${esc(S.msg)}</p>` : '')
        + `<input type="search" data-om-q value="${esc(S.q)}" placeholder="İl Ara" aria-label="İl Ara" class="min-h-[48px] w-full rounded-xl bg-white/10 px-4 text-base outline-none">`
        + `<div class="divide-y divide-white/[.07] overflow-hidden rounded-2xl bg-white/[.055]" style="box-shadow:inset 0 0 0 1px rgba(255,255,255,.07)">${list.map(row).join('') || '<p class="p-4 text-sm text-zinc-400">Eşleşen il yok.</p>'}</div>`
        + `<div class="sticky bottom-2 z-10 space-y-2 rounded-2xl bg-[#031420]/95 p-2" style="box-shadow:0 0 0 1px rgba(255,255,255,.08)">`
        + (S.busy ? `<button type="button" data-om-cancel class="btn-sec min-h-[48px] w-full">İndirmeyi İptal Et</button>`
          : `<button type="button" data-om-go class="btn btn-accent min-h-[48px] w-full" ${S.sel.size ? '' : 'disabled'}>${S.sel.size ? (S.confirm ? `Onayla ve İndir (${S.sel.size} Bölge · ${mb(need)})` : `Seçilenleri İndir (${S.sel.size} · ${mb(need)})`) : 'İndirmek İçin Bölge Seç'}</button>`)
        + (S.confirm && !S.busy ? `<p class="px-1 text-xs text-zinc-400">Büyük dosyalar mobil veri kullanabilir; Wi-Fi önerilir.${q && q.quota && need > (q.quota - q.usage) * 0.9 ? ' <b class="text-rose-300">Cihazda yeterli boş alan olmayabilir.</b>' : ''}</p>` : '') + `</div></div>`;
    }
    async function run() {
      const ids = [...S.sel]; S.confirm = false; S.msg = ''; S.err = ''; S.ctl = new AbortController(); let ok = 0;
      try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch {}
      for (const id of ids) {
        const p = S.man[id]; if (!p) continue; S.busy = id; S.prog[id] = { g: 0, t: p.bytes || 0 }; paint();
        let last = 0;
        try { await download(p, (g, t) => { S.prog[id] = { g, t }; if (Date.now() - last > 400) { last = Date.now(); paint(); } }, S.ctl.signal); ok++; S.sel.delete(id); }
        catch (e) { S.err = ((e.name === 'AbortError' || (S.ctl && S.ctl.signal.aborted)) ? 'İndirme iptal edildi.' : (e.message || 'İndirilemedi.')) + ' (' + (REGIONS.find(r => r.id === id) || {}).name + ')'; break; }
      }
      S.busy = null; S.ctl = null; if (ok && !S.err) S.msg = ok + ' bölge indirildi.'; quota().then(paint); paint();
    }
    el.addEventListener('click', async e => {
      const t = e.target;
      if (t.closest('[data-om-retry]')) return load();
      if (t.closest('[data-om-cancel]')) { if (S.ctl) S.ctl.abort(); return; }
      if (t.closest('[data-om-go]')) { if (!S.confirm) { S.confirm = true; return paint(); } return run(); }
      const d = t.closest('[data-om-del]'); if (d) { await remove(d.dataset.omDel); S.msg = 'Silindi.'; quota().then(paint); return paint(); }
    });
    el.addEventListener('change', e => { const c = e.target.closest('[data-om-sel]'); if (!c) return; const id = c.dataset.omSel; if (c.checked) S.sel.add(id); else S.sel.delete(id); S.confirm = false; paint(); });
    el.addEventListener('input', e => { const i = e.target.closest('[data-om-q]'); if (!i) return; S.q = i.value.trim(); const pos = i.selectionStart; paint(); const n = el.querySelector('[data-om-q]'); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch {} } });
    paint(); load();
    return { refresh: load };
  }
  root.OfflineMaps = { REGIONS, mount, installed, has, remove, download, manifest, fmt: mb };
})(typeof window !== 'undefined' ? window : globalThis);
