import { API_BASE_URL } from '../config/api'

export type ProductWarrantyRegistration = {
  id: number
  productId: string
  productCode: string
  productName: string
  serialNumber: string
  customerFullName: string
  phoneNumber: string
  email?: string | null
  city?: string | null
  description?: string | null
  warrantyStartDate: string
  createUser: string
  createTime: string
}

export type CreateProductWarrantyRegistrationPayload = {
  productId: string
  serialNumber: string
  customerFullName: string
  phoneNumber: string
  email?: string
  city?: string
  description?: string
  warrantyStartDate?: string
}

function authHeaders(includeJson = false) {
  const token = localStorage.getItem('accessToken')
  return {
    ...(includeJson ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {})
  }
}

async function readError(res: Response, fallback: string) {
  const text = await res.text().catch(() => '')
  try {
    const json = JSON.parse(text)
    return String(json?.message ?? json?.error ?? fallback)
  } catch {
    return text
  }
}

export async function fetchProductWarrantyRegistrations(search?: string): Promise<ProductWarrantyRegistration[]> {
  const qs = new URLSearchParams()
  if (search?.trim()) qs.set('search', search.trim())

  const res = await fetch(`${API_BASE_URL}/api/product-warranty-registrations${qs.toString() ? `?${qs}` : ''}`, {
    headers: authHeaders()
  })
  if (!res.ok) throw new Error(await readError(res, `Garanti kayıtları alınamadı (${res.status})`))
  const json = await res.json()
  return (json?.data ?? []) as ProductWarrantyRegistration[]
}

export async function createProductWarrantyRegistration(
  payload: CreateProductWarrantyRegistrationPayload
): Promise<ProductWarrantyRegistration> {
  const res = await fetch(`${API_BASE_URL}/api/product-warranty-registrations`, {
    method: 'POST',
    headers: authHeaders(true),
    body: JSON.stringify(payload)
  })
  if (!res.ok) throw new Error(await readError(res, `Garanti kaydı oluşturulamadı (${res.status})`))
  const json = await res.json()
  return json?.data as ProductWarrantyRegistration
}

export type UpdateProductWarrantyRegistrationPayload = {
  productId?: string
  serialNumber: string
  customerFullName: string
  phoneNumber: string
  email?: string
  city?: string
  description?: string
}

export async function updateProductWarrantyRegistration(
  id: number,
  payload: UpdateProductWarrantyRegistrationPayload
): Promise<ProductWarrantyRegistration> {
  const res = await fetch(`${API_BASE_URL}/api/product-warranty-registrations/${id}`, {
    method: 'PUT',
    headers: authHeaders(true),
    body: JSON.stringify(payload)
  })
  if (!res.ok) throw new Error(await readError(res, `Garanti kaydı güncellenemedi (${res.status})`))
  const json = await res.json()
  return json?.data as ProductWarrantyRegistration
}

export async function deleteProductWarrantyRegistration(id: number): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/api/product-warranty-registrations/${id}`, {
    method: 'DELETE',
    headers: authHeaders()
  })
  if (!res.ok) throw new Error(await readError(res, `Garanti kaydı silinemedi (${res.status})`))
}
