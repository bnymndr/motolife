<?php
// Bu dosyayı "config.php" adıyla kopyalayıp doldur. Hepsi isteğe bağlıdır (DB_* hariç). Bu dosya tarayıcıdan okunamaz (api/.htaccess).
return [
    // ---- Veritabanı (cPanel › MySQL® Veritabanları'nda oluşturduğun) ----
    'DB_HOST' => 'localhost',
    'DB_NAME' => 'cpaneluser_motolife',
    'DB_USER' => 'cpaneluser_moto',
    'DB_PASS' => '',

    // ---- Genel ----
    'APP_URL' => '',                 // https://alanadin.com  (şifre sıfırlama bağlantısı ve harita User-Agent'ı için; boşsa istekten üretilir)
    'SESSION_SECRET' => '',          // boşsa ilk istekte rastgele üretilip veritabanında saklanır
    'TRUST_PROXY' => '',             // Cloudflare/ters vekil arkasındaysan 1 yaz (IP için X-Forwarded-For kullanılır)

    // ---- E-posta (şifre sıfırlama). SMTP_HOST boşsa PHP mail() kullanılır ----
    'MAIL_FROM' => '',               // örn. Moto Life <noreply@alanadin.com>
    'SMTP_HOST' => '', 'SMTP_PORT' => 587, 'SMTP_USER' => '', 'SMTP_PASS' => '',


    // ---- Harita / rota (anahtarlar yalnızca burada, istemciye gitmez) ----
    'GEOAPIFY_API_KEY' => '',        // motosiklet rotası
    'ORS_API_KEY' => '', 'ORS_BASE_URL' => '',
    'VALHALLA_URL' => '',            // boşsa herkese açık sunucu; 'off' = kapat
    'ROUTE_PROVIDER' => 'auto', 'ROUTE_DAILY_LIMIT' => '', 'ROUTE_USER_DAILY' => '',
    'MAP_TILE_URL' => '', 'MAP_TILE_URL_DARK' => '', 'MAP_TILE_ATTRIBUTION' => '',
    'WEATHER_CONTACT' => '',         // MET Norway User-Agent iletişim bilgisi (e-posta/alan adı)

    // ---- Grup sesi ----
    'GV_TURN_URLS' => '', 'GV_TURN_USER' => '', 'GV_TURN_CREDENTIAL' => '',   // TURN (gerekirse), örn. turn:turn.alanadin.com:3478
    'GV_MAX' => 6,

    // 'DEBUG' => 1,                 // hata ayrıntısını yanıtta göster (yalnızca sorun giderirken)
];
