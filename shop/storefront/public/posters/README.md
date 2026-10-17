# Dikey ürün afişleri (A4)

Stilsoft'un **dikey** ürün afişleri (~595x842, özellik listeli). Anasayfadaki kayan
şerit (`components/PosterRail.tsx`) bu klasördeki dosyaları sırayla döndürüyor.

> **Bunlar üstteki vitrinden AYRI.** Anasayfanın en üstündeki `HeroSlider` 1920x700
> **yatay** afişler için (`public/banners/`). Dikey bir afiş oraya konursa kadraj
> altını ve üstünü keser, afişin metni okunmaz olur.

## Nasıl eklenir

1. Kaynak JPG/PNG dosyalarını `public/posters/_kaynak/` içine, **aşağıdaki adlarla** koy
   (uzantı fark etmez: `.jpg`, `.png`).
2. Storefront klasöründe çevir:
   ```
   node scripts/webp-cevir.mjs public/posters/_kaynak public/posters 1200
   ```
3. Vitrini yeniden derle. Dosyası olmayan afiş **hiç görünmez** — liste diskteki
   dosyalarla süzülüyor (`lib/posters.ts`), yani afişler tek tek eklendikçe şerit
   kendiliğinden doluyor, kırık görsel çıkmıyor.

## Dosya adları ve bağlantıları

Adlar `lib/posters.ts` ile **birebir** eşleşmeli.

| Dosya (`.webp`) | Afiş | Tıklayınca gider |
|---|---|---|
| `poster-bulasik-makinesi` | ST-DW14LP801EU(C) ankastre bulaşık makinesi | `/kategori/ankastre` |
| `poster-ankastre-buzdolabi` | ST-COM253L01EU(E)NF ankastre buzdolabı | `/kategori/buzdolabi` |
| `poster-black-glass-buzdolabi` | Black Glass buzdolabı SBE90575 | `/kategori/buzdolabi` |
| `poster-camasir-kurutma` | Çamaşır SBE90671 + Kurutma SBE90755 | `/kategori/camasir-makinesi` |
| `poster-jetmax-duo` | Jetmax Duo SUT61070 ütü | `/kategori/utu` |
| `poster-sadem-x-plus` | Sadem X Plus Türk kahve makinesi | `/kategori/icecek-hazirlama` |
| `poster-bikahve-pro` | BiKahve Pro kahve makinesi | `/kategori/icecek-hazirlama` |
| `poster-trodos-sb3120` | Trodos SB-3120 buz makineli su sebili | `/kategori/sebil` |
| `poster-megatron-2` | Megatron 2 şarjlı dikey süpürge | `/kategori/ev-temizligi` |
| `poster-anka-s` | Anka S toz torbasız süpürge | `/kategori/ev-temizligi` |
| `poster-spektron-s` | Spektron S süpürge SET12385 | `/kategori/ev-temizligi` |
| `poster-tanto-pro` | Tanto Pro 1500 el blender seti | `/kategori/gida-hazirlama` |
| `poster-gurmega` | Gurmega tost ve ızgara makinesi | `/kategori/gida-hazirlama` |
| `poster-jett-7020` | Jett 7020 mikrodalga fırın | `/arama?q=mikrodalga` |

## Klima afişi burada DEĞİL

Klima afişi **yatay** (~1350x1000); dikey kartın 595/842 kadrajında kenarları kesilirdi.
Yatay afişlerin yeri üstteki vitrin: `public/banners/` + `components/HeroSlider.tsx`
(orada **1920x700** bekleniyor, afişi o ölçüye getirmek gerekir).

## Sıra, ad ya da bağlantı değiştirmek

Hepsi tek yerde: `lib/posters.ts` → `POSTER_META`. Dizideki sıra şeritteki sıradır.
Kategori adresleri **canlı katalogla doğrulanmalı** (su sebilinin adresi `sebil`,
`su-sebili` değil; televizyonun ERP'de kategorisi yok, o yüzden aramaya gidiyor).

## Ölçü

Kart oranı CSS'te `595/842`'ye sabit (`globals.css` → `.poster-card-img`). Afişler
A4 dikey olduğu sürece kırpılma olmaz. Başka oranda bir afiş eklenecekse önce o
kuralın değişmesi gerekir, yoksa afişin kenarları kesilir.
