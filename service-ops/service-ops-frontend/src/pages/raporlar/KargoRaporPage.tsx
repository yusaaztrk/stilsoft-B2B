import { useState } from 'react'

import { fetchCargo, type ReportFilter } from '../../api/reports'
import { useReportData } from '../../hooks/useReportData'
import ReportFilterBar from '../../components/reports/ReportFilterBar'
import KpiCard from '../../components/reports/KpiCard'
import ReportTable from '../../components/reports/ReportTable'
import { DonutChart, EmptyChart, SERIES_COLORS, TrendAreaChart } from '../../components/reports/Charts'
import { ErrorBox } from './MontajRaporPage'

export default function KargoRaporPage() {
  const [filter, setFilter] = useState<ReportFilter>({ preset: 'buAy' })
  const { data, loading, error } = useReportData((f) => fetchCargo(f), filter)

  const byStatus = data?.byStatus ?? []
  const find = (s: string) => byStatus.find((x: any) => x.status === s)?.count ?? 0

  return (
    <div className="space-y-4">
      <ReportFilterBar value={filter} onChange={setFilter} hide={['type', 'category', 'dealer', 'search']} />

      {error && <ErrorBox message={error} />}

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
        <KpiCard label="Toplam Kargo" value={data?.total ?? 0} />
        <KpiCard label="Alındı" value={find('Received')} />
        <KpiCard label="Planlandı" value={find('Planned')} />
        <KpiCard label="Hazırlanıyor" value={find('Preparing')} />
        <KpiCard label="Dağıtımda" value={find('OutForDelivery')} />
        <KpiCard label="Teslim Edildi" value={data?.delivered ?? 0} />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <KpiCard
          label="Ort. Teslim Süresi"
          value={data?.avgDeliveryHours ?? 0}
          suffix="saat"
          invertColor
          hint="Sipariş → teslim"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <TrendAreaChart
          title="Aylık Kargo Trendi"
          data={(data?.monthly ?? []).map((x: any) => ({ label: x.label, total: x.count }))}
          series={[{ key: 'total', name: 'Kargo', color: SERIES_COLORS.total }]}
        />

        <DonutChart
          title="Durum Dağılımı"
          subtitle="Beş durum — bütünün tamamı"
          data={byStatus.map((x: any) => ({ name: x.label, value: x.count }))}
          nameKey="name"
          valueKey="value"
        />
      </div>

      <ReportTable
        title="Teknisyen Bazlı Teslimat"
        columns={[
          { key: 'technicianName', header: 'Teknisyen' },
          { key: 'total', header: 'Toplam', align: 'right' },
          { key: 'delivered', header: 'Teslim Edilen', align: 'right' }
        ]}
        rows={data?.byTechnician ?? []}
        loading={loading}
      />

      {/*
        İki bölüm bilerek çizilmiyor. Uydurma alan üretmek yerine sebebi yazılıyor:
        kargo durum listesinde "iptal" diye bir değer yok ve kargo kaydında bayi/cari alanı yok.
      */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {data?.cancellationTracked === false && (
          <EmptyChart
            title="İptal Edilen Kargolar"
            reason="Kargo durum listesinde 'İptal' değeri bulunmuyor — bu veri sistemde tutulmuyor."
          />
        )}
        {data?.dealerBreakdownAvailable === false && (
          <EmptyChart
            title="Bayi Bazlı Kargo"
            reason="Kargo kaydında bayi/cari alanı yok; sipariş numarası üzerinden bağ kurulması gerekiyor."
          />
        )}
      </div>
    </div>
  )
}
