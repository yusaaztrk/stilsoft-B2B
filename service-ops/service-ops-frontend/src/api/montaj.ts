import { API_BASE_URL } from '../config'
import { clearSession, getAccessToken } from '../auth/storage'

export type MontajListItemDto = {
  id: number
  dealerCode?: string | null
  type: string
  status: string
  dealerName: string
  productName: string
  quantity: number
  customerName?: string | null
  customerPhone?: string | null
  address: string
  region: string
  plannedDateUtc?: string | null
  technician?: string | null
  dealerDescription?: string | null
  createUser: string
  createTime: string
}

export type InstallationDocumentDto = {
  id: number
  installationId: number
  documentUrl: string
  uploadedDateUtc: string
}

export type CreateMontajPayload = {
  dealerCode?: string | null
  dealerName?: string | null
  productName: string
  quantity: number
  customerName: string
  phone: string
  address: string
  region: string
  note?: string | null
  type?: string | null
}

export type PlanMontajPayload = {
  plannedDateUtc: string
  technician: string
}

function getFriendlyError(text: string, status: number) {
  const t = String(text ?? '').trim()
  if (!t) return `İşlem başarısız (${status})`

  if (t.startsWith('{') || t.startsWith('[')) {
    try {
      const j = JSON.parse(t)
      const m = j?.message || j?.error || j?.title
      if (typeof m === 'string' && m.trim()) return m.trim()
    } catch {
      return `İşlem başarısız (${status})`
    }
  }

  return t
}

async function request(path: string, init?: RequestInit & { signal?: AbortSignal }) {
  const token = getAccessToken()
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    signal: init?.signal,
    headers: {
      ...(init?.headers ?? {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    }
  })

  if (!res.ok) {
    if (res.status === 401) {
      clearSession()
      if (typeof window !== 'undefined') window.location.assign('/login')
      throw new Error('Oturum süresi doldu. Lütfen tekrar giriş yapın.')
    }

    const text = await res.text().catch(() => '')
    const err = new Error(getFriendlyError(text, res.status)) as Error & { status?: number }
    err.status = res.status
    throw err
  }

  return res
}

export async function fetchMontajList(opts?: { signal?: AbortSignal }): Promise<MontajListItemDto[]> {
  const res = await request('/api/montaj/list', { signal: opts?.signal })
  const json = await res.json().catch(() => null)
  return (json?.data ?? []) as MontajListItemDto[]
}

export async function fetchMontajReport(opts?: { signal?: AbortSignal }): Promise<MontajListItemDto[]> {
  const res = await request('/api/montaj/report', { signal: opts?.signal })
  const json = await res.json().catch(() => null)
  return (json?.data ?? []) as MontajListItemDto[]
}

export async function createMontaj(payload: CreateMontajPayload): Promise<{ id: number }> {
  const res = await request('/api/montaj', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })

  const json = await res.json().catch(() => null)
  const id = Number(json?.data?.id)
  if (!Number.isFinite(id) || id <= 0) throw new Error('Kayıt oluşturulamadı')
  return { id }
}

export async function planMontaj(id: number, payload: PlanMontajPayload): Promise<void> {
  await request(`/api/montaj/${encodeURIComponent(String(id))}/plan`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
}

export async function updateMontajStatus(id: number, status: string): Promise<void> {
  await request(`/api/montaj/${encodeURIComponent(String(id))}/status`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status })
  })
}

export async function fetchMontajDocuments(id: number, opts?: { signal?: AbortSignal }): Promise<InstallationDocumentDto[]> {
  const res = await request(`/api/montaj/${encodeURIComponent(String(id))}/documents`, { signal: opts?.signal })
  const json = await res.json().catch(() => null)
  return (json?.data ?? []) as InstallationDocumentDto[]
}

export async function uploadMontajDocument(id: number, file: File): Promise<void> {
  const form = new FormData()
  form.append('file', file)

  await request(`/api/montaj/${encodeURIComponent(String(id))}/document`, {
    method: 'POST',
    body: form
  })
}

export type MontajAnalyticsDto = {
  totals: {
    total: number
    active: number
    done: number
    cancelled: number
    postponed: number
    workshop: number
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
  monthlyTrend: Array<{ month: string; total: number; done: number }>
}

export async function fetchMontajAnalytics(opts?: { signal?: AbortSignal }): Promise<MontajAnalyticsDto> {
  const res = await request('/api/montaj/analytics', { signal: opts?.signal })
  const json = await res.json().catch(() => null)
  const data = (json?.data ?? null) as MontajAnalyticsDto | null
  if (!data) {
    return {
      totals: { total: 0, active: 0, done: 0, cancelled: 0, postponed: 0, workshop: 0, montaj: 0, ariza: 0, today: 0, thisMonth: 0, avgPlanLeadDays: 0, completionRate: 0 },
      byStatus: [],
      byRegion: [],
      byTechnician: [],
      monthlyTrend: []
    }
  }
  return data
}
