import type { Metadata } from 'next'
import Link from 'next/link'
import { loadSeller } from '@/components/LegalPage'

export const metadata: Metadata = {
  title: 'Garanti & İade Koşulları',
  description:
    'STILSOFT DEMO Resmi 3 Yıl Distribütör Garantisi, yetkili servis onarım şartları, iade ve cayma hakkı prosedürleri.',
  alternates: { canonical: '/garanti' },
}

export default async function GarantiPage() {
  const seller = await loadSeller()

  return (
    <div className="guarantee-page-wrapper">
      <div className="wrap">
        {/* Breadcrumb */}
        <div className="crumbs">
          <Link href="/">Anasayfa</Link>
          <span>›</span>
          <span>Garanti &amp; İade</span>
        </div>

        {/* Hero Header */}
        <div className="guarantee-header">
          <h1>Garanti ve İade Koşulları</h1>
          <p className="guarantee-header-desc">
            STILSOFT DEMO resmi distribütör güvencesiyle satın aldığınız tüm ürünler 3 yıl garanti kapsamındadır.
          </p>
        </div>

        {/* 3 Ana Garanti Maddesi */}
        <div className="human-guarantees-grid" style={{ marginBottom: '44px' }}>
          <div className="h-guarantee-card">
            <h4>3 Yıl Resmi Distribütör Garantisi</h4>
            <p>
              Fatura tarihinden itibaren 36 ay boyunca cihazınız üretim, malzeme ve montaj hatalarına karşı tam güvence altındadır.
            </p>
          </div>

          <div className="h-guarantee-card">
            <h4>Ücretsiz Yetkili Servis &amp; Montaj</h4>
            <p>
              Ankastre set, fırın ve ocak modellerinde randevulu yerinde montaj ücretsiz yapılır. Arızalarda adrese servis yönlendirilir.
            </p>
          </div>

          <div className="h-guarantee-card">
            <h4>%100 Orijinal Yedek Parça</h4>
            <p>
              Tüm bakım ve onarımlar Stilsoft orijinal fabrika parçalarıyla gerçekleştirilir ve yapılan işçilik garantilidir.
            </p>
          </div>
        </div>

        {/* Ana İçerik Bloğu */}
        <div className="guarantee-content-layout">
          <div className="guarantee-main-col">
            <section className="g-section">
              <h2>1. Garanti Kapsamı ve Şartları</h2>
              <p>
                STILSOFT DEMO üzerinden satın alınan tüm elektrikli küçük ev aletleri, ankastre ürünler ve içecek hazırlama sistemleri fatura tarihinden itibaren <b>3 (üç) yıl</b> süreyle resmi distribütör garantisindedir.
              </p>
              <ul>
                <li>Garanti süresi, ürünün müşteriye teslim edildiği tarihte başlar.</li>
                <li>Garanti hizmetinden faydalanabilmek için ürün faturasının veya e-faturasının ibraz edilmesi gereklidir.</li>
                <li>Garanti süresi içerisinde parça değişimi veya işçilik için herhangi bir ücret talep edilmez.</li>
                <li>Yetkili servis istasyonlarımız dışında ehil olmayan kişilerce yapılan tamir ve müdahaleler garantiyi geçersiz kılar.</li>
              </ul>
            </section>

            <section className="g-section">
              <h2>2. Garanti Kapsamı Dışında Kalan Haller</h2>
              <p>Aşağıdaki durumlar garanti kapsamı dışındadır ve onarımlar ücretli olarak gerçekleştirilir:</p>
              <ul>
                <li>Kullanma kılavuzunda belirtilen talimatlara aykırı kullanım sonucu oluşan hasar ve arızalar.</li>
                <li>Düşme, çarpma, kırılma veya kaza kaynaklı fiziksel hasarlar.</li>
                <li>Voltaj dalgalanmaları, yüksek akım veya uygun olmayan elektrik tesisatı kaynaklı arızalar.</li>
                <li>Yetkili servis dışındaki şahıslar tarafından cihaza müdahale edilmesi veya içinin açılması.</li>
                <li>Kireçlenme ve düzenli temizlik yapılmaması nedeniyle tıkanan kahve makinesi veya ütü arızaları.</li>
              </ul>
            </section>

            <section className="g-section">
              <h2>3. İade ve Değişim Koşulları</h2>
              <p>
                Değişim ve iade talepleri, ürün yetkili servisimizce incelendikten sonra aşağıdaki koşullarla
                değerlendirilir.
              </p>
              <ul>
                <li>İade edilecek ürünün orijinal kutusunda, ambalajı hasar görmemiş, tüm aksesuarları ve faturasıyla eksiksiz olması gerekmektedir.</li>
                <li>Kullanılmış, montajı yapılmış veya tekrar satılabilirlik özelliğini kaybetmiş ürünlerde iade kabul edilmemektedir.</li>
                <li>Kişisel bakım ürünleri (saç şekillendirici, epilatör vb.) hijyen standartları gereği ambalajı açıldıktan sonra iade alınamaz.</li>
                <li>İade onaylandığında ödeme, siparişin verildiği karta aynı şekilde iade edilir.</li>
              </ul>
            </section>
          </div>

          {/* Sağ Kolon: Hızlı Servis & Destek Kutusu */}
          <div className="guarantee-side-col">
            <div className="g-action-card">
              <h3>Servis Talebiniz mi Var?</h3>
              <p>
                Arızalı cihazınız için online servis kaydı açabilir veya yetkili servisimizle doğrudan randevu planlayabilirsiniz.
              </p>
              <Link href="/servis" className="btn btn-dark btn-sm" style={{ width: '100%', justifyContent: 'center' }}>
                Servis Talebi Oluştur
              </Link>
            </div>

            <div className="g-contact-card">
              <h4>Müşteri Hizmetleri</h4>
              <p>Garanti ve iade süreçleriyle ilgili her türlü sorunuz için bize ulaşabilirsiniz:</p>
              <div className="g-phone-val">
                <a href={`tel:${seller.phone}`}>{seller.phone}</a>
              </div>
              <span className="g-hours">Pzt – Cmt: 08:30 – 18:00</span>
            </div>

            <div className="g-quick-links">
              <Link href="/teslimat" className="human-quick-link">
                <b>Teslimat &amp; Kurulum</b>
                <span>KKTC geneli ücretsiz nakliye ve montaj şartları</span>
              </Link>
              <Link href="/siparis-takibi" className="human-quick-link">
                <b>Sipariş Takibi</b>
                <span>Siparişinizin durumunu sorgulayın</span>
              </Link>
              <Link href="/mesafeli-satis" className="human-quick-link">
                <b>Mesafeli Satış Sözleşmesi</b>
                <span>Yasal haklar ve sözleşme detayları</span>
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
