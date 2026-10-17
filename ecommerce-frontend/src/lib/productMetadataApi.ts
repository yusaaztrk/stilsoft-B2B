import { readApiResponse } from './api'

export type ProductMetadataDto = {
  description: string | null
  features: string[]
  variantsJson?: string | null
  slug?: string | null
  brand?: string | null
  shortDescription?: string | null
  technicalSpecsJson?: string | null
  manualPdfUrl?: string | null
  catalogPdfUrl?: string | null
  seoTitle?: string | null
  seoDescription?: string | null
  labelsJson?: string | null
  showOnHome?: boolean
  isCampaign?: boolean
  status?: string
  descriptionEn?: string | null
  featuresEn?: string[]
  shortDescriptionEn?: string | null
  technicalSpecsEnJson?: string | null
  seoTitleEn?: string | null
  seoDescriptionEn?: string | null
  relatedProductIds?: string[] | null
  warrantyMonths?: number
  isFreeShipping?: boolean
}

export async function fetchAdminProductMetadata(
  authHeader: Record<string, string>,
  productId: string,
  productTenantCode: string,
): Promise<ProductMetadataDto> {
  const res = await fetch(
    `/api/admin/products/${productId}/metadata?productTenantCode=${encodeURIComponent(productTenantCode)}`,
    {
      headers: { ...(authHeader ?? {}) },
    },
  )
  const json = await readApiResponse(res)
  if (!res.ok || !json?.success) throw new Error(json?.message || 'Ürün detayları alınamadı')
  const d = json?.data ?? {}
  return {
    description: typeof d.description === 'string' ? d.description : null,
    features: Array.isArray(d.features) ? (d.features.filter((x: any) => typeof x === 'string') as string[]) : [],
    variantsJson: typeof d.variantsJson === 'string' ? d.variantsJson : null,
    slug: d.slug || null,
    brand: d.brand || null,
    shortDescription: d.shortDescription || null,
    technicalSpecsJson: d.technicalSpecsJson || null,
    manualPdfUrl: d.manualPdfUrl || null,
    catalogPdfUrl: d.catalogPdfUrl || null,
    seoTitle: d.seoTitle || null,
    seoDescription: d.seoDescription || null,
    labelsJson: d.labelsJson || null,
    showOnHome: !!d.showOnHome,
    isCampaign: !!d.isCampaign,
    status: d.status || 'Draft',
    descriptionEn: d.descriptionEn || null,
    featuresEn: Array.isArray(d.featuresEn) ? (d.featuresEn.filter((x: any) => typeof x === 'string') as string[]) : [],
    shortDescriptionEn: d.shortDescriptionEn || null,
    technicalSpecsEnJson: d.technicalSpecsEnJson || null,
    seoTitleEn: d.seoTitleEn || null,
    seoDescriptionEn: d.seoDescriptionEn || null,
    relatedProductIds: Array.isArray(d.relatedProductIds) ? d.relatedProductIds : [],
    warrantyMonths: typeof d.warrantyMonths === 'number' ? d.warrantyMonths : 0,
    isFreeShipping: !!d.isFreeShipping,
  }
}

export async function upsertAdminProductMetadata(
  authHeader: Record<string, string>,
  productId: string,
  productTenantCode: string,
  payload: ProductMetadataDto,
): Promise<void> {
  const res = await fetch(`/api/admin/products/${productId}/metadata`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...(authHeader ?? {}) },
    body: JSON.stringify({
      productTenantCode,
      description: payload.description,
      features: payload.features,
      variantsJson: payload.variantsJson,
      slug: payload.slug,
      brand: payload.brand,
      shortDescription: payload.shortDescription,
      technicalSpecsJson: payload.technicalSpecsJson,
      manualPdfUrl: payload.manualPdfUrl,
      catalogPdfUrl: payload.catalogPdfUrl,
      seoTitle: payload.seoTitle,
      seoDescription: payload.seoDescription,
      labelsJson: payload.labelsJson,
      showOnHome: payload.showOnHome,
      isCampaign: payload.isCampaign,
      status: payload.status,
      descriptionEn: payload.descriptionEn,
      featuresEn: payload.featuresEn,
      shortDescriptionEn: payload.shortDescriptionEn,
      technicalSpecsEnJson: payload.technicalSpecsEnJson,
      seoTitleEn: payload.seoTitleEn,
      seoDescriptionEn: payload.seoDescriptionEn,
      relatedProductIds: payload.relatedProductIds,
      warrantyMonths: payload.warrantyMonths || 0,
      isFreeShipping: payload.isFreeShipping,
    }),
  })
  const json = await readApiResponse(res)
  if (!res.ok || !json?.success) throw new Error(json?.message || 'Kaydedilemedi')
}

export async function fetchAllAdminProductMetadata(
  authHeader: Record<string, string>,
): Promise<Array<ProductMetadataDto & { productId: string; productTenantCode: string }>> {
  const res = await fetch('/api/admin/products/metadata', {
    headers: { ...(authHeader ?? {}) },
  })
  const json = await readApiResponse(res)
  if (!res.ok || !json?.success) throw new Error(json?.message || 'Ürün metadataları alınamadı')
  return (json?.data ?? []).map((d: any) => ({
    productId: d.productId,
    productTenantCode: d.productTenantCode,
    description: d.description || null,
    features: Array.isArray(d.features) ? d.features : [],
    variantsJson: d.variantsJson || null,
    slug: d.slug || null,
    brand: d.brand || null,
    shortDescription: d.shortDescription || null,
    technicalSpecsJson: d.technicalSpecsJson || null,
    manualPdfUrl: d.manualPdfUrl || null,
    catalogPdfUrl: d.catalogPdfUrl || null,
    seoTitle: d.seoTitle || null,
    seoDescription: d.seoDescription || null,
    labelsJson: d.labelsJson || null,
    showOnHome: !!d.showOnHome,
    isCampaign: !!d.isCampaign,
    status: d.status || 'Draft',
    descriptionEn: d.descriptionEn || null,
    featuresEn: Array.isArray(d.featuresEn) ? d.featuresEn : [],
    shortDescriptionEn: d.shortDescriptionEn || null,
    technicalSpecsEnJson: d.technicalSpecsEnJson || null,
    seoTitleEn: d.seoTitleEn || null,
    seoDescriptionEn: d.seoDescriptionEn || null,
    relatedProductIds: Array.isArray(d.relatedProductIds) ? d.relatedProductIds : [],
    warrantyMonths: typeof d.warrantyMonths === 'number' ? d.warrantyMonths : 0,
    isFreeShipping: !!d.isFreeShipping,
  }))
}



