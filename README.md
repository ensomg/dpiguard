# 🛡️ DPIGuard Turkey

**Türkiye'deki internet kısıtlamalarını (DPI) hız kaybı yaşamadan aşmak için geliştirilmiş, şık ve güçlü bir Electron tabanlı masaüstü uygulaması.**

![License](https://img.shields.io/github/license/username/repo?style=flat-square)
![Electron](https://img.shields.io/badge/Electron-33.0.0-blue?style=flat-square&logo=electron)
![Platform](https://img.shields.io/badge/Platform-Windows-0078d7?style=flat-square&logo=windows)

DPIGuard, **VPN değildir.** İnternet trafiğinizi uzak bir sunucuya yönlendirmek yerine, yerel makinenizde paket parçalama (DPI Bypass) tekniklerini kullanarak sansür mekanizmalarını etkisiz hale getirir. Bu sayede internet hızınızda **sıfır kayıp** ile özgürce gezinebilirsiniz.

---

## ✨ Özellikler

-   🚀 **Hız Kaybı Yok:** Trafiği şifreleyip uzak sunucuya göndermez, sadece paket başlıklarını manipüle eder.
-   ⚡ **ISP Presets:** Türk Telekom, Superonline, TurkNet, Vodafone ve Kablonet için optimize edilmiş tek tıkla kurulum.
-   🔒 **Secure DNS (DoH):** DNS hijacking (DNS zehirlenmesi) saldırılarını engellemek için DNS over HTTPS desteği.
-   📊 **Dahili Hız Testi:** Bağlantı durumunuzu ve hızınızı uygulama içerisinden anlık test edin (Cloudflare İstanbul PoP).
-   🛡️ **Akıllı Yönetici Modu:** Gerekli ağ izinleri için otomatik olarak yönetici yetkisi ister.
-   🌙 **Modern Arayüz:** Karanlık mod destekli, minimal ve kullanıcı dostu tasarım.
-   📥 **Otomatik Kurulum:** Gerekli motor dosyalarını (GoodbyeDPI) tek tıkla otomatik indirir ve kurar.

---

## 🛠️ Nasıl Çalışır?

Türkiye'deki internet servis sağlayıcıları (ISS), **Deep Packet Inspection (DPI)** teknolojisini kullanarak hangi siteye gittiğinizi kontrol eder. DPIGuard (GoodbyeDPI motorunu kullanarak):

1.  Giden paketlerin SNI (Server Name Indication) kısmını böler.
2.  ISP'nin filtreleme sistemleri bölünmüş paketleri tanıyamaz ve geçişine izin verir.
3.  Uygulama ayrıca sistem DNS'inizi güvenli sağlayıcılara (Cloudflare, Google vb.) yönlendirerek engelleri tam anlamıyla aşar.

---

## 🚀 Kurulum & Çalıştırma

### Geliştiriciler İçin
1.  Projeyi klonlayın:
    ```bash
    git clone https://github.com/kullaniciadi/dpiguard-turkey.git
    cd dpiguard-turkey
    ```
2.  Bağımlılıkları yükleyin:
    ```bash
    npm install
    ```
3.  Uygulamayı başlatın:
    ```bash
    npm start
    ```

### Son Kullanıcılar İçin
[Releases](https://github.com/kullaniciadi/dpiguard-turkey/releases) sayfasından `.exe` veya `.zip` dosyasını indirin ve çalıştırın.

---

## ⚙️ Yapılandırma Seçenekleri

| Mod | Açıklama |
| :--- | :--- |
| **Standart** | Çoğu ISS için ideal (TTL 5 manipülasyonu). |
| **Superonline** | Fiber hatlarda kullanılan agresif filtreleme için özel ayar. |
| **Agresif** | En katı kısıtlamaların olduğu bölgeler için maksimum paket parçalama. |
| **TTL'siz** | Bazı sitelerde bağlantı sorunu yaşanırsa kullanılan mod. |

---

## ⚠️ Önemli Notlar

-   **Antivirüs:** Bazı antivirüs yazılımları ağ paketlerine müdahale edildiği için uyarı verebilir. Bu durum uygulamanın çalışma doğası gereğidir.
-   **Yönetici İzni:** Ağ sürücülerine (WinDivert) erişim için uygulama **Yönetici** olarak çalışmalıdır.

---

## 🙏 Teşekkürler

-   [GoodbyeDPI](https://github.com/ValdikSS/GoodbyeDPI) (ValdikSS)
-   [GoodbyeDPI-Turkey](https://github.com/cagritaskn/GoodbyeDPI-Turkey) (cagritaskn)
-   [WinDivert](https://github.com/basil00/WinDivert)

---

## ⚖️ Lisans

Bu proje **MIT Lisansı** ile lisanslanmıştır. Eğitim ve araştırma amaçlıdır.
