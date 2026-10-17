import { API_BASE_URL } from '../config/api'
import { redirectToLogin } from '../auth/redirectToLogin'

export type CashAccountTransferDto = {
  id: number
  sourceCashAccountId: number
  targetCashAccountId: number
  date: string
  amount: number
  selectedCashAccountId?: number | null
  selectedDirection?: number | null
  selectedTryAmount?: number | null
  selectedCurrencyTypeId?: number | null
  selectedCurrencyRate?: number | null
  selectedCurrencyAmount?: number | null
  description?: string | null
  createUser?: string
}

export type CreateCashAccountTransferPayload = {
  sourceCashAccountId: number
  targetCashAccountId: number
  date: string
  amount: number
  description?: string | null
  sourceCurrencyRate?: number
  targetCurrencyRate?: number
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

export async function fetchCashAccountTransfers(params?: { take?: number; skip?: number; cashAccountId?: number }, opts?: { signal?: AbortSignal }): Promise<CashAccountTransferDto[]> {
  const take = params?.take ? String(params.take) : ''
  const skip = params?.skip && params.skip > 0 ? String(Math.floor(params.skip)) : ''
  const cashAccountId = (params as any)?.cashAccountId != null ? String((params as any).cashAccountId) : ''

  const qsParts: string[] = []
  if (take) qsParts.push(`take=${encodeURIComponent(take)}`)
  if (cashAccountId) qsParts.push(`cashAccountId=${encodeURIComponent(cashAccountId)}`)
  if (skip) qsParts.push(`skip=${encodeURIComponent(skip)}`)
  const qs = qsParts.length ? `?${qsParts.join('&')}` : ''
  const res = await request(`/api/cashaccounttransfers${qs}`, { signal: opts?.signal })
  const json = await res.json()
  return (json?.data ?? []) as CashAccountTransferDto[]
}

export async function createCashAccountTransfer(payload: CreateCashAccountTransferPayload): Promise<{ message?: string; data?: { id: number } | null }> {
  const res = await request('/api/cashaccounttransfers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
  const json = await res.json().catch(() => ({}))
  return { message: String(json?.message ?? ''), data: (json?.data ?? null) as any }
}

export async function deleteCashAccountTransfer(id: number): Promise<{ message?: string }> {
  const res = await request(`/api/cashaccounttransfers/${encodeURIComponent(String(id))}`, {
    method: 'DELETE'
  })
  const json = await res.json().catch(() => ({}))
  return { message: String(json?.message ?? '') }
}
