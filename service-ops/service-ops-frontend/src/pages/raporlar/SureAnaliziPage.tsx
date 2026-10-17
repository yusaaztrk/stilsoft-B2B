import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { fetchDealers, fetchDurations, fetchTechnicians, type ReportFilter } from '../../api/reports'
import { useReportData } from '../../hooks/useReportData'
import ReportFilterBar from '../../components/reports/ReportFilterBar'
import KpiCard from '../../components/reports/KpiCard'
import ReportTable from '../../components/reports/ReportTable'
import { RankingChart } from '../../components/reports/Charts'
import { ErrorBox } from './MontajRaporPage'

export default function SureAnaliziPage() {
  const navigate = useNavigate()
  const [filter, setFilter] = useState<ReportFilter>({ preset: 'son3Ay' })

  const durations = useReportData((f) => fetchDurations(f), filter)
  const dealers = useReportData((f) => fetchDealers(f, 50), filter)
  const technicians = useReportData((f) => fetchTechnicians(f, 50), filter)

  const o = durations.data?.overall

  const slowDealers = (dealers.data ?? []).filter((d: any) => d.avgCompletionHours > 0 && d.total >= 3)
    .sort((a: any, b: any) => b.avgCompletionHours - a.avgCompletionHours).slice(0, 10)
  const slowTechs = (technicians.data ?? []).filter((t: any) => t.avgCompletionHours > 0 && t.completed >= 3)
    .sort((a: any, b: any) => b.avgCompletionHours - a.avgCompletionHours).slice(0, 10)

  return (
    <div className="space-y-4">
      <ReportFilterBar value={filter} onChange={setFilter} />

      {durations.error && <ErrorBox message={durations.error} />}

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
        <KpiCard label="Ölçülen İş" value={o?.count ?? 0} hint="Tamamlanmış ve tarihi olan" />
        <KpiCard label="Ortalama" value={o?.avgHours ?? 0} suffix="saat" invertColor />
        <KpiCard label="En Kısa" value={o?.minHours ?? 0} suffix="saat" />
        <KpiCard label="En Uzun" value={o?.maxHours ?? 0} suffix="saat" invertColor />
        <KpiCard
          label="Açılış → Planlama"
          value={o?.avgToPlanHours ?? 0}
          suffix="saat"
          invertColor
          hint="Planlanmış kayıtlarda"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <RankingChart
          title="İşleri En Uzun Süren Bayiler"
          subtitle="En az 3 tamamlanmış işi olanlar"
          data={slowDealers.map((x: any) => ({ ...x, name: x.dealerName || x.dealerCode }))}
          nameKey="name"
          valueKey="avgCompletionHours"
          valueName="Saat"
          onSelect={(row) => navigate(`/raporlar/bayi/${encodeURIComponent(row.dealerCode)}`)}
        />

        <RankingChart
          title="İşleri En Uzun Süren Teknisyenler"
          subtitle="En az 3 tamamlanmış işi olanlar"
          data={slowTechs.map((x: any) => ({ ...x, name: x.technicianName }))}
          nameKey="name"
          valueKey="avgCompletionHours"
          valueName="Saat"
          onSelect={(row) => navigate(`/raporlar/teknisyen/${row.technicianId}`)}
        />
      </div>

      <ReportTable
        title="En Uzun Süren 20 İş"
        columns={[
          { key: 'serviceNumber', header: 'Servis No' },
          { key: 'productName', header: 'Ürün' },
          { key: 'dealerName', header: 'Bayi' },
          { key: 'createdAt', header: 'Açılış', format: (r: any) => fmt(r.createdAt) },
          { key: 'completedAt', header: 'Tamamlanma', format: (r: any) => fmt(r.completedAt) },
          { key: 'hours', header: 'Süre (sa)', align: 'right' }
        ]}
        rows={durations.data?.longest ?? []}
        loading={durations.loading}
      />

      <ReportTable
        title="En Hızlı Tamamlanan 20 İş"
        columns={[
          { key: 'serviceNumber', header: 'Servis No' },
          { key: 'productName', header: 'Ürün' },
          { key: 'dealerName', header: 'Bayi' },
          { key: 'createdAt', header: 'Açılış', format: (r: any) => fmt(r.createdAt) },
          { key: 'completedAt', header: 'Tamamlanma', format: (r: any) => fmt(r.completedAt) },
          { key: 'hours', header: 'Süre (sa)', align: 'right' }
        ]}
        rows={durations.data?.fastest ?? []}
        loading={durations.loading}
      />
    </div>
  )
}

function fmt(value?: string | null) {
  if (!value) return '-'
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? '-' : d.toLocaleDateString('tr-TR')
}
