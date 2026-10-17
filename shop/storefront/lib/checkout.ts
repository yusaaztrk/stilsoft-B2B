import { cookies } from 'next/headers'
import { SESSION_COOKIE } from '@/lib/session'

const API = process.env.SHOP_API_URL ?? 'http://localhost:5150'

export type PendingOrder = {
  orderNo: string
  grandTotal: number
}

export type PaymentStatus = {
  orderNo: string
  isPaid: boolean
  status: string
  amount: number
  currency: string
  message: string
}

async function sessionToken(): Promise<string | null> {
  const store = await cookies()
  return store.get(SESSION_COOKIE)?.value ?? null
}

/**
 * Ödeme sayfası için siparişi hazırlar.
 *
 * Sipariş ödemeden ÖNCE ERP'de doğuyor: ödenecek tutarın kaynağı sepetin ekrandaki hesabı
 * değil, siparişin kendisi olsun diye. Sayfa yenilense de ikinci sipariş açılmıyor — mağaza
 * API'si sepetin parmak izine bakıp var olanı geri veriyor.
 *
 * Hata mesajı olduğu gibi taşınıyor: "önceki siparişiniz ödendi" gibi bir cevabın müşteriye
 * ulaşması gerekiyor, genel bir hata metni yardımcı olmaz.
 */
export async function preparePendingOrder(
  deliveryNote?: string,
): Promise<{ order: PendingOrder | null; error: string | null }> {
  const token = await sessionToken()
  if (!token) return { order: null, error: 'Giriş yapmanız gerekiyor.' }

  try {
    const res = await fetch(`${API}/api/orders`, {
      method: 'POST',
      headers: { 'X-Shop-Session': token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ deliveryNote: deliveryNote ?? null }),
      cache: 'no-store',
    })

    const data = await res.json().catch(() => null)

    if (!res.ok) {
      return { order: null, error: data?.message ?? 'Sipariş hazırlanamadı.' }
    }

    return { order: data as PendingOrder, error: null }
  } catch {
    return { order: null, error: 'Sipariş sistemine ulaşılamadı.' }
  }
}

/**
 * Siparişin ödeme durumu.
 *
 * Cevap mağaza API'sinden, o da ERP'den alıyor — yani imza doğrulamasından geçmiş kayıttan.
 * Bankanın müşteriyi geri yolladığı adres bu soruya cevap DEĞİL: adres denetlenmiyor, dolayısıyla
 * içindeki hiçbir şey ödemenin kanıtı olamaz. Adresten yalnızca "hangi sipariş" bilgisi alınıyor.
 */
export async function getPaymentStatus(orderNo: string): Promise<PaymentStatus | null> {
  const token = await sessionToken()
  if (!token) return null

  try {
    const res = await fetch(`${API}/api/payments/${encodeURIComponent(orderNo)}`, {
      headers: { 'X-Shop-Session': token },
      cache: 'no-store',
    })

    if (!res.ok) return null
    return (await res.json()) as PaymentStatus
  } catch {
    return null
  }
}
