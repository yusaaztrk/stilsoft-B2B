import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BarChart2, TrendingUp, AlertTriangle, Search, Info } from 'lucide-react'
import { useProducts } from '../hooks/useProducts'
import FormInput from '../components/forms/FormInput'
import FormSelect from '../components/forms/FormSelect'
import Modal from '../components/Modal'
import { createMainCategory, createSubCategory, updateCategory } from '../api/productCategories'
import { useProductCategories } from '../hooks/useProductCategories'
import { fetchWarehousesDropdownForStock, type WarehouseDropdownItem } from '../api/warehouses'
import { fetchProductPricesByProducts, type ProductPriceResponse } from '../api/productPrices'
import { fetchPriceGroups, type PriceGroupDto } from '../api/priceGroups'

import NotificationPopup, { type NotificationVariant } from '../components/NotificationPopup'

import { API_BASE_URL, apiUrl } from '../config/api'

function toKey(s: string) {
  return s
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
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
}

function categoryKeyVariants(label: string) {
  const raw = String(label ?? '').trim()
  if (!raw) return [] as string[]

  const normSpace = toKey(raw)
  const normUnderscore = normSpace.replace(/\s+/g, '_')
  const rawUpper = raw.toUpperCase()
  const rawUnderscore = raw.replace(/\s+/g, '_')
  const rawUnderscoreUpper = rawUnderscore.toUpperCase()

  return Array.from(new Set([raw, rawUpper, normSpace, normUnderscore, rawUnderscore, rawUnderscoreUpper]))
}

function sanitizeIntText(input: string, opts?: { maxDigits?: number }) {
  const maxDigits = opts?.maxDigits ?? 10
  const raw = String(input ?? '')
  const cleaned = raw.replace(/[^0-9]/g, '').slice(0, maxDigits)
  return cleaned
}

function normalizeId(value: any) {
  return String(value ?? '').trim().toLowerCase()
}

function trimId(value: any) {
  return String(value ?? '').trim()
}

export default function ProductManagementPage() {
  const navigate = useNavigate()
  const productsQuery = useProducts({ defaultIncludeInactive: true, defaultPageSize: 1000 })
  const { data: categories, refresh } = useProductCategories()

  const [f4PriceByProductId, setF4PriceByProductId] = useState<Record<string, { price: number; currency: string }>>({})
  const [priceRefreshTick, setPriceRefreshTick] = useState(0)

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

  useEffect(() => {
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.log('[ProductManagementPage] mounted')
    }
  }, [])

  /*
    AÇILIŞ HIZI (2026-08-31 kullanıcı isteği: "sayfa çok geç geliyor").

    Fiyat grupları ile ürünler BİRBİRİNE BAĞLI DEĞİL, ama tek bir etkide zincirlenmişti:
    ürünler geldikten SONRA fiyat grupları çekiliyor, ondan SONRA fiyatlar. Üç istek arka
    arkaya bekliyordu. Üstelik etki `productsQuery.items`'a bağlı olduğu için fiyat grupları
    ürün listesi her değiştiğinde (kategori sekmesi, arama, yenile) YENİDEN çekiliyordu —
    oysa bu liste bir sayfa ömrü boyunca aynı.

    Grup listesi artık açılışta ürünlerden BAĞIMSIZ, paralel gidiyor. Ürün tablosu zaten
    fiyatları beklemiyor; fiyatlar geldikçe hücreler doluyor.
  */
  /** Fiyat grubu kimliği → F4 yakınlık sırası. Fiyat eşleşmesi bu sırayı kullanıyor. */
  const [f4GroupRankMap, setF4GroupRankMap] = useState<Record<string, number>>({})

  useEffect(() => {
    const ac = new AbortController()
    void (async () => {
      try {
        const list: PriceGroupDto[] = await fetchPriceGroups({ includeInactive: true })
        if (ac.signal.aborted) return
        const f4GroupRank: Record<string, number> = {}
        ;(list ?? []).forEach((x) => {
          const id = String((x as any)?.id ?? '').trim()
          if (!id) return
          const code = Number((x as any)?.code ?? 0)
          const formula = String((x as any)?.formula ?? '').trim().toUpperCase()
          const name = String((x as any)?.name ?? '').trim()

          const nameNorm = name.toLowerCase()
          const exact60 = /^0?4\s*[-–]\s*60\b/.test(nameNorm) || (nameNorm.includes('60') && nameNorm.startsWith('4'))
          const looksLike4ByName = name.startsWith('4') || name.startsWith('04')

          const removeKdvPrefix = 'REMOVE_KDV' + '(F4'
          const isF4Formula = formula === 'F4' || formula.startsWith('F4*') || formula.startsWith(removeKdvPrefix)

          let rank: number | null = null
          if (code === 4 && exact60) rank = 0
          else if (exact60) rank = 1
          else if (code === 4) rank = 2
          else if (looksLike4ByName) rank = 3
          else if (isF4Formula) rank = 4

          if (rank == null) return
          const prev = f4GroupRank[id]
          if (prev == null || rank < prev) f4GroupRank[id] = rank
        })
        if (import.meta.env.DEV) {
          // eslint-disable-next-line no-console
          console.log('[ProductManagementPage] F4 candidates', {
            priceGroups: (list ?? []).length,
            f4GroupIds: Object.keys(f4GroupRank).length
          })
        }

        setF4GroupRankMap(f4GroupRank)
      } catch (e) {
        if (import.meta.env.DEV) {
          // eslint-disable-next-line no-console
          console.error('[ProductManagementPage] price groups fetch failed', e)
        }
        setF4GroupRankMap({})
      }
    })()
    return () => ac.abort()
  }, [priceRefreshTick])

  // Fiyatlar: ürünler VE grup listesi hazır olunca. Tablo bunu beklemez.
  useEffect(() => {
    const ac = new AbortController()
    void (async () => {
      try {
        const ids = (productsQuery.items ?? []).map((p) => trimId(p?.id)).filter(Boolean)
        if (ids.length === 0 || Object.keys(f4GroupRankMap).length === 0) {
          setF4PriceByProductId({})
          return
        }

        const prices: ProductPriceResponse[] = await fetchProductPricesByProducts(ids)
        if (ac.signal.aborted) return

        if (import.meta.env.DEV) {
          // eslint-disable-next-line no-console
          console.log('[ProductManagementPage] product prices fetched', { count: (prices ?? []).length })
        }

        const map: Record<string, { price: number; currency: string }> = {}
        const bestRankByProductId: Record<string, number> = {}
        ;(prices ?? []).forEach((pp) => {
          const rawId = trimId((pp as any)?.productId ?? (pp as any)?.productID)
          const productId = rawId
          const productIdLower = rawId.toLowerCase()
          const priceGroupId = String(pp?.priceGroupId ?? '').trim()
          const rank = f4GroupRankMap[priceGroupId]
          if (!productId || rank == null) return

          const prevRank = bestRankByProductId[productId]
          if (prevRank != null && prevRank <= rank) return
          bestRankByProductId[productId] = rank

          const value = { price: Number(pp?.price ?? 0), currency: String(pp?.currency ?? '') }
          map[productId] = value
          if (productIdLower && productIdLower !== productId) map[productIdLower] = value
        })
        if (import.meta.env.DEV) {
          const sample = (prices ?? []).slice(0, 3).map((pp) => ({
            productId: String((pp as any)?.productId ?? (pp as any)?.productID ?? ''),
            priceGroupId: String((pp as any)?.priceGroupId ?? (pp as any)?.priceGroupID ?? ''),
            price: (pp as any)?.price,
            currency: (pp as any)?.currency
          }))
          // eslint-disable-next-line no-console
          console.log('[ProductManagementPage] F4 matched map size', { matched: Object.keys(map).length, sample })
        }
        setF4PriceByProductId(map)
      } catch (e) {
        if (ac.signal.aborted) return
        if (import.meta.env.DEV) {
          // eslint-disable-next-line no-console
          console.error('[ProductManagementPage] F4 fetch failed', e)
        }
        setF4PriceByProductId({})
      }
    })()
    return () => ac.abort()
  }, [priceRefreshTick, productsQuery.items, f4GroupRankMap])

  useEffect(() => {
    const onFocus = () => setPriceRefreshTick((x) => x + 1)
    const onVisibility = () => {
      if (document.visibilityState === 'visible') setPriceRefreshTick((x) => x + 1)
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  const mainTabs = categories.mains
  const subTabsByMain = categories.subsByMain

  const getSubsForMain = (mainLabel: string) => {
    const keys = categoryKeyVariants(mainLabel)
    for (const k of keys) {
      const direct = (subTabsByMain as Record<string, string[]>)[k]
      if (Array.isArray(direct) && direct.length) return direct
    }
    return [] as string[]
  }

  const mainOptions = useMemo(() => mainTabs.map((t) => ({ value: toKey(t), label: t })), [mainTabs])

  const activeMainLabel = useMemo(() => {
    const currentKey = (productsQuery.main || '').trim().toUpperCase()
    if (!currentKey) return ''
    const found = mainTabs.find((x) => toKey(x) === currentKey)
    return found ?? ''
  }, [mainTabs, productsQuery.main])

  const subOptions = useMemo(() => {
    if (productsQuery.main) {
      const subs = activeMainLabel ? getSubsForMain(activeMainLabel) : []
      return subs.map((s) => ({ value: toKey(s), label: s }))
    }

    // Main seçili değilken: tüm altları backend sırasına göre göster
    // (mainTabs sırası + her main'in subsByMain sırası). Böylece yeni eklenenler en altta kalır.
    const all: Array<{ value: string; label: string }> = []
    const seen = new Set<string>()
    mainTabs.forEach((main) => {
      const subs = getSubsForMain(main)
      subs.forEach((s) => {
        const v = toKey(s)
        if (!v) return
        if (seen.has(v)) return
        seen.add(v)
        all.push({ value: v, label: `${s} (${main})` })
      })
    })
    return all
  }, [activeMainLabel, mainTabs, productsQuery.main, subTabsByMain])

  const [createOpen, setCreateOpen] = useState(false)
  const [createSaving, setCreateSaving] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [createForm, setCreateForm] = useState({
    stockCode: '',
    name: '',
    description: '',
    barcode: '',
    groupCode: '',
    subGroupCode: '',
    taxRate: '20',
    stock: '0',
    minStock: '0',
    bsyMinStock: '12',
    isInstallable: false,
    installationFee: '',
    imageUrl: '',
    imageUrls: [] as string[],
    videoUrl: ''
  })
  const [createImageUrlDraft, setCreateImageUrlDraft] = useState('')
  const [createImageUploading, setCreateImageUploading] = useState(false)

  const [warehousesLoading, setWarehousesLoading] = useState(false)
  const [warehouses, setWarehouses] = useState<WarehouseDropdownItem[]>([])

  const [warehouseStocks, setWarehouseStocks] = useState<Record<string, string>>({})

  const [editOpen, setEditOpen] = useState(false)


  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  const [editForm, setEditForm] = useState({
    id: '',
    stockCode: '',
    name: '',
    description: '',
    features: '',
    barcode: '',
    groupCode: '',
    subGroupCode: '',
    taxRate: '20',
    stock: '0',
    minStock: '0',
    bsyMinStock: '12',
    isInstallable: false,
    installationFee: '',
    imageUrl: '',
    imageUrls: [] as string[],
    videoUrl: '',
    isActive: true
  })

  /**
   * Offer copy lives in ProductDetails, keyed on stock code. It is loaded when the dialog opens
   * rather than carried on every row of the product grid.
   *
   * The description shown here is that copy — not Products.Description, which used to be edited
   * from this same box and left two different descriptions for one product, only one of which
   * reached the offer.
   */
  useEffect(() => {
    const code = String(editForm.stockCode ?? '').trim()
    if (!editOpen || !code) return

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
        setEditForm((prev) => ({
          ...prev,
          description: String(d.description ?? prev.description ?? ''),
          features: String(d.features ?? '')
        }))
      } catch {
        // No copy yet is normal; the fields simply stay as they were.
      }
    })()
    return () => ac.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editOpen, editForm.stockCode])
  const [editImageUrlDraft, setEditImageUrlDraft] = useState('')
  const [editImageUploading, setEditImageUploading] = useState(false)

  const toImageSrc = (url: any) => {
    const s = String(url ?? '').trim()
    if (!s) return ''
    if (s.startsWith('http://') || s.startsWith('https://')) return s
    return apiUrl(s)
  }

  useEffect(() => {
    const ac = new AbortController()
    void (async () => {
      try {
        setWarehousesLoading(true)
        const list = await fetchWarehousesDropdownForStock({ signal: ac.signal })
        setWarehouses(list ?? [])
        const initial: Record<string, string> = {}
        ;(list ?? []).forEach((w) => { initial[String(w.warehouseCode)] = '' })
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

  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [deleteSavingId, setDeleteSavingId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const [mainCreateValue, setMainCreateValue] = useState('')
  const [mainRenameFrom, setMainRenameFrom] = useState('')
  const [mainRenameTo, setMainRenameTo] = useState('')

  const [subMain, setSubMain] = useState('')
  const [subCreateValue, setSubCreateValue] = useState('')
  const [subRenameFrom, setSubRenameFrom] = useState('')
  const [subRenameTo, setSubRenameTo] = useState('')

  const getMeta = (id: string) => {
    const m = (categories.meta ?? {})[id]
    return {
      description: String(m?.description ?? ''),
      status: (m?.status ?? 'active') === 'passive' ? 'passive' : 'active'
    } as { description: string; status: 'active' | 'passive' }
  }

  useEffect(() => {
    if (!subMain && mainTabs[0]) setSubMain(mainTabs[0])
  }, [mainTabs, subMain])

  const filteredProductsForSelect = useMemo(() => {
    const qNorm = String(analysisSearchQ ?? '').trim().toLowerCase()
    const allItems = productsQuery.items ?? []
    if (!qNorm) return allItems.slice(0, 10)
    return allItems
      .filter((p) =>
        String(p.name ?? '').toLowerCase().includes(qNorm) ||
        String(p.stockCode ?? '').toLowerCase().includes(qNorm)
      )
      .slice(0, 10)
  }, [analysisSearchQ, productsQuery.items])

  useEffect(() => {
    if (!analysisModalOpen || !selectedAnalysisProductId) {
      setAnalysisData(null)
      return
    }

    const fetchAnalysis = async () => {
      try {
        setAnalysisLoading(true)
        setAnalysisError(null)
        const res = await fetch(`${API_BASE_URL}/api/products/analysis/${selectedAnalysisProductId}`, {
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
  }, [analysisModalOpen, selectedAnalysisProductId])

  const buildHeaders = (includeJson: boolean) => {
    const headers: Record<string, string> = {}
    if (includeJson) headers['Content-Type'] = 'application/json'
    const token = localStorage.getItem('accessToken')
    if (token) headers.Authorization = `Bearer ${token}`
    return headers
  }

  return (
    <div>
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

      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="text-xl font-bold text-gray-900 tracking-tight">Ürün Yönetimi</h1>
            <p className="text-xs text-gray-400 mt-0.5">Stok / Ürün Yönetimi</p>
          </div>
          <button
            type="button"
            onClick={() => {
              setAnalysisModalOpen(true)
              if (productsQuery.items && productsQuery.items.length > 0) {
                setSelectedAnalysisProductId(productsQuery.items[0].id)
              }
            }}
            className="h-[34px] inline-flex items-center gap-1.5 px-4 text-xs font-semibold bg-orange-600 hover:bg-orange-700 text-white rounded-lg shadow-sm transition"
          >
            <BarChart2 size={13} />
            Analiz
          </button>
        </div>

        <div className="flex items-center gap-2">
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
            className="h-[34px] inline-flex items-center gap-1.5 px-4 text-xs font-semibold bg-white hover:bg-gray-50 border border-gray-200 text-gray-700 rounded-lg shadow-sm transition"
          >
            Template
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
            className="h-[34px] inline-flex items-center gap-1.5 px-4 text-xs font-semibold bg-white hover:bg-gray-50 border border-gray-200 text-gray-700 rounded-lg shadow-sm transition"
          >
            Export
          </button>

          <button
            type="button"
            disabled={excelImportBusy}
            onClick={() => excelFileInputRef.current?.click()}
            className="h-[34px] inline-flex items-center gap-1.5 px-4 text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white rounded-lg shadow-sm transition"
          >
            Import
          </button>

          <div className="relative">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input
              value={productsQuery.q}
              onChange={(e) => productsQuery.setQ(e.target.value)}
              placeholder="Genel ara..."
              className="h-[34px] w-56 pl-7 pr-3 text-xs border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-400 transition"
            />
          </div>

          <button
            type="button"
            onClick={() => {
              productsQuery.refetch()
              setPriceRefreshTick((x) => x + 1)
            }}
            disabled={productsQuery.loading}
            className="h-[34px] inline-flex items-center gap-1.5 px-4 text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white rounded-lg shadow-sm transition"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className={productsQuery.loading ? 'animate-spin' : ''}><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
            {productsQuery.loading ? 'Yükleniyor...' : 'Yenile'}
          </button>

          <button
            type="button"
            onClick={() => {
              setCreateError(null)
              setCreateForm((p) => ({
                ...p,
                description: '',
                groupCode: '',
                subGroupCode: '',
                imageUrl: '',
                imageUrls: [],
                videoUrl: ''
              }))
              setCreateImageUrlDraft('')
              setCreateOpen(true)
            }}
            className="h-[34px] inline-flex items-center gap-1.5 px-4 text-xs font-semibold bg-gray-900 hover:bg-gray-800 text-white rounded-lg shadow-sm transition"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 5v14"/><path d="M5 12h14"/></svg>
            Ürün Ekle
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          {productsQuery.error && <div className="mb-3 text-sm font-semibold text-red-600">{productsQuery.error}</div>}

          <div className="border border-gray-100 bg-white rounded-xl shadow-sm p-4 mb-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <FormSelect
                label="Ana Kategori"
                value={productsQuery.main || ''}
                options={[{ value: '', label: 'Seçiniz...' }, ...mainOptions]}
                onChange={(e) => {
                  const nextMain = String((e as any)?.target?.value ?? '')
                  if (!nextMain) {
                    // Main cleared: keep current sub if any, allow filtering by sub only.
                    productsQuery.setMainSub('', productsQuery.sub || '')
                    return
                  }
                  const mainLabel = mainTabs.find((x) => toKey(x) === nextMain) ?? ''
                  const subs = mainLabel ? subTabsByMain[mainLabel] ?? [] : []
                  const nextSub = subs[0] ? toKey(subs[0]) : ''
                  if (nextMain && nextSub) productsQuery.setMainSub(nextMain, nextSub)
                }}
              />
              <FormSelect
                label="Alt Kategori"
                value={productsQuery.sub || ''}
                options={[{ value: '', label: 'Seçiniz...' }, ...subOptions]}
                onChange={(e) => {
                  const nextSub = String((e as any)?.target?.value ?? '')
                  if (!nextSub) {
                    productsQuery.setMainSub(productsQuery.main || '', '')
                    return
                  }

                  if (productsQuery.main) {
                    productsQuery.setMainSub(productsQuery.main, nextSub)
                    return
                  }

                  // No main filter: filter by sub only.
                  productsQuery.setMainSub('', nextSub)
                }}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {productsQuery.loading &&
              Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="bg-white border border-gray-100 rounded-xl shadow-sm p-4">
                  <div className="h-4 bg-gray-100 rounded animate-pulse w-3/4" />
                  <div className="h-3 bg-gray-100 rounded animate-pulse w-1/2 mt-3" />
                  <div className="h-3 bg-gray-100 rounded animate-pulse w-2/3 mt-2" />
                  <div className="h-3 bg-gray-100 rounded animate-pulse w-1/3 mt-2" />
                  <div className="mt-4 flex justify-end gap-2">
                    <div className="h-7 w-20 bg-gray-100 rounded animate-pulse" />
                    <div className="h-7 w-14 bg-gray-100 rounded animate-pulse" />
                  </div>
                </div>
              ))}

            {!productsQuery.loading && productsQuery.items.length === 0 && (
              <div className="sm:col-span-2 lg:col-span-3 px-4 py-10 text-center bg-white border border-gray-100 rounded-xl shadow-sm">
                <div className="text-gray-300 text-3xl mb-2">📦</div>
                <div className="text-xs text-gray-400 font-medium">Ürün bulunamadı.</div>
              </div>
            )}

            {!productsQuery.loading &&
              productsQuery.items.map((p) => (
                <div
                  key={p.id}
                  className={
                    (Number(p.stock ?? 0) <= Number((p as any).minStock ?? 0) && Number((p as any).minStock ?? 0) > 0
                      ? 'bg-red-50 border-red-200'
                      : 'bg-white border-gray-100') +
                    ' border rounded-xl shadow-sm p-4 hover:bg-gray-50/60 transition-colors'
                  }
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-semibold text-gray-900 text-sm truncate">{p.name}</div>
                      <div className="text-[11px] text-gray-500 mt-1 truncate">Kod: {p.stockCode}</div>
                    </div>
                    <span className={
                      'inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ' +
                      (p.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500')
                    }>
                      {p.isActive ? 'Aktif' : 'Pasif'}
                    </span>
                  </div>

                  <div className="text-[11px] text-gray-500 mt-2">Grup: {p.groupCode}</div>
                  <div className="text-[11px] text-gray-500">Alt: {p.subGroupCode}</div>

                  <div className="text-[11px] text-gray-500 mt-1">
                    <span className="text-gray-400">F4:</span>{' '}
                    <span className="font-semibold text-emerald-700">
                      {(() => {
                        const rawId = trimId(p?.id)
                        const f4 = rawId ? f4PriceByProductId[rawId] ?? f4PriceByProductId[rawId.toLowerCase()] : undefined
                        const priceValue = f4 ? f4.price : null
                        const currencyText = f4 ? f4.currency : ''
                        const priceText = priceValue == null ? '-' : String(priceValue)
                        const cur = currencyText ? ` ${String(currencyText)}` : ''
                        return `${priceText}${cur}`
                      })()}
                    </span>
                  </div>

                  <div className="mt-3 flex items-center justify-end gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        const pid = trimId(p.id)
                        if (!pid) return
                        navigate(`/users/atiliFiyatlandirma?productId=${encodeURIComponent(pid)}`)
                      }}
                      className="inline-flex items-center gap-1 h-[26px] px-2.5 rounded-md text-[11px] font-medium bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-colors border border-emerald-100"
                      title="Fiyat Atama"
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 1v22"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7H14a3 3 0 0 1 0 6H6"/></svg>
                      Fiyat
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEditError(null)
                        const mediaFromApi = Array.isArray((p as any).imageUrls) ? ((p as any).imageUrls as string[]) : []
                        const normalizedMedia = (mediaFromApi ?? [])
                          .map((x) => String(x ?? '').trim())
                          .filter(Boolean)
                        const legacy = String(p.imageUrl ?? '').trim()
                        const combined = normalizedMedia.length > 0 ? normalizedMedia : legacy ? [legacy] : []
                        setEditForm({
                          id: p.id,
                          stockCode: String(p.stockCode ?? ''),
                          name: String(p.name ?? ''),
                          description: String((p as any).description ?? ''),
                          // Replaced by the stored copy as soon as the dialog loads it.
                          features: '',
                          barcode: String(p.barcode ?? ''),
                          groupCode: String(p.groupCode ?? ''),
                          subGroupCode: String(p.subGroupCode ?? ''),
                          taxRate: String(p.taxRate ?? 20),
                          stock: String(p.stock ?? 0),
                          minStock: String((p as any).minStock ?? 0),
                          bsyMinStock: String((p as any).bsyMinStock ?? 12),
                          isInstallable: Boolean((p as any).isInstallable ?? false),
                          installationFee: String((p as any).installationFee ?? ''),
                          imageUrl: combined[0] ?? legacy,
                          imageUrls: combined,
                          videoUrl: String((p as any).videoUrl ?? ''),
                          isActive: Boolean(p.isActive ?? true)
                        })
                        setEditImageUrlDraft('')
                        setEditOpen(true)
                      }}
                      className="inline-flex items-center gap-1 h-[26px] px-2.5 rounded-md text-[11px] font-medium bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors border border-blue-100"
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                      Düzenle
                    </button>

                    <button
                      type="button"
                      disabled={deleteSavingId === p.id}
                      onClick={() => {
                        setDeleteError(null)
                        setDeleteTarget({ id: p.id, name: p.name })
                        setDeleteConfirmOpen(true)
                      }}
                      className="inline-flex items-center gap-1 h-[26px] px-2.5 rounded-md text-[11px] font-medium bg-red-50 text-red-600 hover:bg-red-100 transition-colors border border-red-100 disabled:opacity-60"
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
                      Sil
                    </button>
                  </div>
                </div>
              ))}
          </div>
        </div>

        <div className="lg:col-span-1">
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <div className="font-semibold text-gray-900">Kategori Yönetimi</div>

            <div className="mt-4">
              <div className="text-xs font-semibold text-gray-600">Yeni Üst Grup</div>
              <div className="mt-2 flex items-center gap-2">
                <input
                  value={mainCreateValue}
                  onChange={(e) => setMainCreateValue(e.target.value)}
                  className="flex-1 px-3 py-2 text-xs border border-gray-300 rounded"
                  placeholder="Örn: KÜÇÜK EV ALETLERİ"
                />
                <button
                  type="button"
                  onClick={() => {
                    const v = mainCreateValue.trim()
                    if (!v) return

                    void (async () => {
                      await createMainCategory(v)
                      await refresh()
                      setMainCreateValue('')
                    })()
                  }}
                  className="px-3 py-2 text-xs font-semibold bg-green-600 text-white rounded"
                >
                  Ekle
                </button>
              </div>
            </div>

            <div className="mt-4">
              <div className="text-xs font-semibold text-gray-600">Üst Grup Adı Değiştir</div>
              <div className="mt-2 grid grid-cols-1 gap-2">
                <FormSelect
                  label=""
                  value={mainRenameFrom}
                  options={[{ value: '', label: 'Seçiniz...' }, ...mainTabs.map((m) => ({ value: m, label: m }))]}
                  onChange={(e) => setMainRenameFrom(String((e as any)?.target?.value ?? ''))}
                />
                <input
                  value={mainRenameTo}
                  onChange={(e) => setMainRenameTo(e.target.value)}
                  className="px-3 py-2 text-xs border border-gray-300 rounded"
                  placeholder="Yeni üst grup adı"
                />
                <button
                  type="button"
                  onClick={() => {
                    if (!mainRenameFrom.trim() || !mainRenameTo.trim()) return

                    void (async () => {
                      const fromKey = toKey(mainRenameFrom)
                      const toKeyValue = toKey(mainRenameTo)
                      const id = `m:${fromKey}`
                      const prev = getMeta(id)

                      await updateCategory(id, {
                        name: toKeyValue,
                        description: prev.description,
                        status: prev.status
                      })
                      await refresh()
                      setMainRenameFrom('')
                      setMainRenameTo('')
                    })()
                  }}
                  className="px-3 py-2 text-xs font-semibold bg-brand-blue text-white rounded"
                >
                  Güncelle
                </button>
              </div>
            </div>

            <div className="mt-6 border-t pt-4">
              <div className="text-xs font-semibold text-gray-600">Yeni Alt Grup</div>
              <div className="mt-2 grid grid-cols-1 gap-2">
                <FormSelect
                  label="Üst Grup"
                  value={subMain}
                  options={mainTabs.map((m) => ({ value: m, label: m }))}
                  onChange={(e) => setSubMain(String((e as any)?.target?.value ?? ''))}
                />
                <input
                  value={subCreateValue}
                  onChange={(e) => setSubCreateValue(e.target.value)}
                  className="px-3 py-2 text-xs border border-gray-300 rounded"
                  placeholder="Örn: YENI ALT GRUP"
                />
                <button
                  type="button"
                  onClick={() => {
                    if (!subMain.trim() || !subCreateValue.trim()) return

                    void (async () => {
                      await createSubCategory(subMain, subCreateValue)
                      await refresh()
                      setSubCreateValue('')
                    })()
                  }}
                  className="px-3 py-2 text-xs font-semibold bg-green-600 text-white rounded"
                >
                  Ekle
                </button>
              </div>
            </div>

            <div className="mt-4">
              <div className="text-xs font-semibold text-gray-600">Alt Grup Adı Değiştir</div>
              <div className="mt-2 grid grid-cols-1 gap-2">
                <FormSelect
                  label="Üst Grup"
                  value={subMain}
                  options={mainTabs.map((m) => ({ value: m, label: m }))}
                  onChange={(e) => setSubMain(String((e as any)?.target?.value ?? ''))}
                />
                <FormSelect
                  label="Eski Alt Grup"
                  value={subRenameFrom}
                  options={[
                    { value: '', label: 'Seçiniz...' },
                    ...(subMain ? (subTabsByMain[subMain] ?? []).map((s) => ({ value: s, label: s })) : [])
                  ]}
                  onChange={(e) => setSubRenameFrom(String((e as any)?.target?.value ?? ''))}
                />
                <input
                  value={subRenameTo}
                  onChange={(e) => setSubRenameTo(e.target.value)}
                  className="px-3 py-2 text-xs border border-gray-300 rounded"
                  placeholder="Yeni alt grup adı"
                />
                <button
                  type="button"
                  onClick={() => {
                    if (!subMain.trim() || !subRenameFrom.trim() || !subRenameTo.trim()) return

                    void (async () => {
                      const mainKey = toKey(subMain)
                      const fromKey = toKey(subRenameFrom)
                      const toKeyValue = toKey(subRenameTo)
                      const id = `s:${mainKey}:${fromKey}`
                      const prev = getMeta(id)

                      await updateCategory(id, {
                        name: toKeyValue,
                        description: prev.description,
                        status: prev.status
                      })
                      await refresh()
                      setSubRenameFrom('')
                      setSubRenameTo('')
                    })()
                  }}
                  className="px-3 py-2 text-xs font-semibold bg-brand-blue text-white rounded"
                >
                  Güncelle
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <Modal
        isOpen={createOpen}
        onClose={() => {
          if (createSaving) return
          setCreateOpen(false)
        }}
        title="Ürün Ekle"
        footer={
          <>
            <button
              type="button"
              onClick={() => setCreateOpen(false)}
              disabled={createSaving}
              className="px-4 py-2 rounded-md text-xs font-semibold border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-60"
            >
              Kapat
            </button>
            <button
              type="button"
              disabled={
                createSaving ||
                !createForm.stockCode.trim() ||
                !createForm.name.trim() ||
                !createForm.groupCode.trim() ||
                !createForm.subGroupCode.trim()
              }
              onClick={async () => {
                try {
                  setCreateSaving(true)
                  setCreateError(null)

                  const minStock = Number(createForm.minStock)
                  const bsyMinStock = Number(createForm.bsyMinStock)
                  const taxRate = Number(createForm.taxRate)
                  const stock = Number(createForm.stock)
                  if (!Number.isFinite(minStock)) throw new Error('Minimum stok sayısal olmalı')
                  if (!Number.isFinite(bsyMinStock) || bsyMinStock < 0) throw new Error('Satışa kapanma eşiği 0 veya daha büyük bir sayı olmalı')
                  if (!Number.isFinite(taxRate)) throw new Error('KDV (%) sayısal olmalı')
                  if (!Number.isFinite(stock)) throw new Error('Stok sayısal olmalı')

                  const isInstallable = Boolean(createForm.isInstallable)
                  const installationFeeText = String(createForm.installationFee ?? '').trim()
                  const installationFee = installationFeeText ? Number(installationFeeText) : null
                  if (isInstallable && installationFee !== null && !Number.isFinite(installationFee)) {
                    throw new Error('Montaj ücreti sayısal olmalı')
                  }

                  const normalizedGroupCode = toKey(createForm.groupCode)
                  const normalizedSubGroupCode = toKey(createForm.subGroupCode)
                  if (!normalizedGroupCode || !normalizedSubGroupCode) throw new Error('Kategori alanları zorunlu')

                  const normalizedImages = (createForm.imageUrls ?? [])
                    .map((x) => String(x ?? '').trim())
                    .filter(Boolean)
                  const primaryImage = normalizedImages[0] ?? createForm.imageUrl.trim() ?? ''

                  const initialStocks = Object.entries(warehouseStocks)
                    .map(([code, qty]) => ({ warehouseCode: Number(code), quantity: Number(qty) || 0 }))
                    .filter((x) => Number.isFinite(x.warehouseCode) && x.warehouseCode > 0 && x.quantity > 0)

                  const stockForCreate = initialStocks.length > 0 ? initialStocks.reduce((a, x) => a + x.quantity, 0) : stock

                  const res = await fetch(`${API_BASE_URL}/api/products`, {
                    method: 'POST',
                    headers: { ...buildHeaders(true) },
                    body: JSON.stringify({
                      stockCode: createForm.stockCode.trim(),
                      name: createForm.name.trim(),
                      description: createForm.description.trim() ? createForm.description.trim() : null,
                      barcode: createForm.barcode.trim() ? createForm.barcode.trim() : null,
                      groupCode: normalizedGroupCode,
                      subGroupCode: normalizedSubGroupCode,
                      unit: 'ADET',
                      taxRate,
                      minStock,
                      bsyMinStock,
                      isOfficial: false,
                      stock: stockForCreate,
                      initialStocks: initialStocks.length > 0 ? initialStocks : null,
                      isActive: true,
                      isInstallable,
                      installationFee: isInstallable ? installationFee : null,
                      imageUrl: primaryImage ? primaryImage : null,
                      imageUrls: normalizedImages.length > 0 ? normalizedImages : null,
                      videoUrl: createForm.videoUrl.trim() ? createForm.videoUrl.trim() : null
                    })
                  })

                  if (!res.ok) {
                    const t = String(await res.text().catch(() => '')).trim()
                    throw new Error(t || `Ürün eklenemedi (${res.status})`)
                  }

                  setCreateOpen(false)
                  setCreateForm({
                    stockCode: '',
                    name: '',
                    description: '',
                    barcode: '',
                    groupCode: normalizedGroupCode,
                    subGroupCode: normalizedSubGroupCode,
                    taxRate: '20',
                    stock: '0',
                    minStock: '0',
                    bsyMinStock: '12',
                    isInstallable: false,
                    installationFee: '',
                    imageUrl: '',
                    imageUrls: [],
                    videoUrl: ''
                  })
                  setCreateImageUrlDraft('')
                  const resetStocks: Record<string, string> = {}
                  ;(warehouses ?? []).forEach((w) => { resetStocks[String(w.warehouseCode)] = '' })
                  setWarehouseStocks(resetStocks)
                  productsQuery.refetch()
                } catch (e: any) {
                  setCreateError(String(e?.message ?? 'Ürün eklenemedi'))
                } finally {
                  setCreateSaving(false)
                }
              }}
              className="px-4 py-2 rounded-md text-xs font-semibold bg-brand-blue text-white hover:opacity-95 disabled:opacity-60"
            >
              {createSaving ? 'Kaydediliyor...' : 'Kaydet'}
            </button>
          </>
        }
      >
        {createError && <div className="mb-3 text-sm font-semibold text-red-600">{createError}</div>}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormInput label="STOK KODU" value={createForm.stockCode} onChange={(e) => setCreateForm((p) => ({ ...p, stockCode: e.target.value }))} />
          <FormInput label="Ürün Adı" value={createForm.name} onChange={(e) => setCreateForm((p) => ({ ...p, name: e.target.value }))} />
          <FormInput label="Minimum Stok" hint="Stok alarmı: stok bu seviyeye inince ürün 'Kritik' olarak işaretlenir. Satışı KAPATMAZ." type="number" value={createForm.minStock} onChange={(e) => setCreateForm((p) => ({ ...p, minStock: e.target.value }))} />
          <FormInput label="Satışa Kapanma Eşiği" hint="Stok bu sayının altına düşünce ürün bayi tarafında otomatik satışa kapanır, stok toparlayınca kendiliğinden açılır. Varsayılan 12. 0 yazarsan eşik uygulanmaz, mal stok bitene kadar satılır." type="number" value={createForm.bsyMinStock} onChange={(e) => setCreateForm((p) => ({ ...p, bsyMinStock: e.target.value }))} />
          <FormInput label="KDV (%)" type="number" value={createForm.taxRate} onChange={(e) => setCreateForm((p) => ({ ...p, taxRate: e.target.value }))} />
          <div className="md:col-span-2">
            <div className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">Açıklama (opsiyonel)</div>
            <textarea
              value={createForm.description}
              onChange={(e) => setCreateForm((p) => ({ ...p, description: e.target.value }))}
              className="input-base text-sm min-h-[84px]"
            />
          </div>
          <FormInput label="Barkod (opsiyonel)" value={createForm.barcode} onChange={(e) => setCreateForm((p) => ({ ...p, barcode: e.target.value }))} />
          <FormInput label="Video URL (opsiyonel)" value={createForm.videoUrl} onChange={(e) => setCreateForm((p) => ({ ...p, videoUrl: e.target.value }))} />

          <div className="md:col-span-2">
            <div className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">Görseller (çoklu URL)</div>
            <div className="mt-2 flex items-center gap-2">
              <input
                value={createImageUrlDraft}
                onChange={(e) => setCreateImageUrlDraft(e.target.value)}
                className="flex-1 px-3 py-2 text-xs border border-gray-300 rounded"
                placeholder="https://..."
              />
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                disabled={createImageUploading}
                onChange={(e) => {
                  const f = (e.target.files && e.target.files[0]) || null
                  if (!f) return
                  void (async () => {
                    try {
                      setCreateImageUploading(true)
                      const fd = new FormData()
                      fd.append('file', f)
                      const res = await fetch(`${API_BASE_URL}/api/products/upload-image`, {
                        method: 'POST',
                        headers: { Authorization: buildHeaders(false).Authorization ?? '' },
                        body: fd
                      })
                      const jsonText = await res.text().catch(() => '')
                      if (!res.ok) throw new Error(jsonText || `Görsel yüklenemedi (${res.status})`)
                      const j = JSON.parse(jsonText || '{}') as any
                      const url = String(j?.url ?? '').trim()
                      if (!url) throw new Error('Görsel URL alınamadı')
                      setCreateForm((p) => {
                        const list = [...(p.imageUrls ?? [])]
                        if (!list.includes(url)) list.push(url)
                        return { ...p, imageUrls: list, imageUrl: list[0] ?? p.imageUrl }
                      })
                    } catch (err: any) {
                      setCreateError(String(err?.message ?? 'Görsel yüklenemedi'))
                    } finally {
                      setCreateImageUploading(false)
                      e.target.value = ''
                    }
                  })()
                }}
                className="px-3 py-2 text-xs border border-gray-300 rounded bg-white"
              />
              <button
                type="button"
                onClick={() => {
                  const v = createImageUrlDraft.trim()
                  if (!v) return
                  setCreateForm((p) => {
                    const list = [...(p.imageUrls ?? [])]
                    if (!list.includes(v)) list.push(v)
                    return { ...p, imageUrls: list, imageUrl: list[0] ?? p.imageUrl }
                  })
                  setCreateImageUrlDraft('')
                }}
                className="px-3 py-2 text-xs font-semibold bg-brand-blue text-white rounded"
              >
                Ekle
              </button>
            </div>

            {(createForm.imageUrls?.length ?? 0) > 0 ? (
              <div className="mt-3 flex gap-2 overflow-x-auto pb-2">
                {(createForm.imageUrls ?? []).map((url) => (
                  <div key={url} className="relative flex-shrink-0 w-24">
                    <div className="w-24 h-16 border border-gray-200 rounded bg-gray-50 overflow-hidden">
                      <img src={toImageSrc(url)} alt="" className="w-full h-full object-cover" />
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setCreateForm((p) => {
                          const next = (p.imageUrls ?? []).filter((x) => x !== url)
                          return { ...p, imageUrls: next, imageUrl: next[0] ?? '' }
                        })
                      }}
                      className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-white border border-gray-200 text-red-600 text-xs"
                      title="Kaldır"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
          <FormSelect
            label="Ana Kategori"
            value={createForm.groupCode}
            options={[{ value: '', label: 'Seçiniz...' }, ...mainTabs.map((t) => ({ value: toKey(t), label: t }))]}

            onChange={(e) => {
              const nextGroup = String((e as any)?.target?.value ?? '')
              if (!nextGroup) {
                setCreateForm((p) => ({ ...p, groupCode: '', subGroupCode: '' }))
                return
              }
              const mainLabel = mainTabs.find((x) => toKey(x) === nextGroup) ?? ''
              const subs = mainLabel ? getSubsForMain(mainLabel) : []
              const nextSub = subs[0] ? toKey(subs[0]) : ''
              setCreateForm((p) => ({ ...p, groupCode: nextGroup, subGroupCode: nextSub }))
            }}
          />
          <FormSelect
            label="Alt Kategori"
            value={createForm.subGroupCode}
            options={(() => {
              const mainLabel = mainTabs.find((x) => toKey(x) === createForm.groupCode) ?? ''
              const subs = mainLabel ? getSubsForMain(mainLabel) : []
              if (!createForm.groupCode) return [{ value: '', label: 'Önce ana kategori seçiniz' }]
              return [{ value: '', label: 'Seçiniz...' }, ...subs.map((s) => ({ value: toKey(s), label: s }))]
            })()}
            onChange={(e) => {
              const v = String((e as any)?.target?.value ?? '')
              setCreateForm((p) => ({ ...p, subGroupCode: v }))
            }}
          />
          <div className="md:col-span-2">
            <label className="flex items-center gap-2 text-xs font-semibold text-gray-700">
              <input
                type="checkbox"
                checked={Boolean(createForm.isInstallable)}
                onChange={(e) =>
                  setCreateForm((p) => ({
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
            value={createForm.installationFee}
            onChange={(e) => setCreateForm((p) => ({ ...p, installationFee: e.target.value }))}
            disabled={!createForm.isInstallable}
          />
          <div className="md:col-span-2">
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
                    <tr className="border-t-2 border-gray-300 bg-gray-50">
                      <td className="px-3 py-2 text-[11px] font-bold text-gray-700">TOPLAM STOK</td>
                      <td className="px-3 py-2 text-right text-[12px] font-bold text-gray-800">{warehouseStockTotal}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={editOpen}
        onClose={() => {
          if (editSaving) return
          setEditOpen(false)
        }}
        title="Ürün Düzenle"
        footer={
          <>
            <button
              type="button"
              onClick={() => setEditOpen(false)}
              disabled={editSaving}
              className="px-4 py-2 rounded-md text-xs font-semibold border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-60"
            >
              Kapat
            </button>
            <button
              type="button"
              disabled={editSaving || !editForm.stockCode.trim() || !editForm.name.trim() || !editForm.groupCode.trim() || !editForm.subGroupCode.trim()}
              onClick={async () => {
                try {
                  setEditSaving(true)
                  setEditError(null)

                  const taxRate = Number(editForm.taxRate)
                  const stock = Number(editForm.stock)
                  const minStock = Number(editForm.minStock)
                  const bsyMinStock = Number(editForm.bsyMinStock)
                  if (!Number.isFinite(taxRate)) throw new Error('KDV (%) sayısal olmalı')
                  if (!Number.isFinite(stock)) throw new Error('Stok sayısal olmalı')
                  if (!Number.isFinite(minStock)) throw new Error('Minimum stok sayısal olmalı')
                  if (!Number.isFinite(bsyMinStock) || bsyMinStock < 0) throw new Error('Satışa kapanma eşiği 0 veya daha büyük bir sayı olmalı')

                  const isInstallable = Boolean(editForm.isInstallable)
                  const installationFeeText = String(editForm.installationFee ?? '').trim()
                  const installationFee = installationFeeText ? Number(installationFeeText) : null
                  if (isInstallable && installationFee !== null && !Number.isFinite(installationFee)) {
                    throw new Error('Montaj ücreti sayısal olmalı')
                  }

                  const normalizedGroupCode = toKey(editForm.groupCode)
                  const normalizedSubGroupCode = toKey(editForm.subGroupCode)
                  if (!normalizedGroupCode || !normalizedSubGroupCode) throw new Error('Kategori alanları zorunlu')

                  const normalizedImages = (editForm.imageUrls ?? [])
                    .map((x) => String(x ?? '').trim())
                    .filter(Boolean)
                  const primaryImage = normalizedImages[0] ?? editForm.imageUrl.trim() ?? ''

                  const res = await fetch(`${API_BASE_URL}/api/products/${editForm.id}`, {
                    method: 'PUT',
                    headers: { ...buildHeaders(true) },
                    body: JSON.stringify({
                      stockCode: editForm.stockCode.trim(),
                      name: editForm.name.trim(),
                      description: editForm.description.trim() ? editForm.description.trim() : null,
                      barcode: editForm.barcode.trim() ? editForm.barcode.trim() : null,
                      groupCode: normalizedGroupCode,
                      subGroupCode: normalizedSubGroupCode,
                      unit: 'ADET',
                      taxRate,
                      isOfficial: false,
                      stock,
                      minStock,
                      bsyMinStock,
                      isActive: Boolean(editForm.isActive),
                      isInstallable,
                      installationFee: isInstallable ? installationFee : null,
                      imageUrl: primaryImage ? primaryImage : null,
                      imageUrls: normalizedImages.length > 0 ? normalizedImages : null,
                      videoUrl: editForm.videoUrl.trim() ? editForm.videoUrl.trim() : null
                    })
                  })

                  if (!res.ok) {
                    const t = String(await res.text().catch(() => '')).trim()
                    throw new Error(t || `Ürün güncellenemedi (${res.status})`)
                  }

                  // The offer copy is stored separately from the catalogue row. Saved after the
                  // product itself so a rejected product update does not leave the copy ahead
                  // of it.
                  const detailRes = await fetch(
                    `${API_BASE_URL}/api/products/${encodeURIComponent(editForm.stockCode.trim())}/detail`,
                    {
                      method: 'PUT',
                      headers: { ...buildHeaders(true) },
                      body: JSON.stringify({
                        description: editForm.description.trim() ? editForm.description.trim() : null,
                        features: editForm.features.trim() ? editForm.features.trim() : null
                      })
                    }
                  )

                  if (!detailRes.ok) {
                    const t = String(await detailRes.text().catch(() => '')).trim()
                    throw new Error(t || `Açıklama ve özellikler kaydedilemedi (${detailRes.status})`)
                  }

                  setEditOpen(false)
                  productsQuery.refetch()
                } catch (e: any) {
                  setEditError(String(e?.message ?? 'Ürün güncellenemedi'))
                } finally {
                  setEditSaving(false)
                }
              }}
              className="px-4 py-2 rounded-md text-xs font-semibold bg-brand-blue text-white hover:opacity-95 disabled:opacity-60"
            >
              {editSaving ? 'Kaydediliyor...' : 'Kaydet'}
            </button>
          </>
        }
      >
        {editError && <div className="mb-3 text-sm font-semibold text-red-600">{editError}</div>}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormInput label="STOK KODU" value={editForm.stockCode} onChange={(e) => setEditForm((p) => ({ ...p, stockCode: e.target.value }))} />
          <FormInput label="Ürün Adı" value={editForm.name} onChange={(e) => setEditForm((p) => ({ ...p, name: e.target.value }))} />
          <FormInput label="Minimum Stok" hint="Stok alarmı: stok bu seviyeye inince ürün 'Kritik' olarak işaretlenir. Satışı KAPATMAZ." type="number" value={editForm.minStock} onChange={(e) => setEditForm((p) => ({ ...p, minStock: e.target.value }))} />
          <FormInput label="Satışa Kapanma Eşiği" hint="Stok bu sayının altına düşünce ürün bayi tarafında otomatik satışa kapanır, stok toparlayınca kendiliğinden açılır. Varsayılan 12. 0 yazarsan eşik uygulanmaz, mal stok bitene kadar satılır." type="number" value={editForm.bsyMinStock} onChange={(e) => setEditForm((p) => ({ ...p, bsyMinStock: e.target.value }))} />
          <FormInput label="KDV (%)" type="number" value={editForm.taxRate} onChange={(e) => setEditForm((p) => ({ ...p, taxRate: e.target.value }))} />
          <div className="md:col-span-2">
            <div className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">Açıklama</div>
            <div className="text-[10px] text-gray-400 mt-0.5">
              Ürünün ne olduğunu anlatan metin. Teklif basımında ve ürün incele ekranında görünür. Özellik yazmayın.
            </div>
            <textarea
              value={editForm.description}
              onChange={(e) => setEditForm((p) => ({ ...p, description: e.target.value }))}
              className="input-base text-sm min-h-[84px] mt-1"
            />
          </div>

          <div className="md:col-span-2">
            <div className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">Özellikler</div>
            <div className="text-[10px] text-gray-400 mt-0.5">
              Her satıra bir özellik. Özellikli teklif formunda madde madde basılır.
            </div>
            <textarea
              value={editForm.features}
              onChange={(e) => setEditForm((p) => ({ ...p, features: e.target.value }))}
              className="input-base text-sm min-h-[140px] mt-1 font-mono"
              placeholder={'Güç (W) : 220 W' + String.fromCharCode(10) + 'Filtre : Çift filtre'}
            />
            <div className="text-[10px] text-gray-400 mt-1">
              {editForm.features.split(String.fromCharCode(10)).map((x) => x.trim()).filter(Boolean).length} özellik
            </div>
          </div>
          <FormInput label="Barkod (opsiyonel)" value={editForm.barcode} onChange={(e) => setEditForm((p) => ({ ...p, barcode: e.target.value }))} />
          <FormInput label="Video URL (opsiyonel)" value={editForm.videoUrl} onChange={(e) => setEditForm((p) => ({ ...p, videoUrl: e.target.value }))} />

          <div className="md:col-span-2">
            <div className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">Görseller (çoklu URL)</div>
            <div className="mt-2 flex items-center gap-2">
              <input
                value={editImageUrlDraft}
                onChange={(e) => setEditImageUrlDraft(e.target.value)}
                className="flex-1 px-3 py-2 text-xs border border-gray-300 rounded"
                placeholder="https://..."
              />
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                disabled={editImageUploading}
                onChange={(e) => {
                  const f = (e.target.files && e.target.files[0]) || null
                  if (!f) return
                  void (async () => {
                    try {
                      setEditImageUploading(true)
                      const fd = new FormData()
                      fd.append('file', f)
                      const res = await fetch(`${API_BASE_URL}/api/products/upload-image`, {
                        method: 'POST',
                        headers: { Authorization: buildHeaders(false).Authorization ?? '' },
                        body: fd
                      })
                      const jsonText = await res.text().catch(() => '')
                      if (!res.ok) throw new Error(jsonText || `Görsel yüklenemedi (${res.status})`)
                      const j = JSON.parse(jsonText || '{}') as any
                      const url = String(j?.url ?? '').trim()
                      if (!url) throw new Error('Görsel URL alınamadı')
                      setEditForm((p) => {
                        const list = [...(p.imageUrls ?? [])]
                        if (!list.includes(url)) list.push(url)
                        return { ...p, imageUrls: list, imageUrl: list[0] ?? p.imageUrl }
                      })
                    } catch (err: any) {
                      setEditError(String(err?.message ?? 'Görsel yüklenemedi'))
                    } finally {
                      setEditImageUploading(false)
                      e.target.value = ''
                    }
                  })()
                }}
                className="px-3 py-2 text-xs border border-gray-300 rounded bg-white"
              />
              <button
                type="button"
                onClick={() => {
                  const v = editImageUrlDraft.trim()
                  if (!v) return
                  setEditForm((p) => {
                    const list = [...(p.imageUrls ?? [])]
                    if (!list.includes(v)) list.push(v)
                    return { ...p, imageUrls: list, imageUrl: list[0] ?? p.imageUrl }
                  })
                  setEditImageUrlDraft('')
                }}
                className="px-3 py-2 text-xs font-semibold bg-brand-blue text-white rounded"
              >
                Ekle
              </button>
            </div>

            {(editForm.imageUrls?.length ?? 0) > 0 ? (
              <div className="mt-3 flex gap-2 overflow-x-auto pb-2">
                {(editForm.imageUrls ?? []).map((url) => (
                  <div key={url} className="relative flex-shrink-0 w-24">
                    <div className="w-24 h-16 border border-gray-200 rounded bg-gray-50 overflow-hidden">
                      <img src={toImageSrc(url)} alt="" className="w-full h-full object-cover" />
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setEditForm((p) => {
                          const next = (p.imageUrls ?? []).filter((x) => x !== url)
                          return { ...p, imageUrls: next, imageUrl: next[0] ?? '' }
                        })
                      }}
                      className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-white border border-gray-200 text-red-600 text-xs"
                      title="Kaldır"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
          <FormSelect
            label="Ana Kategori"
            value={editForm.groupCode}
            options={mainTabs.map((t) => ({ value: toKey(t), label: t }))}
            onChange={(e) => {
              const nextGroup = String((e as any)?.target?.value ?? '')
              const mainLabel = mainTabs.find((x) => toKey(x) === nextGroup) ?? ''
              const subs = mainLabel ? getSubsForMain(mainLabel) : []
              const nextSub = subs[0] ? toKey(subs[0]) : ''
              setEditForm((p) => ({ ...p, groupCode: nextGroup, subGroupCode: nextSub }))
            }}
          />
          <FormSelect
            label="Alt Kategori"
            value={editForm.subGroupCode}
            options={(() => {
              const mainLabel = mainTabs.find((x) => toKey(x) === editForm.groupCode) ?? ''
              const subs = mainLabel ? getSubsForMain(mainLabel) : []
              return subs.map((s) => ({ value: toKey(s), label: s }))
            })()}
            onChange={(e) => {
              const v = String((e as any)?.target?.value ?? '')
              setEditForm((p) => ({ ...p, subGroupCode: v }))
            }}
          />
          <div className="md:col-span-2">
            <label className="flex items-center gap-2 text-xs font-semibold text-gray-700">
              <input
                type="checkbox"
                checked={Boolean(editForm.isInstallable)}
                onChange={(e) =>
                  setEditForm((p) => ({
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
            value={editForm.installationFee}
            onChange={(e) => setEditForm((p) => ({ ...p, installationFee: e.target.value }))}
            disabled={!editForm.isInstallable}
          />
          <FormInput
            label="Stok"
            type="text"
            inputMode="numeric"
            value={editForm.stock}
            onChange={(e) => setEditForm((p) => ({ ...p, stock: sanitizeIntText(e.target.value, { maxDigits: 10 }) }))}
            placeholder="0"
            disabled
          />
        </div>
      </Modal>

      <Modal
        isOpen={deleteConfirmOpen}
        onClose={() => {
          if (deleteSavingId) return
          setDeleteConfirmOpen(false)
          setDeleteTarget(null)
          setDeleteError(null)
        }}
        title="Ürünü Sil"
        footer={
          <>
            <button
              type="button"
              disabled={Boolean(deleteSavingId)}
              onClick={() => {
                setDeleteConfirmOpen(false)
                setDeleteTarget(null)
                setDeleteError(null)
              }}
              className="px-4 py-2 rounded-md text-xs font-semibold border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-60"
            >
              Vazgeç
            </button>
            <button
              type="button"
              disabled={Boolean(deleteSavingId) || !deleteTarget}
              onClick={async () => {
                if (!deleteTarget) return
                try {
                  setDeleteSavingId(deleteTarget.id)
                  setDeleteError(null)
                  const res = await fetch(`${API_BASE_URL}/api/products/${deleteTarget.id}`, {
                    method: 'DELETE',
                    headers: { ...buildHeaders(false) }
                  })
                  if (!res.ok) {
                    const t = String(await res.text().catch(() => '')).trim()
                    throw new Error(t || `Ürün silinemedi (${res.status})`)
                  }

                  setDeleteConfirmOpen(false)
                  setDeleteTarget(null)
                  productsQuery.refetch()
                } catch (e: any) {
                  setDeleteError(String(e?.message ?? 'Ürün silinemedi'))
                } finally {
                  setDeleteSavingId(null)
                }
              }}
              className="px-4 py-2 rounded-md text-xs font-semibold bg-red-600 text-white hover:bg-red-700 disabled:opacity-60"
            >
              {deleteSavingId ? 'Siliniyor...' : 'Sil'}
            </button>
          </>
        }
      >
        {deleteError && <div className="mb-3 text-sm font-semibold text-red-600">{deleteError}</div>}
        <div className="text-sm text-gray-700">
          {deleteTarget ? (
            <>
              <div className="font-semibold text-gray-900">{deleteTarget.name}</div>
              <div className="mt-2">Bu ürünü silmek istediğinize emin misiniz?</div>
            </>
          ) : (
            <div>Bu ürünü silmek istediğinize emin misiniz?</div>
          )}
        </div>
      </Modal>

      <Modal
        isOpen={analysisModalOpen}
        onClose={() => {
          setAnalysisModalOpen(false)
          setAnalysisData(null)
          setAnalysisSearchQ('')
          setAnalysisError(null)
        }}
        title="Ürün Analiz Paneli"
        containerClassName="max-w-4xl"
        scrollable
      >
        <div className="mb-6 bg-slate-50 p-4 rounded-xl border border-slate-200/60 animate-fadeIn">
          <label className="block text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wider">Ürün Seçimi</label>
          <div className="relative mb-2">
            <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="Ürün adı veya stok kodu ile ara..."
              value={analysisSearchQ}
              onChange={(e) => setAnalysisSearchQ(e.target.value)}
              className="w-full pl-9 pr-4 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-400 bg-white text-slate-800"
            />
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
