import { API_BASE_URL } from '../config/api'
import { redirectToLogin } from '../auth/redirectToLogin'

export type EmployeeDto = {
  id: number
  employeeCode?: string
  username?: string | null
  password?: string | null
  firstName: string
  lastName: string
  mail: string
  tc: string
  phone: string
  taxNo: string
  taxOffice: string
  bankName?: string
  iban?: string
  hireDate?: string | null
  workPermitDay?: string | null
  salary?: number
  salaryDay?: number
  mealAmount?: number
  isActive: boolean
  createTime?: string
  createUser?: string
  editTime?: string | null
  editUser?: string | null
}

export async function fetchNextEmployeeCode(opts?: { signal?: AbortSignal }): Promise<string> {
  const res = await fetch(`${API_BASE_URL}/api/employees/next-code`, {
    headers: buildHeaders(false),
    signal: opts?.signal
  })
  await handleUnauthorized(res)
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'Çalışan kodu alınamadı'))
  }
  const json = await res.json().catch(() => null)
  const code = String(json?.data?.employeeCode ?? '').trim()
  if (!code) throw new Error('Çalışan kodu üretilemedi')
  return code
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

export async function fetchEmployees(params?: { includeInactive?: boolean; signal?: AbortSignal }): Promise<EmployeeDto[]> {
  const qs = new URLSearchParams()
  if (params?.includeInactive) qs.set('includeInactive', 'true')

  const res = await fetch(`${API_BASE_URL}/api/employees?${qs.toString()}`, {
    headers: buildHeaders(false),
    signal: params?.signal
  })
  await handleUnauthorized(res)
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'Çalışan listesi alınamadı'))
  }
  const json = await res.json()
  return (json?.data ?? []) as EmployeeDto[]
}

export async function createEmployee(payload: Omit<EmployeeDto, 'id' | 'createTime' | 'createUser' | 'editTime' | 'editUser'>) {
  const res = await fetch(`${API_BASE_URL}/api/employees`, {
    method: 'POST',
    headers: buildHeaders(true),
    body: JSON.stringify(payload)
  })
  await handleUnauthorized(res)
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'Çalışan oluşturulamadı'))
  }
  return await res.json().catch(() => null)
}

export async function updateEmployee(id: number, payload: Omit<EmployeeDto, 'id' | 'createTime' | 'createUser' | 'editTime' | 'editUser'>) {
  const res = await fetch(`${API_BASE_URL}/api/employees/${encodeURIComponent(String(id))}`, {
    method: 'PUT',
    headers: buildHeaders(true),
    body: JSON.stringify(payload)
  })
  await handleUnauthorized(res)
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'Çalışan güncellenemedi'))
  }
  return await res.json().catch(() => null)
}

export async function deleteEmployee(id: number) {
  const res = await fetch(`${API_BASE_URL}/api/employees/${encodeURIComponent(String(id))}`, {
    method: 'DELETE',
    headers: buildHeaders(false)
  })
  await handleUnauthorized(res)
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'Çalışan silinemedi'))
  }
  return await res.json().catch(() => null)
}

export async function activateEmployee(id: number) {
  const res = await fetch(`${API_BASE_URL}/api/employees/${encodeURIComponent(String(id))}/activate`, {
    method: 'PUT',
    headers: buildHeaders(false)
  })
  await handleUnauthorized(res)
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'Çalışan aktifleştirilemedi'))
  }
  return await res.json().catch(() => null)
}

export async function hardDeleteEmployee(id: number) {
  const res = await fetch(`${API_BASE_URL}/api/employees/${encodeURIComponent(String(id))}/hard`, {
    method: 'DELETE',
    headers: buildHeaders(false)
  })
  await handleUnauthorized(res)
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'Çalışan kalıcı olarak silinemedi'))
  }
  return await res.json().catch(() => null)
}
