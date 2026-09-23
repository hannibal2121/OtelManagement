# Mesoft Bilişim — Otel Yönetim Sistemi v7.0

Küçük ve orta ölçekli oteller için resepsiyon, rezervasyon, folyo/tahsilat, kasa ve raporlama uygulaması.
Ana bilgisayarda masaüstü uygulaması olarak çalışır; aynı ağdaki telefon, tablet ve bilgisayarlar tarayıcıdan bağlanır.

## v7'de neler değişti (özet)

| Alan | v6 | v7 |
|---|---|---|
| Veri yazma | Her değişiklikte tüm DB silinip yeniden yazılıyordu (çoklu cihazda veri kaybı riski) | Kayıt bazlı işlemler, transaction, revizyon sayacı ile anlık senkron |
| Güvenlik | Şifre düz metin, API açık, `nodeIntegration` açık | scrypt hash, oturum token'ı, rol (Yönetici/Resepsiyonist), rate-limit, `contextIsolation`, CSP, XSS kaçışlama |
| Çakışma | Yeni rezervasyonda kontrol yoktu | Sunucu tarafında çakışma kontrolü (isteğe bağlı overbooking) |
| Ödemeler | Tek "ön ödeme" alanı | Ödeme tablosu: kapora/tahsilat/iade, nakit/kart/havale, bölünmüş ödeme, kasa raporu |
| Fiyat | Kişi başı × gece | Oda bazlı veya kişi başı mod, ek kişi, çocuk katsayısı, hafta sonu ve sezon çarpanları |
| Durumlar | Rezerve/Dolu/Tamamlandı | + İptal, No-Show, oda temizlik (housekeeping) durumu |
| Offline | Tailwind/FontAwesome/Inter CDN'den | Yerel derlenen varlıklar, internet gerekmez |
| Yedek | `copyFileSync` (WAL ile tutarsız), sabit `C:\OTEL\YEDEK` | `VACUUM INTO` ile tutarlı yedek, kullanıcı klasörü + isteğe bağlı ek klasör, eski yedek temizliği |
| Güncelleme | UI vardı, arka plan yoktu | electron-updater bağlı |
| Diğer | 3 tanımsız fonksiyon, UTC tarih hataları | Bugün ekranı, KBS CSV, iCal içe/dışa aktarım, fiş yazdırma, işlem günlüğü, kullanıcı yönetimi |

## Kurulum (geliştirici / ilk kurulum)

Gereksinim: Node.js 18+ (LTS önerilir), Windows için Visual Studio Build Tools (sqlite3 native modülü için; `npm install` genelde önceden derlenmiş binary indirir).

```bash
npm install          # bağımlılıkları kurar, ardından otomatik olarak offline varlıkları derler
npm start            # masaüstü uygulamasını başlatır
```

`npm install` sonunda `postinstall` adımı şu işleri yapar:
- `scripts/prepare-assets.js` → Font Awesome dosyalarını `assets/fontawesome/` altına kopyalar
- `tailwindcss` → `assets/tailwind.css` üretir

Bu iki dosya yoksa arayüz CDN'e düşer (internet gerekir) ve konsola uyarı yazar. `npm run build:assets` ile yeniden üretebilirsiniz.

### Windows kurulum paketi üretme

1. `build/icon.ico` dosyasını ekleyin (256×256 içeren çok boyutlu .ico).
2. `package.json` → `build.publish[0].url` alanına güncelleme dosyalarını barındıracağınız HTTPS adresini yazın (basit bir statik dosya sunucusu yeter: `latest.yml` + `.exe`).
3. `npm run dist` → `release/` klasöründe NSIS kurulum ve portable exe oluşur.

Güncelleme sunucusunu kullanmayacaksanız `publish` bloğunu silin; uygulama güncelleme kontrolünü sessizce geçer.

### Sunucu olarak çalıştırma (Electron'suz)

Linux/NAS üzerinde yalnızca API + web arayüzü:

```bash
MESOFT_DATA=/var/lib/mesoft MESOFT_PORT=8080 npm run server
```

## İlk giriş

- Kullanıcı: `admin` — Şifre: `1234`
- İlk girişte şifre değiştirme zorunludur.
- **Kullanıcılar** menüsünden resepsiyonistler ekleyin. Resepsiyonist: rezervasyon, giriş/çıkış, tahsilat, minibar, temizlik. Yönetici: bunlara ek olarak raporlar, fiyatlar, ayarlar, kullanıcılar, silme işlemleri.

## v6'dan geçiş

Uygulama eski veritabanını ilk açılışta otomatik olarak v7 şemasına taşır:
- `settings.config` içindeki yönetici bilgisi → hash'lenmiş `users` kaydı (aynı kullanıcı adı/şifre ile giriş yapılır)
- `advancePayment` / `collectedTotal` → `payments` tablosu
- Oda üzerindeki minibar JSON'u → aktif rezervasyonun `minibar_items` kayıtları
- INTEGER oda numaraları → TEXT

Geçişten **önce** mevcut `.db` dosyasının bir kopyasını alın. Veri konumu:
`%APPDATA%\MesoftOtelYonetim\mesoft_otel.db` (v6'da `%APPDATA%\OtelYonetim\`). v6 verisini taşımak için eski dosyayı yeni klasöre `mesoft_otel.db` adıyla kopyalayın **veya** eski uygulamadan JSON yedeği alıp v7'de "JSON İçe Aktar" ile yükleyin (v6 formatı desteklenir).

## Ağ / çoklu cihaz

- **Ağ & Cihazlar** menüsü ana bilgisayarın IP adreslerini listeler: `http://192.168.x.x:8080`
- Windows Güvenlik Duvarı ilk açılışta sorarsa "Özel ağlarda izin ver" seçin. Sormazsa: Gelen Kurallar → Yeni Kural → Port → TCP 8080 → Özel.
- Ana bilgisayara sabit IP verilmesi önerilir.
- Pencere kapatılırken "Arka planda çalış" seçilirse uygulama sistem tepsisine küçülür ve diğer cihazlar bağlı kalır.
- Port çakışmasında `MESOFT_PORT` ortam değişkeni ile farklı port verilebilir.

## Yedekleme

- Her gece 03:00'te `%APPDATA%\MesoftOtelYonetim\yedekler\` altına tutarlı `.db` yedeği alınır; `backup_keep_days` (varsayılan 30) günden eski yedekler silinir.
- **Otel Ayarları → Ek yedek klasörü** ile USB/ağ sürücüsüne ikinci kopya yazılır.
- **Yedek & Veritabanı → Şimdi Yedekle** anlık yedek alır. JSON dışa/içe aktarma taşınabilir tam yedektir.
- Geri yükleme: uygulamayı tamamen kapatın, yedek `.db` dosyasını `mesoft_otel.db` adıyla veri klasörüne kopyalayın (varsa `-wal`/`-shm` dosyalarını silin), uygulamayı açın.

## KBS (Kimlik Bildirim) ve iCal

- **Raporlar → KBS Bildirim (CSV)**: seçilen günde konaklayan tüm misafirleri (kimlik no, uyruk, doğum tarihi, giriş/çıkış) noktalı virgülle ayrılmış CSV olarak verir. Rezervasyon formundaki doğum tarihi/uyruk alanlarını doldurmanız kaliteli bildirim için gereklidir. CSV, KBS portalının toplu yükleme şablonuna göre Excel'de yeniden sıralanabilir.
- **Odalar & Fiyatlar → iCal**: Booking/Airbnb'den aldığınız `.ics` dosyasını odaya yükleyin; dolu tarihler "Rezerve" olur (aynı UID tekrar yüklenmez, çakışanlar atlanır). "Odanın .ics dosyasını indir" ile kendi doluluğunuzu platforma verebilirsiniz. Otomatik URL senkronu (periyodik çekme) bu sürümde yoktur; ihtiyaç halinde sunucu tarafına zamanlayıcı eklenebilir.

## Fiyatlandırma

- **Oda bazlı**: baz fiyat + kapasite üstü her yetişkin için ek kişi ücreti + çocuk × katsayı × ek kişi ücreti
- **Kişi başı**: baz fiyat × (yetişkin + çocuk × katsayı)
- Hafta sonu çarpanı ve sezon aralıkları (MM-GG, yıl sınırını aşabilir: 12-20 → 01-05) her geceye ayrı uygulanır.
- Rezervasyon formunda hesaplanan tutar elle değiştirilebilir (indirim/pazarlık).

## Proje yapısı

```
main.js              Electron ana süreç: pencere, tepsi, updater, zamanlı yedek
preload.js           contextBridge (window.mesoft)
server.js            HTTP API + statik sunum; iş mantığı burada (Electron'dan bağımsız)
db.js                SQLite katmanı, şema, migrasyon, yedek
server-standalone.js Electron'suz çalıştırma
index.html / app.js  Arayüz (masaüstü ve tarayıcı aynı kodu kullanır)
src/input.css        Tailwind kaynağı → assets/tailwind.css
scripts/             Varlık hazırlama
build/icon.ico       (eklenmeli)
```

## API kısa referans

Tüm uç noktalar `Authorization: Bearer <token>` ister (`/api/login`, `/api/health` hariç).

`POST /api/login` · `GET /api/state` · `GET /api/revision` · `POST /api/quote` ·
`POST/PUT/DELETE /api/rooms[/:id]` · `POST /api/rooms/:id/status|clean` ·
`POST /api/reservations` · `PUT /api/reservations/:id` · `POST /api/reservations/:id/checkin|checkout|cancel|noshow|minibar` ·
`POST /api/payments` · `PUT /api/guests/:key` · `PUT /api/settings` · `POST/PUT/DELETE /api/users` ·
`POST /api/backup` · `GET /api/export?type=json|kbs|ical` · `POST /api/import` · `GET /api/audit`

## Bilinen sınırlar / yol haritası

- Tek SQLite dosyası: tek lokasyon ve ~10 eşzamanlı cihaz için uygundur. Çok şubeli yapı için PostgreSQL'e geçiş ayrı bir çalışma gerektirir (server.js katmanı bunu kolaylaştırır).
- Lisanslama/aktivasyon yoktur.
- iCal periyodik URL çekme yoktur (dosya yükleme vardır).
- Tarayıcı istemcisinde yazdırma, tarayıcının yazdırma diyaloğunu kullanır; 72 mm fiş şablonu `#printArea` içindedir.
