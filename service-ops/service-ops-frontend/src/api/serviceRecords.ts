import { apiJson } from './client'
import { API_BASE_URL } from '../config'
import { getAccessToken } from '../auth/storage'

export type ServiceType = 'Repair' | 'Installation' | 'Maintenance' | 'Warranty'

export type ServiceAnalyticsDto = {
  totals: {
    total: number
    active: number
    done: number
    ready: number
    cancelled: number
    postponed: number
    workshop: number
    waitingForParts: number
    montaj: number
    ariza: number
    today: number
    thisMonth: number
    avgPlanLeadDays: number
    completionRate: number
  }
  byStatus: Array<{ status: string; count: number }>
  byRegion: Array<{ region: string; count: number }>
  byTechnician: Array<{ technician: string; total: number; done: number; active: number }>
  byProduct: Array<{ product: string; count: number }>
  monthlyTrend: Array<{ month: string; total: number; done: number }>
}

export type ServiceExportRow = {
  id: string
  serviceNumber: string
  type: string
  status: string
  createdAt: string
  plannedDate?: string | null
  customerName?: string | null
  customerPhone?: string | null
  customerAddress?: string | null
  productName: string
  serialNumber?: string | null
  isUnderWarranty: boolean
  /** Teslim alma kaynağı; 1 = Mağazadan. Bkz. utils/customerType.ts */
  pickupSourceId?: number | null
  /** Garanti başlangıç tarihi (ISO). Garanti yoksa boştur — bkz. utils/garanti.ts */
  warrantyStartDate?: string | null
  dealerName?: string | null
  regionName?: string | null
  technicianName?: string | null
  priority: string
  problemDescription?: string | null
}

const EMPTY_ANALYTICS: ServiceAnalyticsDto = {
  totals: {
    total: 0, active: 0, done: 0, ready: 0, cancelled: 0, postponed: 0,
    workshop: 0, waitingForParts: 0, montaj: 0, ariza: 0, today: 0, thisMonth: 0,
    avgPlanLeadDays: 0, completionRate: 0
  },
  byStatus: [],
  byRegion: [],
  byTechnician: [],
  byProduct: [],
  monthlyTrend: []
}

export async function fetchServiceAnalytics(
  opts?: { type?: ServiceType; signal?: AbortSignal }
): Promise<ServiceAnalyticsDto> {
  const qs = opts?.type ? `?type=${encodeURIComponent(opts.type)}` : ''
  const json = await apiJson<{ success?: boolean; data?: ServiceAnalyticsDto }>(
    `/api/servicerecords/analytics${qs}`,
    { signal: opts?.signal }
  )
  return (json?.data as ServiceAnalyticsDto | undefined) ?? EMPTY_ANALYTICS
}

export type ServiceExportFilter = {
  q?: string
  status?: string
  type?: ServiceType
  dateFrom?: string
  dateTo?: string
  technicianId?: string
}

export async function fetchServiceExport(
  filter: ServiceExportFilter = {},
  opts?: { signal?: AbortSignal }
): Promise<ServiceExportRow[]> {
  const params = new URLSearchParams()
  if (filter.q) params.set('q', filter.q)
  if (filter.status) params.set('status', filter.status)
  if (filter.type) params.set('type', filter.type)
  if (filter.dateFrom) params.set('dateFrom', filter.dateFrom)
  if (filter.dateTo) params.set('dateTo', filter.dateTo)
  if (filter.technicianId) params.set('technicianId', filter.technicianId)
  const qs = params.toString() ? `?${params.toString()}` : ''
  const json = await apiJson<{ success?: boolean; data?: ServiceExportRow[] }>(
    `/api/servicerecords/export${qs}`,
    { signal: opts?.signal }
  )
  return (json?.data as ServiceExportRow[] | undefined) ?? []
}

export async function bulkPlan(
  serviceIds: string[],
  plannedDateUtc: string
): Promise<{ updated: number }> {
  const json = await apiJson<{ success?: boolean; updated?: number }>(
    `/api/planning/bulk-plan`,
    {
      method: 'POST',
      body: JSON.stringify({ serviceIds, plannedDateUtc })
    }
  )
  return { updated: Number(json?.updated ?? 0) }
}

export async function bulkAssign(
  serviceIds: string[],
  technicianId: string
): Promise<{ updated: number }> {
  const json = await apiJson<{ success?: boolean; updated?: number }>(
    `/api/planning/bulk-assign`,
    {
      method: 'POST',
      body: JSON.stringify({ serviceIds, technicianId })
    }
  )
  return { updated: Number(json?.updated ?? 0) }
}

export type SmartAssignAssignment = {
  serviceId: string
  serviceNumber: string
  customerName?: string | null
  productName: string
  technicianId: string
  technicianName: string
  plannedDate?: string | null
}

export type SmartAssignResponse = {
  success: boolean
  updated: number
  message?: string
  previewOnly?: boolean
  assignments?: SmartAssignAssignment[]
  summary?: {
    assignedCount: number
    unassignedCount: number
    technicianLoads: Array<{ technicianId: string; count: number }>
    averageDistance?: number | null
    fallbackAssignments: number
  }
}

export async function smartAssign(opts?: {
  plannedDateUtc?: string
  regionId?: string
  type?: ServiceType
  status?: string
  maxToAssign?: number
  previewOnly?: boolean
}): Promise<SmartAssignResponse> {
  const json = await apiJson<SmartAssignResponse & { success?: boolean; updated?: number }>(
    `/api/planning/smart-assign`,
    {
      method: 'POST',
      body: JSON.stringify({
        plannedDateUtc: opts?.plannedDateUtc ?? null,
        regionId: opts?.regionId ?? null,
        type: opts?.type ?? null,
        status: opts?.status ?? null,
        maxToAssign: opts?.maxToAssign ?? 50,
        previewOnly: opts?.previewOnly ?? false
      })
    }
  )
  return {
    success: !!(json?.success),
    updated: Number(json?.updated ?? 0),
    message: json?.message,
    previewOnly: json?.previewOnly,
    assignments: json?.assignments,
    summary: json?.summary
  }
}

export async function uploadServiceRecordPhoto(serviceId: string, file: File): Promise<{ url?: string }> {
  const form = new FormData()
  form.append('file', file)
  const token = getAccessToken()
  const res = await fetch(`${API_BASE_URL}/api/servicerecords/${encodeURIComponent(serviceId)}/photo`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: form,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(text || `Fotoğraf yüklenemedi (${res.status})`)
  }
  return await res.json().catch(() => ({}))
}

export async function uploadInstallationTaskPhoto(taskId: string, file: File): Promise<{ url?: string }> {
  const form = new FormData()
  form.append('file', file)
  const token = getAccessToken()
  const res = await fetch(`${API_BASE_URL}/api/installations/tasks/${encodeURIComponent(taskId)}/photo`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: form,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(text || `Fotoğraf yüklenemedi (${res.status})`)
  }
  return await res.json().catch(() => ({}))
}

/**
 * Montaj kalemine yüklenmiş TEK bir fotoğrafı siler.
 *
 * Dönen `remaining`, kalemin güncel görsel listesidir — ekran kendi listesini yeniden
 * kurmak yerine sunucunun döndüğünü kullanır ki iki taraf ayrışmasın.
 */
export async function deleteInstallationTaskPhoto(taskId: string, url: string): Promise<{ remaining: string[] }> {
  const token = getAccessToken()
  const res = await fetch(
    `${API_BASE_URL}/api/installations/tasks/${encodeURIComponent(taskId)}/photo?url=${encodeURIComponent(url)}`,
    {
      method: 'DELETE',
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    }
  )
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(text || `Fotoğraf silinemedi (${res.status})`)
  }
  const json = await res.json().catch(() => ({}))
  return { remaining: Array.isArray(json?.remaining) ? json.remaining : [] }
}

