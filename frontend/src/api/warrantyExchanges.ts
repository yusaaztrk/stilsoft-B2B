import { API_BASE_URL } from '../config/api'

/**
 * GARANTİ DEĞİŞİM (kullanıcı kuralı, 2026-08-14).
 *
 * Arızalı ürün garanti deposuna girer, yerine verilen ürün seçilen depodan çıkar. Fatura
 * kesilmez; aradaki fark İSTEĞE BAĞLI olarak cari ekstreye tek satır düşer.
 */

export type WarrantyExchangeSettings = {
  warehouseCode: number
  warehouseName?: string | null
}

export type WarrantyExchangeRow = {
  id: number
  exchangeNo: string
  date: string
  customerCode: string
  customerName?: string | null
  invoiceNo?: string | null

  warrantyWarehouseCode: number
  warrantyWarehouseName?: string | null
  outWarehouseCode: number
  outWarehouseName?: string | null

  returnedStockCode: string
  returnedProductName?: string | null
  returnedQuantity: number
  returnedUnitPrice: number
  returnedSerialNo?: string | null

  givenStockCode: string
  givenProductName?: string | null
  givenQuantity: number
  givenUnitPrice: number
  givenSerialNo?: string | null

  discountAmount: number
  differenceAmount: number
  postedToLedger: boolean

  /** Tutarların para birimi — 1=TRY 2=EUR 3=USD 4=GBP. Eski kayıtlarda 1. */
  currencyTypeId: number
  currencyCode: string
  currencyRate: number
  /** Farkın TL karşılığı; karışık dövizli listede toplam almak için. */
  tryDifferenceAmount: number

  description?: string | null
  createUser?: string | null
  createTime: string
  editUser?: string | null
  editTime?: string | null

  /**
   * Bu satırı düzenleme/silme hakkı var mı — SUNUCU söyler.
   *
   * Kural "kendi kaydı + bugün". İstemcide hesaplamak iki kopya üretirdi: kullanıcı adını
   * burada karşılaştırmak (büyük/küçük harf, oturum adının farklı gelmesi) ve "bugün"ü
   * tarayıcı saatiyle ölçmek — ikisi de sunucununkinden ayrışabilir.
   */
  canModify?: boolean
}

/** Garanti değişim ekranında seçilebilen para birimleri. */
export const WARRANTY_EXCHANGE_CURRENCIES = [
  { value: 1, code: 'TRY', label: 'TL', symbol: '₺' },
  { value: 3, code: 'USD', label: 'USD', symbol: '$' },
  { value: 2, code: 'EUR', label: 'EUR', symbol: '€' },
  { value: 4, code: 'GBP', label: 'GBP', symbol: '£' }
] as const

export function warrantyExchangeCurrencySymbol(currencyTypeId: number | null | undefined): string {
  const found = WARRANTY_EXCHANGE_CURRENCIES.find((c) => c.value === Number(currencyTypeId ?? 1))
  return found?.symbol ?? '₺'
}

export type CreateWarrantyExchangePayload = {
  date?: string
  customerCode: string
  invoiceNo?: string | null
  outWarehouseCode: number

  returnedStockCode: string
  returnedQuantity: number
  returnedUnitPrice: number
  returnedSerialNo?: string | null

  givenStockCode: string
  givenQuantity: number
  givenUnitPrice: number
  givenSerialNo?: string | null

  discountAmount: number
  /**
   * Girilen fiyatların para birimi. Gönderilmezse backend TL kabul eder — carinin
   * dövizinden TÜRETİLMEZ, fiyatları kullanıcı elle giriyor.
   */
  currencyTypeId?: number
  /** TL kuru; 0/boş gönderilirse backend günün kurunu çeker. */
  currencyRate?: number
  /** Fark cari ekstreye yansıtılsın mı — kullanıcının açık kararı, varsayılan kapalı. */
  postToLedger: boolean
  description?: string | null
}

function buildHeaders(includeJson: boolean) {
  const headers: Record<string, string> = {}
  if (includeJson) headers['Content-Type'] = 'application/json'
  const token = localStorage.getItem('accessToken')
  if (token) headers.Authorization = `Bearer ${token}`
  const tenantCode = String(localStorage.getItem('tenantCode') ?? '').trim()
  if (tenantCode) headers['X-Tenant-Code'] = tenantCode
  return headers
}

async function readError(res: Response, fallback: string) {
  const text = await res.text().catch(() => '')
  const t = String(text ?? '').trim()
  if (!t) return `${fallback} (${res.status})`
  if (t.startsWith('{') || t.startsWith('[')) {
    try {
      const j = JSON.parse(t)
      const m = j?.message || j?.error || j?.title
      if (typeof m === 'string' && m.trim()) return m.trim()
    } catch {
      return `${fallback} (${res.status})`
    }
  }
  return t
}

export async function fetchWarrantyExchangeSettings(opts?: { signal?: AbortSignal }): Promise<WarrantyExchangeSettings> {
  const res = await fetch(`${API_BASE_URL}/api/warranty-exchanges/settings`, {
    headers: buildHeaders(false),
    signal: opts?.signal
  })
  if (!res.ok) throw new Error(await readError(res, 'Garanti deposu ayarı alınamadı'))
  const json = await res.json()
  return (json?.data ?? { warehouseCode: 0 }) as WarrantyExchangeSettings
}

export async function updateWarrantyExchangeSettings(warehouseCode: number): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/api/warranty-exchanges/settings`, {
    method: 'PUT',
    headers: buildHeaders(true),
    body: JSON.stringify({ warehouseCode })
  })
  if (!res.ok) throw new Error(await readError(res, 'Garanti deposu kaydedilemedi'))
}

export async function fetchWarrantyExchanges(
  params?: { search?: string; customerCode?: string; startDate?: string; endDate?: string },
  opts?: { signal?: AbortSignal }
): Promise<WarrantyExchangeRow[]> {
  const sp = new URLSearchParams()
  if (params?.search) sp.set('search', params.search)
  if (params?.customerCode) sp.set('customerCode', params.customerCode)
  if (params?.startDate) sp.set('startDate', params.startDate)
  if (params?.endDate) sp.set('endDate', params.endDate)

  const res = await fetch(`${API_BASE_URL}/api/warranty-exchanges?${sp.toString()}`, {
    headers: buildHeaders(false),
    signal: opts?.signal
  })
  if (!res.ok) throw new Error(await readError(res, 'Garanti değişim kayıtları alınamadı'))
  const json = await res.json()
  return (json?.data ?? []) as WarrantyExchangeRow[]
}

export async function createWarrantyExchange(
  payload: CreateWarrantyExchangePayload
): Promise<{ id: number; exchangeNo: string; difference: number; postedToLedger: boolean }> {
  const res = await fetch(`${API_BASE_URL}/api/warranty-exchanges`, {
    method: 'POST',
    headers: buildHeaders(true),
    body: JSON.stringify(payload)
  })
  if (!res.ok) throw new Error(await readError(res, 'Garanti değişim kaydedilemedi'))
  const json = await res.json()
  return json?.data
}

export async function updateWarrantyExchange(
  id: number,
  payload: CreateWarrantyExchangePayload
): Promise<{ id: number; exchangeNo: string; difference: number; postedToLedger: boolean }> {
  const res = await fetch(`${API_BASE_URL}/api/warranty-exchanges/${id}`, {
    method: 'PUT',
    headers: buildHeaders(true),
    body: JSON.stringify(payload)
  })
  if (!res.ok) throw new Error(await readError(res, 'Garanti değişim güncellenemedi'))
  const json = await res.json()
  return json?.data
}

export async function deleteWarrantyExchange(id: number): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/api/warranty-exchanges/${id}`, {
    method: 'DELETE',
    headers: buildHeaders(false)
  })
  if (!res.ok) throw new Error(await readError(res, 'Garanti değişim silinemedi'))
}
