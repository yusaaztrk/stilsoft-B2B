import { API_BASE_URL, buildHeaders } from '../config/api'
import { redirectToLogin } from '../auth/redirectToLogin'

export type BankAccountDefinitionDto = {
  id: number
  bankDetailId: number
  bankCode: string
  bankName: string
  accountCode: string
  accountName: string
  accountNo: string
  accountType: number
  currencyTypeId: number
  /** Açılış bakiyesi. Kolon adı tarihsel olarak `budget`; bakiye hesabının başlangıç tutarıdır. */
  budget: number
  /** Hesap kesim tarihi, 'yyyy-MM-dd' — yalnız kredi kartı hesaplarında dolu, diğerlerinde null. */
  statementDate: string | null
  createTime: string
  createUser: string
}

export type CreateBankAccountDefinitionPayload = {
  bankDetailId: number
  accountCode: string
  accountName: string
  accountNo: string
  accountType: number
  currencyTypeId: number
  budget: number
  statementDate?: string | null
}

export type UpdateBankAccountDefinitionPayload = CreateBankAccountDefinitionPayload

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

export async function fetchBankAccountDefinitions(opts?: { signal?: AbortSignal }): Promise<BankAccountDefinitionDto[]> {
  const res = await request('/api/bankaccountdefinitions', { signal: opts?.signal })
  const json = await res.json()
  return (json?.data ?? []) as BankAccountDefinitionDto[]
}

export async function createBankAccountDefinition(payload: CreateBankAccountDefinitionPayload): Promise<{ message?: string; data?: BankAccountDefinitionDto | null }> {
  const res = await request('/api/bankaccountdefinitions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
  const json = await res.json().catch(() => ({}))
  return { message: String(json?.message ?? ''), data: (json?.data ?? null) as any }
}

export async function updateBankAccountDefinition(id: number, payload: UpdateBankAccountDefinitionPayload): Promise<{ message?: string; data?: BankAccountDefinitionDto | null }> {
  const res = await request(`/api/bankaccountdefinitions/${encodeURIComponent(String(id))}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
  const json = await res.json().catch(() => ({}))
  return { message: String(json?.message ?? ''), data: (json?.data ?? null) as any }
}

export async function deleteBankAccountDefinition(id: number): Promise<{ message?: string }> {
  const res = await request(`/api/bankaccountdefinitions/${encodeURIComponent(String(id))}`, {
    method: 'DELETE'
  })
  const json = await res.json().catch(() => ({}))
  return { message: String(json?.message ?? '') }
}
