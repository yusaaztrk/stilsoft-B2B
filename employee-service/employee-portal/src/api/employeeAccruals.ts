import { apiFetch, API_BASE_URL, buildAuthHeaders, handleUnauthorized, friendlyError } from '../config/api'

export function formatMinutes(mins?: number | null): string {
  const m = Number(mins) || 0
  const sign = m < 0 ? '-' : ''
  const abs = Math.abs(m)
  const hours = Math.floor(abs / 60)
  const rem = abs % 60
  return `${sign}${hours} sa ${rem} dk`
}

export type AccrualDayBlockDto = {

  label: string
  start: string
  end: string
  payMultiplier: number
  expectedMinutes: number
  workedMinutes: number
}

export type AccrualDayDto = {
  date: string
  expectedMinutes: number
  workedMinutes: number
  plannedWorkedMinutes: number
  /** Mesai dışı çalışmanın aynı günün eksiğini kapatan kısmı (fazla mesai sayılmaz). */
  compensatedMinutes?: number
  overtimeMinutes: number
  dayPay: number
  blocks: AccrualDayBlockDto[]
  isHoliday: boolean
  holidayName?: string | null
  isLeave: boolean
  isPaidLeave: boolean
  /** O gün izinle kapsanan mesai dakikası (çalışılan kısım düşülmüş). */
  leaveMinutes?: number
  /** İzin aralığındaki günde işe gelmiş (erken dönüş / kısmi izin). */
  workedDuringLeave?: boolean
  isLate: boolean
  isAbsent: boolean
  hasOpenCheckIn: boolean
}

export type AccrualDto = {
  employeeId: number
  employeeCode: string
  employeeName: string
  period: string
  scheduleName: string

  expectedWorkDays: number
  expectedMinutes: number
  holidayCount: number

  attendedDays: number
  workedMinutes: number
  plannedWorkedMinutes: number
  compensatedMinutes?: number
  overtimeMinutes: number
  missingMinutes: number
  lateDays: number
  openCheckInCount: number

  paidLeaveDays: number
  unpaidLeaveDays: number
  absentDays: number

  monthlySalary: number
  /** Dönemin bugüne kadar geçen kısmının maaşı; ay bitmişse aylık maaşın tamamı. */
  elapsedSalary?: number
  dailyWage: number
  hourlyWage: number
  minuteWage: number
  absenceDeduction: number
  shiftPremium: number
  overtimePay: number
  mealAccrual: number
  grossAccrual: number
  deductibleAdvances: number
  alreadyPaid: number
  netPayable: number

  seniorityYears: number
  annualLeaveEntitlementDays: number
  annualLeaveUsedDays: number
  annualLeaveRemainingDays: number

  lastCalculatedAt?: string | null
  lastCalculatedDate?: string | null
  hasSalaryOverride?: boolean
  salaryOverrideAmount?: number | null
  salaryOverrideDescription?: string | null
  hasMealOverride?: boolean
  mealOverrideAmount?: number | null
  mealOverrideDescription?: string | null

  days: AccrualDayDto[]
}

export type AccrualSummaryDto = {
  employeeCount: number
  totalGross: number
  totalAdvances: number
  totalAlreadyPaid: number
  totalNetPayable: number
  totalMeal: number
  totalOvertimePay: number
  totalAbsenceDeduction: number
  totalOvertimeMinutes: number
  totalAbsentDays: number
}

export type MonthlyOverrideDto = {
  id: number
  employeeId: number
  period: string
  overrideType: number // 1=Salary, 2=Meal
  originalAmount: number
  overrideAmount: number
  description?: string | null
  createUser?: string | null
  createTime?: string | null
}

export async function fetchAccruals(
  period: string,
  opts?: { employeeIds?: number[]; forceRefresh?: boolean; signal?: AbortSignal }
): Promise<{ data: AccrualDto[]; summary: AccrualSummaryDto; lastCalculatedAt?: string | null }> {
  const qs = new URLSearchParams({ period })
  if (opts?.employeeIds?.length) qs.set('employeeIds', opts.employeeIds.join(','))
  if (opts?.forceRefresh) qs.set('forceRefresh', 'true')

  const json = await apiFetch(`/api/EmployeeAccruals?${qs.toString()}`, {
    signal: opts?.signal,
    fallbackError: 'Hakedişler alınamadı'
  })

  return {
    data: (json?.data ?? []) as AccrualDto[],
    summary: (json?.summary ?? {}) as AccrualSummaryDto,
    lastCalculatedAt: json?.lastCalculatedAt
  }
}

export async function refreshAccruals(
  period: string,
  employeeIds?: number[]
): Promise<{ data: AccrualDto[]; summary: any; lastCalculatedAt?: string | null }> {
  const res = await fetch(`${API_BASE_URL}/api/EmployeeAccruals/refresh`, {
    method: 'POST',
    headers: buildAuthHeaders(true),
    body: JSON.stringify({ period, employeeIds })
  })
  await handleUnauthorized(res)
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'Hakediş yenilenemedi'))
  }
  const json = await res.json().catch(() => null)
  return {
    data: (json?.data ?? []) as AccrualDto[],
    summary: json?.summary,
    lastCalculatedAt: json?.lastCalculatedAt
  }
}

export async function saveMonthlyOverride(payload: {
  employeeId: number
  period: string
  overrideType: number
  overrideAmount: number
  description?: string
}): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/api/EmployeeAccruals/override`, {
    method: 'POST',
    headers: buildAuthHeaders(true),
    body: JSON.stringify(payload)
  })
  await handleUnauthorized(res)
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'Manuel düzenleme kaydedilemedi'))
  }
}

export async function fetchMonthlyOverrides(params: {
  period?: string
  employeeId?: number
}): Promise<MonthlyOverrideDto[]> {
  const qs = new URLSearchParams()
  if (params.period) qs.set('period', params.period)
  if (params.employeeId) qs.set('employeeId', String(params.employeeId))

  const res = await fetch(`${API_BASE_URL}/api/EmployeeAccruals/overrides?${qs.toString()}`, {
    headers: buildAuthHeaders(false)
  })
  await handleUnauthorized(res)
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'Manuel düzenlemeler alınamadı'))
  }
  const json = await res.json().catch(() => null)
  return (json?.data ?? []) as MonthlyOverrideDto[]
}

export async function deleteMonthlyOverride(id: number): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/api/EmployeeAccruals/override/${encodeURIComponent(String(id))}`, {
    method: 'DELETE',
    headers: buildAuthHeaders(false)
  })
  await handleUnauthorized(res)
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'Düzenleme silinemedi'))
  }
}

export async function fetchAccrualDetail(
  employeeId: number,
  period: string,
  opts?: { signal?: AbortSignal }
): Promise<AccrualDto> {
  const qs = new URLSearchParams({ period })
  const json = await apiFetch(`/api/EmployeeAccruals/${encodeURIComponent(String(employeeId))}?${qs.toString()}`, {
    signal: opts?.signal,
    fallbackError: 'Puantaj dökümü alınamadı'
  })
  return json?.data as AccrualDto
}

/**
 * Seçilen personelin ilgili dönem maaş hakedişini TANIMLAR — cari ekstreye alacak yazan işlem budur.
 *
 * Hakediş kendiliğinden oluşmaz: ekstredeki maaş alacağı yalnızca burada tanımlanandan doğar.
 * Aynı dönem yeniden tanımlanırsa tutar güncellenir, ikinci alacak satırı oluşmaz.
 */
export async function defineSalaryAccrual(payload: {
  employeeIds: number[]
  /** Dönem "yyyy-MM". Ödeme tarihinden bağımsızdır. */
  period: string
  /** Personel başına tutar. Verilmezse sistemin hesapladığı hakediş kullanılır. */
  amounts?: Record<number, number>
  description?: string
}): Promise<{ definedCount: number; skipped: string[]; message: string }> {
  const res = await fetch(`${API_BASE_URL}/api/EmployeeAccruals/define-salary`, {
    method: 'POST',
    headers: buildAuthHeaders(true),
    body: JSON.stringify(payload)
  })
  await handleUnauthorized(res)
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'Hakediş tanımlanamadı'))
  }
  const json = await res.json().catch(() => null)
  return {
    definedCount: Number(json?.definedCount ?? 0),
    skipped: (json?.skipped ?? []) as string[],
    message: String(json?.message ?? '')
  }
}

/**
 * Seçilen personelin ilgili dönem YEMEK hakedişini tanımlar (maaş tarafının karşılığı).
 *
 * Yemek AYLIK bir tutardır ama sabit ödenmez: maaşla aynı mantıkla, dönemin çalışılan
 * dakikası oranında hak edilir. Giriş/çıkış kaydı yoksa dönemin bugüne kadar geçen beklenen
 * dakikası üzerinden hesaplanır. Kayıt `EmployeeMealPlans` üzerinde tutulur ve cari ekstredeki
 * yemek alacağının tek kaynağıdır.
 */
export async function defineMealAccrual(payload: {
  employeeIds: number[]
  period: string
  amounts?: Record<number, number>
  description?: string
}): Promise<{ definedCount: number; skipped: string[]; message: string }> {
  const res = await fetch(`${API_BASE_URL}/api/EmployeeAccruals/define-meal`, {
    method: 'POST',
    headers: buildAuthHeaders(true),
    body: JSON.stringify(payload)
  })
  await handleUnauthorized(res)
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'Yemek hakedişi tanımlanamadı'))
  }
  const json = await res.json().catch(() => null)
  return {
    definedCount: Number(json?.definedCount ?? 0),
    skipped: (json?.skipped ?? []) as string[],
    message: String(json?.message ?? '')
  }
}

export type DailyOverrideDto = {
  id: number
  date: string
  overrideMinutes?: number | null
  overrideAmount?: number | null
  description?: string | null
  createUser?: string | null
  createTime?: string | null
}

/**
 * Tek bir günün hakedişini elle düzeltir.
 *
 * `overrideMinutes` o günün çalışılmış sayılacak dakikasıdır (unutulan çıkış için doğru olan
 * budur); `overrideAmount` günün TL değerini doğrudan belirler ve dakika hesabının önüne geçer.
 * Düzeltme yalnızca o günü etkiler, dönemin geri kalanı motorun hesabıyla yürür.
 */
export async function saveDailyOverride(payload: {
  employeeId: number
  date: string
  /** 1 = maaş, 2 = yemek */
  kind?: number
  overrideMinutes?: number | null
  overrideAmount?: number | null
  description?: string
}): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/api/EmployeeAccruals/daily-override`, {
    method: 'POST',
    headers: buildAuthHeaders(true),
    body: JSON.stringify(payload)
  })
  await handleUnauthorized(res)
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'Gün düzeltmesi kaydedilemedi'))
  }
}

/** Bir günün düzeltmesini kaldırır; o gün motorun hesabına döner. */
export async function deleteDailyOverride(employeeId: number, date: string, kind = 1): Promise<void> {
  const qs = new URLSearchParams({ employeeId: String(employeeId), date, kind: String(kind) })
  const res = await fetch(`${API_BASE_URL}/api/EmployeeAccruals/daily-override?${qs}`, {
    method: 'DELETE',
    headers: buildAuthHeaders(false)
  })
  await handleUnauthorized(res)
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'Düzeltme kaldırılamadı'))
  }
}

export async function fetchDailyOverrides(employeeId: number, period: string, kind = 1): Promise<DailyOverrideDto[]> {
  const qs = new URLSearchParams({ employeeId: String(employeeId), period, kind: String(kind) })
  const res = await fetch(`${API_BASE_URL}/api/EmployeeAccruals/daily-overrides?${qs}`, {
    headers: buildAuthHeaders(false)
  })
  await handleUnauthorized(res)
  if (!res.ok) return []
  const json = await res.json().catch(() => null)
  return (json?.data ?? []) as DailyOverrideDto[]
}

/** Tanımlanmış maaş hakedişini geri alır; alacak cari ekstreden düşer. */
export async function deleteDefinedSalaryAccrual(id: number): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/api/EmployeeAccruals/defined-salary/${encodeURIComponent(String(id))}`, {
    method: 'DELETE',
    headers: buildAuthHeaders(false)
  })
  await handleUnauthorized(res)
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'Hakediş tanımı geri alınamadı'))
  }
}
