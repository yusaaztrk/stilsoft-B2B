import React from 'react'
import { useEffect, useMemo, useState } from 'react'
import Table, { type TableColumn } from '../components/Table'
import { fetchLimitRiskReport, type LimitRiskReportItemDto } from '../api/reports'

/**
 * Satirin kendi para birimiyle biçimlendirir.
 *
 * Rapor artik para birimi basina AYRI satir dondurur (2026-08-19): bir cari hem TL hem USD
 * calisiyorsa iki satir cikar ve her satirin butun tutarlari o paradadir. Sabit ₺ yazmak
 * dolar limitini lira gibi gosteriyordu.
 */
function formatMoney(n: number, symbol?: string) {
  const v = Number(n ?? 0)
  const sym = String(symbol ?? '').trim() || '₺'
  return `${sym}${v.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export default function LimitRiskSatisRaporuReport() {
  const [data, setData] = useState<LimitRiskReportItemDto[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [globalSearch, setGlobalSearch] = useState('')

  // PARA BİRİMİ SEÇİCİ (2026-08-19, kullanıcı isteği). 0 = "Tümü": her para birimi kendi
  // satırında listelenir. Bir para birimi seçilirse yalnız onun bakiyesi/limiti gösterilir.
  // Çevrim YOK — dolar bakiyesi euro bakiyesiyle toplanmaz.
  const [currencyFilter, setCurrencyFilter] = useState<number>(0)
  const [availableCurrencies, setAvailableCurrencies] = useState<number[]>([1])

  const load = async (currencyTypeId?: number) => {
    const ac = new AbortController()
    try {
      setLoading(true)
      setError(null)
      const selected = currencyTypeId ?? currencyFilter
      const res = await fetchLimitRiskReport(ac.signal, selected || null)
      setData(res?.items ?? [])
      setAvailableCurrencies(res?.availableCurrencyTypeIds?.length ? res.availableCurrencyTypeIds : [1])
    } catch (e: any) {
      setError(String(e?.message ?? 'Rapor alınamadı'))
      setData([])
    } finally {
      setLoading(false)
    }
    return () => ac.abort()
  }

  useEffect(() => {
    void load()
  }, [])

  const filteredRows = useMemo(() => {
    const q = globalSearch.trim().toLowerCase()
    if (!q) return data
    return data.filter((r) =>
      String(r.cariAdi ?? '').toLowerCase().includes(q) ||
      String(r.cariKodu ?? '').toLowerCase().includes(q) ||
      String(r.bolge ?? '').toLowerCase().includes(q) ||
      String(r.satisPersoneli ?? '').toLowerCase().includes(q)
    )
  }, [data, globalSearch])

  const currencyButtons = (
    <div className="flex items-center gap-1 bg-gray-50 p-0.5 rounded-lg border border-gray-200">
      <span className="text-[10px] font-bold text-gray-400 px-2 uppercase tracking-wider">Döviz:</span>
      <button
        type="button"
        onClick={() => {
          setCurrencyFilter(0)
          void load(0)
        }}
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
            onClick={() => {
              setCurrencyFilter(curId)
              void load(curId)
            }}
            className={`h-[28px] px-2.5 text-xs font-bold rounded-md transition ${
              currencyFilter === curId ? `${meta.active} text-white shadow-sm` : 'text-gray-600 hover:bg-gray-200'
            }`}
          >
            {meta.label}
          </button>
        )
      })}
    </div>
  )

  const columns: TableColumn<LimitRiskReportItemDto>[] = useMemo(
    () => [
      { key: 'bolge', label: 'Cari İl', searchable: true },
      { key: 'grupKodu', label: 'Grup Kodu', searchable: true },
      { key: 'cariKodu', label: 'Cari Kodu', searchable: true },
      { key: 'cariAdi', label: 'Cari İsim', searchable: true },
      { key: 'paraBirimiKodu', label: 'Para Birimi', searchable: true, render: (v) => String(v ?? 'TL') },
      { key: 'borc', label: 'Borç', searchable: true, render: (v, row) => formatMoney(Number(v ?? 0), row?.paraBirimiSimge) },
      { key: 'alacak', label: 'Alacak', searchable: true, render: (v, row) => formatMoney(Number(v ?? 0), row?.paraBirimiSimge) },
      { key: 'bakiye', label: 'Bakiye', searchable: true, render: (v, row) => formatMoney(Number(v ?? 0), row?.paraBirimiSimge) },
      { key: 'limit', label: 'Limit', searchable: true, render: (v, row) => formatMoney(Number(v ?? 0), row?.paraBirimiSimge) },
      { key: 'kalanLimit', label: 'Kalan Limit', searchable: true, render: (v, row) => formatMoney(Number(v ?? 0), row?.paraBirimiSimge) },
      {
        key: 'limitDurum',
        label: 'Limit Durum',
        searchable: true,
        render: (v) => {
          const isExceeded = String(v).includes('Aşımı')
          return (
            <span
              className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold ${
                isExceeded
                  ? 'bg-red-50 text-red-600 border border-red-100'
                  : 'bg-emerald-50 text-emerald-600 border border-emerald-100'
              }`}
            >
              {v}
            </span>
          )
        }
      },
      { key: 'satisPersoneli', label: 'Satış Personeli', searchable: true }
    ],
    []
  )

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-gray-900 tracking-tight">Limit Risk Raporu</h1>
          <p className="text-xs text-gray-400 mt-0.5">Raporlar</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {currencyButtons}
          <button
            type="button"
            className="inline-flex items-center gap-1.5 h-[34px] px-3 text-xs font-semibold text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 transition"
            onClick={() => void load()}
          >
            🔄 Yenile
          </button>
          <div className="relative">
            <span className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-gray-400 text-xs">
              🔍
            </span>
            <input
              value={globalSearch}
              onChange={(e) => setGlobalSearch(e.target.value)}
              placeholder="Arama..."
              className="h-[34px] w-56 pl-8 pr-3 text-xs border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-400 transition"
            />
          </div>
        </div>
      </div>

      <div className="overflow-x-auto bg-white border border-gray-100 rounded-xl shadow-sm">
        <div className="min-w-[1200px] p-4 relative">
          {error && <div className="mb-2 text-xs font-semibold text-red-600">{error}</div>}
          {loading && <div className="mb-2 text-xs text-gray-500">Yükleniyor...</div>}
          <Table
          onRefresh={() => void load()}
            columns={columns as any}
            data={filteredRows}
            showColumnFilters
            rowKey={(r) => String((r as any).cariKodu ?? '')}
          />
        </div>
      </div>
    </div>
  )
}
