import { API_BASE_URL } from '../config/api'
import { redirectToLogin } from '../auth/redirectToLogin'

export type StockGroupDto = {
  id: number
  groupCode: string
  groupType: string
  description?: string | null
  b2bOrder: boolean
}

function buildHeaders(includeJson: boolean) {
  const headers: Record<string, string> = {}
  if (includeJson) headers['Content-Type'] = 'application/json'
  const token = localStorage.getItem('accessToken')
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
}

function getFriendlyError(text: string, status: number) {
  const t = String(text ?? '').trim()
  if (!t) return `Kategoriler alınamadı (${status})`

  if (t.startsWith('{') || t.startsWith('[')) {
    try {
      const j = JSON.parse(t)
      const errors = j?.errors
      if (errors && typeof errors === 'object') {
        const entries = Object.entries(errors as Record<string, unknown>)
        for (const [, v] of entries) {
          const arr = Array.isArray(v) ? v : [v]
          const msg = String(arr[0] ?? '').trim()
          if (msg) return msg
        }
      }
      const m = j?.message || j?.error || j?.title
      if (typeof m === 'string' && m.trim()) return m.trim()
    } catch {
      return `Kategoriler alınamadı (${status})`
    }
  }

  return t
}

export async function fetchStockGroups(
  opts?: { onlyB2BOrder?: boolean; timeoutMs?: number }
): Promise<StockGroupDto[]> {
  const onlyB2BOrder = opts?.onlyB2BOrder ?? true
  const timeoutMs = Math.max(1000, Math.floor(Number(opts?.timeoutMs ?? 8000)))

  const qs = new URLSearchParams({ onlyB2BOrder: onlyB2BOrder ? 'true' : 'false' }).toString()

  const controller = new AbortController()
  const t = window.setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(`${API_BASE_URL}/api/StockGroups?${qs}`, {
      headers: { ...buildHeaders(false) },
      signal: controller.signal
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
      throw new Error(getFriendlyError(text, res.status))
    }

    const json = (await res.json()) as any
    return (json?.data?.items ?? []) as StockGroupDto[]
  } catch (e: any) {
    if (String(e?.name ?? '') === 'AbortError') {
      throw new Error('Kategoriler alınamadı (timeout).')
    }
    throw e
  } finally {
    window.clearTimeout(t)
  }
}
