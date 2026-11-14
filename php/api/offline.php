<?php
// ÇEVRİMDIŞI HARİTA PAKETLERİ (PHP): hazır .pmtiles dosyalarını listeler. Dosyalar alan adı kökündeki /offline/<id>.pmtiles
// yolundan Apache/LiteSpeed tarafından (Range destekli) doğrudan sunulur. id = tr (tüm Türkiye) ya da il plaka kodu (01…81).
function h_offline_manifest(): never {
    need_user();
    $dir = (string)cfg('OFFLINE_DIR', dirname(__DIR__) . '/offline'); $packs = [];
    if (is_dir($dir)) {
        foreach (scandir($dir) ?: [] as $f) {
            if (!preg_match('/^(tr|\d{2})\.pmtiles$/', $f, $m)) continue;
            $p = $dir . '/' . $f; if (!is_file($p) || filesize($p) < 1) continue;
            $packs[] = ['id' => $m[1], 'bytes' => (int)filesize($p), 'ver' => filesize($p) . '-' . filemtime($p), 'url' => '/offline/' . $f];
        }
    }
    header('Cache-Control: no-store');
    out(['packs' => $packs]);
}
