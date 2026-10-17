import { API_BASE_URL } from '../config/api'
import { redirectToLogin } from '../auth/redirectToLogin'

export type BankAccountTransactionDirection = 1 | 2 // 1: In (Borç), 2: Out (Alacak)
export type BankAccountTransactionCounterpartyType = 1 | 2 | 3 // 1: Customer, 2: Bank, 3: Supplier

export type BankAccountTransactionListItemDto = {
  id: number
  bankAccountDefinitionId: number
  bankAccountCode: string
  bankAccountName: string
  date: string
  direction: BankAccountTransactionDirection
  amount: number
  currencyTypeId?: number
  currencyRate: number
  currencyAmount: number
  counterpartyType: BankAccountTransactionCounterpartyType
  counterpartyCode: string
  counterpartyName: string
  documentNo?: string | null
  maturityDate?: string | null
  description?: string | null
  category?: string | null
  isPosFee: boolean
  /**
   * POS masrafının vergi kırılımı (denetim md. A4). `amount` BRÜT'tür; aşağıdakiler onun
   * içindeki bileşenlerdir, bakiyeye ayrıca eklenmez. Oranlar 0 = ayrıştırma yapılmamış
   * (eski kayıtlar böyle gelir).
   */
  posFeeBsmvRate?: number
  posFeeVatRate?: number
  posFeeBsmvAmount?: number
  posFeeVatAmount?: number
  posFeeNetAmount?: number
  createUser: string
}

export type CreateBankAccountTransactionPayload = {
  bankAccountDefinitionId: number
  date: string
  direction: BankAccountTransactionDirection
  amount: number
  currencyTypeId?: number
  currencyRate: number
  currencyAmount: number
  tenderCurrencyTypeId?: number
  tenderRate?: number
  tenderAmount?: number
  customerAccountCurrencyTypeId?: number
  counterpartyType: BankAccountTransactionCounterpartyType
  counterpartyCode: string
  counterpartyName?: string
  description?: string | null
  posFee: number
  posFeeDescription?: string
  /**
   * POS masrafı vergi oranları, yüzde olarak (5 = %5). Denetim md. A4.
   * İkisi de elle girilir; verilmezse ayrıştırma yapılmaz. `posFee` daima BRÜT'tür —
   * bu oranlar hesaptan düşen tutarı DEĞİŞTİRMEZ, yalnızca içindeki bileşeni açıklar.
   */
  posFeeBsmvRate?: number
  posFeeVatRate?: number

}

export type BankAccountBalanceDto = {
  bankAccountDefinitionId: number
  balance: number
  budget: number
  inAmount: number
  outAmount: number
}

export type BankCurrencyBalanceDto = {
  currencyTypeId: number
  currencyCode: string
  balance: number
}

export type BankMultiCurrencyBalanceDto = {
  bankAccountDefinitionId: number
  balances: BankCurrencyBalanceDto[]
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

export async function fetchBankAccountTransactions(
  bankAccountDefinitionId: number | null,
  opts?: {
    take?: number
    isPosFee?: boolean
    currencyTypeId?: number | null
    /** yyyy-MM-dd — verilirse süzgeç SUNUCUDA uygulanır (bkz. denetim md. 29). */
    startDate?: string | null
    endDate?: string | null
    signal?: AbortSignal
  }
): Promise<BankAccountTransactionListItemDto[]> {
  // Tek hesapta sunucu 100.000'e kadar izin veriyor (bkz. BankAccountTransactionsController.List).
  const take = Math.max(1, Math.min(100000, Number(opts?.take ?? 200)))
  const sp = new URLSearchParams({ take: String(take) })
  if (opts?.startDate) sp.set('startDate', opts.startDate)
  if (opts?.endDate) sp.set('endDate', opts.endDate)
  if (bankAccountDefinitionId) sp.set('bankAccountDefinitionId', String(bankAccountDefinitionId))
  if (typeof opts?.isPosFee === 'boolean') sp.set('isPosFee', String(opts.isPosFee))
  if (opts?.currencyTypeId !== null && opts?.currencyTypeId !== undefined) sp.set('currencyTypeId', String(opts.currencyTypeId))
  const qs = sp.toString()
  const res = await request(`/api/bankaccounttransactions?${qs}`, { signal: opts?.signal })
  const json = await res.json()
  return (json?.data ?? []) as BankAccountTransactionListItemDto[]
}

export async function fetchBankAccountBalance(bankAccountDefinitionId: number, opts?: { signal?: AbortSignal }): Promise<BankAccountBalanceDto> {
  const res = await request(`/api/bankaccounttransactions/${encodeURIComponent(String(bankAccountDefinitionId))}/balance`, { signal: opts?.signal })
  const json = await res.json()
  return (json?.data ?? null) as BankAccountBalanceDto
}

export async function fetchBankAccountBalanceByCurrency(
  bankAccountDefinitionId: number,
  opts?: { signal?: AbortSignal }
): Promise<BankMultiCurrencyBalanceDto> {
  const res = await request(`/api/bankaccounttransactions/${encodeURIComponent(String(bankAccountDefinitionId))}/balance-by-currency`, { signal: opts?.signal })
  const json = await res.json()
  return (json?.data ?? null) as BankMultiCurrencyBalanceDto
}

export async function createBankAccountTransaction(payload: CreateBankAccountTransactionPayload): Promise<{ message?: string; data?: { id: number } | null }> {
  const res = await request('/api/bankaccounttransactions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })

  const json = await res.json().catch(() => ({}))
  return { message: String(json?.message ?? ''), data: (json?.data ?? null) as any }
}

export async function deleteBankAccountTransaction(id: number): Promise<{ message?: string }> {
  const res = await request(`/api/bankaccounttransactions/${encodeURIComponent(String(id))}`, { method: 'DELETE' })
  const json = await res.json().catch(() => ({}))
  return { message: String(json?.message ?? '') }
}

export type LinkedInvoiceHeaderDto = {
  id: number
  faturaNo: string
  cariKodu: string
  faturaAcik?: string | null
  aciklama?: string | null
  tarih?: string
  genelToplam?: number
}

export type LinkedInvoiceLineDto = {
  id: number
  stockCode: string
  stockName: string
  description?: string | null
  vatRate: number
  quantity: number
  unitPrice: number
  total: number
}

export async function fetchLinkedInvoiceHeaderByBankTransactionId(id: number, opts?: { signal?: AbortSignal }): Promise<LinkedInvoiceHeaderDto> {
  const safeId = Number(id)
  if (!Number.isFinite(safeId) || safeId <= 0) throw new Error('Geçersiz id')
  const res = await request(`/api/bankaccounttransactions/${encodeURIComponent(String(safeId))}/invoice`, { signal: opts?.signal })
  const json = await res.json().catch(() => ({}))
  const d = json?.data ?? {}
  return {
    id: Number(d?.id ?? 0),
    faturaNo: String(d?.faturaNo ?? ''),
    cariKodu: String(d?.cariKodu ?? ''),
    faturaAcik: d?.faturaAcik ?? null,
    aciklama: d?.aciklama ?? null,
    tarih: String(d?.tarih ?? ''),
    genelToplam: Number(d?.genelToplam ?? 0)
  }
}

export async function fetchLinkedInvoiceLinesByBankTransactionId(id: number, opts?: { signal?: AbortSignal }): Promise<LinkedInvoiceLineDto[]> {
  const safeId = Number(id)
  if (!Number.isFinite(safeId) || safeId <= 0) throw new Error('Geçersiz id')
  const res = await request(`/api/bankaccounttransactions/${encodeURIComponent(String(safeId))}/invoice-lines`, { signal: opts?.signal })
  const json = await res.json().catch(() => ({}))
  const rows = (json?.data ?? []) as any[]
  return rows.map((x) => ({
    id: Number(x?.id ?? 0),
    stockCode: String(x?.stockCode ?? ''),
    stockName: String(x?.stockName ?? ''),
    description: x?.description ?? null,
    vatRate: Number(x?.vatRate ?? 0),
    quantity: Number(x?.quantity ?? 0),
    unitPrice: Number(x?.unitPrice ?? 0),
    total: Number(x?.total ?? 0)
  }))
}
