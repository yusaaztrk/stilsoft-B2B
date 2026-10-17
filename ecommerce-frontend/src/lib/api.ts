export type ErpProductListItem = {
  id: string
  tenantCode?: string
  name?: string
  stockCode?: string
  mainCategory?: string
  subCategory?: string
  imageUrl?: string
  imageUrls?: string[]
  unitPrice?: number
  currency?: string
  currencySymbol?: string
  description?: string
  features?: string[]
  isActive?: boolean
  stock?: number
  slug?: string
  brand?: string
  variants?: unknown
  reviewsCount?: number
  ratingAverage?: number
  isCampaign?: boolean
  showOnHome?: boolean
  relatedProducts?: ErpProductListItem[]
  technicalSpecs?: Record<string, string>
  warrantyMonths?: number
  manualPdfUrl?: string
  catalogPdfUrl?: string
  campaignBadge?: string
  originalPrice?: number
  discountedPrice?: number
  isFreeShipping?: boolean
}

export async function readApiResponse(res: Response): Promise<any> {
  const ct = res.headers.get('content-type') || ''
  if (ct.includes('application/json')) {
    return await res.json()
  }

  const text = await res.text()
  return { success: false, message: text }
}

function toProductDto(raw: any): ErpProductListItem | null {
  if (!raw || typeof raw !== 'object') return null
  const id = typeof raw.id === 'string' ? raw.id : null
  if (!id) return null

  const tenantCode = typeof raw.tenantCode === 'string' ? raw.tenantCode : undefined

  const currency = typeof raw.currency === 'string' ? raw.currency.trim() : ''
  const currencySymbol = currency.toUpperCase() === 'TL' ? '₺' : currency || '₺'

  const rawImageUrls = Array.isArray(raw.imageUrls)
    ? (raw.imageUrls.filter((x: any) => typeof x === 'string') as string[])
    : undefined

  // Build a unified image list: lead with imageUrl if present, then add extras
  const primaryImg = typeof raw.imageUrl === 'string' ? raw.imageUrl : undefined
  let imageUrls: string[] | undefined
  if (primaryImg || rawImageUrls?.length) {
    const all: string[] = []
    if (primaryImg) all.push(primaryImg)
    for (const u of rawImageUrls ?? []) {
      if (u !== primaryImg) all.push(u)
    }
    imageUrls = all.length > 0 ? all : undefined
  }

  return {
    id,
    tenantCode,
    name: typeof raw.name === 'string' ? raw.name : undefined,
    stockCode: typeof raw.stockCode === 'string' ? raw.stockCode : undefined,
    mainCategory: typeof raw.mainCategory === 'string' ? raw.mainCategory : typeof raw.groupCode === 'string' ? raw.groupCode : undefined,
    subCategory: typeof raw.subCategory === 'string' ? raw.subCategory : typeof raw.subGroupCode === 'string' ? raw.subGroupCode : undefined,
    imageUrl: primaryImg,
    imageUrls,
    unitPrice: typeof raw.unitPrice === 'number' ? raw.unitPrice : undefined,
    currency: currency || undefined,
    currencySymbol,
    description: typeof raw.description === 'string' ? raw.description : undefined,
    features: Array.isArray(raw.features) ? (raw.features.filter((x: any) => typeof x === 'string') as string[]) : undefined,
    isActive: typeof raw.isActive === 'boolean' ? raw.isActive : undefined,
    stock: typeof raw.stock === 'number' ? raw.stock : undefined,
    slug: typeof raw.slug === 'string' ? raw.slug : undefined,
    brand: typeof raw.brand === 'string' ? raw.brand : undefined,
    variants: raw.variants ?? undefined,
    reviewsCount: typeof raw.reviewsCount === 'number' ? raw.reviewsCount : 0,
    ratingAverage: typeof raw.ratingAverage === 'number' ? raw.ratingAverage : 0,
    isCampaign: typeof raw.isCampaign === 'boolean' ? raw.isCampaign : undefined,
    showOnHome: typeof raw.showOnHome === 'boolean' ? raw.showOnHome : undefined,
    relatedProducts: Array.isArray(raw.relatedProducts) ? extractProductsList(raw.relatedProducts) : undefined,
    technicalSpecs: raw.technicalSpecs ?? undefined,
    warrantyMonths: typeof raw.warrantyMonths === 'number' ? raw.warrantyMonths : undefined,
    manualPdfUrl: typeof raw.manualPdfUrl === 'string' ? raw.manualPdfUrl : undefined,
    catalogPdfUrl: typeof raw.catalogPdfUrl === 'string' ? raw.catalogPdfUrl : undefined,
    campaignBadge: typeof raw.campaignBadge === 'string' ? raw.campaignBadge : undefined,
    originalPrice: typeof raw.originalPrice === 'number' ? raw.originalPrice : undefined,
    discountedPrice: typeof raw.discountedPrice === 'number' ? raw.discountedPrice : undefined,
    isFreeShipping: typeof raw.isFreeShipping === 'boolean' ? raw.isFreeShipping : undefined,
  }
}

export function extractProductsList(json: any): ErpProductListItem[] {
  const candidates =
    Array.isArray(json?.data)
      ? json.data
      : Array.isArray(json?.data?.items)
        ? json.data.items
        : Array.isArray(json?.items)
          ? json.items
          : Array.isArray(json)
            ? json
            : []

  return candidates.map(toProductDto).filter(Boolean) as ErpProductListItem[]
}

export function extractProduct(json: any): ErpProductListItem | null {
  const raw = json?.data && typeof json?.data === 'object' ? json.data : json
  return toProductDto(raw)
}

export function getAdminToken(): string | null {
  return localStorage.getItem('ecom_admin_token')
}

export function getMemberToken(): string | null {
  return localStorage.getItem('ecom_member_token')
}

export function getTenantCode(): string | null {
  const t = String(localStorage.getItem('tenantCode') ?? '').trim()
  return t ? t : null
}
