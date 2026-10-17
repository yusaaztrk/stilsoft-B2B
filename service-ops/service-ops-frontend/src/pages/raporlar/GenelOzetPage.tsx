import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { fetchSummary, fetchTrend, type DrillMetric, type ReportFilter } from '../../api/reports'
import { useReportData } from '../../hooks/useReportData'
import ReportFilterBar from '../../components/reports/ReportFilterBar'
import KpiCard from '../../components/reports/KpiCard'
import { DonutChart, RankingChart, SERIES_COLORS, TrendAreaChart } from '../../components/reports/Charts'

const DEFAULT_FILTER: ReportFilter = { preset: 'buAy' }

export default function GenelOzetPage() {
  const navigate = useNavigate()
  const [filter, setFilter] = useState<ReportFilter>(DEFAULT_FILTER)

  const summary = useReportData((f) => fetchSummary(f), filter)
  const trend = useReportData((f) => fetchTrend(f, 'month'), filter)

  /**
   * Karttan kayıt listesine geçiş. `metric` karttaki tanımı taşıyor — liste aynı sorgudan
   * beslendiği için karttaki sayı ile listedeki satır sayısı ayrışmıyor.
   */
  const drill = (metric?: DrillMetric) => {
    const params = new URLSearchParams()
    for (const [k, v] of Object.entries(filter)) {
      if (v !== undefined && v !== null && v !== '') params.set(k, String(v))
    }
    if (metric) params.set('metric', metric)
    navigate(`/raporlar/kayitlar?${params.toString()}`)
  }

  const kpi = summary.data?.kpi
  const mix = summary.data?.mix

  return (
    <div className="space-y-4">
      <ReportFilterBar value={filter} onChange={setFilter} hide={['search']} />

      {summary.error && (
        <div className="bg-rose-50 border border-rose-200 text-rose-700 rounded-xl px-4 py-3 text-xs font-medium">
          {summary.error}
        </div>
      )}

      {summary.loading && !summary.data ? (
        <SkeletonGrid />
      ) : kpi ? (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
            <KpiCard label="Toplam İş" value={kpi.total.value} change={kpi.total.change} previous={kpi.total.previous} onClick={() => drill()} />
            <KpiCard label="Tamamlanan" value={kpi.completed.value} change={kpi.completed.change} previous={kpi.completed.previous} onClick={() => drill('completed')} />
            <KpiCard label="Devam Eden" value={kpi.inProgress.value} change={kpi.inProgress.change} previous={kpi.inProgress.previous} onClick={() => drill('inProgress')} />
            <KpiCard label="Bekleyen" value={kpi.pending.value} change={kpi.pending.change} previous={kpi.pending.previous} onClick={() => drill('pending')} />
            <KpiCard label="İptal" value={kpi.cancelled.value} change={kpi.cancelled.change} previous={kpi.cancelled.previous} invertColor onClick={() => drill('cancelled')} />
            <KpiCard label="Başarı Oranı" value={kpi.successRate.value} suffix="%" previous={kpi.successRate.previous} />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
            <KpiCard label="İptal Oranı" value={kpi.cancelRate.value} suffix="%" previous={kpi.cancelRate.previous} invertColor />
            <KpiCard
              label="Ort. Tamamlanma"
              value={kpi.avgCompletionHours.value}
              suffix="saat"
              change={kpi.avgCompletionHours.change}
              invertColor
              hint="Açılıştan teslime"
            />
            <KpiCard label="Günlük Ort. İş" value={kpi.dailyAverage} />
            <KpiCard label="Aktif Bayi" value={kpi.activeDealers} hint="Dönemde iş açan" />
            <KpiCard label="Aktif Teknisyen" value={kpi.activeTechnicians} />
            <KpiCard label="Toplam Kargo" value={mix?.cargo ?? 0} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            <div className="lg:col-span-2">
              <TrendAreaChart
                title="Aylık İş Trendi"
                subtitle="Seçili dönemdeki iş, tamamlanan ve iptal sayısı"
                data={trend.data?.points ?? []}
                series={[
                  { key: 'total', name: 'Toplam', color: SERIES_COLORS.total },
                  { key: 'completed', name: 'Tamamlanan', color: SERIES_COLORS.completed },
                  { key: 'cancelled', name: 'İptal', color: SERIES_COLORS.cancelled }
                ]}
              />
            </div>

            <DonutChart
              title="Operasyon Dağılımı"
              subtitle="Montaj / büyük ürün / küçük ürün / kargo"
              data={[
                { name: 'Montaj', value: mix?.installations ?? 0 },
                { name: 'Büyük Ürün', value: mix?.largeRepairs ?? 0 },
                { name: 'Küçük Ürün', value: mix?.smallRepairs ?? 0 },
                { name: 'Kargo', value: mix?.cargo ?? 0 }
              ]}
              nameKey="name"
              valueKey="value"
            />
          </div>

          <RankingChart
            title="Durum Dağılımı"
            subtitle="16 durum yatay bar ile — pasta bu kadar dilimde okunmaz"
            data={(summary.data?.statusBreakdown ?? []).slice(0, 12)}
            nameKey="label"
            valueKey="count"
            valueName="Kayıt"
            onSelect={(row) => {
              const params = new URLSearchParams()
              for (const [k, v] of Object.entries(filter)) {
                if (v !== undefined && v !== null && v !== '') params.set(k, String(v))
              }
              params.set('status', row.status)
              navigate(`/raporlar/kayitlar?${params.toString()}`)
            }}
          />
        </>
      ) : null}
    </div>
  )
}

function SkeletonGrid() {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
      {Array.from({ length: 12 }).map((_, i) => (
        <div key={i} className="h-[86px] bg-gray-100 rounded-2xl animate-pulse" />
      ))}
    </div>
  )
}
