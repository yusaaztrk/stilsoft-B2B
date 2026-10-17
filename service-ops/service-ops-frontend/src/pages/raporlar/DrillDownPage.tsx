import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Download } from 'lucide-react'

import { downloadRecordsExcel, fetchRecords, type ReportFilter, type ReportRecord } from '../../api/reports'
import { useReportData } from '../../hooks/useReportData'
import { exportRowsToExcel } from '../../components/reports/exportExcel'

/** Excel başlıkları ekrandakiyle birebir; kolon anahtarı DTO alanı. */
const EXPORT_COLUMNS = [
  { key: 'serviceNumber', header: 'Servis No' },
  { key: 'statusLabel', header: 'Durum' },
  { key: 'type', header: 'Tip' },
  { key: 'productName', header: 'Ürün' },
  { key: 'productStockCode', header: 'Stok Kodu' },
  { key: 'serialNumber', header: 'Seri No' },
  { key: 'customerName', header: 'Müşteri' },
  { key: 'dealerName', header: 'Bayi' },
  { key: 'technicianName', header: 'Teknisyen' },
  { key: 'createdAt', header: 'Açılış' },
  { key: 'completedAt', header: 'Tamamlanma' }
]

const METRIC_LABELS: Record<string, string> = {
  completed: 'Tamamlanan İşler',
  cancelled: 'İptal Edilen İşler',
  inProgress: 'Devam Eden İşler',
  pending: 'Bekleyen İşler',
  sameDay: 'Aynı Gün Tamamlananlar'
}

/**
 * Karttan/grafikten gelinen kayıt listesi.
 *
 * Filtreler URL'de taşınıyor: kullanıcı bağlantıyı paylaştığında ya da geri gelip yeniden
 * ileri gittiğinde aynı listeyi görüyor. Sayfalama sunucuda — 20 bin kaydı tarayıcıya çekip
 * orada dilimlemek bu ekranı kilitlerdi.
 */
export default function DrillDownPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const [page, setPage] = useState(1)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)

  const filter = useMemo<ReportFilter>(() => {
    const f: ReportFilter = { page, pageSize: 50 }
    for (const [k, v] of params.entries()) {
      if (k === 'page' || k === 'pageSize') continue
      ;(f as any)[k] = v
    }
    return f
  }, [params, page])

  const { data, loading, error } = useReportData((f) => fetchRecords(f), filter)

  const metric = params.get('metric') ?? ''
  const title = METRIC_LABELS[metric] ?? 'Kayıtlar'

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="h-8 w-8 grid place-items-center rounded-lg border border-gray-200 hover:bg-gray-50 transition"
          >
            <ArrowLeft size={15} className="text-gray-600" />
          </button>
          <div>
            <div className="text-sm font-black text-gray-900">{title}</div>
            <div className="text-[11px] text-gray-400">{data ? `${data.total} kayıt` : '…'}</div>
          </div>
        </div>

        <div className="flex gap-1.5">
          <button
            type="button"
            disabled={!data || data.items.length === 0}
            onClick={() => data && exportRowsToExcel<ReportRecord>(EXPORT_COLUMNS, data.items, title)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-[11px] font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-40 transition"
          >
            <Download size={13} />
            Bu Sayfa
          </button>

          <button
            type="button"
            disabled={!data || data.total === 0 || exporting}
            onClick={async () => {
              setExporting(true)
              setExportError(null)
              try {
                // Tümü sunucuda üretilir; on binlerce satır tarayıcıya hiç gelmez.
                await downloadRecordsExcel(filter)
              } catch (e: any) {
                setExportError(String(e?.message ?? 'Dışa aktarma başarısız'))
              } finally {
                setExporting(false)
              }
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-900 text-white text-[11px] font-bold hover:bg-black disabled:opacity-40 transition"
          >
            <Download size={13} />
            {exporting ? 'Hazırlanıyor…' : `Tümü (${data?.total ?? 0})`}
          </button>
        </div>
      </div>

      {(error || exportError) && (
        <div className="bg-rose-50 border border-rose-200 text-rose-700 rounded-xl px-4 py-3 text-xs">
          {error ?? exportError}
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-[11px] mobile-stack">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {['Servis No', 'Durum', 'Tip', 'Ürün', 'Seri No', 'Müşteri', 'Bayi', 'Teknisyen', 'Açılış', 'Tamamlanma'].map((h) => (
                  <th key={h} className="text-left font-bold text-gray-500 uppercase tracking-wide px-3 py-2 whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading && !data ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i}><td colSpan={10} className="px-3 py-3"><div className="h-3 bg-gray-100 rounded animate-pulse" /></td></tr>
                ))
              ) : data && data.items.length > 0 ? (
                data.items.map((r) => (
                  <tr key={r.id} className="hover:bg-gray-50/70 transition">
                    <td data-label="Servis No" className="px-3 py-2 font-bold text-gray-900 whitespace-nowrap">{r.serviceNumber}</td>
                    <td data-label="Durum" className="px-3 py-2 whitespace-nowrap">
                      <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-700 font-semibold">{r.statusLabel}</span>
                    </td>
                    <td data-mobile-hide data-label="Tip" className="px-3 py-2 text-gray-600 whitespace-nowrap">{r.type === 'Installation' ? 'Montaj' : 'Arıza'}</td>
                    <td data-label="Ürün" className="px-3 py-2 text-gray-800 max-w-[220px] truncate" title={r.productName}>{r.productName}</td>
                    <td data-mobile-hide data-label="Seri No" className="px-3 py-2 text-gray-500 whitespace-nowrap">{r.serialNumber ?? '-'}</td>
                    <td data-label="Müşteri" className="px-3 py-2 text-gray-600 max-w-[160px] truncate">{r.customerName ?? '-'}</td>
                    <td data-mobile-hide data-label="Bayi" className="px-3 py-2 text-gray-600 max-w-[160px] truncate">{r.dealerName ?? r.dealerCode ?? '-'}</td>
                    <td data-label="Teknisyen" className="px-3 py-2 text-gray-600 whitespace-nowrap">{r.technicianName ?? '-'}</td>
                    <td data-mobile-hide data-label="Açılış" className="px-3 py-2 text-gray-500 whitespace-nowrap">{formatDate(r.createdAt)}</td>
                    <td data-mobile-hide data-label="Tamamlanma" className="px-3 py-2 text-gray-500 whitespace-nowrap">{formatDate(r.completedAt)}</td>
                  </tr>
                ))
              ) : (
                <tr><td colSpan={10} className="px-3 py-8 text-center text-gray-400">Kayıt bulunamadı</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {data && data.total > data.pageSize && (
          <div className="flex items-center justify-between px-3 py-2 border-t border-gray-200 bg-gray-50/60">
            <span className="text-[11px] text-gray-500">Sayfa {data.page} / {totalPages}</span>
            <div className="flex gap-1.5">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="px-2.5 py-1 rounded-lg border border-gray-200 bg-white text-[11px] font-bold disabled:opacity-40"
              >
                Önceki
              </button>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="px-2.5 py-1 rounded-lg border border-gray-200 bg-white text-[11px] font-bold disabled:opacity-40"
              >
                Sonraki
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function formatDate(value?: string | null) {
  if (!value) return '-'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '-'
  return d.toLocaleDateString('tr-TR')
}
