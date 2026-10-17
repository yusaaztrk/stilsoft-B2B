import fs from 'node:fs'
import path from 'node:path'

/**
 * Stilsoft'un kendi hazırlattığı DİKEY ürün afişleri (A4, ~595x842).
 *
 * NEDEN AYRI BİR BÖLÜM, HERO SLIDER DEĞİL: anasayfanın üstündeki vitrin
 * (`HeroSlider`) 1920x700 YATAY afişler için kurgulandı ve kadrajı tam o orana
 * sabit (`globals.css` → `.visual-hero-viewport`). Dikey bir afiş oraya konursa
 * `object-fit: cover` üstünü ve altını keser; bu afişlerin bütün metni —ürün adı,
 * stok kodu, özellik listesi— kadrajın içine tasarlandığı için okunmaz hâle gelir.
 * Bu yüzden dikey afişler kendi rayında, kendi oranında dönüyor (`PosterRail`).
 *
 * DOSYA YOKSA AFİŞ HİÇ ÇIKMAZ: liste diskte gerçekten bulunan dosyalarla süzülüyor.
 * Böylece afişler tek tek eklendikçe bölüm kendiliğinden doluyor, eksik dosya da
 * ziyaretçiye kırık görsel olarak görünmüyor.
 *
 * Süzme SUNUCUDA, sayfa üretilirken çalışır — yani yeni afiş eklendikten sonra
 * vitrinin yeniden derlenmesi (ya da ISR süresinin dolması) gerekir.
 */
export type Poster = {
  /** `public/posters/` altındaki dosya adı. */
  file: string
  alt: string
  /** Tıklanınca gidilecek adres. Kategori adresleri canlı katalogla doğrulanmalı. */
  link: string
}

const POSTER_META: Poster[] = [
  {
    file: 'poster-bulasik-makinesi.webp',
    alt: 'Stilsoft ST-DW14LP801EU(C) ankastre bulaşık makinesi — 14 kişilik, 8 program',
    link: '/kategori/ankastre',
  },
  {
    file: 'poster-ankastre-buzdolabi.webp',
    alt: 'Stilsoft ST-COM253L01EU(E)NF ankastre buzdolabı — 253 L, No-Frost',
    link: '/kategori/buzdolabi',
  },
  {
    file: 'poster-black-glass-buzdolabi.webp',
    alt: 'Stilsoft Black Glass buzdolabı — 600 litre, siyah cam kapı, No-Frost',
    link: '/kategori/buzdolabi',
  },
  {
    file: 'poster-camasir-kurutma.webp',
    alt: 'Stilsoft çamaşır makinesi SBE90671 ve kurutma makinesi SBE90755',
    link: '/kategori/camasir-makinesi',
  },
  {
    file: 'poster-jetmax-duo.webp',
    alt: 'Stilsoft Jetmax Duo SUT61070 — hem yatay hem dikey buharlı ütü',
    link: '/kategori/utu',
  },
  {
    file: 'poster-sadem-x-plus.webp',
    alt: 'Stilsoft Sadem X Plus Türk kahve makinesi — 330 ml, dokunmatik kontrol',
    link: '/kategori/icecek-hazirlama',
  },
  {
    file: 'poster-bikahve-pro.webp',
    alt: 'Stilsoft BiKahve Pro tam otomatik kahve makinesi',
    link: '/kategori/icecek-hazirlama',
  },
  {
    file: 'poster-trodos-sb3120.webp',
    alt: 'Stilsoft Trodos SB-3120 buz makineli su sebili',
    link: '/kategori/sebil',
  },
  {
    file: 'poster-megatron-2.webp',
    alt: 'Stilsoft Megatron 2 şarjlı dikey süpürge — 28.8 V, BLDC motor',
    link: '/kategori/ev-temizligi',
  },
  {
    file: 'poster-anka-s.webp',
    alt: 'Stilsoft Anka S toz torbasız dikey elektrikli süpürge — 550 W',
    link: '/kategori/ev-temizligi',
  },
  {
    file: 'poster-spektron-s.webp',
    alt: 'Stilsoft Spektron S elektrikli süpürge SET12385 — 890 W',
    link: '/kategori/ev-temizligi',
  },
  {
    file: 'poster-tanto-pro.webp',
    alt: 'Stilsoft Tanto Pro 1500 el blender seti — doğrayıcı, çırpıcı ve rendeler',
    link: '/kategori/gida-hazirlama',
  },
  {
    file: 'poster-gurmega.webp',
    alt: 'Stilsoft Gurmega tost ve ızgara makinesi — gurme lezzet',
    link: '/kategori/gida-hazirlama',
  },
  {
    file: 'poster-jett-7020.webp',
    alt: 'Stilsoft Jett 7020 mikrodalga fırın — jet hızında çözülme',
    link: '/arama?q=mikrodalga',
  },
  // KLİMA AFİŞİ BURADA DEĞİL: o afiş YATAY (~1350x1000). Dikey kartın 595/842 kadrajında
  // solundan ve sağından kesilirdi. Yatay afişlerin yeri üstteki vitrin — `public/banners/`
  // ve `components/HeroSlider.tsx` (orada 1920x700 bekleniyor).
]

/** Diskte gerçekten bulunan afişler, yukarıdaki sırayla. */
export function listPosters(): Poster[] {
  let present: Set<string>
  try {
    present = new Set(fs.readdirSync(path.join(process.cwd(), 'public', 'posters')))
  } catch {
    return []
  }
  return POSTER_META.filter((p) => present.has(p.file))
}
