import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { currentMember } from '@/lib/session'
import GuestOrderTracker from '@/components/GuestOrderTracker'
import { getStorefront } from '@/lib/api'
import { formatDate, listOrders } from '@/lib/account'
import { summariseWorkingHours } from '@/lib/workingHours'

export const metadata: Metadata = {
  title: 'Sipariş Takibi',
  description: 'Siparişinizin durumunu sorgulayın, teslimat ve kargo aşamalarını takip edin.',
  alternates: { canonical: '/siparis-takibi' },
}

export default async function OrderTrackingPage({
  searchParams,
}: {
  searchParams: Promise<{ no?: string }>
}) {
  const [params, member, settings] = await Promise.all([searchParams, currentMember(), getStorefront()])
  const orderNo = (params.no ?? '').trim()
  const phone = settings.phoneNumber?.trim() || '0392 000 00 00'

  if (orderNo && member) {
    redirect(`/hesabim/siparis/${encodeURIComponent(orderNo)}`)
  }

  /*
    GİRİŞ YAPMIŞ ÜYEYE SON SİPARİŞLERİ DE GÖSTERİLİYOR.

    Sayfa yalnızca bir sipariş numarası kutusuydu: numarayı hatırlamayan müşteri (çoğu)
    buradan hiçbir şey yapamıyor, "Siparişlerim" bağlantısını fark etmesi gerekiyordu.
    Numara zaten üyenin kendi listesinde; sormak yerine göstermek doğru.

    Misafirde HİÇ çekilmiyor: oturum yoksa istek de yok.
  */
  const recentOrders = member ? (await listOrders()).slice(0, 5) : []

  // Panelden yönetilen çalışma saatlerinin tek satırlık özeti (ilk gün + hafta sonu).
  const workingHoursLine = summariseWorkingHours(settings.workingHours)

  return (
    <div className="track-page-wrapper">
      <div className="wrap">
        {/* Breadcrumb */}
        <div className="crumbs">
          <Link href="/">Anasayfa</Link>
          <span>›</span>
          <span>Sipariş Takibi</span>
        </div>

        {/* Hero Başlık */}
        <div className="track-header">
          <h1>Sipariş Takibi</h1>
          <p className="track-header-desc">
            Siparişinizin onay, hazırlık ve teslimat durumunu buradan sorgulayabilirsiniz.
          </p>
        </div>

        {/* Ana Sorgulama ve Üyelik Kartı */}
        <div className="track-main-card">
          <div className="track-card-grid">
            <div className="track-card-left">
              <h2>Siparişinizi Sorgulayın</h2>
              <p className="track-card-text">
                Faturanızda veya sipariş onay e-postanızda yer alan sipariş numaranızı giriniz:
              </p>

              {member ? (
                <form className="modern-track-form" action="/siparis-takibi" method="GET">
                  <label htmlFor="order-no-input" className="track-input-label">
                    Sipariş Numarası
                  </label>
                  <div className="track-input-group">
                    <input
                      id="order-no-input"
                      name="no"
                      type="text"
                      inputMode="numeric"
                      placeholder="Örn: 2026000123"
                      defaultValue={orderNo}
                      className="track-input-field"
                      required
                    />
                    <button type="submit" className="btn btn-dark btn-sm">
                      Sorgula
                    </button>
                  </div>
                  <div className="track-form-hints">
                    <span className="track-hint-item">
                      Tüm geçmiş siparişleriniz için{' '}
                      <Link href="/hesabim/siparislerim" className="track-link-highlight">
                        Siparişlerim sayfasına gidin
                      </Link>
                    </span>
                  </div>

                  {recentOrders.length > 0 && (
                    <div className="track-recent">
                      <div className="track-recent-title">Son siparişleriniz</div>
                      <ul className="track-recent-list">
                        {recentOrders.map((order) => (
                          <li key={order.orderNo}>
                            <Link href={`/hesabim/siparis/${encodeURIComponent(order.orderNo)}`}>
                              <span className="track-recent-no num">{order.orderNo}</span>
                              <span className="track-recent-date">{formatDate(order.processedAt)}</span>
                              <span className="track-recent-stage">{order.stageLabel}</span>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </form>
              ) : (
                <>
                  {/* Üyeliksiz takip: sipariş no + telefon (2026-09-20). */}
                  <GuestOrderTracker initialOrderNo={orderNo} />
                  <div className="track-form-hints" style={{ marginTop: 10 }}>
                    <span className="track-hint-item">
                      Üye misiniz? <Link href="/giris?donus=%2Fhesabim%2Fsiparislerim" className="track-link-highlight">Giriş yapın</Link>, tüm siparişleriniz listelensin.
                    </span>
                  </div>
                </>
              )}
            </div>

            <div className="track-card-right">
              <div className="track-support-card">
                <h3>Teslimat Desteği</h3>
                <p>
                  Siparişinizin teslimat tarihi veya randevusu ile ilgili bilgi almak için bize ulaşabilirsiniz:
                </p>
                <div className="track-contact-row">
                  <a href={`tel:${phone}`} className="track-phone-btn">
                    {phone}
                  </a>
                  {/* Saatler ayardan; koda sabit yazılıyken gerçeğiyle tutmuyordu. */}
                  {workingHoursLine && <span className="track-work-hours">{workingHoursLine}</span>}
                </div>
                <p className="track-note">
                  KKTC genelinde tüm ilçelere randevulu teslimat ve yetkili servis kurulumu sağlanmaktadır.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Doğal ve İnsansı Süreç Çizelgesi */}
        <div className="track-timeline-section">
          <div className="timeline-section-head">
            <h2>Teslimat Süreci Nasıl İlerler?</h2>
            <p>Siparişiniz 5 aşamadan geçerek kapınıza ulaştırılır</p>
          </div>

          {/*
            AŞAMALAR TESLİMAT KAYDININ GERÇEK ADIMLARIYLA AYNI.
            Burada 4 aşama anlatılıyordu ama sipariş detayında 5 adımlı bir şerit görünüyor
            (Siparişiniz Alındı, Planlandı, Hazırlanıyor, Dağıtımda, Teslim Edildi). İki farklı
            anlatım, müşteriye "hangisi doğru" diye sordurur.
          */}
          <div className="human-steps-grid">
            <div className="human-step-item">
              <div className="h-step-badge">1</div>
              <h4>Siparişiniz Alındı</h4>
              <p>Ödemeniz onaylanır onaylanmaz siparişiniz teslimat listesine düşer.</p>
            </div>

            <div className="human-step-item">
              <div className="h-step-badge">2</div>
              <h4>Planlandı</h4>
              <p>Teslimat gününüz belirlenir; ekibimiz sizi arayarak uygun saati teyit eder.</p>
            </div>

            <div className="human-step-item">
              <div className="h-step-badge">3</div>
              <h4>Hazırlanıyor</h4>
              <p>Ürününüz kontrol edilip faturası kesilir ve korunaklı şekilde paketlenir.</p>
            </div>

            <div className="human-step-item">
              <div className="h-step-badge">4</div>
              <h4>Dağıtımda</h4>
              <p>Ürününüz araca yüklenir ve adresinize doğru yola çıkar.</p>
            </div>

            <div className="human-step-item">
              <div className="h-step-badge">5</div>
              <h4>Teslim Edildi</h4>
              <p>Ürününüz teslim edilir; montajlı ürünlerde kurulum yetkili servisimizce yapılır.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
