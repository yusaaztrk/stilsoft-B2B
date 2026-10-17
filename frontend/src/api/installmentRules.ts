import { API_BASE_URL } from '../config/api'
import { redirectToLogin } from '../auth/redirectToLogin'

export type InstallmentRuleDto = {
  id: string
  bankName: string
  installmentText: string
  minAmountText: string
  descriptionText: string
  sortOrder: number
  isActive: boolean
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

        const errors = j?.errors
        if (errors && typeof errors === 'object') {
          const parts: string[] = []
          Object.entries(errors as Record<string, unknown>).forEach(([k, v]) => {
            const arr = Array.isArray(v) ? v : [v]
            arr.forEach((m) => {
              const msg = String(m ?? '').trim()
              if (msg) parts.push(`${k}: ${msg}`)
            })
          })
          if (parts.length) throw new Error(parts.join('\n'))
        }

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

export async function fetchInstallmentRules(opts?: { includeInactive?: boolean }): Promise<InstallmentRuleDto[]> {
  const includeInactive = Boolean(opts?.includeInactive)
  const qs = new URLSearchParams({ includeInactive: String(includeInactive) }).toString()
  const res = await request(`/api/installmentrules?${qs}`)
  const json = await res.json()
  return (json?.data ?? []) as InstallmentRuleDto[]
}

export async function createInstallmentRule(payload: {
  bankName: string
  installmentText: string
  minAmountText: string
  descriptionText: string
  sortOrder?: number
}) {
  const res = await request('/api/installmentrules', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
  return (await res.json().catch(() => null)) as any
}

export async function updateInstallmentRule(id: string, payload: {
  bankName: string
  installmentText: string
  minAmountText: string
  descriptionText: string
  sortOrder?: number
  isActive?: boolean
}) {
  const res = await request(`/api/installmentrules/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
  return (await res.json().catch(() => null)) as any
}

export async function deleteInstallmentRule(id: string) {
  await request(`/api/installmentrules/${id}`, { method: 'DELETE' })
}

export async function hardDeleteInstallmentRule(id: string) {
  await request(`/api/installmentrules/${id}/hard`, { method: 'DELETE' })
}
