import React, { useEffect, useMemo, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { FileSpreadsheet, Filter, RefreshCw, Search, X } from 'lucide-react'
import Table, { type TableColumn } from '../components/Table'
import { fetchCustomerDebitCreditReport, type CustomerDebitCreditItemDto } from '../api/reports'

type LayoutContext = {
  isSuperAdmin?: boolean
  allowedKeys?: Set<string>
}

type DebitCreditRow = CustomerDebitCreditItemDto & {
  isTotalRow?: boolean
}

type BalanceFilterOperator = 'gt' | 'lt'
type BalanceQuickFilter = 'all' | 'withBalance' | 'zeroBalance'

/**
 * Sayfa PARA BİRİMİ BAŞINA çalışıyor ama tutarlar sabit `₺` ile basılıyordu: USD seçiliyken
 * bile bütün sütunlar TL görünüyordu (kullanıcı bildirimi). Simge artık seçili para biriminden.
 */
function currencySymbolOf(currencyTypeId: number) {
  const v = Number(currencyTypeId ?? 1)
  if (v === 2) return '€'
  if (v === 3) return '$'
  if (v === 4) return '£'
  return '₺'
}

function formatMoney(n: number, currencyTypeId: number = 1) {
  const v = Number(n ?? 0)
  return `${currencySymbolOf(currencyTypeId)}${v.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function formatDate(v: any) {
  if (!v) return '—'
  const d = new Date(v)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('tr-TR')
}

const DEBIT_CREDIT_CURRENCY_LABELS: Record<number, string> = { 1: 'TL', 2: 'EUR', 3: 'USD', 4: 'GBP' }

function parseBalanceFilterValue(raw: string) {
  const normalized = raw
    .replace(/[₺$€£\s]/g, '')
    .replace(/\./g, '')
    .replace(',', '.')
  const value = Number(normalized)
  return Number.isFinite(value) ? value : null
}

export default function CustomerDebitCreditPage() {
  const { isSuperAdmin } = useOutletContext<LayoutContext>()

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reportData, setReportData] = useState<CustomerDebitCreditItemDto[] | null>(null)
  const [globalSearch, setGlobalSearch] = useState('')
  const [balanceFilterOperator, setBalanceFilterOperator] = useState<BalanceFilterOperator>('gt')
  const [balanceFilterValue, setBalanceFilterValue] = useState('')
  const [activeBalanceFilter, setActiveBalanceFilter] = useState<{ operator: BalanceFilterOperator; value: number } | null>(null)
  const [balanceQuickFilter, setBalanceQuickFilter] = useState<BalanceQuickFilter>('all')

  // Borc/alacak PARA BIRIMI BASINA yurur (2026-08-17): dolar borcu TL tahsilatla
  // kapanmaz, tutarlar TL'ye cevrilip toplanmaz. Varsayilan TL.
  const [selectedCurrencyTypeId, setSelectedCurrencyTypeId] = useState<number>(1)
  const [availableCurrencyTypeIds, setAvailableCurrencyTypeIds] = useState<number[]>([1])

  const loadData = async (currencyTypeId: number, signal?: AbortSignal) => {
    try {
      setLoading(true)
      setError(null)
      const data = await fetchCustomerDebitCreditReport(currencyTypeId, signal)
      setAvailableCurrencyTypeIds(
        Array.from(new Set([...(data.availableCurrencyTypeIds ?? []), 1])).sort((a, b) => a - b)
      )
      setReportData(data.items ?? [])
    } catch (e: any) {
      if (e?.name === 'AbortError') return
      setError(e?.message ?? 'Cari borç alacak raporu yüklenemedi.')
      setReportData(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const ac = new AbortController()
    void loadData(selectedCurrencyTypeId, ac.signal)
    return () => ac.abort()
  }, [selectedCurrencyTypeId])

  const applyBalanceFilter = () => {
    const value = parseBalanceFilterValue(balanceFilterValue)
    if (value === null) {
      setActiveBalanceFilter(null)
      return
    }
    setBalanceQuickFilter('all')
    setActiveBalanceFilter({ operator: balanceFilterOperator, value })
  }

  const clearBalanceFilter = () => {
    setBalanceFilterValue('')
    setActiveBalanceFilter(null)
    setBalanceQuickFilter('all')
  }

  const filteredReportData = useMemo(() => {
    if (!reportData) return []
    return reportData.filter((item) => {
      const balance = Number(item.bakiye ?? 0)
      if (balanceQuickFilter === 'withBalance') return Math.abs(balance) > 0.009
      if (balanceQuickFilter === 'zeroBalance') return Math.abs(balance) <= 0.009
      if (!activeBalanceFilter) return true
      return activeBalanceFilter.operator === 'gt'
        ? balance > activeBalanceFilter.value
        : balance < activeBalanceFilter.value
    })
  }, [reportData, activeBalanceFilter, balanceQuickFilter])

  const grandTotals = useMemo(() => {
    return filteredReportData.reduce(
      (acc, item) => {
        acc.borc += item.borc ?? 0
        acc.alacak += item.alacak ?? 0
        acc.bakiye += item.bakiye ?? 0
        return acc
      },
      { borc: 0, alacak: 0, bakiye: 0 }
    )
  }, [filteredReportData])

  /*
    TOPLAM ARTIK SATIR DEĞİL, TABLONUN ALT ALTLIĞI (2026-09-02 kullanıcı isteği).

    Önceden listenin sonuna `isTotalRow: true` olan bir "GENEL TOPLAM" satırı ekleniyordu.
    O satır sayfanın kendi süzgeçlerinden (para birimi, bakiye kısayolu) hesaplanıyordu ama
    TABLONUN SÜTUN SÜZGEÇLERİNİ GÖRMÜYORDU: Cari Grup'tan TEDARİKÇİ seçince liste süzülüyor,
    alttaki toplam eski haliyle kalıyordu.

    Yerine ortak tablonun `showTotal` altlığı kullanılıyor; altlık GÖRÜNEN satırlardan
    hesaplanır, süzdükçe toplam da süzülür. Aynı çözüm Muhasebe Satış Raporu'nda da var.

    DİKKAT: elle eklenen toplam satırını geri koymayın. Altlık satırları toplarken onu da
    sayar ve tutarlar İKİ KATINA çıkar.
  */
  const tableRows = useMemo<DebitCreditRow[]>(() => {
    if (!reportData) return []
    return filteredReportData.map((x) => ({ ...x }))
  }, [reportData, filteredReportData])

  /** Sütun başlıkları seçili para birimini taşır: "Borç (USD)" gibi. */
  const selectedCurrencyLabel = DEBIT_CREDIT_CURRENCY_LABELS[selectedCurrencyTypeId] ?? 'TL'

  /*
    Toplam altlığının para birimi. Başlıktaki etiket "TL" ama altlık ISO kodu bekliyor:
    TL yerine TRY. Buradan geçirilmezse altlık tutarı para birimsiz yazar ve dolar raporu
    ile TL raporunun toplamı birbirinin aynı görünür.
  */
  const selectedTotalCurrencyCode = selectedCurrencyTypeId === 1 ? 'TRY' : selectedCurrencyLabel

  /*
    Cari Grup süzgeci ONAY KUTUSU (2026-09-02 kullanıcı isteği): aynı anda hem BAYİ hem
    TEDARİKÇİ seçilebilsin. Seçenekler veriden türetiliyor; sabit liste yazılırsa yeni bir
    grup eklendiğinde süzgeçte görünmez. GENEL TOPLAM satırının boş grubu listeye girmesin.
  */
  const cariGrupSecenekleri = useMemo(() => {
    const kume = new Set<string>()
    for (const row of reportData ?? []) {
      const g = String(row.cariGrup ?? '').trim()
      if (g) kume.add(g.toUpperCase())
    }
    return Array.from(kume)
      .sort((a, b) => a.localeCompare(b, 'tr-TR'))
      .map((v) => ({ label: v, value: v }))
  }, [reportData])

  const columns = useMemo<TableColumn<DebitCreditRow>[]>(
    () => [
      {
        key: 'plasiyer',
        label: 'Plasiyer',
        searchable: true,
        sortable: true,
        render: (val, row) =>
          row.isTotalRow ? null : <span className="text-gray-600 text-[11px] font-semibold whitespace-nowrap">{String(val || '—')}</span>
      },
      {
        key: 'cariAdi',
        label: 'Cari Adı',
        searchable: true,
        sortable: true,
        render: (val, row) => {
          if (row.isTotalRow) {
            return <span className="font-extrabold text-gray-900 uppercase text-xs">{String(val)}</span>
          }
          const match = String(val ?? '').match(/^\(([^)]+)\)/)
          const customerCode = match ? match[1] : ''
          if (!customerCode) {
            return <span className="text-gray-950 font-semibold text-xs">{String(val || '—')}</span>
          }
          const isSupplier = String(row.cariGrup ?? '').trim().toUpperCase() === 'TEDARIKCI'
          const linkUrl = isSupplier
            ? `/reports/cariEkstre?supplierCode=${customerCode}`
            : `/reports/cariEkstre?customerCode=${customerCode}`
          // YENİ SEKMEDE açılır: ekstreye gidip geri dönünce bu sayfanın süzgeçleri, sıralaması
          // ve sayfa konumu sıfırlanıyordu. Bağ (<a>) olarak duruyor ki orta tık / Ctrl+tık da
          // kullanıcının beklediği gibi çalışsın.
          return (
            <a
              href={linkUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 hover:text-blue-800 underline font-semibold text-left transition-colors uppercase text-xs block"
            >
              {String(val)}
            </a>
          )
        }
      },
      {
        key: 'cariGrup',
        label: 'Cari Grup',
        searchable: true,
        sortable: true,
        filter: { type: 'checkbox', options: cariGrupSecenekleri },
        // Rozet JSX döndüğü için süzgeç ham metni buradan okur; yoksa hiçbir şey eşleşmez.
        filterValue: (row) => (row.isTotalRow ? '' : String(row.cariGrup ?? 'BAYI').trim().toUpperCase()),
        render: (val, row) => {
          if (row.isTotalRow) return null
          const isBayi = String(val ?? '').trim().toUpperCase() === 'BAYI'
          const badgeClass = isBayi
            ? 'bg-blue-50 text-blue-700 border border-blue-200/50'
            : 'bg-indigo-50 text-indigo-700 border border-indigo-200/50'
          return (
            <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${badgeClass}`}>
              {String(val || 'BAYI')}
            </span>
          )
        }
      },
      {
        key: 'bolge',
        label: 'Bölge',
        searchable: true,
        sortable: true,
        render: (val, row) =>
          row.isTotalRow ? null : <span className="text-gray-600 text-xs uppercase whitespace-nowrap">{String(val || '—')}</span>
      },
      {
        key: 'telefon',
        label: 'Telefon',
        searchable: true,
        sortable: true,
        render: (val, row) =>
          row.isTotalRow ? null : <span className="text-gray-500 text-xs font-mono">{String(val || '—')}</span>
      },
      {
        key: 'borc',
        label: `Borç (${selectedCurrencyLabel})`,
        sortable: true,
        showTotal: true,
        totalCurrencyCode: selectedTotalCurrencyCode,
        render: (val, row) => (
          <span className={`text-right block text-xs ${row.isTotalRow ? 'font-extrabold text-gray-900' : 'text-gray-700 font-semibold'}`}>
            {formatMoney(Number(val ?? 0), selectedCurrencyTypeId)}
          </span>
        )
      },
      {
        key: 'alacak',
        label: `Alacak (${selectedCurrencyLabel})`,
        sortable: true,
        showTotal: true,
        totalCurrencyCode: selectedTotalCurrencyCode,
        render: (val, row) => (
          <span className={`text-right block text-xs ${row.isTotalRow ? 'font-extrabold text-gray-900' : 'text-gray-700 font-semibold'}`}>
            {formatMoney(Number(val ?? 0), selectedCurrencyTypeId)}
          </span>
        )
      },
      {
        key: 'bakiye',
        label: `Bakiye (${selectedCurrencyLabel})`,
        sortable: true,
        showTotal: true,
        totalCurrencyCode: selectedTotalCurrencyCode,
        render: (val, row) => {
          const num = Number(val ?? 0)
          const isNegative = num < 0
          const colorClass = row.isTotalRow
            ? 'text-gray-900 font-extrabold'
            : isNegative
            ? 'text-red-600 font-bold'
            : 'text-emerald-600 font-bold'
          return (
            <span className={`text-right block text-xs ${colorClass}`}>
              {formatMoney(num, selectedCurrencyTypeId)}
            </span>
          )
        }
      },
      {
        key: 'sonOdeme',
        label: `Son Ödeme (${selectedCurrencyLabel})`,
        sortable: true,
        render: (val, row) => {
          if (row.isTotalRow) return null
          if (val == null) return <span className="text-gray-400 text-right block text-xs">—</span>
          return (
            <span className="text-right block text-xs text-gray-700 font-semibold">
              {formatMoney(Number(val), selectedCurrencyTypeId)}
            </span>
          )
        }
      },
      {
        key: 'sonOdemeTarihi',
        label: 'Son Ödeme Tarihi',
        sortable: true,
        render: (val, row) => {
          if (row.isTotalRow) return null
          return <span className="text-center block text-xs text-gray-600 whitespace-nowrap">{formatDate(val)}</span>
        }
      }
    ],
    [selectedCurrencyTypeId, selectedCurrencyLabel, selectedTotalCurrencyCode, cariGrupSecenekleri]
  )

  const exportToExcel = () => {
    if (!reportData || filteredReportData.length === 0) return

    /*
      EXCEL'DE PARA BİRİMİ AÇIKÇA YAZAR (2026-08-19).

      Dosya hangi para biriminde çekildiğini hiç söylemiyordu: USD raporu ile TL raporu
      birbirinin aynı görünüyordu. Hem başlık satırında hem her tutar sütununda para birimi
      kodu var, ayrıca satır bazında "Para Birimi" sütunu eklendi (süzülebilsin diye).
    */
    const curLabel = selectedCurrencyLabel

    const headers = [
      'Plasiyer',
      'Cari Adi',
      'Cari Grup',
      'Bolge',
      'Telefon',
      'Para Birimi',
      `Borc (${curLabel})`,
      `Alacak (${curLabel})`,
      `Bakiye (${curLabel})`,
      `Son Odeme (${curLabel})`,
      'Son Odeme Tarihi'
    ]

    const csvRows = [`Cari Borc/Alacak Listesi - Para Birimi: ${curLabel}`, headers.join(';')]

    filteredReportData.forEach((item) => {
      const row = [
        item.plasiyer ?? '',
        item.cariAdi ?? '',
        item.cariGrup ?? 'BAYI',
        item.bolge ?? '',
        item.telefon ?? '',
        curLabel,
        item.borc.toFixed(2),
        item.alacak.toFixed(2),
        item.bakiye.toFixed(2),
        item.sonOdeme != null ? item.sonOdeme.toFixed(2) : '',
        item.sonOdemeTarihi ? item.sonOdemeTarihi.slice(0, 10) : ''
      ]
      csvRows.push(row.map((val) => `"${String(val ?? '').replace(/"/g, '""')}"`).join(';'))
    })

    const totalRow = [
      'GENEL TOPLAM',
      '',
      '',
      '',
      '',
      curLabel,
      grandTotals.borc.toFixed(2),
      grandTotals.alacak.toFixed(2),
      grandTotals.bakiye.toFixed(2),
      '',
      ''
    ]
    csvRows.push(totalRow.join(';'))

    const csvContent = '\uFEFF' + csvRows.join('\n')
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.setAttribute('href', url)
    link.setAttribute('download', `Cari_Borc_Alacak_Listesi_${curLabel}_${new Date().toISOString().slice(0, 10)}.csv`)
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
            Cari Borç Alacak Listesi
            <span className="text-[10px] font-bold text-red-600 bg-red-50 border border-red-200/50 px-2.5 py-1 rounded-full uppercase tracking-wider">
              Rapor
            </span>
          </h1>
          <p className="text-xs text-gray-500 mt-1">Carilerin borç, alacak, bakiye ve en son yaptıkları ödeme miktarı ile ödeme tarihlerini takip edin.</p>
        </div>

        {/* Global Controls */}
        <div className="flex items-center gap-3">
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
                  {DEBIT_CREDIT_CURRENCY_LABELS[cid] ?? String(cid)}
                </button>
              ))}
            </div>
          </div>

          <button
            type="button"
            onClick={exportToExcel}
            disabled={!reportData || reportData.length === 0}
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
            placeholder="Cari adı, plasiyer, bölge veya grup ile ara..."
            value={globalSearch}
            onChange={(e) => setGlobalSearch(e.target.value)}
            className="w-full h-10 pl-10 pr-4 rounded-2xl border border-gray-200 bg-white/80 text-xs shadow-sm focus:ring-4 focus:ring-red-500/10 focus:border-red-600 transition-all placeholder:text-gray-400"
          />
        </div>
        <button
          type="button"
          onClick={() => void loadData(selectedCurrencyTypeId)}
          disabled={loading}
          className="h-10 px-5 rounded-2xl border border-gray-200 bg-white text-xs font-bold hover:bg-gray-50 text-gray-700 flex items-center justify-center gap-2 transition-all shadow-sm active:scale-98 disabled:opacity-50"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          Yenile
        </button>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center gap-2 rounded-2xl border border-gray-200 bg-white/80 p-2 shadow-sm">
        <div className="flex items-center gap-2 px-2 text-[10px] font-bold uppercase tracking-wider text-gray-400">
          <Filter size={13} />
          Bakiye Filtresi
        </div>
        <select
          value={balanceFilterOperator}
          onChange={(e) => setBalanceFilterOperator(e.target.value as BalanceFilterOperator)}
          className="h-9 rounded-xl border border-gray-200 bg-white px-3 text-xs font-bold text-gray-700 focus:border-red-600 focus:ring-4 focus:ring-red-500/10"
        >
          <option value="gt">Büyük</option>
          <option value="lt">Küçük</option>
        </select>
        <input
          type="text"
          inputMode="decimal"
          value={balanceFilterValue}
          onChange={(e) => setBalanceFilterValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') applyBalanceFilter()
          }}
          placeholder={`Bakiye tutarı (${selectedCurrencyLabel})`}
          className="h-9 min-w-[180px] rounded-xl border border-gray-200 bg-white px-3 text-xs font-semibold text-gray-700 focus:border-red-600 focus:ring-4 focus:ring-red-500/10"
        />
        <button
          type="button"
          onClick={applyBalanceFilter}
          className="h-9 rounded-xl bg-red-600 px-4 text-xs font-bold text-white shadow-sm hover:bg-red-700"
        >
          Uygula
        </button>
        <div className="flex items-center gap-1 rounded-xl bg-gray-100 p-1">
          <button
            type="button"
            onClick={() => {
              setBalanceQuickFilter('withBalance')
              setActiveBalanceFilter(null)
            }}
            className={
              'h-7 rounded-lg px-3 text-[11px] font-bold transition-colors ' +
              (balanceQuickFilter === 'withBalance'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-gray-600 hover:bg-white')
            }
          >
            Bakiyesi Olanlar
          </button>
          <button
            type="button"
            onClick={() => {
              setBalanceQuickFilter('zeroBalance')
              setActiveBalanceFilter(null)
            }}
            className={
              'h-7 rounded-lg px-3 text-[11px] font-bold transition-colors ' +
              (balanceQuickFilter === 'zeroBalance'
                ? 'bg-gray-800 text-white shadow-sm'
                : 'text-gray-600 hover:bg-white')
            }
          >
            Bakiyesi Olmayanlar
          </button>
        </div>
        {activeBalanceFilter || balanceQuickFilter !== 'all' ? (
          <button
            type="button"
            onClick={clearBalanceFilter}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 text-xs font-bold text-gray-600 hover:bg-gray-50"
          >
            <X size={13} />
            Temizle
          </button>
        ) : null}
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
            <p className="text-xs font-semibold">Cari Borç Alacak Listesi Hesaplanıyor...</p>
          </div>
        ) : (
          <div className="overflow-x-auto w-full">
            <Table<DebitCreditRow>
          onRefresh={() => void loadData(selectedCurrencyTypeId)}
              columns={columns}
              data={tableRows}
              showColumnFilters={true}
              globalSearch={globalSearch}
              rowKey={(row, idx) => (row.isTotalRow ? 'GRAND_TOTAL' : row.cariAdi + '_' + idx)}
              rowClassName={(row) =>
                row.isTotalRow
                  ? 'bg-slate-100 border-t-2 border-slate-300 font-extrabold hover:bg-slate-100 cursor-default'
                  : 'hover:bg-gray-50/40 transition-colors duration-150'
              }
            />
          </div>
        )}
      </div>
    </div>
  )
}
