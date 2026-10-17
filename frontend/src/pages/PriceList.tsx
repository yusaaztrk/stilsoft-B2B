import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import { FileSpreadsheet, RefreshCw, Search, Tags } from 'lucide-react'
import Table, { type TableColumn } from '../components/Table'
import { fetchPriceListReport, type PriceGroupDto, type PriceListProductDto } from '../api/reports'

type LayoutContext = {
  isSuperAdmin?: boolean
  allowedKeys?: Set<string>
}

function formatMoney(n: number) {
  const v = Number(n ?? 0)
  return v.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// PriceList default export
export default function PriceList() {
  const { isSuperAdmin } = useOutletContext<LayoutContext>()
  const navigate = useNavigate()

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reportData, setReportData] = useState<{
    priceGroups: PriceGroupDto[]
    items: PriceListProductDto[]
  } | null>(null)

  const [globalSearch, setGlobalSearch] = useState('')
  // Tabloda GÖRÜNEN satırlar (genel arama + sütun süzgeçleri uygulanmış). Excel çıktısı
  // ham `reportData.items` üzerinden alınıyordu: kullanıcı ekranda süzüp indirdiğinde
  // dosyaya gizlediği bütün ürünler de iniyordu. `Table` süzülmüş satırları zaten
  // `onFilteredDataChange` ile veriyor.
  const [visibleRows, setVisibleRows] = useState<any[]>([])
  const [priceCurrencyFilters, setPriceCurrencyFilters] = useState<string[]>([])

  const loadData = async (signal?: AbortSignal) => {
    try {
      setLoading(true)
      setError(null)
      const data = await fetchPriceListReport(signal)
      setReportData(data)
    } catch (e: any) {
      if (e?.name === 'AbortError') return
      setError(e?.message ?? 'Fiyat listesi yüklenemedi.')
      setReportData(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const ac = new AbortController()
    void loadData(ac.signal)
    return () => ac.abort()
  }, [])

  // Create columns dynamically based on active Price Groups
  const columns = useMemo<TableColumn<any>[]>(() => {
    const baseCols: TableColumn<any>[] = [
      {
        key: 'kod4',
        label: 'Kod 4',
        searchable: true,
        sortable: true,
        filter: {
          type: 'select',
          options: [
            { label: 'MAMUL', value: 'MAMUL' },
            { label: 'Y.PARCA', value: 'Y.PARCA' }
          ]
        },
        render: (val) => {
          const s = String(val ?? '').trim().toUpperCase()
          if (!s) return <span className="text-gray-400">—</span>
          const isMamul = s === 'MAMUL'
          const badgeClass = isMamul
            ? 'bg-blue-50 text-blue-700 border border-blue-200/50'
            : 'bg-amber-50 text-amber-700 border border-amber-200/50'
          return (
            <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wide ${badgeClass}`}>
              {isMamul ? 'Mamul' : 'Y.Parça'}
            </span>
          )
        }
      },
      {
        key: 'barcode',
        label: 'Barkod',
        searchable: true,
        sortable: true,
        render: (val) => <span className="font-mono text-xs text-gray-600">{String(val || '—')}</span>
      },
      {
        key: 'groupCode',
        label: 'Grup Kodu',
        searchable: true,
        sortable: true,
        render: (val) => <span className="text-gray-700 text-xs font-semibold">{String(val || '—')}</span>
      },
      {
        key: 'subGroupCode',
        label: 'Kod 1',
        searchable: true,
        sortable: true,
        render: (val) => <span className="text-gray-600 text-xs">{String(val || '—')}</span>
      },
      {
        key: 'stockCode',
        label: 'Stok Kodu',
        searchable: true,
        sortable: true,
        render: (val) => <span className="font-mono text-xs font-bold text-gray-900">{String(val || '—')}</span>
      },
      {
        key: 'stockName',
        label: 'Stok Adı',
        searchable: true,
        sortable: true,
        render: (val) => <span className="text-gray-900 font-medium text-xs">{String(val || '—')}</span>
      }
    ]

    if (!reportData?.priceGroups) return baseCols

    // Append dynamic price columns
    const priceCols: TableColumn<any>[] = reportData.priceGroups.map((pg) => {
      const keyStr = String(pg.id)
      return {
        key: keyStr as any,
        label: pg.name || `Fiyat ${pg.code}`,
        sortable: true,
        searchable: false,
        render: (_val, row) => {
          const detail = row.prices?.[keyStr]
          if (!detail || detail.price == null) {
            return <span className="text-gray-300 font-light text-center block">—</span>
          }
          const priceVal = Number(detail.price)
          const symbol = detail.currency === 'TL' ? '' : ` ${detail.currency}`
          return (
            <span className="font-bold text-gray-900 text-right block tracking-tight whitespace-nowrap text-xs">
              {formatMoney(priceVal)}{symbol}
            </span>
          )
        }
      }
    })

    return [...baseCols, ...priceCols]
  }, [reportData?.priceGroups])

  // Map API items to match the generic Table component's Row requirements
  const tableRows = useMemo(() => {
    if (!reportData?.items) return []
    return reportData.items.map((item) => {
      const row: Record<string, any> = {
        id: item.id,
        kod4: item.kod4,
        barcode: item.barcode,
        groupCode: item.groupCode,
        subGroupCode: item.subGroupCode,
        stockCode: item.stockCode,
        stockName: item.stockName,
        prices: item.prices
      }

      // Add price values directly to the row object for sorting purposes
      if (reportData.priceGroups) {
        reportData.priceGroups.forEach((pg) => {
          row[String(pg.id)] = item.prices?.[String(pg.id)]?.price ?? null
        })
      }

      return row
    })
  }, [reportData])

  /**
   * PARA BİRİMİ SÜZGECİ (2026-08-19 kullanıcı isteği — sipariş sayfasındaki kutucukların aynısı).
   *
   * Satırda birden çok fiyat grubu var ve her grubun kendi para birimi olabiliyor. Kural:
   * işaretli para birimlerinden EN AZ BİRİNDE fiyatı olan ürün listede kalır. Hiçbiri
   * işaretli değilse süzgeç kapalıdır (bütün ürünler).
   */
  const currencyFilterOptions = [
    { value: 'ALL', label: 'Tümü' },
    { value: 'TL', label: '₺ TL' },
    { value: 'EUR', label: '€ EUR' },
    { value: 'USD', label: '$ USD' },
    { value: 'GBP', label: '£ GBP' }
  ] as const

  const isCurrencyChecked = (value: string) =>
    value === 'ALL' ? priceCurrencyFilters.length === 0 : priceCurrencyFilters.includes(value)

  const toggleCurrencyFilter = (value: string) => {
    if (value === 'ALL') {
      setPriceCurrencyFilters([])
      return
    }
    setPriceCurrencyFilters((prev) => (prev.includes(value) ? prev.filter((x) => x !== value) : [...prev, value]))
  }

  const currencyFilteredRows = useMemo(() => {
    if (priceCurrencyFilters.length === 0) return tableRows
    return tableRows.filter((row: any) => {
      const prices = row?.prices ?? {}
      return Object.values(prices).some((d: any) => {
        if (!d || d.price == null) return false
        const code = String(d.currency ?? 'TL').trim().toUpperCase()
        const normalized = code === 'TRY' ? 'TL' : code
        return priceCurrencyFilters.includes(normalized)
      })
    })
  }, [tableRows, priceCurrencyFilters])

  const exportToExcel = () => {
    if (!reportData || reportData.items.length === 0) return

    const baseHeaders = ['Kod 4', 'Barkod', 'Grup Kodu', 'Kod 1', 'Stok Kodu', 'Stok Adi']
    const priceHeaders = reportData.priceGroups.map(pg => pg.name || `Fiyat ${pg.code}`)
    const headers = [...baseHeaders, ...priceHeaders]

    const csvRows = [headers.join(';')]

    // Süzülmüş satır yoksa (tablo henüz bildirmediyse) ham listeye düşülür.
    const exportItems = visibleRows.length > 0 ? visibleRows : reportData.items

    exportItems.forEach((item: any) => {
      const row = [
        item.kod4 ?? '',
        item.barcode ?? '',
        item.groupCode ?? '',
        item.subGroupCode ?? '',
        item.stockCode,
        item.stockName
      ]

      reportData.priceGroups.forEach((pg) => {
        const detail = item.prices?.[String(pg.id)]
        if (detail && detail.price != null) {
          const symbol = detail.currency === 'TL' ? '' : ` ${detail.currency}`
          row.push(`${detail.price}${symbol}`)
        } else {
          row.push('')
        }
      })

      csvRows.push(row.map(val => `"${String(val ?? '').replace(/"/g, '""')}"`).join(';'))
    })

    const csvContent = '\uFEFF' + csvRows.join('\n')
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.setAttribute('href', url)
    link.setAttribute('download', `Fiyat_Listesi_Raporu_${new Date().toISOString().slice(0, 10)}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  return (
    <div className="space-y-6 font-inter text-gray-900 min-h-[calc(100vh-140px)] pb-12 px-3 sm:px-6">
      {/* Header Panel */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-gray-100 pb-5">
        <div>
          <h1 className="text-2xl font-black text-gray-900 tracking-tight flex items-center gap-2.5">
            Fiyat Listesi
            <span className="text-[10px] font-bold text-blue-600 bg-blue-50 border border-blue-200/50 px-2.5 py-1 rounded-full uppercase tracking-wider">
              Dinamik
            </span>
          </h1>
          <p className="text-xs text-gray-500 mt-1">Sistemdeki mamul ve yedek parçaların tüm fiyat kategorilerine göre güncel listesini ve tutarlarını inceleyin.</p>
        </div>

        {/* Global Controls */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={exportToExcel}
            disabled={!reportData || reportData.items.length === 0}
            className="h-10 px-5 rounded-2xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-bold flex items-center gap-2 shadow-md shadow-emerald-500/10 transition-all active:scale-98"
            title="Excel Olarak İndir (CSV)"
          >
            <FileSpreadsheet size={15} />
            <span>Excel'e Aktar</span>
          </button>
        </div>
      </div>

      {/* Search and Refresh */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
        <div className="relative flex-1 w-full">
          <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center text-gray-400 pointer-events-none">
            <Search size={15} />
          </span>
          <input
            type="text"
            placeholder="Stok adı, stok kodu, barkod veya grup kodu ile ara..."
            value={globalSearch}
            onChange={(e) => setGlobalSearch(e.target.value)}
            className="w-full h-10 pl-10 pr-4 rounded-2xl border border-gray-200 bg-white/80 text-xs shadow-sm focus:ring-4 focus:ring-red-500/10 focus:border-red-600 transition-all placeholder:text-gray-400"
          />
        </div>
        <button
          type="button"
          onClick={() => void loadData()}
          disabled={loading}
          className="h-10 px-5 rounded-2xl border border-gray-200 bg-white text-xs font-bold hover:bg-gray-50 text-gray-700 flex items-center justify-center gap-2 transition-all shadow-sm active:scale-98 disabled:opacity-50"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          Yenile
        </button>
      </div>

      {/* PARA BİRİMİ SÜZGECİ — sipariş sayfasındaki kutucuk deseninin aynısı. */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mr-1">Para Birimi:</span>
        {currencyFilterOptions.map((opt) => (
          <label
            key={opt.value}
            className={
              'h-9 px-3 rounded-2xl border text-xs font-bold flex items-center gap-2 cursor-pointer transition-all ' +
              (isCurrencyChecked(opt.value)
                ? 'border-red-600 text-red-700 bg-red-50/60'
                : 'border-gray-200 text-gray-600 bg-white hover:bg-gray-50')
            }
          >
            <input
              type="checkbox"
              checked={isCurrencyChecked(opt.value)}
              onChange={() => toggleCurrencyFilter(opt.value)}
              className="w-3.5 h-3.5 accent-red-600"
            />
            {opt.label}
          </label>
        ))}
        <span className="text-[10px] text-gray-400 font-semibold">
          {currencyFilteredRows.length} ürün
        </span>
      </div>

      {error && (
        <div className="p-4 text-xs font-semibold text-red-700 bg-red-50 border border-red-200/50 rounded-2xl shadow-sm">
          {error}
        </div>
      )}

      {/* Main Table View */}
      <div className="bg-white rounded-3xl border border-gray-200/70 shadow-[0_4px_20px_rgba(0,0,0,0.015)] overflow-hidden relative">
        {loading && !reportData ? (
          <div className="flex flex-col items-center justify-center py-24 text-gray-400">
            <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mb-4" />
            <p className="text-xs font-semibold">Fiyat Listesi Yükleniyor...</p>
          </div>
        ) : (
          <div className="overflow-x-auto w-full">
            <Table
          onRefresh={() => void loadData()}
              columns={columns}
              data={currencyFilteredRows}
              showColumnFilters={true}
              globalSearch={globalSearch}
              onFilteredDataChange={setVisibleRows}
              rowKey={(row) => row.id}
              rowClassName={() => 'hover:bg-gray-50/40 transition-colors duration-150'}
            />
          </div>
        )}
      </div>
    </div>
  )
}
