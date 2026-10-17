import { API_BASE_URL } from '../config/api'
import { redirectToLogin } from '../auth/redirectToLogin'

export type SalesmanDropdownItem = {
  salesmanCode: string
  description: string
  discountRate?: number | null
}

function buildHeaders() {
  const headers: Record<string, string> = {}
  const token = localStorage.getItem('accessToken')
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
}

function getFriendlyError(text: string, status: number) {
  const t = String(text ?? '').trim()
  if (!t) return `Plasiyer listesi alınamadı (${status})`

  if (t.startsWith('{') || t.startsWith('[')) {
    try {
      const j = JSON.parse(t)
      const m = j?.message || j?.error || j?.title
      if (typeof m === 'string' && m.trim()) return m.trim()
    } catch {
      return `Plasiyer listesi alınamadı (${status})`
    }
  }

  return t
}

export async function fetchSalesmenDropdown(opts?: { signal?: AbortSignal; cariOnly?: boolean }): Promise<SalesmanDropdownItem[]> {
  // cariOnly narrows the list to the customer-facing salesman. The server applies the same
  // narrowing on its own for accounts tied to a single cari, so this is a hint for the
  // screen — not the thing that keeps the salesman list private.
  const query = opts?.cariOnly ? '?cariOnly=true' : ''
  const res = await fetch(`${API_BASE_URL}/api/salesmen/dropdown${query}`, { headers: buildHeaders(), signal: opts?.signal })

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

  const json = await res.json()
  return (json?.data ?? []) as SalesmanDropdownItem[]
}
