# 🏨 Grand Stay - Otel Yönetim ve Resepsiyon Sistemi

Tek dosya mimarisiyle çalışan, sunucu gerektirmeyen modern otel ve pansiyon yönetim sistemi.

## 🚀 Başlıca Özellikler
- **Canlı Oda Takip Panosu:** 17+ oda yönetimi, tek tıkla durum (Boş, Dolu, Rezerve, Temizlikte) değiştirme.
- **Oda & Fiyat Yönetimi:** Yeni oda ekleme, silme, oda tipi ve gecelik fiyat düzenleme.
- **Müşteri Veritabanı:** T.C. / Pasaport No, telefon, e-posta, geçmiş konaklama sayısı ve özel notlar.
- **Akıllı Otomatik Tamamlama:** T.C. girildiğinde kayıtlı misafiri otomatik tanıma.
- **Finans & Dönemsel Ciro Raporları:** ADR (Ortalama Günlük Fiyat), RevPAR, gelir grafiği ve Excel (CSV) indirme.
- **Veritabanı & Yedek:** Tarayıcı hafızasında saklama, JSON yedeği alma ve geri yükleme.
- **Güvenlik & Giriş:** Giriş şifresi ve kullanıcı adı yönetimi.

## 💻 Kurulum & Çalıştırma
1. `index.html` dosyasına çift tıklayarak tarayıcınızda açın.

### Ağ Üzerinden (Wi-Fi / Çoklu Cihaz) Çalıştırma:
Ana bilgisayarda proje klasöründe şu komutu çalıştırabilirsiniz:
```bash
npx serve -l 8080
# veya Python ile:
python -m http.server 8080