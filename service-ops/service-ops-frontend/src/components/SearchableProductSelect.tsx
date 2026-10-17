import React, { useState, useRef, useEffect } from 'react'
import { Search, ChevronDown, Check, X } from 'lucide-react'

export interface ProductOption {
  id?: string
  name: string
  code?: string
}

interface SearchableProductSelectProps {
  products: ProductOption[]
  value: string
  onChange: (val: string) => void
  placeholder?: string
  disabled?: boolean
  className?: string
}

export const SearchableProductSelect: React.FC<SearchableProductSelectProps> = ({
  products,
  value,
  onChange,
  placeholder = 'Ürün Seçin veya Ara...',
  disabled = false,
  className = ''
}) => {
  const [isOpen, setIsOpen] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const selectedProduct = products.find(p => p.name === value || (p.code && p.code === value))

  const filteredProducts = products.filter(p =>
    (p.name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
    (p.code || '').toLowerCase().includes(searchTerm.toLowerCase())
  )

  return (
    <div className={`relative ${className}`} ref={dropdownRef}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm font-medium text-left flex items-center justify-between shadow-xs hover:border-gray-300 focus:outline-none focus:ring-2 focus:ring-orange-500/20 disabled:opacity-50 transition-colors"
      >
        <span className={selectedProduct || value ? 'text-gray-900 font-semibold truncate' : 'text-gray-400'}>
          {selectedProduct ? selectedProduct.name : (value || placeholder)}
        </span>
        <ChevronDown className="w-4 h-4 text-gray-400 shrink-0 ml-1" />
      </button>

      {isOpen && (
        <div className="absolute z-[99] mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-xl overflow-hidden animate-in fade-in duration-100 left-0 right-0">
          <div className="p-2 border-b border-gray-100 bg-slate-50 flex items-center gap-2">
            <Search className="w-4 h-4 text-gray-400 shrink-0 ml-1" />
            <input
              type="text"
              autoFocus
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Ürün adı veya kod yazın..."
              className="w-full bg-transparent text-xs outline-none py-1 text-gray-900 font-medium"
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => setSearchTerm('')}
                className="text-gray-400 hover:text-gray-600 p-0.5"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="max-h-60 overflow-y-auto p-1 text-xs divide-y divide-gray-50">
            <button
              type="button"
              onClick={() => {
                onChange('')
                setIsOpen(false)
                setSearchTerm('')
              }}
              className="w-full text-left px-3 py-1.5 rounded-lg text-gray-400 italic hover:bg-gray-50"
            >
              Seçiniz...
            </button>
            {filteredProducts.length === 0 ? (
              <div className="py-3 px-3 text-center text-gray-400 text-xs">Aranan ürün bulunamadı.</div>
            ) : (
              filteredProducts.map((p, idx) => {
                const isSelected = p.name === value || p.code === value
                return (
                  <button
                    key={p.id || p.code || idx}
                    type="button"
                    onClick={() => {
                      onChange(p.name)
                      setIsOpen(false)
                      setSearchTerm('')
                    }}
                    className={`w-full text-left px-3 py-2 rounded-lg flex items-center justify-between transition-colors ${
                      isSelected ? 'bg-orange-50 text-orange-950 font-bold' : 'hover:bg-gray-50 text-gray-800'
                    }`}
                  >
                    <div>
                      <div className="font-semibold">{p.name}</div>
                      {p.code && <div className="text-[10px] text-gray-400 font-mono">{p.code}</div>}
                    </div>
                    {isSelected && <Check className="w-4 h-4 text-orange-600 shrink-0" />}
                  </button>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default SearchableProductSelect
