import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { fetchCancellations, type ReportFilter } from '../../api/reports'
import { useReportData } from '../../hooks/useReportData'
import ReportFilterBar from '../../components/reports/ReportFilterBar'
import KpiCard from '../../components/reports/KpiCard'
import ReportTable from '../../components/reports/ReportTable'
import { EmptyChart, RankingChart, SERIES_COLORS, TrendAreaChart } from '../../components/reports/Charts'
import { ErrorBox } from './MontajRaporPage'

export default function IptalAnaliziPage() {
  const navigate = useNavigate()
  const [filter, setFilter] = useState<ReportFilter>({ preset: 'son3Ay' })

  const { data, loading, error } = useReportData((f) => fetchCancellations(f), filter)

  const drill = () => {
    const params = new URLSearchParams({ metric: 'cancelled' })
    for (const [k, v] of Object.entries(filter)) {
      if (v !== undefined && v !== null && v !== '') params.set(k, String(v))
    }
    navigate(`/raporlar/kayitlar?${params.toString()}`)
  }

  return (
    <div className="space-y-4">
      <ReportFilterBar value={filter} onChange={setFilter} />

      {error && <ErrorBox message={error} />}

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
        <KpiCard label="Toplam İş" value={data?.total ?? 0} />
        <KpiCard label="İptal Edilen" value={data?.cancelled ?? 0} invertColor onClick={drill} />
        <KpiCard label="İptal Oranı" value={data?.cancelRate ?? 0} suffix="%" invertColor />
      </div>

      <TrendAreaChart
        title="Aylık İptal Trendi"
        data={(data?.monthly ?? []).map((x: any) => ({ label: x.label, cancelled: x.count }))}
        series={[{ key: 'cancelled', name: 'İptal', color: SERIES_COLORS.cancelled }]}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <RankingChart
          title="Bayi Bazlı İptal"
          data={(data?.byDealer ?? []).slice(0, 10).map((x: any) => ({ ...x, name: x.dealerName || x.dealerCode }))}
          nameKey="name"
          valueKey="count"
          valueName="İptal"
          onSelect={(row) => navigate(`/raporlar/bayi/${encodeURIComponent(row.dealerCode)}`)}
        />

        <RankingChart
          title="Teknisyen Bazlı İptal"
          data={(data?.byTechnician ?? []).slice(0, 10).map((x: any) => ({ ...x, name: x.technicianName }))}
          nameKey="name"
          valueKey="count"
          valueName="İptal"
          onSelect={(row) => navigate(`/raporlar/teknisyen/${row.technicianId}`)}
        />
      </div>

      <RankingChart
        title="Ürün Bazlı İptal"
        data={(data?.byProduct ?? []).slice(0, 12).map((x: any) => ({ ...x, name: x.productName }))}
        nameKey="name"
        valueKey="count"
        valueName="İptal"
        onSelect={(row) => row.stockCode && navigate(`/raporlar/urun/${encodeURIComponent(row.stockCode)}`)}
      />

      {/* Sistemde iptal nedeni alanı yok — sahte bir kırılım üretmek yerine sebebi yazılıyor. */}
      {data?.reasonBreakdownAvailable === false && (
        <EmptyChart
          title="İptal Nedenleri"
          reason="İptal nedeni hiçbir tabloda tutulmuyor. Bu kırılım için iptal ekranına zorunlu sebep alanı eklenmesi gerekiyor."
        />
      )}

      <ReportTable
        title="Bayi Bazlı İptal Tablosu"
        columns={[
          { key: 'dealerName', header: 'Bayi', format: (r: any) => r.dealerName || r.dealerCode },
          { key: 'dealerCode', header: 'Kod' },
          { key: 'count', header: 'İptal', align: 'right' }
        ]}
        rows={data?.byDealer ?? []}
        loading={loading}
        onRowClick={(row: any) => navigate(`/raporlar/bayi/${encodeURIComponent(row.dealerCode)}`)}
      />
    </div>
  )
}
