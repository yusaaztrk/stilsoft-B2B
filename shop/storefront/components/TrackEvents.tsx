'use client'

import { useEffect, useRef } from 'react'
import { useCart } from '@/context/CartContext'
import { displayName } from '@/lib/format'
import {
  trackBankTransferOrder,
  trackBeginCheckout,
  trackPurchase,
  trackViewItem,
  type TrackItem,
} from '@/lib/track'

/*
  SAYFAYA BAĞLI REKLAM OLAYLARI (2026-10-15). Hiçbiri ekrana bir şey basmaz.

  Sunucu sayfaları (ürün, ödeme, sonuç) istemci kodu çalıştıramadığı için olaylar bu küçük
  bileşenlerden gönderiliyor. Satın alma olayları tarayıcı başına BİR KEZ gönderiliyor:
  sonuç sayfası yenilendiğinde aynı sipariş ikinci kez satış sayılmasın (GA4 aynı
  transaction_id'yi zaten eler, ama Meta'nın tarayıcı tarafı için bu kontrol gerekli).
*/

/** Ürün sayfası açıldı. */
export function TrackViewItem(props: TrackItem) {
  const { stockCode, name, price, category } = props
  useEffect(() => {
    trackViewItem({ stockCode, name, price, category })
  }, [stockCode, name, price, category])
  return null
}

/** Ödeme sayfasına gelindi. Sepet istemcide yüklenince bir kez gönderilir. */
export function TrackBeginCheckout() {
  const { cart } = useCart()
  const gonderildi = useRef(false)
  useEffect(() => {
    if (gonderildi.current || !cart || cart.lines.length === 0) return
    gonderildi.current = true
    trackBeginCheckout(
      cart.lines.map((l) => ({
        stockCode: l.stockCode,
        name: displayName(l.name),
        price: l.unitGrossPrice,
        quantity: l.quantity,
        category: l.categorySlug,
      })),
      cart.grandTotal,
    )
  }, [cart])
  return null
}

function birKez(anahtar: string): boolean {
  try {
    if (window.localStorage.getItem(anahtar)) return false
    window.localStorage.setItem(anahtar, '1')
    return true
  } catch {
    // Depolama kapalıysa yine gönderilir; GA4 transaction_id'yi, Meta eventID'yi eler.
    return true
  }
}

/** Kartla ödemesi DOĞRULANMIŞ sipariş (ödeme durumu ERP'den, adresten değil). */
export function TrackPurchase({ orderNo, value }: { orderNo: string; value: number }) {
  useEffect(() => {
    if (!orderNo || !birKez(`stilsoft:satis:${orderNo}`)) return
    trackPurchase(orderNo, value)
  }, [orderNo, value])
  return null
}

/** Havale/EFT ile açılan sipariş — ödeme henüz gelmedi, satış olarak sayılmıyor. */
export function TrackBankTransfer({ orderNo, value }: { orderNo: string; value: number }) {
  useEffect(() => {
    if (!orderNo || !birKez(`stilsoft:havale:${orderNo}`)) return
    trackBankTransferOrder(orderNo, value)
  }, [orderNo, value])
  return null
}
