import { API_BASE_URL } from '../config/api'

export type ProductPriceResponse = {
  id: string
  productId: string
  priceGroupId: string
  price: number
  currency: string
}

function buildHeaders(includeJson: boolean) {
  const headers: Record<string, string> = {}
  if (includeJson) headers['Content-Type'] = 'application/json'
  const token = localStorage.getItem('accessToken')
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
}

export async function fetchProductPricesByProducts(productIds: string[]): Promise<ProductPriceResponse[]> {
  const ids = productIds.filter(Boolean)
  if (ids.length === 0) return []
  const res = await fetch(`${API_BASE_URL}/api/product-prices/by-products`, {
    method: 'POST',
    headers: { ...buildHeaders(true) },
    body: JSON.stringify(ids)
  })
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(t || `Fiyatlar alınamadı (${res.status})`)
  }

  const json = (await res.json().catch(() => null)) as any
  let result: ProductPriceResponse[] = []
  if (Array.isArray(json)) result = json as ProductPriceResponse[]
  else if (Array.isArray(json?.data)) result = json.data as ProductPriceResponse[]
  else if (Array.isArray(json?.data?.items)) result = json.data.items as ProductPriceResponse[]
  else if (Array.isArray(json?.data?.data)) result = json.data.data as ProductPriceResponse[]
  else if (Array.isArray(json?.items)) result = json.items as ProductPriceResponse[]
  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.log('[fetchProductPricesByProducts] ids sent:', ids.length, 'raw json type:', Array.isArray(json) ? 'array' : typeof json, 'json keys:', json && !Array.isArray(json) ? Object.keys(json) : 'n/a', 'result count:', result.length, 'sample:', result.slice(0, 3).map((p: any) => ({ productId: p.productId, priceGroupId: p.priceGroupId, price: p.price })))
  }
  return result
}

export async function upsertProductPrice(payload: {
  productId: string
  priceGroupId: string
  price: number
  currency: string
}): Promise<ProductPriceResponse> {
  const res = await fetch(`${API_BASE_URL}/api/product-prices/upsert`, {
    method: 'POST',
    headers: { ...buildHeaders(true) },
    body: JSON.stringify(payload)
  })
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(t || `Fiyat kaydedilemedi (${res.status})`)
  }
  return (await res.json()) as ProductPriceResponse
}

/**
 * Birden çok fiyat satırını TEK istekte yazar ("Fiyat 4'e Göre Toplu Güncelle").
 *
 * `import` ucu KULLANILMIYOR: orası mevcut satırı (ürün, grup, DÖVİZ) üçlüsüyle eşliyor,
 * dolayısıyla döviz kodu kayıttakinden farklı yazılırsa ("TL" ↔ "TRY") güncellemek yerine
 * ikinci bir satır açıyor. `bulk-upsert` yalnız (ürün, grup) ile eşler.
 */
export async function bulkUpsertProductPrices(rows: Array<{
  productId: string
  priceGroupId: string
  price: number
  currency: string
}>): Promise<{ total: number; created: number; updated: number; unchanged: number; failed: number }> {
  const res = await fetch(`${API_BASE_URL}/api/product-prices/bulk-upsert`, {
    method: 'POST',
    headers: { ...buildHeaders(true) },
    body: JSON.stringify({ rows })
  })

  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(t || `Toplu fiyat güncellenemedi (${res.status})`)
  }

  const json = (await res.json().catch(() => null)) as any
  return json?.data ?? { total: 0, created: 0, updated: 0, unchanged: 0, failed: 0 }
}
