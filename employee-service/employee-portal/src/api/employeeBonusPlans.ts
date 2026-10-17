import type { ErpPaymentSource } from './employeePayments'
import { API_BASE_URL, buildAuthHeaders, handleUnauthorized, friendlyError } from '../config/api'

export type EmployeeBonusPlanDto = {
  id: number
  employeeId: number
  plannedDate: string
  amount: number
  description: string
  bankAccountDefinitionId?: number | null
  cashAccountId?: number | null
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
  erpSource?: ErpPaymentSource | null
}

export async function fetchEmployeeBonusPlans(params?: { employeeId?: number; take?: number; signal?: AbortSignal }): Promise<EmployeeBonusPlanDto[]> {
  const qs = new URLSearchParams()
  if (params?.employeeId) qs.set('employeeId', String(params.employeeId))
  if (params?.take) qs.set('take', String(params.take))

  const res = await fetch(`${API_BASE_URL}/api/EmployeeBonusPlans?${qs.toString()}`, {
    headers: buildAuthHeaders(false),
    signal: params?.signal
  })
  await handleUnauthorized(res)
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'Prim planları alınamadı'))
  }
  const json = await res.json().catch(() => null)
  return (Array.isArray(json) ? json : (json?.data ?? [])) as EmployeeBonusPlanDto[]
}

export async function createEmployeeBonusPlan(payload: {
  employeeId: number
  plannedDate: string
  amount: number
  description?: string
  bankAccountDefinitionId?: number | null
  cashAccountId?: number | null
}) {
  const res = await fetch(`${API_BASE_URL}/api/EmployeeBonusPlans`, {
    method: 'POST',
    headers: buildAuthHeaders(true),
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
    headers: buildAuthHeaders(true),
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
    headers: buildAuthHeaders(true),
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
    headers: buildAuthHeaders(false)
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
    headers: buildAuthHeaders(false)
  })
  await handleUnauthorized(res)
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'Prim ödemesi geri alınamadı'))
  }
  return await res.json().catch(() => null)
}
