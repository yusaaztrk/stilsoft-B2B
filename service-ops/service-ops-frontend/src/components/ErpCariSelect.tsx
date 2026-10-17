import React, { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { fetchErpDealers, type ErpDealerDto, type ErpDealerType } from '../api/erp'
import { restrictToAssignedDealers } from '../auth/dealerScope'

// Kapsam süzgeci `auth/dealerScope.ts`e taşındı: arıza kabul ekranı da aynı kuralı uyguluyor
// ve iki kopya olsaydı biri değiştiğinde diğeri sessizce eski davranışta kalırdı.
const restrictToAssigned = restrictToAssignedDealers<ErpDealerDto>

type Props = {
  type: ErpDealerType
  value: ErpDealerDto | null
  onChange: (next: ErpDealerDto | null) => void
  /** value henüz nesne olarak elde yokken (kayıt düzenleme) gösterilecek metin */
  valueLabel?: string
  placeholder?: string
  minQueryLength?: number
  limit?: number
  disabled?: boolean
  disabledMessage?: string
  compact?: boolean
}

function useClickOutside(ref: React.RefObject<HTMLElement | null>, onOutside: () => void, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return

    const onDown = (e: MouseEvent) => {
      const el = ref.current
      if (!el) return
      if (el.contains(e.target as Node)) return
      onOutside()
    }

    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [enabled, onOutside, ref])
}

function normalizeText(val: string | null | undefined): string {
  if (!val) return ''
  return String(val)
    .toLowerCase()
    .replace(/i̇/g, 'i')
    .replace(/ı/g, 'i')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .replace(/[\s\-().,\/]+/g, '')
}

function extractDigits(val: string | null | undefined): string {
  if (!val) return ''
  return String(val).replace(/\D/g, '')
}

export function formatCariLabel(c: ErpDealerDto): string {
  const code = String(c?.customerCode ?? '').trim()
  const name = String(c?.name ?? '').trim()
  if (code && name) return `${name} (${code})`
  return name || code
}

export default function ErpCariSelect({
  type,
  value,
  onChange,
  valueLabel,
  placeholder = 'Cari kodu, adı veya telefon ile arayın',
  minQueryLength = 1,
  limit = 50,
  disabled = false,
  disabledMessage,
  compact = false
}: Props) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<ErpDealerDto[]>([])
  const [loading, setLoading] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)

  const abortRef = useRef<AbortController | null>(null)
  const debounceRef = useRef<number | null>(null)

  const displayValue = useMemo(() => {
    if (value) return formatCariLabel(value)
    return String(valueLabel ?? '').trim()
  }, [value, valueLabel])

  useEffect(() => {
    if (!open) {
      setQuery(displayValue)
    }
  }, [displayValue, open])

  useClickOutside(
    rootRef,
    () => {
      setOpen(false)
      setActiveIndex(-1)
      setQuery(displayValue)
    },
    open
  )

  const clear = () => {
    onChange(null)
    setQuery('')
    setItems([])
    setActiveIndex(-1)
    setOpen(false)
    inputRef.current?.focus()
  }

  const doSearch = (q: string) => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current)
    abortRef.current?.abort()

    const trimmed = q.trim()
    if (trimmed.length > 0 && trimmed.length < minQueryLength) {
      setItems([])
      setLoading(false)
      setActiveIndex(-1)
      return
    }

    const controller = new AbortController()
    abortRef.current = controller

    debounceRef.current = window.setTimeout(async () => {
      try {
        setLoading(true)
        const searchQ = trimmed === displayValue.trim() ? '' : trimmed
        const fetched = await fetchErpDealers(controller.signal, searchQ || undefined, type)
        if (controller.signal.aborted) return
        const list = restrictToAssigned(fetched)
        setItems(list)
        setActiveIndex(list.length ? 0 : -1)
      } catch (e) {
        if ((e as any)?.name === 'AbortError') return
        setItems([])
        setActiveIndex(-1)
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }, 200)
  }

  // Cari tipi değişince eldeki liste geçersiz
  useEffect(() => {
    setItems([])
    setActiveIndex(-1)
  }, [type])

  const filteredItems = useMemo(() => {
    const trimmed = query.trim()
    if (!trimmed || trimmed === displayValue.trim()) return items.slice(0, Math.max(1, limit))

    const qNorm = normalizeText(trimmed)
    const qDigits = extractDigits(trimmed)
    const qWords = trimmed.toLowerCase().split(/\s+/).filter(Boolean)

    const result: ErpDealerDto[] = []

    for (const c of items) {
      const code = String(c.customerCode ?? '')
      const name = String(c.name ?? '')
      const phone = String(c.phone ?? '')
      const tax = String(c.taxNumber ?? '')

      const codeNorm = normalizeText(code)
      const nameNorm = normalizeText(name)
      const phoneNorm = normalizeText(phone)
      const phoneDigits = extractDigits(phone)
      const taxNorm = normalizeText(tax)

      let isMatch = false

      if (codeNorm.includes(qNorm) || nameNorm.includes(qNorm) || phoneNorm.includes(qNorm) || taxNorm.includes(qNorm)) {
        isMatch = true
      } else if (qDigits.length >= 3 && phoneDigits.includes(qDigits)) {
        isMatch = true
      } else if (qWords.length > 1) {
        const fullNorm = normalizeText(`${code} ${name} ${phone} ${tax}`)
        isMatch = qWords.every((word) => fullNorm.includes(normalizeText(word)))
      }

      if (isMatch) {
        result.push(c)
        if (result.length >= limit) break
      }
    }

    return result
  }, [items, query, displayValue, limit])

  const select = (c: ErpDealerDto) => {
    onChange(c)
    setOpen(false)
    setItems([])
    setActiveIndex(-1)
    try {
      inputRef.current?.blur()
    } catch {}
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      setOpen(true)
      doSearch('')
      return
    }

    if (e.key === 'Escape') {
      setOpen(false)
      setActiveIndex(-1)
      setQuery(displayValue)
      return
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => Math.min(filteredItems.length - 1, i + 1))
      return
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => Math.max(0, i - 1))
      return
    }

    if (e.key === 'Enter') {
      if (!open) return
      e.preventDefault()
      if (activeIndex >= 0 && activeIndex < filteredItems.length) {
        select(filteredItems[activeIndex])
      }
    }
  }

  const onFocus = () => {
    if (disabled) return
    setOpen(true)
    doSearch('')
  }

  const toggleOpen = () => {
    if (disabled) return
    setOpen((v) => {
      const next = !v
      if (next) {
        doSearch('')
        window.setTimeout(() => inputRef.current?.focus(), 0)
      } else {
        setQuery(displayValue)
      }
      return next
    })
  }

  const inputClass =
    `px-3 py-2 border border-gray-200 rounded-lg w-full pr-16 focus:outline-none focus:ring-1 focus:ring-[#B91C1C] ${compact ? 'text-xs' : 'text-sm'} ` +
    (disabled ? 'bg-gray-50 text-gray-400 cursor-not-allowed' : 'bg-white')

  return (
    <div ref={rootRef} className="relative">
      <div className="relative">
        <input
          ref={inputRef}
          className={inputClass}
          value={query}
          placeholder={disabled ? disabledMessage || placeholder : placeholder}
          onChange={(e) => {
            if (disabled) return
            setQuery(e.target.value)
            setOpen(true)
            doSearch(e.target.value)
          }}
          onFocus={onFocus}
          onKeyDown={(e) => {
            if (!disabled) onKeyDown(e)
          }}
          readOnly={disabled}
        />

        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
          {!disabled && query.trim() && (
            <button
              type="button"
              className="text-gray-400 hover:text-gray-700 px-1 font-bold text-sm"
              onMouseDown={(e) => e.preventDefault()}
              onClick={clear}
              aria-label="Temizle"
              title="Temizle"
            >
              ×
            </button>
          )}

          <button
            type="button"
            className="text-gray-400 hover:text-gray-700"
            onMouseDown={(e) => e.preventDefault()}
            onClick={toggleOpen}
            aria-label={open ? 'Kapat' : 'Aç'}
            title={open ? 'Kapat' : 'Aç'}
          >
            {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
        </div>
      </div>

      {open && (
        <div className="absolute z-30 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-xl max-h-72 overflow-y-auto">
          {loading ? (
            <div className="px-3 py-2.5 text-xs text-gray-500 flex items-center gap-2">
              <span className="inline-block w-3 h-3 border-2 border-slate-400 border-t-transparent rounded-full animate-spin"></span>
              Yükleniyor...
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="px-3 py-2.5 text-xs text-gray-500">Sonuç bulunamadı</div>
          ) : (
            filteredItems.map((c, idx) => {
              const isActive = idx === activeIndex
              const phone = String(c.phone ?? '').trim()

              return (
                <div
                  key={c.customerCode || idx}
                  role="button"
                  tabIndex={0}
                  className={
                    'w-full text-left px-3 py-2.5 text-xs border-b border-gray-100 cursor-pointer focus:outline-none transition-colors ' +
                    (isActive ? 'bg-gray-900 text-white' : 'hover:bg-gray-50 text-gray-800')
                  }
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setActiveIndex(idx)}
                  onClick={() => select(c)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      select(c)
                    }
                  }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-xs leading-snug min-w-0 flex-1 truncate">{formatCariLabel(c)}</span>
                    <div className="shrink-0 flex items-center gap-1">
                      {c.invoiceType && (
                        <span
                          className={
                            'text-[10px] font-bold px-1.5 py-0.5 rounded border leading-tight ' +
                            (isActive ? 'bg-white/15 text-white border-white/20' : 'bg-amber-50 text-amber-700 border-amber-200')
                          }
                        >
                          {c.invoiceType}
                        </span>
                      )}
                      {phone && (
                        <span
                          className={
                            'text-[10px] font-medium px-1.5 py-0.5 rounded border leading-tight ' +
                            (isActive ? 'bg-white/15 text-white border-white/20' : 'bg-slate-100 text-slate-600 border-slate-200')
                          }
                        >
                          📞 {phone}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              )
            })
          )}

          {!loading && filteredItems.length > 0 && (
            <div className="px-3 py-1.5 text-[11px] text-gray-400 bg-gray-50 border-t border-gray-100 flex items-center justify-between">
              <span>Gösterilen: {filteredItems.length}</span>
              {filteredItems.length >= limit && <span>(Aramayı daraltmak için yazmaya devam edin)</span>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
