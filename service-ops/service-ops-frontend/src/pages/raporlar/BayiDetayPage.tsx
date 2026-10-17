import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'

import { fetchDealerDetail, type ReportFilter } from '../../api/reports'
import { useReportData } from '../../hooks/useReportData'
import ReportFilterBar from '../../components/reports/ReportFilterBar'
import KpiCard from '../../components/reports/KpiCard'
import ReportTable from '../../components/reports/ReportTable'
import { RankingChart, SERIES_COLORS, TrendAreaChart } from '../../components/reports/Charts'
import { ErrorBox } from './MontajRaporPage'

export default function BayiDetayPage() {
  const { dealerCode = '' } = useParams()
  const navigate = useNavigate()
  const [filter, setFilter] = useState<ReportFilter>({ preset: 'son6Ay' })

  const { data, loading, error } = useReportData((f) => fetchDealerDetail(dealerCode, f), filter, [dealerCode])
  const s = data?.summary

  const drill = (extra?: Record<string, string>) => {
    const params = new URLSearchParams({ dealerCode })
    for (const [k, v] of Object.entries(filter)) {
      if (v !== undefined && v !== null && v !== '') params.set(k, String(v))
    }
    for (const [k, v] of Object.entries(extra ?? {})) params.set(k, v)
    navigate(`/raporlar/kayitlar?${params.toString()}`)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => navigate('/raporlar/bayi')}
          className="h-8 w-8 grid place-items-center rounded-lg border border-gray-200 hover:bg-gray-50 transition"
        >
          <ArrowLeft size={15} className="text-gray-600" />
        </button>
        <div>
          <div className="text-sm font-black text-gray-900">{dealerCode}</div>
          <div className="text-[11px] text-gray-400">Bayi detay analizi</div>
        </div>
      </div>

      <ReportFilterBar value={filter} onChange={setFilter} hide={['dealer', 'search']} />

      {error && <ErrorBox message={error} />}

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
        <KpiCard label="Toplam İş" value={s?.total ?? 0} onClick={() => drill()} />
        <KpiCard label="Tamamlanan" value={s?.completed ?? 0} onClick={() => drill({ metric: 'completed' })} />
        <KpiCard label="Devam Eden" value={s?.inProgress ?? 0} onClick={() => drill({ metric: 'inProgress' })} />
        <KpiCard label="Bekleyen" value={s?.pending ?? 0} onClick={() => drill({ metric: 'pending' })} />
        <KpiCard label="İptal" value={s?.cancelled ?? 0} invertColor onClick={() => drill({ metric: 'cancelled' })} />
        <KpiCard label="İptal Oranı" value={s?.cancelRate ?? 0} suffix="%" invertColor />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <KpiCard label="Başarı Oranı" value={s?.successRate ?? 0} suffix="%" />
        <KpiCard label="Ort. Çözüm Süresi" value={s?.avgCompletionHours ?? 0} suffix="saat" invertColor />
      </div>

      <TrendAreaChart
        title="Aylık İş Trendi"
        data={(data?.monthly ?? []).map((x: any) => ({ label: x.label, total: x.count }))}
        series={[{ key: 'total', name: 'İş', color: SERIES_COLORS.total }]}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <RankingChart
          title="Ürün Bazlı Dağılım"
          subtitle="Bu bayinin hangi üründen kaç iş açtığı"
          data={(data?.byProduct ?? []).slice(0, 12).map((x: any) => ({ ...x, name: x.productName }))}
          nameKey="name"
          valueKey="count"
          valueName="Kayıt"
          onSelect={(row) => row.stockCode && navigate(`/raporlar/urun/${encodeURIComponent(row.stockCode)}`)}
        />

        <RankingChart
          title="Bu Bayinin İşlerine Bakan Teknisyenler"
          data={(data?.byTechnician ?? []).slice(0, 12).map((x: any) => ({ ...x, name: x.technicianName }))}
          nameKey="name"
          valueKey="count"
          valueName="İş"
          onSelect={(row) => navigate(`/raporlar/teknisyen/${row.technicianId}`)}
        />
      </div>

      <ReportTable
        title="Ürün Kırılımı"
        columns={[
          { key: 'productName', header: 'Ürün' },
          { key: 'stockCode', header: 'Stok Kodu' },
          { key: 'count', header: 'Kayıt', align: 'right' }
        ]}
        rows={data?.byProduct ?? []}
        loading={loading}
        onRowClick={(row: any) => row.stockCode && navigate(`/raporlar/urun/${encodeURIComponent(row.stockCode)}`)}
      />
    </div>
  )
}
