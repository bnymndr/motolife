'use strict';
// Hesap silme: POST /api/account/delete { password?, confirm }.
// Doğrulama: kullanıcı adını yazarak onay + (şifreli hesapta) şifre. Silinen: kullanıcı kaydı ve oturumlar, sürüş/telemetri dosyaları (data/rides/<id>/),
// sosyal veriler (gönderi, görsel, beğeni/yorum, arkadaşlık, mesaj), grup üyelikleri. SİLİNEMEYEN: başkalarının da paylaştığı grup sürüşü kayıtlarındaki
// (data/rgroup-rides/) konum izleri; üyelerin analizi için saklanır, kullanıcı adı bu kayıtlarda kalır. Arayüz bunu silmeden önce söyler.
// server.js içinden: require('./accountdel')({ app, io, users, userFromCookie, uname, checkPassword, saveUsers, isLocked, addFail, social, rg, dataDir })
const fs = require('fs');
const path = require('path');

module.exports = function mountAccountDelete({ app, io, users, userFromCookie, uname, checkPassword, saveUsers, isLocked, addFail, social, rg, dataDir }) {
  app.post('/api/account/delete', (req, res) => {
    const u = userFromCookie(req.headers.cookie);
    if (!u) return res.status(401).json({ error: 'Giriş gerekli.' });
    if (isLocked(req.ip)) return res.status(429).json({ error: 'Çok fazla yanlış deneme. 1 dakika bekle.' });
    const b = req.body || {};
    if (String(b.confirm || '').trim().toLowerCase() !== uname(u).toLowerCase()) return res.status(400).json({ error: 'Onay için kullanıcı adını yaz.' });
    if (u.hash && !checkPassword(u, b.password)) { addFail(req.ip); return res.status(401).json({ error: 'Şifre hatalı.' }); }
    const uid = u.id;
    try {
      rg.removeUser(uid);
      social.removeUser(uid);
      const dir = path.join(dataDir, 'rides', String(uid).replace(/[^A-Za-z0-9_-]/g, ''));
      if (path.dirname(dir) === path.join(dataDir, 'rides')) fs.rmSync(dir, { recursive: true, force: true });
      users.delete(uid);
      saveUsers();
    } catch (e) { console.error('Hesap silinemedi:', e.message); return res.status(500).json({ error: 'Hesap silinirken hata oluştu. Tekrar dene.' }); }
    for (const s of [...io.sockets.sockets.values()]) if (s.data && s.data.user && s.data.user.id === uid) s.disconnect(true);
    res.setHeader('Set-Cookie', 'sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
    res.json({ ok: true });
  });
};
