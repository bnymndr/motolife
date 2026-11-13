'use strict';
// PHP + MySQL (paylaşımlı hosting) paketini üretir:  node build-php.js [çıktı-klasörü]   (varsayılan: dist-php)
// public/ → kök (index.html'deki socket.io betiği rt.js ile değiştirilir), php/api → api/, .htaccess dosyaları, rt.js. data/ ve Node dosyaları pakete girmez.
const fs = require('fs');
const path = require('path');
const out = path.resolve(process.argv[2] || 'dist-php');
const copy = (from, to) => { if (fs.statSync(from).isDirectory()) { for (const f of fs.readdirSync(from)) copy(path.join(from, f), path.join(to, f)); return; } fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(from, to); };
fs.rmSync(out, { recursive: true, force: true });
for (const f of fs.readdirSync('public')) copy(path.join('public', f), path.join(out, f));
const idx = path.join(out, 'index.html');
let html = fs.readFileSync(idx, 'utf8');
const tag = '<script src="/socket.io/socket.io.js"></script>';
if (!html.includes(tag)) throw new Error('index.html içinde socket.io betiği bulunamadı');
fs.writeFileSync(idx, html.replace(tag, '<script src="/rt.js"></script>'));
copy('php/rt.js', path.join(out, 'rt.js'));
for (const f of fs.readdirSync('php/api')) if (f.endsWith('.php') && f !== 'config.php') copy(path.join('php/api', f), path.join(out, 'api', f));
copy('php/htaccess-root', path.join(out, '.htaccess'));
copy('php/htaccess-api', path.join(out, 'api', '.htaccess'));
if (fs.existsSync('php/KURULUM.md')) copy('php/KURULUM.md', path.join(out, 'KURULUM.md'));
if (fs.existsSync('php/veritabani.sql')) copy('php/veritabani.sql', path.join(out, 'veritabani.sql'));
console.log('Paket hazır:', out);
