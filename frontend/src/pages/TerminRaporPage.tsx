import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import * as XLSX from 'xlsx'
import {
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  CheckCircle2,
  Clock,
  FileSpreadsheet,
  Package,
  RefreshCw,
  Search,
  Truck
} from 'lucide-react'
import {
  fetchTerminRaporu,
  type TerminRaporDurum,
  type TerminRaporSiparis,
  type TerminRaporTutar,
  type TerminRaporu
} from '../api/purchaseInvoices'
import CariEkstreModal from '../components/CariEkstreModal'

/**
 * TERMİN RAPORU (2026-09-17 kullanıcı isteği).
 *
 * "Gelen giden ne aldık, kaçı geldi kaçı gelmedi hepsini görebilelim; önceden Excel'de
 * tutuluyordu." Referans: "Ödeme Tablosu - 2026.xlsx" — tedarikçi, ürün, adet, birim fiyat,
 * toplam, ödeme/bakiye, tahmini geliş, durum (Yolda / Geldi).
 *
 * MODAL DEĞİL, SAYFA (kullanıcı kararı). Adresi `/invoice/termin/rapor`: `pathToInvoiceTabId`
 * yol ÖNEKİYLE eşleştiği için termin sekmesinin yetkisine düşer — ayrı rol yetkisi yok.
 * Sunucu ucu da aynı yetkiyle korunuyor (`TerminReportController`).
 *
 * Tutarlar KDV hariç, iskonto düşülmüş, siparişin KENDİ para birimindedir. Farklı para
 * birimleri hiçbir yerde toplanmaz; her para birimi ayrı satırda durur.
 */

const STATUS_META: Record<TerminRaporDurum, { label: string; cls: string; dot: string }> = {
  Bekliyor: { label: 'Bekliyor', cls: 'bg-amber-50 text-amber-700 border-amber-200', dot: 'bg-amber-500' },
  KismiGeldi: { label: 'Kısmi Geldi', cls: 'bg-sky-50 text-sky-700 border-sky-200', dot: 'bg-sky-500' },
  Geldi: { label: 'Geldi', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500' }
}

type StatusFilter = 'all' | TerminRaporDurum | 'overdue'
type View = 'orders' | 'suppliers' | 'products'

const iso = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

const money = (n: number, code: string) => {
  try {
    return new Intl.NumberFormat('tr-TR', { style: 'currency', currency: code || 'TRY', minimumFractionDigits: 2 }).format(Number(n) || 0)
  } catch {
    return `${(Number(n) || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ${code}`
  }
}

const qty = (n: number) => (Number(n) || 0).toLocaleString('tr-TR', { maximumFractionDigits: 2 })

const dateTr = (v?: string | null) => (v ? new Date(v).toLocaleDateString('tr-TR', { timeZone: 'UTC' }) : '—')

const trUpper = (s: string) => String(s ?? '').toLocaleUpperCase('tr-TR')

function Progress({ delivered, ordered }: { delivered: number; ordered: number }) {
  const pct = ordered > 0 ? Math.min(100, Math.round((delivered / ordered) * 100)) : 0
  return (
    <div className="flex items-center gap-2 min-w-[110px]">
      <div className="h-1.5 flex-1 rounded-full bg-gray-100 overflow-hidden">
        <div
          className={`h-full rounded-full ${pct >= 100 ? 'bg-emerald-500' : pct > 0 ? 'bg-sky-500' : 'bg-gray-200'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-[10px] font-bold text-gray-500 w-8 text-right">%{pct}</span>
    </div>
  )
}

function StatusBadge({ status }: { status: TerminRaporDurum }) {
  const m = STATUS_META[status] ?? STATUS_META.Bekliyor
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[10px] font-bold whitespace-nowrap ${m.cls}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${m.dot}`} />
      {m.label}
    </span>
  )
}

function CurrencyTotals({ totals, showLedger }: { totals: TerminRaporTutar[]; showLedger: boolean }) {
  if (totals.length === 0) return <span className="text-xs text-gray-400">—</span>
  return (
    <div className="space-y-1">
      {totals.map((t) => (
        <div key={t.currencyCode} className="text-[11px] leading-tight">
          <span className="font-bold text-gray-900">{money(t.orderedAmount, t.currencyCode)}</span>
          <span className="text-gray-400"> · </span>
          <span className="text-emerald-700 font-semibold">{money(t.deliveredAmount, t.currencyCode)}</span>
          <span className="text-gray-400"> · </span>
          <span className="text-amber-700 font-semibold">{money(t.remainingAmount, t.currencyCode)}</span>
          {showLedger && (
            <div className="text-[10px] text-gray-500">
              Ödenen {money(t.paidInPeriod, t.currencyCode)} · Bakiye{' '}
              <span className={t.balance > 0 ? 'text-rose-700 font-bold' : 'text-gray-700 font-bold'}>{money(t.balance, t.currencyCode)}</span>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

export default function TerminRaporPage() {
  const navigate = useNavigate()
  const today = new Date()
  const [from, setFrom] = useState(iso(new Date(today.getFullYear(), 0, 1)))
  const [to, setTo] = useState(iso(today))
  const [supplierCode, setSupplierCode] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [search, setSearch] = useState('')
  const [view, setView] = useState<View>('orders')

  /**
   * Cari ekstre penceresi — Fatura Dökümü / Alış Faturaları ile AYNI bileşen
   * (`CariEkstreModal`). Tedarikçi kodu `320-…` geldiği için modal kendi içinde
   * tedarikçi ekstresi ucuna gidiyor.
   */
  const [ekstreOpen, setEkstreOpen] = useState(false)
  const [ekstreCari, setEkstreCari] = useState<{ kod: string; ad: string } | null>(null)
  const openEkstre = (kod: string, ad: string) => {
    if (!String(kod ?? '').trim()) return
    setEkstreCari({ kod: kod.trim(), ad })
    setEkstreOpen(true)
  }

  const [data, setData] = useState<TerminRaporu | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    const ac = new AbortController()
    setLoading(true)
    setError(null)
    fetchTerminRaporu({ from, to }, { signal: ac.signal })
      .then((d) => setData(d))
      .catch((e: any) => {
        if (e?.name !== 'AbortError') setError(String(e?.message ?? 'Termin raporu alınamadı'))
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false)
      })
    return () => ac.abort()
    // Tedarikçi/durum/arama istemcide süzülür; sunucuya yalnız tarih aralığı gider.
  }, [from, to, reloadKey])

  const supplierOptions = useMemo(
    () => (data?.suppliers ?? []).map((s) => ({ code: s.supplierCode, name: s.supplierName })).sort((a, b) => a.name.localeCompare(b.name, 'tr')),
    [data]
  )

  const filteredOrders = useMemo(() => {
    const q = trUpper(search.trim())
    return (data?.orders ?? []).filter((o) => {
      if (supplierCode && o.supplierCode !== supplierCode) return false
      if (statusFilter === 'overdue' && !o.overdueDays) return false
      if (statusFilter !== 'all' && statusFilter !== 'overdue' && o.status !== statusFilter) return false
      if (!q) return true
      const hay = trUpper(
        [o.documentNo, o.supplierCode, o.supplierName, o.description ?? '', ...o.lines.map((l) => `${l.stockCode} ${l.stockName}`)].join(' ')
      )
      return hay.includes(q)
    })
  }, [data, supplierCode, statusFilter, search])

  /** Özet kartları EKRANDA süzülen siparişlerden hesaplanır; süzgeç değişince rakamlar da değişir. */
  const summary = useMemo(() => {
    const byCur = new Map<string, TerminRaporTutar>()
    for (const o of filteredOrders) {
      const t = byCur.get(o.currencyCode) ?? { currencyCode: o.currencyCode, orderedAmount: 0, deliveredAmount: 0, remainingAmount: 0, paidInPeriod: 0, balance: 0 }
      t.orderedAmount += o.orderedAmount
      t.deliveredAmount += o.deliveredAmount
      t.remainingAmount += o.remainingAmount
      byCur.set(o.currencyCode, t)
    }
    // Ödeme ve bakiye TEDARİKÇİ seviyesinde; yalnız ekranda siparişi görünen tedarikçiler toplanır.
    const visibleSuppliers = new Set(filteredOrders.map((o) => o.supplierCode))
    for (const s of data?.suppliers ?? []) {
      if (!visibleSuppliers.has(s.supplierCode)) continue
      for (const st of s.totals) {
        const t = byCur.get(st.currencyCode) ?? { currencyCode: st.currencyCode, orderedAmount: 0, deliveredAmount: 0, remainingAmount: 0, paidInPeriod: 0, balance: 0 }
        t.paidInPeriod += st.paidInPeriod
        t.balance += st.balance
        byCur.set(st.currencyCode, t)
      }
    }
    return {
      count: filteredOrders.length,
      waiting: filteredOrders.filter((o) => o.status === 'Bekliyor').length,
      partial: filteredOrders.filter((o) => o.status === 'KismiGeldi').length,
      delivered: filteredOrders.filter((o) => o.status === 'Geldi').length,
      overdue: filteredOrders.filter((o) => !!o.overdueDays).length,
      orderedQty: filteredOrders.reduce((a, o) => a + o.orderedQuantity, 0),
      deliveredQty: filteredOrders.reduce((a, o) => a + o.deliveredQuantity, 0),
      remainingQty: filteredOrders.reduce((a, o) => a + o.remainingQuantity, 0),
      totals: Array.from(byCur.values()).sort((a, b) => (a.currencyCode === 'TRY' ? 1 : 0) - (b.currencyCode === 'TRY' ? 1 : 0) || a.currencyCode.localeCompare(b.currencyCode))
    }
  }, [filteredOrders, data])

  const filteredSuppliers = useMemo(() => {
    const visible = new Set(filteredOrders.map((o) => o.supplierCode))
    return (data?.suppliers ?? []).filter((s) => visible.has(s.supplierCode)).map((s) => {
      const orders = filteredOrders.filter((o) => o.supplierCode === s.supplierCode)
      return {
        ...s,
        orderCount: orders.length,
        openOrderCount: orders.filter((o) => o.status !== 'Geldi').length,
        overdueOrderCount: orders.filter((o) => !!o.overdueDays).length,
        orderedQuantity: orders.reduce((a, o) => a + o.orderedQuantity, 0),
        deliveredQuantity: orders.reduce((a, o) => a + o.deliveredQuantity, 0),
        remainingQuantity: orders.reduce((a, o) => a + o.remainingQuantity, 0),
        totals: s.totals.map((t) => {
          const cur = orders.filter((o) => o.currencyCode === t.currencyCode)
          return {
            ...t,
            orderedAmount: cur.reduce((a, o) => a + o.orderedAmount, 0),
            deliveredAmount: cur.reduce((a, o) => a + o.deliveredAmount, 0),
            remainingAmount: cur.reduce((a, o) => a + o.remainingAmount, 0)
          }
        })
      }
    })
  }, [data, filteredOrders])

  /** Ürün kırılımı: aynı stok kodu farklı siparişlerde — para birimi başına ayrı satır. */
  const products = useMemo(() => {
    const map = new Map<string, { stockCode: string; stockName: string; currencyCode: string; suppliers: Set<string>; orderCount: number; ordered: number; delivered: number; remaining: number; orderedAmount: number; deliveredAmount: number; remainingAmount: number }>()
    for (const o of filteredOrders) {
      for (const l of o.lines) {
        const key = `${l.stockCode}|${o.currencyCode}`
        const r = map.get(key) ?? { stockCode: l.stockCode, stockName: l.stockName, currencyCode: o.currencyCode, suppliers: new Set<string>(), orderCount: 0, ordered: 0, delivered: 0, remaining: 0, orderedAmount: 0, deliveredAmount: 0, remainingAmount: 0 }
        r.suppliers.add(o.supplierName)
        r.orderCount += 1
        r.ordered += l.orderedQuantity
        r.delivered += l.deliveredQuantity
        r.remaining += l.remainingQuantity
        r.orderedAmount += l.orderedAmount
        r.deliveredAmount += l.deliveredAmount
        r.remainingAmount += l.remainingAmount
        map.set(key, r)
      }
    }
    return Array.from(map.values()).sort((a, b) => b.remaining - a.remaining || a.stockName.localeCompare(b.stockName, 'tr'))
  }, [filteredOrders])

  const exportExcel = () => {
    const wb = XLSX.utils.book_new()
    const siparisSatirlari: any[] = []
    for (const o of filteredOrders) {
      for (const l of o.lines) {
        siparisSatirlari.push({
          'Sipariş Tarihi': dateTr(o.date),
          'Belge No': o.documentNo,
          'Tedarikçi Kodu': o.supplierCode,
          'Tedarikçi': o.supplierName,
          'Stok Kodu': l.stockCode,
          'Ürün': l.stockName,
          'Para Birimi': o.currencyCode,
          'Birim Fiyat': l.unitPrice,
          'Sipariş Adet': l.orderedQuantity,
          'Gelen Adet': l.deliveredQuantity,
          'Gelmeyen Adet': l.remainingQuantity,
          'Sipariş Tutarı': l.orderedAmount,
          'Gelen Tutar': l.deliveredAmount,
          'Gelmeyen Tutar': l.remainingAmount,
          'Tahmini Geliş': dateTr(o.estimatedArrivalDate),
          'Son Teslim': dateTr(o.lastDeliveryDate),
          'Durum': STATUS_META[o.status]?.label ?? o.status,
          'Gecikme (gün)': o.overdueDays ?? '',
          'Açıklama': o.description ?? ''
        })
      }
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(siparisSatirlari), 'Siparişler')

    const tedarikciSatirlari: any[] = []
    for (const s of filteredSuppliers) {
      for (const t of s.totals) {
        tedarikciSatirlari.push({
          'Tedarikçi Kodu': s.supplierCode,
          'Tedarikçi': s.supplierName,
          'Para Birimi': t.currencyCode,
          'Sipariş Sayısı': s.orderCount,
          'Açık Sipariş': s.openOrderCount,
          'Geciken': s.overdueOrderCount,
          'Sipariş Tutarı': t.orderedAmount,
          'Gelen Tutar': t.deliveredAmount,
          'Gelmeyen Tutar': t.remainingAmount,
          'Ödenen (dönem)': t.paidInPeriod,
          'Bakiye (borcumuz)': t.balance
        })
      }
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(tedarikciSatirlari), 'Tedarikçiler')

    const teslimatSatirlari: any[] = []
    for (const o of filteredOrders) {
      for (const d of o.deliveries) {
        teslimatSatirlari.push({
          'Sipariş Belge No': o.documentNo,
          'Tedarikçi': o.supplierName,
          'Teslimat Belge No': d.documentNo,
          'Teslimat Tarihi': dateTr(d.date),
          'Adet': d.quantity,
          'Tutar': d.amount,
          'Para Birimi': o.currencyCode,
          'Giren': d.createUser ?? ''
        })
      }
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(teslimatSatirlari), 'Teslimatlar')

    XLSX.writeFile(wb, `termin-raporu-${from}_${to}.xlsx`)
  }

  const kpi = (label: string, value: React.ReactNode, sub: React.ReactNode, icon: React.ReactNode, tone: string, filter?: StatusFilter) => (
    <button
      type="button"
      onClick={() => filter && setStatusFilter((cur) => (cur === filter ? 'all' : filter))}
      className={`text-left rounded-2xl border bg-white p-4 shadow-sm transition-all ${filter ? 'hover:shadow-md cursor-pointer' : 'cursor-default'} ${filter && statusFilter === filter ? 'ring-2 ring-red-500/30 border-red-300' : 'border-gray-100'}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-bold uppercase tracking-wider text-gray-500">{label}</span>
        <span className={`w-8 h-8 rounded-xl flex items-center justify-center ${tone}`}>{icon}</span>
      </div>
      <div className="mt-2 text-2xl font-black text-gray-900 leading-none">{value}</div>
      <div className="mt-1 text-[11px] text-gray-500">{sub}</div>
    </button>
  )

  return (
    <div className="space-y-5 font-inter text-gray-900 min-h-[calc(100vh-140px)] pb-12 px-3 sm:px-6">
      {/* Başlık */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-gray-100 pb-5">
        <div className="min-w-0">
          <button
            type="button"
            onClick={() => navigate('/invoice/termin')}
            className="inline-flex items-center gap-1.5 text-[11px] font-bold text-gray-500 hover:text-red-600 mb-1.5"
          >
            <ArrowLeft size={13} /> Termin Listesi
          </button>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight flex items-center gap-2">
            <BarChart3 className="text-red-600" size={24} />
            Termin Raporu
          </h1>
          <p className="text-xs text-gray-500 mt-1">
            Alış siparişlerinde ne sipariş edildi, ne geldi, ne bekleniyor; tedarikçiye ne ödendi, ne borç kaldı.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setReloadKey((k) => k + 1)}
            className="h-10 px-4 rounded-2xl border border-gray-200 bg-white text-xs font-bold text-gray-700 hover:bg-gray-50 flex items-center gap-2 shadow-sm"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Yenile
          </button>
          <button
            type="button"
            onClick={exportExcel}
            disabled={filteredOrders.length === 0}
            className="h-10 px-4 rounded-2xl border border-emerald-200 bg-emerald-50 text-xs font-bold text-emerald-700 hover:bg-emerald-100 flex items-center gap-2 shadow-sm disabled:opacity-50"
          >
            <FileSpreadsheet size={14} /> Excel
          </button>
        </div>
      </div>

      {/* Süzgeçler */}
      <div className="grid grid-cols-2 lg:grid-cols-12 gap-3">
        <label className="col-span-1 lg:col-span-2">
          <span className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1">Başlangıç</span>
          <input type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} className="w-full h-10 px-3 rounded-2xl border border-gray-200 bg-white text-xs shadow-sm" />
        </label>
        <label className="col-span-1 lg:col-span-2">
          <span className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1">Bitiş</span>
          <input type="date" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} className="w-full h-10 px-3 rounded-2xl border border-gray-200 bg-white text-xs shadow-sm" />
        </label>
        <label className="col-span-2 lg:col-span-3">
          <span className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1">Tedarikçi</span>
          <select value={supplierCode} onChange={(e) => setSupplierCode(e.target.value)} className="w-full h-10 px-3 rounded-2xl border border-gray-200 bg-white text-xs shadow-sm">
            <option value="">Tüm tedarikçiler</option>
            {supplierOptions.map((s) => (
              <option key={s.code} value={s.code}>{s.name}</option>
            ))}
          </select>
        </label>
        <label className="col-span-2 lg:col-span-5">
          <span className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1">Ara</span>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Belge no, tedarikçi, stok kodu veya ürün adı..."
              className="w-full h-10 pl-9 pr-3 rounded-2xl border border-gray-200 bg-white text-xs shadow-sm"
            />
          </div>
        </label>
      </div>

      {error && <div className="p-4 text-xs font-semibold text-red-700 bg-red-50 border border-red-200 rounded-2xl">{error}</div>}
      {data?.truncated && (
        <div className="p-3 text-xs font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded-2xl">
          Aralıkta çok fazla sipariş var; en yeni 2000 sipariş gösteriliyor. Tarih aralığını daraltın.
        </div>
      )}

      {/* KPI kartları — tıklayınca durum süzgeci olur */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
        {kpi('Sipariş', summary.count, `${qty(summary.orderedQty)} adet sipariş`, <Package size={16} />, 'bg-gray-100 text-gray-700', 'all')}
        {kpi('Bekliyor', summary.waiting, 'hiç gelmedi', <Clock size={16} />, 'bg-amber-50 text-amber-600', 'Bekliyor')}
        {kpi('Kısmi Geldi', summary.partial, 'bir kısmı geldi', <Truck size={16} />, 'bg-sky-50 text-sky-600', 'KismiGeldi')}
        {kpi('Geldi', summary.delivered, 'tamamı geldi', <CheckCircle2 size={16} />, 'bg-emerald-50 text-emerald-600', 'Geldi')}
        {kpi('Geciken', summary.overdue, 'tahmini geliş geçti', <AlertTriangle size={16} />, 'bg-rose-50 text-rose-600', 'overdue')}
      </div>

      {/* Adet ve tutar özeti */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
          <div className="text-[11px] font-bold uppercase tracking-wider text-gray-500">Adet</div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            <div>
              <div className="text-lg font-black text-gray-900">{qty(summary.orderedQty)}</div>
              <div className="text-[10px] text-gray-500">Sipariş</div>
            </div>
            <div>
              <div className="text-lg font-black text-emerald-700">{qty(summary.deliveredQty)}</div>
              <div className="text-[10px] text-gray-500">Gelen</div>
            </div>
            <div>
              <div className="text-lg font-black text-amber-700">{qty(summary.remainingQty)}</div>
              <div className="text-[10px] text-gray-500">Gelmeyen</div>
            </div>
          </div>
          <div className="mt-3"><Progress delivered={summary.deliveredQty} ordered={summary.orderedQty} /></div>
        </div>
        <div className="lg:col-span-2 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm overflow-x-auto">
          <div className="text-[11px] font-bold uppercase tracking-wider text-gray-500">Tutarlar (KDV hariç, para birimi başına)</div>
          {summary.totals.length === 0 ? (
            <div className="mt-3 text-xs text-gray-400">Tutar yok.</div>
          ) : (
            <table className="mt-2 w-full text-xs min-w-[520px]">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-gray-400">
                  <th className="text-left py-1.5">Birim</th>
                  <th className="text-right py-1.5">Sipariş</th>
                  <th className="text-right py-1.5">Gelen</th>
                  <th className="text-right py-1.5">Gelmeyen</th>
                  <th className="text-right py-1.5">Ödenen (dönem)</th>
                  <th className="text-right py-1.5">Bakiye (borcumuz)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {summary.totals.map((t) => (
                  <tr key={t.currencyCode}>
                    <td className="py-2 font-bold text-gray-700">{t.currencyCode}</td>
                    <td className="py-2 text-right font-bold text-gray-900">{money(t.orderedAmount, t.currencyCode)}</td>
                    <td className="py-2 text-right font-semibold text-emerald-700">{money(t.deliveredAmount, t.currencyCode)}</td>
                    <td className="py-2 text-right font-semibold text-amber-700">{money(t.remainingAmount, t.currencyCode)}</td>
                    <td className="py-2 text-right text-gray-700">{money(t.paidInPeriod, t.currencyCode)}</td>
                    <td className={`py-2 text-right font-bold ${t.balance > 0 ? 'text-rose-700' : 'text-gray-900'}`}>{money(t.balance, t.currencyCode)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Görünüm sekmeleri */}
      <div className="flex items-center gap-1 p-1 rounded-2xl bg-gray-100 w-full sm:w-fit overflow-x-auto">
        {([
          ['orders', `Siparişler (${filteredOrders.length})`],
          ['suppliers', `Tedarikçiler (${filteredSuppliers.length})`],
          ['products', `Ürünler (${products.length})`]
        ] as Array<[View, string]>).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setView(key)}
            className={`px-4 h-9 rounded-xl text-xs font-bold whitespace-nowrap transition ${view === key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-800'}`}
          >
            {label}
          </button>
        ))}
        {statusFilter !== 'all' && (
          <button type="button" onClick={() => setStatusFilter('all')} className="ml-1 px-3 h-9 rounded-xl text-[11px] font-bold text-red-600 hover:bg-white whitespace-nowrap">
            Durum süzgecini kaldır
          </button>
        )}
      </div>

      {loading && !data ? (
        <div className="py-16 text-center text-xs text-gray-500 flex items-center justify-center gap-2">
          <RefreshCw size={14} className="animate-spin" /> Rapor hazırlanıyor...
        </div>
      ) : view === 'orders' ? (
        filteredOrders.length === 0 ? (
          <div className="py-16 text-center text-sm text-gray-400 bg-white rounded-2xl border border-gray-100">Bu süzgeçle sipariş yok.</div>
        ) : (
          <div className="space-y-2">
            {filteredOrders.map((o) => (
              <OrderCard key={o.id} order={o} onCariClick={openEkstre} />
            ))}
          </div>
        )
      ) : view === 'suppliers' ? (
        filteredSuppliers.length === 0 ? (
          <div className="py-16 text-center text-sm text-gray-400 bg-white rounded-2xl border border-gray-100">Tedarikçi yok.</div>
        ) : (
          <div className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-x-auto">
            <table className="w-full text-xs min-w-[860px]">
              <thead className="bg-gray-50 text-[10px] uppercase tracking-wider text-gray-500">
                <tr>
                  <th className="text-left px-4 py-3">Tedarikçi</th>
                  <th className="text-right px-3 py-3">Sipariş</th>
                  <th className="text-right px-3 py-3">Açık</th>
                  <th className="text-right px-3 py-3">Geciken</th>
                  <th className="text-left px-3 py-3">Adet (sipariş / gelen / gelmeyen)</th>
                  <th className="text-left px-3 py-3">Tutar (sipariş · gelen · gelmeyen)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filteredSuppliers.map((s) => (
                  <tr key={s.supplierCode} className="hover:bg-gray-50/60 align-top">
                    <td className="px-4 py-3">
                      <button type="button" onClick={() => { setSupplierCode(s.supplierCode); setView('orders') }} className="font-bold text-gray-900 hover:text-red-600 text-left">
                        {s.supplierName}
                      </button>
                      <div className="text-[10px] font-mono text-gray-400">{s.supplierCode}</div>
                    </td>
                    <td className="px-3 py-3 text-right font-bold">{s.orderCount}</td>
                    <td className="px-3 py-3 text-right font-bold text-amber-700">{s.openOrderCount}</td>
                    <td className={`px-3 py-3 text-right font-bold ${s.overdueOrderCount > 0 ? 'text-rose-700' : 'text-gray-400'}`}>{s.overdueOrderCount}</td>
                    <td className="px-3 py-3">
                      <div className="font-semibold">
                        {qty(s.orderedQuantity)} / <span className="text-emerald-700">{qty(s.deliveredQuantity)}</span> / <span className="text-amber-700">{qty(s.remainingQuantity)}</span>
                      </div>
                      <div className="mt-1"><Progress delivered={s.deliveredQuantity} ordered={s.orderedQuantity} /></div>
                    </td>
                    <td className="px-3 py-3"><CurrencyTotals totals={s.totals} showLedger /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : products.length === 0 ? (
        <div className="py-16 text-center text-sm text-gray-400 bg-white rounded-2xl border border-gray-100">Ürün yok.</div>
      ) : (
        <div className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-x-auto">
          <table className="w-full text-xs min-w-[860px]">
            <thead className="bg-gray-50 text-[10px] uppercase tracking-wider text-gray-500">
              <tr>
                <th className="text-left px-4 py-3">Ürün</th>
                <th className="text-left px-3 py-3">Tedarikçi</th>
                <th className="text-right px-3 py-3">Sipariş</th>
                <th className="text-right px-3 py-3">Gelen</th>
                <th className="text-right px-3 py-3">Gelmeyen</th>
                <th className="px-3 py-3" />
                <th className="text-right px-3 py-3">Sipariş Tutarı</th>
                <th className="text-right px-4 py-3">Gelmeyen Tutar</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {products.map((p) => (
                <tr key={`${p.stockCode}|${p.currencyCode}`} className="hover:bg-gray-50/60">
                  <td className="px-4 py-2.5">
                    <div className="font-semibold text-gray-900 max-w-[320px] truncate" title={p.stockName}>{p.stockName}</div>
                    <div className="text-[10px] font-mono text-gray-400">{p.stockCode} · {p.orderCount} sipariş</div>
                  </td>
                  <td className="px-3 py-2.5 text-gray-600 max-w-[180px] truncate" title={Array.from(p.suppliers).join(', ')}>{Array.from(p.suppliers).join(', ')}</td>
                  <td className="px-3 py-2.5 text-right font-bold">{qty(p.ordered)}</td>
                  <td className="px-3 py-2.5 text-right font-bold text-emerald-700">{qty(p.delivered)}</td>
                  <td className={`px-3 py-2.5 text-right font-bold ${p.remaining > 0 ? 'text-amber-700' : 'text-gray-400'}`}>{qty(p.remaining)}</td>
                  <td className="px-3 py-2.5"><Progress delivered={p.delivered} ordered={p.ordered} /></td>
                  <td className="px-3 py-2.5 text-right font-semibold">{money(p.orderedAmount, p.currencyCode)}</td>
                  <td className="px-4 py-2.5 text-right font-semibold text-amber-700">{money(p.remainingAmount, p.currencyCode)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <CariEkstreModal open={ekstreOpen} cari={ekstreCari} onClose={() => setEkstreOpen(false)} />
    </div>
  )
}

/**
 * Siparis karti - HER ZAMAN ACIK (2026-09-18 kullanici karari: "her fatura acilabilir degil,
 * direkt acik olarak gelecek"). Onceden acilir/kapanir bir dugmeydi; kalemleri gormek icin
 * her siparise tek tek tiklamak gerekiyordu.
 *
 * Tedarikci adi Fatura Dokumu'ndeki gibi ekstreyi acar (CariEkstreModal; tedarikci kodu
 * 320-... oldugu icin modal kendi icinde tedarikci ekstresi ucuna gidiyor).
 */
function OrderCard({ order: o, onCariClick }: { order: TerminRaporSiparis; onCariClick: (kod: string, ad: string) => void }) {
  return (
    <div className={`rounded-2xl border bg-white shadow-sm overflow-hidden ${o.overdueDays ? 'border-rose-200' : 'border-gray-100'}`}>
      <div className="px-4 py-3">
        <div className="flex-1 min-w-0 grid grid-cols-2 md:grid-cols-12 gap-x-3 gap-y-2 items-center">
          <div className="col-span-2 md:col-span-3 min-w-0">
            <button
              type="button"
              onClick={() => onCariClick(o.supplierCode, o.supplierName)}
              title="Cari ekstresini ac"
              className="font-bold text-gray-900 truncate max-w-full text-left hover:text-blue-700 hover:underline decoration-dotted underline-offset-2 transition"
            >
              {o.supplierName}
            </button>
            <div className="text-[10px] text-gray-500 truncate">
              <span className="font-mono">{o.documentNo}</span> &middot; {dateTr(o.date)}
            </div>
          </div>
          <div className="md:col-span-2">
            <StatusBadge status={o.status} />
            {o.overdueDays ? <div className="mt-1 text-[10px] font-bold text-rose-700">{o.overdueDays} gun gecikti</div> : null}
          </div>
          <div className="md:col-span-2 text-[11px]">
            <div className="text-gray-400 text-[10px]">Tahmini gelis</div>
            <div className="font-semibold text-gray-800">{dateTr(o.estimatedArrivalDate)}</div>
          </div>
          <div className="md:col-span-2 text-[11px]">
            <div className="font-semibold">
              {qty(o.orderedQuantity)} / <span className="text-emerald-700">{qty(o.deliveredQuantity)}</span> / <span className="text-amber-700">{qty(o.remainingQuantity)}</span>
            </div>
            <Progress delivered={o.deliveredQuantity} ordered={o.orderedQuantity} />
          </div>
          <div className="col-span-2 md:col-span-3 text-[11px] md:text-right">
            <div className="font-black text-gray-900">{money(o.orderedAmount, o.currencyCode)}</div>
            {/*
              Sipariş tutarı BELGENİN toplamıdır (mal + hizmet) — kullanıcı kararı 2026-09-18.
              Gelen/kalan yalnız malı saydığı için hizmet bedeli olan belgede toplam ile
              gelen+kalan tutmaz; yanılma olmasın diye "hizmet hariç" hâli de yazılıyor.
            */}
            {Number(o.serviceAmount ?? 0) > 0 && (
              <div className="text-[10px] text-slate-500">
                Hizmet hariç {money(o.orderedAmount - Number(o.serviceAmount ?? 0), o.currencyCode)}
                <span className="text-slate-300"> &middot; </span>
                <span className="text-indigo-600 font-semibold">Hizmet {money(Number(o.serviceAmount ?? 0), o.currencyCode)}</span>
              </div>
            )}
            <div className="text-[10px]">
              <span className="text-emerald-700 font-semibold">Gelen {money(o.deliveredAmount, o.currencyCode)}</span>
              <span className="text-gray-300"> &middot; </span>
              <span className="text-amber-700 font-semibold">Kalan {money(o.remainingAmount, o.currencyCode)}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="border-t border-gray-200 bg-gray-50/50 px-4 py-3 space-y-3">
        {o.description && <div className="text-[11px] text-gray-600"><span className="font-bold">Aciklama:</span> {o.description}</div>}
        {/*
          KALEM TABLOSU - satir VE sutun cizgileri (2026-09-18 kullanici istegi).
          Onceki halinde yalnizca soluk yatay ayrac vardi, sutunlar hic ayrilmiyordu.
          border-collapse + her hucrede kenarlik: hangi sayinin hangi sutuna ait oldugu
          tereddutsuz gorunuyor. Alttaki toplam satiri kalem toplamini karta bagliyor.
        */}
        <div className="rounded-xl border border-gray-300 bg-white overflow-x-auto">
          <table className="w-full text-[11px] min-w-[640px] border-collapse">
            <thead className="bg-gray-100 text-[10px] uppercase tracking-wider text-gray-600">
              <tr>
                <th className="text-left px-3 py-2 border-b border-r border-gray-300">Urun</th>
                <th className="text-right px-3 py-2 border-b border-r border-gray-300">Br. Fiyat</th>
                <th className="text-right px-3 py-2 border-b border-r border-gray-300">Siparis</th>
                <th className="text-right px-3 py-2 border-b border-r border-gray-300">Gelen</th>
                <th className="text-right px-3 py-2 border-b border-r border-gray-300">Gelmeyen</th>
                <th className="text-right px-3 py-2 border-b border-r border-gray-300">Tutar</th>
                <th className="text-right px-3 py-2 border-b border-gray-300">Gelmeyen Tutar</th>
              </tr>
            </thead>
            <tbody>
              {o.lines.map((l) => (
                <tr key={l.stockCode + l.stockName} className={l.isService ? 'bg-indigo-50/40' : 'even:bg-gray-50/60'}>
                  <td className="px-3 py-2 border-b border-r border-gray-200">
                    <div className="font-semibold text-gray-900 flex items-center gap-1.5">
                      <span>{l.stockName}</span>
                      {l.isService && (
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-indigo-100 text-indigo-800">HİZMET</span>
                      )}
                    </div>
                    <div className="text-[10px] font-mono text-gray-400">{l.stockCode}</div>
                  </td>
                  <td className="px-3 py-2 text-right border-b border-r border-gray-200">{l.isService ? <span className="text-gray-300">—</span> : money(l.unitPrice, o.currencyCode)}</td>
                  {/*
                    Hizmetin "kaçı geldi" hâli yok: adet sütunları tire. Sayı yazılsaydı nakliye
                    bekleyen mal gibi okunur, gelmeyen adet şişerdi.
                  */}
                  <td className="px-3 py-2 text-right font-bold border-b border-r border-gray-200">{l.isService ? <span className="text-gray-300">—</span> : qty(l.orderedQuantity)}</td>
                  <td className="px-3 py-2 text-right font-bold text-emerald-700 border-b border-r border-gray-200">{l.isService ? <span className="text-gray-300">—</span> : qty(l.deliveredQuantity)}</td>
                  <td className={`px-3 py-2 text-right font-bold border-b border-r border-gray-200 ${!l.isService && l.remainingQuantity > 0 ? 'text-amber-700' : 'text-gray-400'}`}>{l.isService ? <span className="text-gray-300">—</span> : qty(l.remainingQuantity)}</td>
                  <td className="px-3 py-2 text-right border-b border-r border-gray-200">{money(l.orderedAmount, o.currencyCode)}</td>
                  <td className="px-3 py-2 text-right text-amber-700 border-b border-gray-200">{l.isService ? <span className="text-gray-300">—</span> : money(l.remainingAmount, o.currencyCode)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-gray-100 font-bold text-gray-800">
              <tr>
                <td className="px-3 py-2 border-r border-gray-300">Toplam</td>
                <td className="px-3 py-2 border-r border-gray-300" />
                <td className="px-3 py-2 text-right border-r border-gray-300">{qty(o.orderedQuantity)}</td>
                <td className="px-3 py-2 text-right text-emerald-700 border-r border-gray-300">{qty(o.deliveredQuantity)}</td>
                <td className="px-3 py-2 text-right text-amber-700 border-r border-gray-300">{qty(o.remainingQuantity)}</td>
                <td className="px-3 py-2 text-right border-r border-gray-300">{money(o.orderedAmount, o.currencyCode)}</td>
                <td className="px-3 py-2 text-right text-amber-700">{money(o.remainingAmount, o.currencyCode)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1.5">Teslimatlar</div>
          {o.deliveries.length === 0 ? (
            <div className="text-[11px] text-gray-400">
              {o.status === 'Geldi' ? 'Siparis tek seferde teslim alindi.' : 'Henuz teslimat yok.'}
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {o.deliveries.map((d) => (
                <div key={d.id} className="rounded-xl border border-emerald-200 bg-white px-3 py-2 text-[11px]">
                  <div className="font-mono font-bold text-gray-900">{d.documentNo}</div>
                  <div className="text-gray-500">{dateTr(d.date)} &middot; {qty(d.quantity)} adet &middot; <span className="font-semibold text-emerald-700">{money(d.amount, o.currencyCode)}</span></div>
                  {d.createUser && <div className="text-[10px] text-gray-400">{d.createUser}</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
