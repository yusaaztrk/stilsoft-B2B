import type { Metadata } from 'next'
import RecentlyViewed from '@/components/RecentlyViewed'
import OrderCrossSell from '@/components/OrderCrossSell'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { formatPrice } from '@/lib/format'
import { getPaymentStatus } from '@/lib/checkout'
import { loginWithReturn } from '@/lib/returnPath'
import { currentMember, isGuestOrderSession } from '@/lib/session'
import { getCompanyInfo } from '@/lib/companyInfo'
import { TrackPurchase } from '@/components/TrackEvents'
import { scheduleMetaServerEvent } from '@/lib/metaCapi'

export const metadata: Metadata = {
  title: 'Ödeme Sonucu',
  robots: { index: false, follow: false },
}

/**
 * Ödeme sonucu.
 *
 * Adresteki tek bilgi sipariş numarası. "Ödeme başarılı" bilgisi adresten, bankadan gelen
 * formdan ya da tarayıcıdan OKUNMUYOR: mağaza API'sine soruluyor, o da ERP'nin imza
 * doğrulamasından geçmiş kaydına bakıyor. Banka callback'in hangi adrese gittiğini
 * denetlemediği için adresten gelen hiçbir şey kanıt sayılamaz.
 */
export default async function PaymentResultPage({
  searchParams,
}: {
  searchParams: Promise<{ siparis?: string }>
}) {
  const { siparis } = await searchParams
  const orderNo = (siparis ?? '').trim()

  // Müşteri buraya BANKADAN dönüyor. Oturumu bir sebeple düşmüşse (uzun 3D adımı, farklı
  // sekme) giriş sonrası aynı sonuç sayfasına dönmesi gerekiyor: aksi hâlde ödemesini yaptı
  // mı yapmadı mı bilmeden hesap sayfasında kalırdı.
  const member = await currentMember()
  if (!member) {
    redirect(loginWithReturn(orderNo ? `/odeme/sonuc?siparis=${encodeURIComponent(orderNo)}` : '/odeme/sonuc'))
  }

  const status = orderNo.length > 0 ? await getPaymentStatus(orderNo) : null

  if (!status) {
    return (
      <div className="wrap">
        <div className="pay-result">
          <h1>Sipariş bulunamadı</h1>
          <p>Bu sipariş görüntülenemiyor. Siparişlerinizden kontrol edebilirsiniz.</p>
          <Link className="btn btn-dark" href="/hesabim">
            Hesabım
          </Link>
        </div>
      </div>
    )
  }

  const pending = status.status === 'Pending'

  // Reklam ölçümü (2026-10-15): ödeme ERP'de doğrulandıysa satış Meta'ya sunucudan da
  // bildiriliyor; tarayıcıdaki Pixel ile aynı event_id (sipariş no) — çift sayılmaz.
  if (status.isPaid) {
    await scheduleMetaServerEvent({
      eventName: 'Purchase',
      eventId: status.orderNo,
      value: status.amount,
      path: '/odeme/sonuc',
      externalId: member.customerCode || member.email,
    })
  }

  // Üye olmadan sipariş veren müşteri (2026-10-04): "Siparişlerim" yerine numarayı ve
  // bize ulaşma yolunu öne çıkarıyoruz; oturumu tarayıcı kapanınca zaten düşüyor.
  const [misafir, company] = await Promise.all([isGuestOrderSession(), getCompanyInfo()])
  const telefonDijit = company.phone.replace(/(?!^\+)[^\d]/g, '')

  return (
    <div className="wrap">
      {/* Reklam ölçümü (2026-10-15): GA4 purchase + Meta Purchase, tarayıcı başına bir kez. */}
      {status.isPaid && <TrackPurchase orderNo={status.orderNo} value={status.amount} />}
      <div className={`pay-result ${status.isPaid ? 'ok' : pending ? 'wait' : 'fail'}`}>
        <div className="pay-mark">{status.isPaid ? '✓' : pending ? '…' : '✕'}</div>

        <h1>
          {status.isPaid ? 'Ödemeniz alındı' : pending ? 'Ödemeniz işleniyor' : 'Ödeme tamamlanamadı'}
        </h1>

        <p>{status.message}</p>

        <dl className="pay-detail">
          <dt>Sipariş No</dt>
          <dd>{status.orderNo}</dd>
          {status.amount > 0 && (
            <>
              <dt>Tutar</dt>
              <dd>{formatPrice(status.amount, status.currency)}</dd>
            </>
          )}
        </dl>

        {status.isPaid ? (
          <p className="pay-next">
            Siparişiniz hazırlanmaya başlandı. Hazırlık tamamlandığında teslimat için sizinle
            irtibata geçeceğiz.
            {misafir && ' Sipariş numaranızı telefonunuza SMS ile de gönderdik.'}
          </p>
        ) : pending ? (
          <p className="pay-next">
            Bankadan sonuç bekleniyor. Bu sayfayı birkaç dakika sonra yenileyebilirsiniz.
          </p>
        ) : (
          <p className="pay-next">
            Kartınızdan tutar çekilmediyse tekrar deneyebilirsiniz. Sepetiniz duruyor.
          </p>
        )}

        {misafir && telefonDijit && (
          <p className="pay-next">
            Siparişinizle ilgili her soru için:{' '}
            <a href={`tel:${telefonDijit}`}>
              <b>{company.phone}</b>
            </a>
          </p>
        )}

        <div className="pay-actions">
          {!misafir && (
            <Link className="btn btn-dark" href="/hesabim">
              Siparişlerim
            </Link>
          )}
          {/*
            ALIŞVERİŞE DEVAM (2026-09-21). Sayfadaki tek çıkış "Siparişlerim"di: siparişini
            tamamlamış, memnun ve siteye hâlâ açık olan müşteriyi hesap ekranına kilitliyordu.
            Satın almanın hemen ardından katalog kapısı açık bırakmak, ikinci siparişin
            en ucuz yolu.
          */}
          <Link className="btn btn-line" href="/urunler">
            Alışverişe devam et
          </Link>
          {!status.isPaid && !pending && (
            <Link className="btn btn-line" href="/sepet">
              Sepete dön
            </Link>
          )}
        </div>
      </div>

      {/*
        Ödeme başarılıysa son baktıkları gösteriliyor — sepete atmadığı ama ilgilendiği ürünler.
        Zorlamayan bir hatırlatma: yeni ürün önermek yerine kendi baktıklarını gösteriyor.
      */}
      {/*
        SİPARİŞ SONRASI ÇAPRAZ SATIŞ (2026-09-21): sepet boşaldı, öneriler sipariş satırlarından.
        Son baktıklarının ÜSTÜNDE — önce "şunu da unuttun", sonra "bunlara bakmıştın".
      */}
      {status.isPaid && <OrderCrossSell orderNo={status.orderNo} />}
      {status.isPaid && <RecentlyViewed />}
    </div>
  )
}
