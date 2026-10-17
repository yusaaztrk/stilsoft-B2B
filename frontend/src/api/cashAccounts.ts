import { API_BASE_URL, buildHeaders } from '../config/api'
import { redirectToLogin } from '../auth/redirectToLogin'

export type CashAccountDto = {
  id: number
  code: string
  name?: string | null
  lastCarryDate: string
  lastCarryAmount: number
  currencyTypeId: number
  balance: number
}

export type CreateCashAccountPayload = {
  code: string
  name?: string | null
  lastCarryDate?: string
  lastCarryAmount?: number
  currencyTypeId: number
}

export type UpdateCashAccountPayload = CreateCashAccountPayload

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

export async function fetchCashAccounts(opts?: { signal?: AbortSignal }): Promise<CashAccountDto[]> {
  const res = await request('/api/cashaccounts', { signal: opts?.signal })
  const json = await res.json()
  return (json?.data ?? []) as CashAccountDto[]
}

export async function createCashAccount(payload: CreateCashAccountPayload): Promise<{ message?: string; data?: { id: number } | null }> {
  const res = await request('/api/cashaccounts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
  const json = await res.json().catch(() => ({}))
  return { message: String(json?.message ?? ''), data: (json?.data ?? null) as any }
}

export async function updateCashAccount(id: number, payload: UpdateCashAccountPayload): Promise<{ message?: string }> {
  const res = await request(`/api/cashaccounts/${encodeURIComponent(String(id))}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
  const json = await res.json().catch(() => ({}))
  return { message: String(json?.message ?? '') }
}

export async function deleteCashAccount(id: number): Promise<{ message?: string }> {
  const res = await request(`/api/cashaccounts/${encodeURIComponent(String(id))}`, {
    method: 'DELETE'
  })
  const json = await res.json().catch(() => ({}))
  return { message: String(json?.message ?? '') }
}

export async function fetchCashAccountBalance(id: number, opts?: { signal?: AbortSignal }): Promise<{ cashAccountId: number; balance: number } | null> {
  const res = await request(`/api/cashaccounts/${encodeURIComponent(String(id))}/balance`, { signal: opts?.signal })
  const json = await res.json().catch(() => ({}))
  return (json?.data ?? null) as any
}

export type CashAccountReportListItemDto = {
  id: number
  code: string
  name?: string | null
  currencyTypeId: number
  inAmount: number
  outAmount: number
  balance: number
}

export async function fetchCashAccountReport(opts?: { signal?: AbortSignal }): Promise<CashAccountReportListItemDto[]> {
  const res = await request('/api/cashaccounts/report', { signal: opts?.signal })
  const json = await res.json().catch(() => ({}))
  return (json?.data ?? []) as CashAccountReportListItemDto[]
}

export type CurrencyBalanceDto = {
  currencyTypeId: number
  currencyCode: string
  balance: number
}

export type MultiCurrencyBalanceResponse = {
  cashAccountId: number
  balances: CurrencyBalanceDto[]
}

export async function fetchCashAccountBalanceByCurrency(id: number, opts?: { signal?: AbortSignal }): Promise<MultiCurrencyBalanceResponse | null> {
  const res = await request(`/api/cashaccounts/${encodeURIComponent(String(id))}/balance-by-currency`, { signal: opts?.signal })
  const json = await res.json().catch(() => ({}))
  return (json?.data ?? null) as any
}
