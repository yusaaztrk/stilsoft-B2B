import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import BankTransferPanel from '@/components/BankTransferPanel'
import OrderCrossSell from '@/components/OrderCrossSell'
import { getStorefront } from '@/lib/api'
import { getPaymentStatus } from '@/lib/checkout'
import { formatPrice } from '@/lib/format'
import { loginWithReturn } from '@/lib/returnPath'
import { currentMember } from '@/lib/session'
import { TrackBankTransfer, TrackPurchase } from '@/components/TrackEvents'
import { scheduleMetaServerEvent } from '@/lib/metaCapi'

export const metadata: Metadata = {
  title: 'Havale / EFT Bilgileri',
  robots: { index: false, follow: false },
}

/*
  HAVALE / EFT SAYFASI (2026-09-20). Sipariş "Havale/EFT istendi" olarak açıldı; burada
  IBAN'lar, tutar ve sipariş numarası var. Müşteri parayı gönderince "Gönderdim" der; bayi
  onaylayınca sayfa "Ödeme alındı" gösterir. Durum ERP'den okunur (mağaza API'si üzerinden),
  adresten değil.
*/
export default async function BankTransferPage({
  searchParams,
}: {
  searchParams: Promise<{ siparis?: string }>
}) {
  const params = await searchParams
  const orderNo = (params.siparis ?? '').trim()
  if (!orderNo) redirect('/sepet')

  const member = await currentMember()
  if (!member) redirect(loginWithReturn(`/odeme/havale?siparis=${encodeURIComponent(orderNo)}`))

  const [status, settings] = await Promise.all([getPaymentStatus(orderNo), getStorefront()])
  const accounts = (settings.bankTransferAccounts ?? []).filter((a) => a.iban?.trim())

  /*
    Reklam ölçümü (2026-10-15). Havale talebi henüz satış değil (para gelmedi): Meta'ya
    "Lead", GA4'e "havale_siparisi" olarak gidiyor. Bayi ödemeyi onayladıktan sonra müşteri
    sayfayı açarsa o zaman "satış" sayılıyor.
  */
  const havaleBekliyor = !!status && !status.isPaid && status.status.startsWith('BankTransfer')
  if (status && (status.isPaid || havaleBekliyor)) {
    await scheduleMetaServerEvent({
      eventName: status.isPaid ? 'Purchase' : 'Lead',
      eventId: status.isPaid ? status.orderNo : `havale-${status.orderNo}`,
      value: status.amount,
      path: '/odeme/havale',
      externalId: member.customerCode || member.email,
    })
  }

  return (
    <div className="wrap checkout-page-wrapper">
      {status?.isPaid && <TrackPurchase orderNo={status.orderNo} value={status.amount} />}
      {havaleBekliyor && status && <TrackBankTransfer orderNo={status.orderNo} value={status.amount} />}
      <div className="crumbs">
        <Link href="/">Anasayfa</Link>
        <span>›</span>
        <span>Havale / EFT</span>
      </div>

      <div className="auth-page">
        {/*
          Kart 720px'ti ve `.auth-page` ortalıyor; geniş ekranda içerik dar bir şeride
          sıkışıp "çok içeride" duruyordu (kullanıcı bildirimi). Burası bir giriş formu
          değil, IBAN ve tutar okunacak bir ödeme talimatı — genişliğe ihtiyacı var.
        */}
        <div className="auth-card havale-karti">
          <h1>Havale / EFT ile ödeme</h1>
          {!status ? (
            <div className="auth-error">Sipariş bulunamadı. <Link href="/hesabim/siparislerim">Siparişlerim</Link></div>
          ) : (
            <BankTransferPanel
              orderNo={orderNo}
              amountText={formatPrice(status.amount, status.currency)}
              status={status.status}
              isPaid={status.isPaid}
              message={status.message}
              accounts={accounts}
              timeoutHours={settings.bankTransferTimeoutHours ?? 72}
            />
          )}
        </div>
      </div>

      {/* Havale bekleyen sipariş de bir siparis: tamamlayıcı ürünler burada da (2026-09-21). */}
      {status && (status.isPaid || status.status.startsWith('BankTransfer')) && <OrderCrossSell orderNo={orderNo} />}
    </div>
  )
}
