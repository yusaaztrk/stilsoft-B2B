import { API_BASE_URL } from '../config/api'

export type CustomerProductPriceOverrideDto = {
  id: string
  customerCode: string
  productId: string
  priceGroupId: string
  price: number
  currency: string
  isActive: boolean
}

function buildHeaders(includeJson: boolean) {
  const headers: Record<string, string> = {}
  if (includeJson) headers['Content-Type'] = 'application/json'
  const token = localStorage.getItem('accessToken')
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
}

export async function fetchCustomerProductPriceOverridesByCustomer(params: {
  customerCode: string
  productIds?: string[]
  priceGroupId?: string
  includeInactive?: boolean
}): Promise<CustomerProductPriceOverrideDto[]> {
  const customerCode = String(params.customerCode ?? '').trim()
  if (!customerCode) return []

  const sp = new URLSearchParams()
  sp.set('customerCode', customerCode)
  if (params.productIds && params.productIds.filter(Boolean).length > 0) {
    sp.set('productIds', params.productIds.filter(Boolean).join(','))
  }
  if (params.priceGroupId) {
    sp.set('priceGroupId', String(params.priceGroupId))
  }
  sp.set('includeInactive', params.includeInactive ? 'true' : 'false')

  const res = await fetch(`${API_BASE_URL}/api/customer-product-price-overrides/by-customer?${sp.toString()}`, {
    headers: { ...buildHeaders(false) }
  })
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(t || `Özel fiyatlar alınamadı (${res.status})`)
  }
  return (await res.json()) as CustomerProductPriceOverrideDto[]
}

export async function upsertCustomerProductPriceOverride(payload: {
  customerCode: string
  productId: string
  priceGroupId: string
  price: number
  currency: string
}): Promise<CustomerProductPriceOverrideDto> {
  const res = await fetch(`${API_BASE_URL}/api/customer-product-price-overrides/upsert`, {
    method: 'POST',
    headers: { ...buildHeaders(true) },
    body: JSON.stringify(payload)
  })
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(t || `Özel fiyat kaydedilemedi (${res.status})`)
  }
  return (await res.json()) as CustomerProductPriceOverrideDto
}

export async function deleteCustomerProductPriceOverride(id: string): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/api/customer-product-price-overrides/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { ...buildHeaders(false) }
  })
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(t || `Özel fiyat silinemedi (${res.status})`)
  }
}
