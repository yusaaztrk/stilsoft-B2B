import type { Metadata } from 'next'
import BrandIntro from '@/components/BrandIntro'
import HeroSlider from '@/components/HeroSlider'
import CategoryPills from '@/components/CategoryPills'
import TrustBar from '@/components/TrustBar'
import ProductSlider from '@/components/ProductSlider'
import ProductSpotlight from '@/components/ProductSpotlight'
import WhiteGoodsShowcase from '@/components/WhiteGoodsShowcase'
import { SPOTLIGHT_STOCK_CODES, type SpotlightLive } from '@/lib/spotlight'
import PromoBanners from '@/components/PromoBanners'
import BrandStory from '@/components/BrandStory'
import CustomerReviews from '@/components/CustomerReviews'
import FaqAccordion from '@/components/FaqAccordion'
import { WideVisualBanner } from '@/components/HomeVisualBanners'
import PosterRail from '@/components/PosterRail'
import CategoryShowcase from '@/components/CategoryShowcase'
import CatalogsSection from '@/components/CatalogsSection'
import SocialFollow from '@/components/SocialFollow'
import { whatsAppDigits } from '@/lib/companyInfo'
import RecentlyViewed from '@/components/RecentlyViewed'
import { defaultFaqs } from '@/lib/faqs'
import { listPosters } from '@/lib/posters'
import { getProduct, getStorefront, listBestSellers, listCategories, listFeatured, listPdfCatalogs, listProducts } from '@/lib/api'
import { mediaUrl } from '@/lib/format'
import { jsonLdScript } from '@/lib/jsonld'

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'

export const metadata: Metadata = {
  // Başlıkta "Kıbrıs": aramalar bu kelimeyle yapılıyor (bkz. `lib/categorySeo.ts` dosya başı).
  title: 'Stilsoft Kıbrıs — Beyaz Eşya, Ankastre, Televizyon ve Klima',
  /*
    Açıklama ARANAN ürün adlarıyla başlıyor. Eskisi "Ankastre fırınlar, Airfryer fritözler,
    şarjlı dikey süpürgeler" diyordu; bunlar niş aramalar. Ada içinde en çok aranan başlıklar
    buzdolabı, çamaşır makinesi, televizyon ve klima — hiçbiri açıklamada geçmiyordu.
  */
  description:
    'Kıbrıs’ta beyaz eşya, ankastre set, buzdolabı, çamaşır makinesi, televizyon ve klima. Stilsoft resmi mağazası: KKTC geneli ücretsiz teslimat, 3 yıl garanti; ankastre ve beyaz eşyada ücretsiz montaj.',
  keywords: [
    'Stilsoft Kıbrıs',
    'Stilsoft KKTC',
    'Kıbrıs beyaz eşya',
    'KKTC buzdolabı',
    'Kıbrıs çamaşır makinesi',
    'KKTC televizyon',
    'Kıbrıs klima',
    'KKTC ankastre set',
    'Kıbrıs evlilik paketi',
    'Lefkoşa beyaz eşya',
    'Girne beyaz eşya',
    'Gazimağusa beyaz eşya',
    'Stilsoft Yetkili Servis KKTC',
  ],
  alternates: {
    canonical: '/',
  },
  openGraph: {
    title: 'Stilsoft Kıbrıs — Beyaz Eşya, Ankastre, Televizyon ve Klima',
    description:
      'KKTC genelinde ücretsiz teslimat, 3 yıl resmi distribütör garantisi ve randevulu montaj. Stilsoft kalitesini keşfedin.',
    url: siteUrl,
    siteName: 'STILSOFT DEMO',
    locale: 'tr_TR',
    type: 'website',
  },
}

export default async function HomePage() {
  const settings = await getStorefront()

  const [
    featured,
    bestSellers,
    categories,
    ankastreRes,
    kitchenRes,
    beverageRes,
    cleaningRes,
    catalogs,
    buzdolabiRes,
    dondurucuRes,
    camasirRes,
    bulasikRes,
  ] = await Promise.all([
    listFeatured(12),
    // Gerçek sipariş verisinden; sipariş yoksa boş döner ve bölüm hiç görünmez.
    listBestSellers(10, 90),
    listCategories(),
    listProducts({ kategori: 'ankastre', adet: 8 }),
    listProducts({ kategori: 'gida-hazirlama', adet: 8 }),
    listProducts({ kategori: 'icecek-hazirlama', adet: 8 }),
    listProducts({ kategori: 'ev-temizligi', adet: 8 }),
    listPdfCatalogs(),
    /*
      BEYAZ EŞYA (2026-09-21). Asıl satılmak istenen grup bu, o yüzden anasayfada
      sıradan bir ürün şeridi değil kendi koyu bloğu var (bkz. WhiteGoodsShowcase).

      İKİ AYRI ÇAĞRI DEĞİL DÖRT: KKTC kataloğunda beyaz eşya tek kategori değil
      (buzdolabı / derin dondurucu / çamaşır / bulaşık ayrı ayrı duruyor) ve bazılarında
      yalnız 2 ürün var. Tek tek çekip ikişerli gruplara birleştirmek, "Soğutma" bloğunun
      dolu, "Yıkama" bloğunun da boş kalmamasını sağlıyor.
    */
    listProducts({ kategori: 'buzdolabi', adet: 6 }),
    listProducts({ kategori: 'derin-dondurucu', adet: 4 }),
    listProducts({ kategori: 'camasir-makinesi', adet: 4 }),
    listProducts({ kategori: 'bulasik-makinesi', adet: 4 }),
  ])

  /*
    Soğutma grubu: buzdolabı + derin dondurucu. Yıkama grubu: çamaşır + bulaşık.
    Stokta olan ürünler öne alınıyor — koyu blokta ilk göze çarpan kartın "Tükendi" olması
    bloğun tamamını ölü gösterir.
    Dört kart gösteriliyor: ızgara dört sütun, beşincisi ikinci sıraya düşüp bloğu uzatırdı.
  */
  /* Panelde "Çok satanlar" için elle ürün seçilmiş mi — başlık buna göre değişiyor. */
  const eldeSecim = (settings.bestSellerStockCodes ?? []).length > 0

  const stoktaOnce = (a: { inStock: boolean }, b: { inStock: boolean }) =>
    Number(b.inStock) - Number(a.inStock)

  const sogutmaUrunleri = [...buzdolabiRes.items, ...dondurucuRes.items].sort(stoktaOnce).slice(0, 4)
  const yikamaUrunleri = [...camasirRes.items, ...bulasikRes.items].sort(stoktaOnce).slice(0, 4)

  // Spotlight bloğunun fiyatları CANLI: gömülü fiyatlar eskimişti (bkz. ProductSpotlight.tsx).
  const spotlightLive: Record<string, SpotlightLive> = {}
  await Promise.all(
    SPOTLIGHT_STOCK_CODES.map(async (code) => {
      const p = await getProduct(code.toLowerCase()).catch(() => null)
      if (p) spotlightLive[code] = { price: p.grossPrice, currency: p.currency, slug: p.slug, inStock: p.inStock, originalPrice: p.originalGrossPrice ?? null, imageUrl: p.imageUrl ?? null }
    }),
  )

  // Dikey afişler diskten okunuyor: dosya yoksa bölüm hiç çıkmaz (bkz. lib/posters.ts).
  const posters = listPosters()

  // JSON-LD: FAQPage Schema
  const faqSchema = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: defaultFaqs.map((faq) => ({
      '@type': 'Question',
      name: faq.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: faq.answer,
      },
    })),
  }

  // JSON-LD: ItemList Schema (Öne çıkan ürünler için Google Rich Carousel)
  const itemListSchema = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'Öne Çıkan Stilsoft Ürünleri',
    itemListElement: featured.map((item, idx) => ({
      '@type': 'ListItem',
      position: idx + 1,
      name: item.name,
      url: `${siteUrl}/urun/${item.slug}`,
      image: mediaUrl(item.imageUrl) ?? undefined,
    })),
  }

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(faqSchema) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(itemListSchema) }}
      />

      {/* 1. ANA GÖRSEL BANNER SLIDER (SADECE EFEKTLİ BANNER GÖRSELLERİ) */}
      <HeroSlider />


      {/* 2. HIZLI KATEGORİ ÇUBUĞU */}
      <CategoryPills categories={categories} />

      {/* 3. GÜVEN & AVANTAJ BARI (KKTC Teslimat, Garanti, Montaj, 3D Secure) */}
      <TrustBar />

      {/*
        3.2 MARKA BLOĞU (2026-09-21).

        KONUM İKİ KEZ DÜZELTİLDİ. Önce slider'ın ÜSTÜNE konmuştu; kullanıcı "sliderlar
        duracaktı, onun altında olacak" dedi ve hemen altına alındı. Bu sefer de kategori
        çubuğu ile güven şeridini aşağı itti: "bu 2 div slider'ın altında olmalıydı".
        Nihai sıra: afiş → kategori çubuğu → güven şeridi → marka bloğu.

        Mantığı da bu: ilk üç blok ziyaretçiyi ÜRÜNE yönlendiriyor (ne var, neden güvenilir);
        marka anlatısı onların arkasında, okumak isteyen için duruyor.

        Yan kazanç: anasayfada H1 hiç yoktu, artık var (gerekçe bileşende).
      */}
      <BrandIntro logo={settings.logoImageUrl?.trim() || '/stilsoft-logo.png'} />

      {/*
        3.5 BEYAZ EŞYA — SAYFANIN ÜST SIRALARINDA (2026-09-21 kullanıcı kararı:
        "beyaz eşyalarımız üstlerde listelenmeli, zaten amaç beyaz eşya satmak").

        İki blok bilerek ÜST ÜSTE değil aynı yerde: ziyaretçi güven barını geçer geçmez
        satılmak istenen grubu görüyor. Aşağıdaki altı ürün şeridi (ankastre, gıda, içecek,
        temizlik) olduğu yerde kaldı; onlar keşif, bu ikisi hedef.
      */}
      <WhiteGoodsShowcase
        tema="kirmizi"
        rozet="KKTC STOKTAN TESLİM"
        baslik="Buzdolabı & Derin Dondurucu"
        altBaslik="No-Frost soğutma, geniş hacim ve düşük enerji tüketimi. Kapınıza teslim, yerine kurulur."
        maddeler={['Ücretsiz KKTC teslimatı', 'Randevulu yerine kurulum', '3 yıl resmi garanti', 'Eski cihazınız yerinden alınır']}
        tumuLink="/kategori/buzdolabi"
        tumuMetin="Tüm soğutucuları gör"
        items={sogutmaUrunleri}
      />

      <WhiteGoodsShowcase
        tema="gece"
        rozet="YIKAMA GRUBU"
        baslik="Çamaşır & Bulaşık Makineleri"
        altBaslik="Sessiz çalışan invertör motor, yüksek devir ve ekonomik su tüketimi. Montajı dahil."
        maddeler={['Montaj ve su bağlantısı dahil', 'Ücretsiz KKTC teslimatı', '3 yıl resmi garanti', 'Yetkili servis desteği']}
        tumuLink="/kategori/camasir-makinesi"
        tumuMetin="Tüm yıkama grubunu gör"
        items={yikamaUrunleri}
        // Metin sağda, ürünler solda — üstteki bloğun aynası (gerekçe bileşende).
        ters
      />


      {/*
        DİKEY ÜRÜN AFİŞLERİ — kesintisiz kayan şerit.

        YERİ DEĞİŞTİ (2026-09-09 kullanıcı isteği): sayfanın çok aşağısındaydı, ziyaretçilerin
        çoğu oraya hiç inmiyordu. Artık güven şeridinin hemen altında, ilk ekranın devamında.

        Stilsoft'un A4 dikey ürün afişleri (özellik listeli). Üstteki vitrin 1920x700 YATAY
        afişler için; dikey afiş oraya konsa metni kırpılırdı. Bu yüzden kendi oranında,
        kendi rayında. Dosya yoksa bölüm hiç render edilmez (bkz. lib/posters.ts).
      */}
      <PosterRail posters={posters} />

      {/* 4. GÜNÜN FIRSATLARI / ÇOK SATANLAR ÜRÜN SLIDER'I (GENİŞ & SABİT KUTULAR) */}
      {featured.length > 0 && (
        <ProductSlider
          badge="ÖNE ÇIKANLAR"
          title="Stilsoft'un Öne Çıkardıkları"
          subtitle="Ekibimizin seçtiği modeller ve özel fiyatlar"
          viewAllLink="/urunler"
          viewAllText="Tüm Kataloğu Gör"
          items={featured}
        />
      )}

      {/*
        ÇOK SATANLAR — GERÇEK SİPARİŞ VERİSİNDEN (2026-09-21).

        Üstteki "Öne Çıkanlar" bayinin elle seçtikleri. Bu liste son 90 günde gerçekten en çok
        sipariş edilen ürünler; hem doğru malı öne çıkarıyor hem de müşteriye dürüst bir sosyal
        kanıt veriyor. Uydurma "popüler" rozetleri 2026-09-20'de bilerek kaldırılmıştı — bu
        onların yerine geçen, arkasında veri olan hâli.

        Sipariş yoksa (yeni mağaza) bölüm hiç görünmüyor.
      */}
      {bestSellers.length > 0 && (
        <ProductSlider
          /*
            BAŞLIK KAYNAĞA GÖRE DEĞİŞİYOR (2026-09-21).

            Panelden elle ürün seçildiğinde bu liste artık "en çok satanlar" DEĞİL — bayinin
            öne çıkarmak istedikleri. Başlığı olduğu gibi bırakmak müşteriye yanlış bir sosyal
            kanıt vermek olurdu ("bunlar en çok satanlar" diye seçilmiş ürünleri göstermek).
            Uydurma "popüler" rozetleri 2026-09-20'de tam bu yüzden kaldırılmıştı.
          */
          badge={eldeSecim ? 'SEÇTİKLERİMİZ' : 'ÇOK SATANLAR'}
          title={eldeSecim ? 'Bu Ayın Öne Çıkanları' : 'Son 3 Ayın En Çok Satanları'}
          subtitle={
            eldeSecim
              ? 'Stilsoft KKTC ekibinin bu dönem öne çıkardığı modeller'
              : "KKTC'de en çok sipariş edilen Stilsoft modelleri"
          }
          viewAllLink="/urunler"
          viewAllText="Tüm Kataloğu Gör"
          items={bestSellers}
        />
      )}

      {/* 5. ÖNE ÇIKAN ÜRÜN DENEYİMİ & TEKNOLOJİ SPOTLIGHT (ALT DİV) */}
      <ProductSpotlight live={spotlightLive} />

      {/* 6. DİNAMİK KAMPANYA BANNERLARI (4 Kutu Grid) */}
      <PromoBanners />

      {/* 7. GIDA HAZIRLAMA & AIRFRYER SLIDER */}
      {kitchenRes.items.length > 0 && (
        <ProductSlider
          badge="SAĞLIKLI &amp; PRATİK"
          title="Gıda Hazırlama &amp; Airfryer Koleksiyonu"
          subtitle="Hızlı, yağsız çıtır lezzetler ve güçlü mutfak yardımcıları"
          viewAllLink="/kategori/gida-hazirlama"
          viewAllText="Gıda Hazırlama Ürünleri"
          items={kitchenRes.items}
        />
      )}

      {/*
        3X1 ve 2X1 "saf görsel" gridleri KALDIRILDI (bileşenleri duruyor, bkz.
        HomeVisualBanners.tsx). İkisi de yapay zekâyla üretilmiş yer tutucu görselleri
        doldurmak için vardı. Stilsoft'un gerçek afişleri 1920x700 ve içlerinde ürün adı,
        kampanya metni ve marka tipografisi var; sayfa genişliğinin üçte birine (yaklaşık
        420px) sığdırıldıklarında yazılar okunamıyor. Aynı afişlerin tamamı zaten en
        üstteki vitrinde tam genişlikte dönüyor.

        Bu bölümler geri isteniyorsa doğru çözüm kare/dikey ürün görselleri (ör. 800x800)
        hazırlatmak; afişleri küçültmek değil.
      */}


      {/*
        9. KATEGORİ VİTRİNİ — animasyonlu SVG zeminli koyu şerit.

        Öncesinde burada açık zeminli bir ikon rayı vardı; sayfadaki diğer ürün raylarının
        arasında kaybolup yalnızca bir liste gibi duruyordu. Koyu şerit + hareketli vektör
        zemin, kategorileri anasayfanın yön verici alanı hâline getiriyor.
      */}
      {/*
        SON BAKTIKLARINIZ — kategorilerin hemen üstünde (2026-09-20).

        Dönen ziyaretçi için anasayfadaki en değerli blok bu: bıraktığı yerden devam ediyor.
        Hiç ürün bakmamış ziyaretçide (ilk gelen) bileşen kendini hiç göstermiyor, yani
        anasayfa ilk ziyarette aynen eskisi gibi.
      */}
      <div className="wrap">
        <RecentlyViewed />
      </div>

      {settings.showCategories && <CategoryShowcase categories={categories} />}

      {/*
        YATAY GENİŞ GÖRSEL PROMO BANNER — klima afişi (2026-09-09 kullanıcı isteği).

        Önceden burada ankastre set afişi vardı; hemen altındaki bölüm de zaten
        "Ankastre Fırınlar & Mutfak Çözümleri" olduğu için aynı ürün grubu üst üste iki kez
        geliyordu. Klima afişi YATAY (1920x700) olduğu için dikey afiş rayına konamıyor,
        yeri tam olarak burası.
      */}
      <WideVisualBanner
        imgSrc="/banners/slider-klima.webp"
        alt="Stilsoft klima — randevulu montaj ve 3 yıl garanti"
      />

      {/* 9. ANKASTRE FIRIN & MUTFAK SLIDER */}
      {ankastreRes.items.length > 0 && (
        <ProductSlider
          badge="ANKASTRE KOLEKSİYONU"
          title="Ankastre Fırınlar &amp; Mutfak Çözümleri"
          subtitle="75 LT geniş hacim, homojen turbo pişirme ve randevulu ücretsiz montaj"
          viewAllLink="/kategori/ankastre"
          viewAllText="Tüm Ankastreler"
          items={ankastreRes.items}
        />
      )}

      {/* 10. İÇECEK HAZIRLAMA (ÇAY & KAHVE) SLIDER */}
      {beverageRes.items.length > 0 && (
        <ProductSlider
          badge="ÇAY &amp; KAHVE KEYFİ"
          title="Taze İçecek Hazırlama Serisi"
          subtitle="Paslanmaz çelik çay makineleri, filtre kahve ve Türk kahvesi lezzetleri"
          viewAllLink="/kategori/icecek-hazirlama"
          viewAllText="Tüm İçecek Aletleri"
          items={beverageRes.items}
          /* Sayfadaki TEK kırmızı ürün şeridi (2026-09-21 kullanıcı isteği). */
          tema="kirmizi"
        />
      )}

      {/* 11. EV TEMİZLİĞİ & SÜPÜRGE SLIDER */}
      {cleaningRes.items.length > 0 && (
        <ProductSlider
          badge="KABLOSUZ TEMİZLİK"
          title="Şarjlı Dikey Süpürgeler &amp; Temizlik"
          subtitle="BLDC dijital motor, HEPA filtre ve kesintisiz güçlü emiş performansı"
          viewAllLink="/kategori/ev-temizligi"
          viewAllText="Tüm Temizlik Ürünleri"
          items={cleaningRes.items}
        />
      )}

      {/* 12. MARKA HİKAYESİ & KKTC SERVİS VİZYONU */}
      <BrandStory />

      {/* 13. MÜŞTERİ YORUMLARI & DOĞRULANMIŞ DENEYİMLER */}
      <CustomerReviews />

      {/*
        KATALOGLARIMIZ — B2B panelinden yüklenen PDF kataloglar (2026-09-13 kullanıcı isteği:
        sayfanın en üstünde değil, SSS'nin hemen üstünde dursun). Hiç katalog yoksa gizli.
      */}
      <CatalogsSection catalogs={catalogs} />

      {/* 14. SIKÇA SORULAN SORULAR ACCORDION */}
      <FaqAccordion items={defaultFaqs} />

      {/*
        SOSYAL MEDYA — SAYFANIN SONU (2026-09-21).

        Buraya kadar inen ziyaretçi ilgileniyor ama bu ziyarette almayabilir. Takip, onu
        reklam parası harcamadan elde tutmanın yolu: bir dahaki kampanyada karşısına
        ücretsiz çıkıyorsun. Adresi boş olan kanal hiç çizilmiyor.
      */}
      <SocialFollow
        instagram={settings.instagramUrl}
        facebook={settings.facebookUrl}
        youtube={settings.youtubeUrl}
        whatsapp={whatsAppDigits(settings)}
      />
    </>
  )
}
