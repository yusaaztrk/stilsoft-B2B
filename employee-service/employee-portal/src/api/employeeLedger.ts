import type { ErpPaymentSource } from './employeePayments'
import { API_BASE_URL, buildAuthHeaders, handleUnauthorized, friendlyError } from '../config/api'

/**
 * Cari ekstre. Alacak = personelin hakedişi, Borç = personele ödenen,
 * Bakiye = alacak − borç (pozitifse firma personele borçlu).
 */
export type LedgerLineDto = {
  date: string
  period?: string | null
  kind: 'accrual' | 'bonusPlan' | 'mealPlan' | 'salary' | 'bonus' | 'meal' | 'advance' | string
  label: string
  description?: string | null
  credit: number
  debit: number
  balance: number
  refId?: number | null
}

export type LedgerDto = {
  employee: {
    id: number
    employeeCode: string
    name: string
    workplace?: string | null
    hireDate?: string | null
    salary: number
    bankAccountNo?: string | null
    customerNo?: string | null
    iban?: string | null
    bankName?: string | null
  }
  fromPeriod: string
  toPeriod: string
  lines: LedgerLineDto[]
  totals: { credit: number; debit: number; balance: number }
}

export type LedgerSummaryRowDto = {
  employeeId: number
  employeeCode: string
  employeeName: string
  workplace?: string | null
  salary: number
  bankAccountNo?: string | null
  customerNo?: string | null
  iban?: string | null
  bankName?: string | null
  credit: number
  debit: number
  balance: number
}

export type LedgerSummaryDto = {
  rows: LedgerSummaryRowDto[]
  fromPeriod: string
  toPeriod: string
  summary: { employeeCount: number; totalCredit: number; totalDebit: number; totalBalance: number }
}

export type CashAccountSummaryDto = {
  id: number
  code: string
  name: string
  balance: number
  totalIn: number
  totalOut: number
  transactions: Array<{
    id: number
    date: string
    direction: number
    amount: number
    description?: string | null
    counterpartyName?: string | null
    createTime: string
    referenceNo?: string | null
    isBulk?: boolean
    paymentType?: number | null
    salaryPeriod?: string | null
  }>
}

function range(params?: { from?: string; to?: string }): string {
  const qs = new URLSearchParams()
  if (params?.from) qs.set('from', params.from)
  if (params?.to) qs.set('to', params.to)
  const s = qs.toString()
  return s ? `?${s}` : ''
}

export async function fetchEmployeeLedger(
  employeeId: number,
  params?: { from?: string; to?: string; signal?: AbortSignal }
): Promise<LedgerDto> {
  const res = await fetch(`${API_BASE_URL}/api/EmployeeLedger/${encodeURIComponent(String(employeeId))}${range(params)}`, {
    headers: buildAuthHeaders(false),
    signal: params?.signal
  })
  await handleUnauthorized(res)
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'Cari ekstre alınamadı'))
  }
  const json = await res.json().catch(() => null)
  return json?.data as LedgerDto
}

export async function fetchLedgerSummary(params?: {
  from?: string
  to?: string
  signal?: AbortSignal
}): Promise<LedgerSummaryDto> {
  const res = await fetch(`${API_BASE_URL}/api/EmployeeLedger/summary${range(params)}`, {
    headers: buildAuthHeaders(false),
    signal: params?.signal
  })
  await handleUnauthorized(res)
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'Bakiye listesi alınamadı'))
  }
  const json = await res.json().catch(() => null)
  return {
    rows: (json?.data ?? []) as LedgerSummaryRowDto[],
    fromPeriod: String(json?.fromPeriod ?? ''),
    toPeriod: String(json?.toPeriod ?? ''),
    summary: json?.summary ?? { employeeCount: 0, totalCredit: 0, totalDebit: 0, totalBalance: 0 }
  }
}

export async function deleteLedgerLine(kind: string, refId: number): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/api/EmployeeLedger/line/${encodeURIComponent(kind)}/${encodeURIComponent(String(refId))}`, {
    method: 'DELETE',
    headers: buildAuthHeaders(false)
  })
  await handleUnauthorized(res)
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'Kayıt geri alınamadı'))
  }
}

export async function singlePayout(payload: {
  employeeId: number
  amount: number
  paymentType?: number
  description?: string
  paymentDate?: string
  cashAccountId?: number | null
  erpSource?: ErpPaymentSource | null
}): Promise<{ paymentId: number; periods?: { period: string; amount: number }[] }> {
  const res = await fetch(`${API_BASE_URL}/api/EmployeeLedger/single-payout`, {
    method: 'POST',
    headers: buildAuthHeaders(true),
    body: JSON.stringify(payload)
  })
  await handleUnauthorized(res)
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'Ödeme kaydedilemedi'))
  }
  const json = await res.json().catch(() => null)
  return json as { paymentId: number; periods?: { period: string; amount: number }[] }
}

export async function bulkCashPayout(payload: {
  employeeIds: number[]
  paymentType?: number
  salaryPeriod?: string
  customAmount?: number
  customAmounts?: Record<number, number>
  description?: string
  paymentDate?: string
  cashAccountId?: number | null
  erpSource?: ErpPaymentSource | null
  /** Toplu avansta "maaştan düşülsün". */
  deductFromSalary?: boolean
}): Promise<{ paidCount: number; totalAmount: number; skipped?: string[]; message?: string; periods?: string[] }> {
  const res = await fetch(`${API_BASE_URL}/api/EmployeePayments/bulk-cash-payout`, {
    method: 'POST',
    headers: buildAuthHeaders(true),
    body: JSON.stringify(payload)
  })
  await handleUnauthorized(res)
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'Toplu ödeme gerçekleştirilemedi'))
  }
  const json = await res.json().catch(() => null)
  return json as { paidCount: number; totalAmount: number; skipped?: string[]; message?: string; periods?: string[] }
}

export async function fetchCashAccountSummary(opts?: { signal?: AbortSignal }): Promise<CashAccountSummaryDto> {
  const res = await fetch(`${API_BASE_URL}/api/EmployeePayments/cash-account-summary`, {
    headers: buildAuthHeaders(false),
    signal: opts?.signal
  })
  await handleUnauthorized(res)
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'Kasa bilgisi alınamadı'))
  }
  const json = await res.json().catch(() => null)
  return json?.data as CashAccountSummaryDto
}

export type MonthlySummaryDto = {
  period: string
  employee: { id: number; employeeCode?: string | null; name: string; standardSalary: number; monthlyMealAmount: number; salaryDay: number }
  salary: {
    standard: number
    overrideAmount?: number | null
    overrideDescription?: string | null
    accrued: number
    accrualDefined: boolean
    referenceNo?: string | null
    advanceDeduction: number
    net: number
    paid: number
    remaining: number
  }
  meal: { monthlyAmount: number; overrideAmount?: number | null; accrued: number; accrualDefined: boolean; paid: number; remaining: number }
  bonus: { accrued: number; paid: number; pending: number; items: Array<{ id: number; plannedDate: string; amount: number; description?: string | null; status: number }> }
  advance: {
    total: number
    deductibleFromSalary: number
    notDeductible: number
    deducted: number
    items: Array<{ id: number; amount: number; description?: string | null; paymentDate: string; deductFromSalary: boolean; isDeducted: boolean; referenceNo?: string | null }>
  }
}

/** Bir personelin seçilen aydaki maaş / yemek / prim / avans durumu tek yanıtta. */
export async function fetchMonthlySummary(
  employeeId: number,
  period: string,
  opts?: { signal?: AbortSignal }
): Promise<MonthlySummaryDto> {
  const res = await fetch(
    `${API_BASE_URL}/api/EmployeeLedger/${encodeURIComponent(String(employeeId))}/monthly-summary?period=${encodeURIComponent(period)}`,
    { headers: buildAuthHeaders(false), signal: opts?.signal }
  )
  await handleUnauthorized(res)
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'Aylık finans özeti alınamadı'))
  }
  return (await res.json()) as MonthlySummaryDto
}
