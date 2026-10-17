import { API_BASE_URL } from '../config/api'
import { redirectToLogin } from '../auth/redirectToLogin'

export type BinLookupInstallmentRuleDto = {
  id: string
  bankName: string
  installmentText: string
  minAmountText: string
  descriptionText: string
  sortOrder: number
  isActive: boolean
}

export type BinLookupBankDto = {
  id: string
  tcmbKodu: string
  name: string
  isActive: boolean
}

export type BinLookupResponseDto = {
  bank: null | BinLookupBankDto
  installmentBank: null | BinLookupBankDto
  installments: BinLookupInstallmentRuleDto[]
}

function getToken() {
  return localStorage.getItem('accessToken')
}

function buildHeaders(includeJson: boolean) {
  const headers: Record<string, string> = {}
  if (includeJson) headers['Content-Type'] = 'application/json'
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
}

async function request(path: string, init?: RequestInit) {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      ...buildHeaders(Boolean((init?.headers as any)?.['Content-Type'] || init?.body))
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
    const trimmed = String(text ?? '').trim()
    const fallback = `İşlem gerçekleştirilemedi (${res.status})`
    if (!trimmed) throw new Error(fallback)

    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        const j = JSON.parse(trimmed)
        const msg = j?.message || j?.error || j?.title
        if (typeof msg === 'string' && msg.trim()) throw new Error(msg.trim())
      } catch (e) {
        if (e instanceof Error && e.message.trim()) throw e
      }
    }

    throw new Error(trimmed || fallback)
  }

  return res
}

export async function fetchBinLookup(bin6: string, opts?: { signal?: AbortSignal }): Promise<BinLookupResponseDto> {
  const cleaned = String(bin6 ?? '').trim()
  const res = await request(`/api/bins/${encodeURIComponent(cleaned)}`, { signal: opts?.signal })
  const json = await res.json()
  return (json?.data ?? { bank: null, installmentBank: null, installments: [] }) as BinLookupResponseDto
}
