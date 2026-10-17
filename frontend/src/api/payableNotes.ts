import { API_BASE_URL } from '../config/api'
import { redirectToLogin } from '../auth/redirectToLogin'
import { normalizePayableRow } from './checksShared'

export type PayableNoteStatus = 1 | 2 | 3 | 4 | 5 | 6

export type PayableNoteDto = {
  id: number
  scNo?: string | null
  documentNo: string
  customerCode?: string | null
  customerName?: string | null
  issueDate: string
  dueDate: string
  amount: number
  currencyTypeId: number
  noteNo?: string | null
  status: PayableNoteStatus
  bankAccountDefinitionId?: number | null
  bankAccountName?: string | null
  createUser?: string | null
}

export type CreatePayableNotePayload = {
  documentNo?: string
  customerCode: string
  issueDate: string
  dueDate: string
  amount: number
  currencyTypeId: number
  noteNo?: string | null
  bankAccountDefinitionId?: number | null
}

export type PayableActionPayload = {
  date: string
  bankAccountDefinitionId?: number | null
  description?: string | null
}

function getToken() {
  return localStorage.getItem('accessToken')
}

function getFriendlyError(text: string, status: number) {
  const t = String(text ?? '').trim()
  if (!t) return `Borç senedi işlemi başarısız (${status})`

  if (t.startsWith('{') || t.startsWith('[')) {
    try {
      const j = JSON.parse(t)
      if (j?.errors) {
        const parts: string[] = []
        if (j.detail) parts.push(j.detail)
        for (const [field, messages] of Object.entries(j.errors)) {
          const list = Array.isArray(messages) ? messages : [messages]
          for (const m of list) {
            if (m) parts.push(String(m))
          }
        }
        if (parts.length > 0) return parts.join('\n')
      }
      const m = j?.message || j?.error || j?.title
      if (typeof m === 'string' && m.trim()) return m.trim()
    } catch {
      return `Borç senedi işlemi başarısız (${status})`
    }
  }

  return t
}

async function request(path: string, init?: RequestInit) {
  const token = getToken()
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {})
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

export async function fetchPayableNotes(opts?: { take?: number; customerCode?: string }): Promise<PayableNoteDto[]> {
  const take = Math.max(1, Math.min(1000, Number(opts?.take ?? 200)))
  const sp = new URLSearchParams()
  sp.set('take', String(take))
  if (opts?.customerCode) sp.set('customerCode', opts.customerCode)
  const res = await request(`/api/PayableNotes?${sp.toString()}`)
  const json = await res.json()
  // `status` uçtan METİN geliyor; bkz. `checksShared.normalizePayableRow`.
  return ((json?.data ?? []) as any[]).map(normalizePayableRow) as PayableNoteDto[]
}

export async function createPayableNote(payload: CreatePayableNotePayload): Promise<{ id: number }> {
  const res = await request('/api/PayableNotes', { method: 'POST', body: JSON.stringify(payload) })
  const json = await res.json()
  const id = Number(json?.data?.id ?? 0)
  return { id }
}

export async function createPayableNotesBulk(payload: CreatePayableNotePayload[]): Promise<{ id: number }[]> {
  const res = await request('/api/PayableNotes/bulk', { method: 'POST', body: JSON.stringify(payload) })
  const json = await res.json()
  return (json?.data ?? []) as Array<{ id: number }>
}

export async function endorsePayableNoteToBank(id: number, payload: PayableActionPayload): Promise<void> {
  await request(`/api/PayableNotes/${encodeURIComponent(String(id))}/endorse-to-bank`, { method: 'POST', body: JSON.stringify(payload) })
}

export async function payPayableNote(id: number, payload: PayableActionPayload): Promise<void> {
  await request(`/api/PayableNotes/${encodeURIComponent(String(id))}/pay`, { method: 'POST', body: JSON.stringify(payload) })
}

export async function cancelPayableNote(id: number, payload: PayableActionPayload): Promise<void> {
  await request(`/api/PayableNotes/${encodeURIComponent(String(id))}/cancel`, { method: 'POST', body: JSON.stringify(payload) })
}

export async function revertPayableNoteToPending(id: number, payload: PayableActionPayload): Promise<void> {
  await request(`/api/PayableNotes/${encodeURIComponent(String(id))}/revert-to-pending`, { method: 'POST', body: JSON.stringify(payload) })
}

export async function returnPayableNote(id: number, payload: PayableActionPayload): Promise<void> {
  await request(`/api/PayableNotes/${encodeURIComponent(String(id))}/return`, { method: 'POST', body: JSON.stringify(payload) })
}

export async function dishonorPayableNote(id: number, payload: PayableActionPayload): Promise<void> {
  await request(`/api/PayableNotes/${encodeURIComponent(String(id))}/dishonor`, { method: 'POST', body: JSON.stringify(payload) })
}

export async function deletePayableNote(id: number): Promise<void> {
  await request(`/api/PayableNotes/${encodeURIComponent(String(id))}`, { method: 'DELETE' })
}

export async function updatePayableNote(id: number, payload: CreatePayableNotePayload): Promise<void> {
  await request(`/api/PayableNotes/${encodeURIComponent(String(id))}`, { method: 'PUT', body: JSON.stringify(payload) })
}

export async function unpayPayableNote(id: number): Promise<void> {
  await request(`/api/PayableNotes/${encodeURIComponent(String(id))}/unpay`, { method: 'POST' })
}
