'use strict';
// ÇEVRİMDIŞI HARİTA PAKETLERİ: sunucu yalnız hazır .pmtiles dosyalarını listeler ve sunar (Range destekli, giriş şart).
// Dosyalar OFFLINE_DIR (varsayılan ./offline-maps) içinde <id>.pmtiles adıyla durur: id = tr (tüm Türkiye) ya da il plaka kodu (01…81).
// Paketleri üretmek: tools/offline-maps.js (kendi bilgisayarında, internetle). Veri OpenStreetMap katkıcıları (ODbL).
const fs = require('fs');
const path = require('path');
module.exports = function mountOffline({ app, express, userFromCookie, dir }) {
  const root = path.resolve(dir || process.env.OFFLINE_DIR || path.join(__dirname, 'offline-maps'));
  let cache = null, at = 0;
  function scan() {
    if (cache && Date.now() - at < 30000) return cache;
    const packs = [];
    try {
      for (const f of fs.readdirSync(root)) {
        const m = /^(tr|\d{2})\.pmtiles$/.exec(f); if (!m) continue;
        const st = fs.statSync(path.join(root, f)); if (!st.isFile() || st.size < 1) continue;
        packs.push({ id: m[1], bytes: st.size, ver: st.size + '-' + Math.round(st.mtimeMs / 1000), url: '/offline/' + f });
      }
    } catch {}
    at = Date.now(); return (cache = packs);
  }
  const auth = (req, res, next) => (userFromCookie(req.headers.cookie) ? next() : res.status(401).json({ error: 'Oturum gerekli.' }));
  app.get('/api/offline/manifest', auth, (req, res) => { res.set('Cache-Control', 'no-store'); res.json({ packs: scan() }); });
  app.use('/offline', auth, express.static(root, { index: false, dotfiles: 'ignore', acceptRanges: true, fallthrough: false, setHeaders: r => r.setHeader('Content-Type', 'application/octet-stream') }),
    (err, req, res, next) => res.status(err && err.status === 404 ? 404 : 500).json({ error: 'Paket bulunamadı.' }));
};
