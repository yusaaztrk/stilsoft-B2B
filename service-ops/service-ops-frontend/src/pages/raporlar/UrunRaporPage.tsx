import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { fetchProducts, type ReportFilter } from '../../api/reports'
import { useReportData } from '../../hooks/useReportData'
import ReportFilterBar from '../../components/reports/ReportFilterBar'
import ReportTable from '../../components/reports/ReportTable'
import { EmptyChart, RankingChart } from '../../components/reports/Charts'
import { ErrorBox } from './MontajRaporPage'

export default function UrunRaporPage() {
  const navigate = useNavigate()
  const [filter, setFilter] = useState<ReportFilter>({ preset: 'son3Ay' })

  const { data, loading, error } = useReportData((f) => fetchProducts(f, 100), filter)
  const rows = data ?? []

  const open = (stockCode?: string) => stockCode && navigate(`/raporlar/urun/${encodeURIComponent(stockCode)}`)

  const mostRepairs = [...rows].sort((a, b) => b.repairs - a.repairs).slice(0, 10)
  const mostInstalls = [...rows].sort((a, b) => b.installations - a.installations).slice(0, 10)
  const slowest = [...rows].filter((r) => r.avgCompletionHours > 0 && r.total >= 3)
    .sort((a, b) => b.avgCompletionHours - a.avgCompletionHours).slice(0, 10)
  const worstCancel = [...rows].filter((r) => r.total >= 5).sort((a, b) => b.cancelRate - a.cancelRate).slice(0, 10)

  return (
    <div className="space-y-4">
      <ReportFilterBar value={filter} onChange={setFilter} />

      {error && <ErrorBox message={error} />}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <RankingChart
          title="En Çok Arıza Kaydı Açılan Ürünler"
          data={mostRepairs.map((x) => ({ ...x, name: x.productName }))}
          nameKey="name"
          valueKey="repairs"
          valueName="Arıza"
          onSelect={(row) => open(row.stockCode)}
        />

        <RankingChart
          title="En Çok Monte Edilen Ürünler"
          data={mostInstalls.map((x) => ({ ...x, name: x.productName }))}
          nameKey="name"
          valueKey="installations"
          valueName="Montaj"
          onSelect={(row) => open(row.stockCode)}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <RankingChart
          title="Ortalama Çözüm Süresi En Uzun Ürünler"
          subtitle="En az 3 kaydı olan ürünler"
          data={slowest.map((x) => ({ ...x, name: x.productName }))}
          nameKey="name"
          valueKey="avgCompletionHours"
          valueName="Saat"
          onSelect={(row) => open(row.stockCode)}
        />

        <RankingChart
          title="İptal Oranı Yüksek Ürünler"
          subtitle="En az 5 kaydı olan ürünler"
          data={worstCancel.map((x) => ({ ...x, name: x.productName }))}
          nameKey="name"
          valueKey="cancelRate"
          valueName="İptal %"
          onSelect={(row) => open(row.stockCode)}
        />
      </div>

      {/*
        Marka ve kategori kırılımı bilinçli olarak yok: bu alanlar servis kaydında tutulmuyor,
        ürün kartındaki karşılıkları B2B tarafında duruyor. Boş grafik yerine sebep yazılıyor.
      */}
      <EmptyChart
        title="Marka / Kategori Dağılımı"
        reason="Servis kaydında marka ve kategori alanı yok; bu kırılım için B2B ürün kartından günlük senkron gerekiyor."
      />

      <ReportTable
        title="Ürün Analiz Tablosu"
        subtitle="Satıra tıklayarak ürünün tüm servis geçmişine gidin"
        columns={[
          { key: 'productName', header: 'Ürün' },
          { key: 'stockCode', header: 'Stok Kodu' },
          { key: 'total', header: 'Toplam', align: 'right' },
          { key: 'installations', header: 'Montaj', align: 'right' },
          { key: 'repairs', header: 'Arıza', align: 'right' },
          { key: 'completed', header: 'Tamamlanan', align: 'right' },
          { key: 'cancelled', header: 'İptal', align: 'right' },
          { key: 'underWarranty', header: 'Garantili', align: 'right' },
          { key: 'cancelRate', header: 'İptal %', align: 'right' },
          { key: 'avgCompletionHours', header: 'Ort. Süre (sa)', align: 'right' }
        ]}
        rows={rows}
        loading={loading}
        onRowClick={(row) => open(row.stockCode)}
      />
    </div>
  )
}
