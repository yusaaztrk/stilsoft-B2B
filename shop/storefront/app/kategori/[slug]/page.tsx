import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, permanentRedirect } from 'next/navigation'
import ProductListing from '@/components/ProductListing'
import { VARSAYILAN_SIRALAMA } from '@/components/ProductListing'
import { getStorefront, listCategories, listCategorySlugRedirects, listKnownCategorySlugs, listProducts } from '@/lib/api'
import { getPost } from '@/lib/blog'
import { kategoriSeo, sssSemasi } from '@/lib/categorySeo'
import { displayName } from '@/lib/format'
import { parseListingFilters, parsePage } from '@/lib/listing'
import { jsonLdScript } from '@/lib/jsonld'

type Params = { slug: string }

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'

/**
 * KATEGORİ SAYFASI İSTEK ANINDA ÜRETİLİR — STATİK DEĞİL.
 *
 * Sayfa `searchParams` okuyor (sıralama, sayfa numarası, fiyat aralığı, stok süzgeci);
 * bu, Next'te sayfayı zorunlu olarak dinamik yapıyor. `generateStaticParams` ile birlikte
 * kullanıldığında üretim derlemesi çalışıyor ama ÇALIŞMA ANINDA her kategori adresi
 * `DYNAMIC_SERVER_USAGE` ile **500** veriyordu (2026-09-08'de üretim derlemesi lokalde
 * ayağa kaldırılıp doğrulandı; hem `next start` hem `node .next/standalone/server.js`).
 *
 * Hata yalnızca üretim derlemesinde çıkıyor — `next dev`'de bütün adresler 200 döndüğü
 * için fark edilmiyordu. Derleme sırasında API'ye ulaşılamazsa kategori listesi boş
 * dönüyor, hiçbir adres önceden üretilmiyor ve site açıldığında bütün kategori sayfaları
 * kırık geliyor.
 *
 * SEO KAYBI YOK: sayfa yine sunucuda render ediliyor, arama motoru tam HTML görüyor.
 * Değişen tek şey, HTML'in derleme anında değil istek anında üretilmesi. Kategori sayfası
 * zaten süzgeçli bir liste; her süzgeç kombinasyonunu önceden üretmek mümkün değildi.
 */
export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { slug } = await params
  const [categories, settings] = await Promise.all([listCategories(), getStorefront()])
  const category = categories.find((c) => c.slug === slug)
  if (!category) return { title: 'Kategori bulunamadı' }

  // Bayi metin yazdıysa açıklama ondan gelir: kategoriye özgü metin, üretilmiş kalıp cümleden
  // hem daha ayırt edici hem daha doğru. Yoksa kalıp devrede kalır — sayfa açıklamasız kalmaz.
  const custom = (settings.categoryTexts?.[slug] ?? '').trim()

  /*
    BAŞLIK ARANAN KELİMEYİ İÇERMELİ (2026-09-21).

    Önceki başlık `${category.name} Modelleri ve Fiyatları` idi. Sorun: mağaza içi kategori
    adları arama kutusuna yazılan kelimeler değil. "Soğutma & Beyaz Eşya" diye kimse
    aramıyor — "buzdolabı kıbrıs" diye arıyor. "Elektro" kategorisi televizyon satıyor ama
    başlığında "televizyon" kelimesi hiç geçmiyordu.

    İkinci eksik: her yerde "KKTC" yazıyorduk, oysa aramalar ağırlıklı olarak "kıbrıs"
    kelimesiyle yapılıyor ve ilk sırada çıkan rakiplerin başlıkları da öyle. Artık ikisi
    birden geçiyor — `title.template` sona "| STILSOFT DEMO" eklediği için "Kıbrıs" başlıkta,
    "KKTC" şablonda duruyor.
  */
  const seo = kategoriSeo(slug, category.name, category.productCount)

  return {
    title: seo.baslik,
    description: custom ? custom.slice(0, 160) : seo.aciklama,
    alternates: { canonical: `/kategori/${category.slug}` },
    openGraph: {
      title: `${seo.baslik} | STILSOFT DEMO`,
      description: custom ? custom.slice(0, 160) : seo.aciklama,
    },
  }
}

export default async function CategoryPage({
  params,
  searchParams,
}: {
  params: Promise<Params>
  searchParams: Promise<{ sayfa?: string; sirala?: string; min?: string; max?: string; stokta?: string }>
}) {
  const { slug } = await params
  const query = await searchParams

  const [categories, settings, redirects] = await Promise.all([
    listCategories(),
    getStorefront(),
    listCategorySlugRedirects(),
  ])

  /*
    ESKİ ADRES -> YENİ ADRES, KALICI YÖNLENDİRME (2026-09-20).

    Bayi kategoriye kendi adresini verdiğinde (G.HAZIR için "gida-hazirlama"), ERP adından
    türeyen eski adres (/kategori/g-hazir) paylaşılmış ve Google'da indekslenmiş olabilir.
    Next'in permanentRedirect'i 308 döndürür (301'in modern karşılığı; Google ikisini de
    kalıcı sayar ve birikmiş sıralamayı yenisine taşır). 307/302 taşımazdı.

    Süzgeç ve sayfa numarası korunuyor: yönlendirme yüzünden ziyaretçinin seçimleri sıfırlanmamalı.
    Mağaza API'si eski adresi de kabul ettiği için, yönlendirme bir sebeple kaçarsa bile
    ziyaretçi boş sayfa değil ürünleri görür.
  */
  const yeniAdres = redirects?.[slug]
  if (yeniAdres && yeniAdres !== slug) {
    const qs = new URLSearchParams(
      Object.entries(query).filter(([, v]) => v !== undefined) as [string, string][]
    ).toString()
    permanentRedirect(`/kategori/${yeniAdres}${qs ? `?${qs}` : ''}`)
  }

  let category = categories.find((c) => c.slug === slug)

  /*
    YAYINDA ÜRÜNÜ KALMAYAN KATEGORİ 404 OLMAMALI (2026-09-09).

    `listCategories()` yalnızca yayında ürünü OLAN kategorileri veriyor. Stok kuralı devreye
    girince (biten ve kritik stok eşiğinin altındaki ürünler vitrinden kalkıyor) bir
    kategorinin ürünlerinin tamamı geçici olarak düşebiliyor. Menüdeki ve altbilgideki
    kategori bağlantıları SABİT YAZILI olduğu için ziyaretçi bir anda kırık bağlantıya
    tıklıyordu — üstelik stok gelince kendiliğinden düzelen, yani yakalanması zor bir hâl.

    Adres ERP'de tanımlı bir kategoriye karşılık geliyorsa sayfa açılıyor ve liste kendi boş
    durumunu gösteriyor. Bilinmeyen adres HÂLÂ 404: aksi hâlde her uydurma adres 200 döner.
  */
  if (!category) {
    const known = await listKnownCategorySlugs()
    if (!known.includes(slug)) notFound()

    category = { slug, name: displayName(slug.replace(/-/g, ' ')), productCount: 0, imageUrl: null }
  }

  const text = (settings.categoryTexts?.[slug] ?? '').trim()

  /*
    KATEGORİ SAYFASI YAPISAL VERİSİ — ItemList (2026-09-21).

    Ürün sayfasında Product + BreadcrumbList vardı, kategori sayfasında hiçbir şey yoktu.
    ItemList, Google'ın kategori sayfasını "şu ürünleri listeleyen sayfa" olarak anlamasını
    sağlıyor; arama sonucunda ürün adlarıyla zengin sonuç çıkma ihtimalini artırıyor.

    Yalnız İLK SAYFA için üretiliyor: ikinci sayfanın listesi Google için ayrı bir sinyal
    değil, tekrar eden veri olurdu.
  */
  const sayfa = parsePage(query.sayfa)
  const ilkSayfa = sayfa === 1 ? (await listProducts({ kategori: category.slug, adet: 24 })).items : []

  const itemListLd =
    ilkSayfa.length > 0
      ? {
          '@context': 'https://schema.org',
          '@type': 'ItemList',
          name: category.name,
          numberOfItems: ilkSayfa.length,
          itemListElement: ilkSayfa.map((u, i) => ({
            '@type': 'ListItem',
            position: i + 1,
            url: `${siteUrl}/urun/${u.slug}`,
            name: displayName(u.name),
          })),
        }
      : null

  /*
    KATEGORİ METNİ VE SSS (2026-09-21).

    Kategori sayfasında ürün kartlarından başka HİÇBİR metin yoktu. Arama motorunun
    okuyup "bu sayfa buzdolabını anlatıyor" diyebileceği tek satır yazı bulunmuyordu;
    ilk sırada çıkan rakiplerin kategori sayfalarında ise uzun tanıtım metni ve soru-cevap
    var. Metinler `lib/categorySeo.ts` içinde, gerekçesi de orada yazılı.

    PANEL METNİ ÖNCELİKLİ: bayi panelden metin yazdıysa kalıp metin hiç basılmıyor —
    elle yazılmış metin her zaman kalıptan iyidir.
  */
  const seo = kategoriSeo(category.slug, category.name, category.productCount)
  const metinler = text ? text.split(/\n{2,}/).map((p) => p.trim()) : seo.metin
  const sssLd = sssSemasi(seo.sss)

  /*
    BREADCRUMB ŞEMASI (2026-09-21).

    Ürün sayfasında vardı, kategori sayfasında yoktu. Google arama sonucunda adres yerine
    "example.com › Buzdolabı" biçiminde bir yol gösteriyor; rakiplerin sonuçlarında
    (bekokibris.com › urun-grubu › ankastre) bu yol görünüyordu, bizimkinde görünmüyordu.
    Tıklanma oranını doğrudan etkileyen, maliyeti sıfır bir eksikti.
  */
  const breadcrumbLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Anasayfa', item: siteUrl },
      { '@type': 'ListItem', position: 2, name: 'Kategoriler', item: `${siteUrl}/urunler` },
      {
        '@type': 'ListItem',
        position: 3,
        name: category.name,
        item: `${siteUrl}/kategori/${category.slug}`,
      },
    ],
  }

  // Yazı listesi slug'dan çözülüyor; olmayan slug null döner ve elenir (kırık bağlantı yok).
  const rehberler = (seo.yazilar ?? [])
    .map((s) => getPost(s))
    .filter((p): p is NonNullable<typeof p> => p !== null)
    .slice(0, 4)

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(breadcrumbLd) }}
      />
      {itemListLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: jsonLdScript(itemListLd) }}
        />
      )}
      {sssLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: jsonLdScript(sssLd) }}
        />
      )}

      <ProductListing
        title={category.name}
        categorySlug={category.slug}
        page={sayfa}
        sort={query.sirala ?? VARSAYILAN_SIRALAMA}
        basePath={`/kategori/${category.slug}`}
        filters={parseListingFilters(query)}
      />

      {/*
        Tanıtım metni ürünlerin ALTINDA: alışverişe gelen ziyaretçinin önüne metin koymak
        satın alma yolunu uzatır. Arama motoru sayfanın tamamını okuduğu için konumun SEO
        açısından bir kaybı yok.
      */}
      {metinler.length > 0 && (
        <div className="wrap category-text">
          <h2>
            {seo.anahtar ? `Kıbrıs’ta ${seo.anahtar} alırken` : `${category.name} hakkında`}
          </h2>
          {/* Giriş cümlesi yalnız kalıp metinde var; bayi kendi metnini yazdıysa onunki geçerli. */}
          {!text && seo.giris && <p className="category-text-giris">{seo.giris}</p>}
          {metinler.map((paragraph, index) => (
            <p key={index}>{paragraph}</p>
          ))}
        </div>
      )}

      {/*
        SIK SORULAN SORULAR — hem ziyaretçi için hem FAQPage şeması için.

        Sorular gerçek arama sorgularının karşılığı ("klima kaç btu olmalı", "buzdolabı kaç
        litre"). Arama sonucunda açılır soru-cevap olarak görünme ihtimali buradan geliyor;
        şema yukarıda basılıyor.
      */}
      {seo.sss.length > 0 && (
        <div className="wrap category-sss">
          <h2>Sık sorulan sorular</h2>
          <div className="category-sss-liste">
            {seo.sss.map((s) => (
              <details key={s.q}>
                <summary>{s.q}</summary>
                <p>{s.a}</p>
              </details>
            ))}
          </div>
        </div>
      )}

      {/*
        İLGİLİ REHBERLER — kategoriden blog yazısına iç bağlantı.

        Gerekçe `lib/categorySeo.ts` içindeki `yazilar` alanının başında yazılı: blog
        yalnızca altbilgiden bağlıydı. Var olmayan bir slug yazılmışsa `getPost` null
        döndüğü için o bağlantı sessizce çizilmiyor — kırık bağlantı oluşmuyor.
      */}
      {rehberler.length > 0 && (
        <div className="wrap category-rehber">
          <h2>{seo.anahtar ? `${category.name} seçim rehberleri` : 'İlgili rehberler'}</h2>
          <div className="category-rehber-liste">
            {rehberler.map((post) => (
              <Link key={post.slug} href={`/blog/${post.slug}`} className="category-rehber-kart">
                <b>{post.title}</b>
                <span>{post.excerpt}</span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </>
  )
}
