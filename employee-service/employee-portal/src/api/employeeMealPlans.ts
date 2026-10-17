import type { ErpPaymentSource } from './employeePayments'
import { API_BASE_URL, buildAuthHeaders, handleUnauthorized, friendlyError } from '../config/api'

export type EmployeeMealPlanDto = {
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

export type BulkPlannedMealPaymentRequest = {
  employeeIds: number[]
  description?: string
  bankAccountDefinitionId?: number | null
  cashAccountId?: number | null
  erpSource?: ErpPaymentSource | null
}

export async function fetchEmployeeMealPlans(params?: { employeeId?: number; take?: number; signal?: AbortSignal }): Promise<EmployeeMealPlanDto[]> {
  const qs = new URLSearchParams()
  if (params?.employeeId) qs.set('employeeId', String(params.employeeId))
  if (params?.take) qs.set('take', String(params.take))

  const res = await fetch(`${API_BASE_URL}/api/EmployeeMealPlans?${qs.toString()}`, {
    headers: buildAuthHeaders(false),
    signal: params?.signal
  })
  await handleUnauthorized(res)
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'Yemek planları alınamadı'))
  }
  const json = await res.json().catch(() => null)
  return (Array.isArray(json) ? json : (json?.data ?? [])) as EmployeeMealPlanDto[]
}

export async function createEmployeeMealPlan(payload: { employeeId: number; plannedDate: string; amount: number; description?: string }) {
  const res = await fetch(`${API_BASE_URL}/api/EmployeeMealPlans`, {
    method: 'POST',
    headers: buildAuthHeaders(true),
    body: JSON.stringify(payload)
  })
  await handleUnauthorized(res)
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'Yemek planı oluşturulamadı'))
  }
  return await res.json().catch(() => null)
}

export async function updateEmployeeMealPlanStatus(id: number, payload: { status: number }) {
  const res = await fetch(`${API_BASE_URL}/api/EmployeeMealPlans/${encodeURIComponent(String(id))}/status`, {
    method: 'PUT',
    headers: buildAuthHeaders(true),
    body: JSON.stringify(payload)
  })
  await handleUnauthorized(res)
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'Yemek planı güncellenemedi'))
  }
  return await res.json().catch(() => null)
}

export async function bulkPayPlannedMealPlans(body: BulkPlannedMealPaymentRequest) {
  const res = await fetch(`${API_BASE_URL}/api/EmployeeMealPlans/bulk-pay`, {
    method: 'POST',
    headers: buildAuthHeaders(true),
    body: JSON.stringify(body)
  })
  const j = await res.json().catch(() => null)
  if (!res.ok) throw new Error(friendlyError(j, res.status, 'Yemek planları toplu olarak ödendi'))
  if (j?.success === false) throw new Error(friendlyError(j, res.status, 'Yemek planları toplu olarak ödendi'))
  return j?.paidCount ?? 0
}

export async function deleteEmployeeMealPlan(id: number) {
  const res = await fetch(`${API_BASE_URL}/api/EmployeeMealPlans/${encodeURIComponent(String(id))}`, {
    method: 'DELETE',
    headers: buildAuthHeaders(false)
  })
  await handleUnauthorized(res)
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'Yemek planı iptal edilemedi'))
  }
  return await res.json().catch(() => null)
}

export async function undoPayEmployeeMealPlan(id: number) {
  const res = await fetch(`${API_BASE_URL}/api/EmployeeMealPlans/${encodeURIComponent(String(id))}/undo-pay`, {
    method: 'POST',
    headers: buildAuthHeaders(false)
  })
  await handleUnauthorized(res)
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'Yemek ödemesi geri alınamadı'))
  }
  return await res.json().catch(() => null)
}
