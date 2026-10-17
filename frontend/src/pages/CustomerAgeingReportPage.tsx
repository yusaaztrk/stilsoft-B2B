import React, { useEffect, useMemo, useState } from 'react'
import { useOutletContext, useLocation } from 'react-router-dom'
import { FileSpreadsheet, RefreshCw, Search } from 'lucide-react'
import Table, { type TableColumn } from '../components/Table'
import CariEkstreModal from '../components/CariEkstreModal'
import { fetchCustomerAgeingReport, fetchSupplierAgeingReport, type CustomerAgeingReportItemDto } from '../api/reports'

type LayoutContext = {
  isSuperAdmin?: boolean
  allowedKeys?: Set<string>
}

type AgeingRow = {
  customerCode: string
  customerName: string
  region: string
  salesmanName: string
  group: string
  totalDebit: number
  devir: number
  jan: number
  feb: number
  mar: number
  apr: number
  may: number
  jun: number
  jul: number
  aug: number
  sep: number
  oct: number
  nov: number
  dec: number
  isTotalRow?: boolean
}

const CURRENCY_LABELS: Record<number, string> = { 1: 'TL', 2: 'EUR', 3: 'USD', 4: 'GBP' }

function currencySymbolOf(currencyTypeId: number) {
  const v = Number(currencyTypeId ?? 1)
  if (v === 2) return '€'
  if (v === 3) return '$'
  if (v === 4) return '£'
  return '₺'
}

/** Rapor tek para biriminde çalışır; simge seçili para biriminden gelir (eskiden hiç yoktu). */
function formatMoney(n: number, currencyTypeId?: number) {
  const v = Number(n ?? 0)
  const text = v.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  if (currencyTypeId === undefined || currencyTypeId === null) return text
  return `${currencySymbolOf(currencyTypeId)}${text}`
}

export default function CustomerAgeingReportPage() {
  const { isSuperAdmin } = useOutletContext<LayoutContext>()
  const location = useLocation()

  const [loading, setLoading] = useState(false)
  const [lastLoadedAt, setLastLoadedAt] = useState<Date | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reportData, setReportData] = useState<{
    year: number
    currencyCode: string
    items: CustomerAgeingReportItemDto[]
    grandTotalDebit: number
    grandTotalDevir: number
    grandMonthlyTotals: number[]
  } | null>(null)

  const [selectedYear, setSelectedYear] = useState<number>(() => new Date().getFullYear())
  const [globalSearch, setGlobalSearch] = useState('')

  // Yaslandirma PARA BIRIMI BASINA yurur (2026-08-17): dolar borcu TL odemeyle kapanmaz,
  // tutarlar TL'ye cevrilip toplanmaz. Varsayilan TL — eski ekranla ayni gorunum.
  const [selectedCurrencyTypeId, setSelectedCurrencyTypeId] = useState<number>(1)
  const [availableCurrencyTypeIds, setAvailableCurrencyTypeIds] = useState<number[]>([1])

  const yearOptions = useMemo(() => {
    const currentYear = new Date().getFullYear()
    const options = []
    // 10 YIL (denetim md. 16): sınır 5 yıldı, denetim/dava için daha eski yaşlandırma
    // görüntülenemiyordu. Yasal saklama süresi 10 yıl olduğu için aralık ona çekildi.
    for (let y = currentYear; y >= currentYear - 10; y--) {
      options.push({ value: String(y), label: String(y) })
    }
    return options
  }, [])

  const loadData = async (year: number, currencyTypeId: number, signal?: AbortSignal) => {
    try {
      setLoading(true)
      setError(null)
      const [custData, suppData] = await Promise.all([
        fetchCustomerAgeingReport(year, currencyTypeId, signal),
        fetchSupplierAgeingReport(year, currencyTypeId, signal)
      ])

      // Iki raporda gecen para birimlerinin birlesimi sugec dugmelerini olusturur.
      const currencies = Array.from(
        new Set([
          ...(custData.availableCurrencyTypeIds ?? []),
          ...(suppData.availableCurrencyTypeIds ?? []),
          1
        ])
      ).sort((a, b) => a - b)
      setAvailableCurrencyTypeIds(currencies)

      // Merge items from both customer and supplier reports
      const mergedItems = [...custData.items, ...suppData.items]

      // Re-calculate consolidated grand totals
      const grandTotalDebit = custData.grandTotalDebit + suppData.grandTotalDebit
      const grandTotalDevir = custData.grandTotalDevir + suppData.grandTotalDevir
      const grandMonthlyTotals = new Array(12).fill(0).map((_, i) => 
        (custData.grandMonthlyTotals[i] ?? 0) + (suppData.grandMonthlyTotals[i] ?? 0)
      )

      setReportData({
        year,
        currencyCode: custData.currencyCode || suppData.currencyCode || 'TRY',
        items: mergedItems,
        grandTotalDebit,
        grandTotalDevir,
        grandMonthlyTotals
      })
      setLastLoadedAt(new Date())
    } catch (e: any) {
      if (e?.name === 'AbortError') return
      setError(e?.message ?? 'Yaşlandırma raporu yüklenemedi.')
      setReportData(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const ac = new AbortController()
    void loadData(selectedYear, selectedCurrencyTypeId, ac.signal)
    return () => ac.abort()
  }, [selectedYear, selectedCurrencyTypeId])

  /**
   * SAAT BAŞI YENİLEME — rozet vardı, yenileme YOKTU (2026-08-19).
   *
   * Başlıktaki "Saat Başı Yenilenir" rozeti sadece bir yazıydı: ne istemcide zamanlayıcı ne
   * sunucuda saatlik bir önbellek vardı, sayfa yalnızca açılışta ve "Yenile" düğmesiyle
   * yükleniyordu. Rozet artık gerçeği söylüyor; son yükleme saati de yanında yazıyor ki
   * kullanıcı doğrulayabilsin.
   */
  useEffect(() => {
    const timer = window.setInterval(() => {
      void loadData(selectedYear, selectedCurrencyTypeId)
    }, 60 * 60 * 1000)
    return () => window.clearInterval(timer)
  }, [selectedYear, selectedCurrencyTypeId])

  const selectedCurrencyLabel = CURRENCY_LABELS[selectedCurrencyTypeId] ?? 'TRY'

  /**
   * Cari adı ekstreyi PENCEREDE açar (2026-09-25 kullanıcı isteği) — Fatura Dökümü ile aynı
   * bileşen (`CariEkstreModal`). Eskiden Cari Ekstre sayfasına gidiyordu ve rapor kayboluyordu;
   * tedarikçi kodu (`320-…`) geldiğinde modal kendi içinde tedarikçi ucuna gidiyor.
   */
  const [ekstreOpen, setEkstreOpen] = useState(false)
  const [ekstreCari, setEkstreCari] = useState<{ kod: string; ad: string } | null>(null)
  const openEkstre = (kod: string, ad: string) => {
    if (!String(kod ?? '').trim()) return
    setEkstreCari({ kod: kod.trim(), ad })
    setEkstreOpen(true)
  }

  // Map API items; totals are rendered by the shared table footer so they stay visible
  // under the columns instead of falling onto the last pagination page.
  const tableRows = useMemo<AgeingRow[]>(() => {
    if (!reportData) return []

    return reportData.items.map((x) => ({
      customerCode: x.customerCode,
      customerName: x.customerName,
      region: x.region,
      salesmanName: x.salesmanName ?? '—',
      group: x.group,
      totalDebit: x.totalDebit,
      devir: x.devir,
      jan: x.monthlyDebits[0] ?? 0,
      feb: x.monthlyDebits[1] ?? 0,
      mar: x.monthlyDebits[2] ?? 0,
      apr: x.monthlyDebits[3] ?? 0,
      may: x.monthlyDebits[4] ?? 0,
      jun: x.monthlyDebits[5] ?? 0,
      jul: x.monthlyDebits[6] ?? 0,
      aug: x.monthlyDebits[7] ?? 0,
      sep: x.monthlyDebits[8] ?? 0,
      oct: x.monthlyDebits[9] ?? 0,
      nov: x.monthlyDebits[10] ?? 0,
      dec: x.monthlyDebits[11] ?? 0
    }))
  }, [reportData])

  // Custom cell background renderer matching user SS
  const renderAgeingCell = (val: number, isTotalRow?: boolean) => {
    if (isTotalRow) {
      return (
        <span className="font-extrabold text-gray-900 text-center block">
          {formatMoney(val, selectedCurrencyTypeId)}
        </span>
      )
    }

    const hasDebt = val > 0.009 // Floating point tolerance
    const bgStyle = hasDebt 
      ? { backgroundColor: '#dc2626', color: '#ffffff', fontWeight: 'bold' } 
      : { backgroundColor: '#87d37c', color: '#0f2d1a' }

    return (
      <div 
        className="w-[calc(100%+16px)] h-[calc(100%+8px)] py-2 px-2 flex items-center justify-center text-center -mx-2 -my-1 min-h-[32px] transition-colors"
        style={bgStyle}
      >
        <span className="text-[11px] font-semibold">{formatMoney(val, selectedCurrencyTypeId)}</span>
      </div>
    )
  }

  const columns = useMemo<TableColumn<AgeingRow>[]>(() => [
    {
      key: 'region',
      label: 'Bölge',
      searchable: true,
      sortable: true,
      render: (val, row) => row.isTotalRow ? null : <span className="font-medium text-gray-600 uppercase text-[10px]">{String(val)}</span>
    },
    {
      key: 'customerName',
      label: 'Cari Adı',
      searchable: true,
      sortable: true,
      render: (val, row) => {
        if (row.isTotalRow) {
          return <span className="font-extrabold text-gray-900 uppercase text-xs">{String(val)}</span>
        }
        return (
          <button
            type="button"
            onClick={() => openEkstre(row.customerCode, String(val ?? ''))}
            className="text-blue-600 hover:text-blue-800 underline font-semibold text-left transition-colors uppercase text-xs"
          >
            {String(val)}
          </button>
        )
      }
    },
    {
      key: 'salesmanName',
      label: 'Plasiyer',
      searchable: true,
      sortable: true,
      render: (val, row) => row.isTotalRow ? null : <span className="text-gray-600 text-[10px] font-semibold whitespace-nowrap">{String(val)}</span>
    },
    {
      key: 'group',
      label: 'Grup',
      searchable: true,
      sortable: true,
      render: (val, row) => {
        if (row.isTotalRow) return null
        const isSupplier = val === 'TEDARIKCI'
        const badgeClass = isSupplier 
          ? 'bg-amber-50 text-amber-700 border border-amber-200/50' 
          : 'bg-blue-50 text-blue-700 border border-blue-200/50'
        return (
          <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${badgeClass}`}>
            {isSupplier ? 'Tedarikçi' : String(val)}
          </span>
        )
      }
    },
    {
      key: 'totalDebit',
      label: 'Toplam Borç',
      sortable: true,
      showTotal: true,
      totalCurrencyCode: selectedCurrencyLabel,
      totalValue: reportData?.grandTotalDebit ?? 0,
      render: (val, row) => renderAgeingCell(Number(val), row.isTotalRow)
    },
    {
      key: 'devir',
      label: 'Devir',
      sortable: true,
      showTotal: true,
      totalCurrencyCode: selectedCurrencyLabel,
      totalValue: reportData?.grandTotalDevir ?? 0,
      render: (val, row) => renderAgeingCell(Number(val), row.isTotalRow)
    },
    { key: 'jan', label: 'Ocak', showTotal: true, totalCurrencyCode: selectedCurrencyLabel, totalValue: reportData?.grandMonthlyTotals?.[0] ?? 0, render: (val, row) => renderAgeingCell(Number(val), row.isTotalRow) },
    { key: 'feb', label: 'Şubat', showTotal: true, totalCurrencyCode: selectedCurrencyLabel, totalValue: reportData?.grandMonthlyTotals?.[1] ?? 0, render: (val, row) => renderAgeingCell(Number(val), row.isTotalRow) },
    { key: 'mar', label: 'Mart', showTotal: true, totalCurrencyCode: selectedCurrencyLabel, totalValue: reportData?.grandMonthlyTotals?.[2] ?? 0, render: (val, row) => renderAgeingCell(Number(val), row.isTotalRow) },
    { key: 'apr', label: 'Nisan', showTotal: true, totalCurrencyCode: selectedCurrencyLabel, totalValue: reportData?.grandMonthlyTotals?.[3] ?? 0, render: (val, row) => renderAgeingCell(Number(val), row.isTotalRow) },
    { key: 'may', label: 'Mayıs', showTotal: true, totalCurrencyCode: selectedCurrencyLabel, totalValue: reportData?.grandMonthlyTotals?.[4] ?? 0, render: (val, row) => renderAgeingCell(Number(val), row.isTotalRow) },
    { key: 'jun', label: 'Haziran', showTotal: true, totalCurrencyCode: selectedCurrencyLabel, totalValue: reportData?.grandMonthlyTotals?.[5] ?? 0, render: (val, row) => renderAgeingCell(Number(val), row.isTotalRow) },
    { key: 'jul', label: 'Temmuz', showTotal: true, totalCurrencyCode: selectedCurrencyLabel, totalValue: reportData?.grandMonthlyTotals?.[6] ?? 0, render: (val, row) => renderAgeingCell(Number(val), row.isTotalRow) },
    { key: 'aug', label: 'Ağustos', showTotal: true, totalCurrencyCode: selectedCurrencyLabel, totalValue: reportData?.grandMonthlyTotals?.[7] ?? 0, render: (val, row) => renderAgeingCell(Number(val), row.isTotalRow) },
    { key: 'sep', label: 'Eylül', showTotal: true, totalCurrencyCode: selectedCurrencyLabel, totalValue: reportData?.grandMonthlyTotals?.[8] ?? 0, render: (val, row) => renderAgeingCell(Number(val), row.isTotalRow) },
    { key: 'oct', label: 'Ekim', showTotal: true, totalCurrencyCode: selectedCurrencyLabel, totalValue: reportData?.grandMonthlyTotals?.[9] ?? 0, render: (val, row) => renderAgeingCell(Number(val), row.isTotalRow) },
    { key: 'nov', label: 'Kasım', showTotal: true, totalCurrencyCode: selectedCurrencyLabel, totalValue: reportData?.grandMonthlyTotals?.[10] ?? 0, render: (val, row) => renderAgeingCell(Number(val), row.isTotalRow) },
    { key: 'dec', label: 'Aralık', showTotal: true, totalCurrencyCode: selectedCurrencyLabel, totalValue: reportData?.grandMonthlyTotals?.[11] ?? 0, render: (val, row) => renderAgeingCell(Number(val), row.isTotalRow) }
    // Para birimi değişince hücrelerdeki simge de değişmeli: `renderAgeingCell` seçili
    // para birimini okuyor, bu yüzden bağımlılıkta yer alıyor.
  ], [selectedCurrencyTypeId, selectedCurrencyLabel, reportData])

  const exportToExcel = () => {
    if (!reportData || reportData.items.length === 0) return

    /*
      Dosya hangi para biriminde çekildiğini söylemiyordu: TL ve USD raporları birbirinden
      ayırt edilemiyordu. Başlık satırı, tutar sütunları, satır bazında "Para Birimi" sütunu
      ve dosya adı — dördü birden para birimini taşıyor.
    */
    const curLabel = CURRENCY_LABELS[selectedCurrencyTypeId] ?? 'TL'

    const months = ['Ocak', 'Subat', 'Mart', 'Nisan', 'Mayis', 'Haziran', 'Temmuz', 'Agustos', 'Eylul', 'Ekim', 'Kasim', 'Aralik']
    const headers = [
      'Bolge',
      'Cari Kodu',
      'Cari Adi',
      'Plasiyer',
      'Grup',
      'Para Birimi',
      `Toplam Borc (${curLabel})`,
      `Devir (${curLabel})`,
      ...months.map((m) => `${m} (${curLabel})`)
    ]

    const csvRows = [
      `Yaslandirma Raporu - Yil: ${selectedYear} - Para Birimi: ${curLabel}`,
      headers.join(';')
    ]

    reportData.items.forEach((item) => {
      const row = [
        item.region,
        item.customerCode,
        item.customerName,
        item.salesmanName ?? '—',
        item.group,
        curLabel,
        item.totalDebit.toFixed(2),
        item.devir.toFixed(2),
        ...item.monthlyDebits.map(v => v.toFixed(2))
      ]
      csvRows.push(row.map(val => `"${String(val ?? '').replace(/"/g, '""')}"`).join(';'))
    })

    const totalRow = [
      'GENEL TOPLAM',
      '',
      '',
      '',
      '',
      curLabel,
      reportData.grandTotalDebit.toFixed(2),
      reportData.grandTotalDevir.toFixed(2),
      ...reportData.grandMonthlyTotals.map(v => v.toFixed(2))
    ]
    csvRows.push(totalRow.join(';'))

    const csvContent = '\uFEFF' + csvRows.join('\n')
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.setAttribute('href', url)
    const filename = `Cari_ve_Tedarikci_Yaslandirma_Raporu_${selectedYear}_${curLabel}.csv`
    link.setAttribute('download', filename)
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
            Yaşlandırma Raporu
            <span className="text-xs font-bold text-red-600 bg-red-50 border border-red-200/50 px-2.5 py-1 rounded-full">
              Saat Başı Yenilenir
              {lastLoadedAt ? (
                <span className="ml-1.5 font-semibold text-red-500/80">
                  · son: {lastLoadedAt.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}
                </span>
              ) : null}
            </span>
          </h1>
          <p className="text-xs text-gray-500 mt-1">Carilerin ve tedarikçilerin dönem bazlı devir tutarlarını ve aylık borç/alacak yaşlandırma durumlarını izleyin.</p>
        </div>

        {/* Global Controls */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Yıl</span>
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(Number(e.target.value))}
              className="h-10 px-4 rounded-2xl border border-gray-200 bg-white text-xs font-bold focus:ring-4 focus:ring-red-500/10 focus:border-red-600 transition-all shadow-sm"
            >
              {yearOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Para Birimi</span>
            <div className="flex items-center gap-1 p-1 rounded-2xl border border-gray-200 bg-white shadow-sm">
              {availableCurrencyTypeIds.map((cid) => (
                <button
                  key={cid}
                  type="button"
                  onClick={() => setSelectedCurrencyTypeId(cid)}
                  className={
                    'px-3 h-8 rounded-xl text-xs font-bold transition-all ' +
                    (cid === selectedCurrencyTypeId
                      ? 'bg-red-600 text-white shadow'
                      : 'text-gray-600 hover:bg-gray-100')
                  }
                >
                  {CURRENCY_LABELS[cid] ?? String(cid)}
                </button>
              ))}
            </div>
          </div>

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
            placeholder="Cari/Tedarikçi adı, kodu, plasiyeri veya bölgesi ile ara..."
            value={globalSearch}
            onChange={(e) => setGlobalSearch(e.target.value)}
            className="w-full h-10 pl-10 pr-4 rounded-2xl border border-gray-200 bg-white/80 text-xs shadow-sm focus:ring-4 focus:ring-red-500/10 focus:border-red-600 transition-all placeholder:text-gray-400"
          />
        </div>
        <button
          type="button"
          onClick={() => void loadData(selectedYear, selectedCurrencyTypeId)}
          disabled={loading}
          className="h-10 px-5 rounded-2xl border border-gray-200 bg-white text-xs font-bold hover:bg-gray-50 text-gray-700 flex items-center justify-center gap-2 transition-all shadow-sm active:scale-98 disabled:opacity-50"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          Yenile
        </button>
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
            <div className="w-10 h-10 border-4 border-red-600 border-t-transparent rounded-full animate-spin mb-4" />
            <p className="text-xs font-semibold">Rapor Hesaplanıyor...</p>
          </div>
        ) : (
          <div className="overflow-x-auto w-full">
            <Table<AgeingRow>
          onRefresh={() => void loadData(selectedYear, selectedCurrencyTypeId)}
              columns={columns}
              data={tableRows}
              showColumnFilters={true}
              globalSearch={globalSearch}
              rowKey={(row) => row.isTotalRow ? 'GRAND_TOTAL' : row.customerCode}
              rowClassName={(row) => 
                row.isTotalRow 
                  ? 'bg-gray-150 border-t-2 border-gray-300 font-bold' 
                  : 'hover:bg-gray-50/40 transition-colors duration-150'
              }
            />
          </div>
        )}
      </div>
      <CariEkstreModal open={ekstreOpen} cari={ekstreCari} onClose={() => setEkstreOpen(false)} />
    </div>
  )
}
