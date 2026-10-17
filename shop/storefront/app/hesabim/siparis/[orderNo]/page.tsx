import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getStorefront } from '@/lib/api'
import { resolveCompanyInfo } from '@/lib/companyInfo'
import { displayName, formatPrice, mediaUrl } from '@/lib/format'
import { formatDate, formatDateTime, getOrderDetail } from '@/lib/account'
import { loginWithReturn } from '@/lib/returnPath'
import { currentMember } from '@/lib/session'

export const metadata: Metadata = {
  title: 'Sipariş Detayı & Takibi',
  robots: { index: false, follow: false },
}

const DELIVERY_STEPS = [
  { status: 0, label: 'Sipariş Alındı', desc: 'Siparişiniz sisteme başarıyla kaydedildi' },
  { status: 1, label: 'Planlandı', desc: 'Sevkiyat ve rota planlaması yapıldı' },
  { status: 2, label: 'Hazırlanıyor', desc: 'Depoda paketleniyor ve kontrolden geçiyor' },
  { status: 3, label: 'Dağıtımda', desc: 'Kuryemiz adresinize ulaştırmak üzere yola çıktı' },
  { status: 4, label: 'Teslim Edildi', desc: 'Siparişiniz başarıyla teslim edildi' },
]

export default async function OrderDetailPage({ params }: { params: Promise<{ orderNo: string }> }) {
  const { orderNo } = await params

  const member = await currentMember()
  if (!member) redirect(loginWithReturn(`/hesabim/siparis/${encodeURIComponent(orderNo)}`))

  const [detail, settings] = await Promise.all([
    getOrderDetail(decodeURIComponent(orderNo)),
    getStorefront(),
  ])
  if (!detail) notFound()

  const phone = resolveCompanyInfo(settings).phone
  const whatsAppDigits = (settings.whatsAppNumber ?? '').replace(/\D/g, '')

  const { order, delivery } = detail
  const deliveryStarted = delivery?.exists === true

  /*
    ÖDENMEMİŞ SİPARİŞ "ALINDI" GÖRÜNMEZ (2026-09-09 kullanıcı kuralı: "ödeme yapmadan
    sipariş alındı diyemez, önce ödeme yapacak sonra sipariş alınacak").

    Eskiden `currentStatus` teslimat kaydı yokken 0'a düşüyordu ve şerit `currentStatus >=
    step.status` ile çizildiği için ilk adım (0 = "Sipariş Alındı") HER ZAMAN yeşil
    işaretleniyordu — ödeme durumuna hiç bakılmıyordu. Müşteri "Ödeme bekleniyor" uyarısının
    hemen altında "Siparişiniz sisteme başarıyla kaydedildi" yazısını görüyordu; ikisi
    birbiriyle çelişiyor ve ödemenin gereksiz olduğu izlenimini veriyordu.

    -1 seçilmesinin sebebi: adım durumları 0'dan başlıyor, dolayısıyla "hiçbir adım
    tamamlanmadı"yı anlatan tek güvenli değer 0'ın altı. Ödeme tamamlandığı anda değer
    0'a dönüyor ve şerit normal işleyişine giriyor.
  */
  const currentStatus = deliveryStarted ? delivery!.status : order.stage === 'awaiting_payment' ? -1 : 0

  const stepTime = (status: number) =>
    delivery?.history?.find((h) => h.status === status)?.timestamp ?? null

  const isAwaitingPayment = order.stage === 'awaiting_payment'
  const isReview = order.stage === 'review'
  const isPaid = order.isPaid || order.stage === 'paid'

  return (
    <div className="order-detail-view-wrap">
      <div className="wrap">
        {/* Breadcrumb Navigasyon */}
        <nav className="order-breadcrumb" aria-label="Breadcrumb">
          <Link href="/">Anasayfa</Link>
          <span className="bc-sep">/</span>
          <Link href="/hesabim">Hesabım</Link>
          <span className="bc-sep">/</span>
          <Link href="/hesabim/siparislerim">Siparişlerim</Link>
          <span className="bc-sep">/</span>
          <span className="bc-current">{order.orderNo}</span>
        </nav>

        {/* Sipariş Başlık Kartı */}
        <div className="order-hero-card">
          <div className="order-hero-info">
            <div className="order-hero-meta">
              <span className="order-hero-badge">STILSOFT DEMO SİPARİŞİ</span>
              <span className="order-date-chip">📅 {formatDate(order.processedAt)}</span>
            </div>
            <h1 className="order-hero-title">
              Sipariş <span className="order-number-text">{order.orderNo}</span>
            </h1>
            <p className="order-hero-sub">
              {order.lines.length} farklı kalem ürün • Genel Toplam: <strong className="num">{formatPrice(order.grandTotal)}</strong>
            </p>
          </div>

          <div className="order-hero-status-side">
            <div className={`order-status-pill ${order.stage}`}>
              <span className="status-dot" />
              <span>{order.stageLabel}</span>
            </div>

            <div className="order-hero-quick-actions">
              <Link href="/hesabim/siparislerim" className="btn btn-order-back">
                ← Tüm Siparişlerim
              </Link>
              {whatsAppDigits && (
                <a
                  href={`https://wa.me/${whatsAppDigits}?text=${encodeURIComponent(`Merhaba, ${order.orderNo} numaralı siparişim hakkında bilgi almak istiyorum.`)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-order-support"
                >
                  💬 WhatsApp Destek
                </a>
              )}
            </div>
          </div>
        </div>

        {/* Ödeme Bekleniyor Uyarısı */}
        {isAwaitingPayment && (
          <div className="order-alert-box alert-warning">
            <div className="alert-icon">⚠️</div>
            <div className="alert-content">
              <h4>Ödeme Bekleniyor</h4>
              <p>Bu siparişin ödemesi henüz tamamlanmadı. Siparişinizi güvenceye almak için hemen ödemenizi tamamlayabilirsiniz.</p>
            </div>
            <Link
              href={order.paymentStatus?.startsWith('BankTransfer') ? `/odeme/havale?siparis=${encodeURIComponent(order.orderNo)}` : `/odeme/sonuc?siparis=${encodeURIComponent(order.orderNo)}`}
              className="btn btn-alert-action"
            >
              Ödemeyi Tamamla →
            </Link>
          </div>
        )}

        {/* Ödeme İnceleniyor Uyarısı */}
        {isReview && (
          <div className="order-alert-box alert-info">
            <div className="alert-icon">ℹ️</div>
            <div className="alert-content">
              <h4>Ödemeniz İnceleniyor</h4>
              <p>Banka havaleniz veya ödeme onayınız operasyon ekibimizce kontrol edilmektedir. Sorularınız için bizimle iletişime geçebilirsiniz.</p>
            </div>
            <Link href="/iletisim" className="btn btn-alert-action">
              İletişime Geç →
            </Link>
          </div>
        )}

        {/* Kargo & Teslimat Takip Çizelgesi */}
        <section className="order-tracking-card">
          <div className="tracking-card-header">
            <div>
              <span className="card-subtag">SEVKİYAT &amp; KARGO SÜRECİ</span>
              <h3>Teslimat Durumu ve Takibi</h3>
            </div>
            {deliveryStarted && delivery?.plannedDate && (
              <div className="planned-delivery-badge">
                <span>Planlanan Teslimat:</span>
                <strong>{formatDate(delivery.plannedDate)}</strong>
              </div>
            )}
            {/* Şeritte hiçbir adım yeşil değilken sebebini yazmak gerekiyor; boş bir
                ilerleme çizgisi "sistem çalışmıyor" gibi duruyordu. */}
            {isAwaitingPayment && (
              <div className="tracking-awaiting-badge">Ödeme tamamlanınca başlar</div>
            )}
          </div>

          <div className="stepper-track-wrap">
            <div className="stepper-horizontal">
              {DELIVERY_STEPS.map((step, idx) => {
                const isDone = currentStatus >= step.status
                const isCurrent = currentStatus === step.status
                const atTime = stepTime(step.status)

                return (
                  <div
                    key={step.status}
                    className={`stepper-step ${isDone ? 'done' : ''} ${isCurrent ? 'current' : ''}`}
                  >
                    <div className="step-marker-box">
                      <div className="step-circle">
                        {isDone ? (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        ) : (
                          <span>{idx + 1}</span>
                        )}
                      </div>
                      {idx < DELIVERY_STEPS.length - 1 && <div className="step-line" />}
                    </div>

                    <div className="step-info">
                      <span className="step-title">{step.label}</span>
                      <span className="step-desc">{step.desc}</span>
                      {atTime && <span className="step-timestamp">{formatDateTime(atTime)}</span>}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </section>

        {/* Sipariş Detay İki Kolonlu Grid */}
        <div className="order-layout-grid">
          {/* Sol Kolon: Ürün Listesi ve Mali Özet */}
          <div className="order-main-col">
            <section className="order-section-card">
              <div className="section-card-head">
                <h3>Sipariş Edilen Ürünler ({order.lines.length})</h3>
              </div>

              <div className="order-products-table">
                {order.lines.map((line) => {
                  const img = mediaUrl(line.imageUrl)
                  const name = displayName(line.name)

                  return (
                    <div key={line.stockCode} className="order-product-row">
                      <div className="product-row-thumb">
                        {img ? (
                          <Image
                            src={img}
                            alt={name}
                            width={72}
                            height={72}
                            className="p-thumb-img"
                            style={{ objectFit: 'contain' }}
                          />
                        ) : (
                          <div className="p-thumb-placeholder">STILSOFT</div>
                        )}
                      </div>

                      <div className="product-row-details">
                        <div className="p-row-badges">
                          <span className="p-brand-tag">STILSOFT</span>
                          <span className="p-code-tag">{line.stockCode}</span>
                        </div>

                        <h4 className="p-row-name">
                          {line.slug ? (
                            <Link href={`/urun/${line.slug}`} title={name}>
                              {name}
                            </Link>
                          ) : (
                            <span>{name}</span>
                          )}
                        </h4>

                        <div className="p-row-calc">
                          <span className="p-qty-chip">{line.quantity} Adet</span>
                          <span className="p-unit-text">× {formatPrice(line.unitPrice)}</span>
                          <span className="p-vat-info">(KDV +%{line.vatRate})</span>
                          {/*
                            Montaj artık satır satır: müşteri hangi ürün için montaj
                            istediğini siparişinde de görebilmeli. Montaj ekibi yalnızca
                            bu satırlar için yola çıkıyor.
                          */}
                          {line.montage && (
                            <span className="p-montage-chip">Montaj istendi</span>
                          )}
                        </div>
                      </div>

                      <div className="product-row-price">
                        <span className="p-total-label">Tutar</span>
                        <span className="p-total-val num">{formatPrice(line.lineGross)}</span>
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Fiyat & Toplam Dökümü */}
              <div className="order-financial-breakdown">
                <div className="breakdown-row">
                  <span>Ara Toplam (KDV Hariç)</span>
                  <span className="num">{formatPrice(order.subtotal)}</span>
                </div>
                <div className="breakdown-row">
                  <span>Hesaplanan KDV</span>
                  <span className="num">{formatPrice(order.vatTotal)}</span>
                </div>
                <div className="breakdown-row">
                  <span>Adrese Teslimat (Tüm KKTC)</span>
                  <span className="free-tag">Ücretsiz</span>
                </div>
                {/*
                  BU SATIR ARTIK SİPARİŞİN GERÇEĞİNİ YAZIYOR.

                  Önceden her siparişte sabit "Ücretsiz Montaj" yazıyordu: montaj istemeyen
                  müşteri de bu satırı görüyor, montaj bedeli ödeyen müşteri ise "ücretsiz"
                  yazısını okuyordu. Montaj müşterinin seçimi olduğuna göre satır da seçime
                  bağlı olmalı.
                */}
                {order.lines.some((l) => l.montage) && (
                  <div className="breakdown-row">
                    <span>Yetkili Servis Kurulumu</span>
                    <span className="free-tag">
                      {order.lines.filter((l) => l.montage).length} ürün için randevulu montaj
                    </span>
                  </div>
                )}

                <div className="breakdown-divider" />

                <div className="breakdown-row grand-total-row">
                  <div>
                    <strong>Genel Toplam</strong>
                    <small>KDV Dahil Net Tutar</small>
                  </div>
                  <strong className="grand-total-val num">{formatPrice(order.grandTotal)}</strong>
                </div>
              </div>
            </section>
          </div>

          {/* Sağ Kolon: Ödeme, Fatura ve Güvence Kartları */}
          <div className="order-sidebar-col">
            {/* Ödeme Kartı */}
            <section className="order-section-card sidebar-card">
              <div className="section-card-head">
                <h3>Ödeme Bilgileri</h3>
              </div>
              <div className="sidebar-card-body">
                <div className="info-key-val">
                  <span className="info-label">Ödeme Durumu</span>
                  <span className={`status-badge-inline ${isPaid ? 'paid' : 'pending'}`}>
                    {isPaid ? '✓ Ödendi' : order.stageLabel}
                  </span>
                </div>

                <div className="info-key-val">
                  <span className="info-label">Ödeme Yöntemi</span>
                  <span className="info-value">Kredi Kartı / 3D Güvenli Ödeme</span>
                </div>

                {order.paidAt && (
                  <div className="info-key-val">
                    <span className="info-label">Ödeme Tarihi</span>
                    <span className="info-value num">{formatDateTime(order.paidAt)}</span>
                  </div>
                )}

                {isAwaitingPayment && (
                  <div className="sidebar-action-box">
                    <Link
                      href={order.paymentStatus?.startsWith('BankTransfer') ? `/odeme/havale?siparis=${encodeURIComponent(order.orderNo)}` : `/odeme/sonuc?siparis=${encodeURIComponent(order.orderNo)}`}
                      className="btn btn-sidebar-primary"
                    >
                      Hemen Öde →
                    </Link>
                  </div>
                )}
              </div>
            </section>

            {/* Fatura Kartı */}
            <section className="order-section-card sidebar-card">
              <div className="section-card-head">
                <h3>Fatura Bilgileri</h3>
              </div>
              <div className="sidebar-card-body">
                {order.invoiceNo ? (
                  <>
                    <div className="info-key-val">
                      <span className="info-label">Fatura No</span>
                      <span className="invoice-chip num">{order.invoiceNo}</span>
                    </div>
                    {order.invoiceDate && (
                      <div className="info-key-val">
                        <span className="info-label">Fatura Tarihi</span>
                        <span className="info-value num">{formatDate(order.invoiceDate)}</span>
                      </div>
                    )}
                    <p className="invoice-note">
                      ✓ Resmi e-faturanız düzenlenmiştir. Teslimat sırasında ürününüzle birlikte basılı nüshası teslim edilecektir.
                    </p>
                  </>
                ) : (
                  <div className="invoice-pending-box">
                    <span className="inv-icon">📄</span>
                    <p>Faturanız siparişiniz paketlenip sevkiyata çıkarıldığında otomatik olarak kesilecektir.</p>
                  </div>
                )}
              </div>
            </section>

            {/* KKTC Güvence & Müşteri Hizmetleri Kartı */}
            <section className="order-section-card sidebar-card trust-card">
              <div className="trust-card-inner">
                <div className="trust-item">
                  <span className="trust-icon">🛡️</span>
                  <div>
                    <strong>3 Yıl Resmi Distribütör Garantisi</strong>
                    <p>Tüm Stilsoft ürünleri resmi garantilidir.</p>
                  </div>
                </div>
                <div className="trust-item">
                  <span className="trust-icon">🚚</span>
                  <div>
                    <strong>Ücretsiz Adrese Teslimat</strong>
                    <p>KKTC geneli sigortalı kendi sevkiyat ekibimizle.</p>
                  </div>
                </div>
                <div className="trust-item">
                  <span className="trust-icon">🔧</span>
                  <div>
                    <strong>Yetkili Servis Desteği</strong>
                    <p>{phone} • Randevulu montaj hizmeti.</p>
                  </div>
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  )
}
