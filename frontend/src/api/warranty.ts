import { API_BASE_URL } from '../config/api'

export type WarrantyHistory = {
  id: number
  warrantyRecordId: number
  status: string
  description: string
  createdTime: string
  createdByUser: string
}

export type WarrantyRecord = {
  id: number
  transactionType: string
  recordDate: string
  warrantyNo: string
  customerCode: string
  customerName: string
  status: string
  grossAmount: number
  discountAmount: number
  netAmount: number
  vatAmount: number
  totalAmount: number
  /** Tutarların para birimi — 1=TRY 2=EUR 3=USD 4=GBP. Eski kayıtlarda 1. */
  currencyTypeId: number
  /** Kayıt anındaki TL kuru; TL kayıtta 1. */
  currencyRate: number
  salesmanCode: string | null
  createdByUserName: string
  serialNo: string | null
  productCode: string
  productName: string
  brandModel: string | null
  warrantyStatus: string | null
  lastStatusDate: string
  faultDescription: string | null
  warrantyPeriodMonths: number
  completedDate: string | null
  histories?: WarrantyHistory[]
}

export type WarrantyKpis = {
  totalCount: number
  openCount: number
  inServiceCount: number
  completedCount: number
  changedProductCount: number
  averageResolutionDays: number
}

function buildHeaders(includeJson: boolean) {
  const headers: Record<string, string> = {}
  if (includeJson) headers['Content-Type'] = 'application/json'
  const token = localStorage.getItem('accessToken')
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
}

export async function fetchWarranties(params?: {
  search?: string
  status?: string
  startDate?: string
  endDate?: string
}): Promise<WarrantyRecord[]> {
  const qObj: Record<string, string> = {}
  if (params?.search) qObj.search = params.search
  if (params?.status) qObj.status = params.status
  if (params?.startDate) qObj.startDate = params.startDate
  if (params?.endDate) qObj.endDate = params.endDate

  const qs = new URLSearchParams(qObj).toString()
  const res = await fetch(`${API_BASE_URL}/api/warranty?${qs}`, {
    headers: { ...buildHeaders(false) }
  })
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(t || `Garanti kayıtları alınamadı (${res.status})`)
  }
  const json = await res.json()
  return json.data as WarrantyRecord[]
}

export async function fetchWarrantyById(id: number): Promise<{ data: WarrantyRecord; histories: WarrantyHistory[] }> {
  const res = await fetch(`${API_BASE_URL}/api/warranty/${id}`, {
    headers: { ...buildHeaders(false) }
  })
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(t || `Garanti kaydı alınamadı (${res.status})`)
  }
  return await res.json() as { data: WarrantyRecord; histories: WarrantyHistory[] }
}

export async function createWarranty(payload: {
  transactionType?: string
  customerCode: string
  productCode: string
  serialNo?: string
  brandModel?: string
  faultDescription?: string
  warrantyPeriodMonths?: number
  grossAmount: number
  discountAmount: number
  netAmount: number
  vatAmount: number
  totalAmount: number
  /** Tutarların para birimi; gönderilmezse backend TL kabul eder. */
  currencyTypeId?: number
  /** TL kuru; 0/boş gönderilirse backend günün kurunu çeker. */
  currencyRate?: number
  salesmanCode?: string
}): Promise<WarrantyRecord> {
  const res = await fetch(`${API_BASE_URL}/api/warranty`, {
    method: 'POST',
    headers: { ...buildHeaders(true) },
    body: JSON.stringify(payload)
  })
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(t || `Garanti kaydı oluşturulamadı (${res.status})`)
  }
  const json = await res.json()
  return json.data as WarrantyRecord
}

export async function updateWarrantyStatus(
  id: number,
  payload: { status: string; description?: string }
): Promise<WarrantyRecord> {
  const res = await fetch(`${API_BASE_URL}/api/warranty/${id}/status`, {
    method: 'POST',
    headers: { ...buildHeaders(true) },
    body: JSON.stringify(payload)
  })
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(t || `Durum güncellenemedi (${res.status})`)
  }
  const json = await res.json()
  return json.data as WarrantyRecord
}

export async function fetchWarrantyKpis(): Promise<WarrantyKpis> {
  const res = await fetch(`${API_BASE_URL}/api/warranty/kpi`, {
    headers: { ...buildHeaders(false) }
  })
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(t || `KPI verileri alınamadı (${res.status})`)
  }
  const json = await res.json()
  return json.data as WarrantyKpis
}

/**
 * Ürünün cariye göre satış fiyatı VE O FİYATIN PARA BİRİMİ.
 *
 * Eskiden yalnızca sayı dönüyordu; ekran onu ₺ sayıyor ve dolar fiyatlı bir ürünün
 * garanti kaydı 500 $ yerine 500 ₺ olarak yazılıyordu.
 */
export async function fetchWarrantyProductPrice(
  customerCode: string,
  productCode: string
): Promise<{ price: number; currencyTypeId: number; currencyCode: string }> {
  const qs = new URLSearchParams({ customerCode, productCode }).toString()
  const res = await fetch(`${API_BASE_URL}/api/warranty/product-price?${qs}`, {
    headers: { ...buildHeaders(false) }
  })
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(t || `Ürün fiyatı alınamadı (${res.status})`)
  }
  const json = await res.json()
  return {
    price: Number(json.price ?? 0),
    currencyTypeId: Number(json.currencyTypeId ?? 1),
    currencyCode: String(json.currencyCode ?? 'TRY')
  }
}

/** Garanti tutarlarının simgesi — 1=TRY 2=EUR 3=USD 4=GBP. */
export function warrantyCurrencySymbol(currencyTypeId: number | null | undefined): string {
  switch (Number(currencyTypeId ?? 1)) {
    case 2:
      return '€'
    case 3:
      return '$'
    case 4:
      return '£'
    default:
      return '₺'
  }
}

export async function fetchNextSerialNoPreview(): Promise<string> {
  const res = await fetch(`${API_BASE_URL}/api/warranty/next-serial-no`, {
    headers: { ...buildHeaders(false) }
  })
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(t || `Sıradaki seri no alınamadı (${res.status})`)
  }
  const json = await res.json()
  return (json.serialNo || json.SerialNo || '') as string
}
