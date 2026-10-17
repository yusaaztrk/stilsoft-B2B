# Fatura Basım — Ön Baskılı Kağıt Ölçüleri

Kaynak: `yazdir.pdf`, `yazdir (1..4).pdf` çıktılarından `pdfplumber` ile ölçüldü (2026-08-05).
Tüm değerler **sayfanın sol-üst köşesinden** santimetre cinsindendir.

> Kağıt ön baskılı. Çıktıda **sadece değişken alanlar** var — PDF'lerde tek bir dikdörtgen
> (tam sayfa beyaz zemin) dışında çizgi/çerçeve yok. Yeni basım da form çizgisi BASMAMALI.

## Kaşe (gömülü görsel)

Her referans çıktıda **tam olarak bir gömülü görsel** var: firma kaşesi. Metin değil, resim —
bu yüzden `extract_words()` ile yapılan ilk taramada gözden kaçtı. Konumu dört örnekte de aynı,
yani içeriğe göre kaymayan sabit bir blok:

| | Değer |
|---|---|
| Sol | **10,03 cm** |
| Üst | **7,44 cm** |
| Genişlik | **4,52 cm** |
| Yükseklik | **2,54 cm** |
| Kaynak çözünürlük | 1600 × 900 px |

Görsel `yazdir (6).pdf`'ten çıkarılıp `backend/B2B.Erp.Api/Assets/kase.png` olarak saklandı ve
çıktı klasörüne kopyalanıyor. İçeriği: DEMO TİCARET LİMİTED, adres, telefon, vergi dairesi ve
vergi numarası.

## Sayfa ve yazı tipi

| | Değer |
|---|---|
| Sayfa | Basılacak kağıt **A4 (21,0 × 29,7 cm)** — kullanıcı teyidi 2026-08-05. Eski çıktı Letter (21,59 × 27,94) üretiyordu; konumlar sol-üstten verildiği için A4'te aynen korunur. **Ölçekleme kapalı olmalı** ("sayfaya sığdır" hizalamayı bozar). En sağdaki içerik 19,95 cm, en alttaki 25,94 cm → A4'e rahat sığıyor. |
| Yön | Dikey |
| Yazı tipi | **Courier New Bold** (monospace) |
| Gövde punto | 8 pt → karakter genişliği **0,1694 cm** |
| İstisna | Yalnız `GENEL TOPLAM` satırı 9 pt → karakter genişliği 0,1905 cm |
| Sol kenar | **30,66 pt = 1,0816 cm** (tüm sola dayalı metinler) |
| Kalem satır adımı | **16,5656 pt = 0,5844 cm** (10 kalemli `yazdir (5).pdf` ile 9 aralıktan ölçüldü) |
| İlk kalem satırı | **321,27 pt = 11,3337 cm** |

Monospace olduğu için yerleşim bir karakter ızgarasına oturuyor:
`x(n) = 30,66 + n × 4,8` pt  =  `1,0816 + n × 0,16933` cm.

## Sabit Y konumları

| y (cm) | Alan |
|---|---|
| 4,19 | Cari ünvan — 1. satır |
| 5,20 | Cari ünvan / adres — 2. satır |
| 6,65 | İlçe / şehir (`MERKEZ/GAZİMAĞUSA`, `/GİRNE`) |
| 7,21 | Tarih — x = 17,51 |
| 7,71 | `VERGİ DAİRESİ :` + `VERGİ NO :` |
| **11,33** | **1. kalem satırı** (sonraki satırlar +0,59) |
| 21,55 | `BRÜT TUTAR` |
| 22,13 | `İNDİRİM` — *yalnızca iskonto varsa basılıyor* |
| 22,72 | `NET TOPLAM` — *yalnızca iskonto varsa basılıyor* |
| 22,95 | Sol: `<no> TESLİM ALAN #` |
| 23,30 | `( <matrah>) K.D.V. (% 16,00)` |
| 23,89 | `( <matrah>) K.D.V. (% 10,00)` |
| 24,19 | `YALNIZ : <tutar yazıyla> TL <kuruş> KR` |
| 24,46 | `( <matrah>) K.D.V. (% 5,00)` |
| 24,78 | `MONTAJ : <değer>` |
| 25,05 | `TOPLAM K.D.V.` |
| 25,36 | `NOT : <değer>` |
| 25,64 | `GENEL TOPLAM` — **9 pt** |
| 25,94 | `DEMO BANKA : TR00 0000 0000 0000 0000 0000 00` |

## Kalem satırı kolonları (y = 11,33 + n × 0,59)

> **Barkod + stok adı tek bir dizedir:** `BARKOD1 + "  " + STOK_ADI` (iki boşluk).
> Barkod 13 hane olduğu için ad kolon 15'e, yani 3,62 cm'e denk gelir. Barkod boşsa (hizmet
> kalemleri) ad kendiliğinden kolon 2'ye = **1,42 cm**'e kayar — `yazdir.pdf`'te ölçülen değer
> tam olarak budur. Ayrı bir "barkodsuz düzen" yok, tek kural iki durumu da karşılıyor.

| Kolon | Hizalama | x (cm) |
|---|---|---|
| Barkod + stok adı (tek dize) | sola | 1,08 (barkod boşsa metin 1,42'den başlar) |
| KDV `%` işareti | sabit | 13,36 |
| KDV oranı | sola | 13,70 |
| Miktar | sağa | biter **15,26** |
| Birim (AD/MT) | sola | 15,43 |
| Birim fiyat | **sağa** | biter **17,67** |
| Tutar | **sağa** | biter **19,90** |

Sağ hizalama iki farklı uzunlukla doğrulandı: `68,97`→16,83-17,67 ve `11.352,38`→16,15-17,67.

## Toplam bloğu hizalaması

Etiketler x = 12,40'tan başlar. Tutarlar sağa dayalıdır:

| Satır | Tutar sağ kenarı (cm) |
|---|---|
| BRÜT TUTAR | 19,95 |
| İNDİRİM / NET TOPLAM / K.D.V. satırları / TOPLAM K.D.V. | 19,92 |
| GENEL TOPLAM (9 pt) | 19,95 |

## Birleştirilmiş dizeler — ayrı alan gibi konumlandırma YAPMA

İki satır tek parça metindir; alanları ayrı ayrı sabit x'e koymak yanlış olur, çünkü sonraki
parça öndekinin uzunluğuna göre kayar.

**Vergi satırı (y = 7,71):**
`"VERGİ DAİRESİ : " + VDAIRE + "   " + "VERGİ NO : " + VNO`  (3 boşluk ayraç)

Üç örnekle kolonu kolonuna doğrulandı:

| Örnek | `VDAIRE` | 2. "VERGİ" kolonu | `VNO` kolonu |
|---|---|---|---|
| yazdir (2) | *(boş)* | 19 = 19 ✓ | — |
| yazdir (3) | `GAZİMAĞUSA` | 29 = 29 ✓ | 40 = 40 ✓ |
| yazdir (5) | `GÜZELYURT` | 28 = 28 ✓ | 39 = 39 ✓ |

**Kalem satırı:** `BARKOD1 + "  " + STOK_ADI` (yukarıya bak).

## Font: Türkçe karakter zorunlu

Doğrulama sırasında ortaya çıktı — `İ Ş Ğ Ç Ö Ü` içeren kelimeler standart WinAnsi Courier ile
basılamıyor ve **eksik karakter sonraki kelimeleri sola kaydırıyor**, yani hizalama bozuluyor.
Seçilecek PDF kütüphanesinde Courier New Bold, Türkçe karakterleri kapsayan bir kodlamayla
(TrueType + Unicode) gömülmeli. Base-14 Courier YETMEZ.

## Alan eşleşmesi — `VW_FATURA_DIZAYN_DATA`

| Basımdaki yer | Alan |
|---|---|
| y 4,19 | `CARI_ADI` |
| y 5,20 | `ADRES` |
| y 6,65 | `ILCE` + `/` + `IL` (`MERKEZ/GÜZELYURT`) |
| y 7,21 | `TARIH` (gg.aa.yyyy) |
| y 7,71 | `VDAIRE`, `VNO` |
| Kalem | `BARKOD1`, `STOK_ADI`, `KDV_ORAN`, `MIKTAR`, `OLCU_BIRIMI`, `FIYAT`, `TUTAR` |
| BRÜT TUTAR | `ARA_TOPLAM` |
| İNDİRİM | `ISK1_T` (0 ise satır basılmıyor) |
| NET TOPLAM | `NET_TOPLAM` (iskonto yoksa basılmıyor) |
| K.D.V. %16 / %10 / %5 | `KDV_1_MATRAH`/`KDV_1`, `KDV_2_*`, `KDV_3_*` |
| TOPLAM K.D.V. | `KDV_TOPLAM` |
| GENEL TOPLAM | `GENEL_TOPLAM` |
| YALNIZ | `YAZIYLA` |
| MONTAJ | `MONTAJ` |
| NOT | `NOT` |
| **TESLİM ALAN solundaki sayı** | **`PLA_KODU`** — carinin plasiyer kodu |

Basımda **görünmeyen** alanlar: `FISNO`, `TIP`, `CARI_KODU`, `STOK_KODU`, `TELEFON`,
`EKACK1/2/3`, `TESLIM_ADRES`, `ACIKLAMA`, `ISLEM_YAPAN`.

### Karar: IBAN kaldırıldı
y = 25,94'teki `İŞBANK : TR02 ...` satırı **tamamen kaldırılacak** (kullanıcı kararı, 2026-08-05).

## Sol alt blok akışkan — sabit değil

`YALNIZ` metni uzun olduğunda ikinci satıra taşıyor ve **altındaki `MONTAJ` ile `NOT` aşağı
kayıyor**. Sağ taraftaki toplam bloğu ve `GENEL TOPLAM` sabit kalıyor.

| Durum | YALNIZ | MONTAJ | NOT |
|---|---|---|---|
| Tek satır (`yazdir (2)`) | 24,19 | 24,78 | 25,36 |
| İki satır (`yazdir (5)`) | 24,19 + 24,51 | 24,88 | 25,47 |

Sarma içi satır aralığı: **0,32 cm**. Taşma sonrası kayma tam bir satır değil (~0,10 cm), yani
kutu "büyüyebilir" (CanGrow) davranışında.

## Açık sorular (kaynak koddan doğrulanmalı)

1. **`YAZIYLA` nasıl üretiliyor?** Görünümde hazır bir kolon; birebir aynısı gerekiyor.
   Gözlenen biçim: `<tamsayı yazıyla> TL <kuruş yazıyla> KR`, hepsi büyük harf, kuruş 0 ise
   `SIFIR`. Örnekler: `OTUZ DÖRT BİN ELLİ YEDİ TL ON DÖRT KR`,
   `ÜÇ YÜZ SEKSEN BEŞ BİN ALTI YÜZ ELLİ SEKİZ TL DOKSAN BEŞ KR`.
   Doğrulanmış örnekler:

   | Tutar | YAZIYLA |
   |---|---|
   | 10.000,00 | `ON BİN TL SIFIR KR` |
   | 5.200,00 | `BEŞ BİN İKİ YÜZ TL SIFIR KR` |
   | 31.200,00 | `OTUZ BİR BİN İKİ YÜZ TL SIFIR KR` |
   | 34.057,14 | `OTUZ DÖRT BİN ELLİ YEDİ TL ON DÖRT KR` |
   | 385.658,95 | `ÜÇ YÜZ SEKSEN BEŞ BİN ALTI YÜZ ELLİ SEKİZ TL DOKSAN BEŞ KR` |

   **Hâlâ örneği olmayan durumlar:** tam 1.000 → `BİN` mi `BİR BİN` mi? Tam 100 → `YÜZ` mü?
   1.000.000 → `BİR MİLYON` mu? Standart Türkçe kural (`YÜZ`/`BİN` önüne `BİR` gelmez,
   `BİR MİLYON` gelir) uygulanacak; SQL fonksiyonu bulunursa teyit edilmeli.
2. `FISNO` basılmıyor — fatura seri/sıra no kağıtta matbu mu?

**Çözüldü:** kağıt A4, kaç kalem sığdığı (satır aralığı sabit — kullanıcı teyidi),
`TESLİM ALAN` solundaki sayı (`PLA_KODU`), `MONTAJ`/`NOT` kaynağı, IBAN (kaldırılıyor),
barkodsuz kalem düzeni (tek dize kuralı).
