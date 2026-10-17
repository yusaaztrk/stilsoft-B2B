import { apiFetch } from '../config/api'

/** İzin türleri — yıllık izin bakiyesinden yalnızca "Yıllık" düşülür. */
export const LEAVE_TYPES = [
  { value: 1, label: 'Yıllık İzin', paid: true },
  { value: 2, label: 'Mazeret İzni', paid: true },
  { value: 3, label: 'Ücretsiz İzin', paid: false },
  { value: 4, label: 'Raporlu (Hastalık)', paid: true },
  { value: 5, label: 'Doğum İzni', paid: true },
  { value: 6, label: 'Evlilik İzni', paid: true },
  { value: 7, label: 'Ölüm İzni', paid: true },
  { value: 99, label: 'Diğer', paid: true }
] as const

export const LEAVE_STATUSES: Record<number, string> = {
  1: 'Onay Bekliyor',
  2: 'Onaylandı',
  3: 'Reddedildi',
  4: 'İptal'
}

export function leaveTypeLabel(value: number | null | undefined): string {
  return LEAVE_TYPES.find((x) => x.value === Number(value))?.label ?? 'Diğer'
}

export type EmployeeLeaveDto = {
  id: number
  employeeId: number
  leaveStartTime: string
  returnTime: string
  description?: string | null
  leaveType: number
  status: number
  isPaid: boolean
  dayCount: number
  decidedBy?: string | null
  decidedAt?: string | null
  rejectReason?: string | null
  createUser?: string
  createTime?: string
}

export type LeaveBalanceDto = {
  employeeId: number
  employeeName: string
  year: number
  hireDate?: string | null
  seniorityYears: number
  entitlementDays: number
  /** Önceki yıllardan devreden kullanılmayan yıllık izin. Elle override varsa 0'dır. */
  carryOverDays: number
  /** entitlementDays + carryOverDays */
  totalEntitlementDays: number
  usedDays: number
  pendingDays: number
  remainingDays: number
  isOverridden: boolean
  byType: Array<{ leaveType: number; days: number }>
}

export type PendingLeaveDto = {
  id: number
  employeeId: number
  employeeName: string
  leaveStartTime: string
  returnTime: string
  leaveType: number
  isPaid: boolean
  dayCount: number
  description?: string | null
  createUser?: string
  createTime?: string
}

export async function fetchEmployeeLeavesByEmployee(
  employeeId: number,
  params?: { take?: number; signal?: AbortSignal }
): Promise<EmployeeLeaveDto[]> {
  const qs = new URLSearchParams()
  if (params?.take) qs.set('take', String(params.take))

  const json = await apiFetch(`/api/EmployeeLeaves/by-employee/${employeeId}?${qs.toString()}`, {
    signal: params?.signal,
    fallbackError: 'İzin kayıtları alınamadı'
  })

  return (Array.isArray(json) ? json : (json?.data ?? [])) as EmployeeLeaveDto[]
}

/** Yıllık izin hakedişi ve bakiyesi. */
export async function fetchLeaveBalance(employeeId: number, year?: number, signal?: AbortSignal): Promise<LeaveBalanceDto> {
  const qs = year ? `?year=${year}` : ''
  const json = await apiFetch(`/api/EmployeeLeaves/balance/${employeeId}${qs}`, {
    signal,
    fallbackError: 'İzin bakiyesi alınamadı'
  })
  return (json?.data ?? json) as LeaveBalanceDto
}

export async function fetchPendingLeaves(signal?: AbortSignal): Promise<PendingLeaveDto[]> {
  const json = await apiFetch('/api/EmployeeLeaves/pending', { signal, fallbackError: 'İzin talepleri alınamadı' })
  return (Array.isArray(json) ? json : (json?.data ?? [])) as PendingLeaveDto[]
}

export async function createEmployeeLeave(payload: {
  employeeId: number
  leaveStartTime: string
  returnTime: string
  description?: string
  leaveType?: number
  status?: number
  isPaid?: boolean
}) {
  return apiFetch('/api/EmployeeLeaves', {
    method: 'POST',
    body: payload,
    fallbackError: 'İzin kaydı oluşturulamadı'
  })
}

export async function decideEmployeeLeave(id: number, approve: boolean, rejectReason?: string) {
  return apiFetch(`/api/EmployeeLeaves/${id}/decide`, {
    method: 'PUT',
    body: { approve, rejectReason },
    fallbackError: 'İzin kararı kaydedilemedi'
  })
}

/**
 * İzinden erken dönüş: izin kaydının dönüş anını öne çeker, gün sayısını (bakiyeden düşen gün)
 * yeniden hesaplar. `returnTime` verilmezse izin aralığındaki ilk giriş kaydı esas alınır.
 */
export async function earlyReturnEmployeeLeave(id: number, returnTime?: string | null) {
  return apiFetch(`/api/EmployeeLeaves/${id}/early-return`, {
    method: 'PUT',
    body: { returnTime: returnTime ?? null },
    fallbackError: 'Erken dönüş kaydedilemedi'
  })
}

export async function deleteEmployeeLeave(id: number) {
  return apiFetch(`/api/EmployeeLeaves/${id}`, {
    method: 'DELETE',
    fallbackError: 'İzin kaydı silinemedi'
  })
}

export type LeaveRangeDto = {
  id: number
  employeeId: number
  employeeName: string
  employeeCode?: string | null
  leaveStartTime: string
  returnTime: string
  leaveType: number
  status: number
  isPaid: boolean
  dayCount: number
  description?: string | null
  decidedBy?: string | null
  rejectReason?: string | null
  createUser?: string | null
}

/**
 * Tarih aralığındaki tüm izinler. Aralıkla KESİŞEN kayıtlar döner — ay sınırını aşan izin
 * her iki ayda da görünür, takvimde gün boş kalmasın.
 */
export async function fetchLeavesInRange(params: {
  from: string
  to: string
  status?: number
  signal?: AbortSignal
}): Promise<LeaveRangeDto[]> {
  const qs = new URLSearchParams({ from: params.from, to: params.to })
  if (params.status) qs.set('status', String(params.status))
  const json = await apiFetch(`/api/EmployeeLeaves/range?${qs.toString()}`, {
    signal: params.signal,
    fallbackError: 'İzinler alınamadı'
  })
  return (json?.data ?? []) as LeaveRangeDto[]
}

export type LeaveBalanceRowDto = {
  employeeId: number
  employeeCode?: string | null
  employeeName: string
  workplace?: string | null
  hireDate?: string | null
  seniorityYears: number
  entitlementDays: number
  carryOverDays: number
  totalEntitlementDays: number
  usedDays: number
  pendingDays: number
  remainingDays: number
  isOverridden: boolean
}

/** Tüm aktif personelin yıllık izin bakiyesi — tekil uçla aynı kuralı kullanır. */
export async function fetchLeaveBalances(year?: number, signal?: AbortSignal): Promise<LeaveBalanceRowDto[]> {
  const qs = year ? `?year=${year}` : ''
  const json = await apiFetch(`/api/EmployeeLeaves/balances${qs}`, { signal, fallbackError: 'İzin bakiyeleri alınamadı' })
  return (json?.data ?? []) as LeaveBalanceRowDto[]
}
