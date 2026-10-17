import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'

import { fetchProductDetail, type ReportFilter } from '../../api/reports'
import { useReportData } from '../../hooks/useReportData'
import ReportFilterBar from '../../components/reports/ReportFilterBar'
import KpiCard from '../../components/reports/KpiCard'
import ReportTable from '../../components/reports/ReportTable'
import { RankingChart, SERIES_COLORS, TrendAreaChart } from '../../components/reports/Charts'
import { ErrorBox } from './MontajRaporPage'

export default function UrunDetayPage() {
  const { stockCode = '' } = useParams()
  const navigate = useNavigate()
  const [filter, setFilter] = useState<ReportFilter>({ preset: 'son6Ay' })

  const { data, loading, error } = useReportData((f) => fetchProductDetail(stockCode, f), filter, [stockCode])
  const s = data?.summary

  const drill = (metric?: string) => {
    const params = new URLSearchParams({ stockCode })
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
          onClick={() => navigate('/raporlar/urun')}
          className="h-8 w-8 grid place-items-center rounded-lg border border-gray-200 hover:bg-gray-50 transition"
        >
          <ArrowLeft size={15} className="text-gray-600" />
        </button>
        <div>
          <div className="text-sm font-black text-gray-900">{stockCode}</div>
          <div className="text-[11px] text-gray-400">Ürünün tüm servis geçmişi</div>
        </div>
      </div>

      <ReportFilterBar value={filter} onChange={setFilter} hide={['search']} />

      {error && <ErrorBox message={error} />}

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
        <KpiCard label="Toplam Kayıt" value={s?.total ?? 0} onClick={() => drill()} />
        <KpiCard label="Tamamlanan" value={s?.completed ?? 0} onClick={() => drill('completed')} />
        <KpiCard label="Bekleyen" value={s?.pending ?? 0} onClick={() => drill('pending')} />
        <KpiCard label="İptal" value={s?.cancelled ?? 0} invertColor onClick={() => drill('cancelled')} />
        <KpiCard label="Ort. Çözüm Süresi" value={s?.avgCompletionHours ?? 0} suffix="saat" invertColor />
      </div>

      <TrendAreaChart
        title="Aylık Kayıt Trendi"
        data={(data?.monthly ?? []).map((x: any) => ({ label: x.label, total: x.count }))}
        series={[{ key: 'total', name: 'Kayıt', color: SERIES_COLORS.total }]}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <RankingChart
          title="Bu Üründen Hangi Bayi Kaç Adet Verdi"
          data={(data?.byDealer ?? []).slice(0, 12).map((x: any) => ({ ...x, name: x.dealerName || x.dealerCode }))}
          nameKey="name"
          valueKey="total"
          valueName="Kayıt"
          onSelect={(row) => navigate(`/raporlar/bayi/${encodeURIComponent(row.dealerCode)}`)}
        />

        <RankingChart
          title="Bölge Dağılımı"
          data={(data?.byRegion ?? []).slice(0, 12)}
          nameKey="region"
          valueKey="count"
          valueName="Kayıt"
        />
      </div>

      <ReportTable
        title="Bayi Kırılımı"
        subtitle="Montaj ve arıza ayrı sütunlarda"
        columns={[
          { key: 'dealerName', header: 'Bayi', format: (r: any) => r.dealerName || r.dealerCode },
          { key: 'dealerCode', header: 'Kod' },
          { key: 'total', header: 'Toplam', align: 'right' },
          { key: 'installations', header: 'Montaj', align: 'right' },
          { key: 'repairs', header: 'Arıza', align: 'right' }
        ]}
        rows={data?.byDealer ?? []}
        loading={loading}
        onRowClick={(row: any) => navigate(`/raporlar/bayi/${encodeURIComponent(row.dealerCode)}`)}
      />
    </div>
  )
}
