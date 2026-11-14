'use strict';
// Sosyal › Gruplarım arayüzü: GERÇEK social.bundle.js Chromium'da, sahte (bellekte) /api; Tailwind yerel dosyadan. node test/groups-ui.js
const { chromium } = require('/opt/npm-tools/node_modules/playwright'); const http = require('http'), fs = require('fs'), path = require('path');
const TW = fs.readFileSync('/opt/npm-tools/node_modules/@zenuml/core/dist/vendor/tailwindcss/tailwindcss.js', 'utf8');
const BUNDLE = fs.readFileSync(path.join(__dirname, '..', 'public', 'social.bundle.js'));
const card = (u, n) => ({ username: u, name: n, av: '', bike: 'Honda CB' });
const ME = card('ben', 'Ben Test');
const G = { id: 'a'.repeat(16), name: 'Hafta Sonu', desc: 'Pazar sürüşleri', leader: 'ben', role: 'leader', code: 'ABCD2345', createdAt: Date.now() - 86400000, gap: 1000, ride: null, route: null,
  members: [{ ...card('ben', 'Ben Test'), role: 'leader', sharing: false, joinedAt: 1 }, { ...card('veli', 'Veli Yılmaz'), role: 'member', sharing: true, joinedAt: 2 }, { ...card('kaan', 'Kaan Demir'), role: 'admin', sharing: false, joinedAt: 3 }] };
let BLK = false, UNB = false, posts = [], seq = 0; const calls = [];
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
  // dışarıdan açma (harita → Sosyal)
  await pg.evaluate(() => window.dispatchEvent(new CustomEvent('ml:social-goto', { detail: { tab: 'groups', gid: null } })));
  T(errs.length === 0, 'sayfa hatası yok ' + errs.join('|'));
  console.log('SONUÇ', ok, 'geçti', bad, 'başarısız'); await b.close(); srv.close(); process.exit(bad ? 1 : 0);
});
