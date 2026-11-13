# Moto Life — PHP + MySQL Kurulum Rehberi (cPanel / Plesk paylaşımlı hosting)

Gereksinim: PHP 8.1 veya üstü (pdo_mysql, curl, openssl, mbstring uzantıları), MySQL/MariaDB, HTTPS'li bir alan adı. Node.js GEREKMEZ.

## 1. Veritabanı
1. cPanel › **MySQL® Veritabanları**: yeni veritabanı oluştur (örn. `kullanici_motolife`).
2. Yeni MySQL kullanıcısı oluştur, güçlü şifre ver, kullanıcıyı veritabanına **TÜM AYRICALIKLARLA** ekle.
3. Tablolar ilk istekte otomatik oluşur (`ml_` önekli, 22 tablo). İstersen elle kur: phpMyAdmin › veritabanını seç › **İçe Aktar** › paketteki `veritabani.sql` dosyası. (İndeks satırlarında «Duplicate key name» hatası çıkarsa yok sayılabilir.)

## 2. Dosyaları yükle
1. Zip içeriğini **alan adının kök klasörüne** (`public_html`) çıkar. Uygulama `/api/...` mutlak yollarını kullandığı için alt klasörde ÇALIŞMAZ; gerekirse alt alan adı (`moto.alanadin.com`) aç ve onun köküne yükle.
2. `.htaccess` dosyalarının yüklendiğinden emin ol (gizli dosya; Dosya Yöneticisi › Ayarlar › "Gizli dosyaları göster").
3. `api/config.sample.php` dosyasını `api/config.php` olarak kopyala ve en az şunları doldur: `DB_HOST` (genelde `localhost`), `DB_NAME`, `DB_USER`, `DB_PASS`, `APP_URL` (`https://alanadin.com`).
4. cPanel › **MultiPHP Yöneticisi**: alan adı için PHP 8.1+ seç.
5. Önce `https://alanadin.com/api/health` adresini aç: `"db":"ok"` görmelisin. `hata` ise `dbCode` değeri nedeni gösterir (1045 = kullanıcı/şifre yanlış, 1049 = veritabanı adı yanlış, 2002 = sunucu adresi yanlış, 1044 = kullanıcının veritabanına yetkisi yok); `configFile:false` ise config.php yüklenmemiştir; sayfa JSON yerine HTML/404 gösteriyorsa `.htaccess` yüklenmemiş ya da mod_rewrite kapalıdır.
6. Tarayıcıda `https://alanadin.com` aç. Hesap oluşturup giriş yap. Girişte güvenlik sorusu «Yüklenemedi» diyorsa nedeni kırmızı yazıda ve `/api/health` çıktısındadır.

## 3. İsteğe bağlı ayarlar (`api/config.php`)
- **E-posta (şifre sıfırlama):** `MAIL_FROM` ve gerekirse `SMTP_HOST/PORT/USER/PASS`. Boşsa PHP `mail()` denenir (birçok hostta spam'e düşer; SMTP önerilir).
- **Google / Apple girişi:** düğmeler giriş ve kayıt ekranında HER ZAMAN görünür; kimlik tanımlı değilken dokununca «henüz etkinleştirilmemiş» uyarısı çıkar. Çalışması için `api/config.php` içine `GOOGLE_CLIENT_ID` ve `APPLE_CLIENT_ID` yazılır:
  - **Google:** https://console.cloud.google.com › APIs & Services › Credentials › *Create Credentials › OAuth client ID* › tür **Web application**. «Authorized JavaScript origins» alanına siteni ekle (örn. `https://moto.ramazanyasar.com.tr`, sonunda `/` olmadan). Çıkan «Client ID»yi `GOOGLE_CLIENT_ID` olarak yaz. (Client secret gerekmez.) OAuth izin ekranını «External» ve yayında bırak.
  - **Apple (iCloud):** Apple Developer hesabı (ücretli) gerekir. Identifiers › **Services ID** oluştur, «Sign In with Apple»ı aç, Domain olarak `moto.ramazanyasar.com.tr`, Return URL olarak `https://moto.ramazanyasar.com.tr` ekle. Services ID'yi (örn. `com.ramazanyasar.motolife`) `APPLE_CLIENT_ID` olarak yaz. Apple, domain doğrulama dosyasını `/.well-known/apple-developer-domainassociation.txt` altında ister (siteye yükle).
  - Hesapsız/anahtarsız da e-posta (Gmail, iCloud, Outlook…) ile kayıt çalışır.
- **Rota:** `GEOAPIFY_API_KEY` (motosiklet rotası) veya `ORS_API_KEY`; hiçbiri yoksa herkese açık Valhalla kullanılır (yoğun kullanımda sınırlıdır).
- **Grup sesi:** farklı ağlardaki kullanıcılar için `GV_TURN_URLS/USER/CREDENTIAL` (TURN sunucusu) gerekebilir; yalnız STUN ile bazı mobil ağlarda ses bağlanmaz.
- **Cloudflare / ters vekil** arkasındaysan `TRUST_PROXY` = `1`.
- Sorun giderirken `'DEBUG' => 1` (bitince kaldır).

## 4. Güvenlik
- **Güvenlik sorusu (insan doğrulaması):** giriş, hızlı giriş, kayıt ve «Şifremi Unuttum» formlarında basit bir işlem sorusu sorulur (`GET /api/captcha`). Soru sunucuda imzalanır (HMAC), 5 dakika geçerlidir, tek kullanımlıktır; ek olarak gizli bal küpü alanı vardır. Harici servis ve ek ayar GEREKMEZ. Giriş denemesi sınırı (5 yanlış → 60 sn) ve kayıt sınırı (IP başına saatte 10) ayrıca sürer. Daha güçlü bot koruması istenirse Cloudflare Turnstile eklenebilir (şu an yok).
- `api/` klasörüne yalnızca `index.php` dışarıdan erişilebilir (`api/.htaccess`); `config.php` okunamaz. Doğrula: `https://alanadin.com/api/config.php` 403/404 vermeli.
- HTTPS zorunlu (çerez, konum ve mikrofon izni için).
- `config.php` dosya izni 640/600 olsun.

## 5. Bilinen sınırlar (Node sürümünden farklar)
- **Gerçek zamanlı özellikler HTTP yoklamasıyla çalışır** (WebSocket yok): canlı konum, mesajlaşma, grup sürüşü ve ses sinyalleşmesi 1–4,5 sn gecikmeli; her kullanıcı sürekli PHP isteği üretir. Hosting "CPU/süreç" sınırı varsa çok sayıda eşzamanlı kullanıcıda yavaşlayabilir.
- Arka plandaki / ekranı kilitli tarayıcı sekmesinde yoklama yavaşlar; konum paylaşımı aksayabilir.
- Render'daki eski hesaplar ve parolaları **taşınmaz** (parola özeti biçimi farklı); hesaplar yeniden açılır.
- Fotoğraflar ve sürüş kayıtları veritabanında saklanır (disk yerine); veritabanı kotasını izle.
