import { API_BASE_URL } from '../config/api'
import { redirectToLogin } from '../auth/redirectToLogin'

export type CustomerOfferLineDto = {
  id: number
  productId: string
  stockCode: string
  stockName?: string | null
  /** Proforma basımının en sol sütunu. */
  barcode?: string | null
  description?: string | null
  quantity: number
  unitPrice: number
  vatRate: number
  discountType: number
  discountValue: number
  lineNo: number
  /** Kampanya satırıysa kampanya adı; dolu satır düzenlemede kilitli gelir. */
  campaignName?: string | null
}

export type CustomerOfferListItemDto = {
  id: number
  date: string
  documentNo: string
  customerCode?: string | null
  customerName?: string | null
  deliveryCustomerCode?: string | null
  deliveryCustomerName?: string | null
  description?: string | null
  vatExempt: boolean
  subtotal: number
  discountTotal: number
  netTotal: number
  vatTotal: number
  grandTotal: number
  createUser?: string | null
  proformaDocumentNo?: string | null
  invoiceId?: number | null
  currencyTypeId?: number
  targetAccountType?: 'FATURA' | 'ACIK' | 'ASKERIYE' | string | null
  customerInvoiceType?: string | null
  priceGroupCode?: number | null
  lines: CustomerOfferLineDto[]
}

export type CustomerOfferDetailDto = CustomerOfferListItemDto & {
  salesmanCode?: string | null
  muhtelif?: {
    customerCode: string
    name: string
    city?: string | null
    district?: string | null
    address?: string | null
    phone?: string | null
    email?: string | null
    taxOffice?: string | null
    taxNumber?: string | null
  } | null
  proformaDocumentNo?: string | null
}

export type CreateCustomerOfferRequest = {
  date?: string | null
  vatExempt: boolean
  customerCode?: string | null
  deliveryCustomerCode?: string | null
  muhtelif?: {
    customerCode: string
    name: string
    city?: string | null
    district?: string | null
    address?: string | null
    phone?: string | null
    email?: string | null
    taxOffice?: string | null
    taxNumber?: string | null
  } | null
  salesmanCode?: string | null
  description?: string | null
  /** Kopyalanan teklif — muhtelifse kopya AYNI muhtelif müşteriye bağlanır (yeni cari açılmaz). */
  copyFromOfferId?: number | null
  lines: Array<{
    productId: string
    quantity: number
    discountType: number
    discountValue: number
    unitPrice?: number
    campaignName?: string | null
  }>
}

function buildHeaders(includeJson: boolean) {
  const headers: Record<string, string> = {}
  if (includeJson) headers['Content-Type'] = 'application/json'
  const token = localStorage.getItem('accessToken')
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
}

async function handleUnauthorized(res: Response) {
  if (res.status === 401) {
    localStorage.removeItem('accessToken')
    localStorage.removeItem('refreshToken')
    localStorage.removeItem('userName')
    sessionStorage.removeItem('userName')
    if (typeof window !== 'undefined') redirectToLogin()
    throw new Error('Oturum süresi doldu. Lütfen tekrar giriş yapın.')
  }
}

function friendlyError(text: string, status: number, fallback: string) {
  const t = String(text ?? '').trim()
  if (!t) return `${fallback} (${status})`
  if (t.startsWith('{') || t.startsWith('[')) {
    try {
      const j = JSON.parse(t)
      const m = j?.message || j?.error || j?.title
      if (typeof m === 'string' && m.trim()) return m.trim()
    } catch {
      return `${fallback} (${status})`
    }
  }
  return t
}

export async function fetchCustomerOffers(opts?: { take?: number; skip?: number; signal?: AbortSignal }): Promise<CustomerOfferListItemDto[]> {
  const take = Math.max(1, Math.min(500, Number(opts?.take ?? 100)))
  const qs = new URLSearchParams({ take: String(take), skip: String(Math.max(0, Math.floor(opts?.skip ?? 0))) }).toString()
  const res = await fetch(`${API_BASE_URL}/api/customer-offers?${qs}`, { headers: buildHeaders(false), signal: opts?.signal })
  await handleUnauthorized(res)

  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'Teklifler alınamadı'))
  }

  const json = await res.json()
  return (json?.data ?? []) as CustomerOfferListItemDto[]
}

export async function fetchBayiCustomerOffers(opts?: { take?: number; signal?: AbortSignal }): Promise<CustomerOfferListItemDto[]> {
  const take = Math.max(1, Math.min(500, Number(opts?.take ?? 100)))
  const qs = new URLSearchParams({ take: String(take) }).toString()
  const res = await fetch(`${API_BASE_URL}/api/customer-offers/bayi-offers?${qs}`, { headers: buildHeaders(false), signal: opts?.signal })
  await handleUnauthorized(res)

  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'Bayi teklifleri alınamadı'))
  }

  const json = await res.json()
  return (json?.data ?? []) as CustomerOfferListItemDto[]
}

export type UpdateProformaHeaderRequest = {
  proformaDocumentNo?: string | null
  customerCode?: string | null
}

export async function updateProformaHeader(id: number, payload: UpdateProformaHeaderRequest): Promise<void> {
  const safeId = Number(id)
  if (!Number.isFinite(safeId) || safeId <= 0) throw new Error('Geçersiz id')

  const res = await fetch(`${API_BASE_URL}/api/customer-offers/${encodeURIComponent(String(safeId))}/proforma-header`, {
    method: 'PUT',
    headers: buildHeaders(true),
    body: JSON.stringify(payload)
  })

  await handleUnauthorized(res)

  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'Proforma üst bilgisi güncellenemedi'))
  }
}

export async function deleteProformaFromOffer(id: number): Promise<void> {
  const safeId = Number(id)
  if (!Number.isFinite(safeId) || safeId <= 0) throw new Error('Geçersiz id')

  const res = await fetch(`${API_BASE_URL}/api/customer-offers/${encodeURIComponent(String(safeId))}/proforma`, {
    method: 'DELETE',
    headers: buildHeaders(false)
  })

  await handleUnauthorized(res)

  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'Proforma silinemedi'))
  }
}

export async function fetchNewCustomerOfferDocumentNo(opts?: { signal?: AbortSignal }): Promise<string> {
  const res = await fetch(`${API_BASE_URL}/api/customer-offers/new-document-no`, { headers: buildHeaders(false), signal: opts?.signal })
  await handleUnauthorized(res)

  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'Belge numarası alınamadı'))
  }

  const json = await res.json()
  return String(json?.data?.documentNo ?? '')
}

export async function fetchNextMuhtelifCustomerCode(opts?: { signal?: AbortSignal }): Promise<string> {
  const res = await fetch(`${API_BASE_URL}/api/customer-offers/muhtelif-next-code`, { headers: buildHeaders(false), signal: opts?.signal })
  await handleUnauthorized(res)

  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'Muhtelif cari kodu alınamadı'))
  }

  const json = await res.json()
  return String(json?.data?.customerCode ?? '')
}

export type CreateOfferCariPayload = {
  name: string
  /** 'FATURA' (fiyat grubu 1) · 'ISTISNA' (4) · 'ASKERIYE' (7). Carinin fatura tipi bundan türer. */
  priceGroupKind: 'FATURA' | 'ISTISNA' | 'ASKERIYE'
  salesmanCode?: string | null
  city?: string | null
  district?: string | null
  address?: string | null
  phone?: string | null
  email?: string | null
  taxOffice?: string | null
  taxNumber?: string | null
}

export type CreatedOfferCari = {
  customerCode: string
  name: string
  salesmanCode: string | null
  priceGroupCode: number
  invoiceType: string
}

/**
 * Teklif penceresindeki "Cari Ekle" formu. Cari kodu GÖNDERİLMEZ — sunucu üretir
 * (bayi öneki `120-01-`, sıradaki boş numara).
 */
export async function createOfferCari(payload: CreateOfferCariPayload): Promise<CreatedOfferCari> {
  const res = await fetch(`${API_BASE_URL}/api/customer-offers/cari`, {
    method: 'POST',
    headers: buildHeaders(true),
    body: JSON.stringify(payload)
  })

  await handleUnauthorized(res)

  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'Cari oluşturulamadı'))
  }

  const json = await res.json()
  const d = json?.data ?? {}
  return {
    customerCode: String(d?.customerCode ?? ''),
    name: String(d?.name ?? ''),
    salesmanCode: d?.salesmanCode ? String(d.salesmanCode) : null,
    priceGroupCode: Number(d?.priceGroupCode ?? 0),
    invoiceType: String(d?.invoiceType ?? '')
  }
}

export async function createCustomerOffer(payload: CreateCustomerOfferRequest): Promise<{ id: number; documentNo: string }> {
  const res = await fetch(`${API_BASE_URL}/api/customer-offers`, {
    method: 'POST',
    headers: buildHeaders(true),
    body: JSON.stringify(payload)
  })

  await handleUnauthorized(res)

  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'Teklif kaydedilemedi'))
  }

  const json = await res.json()
  return { id: Number(json?.id ?? json?.data?.id ?? 0), documentNo: String(json?.documentNo ?? json?.data?.documentNo ?? '') }
}

export async function deleteCustomerOffer(id: number): Promise<void> {
  const safeId = Number(id)
  if (!Number.isFinite(safeId) || safeId <= 0) throw new Error('Geçersiz id')

  const res = await fetch(`${API_BASE_URL}/api/customer-offers/${encodeURIComponent(String(safeId))}`, {
    method: 'DELETE',
    headers: buildHeaders(false)
  })

  await handleUnauthorized(res)

  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'Teklif silinemedi'))
  }
}

export async function getCustomerOffer(id: number, opts?: { signal?: AbortSignal }): Promise<CustomerOfferDetailDto> {
  const safeId = Number(id)
  if (!Number.isFinite(safeId) || safeId <= 0) throw new Error('Geçersiz id')

  const res = await fetch(`${API_BASE_URL}/api/customer-offers/${encodeURIComponent(String(safeId))}`, {
    headers: buildHeaders(false),
    signal: opts?.signal
  })
  await handleUnauthorized(res)

  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'Teklif bulunamadı'))
  }

  const json = await res.json()
  return (json?.data ?? null) as CustomerOfferDetailDto
}

export async function updateCustomerOffer(id: number, payload: CreateCustomerOfferRequest): Promise<void> {
  const safeId = Number(id)
  if (!Number.isFinite(safeId) || safeId <= 0) throw new Error('Geçersiz id')

  const res = await fetch(`${API_BASE_URL}/api/customer-offers/${encodeURIComponent(String(safeId))}`, {
    method: 'PUT',
    headers: buildHeaders(true),
    body: JSON.stringify(payload)
  })

  await handleUnauthorized(res)

  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'Teklif güncellenemedi'))
  }
}

export async function transferCustomerOfferToProforma(id: number): Promise<{ proformaDocumentNo: string }> {
  const safeId = Number(id)
  if (!Number.isFinite(safeId) || safeId <= 0) throw new Error('Geçersiz id')

  const res = await fetch(`${API_BASE_URL}/api/customer-offers/${encodeURIComponent(String(safeId))}/transfer-to-proforma`, {
    method: 'POST',
    headers: buildHeaders(false)
  })

  await handleUnauthorized(res)

  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'Proformaya aktarılamadı'))
  }

  const json = await res.json()
  return { proformaDocumentNo: String(json?.data?.proformaDocumentNo ?? '') }
}

export type TransferOfferLineWarehousePayload = {
  lineId: number
  warehouseCode: number
}

export type TransferProformaToInvoicePayload = {
  invoiceSerie?: string | null
  invoiceNumber?: number | null
  warehouseCode?: number | null
  targetAccountType?: string | null
  targetCustomerCode?: string | null
  lineWarehouses?: TransferOfferLineWarehousePayload[] | null
  // Aktarım penceresindeki kur çubuğundan gelen kurlar (1 birim = ? TL).
  // Gönderilmezse sunucu günün TCMB kurunu kullanır.
  usdRate?: number | null
  eurRate?: number | null
  gbpRate?: number | null
}

export async function transferProformaToInvoice(
  id: number,
  payload: TransferProformaToInvoicePayload
): Promise<{ id: number; invoiceNo: string }> {
  const safeId = Number(id)
  if (!Number.isFinite(safeId) || safeId <= 0) throw new Error('Geçersiz id')

  const res = await fetch(`${API_BASE_URL}/api/customer-offers/${encodeURIComponent(String(safeId))}/transfer-to-invoice`, {
    method: 'POST',
    headers: buildHeaders(true),
    body: JSON.stringify(payload)
  })

  await handleUnauthorized(res)

  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'Satış faturasına aktarılamadı'))
  }

  const json = await res.json()
  return { id: Number(json?.data?.id ?? 0), invoiceNo: String(json?.data?.invoiceNo ?? '') }
}

export async function fetchProformaOffers(opts?: { take?: number; skip?: number; signal?: AbortSignal }): Promise<CustomerOfferListItemDto[]> {
  const take = Math.max(1, Math.min(500, Number(opts?.take ?? 200)))
  const qs = new URLSearchParams({ take: String(take), skip: String(Math.max(0, Math.floor(opts?.skip ?? 0))) }).toString()
  const res = await fetch(`${API_BASE_URL}/api/customer-offers/proformas?${qs}`, { headers: buildHeaders(false), signal: opts?.signal })
  await handleUnauthorized(res)

  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'Proformalar alınamadı'))
  }

  const json = await res.json()
  return (json?.data ?? []) as CustomerOfferListItemDto[]
}
