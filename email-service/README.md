# B2B ERP - E-Posta Mikroservisi (Email Microservice)

Bu servis, B2B ERP platformu için tasarlanmış; Clean Architecture ve DDD prensiplerine uygun, PostgreSQL (EF Core) veritabanı loglama altyapısına sahip, RabbitMQ kuyruk yapısını kullanan ve çoklu kiracı (multi-tenant) destekleyen bağımsız bir e-posta mikroservisidir.

E-Ticaret sepet onayı sonrasında müşterilere otomatik olarak satın aldıkları ürünlerin kullanım kılavuzlarını mail ile iletmek üzere entegre edilmiştir.

---

## 🚀 Kurulum ve Çalıştırma (Docker Compose)

Mikroservisi veritabanı, mesaj kuyruğu (RabbitMQ) ve yerel e-posta arayüzü (Maildev) ile birlikte tek seferde ayağa kaldırmak için:

1. Terminalde `email-service` dizinine gidin:
   ```bash
   cd email-service
   ```
2. Docker servislerini derleyip arka planda çalıştırın:
   ```bash
   docker compose up -d --build
   ```

### Çalışan Servislerin Portları:
* **E-Posta Mikroservisi API**: `http://localhost:5250/swagger` (Swagger arayüzü)
* **Maildev (Test SMTP Arayüzü)**: `http://localhost:1080` (Gönderilen tüm test maillerini yakalayan yerel arayüz)
* **RabbitMQ Yönetim Paneli**: `http://localhost:15673` (Kullanıcı: `guest` / Şifre: `guest`)
* **PostgreSQL Veritabanı**: `5437` portu (`email_db` veritabanı)

---

## ⚙️ SMTP (E-Posta Sunucusu) Yapılandırması

Varsayılan olarak mailler yereldeki **Maildev** sunucusuna düşer. Gerçek bir SMTP sunucusu (örneğin **Gmail**) üzerinden gerçek mailler göndermek istiyorsanız:

1. **[docker-compose.yml](file:///c:/Users/excalibur/Desktop/B2B-ERP/email-service/docker-compose.yml)** dosyasını açın.
2. `email-service` servisi altındaki `environment` (çevre değişkenleri) bölümünü kendi SMTP/Gmail bilgilerinize göre düzenleyin:

```yaml
      # ─── REAL GMAIL SMTP CONFIGURATION ───
      - Smtp__Host=smtp.gmail.com
      - Smtp__Port=587
      - Smtp__Username=kendi-mail-adresiniz@gmail.com
      - Smtp__Password=google-hesabindan-alinan-16-haneli-uygulama-sifresi
      - Smtp__EnableSsl=true
      - Smtp__SenderName=B2B ERP E-Ticaret
      - Smtp__SenderEmail=kendi-mail-adresiniz@gmail.com
```

3. Kaydettikten sonra konteyneri yeniden yükleyin:
   ```bash
   docker compose up -d
   ```
   *Servis her yeniden başladığında docker-compose üzerindeki güncel SMTP ayarlarını veritabanı ile otomatik olarak senkronize eder.*

---

## 🔒 Güvenlik ve Kimlik Doğrulama

Mikroservisin REST API uçları API Key korumalıdır. Dışarıdan gelen HTTP isteklerinin başlığında (Header) şu anahtarın bulunması zorunludur:
* **Header Key**: `X-API-Key`
* **Header Value**: `B2B_ERP_EmailService_Default_Secret_API_Key_123!` (Geliştirme aşaması varsayılan anahtarı)

---

## 🔄 E-Ticaret Entegrasyon Akışı

1. **Sepet Onayı (Checkout)**: Müşteri sepeti onaylar, sipariş `PendingVirtualPos` ödeme durumuyla veritabanına kaydedilir.
2. **Ödeme Tamamlama**: Müşteri Sanal POS ekranında **Ödemeyi Tamamla** butonuna bastığında `/api/orders/complete-payment` API'si tetiklenir:
   * Sipariş durumu `"Processing"` ve ödeme durumu `"Paid"` olarak güncellenir.
   * Başarılı işlem `admin_payments` tablosuna kaydedilir.
   * Siparişteki ürünlerin kullanım kılavuzları (`ManualPdfUrl`) taranır.
   * Varsa kılavuz linkleri e-posta mikroservisine gönderilmek üzere kuyruğa (RabbitMQ) atılır.
3. **Arka Plan Tüketicisi (Consumer)**: E-Posta mikroservisindeki RabbitMQ tüketicisi mesajı yakalar, SMTP sunucusu (Gmail/Maildev) üzerinden güvenli ve şablonlu bir şekilde müşteriye ulaştırır.
