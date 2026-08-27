# 🏨 Grand Stay - Otel Yönetim ve Resepsiyon Sistemi

Tek dosya mimarisiyle çalışan, sunucu gerektirmeyen modern otel ve pansiyon yönetim sistemi.

## 🚀 Başlıca Özellikler
- **Canlı Oda Takip Panosu:** 17+ oda yönetimi, tek tıkla durum (Boş, Dolu, Rezerve) değiştirme.
- **Oda & Fiyat Yönetimi:** Yeni oda ekleme, silme, oda tipi ve gecelik fiyat düzenleme.
- **Müşteri Veritabanı:** T.C. / Pasaport No, telefon, e-posta, geçmiş konaklama sayısı ve özel notlar.
- **Akıllı Otomatik Tamamlama:** T.C. girildiğinde kayıtlı misafiri otomatik tanıma.
- **Finans & Dönemsel Ciro Raporları:** Gelir grafiği ve Excel (CSV) indirme.
- **Veritabanı & Yedek:** Masaüstü modunda kalıcı dosya tabanlı depolama, JSON yedeği alma/geri yükleme, otomatik rotasyonlu yedekleme (masaüstü ve web modu için).
- **Aylık Genel Görünüm:** Tüm odaların 1 aylık doluluk matrisi; güne fare ile gelince oda/misafir bilgisi.
- **Otomatik Güncelleme:** Yeni sürüm yayınladığınızda, kullanıcı uygulamayı açıkken arka planda indirilir ve tek tıkla kurulur (bkz. aşağıda).
- **Güvenlik & Giriş:** Giriş şifresi ve kullanıcı adı yönetimi.

## 💻 Kurulum & Çalıştırma

### Önerilen Yöntem: Masaüstü Uygulaması (Electron)
```bash
npm install       # ilk kurulumda bir kere
npm start         # electron . komutunu çalıştırır
```

### Alternatif: Tek Başına Tarayıcıda Açma
`index.html` dosyasına çift tıklayarak açabilirsiniz. Bu modda veriler tarayıcının `localStorage`'ında tutulur. Web modu otomatik yedekleme de mevcuttur (bkz. "Veritabanı & Yedek" ekranı).

### Ağ Üzerinden (Wi-Fi / Çoklu Cihaz) Çalıştırma:
```bash
npx serve -l 8080
```

---

## 🔒 Veri Depolama & Güncelleme Rehberi

### Veriler nerede saklanıyor?
Masaüstü uygulamasında (Electron) veriler `GrandStayOtelYonetim` adlı sabit bir klasörde tutulur:

| İşletim Sistemi | Konum |
|---|---|
| Windows | `%APPDATA%\GrandStayOtelYonetim\grandstay-veritabani.json` |
| macOS | `~/Library/Application Support/GrandStayOtelYonetim/grandstay-veritabani.json` |
| Linux | `~/.config/GrandStayOtelYonetim/grandstay-veritabani.json` |

Bu klasör uygulama dosyalarından (`index.html`, `main.js`, `package.json`) tamamen bağımsızdır; dolayısıyla güncelleme sırasında (manuel veya otomatik) veri kaybı yaşanmaz.

---

## 🔄 Otomatik Güncelleme Sistemi (YENİ)

Artık uygulama, kendi web adresiniz (**https://mesoftbilisim.net**) üzerinden **otomatik güncelleme** desteğine sahip. Kullanıcılar uygulamayı açıkken yeni bir sürüm varsa arka planda indirilir ve kullanıcıya küçük bir bildirimle ("Güncelleme hazır, tıkla ve yeniden başlat") sunulur.

### Nasıl Çalışır?
1. Uygulama açıldığında (5 saniye sonra) ve sonrasında her 4 saatte bir, `https://mesoftbilisim.net/grandstay-updates/latest.yml` dosyası kontrol edilir.
2. `latest.yml`'deki sürüm numarası, kullanıcının çalıştırdığı sürümden daha yeniyse, ilgili `.exe` dosyası **arka planda otomatik indirilir**.
3. İndirme tamamlanınca sağ üstte yeşil bir bildirim belirir: *"Güncelleme hazır (vX.X.X). Yeniden başlatmak için tıklayın."*
4. Kullanıcı bildirime tıklayınca uygulama kapanır, yeni sürüm otomatik kurulur ve tekrar açılır.

### 📤 Yeni Bir Sürüm Nasıl Yayınlanır? (Sizin İçin Adımlar)

**1. Sürüm numarasını artırın**

`package.json` içinde:
```json
"version": "5.4.0"
```
→ örn. `5.5.0` yapın.

**2. Kurulum dosyasını (.exe) ve güncelleme meta verisini üretin**
```bash
npm run dist
```
Bu komut `release/` klasöründe şu dosyaları oluşturur:
- `Grand Stay Otel Yonetim-Kurulum-5.5.0.exe` (tam kurulum dosyası)
- `Grand Stay Otel Yonetim-Kurulum-5.5.0.exe.blockmap` (hızlı/artımlı indirme için)
- `latest.yml` (güncelleme kontrol dosyası — **en kritik dosya**)

**3. Bu 3 dosyayı web sunucunuza yükleyin**

`https://mesoftbilisim.net/grandstay-updates/` adresine (cPanel Dosya Yöneticisi, FTP veya SSH ile) şu üç dosyayı kopyalayın:
- `latest.yml`
- `Grand Stay Otel Yonetim-Kurulum-5.5.0.exe`
- `Grand Stay Otel Yonetim-Kurulum-5.5.0.exe.blockmap`

> ⚠️ **Çok önemli:** `latest.yml` dosyasının **eski sürümün üzerine yazılması** gerekir — yani her yeni sürümde bu dosyanın içeriği güncellenmeli. Eski `.exe` dosyalarını silmenize gerek yok ama silmek isterseniz sorun olmaz (yalnızca `latest.yml`'de belirtilen dosya adı sunucuda mevcut olmalı).

**4. Doğrulama**

`latest.yml` içindeki `path:` alanının, yüklediğiniz `.exe` dosyasının adıyla **birebir eşleştiğinden** emin olun. Eşleşmezse kullanıcılar güncelleme bildirimini görür ama indirme "404 Not Found" hatasıyla başarısız olur (sessiz bir hata gibi görünür, güncellemenin "yavaş" olduğu sanılır).

**5. Test**

Sürüm numarası eski olan bir kurulumu açık tutup birkaç dakika bekleyin (veya uygulamayı yeniden başlatın) — sağ üstte güncelleme bildirimi belirmelidir.

### Sunucu Gereksinimleri
- `https://mesoftbilisim.net/grandstay-updates/` yolunun **herkese açık, HTTPS üzerinden erişilebilir** bir statik dosya klasörü olması yeterlidir (özel bir sunucu yazılımına gerek yoktur — düz dosya barındırma yeterli).
- Klasörün "directory listing" (dizin listeleme) açık olmasına gerek yoktur; dosyalar doğrudan URL ile erişilebilir olmalı.

### Otomatik Yedekleme (Masaüstü ve Web Modu)
Her kayıt işleminde (en fazla 5 dakikada bir) veri dosyasının bir kopyası otomatik alınır, son 20 yedek saklanır. Detaylar için uygulama içindeki **"Veritabanı & Yedek"** ekranına bakın.

---

## 📦 Tek Tıkla Kurulum Dosyası (.exe) Oluşturma

```bash
npm install
npm run dist            # Windows kurulum + portable + latest.yml
npm run dist:portable   # Sadece taşınabilir .exe
npm run dist:mac        # macOS (.dmg)
npm run dist:linux      # Linux (.AppImage)
```
Üretilen dosyalar `release/` klasöründe oluşur. `build/icon.ico` ve `build/icon.png` uygulama simgesini belirler.
