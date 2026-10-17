import React, { useState, useMemo, useEffect, useRef } from 'react'
import { Search, ChevronDown, User, Phone, Tag, X, Check } from 'lucide-react'

export type CariOption = {
  value: string // customerCode or supplierCode
  label: string // display name e.g. "(120-03-000008) BİLAL ÖZTÜRK"
  code?: string
  name?: string
  phone?: string
  type?: string // 'customer' | 'supplier' | 'expense' | 'dealer' etc.
  customerType?: string // e.g. '120-01', '120-03', 'Bayi', 'Müşteri', etc.
}

interface SearchableCariSelectProps {
  value: string
  onChange: (value: string) => void
  options: CariOption[]
  placeholder?: string
  disabled?: boolean
  accountType?: string
  onAccountTypeChange?: (accountType: string) => void
  showTypeFilter?: boolean
  /**
   * SUNUCU ARAMASI (istege bagli).
   *
   * Verilmezse bilesen eskisi gibi calisir: `options` icindeki TUM kayitlar tarayicida
   * suzulur. Binlerce cariyi olan firmalarda o liste indirilene kadar kutu tiklanamiyordu.
   *
   * Verilirse `options` yalnizca SECILI kaydin etiketini cozmek icin kullanilir; listelenen
   * kayitlar her aramada sunucudan gelir (yazma durunca, gecikmeli). Tur pastilleri secilen
   * turu ikinci arguman olarak buraya iletir; sorguyu nasil kuracagina cagiran karar verir.
   */
  remoteSearch?: (query: string, accountTypeKey: string) => Promise<CariOption[]>
  /** `remoteSearch` bir aramada en fazla kac satir donuyor. Liste dolduysa uyari gosterilir. */
  remoteLimit?: number
}

export const ACCOUNT_TYPES = [
  { key: 'all', label: 'Tümü' },
  { key: 'customer', label: 'Müşteri (120-03)', prefix: '120-03' },
  { key: 'dealer', label: 'Bayi (120-01)', prefix: '120-01' },
  { key: 'sub_dealer', label: 'Alt Bayi (120-02)', prefix: '120-02' },
  { key: 'store', label: 'Şube / Mağaza (120-04)', prefix: '120-04' },
  { key: 'employee', label: 'Çalışan (120-05)', prefix: '120-05' },
  { key: 'retail', label: 'Parekende (120-06)', prefix: '120-06' },
  { key: 'service', label: 'Hizmet (120-07)', prefix: '120-07' },
  { key: 'supplier', label: 'Tedarikçi (320)', prefix: '320' },
  { key: 'expense', label: 'Gider', prefix: '600' }
]

export function normalizeTurkishForSearch(str: string): string {
  return String(str ?? '')
    .replace(/İ/g, 'i')
    .replace(/I/g, 'i')
    .replace(/ı/g, 'i')
    .replace(/Ö/g, 'o')
    .replace(/ö/g, 'o')
    .replace(/Ü/g, 'u')
    .replace(/ü/g, 'u')
    .replace(/Ş/g, 's')
    .replace(/ş/g, 's')
    .replace(/Ç/g, 'c')
    .replace(/ç/g, 'c')
    .replace(/Ğ/g, 'g')
    .replace(/ğ/g, 'g')
    .toLowerCase()
    .trim()
}

const MAX_VISIBLE_OPTIONS = 100

export default function SearchableCariSelect({
  value,
  onChange,
  options,
  placeholder = 'Cari Kodu, Adı veya Telefon Ara...',
  disabled = false,
  accountType = 'all',
  onAccountTypeChange,
  showTypeFilter = true,
  remoteSearch,
  remoteLimit
}: SearchableCariSelectProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedType, setSelectedType] = useState(accountType)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const [remoteOptions, setRemoteOptions] = useState<CariOption[]>([])
  const [remoteLoading, setRemoteLoading] = useState(false)
  // Gec donen eski istegin yeni sonucun uzerine yazmasini engeller: kullanici hizli yazinca
  // istekler sirasiz tamamlanabiliyor ve liste bir onceki harfin sonucunda kaliyordu.
  const remoteSeqRef = useRef(0)

  useEffect(() => {
    setSelectedType(accountType)
  }, [accountType])

  /**
   * Sunucu aramasi: yazma durduktan 300 ms sonra tek istek. Kutu ilk acildiginda da bir kez
   * (bos sorguyla) calisir ki kullanici hicbir sey yazmadan da liste gorsun.
   */
  useEffect(() => {
    if (!remoteSearch || !isOpen) return
    let cancelled = false
    const seq = ++remoteSeqRef.current
    setRemoteLoading(true)
    const t = setTimeout(() => {
      void (async () => {
        try {
          const list = await remoteSearch(searchTerm.trim(), selectedType)
          if (cancelled || seq !== remoteSeqRef.current) return
          setRemoteOptions(list ?? [])
        } catch {
          if (cancelled || seq !== remoteSeqRef.current) return
          setRemoteOptions([])
        } finally {
          if (!cancelled && seq === remoteSeqRef.current) setRemoteLoading(false)
        }
      })()
    }, searchTerm.trim() ? 300 : 0)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [remoteSearch, isOpen, searchTerm, selectedType])

  const selectedOption = useMemo(() => {
    // Secili kaydin etiketi HER ZAMAN `options`tan cozulur: sunucu aramasinda liste her
    // yazista degisiyor ve secili kayit sonuclarin disinda kalabilir; yalnizca sonuclara
    // baksaydik kutudaki isim aniden kaybolurdu.
    return options.find((o) => o.value === value) ?? remoteOptions.find((o) => o.value === value)
  }, [options, remoteOptions, value])

  const filteredOptions = useMemo(() => {
    // Sunucu aramasinda suzme is bolumu: metin sunucuda, tur pastili yine burada.
    // Sunucu turu de biliyor (ikinci arguman) ama kod onekiyle esleme kurallari
    // (gider = 600 VE 770 gibi) istemcide tanimli; iki kez suzmek zarar vermez.
    // Kutu ilk acildiginda sunucu cevabi henuz gelmemis olabilir; o ana kadar cagiranin
    // verdigi `options` gosterilir (acilista yapilan ilk aramanin sonucu). ARAMA YAZILDIYSA
    // bu yedege DUSULMEZ: sonuc bossa "bulunamadi" denmeli, eski liste degil.
    let list = remoteSearch
      ? (searchTerm.trim() || remoteOptions.length > 0 ? remoteOptions : options)
      : options

    // Filter by selected type if not 'all'
    if (selectedType && selectedType !== 'all') {
      const typeInfo = ACCOUNT_TYPES.find((t) => t.key === selectedType)
      if (typeInfo?.prefix) {
        list = list.filter((o) => {
          const code = o.code || o.value || ''
          return code.startsWith(typeInfo.prefix!) || (o.customerType && o.customerType.includes(typeInfo.prefix!))
        })
      } else if (selectedType === 'supplier') {
        list = list.filter((o) => o.type === 'supplier' || (o.code && o.code.startsWith('320')))
      } else if (selectedType === 'expense') {
        list = list.filter((o) => o.type === 'expense' || (o.code && (o.code.startsWith('600') || o.code.startsWith('770'))))
      }
    }

    // Filter by search query (name, code, or phone)
    if (remoteSearch) return list
    if (!searchTerm.trim()) return list

    const rawQ = searchTerm.trim().toLowerCase()
    const normQ = normalizeTurkishForSearch(searchTerm)
    const cleanQDigits = searchTerm.replace(/\D/g, '')

    return list.filter((o) => {
      const rawName = (o.name || o.label || '').toLowerCase()
      const normName = normalizeTurkishForSearch(o.name || o.label || '')

      const rawCode = (o.code || o.value || '').toLowerCase()
      const normCode = normalizeTurkishForSearch(o.code || o.value || '')

      const rawPhone = (o.phone || '').toLowerCase()
      const phoneDigits = (o.phone || '').replace(/\D/g, '')

      const matchesName = rawName.includes(rawQ) || normName.includes(normQ)
      const matchesCode = rawCode.includes(rawQ) || normCode.includes(normQ)
      const matchesPhoneRaw = rawPhone.length > 0 && (rawPhone.includes(rawQ) || rawPhone.includes(normQ))
      const matchesPhoneDigits = cleanQDigits.length >= 3 && phoneDigits.includes(cleanQDigits)

      return matchesName || matchesCode || matchesPhoneRaw || matchesPhoneDigits
    })
  }, [options, remoteOptions, remoteSearch, selectedType, searchTerm])

  const visibleOptions = useMemo(() => filteredOptions.slice(0, MAX_VISIBLE_OPTIONS), [filteredOptions])

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
    <div ref={containerRef} className="relative w-full">
      {/* Selected Box */}
      <div
        onClick={() => !disabled && setIsOpen(!isOpen)}
        className={`w-full h-[40px] px-3 bg-white border border-gray-300 rounded-lg shadow-xs flex items-center justify-between text-xs text-gray-900 cursor-pointer transition-all ${
          disabled
            ? 'opacity-50 cursor-not-allowed bg-gray-50'
            : isOpen
            ? 'border-blue-600 ring-2 ring-blue-500/20'
            : 'hover:border-gray-400'
        }`}
      >
        <div className="flex items-center gap-2 truncate pr-2">
          <User className="w-4 h-4 text-gray-400 shrink-0" />
          <span className="truncate font-semibold text-gray-900">
            {selectedOption ? (
              <span className="flex items-center gap-2">
                <span className="text-gray-900 font-bold">{selectedOption.name || selectedOption.label}</span>
                <span className="text-[11px] text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded font-mono border border-blue-200">
                  {selectedOption.code || selectedOption.value}
                </span>
                {selectedOption.phone && (
                  <span className="text-[11px] text-gray-500 flex items-center gap-1">
                    <Phone className="w-3 h-3 text-gray-400" />
                    {selectedOption.phone}
                  </span>
                )}
              </span>
            ) : (
              <span className="text-gray-400 font-medium">{placeholder}</span>
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
              className="p-1 hover:bg-gray-100 rounded text-gray-400 hover:text-gray-600"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
          <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </div>
      </div>

      {/* Popover Dropdown */}
      {isOpen && !disabled && (
        <div className="absolute right-0 top-full z-50 mt-1.5 w-full sm:w-[360px] max-w-[calc(100vw-2rem)] bg-white border border-gray-200 rounded-xl shadow-2xl overflow-hidden flex flex-col animate-in fade-in duration-150">
          {/* Category Filter Pills */}
          {showTypeFilter && (
            <div className="p-2 bg-slate-50 border-b border-gray-200 flex items-center gap-1 overflow-x-auto custom-scrollbar">
              {ACCOUNT_TYPES.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => {
                    setSelectedType(t.key)
                    if (onAccountTypeChange) onAccountTypeChange(t.key)
                  }}
                  className={`px-2.5 py-1 text-[11px] font-bold rounded-md whitespace-nowrap transition-colors cursor-pointer ${
                    selectedType === t.key
                      ? 'bg-slate-900 text-white shadow-xs'
                      : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-100'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          )}

          {/* Search Bar Input */}
          <div className="p-2 border-b border-gray-100 bg-white relative">
            <Search className="w-4 h-4 text-gray-400 absolute left-4 top-1/2 -translate-y-1/2" />
            <input
              ref={inputRef}
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Cari adı, telefon no (05xx) veya cari kodu yazın..."
              className="w-full h-9 pl-9 pr-8 text-xs bg-slate-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 uppercase font-medium"
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
          <div className="px-3 py-1.5 bg-gray-50 border-b border-gray-100 text-[11px] text-gray-500 flex justify-between items-center font-medium">
            <span>
              {remoteLoading ? (
                <span className="text-gray-400">Aranıyor...</span>
              ) : (
                <>
                  Listelenen Cariler: <strong className="text-slate-800">{filteredOptions.length}</strong>
                  {filteredOptions.length > MAX_VISIBLE_OPTIONS && <span className="text-gray-400"> (ilk {MAX_VISIBLE_OPTIONS})</span>}
                  {remoteLimit && filteredOptions.length >= remoteLimit && (
                    <span className="text-amber-600"> · aramayı daraltın</span>
                  )}
                </>
              )}
            </span>
            {searchTerm && <span>Arama: "{searchTerm}"</span>}
          </div>

          {/* Options List */}
          <div className="overflow-y-auto max-h-64 divide-y divide-gray-100 custom-scrollbar">
            {remoteLoading && filteredOptions.length === 0 ? (
              <div className="p-6 text-center text-xs text-gray-400 font-medium">Aranıyor...</div>
            ) : filteredOptions.length === 0 ? (
              <div className="p-6 text-center text-xs text-gray-400 font-medium">
                Aradığınız kriterlere uygun cari bulunamadı.
              </div>
            ) : (
              visibleOptions.map((opt) => {
                const isSelected = opt.value === value
                const codeStr = opt.code || opt.value
                const nameStr = opt.name || opt.label.replace(`(${codeStr})`, '').trim()

                return (
                  <div
                    key={opt.value}
                    onClick={() => {
                      onChange(opt.value)
                      setIsOpen(false)
                      setSearchTerm('')
                    }}
                    className={`px-3.5 py-2.5 text-xs cursor-pointer transition-colors flex items-center justify-between ${
                      isSelected
                        ? 'bg-blue-50/80 text-blue-900 font-semibold'
                        : 'hover:bg-slate-50 text-gray-800'
                    }`}
                  >
                    <div className="flex flex-col gap-0.5">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-gray-900">{nameStr}</span>
                        {isSelected && <Check className="w-3.5 h-3.5 text-blue-600 shrink-0" />}
                      </div>
                      <div className="flex items-center gap-3 text-[11px] text-gray-500">
                        <span className="font-mono text-blue-700 bg-blue-50 px-1 py-0.5 rounded border border-blue-100">
                          {codeStr}
                        </span>
                        {opt.phone && (
                          <span className="flex items-center gap-1 text-gray-600">
                            <Phone className="w-3 h-3 text-gray-400" />
                            {opt.phone}
                          </span>
                        )}
                      </div>
                    </div>
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
