import type { Metadata } from 'next'
import Link from 'next/link'
import { loadSeller } from '@/components/LegalPage'

export const metadata: Metadata = {
  title: 'Yetkili Servis & Garanti Talebi',
  description:
    'STILSOFT DEMO Yetkili Servis Merkezi: Arıza kaydı, randevulu yerinde montaj ve onarım, 3 yıl resmi distribütör garantisi.',
  alternates: { canonical: '/servis' },
}

export default async function ServicePage() {
  const seller = await loadSeller()

  return (
    <div className="service-page-wrapper">
      <div className="wrap">
        {/* Breadcrumbs */}
        <div className="crumbs">
          <Link href="/">Anasayfa</Link>
          <span>›</span>
          <span>Servis Talebi</span>
        </div>

        {/* Hero Header */}
        <div className="service-header">
          <h1>Yetkili Servis &amp; Garanti</h1>
          <p className="service-header-desc">
            STILSOFT DEMO resmi distribütör garantisi ile tüm cihazlarınıza yerinde montaj, orijinal yedek parça ve yetkili teknisyen desteği sağlıyoruz.
          </p>
        </div>

        {/* 4 Aşamalı Servis Süreci */}
        <div className="service-process-section">
          <div className="process-head">
            <h2>Servis Süreci Nasıl İşler?</h2>
          </div>

          <div className="human-steps-grid">
            <div className="human-step-item">
              <div className="h-step-badge">1</div>
              <h3>Kayıt Oluşturma</h3>
              <p>Formu doldurarak veya telefonla bize arıza/montaj bildiriminde bulunun.</p>
            </div>

            <div className="human-step-item">
              <div className="h-step-badge">2</div>
              <h3>Randevu Teyidi</h3>
              <p>Ekibimiz sizi arayarak bölgenize göre uygun gün ve saat aralığını belirler.</p>
            </div>

            <div className="human-step-item">
              <div className="h-step-badge">3</div>
              <h3>Yerinde Müdahale</h3>
              <p>Büyük cihazlarda adrese teknisyen gelir; küçük ev aletleri özenle atölyeye alınır.</p>
            </div>

            <div className="human-step-item">
              <div className="h-step-badge">4</div>
              <h3>Garantili Teslimat</h3>
              <p>Orijinal parça ile onarılan veya kurulan ürününüz test edilerek teslim edilir.</p>
            </div>
          </div>
        </div>

        {/*
          ONLINE SERVİS KAYDI FORMU KALDIRILDI (2026-09-09 kullanıcı kararı:
          "bu sayfadaki formu komple kaldır, burdan mesaj gelmesin").

          Servis talebi artık yalnızca telefonla alınıyor. Form yerine yeni bir bölüm
          konmadı: sayfada zaten çağrı hattı kartı ve "İşlemi Hızlandıracak Bilgiler"
          bölümü var, ikisi de aramadan önce hazırlanacakları anlatıyor.

          Izgara tek kolona düştü (`solo` sınıfı) — iki kolonluk düzende sağ kolon tek
          başına kalınca sayfanın yarısı boş görünüyordu.

          Sunucu ucu da kapatıldı (`ContactController.SendServiceRequest`): önbellekte
          kalmış eski bir sayfa hâlâ istek atabilirdi ve o istek e-posta üretirdi.
        */}
        <div className="service-main-grid solo">
          <div className="service-side-col">
            <div className="service-direct-call-card">
              <span className="human-card-tag" style={{ color: 'var(--accent-on-dark-2)' }}>SERVİS ÇAĞRI HATTI</span>
              <h3>Yetkili Servis Merkezi</h3>
              <p>Müşteri danışmanımızla doğrudan görüşmek ve randevu almak için bizi arayabilirsiniz:</p>
              <a href={`tel:${seller.phone}`} className="track-phone-btn">
                {seller.phone}
              </a>
              <div className="s-hours-info">
                <span>Pazartesi – Cuma: 08:30 – 18:00</span>
                <span>Cumartesi: 08:30 – 13:30</span>
              </div>
            </div>

            <div className="service-prep-card">
              <h4>İşlemi Hızlandıracak Bilgiler</h4>
              <ul className="s-prep-human-list">
                <li>
                  <b>Fatura Bilgisi:</b>
                  <span>Faturanıza <Link href="/hesabim/faturalarim">Faturalarım</Link> sayfasından ulaşabilirsiniz.</span>
                </li>
                <li>
                  <b>Model / Seri No:</b>
                  <span>Cihazın alt veya arka etiketinde yer alan model kodu.</span>
                </li>
                <li>
                  <b>Arıza Özeti:</b>
                  <span>Sorunun tam olarak ne zaman başladığı ve nasıl gerçekleştiği.</span>
                </li>
              </ul>
            </div>
          </div>
        </div>

        {/* 3 Güvence Kartı */}
        <div className="human-guarantees-grid">
          <div className="h-guarantee-card">
            <h4>3 Yıl Distribütör Garantisi</h4>
            <p>Tüm Stilsoft ürünleri KKTC resmi distribütör güvencesi altındadır. Garanti süresince parça ve işçilik ücretsizdir.</p>
          </div>

          <div className="h-guarantee-card">
            <h4>Ücretsiz İlk Montaj</h4>
            <p>Ankastre fırın, ocak ve davlumbaz modellerinde yetkili servisimizce randevulu ilk kurulum ücretsiz olarak yapılır.</p>
          </div>

          <div className="h-guarantee-card">
            <h4>Orijinal Yedek Parça</h4>
            <p>Ürününüzün performansını ve güvenliğini korumak için sadece orijinal Stilsoft yedek parçaları kullanılır.</p>
          </div>
        </div>

        {/* Alt Bilgi Şeridi */}
        <div className="service-foot-links">
          <span>İlgili bağlantılar:</span>
          <Link href="/teslimat">Teslimat &amp; Kurulum</Link>
          <span>·</span>
          <Link href="/iletisim">İletişim</Link>
          <span>·</span>
          <Link href="/siparis-takibi">Sipariş Takibi</Link>
        </div>
      </div>
    </div>
  )
}
