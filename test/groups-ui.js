'use strict';
// Sosyal › Gruplarım arayüzü: GERÇEK social.bundle.js Chromium'da, sahte (bellekte) /api; Tailwind yerel dosyadan. node test/groups-ui.js
const { chromium } = require('/opt/npm-tools/node_modules/playwright'); const http = require('http'), fs = require('fs'), path = require('path');
const TW = fs.readFileSync('/opt/npm-tools/node_modules/@zenuml/core/dist/vendor/tailwindcss/tailwindcss.js', 'utf8');
const BUNDLE = fs.readFileSync(path.join(__dirname, '..', 'public', 'social.bundle.js'));
const card = (u, n) => ({ username: u, name: n, av: '', bike: 'Honda CB' });
const ME = card('ben', 'Ben Test');
const G = { id: 'a'.repeat(16), name: 'Hafta Sonu', desc: 'Pazar sürüşleri', leader: 'ben', role: 'leader', code: 'ABCD2345', createdAt: Date.now() - 86400000, gap: 1000, ride: null, route: null,
  members: [{ ...card('ben', 'Ben Test'), role: 'leader', sharing: false, joinedAt: 1 }, { ...card('veli', 'Veli Yılmaz'), role: 'member', sharing: true, joinedAt: 2 }, { ...card('kaan', 'Kaan Demir'), role: 'admin', sharing: false, joinedAt: 3 }] };
let BLK = false, UNB = false, posts = [], seq = 0, EVS = []; const calls = [];
const view = p => ({ ...p, mine: p.author.username === 'ben', canDelete: true });
const srv = http.createServer((q, r) => {
  const u = new URL(q.url, 'http://x'), J = (o, s = 200) => { r.writeHead(s, { 'content-type': 'application/json' }); r.end(JSON.stringify(o)); };
  if (u.pathname === '/') { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return r.end('<!doctype html><meta name=viewport content="width=device-width"><script src="/tw.js"></script><body style="height:100vh;margin:0;background:#031420"><div id=root style="height:100vh"></div><script src="/social.bundle.js"></script>'); }
  if (u.pathname === '/tw.js') { r.writeHead(200, { 'content-type': 'text/javascript' }); return r.end(TW); }
  if (u.pathname === '/social.bundle.js') { r.writeHead(200, { 'content-type': 'text/javascript' }); return r.end(BUNDLE); }
  let body = ''; q.on('data', d => body += d); q.on('end', () => {
    let b = {}; try { b = body ? JSON.parse(body) : {}; } catch {} const m = q.method, p = u.pathname; calls.push(m + ' ' + p);
    if (p === '/api/social/me') return J({ me: { ...ME, bio: '', status: '', stats: { posts: 0, friends: 0, likes: 0 } } });
    if (p === '/api/social/friends') return J({ friends: BLK ? [] : [{ ...card('veli', 'Veli Yılmaz'), status: '', online: false }], incoming: [], outgoing: [], unreadTotal: 0 });
    if (p === '/api/social/users/veli') return J({ profile: { ...card('veli', 'Veli Yılmaz'), cv: '', bio: '', status: '', mood: '', statusAt: 0, stats: { posts: 0, friends: 0, likes: 0 } }, rel: BLK ? 'blocked' : UNB ? 'none' : 'friend', locked: BLK });
    if (p === '/api/social/users/veli/posts') return J({ posts: [], more: false, locked: BLK });
    if (m === 'POST' && p === '/api/social/blocks') { BLK = true; return J({ rel: 'blocked' }); }
    if (m === 'DELETE' && p === '/api/social/blocks/veli') { BLK = false; UNB = true; return J({ rel: 'none' }); }
    if (p === '/api/social/users/ben') return J({ profile: { ...ME, bio: '', status: '', mood: '', statusAt: 0, bike: 'Honda CB', stats: { posts: 0, friends: 0, likes: 0 } }, rel: 'self', locked: false });
    if (p === '/api/social/users/ben/posts') return J({ posts: [], more: false });
    if (p === '/api/social/profile' && m === 'PUT') { calls.push('MOOD=' + b.mood); return J({ ok: true }); }
    if (p === '/api/social/feed') return J({ posts: [], more: false });
    if (p === `/api/rgroups/${G.id}/role` && m === 'POST') { const t = G.members.find(x => x.username === b.username); if (t) t.role = b.role; return J({ group: { ...G, postCount: posts.length } }); }
    if (/\/pic\/(photo|cover)$/.test(p) && m === 'PUT') { G[p.split('/').pop()] = body.length ? '/x.png' : ''; calls.push('PIC ' + p.split('/').pop() + ' ' + (q.headers['content-type'] || '') + ' ' + body.length); return J({ group: { ...G, postCount: posts.length } }); }
    if (p === '/api/social/cover' && m === 'PUT') { calls.push('COVER ' + body.length); return J({ me: { ...ME, cv: body.length ? 'v1' : '' } }); }
    if (p === '/api/rgroups' && m === 'GET') return J({ groups: [{ id: G.id, name: G.name, desc: G.desc, role: 'leader', leader: 'ben', count: 2, active: false, hasRoute: false, posts: posts.length }] });
    if (p === '/api/rgroups' && m === 'POST') return J({ group: { ...G, name: b.name, desc: b.desc || '' } });
    if (p === '/api/rgroups/' + G.id && m === 'GET') return J({ group: { ...G, postCount: posts.length } });
    if (p === '/api/rgroups/' + G.id && m === 'PATCH') { Object.assign(G, b); return J({ group: { ...G, postCount: posts.length } }); }
    if (p === `/api/rgroups/${G.id}/posts` && m === 'GET') return J({ posts: posts.map(view), more: false });
    if (p === `/api/rgroups/${G.id}/posts` && m === 'POST') { const x = { id: 'p' + ++seq, author: ME, text: b.text, at: Date.now(), mood: b.mood || '', image: '', likes: 0, liked: false, commentCount: 0, comments: [] }; posts.unshift(x); return J({ post: view(x) }); }
    let mm = p.match(/\/posts\/(p\d+)\/like$/); if (mm) { const x = posts.find(y => y.id === mm[1]); x.liked = !x.liked; x.likes += x.liked ? 1 : -1; return J({ liked: x.liked, likes: x.likes }); }
    mm = p.match(/\/posts\/(p\d+)\/comments$/); if (mm && m === 'POST') { const x = posts.find(y => y.id === mm[1]); const c = { id: 'c' + ++seq, author: ME, text: b.text, at: Date.now(), canDelete: true }; x.comments.push(c); x.commentCount++; return J({ comment: c, commentCount: x.commentCount }); }
    mm = p.match(/\/posts\/(p\d+)\/comments\/(c\d+)$/); if (mm && m === 'DELETE') { const x = posts.find(y => y.id === mm[1]); x.comments = x.comments.filter(c => c.id !== mm[2]); x.commentCount--; return J({ ok: true }); }
    mm = p.match(/\/posts\/(p\d+)$/); if (mm && m === 'DELETE') { posts = posts.filter(y => y.id !== mm[1]); return J({ ok: true }); }
    if (p === '/api/geocode') return J({ results: [{ title: (u.searchParams.get('q') || '') + ' Merkez', subtitle: 'İstanbul', lat: 41.1, lon: 29.5 }, { title: (u.searchParams.get('q') || '') + ' Sahil', subtitle: 'İstanbul', lat: 41.2, lon: 29.6 }] });
    if (p.startsWith(`/api/rgroups/${G.id}/events`)) {
      const id = p.split('/')[5];
      if (m === 'GET') return J({ events: EVS, canEdit: true });
      if (m === 'POST') { const e = { id: 'e' + (EVS.length + 1), by: 'ben', createdAt: Date.now(), ...b }; EVS.push(e); return J({ event: e, events: EVS }); }
      if (m === 'PUT') { EVS = EVS.map(e => (e.id === id ? { ...e, ...b } : e)); return J({ events: EVS }); }
      if (m === 'DELETE') { EVS = EVS.filter(e => e.id !== id); return J({ ok: true, events: EVS }); }
    }
    J({ error: 'yok' }, 404);
  });
});
srv.listen(0, async () => {
  const b = await chromium.launch(), pg = await (await b.newContext({ viewport: { width: 390, height: 844 } })).newPage(); let ok = 0, bad = 0;
  const T = (c, m) => { c ? ok++ : bad++; console.log((c ? 'ok: ' : 'FAIL: ') + m); };
  const errs = []; pg.on('pageerror', e => errs.push(e.message));
  await pg.goto('http://127.0.0.1:' + srv.address().port + '/');
  await pg.evaluate(() => { const sock = { on() {}, off() {}, emit() {}, connected: false }; window.MotoSocial.mount(document.getElementById('root'), { me: { username: 'ben', firstName: 'Ben', lastName: 'Test' }, socket: sock, theme: 'dark', onUnread() {} }); });
  await pg.waitForSelector('nav[aria-label="Sosyal Sekmeler"]');
  const tabs = await pg.$$eval('nav[aria-label="Sosyal Sekmeler"] button', bs => bs.map(x => x.textContent.trim()));
  T(tabs.length === 4 && tabs[0].startsWith('Akış') && tabs[1].startsWith('Profil') && tabs[2] === 'Gruplarım' && tabs[3].startsWith('Mesajlar') && !tabs.some(x => x.startsWith('Arkadaşlar') || x.startsWith('Sohbet')), 'üst sekmeler: Akış, Profil, Gruplarım, Mesajlar (Mesajlar en sağda; Arkadaşlar/Sohbet yok) ' + tabs.join(', '));
  await pg.click('nav[aria-label="Sosyal Sekmeler"] >> text=Profil'); await pg.click('[role=tab]:has-text("Arkadaşlar")'); await pg.waitForSelector('text=Arkadaşlarım');
  T((await pg.textContent('body')).includes('Arkadaşlarım'), 'Profil › Arkadaşlar bölümü açılır (arkadaş listesi/arama profil içinde)');
  { await pg.click('text=Veli Yılmaz'); await pg.waitForSelector('button:has-text("Engelle")');
    T(await pg.isVisible('button:has-text("Mesaj Gönder")') && await pg.isVisible('button:has-text("Engelle")'), 'başkasının profilinde «Engelle» düğmesi var (arkadaşken Mesaj Gönder yanında)');
    await pg.click('button:has-text("Engelle")'); T(/Engellensin Mi\?/.test(await pg.textContent('body')) && !calls.includes('POST /api/social/blocks'), 'Engelle ilk dokunuşta onay ister (istek atmaz)');
    await pg.click('button:has-text("Engellensin Mi?")'); await pg.waitForSelector('button:has-text("Engeli Kaldır")'); T(calls.includes('POST /api/social/blocks') && !(await pg.$('button:has-text("Mesaj Gönder")')), 'onaylayınca engellenir: profilde «Engeli Kaldır», mesaj/arkadaş düğmeleri yok');
    await pg.click('button:has-text("Engeli Kaldır")'); await pg.waitForSelector('button:has-text("Arkadaş Ekle")'); T(calls.includes('DELETE /api/social/blocks/veli') && await pg.isVisible('button:has-text("Engelle")'), 'Engeli Kaldır: engel kalkar, «Arkadaş Ekle» + «Engelle» döner');
    BLK = false; UNB = false; await pg.click('button:has-text("Profilim")'); }
  await pg.click('[role=tab]:has-text("Profilim")'); await pg.click('nav[aria-label="Sosyal Sekmeler"] >> text=Akış');
  T(await pg.evaluate(() => { const n = document.querySelector('nav[aria-label="Sosyal Sekmeler"]'); return n.scrollWidth <= n.clientWidth + 1 && document.documentElement.scrollWidth <= innerWidth; }), '390 px: yatay taşma yok');
  await pg.click('text=Gruplarım'); await pg.waitForSelector('text=Hafta Sonu');
  T((await pg.textContent('body')).includes('Pazar sürüşleri') && (await pg.textContent('body')).includes('2 üye'), 'grup listesi: ad, açıklama, üye sayısı (haritayla ortak /api/rgroups)');
  await pg.click('text=Grup Oluştur'); await pg.fill('input[aria-label="Grup Adı"]', 'Yeni Grup'); await pg.fill('textarea[aria-label="Grup Açıklaması"]', 'Deneme');
  await pg.click('form button[type=submit]'); await pg.waitForSelector('text=Gönderiler');
  T(calls.some(c => c === 'POST /api/rgroups'), 'grup oluşturulur, açıklama gönderilir ve grup sayfası açılır');
  await pg.fill('textarea[placeholder="Gruba bir şey paylaş…"]', 'Selam grup'); await pg.click('form button[type=submit]'); await pg.waitForSelector('article >> text=Selam grup');
  T(true, 'grup içinde gönderi paylaşılır');
  await pg.click('article button[aria-pressed]'); await pg.waitForFunction(() => /\b1\b/.test(document.querySelector('article footer button').textContent));
  T(calls.includes(`POST /api/rgroups/${G.id}/posts/p1/like`), 'beğeni grup yoluna gider');
  await pg.click('article footer button:nth-child(2)'); await pg.fill('input[placeholder="Yorum Yaz…"]', 'güzel'); await pg.click('button[aria-label="Yorum Gönder"]'); await pg.waitForSelector('article >> text=güzel');
  T(calls.includes(`POST /api/rgroups/${G.id}/posts/p1/comments`), 'yorum grup yoluna gider');
  await pg.click('text=Üyeler ('); await pg.waitForSelector('text=Veli Yılmaz');
  const body = await pg.textContent('body'); T(body.includes('Konumu açık') && body.includes('Honda CB') && body.includes('Lider Yap') && body.includes('Çıkar'), 'üyeler: kart, motor, konum durumu; lider için Lider Yap/Çıkar');
  await pg.click('[role=tab]:has-text("Bilgi")'); await pg.waitForSelector('text=ABCD2345');
  const bi = await pg.textContent('body'); T(bi.includes('Pazar sürüşleri') && bi.includes('Üye Sayısı') && bi.includes('Davet') && bi.includes('Gruptan Ayrıl') && bi.includes('Grubu Sil'), 'bilgi: açıklama, istatistik, davet kodu (lider), ayrıl/sil');
  await pg.click('text=Adı ve Açıklamayı Düzenle'); await pg.fill('textarea[aria-label="Grup Açıklaması"]', 'Güncel'); await pg.click('form button[type=submit]'); await pg.waitForSelector('text=Güncel');
  T(calls.includes(`PATCH /api/rgroups/${G.id}`), 'lider açıklamayı düzenler');
  // duygu durumu: tek seçimli liste
  await pg.click('nav[aria-label="Sosyal Sekmeler"] >> text=Akış'); await pg.click('button[aria-label="Duygu Durumu Ekle"]'); await pg.waitForSelector('ul[role=listbox] li');
  T(await pg.$$eval('ul[role=listbox] li[role=option]', l => l.length) === 13, 'gönderi: duygu listesi 13 seçenek (Yok + 12)');
  await pg.click('ul[role=listbox] >> text=Havalı'); T(await pg.$$eval('ul[role=listbox]', l => l.length) === 0 && (await pg.textContent('body')).includes('Havalı'), 'gönderi: seçince liste kapanır, seçim görünür');
  await pg.click('button[aria-label="Duygu Durumu Ekle"]'); T(await pg.$$eval('li[aria-selected=true]', l => l.length) === 1, 'gönderi: aynı anda yalnız bir seçenek işaretli');
  await pg.click('ul[role=listbox] >> text=Mutlu'); T(await pg.$$eval('li[aria-selected=true]', l => l.length) === 0, 'gönderi: yeni seçim öncekinin yerine geçer (liste kapalı)');
  await pg.click('nav[aria-label="Sosyal Sekmeler"] >> text=Profil'); await pg.click('text=Profili Düzenle').catch(() => {});
  await pg.waitForSelector('button[aria-haspopup=listbox]'); await pg.click('button[aria-haspopup=listbox]');
  T(await pg.$$eval('ul[role=listbox] li[role=option]', l => l.length) === 13 && await pg.$$eval('li[aria-selected=true]', l => l.length) === 1, 'profil: açılır liste, tek seçim (varsayılan: Duygu Durumu Yok)');
  await pg.click('ul[role=listbox] >> text=Huzurlu'); T(await pg.$$eval('ul[role=listbox]', l => l.length) === 0 && (await pg.textContent('button[aria-haspopup=listbox]')).includes('Huzurlu'), 'profil: seçince kapanır, düğmede görünür');
  await pg.click('form:has(button[aria-haspopup=listbox]) button[type=submit]'); await pg.waitForFunction(() => true); await new Promise(r => setTimeout(r, 300)); T(calls.includes('MOOD=huzurlu'), 'profil: seçilen duygu durumu sunucuya gider');
  // ---- Roller, grup fotoğrafı/kapağı, profil kapağı ----
  await pg.evaluate(() => { window.Photo = { menu: (k, c) => { window.__pm = { k, c }; } }; });
  await pg.evaluate(id => window.dispatchEvent(new CustomEvent('ml:social-goto', { detail: { tab: 'groups', gid: id } })), G.id); await pg.waitForSelector('[aria-label="Grup Kapağını Değiştir"]', { timeout: 4000 });
  T(await pg.isVisible('[aria-label="Grup Fotoğrafını Değiştir"]'), 'lider: grup fotoğrafı ve kapağı düğmeleri görünür');
  await pg.click('[aria-label="Grup Kapağını Değiştir"]'); T(await pg.evaluate(() => window.__pm && window.__pm.k) === 'cover', 'kapak düğmesi Photo menüsünü «cover» ile açar');
  await pg.evaluate(() => window.__pm.c.save('data:image/jpeg;base64,/9j/4AAQ')); await new Promise(r => setTimeout(r, 250));
  T(calls.some(c => /^PIC cover application\/octet-stream \d+$/.test(c)), 'kapak octet-stream olarak PUT edilir');
  await pg.click('[aria-label="Grup Fotoğrafını Değiştir"]'); T(await pg.evaluate(() => window.__pm.k) === 'photo', 'fotoğraf düğmesi «photo» menüsünü açar');
  await pg.click('[role=tab]:has-text("Üyeler")'); await new Promise(r => setTimeout(r, 200));
  const mem = await pg.textContent('#root, body');
  T(/Yönetici/.test(mem) && /Kaan Demir/.test(mem), 'üyeler listesinde rol etiketi (Yönetici) görünür');
  T(await pg.isVisible('button:has-text("Yönetici Yap")') && await pg.isVisible('button:has-text("Yöneticiliği Al")'), 'lider: Yönetici Yap / Yöneticiliği Al düğmeleri');
  await pg.click('[role=tab]:has-text("Bilgi")'); await new Promise(r => setTimeout(r, 200));
  T(await pg.isVisible('summary:has-text("Roller ve Yetkiler")'), 'Bilgi: Roller ve Yetkiler açıklaması');
  await pg.click('[aria-label="Gruplarım"]'); await pg.click('button:has-text("Profil")').catch(() => {}); await new Promise(r => setTimeout(r, 300));
  if (await pg.isVisible('[aria-label="Kapak Fotoğrafını Değiştir"]')) { await pg.click('[aria-label="Kapak Fotoğrafını Değiştir"]'); T(await pg.evaluate(() => window.__pm.k) === 'cover', 'profil: kapak düğmesi Photo menüsünü açar'); await pg.evaluate(() => window.__pm.c.save('data:image/jpeg;base64,/9j/4AAQ')); await new Promise(r => setTimeout(r, 250)); T(calls.some(c => /^COVER \d+$/.test(c)), 'profil kapağı /api/social/cover ucuna gider'); }
  else T(false, 'profil: kapak düğmesi bulunamadı');
  // ---- Etkinlikler: oluşturma YALNIZ Sosyal › Gruplarım › grup içinde
  await pg.context().grantPermissions(['geolocation']); await pg.context().setGeolocation({ latitude: 41.01, longitude: 29.02 });
  await pg.evaluate(() => { window.__nav = null; window.openEventNav = ev => { window.__nav = ev; }; });
  await pg.evaluate(id => window.dispatchEvent(new CustomEvent('ml:social-goto', { detail: { tab: 'groups', gid: id } })), G.id); await pg.waitForSelector('[role=tab]:has-text("Etkinlik")', { timeout: 4000 });
  await pg.click('[role=tab]:has-text("Etkinlik")'); await pg.waitForSelector('text=Henüz Etkinlik Yok');
  T(await pg.isVisible('button:has-text("+ Yeni Etkinlik")'), 'grup sayfasında «Etkinlik» sekmesi: boş liste + «Yeni Etkinlik» (lider)');
  await pg.click('button:has-text("+ Yeni Etkinlik")'); await pg.fill('input[aria-label="Etkinlik adı"]', 'Şile Turu'); await pg.fill('input[aria-label="Tarih ve saat"]', '2099-01-01T09:00');
  await pg.click('form button[type=submit]'); await new Promise(r => setTimeout(r, 150)); T(!calls.includes(`POST /api/rgroups/${G.id}/events`) && /Başlangıç yeri seçilmeli/.test(await pg.textContent('body')), 'başlangıç yeri seçilmeden kaydedilmez (uyarı gösterilir)');
  const pick = async (label, q, i) => { const box = pg.locator('div:has(> div > span:text-is("' + label + '"))').first(); await box.locator('button:has-text("Ara")').first().click(); await pg.fill('input[aria-label="' + label + ' ara"]', q); await pg.press('input[aria-label="' + label + ' ara"]', 'Enter'); await pg.waitForSelector('button:has(b:has-text("' + q + ' ' + (i ? 'Sahil' : 'Merkez') + '"))'); await pg.click('button:has(b:has-text("' + q + ' ' + (i ? 'Sahil' : 'Merkez') + '"))'); };
  await pick('Başlangıç yeri', 'Kadıköy', 0); T(/Kadıköy Merkez/.test(await pg.textContent('form')), 'arama sonucundan başlangıç yeri seçilir');
  await pg.click('button:has-text("+ Mola Noktası Ekle")'); T(!/Uğrak/.test(await pg.textContent('form')), 'formda «Uğrak» sözcüğü yok');
  await pg.locator('button:has-text("Konumum")').nth(1).click(); await pg.waitForFunction(() => /Mola 1/.test(document.querySelector('form').textContent) && [...document.querySelectorAll('[data-ev-val]')].some(e => e.textContent === 'Konumum'), null, { timeout: 4000 });
  T(true, 'mola eklenir, «Konumum» cihaz konumuyla nokta alır');
  await pick('Varış noktası', 'Şile', 1); await pg.fill('input[aria-label="Not"]', 'Kask şart');
  await pg.click('form button[type=submit]'); await pg.waitForSelector('[data-ev-card]');
  T(calls.includes(`POST /api/rgroups/${G.id}/events`) && EVS.length === 1 && EVS[0].title === 'Şile Turu' && EVS[0].start.name === 'Kadıköy Merkez' && EVS[0].dest.name === 'Şile Sahil' && EVS[0].stops.length === 1 && EVS[0].stops[0].kind === 'mola' && Math.abs(EVS[0].stops[0].lat - 41.01) < 1e-6 && EVS[0].note === 'Kask şart' && EVS[0].at > Date.now(), 'kayıt isteği: başlangıç, uğrak (tür + konum), varış, not, tarih');
  const card = await pg.textContent('[data-ev-card]'); T(/Kadıköy Merkez → Şile Sahil/.test(card) && /Mola/.test(card) && /Kask şart/.test(card), 'etkinlik kartı: güzergâh özeti, uğrak, not');
  await pg.click('button:has-text("Navigasyonla Başla")'); T(await pg.evaluate(() => window.__nav && window.__nav.title === 'Şile Turu' && window.__nav.stops.length === 1 && window.__nav.dest.name === 'Şile Sahil'), '«Navigasyonla Başla»: etkinlik haritaya (normal navigasyona) devredilir');
  await pg.click('[data-ev-card] button:has-text("Düzenle")'); T(await pg.inputValue('input[aria-label="Etkinlik adı"]') === 'Şile Turu' && await pg.inputValue('input[aria-label="Tarih ve saat"]') === '2099-01-01T09:00', 'düzenle: kayıtlı değerler forma dolar');
  await pg.fill('input[aria-label="Etkinlik adı"]', 'Şile Turu 2'); await pg.click('form button[type=submit]'); await pg.waitForSelector('[data-ev-card]:has-text("Şile Turu 2")'); T(calls.includes(`PUT /api/rgroups/${G.id}/events/e1`), 'düzenleme PUT ile kaydedilir');
  // mola sırası: basılı tutup sürükle
  await pg.click('[data-ev-card] button:has-text("Düzenle")'); await pg.click('button:has-text("+ Mola Noktası Ekle")'); await pick('Mola 2', 'Şile', 1);
  T(await pg.locator('[data-grip]').count() === 2, 'iki mola olunca sürükleme tutamağı görünür');
  const names0 = await pg.evaluate(() => [...document.querySelectorAll('[data-stop]')].map(e => (e.querySelector('[data-ev-val]') || {}).textContent));
  const b1 = await pg.locator('[data-grip]').nth(0).boundingBox(), b2 = await pg.locator('[data-stop]').nth(1).boundingBox();
  await pg.mouse.move(b1.x + 20, b1.y + 8); await pg.mouse.down(); await pg.waitForTimeout(150); await pg.mouse.move(b1.x + 20, b1.y + 40);
  T(await pg.locator('[data-stop].ring-2').count() === 0, 'kısa basışta sürükleme başlamaz (uzun basma gerekir)');
  await pg.waitForTimeout(400); await pg.mouse.move(b2.x + 30, b2.y + 30, { steps: 5 }); await pg.mouse.up();
  const names1 = await pg.evaluate(() => [...document.querySelectorAll('[data-stop]')].map(e => (e.querySelector('[data-ev-val]') || {}).textContent));
  T(names1[0] !== names0[0] && names1[1] === names0[0] || names1.join() !== names0.join(), 'basılı tutup sürükleyince mola sırası değişir');
  T(/Mola 1/.test(await pg.locator('[data-stop]').nth(0).textContent()), 'etiketler sıraya göre yeniden numaralanır');
  await pg.click('form button:has-text("Vazgeç")');
  await pg.click('[data-ev-card] button:has-text("Sil")'); T(EVS.length === 1, 'Sil ilk dokunuşta onay ister (silmez)'); await pg.click('[data-ev-card] button:has-text("Silinsin mi?")'); await pg.waitForSelector('text=Henüz Etkinlik Yok'); T(EVS.length === 0, 'onaylayınca etkinlik silinir');
  T(await pg.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'etkinlik ekranı 390 px: yatay taşma yok');
  // dışarıdan açma (harita → Sosyal)
  await pg.evaluate(() => window.dispatchEvent(new CustomEvent('ml:social-goto', { detail: { tab: 'groups', gid: null } })));
  T(errs.length === 0, 'sayfa hatası yok ' + errs.join('|'));
  console.log('SONUÇ', ok, 'geçti', bad, 'başarısız'); await b.close(); srv.close(); process.exit(bad ? 1 : 0);
});
