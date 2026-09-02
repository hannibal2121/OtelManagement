# Mesoft Bilişim - Otel Yönetim Sistemi (v6.0)

Mesoft Bilişim Otel Yönetim Sistemi; küçük ve orta ölçekli otellerin rezervasyon, oda durumu, müşteri veritabanı, ciro raporlama ve çoklu cihaz (ağ üzerinden) yönetim ihtiyaçlarını tek bir ekranda karşılamak için geliştirilmiş web tabanlı ve Electron destekli masaüstü otel yönetim yazılımıdır.

## 🚀 Öne Çıkan Özellikler

* **Oda Durum Panosu:** Odaların boş, dolu veya arızalı/tadilatta olma durumlarını renkli kartlarla anlık takip.
* **Sürükle-Bırak (Gantt) Takvim:** Aylık genel görünüm ekranında rezervasyon kutucuklarını fareyle tutup başka tarihlere veya odalara kolayca taşıyabilme.
* **Otomatik IP Algılama & Ağ Paylaşımı:** Aynı Wi-Fi/Yerel ağdaki diğer cihazlardan (telefon, tablet, ek bilgisayarlar) tarayıcı üzerinden ana makineye bağlanabilme ve IP adresini ekranda tek tuşla kopyalayabilme.
* **Gelişmiş Rezervasyon & Müşteri Veritabanı:** Otomatik ilk müsait tarihi bulma, çoklu misafir kaydı, T.C./Telefon ile akıllı müşteri arama ve tam geçmiş takibi.
* **Ciro & Dönemsel Raporlar:** Oda konaklama ve minibar gelirlerini ayrı ayrı filtreleyebilme, verileri Excel (CSV) formatında dışa aktarabilme.
* **Güvenli SQLite / WAL Mimari:** Çoklu cihaz erişimlerinde çakışmaları ve kilitlenmeleri önleyen WAL (Write-Ahead Logging) moduna sahip merkezi veritabanı altyapısı.
* **Otomatik Yedekleme:** Her gece saat 03:00'te günlük veritabanı yedeklemesi ve manuel JSON yedekleme desteği.

---

## 💻 Kurulum ve Çalıştırma Adımları

Projeyi bilgisayarınızda kurmak ve çalıştırmak için kullanmanız gereken tüm komutlar aşağıdadır:

1. **Bağımlılıkları Yükleme Komutu:**
   Projeyi klonladıktan veya klasörü açtıktan sonra terminalde gerekli paketleri yüklemek için çalıştırın:
   ```bash
   npm install

   Uygulamayı Başlatma (Masaüstü + Web Sunucusu):
Uygulamayı Electron penceresi ve 8080 portunda yerel ağ sunucusu ile birlikte başlatmak için:

npm start

(Not: npm run share komutu da alternatif olarak aynı başlatma işlevini görmektedir.)

Diğer Cihazlardan (Telefon/Tablet) Bağlanma:

Uygulama içindeki üst menüden "Ağ Paylaşımı" butonuna tıklayın.

Ekranda otomatik beliren size özel yerel IP adresini (Örn: http://192.168.1.50:8080) kopyalayın.

Aynı Wi-Fi ağına bağlı telefon veya tabletinizin tarayıcısına bu adresi yapıştırarak sisteme giriş yapın.

Uygulama Paketleme (Kurulum Dosyası Oluşturma)
Windows için kuruluma hazır .exe (NSIS) veya taşınabilir (Portable) dağıtım dosyaları üretmek için şu komutları kullanabilirsiniz:

Kurulum Dosyası (Setup .exe) Üretme:

Bash
npm run dist
Taşınabilir (Portable) Sürüm Üretme:

Bash
npm run dist:portable
Oluşan tüm kurulum dosyaları proje dizini altındaki release klasörüne kaydedilir.

🛠️ Teknolojiler
Frontend: HTML5, Tailwind CSS, FontAwesome, JavaScript (Vanilla)

Backend / Desktop: Node.js, Electron, HTTP Server

Veritabanı: SQLite3 (WAL Modu)

© 2026 Mesoft Bilişim. Tüm hakları saklıdır.

