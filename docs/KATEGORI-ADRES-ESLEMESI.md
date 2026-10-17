# Kategori Adresleri — panelde girilecekler

*2026-09-20 · B2B paneli → E-Ticaret → Vitrin Yönetimi → Kategori ayarları*

## Sorun neydi

ERP kategori adları kısaltma: `G.HAZIR`, `BUZDLB`, `DRN.DON`, `SEBIL`…
Vitrin adresi bu addan türüyordu → `/kategori/g-hazir`.

Menüdeki bağlantılar ise okunur adreslere yazılmıştı (`/kategori/gida-hazirlama`).
İkisi tutmadığı için **menü bağlantılarının çoğu boş sayfaya gidiyordu**.

Lokal test verisinde ölçüm: 15 menü kategorisinden **10'u boş**, ardındaki **81 ürün**
ana menüden erişilemiyor.

## Nasıl düzelir

Her kategorinin **Adres** kutusuna okunur adres yazılır. Eski adres kırılmaz:
ziyaretçi eski adresle gelirse kalıcı olarak (308) yenisine yönlendirilir, mağaza API'si
de her iki adresi kabul eder.

## Girilecek eşleme

> **Önce kontrol et:** aşağıdaki ERP adları lokal test verisinden. Canlıda kategori adları
> farklı olabilir. Panelde her satırın solunda ERP adı ve mevcut adresi yazıyor; eşleştirerek gir.

| ERP kategorisi | Mevcut adres | Yazılacak adres | Görünecek ad |
|---|---|---|---|
| G.HAZIR | `g-hazir` | `gida-hazirlama` | Gıda Hazırlama |
| I.HAZIR | `i-hazir` | `icecek-hazirlama` | İçecek Hazırlama |
| BUZDLB | `buzdlb` | `buzdolabi` | Buzdolabı |
| CAM.MAK | `cam-mak` | `camasir-makinesi` | Çamaşır Makinesi |
| BUL-MAK | `bul-mak` | `bulasik-makinesi` | Bulaşık Makinesi |
| DRN.DON | `drn-don` | `derin-dondurucu` | Derin Dondurucu |
| EV.GEREC | `ev-gerec` | `ev-gerecleri` | Ev Gereçleri |
| EV.TEMIZ | `ev-temiz` | `ev-temizligi` | Ev Temizliği |
| K.BAKIM | `k-bakim` | `kisisel-bakim` | Kişisel Bakım |
| SEBIL | `sebil` | `su-sebili` | Su Sebili |
| ANKASTRE | `ankastre` | *(değişmez)* | Ankastre |
| KLIMA | `klima` | *(değişmez)* | Klima |
| UTU | `utu` | *(değişmez)* | Ütü |
| BAZA | `baza` | *(değişmez)* | Baza |
| SILTE | `silte` | *(değişmez)* | Şilte |
| ELEKTRO | `elektro` | `elektronik` | Elektronik |

Son dördü zaten menüyle uyuşuyor, dokunmaya gerek yok.

## Girdikten sonra

- Vitrin önbelleği en geç **5 dakikada** yenilenir (ayar 60 sn + sayfa 300 sn).
- `/kategori/g-hazir` → `/kategori/gida-hazirlama` yönlendirmesini tarayıcıda dene.
- Google Search Console'da yeni adreslerin taranmasını istersen site haritasını yeniden gönder.

## Mükerrer kategori uyarısı

ERP'de hem kısaltma adlı (`G.HAZIR`) hem okunur adlı (`Gıda Hazırlama`) kategoriler
bir arada duruyor ve bazıları **iki kez** kayıtlı. Lokal veride okunur adlı olanların
vitrinde tek bir ürünü yok — ürünlerin hepsi kısaltma adlı kategorilerde.

Bu ayrı bir temizlik işi: aynı işi gören iki kategori, ürünleri böler. Adres eşlemesi
çalışmayı düzeltiyor ama mükerrer kayıtları silmiyor. Canlıda da böyle mi, ölçmek gerek.
