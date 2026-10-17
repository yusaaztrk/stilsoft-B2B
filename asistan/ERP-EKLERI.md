# Asistan → ERP bağlantısı

## 2026-10-08 (3): asistanın OKUMA uçları (3. aşama — araçlar)

Asistan müşterinin kendi kayıtlarına bakarak taslak yazar. ERP ve Servis'e **ayrı, yalnız okuyan, anahtarlı** uçlar eklendi.
Kullanıcı oturumu yok; sunucudan sunucuya.

**ERP** — `backend/B2B.Erp.Api/Controllers/AsistanToolsController.cs` (yeni dosya):
- `GET /api/asistan-tools/balance?code=` — döviz başına bakiye. Hesap yeniden yazılmadı: Cari Ekstre ucu (`CustomerLedgerController.List`) ilk kapanmamış dönemle süreç içinde çağrılıyor. Lokalde 4 caride ekstreyle kuruşu kuruşuna aynı çıktı.
- `GET /api/asistan-tools/orders?codes=&q=` — son siparişler, faturalanma durumu (`InvoiceLines.SalesOrderLineId`), iptal (Status 9).
- `GET /api/asistan-tools/invoices?codes=&q=` — son satış/servis/iade faturaları (proforma, teklif, alış, depo transferi hariç).
- Kimlik: `[InternalApiKey("Asistan:InternalApiKey")]`, başlık `X-Internal-Key` + `X-Tenant-Code`. Anahtar yoksa 503 (kapalı).
- Ayar: ERP `appsettings.Local.json` → `"Asistan": { "InternalApiKey": "…" }` (örnek: `appsettings.Local.example.json`).

**Servis** — `service-ops/service-ops-api/ServiceOps.Api/`:
- `Controllers/AsistanToolsController.cs` (yeni): `GET /api/asistan-tools/records?phone=&codes=&q=` — servis ve montaj kayıtları. Telefonun son 10 hanesi (kayıt ya da montaj kalemi) **veya** bayi carisi (`DealerCode`, alt hesaplar dahil). Teknisyen notu, ücret, adres dönmez.
- `Filters/AsistanApiKeyAttribute.cs` (yeni): başlık `X-Asistan-Key` = `Asistan:InternalApiKey`. **`ServiceOps:InternalApiKey`'den ayrı**: o anahtar montaj açan/silen webhook'ları da açıyor, asistana verilmez.
- `ServiceOps.Application/Services/ServiceRecordService.cs`: `DeriveRecordState` ve `StateLabel` **public** yapıldı (yalnız görünürlük). Montaj durumu ekrandakiyle aynı kuraldan türesin diye — kaydın kendi durumu "Yeni kayıt" kalırken kalemler "Gerçekleşti" olabiliyor.
- Ayar: `appsettings.json`'a boş `Asistan:InternalApiKey` eklendi (kapalı); gerçek değer sunucuda `appsettings.Production.json`'a. Lokal deneme değeri `appsettings.Development.json`'da.

**Kapsam kuralı (ikisinde de):** cari kodlarını ve telefonu ASİSTAN SUNUCUSU verir (WhatsApp numarasının eşleştiği cariler).
Model yalnız isteğe bağlı belge numarası verebilir; o da bu kümenin içinde aranır. Deneme: başka numaradan "MNT-0000006 ne oldu" → kayıt dönmedi.

Bu uçlar anahtar tanımlanmadıkça kapalıdır (503); ERP/Servis paketine girmeleri zararsız.

## 2026-10-08 (2): giriş yetkisi KULLANICI BAZINDA

Kullanıcı kararı: "rol yetkisi değil; B2B Kullanıcılar sayfasında Servise giriş gibi açılsın".

- ERP'de `Users.AsistanAccess` kolonu var. Açılışta eklenir (Program.cs üç drift bloğu ve TenantProvisioningService).
- B2B → Kullanıcılar → kullanıcı düzenle → **"Asistan (WhatsApp)"** kutusu. Listede de sütun olarak görünür.
- Giriş yanıtında `asistanAccess` döner: süper yönetici rolü **ya da** kutu işaretli. B2B bunu localStorage'a yazar.
- Asistan girişte ve her istekte aynı kuralı ERP veritabanından okur (`PageAccess`).

Bu parçalar ERP koduna girdi ve zararsız: kutu işaretlenmedikçe ve asistan yayında olmadıkça hiçbir şey değişmez.
B2B'deki **"Asistan'a Geç"** düğmesi yine `VITE_ASISTAN_ENABLED=1` ile derlenmedikçe görünmez.

## Eski (geçersiz): sayfa yetkisi 5214

İlk sürümde giriş yetkisi Rol Yetkileri'ndeki `Pages` 5214 (`asistan/mesajlar`) satırıydı. **Kaldırıldı**; geri eklenmeyecek.
Lokal veritabanlarındaki 5214 satırları da silindi.
