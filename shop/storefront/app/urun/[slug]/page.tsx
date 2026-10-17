import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import AddToCartButton from '@/components/AddToCartButton'
import StockAlertForm from '@/components/StockAlertForm'
import CallbackForm from '@/components/CallbackForm'
import { KURUMSAL_DANISMAN } from '@/lib/companyInfo'
import ProductStickyBar from '@/components/ProductStickyBar'
import SetCompletion from '@/components/SetCompletion'
import RecentlyViewed, { ViewTracker } from '@/components/RecentlyViewed'
import ChatProductBeacon from '@/components/ChatProductBeacon'
import { TrackViewItem } from '@/components/TrackEvents'
import ProductCard from '@/components/ProductCard'
import ProductGallery from '@/components/ProductGallery'
import ProductSpecsTab from '@/components/ProductSpecsTab'
import ShareButton from '@/components/ShareButton'
import { getInstallmentInfo, getProduct, getStorefront, listAllSlugs, listProducts } from '@/lib/api'
import { resolveCompanyInfo, whatsAppDigits } from '@/lib/companyInfo'
import { displayName, formatPrice, mediaUrl, stockLabel } from '@/lib/format'
import { jsonLdScript } from '@/lib/jsonld'
import ProductFaq from '@/components/ProductFaq'
import InstallmentTable from '@/components/InstallmentTable'
import { setBasligi, setOnerileri, urunTipi } from '@/lib/setCompletion'

type Params = { slug: string }

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'

/** Yayındaki tüm ürün adresleri önceden üretilir — Google'ın tarayacağı sayfalar bunlar. */
export async function generateStaticParams(): Promise<Params[]> {
  const slugs = await listAllSlugs()
  return slugs.map((slug) => ({ slug }))
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { slug } = await params
  const product = await getProduct(slug)
  if (!product) return { title: 'Ürün bulunamadı' }

  const name = displayName(product.name)
  const image = mediaUrl(product.imageUrl)

  /*
    BAŞLIKTA "KIBRIS" (2026-09-21).

    Ada içinde model araması neredeyse hiç kuru model adıyla yapılmıyor; "<model> kıbrıs",
    "<model> kıbrıs fiyat" biçiminde yapılıyor. Başlıkta yalnızca ürün adı vardı ve şablon
    sona "| STILSOFT DEMO" ekliyordu — yani "kıbrıs" kelimesi başlıkta hiç geçmiyordu.
    Aynı gerekçe kategori sayfalarında da uygulandı (bkz. `lib/categorySeo.ts`).

    Uzun ürün adlarında başlık şişmesin diye "Fiyatı ve Özellikleri" kısaltılıp yerine
    "Kıbrıs" konmadı; ikisi de duruyor çünkü "fiyat" kelimesi arama sorgularında en az
    "kıbrıs" kadar sık geçiyor.
  */
  /*
    AÇIKLAMA HER ZAMAN SATIŞ CÜMLESİYLE BAŞLIYOR (2026-10-05 kullanıcı isteği: "tüm ürünlerde en
    üstte çıkmamız lazım, SEO'yu güçlendir"). Eskiden ürün açıklaması varsa onun ilk 160
    karakteri kullanılıyordu: çoğu üründe teknik metin ("A+++ enerji, 60 cm…"), içinde ne fiyat
    ne "Kıbrıs" ne de teslimat vardı. Arama sonucunda tıklatan şey bu cümle; açıklama sona,
    kalan yere ekleniyor.
  */
  const fiyat = (product.grossPrice ?? 0) > 0 ? ` ${formatPrice(product.grossPrice, product.currency)}` : ''
  const satisCumlesi = `${name} Kıbrıs fiyatı${fiyat}. KKTC geneli ücretsiz teslimat, 3 yıl distribütör garantisi, taksit imkânı.`
  const ekAciklama = (product.description ?? '').replace(/\s+/g, ' ').trim()
  const tamMetin = ekAciklama ? `${satisCumlesi} ${ekAciklama}` : satisCumlesi
  const metaDescription =
    tamMetin.length <= 160 ? tamMetin : tamMetin.slice(0, 158).replace(/\s+\S*$/, '') + '…'

  return {
    title: `${name} Fiyatı — Kıbrıs`,
    description: metaDescription,
    alternates: { canonical: `/urun/${product.slug}` },
    openGraph: {
      title: `${name} — Kıbrıs Fiyatı | STILSOFT`,
      description: metaDescription,
      images: image ? [image] : undefined,
      type: 'website',
    },
  }
}

export default async function ProductPage({ params }: { params: Promise<Params> }) {
  const { slug } = await params
  const [product, latestData, settings] = await Promise.all([
    getProduct(slug),
    listProducts({ sirala: 'yeni', adet: 8 }),
    getStorefront(),
  ])
  if (!product) notFound()

  const name = displayName(product.name)
  // Telefonla / WhatsApp'la sipariş: bu kitle konuşarak alır (2026-09-20).
  const companyPhone = resolveCompanyInfo(settings).phone
  const phoneHref = `tel:${companyPhone.replace(/[^\d+]/g, '')}`
  const waHref = `https://wa.me/${whatsAppDigits(settings)}?text=${encodeURIComponent(`Merhaba, ${name} (${product.stockCode}) ürününü sipariş etmek istiyorum.`)}`
  const images = product.images.map(mediaUrl).filter((x): x is string => Boolean(x))

  // Aynı kategoriden diğer ürünler
  /*
    Kategori havuzu bir kez çekiliyor ve İKİ yerde kullanılıyor: aşağıdaki "benzer ürünler"
    şeridi ve "setini tamamla" bloğu. Set önerisi tamamlayıcı TİPİ arıyor (fırına ocak),
    dolayısıyla ilk 5 ürün yetmez — kategori genelinden seçiyor. Liste 300 sn önbellekli.
  */
  const kategoriHavuzu = product.categorySlug
    ? (await listProducts({ kategori: product.categorySlug, adet: 96 })).items
    : []

  const related = kategoriHavuzu
    .filter((x) => x.stockCode !== product.stockCode)
    .slice(0, 4)

  // SETİNİ TAMAMLA (2026-09-20) — sepeti büyüten asıl blok; bkz. lib/setCompletion.ts
  const setUrunleri = setOnerileri(product, kategoriHavuzu, 2)

  // Son Eklenen / Öne Çıkan Diğer Ürünler
  const latestProducts = latestData.items
    .filter((x) => x.stockCode !== product.stockCode)
    .slice(0, 4)

  // Taksit tablosu: ERP kurallarından, tutara göre (2026-09-21).
  const installmentInfo = await getInstallmentInfo(product.grossPrice ?? 0)

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name,
    sku: product.stockCode,
    gtin13: product.barcode ?? undefined,
    image: images,
    description: product.description ?? name,
    brand: { '@type': 'Brand', name: 'STILSOFT' },
    offers: {
      '@type': 'Offer',
      url: `${siteUrl}/urun/${product.slug}`,
      priceCurrency: product.currency === 'TRY' ? 'TRY' : product.currency,
      price: (product.grossPrice ?? 0).toFixed(2),
      availability: product.inStock
        ? 'https://schema.org/InStock'
        : 'https://schema.org/OutOfStock',
      itemCondition: 'https://schema.org/NewCondition',
      // Google ürün sonuçları "geçerlilik tarihi" istiyor; fiyat her derlemede yenilendiği
      // için 30 gün ileri yeterli (2026-10-05).
      priceValidUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      seller: { '@type': 'Organization', name: 'STILSOFT DEMO' },
      // Ücretsiz teslimat — arama sonucunda "Ücretsiz kargo" etiketi için (2026-10-05).
      shippingDetails: {
        '@type': 'OfferShippingDetails',
        shippingRate: { '@type': 'MonetaryAmount', value: 0, currency: product.currency === 'TRY' ? 'TRY' : product.currency },
        shippingDestination: { '@type': 'DefinedRegion', addressCountry: 'CY' },
      },
    },
  }

  const breadcrumbLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Anasayfa', item: siteUrl },
      ...(product.categorySlug
        ? [{
            '@type': 'ListItem',
            position: 2,
            name: product.categoryName ?? 'Kategori',
            item: `${siteUrl}/kategori/${product.categorySlug}`,
          }]
        : []),
      {
        '@type': 'ListItem',
        position: product.categorySlug ? 3 : 2,
        name,
        item: `${siteUrl}/urun/${product.slug}`,
      },
    ],
  }

  return (
    <div className="wrap pdp-page-container">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(jsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(breadcrumbLd) }}
      />

      {/* Breadcrumb Nav */}
      <div className="crumbs">
        <Link href="/">Anasayfa</Link>
        <span>›</span>
        {product.categorySlug ? (
          <>
            <Link href={`/kategori/${product.categorySlug}`}>{product.categoryName}</Link>
            <span>›</span>
          </>
        ) : null}
        <span>{name}</span>
      </div>

      {/* Ana PDP Vitrin Bloğu */}
      <div className="pdp">
        <ProductGallery images={images} name={name} />

        <div className="pdp-info">
          <div className="pdp-top-meta-row">
            <span className="p-brand">STILSOFT · {product.stockCode}</span>
            <ShareButton title={name} />
          </div>

          <h1>{name}</h1>

          {Number(product.originalGrossPrice ?? 0) > product.grossPrice && (
            <div className="p-orig-row" title={product.campaignName ?? 'Kampanya'}>
              <span className="p-orig num">{formatPrice(Number(product.originalGrossPrice), product.currency)}</span>
              <span className="p-discount-chip">
                {product.campaignPercent != null && product.campaignPercent > 0
                  ? `-%${Math.round(product.campaignPercent)}`
                  : `-${formatPrice(Number(product.originalGrossPrice) - product.grossPrice, product.currency)}`}
              </span>
              {product.campaignName ? <span className="p-vat">{product.campaignName}</span> : null}
            </div>
          )}
          <div className="pdp-price num">{formatPrice(product.grossPrice, product.currency)}</div>
          <div className="pdp-meta">
            <span>KDV dahil</span>
            {product.unit ? <span>Birim: {product.unit}</span> : null}
            {product.barcode ? <span className="num">Barkod: {product.barcode}</span> : null}
          </div>

          {/* Taksit seçenekleri — "kaç taksit?" sorusunun cevabı kart numarası girmeden (2026-09-21). */}
          <InstallmentTable info={installmentInfo} currency={product.currency} />


          {/*
            Stok satırı. Adet yalnızca bayi "stok adedi görünsün" ayarını açtıysa GELİR
            (mağaza API'si kapalıyken alanı hiç göndermiyor), o yüzden burada ayar kontrolü
            yok — sayı varsa yazılır.
          */}
          <span className={product.inStock ? 'stock-line' : 'stock-line out'}>
            <i />
            {product.inStock
              ? stockLabel(product.stockQuantity, product.stockCapped)
                ? `Stokta ${stockLabel(product.stockQuantity, product.stockCapped)} adet — Hemen Teslim`
                : 'Stokta — Hemen Teslim'
              : 'Stok İçin Bize Ulaşın'}
          </span>

          <div className="pdp-actions">
            {/*
              Stokta olmayan üründe sepet düğmesi yerine iletişim yolu veriliyor. Düğme
              çalışmaya devam etseydi (eski hâl) müşteri "Stok İçin Bize Ulaşın" yazan ürünü
              satın alıp parasını ödeyebiliyordu. Sunucu tarafındaki kapı asıl koruma; burası
              müşteriyi çıkmaza sokmamak için.
            */}
            {/*
              RENK SEÇENEKLERİ (2026-09-20).

              ERP'de her renk ayrı stok kodu. Listede tek kart gösteriliyor; müşteri diğer
              renge buradan geçiyor. Seçenekler bağlantı (istemci durumu yok): her rengin
              kendi adresi, kendi fiyatı ve kendi stoğu var, sunucuda render edilip arama
              motoruna da görünüyor. Sepete eklenen kod, o an açık olan rengin kodu.
            */}
            {product.variants && product.variants.length > 1 && (
              <div className="pdp-variants">
                <span className="pdp-variants-label">Renk</span>
                <div className="pdp-variants-list">
                  {product.variants.map((v) => {
                    const secili = v.stockCode === product.stockCode
                    return (
                      <Link
                        key={v.stockCode}
                        href={`/urun/${v.slug}`}
                        className={`pdp-variant${secili ? ' is-selected' : ''}${v.inStock ? '' : ' is-out'}`}
                        aria-current={secili ? 'true' : undefined}
                        title={v.inStock ? v.label : `${v.label} — tükendi`}
                      >
                        {v.label}
                        {!v.inStock && <span className="pdp-variant-out">tükendi</span>}
                      </Link>
                    )
                  })}
                </div>
              </div>
            )}

            {product.inStock ? (
              <AddToCartButton
                stockCode={product.stockCode}
                installable={product.isInstallable}
                installationFee={product.installationFee}
                currency={product.currency}
                showQuantity
              />
            ) : (
              /*
                TÜKENDİ (2026-09-20). Önceden buradaki tek seçenek "/iletisim" bağlantısıydı:
                müşteri iletişim sayfasına gidiyor, formu doldurmuyor ve kayboluyordu.
                Artık telefonunu bırakıp stok gelince SMS alıyor; bayi de "bu ürünü kaç kişi
                bekliyor" listesini görüyor.
              */
              <StockAlertForm stockCode={product.stockCode} />
            )}
            <Link className="btn btn-line" href="/teslimat">
              Teslimat &amp; Kurulum
            </Link>
          </div>

          {/*
            MOBİLDE YAPIŞKAN SATIN ALMA ÇUBUĞU (2026-09-21).

            Nişan tam burada: satın alma alanının bittiği nokta. Müşteri teknik özelliklere
            doğru kaydırdığında "Sepete ekle" ekrandan çıkıyor ve çubuk açılıyor.
            Tükenmiş üründe hiç çizilmiyor — sepete eklenemeyecek bir düğmeyi ekrana
            yapıştırmak, müşteriyi çalışmayan bir düğmeye bastırmak olurdu.
          */}
          {product.inStock && (
            <ProductStickyBar
              stockCode={product.stockCode}
              name={name}
              price={formatPrice(product.grossPrice, product.currency)}
              installable={product.isInstallable}
              installationFee={product.installationFee}
              currency={product.currency}
            />
          )}

          {/* Hızlı Güven & Teslimat Özeti — CTA'nın HEMEN altında (2026-09-21): telefonda bu kutu
              geri arama formunun altına, ikinci ekranın dibine düşüyordu; güven sinyali karar anında görünmeli. */}
          <div className="pdp-quick-trust-box">
            <div className="quick-trust-row">
              <span className="q-dot" />
              <span><b>3 Yıl Garanti:</b> Resmi KKTC Distribütör Güvencesi</span>
            </div>
            <div className="quick-trust-row">
              <span className="q-dot" />
              <span><b>Ücretsiz Teslimat:</b> {settings.deliveryPromise?.trim() || 'Tüm KKTC ilçelerine randevulu nakliye'}</span>
            </div>
            {/*
              Montaj satırı bedele göre değişiyor. ERP'de `InstallationFee` girilmiş
              ürünlerde (televizyonlar) montaj ÜCRETLİ ve bedel sepette genel toplama
              ekleniyor; burada "ücretsiz" yazmak müşteriyi ödeme adımında şaşırtırdı.
            */}
            {product.isInstallable && (
              <div className="quick-trust-row">
                <span className="q-dot" />
                {(product.installationFee ?? 0) > 0 ? (
                  <span>
                    <b>Yetkili Montaj:</b> Randevulu profesyonel kurulum —{' '}
                    {formatPrice(product.installationFee ?? 0, product.currency)} (KDV dahil,
                    sepette eklenir)
                  </span>
                ) : (
                  <span><b>Yetkili Montaj:</b> Randevulu ücretsiz profesyonel kurulum</span>
                )}
              </div>
            )}
          </div>
          {/* Telefonla sipariş — internetten ödeme yapmak istemeyen müşteri için (2026-09-20). */}
          <div className="pdp-phone-order">
            <span>İnternetten sipariş vermek istemiyor musunuz?</span>
            <a className="btn btn-line" href={phoneHref}>Telefonla sipariş: {companyPhone}</a>
            <a className="btn btn-line" href={waHref} target="_blank" rel="noopener noreferrer">WhatsApp ile sipariş</a>
          </div>

          {/*
            SİZİ ARAYALIM (2026-09-21) — telefonla sipariş bloğunun ÜÇÜNCÜ seçeneği.

            Üstteki iki düğme müşterinin ŞU AN arayabildiğini varsayıyor. Ziyaretin önemli
            bölümü mesai dışında geliyor: o müşteri arayamıyor, WhatsApp'a da yazmıyor ve
            iz bırakmadan çıkıyordu. Burası onun numarasını bıraktığı yer; talep panele
            düşüyor ve sabah aranıyor. SMS sağlayıcı bilgisi girilmemiş olsa bile çalışır.
          */}
          <CallbackForm
            kaynak="urun"
            stockCode={product.stockCode}
            productName={name}
          />

          {/*
            TOPLU ALIM SATIRI (2026-10-04): otel, proje, ofis müşterisi tek tek sepete atmıyor;
            kurumsal satış danışmanına yönlendiriliyor. Mesajda ürün adı hazır gidiyor.
          */}
          <div className="pdp-kurumsal">
            <span>
              <b>Toplu alım mı?</b> Otel, proje ve ofisler için özel fiyat — {KURUMSAL_DANISMAN.ad}
            </span>
            <span className="pdp-kurumsal-btns">
              <a
                href={`https://wa.me/${KURUMSAL_DANISMAN.whatsappDijit}?text=${encodeURIComponent(
                  `Merhaba Esra Hanım, ${name} için toplu alım teklifi almak istiyorum.`,
                )}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                WhatsApp
              </a>
              <Link href="/kurumsal-satis">Kurumsal satış →</Link>
            </span>
          </div>

        </div>
      </div>

      {/*
        Görüntüleme kaydı (2026-09-20) — "son baktıklarınız" için, yalnız tarayıcıda.
        Ekrana hiçbir şey basmaz.
      */}
      <ViewTracker
        urun={{
          stockCode: product.stockCode,
          slug: product.slug,
          name: product.name,
          imageUrl: product.imageUrl,
          grossPrice: product.grossPrice,
          currency: product.currency,
        }}
      />

      {/*
        WhatsApp balonuna ürün bağlamı (2026-09-21) — ekrana bir şey basmaz.
        Balona basıldığında giden mesajın altına ürün adı, kodu, fiyatı ve adresi eklenir.
      */}
      <ChatProductBeacon
        name={name}
        stockCode={product.stockCode}
        price={formatPrice(product.grossPrice, product.currency)}
        url={`${siteUrl}/urun/${product.slug}`}
      />

      {/* Reklam ölçümü (2026-10-15): GA4 view_item + Meta ViewContent. Ekrana bir şey basmaz. */}
      <TrackViewItem
        stockCode={product.stockCode}
        name={name}
        price={product.grossPrice}
        category={product.categoryName}
      />

      {/*
        SETİNİ TAMAMLA — teknik özelliklerden ÖNCE (2026-09-20).

        Müşteri kararını ürünü görüp fiyatı okuduktan hemen sonra veriyor; teknik özellik
        sekmelerinin altına konsa çoğu ziyaretçi oraya hiç inmiyor. Ankastre mutfak set olarak
        kurulduğu için burada sorulan "ocağı da ister misin" sorusu doğal, sepeti büyüten de bu.
      */}
      {product.inStock && setUrunleri.length > 0 && (
        <SetCompletion
          baslik={setBasligi(urunTipi(product.name))}
          mevcut={{
            stockCode: product.stockCode,
            name: product.name,
            grossPrice: product.grossPrice,
            imageUrl: product.imageUrl,
            slug: product.slug,
          }}
          urunler={setUrunleri}
          currency={product.currency}
        />
      )}

      {/* Ayrıntılı Ürün Açıklaması & Teknik Özellikler Tabları */}
      <ProductSpecsTab product={product} />

      {/* Sıkça sorulan sorular + FAQPage yapısal verisi (2026-09-21) — telefonla sorulan
          teslimat/montaj/garanti/ödeme sorularının sayfada cevabı. */}
      <ProductFaq product={product} settings={settings} phone={companyPhone} />

      {/* Mobil Yapışkan Satın Alma Çubuğu */}
      <div className="buybar">
        <div className="buybar-price">
          <span>KDV dahil</span>
          <b className="num">{formatPrice(product.grossPrice, product.currency)}</b>
        </div>
        {product.inStock ? (
          <AddToCartButton
            stockCode={product.stockCode}
            className="btn btn-dark btn-sm buybar-action"
            installable={product.isInstallable}
            installationFee={product.installationFee}
            currency={product.currency}
            hideInstallOption
          />
        ) : (
          <Link className="btn btn-dark btn-sm buybar-action" href="/iletisim">
            Stok için ulaşın
          </Link>
        )}
      </div>

      {/* Son baktıkları — dönen ziyaretçiyi kaldığı yere döndürür (2026-09-20). */}
      <RecentlyViewed haricTut={product.stockCode} />

      {/* 1. Kategori Bazlı Benzer Ürünler */}
      {related.length > 0 && (
        <section className="related-section">
          <div className="block-head">
            <div>
              <h2>Benzer Modeller</h2>
              <p>{product.categoryName} kategorisindeki diğer alternatifler</p>
            </div>
            {product.categorySlug && (
              <Link className="textlink" href={`/kategori/${product.categorySlug}`}>
                Kategorinin Tamamı →
              </Link>
            )}
          </div>

          <div className="grid">
            {related.map((item) => (
              <ProductCard key={item.stockCode} item={item} />
            ))}
          </div>
        </section>
      )}

      {/* 2. Son Eklenen & Popüler Ürünler */}
      {latestProducts.length > 0 && (
        <section className="related-section latest-products-section">
          <div className="block-head">
            <div>
              <h2>Son Eklenen Stilsoft Ürünleri</h2>
              <p>Vitrine yeni giren ve en çok incelenen diğer modeller</p>
            </div>
            <Link className="textlink" href="/urunler">
              Tüm Ürünler →
            </Link>
          </div>

          <div className="grid">
            {latestProducts.map((item) => (
              <ProductCard key={item.stockCode} item={item} />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
