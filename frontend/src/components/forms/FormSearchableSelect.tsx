import React, { useState, useEffect, useRef, useMemo } from 'react'
import { ChevronDown, Search, X, Check } from 'lucide-react'

export type FormSearchableSelectOption = {
  value: string
  label: string
  disabled?: boolean
}

type Props = {
  label?: string
  requiredMark?: boolean
  value: any
  onChange: (e: any) => void
  options: FormSearchableSelectOption[]
  placeholder?: string
  disabled?: boolean
  className?: string
}

export default function FormSearchableSelect({
  label,
  requiredMark,
  value,
  onChange,
  options,
  placeholder = 'Seçiniz...',
  disabled = false,
  className = ''
}: Props) {
  const [isOpen, setIsOpen] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  const normalizedValue = useMemo(() => {
    if (value === null || value === undefined) return ''
    if (typeof value === 'object' && value !== null && 'target' in (value as any)) {
      return String((value as any).target?.value ?? '')
    }
    return String(value)
  }, [value])

  const selectedOption = useMemo(() => {
    return options.find((o) => String(o.value) === normalizedValue)
  }, [options, normalizedValue])

  const filteredOptions = useMemo(() => {
    if (!searchTerm.trim()) return options
    const term = searchTerm.toLocaleLowerCase('tr-TR')
    return options.filter(
      (o) =>
        o.label.toLocaleLowerCase('tr-TR').includes(term) ||
        String(o.value).toLocaleLowerCase('tr-TR').includes(term)
    )
  }, [options, searchTerm])

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        searchInputRef.current?.focus()
      }, 50)
    } else {
      setSearchTerm('')
    }
  }, [isOpen])

  const handleSelect = (optionValue: string, optionDisabled?: boolean) => {
    if (optionDisabled) return
    const val = String(optionValue)
    const eventObj = {
      target: { value: val },
      currentTarget: { value: val },
      value: val
    }
    onChange(eventObj as any)
    setIsOpen(false)
    setSearchTerm('')
  }

  return (
    <div className={`space-y-1.5 ${className}`}>
      {label && (
        <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide">
          {label} {requiredMark && <span className="text-red-500">*</span>}
        </label>
      )}

      <div ref={containerRef} className="relative w-full">
        {/* Trigger Input/Button */}
        <div
          onClick={() => !disabled && setIsOpen(!isOpen)}
          className={`input-base h-[38px] w-full px-3 bg-white border border-gray-300 rounded-lg shadow-xs flex items-center justify-between text-xs text-gray-900 cursor-pointer transition-all ${
            disabled
              ? 'opacity-50 cursor-not-allowed bg-gray-50 border-gray-200'
              : isOpen
                ? 'border-emerald-500 ring-2 ring-emerald-500/20'
                : 'hover:border-gray-400'
          }`}
        >
          <span className="truncate font-medium">
            {selectedOption ? (
              selectedOption.label
            ) : (
              <span className="text-gray-400">{placeholder}</span>
            )}
          </span>
          <ChevronDown
            size={16}
            className={`text-gray-400 shrink-0 ml-1.5 transition-transform duration-200 ${
              isOpen ? 'rotate-180 text-emerald-600' : ''
            }`}
          />
        </div>

        {/* Dropdown Menu with Search Bar */}
        {isOpen && !disabled && (
          <div className="absolute z-50 mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-xl max-h-72 overflow-hidden flex flex-col animate-in fade-in-50 duration-100">
            {/* Sticky Search Bar */}
            <div className="p-2 border-b border-gray-100 bg-gray-50/80 backdrop-blur-xs flex items-center gap-1.5">
              <Search size={14} className="text-gray-400 shrink-0 ml-1" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Ara (İsim, Kod)..."
                className="w-full h-8 text-xs bg-transparent border-0 focus:outline-none text-gray-900 placeholder-gray-400"
                onClick={(e) => e.stopPropagation()}
              />
              {searchTerm && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    setSearchTerm('')
                    searchInputRef.current?.focus()
                  }}
                  className="p-1 hover:bg-gray-200 rounded-full text-gray-400 hover:text-gray-600"
                >
                  <X size={12} />
                </button>
              )}
            </div>

            {/* Options List */}
            <div className="overflow-y-auto max-h-56 divide-y divide-gray-50 p-1">
              {filteredOptions.length === 0 ? (
                <div className="p-3 text-xs text-gray-400 text-center font-medium">
                  Sonuç bulunamadı
                </div>
              ) : (
                filteredOptions.map((opt, idx) => {
                  const isSelected = String(opt.value) === normalizedValue
                  return (
                    <div
                      key={`${opt.value}__${idx}`}
                      onClick={() => handleSelect(opt.value, opt.disabled)}
                      className={`px-3 py-2 text-xs rounded-lg cursor-pointer flex items-center justify-between transition-colors ${
                        opt.disabled
                          ? 'opacity-40 cursor-not-allowed bg-gray-50 text-gray-400'
                          : isSelected
                            ? 'bg-emerald-50 text-emerald-800 font-bold'
                            : 'text-gray-700 hover:bg-emerald-50/60 hover:text-emerald-900'
                      }`}
                    >
                      <span className="truncate">{opt.label}</span>
                      {isSelected && (
                        <Check size={14} className="text-emerald-600 shrink-0 ml-2" />
                      )}
                    </div>
                  )
                })
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
