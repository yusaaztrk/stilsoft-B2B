import { API_BASE_URL } from '../config/api'
import { redirectToLogin } from '../auth/redirectToLogin'

export type SupplierLedgerEntryReferenceType = 1 | 2 | 3 | 4 // Manual, Invoice, BankTransaction, CashTransaction

export type SupplierLedgerListItemDto = {
  id: number
  supplierCode: string
  supplierName: string
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
  balance: number
  referenceType: SupplierLedgerEntryReferenceType
  referenceId?: number | null
  hasDetails: boolean
}

export type SupplierLedgerResponseDto = {
  supplierCode: string
  supplierName: string
  /** TL ÇAPASINDA tek toplam. Para birimleri karışır; ekranda tek başına kullanılmaz. */
  summary: { totalDebit: number; totalCredit: number; balance: number }
  /**
   * PARA BİRİMİ BAZINDA bakiye — ekranın gösterdiği asıl rakamlar bunlar.
   *
   * Sunucu bunu zaten döndürüyordu (`SupplierLedgerController.CurrencyBalances`) ama tipte
   * yoktu ve tedarikçi ekstresi okumuyordu; ekran karışık TL toplamına düşüyordu:
   * dolar borcu ile TL borcu tek rakamda toplanıp seçili para biriminin simgesiyle
   * etiketleniyordu. Mahsup YOK — dolar alacağı TL borcunu kapatmaz.
   */
  currencyBalances?: Array<{
    currencyTypeId: number
    currencyCode: string
    currencySymbol: string
    totalDebit: number
    totalCredit: number
    opening: number
    balance: number
  }>
  items: SupplierLedgerListItemDto[]
}

export type SupplierLedgerDetailLineDto = {
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

export async function fetchSupplierLedger(
  supplierCode: string,
  opts?: { fromDate?: string; toDate?: string; signal?: AbortSignal }
): Promise<SupplierLedgerResponseDto> {
  const sp = new URLSearchParams({ supplierCode: String(supplierCode ?? '').trim() })
  if (opts?.fromDate) sp.set('fromDate', opts.fromDate)
  if (opts?.toDate) sp.set('toDate', opts.toDate)

  const res = await request(`/api/supplier-ledger?${sp.toString()}`, { signal: opts?.signal })
  const json = await res.json()
  return (json?.data ?? null) as SupplierLedgerResponseDto
}

export async function fetchSupplierLedgerDetails(id: number, opts?: { signal?: AbortSignal }): Promise<SupplierLedgerDetailLineDto[]> {
  const res = await request(`/api/supplier-ledger/${encodeURIComponent(String(id))}/details`, { signal: opts?.signal })
  const json = await res.json()
  return (json?.data ?? []) as SupplierLedgerDetailLineDto[]
}
