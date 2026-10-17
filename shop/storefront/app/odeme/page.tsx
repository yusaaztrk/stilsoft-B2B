import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import CheckoutAddressPicker from '@/components/CheckoutAddressPicker'
import { getProfile, listAddresses } from '@/lib/account'
import { COMPANY_FALLBACK, resolveCompanyInfo, whatsAppDigits } from '@/lib/companyInfo'
import { displayName, formatPrice, mediaUrl } from '@/lib/format'
import { getCart } from '@/lib/cart'
import { preparePendingOrder } from '@/lib/checkout'
import { checkAddressEligibility } from '@/lib/cyprusLocation'
import { currentMember } from '@/lib/session'
import CheckoutEntry from '@/components/CheckoutEntry'
import CheckoutHelpBox from '@/components/CheckoutHelpBox'
import KktcGate from '@/components/KktcGate'
import PaymentMethodChooser from '@/components/PaymentMethodChooser'
import { TrackBeginCheckout } from '@/components/TrackEvents'
import { getStorefront } from '@/lib/api'

export const metadata: Metadata = {
  title: 'Güvenli Ödeme',
  robots: { index: false, follow: false },
}

export default async function CheckoutPage({
  searchParams,
}: {
  searchParams: Promise<{ yol?: string }>
}) {
  const member = await currentMember()

  const cart = await getCart()
  if (cart.lines.length === 0) redirect('/sepet')

  /*
    GİRİŞSİZ MÜŞTERİ ÖDEMEYE GELDİ — İKİ BÜYÜK DÜĞME (2026-10-04).

    "Üye olmadan devam et" (ad + telefon + adres, SMS'siz) ya da "Üyelik ile devam et" (SMS
    kodu / e-posta). Eskiden üyesiz yol yalnız SMS KAPALIYKEN ve panel ayarı açıkken
    vardı; canlıda SMS açık olduğu için herkes koda zorlanıyor, kod gelmeyen vazgeçiyordu
    (44 ödemeye geçişin 26'sı "ödeme bekliyor"da kaldı). Artık üyesiz yol her zaman açık.

    Sağda sepet özeti: müşteri bilgilerini yazarken neyi aldığını ve tutarı görmeli.
  */
  if (!member) {
    const [storefront, params] = await Promise.all([getStorefront(), searchParams])
    const company = resolveCompanyInfo(storefront)
    const baslangic = params.yol === 'misafir' ? 'misafir' : params.yol === 'uye' ? 'uye' : null

    return (
      <div className="wrap checkout-page-wrapper">
        <TrackBeginCheckout />
        <div className="crumbs">
          <Link href="/">Anasayfa</Link>
          <span>›</span>
          <Link href="/sepet">Sepetim</Link>
          <span>›</span>
          <span>Ödeme</span>
        </div>

        <div className="checkout-stepper-bar">
          <div className="c-step completed">
            <span className="step-num">1</span>
            <span className="step-label">Sepetim</span>
          </div>
          <div className="step-connector completed" />
          <div className="c-step active">
            <span className="step-num">2</span>
            <span className="step-label">Teslimat Bilgileri</span>
          </div>
          <div className="step-connector" />
          <div className="c-step">
            <span className="step-num">3</span>
            <span className="step-label">Güvenli Ödeme</span>
          </div>
        </div>

        <div className="checkout-main-container">
          <div className="checkout-header-title">
            <h1>Siparişi tamamlayın</h1>
            <p>Nasıl devam etmek istediğinizi seçin — üyelik zorunlu değil.</p>
          </div>

          <div className="checkout-layout-grid">
            <div className="checkout-form-column">
              <CheckoutEntry baslangic={baslangic} />
              <CheckoutHelpBox kaynak="odeme" telefon={company.phone} whatsapp={storefront.whatsAppNumber?.trim() || COMPANY_FALLBACK.whatsApp} />
            </div>

            <aside className="checkout-summary-column">
              <div className="checkout-summary-sticky-card">
                <div className="c-summary-card-head">
                  <h3>Sepetiniz</h3>
                  <Link href="/sepet" className="c-order-no-tag">
                    Düzenle
                  </Link>
                </div>
                <div className="c-summary-products-list">
                  {cart.lines.map((line) => {
                    const img = mediaUrl(line.imageUrl)
                    const name = displayName(line.name)
                    return (
                      <div key={line.stockCode} className="c-summary-line-item">
                        <div className="c-sum-thumb">
                          {img ? (
                            <Image src={img} alt={name} width={48} height={48} style={{ objectFit: 'contain' }} />
                          ) : (
                            <span>ST</span>
                          )}
                        </div>
                        <div className="c-sum-details">
                          <span className="c-sum-name">{name}</span>
                          <span className="c-sum-qty">
                            {line.quantity} adet
                            {line.wantsInstallation && <span className="c-sum-montage"> · Montaj</span>}
                          </span>
                        </div>
                        <div className="c-sum-price num">{formatPrice(line.lineGross, 'TRY')}</div>
                      </div>
                    )
                  })}
                </div>
                <div className="c-summary-totals">
                  {(cart.installationTotal ?? 0) > 0 && (
                    <div className="c-totals-row">
                      <span>Montaj / Kurulum Bedeli</span>
                      <span className="num">{formatPrice(cart.installationTotal, 'TRY')}</span>
                    </div>
                  )}
                  <div className="c-totals-row">
                    <span>Teslimat &amp; Nakliye</span>
                    <span className="c-free-badge">Ücretsiz</span>
                  </div>
                  <div className="c-totals-row grand-total">
                    <span>Toplam (KDV Dahil)</span>
                    <span className="c-grand-amount num">{formatPrice(cart.grandTotal, 'TRY')}</span>
                  </div>
                </div>
                <div className="c-summary-trust-badges">
                  <div className="c-trust-row">
                    <span className="c-t-icon">🛡️</span>
                    <span>3D Secure ile güvenli ödeme</span>
                  </div>
                  <div className="c-trust-row">
                    <span className="c-t-icon">🚚</span>
                    <span>KKTC geneli ücretsiz teslimat</span>
                  </div>
                  <div className="c-trust-row">
                    <span className="c-t-icon">🏷️</span>
                    <span>3 yıl distribütör garantisi</span>
                  </div>
                </div>
              </div>
            </aside>
          </div>
        </div>
      </div>
    )
  }

  const [{ order, error }, profile, addresses, settings] = await Promise.all([
    preparePendingOrder(),
    getProfile(),
    listAddresses(),
    getStorefront(),
  ])

  // Kayıtlı adres listesi API'den varsayılan-önce sıralı gelir (bkz. lib/account.ts), yani
  // [0] — varsa — teslimatın gideceği carideki adresle AYNIDIR (SetDefaultAddress artık ERP'yi
  // de günceller). Liste boşsa geriye dönük uyumluluk için tek profil adresine düşülür.
  const activeAddress = addresses[0] ?? null

  const addressEligibility = activeAddress
    ? checkAddressEligibility(activeAddress.city, activeAddress.address)
    : checkAddressEligibility(profile?.city, profile?.address)

  const addressLine = activeAddress
    ? [activeAddress.address, activeAddress.district, activeAddress.city]
        .map((x) => (x ?? '').trim())
        .filter((x) => x.length > 0)
        .join(', ')
    : [profile?.address, profile?.district, profile?.city]
        .map((x) => (x ?? '').trim())
        .filter((x) => x.length > 0)
        .join(', ')

  const deliveryPersonName = activeAddress?.fullName || member.fullName
  const deliveryPhone = activeAddress?.phone || member.phone || profile?.phone || ''

  return (
    <div className="wrap checkout-page-wrapper">
      {/* Reklam ölçümü (2026-10-15): GA4 begin_checkout + Meta InitiateCheckout. */}
      <TrackBeginCheckout />
      {/* Kırıntı Yolu */}
      <div className="crumbs">
        <Link href="/">Anasayfa</Link>
        <span>›</span>
        <Link href="/sepet">Sepetim</Link>
        <span>›</span>
        <span>Güvenli Ödeme</span>
      </div>

      {/* Adım Çubuğu (Checkout Stepper) */}
      <div className="checkout-stepper-bar">
        <div className="c-step completed">
          <span className="step-num">1</span>
          <span className="step-label">Sepetim</span>
        </div>
        <div className="step-connector completed" />
        <div className="c-step completed">
          <span className="step-num">2</span>
          <span className="step-label">Teslimat &amp; Adres</span>
        </div>
        <div className="step-connector completed" />
        <div className="c-step active">
          <span className="step-num">3</span>
          <span className="step-label">Güvenli Ödeme</span>
        </div>
      </div>

      <div className="checkout-main-container">
        <div className="checkout-header-title">
          <h1>Güvenli Ödeme</h1>
          <p>Ödeme yönteminizi seçin; 256-Bit SSL korumalı adımı tamamlayalım.</p>
        </div>

        {!order ? (
          <div className="checkout-blocked-card">
            <div className="c-blocked-icon">⚠️</div>
            <h3>Sipariş Hazırlanamadı</h3>
            <p>{error ?? 'Siparişiniz işleme alınamadı. Lütfen sepetinizi kontrol edin.'}</p>
            <Link className="btn btn-dark" href="/sepet">
              Sepete Dön
            </Link>
          </div>
        ) : (
          <div className="checkout-layout-grid">
            {/* SOL: Kart Bilgileri ve Ödeme Formu */}
            <div className="checkout-form-column">
              {/* Teslimat Adresi Önizleme Kutusu */}
              <div className="checkout-address-preview-card">
                <div className="c-addr-preview-head">
                  <div className="c-addr-icon-title">
                    <span className="c-addr-icon">📍</span>
                    <div>
                      <strong>Teslimat Adresi</strong>
                      <span className="c-addr-sub">Siparişiniz bu adrese ulaştırılacaktır</span>
                    </div>
                  </div>
                  {addresses.length > 0 ? (
                    <CheckoutAddressPicker addresses={addresses} activeId={activeAddress?.id} />
                  ) : (
                    <Link href="/hesabim" className="c-change-addr-btn">
                      {addressLine ? 'Adresi Değiştir' : '+ Adres Ekle'}
                    </Link>
                  )}
                </div>

                <div className="c-addr-preview-body">
                  {addressLine ? (
                    <>
                      <p className="c-addr-person">
                        <b>{deliveryPersonName}</b> • {deliveryPhone}
                      </p>
                      <p className="c-addr-full">{addressLine}</p>
                      {!addressEligibility.isEligible && (
                        <p style={{ marginTop: '8px', color: '#b91c1c', fontSize: '12px', fontWeight: 600 }}>
                          ⚠️ {addressEligibility.reason}
                        </p>
                      )}
                    </>
                  ) : (
                    <p className="c-addr-empty-alert">
                      Kayıtlı teslimat adresiniz bulunmuyor. Siparişinizin sorunsuz teslimi için lütfen adresinizi ekleyin.
                    </p>
                  )}
                </div>
              </div>

              {/* Kart Formu */}
              <div className="checkout-card-form-box">
                <div className="c-card-form-head">
                  <div className="c-head-title-row">
                    <h3>Ödeme</h3>
                    <div className="c-security-tag">
                      <span>🔒 256-Bit SSL</span>
                    </div>
                  </div>
                  <p>Kart, taksit veya havale/EFT ile ödeyebilirsiniz.</p>
                </div>

                {/* Konum çerezi yoksa (sepeti atlayıp geldi) kapı burada; varsa sessizce geçer. */}
                <KktcGate enforce>
                  {/*
                    Yöntem seçimi HER ZAMAN çiziliyor (2026-09-21). Kart formunu doğrudan
                    açmak, müşterinin havale ve taksit seçeneklerini hiç görmemesi demekti.
                    Kart arayüzü seçim yapıldıktan sonra açılıyor.
                  */}
                  <PaymentMethodChooser
                    orderNo={order.orderNo}
                    bankTransferEnabled={(settings.bankTransferAccounts ?? []).some((a) => a.iban?.trim())}
                    telefon={resolveCompanyInfo(settings).phone}
                    whatsapp={whatsAppDigits(settings)}
                  />
                </KktcGate>
              </div>
            </div>

            {/* SAĞ: Sipariş Özeti */}
            <aside className="checkout-summary-column">
              <div className="checkout-summary-sticky-card">
                <div className="c-summary-card-head">
                  <h3>Sipariş Özeti</h3>
                  <span className="c-order-no-tag">No: {order.orderNo}</span>
                </div>

                {/* Ürün Listesi */}
                <div className="c-summary-products-list">
                  {cart.lines.map((line) => {
                    const img = mediaUrl(line.imageUrl)
                    const name = displayName(line.name)
                    return (
                      <div key={line.stockCode} className="c-summary-line-item">
                        <div className="c-sum-thumb">
                          {img ? (
                            <Image
                              src={img}
                              alt={name}
                              width={48}
                              height={48}
                              style={{ objectFit: 'contain' }}
                            />
                          ) : (
                            <span>ST</span>
                          )}
                        </div>
                        <div className="c-sum-details">
                          <span className="c-sum-name">{name}</span>
                          <span className="c-sum-qty">
                            {line.quantity} adet
                            {/*
                              Ödemeden önce SON KONTROL: hangi ürün için montaj istendiği
                              burada da yazıyor. Montaj artık seçime bağlı ve bedeli genel
                              toplama giriyor; müşteri kartını girmeden önce bunu görmeli.
                            */}
                            {line.wantsInstallation && (
                              <span className="c-sum-montage">
                                · Montaj
                                {line.installationFeeUnit > 0
                                  ? ` +${formatPrice(line.installationFeeUnit * line.quantity, 'TRY')}`
                                  : ' (ücretsiz)'}
                              </span>
                            )}
                          </span>
                        </div>
                        <div className="c-sum-price num">
                          {formatPrice(line.lineGross, 'TRY')}
                        </div>
                      </div>
                    )
                  })}
                </div>

                {/* Tutar Hesabı */}
                {/*
                  ÖDENECEK TUTARIN KAYNAĞI SİPARİŞTİR, SEPET DEĞİL.
                  `order.grandTotal` ERP'nin hesapladığı ve karttan çekilecek tutar; sepet
                  yalnızca kırılımı göstermek için kullanılıyor. Ara toplam olarak genel
                  toplamın kendisini yazmak (eski hâl) iki satırda aynı rakamı gösteriyor ve
                  montaj bedelini görünmez kılıyordu.
                */}
                <div className="c-summary-totals">
                  <div className="c-totals-row">
                    <span>Ara Toplam</span>
                    <span className="num">
                      {formatPrice(order.grandTotal - (cart.installationTotal ?? 0), 'TRY')}
                    </span>
                  </div>
                  {(cart.installationTotal ?? 0) > 0 && (
                    <div className="c-totals-row">
                      <span>Montaj / Kurulum Bedeli</span>
                      <span className="num">{formatPrice(cart.installationTotal, 'TRY')}</span>
                    </div>
                  )}
                  <div className="c-totals-row">
                    <span>Teslimat &amp; Nakliye</span>
                    <span className="c-free-badge">Ücretsiz</span>
                  </div>
                  <div className="c-totals-row grand-total">
                    <span>Ödenecek Tutar (KDV Dahil)</span>
                    <span className="c-grand-amount num">{formatPrice(order.grandTotal, 'TRY')}</span>
                  </div>
                </div>

                {/* Güvenlik Notları */}
                <div className="c-summary-trust-badges">
                  <div className="c-trust-row">
                    <span className="c-t-icon">🛡️</span>
                    <span>3D Secure ile Güvenli Ödeme Doğrulaması</span>
                  </div>
                  <div className="c-trust-row">
                    <span className="c-t-icon">🚚</span>
                    <span>KKTC Geneli Ücretsiz Sigortalı Sevkiyat</span>
                  </div>
                  <div className="c-trust-row">
                    <span className="c-t-icon">🔒</span>
                    <span>Kart bilgileriniz mağaza sunucularında saklanmaz</span>
                  </div>
                </div>
              </div>
            </aside>
          </div>
        )}
      </div>
    </div>
  )
}
