import { 
  Plus, 
  Search, 
  RefreshCw, 
  Printer, 
  ZoomIn, 
  ZoomOut, 
  RotateCcw, 
  AlertTriangle, 
  CheckCircle, 
  Clock, 
  Layers,
  Sparkles,
  ArrowUpDown,
  Move
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, useRef } from 'react'
import { 
  fetchStockSummary, 
  fetchStockCategories, 
  fetchStockProducts, 
  fetchStockProductDetail, 
  fetchStockProductSpareParts,
  type StockSummaryDto,
  type StockCategoryDto,
  type StockProductListItemDto,
  type StockSparePartListItemDto
} from '../api/stock'
import { useSignalREvent } from '../hooks/useSignalR'
import { createSparePartOrderRequest } from '../api/sparePartOrderRequests'
import { fetchSparePartOrderRequests, type SparePartOrderRequestDto } from '../api/sparePartOrderRequests'
import Table, { type TableColumn } from '../components/Table'
import { API_BASE_URL } from '../config'

export default function StokPage() {
  // Statistics and categories state
  const [summary, setSummary] = useState<StockSummaryDto>({
    totalProducts: 0,
    totalSpareParts: 0,
    criticalStock: 0,
    outOfStock: 0
  })
  const [categories, setCategories] = useState<StockCategoryDto[]>([])

  // Products grid pagination and filters state
  const [products, setProducts] = useState<StockProductListItemDto[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [searchTerm, setSearchTerm] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [selectedCategory, setSelectedCategory] = useState('')
  const [selectedStockStatus, setSelectedStockStatus] = useState('')
  const [sortBy, setSortBy] = useState('name')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc')

  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  // Selected product detail workspace state (Lazy Loaded)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detailProduct, setDetailProduct] = useState<StockProductListItemDto | null>(null)
  const [spareParts, setSpareParts] = useState<StockSparePartListItemDto[]>([])
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)

  // Order modal states
  const [orderModalOpen, setOrderModalOpen] = useState(false)
  const [orderTarget, setOrderTarget] = useState<StockSparePartListItemDto | null>(null)
  const [orderQty, setOrderQty] = useState(1)
  const [orderSaving, setOrderSaving] = useState(false)
  const [orderError, setOrderError] = useState<string | null>(null)

  // Recent requests list states
  const [recentModalOpen, setRecentModalOpen] = useState(false)
  const [recentLoading, setRecentLoading] = useState(false)
  const [recentError, setRecentError] = useState<string | null>(null)
  const [recentRequests, setRecentRequests] = useState<SparePartOrderRequestDto[]>([])

  // Zoom / Pan states for exploded diagram
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
  const containerRef = useRef<HTMLDivElement>(null)

  // Large image full-screen preview state
  const [imagePreviewOpen, setImagePreviewOpen] = useState(false)
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null)
  const [imagePreviewTitle, setImagePreviewTitle] = useState<string>('')
  const [imagePreviewZoom, setImagePreviewZoom] = useState(1)

  // Responsive device check
  const [isCompact, setIsCompact] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches
  )

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)')
    const onChange = (e: MediaQueryListEvent) => setIsCompact(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  // Debounce search query
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(searchTerm)
      setPage(1)
    }, 450)
    return () => clearTimeout(handler)
  }, [searchTerm])

  // Fetch summary & categories once
  const loadMeta = useCallback(async () => {
    try {
      const [sum, cats] = await Promise.all([
        fetchStockSummary(),
        fetchStockCategories()
      ])
      setSummary(sum)
      setCategories(cats)
    } catch (err) {
      console.error('Failed to load stock metadata', err)
    }
  }, [])

  // Fetch paginated products list
  const loadProducts = useCallback(async () => {
    setIsLoading(true)
    setLoadError(null)
    try {
      const res = await fetchStockProducts({
        page,
        pageSize,
        search: debouncedSearch,
        categoryId: selectedCategory,
        stockStatus: selectedStockStatus,
        sortBy,
        sortDirection
      })
      setProducts(res.items)
      setTotalCount(res.totalCount)

      // Auto-select first product on desktop if nothing selected
      if (!isCompact && !selectedId && res.items.length > 0) {
        setSelectedId(res.items[0].productId)
      }
    } catch (err: any) {
      setLoadError(err?.message ?? 'Ürün listesi yüklenemedi.')
    } finally {
      setIsLoading(false)
    }
  }, [page, pageSize, debouncedSearch, selectedCategory, selectedStockStatus, sortBy, sortDirection, isCompact, selectedId])

  // Sync / refresh logic
  const syncData = useCallback(() => {
    void loadMeta()
    void loadProducts()
  }, [loadMeta, loadProducts])

  useEffect(() => {
    syncData()
  }, [page, debouncedSearch, selectedCategory, selectedStockStatus, sortBy, sortDirection])

  useSignalREvent('service_record_updated', syncData)
  useSignalREvent('installation_updated', syncData)

  // Lazy load product details when selectedId changes
  useEffect(() => {
    if (!selectedId) {
      setDetailProduct(null)
      setSpareParts([])
      return
    }

    let isCurrent = true;
    const loadDetail = async () => {
      setDetailLoading(true)
      setDetailError(null)
      try {
        const [prod, parts] = await Promise.all([
          fetchStockProductDetail(selectedId),
          fetchStockProductSpareParts(selectedId)
        ])

        if (isCurrent) {
          setDetailProduct(prod)
          setSpareParts(parts)
          // Reset zoom/pan when changing product
          setZoom(1)
          setPan({ x: 0, y: 0 })
        }
      } catch (err: any) {
        if (isCurrent) {
          setDetailError(err?.message ?? 'Ürün detayları yüklenemedi.')
        }
      } finally {
        if (isCurrent) {
          setDetailLoading(false)
        }
      }
    }

    void loadDetail()

    return () => {
      isCurrent = false
    }
  }, [selectedId])

  // Recent spare part requests
  const loadRecentRequests = async () => {
    try {
      setRecentLoading(true)
      setRecentError(null)
      const res = await fetchSparePartOrderRequests()
      const list = (res as any)?.data ?? []
      setRecentRequests(Array.isArray(list) ? list : [])
    } catch (e: any) {
      setRecentError(String(e?.message ?? 'Son istekler yüklenemedi'))
      setRecentRequests([])
    } finally {
      setRecentLoading(false)
    }
  }

  const openRecentModal = () => {
    setRecentModalOpen(true)
    void loadRecentRequests()
  }

  // Diagram zoom and pan handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    if (!detailProduct?.explodedDiagramUrl) return
    e.preventDefault()
    setIsDragging(true)
    setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y })
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return
    setPan({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y })
  }

  const handleMouseUp = () => {
    setIsDragging(false)
  }

  const handleWheel = (e: React.WheelEvent) => {
    if (!detailProduct?.explodedDiagramUrl) return
    e.preventDefault()
    const zoomFactor = 0.1
    const nextZoom = e.deltaY < 0 ? zoom + zoomFactor : zoom - zoomFactor
    setZoom(Math.max(0.5, Math.min(4, Number(nextZoom.toFixed(2)))))
  }

  const resetZoomPan = () => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }

  const openImagePreview = (url: string, title: string) => {
    setImagePreviewTitle(title)
    setImagePreviewUrl(url)
    setImagePreviewZoom(1.6)
    setImagePreviewOpen(true)
  }

  // Columns definition for Products list
  const productColumns = useMemo<TableColumn<StockProductListItemDto>[]>(
    () => [
      {
        key: 'stockCode',
        label: 'Ürün Kartı',
        sortable: true,
        primary: true,
        render: (_, p) => {
          return (
            <div className="flex flex-col gap-1 w-full p-1 select-none">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-bold text-red-700 bg-red-50 border border-red-200/60 px-1.5 py-0.5 rounded font-mono">
                  {p.stockCode || '—'}
                </span>
                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0 border ${
                  p.stockStatus === 'out'      ? 'bg-rose-50 text-rose-700 border-rose-200' :
                  p.stockStatus === 'critical' ? 'bg-amber-50 text-amber-700 border-amber-200' :
                                                 'bg-emerald-50 text-emerald-700 border-emerald-200'
                }`}>
                  {p.stockStatus === 'out' ? 'Tükenen Var' : p.stockStatus === 'critical' ? 'Kritik' : 'Stok Tamam'}
                </span>
              </div>
              <div className="text-xs font-bold text-slate-800 leading-tight truncate max-w-[240px]" title={p.productName}>
                {p.productName}
              </div>
              <div className="flex items-center justify-between text-[10px] text-slate-400 mt-0.5">
                <span>Parça: <strong className="text-slate-600">{p.sparePartCount}</strong></span>
                {p.categoryName && <span className="text-[9px] bg-slate-100 text-slate-600 px-1.5 py-0.2 rounded font-medium truncate max-w-[120px]">{p.categoryName}</span>}
              </div>
            </div>
          )
        }
      }
    ],
    []
  )

  // Columns definition for Spare Parts table
  const partColumns = useMemo<TableColumn<StockSparePartListItemDto>[]>(
    () => [
      {
        key: 'name',
        label: 'Yedek Parça Tanımı',
        sortable: true,
        render: (_, part) => {
          return (
            <div className="flex items-center gap-3">
              {part.imageUrl ? (
                <button
                  type="button"
                  onClick={() => openImagePreview(part.imageUrl!, String(part.name))}
                  className="w-10 h-10 rounded-lg overflow-hidden border border-slate-100 flex-shrink-0 cursor-zoom-in hover:shadow-md transition-shadow bg-slate-50"
                  title="Görseli büyüt"
                >
                  <img src={part.imageUrl} alt="" className="w-10 h-10 object-contain" />
                </button>
              ) : (
                <div className="w-10 h-10 rounded-lg bg-slate-100 border border-slate-200/50 flex items-center justify-center flex-shrink-0 text-slate-400 text-sm">⚙</div>
              )}
              <div>
                <div className="font-bold text-slate-800 text-xs">{part.name}</div>
                <div className="text-[10px] text-slate-400 font-mono mt-0.5">{part.partNumber || '—'}</div>
              </div>
            </div>
          )
        }
      },
      {
        key: 'explodedViewPartNumber',
        label: 'Şema No',
        sortable: true,
        render: (v) => v ? <span className="font-mono text-xs font-bold text-blue-650 bg-blue-50 border border-blue-150 px-2 py-0.5 rounded-lg">#{v}</span> : <span className="text-slate-300">-</span>
      },
      {
        key: 'quantity',
        label: 'Stok Miktarı',
        sortable: true,
        render: (v) => <span className="text-xs font-extrabold text-slate-800">{Number(v ?? 0)}</span>
      },
      {
        key: 'minStockLevel',
        label: 'Kritik Seviye',
        sortable: true,
        render: (v) => <span className="text-xs font-semibold text-slate-500">{Number(v ?? 0)}</span>
      },
      {
        key: 'id',
        label: 'Stok Durumu / İstek',
        render: (_, part) => {
          const qty = part.quantity ?? 0
          const min = part.minStockLevel ?? 0
          const isOut = qty === 0
          const isCritical = !isOut && min > 0 && qty <= min
          return (
            <div className="flex items-center justify-between gap-4">
              <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold border ${
                isOut      ? 'bg-rose-50 text-rose-700 border-rose-250' :
                isCritical ? 'bg-amber-50 text-amber-700 border-amber-250' :
                             'bg-emerald-50 text-emerald-700 border-emerald-250'
              }`}>
                <span className={`w-1.5 h-1.5 rounded-full ${isOut ? 'bg-rose-500' : isCritical ? 'bg-amber-500' : 'bg-emerald-500'}`} />
                {isOut ? 'Tükendi' : isCritical ? 'Kritik Seviye' : 'Yeterli'}
              </span>
              {(isOut || isCritical) && (
                <button
                  type="button"
                  onClick={() => {
                    setOrderTarget(part)
                    setOrderQty(1)
                    setOrderModalOpen(true)
                  }}
                  className="px-2.5 py-1 bg-slate-900 text-white rounded-lg text-[10px] font-bold hover:bg-slate-850 active:scale-95 shadow-sm transition-all flex items-center gap-1 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" /> Talep Et
                </button>
              )}
            </div>
          )
        }
      }
    ],
    []
  )

  return (
    <div className="flex flex-col bg-slate-50 min-h-[100dvh]">
      {/* Premium Header */}
      <div className="bg-white border-b border-slate-200 px-6 py-4 flex flex-col md:flex-row md:items-center md:justify-between gap-4 flex-shrink-0 shadow-sm">
        <div>
          <div className="flex items-center gap-2 text-xxs text-slate-400 uppercase tracking-widest font-bold">
            <span>Envanter</span>
            <span>&rsaquo;</span>
            <span>Stok ve Montaj Yönetimi</span>
          </div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900 mt-1 flex items-center gap-2">
            Montaj ve Stok Entegrasyonu <span className="bg-red-50 text-red-700 text-[10px] font-extrabold px-2 py-0.5 rounded-lg border border-red-200">Gelişmiş Panel</span>
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={openRecentModal}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-700 hover:bg-slate-50 shadow-xs transition-colors cursor-pointer"
          >
            <Clock className="w-4 h-4 text-slate-500" /> Son İstekler
          </button>
          <button
            onClick={syncData}
            className="flex items-center gap-1.5 px-4 py-2 bg-red-650 text-white rounded-xl text-xs font-bold hover:bg-red-755 shadow-xs transition-colors cursor-pointer"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} /> Senkronize Et
          </button>
        </div>
      </div>

      {/* Modern Summary Stats Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 px-4 sm:px-6 py-4 flex-shrink-0 bg-slate-50">
        {[
          { l: 'Katalog Modelleri', v: summary.totalProducts, c: 'text-slate-900', bg: 'bg-white' },
          { l: 'Kayıtlı Yedek Parça', v: summary.totalSpareParts, c: 'text-slate-900', bg: 'bg-white' },
          { l: 'Kritik Stok Seviyesi', v: summary.criticalStock, c: 'text-amber-600', bg: 'bg-amber-500/5 border-amber-200' },
          { l: 'Tükenen Yedek Parça', v: summary.outOfStock, c: 'text-rose-600', bg: 'bg-rose-500/5 border-rose-200' }
        ].map((s, i) => (
          <div key={i} className={`rounded-2xl p-4 border border-slate-200/80 shadow-xs transition-all hover:shadow-md ${s.bg}`}>
            <div className={`text-xl font-extrabold ${s.c}`}>{s.v}</div>
            <div className="text-xxs uppercase tracking-wider font-semibold text-slate-400 mt-1">{s.l}</div>
          </div>
        ))}
      </div>

      {/* Main Workspace: Left (30%) + Right (70%) */}
      <div className="flex flex-col md:flex-row flex-1 overflow-hidden min-h-0 border-t border-slate-200/60">
        
        {/* Left Panel: 30% Width on Large Screens */}
        <div className={`w-full md:w-[32%] lg:w-[30%] md:flex-shrink-0 bg-white flex flex-col overflow-hidden border-b border-slate-200 md:border-b-0 md:border-r ${selectedId ? 'hidden md:flex' : 'flex flex-1'} md:flex`}>
          <div className="p-4 flex-shrink-0 border-b border-slate-100 space-y-3 bg-slate-50/50">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Katalog Modelleri</div>
                <div className="text-xxs text-slate-400 mt-0.5">
                  {isLoading ? 'Yükleniyor...' : `${totalCount} aktif model listeleniyor`}
                </div>
              </div>
            </div>
            
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
              <input
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Model adı veya kod ara..."
                className="w-full pl-9 pr-3 py-2.5 bg-white border border-slate-200 rounded-xl text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-red-650/10 focus:border-red-650 transition-all shadow-xs"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <select
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                className="px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs text-slate-700 focus:outline-none focus:border-red-650 transition-all cursor-pointer font-semibold shadow-xs"
              >
                <option value="">Tüm Kategoriler</option>
                {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>

              <select
                value={selectedStockStatus}
                onChange={(e) => setSelectedStockStatus(e.target.value)}
                className="px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs text-slate-700 focus:outline-none focus:border-red-650 transition-all cursor-pointer font-semibold shadow-xs"
              >
                <option value="">Stok Durumu</option>
                <option value="ok">Stok Tamam</option>
                <option value="critical">Kritik Stok</option>
                <option value="out">Tükenen Var</option>
              </select>
            </div>
          </div>
          
          <div className="flex-1 overflow-y-auto p-2 bg-white">
            {loadError && !isLoading && (
              <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-xl p-4 m-2 space-y-2">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0 text-rose-600" />
                  <span className="leading-relaxed font-semibold">{loadError}</span>
                </div>
                <button
                  type="button"
                  onClick={loadProducts}
                  className="text-xs font-bold text-rose-700 hover:text-rose-900 underline underline-offset-2"
                >
                  Tekrar Dene
                </button>
              </div>
            )}
            
            {!loadError && (
              <Table
                serverSide
                currentPage={page}
                totalCount={totalCount}
                onPageChange={setPage}
                columns={productColumns}
                data={products}
                showColumnFilters={false}
                onRowClick={(p) => setSelectedId(p.productId)}
                initialPageSize={pageSize}
                onPageSizeChange={(newSize) => {
                  setPageSize(newSize)
                  setPage(1)
                }}
                rowClassName={(p) => `cursor-pointer transition-all border-b border-slate-100 hover:bg-slate-50/50 ${p.productId === selectedId ? 'bg-red-50/30 border-l-4 border-l-red-650 font-bold' : ''}`}
              />
            )}
          </div>
        </div>

        {/* Right Panel: 70% Width Detail Workspace (Lazy Loaded) */}
        <div className={`flex-1 overflow-y-auto bg-slate-50 ${selectedId ? 'block' : 'hidden md:block'}`}>
          {selectedId && (
            <button
              type="button"
              onClick={() => setSelectedId(null)}
              className="md:hidden sticky top-0 z-10 w-full bg-white/95 backdrop-blur border-b border-slate-200 px-4 py-3 text-left text-xs font-bold text-slate-800"
            >
              ← Model listesine dön
            </button>
          )}
          
          {detailLoading ? (
            <div className="flex flex-col items-center justify-center h-full text-center py-24 bg-white/80">
              <RefreshCw className="w-8 h-8 animate-spin text-red-650 mb-3" />
              <div className="text-xs font-bold text-slate-800">Detaylar yükleniyor...</div>
              <div className="text-xxs text-slate-400 mt-1">Teknik patlak şema ve yedek parça verileri getiriliyor</div>
            </div>
          ) : detailError ? (
            <div className="flex flex-col items-center justify-center h-full text-center py-20 px-6">
              <AlertTriangle className="w-10 h-10 text-rose-600 mb-3" />
              <div className="text-xs font-bold text-rose-600">{detailError}</div>
              <button onClick={() => setSelectedId(selectedId)} className="mt-3 px-4 py-2 bg-slate-900 text-white rounded-xl text-xs font-semibold hover:bg-slate-800">Tekrar Dene</button>
            </div>
          ) : !detailProduct ? (
            <div className="flex flex-col items-center justify-center h-full text-center px-8 py-24 bg-slate-50">
              <div className="w-16 h-16 bg-slate-200/80 rounded-2xl flex items-center justify-center mb-4 text-2xl text-slate-400">⚙</div>
              <div className="text-sm font-bold text-slate-700">Model Seçilmedi</div>
              <div className="text-xs text-slate-400 mt-1 max-w-xs leading-relaxed">
                Sol taraftaki listeden bir model seçerek teknik patlak şemasını ve yedek parça envanter detaylarını görüntüleyin.
              </div>
            </div>
          ) : (
            <div className="space-y-6 pb-12">
              {/* Lazy Loaded Exploded diagram section */}
              <div className="bg-white p-5 border-b border-slate-200/80 shadow-xs">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <div className="w-1 h-5 bg-red-650 rounded-full" />
                    <div>
                      <h2 className="text-slate-900 font-extrabold text-sm tracking-tight">
                        {detailProduct.productName}
                      </h2>
                      <p className="text-[10px] text-slate-400 font-mono mt-0.5">Model Kodu: {detailProduct.stockCode || '—'} | Kategori: {detailProduct.categoryName}</p>
                    </div>
                  </div>
                  {detailProduct.explodedDiagramUrl && (
                    <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                      <Sparkles className="w-3 h-3" /> Şema Mevcut
                    </span>
                  )}
                </div>

                <div 
                  ref={containerRef}
                  className="relative bg-slate-950 border border-slate-800 rounded-2xl overflow-hidden shadow-inner flex items-center justify-center select-none" 
                  style={{ height: 420 }}
                  onWheel={handleWheel}
                >
                  {detailProduct.explodedDiagramUrl ? (
                    <div
                      className="absolute inset-0 flex items-center justify-center cursor-grab active:cursor-grabbing"
                      onMouseDown={handleMouseDown}
                      onMouseMove={handleMouseMove}
                      onMouseUp={handleMouseUp}
                      onMouseLeave={handleMouseUp}
                    >
                      <img
                        src={detailProduct.explodedDiagramUrl}
                        alt={`${detailProduct.productName} teknik patlak şeması`}
                        className="max-h-[95%] max-w-[95%] object-contain pointer-events-none transition-transform duration-75"
                        style={{
                          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`
                        }}
                      />
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center text-slate-500">
                      <div className="text-4xl mb-2 opacity-30">⚙</div>
                      <div className="text-xs font-bold text-slate-400">Teknik Patlak Şema Görseli Yok</div>
                      <div className="text-[10px] text-slate-500 mt-1">Bu modele ait şema yüklenmemiş</div>
                    </div>
                  )}

                  {detailProduct.explodedDiagramUrl && (
                    <>
                      {/* Drag instruction overlay */}
                      <div className="absolute bottom-3 left-3 bg-black/60 backdrop-blur-[2px] text-[9px] text-white px-2.5 py-1 rounded-lg border border-white/10 flex items-center gap-1.5 font-bold uppercase tracking-wider">
                        <Move className="w-3.5 h-3.5" /> Sürükleyerek İncele
                      </div>

                      {/* Interactive Zoom/Pan Controls */}
                      <div className="absolute top-3 right-3 flex flex-col gap-1.5 z-10">
                        <button
                          type="button"
                          onClick={() => setZoom(z => Math.min(4, z + 0.25))}
                          className="w-8 h-8 bg-white/95 border border-slate-200 rounded-lg text-slate-800 flex items-center justify-center hover:bg-white active:scale-95 shadow-sm transition-all cursor-pointer"
                          title="Yakınlaştır"
                        >
                          <ZoomIn className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setZoom(z => Math.max(0.5, z - 0.25))}
                          className="w-8 h-8 bg-white/95 border border-slate-200 rounded-lg text-slate-800 flex items-center justify-center hover:bg-white active:scale-95 shadow-sm transition-all cursor-pointer"
                          title="Uzaklaştır"
                        >
                          <ZoomOut className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={resetZoomPan}
                          className="w-8 h-8 bg-white/95 border border-slate-200 rounded-lg text-slate-800 flex items-center justify-center hover:bg-white active:scale-95 shadow-sm transition-all cursor-pointer"
                          title="Şemayı Sıfırla"
                        >
                          <RotateCcw className="w-4 h-4" />
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Spare parts lazy loaded table workspace */}
              <div className="px-6">
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                  <div className="px-5 py-4 flex items-center justify-between border-b border-slate-100 bg-slate-50/50">
                    <div>
                      <h3 className="font-extrabold text-slate-900 text-xs uppercase tracking-wider">Yedek Parça ve Stok Envanteri</h3>
                      <p className="text-[10px] text-slate-400 mt-0.5">Modele ait kayıtlı yedek parça ve anlık stok durumları</p>
                    </div>
                    <div className="flex items-center gap-3 text-[10px] font-bold text-slate-500">
                      <span className="flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" /> Yeterli
                      </span>
                      <span className="flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-amber-500 inline-block" /> Kritik
                      </span>
                      <span className="flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-rose-500 inline-block" /> Tükendi
                      </span>
                    </div>
                  </div>

                  {spareParts.length === 0 ? (
                    <div className="px-6 py-16 text-center text-xs font-semibold text-slate-400 bg-white">
                      Bu ürüne ait tanımlanmış veya eşleşmiş yedek parça bulunmuyor.
                    </div>
                  ) : (
                    <div className="p-4 bg-white">
                      <Table
                        columns={partColumns}
                        data={spareParts}
                        showColumnFilters={false}
                        pageSize={15}
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Exploded Diagram Full Screen Image Preview Modal */}
      {imagePreviewOpen && imagePreviewUrl ? (
        <div
          className="fixed inset-0 z-[9999] bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4"
          onMouseDown={() => setImagePreviewOpen(false)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="w-full max-w-[96vw] h-[92vh] bg-white rounded-2xl overflow-hidden shadow-2xl flex flex-col border border-slate-200"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <div className="text-xs font-extrabold text-slate-900 truncate pr-4">{imagePreviewTitle || 'Görsel'}</div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setImagePreviewZoom((z) => Math.max(0.5, Number((z - 0.25).toFixed(2))))}
                  className="w-8 h-8 rounded-lg border border-slate-200 text-slate-650 hover:bg-slate-50 inline-flex items-center justify-center cursor-pointer"
                  title="Uzaklaştır"
                >
                  <ZoomOut className="w-4 h-4" />
                </button>
                <div className="min-w-14 text-center text-xs font-bold text-slate-650">{Math.round(imagePreviewZoom * 100)}%</div>
                <button
                  type="button"
                  onClick={() => setImagePreviewZoom((z) => Math.min(5, Number((z + 0.25).toFixed(2))))}
                  className="w-8 h-8 rounded-lg border border-slate-200 text-slate-650 hover:bg-slate-50 inline-flex items-center justify-center cursor-pointer"
                  title="Yakınlaştır"
                >
                  <ZoomIn className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setImagePreviewZoom(1)}
                  className="w-8 h-8 rounded-lg border border-slate-200 text-slate-650 hover:bg-slate-50 inline-flex items-center justify-center cursor-pointer"
                  title="Sıfırla"
                >
                  <RotateCcw className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setImagePreviewOpen(false)}
                  className="w-8 h-8 rounded-lg border border-slate-200 text-slate-650 hover:bg-slate-50 flex items-center justify-center font-bold text-base cursor-pointer"
                  aria-label="Kapat"
                >
                  ×
                </button>
              </div>
            </div>
            <div className="bg-slate-950 flex-1 overflow-auto flex items-center justify-center p-6">
              <img
                src={imagePreviewUrl}
                alt=""
                className="max-h-full max-w-full object-contain pointer-events-none transition-all duration-75"
                style={{ width: `${imagePreviewZoom * 100}%` }}
              />
            </div>
          </div>
        </div>
      ) : null}

      {/* Spare Part Order / Request Modal */}
      {orderModalOpen && orderTarget ? (
        <div
          className="fixed inset-0 z-[9999] bg-slate-900/40 backdrop-blur-[2px] flex items-center justify-center p-4"
          onMouseDown={() => (!orderSaving ? setOrderModalOpen(false) : null)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="w-full max-w-md bg-white rounded-2xl overflow-hidden shadow-2xl border border-slate-150"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <div className="text-xs font-bold text-slate-900">Yedek Parça Sipariş Talebi</div>
              <button
                type="button"
                disabled={orderSaving}
                onClick={() => setOrderModalOpen(false)}
                className="w-8 h-8 rounded-lg border border-slate-200 text-slate-650 hover:bg-slate-50 disabled:opacity-50 font-bold text-base cursor-pointer"
                aria-label="Kapat"
              >
                ×
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div className="text-xs text-slate-650 leading-relaxed">
                <strong className="text-slate-900">{orderTarget.name}</strong> ({orderTarget.partNumber}) yedek parçası için merkez depodan tedarik talebi oluşturulacaktır.
              </div>
              <div className="space-y-1">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">İstenen Adet</div>
                <input
                  type="number"
                  min={1}
                  value={orderQty}
                  onChange={(e) => setOrderQty(Math.max(1, Number(e.target.value) || 1))}
                  className="w-full h-10 px-3 bg-white border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-red-650/10 focus:border-red-650"
                />
              </div>
              {orderError ? <div className="text-xs text-red-650 font-semibold">{orderError}</div> : null}
              
              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  disabled={orderSaving}
                  onClick={() => setOrderModalOpen(false)}
                  className="px-4 py-2 border border-slate-200 text-slate-700 bg-white rounded-xl text-xs font-bold hover:bg-slate-50 transition shadow-xs cursor-pointer"
                >
                  Vazgeç
                </button>
                <button
                  type="button"
                  disabled={orderSaving}
                  onClick={async () => {
                    try {
                      setOrderSaving(true)
                      setOrderError(null)
                      await createSparePartOrderRequest({
                        erpProductId: String(orderTarget.id),
                        stockCode: String(orderTarget.partNumber ?? ''),
                        partName: String(orderTarget.name ?? ''),
                        quantityRequested: Math.max(1, Number(orderQty) || 1),
                      })
                      setOrderModalOpen(false)
                    } catch (e: any) {
                      setOrderError(String(e?.message ?? 'Sipariş kaydedilemedi'))
                    } finally {
                      setOrderSaving(false)
                    }
                  }}
                  className="px-5 py-2 bg-red-650 hover:bg-red-755 text-white rounded-xl text-xs font-bold transition shadow-xs cursor-pointer disabled:opacity-60 flex items-center gap-1.5"
                >
                  {orderSaving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : null} Sipariş Talebi Gönder
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* Recent Spare Part Requests Modal */}
      {recentModalOpen ? (
        <div
          className="fixed inset-0 z-[9999] bg-slate-900/40 backdrop-blur-[2px] flex items-center justify-center p-4"
          onMouseDown={() => (!recentLoading ? setRecentModalOpen(false) : null)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="w-full max-w-3xl bg-white rounded-2xl overflow-hidden shadow-2xl border border-slate-150"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <div>
                <div className="text-xs font-extrabold text-slate-900">Son Sipariş Talepleri</div>
                <div className="text-[10px] text-slate-400 mt-0.5">Merkez depoya gönderilen yedek parça sipariş kayıtları</div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={loadRecentRequests}
                  disabled={recentLoading}
                  className="h-9 inline-flex items-center gap-1.5 px-3 rounded-lg border border-slate-200 text-slate-700 bg-white hover:bg-slate-50 disabled:opacity-50 text-xs font-semibold cursor-pointer"
                  title="Yenile"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${recentLoading ? 'animate-spin' : ''}`} /> Yenile
                </button>
                <button
                  type="button"
                  disabled={recentLoading}
                  onClick={() => setRecentModalOpen(false)}
                  className="w-8 h-8 rounded-lg border border-slate-200 text-slate-650 hover:bg-slate-50 disabled:opacity-50 font-bold text-base cursor-pointer"
                  aria-label="Kapat"
                >
                  ×
                </button>
              </div>
            </div>

            <div className="p-5">
              {recentError ? (
                <div className="mb-4 text-xs text-rose-600 font-semibold">{recentError}</div>
              ) : null}

              <div className="bg-slate-50 border border-slate-200 rounded-2xl overflow-hidden">
                <div className="max-h-[60vh] overflow-auto">
                  <table className="w-full text-xs mobile-stack">
                    <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 select-none">
                      <tr className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                        <th className="px-4 py-3 text-left">Teknisyen</th>
                        <th className="px-4 py-3 text-left">Yedek Parça</th>
                        <th className="px-4 py-3 text-left font-mono">Kod</th>
                        <th className="px-4 py-3 text-right">Miktar</th>
                        <th className="px-4 py-3 text-left">Durum</th>
                        <th className="px-4 py-3 text-left">Tarih</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-150 bg-white">
                      {recentLoading ? (
                        <tr>
                          <td colSpan={6} className="px-4 py-12 text-center text-slate-400">Veriler yükleniyor...</td>
                        </tr>
                      ) : recentRequests.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="px-4 py-12 text-center text-slate-400">Talep kaydı bulunamadı.</td>
                        </tr>
                      ) : (
                        recentRequests.map((r) => {
                          const isCompleted = String(r.status ?? '').toLowerCase() === 'completed'
                          const created = r.createdAt ? new Date(r.createdAt) : null
                          const createdText = created && !Number.isNaN(created.getTime())
                            ? created.toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' })
                            : String(r.createdAt ?? '')

                          return (
                            <tr key={r.id} className="hover:bg-slate-50/50 transition-colors">
                              <td data-label="Teknisyen" className="px-4 py-3 font-semibold text-slate-800">{r.technicianName || 'Teknisyen'}</td>
                              <td data-mobile-hide data-label="Yedek Parça" className="px-4 py-3 font-semibold text-slate-800">{r.partName}</td>
                              <td data-mobile-hide data-label="Kod" className="px-4 py-3 font-mono text-slate-500">{r.stockCode}</td>
                              <td data-label="Miktar" className="px-4 py-3 text-right font-bold text-slate-800">
                                {r.quantityRequested} <span className="text-[10px] text-slate-400 font-normal">adet</span>
                              </td>
                              <td data-label="Durum" className="px-4 py-3">
                                <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${
                                  isCompleted ? 'bg-emerald-50 text-emerald-700 border-emerald-250' : 'bg-amber-50 text-amber-700 border-amber-250'
                                }`}>
                                  {isCompleted ? <CheckCircle className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
                                  {isCompleted ? 'Tamamlandı' : 'Bekliyor'}
                                </span>
                              </td>
                              <td data-mobile-hide data-label="Tarih" className="px-4 py-3 text-slate-500 whitespace-nowrap">{createdText}</td>
                            </tr>
                          )
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
