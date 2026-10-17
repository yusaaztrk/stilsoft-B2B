import { API_BASE_URL } from '../config'
import { apiJson } from './client'
import { fetchErpProductsRaw } from './erp'

export type StockItemDto = {
  type: 'Product' | 'SparePart'
  id: string
  productId: string
  productName: string
  name: string
  partNumber?: string | null
  quantity?: number | null
  minStockLevel?: number | null
  explodedViewPartNumber?: string | null
  explodedDiagramUrl?: string | null
  imageUrl?: string | null
  parentStockCode?: string | null
  unitPrice?: number | null
  groupCode?: string | null
}

export type StockSummaryDto = {
  totalProducts: number
  totalSpareParts: number
  criticalStock: number
  outOfStock: number
}

export type StockCategoryDto = {
  id: string
  name: string
}

export type StockProductListItemDto = {
  productId: string
  stockCode: string
  productName: string
  categoryName: string
  sparePartCount: number
  stockStatus: 'ok' | 'critical' | 'out'
  imageUrl?: string | null
  explodedDiagramUrl?: string | null
}

export type StockSparePartListItemDto = {
  id: string
  name: string
  partNumber: string
  quantity: number
  minStockLevel: number
  explodedViewPartNumber: string
  imageUrl?: string | null
}

export type StockProductsResponse = {
  items: StockProductListItemDto[]
  totalCount: number
  totalPages: number
  currentPage: number
  pageSize: number
}

const ERP_BASE = API_BASE_URL
function toAbsoluteUrl(url?: string | null): string | null {
  if (!url) return null
  if (url.startsWith('http')) return url
  return `${ERP_BASE}${url}`
}

function cleanStr(s?: string | null): string {
  if (!s) return ''
  return String(s)
    .replace(/İ/g, 'i')
    .replace(/I/g, 'ı')
    .toLowerCase()
    .trim()
}

function looksLikeUrl(v?: string | null): boolean {
  if (!v) return false
  const s = String(v).trim().toLowerCase()
  if (!s) return false
  if (s.startsWith('http://') || s.startsWith('https://') || s.startsWith('data:') || s.startsWith('blob:') || s.startsWith('/')) return true
  if (s.includes('/uploads/') || s.includes('uploads/')) return true
  if (/\.(png|jpe?g|webp|gif|svg|bmp)(\?.*)?$/i.test(s)) return true
  return false
}

/**
 * High-performance backend paginated stock APIs
 */
export async function fetchStockSummary(): Promise<StockSummaryDto> {
  const json = await apiJson<{ success?: boolean } & StockSummaryDto>('/api/stock/summary')
  return {
    totalProducts: json?.totalProducts ?? 0,
    totalSpareParts: json?.totalSpareParts ?? 0,
    criticalStock: json?.criticalStock ?? 0,
    outOfStock: json?.outOfStock ?? 0
  }
}

export async function fetchStockCategories(): Promise<StockCategoryDto[]> {
  const json = await apiJson<{ success?: boolean; data?: StockCategoryDto[] }>('/api/stock/categories')
  return json?.data ?? []
}

export async function fetchStockProducts(params: {
  page?: number
  pageSize?: number
  search?: string
  categoryId?: string
  stockStatus?: string
  sortBy?: string
  sortDirection?: string
}): Promise<StockProductsResponse> {
  const qs = new URLSearchParams()
  if (params.page) qs.set('page', String(params.page))
  if (params.pageSize) qs.set('pageSize', String(params.pageSize))
  if (params.search) qs.set('search', params.search)
  if (params.categoryId) qs.set('categoryId', params.categoryId)
  if (params.stockStatus) qs.set('stockStatus', params.stockStatus)
  if (params.sortBy) qs.set('sortBy', params.sortBy)
  if (params.sortDirection) qs.set('sortDirection', params.sortDirection)

  const json = await apiJson<{
    items?: any[]
    totalCount?: number
    totalPages?: number
    currentPage?: number
    pageSize?: number
  }>(`/api/stock/products?${qs}`)

  return {
    items: (json?.items ?? []).map(x => ({
      ...x,
      imageUrl: toAbsoluteUrl(x.imageUrl),
      explodedDiagramUrl: x.explodedDiagramUrl ? toAbsoluteUrl(x.explodedDiagramUrl) : null
    })),
    totalCount: json?.totalCount ?? 0,
    totalPages: json?.totalPages ?? 0,
    currentPage: json?.currentPage ?? 1,
    pageSize: json?.pageSize ?? 50
  }
}

export async function fetchStockProductDetail(id: string): Promise<StockProductListItemDto> {
  const json = await apiJson<{ success?: boolean; data?: any }>(`/api/stock/products/${id}`)
  const d = json?.data
  if (!d) throw new Error('Product not found')
  return {
    productId: d.id,
    stockCode: d.stockCode ?? '',
    productName: d.name,
    categoryName: d.categoryName ?? '-',
    sparePartCount: 0,
    stockStatus: 'ok',
    imageUrl: toAbsoluteUrl(d.imageUrl),
    explodedDiagramUrl: d.explodedDiagramUrl ? toAbsoluteUrl(d.explodedDiagramUrl) : null
  }
}

export async function fetchStockProductSpareParts(id: string): Promise<StockSparePartListItemDto[]> {
  const json = await apiJson<{ success?: boolean; data?: any[] }>(`/api/stock/products/${id}/spare-parts`)
  return (json?.data ?? []).map(x => ({
    ...x,
    imageUrl: toAbsoluteUrl(x.imageUrl)
  }))
}

/**
 * Legacy complete load function for backward compatibility in Saha/Atolye forms
 */
export async function fetchStockItems(q?: string): Promise<StockItemDto[]> {
  /*
    ORTAK KATALOG ÖNBELLEĞİNİ KULLANIR (2026-08-26).

    Burada ayrı bir `pageSize=5000` isteği atılıyordu. ERP `maxPageSize`'ı 2000'e kırptığı
    için yanıt `fetchErpProducts`'ınkiyle BİREBİR AYNIYDI: Saha Arıza açılışında aynı
    1,1 MB'lık katalog iki kez iniyordu (ölçüm: 3,78 sn + 2,57 sn).

    Artık ikisi de `fetchErpProductsRaw` üzerinden geçiyor; ikinci çağrı ilkinin sonucunu
    kullanıyor. Ayrıştırma ve `StockItemDto` eşlemesi aşağıda aynen duruyor — bu fonksiyonun
    döndürdüğü veri değişmedi.
  */
  const raw = await fetchErpProductsRaw(q)

  try {
    if (!Array.isArray(raw)) return []

    const seen = new Set<string>()
    const items: StockItemDto[] = []

    for (const p of raw) {
      const id = String(p.id ?? '')
      if (!id || seen.has(id)) continue
      seen.add(id)

      const name = String(p.name ?? '').trim()
      const stockCode = String(p.stockCode ?? '').trim()
      const kod4 = p.kod4 ? String(p.kod4).trim() : null
      const kod5 = p.kod5 ? String(p.kod5).trim() : null
      const unitPrice = typeof p.price === 'number' ? p.price : (typeof p.unitPrice === 'number' ? p.unitPrice : null)

      const parentCodes: string[] = []
      if (kod5 && kod5.includes(':')) {
        const codesFromKod5 = kod5.split('|')
          .filter(Boolean)
          .map(item => item.includes(':') ? item.split(':')[0].trim() : item.trim())
          .filter(Boolean)
        parentCodes.push(...codesFromKod5)
      } else if (kod5 && !looksLikeUrl(kod5)) {
        parentCodes.push(...kod5.split(/[|,;]/).map(s => s.trim()).filter(Boolean))
      }

      if (kod4 && !looksLikeUrl(kod4)) {
        parentCodes.push(...kod4.split(/[|,;]/).map(s => s.trim()).filter(Boolean))
      }
      if (p.parentStockCode) parentCodes.push(...String(p.parentStockCode).split(/[|,;]/).map(s => s.trim()).filter(Boolean))
      if (p.parentProductCode) parentCodes.push(...String(p.parentProductCode).split(/[|,;]/).map(s => s.trim()).filter(Boolean))

      const derivedParentStockCode = Array.from(new Set(parentCodes.filter(Boolean))).join(',')

      const prodTypeClean = cleanStr(p.productType || p.type)
      const groupCodeClean = cleanStr(p.groupCode)

      const isSparePartByProductType = prodTypeClean.includes('yedek') || prodTypeClean.includes('parca') || prodTypeClean.includes('spare')
      const isSparePartByGroup = groupCodeClean.includes('yedek') || groupCodeClean.includes('parca') || groupCodeClean.includes('servis') || groupCodeClean.includes('spare') || groupCodeClean.includes('malzeme')
      const isSparePartByKod4 = Boolean(kod4 && !looksLikeUrl(kod4))
      const isSparePartByKod5 = Boolean(kod5 && !looksLikeUrl(kod5))
      const isSparePartByParent = Boolean(derivedParentStockCode)

      const isSparePart = isSparePartByGroup || isSparePartByKod4 || isSparePartByKod5 || isSparePartByParent || isSparePartByProductType

      if (isSparePart) {
        items.push({
          type: 'SparePart',
          id,
          productId: derivedParentStockCode || kod4 || '',
          productName: derivedParentStockCode || kod4 || '',
          name,
          partNumber: stockCode || null,
          quantity: typeof p.stock === 'number' ? p.stock : (typeof p.quantity === 'number' ? p.quantity : null),
          minStockLevel: typeof p.minStock === 'number' ? p.minStock : null,
          explodedViewPartNumber: kod5,
          explodedDiagramUrl: p.explodedDiagramUrl ? toAbsoluteUrl(p.explodedDiagramUrl) : null,
          imageUrl: toAbsoluteUrl(p.imageUrl),
          parentStockCode: derivedParentStockCode || null,
          unitPrice,
          groupCode: p.groupCode || null
        })
      } else {
        items.push({
          type: 'Product',
          id,
          productId: stockCode || id,
          productName: name,
          name,
          partNumber: stockCode || null,
          quantity: null,
          minStockLevel: null,
          explodedViewPartNumber: kod5,
          explodedDiagramUrl: p.explodedDiagramUrl ? toAbsoluteUrl(p.explodedDiagramUrl) : toAbsoluteUrl(looksLikeUrl(kod4 ?? '') ? kod4 : null),
          imageUrl: toAbsoluteUrl(p.imageUrl),
          parentStockCode: null,
          unitPrice,
          groupCode: p.groupCode || null
        })
      }
    }

    return items
  } catch {
    return []
  }
}
