import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight } from 'lucide-react'

type Props = {
  value?: string
  value2?: string
  isRange?: boolean
  onChange: (val1: string, val2?: string) => void
}

const MONTH_NAMES = [
  'Ocak',
  'Şubat',
  'Mart',
  'Nisan',
  'Mayıs',
  'Haziran',
  'Temmuz',
  'Ağustos',
  'Eylül',
  'Ekim',
  'Kasım',
  'Aralık'
]

const DAY_NAMES = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz']

function parseTurkishDate(str: string | undefined): Date | null {
  if (!str) return null
  const s = str.trim()
  const parts = s.split('.')
  if (parts.length === 3) {
    const d = parseInt(parts[0], 10)
    const m = parseInt(parts[1], 10) - 1
    const y = parseInt(parts[2], 10)
    if (!isNaN(d) && !isNaN(m) && !isNaN(y)) {
      return new Date(y, m, d)
    }
  }
  const iso = new Date(s)
  if (!isNaN(iso.getTime())) return iso
  return null
}

function formatDateDisplay(d: Date | null): string {
  if (!d) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`
}

function isSameDay(d1: Date | null, d2: Date | null): boolean {
  if (!d1 || !d2) return false
  return (
    d1.getDate() === d2.getDate() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getFullYear() === d2.getFullYear()
  )
}

export function CalendarPickerPopup({ value = '', value2 = '', isRange = false, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  const initialStart = parseTurkishDate(value) || new Date()
  const initialEnd = parseTurkishDate(value2) || (isRange ? initialStart : null)

  const [rangeStart, setRangeStart] = useState<Date | null>(initialStart)
  const [rangeEnd, setRangeEnd] = useState<Date | null>(initialEnd)
  const [selectingStep, setSelectingStep] = useState<'start' | 'end'>('start')

  const [viewYear, setViewYear] = useState(initialStart.getFullYear())
  const [viewMonth, setViewMonth] = useState(initialStart.getMonth())

  const syncPos = () => {
    if (!buttonRef.current) return
    const r = buttonRef.current.getBoundingClientRect()
    const left = Math.max(8, Math.min(r.left - 200, window.innerWidth - 280))
    setPos({ top: r.bottom + 4, left })
  }

  useEffect(() => {
    if (!open) return
    const dStart = parseTurkishDate(value) || new Date()
    const dEnd = parseTurkishDate(value2) || (isRange ? dStart : null)

    setRangeStart(dStart)
    setRangeEnd(dEnd)
    setSelectingStep('start')
    setViewYear(dStart.getFullYear())
    setViewMonth(dStart.getMonth())
    syncPos()

    const onDocClick = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node
      if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) return
      setOpen(false)
    }

    const onScroll = () => syncPos()
    const onResize = () => syncPos()

    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', onDocClick)
      document.addEventListener('touchstart', onDocClick)
    }, 0)

    return () => {
      clearTimeout(timer)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onResize)
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('touchstart', onDocClick)
    }
  }, [open, value, value2, isRange])

  const prevMonth = () => {
    if (viewMonth === 0) {
      setViewMonth(11)
      setViewYear((y) => y - 1)
    } else {
      setViewMonth((m) => m - 1)
    }
  }

  const nextMonth = () => {
    if (viewMonth === 11) {
      setViewMonth(0)
      setViewYear((y) => y + 1)
    } else {
      setViewMonth((m) => m + 1)
    }
  }

  // Days matrix for grid
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate()
  const firstDayIndex = (new Date(viewYear, viewMonth, 1).getDay() + 6) % 7 // Monday = 0
  const prevMonthDays = new Date(viewYear, viewMonth, 0).getDate()

  const days: Array<{ day: number; isCurrentMonth: boolean; dateObj: Date }> = []

  // Fill previous month days
  for (let i = firstDayIndex - 1; i >= 0; i--) {
    const pDay = prevMonthDays - i
    const dObj = new Date(viewYear, viewMonth - 1, pDay)
    days.push({ day: pDay, isCurrentMonth: false, dateObj: dObj })
  }

  // Fill current month days
  for (let i = 1; i <= daysInMonth; i++) {
    const dObj = new Date(viewYear, viewMonth, i)
    days.push({ day: i, isCurrentMonth: true, dateObj: dObj })
  }

  // Fill next month trailing days
  const remaining = 42 - days.length
  for (let i = 1; i <= remaining; i++) {
    const dObj = new Date(viewYear, viewMonth + 1, i)
    days.push({ day: i, isCurrentMonth: false, dateObj: dObj })
  }

  const handleSelectDay = (dObj: Date) => {
    if (!isRange) {
      setRangeStart(dObj)
      setRangeEnd(null)
      return
    }

    // Range selection mode
    if (selectingStep === 'start' || !rangeStart || (rangeStart && rangeEnd)) {
      setRangeStart(dObj)
      setRangeEnd(null)
      setSelectingStep('end')
    } else {
      // Step === 'end'
      if (dObj.getTime() < rangeStart.getTime()) {
        setRangeStart(dObj)
        setRangeEnd(null)
        setSelectingStep('end')
      } else {
        setRangeEnd(dObj)
      }
    }
  }

  const handleApply = () => {
    if (!rangeStart) {
      setOpen(false)
      return
    }
    const sStr = formatDateDisplay(rangeStart)
    const eStr = formatDateDisplay(rangeEnd || rangeStart)
    onChange(sStr, eStr)
    setOpen(false)
  }

  const handleCancel = () => {
    setOpen(false)
  }

  const handleClear = () => {
    setRangeStart(null)
    setRangeEnd(null)
    onChange('', '')
    setOpen(false)
  }

  const previewText = () => {
    if (!rangeStart) return 'Tarih seçilmedi'
    if (!isRange || !rangeEnd || isSameDay(rangeStart, rangeEnd)) {
      return formatDateDisplay(rangeStart)
    }
    return `${formatDateDisplay(rangeStart)} - ${formatDateDisplay(rangeEnd)}`
  }

  return (
    <div className="relative inline-flex shrink-0">
      <button
        ref={buttonRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          syncPos()
          setOpen((v) => !v)
        }}
        className={`p-1 rounded transition-colors cursor-pointer ${
          open || (value && value2) ? 'text-red-600 bg-red-50' : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100'
        }`}
        title={isRange ? 'Tarih Aralığı Seç' : 'Tarih Seç'}
      >
        <CalendarIcon size={14} />
      </button>

      {open &&
        pos &&
        createPortal(
          <div
            ref={menuRef}
            style={{ position: 'fixed', top: pos.top, left: pos.left }}
            className="z-[9999] w-64 bg-white border border-slate-200 rounded-xl shadow-2xl p-3 text-xs font-sans overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header: Month / Year with Navigation */}
            <div className="flex items-center justify-between mb-2 px-1">
              <button
                type="button"
                onClick={prevMonth}
                className="p-1 rounded-full hover:bg-slate-100 text-red-650 cursor-pointer"
              >
                <ChevronLeft size={16} />
              </button>
              <div className="font-semibold text-red-650 text-sm">
                {MONTH_NAMES[viewMonth]} {viewYear}
              </div>
              <button
                type="button"
                onClick={nextMonth}
                className="p-1 rounded-full hover:bg-slate-100 text-red-650 cursor-pointer"
              >
                <ChevronRight size={16} />
              </button>
            </div>

            {/* Range Instruction Preview Hint */}
            <div className="text-[11px] text-red-700 text-center mb-2 bg-red-50 py-1 px-2 rounded border border-red-100 font-semibold truncate">
              Önizleme: {previewText()}
            </div>

            {/* Weekday Names Header */}
            <div className="grid grid-cols-7 text-center font-medium text-slate-500 mb-1 text-[11px]">
              {DAY_NAMES.map((name) => (
                <div key={name} className="py-1">
                  {name}
                </div>
              ))}
            </div>

            {/* Days Grid */}
            <div className="grid grid-cols-7 text-center gap-y-1 mb-3">
              {days.map((item, idx) => {
                const isStart = isSameDay(item.dateObj, rangeStart)
                const isEnd = isSameDay(item.dateObj, rangeEnd)
                const inRange =
                  Boolean(rangeStart && rangeEnd) &&
                  item.dateObj.getTime() > rangeStart!.getTime() &&
                  item.dateObj.getTime() < rangeEnd!.getTime()

                let styleClass = 'text-slate-700 hover:bg-slate-100 font-medium'
                if (!item.isCurrentMonth) {
                  styleClass = 'text-slate-300 hover:bg-slate-50'
                }

                if (isStart && isEnd) {
                  styleClass = 'bg-[#B91C1C] text-white font-bold rounded-full shadow-md'
                } else if (isStart) {
                  styleClass = 'bg-[#B91C1C] text-white font-bold rounded-l-full shadow-md'
                } else if (isEnd) {
                  styleClass = 'bg-[#B91C1C] text-white font-bold rounded-r-full shadow-md'
                } else if (inRange) {
                  styleClass = 'bg-red-50 text-red-950 font-semibold rounded-none'
                }

                return (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => handleSelectDay(item.dateObj)}
                    className={`h-7 w-full flex items-center justify-center text-[11px] transition-colors cursor-pointer ${styleClass}`}
                  >
                    {item.day}
                  </button>
                )
              })}
            </div>

            {/* Action Footer Buttons (TAMAM / İPTAL / TEMİZLE) */}
            <div className="border-t border-slate-100 pt-2 flex items-center justify-between">
              <button
                type="button"
                onClick={handleClear}
                className="text-[11px] text-rose-600 hover:text-rose-700 font-medium cursor-pointer"
              >
                Temizle
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCancel}
                  className="px-2.5 py-1 text-[11px] font-semibold text-slate-500 hover:bg-slate-100 rounded transition-colors uppercase cursor-pointer"
                >
                  İPTAL
                </button>
                <button
                  type="button"
                  onClick={handleApply}
                  className="px-3 py-1 text-[11px] font-semibold bg-[#B91C1C] hover:bg-[#991B1B] text-white rounded transition-colors uppercase shadow-sm cursor-pointer"
                >
                  TAMAM
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  )
}
