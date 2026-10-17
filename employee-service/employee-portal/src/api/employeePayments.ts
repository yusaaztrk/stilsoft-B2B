import { API_BASE_URL, buildAuthHeaders, handleUnauthorized, friendlyError } from '../config/api'

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
  /** Odemenin ait oldugu maas donemi "yyyy-MM". */
  salaryPeriod?: string | null
  createUser?: string
  createTime?: string
}

export async function fetchEmployeePayments(params?: { employeeId?: number; take?: number; signal?: AbortSignal }): Promise<EmployeePaymentDto[]> {
  const qs = new URLSearchParams()
  if (params?.employeeId) qs.set('employeeId', String(params.employeeId))
  if (params?.take) qs.set('take', String(params.take))

  const res = await fetch(`${API_BASE_URL}/api/EmployeePayments?${qs.toString()}`, {
    headers: buildAuthHeaders(false),
    signal: params?.signal
  })
  await handleUnauthorized(res)
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'Ödeme kayıtları alınamadı'))
  }
  const json = await res.json().catch(() => null)
  return (Array.isArray(json) ? json : (json?.data ?? [])) as EmployeePaymentDto[]
}

/** Odeme turleri; sunucudaki EmployeePaymentType ile birebir. */
export const PAYMENT_TYPE = { salary: 1, bonus: 2, advance: 3, meal: 4 } as const
export type PaymentTypeKey = keyof typeof PAYMENT_TYPE

export type PaymentReportRow = EmployeePaymentDto & {
  employeeName: string
  employeeCode: string
}

export type PaymentReport = {
  rows: PaymentReportRow[]
  summary: { count: number; total: number; employeeCount: number }
}

/**
 * Tur bazli odeme dokumu. `summary` suzulmus kumenin TAMAMINI ozetler,
 * `rows` ise `take` kadarini dondurur.
 */
export async function fetchPaymentReport(params: {
  type?: number
  employeeId?: number
  period?: string
  from?: string
  to?: string
  take?: number
  signal?: AbortSignal
}): Promise<PaymentReport> {
  const qs = new URLSearchParams()
  if (params.type) qs.set('type', String(params.type))
  if (params.employeeId) qs.set('employeeId', String(params.employeeId))
  if (params.period) qs.set('period', params.period)
  if (params.from) qs.set('from', params.from)
  if (params.to) qs.set('to', params.to)
  qs.set('take', String(params.take ?? 500))

  const res = await fetch(`${API_BASE_URL}/api/EmployeePayments?${qs.toString()}`, {
    headers: buildAuthHeaders(false),
    signal: params.signal
  })
  await handleUnauthorized(res)
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'Ödeme dökümü alınamadı'))
  }
  const json = await res.json().catch(() => null)
  return {
    rows: (json?.data ?? []) as PaymentReportRow[],
    summary: json?.summary ?? { count: 0, total: 0, employeeCount: 0 }
  }
}

/**
 * B2B KASA/BANKA KAYNAĞI (2026-09-27). Ödeme B2B'deki bir kasa ya da bankadan çıkar; o hesaba tek
 * "Personel Ödemesi" satırı yazılır (toplu ödemede toplam, personel adı yok). `kind`: 1 kasa, 2 banka.
 * `rate`: 1 döviz = kaç TL; boşsa sunucu TCMB döviz satış kurunu kullanır. TL hesapta yok sayılır.
 */
export type ErpPaymentSource = { kind: 1 | 2; accountId: number; rate?: number | null }

export type ErpAccountOption = {
  kind: 1 | 2
  id: number
  name: string
  currencyTypeId: number
  currencyCode: string
  /** TCMB döviz satış kuru; TCMB'ye ulaşılamadıysa null (ekran kuru elle ister). */
  rate: number | null
}

let erpAccountsCache: Promise<ErpAccountOption[]> | null = null

/** Kullanıcının B2B'de yetkili olduğu kasa ve bankalar. Sayfa ömrü boyunca bir kez çekilir. */
export function fetchErpAccounts(force = false): Promise<ErpAccountOption[]> {
  if (!erpAccountsCache || force) {
    erpAccountsCache = (async () => {
      const res = await fetch(`${API_BASE_URL}/api/EmployeePayments/erp-accounts`, { headers: buildAuthHeaders(false) })
      await handleUnauthorized(res)
      if (!res.ok) {
        const t = await res.text().catch(() => '')
        throw new Error(friendlyError(t, res.status, 'Kasa/banka listesi alınamadı'))
      }
      const json = await res.json().catch(() => null)
      return (json?.data ?? []) as ErpAccountOption[]
    })()
    erpAccountsCache.catch(() => { erpAccountsCache = null })
  }
  return erpAccountsCache
}

/**
 * ÖDEME DÜZENLEME: tutar / tarih / açıklama. B2B kasa/banka satırı aynı kurla güncellenir;
 * toplu ödemedeki bir kişinin tutarı değişirse B2B'deki toplam satır farkı kadar değişir.
 */
export async function updateEmployeePayment(
  id: number,
  payload: { amount: number; paymentDate?: string; description?: string; salaryPeriod?: string }
) {
  const res = await fetch(`${API_BASE_URL}/api/EmployeePayments/${encodeURIComponent(String(id))}`, {
    method: 'PUT',
    headers: buildAuthHeaders(true),
    body: JSON.stringify(payload)
  })
  await handleUnauthorized(res)
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'Ödeme düzenlenemedi'))
  }
  return await res.json().catch(() => null)
}

export async function createEmployeePayment(payload: {
  employeeId: number
  type: number
  amount: number
  paymentDate?: string
  description?: string
  deductFromSalary?: boolean
  /**
   * Ödemenin ait olduğu maaş dönemi "yyyy-MM". Ödeme TARİHİ ile dönem ayrı şeydir:
   * ağustos avansı 2 eylülde verilebilir. Boş bırakılırsa sunucu ödeme tarihinin ayını kullanır.
   */
  salaryPeriod?: string
  bankAccountDefinitionId?: number | null
  cashAccountId?: number | null
  erpSource?: ErpPaymentSource | null
}) {
  const res = await fetch(`${API_BASE_URL}/api/EmployeePayments`, {
    method: 'POST',
    headers: buildAuthHeaders(true),
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
  erpSource?: ErpPaymentSource | null
}) {
  const res = await fetch(`${API_BASE_URL}/api/EmployeePayments/bulk-meal`, {
    method: 'POST',
    headers: buildAuthHeaders(true),
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
  /** Maasin ait oldugu donem "yyyy-MM". Bos ise odeme tarihinin ayi kullanilir. */
  salaryPeriod?: string
  /** Ayni donem icin ikinci kez odeme yapilmasina izin verir (duzeltme senaryosu). */
  allowDuplicatePeriod?: boolean
  erpSource?: ErpPaymentSource | null
}) {
  const res = await fetch(`${API_BASE_URL}/api/EmployeePayments/bulk-salary`, {
    method: 'POST',
    headers: buildAuthHeaders(true),
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
    headers: buildAuthHeaders(false)
  })
  await handleUnauthorized(res)
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'Ödeme geri alınamadı'))
  }
  return await res.json().catch(() => null)
}

/**
 * Ödeme ekranının davranış ayarları.
 *
 * `accountMovementsEnabled` false ise kasa/banka bağlantısı pasiftir: ödeme kaynağı sorulmaz,
 * ödeme yalnızca personel servisinde "ödendi" olarak kaydedilir. Sunucuya ulaşılamazsa da
 * pasif kabul edilir — yanlışlıkla hesap hareketi yazdırmaktansa sormamak yeğdir.
 */
export async function fetchPaymentSettings(opts?: { signal?: AbortSignal }): Promise<{ accountMovementsEnabled: boolean }> {
  try {
    const res = await fetch(`${API_BASE_URL}/api/EmployeePayments/settings`, {
      headers: buildAuthHeaders(false),
      signal: opts?.signal
    })
    await handleUnauthorized(res)
    if (!res.ok) return { accountMovementsEnabled: false }
    const json = await res.json().catch(() => null)
    return { accountMovementsEnabled: Boolean(json?.data?.accountMovementsEnabled) }
  } catch {
    return { accountMovementsEnabled: false }
  }
}

export type SalaryStatusEmployeeDto = {
  employeeId: number
  employeeCode: string
  employeeName: string
  workplace?: string | null
  salaryDay: number
  /** Vade = dönemden sonraki maaş günü (yyyy-MM-dd). Bu gün geçince ödenmemiş maaş "Gecikti" olur. */
  dueDate?: string
  bankAccountNo?: string | null
  customerNo?: string | null
  iban?: string | null
  bankName?: string | null
  grossSalary: number
  /** O dönem için hakediş TANIMLANDI mı? False ise ekrandaki tutar yalnızca öneridir. */
  accrualDefined?: boolean
  /** Tanımlı hakediş kaydının kimliği — geri alma için. */
  accrualId?: number | null
  /** Dönemde bugüne kadar geçen beklenen çalışma dakikası. */
  elapsedMinutes?: number | null
  /** Dönemin toplam beklenen çalışma dakikası. */
  totalMinutes?: number | null
  /** Aylık maaş / dönemin beklenen dakikası. */
  minuteWage?: number | null
  /** Mesai kaydından gelen fiilen çalışılan dakika. */
  workedMinutes?: number | null
  attendedDays?: number | null
  periodStart?: string | null
  periodEnd?: string | null
  /** Tutarın neden düştüğünün satır satır dökümü: brüt → kesintiler → net → ödenen → kalan. */
  breakdown?: Array<{ key: string; label: string; amount: number; sign: string }>
  /** Aylık maaşın dönemin geçen kısmıyla orantılı KIST önerisi. */
  proratedSuggestion?: number | null
  earnedDays?: number | null
  daysInMonth?: number | null
  accrualAmount?: number | null
  accrualReferenceNo?: string | null
  accrualCalculated?: number | null
  hasSalaryOverride?: boolean
  salaryOverrideAmount?: number | null
  salaryOverrideDescription?: string | null
  advanceTotal: number
  netPayable: number
  paidAmount: number
  remainingAmount: number
  isPaid: boolean
  isPartial: boolean
  isDelayed: boolean
  /** accrualMissing = hakediş tanımsız (kırmızı), accrued = tanımlı (yeşil). */
  status: 'paid' | 'partial' | 'delayed' | 'pending' | 'accrualMissing' | 'accrued' | string
  lastPaidDate?: string | null
  advances: Array<{
    id: number
    amount: number
    description?: string | null
    paymentDate: string
    isDeducted: boolean
    referenceNo?: string | null
  }>
}

export type SalaryStatusReportDto = {
  period: string
  data: SalaryStatusEmployeeDto[]
  summary: {
    totalEmployees: number
    totalGross: number
    totalAdvances: number
    totalNetPayable: number
    totalPaid: number
    paidCount: number
    partialCount: number
    delayedCount: number
  }
}

export async function fetchSalaryStatus(period?: string, opts?: { signal?: AbortSignal }): Promise<SalaryStatusReportDto> {
  const qs = period ? `?period=${encodeURIComponent(period)}` : ''
  const res = await fetch(`${API_BASE_URL}/api/EmployeePayments/salary-status${qs}`, {
    headers: buildAuthHeaders(false),
    signal: opts?.signal
  })
  await handleUnauthorized(res)
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'Maaş durum listesi alınamadı'))
  }
  const json = await res.json().catch(() => null)
  return json as SalaryStatusReportDto
}

export type SalaryOverdueDto = {
  fromPeriod: string
  toPeriod: string
  data: {
    employeeId: number
    employeeName: string
    workplace?: string | null
    totalRemaining: number
    periods: { period: string; dueDate: string; netPayable: number; paid: number; remaining: number; accrualDefined: boolean }[]
  }[]
  /** Her personelin vadesi gelmiş SON döneminin durumu. */
  lastDue: {
    employeeId: number
    employeeName: string
    period: string
    dueDate: string
    netPayable: number
    paid: number
    remaining: number
    isPaid: boolean
  }[]
  summary: {
    overdueEmployeeCount: number
    overdueTotal: number
    lastDueNet: number
    lastDuePaid: number
    lastDueRemaining: number
    lastDuePaidCount: number
    lastDueUnpaidCount: number
  }
}

/**
 * Vadesi geçmiş, ödenmemiş maaşlar (son N dönem) — ana sayfanın kaynağı. İçinde bulunulan
 * dönemin vadesi her zaman sonraki ayda olduğu için yalnız bu aya bakmak gecikmeleri gizliyordu.
 */
export async function fetchSalaryOverdue(months = 6, opts?: { signal?: AbortSignal }): Promise<SalaryOverdueDto> {
  const res = await fetch(`${API_BASE_URL}/api/EmployeePayments/salary-overdue?months=${months}`, {
    headers: buildAuthHeaders(false),
    signal: opts?.signal
  })
  await handleUnauthorized(res)
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'Geciken maaşlar alınamadı'))
  }
  const json = await res.json().catch(() => null)
  return json as SalaryOverdueDto
}

export type CashTransactionItemDto = {
  id: number
  date: string
  direction: number
  amount: number
  referenceNo?: string | null
  description?: string | null
  counterpartyName?: string | null
  createUser?: string | null
  createTime?: string | null
  /** Toplu ödemenin üst kaydı mı? Kasa bakiyesine yalnızca üst kayıt + tekil hareket sayılır. */
  isBulk?: boolean
  paymentType?: number | null
  salaryPeriod?: string | null
  employeeId?: number | null
  /** B2B kasa/banka bağı (yalnız üst kayıtta). 1 kasa, 2 banka. */
  erpAccountKind?: number | null
  erpAccountName?: string | null
  erpCurrencyTypeId?: number | null
  erpRate?: number | null
  erpCurrencyAmount?: number | null
}

export async function fetchCashTransactions(params?: {
  cashAccountId?: number
  /** Dolu verilirse o toplu ödemenin personel kırılımı döner. */
  parentId?: number
  from?: string
  to?: string
  signal?: AbortSignal
}): Promise<{ cashAccountId: number; cashAccountName: string; data: CashTransactionItemDto[] }> {
  const qs = new URLSearchParams()
  if (params?.cashAccountId) qs.set('cashAccountId', String(params.cashAccountId))
  if (params?.parentId) qs.set('parentId', String(params.parentId))
  if (params?.from) qs.set('from', params.from)
  if (params?.to) qs.set('to', params.to)

  const res = await fetch(`${API_BASE_URL}/api/EmployeePayments/cash-transactions${qs.toString() ? `?${qs}` : ''}`, {
    headers: buildAuthHeaders(false),
    signal: params?.signal
  })
  await handleUnauthorized(res)
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'Kasa hareketleri alınamadı'))
  }
  const json = await res.json().catch(() => null)
  return {
    cashAccountId: Number(json?.cashAccountId ?? 0),
    cashAccountName: String(json?.cashAccountName ?? 'Personel Kasası'),
    data: (json?.data ?? []) as CashTransactionItemDto[]
  }
}

export type TypeStatusItemDto = {
  id: number
  amount: number
  description?: string | null
  paymentDate: string
  deductFromSalary: boolean
  isDeducted: boolean
  referenceNo?: string | null
}

export type TypeStatusEmployeeDto = {
  employeeId: number
  employeeCode?: string | null
  employeeName: string
  workplace?: string | null
  /** Dönemde bu türden verilen toplam. */
  periodTotal: number
  /** Avansta: maaştan düşülecek olarak işaretlenen toplam. */
  deductibleTotal: number
  /** Avansta: maaştan fiilen mahsup edilmiş toplam. */
  deductedTotal: number
  /** Avansta: mahsubu bekleyen (düşülecek - düşülmüş). */
  pendingDeductionTotal: number
  /** Primde: ödenmeyi bekleyen prim planı toplamı. */
  pendingPlanTotal: number
  lastDate?: string | null
  items: TypeStatusItemDto[]
}

export type TypeStatusReportDto = {
  success: boolean
  period: string
  type: number
  data: TypeStatusEmployeeDto[]
  summary: {
    totalEmployees: number
    totalAmount: number
    totalDeductible: number
    totalPendingDeduction: number
    totalPendingPlan: number
    receivedCount: number
  }
}

/** Avans (3) ve prim (2) ekranlarının personel listesi. */
export async function fetchTypeStatus(
  type: number,
  period?: string,
  opts?: { signal?: AbortSignal }
): Promise<TypeStatusReportDto> {
  const qs = new URLSearchParams({ type: String(type) })
  if (period) qs.set('period', period)

  const res = await fetch(`${API_BASE_URL}/api/EmployeePayments/type-status?${qs}`, {
    headers: buildAuthHeaders(false),
    signal: opts?.signal
  })
  await handleUnauthorized(res)
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'Liste alınamadı'))
  }
  const json = await res.json().catch(() => null)
  return json as TypeStatusReportDto
}

export type MealStatusEmployeeDto = {
  employeeId: number
  employeeCode?: string | null
  employeeName: string
  workplace?: string | null
  /** Çalışan kartındaki AYLIK yemek tutarı. Hakediş bundan dakika bazında oranlanır. */
  monthlyMealAmount: number
  elapsedMinutes?: number | null
  totalMinutes?: number | null
  attendedDays: number
  earnedWorkDays: number
  totalWorkDays: number
  mealAccrual: number
  proratedSuggestion: number
  /** Hakediş tanımlandı mı? False ise gösterilen tutar yalnızca öneridir. */
  accrualDefined: boolean
  planId?: number | null
  hasMealOverride: boolean
  mealOverrideAmount?: number | null
  paidAmount: number
  remainingAmount: number
  isPaid: boolean
  isPartial: boolean
  status: 'paid' | 'partial' | 'accrued' | 'accrualMissing' | 'waiting' | string
}

export type MealStatusReportDto = {
  success: boolean
  period: string
  data: MealStatusEmployeeDto[]
  summary: {
    totalEmployees: number
    totalAccrual: number
    totalPaid: number
    totalRemaining: number
    definedCount: number
    paidCount: number
  }
}

/** Yemek ekranının personel listesi — salary-status'ün karşılığı. */
export async function fetchMealStatus(period?: string, opts?: { signal?: AbortSignal }): Promise<MealStatusReportDto> {
  const qs = period ? `?period=${encodeURIComponent(period)}` : ''
  const res = await fetch(`${API_BASE_URL}/api/EmployeePayments/meal-status${qs}`, {
    headers: buildAuthHeaders(false),
    signal: opts?.signal
  })
  await handleUnauthorized(res)
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'Yemek listesi alınamadı'))
  }
  const json = await res.json().catch(() => null)
  return json as MealStatusReportDto
}
