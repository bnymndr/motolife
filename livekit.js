'use strict';
// LIVEKIT BELİRTECİ: POST /api/livekit/token { gid } → { url, token, room, identity }. Yalnız o sürüş grubunun ÜYESİ belirteç alır.
// Gizli bilgiler yalnız sunucuda: LIVEKIT_URL (wss://…), LIVEKIT_API_KEY, LIVEKIT_API_SECRET. Biri yoksa 503 (özellik kapalı).
// Belirteç = HS256 JWT (livekit-server-sdk BAĞIMLILIĞI YOK): iss=anahtar, sub=kimlik, video{room, roomJoin, canPublish, canSubscribe}, ömür 1 saat.
// Oda adı "ml-" + grup kimliği (başka gruba geçilemez). Kimlik = kullanıcı kimliği (aynı kişi iki cihazdan bağlanırsa eskisi düşer — LiveKit davranışı).
const crypto = require('crypto');
const b64u = b => Buffer.from(b).toString('base64url');
function makeToken({ apiKey, apiSecret, identity, name, room, ttlS = 3600, now = () => Date.now() }) {
  const t = Math.floor(now() / 1000), head = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64u(JSON.stringify({ iss: apiKey, sub: identity, name, nbf: t - 5, exp: t + ttlS, video: { room, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: false } }));
  return head + '.' + body + '.' + crypto.createHmac('sha256', apiSecret).update(head + '.' + body).digest('base64url');
}
module.exports = function mountLiveKit({ app, userFromCookie, uname, rg, env = process.env, now = () => Date.now() }) {
  const hits = new Map(), cfg = () => ({ url: env.LIVEKIT_URL || '', apiKey: env.LIVEKIT_API_KEY || '', apiSecret: env.LIVEKIT_API_SECRET || '' });
  app.post('/api/livekit/token', (req, res) => {
    const u = userFromCookie(req.headers.cookie); if (!u) return res.status(401).json({ error: 'Oturum gerekli.' });
    const t = Date.now(), arr = (hits.get(u.id) || []).filter(x => t - x < 60000); if (arr.length >= 10) return res.status(429).json({ error: 'Çok sık istek.' }); arr.push(t); hits.set(u.id, arr);
    const c = cfg(); if (!c.url || !c.apiKey || !c.apiSecret) return res.status(503).json({ error: 'İnterkom yapılandırılmadı.' });
    const gid = String((req.body && req.body.gid) || ''), g = /^[0-9a-f]{16}$/.test(gid) ? rg.groupOf(gid) : null;
    if (!g || !g.members.some(m => m.uid === u.id)) return res.status(404).json({ error: 'Grup bulunamadı.' });
    const room = 'ml-' + gid, identity = String(u.id);
    res.set('Cache-Control', 'no-store');
    res.json({ url: c.url, room, identity, token: makeToken({ apiKey: c.apiKey, apiSecret: c.apiSecret, identity, name: uname(u), room, now }) });
  });
};
module.exports.makeToken = makeToken;
