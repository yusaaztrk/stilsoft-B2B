import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Info, Package, RefreshCw, Star, Image as ImageIcon } from 'lucide-react'
import { AppDataTable, type DataTableRowAction } from '../../components/data-table'
import type { ColumnDef } from '@tanstack/react-table'
import { MessageBanner, PageHeader, SHOP_API, SHOP_SITE, SummaryCards, authHeaders, formatPrice, input, label, usePanelMessage, useShopSummary, type AdminProduct, type ProductFilter, type ProductStats } from './shared'

export default function UrunYonetimiPage() {
  const { message, notify } = usePanelMessage()
  const { summary, loadSummary } = useShopSummary()
  const [products, setProducts] = useState<AdminProduct[]>([])
  const [featuredSlots, setFeaturedSlots] = useState(8)
  const [featuredSelected, setFeaturedSelected] = useState(0)
  const [search, setSearch] = useState('')
  const [productPage, setProductPage] = useState(0)
  const [productPageSize, setProductPageSize] = useState(25)
  const [productStats, setProductStats] = useState<ProductStats | null>(null)
  const [productFilter, setProductFilter] = useState<ProductFilter>('hepsi')
  const [productSelection, setProductSelection] = useState<Record<string, boolean>>({})
  const [bulkBusy, setBulkBusy] = useState(false)
  const [loading, setLoading] = useState(false)

  const loadProducts = useCallback(async (term: string) => {
    setLoading(true)
    try {
      const qs = term.trim() ? `?ara=${encodeURIComponent(term.trim())}` : ''
      const res = await fetch(`${SHOP_API}/api/admin/products${qs}`, { headers: authHeaders(false) })
      if (!res.ok) throw new Error()
      const data = await res.json()
      setProducts(data.items ?? [])
      // Anasayfada kaç kutu olduğu vitrin ayarından geliyor; işaretleme ekranında da
      // görünmesi gerekiyor ki bayi kaç ürün seçmesi gerektiğini bilsin.
      if (typeof data.featuredCount === 'number') setFeaturedSlots(data.featuredCount)
      if (typeof data.featuredSelected === 'number') setFeaturedSelected(data.featuredSelected)

      // Sayaçlar SUNUCUDAN geliyor, listeden sayılarak değil: liste aramayla süzülebiliyor
      // ve süzülmüş listede saymak "3 ürün kritik" gibi yanlış bir sayı verirdi.
      setProductStats({
        totalCount: Number(data.totalCount ?? 0),
        publishedCount: Number(data.publishedCount ?? 0),
        criticalCount: Number(data.criticalCount ?? 0),
        outOfStockCount: Number(data.outOfStockCount ?? 0),
        closedCount: Number(data.closedCount ?? 0),
        hiddenCount: Number(data.hiddenCount ?? 0),
        rules: {
          hideOutOfStock: Boolean(data.rules?.hideOutOfStock),
          stopPublishingBelowCriticalStock: Boolean(data.rules?.stopPublishingBelowCriticalStock),
          hideClosedToSale: Boolean(data.rules?.hideClosedToSale),
          allowOutOfStockOrders: Boolean(data.rules?.allowOutOfStockOrders),
          defaultThreshold: Number(data.rules?.defaultThreshold ?? 12)
        }
      })
    } catch {
      notify('err', 'Ürün listesi alınamadı.')
    } finally {
      setLoading(false)
    }
  }, [])

  const toggleProduct = async (product: AdminProduct) => {
    try {
      const res = await fetch(`${SHOP_API}/api/admin/products/${encodeURIComponent(product.stockCode)}/visibility`, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({ hidden: !product.isHidden })
      })
      if (!res.ok) throw new Error()

      // Yalnızca `isHidden`'ı yerelde düzeltmek yetmiyor: "Yayın Durumu" rozeti ve üstteki
      // sayaç kutuları (Vitrinde/Panelden Kapalı) `blockReason`/`productStats`'tan geliyor,
      // onlar sunucuda hesaplanıyor. Liste yenilenmezse buton rengi değişir ama "Yayında"
      // yazmaya devam eder — kardeş fonksiyonlar (toggleAlwaysPublish/toggleFeatured) zaten
      // listeyi yeniliyordu, bu ikisiyle tutarsızdı.
      await loadProducts(search)
      void loadSummary()
    } catch {
      notify('err', 'Ürün durumu değiştirilemedi.')
    }
  }

  const toggleFeatured = async (product: AdminProduct) => {
    const next = !product.featuredOrder
    try {
      const res = await fetch(`${SHOP_API}/api/admin/products/${encodeURIComponent(product.stockCode)}/featured`, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({ featured: next })
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        notify('err', body?.message ?? 'Öne çıkarma değiştirilemedi.')
        return
      }
      await loadProducts(search)
    } catch {
      notify('err', 'Öne çıkarma değiştirilemedi.')
    }
  }

  const toggleAlwaysPublish = async (product: AdminProduct) => {
    try {
      const res = await fetch(
        `${SHOP_API}/api/admin/products/${encodeURIComponent(product.stockCode)}/always-publish`,
        {
          method: 'PUT',
          headers: authHeaders(),
          body: JSON.stringify({ alwaysPublish: !product.alwaysPublish })
        }
      )
      if (!res.ok) throw new Error()

      // Liste yeniden çekiliyor: işaret yayın durumunu da değiştiriyor (rozet, sayaçlar),
      // tek satırı yerel olarak düzeltmek aynı kuralı ikinci kez yazmak olurdu.
      await loadProducts(search)
      notify('ok', product.alwaysPublish
        ? 'Ürün yeniden kritik stok kuralına tabi.'
        : 'Ürün kritik stokta da yayında kalacak.')
    } catch {
      notify('err', 'Kritik stok muafiyeti değiştirilemedi.')
    }
  }

  const selectedProductCodes = useMemo(
    () => Object.entries(productSelection).filter(([, on]) => on).map(([code]) => code),
    [productSelection]
  )

  const runBulkProductAction = async (action: string, label: string) => {
    if (selectedProductCodes.length === 0) return
    setBulkBusy(true)
    try {
      const res = await fetch(`${SHOP_API}/api/admin/products/bulk`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ stockCodes: selectedProductCodes, action })
      })
      const body = await res.json().catch(() => null)

      if (!res.ok) {
        notify('err', body?.message ?? 'Toplu işlem yapılamadı.')
        return
      }

      await loadProducts(search)
      setProductSelection({})

      if (body?.success) {
        notify('ok', `${label}: ${body.applied} ürün.`)
      } else {
        notify('err', `${label}: ${body?.applied ?? 0}/${body?.total ?? 0} ürün uygulandı. ${body?.message ?? ''}`)
      }
    } catch {
      notify('err', 'Toplu işlem yapılamadı.')
    } finally {
      setBulkBusy(false)
    }
  }

  const visibleProducts = useMemo(() => {
    switch (productFilter) {
      case 'yayinda':
        return products.filter((x) => x.isPublished)
      case 'kritik':
        return products.filter((x) => x.blockReason === 'CriticalStock')
      case 'stokYok':
        return products.filter((x) => x.blockReason === 'OutOfStock')
      case 'kapali':
        return products.filter((x) => x.blockReason === 'ClosedToSale')
      case 'elleKapali':
        return products.filter((x) => x.blockReason === 'Hidden')
      case 'oneCikan':
        return products.filter((x) => Boolean(x.featuredOrder))
      default:
        return products
    }
  }, [products, productFilter])

  const stockTone = (p: AdminProduct) => {
    if (p.stock <= 0) return 'bg-red-50 text-red-700 ring-red-200'
    if (p.criticalThreshold > 0 && p.stock < p.criticalThreshold) return 'bg-amber-50 text-amber-800 ring-amber-200'
    return 'bg-emerald-50 text-emerald-700 ring-emerald-200'
  }

  const blockTone = (reason: string) => {
    switch (reason) {
      case 'None': return 'bg-emerald-50 text-emerald-700 ring-emerald-200'
      case 'CriticalStock': return 'bg-amber-50 text-amber-800 ring-amber-200'
      case 'OutOfStock': return 'bg-red-50 text-red-700 ring-red-200'
      case 'ClosedToSale': return 'bg-slate-100 text-slate-600 ring-slate-200'
      default: return 'bg-gray-100 text-gray-600 ring-gray-200'
    }
  }

  const productColumns = useMemo<ColumnDef<AdminProduct, any>[]>(() => [
    {
      id: 'gorsel',
      header: '',
      enableSorting: false,
      meta: { width: '58px' },
      cell: ({ row }) => (
        // Görsel olmadan 245 satırlık listede ürün ayırt etmek okuma değil arama işi olur.
        // Yayın kuralı zaten görseli olmayan ürünü listeye hiç almıyor.
        <div className="w-11 h-11 rounded-lg bg-gray-50 border border-gray-200 overflow-hidden flex items-center justify-center">
          {row.original.imageUrl ? (
            <img
              src={row.original.imageUrl}
              alt=""
              className="w-full h-full object-contain"
              loading="lazy"
            />
          ) : (
            <ImageIcon size={15} className="text-gray-300" />
          )}
        </div>
      )
    },
    {
      accessorKey: 'name',
      header: 'Ürün',
      meta: { filterType: 'text' },
      cell: ({ row }) => (
        <div className="min-w-[220px]">
          <div className="font-semibold text-gray-900">{row.original.name}</div>
          <div className="text-[11px] text-gray-500 flex items-center gap-2">
            <span className="font-mono">{row.original.stockCode}</span>
            {row.original.categoryName && <span>· {row.original.categoryName}</span>}
          </div>
        </div>
      )
    },
    {
      accessorKey: 'categoryName',
      header: 'Kategori',
      meta: { filterType: 'select', width: '150px' },
      cell: ({ getValue }) => <span className="text-gray-600">{String(getValue() ?? '-')}</span>
    },
    {
      accessorKey: 'grossPrice',
      header: 'Fiyat',
      meta: { filterType: 'number', width: '130px' },
      cell: ({ row }) => (
        <span className="tabular-nums font-semibold">
          {formatPrice(row.original.grossPrice, row.original.currency)}
        </span>
      )
    },
    {
      accessorKey: 'stock',
      header: 'Stok',
      meta: { filterType: 'number', width: '120px' },
      cell: ({ row }) => (
        <div className="flex flex-col gap-0.5">
          <span
            className={`inline-flex w-fit items-center px-2 py-0.5 rounded-full text-xs font-bold ring-1 tabular-nums ${stockTone(row.original)}`}
          >
            {row.original.stock}
          </span>
          {/* Eşiği de yazıyoruz: "kritik stok" demek yetmez, bayi eşiğin kaç olduğunu
              görmeden ne yapacağına karar veremez. Eşik ERP ürün kartından yönetiliyor. */}
          <span className="text-[10px] text-gray-400">
            {row.original.criticalThreshold > 0 ? `eşik ${row.original.criticalThreshold}` : 'eşik yok'}
          </span>
        </div>
      )
    },
    {
      id: 'durum',
      accessorFn: (row) => row.blockLabel,
      header: 'Yayın Durumu',
      meta: { filterType: 'select', width: '190px' },
      cell: ({ row }) => (
        <div className="flex flex-col gap-1">
          <span
            className={`inline-flex w-fit items-center px-2.5 py-1 rounded-full text-[11px] font-bold ring-1 ${blockTone(row.original.blockReason)}`}
          >
            {row.original.blockLabel}
          </span>
          {row.original.alwaysPublish && (
            <span className="text-[10px] text-blue-600 font-semibold">Kritik stok muafiyeti açık</span>
          )}
        </div>
      )
    },
    {
      id: 'vitrin',
      accessorFn: (row) => (row.isHidden ? 'Kapalı' : 'Açık'),
      header: 'Panel Anahtarı',
      meta: { filterType: 'select', width: '120px' },
      cell: ({ row }) => (
        <button
          type="button"
          title={
            row.original.isHidden
              ? 'Panelden kapatıldı — açmak için tıkla'
              : 'Panelden açık. Ürün yine de stok kuralına takılabilir.'
          }
          onClick={(e) => { e.stopPropagation(); void toggleProduct(row.original) }}
          className={`px-3 py-1.5 rounded-full text-xs font-bold border transition ${
            row.original.isHidden
              ? 'bg-gray-100 border-gray-200 text-gray-500 hover:bg-gray-200'
              : 'bg-green-50 border-green-200 text-green-700 hover:bg-green-100'
          }`}
        >
          {row.original.isHidden ? 'Kapalı' : 'Açık'}
        </button>
      )
    },
    {
      id: 'kritikMuaf',
      accessorFn: (row) => (row.alwaysPublish ? 'Muaf' : 'Kurala tabi'),
      header: 'Kritik Muafiyet',
      meta: { filterType: 'select', width: '135px' },
      cell: ({ row }) => {
        // Eşiği 0 olan üründe kural zaten işlemiyor: muafiyet düğmesi anlamsız olurdu.
        const relevant = row.original.criticalThreshold > 0
        return (
          <button
            type="button"
            disabled={!relevant}
            title={
              !relevant
                ? 'Bu üründe satışa kapanma eşiği yok, kural zaten işlemiyor.'
                : row.original.alwaysPublish
                  ? 'Kritik stokta da yayında kalıyor — kurala geri döndürmek için tıkla'
                  : 'Stok eşiğin altına düşse bile yayında kalsın'
            }
            onClick={(e) => { e.stopPropagation(); void toggleAlwaysPublish(row.original) }}
            className={`px-3 py-1.5 rounded-full text-xs font-bold border transition ${
              !relevant
                ? 'bg-gray-50 border-gray-200 text-gray-300 cursor-not-allowed'
                : row.original.alwaysPublish
                  ? 'bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100'
                  : 'bg-white border-gray-200 text-gray-400 hover:bg-gray-100 hover:text-gray-600'
            }`}
          >
            {row.original.alwaysPublish ? 'Muaf' : 'Kurala tabi'}
          </button>
        )
      }
    },
    {
      id: 'montaj',
      accessorFn: (row) =>
        !row.isInstallable ? 'Yok' : (row.installationFee ?? 0) > 0 ? 'Ücretli' : 'Ücretsiz',
      header: 'Montaj',
      meta: { filterType: 'select', width: '120px' },
      cell: ({ row }) => {
        if (!row.original.isInstallable) return <span className="text-gray-400 text-xs">—</span>
        const fee = Number(row.original.installationFee ?? 0)
        return (
          <span className="text-xs font-semibold text-gray-700">
            {fee > 0 ? formatPrice(fee, row.original.currency) : 'Ücretsiz'}
          </span>
        )
      }
    },
    {
      id: 'oneCikan',
      accessorFn: (row) => (row.featuredOrder ? `${row.featuredOrder}. sıra` : 'Hayır'),
      header: 'Öne Çıkan',
      meta: { filterType: 'select', width: '120px' },
      cell: ({ row }) => (
        // Vitrinde görünmeyen bir ürünü öne çıkarmak anlamsız: anasayfada zaten çıkmayacak.
        <button
          type="button"
          disabled={!row.original.isPublished}
          title={
            !row.original.isPublished
              ? `Vitrinde görünmüyor (${row.original.blockLabel}) — anasayfada gösterilemez.`
              : row.original.featuredOrder
                ? `Anasayfada ${row.original.featuredOrder}. sırada`
                : 'Anasayfada öne çıkar'
          }
          onClick={(e) => { e.stopPropagation(); void toggleFeatured(row.original) }}
          className={`px-3 py-1.5 rounded-full text-xs font-bold border transition inline-flex items-center gap-1.5 ${
            !row.original.isPublished
              ? 'bg-gray-50 border-gray-200 text-gray-300 cursor-not-allowed'
              : row.original.featuredOrder
                ? 'bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100'
                : 'bg-white border-gray-200 text-gray-400 hover:bg-gray-100 hover:text-gray-600'
          }`}
        >
          <Star size={13} className={row.original.featuredOrder ? 'fill-amber-400 text-amber-500' : ''} />
          {row.original.featuredOrder ? `${row.original.featuredOrder}.` : 'Ekle'}
        </button>
      )
    }
  ], [toggleProduct, toggleFeatured, toggleAlwaysPublish])

  useEffect(() => { void loadProducts('') }, [loadProducts])

  return (
    <div className="p-4 lg:p-6">
      <PageHeader title="Ürün Yönetimi" desc="Hangi ürün vitrinde, hangisi neden değil; stok, kritik eşik ve öne çıkanlar." right={<SummaryCards summary={summary} />} />
      <MessageBanner message={message} />

      {(
        <div>
          {/* ---- Arama ve yenileme ---- */}
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <input
              className="h-11 px-4 rounded-2xl border border-gray-200 bg-white text-sm font-semibold w-full sm:w-80"
              placeholder="Ürün adı, stok kodu veya barkod"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void loadProducts(search)
              }}
            />
            <button
              type="button"
              onClick={() => void loadProducts(search)}
              className="h-11 px-5 rounded-2xl bg-gray-900 text-white text-sm font-semibold hover:bg-black inline-flex items-center gap-2"
            >
              <RefreshCw size={15} />
              Ara
            </button>
            {search.trim() && (
              <button
                type="button"
                onClick={() => { setSearch(''); void loadProducts('') }}
                className="h-11 px-4 rounded-2xl border border-gray-200 bg-white text-sm font-semibold text-gray-600 hover:bg-gray-50"
              >
                Aramayı temizle
              </button>
            )}
          </div>

          {/*
            DURUM SAYAÇLARI — hem özet hem süzgeç.
            Kullanıcının bugüne kadar hiçbir yerden göremediği bilgi buydu: hangi ürün neden
            vitrinde değil. Kutuya tıklayınca liste o duruma süzülüyor; ikinci tıklama süzgeci
            kaldırıyor (ayrı bir "temizle" düğmesi aramak zorunda kalmasın).
          */}
          {productStats && (
            <div className="grid grid-cols-2 lg:grid-cols-6 gap-3 mb-4">
              {([
                { key: 'hepsi', label: 'Toplam ürün', value: productStats.totalCount, tone: 'border-gray-200 bg-white text-gray-900' },
                { key: 'yayinda', label: 'Vitrinde', value: productStats.publishedCount, tone: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
                { key: 'kritik', label: 'Kritik stok', value: productStats.criticalCount, tone: 'border-amber-200 bg-amber-50 text-amber-700' },
                { key: 'stokYok', label: 'Stok bitti', value: productStats.outOfStockCount, tone: 'border-red-200 bg-red-50 text-red-700' },
                { key: 'kapali', label: 'Satışa kapalı', value: productStats.closedCount, tone: 'border-slate-200 bg-slate-50 text-slate-700' },
                { key: 'elleKapali', label: 'Panelden kapalı', value: productStats.hiddenCount, tone: 'border-gray-200 bg-gray-50 text-gray-700' }
              ] as { key: ProductFilter; label: string; value: number; tone: string }[]).map((box) => (
                <button
                  key={box.key}
                  type="button"
                  onClick={() => {
                    setProductFilter((prev) => (prev === box.key ? 'hepsi' : box.key))
                    setProductPage(0)
                  }}
                  className={`text-left rounded-2xl border px-4 py-3 transition ${box.tone} ${
                    productFilter === box.key ? 'ring-2 ring-gray-900/70' : 'hover:brightness-[0.98]'
                  }`}
                >
                  <div className="text-[10px] font-bold uppercase tracking-wider opacity-70">{box.label}</div>
                  <div className="text-xl font-black mt-0.5 tabular-nums">{box.value}</div>
                </button>
              ))}
            </div>
          )}

          {/*
            KURALLARIN O ANKİ HÂLİ.
            Rozetler kural kapalıyken de görünseydi kullanıcı "kritik stok" yazan ürünün neden
            hâlâ vitrinde olduğunu anlayamazdı. Kuralların anahtarı Vitrin Yönetimi'nde.
          */}
          {productStats && (
            <div className="mb-4 rounded-2xl border border-blue-100 bg-blue-50/60 px-4 py-3 text-[12px] text-blue-900 leading-relaxed">
              <div className="flex items-start gap-2">
                <Info size={15} className="mt-0.5 shrink-0" />
                <div>
                  <b>Yayın kuralı:</b> ürün aktif olacak, görseli bulunacak ve katalog fiyat
                  grubunda fiyatı olacak. Buna ek olarak{' '}
                  {productStats.rules.hideOutOfStock
                    ? <b>stoğu biten ürünler vitrinden kalkıyor</b>
                    : <span>stoğu biten ürünler vitrinde kalıyor</span>}
                  {' · '}
                  {productStats.rules.stopPublishingBelowCriticalStock
                    ? (
                      <b>
                        stok, ürün kartındaki <i>Satışa Kapanma Eşiği</i>nin altına düşünce
                        yayın otomatik duruyor
                      </b>
                    )
                    : <span>kritik stok kuralı kapalı</span>}
                  {' · '}
                  {productStats.rules.hideClosedToSale
                    ? <b>“Satışa Açık: Hayır” işaretli ürünler vitrinde görünmüyor</b>
                    : <span>satışa kapalı işaretli ürünler vitrinde kalıyor</span>}
                  . Eşik girilmemiş üründe varsayılan{' '}
                  <b>{productStats.rules.defaultThreshold}</b>, 0 yazılan üründe eşik uygulanmıyor.
                  Stok toparlayınca ürün <b>kendiliğinden</b> geri yayına giriyor.
                  {productStats.rules.allowOutOfStockOrders && productStats.rules.hideOutOfStock && (
                    <span className="block mt-1 text-amber-800">
                      <AlertTriangle size={12} className="inline mr-1 -mt-0.5" />
                      Dikkat: “stoksuz sipariş” açık ama “stoğu biteni gizle” de açık. Ürün
                      listede olmadığı için stoksuz sipariş verilebilecek bir yer kalmıyor —
                      ikisinden biri kapatılmalı (Vitrin Yönetimi).
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ---- Toplu işlem çubuğu ---- */}
          {selectedProductCodes.length > 0 && (
            <div className="mb-4 rounded-2xl border border-gray-900 bg-gray-900 text-white px-4 py-3 flex flex-wrap items-center gap-2">
              <span className="text-sm font-bold mr-2">
                {selectedProductCodes.length} ürün seçildi
              </span>

              {([
                { action: 'yayinaAl', label: 'Yayına al' },
                { action: 'yayindanKaldir', label: 'Yayından kaldır' },
                { action: 'oneCikar', label: 'Öne çıkar' },
                { action: 'oneCikarmaKaldir', label: 'Öne çıkarmayı kaldır' },
                { action: 'kritikMuaf', label: 'Kritik stokta yayında kalsın' },
                { action: 'kritikMuafKaldir', label: 'Muafiyeti kaldır' }
              ]).map((b) => (
                <button
                  key={b.action}
                  type="button"
                  disabled={bulkBusy}
                  onClick={() => void runBulkProductAction(b.action, b.label)}
                  className="h-9 px-3 rounded-xl bg-white/10 hover:bg-white/20 disabled:opacity-50 text-xs font-semibold"
                >
                  {b.label}
                </button>
              ))}

              <button
                type="button"
                onClick={() => setProductSelection({})}
                className="h-9 px-3 rounded-xl text-xs font-semibold text-white/70 hover:text-white ml-auto"
              >
                Seçimi temizle
              </button>
            </div>
          )}

          <AppDataTable<AdminProduct>
            data={visibleProducts}
            columns={productColumns}
            rowId={(row) => row.stockCode}
            onRefresh={() => void loadProducts(search)}
            selection={{
              selectedRowIds: productSelection,
              onSelectionChange: setProductSelection
            }}
            rowActions={(row) => {
              const actions: DataTableRowAction<AdminProduct>[] = [
                {
                  key: 'kod',
                  label: 'Stok kodunu kopyala',
                  onClick: () => {
                    // Ürün Yönetimi sayfası adres çubuğundan arama almıyor; kodu panoya
                    // koymak, kullanıcıyı elle yazmaktan kurtaran en kısa yol.
                    void navigator.clipboard?.writeText(row.stockCode)
                      .then(() => notify('ok', `${row.stockCode} kopyalandı.`))
                      .catch(() => notify('err', 'Kopyalanamadı.'))
                  }
                },
                {
                  key: 'erp',
                  label: "ERP Ürün Yönetimi'ni aç",
                  onClick: () => {
                    // Fiyat, stok ve satışa kapanma eşiği ERP'nin verisi; buradan
                    // değiştirilmiyor, ürün kartına gönderiliyor. Aynı alanı iki ekrandan
                    // yazılabilir yapmak, hangi değerin doğru olduğunu belirsizleştirirdi.
                    window.open('/urunYonetimi', '_blank')
                  }
                }
              ]

              if (SHOP_SITE && row.isPublished) {
                actions.push({
                  key: 'vitrin',
                  label: 'Vitrinde gör',
                  onClick: () => window.open(`${SHOP_SITE}/urun/${row.slug}`, '_blank')
                })
              }

              return actions
            }}
            states={{
              loading,
              emptyTitle:
                productFilter === 'hepsi'
                  ? 'Yayın kuralına uyan ürün bulunamadı.'
                  : 'Bu durumda ürün yok.',
              emptyDescription:
                productFilter === 'hepsi'
                  ? 'Ürünün listeye girmesi için aktif olması, görseli bulunması ve katalog fiyat grubunda fiyatı olması gerekiyor.'
                  : 'Üstteki kutuya tekrar tıklayarak süzgeci kaldırabilirsin.'
            }}
            showExcelExport
            excelFileName="eticaret-urun-yonetimi"
            pagination={{
              pageIndex: productPage,
              pageSize: productPageSize,
              totalCount: visibleProducts.length,
              pageCount: Math.max(1, Math.ceil(visibleProducts.length / productPageSize)),
              onPageChange: setProductPage,
              onPageSizeChange: setProductPageSize
            }}
          />

          <div className="text-[11px] text-gray-500 mt-3 leading-relaxed">
            <b className="text-gray-600">Panel anahtarı:</b> ürünü elle kapatır. Kapalı ürün
            hiçbir kurala bakılmadan vitrinden çıkar.
            <br />
            <b className="text-gray-600">Kritik muafiyet:</b> stok eşiğin altına düşse bile ürün
            yayında kalır. Stoğu <b>sıfır</b> olan ürünü yayına döndürmez.
            <br />
            <b className="text-gray-600">Fiyat, stok ve eşik buradan değiştirilmez</b> — hepsi
            ERP ürün kartının verisi. Satır menüsündeki “ERP ürün kartını aç” ile düzenlenir,
            değişiklik anında vitrine yansır.
            <br />
            <b className="text-gray-600">Öne çıkan:</b> anasayfadaki “Öne çıkan ürünler”
            bölümünde gösterilecek ürünler ve sıraları. İşaretleme sırası anasayfadaki sıradır.
            Anasayfada <b className="text-gray-600">{featuredSlots}</b> kutu var
            {featuredSelected > 0 && <> — şu an {featuredSelected} ürün seçili</>}
            {featuredSelected < featuredSlots && (
              <>; kalan kutular en son eklenen ürünlerle doldurulur.</>
            )}
            {featuredSelected > featuredSlots && (
              <>
                ; ilk {featuredSlots} tanesi gösterilir. Kutu sayısını{' '}
                <b className="text-gray-600">Vitrin Yönetimi</b> sekmesinden değiştirebilirsin.
              </>
            )}
          </div>
        </div>
      )}

    </div>
  )
}
