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

export type EmployeePaymentType = 'salary' | 'bonus' | 'cashAdvance'

export type EmployeePaymentDto = {
  id: number
  employeeId: number
  type: number
  amount: number
  paymentDate: string
  description?: string | null
  deductFromSalary?: boolean
  salaryDeductedAt?: string | null
  createUser?: string
  createTime?: string
}

export async function fetchEmployeePayments(params?: { employeeId?: number; take?: number; signal?: AbortSignal }): Promise<EmployeePaymentDto[]> {
  const qs = new URLSearchParams()
  if (params?.employeeId) qs.set('employeeId', String(params.employeeId))
  if (params?.take) qs.set('take', String(params.take))

  const res = await fetch(`${API_BASE_URL}/api/EmployeePayments?${qs.toString()}`, {
    headers: buildHeaders(false),
    signal: params?.signal
  })
  await handleUnauthorized(res)
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'Ödeme kayıtları alınamadı'))
  }
  const json = await res.json().catch(() => null)
  return (json?.data ?? []) as EmployeePaymentDto[]
}

export async function createEmployeePayment(payload: {
  employeeId: number
  type: number
  amount: number
  paymentDate?: string
  description?: string
  deductFromSalary?: boolean
}) {
  const res = await fetch(`${API_BASE_URL}/api/EmployeePayments`, {
    method: 'POST',
    headers: buildHeaders(true),
    body: JSON.stringify(payload)
  })
  await handleUnauthorized(res)
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'Ödeme kaydı oluşturulamadı'))
  }
  return await res.json().catch(() => null)
}

export async function bulkMealPayment(payload: {
  employeeIds: number[]
  paymentDate?: string
  description?: string
  bankAccountDefinitionId?: number | null
  cashAccountId?: number | null
}) {
  const res = await fetch(`${API_BASE_URL}/api/EmployeePayments/bulk-meal`, {
    method: 'POST',
    headers: buildHeaders(true),
    body: JSON.stringify(payload)
  })
  await handleUnauthorized(res)
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'Toplu yemek ödemesi yapılamadı'))
  }
  return await res.json().catch(() => null)
}

export async function bulkSalaryPayment(payload: {
  employeeIds: number[]
  paymentDate?: string
  description?: string
  bankAccountDefinitionId?: number | null
  cashAccountId?: number | null
}) {
  const res = await fetch(`${API_BASE_URL}/api/EmployeePayments/bulk-salary`, {
    method: 'POST',
    headers: buildHeaders(true),
    body: JSON.stringify(payload)
  })
  await handleUnauthorized(res)
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'Toplu maaş ödemesi yapılamadı'))
  }
  return await res.json().catch(() => null)
}

export async function deleteEmployeePayment(id: number) {
  const res = await fetch(`${API_BASE_URL}/api/EmployeePayments/${encodeURIComponent(String(id))}`, {
    method: 'DELETE',
    headers: buildHeaders(false)
  })
  await handleUnauthorized(res)
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'Ödeme geri alınamadı'))
  }
  return await res.json().catch(() => null)
}
