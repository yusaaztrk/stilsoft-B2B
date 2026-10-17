# Müşteri Teklifi Basımı — Ölçüler

Kaynak: eski sistemin çıktıları `Report (3).pdf` (özelliksiz form, 1 sayfa) ve `Report (2).pdf`
(özellikli form, 4 sayfa). `pdfplumber` ile ölçüldü, 2026-08-06. Değerler sayfanın
**sol-üst köşesinden** santimetredir.

## Ortak

| | Değer |
|---|---|
| Sayfa | **21,590 × 27,940 cm** (Letter — kullanıcı teyidi: birebir korunacak) |
| Yazı tipi | **Times New Roman**, gövde 9,8 pt |
| İstisna punto | Tutar kolonları 8,5 pt · sol alt notlar 8,0 pt (kalın) |
| Üst başlık görseli | x = 0,397 – 21,325 · y = 0,005 – 3,21 (tam genişlik banner) |

## Toplam bloğu (iki formda da aynı)

Etiket x = **12,483** · tutar sağa dayalı, sağ kenar = **20,998** · satır adımı **0,635 cm**

| y (cm) | Satır |
|---|---|
| 22,574 | ARA TOPLAM |
| 23,195 | İNDİRİM |
| 23,830 | KDVSİZ TOPLAM |
| 24,465 | ( matrah) K.D.V. (% 16,00) |
| 25,100 | ( matrah) K.D.V. (% 10,00) |
| 25,735 | ( matrah) K.D.V. (% 5,00) |
| 26,370 | KDV TOPLAM |
| 27,005 | GENEL TOPLAM |

Sol alt notlar (8,0 pt kalın, x = 0,651): y = 22,602 / 23,237 / 23,872 / 24,507 —
"FİYAT TEKLİFİ 7 GÜN GEÇERLİDİR", "ÜRÜNLERİMİZ 3 YIL GARANTİLİDİR",
"TELEVİZYONLARDA ASKI APARATI VE MONTAJ DAHİL DEĞİLDİR", "ÖDEME ŞEKLİ PEŞİNDİR".

> **Değişiklik (kullanıcı isteği):** Eski çıktıda bu blok ve sol notlar **dört sayfanın
> hepsinde** basılıyor. Yeni basımda **yalnızca son sayfada** olacak.

## Özelliksiz form (`Report (3)`)

Başlık alanları:

| y (cm) | İçerik |
|---|---|
| 3,898 | TİCARİ ÜNVAN · TARİH · PI NO (değer x = 19,066, taşarsa alt satıra sarıyor) |
| 4,650 | YETKİLİ · TEKLİF VEREN |
| 5,285 | GSM · AÇIKLAMA |

Tablo başlığı üç satır: y = 6,311 / 6,516 / 6,706 (BİRİM FİYAT ve İNDİRİMLİ FİYAT iki satıra bölünür).

Kalem satırları: ilk satır **y = 7,271**, adım **0,610 cm**.

| Kolon | Hizalama | x (cm) |
|---|---|---|
| Barkod | sola | 0,827 |
| Stok adı | sola | 3,746 |
| Adet | sola | 12,707 |
| Birim fiyat (8,5 pt) | sola | 13,939 |
| KDV | sola | 15,405 |
| İndirimli fiyat (8,5 pt) | sola | 17,217 |
| Ara toplam (8,5 pt) | sağa | biter 21,018 |

## Özellikli form (`Report (2)`)

Başlık alanları iki sütuna ayrılmış (sol etiketler kalın, sağ sütun x = 10,876):

| y (cm) | Sol | Sağ |
|---|---|---|
| 3,672 / 3,771 | TİCARİ ÜNVAN | TARİH |
| 4,279 / 4,396 | YETKİLİ | TEKLİF VEREN |
| 4,914 / 5,031 | GSM | AÇIKLAMA |

Tablo başlığı üç satır: y = 6,054 / 6,258 / 6,449 — kolonlar: ÜRÜN GÖRSELİ · BARKOD /
STOK KODU · STOK ADI / ÜRÜN ÖZELLİKLERİ · ADET · BİRİM FİYAT · İNDİRİMLİ FİYAT · KDV · ARA TOPLAM.

Kalem bloğu:

| | Değer |
|---|---|
| Ürün görseli | x = 0,448 – 4,500 (genişlik 4,05) · yükseklik 3,04 cm |
| Stok adı / özellik satırları | x = **7,582** · satır adımı **0,395 cm** |
| Barkod | x = 4,809 |
| Stok kodu | x = 5,172 |
| Adet / KDV | x = 13,605 |
| Tutarlar (8,5 pt) | x = 14,889'dan itibaren |

Özellikler `ProductDetails.Features` alanından satır satır çekilir.

## PI No

Teklif numarası `MT` + 13 hane (örn. `MT0000000000123`). Basımda **sadece haneler** yazılır —
`MT` ya da `P` öneki görünmez (kullanıcı kararı). Teklif proformaya döndüğünde numaranın
başındaki `MT`, `P` ile değişir; haneler aynı kalır, dolayısıyla basımdaki PI No da aynı kalır.
