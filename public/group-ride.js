/* Grup sürüşü istemcisi (sunucu: ridegroups.js). map.js tarafından yüklenir ve mount(ctx) ile bağlanır; harita, GPS ve
   «diğer sürücüler» hattını (setRiders) YENİDEN YAZMAZ, map.js'in verdiği ctx üzerinden kullanır.
   Paylaşım her sürüş için açık onay ister, varsayılan KAPALIdır; yalnızca aktif grup sürüşünde çalışır, sürüş bitince kendiliğinden durur.
   Gönderim: hareketteyken ≥4 sn ve ≥8 m, durağanken 20 sn'de bir. İzleme yalnızca harita ekranı açıkken ve aktif sürüşte. */
(function () {
  'use strict';
  const FLAG = { behind: 'Geride', away: 'Uzaklaştı', off: 'Güzergâh dışı' };
  const FLAG_LONG = { behind: 'geride kaldı', away: 'gruptan uzaklaştı', off: 'güzergâhtan ayrıldı' };
  const GAPS = [500, 1000, 2000, 3000];
  const STALE_S = 30, LOST_S = 60;
  const fmtM = m => (m >= 1000 ? (Math.round(m / 100) / 10).toString().replace('.', ',') + ' km' : Math.round(m) + ' m');
  const fmtCode = c => (c ? c.slice(0, 4) + '-' + c.slice(4) : '');
  const r5 = v => Math.round(v * 1e5) / 1e5;

  function mount(ctx) {
    const { sock, $, esc, toast, modal, closeModal, store, haversine } = ctx;
    const sheet = $('mm-gsheet'), chipEl = $('mm-gchip'), btn = $('mm-gbtn');
    const G = { list: [], cur: store.get('mm_gcur', ''), detail: null, live: null, sharing: false, sharedGid: '', sharedRide: '', consent: {}, sent: null,
      route: null, routeLayers: [], showRoute: store.get('mm_groute', '1') !== '0', open: false, view: 'main', watching: '', timer: 0, confirmFn: null, selfLeft: false, listT: 0, memT: 0, mshared: false, mlisten: '', mseq: 0, mcur: '', mgid: '' };

    async function req(method, url, body, raw) {
      const opt = { method, credentials: 'same-origin', headers: {} };
      if (body !== undefined) { opt.headers['Content-Type'] = raw ? 'application/octet-stream' : 'application/json'; opt.body = JSON.stringify(body); }
      const r = await fetch(url, opt), j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'İşlem başarısız.');
      return j;
    }
    /* ---------- Grup sesi (public/group-voice.js, sunucu: groupvoice.js) ---------- */
    let gvCtl = null, gvLoading = null, gvT = 0;
    function gvLoad() {
      if (gvCtl) return Promise.resolve(gvCtl);
      if (gvLoading) return gvLoading;
      gvLoading = new Promise((res, rej) => {
        const ready = () => { gvCtl = window.GroupVoice.create({ sock }); window.GroupVoice.mountBar(gvCtl); gvCtl.onChange(v => { if (v.toast) toast(v.toast, 5000); clearTimeout(gvT); gvT = setTimeout(() => { if (G.open && G.view === 'main') renderSheet(); }, 120); }); res(gvCtl); };
        if (window.GroupVoice) return ready();
        const sc = document.createElement('script'); sc.src = '/group-voice.js'; sc.onload = ready; sc.onerror = () => { gvLoading = null; rej(new Error('Ses bileşeni yüklenemedi. Bağlantını kontrol edip tekrar dene.')); }; document.head.appendChild(sc);
      });
      return gvLoading;
    }
    function voiceSection(d) {
      const v = gvCtl ? gvCtl.state() : null, here = v && v.gid === d.id && v.status !== 'idle' && v.status !== 'failed';
      let h = '<div class="mm-gsec"><b>Sesli Görüşme</b>';
      if (here) h += `<p class="mm-note">Bağlısın · ${v.count} kişi · ${v.mode === "ptt" ? "Bas-Konuş" : "Açık Mikrofon"}. Kontroller ekranın altındaki ses çubuğunda.</p><button type="button" class="mm-mb danger mm-gwide" data-g="vleave">Sesten Ayrıl</button>`;
      else {
        h += '<p class="mm-note">Gruptaki üyelerle internet üzerinden canlı konuş. Ses doğrudan üyeler arasında gider, kaydedilmez. Mikrofon katılınca kapalı başlar.</p>';
        if (v && v.status === 'failed' && v.error) h += `<p class="mm-note warn">${esc(v.error)}</p>`;
        else if (v && v.status !== 'idle' && v.gid && v.gid !== d.id) h += '<p class="mm-note warn">Başka bir grubun sesli görüşmesindesin; katılırsan oradan ayrılırsın.</p>';
        h += '<button type="button" class="mm-mb primary mm-gwide" data-g="vjoin">Sesli Görüşmeye Katıl</button>';
      }
      return h + '</div>';
    }
    const detailUrl = (s = '') => '/api/rgroups/' + encodeURIComponent(G.cur) + s;
    const curBrief = () => G.list.find(g => g.id === G.cur) || null;
    const iAmLeader = () => !!(G.detail && G.detail.role === 'leader');

    /* ---------- Veri ---------- */
    async function loadList() {
      try { const j = await req('GET', '/api/rgroups'); G.list = Array.isArray(j.groups) ? j.groups : []; } catch { return; }
      const hasCur = G.list.some(g => g.id === G.cur), act = G.list.find(g => g.active);
      if (!hasCur || (act && !(curBrief() || {}).active && !G.sharing)) { G.cur = (act || G.list[0] || {}).id || ''; store.set('mm_gcur', G.cur); G.detail = null; G.live = null; }
      if (G.cur) await loadDetail(); else { G.detail = null; G.live = null; clearRoute(); G.route = null; syncWatch(); }
      paint();
    }
    async function loadDetail() {
      const gid = G.cur;
      try { const d = (await req('GET', detailUrl())).group; if (gid !== G.cur) return; G.detail = d; }
      catch { if (gid === G.cur) { G.detail = null; } return; }
      if (!G.detail.ride) { G.live = null; if (G.sharing && G.sharedGid === gid) stop(false); }
      syncWatch();
      if (G.evFor !== gid) { G.evFor = gid; evLoad().then(c => { c.reset(); return c.load(); }).then(renderIf).catch(() => { G.evFor = ''; }); }
      if (G.detail.route && (!G.route || G.route.gid !== gid || G.route.v !== G.detail.route.v)) loadRoute();
      else if (!G.detail.route && G.route) { clearRoute(); G.route = null; }
    }
    function listSoon() { clearTimeout(G.listT); G.listT = setTimeout(loadList, 300); }
    async function loadRoute() {
      const gid = G.cur;
      try { const j = await req('GET', detailUrl('/route')); if (gid !== G.cur) return; G.route = { gid, v: j.v, pts: j.pts, len: j.len, name: j.name }; drawRoute(); if (G.open) renderSheet(); }
      catch { clearRoute(); G.route = null; }
    }
    function clearRoute() { G.routeLayers.forEach(l => { try { l.remove(); } catch {} }); G.routeLayers = []; }
    function drawRoute() {                                      // turuncu kişisel rotadan ayrışsın: mavi noktalı çizgi
      clearRoute();
      if (!G.route || !G.showRoute || !ctx.map()) return;
      const L = ctx.L(), m = ctx.map(), ll = G.route.pts;
      G.routeLayers = [L.polyline(ll, { color: '#031420', weight: 11, opacity: 0.75, lineCap: 'round', interactive: false }).addTo(m),
        L.polyline(ll, { color: '#4FA3E0', weight: 6, opacity: 1, dashArray: '1 11', lineCap: 'round', interactive: false }).addTo(m)];
    }
    function syncWatch() {                                      // yalnız harita açıkken ve aktif sürüşte canlı durumu izle
      const want = ctx.isActive() && G.detail && G.detail.ride && sock.connected ? G.cur : '';
      if (want === G.watching) return;
      if (G.watching) sock.emit('grp:unwatch', { gid: G.watching });
      G.watching = want;
      if (want) sock.timeout(5000).emit('grp:watch', { gid: want }, (err, r) => { if (err || !r || !r.ok) G.watching = ''; });
    }

    /* ---------- Haritadaki üyeler ---------- */
    function markers() {
      const L = G.live;
      if (!L || L.gid !== G.cur || !G.detail || !G.detail.ride) return [];
      const lag = Math.round((Date.now() - L.rx) / 1000), out = [];
      for (const m of L.members) {
        if (m.lost || m.wait || m.lat == null || m.u === ctx.user) continue;
        const age = (m.age || 0) + lag;
        if (age > LOST_S) continue;                             // eski konum canlı gösterilmez
        const spd = m.spd == null ? 'hız yok' : (m.est ? '~' : '') + m.spd + ' km/s' + (m.est ? ' (tahmini)' : '');
        const tip = [m.u + (m.lead ? ' · Lider' : ''), spd, m.f ? FLAG[m.f] : '', age < 10 ? 'şimdi' : age + ' sn önce'].filter(Boolean).join(' · ');
        out.push({ id: 'g:' + m.u, name: m.u, lat: m.lat, lon: m.lon, leader: !!m.lead, badge: m.spd == null ? '–' : (m.est ? '~' : '') + m.spd,
          cls: 'rel-group' + (m.f ? ' flag-' + m.f : '') + (age > STALE_S ? ' stale' : ''), tip });
      }
      return out;
    }

    /* ---------- Paylaşım ---------- */
    function startSharing() {
      const gid = G.cur, rideId = G.detail && G.detail.ride && G.detail.ride.id;
      if (!rideId) return toast('Aktif grup sürüşü yok.');
      if (!sock.connected) return toast('Sunucuya bağlı değilsin; paylaşım açılamadı.');
      sock.timeout(6000).emit('grp:share', { gid, on: true, consent: true }, (err, r) => {
        if (err || !r || !r.ok) { toast((r && r.error) || 'Paylaşım açılamadı, sunucu yanıt vermedi.'); return paint(); }
        G.sharing = true; G.sharedGid = gid; G.sharedRide = rideId; G.sent = null; G.consent[rideId] = true;
        ctx.startGps();                                         // paylaşım boyunca GPS açık kalır
        if (ctx.me()) sendFix(ctx.me(), true);
        syncWatch(); paint();
      });
    }
    function stop(tell, msg) {
      if (!G.sharing) return;
      if (tell && sock.connected) sock.emit('grp:share', { gid: G.sharedGid, on: false });
      G.sharing = false; G.sent = null;
      if (msg) toast(msg, 7000);
      ctx.releaseGps(); paint();
    }
    function sendFix(f, force) {
      if (!G.sharing || !sock.connected || !f || f.acc > 100) return;         // zayıf GPS paylaşılmaz
      const now = Date.now(), s = G.sent;
      if (!force && s && !(now - s.at >= 20000 || (now - s.at >= 4000 && haversine(s.lat, s.lon, f.lat, f.lon) >= 8))) return;
      G.sent = { lat: f.lat, lon: f.lon, at: now };
      sock.volatile.emit('grp:update', { gid: G.sharedGid, lat: r5(f.lat), lon: r5(f.lon), acc: Math.round(f.acc), spd: f.speed == null ? null : Math.round(f.speed * 10) / 10 });
    }
    function askShare() {
      const rideId = G.detail && G.detail.ride && G.detail.ride.id;
      if (rideId && G.consent[rideId]) return startSharing();
      confirmDlg('Konumun Grupla Paylaşılsın mı?',
        'Konumun ve hızın, bu grup sürüşü boyunca <b>yalnızca bu grubun üyelerine</b> gösterilir ve sürüş analizi için <b>kaydedilir</b> (grup üyeleri sonradan görebilir). İstediğin an durdurabilirsin; sürüş bitince paylaşım kendiliğinden durur.',
        'Paylaşımı Aç', startSharing);
    }

    /* ---------- Etkinlikler (public/group-events.js) ---------- */
    let evCtl = null, evLoading = null;
    function evLoad() {
      if (evCtl) return Promise.resolve(evCtl);
      if (evLoading) return evLoading;
      evLoading = new Promise((res, rej) => {
        const ready = () => {
          evCtl = window.GroupEvents.create({ req, esc, toast, ctx, gid: () => G.cur, rerender: () => renderSheet(), close: closeSheet,
            view: v => { G.view = v; renderSheet(); sheet.scrollTop = 0; }, confirm: (t, html, ok, fn) => confirmDlg(t, html, ok, () => run(fn)) });
          res(evCtl);
        };
        if (window.GroupEvents) return ready();
        const sc = document.createElement('script'); sc.src = '/group-events.js'; sc.onload = ready; sc.onerror = () => { evLoading = null; rej(new Error('Etkinlik bileşeni yüklenemedi. Bağlantını kontrol edip tekrar dene.')); }; document.head.appendChild(sc);
      });
      return evLoading;
    }
    async function openEvents() { const c = await evLoad(); G.view = 'events'; renderSheet(); sheet.scrollTop = 0; try { await c.load(); } catch (e) { toast(e.message || 'Etkinlikler alınamadı.'); } if (G.view === 'events') renderSheet(); }

    /* ---------- Müzik paylaşımı (YouTube; ses her üyenin kendi cihazında çalar) ----------
       Lider: çalmaya başlarken «Etkinlikte paylaş» ya da «Sadece ben» seçer; paylaşırken durdur/devam/sonraki/önceki üyelere de gider.
       Üye: lider paylaşınca bir kez sorulur; «Dinle» denince sonraki değişiklikler (parça, duraklat) kendiliğinden uygulanır. */
    function emitMusic(p) {
      if (!G.cur) return;
      sock.timeout(6000).emit('grp:music', { gid: G.cur, ...p }, (err, r) => {
        if (err || !r || r.error) { if (!(r && r.error === 'Çok sık deneme.')) { G.mshared = false; toast((r && r.error) || 'Müzik paylaşılamadı; sadece sen dinliyorsun.', 5000); } }
        if (G.open && G.view === 'main') renderSheet();
      });
    }
    function askMusic(id) {
      G.mpend = id;
      modal('<h3>Müzik Paylaşımı</h3><p>Çaldığın müziği bu grup sürüşündeki üyelere de dinletmek ister misin? Ses her üyenin kendi telefonunda çalar.</p><div class="mm-mbtns" style="flex-direction:column"><button type="button" class="mm-mb primary" data-gmu="share" data-focus>Etkinlikte Paylaş</button><button type="button" class="mm-mb" data-gmu="solo">Sadece Kendim Dinleyeyim</button></div>');
    }
    function musicLocal(o) {
      const d = G.detail; if (!d || !d.ride || !iAmLeader() || !sock.connected) return;
      if (o.t === 'play') { if (!G.mshared || !G.mkeep) askMusic(o.id); else emitMusic({ src: o.id, playing: true }); return; }
      if (!G.mshared) return;
      if (o.t === 'stop') { G.mshared = false; emitMusic({ src: null }); renderIf(); }
      else if (o.t === 'toggle') emitMusic({ playing: !!o.playing });
      else if (o.t === 'cmd') emitMusic({ cmd: o.cmd });
    }
    const renderIf = () => { if (G.open && G.view === 'main') renderSheet(); };
    ctx.modalEl.addEventListener('click', e => {
      const b = e.target.closest('[data-gmu]'); if (!b) return;
      const id = G.mpend; G.mpend = null; closeModal(); if (!id) return;
      if (b.dataset.gmu === 'share') { G.mshared = true; G.mkeep = true; emitMusic({ src: id, playing: true }); toast('Müzik grupla paylaşılıyor.', 3000); }
      else { if (G.mshared) emitMusic({ src: null }); G.mshared = false; toast('Müziği sadece sen dinliyorsun.', 3000); }
      renderIf();
    });
    function musicRemote(p) {
      if (!p || p.gid !== G.cur || iAmLeader() || !ctx.yt) return;
      const m = p.music;
      if (!m) { if (G.mcur) { G.mcur = ''; if (G.mlisten === 'on') { ctx.yt.stop(); toast('Lider müziği durdurdu.', 3000); } } return; }
      if (p.gid === G.mgid && m.seq <= G.mseq && !p.cmd) return;
      G.mgid = p.gid; G.mseq = m.seq;
      const key = (m.video || '') + '|' + (m.list || '');
      const apply = () => {
        if (G.mcur !== key || !ctx.yt.active()) { G.mcur = key; ctx.yt.play({ video: m.video, list: m.list }, m.playing); }
        else if (p.cmd) ctx.yt.cmd(p.cmd); else ctx.yt.playing(m.playing);
      };
      if (G.mlisten === 'on') return apply();
      if (G.mlisten === 'off') { G.mcur = key; return; }
      G.mpendM = apply;
      modal('<h3>Lider Müzik Paylaşıyor ♫</h3><p><b>' + esc(m.by || 'Lider') + '</b> çaldığı müziği gruba dinletiyor. Kendi telefonunda dinlemek ister misin?</p><div class="mm-mbtns" style="flex-direction:column"><button type="button" class="mm-mb primary" data-gml="on" data-focus>Dinle</button><button type="button" class="mm-mb" data-gml="off">Şimdi Değil</button></div>');
    }
    ctx.modalEl.addEventListener('click', e => {
      const b = e.target.closest('[data-gml]'); if (!b) return;
      const f = G.mpendM; G.mpendM = null; closeModal();
      if (b.dataset.gml === 'on') { G.mlisten = 'on'; if (f) f(); } else G.mlisten = 'off';
      renderIf();
    });
    sock.on('grp:music', musicRemote);

    /* ---------- Arayüz ---------- */
    function confirmDlg(title, html, okLabel, fn, danger) {
      G.confirmFn = fn;
      modal('<h3>' + esc(title) + '</h3><p>' + html + '</p><div class="mm-mbtns"><button type="button" class="mm-mb" data-gact="no">Vazgeç</button><button type="button" class="mm-mb primary' + (danger ? ' danger' : '') + '" data-gact="yes" data-focus>' + esc(okLabel) + '</button></div>');
    }
    ctx.modalEl.addEventListener('click', e => {
      const b = e.target.closest('[data-gact]'); if (!b) return;
      const f = b.dataset.gact === 'yes' ? G.confirmFn : null; G.confirmFn = null; closeModal(); if (f) f();
    });
    function paintChip() {
      const b = curBrief(), live = G.detail && G.detail.ride;
      if (!b || !live) { chipEl.hidden = true; return; }
      const n = G.live && G.live.gid === G.cur ? G.live.members.filter(m => !m.lost && !m.wait).length : 0;
      chipEl.hidden = false; chipEl.dataset.s = G.sharing ? 'ok' : 'warn';
      chipEl.textContent = 'Grup: ' + b.name + (G.sharing ? ' · paylaşıyorsun' : ' · sürüş aktif, katıl') + (n ? ' · ' + n + ' konumda' : '');
    }
    function paint() {
      paintChip(); btn.classList.toggle('on', !!(G.detail && G.detail.ride));
      if (G.open) renderSheet();
      ctx.refresh();
    }
    function memberRows() {
      const d = G.detail, L = G.live && G.live.gid === G.cur ? G.live : null, lag = L ? Math.round((Date.now() - L.rx) / 1000) : 0;
      const live = new Map(L ? L.members.map(m => [m.u, m]) : []);
      const rows = d.members.map(m => {
        const l = live.get(m.username), me = m.username === ctx.user;
        let main = '', sub = '', cls = '';
        if (!d.ride) sub = m.role === 'leader' ? 'Lider' : '';
        else if (me && G.sharing && !l) sub = 'Konum bekleniyor';
        else if (!l) sub = 'Paylaşmıyor';
        else if (l.wait) sub = 'Konum bekleniyor';
        else if (l.lost) { sub = 'Konum yok · son ' + Math.round((l.age || 0) + lag) + ' sn önce'; cls = ' lost'; }
        else {
          const age = (l.age || 0) + lag;
          main = l.spd == null ? '–' : (l.est ? '~' : '') + l.spd;
          sub = [l.f ? '<b class="fl">' + FLAG[l.f] + (l.dl ? ' · ' + fmtM(l.dl) : '') + '</b>' : '', age > STALE_S ? age + ' sn önce' : '', l.spd == null ? 'hız bilinmiyor' : l.est ? 'tahmini hız' : ''].filter(Boolean).join(' · ');
          if (l.f) cls = ' flag'; if (age > STALE_S) cls += ' stale';
        }
        return { m, l, me, main, sub, cls };
      });
      return rows.sort((a, b) => (b.m.role === 'leader') - (a.m.role === 'leader') || (!!b.l?.f) - (!!a.l?.f));
    }
    function membersHtml() {
      const lead = iAmLeader();
      return memberRows().map(({ m, l, me, main, sub, cls }) => `<div class="mm-gm${cls}">
        <button type="button" class="mm-gmain" data-g="focus" data-u="${esc(m.username)}" ${l && l.lat != null ? '' : 'disabled'}>
          <span class="mm-gav${m.role === 'leader' ? ' lead' : ''}">${esc(m.username.charAt(0).toLocaleUpperCase('tr'))}</span>
          <span class="mm-gname">${esc(m.username)}${me ? ' (sen)' : ''}${m.role === 'leader' ? ' <i class="mm-gcrown">Lider</i>' : ''}<small>${sub}</small></span>
          <span class="mm-gspd">${main ? esc(main) + '<small>km/s</small>' : ''}</span></button>
        ${lead && !me ? `<div class="mm-gacts"><button type="button" data-g="leader" data-u="${esc(m.username)}">Lider Yap</button><button type="button" class="bad" data-g="kick" data-u="${esc(m.username)}">Çıkar</button></div>` : ''}</div>`).join('');
    }
    function paintMembers() { const box = sheet.querySelector('#mm-gmem'); if (box && G.detail) box.innerHTML = membersHtml(); }
    function listView() {
      return `<div class="mm-gsec"><b>Gruplarım</b>${G.list.length ? '' : '<p class="mm-note">Henüz bir sürüş grubun yok. Yeni grup oluştur ya da bir davet koduyla katıl.</p>'}
        ${G.list.map(g => `<button type="button" class="mm-glist${g.id === G.cur ? ' cur' : ''}" data-g="pick" data-id="${esc(g.id)}"><span>${esc(g.name)}${g.active ? ' <i class="mm-gcrown on">Sürüşte</i>' : ''}<small>${g.count} üye · lider ${esc(g.leader)}${g.role === 'leader' ? ' (sen)' : ''}</small></span></button>`).join('')}
        <div class="mm-grow2"><button type="button" class="mm-mb primary" data-g="new">Yeni Grup (Sosyal)</button><button type="button" class="mm-mb" data-g="join">Koda Katıl</button></div></div>`;
    }
    function formView(kind) {
      return kind === 'new'
        ? `<div class="mm-gsec"><b>Yeni Grup</b><input id="mm-gin" class="mm-ginput" maxlength="40" placeholder="Grup Adı (ör. Pazar Turu)" autocomplete="off"><div class="mm-grow2"><button type="button" class="mm-mb" data-g="list">Geri</button><button type="button" class="mm-mb primary" data-g="create">Oluştur</button></div></div>`
        : `<div class="mm-gsec"><b>Koda Katıl</b><input id="mm-gin" class="mm-ginput" maxlength="12" placeholder="Davet Kodu (ABCD-EFGH)" autocapitalize="characters" autocomplete="off"><div class="mm-grow2"><button type="button" class="mm-mb" data-g="list">Geri</button><button type="button" class="mm-mb primary" data-g="joingo">Katıl</button></div></div>`;
    }
    function detailView() {
      const d = G.detail, lead = iAmLeader(), act = !!d.ride, sharingHere = G.sharing && G.sharedGid === d.id;
      const L = G.live && G.live.gid === d.id ? G.live : null;
      let h = `<div class="mm-gsec"><div class="mm-gtitle"><b>${esc(d.name)}</b><button type="button" class="mm-glink" data-g="list">Grupları Değiştir</button></div>
        <button type="button" class="mm-mb mm-gwide" data-g="social">Grup Sayfası ve Gönderiler (Sosyal)</button>
        <p class="mm-note">${act ? 'Grup sürüşü <b>aktif</b>.' : 'Sürüş başlamadı.'} ${d.members.length} üye · lider ${esc(d.leader)}${lead ? ' (sen)' : ''}</p>`;
      if (lead) h += `<button type="button" class="mm-mb ${act ? 'danger' : 'primary'} mm-gwide" data-g="${act ? 'end' : 'start'}">${act ? 'Grup Sürüşünü Bitir' : 'Grup Sürüşünü Başlat'}</button>`;
      else if (!act) h += '<p class="mm-note">Lider sürüşü başlatınca burada ve haritada görünür.</p>';
      if (act) {
        h += `<label class="mm-mrow"><span>Konumumu Gruba Paylaş</span><input type="checkbox" id="mm-gshare" ${sharingHere ? 'checked' : ''}></label>
          <p class="mm-note">${sharingHere ? 'Konumun ve hızın grup üyelerine gösteriliyor ve kaydediliyor. Kapatınca durur.' : 'Kapalı: grup seni haritada görmez. Açmak için onay istenir.'}</p>`;
        if (L && !L.ref) h += '<p class="mm-note warn">Liderin konumu yok; geride kalma/uzaklaşma ölçülemiyor.</p>';
      }
      h += '</div>';
      h += `<div class="mm-gsec"><div class="mm-gtitle"><b>Üyeler</b>${act && L && L.members.some(m => m.lat != null) ? '<button type="button" class="mm-glink" data-g="fit">Hepsini Göster</button>' : ''}</div><div id="mm-gmem">${membersHtml()}</div></div>`;
      h += voiceSection(d);
      h += `<div class="mm-gsec"><b>Etkinlikler</b>${evCtl && evCtl.count() ? '<p class="mm-note">' + evCtl.count() + ' etkinlik' + (evCtl.next() ? ' · sıradaki: <b>' + esc(evCtl.next().title) + '</b>' : '') + '</p>' : '<p class="mm-note">Başlangıç, mola/uğrak ve varış noktalı tur planları.</p>'}<button type="button" class="mm-mb mm-gwide" data-g="events">Etkinlikler${evCtl && evCtl.count() ? ' (' + evCtl.count() + ')' : ''}</button></div>`;
      if (act && lead) h += `<div class="mm-gsec"><b>Müzik</b><p class="mm-note">${G.mshared ? '♫ Müziğin gruba <b>paylaşılıyor</b>. Durdur, devam ve parça değişimi üyelere de gider.' : 'Haritada YouTube müziği çalarken «Etkinlikte paylaş» ya da «Sadece kendim dinleyeyim» diye sorulur.'}</p>${G.mshared ? '<button type="button" class="mm-mb mm-gwide" data-g="mstop">Paylaşımı Durdur (müzik sende çalmaya devam eder)</button>' : ''}</div>`;
      else if (act && !lead) h += `<div class="mm-gsec"><b>Müzik</b><label class="mm-mrow"><span>Liderin Müziğini Dinle</span><input type="checkbox" id="mm-gml" ${G.mlisten === 'on' ? 'checked' : ''}></label><p class="mm-note">Lider müzik paylaşınca senin telefonunda da çalar. Kapatınca yalnızca kendi müziğin çalar.</p></div>`;
      // Güzergâh
      const mine = ctx.currentRoute();
      h += `<div class="mm-gsec"><b>Ana Güzergâh</b>`;
      if (d.route) h += `<p class="mm-note">${d.route.name ? esc(d.route.name) + ' · ' : ''}${fmtM(d.route.len)}</p><div class="mm-grow2"><button type="button" class="mm-mb" data-g="rshow">${G.showRoute ? 'Haritada Gizle' : 'Haritada Göster'}</button><button type="button" class="mm-mb" data-g="rfit">Güzergâha Git</button></div>`;
      else h += '<p class="mm-note">Liderin belirlediği ana güzergâh yok.</p>';
      if (lead) h += `<button type="button" class="mm-mb mm-gwide" data-g="rset" ${mine ? '' : 'disabled'}>${d.route ? 'Haritadaki rotayla değiştir' : 'Haritadaki rotayı grup güzergâhı yap'}</button>${mine ? '' : '<p class="mm-note">Önce haritada hedef seçip «Rota oluştur»a bas.</p>'}${d.route ? '<button type="button" class="mm-mb mm-gwide" data-g="rclear">Güzergâhı Kaldır</button>' : ''}`;
      h += '</div>';
      if (lead) h += `<div class="mm-gsec"><b>Davet</b><div class="mm-gcode">${esc(fmtCode(d.code))}</div>
          <div class="mm-grow2"><button type="button" class="mm-mb primary" data-g="share">Bağlantıyı Paylaş</button><button type="button" class="mm-mb" data-g="copy">Kodu Kopyala</button></div>
          <button type="button" class="mm-mb mm-gwide" data-g="regen">Kodu Yenile (eskisi geçersiz olur)</button></div>
        <div class="mm-gsec"><b>Grup Ayarları</b><input id="mm-gset-name" class="mm-ginput" maxlength="40" value="${esc(d.name)}" aria-label="Grup Adı">
          <div class="mm-mrow"><span>Geride Kalma Mesafesi</span><select id="mm-gset-gap" class="mm-sel">${GAPS.map(g => `<option value="${g}" ${g === d.gap ? 'selected' : ''}>${g >= 1000 ? g / 1000 + ' km' : g + ' m'}</option>`).join('')}</select></div>
          <button type="button" class="mm-mb mm-gwide" data-g="save">Kaydet</button><button type="button" class="mm-mb danger mm-gwide" data-g="delete">Grubu Sil</button></div>`;
      if (ctx.openAnalysis) h += `<div class="mm-gsec"><b>Geçmiş</b><button type="button" class="mm-mb mm-gwide" data-g="analysis">Grup Sürüşü Analizleri</button></div>`;
      h += `<div class="mm-gsec"><button type="button" class="mm-mb danger mm-gwide" data-g="leave">Gruptan Ayrıl</button></div>`;
      return h;
    }
    function renderSheet() {
      const keep = sheet.scrollTop, focusId = document.activeElement && sheet.contains(document.activeElement) ? document.activeElement.id : '';
      const body = G.view === 'new' || G.view === 'join' ? formView(G.view) : G.view === 'list' || !G.detail ? listView() : (G.view === 'events' || G.view === 'event') && evCtl ? (G.view === 'events' ? evCtl.listView() : evCtl.formView()) : detailView();
      sheet.innerHTML = `<div class="mm-gh"><b>Grup Sürüşü</b><button type="button" class="mm-gx" data-g="close" aria-label="Kapat">✕</button></div>${body}`;
      sheet.scrollTop = keep; if (focusId) { const f = sheet.querySelector('#' + focusId); if (f) f.focus(); }
    }
    function openSheet(view) { G.open = true; G.view = view || 'main'; sheet.hidden = false; renderSheet(); if (!G.list.length && !G.detail) loadList(); else if (G.cur) loadDetail().then(paint); }
    function closeSheet() { G.open = false; sheet.hidden = true; }
    btn.hidden = false;
    btn.addEventListener('click', () => (G.open ? closeSheet() : openSheet()));
    chipEl.addEventListener('click', () => openSheet());

    const inputVal = () => (sheet.querySelector('#mm-gin') || {}).value || '';
    const run = async (fn) => { try { await fn(); } catch (e) { toast(e.message || 'İşlem başarısız.'); } };
    function leaveCurrent() {
      G.selfLeft = true;
      return req('POST', detailUrl('/leave')).then(() => { if (G.sharing && G.sharedGid === G.cur) stop(false); G.cur = ''; G.detail = null; G.live = null; store.set('mm_gcur', ''); G.view = 'list'; clearRoute(); G.route = null; return loadList(); }).finally(() => { G.selfLeft = false; });
    }
    async function joinWith(code) {
      const j = await req('POST', '/api/rgroups/join', { code });
      G.cur = j.group.id; store.set('mm_gcur', G.cur); G.view = 'main'; await loadList(); openSheet();
      toast(j.already ? 'Zaten bu grubun üyesisin.' : '“' + j.group.name + '” grubuna katıldın.');
    }
    const inviteLink = () => location.origin + '/?grup=' + G.detail.code;
    const acts = {
      vjoin: () => run(async () => { const c = await gvLoad(); const r = await c.join(G.cur, (G.detail && G.detail.name) || ''); if (r && r.error) toast(r.error, 6000); renderSheet(); }),
      vleave: () => run(async () => { if (gvCtl) await gvCtl.leave(); renderSheet(); }),
      main: () => { G.view = 'main'; renderSheet(); }, events: () => run(openEvents), mstop: () => { G.mshared = false; emitMusic({ src: null }); renderSheet(); toast('Müzik paylaşımı durduruldu.', 3000); },
      close: closeSheet, list: () => { G.view = 'list'; renderSheet(); }, new: () => { if (window.openSocialGroups) { closeSheet(); window.openSocialGroups(); } else { G.view = 'new'; renderSheet(); const i = sheet.querySelector('#mm-gin'); if (i) i.focus(); } },   // asıl kaynak: Sosyal › Gruplarım
      social: () => { closeSheet(); if (window.openSocialGroups) window.openSocialGroups(G.cur); },
      join: () => { G.view = 'join'; renderSheet(); const i = sheet.querySelector('#mm-gin'); if (i) i.focus(); },
      pick: d => { if (evCtl) evCtl.reset(); G.cur = d.id; store.set('mm_gcur', G.cur); G.view = 'main'; G.detail = null; G.live = null; clearRoute(); G.route = null; G.watching = ''; renderSheet(); loadDetail().then(paint); },
      create: () => run(async () => { const j = await req('POST', '/api/rgroups', { name: inputVal() }); G.cur = j.group.id; store.set('mm_gcur', G.cur); G.view = 'main'; await loadList(); toast('Grup oluşturuldu. Davet kodunu arkadaşlarınla paylaş.'); }),
      joingo: () => run(() => joinWith(inputVal())),
      start: () => run(async () => { await req('POST', detailUrl('/start')); await loadDetail(); paint(); toast('Grup sürüşü başladı. Konumunu paylaşmak için anahtarı aç.', 6000); }),
      end: () => confirmDlg('Grup Sürüşü Bitirilsin mi?', 'Tüm üyelerin konum paylaşımı durur. Sürüş kaydı grup üyelerinin analizi için saklanır.', 'Bitir', () => run(async () => { await req('POST', detailUrl('/end')); await loadDetail(); paint(); }), true),
      kick: d => confirmDlg('Üye Çıkarılsın mı?', '<b>' + esc(d.u) + '</b> gruptan çıkarılır; konumu artık görünmez.', 'Çıkar', () => run(async () => { await req('POST', detailUrl('/kick'), { username: d.u }); await loadDetail(); paint(); }), true),
      leader: d => confirmDlg('Lider Değişsin mi?', '<b>' + esc(d.u) + '</b> grup lideri olur; sen üye olursun ve yönetim yetkilerini kaybedersin.', 'Lider Yap', () => run(async () => { await req('POST', detailUrl('/leader'), { username: d.u }); await loadDetail(); paint(); })),
      leave: () => confirmDlg('Gruptan Ayrılınsın mı?', iAmLeader() ? 'Liderlik sıradaki üyeye geçer (başka üye yoksa grup silinir).' : 'Gruptan çıkarsın; tekrar katılmak için davet kodu gerekir.', 'Ayrıl', () => run(leaveCurrent), true),
      delete: () => confirmDlg('Grup Silinsin mi?', 'Grup ve davet kodu silinir, tüm üyeler çıkarılır. Geçmiş sürüş kayıtlarına erişim de kapanır.', 'Grubu Sil', () => run(async () => { await req('DELETE', detailUrl()); G.cur = ''; G.view = 'list'; await loadList(); }), true),
      regen: () => confirmDlg('Davet Kodu Yenilensin mi?', 'Eski kod ve bağlantı çalışmaz. Mevcut üyeler etkilenmez.', 'Yenile', () => run(async () => { await req('POST', detailUrl('/code')); await loadDetail(); paint(); })),
      copy: () => run(async () => { await navigator.clipboard.writeText(G.detail.code); toast('Kod kopyalandı.'); }),
      share: () => run(async () => {
        const url = inviteLink(), text = '“' + G.detail.name + '” sürüş grubuna katıl';
        if (navigator.share) { try { await navigator.share({ title: 'Moto Life', text, url }); } catch (e) { if (e && e.name === 'AbortError') return; throw e; } }
        else { await navigator.clipboard.writeText(url); toast('Davet bağlantısı kopyalandı.'); }
      }),
      save: () => run(async () => { const name = (sheet.querySelector('#mm-gset-name') || {}).value, gap = Number((sheet.querySelector('#mm-gset-gap') || {}).value); await req('PATCH', detailUrl(), { name, gap }); await loadList(); toast('Kaydedildi.'); }),
      rset: () => run(async () => {
        const r = ctx.currentRoute(); if (!r) return toast('Önce haritada rota oluştur.');
        await req('PUT', detailUrl('/route'), { pts: r.coords.map(c => [c[0], c[1]]), name: r.label || '' }, true);
        await loadDetail(); await loadRoute(); paint(); toast('Grup güzergâhı güncellendi.');
      }),
      rclear: () => confirmDlg('Güzergâh Kaldırılsın mı?', 'Grubun ana güzergâhı silinir; geride kalma yalnızca lider mesafesiyle ölçülür.', 'Kaldır', () => run(async () => { await req('DELETE', detailUrl('/route')); await loadDetail(); paint(); }), true),
      rshow: () => { G.showRoute = !G.showRoute; store.set('mm_groute', G.showRoute ? '1' : '0'); drawRoute(); renderSheet(); },
      rfit: () => { if (!G.route) return; G.showRoute = true; store.set('mm_groute', '1'); drawRoute(); ctx.fitPoints(G.route.pts); closeSheet(); },
      analysis: () => { closeSheet(); ctx.openAnalysis(G.cur); },
      fit: () => { const p = markers().map(m => [m.lat, m.lon]); if (ctx.me()) p.push([ctx.me().lat, ctx.me().lon]); if (p.length) { ctx.fitPoints(p); closeSheet(); } },
      focus: d => { const m = markers().find(x => x.name === d.u); if (m) { ctx.flyTo(m.lat, m.lon); closeSheet(); } else if (d.u === ctx.user && ctx.me()) { ctx.flyTo(ctx.me().lat, ctx.me().lon); closeSheet(); } }
    };
    sheet.addEventListener('click', e => { const b = e.target.closest('[data-g]'); if (b && !b.disabled && acts[b.dataset.g]) acts[b.dataset.g](b.dataset); });
    sheet.addEventListener('click', e => { const b = e.target.closest('[data-ev]'); if (b && !b.disabled && evCtl) evCtl.act(b.dataset.ev, b.dataset); });
    sheet.addEventListener('input', e => { if (evCtl) evCtl.input(e); });
    sheet.addEventListener('change', e => {
      if (e.target.dataset && e.target.dataset.ef && evCtl) return evCtl.input(e);
      if (e.target.id === 'mm-gml') { G.mlisten = e.target.checked ? 'on' : 'off'; if (!e.target.checked && G.mcur && ctx.yt) ctx.yt.stop(); else if (e.target.checked) toast('Lider müziği paylaşınca otomatik çalacak.', 3500); return; }
      if (e.target.id !== 'mm-gshare') return;
      if (e.target.checked) { e.target.checked = false; askShare(); } else stop(true);
    });
    sheet.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id === 'mm-gin') acts[G.view === 'new' ? 'create' : 'joingo'](); });

    /* ---------- Soket ---------- */
    sock.on('grp:state', p => {
      if (!p || p.gid !== G.cur) return;
      G.live = { ...p, rx: Date.now() };
      if (G.detail && !!p.ride !== !!G.detail.ride) listSoon();
      if (p.rv && (!G.route || G.route.v !== p.rv)) loadRoute(); else if (!p.rv && G.route) { clearRoute(); G.route = null; }
      paintChip(); ctx.refresh();
      if (G.open && G.view === 'main') { clearTimeout(G.memT); G.memT = setTimeout(paintMembers, 150); }
    });
    sock.on('grp:alert', p => {
      if (!p || p.gid !== G.cur) return;
      const who = p.u === ctx.user ? 'Sen' : p.u, extra = p.m ? ' (' + fmtM(p.m) + ')' : '';
      toast(who + ' ' + (FLAG_LONG[p.f] || 'gruptan ayrıldı') + extra, 7000);
      if (navigator.vibrate && localStorage.getItem('ml_vib') !== '0') { try { navigator.vibrate(p.u === ctx.user ? [200, 100, 200] : 120); } catch {} }
    });
    sock.on('grp:changed', p => {
      if (!p) return;
      const cur = p.gid === G.cur;
      if (p.kind === 'ride-start') toast('Grup sürüşü başladı' + ((G.list.find(g => g.id === p.gid) || {}).name ? ': ' + G.list.find(g => g.id === p.gid).name : '') + '.', 6000);
      else if (p.kind === 'ride-end') { G.mshared = false; G.mkeep = false; G.mlisten = ''; G.mcur = ''; G.mseq = 0; if (G.sharing && G.sharedGid === p.gid) { G.sharing = false; G.sent = null; ctx.releaseGps(); } if (cur) { toast('Grup sürüşü bitti.', 5000); G.live = null; } }
      else if (p.kind === 'removed' && cur && !G.selfLeft) { toast('Bu gruptan çıkarıldın.', 6000); if (G.sharing) { G.sharing = false; ctx.releaseGps(); } }
      else if (p.kind === 'deleted' && cur) { toast('Grup silindi.', 5000); if (G.sharing) { G.sharing = false; ctx.releaseGps(); } }
      else if (p.kind === 'events' && cur) { if (evCtl) evCtl.load().then(() => { if (G.open && (G.view === 'events' || G.view === 'main')) renderSheet(); }).catch(() => {}); }
      else if (p.kind === 'join' && cur && p.u) toast(p.u + ' gruba katıldı.', 4000);
      else if (p.kind === 'leader' && cur) toast('Grup lideri değişti.', 4000);
      listSoon();
    });
    sock.on('grp:taken', () => { G.sharing = false; G.sent = null; ctx.releaseGps(); toast('Grup paylaşımı başka bir sekmede açıldı; burada kapatıldı.', 6000); paint(); });
    sock.on('connect', () => {
      G.watching = '';
      if (G.sharing) sock.timeout(6000).emit('grp:share', { gid: G.sharedGid, on: true, consent: true }, (err, r) => { if (err || !r || !r.ok) { G.sharing = false; ctx.releaseGps(); } else if (ctx.me()) sendFix(ctx.me(), true); paint(); });
      listSoon(); syncWatch();
    });
    sock.on('disconnect', () => { G.watching = ''; });

    /* ---------- Dış API (map.js) ---------- */
    async function joinPrompt(code) {
      const c = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
      if (c.length < 8) return toast('Davet kodu geçersiz.');
      try {
        const p = await req('GET', '/api/rgroups/preview?code=' + c);
        if (p.member) { G.cur = p.id; store.set('mm_gcur', G.cur); await loadList(); openSheet(); return toast('Zaten bu grubun üyesisin.'); }
        if (p.full) return toast('Bu grup dolu.');
        confirmDlg('Gruba Katıl', '<b>' + esc(p.name) + '</b> sürüş grubuna katılmak istiyor musun?<br>Lider: ' + esc(p.leader) + ' · ' + p.count + ' üye', 'Katıl', () => run(() => joinWith(c)));
      } catch (e) { toast(e.message || 'Davet kodu geçersiz.'); }
    }
    loadList();
    return {
      activate() { syncWatch(); clearInterval(G.timer); G.timer = setInterval(() => { if (G.live) { paintChip(); ctx.refresh(); if (G.open && G.view === 'main') paintMembers(); } }, 5000); ctx.refresh(); },
      deactivate() { clearInterval(G.timer); G.timer = 0; if (G.watching) { if (sock.connected) sock.emit('grp:unwatch', { gid: G.watching }); G.watching = ''; } G.live = null; closeSheet(); },
      onFix(f) { sendFix(f, false); },
      markers, sharing: () => G.sharing, stop, joinPrompt, open: openSheet, musicLocal
    };
  }
  window.GroupRide = { mount };
})();
