'use strict';
// Kayıt/giriş/sosyal giriş sunucu testleri: projeyi geçici klasöre kopyalar, GERÇEK server.js'i başlatır.
// Google/Apple JWKS ağ çağrısı, --require ile sahte fetch'e yönlendirilir; ID token'lar test RSA anahtarıyla imzalanır. node test/auth.js
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto'), { spawn } = require('child_process');
let p = 0, f = 0; const ok = (c, m) => { c ? p++ : f++; console.log((c ? 'ok: ' : 'FAIL: ') + m); };
const root = path.join(__dirname, '..'), tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-'));
for (const n of fs.readdirSync(root)) if (!['data', 'node_modules', 'test', '.git'].includes(n)) fs.cpSync(path.join(root, n), path.join(tmp, n), { recursive: true });
fs.cpSync(path.join(__dirname, 'fake-modules'), path.join(tmp, 'node_modules'), { recursive: true });   // express/socket.io bu ortamda kurulu değil: sahte sürümler
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };
fs.writeFileSync(path.join(tmp, 'mockfetch.js'), `const jwk=${JSON.stringify(jwk)};const rf=global.fetch;global.fetch=async(u,...a)=>/googleapis|appleid/.test(String(u))?{ok:true,json:async()=>({keys:[jwk]})}:rf(u,...a);`);
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const tok = (claims, key = privateKey) => { const h = b64({ alg: 'RS256', kid: 'k1' }), b = b64(claims), s = crypto.sign('RSA-SHA256', Buffer.from(h + '.' + b), key).toString('base64url'); return h + '.' + b + '.' + s; };
const PORT = 3900 + Math.floor(Math.random() * 90), base = 'http://127.0.0.1:' + PORT;
const srv = spawn('node', ['-r', './mockfetch.js', 'server.js'], { cwd: tmp, env: { ...process.env, REG_LIMIT: '1000', PORT, GOOGLE_CLIENT_ID: 'gid.apps', APPLE_CLIENT_ID: 'com.apple.svc', SESSION_SECRET: 'x'.repeat(32) }, stdio: 'ignore' });
const capSolve = q => { const m = String(q).match(/(\d+)\s*([+−×])\s*(\d+)/); const a = +m[1], b = +m[3]; return m[2] === '+' ? a + b : m[2] === '−' ? a - b : a * b; };
const CAPPATH = /^\/api\/(login|register|forgot)$/;
const post = async (u, b, ck) => { if (CAPPATH.test(u) && b && !b.noCap) { const c = await (await fetch(base + '/api/captcha')).json(); b = { ...b, cToken: c.token, cAns: String(capSolve(c.q)) }; } else if (b && b.noCap) { b = { ...b }; delete b.noCap; } const r = await fetch(base + u, { method: 'POST', headers: { 'content-type': 'application/json', ...(ck ? { cookie: ck } : {}) }, body: JSON.stringify(b) }); let j = {}; try { j = await r.json(); } catch {} return { s: r.status, j, ck: (r.headers.get('set-cookie') || '').split(';')[0] }; };
const base0 = { username: 'ali_k', firstName: 'Ali', lastName: 'Kaya', gender: 'erkek', bikeBrand: 'Yamaha', bikeModel: 'MT-07', email: 'ali@gmail.com', password: 'sifre123', phone: '0532 123 45 67' };
const reg = async o => post('/api/register', { ...base0, ...o });
(async () => {
  for (let i = 0; i < 50; i++) { try { await fetch(base + '/api/me'); break; } catch { await new Promise(r => setTimeout(r, 200)); } }
  { // güvenlik sorusu
    let c = await (await fetch(base + '/api/captcha')).json();
    ok(/^\d+ [+−×] \d+|^\d+ − \d+/.test(c.q) && c.token.split('.').length === 3, 'güvenlik sorusu üretilir: ' + c.q);
    let x = await post('/api/login', { login: 'ali_k', password: 'x', noCap: 1 }); ok(x.s === 400 && x.j.code === 'captcha', 'soru yanıtlanmadan giriş reddedilir');
    x = await post('/api/register', { ...base0, noCap: 1 }); ok(x.s === 400 && x.j.code === 'captcha', 'soru yanıtlanmadan kayıt reddedilir');
    x = await post('/api/forgot', { email: 'a@b.com', noCap: 1 }); ok(x.s === 400 && x.j.code === 'captcha', 'soru yanıtlanmadan şifre sıfırlama reddedilir');
    x = await post('/api/login', { login: 'ali_k', password: 'x', noCap: 1, cToken: c.token, cAns: String(capSolve(c.q) + 1) }); ok(x.s === 400 && x.j.code === 'captcha', 'yanlış cevap reddedilir');
    c = await (await fetch(base + '/api/captcha')).json(); const good = { login: 'yok', password: 'x', noCap: 1, cToken: c.token, cAns: String(capSolve(c.q)) };
    x = await post('/api/login', good); ok(x.s === 401, 'doğru cevapla soru geçilir (şifre kontrolüne ilerler)');
    x = await post('/api/login', good); ok(x.s === 400 && x.j.code === 'captcha', 'aynı soru ikinci kez kullanılamaz (tek kullanımlık)');
    c = await (await fetch(base + '/api/captcha')).json(); x = await post('/api/login', { login: 'yok', password: 'x', noCap: 1, cToken: c.token, cAns: String(capSolve(c.q)), website: 'http://spam' }); ok(x.s === 400 && x.j.code === 'captcha', 'bal küpü alanı dolu: bot sayılır');
    c = await (await fetch(base + '/api/captcha')).json(); const [n, e, m] = c.token.split('.'); x = await post('/api/login', { login: 'yok', password: 'x', noCap: 1, cToken: n + '.' + (Number(e) + 99999999) + '.' + m, cAns: String(capSolve(c.q)) }); ok(x.s === 400 && x.j.code === 'captcha', 'jeton süresi oynanırsa imza tutmaz');
  }
  let r = await reg({});
  ok(r.s === 200 && r.j.user.phone === '+905321234567', 'kayıt: telefon +90 biçimine çevrilir'); const ck = r.ck;
  r = await reg({ phone: '' }); ok(r.s === 400 && /telefon/i.test(r.j.error), 'kayıt: telefon zorunlu');
  r = await reg({ phone: '123' }); ok(r.s === 400, 'kayıt: geçersiz telefon reddedilir');
  r = await reg({ username: 'ALI_K', email: 'b@icloud.com', phone: '0533 111 22 33' }); ok(r.s === 409 && /kullanıcı adı/i.test(r.j.error), 'aynı kullanıcı adı (büyük/küçük harf fark etmez) reddedilir');
  r = await reg({ username: 'veli', email: 'veli@icloud.com', phone: '+90 532 123 45 67' }); ok(r.s === 409 && /telefon/i.test(r.j.error), 'aynı telefon farklı yazımla da reddedilir');
  r = await reg({ username: 'veli', email: 'ali@gmail.com', phone: '0533 111 22 33' }); ok(r.s === 409 && /e-posta/i.test(r.j.error), 'aynı e-posta reddedilir');
  r = await reg({ username: 'veli', email: 'veli@icloud.com', phone: '0533 111 22 33', emergencyName: 'Can' }); ok(r.s === 400, 'acil kişi: yalnız ad girilirse hata');
  r = await reg({ username: 'veli', email: 'veli@icloud.com', phone: '0533 111 22 33', emergencyPhone: '0544 000 11 22' }); ok(r.s === 400, 'acil kişi: yalnız numara girilirse hata');
  r = await reg({ username: 'veli', email: 'veli@icloud.com', phone: '0533 111 22 33', emergencyName: 'Can', emergencyPhone: '0544 000 11 22', bikeYear: 2021, bikeType: 'naked', bikeCc: 689 });
  ok(r.s === 200 && r.j.user.emergencyName === 'Can' && r.j.user.emergencyPhone === '+905440001122' && r.j.user.bikeYear === 2021 && r.j.user.bikeType === 'naked' && r.j.user.bikeCc === 689, 'acil kişi ve motosiklet alanları kaydedilir (icloud e-posta ile)');
  r = await reg({ username: 'zeynep', email: 'z@gmail.com', phone: '0535 000 00 01' }); ok(r.s === 200 && r.j.user.emergencyName === '' , 'acil kişi isteğe bağlı');
  r = await reg({ username: 'kullanici1', email: 'k@gmail.com', phone: '0535 000 00 02', bikeType: 'uzay' }); ok(r.s === 400, 'geçersiz motosiklet tipi reddedilir');
  r = await reg({ username: 'kullanici2', email: 'k2@gmail.com', phone: '0535 000 00 03', bikeYear: 1800 }); ok(r.s === 400, 'geçersiz yıl reddedilir');
  r = await reg({ username: 'kullanici3', email: 'k3@gmail.com', phone: '0535 000 00 04', bikeCc: 5 }); ok(r.s === 400, 'geçersiz motor hacmi reddedilir');
  r = await reg({ username: 'kullanici4', email: 'k4@gmail.com', phone: '+4915112345678' }); ok(r.s === 200 && r.j.user.phone === '+4915112345678', 'yurtdışı numara +kodlu kabul edilir');
  // hesap güncelleme
  const me = (await (await fetch(base + '/api/me', { headers: { cookie: ck } })).json()).user;
  r = await post('/api/account', { ...me, phone: '0533 111 22 33' }, ck); ok(r.s === 409, 'hesap: başkasının telefonu alınamaz');
  r = await post('/api/account', { ...me, phone: '' }, ck); ok(r.s === 400, 'hesap: telefon boşaltılamaz');
  r = await post('/api/account', { ...me, bikeYear: 2019, bikeType: 'sport', bikeCc: 600, emergencyName: 'Ece', emergencyPhone: '0536 111 22 33' }, ck); ok(r.s === 200 && r.j.user.bikeType === 'sport' && r.j.user.emergencyName === 'Ece', 'hesap: motosiklet ve acil kişi güncellenir');
  { let bad = []; for (const t of ['supersport','sporttouring','naked','adventure','touring','cruiser','cafe','retro','motocross','scooter','sport','classic','enduro']) { const q = await post('/api/account', { ...me, bikeYear: 2019, bikeType: t, bikeCc: 600, emergencyName: 'Ece', emergencyPhone: '0536 111 22 33' }, ck); if (!(q.s === 200 && q.j.user.bikeType === t)) bad.push(t); } ok(bad.length === 0, 'hesap: 10 My Moto tipi + 3 eski tip kaydedilir' + (bad.length ? ' (reddedilen: ' + bad + ')' : '')); }
  r = await post('/api/login', { login: 'ali_k', password: 'sifre123' }); ok(r.s === 200, 'giriş: güvenlik sorusu olmadan girer');
  r = await post('/api/login', { login: '0532 123 45 67', password: 'sifre123' }); ok(r.s === 200, 'telefonla giriş yapılabilir');
  // sosyal giriş
  const cfg = await (await fetch(base + '/api/auth/config')).json(); ok(cfg.google === 'gid.apps' && cfg.apple === 'com.apple.svc', 'config: sağlayıcı kimlikleri');
  const now = Math.floor(Date.now() / 1000), gc = { iss: 'https://accounts.google.com', aud: 'gid.apps', exp: now + 600, sub: 'g-1', email: 'yeni@gmail.com', email_verified: true, given_name: 'Yeni', family_name: 'Sürücü' };
  r = await post('/api/auth/google', { credential: tok({ ...gc, aud: 'baska' }) }); ok(r.s === 401, 'google: yanlış aud reddedilir');
  r = await post('/api/auth/google', { credential: tok({ ...gc, exp: now - 10 }) }); ok(r.s === 401, 'google: süresi dolan token reddedilir');
  r = await post('/api/auth/google', { credential: tok({ ...gc, iss: 'https://evil.com' }) }); ok(r.s === 401, 'google: yanlış iss reddedilir');
  r = await post('/api/auth/google', { credential: tok({ ...gc, email_verified: false }) }); ok(r.s === 401, 'google: doğrulanmamış e-posta reddedilir');
  r = await post('/api/auth/google', { credential: tok(gc, crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey) }); ok(r.s === 401, 'google: sahte imza reddedilir');
  r = await post('/api/auth/google', { credential: tok(gc) }); ok(r.s === 200 && r.j.needProfile && r.j.ticket && r.j.email === 'yeni@gmail.com' && r.j.firstName === 'Yeni', 'google: yeni kullanıcıya profil tamamlama istenir'); const ticket = r.j.ticket;
  r = await post('/api/auth/complete', { ...base0, ticket: 'bozuk', username: 'yeni', phone: '0537 000 00 00' }); ok(r.s === 400, 'complete: bozuk bilet reddedilir');
  r = await post('/api/auth/complete', { ...base0, ticket, username: 'yeni', phone: '0532 123 45 67' }); ok(r.s === 409 && /telefon/i.test(r.j.error), 'complete: kullanılan telefon reddedilir');
  r = await post('/api/auth/complete', { ...base0, ticket, username: 'ali_k', phone: '0537 000 00 00' }); ok(r.s === 409, 'complete: kullanılan kullanıcı adı reddedilir');
  r = await post('/api/auth/complete', { ...base0, ticket, username: 'yeni', phone: '' }); ok(r.s === 400, 'complete: telefon zorunlu');
  r = await post('/api/auth/complete', { ...base0, ticket, username: 'yeni', phone: '0537 000 00 00', email: 'baskasi@x.com' });
  ok(r.s === 200 && r.j.user.email === 'yeni@gmail.com' && r.j.user.hasPassword === false && r.j.user.providers.includes('google') && /sid=/.test(r.ck), 'complete: hesap açılır, e-posta tokendan alınır (istekten değil), şifresiz');
  r = await post('/api/auth/google', { credential: tok(gc) }); ok(r.s === 200 && r.j.user && r.j.user.username === 'yeni', 'google: ikinci girişte doğrudan oturum açılır');
  r = await post('/api/auth/google', { credential: tok({ ...gc, sub: 'g-2', email: 'ali@gmail.com' }) }); ok(r.s === 200 && r.j.user && r.j.user.username === 'ali_k', 'google: aynı e-postalı mevcut hesaba bağlanır');
  const ac = { iss: 'https://appleid.apple.com', aud: 'com.apple.svc', exp: now + 600, sub: 'a-1', email: 'x@icloud.com', email_verified: 'true' };
  r = await post('/api/auth/apple', { credential: tok(ac), firstName: 'Mert', lastName: 'Demir' }); ok(r.s === 200 && r.j.needProfile && r.j.firstName === 'Mert', 'apple: yeni kullanıcı (icloud) profil tamamlamaya yönlenir');
  r = await post('/api/auth/complete', { ...base0, ticket: r.j.ticket, username: 'mert', phone: '0538 000 00 00', firstName: 'Mert', lastName: 'Demir', emergencyName: 'Anne', emergencyPhone: '0539 000 00 00' });
  ok(r.s === 200 && r.j.user.providers.includes('apple') && r.j.user.emergencyName === 'Anne', 'apple: hesap açılır, acil kişi kaydedilir');
  const raw = fs.readFileSync(path.join(tmp, 'data', 'users.json'), 'utf8'); ok(!/ticket/.test(raw), 'users.json içinde bilet saklanmaz');
  srv.kill(); fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\n${p} geçti, ${f} kaldı`); process.exit(f ? 1 : 0);
})().catch(e => { console.error(e); srv.kill(); process.exit(1); });
