import { API_BASE_URL, buildAuthHeaders, handleUnauthorized, friendlyError } from '../config/api'

export type EmployeeDto = {
  id: number
  employeeCode?: string | null
  username?: string | null
  password?: string | null
  firstName?: string | null
  lastName?: string | null
  mail?: string | null
  tc?: string | null
  phone?: string | null
  taxNo?: string | null
  taxOffice?: string | null
  bankName?: string | null
  iban?: string | null
  bankAccountNo?: string | null
  customerNo?: string | null
  hireDate?: string | null

  workPermitDay?: string | null
  workPermitStartDate?: string | null
  passportNo?: string | null
  nationality?: string | null
  birthDate?: string | null
  birthPlace?: string | null
  providentFundNo?: string | null
  socialSecurityNo?: string | null
  ssdNo?: string | null
  address?: string | null
  addressDetail?: string | null
  workPermitRenewalFee?: number | null
  salary?: number | null
  salaryDay?: number | null
  mealAmount?: number | null
  workType?: string | null
  workplace?: string | null
  /** Mesai başlatabileceği konum. null ise aktif konumların herhangi biri. */
  locationSettingId?: number | null
  /** Bu personele yemek veriliyor mu? Kapalıysa yemek hakedişi hesaplanmaz. */
  hasMealAllowance?: boolean
  isActive: boolean
  workScheduleSettingId?: number | null
  terminationDate?: string | null
  terminationReason?: string | null
  annualLeaveOverrideDays?: number | null
  createTime?: string
  createUser?: string
  editTime?: string | null
  editUser?: string | null
}

export async function fetchNextEmployeeCode(opts?: { signal?: AbortSignal }): Promise<string> {
  const res = await fetch(`${API_BASE_URL}/api/employees/next-code`, {
    headers: buildAuthHeaders(false),
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

export async function fetchEmployees(params?: { includeInactive?: boolean; signal?: AbortSignal }): Promise<EmployeeDto[]> {
  const qs = new URLSearchParams()
  if (params?.includeInactive) qs.set('includeInactive', 'true')

  const res = await fetch(`${API_BASE_URL}/api/employees?${qs.toString()}`, {
    headers: buildAuthHeaders(false),
    signal: params?.signal
  })
  await handleUnauthorized(res)
  if (res.status === 403) {
    throw new Error('FORBIDDEN_EMPLOYEES_PAGE')
  }
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'Çalışan listesi alınamadı'))
  }
  const json = await res.json()
  return (Array.isArray(json) ? json : (json?.data ?? [])) as EmployeeDto[]
}

export async function fetchEmployeeWorkTypes(opts?: { signal?: AbortSignal }): Promise<string[]> {
  const res = await fetch(`${API_BASE_URL}/api/employees/work-types`, {
    headers: buildAuthHeaders(false),
    signal: opts?.signal
  })
  await handleUnauthorized(res)
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'Çalışan tipleri alınamadı'))
  }
  const json = await res.json().catch(() => null)
  return (Array.isArray(json) ? json : (json?.data ?? [])) as string[]
}

export async function fetchEmployeeWorkplaces(opts?: { signal?: AbortSignal }): Promise<string[]> {
  const res = await fetch(`${API_BASE_URL}/api/employees/workplaces`, {
    headers: buildAuthHeaders(false),
    signal: opts?.signal
  })
  await handleUnauthorized(res)
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'İşyerleri alınamadı'))
  }
  const json = await res.json().catch(() => null)
  return (Array.isArray(json) ? json : (json?.data ?? [])) as string[]
}

export async function createEmployee(payload: Omit<EmployeeDto, 'id' | 'createTime' | 'createUser' | 'editTime' | 'editUser'>) {
  const res = await fetch(`${API_BASE_URL}/api/employees`, {
    method: 'POST',
    headers: buildAuthHeaders(true),
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
    headers: buildAuthHeaders(true),
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
    headers: buildAuthHeaders(false)
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
    headers: buildAuthHeaders(false)
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
    headers: buildAuthHeaders(false)
  })
  await handleUnauthorized(res)
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'Çalışan kalıcı olarak silinemedi'))
  }
  return await res.json().catch(() => null)
}
