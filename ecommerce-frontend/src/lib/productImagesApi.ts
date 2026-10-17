import { readApiResponse } from './api'

export type ProductImagesDto = {
  imageUrl: string | null
  imageUrls: string[]
}

function normalizeImageUrl(u: any): string | null {
  if (typeof u !== 'string') return null
  const s = u.trim()
  if (!s) return null
  if (s.startsWith('http://') || s.startsWith('https://') || s.startsWith('/')) return s
  return `/${s}`
}

function normalizeImageUrls(list: any): string[] {
  const arr = Array.isArray(list) ? list : []
  const out: string[] = []
  for (const x of arr) {
    const n = normalizeImageUrl(x)
    if (n) out.push(n)
  }
  return out
}

export async function fetchAdminProductImages(
  authHeader: Record<string, string>,
  productId: string,
  productTenantCode: string,
): Promise<ProductImagesDto> {
  const res = await fetch(
    `/api/admin/products/${encodeURIComponent(productId)}/images?productTenantCode=${encodeURIComponent(productTenantCode)}`,
    { headers: { ...(authHeader ?? {}) } },
  )
  const json = await readApiResponse(res)
  if (!res.ok || json?.success === false) throw new Error(json?.message || 'Görseller alınamadı')
  return {
    imageUrl: normalizeImageUrl(json?.data?.imageUrl),
    imageUrls: normalizeImageUrls(json?.data?.imageUrls),
  }
}

export async function uploadAdminProductImage(
  authHeader: Record<string, string>,
  productId: string,
  productTenantCode: string,
  file: File,
): Promise<ProductImagesDto> {
  const fd = new FormData()
  fd.append('file', file)

  const res = await fetch(
    `/api/admin/products/${encodeURIComponent(productId)}/images?productTenantCode=${encodeURIComponent(productTenantCode)}`,
    {
      method: 'POST',
      headers: { ...(authHeader ?? {}) },
      body: fd,
    },
  )

  const json = await readApiResponse(res)
  if (!res.ok || json?.success === false) throw new Error(json?.message || 'Görsel yüklenemedi')
  return {
    imageUrl: normalizeImageUrl(json?.data?.imageUrl),
    imageUrls: normalizeImageUrls(json?.data?.imageUrls),
  }
}

export async function setAdminProductCoverImage(
  authHeader: Record<string, string>,
  productId: string,
  productTenantCode: string,
  imageUrl: string,
): Promise<ProductImagesDto> {
  const res = await fetch(`/api/admin/products/${encodeURIComponent(productId)}/images/cover`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...(authHeader ?? {}) },
    body: JSON.stringify({ productTenantCode, imageUrl }),
  })

  const json = await readApiResponse(res)
  if (!res.ok || json?.success === false) throw new Error(json?.message || 'Kapak seçilemedi')

  return {
    imageUrl: normalizeImageUrl(json?.data?.imageUrl),
    imageUrls: normalizeImageUrls(json?.data?.imageUrls),
  }
}

export async function addProductImageByUrl(
  authHeader: Record<string, string>,
  productId: string,
  productTenantCode: string,
  imageUrl: string,
): Promise<ProductImagesDto> {
  const res = await fetch(`/api/admin/products/${encodeURIComponent(productId)}/images/add-url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(authHeader ?? {}) },
    body: JSON.stringify({ productTenantCode, imageUrl }),
  })

  const json = await readApiResponse(res)
  if (!res.ok || json?.success === false) throw new Error(json?.message || 'Görsel eklenemedi')

  return {
    imageUrl: normalizeImageUrl(json?.data?.imageUrl),
    imageUrls: normalizeImageUrls(json?.data?.imageUrls),
  }
}

export async function removeProductImage(
  authHeader: Record<string, string>,
  productId: string,
  productTenantCode: string,
  imageUrl: string,
): Promise<ProductImagesDto> {
  const res = await fetch(
    `/api/admin/products/${encodeURIComponent(productId)}/images/remove-url?productTenantCode=${encodeURIComponent(
      productTenantCode
    )}&imageUrl=${encodeURIComponent(imageUrl)}`,
    {
      method: 'DELETE',
      headers: { ...(authHeader ?? {}) },
    }
  )

  const json = await readApiResponse(res)
  if (!res.ok || json?.success === false) throw new Error(json?.message || 'Görsel silinemedi')

  return {
    imageUrl: normalizeImageUrl(json?.data?.imageUrl),
    imageUrls: normalizeImageUrls(json?.data?.imageUrls),
  }
}

export async function reorderProductImages(
  authHeader: Record<string, string>,
  productId: string,
  productTenantCode: string,
  imageUrls: string[],
): Promise<ProductImagesDto> {
  const res = await fetch(`/api/admin/products/${encodeURIComponent(productId)}/images/reorder`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...(authHeader ?? {}) },
    body: JSON.stringify({ productTenantCode, imageUrls }),
  })

  const json = await readApiResponse(res)
  if (!res.ok || json?.success === false) throw new Error(json?.message || 'Görseller sıralanamadı')

  return {
    imageUrl: normalizeImageUrl(json?.data?.imageUrl),
    imageUrls: normalizeImageUrls(json?.data?.imageUrls),
  }
}

