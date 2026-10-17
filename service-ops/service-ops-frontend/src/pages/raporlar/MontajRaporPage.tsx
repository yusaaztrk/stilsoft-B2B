import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { fetchInstallations, fetchTrend, type ReportFilter } from '../../api/reports'
import { useReportData } from '../../hooks/useReportData'
import ReportFilterBar from '../../components/reports/ReportFilterBar'
import KpiCard from '../../components/reports/KpiCard'
import ReportTable from '../../components/reports/ReportTable'
import { RankingChart, SERIES_COLORS, TrendAreaChart } from '../../components/reports/Charts'

/** Bu ekran yalnızca montajı gösterir; iş tipi filtresi sabit. */
const BASE: ReportFilter = { preset: 'buAy', type: 'Installation' }

export default function MontajRaporPage() {
  const navigate = useNavigate()
  const [filter, setFilter] = useState<ReportFilter>(BASE)

  const report = useReportData((f) => fetchInstallations(f), filter)
  const trend = useReportData((f) => fetchTrend(f, 'month'), filter)

  const d = report.data

  return (
    <div className="space-y-4">
      <ReportFilterBar
        value={filter}
        onChange={(next) => setFilter({ ...next, type: 'Installation' })}
        hide={['type', 'category', 'search']}
      />

      {report.error && <ErrorBox message={report.error} />}

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
        <KpiCard label="Toplam Görev" value={d?.totalTasks ?? 0} />
        <KpiCard
          label="Toplam Adet"
          value={d?.totalQuantity ?? 0}
          hint="Kalem adedi — kayıt sayısı değil"
        />
        <KpiCard label="Tamamlanan" value={d?.completedTasks ?? 0} />
        <KpiCard label="İptal" value={d?.cancelledTasks ?? 0} invertColor />
        <KpiCard
          label="Ort. Montaj Süresi"
          value={d?.avgHours?.startToComplete ?? 0}
          suffix="saat"
          hint="Başlama → tamamlanma"
          invertColor
        />
        <KpiCard
          label="Aktarım → Başlama"
          value={d?.avgHours?.transferToStart ?? 0}
          suffix="saat"
          invertColor
        />
      </div>

      <TrendAreaChart
        title="Aylık Montaj Trendi"
        data={trend.data?.points ?? []}
        series={[
          { key: 'installations', name: 'Montaj', color: SERIES_COLORS.installations },
          { key: 'completed', name: 'Tamamlanan', color: SERIES_COLORS.completed }
        ]}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <RankingChart
          title="En Çok Montaj Veren Bayiler"
          data={(d?.byDealer ?? []).slice(0, 10).map((x: any) => ({ ...x, name: x.dealerName || x.dealerCode }))}
          nameKey="name"
          valueKey="count"
          valueName="Montaj"
          onSelect={(row) => navigate(`/raporlar/bayi/${encodeURIComponent(row.dealerCode)}`)}
        />

        <RankingChart
          title="En Çok Monte Edilen Ürünler"
          subtitle="Adet bazlı (kalem miktarı)"
          data={(d?.byProduct ?? []).slice(0, 10).map((x: any) => ({ ...x, name: x.productName }))}
          nameKey="name"
          valueKey="quantity"
          valueName="Adet"
          onSelect={(row) => row.stockCode && navigate(`/raporlar/urun/${encodeURIComponent(row.stockCode)}`)}
        />
      </div>

      <ReportTable
        title="Teknisyen Bazlı Montaj"
        columns={[
          { key: 'technicianName', header: 'Teknisyen' },
          { key: 'count', header: 'Görev', align: 'right' },
          { key: 'quantity', header: 'Adet', align: 'right' }
        ]}
        rows={(d?.byTechnician ?? []) as any[]}
        loading={report.loading}
        onRowClick={(row: any) => navigate(`/raporlar/teknisyen/${row.technicianId}`)}
      />

      <ReportTable
        title="Görev Durumu Dağılımı"
        columns={[
          { key: 'status', header: 'Durum' },
          { key: 'count', header: 'Görev', align: 'right' },
          { key: 'quantity', header: 'Adet', align: 'right' }
        ]}
        rows={d?.taskStatus ?? []}
        loading={report.loading}
      />
    </div>
  )
}

export function ErrorBox({ message }: { message: string }) {
  return (
    <div className="bg-rose-50 border border-rose-200 text-rose-700 rounded-xl px-4 py-3 text-xs font-medium">
      {message}
    </div>
  )
}
