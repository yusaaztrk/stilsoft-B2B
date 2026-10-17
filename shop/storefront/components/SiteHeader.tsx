import Image from 'next/image'
import SearchSuggest from '@/components/SearchSuggest'
import Link from 'next/link'
import HeaderCartButton from '@/components/HeaderCartButton'
import HeaderShadow from '@/components/HeaderShadow'
import MobileMenu from '@/components/MobileMenu'
import PrimaryNav from '@/components/PrimaryNav'
import GoogleTranslate from '@/components/GoogleTranslate'
import AccountMenu from '@/components/AccountMenu'
import { getStorefront, listCategories } from '@/lib/api'
import { resolveCompanyInfo } from '@/lib/companyInfo'

/**
 * Üye ve sepet bilgisi burada YOK. İkisi de `cookies()` okur; bu bileşen kök layout'un bir
 * parçası olduğu için (her sayfada render edilir) burada okunsalar sitedeki HER sayfayı
 * (anasayfa, ürün, kategori dahil) tam dinamik render'a zorlarlardı — ürün sayfası her
 * ziyarette sıfırdan sunucu render + veritabanı sorgusu demek olurdu (2026-09-05 denetiminde
 * bulundu). `AccountMenu` ve `HeaderCartButton` bu ikisini kendi başlarına İSTEMCİDEN çeker
 * (bkz. o dosyalar); `categories`/`settings` kişiye özel değil, ISR önbellekli
 * (`lib/api.ts`), burada kalmaları güvenli.
 */
export default async function SiteHeader() {
  const [categories, settings] = await Promise.all([listCategories(), getStorefront()])

  // Telefonun yedeği tek yerde: aynı numaranın üç dosyada üç farklı yedeği vardı
  // (üst barda 0392 000 00 00, altbilgide aynısı, ayar varsayılanında 0850 000 00 00) ve
  // ekranda hangisinin çıkacağı hangi bileşenin çizildiğine bağlıydı — bkz. lib/companyInfo.
  const phone = resolveCompanyInfo(settings).phone
  const logo = settings.logoImageUrl?.trim() || '/stilsoft-logo.png'

  return (
    <>
      <HeaderShadow />

      {/*
        KKTC ŞERİDİ (2026-09-20): Türkiye'de de Stilsoft var; Google'dan buraya düşen Türkiye
        müşterisi sepete gelmeden doğru siteye gitsin. Bağlantı panelden (Türkiye sitesi adresi).
      */}
      {settings.turkeySiteUrl?.trim() && (
        <div className="kktc-strip">
          <div className="wrap kktc-strip-inner">
            <span>
              <strong>STILSOFT DEMO</strong> · Teslimat yalnız Kuzey Kıbrıs'a yapılır.
            </span>
            <a href={settings.turkeySiteUrl.trim()} rel="noopener noreferrer">
              Türkiye'den bakıyorsanız Türkiye sitesine geçin →
            </a>
          </div>
        </div>
      )}

      {/* ÜST BİLGİ & DUYURU ŞERİDİ */}
      <div className="top-announcement-bar">
        <div className="wrap announcement-inner">
          <div className="announcement-items">
            <span className="announcement-item">
              <strong>KKTC Geneli</strong> Ücretsiz Teslimat
            </span>
            <span className="ann-divider">•</span>
            <span className="announcement-item">
              <strong>3 Yıl</strong> Resmi Distribütör Garantisi
            </span>
            <span className="ann-divider">•</span>
            <span className="announcement-item">
              <strong>Randevulu</strong> Ücretsiz Montaj Hizmeti
            </span>
          </div>

          <div className="announcement-right">
            <a className="top-phone-link" href={`tel:${phone.replace(/[^\d+]/g, '')}`}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
              </svg>
              <span>{phone}</span>
            </a>
            <span className="ann-divider">|</span>
            <nav className="top-nav-links" aria-label="Yardım ve İletişim">
              <Link href="/kurumsal-satis">Kurumsal Satış</Link>
              <Link href="/servis">Yetkili Servis</Link>
              <Link href="/siparis-takibi">Sipariş Takibi</Link>
              <Link href="/iletisim">İletişim</Link>
            </nav>
            <span className="ann-divider">|</span>
            {/*
              BAYİ GİRİŞİ — B2B paneline geçiş (2026-09-09 kullanıcı isteği).

              Ayrı bir uygulama (b2b.example.com) olduğu için `Link` değil düz `<a>`:
              Next'in istemci tarafı yönlendirmesi başka bir alan adına gidemez.
              `rel="noopener"` şart — `target="_blank"` ile açılan sayfa `window.opener`
              üzerinden bu sekmeyi yönlendirebilir.
            */}
            <a
              className="top-dealer-link"
              href="https://b2b.example.com"
              target="_blank"
              rel="noopener noreferrer"
            >
              Bayi Girişi
            </a>
            <span className="ann-divider">|</span>
            <GoogleTranslate />
          </div>
        </div>
      </div>

      {/* ANA HEADER */}
      <header className="main-header">
        <div className="wrap main-header-inner">
          <MobileMenu categories={categories} />

          {/* Stilsoft Resmi Logo */}
          <Link className="site-logo" href="/" aria-label="STILSOFT DEMO Anasayfa">
            <Image
              src={logo}
              alt="STILSOFT DEMO"
              width={160}
              height={38}
              priority
              className="logo-img-tag"
            />
          </Link>

          {/*
            Arama kutusu (2026-09-20): düz form yerine öneri açılır listesi.
            İki harften sonra ürün ve kategori öneriliyor; Enter yine arama sayfasına gidiyor.
          */}
          <SearchSuggest />

          {/* Header Sağ Araçlar */}
          <div className="header-action-tools">
            {/* Hesabım */}
            <AccountMenu />

            {/* Sepetim (Sağdan Açılır Çekmece) */}
            <HeaderCartButton />
          </div>
        </div>

        {/* Ana Gezinti Barı & Mega Menü */}
        <div className="header-nav-strip">
          <div className="wrap">
            <PrimaryNav categories={categories} />
          </div>
        </div>
      </header>
    </>
  )
}
