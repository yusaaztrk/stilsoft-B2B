import type { ProductListResponse } from '../types/Product'

import { API_BASE_URL } from '../config/api'
import { redirectToLogin } from '../auth/redirectToLogin'

export type FetchProductsParams = {
  main?: string
  sub?: string
  q?: string
  id?: string
  ids?: string
  supplierId?: number
  dealerCode?: string
  priceCustomerCode?: string
  displayPriceGroupCode?: number
  includeDealer?: boolean
  /** Virgüllü ürün tipi süzgeci, ör. 'HIZMET,SERVIS'. Verilmezse tüm tipler gelir. */
  productType?: string
  includeInactive?: boolean
  page?: number
  pageSize?: number
  sort?: string
  currencyCode?: number
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0
}

function parsePositiveInt(value: unknown, fallback: number) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  const i = Math.floor(n)
  return i >= 1 ? i : fallback
}

type StoredDealer = {
  code: string
  label?: string
}

function safeParseDealer(json: string | null): StoredDealer | null {
  if (!json) return null
  try {
    const parsed = JSON.parse(json)
    const code = String(parsed?.code ?? '').trim()
    const label = String(parsed?.label ?? '').trim()
    if (!code) return null
    return { code, label }
  } catch {
    return null
  }
}

function buildQuery(params: FetchProductsParams) {
  const sp = new URLSearchParams()

  // defaults
  sp.set('includeInactive', String(Boolean(params.includeInactive)))
  sp.set('page', String(parsePositiveInt(params.page, 1)))
  sp.set('pageSize', String(parsePositiveInt(params.pageSize, 20)))

  if (isNonEmptyString(params.main)) sp.set('main', params.main.trim())
  if (isNonEmptyString(params.sub)) sp.set('sub', params.sub.trim())
  if (isNonEmptyString(params.q)) sp.set('q', params.q.trim())
  if (isNonEmptyString(params.id)) sp.set('id', params.id.trim())
  if (isNonEmptyString(params.ids)) sp.set('ids', params.ids.trim())
  if (isNonEmptyString(params.productType)) sp.set('productType', params.productType.trim())

  if (params.supplierId != null && Number.isFinite(Number(params.supplierId)) && Number(params.supplierId) > 0) {
    sp.set('supplierId', String(Math.floor(Number(params.supplierId))))
  }

  if (params.includeDealer) {
    const dealerCode = isNonEmptyString(params.dealerCode) ? params.dealerCode.trim() : undefined

    if (dealerCode) sp.set('dealerCode', dealerCode)
  }

  if (isNonEmptyString(params.priceCustomerCode)) {
    sp.set('priceCustomerCode', params.priceCustomerCode.trim())
  }

  if (params.displayPriceGroupCode != null && Number.isFinite(params.displayPriceGroupCode) && params.displayPriceGroupCode > 0) {
    sp.set('displayPriceGroupCode', String(Math.floor(params.displayPriceGroupCode)))
  }

  if (params.currencyCode != null) {
    sp.set('currencyCode', String(params.currencyCode))
  }

  if (isNonEmptyString(params.sort)) sp.set('sort', params.sort.trim())
  return sp.toString()
}

function getFriendlyError(text: string, status: number) {
  const t = (text ?? '').trim()
  if (!t) return `Ürünler alınamadı (${status})`
  if (t.startsWith('{') || t.startsWith('[')) {
    try {
      const j = JSON.parse(t)
      const m = j?.message || j?.error || j?.title
      if (typeof m === 'string' && m.trim()) return m.trim()
    } catch {
      return `Ürünler alınamadı (${status})`
    }
  }
  return t
}

export async function fetchProducts(params: FetchProductsParams, opts?: { signal?: AbortSignal }): Promise<ProductListResponse> {
  const nextParams: FetchProductsParams = { ...params }

  if (nextParams.includeDealer && !isNonEmptyString(nextParams.dealerCode)) {
    const stored = safeParseDealer(localStorage.getItem('selected_dealer_v1'))
    if (stored) {
      nextParams.dealerCode = stored.code
    }
  }

  const token = localStorage.getItem('accessToken')

  const doRequest = async (p: FetchProductsParams) => {
    const qs = buildQuery(p)
    return fetch(`${API_BASE_URL}/api/products${qs ? `?${qs}` : ''}`, {
      signal: opts?.signal,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      }
    })
  }

  let res = await doRequest(nextParams)

  if (!res.ok) {
    if (res.status === 401) {
      localStorage.removeItem('accessToken')
      localStorage.removeItem('refreshToken')
      localStorage.removeItem('userName')
      sessionStorage.removeItem('userName')
      if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
        redirectToLogin()
      }
      throw new Error('Oturum süresi doldu. Lütfen tekrar giriş yapın.')
    }

    const text = await res.text().catch(() => '')

    // Fallback: if dealer info is invalid/missing on backend, retry once without dealer params
    if (nextParams.includeDealer && (res.status === 400 || res.status === 404)) {
      const lower = String(text ?? '').toLowerCase()
      const looksLikeDealerProblem =
        lower.includes('dealer') ||
        lower.includes('bayi') ||
        lower.includes('cari') ||
        lower.includes('not found') ||
        lower.includes('bulunamad')

      if (looksLikeDealerProblem) {
        const fallbackParams: FetchProductsParams = {
          ...nextParams,
          includeDealer: false,
          dealerCode: undefined
        }

        res = await doRequest(fallbackParams)
        if (res.ok) {
          const json = await res.json()
          if (json?.success === false) {
            throw new Error(String(json?.message ?? 'Ürünler alınamadı'))
          }
          const data = json?.data
          return {
            items: (data?.items ?? []) as any,
            total: Number(data?.total ?? 0),
            page: Number(data?.page ?? 1),
            pageSize: Number(data?.pageSize ?? 20)
          }
        }
      }
    }

    throw new Error(getFriendlyError(text, res.status))
  }

  const json = await res.json()
  if (json?.success === false) {
    throw new Error(String(json?.message ?? 'Ürünler alınamadı'))
  }

  const data = json?.data
  return {
    items: (data?.items ?? []) as any,
    total: Number(data?.total ?? 0),
    page: Number(data?.page ?? 1),
    pageSize: Number(data?.pageSize ?? 20)
  }
}

/**
 * Shelf label PDF for one product, drawn on the server.
 *
 * Same output as the invoice barcode print. The browser used to build these with JsBarcode, which
 * encoded 13-digit article numbers as CODE128 whenever the product record did not explicitly say
 * EAN13 — a symbology the till will not match to the article — and printed at whatever size the
 * printer felt like. The server encodes EAN-13, verifies the check digit, and fixes the label at
 * 5,009 x 4,00 cm.
 *
 * Pass `price` to print the priced label; omitting it hits the price-free endpoint, which is a
 * separate permission.
 */
export async function fetchProductLabelPdf(
  productId: string,
  count: number,
  price?: number | null,
  currencyCode?: string | null
): Promise<Blob> {
  const id = String(productId ?? '').trim()
  if (!id) throw new Error('Geçersiz ürün')

  const sp = new URLSearchParams({ adet: String(Math.max(1, Math.floor(count) || 1)) })

  const withPrice = price != null && price > 0
  if (withPrice) {
    sp.set('fiyat', String(price))
    if (currencyCode) sp.set('paraBirimi', String(currencyCode).trim())
  }

  const path = withPrice ? 'etiket-fiyatli' : 'etiket'
  const token = localStorage.getItem('accessToken')

  const res = await fetch(
    `${API_BASE_URL}/api/products/${encodeURIComponent(id)}/${path}?${sp.toString()}`,
    { headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) } }
  )

  if (res.status === 401) {
    localStorage.removeItem('accessToken')
    localStorage.removeItem('refreshToken')
    localStorage.removeItem('userName')
    sessionStorage.removeItem('userName')
    if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
      redirectToLogin()
    }
    throw new Error('Oturum süresi doldu. Lütfen tekrar giriş yapın.')
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(getFriendlyError(text, res.status))
  }

  return await res.blob()
}

export async function fetchProductLabelsBatchPdf(
  items: Array<{ productId: string; count: number; price?: number | null; currencyCode?: string | null; paraBirimi?: string | null }>
): Promise<Blob> {
  if (!items || items.length === 0) throw new Error('Seçilen ürün yok')

  const payload = {
    items: items.map((x) => ({
      productId: String(x.productId).trim(),
      adet: Math.max(1, Math.floor(x.count) || 1),
      fiyat: x.price != null && x.price > 0 ? x.price : null,
      paraBirimi: x.paraBirimi || x.currencyCode || null
    }))
  }

  const token = localStorage.getItem('accessToken')
  const res = await fetch(`${API_BASE_URL}/api/products/etiket-toplu`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify(payload)
  })

  if (res.status === 401) {
    localStorage.removeItem('accessToken')
    localStorage.removeItem('refreshToken')
    localStorage.removeItem('userName')
    sessionStorage.removeItem('userName')
    if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
      redirectToLogin()
    }
    throw new Error('Oturum süresi doldu. Lütfen tekrar giriş yapın.')
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(getFriendlyError(text, res.status))
  }

  return await res.blob()
}
