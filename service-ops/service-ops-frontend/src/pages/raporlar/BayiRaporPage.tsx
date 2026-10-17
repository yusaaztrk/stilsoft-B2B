import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { fetchDealers, type ReportFilter } from '../../api/reports'
import { useReportData } from '../../hooks/useReportData'
import ReportFilterBar from '../../components/reports/ReportFilterBar'
import ReportTable from '../../components/reports/ReportTable'
import { RankingChart, SERIES_COLORS, StackedBarChart } from '../../components/reports/Charts'
import { ErrorBox } from './MontajRaporPage'

export default function BayiRaporPage() {
  const navigate = useNavigate()
  const [filter, setFilter] = useState<ReportFilter>({ preset: 'buAy' })

  const { data, loading, error } = useReportData((f) => fetchDealers(f, 50), filter)
  const rows = data ?? []

  const open = (dealerCode: string) => navigate(`/raporlar/bayi/${encodeURIComponent(dealerCode)}`)

  // Sıralamalar aynı veri kümesinden türetiliyor — her biri için ayrı istek atmak,
  // aynı sorguyu beş kez çalıştırmak olurdu.
  const topByTotal = [...rows].sort((a, b) => b.total - a.total).slice(0, 10)
  const worstCancel = [...rows].filter((r) => r.total >= 5).sort((a, b) => b.cancelRate - a.cancelRate).slice(0, 10)
  const slowest = [...rows].filter((r) => r.avgCompletionHours > 0).sort((a, b) => b.avgCompletionHours - a.avgCompletionHours).slice(0, 10)

  return (
    <div className="space-y-4">
      <ReportFilterBar value={filter} onChange={setFilter} hide={['dealer']} />

      {error && <ErrorBox message={error} />}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <RankingChart
          title="En Çok İş Veren 10 Bayi"
          data={topByTotal.map((x) => ({ ...x, name: x.dealerName || x.dealerCode }))}
          nameKey="name"
          valueKey="total"
          valueName="İş"
          onSelect={(row) => open(row.dealerCode)}
        />

        <RankingChart
          title="İptal Oranı En Yüksek Bayiler"
          subtitle="En az 5 işi olan bayiler — tek işi olan bayi %100 ile başa geçmesin"
          data={worstCancel.map((x) => ({ ...x, name: x.dealerName || x.dealerCode }))}
          nameKey="name"
          valueKey="cancelRate"
          valueName="İptal %"
          onSelect={(row) => open(row.dealerCode)}
        />
      </div>

      <StackedBarChart
        title="Bayi Bazlı İş Tipi Kırılımı"
        subtitle="İlk 10 bayi"
        data={topByTotal.map((x) => ({
          name: (x.dealerName || x.dealerCode || '').slice(0, 14),
          installations: x.installations,
          largeRepairs: x.largeRepairs,
          smallRepairs: x.smallRepairs
        }))}
        nameKey="name"
        series={[
          { key: 'installations', name: 'Montaj', color: SERIES_COLORS.installations },
          { key: 'largeRepairs', name: 'Büyük Ürün', color: SERIES_COLORS.inProgress },
          { key: 'smallRepairs', name: 'Küçük Ürün', color: SERIES_COLORS.pending }
        ]}
      />

      <RankingChart
        title="Ortalama Servis Süresi En Uzun Bayiler"
        data={slowest.map((x) => ({ ...x, name: x.dealerName || x.dealerCode }))}
        nameKey="name"
        valueKey="avgCompletionHours"
        valueName="Saat"
        onSelect={(row) => open(row.dealerCode)}
      />

      <ReportTable
        title="Bayi Performans Tablosu"
        subtitle="Satıra tıklayarak bayi detayına gidin"
        columns={[
          { key: 'dealerName', header: 'Bayi', format: (r) => r.dealerName || r.dealerCode },
          { key: 'dealerCode', header: 'Kod' },
          { key: 'total', header: 'Toplam', align: 'right' },
          { key: 'installations', header: 'Montaj', align: 'right' },
          { key: 'largeRepairs', header: 'Büyük', align: 'right' },
          { key: 'smallRepairs', header: 'Küçük', align: 'right' },
          { key: 'completed', header: 'Tamamlanan', align: 'right' },
          { key: 'pending', header: 'Bekleyen', align: 'right' },
          { key: 'cancelled', header: 'İptal', align: 'right' },
          { key: 'cancelRate', header: 'İptal %', align: 'right' },
          { key: 'avgCompletionHours', header: 'Ort. Süre (sa)', align: 'right' }
        ]}
        rows={rows}
        loading={loading}
        onRowClick={(row) => open(row.dealerCode)}
      />
    </div>
  )
}
