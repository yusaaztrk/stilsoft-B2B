import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Trophy } from 'lucide-react'

import { fetchTechnicians, type ReportFilter } from '../../api/reports'
import { useReportData } from '../../hooks/useReportData'
import ReportFilterBar from '../../components/reports/ReportFilterBar'
import ReportTable from '../../components/reports/ReportTable'
import { RankingChart } from '../../components/reports/Charts'
import { ErrorBox } from './MontajRaporPage'

/** Sıralamaya girmek için gereken en az tamamlanmış iş — tek işi olan teknisyen başa geçmesin. */
const MIN_JOBS = 5

type TechRow = {
  technicianId: string
  technicianName: string
  total: number
  completed: number
  cancelled: number
  installations: number
  pending: number
  successRate: number
  cancelRate: number
  sameDayRate: number
  avgCompletionHours: number
  score?: number
}

/**
 * Ayın teknisyeni puanı.
 *
 * Yalnızca gerçekten hesaplanabilen dört bileşen kullanılıyor. Planda beşinci bileşen olarak
 * "tekrar servis oranı" vardı; o ölçü saklanan bir alandan gelmiyor ve bu uç döndürmüyor —
 * uydurmak yerine ağırlıklar kalan dörde bölündü. "Zamanında tamamlama" da yok: sistemde
 * termin/SLA alanı bulunmuyor.
 */
function scoreTechnicians(rows: TechRow[]): TechRow[] {
  const eligible = rows.filter((r) => r.completed >= MIN_JOBS)
  if (eligible.length === 0) return []

  const maxCompleted = Math.max(...eligible.map((r) => r.completed), 1)
  const durations = eligible.map((r) => r.avgCompletionHours).filter((h) => h > 0)
  const maxDuration = durations.length > 0 ? Math.max(...durations) : 1

  return eligible
    .map((r) => {
      const completedScore = (r.completed / maxCompleted) * 100
      // Süre düştükçe puan artar; süresi ölçülemeyen teknisyen ortalamadan sayılır.
      const speedScore = r.avgCompletionHours > 0 ? (1 - r.avgCompletionHours / maxDuration) * 100 : 50
      const cancelScore = 100 - Math.min(100, r.cancelRate)
      const sameDayScore = Math.min(100, r.sameDayRate)

      const score =
        0.35 * completedScore +
        0.30 * speedScore +
        0.20 * cancelScore +
        0.15 * sameDayScore

      return { ...r, score: Math.round(score * 10) / 10 }
    })
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
}

export default function TeknisyenRaporPage() {
  const navigate = useNavigate()
  const [filter, setFilter] = useState<ReportFilter>({ preset: 'buAy' })

  const { data, loading, error } = useReportData((f) => fetchTechnicians(f, 100), filter)
  const rows = (data ?? []) as TechRow[]

  const ranked = useMemo(() => scoreTechnicians(rows), [rows])
  const champion = ranked[0]

  const fastest = [...rows].filter((r) => r.completed >= MIN_JOBS && r.avgCompletionHours > 0)
    .sort((a, b) => a.avgCompletionHours - b.avgCompletionHours).slice(0, 10)
  const slowest = [...rows].filter((r) => r.completed >= MIN_JOBS && r.avgCompletionHours > 0)
    .sort((a, b) => b.avgCompletionHours - a.avgCompletionHours).slice(0, 10)

  return (
    <div className="space-y-4">
      <ReportFilterBar value={filter} onChange={setFilter} hide={['technician']} />

      {error && <ErrorBox message={error} />}

      {champion && (
        <div className="bg-gradient-to-r from-amber-50 to-white border border-amber-200 rounded-2xl p-4 flex items-center gap-4">
          <div className="h-11 w-11 rounded-2xl bg-amber-400/20 grid place-items-center shrink-0">
            <Trophy size={20} className="text-amber-600" />
          </div>
          <div className="min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-wide text-amber-700">Dönemin Teknisyeni</div>
            <div className="text-base font-black text-gray-900 truncate">{champion.technicianName}</div>
            <div className="text-[11px] text-gray-500 mt-0.5">
              Puan <b className="tabular-nums">{champion.score}</b> · {champion.completed} tamamlanan ·
              ort. {champion.avgCompletionHours} saat · iptal %{champion.cancelRate} · aynı gün %{champion.sameDayRate}
            </div>
          </div>
          <div className="ml-auto text-[10px] text-gray-400 max-w-[280px] hidden lg:block">
            Puan = 0,35×tamamlanan + 0,30×hız + 0,20×(100−iptal) + 0,15×aynı gün.
            En az {MIN_JOBS} tamamlanmış iş şartı var.
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <RankingChart
          title="En Fazla İş Yapan Teknisyenler"
          data={[...rows].sort((a, b) => b.total - a.total).slice(0, 10).map((x) => ({ ...x, name: x.technicianName }))}
          nameKey="name"
          valueKey="total"
          valueName="İş"
          onSelect={(row) => navigate(`/raporlar/teknisyen/${row.technicianId}`)}
        />

        <RankingChart
          title="En Fazla Montaj Yapan Teknisyenler"
          data={[...rows].sort((a, b) => b.installations - a.installations).slice(0, 10).map((x) => ({ ...x, name: x.technicianName }))}
          nameKey="name"
          valueKey="installations"
          valueName="Montaj"
          onSelect={(row) => navigate(`/raporlar/teknisyen/${row.technicianId}`)}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <RankingChart
          title="İşi En Hızlı Kapatanlar"
          subtitle={`En az ${MIN_JOBS} tamamlanmış işi olanlar`}
          data={fastest.map((x) => ({ ...x, name: x.technicianName }))}
          nameKey="name"
          valueKey="avgCompletionHours"
          valueName="Saat"
          onSelect={(row) => navigate(`/raporlar/teknisyen/${row.technicianId}`)}
        />

        <RankingChart
          title="İşi En Uzun Sürede Kapatanlar"
          subtitle={`En az ${MIN_JOBS} tamamlanmış işi olanlar`}
          data={slowest.map((x) => ({ ...x, name: x.technicianName }))}
          nameKey="name"
          valueKey="avgCompletionHours"
          valueName="Saat"
          onSelect={(row) => navigate(`/raporlar/teknisyen/${row.technicianId}`)}
        />
      </div>

      <ReportTable
        title="Performans Puanlaması"
        subtitle={`Puan = 0,35×tamamlanan + 0,30×hız + 0,20×(100−iptal) + 0,15×aynı gün · en az ${MIN_JOBS} iş`}
        columns={[
          { key: 'technicianName', header: 'Teknisyen' },
          { key: 'score', header: 'Puan', align: 'right' },
          { key: 'completed', header: 'Tamamlanan', align: 'right' },
          { key: 'avgCompletionHours', header: 'Ort. Süre (sa)', align: 'right' },
          { key: 'cancelRate', header: 'İptal %', align: 'right' },
          { key: 'sameDayRate', header: 'Aynı Gün %', align: 'right' }
        ]}
        rows={ranked}
        loading={loading}
        onRowClick={(row) => navigate(`/raporlar/teknisyen/${row.technicianId}`)}
        emptyText={`Puanlama için en az ${MIN_JOBS} tamamlanmış işi olan teknisyen yok`}
      />

      <ReportTable
        title="Tüm Teknisyenler"
        columns={[
          { key: 'technicianName', header: 'Teknisyen' },
          { key: 'total', header: 'Atanan', align: 'right' },
          { key: 'completed', header: 'Tamamlanan', align: 'right' },
          { key: 'pending', header: 'Bekleyen', align: 'right' },
          { key: 'cancelled', header: 'İptal', align: 'right' },
          { key: 'installations', header: 'Montaj', align: 'right' },
          { key: 'successRate', header: 'Başarı %', align: 'right' },
          { key: 'avgCompletionHours', header: 'Ort. Süre (sa)', align: 'right' }
        ]}
        rows={rows}
        loading={loading}
        onRowClick={(row) => navigate(`/raporlar/teknisyen/${row.technicianId}`)}
      />
    </div>
  )
}
