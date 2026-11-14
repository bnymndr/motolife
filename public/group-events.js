/* Grup etkinlikleri (plan): başlangıç yeri, uğrak/mola noktaları, varış. Sunucu: ridegroups.js (/api/rgroups/:id/events).
   group-ride.js tarafından ilk kullanımda yüklenir; alt sayfa (sheet) HTML'ini üretir, tıklamaları act() ile alır. Etkinlik yalnızca PLAN bilgisidir:
   grup sürüşü ve müzik paylaşımı etkinlikten bağımsız başlar. Haritada gösterilen çizgi gerçek yol değil, noktaları sırayla bağlayan şematik çizgidir. */
(function () {
  'use strict';
  const MAX_STOPS = 8;
  const fmtWhen = ms => (ms ? new Date(ms).toLocaleString('tr-TR', { weekday: 'short', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) : 'Tarih belirlenmedi');
  const toLocalInput = ms => { if (!ms) return ''; const d = new Date(ms), p = n => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes()); };

  function create(h) {
    const { req, esc, toast, ctx } = h;
    const E = { list: [], canEdit: false, loaded: false, draft: null, pick: null, results: null, busy: false, layers: [], shown: '' };
    const url = p => '/api/rgroups/' + h.gid() + '/events' + (p || '');
    async function load() { const j = await req('GET', url()); E.list = j.events || []; E.canEdit = !!j.canEdit; E.loaded = true; return E.list; }
    const blank = () => ({ id: '', title: '', at: '', note: '', start: null, dest: null, stops: [] });
    const toDraft = e => ({ id: e.id, title: e.title, at: toLocalInput(e.at), note: e.note || '', start: { ...e.start }, dest: { ...e.dest }, stops: e.stops.map(s => ({ ...s })) });

    /* ---------- Harita ---------- */
    function clearMap() { E.layers.forEach(l => { try { l.remove(); } catch {} }); E.layers = []; E.shown = ''; }
    function showOnMap(e) {
      clearMap(); const L = ctx.L(), m = ctx.map(); if (!L || !m || !e) return false;
      const pts = [{ ...e.start, t: 'Başlangıç', c: '#22c55e', n: 'B' }, ...e.stops.map((s, i) => ({ ...s, t: s.kind === 'ugrak' ? 'Uğrak' : 'Mola', c: s.kind === 'ugrak' ? '#a855f7' : '#EA8621', n: String(i + 1) })), { ...e.dest, t: 'Varış', c: '#ef4444', n: 'V' }];
      try {
        E.layers.push(L.polyline(pts.map(p => [p.lat, p.lon]), { color: '#EA8621', weight: 3, opacity: .8, dashArray: '2 8' }).addTo(m));
        for (const p of pts) E.layers.push(L.marker([p.lat, p.lon], { icon: L.divIcon({ className: 'mm-evpin', html: '<b style="background:' + p.c + '">' + p.n + '</b>', iconSize: [26, 26], iconAnchor: [13, 13] }), title: p.t + ': ' + p.name }).addTo(m));
      } catch { return false; }
      E.shown = e.id; ctx.fitPoints(pts.map(p => [p.lat, p.lon])); return true;
    }

    /* ---------- Görünümler ---------- */
    const pointRow = (slot, label, p, extra) => {
      const open = E.pick === slot;
      return `<div class="mm-evpt"><div class="mm-evl"><span>${label}</span><b>${p ? esc(p.name) : '<i>Seçilmedi</i>'}</b></div>
        <div class="mm-grow2"><button type="button" class="mm-mb" data-ev="me" data-s="${slot}">Konumum</button><button type="button" class="mm-mb" data-ev="find" data-s="${slot}">${open ? 'Kapat' : 'Ara'}</button></div>${extra || ''}
        ${open ? `<div class="mm-evsr"><input id="mm-ev-q" class="mm-ginput" maxlength="120" placeholder="Yer ara (ör. Şile)" autocomplete="off"><button type="button" class="mm-mb primary" data-ev="go" data-s="${slot}">Ara</button>
        ${E.results == null ? '' : E.results === 'wait' ? '<p class="mm-note">Aranıyor…</p>' : E.results.length ? E.results.map((x, i) => `<button type="button" class="mm-ritem" data-ev="use" data-s="${slot}" data-i="${i}"><b>${esc(x.title)}</b><span>${esc(x.subtitle || '')}</span></button>`).join('') : '<p class="mm-note">Sonuç bulunamadı.</p>'}</div>` : ''}</div>`;
    };
    function listView() {
      let h2 = `<div class="mm-gsec"><div class="mm-gtitle"><b>Etkinlikler</b><button type="button" class="mm-glink" data-g="main">Geri</button></div>`;
      if (!E.loaded) h2 += '<p class="mm-note">Yükleniyor…</p>';
      else if (!E.list.length) h2 += `<p class="mm-note">Henüz etkinlik yok.${E.canEdit ? ' Başlangıç, mola ve varış noktalarıyla bir tur planla.' : ' Lider ya da yönetici etkinlik ekleyebilir.'}</p>`;
      for (const e of E.list) {
        h2 += `<div class="mm-evc"><b>${esc(e.title)}</b><small>${esc(fmtWhen(e.at))}</small>
          <p class="mm-note">${esc(e.start.name)} → ${esc(e.dest.name)}${e.stops.length ? ' · ' + e.stops.length + ' durak' : ''}</p>
          ${e.stops.length ? '<ol class="mm-evs">' + e.stops.map(s => `<li><i>${s.kind === 'ugrak' ? 'Uğrak' : 'Mola'}</i> ${esc(s.name)}</li>`).join('') + '</ol>' : ''}${e.note ? `<p class="mm-note">${esc(e.note)}</p>` : ''}
          <div class="mm-grow2"><button type="button" class="mm-mb" data-ev="map" data-id="${esc(e.id)}">${E.shown === e.id ? 'Haritadan Kaldır' : 'Haritada Göster'}</button>${E.canEdit ? `<button type="button" class="mm-mb" data-ev="edit" data-id="${esc(e.id)}">Düzenle</button>` : ''}</div>
          ${E.canEdit ? `<button type="button" class="mm-mb danger mm-gwide" data-ev="del" data-id="${esc(e.id)}">Sil</button>` : ''}</div>`;
      }
      if (E.canEdit) h2 += '<button type="button" class="mm-mb primary mm-gwide" data-ev="new">Yeni Etkinlik</button>';
      return h2 + '</div>';
    }
    function formView() {
      const d = E.draft;
      let h2 = `<div class="mm-gsec"><b>${d.id ? 'Etkinliği Düzenle' : 'Yeni Etkinlik'}</b>
        <input id="mm-ev-title" class="mm-ginput" maxlength="60" placeholder="Etkinlik adı (ör. Şile Turu)" value="${esc(d.title)}" data-ef="title" autocomplete="off">
        <label class="mm-note">Tarih ve saat (isteğe bağlı)</label><input id="mm-ev-at" class="mm-ginput" type="datetime-local" value="${esc(d.at)}" data-ef="at">
        ${pointRow('start', 'Başlangıç yeri', d.start)}`;
      d.stops.forEach((s, i) => {
        h2 += pointRow(i, (s.kind === 'ugrak' ? 'Uğrak' : 'Mola') + ' ' + (i + 1), s.name ? s : null,
          `<div class="mm-grow2"><select class="mm-sel" data-ef="kind" data-s="${i}" aria-label="Tür"><option value="mola" ${s.kind !== 'ugrak' ? 'selected' : ''}>Mola</option><option value="ugrak" ${s.kind === 'ugrak' ? 'selected' : ''}>Uğrak</option></select><button type="button" class="mm-mb danger" data-ev="rm" data-s="${i}">Kaldır</button></div>`);
      });
      if (d.stops.length < MAX_STOPS) h2 += '<button type="button" class="mm-mb mm-gwide" data-ev="add">+ Mola / Uğrak Noktası Ekle</button>';
      h2 += pointRow('dest', 'Varış noktası', d.dest);
      h2 += `<input id="mm-ev-note" class="mm-ginput" maxlength="200" placeholder="Not (isteğe bağlı)" value="${esc(d.note)}" data-ef="note" autocomplete="off">
        <div class="mm-grow2"><button type="button" class="mm-mb" data-ev="cancel">Vazgeç</button><button type="button" class="mm-mb primary" data-ev="save" ${E.busy ? 'disabled' : ''}>Kaydet</button></div></div>`;
      return h2;
    }
    const setPoint = (slot, p) => { const d = E.draft; if (slot === 'start') d.start = p; else if (slot === 'dest') d.dest = p; else { const s = d.stops[Number(slot)]; if (s) { s.name = p.name; s.lat = p.lat; s.lon = p.lon; } } E.pick = null; E.results = null; };
    async function search(slot) {
      const q = ((document.getElementById('mm-ev-q') || {}).value || '').trim(); if (q.length < 3) return toast('En az 3 karakter yaz.');
      E.results = 'wait'; h.rerender();
      try {
        const p = new URLSearchParams({ q }); const me = ctx.me(); if (me) { p.set('lat', me.lat.toFixed(4)); p.set('lon', me.lon.toFixed(4)); }
        const r = await fetch('/api/geocode?' + p, { credentials: 'same-origin' }), j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || 'Arama başarısız.'); E.results = j.results || [];
      } catch (e) { E.results = null; toast(e.message || 'Arama başarısız.'); }
      h.rerender();
    }
    function input(e) {
      const f = e.target.dataset && e.target.dataset.ef; if (!f || !E.draft) return;
      if (f === 'kind') { const s = E.draft.stops[Number(e.target.dataset.s)]; if (s) s.kind = e.target.value === 'ugrak' ? 'ugrak' : 'mola'; h.rerender(); }
      else E.draft[f] = e.target.value;
    }
    const acts = {
      new: () => { E.draft = blank(); E.pick = null; E.results = null; h.view('event'); },
      edit: d => { const e = E.list.find(x => x.id === d.id); if (!e) return; E.draft = toDraft(e); E.pick = null; E.results = null; h.view('event'); },
      cancel: () => { E.draft = null; E.pick = null; h.view('events'); },
      add: () => { if (E.draft.stops.length < MAX_STOPS) E.draft.stops.push({ name: '', lat: 0, lon: 0, kind: 'mola' }); h.rerender(); },
      rm: d => { E.draft.stops.splice(Number(d.s), 1); E.pick = null; E.results = null; h.rerender(); },
      find: d => { const slot = d.s === 'start' || d.s === 'dest' ? d.s : Number(d.s); E.pick = E.pick === slot ? null : slot; E.results = null; h.rerender(); },
      go: d => search(d.s === 'start' || d.s === 'dest' ? d.s : Number(d.s)),
      use: d => { const x = (Array.isArray(E.results) ? E.results : [])[Number(d.i)]; if (!x) return; setPoint(d.s === 'start' || d.s === 'dest' ? d.s : Number(d.s), { name: String(x.title || '').slice(0, 60), lat: x.lat, lon: x.lon }); h.rerender(); },
      me: d => { const m = ctx.me(); if (!m) return toast('Konum henüz alınamadı. Haritada konum izni ver.'); setPoint(d.s === 'start' || d.s === 'dest' ? d.s : Number(d.s), { name: 'Konumum', lat: m.lat, lon: m.lon }); h.rerender(); },
      map: d => { const e = E.list.find(x => x.id === d.id); if (!e) return; if (E.shown === e.id) { clearMap(); h.rerender(); } else if (showOnMap(e)) h.close(); else toast('Harita henüz hazır değil.'); },
      del: d => h.confirm('Etkinlik Silinsin mi?', 'Etkinlik tüm üyeler için kaldırılır.', 'Sil', async () => { const j = await req('DELETE', url('/' + d.id)); E.list = j.events || []; if (E.shown === d.id) clearMap(); h.rerender(); }),
      save: async () => {
        const d = E.draft; if (!d || E.busy) return;
        const at = d.at ? new Date(d.at).getTime() : null;
        if (d.title.trim().length < 2) return toast('Etkinlik adı en az 2 karakter olmalı.');
        if (d.at && !isFinite(at)) return toast('Tarih geçersiz.');
        if (!d.start) return toast('Başlangıç yeri seçilmeli.'); if (!d.dest) return toast('Varış noktası seçilmeli.');
        if (d.stops.some(s => !s.name)) return toast('Konumu seçilmemiş bir mola/uğrak var; seçin ya da kaldırın.');
        E.busy = true; h.rerender();
        try {
          const body = { title: d.title, at, note: d.note, start: d.start, dest: d.dest, stops: d.stops };
          const j = d.id ? await req('PUT', url('/' + d.id), body) : await req('POST', url(), body);
          E.list = j.events || []; E.draft = null; E.pick = null; E.busy = false; toast('Etkinlik kaydedildi.'); h.view('events');
        } catch (e) { E.busy = false; toast(e.message || 'Kaydedilemedi.'); h.rerender(); }
      }
    };
    return { load, listView, formView, input, clearMap, act: (n, d) => acts[n] && acts[n](d), count: () => E.list.length, next: () => E.list.find(e => !e.at || e.at > Date.now() - 6 * 3600000) || null, reset: () => { E.list = []; E.loaded = false; E.draft = null; E.pick = null; E.results = null; clearMap(); } };
  }
  window.GroupEvents = { create };
})();
