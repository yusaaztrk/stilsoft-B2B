import { readApiResponse } from './api'

export type CategoryDto = {
  id: string
  parentId: string | null
  name: string
  slug: string
  imageUrl?: string
  showInHeader?: boolean
  showInFooter?: boolean
  sortOrder: number
  productCount?: number
}

export async function fetchStorefrontCategories(): Promise<CategoryDto[]> {
  const res = await fetch('/api/storefront/categories')
  const json = await readApiResponse(res)
  if (!res.ok || !json?.success) throw new Error(json?.message || 'Kategoriler alınamadı')
  return Array.isArray(json?.data) ? (json.data as CategoryDto[]) : []
}

export async function fetchAdminCategories(authHeader: Record<string, string>): Promise<CategoryDto[]> {
  const res = await fetch('/api/admin/categories', { headers: { ...(authHeader ?? {}) } })
  const json = await readApiResponse(res)
  if (!res.ok || !json?.success) throw new Error(json?.message || 'Kategoriler alınamadı')
  return Array.isArray(json?.data) ? (json.data as CategoryDto[]) : []
}

export type UpsertCategoryPayload = {
  id?: string
  parentId?: string | null
  name: string
  slug?: string
  imageUrl?: string
  showInHeader?: boolean
  showInFooter?: boolean
  sortOrder: number
  isActive: boolean
}

export async function upsertAdminCategory(authHeader: Record<string, string>, payload: UpsertCategoryPayload): Promise<string> {
  const res = await fetch('/api/admin/categories', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(authHeader ?? {}) },
    body: JSON.stringify(payload),
  })

  const json = await readApiResponse(res)
  if (!res.ok || !json?.success) throw new Error(json?.message || 'Kaydedilemedi')
  const id = typeof json?.data?.id === 'string' ? json.data.id : null
  if (!id) throw new Error('Kategori ID alınamadı')
  return id
}

export async function uploadAdminCategoryImage(authHeader: Record<string, string>, categoryId: string, file: File): Promise<string> {
  const fd = new FormData()
  fd.append('file', file)

  const res = await fetch(`/api/admin/categories/${encodeURIComponent(categoryId)}/image`, {
    method: 'POST',
    headers: { ...(authHeader ?? {}) },
    body: fd,
  })

  const json = await readApiResponse(res)
  if (!res.ok || !json?.success) throw new Error(json?.message || 'Görsel yüklenemedi')
  const url = typeof json?.data?.imageUrl === 'string' ? json.data.imageUrl : null
  if (!url) throw new Error('Görsel URL alınamadı')
  return url
}

export async function setProductPrimaryCategory(
  authHeader: Record<string, string>,
  productId: string,
  productTenantCode: string,
  categoryId: string,
): Promise<void> {
  const res = await fetch(`/api/admin/products/${productId}/primary-category`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...(authHeader ?? {}) },
    body: JSON.stringify({ productTenantCode, categoryId }),
  })

  const json = await readApiResponse(res)
  if (!res.ok || !json?.success) throw new Error(json?.message || 'Kaydedilemedi')
}

export type ProductCategoryMapDto = {
  categoryId: string
  isPrimary: boolean
  sortOrder: number
}

export async function fetchProductCategories(
  authHeader: Record<string, string>,
  productId: string,
  productTenantCode: string,
): Promise<ProductCategoryMapDto[]> {
  const res = await fetch(
    `/api/admin/products/${productId}/categories?productTenantCode=${encodeURIComponent(productTenantCode)}`,
    {
      headers: { ...(authHeader ?? {}) },
    },
  )
  const json = await readApiResponse(res)
  if (!res.ok || !json?.success) throw new Error(json?.message || 'Ürün kategorileri alınamadı')
  return Array.isArray(json?.data) ? (json.data as ProductCategoryMapDto[]) : []
}

export async function addProductCategory(
  authHeader: Record<string, string>,
  productId: string,
  productTenantCode: string,
  categoryId: string,
  isPrimary: boolean,
): Promise<void> {
  const res = await fetch(`/api/admin/products/${productId}/categories`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(authHeader ?? {}) },
    body: JSON.stringify({ productTenantCode, categoryId, isPrimary, sortOrder: 0 }),
  })

  const json = await readApiResponse(res)
  if (!res.ok || !json?.success) throw new Error(json?.message || 'Kaydedilemedi')
}

export async function removeProductCategory(
  authHeader: Record<string, string>,
  productId: string,
  productTenantCode: string,
  categoryId: string,
): Promise<void> {
  const res = await fetch(
    `/api/admin/products/${productId}/categories/${categoryId}?productTenantCode=${encodeURIComponent(productTenantCode)}`,
    {
      method: 'DELETE',
      headers: { ...(authHeader ?? {}) },
    },
  )

  const json = await readApiResponse(res)
  if (!res.ok || !json?.success) throw new Error(json?.message || 'Kaydedilemedi')
}
