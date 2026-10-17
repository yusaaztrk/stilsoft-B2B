import { apiFetch, apiJson } from './client'

/**
 * Rapor filtresi. Alan adları backend'deki ReportFilter ile birebir — ikisinin ayrışması,
 * "Girne + son 3 ay"ın iki ekranda farklı sonuç vermesi demek.
 */
export type ReportFilter = {
  from?: string
  to?: string
  preset?: DatePreset
  type?: 'Repair' | 'Installation' | 'Maintenance' | 'Warranty'
  productCategory?: 'Large' | 'Small'
  status?: string
  dealerCode?: string
  technicianId?: string
  regionId?: string
  stockCode?: string
  search?: string
  metric?: DrillMetric
  page?: number
  pageSize?: number
}

export type DatePreset =
  | 'bugun' | 'dun' | 'buHafta' | 'gecenHafta' | 'buAy' | 'gecenAy'
  | 'son3Ay' | 'son6Ay' | 'buYil' | 'gecenYil'

/** Karttaki sayı ile listedeki satır sayısını aynı tutan tanım anahtarı. */
export type DrillMetric = 'completed' | 'cancelled' | 'inProgress' | 'pending' | 'sameDay'

export const DATE_PRESETS: Array<{ id: DatePreset; label: string }> = [
  { id: 'bugun', label: 'Bugün' },
  { id: 'dun', label: 'Dün' },
  { id: 'buHafta', label: 'Bu Hafta' },
  { id: 'gecenHafta', label: 'Geçen Hafta' },
  { id: 'buAy', label: 'Bu Ay' },
  { id: 'gecenAy', label: 'Geçen Ay' },
  { id: 'son3Ay', label: 'Son 3 Ay' },
  { id: 'son6Ay', label: 'Son 6 Ay' },
  { id: 'buYil', label: 'Bu Yıl' },
  { id: 'gecenYil', label: 'Geçen Yıl' }
]

export type KpiValue = { value: number; previous?: number; change?: number }

export type ReportSummary = {
  range: { start: string; end: string }
  kpi: {
    total: KpiValue
    completed: KpiValue
    pending: KpiValue
    inProgress: KpiValue
    cancelled: KpiValue
    successRate: KpiValue
    cancelRate: KpiValue
    avgCompletionHours: KpiValue
    dailyAverage: number
    activeDealers: number
    activeTechnicians: number
  }
  mix: { installations: number; largeRepairs: number; smallRepairs: number; cargo: number }
  statusBreakdown: Array<{ status: string; label: string; count: number }>
}

export type TrendPoint = {
  label: string
  total: number
  completed: number
  cancelled: number
  installations: number
}

function toQuery(filter: ReportFilter, extra?: Record<string, string | number | undefined>) {
  const params = new URLSearchParams()

  const merged: Record<string, unknown> = { ...filter, ...(extra ?? {}) }
  for (const [key, value] of Object.entries(merged)) {
    if (value === undefined || value === null || value === '') continue
    params.set(key, String(value))
  }

  const qs = params.toString()
  return qs ? `?${qs}` : ''
}

async function get<T>(path: string, filter: ReportFilter, extra?: Record<string, string | number | undefined>): Promise<T> {
  const res = await apiJson<{ success: boolean; data: T }>(`/api/reports/${path}${toQuery(filter, extra)}`)
  return res.data
}

export const fetchSummary = (f: ReportFilter) => get<ReportSummary>('summary', f)

export const fetchTrend = (f: ReportFilter, granularity: 'day' | 'week' | 'month' = 'month') =>
  get<{ granularity: string; points: TrendPoint[] }>('trend', f, { granularity })

export const fetchInstallations = (f: ReportFilter) => get<any>('installations', f)
export const fetchRepairs = (f: ReportFilter) => get<ReportSummary>('repairs', f)
export const fetchCargo = (f: ReportFilter) => get<any>('cargo', f)
export const fetchDealers = (f: ReportFilter, take = 20) => get<any[]>('dealers', f, { take })
export const fetchDealerDetail = (dealerCode: string, f: ReportFilter) =>
  get<any>(`dealers/${encodeURIComponent(dealerCode)}`, f)
export const fetchTechnicians = (f: ReportFilter, take = 20) => get<any[]>('technicians', f, { take })
export const fetchProducts = (f: ReportFilter, take = 20) => get<any[]>('products', f, { take })
export const fetchProductDetail = (stockCode: string, f: ReportFilter) =>
  get<any>(`products/${encodeURIComponent(stockCode)}`, f)
export const fetchDurations = (f: ReportFilter) => get<any>('durations', f)
export const fetchCancellations = (f: ReportFilter) => get<any>('cancellations', f)
export const fetchSparePartRequests = (f: ReportFilter, take = 20) =>
  get<any>('spare-part-requests', f, { take })

export type ReportRecord = {
  id: string
  serviceNumber: string
  status: string
  statusLabel: string
  type: string
  productCategory: string
  productName: string
  productStockCode?: string | null
  serialNumber?: string | null
  customerName?: string | null
  dealerCode?: string | null
  dealerName?: string | null
  technicianName?: string | null
  createdAt: string
  plannedAt?: string | null
  completedAt?: string | null
  isUnderWarranty: boolean
}

export const fetchRecords = (f: ReportFilter) =>
  get<{ total: number; page: number; pageSize: number; items: ReportRecord[] }>('records', f)

/**
 * Filtrelenmiş sonucun TAMAMINI indirir — ekrandaki sayfayı değil.
 *
 * Dosya sunucuda üretiliyor; veri hiç tarayıcıya gelmiyor. Sayfalama alanları bilerek
 * dışarıda bırakıldı: kullanıcı "tümünü aktar" derken 50 satır beklemiyor.
 */
export async function downloadRecordsExcel(filter: ReportFilter): Promise<void> {
  const { page: _p, pageSize: _ps, ...rest } = filter
  const res = await apiFetch(`/api/reports/export/records${toQuery(rest)}`)

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(text || `Dışa aktarma başarısız (${res.status})`)
  }

  const blob = await res.blob()
  const url = URL.createObjectURL(blob)

  const name = res.headers.get('content-disposition')?.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i)?.[1]

  const link = document.createElement('a')
  link.href = url
  link.download = decodeURIComponent(name ?? 'servis-raporu.xlsx')
  document.body.appendChild(link)
  link.click()
  link.remove()

  URL.revokeObjectURL(url)
}
