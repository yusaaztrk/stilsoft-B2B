import { useCallback, useEffect, useMemo, useState } from 'react'

import Table, { type TableColumn } from '../components/Table'
import { fetchLoanSchedule, type LoanScheduleMonthDto } from '../api/loans'

/**
 * Kredi Vade Takvimi — ay ay nakit çıkışı.
 *
 * Kredi takibinin asıl değeri burada: "önümüzdeki üç ay kasadan ne çıkacak" sorusunun
 * tek cevabı. Para birimleri TOPLANMAZ; her biri kendi satırında durur, çünkü USD ile
 * TL'yi toplamak anlamsız bir sayı üretir.
 */

function money(n: number | null | undefined) {
  const v = Number(n ?? 0)
  if (!Number.isFinite(v)) return '0,00'
  return new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v)
}

const MONTHS = [
  'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
  'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'
]

function defaultFrom() {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10)
}

function defaultTo() {
  const d = new Date()
  // Varsayılan pencere 12 ay: kredi planlaması yıllık düşünülüyor.
  return new Date(d.getFullYear() + 1, d.getMonth() + 1, 0).toISOString().slice(0, 10)
}

export default function LoanScheduleReport() {
  const [rows, setRows] = useState<LoanScheduleMonthDto[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [from, setFrom] = useState(defaultFrom())
  const [to, setTo] = useState(defaultTo())

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setRows(await fetchLoanSchedule({ from, to }))
    } catch (e: any) {
      setError(String(e?.message ?? 'Vade takvimi alınamadı'))
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [from, to])

  useEffect(() => {
    void load()
  }, [load])

  const currencies = useMemo(
    () => Array.from(new Set(rows.map((r) => r.currencyCode))).sort(),
    [rows]
  )

  const totalsByCurrency = useMemo(() => {
    const map = new Map<string, { total: number; paid: number; remaining: number; interest: number }>()
    for (const r of rows) {
      const cur = map.get(r.currencyCode) ?? { total: 0, paid: 0, remaining: 0, interest: 0 }
      cur.total += r.totalDue
      cur.paid += r.paid
      cur.remaining += r.remaining
      cur.interest += r.interestDue
      map.set(r.currencyCode, cur)
    }
    return map
  }, [rows])

  const columns = useMemo<TableColumn<LoanScheduleMonthDto>[]>(() => [
    {
      key: 'donem',
      label: 'Dönem',
      /**
       * Sıralama KRONOLOJİK olsun diye taşınan değer ay adı değil, gg.aa.yyyy tarihi:
       * "Ağustos 2026" ile "Ocak 2027" alfabetik sıralanınca takvim sırası bozuluyordu.
       * Ortak sıralayıcı bu biçimi tarih olarak tanır. Ekranda yine ay adı yazar.
       * Bunun bedeli, sütun süzgecinin ay ADIYLA değil ay NUMARASIYLA eşleşmesi
       * ("08.2026"); tablo en fazla birkaç düzine satır olduğu için kabul edildi.
       */
      accessorFn: (r) => `01.${String(r.month).padStart(2, '0')}.${r.year}`,
      render: (_v, r) => (
        <span className="whitespace-nowrap font-semibold text-gray-900">
          {MONTHS[Math.max(0, Math.min(11, r.month - 1))]} {r.year}
        </span>
      )
    },
    {
      key: 'currencyCode',
      label: 'Para Birimi',
      render: (_v, r) => <span className="text-xs text-gray-600">{r.currencyCode}</span>
    },
    {
      key: 'installmentCount',
      label: 'Taksit Adedi',
      accessorFn: (r) => Number(r.installmentCount ?? 0),
      render: (_v, r) => <span className="text-xs">{r.installmentCount}</span>
    },
    {
      key: 'totalDue',
      label: 'Toplam Vade',
      accessorFn: (r) => Number(r.totalDue ?? 0),
      render: (_v, r) => <span className="whitespace-nowrap">{money(r.totalDue)}</span>
    },
    {
      key: 'principalDue',
      label: 'Anapara',
      accessorFn: (r) => Number(r.principalDue ?? 0),
      render: (_v, r) => <span className="whitespace-nowrap text-gray-600">{money(r.principalDue)}</span>
    },
    {
      key: 'interestDue',
      label: 'Faiz',
      accessorFn: (r) => Number(r.interestDue ?? 0),
      render: (_v, r) => <span className="whitespace-nowrap text-gray-600">{money(r.interestDue)}</span>
    },
    {
      key: 'paid',
      label: 'Ödenen',
      accessorFn: (r) => Number(r.paid ?? 0),
      render: (_v, r) => <span className="whitespace-nowrap text-green-700">{money(r.paid)}</span>
    },
    {
      key: 'remaining',
      label: 'Kalan',
      accessorFn: (r) => Number(r.remaining ?? 0),
      render: (_v, r) => <span className="whitespace-nowrap font-semibold">{money(r.remaining)}</span>
    }
  ], [])

  return (
    <div className="p-4 space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900 tracking-tight">Kredi Vade Takvimi</h1>
          <p className="text-xs text-gray-500 mt-0.5">
            Kredi taksitlerinin ay ay nakit çıkışı. İptal edilmiş krediler dahil değildir.
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <label className="block">
            <span className="block text-[11px] font-semibold text-gray-600 mb-1">Başlangıç</span>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="text-xs border border-gray-300 rounded px-2 py-1.5"
            />
          </label>
          <label className="block">
            <span className="block text-[11px] font-semibold text-gray-600 mb-1">Bitiş</span>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="text-xs border border-gray-300 rounded px-2 py-1.5"
            />
          </label>
          <button
            type="button"
            onClick={() => void load()}
            className="px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold"
          >
            Yenile
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>
      )}

      {currencies.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {currencies.map((code) => {
            const t = totalsByCurrency.get(code)!
            return (
              <div key={code} className="rounded-xl border border-gray-200 bg-white p-3">
                <div className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">
                  Seçili dönem ({code})
                </div>
                <div className="mt-1 text-lg font-bold text-gray-900">{money(t.remaining)}</div>
                <div className="text-[10px] text-gray-500 mt-0.5">
                  Toplam vade {money(t.total)} · Ödenen {money(t.paid)} · Faiz {money(t.interest)}
                </div>
              </div>
            )
          })}
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <Table<LoanScheduleMonthDto>
          onRefresh={() => void load()}
          columns={columns}
          data={rows}
          rowKey={(r) => `${r.year}-${r.month}-${r.currencyTypeId}`}
          loading={loading}
        />
      </div>
    </div>
  )
}
