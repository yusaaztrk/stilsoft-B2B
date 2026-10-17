import { API_BASE_URL } from '../config/api'
import { redirectToLogin } from '../auth/redirectToLogin'

export type CustomerAuthorizedContactDto = {
  customerCode: string
  fullName: string
  phone?: string | null
}

function getToken() {
  return localStorage.getItem('accessToken')
}

async function request(path: string, init?: RequestInit & { signal?: AbortSignal }) {
  const token = getToken()
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
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
    const err = new Error(text || `İstek başarısız (${res.status})`) as Error & { status?: number }
    err.status = res.status
    throw err
  }

  return res
}

export async function fetchCustomerAuthorizedContact(customerCode: string, opts?: { signal?: AbortSignal }): Promise<CustomerAuthorizedContactDto> {
  const code = String(customerCode ?? '').trim()
  const res = await request(`/api/CustomerAuthorizedContacts/${encodeURIComponent(code)}`, {
    method: 'GET',
    signal: opts?.signal
  })
  const json = await res.json().catch(() => null)
  return (json?.data ?? null) as CustomerAuthorizedContactDto
}

export async function upsertCustomerAuthorizedContact(
  payload: CustomerAuthorizedContactDto,
  opts?: { signal?: AbortSignal }
): Promise<CustomerAuthorizedContactDto> {
  const res = await request(`/api/CustomerAuthorizedContacts`, {
    method: 'PUT',
    signal: opts?.signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
  const json = await res.json().catch(() => null)
  return (json?.data ?? null) as CustomerAuthorizedContactDto
}
