import { useEffect, useRef, useState } from 'react'

/*
  Aranabilir açılır liste — Cari Ekle ekranındaki İl/İlçe kutusunun davranışı.

  Oradaki kurgu satır içine gömülüydü ve kopyalanmadan başka ekranda kullanılamıyordu;
  Mağaza Sipariş'teki "Yeni Müşteri Ekle" kutusu da bu yüzden serbest metin alıyordu.
  Bileşen hâline getirildi ki iki ekran aynı listeden aynı değerleri üretsin.
*/
export type SearchableSelectProps = {
  label?: string
  value: string
  options: readonly string[]
  onChange: (next: string) => void
  placeholder?: string
  searchPlaceholder?: string
  disabled?: boolean
  className?: string
}

export default function SearchableSelect({
  label,
  value,
  options,
  onChange,
  placeholder = 'Seçiniz...',
  searchPlaceholder = 'Ara...',
  disabled = false,
  className = ''
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const boxRef = useRef<HTMLDivElement | null>(null)

  // Dışarı tıklayınca kapansın; modal içinde kullanıldığı için document seviyesinde dinliyoruz.
  useEffect(() => {
    if (!open) return
    const onDocClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  const filtered = options.filter((o) => o.includes(search))

  return (
    <div className={`space-y-1 relative ${className}`} ref={boxRef}>
      {label && <label className="block text-xs font-semibold text-gray-700">{label}</label>}
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          if (disabled) return
          setOpen((p) => !p)
          setSearch('')
        }}
        className={
          'w-full px-3 py-2 text-xs border border-gray-200 rounded-lg text-left flex items-center justify-between ' +
          (disabled ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'bg-white text-gray-800 hover:bg-gray-50')
        }
      >
        <span className="truncate">{value || placeholder}</span>
        <span className="text-gray-400">▼</span>
      </button>

      {open && (
        <div className="absolute z-40 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-xl p-2 max-h-60 overflow-y-auto">
          <input
            type="text"
            autoFocus
            className="w-full px-2 h-8 text-xs bg-gray-50 border border-gray-200 rounded mb-1"
            placeholder={searchPlaceholder}
            value={search}
            onChange={(e) => setSearch(e.target.value.toLocaleUpperCase('tr-TR'))}
          />
          <div className="space-y-0.5 mt-1">
            <div
              role="button"
              onClick={() => {
                onChange('')
                setOpen(false)
              }}
              className="px-2 py-1.5 text-xs text-gray-500 rounded hover:bg-gray-50 cursor-pointer"
            >
              Temizle
            </div>
            {filtered.map((o) => (
              <div
                key={o}
                role="button"
                onClick={() => {
                  onChange(o)
                  setOpen(false)
                }}
                className={
                  'px-2 py-1.5 text-xs rounded hover:bg-gray-100 cursor-pointer ' +
                  (value === o ? 'bg-gray-100 font-semibold text-gray-900' : 'text-gray-700')
                }
              >
                {o}
              </div>
            ))}
            {filtered.length === 0 && (
              <div className="px-2 py-2 text-xs text-gray-400">Sonuç yok</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
