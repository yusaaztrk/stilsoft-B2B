import React, { useEffect, useMemo, useState } from 'react'
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, AlertTriangle, CheckCircle, Clock, Loader2, ArrowRight } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import Modal from './Modal'
import { apiJson } from '../api/client'
import { fetchErpProducts, type ErpProductDto } from '../api/erp'
import { type ServiceRecord } from '../hooks/useServiceRecords'

interface Props {
  isOpen: boolean
  onClose: () => void
  type: 'Repair' | 'Installation'
  categoryFilter?: 'large' | 'small'
}

const statusStyles: Record<string, string> = {
  new: 'bg-blue-50 text-blue-700 border border-blue-200',
  planned: 'bg-purple-50 text-purple-700 border border-purple-200',
  workshop: 'bg-orange-50 text-orange-700 border border-orange-200',
  inrepair: 'bg-amber-50 text-amber-700 border border-amber-200',
  ready: 'bg-green-50 text-green-700 border border-green-200',
  delivered: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
  cancelled: 'bg-red-50 text-red-700 border border-red-200',
  delayed: 'bg-red-50 text-red-700 border border-red-200',
  waitingforparts: 'bg-amber-50 text-amber-700 border border-amber-200',
}

const statusTranslations: Record<string, string> = {
  new: 'Yeni Kayıt',
  planned: 'Planlandı',
  workshop: 'Atölyede',
  inrepair: 'Tamirde',
  ready: 'Hazır',
  delivered: 'Teslim Edildi',
  cancelled: 'İptal',
  delayed: 'Gecikti',
  waitingforparts: 'Parça Bekliyor',
}

const months = [
  'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
  'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'
]

export default function KabulTakvimModal({ isOpen, onClose, type, categoryFilter }: Props) {
  const navigate = useNavigate()
  const [currentYear, setCurrentYear] = useState<number>(new Date().getFullYear())
  const [currentMonth, setCurrentMonth] = useState<number>(new Date().getMonth() + 1) // 1-12
  const [records, setRecords] = useState<ServiceRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [products, setProducts] = useState<ErpProductDto[]>([])
  const [loadingProducts, setLoadingProducts] = useState(false)
  const [selectedDay, setSelectedDay] = useState<number | null>(null)

  // Fetch ERP Products for category filtering
  useEffect(() => {
    if (!isOpen) return
    let active = true
    setLoadingProducts(true)
    fetchErpProducts()
      .then(res => {
        if (active) setProducts(res)
      })
      .catch(err => console.error('fetchErpProducts error:', err))
      .finally(() => {
        if (active) setLoadingProducts(false)
      })
    return () => {
      active = false
    }
  }, [isOpen])

  // Fetch monthly records when year, month or type changes
  useEffect(() => {
    if (!isOpen) return
    let active = true
    const loadData = async () => {
      try {
        setLoading(true)
        const lastDay = new Date(currentYear, currentMonth, 0).getDate()
        const monthStr = currentMonth.toString().padStart(2, '0')
        const dateFrom = `${currentYear}-${monthStr}-01T00:00:00`
        const dateTo = `${currentYear}-${monthStr}-${lastDay.toString().padStart(2, '0')}T23:59:59`

        const params = new URLSearchParams()
        params.set('type', type)
        params.set('dateFrom', dateFrom)
        params.set('dateTo', dateTo)
        params.set('page', '1')
        params.set('pageSize', '2500') // fetch all matching records for the month

        let scopeKey = ''
        if (type === 'Installation') {
          scopeKey = 'montajKabul'
        } else if (categoryFilter === 'large') {
          scopeKey = 'buyukEvAletleriKabul'
        } else if (categoryFilter === 'small') {
          scopeKey = 'kucukUrunKabul'
        }
        if (scopeKey) {
          params.set('scopeKey', scopeKey)
        }
        if (categoryFilter) {
          params.set('category', categoryFilter)
        }

        const data = await apiJson<any>(`/api/servicerecords/paged?${params}`)
        if (active) {
          setRecords(data?.items || [])
          setSelectedDay(null) // reset selected day view
        }
      } catch (err) {
        console.error('Error fetching calendar records:', err)
        if (active) setRecords([])
      } finally {
        if (active) setLoading(false)
      }
    }
    loadData()
    return () => {
      active = false
    }
  }, [isOpen, currentYear, currentMonth, type, categoryFilter])

  // Filter records based on product category if Repair
  const filteredRecords = useMemo(() => {
    return records
  }, [records])

  // Group records by day
  const groupedByDay = useMemo(() => {
    const map: Record<number, ServiceRecord[]> = {}
    for (const r of filteredRecords) {
      const date = new Date(r.createdAt)
      const day = date.getDate()
      if (!map[day]) map[day] = []
      map[day].push(r)
    }
    return map
  }, [filteredRecords])

  const lastDayOfMonth = useMemo(() => {
    return new Date(currentYear, currentMonth, 0).getDate()
  }, [currentYear, currentMonth])

  const startOffset = useMemo(() => {
    const firstDayOfWeek = new Date(currentYear, currentMonth - 1, 1).getDay()
    return firstDayOfWeek === 0 ? 6 : firstDayOfWeek - 1 // monday-indexed
  }, [currentYear, currentMonth])

  const handlePrevMonth = () => {
    if (currentMonth === 1) {
      setCurrentMonth(12)
      setCurrentYear(y => y - 1)
    } else {
      setCurrentMonth(m => m - 1)
    }
  }

  const handleNextMonth = () => {
    if (currentMonth === 12) {
      setCurrentMonth(1)
      setCurrentYear(y => y + 1)
    } else {
      setCurrentMonth(m => m + 1)
    }
  }

  const selectedDayRecords = useMemo(() => {
    if (selectedDay === null) return []
    return groupedByDay[selectedDay] || []
  }, [selectedDay, groupedByDay])

  const categoryTitle = useMemo(() => {
    if (type === 'Installation') return 'Montaj Kabul'
    return categoryFilter === 'large' ? 'Büyük Ev Aletleri' : 'Küçük Ev Aletleri'
  }, [type, categoryFilter])

  const totalMonthCount = filteredRecords.length
  const completedMonthCount = filteredRecords.filter(r => {
    const s = (r.status || '').toLowerCase()
    return s === 'ready' || s === 'delivered'
  }).length
  const pendingMonthCount = totalMonthCount - completedMonthCount

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`${categoryTitle} - Geçmiş Kabul Takvimi`}
      containerClassName="max-w-5xl"
    >
      <div className="space-y-6">
        {/* Month & Year Selection Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-gray-50 p-4 rounded-xl border border-gray-150">
          <div className="flex items-center gap-3">
            <button
              onClick={handlePrevMonth}
              className="p-1.5 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600 transition"
              title="Önceki Ay"
            >
              <ChevronLeft size={18} />
            </button>
            <span className="text-base font-bold text-gray-800 min-w-32 text-center font-sans">
              {months[currentMonth - 1]} {currentYear}
            </span>
            <button
              onClick={handleNextMonth}
              className="p-1.5 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600 transition"
              title="Sonraki Ay"
            >
              <ChevronRight size={18} />
            </button>

            <div className="flex items-center gap-2 ml-4">
              <select
                value={currentMonth}
                onChange={(e) => setCurrentMonth(Number(e.target.value))}
                className="bg-white border border-gray-200 rounded-lg text-xs font-semibold px-2 py-1.5 text-gray-700 focus:outline-none focus:border-red-500"
              >
                {months.map((m, idx) => (
                  <option key={m} value={idx + 1}>{m}</option>
                ))}
              </select>
              <select
                value={currentYear}
                onChange={(e) => setCurrentYear(Number(e.target.value))}
                className="bg-white border border-gray-200 rounded-lg text-xs font-semibold px-2 py-1.5 text-gray-700 focus:outline-none focus:border-red-500"
              >
                {[2024, 2025, 2026, 2027].map(y => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Month Totals Legend */}
          <div className="flex items-center gap-4 text-xs font-semibold">
            <span className="text-gray-500">
              Aylık Özet: <span className="text-gray-900 font-bold">{totalMonthCount} Toplam</span>
            </span>
            <span className="flex items-center gap-1 text-emerald-600">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" /> {completedMonthCount} Tamamlanan
            </span>
            <span className="flex items-center gap-1 text-rose-600">
              <span className="w-2.5 h-2.5 rounded-full bg-rose-500" /> {pendingMonthCount} Bekleyen
            </span>
          </div>
        </div>

        {/* Loading Spinner */}
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 text-gray-400 space-y-2">
            <Loader2 className="w-8 h-8 animate-spin text-red-600" />
            <span className="text-xs font-medium">Veriler yükleniyor...</span>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Calendar Grid */}
            <div className="bg-white border border-gray-150 rounded-xl overflow-hidden shadow-xs">
              {/* Day Labels */}
              <div className="grid grid-cols-7 bg-gray-50 border-b border-gray-150 text-center text-xs font-bold text-gray-500 py-2.5">
                <div>Pzt</div>
                <div>Sal</div>
                <div>Çar</div>
                <div>Per</div>
                <div>Cum</div>
                <div>Cmt</div>
                <div>Paz</div>
              </div>

              {/* Day Boxes */}
              <div className="grid grid-cols-7 gap-1.5 p-2.5 bg-gray-50/30">
                {/* Offsets */}
                {Array.from({ length: startOffset }).map((_, idx) => (
                  <div key={`offset-${idx}`} className="bg-gray-100/50 border border-gray-100 rounded-lg min-h-[84px] opacity-40" />
                ))}

                {/* Month Days */}
                {Array.from({ length: lastDayOfMonth }).map((_, idx) => {
                  const day = idx + 1
                  const dayRecords = groupedByDay[day] || []
                  const total = dayRecords.length
                  const completed = dayRecords.filter(r => {
                    const s = (r.status || '').toLowerCase()
                    return s === 'ready' || s === 'delivered'
                  }).length
                  const pending = total - completed
                  const isSelected = selectedDay === day

                  const isToday =
                    new Date().getDate() === day &&
                    new Date().getMonth() + 1 === currentMonth &&
                    new Date().getFullYear() === currentYear

                  return (
                    <button
                      key={`day-${day}`}
                      onClick={() => total > 0 ? setSelectedDay(isSelected ? null : day) : null}
                      disabled={total === 0}
                      className={`min-h-[84px] p-2 rounded-lg border text-left flex flex-col justify-between transition-all select-none ${
                        total > 0 ? 'cursor-pointer hover:shadow-md hover:border-gray-300' : 'cursor-default opacity-60'
                      } ${
                        isSelected
                          ? 'border-red-500 bg-red-50/30 shadow-inner'
                          : isToday
                          ? 'border-blue-400 bg-blue-50/15'
                          : 'border-gray-200 bg-white'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className={`text-xs font-bold ${isToday ? 'w-5 h-5 flex items-center justify-center bg-blue-600 text-white rounded-full' : 'text-gray-700'}`}>
                          {day}
                        </span>
                        {total > 0 && (
                          <span className="text-[9px] font-bold text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded-md">
                            {total} İş
                          </span>
                        )}
                      </div>

                      {total > 0 ? (
                        <div className="border-t border-gray-100 mt-1 pt-1 space-y-0.5">
                          {completed > 0 && (
                            <div className="text-[9px] font-bold text-emerald-600 flex items-center gap-0.5">
                              ✓ {completed}
                            </div>
                          )}
                          {pending > 0 && (
                            <div className="text-[9px] font-bold text-rose-600 flex items-center gap-0.5">
                              ⏳ {pending}
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="text-[9px] text-gray-300 font-medium italic">Kayıt yok</div>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Selected Day Details Pane */}
            {selectedDay !== null && (
              <div className="border border-red-100 bg-red-50/5 p-5 rounded-2xl space-y-3 animate-fadeIn">
                <div className="flex items-center justify-between border-b border-gray-150 pb-2">
                  <h4 className="text-sm font-bold text-gray-800 flex items-center gap-2">
                    <CalendarIcon size={16} className="text-red-600" />
                    {selectedDay} {months[currentMonth - 1]} {currentYear} Tarihli Kayıtlar ({selectedDayRecords.length} Kayıt)
                  </h4>
                  <button
                    onClick={() => setSelectedDay(null)}
                    className="text-xs text-gray-500 hover:text-gray-800 font-semibold"
                  >
                    Kapat
                  </button>
                </div>

                <div className="max-h-[300px] overflow-y-auto space-y-2 pr-1">
                  {selectedDayRecords.map(r => {
                    const statusClass = statusStyles[(r.status || '').toLowerCase()] || 'bg-gray-100 text-gray-700 border-gray-200'
                    const statusText = statusTranslations[(r.status || '').toLowerCase()] || r.statusLabel || r.status || ''

                    return (
                      <div
                        key={r.id}
                        className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-white border border-gray-150 rounded-xl p-3.5 hover:border-gray-300 transition-colors shadow-2xs"
                      >
                        <div className="space-y-1.5 animate-fadeIn">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-mono text-xs font-bold text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded">
                              {r.serviceNumber || '—'}
                            </span>
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${statusClass}`}>
                              {statusText}
                            </span>
                            <span className="text-[11px] font-medium text-gray-400">
                              {new Date(r.createdAt).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                          <div className="text-xs text-gray-800">
                            <span className="font-bold">{r.customerName || 'Bilinmeyen Müşteri'}</span>
                            <span className="text-gray-400 mx-1.5">•</span>
                            <span className="font-semibold text-gray-600">{r.productName || 'Bilinmeyen Ürün'}</span>
                          </div>
                        </div>

                        <button
                          onClick={() => {
                            onClose()
                            navigate(
                              r.type === 'Installation'
                                ? `/montaj-yonetimi?id=${r.id}`
                                : categoryFilter === 'large'
                                ? `/saha-ariza-planlama?id=${r.id}`
                                : `/urun-ariza-planlama?id=${r.id}`
                            )
                          }}
                          className="self-end sm:self-center flex items-center gap-1.5 text-xs font-bold text-red-600 hover:text-red-700 transition"
                        >
                          Detay <ArrowRight size={14} />
                        </button>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}
