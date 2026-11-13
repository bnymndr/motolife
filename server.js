// Moto Life sunucusu.
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.disable('x-powered-by');
app.use((req, res, next) => {                                  // temel güvenlik başlıkları (CSP bilerek yok: Tailwind/Leaflet CDN ve satır içi betik kullanılıyor)
  res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'SAMEORIGIN', 'Referrer-Policy': 'strict-origin-when-cross-origin' });
  if (req.secure) res.set('Strict-Transport-Security', 'max-age=15552000');
  next();
});
app.use(express.static(path.join(__dirname, 'public')));
app.use('/icons', express.static(path.join(__dirname, 'public')));   // manifest/index.html/sw.js '/icons/...' yolunu kullanıyor; dosyalar public/ kökünde (taşıma yapmadan eşleme)

const clean = (s, n) => String(s || '').trim().slice(0, n);
const hashPw = (pw, salt) => crypto.scryptSync(pw, salt, 32);
// ================= Hesaplar: uygulamaya özel üyelik =================
// Hesaplar data/users.json dosyasında tutulur (şifreler scrypt özeti). Oturum imzalı çerezle sürer.
const fs = require('fs');
let nodemailer = null;
try { nodemailer = require('nodemailer'); } catch {}
// Veri klasörü: Render'da kalıcı disk bağlanırsa DATA_DIR=/var/data gibi bir yol verilir (ücretsiz planın diski her dağıtımda/yeniden başlatmada SİLİNİR).
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const users = new Map();
try { for (const u of JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'))) users.set(u.id, u); } catch {}
const saveUsers = () => {
  fs.writeFileSync(USERS_FILE + '.tmp', JSON.stringify([...users.values()]));
  fs.renameSync(USERS_FILE + '.tmp', USERS_FILE);
};
const SECRET_FILE = path.join(DATA_DIR, 'secret.txt');
const SECRET = process.env.SESSION_SECRET || (() => {
  try { return fs.readFileSync(SECRET_FILE, 'utf8'); } catch {}
  const s = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(SECRET_FILE, s, { mode: 0o600 });
  return s;
})();
// Şifre sıfırlama e-postası için SMTP (isteğe bağlı; tanımlı değilse bağlantı sunucu konsoluna yazılır)
const SMTP_HOST = process.env.SMTP_HOST || '';
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const MAIL_FROM = process.env.MAIL_FROM || SMTP_USER;
const APP_URL = (process.env.APP_URL || '').replace(/\/+$/, '');

// Profil fotoğrafı: istemci 192x192 JPEG olarak küçültüp gönderir
app.post('/api/avatar', express.json({ limit: '200kb' }), (req, res) => {
  const u = userFromCookie(req.headers.cookie);
  if (!u) return res.status(401).json({ error: 'Giriş gerekli.' });
  const img = String((req.body || {}).image || '');
  if (img.length > 90000 || !/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(img)) {
    return res.status(400).json({ error: 'Fotoğraf geçersiz ya da çok büyük.' });
  }
  u.avatar = img;
  saveUsers();
  res.json({ user: pub(u) });
});

app.set('trust proxy', 1);
app.use(express.json({ limit: '10kb' }));
app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

const GENDERS = ['erkek', 'kadin', 'belirtmek-istemiyorum'];
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const USER_RE = /^[A-Za-z0-9_.]{3,20}$/;
const sign = v => crypto.createHmac('sha256', SECRET).update(v).digest('base64url');
const uname = u => u.username || u.name || 'Sürücü';   // eski hesaplar için
const BIKE_TYPES = ['supersport', 'sporttouring', 'naked', 'adventure', 'touring', 'cruiser', 'cafe', 'retro', 'motocross', 'scooter', 'sport', 'classic', 'enduro'];   // ilk 10 = My Moto tipleri; son 3 = eski kayıtlar
// Telefon: Türkiye numaraları (0532…, 532…, +90 532…) +90xxxxxxxxxx biçimine; diğer ülkeler +kodlu 8-15 hane. Geçersizse null.
function normPhone(raw) {
  let t = String(raw || '').trim().replace(/[\s().-]/g, '');
  if (t.startsWith('00')) t = '+' + t.slice(2);
  if (t.startsWith('+')) return /^\+905\d{9}$/.test(t) || (/^\+[1-9]\d{7,14}$/.test(t) && !t.startsWith('+90')) ? t : null;
  const m = /^(?:90|0)?(5\d{9})$/.exec(t);
  return m ? '+90' + m[1] : null;
}
const pub = u => ({
  username: uname(u), firstName: u.firstName || '', lastName: u.lastName || '',
  gender: u.gender || 'belirtmek-istemiyorum', bikeBrand: u.bikeBrand || '', bikeModel: u.bikeModel || '',
  bikeYear: u.bikeYear || '', bikeType: u.bikeType || '', bikeCc: u.bikeCc || '',
  phone: u.phone || '', emergencyName: u.emergencyName || '', emergencyPhone: u.emergencyPhone || '',
  email: u.email || '', hasPassword: !!u.hash, providers: [u.googleSub && 'google', u.appleSub && 'apple'].filter(Boolean),
  avatar: u.avatar || ''
});
const findByEmail = e => e && [...users.values()].find(u => u.email === e);
const findByUsername = n => [...users.values()].find(u => uname(u).toLowerCase() === String(n).toLowerCase());
const findByPhone = p => p && [...users.values()].find(u => u.phone === p);
const findByLogin = k => findByEmail(k.toLowerCase()) || findByUsername(k) || (normPhone(k) && findByPhone(normPhone(k)));
const setPassword = (u, pw) => { const salt = crypto.randomBytes(16); u.salt = salt.toString('hex'); u.hash = hashPw(pw, salt).toString('hex'); };
const checkPassword = (u, pw) => !!u.hash && crypto.timingSafeEqual(hashPw(String(pw || ''), Buffer.from(u.salt, 'hex')), Buffer.from(u.hash, 'hex'));

function setSessionCookie(req, res, u) {
  const exp = Date.now() + 30 * 864e5, v = u.id + '.' + exp + '.' + (u.sv || 0);
  res.setHeader('Set-Cookie', `sid=${v}.${sign(v)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${30 * 86400}${req.secure ? '; Secure' : ''}`);
}
function startSession(req, res, u) { setSessionCookie(req, res, u); res.json({ user: pub(u) }); }
function userFromCookie(header) {
  const m = /(?:^|;\s*)sid=([^;]+)/.exec(header || '');
  if (!m) return null;
  const parts = m[1].split('.');
  if (parts.length !== 4) return null;
  const [uid, exp, sv, mac] = parts;
  if (Number(exp) < Date.now()) return null;
  const a = Buffer.from(sign([uid, exp, sv].join('.'))), b = Buffer.from(mac);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  const u = users.get(uid);
  return u && (u.sv || 0) === Number(sv) ? u : null;       // şifre değişince eski oturumlar düşer
}

// Yanlış şifre denemelerini IP başına sınırla
const fails = new Map();
const isLocked = ip => (fails.get(ip)?.until || 0) > Date.now();
const addFail = ip => {
  const f = fails.get(ip) || { n: 0, until: 0 };
  if (++f.n >= 5) { f.until = Date.now() + 60000; f.n = 0; }
  fails.set(ip, f);
};
setInterval(() => { const now = Date.now(); for (const [k, f] of fails) if (f.until < now && f.n === 0) fails.delete(k); }, 10 * 60000).unref();

function readProfile(b, o = {}) {
  const f = {
    username: clean(b.username, 20), firstName: clean(b.firstName, 40), lastName: clean(b.lastName, 40),
    gender: String(b.gender || ''), bikeBrand: clean(b.bikeBrand, 40), bikeModel: clean(b.bikeModel, 40),
    email: clean(b.email, 120).toLowerCase()
  };
  if (!USER_RE.test(f.username)) return { error: 'Kullanıcı adı 3-20 karakter olmalı (harf, rakam, _ ve . kullanılabilir).' };
  if (!f.firstName) return { error: 'İsmini gir.' };
  if (!f.lastName) return { error: 'Soyismini gir.' };
  if (!GENDERS.includes(f.gender)) return { error: 'Cinsiyet seç.' };
  if (!f.bikeBrand) return { error: 'Motosiklet markasını gir.' };
  if (!f.bikeModel) return { error: 'Motosiklet modelini gir.' };
  if (!EMAIL_RE.test(f.email)) return { error: 'Geçerli bir e-posta gir.' };
  // telefon: kayıtta zorunlu; eski hesaplarda boş olabilir, doluysa silinemez (bunu rota kontrol eder)
  const rawPh = clean(b.phone, 30);
  if (rawPh) { f.phone = normPhone(rawPh); if (!f.phone) return { error: 'Geçerli bir telefon numarası gir (ör. 0532 123 45 67).' }; }
  else if (o.needPhone) return { error: 'Telefon numaranı gir.' };
  else f.phone = '';
  // acil durumda ulaşılacak kişi: isteğe bağlı; biri dolduysa ikisi de gerekir
  const en = clean(b.emergencyName, 40), ep = clean(b.emergencyPhone, 30);
  if (en || ep) {
    if (!en) return { error: 'Acil durum kişisinin adını da yaz.' };
    f.emergencyPhone = normPhone(ep); if (!f.emergencyPhone) return { error: 'Acil durum kişisi için geçerli bir telefon numarası gir.' };
    f.emergencyName = en;
  } else { f.emergencyName = ''; f.emergencyPhone = ''; }
  // motosiklet ayrıntıları: isteğe bağlı ama girilirse doğrulanır
  const yr = b.bikeYear === '' || b.bikeYear == null ? null : Number(b.bikeYear), maxY = new Date().getFullYear() + 1;
  if (yr !== null && !(Number.isInteger(yr) && yr >= 1950 && yr <= maxY)) return { error: 'Model yılı 1950 ile ' + maxY + ' arasında olmalı.' };
  f.bikeYear = yr;
  const ty = clean(b.bikeType, 20);
  if (ty && !BIKE_TYPES.includes(ty)) return { error: 'Motosiklet tipi geçersiz.' };
  f.bikeType = ty;
  const cc = b.bikeCc === '' || b.bikeCc == null ? null : Number(String(b.bikeCc).replace(',', '.'));
  if (cc !== null && !(Number.isFinite(cc) && cc >= 20 && cc <= 3000)) return { error: 'Motor hacmi 20 ile 3000 cm³ arasında olmalı.' };
  f.bikeCc = cc === null ? null : Math.round(cc);
  return { f };
}

async function sendMail(to, subject, text) {
  if (!SMTP_HOST || !nodemailer) {
    console.log(`\n[E-POSTA] SMTP tanımlı değil, mesaj gönderilmedi.\nKime: ${to}\nKonu: ${subject}\n${text}\n`);
    return;
  }
  const tr = nodemailer.createTransport({
    host: SMTP_HOST, port: SMTP_PORT, secure: SMTP_PORT === 465,
    auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS } : undefined
  });
  await tr.sendMail({ from: MAIL_FROM, to, subject, text });
}


// Güvenlik sorusu (insan doğrulaması): sunucuda imzalı, 5 dk geçerli, tek kullanımlık; harici servis yok.
const capUsed = new Map();
setInterval(() => { const n = Date.now(); for (const [k, e] of capUsed) if (e < n) capUsed.delete(k); }, 300000).unref();
const capMac = (nonce, exp, ans) => crypto.createHmac('sha256', SECRET).update('cap|' + nonce + '|' + exp + '|' + ans).digest('base64url');
function capNew() {
  const r = n => crypto.randomInt(n), a = 3 + r(7), b = 2 + r(8), k = r(3);
  const [q, ans] = k === 0 ? [a + ' + ' + b, a + b] : k === 1 ? [(a + b) + ' − ' + b, a] : [a + ' × ' + (2 + r(4)), 0];
  let ansN = ans, qq = q; if (k === 2) { const m = Number(q.split('× ')[1]); ansN = a * m; }
  const nonce = crypto.randomBytes(9).toString('base64url'), exp = Date.now() + 300000;
  return { token: nonce + '.' + exp + '.' + capMac(nonce, exp, ansN), q: qq + ' kaç eder?' };
}
function capOk(b) {
  const t = String((b && b.cToken) || '').split('.'), ans = String((b && b.cAns) || '').trim().replace(/\s/g, '');
  if (b && b.website) return false;                                   // bal küpü alanı: botlar doldurur
  if (t.length !== 3 || !/^\d{1,3}$/.test(ans)) return false;
  const [nonce, exp, mac] = t, want = capMac(nonce, exp, Number(ans));
  if (Number(exp) < Date.now() || capUsed.has(nonce) || mac.length !== want.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(want))) return false;
  capUsed.set(nonce, Number(exp)); return true;
}
const CAP_ERR = { error: 'Güvenlik sorusunu doğru yanıtla.', code: 'captcha' };
app.get('/api/captcha', (req, res) => { res.set('Cache-Control', 'no-store'); res.json(capNew()); });

// Kayıt kötüye kullanımına karşı hafif sınır: IP başına saatte en çok 10 hesap.
const regTimes = new Map();
setInterval(() => { const now = Date.now(); for (const [k, a] of regTimes) if (!a.some(t => now - t < 3600000)) regTimes.delete(k); }, 600000).unref();
function regLimited(ip) { const now = Date.now(), a = (regTimes.get(ip) || []).filter(t => now - t < 3600000); const over = a.length >= (Number(process.env.REG_LIMIT) || 10); if (!over) a.push(now); regTimes.set(ip, a); return over; }

app.get('/api/me', (req, res) => {
  const u = userFromCookie(req.headers.cookie);
  u ? res.json({ user: pub(u) }) : res.status(401).json({ error: 'Giriş gerekli.' });
});

app.post('/api/register', (req, res) => {
  if (!capOk(req.body)) return res.status(400).json(CAP_ERR);
  const b = req.body || {}, { f, error } = readProfile(b, { needPhone: true }), pw = String(b.password || '');
  if (regLimited(req.ip)) return res.status(429).json({ error: 'Çok fazla kayıt denemesi. Bir saat sonra tekrar dene.' });
  if (error) return res.status(400).json({ error });
  if (pw.length < 6 || pw.length > 64) return res.status(400).json({ error: 'Şifre 6-64 karakter olmalı.' });
  if (findByUsername(f.username)) return res.status(409).json({ error: 'Bu kullanıcı adı alınmış.' });
  if (findByEmail(f.email)) return res.status(409).json({ error: 'Bu e-posta ile zaten bir hesap var.' });
  if (findByPhone(f.phone)) return res.status(409).json({ error: 'Bu telefon numarası başka bir hesapta kayıtlı.' });
  const u = { id: crypto.randomBytes(12).toString('hex'), ...f, sv: 0, createdAt: Date.now() };
  setPassword(u, pw);
  users.set(u.id, u); saveUsers();
  startSession(req, res, u);
});

app.post('/api/login', (req, res) => {
  if (!capOk(req.body)) return res.status(400).json(CAP_ERR);
  if (isLocked(req.ip)) return res.status(429).json({ error: 'Çok fazla yanlış deneme. 1 dakika bekle.' });
  const b = req.body || {};
  const u = findByLogin(clean(b.login, 120));
  if (!u || !checkPassword(u, b.password)) { addFail(req.ip); return res.status(401).json({ error: 'Kullanıcı adı / e-posta veya şifre hatalı.' }); }
  startSession(req, res, u);
});

// Hesap ayarları: profil, e-posta, şifre güncelleme
app.post('/api/account', (req, res) => {
  const u = userFromCookie(req.headers.cookie);
  if (!u) return res.status(401).json({ error: 'Giriş gerekli.' });
  const b = req.body || {}, { f, error } = readProfile({ ...pub(u), ...b });
  if (error) return res.status(400).json({ error });
  const byName = findByUsername(f.username), byMail = findByEmail(f.email);
  if (byName && byName.id !== u.id) return res.status(409).json({ error: 'Bu kullanıcı adı alınmış.' });
  if (byMail && byMail.id !== u.id) return res.status(409).json({ error: 'Bu e-posta başka bir hesapta kullanılıyor.' });
  if (u.phone && !f.phone) return res.status(400).json({ error: 'Telefon numarası boş bırakılamaz.' });
  const byPhone = findByPhone(f.phone);
  if (byPhone && byPhone.id !== u.id) return res.status(409).json({ error: 'Bu telefon numarası başka bir hesapta kayıtlı.' });
  const newPw = b.newPassword === undefined ? '' : String(b.newPassword);
  if (newPw && (newPw.length < 6 || newPw.length > 64)) return res.status(400).json({ error: 'Yeni şifre 6-64 karakter olmalı.' });
  if (u.hash && (f.email !== u.email || newPw)) {          // hassas değişiklikte mevcut şifre şart
    if (isLocked(req.ip)) return res.status(429).json({ error: 'Çok fazla yanlış deneme. 1 dakika bekle.' });
    if (!checkPassword(u, b.currentPassword)) { addFail(req.ip); return res.status(401).json({ error: 'Mevcut şifre hatalı.' }); }
  }
  Object.assign(u, f);
  if (newPw) { setPassword(u, newPw); u.sv = (u.sv || 0) + 1; setSessionCookie(req, res, u); }
  saveUsers();
  res.json({ user: pub(u) });
});

// Şifre unuttum: e-postaya tek kullanımlık, 30 dakika geçerli bağlantı gönder
const mailHits = new Map();
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
app.post('/api/forgot', (req, res) => {
  if (!capOk(req.body)) return res.status(400).json(CAP_ERR);
  const now = Date.now(), hits = (mailHits.get(req.ip) || []).filter(t => now - t < 600000);
  if (hits.length >= 5) return res.status(429).json({ error: 'Çok fazla istek. Biraz bekleyip tekrar dene.' });
  hits.push(now); mailHits.set(req.ip, hits);
  const u = findByEmail(clean((req.body || {}).email, 120).toLowerCase());
  if (u) {
    const token = crypto.randomBytes(32).toString('base64url');
    u.reset = { hash: sha(token), exp: now + 30 * 60000 };
    saveUsers();
    const link = `${APP_URL || req.protocol + '://' + req.get('host')}/?reset=${token}`;
    sendMail(u.email, 'Moto Life şifre sıfırlama',
      `Merhaba ${uname(u)},\n\nŞifreni sıfırlamak için bu bağlantıyı aç (30 dakika geçerli):\n${link}\n\nBu isteği sen yapmadıysan bu e-postayı yok sayabilirsin.`)
      .catch(e => console.error('E-posta gönderilemedi:', e.message));
  }
  res.json({ ok: true });   // e-posta kayıtlı olsa da olmasa da aynı yanıt
});
app.post('/api/reset', (req, res) => {
  const b = req.body || {}, pw = String(b.password || '');
  if (pw.length < 6 || pw.length > 64) return res.status(400).json({ error: 'Şifre 6-64 karakter olmalı.' });
  const h = sha(String(b.token || ''));
  const u = [...users.values()].find(x => x.reset && x.reset.hash === h && x.reset.exp > Date.now());
  if (!u) return res.status(400).json({ error: 'Bağlantı geçersiz ya da süresi dolmuş. Yeni bir bağlantı iste.' });
  setPassword(u, pw);
  delete u.reset;
  u.sv = (u.sv || 0) + 1;   // eski oturumları kapat
  saveUsers();
  res.json({ ok: true });
});

require('./social-auth')({ app, users, saveUsers, crypto, sign, clean, readProfile, normPhone, findByEmail, findByUsername, findByPhone, startSession, pub, uname, APP_URL });

app.post('/api/logout', (req, res) => {
  res.setHeader('Set-Cookie', 'sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
  res.json({ ok: true });
});

// Soket bağlantısı yalnızca giriş yapmış kullanıcılara açık; görünen ad kullanıcı adıdır
io.use((socket, next) => {
  const u = userFromCookie(socket.handshake.headers.cookie);
  if (!u) return next(new Error('unauthorized'));
  socket.data.user = u;
  next();
});

// Sosyal modül: profil, akış, arkadaşlık, canlı mesajlaşma
const social = require('./social')({ app, io, users, userFromCookie, uname, dataDir: DATA_DIR });

// Canlı sürücü konumu: açık rızalı paylaşım, yalnızca bellekte (Socket.IO)
require('./live')({ io, uname, isFriend: social.isFriend });

// Grup sürüşü: kalıcı gruplar, davet kodu, lider, canlı üye konumu ve sürüş kaydı (interkom gruplarından bağımsız)
const rgApi = require('./ridegroups')({ app, express, io, users, userFromCookie, uname, dataDir: DATA_DIR, social });
require('./accountdel')({ app, io, users, userFromCookie, uname, checkPassword, saveUsers, isLocked, addFail, social, rg: rgApi, dataDir: DATA_DIR });

// Grup sesi: üyeler arası WebRTC (sinyalleşme, lider modu, bas-konuş söz hakkı)
require('./groupvoice')({ app, io, userFromCookie, uname, rg: rgApi });

// Hava durumu: sunucu vekili + önbellek + yedek sağlayıcı
require('./weather')({ app, userFromCookie });

// Harita servisleri: istemci yapılandırması, hedef arama, rota
require('./maps')({ app, userFromCookie });

// Sürüş kayıtları: yükleme (doğrulama + yeniden hesap), listeleme, okuma
require('./rides')({ app, express, userFromCookie, dataDir: DATA_DIR });

const PORT = process.env.PORT || 3000;
if (SMTP_HOST && !APP_URL) console.warn('[Uyarı] SMTP tanımlı ama APP_URL yok: şifre sıfırlama bağlantısı istekteki Host başlığından üretilir. APP_URL tanımlayın.');
server.listen(PORT, () => console.log(`Moto Life çalışıyor: http://localhost:${PORT}`));
