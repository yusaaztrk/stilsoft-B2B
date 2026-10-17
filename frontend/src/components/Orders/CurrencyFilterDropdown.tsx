import React, { useState, useRef, useEffect } from 'react'
import { ChevronDown, Check } from 'lucide-react'

export type CurrencyCode = 'TRY' | 'EUR' | 'USD' | 'GBP'
export type CurrencyOption = 'ALL' | CurrencyCode

interface CurrencyFilterDropdownProps {
  selected: CurrencyCode[]
  onChange: (selected: CurrencyCode[]) => void
  className?: string
}

export const CURRENCY_OPTIONS: Array<{ value: CurrencyOption; label: string; symbol: string }> = [
  { value: 'ALL', label: 'Tümü', symbol: '🌐' },
  { value: 'TRY', label: '₺ TL', symbol: '₺' },
  { value: 'EUR', label: '€ EUR', symbol: '€' },
  { value: 'USD', label: '$ USD', symbol: '$' },
  { value: 'GBP', label: '£ GBP', symbol: '£' },
]

export default function CurrencyFilterDropdown({ selected, onChange, className = '' }: CurrencyFilterDropdownProps) {
  const [open, setOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [open])

  const toggleOption = (val: CurrencyOption) => {
    if (val === 'ALL') {
      onChange([])
      return
    }
    if (selected.includes(val)) {
      const next = selected.filter((x) => x !== val)
      onChange(next)
    } else {
      onChange([...selected, val])
    }
  }

  const isChecked = (val: CurrencyOption) => {
    if (val === 'ALL') return selected.length === 0
    return selected.includes(val)
  }

  // Label text for button
  const buttonLabel = () => {
    if (selected.length === 0) return 'Tümü'
    if (selected.length === 1) {
      const opt = CURRENCY_OPTIONS.find((o) => o.value === selected[0])
      return opt ? opt.label : selected[0]
    }
    return `${selected.join(', ')} (${selected.length})`
  }

  const isActive = selected.length > 0

  return (
    <div className={`relative inline-block text-left ${className}`} ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className={
          'h-8 px-2.5 rounded-lg border text-[11px] font-bold flex items-center justify-between gap-1.5 transition select-none ' +
          (className.includes('w-full') ? 'w-full ' : '') +
          (isActive
            ? 'border-[#D84315] text-[#D84315] bg-orange-50 ring-1 ring-orange-200'
            : 'border-slate-200 text-slate-700 bg-white hover:bg-slate-50')
        }
      >
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-slate-500 font-semibold">Kur:</span>
          <span className="font-bold">{buttonLabel()}</span>
        </div>
        <ChevronDown size={13} className={`transition-transform duration-150 text-slate-400 ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute left-0 mt-1.5 w-48 rounded-xl bg-white shadow-xl border border-slate-200 py-1.5 z-50">
          <div className="px-3 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider border-b border-slate-100 mb-1">
            Para Birimi Seçimi
          </div>
          {CURRENCY_OPTIONS.map((opt) => {
            const checked = isChecked(opt.value)
            return (
              <label
                key={opt.value}
                className={
                  'flex items-center justify-between px-3 py-1.5 mx-1 rounded-lg text-xs font-semibold cursor-pointer select-none transition ' +
                  (checked ? 'bg-orange-50 text-[#D84315]' : 'text-slate-700 hover:bg-slate-50')
                }
              >
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleOption(opt.value)}
                    className="w-3.5 h-3.5 rounded text-[#D84315] accent-[#D84315] cursor-pointer"
                  />
                  <span>{opt.label}</span>
                </div>
                {checked && <Check size={13} className="text-[#D84315]" />}
              </label>
            )
          })}
        </div>
      )}
    </div>
  )
}
