import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import Table, { type TableColumn } from '../components/Table'
import { fetchVirmanReportDetails, type VirmanReportDetailItemDto } from '../api/virman'
import * as XLSX from 'xlsx'

type Row = VirmanReportDetailItemDto & {
  actions: string
  inAmount: number
  outAmount: number
  balance: number
}

function formatMoney(n: number) {
  const v = Number(n ?? 0)
  return `₺${v.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export default function VirmanReportDetailPage() {
  const { customerCode } = useParams()
  const navigate = useNavigate()

  const code = String(customerCode ?? '').trim()

  const [customer, setCustomer] = useState<{ customerCode: string; name: string } | null>(null)
  const [items, setItems] = useState<VirmanReportDetailItemDto[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [globalSearch, setGlobalSearch] = useState('')

  const load = async () => {
    const ac = new AbortController()
    try {
      setLoading(true)
      setError(null)
      const res = await fetchVirmanReportDetails(code, { signal: ac.signal })
      setCustomer(res.customer)
      setItems(res.data ?? [])
    } catch (e: any) {
      setError(String(e?.message ?? 'Virman rapor detayları alınamadı'))
      setItems([])
    } finally {
      setLoading(false)
    }
    return () => ac.abort()
  }

  useEffect(() => {
    if (!code) return
    void load()
  }, [code])

  const rows: Row[] = useMemo(() => {
    // Sort transactions chronologically to calculate running balance
    const asc = [...(items ?? [])].sort((a, b) => {
      const da = new Date(String(a.date ?? '')).getTime()
      const db = new Date(String(b.date ?? '')).getTime()
      if (da !== db) return da - db
      return Number(a.id ?? 0) - Number(b.id ?? 0)
    })

    let running = 0
    const out: Row[] = []

    for (const x of asc) {
      const isIn = Number(x.directionId ?? 0) === 2 // Credit (Giriş / Alacak) is 2
      const inAmount = isIn ? Number(x.amount ?? 0) : 0
      const outAmount = !isIn ? Number(x.amount ?? 0) : 0
      // Yürüyen bakiye cari ekstresiyle aynı yönde: BORÇ (çıkış) artırır, ALACAK (giriş)
      // azaltır. Önceden tersiydi; virman ekranı kendi içinde tutarlıydı ama aynı cariye
      // ekstreden bakan kişi ters işaret görüyordu. Liste ucundaki bakiye de çevrildi.
      running = running + (outAmount - inAmount)

      out.push({
        ...x,
        actions: '',
        inAmount,
        outAmount,
        balance: running
      })
    }

    // Return in reverse chronological order for table display
    return out.reverse()
  }, [items])

  const filteredRows = useMemo(() => {
    const q = globalSearch.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) =>
      String(r.date ?? '').toLowerCase().includes(q) ||
      String(r.documentNo ?? '').toLowerCase().includes(q) ||
      String(r.description ?? '').toLowerCase().includes(q) ||
      String(r.direction ?? '').toLowerCase().includes(q)
    )
  }, [rows, globalSearch])

  const totals = useMemo(() => {
    let inTotal = 0
    let outTotal = 0
    for (const r of rows) {
      inTotal += Number(r.inAmount ?? 0)
      outTotal += Number(r.outAmount ?? 0)
    }
    const balance = inTotal - outTotal
    return { inTotal, outTotal, balance }
  }, [rows])

  const columns: TableColumn<Row>[] = useMemo(
    () => [
      { key: 'date', label: 'Tarih', searchable: true, filter: { type: 'date' }, render: (v) => String(v ?? '').slice(0, 10) },
      { key: 'documentNo', label: 'Belge No', searchable: true, sortable: true },
      { key: 'description', label: 'Açıklama', searchable: true },
      {
        key: 'direction',
        label: 'Yön',
        searchable: true,
        filter: {
          type: 'select',
          options: [
            { label: 'Tümünü Seç', value: '' },
            { label: 'Giriş (Alacak)', value: 'Giriş (Alacak)' },
            { label: 'Çıkış (Borç)', value: 'Çıkış (Borç)' }
          ]
        },
        render: (v, r) => {
          const isIn = r.inAmount > 0
          return (
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold inline-block ${isIn ? 'text-emerald-700 bg-emerald-50 border border-emerald-100' : 'text-blue-700 bg-blue-50 border border-blue-100'}`}>
              {String(v ?? '')}
            </span>
          )
        }
      },
      { key: 'inAmount', label: 'Giriş (Alacak)', searchable: true, render: (v) => (Number(v ?? 0) > 0 ? formatMoney(Number(v ?? 0)) : '0,00') },
      { key: 'outAmount', label: 'Çıkış (Borç)', searchable: true, render: (v) => (Number(v ?? 0) > 0 ? formatMoney(Number(v ?? 0)) : '0,00') },
      { key: 'balance', label: 'Bakiye', searchable: true, render: (v) => formatMoney(Number(v ?? 0)) },
      { key: 'createUser', label: 'İşlem Yapan', searchable: true, sortable: true },
      { key: 'actions', label: '', render: () => <div className="w-6" /> }
    ],
    []
  )

  const exportToExcel = () => {
    const excelData = filteredRows.map((r) => ({
      'Tarih': String(r.date ?? '').slice(0, 10),
      'Belge No': String(r.documentNo ?? ''),
      'Açıklama': String(r.description ?? ''),
      'Yön': String(r.direction ?? ''),
      'Giriş (Alacak)': Number(r.inAmount ?? 0),
      'Çıkış (Borç)': Number(r.outAmount ?? 0),
      'Bakiye': Number(r.balance ?? 0),
      'İşlem Yapan': String(r.createUser ?? '')
    }))

    excelData.push({
      'Tarih': 'TOPLAM',
      'Belge No': '',
      'Açıklama': '',
      'Yön': '',
      'Giriş (Alacak)': totals.inTotal,
      'Çıkış (Borç)': totals.outTotal,
      'Bakiye': totals.balance,
      'İşlem Yapan': ''
    })

    const ws = XLSX.utils.json_to_sheet(excelData)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Virman Detay')

    const colWidths = [
      { wch: 12 },
      { wch: 15 },
      { wch: 30 },
      { wch: 15 },
      { wch: 18 },
      { wch: 18 },
      { wch: 18 },
      { wch: 15 }
    ]
    ws['!cols'] = colWidths

    const safeName = String(customer?.customerCode ?? 'cari').replace(/[^a-zA-Z0-9_-]/g, '_')
    XLSX.writeFile(wb, `virman-detay-${safeName}.xlsx`)
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-gray-900 tracking-tight">
            Virman Rapor Detay{customer ? ` : [${customer.customerCode}] ${customer.name}` : ''}
          </h1>
          <p className="text-xs text-gray-400 mt-0.5">Raporlar / Virman Raporları</p>
        </div>
        <div className="flex items-center gap-2">
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
          <button
            type="button"
            onClick={() => navigate('/reports/virmanRaporlari')}
            className="h-[34px] inline-flex items-center gap-1.5 px-4 text-xs font-semibold rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 transition"
          >
            Geri
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
          <div className="grid grid-cols-9 text-[11px] font-bold text-emerald-900">
            <div className="px-3 py-2.5">TOPLAM</div>
            <div className="px-3 py-2.5" />
            <div className="px-3 py-2.5" />
            <div className="px-3 py-2.5" />
            <div className="px-3 py-2.5 text-right">{formatMoney(totals.inTotal)}</div>
            <div className="px-3 py-2.5 text-right">{formatMoney(totals.outTotal)}</div>
            <div className="px-3 py-2.5 text-right">{formatMoney(totals.balance)}</div>
            <div className="px-3 py-2.5" />
            <div className="px-3 py-2.5" />
          </div>
        </div>
      )}
    </div>
  )
}
