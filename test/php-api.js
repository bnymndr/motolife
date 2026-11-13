'use strict';
// PHP + MySQL arka ucu testi: dist-php paketini üretir, `php -S` ile (SQLite) başlatır ve uçtan uca dener. MySQL bu ortamda YOK: aynı SQL SQLite'ta çalışır.
// Çalıştır: node test/php-api.js
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto'), { spawn, execFileSync } = require('child_process');
let p = 0, f = 0; const ok = (c, m) => { c ? p++ : f++; console.log((c ? 'ok: ' : 'FAIL: ') + m); };
const root = path.join(__dirname, '..'), tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'phpapi-'));
const dist = path.join(tmp, 'dist');
execFileSync('node', ['build-php.js', dist], { cwd: root, stdio: 'ignore' });
const RC = require('../public/ride-core.js'), TC = require('../public/telemetry-core.js');
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const tok = (claims, key = privateKey) => { const h = b64({ alg: 'RS256', kid: 'k1' }), b = b64(claims), s = crypto.sign('RSA-SHA256', Buffer.from(h + '.' + b), key).toString('base64url'); return h + '.' + b + '.' + s; };
const PORT = 8100 + Math.floor(Math.random() * 400), base = 'http://127.0.0.1:' + PORT;
const srv = spawn('php', ['-S', '127.0.0.1:' + PORT, '-t', dist, path.join(root, 'php/dev-router.php')], {
  env: { ...process.env, REG_LIMIT: '1000', PHP_CLI_SERVER_WORKERS: '4', DB_DRIVER: 'sqlite', DB_FILE: path.join(tmp, 't.sqlite'), SESSION_SECRET: 'x'.repeat(32), GOOGLE_CLIENT_ID: 'gid.apps', TEST_JWKS_GOOGLE: JSON.stringify({ keys: [jwk] }), DEBUG: '1' }, stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));

const capSolve = q => { const m = String(q).match(/(\d+)\s*([+−×])\s*(\d+)/); const a = +m[1], b = +m[3]; return m[2] === '+' ? a + b : m[2] === '−' ? a - b : a * b; };
class C {
  constructor(name) { this.name = name; this.ck = ''; this.sid = ''; this.after = 0; this.ev = []; }
  async req(method, url, body, o = {}) {
    if (/^\/api\/(login|register|forgot)$/.test(url) && body && !Buffer.isBuffer(body) && !body.noCap) { const c = await (await fetch(base + '/api/captcha')).json(); body = { ...body, cToken: c.token, cAns: String(capSolve(c.q)) }; } else if (body && body.noCap) { body = { ...body }; delete body.noCap; }
    const h = { ...(this.ck ? { cookie: this.ck } : {}), ...(o.headers || {}) };
    let b; if (body !== undefined) { if (Buffer.isBuffer(body)) b = body; else { b = JSON.stringify(body); h['content-type'] = 'application/json'; } }
    const r = await fetch(base + url, { method, headers: h, body: b, redirect: 'manual' });
    for (const c of r.headers.getSetCookie ? r.headers.getSetCookie() : []) { const kv = c.split(';')[0]; if (/^sid=/.test(kv)) this.ck = /^sid=$/.test(kv) ? '' : kv; }
    const text = Buffer.from(await r.arrayBuffer());
    let j = null; try { j = JSON.parse(text.toString('utf8')); } catch {}
    return { s: r.status, j, text, headers: r.headers };
  }
  get(u) { return this.req('GET', u); } post(u, b) { return this.req('POST', u, b === undefined ? {} : b); }
  async rt(emits = []) {
    const r = await this.req('POST', '/api/rt', { sid: this.sid, after: this.after, emits });
    if (r.s === 200) { if (r.j.sid) this.sid = r.j.sid; for (const e of r.j.events) { this.after = Math.max(this.after, e.id); this.ev.push(e); } }
    return r;
  }
  async emit(ev, data) { const r = await this.rt([{ ev, data, id: 1 }]); return r.j && r.j.acks && r.j.acks['1']; }
  evs(n) { return this.ev.filter(e => e.ev === n); }
  clear() { this.ev = []; }
}
const base0 = { username: 'ali_k', firstName: 'Ali', lastName: 'Kaya', gender: 'erkek', bikeBrand: 'Yamaha', bikeModel: 'MT-07', email: 'ali@gmail.com', password: 'sifre123', phone: '0532 123 45 67' };
const reg = async (c, o) => c.post('/api/register', { ...base0, ...o });
const mk = async (name, n) => { const c = new C(name); const r = await reg(c, { username: name, email: name + '@gmail.com', phone: '05350000' + String(100 + n), firstName: name }); if (r.s !== 200) throw new Error('kayıt: ' + JSON.stringify(r.j)); return c; };
const T0 = Date.now() - 3600e3;

(async () => {
  for (let i = 0; i < 50; i++) { try { await fetch(base + '/api/me'); break; } catch { await sleep(200); } }
  // ---------- Hesap ----------
  const A0 = new C('a0');
  { // güvenlik sorusu (PHP)
    const Z = new C('cap'); let c = (await Z.get('/api/captcha')).j;
    ok(c && /^\d+ [+−×] \d+ kaç eder\?$/.test(c.q) && c.token.split('.').length === 3, 'güvenlik sorusu üretilir: ' + (c && c.q));
    let x = await Z.post('/api/login', { login: 'a', password: 'b', noCap: 1 }); ok(x.s === 400 && x.j.code === 'captcha', 'soru yanıtlanmadan giriş reddedilir');
    x = await Z.post('/api/register', { ...base0, noCap: 1 }); ok(x.s === 400 && x.j.code === 'captcha', 'soru yanıtlanmadan kayıt reddedilir');
    x = await Z.post('/api/forgot', { email: 'a@b.com', noCap: 1 }); ok(x.s === 400 && x.j.code === 'captcha', 'soru yanıtlanmadan şifre sıfırlama reddedilir');
    x = await Z.post('/api/login', { login: 'a', password: 'b', noCap: 1, cToken: c.token, cAns: String(capSolve(c.q) + 1) }); ok(x.s === 400 && x.j.code === 'captcha', 'yanlış cevap reddedilir');
    c = (await Z.get('/api/captcha')).j; const good = { login: 'yok', password: 'x', noCap: 1, cToken: c.token, cAns: String(capSolve(c.q)) };
    x = await Z.post('/api/login', good); ok(x.s === 401, 'doğru cevapla soru geçilir (şifre kontrolüne ilerler)');
    x = await Z.post('/api/login', good); ok(x.s === 400 && x.j.code === 'captcha', 'aynı soru ikinci kez kullanılamaz (tek kullanımlık)');
    c = (await Z.get('/api/captcha')).j; x = await Z.post('/api/login', { login: 'yok', password: 'x', noCap: 1, cToken: c.token, cAns: String(capSolve(c.q)), website: 'http://spam' }); ok(x.s === 400 && x.j.code === 'captcha', 'bal küpü alanı dolu: bot sayılır');
    c = (await Z.get('/api/captcha')).j; const [n, e, m] = c.token.split('.'); x = await Z.post('/api/login', { login: 'yok', password: 'x', noCap: 1, cToken: n + '.' + (Number(e) + 99999999) + '.' + m, cAns: String(capSolve(c.q)) }); ok(x.s === 400 && x.j.code === 'captcha', 'jeton süresi oynanırsa imza tutmaz');
  }
  let r = await reg(A0, {});
  ok(r.s === 200 && r.j.user.phone === '+905321234567' && r.j.user.username === 'ali_k', 'kayıt: telefon +90 biçimine çevrilir, kullanıcı döner');
  ok(/sid=/.test(A0.ck), 'kayıt: oturum çerezi verilir');
  r = await reg(new C(), { phone: '' }); ok(r.s === 400 && /telefon/i.test(r.j.error), 'kayıt: telefon zorunlu');
  r = await reg(new C(), { phone: '123' }); ok(r.s === 400, 'kayıt: geçersiz telefon reddedilir');
  r = await reg(new C(), { username: 'ALI_K', email: 'b@icloud.com', phone: '0533 111 22 33' }); ok(r.s === 409 && /kullanıcı adı/i.test(r.j.error), 'aynı kullanıcı adı (büyük/küçük harf fark etmez) reddedilir');
  r = await reg(new C(), { username: 'veli', email: 'veli@icloud.com', phone: '+90 532 123 45 67' }); ok(r.s === 409 && /telefon/i.test(r.j.error), 'aynı telefon farklı yazımla da reddedilir');
  r = await reg(new C(), { username: 'veli', email: 'ALI@gmail.com', phone: '0533 111 22 33' }); ok(r.s === 409 && /e-posta/i.test(r.j.error), 'aynı e-posta reddedilir');
  r = await reg(new C(), { username: 'veli', email: 'v@icloud.com', phone: '0533 111 22 33', emergencyName: 'Can' }); ok(r.s === 400, 'acil kişi: yalnız ad girilirse hata');
  r = await reg(new C(), { username: 'veli', email: 'v@icloud.com', phone: '0533 111 22 33', emergencyPhone: '0544 000 11 22' }); ok(r.s === 400, 'acil kişi: yalnız numara girilirse hata');
  r = await reg(new C(), { username: 'veli', email: 'v@icloud.com', phone: '0533 111 22 33', emergencyName: 'Can', emergencyPhone: '0544 000 11 22', bikeYear: 2021, bikeType: 'naked', bikeCc: 689 });
  ok(r.s === 200 && r.j.user.emergencyName === 'Can' && r.j.user.emergencyPhone === '+905440001122' && r.j.user.bikeYear === 2021 && r.j.user.bikeType === 'naked' && r.j.user.bikeCc === 689, 'acil kişi ve motosiklet alanları kaydedilir');
  r = await reg(new C(), { username: 'zeynep', email: 'z@gmail.com', phone: '0535 000 00 01' }); ok(r.s === 200 && r.j.user.emergencyName === '' && r.j.user.bikeYear === '', 'acil kişi ve ayrıntılar isteğe bağlı');
  r = await reg(new C(), { username: 'kullanici1', email: 'k@gmail.com', phone: '0535 000 00 02', bikeType: 'uzay' }); ok(r.s === 400, 'geçersiz motosiklet tipi reddedilir');
  r = await reg(new C(), { username: 'kullanici2', email: 'k2@gmail.com', phone: '0535 000 00 03', bikeYear: 1800 }); ok(r.s === 400, 'geçersiz yıl reddedilir');
  r = await reg(new C(), { username: 'kullanici3', email: 'k3@gmail.com', phone: '0535 000 00 04', bikeCc: 5 }); ok(r.s === 400, 'geçersiz motor hacmi reddedilir');
  r = await reg(new C(), { username: 'kullanici4', email: 'k4@gmail.com', phone: '+4915112345678' }); ok(r.s === 200 && r.j.user.phone === '+4915112345678', 'yurtdışı numara +kodlu kabul edilir');
  r = await A0.get('/api/me'); ok(r.s === 200 && r.j.user.email === 'ali@gmail.com' && r.j.user.hasPassword === true, 'me: oturumlu kullanıcı');
  r = await new C().get('/api/me'); ok(r.s === 401, 'me: oturumsuz 401');
  const me = r.j; const meU = (await A0.get('/api/me')).j.user;
  r = await A0.post('/api/account', { ...meU, phone: '0533 111 22 33' }); ok(r.s === 409 && /telefon/i.test(r.j.error), 'hesap: başkasının telefonu alınamaz');
  r = await A0.post('/api/account', { ...meU, phone: '' }); ok(r.s === 400, 'hesap: telefon boşaltılamaz');
  r = await A0.post('/api/account', { ...meU, bikeModel: 'MT-09', bikeYear: 2023 }); ok(r.s === 200 && r.j.user.bikeModel === 'MT-09' && r.j.user.bikeYear === 2023, 'hesap: motosiklet bilgisi güncellenir');
  { let bad = []; for (const t of ['supersport','sporttouring','naked','adventure','touring','cruiser','cafe','retro','motocross','scooter','sport','classic','enduro']) { const q = await A0.post('/api/account', { ...meU, bikeType: t }); if (!(q.s === 200 && q.j.user.bikeType === t)) bad.push(t); } ok(bad.length === 0, 'hesap: 10 My Moto tipi + 3 eski tip kaydedilir' + (bad.length ? ' (reddedilen: ' + bad + ')' : '')); }
  r = await A0.post('/api/account', { ...meU, email: 'yeni@gmail.com' }); ok(r.s === 401, 'hesap: e-posta değişimi mevcut şifre ister');
  r = await A0.post('/api/account', { ...meU, email: 'yeni@gmail.com', currentPassword: 'sifre123' }); ok(r.s === 200 && r.j.user.email === 'yeni@gmail.com', 'hesap: şifreyle e-posta değişir');
  const old = A0.ck;
  r = await A0.post('/api/account', { ...meU, email: 'yeni@gmail.com', currentPassword: 'sifre123', newPassword: 'yenisifre1' }); ok(r.s === 200 && A0.ck !== old, 'hesap: şifre değişince yeni çerez');
  const oc = new C(); oc.ck = old; r = await oc.get('/api/me'); ok(r.s === 401, 'şifre değişince eski oturum düşer');
  r = await A0.post('/api/avatar', { image: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==' }); ok(r.s === 200 && r.j.user.avatar.startsWith('data:image/jpeg'), 'avatar kaydedilir');
  r = await A0.post('/api/avatar', { image: 'data:text/html;base64,AAAA' }); ok(r.s === 400, 'avatar: yalnız jpeg');
  // giriş
  const L = async (login, password) => new C().post('/api/login', { login, password });
  r = await new C().post('/api/login', { login: 'ali_k', password: 'yenisifre1' }); ok(r.s === 200, 'giriş: güvenlik sorusu olmadan da girer');
  r = await L('ali_k', 'yenisifre1'); ok(r.s === 200, 'giriş: kullanıcı adıyla'); r = await L('YENI@gmail.com', 'yenisifre1'); ok(r.s === 200, 'giriş: e-postayla (büyük/küçük harf fark etmez)');
  r = await L('0532 123 45 67', 'yenisifre1'); ok(r.s === 200, 'giriş: telefonla');
  // şifre sıfırlama (e-posta gönderilemez: token'ı veritabanından okuyoruz)
  const sq = (sql) => execFileSync('php', ['-r', `$d=new PDO('sqlite:${path.join(tmp, 't.sqlite')}');$s=$d->query(${JSON.stringify(sql)});echo json_encode($s?$s->fetchAll(PDO::FETCH_ASSOC):[]);`]).toString();
  r = await new C().post('/api/forgot', { email: 'kayitsiz@gmail.com' }); ok(r.s === 200 && r.j.ok, 'forgot: kayıtsız e-postada da aynı yanıt');
  r = await new C().post('/api/reset', { token: 'x'.repeat(40), password: 'abcdef1' }); ok(r.s === 400, 'reset: geçersiz jeton');
  // ---------- Google ----------
  const claims = o => ({ iss: 'https://accounts.google.com', aud: 'gid.apps', sub: 'g-123', email: 'gkullanici@gmail.com', email_verified: true, given_name: 'Gül', family_name: 'Yılmaz', exp: Math.floor(Date.now() / 1000) + 600, ...o });
  r = await new C().get('/api/auth/config'); ok(r.j.google === 'gid.apps' && r.j.apple === null, 'auth/config: yalnız tanımlı sağlayıcı');
  r = await new C().post('/api/auth/apple', { credential: 'x' }); ok(r.s === 503, 'apple: tanımsızsa 503');
  r = await new C().post('/api/auth/google', { credential: tok(claims({ aud: 'baska' })) }); ok(r.s === 401, 'google: yanlış aud reddedilir');
  r = await new C().post('/api/auth/google', { credential: tok(claims({ email_verified: false })) }); ok(r.s === 401 && /doğrulanmam/.test(r.j.error), 'google: doğrulanmamış e-posta reddedilir');
  r = await new C().post('/api/auth/google', { credential: tok(claims({ exp: 1 })) }); ok(r.s === 401, 'google: süresi dolmuş token reddedilir');
  r = await new C().post('/api/auth/google', { credential: tok(claims(), crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey) }); ok(r.s === 401, 'google: sahte imza reddedilir');
  const G = new C(); r = await G.post('/api/auth/google', { credential: tok(claims()) });
  ok(r.s === 200 && r.j.needProfile && r.j.email === 'gkullanici@gmail.com' && r.j.firstName === 'Gül', 'google: yeni kullanıcı profil tamamlamaya yönlenir');
  const ticket = r.j.ticket;
  r = await G.post('/api/auth/complete', { ticket: 'bozuk', username: 'gul_y' }); ok(r.s === 400, 'complete: bozuk bilet');
  r = await G.post('/api/auth/complete', { ticket, username: 'gul_y', firstName: 'Gül', lastName: 'Yılmaz', gender: 'kadin', bikeBrand: 'Honda', bikeModel: 'CB', phone: '' }); ok(r.s === 400 && /telefon/i.test(r.j.error), 'complete: telefon zorunlu');
  r = await G.post('/api/auth/complete', { ticket, username: 'gul_y', firstName: 'Gül', lastName: 'Yılmaz', gender: 'kadin', bikeBrand: 'Honda', bikeModel: 'CB', phone: '0536 111 22 33', email: 'baska@x.com' });
  ok(r.s === 200 && r.j.user.email === 'gkullanici@gmail.com' && r.j.user.hasPassword === false && r.j.user.providers.includes('google'), 'complete: hesap oluşur, e-posta bilette gelen (istemci değiştiremez)');
  r = await new C().post('/api/auth/google', { credential: tok(claims()) }); ok(r.s === 200 && r.j.user && r.j.user.username === 'gul_y', 'google: mevcut hesap doğrudan girer');
  r = await G.post('/api/account/delete', { confirm: 'yanlis' }); ok(r.s === 400, 'hesap silme: kullanıcı adı onayı şart');
  r = await G.post('/api/account/delete', { confirm: 'GUL_Y' }); ok(r.s === 200, 'hesap silme: şifresiz (Google) hesap silinir'); r = await G.get('/api/me'); ok(r.s === 401, 'silinen hesabın oturumu geçersiz');

  // ---------- Sosyal ----------
  const A = await mk('ayse', 1), B = await mk('burak', 2), D = await mk('deniz', 3);
  r = await A.get('/api/social/search?q=bur'); ok(r.j.users.length === 1 && r.j.users[0].username === 'burak' && r.j.users[0].rel === 'none', 'arama: kullanıcı bulunur');
  r = await A.get('/api/social/search?q=b'); ok(r.j.users.length === 0, 'arama: 2 harften kısa boş');
  r = await A.post('/api/social/requests', { username: 'ayse' }); ok(r.s === 400, 'istek: kendine gönderilemez');
  await A.rt(); await B.rt(); await D.rt(); A.clear(); B.clear();
  r = await A.post('/api/social/requests', { username: 'burak' }); ok(r.s === 200 && r.j.rel === 'outgoing', 'istek gönderilir');
  r = await A.post('/api/social/requests', { username: 'burak' }); ok(r.s === 409, 'istek: tekrar gönderilemez');
  await B.rt(); ok(B.evs('social:request').length === 1 && B.evs('social:request')[0].data.from.username === 'ayse', 'gerçek zamanlı: istek bildirimi gelir');
  r = await B.get('/api/social/friends'); ok(r.j.incoming.length === 1 && r.j.incoming[0].user.username === 'ayse', 'friends: gelen istek listelenir');
  r = await B.post('/api/social/requests/' + r.j.incoming[0].id + '/accept'); ok(r.s === 200 && r.j.rel === 'friend', 'istek kabul edilir');
  r = await A.get('/api/social/friends'); ok(r.j.friends.length === 1 && r.j.friends[0].username === 'burak' && r.j.friends[0].online === true, 'friends: arkadaş çevrimiçi görünür');
  r = await D.post('/api/social/messages/ayse', { text: 'selam' }); ok(r.s === 400, 'mesaj: arkadaş olmayana gönderilemez');
  // DM
  A.clear(); B.clear();
  let a = await A.emit('dm:send', { to: 'burak', text: 'Merhaba Burak', cid: 'c1' }); ok(a && a.ok && a.message.text === 'Merhaba Burak' && a.message.cid === 'c1', 'dm:send ack döner');
  await B.rt(); await A.rt();
  ok(B.evs('dm:new').length === 1 && B.evs('dm:new')[0].data.from === 'ayse', 'dm:new alıcıya ulaşır'); ok(A.evs('dm:new').length === 1, 'dm:new gönderenin diğer sekmelerine de ulaşır');
  A.clear(); await B.emit('dm:typing', { to: 'ayse', typing: true }); await A.rt(); ok(A.evs('dm:typing').length === 1 && A.evs('dm:typing')[0].data.typing === true, 'dm:typing iletilir');
  r = await B.get('/api/social/friends'); ok(r.j.friends[0].unread === 1 && r.j.unreadTotal === 1 && r.j.friends[0].last.text === 'Merhaba Burak', 'okunmamış sayısı ve son mesaj');
  A.clear(); r = await B.get('/api/social/messages/ayse'); ok(r.j.messages.length === 1 && r.j.messages[0].read === false, 'mesaj geçmişi gelir');
  await A.rt(); ok(A.evs('dm:read').length === 1, 'okundu bilgisi gönderene gider'); r = await B.get('/api/social/friends'); ok(r.j.friends[0].unread === 0, 'okununca sayaç sıfırlanır');
  r = await A.post('/api/social/messages/burak', { text: 'REST ile', cid: 'c2' }); ok(r.s === 200 && r.j.message.cid === 'c2', 'mesaj REST yedeği çalışır');
  // profil, gönderi
  r = await A.req('PUT', '/api/social/profile', { bio: 'Motor tutkunu', status: 'Yoldayım', mood: 'mutlu' }); ok(r.s === 200 && r.j.me.status === 'Yoldayım' && r.j.me.mood === 'mutlu' && r.j.me.statusAt > 0, 'profil: durum ve duygu');
  B.clear(); await B.rt(); r = await A.req('PUT', '/api/social/profile', { status: 'Mola' }); await B.rt(); ok(B.evs('social:status').some(e => e.data.username === 'ayse' && e.data.status === 'Mola'), 'durum değişimi arkadaşa gider');
  const jpg = Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), crypto.randomBytes(2000)]);
  r = await A.req('POST', '/api/social/upload', Buffer.from('xx'), { headers: { 'content-type': 'image/jpeg' } }); ok(r.s === 400, 'yükleme: JPEG olmayan reddedilir');
  r = await A.req('POST', '/api/social/upload', jpg, { headers: { 'content-type': 'image/jpeg' } }); ok(r.s === 200 && /^[0-9a-f]{16}$/.test(r.j.image), 'yükleme: JPEG kabul edilir'); const imgId = r.j.image;
  r = await A.post('/api/social/posts', { text: 'İlk gönderi', image: imgId, mood: 'havali' }); ok(r.s === 200 && r.j.post.image === '/api/social/img/' + imgId && r.j.post.mine && r.j.post.mood === 'havali', 'gönderi oluşturulur'); const postId = r.j.post.id;
  r = await A.post('/api/social/posts', { text: 'x', image: imgId }); ok(r.s === 400, 'aynı fotoğraf iki gönderiye eklenemez');
  r = await A.post('/api/social/posts', { text: '   ' }); ok(r.s === 400, 'boş gönderi reddedilir');
  r = await B.get('/api/social/img/' + imgId); ok(r.s === 200 && r.text.equals(jpg), 'fotoğrafı arkadaş görür'); r = await D.get('/api/social/img/' + imgId); ok(r.s === 404, 'fotoğrafı yabancı göremez');
  r = await B.get('/api/social/feed'); ok(r.j.posts.length === 1 && r.j.posts[0].id === postId && r.j.posts[0].liked === false, 'akış: arkadaşın gönderisi');
  r = await D.get('/api/social/feed'); ok(r.j.posts.length === 0, 'akış: yabancıya görünmez'); r = await D.post('/api/social/posts/' + postId + '/like'); ok(r.s === 404, 'yabancı beğenemez');
  r = await B.post('/api/social/posts/' + postId + '/like'); ok(r.j.liked === true && r.j.likes === 1, 'beğeni'); r = await B.post('/api/social/posts/' + postId + '/like'); ok(r.j.liked === false && r.j.likes === 0, 'beğeni geri alınır');
  A.clear(); r = await B.post('/api/social/posts/' + postId + '/comments', { text: 'Güzel!' }); ok(r.s === 200 && r.j.commentCount === 1 && r.j.comment.author.username === 'burak', 'yorum eklenir'); await A.rt(); ok(A.evs('social:notify').length === 1, 'yorum bildirimi gönderilir');
  r = await B.get('/api/social/feed'); ok(r.j.posts[0].commentCount === 1 && r.j.posts[0].comments[0].text === 'Güzel!', 'akış: yorumlar görünür');
  r = await B.get('/api/social/users/ayse'); ok(r.j.rel === 'friend' && r.j.locked === false && r.j.profile.stats.posts === 1 && r.j.profile.bio === 'Motor tutkunu', 'kullanıcı profili');
  r = await D.get('/api/social/users/ayse'); ok(r.j.rel === 'none' && r.j.locked === true, 'yabancıya profil kilitli'); r = await D.get('/api/social/users/ayse/posts'); ok(r.j.locked === true && r.j.posts.length === 0, 'yabancı gönderileri göremez');
  r = await B.req('DELETE', '/api/social/posts/' + postId); ok(r.s === 404, 'başkasının gönderisi silinemez'); r = await A.req('DELETE', '/api/social/posts/' + postId); ok(r.s === 200, 'gönderi silinir');
  r = await B.get('/api/social/img/' + imgId); ok(r.s === 404, 'gönderi silinince fotoğraf da silinir');
  r = await A.get('/api/social/avatar/ayse'); ok(r.s === 404, 'avatarsız kullanıcı 404');

  // ---------- Canlı konum ----------
  A.clear(); B.clear(); D.clear();
  a = await A.emit('loc:share', { on: true, aud: 'friends' }); ok(a.error && /onay/i.test(a.error), 'loc:share: açık onay şart');
  a = await A.emit('loc:share', { on: true, consent: true, aud: 'herkes' }); ok(a.error, 'loc:share: geçersiz kapsam');
  a = await A.emit('loc:share', { on: true, consent: true, aud: 'friends' }); ok(a.ok && a.sharing, 'loc:share açılır');
  await A.rt([{ ev: 'loc:update', data: { lat: 41.0, lon: 29.0, acc: 10, riding: true } }]);
  a = await B.emit('loc:watch', { lat: 41.0, lon: 29.0, km: 50 }); ok(a.ok, 'loc:watch');
  ok(B.evs('loc:riders').length >= 1 && B.evs('loc:riders').pop().data.some(x => x.u === 'ayse' && x.rel === 'friend' && x.lat === 41 && !x.approx), 'loc:riders: arkadaş tam konumla görünür');
  a = await D.emit('loc:watch', { lat: 41.0, lon: 29.0, km: 50 }); ok(D.evs('loc:riders').pop().data.length === 0, 'loc:riders: yalnız-arkadaş paylaşımı yabancıya görünmez');
  a = await A.emit('loc:share', { on: true, consent: true, aud: 'all' });
  await A.rt([{ ev: 'loc:update', data: { lat: 41.00049, lon: 29.00051, acc: 10, riding: false } }]); await D.rt();
  const row = D.evs('loc:riders').pop().data[0]; ok(row && row.approx === true && row.lat === 41 && row.lon === 29.001, 'loc:riders: yabancıya ≈100 m yuvarlanmış konum');
  a = await D.emit('loc:watch', { off: true }); ok(a.ok, 'loc:watch kapatılır');
  const A2 = new C('ayse2'); A2.ck = A.ck; await A2.rt(); a = await A2.emit('loc:share', { on: true, consent: true, aud: 'friends' }); await A.rt(); ok(A.evs('loc:taken').length === 1, 'loc:taken: paylaşım diğer sekmeye geçer');
  A.clear(); await A2.emit('loc:share', { on: false }); a = await B.emit('loc:watch', { lat: 41, lon: 29, km: 50 }); ok(B.evs('loc:riders').pop().data.length === 0, 'paylaşım kapatılınca konum hemen kaybolur');
  await B.emit('loc:watch', { off: true });

  // ---------- Grup sürüşü ----------
  r = await A.post('/api/rgroups', { name: 'x' }); ok(r.s === 400, 'grup: kısa ad reddedilir');
  r = await A.post('/api/rgroups', { name: 'Hafta Sonu Turu' }); ok(r.s === 200 && r.j.group.role === 'leader' && /^[A-Z2-9]{8}$/.test(r.j.group.code), 'grup oluşturulur, davet kodu üretilir'); const gid = r.j.group.id, code = r.j.group.code;
  r = await B.post('/api/rgroups/join', { code: 'ZZZZZZZZ' }); ok(r.s === 404, 'grup: geçersiz kod');
  r = await B.get('/api/rgroups/preview?code=' + code.toLowerCase()); ok(r.j.name === 'Hafta Sonu Turu' && r.j.leader === 'ayse' && r.j.member === false, 'önizleme: ad, lider');
  r = await B.post('/api/rgroups/join', { code }); ok(r.s === 200 && r.j.group.role === 'member' && r.j.group.code === undefined && r.j.group.members.length === 2, 'gruba katılınır (kod yalnız lidere görünür)');
  r = await D.get('/api/rgroups/' + gid); ok(r.s === 404, 'üye olmayan için grup yok gibi davranır');
  r = await B.req('PATCH', '/api/rgroups/' + gid, { gap: 2000 }); ok(r.s === 403, 'ayar: yalnız lider'); r = await A.req('PATCH', '/api/rgroups/' + gid, { gap: 777 }); ok(r.s === 400, 'ayar: geçersiz mesafe');
  r = await A.req('PATCH', '/api/rgroups/' + gid, { gap: 500 }); ok(r.s === 200 && r.j.group.gap === 500, 'ayar: mesafe değişir');
  // ---------- Grup içi gönderi / beğeni / yorum ----------
  r = await A.req('PATCH', '/api/rgroups/' + gid, { desc: 'Pazar sürüşleri' }); ok(r.s === 200 && r.j.group.desc === 'Pazar sürüşleri', 'grup: açıklama (lider)');
  r = await B.req('PATCH', '/api/rgroups/' + gid, { desc: 'x' }); ok(r.s === 403, 'grup: açıklamayı yalnız lider değiştirir');
  r = await B.get('/api/rgroups/' + gid); ok(r.j.group.desc === 'Pazar sürüşleri' && r.j.group.members.every(m => 'av' in m && 'bike' in m && m.joinedAt > 0 && !('phone' in m)), 'grup: üye kartında motor/katılım var, telefon yok');
  r = await D.get('/api/rgroups/' + gid + '/posts'); ok(r.s === 404, 'grup gönderileri: üye olmayan göremez');
  r = await D.post('/api/rgroups/' + gid + '/posts', { text: 'merhaba' }); ok(r.s === 404, 'grup gönderisi: üye olmayan paylaşamaz');
  r = await B.post('/api/rgroups/' + gid + '/posts', { text: '' }); ok(r.s === 400, 'grup gönderisi: boş reddedilir');
  r = await B.req('POST', '/api/social/upload', Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), Buffer.alloc(1500, 7)]), { headers: { 'content-type': 'image/jpeg' } }); const gimg = r.j.image; ok(r.s === 200 && gimg, 'grup: fotoğraf yüklenir');
  r = await B.post('/api/rgroups/' + gid + '/posts', { text: 'ilk', image: gimg, mood: 'mutlu' }); const gpid = r.j.post && r.j.post.id;
  ok(r.s === 200 && r.j.post.image.endsWith(gimg) && r.j.post.mood === 'mutlu' && r.j.post.mine && r.j.post.canDelete, 'grup gönderisi: foto + ruh hali');
  r = await B.post('/api/rgroups/' + gid + '/posts', { text: 'x', image: gimg }); ok(r.s === 400, 'grup gönderisi: aynı fotoğraf tekrar kullanılamaz');
  r = await A.get('/api/social/img/' + gimg); ok(r.s === 200 && r.text.length > 1000, 'grup fotoğrafı: üye (arkadaş olmasa da) görür');
  r = await D.get('/api/social/img/' + gimg); ok(r.s === 404, 'grup fotoğrafı: üye olmayan göremez');
  r = await A.get('/api/rgroups/' + gid + '/posts'); ok(r.j.posts.length === 1 && !r.j.posts[0].mine && r.j.posts[0].canDelete && r.j.posts[0].author.username === 'burak', 'grup akışı: üye görür, lider silebilir');
  r = await A.get('/api/social/feed'); ok(!r.j.posts.some(x => x.id === gpid), 'grup gönderisi genel akışa sızmaz');
  r = await A.post('/api/rgroups/' + gid + '/posts/' + gpid + '/like'); ok(r.j.liked === true && r.j.likes === 1, 'grup: beğeni'); r = await A.post('/api/rgroups/' + gid + '/posts/' + gpid + '/like'); ok(r.j.liked === false && r.j.likes === 0, 'grup: beğeni geri alınır');
  r = await D.post('/api/rgroups/' + gid + '/posts/' + gpid + '/like'); ok(r.s === 404, 'grup: yabancı beğenemez');
  r = await A.post('/api/rgroups/' + gid + '/posts/' + gpid + '/comments', { text: 'süper' }); const gcid = r.j.comment && r.j.comment.id; ok(r.s === 200 && r.j.commentCount === 1, 'grup: yorum');
  r = await A.post('/api/rgroups/' + gid + '/posts/' + gpid + '/comments', { text: ' ' }); ok(r.s === 400, 'grup: boş yorum reddedilir');
  r = await D.post('/api/rgroups/' + gid + '/posts/' + gpid + '/comments', { text: 'x' }); ok(r.s === 404, 'grup: yabancı yorum yapamaz');
  r = await B.get('/api/rgroups/' + gid + '/posts'); ok(r.j.posts[0].commentCount === 1 && r.j.posts[0].comments[0].text === 'süper' && r.j.posts[0].comments[0].author.username === 'ayse', 'grup: yorum akışta');
  r = await B.req('DELETE', '/api/rgroups/' + gid + '/posts/' + gpid + '/comments/' + gcid); ok(r.s === 403, 'grup: başkasının yorumu silinemez');
  r = await A.req('DELETE', '/api/rgroups/' + gid + '/posts/' + gpid + '/comments/' + gcid); ok(r.s === 200, 'grup: yorum sahibi siler');
  r = await A.post('/api/rgroups/' + gid + '/posts', { text: 'lider' }); const gp2 = r.j.post.id; r = await B.req('DELETE', '/api/rgroups/' + gid + '/posts/' + gp2); ok(r.s === 403, 'grup: üye başkasının gönderisini silemez');
  r = await A.req('DELETE', '/api/rgroups/' + gid + '/posts/' + gp2); ok(r.s === 200, 'grup: gönderi sahibi siler');
  r = await B.post('/api/rgroups/' + gid + '/posts', { text: 'üye yazdı' }); const gp3 = r.j.post.id; r = await A.req('DELETE', '/api/rgroups/' + gid + '/posts/' + gp3); ok(r.s === 200, 'grup: lider üyenin gönderisini siler');
  r = await A.get('/api/rgroups'); ok(r.j.groups[0].desc === 'Pazar sürüşleri' && r.j.groups[0].posts === 1, 'grup listesi: açıklama + gönderi sayısı');
  const MG = new C('misafir'); r = await reg(MG, { username: 'misafir', email: 'mis@gmail.com', phone: '0533 111 22 99' }); r = await MG.post('/api/rgroups/join', { code });
  r = await MG.post('/api/rgroups/' + gid + '/posts', { text: 'gidiyorum' }); r = await MG.post('/api/rgroups/' + gid + '/leave'); ok(r.s === 200, 'grup: üye ayrılır');
  r = await A.get('/api/rgroups/' + gid + '/posts'); ok(r.j.posts.length === 1 && r.j.posts[0].id === gpid, 'grup: ayrılan üyenin gönderileri silinir');
  r = await A.req('PUT', '/api/rgroups/' + gid + '/route', Buffer.from(JSON.stringify({ name: 'Şile', pts: [[41.0, 29.0], [41.0, 29.0], [41.05, 29.0], [41.10, 29.05]] })), { headers: { 'content-type': 'application/octet-stream' } });
  ok(r.s === 200 && r.j.route.v === 1 && r.j.route.n === 3 && r.j.route.len > 10000 && r.j.route.len < 14000, 'güzergâh kaydedilir (tekrar eden nokta atılır, uzunluk sunucuda hesaplanır)');
  r = await B.get('/api/rgroups/' + gid + '/route'); ok(r.s === 200 && r.j.pts.length === 3 && r.j.name === 'Şile', 'güzergâh üyeye açık');
  r = await A.req('PUT', '/api/rgroups/' + gid + '/route', Buffer.from('{"pts":[[999,1],[1,1]]}'), { headers: { 'content-type': 'application/octet-stream' } }); ok(r.s === 400, 'güzergâh: geçersiz nokta');
  a = await A.emit('grp:share', { gid, on: true, consent: true }); ok(a.error && /sürüşü yok/i.test(a.error), 'paylaşım: aktif sürüş yoksa reddedilir');
  r = await B.post('/api/rgroups/' + gid + '/start'); ok(r.s === 403, 'sürüşü yalnız lider başlatır'); r = await A.post('/api/rgroups/' + gid + '/start'); ok(r.s === 200 && r.j.group.ride && r.j.group.ride.id, 'sürüş başlar');
  r = await A.post('/api/rgroups/' + gid + '/start'); ok(r.s === 409, 'sürüş tekrar başlatılamaz');
  await B.rt(); ok(B.evs('grp:changed').some(e => e.data.kind === 'ride-start'), 'grp:changed ride-start üyelere gider');
  A.clear(); B.clear();
  a = await A.emit('grp:watch', { gid }); ok(a.ok && a.ride === true, 'grp:watch'); a = await B.emit('grp:watch', { gid }); ok(a.ok, 'grp:watch (üye)');
  a = await D.emit('grp:watch', { gid }); ok(a.error, 'grp:watch: üye olmayan reddedilir');
  a = await A.emit('grp:share', { gid, on: true }); ok(a.error && /onay/i.test(a.error), 'grp:share: onay şart');
  a = await A.emit('grp:share', { gid, on: true, consent: true }); ok(a.ok && a.sharing, 'lider paylaşımı açar'); a = await B.emit('grp:share', { gid, on: true, consent: true }); ok(a.ok, 'üye paylaşımı açar');
  await A.rt([{ ev: 'grp:update', data: { gid, lat: 41.0, lon: 29.0, acc: 8, spd: 20 } }]); await B.rt([{ ev: 'grp:update', data: { gid, lat: 41.05, lon: 29.0, acc: 8, spd: 3 } }]);
  await A.rt(); await B.rt();
  const st = (B.evs('grp:state').pop() || {}).data; ok(st && st.ride === true && st.rv === 1 && st.gap === 500 && st.members.length === 2 && st.members[0].lead === true && st.members[0].u === 'ayse', 'grp:state: lider önde, iki üye');
  const bm = st && st.members.find(m => m.u === 'burak'); ok(bm && bm.spd === 11 && bm.est === false && bm.dl > 5000, 'grp:state: hız km/s ve lidere uzaklık');
  await sleep(2700); await B.rt(); await sleep(2700); A.clear(); B.clear(); await B.rt(); await A.rt();
  const al = B.evs('grp:alert').concat(A.evs('grp:alert')); ok(al.length >= 1 && al[0].data.u === 'burak', 'grp:alert: uzaklaşan üye için uyarı üretilir (2 ardışık taramada)');
  const st2 = (B.evs('grp:state').pop() || {}).data; ok(!st2 || (st2.members.find(m => m.u === 'burak') || {}).f !== undefined, 'grp:state: üyede bayrak (behind/away/off) görünür');
  const B2 = new C('burak2'); B2.ck = B.ck; await B2.rt(); a = await B2.emit('grp:share', { gid, on: true, consent: true }); await B.rt(); ok(B.evs('grp:taken').length === 1, 'grp:taken: paylaşım diğer sekmeye geçer');
  await B2.emit('grp:share', { gid, on: false });
  r = await A.get('/api/rgroups'); ok(r.j.groups.length === 1 && r.j.groups[0].active === true && r.j.groups[0].hasRoute === true, 'grup listesi');
  // ---------- Grup sesi ----------
  r = await A.get('/api/gvoice/ice'); ok(r.j.iceServers[0].urls.startsWith('stun:') && r.j.turn === false && r.j.max === 6, 'gvoice/ice: STUN, TURN yoksa false');
  A.clear(); B.clear(); a = await D.emit('gv:join', { gid }); ok(a.code === 'forbidden', 'gv:join: üye olmayan reddedilir');
  a = await A.emit('gv:join', { gid }); ok(a.ok && a.peers.length === 0 && a.mode === 'ptt' && a.leader === true && a.id === A.sid, 'gv:join: lider girer'); a = await B.emit('gv:join', { gid }); ok(a.ok && a.peers.length === 1 && a.peers[0].id === A.sid && a.leader === false, 'gv:join: üye girer, eş listesi gelir');
  await A.rt(); ok(A.evs('gv:peer-joined').length === 1 && A.evs('gv:peer-joined')[0].data.id === B.sid, 'gv:peer-joined yayınlanır');
  A.clear(); a = await B.emit('gv:signal', { to: A.sid, data: { type: 'offer', sdp: 'v=0' } }); ok(a.ok, 'gv:signal'); await A.rt(); ok(A.evs('gv:signal').length === 1 && A.evs('gv:signal')[0].data.from === B.sid && A.evs('gv:signal')[0].data.data.sdp === 'v=0', 'gv:signal hedefe ulaşır');
  a = await B.emit('gv:signal', { to: 'ffffffffffffffff', data: { x: 1 } }); ok(a.code === 'nopeer', 'gv:signal: odada olmayan hedef'); a = await B.emit('gv:status', { mic: true }); ok(a.code === 'nofloor', 'gv:status: söz hakkı yokken mikrofon açılamaz');
  a = await B.emit('gv:floor', { act: 'acquire' }); ok(a.granted === true, 'söz hakkı alınır'); a = await A.emit('gv:floor', { act: 'acquire' }); ok(a.granted === false && a.holder.id === B.sid, 'söz hakkı doluyken verilmez');
  A.clear(); a = await B.emit('gv:status', { mic: true }); ok(a.ok, 'söz hakkı olan mikrofonu açar'); await A.rt(); ok(A.evs('gv:status').length === 1 && A.evs('gv:status')[0].data.mic === true, 'gv:status yayınlanır');
  a = await B.emit('gv:mode', { mode: 'open' }); ok(a.code === 'leader', 'gv:mode: yalnız lider'); A.clear(); a = await A.emit('gv:revoke', {}); ok(a.ok, 'lider söz hakkını geri alır'); await B.rt(); ok(B.evs('gv:revoked').length === 1, 'gv:revoked hak sahibine gider');
  a = await A.emit('gv:mode', { mode: 'open' }); ok(a.ok && a.mode === 'open', 'lider modu değiştirir'); a = await B.emit('gv:floor', { act: 'acquire' }); ok(a.error && a.code === 'mode', 'açık mikrofon modunda söz hakkı yok');
  const gp = JSON.parse(sq("SELECT COUNT(*) c FROM ml_gvp"))[0].c; ok(+gp === 2, 'gv: iki eş kayıtlı');
  B.clear(); a = await A.emit('gv:leave', {}); await B.rt(); ok(B.evs('gv:peer-left').length === 1, 'gv:peer-left yayınlanır');

  // ---------- Sürüş kaydı (grup) ----------
  r = await B.post('/api/rgroups/' + gid + '/end'); ok(r.s === 403, 'sürüşü yalnız lider bitirir');
  r = await A.post('/api/rgroups/' + gid + '/end'); ok(r.s === 200 && r.j.group.ride === null, 'sürüş biter');
  r = await A.get('/api/rgroups/' + gid + '/rides'); ok(r.j.rides.length === 1 && r.j.rides[0].endedAt > 0 && r.j.rides[0].members.some(m => m.username === 'ayse' && m.fixes === 1), 'sürüş geçmişi: üye başına nokta sayısı'); const rideId = r.j.rides[0].id;
  r = await B.get('/api/rgroups/' + gid + '/rides/' + rideId); const lines = r.text.toString().trim().split('\n').map(JSON.parse);
  ok(r.s === 200 && /ndjson/.test(r.headers.get('content-type')) && lines[0].k === 'h' && lines[0].route.length === 3 && lines.some(l => l[0] === 'f' && l[2] === 'ayse') && lines.some(l => l[0] === 'e' && l[2] === 'end'), 'NDJSON kaydı: başlık + konumlar + olaylar');
  ok(lines.some(l => l[0] === 'e' && l[2] === 'share-on') && lines.some(l => l[0] === 'e' && l[2] === 'share-off'), 'NDJSON: paylaşım olayları');
  r = await D.get('/api/rgroups/' + gid + '/rides/' + rideId); ok(r.s === 404, 'kayıt üye olmayana kapalı');
  A.clear(); r = await A.post('/api/rgroups/' + gid + '/leader', { username: 'burak' }); ok(r.s === 200 && r.j.group.role === 'member' && r.j.group.leader === 'burak', 'liderlik devredilir');
  r = await A.post('/api/rgroups/' + gid + '/kick', { username: 'burak' }); ok(r.s === 403, 'yeni lider olmayan çıkaramaz'); r = await B.post('/api/rgroups/' + gid + '/code'); ok(r.s === 200 && r.j.code !== code, 'davet kodu yenilenir'); r = await D.post('/api/rgroups/join', { code }); ok(r.s === 404, 'eski kod geçersiz olur');
  r = await B.post('/api/rgroups/' + gid + '/kick', { username: 'ayse' }); ok(r.s === 200, 'üye çıkarılır'); await A.rt(); ok(A.evs('grp:changed').some(e => e.data.kind === 'removed'), 'çıkarılana removed gider');
  r = await A.get('/api/rgroups/' + gid); ok(r.s === 404, 'çıkarılan artık grubu göremez');
  r = await B.req('DELETE', '/api/rgroups/' + gid); ok(r.s === 200, 'grup silinir'); r = await B.get('/api/rgroups'); ok(r.j.groups.length === 0, 'silinen grup listede yok');
  ok(+JSON.parse(sq('SELECT COUNT(*) c FROM ml_rgrec'))[0].c === 0, 'silinen grubun kayıt satırları da silinir');

  // ---------- Sürüş kayıtları (ride-core / telemetry-core eşdeğerliği) ----------
  const rec = new RC.Recorder('r_testride0001'); rec.start(T0); let t = T0, lat = 41.0, lon = 29.0;
  for (let i = 0; i < 120; i++) { t += 1000; lat += 0.00012; lon += 0.00005; rec.addFix({ t, lat, lon, acc: 6 + (i % 5), speed: i % 40 === 39 ? null : 13 + Math.sin(i / 7) * 3 }); }
  t += 500; rec.pause(t); t += 20000; rec.resume(t);
  for (let i = 0; i < 80; i++) { t += 1000; lat += 0.0001; lon -= 0.00004; rec.addFix({ t, lat, lon, acc: i % 17 === 0 ? 90 : 7, speed: i % 3 ? 12 : null }); }
  t += 1000; lat += 0.5; rec.addFix({ t, lat, lon, acc: 5, speed: 10 });          // GPS sıçraması
  t += 1000; rec.end(t); const ride = JSON.parse(JSON.stringify(rec.toJSON()));
  const want = RC.summarize(ride);
  r = await A.req('POST', '/api/rides', Buffer.from(JSON.stringify(ride)), { headers: { 'content-type': 'application/octet-stream' } });
  ok(r.s === 200 && r.j.ok && !r.j.duplicate, 'sürüş yüklenir');
  const same = Object.keys(want).every(k => JSON.stringify(r.j.summary[k]) === JSON.stringify(want[k]));
  ok(same, 'PHP özeti JavaScript ride-core özetiyle birebir aynı' + (same ? '' : ' → ' + JSON.stringify(r.j.summary) + ' ≠ ' + JSON.stringify(want)));
  ok(want.distM > 1000 && want.rejectedAcc > 0 && want.rejectedJump > 0 && want.pauseCount === 1, 'test sürüşü reddedilen konum/sıçrama/duraklatma içeriyor');
  r = await A.req('POST', '/api/rides', Buffer.from(JSON.stringify(ride)), { headers: { 'content-type': 'application/octet-stream' } }); ok(r.s === 200 && r.j.duplicate === true && r.j.summary.distM === want.distM, 'aynı sürüş tekrar gönderilince yinelenir olarak döner');
  r = await A.req('POST', '/api/rides', Buffer.from(JSON.stringify({ ...ride, id: 'bad' })), { headers: { 'content-type': 'application/octet-stream' } }); ok(r.s === 400, 'geçersiz kimlik reddedilir');
  r = await A.req('POST', '/api/rides', Buffer.from(JSON.stringify({ ...ride, id: 'r_zzzzzzzz01', events: ride.events.slice(0, 2) })), { headers: { 'content-type': 'application/octet-stream' } }); ok(r.s === 400, 'tamamlanmamış/bozuk olay dizisi reddedilir');
  r = await A.req('POST', '/api/rides', Buffer.from('{bozuk'), { headers: { 'content-type': 'application/octet-stream' } }); ok(r.s === 400 && /okunamadı/.test(r.j.error), 'bozuk JSON reddedilir');
  r = await new C().req('POST', '/api/rides', Buffer.from('{}')); ok(r.s === 401, 'sürüş yükleme oturum ister');
  r = await A.get('/api/rides'); ok(r.j.rides.length === 1 && r.j.rides[0].id === ride.id && r.j.rides[0].summary.distM === want.distM, 'sürüş listesi'); r = await B.get('/api/rides'); ok(r.j.rides.length === 0, 'başkasının sürüşleri listelenmez');
  r = await A.get('/api/rides/' + ride.id); ok(r.s === 200 && r.j.fixes.length === ride.fixes.length && r.j.events.length === ride.events.length && r.j.summary.distM === want.distM, 'sürüş ayrıntısı (ham noktalar + özet)');
  r = await B.get('/api/rides/' + ride.id); ok(r.s === 404, 'başkası sürüşü okuyamaz'); r = await A.get('/api/rides/..%2Fx'); ok(r.s === 400 || r.s === 404, 'kimlik biçimi denetlenir');
  // telemetri
  const bins = []; for (let i = 0; i < 60; i++) bins.push([T0 + 5000 + i * 1000, i % 3 ? 0.5 : -4, -4.2, 0.3, 1.2, i % 10 ? 12 : null, i % 10 ? -18 : null, 3, 9, 5]);
  const evs = [[T0 + 9000, 'b', 2, 6.1, 900, 14, 7, -7, 'i', 1, 41.001, 29.001], [T0 + 30000, 'a', 1, 3.2, 700, 5, 9, 4, 'g', 0, null, null]];
  const meta = { caps: { gyro: true, lin: true, rateHz: 50, n: 1000 }, cal: { u: [0, 0, 1], f: [1, 0, 0], fSrc: 'ride', gyroOk: true }, sync: { lagMs: 100, corr: 0.7 }, status: { aLon: { s: 'measured' }, aLat: { s: 'measured' }, lean: { s: 'estimated' }, yaw: { s: 'measured' } }, cover: { lean: { valid: 40, total: 60, reasons: { 'low-speed': 12 } } } };
  const tele = { v: 1, rideId: ride.id, meta, bins, evs };
  const wantT = TC.summarizeTele(TC.cleanTele(JSON.parse(JSON.stringify(tele)), { id: ride.id, startedAt: ride.startedAt, endedAt: ride.endedAt }).tele);
  r = await B.req('POST', '/api/rides/' + ride.id + '/tele', Buffer.from(JSON.stringify(tele)), { headers: { 'content-type': 'application/octet-stream' } }); ok(r.s === 404, 'telemetri: sürüş sunucuda yoksa 404');
  r = await A.req('POST', '/api/rides/' + ride.id + '/tele', Buffer.from(JSON.stringify({ ...tele, rideId: 'r_baska0001' })), { headers: { 'content-type': 'application/octet-stream' } }); ok(r.s === 400 && /eşleşmiyor/.test(r.j.error), 'telemetri: kimlik uyuşmazlığı');
  r = await A.req('POST', '/api/rides/' + ride.id + '/tele', Buffer.from(JSON.stringify({ ...tele, bins: [[1, 0, 0, 0, 0, 0, 0, 0, 0, 0]] })), { headers: { 'content-type': 'application/octet-stream' } }); ok(r.s === 400, 'telemetri: zaman aralığı dışı satır reddedilir');
  r = await A.req('POST', '/api/rides/' + ride.id + '/tele', Buffer.from(JSON.stringify(tele)), { headers: { 'content-type': 'application/octet-stream' } });
  const sameT = r.s === 200 && JSON.stringify(r.j.summary) === JSON.stringify(wantT); ok(sameT, 'telemetri özeti JavaScript telemetry-core özetiyle birebir aynı' + (sameT ? '' : ' → ' + JSON.stringify(r.j) + ' ≠ ' + JSON.stringify(wantT)));
  r = await A.req('POST', '/api/rides/' + ride.id + '/tele', Buffer.from(JSON.stringify(tele)), { headers: { 'content-type': 'application/octet-stream' } }); ok(r.j.duplicate === true, 'telemetri yinelenir');
  r = await A.get('/api/rides/' + ride.id + '/tele'); ok(r.s === 200 && r.j.bins.length === 60 && r.j.evs.length === 2 && r.j.summary.events.brake.n === 1 && r.j.meta.cover.lean.reasons['low-speed'] === 12 && typeof r.j.meta.cover.aLon.reasons === 'object' && !Array.isArray(r.j.meta.cover.aLon.reasons), 'telemetri okunur (boş reasons nesne olarak kalır)');
  r = await A.get('/api/rides'); ok(r.j.rides[0].tele && r.j.rides[0].tele.bins === 60, 'liste telemetri özetini içerir');

  // ---------- Hava durumu / harita (ağ yok: yalnızca doğrulamalar) ----------
  r = await new C().get('/api/weather?lat=41&lon=29'); ok(r.s === 401, 'hava durumu oturum ister'); r = await A.get('/api/weather?lat=abc&lon=29'); ok(r.s === 400, 'hava durumu: geçersiz konum');
  r = await A.get('/api/weather?lat=95&lon=29'); ok(r.s === 400, 'hava durumu: aralık dışı');
  r = await A.get('/api/maps/config'); ok(r.s === 200 && /openstreetmap/.test(r.j.tileUrl) && r.j.routing === true && r.j.route.provider === 'valhalla' && r.j.route.avoid.includes('highways') && !JSON.stringify(r.j).includes('apiKey'), 'maps/config: varsayılan karo + anahtarsız Valhalla, anahtar sızmaz');
  r = await A.get('/api/geocode?q=ab'); ok(r.s === 400, 'geocode: kısa sorgu'); r = await new C().get('/api/geocode?q=istanbul'); ok(r.s === 401, 'geocode oturum ister');
  r = await A.get('/api/route?from=41,29&to=abc'); ok(r.s === 400, 'route: geçersiz koordinat'); r = await A.get('/api/route?from=41,29&to=95,29'); ok(r.s === 400, 'route: aralık dışı');

  // ---------- Bağlantı kopması / hesap silme ----------
  B.clear(); await B.rt(); D.clear(); await D.rt();
  r = await B.get('/api/social/friends');
  A.clear(); B.clear(); await A.rt(); await A.post('/api/rt', { sid: A2.sid, bye: 1 }); r = await A.post('/api/rt', { sid: A.sid, bye: 1 }); await sleep(50); const rb = await B.rt(); ok(B.evs('social:presence').some(e => e.data.username === 'ayse' && e.data.online === false), 'bye: arkadaşa çevrimdışı bilgisi gider');
  r = await B.get('/api/social/friends'); ok(r.j.friends.find(f => f.username === 'ayse').online === false, 'friends: çevrimdışı görünür');
  const A3 = new C('ayse3'); A3.ck = A.ck; A3.clear(); B.clear(); await A3.rt(); await B.rt(); ok(B.evs('social:presence').some(e => e.data.username === 'ayse' && e.data.online === true), 'yeniden bağlanınca çevrimiçi bilgisi gider');
  r = await A3.rt(); r = await new C().req('POST', '/api/rt', { sid: A3.sid }); ok(r.s === 401, 'rt: oturumsuz 401 (istemci connect_error unauthorized üretir)');
  const stale = new C('stale'); stale.ck = B.ck; stale.sid = 'f'.repeat(16); r = await stale.rt(); ok(r.s === 200 && r.j.fresh === true && r.j.sid !== 'f'.repeat(16), 'rt: bilinmeyen oturum yeniden kurulur (fresh)');
  // 30 sn yoklamayan oturum kopar (veritabanında eskitilir)
  execFileSync('php', ['-r', `$d=new PDO('sqlite:${path.join(tmp, 't.sqlite')}');$d->exec("UPDATE ml_rts SET last=last-120000 WHERE sid='${stale.sid}'");`]);
  await B.rt(); await sleep(50); r = await stale.rt(); ok(r.j.fresh === true, 'rt: yoklamayan oturum süpürülür, istemci yeniden bağlanır');
  r = await B.post('/api/account/delete', { confirm: 'burak', password: 'yanlis' }); ok(r.s === 401, 'hesap silme: yanlış şifre');
  r = await B.post('/api/account/delete', { confirm: 'burak', password: 'sifre123' }); ok(r.s === 200, 'hesap silinir'); r = await A.get('/api/social/users/burak'); ok(r.s === 404, 'silinen kullanıcı bulunamaz');
  ok(+JSON.parse(sq("SELECT COUNT(*) c FROM ml_friends"))[0].c === 0 && +JSON.parse(sq("SELECT COUNT(*) c FROM ml_msgs"))[0].c === 0 && +JSON.parse(sq("SELECT COUNT(*) c FROM ml_rts WHERE uid NOT IN (SELECT id FROM ml_users)"))[0].c === 0, 'silinen hesabın arkadaşlık/mesaj/oturum verisi temizlenir');
  r = await new C().get('/api/yok'); ok(r.s === 404, 'bilinmeyen uç nokta 404');
  r = await new C().req('GET', '/'); ok(r.s === 200 && /rt\.js/.test(r.text.toString()) && !/socket\.io\.js/.test(r.text.toString()), 'index.html: socket.io yerine rt.js yüklenir');
  r = await new C().req('GET', '/rt.js'); ok(r.s === 200 && /window\.io/.test(r.text.toString()), 'rt.js sunulur'); r = await new C().req('GET', '/icons/icon-192.png'); ok(r.s === 200, '/icons/ eşlemesi çalışır (dev-router)');
  for (let i = 0; i < 5; i++) r = await L('ali_k', 'yanlis'); r = await L('ali_k', 'yenisifre1'); ok(r.s === 429, 'giriş: 5 yanlıştan sonra kilitlenir');
  console.log(`\n${p} geçti, ${f} kaldı`);
})().catch(e => { console.error('TEST HATASI', e); f++; }).finally(() => { srv.kill(); fs.rmSync(tmp, { recursive: true, force: true }); process.exit(f ? 1 : 0); });
