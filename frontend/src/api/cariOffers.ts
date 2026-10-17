import { API_BASE_URL } from '../config/api'
import { redirectToLogin } from '../auth/redirectToLogin'

export type CariOfferLineDto = {
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
}

export type CariOfferListItemDto = {
  id: number
  date: string
  documentNo: string
  customerCode?: string | null
  customerName?: string | null
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
  lines: CariOfferLineDto[]
}

export type CariOfferDetailDto = CariOfferListItemDto & {
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

export type CreateCariOfferRequest = {
  date?: string | null
  vatExempt: boolean
  customerCode?: string | null
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
  lines: Array<{
    productId: string
    quantity: number
    discountType: number
    discountValue: number
  }>
}

export type CustomerDropdownItemDto = {
  customerCode: string
  name: string
  address?: string | null
  city?: string | null
  district?: string | null
  phone?: string | null
  fax?: string | null
  email?: string | null
  taxOffice?: string | null
  taxNumber?: string | null
  identityNumber?: string | null
  customerType?: string | null
  invoiceType?: string | null
  productCategory?: string | null
  productCategoryIds?: string[]
  isActive?: boolean
  priceGroupId?: string | null
  discountRate?: number
  salesmanCode?: string | null
  creditLimit?: number
  parentCustomerCode?: string | null
  currencyTypeId?: number
  isMuhtelif?: boolean
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

export async function fetchCariOffers(opts?: { take?: number; skip?: number; signal?: AbortSignal }): Promise<CariOfferListItemDto[]> {
  const take = Math.max(1, Math.min(500, Number(opts?.take ?? 100)))
  const qs = new URLSearchParams({ take: String(take), skip: String(Math.max(0, Math.floor(opts?.skip ?? 0))) }).toString()
  const res = await fetch(`${API_BASE_URL}/api/cari-offers?${qs}`, { headers: buildHeaders(false), signal: opts?.signal })
  await handleUnauthorized(res)
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'Teklifler alınamadı'))
  }
  const json = await res.json()
  return (json?.data ?? []) as CariOfferListItemDto[]
}

export async function fetchNewCariOfferDocumentNo(opts?: { signal?: AbortSignal }): Promise<string> {
  const res = await fetch(`${API_BASE_URL}/api/cari-offers/new-document-no`, { headers: buildHeaders(false), signal: opts?.signal })
  await handleUnauthorized(res)
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'Belge numarası alınamadı'))
  }
  const json = await res.json()
  return String(json?.data?.documentNo ?? '')
}

export async function fetchNextBayiMuhtelifCustomerCode(opts?: { signal?: AbortSignal }): Promise<string> {
  const res = await fetch(`${API_BASE_URL}/api/cari-offers/muhtelif-next-code`, { headers: buildHeaders(false), signal: opts?.signal })
  await handleUnauthorized(res)
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'Muhtelif cari kodu alınamadı'))
  }
  const json = await res.json()
  return String(json?.data?.customerCode ?? '')
}

export async function fetchCariOfferCustomersDropdown(opts?: { includeInactive?: boolean; includeMuhtelif?: boolean; signal?: AbortSignal }): Promise<CustomerDropdownItemDto[]> {
  const includeInactive = Boolean(opts?.includeInactive)
  const includeMuhtelif = Boolean(opts?.includeMuhtelif)
  const qs = new URLSearchParams({ includeInactive: String(includeInactive), includeMuhtelif: String(includeMuhtelif) }).toString()
  const res = await fetch(`${API_BASE_URL}/api/cari-offers/customers-dropdown?${qs}`, { headers: buildHeaders(false), signal: opts?.signal })
  await handleUnauthorized(res)
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'Cari listesi alınamadı'))
  }
  const json = await res.json()
  return (json?.data ?? []) as CustomerDropdownItemDto[]
}

export async function fetchBayiCariOffers(opts?: { take?: number; signal?: AbortSignal }): Promise<CariOfferListItemDto[]> {
  const take = Math.max(1, Math.min(500, Number(opts?.take ?? 100)))
  const qs = new URLSearchParams({ take: String(take) }).toString()
  const res = await fetch(`${API_BASE_URL}/api/cari-offers/bayi-offers?${qs}`, { headers: buildHeaders(false), signal: opts?.signal })
  await handleUnauthorized(res)
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'Bayi teklifleri alınamadı'))
  }
  const json = await res.json()
  return (json?.data ?? []) as CariOfferListItemDto[]
}

export async function createCariOffer(payload: CreateCariOfferRequest): Promise<{ id: number; documentNo: string }> {
  const res = await fetch(`${API_BASE_URL}/api/cari-offers`, { method: 'POST', headers: buildHeaders(true), body: JSON.stringify(payload) })
  await handleUnauthorized(res)
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'Teklif kaydedilemedi'))
  }
  const json = await res.json()
  return { id: Number(json?.id ?? json?.data?.id ?? 0), documentNo: String(json?.documentNo ?? json?.data?.documentNo ?? '') }
}

export async function deleteCariOffer(id: number): Promise<void> {
  const safeId = Number(id)
  if (!Number.isFinite(safeId) || safeId <= 0) throw new Error('Geçersiz id')
  const res = await fetch(`${API_BASE_URL}/api/cari-offers/${encodeURIComponent(String(safeId))}`, { method: 'DELETE', headers: buildHeaders(false) })
  await handleUnauthorized(res)
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'Teklif silinemedi'))
  }
}

export async function getCariOffer(id: number, opts?: { signal?: AbortSignal }): Promise<CariOfferDetailDto> {
  const safeId = Number(id)
  if (!Number.isFinite(safeId) || safeId <= 0) throw new Error('Geçersiz id')
  const res = await fetch(`${API_BASE_URL}/api/cari-offers/${encodeURIComponent(String(safeId))}`, { headers: buildHeaders(false), signal: opts?.signal })
  await handleUnauthorized(res)
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'Teklif bulunamadı'))
  }
  const json = await res.json()
  return (json?.data ?? null) as CariOfferDetailDto
}

export async function updateCariOffer(id: number, payload: CreateCariOfferRequest): Promise<void> {
  const safeId = Number(id)
  if (!Number.isFinite(safeId) || safeId <= 0) throw new Error('Geçersiz id')
  const res = await fetch(`${API_BASE_URL}/api/cari-offers/${encodeURIComponent(String(safeId))}`, { method: 'PUT', headers: buildHeaders(true), body: JSON.stringify(payload) })
  await handleUnauthorized(res)
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'Teklif güncellenemedi'))
  }
}

export async function transferCariOfferToProforma(id: number): Promise<{ proformaDocumentNo: string }> {
  const safeId = Number(id)
  if (!Number.isFinite(safeId) || safeId <= 0) throw new Error('Geçersiz id')
  const res = await fetch(`${API_BASE_URL}/api/cari-offers/${encodeURIComponent(String(safeId))}/transfer-to-proforma`, { method: 'POST', headers: buildHeaders(false) })
  await handleUnauthorized(res)
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'Proformaya aktarılamadı'))
  }
  const json = await res.json()
  return { proformaDocumentNo: String(json?.data?.proformaDocumentNo ?? '') }
}

export async function transferCariProformaToInvoice(
  id: number,
  payload: { invoiceSerie: string; invoiceNumber: number; warehouseCode?: number | null }
): Promise<{ id: number; invoiceNo: string }> {
  const safeId = Number(id)
  if (!Number.isFinite(safeId) || safeId <= 0) throw new Error('Geçersiz id')

  const serie = String(payload?.invoiceSerie ?? '').trim().toUpperCase()
  const invoiceNumber = Number(payload?.invoiceNumber)
  const warehouseCodeRaw = payload?.warehouseCode
  const warehouseCode = warehouseCodeRaw != null ? Number(warehouseCodeRaw) : null

  if (serie.length !== 1) throw new Error('Seri No 1 karakter olmalıdır')
  if (!Number.isFinite(invoiceNumber) || invoiceNumber < 0) throw new Error('Fatura No geçersiz')
  if (warehouseCode != null && (!Number.isFinite(warehouseCode) || warehouseCode <= 0)) throw new Error('Depo seçimi geçersiz')

  const res = await fetch(`${API_BASE_URL}/api/cari-offers/${encodeURIComponent(String(safeId))}/transfer-to-invoice`, {
    method: 'POST',
    headers: buildHeaders(true),
    body: JSON.stringify({ invoiceSerie: serie, invoiceNumber, warehouseCode: warehouseCode ?? undefined })
  })
  await handleUnauthorized(res)
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'Satış faturasına aktarılamadı'))
  }
  const json = await res.json()
  return { id: Number(json?.data?.id ?? 0), invoiceNo: String(json?.data?.invoiceNo ?? '') }
}

export async function fetchCariProformaOffers(opts?: { take?: number; skip?: number; signal?: AbortSignal }): Promise<CariOfferListItemDto[]> {
  const take = Math.max(1, Math.min(500, Number(opts?.take ?? 200)))
  const qs = new URLSearchParams({ take: String(take), skip: String(Math.max(0, Math.floor(opts?.skip ?? 0))) }).toString()
  const res = await fetch(`${API_BASE_URL}/api/cari-offers/proformas?${qs}`, { headers: buildHeaders(false), signal: opts?.signal })
  await handleUnauthorized(res)
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'Proformalar alınamadı'))
  }
  const json = await res.json()
  return (json?.data ?? []) as CariOfferListItemDto[]
}

export type BayiMuhtelifCustomerDto = {
  customerCode: string
  name: string
  city?: string | null
  district?: string | null
  address?: string | null
  phone?: string | null
  email?: string | null
  taxOffice?: string | null
  taxNumber?: string | null
}

export async function fetchBayiMuhtelifCustomersForCariOffers(opts?: { take?: number; signal?: AbortSignal }): Promise<BayiMuhtelifCustomerDto[]> {
  const take = Math.max(1, Math.min(500, Number(opts?.take ?? 200)))
  const qs = new URLSearchParams({ take: String(take) }).toString()
  const res = await fetch(`${API_BASE_URL}/api/cari-offers/bayi-muhtelif-customers?${qs}`, { headers: buildHeaders(false), signal: opts?.signal })
  await handleUnauthorized(res)
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'Bayi muhtelifleri alınamadı'))
  }
  const json = await res.json()
  return (json?.data ?? []) as BayiMuhtelifCustomerDto[]
}

export type UpdateProformaHeaderRequest = {
  proformaDocumentNo?: string | null
  customerCode?: string | null
}

export async function updateCariProformaHeader(id: number, payload: UpdateProformaHeaderRequest): Promise<void> {
  const safeId = Number(id)
  if (!Number.isFinite(safeId) || safeId <= 0) throw new Error('Geçersiz id')

  const res = await fetch(`${API_BASE_URL}/api/cari-offers/${encodeURIComponent(String(safeId))}/proforma-header`, {
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

export async function deleteCariProformaFromOffer(id: number): Promise<void> {
  const safeId = Number(id)
  if (!Number.isFinite(safeId) || safeId <= 0) throw new Error('Geçersiz id')

  const res = await fetch(`${API_BASE_URL}/api/cari-offers/${encodeURIComponent(String(safeId))}/proforma`, {
    method: 'DELETE',
    headers: buildHeaders(false)
  })

  await handleUnauthorized(res)

  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'Proforma silinemedi'))
  }
}
