import { API_BASE_URL } from '../config/api'
import { redirectToLogin } from '../auth/redirectToLogin'

export type CashAccountTransactionDto = {
  id: number
  cashAccountId: number
  cashAccountCode: string
  cashAccountName?: string | null
  date: string
  direction: number
  referenceType?: number
  referenceId?: number | null
  amount: number
  currencyTypeId?: number
  currencyRate?: number
  currencyAmount?: number
  tenderCurrencyTypeId?: number
  tenderRate?: number
  tenderAmount?: number
  exchangeCode?: string | null
  counterpartyType?: number
  counterpartyCode: string
  counterpartyName: string
  description?: string | null
  createUser?: string
}

export type CreateCashAccountTransactionPayload = {
  cashAccountId: number
  date: string
  direction: number
  amount: number
  currencyTypeId?: number
  currencyRate?: number
  currencyAmount?: number
  // GELEN PARA (2026-08-17): musteri 1.000 DOLAR getirip TL kasaya yazdirabilir.
  // Gonderilmezse cevrim yoktur ve davranis eskisiyle ayni kalir.
  tenderCurrencyTypeId?: number
  tenderRate?: number
  tenderAmount?: number
  customerAccountCurrencyTypeId?: number
  counterpartyType: number
  counterpartyCode?: string
  counterpartyName?: string
  description?: string | null
}

export type UpdateCashAccountTransactionPayload = {
  date: string
  direction: number
  amount: number
  currencyTypeId?: number
  currencyRate?: number
  currencyAmount?: number
  tenderCurrencyTypeId?: number
  tenderRate?: number
  tenderAmount?: number
  customerAccountCurrencyTypeId?: number
  counterpartyType: number
  counterpartyCode: string
  counterpartyName: string
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

export async function fetchCashAccountTransactions(
  params?: { cashAccountId?: number | null; currencyTypeId?: number | null; take?: number },
  opts?: { signal?: AbortSignal }
): Promise<CashAccountTransactionDto[]> {
  const sp = new URLSearchParams()
  if (params?.cashAccountId) sp.set('cashAccountId', String(params.cashAccountId))
  if (params?.currencyTypeId !== null && params?.currencyTypeId !== undefined) sp.set('currencyTypeId', String(params.currencyTypeId))
  if (params?.take) sp.set('take', String(params.take))
  const qs = sp.toString()

  const res = await request(`/api/cashaccounttransactions${qs ? `?${qs}` : ''}`, { signal: opts?.signal })
  const json = await res.json()
  return (json?.data ?? []) as CashAccountTransactionDto[]
}

export async function createCashAccountTransaction(payload: CreateCashAccountTransactionPayload): Promise<{ message?: string; data?: { id: number } | null }> {
  const res = await request('/api/cashaccounttransactions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
  const json = await res.json().catch(() => ({}))
  return { message: String(json?.message ?? ''), data: (json?.data ?? null) as any }
}

export async function deleteCashAccountTransaction(id: number): Promise<{ message?: string }> {
  const res = await request(`/api/cashaccounttransactions/${encodeURIComponent(String(id))}`, {
    method: 'DELETE'
  })
  const json = await res.json().catch(() => ({}))
  return { message: String(json?.message ?? '') }
}

export async function updateCashAccountTransaction(id: number, payload: UpdateCashAccountTransactionPayload): Promise<{ message?: string }> {
  const res = await request(`/api/cashaccounttransactions/${encodeURIComponent(String(id))}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
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

export async function fetchLinkedInvoiceHeaderByCashTransactionId(id: number, opts?: { signal?: AbortSignal }): Promise<LinkedInvoiceHeaderDto> {
  const safeId = Number(id)
  if (!Number.isFinite(safeId) || safeId <= 0) throw new Error('Geçersiz id')
  const res = await request(`/api/cashaccounttransactions/${encodeURIComponent(String(safeId))}/invoice`, { signal: opts?.signal })
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

export async function fetchLinkedInvoiceLinesByCashTransactionId(id: number, opts?: { signal?: AbortSignal }): Promise<LinkedInvoiceLineDto[]> {
  const safeId = Number(id)
  if (!Number.isFinite(safeId) || safeId <= 0) throw new Error('Geçersiz id')
  const res = await request(`/api/cashaccounttransactions/${encodeURIComponent(String(safeId))}/invoice-lines`, { signal: opts?.signal })
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
