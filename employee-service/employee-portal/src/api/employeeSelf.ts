import { API_BASE_URL, buildAuthHeaders, handleUnauthorized, friendlyError } from '../config/api'

export type EmployeeSelfDashboardDto = {
  employee: {
    employeeId: number
    employeeName: string
    employeeCode?: string | null
    mail?: string | null
  }
  calendar: {
    month: string
    workedDays: string[]
    leaveDays: string[]
  }
  checkIns: Array<{ id: number; checkInTime: string; checkOutTime?: string | null }>
  leaves: Array<{ id: number; leaveStartTime: string; returnTime: string; description?: string | null }>
  payments: Array<{ id: number; type: number; amount: number; paymentDate: string; description?: string | null }>
}

export type EmployeeSelfLastCheckInDto = {
  id: number
  checkInTime: string
  checkOutTime?: string | null
}

export async function fetchEmployeeSelfDashboard(params: { month: string; take?: number; signal?: AbortSignal }): Promise<EmployeeSelfDashboardDto> {
  const qs = new URLSearchParams()
  qs.set('month', params.month)
  if (params.take) qs.set('take', String(params.take))

  const res = await fetch(`${API_BASE_URL}/api/EmployeeSelf/dashboard?${qs.toString()}`, {
    headers: buildAuthHeaders(false),
    signal: params.signal
  })
  await handleUnauthorized(res)
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'Veriler alınamadı'))
  }
  const json = await res.json().catch(() => null)
  return (json?.data ?? null) as EmployeeSelfDashboardDto
}

export async function fetchEmployeeSelfLastCheckIn(params?: { signal?: AbortSignal }): Promise<EmployeeSelfLastCheckInDto | null> {
  const res = await fetch(`${API_BASE_URL}/api/EmployeeSelf/last-checkin`, {
    headers: buildAuthHeaders(false),
    signal: params?.signal
  })
  await handleUnauthorized(res)
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'Son giriş/çıkış alınamadı'))
  }
  const json = await res.json().catch(() => null)
  return (json?.data ?? null) as EmployeeSelfLastCheckInDto | null
}

export async function employeeSelfCheckOut(payload: { latitude: number; longitude: number; accuracy?: number }): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/api/EmployeeSelf/check-out`, {
    method: 'POST',
    headers: buildAuthHeaders(true),
    body: JSON.stringify(payload)
  })
  await handleUnauthorized(res)
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'Çıkış işlemi başarısız'))
  }
}
