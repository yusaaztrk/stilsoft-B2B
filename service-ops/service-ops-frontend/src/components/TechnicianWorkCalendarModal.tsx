import { useEffect, useMemo, useState } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight, X } from 'lucide-react'
import { apiJson } from '../api/client'

/**
 * Teknisyenin iş takvimi.
 *
 * Liste ekranındaki sayaçlar "ne kadar" sorusuna cevap veriyor; bu ekran "NE ZAMAN ve NE"
 * sorusuna bakıyor. Ay ay gezilir, bir güne basınca o günün işleri (kayıt, ürün, müşteri, adet)
 * altta açılır.
 *
 * Sayım birimi GÖREV satırıdır: bir montaj kaydı birden çok kişiye bölünebildiği için kaydı
 * saymak kimin ne yaptığını göstermez. Adet ayrıca toplanır — 20 adetlik satır ile 1 adetlik
 * satır aynı yük değil.
 */

type DayItem = {
  serviceNumber?: string
  productName?: string
  customerName?: string
  regionName?: string
  quantity: number
  completed: boolean
}

type DayBucket = {
  date: string
  tasks: number
  quantity: number
  completed: number
  items: DayItem[]
}

type MonthBucket = {
  year: number
  month: number
  tasks: number
  quantity: number
  completed: number
}

type CalendarResponse = {
  year: number
  month: number
  days: DayBucket[]
  months: MonthBucket[]
  total: { tasks: number; quantity: number; completed: number }
}

const MONTH_NAMES = [
  'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
  'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık',
]

const WEEKDAYS = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz']

function isoDay(year: number, month: number, day: number) {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${year}-${p(month)}-${p(day)}`
}

type Props = {
  isOpen: boolean
  technicianId: string
  technicianName: string
  onClose: () => void
}

export default function TechnicianWorkCalendarModal({ isOpen, technicianId, technicianName, onClose }: Props) {
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [data, setData] = useState<CalendarResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedDay, setSelectedDay] = useState<string | null>(null)

  useEffect(() => {
    if (!isOpen) return
    // Modal her açılışta içinde bulunulan aya döner; önceki teknisyenin ayında açılması
    // yanlış veriye bakıldığı izlenimi veriyordu.
    setYear(now.getFullYear())
    setMonth(now.getMonth() + 1)
    setSelectedDay(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, technicianId])

  useEffect(() => {
    if (!isOpen || !technicianId) return
    let active = true
    setLoading(true)
    setError(null)
    apiJson<CalendarResponse>(`/api/technicians/${technicianId}/work-calendar?year=${year}&month=${month}`)
      .then((res) => { if (active) setData(res) })
      .catch((err: any) => { if (active) setError(err?.message || 'Takvim yüklenemedi.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [isOpen, technicianId, year, month])

  const dayMap = useMemo(() => {
    const map = new Map<string, DayBucket>()
    for (const d of data?.days ?? []) map.set(d.date, d)
    return map
  }, [data])

  /** Ayın hücreleri; ilk gün Pazartesi'ye hizalanır. */
  const cells = useMemo(() => {
    const first = new Date(year, month - 1, 1)
    const daysInMonth = new Date(year, month, 0).getDate()
    // getDay(): 0 = Pazar. Pazartesi başlangıçlı ızgara için kaydırılır.
    const lead = (first.getDay() + 6) % 7
    const out: Array<{ day: number | null; iso: string | null }> = []
    for (let i = 0; i < lead; i++) out.push({ day: null, iso: null })
    for (let d = 1; d <= daysInMonth; d++) out.push({ day: d, iso: isoDay(year, month, d) })
    return out
  }, [year, month])

  const monthTotals = useMemo(() => {
    const arr = data?.days ?? []
    return {
      tasks: arr.reduce((s, d) => s + d.tasks, 0),
      quantity: arr.reduce((s, d) => s + d.quantity, 0),
      completed: arr.reduce((s, d) => s + d.completed, 0),
    }
  }, [data])

  const maxQuantity = useMemo(
    () => Math.max(1, ...(data?.days ?? []).map((d) => d.quantity)),
    [data]
  )

  const shiftMonth = (delta: number) => {
    const next = new Date(year, month - 1 + delta, 1)
    setYear(next.getFullYear())
    setMonth(next.getMonth() + 1)
    setSelectedDay(null)
  }

  const todayIso = isoDay(now.getFullYear(), now.getMonth() + 1, now.getDate())
  const selected = selectedDay ? dayMap.get(selectedDay) : null

  if (!isOpen) return null

  return (
    <>
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[60]" onClick={onClose} />
      <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
        <div className="w-full max-w-4xl bg-white rounded-2xl shadow-2xl overflow-hidden max-h-[92vh] flex flex-col">

          <div className="px-5 py-4 border-b border-gray-150 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-red-50 text-red-600 flex items-center justify-center">
                <CalendarDays className="w-5 h-5" />
              </div>
              <div>
                <div className="text-sm font-bold text-gray-900">{technicianName} · İş Takvimi</div>
                <div className="text-[11px] text-gray-500">Bir güne basınca o günün işleri açılır.</div>
              </div>
            </div>
            <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-gray-700 rounded-lg hover:bg-gray-100">
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="p-5 overflow-y-auto">

            {/* Özet: bu ay ve tüm zamanlar */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-4">
              <SummaryTile label="Bu Ay İş" value={monthTotals.tasks} tone="blue" />
              <SummaryTile label="Bu Ay Adet" value={monthTotals.quantity} tone="blue" />
              <SummaryTile label="Toplam İş" value={data?.total.tasks ?? 0} tone="gray" />
              <SummaryTile label="Toplam Adet" value={data?.total.quantity ?? 0} tone="gray" />
            </div>

            <div className="flex items-center justify-between mb-2.5">
              <button onClick={() => shiftMonth(-1)} className="p-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600">
                <ChevronLeft className="w-4 h-4" />
              </button>
              <div className="text-sm font-bold text-gray-900">{MONTH_NAMES[month - 1]} {year}</div>
              <button onClick={() => shiftMonth(1)} className="p-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600">
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            {error && (
              <div className="mb-3 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-[12px] text-red-700">{error}</div>
            )}

            <div className={`grid grid-cols-7 gap-1.5 ${loading ? 'opacity-50' : ''}`}>
              {WEEKDAYS.map((w) => (
                <div key={w} className="text-[10px] font-bold text-gray-400 uppercase text-center py-1">{w}</div>
              ))}
              {cells.map((c, i) => {
                if (!c.day || !c.iso) return <div key={`bos-${i}`} />
                const bucket = dayMap.get(c.iso)
                const isToday = c.iso === todayIso
                const isSelected = c.iso === selectedDay
                // Yoğunluk: o ayın en yüksek adedine göre oransal dolgu.
                const ratio = bucket ? bucket.quantity / maxQuantity : 0
                const bg = !bucket
                  ? 'bg-white'
                  : ratio > 0.66 ? 'bg-red-100 border-red-300'
                  : ratio > 0.33 ? 'bg-amber-50 border-amber-200'
                  : 'bg-emerald-50 border-emerald-200'
                return (
                  <button
                    key={c.iso}
                    onClick={() => setSelectedDay(bucket ? c.iso : null)}
                    disabled={!bucket}
                    className={`min-h-[62px] rounded-lg border p-1.5 text-left transition-all ${bg} ${
                      isSelected ? 'ring-2 ring-red-500' : 'border-gray-150'
                    } ${bucket ? 'cursor-pointer hover:shadow-sm' : 'cursor-default'}`}
                  >
                    <div className={`text-[11px] font-bold ${isToday ? 'text-red-600' : 'text-gray-700'}`}>
                      {c.day}{isToday ? ' •' : ''}
                    </div>
                    {bucket && (
                      <div className="mt-0.5 leading-tight">
                        <div className="text-[11px] font-bold text-gray-900">{bucket.quantity} adet</div>
                        <div className="text-[10px] text-gray-500">{bucket.tasks} iş</div>
                      </div>
                    )}
                  </button>
                )
              })}
            </div>

            {selected && (
              <div className="mt-4 border border-gray-200 rounded-xl overflow-hidden">
                <div className="px-3 py-2 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
                  <div className="text-[12px] font-bold text-gray-800">
                    {new Date(selected.date).toLocaleDateString('tr-TR')} · {selected.tasks} iş · {selected.quantity} adet
                  </div>
                  <div className="text-[11px] text-emerald-700 font-semibold">{selected.completed} tamamlandı</div>
                </div>
                <div className="divide-y divide-gray-100 max-h-56 overflow-y-auto">
                  {selected.items.map((it, idx) => (
                    <div key={`${it.serviceNumber}-${idx}`} className="px-3 py-2 flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-[12px] font-semibold text-gray-900 truncate">{it.productName || '-'}</div>
                        <div className="text-[11px] text-gray-500 truncate">
                          {it.serviceNumber} · {it.customerName || 'Müşteri yok'}{it.regionName ? ` · ${it.regionName}` : ''}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-[12px] font-bold text-gray-900">{it.quantity} adet</div>
                        <div className={`text-[10px] font-semibold ${it.completed ? 'text-emerald-600' : 'text-amber-600'}`}>
                          {it.completed ? 'Tamamlandı' : 'Devam ediyor'}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Son 12 ay */}
            {(data?.months?.length ?? 0) > 0 && (
              <div className="mt-5">
                <div className="text-[11px] font-bold text-gray-500 uppercase mb-2">Aylık Dağılım (son 12 ay)</div>
                <div className="space-y-1.5">
                  {data!.months.map((mb) => {
                    const max = Math.max(1, ...data!.months.map((x) => x.quantity))
                    const isCurrent = mb.year === year && mb.month === month
                    return (
                      <button
                        key={`${mb.year}-${mb.month}`}
                        onClick={() => { setYear(mb.year); setMonth(mb.month); setSelectedDay(null) }}
                        className="w-full flex items-center gap-2 group"
                      >
                        <div className={`w-24 text-left text-[11px] shrink-0 ${isCurrent ? 'font-bold text-red-600' : 'text-gray-600'}`}>
                          {MONTH_NAMES[mb.month - 1]} {String(mb.year).slice(2)}
                        </div>
                        <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${isCurrent ? 'bg-red-500' : 'bg-red-300 group-hover:bg-red-400'}`}
                            style={{ width: `${Math.max(3, (mb.quantity / max) * 100)}%` }}
                          />
                        </div>
                        <div className="w-28 text-right text-[11px] text-gray-700 shrink-0">
                          <span className="font-bold">{mb.quantity}</span> adet · {mb.tasks} iş
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {!loading && (data?.days?.length ?? 0) === 0 && (
              <div className="mt-4 text-center text-[12px] text-gray-400 py-6">Bu ayda iş kaydı yok.</div>
            )}
          </div>

          <div className="px-5 py-3 border-t border-gray-150 flex justify-end">
            <button onClick={onClose} className="px-4 py-2 text-[13px] font-semibold text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50">
              Kapat
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

function SummaryTile({ label, value, tone }: { label: string; value: number; tone: 'blue' | 'gray' }) {
  const cls = tone === 'blue'
    ? 'bg-blue-50 border-blue-150 text-blue-700'
    : 'bg-gray-50 border-gray-200 text-gray-700'
  return (
    <div className={`rounded-xl border px-3 py-2 ${cls}`}>
      <div className="text-lg font-bold leading-none">{value}</div>
      <div className="text-[10px] font-semibold uppercase mt-1 opacity-80">{label}</div>
    </div>
  )
}
