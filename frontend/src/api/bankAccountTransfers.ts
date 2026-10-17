import { API_BASE_URL } from '../config/api'
import { redirectToLogin } from '../auth/redirectToLogin'

export type CreateBankAccountTransferPayload = {
  sourceBankAccountDefinitionId: number
  targetBankAccountDefinitionId: number
  date: string
  amount: number
  description?: string | null
  sourceCurrencyRate?: number
  targetCurrencyRate?: number
  posFee?: number
  posFeeDescription?: string
  /**
   * POS masrafı vergi oranları, yüzde olarak (5 = %5). Denetim md. A4.
   * İkisi de elle girilir; verilmezse ayrıştırma yapılmaz. `posFee` daima BRÜT'tür —
   * bu oranlar hesaptan düşen tutarı DEĞİŞTİRMEZ, yalnızca içindeki bileşeni açıklar.
   */
  posFeeBsmvRate?: number
  posFeeVatRate?: number

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

export async function createBankAccountTransfer(payload: CreateBankAccountTransferPayload): Promise<{ data?: { outId: number; inId: number } | null }> {
  const res = await request('/api/bankaccounttransfers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
  const json = await res.json().catch(() => ({}))
  return { data: (json?.data ?? null) as any }
}
