import { API_BASE_URL, apiFetch, buildAuthHeaders, handleUnauthorized, friendlyError } from '../config/api'

export type EmployeeCheckInDto = {
  id: number
  employeeId: number
  checkInTime: string
  checkOutTime?: string | null
  latitude: number
  longitude: number
  city?: string | null
  district?: string | null
  /** Çıkış konumunun il/ilçesi — kayıt anında sunucuda çözülür (2026-10-16). */
  checkOutCity?: string | null
  checkOutDistrict?: string | null
  /** Çıkış konumun "konum dışı çıkış" izniyle bölge dışından yapıldı. */
  checkOutOffsite?: boolean
  /** Çıkış gece otomatik yapıldı (personel basmadı). */
  checkOutAuto?: boolean
  /** Bu kayıtta incelenmemiş şüpheli işlem (sahte konum izi) sayısı. */
  suspicionCount?: number
  checkOutLatitude?: number | null
  checkOutLongitude?: number | null
  createUser?: string
  createTime?: string
}

export async function fetchEmployeeCheckInsByEmployee(employeeId: number, params?: { take?: number; signal?: AbortSignal }): Promise<EmployeeCheckInDto[]> {
  const qs = new URLSearchParams()
  if (params?.take) qs.set('take', String(params.take))

  const res = await fetch(`${API_BASE_URL}/api/EmployeeCheckIns/by-employee/${encodeURIComponent(String(employeeId))}?${qs.toString()}`, {
    headers: buildAuthHeaders(false),
    signal: params?.signal
  })
  await handleUnauthorized(res)
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'G/Ç kayıtları alınamadı'))
  }
  const json = await res.json().catch(() => null)
  return (Array.isArray(json) ? json : (json?.data ?? [])) as EmployeeCheckInDto[]
}

export async function createEmployeeCheckIn(employeeId: number, payload: { checkInTime: string }) {
  const res = await fetch(`${API_BASE_URL}/api/EmployeeCheckIns/by-employee/${encodeURIComponent(String(employeeId))}`, {
    method: 'POST',
    headers: buildAuthHeaders(true),
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
    headers: buildAuthHeaders(true),
    body: JSON.stringify(payload)
  })
  await handleUnauthorized(res)
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'G/Ç kaydı güncellenemedi'))
  }
  return await res.json().catch(() => null)
}

export async function updateEmployeeCheckOut(id: number, payload: { checkOutTime: string }) {
  const res = await fetch(`${API_BASE_URL}/api/EmployeeCheckIns/${encodeURIComponent(String(id))}/check-out`, {
    method: 'PUT',
    headers: buildAuthHeaders(true),
    body: JSON.stringify(payload)
  })
  await handleUnauthorized(res)
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'Çıkış kaydı güncellenemedi'))
  }
  return await res.json().catch(() => null)
}

export async function deleteEmployeeCheckIn(id: number) {
  const res = await fetch(`${API_BASE_URL}/api/EmployeeCheckIns/${encodeURIComponent(String(id))}`, {
    method: 'DELETE',
    headers: buildAuthHeaders(false)
  })
  await handleUnauthorized(res)
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'G/Ç kaydı silinemedi'))
  }
  return await res.json().catch(() => null)
}

export type TodayAttendanceDto = {
  date: string
  checkIns: Array<{ employeeId: number; checkInTime: string; checkOutTime?: string | null }>
  staleOpenCheckIns: Array<{ employeeId: number; checkInTime: string; checkOutTime?: string | null }>
  atWorkEmployeeIds: number[]
}

/**
 * Bugunun mesai durumu tek istekte.
 *
 * Dashboard bunu her personel icin ayri istek atarak topluyordu; 200 personelde 200 istek
 * demekti. Tek uca indirildi.
 */
export async function fetchTodayAttendance(signal?: AbortSignal): Promise<TodayAttendanceDto> {
  const json = await apiFetch('/api/EmployeeCheckIns/today', { signal, fallbackError: 'Gunluk mesai durumu alinamadi' })
  return json?.data as TodayAttendanceDto
}

/**
 * Açık kalmış giriş kayıtlarını (çıkış yapılmamış) o günün mesai bitişiyle kapatır.
 *
 * Çıkış unutulursa o gün 0 dakika sayılır ve hakediş doğmaz — hesap dakika bazlı olduğu için
 * kayıp doğrudan paraya yansır. Bugünün açık kaydına dokunulmaz (personel hâlâ içeride olabilir).
 */
export async function closeOpenCheckIns(payload: {
  employeeIds?: number[]
  period?: string
  date?: string
  closeAtMinute?: number
}): Promise<{ closedCount: number; skippedCount: number; message: string }> {
  const res = await fetch(`${API_BASE_URL}/api/EmployeeCheckIns/close-open`, {
    method: 'POST',
    headers: buildAuthHeaders(true),
    body: JSON.stringify(payload)
  })
  await handleUnauthorized(res)
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'Açık girişler kapatılamadı'))
  }
  const json = await res.json().catch(() => null)
  return {
    closedCount: Number(json?.closedCount ?? 0),
    skippedCount: Number(json?.skippedCount ?? 0),
    message: String(json?.message ?? '')
  }
}
