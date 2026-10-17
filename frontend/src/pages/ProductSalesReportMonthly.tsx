import React, { useEffect, useMemo, useState } from 'react'
import { API_BASE_URL, buildHeaders } from '../config/api'
import Table, { type TableColumn } from '../components/Table'
import { FileSpreadsheet, Download, RefreshCw, Search, TrendingUp, Package, Warehouse, Calendar } from 'lucide-react'
import * as XLSX from 'xlsx'

interface GroupedMonthlyItem {
  stockCode: string
  stockName: string
  month: number
  warehouseCode: number
  warehouseName: string
  quantity: number
}

interface WarehouseMetadata {
  warehouseCode: number
  name: string
}

interface MonthlyReportResponse {
  items: GroupedMonthlyItem[]
  warehouses: WarehouseMetadata[]
}

const MONTH_OPTIONS = [
  { value: 1, label: '01-Ocak' },
  { value: 2, label: '02-Şubat' },
  { value: 3, label: '03-Mart' },
  { value: 4, label: '04-Nisan' },
  { value: 5, label: '05-Mayıs' },
  { value: 6, label: '06-Haziran' },
  { value: 7, label: '07-Temmuz' },
  { value: 8, label: '08-Ağustos' },
  { value: 9, label: '09-Eylül' },
  { value: 10, label: '10-Ekim' },
  { value: 11, label: '11-Kasım' },
  { value: 12, label: '12-Aralık' }
]

export default function ProductSalesReportMonthly() {
  const [items, setItems] = useState<GroupedMonthlyItem[]>([])
  const [warehouses, setWarehouses] = useState<WarehouseMetadata[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Monthly filters (empty list means All months)
  const [selectedMonths, setSelectedMonths] = useState<number[]>([])
  const [searchFilterText, setSearchFilterText] = useState('')

  const load = async () => {
    try {
      setLoading(true)
      setError(null)
      const headers = buildHeaders()

      const res = await fetch(`${API_BASE_URL}/api/reports/product-sales/monthly`, { headers })
      if (!res.ok) {
        throw new Error('Aylık ürün satış raporu verileri alınamadı')
      }

      const json = await res.json()
      setItems((json?.data?.items ?? []) as GroupedMonthlyItem[])
      setWarehouses((json?.data?.warehouses ?? []) as WarehouseMetadata[])
    } catch (e: any) {
      setError(e?.message ?? 'Veriler yüklenirken hata oluştu')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const filteredMonthOptions = useMemo(() => {
    const q = searchFilterText.trim().toLowerCase()
    if (!q) return MONTH_OPTIONS
    return MONTH_OPTIONS.filter(o => o.label.toLowerCase().includes(q))
  }, [searchFilterText])

  const handleToggleAll = () => {
    setSelectedMonths([]) // empty means (All)
  }

  const handleToggleMonth = (val: number) => {
    if (selectedMonths.length === 0) {
      setSelectedMonths([val])
    } else {
      const exists = selectedMonths.includes(val)
      if (exists) {
        const next = selectedMonths.filter(v => v !== val)
        setSelectedMonths(next)
      } else {
        const next = [...selectedMonths, val]
        if (next.length === MONTH_OPTIONS.length) {
          setSelectedMonths([]) // all selected -> reset to (All)
        } else {
          setSelectedMonths(next)
        }
      }
    }
  }

  const isAllChecked = selectedMonths.length === 0

  // Pivot list of rows
  const rows = useMemo(() => {
    const map: Record<string, { stockCode: string; stockName: string; miktar: number; [key: string]: any }> = {}

    const filteredItems = items.filter(x => {
      if (selectedMonths.length === 0) return true
      return selectedMonths.includes(x.month)
    })

    for (const x of filteredItems) {
      const code = x.stockCode
      if (!map[code]) {
        map[code] = {
          stockCode: code,
          stockName: x.stockName || '—',
          miktar: 0
        }
        for (const w of warehouses) {
          map[code][`wh_${w.warehouseCode}`] = 0
        }
      }

      map[code].miktar += x.quantity
      map[code][`wh_${x.warehouseCode}`] = (map[code][`wh_${x.warehouseCode}`] ?? 0) + x.quantity
    }

    return Object.values(map).sort((a, b) => a.stockCode.localeCompare(b.stockCode))
  }, [items, warehouses, selectedMonths])

  // Pivot table columns (Dynamic based on active warehouses)
  const columns = useMemo(() => {
    const list: TableColumn<any>[] = [
      { key: 'stockCode', label: 'STOK_KODU', searchable: true },
      { key: 'stockName', label: 'STOK_ADI', searchable: true },
      { key: 'miktar', label: 'MİKTAR', render: (v) => Number(v ?? 0).toLocaleString('tr-TR') }
    ]

    for (const w of warehouses) {
      list.push({
        key: `wh_${w.warehouseCode}`,
        label: String(w.name).toUpperCase(),
        searchable: true,
        render: (v) => (Number(v ?? 0) > 0 ? Number(v ?? 0).toLocaleString('tr-TR') : '0')
      })
    }

    return list
  }, [warehouses])

  const exportExcel = () => {
    if (rows.length === 0) return

    const exportData = rows.map(r => {
      const item: Record<string, any> = {
        'Stok Kodu': r.stockCode,
        'Stok Adı': r.stockName,
        'Miktar': r.miktar
      }
      for (const w of warehouses) {
        item[String(w.name).toUpperCase()] = r[`wh_${w.warehouseCode}`] || 0
      }
      return item
    })

    const ws = XLSX.utils.json_to_sheet(exportData)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Aylık Ürün Satış Raporu')
    XLSX.writeFile(wb, 'urun-satis-aylik-raporu.xlsx')
  }

  const stats = useMemo(() => {
    const totalQty = rows.reduce((sum, r) => sum + r.miktar, 0)
    let maxQty = 0
    let topProduct = '—'
    
    for (const r of rows) {
      if (r.miktar > maxQty) {
        maxQty = r.miktar
        topProduct = `${r.stockCode} - ${r.stockName}`
      }
    }

    return {
      totalQty,
      productCount: rows.length,
      topProduct,
      warehouseCount: warehouses.length
    }
  }, [rows, warehouses])

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white border border-gray-150 rounded-2xl p-4 md:p-5 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900 tracking-tight flex items-center gap-2">
            <span className="w-2.5 h-6 bg-gradient-to-b from-emerald-500 to-teal-600 rounded-full" />
            Ürün Satış Raporu (Aylık)
          </h1>
          <p className="text-xs text-gray-400 mt-1">Raporlar / Ürün Satış Raporu (Aylık)</p>
        </div>
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={exportExcel}
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
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Toplam Satış</span>
            <div className="text-base md:text-lg font-extrabold text-gray-800">{stats.totalQty.toLocaleString('tr-TR')} Adet</div>
          </div>
          <div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
            <TrendingUp size={18} />
          </div>
        </div>

        <div className="bg-gradient-to-br from-white to-slate-50/50 border border-gray-150 rounded-2xl p-4 shadow-sm flex items-center justify-between hover:shadow-md transition duration-250">
          <div className="space-y-1">
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">En Çok Satan Ürün</span>
            <div className="text-xs font-extrabold text-gray-800 truncate max-w-[150px]" title={stats.topProduct}>{stats.topProduct}</div>
          </div>
          <div className="w-9 h-9 rounded-xl bg-teal-50 text-teal-600 flex items-center justify-center">
            <Package size={18} />
          </div>
        </div>

        <div className="bg-gradient-to-br from-white to-slate-50/50 border border-gray-150 rounded-2xl p-4 shadow-sm flex items-center justify-between hover:shadow-md transition duration-250">
          <div className="space-y-1">
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Aktif Ürün Çeşidi</span>
            <div className="text-base md:text-lg font-extrabold text-gray-800">{stats.productCount} Farklı Ürün</div>
          </div>
          <div className="w-9 h-9 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
            <Calendar size={18} />
          </div>
        </div>

        <div className="bg-gradient-to-br from-white to-slate-50/50 border border-gray-150 rounded-2xl p-4 shadow-sm flex items-center justify-between hover:shadow-md transition duration-250">
          <div className="space-y-1">
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Aktif Depo Sayısı</span>
            <div className="text-base md:text-lg font-extrabold text-gray-800">{stats.warehouseCount} Depo</div>
          </div>
          <div className="w-9 h-9 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center">
            <Warehouse size={18} />
          </div>
        </div>
      </div>

      {/* Month Filters Container */}
      <div className="bg-white border border-gray-150 rounded-2xl p-4 shadow-sm flex flex-col space-y-4 relative overflow-hidden group">
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-emerald-500 to-teal-600 opacity-70 group-hover:opacity-100 transition duration-300" />
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <span className="text-[11px] font-bold text-gray-700 uppercase tracking-wider flex items-center gap-1.5">
            <Calendar size={13} className="text-gray-400" />
            Aylar
          </span>
          <div className="relative w-full max-w-xs">
            <input
              value={searchFilterText}
              onChange={(e) => setSearchFilterText(e.target.value)}
              placeholder="Ay ara..."
              className="w-full border border-gray-200 rounded-xl pl-8 pr-3 py-1.5 text-xs outline-none placeholder:text-gray-355 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/10 transition bg-white"
            />
            <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          </div>
        </div>

        <div className="flex flex-wrap gap-2 items-center pt-1">
          <button
            type="button"
            onClick={handleToggleAll}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition duration-200 select-none ${
              isAllChecked
                ? 'bg-gradient-to-r from-emerald-500 to-teal-600 text-white border-emerald-600 shadow-sm'
                : 'bg-white text-gray-655 border-gray-200 hover:bg-slate-50'
            }`}
          >
            (Tümü)
          </button>
          {filteredMonthOptions.map(o => {
            const checked = isAllChecked || selectedMonths.includes(o.value)
            return (
              <button
                key={o.value}
                type="button"
                onClick={() => handleToggleMonth(o.value)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition duration-200 select-none ${
                  checked && !isAllChecked
                    ? 'bg-gradient-to-r from-emerald-500 to-teal-600 text-white border-emerald-600 shadow-sm'
                    : checked && isAllChecked
                    ? 'bg-emerald-50/50 text-emerald-800 border-emerald-150'
                    : 'bg-white text-gray-655 border-gray-200 hover:bg-slate-50'
                }`}
              >
                {o.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Pivot Grid Table */}
      <div className="bg-white border border-gray-150 rounded-2xl p-4 shadow-sm flex flex-col">
        <div className="flex items-center gap-2 mb-3 border-b border-gray-100 pb-2">
          <div className="w-1.5 h-4 bg-emerald-550 rounded-full" />
          <span className="text-xs font-bold text-gray-800 uppercase tracking-wide">Aylık Depo Bazlı Satış Grid</span>
        </div>
        <div className="overflow-x-auto">
          {loading && <div className="text-xs text-gray-500 p-4">Yükleniyor...</div>}
          {!loading && rows.length === 0 && <div className="text-xs text-gray-400 p-4 text-center">Gösterilecek veri bulunamadı.</div>}
          {!loading && rows.length > 0 && (
            <Table
          onRefresh={() => void load()}
              columns={columns}
              data={rows}
              showColumnFilters
              rowKey={(r) => r.stockCode}
            />
          )}
        </div>
      </div>
    </div>
  )
}
