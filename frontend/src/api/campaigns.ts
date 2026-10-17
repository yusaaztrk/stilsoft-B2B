import { API_BASE_URL } from '../config/api'
import { redirectToLogin } from '../auth/redirectToLogin'

export type CreateBasketTotalDiscountRequest = {
  /** Kampanyanın uygulanacağı bayiler (cari kodları). BOŞ/atlanmış = tüm bayiler. */
  dealerCodes?: string[] | null
  /** Bu kampanya uygulanırsa daha düşük öncelikli kampanyalar hiç denenmez. */
  stopNext?: boolean
  /**
   * Uygulama sırası; BÜYÜK olan ÖNCE uygulanır. Eşitlik durumunda sunucu ada/oluşturma
   * zamanına göre çözer, sıra hiçbir zaman rastgele değildir.
   */
  priority?: number
  name: string
  description?: string | null
  startDate: string
  endDate: string
  groupCode: string
  productStockCodes?: string[]
  minBasketTotal: number
  discountType: 'Tutar' | 'Oran'
  discountValue: number
  priceGroupCodes?: number[]
  subeKodu?: string | null
}

export type PatchBasketTotalDiscountRequest = {
  /** Kampanyanın uygulanacağı bayiler (cari kodları). BOŞ/atlanmış = tüm bayiler. */
  dealerCodes?: string[] | null
  /** Düzenlemede de gönderilebilir; gönderilmezse sunucu mevcut değeri korur. */
  priority?: number | null
  stopNext?: boolean | null
  name?: string | null
  description?: string | null
  startDate?: string | null
  endDate?: string | null
  groupCode?: string | null
  productStockCodes?: string[] | null
  minBasketTotal?: number | null
  discountType?: 'Tutar' | 'Oran' | null
  discountValue?: number | null
  priceGroupCodes?: number[] | null
  subeKodu?: string | null
}

/**
 * Ürüne özel kampanyalı fiyat satırı (2026-10-07): kampanyalı Fiyat 4 (F4 para biriminde, KDV
 * dahil). Diğer fiyat grupları formülle türer; sunucu indirimi her okumada güncel F4'ten hesaplar.
 */
export type TargetPriceItem = { stockCode: string; targetPrice: number }

export type CreateProductDiscountRequest = {
  /** Kampanyanın uygulanacağı bayiler (cari kodları). BOŞ/atlanmış = tüm bayiler. */
  dealerCodes?: string[] | null
  /** Bu kampanya uygulanırsa daha düşük öncelikli kampanyalar hiç denenmez. */
  stopNext?: boolean
  /**
   * Uygulama sırası; BÜYÜK olan ÖNCE uygulanır. Eşitlik durumunda sunucu ada/oluşturma
   * zamanına göre çözer, sıra hiçbir zaman rastgele değildir.
   */
  priority?: number
  name: string
  description?: string | null
  startDate: string
  endDate: string
  groupCode: string
  productStockCodes?: string[]
  discountType: 'Tutar' | 'Oran'
  discountValue: number
  priceGroupCodes?: number[]
  subeKodu?: string | null
  /** Doluysa ürüne özel kampanyalı fiyat modu: kategori/oran alanları yok sayılır. */
  items?: TargetPriceItem[] | null
}

export type PatchProductDiscountRequest = {
  /** Kampanyanın uygulanacağı bayiler (cari kodları). BOŞ/atlanmış = tüm bayiler. */
  dealerCodes?: string[] | null
  /** Düzenlemede de gönderilebilir; gönderilmezse sunucu mevcut değeri korur. */
  priority?: number | null
  stopNext?: boolean | null
  name?: string | null
  description?: string | null
  startDate?: string | null
  endDate?: string | null
  groupCode?: string | null
  productStockCodes?: string[] | null
  discountType?: 'Tutar' | 'Oran' | null
  discountValue?: number | null
  priceGroupCodes?: number[] | null
  subeKodu?: string | null
  /** Gönderilirse kampanyanın bütün ürün satırları bu listeden yeniden kurulur. */
  items?: TargetPriceItem[] | null
}

export type CreateCategoryBrandDiscountRequest = {
  /** Kampanyanın uygulanacağı bayiler (cari kodları). BOŞ/atlanmış = tüm bayiler. */
  dealerCodes?: string[] | null
  /** Bu kampanya uygulanırsa daha düşük öncelikli kampanyalar hiç denenmez. */
  stopNext?: boolean
  /**
   * Uygulama sırası; BÜYÜK olan ÖNCE uygulanır. Eşitlik durumunda sunucu ada/oluşturma
   * zamanına göre çözer, sıra hiçbir zaman rastgele değildir.
   */
  priority?: number
  name: string
  description?: string | null
  startDate: string
  endDate: string
  categoryCode: string
  brandField?: 'KOD4' | 'KOD5' | null
  brandCode?: string | null
  discountType: 'Tutar' | 'Oran'
  discountValue: number
  priceGroupCodes?: number[]
  subeKodu?: string | null
}

export type PatchCategoryBrandDiscountRequest = {
  /** Kampanyanın uygulanacağı bayiler (cari kodları). BOŞ/atlanmış = tüm bayiler. */
  dealerCodes?: string[] | null
  /** Düzenlemede de gönderilebilir; gönderilmezse sunucu mevcut değeri korur. */
  priority?: number | null
  stopNext?: boolean | null
  name?: string | null
  description?: string | null
  startDate?: string | null
  endDate?: string | null
  categoryCode?: string | null
  brandField?: 'KOD4' | 'KOD5' | null
  brandCode?: string | null
  discountType?: 'Tutar' | 'Oran' | null
  discountValue?: number | null
  priceGroupCodes?: number[] | null
  subeKodu?: string | null
}

export type CreatePackageCampaignItem = {
  groupCode?: string | null
  stockCode: string
  quantity: number
}

export type CreatePackageCampaignRequest = {
  /** Kampanyanın uygulanacağı bayiler (cari kodları). BOŞ/atlanmış = tüm bayiler. */
  dealerCodes?: string[] | null
  /** Bu kampanya uygulanırsa daha düşük öncelikli kampanyalar hiç denenmez. */
  stopNext?: boolean
  /**
   * Uygulama sırası; BÜYÜK olan ÖNCE uygulanır. Eşitlik durumunda sunucu ada/oluşturma
   * zamanına göre çözer, sıra hiçbir zaman rastgele değildir.
   */
  priority?: number
  name: string
  description?: string | null
  startDate: string
  endDate: string
  items: CreatePackageCampaignItem[]
  operationType: 'Tutar' | 'Oran'
  operationValue: number
  priceGroupCodes?: number[]
  subeKodu?: string | null
}

export type PatchPackageCampaignRequest = {
  /** Kampanyanın uygulanacağı bayiler (cari kodları). BOŞ/atlanmış = tüm bayiler. */
  dealerCodes?: string[] | null
  /** Düzenlemede de gönderilebilir; gönderilmezse sunucu mevcut değeri korur. */
  priority?: number | null
  stopNext?: boolean | null
  name?: string | null
  description?: string | null
  startDate?: string | null
  endDate?: string | null
  items?: CreatePackageCampaignItem[] | null
  operationType?: 'Tutar' | 'Oran' | null
  operationValue?: number | null
  priceGroupCodes?: number[] | null
  subeKodu?: string | null
}

function buildHeaders(includeJson: boolean) {
  const headers: Record<string, string> = {}
  if (includeJson) headers['Content-Type'] = 'application/json'
  const token = localStorage.getItem('accessToken')
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
}

function getFriendlyError(text: string, status: number) {
  const t = String(text ?? '').trim()
  if (!t) return `İşlem gerçekleştirilemedi (${status})`
  if (t.startsWith('{') || t.startsWith('[')) {
    try {
      const j = JSON.parse(t)
      const errors = j?.errors
      if (errors && typeof errors === 'object') {
        const entries = Object.entries(errors as Record<string, unknown>)
        for (const [, v] of entries) {
          const arr = Array.isArray(v) ? v : [v]
          const msg = String(arr[0] ?? '').trim()
          if (msg) return msg
        }
      }
      const m = j?.message || j?.error || j?.title
      if (typeof m === 'string' && m.trim()) return m.trim()
    } catch {
      return `İşlem gerçekleştirilemedi (${status})`
    }
  }
  return t
}

export async function createBasketTotalDiscount(payload: CreateBasketTotalDiscountRequest): Promise<{ id: string }> {
  const res = await fetch(`${API_BASE_URL}/api/Campaigns/basket-total-discount`, {
    method: 'POST',
    headers: { ...buildHeaders(true) },
    body: JSON.stringify({
      // Sunucu tarafi bu alani okumazsa kampanya her zaman 0 oncelikle kaydedilir.
      priority: payload.priority ?? 0,
      stopNext: payload.stopNext ?? false,
      name: payload.name,
      description: payload.description ?? null,
      startDate: payload.startDate,
      endDate: payload.endDate,
      groupCode: payload.groupCode,
      productStockCodes: payload.productStockCodes ?? [],
      minBasketTotal: payload.minBasketTotal,
      discountType: payload.discountType,
      discountValue: payload.discountValue,
      priceGroupCodes: payload.priceGroupCodes ?? [],
      // Govde alan alan kuruluyor: tipe eklemek YETMEZ, buraya da eklenmezse
      // bayi secimi sessizce dusser ve kampanya herkese acik kaydedilir.
      dealerCodes: payload.dealerCodes ?? [],
      subeKodu: payload.subeKodu ?? null
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

    const t = await res.text().catch(() => '')
    throw new Error(getFriendlyError(t, res.status))
  }

  const json = (await res.json()) as any
  const id = String(json?.id ?? json?.data?.id ?? '').trim()
  return { id }
}

export async function patchBuyXGetY(id: string, patch: PatchBuyXGetYRequest): Promise<{ id: string }> {
  const res = await fetch(`${API_BASE_URL}/api/Campaigns/buy-x-get-y/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { ...buildHeaders(true) },
    body: JSON.stringify(patch)
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

    const t = await res.text().catch(() => '')
    throw new Error(getFriendlyError(t, res.status))
  }

  const json = (await res.json()) as any
  const updatedId = String(json?.id ?? json?.data?.id ?? id).trim()
  return { id: updatedId }
}

export async function patchBasketTotalDiscount(id: string, patch: PatchBasketTotalDiscountRequest): Promise<{ id: string }> {
  const res = await fetch(`${API_BASE_URL}/api/Campaigns/basket-total-discount/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { ...buildHeaders(true) },
    body: JSON.stringify(patch)
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

    const t = await res.text().catch(() => '')
    throw new Error(getFriendlyError(t, res.status))
  }

  const json = (await res.json()) as any
  const updatedId = String(json?.id ?? json?.data?.id ?? id).trim()
  return { id: updatedId }
}

export async function patchProductDiscount(id: string, patch: PatchProductDiscountRequest): Promise<{ id: string }> {
  const res = await fetch(`${API_BASE_URL}/api/Campaigns/product-discount/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { ...buildHeaders(true) },
    body: JSON.stringify(patch)
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

    const t = await res.text().catch(() => '')
    throw new Error(getFriendlyError(t, res.status))
  }

  const json = (await res.json()) as any
  const updatedId = String(json?.id ?? json?.data?.id ?? id).trim()
  return { id: updatedId }
}

export async function patchQuantityTieredDiscount(id: string, patch: Partial<CreateQuantityTieredDiscountRequest>): Promise<{ id: string }> {
  const res = await fetch(`${API_BASE_URL}/api/Campaigns/quantity-tiered-discount/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { ...buildHeaders(true) },
    body: JSON.stringify(patch)
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

    const t = await res.text().catch(() => '')
    throw new Error(getFriendlyError(t, res.status))
  }

  const json = (await res.json()) as any
  const updatedId = String(json?.id ?? json?.data?.id ?? id).trim()
  return { id: updatedId }
}

export async function updateCategoryBrandDiscount(id: string, payload: CreateCategoryBrandDiscountRequest): Promise<{ id: string }> {
  const res = await fetch(`${API_BASE_URL}/api/Campaigns/category-brand-discount/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { ...buildHeaders(true) },
    body: JSON.stringify({
      // Uç, create DTO'sunu paylaşıyor ve orada Priority/StopNext non-nullable. Gövdeden
      // düşerlerse PUT kampanyanın önceliğini sessizce 0'a çeker; bu yüzden hep gönderiliyor.
      priority: payload.priority ?? 0,
      stopNext: payload.stopNext ?? false,
      name: payload.name,
      description: payload.description ?? null,
      startDate: payload.startDate,
      endDate: payload.endDate,
      categoryCode: payload.categoryCode,
      brandField: payload.brandField ?? null,
      brandCode: payload.brandCode ?? null,
      discountType: payload.discountType,
      discountValue: payload.discountValue,
      priceGroupCodes: payload.priceGroupCodes ?? [],
      // Govde alan alan kuruluyor: tipe eklemek YETMEZ, buraya da eklenmezse
      // bayi secimi sessizce dusser ve kampanya herkese acik kaydedilir.
      dealerCodes: payload.dealerCodes ?? [],
      subeKodu: payload.subeKodu ?? null
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

    const t = await res.text().catch(() => '')
    throw new Error(getFriendlyError(t, res.status))
  }

  const json = (await res.json()) as any
  const updatedId = String(json?.id ?? json?.data?.id ?? id).trim()
  return { id: updatedId }
}

export async function patchCategoryBrandDiscount(id: string, patch: PatchCategoryBrandDiscountRequest): Promise<{ id: string }> {
  const res = await fetch(`${API_BASE_URL}/api/Campaigns/category-brand-discount/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { ...buildHeaders(true) },
    body: JSON.stringify(patch)
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

    const t = await res.text().catch(() => '')
    throw new Error(getFriendlyError(t, res.status))
  }

  const json = (await res.json()) as any
  const updatedId = String(json?.id ?? json?.data?.id ?? id).trim()
  return { id: updatedId }
}

export async function createPackageCampaign(payload: CreatePackageCampaignRequest): Promise<{ id: string }> {
  const res = await fetch(`${API_BASE_URL}/api/Campaigns/package-campaign`, {
    method: 'POST',
    headers: { ...buildHeaders(true) },
    body: JSON.stringify({
      // Sunucu tarafi bu alani okumazsa kampanya her zaman 0 oncelikle kaydedilir.
      priority: payload.priority ?? 0,
      stopNext: payload.stopNext ?? false,
      name: payload.name,
      description: payload.description ?? null,
      startDate: payload.startDate,
      endDate: payload.endDate,
      items: (payload.items ?? []).map((x) => ({
        groupCode: x.groupCode ?? null,
        stockCode: x.stockCode,
        quantity: x.quantity
      })),
      operationType: payload.operationType,
      operationValue: payload.operationValue,
      priceGroupCodes: payload.priceGroupCodes ?? [],
      // Govde alan alan kuruluyor: tipe eklemek YETMEZ, buraya da eklenmezse
      // bayi secimi sessizce dusser ve kampanya herkese acik kaydedilir.
      dealerCodes: payload.dealerCodes ?? [],
      subeKodu: payload.subeKodu ?? null
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

    const t = await res.text().catch(() => '')
    throw new Error(getFriendlyError(t, res.status))
  }

  const json = (await res.json()) as any
  const id = String(json?.id ?? json?.data?.id ?? '').trim()
  return { id }
}

export async function updatePackageCampaign(id: string, payload: CreatePackageCampaignRequest): Promise<{ id: string }> {
  const res = await fetch(`${API_BASE_URL}/api/Campaigns/package-campaign/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { ...buildHeaders(true) },
    body: JSON.stringify({
      // Bkz. updateCategoryBrandDiscount: create DTO'su paylaşıldığı için eksik gönderilen
      // priority/stopNext düzenlemede 0/false yazar.
      priority: payload.priority ?? 0,
      stopNext: payload.stopNext ?? false,
      name: payload.name,
      description: payload.description ?? null,
      startDate: payload.startDate,
      endDate: payload.endDate,
      items: (payload.items ?? []).map((x) => ({
        groupCode: x.groupCode ?? null,
        stockCode: x.stockCode,
        quantity: x.quantity
      })),
      operationType: payload.operationType,
      operationValue: payload.operationValue,
      priceGroupCodes: payload.priceGroupCodes ?? [],
      // Govde alan alan kuruluyor: tipe eklemek YETMEZ, buraya da eklenmezse
      // bayi secimi sessizce dusser ve kampanya herkese acik kaydedilir.
      dealerCodes: payload.dealerCodes ?? [],
      subeKodu: payload.subeKodu ?? null
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

    const t = await res.text().catch(() => '')
    throw new Error(getFriendlyError(t, res.status))
  }

  const json = (await res.json()) as any
  const updatedId = String(json?.id ?? json?.data?.id ?? id).trim()
  return { id: updatedId }
}

export async function patchPackageCampaign(id: string, patch: PatchPackageCampaignRequest): Promise<{ id: string }> {
  const res = await fetch(`${API_BASE_URL}/api/Campaigns/package-campaign/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { ...buildHeaders(true) },
    body: JSON.stringify(patch)
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

    const t = await res.text().catch(() => '')
    throw new Error(getFriendlyError(t, res.status))
  }

  const json = (await res.json()) as any
  const updatedId = String(json?.id ?? json?.data?.id ?? id).trim()
  return { id: updatedId }
}

export async function createCategoryBrandDiscount(payload: CreateCategoryBrandDiscountRequest): Promise<{ id: string }> {
  const res = await fetch(`${API_BASE_URL}/api/Campaigns/category-brand-discount`, {
    method: 'POST',
    headers: { ...buildHeaders(true) },
    body: JSON.stringify({
      // Sunucu tarafi bu alani okumazsa kampanya her zaman 0 oncelikle kaydedilir.
      priority: payload.priority ?? 0,
      stopNext: payload.stopNext ?? false,
      name: payload.name,
      description: payload.description ?? null,
      startDate: payload.startDate,
      endDate: payload.endDate,
      categoryCode: payload.categoryCode,
      brandField: payload.brandField ?? null,
      brandCode: payload.brandCode ?? null,
      discountType: payload.discountType,
      discountValue: payload.discountValue,
      priceGroupCodes: payload.priceGroupCodes ?? [],
      // Govde alan alan kuruluyor: tipe eklemek YETMEZ, buraya da eklenmezse
      // bayi secimi sessizce dusser ve kampanya herkese acik kaydedilir.
      dealerCodes: payload.dealerCodes ?? [],
      subeKodu: payload.subeKodu ?? null
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

    const t = await res.text().catch(() => '')
    throw new Error(getFriendlyError(t, res.status))
  }

  const json = (await res.json()) as any
  const id = String(json?.id ?? json?.data?.id ?? '').trim()
  return { id }
}

export async function createProductDiscount(payload: CreateProductDiscountRequest): Promise<{ id: string }> {
  const res = await fetch(`${API_BASE_URL}/api/Campaigns/product-discount`, {
    method: 'POST',
    headers: { ...buildHeaders(true) },
    body: JSON.stringify({
      // Sunucu tarafi bu alani okumazsa kampanya her zaman 0 oncelikle kaydedilir.
      priority: payload.priority ?? 0,
      stopNext: payload.stopNext ?? false,
      name: payload.name,
      description: payload.description ?? null,
      startDate: payload.startDate,
      endDate: payload.endDate,
      groupCode: payload.groupCode,
      productStockCodes: payload.productStockCodes ?? [],
      discountType: payload.discountType,
      discountValue: payload.discountValue,
      priceGroupCodes: payload.priceGroupCodes ?? [],
      // Govde alan alan kuruluyor: tipe eklemek YETMEZ, buraya da eklenmezse
      // bayi secimi sessizce dusser ve kampanya herkese acik kaydedilir.
      dealerCodes: payload.dealerCodes ?? [],
      subeKodu: payload.subeKodu ?? null,
      // Ürüne özel kampanyalı fiyat listesi (2026-10-07); aynı kural burada da geçerli.
      items: payload.items ?? null
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

    const t = await res.text().catch(() => '')
    throw new Error(getFriendlyError(t, res.status))
  }

  const json = (await res.json()) as any
  const id = String(json?.id ?? json?.data?.id ?? '').trim()
  return { id }
}

export async function createBuyXGetY(payload: CreateBuyXGetYRequest): Promise<{ id: string }> {
  const res = await fetch(`${API_BASE_URL}/api/Campaigns/buy-x-get-y`, {
    method: 'POST',
    headers: { ...buildHeaders(true) },
    body: JSON.stringify({
      // Sunucu tarafi bu alani okumazsa kampanya her zaman 0 oncelikle kaydedilir.
      priority: payload.priority ?? 0,
      stopNext: payload.stopNext ?? false,
      // Govde alan alan kuruluyor: tipe eklemek yetmez, buraya da eklenmezse bayi
      // secimi sessizce duser ve kampanya herkese acik kaydedilir.
      dealerCodes: payload.dealerCodes ?? [],
      name: payload.name,
      description: payload.description ?? null,
      startDate: payload.startDate,
      endDate: payload.endDate,
      triggerGroupCode: payload.triggerGroupCode,
      triggerProductStockCodes: payload.triggerProductStockCodes ?? [],
      triggerMinQuantity: payload.triggerMinQuantity,
      rewardLines: (payload.rewardLines ?? []).map((x) => ({
        targetProductId: x.targetProductId,
        quantity: x.quantity,
        isGift: x.isGift,
        discountType: x.discountType ?? null,
        discountValue: x.discountValue,
        priceGroupCodes: x.priceGroupCodes ?? []
      })),
      subeKodu: payload.subeKodu ?? null
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
    throw new Error(getFriendlyError(text, res.status))
  }

  const json = (await res.json()) as any
  const id = String(json?.id ?? json?.data?.id ?? '').trim()
  return { id }
}

export type CampaignListItem = {
  id: string
  name: string
  description?: string | null
  startDate: string | null
  endDate: string | null
  isActive: boolean
  kampanyaTipi?: number | string | null
  subeKodu?: string | null
}

export type CampaignDetailsCondition = {
  id: string
  createTime?: string | null
  conditionType: number | string
  categoryCode?: string | null
  brandField?: string | null
  brandCode?: string | null
  packageItemsJson?: string | null
  groupCodes?: string[]
  productStockCodes?: string[]
  metric?: number | string | null
  minimum?: number | null
  maximum?: number | null
  targetId?: string | null
  operator?: string | null
  value?: number | null
}

export type CampaignDetailsAction = {
  id: string
  actionType: number | string
  targetProductId?: string | null
  targetPriceGroupId?: string | null
  value: number
  quantity: number
}

export type CampaignDetailsTarget = {
  id: string
  targetType: number | string
  targetId?: string | null
}

export type CampaignDetailsDiscount = {
  id: string
  createTime?: string | null
  stokKodu?: string | null
  targetProductId?: string | null
  grupKodu?: string | null
  minSepetTutari: number
  iskontoTipi: number | string
  deger: number
  iskontoFiyat1?: number | null
  iskontoFiyat2?: number | null
  iskontoFiyat3?: number | null
  iskontoFiyat4?: number | null
  iskontoFiyat5?: number | null
  iskontoFiyat6?: number | null
}

export type CampaignDetailsResponse = {
  id: string
  name: string
  description?: string | null
  startDate: string | null
  endDate: string | null
  isIndefinite: boolean
  priority: number
  isActive: boolean
  kampanyaTipi?: number | string | null
  subeKodu?: string | null
  stopNext: boolean
  conditions: CampaignDetailsCondition[]
  actions: CampaignDetailsAction[]
  targets: CampaignDetailsTarget[]
  discounts: CampaignDetailsDiscount[]
}

export async function fetchCampaignById(id: string): Promise<CampaignDetailsResponse> {
  const res = await fetch(`${API_BASE_URL}/api/Campaigns/${encodeURIComponent(id)}`, {
    headers: { ...buildHeaders(false) }
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

    const t = await res.text().catch(() => '')
    throw new Error(getFriendlyError(t, res.status))
  }

  const json = (await res.json()) as any
  return (json?.data ?? json) as CampaignDetailsResponse
}

export async function softDeleteCampaign(id: string): Promise<{ success: boolean }> {
  const res = await fetch(`${API_BASE_URL}/api/Campaigns/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { ...buildHeaders(true) }
  })

  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data?.message ?? 'Kampanya silinemedi')
  return data as any
}

export type QuantityTierRequest = {
  minQuantity: number
  maxQuantity?: number | null
  discountType: 'Oran' | 'Tutar'
  discountValue: number
  priceGroupCodes: number[]
}

export type CreateQuantityTieredDiscountRequest = {
  /** Kampanyanın uygulanacağı bayiler (cari kodları). BOŞ/atlanmış = tüm bayiler. */
  dealerCodes?: string[] | null
  /** Bu kampanya uygulanırsa daha düşük öncelikli kampanyalar hiç denenmez. */
  stopNext?: boolean
  /**
   * Uygulama sırası; BÜYÜK olan ÖNCE uygulanır. Eşitlik durumunda sunucu ada/oluşturma
   * zamanına göre çözer, sıra hiçbir zaman rastgele değildir.
   */
  priority?: number
  name: string
  startDate: string
  endDate: string
  description?: string | null
  groupCodes?: string[]
  productStockCodes?: string[]
  tiers: QuantityTierRequest[]
  subeKodu?: string | null
}

export type BuyXGetYRewardLineRequest = {
  targetProductId: string
  quantity: number
  isGift: boolean
  discountType?: 'Tutar' | 'Oran' | null
  discountValue: number
  priceGroupCodes?: number[]
}

export type CreateBuyXGetYRequest = {
  /** Kampanyanın uygulanacağı bayiler (cari kodları). BOŞ/atlanmış = tüm bayiler. */
  dealerCodes?: string[] | null
  /** Bu kampanya uygulanırsa daha düşük öncelikli kampanyalar hiç denenmez. */
  stopNext?: boolean
  /**
   * Uygulama sırası; BÜYÜK olan ÖNCE uygulanır. Eşitlik durumunda sunucu ada/oluşturma
   * zamanına göre çözer, sıra hiçbir zaman rastgele değildir.
   */
  priority?: number
  name: string
  startDate: string
  endDate: string
  description?: string | null
  triggerGroupCode: string
  triggerProductStockCodes?: string[]
  triggerMinQuantity: number
  rewardLines: BuyXGetYRewardLineRequest[]
  subeKodu?: string | null
}

export type PatchBuyXGetYRequest = {
  /** Kampanyanın uygulanacağı bayiler (cari kodları). BOŞ/atlanmış = tüm bayiler. */
  dealerCodes?: string[] | null
  /** Düzenlemede de gönderilebilir; gönderilmezse sunucu mevcut değeri korur. */
  priority?: number | null
  stopNext?: boolean | null
  name?: string | null
  description?: string | null
  startDate?: string | null
  endDate?: string | null
  triggerGroupCode?: string | null
  triggerProductStockCodes?: string[] | null
  triggerMinQuantity?: number | null
  rewardLines?: BuyXGetYRewardLineRequest[] | null
  subeKodu?: string | null
}

export async function createQuantityTieredDiscount(
  payload: CreateQuantityTieredDiscountRequest
): Promise<{ id: string }> {
  const res = await fetch(`${API_BASE_URL}/api/Campaigns/quantity-tiered-discount`, {
    method: 'POST',
    headers: { ...buildHeaders(true) },
    body: JSON.stringify(payload)
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
    throw new Error(getFriendlyError(text, res.status))
  }

  const json = (await res.json()) as any
  const id = String(json?.id ?? json?.data?.id ?? '').trim()
  return { id }
}

export async function fetchCampaigns(opts?: {
  q?: string
  name?: string
  description?: string
  kampanyaTipi?: string
  isActive?: string
  startDate?: string
  endDate?: string
  page?: number
  pageSize?: number
  sort?: string
  dir?: 'asc' | 'desc'
}): Promise<{ items: CampaignListItem[]; total: number; page: number; pageSize: number; totalPages: number }> {
  const qs = new URLSearchParams()
  if (opts?.q) qs.set('q', opts.q)
  if (opts?.name) qs.set('name', opts.name)
  if (opts?.description) qs.set('description', opts.description)
  if (opts?.kampanyaTipi) qs.set('kampanyaTipi', opts.kampanyaTipi)
  if (opts?.isActive) qs.set('isActive', opts.isActive)
  if (opts?.startDate) qs.set('startDate', opts.startDate)
  if (opts?.endDate) qs.set('endDate', opts.endDate)
  if (opts?.sort) qs.set('sort', opts.sort)
  if (opts?.dir) qs.set('dir', opts.dir)
  if (opts?.page) qs.set('page', String(opts.page))
  if (opts?.pageSize) qs.set('pageSize', String(opts.pageSize))

  const res = await fetch(`${API_BASE_URL}/api/Campaigns?${qs.toString()}`, {
    headers: { ...buildHeaders(false) }
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

    const t = await res.text().catch(() => '')
    throw new Error(getFriendlyError(t, res.status))
  }

  const json = (await res.json()) as any
  const data = json?.data ?? {}
  return {
    items: (data.items ?? []) as CampaignListItem[],
    total: Number(data.total ?? 0),
    page: Number(data.page ?? 1),
    pageSize: Number(data.pageSize ?? 20),
    totalPages: Number(data.totalPages ?? 1)
  }
}

// Fetch active campaigns for order screen
export type ActiveCampaignDto = {
  id: string
  name: string
  description?: string | null
  startDate: string | null
  endDate: string | null
  isIndefinite: boolean
  priority: number
  kampanyaTipi: number
  kampanyaTipiText: string
  stopNext?: boolean
  discounts: Array<{
    stokKodu?: string | null
    grupKodu?: string | null
    minSepetTutari: number
    iskontoTipi: number
    iskontoTipiText: string
    deger: number
    iskontoFiyat1?: number | null
    iskontoFiyat2?: number | null
    iskontoFiyat3?: number | null
    iskontoFiyat4?: number | null
    iskontoFiyat5?: number | null
    iskontoFiyat6?: number | null
  }>
  conditions: Array<{
    conditionType: number
    categoryCode?: string | null
    brandField?: string | null
    brandCode?: string | null
    packageItemsJson?: string | null
    productStockCodesJson?: string | null
    metric: number
    minimum: number
    maximum?: number | null
  }>
  actions: Array<{
    actionType: number
    targetProductId?: string | null
    targetPriceGroupId?: string | null
    value: number
    quantity: number
  }>
}

export async function fetchActiveCampaigns(opts?: {
  customerCode?: string
  priceGroupCode?: number
  includeExpired?: boolean
}): Promise<ActiveCampaignDto[]> {
  const qs = new URLSearchParams()
  if (opts?.customerCode) qs.set('customerCode', opts.customerCode)
  if (opts?.priceGroupCode) qs.set('priceGroupCode', String(opts.priceGroupCode))
  if (opts?.includeExpired !== undefined) qs.set('includeExpired', String(opts.includeExpired))

  const res = await fetch(`${API_BASE_URL}/api/Campaigns/active?${qs.toString()}`, {
    headers: { ...buildHeaders(false) }
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

    const t = await res.text().catch(() => '')
    throw new Error(getFriendlyError(t, res.status))
  }

  const json = (await res.json()) as any
  return ((json?.data ?? []) as any[]).map(normalizeActiveCampaign)
}

/* ---------------------------------------------------------------------------------------
 * ENUM'LAR METİN GELİYOR (2026-09-18 canlı hata: "kampanya tanımladım, ürünün fiyatı
 * değişmiyor").
 *
 * Sunucu enum alanlarını ADIYLA yazıyor (`kampanyaTipi: "UrunIndirimi"`), tip tanımı ise
 * sayı diyor. Sepet hesabı `switch (campaign.kampanyaTipi) { case 4: ... }` ile sayıya
 * bakıyordu; metin hiçbir dala uymadığı için HİÇBİR kampanya uygulanmıyordu — indirim
 * sessizce 0 kalıyordu.
 *
 * Çeviri TEK yerde, veriyi alan uçta yapılır: ekranların her biri kendi dönüşümünü yazsaydı
 * biri unutulduğunda aynı hata başka sayfada geri gelirdi. Metin alanları (`kampanyaTipiText`,
 * `iskontoTipiText`) olduğu gibi kalıyor; ekranlar etiketi onlardan okuyor.
 * ------------------------------------------------------------------------------------- */

const KAMPANYA_TIPI_KODLARI: Record<string, number> = {
  sepetindirimi: 1,
  adetbazlikademeliindirim: 2,
  xalanayhediyeveyaindirimliurun: 3,
  urunindirimi: 4,
  kategorimarkaindirimi: 5,
  paketkampanya: 6
}

const ISKONTO_TIPI_KODLARI: Record<string, number> = { tutar: 1, oran: 2 }

const KOSUL_TIPI_KODLARI: Record<string, number> = {
  minquantity: 1,
  minamount: 2,
  categorybased: 3,
  productbased: 4,
  customergroupbased: 5,
  packageproducts: 6
}

function enumToNumber(value: unknown, map: Record<string, number>): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const key = String(value ?? '').trim().toLowerCase()
  if (!key) return 0
  const n = Number(key)
  if (Number.isFinite(n) && key !== '') return n
  return map[key] ?? 0
}

function normalizeActiveCampaign(raw: any): ActiveCampaignDto {
  return {
    ...raw,
    kampanyaTipi: enumToNumber(raw?.kampanyaTipi, KAMPANYA_TIPI_KODLARI),
    kampanyaTipiText: String(raw?.kampanyaTipiText ?? raw?.kampanyaTipi ?? ''),
    discounts: (raw?.discounts ?? []).map((d: any) => ({
      ...d,
      iskontoTipi: enumToNumber(d?.iskontoTipi, ISKONTO_TIPI_KODLARI),
      iskontoTipiText: String(d?.iskontoTipiText ?? d?.iskontoTipi ?? '')
    })),
    conditions: (raw?.conditions ?? []).map((c: any) => ({
      ...c,
      conditionType: enumToNumber(c?.conditionType, KOSUL_TIPI_KODLARI)
    }))
  } as ActiveCampaignDto
}

export type EvaluateSalesOrderLineRequest = {
  stockCode: string
  quantity: number
  unitPrice: number
  vatRate: number
}

export type EvaluateSalesOrderRequest = {
  customerCode: string
  lines: EvaluateSalesOrderLineRequest[]
}

export type EvaluateSalesOrderLineResponse = {
  stockCode: string
  quantity: number
  unitPrice: number
  vatRate: number
  isGift: boolean
  lineTotal: number
  discountAmount: number
  taxAmount: number
}

export type EvaluateSalesOrderResponse = {
  customerCode: string
  subtotal: number
  discountTotal: number
  taxTotal: number
  grandTotal: number
  appliedPriceGroupId?: string | null
  appliedCampaignIds: string[]
  lines: EvaluateSalesOrderLineResponse[]
}

export async function evaluateSalesOrder(payload: EvaluateSalesOrderRequest): Promise<EvaluateSalesOrderResponse> {
  const res = await fetch(`${API_BASE_URL}/api/Campaigns/evaluate-salesorder`, {
    method: 'POST',
    headers: { ...buildHeaders(true) },
    body: JSON.stringify(payload)
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

    const t = await res.text().catch(() => '')
    throw new Error(getFriendlyError(t, res.status))
  }

  const json = (await res.json()) as any
  return (json?.data ?? json) as EvaluateSalesOrderResponse
}

