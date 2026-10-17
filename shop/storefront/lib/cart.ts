import { cookies } from 'next/headers'
import { SESSION_COOKIE } from '@/lib/session'

const API = process.env.SHOP_API_URL ?? 'http://localhost:5150'

export type CartLine = {
  stockCode: string
  slug: string
  name: string
  imageUrl?: string | null
  /** Ürünün kategori adresi — sepetteki çapraz satış önerileri buradan besleniyor. */
  categorySlug?: string | null
  quantity: number
  unitNetPrice: number
  unitGrossPrice: number
  taxRate: number
  lineNet: number
  lineVat: number
  lineGross: number
  currency: string
  isInstallable: boolean
  /**
   * Bir adet için montaj/kurulum bedeli, **KDV dahil**. 0 ise montaj ücretsiz —
   * `isInstallable` yine true olabilir (ankastre, beyaz eşya).
   */
  installationFeeUnit: number
  /**
   * Müşteri bu satır için montaj İSTEDİ Mİ.
   *
   * `isInstallable` "montaj seçilebilir" demek; bu alan "seçildi" demek. İkisi ayrı:
   * montajı olan ürünü montajsız da satın alabilmek gerekiyor (B2B sipariş ekranındaki
   * "Montaj istiyorum / istemiyorum" seçiminin vitrindeki karşılığı).
   */
  wantsInstallation: boolean
  /** Satırın TAHSİL EDİLEN montaj bedeli (birim × adet), KDV dahil. Seçilmemişse 0. */
  installationTotal: number
}

export type CartView = {
  lines: CartLine[]
  subTotalNet: number
  vatTotal: number
  /** Ürünlerin KDV dahil toplamı — montaj bedeli hariç. */
  productTotal: number
  /**
   * Sepetteki montaj bedellerinin toplamı, KDV dahil.
   *
   * KDV MATRAHINA GİRMEZ: B2B'deki kuralın aynısı — bedel zaten KDV dahil girildiği için
   * `vatTotal`e katılsaydı KDV'si iki kez sayılırdı. Genel toplam
   * `ürün neti + ürün KDV'si + montaj brütü` olarak kuruluyor.
   */
  installationTotal: number
  grandTotal: number
  currency: string
  itemCount: number
  removedStockCodes: string[]
}

export const emptyCart: CartView = {
  lines: [],
  subTotalNet: 0,
  vatTotal: 0,
  productTotal: 0,
  installationTotal: 0,
  grandTotal: 0,
  currency: 'TRY',
  itemCount: 0,
  removedStockCodes: [],
}

/** Sunucu tarafında sepet. Oturum yoksa boş sepet döner — hata değil, sadece giriş yapılmamıştır. */
export async function getCart(): Promise<CartView> {
  const store = await cookies()
  const token = store.get(SESSION_COOKIE)?.value
  if (!token) return emptyCart

  try {
    const res = await fetch(`${API}/api/cart`, {
      headers: { 'X-Shop-Session': token },
      cache: 'no-store',
    })
    if (!res.ok) return emptyCart
    return (await res.json()) as CartView
  } catch {
    return emptyCart
  }
}
