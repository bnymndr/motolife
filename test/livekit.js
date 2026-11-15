'use strict';
// LiveKit belirteç uç noktası (Node): sahte express/rgApi; JWT imzası gerçekten doğrulanır. node test/livekit.js
const crypto = require('crypto'), LK = require('../livekit.js'); let p = 0, f = 0; const ok = (c, m) => { c ? p++ : f++; console.log((c ? 'ok: ' : 'FAIL: ') + m); };
let h; const app = { post: (u, fn) => { h = fn; } }; const GID = 'a'.repeat(16);
const rg = { groupOf: g => (g === GID ? { id: GID, members: [{ uid: 'u1' }] } : null) };
const env = { LIVEKIT_URL: 'wss://lk.example', LIVEKIT_API_KEY: 'K', LIVEKIT_API_SECRET: 'S3cret' };
const mk = e => { LK({ app, userFromCookie: c => (c === 'u1' ? { id: 'u1' } : c === 'u2' ? { id: 'u2' } : null), uname: u => 'name-' + u.id, rg, env: e, now: () => 1_700_000_000_000 }); };
const call = async (cookie, body) => { const r = { code: 200, body: null, status(c) { r.code = c; return r; }, json(b) { r.body = b; return r; }, set() {} }; await h({ headers: { cookie }, body }, r); return r; };
(async () => {
  mk(env);
  ok((await call('', { gid: GID })).code === 401, 'oturum şart');
  ok((await call('u2', { gid: GID })).code === 404, 'üye olmayan 404');
  ok((await call('u1', { gid: 'x' })).code === 404 && (await call('u1', {})).code === 404, 'geçersiz/boş grup 404');
  const r = await call('u1', { gid: GID }); const [a, b, c] = r.body.token.split('.'); const pl = JSON.parse(Buffer.from(b, 'base64url'));
  ok(r.code === 200 && r.body.room === 'ml-' + GID && r.body.url === 'wss://lk.example' && r.body.identity === 'u1', 'üyeye belirteç, oda = ml-<grup>');
  ok(c === crypto.createHmac('sha256', 'S3cret').update(a + '.' + b).digest('base64url') && JSON.parse(Buffer.from(a, 'base64url')).alg === 'HS256', 'HS256 imza doğru');
  ok(pl.iss === 'K' && pl.sub === 'u1' && pl.name === 'name-u1' && pl.exp === 1_700_000_000 + 3600 && pl.video.room === 'ml-' + GID && pl.video.canPublish && pl.video.canSubscribe && !pl.video.canPublishData, 'iddia seti: yalnız o odaya, 1 saat, veri yayını yok');
  ok(!JSON.stringify(r.body).includes('S3cret'), 'yanıtta sır yok');
  for (let i = 0; i < 8; i++) await call('u1', { gid: GID }); ok((await call('u1', { gid: GID })).code === 429, 'dakikada 10 istek sınırı');
  mk({ ...env, LIVEKIT_API_SECRET: '' }); ok((await call('u1', { gid: GID })).code === 503, 'yapılandırma eksikse 503');
  console.log(`\nSONUÇ: ${p} geçti, ${f} başarısız`); process.exit(f ? 1 : 0);
})();
