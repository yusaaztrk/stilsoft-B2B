import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'

import { fetchSummary, fetchTechnicians, fetchTrend, type ReportFilter } from '../../api/reports'
import { useReportData } from '../../hooks/useReportData'
import ReportFilterBar from '../../components/reports/ReportFilterBar'
import KpiCard from '../../components/reports/KpiCard'
import ReportTable from '../../components/reports/ReportTable'
import { SERIES_COLORS, TrendAreaChart } from '../../components/reports/Charts'
import { ErrorBox } from './MontajRaporPage'

export default function TeknisyenDetayPage() {
  const { technicianId = '' } = useParams()
  const navigate = useNavigate()
  const [filter, setFilter] = useState<ReportFilter>({ preset: 'son3Ay' })

  const scoped: ReportFilter = { ...filter, technicianId }

  const summary = useReportData((f) => fetchSummary(f), scoped, [technicianId])
  const trend = useReportData((f) => fetchTrend(f, 'month'), scoped, [technicianId])
  // Ad ve oranlar için aynı listeden tek satır: ayrı bir uç açmak yerine mevcut sorgu süzülüyor.
  const roster = useReportData((f) => fetchTechnicians({ ...f, technicianId: undefined }, 200), filter)

  const me = (roster.data ?? []).find((t: any) => String(t.technicianId) === technicianId)
  const kpi = summary.data?.kpi

  const drill = (metric?: string) => {
    const params = new URLSearchParams({ technicianId })
    for (const [k, v] of Object.entries(filter)) {
      if (v !== undefined && v !== null && v !== '') params.set(k, String(v))
    }
    if (metric) params.set('metric', metric)
    navigate(`/raporlar/kayitlar?${params.toString()}`)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => navigate('/raporlar/teknisyen')}
          className="h-8 w-8 grid place-items-center rounded-lg border border-gray-200 hover:bg-gray-50 transition"
        >
          <ArrowLeft size={15} className="text-gray-600" />
        </button>
        <div>
          <div className="text-sm font-black text-gray-900">{me?.technicianName ?? 'Teknisyen'}</div>
          <div className="text-[11px] text-gray-400">Performans profili</div>
        </div>
      </div>

      <ReportFilterBar value={filter} onChange={setFilter} hide={['technician', 'search']} />

      {summary.error && <ErrorBox message={summary.error} />}

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
        <KpiCard label="Atanan İş" value={kpi?.total.value ?? 0} change={kpi?.total.change} onClick={() => drill()} />
        <KpiCard label="Tamamlanan" value={kpi?.completed.value ?? 0} change={kpi?.completed.change} onClick={() => drill('completed')} />
        <KpiCard label="Devam Eden" value={kpi?.inProgress.value ?? 0} onClick={() => drill('inProgress')} />
        <KpiCard label="Bekleyen" value={kpi?.pending.value ?? 0} onClick={() => drill('pending')} />
        <KpiCard label="İptal" value={kpi?.cancelled.value ?? 0} invertColor onClick={() => drill('cancelled')} />
        <KpiCard label="Günlük Ort." value={kpi?.dailyAverage ?? 0} />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <KpiCard label="Başarı Oranı" value={kpi?.successRate.value ?? 0} suffix="%" previous={kpi?.successRate.previous} />
        <KpiCard label="İptal Oranı" value={kpi?.cancelRate.value ?? 0} suffix="%" invertColor previous={kpi?.cancelRate.previous} />
        <KpiCard label="Ort. Tamamlanma" value={kpi?.avgCompletionHours.value ?? 0} suffix="saat" change={kpi?.avgCompletionHours.change} invertColor />
        <KpiCard label="Aynı Gün Kapatma" value={me?.sameDayRate ?? 0} suffix="%" hint="Tamamlananlar içinde" />
      </div>

      <TrendAreaChart
        title="Aylık İş Trendi"
        data={trend.data?.points ?? []}
        series={[
          { key: 'total', name: 'Atanan', color: SERIES_COLORS.total },
          { key: 'completed', name: 'Tamamlanan', color: SERIES_COLORS.completed },
          { key: 'cancelled', name: 'İptal', color: SERIES_COLORS.cancelled }
        ]}
      />

      <ReportTable
        title="İş Türü Dağılımı"
        columns={[
          { key: 'label', header: 'Durum' },
          { key: 'count', header: 'Kayıt', align: 'right' }
        ]}
        rows={summary.data?.statusBreakdown ?? []}
        loading={summary.loading}
        onRowClick={(row: any) => {
          const params = new URLSearchParams({ technicianId, status: row.status })
          for (const [k, v] of Object.entries(filter)) {
            if (v !== undefined && v !== null && v !== '') params.set(k, String(v))
          }
          navigate(`/raporlar/kayitlar?${params.toString()}`)
        }}
      />
    </div>
  )
}
