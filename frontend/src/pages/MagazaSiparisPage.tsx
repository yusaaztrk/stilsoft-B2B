import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useOutletContext } from 'react-router-dom'


import CustomerSelect from '../components/forms/CustomerSelect'
import { Gift, LayoutGrid, List, Plus, Check, Eye, Pencil, ShoppingCart, CircleAlert, X } from 'lucide-react'

import Modal from '../components/Modal'
import FormInput from '../components/forms/FormInput'
import FormSelect from '../components/forms/FormSelect'
import { createEndCustomer, fetchCustomerByCode, fetchDealers, fetchEndCustomers, fetchNextCustomerCode, updateEndCustomer, type CustomerDto } from '../api/customers'
import { fetchSalesmenDropdown, type SalesmanDropdownItem } from '../api/salesmen'
import { normalizeTurkishForSearch } from '../utils/turkishSearch'
import { fetchPriceGroups, type PriceGroupDto } from '../api/priceGroups'
import { CITIES, DISTRICTS, resolveRegionFromCity } from '../constants/locations'
import SearchableSelect from '../components/common/SearchableSelect'
import { fetchActiveCampaigns, type ActiveCampaignDto } from '../api/campaigns'
import { useProductCategories } from '../hooks/useProductCategories'
import { useProducts } from '../hooks/useProducts'
import { isTryCurrency, resolveProductSalesCurrency } from '../utils/productCurrency'
import { fetchProducts } from '../api/products'
import { useCart } from '../contexts/CartContext'
import SiparisCartSection from '../components/Orders/SiparisCartSection'
import { MontajFormModal } from '../components/Orders/MontajFormModal'
import CampaignCarousel from '../components/Orders/CampaignCarousel'
import CampaignsListModal from '../components/Orders/CampaignsListModal'
import CampaignDetailPopover from '../components/Orders/CampaignDetailPopover'
import ProductCampaignBadge from '../components/Orders/ProductCampaignBadge'
import { campaignPriceForProduct } from '../services/campaignApplier'
import CurrencyFilterDropdown from '../components/Orders/CurrencyFilterDropdown'
import { apiUrl } from '../config/api'
import { PHONE_MAX_LENGTH, PHONE_PATTERN, formatPhoneNumber } from '../utils/phone'
// BSY kurali TEK KAYNAKTA — bkz. utils/productSaleStatus.ts
import { isClosedToSale as isClosedToSaleRule } from '../utils/productSaleStatus'
import { ShipSailingAnimation } from '../components/ShipSailingAnimation'

const COMING_SOON_IMAGE_URI = '/images/coming_soon_product.png'

/**
 * Bayinin para birimini ürün süzgecine geçirir.
 *
 * Burada ESKİ ürün kodlamasına çeviri yapılıyordu (`3 → 43` USD, `4 → 3` GBP). Ürün kodlaması
 * tek bir UPDATE ile göç ettirildikten sonra backend `43`'ü hiç tanımıyor ve bilinmeyen kodu
 * TL'ye düşürüyor: **dolar bayi, mağaza sipariş ekranında dolarlı ürünleri kaçırıp TL ürünleri
 * görüyordu.** Sterlin bayide ise `4` yerine `3` gidiyor, süzgeç DOLARA dönüyordu.
 *
 * Artık çeviri yok — sistemin tek kodlaması olduğu gibi geçer (1=TRY 2=EUR 3=USD 4=GBP).
 * TL'de `0` da `1` de kabul edilir, backend ikisini de TL sayar.
 */
function mapCurrencyTypeIdToCode(currencyTypeId: number | string | undefined | null): number | undefined {
  const cid = Number(currencyTypeId)
  if (cid === 1 || cid === 0) return 1  // TL
  if (cid === 2) return 2               // EUR
  if (cid === 3) return 3               // USD
  if (cid === 4) return 4               // GBP
  return undefined
}

type MontajFormState = {
  bayiAdi: string
  urunAdi: string
  miktar: number
  isimSoyisim: string
  telefon: string
  adres: string
  bolge: string
  bayiAciklama: string
}

const DEFAULT_DEALER_CODE = '120-04-000001'

type DealerSelectionState = {
  dealer: CustomerDto | null
  dealerDetails: CustomerDto | null
  customer: CustomerDto | null
  customerDetails: CustomerDto | null
  loadingDetails: boolean
  error: string
}

function formatMoneyTry(value: any, currency?: string | null) {
  const n = Number(value ?? 0)
  const cur = String(currency ?? '').trim().toUpperCase()
  const suffix = cur ? ` ${cur}` : ''
  if (!Number.isFinite(n)) return '-'
  return n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + suffix
}

type NewCustomerFormState = {
  customerCode: string
  name: string
  phone: string
  address: string
  city: string
  district: string
  taxOffice: string
  taxNumber: string
  priceGroupId: string
  salesmanCode: string
}

type EditCustomerFormState = {
  customerCode: string
  name: string
  phone: string
  address: string
  city: string
  district: string
  taxOffice: string
  taxNumber: string
  priceGroupId: string
  customerType: string
  invoiceType: string
}

function toKey(s: string) {
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
    .replace(/\s+/g, '_')
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

function formatMoney(v: number) {
  const n = Number(v ?? 0)
  const safe = Number.isFinite(n) ? n : 0
  return safe.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function normalizePhone11(value: string) {
  return formatPhoneNumber(value)
}

function isValidPhone11(value: string) {
  return PHONE_PATTERN.test(String(value ?? '').trim())
}

function ProductCategoriesAndCartSection({
  dealerCode,
  dealerLabel,
  dealerPriceGroupId,
  deliveryCustomerCode,
  deliveryCustomerLabel,
  montajCustomerDefaults,
  campaigns,
  onOpenProductCampaigns
}: {
  dealerCode: string
  dealerLabel: string
  dealerPriceGroupId?: string
  deliveryCustomerCode?: string
  deliveryCustomerLabel?: string
  /** Seçili müşterinin kartındaki ad/telefon/adres/bölge — montaj formunu önceden doldurur. */
  montajCustomerDefaults?: {
    isimSoyisim?: string
    telefon?: string
    adres?: string
    bolge?: string
    kaynakEtiketi?: string
  }
  campaigns: ActiveCampaignDto[]
  onOpenProductCampaigns: (p: { stockCode: string; name: string }) => void
}) {
  const cart = useCart()
  const layout = useOutletContext<{ isSuperAdmin?: boolean; isSuperSuperAdmin?: boolean; allowedKeys?: Set<string> }>()
  const canOnlySeePriceGroup4 = !layout?.isSuperSuperAdmin && !layout?.isSuperAdmin && Boolean(layout?.allowedKeys?.has('invoice/siparisSadeceFiyat4Gorsun'))
  const canBsyHHide = Boolean(layout?.allowedKeys?.has('invoice/bsyHHide'))
  const canBsyHComingSoon = Boolean(layout?.allowedKeys?.has('invoice/bsyHComingSoon'))

  /*
    ÜRÜN KARTINDAKİ KAMPANYALI FİYAT (2026-09-18 kullanıcı bildirimi: "ürünün fiyatı
    değişmiyor, eski fiyatın üstünü çizmeli").

    Karttaki indirim, sepetin kullandığı fiyat grubunun AYNISIYLA hesaplanmalı; yoksa kartta
    gösterilen fiyat sepete girince değişir. Sepet (`SiparisCartSection`) fiyat grubunu
    `dealerPriceGroupId`den çözüyor, burada da aynı çözüm yapılıyor: liste id ile, gelmezse
    sayısal kodla eşleşir.
  */
  const [kampanyaFiyatGruplari, setKampanyaFiyatGruplari] = useState<PriceGroupDto[]>([])

  useEffect(() => {
    let iptal = false
    void (async () => {
      try {
        const list = await fetchPriceGroups({ includeInactive: false })
        if (!iptal) setKampanyaFiyatGruplari(list ?? [])
      } catch {
        if (!iptal) setKampanyaFiyatGruplari([])
      }
    })()
    return () => {
      iptal = true
    }
  }, [])

  const siparisPriceGroupCode = useMemo(() => {
    const id = String(dealerPriceGroupId ?? '').trim()
    if (!id) return undefined
    const byId = kampanyaFiyatGruplari.find((x) => String(x.id) === id)
    const asCode = Number(id)
    const pg =
      byId ??
      (Number.isFinite(asCode) && asCode > 0
        ? kampanyaFiyatGruplari.find((x) => Number((x as any)?.code ?? 0) === asCode)
        : undefined)
    const code = pg ? Number((pg as any)?.code ?? 0) : 0
    return code > 0 ? code : undefined
  }, [dealerPriceGroupId, kampanyaFiyatGruplari])

  // Mağazanın grup formülü; kampanyalı fiyat F4'ten bununla türer. Yalnız Fiyat 4 gören
  // kullanıcıda kart zaten F4 gösterir, formül taban grup sayılır.
  const siparisPriceGroupFormula = useMemo(() => {
    if (canOnlySeePriceGroup4) return 'F4'
    const id = String(dealerPriceGroupId ?? '').trim()
    if (!id) return ''
    const byId = kampanyaFiyatGruplari.find((x) => String(x.id) === id)
    const asCode = Number(id)
    const pg =
      byId ??
      (Number.isFinite(asCode) && asCode > 0
        ? kampanyaFiyatGruplari.find((x) => Number((x as any)?.code ?? 0) === asCode)
        : undefined)
    return pg ? String((pg as any)?.formula ?? '') : ''
  }, [canOnlySeePriceGroup4, dealerPriceGroupId, kampanyaFiyatGruplari])

  /**
   * STOKTA OLMAYANI SİPARİŞ EDEBİLME (invoice/stokYokSiparis).
   *
   * Bu ekran yetkiyi HİÇ tanımıyordu: stok 0 ise düğmeler koşulsuz kapalıydı, dolayısıyla
   * yetkisi olan kullanıcı Sipariş ekranından alabiliyor ama Mağaza Sipariş'ten alamıyordu.
   * `InvoicePage` ile AYNI kural burada da geçerli.
   *
   * SSA'da `allowedKeys` boş küme geldiği için ayrıca kontrol ediliyor — bu yetki bir
   * kısıtlamayı KALDIRDIĞINDAN boş küme SSA'yı ters yönde engellerdi.
   */
  const canOrderOutOfStock =
    Boolean(layout?.isSuperSuperAdmin) || Boolean(layout?.allowedKeys?.has('invoice/stokYokSiparis'))

  const [inspectOpen, setInspectOpen] = useState(false)
  const [inspectProduct, setInspectProduct] = useState<any | null>(null)
  const [draftQty, setDraftQty] = useState<Record<string, number>>({})
  const [draftMontaj, setDraftMontaj] = useState<Record<string, string>>({})

  /**
   * Offer copy for the product being inspected. Fetched on demand rather than carried on every
   * row of the product list, which would ship a paragraph and a dozen feature lines per item.
   */
  const [inspectDetail, setInspectDetail] = useState<{ description?: string | null; features?: string | null } | null>(null)

  useEffect(() => {
    const code = String(inspectProduct?.stockCode ?? '').trim()
    if (!code) {
      setInspectDetail(null)
      return
    }

    const ac = new AbortController()
    void (async () => {
      try {
        const token = localStorage.getItem('accessToken')
        const res = await fetch(apiUrl(`/api/products/${encodeURIComponent(code)}/detail`), {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          signal: ac.signal
        })
        if (!res.ok) return
        const json = await res.json()
        setInspectDetail(json?.data ?? null)
      } catch {
        // Copy is optional; the modal is still useful without it.
      }
    })()
    return () => ac.abort()
  }, [inspectProduct?.stockCode])

  const toImageSrc = (url: any) => {
    const s = String(url ?? '').trim()
    if (!s) return ''
    if (s.startsWith('http://') || s.startsWith('https://')) return s
    return apiUrl(s)
  }
  const { data: categoriesState, loading: categoriesLoading, error: categoriesError } = useProductCategories({
    includeDealer: true,
    dealerCode
  })

  const hasAnyCampaignForProduct = (p: any) => {
    const sc = String(p?.stockCode ?? '').trim().toUpperCase()
    if (!sc) return false
    const pc = String(p?.groupCode ?? '').trim().toUpperCase()
    const psc = String(p?.subGroupCode ?? '').trim().toUpperCase()
    const norm = (v: unknown) => String(v ?? '').trim().toUpperCase()

    return (campaigns ?? []).some((campaign) => {
      if (!campaign) return false
      // 1. Check conditions
      for (const condition of campaign.conditions ?? []) {
        if (!condition) continue
        const json = String(condition.productStockCodesJson ?? '').trim()
        if (json) {
          try {
            const parsed = JSON.parse(json)
            if (parsed && typeof parsed === 'object' && ('ProductStockCodes' in parsed || 'GroupCodes' in parsed || 'productStockCodes' in parsed || 'groupCodes' in parsed)) {
              const targetStocks = (parsed.ProductStockCodes || parsed.productStockCodes || []) as string[]
              const targetGroups = (parsed.GroupCodes || parsed.groupCodes || []) as string[]

              const normStocks = targetStocks.map(x => norm(x)).filter(Boolean)
              const normGroups = targetGroups.map(x => norm(x)).filter(Boolean)

              const scMatch = sc && normStocks.includes(sc)
              const catMatch = (pc && normGroups.includes(pc)) || (psc && normGroups.includes(psc))

              if (scMatch || catMatch) return true
            } else if (Array.isArray(parsed)) {
              const normalized = parsed.map((x) => norm(x)).filter(Boolean)
              if (sc && normalized.includes(sc)) return true
            }
          } catch { }
          /*
            ÜRÜN LİSTESİ VARSA KATEGORİYE DÜŞÜLMEZ (2026-09-18) — kural
            `ProductCampaignBadge` ile aynı, burada bu `continue` eksikti.

            Seçili ürün indiriminin şartında hem ürün listesi (`["1451"]`) hem kategori
            (`BYZ-ESYA`) duruyor. `continue` olmayınca aşağıdaki kategori dalı çalışıyor ve
            kampanya kategorinin BÜTÜN ürünlerine yayılıyordu; "Kampanyalı" süzgeci ile
            kategori sayaçları bu yüzden yanlış ürünleri sayıyordu.
          */
          continue
        }

        if (condition.categoryCode) {
          const condCat = norm(condition.categoryCode)
          const isMainMatch = pc && pc === condCat
          const isSubMatch = psc && psc === condCat

          if (isMainMatch || isSubMatch) {
            const hasSubFilter = condition.categoryCode && condition.brandCode
            if (hasSubFilter) {
              if (psc && psc === norm(condition.brandCode)) {
                return true
              }
            } else {
              return true
            }
          }
        }
      }

      // 2. Check discounts
      for (const discount of campaign.discounts ?? []) {
        if (!discount) continue
        if (sc && norm(discount.stokKodu) === sc) {
          return true
        }
        /*
          GRUP EŞLEŞMESİ YALNIZ ÜRÜN SEÇİLMEMİŞ SATIRDA (2026-09-18) — kural
          `ProductCampaignBadge` ile aynı. Burası "Kampanyalı" süzgecini ve kategori
          sayaçlarını besliyor; guard olmadan seçili ürün indirimi kategorinin BÜTÜN
          ürünlerini kampanyalı gösteriyordu.
        */
        if (!discount.stokKodu && discount.grupKodu) {
          const discGroup = norm(discount.grupKodu)
          if (pc && pc === discGroup) return true
          if (psc && psc === discGroup) return true
        }
      }

      return false
    })
  }

  const productsQuery = useProducts({
    includeDealer: true,
    dealerCode,
    /*
      FİYAT BAYİDEN ÇÖZÜLÜR — TESLİM MÜŞTERİSİNDEN DEĞİL (2026-08-26, kullanıcı: "mağaza
      siparişte sepet sadece fiyat 4 grubuna göre çalışıyor, bayi grup 1 olmasına rağmen").

      Burada `priceCustomerCode` olarak `deliveryCustomerCode` geçiliyordu; o alan mağazanın
      sattığı SON MÜŞTERİ. Sunucu fiyat grubunu bu koddan çözdüğü için (ProductsController,
      `pricingCustomerCode`), son müşterinin fiyat grubu yoksa katalog grup 4'e düşüyor ve
      bayinin grubu (ör. 1) hiç uygulanmıyordu.

      Çalışan Sipariş sayfası (InvoicePage) zaten `priceCustomerCode: dealer?.code` geçiyor;
      burası onunla hizalandı. `deliveryCustomerCode` teslim hedefi olarak AYNEN duruyor —
      sepete ve sipariş gövdesine gitmeye devam ediyor, yalnızca FİYATLAMA ondan okumuyor.
    */
    priceCustomerCode: dealerCode,
    defaultIncludeInactive: false,
    defaultPageSize: 500,
    displayPriceGroupCode: canOnlySeePriceGroup4 ? 4 : undefined,
    enabled: !categoriesLoading && Boolean(dealerCode)
  })

  const toAbsoluteMediaUrl = (url: string | null | undefined) => {
    const s = String(url ?? '').trim()
    if (!s) return ''
    if (s.startsWith('http://') || s.startsWith('https://')) return s
    return apiUrl(s)
  }

  const formatMoney = (n: number) =>
    new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' }).format(Number(n) || 0)

  const visibleProductPrice = (product: any) => canOnlySeePriceGroup4 && product?.displayUnitPrice ? product.displayUnitPrice : product?.unitPrice
  const visibleProductCurrency = (product: any) => canOnlySeePriceGroup4 && product?.displayCurrency ? product.displayCurrency : product?.currency
  // SATIŞ dövizi. Burada `currencyCode` (ALIŞ dövizi) okunuyordu; bkz. utils/productCurrency.ts
  const visibleProductCurrencyCode = (product: any) => canOnlySeePriceGroup4 && product?.displayCurrencyCode ? product.displayCurrencyCode : product?.salesCurrencyCode

  const isAvailableForOrdering = useCallback((p: any): boolean => {
    if (!p) return false
    if (p.isActive === false) return false
    if (isClosedToSaleRule(p)) return false
    return true
  }, [])

  const searchFilteredItems = useMemo(() => {
    return (productsQuery.items ?? []).filter(isAvailableForOrdering)
  }, [productsQuery.items, isAvailableForOrdering])

  const getSubsForMain = (mainLabel: string) => {
    const direct = (categoriesState.subsByMain as Record<string, string[]>)[mainLabel]
    if (Array.isArray(direct) && direct.length) return direct

    const byKey = (categoriesState.subsByMain as Record<string, string[]>)[categoryToKey(mainLabel)]
    if (Array.isArray(byKey) && byKey.length) return byKey

    const byMetaKey = (categoriesState.subsByMain as Record<string, string[]>)[metaToKey(mainLabel)]
    if (Array.isArray(byMetaKey) && byMetaKey.length) return byMetaKey

    return []
  }

  const mainTabs = useMemo(() => {
    const activeMains = (categoriesState.mains ?? []).filter((m) => {
      const subs = getSubsForMain(m)
      return subs.length > 0
    })
    return activeMains.filter((m) => m !== 'Tüm Ürünler')
  }, [categoriesState.mains, categoriesState.subsByMain])

  const subTabsByMain = useMemo(() => {
    const out: Record<string, string[]> = {}
    mainTabs.forEach((m) => {
      if (m === 'Tüm Ürünler') return
      out[m] = getSubsForMain(m)
    })
    return out
  }, [categoriesState.subsByMain, mainTabs])

  const defaultMain = mainTabs[0] ?? ''
  const activeMainTab = useMemo(() => {
    const key = String(productsQuery.main ?? '').trim().toUpperCase()
    if (!key) return defaultMain
    const exact = mainTabs.find((t) => toKey(t) === key)
    return exact ?? defaultMain
  }, [defaultMain, mainTabs, productsQuery.main])

  const categories = useMemo(() => {
    return subTabsByMain[activeMainTab] ?? (defaultMain ? subTabsByMain[defaultMain] ?? [] : [])
  }, [activeMainTab, defaultMain, subTabsByMain])

  const defaultSub = categories[0] ?? ''
  const activeCategory = useMemo(() => {
    const key = String(productsQuery.sub ?? '').trim().toUpperCase()
    if (!key) return defaultSub
    const exact = categories.find((c) => toKey(c) === key)
    return exact ?? defaultSub
  }, [categories, defaultSub, productsQuery.sub])

  const [allProductsForCampaigns, setAllProductsForCampaigns] = useState<any[]>([])
  const [allProductsForCampaignsLoading, setAllProductsForCampaignsLoading] = useState(false)

  useEffect(() => {
    if (!dealerCode) {
      setAllProductsForCampaigns([])
      return
    }
    void (async () => {
      try {
        setAllProductsForCampaignsLoading(true)
        const res = await fetchProducts({
          page: 1,
          pageSize: 2000,
          includeDealer: true,
          dealerCode: dealerCode,
          includeInactive: true
        })
        setAllProductsForCampaigns(res.items ?? [])
      } catch (err) {
        console.error('Failed to fetch all products for campaigns', err)
      } finally {
        setAllProductsForCampaignsLoading(false)
      }
    })()
  }, [dealerCode])

  const campaignCountsByCategory = useMemo(() => {
    const mainCounts: Record<string, number> = {}
    const subCounts: Record<string, number> = {}

    mainTabs.forEach((m) => {
      mainCounts[toKey(m)] = 0
      const subs = subTabsByMain[m] ?? []
      subs.forEach((s) => {
        subCounts[`${toKey(m)}_${toKey(s)}`] = 0
      })
    })

    ;(allProductsForCampaigns ?? []).forEach((p: any) => {
      if (hasAnyCampaignForProduct(p)) {
        const pGroup = String(p.groupCode ?? p.mainCategory ?? '').trim()
        const pSubGroup = String(p.subGroupCode ?? p.subCategory ?? '').trim()

        const groupKey = toKey(pGroup)
        const subKey = `${toKey(pGroup)}_${toKey(pSubGroup)}`

        if (mainCounts[groupKey] !== undefined) {
          mainCounts[groupKey]++
        }
        if (subCounts[subKey] !== undefined) {
          subCounts[subKey]++
        }
      }
    })

    return { mainCounts, subCounts }
  }, [mainTabs, subTabsByMain, allProductsForCampaigns, campaigns])

  useEffect(() => {
    if (!defaultMain || !defaultSub) return
    if (productsQuery.main && productsQuery.sub) return
    productsQuery.setMainSub(toKey(defaultMain), toKey(defaultSub))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultMain, defaultSub])

  const productSearchRef = useRef<HTMLInputElement | null>(null)

  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [sortMode, setSortMode] = useState<'default' | 'priceAsc' | 'priceDesc' | 'stockDesc'>('default')
  const [onlyInStock, setOnlyInStock] = useState(false)
  const [showOutOfStock, setShowOutOfStock] = useState(false)
  const [onlyPriced, setOnlyPriced] = useState(false)
  const [onlyCampaignProducts, setOnlyCampaignProducts] = useState(false)

  // KUR SÜZGECİ — sipariş sayfasındakinin aynısı: çoklu seçim, hiçbiri işaretli değilse
  // süzgeç kapalı. Ürünün SATIŞ dövizine bakılır (alış dövizine asla düşülmez).
  const [productCurrencyFilters, setProductCurrencyFilters] = useState<Array<'TRY' | 'EUR' | 'USD' | 'GBP'>>([])

  const currencyFilterOptions: Array<{ value: 'ALL' | 'TRY' | 'EUR' | 'USD' | 'GBP'; label: string }> = [
    { value: 'ALL', label: 'Tümü' },
    { value: 'TRY', label: '₺ TL' },
    { value: 'EUR', label: '€ EUR' },
    { value: 'USD', label: '$ USD' },
    { value: 'GBP', label: '£ GBP' }
  ]

  const productCurrencyOf = (product: any): 'TRY' | 'EUR' | 'USD' | 'GBP' => {
    const code = resolveProductSalesCurrency({
      currency: visibleProductCurrency(product),
      salesCurrencyCode: visibleProductCurrencyCode(product)
    })
    if (isTryCurrency(code)) return 'TRY'
    const upper = String(code ?? '').trim().toUpperCase()
    return upper === 'EUR' || upper === 'USD' || upper === 'GBP' ? (upper as 'EUR' | 'USD' | 'GBP') : 'TRY'
  }

  const isCurrencyFilterChecked = (value: 'ALL' | 'TRY' | 'EUR' | 'USD' | 'GBP') =>
    value === 'ALL' ? productCurrencyFilters.length === 0 : productCurrencyFilters.includes(value)

  const toggleCurrencyFilter = (value: 'ALL' | 'TRY' | 'EUR' | 'USD' | 'GBP') => {
    if (value === 'ALL') {
      setProductCurrencyFilters([])
      return
    }
    setProductCurrencyFilters((prev) =>
      prev.includes(value) ? prev.filter((x) => x !== value) : [...prev, value]
    )
  }
  const [fullImagePreviewUrl, setFullImagePreviewUrl] = useState<string | null>(null)
  const [montajOpen, setMontajOpen] = useState(false)
  const [montajProductId, setMontajProductId] = useState<string | null>(null)
  const [montajError, setMontajError] = useState<string | null>(null)
  const [montajForm, setMontajForm] = useState<MontajFormState>({
    bayiAdi: '',
    urunAdi: '',
    miktar: 1,
    isimSoyisim: '',
    telefon: '',
    adres: '',
    bolge: '',
    bayiAciklama: ''
  })
  const [montajDetails, setMontajDetails] = useState<Record<string, any>>({})

  const montajDetailsByProductId = useMemo(() => {
    const out: Record<string, any> = {}
    for (const [productId, d] of Object.entries(montajDetails ?? {})) {
      out[String(productId)] = {
        bayiAdi: d?.bayiAdi,
        urunAdi: d?.urunAdi,
        miktar: d?.miktar,
        isimSoyisim: d?.isimSoyisim,
        telefon: d?.telefon,
        adres: d?.adres,
        bolge: d?.bolge,
        bayiAciklama: d?.bayiAciklama
      }
    }
    return out
  }, [montajDetails])

  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const showToast = (msg: string) => {
    setToastMessage(msg)
    setTimeout(() => setToastMessage(null), 2500)
  }

  const productMap = useMemo(() => {
    const m = new Map<string, typeof productsQuery.items[0]>()
    productsQuery.items.forEach((p) => m.set(p.id, p))
    return m
  }, [productsQuery.items])

  const loadedDealerRef = useRef<string | null>(null)
  useEffect(() => {
    const code = dealerCode ? String(dealerCode).trim() : ''
    if (code && loadedDealerRef.current !== code) {
      loadedDealerRef.current = code
      void cart.loadCustomerBasket(code)
    }
  }, [dealerCode, cart])

  useEffect(() => {
    if (dealerCode && productsQuery.items && productsQuery.items.length > 0) {
      cart.syncProductPrices(productsQuery.items, String(dealerCode))
    }
  }, [dealerCode, productsQuery.items])

  const checkCurrencyLock = (targetCurrency: string): boolean => {
    const activeDealerId = String(dealerCode ?? '').trim()
    const dealerLines = cart.lines.filter((l) => String(l.dealer?.id).trim() === activeDealerId)
    if (dealerLines.length > 0) {
      const existingRaw = String(dealerLines[0]?.product?.currency ?? 'TRY').trim().toUpperCase()
      const existingCurr = (existingRaw === 'TL' || !existingRaw) ? 'TRY' : existingRaw
      const newCurr = (targetCurrency === 'TL' || !targetCurrency) ? 'TRY' : targetCurrency
      if (existingCurr !== newCurr) {
        showToast(`Sepetinizde ${existingCurr} ürünler var. Farklı döviz (${newCurr}) ekleyemezsiniz.`)
        return false
      }
    }
    return true
  }

  const addToCart = (productId: string) => {
    const p = productMap.get(productId)
    if (!p) return

    const isClosedToSale = isClosedToSaleRule(p as any)
    if (isClosedToSale && canBsyHHide) {
      showToast('Bu ürünü görüntüleme yetkiniz yok')
      return
    }
    // "Yakında" kilidini stokYokSiparis yetkisi KALDIRIR (2026-08-21 kullanıcı kuralı).
    // Yetkinin anlamı "stoğu olmayanı da sipariş edebilsin"; gelecek ürün de tam olarak
    // stoğu olmayan üründür. Yetki açıkken burada durdurmak, aynı kullanıcının Sipariş
    // ekranından alıp Mağaza Sipariş'ten alamamasına yol açıyordu.
    if (isClosedToSale && canBsyHComingSoon && !canOrderOutOfStock) {
      showToast('Gelecek ürünler için henüz sipariş verilemez.')
      return
    }

    const qty = Math.max(1, Number(draftQty[productId] ?? 1))
    const montaj = (draftMontaj[productId] ?? 'Montaj istemiyorum.') as 'Montaj istemiyorum.' | 'Montaj istiyorum.'
    const isInstallable = Boolean((p as any)?.isInstallable)
    const installationFee = Number((p as any)?.installationFee ?? 0)

    const resolvedUnitPrice = p.unitPrice === null ? null : Number(p.unitPrice)
    if (resolvedUnitPrice === null || !Number.isFinite(resolvedUnitPrice) || resolvedUnitPrice <= 0) {
      showToast('Fiyat Tanımlı Değil')
      return
    }

    if (montaj === 'Montaj istiyorum.') {
      if (!isInstallable) {
        setDraftMontaj((prev) => ({ ...prev, [productId]: 'Montaj istemiyorum.' }))
        showToast('Bu ürün için montaj seçeneği yok')
        return
      }
      setMontajProductId(productId)
      setMontajForm((prev) => ({
        ...prev,
        bayiAdi: dealerLabel || dealerCode,
        urunAdi: p?.name ?? '',
        miktar: qty
      }))
      setMontajError(null)
      setMontajOpen(true)
      return
    }

    const currency = resolveProductSalesCurrency(p as any)

    if (!checkCurrencyLock(currency)) {
      return
    }

    cart.addLine({
      product: {
        id: p.id,
        stockCode: p.stockCode,
        name: p.name,
        unitPrice: resolvedUnitPrice,
        displayUnitPrice: p?.displayUnitPrice ?? null,
        kdvRate: Number(p.taxRate ?? 0) || 0,
        imageUrl: p.imageUrl ?? null,
        isInstallable,
        installationFee: Number.isFinite(installationFee) ? installationFee : 0,
        currency
      },
      dealer: { id: dealerCode, label: dealerLabel || dealerCode },
      montaj,
      qty
    })
    showToast('Ürün sepete eklendi')
  }

  const saveMontajAndAddToCartWithDetails = (details: any) => {
    if (!montajProductId) return
    const qty = Math.max(1, Number(details.miktar || 1))
    const product = productMap.get(montajProductId)
    if (!product) return

    const stockNumber = Number((product as any)?.stock ?? 0)
    const bsyFlag = String((product as any)?.bsyVisibleFlag ?? 'E').trim().toUpperCase()
    const isBsyHBelowMinStock = isClosedToSaleRule({ isActive: true, bsyVisibleFlag: bsyFlag, stock: stockNumber, bsyMinStock: (product as any)?.bsyMinStock })

    if (isBsyHBelowMinStock && canBsyHHide) {
      setMontajOpen(false)
      showToast('Bu ürünü görüntüleme yetkiniz yok')
      return
    }
    if (isBsyHBelowMinStock) {
      setMontajOpen(false)
      showToast('Gelecek ürünler için henüz sipariş verilemez.')
      return
    }
    if (!Boolean((product as any)?.isInstallable)) {
      setDraftMontaj((prev) => ({ ...prev, [montajProductId]: 'Montaj istemiyorum.' }))
      setMontajOpen(false)
      showToast('Bu ürün için montaj seçeneği yok')
      return
    }

    const unitPrice = product.unitPrice === null ? null : Number(product.unitPrice)
    if (unitPrice === null || !Number.isFinite(unitPrice) || unitPrice <= 0) {
      setMontajOpen(false)
      showToast('Fiyat Tanımlı Değil')
      return
    }

    const kdvRate = Number(product.taxRate ?? 0)
    const installationFee = Number((product as any)?.installationFee ?? 0)

    const currency = resolveProductSalesCurrency(product as any)

    if (!checkCurrencyLock(currency)) {
      setMontajOpen(false)
      return
    }

    cart.addLine({
      product: {
        id: montajProductId,
        name: product?.name ?? '',
        stockCode: product?.stockCode ?? '',
        unitPrice,
        displayUnitPrice: product?.displayUnitPrice ?? null,
        kdvRate,
        imageUrl: product.imageUrl ?? null,
        isInstallable: true,
        installationFee: Number.isFinite(installationFee) ? installationFee : 0,
        currency
      },
      dealer: { id: dealerCode, label: dealerLabel || dealerCode },
      montaj: 'Montaj istiyorum.',
      montajDetails: details,
      qty
    })
    setMontajDetails((prev) => ({ ...prev, [montajProductId]: details }))
    setMontajOpen(false)
    showToast('Ürün sepete eklendi')
  }

  return (
    <div className="mt-6">
      {/* 1. SATIR: ARAMA VE FİLTRELEME İŞLEMLERİ */}
      <div className="relative z-30 bg-white/80 backdrop-blur-md border border-gray-200/60 rounded-xl shadow-[0_1px_3px_rgba(0,0,0,0.04)] px-4 py-3 mb-4">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          <div className="relative z-40 flex-1 max-w-md">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
            <input
              ref={productSearchRef}
              value={productsQuery.q}
              onChange={(e) => productsQuery.setQ(e.target.value)}
              placeholder="Ürün adı, stok kodu veya barkod ile hızlı ara..."
              className="w-full h-9 pl-9 pr-8 text-xs sm:text-sm border border-slate-200 rounded-xl bg-white focus:ring-2 focus:ring-[#D84315]/20 focus:border-[#D84315]/30 transition shadow-xs"
            />
            {productsQuery.q && (
              <button
                type="button"
                onClick={() => productsQuery.setQ('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1"
                title="Temizle"
              >
                <X size={14} />
              </button>
            )}

            {productsQuery.q.trim().length >= 2 && (
              <div className="absolute left-0 right-0 top-full mt-1.5 z-50 bg-white border border-slate-200 rounded-2xl shadow-2xl max-h-80 overflow-y-auto p-2 space-y-1 w-full min-w-[320px] sm:min-w-[440px]">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wide px-3 py-1 flex items-center justify-between border-b border-slate-100 pb-1.5 mb-1">
                  <span>Arama Sonuçları</span>
                  <span className="text-[#D84315] font-extrabold">{searchFilteredItems.length} ürün bulundu</span>
                </div>
                {searchFilteredItems.length === 0 ? (
                  <div className="px-3 py-4 text-center text-xs text-slate-400 font-semibold">Satışa açık uygun ürün bulunamadı.</div>
                ) : (
                  searchFilteredItems.slice(0, 10).map((p: any) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        productsQuery.setQ(p.name || p.stockCode)
                      }}
                      className="w-full text-left p-2.5 rounded-xl hover:bg-orange-50/80 border border-transparent hover:border-orange-200 transition-all flex items-center justify-between gap-3 group"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-10 h-10 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center shrink-0 overflow-hidden relative">
                          <span className="text-xs font-bold text-slate-400 select-none">{String(p.name ?? 'U').charAt(0).toUpperCase()}</span>
                          {p.imageUrl ? (
                            <img
                              src={toAbsoluteMediaUrl(String(p.imageUrl))}
                              alt={p.name}
                              className="absolute inset-0 w-full h-full object-contain p-0.5 bg-white"
                              onError={(e) => {
                                ;(e.currentTarget as HTMLElement).style.display = 'none'
                              }}
                            />
                          ) : null}
                        </div>
                        <div className="min-w-0">
                          <div className="text-xs font-bold text-slate-800 truncate group-hover:text-[#D84315]">{p.name}</div>
                          <div className="text-[10px] text-slate-400 truncate font-semibold">
                            {p.stockCode ? `Stok: ${p.stockCode}` : ''} {p.groupCode ? `• Kategori: ${p.groupCode}` : ''}
                          </div>
                        </div>
                      </div>
                      <div className="text-xs font-black text-[#D84315] shrink-0">
                        {visibleProductPrice(p) ? formatMoney(Number(visibleProductPrice(p))) : 'Fiyat Yok'}
                      </div>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => setViewMode('grid')}
                className={
                  'h-8 px-3 rounded-lg border text-xs font-bold flex items-center gap-2 ' +
                  (viewMode === 'grid' ? 'border-[#D84315] text-[#D84315] bg-orange-50' : 'border-slate-200 text-slate-700 bg-white')
                }
                title="Kutu görünüm"
              >
                <LayoutGrid size={14} />
                Kutu
              </button>
              <button
                type="button"
                onClick={() => setViewMode('list')}
                className={
                  'h-8 px-3 rounded-lg border text-xs font-bold flex items-center gap-2 ' +
                  (viewMode === 'list' ? 'border-[#D84315] text-[#D84315] bg-orange-50' : 'border-slate-200 text-slate-700 bg-white')
                }
                title="Liste görünüm"
              >
                <List size={14} />
                Liste
              </button>
              <button
                type="button"
                onClick={() => setOnlyCampaignProducts((p) => !p)}
                className={
                  'h-8 px-3 rounded-lg border text-xs font-bold flex items-center gap-2 ' +
                  (onlyCampaignProducts ? 'border-orange-600 text-orange-700 bg-orange-50' : 'border-slate-200 text-slate-700 bg-white')
                }
                title="Kampanyalı ürünler"
              >
                <Gift size={14} />
                Kampanyalı
              </button>
            </div>

            <div className="h-6 w-px bg-slate-300 mx-0.5 hidden sm:block" />

            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => setOnlyInStock((p) => !p)}
                className={
                  'h-8 px-3 rounded-lg border text-xs font-bold ' +
                  (onlyInStock ? 'border-emerald-600 text-emerald-700 bg-emerald-50' : 'border-slate-200 text-slate-700 bg-white')
                }
                title="Sadece stokta olanlar"
              >
                Stokta
              </button>
              <button
                type="button"
                onClick={() => setShowOutOfStock((p) => !p)}
                className={
                  'h-8 px-3 rounded-lg border text-xs font-bold flex items-center gap-1.5 transition ' +
                  (showOutOfStock ? 'border-red-600 text-red-700 bg-red-50 ring-1 ring-red-300' : 'border-slate-200 text-slate-700 bg-white hover:bg-slate-50')
                }
                title="Sadece stokta olmayan ürünleri gösterir"
              >
                <CircleAlert size={14} className={showOutOfStock ? 'text-red-600' : 'text-slate-500'} />
                Stokta Olmayanları Göster
              </button>
              <button
                type="button"
                onClick={() => setOnlyPriced((p) => !p)}
                className={
                  'h-8 px-3 rounded-lg border text-xs font-bold ' +
                  (onlyPriced ? 'border-pink-600 text-pink-700 bg-pink-50' : 'border-slate-200 text-slate-700 bg-white')
                }
                title="Sadece fiyatı olanlar"
              >
                Fiyatlı
              </button>
            </div>

            <div className="h-6 w-px bg-slate-300 mx-0.5 hidden sm:block" />

            {/* KUR SÜZGECİ — ürünün satış dövizi (Açılır Onay Kutulu Dropdown) */}
            <CurrencyFilterDropdown
              selected={productCurrencyFilters}
              onChange={setProductCurrencyFilters}
            />

            <div className="h-6 w-px bg-slate-300 mx-0.5 hidden sm:block" />

            <div className="flex items-center gap-2">
              <span className="text-[10px] font-semibold text-slate-600">Sırala</span>
              <select
                value={sortMode}
                onChange={(e) => setSortMode(e.target.value as any)}
                className="h-8 px-2 text-[11px] font-bold border border-slate-200 rounded-lg bg-white"
              >
                <option value="default">Varsayılan</option>
                <option value="priceAsc">Fiyat (Düşük → Yüksek)</option>
                <option value="priceDesc">Fiyat (Yüksek → Düşük)</option>
                <option value="stockDesc">Stok (Çoktan aza)</option>
              </select>
            </div>

            <div className="h-6 w-px bg-slate-300 mx-0.5 hidden sm:block" />

            <div className="flex items-center gap-2">
              <span className="text-[10px] font-semibold text-slate-600">Göster</span>
              <select
                value={(productsQuery as any).pageSize ?? 500}
                onChange={(e) => (productsQuery as any).setPageSize?.(Number(e.target.value))}
                className="h-8 px-2 text-[11px] font-bold border border-slate-200 rounded-lg bg-white"
              >
                <option value={20}>20</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
                <option value={500}>500</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* 2. SATIR: ANA KATEGORİLER */}
      <div className="relative z-20 bg-white/80 backdrop-blur-md border border-gray-200/60 rounded-xl shadow-[0_1px_3px_rgba(0,0,0,0.04)] px-4 py-3 mb-4">
        <div className="overflow-x-auto overflow-y-hidden [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden pt-2.5">
          <div className="flex items-center gap-6 text-[11px] font-semibold text-gray-700 min-w-max">
            {mainTabs.map((t) => {
              const isActive = t === activeMainTab
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => {
                    if (t === 'Tüm Ürünler') {
                      productsQuery.setMainSub('', '', true)
                    } else {
                      const nextCats = subTabsByMain[t] ?? []
                      const nextSub = nextCats[0] ?? ''
                      if (!nextSub) return
                      productsQuery.setMainSub(toKey(t), toKey(nextSub), true)
                    }
                  }}
                  className={
                    'py-2 border-b-2 relative ' +
                    (isActive ? 'text-[#B73A0B] border-[#B73A0B]' : 'text-gray-700 border-transparent hover:text-gray-900')
                  }
                >
                  {categoriesState.labels?.[t] || t}
                  {onlyCampaignProducts && (campaignCountsByCategory.mainCounts[toKey(t)] ?? 0) > 0 && (
                    <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 bg-red-600 text-white text-[9px] font-extrabold min-w-[18px] h-[16px] px-1 rounded-full flex items-center justify-center border border-white shadow-xs leading-none pointer-events-none z-10">
                      {campaignCountsByCategory.mainCounts[toKey(t)]}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* 3. SATIR: ALT KATEGORİLER */}
      {categories.length > 0 && (
        <div className="relative z-10 bg-white/80 backdrop-blur-md border border-gray-200/60 rounded-xl shadow-[0_1px_3px_rgba(0,0,0,0.04)] px-4 py-3 mb-4">
          <div className="overflow-x-auto overflow-y-hidden [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden pt-2.5">
            <div className="flex items-center gap-4 min-w-max">
              {categories.map((c) => {
                const isActive = c === activeCategory
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => productsQuery.setMainSub(toKey(activeMainTab), toKey(c), true)}
                    className={
                      'text-[11px] font-semibold relative ' +
                      (isActive ? 'text-[#B73A0B] border-b-2 border-[#B73A0B] pb-1' : 'text-gray-700')
                    }
                  >
                    {categoriesState.labels?.[c] || c}
                    {onlyCampaignProducts && (campaignCountsByCategory.subCounts[`${toKey(activeMainTab)}_${toKey(c)}`] ?? 0) > 0 && (
                      <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 bg-red-600 text-white text-[8px] font-extrabold min-w-[16px] h-[15px] px-1 rounded-full border border-white shadow-xs flex items-center justify-center leading-none pointer-events-none z-10">
                        {campaignCountsByCategory.subCounts[`${toKey(activeMainTab)}_${toKey(c)}`]}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {categoriesLoading && <div className="mb-3 text-sm text-gray-500">Kategoriler yükleniyor...</div>}
      {categoriesError && <div className="mb-3 text-sm font-semibold text-red-600">{categoriesError}</div>}

      {productsQuery.error && <div className="mb-3 text-sm font-semibold text-red-600">{productsQuery.error}</div>}

      <div className="flex items-start gap-4">
        <div className="flex-1 min-w-0">
          <div className="pr-12">
            <div className={viewMode === 'grid' ? 'grid grid-cols-2 sm:grid-cols-2 xl:grid-cols-5 gap-2 sm:gap-5' : 'grid grid-cols-1 min-[900px]:grid-cols-2 gap-3.5'}>
              {productsQuery.loading && <div className="col-span-full text-sm text-gray-500">Yükleniyor...</div>}

              {!productsQuery.loading && productsQuery.items.length === 0 && (
                <div className="col-span-full text-sm text-gray-500">Ürün bulunamadı.</div>
              )}

              {productsQuery.items
                .filter((p: any) => {
                  if (!onlyCampaignProducts) return true
                  return hasAnyCampaignForProduct(p)
                })
                .filter((p: any) => {
                  const stockNumber = Number((p as any)?.stock ?? 0)
                  const bsyFlag = String((p as any)?.bsyVisibleFlag ?? 'E').trim().toUpperCase()

                  // BSY Rule: If canBsyHHide is active and product is closed to sale (isActive === false), hide product completely
                  const isClosedToSale = isClosedToSaleRule(p as any)
                  if (canBsyHHide && isClosedToSale) {
                    return false
                  }

                  if (!showOutOfStock && stockNumber <= 0) return false
                  if (onlyInStock && stockNumber <= 0) return false
                  const hasPrice = visibleProductPrice(p) !== null && Number(visibleProductPrice(p)) > 0
                  if (onlyPriced && !hasPrice) return false
                  // Kur süzgeci: ürünün SATIŞ dövizi
                  if (productCurrencyFilters.length > 0 && !productCurrencyFilters.includes(productCurrencyOf(p))) return false
                  return true
                })
                .slice()
                .sort((a: any, b: any) => {
                  if (sortMode === 'default') return 0
                  if (sortMode === 'stockDesc') return Number((b as any)?.stock ?? 0) - Number((a as any)?.stock ?? 0)
                  const ap = Number(visibleProductPrice(a) ?? 0)
                  const bp = Number(visibleProductPrice(b) ?? 0)
                  if (sortMode === 'priceAsc') return ap - bp
                  if (sortMode === 'priceDesc') return bp - ap
                  return 0
                })
                .map((p) => {
                  const qty = draftQty[p.id] ?? 1
                  const montaj = draftMontaj[p.id] ?? 'Montaj istemiyorum.'
                  const isInstallable = Boolean((p as any)?.isInstallable)
                  const effectivePrice = visibleProductPrice(p)
                  const hasPrice = effectivePrice !== null && Number(effectivePrice) > 0
                  const stockNumber = Number((p as any)?.stock ?? 0)
                  const depotText = stockNumber > 12 ? '+12' : String(Math.max(0, Math.trunc(stockNumber)))
                  const boxQty = Number((p as any)?.boxQuantity ?? 0)
                  const boxText = String(Math.max(0, Math.trunc(boxQty)))
                  const priceText = hasPrice ? formatMoney(Number(effectivePrice ?? 0)) : 'Fiyat Tanımlı Değil'

                  /*
                    Kampanyalı birim fiyat — sepetle TEK KAYNAKTAN (`campaignPriceForProduct`).
                    Yalnız birim fiyatı değiştiren kampanyalar (Seçili Ürün / Kategori-Marka)
                    hesaba girer; sepet toplamına bakan kampanyalar kartta fiyat değiştirmez.
                  */
                  const kampanyaFiyati = hasPrice
                    ? campaignPriceForProduct(
                        { stockCode: String(p.stockCode ?? ''), groupCode: (p as any).groupCode, subGroupCode: (p as any).subGroupCode, kod4: (p as any).kod4, kod5: (p as any).kod5 },
                        Number(effectivePrice ?? 0),
                        campaigns ?? [],
                        siparisPriceGroupCode,
                        // İndirim F4'e uygulanır, mağazanın grubuna formülle taşınır.
                        {
                          catalogPrice: (p as any).catalogUnitPrice,
                          catalogCurrency: (p as any).catalogCurrency,
                          formula: siparisPriceGroupFormula,
                          taxRate: (p as any).taxRate,
                          discountRate: (p as any).discountRate
                        }
                      )
                    : null
                  const kampanyaFiyatText = kampanyaFiyati ? formatMoney(kampanyaFiyati.newPrice) : ''

                  const currencyText = resolveProductSalesCurrency({
                    currency: visibleProductCurrency(p),
                    salesCurrencyCode: visibleProductCurrencyCode(p)
                  })
                  const taxLine = `KDV: %${Number((p as any)?.taxRate ?? 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

                  const isClosedToSale = isClosedToSaleRule(p as any)
                  const isComingSoonFlag = Boolean((p as any)?.isComingSoon) || Boolean((p as any)?.comingSoon)
                  // GÖRÜNÜM ile SİPARİŞ KİLİDİ AYRI (2026-08-21 kullanıcı kuralı).
                  //
                  // `shouldShowComingSoon` yalnızca GÖRÜNÜMdür: gemi görseli, "YAKINDA STOĞA
                  // GELECEK" rozeti ve listenin en altına düşme. Satışa kapalı ürün, yetki ne
                  // olursa olsun bunu gösterir — kullanıcı malın yolda olduğunu görmelidir.
                  //
                  // `comingSoonBlocksOrder` ise sipariş kilididir ve `stokYokSiparis` yetkisi
                  // bunu KALDIRIR: yetkili kullanıcı gemiyi görmeye devam eder ama sipariş
                  // girebilir. Önce ikisi tek bayrağa bağlanmıştı, o yüzden yetki açılınca
                  // gemi de kayboluyordu — istenen bu değildi.
                  const shouldShowComingSoon = isComingSoonFlag || (canBsyHComingSoon && isClosedToSale)
                  const comingSoonBlocksOrder = shouldShowComingSoon && !canOrderOutOfStock

                  const stockStatus = stockNumber <= 0 ? 'out' : stockNumber <= 12 ? 'limited' : 'in'
                  const stockBadgeText =
                    shouldShowComingSoon
                      ? 'YAKINDA STOĞA GELECEK'
                      : stockStatus === 'out'
                        ? 'Stokta Yok'
                        : stockStatus === 'limited'
                          ? `Sınırlı Stok (${Math.max(0, Math.trunc(stockNumber))})`
                          : 'Stokta'
                  const stockBadgeClass =
                    shouldShowComingSoon
                      ? 'bg-amber-500 text-slate-950 ring-1 ring-amber-400 font-extrabold'
                      : stockStatus === 'out'
                        ? 'bg-red-100 text-red-800 ring-1 ring-red-200'
                        : stockStatus === 'limited'
                          ? 'bg-amber-100 text-amber-800 ring-1 ring-amber-200'
                          : 'bg-emerald-100 text-emerald-800 ring-1 ring-emerald-200'

                  const cartQty = cart.lines.find((l) => l.product.id === p.id)?.qty ?? 0

                  if (viewMode === 'list') {
                    return (
                      <div
                        key={p.id}
                        className={
                          'relative bg-white border border-slate-200/80 rounded-xl p-3.5 hover:shadow-md hover:border-[#D84315]/40 transition-all flex flex-col justify-between gap-2.5 min-h-[125px] ' +
                          (stockStatus === 'out' && !shouldShowComingSoon ? 'opacity-75 grayscale hover:grayscale-0 hover:opacity-100' : '')
                        }
                      >
                        <ProductCampaignBadge
                          productStockCode={String(p.stockCode ?? '')}
                          productCategory={p.groupCode}
                          productSubCategory={p.subGroupCode}
                          productKod4={p.kod4}
                          productKod5={p.kod5}
                          campaigns={campaigns ?? []}
                          position="top-left"
                          onClick={() => onOpenProductCampaigns({ stockCode: String(p.stockCode ?? ''), name: String(p.name ?? '') })}
                        />

                        <div className="flex items-start gap-3 flex-1">
                          {/* Left Section: 80x80 image / placeholder */}
                          <div
                            onClick={() => {
                              setInspectProduct(p)
                              setInspectOpen(true)
                            }}
                            className="w-20 h-20 bg-slate-50 border border-slate-200 rounded-lg overflow-hidden flex items-center justify-center shrink-0 relative cursor-pointer group p-1"
                            title="Ürün detayını incele"
                          >
                            {shouldShowComingSoon ? (
                              <ShipSailingAnimation size="md" />
                            ) : p.imageUrl ? (
                              <img loading="lazy" src={toImageSrc(p.imageUrl)} alt={p.name} className="w-full h-full object-contain p-1 bg-white group-hover:scale-105 transition-transform" />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-slate-400 font-extrabold text-lg bg-slate-100">
                                {String(p.name ?? 'U').charAt(0).toUpperCase()}
                              </div>
                            )}
                          </div>

                          {/* Middle Section: Name, StockCode, Barcode, Depo/Koli */}
                          <div className="flex-1 min-w-0 flex flex-col justify-between min-h-[80px]">
                            <div>
                              <div
                                onClick={() => {
                                  setInspectProduct(p)
                                  setInspectOpen(true)
                                }}
                                className="text-xs font-bold text-slate-900 line-clamp-3 cursor-pointer hover:text-[#D84315] transition-colors leading-snug"
                                title={p.name}
                              >
                                {p.name}
                              </div>
                              <div className="mt-1 text-[11px] font-sans font-bold text-slate-900 leading-tight">
                                {p.stockCode ? `Stok Kodu: ${p.stockCode}` : ''}
                              </div>
                              {p.barcode && (
                                <div className="text-[11px] font-sans font-bold text-slate-900 leading-tight">
                                  {`Barkod: ${p.barcode}`}
                                </div>
                              )}
                            </div>
                            <div className="mt-1 text-[10px] text-slate-500 font-medium leading-tight">
                              {`Depo: ${depotText} • Koli: ${boxText} • ${taxLine}`}
                            </div>
                          </div>

                          {/* Right Section: Price & Stock Badge */}
                          <div className="w-[140px] sm:w-[160px] shrink-0 flex flex-col items-end text-right justify-between min-h-[80px]">
                            <div className="flex flex-col items-end">
                              {kampanyaFiyati ? (
                                <div className="flex flex-col items-end leading-tight">
                                  <span className="text-[11px] font-semibold text-slate-400 line-through">{priceText}</span>
                                  <span className="text-sm sm:text-base font-extrabold text-emerald-700">{kampanyaFiyatText}</span>
                                  <span className="text-[9px] font-bold text-emerald-600">
                                    {kampanyaFiyati.percent !== null ? `Kampanya %${kampanyaFiyati.percent}` : 'Kampanyalı fiyat'}
                                  </span>
                                </div>
                              ) : (
                                <div className={'text-sm sm:text-base font-extrabold ' + (hasPrice ? 'text-slate-900' : 'text-red-600')}>
                                  {priceText}
                                </div>
                              )}
                              <div className="mt-0.5">
                                <span className={stockBadgeClass + ' text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider'}>
                                  {stockBadgeText}
                                </span>
                              </div>

                              {/* Cart indicator badge */}
                              {cartQty > 0 && (
                                <div className="mt-1.5 inline-flex items-center gap-1 text-[10px] font-extrabold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200 shadow-2xs">
                                  <Check size={11} /> Sepette · {cartQty} adet
                                </div>
                              )}
                            </div>

                            <div className="flex items-center gap-1.5 justify-end mt-1">
                              <button
                                type="button"
                                onClick={() => {
                                  setInspectProduct(p)
                                  setInspectOpen(true)
                                }}
                                className="p-1.5 rounded-lg border border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors"
                                title="Ürün Detayı"
                              >
                                <Eye size={14} />
                              </button>
                            </div>
                          </div>
                        </div>

                        {/* Bottom Controls Row: Montaj, Qty, Add to Cart */}
                        <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-2">
                          {isInstallable ? (
                            <select
                              value={montaj}
                              onChange={(e) => setDraftMontaj((prev) => ({ ...prev, [p.id]: e.target.value as any }))}
                              className="h-7 px-2 text-[10px] border border-slate-200 rounded-lg bg-slate-50 text-slate-700 flex-1 max-w-[140px]"
                            >
                              <option>Montaj istemiyorum.</option>
                              <option>Montaj istiyorum.</option>
                            </select>
                          ) : <div />}

                          <div className="flex items-center gap-2">
                            <div className="flex items-center bg-slate-100 rounded-lg p-0.5 border border-slate-200 h-7">
                              <button
                                type="button"
                                onClick={() => setDraftQty((prev) => ({ ...prev, [p.id]: Math.max(1, Number((prev as any)[p.id] ?? qty) - 1) }))}
                                className="w-6 h-6 flex items-center justify-center text-slate-600 hover:text-[#D84315] disabled:opacity-50 font-bold"
                                aria-label="Azalt"
                                disabled={(stockStatus === 'out' && !canOrderOutOfStock) || comingSoonBlocksOrder}
                              >
                                -
                              </button>
                              <input
                                type="number"
                                min={1}
                                value={qty}
                                onChange={(e) => setDraftQty((prev) => ({ ...prev, [p.id]: Number(e.target.value) }))}
                                className="w-9 bg-transparent border-none text-center p-0 text-xs font-extrabold focus:ring-0 disabled:opacity-50"
                                disabled={(stockStatus === 'out' && !canOrderOutOfStock) || comingSoonBlocksOrder}
                              />
                              <button
                                type="button"
                                onClick={() => setDraftQty((prev) => ({ ...prev, [p.id]: Math.max(1, Number((prev as any)[p.id] ?? qty) + 1) }))}
                                className="w-6 h-6 flex items-center justify-center text-slate-600 hover:text-[#D84315] disabled:opacity-50 font-bold"
                                aria-label="Arttır"
                                disabled={(stockStatus === 'out' && !canOrderOutOfStock) || comingSoonBlocksOrder}
                              >
                                +
                              </button>
                            </div>

                            <button
                              type="button"
                              onClick={() => addToCart(p.id)}
                              className={
                                'h-7 text-white text-xs font-bold px-3 rounded-lg transition-all shadow-xs flex items-center gap-1 ' +
                                ((stockStatus === 'out' && !canOrderOutOfStock) || comingSoonBlocksOrder ? 'bg-amber-600/80 cursor-not-allowed' : 'bg-[#D84315] hover:bg-orange-700 active:scale-95')
                              }
                              disabled={(stockStatus === 'out' && !canOrderOutOfStock) || comingSoonBlocksOrder}
                            >
                              {comingSoonBlocksOrder ? 'Yakında Stoğa Gelecek' : 'Sepete Ekle'}
                            </button>
                          </div>
                        </div>
                      </div>
                    )
                  }

                  return (
                    <div
                      key={p.id}
                      className={
                        'relative group bg-white border border-slate-100 rounded-xl overflow-hidden hover:shadow-xl hover:shadow-slate-200/40 transition-all duration-300 flex flex-col ' +
                        (stockStatus === 'out' && !shouldShowComingSoon ? 'opacity-75 grayscale hover:grayscale-0 hover:opacity-100' : '')
                      }
                    >
                      <ProductCampaignBadge
                        productStockCode={String(p.stockCode ?? '')}
                        productCategory={p.groupCode}
                        productSubCategory={p.subGroupCode}
                        productKod4={p.kod4}
                        productKod5={p.kod5}
                        campaigns={campaigns ?? []}
                        onClick={() => onOpenProductCampaigns({ stockCode: String(p.stockCode ?? ''), name: String(p.name ?? '') })}
                      />

                      <div
                        onClick={() => {
                          setInspectProduct(p)
                          setInspectOpen(true)
                        }}
                        className={(shouldShowComingSoon ? "relative aspect-[4/3] overflow-hidden bg-white" : "relative aspect-[4/3] overflow-hidden bg-slate-900") + " cursor-pointer group"}
                        title="Ürün detayını incele"
                      >
                        <div className="absolute top-3 left-3 z-10">
                          <span className={stockBadgeClass + ' text-[9px] sm:text-[10px] font-black px-2 py-0.5 rounded uppercase tracking-wider shadow-md'}>
                            {stockBadgeText}
                          </span>
                        </div>
                        {shouldShowComingSoon ? (
                          <ShipSailingAnimation size="lg" />
                        ) : p.imageUrl ? (
                          <img loading="lazy" src={toImageSrc(p.imageUrl)} alt={p.name} className="w-full h-full object-contain group-hover:scale-110 transition-transform duration-500 p-2 sm:p-6 bg-white" />
                        ) : (
                          <div className="w-full h-full bg-slate-50" />
                        )}
                      </div>

                      <div className="p-3 sm:p-4 flex-1 flex flex-col">
                        <div className="mb-3">
                          <div className="flex justify-between items-start gap-2 mb-1">
                            <span className="text-[9px] sm:text-[10px] font-semibold text-[#D84315] uppercase tracking-widest">{String(p.groupCode ?? 'Ürün')}</span>
                            <div className="text-right">
                              <div className="text-[9px] sm:text-[11px] font-sans font-bold text-slate-500">{p.stockCode ? `Stok: ${p.stockCode}` : ''}</div>
                              {p.barcode && <div className="text-[9px] sm:text-[11px] font-sans font-bold text-slate-500 mt-0.5">{`Barkod: ${p.barcode}`}</div>}
                            </div>
                          </div>

                          <div className="font-bold text-xs sm:text-sm text-slate-900 leading-tight group-hover:text-[#D84315] transition-colors line-clamp-3 min-h-[52px] sm:min-h-[58px]">{p.name}</div>

                          <div className="text-[10px] sm:text-xs text-slate-500 mt-1.5">{`Depo: ${depotText}  •  Koli: ${boxText}`}</div>
                        </div>

                        <div className="mt-auto">
                          <div className="mb-2">
                            {kampanyaFiyati && (
                              <div className="text-[11px] font-semibold text-slate-400 line-through leading-none mb-0.5">{priceText}</div>
                            )}
                            <div className="flex items-baseline gap-1">
                              <span className={'text-base sm:text-lg font-bold ' + (kampanyaFiyati ? 'text-emerald-700' : (hasPrice ? 'text-slate-900' : 'text-red-600'))}>
                                {kampanyaFiyati ? kampanyaFiyatText : priceText}
                              </span>
                              <span className="text-[10px] sm:text-xs font-medium text-slate-500 uppercase tracking-tighter">{currencyText || 'TRY'}</span>
                            </div>
                            {kampanyaFiyati && (
                              <div className="text-[10px] font-bold text-emerald-600 leading-none mt-0.5">
                                {kampanyaFiyati.percent !== null ? `Kampanya %${kampanyaFiyati.percent}` : 'Kampanyalı fiyat'}
                              </div>
                            )}
                          </div>

                          {isInstallable && (
                            <div className="mb-2 h-8">
                              <select
                                value={montaj}
                                onChange={(e) =>
                                  setDraftMontaj((prev) => ({
                                    ...prev,
                                    [p.id]: e.target.value as any
                                  }))
                                }
                                className="w-full h-8 px-2 text-[10px] border rounded-lg focus:outline-none focus:ring-2 focus:ring-[#D84315]/15 focus:border-[#D84315]/30 border-slate-200 bg-slate-50 text-slate-800"
                              >
                                <option>Montaj istemiyorum.</option>
                                <option>Montaj istiyorum.</option>
                              </select>
                            </div>
                          )}

                          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-1.5 sm:gap-2">
                            <div className="flex items-center bg-slate-100 rounded-lg p-0.5 border border-slate-200 justify-between">
                              <button
                                type="button"
                                onClick={() => setDraftQty((prev) => ({ ...prev, [p.id]: Math.max(1, Number((prev as any)[p.id] ?? qty) - 1) }))}
                                className="w-6 h-6 flex items-center justify-center text-slate-500 hover:text-[#D84315] disabled:opacity-50 disabled:cursor-not-allowed text-xs font-bold"
                                disabled={(stockStatus === 'out' && !canOrderOutOfStock) || comingSoonBlocksOrder}
                              >
                                -
                              </button>

                              <input
                                type="number"
                                min={1}
                                value={qty}
                                onChange={(e) => setDraftQty((prev) => ({ ...prev, [p.id]: Number(e.target.value) }))}
                                className="w-8 sm:w-10 bg-transparent border-none text-center p-0 text-xs font-bold focus:ring-0 disabled:opacity-50"
                                disabled={(stockStatus === 'out' && !canOrderOutOfStock) || comingSoonBlocksOrder}
                                aria-label="Miktar"
                              />

                              <button
                                type="button"
                                onClick={() => setDraftQty((prev) => ({ ...prev, [p.id]: Math.max(1, Number((prev as any)[p.id] ?? qty) + 1) }))}
                                className="w-6 h-6 flex items-center justify-center text-slate-500 hover:text-[#D84315] disabled:opacity-50 disabled:cursor-not-allowed text-xs font-bold"
                                disabled={(stockStatus === 'out' && !canOrderOutOfStock) || comingSoonBlocksOrder}
                              >
                                +
                              </button>
                            </div>

                            <div className="flex items-center gap-1.5 flex-1">
                              <button
                                type="button"
                                onClick={() => addToCart(p.id)}
                                className={
                                  'flex-1 text-white text-[11px] sm:text-xs font-bold py-1.5 sm:py-2 px-2 rounded-lg flex items-center justify-center gap-1.5 transition-colors shadow-md ' +
                                  ((stockStatus === 'out' && !canOrderOutOfStock) || comingSoonBlocksOrder ? 'bg-slate-300 cursor-not-allowed' : 'bg-[#D84315] hover:bg-orange-700 shadow-orange-600/10')
                                }
                                disabled={(stockStatus === 'out' && !canOrderOutOfStock) || comingSoonBlocksOrder}
                              >
                                {comingSoonBlocksOrder ? 'Yakında' : 'Sepete Ekle'}
                              </button>

                              <button
                                type="button"
                                onClick={() => {
                                  setInspectProduct(p)
                                  setInspectOpen(true)
                                }}
                                className="px-2 py-1.5 sm:py-2 rounded-lg border border-slate-200 bg-white text-slate-700 text-[11px] sm:text-xs font-bold hover:bg-slate-50 shrink-0"
                              >
                                İncele
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })}
            </div>
          </div>
        </div>

        <SiparisCartSection
          dealerCode={dealerCode}
          dealerLabel={dealerLabel || dealerCode}
          priceGroupId={String(dealerPriceGroupId ?? '').trim() || undefined}
          deliveryCustomerCode={String(deliveryCustomerCode ?? '').trim() || undefined}
          deliveryCustomerLabel={String(deliveryCustomerLabel ?? '').trim() || undefined}
          fabAnchorRef={productSearchRef as any}
          hideCampaignHeader={true}
          canOnlySeePriceGroup4={canOnlySeePriceGroup4}
          montajDetailsByProductId={montajDetailsByProductId}
        />

        <Modal
          isOpen={inspectOpen}
          onClose={() => {
            setInspectOpen(false)
            setInspectProduct(null)
          }}
          title="Ürün İncele"
          scrollable
          containerClassName="max-w-3xl"
          footer={
            <>
              <button
                type="button"
                onClick={() => {
                  setInspectOpen(false)
                  setInspectProduct(null)
                }}
                className="h-[34px] px-4 text-xs font-semibold rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 transition"
              >
                Kapat
              </button>
            </>
          }
        >
          {inspectProduct ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="border border-gray-200 rounded-lg overflow-hidden bg-gray-50 flex items-center justify-center p-4">
                {(() => {
                  const stockNumber = Number((inspectProduct as any)?.stock ?? 0)
                  const bsyFlag = String((inspectProduct as any)?.bsyVisibleFlag ?? 'E').trim().toUpperCase()
                  const isBsyHBelowMinStock = isClosedToSaleRule({ isActive: true, bsyVisibleFlag: bsyFlag, stock: stockNumber, bsyMinStock: (inspectProduct as any)?.bsyMinStock })
                  // Burası salt görünüm: gemi animasyonu yetkiden BAĞIMSIZ gösterilir.
                  const shouldShowComingSoon = isBsyHBelowMinStock && !canBsyHHide && canBsyHComingSoon

                  if (shouldShowComingSoon) {
                    return (
                      <div className="w-full h-[280px] border border-sky-100 rounded-lg overflow-hidden bg-sky-50 shadow-inner">
                        <ShipSailingAnimation size="full" />
                      </div>
                    )
                  }

                  const imgSrc = String(inspectProduct.imageUrl ?? '').trim() ? toImageSrc(inspectProduct.imageUrl) : ''

                  return imgSrc ? (
                    <img
                      src={imgSrc}
                      alt={String(inspectProduct.name ?? '')}
                      className="w-full h-[280px] object-contain bg-white cursor-pointer hover:opacity-90 transition-opacity"
                      onClick={() => setFullImagePreviewUrl(imgSrc)}
                      title="Resmi tam ekranda görüntüle"
                    />
                  ) : (
                    <div className="w-full h-[280px] flex items-center justify-center text-xs text-gray-400">Görsel yok</div>
                  )
                })()}
              </div>

              <div className="space-y-3">
                <div>
                  <div className="text-xs font-semibold text-gray-500">Stok Kodu</div>
                  <div className="text-sm font-bold text-gray-900">{String(inspectProduct.stockCode ?? '')}</div>
                </div>
                <div>
                  <div className="text-xs font-semibold text-gray-500">Ürün</div>
                  <div className="text-sm font-bold text-gray-900">{String(inspectProduct.name ?? '')}</div>
                </div>
                <div>
                  <div className="text-xs font-semibold text-gray-500">Fiyat</div>
                  <div className="text-sm font-bold text-gray-900">{formatMoneyTry(visibleProductPrice(inspectProduct), visibleProductCurrency(inspectProduct))}</div>
                </div>
                {(() => {
                  // The maintained copy wins over whatever the catalogue row happens to carry.
                  const aciklama = String(inspectDetail?.description ?? inspectProduct.description ?? '').trim()
                  return aciklama ? (
                    <div>
                      <div className="text-xs font-semibold text-gray-500">Açıklama</div>
                      <div className="text-xs text-gray-700 whitespace-pre-line">{aciklama}</div>
                    </div>
                  ) : null
                })()}
                {(() => {
                  const ozellikler = String(inspectDetail?.features ?? '')
                    .split('\n')
                    .map((x) => x.trim())
                    .filter(Boolean)
                  if (ozellikler.length === 0) return null
                  return (
                    <div>
                      <div className="text-xs font-semibold text-gray-500">Özellikler</div>
                      <ul className="mt-1 space-y-0.5">
                        {ozellikler.map((o, i) => (
                          <li key={i} className="text-xs text-gray-700 flex gap-1.5">
                            <span className="text-gray-400">•</span>
                            <span>{o}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )
                })()}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-xs font-semibold text-gray-500">KDV</div>
                    <div className="text-xs font-semibold text-gray-800">{Number(inspectProduct.taxRate ?? 0)}%</div>
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-gray-500">Stok</div>
                    <div className="text-xs font-semibold text-gray-800">{String(inspectProduct.stock ?? '-')}</div>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </Modal>

        {fullImagePreviewUrl && (
          <Modal
            isOpen={Boolean(fullImagePreviewUrl)}
            onClose={() => setFullImagePreviewUrl(null)}
            title=""
            hideHeader
            scrollable={false}
            overlayClassName="p-2 sm:p-4 z-[300]"
            containerClassName="max-w-5xl w-full bg-slate-950/95 border border-slate-800 p-4 rounded-2xl flex flex-col items-center justify-center relative shadow-2xl"
          >
            <button
              type="button"
              onClick={() => setFullImagePreviewUrl(null)}
              className="absolute top-4 right-4 z-10 p-2.5 rounded-full bg-slate-800/80 hover:bg-slate-700 text-white transition cursor-pointer shadow-lg"
              title="Kapat"
            >
              <X size={22} />
            </button>
            <div className="w-full h-full flex items-center justify-center p-2">
              <img
                src={fullImagePreviewUrl}
                alt="Görsel Detay"
                className="max-w-full max-h-[85vh] object-contain rounded-lg shadow-2xl"
              />
            </div>
          </Modal>
        )}
      </div>

      {/* Montaj Formu Modalı */}
      <MontajFormModal
        isOpen={montajOpen}
        onClose={() => setMontajOpen(false)}
        onSave={saveMontajAndAddToCartWithDetails}
        dealerName={montajForm.bayiAdi || dealerLabel || dealerCode || ''}
        productName={montajForm.urunAdi || ''}
        quantity={montajForm.miktar || 1}
        initialValues={montajProductId ? montajDetails[montajProductId] : undefined}
        customerDefaults={montajCustomerDefaults}
        customerCode={String(deliveryCustomerCode || dealerCode || '').trim() || undefined}
        submitButtonText="Kaydet ve Uygula"
      />

      {/* Toast */}
      {toastMessage && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-gray-900 text-white px-6 py-3 rounded-lg shadow-lg text-sm font-semibold">
          {toastMessage}
        </div>
      )}
    </div>
  )
}

export default function MagazaSiparisPage() {
  const layout = useOutletContext<{ isSuperAdmin?: boolean; allowedKeys?: Set<string> }>()
  const canBsyHHide = Boolean(layout?.allowedKeys?.has('invoice/bsyHHide'))
  const canBsyHComingSoon = Boolean(layout?.allowedKeys?.has('invoice/bsyHComingSoon'))

  const [state, setState] = useState<DealerSelectionState>({
    dealer: null,
    dealerDetails: null,
    customer: null,
    customerDetails: null,
    loadingDetails: false,
    error: ''
  })

  const [campaigns, setCampaigns] = useState<ActiveCampaignDto[]>([])
  const [campaignsLoading, setCampaignsLoading] = useState(false)
  const [campaignsModalOpen, setCampaignsModalOpen] = useState(false)
  const [campaignDetailOpen, setCampaignDetailOpen] = useState(false)
  const [selectedCampaign, setSelectedCampaign] = useState<ActiveCampaignDto | null>(null)
  const [selectedProductForCampaign, setSelectedProductForCampaign] = useState<{ stockCode: string; name: string } | null>(null)

  const emptyNewCustomerForm: NewCustomerFormState = {
    customerCode: '',
    name: '',
    phone: '',
    address: '',
    city: '',
    district: '',
    taxOffice: '',
    taxNumber: '',
    priceGroupId: '',
    salesmanCode: ''
  }

  const [newCustomerModalOpen, setNewCustomerModalOpen] = useState(false)
  const [newCustomerSaving, setNewCustomerSaving] = useState(false)
  const [newCustomerError, setNewCustomerError] = useState<string>('')
  const [newCustomerForm, setNewCustomerForm] = useState<NewCustomerFormState>(emptyNewCustomerForm)

  const [priceGroups, setPriceGroups] = useState<PriceGroupDto[]>([])
  const [priceGroupsLoading, setPriceGroupsLoading] = useState(false)
  const [priceGroupsError, setPriceGroupsError] = useState<string>('')

  const defaultPriceGroupIdForNewCustomer = useMemo(() => {
    const pg = (priceGroups ?? []).find((x) => Number(x?.code ?? 0) === 4)
    return String(pg?.id ?? '').trim()
  }, [priceGroups])

  const ensurePriceGroupsLoaded = async () => {
    if (priceGroupsLoading) return
    if ((priceGroups ?? []).length > 0) return

    try {
      setPriceGroupsLoading(true)
      setPriceGroupsError('')
      const list = await fetchPriceGroups({ includeInactive: false })
      setPriceGroups(list ?? [])
    } catch (e: any) {
      setPriceGroupsError(String(e?.message ?? 'Fiyat grupları alınamadı.'))
      setPriceGroups([])
    } finally {
      setPriceGroupsLoading(false)
    }
  }

  useEffect(() => {
    if (!newCustomerModalOpen) return
    void ensurePriceGroupsLoaded()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newCustomerModalOpen])

  useEffect(() => {
    if (!newCustomerModalOpen) return
    if (String(newCustomerForm.customerCode ?? '').trim()) return
    const ac = new AbortController()
    void (async () => {
      try {
        const code = await fetchNextCustomerCode('Müşteri', { signal: ac.signal })
        setNewCustomerForm((p) => ({ ...p, customerCode: code }))
      } catch {
      }
    })()
    return () => ac.abort()
  }, [newCustomerForm.customerCode, newCustomerModalOpen])

  useEffect(() => {
    if (!newCustomerModalOpen) return
    if (newCustomerForm.priceGroupId) return
    if (!defaultPriceGroupIdForNewCustomer) return
    setNewCustomerForm((p) => ({ ...p, priceGroupId: defaultPriceGroupIdForNewCustomer }))
  }, [defaultPriceGroupIdForNewCustomer, newCustomerForm.priceGroupId, newCustomerModalOpen])

  /*
    PLASİYER (2026-09-02 kullanıcı isteği).

    Mağaza siparişinden açılan müşteri kartına plasiyer yazılmıyordu; cari plasiyersiz
    kalınca portföy süzgeçlerinde ve yetkide görünmüyor. Alan eklendi ve MAĞAZA plasiyeri
    ÖNTANIMLI seçiliyor — bu ekrandan açılan her kart mağaza kaynaklı.

    Fiyat grubuyla aynı desen: pencere açılınca yüklenir, seçim boşsa öntanım konur;
    kullanıcı değiştirdiyse üzerine YAZILMAZ.
  */
  const [salesmen, setSalesmen] = useState<SalesmanDropdownItem[]>([])
  const [salesmenLoading, setSalesmenLoading] = useState(false)
  const [salesmenError, setSalesmenError] = useState<string>('')

  const salesmanOptions = useMemo(
    () =>
      (salesmen ?? [])
        .map((x) => ({
          value: String(x?.salesmanCode ?? '').trim(),
          label: `${String(x?.salesmanCode ?? '').trim()} - ${String(x?.description ?? '').trim()}`
        }))
        .filter((x) => x.value.length > 0)
        .sort((a, b) => a.label.localeCompare(b.label, 'tr')),
    [salesmen]
  )

  /**
   * MAĞAZA plasiyerinin kodu. Kod firmadan firmaya değiştiği için sabit yazılmıyor;
   * koda VE açıklamaya bakılıyor. Türkçe harfler normalleştirilir, yoksa "MAĞAZA" ile
   * "MAGAZA" eşleşmez. Bulunamazsa öntanım konmaz — yanlış plasiyer atamaktansa boş kalsın.
   */
  const magazaSalesmanCode = useMemo(() => {
    const eslesir = (v: any) => normalizeTurkishForSearch(String(v ?? '')).includes('magaza')
    const bulunan = (salesmen ?? []).find((x) => eslesir(x?.description) || eslesir(x?.salesmanCode))
    return String(bulunan?.salesmanCode ?? '').trim()
  }, [salesmen])

  const ensureSalesmenLoaded = async () => {
    if (salesmenLoading) return
    if ((salesmen ?? []).length > 0) return

    try {
      setSalesmenLoading(true)
      setSalesmenError('')
      const list = await fetchSalesmenDropdown()
      setSalesmen(list ?? [])
    } catch (e: any) {
      setSalesmenError(String(e?.message ?? 'Plasiyer listesi alınamadı.'))
      setSalesmen([])
    } finally {
      setSalesmenLoading(false)
    }
  }

  useEffect(() => {
    if (!newCustomerModalOpen) return
    void ensureSalesmenLoaded()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newCustomerModalOpen])

  useEffect(() => {
    if (!newCustomerModalOpen) return
    if (newCustomerForm.salesmanCode) return
    if (!magazaSalesmanCode) return
    setNewCustomerForm((p) => ({ ...p, salesmanCode: magazaSalesmanCode }))
  }, [magazaSalesmanCode, newCustomerForm.salesmanCode, newCustomerModalOpen])

  const emptyEditCustomerForm: EditCustomerFormState = {
    customerCode: '',
    name: '',
    phone: '0',
    address: '',
    city: '',
    district: '',
    taxOffice: '',
    taxNumber: '',
    priceGroupId: '',
    customerType: '',
    invoiceType: 'FATURA'
  }

  const [editCustomerModalOpen, setEditCustomerModalOpen] = useState(false)
  const [editCustomerLoading, setEditCustomerLoading] = useState(false)
  const [editCustomerSaving, setEditCustomerSaving] = useState(false)
  const [editCustomerError, setEditCustomerError] = useState<string>('')
  const [editCustomerForm, setEditCustomerForm] = useState<EditCustomerFormState>(emptyEditCustomerForm)

  const [customerPreviewOpen, setCustomerPreviewOpen] = useState(false)
  const [customerPreviewLoading, setCustomerPreviewLoading] = useState(false)
  const [customerPreviewError, setCustomerPreviewError] = useState<string>('')
  const [customerPreviewDetails, setCustomerPreviewDetails] = useState<CustomerDto | null>(null)

  useEffect(() => {
    if (!editCustomerModalOpen) return
    void ensurePriceGroupsLoaded()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editCustomerModalOpen])

  const selectedDealerCode = String(state.dealer?.customerCode ?? '').trim()
  const selectedDealerLabel = useMemo(() => {
    const d = state.dealer
    if (!d) return ''
    const code = String(d.customerCode ?? '').trim()
    const name = String(d.name ?? '').trim()
    if (!code && !name) return ''
    if (code && name) return `[${code}] ${name}`
    return code || name
  }, [state.dealer])

  useEffect(() => {
    if (!selectedDealerCode) {
      setCampaigns([])
      return
    }

    void (async () => {
      try {
        setCampaignsLoading(true)
        const data = await fetchActiveCampaigns({ customerCode: selectedDealerCode || undefined, includeExpired: false })
        setCampaigns(data)
      } catch {
        setCampaigns([])
      } finally {
        setCampaignsLoading(false)
      }
    })()
  }, [selectedDealerCode])

  const detailsAbortRef = useRef<AbortController | null>(null)
  const customerDetailsAbortRef = useRef<AbortController | null>(null)

  const formatDealerLabel = useMemo(() => {
    return (c: CustomerDto) => {
      const code = String(c?.customerCode ?? '').trim()
      const name = String(c?.name ?? '').trim()
      if (!code && !name) return ''
      if (code && name) return `(${code}) ${name}`
      return code || name
    }
  }, [])

  // MUSTERI SECIMINDE BAYILER DE GORUNUR AMA SECILEMEZ.
  //
  // Kullanici bir bayiyi musteri listesinde bulamayinca "kayit yok" sanip yeni cari aciyordu.
  // Bayi artik listede cikiyor, sonuk ve "Bu bir bayidir" rozetiyle - yani neden secemedigi
  // ekranda yaziyor. Secilemezlik hem tiklamada hem klavyede CustomerSelect icinde uygulaniyor.
  const fetchEndCustomersWithDealers = useCallback(
    (opts: { q?: string; includeInactive?: boolean; limit?: number; signal?: AbortSignal }) =>
      fetchEndCustomers({ ...opts, includeDealers: true }),
    []
  )

  const isBayiOption = useCallback((c: CustomerDto) => {
    const tip = String((c as any)?.customerType ?? '')
      .trim()
      .toLocaleLowerCase('tr')
    return tip === 'bayi'
  }, [])

  const formatCustomerLabel = useMemo(() => {
    return (c: CustomerDto) => {
      const code = String(c?.customerCode ?? '').trim()
      const name = String(c?.name ?? '').trim()
      if (!code && !name) return ''
      if (code && name) return `(${code}) ${name}`
      return code || name
    }
  }, [])

  useEffect(() => {
    void (async () => {
      if (state.dealer) return

      try {
        setState((prev) => ({ ...prev, error: '' }))
        const d = await fetchCustomerByCode(DEFAULT_DEALER_CODE)
        if (d) {
          setState((prev) => ({ ...prev, dealer: d }))
        }
      } catch {
        // varsayılan bayi bulunamazsa sessizce geç
      }
    })()
  }, [state.dealer])

  useEffect(() => {
    const code = String(state.dealer?.customerCode ?? '').trim()
    if (!code) {
      setState((prev) => ({ ...prev, dealerDetails: null }))
      return
    }

    detailsAbortRef.current?.abort()
    const controller = new AbortController()
    detailsAbortRef.current = controller

    void (async () => {
      try {
        setState((prev) => ({ ...prev, loadingDetails: true, error: '' }))
        const details = await fetchCustomerByCode(code, { signal: controller.signal })
        setState((prev) => ({ ...prev, dealerDetails: details, loadingDetails: false }))
      } catch (e) {
        if ((e as any)?.name === 'AbortError') return
        setState((prev) => ({ ...prev, loadingDetails: false, dealerDetails: null, error: (e as any)?.message ?? 'Bayi bilgileri alınamadı.' }))
      }
    })()

    return () => controller.abort()
  }, [state.dealer?.customerCode])

  useEffect(() => {
    setState((prev) => {
      const dealerCode = String(prev.dealer?.customerCode ?? '').trim()
      const customerCode = String(prev.customer?.customerCode ?? '').trim()
      if (!dealerCode) return prev
      if (!customerCode) return prev
      return {
        ...prev,
        customer: null,
        customerDetails: null
      }
    })
  }, [state.dealer?.customerCode])

  useEffect(() => {
    const code = String(state.customer?.customerCode ?? '').trim()
    if (!code) {
      setState((prev) => ({ ...prev, customerDetails: null }))
      return
    }

    customerDetailsAbortRef.current?.abort()
    const controller = new AbortController()
    customerDetailsAbortRef.current = controller

    void (async () => {
      try {
        setState((prev) => ({ ...prev, loadingDetails: true, error: '' }))
        const details = await fetchCustomerByCode(code, { signal: controller.signal })
        setState((prev) => ({ ...prev, customerDetails: details, loadingDetails: false }))
      } catch (e) {
        if ((e as any)?.name === 'AbortError') return
        setState((prev) => ({ ...prev, loadingDetails: false, customerDetails: null, error: (e as any)?.message ?? 'Müşteri bilgileri alınamadı.' }))
      }
    })()

    return () => controller.abort()
  }, [state.customer?.customerCode])

  const previewCustomerAddressText = useMemo(() => {
    const addr = String(customerPreviewDetails?.address ?? '').trim()
    const city = String(customerPreviewDetails?.city ?? '').trim()
    const district = String(customerPreviewDetails?.district ?? '').trim()

    const parts = [addr, district, city].filter((x) => Boolean(String(x).trim()))
    return parts.length ? parts.join(' / ') : '-'
  }, [customerPreviewDetails?.address, customerPreviewDetails?.city, customerPreviewDetails?.district])

  const previewCustomerContactText = useMemo(() => {
    const phone = String(customerPreviewDetails?.phone ?? '').trim()
    const email = String(customerPreviewDetails?.email ?? '').trim()

    const parts = [phone || '-', email || '-']
    return parts.join(' • ')
  }, [customerPreviewDetails?.email, customerPreviewDetails?.phone])

  const previewCustomerTaxText = useMemo(() => {
    const office = String(customerPreviewDetails?.taxOffice ?? '').trim()
    const no = String(customerPreviewDetails?.taxNumber ?? '').trim()
    const left = office || '-'
    const right = no || '-'
    return `${left} / ${right}`
  }, [customerPreviewDetails?.taxNumber, customerPreviewDetails?.taxOffice])

  /*
    MONTAJ FORMUNUN ÖN DOLGUSU (2026-09-08 kullanıcı isteği).

    Mağaza siparişinde seçilen cari SON MÜŞTERİ'dir; montaj da onun adresine gider.
    O yüzden kartındaki ad / telefon / adres / il bilgisi montaj formuna hazır gelir,
    kullanıcı gerekirse üstüne yazar.

    `city` alanı montaj formundaki "Bölge" kutusunun seçenekleriyle eşleştiriliyor
    (`resolveRegionFromCity`); eşleşme yoksa boş bırakılır — uydurma bölge yazmak,
    işi yanlış ekibe düşürmek demek olurdu.

    İlçe adrese ekleniyor, çünkü montaj formunda ayrı bir ilçe alanı yok ve teknisyen
    yalnızca bu tek satırı görüyor.
  */
  const montajCustomerDefaults = useMemo(() => {
    const c = state.customerDetails ?? state.customer
    if (!c) return undefined

    const addr = String((c as any)?.address ?? '').trim()
    const district = String((c as any)?.district ?? '').trim()
    const adres = [addr, district].filter(Boolean).join(' / ')
    const ad = String((c as any)?.name ?? '').trim()

    const defaults = {
      isimSoyisim: ad,
      telefon: String((c as any)?.phone ?? '').trim(),
      adres,
      bolge: resolveRegionFromCity((c as any)?.city),
      kaynakEtiketi: ad ? `${ad} kartından` : 'müşteri kartından'
    }

    // Hiçbir alan dolmuyorsa prop hiç gönderilmesin; modal boşuna "otomatik dolduruldu"
    // notu göstermesin.
    const doluAlanVar = Boolean(defaults.isimSoyisim || defaults.telefon || defaults.adres || defaults.bolge)
    return doluAlanVar ? defaults : undefined
  }, [state.customer, state.customerDetails])

  const openCustomerPreview = async (customerCode?: string) => {
    const code = String(customerCode ?? '').trim()
    if (!code) return

    try {
      setCustomerPreviewError('')
      setCustomerPreviewOpen(true)
      setCustomerPreviewLoading(true)
      const details = await fetchCustomerByCode(code)
      setCustomerPreviewDetails(details ?? null)
      if (!details) setCustomerPreviewError('Müşteri bilgileri alınamadı.')
    } catch (e: any) {
      setCustomerPreviewDetails(null)
      setCustomerPreviewError(String(e?.message ?? 'Müşteri bilgileri alınamadı.'))
    } finally {
      setCustomerPreviewLoading(false)
    }
  }

  const saveNewCustomer = async () => {
    const customerCode = String(newCustomerForm.customerCode ?? '').trim()
    const name = String(newCustomerForm.name ?? '').trim()
    const phone = normalizePhone11(String(newCustomerForm.phone ?? ''))

    if (!customerCode || !name) {
      setNewCustomerError('Lütfen zorunlu alanları doldurun (Cari Kodu, İsim-Soyisim).')
      return
    }

    if (!isValidPhone11(phone)) {
      setNewCustomerError('Telefon 0 ile başlamalı ve 11 haneli olmalıdır.')
      return
    }

    try {
      setNewCustomerSaving(true)
      setNewCustomerError('')

      const created = await createEndCustomer({
        customerCode,
        name,
        phone,
        address: String(newCustomerForm.address ?? '').trim() || undefined,
        city: String(newCustomerForm.city ?? '').trim() || undefined,
        district: String(newCustomerForm.district ?? '').trim() || undefined,
        taxOffice: String(newCustomerForm.taxOffice ?? '').trim() || undefined,
        taxNumber: String(newCustomerForm.taxNumber ?? '').trim() || undefined,
        priceGroupId: String(newCustomerForm.priceGroupId ?? '').trim() || undefined,
        salesmanCode: String(newCustomerForm.salesmanCode ?? '').trim() || undefined,
        creditLimit: 300000
      })

      setNewCustomerModalOpen(false)
      setNewCustomerForm(emptyNewCustomerForm)

      setState((prev) => ({
        ...prev,
        customer: created,
        error: ''
      }))
    } catch (e) {
      setNewCustomerError((e as any)?.message ?? 'Müşteri oluşturulamadı.')
    } finally {
      setNewCustomerSaving(false)
    }
  }

  const openEditCustomer = async (customerCode?: string) => {
    const code = String(customerCode ?? state.customer?.customerCode ?? '').trim()
    if (!code) return

    setEditCustomerError('')
    setEditCustomerModalOpen(true)

    try {
      setEditCustomerLoading(true)
      const details = await fetchCustomerByCode(code)
      const d = details ?? state.customerDetails ?? state.customer

      const incomingPgId = String((d as any)?.priceGroupId ?? '').trim()
      setEditCustomerForm({
        customerCode: String(d?.customerCode ?? code).trim(),
        name: String(d?.name ?? '').trim(),
        phone: String(d?.phone ?? '0') || '0',
        address: String(d?.address ?? ''),
        city: String(d?.city ?? ''),
        district: String(d?.district ?? ''),
        taxOffice: String(d?.taxOffice ?? ''),
        taxNumber: String(d?.taxNumber ?? ''),
        priceGroupId: incomingPgId || defaultPriceGroupIdForNewCustomer,
        customerType: String((d as any)?.customerType ?? '').trim(),
        invoiceType: String((d as any)?.invoiceType ?? 'FATURA').trim() || 'FATURA'
      })
    } catch (e: any) {
      setEditCustomerError(String(e?.message ?? 'Müşteri bilgileri alınamadı.'))
    } finally {
      setEditCustomerLoading(false)
    }
  }

  const saveEditedCustomer = async () => {
    const code = String(editCustomerForm.customerCode ?? '').trim()
    const name = String(editCustomerForm.name ?? '').trim()
    const phone = normalizePhone11(String(editCustomerForm.phone ?? ''))

    if (!code || !name) {
      setEditCustomerError('Lütfen zorunlu alanları doldurun (Cari Kodu, İsim-Soyisim).')
      return
    }

    if (!isValidPhone11(phone)) {
      setEditCustomerError('Telefon 0 ile başlamalı ve 11 haneli olmalıdır.')
      return
    }

    try {
      setEditCustomerSaving(true)
      setEditCustomerError('')

      const updated = await updateEndCustomer(code, {
        name,
        phone,
        address: String(editCustomerForm.address ?? '').trim() || undefined,
        city: String(editCustomerForm.city ?? '').trim() || undefined,
        district: String(editCustomerForm.district ?? '').trim() || undefined,
        taxOffice: String(editCustomerForm.taxOffice ?? '').trim() || undefined,
        taxNumber: String(editCustomerForm.taxNumber ?? '').trim() || undefined,
        priceGroupId: String(editCustomerForm.priceGroupId ?? '').trim() || undefined,
        customerType: String(editCustomerForm.customerType ?? '').trim() || undefined,
        invoiceType: String(editCustomerForm.invoiceType ?? '').trim() || undefined
      })

      setEditCustomerModalOpen(false)
      setEditCustomerForm(emptyEditCustomerForm)

      setState((prev) => ({
        ...prev,
        customer: updated,
        customerDetails: updated,
        error: ''
      }))
    } catch (e: any) {
      setEditCustomerError(String(e?.message ?? 'Müşteri güncellenemedi.'))
    } finally {
      setEditCustomerSaving(false)
    }
  }

  return (
    <div className="p-6">
      <div className="w-full max-w-none">
        {!campaignsLoading && campaigns.length > 0 && (
          <div className="mb-6 flex items-stretch justify-between gap-4">
            <div className="flex-1">
              <CampaignCarousel
                campaigns={campaigns}
                onCampaignClick={(c) => {
                  setSelectedCampaign(c)
                  setCampaignDetailOpen(true)
                }}
              />
            </div>

            <div className="shrink-0 flex items-center">
              <button
                type="button"
                onClick={() => setCampaignsModalOpen(true)}
                className="relative h-full min-w-[120px] px-3 py-2 text-white rounded-xl shadow-md transition-all hover:opacity-90 active:scale-95"
                style={{ background: 'linear-gradient(90deg, var(--tenant-gradient-from, #8F2500), var(--tenant-gradient-to, #BD390C))' }}
              >
                <span className="flex flex-col items-center leading-[1.05]">
                  <span className="font-script text-[13px]">Tüm</span>
                  <span className="font-montserrat font-extrabold text-[12px]">Kampanyaları</span>
                  <span className="font-montserrat font-light text-[12px]">Gör</span>
                </span>

                <span
                  className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-white border-2 border-red-600 text-red-600 text-[11px] font-extrabold flex items-center justify-center"
                  aria-label={`Kampanya sayısı ${campaigns.length}`}
                  title={`Kampanya sayısı: ${campaigns.length}`}
                >
                  {campaigns.length}
                </span>
              </button>
            </div>
          </div>
        )}

        <CampaignsListModal isOpen={campaignsModalOpen} onClose={() => setCampaignsModalOpen(false)} campaigns={campaigns} />

        <CampaignDetailPopover
          isOpen={campaignDetailOpen}
          onClose={() => {
            setCampaignDetailOpen(false)
            setSelectedCampaign(null)
            setSelectedProductForCampaign(null)
          }}
          campaign={selectedCampaign}
          campaigns={campaigns.filter((c) =>
            selectedProductForCampaign
              ? c.discounts.some((d) => d.stokKodu === selectedProductForCampaign.stockCode) ||
              c.conditions.some((cond) => {
                if (!(cond as any)?.productStockCodesJson) return false
                try {
                  const stockCodes = JSON.parse(String((cond as any).productStockCodesJson)) as string[]
                  return stockCodes.includes(selectedProductForCampaign.stockCode)
                } catch {
                  return false
                }
              })
              : false
          )}
          productName={selectedProductForCampaign?.name}
        />

        <div className="mb-4">
          <div className="text-lg font-semibold text-gray-700 mb-3">Yeni Sipariş</div>
        </div>

        <div className="space-y-4">
          <div className="relative z-[39] grid grid-cols-1 lg:grid-cols-2 gap-6 w-full">
            <div className="space-y-4">
              <CustomerSelect
                label="Mağaza Seçimi"
                requiredMark
                value={state.dealer}
                onChange={(next) =>
                  setState((prev) => ({
                    ...prev,
                    dealer: next,
                    error: ''
                  }))
                }
                placeholder="Mağaza kodu veya adı ile hızlı arayın"
                minQueryLength={1}
                limit={50}
                fetcher={fetchDealers}
                formatOptionLabel={formatDealerLabel}
              />
            </div>

            <div className="relative">
              {/*
                ÖNİZLE / DÜZENLE ÜSTTE (2026-09-08 kullanıcı isteği).

                Bu iki düğme eskiden açılır listedeki HER satırın sağındaydı; kullanıcı
                düzenlemek istediği cariyi önce listede bulmak, sonra minik ikonu
                tutturmak zorundaydı. Artık seçili cari üzerinde çalışıyorlar ve
                "Yeni Müşteri Ekle"nin yanında duruyorlar.

                Cari seçili değilken ikisi de KAPALI: aksi halde tıklayınca hiçbir şey
                yapmayan bir düğme olurlardı.
              */}
              <div className="absolute right-0 -top-9 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (!selectedDealerCode) return
                    setNewCustomerError('')
                    setNewCustomerModalOpen(true)
                  }}
                  className={'inline-flex items-center gap-2 rounded-md border border-gray-200 px-3 py-2 text-xs font-semibold transition-colors ' + (!selectedDealerCode ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'bg-white text-gray-700 hover:bg-gray-50')}
                  disabled={!selectedDealerCode}
                  title={!selectedDealerCode ? 'Önce mağaza seçimi yapınız' : 'Yeni Müşteri Ekle'}
                >
                  <Plus size={16} />
                  Yeni Müşteri Ekle
                </button>

                <button
                  type="button"
                  onClick={() => {
                    const code = String(state.customer?.customerCode ?? '').trim()
                    if (!code) return
                    void openCustomerPreview(code)
                  }}
                  className={'inline-flex items-center gap-1.5 rounded-md border border-gray-200 px-3 py-2 text-xs font-semibold transition-colors ' + (!state.customer ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'bg-white text-gray-700 hover:bg-gray-50')}
                  disabled={!state.customer}
                  title={!state.customer ? 'Önce müşteri seçiniz' : 'Seçili müşteriyi önizle'}
                >
                  <Eye size={15} />
                  Önizle
                </button>

                <button
                  type="button"
                  onClick={() => {
                    const code = String(state.customer?.customerCode ?? '').trim()
                    if (!code) return
                    void openEditCustomer(code)
                  }}
                  className={'inline-flex items-center gap-1.5 rounded-md border border-gray-200 px-3 py-2 text-xs font-semibold transition-colors ' + (!state.customer ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'bg-white text-gray-700 hover:bg-gray-50')}
                  disabled={!state.customer}
                  title={!state.customer ? 'Önce müşteri seçiniz' : 'Seçili müşteriyi düzenle'}
                >
                  <Pencil size={15} />
                  Düzenle
                </button>
              </div>

              <div className="space-y-4">
                <CustomerSelect
                  label="Müşteri Seçimi"
                  value={state.customer}
                  onChange={(next) =>
                    setState((prev) => ({
                      ...prev,
                      customer: next,
                      error: ''
                    }))
                  }
                  placeholder="Müşteri kodu, adı veya telefon ile hızlı arayın"
                  minQueryLength={1}
                  limit={50}
                  fetcher={fetchEndCustomersWithDealers}
                  isOptionDisabled={isBayiOption}
                  optionDisabledNote={() => 'Bu bir bayidir'}
                  formatOptionLabel={formatCustomerLabel}
                  disabled={!selectedDealerCode}
                  disabledMessage="Önce mağaza seçimi yapınız"
                />
              </div>
            </div>

            <Modal
              isOpen={customerPreviewOpen}
              onClose={() => {
                if (customerPreviewLoading) return
                setCustomerPreviewOpen(false)
                setCustomerPreviewError('')
                setCustomerPreviewDetails(null)
              }}
              title="Müşteri Önizleme"
              scrollable={false}
            >
              <div className="space-y-3">
                {customerPreviewError && <div className="text-sm text-red-600">{customerPreviewError}</div>}
                {customerPreviewLoading ? (
                  <div className="text-sm text-gray-600">Yükleniyor...</div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                    <div className="sm:col-span-2">
                      <div className="text-[11px] text-gray-500">Tam Ad / Ünvan</div>
                      <div className="font-semibold text-gray-900">{String(customerPreviewDetails?.name ?? '').trim() || '-'}</div>
                    </div>

                    <div className="sm:col-span-2">
                      <div className="text-[11px] text-gray-500">Adres</div>
                      <div className="font-semibold text-gray-900">{previewCustomerAddressText}</div>
                    </div>

                    <div>
                      <div className="text-[11px] text-gray-500">İletişim</div>
                      <div className="font-semibold text-gray-900">{previewCustomerContactText}</div>
                    </div>

                    <div>
                      <div className="text-[11px] text-gray-500">Vergi</div>
                      <div className="font-semibold text-gray-900">{previewCustomerTaxText}</div>
                    </div>
                  </div>
                )}
              </div>
            </Modal>

            <Modal
              isOpen={newCustomerModalOpen}
              onClose={() => {
                if (newCustomerSaving) return
                setNewCustomerModalOpen(false)
                setNewCustomerError('')
              }}
              title="Yeni Müşteri Ekle"
              footer={
                <>
                  <button
                    type="button"
                    disabled={newCustomerSaving}
                    onClick={() => {
                      if (newCustomerSaving) return
                      setNewCustomerModalOpen(false)
                      setNewCustomerError('')
                    }}
                    className="px-4 py-2 rounded-md text-xs font-semibold border border-gray-200 text-gray-700 hover:bg-gray-50"
                  >
                    Vazgeç
                  </button>
                  <button
                    type="button"
                    disabled={newCustomerSaving}
                    onClick={() => void saveNewCustomer()}
                    className="px-4 py-2 rounded-md text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60"
                  >
                    Kaydet
                  </button>
                </>
              }
            >
              <div className="space-y-3">
                {newCustomerError && <div className="text-sm text-red-600">{newCustomerError}</div>}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">Cari Kodu</label>
                    <input
                      value={newCustomerForm.customerCode}
                      disabled
                      onChange={(e) => setNewCustomerForm((p) => ({ ...p, customerCode: e.target.value }))}
                      className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">İsim-Soyisim</label>
                    <input
                      value={newCustomerForm.name}
                      onChange={(e) => setNewCustomerForm((p) => ({ ...p, name: e.target.value.toLocaleUpperCase('tr-TR') }))}
                      className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">Telefon</label>
                    <input
                      value={newCustomerForm.phone}
                      onChange={(e) =>
                        setNewCustomerForm((p) => ({ ...p, phone: normalizePhone11(e.target.value) }))
                      }
                      inputMode="numeric"
                      maxLength={PHONE_MAX_LENGTH}
                      placeholder="0555 555 5555 555"
                      className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">Vergi Dairesi</label>
                    <input
                      value={newCustomerForm.taxOffice}
                      onChange={(e) => setNewCustomerForm((p) => ({ ...p, taxOffice: e.target.value.toLocaleUpperCase('tr-TR') }))}
                      className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">Vergi No</label>
                    <input
                      value={newCustomerForm.taxNumber}
                      onChange={(e) => setNewCustomerForm((p) => ({ ...p, taxNumber: e.target.value.toLocaleUpperCase('tr-TR') }))}
                      className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm"
                    />
                  </div>

                  {/*
                    İL / İLÇE ARTIK SERBEST METİN DEĞİL (2026-09-08).
                    Cari Ekle ekranıyla aynı listeden seçiliyor; iki ekranın aynı ilçeyi
                    farklı yazımla kaydetmesi (İ/I, ş/s) böylece mümkün değil. Liste
                    `constants/locations.ts` içinde, tek kaynak.
                  */}
                  <SearchableSelect
                    label="İl"
                    value={newCustomerForm.city}
                    options={CITIES}
                    onChange={(v) => setNewCustomerForm((p) => ({ ...p, city: v }))}
                    searchPlaceholder="İl ara..."
                  />

                  <SearchableSelect
                    label="İlçe"
                    value={newCustomerForm.district}
                    options={DISTRICTS}
                    onChange={(v) => setNewCustomerForm((p) => ({ ...p, district: v }))}
                    searchPlaceholder="İlçe ara..."
                  />

                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">Plasiyer</label>
                    <select
                      value={newCustomerForm.salesmanCode}
                      onChange={(e) => setNewCustomerForm((p) => ({ ...p, salesmanCode: e.target.value }))}
                      disabled={salesmenLoading}
                      className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm bg-white"
                    >
                      <option value="">{salesmenLoading ? 'Yükleniyor...' : 'Seçiniz...'}</option>
                      {salesmanOptions.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                    {salesmenError && <div className="mt-1 text-[11px] text-red-600">{salesmenError}</div>}
                  </div>

                  <div className="sm:col-span-2">
                    <label className="block text-xs font-semibold text-gray-600 mb-1">Adres</label>
                    <textarea
                      value={newCustomerForm.address}
                      onChange={(e) => setNewCustomerForm((p) => ({ ...p, address: e.target.value.toLocaleUpperCase('tr-TR') }))}
                      className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm min-h-[88px]"
                    />
                  </div>
                </div>
              </div>
            </Modal>

            <Modal
              isOpen={editCustomerModalOpen}
              onClose={() => {
                if (editCustomerSaving) return
                setEditCustomerModalOpen(false)
                setEditCustomerError('')
              }}
              title={editCustomerForm.customerCode ? `Müşteri Düzenle - ${editCustomerForm.customerCode}` : 'Müşteri Düzenle'}
              footer={
                <>
                  <button
                    type="button"
                    disabled={editCustomerSaving}
                    onClick={() => {
                      if (editCustomerSaving) return
                      setEditCustomerModalOpen(false)
                      setEditCustomerError('')
                    }}
                    className="px-4 py-2 rounded-md text-xs font-semibold border border-gray-200 text-gray-700 hover:bg-gray-50"
                  >
                    Vazgeç
                  </button>
                  <button
                    type="button"
                    disabled={editCustomerSaving}
                    onClick={() => void saveEditedCustomer()}
                    className="px-4 py-2 rounded-md text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60"
                  >
                    Kaydet
                  </button>
                </>
              }
            >
              <div className="space-y-3">
                {editCustomerError && <div className="text-sm text-red-600">{editCustomerError}</div>}
                {editCustomerLoading && <div className="text-sm text-gray-600">Yükleniyor...</div>}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">Cari Kodu</label>
                    <input
                      value={editCustomerForm.customerCode}
                      disabled
                      className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm bg-gray-50"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">İsim-Soyisim</label>
                    <input
                      value={editCustomerForm.name}
                      onChange={(e) => setEditCustomerForm((p) => ({ ...p, name: e.target.value }))}
                      className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">Telefon</label>
                    <input
                      value={editCustomerForm.phone}
                      onChange={(e) =>
                        setEditCustomerForm((p) => ({ ...p, phone: normalizePhone11(e.target.value) }))
                      }
                      inputMode="numeric"
                      maxLength={PHONE_MAX_LENGTH}
                      className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm"
                      placeholder="0555 555 5555 555"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">Vergi Dairesi</label>
                    <input
                      value={editCustomerForm.taxOffice}
                      onChange={(e) => setEditCustomerForm((p) => ({ ...p, taxOffice: e.target.value }))}
                      className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">Vergi No</label>
                    <input
                      value={editCustomerForm.taxNumber}
                      onChange={(e) => setEditCustomerForm((p) => ({ ...p, taxNumber: e.target.value }))}
                      className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">Fiyat Grubu</label>
                    <select
                      value={editCustomerForm.priceGroupId}
                      onChange={(e) => setEditCustomerForm((p) => ({ ...p, priceGroupId: e.target.value }))}
                      className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm bg-white"
                    >
                      <option value="">Seçiniz...</option>
                      {(priceGroups ?? []).map((pg) => (
                        <option key={pg.id} value={pg.id}>
                          {pg.code} - {pg.name}
                        </option>
                      ))}
                    </select>
                    {priceGroupsLoading && <div className="mt-1 text-xs text-gray-500">Fiyat grupları yükleniyor...</div>}
                    {priceGroupsError && <div className="mt-1 text-xs text-red-600">{priceGroupsError}</div>}
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">İl</label>
                    <input
                      value={editCustomerForm.city}
                      onChange={(e) => setEditCustomerForm((p) => ({ ...p, city: e.target.value }))}
                      className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">İlçe</label>
                    <input
                      value={editCustomerForm.district}
                      onChange={(e) => setEditCustomerForm((p) => ({ ...p, district: e.target.value }))}
                      className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm"
                    />
                  </div>

                  <div className="sm:col-span-2">
                    <label className="block text-xs font-semibold text-gray-600 mb-1">Adres</label>
                    <textarea
                      value={editCustomerForm.address}
                      onChange={(e) => setEditCustomerForm((p) => ({ ...p, address: e.target.value }))}
                      className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm min-h-[88px]"
                    />
                  </div>
                </div>
              </div>
            </Modal>

            {selectedDealerCode && state.error && <div className="text-sm text-red-600">{state.error}</div>}
          </div>

          {selectedDealerCode && state.customer ? (
            <ProductCategoriesAndCartSection
              dealerCode={selectedDealerCode}
              dealerLabel={selectedDealerLabel}
              dealerPriceGroupId={String((state.dealerDetails as any)?.priceGroupId ?? (state.dealer as any)?.priceGroupId ?? '').trim() || undefined}
              deliveryCustomerCode={String(state.customer?.customerCode ?? '').trim() || undefined}
              deliveryCustomerLabel={String(state.customer?.name ?? '').trim() || undefined}
              montajCustomerDefaults={montajCustomerDefaults}
              campaigns={campaigns}
              onOpenProductCampaigns={(p) => {
                setSelectedProductForCampaign(p)
                setSelectedCampaign(null)
                setCampaignDetailOpen(true)
              }}
            />
          ) : (
            <div className="mt-8 text-sm text-gray-600">
              {!selectedDealerCode
                ? 'Devam etmek için mağaza seçiniz.'
                : 'Devam etmek için müşteri seçiniz.'}
            </div>
          )}
        </div>
      </div>

    </div>

  )

}
