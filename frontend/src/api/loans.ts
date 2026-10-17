import { API_BASE_URL } from '../config/api'
import { redirectToLogin } from '../auth/redirectToLogin'

/**
 * Taksitli banka kredileri — BİZİM bankaya olan borcumuz.
 * Sanal POS'taki taksit kurallarıyla ilgisi yoktur (onlar müşterinin kredi kartı taksitleri).
 *
 * Para birimi kodları FİNANS tarafının kodlarıdır: 1=TRY, 2=EUR, 3=USD, 4=GBP.
 * Ürün tarafındaki kodlar farklı (orada USD=43) — karıştırılırsa kredi yanlış para biriminde görünür.
 */
export const LOAN_CURRENCIES = [
  { value: 1, code: 'TRY', label: 'TL' },
  { value: 3, code: 'USD', label: 'USD' },
  { value: 2, code: 'EUR', label: 'EUR' },
  { value: 4, code: 'GBP', label: 'GBP' }
] as const

/** 1 = Yıllık, 2 = Aylık. Hangisi olduğu kayıtta yazılı — tahmin edilirse plan 12 kat şaşar. */
export type LoanInterestRatePeriod = 1 | 2

/** 1 Aktif, 2 Kapandı, 3 İptal. Sunucuda HESAPLANIR, saklanmaz. */
export type LoanStatus = 1 | 2 | 3

/** 1 Bekliyor, 2 Kısmi, 3 Ödendi, 4 Gecikmiş. */
export type LoanInstallmentStatus = 1 | 2 | 3 | 4

export type LoanPaymentDto = {
  id: number
  loanInstallmentId: number
  installmentNo: number
  date: string
  amount: number
  currencyRate: number
  tryAmount: number
  bankAccountDefinitionId: number
  bankAccountName: string
  bankAccountTransactionId?: number | null
  description?: string | null
}

export type LoanInstallmentDto = {
  id: number
  installmentNo: number
  dueDate: string
  amount: number
  principalPart: number
  interestPart: number
  /** Faiz uzerinden alinan vergi; taksit tutarina DAHIL. */
  bsivPart: number
  /** faiz + BSIV — bankanin tablosunda tek yuk olarak gosterdigi tutar. */
  interestWithBsiv: number
  /** Bu satirin faiz+BSIV yukunun odenmis kismi (odeme once faize sayilir). */
  paidInterestWithBsiv: number
  paidAmount: number
  remainingAmount: number
  /** Taksit TAMAMEN kapandigi gun; kismi odemede null. */
  paidDate?: string | null
  lastPaymentDate?: string | null
  /** Pozitif = gec, negatif = erken. Odenmemis ve vadesi gecmisse bugune gore. */
  lateDays?: number | null
  /** Bu taksit odendikten sonra kalan anapara — bankanin "Bakiye" kolonu. */
  runningBalance: number
  status: LoanInstallmentStatus
  payments: LoanPaymentDto[]
}

export type LoanListItemDto = {
  id: number
  loanCode: string
  contractNo?: string | null
  bankAccountDefinitionId: number
  bankAccountName: string
  bankName: string
  principalAmount: number
  currencyTypeId: number
  currencyCode: string
  interestRate: number
  interestRatePeriod: LoanInterestRatePeriod
  installmentCount: number
  startDate: string
  firstInstallmentDate: string
  endDate?: string | null
  /** BSIV orani (faiz uzerinden yuzde). 0 = bu kredide BSIV yok. */
  bsivRate: number
  /** Elle girilen taksit tutari; 0 ise plan hesaplanarak uretilmis. */
  installmentAmount: number
  accountNo?: string | null
  iban?: string | null
  productName?: string | null
  customerCrmNo?: string | null
  planType?: string | null
  capitalizePeriod?: string | null
  fees: number
  description?: string | null
  totalPayable: number
  totalInterest: number
  totalBsiv: number
  paidBsiv: number
  paidAmount: number
  remainingAmount: number
  /** Kalan taksitlerin anapara kismi. */
  remainingPrincipal: number
  /** Odemelerin TL karsiliklarinin toplami — odeme anindaki kurdan DONDURULMUS. */
  paidTryAmount: number
  paidInstallmentCount: number
  overdueInstallmentCount: number
  overdueAmount: number
  nextDueDate?: string | null
  nextDueAmount: number
  paidInterest: number
  status: LoanStatus
  closedAt?: string | null
  cancelledAt?: string | null
}

export type LoanDetailDto = LoanListItemDto & {
  installments: LoanInstallmentDto[]
}

export type LoanSummaryDto = {
  currencyTypeId: number
  currencyCode: string
  totalRemaining: number
  dueThisMonth: number
  overdue: number
  paidInterest: number
  activeLoanCount: number
}

export type LoanScheduleMonthDto = {
  year: number
  month: number
  currencyTypeId: number
  currencyCode: string
  totalDue: number
  principalDue: number
  interestDue: number
  bsivDue: number
  paid: number
  remaining: number
  installmentCount: number
}

export type SaveLoanPayload = {
  loanCode?: string | null
  contractNo?: string | null
  bankAccountDefinitionId: number
  principalAmount: number
  currencyTypeId: number
  interestRate: number
  interestRatePeriod: LoanInterestRatePeriod
  installmentCount: number
  startDate: string
  firstInstallmentDate: string
  endDate?: string | null
  /** Faiz uzerinden yuzde. Varsayilan 3; BSIV almayan kredide 0. */
  bsivRate: number
  /** Bankanin belgesindeki taksit tutari. 0 = sistem hesaplasin. */
  installmentAmount: number
  accountNo?: string | null
  iban?: string | null
  productName?: string | null
  customerCrmNo?: string | null
  planType?: string | null
  capitalizePeriod?: string | null
  fees: number
  description?: string | null
  /** Yalnızca güncellemede: ödemesi olan kredide sunucu reddeder. */
  regenerateSchedule?: boolean
}

export type UpdateLoanInstallmentPayload = {
  dueDate: string
  amount: number
  principalPart: number
  interestPart: number
  bsivPart: number
}

export type CreateLoanPaymentPayload = {
  loanInstallmentId: number
  date: string
  /** 0 gönderilirse taksitin kalanı ödenir. */
  amount: number
  bankAccountDefinitionId?: number | null
  /** Döviz kredide TL kuru; 0 gönderilirse sunucu güncel kuru çeker. */
  currencyRate: number
  description?: string | null
}

function getToken() {
  return localStorage.getItem('accessToken')
}

function getFriendlyError(text: string, status: number) {
  const t = String(text ?? '').trim()
  if (!t) return `İşlem başarısız (${status})`

  if (t.startsWith('{') || t.startsWith('[')) {
    try {
      const j = JSON.parse(t)
      const m = j?.message || j?.error || j?.title
      if (typeof m === 'string' && m.trim()) return m.trim()
    } catch {
      return `İşlem başarısız (${status})`
    }
  }

  return t
}

async function request(path: string, init?: RequestInit & { signal?: AbortSignal }) {
  const token = getToken()
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    signal: init?.signal,
    headers: {
      ...(init?.headers ?? {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    }
  })

  if (!res.ok) {
    if (res.status === 401) {
      localStorage.removeItem('accessToken')
      localStorage.removeItem('refreshToken')
      localStorage.removeItem('userName')
      sessionStorage.removeItem('userName')
      if (typeof window !== 'undefined') redirectToLogin()
      throw new Error('Oturum süresi doldu. Lütfen tekrar giriş yapın.')
    }

    const text = await res.text().catch(() => '')
    const err = new Error(getFriendlyError(text, res.status)) as Error & { status?: number }
    err.status = res.status
    throw err
  }

  return res
}

export async function fetchLoans(params?: { status?: string }, opts?: { signal?: AbortSignal }): Promise<LoanListItemDto[]> {
  const qs = params?.status ? `?status=${encodeURIComponent(params.status)}` : ''
  const res = await request(`/api/loans${qs}`, { signal: opts?.signal })
  const json = await res.json()
  return (json?.data ?? []) as LoanListItemDto[]
}

export async function fetchLoanDetail(id: number, opts?: { signal?: AbortSignal }): Promise<LoanDetailDto | null> {
  const res = await request(`/api/loans/${encodeURIComponent(String(id))}`, { signal: opts?.signal })
  const json = await res.json()
  return (json?.data ?? null) as LoanDetailDto | null
}

export async function fetchLoanSummary(opts?: { signal?: AbortSignal }): Promise<LoanSummaryDto[]> {
  const res = await request('/api/loans/summary', { signal: opts?.signal })
  const json = await res.json()
  return (json?.data ?? []) as LoanSummaryDto[]
}

export async function fetchLoanSchedule(
  params?: { from?: string; to?: string },
  opts?: { signal?: AbortSignal }
): Promise<LoanScheduleMonthDto[]> {
  const search = new URLSearchParams()
  if (params?.from) search.set('from', params.from)
  if (params?.to) search.set('to', params.to)
  const qs = search.toString()

  const res = await request(`/api/loans/schedule${qs ? `?${qs}` : ''}`, { signal: opts?.signal })
  const json = await res.json()
  return (json?.data ?? []) as LoanScheduleMonthDto[]
}

export async function createLoan(payload: SaveLoanPayload): Promise<{ id: number; loanCode: string } | null> {
  const res = await request('/api/loans', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
  const json = await res.json().catch(() => ({}))
  return (json?.data ?? null) as { id: number; loanCode: string } | null
}

export async function updateLoan(id: number, payload: SaveLoanPayload): Promise<void> {
  await request(`/api/loans/${encodeURIComponent(String(id))}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
}

export async function updateLoanInstallment(
  loanId: number,
  installmentId: number,
  payload: UpdateLoanInstallmentPayload
): Promise<void> {
  await request(`/api/loans/${encodeURIComponent(String(loanId))}/installments/${encodeURIComponent(String(installmentId))}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
}

export async function createLoanPayment(loanId: number, payload: CreateLoanPaymentPayload): Promise<void> {
  await request(`/api/loans/${encodeURIComponent(String(loanId))}/payments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
}

/** Ödemeyi ve oluşturduğu banka hareketini birlikte siler. */
export async function deleteLoanPayment(paymentId: number): Promise<void> {
  await request(`/api/loans/payments/${encodeURIComponent(String(paymentId))}`, { method: 'DELETE' })
}

export async function closeLoan(id: number): Promise<void> {
  await request(`/api/loans/${encodeURIComponent(String(id))}/close`, { method: 'POST' })
}

export async function reopenLoan(id: number): Promise<void> {
  await request(`/api/loans/${encodeURIComponent(String(id))}/reopen`, { method: 'POST' })
}

export async function cancelLoan(id: number): Promise<void> {
  await request(`/api/loans/${encodeURIComponent(String(id))}/cancel`, { method: 'POST' })
}

export async function deleteLoan(id: number): Promise<void> {
  await request(`/api/loans/${encodeURIComponent(String(id))}`, { method: 'DELETE' })
}
