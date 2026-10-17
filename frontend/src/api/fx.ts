import { API_BASE_URL } from '../config/api'
import { redirectToLogin } from '../auth/redirectToLogin'

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

export async function fetchLatestFxRate(currencyCode: string, opts?: { signal?: AbortSignal }): Promise<number> {
  const code = String(currencyCode ?? '').trim().toUpperCase()
  if (!code) throw new Error('Para birimi zorunludur')
  if (code === 'TRY' || code === 'TL') return 1

  const sp = new URLSearchParams({ currencyCode: code })
  const res = await request(`/api/fx/latest?${sp.toString()}`, { signal: opts?.signal })
  const json = await res.json().catch(() => ({}))
  const rawRate = json?.data?.rate ?? json?.data?.Rate ?? json?.rate ?? json?.Rate ?? 0
  const rate = typeof rawRate === 'string'
    ? Number(rawRate.replace(',', '.'))
    : Number(rawRate)
  if (!Number.isFinite(rate) || !(rate > 0)) throw new Error('Kur bilgisi alınamadı')
  return rate
}

export async function fetchCrossFxRate(sourceCurrency: string, targetCurrency: string, opts?: { signal?: AbortSignal }): Promise<number> {
  const src = (sourceCurrency ?? 'TRY').trim().toUpperCase()
  const tgt = (targetCurrency ?? 'TRY').trim().toUpperCase()
  const normSrc = (src === 'TL' || !src) ? 'TRY' : src
  const normTgt = (tgt === 'TL' || !tgt) ? 'TRY' : tgt

  if (normSrc === normTgt) return 1

  const sp = new URLSearchParams({ source: normSrc, target: normTgt })
  const res = await request(`/api/fx/cross-rate?${sp.toString()}`, { signal: opts?.signal })
  const json = await res.json().catch(() => ({}))
  const crossRate = Number(json?.data?.crossRate ?? 0)
  if (!(crossRate > 0)) throw new Error('Çapraz kur bilgisi alınamadı')
  return crossRate
}
