'use strict';
// Google / Apple ile giriş ve kayıt. Tarayıcı sağlayıcıdan bir ID token (JWT) alır; burada imzası sağlayıcının
// açık anahtarlarıyla (JWKS) doğrulanır. Gizli anahtar gerekmez, yalnızca istemci kimlikleri (env):
//   GOOGLE_CLIENT_ID  — Google Cloud › OAuth istemci kimliği (Web)
//   APPLE_CLIENT_ID   — Apple Developer › Services ID (Sign in with Apple)
// Tanımlı olmayan sağlayıcının düğmesi arayüzde görünmez. Yeni kullanıcı için telefon/kullanıcı adı/motosiklet
// bilgisi /api/auth/complete ile tamamlanır (imzalı, 15 dk geçerli bilet).
const PROVIDERS = {
  google: { env: 'GOOGLE_CLIENT_ID', jwks: 'https://www.googleapis.com/oauth2/v3/certs', iss: ['https://accounts.google.com', 'accounts.google.com'], field: 'googleSub' },
  apple: { env: 'APPLE_CLIENT_ID', jwks: 'https://appleid.apple.com/auth/keys', iss: ['https://appleid.apple.com'], field: 'appleSub' }
};
const TICKET_TTL = 15 * 60 * 1000;

module.exports = function mountSocialAuth(d) {
  const { app, users, saveUsers, crypto, sign, clean, readProfile, findByEmail, findByUsername, findByPhone, startSession } = d;
  const doFetch = (...a) => (d.fetch || fetch)(...a);
  const keyCache = {};

  async function getKeys(p) {
    const c = keyCache[p];
    if (c && c.exp > Date.now()) return c.keys;
    const r = await doFetch(PROVIDERS[p].jwks);
    if (!r.ok) throw new Error('jwks');
    const keys = (await r.json()).keys || [];
    keyCache[p] = { keys, exp: Date.now() + 3600e3 };
    return keys;
  }

  // ID token doğrula → { sub, email, firstName, lastName } ya da fırlatır
  async function verify(p, token) {
    const cfg = PROVIDERS[p], aud = process.env[cfg.env];
    if (!aud) throw new Error('config');
    const parts = String(token || '').split('.');
    if (parts.length !== 3) throw new Error('format');
    const head = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
    if (head.alg !== 'RS256') throw new Error('alg');
    let jwk = (await getKeys(p)).find(k => k.kid === head.kid);
    if (!jwk) { delete keyCache[p]; jwk = (await getKeys(p)).find(k => k.kid === head.kid); }   // anahtar dönmüş olabilir
    if (!jwk) throw new Error('kid');
    const ok = crypto.verify('RSA-SHA256', Buffer.from(parts[0] + '.' + parts[1]), crypto.createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(parts[2], 'base64url'));
    if (!ok) throw new Error('sig');
    const c = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    if (!cfg.iss.includes(c.iss)) throw new Error('iss');
    if ([].concat(c.aud).indexOf(aud) < 0) throw new Error('aud');
    if (!(c.exp * 1000 > Date.now())) throw new Error('exp');
    if (!c.sub || !c.email) throw new Error('claims');
    if (!(c.email_verified === true || c.email_verified === 'true')) throw new Error('unverified');
    return { sub: String(c.sub), email: String(c.email).toLowerCase(), firstName: clean(c.given_name, 40), lastName: clean(c.family_name, 40) };
  }

  const makeTicket = (p, i) => { const body = Buffer.from(JSON.stringify({ p, sub: i.sub, email: i.email, exp: Date.now() + TICKET_TTL })).toString('base64url'); return body + '.' + sign('tk|' + body); };
  function readTicket(t) {
    const [body, sig] = String(t || '').split('.');
    if (!body || !sig || sig.length !== sign('tk|' + body).length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(sign('tk|' + body)))) return null;
    try { const o = JSON.parse(Buffer.from(body, 'base64url').toString()); return o.exp > Date.now() && PROVIDERS[o.p] ? o : null; } catch { return null; }
  }

  app.get('/api/auth/config', (req, res) => {
    res.json({ google: process.env.GOOGLE_CLIENT_ID || null, apple: process.env.APPLE_CLIENT_ID || null });
  });

  for (const p of Object.keys(PROVIDERS)) {
    app.post('/api/auth/' + p, async (req, res) => {
      if (!process.env[PROVIDERS[p].env]) return res.status(503).json({ error: (p === 'google' ? 'Google' : 'Apple') + ' girişi bu sunucuda ayarlanmamış.' });
      let id;
      try { id = await verify(p, (req.body || {}).credential); }
      catch (e) { return res.status(401).json({ error: e.message === 'unverified' ? 'Hesabın e-postası doğrulanmamış.' : 'Giriş doğrulanamadı. Tekrar dene.' }); }
      const f = PROVIDERS[p].field;
      let u = [...users.values()].find(x => x[f] === id.sub) || findByEmail(id.email);
      if (u) {                                                   // mevcut hesap: sağlayıcıyı bağla (e-posta sağlayıcıca doğrulanmış) ve gir
        if (!u[f]) { u[f] = id.sub; saveUsers(); }
        return startSession(req, res, u);
      }
      const b = req.body || {};
      res.json({ needProfile: true, ticket: makeTicket(p, id), email: id.email, firstName: id.firstName || clean(b.firstName, 40), lastName: id.lastName || clean(b.lastName, 40) });
    });
  }

  app.post('/api/auth/complete', (req, res) => {
    const b = req.body || {}, t = readTicket(b.ticket);
    if (!t) return res.status(400).json({ error: 'Oturum süresi doldu. Google/Apple ile yeniden dene.' });
    const { f, error } = readProfile({ ...b, email: t.email }, { needPhone: true });
    if (error) return res.status(400).json({ error });
    if (findByUsername(f.username)) return res.status(409).json({ error: 'Bu kullanıcı adı alınmış.' });
    if (findByEmail(f.email) || [...users.values()].some(x => x[PROVIDERS[t.p].field] === t.sub)) return res.status(409).json({ error: 'Bu hesapla zaten kayıt olunmuş. Giriş yap.' });
    if (findByPhone(f.phone)) return res.status(409).json({ error: 'Bu telefon numarası başka bir hesapta kayıtlı.' });
    const u = { id: crypto.randomBytes(12).toString('hex'), ...f, [PROVIDERS[t.p].field]: t.sub, sv: 0, createdAt: Date.now() };
    users.set(u.id, u); saveUsers();
    startSession(req, res, u);
  });
  return { verify };
};
