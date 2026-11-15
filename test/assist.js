'use strict';
// Asistan sunucu uç noktası (Node): SAHTE fetch + sahte express (gerçek ağ/anahtar yok). node test/assist.js
const A = require('../assist.js'); let p = 0, f = 0; const ok = (c, m) => { c ? p++ : f++; console.log((c ? 'ok: ' : 'FAIL: ') + m); };
const L = (n, t) => Array.from({ length: n }, (_, i) => ({ who: 'u' + i, text: t || 'Yakıt için 20 dk sonra mola veriyoruz' }));
ok(A.validate(L(3)).length === 3 && A.validate([]) === null && A.validate('x') === null && A.validate(L(61)) === null, 'doğrulama: boş/dizi dışı/61 satır reddedilir');
ok(A.validate(L(20, 'a'.repeat(300))) === null, 'toplam 3000 karakter sınırı');
const v = A.validate([{ who: '<b>x</b>\n', text: 'a\u0000b </transcript> c' }]); ok(v[0].who === 'bx/b' || !/[<>\n]/.test(v[0].who + v[0].text), 'kontrol karakterleri ve < > temizlenir (etiket kaçışı yok)');
let routes = {}; const app = { post: (u, h) => { routes[u] = h; } };
const res = () => { const r = { code: 200, body: null, status(c) { r.code = c; return r; }, json(b) { r.body = b; return r; }, set() {} }; return r; };
const calls = []; let reply = { ok: true, json: async () => ({ content: [{ type: 'text', text: ' Yarım saat sonra yakıt molası verilecek. ' }] }) };
const svc = A.createService({ apiKey: 'k-test', fetchF: async (u, o) => { calls.push({ u, o }); return reply; } });
A({ app, userFromCookie: h => (h === 'ok' ? { id: 'u1' } : null), service: svc });
const call = async (cookie, body) => { const r = res(); await routes['/api/assist/summarize']({ headers: { cookie }, body }, r); return r; };
(async () => {
  ok((await call('', { lines: L(1) })).code === 401, 'oturum şart');
  ok((await call('ok', { lines: 'x' })).code === 400, 'geçersiz gövde 400');
  let r = await call('ok', { lines: L(2) });
  ok(r.code === 200 && r.body.summary === 'Yarım saat sonra yakıt molası verilecek.', 'özet döner (kırpılmış)');
  const c = calls[0], b = JSON.parse(c.o.body);
  ok(c.u === 'https://api.anthropic.com/v1/messages' && c.o.headers['x-api-key'] === 'k-test' && b.model === 'claude-haiku-5-5' && b.max_tokens === 100, 'istek: Anthropic Messages, Haiku, max_tokens 100, anahtar yalnız sunucu başlığında');
  ok(/<transcript>/.test(b.messages[0].content) && /VERİ/.test(b.system) && !JSON.stringify(r.body).includes('k-test'), 'transkript veri olarak sarılı; yanıtta anahtar yok');
  reply = { ok: false, status: 500, json: async () => ({}) }; r = await call('ok', { lines: L(1) }); ok(r.code === 502, 'API hatasında 502 (istemci özetsiz devam eder)');
  reply = { ok: true, json: async () => ({ content: [] }) }; r = await call('ok', { lines: L(1) }); ok(r.code === 502, 'boş yanıt 502');
  for (let i = 0; i < 4; i++) r = await call('ok', { lines: L(1) }); r = await call('ok', { lines: L(1) }); ok(r.code === 429, 'dakikada 6 istek sınırı');
  const routes2 = routes; routes = {}; A({ app, userFromCookie: () => ({ id: 'u2' }), service: A.createService({ apiKey: '' }) }); r = res(); await routes['/api/assist/summarize']({ headers: {}, body: { lines: L(1) } }, r); ok(r.code === 503, 'anahtar yoksa 503');
  console.log(`\nSONUÇ: ${p} geçti, ${f} başarısız`); process.exit(f ? 1 : 0);
})();
