import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Table, { type TableColumn } from '../components/Table'
import { fetchVirmanReport, type VirmanReportListItemDto } from '../api/virman'
import * as XLSX from 'xlsx'

/**
 * Satirin kendi para birimiyle bicimlendirir. Her kur kendi kovasinda yurur (2026-08-19):
 * dolar virmani ile TL virmani ayri satirlardir, tek rakamda toplanmaz.
 */
function formatMoney(n: number, symbol?: string) {
  const v = Number(n ?? 0)
  const sym = String(symbol ?? '').trim() || '₺'
  return `${sym}${v.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

type Row = VirmanReportListItemDto & {
  actions: string
}

export default function VirmanReportPage() {
  const navigate = useNavigate()

  const [items, setItems] = useState<VirmanReportListItemDto[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [globalSearch, setGlobalSearch] = useState('')
  const [currencyFilter, setCurrencyFilter] = useState<number>(0)
  const [availableCurrencies, setAvailableCurrencies] = useState<number[]>([1])

  const load = async (currencyTypeId?: number) => {
    const ac = new AbortController()
    try {
      setLoading(true)
      setError(null)
      const selected = currencyTypeId ?? currencyFilter
      const data = await fetchVirmanReport({ signal: ac.signal, currencyTypeId: selected || null })
      setItems(data?.items ?? [])
      setAvailableCurrencies(data?.availableCurrencyTypeIds?.length ? data.availableCurrencyTypeIds : [1])
    } catch (e: any) {
      setError(String(e?.message ?? 'Virman raporu alınamadı'))
      setItems([])
    } finally {
      setLoading(false)
    }
    return () => ac.abort()
  }

  useEffect(() => {
    void load()
  }, [])

  const rows: Row[] = useMemo(() => {
    return (items ?? []).map((x) => ({
      ...x,
      actions: ''
    }))
  }, [items])

  const filteredRows = useMemo(() => {
    const q = globalSearch.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) =>
      String(r.customerCode ?? '').toLowerCase().includes(q) ||
      String(r.customerName ?? '').toLowerCase().includes(q)
    )
  }, [rows, globalSearch])

  /**
   * TOPLAM SATIRI YALNIZ TEK PARA BİRİMİNDE ANLAMLIDIR (2026-08-19).
   *
   * Rapor artık para birimi başına ayrı satır döndürüyor; hepsini toplamak dolar ile lirayı
   * aynı rakamda toplamak demek. Görünen satırlar tek para biriminde değilse toplam
   * gösterilmez — üstteki döviz düğmesinden bir para birimi seçilmesi beklenir.
   */
  const totals = useMemo(() => {
    const currencies = new Set(filteredRows.map((r) => String(r.paraBirimi ?? 'TL')))
    const isSingleCurrency = currencies.size <= 1
    const symbol = filteredRows[0]?.paraBirimiSimge

    let debitAmount = 0
    let creditAmount = 0
    let balance = 0
    for (const r of filteredRows) {
      debitAmount += Number(r.debitAmount ?? 0)
      creditAmount += Number(r.creditAmount ?? 0)
      balance += Number(r.balance ?? 0)
    }
    return { debitAmount, creditAmount, balance, isSingleCurrency, symbol }
  }, [filteredRows])

  const columns: TableColumn<Row>[] = useMemo(
    () => [
      { key: 'customerCode', label: 'Cari Kodu', searchable: true, sortable: true },
      { key: 'customerName', label: 'Cari Ünvanı', searchable: true, sortable: true },
      { key: 'paraBirimi', label: 'Döviz', searchable: true, sortable: true, render: (v) => <span className="font-semibold text-slate-600">{String(v ?? 'TL')}</span> },
      { key: 'creditAmount', label: 'Giriş (Alacak)', searchable: true, sortable: true, render: (v, r) => formatMoney(Number(v ?? 0), r?.paraBirimiSimge) },
      { key: 'debitAmount', label: 'Çıkış (Borç)', searchable: true, sortable: true, render: (v, r) => formatMoney(Number(v ?? 0), r?.paraBirimiSimge) },
      { key: 'balance', label: 'Bakiye', searchable: true, sortable: true, render: (v, r) => formatMoney(Number(v ?? 0), r?.paraBirimiSimge) },
      {
        key: 'actions',
        label: '',
        render: (_v, row) => (
          <div className="flex items-center justify-end">
            <button
              type="button"
              className="inline-flex items-center gap-1 h-[24px] px-2 rounded-md text-[10px] font-medium bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-100 transition-colors"
              onClick={(e) => {
                e.stopPropagation()
                navigate(`/reports/virmanRaporlari/${encodeURIComponent(String(row.customerCode ?? ''))}`)
              }}
            >
              Detay
            </button>
          </div>
        )
      }
    ],
    [navigate]
  )

  const exportToExcel = () => {
    const excelData = filteredRows.map((r) => ({
      'Cari Kodu': String(r.customerCode ?? ''),
      'Cari Ünvanı': String(r.customerName ?? ''),
      'Giriş (Alacak)': Number(r.creditAmount ?? 0),
      'Çıkış (Borç)': Number(r.debitAmount ?? 0),
      'Bakiye': Number(r.balance ?? 0)
    }))

    excelData.push({
      'Cari Kodu': 'TOPLAM',
      'Cari Ünvanı': '',
      'Giriş (Alacak)': totals.creditAmount,
      'Çıkış (Borç)': totals.debitAmount,
      'Bakiye': totals.balance
    })

    const ws = XLSX.utils.json_to_sheet(excelData)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Virman Raporları')

    const colWidths = [
      { wch: 15 },
      { wch: 35 },
      { wch: 18 },
      { wch: 18 },
      { wch: 18 }
    ]
    ws['!cols'] = colWidths

    XLSX.writeFile(wb, 'virman-raporlari.xlsx')
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-gray-900 tracking-tight">Virman Raporu</h1>
          <p className="text-xs text-gray-400 mt-0.5">Raporlar / Virman Raporları</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 bg-gray-50 p-0.5 rounded-lg border border-gray-200">
            <span className="text-[10px] font-bold text-gray-400 px-2 uppercase tracking-wider">Döviz:</span>
            <button
              type="button"
              onClick={() => { setCurrencyFilter(0); void load(0) }}
              className={`h-[28px] px-2.5 text-xs font-bold rounded-md transition ${
                currencyFilter === 0 ? 'bg-slate-900 text-white shadow-sm' : 'text-gray-600 hover:bg-gray-200'
              }`}
            >
              Tümü
            </button>
            {availableCurrencies.map((curId) => {
              const meta =
                curId === 2 ? { label: '€ EUR', active: 'bg-amber-600' } :
                curId === 3 ? { label: '$ USD', active: 'bg-emerald-600' } :
                curId === 4 ? { label: '£ GBP', active: 'bg-purple-600' } :
                { label: '₺ TL', active: 'bg-blue-600' }
              return (
                <button
                  key={curId}
                  type="button"
                  onClick={() => { setCurrencyFilter(curId); void load(curId) }}
                  className={`h-[28px] px-2.5 text-xs font-bold rounded-md transition ${
                    currencyFilter === curId ? `${meta.active} text-white shadow-sm` : 'text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {meta.label}
                </button>
              )
            })}
          </div>

          <div className="relative">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
            <input
              value={globalSearch}
              onChange={(e) => setGlobalSearch(e.target.value)}
              placeholder="Arama..."
              className="h-[34px] w-72 pl-8 pr-3 text-xs border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-400 transition"
            />
          </div>
          <button
            type="button"
            onClick={exportToExcel}
            disabled={filteredRows.length === 0}
            className="h-[34px] inline-flex items-center gap-1.5 px-4 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /><polyline points="10 9 9 9 8 9" /></svg>
            Excel İndir
          </button>
          <button
            type="button"
            onClick={() => void load()}
            className="h-[34px] inline-flex items-center gap-1.5 px-4 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" /></svg>
            Yenile
          </button>
        </div>
      </div>

      {error && <div className="mb-3 text-xs font-semibold text-red-600">{error}</div>}
      {loading && <div className="mt-2 text-xs text-gray-500">Yükleniyor...</div>}

      <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-visible relative">
        <Table
          onRefresh={() => void load()} columns={columns} data={filteredRows} showColumnFilters globalSearch={globalSearch} />
      </div>

      {filteredRows.length > 0 && (
        <div className="mt-0 bg-emerald-50 border border-emerald-200 rounded-b-xl shadow-sm overflow-hidden -mt-[1px]">
          <div className="grid grid-cols-7 text-[11px] font-bold text-emerald-900">
            <div className="px-3 py-2.5">TOPLAM</div>
            <div className="px-3 py-2.5" />
            <div className="px-3 py-2.5" />
            <div className="px-3 py-2.5 text-right">
              {totals.isSingleCurrency ? formatMoney(totals.creditAmount, totals.symbol) : '—'}
            </div>
            <div className="px-3 py-2.5 text-right">
              {totals.isSingleCurrency ? formatMoney(totals.debitAmount, totals.symbol) : '—'}
            </div>
            <div className="px-3 py-2.5 text-right">
              {totals.isSingleCurrency
                ? formatMoney(totals.balance, totals.symbol)
                : <span className="font-normal text-emerald-700">Toplam için döviz seçin</span>}
            </div>
            <div className="px-3 py-2.5" />
          </div>
        </div>
      )}
    </div>
  )
}
