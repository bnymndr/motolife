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
