import React, { useEffect, useMemo, useState } from 'react'
import { API_BASE_URL, buildHeaders } from '../config/api'
import Table, { type TableColumn } from '../components/Table'
import { FileSpreadsheet, Download, RefreshCw, Filter, ChevronDown, Check, Search, TrendingUp, Percent, Coins, FileText, Layers, Users } from 'lucide-react'
import * as XLSX from 'xlsx'

interface SalesRecord {
  tarih: string
  fisNo: string
  customerCode: string
  customerName: string
  deliveryCustomerCode: string
  deliveryCustomerName: string
  stockCode: string
  stockName: string
  groupCode: string
  quantity: number
  unitPrice: number
  /** Hareketin kendi para birimi (2026-08-19); tutarlar TL capasidir. */
  paraBirimi?: string
  paraBirimiTipi?: number
  kur?: number
  dovizBirimFiyat?: number | null
  netUnitPrice: number
  vatRate: number
  warehouseCode: number
  warehouseName: string
}

function formatMoney(n: number) {
  const v = Number(n ?? 0)
  return `₺${v.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function formatNumber(n: number) {
  const v = Number(n ?? 0)
  return v.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
interface FilterBoxProps {
  title: string
  searchText: string
  setSearchText: (v: string) => void
  items: string[]
  selected: string[]
  onChange: (items: string[]) => void
}

function FilterBox({ title, searchText, setSearchText, items, selected, onChange }: FilterBoxProps) {
  const filtered = useMemo(() => {
    const q = searchText.trim().toLowerCase()
    if (!q) return items
    return items.filter(x => String(x ?? '').toLowerCase().includes(q))
  }, [items, searchText])

  const handleToggleAll = () => {
    onChange([]) // empty means (All)
  }

  const handleToggleItem = (item: string) => {
    if (selected.length === 0) {
      onChange(items.filter(x => x !== item))
    } else {
      const exists = selected.includes(item)
      if (exists) {
        const next = selected.filter(x => x !== item)
        onChange(next)
      } else {
        const next = [...selected, item]
        if (next.length === items.length) {
          onChange([])
        } else {
          onChange(next)
        }
      }
    }
  }

  const isAllChecked = selected.length === 0

  return (
    <div className="flex flex-col border border-gray-150 rounded-2xl bg-gradient-to-br from-white to-slate-50/50 p-4 shadow-sm hover:shadow-md transition duration-250 h-[240px] relative overflow-hidden group">
      <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-emerald-500 to-teal-600 opacity-70 group-hover:opacity-100 transition duration-300" />
      <div className="flex items-center justify-between mb-2.5">
        <span className="text-[11px] font-bold text-gray-700 uppercase tracking-wider">{title}</span>
        {selected.length > 0 ? (
          <span className="text-[9px] font-semibold bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full border border-emerald-150 shadow-sm">
            {selected.length} seçildi
          </span>
        ) : (
          <span className="text-[9px] font-semibold bg-slate-50 text-gray-400 px-2 py-0.5 rounded-full border border-gray-100">
            Tümü
          </span>
        )}
      </div>
      <div className="relative mb-2.5">
        <input
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          placeholder="Ara..."
          className="w-full border border-gray-200 rounded-xl pl-8 pr-3 py-1.5 text-[11px] outline-none placeholder:text-gray-305 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/10 transition bg-white"
        />
        <Search size={11} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
      </div>
      <div className="flex-1 overflow-y-auto space-y-1 text-[11px] pr-1 scrollbar-thin select-none">
        <label className="flex items-center gap-2 cursor-pointer py-1 px-1.5 hover:bg-emerald-50/30 rounded-lg transition">
          <input
            type="checkbox"
            checked={isAllChecked}
            onChange={handleToggleAll}
            className="rounded border-gray-300 text-emerald-600 focus:ring-emerald-500/20 w-3.5 h-3.5 cursor-pointer"
          />
          <span className="text-gray-800 font-bold">(Tümü)</span>
        </label>
        {filtered.map(item => {
          const checked = isAllChecked || selected.includes(item)
          return (
            <label key={item} className="flex items-center gap-2 cursor-pointer py-1 px-1.5 hover:bg-emerald-50/30 rounded-lg transition">
              <input
                type="checkbox"
                checked={checked}
                onChange={() => handleToggleItem(item)}
                className="rounded border-gray-300 text-emerald-600 focus:ring-emerald-500/20 w-3.5 h-3.5 cursor-pointer"
              />
              <span className="text-gray-650 truncate" title={item}>{item || '(Boş)'}</span>
            </label>
          )
        })}
      </div>
    </div>
  )
}

export default function ProductSalesReportDetailed() {
  const [data, setData] = useState<SalesRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Filter selections
  const [selectedYears, setSelectedYears] = useState<string[]>([])
  const [selectedMonths, setSelectedMonths] = useState<string[]>([])
  const [selectedDates, setSelectedDates] = useState<string[]>([])
  const [selectedGroups, setSelectedGroups] = useState<string[]>([])
  const [selectedProducts, setSelectedProducts] = useState<string[]>([])
  const [selectedCustomers, setSelectedCustomers] = useState<string[]>([])

  // Search texts for filters
  const [yearSearch, setYearSearch] = useState('')
  const [monthSearch, setMonthSearch] = useState('')
  const [dateSearch, setDateSearch] = useState('')
  const [groupSearch, setGroupSearch] = useState('')
  const [productSearch, setProductSearch] = useState('')
  const [customerSearch, setCustomerSearch] = useState('')

  // Global search inside tables
  const [bayilerSearch, setBayilerSearch] = useState('')
  const [activeTab, setActiveTab] = useState<'detailed' | 'grouped'>('detailed')

  // PARA BİRİMİ SÜZGECİ (0 = Tümü). Diğer süzgeçler istemci tarafında çalışıyor ama bu
  // sunucuda: düğme listesi (`availableCurrencyTypeIds`) süzgeçten BAĞIMSIZ kapsamdan
  // gelmeli, yoksa USD seçilince diğer düğmeler kaybolur ve kullanıcı geri dönemez.
  const [selectedCurrencyTypeId, setSelectedCurrencyTypeId] = useState(0)
  const [availableCurrencyTypeIds, setAvailableCurrencyTypeIds] = useState<number[]>([])

  const load = async () => {
    try {
      setLoading(true)
      setError(null)
      const headers = buildHeaders()

      const qs = selectedCurrencyTypeId > 0 ? `?currencyTypeId=${selectedCurrencyTypeId}` : ''
      const res = await fetch(`${API_BASE_URL}/api/reports/product-sales/detailed${qs}`, { headers })
      if (!res.ok) {
        throw new Error('Ürün satış raporu detaylı verisi alınamadı')
      }

      const json = await res.json()
      setData((json?.data ?? []) as SalesRecord[])
      setAvailableCurrencyTypeIds(((json?.availableCurrencyTypeIds ?? []) as any[]).map((x) => Number(x)).filter((x) => x > 0))
    } catch (e: any) {
      setError(e?.message ?? 'Veri yüklenirken hata oluştu')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [selectedCurrencyTypeId])

  // Unique options extracted from raw data
  const filterOptions = useMemo(() => {
    const years = new Set<string>()
    const months = new Set<string>()
    const dates = new Set<string>()
    const groups = new Set<string>()
    const products = new Set<string>()
    const customers = new Set<string>()

    const trMonths = [
      'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
      'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'
    ]

    for (const x of data) {
      const d = new Date(x.tarih)
      if (!Number.isNaN(d.getTime())) {
        years.add(String(d.getFullYear()))
        months.add(trMonths[d.getMonth()])
        dates.add(d.toLocaleDateString('tr-TR'))
      }
      if (x.groupCode) groups.add(x.groupCode)
      if (x.stockCode || x.stockName) products.add(`${x.stockCode} - ${x.stockName}`)
      if (x.customerName) customers.add(x.customerName)
    }

    return {
      years: Array.from(years).sort((a, b) => b.localeCompare(a)),
      months: trMonths.filter(m => months.has(m)),
      dates: Array.from(dates).sort((a, b) => {
        const partsA = a.split('.')
        const partsB = b.split('.')
        const da = new Date(Number(partsA[2]), Number(partsA[1]) - 1, Number(partsA[0])).getTime()
        const db = new Date(Number(partsB[2]), Number(partsB[1]) - 1, Number(partsB[0])).getTime()
        return db - da
      }),
      groups: Array.from(groups).sort((a, b) => a.localeCompare(b)),
      products: Array.from(products).sort((a, b) => a.localeCompare(b)),
      customers: Array.from(customers).sort((a, b) => a.localeCompare(b))
    }
  }, [data])

  // Filter application
  const filteredData = useMemo(() => {
    const trMonths = [
      'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
      'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'
    ]

    return data.filter(x => {
      const d = new Date(x.tarih)
      if (Number.isNaN(d.getTime())) return false

      const year = String(d.getFullYear())
      const month = trMonths[d.getMonth()]
      const date = d.toLocaleDateString('tr-TR')
      const productText = `${x.stockCode} - ${x.stockName}`

      if (selectedYears.length > 0 && !selectedYears.includes(year)) return false
      if (selectedMonths.length > 0 && !selectedMonths.includes(month)) return false
      if (selectedDates.length > 0 && !selectedDates.includes(date)) return false
      if (selectedGroups.length > 0 && !selectedGroups.includes(x.groupCode)) return false
      if (selectedProducts.length > 0 && !selectedProducts.includes(productText)) return false
      if (selectedCustomers.length > 0 && !selectedCustomers.includes(x.customerName)) return false

      return true
    })
  }, [data, selectedYears, selectedMonths, selectedDates, selectedGroups, selectedProducts, selectedCustomers])

  // 1. Bayiler Summary computation
  const bayilerRows = useMemo(() => {
    const map: Record<string, { miktar: number; toplam: number }> = {}
    for (const x of filteredData) {
      const name = x.customerName || '—'
      if (!map[name]) map[name] = { miktar: 0, toplam: 0 }
      const lineNet = x.quantity * x.netUnitPrice
      const lineGrand = lineNet * (1 + x.vatRate / 100)

      map[name].miktar += x.quantity
      map[name].toplam += lineGrand
    }

    const rows = Object.entries(map).map(([name, v]) => ({
      customerName: name,
      miktar: v.miktar,
      genelToplam: v.toplam
    })).sort((a, b) => b.genelToplam - a.genelToplam)

    const q = bayilerSearch.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(r => r.customerName.toLowerCase().includes(q))
  }, [filteredData, bayilerSearch])

  // 2. Gruplu Liste computation
  const grupluRows = useMemo(() => {
    const map: Record<string, { miktar: number; netTutar: number; kdvTutar: number; toplam: number; customerName: string; deliveryCustomerName: string; groupCode: string }> = {}
    for (const x of filteredData) {
      const key = `${x.customerName ?? ''}_${x.deliveryCustomerName ?? ''}_${x.groupCode ?? ''}`
      if (!map[key]) {
        map[key] = {
          customerName: x.customerName || '—',
          deliveryCustomerName: x.deliveryCustomerName || '—',
          groupCode: x.groupCode || '—',
          miktar: 0,
          netTutar: 0,
          kdvTutar: 0,
          toplam: 0
        }
      }
      const net = x.quantity * x.netUnitPrice
      const kdv = net * (x.vatRate / 100)
      const grand = net + kdv

      map[key].miktar += x.quantity
      map[key].netTutar += net
      map[key].kdvTutar += kdv
      map[key].toplam += grand
    }

    const list = Object.values(map).sort((a, b) => a.customerName.localeCompare(b.customerName))

    // Add total row if there are items
    if (list.length > 0) {
      const totMiktar = list.reduce((sum, r) => sum + r.miktar, 0)
      const totNet = list.reduce((sum, r) => sum + r.netTutar, 0)
      const totKdv = list.reduce((sum, r) => sum + r.kdvTutar, 0)
      const totGrand = list.reduce((sum, r) => sum + r.toplam, 0)

      list.push({
        customerName: 'GENEL TOPLAM',
        deliveryCustomerName: '',
        groupCode: '',
        miktar: totMiktar,
        netTutar: totNet,
        kdvTutar: totKdv,
        toplam: totGrand
      })
    }

    return list
  }, [filteredData])

  // 3. Detay Liste computation
  const detayRows = useMemo(() => {
    const list = filteredData.map((x, idx) => {
      const net = x.quantity * x.netUnitPrice
      const kdv = net * (x.vatRate / 100)
      const grand = net + kdv
      const d = new Date(x.tarih)
      const formattedDate = !Number.isNaN(d.getTime()) ? d.toLocaleDateString('tr-TR') : ''

      return {
        id: idx + 1,
        tarih: formattedDate,
        deliveryCustomerName: x.deliveryCustomerName || '—',
        fisNo: x.fisNo || '—',
        customerName: x.customerName || '—',
        stockName: x.stockName || '—',
        groupCode: x.groupCode || '—',
        miktar: x.quantity,
        tutar: x.quantity * x.unitPrice,
        iskonto: x.quantity * (x.unitPrice - x.netUnitPrice),
        netTutar: net,
        vatRate: x.vatRate,
        kdvTutar: kdv,
        genelToplam: grand,
        // Hareketin kendi para birimi ve o paradaki tutarı. `StockMovements` tablosunda
        // para birimi hiç yoktu; 2026-08-19'da eklendi, artık dolarlı satış TL satıştan
        // ayırt edilebiliyor. Çevrim YOK: dövizli tutar hareketin kendi fiyatından çıkar.
        paraBirimi: x.paraBirimi || 'TL',
        dovizTutar: x.dovizBirimFiyat != null ? x.quantity * Number(x.dovizBirimFiyat) : null
      }
    })

    if (list.length > 0) {
      const totMiktar = list.reduce((sum, r) => sum + r.miktar, 0)
      const totTutar = list.reduce((sum, r) => sum + r.tutar, 0)
      const totIsk = list.reduce((sum, r) => sum + r.iskonto, 0)
      const totNet = list.reduce((sum, r) => sum + r.netTutar, 0)
      const totKdv = list.reduce((sum, r) => sum + r.kdvTutar, 0)
      const totGrand = list.reduce((sum, r) => sum + r.genelToplam, 0)

      list.push({
        id: 0,
        tarih: 'GENEL TOPLAM',
        deliveryCustomerName: '',
        fisNo: '',
        customerName: '',
        stockName: '',
        groupCode: '',
        miktar: totMiktar,
        tutar: totTutar,
        iskonto: totIsk,
        netTutar: totNet,
        vatRate: 0,
        kdvTutar: totKdv,
        genelToplam: totGrand,
        // Genel toplam satırında döviz gösterilmez: farklı para birimlerini tek rakamda
        // toplamak tam da kaçındığımız şey.
        paraBirimi: '',
        dovizTutar: null
      })
    }

    return list
  }, [filteredData])

  // Column definitions
  const bayilerColumns: TableColumn<any>[] = useMemo(() => [
    { key: 'customerName', label: 'Cari Adı', searchable: true },
    { key: 'miktar', label: 'Miktar', render: (v) => Number(v ?? 0).toLocaleString('tr-TR') },
    { key: 'genelToplam', label: 'Genel Toplam', render: (v) => formatMoney(Number(v ?? 0)) }
  ], [])

  const grupluColumns: TableColumn<any>[] = useMemo(() => [
    { key: 'customerName', label: 'Cari Adı', searchable: true, render: (v, r) => r.customerName === 'GENEL TOPLAM' ? <span className="font-extrabold text-emerald-800">GENEL TOPLAM</span> : String(v) },
    { key: 'deliveryCustomerName', label: 'Teslim Cari Adı', searchable: true },
    { key: 'groupCode', label: 'Kod1', searchable: true },
    { key: 'miktar', label: 'Miktar', render: (v, r) => r.customerName === 'GENEL TOPLAM' ? <span className="font-extrabold text-emerald-800">{Number(v ?? 0).toLocaleString('tr-TR')}</span> : Number(v ?? 0).toLocaleString('tr-TR') },
    { key: 'netTutar', label: 'Net Tutar', render: (v, r) => r.customerName === 'GENEL TOPLAM' ? <span className="font-extrabold text-emerald-800">{formatMoney(Number(v ?? 0))}</span> : formatMoney(Number(v ?? 0)) },
    { key: 'kdvTutar', label: 'KDV Tutar', render: (v, r) => r.customerName === 'GENEL TOPLAM' ? <span className="font-extrabold text-emerald-800">{formatMoney(Number(v ?? 0))}</span> : formatMoney(Number(v ?? 0)) },
    { key: 'toplam', label: 'Genel Toplam', render: (v, r) => r.customerName === 'GENEL TOPLAM' ? <span className="font-extrabold text-emerald-800">{formatMoney(Number(v ?? 0))}</span> : formatMoney(Number(v ?? 0)) }
  ], [])

  const detayColumns: TableColumn<any>[] = useMemo(() => [
    { key: 'tarih', label: 'Tarih', searchable: true, render: (v, r) => r.tarih === 'GENEL TOPLAM' ? <span className="font-extrabold text-emerald-800">GENEL TOPLAM</span> : String(v) },
    { key: 'deliveryCustomerName', label: 'Teslim Cari Adı', searchable: true },
    { key: 'fisNo', label: 'FişNo', searchable: true },
    { key: 'customerName', label: 'Cari Adı', searchable: true },
    { key: 'stockName', label: 'Stok Adı', searchable: true },
    { key: 'groupCode', label: 'Kod1', searchable: true },
    { key: 'miktar', label: 'Miktar', render: (v, r) => r.tarih === 'GENEL TOPLAM' ? <span className="font-extrabold text-emerald-800">{Number(v ?? 0).toLocaleString('tr-TR')}</span> : Number(v ?? 0).toLocaleString('tr-TR') },
    { key: 'tutar', label: 'Tutar', render: (v, r) => r.tarih === 'GENEL TOPLAM' ? <span className="font-extrabold text-emerald-800">{formatMoney(Number(v ?? 0))}</span> : formatMoney(Number(v ?? 0)) },
    { key: 'iskonto', label: 'İskonto', render: (v, r) => r.tarih === 'GENEL TOPLAM' ? <span className="font-extrabold text-emerald-800">{formatMoney(Number(v ?? 0))}</span> : formatMoney(Number(v ?? 0)) },
    { key: 'netTutar', label: 'Net Tutar', render: (v, r) => r.tarih === 'GENEL TOPLAM' ? <span className="font-extrabold text-emerald-800">{formatMoney(Number(v ?? 0))}</span> : formatMoney(Number(v ?? 0)) },
    { key: 'vatRate', label: 'KDV (%)', render: (v, r) => r.tarih === 'GENEL TOPLAM' ? '' : `%${Number(v ?? 0)}` },
    { key: 'kdvTutar', label: 'KDV Tutarı', render: (v, r) => r.tarih === 'GENEL TOPLAM' ? <span className="font-extrabold text-emerald-800">{formatMoney(Number(v ?? 0))}</span> : formatMoney(Number(v ?? 0)) },
    { key: 'genelToplam', label: 'Genel Toplam', render: (v, r) => r.tarih === 'GENEL TOPLAM' ? <span className="font-extrabold text-emerald-800">{formatMoney(Number(v ?? 0))}</span> : formatMoney(Number(v ?? 0)) },
    { key: 'paraBirimi', label: 'Döviz', render: (v, r) => r.tarih === 'GENEL TOPLAM' ? '' : <span className="font-semibold text-slate-600">{String(v ?? 'TL')}</span> },
    {
      key: 'dovizTutar',
      label: 'Döviz Tutar',
      render: (v, r) => {
        if (r.tarih === 'GENEL TOPLAM' || v == null) return <span className="text-slate-300">—</span>
        // TL satırda da sembol basılır: sütun artık damgasız eski harekette TL tutara
        // düştüğü için sembolsüz bir sayı hangi parada olduğunu söylemiyordu.
        const code = String(r.paraBirimi ?? '').toUpperCase()
        const sym = code === 'USD' ? '$' : code === 'EUR' ? '€' : code === 'GBP' ? '£' : '₺'
        return (
          <span className="font-semibold text-emerald-700">
            {sym}
            {Number(v).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        )
      }
    }
  ], [])

  const exportExcel = () => {
    if (detayRows.length === 0) return

    // Clean data for excel export (exclude final TOTAL row or format cleanly)
    const exportData = detayRows.map(r => ({
      'Tarih': r.tarih,
      'Teslim Cari Adı': r.deliveryCustomerName,
      'Fiş No': r.fisNo,
      'Cari Adı': r.customerName,
      'Stok Adı': r.stockName,
      'Kod1': r.groupCode,
      'Miktar': r.miktar,
      'Brüt Tutar': r.tutar,
      'İskonto': r.iskonto,
      'Net Tutar': r.netTutar,
      'KDV Oranı': r.tarih === 'GENEL TOPLAM' ? '' : `%${r.vatRate}`,
      'KDV Tutarı': r.kdvTutar,
      'Genel Toplam': r.genelToplam,
      // Döviz sütunları olmadan dışa aktarımda dolarlı satır TL satırdan ayırt edilemiyordu.
      'Döviz': r.tarih === 'GENEL TOPLAM' ? '' : String(r.paraBirimi ?? 'TL'),
      'Döviz Tutar': r.dovizTutar ?? ''
    }))

    const ws = XLSX.utils.json_to_sheet(exportData)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Ürün Satış Detaylı')
    XLSX.writeFile(wb, 'urun-satis-detayli-raporu.xlsx')
  }

  const exportExcelGrouped = () => {
    if (grupluRows.length === 0) return

    const exportData = grupluRows.map(r => ({
      'Cari Adı': r.customerName,
      'Teslim Cari Adı': r.deliveryCustomerName,
      'Kod1': r.groupCode,
      'Miktar': r.miktar,
      'Net Tutar': r.netTutar,
      'KDV Tutar': r.kdvTutar,
      'Genel Toplam': r.toplam
    }))

    const ws = XLSX.utils.json_to_sheet(exportData)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Ürün Satış Gruplu')
    XLSX.writeFile(wb, 'urun-satis-gruplu-raporu.xlsx')
  }

  const stats = useMemo(() => {
    let miktar = 0
    let brutTutar = 0
    let netTutar = 0
    let kdvTutar = 0
    let genelToplam = 0
    const cariler = new Set<string>()
    const urunler = new Set<string>()

    for (const x of filteredData) {
      miktar += x.quantity
      brutTutar += x.quantity * x.unitPrice
      const lineNet = x.quantity * x.netUnitPrice
      const lineKdv = lineNet * (x.vatRate / 100)
      const lineGrand = lineNet + lineKdv

      netTutar += lineNet
      kdvTutar += lineKdv
      genelToplam += lineGrand

      if (x.customerName) cariler.add(x.customerName)
      if (x.stockCode) urunler.add(x.stockCode)
    }

    const iskonto = brutTutar - netTutar

    return {
      miktar,
      brutTutar,
      netTutar,
      kdvTutar,
      genelToplam,
      iskonto,
      cariSayisi: cariler.size,
      urunSayisi: urunler.size
    }
  }, [filteredData])

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white border border-gray-150 rounded-2xl p-4 md:p-5 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900 tracking-tight flex items-center gap-2">
            <span className="w-2.5 h-6 bg-gradient-to-b from-emerald-500 to-teal-600 rounded-full" />
            Ürün Satış Raporu Detaylı
          </h1>
          <p className="text-xs text-gray-400 mt-1">Raporlar / Ürün Satış Raporu Detaylı</p>
        </div>
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={activeTab === 'detailed' ? exportExcel : exportExcelGrouped}
            className="h-[36px] inline-flex items-center gap-2 px-4 text-xs font-bold rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white shadow-sm transition active:scale-95 duration-200"
            title="Excel Raporunu İndir"
          >
            <Download size={14} />
            <span>Excel İndir</span>
          </button>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="h-[36px] inline-flex items-center justify-center w-[36px] rounded-xl border border-gray-200 bg-white hover:bg-gray-50 active:bg-gray-100 text-gray-600 transition active:scale-95 shadow-sm disabled:opacity-60 duration-200"
            title="Yenile"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-2xl p-4 text-xs font-semibold shadow-sm">
          {error}
        </div>
      )}

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-gradient-to-br from-white to-slate-50/50 border border-gray-150 rounded-2xl p-4 shadow-sm flex items-center justify-between hover:shadow-md transition duration-250">
          <div className="space-y-1">
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Satış Miktarı</span>
            <div className="text-base md:text-lg font-extrabold text-gray-800">{stats.miktar.toLocaleString('tr-TR')} Adet</div>
          </div>
          <div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
            <TrendingUp size={18} />
          </div>
        </div>

        <div className="bg-gradient-to-br from-white to-slate-50/50 border border-gray-150 rounded-2xl p-4 shadow-sm flex items-center justify-between hover:shadow-md transition duration-250">
          <div className="space-y-1">
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Brüt Tutar / İskonto</span>
            <div className="text-sm md:text-base font-extrabold text-gray-800">{formatMoney(stats.brutTutar)}</div>
            <div className="text-[9px] text-rose-500 font-bold">-{formatMoney(stats.iskonto)} İskonto</div>
          </div>
          <div className="w-9 h-9 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center">
            <Percent size={16} />
          </div>
        </div>

        <div className="bg-gradient-to-br from-white to-slate-50/50 border border-gray-150 rounded-2xl p-4 shadow-sm flex items-center justify-between hover:shadow-md transition duration-250">
          <div className="space-y-1">
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Net & KDV</span>
            <div className="text-sm md:text-base font-extrabold text-gray-800">{formatMoney(stats.netTutar)}</div>
            <div className="text-[9px] text-teal-600 font-bold">+{formatMoney(stats.kdvTutar)} KDV</div>
          </div>
          <div className="w-9 h-9 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
            <Coins size={16} />
          </div>
        </div>

        <div className="bg-gradient-to-br from-emerald-500 to-teal-600 border border-emerald-600 rounded-2xl p-4 shadow-md flex items-center justify-between text-white hover:shadow-lg transition duration-250">
          <div className="space-y-1">
            <span className="text-[10px] font-bold text-emerald-100 uppercase tracking-wider">Genel Toplam</span>
            <div className="text-base md:text-lg font-black">{formatMoney(stats.genelToplam)}</div>
            <div className="text-[9px] text-emerald-100 font-semibold">{stats.cariSayisi} Cari / {stats.urunSayisi} Ürün</div>
          </div>
          <div className="w-9 h-9 rounded-xl bg-white/20 text-white flex items-center justify-center">
            <FileText size={18} />
          </div>
        </div>
      </div>

      {/* PARA BİRİMİ SÜZGECİ — sunucu tarafında süzer, çevrim YOK. */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mr-1">Para Birimi</span>
        <button
          type="button"
          onClick={() => setSelectedCurrencyTypeId(0)}
          className={
            'h-9 px-3 rounded-xl border text-[11px] font-bold transition ' +
            (selectedCurrencyTypeId === 0
              ? 'border-emerald-600 text-emerald-700 bg-emerald-50'
              : 'border-slate-200 text-slate-700 bg-white hover:bg-slate-50')
          }
        >
          Tümü
        </button>
        {[
          { id: 1, label: '₺ TL' },
          { id: 2, label: '€ EUR' },
          { id: 3, label: '$ USD' },
          { id: 4, label: '£ GBP' }
        ]
          .filter((c) => availableCurrencyTypeIds.includes(c.id) || selectedCurrencyTypeId === c.id)
          .map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setSelectedCurrencyTypeId(c.id)}
              className={
                'h-9 px-3 rounded-xl border text-[11px] font-bold transition ' +
                (selectedCurrencyTypeId === c.id
                  ? 'border-emerald-600 text-emerald-700 bg-emerald-50'
                  : 'border-slate-200 text-slate-700 bg-white hover:bg-slate-50')
              }
            >
              {c.label}
            </button>
          ))}
      </div>

      {/* Top Filter and Bayiler Panel */}
      <div className="grid grid-cols-12 gap-6 items-start">
        {/* Checkbox filters grid */}
        <div className="col-span-12 xl:col-span-9 grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          <FilterBox
            title="Yıllar"
            searchText={yearSearch}
            setSearchText={setYearSearch}
            items={filterOptions.years}
            selected={selectedYears}
            onChange={setSelectedYears}
          />
          <FilterBox
            title="Aylar"
            searchText={monthSearch}
            setSearchText={setMonthSearch}
            items={filterOptions.months}
            selected={selectedMonths}
            onChange={setSelectedMonths}
          />
          <FilterBox
            title="Gün Ay Yıl"
            searchText={dateSearch}
            setSearchText={setDateSearch}
            items={filterOptions.dates}
            selected={selectedDates}
            onChange={setSelectedDates}
          />
          <FilterBox
            title="Ürün Kod 1"
            searchText={groupSearch}
            setSearchText={setGroupSearch}
            items={filterOptions.groups}
            selected={selectedGroups}
            onChange={setSelectedGroups}
          />
          <FilterBox
            title="Ürün"
            searchText={productSearch}
            setSearchText={setProductSearch}
            items={filterOptions.products}
            selected={selectedProducts}
            onChange={setSelectedProducts}
          />
          <FilterBox
            title="Cari Filtre"
            searchText={customerSearch}
            setSearchText={setCustomerSearch}
            items={filterOptions.customers}
            selected={selectedCustomers}
            onChange={setSelectedCustomers}
          />
        </div>

        {/* Bayiler summary list */}
        <div className="col-span-12 xl:col-span-3 bg-white border border-gray-150 rounded-2xl p-4 shadow-sm flex flex-col h-[240px]">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[11px] font-bold text-gray-700 uppercase tracking-wider flex items-center gap-1.5">
              <Users size={12} className="text-gray-400" />
              Bayiler
            </span>
            <div className="relative">
              <input
                value={bayilerSearch}
                onChange={(e) => setBayilerSearch(e.target.value)}
                placeholder="Cari ara..."
                className="border border-gray-200 rounded-lg pl-6 pr-2 py-1 text-[10px] outline-none placeholder:text-gray-300 focus:border-emerald-500 w-28 bg-slate-50/50"
              />
              <Search size={9} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
            </div>
          </div>
          <div className="flex-1 overflow-auto rounded-xl border border-gray-100 scrollbar-thin">
            <Table
          onRefresh={() => void load()}
              columns={bayilerColumns}
              data={bayilerRows}
              rowKey={(r, idx) => `${r.customerName}_${idx}`}
            />
          </div>
        </div>
      </div>

      {/* Tabs / Switcher */}
      <div className="bg-white border border-gray-150 rounded-2xl p-3 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-xl w-fit">
          <button
            type="button"
            onClick={() => setActiveTab('detailed')}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition duration-200 flex items-center gap-1.5 ${
              activeTab === 'detailed'
                ? 'bg-white text-gray-800 shadow-sm'
                : 'text-gray-550 hover:text-gray-800'
            }`}
          >
            <Layers size={13} className={activeTab === 'detailed' ? 'text-emerald-550' : 'text-gray-400'} />
            Detaylı Rapor
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('grouped')}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition duration-200 flex items-center gap-1.5 ${
              activeTab === 'grouped'
                ? 'bg-white text-gray-800 shadow-sm'
                : 'text-gray-550 hover:text-gray-800'
            }`}
          >
            <FileSpreadsheet size={13} className={activeTab === 'grouped' ? 'text-emerald-550' : 'text-gray-400'} />
            Gruplu Özet Rapor
          </button>
        </div>
        <div className="text-[11px] text-gray-400 font-semibold sm:px-2">
          Filtre Sonucu: {filteredData.length} Satış Kaydı Bulundu
        </div>
      </div>

      {/* Conditional rendering based on Active Tab */}
      {activeTab === 'grouped' ? (
        <div className="bg-white border border-gray-150 rounded-2xl p-4 shadow-sm flex flex-col">
          <div className="flex items-center justify-between mb-3 border-b border-gray-100 pb-2">
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-4 bg-emerald-550 rounded-full" />
              <span className="text-xs font-bold text-gray-800 uppercase tracking-wide">Gruplu Özet Rapor</span>
            </div>
            <button
              type="button"
              onClick={exportExcelGrouped}
              className="inline-flex items-center gap-1.5 text-[10px] font-bold bg-slate-50 border border-gray-200 text-gray-700 px-3 py-1.5 rounded-xl hover:bg-slate-100 transition active:scale-95 duration-200"
              title="Excel Gruplu Listeyi İndir"
            >
              <Download size={11} />
              <span>Excel İndir</span>
            </button>
          </div>
          <div className="overflow-x-auto">
            <Table
          onRefresh={() => void load()}
              columns={grupluColumns}
              data={grupluRows}
              rowClassName={(r) => r.customerName === 'GENEL TOPLAM' ? 'bg-emerald-50/70 font-bold border-t border-emerald-100 hover:bg-emerald-50/60' : ''}
              rowKey={(r, idx) => `${r.customerName}_${r.deliveryCustomerName}_${r.groupCode}_${idx}`}
            />
          </div>
        </div>
      ) : (
        <div className="bg-white border border-gray-150 rounded-2xl p-4 shadow-sm flex flex-col">
          <div className="flex items-center justify-between mb-3 border-b border-gray-100 pb-2">
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-4 bg-emerald-550 rounded-full" />
              <span className="text-xs font-bold text-gray-800 uppercase tracking-wide">Detaylı Satış Listesi</span>
            </div>
            <button
              type="button"
              onClick={exportExcel}
              className="inline-flex items-center gap-1.5 text-[10px] font-bold bg-slate-50 border border-gray-200 text-gray-700 px-3 py-1.5 rounded-xl hover:bg-slate-100 transition active:scale-95 duration-200"
              title="Excel Detay Listesini İndir"
            >
              <Download size={11} />
              <span>Excel İndir</span>
            </button>
          </div>
          <div className="overflow-x-auto">
            <Table
          onRefresh={() => void load()}
              columns={detayColumns}
              data={detayRows}
              showColumnFilters
              rowClassName={(r) => r.tarih === 'GENEL TOPLAM' ? 'bg-emerald-50/70 font-bold border-t border-emerald-100 hover:bg-emerald-50/60' : ''}
              rowKey={(r, idx) => `${r.fisNo}_${r.tarih}_${idx}`}
            />
          </div>
        </div>
      )}
    </div>
  )
}
