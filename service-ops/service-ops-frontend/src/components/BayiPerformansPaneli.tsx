import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ChevronRight, Download, RefreshCw, X } from 'lucide-react'
import { apiJson } from '../api/client'

/**
 * Bayi servis performansı.
 *
 * Müşteri/Bayi ekranının asıl amacı basit bir cari listesi değil, bayilerin servis tarafındaki
 * hareketini görmek: hangi bayiden kaç iş geldi, büyük/küçük dağılımı ne, kaçı kapandı, kaçı
 * hâlâ süreçte. Cari kartlarının kendisi B2B'de yaşamaya devam ediyor.
 */

type DealerRow = {
  dealerCode: string | null
  dealerName: string | null
  total: number
  small: number
  large: number
  completed: number
  cancelled: number
  pending: number
  lastServiceAt: string | null
}

type Totals = {
  dealers: number
  total: number
  small: number
  large: number
  completed: number
  pending: number
}

type DetailRow = {
  customerName: string | null
  total: number
  small: number
  large: number
  completed: number
}

type MonthRow = { year: number; month: number; total: number }

const MONTHS = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara']

function monthsAgoIso(months: number): string {
  const d = new Date()
  d.setMonth(d.getMonth() - months)
  d.setDate(1)
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset())
  return d.toISOString().slice(0, 10)
}

function todayIso(): string {
  const d = new Date()
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset())
  return d.toISOString().slice(0, 10)
}

export default function BayiPerformansPaneli() {
  const [from, setFrom] = useState(monthsAgoIso(3))
  const [to, setTo] = useState(todayIso())
  const [q, setQ] = useState('')

  const [rows, setRows] = useState<DealerRow[]>([])
  const [totals, setTotals] = useState<Totals | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [detailFor, setDetailFor] = useState<DealerRow | null>(null)
  const [detailRows, setDetailRows] = useState<DetailRow[]>([])
  const [detailMonths, setDetailMonths] = useState<MonthRow[]>([])
  const [detailLoading, setDetailLoading] = useState(false)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (from) params.set('from', from)
      if (to) params.set('to', to)
      const res = await apiJson<{ data: DealerRow[]; totals: Totals }>(
        `/api/servicerecords/dealer-performance?${params}`
      )
      setRows(res.data ?? [])
      setTotals(res.totals ?? null)
    } catch (err) {
      setRows([])
      setTotals(null)
      setError(err instanceof Error ? err.message : 'Rapor alınamadı.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to])

  const openDetail = async (row: DealerRow) => {
    if (!row.dealerCode) return
    setDetailFor(row)
    setDetailLoading(true)
    try {
      const params = new URLSearchParams()
      if (from) params.set('from', from)
      if (to) params.set('to', to)
      const res = await apiJson<{ byCustomer: DetailRow[]; byMonth: MonthRow[] }>(
        `/api/servicerecords/dealer-performance/${encodeURIComponent(row.dealerCode)}?${params}`
      )
      setDetailRows(res.byCustomer ?? [])
      setDetailMonths(res.byMonth ?? [])
    } catch {
      setDetailRows([])
      setDetailMonths([])
    } finally {
      setDetailLoading(false)
    }
  }

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return rows
    return rows.filter((r) =>
      [r.dealerCode, r.dealerName].some((v) => String(v ?? '').toLowerCase().includes(needle))
    )
  }, [rows, q])

  const exportCsv = () => {
    if (filtered.length === 0) return
    const headers = ['Cari Kodu', 'Bayi', 'Gelen Servis', 'Küçük Ürün', 'Büyük Ürün', 'Tamamlandı', 'İptal', 'Bekleyen', 'Son Servis']
    const escape = (v: unknown) => {
      const s = String(v ?? '')
      return /[\n\r",;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }
    const lines = [headers.join(';')]
    for (const r of filtered) {
      lines.push([
        r.dealerCode ?? '',
        r.dealerName ?? '',
        r.total, r.small, r.large, r.completed, r.cancelled, r.pending,
        r.lastServiceAt ? new Date(r.lastServiceAt).toLocaleDateString('tr-TR') : '',
      ].map(escape).join(';'))
    }
    const blob = new Blob([`﻿${lines.join('\n')}`], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `bayi-servis-performansi-${todayIso()}.csv`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1">Başlangıç</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1">Bitiş</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm" />
        </div>
        <div className="flex-1 min-w-[200px]">
          <label className="block text-xs font-semibold text-gray-500 mb-1">Bayi ara</label>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Bayi adı veya cari kodu" className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm" />
        </div>
        <button onClick={load} disabled={loading} className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm font-medium hover:bg-gray-50 disabled:opacity-50">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Yenile
        </button>
        <button onClick={exportCsv} disabled={filtered.length === 0} className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm font-medium hover:bg-gray-50 disabled:opacity-50">
          <Download className="w-4 h-4" /> Dışa Aktar
        </button>
      </div>

      {totals && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {[
            { l: 'Bayi', v: totals.dealers },
            { l: 'Gelen Servis', v: totals.total },
            { l: 'Küçük Ürün', v: totals.small },
            { l: 'Büyük Ürün', v: totals.large },
            { l: 'Bekleyen', v: totals.pending },
          ].map((s) => (
            <div key={s.l} className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm">
              <div className="text-2xl font-bold text-gray-900">{s.v}</div>
              <div className="text-xs text-gray-500">{s.l}</div>
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="p-4 bg-rose-50 text-rose-700 border border-rose-100 rounded-xl text-sm flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase">Bayi</th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase">Gelen Servis</th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase">Küçük Ürün</th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase">Büyük Ürün</th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase">Tamamlandı</th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase">Bekleyen</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase">Son Servis</th>
                <th className="px-4 py-3 w-10" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-400">Yükleniyor...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-400">Bu aralıkta servis kaydı yok.</td></tr>
              ) : (
                filtered.map((r) => (
                  <tr
                    key={`${r.dealerCode ?? ''}|${r.dealerName ?? ''}`}
                    onClick={() => openDetail(r)}
                    className={`hover:bg-gray-50 ${r.dealerCode ? 'cursor-pointer' : ''}`}
                  >
                    <td className="px-4 py-3">
                      <div className="font-semibold text-gray-900">{r.dealerName || 'Bayi belirtilmemiş'}</div>
                      <div className="text-xs text-gray-400 font-mono">{r.dealerCode || '—'}</div>
                    </td>
                    <td className="px-4 py-3 text-right font-bold text-gray-900">{r.total}</td>
                    <td className="px-4 py-3 text-right text-gray-700">{r.small}</td>
                    <td className="px-4 py-3 text-right text-gray-700">{r.large}</td>
                    <td className="px-4 py-3 text-right text-emerald-700 font-medium">{r.completed}</td>
                    <td className="px-4 py-3 text-right text-amber-700 font-medium">{r.pending}</td>
                    <td className="px-4 py-3 text-gray-500">
                      {r.lastServiceAt ? new Date(r.lastServiceAt).toLocaleDateString('tr-TR') : '—'}
                    </td>
                    <td className="px-4 py-3 text-gray-300">
                      {r.dealerCode && <ChevronRight className="w-4 h-4" />}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {detailFor && (
        <div className="fixed inset-0 z-[900] bg-black/40 backdrop-blur-sm flex items-start justify-center p-4 sm:p-8 overflow-y-auto" onMouseDown={() => setDetailFor(null)}>
          <div className="w-full max-w-3xl bg-white rounded-2xl shadow-2xl overflow-hidden" onMouseDown={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <div>
                <h2 className="text-base font-bold text-gray-900">{detailFor.dealerName || detailFor.dealerCode}</h2>
                <p className="text-[11px] text-gray-500 font-mono">{detailFor.dealerCode}</p>
              </div>
              <button onClick={() => setDetailFor(null)} className="p-2 text-gray-400 hover:text-gray-700 rounded-lg hover:bg-gray-100">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-5 max-h-[70vh] overflow-y-auto">
              {detailLoading ? (
                <div className="py-10 text-center text-gray-400 text-sm">Yükleniyor...</div>
              ) : (
                <>
                  <div>
                    <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Aylık Dağılım</h3>
                    {detailMonths.length === 0 ? (
                      <div className="text-sm text-gray-400">Kayıt yok.</div>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {detailMonths.map((m) => (
                          <div key={`${m.year}-${m.month}`} className="px-3 py-2 rounded-lg bg-gray-50 border border-gray-100">
                            <div className="text-[10px] text-gray-500">{MONTHS[m.month - 1]} {m.year}</div>
                            <div className="text-sm font-bold text-gray-900">{m.total} ürün</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div>
                    <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Mağaza / Nihai Müşteri Kırılımı</h3>
                    <div className="overflow-x-auto rounded-lg border border-gray-100">
                      <table className="w-full text-sm">
                        <thead className="bg-gray-50 text-gray-500">
                          <tr>
                            <th className="px-3 py-2 text-left text-xs font-semibold">Müşteri / Mağaza</th>
                            <th className="px-3 py-2 text-right text-xs font-semibold">Toplam</th>
                            <th className="px-3 py-2 text-right text-xs font-semibold">Küçük</th>
                            <th className="px-3 py-2 text-right text-xs font-semibold">Büyük</th>
                            <th className="px-3 py-2 text-right text-xs font-semibold">Tamamlandı</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                          {detailRows.length === 0 ? (
                            <tr><td colSpan={5} className="px-3 py-6 text-center text-gray-400">Kayıt yok.</td></tr>
                          ) : detailRows.map((d, i) => (
                            <tr key={i}>
                              <td className="px-3 py-2 text-gray-800">{d.customerName || '—'}</td>
                              <td className="px-3 py-2 text-right font-semibold">{d.total}</td>
                              <td className="px-3 py-2 text-right text-gray-600">{d.small}</td>
                              <td className="px-3 py-2 text-right text-gray-600">{d.large}</td>
                              <td className="px-3 py-2 text-right text-emerald-700">{d.completed}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
