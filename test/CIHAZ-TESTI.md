# Gerçek cihaz testi (Aşama 5) — bu ortamda YAPILAMAZ, elle yapılır

Ölçüm aracı: `public/route-probe.js` (`mark` / `measure` / `report`). Bütçeler tahminidir.

## 1. Bluetooth HFP ↔ A2DP geçişi (kulaklık/interkom + telefon)
Cihazlar: en az 1 iPhone (Safari/PWA) + 1 Android (Chrome); kulaklık: motosiklet interkomu ve normal BT kulaklık.
1. Müzik çalarken (A2DP) telefona arama gelsin → `call_start` → müzik duruşu `music_paused` (bütçe ≤300 ms) → arama sesi duyulur `phone_audible` (≤1,5 sn).
2. Aramayı kapat → `call_end` → grup sesi `group_audible` (≤0,8 sn), müzik `music_audible` (≤1,5 sn). Kullanıcı hiçbir şeye dokunmamalı.
3. Her senaryoyu en az 10 kez tekrarla; `RouteProbe.report()` medyan ve en kötü değeri verir.
4. Kontrol: HFP'ye geçişte ses kalitesi düşer (normal, 8/16 kHz); aramadan sonra A2DP'ye dönmeyen cihaz var mı not al.
5. iOS: `<audio>.volume` salt okunur → ses seviyesi `setGain` (Web Audio) ile değişiyor mu? Ekran kilitliyken ses sürüyor mu?
## 2. Ağ kesintisi
Uçak modu aç/kapat ve gerçek tünel/köprü: oda düşünce `offline>reconnected` süresi (≤15 sn), geri çekilme aralıkları (0,5 → 10 sn), `window.online` olayında hemen deneme (`notifyOnline`). LiveKit'in kendi yeniden bağlanması (Reconnecting/Reconnected) ile bizim yeniden kurmamız çakışıyor mu?
## 3. Pil ve ısı (30 dk, aynı senaryo, ekran sabit parlaklık)
Senaryolar: (a) yalnız GPS, (b) grup + VAD sürekli, (c) grup + VAD görev döngüsü. Her birinde pil yüzdesi farkı, sıcaklık hissi/`thermal` (iOS/Android sistem ayarları), CPU (Chrome `chrome://inspect` → Performance / Safari Web Inspector → Timelines). `power-core.js` eşikleri (pil %20/%10, GPS aralıkları) buna göre ayarlanır.
## Sonuçları CLAUDE.md'ye yaz; ölçülmeyen değeri doldurma.

## 4. İnterkom yedeği (WebRTC mesh, LiveKit yokken)
1. Hostingte LIVEKIT_* boşken iki telefonla aynı gruba katıl; sayfada «doğrudan (P2P)» yazmalı. Bağlanma süresi, iki yönlü ses, konuşan adı.
2. Biri mobil veri, biri Wi‑Fi: bağlanıyor mu? Bağlanmıyorsa TURN gerekir (`GV_TURN_*`) — sonucu not al.
3. Üçüncü/dördüncü telefon: ses kalitesi ve pil. Aynı hesapla ikinci cihaz: eskisi kapanmalı.
4. Ekran kilidi / arka plan: ses sürüyor mu (PWA sınırı).

## 5. Grup interkom odası (iki-üç gerçek telefon)
1. Telefon A: Sosyal › Gruplarım › grup › İnterkom › oda adı + şifre › Oda Kur. Telefon B ve C: aynı ad+şifre › Odaya Katıl. (Yanlış şifre reddedilmeli.)
2. Üç telefonda mikrofonu aç/kapat; konuşan avatarı yeşil yanmalı, ses gelmeli (mobil veride de dene → TURN gerekebilir).
3. A (lider): B'nin ses kaydırıcısını kıs → C'nin B'yi kısık duyduğunu doğrula; B'yi Sustur → B'nin mikrofonu kapanmalı, düğmesi pasif olmalı; B'yi At → B sesten düşmeli, doğru şifreyle giremeyip davet beklemeli; Davet Et → B'ye bildirim.
4. A: radyo paylaş → B ve C'de aynı kanal çalmalı; YouTube bağlantısı paylaş; müzik dosyası paylaş (B/C'de liderden akmalı, iPhone dahil). B «Liderin yayınını dinle»yi kapatsın: interkom sürmeli; B Harita › ♪'dan kendi müziğini açsın.
5. A odadan ayrılsın: liderlik en eski katılımcıya geçmeli, oda ve şifre sürmeli. Herkes çıkınca oda silinmeli.
6. Ekranı kilitle / başka uygulamaya geç: ses ne kadar sürüyor not al.

## 6. Çoklu oda + Sürüş Başlat (üç gerçek telefon)
1. A: İnterkom ve Sürüş › Yeni Oda Kur; B de başka bir oda kursun → listede iki oda, kalan süre ~24 sa görünmeli. C bir odaya şifreyle girsin.
2. iPhone'da odaya gir, lider radyo/YouTube paylaşsın: ham İngilizce hata çıkmamalı; ses gelmezse «Sesi Başlat»a dokununca başlamalı.
3. A (lider) Sürüş Başlat sekmesi › Grup Sürüşünü Başlat: herkeste «Sürüş numaranı yaz» çıkmalı. Aynı numarayı iki kişi yazsın → ikincisi reddedilmeli. Boş bırakan ilk boş numarayı almalı.
4. Herkes Haritada Aç: ana ekrandaki sürüş sistemi çalışmalı (yol, hız, ort. hız, mesafe); diğer sürücüler numaralı işaretle hareket etmeli (gecikmeyi not al; PHP'de ~2,5 sn).
5. Sürüş sürerken interkom (İnterkom Odası sekmesi) kesilmemeli. Lider Sürüşü Bitir → herkesin paylaşımı durmalı.
6. Oda 24 saat dolunca (gerekirse sunucuda `exp` küçültülerek) herkes odadan düşmeli, oda listeden kalkmalı.
