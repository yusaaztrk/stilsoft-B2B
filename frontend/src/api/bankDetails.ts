import { API_BASE_URL } from '../config/api'
import { redirectToLogin } from '../auth/redirectToLogin'

export type BankDetailDropdownDto = {
  id: number
  name: string
  bankCode: string
  isActive: boolean
}

export type CreateBankDetailRequestDto = {
  name: string
  bankCode: string
  isActive?: boolean
}

function getToken() {
  return localStorage.getItem('accessToken')
}

async function request(path: string, init?: { signal?: AbortSignal }) {
  const token = getToken()
  const res = await fetch(`${API_BASE_URL}${path}`, {
    signal: init?.signal,
    headers: {
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
    const t = String(text ?? '').trim()
    const err = new Error(t || `Banka listesi alınamadı (${res.status})`) as Error & { status?: number }
    err.status = res.status
    throw err
  }

  return res
}

export async function fetchBankDetailsDropdown(opts?: { includeInactive?: boolean; signal?: AbortSignal }): Promise<BankDetailDropdownDto[]> {
  const includeInactive = Boolean(opts?.includeInactive)
  const qs = new URLSearchParams({ includeInactive: String(includeInactive) }).toString()
  const res = await request(`/api/bankdetails/dropdown?${qs}`, { signal: opts?.signal })
  const json = await res.json()
  return (json?.data ?? []) as BankDetailDropdownDto[]
}

export async function createBankDetail(payload: CreateBankDetailRequestDto, opts?: { signal?: AbortSignal }): Promise<BankDetailDropdownDto> {
  const token = getToken()
  const res = await fetch(`${API_BASE_URL}/api/bankdetails`, {
    method: 'POST',
    signal: opts?.signal,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify({
      name: String(payload?.name ?? ''),
      bankCode: String(payload?.bankCode ?? ''),
      isActive: payload?.isActive !== false
    })
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
    const t = String(text ?? '').trim()
    const err = new Error(t || `Banka oluşturulamadı (${res.status})`) as Error & { status?: number }
    err.status = res.status
    throw err
  }

  const json = await res.json().catch(() => null)
  const data = json?.data ?? null
  return {
    id: Number(data?.id ?? 0),
    name: String(data?.name ?? ''),
    bankCode: String(data?.bankCode ?? ''),
    isActive: Boolean(data?.isActive ?? true)
  }
}

export async function deleteBankDetail(id: number, opts?: { signal?: AbortSignal }): Promise<{ message: string }> {
  const token = getToken()
  const res = await fetch(`${API_BASE_URL}/api/bankdetails/${id}`, {
    method: 'DELETE',
    signal: opts?.signal,
    headers: {
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
    const t = String(text ?? '').trim()

    // Prefer backend message if it's JSON, otherwise fallback to raw text
    let message = ''
    try {
      const parsed = JSON.parse(t)
      message = String((parsed as any)?.message ?? '')
    } catch {
      message = ''
    }

    const err = new Error(message || t || `Banka silinemedi (${res.status})`) as Error & { status?: number }
    err.status = res.status
    throw err
  }

  const json = await res.json().catch(() => null)
  return { message: String(json?.message ?? 'Banka silindi') }
}
