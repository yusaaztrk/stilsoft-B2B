import { useState } from 'react'

import { fetchSparePartRequests, type ReportFilter } from '../../api/reports'
import { useReportData } from '../../hooks/useReportData'
import ReportFilterBar from '../../components/reports/ReportFilterBar'
import KpiCard from '../../components/reports/KpiCard'
import ReportTable from '../../components/reports/ReportTable'
import { EmptyChart, RankingChart, SERIES_COLORS, TrendAreaChart } from '../../components/reports/Charts'
import { ErrorBox } from './MontajRaporPage'

/**
 * Ekranın adı bilinçli olarak "Talep Analizi".
 *
 * Servis kaydı ile kullanılan parça arasında bir bağ tutulmuyor (InventoryUsage tablosuna hiç
 * satır yazılmıyor), dolayısıyla "kullanım" raporu üretilemez. Elde olan veri teknisyenlerin
 * parça TALEPLERİ; rapor da onu gösteriyor.
 */
export default function YedekParcaRaporPage() {
  const [filter, setFilter] = useState<ReportFilter>({ preset: 'son6Ay' })
  const { data, loading, error } = useReportData((f) => fetchSparePartRequests(f, 20), filter)

  const byStatus = data?.byStatus ?? []
  const pending = byStatus.find((x: any) => String(x.status).toLowerCase() === 'pending')?.count ?? 0
  const completed = byStatus.find((x: any) => String(x.status).toLowerCase() === 'completed')?.count ?? 0

  return (
    <div className="space-y-4">
      <ReportFilterBar value={filter} onChange={setFilter} hide={['type', 'category', 'dealer', 'technician', 'search']} />

      {error && <ErrorBox message={error} />}

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
        <KpiCard label="Toplam Talep" value={data?.totalRequests ?? 0} />
        <KpiCard label="Talep Edilen Adet" value={data?.totalQuantity ?? 0} />
        <KpiCard label="Bekleyen" value={pending} invertColor />
        <KpiCard label="Karşılanan" value={completed} />
        <KpiCard
          label="Ort. Karşılanma"
          value={data?.avgFulfilHours ?? 0}
          suffix="saat"
          invertColor
          hint="Talep → tamamlanma"
        />
      </div>

      <TrendAreaChart
        title="Aylık Talep Trendi"
        subtitle="Talep edilen adet"
        data={(data?.monthly ?? []).map((x: any) => ({ label: x.label, quantity: x.quantity }))}
        series={[{ key: 'quantity', name: 'Adet', color: SERIES_COLORS.installations }]}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <RankingChart
          title="En Çok Talep Edilen 20 Parça"
          data={(data?.byPart ?? []).map((x: any) => ({ ...x, name: x.partName || x.stockCode }))}
          nameKey="name"
          valueKey="quantity"
          valueName="Adet"
        />

        <RankingChart
          title="Teknisyen Bazlı Talep"
          data={(data?.byTechnician ?? []).map((x: any) => ({ ...x, name: x.technicianName }))}
          nameKey="name"
          valueKey="quantity"
          valueName="Adet"
        />
      </div>

      {data?.usageTrackingAvailable === false && (
        <EmptyChart
          title="Parça Kullanım Analizi (ürün / bayi / servis kırılımı)"
          reason="Servis kaydı ile kullanılan parça arasında bağ tutulmuyor. Bu analiz için atölye/servis fişi ekranına parça kullanım kaydı eklenmesi gerekiyor."
        />
      )}

      <ReportTable
        title="Parça Talep Tablosu"
        columns={[
          { key: 'partName', header: 'Parça' },
          { key: 'stockCode', header: 'Stok Kodu' },
          { key: 'requests', header: 'Talep', align: 'right' },
          { key: 'quantity', header: 'Adet', align: 'right' }
        ]}
        rows={data?.byPart ?? []}
        loading={loading}
      />
    </div>
  )
}
