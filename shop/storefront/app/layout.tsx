import type { Metadata } from 'next'
import { Montserrat } from 'next/font/google'
import './globals.css'
import ClientProviders from '@/components/ClientProviders'
import SiteHeader from '@/components/SiteHeader'
import SiteFooter from '@/components/SiteFooter'
import { getStorefront } from '@/lib/api'
import CallButton from '@/components/CallButton'
import { COMPANY_FALLBACK, resolveCompanyInfo } from '@/lib/companyInfo'
import { jsonLdScript } from '@/lib/jsonld'

const montserrat = Montserrat({
  subsets: ['latin', 'latin-ext'],
  weight: ['100', '200', '300', '400', '500', '600', '700', '800', '900'],
  variable: '--font-montserrat',
  display: 'swap',
})

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'

/**
 * Başlık kalıbı arama sonucunda ne göründüğünü belirliyor: her sayfa kendi başlığını verir,
 * sonuna marka eklenir. Boş bırakılırsa Google sayfadan rastgele bir metin seçer.
 *
 * ANASAYFA BAŞLIĞINDA "KIBRIS" (2026-09-21): başlık yalnızca "KKTC" diyordu, oysa aramalar
 * ağırlıklı olarak "kıbrıs beyaz eşya", "kıbrıs çamaşır makinesi" biçiminde yapılıyor ve
 * ilk sırada çıkan rakiplerin başlıkları da "… Kıbrıs" kalıbında. Şablon zaten sona
 * "| STILSOFT DEMO" eklediği için iç sayfalarda iki kelime birden bulunuyor.
 */
export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: 'Stilsoft Kıbrıs — Beyaz Eşya, Ankastre, Televizyon ve Klima',
    template: '%s | STILSOFT DEMO',
  },
  description:
    'Kıbrıs’ta beyaz eşya, ankastre set, televizyon, klima ve küçük ev aletleri. KKTC geneli — Lefkoşa, Girne, Gazimağusa — ücretsiz teslimat, 3 yıl garanti; ankastre ve beyaz eşyada ücretsiz montaj.',
  openGraph: {
    type: 'website',
    locale: 'tr_TR',
    siteName: 'STILSOFT DEMO',
    title: 'Stilsoft Kıbrıs — Beyaz Eşya, Ankastre, Televizyon ve Klima',
    description:
      'Kıbrıs geneline adrese ücretsiz teslimat, 3 yıl distribütör garantisi ve yetkili servis kurulumu.',
  },
  robots: { index: true, follow: true },
}

const websiteLd = {
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  name: 'STILSOFT DEMO',
  url: siteUrl,
  inLanguage: 'tr-TR',
  potentialAction: {
    '@type': 'SearchAction',
    target: { '@type': 'EntryPoint', urlTemplate: `${siteUrl}/arama?q={search_term_string}` },
    'query-input': 'required name=search_term_string',
  },
}

/**
 * Sepet burada SUNUCUDA OKUNMUYOR (eskiden `getCart()` çağrılıyordu). Sebep: `getCart()`
 * `cookies()` okuyor ve bu, KÖK layout içinde çağrıldığı için sitedeki HER sayfayı (anasayfa,
 * ürün, kategori dahil) statik/ISR üretimden çıkarıp tam dinamik render'a zorluyordu — ürün
 * sayfası her ziyarette sıfırdan sunucu render + veritabanı sorgusu demekti (2026-09-05
 * denetiminde bulundu, `hız doğrudan sıralama sinyali` ilkesiyle çelişiyordu).
 * `CartProvider` zaten `initialCart` boş geldiğinde `/api/cart`'ı İSTEMCİDEN çekiyor
 * (`context/CartContext.tsx`); API rotaları statik üretimi etkilemiyor. Sonuç: sepet rakamı
 * hidrasyondan hemen sonra dolar, sayfanın geri kalanı artık önbelleklenebilir.
 */
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Basit bir revalidate-önbellekli fetch (bkz. lib/api.ts) — cookies() OKUMUYOR, dolayısıyla
  // yukarıdaki performans notunu bozmuyor: sayfalar statik/ISR kalmaya devam eder.
  const settings = await getStorefront()

  /**
   * `Organization` yapısal verisi arama sonucundaki marka kartını (isim, logo, iletişim)
   * besliyor. Daha önce burada var olmayan bir dosyaya (`/logo.png` — public/ klasöründe hiç
   * yok) ve panelde ayarlanandan FARKLI, kaynağı belirsiz bir telefon numarasına
   * (+90-392-000-0000) sabit kod olarak işaret ediyordu (2026-09-05 denetiminde bulundu).
   * Google'a kırık bir logo adresi ve muhtemelen yanlış bir numara beyan etmek, hiç beyan
   * etmemekten kötüdür. `logo` yalnızca gerçek bir görsel yüklendiyse eklenir.
   */
  const organizationLd = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'STILSOFT DEMO',
    url: siteUrl,
    ...(settings.logoImageUrl ? { logo: settings.logoImageUrl } : {}),
    areaServed: { '@type': 'Country', name: 'Kuzey Kıbrıs Türk Cumhuriyeti' },
    contactPoint: {
      '@type': 'ContactPoint',
      telephone: settings.phoneNumber,
      contactType: 'customer service',
      areaServed: 'CY',
      availableLanguage: ['Turkish', 'English'],
    },
  }

  return (
    <html lang="tr" className={montserrat.variable}>
      <body className={montserrat.className}>
        {/* ÖLÇÜM (2026-09-20): kimlikler panelden; boşsa hiçbiri basılmaz. */}
        {settings.gaMeasurementId?.trim() && (
          <>
            <script async src={`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(settings.gaMeasurementId.trim())}`} />
            <script
              dangerouslySetInnerHTML={{
                __html: `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config',${JSON.stringify(settings.gaMeasurementId.trim())});`,
              }}
            />
          </>
        )}
        {settings.metaPixelId?.trim() && (
          <script
            dangerouslySetInnerHTML={{
              __html: `!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init',${JSON.stringify(settings.metaPixelId.trim())});fbq('track','PageView');`,
            }}
          />
        )}
        {settings.clarityProjectId?.trim() && (
          <script
            dangerouslySetInnerHTML={{
              __html: `(function(c,l,a,r,i,t,y){c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);})(window,document,"clarity","script",${JSON.stringify(settings.clarityProjectId.trim())});`,
            }}
          />
        )}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: jsonLdScript(organizationLd) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: jsonLdScript(websiteLd) }}
        />
        {/*
          İçeriğe atlama bağlantısı. Görünmüyor ama sekme tuşuna ilk basışta ortaya çıkıyor.
          Olmadığında klavyeyle gezen kullanıcı HER sayfada üst bar, altı kategori, arama ve
          hesap/sepet bağlantılarını tek tek geçmek zorunda kalıyordu.
        */}
        <a className="skip-link" href="#icerik">
          İçeriğe geç
        </a>
        {/*
          WhatsApp numarası panelde boşsa kullanıcının verdiği hatta düşülüyor
          (2026-09-09: "+90 533 000 00 00 bunu kullan").

          Widget bugüne kadar hiç görünmüyordu: `whatsAppNumber` ayarı hiç doldurulmamıştı ve
          bileşen numara yoksa kendini çizmiyordu. Kısa süre önce buradaki yedek santral
          telefonuydu; o numara WhatsApp hattı DEĞİL, dolayısıyla buton görünüyor ama mesaj
          gitmiyordu. Yedek artık gerçek destek hattı — panel yine de kazanır.
        */}
        <ClientProviders
          whatsAppNumber={settings.whatsAppNumber?.trim() || COMPANY_FALLBACK.whatsApp}
          lowStockThreshold={settings.lowStockThreshold}
          deliveryPromise={settings.deliveryPromise}
        >
          <SiteHeader />
          <main id="icerik">{children}</main>
          <SiteFooter />
          {/*
            Sol altta "Ara" butonu. Sağ altta WhatsApp var; ikisi aynı köşede olsaydı
            üst üste binerlerdi. Numara `companyInfo` üzerinden geliyor — panelde telefon
            değiştiğinde buton da değişir, ayrıca bir yere yazılmaz.
          */}
          <CallButton phone={resolveCompanyInfo(settings).phone} />
        </ClientProviders>
      </body>
    </html>
  )
}
