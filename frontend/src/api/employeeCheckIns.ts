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

export type EmployeeCheckInDto = {
  id: number
  employeeId: number
  checkInTime: string
  latitude: number
  longitude: number
  city?: string | null
  district?: string | null
  createUser?: string
  createTime?: string
}

export async function fetchEmployeeCheckInsByEmployee(employeeId: number, params?: { take?: number; signal?: AbortSignal }): Promise<EmployeeCheckInDto[]> {
  const qs = new URLSearchParams()
  if (params?.take) qs.set('take', String(params.take))

  const res = await fetch(`${API_BASE_URL}/api/EmployeeCheckIns/by-employee/${encodeURIComponent(String(employeeId))}?${qs.toString()}`, {
    headers: buildHeaders(false),
    signal: params?.signal
  })
  await handleUnauthorized(res)
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'G/Ç kayıtları alınamadı'))
  }
  const json = await res.json().catch(() => null)
  return (json?.data ?? []) as EmployeeCheckInDto[]
}

export async function createEmployeeCheckIn(employeeId: number, payload: { checkInTime: string }) {
  const res = await fetch(`${API_BASE_URL}/api/EmployeeCheckIns/by-employee/${encodeURIComponent(String(employeeId))}`, {
    method: 'POST',
    headers: buildHeaders(true),
    body: JSON.stringify(payload)
  })
  await handleUnauthorized(res)
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'G/Ç kaydı oluşturulamadı'))
  }
  return await res.json().catch(() => null)
}

export async function updateEmployeeCheckIn(id: number, payload: { checkInTime: string }) {
  const res = await fetch(`${API_BASE_URL}/api/EmployeeCheckIns/${encodeURIComponent(String(id))}`, {
    method: 'PUT',
    headers: buildHeaders(true),
    body: JSON.stringify(payload)
  })
  await handleUnauthorized(res)
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'G/Ç kaydı güncellenemedi'))
  }
  return await res.json().catch(() => null)
}

export async function deleteEmployeeCheckIn(id: number) {
  const res = await fetch(`${API_BASE_URL}/api/EmployeeCheckIns/${encodeURIComponent(String(id))}`, {
    method: 'DELETE',
    headers: buildHeaders(false)
  })
  await handleUnauthorized(res)
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'G/Ç kaydı silinemedi'))
  }
  return await res.json().catch(() => null)
}
