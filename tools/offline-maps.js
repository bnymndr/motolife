#!/usr/bin/env node
'use strict';
/* Çevrimdışı harita paketlerini üretir (KENDİ BİLGİSAYARINDA, internetle çalıştır; sunucuda/Render'da değil).
   Gerekenler: Node ≥18 ve pmtiles komut satırı aracı (https://docs.protomaps.com/pmtiles/cli — tek dosyalık ikili, kurulum gerekmez).
   Kaynak: Protomaps günlük OpenStreetMap yapısı (ODbL; OSM atfı şart). Güncel adres: https://maps.protomaps.com/builds
   Kullanım:
     node tools/offline-maps.js --source <planet.pmtiles adresi ya da yerel dosya> [--out offline-maps] [--maxzoom 15] [--only tr,34,06] [--pmtiles pmtiles]
   Çıktı: <out>/tr.pmtiles (tüm Türkiye) ve <out>/01.pmtiles … 81.pmtiles (il plaka kodu). Sunucuda OFFLINE_DIR klasörüne (Node: ./offline-maps, PHP: kökte /offline) koy.
   Sınırlar (bbox): il idari sınırının dikdörtgeni Nominatim'den (1 istek/sn, kullanım politikasına uygun) alınıp tools/bboxes.json'a yazılır; yanlışsa elle düzelt.
   Boyut: maxzoom 15 → büyük şehir illeri yüzlerce MB olabilir; mobil için --maxzoom 14 (≈yarısı) ya da 13 düşün. Önce tek il ile dene: --only 34 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const SOURCE = arg('source'), OUT = path.resolve(arg('out', 'offline-maps')), MAXZ = arg('maxzoom', '15'), BIN = arg('pmtiles', 'pmtiles'), ONLY = arg('only', '');
if (!SOURCE) { console.error('Hata: --source gerekli (bkz. dosya başındaki açıklama).'); process.exit(1); }
if (!/^\d{1,2}$/.test(MAXZ) || +MAXZ > 15) { console.error('Hata: --maxzoom 0-15 olmalı.'); process.exit(1); }
const PROV = '01 Adana|02 Adıyaman|03 Afyonkarahisar|04 Ağrı|05 Amasya|06 Ankara|07 Antalya|08 Artvin|09 Aydın|10 Balıkesir|11 Bilecik|12 Bingöl|13 Bitlis|14 Bolu|15 Burdur|16 Bursa|17 Çanakkale|18 Çankırı|19 Çorum|20 Denizli|21 Diyarbakır|22 Edirne|23 Elazığ|24 Erzincan|25 Erzurum|26 Eskişehir|27 Gaziantep|28 Giresun|29 Gümüşhane|30 Hakkâri|31 Hatay|32 Isparta|33 Mersin|34 İstanbul|35 İzmir|36 Kars|37 Kastamonu|38 Kayseri|39 Kırklareli|40 Kırşehir|41 Kocaeli|42 Konya|43 Kütahya|44 Malatya|45 Manisa|46 Kahramanmaraş|47 Mardin|48 Muğla|49 Muş|50 Nevşehir|51 Niğde|52 Ordu|53 Rize|54 Sakarya|55 Samsun|56 Siirt|57 Sinop|58 Sivas|59 Tekirdağ|60 Tokat|61 Trabzon|62 Tunceli|63 Şanlıurfa|64 Uşak|65 Van|66 Yozgat|67 Zonguldak|68 Aksaray|69 Bayburt|70 Karaman|71 Kırıkkale|72 Batman|73 Şırnak|74 Bartın|75 Ardahan|76 Iğdır|77 Yalova|78 Karabük|79 Kilis|80 Osmaniye|81 Düzce'.split('|').map(s => ({ id: s.slice(0, 2), name: s.slice(3) }));
const REGIONS = [{ id: 'tr', name: 'Türkiye', country: true }, ...PROV];
const BB = path.join(__dirname, 'bboxes.json');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let boxes = {}; try { boxes = JSON.parse(fs.readFileSync(BB, 'utf8')); } catch {}

async function bboxOf(r) {
  if (boxes[r.id]) return boxes[r.id];
  const u = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=tr&featureType=' + (r.country ? 'country' : 'state') + '&q=' + encodeURIComponent(r.country ? 'Türkiye' : r.name);
  const res = await fetch(u, { headers: { 'User-Agent': 'MotoLife-offline-maps/1.0 (yerel betik)' } });
  if (!res.ok) throw new Error('Nominatim ' + res.status);
  const j = await res.json(); if (!j[0] || !j[0].boundingbox) throw new Error('sınır bulunamadı');
  const [s, n, w, e] = j[0].boundingbox.map(Number), pad = 0.02;                 // ≈2 km pay (kenarlarda karo kesilmesin)
  boxes[r.id] = [w - pad, s - pad, e + pad, n + pad].map(v => Math.round(v * 1e4) / 1e4);
  fs.writeFileSync(BB, JSON.stringify(boxes, null, 1)); await sleep(1100); return boxes[r.id];
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const want = ONLY ? new Set(ONLY.split(',').map(s => s.trim())) : null, list = REGIONS.filter(r => !want || want.has(r.id));
  if (!list.length) { console.error('Hata: --only ile eşleşen bölge yok (tr ya da 01…81).'); process.exit(1); }
  const probe = spawnSync(BIN, ['version']); if (probe.error) { console.error('Hata: pmtiles aracı bulunamadı (' + BIN + '). https://docs.protomaps.com/pmtiles/cli'); process.exit(1); }
  let ok = 0; const bad = [];
  for (const r of list) {
    const file = path.join(OUT, r.id + '.pmtiles');
    try {
      const bb = await bboxOf(r); console.log(`[${r.id}] ${r.name}  bbox=${bb.join(',')}  maxzoom=${MAXZ}`);
      const x = spawnSync(BIN, ['extract', SOURCE, file, '--bbox=' + bb.join(','), '--maxzoom=' + MAXZ], { stdio: 'inherit' });
      if (x.status !== 0) throw new Error('pmtiles extract başarısız (kod ' + x.status + ')');
      console.log(`[${r.id}] hazır: ${(fs.statSync(file).size / 1048576).toFixed(1)} MB`); ok++;
    } catch (e) { console.error(`[${r.id}] ${r.name}: ${e.message}`); bad.push(r.id); try { fs.unlinkSync(file); } catch {} }
  }
  console.log(`\nBitti: ${ok} hazır, ${bad.length} hatalı${bad.length ? ' (' + bad.join(',') + ')' : ''}. Çıktı: ${OUT}`);
  console.log('Atıf: © OpenStreetMap katkıcıları (ODbL) · Protomaps');
  process.exit(bad.length ? 1 : 0);
})();
