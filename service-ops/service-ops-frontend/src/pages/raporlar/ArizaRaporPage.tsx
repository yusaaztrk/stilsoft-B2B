import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import {
  fetchDealers,
  fetchProducts,
  fetchRepairs,
  fetchTechnicians,
  fetchTrend,
  type DrillMetric,
  type ReportFilter
} from '../../api/reports'
import { useReportData } from '../../hooks/useReportData'
import ReportFilterBar from '../../components/reports/ReportFilterBar'
import KpiCard from '../../components/reports/KpiCard'
import ReportTable from '../../components/reports/ReportTable'
import { RankingChart, SERIES_COLORS, TrendAreaChart } from '../../components/reports/Charts'
import { ErrorBox } from './MontajRaporPage'

type Props = {
  /** Büyük ve küçük ürün ekranları aynı analiz; ayrım yalnızca ürün grubunda. */
  productCategory: 'Large' | 'Small'
}

export default function ArizaRaporPage({ productCategory }: Props) {
  const navigate = useNavigate()
  const [filter, setFilter] = useState<ReportFilter>({ preset: 'buAy', type: 'Repair', productCategory })

  // Ekran değiştiğinde (büyük ↔ küçük) filtre de o gruba sabitlenir.
  const scoped: ReportFilter = { ...filter, type: 'Repair', productCategory }

  const summary = useReportData((f) => fetchRepairs(f), scoped)
  const trend = useReportData((f) => fetchTrend(f, 'month'), scoped)
  const products = useReportData((f) => fetchProducts(f, 10), scoped)
  const dealers = useReportData((f) => fetchDealers(f, 10), scoped)
  const technicians = useReportData((f) => fetchTechnicians(f, 10), scoped)

  const kpi = summary.data?.kpi
  const isSmall = productCategory === 'Small'

  const drill = (metric?: DrillMetric) => {
    const params = new URLSearchParams()
    for (const [k, v] of Object.entries(scoped)) {
      if (v !== undefined && v !== null && v !== '') params.set(k, String(v))
    }
    if (metric) params.set('metric', metric)
    navigate(`/raporlar/kayitlar?${params.toString()}`)
  }

  return (
    <div className="space-y-4">
      <ReportFilterBar value={filter} onChange={setFilter} hide={['type', 'category']} />

      {summary.error && <ErrorBox message={summary.error} />}

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
        <KpiCard label="Toplam Arıza" value={kpi?.total.value ?? 0} change={kpi?.total.change} previous={kpi?.total.previous} onClick={() => drill()} />
        <KpiCard label="Tamamlanan" value={kpi?.completed.value ?? 0} change={kpi?.completed.change} onClick={() => drill('completed')} />
        <KpiCard label={isSmall ? 'Atölyede / Devam' : 'Devam Eden'} value={kpi?.inProgress.value ?? 0} onClick={() => drill('inProgress')} />
        <KpiCard label="Bekleyen" value={kpi?.pending.value ?? 0} onClick={() => drill('pending')} />
        <KpiCard label="İptal" value={kpi?.cancelled.value ?? 0} change={kpi?.cancelled.change} invertColor onClick={() => drill('cancelled')} />
        <KpiCard
          label={isSmall ? 'Ort. Atölye + Teslim' : 'Ort. Çözüm Süresi'}
          value={kpi?.avgCompletionHours.value ?? 0}
          suffix="saat"
          change={kpi?.avgCompletionHours.change}
          invertColor
          hint="Kabul → teslim"
        />
      </div>

      <TrendAreaChart
        title={isSmall ? 'Aylık Küçük Ürün Trendi' : 'Aylık Arıza Trendi'}
        data={trend.data?.points ?? []}
        series={[
          { key: 'total', name: 'Toplam', color: SERIES_COLORS.total },
          { key: 'completed', name: 'Tamamlanan', color: SERIES_COLORS.completed },
          { key: 'cancelled', name: 'İptal', color: SERIES_COLORS.cancelled }
        ]}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <RankingChart
          title={isSmall ? 'En Çok Gelen Küçük Ürünler' : 'En Çok Arıza Yapan Ürünler'}
          data={(products.data ?? []).map((x: any) => ({ ...x, name: x.productName }))}
          nameKey="name"
          valueKey="total"
          valueName="Kayıt"
          onSelect={(row) => row.stockCode && navigate(`/raporlar/urun/${encodeURIComponent(row.stockCode)}`)}
        />

        <RankingChart
          title={isSmall ? 'En Çok Gönderen Bayiler' : 'En Çok Kayıt Açan Bayiler'}
          data={(dealers.data ?? []).map((x: any) => ({ ...x, name: x.dealerName || x.dealerCode }))}
          nameKey="name"
          valueKey="total"
          valueName="Kayıt"
          onSelect={(row) => navigate(`/raporlar/bayi/${encodeURIComponent(row.dealerCode)}`)}
        />
      </div>

      <ReportTable
        title="Durum Dağılımı"
        columns={[
          { key: 'label', header: 'Durum' },
          { key: 'count', header: 'Kayıt', align: 'right' }
        ]}
        rows={summary.data?.statusBreakdown ?? []}
        loading={summary.loading}
        onRowClick={(row: any) => {
          const params = new URLSearchParams()
          for (const [k, v] of Object.entries(scoped)) {
            if (v !== undefined && v !== null && v !== '') params.set(k, String(v))
          }
          params.set('status', row.status)
          navigate(`/raporlar/kayitlar?${params.toString()}`)
        }}
      />

      <ReportTable
        title="Teknisyen Dağılımı"
        columns={[
          { key: 'technicianName', header: 'Teknisyen' },
          { key: 'total', header: 'Toplam', align: 'right' },
          { key: 'completed', header: 'Tamamlanan', align: 'right' },
          { key: 'cancelled', header: 'İptal', align: 'right' },
          { key: 'avgCompletionHours', header: 'Ort. Süre (sa)', align: 'right' }
        ]}
        rows={technicians.data ?? []}
        loading={technicians.loading}
        onRowClick={(row: any) => navigate(`/raporlar/teknisyen/${row.technicianId}`)}
      />
    </div>
  )
}
