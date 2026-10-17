import React, { useMemo, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import Modal from '../components/Modal'
import Table, { type TableColumn } from '../components/Table'
import FormInput from '../components/forms/FormInput'
import FormSelect from '../components/forms/FormSelect'
import { fetchProducts } from '../api/products'
import { useProductCategories } from '../hooks/useProductCategories'
import { fetchStockMovementReport, type StockMovementReportMovementItem, type StockMovementReportSummaryItem } from '../api/stockMovements'
import { fetchProductPricesByProducts, type ProductPriceResponse } from '../api/productPrices'
import { fetchPriceGroups, type PriceGroupDto } from '../api/priceGroups'

function trimId(value: any) {
  return String(value ?? '').trim()
}

function isAbortError(e: any) {
  if (!e) return false
  const name = String(e?.name ?? '')
  const msg = String(e?.message ?? '')
  return name === 'AbortError' || msg.toLowerCase().includes('aborted')
}

function formatMoney(n: number) {
  const v = Number(n ?? 0)
  return `₺${v.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function formatQty(n: number) {
  const v = Number(n ?? 0)
  return v.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function yyyyMmDd(d: string) {
  return String(d ?? '').slice(0, 10)
}

type PickedProduct = { id: string; stockCode: string; name: string }

type MovementRow = StockMovementReportMovementItem & {
  directionLabel: string
  warehouseLabel: string
  inQty: string
  outQty: string
  belgeTuru: string
  cariLabel: string
  descriptionText: string
}

export default function StokHareketDokumuPage() {
  const f4GroupRankRef = useRef<Record<string, number> | null>(null)
  const f4GroupIdsRef = useRef<Set<string> | null>(null)

  const ensureF4Groups = async () => {
    if (f4GroupIdsRef.current !== null) return
    try {
      const groups: PriceGroupDto[] = await fetchPriceGroups({ includeInactive: false })
      const rank: Record<string, number> = {}
      const ids = new Set<string>()
      groups.forEach((g) => {
        const code = Number(g.code ?? -1)
        const name = String(g.name ?? '')
        const formula = String(g.formula ?? '')
        const isF4 =
          code === 4 ||
          name.startsWith('4') ||
          formula.toUpperCase().startsWith('F4')
        if (!isF4) return
        const id = trimId(g.id)
        if (!id) return
        ids.add(id)
        ids.add(id.toLowerCase())
        let r = 10
        if (name.includes('60')) r = 1
        else if (name.includes('30')) r = 2
        else if (code === 4) r = 3
        rank[id] = r
        rank[id.toLowerCase()] = r
      })
      f4GroupRankRef.current = rank
      f4GroupIdsRef.current = ids
    } catch {
      f4GroupRankRef.current = {}
      f4GroupIdsRef.current = new Set()
    }
  }

  const fetchF4PriceMapForProductIds = async (ids: string[]): Promise<Record<string, { price: number; currency: string }>> => {
    if (ids.length === 0) return {}
    await ensureF4Groups()
    const f4Ids = f4GroupIdsRef.current ?? new Set<string>()
    const rank = f4GroupRankRef.current ?? {}
    try {
      const prices: ProductPriceResponse[] = await fetchProductPricesByProducts(ids)
      const best: Record<string, { price: number; currency: string; rank: number }> = {}
      prices.forEach((pp) => {
        const pgId = trimId(pp.priceGroupId)
        if (!f4Ids.has(pgId) && !f4Ids.has(pgId.toLowerCase())) return
        const prodId = trimId(pp.productId)
        if (!prodId) return
        const r = rank[pgId] ?? rank[pgId.toLowerCase()] ?? 99
        const existing = best[prodId]
        if (!existing || r < existing.rank) {
          best[prodId] = { price: Number(pp.price ?? 0), currency: String(pp.currency ?? ''), rank: r }
          best[prodId.toLowerCase()] = best[prodId]
        }
      })
      const map: Record<string, { price: number; currency: string }> = {}
      Object.entries(best).forEach(([k, v]) => { map[k] = { price: v.price, currency: v.currency } })
      return map
    } catch {
      return {}
    }
  }

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [from, setFrom] = useState(() => new Date().toISOString().slice(0, 10))
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10))

  const [picked, setPicked] = useState<PickedProduct | null>(null)

  const [summary, setSummary] = useState<StockMovementReportSummaryItem[]>([])
  const [movements, setMovements] = useState<StockMovementReportMovementItem[]>([])
  const totals = useMemo(() => {
    const totalIn = summary.reduce((a, x) => a + Number(x.totalIn ?? 0), 0)
    const totalOut = summary.reduce((a, x) => a + Number(x.totalOut ?? 0), 0)
    const balance = summary.reduce((a, x) => a + Number(x.balance ?? 0), 0)
    return { totalIn, totalOut, balance }
  }, [summary])

  const normalizeDirection = (direction: any) => {
    if (direction == null) return ''
    if (typeof direction === 'number') return String.fromCharCode(direction)
    const raw = String(direction)
    if (/^\d+$/.test(raw)) return String.fromCharCode(Number(raw))
    return raw
  }

  const dirToInOut = (direction: any, qty: number) => {
    const d = normalizeDirection(direction)
    if (d === 'In' || d === 'G') return { inQty: qty, outQty: 0 }
    if (d === 'Out' || d === 'C') return { inQty: 0, outQty: qty }
    return { inQty: 0, outQty: 0 }
  }

  const movementRows = useMemo<MovementRow[]>(
    () =>
      movements.map((m) => {
        const qty = Number(m.quantity ?? 0)
        const { inQty, outQty } = dirToInOut((m as any).direction, qty)
        const directionLabel = (() => {
          const d = normalizeDirection((m as any).direction)
          if (d === 'In' || d === 'G') return 'Giriş'
          if (d === 'Out' || d === 'C') return 'Çıkış'
          return d
        })()

        return {
          ...m,
          directionLabel,
          warehouseLabel: `${m.warehouseCode} ${String(m.warehouseName ?? '').trim()}`.trim(),
          inQty: inQty ? formatQty(inQty) : '',
          outQty: outQty ? formatQty(outQty) : '',
          belgeTuru: String(m.invoiceNo ?? '').toLowerCase().includes('devir') ? 'Devir' : 'Belge',
          // Cari: kodun yanında adı da (sunucu müşteri/tedarikçi kartından çözer).
          cariLabel: `${String(m.customerCode ?? '').trim()} ${String(m.customerName ?? '').trim()}`.trim(),
          descriptionText: `${String(m.customerCode ?? '').trim()} ${String(m.deliveryCustomerCode ?? '').trim()} ${String(m.deliveryCustomerName ?? '').trim()} ${String(m.bagNo ?? '').trim()}`
            .replace(/\s+/g, ' ')
            .trim()
        }
      }),
    [movements]
  )

  const movementColumns = useMemo<TableColumn<MovementRow>[]>(
    () => [
      { key: 'date', label: 'Tarih', searchable: true, filter: { type: 'date' }, render: (v) => yyyyMmDd(String(v ?? '')) },
      { key: 'invoiceNo', label: 'Fiş No', searchable: true },
      { key: 'cariLabel', label: 'Cari', searchable: true, render: (v) => String(v ?? '') },
      {
        key: 'belgeTuru',
        label: 'Belge Türü',
        searchable: true,
        filter: {
          type: 'select',
          options: [
            { label: 'Devir', value: 'Devir' },
            { label: 'Belge', value: 'Belge' }
          ]
        },
        render: (v) => String(v ?? '')
      },
      {
        key: 'warehouseLabel',
        label: 'Depo',
        searchable: true,
        render: (v) => String(v ?? '')
      },
      {
        key: 'directionLabel',
        label: 'Yön',
        searchable: true,
        filter: {
          type: 'select',
          options: [
            { label: 'Giriş', value: 'Giriş' },
            { label: 'Çıkış', value: 'Çıkış' }
          ]
        },
        render: (v) => String(v ?? '')
      },
      {
        key: 'inQty',
        label: 'Giriş',
        render: (v) => String(v ?? '')
      },
      {
        key: 'outQty',
        label: 'Çıkış',
        render: (v) => String(v ?? '')
      },
      {
        key: 'netUnitPrice',
        label: 'Fiyat',
        render: (v, row) => formatMoney(Number(v ?? row.unitPrice ?? 0))
      },
      {
        key: 'descriptionText',
        label: 'Açıklama',
        searchable: true,
        render: (v) => String(v ?? '')
      }
    ],
    []
  )

  // Product picker
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerLoading, setPickerLoading] = useState(false)
  const [pickerError, setPickerError] = useState<string | null>(null)
  const [pickerQuery, setPickerQuery] = useState('')
  const [pickerItems, setPickerItems] = useState<any[]>([])

  const { data: categoriesState } = useProductCategories({ includeDealer: false })
  const [pickerMainCat, setPickerMainCat] = useState('')
  const [pickerSubCat, setPickerSubCat] = useState('')

  const searchProducts = async (q: string, filters?: { main?: string; sub?: string }) => {
    try {
      setPickerLoading(true)
      setPickerError(null)

      const main = filters?.main !== undefined ? filters.main : pickerMainCat
      const sub = filters?.sub !== undefined ? filters.sub : pickerSubCat

      const res = await fetchProducts({
        q,
        main: main || undefined,
        sub: sub || undefined,
        page: 1,
        pageSize: 50,
        includeDealer: false,
        includeInactive: false
      })

      const items = (res.items ?? []) as any[]
      const productIds = items.map((p) => trimId((p as any)?.id)).filter(Boolean)
      const f4Map = await fetchF4PriceMapForProductIds(productIds)
      setPickerItems(
        items.map((p) => {
          const rawId = trimId((p as any)?.id)
          const f4 = rawId ? f4Map[rawId] ?? f4Map[rawId.toLowerCase()] : undefined
          return { ...p, __basePrice: f4?.price ?? null, __baseCurrency: f4?.currency ?? '' }
        })
      )
    } catch (e: any) {
      setPickerItems([])
      setPickerError(String(e?.message ?? 'Ürünler alınamadı'))
    } finally {
      setPickerLoading(false)
    }
  }

  const selectProduct = (p: any) => {
    const prod = {
      id: String(p?.id ?? ''),
      stockCode: String(p?.stockCode ?? ''),
      name: String(p?.name ?? '')
    }
    if (!prod.stockCode) return
    setPicked(prod)
    setPickerOpen(false)
  }

  const loadReport = async (signal?: AbortSignal) => {
    try {
      if (!picked?.stockCode) return

      setLoading(true)
      setError(null)

      const data = await fetchStockMovementReport(
        {
          stockCode: picked.stockCode,
          from: from || null,
          to: to || null
        },
        { signal }
      )

      setSummary((data.summary ?? []) as any)
      setMovements((data.movements ?? []) as any)
    } catch (e: any) {
      if (isAbortError(e)) return
      setSummary([])
      setMovements([])
      setError(String(e?.message ?? 'Stok hareket raporu alınamadı'))
    } finally {
      setLoading(false)
    }
  }

  const onRun = () => {
    const ac = new AbortController()
    void loadReport(ac.signal)
  }

  return (
    <div className="p-6 bg-slate-50/30 min-h-[calc(100vh-64px)]">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-800 tracking-tight flex items-center gap-2.5">
            <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-slate-100 border border-slate-200 text-slate-700 shadow-sm">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>
            </span>
            Stok Hareket Kayıtları
          </h1>
          <p className="text-[11px] font-semibold text-slate-400 mt-1 ml-10.5">Stok İşlemleri / Hareket Dökümü</p>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-6 mb-6">
        {/* Left: Filter Panel */}
        <div className="col-span-12 lg:col-span-6">
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden h-full">
            <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
              <h2 className="text-xs font-bold text-slate-600 uppercase tracking-wider flex items-center gap-2">
                Stok Seçimi & Filtre
              </h2>
            </div>
            <div className="p-5">
              <div className="flex items-end gap-3">
                <div className="flex-1">
                  <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-1.5">Stok</label>
                  <input className="w-full h-10 px-3 text-sm font-semibold rounded-lg border border-slate-200 bg-slate-50/50 outline-none text-slate-700 cursor-not-allowed" readOnly value={picked ? `${picked.stockCode} ${picked.name}`.trim() : ''} placeholder="Stok seçiniz..." />
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setPickerQuery('')
                    setPickerItems([])
                    setPickerError(null)
                    setPickerMainCat('')
                    setPickerSubCat('')
                    setPickerOpen(true)
                  }}
                  className="h-10 inline-flex items-center gap-1.5 px-4 text-xs font-bold rounded-lg bg-slate-800 hover:bg-slate-900 text-white shadow-sm transition-all focus:outline-none"
                >
                  <Search size={14} strokeWidth={2.5} />
                  Seç
                </button>
              </div>

              <div className="grid grid-cols-2 gap-4 mt-5">
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-1.5">Tarih (Başlangıç)</label>
                  <input type="date" className="w-full h-10 px-3 text-sm font-semibold rounded-lg border border-slate-200 bg-white focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-500 transition-all outline-none text-slate-700" value={from} onChange={(e) => setFrom(e.target.value)} />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-1.5">Tarih (Bitiş)</label>
                  <input type="date" className="w-full h-10 px-3 text-sm font-semibold rounded-lg border border-slate-200 bg-white focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-500 transition-all outline-none text-slate-700" value={to} onChange={(e) => setTo(e.target.value)} />
                </div>
              </div>

              <div className="mt-6 flex items-center justify-end">
                <button
                  type="button"
                  onClick={onRun}
                  disabled={loading || !picked?.stockCode}
                  className="h-10 inline-flex items-center gap-1.5 px-6 text-xs font-bold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50 transition-all focus:outline-none"
                >
                  {loading ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="animate-spin"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 11 12 14 22 4"></polyline><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path></svg>
                  )}
                  {loading ? 'Yükleniyor...' : 'Verileri Getir'}
                </button>
              </div>

              {error && (
                <div className="mt-4 p-3 bg-red-50 border border-red-100 rounded-xl text-xs font-bold text-red-600 flex items-center gap-2">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                  {error}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right: Summary Panel */}
        <div className="col-span-12 lg:col-span-6">
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden h-full flex flex-col">
            <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
              <h2 className="text-xs font-bold text-slate-600 uppercase tracking-wider">
                Depo Özeti
              </h2>
            </div>
            <div className="p-0 flex-1 flex flex-col">
              <div className="overflow-x-auto flex-1">
                <table className="w-full text-left border-collapse text-xs whitespace-nowrap min-w-[520px]">
                  <thead>
                    <tr className="bg-slate-50/50">
                      <th className="px-4 py-2.5 font-bold text-slate-500 text-[10px] uppercase tracking-wider text-left border-b border-slate-200">Depo</th>
                      <th className="px-4 py-2.5 font-bold text-slate-500 text-[10px] uppercase tracking-wider text-right border-b border-slate-200">Toplam Giriş</th>
                      <th className="px-4 py-2.5 font-bold text-slate-500 text-[10px] uppercase tracking-wider text-right border-b border-slate-200">Toplam Çıkış</th>
                      <th className="px-4 py-2.5 font-bold text-slate-500 text-[10px] uppercase tracking-wider text-right border-b border-slate-200">Bakiye</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {loading ? (
                      Array.from({ length: 3 }).map((_, i) => (
                        <tr key={i}>
                          <td className="px-4 py-3"><div className="h-3 bg-slate-100 rounded animate-pulse w-24" /></td>
                          <td className="px-4 py-3"><div className="h-3 bg-slate-100 rounded animate-pulse w-16 ml-auto" /></td>
                          <td className="px-4 py-3"><div className="h-3 bg-slate-100 rounded animate-pulse w-16 ml-auto" /></td>
                          <td className="px-4 py-3"><div className="h-3 bg-slate-100 rounded animate-pulse w-16 ml-auto" /></td>
                        </tr>
                      ))
                    ) : summary.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="px-4 py-10 text-center">
                          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-slate-50 text-slate-350 mb-2">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path></svg>
                          </div>
                          <div className="text-xs font-semibold text-slate-400">Özet veri bulunamadı.</div>
                        </td>
                      </tr>
                    ) : (
                      summary.map((s) => (
                        <tr key={String(s.warehouseCode)} className="hover:bg-slate-50/50 transition-colors group">
                          <td className="px-4 py-2.5 font-bold text-slate-700">{String(s.warehouseCode)} {String(s.warehouseName ?? '').trim()}</td>
                          <td className="px-4 py-2.5 text-right font-bold text-emerald-600 bg-emerald-50/10">+{formatQty(Number(s.totalIn ?? 0))}</td>
                          <td className="px-4 py-2.5 text-right font-bold text-rose-500 bg-rose-50/10">-{formatQty(Number(s.totalOut ?? 0))}</td>
                          <td className="px-4 py-2.5 text-right font-black text-slate-800 text-sm">{formatQty(Number(s.balance ?? 0))}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                  <tfoot>
                    <tr className="bg-slate-50 text-xs font-bold text-slate-750 border-t-2 border-slate-200">
                      <td className="px-4 py-2.5 uppercase tracking-wide text-[10px] font-bold text-slate-500">Genel Toplam</td>
                      <td className="px-4 py-2.5 text-right text-emerald-600">+{formatQty(totals.totalIn)}</td>
                      <td className="px-4 py-2.5 text-right text-rose-500">-{formatQty(totals.totalOut)}</td>
                      <td className="px-4 py-2.5 text-right text-slate-900 font-black text-sm">{formatQty(totals.balance)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Movement Details */}
      <div className="mb-4 mt-6">
        <h2 className="text-xs font-bold text-slate-600 uppercase tracking-wider ml-1">
          Hareket Detayları
        </h2>
      </div>

      {loading ? (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-8 space-y-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-6">
              <div className="h-3.5 bg-slate-100 rounded animate-pulse w-24" />
              <div className="h-3.5 bg-slate-100 rounded animate-pulse w-28" />
              <div className="h-3.5 bg-slate-100 rounded animate-pulse flex-1" />
              <div className="h-3.5 bg-slate-100 rounded animate-pulse w-20" />
              <div className="h-3.5 bg-slate-100 rounded animate-pulse w-20" />
            </div>
          ))}
        </div>
      ) : movementRows.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm px-6 py-16 text-center">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-slate-50 border border-slate-100 text-slate-400 mb-4 shadow-inner">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path></svg>
          </div>
          <div className="text-xs font-bold text-slate-500 uppercase tracking-wider">Hareket Kaydı Bulunamadı</div>
          <p className="text-xs text-slate-400 mt-1.5">Bu tarih aralığında gösterilecek herhangi bir işlem mevcut değil.</p>
        </div>
      ) : (
        <Table
          onRefresh={() => void loadReport()} columns={movementColumns} data={movementRows} showColumnFilters />
      )}

      {/* Product Selector Picker Modal */}
      <Modal
        isOpen={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title="Stok Seçimi"
        containerClassName="max-w-4xl"
        footer={
          <>
            <button
              type="button"
              onClick={() => setPickerOpen(false)}
              className="h-9 px-4 text-xs font-bold rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 transition-all focus:outline-none"
            >
              Vazgeç
            </button>
          </>
        }
        scrollable
      >
        <div className="flex items-center gap-3 mb-5">
          <div className="flex-1">
            <FormInput label="Ara" value={pickerQuery} onChange={(e) => setPickerQuery(e.target.value)} placeholder="Stok kodu veya ürün adı ile arayın..." />
          </div>
          <button
            type="button"
            onClick={() => searchProducts(pickerQuery)}
            className="mt-[24px] h-10 inline-flex items-center gap-1.5 px-4 text-xs font-bold rounded-lg bg-slate-800 hover:bg-slate-900 text-white shadow-sm transition-all focus:outline-none"
          >
            <Search size={14} strokeWidth={2.5} />
            Ürün Ara
          </button>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-5">
          <FormSelect
            label="Ana Kategori"
            value={pickerMainCat}
            onChange={(e) => {
              const v = e.target.value
              setPickerMainCat(v)
              setPickerSubCat('')
              if (v) {
                void searchProducts(pickerQuery, { main: v, sub: '' })
              } else {
                setPickerItems([])
              }
            }}
            options={[{ value: '', label: 'Tüm Ana Kategoriler' }, ...(categoriesState?.mains ?? []).map((m: string) => ({ value: m, label: m }))]}
          />
          <FormSelect
            label="Alt Kategori"
            value={pickerSubCat}
            onChange={(e) => {
              const v = e.target.value
              setPickerSubCat(v)
              void searchProducts(pickerQuery, { sub: v })
            }}
            options={[
              { value: '', label: 'Tüm Alt Kategoriler' },
              ...(((categoriesState as any)?.subsByMain?.[pickerMainCat] ?? []) as string[]).map((s) => ({ value: s, label: s }))
            ]}
            disabled={!pickerMainCat}
          />
        </div>

        {pickerError && (
          <div className="mb-4 p-3 bg-red-50 border border-red-100 rounded-xl text-xs font-bold text-red-600 flex items-center gap-2">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            {pickerError}
          </div>
        )}

        <div className="border border-slate-200 rounded-xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs whitespace-nowrap">
              <thead>
                <tr className="bg-slate-50">
                  <th className="px-4 py-3 font-semibold text-slate-600 text-[10px] uppercase tracking-wider text-left border-b border-slate-200">Stok Kodu</th>
                  <th className="px-4 py-3 font-semibold text-slate-600 text-[10px] uppercase tracking-wider text-left border-b border-slate-200">Ürün Adı</th>
                  <th className="px-4 py-3 font-semibold text-slate-600 text-[10px] uppercase tracking-wider text-right border-b border-slate-200">Fiyat</th>
                  <th className="px-4 py-3 font-semibold text-slate-600 text-[10px] uppercase tracking-wider text-right w-[80px] border-b border-slate-200" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pickerLoading ? (
                  Array.from({ length: 4 }).map((_, i) => (
                    <tr key={i}>
                      <td className="px-4 py-3"><div className="h-3 bg-slate-100 rounded animate-pulse w-24" /></td>
                      <td className="px-4 py-3"><div className="h-3 bg-slate-100 rounded animate-pulse w-40" /></td>
                      <td className="px-4 py-3"><div className="h-3 bg-slate-100 rounded animate-pulse w-16 ml-auto" /></td>
                      <td className="px-4 py-3"><div className="h-3 bg-slate-100 rounded animate-pulse w-10 ml-auto" /></td>
                    </tr>
                  ))
                ) : pickerItems.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-12 text-center">
                      <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-slate-50 text-slate-300 mb-2">
                        <Search size={18} />
                      </div>
                      <div className="text-xs font-semibold text-slate-400">Aradığınız kriterlere uygun ürün bulunamadı.</div>
                    </td>
                  </tr>
                ) : (
                  pickerItems.map((p) => (
                    <tr key={String(p?.id ?? '')} className="hover:bg-slate-50/80 cursor-pointer transition-colors group">
                      <td className="px-4 py-2.5 font-bold text-slate-700">{String(p?.stockCode ?? '')}</td>
                      <td className="px-4 py-2.5 text-slate-600">{String(p?.name ?? '')}</td>
                      <td className="px-4 py-2.5 text-right font-bold text-slate-800">{p?.__basePrice == null ? '-' : formatMoney(Number(p.__basePrice ?? 0))}</td>
                      <td className="px-4 py-2.5 text-right">
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 h-7 px-3 rounded-lg text-xs font-semibold bg-indigo-50 text-indigo-700 hover:bg-indigo-600 hover:text-white border border-indigo-200 hover:border-indigo-600 transition-all shadow-sm"
                          onClick={() => selectProduct(p)}
                        >
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>
                          Seç
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </Modal>
    </div>
  )
}
