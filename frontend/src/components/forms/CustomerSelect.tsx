import { ChevronDown, ChevronUp, Eye, Pencil } from 'lucide-react'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { fetchCustomers, type CustomerDto } from '../../api/customers'

type Props = {
  label: string
  requiredMark?: boolean
  value: CustomerDto | null
  onChange: (next: CustomerDto | null) => void
  placeholder?: string
  minQueryLength?: number
  limit?: number
  fetcher?: (opts: { q?: string; includeInactive?: boolean; limit?: number; signal?: AbortSignal }) => Promise<CustomerDto[]>
  formatOptionLabel?: (c: CustomerDto) => string
  onEditOption?: (c: CustomerDto) => void
  onViewOption?: (c: CustomerDto) => void
  disabled?: boolean
  disabledMessage?: string
  /**
   * Listede GORUNSUN ama SECILEMESIN. Magaza Siparis ekraninda bayiler bunun icin
   * listeye katiliyor: kullanici bir bayiyi musteri sanip aramasin, gorsun ama secemesin.
   */
  isOptionDisabled?: (c: CustomerDto) => boolean
  /** Secilemeyen satirin yanina yazilacak kisa aciklama (or. 'Bayi - secilemez'). */
  optionDisabledNote?: (c: CustomerDto) => string
}

function useClickOutside(ref: React.RefObject<HTMLElement>, onOutside: () => void, enabled: boolean) {
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

export default function CustomerSelect({
  label,
  requiredMark,
  value,
  onChange,
  placeholder = 'Cari kodu, adı veya telefon ile arayın',
  minQueryLength = 1,
  limit = 50,
  fetcher,
  formatOptionLabel,
  onEditOption,
  onViewOption,
  disabled = false,
  disabledMessage,
  isOptionDisabled,
  optionDisabledNote
}: Props) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<CustomerDto[]>([])
  const [loading, setLoading] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)

  const abortRef = useRef<AbortController | null>(null)
  const debounceRef = useRef<number | null>(null)

  /**
   * Sunucudan istenecek satir sayisi. Ekranda gosterilen `limit` (varsayilan 50) degil,
   * ondan GENIS: sunucunun suzgeci alanlari birlestirip tarayan genis bir suzgec, daraltmayi
   * asagidaki `filteredItems` yapiyor. Tam `limit` isteseydik istemci suzgeci eledikten sonra
   * liste beklenenden kisa gorunurdu.
   */
  const serverLimit = Math.max(200, limit * 4)

  /**
   * KARARSIZ KİMLİKLİ GERİ ÇAĞRILAR EFEKT BAĞIMLILIĞINDAN ÇIKARILDI (2026-08-21).
   *
   * `onChange` ve `isOptionDisabled` çağıran tarafta satır içi ok fonksiyonu olarak veriliyor
   * (`onChange={(next) => setState(...)}`), yani her render'da YENİ kimlik alıyorlar. Bunlar
   * aşağıdaki "tek seçenek var mı" yoklamasının bağımlılığında olduğu sürece efekt ebeveynin
   * HER render'ında yeniden çalışıyordu.
   *
   * Mağaza Sipariş ve Sipariş ekranlarında bu felaket: sayfa sepet, adet, montaj gibi her
   * durum değişiminde render oluyor ve her seferinde `q=''` ile İKİ ayrı cari isteği
   * gidiyordu. Uçta sınır olmadığı için (bkz. CustomersController `dealers` — `Take` yok)
   * her istek bütün cari listesini baştan indiriyor, ayrıştırıyor ve süzüyordu. Seçim
   * kutusunun "aşırı donması" buydu.
   *
   * Değerleri ref'te tutup efekti yalnız gerçekten değişen girdilere bağlıyoruz; davranış
   * aynı kalıyor, yoklama artık gereksiz yere tekrarlanmıyor.
   */
  const onChangeRef = useRef(onChange)
  const isOptionDisabledRef = useRef(isOptionDisabled)
  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])
  useEffect(() => {
    isOptionDisabledRef.current = isOptionDisabled
  }, [isOptionDisabled])

  const displayValue = useMemo(() => {
    if (!value) return ''
    const code = String(value.customerCode ?? '').trim()
    const name = String(value.name ?? '').trim()
    if (!code && !name) return ''
    if (formatOptionLabel) return formatOptionLabel(value)
    return code && name ? `(${code}) ${name}` : code || name
  }, [formatOptionLabel, value])

  // Sync display value when value changes or when dropdown closes
  useEffect(() => {
    if (!open) {
      setQuery(displayValue)
    }
  }, [displayValue, open])

  // Auto-select if there is exactly 1 customer option available
  useEffect(() => {
    if (value || disabled) return
    const controller = new AbortController()
    void (async () => {
      try {
        const fn = fetcher ?? fetchCustomers

        // Yoklama icin butun listeyi indirmeye gerek yok: "tek secenek var mi" sorusunu
        // 3 satir cevaplar. Sinira DAYANIRSA (3 satir geldiyse) en az 3 aday var demektir,
        // yani cevap kesin "hayir" — daha fazlasini bilmeye gerek yok.
        const PROBE = 3
        const list = await fn({ q: '', includeInactive: false, limit: PROBE, signal: controller.signal })
        if ((list?.length ?? 0) >= PROBE) return

        // Secilemez satirlar (or. bayiler) tek secenek sayilmaz; yoksa listede tek bir bayi
        // kaldiginda ekran onu kendiliginden secip kullaniciyi kilitli bir secimle birakiyor.
        // Bu suzme ancak listenin TAMAMI elimizdeyken dogru sonuc verir — yukaridaki sinir
        // kontrolu tam olarak bunu garanti ediyor.
        const filteredList = (list ?? []).filter(
          (c) =>
            (c as any).accountRole !== 'INVOICE_ACCOUNT' &&
            !String(c.customerCode ?? '').endsWith('-1') &&
            !isOptionDisabledRef.current?.(c)
        )
        if (filteredList.length === 1) {
          onChangeRef.current(filteredList[0])
        }
      } catch {}
    })()
    return () => controller.abort()
  }, [disabled, fetcher, value])

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
        const fn = fetcher ?? fetchCustomers
        const searchQ = (trimmed === displayValue.trim()) ? '' : trimmed
        // SUNUCU SINIRI, EKRAN SINIRINDAN GENIS (2026-08-21).
        //
        // Uc artik `q` ile suzuyor ve `limit` kadar satir donuyor. Sunucunun suzgeci bilerek
        // GENIS: alanlari birlestirip tariyor, daraltmayi asagidaki `filteredItems` yapiyor.
        // Bu yuzden sunucudan ekranda gosterilecek sayidan FAZLA satir istiyoruz; tam `limit`
        // isteseydik istemci suzgeci elediginde liste beklenenden kisa gorunurdu.
        const list = await fn({ q: searchQ, includeInactive: false, limit: serverLimit, signal: controller.signal })
        const filteredList = (list ?? []).filter((c) => (c as any).accountRole !== 'INVOICE_ACCOUNT' && !String(c.customerCode ?? '').endsWith('-1'))
        setItems(filteredList)
        setActiveIndex(filteredList && filteredList.length ? 0 : -1)
      } catch (e) {
        if ((e as any)?.name === 'AbortError') return
        setItems([])
        setActiveIndex(-1)
      } finally {
        setLoading(false)
      }
    }, 200)
  }

  const filteredItems = useMemo(() => {
    const trimmed = query.trim()
    if (!trimmed || trimmed === displayValue.trim()) return items.slice(0, Math.max(1, limit))

    const qNorm = normalizeText(trimmed)
    const qDigits = extractDigits(trimmed)
    const qWords = trimmed.toLowerCase().split(/\s+/).filter(Boolean)

    const result: CustomerDto[] = []

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
        const fullText = `${code} ${name} ${phone} ${tax}`
        const fullNorm = normalizeText(fullText)
        isMatch = qWords.every((word) => {
          const wNorm = normalizeText(word)
          return fullNorm.includes(wNorm)
        })
      }

      if (isMatch) {
        result.push(c)
        if (result.length >= limit) break
      }
    }

    return result
  }, [items, query, displayValue, limit])

  const secilemez = (c: CustomerDto | null | undefined) => Boolean(c && isOptionDisabled?.(c))

  const select = (c: CustomerDto) => {
    // Secilemez satir: tiklama da klavye de gecmez. Tek kapi burasi.
    if (secilemez(c)) return
    onChange(c)
    setOpen(false)
    setItems([])
    setActiveIndex(-1)
    try {
      inputRef.current?.blur()
      if (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) {
        document.activeElement.blur()
      }
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

    // Ok tuslari secilemez satirlarin UZERINDE DURMAZ; yoksa Enter'a basan kullanici
    // hicbir sey olmamis gibi hissediyor.
    const sonrakiSecilebilir = (baslangic: number, yon: 1 | -1) => {
      for (let i = baslangic; i >= 0 && i < filteredItems.length; i += yon) {
        if (!secilemez(filteredItems[i])) return i
      }
      return -1
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => {
        const bulunan = sonrakiSecilebilir(Math.min(filteredItems.length - 1, i + 1), 1)
        return bulunan === -1 ? i : bulunan
      })
      return
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => {
        const bulunan = sonrakiSecilebilir(Math.max(0, i - 1), -1)
        return bulunan === -1 ? i : bulunan
      })
      return
    }

    if (e.key === 'Enter') {
      if (!open) return
      e.preventDefault()
      const idx = activeIndex
      if (idx >= 0 && idx < filteredItems.length) {
        select(filteredItems[idx])
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

  const onChangeQuery = (v: string) => {
    setQuery(v)
    setOpen(true)
    doSearch(v)
  }

  return (
    <div ref={rootRef} className="space-y-2 relative">
      <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide">
        {label} {requiredMark && <span className="text-red-500">*</span>}
      </label>

      <div className="relative">
        <input
          ref={inputRef}
          className={'input-base pr-16' + (disabled ? ' bg-gray-100 text-gray-400 cursor-not-allowed' : '')}
          value={query}
          placeholder={disabled ? (disabledMessage || placeholder) : placeholder}
          onChange={(e) => { if (!disabled) onChangeQuery(e.target.value) }}
          onFocus={onFocus}
          onKeyDown={(e) => { if (!disabled) onKeyDown(e) }}
          readOnly={disabled}
        />

        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
          {query.trim() && (
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
        <div className="absolute z-50 left-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-2xl max-h-80 overflow-y-auto w-full min-w-[320px] sm:min-w-[440px] max-w-[calc(100vw-2rem)] divide-y divide-gray-100">
          {loading ? (
            <div className="px-3.5 py-3 text-xs text-gray-500 flex items-center gap-2">
              <span className="inline-block w-3.5 h-3.5 border-2 border-slate-400 border-t-transparent rounded-full animate-spin"></span>
              Yükleniyor...
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="px-4 py-4 text-xs text-gray-400 font-medium text-center">Sonuç bulunamadı</div>
          ) : (
            filteredItems.map((c, idx) => {
              const kilitli = secilemez(c)
              const isActive = idx === activeIndex && !kilitli
              const code = String(c.customerCode ?? '').trim()
              const name = String(c.name ?? '').trim()
              const phone = String(c.phone ?? '').trim()
              const location = [c.district, c.city].filter(Boolean).join(' / ')
              const kilitNotu = kilitli ? (optionDisabledNote?.(c) ?? 'Seçilemez') : ''

              return (
                <div
                  key={c.customerCode || idx}
                  role="button"
                  aria-disabled={kilitli}
                  tabIndex={kilitli ? -1 : 0}
                  title={kilitNotu || undefined}
                  className={
                    'w-full text-left px-3.5 py-2.5 text-xs focus:outline-none transition-colors ' +
                    (kilitli
                      ? 'opacity-45 cursor-not-allowed bg-slate-50/60 text-gray-500 select-none'
                      : isActive
                      ? 'bg-slate-900 text-white cursor-pointer'
                      : 'hover:bg-slate-50 text-gray-800 cursor-pointer')
                  }
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => { if (!kilitli) setActiveIndex(idx) }}
                  onClick={() => select(c)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      select(c)
                    }
                  }}
                >
                  <div className="flex items-center justify-between gap-3">
                    {/* 2 Satırlı Cari Bilgisi */}
                    <div className="min-w-0 flex-1 flex flex-col gap-1">
                      {/* Üst Satır: Cari Adı */}
                      <div className="flex items-center gap-2">
                        <span className={`font-bold text-xs leading-tight truncate ${isActive ? 'text-white' : kilitli ? 'text-gray-500' : 'text-gray-900'}`}>
                          {name || code}
                        </span>
                        {kilitli && (
                          <span className="shrink-0 px-1.5 py-0.5 rounded border border-amber-300 bg-amber-50 text-amber-700 text-[10px] font-bold uppercase leading-none">
                            {kilitNotu}
                          </span>
                        )}
                      </div>

                      {/* Alt Satır: Cari Kodu Badge + Telefon + Lokasyon */}
                      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                        <span
                          className={`font-mono px-1.5 py-0.5 rounded border leading-none font-semibold ${
                            isActive
                              ? 'bg-white/20 text-white border-white/30'
                              : 'bg-blue-50 text-blue-700 border-blue-200'
                          }`}
                        >
                          {code}
                        </span>

                        {phone && (
                          <span
                            className={`flex items-center gap-1 px-1.5 py-0.5 rounded border leading-none font-medium ${
                              isActive
                                ? 'bg-white/15 text-white border-white/20'
                                : 'bg-slate-100 text-slate-600 border-slate-200'
                            }`}
                          >
                            📞 {phone}
                          </span>
                        )}

                        {location && (
                          <span
                            className={`text-[10px] truncate ${
                              isActive ? 'text-white/70' : 'text-gray-400 font-medium'
                            }`}
                          >
                            • {location}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Aksiyon Butonları (Önizle / Düzenle) */}
                    <div className="shrink-0 flex items-center gap-1">
                      {onViewOption && (
                        <button
                          type="button"
                          className={
                            'shrink-0 inline-flex items-center justify-center w-7 h-7 rounded border transition-colors ' +
                            (isActive ? 'border-white/30 text-white hover:bg-white/10' : 'border-gray-200 text-gray-600 hover:bg-gray-100')
                          }
                          onMouseDown={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                          }}
                          onClick={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            onViewOption(c)
                          }}
                          aria-label="Önizle"
                          title="Önizle"
                        >
                          <Eye size={13} />
                        </button>
                      )}

                      {onEditOption && (
                        <button
                          type="button"
                          className={
                            'shrink-0 inline-flex items-center justify-center w-7 h-7 rounded border transition-colors ' +
                            (isActive ? 'border-white/30 text-white hover:bg-white/10' : 'border-gray-200 text-gray-600 hover:bg-gray-100')
                          }
                          onMouseDown={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                          }}
                          onClick={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            onEditOption(c)
                          }}
                          aria-label="Düzenle"
                          title="Düzenle"
                        >
                          <Pencil size={13} />
                        </button>
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
