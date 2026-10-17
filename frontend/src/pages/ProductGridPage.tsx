import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import { Eye, Pencil, Trash2, BarChart2, TrendingUp, AlertTriangle, Search, Info } from 'lucide-react'
import Table, { type TableColumn } from '../components/Table'
import Modal from '../components/Modal'
import FormInput from '../components/forms/FormInput'
import FormSelect from '../components/forms/FormSelect'
import FormSearchableSelect from '../components/forms/FormSearchableSelect'
import { useProducts } from '../hooks/useProducts'
import { fetchPriceGroups } from '../api/priceGroups'
import { fetchProductPricesByProducts } from '../api/productPrices'
import { f4FiyatHaritasi, f4FiyatiOku, type F4Fiyat } from '../utils/f4Fiyat'
import { resolveProductSalesCurrency } from '../utils/productCurrency'
import { useProductCategories } from '../hooks/useProductCategories'
import { fetchSuppliers, type SupplierDto } from '../api/suppliers'
import SearchableCariSelect, { type CariOption } from '../components/SearchableCariSelect'
import { fetchWarehousesDropdownForStock, fetchAuthorizedStockBalances, type WarehouseDropdownItem } from '../api/warehouses'
import { fetchCustomersDropdown, type CustomerDto } from '../api/customers'

import NotificationPopup, { type NotificationVariant } from '../components/NotificationPopup'

import { API_BASE_URL, apiUrl } from '../config/api'
// Aktif/Pasif ile Satisa Acik ayrimi ve BSY kurali TEK KAYNAKTA — bkz. utils/productSaleStatus.ts
import { closedToSaleReasonLabel, isClosedToSale as isClosedToSaleRule, resolveAutoCloseThreshold } from '../utils/productSaleStatus'
import { ShipSailingAnimation } from '../components/ShipSailingAnimation'

type EditForm = {
  id?: string
  stockCode: string
  name: string
  /** Vitrin (e-ticaret) adı; boşsa vitrin ürün adını gösterir. */
  displayName: string
  mainCategory: string
  subCategory: string
  barcode: string
  minStock: string
  bsyMinStock: string
  taxRate: string
  discountRate: string
  supplierId: string
  boxQuantity: string
  purchasePrice: string
  bsyVisibleFlag: 'E' | 'H'
  containerQuantity: string
  freight: string
  // Para birimi: 1=TRY 2=EUR 3=USD 4=GBP (tek kodlama, 2026-08-14). Eskiden 0/43/2/3 idi.
  currencyCode: '1' | '2' | '3' | '4'
  /** Satış para birimi — alıştan bağımsız. */
  salesCurrencyCode: '1' | '2' | '3' | '4'
  stock: string
  status: 'active' | 'passive'
  description: string
  features: string
  imageUrls: string[]
  videoUrls: string[]
  isInstallable: boolean
  installationFee: string
}

type ImageItem = {
  key: string
  url?: string
  file?: File
  previewUrl?: string
}

async function uploadImageFile(file: File) {
  const token = localStorage.getItem('accessToken') ?? ''
  const fd = new FormData()
  fd.append('file', file)

  const res = await fetch(`${API_BASE_URL}/api/uploads/images`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`
    },
    body: fd
  })

  if (!res.ok) {
    const t = String(await res.text().catch(() => '')).trim()
    throw new Error(getFriendlyApiError(t, res.status))
  }

  const json: any = await res.json().catch(() => ({}))
  const url = String(json?.url ?? '').trim()
  if (!url) throw new Error('Görsel yüklenemedi')
  return url
}

type VideoItem = {
  key: string
  url?: string
  file?: File
}

export type ParentProductLink = {
  parentStockCode: string
  explodedViewPartNo: string
}

type SparePartForm = {
  id?: string
  parentStockCode: string
  name: string
  stockCode: string
  mainCategory: string
  subCategory: string
  minStockLevel: string
  explodedViewPartNo: string
  parentLinks?: ParentProductLink[]
  supplierId: string
  barcode: string
  taxRate: string
  discountRate: string
  boxQuantity: string
  purchasePrice: string
  bsyVisibleFlag: 'E' | 'H'
  containerQuantity: string
  freight: string
  // Para birimi: 1=TRY 2=EUR 3=USD 4=GBP (tek kodlama, 2026-08-14). Eskiden 0/43/2/3 idi.
  currencyCode: '1' | '2' | '3' | '4'
  /** Satış para birimi — alıştan bağımsız. */
  salesCurrencyCode: '1' | '2' | '3' | '4'
  status: 'active' | 'passive'
  description: string
  isInstallable: boolean
  installationFee: string
  existingImageUrl?: string
}

export function parseParentLinks(kod4?: string, kod5?: string): ParentProductLink[] {
  const k4 = String(kod4 ?? '').trim()
  const k5 = String(kod5 ?? '').trim()

  if (!k4 && !k5) return []

  // Check if kod5 has formatted mapping style "CAMASIR_01:A-101|CAMASIR_02:B-202"
  if (k5.includes(':') || k5.includes('|')) {
    const items = k5.split('|').filter(Boolean)
    const links: ParentProductLink[] = []
    for (const item of items) {
      if (item.includes(':')) {
        const [pCode, pNo] = item.split(':')
        links.push({ parentStockCode: pCode.trim(), explodedViewPartNo: (pNo || '').trim() })
      } else {
        links.push({ parentStockCode: '', explodedViewPartNo: item.trim() })
      }
    }
    if (links.length > 0) return links
  }

  // Comma separated kod4 and kod5
  const k4Parts = k4 ? k4.split(',').map((x) => x.trim()).filter(Boolean) : []
  const k5Parts = k5 ? k5.split(',').map((x) => x.trim()).filter(Boolean) : []

  const maxLen = Math.max(k4Parts.length, k5Parts.length)
  if (maxLen === 0) return []

  const links: ParentProductLink[] = []
  for (let i = 0; i < maxLen; i++) {
    links.push({
      parentStockCode: k4Parts[i] ?? '',
      explodedViewPartNo: k5Parts[i] ?? ''
    })
  }
  return links
}

function normalizeStatus(isActive: boolean | undefined) {
  return isActive === false ? 'passive' : 'active'
}

/**
 * "Satışa Açık" alanı — `Durum` (aktif/pasif) alanının YANINDA, ayrı bir soru.
 *
 * Pasif üründe kilitli ve "Hayır": pasifin satışa açık olması diye bir şey yok, sunucu da
 * kaydederken 'H'ye zorluyor. Kilitlemezsek kullanıcı "Evet" seçip kaydediyor ve değerin
 * sessizce değiştiğini görüyordu.
 *
 * Stok eşiğinin altındaki üründe alan AÇIK kalır ama altına uyarı düşer: o ürün "Evet" seçili
 * olsa bile fiilen satışa kapalıdır (stok kuralı hesaplanır, karta yazılmaz — stok toparlayınca
 * ürün kendiliğinden açılsın diye).
 */
function renderSatisaAcikField(
  form: { status: 'active' | 'passive'; bsyVisibleFlag: 'E' | 'H' },
  onChange: (value: 'E' | 'H') => void,
  stock?: string | number | null,
  bsyMinStock?: string | number | null
) {
  const isPassive = form.status === 'passive'
  // Stok BİLİNMİYOR olabilir (yedek parça formunda alan yok, yeni üründe henüz girilmemiş).
  // Boş değeri 0 saymak, her karta yanlışlıkla "eşiğin altında" uyarısı düşürüyordu.
  const stockRaw = String(stock ?? '').trim().replace(',', '.')
  const stockNumber = stockRaw === '' ? Number.NaN : Number(stockRaw)
  const threshold = resolveAutoCloseThreshold({ bsyMinStock })
  const belowThreshold = !isPassive && Number.isFinite(stockNumber) && stockNumber < threshold

  return (
    <div className="space-y-1">
      <FormSelect
        label="Satışa Açık"
        value={isPassive ? 'H' : form.bsyVisibleFlag}
        disabled={isPassive}
        onChange={(e) => onChange(e.target.value === 'H' ? 'H' : 'E')}
        options={[
          { value: 'E', label: 'Evet' },
          { value: 'H', label: 'Hayır' }
        ]}
      />
      {isPassive ? (
        <p className="text-[11px] text-gray-500">Pasif ürün her koşulda satışa kapalıdır.</p>
      ) : belowThreshold ? (
        <p className="text-[11px] font-semibold text-amber-700">
          Stok {threshold} adedin altında — bu ürün "Evet" seçili olsa da bayi
          tarafında satışa kapalı sayılır. Stok {threshold} ve üzerine çıkınca
          kendiliğinden açılır.
        </p>
      ) : (
        <p className="text-[11px] text-gray-500">
          "Hayır" seçilirse bayi tarafında rol yetkilerindeki BSY kuralları devreye girer.
        </p>
      )}
    </div>
  )
}

function metaToKey(s: string) {
  return String(s ?? '')
    .trim()
    .toUpperCase()
    .replace(/İ/g, 'I')
    .replace(/ı/g, 'I')
    .replace(/Ğ/g, 'G')
    .replace(/ğ/g, 'G')
    .replace(/Ü/g, 'U')
    .replace(/ü/g, 'U')
    .replace(/Ş/g, 'S')
    .replace(/ş/g, 'S')
    .replace(/Ö/g, 'O')
    .replace(/ö/g, 'O')
    .replace(/Ç/g, 'C')
    .replace(/ç/g, 'C')
    .replace(/\s+/g, ' ')
}

function categoryToKey(s: string) {
  return metaToKey(s).replace(/\s+/g, '_')
}

function categoryKeyVariants(label: string) {
  const raw = String(label ?? '').trim()
  if (!raw) return [] as string[]

  const normSpace = metaToKey(raw)
  const normUnderscore = categoryToKey(raw)
  const rawUpper = raw.toUpperCase()
  const rawUnderscore = raw.replace(/\s+/g, '_')
  const rawUnderscoreUpper = rawUnderscore.toUpperCase()

  return Array.from(new Set([raw, rawUpper, normSpace, normUnderscore, rawUnderscore, rawUnderscoreUpper]))
}

function sanitizeIntText(input: string, opts?: { maxDigits?: number }) {
  const maxDigits = opts?.maxDigits ?? 10
  const raw = String(input ?? '')
  return raw.replace(/[^0-9]/g, '').slice(0, maxDigits)
}

function parseNumber(s: string, fallback: number) {
  const n = Number(String(s ?? '').replace(',', '.'))
  return Number.isFinite(n) ? n : fallback
}

function parseIntOrThrow(value: string, fieldName: string) {
  const n = parseNumber(value, NaN)
  if (!Number.isFinite(n)) throw new Error(`${fieldName} sayısal olmalı.`)
  return Math.trunc(n)
}

function parseFloatOrThrow(value: string, fieldName: string) {
  const n = parseNumber(value, NaN)
  if (!Number.isFinite(n)) throw new Error(`${fieldName} sayısal olmalı.`)
  return n
}

function sanitizeDecimalInput(input: string, opts: { max: number; decimals: number }) {
  const raw = String(input ?? '')

  // Keep digits and separators only.
  let cleaned = raw.replace(/[^0-9,\.]/g, '')

  // Keep only the first separator.
  const firstComma = cleaned.indexOf(',')
  const firstDot = cleaned.indexOf('.')
  const sepIndex = firstComma === -1 ? firstDot : firstDot === -1 ? firstComma : Math.min(firstComma, firstDot)

  if (sepIndex >= 0) {
    const sep = cleaned[sepIndex]
    const left = cleaned.slice(0, sepIndex).replace(/[^0-9]/g, '')
    const right = cleaned
      .slice(sepIndex + 1)
      .replace(/[^0-9]/g, '')
      .slice(0, Math.max(0, opts.decimals))
    cleaned = left + sep + right
  } else {
    cleaned = cleaned.replace(/[^0-9]/g, '')
  }

  const endsWithSep = raw.endsWith(',') || raw.endsWith('.')
  const normalized = cleaned.replace(',', '.')
  const parsed = Number(normalized)
  if (!Number.isFinite(parsed)) return endsWithSep ? cleaned.replace(',', '.') : cleaned.replace(',', '.')

  const clamped = Math.min(opts.max, Math.max(0, parsed))
  if (endsWithSep) return String(Math.floor(clamped)) + '.'

  // keep user's decimals (up to max)
  const hasSep = cleaned.includes(',') || cleaned.includes('.')
  if (!hasSep) return String(Math.floor(clamped))

  const parts = normalized.split('.')
  const intPart = String(Math.floor(clamped))
  const decPart = String(parts[1] ?? '').slice(0, opts.decimals)
  return decPart ? `${intPart}.${decPart}` : intPart
}

function getFriendlyApiError(text: string, status: number) {
  const t = String(text ?? '').trim()
  if (!t) return `İşlem gerçekleştirilemedi (${status})`

  if (t.startsWith('{') || t.startsWith('[')) {
    try {
      const j = JSON.parse(t)
      const errors = j?.errors
      if (errors && typeof errors === 'object') {
        const entries = Object.entries(errors as Record<string, unknown>)
        const messages: string[] = []
        for (const [k, v] of entries) {
          const arr = Array.isArray(v) ? v : [v]
          const msg = String(arr[0] ?? '').trim()
          if (!msg) continue

          const field = String(k ?? '').trim()
          const label =
            field.toLowerCase() === 'stock'
              ? 'Stok'
              : field.toLowerCase() === 'stockcode'
                ? 'Ürün kodu'
                : field.toLowerCase() === 'name'
                  ? 'Ürün adı'
                  : field.toLowerCase() === 'taxrate'
                    ? 'KDV oranı'
                    : field.toLowerCase() === 'barcode'
                      ? 'Barkod'
                      : field

          messages.push(label ? `${label}: ${msg}` : msg)
        }
        if (messages.length > 0) return messages[0]
      }

      const m = j?.message || j?.error || j?.title
      if (typeof m === 'string' && m.trim()) return m.trim()
    } catch {
      return `İşlem gerçekleştirilemedi (${status})`
    }
  }

  return t
}

function normalizeKey(value: unknown) {
  return String(value ?? '')
    .trim()
    .toUpperCase()
    .replace(/İ/g, 'I')
    .replace(/İ/g, 'I')
    .replace(/ı/g, 'I')
    .replace(/Ğ/g, 'G')
    .replace(/ğ/g, 'G')
    .replace(/Ü/g, 'U')
    .replace(/ü/g, 'U')
    .replace(/Ş/g, 'S')
    .replace(/ş/g, 'S')
    .replace(/Ö/g, 'O')
    .replace(/ö/g, 'O')
    .replace(/Ç/g, 'C')
    .replace(/ç/g, 'C')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
}

export default function ProductGridPage() {
  const navigate = useNavigate()
  const layoutContext = useOutletContext<{ allowedKeys?: Set<string> } | null>()
  const canBsyHHide = Boolean(layoutContext?.allowedKeys?.has('invoice/bsyHHide'))
  const canBsyHComingSoon = Boolean(layoutContext?.allowedKeys?.has('invoice/bsyHComingSoon'))

  const [modalActiveTab, setModalActiveTab] = useState<'general' | 'price' | 'stock' | 'media' | 'links'>('general')

  const isImageUrl = (url: unknown) => {
    const s = String(url ?? '').trim().toLowerCase()
    return s.startsWith('http://') || 
           s.startsWith('https://') || 
           s.startsWith('blob:') || 
           s.startsWith('data:') || 
           s.startsWith('/uploads/')
  }

  const toImageSrc = (url: unknown) => {
    const s = String(url ?? '').trim()
    if (!s) return ''
    if (s.startsWith('http://') || s.startsWith('https://') || s.startsWith('blob:') || s.startsWith('data:')) return s
    return apiUrl(s)
  }

  const uploadProductImage = async (file: File) => {
    const token = localStorage.getItem('accessToken') ?? ''
    const fd = new FormData()
    fd.append('file', file)

    const res = await fetch(`${API_BASE_URL}/api/products/upload-image`, {
      method: 'POST',
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: fd
    })

    const text = await res.text().catch(() => '')
    if (!res.ok) {
      throw new Error(getFriendlyApiError(text, res.status))
    }

    const j = text ? JSON.parse(text) : null
    const url = String(j?.url ?? '').trim()
    if (!url) throw new Error('Görsel yükleme başarısız: URL dönmedi')
    return url
  }
  /**
   * `fetchAllPages` — SÜZGEÇLER TÜM KÜMEYİ TARASIN (2026-08-22).
   *
   * Bu ekranda hem üstteki Durum/Tip/Tedarikçi süzgeçleri hem de tablo sütun süzgeçleri
   * İSTEMCİDE çalışıyor. Sunucudan tek sayfa (100 satır) gelince bu süzgeçler yalnızca o
   * pencereyi tarıyordu: 1.217 ürünün 100'ü. "Tablo filtrelemeleri bozuk" ve "yeni eklenen
   * ürünler gelmiyor" şikâyetlerinin ikisi de bundandı — ürün 4. sayfadayken süzgeç onu
   * göremiyordu.
   *
   * Kategori ve arama sunucuda uygulanmaya DEVAM ediyor; burada yalnızca o sonucun tamamı
   * sayfa sayfa toplanıyor.
   */
  const productsQuery = useProducts({ defaultIncludeInactive: true, defaultPageSize: 200, fetchAllPages: true })

  /*
    FIYAT SUTUNU FIYAT 4'E GORE (2026-08-24, kullanici istegi).

    Sutun `displayUnitPrice` alanini tercih ediyordu; o alan yalnizca rolunde
    "siparisSadeceFiyat4Gorsun" yetkisi olan kullaniciya doluyor. Sunucu, istemcinin
    gonderdigi `displayPriceGroupCode` parametresini YOK SAYIP yetkiye gore kendisi
    karar veriyor (ProductsController). Yani parametre gecerek cozulemez.

    Bu yuzden F4 fiyati burada, urun fiyatlarindan cikariliyor. Hangi grubun "Fiyat 4"
    sayilacagi `utils/f4Fiyat.ts` icinde tek kaynakta.
  */
  const [f4PriceByProductId, setF4PriceByProductId] = useState<Record<string, F4Fiyat>>({})

  useEffect(() => {
    const ac = new AbortController()

    void (async () => {
      try {
        const ids = (productsQuery.items ?? [])
          .map((p: any) => String(p?.id ?? '').trim())
          .filter(Boolean)

        if (ids.length === 0) {
          setF4PriceByProductId({})
          return
        }

        const gruplar = await fetchPriceGroups({ includeInactive: true })
        if (ac.signal.aborted) return

        const fiyatlar = await fetchProductPricesByProducts(ids)
        if (ac.signal.aborted) return

        setF4PriceByProductId(f4FiyatHaritasi(gruplar as any, fiyatlar as any))
      } catch {
        if (ac.signal.aborted) return
        // F4 cozulemezse sutun eski davranisina duser (asagida `unitPrice`).
        setF4PriceByProductId({})
      }
    })()

    return () => ac.abort()
  }, [productsQuery.items])
  const { data: categories } = useProductCategories()

  const mainCategoryOptions = useMemo(() => {
    const opts = categories.mains.map((m) => ({ value: m, label: m }))
    return [{ value: '', label: 'Tümü' }, ...opts]
  }, [categories.mains])

  const getSubsForMain = (mainLabel: string) => {
    const map = categories.subsByMain as Record<string, string[]>
    const keys = categoryKeyVariants(mainLabel)
    for (const k of keys) {
      const v = map[k]
      if (Array.isArray(v) && v.length) return v
    }
    return []
  }

  const getSubOptions = (main: string) => {
    const subs = getSubsForMain(main)
    const out = subs.map((s) => ({ value: s, label: s }))
    out.sort((a, b) => a.label.localeCompare(b.label, 'tr'))
    return [{ value: '', label: 'Tümü' }, ...out]
  }

  const getAllSubOptions = () => {
    const out: Array<{ value: string; label: string }> = []
    const seen = new Set<string>()

    categories.mains.forEach((main) => {
      const subs = getSubsForMain(main)
      subs.forEach((s) => {
        const key = normalizeKey(s)
        if (!key) return
        if (seen.has(key)) return
        seen.add(key)
        out.push({ value: s, label: `${s} (${main})` })
      })
    })

    out.sort((a, b) => a.label.localeCompare(b.label, 'tr'))
    return [{ value: '', label: 'Tümü' }, ...out]
  }

  const filterMain = productsQuery.main || ''
  const filterSub = productsQuery.sub || ''
  const [search, setSearch] = useState(productsQuery.q || '')

  useEffect(() => {
    setSearch(productsQuery.q || '')
  }, [productsQuery.q])
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'passive'>('all')
  const [typeFilter, setTypeFilter] = useState<'all' | 'product' | 'spare'>('all')
  const [supplierFilter, setSupplierFilter] = useState('all')
  const [parentProductFilter, setParentProductFilter] = useState('')

  const parentProductOptions = useMemo(() => {
    const map = new Map<string, string>()

    for (const p of productsQuery.items ?? []) {
      const rawGroup = String(p?.groupCode ?? '').trim().toLowerCase().replace(/_/g, ' ')
      const pType = String(p?.productType ?? '').trim().toUpperCase()
      const hasPartNo = String(p?.kod5 ?? '').trim().length > 0
      const kod4Val = String(p?.kod4 ?? '').trim()
      const hasParentStock = kod4Val.length > 0 && !isImageUrl(kod4Val)

      const isSpare = pType === 'YEDEKPARCA' || 
                      rawGroup === 'servis yedek parca malzeme' || 
                      hasPartNo || 
                      hasParentStock

      if (!isSpare && p.stockCode) {
        map.set(String(p.stockCode).trim(), `${p.stockCode} - ${p.name || ''}`)
      }

      if (isSpare && hasParentStock) {
        for (const code of kod4Val.split(',')) {
          const trimmed = code.trim()
          if (trimmed && !map.has(trimmed)) {
            map.set(trimmed, trimmed)
          }
        }
      }
    }

    const options = Array.from(map.entries()).map(([value, label]) => ({ value, label }))
    options.sort((a, b) => a.label.localeCompare(b.label, 'tr'))
    return [{ value: '', label: 'Tüm Bağlı Ürünler' }, ...options]
  }, [productsQuery.items])

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase()
    return productsQuery.items.filter((p) => {
      // BSY (H) Rule: On the Product Management screen, we do NOT hide passive products so they can be managed.


      const name = String(p.name ?? '').toLowerCase()
      const stockCode = String(p.stockCode ?? '').toLowerCase()
      const barcode = String(p.barcode ?? '').toLowerCase()
      const groupCode = String(p.groupCode ?? '').toLowerCase()
      const subGroupCode = String(p.subGroupCode ?? '').toLowerCase()
      const description = String(p.description ?? '').toLowerCase()
      const kod4 = String(p.kod4 ?? '').toLowerCase()
      const kod5 = String(p.kod5 ?? '').toLowerCase()

      const matchesQ = !q ||
        name.includes(q) ||
        stockCode.includes(q) ||
        barcode.includes(q) ||
        groupCode.includes(q) ||
        subGroupCode.includes(q) ||
        description.includes(q) ||
        kod4.includes(q) ||
        kod5.includes(q)

      const matchesMain = !filterMain || normalizeKey(p.groupCode) === normalizeKey(filterMain)
      const matchesSub = !filterSub || normalizeKey(p.subGroupCode) === normalizeKey(filterSub)
      const isActive = p.isActive !== false
      const matchesStatus = statusFilter === 'all' || (statusFilter === 'active' ? isActive : !isActive)

      let matchesType = true
      if (typeFilter !== 'all') {
        const rawGroup = String(p?.groupCode ?? '').trim().toLowerCase().replace(/_/g, ' ')
        const pType = String(p?.productType ?? '').trim().toUpperCase()
        const hasPartNo = String(p?.kod5 ?? '').trim().length > 0
        const kod4Val = String(p?.kod4 ?? '').trim()
        const hasParentStock = kod4Val.length > 0 && !isImageUrl(kod4Val)

        const isSpare = pType === 'YEDEKPARCA' || 
                        rawGroup === 'servis yedek parca malzeme' || 
                        hasPartNo || 
                        hasParentStock

        if (typeFilter === 'spare') {
          matchesType = isSpare
        } else if (typeFilter === 'product') {
          matchesType = !isSpare
        }
      }

      const matchesSupplier = supplierFilter === 'all' || String(p.supplierId) === supplierFilter

      const matchesParentProduct = !parentProductFilter || (() => {
        const targetCode = parentProductFilter.trim().toLowerCase()
        const currentStockCode = String(p.stockCode ?? '').trim().toLowerCase()
        if (currentStockCode === targetCode) return true

        const kod4Str = String(p.kod4 ?? '').trim().toLowerCase()
        if (!kod4Str || isImageUrl(kod4Str)) return false
        return kod4Str.split(',').some(c => c.trim() === targetCode)
      })()

      return matchesQ && matchesMain && matchesSub && matchesStatus && matchesType && matchesSupplier && matchesParentProduct
    })
  }, [filterMain, filterSub, productsQuery.items, search, statusFilter, typeFilter, supplierFilter, parentProductFilter, canBsyHHide])

  const [modalOpen, setModalOpen] = useState(false)
  const [modalMode, setModalMode] = useState<'create' | 'edit'>('create')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  type ExcelImportRowError = {
    rowNumber: number
    stockCode?: string | null
    errors: string[]
  }

  type ExcelImportResult = {
    successCount: number
    rowErrors: ExcelImportRowError[]
  }

  const [popupOpen, setPopupOpen] = useState(false)
  const [popupVariant, setPopupVariant] = useState<NotificationVariant>('info')
  const [popupTitle, setPopupTitle] = useState('')
  const [popupMessage, setPopupMessage] = useState('')

  const [excelImportBusy, setExcelImportBusy] = useState(false)
  const [excelImportOpen, setExcelImportOpen] = useState(false)
  const [excelImportResult, setExcelImportResult] = useState<ExcelImportResult | null>(null)
  const excelFileInputRef = React.useRef<HTMLInputElement | null>(null)

  // Product Analysis state
  const [analysisModalOpen, setAnalysisModalOpen] = useState(false)
  const [selectedAnalysisProductId, setSelectedAnalysisProductId] = useState<string | null>(null)
  const [analysisData, setAnalysisData] = useState<any | null>(null)
  const [analysisLoading, setAnalysisLoading] = useState(false)
  const [analysisError, setAnalysisError] = useState<string | null>(null)
  const [analysisSearchQ, setAnalysisSearchQ] = useState('')
  const [analysisSupplierFilter, setAnalysisSupplierFilter] = useState('all')
  const [selectedAnalysisBayiCode, setSelectedAnalysisBayiCode] = useState('')
  const [analysisBayiler, setAnalysisBayiler] = useState<CustomerDto[]>([])
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null)
  const [coverImage, setCoverImage] = useState<ImageItem | null>(null)
  const [sideImages, setSideImages] = useState<ImageItem[]>([])
  const [imagePickerKey, setImagePickerKey] = useState(0)

  const [videoItems, setVideoItems] = useState<VideoItem[]>([])
  const [videoPickerKey, setVideoPickerKey] = useState(0)

  const buildHeaders = (includeJson: boolean) => {
    const headers: Record<string, string> = {}
    if (includeJson) headers['Content-Type'] = 'application/json'
    const token = localStorage.getItem('accessToken')
    if (token) headers.Authorization = `Bearer ${token}`
    return headers
  }

  const showPopup = (variant: NotificationVariant, title: string, message: string) => {
    setPopupVariant(variant)
    setPopupTitle(title)
    setPopupMessage(message)
    setPopupOpen(true)
  }

  const downloadExcel = async (url: string, filename: string) => {
    const res = await fetch(url, { headers: { ...buildHeaders(false) } })
    if (!res.ok) throw new Error(`Excel indirilemedi (${res.status})`)
    const blob = await res.blob()
    const href = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = href
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(href)
  }

  const startExcelImport = async (file: File) => {
    try {
      setExcelImportBusy(true)
      setExcelImportResult(null)

      const fd = new FormData()
      fd.append('file', file)

      const res = await fetch(`${API_BASE_URL}/api/products/excel-import`, {
        method: 'POST',
        headers: { ...buildHeaders(false) },
        body: fd
      })

      const json = await res.json().catch(() => null)
      if (!res.ok) {
        const msg = String(json?.message ?? json?.error ?? `Import başarısız (${res.status})`)
        throw new Error(msg)
      }

      const data = (json?.data ?? null) as ExcelImportResult | null
      setExcelImportResult(data)
      setExcelImportOpen(true)
      productsQuery.refetch()

      const okCount = Number(data?.successCount ?? 0)
      const errCount = Number(data?.rowErrors?.length ?? 0)
      showPopup('success', 'Import Tamamlandı', `Başarılı: ${okCount}\nHatalı: ${errCount}`)
    } catch (e: any) {
      showPopup('error', 'Import Hatası', String(e?.message ?? 'Bir hata oluştu'))
    } finally {
      setExcelImportBusy(false)
      if (excelFileInputRef.current) excelFileInputRef.current.value = ''
    }
  }
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null)

  const [mediaPreviewOpen, setMediaPreviewOpen] = useState(false)
  const [mediaPreviewTitle, setMediaPreviewTitle] = useState('')
  const [mediaPreviewDescription, setMediaPreviewDescription] = useState('')
  const [mediaPreviewImages, setMediaPreviewImages] = useState<string[]>([])
  const [mediaPreviewVideos, setMediaPreviewVideos] = useState<string[]>([])
  const [mediaActiveIndex, setMediaActiveIndex] = useState(0)

  const [suppliers, setSuppliers] = useState<SupplierDto[]>([])

  /*
    `SearchableCariSelect` kendi seçenek biçimini bekliyor: `value` + `label` + arama için
    `code`/`name`. Tedarikçi listesi id ile süzüldüğü için `value` yine ürün kartındaki
    `supplierId` olarak kalıyor; değişen yalnızca seçim biçimi.
  */
  const tedarikciSecenekleri = useMemo<CariOption[]>(
    () => suppliers.map((s) => ({
      value: String(s.id),
      label: `(${s.supplierCode}) ${s.fullName}`,
      code: String(s.supplierCode ?? ''),
      name: String(s.fullName ?? ''),
      type: 'supplier'
    })),
    [suppliers]
  )
  const [warehousesLoading, setWarehousesLoading] = useState(false)
  const [warehouses, setWarehouses] = useState<WarehouseDropdownItem[]>([])
  const [warehouseStocks, setWarehouseStocks] = useState<Record<string, string>>({})

  const [stockModalOpen, setStockModalOpen] = useState(false)
  const [stockModalProduct, setStockModalProduct] = useState<any | null>(null)
  const [stockModalLoading, setStockModalLoading] = useState(false)
  const [stockModalBalances, setStockModalBalances] = useState<Array<{ warehouseName: string; balance: number }>>([])
  const [stockModalError, setStockModalError] = useState<string | null>(null)

  const openStockModal = async (product: any) => {
    setStockModalProduct(product)
    setStockModalOpen(true)
    setStockModalLoading(true)
    setStockModalError(null)
    setStockModalBalances([])

    try {
      const data = await fetchAuthorizedStockBalances([product.stockCode])
      const whMap = new Map((data.warehouses ?? []).map((w: any) => [w.warehouseCode, w.name ?? `Depo ${w.warehouseCode}`]))
      const itemBalances = (data.items ?? []).find((x: any) => String(x.stockCode).toLowerCase() === String(product.stockCode).toLowerCase())?.balances ?? []
      
      const mapped = itemBalances.map((b: any) => ({
        warehouseName: whMap.get(b.warehouseCode) ?? `Depo ${b.warehouseCode}`,
        balance: b.balance
      }))
      const sorted = mapped.sort((a: any, b: any) => b.balance - a.balance)
      setStockModalBalances(sorted)
    } catch (e: any) {
      setStockModalError(e?.message ?? 'Depo stok bilgileri alınamadı.')
    } finally {
      setStockModalLoading(false)
    }
  }

  React.useEffect(() => {
    void (async () => {
      try {
        const list = await fetchSuppliers({ includeCustomers: true })
        setSuppliers(list)
      } catch {
        setSuppliers([])
      }
      try {
        const list = await fetchCustomersDropdown({ forOrder: true })
        setAnalysisBayiler(list)
      } catch {
        setAnalysisBayiler([])
      }
    })()
  }, [])

  React.useEffect(() => {
    const ac = new AbortController()
    void (async () => {
      try {
        setWarehousesLoading(true)
        const list = await fetchWarehousesDropdownForStock({ signal: ac.signal })
        setWarehouses(list ?? [])
        const initial: Record<string, string> = {}
        ;(list ?? []).forEach((w) => {
          initial[String(w.warehouseCode)] = ''
        })
        setWarehouseStocks(initial)
      } catch {
        setWarehouses([])
      } finally {
        setWarehousesLoading(false)
      }
    })()
    return () => ac.abort()
  }, [])

  const warehouseStockTotal = useMemo(() => {
    const sum = Object.values(warehouseStocks).reduce((acc, v) => acc + (Number(v) || 0), 0)
    return Number.isFinite(sum) && sum >= 0 ? sum : 0
  }, [warehouseStocks])

  const emptyForm: EditForm = {
    stockCode: '',
    name: '',
    displayName: '',
    mainCategory: '',
    subCategory: '',
    barcode: '',
    minStock: '0',
    bsyMinStock: '12',
    taxRate: '20',
    discountRate: '0',
    supplierId: '',
    boxQuantity: '0',
    purchasePrice: '0',
    bsyVisibleFlag: 'E',
    containerQuantity: '0',
    freight: '0',
    currencyCode: '1',
    salesCurrencyCode: '1',
    stock: '0',
    status: 'active',
    description: '',
    features: '',
    imageUrls: [],
    videoUrls: [],
    isInstallable: true,
    installationFee: '0'
  }

  const [form, setForm] = useState<EditForm>(emptyForm)

  /**
   * Loads the product's offer copy when the dialog opens for editing.
   *
   * The description shown here is that copy, not Products.Description — editing the two from one
   * box would leave a product with two different descriptions, only one of which reaches the
   * offer. Fetched on open rather than carried on every row of the grid.
   */
  useEffect(() => {
    const code = String(form.stockCode ?? '').trim()
    if (!modalOpen || modalMode !== 'edit' || !code) return

    const ac = new AbortController()
    void (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/products/${encodeURIComponent(code)}/detail`, {
          headers: { ...buildHeaders(false) },
          signal: ac.signal
        })
        if (!res.ok) return
        const json = await res.json()
        const d = json?.data ?? {}
        setForm((prev) => ({
          ...prev,
          description: String(d.description ?? prev.description ?? ''),
          features: String(d.features ?? '')
        }))
      } catch {
        // No copy yet is a normal state; the fields stay as they were.
      }
    })()
    return () => ac.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modalOpen, modalMode, form.stockCode])


  const [createType, setCreateType] = useState<'Product' | 'SparePart'>('Product')
  const [sparePartEditMode, setSparePartEditMode] = useState(false)
  const [sparePartImageFile, setSparePartImageFile] = useState<File | null>(null)
  const [sparePartImagePreviewUrl, setSparePartImagePreviewUrl] = useState<string>('')

  const emptySparePartForm: SparePartForm = {
    id: '',
    parentStockCode: '',
    name: '',
    stockCode: '',
    mainCategory: '',
    subCategory: '',
    minStockLevel: '0',
    explodedViewPartNo: '',
    parentLinks: [{ parentStockCode: '', explodedViewPartNo: '' }],
    supplierId: '',
    barcode: '',
    taxRate: '20',
    discountRate: '0',
    boxQuantity: '0',
    purchasePrice: '0',
    bsyVisibleFlag: 'E',
    containerQuantity: '0',
    freight: '0',
    currencyCode: '1',
    salesCurrencyCode: '1',
    status: 'active',
    description: '',
    isInstallable: false,
    installationFee: '',
    existingImageUrl: ''
  }
  const [sparePartForm, setSparePartForm] = useState<SparePartForm>(emptySparePartForm)
  const [explodedDiagramFile, setExplodedDiagramFile] = useState<File | null>(null)
  const [explodedDiagramPreviewUrl, setExplodedDiagramPreviewUrl] = useState<string>('')

  const getDefaultCategoryPair = () => {
    const main = categories.mains[0] ?? ''
    const subs = getSubsForMain(main)
    const sub = subs[0] ?? ''
    return { main, sub }
  }

  const openCreate = () => {
    const { main, sub } = getDefaultCategoryPair()
    setModalMode('create')
    setCreateType('Product')
    setSparePartEditMode(false)
    setSparePartImageFile(null)
    setSparePartImagePreviewUrl('')
    setForm({ ...emptyForm, mainCategory: main, subCategory: sub })
    setSparePartForm({ ...emptySparePartForm, mainCategory: main, subCategory: sub })
    setExplodedDiagramFile(null)
    setExplodedDiagramPreviewUrl('')
    setCoverImage(null)
    setSideImages([])
    setImagePickerKey((p) => p + 1)
    setVideoItems([])
    setVideoPickerKey((p) => p + 1)
    setError(null)
    setModalActiveTab('general')
    setModalOpen(true)
  }

  const openCreateSparePart = () => {
    const { main, sub } = getDefaultCategoryPair()
    setModalMode('create')
    setCreateType('SparePart')
    setSparePartEditMode(true)
    setSparePartImageFile(null)
    setSparePartImagePreviewUrl('')
    setForm({ ...emptyForm, mainCategory: main, subCategory: sub })
    setSparePartForm({ ...emptySparePartForm, mainCategory: main, subCategory: sub })
    setExplodedDiagramFile(null)
    setExplodedDiagramPreviewUrl('')
    setCoverImage(null)
    setSideImages([])
    setImagePickerKey((p) => p + 1)
    setVideoItems([])
    setVideoPickerKey((p) => p + 1)
    setError(null)
    setModalActiveTab('general')
    setModalOpen(true)
  }

  const fillDummyData = (isSparePart = false) => {
    const randomNum = Math.floor(100 + Math.random() * 900)
    const randomBarcode = '869' + Math.floor(1000000000 + Math.random() * 9000000000)

    const sampleProducts = [
      { name: 'Stilsoft Turbo Blender Seti', code: 'STLV-BLD' },
      { name: 'Stilsoft Dijital Ankastre Fırın', code: 'STLV-FRN' },
      { name: 'Stilsoft İndüksiyonlu Ankastre Ocak', code: 'STLV-OCK' },
      { name: 'Stilsoft Sessiz Robot Süpürge', code: 'STLV-SPR' },
      { name: 'Stilsoft Kahve Makinesi Pro', code: 'STLV-KHF' },
      { name: 'Stilsoft Akıllı Tost Makinesi', code: 'STLV-TST' },
    ]

    const sampleSpareParts = [
      { name: 'Yedek Motor Kartı', code: 'YDK-KRT' },
      { name: 'Paslanmaz Çelik Bıçak Takımı', code: 'YDK-BCK' },
      { name: 'Ateşleme Buji Seti', code: 'YDK-BUJ' },
      { name: 'Fırın Cam Kapağı ve Contası', code: 'YDK-CMP' },
      { name: 'Termostat Sensör Modülü', code: 'YDK-TRM' },
      { name: 'Hepa Filtre Takımı', code: 'YDK-FLT' },
    ]

    const mains = categories.mains.length ? categories.mains : ['BEYAZ ESYA']
    const main = mains[Math.floor(Math.random() * mains.length)]
    const subs = getSubsForMain(main)
    const sub = subs.length ? subs[0] : 'ANKASTRE'

    if (isSparePart || createType === 'SparePart') {
      const item = sampleSpareParts[Math.floor(Math.random() * sampleSpareParts.length)]
      const pCode = `${item.code}-${randomNum}`
      
      const existingProds = (productsQuery.items || []).filter((p: any) => p?.stockCode && String(p?.productType ?? '').toUpperCase() !== 'YEDEKPARCA')
      const p1 = existingProds[0]?.stockCode || 'STLV013'
      const p2 = existingProds[1]?.stockCode || 'STLV014'

      setSparePartForm({
        id: '',
        parentStockCode: `${p1},${p2}`,
        name: `${item.name} #${randomNum}`,
        stockCode: pCode,
        mainCategory: main,
        subCategory: sub,
        minStockLevel: '10',
        explodedViewPartNo: `${p1}:A-${randomNum}|${p2}:B-${randomNum}`,
        parentLinks: [
          { parentStockCode: p1, explodedViewPartNo: `A-${randomNum}` },
          { parentStockCode: p2, explodedViewPartNo: `B-${randomNum}` }
        ],
        supplierId: '',
        barcode: randomBarcode,
        taxRate: '20',
        discountRate: '0',
        bsyVisibleFlag: 'E',
        boxQuantity: '1',
        purchasePrice: '350',
        containerQuantity: '0',
        freight: '0',
        salesCurrencyCode: '1',
        currencyCode: '1',
        status: 'active',
        description: 'Test amaçlı otomatik oluşturulmuş yedek parça verisi.',
        isInstallable: false,
        installationFee: '',
        existingImageUrl: ''
      })
    } else {
      const item = sampleProducts[Math.floor(Math.random() * sampleProducts.length)]
      const pCode = `${item.code}-${randomNum}`

      setForm({
        id: '',
        displayName: '',
        stockCode: pCode,
        name: `${item.name} #${randomNum}`,
        mainCategory: main,
        subCategory: sub,
        barcode: randomBarcode,
        minStock: '5',
        bsyMinStock: '12',
        taxRate: '20',
        discountRate: '0',
        supplierId: '',
        boxQuantity: '1',
        purchasePrice: '2500',
        bsyVisibleFlag: 'E',
        containerQuantity: '0',
        freight: '0',
        salesCurrencyCode: '1',
        currencyCode: '1',
        stock: '50',
        status: 'active',
        description: 'Test amaçlı otomatik oluşturulmuş ürün verisi.',
        features: '',
        imageUrls: [],
        videoUrls: [],
        isInstallable: true,
        installationFee: '250'
      })
    }
  }

  const openCreateWithDummy = (isSparePart = false) => {
    if (isSparePart) {
      openCreateSparePart()
    } else {
      openCreate()
    }
    setTimeout(() => fillDummyData(isSparePart), 50)
  }

  React.useEffect(() => {
    if (!modalOpen) return
    if (modalMode !== 'create') return
    if (form.mainCategory) return
    const { main, sub } = getDefaultCategoryPair()
    if (!main) return
    setForm((p) => ({ ...p, mainCategory: main, subCategory: sub }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categories.mains, categories.subsByMain, modalMode, modalOpen])
  const openEdit = (p: any) => {
    const rawGroup = String(p?.groupCode ?? '').trim().toLowerCase().replace(/_/g, ' ')
    const pType = String(p?.productType ?? '').trim().toUpperCase()
    const hasPartNo = String(p?.kod5 ?? '').trim().length > 0
    const kod4Val = String(p?.kod4 ?? '').trim()
    const hasParentStock = kod4Val.length > 0 && !isImageUrl(kod4Val)

    const isSpare = pType === 'YEDEKPARCA' || 
                    rawGroup === 'servis yedek parca malzeme' || 
                    hasPartNo || 
                    hasParentStock
    if (isSpare) {
      const existingImg = String(p?.imageUrl ?? '').trim()
      const parsedLinks = parseParentLinks(p.kod4, p.kod5)
      setModalMode('edit')
      setSparePartEditMode(true)
      setCreateType('SparePart')
      setSparePartForm({
        id: String(p.id ?? ''),
        parentStockCode: String(p.kod4 ?? ''),
        name: String(p.name ?? ''),
        stockCode: String(p.stockCode ?? ''),
        mainCategory: String(p.groupCode ?? ''),
        subCategory: String(p.subGroupCode ?? ''),
        minStockLevel: String(p.minStock ?? 0),
        explodedViewPartNo: String(p.kod5 ?? ''),
        parentLinks: parsedLinks.length > 0 ? parsedLinks : [{ parentStockCode: String(p.kod4 ?? ''), explodedViewPartNo: String(p.kod5 ?? '') }],
        supplierId: p.supplierId == null ? '' : String(p.supplierId),
        barcode: String(p.barcode ?? ''),
        taxRate: String(p.taxRate ?? 20),
        discountRate: String(p.discountRate ?? 0),
        boxQuantity: String(p.boxQuantity ?? 0),
        purchasePrice: String(p.purchasePrice ?? 0),
        // Sunucu yalnizca 'E'/'H' kabul ediyor; eski kayitlardaki 'C'/'CS' de satisa kapali sayilir.
        bsyVisibleFlag: (String(p.bsyVisibleFlag ?? 'E').trim().toUpperCase() === 'E' ? 'E' : 'H') as 'E' | 'H',
        containerQuantity: String(p.containerQuantity ?? 0),
        freight: String(p.freight ?? 0),
        currencyCode: String((p as any).purchaseCurrencyCode ?? p.currencyCode ?? 1) === '3' ? '3' : String((p as any).purchaseCurrencyCode ?? p.currencyCode ?? 1) === '2' ? '2' : String((p as any).purchaseCurrencyCode ?? p.currencyCode ?? 1) === '4' ? '4' : '1',
        salesCurrencyCode: String(p.salesCurrencyCode ?? 1) === '3' ? '3' : String(p.salesCurrencyCode ?? 1) === '2' ? '2' : String(p.salesCurrencyCode ?? 1) === '4' ? '4' : '1',
        status: normalizeStatus(p.isActive),
        description: String(p.description ?? ''),
        isInstallable: Boolean(p.isInstallable),
        installationFee: String(p.installationFee ?? ''),
        existingImageUrl: existingImg
      })
      setSparePartImageFile(null)
      setSparePartImagePreviewUrl(existingImg)
      setCoverImage(existingImg ? { key: 'cover', url: existingImg } : null)
      setSideImages([])
      setImagePickerKey((p) => p + 1)
      setVideoItems([])
      setVideoPickerKey((p) => p + 1)
      setError(null)
      setModalActiveTab('general')
      setModalOpen(true)
      return
    }

    const rawArr = Array.isArray(p?.imageUrls) ? (p.imageUrls as unknown[]) : []
    const normalizedArr = rawArr.map((x) => String(x ?? '').trim()).filter(Boolean)
    const legacy = String(p?.imageUrl ?? '').trim()
    const combined = normalizedArr.length > 0 ? normalizedArr : legacy ? [legacy] : []

    const rawVideos = Array.isArray(p?.videoUrls) ? (p.videoUrls as unknown[]) : []
    const normalizedVideos = rawVideos.map((x) => String(x ?? '').trim()).filter(Boolean)
    const legacyVideo = String(p?.videoUrl ?? '').trim()
    const videosCombined = normalizedVideos.length > 0 ? normalizedVideos : legacyVideo ? [legacyVideo] : []

    setSparePartEditMode(false)
    setModalMode('edit')
    setCreateType('Product')
    const rawCurrency = String((p as any).purchaseCurrencyCode ?? p.currencyCode ?? 1)
    const currencyCode: EditForm['currencyCode'] = rawCurrency === '3' ? '3' : rawCurrency === '2' ? '2' : rawCurrency === '4' ? '4' : '1'

    setExplodedDiagramFile(null)
    setExplodedDiagramPreviewUrl(String(p?.kod4 ?? '').trim())

    setForm({
      ...emptyForm,
      id: String(p.id),
      stockCode: String(p.stockCode ?? ''),
      name: String(p.name ?? ''),
      mainCategory: String(p.groupCode ?? ''),
      subCategory: String(p.subGroupCode ?? ''),
      barcode: String(p.barcode ?? ''),
      minStock: String(p.minStock ?? 0),
      bsyMinStock: String((p as any).bsyMinStock ?? 12),
      taxRate: String(p.taxRate ?? 20),
      discountRate: String(p.discountRate ?? 0),
      supplierId: p.supplierId == null ? '' : String(p.supplierId),
      boxQuantity: String(p.boxQuantity ?? 0),
      purchasePrice: String(p.purchasePrice ?? 0),
      // Sunucu yalnizca 'E'/'H' kabul ediyor; eski kayitlardaki 'C'/'CS' de satisa kapali sayilir.
        bsyVisibleFlag: (String(p.bsyVisibleFlag ?? 'E').trim().toUpperCase() === 'E' ? 'E' : 'H') as 'E' | 'H',
      containerQuantity: String(p.containerQuantity ?? 0),
      freight: String(p.freight ?? 0),
      currencyCode,
      salesCurrencyCode: String(p.salesCurrencyCode ?? 1) === '3' ? '3' : String(p.salesCurrencyCode ?? 1) === '2' ? '2' : String(p.salesCurrencyCode ?? 1) === '4' ? '4' : '1',
      stock: String(p.stock ?? 0),
      status: normalizeStatus(p.isActive),
      description: String(p.description ?? ''),
      displayName: String((p as any).displayName ?? ''),
      // Replaced by the stored copy as soon as the dialog loads it.
      features: '',
      imageUrls: combined,
      videoUrls: videosCombined,
      isInstallable: Boolean(p.isInstallable),
      installationFee: String(p.installationFee ?? '')
    })
    setCoverImage(combined.length ? { key: 'cover', url: combined[0] } : null)
    setSideImages(combined.slice(1).map((url, idx) => ({ key: `img-${idx}`, url })))
    setVideoItems(videosCombined.map((url, idx) => ({ key: `vid-${idx}`, url })))
    setError(null)
    setModalActiveTab('general')
    setModalOpen(true)
  }

  const closeModal = () => {
    if (saving) return
    setModalOpen(false)
    setError(null)
    setForm(emptyForm)
    setSparePartForm(emptySparePartForm)
    setSparePartEditMode(false)
    setSparePartImageFile(null)
    setSparePartImagePreviewUrl('')
    setExplodedDiagramFile(null)
    setExplodedDiagramPreviewUrl('')
    setCoverImage(null)
    setSideImages([])
    setVideoItems([])
    setDeleteTarget(null)
  }

  const requestDelete = async (p: any) => {
    setDeleteTarget({ id: String(p.id), name: String(p.name ?? '') })
    setDeleteConfirmOpen(true)
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    try {
      setSaving(true)
      setError(null)
      const res = await fetch(`${API_BASE_URL}/api/products/${deleteTarget.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${localStorage.getItem('accessToken') ?? ''}` }
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(getFriendlyApiError(text, res.status))
      }
      productsQuery.refetch()
      setDeleteConfirmOpen(false)
      setDeleteTarget(null)
    } catch (e: any) {
      setError(String(e?.message ?? 'Ürün silinemedi'))
    } finally {
      setSaving(false)
    }
  }

  const submit = async () => {
    try {
      setSaving(true)
      setError(null)

      if ((modalMode === 'create' && createType === 'SparePart') || (modalMode === 'edit' && sparePartEditMode)) {
        const partName = String(sparePartForm.name ?? '').trim()
        const partStockCode = String(sparePartForm.stockCode ?? '').trim()
        const partMainCategory = String(sparePartForm.mainCategory ?? '').trim()
        const partSubCategory = String(sparePartForm.subCategory ?? '').trim()
        if (!partName) throw new Error('Parça adı zorunludur')
        if (!partStockCode) throw new Error('Stok kodu zorunludur')
        if (!partMainCategory) throw new Error('Ana kategori zorunludur')
        if (!partSubCategory) throw new Error('Alt kategori zorunludur')
        const minStockLevel = Math.max(0, Math.floor(Number(sparePartForm.minStockLevel) || 0))
        const validLinks = (sparePartForm.parentLinks || []).filter(
          (l) => l.parentStockCode.trim().length > 0 || l.explodedViewPartNo.trim().length > 0
        )
        const parentStockCode = validLinks.map((l) => l.parentStockCode.trim()).filter(Boolean).join(',')
        const explodedViewPartNo = validLinks
          .map((l) => {
            const pCode = l.parentStockCode.trim()
            const pNo = l.explodedViewPartNo.trim()
            if (pCode && pNo) return `${pCode}:${pNo}`
            return pNo || pCode
          })
          .filter(Boolean)
          .join('|')

        const taxRate = Number(String(sparePartForm.taxRate ?? '').replace(',', '.'))
        if (!Number.isFinite(taxRate)) throw new Error('KDV oranı geçersiz')
        const discountRate = Number(String(sparePartForm.discountRate ?? '').replace(',', '.'))
        if (!Number.isFinite(discountRate)) throw new Error('İskonto oranı geçersiz')

        const boxQuantityRaw = Number(String(sparePartForm.boxQuantity ?? '').replace(',', '.'))
        if (!Number.isFinite(boxQuantityRaw) || boxQuantityRaw < 0) throw new Error('Kutudaki adet geçersiz')
        const boxQuantity = Math.floor(boxQuantityRaw)

        const purchasePrice = Number(String(sparePartForm.purchasePrice ?? '').replace(',', '.'))
        if (!Number.isFinite(purchasePrice) || purchasePrice < 0) throw new Error('Alış fiyatı geçersiz')

        const containerQuantityRaw = Number(String(sparePartForm.containerQuantity ?? '').replace(',', '.'))
        if (!Number.isFinite(containerQuantityRaw) || containerQuantityRaw < 0) throw new Error('Konteynır adet geçersiz')
        const containerQuantity = Math.floor(containerQuantityRaw)

        const freight = Number(String(sparePartForm.freight ?? '').replace(',', '.'))
        if (!Number.isFinite(freight) || freight < 0) throw new Error('Navlun geçersiz')

        const currencyCode = sparePartForm.currencyCode === '3' ? 3 : sparePartForm.currencyCode === '2' ? 2 : sparePartForm.currencyCode === '4' ? 4 : 1
        const salesCurrencyCode = Number(sparePartForm.salesCurrencyCode ?? 1)
        const isInstallable = Boolean(sparePartForm.isInstallable)
        const installationFeeText = String(sparePartForm.installationFee ?? '').trim()
        const installationFee = installationFeeText ? Number(installationFeeText.replace(',', '.')) : null
        if (isInstallable && installationFee !== null && !Number.isFinite(installationFee)) throw new Error('Montaj fiyatı geçersiz')

        const supplierIdText = String(sparePartForm.supplierId ?? '').trim()
        const supplierId = supplierIdText ? Number(supplierIdText) : null
        if (supplierId !== null && !Number.isFinite(supplierId)) throw new Error('Tedarikçi seçimi geçersiz')

        const uploadedUrls: string[] = []

        if (coverImage?.file) {
          const u = await uploadProductImage(coverImage.file)
          uploadedUrls.push(u)
        } else if (String(coverImage?.url ?? '').trim()) {
          uploadedUrls.push(String(coverImage?.url ?? '').trim())
        } else if (sparePartImageFile) {
          const u = await uploadProductImage(sparePartImageFile)
          uploadedUrls.push(u)
        } else if (sparePartForm.existingImageUrl) {
          uploadedUrls.push(sparePartForm.existingImageUrl)
        }

        for (const it of sideImages) {
          if (it.file) {
            const u = await uploadProductImage(it.file)
            uploadedUrls.push(u)
            continue
          }
          const existing = String(it.url ?? '').trim()
          if (existing) uploadedUrls.push(existing)
        }

        const finalImages = Array.from(new Set(uploadedUrls.map((x) => String(x ?? '').trim()).filter(Boolean))).slice(0, 20)

        const spPayload: any = {
          stockCode: partStockCode,
          name: partName,
          groupCode: partMainCategory,
          subGroupCode: partSubCategory,
          productType: 'YEDEKPARCA',
          unit: 'ADET',
          taxRate,
          discountRate,
          // Pasif urun her kosulda satisa kapali (sunucu da zorluyor).
          bsyVisibleFlag: sparePartForm.status === 'passive' || sparePartForm.bsyVisibleFlag === 'H' ? 'H' : 'E',
          boxQuantity,
          purchasePrice,
          containerQuantity,
          freight,
          currencyCode,
          salesCurrencyCode,
          barcode: String(sparePartForm.barcode ?? '').trim() || null,
          minStock: minStockLevel,
          isActive: sparePartForm.status !== 'passive',
          isInstallable,
          installationFee: isInstallable ? installationFee : null,
          description: String(sparePartForm.description ?? '').trim() ? String(sparePartForm.description ?? '').trim() : null,
          supplierId,
          kod4: parentStockCode || null,
          kod5: explodedViewPartNo || null,
          imageUrls: finalImages.length > 0 ? finalImages : null,
          imageUrl: finalImages[0] ?? null
        }

        if (modalMode === 'create') {
          const initialStocks = Object.entries(warehouseStocks)
            .map(([code, qty]) => ({ warehouseCode: Number(code), quantity: Number(qty) || 0 }))
            .filter((x) => Number.isFinite(x.warehouseCode) && x.warehouseCode > 0 && x.quantity > 0)
          spPayload.initialStocks = initialStocks.length > 0 ? initialStocks : null
          const total = initialStocks.reduce((acc: number, x: any) => acc + Number(x.quantity ?? 0), 0)
          spPayload.stock = Number.isFinite(total) ? total : 0
        }

        const isEdit = modalMode === 'edit' && sparePartEditMode
        const spUrl = isEdit
          ? `${API_BASE_URL}/api/products/${String(sparePartForm.id ?? '').trim()}`
          : `${API_BASE_URL}/api/products`
        const spMethod = isEdit ? 'PUT' : 'POST'

        const spRes = await fetch(spUrl, {
          method: spMethod,
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${localStorage.getItem('accessToken') ?? ''}`
          },
          body: JSON.stringify(spPayload)
        })
        if (!spRes.ok) {
          const t = await spRes.text().catch(() => '')
          throw new Error(getFriendlyApiError(t, spRes.status))
        }
        closeModal()
        productsQuery.refetch()
        return
      }

      const stockCode = String(form.stockCode ?? '').trim()
      const name = String(form.name ?? '').trim()
      const groupCode = String(form.mainCategory ?? '').trim()
      const subGroupCode = String(form.subCategory ?? '').trim()
      if (!stockCode) throw new Error('Stok kodu zorunludur')
      if (!name) throw new Error('Ürün adı zorunludur')
      if (!groupCode) throw new Error('Ana kategori zorunludur')
      if (!subGroupCode) throw new Error('Alt kategori zorunludur')

      const taxRate = Number(String(form.taxRate ?? '').replace(',', '.'))
      if (!Number.isFinite(taxRate)) throw new Error('KDV oranı geçersiz')
      const discountRate = Number(String(form.discountRate ?? '').replace(',', '.'))
      if (!Number.isFinite(discountRate)) throw new Error('İskonto oranı geçersiz')
      const minStockRaw = Number(String(form.minStock ?? '').replace(',', '.'))
      if (!Number.isFinite(minStockRaw) || minStockRaw < 0) throw new Error('Minimum stok geçersiz')
      const minStock = Math.floor(minStockRaw)
      const bsyMinStockRaw = Number(String(form.bsyMinStock ?? '').replace(',', '.'))
      if (!Number.isFinite(bsyMinStockRaw) || bsyMinStockRaw < 0) throw new Error('Satışa kapanma eşiği geçersiz')
      const bsyMinStock = Math.floor(bsyMinStockRaw)

      const boxQuantityRaw = Number(String(form.boxQuantity ?? '').replace(',', '.'))
      if (!Number.isFinite(boxQuantityRaw) || boxQuantityRaw < 0) throw new Error('Kutudaki adet geçersiz')
      const boxQuantity = Math.floor(boxQuantityRaw)
      const purchasePrice = Number(String(form.purchasePrice ?? '').replace(',', '.'))
      if (!Number.isFinite(purchasePrice) || purchasePrice < 0) throw new Error('Alış fiyatı geçersiz')
      const containerQuantityRaw = Number(String(form.containerQuantity ?? '').replace(',', '.'))
      if (!Number.isFinite(containerQuantityRaw) || containerQuantityRaw < 0) throw new Error('Konteynır adet geçersiz')
      const containerQuantity = Math.floor(containerQuantityRaw)
      const freight = Number(String(form.freight ?? '').replace(',', '.'))
      if (!Number.isFinite(freight) || freight < 0) throw new Error('Navlun geçersiz')

      const stockValueRaw = Number(String(form.stock ?? '').replace(',', '.'))
      if (!Number.isFinite(stockValueRaw) || stockValueRaw < 0) throw new Error('Stok geçersiz')
      const stockValue = Math.floor(stockValueRaw)

      const supplierIdText = String(form.supplierId ?? '').trim()
      const supplierId = supplierIdText ? Number(supplierIdText) : null
      if (supplierId !== null && !Number.isFinite(supplierId)) throw new Error('Tedarikçi seçimi geçersiz')

      const currencyCode = form.currencyCode === '3' ? 3 : form.currencyCode === '2' ? 2 : form.currencyCode === '4' ? 4 : 1
      const salesCurrencyCode = Number(form.salesCurrencyCode ?? 1)
      const isInstallable = Boolean(form.isInstallable)
      const installationFeeText = String(form.installationFee ?? '').trim()
      const installationFee = installationFeeText ? Number(installationFeeText.replace(',', '.')) : null
      if (isInstallable && installationFee !== null && !Number.isFinite(installationFee)) throw new Error('Montaj fiyatı geçersiz')

      const uploadedUrls: string[] = []

      // cover
      if (coverImage?.file) {
        const u = await uploadProductImage(coverImage.file)
        uploadedUrls.push(u)
      } else if (String(coverImage?.url ?? '').trim()) {
        uploadedUrls.push(String(coverImage?.url ?? '').trim())
      }

      // side images
      for (const it of sideImages) {
        if (it.file) {
          const u = await uploadProductImage(it.file)
          uploadedUrls.push(u)
          continue
        }
        const existing = String(it.url ?? '').trim()
        if (existing) uploadedUrls.push(existing)
      }

      const finalImages = Array.from(
        new Set(
          uploadedUrls
            .map((x) => String(x ?? '').trim())
            .filter(Boolean)
        )
      ).slice(0, 20)

      let explodedDiagramFinalUrl = ''
      if (explodedDiagramFile) {
        explodedDiagramFinalUrl = await uploadProductImage(explodedDiagramFile)
      } else if (explodedDiagramPreviewUrl) {
        explodedDiagramFinalUrl = explodedDiagramPreviewUrl
      }

      const payload: any = {
        stockCode,
        name,
        barcode: String(form.barcode ?? '').trim() || null,
        groupCode,
        subGroupCode,
        productType: 'URUN',
        unit: 'ADET',
        taxRate,
        minStock,
        bsyMinStock,
        discountRate,
        supplierId,
        boxQuantity,
        purchasePrice,
        // Pasif urun her kosulda satisa kapali (sunucu da zorluyor).
        bsyVisibleFlag: form.status === 'passive' || form.bsyVisibleFlag === 'H' ? 'H' : 'E',
        containerQuantity,
        freight,
        currencyCode,
        salesCurrencyCode,
        stock: stockValue,
        isActive: form.status === 'active',
        isInstallable,
        installationFee: isInstallable ? installationFee : null,
        description: String(form.description ?? '').trim() ? String(form.description ?? '').trim() : null,
        displayName: String(form.displayName ?? '').trim() ? String(form.displayName ?? '').trim() : null,
        imageUrls: finalImages.length > 0 ? finalImages : null,
        imageUrl: finalImages[0] ?? null,
        kod4: explodedDiagramFinalUrl || null
      }

      if (modalMode === 'create') {
        const initialStocks = Object.entries(warehouseStocks)
          .map(([code, qty]) => ({ warehouseCode: Number(code), quantity: Number(qty) || 0 }))
          .filter((x) => Number.isFinite(x.warehouseCode) && x.warehouseCode > 0 && x.quantity > 0)
        payload.initialStocks = initialStocks.length > 0 ? initialStocks : null
      }

      const url = modalMode === 'create' ? `${API_BASE_URL}/api/products` : `${API_BASE_URL}/api/products/${String(form.id ?? '').trim()}`
      const method = modalMode === 'create' ? 'POST' : 'PUT'
      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('accessToken') ?? ''}`
        },
        body: JSON.stringify(payload)
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(getFriendlyApiError(text, res.status))
      }

      // Offer copy lives in its own table, keyed on stock code. Saved after the product so a
      // rejected product update cannot leave the copy ahead of the catalogue row.
      const stockCodeForDetail = String(form.stockCode ?? '').trim()
      if (stockCodeForDetail) {
        const detailRes = await fetch(
          `${API_BASE_URL}/api/products/${encodeURIComponent(stockCodeForDetail)}/detail`,
          {
            method: 'PUT',
            headers: { ...buildHeaders(true) },
            body: JSON.stringify({
              description: String(form.description ?? '').trim() ? String(form.description ?? '').trim() : null,
              features: String(form.features ?? '').trim() ? String(form.features ?? '').trim() : null
            })
          }
        )
        if (!detailRes.ok) {
          const text = await detailRes.text().catch(() => '')
          throw new Error(getFriendlyApiError(text, detailRes.status))
        }
      }

      closeModal()
      productsQuery.refetch()
    } catch (e: any) {
      setError(String(e?.message ?? 'Kaydedilemedi'))
    } finally {
      setSaving(false)
    }
  }

  const columns: TableColumn<any>[] = useMemo(
    () => [
      {
        key: 'stockCode',
        label: 'Stok Kodu',
        sortable: true,
        searchable: true,
        render: (_value, row) => <span className="font-mono text-xs font-semibold text-slate-900">{String(row.stockCode ?? '')}</span>
      },
      {
        key: 'img',
        label: 'Görsel',
        render: (_value, r) => {
          const isClosedToSale = isClosedToSaleRule(r)
          const isComingSoonFlag = Boolean((r as any)?.isComingSoon) || Boolean((r as any)?.comingSoon)
          const shouldShowComingSoon = isComingSoonFlag || (canBsyHComingSoon && isClosedToSale)

          const rawUrl = shouldShowComingSoon ? '' : String(r.imageUrl ?? '').trim()
          const srcUrl = toImageSrc(rawUrl)

          return (
            <button
              type="button"
              disabled={shouldShowComingSoon}
              onClick={(e) => {
                e.stopPropagation()
                if (!rawUrl) return
                setPreviewImageUrl(srcUrl)
                setPreviewOpen(true)
              }}
              className={`h-10 w-10 border border-gray-200 overflow-hidden flex items-center justify-center rounded-md hover:shadow-sm transition bg-white ${shouldShowComingSoon ? 'cursor-default' : ''}`}
              title={shouldShowComingSoon ? "Yolda (Yakında)" : "Önizleme"}
            >
              {shouldShowComingSoon ? (
                <ShipSailingAnimation size="sm" showText={true} />
              ) : rawUrl ? (
                <img loading="lazy" src={srcUrl} alt="" className="h-10 w-10 object-cover" />
              ) : null}
            </button>
          )
        }
      },
      {
        key: 'name',
        label: 'Ürün / Parça Adı',
        sortable: true,
        searchable: true,
        render: (_value, r) => {
          const rawGroup = String(r?.groupCode ?? '').trim().toLowerCase().replace(/_/g, ' ')
          const pType = String(r?.productType ?? '').trim().toUpperCase()
          const hasPartNo = String(r?.kod5 ?? '').trim().length > 0
          const kod4Val = String(r?.kod4 ?? '').trim()
          const hasParentStock = kod4Val.length > 0 && !isImageUrl(kod4Val)

          const isSpare = pType === 'YEDEKPARCA' || 
                          rawGroup === 'servis yedek parca malzeme' || 
                          hasPartNo || 
                          hasParentStock

          const parentStockCodes = isSpare && hasParentStock ? kod4Val : ''
          const diagramNo = isSpare ? String(r?.kod5 ?? '').trim() : ''

          return (
            <div className="flex flex-col justify-center gap-1 py-1">
              <div className="font-semibold text-slate-800 text-xs">{String(r.name ?? '')}</div>
              {isSpare && (parentStockCodes || diagramNo) && (
                <div className="flex items-center gap-1.5 flex-wrap">
                  {parentStockCodes && (
                    <span className="inline-flex items-center gap-1 bg-purple-50 text-purple-800 px-1.5 py-0.5 rounded border border-purple-200/80 font-mono text-[10px] font-bold" title="Yedek parçanın bağlı olduğu ana ürün(ler)">
                      🔗 Ana Ürün: {parentStockCodes}
                    </span>
                  )}
                  {diagramNo && (
                    <span className="inline-flex items-center gap-1 bg-amber-50 text-amber-800 px-1.5 py-0.5 rounded border border-amber-200/80 font-mono text-[10px] font-bold" title="Patlak şema pozisyon numarası">
                      Poz: #{diagramNo}
                    </span>
                  )}
                </div>
              )}
            </div>
          )
        }
      },
      {
        key: 'itemType',
        label: 'Tip',
        filter: {
          type: 'select',
          options: [
            { value: 'product', label: '📦 Ürün' },
            { value: 'spare', label: '⚙️ Yedek Parça' }
          ]
        },
        accessorFn: (r) => {
          const rawGroup = String(r?.groupCode ?? '').trim().toLowerCase().replace(/_/g, ' ')
          const pType = String(r?.productType ?? '').trim().toUpperCase()
          const hasPartNo = String(r?.kod5 ?? '').trim().length > 0
          const kod4Val = String(r?.kod4 ?? '').trim()
          const hasParentStock = kod4Val.length > 0 && !isImageUrl(kod4Val)
          const isSpare = pType === 'YEDEKPARCA' || rawGroup === 'servis yedek parca malzeme' || hasPartNo || hasParentStock
          return isSpare ? 'spare' : 'product'
        },
        render: (_value, r) => {
          const rawGroup = String(r?.groupCode ?? '').trim().toLowerCase().replace(/_/g, ' ')
          const pType = String(r?.productType ?? '').trim().toUpperCase()
          const hasPartNo = String(r?.kod5 ?? '').trim().length > 0
          const kod4Val = String(r?.kod4 ?? '').trim()
          const hasParentStock = kod4Val.length > 0 && !isImageUrl(kod4Val)

          const isSpare = pType === 'YEDEKPARCA' || 
                          rawGroup === 'servis yedek parca malzeme' || 
                          hasPartNo || 
                          hasParentStock

          return isSpare ? (
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-purple-50 text-purple-700 border border-purple-200">
              ⚙️ Yedek Parça
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-blue-50 text-blue-700 border border-blue-200">
              📦 Ürün
            </span>
          )
        }
      },
      {
        key: 'groupCode',
        label: 'Kategori',
        searchable: true,
        // Kategori serbest metin değil, KAPALI BİR LİSTE (kullanıcı kararı 2026-08-22).
        // Seçenekler ürün kategorilerinden türetiliyor; süzgeç "ANA > ALT" biçimindeki
        // görünen metinle değil, satırın ana kategori koduyla eşleşir.
        filter: {
          type: 'select',
          options: categories.mains.map((m) => ({ label: m, value: m }))
        },
        render: (_value, r) => {
          const main = String(r.groupCode ?? '')
          const sub = String(r.subGroupCode ?? '')
          if (!main && !sub) return <span className="text-slate-400 font-mono text-xs">-</span>
          return <span className="text-xs text-slate-700 font-medium">{sub ? `${main} > ${sub}` : main}</span>
        }
      },
      {
        key: 'description',
        label: 'Açıklama',
        searchable: true,
        render: (value) => {
          const d = String(value ?? '').trim()
          if (!d) return <span className="text-slate-400 font-mono text-xs">-</span>
          return <span className="text-xs text-slate-600 truncate block max-w-[200px]" title={d}>{d}</span>
        }
      },
      {
        key: 'price',
        label: 'Fiyat',
        // Siralama ve suzgec de EKRANDAKI rakami izlemeli; yoksa sutun bir fiyata gore
        // gorunup baska bir fiyata gore siralanirdi.
        accessorFn: (r) => {
          const f4 = f4FiyatiOku(f4PriceByProductId, (r as any)?.id)
          if (f4 && Number(f4.price) > 0) return Number(f4.price)
          return Number((r as any)?.displayUnitPrice ?? (r as any)?.unitPrice ?? 0)
        },
        sortable: true,
        render: (_value, r) => {
          // ONCE istemcide cozulen F4 fiyati; yoksa sunucunun `displayUnitPrice` alani.
          const f4Kayit = f4FiyatiOku(f4PriceByProductId, (r as any)?.id)
          const f4Price = f4Kayit ? f4Kayit.price : (r as any)?.displayUnitPrice
          const f4Currency = f4Kayit ? f4Kayit.currency : (r as any)?.displayCurrency

          if (f4Price != null && Number(f4Price) > 0) {
            const v = Number(f4Price)
            const f4CurText = String(f4Currency ?? '').trim().toUpperCase()
            if (!f4CurText || f4CurText === 'TL' || f4CurText === 'TRY' || f4CurText === '0') {
              return <span className="font-semibold text-slate-900 text-xs">{v.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} TL</span>
            }
            return <span className="font-semibold text-slate-900 text-xs">{f4CurText} {v.toFixed(2)}</span>
          }

          const unitPrice = (r as any)?.unitPrice
          const hasUnitPrice = unitPrice !== null && unitPrice !== undefined && Number(unitPrice) > 0

          if (hasUnitPrice) {
            const v = Number(unitPrice ?? 0)
            // ALIŞ dövizine (`currencyCode`) düşülüyordu; bkz. utils/productCurrency.ts
            const currencyText = resolveProductSalesCurrency(r as any)

            if (!currencyText || currencyText === 'TL' || currencyText === 'TRY') {
              return <span className="font-semibold text-slate-900 text-xs">{v.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} TL</span>
            }
            return <span className="font-semibold text-slate-900 text-xs">{currencyText} {v.toFixed(2)}</span>
          }

          return <span className="text-slate-400 font-mono text-xs">-</span>
        }
      },
      {
        // KDV oranı ürün kartında `taxRate` alanında duruyor; listede hiç gösterilmiyordu.
        // Fiyatın hemen yanında: "bu fiyat hangi KDV ile" sorusu burada soruluyor.
        key: 'taxRate',
        label: 'KDV',
        sortable: true,
        filter: { type: 'number' },
        accessorFn: (r: any) => Number(r?.taxRate ?? 0),
        render: (_value, r) => {
          const oran = Number((r as any)?.taxRate ?? 0)
          if (!Number.isFinite(oran)) return <span className="text-slate-400 font-mono text-xs">-</span>
          return <span className="font-semibold text-slate-700 text-xs">%{oran.toLocaleString('tr-TR', { maximumFractionDigits: 2 })}</span>
        }
      },
      {
        key: 'stock',
        label: 'Stok',
        sortable: true,
        filter: { type: 'number' },
        render: (_value, r) => {
          return (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                void openStockModal(r)
              }}
              className="text-blue-600 hover:text-blue-800 hover:underline font-bold text-xs focus:outline-none transition-colors"
              title="Depo bazlı stok durumunu göster"
            >
              {Number(r.stock ?? 0).toLocaleString('tr-TR')}
            </button>
          )
        }
      },
      {
        // Stoğun hemen yanında duruyor: "bu ürün kaça düşünce bayiye kapanır" sorusu burada
        // soruluyor. Boş/girilmemiş üründe varsayılan 12 gösterilir (kural da öyle işliyor).
        key: 'bsyMinStock',
        label: 'Satışa Kapanma Eşiği',
        sortable: true,
        filter: { type: 'number' },
        accessorFn: (r: any) => resolveAutoCloseThreshold(r),
        render: (_value, r) => {
          const esik = resolveAutoCloseThreshold(r as any)
          const stok = Number((r as any)?.stock ?? 0)
          const altinda = Number.isFinite(stok) && stok < esik
          return (
            <span
              className={`font-bold text-xs ${altinda ? 'text-amber-700' : 'text-slate-700'}`}
              title={altinda ? 'Stok eşiğin altında — bu ürün bayide satışa kapalı sayılıyor' : undefined}
            >
              {esik.toLocaleString('tr-TR')}
            </span>
          )
        }
      },
      {
        // Stok alarmı — satışa kapanma eşiğiyle KARIŞTIRILMAMALI, satışı kapatmaz.
        key: 'minStock',
        label: 'Minimum Stok',
        sortable: true,
        filter: { type: 'number' },
        accessorFn: (r: any) => Number(r?.minStock ?? 0),
        render: (_value, r) => {
          const min = Number((r as any)?.minStock ?? 0)
          if (!Number.isFinite(min) || min <= 0) return <span className="text-slate-400 font-mono text-xs">-</span>
          const stok = Number((r as any)?.stock ?? 0)
          const kritik = Number.isFinite(stok) && stok <= min
          return (
            <span
              className={`font-semibold text-xs ${kritik ? 'text-red-600' : 'text-slate-700'}`}
              title={kritik ? 'Stok kritik seviyede' : undefined}
            >
              {min.toLocaleString('tr-TR')}
            </span>
          )
        }
      },
      {
        // Yalnızca montajlı ürünlerde dolu; diğerlerinde çizgi.
        key: 'installationFee',
        label: 'Montaj Fiyatı',
        sortable: true,
        filter: { type: 'number' },
        accessorFn: (r: any) => (r?.isInstallable ? Number(r?.installationFee ?? 0) : 0),
        render: (_value, r) => {
          const montajli = Boolean((r as any)?.isInstallable)
          const ucret = Number((r as any)?.installationFee ?? 0)
          if (!montajli || !Number.isFinite(ucret) || ucret <= 0) {
            return <span className="text-slate-400 font-mono text-xs">-</span>
          }
          return (
            <span className="font-semibold text-slate-700 text-xs">
              {ucret.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} TL
            </span>
          )
        }
      },
      {
        key: 'termin',
        label: 'Termin',
        sortable: true,
        filter: { type: 'number' },
        render: (_value, r) => {
          return (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                navigate(`/invoice/termin?stockCode=${encodeURIComponent(r.stockCode)}`)
              }}
              className="text-blue-600 hover:text-blue-800 hover:underline font-bold text-xs focus:outline-none transition-colors"
              title="Termin detaylarını ve bekleyen siparişleri göster"
            >
              {Number(r.termin ?? 0).toLocaleString('tr-TR')}
            </button>
          )
        }
      },
      {
        // "Satışa Açık" ARTIK AYRI BİR KOLON. Listede yalnızca Aktif/Pasif vardı ve o kolon
        // "Satışa Açık (Aktif)" diye etiketlenmiş bir formdan besleniyordu — iki kavram tek
        // rozete binmişti. Etkin durum stok kuralını da içerir (bkz. utils/productSaleStatus.ts).
        key: 'saleOpen',
        accessorFn: (r: any) => (isClosedToSaleRule(r) ? 'closed' : 'open'),
        label: 'Satışa Açık',
        filter: {
          type: 'select',
          options: [
            { value: 'open', label: 'Evet' },
            { value: 'closed', label: 'Hayır' }
          ]
        },
        render: (_value, r) => {
          r = r as any
          const closed = isClosedToSaleRule(r)
          const reason = closedToSaleReasonLabel(r)
          return (
            <div className="min-w-0">
              <span
                className={
                  'inline-flex px-2 py-0.5 rounded text-[11px] font-semibold border ' +
                  (closed
                    ? 'bg-red-50 text-red-700 border-red-200'
                    : 'bg-green-50 text-green-700 border-green-200')
                }
              >
                {closed ? 'Hayır' : 'Evet'}
              </span>
              {closed && reason && (
                <div className="text-[10px] text-gray-500 mt-0.5 truncate" title={reason}>
                  {reason}
                </div>
              )}
            </div>
          )
        }
      },
      {
        key: 'isActive',
        label: 'Durum',
        filter: {
          type: 'select',
          options: [
            { value: 'true', label: 'Aktif' },
            { value: 'false', label: 'Pasif' }
          ]
        },
        render: (_value, r) => {
          const active = r.isActive !== false

          const isClosedToSale = isClosedToSaleRule(r)
          const isComingSoonFlag = Boolean((r as any)?.isComingSoon) || Boolean((r as any)?.comingSoon)
          const shouldShowComingSoon = isComingSoonFlag || (canBsyHComingSoon && isClosedToSale)

          const rawImages = Array.isArray(r.imageUrls) ? (r.imageUrls as unknown[]) : []
          const normalizedImages = rawImages.map((x) => String(x ?? '').trim()).filter(Boolean)
          const legacy = String(r.imageUrl ?? '').trim()
          const baseImages = normalizedImages.length > 0 ? normalizedImages : legacy ? [legacy] : []
          const images = shouldShowComingSoon ? ['/uploads/images/comingsoon.png'] : baseImages
          const rawVideos = Array.isArray(r.videoUrls) ? (r.videoUrls as unknown[]) : []
          const normalizedVideos = rawVideos.map((x) => String(x ?? '').trim()).filter(Boolean)
          const legacyVideo = String(r.videoUrl ?? '').trim()
          const videos = normalizedVideos.length > 0 ? normalizedVideos : legacyVideo ? [legacyVideo] : []

          return (
            <div className="flex items-center justify-between gap-2">
              <span
                className={
                  'inline-flex px-2 py-0.5 rounded text-[11px] font-semibold ' +
                  (active ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-gray-50 text-gray-600 border border-gray-200')
                }
              >
                {active ? 'Aktif' : 'Pasif'}
              </span>

              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  setMediaPreviewTitle(String(r.name ?? 'Görsel Önizleme'))
                  setMediaPreviewDescription(String(r.description ?? '').trim())
                  setMediaPreviewImages(images)
                  setMediaPreviewVideos(videos)
                  setMediaActiveIndex(0)
                  setMediaPreviewOpen(true)
                }}
                className="h-7 w-7 flex items-center justify-center rounded border border-gray-200 hover:bg-gray-50 text-gray-700 transition"
                title="Görsel / Medya Önizleme"
              >
                <Eye size={15} />
              </button>
            </div>
          )
        }
      },
      {
        key: 'actions',
        label: 'İşlemler',
        render: (_value, r) => {
          return (
            <div className="flex items-center justify-end gap-1">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  const pid = String(r?.id ?? '').trim()
                  if (!pid) return
                  navigate(`/users/atiliFiyatlandirma?productId=${encodeURIComponent(pid)}`)
                }}
                className="h-8 w-8 flex items-center justify-center rounded hover:bg-emerald-50 text-emerald-700 transition"
                title="Fiyat Atama"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 1v22"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7H14a3 3 0 0 1 0 6H6"/></svg>
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  openEdit(r)
                }}
                className="h-8 w-8 flex items-center justify-center rounded hover:bg-gray-100 text-gray-700 transition"
                title="Düzenle"
              >
                <Pencil size={16} />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  void requestDelete(r)
                }}
                className="h-8 w-8 flex items-center justify-center rounded hover:bg-red-50 text-red-600 transition"
                title="Sil"
              >
                <Trash2 size={16} />
              </button>
            </div>
          )
        }
      }
    ],
    // `f4PriceByProductId` BURADA OLMAK ZORUNDA (2026-08-24).
    // Fiyat sütununun render'ı bu haritayı okuyor. Bağımlılıkta olmadığında sütunlar bir
    // kez kuruluyor ve kapanış ilk render'daki BOŞ haritayı ömür boyu taşıyordu: F4
    // fiyatları sonradan gelse bile ekranda hiç görünmüyor, sütun eski fiyata düşüyordu.
    [canBsyHHide, canBsyHComingSoon, navigate, f4PriceByProductId]
  )

  const filteredProductsForSelect = useMemo(() => {
    const qNorm = String(analysisSearchQ ?? '').trim().toLowerCase()
    let allItems = productsQuery.items ?? []
    if (analysisSupplierFilter !== 'all') {
      allItems = allItems.filter(p => String(p.supplierId) === analysisSupplierFilter)
    }
    if (!qNorm) return allItems.slice(0, 10)
    return allItems
      .filter((p) =>
        String(p.name ?? '').toLowerCase().includes(qNorm) ||
        String(p.stockCode ?? '').toLowerCase().includes(qNorm)
      )
      .slice(0, 10)
  }, [analysisSearchQ, productsQuery.items, analysisSupplierFilter])

  useEffect(() => {
    if (!analysisModalOpen || !selectedAnalysisProductId) {
      setAnalysisData(null)
      return
    }

    const fetchAnalysis = async () => {
      try {
        setAnalysisLoading(true)
        setAnalysisError(null)
        const customerParam = selectedAnalysisBayiCode ? `?customerCode=${encodeURIComponent(selectedAnalysisBayiCode)}` : ''
        const res = await fetch(`${API_BASE_URL}/api/products/analysis/${selectedAnalysisProductId}${customerParam}`, {
          headers: buildHeaders(false)
        })
        if (!res.ok) {
          throw new Error(`Veriler yüklenemedi (${res.status})`)
        }
        const json = await res.json()
        if (json?.success && json?.data) {
          setAnalysisData(json.data)
        } else {
          throw new Error(json?.message || 'Analiz verisi alınamadı.')
        }
      } catch (e: any) {
        console.error('Analiz getirme hatası:', e)
        setAnalysisError(e?.message || 'Bir hata oluştu.')
      } finally {
        setAnalysisLoading(false)
      }
    }

    void fetchAnalysis()
  }, [analysisModalOpen, selectedAnalysisProductId, selectedAnalysisBayiCode])

  return (
    <div className="space-y-4">
      <NotificationPopup isOpen={popupOpen} variant={popupVariant} title={popupTitle} message={popupMessage} onClose={() => setPopupOpen(false)} />

      <Modal
        isOpen={excelImportOpen}
        onClose={() => setExcelImportOpen(false)}
        title="Excel Import Sonucu"
      >
        <div className="text-sm text-gray-700">
          Başarılı kayıt: <span className="font-extrabold">{Number(excelImportResult?.successCount ?? 0)}</span>
        </div>

        {(excelImportResult?.rowErrors?.length ?? 0) > 0 ? (
          <div className="mt-3 border border-gray-200 rounded overflow-hidden">
            <div className="grid grid-cols-12 bg-gray-50 text-[11px] font-semibold text-gray-600 px-3 py-2">
              <div className="col-span-2">Satır</div>
              <div className="col-span-3">Stok Kodu</div>
              <div className="col-span-7">Hata</div>
            </div>
            <div className="divide-y divide-gray-100 max-h-[320px] overflow-auto">
              {(excelImportResult?.rowErrors ?? []).slice(0, 200).map((e, idx) => (
                <div key={idx} className="grid grid-cols-12 px-3 py-2 text-[11px]">
                  <div className="col-span-2 font-semibold text-gray-900">{e.rowNumber}</div>
                  <div className="col-span-3 text-gray-700 truncate" title={String(e.stockCode ?? '')}>{String(e.stockCode ?? '')}</div>
                  <div className="col-span-7 text-red-700 whitespace-pre-line">{(e.errors ?? []).join('\n')}</div>
                </div>
              ))}
              {(excelImportResult?.rowErrors?.length ?? 0) > 200 ? <div className="px-3 py-2 text-[11px] text-gray-500">İlk 200 hata gösteriliyor.</div> : null}
            </div>
          </div>
        ) : (
          <div className="mt-3 text-[12px] font-semibold text-emerald-700">Hata yok.</div>
        )}
      </Modal>

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900 tracking-tight">Ürün Yönetimi</h1>
          <p className="text-xs text-gray-400 mt-0.5">Sistemdeki tüm ürünlerin, yedek parçaların ve stokların yönetimi</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={excelFileInputRef}
            type="file"
            accept=".xlsx"
            className="hidden"
            onChange={(e) => {
              const file = (e.target.files && e.target.files[0]) || null
              if (!file) return
              void startExcelImport(file)
            }}
          />

          <button
            type="button"
            onClick={() => {
              setAnalysisModalOpen(true)
              if (productsQuery.items && productsQuery.items.length > 0) {
                setSelectedAnalysisProductId(productsQuery.items[0].id)
              }
            }}
            className="h-9 inline-flex items-center gap-1.5 px-3.5 text-xs font-semibold bg-orange-600 hover:bg-orange-700 text-white rounded-lg shadow-sm transition-all hover:scale-[1.02]"
          >
            <BarChart2 size={13} />
            Ürün Analizi
          </button>

          <span className="h-6 w-px bg-gray-200 mx-1 hidden md:inline-block" />

          <button
            type="button"
            disabled={excelImportBusy}
            onClick={() => {
              void (async () => {
                try {
                  await downloadExcel(`${API_BASE_URL}/api/products/excel-template`, 'urun-template.xlsx')
                } catch (e: any) {
                  showPopup('error', 'Hata', String(e?.message ?? 'Bir hata oluştu'))
                }
              })()
            }}
            className="h-9 inline-flex items-center gap-1.5 px-3 bg-white hover:bg-gray-50 border border-gray-200 text-gray-700 rounded-lg shadow-sm transition text-xs font-medium"
          >
            Excel Şablonu
          </button>

          <button
            type="button"
            disabled={excelImportBusy}
            onClick={() => {
              void (async () => {
                try {
                  await downloadExcel(`${API_BASE_URL}/api/products/excel-export`, 'urunler.xlsx')
                } catch (e: any) {
                  showPopup('error', 'Hata', String(e?.message ?? 'Bir hata oluştu'))
                }
              })()
            }}
            className="h-9 inline-flex items-center gap-1.5 px-3 bg-white hover:bg-gray-50 border border-gray-200 text-gray-700 rounded-lg shadow-sm transition text-xs font-medium"
          >
            Excel Dışa Aktar
          </button>

          <button
            type="button"
            disabled={excelImportBusy}
            onClick={() => excelFileInputRef.current?.click()}
            className="h-9 inline-flex items-center gap-1.5 px-3 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-700 disabled:opacity-60 rounded-lg shadow-sm transition text-xs font-semibold"
          >
            Excel İçe Aktar
          </button>

          <span className="h-6 w-px bg-gray-200 mx-1" />

          <button
            type="button"
            onClick={openCreate}
            className="h-9 inline-flex items-center gap-1.5 px-4 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition-all hover:scale-[1.02]"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Yeni Ürün
          </button>

          <button
            type="button"
            onClick={openCreateSparePart}
            className="h-9 inline-flex items-center gap-1.5 px-4 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 text-white shadow-sm transition-all hover:scale-[1.02]"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Yeni Yedek Parça
          </button>

          {localStorage.getItem('devMode') === 'true' && (
            <>
              <button
                type="button"
                onClick={() => openCreateWithDummy(false)}
                className="h-9 inline-flex items-center gap-1.5 px-3 text-xs font-bold rounded-lg bg-amber-500 hover:bg-amber-600 text-white shadow-sm transition"
                title="Örnek verilerle doldurulmuş yeni ürün penceresi açar"
              >
                ⚡ Hızlı Örnek Ürün
              </button>

              <button
                type="button"
                onClick={() => openCreateWithDummy(true)}
                className="h-9 inline-flex items-center gap-1.5 px-3 text-xs font-bold rounded-lg bg-purple-600 hover:bg-purple-700 text-white shadow-sm transition"
                title="Örnek veriler ve bağlı ana ürünlerle doldurulmuş yedek parça penceresi açar"
              >
                ⚡ Hızlı Örnek Parça
              </button>
            </>
          )}
        </div>
      </div>

      <div className="bg-white border border-gray-100 rounded-xl shadow-sm p-3 flex flex-wrap items-center gap-3">
        <div className="w-full sm:w-[260px]">
          <FormSelect
            label="Ana Kategori"
            value={filterMain}
            onChange={(e) => {
              const v = e.target.value
              productsQuery.setMainSub(v, '')
            }}
            options={mainCategoryOptions}
          />
        </div>
        <div className="w-full sm:w-[260px]">
          <FormSelect
            label="Alt Kategori"
            value={filterSub}
            onChange={(e) => {
              productsQuery.setMainSub(filterMain, e.target.value)
            }}
            options={filterMain ? getSubOptions(filterMain) : getAllSubOptions()}
          />
        </div>
        <div className="w-full sm:w-[320px]">
          <FormInput
            label="Detaylı Arama"
            value={search}
            onChange={(e) => {
              const val = e.target.value
              setSearch(val)
              productsQuery.setQ(val)
            }}
            placeholder="Ürün adı, stok kodu, bağlı ürün, poz no..."
          />
        </div>
        <div className="w-full sm:w-[240px]">
          <FormSelect
            label="Bağlı Ana Ürün (Yedek Parça)"
            value={parentProductFilter}
            onChange={(e) => setParentProductFilter(e.target.value)}
            options={parentProductOptions}
          />
        </div>
        <div className="w-full sm:w-[220px]">
          <FormSelect
            label="Durum"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value === 'passive' ? 'passive' : e.target.value === 'active' ? 'active' : 'all')}
            options={[
              { value: 'all', label: 'Tümü' },
              { value: 'active', label: 'Aktif' },
              { value: 'passive', label: 'Pasif' }
            ]}
          />
        </div>
        <div className="w-full sm:w-[220px]">
          <FormSelect
            label="Ürün Tipi"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as 'all' | 'product' | 'spare')}
            options={[
              { value: 'all', label: 'Tüm Ürünler & Parçalar' },
              { value: 'product', label: 'Sadece Ürünler' },
              { value: 'spare', label: 'Yedek Parça' }
            ]}
          />
        </div>
        <div className="w-full sm:w-[280px]">
          {/*
            TEDARİKÇİ SEÇİMİ ARANABİLİR (2026-08-30 kullanıcı isteği: "cari ekstredeki
            search bar ile aynı olacak").

            Düz `FormSelect` idi: yüzlerce tedarikçi tek listede, arama yok, kullanıcı
            kaydırarak bulmak zorundaydı. Cari Ekstre ekranındaki `SearchableCariSelect`
            aynı işi yazarak arayarak yapıyor; aynı bileşen buraya da bağlandı.

            Boş seçim "Tümü" demektir — bileşen temizlenince süzgeç kalkar.
          */}
          <label className="block text-xs font-semibold text-gray-700 mb-1">Tedarikçi</label>
          <SearchableCariSelect
            value={supplierFilter === 'all' ? '' : supplierFilter}
            onChange={(v) => setSupplierFilter(v || 'all')}
            options={tedarikciSecenekleri}
            showTypeFilter={false}
            placeholder="Tedarikçi Ara (Kod, İsim)..."
          />
        </div>
        <div className="text-xs text-gray-500 md:ml-auto">
          Toplam: {productsQuery.total.toLocaleString('tr-TR')}
        </div>
      </div>

      {error && <div className="text-xs font-semibold text-red-600">{error}</div>}

      <Table<any>
          onRefresh={() => void productsQuery.refetch()}
        columns={columns}
        data={filteredItems}
        rowKey={(r) => String(r.id)}
        rowClassName={(row) => {
          const stock = Number((row as any).stock ?? 0)
          const minStock = Number((row as any).minStock ?? 0)
          if (minStock > 0 && stock <= minStock) return 'bg-red-50/80 hover:bg-red-100/80 font-medium'
          return ''
        }}
        showColumnFilters={false}
        initialPageSize={100}
        loading={productsQuery.loading}
      />

      {/*
        SAYFANIN KENDİ SAYFALAMASI KALDIRILDI (2026-08-22).

        Liste artık sunucu süzgecinin TAMAMINI yüklüyor (`fetchAllPages`), sayfalama da
        süzme de tabloda yapılıyor. İkisi birden dururken tablo kendi içinde sayfalarken
        buradaki "Sonraki" sunucudan yeni sayfa çekiyordu; iki sayaç birbirini tutmuyordu.
        Tablonun alt şeridinde kayıt sayısı ve sayfa başına seçimi zaten var.
      */}

      <Modal
        isOpen={deleteConfirmOpen}
        onClose={() => {
          if (saving) return
          setDeleteConfirmOpen(false)
          setDeleteTarget(null)
        }}
        title="Ürünü Sil"
        footer={
          <>
            <button
              type="button"
              className="h-[34px] px-4 text-xs font-semibold rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 transition"
              onClick={() => {
                setDeleteConfirmOpen(false)
                setDeleteTarget(null)
              }}
              disabled={saving}
            >
              Vazgeç
            </button>
            <button
              type="button"
              className="h-[34px] inline-flex items-center gap-1.5 px-4 text-xs font-semibold rounded-lg bg-red-600 hover:bg-red-700 text-white shadow-sm transition disabled:opacity-60"
              onClick={() => void confirmDelete()}
              disabled={saving}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
              Sil
            </button>
          </>
        }
      >
        <div className="text-sm text-gray-700">Bu ürünü silmek istediğinize emin misiniz?</div>
        {deleteTarget?.name ? <div className="mt-2 text-xs text-gray-500">{deleteTarget.name}</div> : null}
      </Modal>

      <Modal
        isOpen={modalOpen}
        onClose={closeModal}
        title={modalMode === 'create' ? (createType === 'SparePart' ? 'Yedek Parça Ekle' : 'Ürün Ekle') : (sparePartEditMode ? 'Yedek Parça Düzenle' : 'Ürün Düzenle')}
        footer={
          <div className="flex items-center justify-between w-full">
            <div>
              {modalMode === 'create' && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => fillDummyData(createType === 'SparePart')}
                  className="h-[34px] inline-flex items-center gap-1.5 px-3 text-xs font-bold rounded-lg bg-amber-500 hover:bg-amber-600 text-white shadow-sm transition"
                  title="Tüm alanları örnek verilerle doldurur"
                >
                  ⚡ Örnek Veri Doldur
                </button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={saving}
                onClick={closeModal}
                className="h-[34px] px-4 text-xs font-semibold rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 transition"
              >
                Vazgeç
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void submit()}
                className="h-[34px] inline-flex items-center gap-1.5 px-4 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition disabled:opacity-60"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
                {saving ? 'Kaydediliyor...' : 'Kaydet'}
              </button>
            </div>
          </div>
        }
      >
        {error && <div className="mb-3 text-xs font-semibold text-red-600">{error}</div>}

        {(() => {
          const isSparePart = (modalMode === 'create' && createType === 'SparePart') || (modalMode === 'edit' && sparePartEditMode)
          return (
            <>
              {/* Tab Navigation */}
              <div className="flex border-b border-gray-200 mb-4 -mx-6 px-6">
                <button
                  type="button"
                  onClick={() => setModalActiveTab('general')}
                  className={`py-2.5 px-4 text-xs font-bold border-b-2 transition-all ${
                    modalActiveTab === 'general'
                      ? 'border-emerald-600 text-emerald-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
                >
                  Genel Bilgiler
                </button>
                <button
                  type="button"
                  onClick={() => setModalActiveTab('price')}
                  className={`py-2.5 px-4 text-xs font-bold border-b-2 transition-all ${
                    modalActiveTab === 'price'
                      ? 'border-emerald-600 text-emerald-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
                >
                  Fiyat & Maliyet
                </button>
                <button
                  type="button"
                  onClick={() => setModalActiveTab('stock')}
                  className={`py-2.5 px-4 text-xs font-bold border-b-2 transition-all ${
                    modalActiveTab === 'stock'
                      ? 'border-emerald-600 text-emerald-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
                >
                  Stok & Lojistik
                </button>
                <button
                  type="button"
                  onClick={() => setModalActiveTab('media')}
                  className={`py-2.5 px-4 text-xs font-bold border-b-2 transition-all ${
                    modalActiveTab === 'media'
                      ? 'border-emerald-600 text-emerald-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
                >
                  Görseller & Açıklama
                </button>
                {isSparePart && (
                  <button
                    type="button"
                    onClick={() => setModalActiveTab('links')}
                    className={`py-2.5 px-4 text-xs font-bold border-b-2 transition-all ${
                      modalActiveTab === 'links'
                        ? 'border-emerald-600 text-emerald-600'
                        : 'border-transparent text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    Üst Ürün Bağlantıları
                  </button>
                )}
              </div>

              {/* Tab Content */}
              {modalActiveTab === 'general' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {isSparePart ? (
                    <>
                      <FormInput
                        label="Parça Adı"
                        value={sparePartForm.name}
                        onChange={(e) => setSparePartForm((p) => ({ ...p, name: e.target.value }))}
                      />
                      <FormInput
                        label="Stok Kodu"
                        value={sparePartForm.stockCode}
                        onChange={(e) => setSparePartForm((p) => ({ ...p, stockCode: e.target.value }))}
                      />
                      <FormSelect
                        label="Ana Kategori"
                        value={sparePartForm.mainCategory}
                        onChange={(e) => {
                          const v = e.target.value
                          const subs = getSubsForMain(v)
                          const firstSub = subs[0] ?? ''
                          setSparePartForm((p) => ({ ...p, mainCategory: v, subCategory: firstSub }))
                        }}
                        options={categories.mains.map((m) => ({ value: m, label: m }))}
                      />
                      <FormSelect
                        label="Alt Kategori"
                        value={sparePartForm.subCategory}
                        onChange={(e) => setSparePartForm((p) => ({ ...p, subCategory: e.target.value }))}
                        options={(() => {
                          const subs = getSubsForMain(sparePartForm.mainCategory)
                          if (!sparePartForm.mainCategory) return [{ value: '', label: 'Önce ana kategori seçiniz' }]
                          if (subs.length === 0) return [{ value: '', label: 'Alt kategori yok' }]
                          return [{ value: '', label: 'Seçiniz...' }, ...subs.map((s) => ({ value: s, label: s }))]
                        })()}
                      />
                      <FormInput label="Barkod" value={sparePartForm.barcode} onChange={(e) => setSparePartForm((p) => ({ ...p, barcode: e.target.value }))} />
                      <FormSearchableSelect
                        label="Tedarikçi"
                        value={sparePartForm.supplierId}
                        onChange={(e) => setSparePartForm((p) => ({ ...p, supplierId: e.target.value }))}
                        options={[
                          { value: '', label: 'Hiçbiri' },
                          ...suppliers.map((s) => ({ value: String(s.id), label: `${s.supplierCode} - ${s.fullName}` }))
                        ]}
                      />
                      {/* İKİ AYRI ALAN — tek kutuya sıkıştırılmışlardı, bkz. utils/productSaleStatus.ts */}
                      <FormSelect
                        label="Durum"
                        value={sparePartForm.status}
                        onChange={(e) => {
                          const next = e.target.value === 'passive' ? 'passive' : 'active'
                          // Pasife alınan ürün satışa kapanır; sunucu da bunu zorluyor, ekran
                          // aksini gösterirse kullanıcı kaydettiğinde değerin değiştiğini görür.
                          setSparePartForm((p) => ({ ...p, status: next, bsyVisibleFlag: next === 'passive' ? 'H' : p.bsyVisibleFlag }))
                        }}
                        options={[
                          { value: 'active', label: 'Aktif' },
                          { value: 'passive', label: 'Pasif' }
                        ]}
                      />
                      {/* Yedek parça formunda stok alanı yok; kayıtlı üründen okunuyor (aşağıdaki
                          "Mevcut Stok" kutusuyla aynı kaynak). Yeni kayıtta bilinmiyor. */}
                      {renderSatisaAcikField(
                        sparePartForm,
                        (v) => setSparePartForm((p) => ({ ...p, bsyVisibleFlag: v })),
                        sparePartForm.id
                          ? (productsQuery.items.find((x: any) => String(x.id) === String(sparePartForm.id)) as any)?.stock
                          : undefined,
                        sparePartForm.id
                          ? (productsQuery.items.find((x: any) => String(x.id) === String(sparePartForm.id)) as any)?.bsyMinStock
                          : undefined
                      )}
                    </>
                  ) : (
                    <>
                      <FormInput label="Ürün Adı" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} />
                      {/* Vitrin adı (2026-09-20): e-ticarette görünen okunur ad; boşsa ürün adı. Model kodu vitrinde alt satıra iner. */}
                      <FormInput label="Vitrin Adı (e-ticaret)" value={form.displayName} placeholder="Örn: 24.000 BTU İnverter Klima, Wi-Fi" onChange={(e) => setForm((p) => ({ ...p, displayName: e.target.value }))} />
                      <FormInput label="STOK KODU" value={form.stockCode} onChange={(e) => setForm((p) => ({ ...p, stockCode: e.target.value }))} />
                      <FormSelect
                        label="Ana Kategori"
                        value={form.mainCategory}
                        onChange={(e) => {
                          const v = e.target.value
                          const subs = getSubsForMain(v)
                          const firstSub = subs[0] ?? ''
                          setForm((p) => ({ ...p, mainCategory: v, subCategory: firstSub }))
                        }}
                        options={categories.mains.map((m) => ({ value: m, label: m }))}
                      />
                      <FormSelect
                        label="Alt Kategori"
                        value={form.subCategory}
                        onChange={(e) => setForm((p) => ({ ...p, subCategory: e.target.value }))}
                        options={(() => {
                          const subs = getSubsForMain(form.mainCategory)
                          if (!form.mainCategory) return [{ value: '', label: 'Önce ana kategori seçiniz' }]
                          if (subs.length === 0) return [{ value: '', label: 'Alt kategori yok' }]
                          return [{ value: '', label: 'Seçiniz...' }, ...subs.map((s) => ({ value: s, label: s }))]
                        })()}
                      />
                      <FormInput label="Barkod" value={form.barcode} onChange={(e) => setForm((p) => ({ ...p, barcode: e.target.value }))} />
                      <FormSearchableSelect
                        label="Tedarikçi"
                        value={form.supplierId}
                        onChange={(e) => setForm((p) => ({ ...p, supplierId: e.target.value }))}
                        options={[
                          { value: '', label: 'Hiçbiri' },
                          ...suppliers.map((s) => ({ value: String(s.id), label: `${s.supplierCode} - ${s.fullName}` }))
                        ]}
                      />
                      <FormSelect
                        label="Durum"
                        value={form.status}
                        onChange={(e) => {
                          const next = e.target.value === 'passive' ? 'passive' : 'active'
                          setForm((p) => ({ ...p, status: next, bsyVisibleFlag: next === 'passive' ? 'H' : p.bsyVisibleFlag }))
                        }}
                        options={[
                          { value: 'active', label: 'Aktif' },
                          { value: 'passive', label: 'Pasif' }
                        ]}
                      />
                      {renderSatisaAcikField(form, (v) => setForm((p) => ({ ...p, bsyVisibleFlag: v })), form.stock, form.bsyMinStock)}
                    </>
                  )}
                </div>
              )}

              {modalActiveTab === 'price' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {isSparePart ? (
                    <>
                      <FormInput
                        label="Alış Fiyatı"
                        value={sparePartForm.purchasePrice}
                        onChange={(e) => setSparePartForm((p) => ({ ...p, purchasePrice: sanitizeDecimalInput(e.target.value, { max: 999999999, decimals: 2 }) }))}
                        inputMode="decimal"
                        type="text"
                      />
                      <FormSelect
                        label="Alış Para Birimi"
                        value={sparePartForm.currencyCode}
                        onChange={(e) => {
                          const v = String(e.target.value)
                          setSparePartForm((p) => ({ ...p, currencyCode: v === '3' ? '3' : v === '2' ? '2' : v === '4' ? '4' : '1' }))
                        }}
                        options={[
                          { value: '1', label: 'TL' },
                          { value: '2', label: 'EUR' },
                          { value: '3', label: 'USD' },
                          { value: '4', label: 'GBP' }
                        ]}
                      />
                      <FormSelect
                        label="Satış Para Birimi"
                        value={sparePartForm.salesCurrencyCode}
                        onChange={(e) => {
                          const v = String(e.target.value)
                          setSparePartForm((p) => ({ ...p, salesCurrencyCode: v === '3' ? '3' : v === '2' ? '2' : v === '4' ? '4' : '1' }))
                        }}
                        options={[
                          { value: '1', label: 'TL' },
                          { value: '2', label: 'EUR' },
                          { value: '3', label: 'USD' },
                          { value: '4', label: 'GBP' }
                        ]}
                      />
                      <FormInput
                        label="KDV (%)"
                        value={sparePartForm.taxRate}
                        onChange={(e) => setSparePartForm((p) => ({ ...p, taxRate: sanitizeIntText(e.target.value, { maxDigits: 3 }) }))}
                        inputMode="numeric"
                        type="text"
                      />
                      <FormInput
                        label="İSKONTO (%)"
                        value={sparePartForm.discountRate}
                        onChange={(e) => setSparePartForm((p) => ({ ...p, discountRate: sanitizeDecimalInput(e.target.value, { max: 100, decimals: 2 }) }))}
                        inputMode="decimal"
                        type="text"
                      />
                      <div className="md:col-span-2">
                        <label className="flex items-center gap-2 text-xs font-semibold text-gray-700">
                          <input
                            type="checkbox"
                            checked={Boolean(sparePartForm.isInstallable)}
                            onChange={(e) =>
                              setSparePartForm((p) => ({
                                ...p,
                                isInstallable: e.target.checked,
                                installationFee: e.target.checked ? p.installationFee : ''
                              }))
                            }
                          />
                          Montaj yapılan ürün mü?
                        </label>
                      </div>
                      <FormInput
                        label="Montaj fiyatı (opsiyonel)"
                        type="text"
                        inputMode="decimal"
                        value={sparePartForm.installationFee}
                        onChange={(e) => setSparePartForm((p) => ({ ...p, installationFee: e.target.value }))}
                        disabled={!sparePartForm.isInstallable}
                      />
                    </>
                  ) : (
                    <>
                      <FormInput
                        label="Alış Fiyatı"
                        value={form.purchasePrice}
                        onChange={(e) => setForm((p) => ({ ...p, purchasePrice: sanitizeDecimalInput(e.target.value, { max: 999999999, decimals: 2 }) }))}
                        inputMode="decimal"
                        type="text"
                      />
                      <FormSelect
                        label="Alış Para Birimi"
                        value={form.currencyCode}
                        onChange={(e) => {
                          const v = String(e.target.value)
                          setForm((p) => ({ ...p, currencyCode: v === '3' ? '3' : v === '2' ? '2' : v === '4' ? '4' : '1' }))
                        }}
                        options={[
                          { value: '1', label: 'TL' },
                          { value: '2', label: 'EUR' },
                          { value: '3', label: 'USD' },
                          { value: '4', label: 'GBP' }
                        ]}
                      />
                      <FormSelect
                        label="Satış Para Birimi"
                        value={form.salesCurrencyCode}
                        onChange={(e) => {
                          const v = String(e.target.value)
                          setForm((p) => ({ ...p, salesCurrencyCode: v === '3' ? '3' : v === '2' ? '2' : v === '4' ? '4' : '1' }))
                        }}
                        options={[
                          { value: '1', label: 'TL' },
                          { value: '2', label: 'EUR' },
                          { value: '3', label: 'USD' },
                          { value: '4', label: 'GBP' }
                        ]}
                      />
                      <FormInput
                        label="KDV (%)"
                        value={form.taxRate}
                        onChange={(e) => setForm((p) => ({ ...p, taxRate: sanitizeIntText(e.target.value, { maxDigits: 3 }) }))}
                        inputMode="numeric"
                        type="text"
                      />
                      <FormInput
                        label="İSKONTO (%)"
                        value={form.discountRate}
                        onChange={(e) => setForm((p) => ({ ...p, discountRate: sanitizeDecimalInput(e.target.value, { max: 100, decimals: 2 }) }))}
                        inputMode="decimal"
                        type="text"
                      />
                      <div className="md:col-span-2">
                        <label className="flex items-center gap-2 text-xs font-semibold text-gray-700">
                          <input
                            type="checkbox"
                            checked={Boolean(form.isInstallable)}
                            onChange={(e) =>
                              setForm((p) => ({
                                ...p,
                                isInstallable: e.target.checked,
                                installationFee: e.target.checked ? p.installationFee : ''
                              }))
                            }
                          />
                          Montaj yapılan ürün mü?
                        </label>
                      </div>
                      <FormInput
                        label="Montaj fiyatı (opsiyonel)"
                        type="text"
                        inputMode="decimal"
                        value={form.installationFee}
                        onChange={(e) => setForm((p) => ({ ...p, installationFee: e.target.value }))}
                        disabled={!form.isInstallable}
                      />
                    </>
                  )}
                </div>
              )}

              {modalActiveTab === 'stock' && (
                <div className="space-y-4">
                  {modalMode === 'create' ? (
                    <div>
                      <div className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide mb-2">Stok Bilgisi (Depo Bazında)</div>
                      {warehousesLoading ? (
                        <div className="text-xs text-gray-400 py-3">Depolar yükleniyor...</div>
                      ) : warehouses.length === 0 ? (
                        <div className="text-xs text-gray-400 py-3">Tanımlı depo bulunamadı.</div>
                      ) : (
                        <div className="border border-gray-200 rounded-lg overflow-hidden">
                          <table className="w-full">
                            <thead>
                              <tr className="bg-gray-50 text-[11px] font-semibold text-gray-600">
                                <th className="px-3 py-2 text-left">Depo</th>
                                <th className="px-3 py-2 text-right w-[160px]">Miktar</th>
                              </tr>
                            </thead>
                            <tbody className="text-[12px]">
                              <tr>
                                <td colSpan={2} className="p-0">
                                  <div className="max-h-[168px] overflow-y-auto">
                                    <table className="w-full">
                                      <tbody>
                                        {warehouses.map((w) => {
                                          const code = String(w.warehouseCode)
                                          return (
                                            <tr key={code} className="border-t border-gray-100">
                                              <td className="px-3 py-2 text-gray-700">{`${code} - ${w.name ?? ''}`.trim()}</td>
                                              <td className="px-3 py-2 text-right">
                                                <input
                                                  className="w-[130px] px-2 py-1 text-xs border border-gray-300 rounded text-right"
                                                  inputMode="numeric"
                                                  value={warehouseStocks[code] ?? ''}
                                                  onChange={(e) => {
                                                    const q = sanitizeIntText(e.target.value, { maxDigits: 10 })
                                                    setWarehouseStocks((prev) => ({ ...prev, [code]: q }))
                                                  }}
                                                  placeholder="0"
                                                />
                                              </td>
                                            </tr>
                                          )
                                        })}
                                      </tbody>
                                    </table>
                                  </div>
                                </td>
                              </tr>
                              <tr className="border-t-2 border-gray-300 bg-gray-50">
                                <td className="px-3 py-2 text-[11px] font-bold text-gray-700">TOPLAM STOK</td>
                                <td className="px-3 py-2 text-right text-[12px] font-bold text-gray-800">{warehouseStockTotal}</td>
                              </tr>
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {isSparePart ? (
                        <FormInput label="Mevcut Stok (Toplam)" value={String((productsQuery.items.find((x: any) => String(x.id) === String(sparePartForm.id)) as any)?.stock ?? '')} onChange={() => {}} disabled />
                      ) : (
                        <FormInput label="Mevcut Stok (Toplam)" value={form.stock} onChange={() => {}} disabled />
                      )}
                    </div>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                    {isSparePart ? (
                      <>
                        <FormInput
                          label="Minimum Stok Seviyesi"
                          value={sparePartForm.minStockLevel}
                          onChange={(e) => setSparePartForm((p) => ({ ...p, minStockLevel: sanitizeIntText(e.target.value, { maxDigits: 10 }) }))}
                          inputMode="numeric"
                          type="text"
                        />
                        <FormInput
                          label="Kutudaki Adet"
                          value={sparePartForm.boxQuantity}
                          onChange={(e) => setSparePartForm((p) => ({ ...p, boxQuantity: sanitizeIntText(e.target.value, { maxDigits: 10 }) }))}
                          inputMode="numeric"
                          type="text"
                        />
                        <FormInput
                          label="Konteynır Adet"
                          value={sparePartForm.containerQuantity}
                          onChange={(e) => setSparePartForm((p) => ({ ...p, containerQuantity: sanitizeIntText(e.target.value, { maxDigits: 10 }) }))}
                          inputMode="numeric"
                          type="text"
                        />
                        <FormInput
                          label="Navlun"
                          value={sparePartForm.freight}
                          onChange={(e) => setSparePartForm((p) => ({ ...p, freight: sanitizeDecimalInput(e.target.value, { max: 999999999, decimals: 2 }) }))}
                          inputMode="decimal"
                          type="text"
                        />
                      </>
                    ) : (
                      <>
                        <FormInput
                          label="Minimum Stok"
                          hint="Stok alarmı: stok bu seviyeye inince ürün 'Kritik' olarak işaretlenir. Satışı KAPATMAZ."
                          value={form.minStock}
                          onChange={(e) => setForm((p) => ({ ...p, minStock: sanitizeIntText(e.target.value, { maxDigits: 10 }) }))}
                          inputMode="numeric"
                          type="text"
                        />
                        <FormInput
                          label="Satışa Kapanma Eşiği"
                          hint="Stok bu sayının altına düşünce ürün bayi tarafında otomatik satışa kapanır, stok toparlayınca kendiliğinden açılır. Varsayılan 12. 0 yazarsan eşik uygulanmaz, mal stok bitene kadar satılır."
                          value={form.bsyMinStock}
                          onChange={(e) => setForm((p) => ({ ...p, bsyMinStock: sanitizeIntText(e.target.value, { maxDigits: 10 }) }))}
                          inputMode="numeric"
                          type="text"
                        />
                        <FormInput
                          label="Kutudaki Adet"
                          value={form.boxQuantity}
                          onChange={(e) => setForm((p) => ({ ...p, boxQuantity: sanitizeIntText(e.target.value, { maxDigits: 10 }) }))}
                          inputMode="numeric"
                          type="text"
                        />
                        <FormInput
                          label="Konteynır Adet"
                          value={form.containerQuantity}
                          onChange={(e) => setForm((p) => ({ ...p, containerQuantity: sanitizeIntText(e.target.value, { maxDigits: 10 }) }))}
                          inputMode="numeric"
                          type="text"
                        />
                        <FormInput
                          label="Navlun"
                          value={form.freight}
                          onChange={(e) => setForm((p) => ({ ...p, freight: sanitizeDecimalInput(e.target.value, { max: 999999999, decimals: 2 }) }))}
                          inputMode="decimal"
                          type="text"
                        />
                      </>
                    )}
                  </div>
                </div>
              )}

              {modalActiveTab === 'media' && (
                <div className="space-y-4">
                  {isSparePart ? (
                    <>
                      <div>
                        <div className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide mb-1">Yedek Parça Görseli (Opsiyonel)</div>
                        <div className="flex items-center gap-3 mt-1">
                          {sparePartImagePreviewUrl && (
                            <button
                              type="button"
                              onClick={() => { setPreviewImageUrl(toImageSrc(sparePartImagePreviewUrl)); setPreviewOpen(true) }}
                              className="w-20 h-16 border border-gray-200 rounded bg-gray-50 overflow-hidden flex-shrink-0"
                              title="Önizleme"
                            >
                              <img loading="lazy" src={toImageSrc(sparePartImagePreviewUrl)} alt="" className="w-full h-full object-cover" />
                            </button>
                          )}
                          <div className="flex-1">
                            <input
                              type="file"
                              accept="image/*"
                              onChange={(e) => {
                                const f = e.target.files?.[0] ?? null
                                if (!f) return
                                setSparePartImageFile(f)
                                setSparePartImagePreviewUrl(URL.createObjectURL(f))
                                const key = `cover-${Date.now()}-${Math.random().toString(16).slice(2)}`
                                setCoverImage({ key, file: f, previewUrl: URL.createObjectURL(f) })
                              }}
                              className="input-base text-sm"
                            />
                            {sparePartImageFile && (
                              <div className="mt-1 text-[11px] text-gray-500">Seçildi: {sparePartImageFile.name}</div>
                            )}
                          </div>
                          {(sparePartImageFile || sparePartImagePreviewUrl || sparePartForm.existingImageUrl) && (
                            <button
                              type="button"
                              onClick={() => {
                                setSparePartImageFile(null)
                                setSparePartImagePreviewUrl('')
                                setCoverImage(null)
                                setSparePartForm((p) => ({ ...p, existingImageUrl: '' }))
                              }}
                              className="px-3 py-2 text-xs font-semibold border border-gray-200 rounded hover:bg-gray-50 text-red-600 hover:bg-red-50"
                            >
                              Kaldır
                            </button>
                          )}
                        </div>
                      </div>
                      <div>
                        <div className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide mb-1">Açıklama</div>
                        <textarea value={sparePartForm.description} onChange={(e) => setSparePartForm((p) => ({ ...p, description: e.target.value }))} className="input-base text-sm min-h-[90px]" />
                      </div>
                    </>
                  ) : (
                    <>
                      <div>
                        <div className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide mb-1">Kapak Görseli</div>
                        <div className="mt-2">
                          {(() => {
                            const show = String(coverImage?.url ?? coverImage?.previewUrl ?? '').trim()
                            return (
                              <div className="flex items-center gap-3">
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (!show) return
                                    setPreviewImageUrl(show)
                                    setPreviewOpen(true)
                                  }}
                                  className="w-28 h-20 border border-gray-200 rounded bg-gray-50 overflow-hidden"
                                  title="Önizleme"
                                >
                                  {show ? <img loading="lazy" src={toImageSrc(show)} alt="" className="w-full h-full object-cover" /> : null}
                                </button>

                                <div className="flex-1">
                                  <input
                                    type="file"
                                    accept="image/*"
                                    onChange={(e) => {
                                      const f = e.target.files && e.target.files[0] ? e.target.files[0] : null
                                      if (!f) return
                                      const key = `cover-${Date.now()}-${Math.random().toString(16).slice(2)}`
                                      const previewUrl = URL.createObjectURL(f)
                                      setCoverImage({ key, file: f, previewUrl })
                                    }}
                                    className="input-base text-sm"
                                  />
                                  {coverImage?.file ? <div className="mt-1 text-[11px] text-gray-500">Seçildi: {coverImage.file.name}</div> : null}
                                  {coverImage?.url && !coverImage.file ? <div className="mt-1 text-[11px] text-gray-500">Mevcut: {coverImage.url}</div> : null}
                                </div>

                                <button
                                  type="button"
                                  onClick={() => setCoverImage(null)}
                                  className="px-3 py-2 text-xs font-semibold border border-gray-200 text-red-650 hover:bg-gray-50 text-red-600 hover:bg-red-50"
                                  title="Kaldır"
                                >
                                  Kaldır
                                </button>
                              </div>
                            )
                          })()}
                        </div>
                      </div>

                      <div>
                        <div className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide mb-1">Yan Görseller</div>
                        {sideImages.length > 0 ? (
                          <div className="mt-2 flex gap-2 overflow-x-auto pb-2">
                            {sideImages.map((it) => {
                              const show = String(it.url ?? it.previewUrl ?? '').trim()
                              return (
                                <div key={it.key} className="relative flex-shrink-0 w-24">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (!show) return
                                      setPreviewImageUrl(show)
                                      setPreviewOpen(true)
                                    }}
                                    className="w-24 h-16 border border-gray-200 rounded bg-gray-50 overflow-hidden"
                                    title="Önizleme"
                                  >
                                    {show ? <img loading="lazy" src={toImageSrc(show)} alt="" className="w-full h-full object-cover" /> : null}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setSideImages((prev) => prev.filter((x) => x.key !== it.key))
                                    }}
                                    className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-white border border-gray-200 text-red-650 text-red-650"
                                    title="Kaldır"
                                  >
                                    ×
                                  </button>
                                </div>
                              )
                            })}
                          </div>
                        ) : null}

                        <div className="mt-2">
                          <input
                            key={imagePickerKey}
                            type="file"
                            accept="image/*"
                            onChange={(e) => {
                              const f = e.target.files && e.target.files[0] ? e.target.files[0] : null
                              if (!f) return
                              const key = `${Date.now()}-${Math.random().toString(16).slice(2)}`
                              const previewUrl = URL.createObjectURL(f)
                              setSideImages((p) => [...p, { key, file: f, previewUrl }])
                              setImagePickerKey((p) => p + 1)
                            }}
                            className="input-base text-sm"
                          />
                        </div>
                      </div>

                      <div>
                        <div className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide mb-1">Videolar</div>
                        {videoItems.length > 0 ? (
                          <div className="mt-2 space-y-2">
                            {videoItems.map((v) => (
                              <div key={v.key} className="flex items-center justify-between gap-2 border border-gray-200 rounded px-3 py-2">
                                <div className="text-[11px] text-gray-600 break-all">
                                  {v.file ? `Seçildi: ${v.file.name}` : v.url ? `Mevcut: ${v.url}` : ''}
                                </div>
                                <button
                                  type="button"
                                  onClick={() => setVideoItems((p) => p.filter((x) => x.key !== v.key))}
                                  className="px-3 py-1.5 text-xs font-semibold border border-gray-200 rounded hover:bg-gray-50 text-red-600 hover:bg-red-50"
                                >
                                  Kaldır
                                </button>
                              </div>
                            ))}
                          </div>
                        ) : null}

                        <input
                          key={videoPickerKey}
                          type="file"
                          accept="video/*"
                          onChange={(e) => {
                            const f = e.target.files && e.target.files[0] ? e.target.files[0] : null
                            if (!f) return
                            const key = `video-${Date.now()}-${Math.random().toString(16).slice(2)}`
                            setVideoItems((p) => [...p, { key, file: f }])
                            setVideoPickerKey((p) => p + 1)
                          }}
                          className="input-base text-sm"
                        />
                      </div>

                      <div>
                        <div className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide mb-1">Açıklama</div>
                        <div className="text-[10px] text-gray-400 mb-1">
                          Ürünün ne olduğunu anlatan metin. Teklif basımında ve ürün incele ekranında görünür. Özellik yazmayın.
                        </div>
                        <textarea
                          value={form.description}
                          onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
                          className="input-base text-sm min-h-[90px]"
                        />
                      </div>

                      <div>
                        <div className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide mb-1">Özellikler</div>
                        <div className="text-[10px] text-gray-400 mb-1">
                          Her satıra bir özellik. Özellikli teklif formunda madde madde basılır.
                        </div>
                        <textarea
                          value={form.features}
                          onChange={(e) => setForm((p) => ({ ...p, features: e.target.value }))}
                          className="input-base text-sm min-h-[150px] font-mono"
                          placeholder={'Güç (W) : 220 W' + String.fromCharCode(10) + 'Filtre : Çift filtre'}
                        />
                        <div className="text-[10px] text-gray-400 mt-1">
                          {String(form.features ?? '').split(String.fromCharCode(10)).map((x) => x.trim()).filter(Boolean).length} özellik
                        </div>
                      </div>

                      <div>
                        <div className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide mb-1">Patlak Şema Görseli (Opsiyonel)</div>
                        <div className="flex items-center gap-3 mt-1">
                          {explodedDiagramPreviewUrl && (
                            <button
                              type="button"
                              onClick={() => { setPreviewImageUrl(toImageSrc(explodedDiagramPreviewUrl)); setPreviewOpen(true) }}
                              className="w-20 h-16 border border-gray-200 rounded bg-gray-50 overflow-hidden"
                              title="Önizleme"
                            >
                              <img loading="lazy" src={toImageSrc(explodedDiagramPreviewUrl)} alt="" className="w-full h-full object-cover" />
                            </button>
                          )}
                          <div className="flex-1">
                            <input
                              type="file"
                              accept="image/*"
                              onChange={(e) => {
                                const f = e.target.files && e.target.files[0] ? e.target.files[0] : null
                                if (!f) return
                                setExplodedDiagramFile(f)
                                setExplodedDiagramPreviewUrl(URL.createObjectURL(f))
                              }}
                              className="input-base text-sm"
                            />
                          </div>
                          {(explodedDiagramFile || explodedDiagramPreviewUrl) && (
                            <button
                              type="button"
                              onClick={() => { setExplodedDiagramFile(null); setExplodedDiagramPreviewUrl('') }}
                              className="px-3 py-2 text-xs font-semibold border border-gray-200 rounded hover:bg-gray-50 text-red-650 hover:bg-red-50 text-red-600 hover:bg-red-50"
                            >
                              Kaldır
                            </button>
                          )}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}

              {modalActiveTab === 'links' && isSparePart && (
                <div className="space-y-4">
                  <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200 space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-xs font-bold text-slate-800 uppercase tracking-wide flex items-center gap-1.5">
                          <span>🔗 BAĞLI ÜST ÜRÜNLER VE PATLAK ŞEMA NUMARALARI</span>
                        </div>
                        <div className="text-[11px] text-slate-500 font-medium mt-0.5">
                          Bu yedek parçanın kullanıldığı tüm ürünleri ve her ürün için patlak şema / poz numarasını alt alta ekleyin.
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          setSparePartForm((p) => ({
                            ...p,
                            parentLinks: [...(p.parentLinks || []), { parentStockCode: '', explodedViewPartNo: '' }]
                          }))
                        }
                        className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700 bg-emerald-100 hover:bg-emerald-200 px-3 py-1.5 rounded-lg border border-emerald-300 transition shadow-sm"
                      >
                        + Üst Ürün Ekle
                      </button>
                    </div>

                    {(!sparePartForm.parentLinks || sparePartForm.parentLinks.length === 0) ? (
                      <div className="text-xs text-gray-400 italic text-center py-3 bg-white rounded-lg border border-dashed border-gray-300">
                        Henüz bağlı üst ürün eklenmedi. Bir parçayı birden fazla ürüne bağlamak için "+ Üst Ürün Ekle" butonunu kullanabilirsiniz.
                      </div>
                    ) : (
                      <div className="space-y-2.5">
                        {sparePartForm.parentLinks.map((link, idx) => (
                          <div key={idx} className="bg-white p-2.5 rounded-lg border border-gray-200 shadow-sm flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
                            <div className="flex-1">
                              <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">
                                #{idx + 1} Üst Ürün (Stok Kodu)
                              </label>
                              <select
                                value={link.parentStockCode}
                                onChange={(e) => {
                                  const val = e.target.value
                                  setSparePartForm((p) => {
                                    const updated = [...(p.parentLinks || [])]
                                    updated[idx] = { ...updated[idx], parentStockCode: val }
                                    return { ...p, parentLinks: updated }
                                  })
                                }}
                                className="w-full px-2.5 py-1.5 text-xs border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-emerald-500 bg-white"
                              >
                                <option value="">— Ürün Seçiniz (Opsiyonel) —</option>
                                {productsQuery.items
                                  .filter((prod: any) => {
                                    const rawGroup = String(prod?.groupCode ?? '').trim().toLowerCase().replace(/_/g, ' ')
                                    const pType = String(prod?.productType ?? '').trim().toUpperCase()
                                    const hasPartNo = String(prod?.kod5 ?? '').trim().length > 0
                                    const kod4Val = String(prod?.kod4 ?? '').trim()
                                    const hasParentStock = kod4Val.length > 0 && !isImageUrl(kod4Val)
                                    const isSp = pType === 'YEDEKPARCA' || rawGroup === 'servis yedek parca malzeme' || hasPartNo || hasParentStock
                                    return !isSp
                                  })
                                  .map((prod: any) => (
                                    <option key={String(prod.id)} value={String(prod.stockCode ?? '')}>
                                      {String(prod.stockCode ?? '')} — {String(prod.name ?? '')}
                                    </option>
                                  ))}
                              </select>
                            </div>

                            <div className="flex-1 sm:w-[220px] sm:flex-none">
                              <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">
                                Patlak Şema / Poz No
                              </label>
                              <input
                                type="text"
                                placeholder="Örn: A-101 veya Poz 12"
                                value={link.explodedViewPartNo}
                                onChange={(e) => {
                                  const val = e.target.value
                                  setSparePartForm((p) => {
                                    const updated = [...(p.parentLinks || [])]
                                    updated[idx] = { ...updated[idx], explodedViewPartNo: val }
                                    return { ...p, parentLinks: updated }
                                  })
                                }}
                                className="w-full px-2.5 py-1.5 text-xs border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-emerald-500"
                              />
                            </div>

                            <div className="self-end sm:self-center pt-1 sm:pt-4">
                              <button
                                type="button"
                                onClick={() => {
                                  setSparePartForm((p) => ({
                                    ...p,
                                    parentLinks: (p.parentLinks || []).filter((_, i) => i !== idx)
                                  }))
                                }}
                                className="px-2 py-1.5 text-xs font-bold text-red-600 hover:bg-red-50 rounded-md transition border border-transparent hover:border-red-200"
                                title="Ürün Bağlantısını Sil"
                              >
                                🗑️ Sil
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          )
        })()}
      </Modal>

      <Modal
        isOpen={previewOpen}
        onClose={() => setPreviewOpen(false)}
        title="Görsel Önizleme"
        footer={
          <button
            type="button"
            onClick={() => setPreviewOpen(false)}
            className="px-4 py-2 rounded-md text-xs font-semibold border border-gray-200 text-gray-700 hover:bg-gray-50"
          >
            Kapat
          </button>
        }
      >
        <div className="border border-gray-200 bg-gray-50 overflow-hidden">
          {previewImageUrl ? <img loading="lazy" src={toImageSrc(previewImageUrl)} alt="" className="w-full max-h-[70vh] object-contain" /> : null}
        </div>
      </Modal>

      <Modal
        isOpen={mediaPreviewOpen}
        onClose={() => setMediaPreviewOpen(false)}
        title={mediaPreviewTitle || 'Görsel Önizleme'}
        footer={
          <button
            type="button"
            onClick={() => setMediaPreviewOpen(false)}
            className="px-4 py-2 rounded-md text-xs font-semibold border border-gray-200 text-gray-700 hover:bg-gray-50"
          >
            Kapat
          </button>
        }
      >
        <div className="space-y-3">
          <div>
            <div className="text-sm font-semibold text-gray-800">{mediaPreviewTitle || 'Ürün'}</div>
            {mediaPreviewDescription ? <div className="mt-1 text-xs text-gray-600">{mediaPreviewDescription}</div> : null}
          </div>
          {(() => {
            const total = mediaPreviewImages.length + mediaPreviewVideos.length
            if (total <= 0) {
              return <div className="text-sm text-gray-600">Görsel/Video yok.</div>
            }

            const safeIndex = ((mediaActiveIndex % total) + total) % total
            const isVideo = safeIndex >= mediaPreviewImages.length
            const videoIndex = safeIndex - mediaPreviewImages.length

            return (
              <div className="relative">
                <div className="mb-2 flex items-center justify-between">
                  <div className="text-xs text-gray-500">
                    {isVideo ? 'Video' : `Görsel ${safeIndex + 1}/${mediaPreviewImages.length}`}
                  </div>
                </div>

                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                  }}
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    setMediaActiveIndex((p) => (p - 1 + total) % total)
                  }}
                  className="absolute z-20 left-3 top-1/2 -translate-y-1/2 h-12 w-12 rounded-full bg-white/90 border border-gray-200 text-gray-800 flex items-center justify-center hover:bg-white"
                  title="Önceki"
                >
                  ←
                </button>

                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                  }}
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    setMediaActiveIndex((p) => (p + 1) % total)
                  }}
                  className="absolute z-20 right-3 top-1/2 -translate-y-1/2 h-12 w-12 rounded-full bg-white/90 border border-gray-200 text-gray-800 flex items-center justify-center hover:bg-white"
                  title="Sonraki"
                >
                  →
                </button>

                {isVideo ? (
                  <div className="border border-gray-200 rounded overflow-hidden bg-black">
                    <video src={mediaPreviewVideos[videoIndex] ?? undefined} controls className="w-full max-h-[60vh]" />
                  </div>
                ) : mediaPreviewImages[safeIndex] === '/uploads/images/comingsoon.png' ? (
                  <div className="w-full h-[400px] border border-sky-100 rounded-xl overflow-hidden bg-sky-50 shadow-inner">
                    <ShipSailingAnimation size="full" />
                  </div>
                ) : (
                  <div className="border border-gray-200 bg-gray-50 overflow-hidden rounded">
                    <img loading="lazy" src={toImageSrc(mediaPreviewImages[safeIndex])} alt="" className="w-full max-h-[60vh] object-contain" />
                  </div>
                )}
              </div>
            )
          })()}
        </div>
      </Modal>

      <Modal
        isOpen={stockModalOpen}
        onClose={() => setStockModalOpen(false)}
        title={`${stockModalProduct?.stockCode ?? ''} - Depo Stok Dağılımı`}
        containerClassName="max-w-md"
        footer={
          <button
            type="button"
            onClick={() => setStockModalOpen(false)}
            className="px-4 py-2 rounded-md text-xs font-semibold border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 transition"
          >
            Kapat
          </button>
        }
      >
        <div className="space-y-4">
          <div className="p-3 bg-gray-50 rounded-lg border border-gray-150">
            <div className="text-[10px] font-bold text-gray-400 uppercase">Ürün Adı</div>
            <div className="text-xs font-semibold text-gray-800">{stockModalProduct?.name}</div>
          </div>

          {stockModalLoading && (
            <div className="flex flex-col items-center justify-center py-8 text-gray-500">
              <div className="w-8 h-8 border-4 border-emerald-600 border-t-transparent rounded-full animate-spin mb-2" />
              <p className="text-xs font-semibold">Yükleniyor...</p>
            </div>
          )}

          {stockModalError && (
            <div className="p-3 text-xs font-semibold text-red-700 bg-red-50 border border-red-200 rounded-lg">
              {stockModalError}
            </div>
          )}

          {!stockModalLoading && !stockModalError && (
            <div className="border border-gray-200 rounded-lg overflow-hidden shadow-sm">
              <table className="w-full text-xs text-left">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200 text-gray-500 font-bold uppercase text-[10px] tracking-wider">
                    <th className="px-4 py-2">Depo Adı</th>
                    <th className="px-4 py-2 text-right">Stok Adet</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 text-gray-700">
                  {stockModalBalances.length === 0 ? (
                    <tr>
                      <td colSpan={2} className="px-4 py-6 text-center text-gray-400">
                        Hiçbir depoda stok bulunmuyor.
                      </td>
                    </tr>
                  ) : (
                    stockModalBalances.map((b, idx) => (
                      <tr key={idx} className="hover:bg-gray-50 transition">
                        <td className="px-4 py-2.5 font-medium">{b.warehouseName}</td>
                        <td className="px-4 py-2.5 text-right font-bold text-gray-900">
                          {b.balance.toLocaleString('tr-TR')}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Modal>

      <Modal
        isOpen={analysisModalOpen}
        onClose={() => {
          setAnalysisModalOpen(false)
          setAnalysisData(null)
          setAnalysisSearchQ('')
          setAnalysisSupplierFilter('all')
          setSelectedAnalysisBayiCode('')
          setAnalysisError(null)
        }}
        title="Ürün Analiz Paneli"
        containerClassName="max-w-4xl"
        scrollable
      >
        <div className="mb-6 bg-slate-50 p-4 rounded-xl border border-slate-200/60 animate-fadeIn">
          <label className="block text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wider">Ürün Seçimi</label>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-2.5">
            <div className="relative">
              <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
              <input
                type="text"
                placeholder="Ürün adı veya stok kodu ile ara..."
                value={analysisSearchQ}
                onChange={(e) => setAnalysisSearchQ(e.target.value)}
                className="w-full pl-9 pr-4 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-400 bg-white text-slate-800"
              />
            </div>
            <div>
              <select
                value={analysisSupplierFilter}
                onChange={(e) => setAnalysisSupplierFilter(e.target.value)}
                className="w-full h-8 px-3 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-400 bg-white text-slate-700 font-semibold"
              >
                <option value="all">Tüm Tedarikçiler</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={String(s.id)}>
                    {s.supplierCode} - {s.fullName}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 max-h-36 overflow-y-auto pr-1">
            {filteredProductsForSelect.map((p) => {
              const isSelected = p.id === selectedAnalysisProductId
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    setSelectedAnalysisProductId(p.id)
                    setAnalysisSearchQ('')
                  }}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition ${
                    isSelected
                      ? 'bg-orange-500 text-white border-orange-600 shadow-sm'
                      : 'bg-white text-slate-700 border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  {p.name} <span className="opacity-70 text-[10px]">({p.stockCode})</span>
                </button>
              )
            })}
          </div>
        </div>

        {analysisLoading && (
          <div className="flex flex-col items-center justify-center py-12">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="animate-spin text-orange-600 mb-3"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
            <div className="text-xs font-semibold text-gray-500">Analiz verileri yükleniyor...</div>
          </div>
        )}

        {analysisError && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-center text-xs font-semibold text-red-600 my-4 flex items-center justify-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-500 shrink-0" />
            {analysisError}
          </div>
        )}

        {!analysisLoading && !analysisError && analysisData && (
          <div className="space-y-6 animate-fadeIn">
            {/* Header info */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between border-b border-slate-100 pb-4 gap-3">
              <div>
                <h3 className="text-base font-bold text-slate-800">{analysisData.productName}</h3>
                <p className="text-xs font-semibold text-slate-400 mt-0.5">Stok Kodu: {analysisData.stockCode}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <div className="text-right">
                  <div className="text-[10px] font-semibold text-slate-400 uppercase">Mevcut Stok</div>
                  <div className={`text-sm font-extrabold ${analysisData.currentStock <= analysisData.minStock ? 'text-red-600' : 'text-slate-800'}`}>
                    {analysisData.currentStock} Adet
                  </div>
                </div>
                {analysisData.currentStock <= analysisData.minStock && (
                  <div className="px-2.5 py-1 bg-red-50 text-red-600 rounded-full text-[10px] font-bold border border-red-200 animate-pulse flex items-center gap-1">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    Kritik Seviye (Min: {analysisData.minStock})
                  </div>
                )}
              </div>
            </div>

            {/* Bayi Analiz Filtresi */}
            <div className="bg-slate-50 border border-slate-200/50 p-4 rounded-xl flex flex-col md:flex-row md:items-center justify-between gap-3 shadow-sm">
              <div>
                <div className="text-xs font-bold text-slate-700 uppercase tracking-wider">Bayi Analiz Filtresi</div>
                <div className="text-[10px] text-slate-400 font-medium mt-0.5">Seçilen bayinin satın alım miktarı ve satış detayları gösterilir.</div>
              </div>
              <div className="w-full md:w-[320px]">
                <select
                  value={selectedAnalysisBayiCode}
                  onChange={(e) => setSelectedAnalysisBayiCode(e.target.value)}
                  className="w-full h-9 px-3 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-400 bg-white text-slate-800 font-semibold"
                >
                  <option value="">Tüm Bayiler (Filtresiz)</option>
                  {analysisBayiler.map((b) => (
                    <option key={b.customerCode} value={b.customerCode}>
                      {b.customerCode} - {b.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Purchase Price and Price Groups Table */}
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
              <div className="lg:col-span-1 bg-slate-50 border border-slate-200/50 p-4 rounded-xl flex flex-col justify-between">
                <div>
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Alış Fiyatı</div>
                  <div className="text-lg font-extrabold text-slate-800 mt-2">
                    {'₺' + Number(analysisData.purchasePrice ?? 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                </div>
                <div className="text-[10px] text-slate-400 font-semibold mt-4">Sistem Tanımlı Taban Fiyat</div>
              </div>
              
              <div className="lg:col-span-3 border border-slate-200/50 rounded-xl overflow-hidden bg-white">
                <div className="bg-slate-50/50 px-4 py-2.5 border-b border-slate-200/50">
                  <h4 className="text-[11px] font-bold text-slate-700 uppercase tracking-wider">Fiyat Grupları Analizi</h4>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs text-left">
                    <thead>
                      <tr className="bg-slate-50/30 border-b border-slate-200/40 text-slate-500 font-bold uppercase text-[9px] tracking-wider">
                        <th className="px-4 py-2.5">Fiyat Grubu</th>
                        <th className="px-4 py-2.5 text-right">Satış Fiyatı</th>
                        <th className="px-4 py-2.5 text-right">Kâr Tutarı</th>
                        <th className="px-4 py-2.5 text-right">Markup (Kâr Oranı)</th>
                        <th className="px-4 py-2.5 text-right">Margin (Kâr Marjı)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-slate-700">
                      {(!analysisData.prices || analysisData.prices.length === 0) ? (
                        <tr>
                          <td colSpan={5} className="px-4 py-6 text-center text-slate-400 font-medium">
                            Bu ürün için tanımlı fiyat grubu bulunamadı.
                          </td>
                        </tr>
                      ) : (
                        analysisData.prices.map((p: any, idx: number) => {
                          const salePrice = p.price ?? 0;
                          const purchasePrice = analysisData.purchasePrice ?? 0;
                          const profitAmount = salePrice - purchasePrice;
                          const markupPercent = purchasePrice > 0 ? (profitAmount / purchasePrice) * 100 : 0;
                          const profitMarginPercent = salePrice > 0 ? (profitAmount / salePrice) * 100 : 0;

                          const isProfit = profitAmount >= 0;

                          return (
                            <tr key={idx} className="hover:bg-slate-50/50 transition duration-150">
                              <td className="px-4 py-2 font-semibold text-slate-800">
                                {p.priceGroupName} <span className="text-[10px] text-slate-400 font-medium">({p.priceGroupCode})</span>
                              </td>
                              <td className="px-4 py-2 text-right font-bold text-blue-600">
                                {p.currency === 'TRY' ? '₺' : (p.currency ?? '₺')}{salePrice.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </td>
                              <td className={`px-4 py-2 text-right font-bold ${isProfit ? 'text-emerald-600' : 'text-red-600'}`}>
                                {isProfit ? '+' : ''}{profitAmount.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </td>
                              <td className={`px-4 py-2 text-right font-bold ${isProfit ? 'text-emerald-600' : 'text-red-600'}`}>
                                {markupPercent.toFixed(1)}%
                              </td>
                              <td className={`px-4 py-2 text-right font-bold ${isProfit ? 'text-emerald-600 bg-emerald-50/20' : 'text-red-600 bg-red-50/20'}`}>
                                {profitMarginPercent.toFixed(1)}%
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* Sales performance details */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 bg-slate-50 p-4 rounded-xl border border-slate-200/50">
              <div className="text-center p-2 border-b md:border-b-0 md:border-r border-slate-200/60">
                <div className="text-[10px] font-bold text-slate-400 uppercase">Toplam Satış Adedi</div>
                <div className="text-base font-extrabold text-slate-800 mt-1">{analysisData.totalQtySold} Adet</div>
              </div>
              <div className="text-center p-2 border-b md:border-b-0 md:border-r border-slate-200/60">
                <div className="text-[10px] font-bold text-slate-400 uppercase">Toplam Ciro</div>
                <div className="text-base font-extrabold text-slate-800 mt-1">
                  {'₺' + Number(analysisData.totalRevenue ?? 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
              </div>
              <div className="text-center p-2">
                <div className="text-[10px] font-bold text-slate-400 uppercase">Ortalama Satış Fiyatı</div>
                <div className="text-base font-extrabold text-slate-800 mt-1">
                  {'₺' + Number(analysisData.avgSalePrice ?? 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
              </div>
            </div>

            {/* Monthly Trend Chart */}
            <div className="border border-slate-200/50 rounded-xl bg-slate-50/30 p-5">
              <div className="flex items-center justify-between mb-4">
                <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                  <BarChart2 className="w-4 h-4 text-orange-500 shrink-0" />
                  Aylık Satış Trendi (Son 6 Ay)
                </h4>
                <span className="text-[10px] text-slate-400 font-semibold uppercase">Toplam Adet</span>
              </div>
              <div className="flex items-end justify-between gap-3 h-48 pt-6 px-2 bg-white rounded-lg border border-slate-200/40 shadow-inner">
                {(() => {
                  const maxQty = Math.max(...(analysisData.monthlyTrend ?? []).map((m: any) => m.quantity), 1)
                  return (analysisData.monthlyTrend ?? []).map((m: any, idx: number) => {
                    const percent = Math.min(100, Math.max(8, (m.quantity / maxQty) * 100))
                    return (
                      <div key={idx} className="flex-1 flex flex-col items-center group relative">
                        {/* Tooltip on Hover */}
                        <div className="absolute -top-7 scale-0 group-hover:scale-100 transition-all duration-200 bg-slate-800 text-white text-[10px] font-bold py-1 px-2 rounded shadow-md pointer-events-none z-10 whitespace-nowrap">
                          {m.quantity} Adet
                        </div>
                        
                        {/* Bar Column */}
                        <div className="w-full bg-slate-50 rounded-t-md overflow-hidden flex flex-col justify-end h-32 relative">
                          <div
                            style={{ height: `${percent}%` }}
                            className="w-full bg-gradient-to-t from-orange-500 to-orange-400 rounded-t-md group-hover:from-orange-600 group-hover:to-orange-500 transition-all duration-300"
                          />
                        </div>
                        
                        {/* Label */}
                        <span className="text-[9px] font-bold text-slate-500 mt-2 truncate w-full text-center">
                          {m.label}
                        </span>
                      </div>
                    )
                  })
                })()}
              </div>
            </div>

            {/* Weekly trend & Top customers */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Weekly Trend List */}
              <div className="border border-slate-200/50 rounded-xl bg-slate-50/30 p-5">
                <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-4 flex items-center gap-1.5">
                  <TrendingUp className="w-4 h-4 text-orange-500 shrink-0" />
                  Haftalık Satış Dağılımı (Son 4 Hafta)
                </h4>
                <div className="space-y-3">
                  {(analysisData.weeklyTrend ?? []).map((w: any, idx: number) => {
                    const maxWeeklyQty = Math.max(...(analysisData.weeklyTrend ?? []).map((wt: any) => wt.quantity), 1)
                    const percent = Math.min(100, Math.max(3, (w.quantity / maxWeeklyQty) * 100))
                    return (
                      <div key={idx} className="space-y-1">
                        <div className="flex items-center justify-between text-xs font-semibold text-slate-600">
                          <span>{w.label}</span>
                          <span className="text-slate-800 font-extrabold">{w.quantity} Adet</span>
                        </div>
                        <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
                          <div
                            style={{ width: `${percent}%` }}
                            className="h-full bg-orange-500 rounded-full transition-all duration-300"
                          />
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Top Customers */}
              <div className="border border-slate-200/50 rounded-xl bg-slate-50/30 p-5">
                <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-4 flex items-center gap-1.5">
                  <Info className="w-4 h-4 text-orange-500 shrink-0" />
                  En Çok Satan Bayiler (İlk 5)
                </h4>
                {(analysisData.topCustomers ?? []).length === 0 ? (
                  <div className="text-xs text-slate-500 py-6 text-center">Bu ürün için satış kaydı bulunamadı.</div>
                ) : (
                  <div className="divide-y divide-slate-100 max-h-48 overflow-y-auto pr-1">
                    {(analysisData.topCustomers ?? []).map((tc: any, idx: number) => (
                      <div key={idx} className="py-2.5 flex items-center justify-between text-xs first:pt-0 last:pb-0">
                        <div className="min-w-0 pr-2">
                          <div className="font-bold text-slate-800 truncate">{tc.customerName}</div>
                          <div className="text-[10px] text-slate-400 font-medium">Kod: {tc.customerCode}</div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="font-extrabold text-slate-800">{tc.totalQty} Adet</div>
                          <div className="text-[10px] text-slate-400 font-bold">
                            {'₺' + Number(tc.totalRevenue ?? 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
