import { API_BASE_URL } from '../config/api'
import { redirectToLogin } from '../auth/redirectToLogin'

export type CheckBranchDto = {
  id: number
  name: string
  isActive: boolean
  createdAt?: string
}

function getToken() {
  return localStorage.getItem('accessToken')
}

async function request(path: string, init?: RequestInit & { signal?: AbortSignal }) {
  const token = getToken()
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    }
  })

  if (!res.ok) {
    if (res.status === 401) {
      localStorage.removeItem('accessToken')
      localStorage.removeItem('refreshToken')
      if (typeof window !== 'undefined') redirectToLogin()
      throw new Error('Oturum süresi doldu.')
    }
    const text = await res.text().catch(() => '')
    let msg = `İşlem başarısız (${res.status})`
    try {
      const json = JSON.parse(text)
      if (json?.message) msg = json.message
    } catch {}
    throw new Error(msg)
  }

  return res
}

export async function fetchCheckBranches(opts?: { signal?: AbortSignal }): Promise<CheckBranchDto[]> {
  const res = await request('/api/CheckBranches', { signal: opts?.signal })
  const json = await res.json().catch(() => null)
  return json?.data ?? []
}

export async function fetchCheckBranchesDropdown(opts?: { signal?: AbortSignal }): Promise<{ id: number; name: string }[]> {
  const res = await request('/api/CheckBranches/dropdown', { signal: opts?.signal })
  const json = await res.json().catch(() => null)
  return json?.data ?? []
}

export async function createCheckBranch(payload: { name: string; isActive: boolean }): Promise<CheckBranchDto> {
  const res = await request('/api/CheckBranches', {
    method: 'POST',
    body: JSON.stringify(payload)
  })
  const json = await res.json().catch(() => null)
  return json?.data
}

export async function updateCheckBranch(id: number, payload: { name: string; isActive: boolean }): Promise<CheckBranchDto> {
  const res = await request(`/api/CheckBranches/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload)
  })
  const json = await res.json().catch(() => null)
  return json?.data
}

export async function deleteCheckBranch(id: number): Promise<void> {
  await request(`/api/CheckBranches/${id}`, {
    method: 'DELETE'
  })
}
