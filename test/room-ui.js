'use strict';
// Sosyal › Gruplarım › grup › İnterkom sekmesi: GERÇEK social.bundle.js + room.js + mesh-adapter + comm-core + audio-core Chromium'da;
// /api (oda), soket, RTCPeerConnection, mikrofon, AudioContext SAHTE. node test/room-ui.js
const { chromium } = require('/opt/npm-tools/node_modules/playwright'); const http = require('http'), fs = require('fs'), path = require('path');
const TW = fs.readFileSync('/opt/npm-tools/node_modules/@zenuml/core/dist/vendor/tailwindcss/tailwindcss.js', 'utf8');
const P = f => fs.readFileSync(path.join(__dirname, '..', 'public', f));
const card = (u, n) => ({ username: u, name: n, av: '', bike: 'Honda CB' });
const GID = 'a'.repeat(16);
const G = { id: GID, name: 'Hafta Sonu', desc: '', leader: 'ben', role: 'leader', code: 'ABCD2345', createdAt: Date.now() - 86400000, gap: 1000, ride: null, route: null,
  members: [{ ...card('ben', 'Ben'), role: 'leader', sharing: false, joinedAt: 1 }, { ...card('veli', 'Veli'), role: 'member', sharing: false, joinedAt: 2 }, { ...card('kaan', 'Kaan'), role: 'member', sharing: false, joinedAt: 3 }] };
// sahte odalar (sunucunun biçimini taklit eder; asıl mantık test/room-node.js ve php-api.js'te)
let rooms = []; let room = null; const calls = []; let seq = 0, GR = null;
const U = { ben: 'u-ben', veli: 'u-veli', kaan: 'u-kaan' };
const mkRoom = (name, pw, leader) => ({ rid: ('c' + (++seq)).padEnd(12, '0'), name, pw, leader, parts: leader ? [{ name: leader, vol: 100, muted: false }] : [], src: null, ver: 1, inv: {}, exp: Date.now() + 23.5 * 3600000, ride: null });
rooms.push(mkRoom('Veli Odası', 'veli123', 'veli'));
const item = r => ({ rid: r.rid, name: r.name, count: r.parts.length, leaderName: r.leader || '', exp: r.exp, in: r.parts.some(p => p.name === 'ben'), invited: !!r.inv.ben, banned: false });
const viewFor = r => {
  const i = item(r); if (!i.in) return { ...i, ver: r.ver };
  const parts = r.parts.map(p => ({ uid: U[p.name], name: p.name, lead: p.name === r.leader, vol: p.vol, muted: p.muted, you: p.name === 'ben' })), lead = r.leader === 'ben';
  return { ...i, ver: r.ver, lead, leader: U[r.leader], parts, src: r.src, ride: r.ride ? { id: r.ride.id, startedAt: r.ride.startedAt, nums: r.ride.nums, mine: r.ride.nums['u-ben'] || null, by: 'ben' } : null,
    members: lead ? ['veli', 'kaan'].filter(n => !r.parts.some(p => p.name === n)).map(n => ({ uid: U[n], name: n, invited: !!r.inv[n] })) : undefined };
};
const dropBen = r => { r.parts = r.parts.filter(x => x.name !== 'ben'); if (r.leader === 'ben') r.leader = r.parts.length ? r.parts[0].name : null; };
const enterBen = r => { rooms.forEach(o => { if (o !== r) dropBen(o); }); if (!r.parts.some(p => p.name === 'ben')) r.parts.push({ name: 'ben', vol: 100, muted: false }); if (!r.leader) r.leader = 'ben'; };
const srv = http.createServer((q, r) => {
  const u = new URL(q.url, 'http://x'), J = (o, s = 200) => { r.writeHead(s, { 'content-type': 'application/json' }); r.end(JSON.stringify(o)); };
  if (u.pathname === '/') { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return r.end('<!doctype html><meta name=viewport content="width=device-width"><script src="/tw.js"></script><body style="height:100vh;margin:0;background:#031420"><div id=root style="height:100vh"></div><script src="/audio-core.js"></script><script src="/comm-core.js"></script><script src="/mesh-adapter.js"></script><script src="/room.js"></script><script>window.getRoomEngine=async()=>window.MLRoom||(window.MLRoom=RoomEngine.create({socket:window.__sock,radioUrl:"/radios"}));</script><script src="/social.bundle.js"></script>'); }
  const files = { '/tw.js': TW, '/social.bundle.js': P('social.bundle.js'), '/audio-core.js': P('audio-core.js'), '/comm-core.js': P('comm-core.js'), '/mesh-adapter.js': P('mesh-adapter.js'), '/room.js': P('room.js') };
  if (files[u.pathname]) { r.writeHead(200, { 'content-type': 'text/javascript' }); return r.end(files[u.pathname]); }
  if (u.pathname === '/radios') return J([{ name: 'Zeta FM', url_resolved: 'https://r.example/z', lastcheckok: 1 }, { name: 'Alfa FM', url_resolved: 'https://r.example/a', lastcheckok: 1 }, { name: 'Ölü FM', url_resolved: 'https://r.example/d', lastcheckok: 0 }, { name: 'Http FM', url_resolved: 'http://r.example/h', lastcheckok: 1 }]);
  let body = ''; q.on('data', d => body += d); q.on('end', () => {
    let b = {}; try { b = body ? JSON.parse(body) : {}; } catch {} const m = q.method, p = u.pathname, R = `/api/rgroups/${GID}/rooms`;
    if (p === '/api/social/me') return J({ me: { ...card('ben', 'Ben'), bio: '', status: '', stats: { posts: 0, friends: 0, likes: 0 } } });
    if (p === '/api/social/friends') return J({ friends: [], incoming: [], outgoing: [], unreadTotal: 0 });
    if (p === '/api/social/feed') return J({ posts: [], more: false });
    if (p === '/api/rgroups' && m === 'GET') return J({ groups: [{ id: GID, name: G.name, desc: '', role: 'leader', leader: 'ben', count: 3, active: false, hasRoute: false, posts: 0 }] });
    if (p === '/api/rgroups/' + GID && m === 'GET') return J({ group: { ...G, postCount: 0 } });
    if (p === `/api/rgroups/${GID}/posts`) return J({ posts: [], more: false });
    if (p === '/api/gvoice/ice') return J({ iceServers: [{ urls: 'stun:x' }] });
    if (p === R || p.startsWith(R + '/')) {
      const s = p.slice(R.length); if (m !== 'GET') calls.push(m + ' ' + (s || '/') + ' ' + body);
      if (s === '') {
        if (m === 'GET') return J({ rooms: rooms.map(item), mine: (rooms.find(x => item(x).in) || {}).rid || null, max: 10, now: Date.now() });
        if (rooms.some(x => x.name.toLowerCase() === String(b.name).toLowerCase())) return J({ error: 'Bu adda bir oda zaten var.' }, 409);
        const nr = mkRoom(b.name, b.password, null); rooms.push(nr); enterBen(nr); room = nr; return J({ room: viewFor(nr) });
      }
      const mm = s.match(/^\/([0-9a-f]{12})(\/.*)?$/), rm = mm && rooms.find(x => x.rid === mm[1]), t = mm && (mm[2] || '');
      if (!rm) return J({ error: 'Oda bulunamadı ya da süresi doldu.' }, 404);
      if (t === '' && m === 'GET') return J({ room: viewFor(rm) });
      if (t === '/join') { if (!rm.parts.some(x => x.name === 'ben') && b.password !== rm.pw) return J({ error: 'Oda şifresi yanlış.' }, 403); enterBen(rm); room = rm; return J({ room: viewFor(rm) }); }
      if (t === '/leave') { dropBen(rm); return J({ ok: true }); }
      if (t === '/close') { rooms = rooms.filter(x => x !== rm); return J({ ok: true }); }
      if (t === '/user') { const x = rm.parts.find(y => U[y.name] === b.uid); if (b.vol !== undefined) x.vol = b.vol; if (b.muted !== undefined) x.muted = b.muted; return J({ room: viewFor(rm) }); }
      if (t === '/kick') { rm.parts = rm.parts.filter(x => U[x.name] !== b.uid); return J({ room: viewFor(rm) }); }
      if (t === '/invite') { const n = Object.keys(U).find(k => U[k] === b.uid); rm.inv[n] = true; return J({ ok: true }); }
      if (t === '/source' && m === 'POST') { rm.src = { ...b, by: 'u-ben' }; return J({ room: viewFor(rm) }); }
      if (t === '/source' && m === 'DELETE') { rm.src = null; return J({ room: viewFor(rm) }); }
      if (t === '/ride/start') { if (rm.ride) return J({ error: 'Bu grupta bir sürüş zaten sürüyor.' }, 409); rm.ride = { id: 'ride1', startedAt: Date.now() - 125000, nums: {} }; return J({ room: viewFor(rm) }); }
      if (t === '/ride/end') { rm.ride = null; return J({ room: viewFor(rm) }); }
      if (t === '/ride/number') {
        if (!rm.ride) return J({ error: 'Bu odada aktif sürüş yok.' }, 409); const taken = Object.entries(rm.ride.nums).filter(([k]) => k !== 'u-ben').map(([, v]) => v); let n = b.n === '' || b.n == null ? 1 : Number(b.n); if (b.n === '' || b.n == null) while (taken.includes(n)) n++;
        if (taken.includes(n)) return J({ error: 'Bu numara başkasında; başka bir numara yaz.' }, 409); rm.ride.nums['u-ben'] = n; return J({ room: viewFor(rm), n });
      }
    }
    J({ error: 'yok' }, 404);
  });
});
srv.listen(0, async () => {
  const b = await chromium.launch(), ctx = await b.newContext({ viewport: { width: 390, height: 844 } }), pg = await ctx.newPage(); let ok = 0, bad = 0;
  const T = (c, m) => { c ? ok++ : bad++; console.log((c ? 'ok: ' : 'FAIL: ') + m); };
  const errs = []; pg.on('pageerror', e => errs.push(e.message));
  await pg.route(/youtube\.com\/iframe_api/, r => r.fulfill({ status: 200, contentType: 'text/javascript', body: 'window.YT={Player:function(el,o){window.__yt=o;this.loadVideoById=function(i){window.__ytid=i};this.setVolume=function(){};this.stopVideo=function(){};this.playVideo=function(){};setTimeout(function(){o.events&&o.events.onReady&&o.events.onReady({target:this})}.bind(this),5)}};setTimeout(function(){window.onYouTubeIframeAPIReady&&window.onYouTubeIframeAPIReady()},5)' }));
  await pg.addInitScript(() => {
    window.__rtc = { made: 0 }; window.__trk = { enabled: false, stopped: 0 }; window.__sock = (() => { const h = {}; return { em: [], on(e, f) { (h[e] = h[e] || []).push(f); }, off(e, f) { h[e] = (h[e] || []).filter(x => x !== f); }, fire(e, d) { (h[e] || []).forEach(f => f(d)); },
      emit(e, d, cb) { this.em.push([e, d]); if (e === 'gv:join') setTimeout(() => cb && cb({ ok: true, id: 'me', peers: [{ id: 'p1', uid: 'u-veli', name: 'veli' }] }), 5); else if (typeof cb === 'function') setTimeout(() => cb({ ok: true }), 1); } }; })();
    window.RTCPeerConnection = function () { window.__rtc.made++; this.localDescription = null; this.connectionState = 'new'; this.tracks = []; };
    Object.assign(window.RTCPeerConnection.prototype, { addTrack(t, s) { this.tracks.push(t); }, async createOffer() { return { type: 'offer', sdp: 'o' }; }, async createAnswer() { return { type: 'answer', sdp: 'a' }; }, async setLocalDescription(d) { this.localDescription = d; }, async setRemoteDescription() {}, async addIceCandidate() {}, close() {}, toJSON() { return {}; } });
    const track = { get enabled() { return window.__trk.enabled; }, set enabled(v) { window.__trk.enabled = v; }, stop() { window.__trk.stopped++; } };
    navigator.mediaDevices.getUserMedia = async () => ({ getAudioTracks: () => [track], getTracks: () => [track] });
    const AX = function () { this.state = 'running'; this.destination = {}; };
    Object.assign(AX.prototype, { createMediaStreamDestination() { return { stream: { id: 'musicstream', getAudioTracks: () => [{ kind: 'audio' }] } }; }, createGain() { return { gain: { value: 1 }, connect() {} }; }, createMediaElementSource() { return { connect() {} }; }, createMediaStreamSource() { throw new Error('yok'); }, resume() { return Promise.resolve(); } });
    window.AudioContext = AX;
    window.openGroupRide = c => { window.__gr = c; };
    HTMLMediaElement.prototype.play = function () { if (window.__block) return Promise.reject(Object.assign(new Error('The request is not allowed by the user agent or the platform in the current context, possibly because the user denied permission.'), { name: 'NotAllowedError' })); window.__played = (window.__played || []).concat(this.src || 'x'); return Promise.resolve(); }; HTMLMediaElement.prototype.pause = function () {};
  });
  await pg.goto('http://127.0.0.1:' + srv.address().port + '/');
  await pg.evaluate(() => { window.MotoSocial.mount(document.getElementById('root'), { me: { username: 'ben', firstName: 'Ben', lastName: 'Test' }, socket: window.__sock, theme: 'dark', onUnread() {} }); });
  await pg.waitForSelector('nav[aria-label="Sosyal Sekmeler"]');
  await pg.click('text=Gruplarım'); await pg.waitForSelector('text=Hafta Sonu'); await pg.click('text=Hafta Sonu'); await pg.waitForSelector('[role=tablist]');
  const tabs = await pg.$$eval('[role=tablist] [role=tab]', bs => bs.map(x => x.textContent.trim()));
  T(tabs.length === 5 && tabs[0] === 'Gönderiler' && tabs[1].startsWith('Üyeler') && tabs[2] === 'İnterkom ve Sürüş' && tabs[3] === 'Etkinlik' && tabs[4] === 'Bilgi', 'grup sekmeleri: Gönderiler – Üyeler – İnterkom ve Sürüş – Etkinlik – Bilgi');
  await pg.click('[role=tab]:has-text("İnterkom ve Sürüş")'); await pg.waitForSelector('text=İnterkom Odaları');
  const rowTxt = await pg.textContent('section:has(p:text-is("Veli Odası"))');
  T(/Lider @veli/.test(rowTxt) && /1 kişi/.test(rowTxt) && /Kalan 23 sa/.test(rowTxt), 'oda listesi: ad, lider, kişi sayısı, kalan süre (24 saatlik ömür)');
  T(!(await pg.isVisible('[role=tab]:has-text("Sürüş Başlat")')), 'odaya girmeden «Sürüş Başlat» ekranı yok');
  // başka üyenin odasına katıl: yanlış şifre
  await pg.click('section:has(p:text-is("Veli Odası")) button:has-text("Katıl")'); await pg.fill('input[placeholder="Oda Şifresi"]', 'yanlis'); await pg.click('button:text-is("Gir")'); await pg.waitForSelector('text=Oda şifresi yanlış');
  T(true, 'yanlış şifrede hata gösterilir');
  // kendi odanı kur
  await pg.click('button:has-text("Yeni Oda Kur")'); await pg.waitForSelector('button:text-is("Oda Kur")');
  T(await pg.isDisabled('button:text-is("Oda Kur")'), 'oda adı/şifre girilmeden «Oda Kur» pasif');
  await pg.fill('input[placeholder="Oda Adı"]', 'Yol Ekibi'); await pg.fill('input[placeholder="Şifre"]', 'abc'); T(await pg.isDisabled('button:text-is("Oda Kur")'), 'kısa şifrede pasif');
  await pg.fill('input[placeholder="Şifre"]', 'gizli1'); await pg.click('button:text-is("Oda Kur")'); await pg.waitForSelector('text=Mikrofon Kapalı'); await pg.waitForTimeout(300);
  T(calls.some(c => c === 'POST / {"name":"Yol Ekibi","password":"gizli1"}'), 'oda kurulur (ad + şifre sunucuya gider)');
  const em = await pg.evaluate(() => window.__sock.em.filter(x => x[0] === 'gv:join'));
  T(em.length === 1 && em[0][1].room === room.rid && em[0][1].gid === undefined, 'odaya girince sesli odaya oda kimliğiyle (gv:join {room}) bağlanır');
  const sub = await pg.$$eval('[role=tab]', bs => bs.map(x => x.textContent.trim()).filter(x => /^(İnterkom Odası|Sürüş Başlat)/.test(x)));
  T(sub.length === 2 && sub[0] === 'İnterkom Odası' && sub[1].startsWith('Sürüş Başlat'), 'oda içinde üstte iki ekran: İnterkom Odası | Sürüş Başlat');
  T(/Oda lideri sensin/.test(await pg.textContent('body')) && /Bağlı/.test(await pg.textContent('body')) && /Kalan 23 sa/.test(await pg.textContent('body')), 'lider rozeti + Bağlı + kalan süre');
  await pg.click('button[aria-label="Mikrofonu Aç"]'); T(await pg.evaluate(() => window.__trk.enabled === true) && /Mikrofon Açık/.test(await pg.textContent('body')), 'mikrofon düğmesi mikrofonu açar');
  await pg.click('button[aria-label="Mikrofonu Kapat"]'); T(await pg.evaluate(() => window.__trk.enabled === false), 'tekrar basınca kapatır');
  // arkadaş odaya girmiş gibi: sunucu durumuna veli ekle
  room.parts.push({ name: 'veli', vol: 100, muted: false }); await pg.waitForSelector('text=@veli', { timeout: 6000 });
  T(await pg.isVisible('button[aria-label="Konuşmasını Kapat"]') && await pg.isVisible('input[aria-label="veli ses düzeyi"]') && await pg.isVisible('button:has-text("At")'), 'lider: katılımcı için Sustur / ses kaydırıcısı / At görünür');
  await pg.click('button[aria-label="Konuşmasını Kapat"]'); await pg.waitForSelector('button[aria-label="Konuşmasını Aç"]');
  T(calls.some(c => /^POST \/[0-9a-f]{12}\/user .*"muted":true/.test(c)) && room.parts.find(x => x.name === 'veli').muted === true, 'lider kişinin konuşmasını kapatır (sunucuya gider)');
  await pg.fill('input[aria-label="veli ses düzeyi"]', '40'); await pg.waitForTimeout(900);
  T(room.parts.find(x => x.name === 'veli').vol === 40, 'lider kişi sesini kısar (kaydırıcı → sunucu)');
  T(await pg.evaluate(() => { const p = window.MLRoom.state; return !!p; }), 'motor uygulama düzeyinde (window.MLRoom)');
  // davet
  await pg.click('text=Gruptan Davet Et'); await pg.click('div:has(> span:text-is("@kaan")) > button'); await pg.waitForTimeout(300);
  T(calls.some(c => /^POST \/[0-9a-f]{12}\/invite .*u-kaan/.test(c)), 'lider grup üyesini davet eder');
  // ---------- SÜRÜŞ BAŞLAT (aynı oda, aynı katılımcılar) ----------
  await pg.click('[role=tab]:has-text("Sürüş Başlat")'); await pg.waitForSelector('button:has-text("Grup Sürüşünü Başlat")');
  T(/Oda lideri sürüşü başlatır|Sürüşü oda lideri başlatır|Başlayınca odadaki herkese/.test(await pg.textContent('body')), 'sürüş ekranı: açıklama + lider için başlat düğmesi');
  await pg.click('button:has-text("Grup Sürüşünü Başlat")'); await pg.waitForSelector('text=Sürüş numaranı yaz'); await pg.waitForTimeout(200);
  T(calls.some(c => /^POST \/[0-9a-f]{12}\/ride\/start/.test(c)) && /Boş bırakırsan ilk boş numara/.test(await pg.textContent('body')), 'sürüş başlayınca «Sürüş numaranı yaz» sorusu çıkar');
  T(await pg.isDisabled('button:has-text("Haritada Aç")'), 'numara yazılmadan «Haritada Aç» pasif');
  room.ride.nums['u-veli'] = 7;                    // veli 7 numarasını almış
  await pg.waitForSelector('text=@veli', { timeout: 6000 }); await pg.waitForTimeout(300);
  await pg.fill('input[aria-label="Sürüş numarası"]', '7'); await pg.click('button:text-is("Tamam")'); await pg.waitForSelector('text=Bu numara başkasında');
  T(true, 'çakışan numara kabul edilmez; anlaşılır hata gösterilir');
  await pg.fill('input[aria-label="Sürüş numarası"]', '3'); await pg.click('button:text-is("Tamam")'); await pg.waitForSelector('button:has-text("Haritada Aç"):not([disabled])');
  T(room.ride.nums['u-ben'] === 3 && !(await pg.isVisible('text=Sürüş numaranı yaz')), 'numara yazılır; soru kapanır');
  const rl2 = await pg.$$eval('section[aria-label="Sürücüler"] > div', ds => ds.map(d => d.textContent.replace(/\s+/g, ' ').trim()));
  T(rl2.length === 2 && /^3.*@ben/.test(rl2[0]) && /^7.*@veli/.test(rl2[1]), 'katılımcı listesi numaralarıyla (3 ben, 7 veli) sıralı');
  await pg.click('button:has-text("Haritada Aç")'); const gr = await pg.evaluate(() => window.__gr);
  T(gr && gr.gid === GID && gr.n === 3 && gr.name === 'Hafta Sonu', '«Haritada Aç» haritayı grup sürüşü modunda açar (grup, numara)');
  T(await pg.isVisible('text=Sürüş Sürüyor') && /2 dk/.test(await pg.textContent('body')), 'sürüş süresi gösterilir');
  await pg.click('[role=tab]:has-text("İnterkom Odası")'); await pg.waitForSelector('button[aria-label="Mikrofonu Aç"]');
  T(true, 'İnterkom Odası ekranına dönülünce oda durumu aynı');
  await pg.click('[role=tab]:has-text("Sürüş Başlat")'); await pg.click('button:has-text("Sürüşü Bitir")'); await pg.click('button:has-text("Sürüş Biter!")'); await pg.waitForSelector('button:has-text("Grup Sürüşünü Başlat")');
  T(room.ride === null && calls.some(c => /\/ride\/end/.test(c)), 'lider sürüşü bitirir');
  await pg.click('[role=tab]:has-text("İnterkom Odası")'); await pg.waitForSelector('button[aria-label="Mikrofonu Aç"]');
  // yayın paylaşımı
  await pg.fill('input[placeholder="YouTube video bağlantısı"]', 'merhaba'); await pg.click('button:has-text("Paylaş")'); await pg.waitForSelector('text=Tek bir YouTube video bağlantısı');
  T(true, 'geçersiz YouTube bağlantısı uyarı verir');
  await pg.fill('input[placeholder="YouTube video bağlantısı"]', 'https://youtu.be/dQw4w9WgXcQ'); await pg.click('button:has-text("Paylaş")'); await pg.waitForTimeout(600);
  T(calls.some(c => /^POST \/[0-9a-f]{12}\/source .*"type":"yt".*dQw4w9WgXcQ/.test(c)) && await pg.evaluate(() => window.__ytid === 'dQw4w9WgXcQ' || !!window.__yt), 'YouTube paylaşılır, lider cihazında da çalar');
  await pg.click('button:has-text("Radyo Paylaş")'); await pg.waitForSelector('text=Alfa FM');
  const rl = await pg.$$eval('ul li button', bs => bs.map(x => x.textContent.trim()));
  T(rl.join() === 'Alfa FM,Zeta FM', 'radyo listesi: yalnız aktif + https, A-Z');
  await pg.click('text=Zeta FM'); await pg.waitForTimeout(500);
  T(calls.some(c => /^POST \/[0-9a-f]{12}\/source .*"type":"radio".*r\.example\/z/.test(c)) && await pg.evaluate(() => (window.__played || []).some(x => /r\.example\/z/.test(x))), 'radyo paylaşılır ve lider cihazında çalar');
  await pg.click('button:has-text("Yayını Durdur")'); await pg.waitForTimeout(300); T(room.src === null && calls.some(c => /^DELETE \/[0-9a-f]{12}\/source/.test(c)), 'yayın durdurulur');
  // dosya yayını
  await pg.setInputFiles('input[type=file]', { name: 'Yol Şarkısı.mp3', mimeType: 'audio/mpeg', buffer: Buffer.alloc(2000, 1) }); await pg.waitForTimeout(500);
  T(calls.some(c => /^POST \/[0-9a-f]{12}\/source .*"type":"file".*Yol Şarkısı/.test(c)) && await pg.isVisible('button:has-text("Duraklat")'), 'müzik dosyası paylaşılır; lider ⏯ ⏭ kumandası görünür');
  T(await pg.evaluate(() => window.__rtc.made >= 1), 'eşe bağlantı kuruldu (mesh)');
  // atma
  await pg.click('button:text-is("At")'); await pg.click('button:text-is("At?")'); await pg.waitForTimeout(500); T(!room.parts.some(x => x.name === 'veli'), 'lider katılımcıyı atar (onaylı)');
  // yatay taşma
  T(await pg.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), '390 px: yatay taşma yok (lider görünümü)');
  await pg.screenshot({ path: process.env.SHOT || '/tmp/room-leader.png' });
  // ayrıl → liderlik devri (sunucuda); oda listesine dönülür
  room.parts.push({ name: 'kaan', vol: 100, muted: false });
  await pg.click('button:has-text("Odadan Ayrıl")'); await pg.click('button:has-text("Ayrıl?")'); await pg.waitForSelector('text=İnterkom Odaları'); await pg.waitForTimeout(300);
  T(room && room.leader === 'kaan' && await pg.evaluate(() => window.MLRoom.state.act === null && window.__sock.em.some(x => x[0] === 'gv:leave')), 'ayrılınca sesten çıkılır; oda sürer (24 saat), liderlik devredilir; liste görünür');
  T(await pg.isVisible('section:has(p:text-is("Yol Ekibi"))') && await pg.isVisible('section:has(p:text-is("Veli Odası"))'), 'listede birden fazla oda var');
  // yanlış şifre / katılma
  await pg.click('section:has(p:text-is("Yol Ekibi")) button:has-text("Katıl")'); await pg.fill('input[placeholder="Oda Şifresi"]', 'yanlis1'); await pg.click('button:text-is("Gir")'); await pg.waitForSelector('text=Oda şifresi yanlış');
  await pg.fill('input[placeholder="Oda Şifresi"]', 'gizli1'); await pg.click('button:text-is("Gir")'); await pg.waitForSelector('text=Mikrofon Kapalı');
  // üye görünümü: lider kaan, yayın var, ben susturuldum
  room.src = { type: 'radio', url: 'https://r.example/z', title: 'Zeta FM', by: 'u-kaan', at: 5 }; room.parts.find(x => x.name === 'ben').muted = true;
  await pg.waitForSelector('text=Lider Mikrofonunu Kapattı', { timeout: 6000 });
  T(await pg.isDisabled('button[aria-label="Mikrofonu Aç"]'), 'lider susturunca üyenin mikrofon düğmesi pasif');
  T(!(await pg.isVisible('button[aria-label="Konuşmasını Kapat"]')) && !(await pg.isVisible('button:has-text("Odayı Kapat")')) && !(await pg.isVisible('text=Radyo Paylaş')), 'üyede lider denetimleri yok');
  await pg.waitForSelector('text=Liderin yayınını dinle'); await pg.waitForTimeout(500);
  T(await pg.evaluate(() => (window.__played || []).filter(x => /r\.example\/z/.test(x)).length >= 2), 'üyenin cihazında lider radyosu çalar');
  const played0 = await pg.evaluate(() => window.__played.length);
  await pg.click('input[type=checkbox]'); await pg.waitForTimeout(300);
  T(await pg.evaluate(() => window.MLRoom.state.listen === false) && /interkom sürer/.test(await pg.textContent('body')) && await pg.evaluate(() => window.__sock.em.filter(x => x[0] === 'gv:leave').length === 1), 'üye yayını kapatır; interkomdan ÇIKMAZ (sadece yayın durur)');
  await pg.click('input[type=checkbox]'); await pg.waitForTimeout(500);
  T(await pg.evaluate(n => window.__played.length > n, played0), 'yayını yeniden açınca aynı yayın tekrar çalar');
  // iOS: otomatik oynatma engellenirse ham hata değil «Sesi Başlat» düğmesi
  await pg.evaluate(() => { window.__block = true; }); await pg.click('input[type=checkbox]'); await pg.click('input[type=checkbox]'); await pg.waitForTimeout(500);
  const btxt = await pg.textContent('body');
  T(!/not allowed by the user agent/i.test(btxt) && !/NotAllowedError/.test(btxt), 'engellenen otomatik oynatmada ham İngilizce hata gösterilmez');
  T(await pg.isVisible('button:has-text("Sesi Başlat")'), '«Sesi Başlat» düğmesi çıkar');
  const pl1 = await pg.evaluate(() => window.__played.length); await pg.evaluate(() => { window.__block = false; }); await pg.click('button:has-text("Sesi Başlat")'); await pg.waitForTimeout(500);
  T(await pg.evaluate(n => window.__played.length > n, pl1) && !(await pg.isVisible('button:has-text("Sesi Başlat")')), 'düğmeye dokununca ses başlar, düğme kaybolur');
  // lider silinirse / atılırsa
  room.parts = room.parts.filter(x => x.name !== 'ben'); await pg.waitForSelector('text=İnterkom Odaları', { timeout: 6000 });
  T(await pg.evaluate(() => window.MLRoom.state.act === null), 'odadan çıkarılan cihazda ses kapanır');
  T(await pg.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), '390 px: yatay taşma yok (üye görünümü)');
  T(errs.length === 0, 'sayfa hatası yok ' + errs.join('|'));
  console.log(`SONUÇ ${ok} geçti ${bad} başarısız`); await b.close(); srv.close(); process.exit(bad ? 1 : 0);
});
