import { API_BASE_URL } from '../config/api'

export type BulkPricingProductDto = {
  id: string
  stockCode: string
  name: string
  /** KDV oranı (%) — ürünün kendi oranı, satır bazında değişir (0 / 5 / 10 / 16). */
  taxRate: number
  /** Bayi iskontosu (%) — Fiyat 6'yı Fiyat 4'ten türetirken kullanılır. */
  discountRate: number
  mainCategory?: string | null
  subCategory?: string | null
  /** Ürün kartındaki alış fiyatı (kendi para biriminde). */
  purchasePrice: number
  /** Alışın para birimi: USD / EUR / GBP / TRY. */
  purchaseCurrency: string
  /** Konteyner adedi — adet başı navlunun bölenidir. */
  containerQuantity: number
  boxQuantity: number
  /** Bu alış para birimi için SİSTEMDEN çekilen anlık kur (TL alışta 1). */
  /** Tedarikçi kodu ve adı — Products.SupplierId üzerinden. */
  supplierCode: string | null
  supplierName: string | null
  /**
   * Ürün kartındaki toplam stok (`Products.Stock`) — TÜM depoları kapsar, PASİF depolar dahil.
   * Depo kırılımı ucu (authorized-stock-balances) ise yalnızca aktif/yetkili depoları döner,
   * bu yüzden ikisi farklı olabilir. Fark ekranda açıkça gösterilir.
   */
  totalStock: number
  /** Teslim alınmamış alış siparişlerindeki miktar (termin). Stoğa henüz girmemiştir. */
  terminQuantity: number
  /** Ürün sistemde aktif mi. `saleOpen` (E/H) ile KARIŞTIRMA — ayrı şeyler. */
  isActive: boolean
  /** Ürün kartındaki navlun (konteyner başına USD). */
  freight: number
  /** Satışa açık mı — BsyVisibleFlag: "E" / "H". */
  saleOpen: string
  /** EN SON Fiyat 4 değişikliği (tek kayıt). Hiç değişmemişse boş dizi. */
  priceHistory: Array<{ oldPrice: number; newPrice: number; changedAt: string; changedBy: string }>
  usedRate: number
  /** Alış fiyatının anlık kurla TL karşılığı; kur yoksa null. */
  purchasePriceTry: number | null
  price1: number
  price2: number
  price3: number
  price4: number
  price5: number
  price6: number
}

export type BulkPricingCategoryDto = { key: string; name: string }

function buildHeaders(includeJson: boolean) {
  const headers: Record<string, string> = {}
  if (includeJson) headers['Content-Type'] = 'application/json'
  const token = localStorage.getItem('accessToken')
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
}

async function handle(res: Response) {
  if (res.ok) return res.json()
  const t = await res.text().catch(() => '')
  let msg = `İşlem gerçekleştirilemedi (${res.status})`
  try {
    const j = JSON.parse(t)
    msg = j?.message || j?.title || msg
  } catch {
    if (t.trim()) msg = t.trim()
  }
  throw new Error(msg)
}

export async function fetchBulkPricingProducts(opts?: {
  q?: string
  mainCategory?: string
  page?: number
  pageSize?: number
  includeInactive?: boolean
  signal?: AbortSignal
}): Promise<{
  items: BulkPricingProductDto[]
  total: number
  rates: Record<string, number>
  rateDate: string | null
  rateWarning: string | null
  rateProvider: string | null
}> {
  const qs = new URLSearchParams()
  if (opts?.q) qs.set('q', opts.q)
  if (opts?.mainCategory) qs.set('mainCategory', opts.mainCategory)
  qs.set('page', String(opts?.page ?? 1))
  qs.set('pageSize', String(opts?.pageSize ?? 200))
  if (opts?.includeInactive) qs.set('includeInactive', 'true')

  const res = await fetch(`${API_BASE_URL}/api/BulkPricing/products?${qs.toString()}`, {
    headers: { ...buildHeaders(false) },
    signal: opts?.signal
  })
  const j = await handle(res)
  const d = j?.data ?? {}

  // TUZAK: sunucu sözlüğü JSON'a KÜÇÜK HARF anahtarlarla seri hale getiriyor ("usd"),
  // ekran ise "USD" diye arıyordu ve kur her zaman undefined kalıyordu. Burada normalize
  // edilir ki çağıran taraf harf durumunu düşünmek zorunda kalmasın.
  const rawRates = (d.rates ?? {}) as Record<string, number>
  const rates: Record<string, number> = {}
  for (const [k, v] of Object.entries(rawRates)) {
    rates[String(k).trim().toUpperCase()] = Number(v)
  }

  return {
    items: (d.items ?? []) as BulkPricingProductDto[],
    total: Number(d.total ?? 0),
    rates,
    rateDate: d.rateDate ?? null,
    rateWarning: d.rateWarning ?? null,
    rateProvider: d.rateProvider ?? null
  }
}

export async function fetchBulkPricingCategories(signal?: AbortSignal): Promise<BulkPricingCategoryDto[]> {
  const res = await fetch(`${API_BASE_URL}/api/BulkPricing/categories`, {
    headers: { ...buildHeaders(false) },
    signal
  })
  const j = await handle(res)
  return (j?.data ?? []) as BulkPricingCategoryDto[]
}

/**
 * Sunucuya YALNIZCA Fiyat 4 gönderilir. Diğer beş fiyatı sunucu ürünün kendi KDV ve
 * iskonto oranından yeniden hesaplar; istemcinin türev fiyatlarına güvenilmez.
 */
export async function applyBulkPricing(
  items: Array<{ productId: string; price4: number }>
): Promise<{ updated: number }> {
  const res = await fetch(`${API_BASE_URL}/api/BulkPricing/apply`, {
    method: 'POST',
    headers: { ...buildHeaders(true) },
    body: JSON.stringify({ items })
  })
  const j = await handle(res)
  return { updated: Number(j?.data?.updated ?? 0) }
}

/** Ürün kartındaki maliyet alanlarını günceller. Fiyatlara dokunmaz. */
export async function updateProductCost(
  productId: string,
  payload: {
    purchasePrice: number
    currencyCode: number
    containerQuantity: number
    boxQuantity: number
    freight: number
    saleOpen: string
  }
): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/api/BulkPricing/product/${encodeURIComponent(productId)}/cost`, {
    method: 'PUT',
    headers: { ...buildHeaders(true) },
    body: JSON.stringify(payload)
  })
  await handle(res)
}
