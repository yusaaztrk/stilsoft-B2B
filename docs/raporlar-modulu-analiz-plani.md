# Raporlar Modülü — Analiz ve Uygulama Planı

> Durum: **analiz aşaması, kod değiştirilmedi.** Bu belge onaylandıktan sonra uygulamaya geçilecek.
> Kapsam: `service-ops` (ServiceOps) raporlama modülü. Operasyonel akışlara dokunulmaz.

---

## 0. Yöntem ve en kritik bulgu

Önce şema değil, **şemayı gerçekten kimin doldurduğu** incelendi. Bir kolonun var olması o
kolonun dolu olduğu anlamına gelmiyor ve bu modülde bunun üç ciddi örneği var:

| Alan | Şemada | Yazan kod | Sonuç |
|---|---|---|---|
| `ServiceRecord.WorkshopTechnicianId` | ✅ var (migration `20260807000000`) | ❌ **hiçbir yerde yazılmıyor** | "Atölyede kim çalıştı" bu kolondan çıkmaz |
| `WorkOrder.StartedAt / CompletedAt / ActualDuration / LaborCost / PartsCost / Diagnosis / Solution` | ✅ var | ❌ yalnızca `serviceId, technicianId, scheduledDate, description` yazılıyor (`ServisFisiModal.tsx:126`) | İş emri süresi/maliyeti **yok** |
| `InventoryUsage` (servis ↔ kullanılan parça) | ✅ tablo var | ❌ **hiçbir yerde satır eklenmiyor** | "Bu serviste şu parça kullanıldı" verisi **yok** |

Bu üç bulgu, talebindeki bazı raporların bugünkü veriyle **matematiksel olarak üretilemeyeceği**
anlamına geliyor. Aşağıda C bölümünde tek tek listelendi. Uydurma metrik üretilmedi.

---

## A. Mevcut veri modeli

ServiceOps **firma başına ayrı veritabanı** kullanıyor (`TenantConnectionStringResolver`), yani
rapor sorgularında ayrıca firma filtresi gerekmiyor — bağlantı zaten o firmaya ait.
`ServiceRecords` üzerinde global soft-delete filtresi var (`HasQueryFilter(e => !e.IsDeleted)`),
dolayısıyla silinen kayıtlar raporlara kendiliğinden girmez.

### A.1 `ServiceRecord` — sistemin merkezi tablosu

Montaj, büyük ürün arızası ve küçük ürün arızası **aynı tabloda** tutuluyor; ayrım iki alanla
yapılıyor:

- `Type`: `Repair(0) | Installation(1) | Maintenance(2) | Warranty(3)`
- `ProductCategory`: `Large(0) | Small(1)`

Yani: **Montaj** = `Type=Installation`; **Büyük ürün arıza** = `Type=Repair & Category=Large`;
**Küçük ürün arıza** = `Type=Repair & Category=Small`.

| Grup | Alanlar |
|---|---|
| Kimlik | `Id`, `ServiceNumber`, `Status`, `Type`, `ProductCategory`, `Priority` |
| Tarihler | `CreatedAt`, `UpdatedAt`, `CompletedAt`, `PlannedAt`, `EstimatedDeliveryDate`, `RouteDate`, `PlannedStartTime`, `PlannedEndTime` |
| Bayi | `DealerId` (FK), `DealerCode` (B2B cari kodu), `DealerName`, `DealerPhone`, `DealerAddress` |
| Müşteri | `CustomerId` (FK, nullable), `CustomerName/Phone/Email/Address`, `Latitude`, `Longitude` |
| Ürün | `ProductName`, `ProductStockCode`, `ProductModel`, `SerialNumber`, `Barcode`, `IsUnderWarranty`, `PurchaseDate` |
| Teknisyen | `AssignedTechnicianId`, `WorkshopTechnicianId`*, `DeliveryTechnicianId`, `CompletedByTechnicianId`, `TechnicianId` (rota) |
| Bölge | `RegionId` (FK) |
| Tutar | `ServiceCost`, `PartsCost` |
| Memnuniyet | `SatisfactionScore`, `SatisfactionNotes`, `SatisfactionBy`, `SatisfactionCreatedAt` |
| Fatura | `InvoiceReference`, `IsInvoiced` |
| Silme | `IsDeleted`, `DeletedAt`, `DeletedBy` |

`*` yazılmıyor — bkz. bölüm 0.

**`ServiceStatus` (16 değer):** `New(0)`, `Workshop(1)`, `InRepair(2)`, `WaitingForParts(3)`,
`Ready(4)`, `Delivered(5)`, `Cancelled(6)`, `Delayed(7)`, `Planned(8)`, `FieldPlanned(9)`,
`InDelivery(10)`, `SmallProductAcceptance(11)`, `WorkshopReady(12)`, `DeliveryPlanning(13)`,
`FieldCompleted(14)`, `LargeProductPlanning(15)`.

> Rapor tanımı gereği: **Tamamlanan** = `Delivered` + `FieldCompleted`; **İptal** = `Cancelled`;
> **Devam eden** = `InRepair`, `InDelivery`, `Workshop`; **Bekleyen** = geri kalanlar.
> Bu eşleme raporun tek yerinde tanımlanıp her sorguda aynı kullanılacak.

### A.2 `ServiceRecordItem` — montaj kalemleri
`ServiceId`, `ProductName`, `ProductStockCode`, `SerialNumber`, `Quantity`, `SortOrder`,
`ExternalRef`, kalem bazlı `CustomerName/Phone/Address`, `CreatedAt/UpdatedAt`.
**Adet bazlı ürün analizinin tek doğru kaynağı burası** — kayıt düzeyinde `ProductName` tek
üründür, oysa bir kabul kaydında birden çok ürün olabilir.

### A.3 `InstallationTask` — sistemdeki en zengin süre verisi
`ServiceId`, `ServiceRecordItemId`, `AssignedTechnicianId`, `Status`
(`Planned|InProgress|Completed|Cancelled|Deferred`), `Quantity`, `EstimatedDurationMinutes`,
`Priority`, `CustomAddress` ve **dört ayrı zaman damgası**:
`PlannedAt` → `TransferredAt` (sahaya aktarım) → `StartedAt` (fiilen başlama) → `CompletedAt`.

Montaj tarafındaki bütün süre analizleri bu tablodan gerçek veriyle çıkar.

### A.4 `Activity` — durum geçiş defteri
`ServiceId`, `Type` (`System|Assigned|Planned|StatusChanged|NoteAdded|WorkLogged|PhotoUploaded|Cancelled`),
`Payload` (JSON: `field/oldValue/newValue/reason/metadata`), `ActorUserId/ActorUserName`,
`ActorTechnicianId/ActorTechnicianName`, `CorrelationId`, `CreatedAt`.

`ServiceRecordService` ve `InstallationsController` durum değişimlerinde buraya yazıyor.
**Aşama süreleri ve "bu geçişi kim yaptı" bilgisinin tek kaynağı bu tablo.**

### A.5 Diğer
- `CargoTrackingTask`: `OrderNumber`, `ProductDetails`, `CustomerName`, `DeliveryAddress`, `OrderDate`, `PlannedDate`, `AssignedTechnicianId`, `Status` (`Received|Planned|Preparing|OutForDelivery|Delivered`), `ReceiverName`, `DeliveryProofPhotoUrl`, geo, `CreatedAt/UpdatedAt`, `HistoryJson`.
- `Technician`: ad, `Roles[]`, `ExpertiseAreas[]`, `PrimaryRegionId`, `AssignedRegions`, `MaxDailyTasks`, `CanInstall`, `WarehouseCode/CashAccountId/BankAccountId/PosAccountId`, `IsActive`, sayaçlar (`CompletedTasks`, `SuccessRate` — bunlar denormalize sayaçlar, rapor için **kullanılmayacak**, canlı hesaplanacak).
- `Dealer`: `DealerCode`, `Name`, `City`, `District`, `RegionId`, `IsActive`.
- `Customer`: `City`, `District`, `RegionId`, `Latitude/Longitude`.
- `Region`: hiyerarşik (`ParentRegionId`), geo sınırlar.
- `SparePart` (ürün bazlı parça kataloğu + `StockQuantity`), `ServiceProduct`, `ExplodedDiagram`.
- `SparePartOrderRequest`: `TechnicianName`, `StockCode`, `PartName`, `QuantityRequested`, `Status`, `CreatedAt`, `CompletedAt`.
- `TechnicianEarning`: hak ediş; `CompletedAt`, `Amount`, `Currency`, `SourceType`, `Status`.
- `WorkLog`: `TechnicianId`, `StartTime/EndTime/Duration`, `ActivityType`, geo — **dolduruluyor mu ölçülmeli** (controller var, çağıran ekran görünmüyor).

---

## B. Mevcut veriyle üretilebilecek raporlar

### B.1 Sayım / dağılım (tamamı doğrudan `GroupBy` ile)
Toplam iş, tamamlanan, bekleyen, devam eden, iptal, başarı oranı, iptal oranı; iş tipi dağılımı
(montaj / büyük / küçük / kargo); durum dağılımı; bayi, teknisyen, bölge, ürün, ay bazlı dağılım;
garanti içi/dışı dağılımı; öncelik dağılımı; günlük ortalama iş; aktif bayi/teknisyen sayısı.

### B.2 Süre analizleri (gerçek veriyle)
| Aşama | Formül | Kapsam |
|---|---|---|
| Açılış → planlama | `PlannedAt − CreatedAt` | Tüm kayıtlar (`PlannedAt` dolu olanlar) |
| Açılış → tamamlanma | `CompletedAt − CreatedAt` | Tüm tamamlanan kayıtlar |
| Planlama → sahaya aktarım | `TransferredAt − PlannedAt` | **Montaj** |
| Aktarım → fiilen başlama | `StartedAt − TransferredAt` | **Montaj** |
| Başlama → tamamlanma | `CompletedAt − StartedAt` | **Montaj** |
| Aşama → aşama (genel) | ardışık `Activity.CreatedAt` farkı | Tüm kayıtlar, `Activity` yazılan geçişler |
| Atölye süresi | `Workshop`/`InRepair` → `Ready`/`WorkshopReady` `Activity` farkı | Küçük + büyük ürün |
| Kargo süresi | `Delivered` durumundaki `UpdatedAt − OrderDate` | Kargo |

Her biri için ortalama, **medyan**, min, maks, P90 hesaplanacak (medyan `PERCENTILE_CONT` ile
PostgreSQL tarafında).

### B.3 Türetilebilir ama **tanımı açıkça yazılması gereken** metrikler
- **Tekrar servis oranı:** stored bir alan yok. Öneri: *aynı `SerialNumber` (yoksa
  `ProductStockCode` + `CustomerPhone`) için, önceki kaydın `CompletedAt`'ından sonraki 30 gün
  içinde açılan ikinci `Repair` kaydı.* Pencere parametrik olacak, ekranda "30 gün" yazacak.
- **Aynı gün tamamlanan iş oranı:** `CompletedAt::date = CreatedAt::date`.
- **Atölyede kim hazıra çekti:** `Activity` içinde `Type=StatusChanged` ve yeni durum
  `Ready`/`WorkshopReady` olan satırın `ActorTechnicianName`/`ActorUserName` alanı.
  → Uygulama öncesi `Payload` JSON'unun gerçek şeması **canlı veriden doğrulanacak**; şema
  tutmazsa bu metrik C listesine taşınır.
- **İlk müdahale süresi:** montajda `StartedAt − CreatedAt` (gerçek). Arıza tarafında karşılığı
  `Activity`'deki ilk `Assigned` kaydı — "atama süresi" olarak adlandırılacak, "müdahale" değil.

### B.4 Hak ediş / maliyet
`TechnicianEarning` üzerinden teknisyen bazlı tutar, para birimi kırılımlı, dönemsel.
`ServiceRecord.ServiceCost` / `PartsCost` dolu olduğu ölçüde ciro analizi (doluluk oranı önce
ölçülecek, düşükse ekranda gösterilmeyecek).

---

## C. Eksik veri nedeniyle **üretilemeyecek** metrikler

Bunlar için alan uydurulmayacak; ekranda ya hiç yer almayacak ya da "veri toplanmıyor" notuyla
kapalı gösterilecek.

| İstenen | Neden yapılamıyor | Mümkün kılmanın yolu (operasyonel değişiklik — ayrı onay) |
|---|---|---|
| **İptal sebepleri / nedene göre dağılım** | Hiçbir tabloda iptal nedeni alanı yok | `ServiceRecord.CancellationReason` + iptal ekranına zorunlu sebep seçimi |
| **İptal edilen kargo** | `CargoTrackingStatus` enum'unda `Cancelled` yok | Enum'a değer eklemek (akış değişikliği) |
| **Bayi bazlı kargo** | `CargoTrackingTask`'ta bayi/cari alanı yok | `OrderNumber` → B2B siparişi üzerinden cari çözümü (cross-DB) veya alan eklemek |
| **Servis başına kullanılan yedek parça** | `InventoryUsage` tablosuna hiç satır yazılmıyor | Servis fişi/atölye ekranına parça kullanım kaydı eklemek |
| **Hangi üründe / hangi bayide / hangi servis türünde parça kullanıldı** | Aynı sebep | Aynı |
| **Ürün başına ortalama parça, servis başına ortalama parça** | Aynı sebep | Aynı |
| **İş emri süresi / işçilik-parça maliyeti** | `WorkOrder`'ın süre ve maliyet alanları hiç yazılmıyor | Servis fişi akışına başlangıç/bitiş kaydı eklemek |
| **Marka bazlı dağılım** | ServiceOps'ta marka alanı yok | B2B ürün kartından marka senkronu (bkz. D.0) |
| **Kategori / alt kategori bazlı dağılım** | Aynı — kategori B2B `Products` tarafında | Aynı |
| **İl / ilçe filtresi (iş bazlı)** | `ServiceRecord`'da şehir/ilçe yok; `Customer` opsiyonel FK | Bayi ili (`Dealer.City/District`) ve `Region` üzerinden yapılabilir; müşteri ili ancak `CustomerId` dolu kayıtlarda |
| **Atölye bazlı performans** | Sistemde "atölye" bir varlık değil, bir durum | Workshop entity eklemek |
| **Ekip bazlı analiz** | Team entity yok | `Technician.Roles[]` ile yaklaşık gruplama yapılabilir (ekranda "rol" denecek) |
| **Zamanında tamamlanan iş oranı** | SLA/termin alanı yok (`EstimatedDeliveryDate` sadece küçük üründe ve seyrek) | Doluluk ölçülüp yeterliyse yalnızca o segmentte gösterilecek |

---

## D. Oluşturulacak ekranlar

### D.0 Ön koşul: ürün boyut tablosu (dimension)
Marka/kategori analizleri için ServiceOps'ta `ProductDimension` adında **salt-okunur, günlük
senkronize** bir tablo öneriyorum: `StockCode` (PK), `Name`, `Brand`, `MainCategory`,
`SubCategory`, `SyncedAt`. Kaynak B2B `Products`. Operasyonel akışa dokunmaz, sadece rapor
join'i için var. Onaylanmazsa marka/kategori raporları C listesinde kalır.

| # | Sayfa | Rota | Yetki anahtarı |
|---|---|---|---|
| 1 | Genel Yönetim Özeti | `/raporlar` | `raporlar` |
| 2 | Montaj Raporları | `/raporlar/montaj` | `raporlar.montaj` |
| 3 | Büyük Ürün Arıza Raporları | `/raporlar/buyuk-urun` | `raporlar.buyukUrun` |
| 4 | Küçük Ürün Arıza Raporları | `/raporlar/kucuk-urun` | `raporlar.kucukUrun` |
| 5 | Kargo Raporları | `/raporlar/kargo` | `raporlar.kargo` |
| 6 | Bayi Performans Analizi | `/raporlar/bayi` | `raporlar.bayi` |
| 7 | Bayi Detay | `/raporlar/bayi/:dealerCode` | `raporlar.bayi` |
| 8 | Teknisyen Performans Analizi | `/raporlar/teknisyen` | `raporlar.teknisyen` |
| 9 | Teknisyen Detay | `/raporlar/teknisyen/:id` | `raporlar.teknisyen` |
| 10 | Ürün Analizleri | `/raporlar/urun` | `raporlar.urun` |
| 11 | Ürün Detay | `/raporlar/urun/:stockCode` | `raporlar.urun` |
| 12 | Servis Süre Analizleri | `/raporlar/sureler` | `raporlar.sureler` |
| 13 | İptal / Başarısız İş Analizi | `/raporlar/iptal` | `raporlar.iptal` |
| 14 | Atölye Performansı | `/raporlar/atolye` | `raporlar.atolye` |
| 15 | Yedek Parça Talep Analizi | `/raporlar/yedek-parca` | `raporlar.yedekParca` |
| 16 | Trend ve Dönem Karşılaştırma | `/raporlar/trend` | `raporlar.trend` |
| 17 | Drill-down kayıt listesi | `/raporlar/kayitlar` (query ile) | üst sayfanın anahtarı |

> 15 numaralı sayfa bilinçli olarak **"Yedek Parça Talep Analizi"** — kullanım verisi olmadığı
> için "kullanım analizi" adını taşıyamaz (C bölümü).

---

## E. Sayfa bazında KPI'lar

**1. Genel Yönetim Özeti** — Toplam iş · Tamamlanan · Devam eden · Bekleyen · İptal · Başarı
oranı · İptal oranı · Ort. tamamlanma süresi · Medyan tamamlanma · Günlük ort. iş · Aktif bayi ·
Aktif teknisyen · Montaj / Büyük / Küçük / Kargo kırılımı. Her kartta önceki eşit uzunluktaki
dönemle karşılaştırma (%) ve 12 noktalı mini sparkline.

**2. Montaj** — Toplam / tamamlanan / bekleyen / iptal montaj · toplam **adet**
(`ServiceRecordItem.Quantity` toplamı, kayıt sayısı değil) · ort. planlama→başlama ·
ort. montaj süresi (`CompletedAt − StartedAt`) · sahaya aktarılmayı bekleyen kalem ·
en çok montaj veren 10 bayi · en çok monte edilen 10 ürün · en çok montaj yapan 10 teknisyen ·
bölge dağılımı · aylık trend.

**3. Büyük Ürün Arıza** — Toplam / açık / tamamlanan / iptal · ort. çözüm süresi · tekrar servis
oranı (30 gün) · garanti içi oranı · en çok arıza yapan 10 ürün · en çok kayıt açan 10 bayi ·
teknisyen dağılımı · bölge dağılımı · durum hunisi.

**4. Küçük Ürün** — Kabul edilen · atölyeye alınan · hazıra çekilen · teslim edilen · bekleyen ·
iptal · ort. atölye süresi (Activity) · ort. kabul→teslim · en çok gelen 10 küçük ürün · en çok
gönderen 10 bayi · atölyede en uzun bekleyen kayıtlar.

**5. Kargo** — Toplam · alınan / planlanan / hazırlanan / dağıtımda / teslim · ort. teslim süresi ·
teknisyen bazlı teslimat · bölge dağılımı (adres/geo) · günlük-aylık trend · en çok kargolanan
ürünler (`ProductDetails` metin ayrıştırması — güvenilirliği ölçülüp karar verilecek).

**6/7. Bayi** — Bayi başına: toplam iş, montaj / büyük / küçük kırılımı, tamamlanan, bekleyen,
iptal, iptal oranı, ort. tamamlanma, tekrar servis oranı, ürün dağılımı. Sıralamalar: en çok/az
iş veren 10, en yüksek iptal oranı, en uzun ort. süre, önceki döneme göre en çok büyüyen/düşen.
Detayda: ürün bazlı adet, hangi teknisyenler baktı, aylık trend, servis tipi dağılımı.

**8/9. Teknisyen** — Atanan · tamamlanan · bekleyen · iptal · günlük/haftalık/aylık ortalama ·
ort. tamamlanma · medyan · aynı gün kapatma oranı · tekrar servis oranı · iş türü dağılımı ·
bölge dağılımı · hak ediş toplamı. Sıralamalar + **Ayın Teknisyeni** (bkz. F.1).

**10/11. Ürün** — `ProductStockCode` bazında: toplam kayıt, montaj, arıza (büyük/küçük), iptal,
tekrar servis, ort. çözüm süresi, en çok kayıt açan bayi, en çok işleyen teknisyen, bayi dağılımı,
ay dağılımı, bölge dağılımı. "**Bu üründen hangi bayi kaç adet verdi**" tek tabloda.

**12. Süreler** — B.2'deki her aşama için ortalama / medyan / min / maks / P90 + en uzun 20 iş +
en hızlı 20 iş + teknisyen/bayi/ürün kırılımlı süre sıralaması.

**13. İptal** — Toplam iptal, oran, bayi/teknisyen/ürün/iş türü bazlı iptal, aylık trend.
*İptal sebebi bölümü yok* (C).

**14. Atölye** — Kişi bazlı: kaç ürün atölyeye aldı, kaç ürünü hazıra çekti, ort. atölye süresi,
günlük/haftalık/aylık tamamlanan. En eski bekleyen işler tablosu. (Activity'ye bağlı — B.3 notu.)

**15. Yedek Parça Talebi** — Toplam talep, en çok talep edilen 20 parça, teknisyen bazlı talep,
bekleyen/tamamlanan talep, ort. karşılanma süresi (`CompletedAt − CreatedAt`), dönemsel trend.

**16. Trend** — Bu ay/geçen ay ve bu yıl/geçen yıl için toplam iş, montaj, büyük, küçük, kargo,
iptal, ort. süre; her satırda `1.240 → 1.487 | +%19,9` biçiminde değişim.

---

## F. Grafikler

| Veri | Grafik |
|---|---|
| Zaman serisi (aylık/günlük iş) | Line / Area |
| Dönem karşılaştırma | İkili Bar (grouped) |
| İş tipi dağılımı (4 kategori) | Donut |
| Durum dağılımı (16 durum) | Horizontal Bar — pasta değil |
| Top-N bayi / ürün / teknisyen | Ranking (horizontal bar, değer etiketli) |
| Bayi × iş tipi kırılımı | Stacked Bar |
| Süre dağılımı | Box-plot benzeri (min/P25/medyan/P75/maks) |
| Bölge × ay yoğunluğu | Heatmap |
| KPI kartı içi eğilim | Sparkline |

Kural: pasta grafik yalnızca **≤5 dilim ve toplamı anlamlı bir bütün** olduğunda. Bütün grafikler
tooltip'li, responsive, filtrelerle senkron ve tıklanınca ilgili drill-down listesini açıyor.

### F.1 Ayın Teknisyeni — puanlama formülü
Yalnızca gerçekten hesaplanabilen 5 bileşen kullanılacak; her biri o dönemdeki teknisyenler
arasında 0–100'e normalize edilir:

```
Puan = 0.30 × TamamlananİşNormalize
     + 0.25 × (100 − OrtTamamlanmaSüresiNormalize)
     + 0.20 × (100 − İptalOranı)
     + 0.15 × (100 − TekrarServisOranı)
     + 0.10 × AynıGünKapatmaOranı
```

Minimum eşik: dönemde **en az 5 tamamlanmış iş** (tek işi olan teknisyen %100 başarıyla birinci
olmasın). Formül ekranda açıkça yazılacak ve her bileşenin ham değeri kartta gösterilecek.
"Zamanında tamamlama" bileşeni **yok** — SLA verisi olmadığı için (C).

---

## G. Drill-down yapısı

Her KPI kartı ve her grafik segmenti, filtreleri koruyarak `/raporlar/kayitlar` sayfasına gider:

```
/raporlar/kayitlar?from&to&type&category&status&dealerCode&technicianId&regionId&stockCode&metric
```

`metric` alanı, kartın hangi tanımdan geldiğini taşır (`cancelled`, `repeat-service`,
`same-day`, `overdue-workshop` …) — böylece listedeki sayı karttaki sayıyla **birebir aynı
sorgudan** gelir, ikinci bir yerde yeniden tanımlanmaz. Bu, "kartta 143 yazıyor listede 138 çıkıyor"
sınıfı hataların tek gerçek çözümü.

Liste: server-side sayfalama + sıralama + arama, satıra tıklayınca ilgili operasyon ekranına gider.

---

## H. Backend endpoint planı

Yeni `ReportsController` (`api/reports`). Tamamı `GET`, tamamı sayfalanmış ya da Top-N sınırlı.

```
GET  api/reports/summary                 → Genel özet KPI + önceki dönem
GET  api/reports/trend                   → Zaman serisi (granularity: day|week|month)
GET  api/reports/compare                 → İki dönem karşılaştırma
GET  api/reports/installations           → Montaj KPI + kırılımlar
GET  api/reports/repairs?category=large  → Büyük/küçük ürün arıza
GET  api/reports/cargo                   → Kargo
GET  api/reports/dealers                 → Bayi sıralama + kırılım
GET  api/reports/dealers/{dealerCode}    → Bayi detay
GET  api/reports/technicians             → Teknisyen sıralama
GET  api/reports/technicians/{id}        → Teknisyen detay
GET  api/reports/technicians/top         → Ayın teknisyeni (bileşen puanlarıyla)
GET  api/reports/products                → Ürün sıralama
GET  api/reports/products/{stockCode}    → Ürün detay + bayi dağılımı
GET  api/reports/durations               → Aşama süreleri (avg/median/min/max/p90)
GET  api/reports/cancellations           → İptal analizi
GET  api/reports/workshop                → Atölye kişi bazlı performans
GET  api/reports/spare-part-requests     → Yedek parça talep analizi
GET  api/reports/records                 → Drill-down listesi (server-side paging)
GET  api/reports/export/{reportKey}      → Excel (backend'de üretilir, dosya döner)
```

Ortak filtre nesnesi `ReportFilter` (tek sınıf, tüm uçlarda aynı):
`from, to, preset, type, productCategory, status[], dealerCode[], technicianId[], regionId[],
stockCode[], brand, mainCategory, subCategory, isCancelled, isCompleted, page, pageSize, sort`.

Tarih ön ayarları (`bugün … geçen yıl`) **backend'de** tarihe çevrilir — istemcinin saat dilimine
göre kayan bir "bu ay" tanımı iki ekranda farklı sayı gösterir.

---

## I. Performans stratejisi

1. Bütün toplamlar `GroupBy` + `Select` projeksiyonuyla **veritabanında**; hiçbir uçta
   `ToListAsync()` sonrası LINQ-to-Objects toplama yok.
2. `AsNoTracking()` her sorguda.
3. Medyan/P90 için PostgreSQL `PERCENTILE_CONT` — `FromSqlRaw` ile.
4. **`Technician.FullName` tuzağı:** hesaplanan property, SQL'e çevrilemez ve
   `AnalyticsController` bu yüzden bir dönem her çağrıda 500 dönmüştü. Gruplama daima
   `FirstName`/`LastName` ayrı yapılacak, ad birleştirme bellekte.
5. `Activity.Payload` JSON'u satır satır ayrıştırmak pahalı → aşama süreleri için
   **materialized view** (`report_stage_durations`) önerilir; günde bir yenilenir, gerçek zamanlı
   olması gerekmeyen tek veri budur.
6. Top-N uçları sabit `LIMIT`; drill-down ayrı sorgu, sayfa başına en fazla 100 satır.
7. Önerilen indeksler (yeni, veri değiştirmez):
   - `ServiceRecords (CreatedAt) INCLUDE (Status, Type, ProductCategory)`
   - `ServiceRecords (DealerCode, CreatedAt)`
   - `ServiceRecords (AssignedTechnicianId, CompletedAt)`
   - `ServiceRecords (ProductStockCode, CreatedAt)`
   - `InstallationTasks (CompletedAt)`, `InstallationTasks (ServiceId, Status)`
   - `Activities (ServiceId, CreatedAt)`, `Activities (Type, CreatedAt)`
   - `CargoTrackingTasks (Status, OrderDate)`
8. Özet uçlarında 60 saniyelik `IMemoryCache` (filtre imzası anahtar) — dashboard'un art arda
   açılması aynı ağır sorguyu tekrar çalıştırmasın.

---

## J. Rol / yetki entegrasyonu

**Mevcut sistem aynen kullanılacak, paralel bir yapı kurulmayacak.**

Yetki zinciri: B2B `Pages` (`ModuleKey='serviceOps'`) → `RolePagePermissions` →
ServiceOps `/api/auth/permissions` → frontend `pagePermissions.ts` → `canOpenRoute`.
Backend'de `IServiceOpsPermissionService.HasPageAsync(User, key)`.

Yapılacaklar:
1. `PagesController.cs` ve `RolesController.cs` içindeki seed SQL'ine `raporlar.*` alt anahtarları
   eklenecek (mevcut `raporlar` = Id 5017 korunur; alt anahtarlar aynı desende `WHERE NOT EXISTS`
   ile idempotent eklenir).
2. `pagePermissions.ts` → `ROUTE_PAGE_KEYS`'e yeni rotalar, `SUB_PAGE_KEYS.raporlar`'a alt anahtarlar.
3. Her `ReportsController` action'ı başında `HasPageAsync` kontrolü — **frontend gizlemek yetki
   değildir**; uç kendi başına da kapalı olacak.
4. Export ayrı anahtar: `raporlar.disaAktar`.
5. **Kayıt kapsamı:** `GetScopeAsync` + `ApplyServiceRecordScope` zaten var. Rapor sorguları da bu
   filtreden geçecek — yoksa yalnızca kendi işlerini görmesi gereken bir teknisyen, rapor ekranından
   şirketin tamamını görürdü. Bu, modülün en kritik güvenlik noktası.

---

## K. Excel / dışa aktarma mimarisi

- Mevcut `components/table/exportUtils.ts` (Excel/CSV/PDF/Word) ve `ServerDataTable` korunur;
  küçük tablolar (Top-N, ≤1000 satır) istemci tarafında dışa aktarılır — bugünkü davranış.
- **Büyük dışa aktarım backend'de:** `GET api/reports/export/{reportKey}` filtreleri alır, ClosedXML
  ile `.xlsx` üretir, `FileStreamResult` döner. Tarayıcıya tek satır ham veri gitmez.
- Çok sayfalı çıktı: `Özet`, `Detay`, `Bayi`, `Teknisyen`, `Ürün`, `Yedek Parça` sekmeleri.
- Kolon başlıkları Türkçe ve ekrandakiyle birebir; tarih/para biçimleri hücre formatıyla.
- Satır üst sınırı 100.000; aşılırsa kullanıcıya "filtreyi daralt" uyarısı (sessizce kesme yok).

---

## L. Değiştirilecek / oluşturulacak dosyalar

### Yeni — backend
```
ServiceOps.Api/Controllers/ReportsController.cs
ServiceOps.Api/Reports/ReportFilter.cs                  (ortak filtre + preset çözümü)
ServiceOps.Api/Reports/ReportDefinitions.cs             (durum→kategori eşlemesi, TEK yer)
ServiceOps.Api/Reports/IReportQueryService.cs
ServiceOps.Api/Reports/ReportQueryService.cs            (bütün aggregate sorgular)
ServiceOps.Api/Reports/ReportExportService.cs           (ClosedXML)
ServiceOps.Api/Reports/Dtos/*.cs                        (projection DTO'ları)
ServiceOps.Infrastructure/Migrations/xxxx_AddReportIndexes.cs        (yalnızca indeks)
ServiceOps.Infrastructure/Migrations/xxxx_AddStageDurationView.cs    (materialized view)
```

### Yeni — frontend
```
src/pages/raporlar/RaporlarLayout.tsx        (ortak filtre çubuğu + sekmeler)
src/pages/raporlar/GenelOzetPage.tsx
src/pages/raporlar/MontajRaporPage.tsx
src/pages/raporlar/BuyukUrunRaporPage.tsx
src/pages/raporlar/KucukUrunRaporPage.tsx
src/pages/raporlar/KargoRaporPage.tsx
src/pages/raporlar/BayiRaporPage.tsx  +  BayiDetayPage.tsx
src/pages/raporlar/TeknisyenRaporPage.tsx  +  TeknisyenDetayPage.tsx
src/pages/raporlar/UrunRaporPage.tsx  +  UrunDetayPage.tsx
src/pages/raporlar/SureAnaliziPage.tsx
src/pages/raporlar/IptalAnaliziPage.tsx
src/pages/raporlar/AtolyeRaporPage.tsx
src/pages/raporlar/YedekParcaRaporPage.tsx
src/pages/raporlar/TrendRaporPage.tsx
src/pages/raporlar/DrillDownPage.tsx
src/components/reports/  (KpiCard, TrendSparkline, RankingChart, StackedBar, Donut,
                          HeatMap, DurationBox, ReportFilterBar, InsightList)
src/api/reports.ts
src/hooks/useReportFilter.ts
```

### Değiştirilecek (küçük, cerrahi)
```
src/auth/pagePermissions.ts                  → yeni rota ve alt anahtarlar
src/App.tsx / router                         → yeni rotalar
src/components/StilsoftShell.tsx              → Raporlar menüsü alt öğeleri
backend/B2B.Erp.Api/Controllers/PagesController.cs   → raporlar.* seed
backend/B2B.Erp.Api/Controllers/RolesController.cs   → raporlar.* seed
service-ops-frontend/package.json            → grafik kütüphanesi (aşağı bak)
```

### Silinmeyecek
`RaporlarPage.tsx` ve `AnalizPage.tsx` yeni yapı devreye alınıp doğrulanana kadar duracak;
rota `/raporlar` yeni layout'a bağlanacak, eskisi `/raporlar/klasik` altında bir süre kalacak.

### Grafik kütüphanesi — karar gerekiyor
`package.json`'da **hiçbir grafik kütüphanesi yok** (sadece `xlsx`, `leaflet`).
Seçenekler:
- **`recharts`** (~500 KB) — React'e uygun, tooltip/responsive hazır, tıklama olayları var. Önerim bu.
- Elle yazılmış SVG bileşenleri — sıfır bağımlılık, ama heatmap/box-plot maliyeti yüksek.

---

## M. Riskler

| Risk | Etki | Önlem |
|---|---|---|
| **Kapsam filtresinin raporlarda atlanması** | Teknisyen/bayi tüm şirketin verisini görür — veri sızıntısı | Her rapor sorgusu `ApplyServiceRecordScope`'tan geçecek; kapsamsız sorgu yazılmayacak. Uygulama sonrası yetki senaryo testi. |
| `Technician.FullName` ile gruplama | Uç her çağrıda 500 | Daima `FirstName`/`LastName` ile grupla (I.4) |
| Materialized view'in operasyonu yavaşlatması | Yazma gecikmesi | View **yalnızca okuma**; yenileme gece, `CONCURRENTLY` |
| Yeni indekslerin yazma maliyeti | Kabul/planlama ekranları yavaşlar | Yalnızca listelenen 7 indeks; migration ayrı, geri alınabilir |
| `Activity.Payload` şemasının beklenenden farklı olması | Atölye ve aşama süresi raporları boş çıkar | **Uygulamadan önce canlı veriden doğrulanacak**; tutmazsa bu metrikler C'ye taşınır |
| `ServiceCost`/`PartsCost` doluluk oranının düşük olması | Ciro kartları yanıltıcı | Doluluk önce ölçülecek; %60 altındaysa kart gösterilmeyecek |
| Ortak filtre çubuğunun mevcut sayfaları etkilemesi | Operasyonel ekranlar bozulur | Filtre bileşenleri `components/reports/` altında, mevcut bileşenler değiştirilmez |
| B2B `Pages` seed'inin çakışması | Rol ekranı bozulur | Mevcut desendeki `WHERE NOT EXISTS` kullanılacak; sabit Id aralığı 5019+ |
| Tekrar servis tanımının tartışmalı olması | Rakama güven kaybı | Pencere ekranda yazılı ve ayarlanabilir |

---

## Onayını beklediğim 4 karar

1. **Grafik kütüphanesi:** `recharts` eklensin mi, yoksa elle SVG mi?
2. **Ürün boyut tablosu (D.0):** marka/kategori raporları için B2B'den günlük senkron kurulsun mu?
   Kurulmazsa marka ve kategori kırılımları planından çıkar.
3. **C listesindeki eksik alanlar:** iptal sebebi, kargo iptali, servis-parça kullanımı ve iş emri
   süre/maliyet alanları — bunlar operasyonel ekranlara küçük eklemeler gerektiriyor. "Operasyonel
   akışa dokunma" kuralın gereği **hiçbirine dokunmadım**. Ayrı bir iş olarak açılsın mı?
4. **Sayfa sayısı:** 17 ekran + 18 endpoint tek seferde mi, yoksa önce 1–5 (Genel Özet + 4 operasyon
   sayfası) canlıya alınıp sonra kalanlar mı?
