import { API_BASE_URL } from '../config/api'
import { redirectToLogin } from '../auth/redirectToLogin'

export type CustomerLedgerReferenceType = 1 | 2 | 3 | 4 | 5

export type CustomerLedgerListItemDto = {
  id: number
  customerCode: string
  displayCustomerCode?: string
  sourceCustomerCode?: string
  transactionAccountType?: 'ACIK' | 'FATURA'
  customerName: string
  deliveryCustomerCode?: string | null
  deliveryCustomerName?: string | null
  date: string
  dueDate?: string | null
  documentNo?: string | null
  description?: string | null
  transactionType?: string | null
  debit: number
  credit: number
  currencyTypeId: number
  currencyRate: number
  currencyAmount: number
  /** Ödeme yapılan kasa/bankanın para birimi ID'si */
  paymentCurrencyTypeId: number
  /** Ödeme anındaki döviz kuru */
  paymentCurrencyRate: number
  /** Kasa/bankaya giren/çıkan birim miktar */
  paymentCurrencyAmount: number
  /** TL çapası üzerinden yürüyen bakiye (karışık dövizli caride tek başına anlamsızdır) */
  balance: number
  /** Satırın KENDİ para birimindeki yürüyen bakiye; cari ekstredeki kardeşiyle aynı */
  currencyBalance?: number
  referenceType: CustomerLedgerReferenceType
  referenceId?: number | null
  hasDetails: boolean
}

export type CustomerLedgerSummaryDto = {
  totalDebit: number
  totalCredit: number
  balance: number
}

export type CustomerLedgerListResponseDto = {
  customerCode: string
  customerName: string
  mail?: string | null
  phone?: string | null
  summary: CustomerLedgerSummaryDto
  openSummary?: CustomerLedgerSummaryDto
  invoiceSummary?: CustomerLedgerSummaryDto
  /** Para birimi başına borç/alacak/devir/bakiye — karışık dövizli caride tek doğru özet */
  currencyBalances?: Array<{
    currencyTypeId: number
    currencyCode: string
    currencySymbol: string
    totalDebit: number
    totalCredit: number
    opening: number
    balance: number
  }>
  items: CustomerLedgerListItemDto[]
}

export type CustomerLedgerDetailLineDto = {
  id: number
  stockCode: string
  stockName: string
  barcode?: string
  quantity: number
  unitPrice: number
  total: number
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

export async function fetchYonetimLedger(customerCode: string, opts?: { fromDate?: string; toDate?: string; accountType?: string; periodId?: number; signal?: AbortSignal }): Promise<CustomerLedgerListResponseDto> {
  const code = String(customerCode ?? '').trim()
  if (!code) return { customerCode: '', customerName: '', summary: { totalDebit: 0, totalCredit: 0, balance: 0 }, items: [] }

  const sp = new URLSearchParams({ customerCode: code })
  const fd = String(opts?.fromDate ?? '').trim()
  const td = String(opts?.toDate ?? '').trim()
  const at = String(opts?.accountType ?? '').trim()
  if (fd) sp.set('fromDate', fd)
  if (td) sp.set('toDate', td)
  if (at) sp.set('accountType', at)
  if (opts?.periodId && opts.periodId > 0) sp.set('periodId', opts.periodId.toString())

  const res = await request(`/api/yonetim-ledger?${sp.toString()}`, { signal: opts?.signal })
  const json = await res.json()
  return (json?.data ?? null) as CustomerLedgerListResponseDto
}

export async function fetchYonetimLedgerDetails(id: number, opts?: { signal?: AbortSignal }): Promise<CustomerLedgerDetailLineDto[]> {
  const res = await request(`/api/yonetim-ledger/${encodeURIComponent(String(id))}/details`, { signal: opts?.signal })
  const json = await res.json()
  return (json?.data ?? []) as CustomerLedgerDetailLineDto[]
}
