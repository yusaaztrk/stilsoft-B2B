# Barkod Etiketi — Eski Sistem Ölçüleri

Kaynak: `YazdirBarkodFatura.pdf` (eski ERP çıktısı, fatura barkod basımı), `pdfplumber` ile
ölçüldü 2026-08-05. Tüm değerler etiketin **sol-üst köşesinden** santimetredir.

## Sayfa / etiket

| | Değer |
|---|---|
| Etiket | **5,009 × 2,505 cm** (142 × 71 pt) |
| Sayfa başına etiket | **1** — her etiket ayrı sayfa |
| Toplam sayfa | Ürün adedi kadar (örnekte 4 adet → 4 sayfa) |
| Yazı tipi | Times New Roman **Bold** 9,8 pt (ürün adı ve barkod hanesi), **Bold 12 pt** (fiyat) |
| Çerçeve | Yok. Tek dikdörtgen tam sayfa beyaz zemin. |

## Yerleşim

| y (cm) | İçerik | Hizalama |
|---|---|---|
| 0,102 | Ürün adı — 1. satır | ortalı |
| 0,497 | Ürün adı — 2. satır | ortalı |
| 0,998 | Fiyat (`3.200,00 TL`) — **12 pt** | ortalı |
| 1,455 – 2,026 | Barkod çubukları (normal) | — |
| 1,455 – 2,243 | Koruma çubukları (uzun) | — |
| 2,088 | Barkod haneleri `8 681344 312039` | EAN-13 düzeni |

Ürün adı iki satıra bölünüyor ve ikinci satır kesiliyor (`...KAHVE M`), yani sabit karakter
sınırı var. **Stok kodu etikette YOK** — bizim mevcut basımımız `stokKodu - stokAdı` yazıyor,
eski sistem sadece adı basıyor.

## Barkod: EAN-13 (çözüldü ve doğrulandı)

Barkod görsel değil, **31 dikdörtgenle çizilmiş vektör**. Çubukları PDF'ten okuyup çözdüm:

| | Değer |
|---|---|
| Simgeleme | **EAN-13** |
| Modül genişliği | **0,0443 cm** = 1,2559 pt |
| Toplam modül | 95 (3 + 42 + 5 + 42 + 3) |
| Çubuk alanı | x = 0,5371 → 4,7460 cm (4,2089 cm) |
| Normal çubuk yüksekliği | 0,571 cm |
| Koruma çubuğu yüksekliği | 0,788 cm |

Doğrulama: koruma çubukları `101` / `01010` / `101`, parite deseni `LGLGGL` → ilk hane 8,
çözülen barkod **8681344312039**, kontrol hanesi **doğru**.

Hane grupları `8 | 681344 | 312039` olarak basılıyor: ilk hane sol koruma çubuğunun solunda
(x=0,365), sonraki altı sol yarının altında (x=1,073), son altı sağ yarının altında (x=3,178).

## Bizim sistemdeki hatalar

1. **Yanlış simgeleme.** `InvoiceListPage.tsx:178` → `barcodeType === 'EAN13' ? 'EAN13' :
   'CODE128'`. Ürün kaydında `barcodeType` boşsa 13 haneli EAN numarası **CODE128** olarak
   kodlanıyor. Okuyucu farklı simgeleme okur, kasadaki ürün numarasıyla eşleşmez.
2. **Kontrol hanesi doğrulanmıyor.** Hatalı barkod sessizce basılıyor; okuyucu reddediyor.
3. **Etikette stok kodu var**, eski sistemde yok.
4. **Tarayıcıda HTML basım** — etiket boyutu yazıcı ayarına bağlı, 5,01 × 2,50 cm garanti
   edilemiyor.

## Bizim çıktımız (2026-08-06 itibarıyla)

Etiket stoğu 4 cm olduğu için yerleşim eski ölçülerden bilerek ayrılıyor. `ProductLabelLayout`
satır konumlarını yukarıdaki cm değerlerinden türetmeye devam ediyor, üstüne iki şey ekliyor:

| | Eski | Bizim |
|---|---|---|
| Etiket | 5,009 × 2,505 cm | **5,009 × 4,000 cm** |
| Ürün adı | 2 satır, kelime ortasından kesik | **3 satır, kelime sınırında sarar** |
| Dikey yerleşim | üste yaslı | **ortalı** (üst/alt boşluk 0,636 / 0,637 cm) |
| Fiyat / çubuk / hane | 0,998 / 1,455 / 2,088 cm | +0,395 cm (3. satır) +0,534 cm (ortalama) |

Kelime ortasından kesme kaldırıldı: `…KAHVE MAKİNESİ-INOX` eskiden `…KAHVE M` diye bitiyordu.
Tek başına satıra sığmayan kelime hâlâ harf harf bölünür, yoksa hiç basılamazdı.

## Durum

- ✅ `Ean13.cs` — sunucu tarafı kodlayıcı. Eski etiketten çözülen 95 modüllük desene karşı
  test edildi (`Ean13Tests`, 12 test geçiyor). 12 haneye kontrol hanesi ekliyor, 13 hanede
  doğruluyor, geçersizde **hata fırlatıyor** (sessizce yanlış basmıyor).
- ✅ Etiket PDF üreticisi — `ProductLabelRenderer` + `ProductLabelLayout`
- ✅ `GET /api/invoices/{id}/barkod` ucu. Geçersiz barkodlu kalemler atlanır, sayısı
  `X-Barkod-Atlanan` başlığıyla döner.
- ✅ Frontend bu uca bağlı (`InvoiceListPage.handlePrintInvoiceBarcodes`).
  ⚠️ Eski HTML basımı **silinmedi**: `buildInvoiceBarcodesHtml` ve `generateBarcodeSvgHtml`
  ile `jsbarcode` importu artık çağrılmayan ölü kod.
- ✅ Boyut 4 cm etiket stoğuna çekildi (yukarıdaki tablo).
