import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { CheckSquare, RefreshCw, Search, Square } from 'lucide-react'
import { fetchTypeStatus, type TypeStatusEmployeeDto, type TypeStatusReportDto } from '../api/employeePayments'
import { money } from './PaymentReportView'
import AyarliTablo from './table/AyarliTablo'

export type RosterColumn = {
  key: string
  label: string
  align?: 'left' | 'right'
  render: (row: TypeStatusEmployeeDto) => React.ReactNode
}

function currentPeriod(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/**
 * Avans ve prim ekranlarının ortak personel listesi.
 *
 * Her personelin sağında o dönemdeki durumu, solunda seçim kutusu durur; seçilenler üstteki
 * toplu işlem paneline aktarılır. Maaş ve yemek ekranlarının karşılığıdır — o ikisinde ölçü
 * hakediş, burada verilen/bekleyen tutardır (avans ve primin hakedişi yoktur).
 *
 * Liste `type-status` ucundan gelir; sayfa gövdesini her ödeme türü için sıfırdan yazmak yerine
 * bu bileşen kullanılır.
 */
export default function PaymentTypeRoster({
  type,
  columns,
  emptyHint,
  bulkLabel,
  onBulkAction,
  reloadKey,
  headerExtra
}: {
  /** EmployeePaymentType: 2 = prim, 3 = avans */
  type: number
  columns: RosterColumn[]
  emptyHint: string
  bulkLabel: string
  /** Seçilenler için toplu işlem. Başarılıysa liste yenilenir. */
  onBulkAction: (rows: TypeStatusEmployeeDto[], period: string) => Promise<void>
  reloadKey?: number
  headerExtra?: React.ReactNode
}) {
  const [period, setPeriod] = useState(currentPeriod)
  const [report, setReport] = useState<TypeStatusReportDto | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [busy, setBusy] = useState(false)

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true)
      setError(null)
      try {
        const res = await fetchTypeStatus(type, period, { signal })
        setReport(res)
      } catch (e: any) {
        if (e?.name === 'AbortError') return
        setError(String(e?.message ?? 'Liste yüklenemedi'))
      } finally {
        setLoading(false)
      }
    },
    [type, period]
  )

  useEffect(() => {
    const ac = new AbortController()
    void load(ac.signal)
    return () => ac.abort()
  }, [load, reloadKey])

  const rows = useMemo(() => {
    const list = report?.data ?? []
    const q = search.trim().toLocaleLowerCase('tr-TR')
    if (!q) return list
    return list.filter((r) =>
      `${r.employeeName} ${r.employeeCode ?? ''} ${r.workplace ?? ''}`.toLocaleLowerCase('tr-TR').includes(q)
    )
  }, [report, search])

  const selectedRows = useMemo(() => rows.filter((r) => selected.has(r.employeeId)), [rows, selected])
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.employeeId))

  const toggleAll = () => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (allSelected) {
        rows.forEach((r) => next.delete(r.employeeId))
      } else {
        rows.forEach((r) => next.add(r.employeeId))
      }
      return next
    })
  }

  const toggleOne = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const runBulk = async () => {
    if (selectedRows.length === 0) return
    setBusy(true)
    try {
      await onBulkAction(selectedRows, period)
      setSelected(new Set())
      await load()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-ivory-300 bg-white p-4">
        <div className="space-y-1">
          <label htmlFor="roster-period" className="block text-[11px] uppercase tracking-wider text-neutral-400">
            Dönem
          </label>
          <input
            id="roster-period"
            type="month"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            className="input-base"
          />
        </div>

        <div className="space-y-1 flex-1 min-w-[180px]">
          <label htmlFor="roster-search" className="block text-[11px] uppercase tracking-wider text-neutral-400">
            Ara
          </label>
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400" />
            <input
              id="roster-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input-base pl-8"
              placeholder="Personel, kod veya işyeri"
            />
          </div>
        </div>

        <button type="button" onClick={() => void load()} className="btn-editorial" disabled={loading}>
          <RefreshCw size={13} className={loading ? 'animate-spin' : undefined} />
          Yenile
        </button>

        {headerExtra}
      </div>

      {selectedRows.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50/70 p-4">
          <div className="text-sm text-amber-900">
            <strong>{selectedRows.length}</strong> personel seçili
          </div>
          <button type="button" onClick={() => void runBulk()} className="btn-primary" disabled={busy}>
            {busy ? 'İşleniyor...' : bulkLabel}
          </button>
        </div>
      )}

      {error && <div className="rounded-lg border border-rose-200 bg-rose-50/60 p-3 text-sm text-rose-800">{error}</div>}

      <div className="rounded-xl border border-ivory-300 bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <AyarliTablo>
          <table className="w-full text-sm">
            <thead className="bg-ivory-100 text-[11px] uppercase tracking-wider text-neutral-500">
              <tr>
                <th className="px-3 py-2 text-left w-8">
                  <button type="button" onClick={toggleAll} aria-label="Tümünü seç">
                    {allSelected ? <CheckSquare size={14} /> : <Square size={14} />}
                  </button>
                </th>
                <th className="px-3 py-2 text-left">Personel</th>
                <th className="px-3 py-2 text-left">İşyeri</th>
                {columns.map((c) => (
                  <th key={c.key} className={`px-3 py-2 ${c.align === 'right' ? 'text-right' : 'text-left'}`}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && rows.length === 0 ? (
                <tr>
                  <td colSpan={3 + columns.length} className="px-3 py-6 text-center text-neutral-400">
                    Yükleniyor...
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={3 + columns.length} className="px-3 py-6 text-center text-neutral-400">
                    {emptyHint}
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.employeeId} className="border-t border-ivory-200 hover:bg-ivory-50">
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        onClick={() => toggleOne(r.employeeId)}
                        aria-label={`${r.employeeName} seç`}
                      >
                        {selected.has(r.employeeId) ? <CheckSquare size={14} /> : <Square size={14} />}
                      </button>
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-medium text-neutral-900">{r.employeeName}</div>
                      <div className="text-[11px] text-neutral-400">{r.employeeCode ?? '-'}</div>
                    </td>
                    <td className="px-3 py-2 text-neutral-500">{r.workplace ?? '-'}</td>
                    {columns.map((c) => (
                      <td key={c.key} className={`px-3 py-2 ${c.align === 'right' ? 'text-right' : 'text-left'}`}>
                        {c.render(r)}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
            {report && rows.length > 0 && (
              <tfoot className="bg-ivory-50 text-[12px] font-medium">
                <tr className="border-t border-ivory-300">
                  <td />
                  <td className="px-3 py-2">Toplam ({rows.length} personel)</td>
                  <td />
                  {columns.map((c) => (
                    <td key={c.key} className={`px-3 py-2 ${c.align === 'right' ? 'text-right' : 'text-left'}`}>
                      {c.key === 'periodTotal'
                        ? `${money(rows.reduce((a, r) => a + r.periodTotal, 0))} ₺`
                        : c.key === 'pendingDeductionTotal'
                        ? `${money(rows.reduce((a, r) => a + r.pendingDeductionTotal, 0))} ₺`
                        : c.key === 'pendingPlanTotal'
                        ? `${money(rows.reduce((a, r) => a + r.pendingPlanTotal, 0))} ₺`
                        : ''}
                    </td>
                  ))}
                </tr>
              </tfoot>
            )}
          </table>
          </AyarliTablo>
        </div>
      </div>
    </div>
  )
}
