import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowDown, ArrowUp, GripVertical, RotateCcw, Settings2 } from 'lucide-react'

/*
  PERSONEL PROGRAMI KOPYASI (2026-10-14): Servis'teki `components/data-table/DataTableSettingsMenu.tsx`
  ile aynı menü; tek fark `allowReorder` (bkz. AyarliTablo).

  TABLO AYARLARI DÜĞMESİ (2026-10-11, kullanıcı isteği) — her tablonun sol altında, Excel'in yanında.

  Üç ayar, hepsi kullanıcı bazlı saklanır (bkz. lib/tablePreferences.ts):
   - Sütunu göster / gizle (onay kutusu)
   - Sütun sırası (satırı tutup sürükle ya da ok düğmeleri)
   - Sütun genişliği (piksel; boş = otomatik). Genişlik başlıktaki ayırıcıyı sürükleyerek de verilir.

  Pencere gövdeye (portal) çizilir: tablonun kabı `overflow-hidden`, az satırlı tabloda içeride
  açılan pencere üstten kesilirdi.
*/

export type SettingsColumn = {
  id: string
  label: string
  visible: boolean
  /** Kullanıcının verdiği genişlik (px); yoksa otomatik. */
  width?: number
}

type Props = {
  columns: SettingsColumn[]
  /** Kullanıcı varsayılandan farklı bir şey kaydetmiş mi (düğmede nokta + "Sıfırla" etkin). */
  customized: boolean
  onToggle: (id: string) => void
  /** Sütunu yeni sıraya taşır: `toIndex` görünen listede hedef konum. */
  onMove: (id: string, toIndex: number) => void
  onWidth: (id: string, width: number | null) => void
  onShowAll: () => void
  onReset: () => void
  /**
   * Sütun sırası değiştirilebilir mi. Personel programındaki tablolar elle yazılmış düz tablolar;
   * sütun yerini değiştirmek sayfanın kendi kodunu gerektirir, orada yalnız gizle + genişlik var.
   */
  allowReorder?: boolean
}

export const MIN_COLUMN_WIDTH = 40
export const MAX_COLUMN_WIDTH = 1200

export function DataTableSettingsMenu({ columns, customized, onToggle, onMove, onWidth, onShowAll, onReset, allowReorder = true }: Props) {
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState<{ left: number; bottom: number; maxHeight: number } | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)

  const place = () => {
    const btn = buttonRef.current
    if (!btn) return
    const r = btn.getBoundingClientRect()
    const width = 340
    // Düğmenin ÜSTÜNE açılır (düğme tablonun altında); solda taşmasın, sağda ekrandan çıkmasın.
    const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8))
    const bottom = Math.max(8, window.innerHeight - r.top + 6)
    setPos({ left, bottom, maxHeight: Math.max(220, r.top - 16) })
  }

  useLayoutEffect(() => {
    if (open) place()
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (panelRef.current?.contains(t) || buttonRef.current?.contains(t)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    const onMoveWin = () => place()
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', onMoveWin)
    window.addEventListener('scroll', onMoveWin, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onMoveWin)
      window.removeEventListener('scroll', onMoveWin, true)
    }
  }, [open])

  const visibleCount = columns.filter((c) => c.visible).length

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`relative inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-colors cursor-pointer mr-1 ${
          open ? 'bg-slate-200 text-slate-900 border-slate-300' : 'bg-slate-50 text-slate-700 hover:bg-slate-100 border-slate-200'
        }`}
        title={allowReorder ? 'Tablo ayarları: sütunları gizle/göster, sırala, genişlik ver (size özel kaydedilir)' : 'Tablo ayarları: sütunları gizle/göster, genişlik ver (size özel kaydedilir)'}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <Settings2 size={15} className="text-slate-500" />
        <span>Ayarlar</span>
        {customized && <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-sky-500" aria-hidden="true" />}
      </button>

      {open && pos &&
        createPortal(
          <div
            ref={panelRef}
            role="dialog"
            aria-label="Tablo ayarları"
            data-interactive="true"
            style={{ position: 'fixed', left: pos.left, bottom: pos.bottom, width: 340, maxHeight: pos.maxHeight, zIndex: 1000 }}
            className="flex flex-col rounded-xl bg-white border border-slate-200 shadow-2xl text-xs text-slate-700"
          >
            <div className="px-3 py-2 border-b border-slate-100">
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold text-slate-900">Tablo ayarları</span>
                <span className="text-[11px] text-slate-500">{visibleCount}/{columns.length} sütun</span>
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">
                Bu ayarlar yalnız size özeldir ve kaydedilir.{allowReorder ? ' Sıra için satırı sürükleyin.' : ' Genişliği başlığın sağ kenarını sürükleyerek de verebilirsiniz.'}
              </div>
            </div>

            <div className="flex items-center gap-2 px-3 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-400 border-b border-slate-100">
              {allowReorder && <span className="w-4" />}
              <span className="w-4" />
              <span className="flex-1">Sütun</span>
              <span className="w-[62px] text-right">Genişlik</span>
              {allowReorder && <span className="w-[44px]" />}
            </div>

            <div className="overflow-y-auto py-1 flex-1 min-h-0">
              {columns.map((col, idx) => (
                <div
                  key={col.id}
                  draggable={allowReorder}
                  onDragStart={(e) => {
                    if (!allowReorder) return
                    setDragId(col.id)
                    e.dataTransfer.effectAllowed = 'move'
                    // Firefox veri konmadan sürüklemeyi başlatmıyor.
                    e.dataTransfer.setData('text/plain', col.id)
                  }}
                  onDragOver={(e) => {
                    if (!dragId || dragId === col.id) return
                    e.preventDefault()
                    setOverId(col.id)
                  }}
                  onDragLeave={() => setOverId((cur) => (cur === col.id ? null : cur))}
                  onDrop={(e) => {
                    e.preventDefault()
                    if (dragId && dragId !== col.id) onMove(dragId, idx)
                    setDragId(null)
                    setOverId(null)
                  }}
                  onDragEnd={() => {
                    setDragId(null)
                    setOverId(null)
                  }}
                  className={`flex items-center gap-2 px-3 py-1 ${overId === col.id ? 'bg-sky-50 outline outline-1 outline-sky-300' : 'hover:bg-slate-50'} ${
                    dragId === col.id ? 'opacity-40' : ''
                  }`}
                >
                  {allowReorder && <GripVertical size={14} className="w-4 text-slate-300 cursor-grab shrink-0" />}
                  <input
                    type="checkbox"
                    checked={col.visible}
                    // Son görünen sütun gizlenemez: boş tabloda ayarı geri açmanın yolu kalmazdı.
                    disabled={col.visible && visibleCount <= 1}
                    onChange={() => onToggle(col.id)}
                    className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500 border-slate-300 cursor-pointer shrink-0"
                    aria-label={`${col.label} sütununu göster`}
                  />
                  <span className={`flex-1 truncate ${col.visible ? 'text-slate-800 font-semibold' : 'text-slate-400 line-through'}`} title={col.label}>
                    {col.label}
                  </span>
                  <WidthInput value={col.width} onCommit={(w) => onWidth(col.id, w)} label={col.label} />
                  {allowReorder && <span className="w-[44px] flex items-center justify-end gap-0.5 shrink-0">
                    <button
                      type="button"
                      disabled={idx === 0}
                      onClick={() => onMove(col.id, idx - 1)}
                      className="p-1 rounded hover:bg-slate-200 text-slate-500 disabled:opacity-25 disabled:hover:bg-transparent"
                      title="Sola al"
                      aria-label={`${col.label} sütununu sola al`}
                    >
                      <ArrowUp size={13} />
                    </button>
                    <button
                      type="button"
                      disabled={idx === columns.length - 1}
                      onClick={() => onMove(col.id, idx + 1)}
                      className="p-1 rounded hover:bg-slate-200 text-slate-500 disabled:opacity-25 disabled:hover:bg-transparent"
                      title="Sağa al"
                      aria-label={`${col.label} sütununu sağa al`}
                    >
                      <ArrowDown size={13} />
                    </button>
                  </span>}
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between gap-2 px-3 py-2 border-t border-slate-100">
              <button type="button" onClick={onShowAll} className="text-[11px] font-semibold text-emerald-700 hover:underline">
                Hepsini göster
              </button>
              <button
                type="button"
                onClick={onReset}
                disabled={!customized}
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-600 hover:text-slate-900 disabled:opacity-40"
                title="Bu tablonun bütün ayarlarını sil, varsayılana dön"
              >
                <RotateCcw size={12} /> Varsayılana dön
              </button>
            </div>
          </div>,
          document.body
        )}
    </>
  )
}

/** Genişlik kutusu: yazarken tabloyu zıplatmamak için değer Enter / odak kaybında işlenir. */
function WidthInput({ value, onCommit, label }: { value?: number; onCommit: (w: number | null) => void; label: string }) {
  const [text, setText] = useState(value ? String(value) : '')
  useEffect(() => setText(value ? String(value) : ''), [value])

  const commit = () => {
    const raw = text.trim()
    if (!raw) {
      if (value) onCommit(null)
      return
    }
    const n = Math.round(Number(raw))
    if (!Number.isFinite(n) || n <= 0) {
      setText(value ? String(value) : '')
      return
    }
    const clamped = Math.max(MIN_COLUMN_WIDTH, Math.min(MAX_COLUMN_WIDTH, n))
    setText(String(clamped))
    if (clamped !== value) onCommit(clamped)
  }

  return (
    <input
      type="text"
      inputMode="numeric"
      value={text}
      placeholder="oto"
      onChange={(e) => setText(e.target.value.replace(/[^\d]/g, '').slice(0, 4))}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
      }}
      className="w-[62px] h-6 px-1.5 text-right text-[11px] rounded border border-slate-200 bg-white focus:outline-none focus:ring-1 focus:ring-slate-400 shrink-0"
      title="Genişlik (piksel). Boş bırakırsanız otomatik."
      aria-label={`${label} sütun genişliği (piksel)`}
    />
  )
}
