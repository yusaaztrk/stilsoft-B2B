import { API_BASE_URL } from '../config/api'
import { redirectToLogin } from '../auth/redirectToLogin'

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

export type EmployeeBonusPlanDto = {
  id: number
  employeeId: number
  plannedDate: string
  amount: number
  description: string
  status: number
  paidPaymentId?: number | null
  createUser?: string
  createTime?: string
}

export type BulkPlannedBonusPaymentRequest = {
  employeeIds: number[]
  description?: string
  bankAccountDefinitionId?: number | null
  cashAccountId?: number | null
}

export async function fetchEmployeeBonusPlans(params?: { employeeId?: number; take?: number; signal?: AbortSignal }): Promise<EmployeeBonusPlanDto[]> {
  const qs = new URLSearchParams()
  if (params?.employeeId) qs.set('employeeId', String(params.employeeId))
  if (params?.take) qs.set('take', String(params.take))

  const res = await fetch(`${API_BASE_URL}/api/EmployeeBonusPlans?${qs.toString()}`, {
    headers: buildHeaders(false),
    signal: params?.signal
  })
  await handleUnauthorized(res)
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'Prim planları alınamadı'))
  }
  const json = await res.json().catch(() => null)
  return (json?.data ?? []) as EmployeeBonusPlanDto[]
}

export async function createEmployeeBonusPlan(payload: { employeeId: number; plannedDate: string; amount: number; description?: string }) {
  const res = await fetch(`${API_BASE_URL}/api/EmployeeBonusPlans`, {
    method: 'POST',
    headers: buildHeaders(true),
    body: JSON.stringify(payload)
  })
  await handleUnauthorized(res)
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'Prim planı oluşturulamadı'))
  }
  return await res.json().catch(() => null)
}

export async function updateEmployeeBonusPlanStatus(id: number, payload: { status: number }) {
  const res = await fetch(`${API_BASE_URL}/api/EmployeeBonusPlans/${encodeURIComponent(String(id))}/status`, {
    method: 'PUT',
    headers: buildHeaders(true),
    body: JSON.stringify(payload)
  })
  await handleUnauthorized(res)
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'Prim planı güncellenemedi'))
  }
  return await res.json().catch(() => null)
}

export async function bulkPayPlannedBonusPlans(body: BulkPlannedBonusPaymentRequest) {
  const res = await fetch(`${API_BASE_URL}/api/EmployeeBonusPlans/bulk-pay`, {
    method: 'POST',
    headers: buildHeaders(true),
    body: JSON.stringify(body)
  })
  const j = await res.json().catch(() => null)
  if (!res.ok) throw new Error(friendlyError(j, res.status, 'Prim planları toplu olarak ödendi'))
  if (j?.success === false) throw new Error(friendlyError(j, res.status, 'Prim planları toplu olarak ödendi'))
  return j?.paidCount ?? 0
}

export async function deleteEmployeeBonusPlan(id: number) {
  const res = await fetch(`${API_BASE_URL}/api/EmployeeBonusPlans/${encodeURIComponent(String(id))}`, {
    method: 'DELETE',
    headers: buildHeaders(false)
  })
  await handleUnauthorized(res)
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'Prim planı iptal edilemedi'))
  }
  return await res.json().catch(() => null)
}

export async function undoPayEmployeeBonusPlan(id: number) {
  const res = await fetch(`${API_BASE_URL}/api/EmployeeBonusPlans/${encodeURIComponent(String(id))}/undo-pay`, {
    method: 'POST',
    headers: buildHeaders(false)
  })
  await handleUnauthorized(res)
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'Prim ödemesi geri alınamadı'))
  }
  return await res.json().catch(() => null)
}
