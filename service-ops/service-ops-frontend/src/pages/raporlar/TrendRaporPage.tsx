import { useState } from 'react'

import { fetchSummary, fetchTrend, type ReportFilter } from '../../api/reports'
import { useReportData } from '../../hooks/useReportData'
import ReportFilterBar from '../../components/reports/ReportFilterBar'
import ReportTable from '../../components/reports/ReportTable'
import { SERIES_COLORS, TrendAreaChart } from '../../components/reports/Charts'
import { ErrorBox } from './MontajRaporPage'

type CompareRow = {
  metric: string
  current: number
  previous: number
  change: string
}

/** `1.240 → 1.487 | +%19,9` biçimi: hem mutlak hem oransal değişim tek satırda. */
function row(metric: string, current: number, previous: number): CompareRow {
  const change =
    Math.abs(previous) < 0.0001
      ? (current > 0 ? '+%100' : '%0')
      : `${current >= previous ? '+' : ''}${(((current - previous) / previous) * 100).toFixed(1)}%`

  return { metric, current, previous, change }
}

export default function TrendRaporPage() {
  const [filter, setFilter] = useState<ReportFilter>({ preset: 'buAy' })
  const [granularity, setGranularity] = useState<'day' | 'week' | 'month'>('month')

  const summary = useReportData((f) => fetchSummary(f), filter)
  const trend = useReportData((f) => fetchTrend(f, granularity), filter, [granularity])

  const k = summary.data?.kpi
  const mix = summary.data?.mix

  const rows: CompareRow[] = k
    ? [
        row('Toplam İş', k.total.value, k.total.previous ?? 0),
        row('Tamamlanan', k.completed.value, k.completed.previous ?? 0),
        row('Devam Eden', k.inProgress.value, k.inProgress.previous ?? 0),
        row('Bekleyen', k.pending.value, k.pending.previous ?? 0),
        row('İptal', k.cancelled.value, k.cancelled.previous ?? 0),
        row('Başarı Oranı (%)', k.successRate.value, k.successRate.previous ?? 0),
        row('İptal Oranı (%)', k.cancelRate.value, k.cancelRate.previous ?? 0),
        row('Ort. Tamamlanma (saat)', k.avgCompletionHours.value, k.avgCompletionHours.previous ?? 0)
      ]
    : []

  return (
    <div className="space-y-4">
      <ReportFilterBar
        value={filter}
        onChange={setFilter}
        right={
          <div className="flex gap-1">
            {(['day', 'week', 'month'] as const).map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => setGranularity(g)}
                className={
                  'px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition ' +
                  (granularity === g
                    ? 'bg-gray-900 text-white'
                    : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50')
                }
              >
                {g === 'day' ? 'Gün' : g === 'week' ? 'Hafta' : 'Ay'}
              </button>
            ))}
          </div>
        }
      />

      {summary.error && <ErrorBox message={summary.error} />}

      <TrendAreaChart
        title="Dönemsel İş Trendi"
        subtitle="Seçili kırılıma göre"
        data={trend.data?.points ?? []}
        height={320}
        series={[
          { key: 'total', name: 'Toplam', color: SERIES_COLORS.total },
          { key: 'completed', name: 'Tamamlanan', color: SERIES_COLORS.completed },
          { key: 'installations', name: 'Montaj', color: SERIES_COLORS.installations },
          { key: 'cancelled', name: 'İptal', color: SERIES_COLORS.cancelled }
        ]}
      />

      <ReportTable
        title="Önceki Dönemle Karşılaştırma"
        subtitle="Karşılaştırılan dönem, seçili aralığın hemen öncesindeki aynı uzunluktaki dönem"
        columns={[
          { key: 'metric', header: 'Metrik' },
          { key: 'previous', header: 'Önceki Dönem', align: 'right' },
          { key: 'current', header: 'Seçili Dönem', align: 'right' },
          {
            key: 'change',
            header: 'Değişim',
            align: 'right',
            format: (r) => (
              <span className={r.change.startsWith('+') ? 'text-emerald-600 font-bold' : 'text-rose-600 font-bold'}>
                {r.change}
              </span>
            )
          }
        ]}
        rows={rows}
        loading={summary.loading}
      />

      <ReportTable
        title="Operasyon Dağılımı"
        columns={[
          { key: 'name', header: 'Operasyon' },
          { key: 'count', header: 'Adet', align: 'right' }
        ]}
        rows={[
          { name: 'Montaj', count: mix?.installations ?? 0 },
          { name: 'Büyük Ürün Arıza', count: mix?.largeRepairs ?? 0 },
          { name: 'Küçük Ürün Arıza', count: mix?.smallRepairs ?? 0 },
          { name: 'Kargo', count: mix?.cargo ?? 0 }
        ]}
        loading={summary.loading}
      />
    </div>
  )
}
