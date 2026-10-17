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

export type EmployeeLeaveDto = {
  id: number
  employeeId: number
  leaveStartTime: string
  returnTime: string
  description?: string | null
  createUser?: string
  createTime?: string
}

export async function fetchEmployeeLeavesByEmployee(employeeId: number, params?: { take?: number; signal?: AbortSignal }): Promise<EmployeeLeaveDto[]> {
  const qs = new URLSearchParams()
  if (params?.take) qs.set('take', String(params.take))

  const res = await fetch(`${API_BASE_URL}/api/EmployeeLeaves/by-employee/${encodeURIComponent(String(employeeId))}?${qs.toString()}`, {
    headers: buildHeaders(false),
    signal: params?.signal
  })
  await handleUnauthorized(res)
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'İzin kayıtları alınamadı'))
  }
  const json = await res.json().catch(() => null)
  return (json?.data ?? []) as EmployeeLeaveDto[]
}

export async function createEmployeeLeave(payload: { employeeId: number; leaveStartTime: string; returnTime: string; description?: string }) {
  const res = await fetch(`${API_BASE_URL}/api/EmployeeLeaves`, {
    method: 'POST',
    headers: buildHeaders(true),
    body: JSON.stringify(payload)
  })
  await handleUnauthorized(res)
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'İzin kaydı oluşturulamadı'))
  }
  return await res.json().catch(() => null)
}

export async function deleteEmployeeLeave(id: number) {
  const res = await fetch(`${API_BASE_URL}/api/EmployeeLeaves/${encodeURIComponent(String(id))}`, {
    method: 'DELETE',
    headers: buildHeaders(false)
  })
  await handleUnauthorized(res)
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'İzin kaydı silinemedi'))
  }
  return await res.json().catch(() => null)
}
