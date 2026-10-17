import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { fetchProducts, fetchProductLabelPdf, fetchProductLabelsBatchPdf } from '../api/products'
import { fetchProductCategoriesState, type ProductCategoryStateResponse } from '../api/productCategories'
import type { Product } from '../types/Product'
import { fetchPriceGroups, type PriceGroupDto } from '../api/priceGroups'
import { fetchProductPricesByProducts } from '../api/productPrices'
import { fetchLatestFxRate } from '../api/fx'
import {
  Search,
  Folder,
  FolderOpen,
  Package,
  ChevronRight,
  ChevronDown,
  Printer,
  Tag,
  X,
  Plus,
  Minus,
  AlertCircle,
  RefreshCw,
  Filter,
  Check,
  Coins
} from 'lucide-react'

function trimId(v: unknown) {
  return String(v ?? '').trim()
}

/**
 * Etiket fiyatının simgesi ürünün SATIŞ dövizinden gelir.
 */
function salesCurrencySymbol(salesCurrencyCode: number | string | null | undefined) {
  const norm = String(salesCurrencyCode ?? '').toUpperCase()
  if (norm === 'EUR' || norm === '2') return '€'
  if (norm === 'USD' || norm === '3') return '$'
  if (norm === 'GBP' || norm === '4') return '£'
  return '₺'
}

function normalizeCurrencyCode(salesCurrencyCode: number | string | null | undefined): 'EUR' | 'USD' | 'GBP' | 'TL' {
  const norm = String(salesCurrencyCode ?? '').toUpperCase()
  if (norm === 'EUR' || norm === '2') return 'EUR'
  if (norm === 'USD' || norm === '3') return 'USD'
  if (norm === 'GBP' || norm === '4') return 'GBP'
  return 'TL'
}

function formatMoney(v: number, salesCurrencyCode?: number | string | null) {
  return v.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    + ' ' + salesCurrencySymbol(salesCurrencyCode)
}

type EtiketBasimPageProps = {
  showPrice: boolean
}

export default function EtiketBasimPage({ showPrice }: EtiketBasimPageProps) {
  // ── Categories ──
  const [catState, setCatState] = useState<ProductCategoryStateResponse | null>(null)
  const [catLoading, setCatLoading] = useState(true)
  const [selectedMain, setSelectedMain] = useState<string | null>(null)
  const [selectedSub, setSelectedSub] = useState<string | null>(null)
  const [expandedMains, setExpandedMains] = useState<Set<string>>(new Set())
  const [showMobileCat, setShowMobileCat] = useState(false)

  // ── Products ──
  const [products, setProducts] = useState<Product[]>([])
  const [prodLoading, setProdLoading] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const PAGE_SIZE = 50

  // ── Selection State: Map of productId -> custom label count ──
  const [selectedItems, setSelectedItems] = useState<Map<string, number>>(new Map())

  // ── F4 Price & Currencies ──
  const [f4PriceByProductId, setF4PriceByProductId] = useState<Record<string, { price: number; currency?: string }>>({})
  const [f4Loading, setF4Loading] = useState(false)
  const f4GroupRankRef = useRef<Record<string, number> | null>(null)
  const f4GroupIdsRef = useRef<Set<string> | null>(null)

  // ── Live FX Rates (raw text inputs for editing + numeric parsed rates) ──
  const [fxRates, setFxRates] = useState<Record<string, number>>({ USD: 1, EUR: 1, GBP: 1 })
  const [fxRatesInput, setFxRatesInput] = useState<Record<string, string>>({ USD: '', EUR: '', GBP: '' })
  const [fxRatesLoading, setFxRatesLoading] = useState(false)
  // 'original' = Kendi para biriminde bas (EUR, USD, TL), 'try' = Güncel kurla TL'ye çevirip bas
  /*
    ETİKET FORMATI SEÇİMİ KALDIRILDI (2026-08-19 kullanıcı kararı).

    Eskiden "Orijinal Döviz" / "Kura Göre Güncelle (TL)" diye iki biçim vardı; kullanıcı
    TL'ye çeviren biçimi tamamen istemedi. Etiket artık her zaman ürünün KENDİ para
    biriminde basılır. Kur çubuğu duruyor, çünkü listede TL karşılığı bilgi olarak
    gösteriliyor.
  */

  const refreshFxRates = useCallback(async () => {
    setFxRatesLoading(true)
    try {
      const [usd, eur, gbp] = await Promise.all([
        fetchLatestFxRate('USD').catch(() => 1),
        fetchLatestFxRate('EUR').catch(() => 1),
        fetchLatestFxRate('GBP').catch(() => 1)
      ])
      const newRates = {
        USD: usd > 0 ? usd : 1,
        EUR: eur > 0 ? eur : 1,
        GBP: gbp > 0 ? gbp : 1
      }
      setFxRates(newRates)
      setFxRatesInput({
        USD: String(newRates.USD),
        EUR: String(newRates.EUR),
        GBP: String(newRates.GBP)
      })
    } finally {
      setFxRatesLoading(false)
    }
  }, [])

  // Load FX Rates once
  useEffect(() => {
    void refreshFxRates()
  }, [refreshFxRates])

  const handleRateInputChange = (currency: 'USD' | 'EUR' | 'GBP', value: string) => {
    setFxRatesInput((prev) => ({ ...prev, [currency]: value }))
    const num = Number(value.replace(',', '.'))
    if (num > 0) {
      setFxRates((prev) => ({ ...prev, [currency]: num }))
    }
  }

  // ── Printing State ──
  const [printing, setPrinting] = useState(false)
  const [printError, setPrintError] = useState<string | null>(null)
  /** Ürün listesi isteği başarısızsa dolu; "Ürün bulunamadı" ile hatayı ayırmak için. */
  const [loadError, setLoadError] = useState<string | null>(null)

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Load categories once
  useEffect(() => {
    let cancelled = false
    setCatLoading(true)
    fetchProductCategoriesState()
      .then((data) => {
        if (!cancelled) setCatState(data)
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setCatLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const ensureF4Groups = async () => {
    if (f4GroupIdsRef.current && f4GroupRankRef.current) return
    const list: PriceGroupDto[] = await fetchPriceGroups({ includeInactive: true })
    const rankById: Record<string, number> = {}
    ;(list ?? []).forEach((x) => {
      const id = trimId((x as any)?.id)
      if (!id) return
      const code = Number((x as any)?.code ?? 0)
      const formula = String((x as any)?.formula ?? '').trim().toUpperCase()
      const name = String((x as any)?.name ?? '').trim()
      const nameNorm = name.toLowerCase()
      const exact60 = /^0?4\s*[-\u2013]\s*60\b/.test(nameNorm) || (nameNorm.includes('60') && nameNorm.startsWith('4'))
      const looksLike4ByName = name.startsWith('4') || name.startsWith('04')
      const isF4Formula = formula === 'F4' || formula.startsWith('F4*') || formula.startsWith('REMOVE_KDV(F4')
      let rank: number | null = null
      if (code === 4 && exact60) rank = 0
      else if (exact60) rank = 1
      else if (code === 4) rank = 2
      else if (looksLike4ByName) rank = 3
      else if (isF4Formula) rank = 4
      if (rank == null) return
      const prev = rankById[id]
      if (prev == null || rank < prev) rankById[id] = rank
    })
    f4GroupRankRef.current = rankById
    f4GroupIdsRef.current = new Set(Object.keys(rankById))
  }

  const loadF4Prices = useCallback(async (productList: Product[]) => {
    const ids = productList.map((p) => trimId(p?.id)).filter(Boolean)
    if (ids.length === 0) {
      setF4PriceByProductId({})
      return
    }
    setF4Loading(true)
    try {
      await ensureF4Groups()
      const f4GroupIds = f4GroupIdsRef.current ?? new Set<string>()
      const f4GroupRank = f4GroupRankRef.current ?? {}
      if (f4GroupIds.size === 0) {
        setF4PriceByProductId({})
        return
      }
      const prices = await fetchProductPricesByProducts(ids)
      const map: Record<string, { price: number; currency?: string }> = {}
      const bestRank: Record<string, number> = {}
      ;(prices ?? []).forEach((pp) => {
        const productId = trimId((pp as any)?.productId ?? (pp as any)?.productID)
        const priceGroupId = trimId((pp as any)?.priceGroupId ?? (pp as any)?.priceGroupID)
        if (!productId || !f4GroupIds.has(priceGroupId)) return
        const rank = f4GroupRank[priceGroupId]
        if (rank == null) return
        const prev = bestRank[productId]
        if (prev != null && prev <= rank) return
        bestRank[productId] = rank
        const pVal = Number((pp as any)?.price ?? 0)
        const cVal = (pp as any)?.currencyCode || (pp as any)?.currency
        map[productId] = { price: pVal, currency: cVal }
        map[productId.toLowerCase()] = { price: pVal, currency: cVal }
      })
      setF4PriceByProductId(map)
    } catch {
      setF4PriceByProductId({})
    } finally {
      setF4Loading(false)
    }
  }, [])

  const loadProducts = useCallback(
    async (opts: { main?: string | null; sub?: string | null; q?: string; pg?: number }) => {
      setProdLoading(true)
      try {
        const res = await fetchProducts({
          main: opts.main ?? undefined,
          sub: opts.sub ?? undefined,
          q: opts.q?.trim() || undefined,
          page: opts.pg ?? 1,
          pageSize: PAGE_SIZE,
          includeInactive: false
        })
        const items = res.items ?? []
        setProducts(items)
        setTotal(res.total ?? 0)
        setLoadError(null)
        void loadF4Prices(items)
      } catch (e: any) {
        // Hata yutulup boş liste bırakılıyordu; ekran da boş listeye "Ürün bulunamadı" diyordu.
        // Sonuç: yetki/sunucu hatası ile "gerçekten ürün yok" ayırt edilemiyordu ve sorun
        // "ürün yok" sanılıp yanlış yerde aranıyordu.
        setProducts([])
        setTotal(0)
        setLoadError(String(e?.message ?? 'Ürünler yüklenemedi.'))
      } finally {
        setProdLoading(false)
      }
    },
    [loadF4Prices]
  )

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(
      () => {
        loadProducts({
          main: selectedMain,
          sub: selectedSub,
          q: searchQuery,
          pg: page
        })
      },
      searchQuery ? 300 : 0
    )
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [selectedMain, selectedSub, searchQuery, page, loadProducts])

  // Category handlers
  const toggleMain = (main: string) => {
    setExpandedMains((prev) => {
      const next = new Set(prev)
      if (next.has(main)) next.delete(main)
      else next.add(main)
      return next
    })
  }

  const handleSelectMain = (main: string | null) => {
    setSelectedMain(main)
    setSelectedSub(null)
    setPage(1)
    setShowMobileCat(false)
  }

  const handleSelectSub = (main: string, sub: string) => {
    setSelectedMain(main)
    setSelectedSub(sub)
    setPage(1)
    setShowMobileCat(false)
  }

  // Multi-selection logic
  const isAllSelected = useMemo(() => {
    if (products.length === 0) return false
    return products.every((p) => selectedItems.has(trimId(p.id)))
  }, [products, selectedItems])

  const toggleSelectAll = () => {
    setSelectedItems((prev) => {
      const next = new Map(prev)
      if (isAllSelected) {
        products.forEach((p) => next.delete(trimId(p.id)))
      } else {
        products.forEach((p) => {
          const pid = trimId(p.id)
          if (!next.has(pid)) next.set(pid, 1)
        })
      }
      return next
    })
  }

  const toggleSelectRow = (productId: string) => {
    const pid = trimId(productId)
    setSelectedItems((prev) => {
      const next = new Map(prev)
      if (next.has(pid)) next.delete(pid)
      else next.set(pid, 1)
      return next
    })
  }

  const setItemAdet = (productId: string, adet: number) => {
    const pid = trimId(productId)
    const val = Math.max(1, adet)
    setSelectedItems((prev) => {
      const next = new Map(prev)
      next.set(pid, val)
      return next
    })
  }

  const handleSetAllSelectedAdet = (count: number) => {
    const val = Math.max(1, count)
    setSelectedItems((prev) => {
      const next = new Map(prev)
      for (const [key] of next.entries()) {
        next.set(key, val)
      }
      return next
    })
  }

  const handleClearSelection = () => {
    setSelectedItems(new Map())
    setPrintError(null)
  }

  const getProductEffectivePriceInfo = useCallback(
    (product: Product) => {
      const pid = trimId(product.id)
      const selF4 = f4PriceByProductId[pid] ?? f4PriceByProductId[pid.toLowerCase()]

      let basePrice: number | null = null
      let baseCurrency: 'EUR' | 'USD' | 'GBP' | 'TL' = 'TL'

      if (selF4 != null && selF4.price > 0) {
        basePrice = selF4.price
        baseCurrency = normalizeCurrencyCode(selF4.currency || product.salesCurrencyCode || product.currencyCode)
      } else if (product.unitPrice != null && Number(product.unitPrice) > 0) {
        basePrice = Number(product.unitPrice)
        baseCurrency = normalizeCurrencyCode(product.salesCurrencyCode || product.currencyCode)
      }

      if (basePrice == null || basePrice <= 0) {
        return {
          basePrice: null,
          baseCurrency: 'TL' as const,
          displayPrice: null,
          displayCurrency: 'TL' as const,
          printPrice: null,
          printCurrency: 'TL' as const,
          convertedTryPrice: null,
          rateUsed: 1
        }
      }

      const rate =
        baseCurrency === 'USD'
          ? fxRates.USD
          : baseCurrency === 'EUR'
          ? fxRates.EUR
          : baseCurrency === 'GBP'
          ? fxRates.GBP
          : 1

      const convertedTryPrice = baseCurrency === 'TL' ? basePrice : basePrice * rate

      return {
        basePrice,
        baseCurrency,
        displayPrice: basePrice,
        displayCurrency: baseCurrency,
        printPrice: basePrice,
        printCurrency: baseCurrency,
        convertedTryPrice,
        rateUsed: rate
      }
    },
    [f4PriceByProductId, fxRates]
  )

  const handlePrintSelected = async () => {
    if (selectedItems.size === 0 || printing) return

    setPrinting(true)
    setPrintError(null)
    try {
      const batchItems: Array<{ productId: string; count: number; price?: number | null; paraBirimi?: string }> = []

      for (const [pid, count] of selectedItems.entries()) {
        const prod = products.find((x) => trimId(x.id) === pid)
        let priceToPrint: number | null = null
        let currencyToPrint: string | undefined = undefined

        if (showPrice && prod) {
          const info = getProductEffectivePriceInfo(prod)
          priceToPrint = info.printPrice
          currencyToPrint = info.printCurrency
        } else if (showPrice) {
          const selF4 = f4PriceByProductId[pid] ?? f4PriceByProductId[pid.toLowerCase()]
          if (selF4 != null && selF4.price > 0) {
            priceToPrint = selF4.price
            currencyToPrint = normalizeCurrencyCode(selF4.currency)
          }
        }

        batchItems.push({
          productId: pid,
          count: count,
          price: priceToPrint,
          paraBirimi: currencyToPrint
        })
      }

      let blob: Blob
      if (batchItems.length === 1) {
        const item = batchItems[0]
        blob = await fetchProductLabelPdf(item.productId, item.count, item.price, item.paraBirimi)
      } else {
        blob = await fetchProductLabelsBatchPdf(batchItems)
      }

      const url = URL.createObjectURL(blob)
      const w = window.open(url, '_blank')
      if (!w) {
        URL.revokeObjectURL(url)
        setPrintError('Pop-up engelleyiciyi devre dışı bırakın.')
        return
      }

      window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (err: any) {
      setPrintError(err?.message || 'Etiket basımı alınamadı')
    } finally {
      setPrinting(false)
    }
  }

  const handlePrintSingle = async (product: Product, e: React.MouseEvent) => {
    e.stopPropagation()
    const pid = trimId(product.id)
    const count = selectedItems.get(pid) ?? 1

    setPrinting(true)
    setPrintError(null)
    try {
      let priceToPrint: number | null = null
      let currencyToPrint: string | undefined = undefined

      if (showPrice) {
        const info = getProductEffectivePriceInfo(product)
        priceToPrint = info.printPrice
        currencyToPrint = info.printCurrency
      }

      const blob = await fetchProductLabelPdf(pid, count, priceToPrint, currencyToPrint)
      const url = URL.createObjectURL(blob)
      const w = window.open(url, '_blank')
      if (!w) {
        URL.revokeObjectURL(url)
        setPrintError('Pop-up engelleyiciyi devre dışı bırakın.')
        return
      }
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (err: any) {
      setPrintError(err?.message || 'Etiket basımı alınamadı')
    } finally {
      setPrinting(false)
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const totalLabelCount = useMemo(() => {
    let sum = 0
    for (const count of selectedItems.values()) {
      sum += count
    }
    return sum
  }, [selectedItems])

  return (
    <div className="p-3 sm:p-5 bg-slate-50 min-h-screen text-slate-800 font-sans pb-24 sm:pb-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
        <div>
          <h1 className="text-lg sm:text-xl font-bold text-slate-900 flex items-center gap-2">
            <Tag className="w-5 h-5 text-indigo-600" />
            {showPrice ? 'Stok Etiket Basım (Fiyatlı)' : 'Stok Etiket Basım (Fiyatsız)'}
          </h1>
          <p className="text-[11px] font-medium text-slate-500 mt-0.5">
            Fatura İşlemleri / {showPrice ? 'Etiket Basım Fiyatlı' : 'Etiket Basım Fiyatsız'}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {selectedItems.size > 0 && (
            <button
              onClick={handleClearSelection}
              className="px-3 py-1.5 rounded-lg border border-slate-300 text-slate-700 bg-white hover:bg-slate-100 text-xs font-semibold transition-all shadow-sm flex items-center gap-1 cursor-pointer"
            >
              <X className="w-3.5 h-3.5 text-slate-500" />
              Temizle
            </button>
          )}

          <button
            onClick={handlePrintSelected}
            disabled={selectedItems.size === 0 || printing}
            className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs shadow transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            {printing ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <Printer className="w-4 h-4" />
            )}
            <span>
              {printing
                ? 'Basılıyor...'
                : `Seçilenleri Yazdır (${selectedItems.size} Ürün / ${totalLabelCount} Adet)`}
            </span>
          </button>
        </div>
      </div>

      {showPrice && (
        <div className="mb-4 bg-white border border-slate-200 rounded-xl p-3 shadow-xs flex flex-wrap items-center justify-between gap-3">
          {/* Canlı / Manuel Döviz Kurları */}
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <div className="flex items-center gap-1.5 text-xs font-bold text-slate-700">
              <Coins className="w-4 h-4 text-amber-500" />
              <span>Döviz Kurları:</span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* USD */}
              <div className="flex items-center bg-slate-50 border border-slate-200 rounded-lg overflow-hidden focus-within:ring-1 focus-within:ring-indigo-500 focus-within:border-indigo-500">
                <span className="px-2 py-1 bg-slate-100 text-[11px] font-bold text-slate-600 border-r border-slate-200 flex items-center gap-1">
                  <span>🇺🇸</span> USD ($)
                </span>
                <input
                  type="text"
                  value={fxRatesInput.USD}
                  onChange={(e) => handleRateInputChange('USD', e.target.value)}
                  placeholder="38.45"
                  className="w-16 sm:w-20 px-2 py-1 text-xs font-mono font-bold text-slate-800 bg-transparent text-center focus:outline-none"
                  title="Dolar Kurunu Düzenle"
                />
                <span className="pr-2 text-[10px] font-bold text-slate-400">₺</span>
              </div>

              {/* EUR */}
              <div className="flex items-center bg-slate-50 border border-slate-200 rounded-lg overflow-hidden focus-within:ring-1 focus-within:ring-indigo-500 focus-within:border-indigo-500">
                <span className="px-2 py-1 bg-slate-100 text-[11px] font-bold text-slate-600 border-r border-slate-200 flex items-center gap-1">
                  <span>🇪🇺</span> EUR (€)
                </span>
                <input
                  type="text"
                  value={fxRatesInput.EUR}
                  onChange={(e) => handleRateInputChange('EUR', e.target.value)}
                  placeholder="41.20"
                  className="w-16 sm:w-20 px-2 py-1 text-xs font-mono font-bold text-slate-800 bg-transparent text-center focus:outline-none"
                  title="Euro Kurunu Düzenle"
                />
                <span className="pr-2 text-[10px] font-bold text-slate-400">₺</span>
              </div>

              {/* GBP */}
              <div className="flex items-center bg-slate-50 border border-slate-200 rounded-lg overflow-hidden focus-within:ring-1 focus-within:ring-indigo-500 focus-within:border-indigo-500">
                <span className="px-2 py-1 bg-slate-100 text-[11px] font-bold text-slate-600 border-r border-slate-200 flex items-center gap-1">
                  <span>🇬🇧</span> GBP (£)
                </span>
                <input
                  type="text"
                  value={fxRatesInput.GBP}
                  onChange={(e) => handleRateInputChange('GBP', e.target.value)}
                  placeholder="48.50"
                  className="w-16 sm:w-20 px-2 py-1 text-xs font-mono font-bold text-slate-800 bg-transparent text-center focus:outline-none"
                  title="Sterlin Kurunu Düzenle"
                />
                <span className="pr-2 text-[10px] font-bold text-slate-400">₺</span>
              </div>

              <button
                type="button"
                onClick={() => refreshFxRates()}
                disabled={fxRatesLoading}
                className="p-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-600 hover:text-indigo-600 transition-colors disabled:opacity-50 cursor-pointer"
                title="TCMB Canlı Kurlarını Yeniden Çek"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${fxRatesLoading ? 'animate-spin text-indigo-600' : ''}`} />
              </button>
            </div>
          </div>

        </div>
      )}

      {printError && (
        <div className="mb-3 p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs font-medium flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-rose-500 flex-shrink-0" />
          <span>{printError}</span>
        </div>
      )}

      <div className="lg:hidden mb-3">
        <button
          onClick={() => setShowMobileCat(!showMobileCat)}
          className="w-full flex items-center justify-between p-3 rounded-lg border border-slate-300 bg-white text-slate-800 text-xs font-semibold shadow-xs"
        >
          <span className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-indigo-600" />
            Kategori Filtresi: {selectedSub || selectedMain || 'Tümü'}
          </span>
          {showMobileCat ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </button>
      </div>

      <div className="flex flex-col lg:flex-row gap-4 items-start">
        <aside
          className={`w-full lg:w-72 bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden flex-shrink-0 ${
            showMobileCat ? 'block' : 'hidden lg:block'
          }`}
        >
          <div className="p-3 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
            <h2 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
              <Folder className="w-3.5 h-3.5 text-indigo-600" />
              Kategoriler
            </h2>
            {(selectedMain || selectedSub) && (
              <button
                onClick={() => {
                  setSelectedMain(null)
                  setSelectedSub(null)
                }}
                className="text-[11px] font-semibold text-indigo-600 hover:text-indigo-800"
              >
                Sıfırla
              </button>
            )}
          </div>

          <div className="p-2 max-h-[calc(100vh-250px)] overflow-y-auto space-y-0.5 text-xs">
            <button
              onClick={() => handleSelectMain(null)}
              className={`w-full text-left px-2.5 py-1.5 rounded-lg flex items-center justify-between transition-all ${
                selectedMain === null
                  ? 'bg-indigo-50 text-indigo-900 font-bold border border-indigo-200'
                  : 'text-slate-700 hover:bg-slate-50 font-medium'
              }`}
            >
              <span className="flex items-center gap-2 truncate">
                <Package className="w-3.5 h-3.5 text-slate-400" />
                Tüm Ürünler
              </span>
              {selectedMain === null && <Check className="w-3.5 h-3.5 text-indigo-600" />}
            </button>

            {catLoading ? (
              <div className="p-4 text-center text-xs text-slate-400 flex items-center justify-center gap-2">
                <RefreshCw className="w-3.5 h-3.5 animate-spin text-indigo-600" />
                Kategoriler yükleniyor...
              </div>
            ) : (
              (catState?.mains ?? []).map((mainCat) => {
                const isMainActive = selectedMain === mainCat && selectedSub === null
                const isExpanded = expandedMains.has(mainCat)
                const subCats = (catState?.subsByMain ?? {})[mainCat] ?? []
                const hasSubs = subCats.length > 0

                return (
                  <div key={mainCat} className="space-y-0.5">
                    <div
                      className={`group flex items-center justify-between px-2.5 py-1.5 rounded-lg transition-all ${
                        isMainActive
                          ? 'bg-indigo-50 text-indigo-900 font-bold border border-indigo-200'
                          : selectedMain === mainCat
                          ? 'bg-slate-100/70 text-slate-900 font-semibold'
                          : 'text-slate-700 hover:bg-slate-50 font-medium'
                      }`}
                    >
                      <button
                        onClick={() => handleSelectMain(mainCat)}
                        className="flex items-center gap-2 flex-1 text-left truncate cursor-pointer"
                      >
                        {isExpanded ? (
                          <FolderOpen className="w-3.5 h-3.5 text-indigo-600 flex-shrink-0" />
                        ) : (
                          <Folder className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                        )}
                        <span className="truncate">{mainCat}</span>
                      </button>

                      {hasSubs && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            toggleMain(mainCat)
                          }}
                          className="p-1 rounded hover:bg-slate-200/50 text-slate-400 hover:text-slate-600"
                        >
                          {isExpanded ? (
                            <ChevronDown className="w-3.5 h-3.5" />
                          ) : (
                            <ChevronRight className="w-3.5 h-3.5" />
                          )}
                        </button>
                      )}
                    </div>

                    {isExpanded && hasSubs && (
                      <div className="pl-6 pr-1 py-0.5 space-y-0.5 border-l-2 border-indigo-100 ml-4">
                        {subCats.map((subCat) => {
                          const isSubActive = selectedMain === mainCat && selectedSub === subCat
                          return (
                            <button
                              key={subCat}
                              onClick={() => handleSelectSub(mainCat, subCat)}
                              className={`w-full text-left px-2 py-1 rounded-md text-[11px] transition-all flex items-center justify-between cursor-pointer ${
                                isSubActive
                                  ? 'bg-indigo-600 text-white font-bold shadow-xs'
                                  : 'text-slate-600 hover:bg-slate-100 font-medium'
                              }`}
                            >
                              <span className="truncate">{subCat}</span>
                              {isSubActive && <Check className="w-3 h-3 text-white" />}
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })
            )}
          </div>
        </aside>

        <section className="flex-1 w-full bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden flex flex-col min-h-[550px]">
          <div className="p-3 border-b border-slate-200 bg-slate-50 flex flex-col sm:flex-row gap-2.5 items-center justify-between">
            <div className="relative w-full sm:w-80">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Stok kodu, ürün adı, barkod ara..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value)
                  setPage(1)
                }}
                className="w-full pl-9 pr-8 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-medium text-slate-800 placeholder-slate-400 focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 shadow-2xs"
              />
              {searchQuery && (
                <button
                  onClick={() => {
                    setSearchQuery('')
                    setPage(1)
                  }}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {selectedItems.size > 0 && (
              <div className="flex items-center gap-1.5 bg-indigo-50 border border-indigo-200 px-2.5 py-1 rounded-lg text-xs font-medium text-indigo-900 w-full sm:w-auto justify-between sm:justify-start">
                <span>Adet Ayarla:</span>
                <div className="flex items-center gap-1">
                  {[1, 2, 5, 10].map((num) => (
                    <button
                      key={num}
                      onClick={() => handleSetAllSelectedAdet(num)}
                      className="px-2 py-0.5 rounded bg-white hover:bg-indigo-100 text-indigo-700 border border-indigo-300 font-bold text-[11px] cursor-pointer"
                    >
                      {num}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="hidden sm:grid grid-cols-[40px_1fr_140px_140px_100px_70px] gap-2 px-3 py-2 bg-slate-100 border-b border-slate-200 text-[11px] font-bold text-slate-600 uppercase tracking-wider items-center">
            <div className="flex items-center justify-center">
              <input
                type="checkbox"
                checked={isAllSelected}
                onChange={toggleSelectAll}
                className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
              />
            </div>
            <div>Ürün Bilgisi</div>
            <div>Barkod</div>
            {showPrice ? (
              <div className="text-right">Fiyat (F4 Orijinal)</div>
            ) : (
              <div>Grup</div>
            )}
            <div className="text-center">Etiket Adedi</div>
            <div className="text-center">Yazdır</div>
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
            {prodLoading ? (
              <div className="p-8 text-center text-xs text-slate-400 flex items-center justify-center gap-2">
                <RefreshCw className="w-4 h-4 text-indigo-600 animate-spin" />
                Ürünler Yükleniyor...
              </div>
            ) : loadError ? (
              <div className="p-8 text-center text-xs">
                <div className="font-semibold text-red-600">Ürünler yüklenemedi</div>
                <div className="mt-1 text-slate-500">{loadError}</div>
              </div>
            ) : products.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-400">Ürün bulunamadı.</div>
            ) : (
              products.map((p) => {
                const pid = trimId(p.id)
                const isSelected = selectedItems.has(pid)
                const itemAdet = selectedItems.get(pid) ?? 1
                const priceInfo = getProductEffectivePriceInfo(p)

                return (
                  <div
                    key={p.id}
                    onClick={() => toggleSelectRow(pid)}
                    className={`flex flex-col sm:grid sm:grid-cols-[40px_1fr_140px_140px_100px_70px] gap-2 px-3 py-2 text-xs items-center cursor-pointer transition-all ${
                      isSelected ? 'bg-indigo-50/70 text-slate-900 font-semibold' : 'hover:bg-slate-50 text-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between sm:justify-center w-full sm:w-auto" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-2 sm:gap-0">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelectRow(pid)}
                          className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                        />
                        <span className="sm:hidden font-bold text-slate-800">{p.name}</span>
                      </div>

                      <div className="flex items-center gap-2 sm:hidden">
                        <input
                          type="number"
                          min={1}
                          value={itemAdet}
                          onChange={(e) => {
                            const val = Number(e.target.value) || 1
                            if (!isSelected) toggleSelectRow(pid)
                            setItemAdet(pid, val)
                          }}
                          className="w-12 h-7 text-center font-bold text-slate-800 bg-white border border-slate-300 rounded text-xs"
                        />
                        <button
                          onClick={(e) => handlePrintSingle(p, e)}
                          className="p-1.5 rounded bg-indigo-50 text-indigo-600 border border-indigo-200"
                        >
                          <Printer className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    <div className="hidden sm:block truncate pr-2">
                      <div className="font-bold text-xs text-slate-800 truncate">{p.name}</div>
                      {p.stockCode && (
                        <span className="inline-block text-[10px] font-mono font-semibold text-slate-500">
                          Kodu: {p.stockCode}
                        </span>
                      )}
                    </div>

                    <div className="font-mono text-[11px] text-slate-600 truncate flex items-center justify-between w-full sm:w-auto">
                      <span>Barkod: {p.barcode || '—'}</span>
                      {p.stockCode && <span className="sm:hidden text-[10px] text-slate-500">Kod: {p.stockCode}</span>}
                    </div>

                    {showPrice ? (
                      <div className="text-left sm:text-right w-full sm:w-auto">
                        {priceInfo.displayPrice != null ? (
                          <div>
                            <span className="font-bold text-xs text-emerald-700">
                              {formatMoney(priceInfo.displayPrice, priceInfo.displayCurrency)}
                            </span>
                            {priceInfo.baseCurrency !== 'TL' && priceInfo.convertedTryPrice != null && (
                              <div className="text-[10px] text-slate-500 font-medium font-mono">
                                (~{formatMoney(priceInfo.convertedTryPrice, 'TL')})
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-300 font-normal">—</span>
                        )}
                      </div>
                    ) : (
                      <div className="text-slate-500 text-[11px] truncate w-full sm:w-auto">
                        {p.groupCode || '—'}
                      </div>
                    )}

                    <div className="hidden sm:flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="number"
                        min={1}
                        value={itemAdet}
                        onChange={(e) => {
                          const val = Number(e.target.value) || 1
                          if (!isSelected) toggleSelectRow(pid)
                          setItemAdet(pid, val)
                        }}
                        className="w-14 h-7 text-center font-bold text-slate-800 bg-white border border-slate-300 rounded focus:outline-none focus:border-indigo-600 shadow-xs"
                      />
                    </div>

                    {/* Desktop Print Button */}
                    <div className="hidden sm:flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={(e) => handlePrintSingle(p, e)}
                        className="p-1.5 rounded-lg border border-slate-200 text-slate-600 hover:text-indigo-600 hover:border-indigo-300 hover:bg-indigo-50/50 transition-all shadow-2xs cursor-pointer"
                        title="Bu ürünü yazdır"
                      >
                        <Printer className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                )
              })
            )}
          </div>

          {/* Compact Footer */}
          <div className="p-2.5 bg-slate-100/80 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between text-xs text-slate-600 gap-2">
            <div className="flex items-center gap-2">
              <span className="font-semibold">Seçili: <strong className="text-indigo-700">{selectedItems.size}</strong></span>
              <span>•</span>
              <span className="font-semibold">Toplam Etiket: <strong className="text-emerald-700">{totalLabelCount}</strong></span>
            </div>

            {totalPages > 1 && (
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="px-2.5 py-1 rounded bg-white border border-slate-300 hover:bg-slate-50 disabled:opacity-40 text-xs font-medium"
                >
                  Önceki
                </button>
                <span className="font-semibold text-slate-700 text-xs">{page} / {totalPages}</span>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="px-2.5 py-1 rounded bg-white border border-slate-300 hover:bg-slate-50 disabled:opacity-40 text-xs font-medium"
                >
                  Sonraki
                </button>
              </div>
            )}
          </div>
        </section>

      </div>

      {/* ── Mobile Fixed Bottom Batch Print Bar ── */}
      {selectedItems.size > 0 && (
        <div className="sm:hidden fixed bottom-0 left-0 right-0 p-3 bg-white border-t border-slate-200 shadow-2xl z-50 flex items-center justify-between gap-2">
          <div className="text-xs font-bold text-slate-800">
            <div>{selectedItems.size} Ürün Seçildi</div>
            <div className="text-[10px] text-emerald-600 font-semibold">{totalLabelCount} Etiket Basılacak</div>
          </div>

          <button
            onClick={handlePrintSelected}
            disabled={printing}
            className="px-4 py-2 rounded-lg bg-indigo-600 text-white font-bold text-xs flex items-center gap-1.5 shadow"
          >
            {printing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Printer className="w-4 h-4" />}
            <span>Yazdır</span>
          </button>
        </div>
      )}
    </div>
  )
}
