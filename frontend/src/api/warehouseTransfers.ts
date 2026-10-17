import { API_BASE_URL } from '../config/api'

function buildHeaders(includeAuth = true) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (includeAuth) {
    const token = localStorage.getItem('accessToken')
    if (token) headers.Authorization = `Bearer ${token}`
  }
  return headers
}

export type WarehouseTransferListItem = {
  id: number
  transferNo: string
  date: string
  description?: string | null
  deliveryAddress?: string | null
  fromWarehouseCode: number
  toWarehouseCode: number
  isConsignment: boolean
  lineCount: number
  createUser?: string
  /** Kalemler listede de doner: hangi urunden kac adet gittigi satirda gorunsun diye. */
  lines?: Array<{ stockCode: string; stockName?: string; quantity: number; lineNo: number }>
}

export type WarehouseTransferDetail = {
  id: number
  transferNo: string
  date: string
  description?: string | null
  deliveryAddress?: string | null
  fromWarehouseCode: number
  toWarehouseCode: number
  isConsignment: boolean
  lines: Array<{ id: number; stockCode: string; stockName?: string; quantity: number; lineNo: number }>
}

export type CreateWarehouseTransferPayload = {
  date?: string | null
  description?: string | null
  deliveryAddress?: string | null
  fromWarehouseCode: number
  toWarehouseCode: number
  isConsignment: boolean
  lines: Array<{ stockCode: string; quantity: number }>
}

export async function fetchWarehouseTransfers(params?: { take?: number; skip?: number }, options?: { signal?: AbortSignal }) {
  const take = params?.take ?? 200
  const skip = Math.max(0, Math.floor(params?.skip ?? 0))
  const url = `${API_BASE_URL}/api/warehouseTransfers?take=${encodeURIComponent(String(take))}&skip=${skip}`
  const res = await fetch(url, { headers: buildHeaders(true), signal: options?.signal })
  if (!res.ok) throw new Error(await res.text())
  const json = await res.json()
  return (json?.data ?? []) as WarehouseTransferListItem[]
}

export async function fetchWarehouseTransferDetail(id: number, options?: { signal?: AbortSignal }) {
  const res = await fetch(`${API_BASE_URL}/api/warehouseTransfers/${id}`, { headers: buildHeaders(true), signal: options?.signal })
  if (!res.ok) throw new Error(await res.text())
  const json = await res.json()
  return json?.data as WarehouseTransferDetail
}

export async function createWarehouseTransfer(payload: CreateWarehouseTransferPayload) {
  const res = await fetch(`${API_BASE_URL}/api/warehouseTransfers`, {
    method: 'POST',
    headers: buildHeaders(true),
    body: JSON.stringify(payload)
  })
  if (!res.ok) throw new Error(await res.text())
  const json = await res.json()
  return json?.data as { id: number; transferNo: string }
}

export async function deleteWarehouseTransfer(id: number) {
  const res = await fetch(`${API_BASE_URL}/api/warehouseTransfers/${id}`, {
    method: 'DELETE',
    headers: buildHeaders(true)
  })
  if (!res.ok) {
    // Sunucu `{ success, message }` döner; ham JSON yerine mesaj gösterilsin (silme kuralı uyarıları).
    const text = await res.text().catch(() => '')
    let message = text
    try {
      const j = JSON.parse(text)
      if (typeof j?.message === 'string' && j.message.trim()) message = j.message.trim()
    } catch {
      // metin JSON değil; olduğu gibi kalır
    }
    throw new Error(message || `Silinemedi (${res.status})`)
  }
  return true
}
