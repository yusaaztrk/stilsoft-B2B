import React, { useState, useMemo, useEffect, useRef } from 'react'
import { Search, ChevronDown, Package, X, Check } from 'lucide-react'

export type ProductOption = {
  id: string
  stockCode: string
  name: string
}

interface SearchableProductSelectProps {
  value: string
  onChange: (value: string, product?: ProductOption) => void
  options: ProductOption[]
  placeholder?: string
  disabled?: boolean
  className?: string
}

export default function SearchableProductSelect({
  value,
  onChange,
  options,
  placeholder = 'Ürün Ara (Stok Kodu veya Adı)...',
  disabled = false,
  className = ''
}: SearchableProductSelectProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const selectedOption = useMemo(() => {
    return options.find((o) => o.id === value || o.stockCode === value)
  }, [options, value])

  const filteredOptions = useMemo(() => {
    if (!searchTerm.trim()) return options.slice(0, 100)

    const q = searchTerm.trim().toLowerCase()
    return options
      .filter((o) => {
        const name = (o.name || '').toLowerCase()
        const code = (o.stockCode || '').toLowerCase()
        return name.includes(q) || code.includes(q)
      })
      .slice(0, 100)
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
    if (isOpen && inputRef.current) {
      inputRef.current.focus()
    }
  }, [isOpen])

  return (
    <div ref={containerRef} className={`relative w-full ${className}`}>
      {/* Selected Box */}
      <div
        onClick={() => !disabled && setIsOpen(!isOpen)}
        className={`w-full h-9 px-2.5 bg-white border border-gray-300 rounded-lg shadow-xs flex items-center justify-between text-xs text-gray-900 cursor-pointer transition-all ${
          disabled
            ? 'opacity-50 cursor-not-allowed bg-gray-50'
            : isOpen
            ? 'border-blue-600 ring-2 ring-blue-500/20'
            : 'hover:border-gray-400'
        }`}
      >
        <div className="flex items-center gap-1.5 truncate pr-2">
          <Package className="w-3.5 h-3.5 text-gray-400 shrink-0" />
          <span className="truncate font-semibold text-gray-900">
            {selectedOption ? (
              <span className="flex items-center gap-1.5">
                <span className="text-[11px] text-blue-700 bg-blue-50 px-1 py-0.2 rounded font-mono border border-blue-200">
                  {selectedOption.stockCode}
                </span>
                <span className="text-gray-900 font-medium truncate">{selectedOption.name}</span>
              </span>
            ) : (
              <span className="text-gray-400 font-normal">{placeholder}</span>
            )}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {selectedOption && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onChange('')
              }}
              className="p-0.5 hover:bg-gray-100 rounded text-gray-400 hover:text-gray-600"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
          <ChevronDown className={`w-3.5 h-3.5 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </div>
      </div>

      {/* Popover Dropdown */}
      {isOpen && !disabled && (
        <div className="absolute left-0 top-full z-50 mt-1 w-full min-w-[320px] max-w-[500px] bg-white border border-gray-200 rounded-xl shadow-2xl overflow-hidden flex flex-col animate-in fade-in duration-150">
          {/* Search Bar Input */}
          <div className="p-2 border-b border-gray-100 bg-white relative">
            <Search className="w-4 h-4 text-gray-400 absolute left-4 top-1/2 -translate-y-1/2" />
            <input
              ref={inputRef}
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Ürün adı veya stok kodu ara..."
              className="w-full h-8 pl-8 pr-7 text-xs bg-slate-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 uppercase font-medium"
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => setSearchTerm('')}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Results Counter */}
          <div className="px-3 py-1 bg-gray-50 border-b border-gray-100 text-[10px] text-gray-500 flex justify-between items-center font-medium">
            <span>Listelenen Ürünler: <strong className="text-slate-800">{filteredOptions.length}</strong></span>
            {searchTerm && <span>Arama: "{searchTerm}"</span>}
          </div>

          {/* Options List */}
          <div className="overflow-y-auto max-h-60 divide-y divide-gray-100 custom-scrollbar">
            {filteredOptions.length === 0 ? (
              <div className="p-4 text-center text-xs text-gray-400 font-medium">
                Aradığınız kriterlere uygun ürün bulunamadı.
              </div>
            ) : (
              filteredOptions.map((opt) => {
                const isSelected = opt.id === value || opt.stockCode === value

                return (
                  <div
                    key={opt.id}
                    onClick={() => {
                      onChange(opt.id, opt)
                      setIsOpen(false)
                      setSearchTerm('')
                    }}
                    className={`px-3 py-2 text-xs cursor-pointer transition-colors flex items-center justify-between ${
                      isSelected
                        ? 'bg-blue-50/80 text-blue-900 font-semibold'
                        : 'hover:bg-slate-50 text-gray-800'
                    }`}
                  >
                    <div className="flex flex-col gap-0.5 min-w-0 pr-2">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[10px] font-mono font-bold text-blue-700 bg-blue-50 px-1 py-0.2 rounded border border-blue-200">
                          {opt.stockCode}
                        </span>
                        <span className="font-semibold text-gray-900 truncate">{opt.name}</span>
                      </div>
                    </div>
                    {isSelected && <Check className="w-4 h-4 text-blue-600 shrink-0" />}
                  </div>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}
