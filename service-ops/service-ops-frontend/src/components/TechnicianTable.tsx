import React, { useMemo } from 'react'
import { CalendarDays } from 'lucide-react'
import Table, { type TableColumn } from './Table'

/**
 * Teknisyen başına iş sayacı. Tek bir `/api/technicians/work-stats` çağrısından gelir —
 * satır başına ayrı istek atmak 12 teknisyende 12 istek demekti.
 */
export type TechnicianWorkStat = {
  technicianId: string
  today: { tasks: number; quantity: number; completed: number }
  month: { tasks: number; quantity: number; completed: number }
  total: { tasks: number; quantity: number; completed: number }
}

export type Technician = {
  id: string
  fullName: string
  initials: string
  employeeNumber?: string
  cariKodu?: string | null
  roleName?: string | null
  phone?: string
  email?: string
  regionName?: string
  warehouseCode?: number | null
  warehouseName?: string | null
  cashAccountId?: number | null
  cashAccountName?: string | null
  bankAccountId?: number | null
  bankAccountName?: string | null
  posAccountId?: number | null
  posAccountName?: string | null
  completedTasks: number
  totalTasks: number
  isActive: boolean
  /** `withWorkStats` ile eklenir; sıralama/süzme bu ham sayılar üzerinden yapılır. */
  bugunAdet?: number
  ayAdet?: number
  toplamAdet?: number
  workStat?: TechnicianWorkStat
}

/**
 * Teknisyen satırlarını iş sayaçlarıyla zenginleştirir.
 *
 * Sayılar satıra yazılıyor ki tablo sıralama ve sayısal süzme yapabilsin; `workStat` ise
 * hücrede "kaç iş / kaç tamamlandı" alt satırını çizmek için taşınıyor.
 */
export function withWorkStats(technicians: Technician[], stats: Record<string, TechnicianWorkStat>): Technician[] {
  return technicians.map((t) => {
    const s = stats[t.id]
    return {
      ...t,
      bugunAdet: s?.today.quantity ?? 0,
      ayAdet: s?.month.quantity ?? 0,
      toplamAdet: s?.total.quantity ?? 0,
      workStat: s,
    }
  })
}

interface TechnicianTableProps {
  technicians: Technician[]
  isLoading: boolean
  onRowClick: (id: string) => void
  /** Takvim kolonundaki düğme. Verilmezse kolon çizilmez. */
  onOpenCalendar?: (id: string) => void
}

export default function TechnicianTable({ technicians, isLoading, onRowClick, onOpenCalendar }: TechnicianTableProps) {
  const columns: TableColumn<Technician>[] = useMemo(() => [
    {
      key: 'fullName',
      label: 'Teknisyen',
      searchable: true,
      filter: { type: 'text' },
      render: (_v, row) => (
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#B91C1C] to-red-950 flex items-center justify-center text-white font-bold text-xs shadow-sm">
            {row.initials}
          </div>
          <div>
            <div className="font-semibold text-gray-900 text-sm leading-snug">{row.fullName}</div>
            <div className="text-[10px] text-gray-400 font-medium">
              {row.cariKodu ? `Cari: ${row.cariKodu}` : (row.employeeNumber ? `Sicil: ${row.employeeNumber}` : '-')}
            </div>
          </div>
        </div>
      )
    },
    {
      key: 'cariKodu',
      label: 'Cari Kodu',
      searchable: true,
      filter: { type: 'text' },
      render: (v: any, row) => <span className="text-xs font-mono font-semibold text-gray-800">{v || row.employeeNumber || '-'}</span>
    },
    {
      key: 'roleName',
      label: 'Yetki Rolü',
      searchable: true,
      filter: { type: 'text' },
      render: (v: any) => <span className="text-xs font-medium text-blue-700 bg-blue-50 px-2 py-0.5 rounded">{v || '-'}</span>
    },
    {
      key: 'phone',
      label: 'Telefon',
      searchable: true,
      filter: { type: 'text' },
      render: (v: any) => <span className="text-xs font-semibold text-gray-750">{v || '-'}</span>
    },
    {
      key: 'email',
      label: 'Email',
      searchable: true,
      filter: { type: 'text' },
      render: (v: any) => <span className="text-xs text-gray-600">{v || '-'}</span>
    },
    {
      key: 'regionName',
      label: 'Bölge',
      searchable: true,
      filter: { type: 'text' },
      render: (v: any) => <span className="text-xs text-gray-600">{v || 'Bölge atanmamış'}</span>
    },
    {
      key: 'warehouseName',
      label: 'Araç Deposu',
      searchable: true,
      filter: { type: 'text' },
      render: (v: any) => <span className="text-xs text-gray-700 font-medium">{v || '-'}</span>
    },
    {
      key: 'cashAccountName',
      label: 'Kasa Hesabı',
      searchable: true,
      filter: { type: 'text' },
      render: (v: any) => <span className="text-xs text-emerald-700 font-medium">{v || '-'}</span>
    },
    {
      key: 'bankAccountName',
      label: 'Banka Hesabı',
      searchable: true,
      filter: { type: 'text' },
      render: (v: any) => <span className="text-xs text-blue-750 font-medium">{v || '-'}</span>
    },
    {
      key: 'totalTasks',
      label: 'Bugünkü Yük',
      searchable: false,
      render: (_v, row) => (
        <span className="text-xs text-gray-900 font-bold">
          {row.completedTasks ?? 0}/{row.totalTasks ?? 0}
        </span>
      )
    },
    // İŞ SAYAÇLARI.
    //
    // Değerler SATIR NESNESİNE yazılır (sayfa `withWorkStats` ile besliyor), kolon yalnızca
    // biçimlendirir. Sebep: tablo motoru sıralama ve süzme için hücrenin HAM değerine bakıyor,
    // render çıktısına değil — sayıyı sadece render içinde üretseydik "Bu Ay"a göre sıralama
    // ve sayısal süzgeç çalışmazdı.
    {
      key: 'bugunAdet',
      label: 'Bugün',
      searchable: false,
      filter: { type: 'number' },
      render: (_v, row) => <WorkCell stat={row.workStat?.today} tone="amber" />,
    },
    {
      key: 'ayAdet',
      label: 'Bu Ay',
      searchable: false,
      filter: { type: 'number' },
      render: (_v, row) => <WorkCell stat={row.workStat?.month} tone="blue" />,
    },
    {
      key: 'toplamAdet',
      label: 'Toplam',
      searchable: false,
      filter: { type: 'number' },
      render: (_v, row) => <WorkCell stat={row.workStat?.total} tone="gray" />,
    },
    ...(onOpenCalendar
      ? [{
          key: 'takvim' as any,
          label: 'Takvim',
          searchable: false,
          render: (_v: any, row: Technician) => (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onOpenCalendar(row.id) }}
              title="İş takvimini aç"
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-bold text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg transition-colors cursor-pointer"
            >
              <CalendarDays className="w-3.5 h-3.5" />
              Takvim
            </button>
          ),
        } as TableColumn<Technician>]
      : []),
  ], [onOpenCalendar])

  if (isLoading) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-sm text-gray-500 font-medium shadow-sm">
        <div className="flex flex-col items-center gap-2">
          <div className="w-6 h-6 border-2 border-red-600 border-t-transparent rounded-full animate-spin"></div>
          Yükleniyor...
        </div>
      </div>
    )
  }

  if (technicians.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-sm text-gray-400 shadow-sm">
        Teknisyen bulunamadı.
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-visible min-h-[350px] shadow-sm p-2">
      <Table
        columns={columns}
        data={technicians}
        showColumnFilters
        pageSize={15}
        onRowClick={(row) => onRowClick(row.id)}
        rowKey={(r) => r.id}
      />
    </div>
  )
}

/**
 * Bir sayaç hücresi: büyük rakam ADET, altındaki satır iş sayısı ve tamamlanan.
 * Adet öne alındı çünkü planlamada yükü belirleyen kayıt sayısı değil adet.
 */
function WorkCell({ stat, tone }: { stat?: { tasks: number; quantity: number; completed: number }; tone: 'amber' | 'blue' | 'gray' }) {
  if (!stat || stat.tasks === 0) return <span className="text-xs text-gray-300">-</span>

  const color = tone === 'amber' ? 'text-amber-700' : tone === 'blue' ? 'text-blue-700' : 'text-gray-900'
  return (
    <div className="leading-tight">
      <div className={`text-xs font-bold ${color}`}>{stat.quantity} adet</div>
      <div className="text-[10px] text-gray-500">
        {stat.tasks} iş{stat.completed > 0 ? ` · ${stat.completed} bitti` : ''}
      </div>
    </div>
  )
}
