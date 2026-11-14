'use strict';
// Kayıt/giriş/şifre kuralı sunucu testleri: projeyi geçici klasöre kopyalar, GERÇEK server.js'i başlatır.
// node test/auth.js
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto'), { spawn } = require('child_process');
let p = 0, f = 0; const ok = (c, m) => { c ? p++ : f++; console.log((c ? 'ok: ' : 'FAIL: ') + m); };
const root = path.join(__dirname, '..'), tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-'));
for (const n of fs.readdirSync(root)) if (!['data', 'node_modules', 'test', '.git'].includes(n)) fs.cpSync(path.join(root, n), path.join(tmp, n), { recursive: true });
fs.cpSync(path.join(__dirname, 'fake-modules'), path.join(tmp, 'node_modules'), { recursive: true });   // express/socket.io bu ortamda kurulu değil: sahte sürümler
const PORT = 3900 + Math.floor(Math.random() * 90), base = 'http://127.0.0.1:' + PORT;
const srv = spawn('node', ['server.js'], { cwd: tmp, env: { ...process.env, REG_LIMIT: '1000', PORT, APP_URL: 'http://test.local', SESSION_SECRET: 'x'.repeat(32) }, stdio: ['ignore', 'pipe', 'inherit'] });
let logs = ''; srv.stdout.on('data', d => { logs += d; });
const capSolve = q => { const m = String(q).match(/(\d+)\s*([+−×])\s*(\d+)/); const a = +m[1], b = +m[3]; return m[2] === '+' ? a + b : m[2] === '−' ? a - b : a * b; };
const CAPPATH = /^\/api\/(login|register|forgot)$/;
const post = async (u, b, ck) => { if (CAPPATH.test(u) && b && !b.noCap) { const c = await (await fetch(base + '/api/captcha')).json(); b = { ...b, cToken: c.token, cAns: String(capSolve(c.q)) }; } else if (b && b.noCap) { b = { ...b }; delete b.noCap; } const r = await fetch(base + u, { method: 'POST', headers: { 'content-type': 'application/json', ...(ck ? { cookie: ck } : {}) }, body: JSON.stringify(b) }); let j = {}; try { j = await r.json(); } catch {} return { s: r.status, j, ck: (r.headers.get('set-cookie') || '').split(';')[0] }; };
const base0 = { username: 'ali_k', firstName: 'Ali', lastName: 'Kaya', gender: 'erkek', bikeBrand: 'Yamaha', bikeModel: 'MT-07', email: 'ali@gmail.com', password: 'Kx9.Mq2!Zw4', phone: '0532 123 45 67' };
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
  r = await post('/api/login', { login: 'ali_k', password: 'Kx9.Mq2!Zw4' }); ok(r.s === 200, 'giriş: güvenlik sorusu olmadan girer');
  r = await post('/api/login', { login: '0532 123 45 67', password: 'Kx9.Mq2!Zw4' }); ok(r.s === 200, 'telefonla giriş yapılabilir');
  // sosyal giriş kaldırıldı
  r = await fetch(base + '/api/auth/config'); ok(r.status === 404, 'Google/Apple: /api/auth/config yok');
  r = await post('/api/auth/google', { credential: 'x' }); ok(r.s === 404, 'Google/Apple: /api/auth/google yok');
  // şifre gücü
  for (const [pw, m] of [['Kisa1.a', 'kısa'], ['kx9.mq2!zw4', 'büyük harf yok'], ['KX9.MQ2!ZW4', 'küçük harf yok'], ['Kxx.Mqq!Zww', 'rakam yok'], ['Kx9Mq2Zw4Ab', 'özel karakter yok'], ['Password.123', 'yaygın şifre'], ['Abcd.12345x', 'ardışık dizi'], ['Kxxx.9Mq2!Z', 'üçlü tekrar'], ['Burakk.7x!Qm', 'kullanıcı adı içerir']]) {
    r = await reg({ username: pw === 'Burakk.7x!Qm' ? 'burakk' : 'zayif' + Math.floor(Math.random() * 1e6), email: 'z' + Math.floor(Math.random() * 1e6) + '@x.com', phone: '05' + String(300000000 + Math.floor(Math.random() * 1e8)), password: pw }); ok(r.s === 400 && r.j.code === 'weakpw', 'kayıt: zayıf şifre reddedilir (' + m + ')');
  }
  r = await reg({ username: 'guclu', email: 'guclu@x.com', phone: '0537 000 11 22', password: 'Tz8,Qm3#Vk6' }); ok(r.s === 200, 'kayıt: güçlü şifre kabul edilir');
  const ck2 = r.ck, me2 = (await (await fetch(base + '/api/me', { headers: { cookie: ck2 } })).json()).user;
  r = await post('/api/account', { ...me2, newPassword: 'zayif123', currentPassword: 'Tz8,Qm3#Vk6' }, ck2); ok(r.s === 400 && r.j.code === 'weakpw', 'hesap: zayıf yeni şifre reddedilir');
  r = await post('/api/account', { ...me2, newPassword: 'Nv7,Tr4#Lp8', currentPassword: 'Tz8,Qm3#Vk6' }, ck2); ok(r.s === 200, 'hesap: güçlü yeni şifre kabul edilir (' + r.s + JSON.stringify(r.j) + ')');
  r = await post('/api/login', { login: 'guclu', password: 'Nv7,Tr4#Lp8' }); ok(r.s === 200, 'hesap: yeni şifreyle giriş yapılır');
  r = await post('/api/reset', { token: 'yok', password: 'zayif' }); ok(r.s === 400, 'sıfırlama: geçersiz jeton / zayıf şifre reddedilir');
  r = await post('/api/forgot', { email: 'guclu@x.com' }); ok(r.s === 200, 'şifremi unuttum: kayıtlı e-posta için nötr yanıt (' + r.s + ')');
  await new Promise(z => setTimeout(z, 300));
  const mm = logs.match(/Kime: guclu@x\.com[\s\S]*?\/\?reset=([\w-]+)/); ok(!!mm, 'şifremi unuttum: sıfırlama bağlantısı kayıtlı e-postaya gider');
  if (mm) {
    r = await post('/api/reset', { token: mm[1], password: 'zayif123' }); ok(r.s === 400 && r.j.code === 'weakpw', 'sıfırlama: zayıf şifre reddedilir, jeton yanmaz');
    r = await post('/api/reset', { token: mm[1], password: 'Wd5.Hs9!Bn2' }); ok(r.s === 200, 'sıfırlama: güçlü şifre kabul edilir');
    r = await post('/api/login', { login: 'guclu', password: 'Wd5.Hs9!Bn2' }); ok(r.s === 200, 'sıfırlama: yeni şifreyle giriş');
    r = await post('/api/login', { login: 'guclu', password: 'Nv7,Tr4#Lp8' }); ok(r.s === 401, 'sıfırlama: eski şifre geçmez');
    r = await post('/api/reset', { token: mm[1], password: 'Wd5.Hs9!Bn3' }); ok(r.s === 400, 'sıfırlama: bağlantı tek kullanımlık');
  }
  const raw = fs.readFileSync(path.join(tmp, 'data', 'users.json'), 'utf8'); ok(!/ticket/.test(raw), 'users.json içinde bilet saklanmaz');
  srv.kill(); fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\n${p} geçti, ${f} kaldı`); process.exit(f ? 1 : 0);
})().catch(e => { console.error(e); srv.kill(); process.exit(1); });
