import { API_BASE_URL, buildHeaders } from '../config/api'
import { redirectToLogin } from '../auth/redirectToLogin'

/**
 * BANKA MASRAF HESAPLARI — her banka hesabının kendi masraf defteri.
 *
 * Kural: masraf, ait olduğu hesabın PARA BİRİMİNDEDİR. `gross`/`net`/`bsmv`/`vat` hep
 * hesabın parasında gelir; `tryAmount` yalnızca TL çapasıdır ve farklı para birimlerini
 * tek satırda toplamak istendiğinde kullanılır. İkisi karıştırılırsa dolar hesabın
 * 10 $ masrafı ile TL hesabın 10 ₺ masrafı aynı sütunda toplanır — eski ekranın hatası
 * tam olarak buydu.
 */

/** Sunucudaki <c>BankExpenseType</c> ile birebir aynı. */
export const BANK_EXPENSE_TYPE = {
  PosFee: 1,
  LoanUsageFee: 2,
  TransferFee: 3,
  AccountFee: 4,
  Other: 9
} as const

export type BankExpenseTypeValue = (typeof BANK_EXPENSE_TYPE)[keyof typeof BANK_EXPENSE_TYPE]

export type BankExpenseAccountDto = {
  id: number
  accountCode: string
  accountName: string
  accountNo: string
  bankName: string
  currencyTypeId: number
  currencyCode: string
}

/** Hesap × masraf türü × para birimi kırılımında toplam. */
export type BankExpenseBucketDto = {
  bankAccountDefinitionId: number
  expenseType: number
  expenseTypeName: string
  currencyTypeId: number
  currencyCode: string
  gross: number
  bsmv: number
  vat: number
  net: number
  tryAmount: number
  count: number
}

export type BankExpenseOverviewDto = {
  accounts: BankExpenseAccountDto[]
  buckets: BankExpenseBucketDto[]
  expenseTypes: { value: number; name: string }[]
}

export type BankExpenseRowDto = {
  id: number
  bankAccountDefinitionId: number
  bankAccountCode: string
  bankAccountName: string
  date: string
  expenseType: number
  expenseTypeName: string
  loanId?: number | null
  loanCode?: string | null
  currencyTypeId: number
  currencyCode: string
  currencyRate: number
  /** Brüt masraf, HESABIN para biriminde. */
  gross: number
  bsmvRate: number
  vatRate: number
  bsmv: number
  vat: number
  net: number
  /** TL karşılığı — yalnız genel toplam için. */
  tryAmount: number
  documentNo?: string | null
  description?: string | null
  counterpartyName?: string | null
  createUser: string
}

export type BankExpenseLoanDto = {
  id: number
  loanCode: string
  contractNo?: string | null
  bankAccountDefinitionId: number
  principalAmount: number
  currencyTypeId: number
}

export type CreateBankExpensePayload = {
  bankAccountDefinitionId: number
  date: string
  expenseType: number
  /** BRÜT masraf, HESABIN para biriminde (dolar hesaba 10 $ masraf → 10). */
  amount: number
  /** 1 hesap parası = X ₺. Boş bırakılırsa sunucu günün kurunu çeker; TL hesapta 1. */
  currencyRate?: number
  bsmvRate?: number
  vatRate?: number
  description?: string
  loanId?: number | null
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
      ...buildHeaders(),
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

function rangeParams(opts?: { startDate?: string | null; endDate?: string | null; expenseType?: number | null }) {
  const sp = new URLSearchParams()
  if (opts?.startDate) sp.set('startDate', opts.startDate)
  if (opts?.endDate) sp.set('endDate', opts.endDate)
  if (opts?.expenseType) sp.set('expenseType', String(opts.expenseType))
  return sp
}

export async function fetchBankExpenseOverview(opts?: {
  startDate?: string | null
  endDate?: string | null
  expenseType?: number | null
  signal?: AbortSignal
}): Promise<BankExpenseOverviewDto> {
  const sp = rangeParams(opts)
  const res = await request(`/api/bankexpenses/overview?${sp.toString()}`, { signal: opts?.signal })
  const json = await res.json().catch(() => ({}))
  const d = json?.data ?? {}
  return {
    accounts: (d?.accounts ?? []) as BankExpenseAccountDto[],
    buckets: (d?.buckets ?? []) as BankExpenseBucketDto[],
    expenseTypes: (d?.expenseTypes ?? []) as { value: number; name: string }[]
  }
}

export async function fetchBankExpenses(
  bankAccountDefinitionId: number | null,
  opts?: {
    startDate?: string | null
    endDate?: string | null
    expenseType?: number | null
    take?: number
    signal?: AbortSignal
  }
): Promise<BankExpenseRowDto[]> {
  const sp = rangeParams(opts)
  if (bankAccountDefinitionId && bankAccountDefinitionId > 0) {
    sp.set('bankAccountDefinitionId', String(bankAccountDefinitionId))
  }
  sp.set('take', String(Math.max(1, Math.min(2000, Number(opts?.take ?? 500)))))

  const res = await request(`/api/bankexpenses?${sp.toString()}`, { signal: opts?.signal })
  const json = await res.json().catch(() => ({}))
  return (json?.data ?? []) as BankExpenseRowDto[]
}

export async function fetchBankExpenseLoans(
  bankAccountDefinitionId?: number | null,
  opts?: { signal?: AbortSignal }
): Promise<BankExpenseLoanDto[]> {
  const sp = new URLSearchParams()
  if (bankAccountDefinitionId && bankAccountDefinitionId > 0) {
    sp.set('bankAccountDefinitionId', String(bankAccountDefinitionId))
  }
  const res = await request(`/api/bankexpenses/loans?${sp.toString()}`, { signal: opts?.signal })
  const json = await res.json().catch(() => ({}))
  return (json?.data ?? []) as BankExpenseLoanDto[]
}

export async function createBankExpense(payload: CreateBankExpensePayload): Promise<{ id: number } | null> {
  const res = await request('/api/bankexpenses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
  const json = await res.json().catch(() => ({}))
  return (json?.data ?? null) as { id: number } | null
}

export async function deleteBankExpense(id: number): Promise<void> {
  await request(`/api/bankexpenses/${encodeURIComponent(String(id))}`, { method: 'DELETE' })
}
