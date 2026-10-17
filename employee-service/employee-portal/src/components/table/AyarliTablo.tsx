import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { DataTableSettingsMenu, MAX_COLUMN_WIDTH, MIN_COLUMN_WIDTH, type SettingsColumn } from './DataTableSettingsMenu'
import { tablePrefsKey, useTablePrefs } from '../../lib/tablePreferences'

/*
  TABLO AYARLARI — PERSONEL PROGRAMI (2026-10-14 kullanıcı isteği: "servis ve b2b'deki tablo
  ayarlarının aynısı personel programında da olsun").

  Servis ve B2B'de ayarlar ortak tablo bileşeninin (AppDataTable) içinde. Personel programındaki
  tablolar ise sayfalara elle yazılmış düz <table>'lar; hepsini o bileşene taşımak her ekranın
  düzenini değiştirirdi. Bu sarmalayıcı tabloya DOKUNMADAN üstüne biner:

   - Sütunları başlığın son satırından okur (başlık metni = sütun kimliği).
   - Gizlenen sütunun hücrelerini her satırda gizler; birden çok sütunu kaplayan (colSpan) toplam
     satırlarında kaplama, gizlenen sütun kadar daraltılır — satırlar kaymasın.
   - Genişlik: menüdeki kutudan ya da başlığın sağ kenarını sürükleyerek.
   - Ayar menüsü servisteki menünün aynısı; kayıt da aynı (kullanıcı bazlı, sunucuda).

  Sütun SIRASI burada yok: düz tabloda hücre yerini değiştirmek React'in çizdiği DOM'u bozardı.

  Tablo yeniden çizildikçe (veri geldi, sekme değişti) ayar MutationObserver ile yeniden uygulanır.
*/

type Props = {
  children: React.ReactNode
  /** Aynı sayfada aynı başlıklı iki tablo ayrı ayar tutsun isterse. */
  ayarKey?: string
  className?: string
}

type Col = { id: string; label: string }

const RESIZE_EDGE = 6

/*
  BAŞLIK SATIRI = YAZILI SON SATIR (2026-10-14 canlı bildirim: "sütun isimleri yazmıyor, Sütun 1, 2…").
  Süzgeçli tablolarda başlığın SON satırı arama kutularından oluşuyor, içinde metin yok; ayar
  penceresi bu yüzden "Sütun 1…22" gösteriyordu. Sondan geriye doğru, hücrelerinin en az yarısında
  metin olan ilk satır alınır: süzgeç satırı atlanır, gruplu başlıkta yine alt (yaprak) satır seçilir.
*/
function headerRowOf(table: HTMLTableElement | null): HTMLTableRowElement | null {
  const head = table?.tHead
  if (!head || head.rows.length === 0) return null
  for (let i = head.rows.length - 1; i >= 0; i--) {
    const cells = Array.from(head.rows[i].cells)
    const yazili = cells.filter((c) => (c.textContent ?? '').trim().length > 0).length
    if (cells.length > 0 && yazili * 2 >= cells.length) return head.rows[i]
  }
  return head.rows[head.rows.length - 1]
}

function readColumns(table: HTMLTableElement | null): Col[] {
  const row = headerRowOf(table)
  if (!row) return []
  const seen = new Map<string, number>()
  const out: Col[] = []
  let pos = 0
  for (const cell of Array.from(row.cells)) {
    const span = Math.max(1, Number(cell.dataset.ayarSpan ?? cell.colSpan) || 1)
    const label = (cell.textContent ?? '').replace(/\s+/g, ' ').trim()
    for (let k = 0; k < span; k++) {
      const base = label || `Sütun ${pos + 1}`
      const n = (seen.get(base) ?? 0) + 1
      seen.set(base, n)
      out.push({ id: n > 1 ? `${base}~${n}` : base, label: span > 1 ? `${base} (${k + 1})` : base })
      pos++
    }
  }
  return out
}

/** Hücrenin gerçek (ayar öncesi) kapladığı sütun sayısı. */
function originalSpan(cell: HTMLTableCellElement): number {
  return Math.max(1, Number(cell.dataset.ayarSpan ?? cell.colSpan) || 1)
}

function applyToTable(table: HTMLTableElement, cols: Col[], hidden: Set<string>, widths: Record<string, number>) {
  const hiddenPos = new Set<number>()
  cols.forEach((c, i) => {
    if (hidden.has(c.id)) hiddenPos.add(i)
  })

  for (const row of Array.from(table.rows)) {
    let pos = 0
    for (const cell of Array.from(row.cells)) {
      const span = originalSpan(cell)
      let hiddenInside = 0
      for (let k = 0; k < span; k++) if (hiddenPos.has(pos + k)) hiddenInside++

      // Görünürlük
      if (hiddenInside >= span) {
        if (cell.style.display !== 'none') {
          cell.dataset.ayarGizli = '1'
          cell.style.display = 'none'
        }
      } else if (cell.dataset.ayarGizli) {
        cell.style.display = ''
        delete cell.dataset.ayarGizli
      }

      // Kaplama: gizlenen sütun kadar daralt, ayar kalkınca geri ver.
      if (span > 1) {
        const want = Math.max(1, span - hiddenInside)
        if (want !== span) {
          if (!cell.dataset.ayarSpan) cell.dataset.ayarSpan = String(span)
          if (cell.colSpan !== want) cell.colSpan = want
        } else if (cell.dataset.ayarSpan) {
          cell.colSpan = Number(cell.dataset.ayarSpan)
          delete cell.dataset.ayarSpan
        }
      }

      // Genişlik yalnız tek sütunluk hücrelere.
      if (span === 1) {
        const col = cols[pos]
        const w = col ? widths[col.id] : undefined
        if (w) {
          const px = `${w}px`
          if (cell.style.width !== px) {
            cell.dataset.ayarGenislik = '1'
            cell.style.width = px
            cell.style.minWidth = px
            cell.style.maxWidth = px
            cell.style.overflow = 'hidden'
            cell.style.textOverflow = 'ellipsis'
          }
        } else if (cell.dataset.ayarGenislik) {
          cell.style.width = ''
          cell.style.minWidth = ''
          cell.style.maxWidth = ''
          cell.style.overflow = ''
          cell.style.textOverflow = ''
          delete cell.dataset.ayarGenislik
        }
      }
      pos += span
    }
  }
}

export default function AyarliTablo({ children, ayarKey, className }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [cols, setCols] = useState<Col[]>([])

  const key = useMemo(() => {
    if (cols.length === 0) return null
    const base = tablePrefsKey(cols.map((c) => c.id))
    return ayarKey ? `${base}#${ayarKey}` : base
  }, [cols, ayarKey])
  const [prefs, setPrefs] = useTablePrefs(key)

  const hidden = useMemo(() => new Set((prefs.hidden ?? []).filter((id) => cols.some((c) => c.id === id))), [prefs.hidden, cols])
  const widths = useMemo(() => prefs.widths ?? {}, [prefs.widths])

  // En güncel değerler: gözlemci ve sürükleme bunları okur.
  const stateRef = useRef({ cols, hidden, widths })
  stateRef.current = { cols, hidden, widths }

  const tableOf = () => hostRef.current?.querySelector('table') as HTMLTableElement | null

  const apply = useCallback(() => {
    const table = tableOf()
    if (!table) return
    const s = stateRef.current
    applyToTable(table, s.cols, s.hidden, s.widths)
  }, [])

  // Başlıktan sütunları oku; tablo değiştikçe tekrar oku ve ayarı yeniden uygula.
  useLayoutEffect(() => {
    const host = hostRef.current
    if (!host) return
    let frame = 0
    const sync = () => {
      frame = 0
      const next = readColumns(tableOf())
      setCols((prev) =>
        prev.length === next.length && prev.every((c, i) => c.id === next[i].id && c.label === next[i].label) ? prev : next
      )
      apply()
    }
    sync()
    const obs = new MutationObserver(() => {
      if (!frame) frame = requestAnimationFrame(sync)
    })
    // Yalnız yapı ve metin: ayarın kendi stil değişiklikleri gözlemciyi yeniden tetiklemesin.
    obs.observe(host, { childList: true, subtree: true, characterData: true })
    return () => {
      obs.disconnect()
      if (frame) cancelAnimationFrame(frame)
    }
  }, [apply])

  useLayoutEffect(() => {
    apply()
  }, [apply, cols, hidden, widths])

  // Başlığın sağ kenarından sürükleyerek genişlik.
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let drag: { col: string; startX: number; startW: number } | null = null
    let lastCursorCell: HTMLElement | null = null

    const cellAt = (e: MouseEvent): { cell: HTMLTableCellElement; index: number } | null => {
      const row = headerRowOf(tableOf())
      const target = e.target as HTMLElement | null
      const cell = target?.closest('th,td') as HTMLTableCellElement | null
      if (!row || !cell || cell.parentElement !== row) return null
      let pos = 0
      for (const c of Array.from(row.cells)) {
        if (c === cell) return originalSpan(c) === 1 ? { cell, index: pos } : null
        pos += originalSpan(c)
      }
      return null
    }
    const nearEdge = (e: MouseEvent, cell: HTMLElement) => {
      const r = cell.getBoundingClientRect()
      return e.clientX >= r.right - RESIZE_EDGE && e.clientX <= r.right + 2
    }

    const onMove = (e: MouseEvent) => {
      if (drag) {
        const w = Math.max(MIN_COLUMN_WIDTH, Math.min(MAX_COLUMN_WIDTH, Math.round(drag.startW + e.clientX - drag.startX)))
        const s = stateRef.current
        const table = tableOf()
        if (table) applyToTable(table, s.cols, s.hidden, { ...s.widths, [drag.col]: w })
        return
      }
      const hit = cellAt(e)
      const edge = hit && nearEdge(e, hit.cell)
      if (lastCursorCell && lastCursorCell !== hit?.cell) {
        lastCursorCell.style.cursor = ''
        lastCursorCell = null
      }
      if (hit) {
        hit.cell.style.cursor = edge ? 'col-resize' : ''
        lastCursorCell = edge ? hit.cell : null
      }
    }
    const onDown = (e: MouseEvent) => {
      if (e.button !== 0) return
      const hit = cellAt(e)
      if (!hit || !nearEdge(e, hit.cell)) return
      const col = stateRef.current.cols[hit.index]
      if (!col) return
      e.preventDefault()
      e.stopPropagation()
      drag = { col: col.id, startX: e.clientX, startW: hit.cell.getBoundingClientRect().width }
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
    }
    const onUp = (e: MouseEvent) => {
      if (!drag) return
      const d = drag
      drag = null
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      const w = Math.max(MIN_COLUMN_WIDTH, Math.min(MAX_COLUMN_WIDTH, Math.round(d.startW + e.clientX - d.startX)))
      const s = stateRef.current
      setPrefs({ ...prefsRef.current, widths: { ...s.widths, [d.col]: w } })
    }
    // Sürükleme bırakılınca başlığa "tıklama" düşüp sıralama değişmesin.
    const onClick = (e: MouseEvent) => {
      const hit = cellAt(e)
      if (hit && nearEdge(e, hit.cell)) {
        e.preventDefault()
        e.stopPropagation()
      }
    }

    host.addEventListener('mousemove', onMove)
    host.addEventListener('mousedown', onDown, true)
    host.addEventListener('click', onClick, true)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      host.removeEventListener('mousemove', onMove)
      host.removeEventListener('mousedown', onDown, true)
      host.removeEventListener('click', onClick, true)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const prefsRef = useRef(prefs)
  prefsRef.current = prefs

  const settingsColumns: SettingsColumn[] = cols.map((c) => ({
    id: c.id,
    label: c.label,
    visible: !hidden.has(c.id),
    width: widths[c.id]
  }))

  const customized = hidden.size > 0 || Object.keys(widths).length > 0

  const save = (next: { hidden?: string[]; widths?: Record<string, number> }) => {
    setPrefs({ ...prefs, ...next })
  }

  return (
    <div ref={hostRef} className={className}>
      {children}
      {cols.length > 0 && (
        <div className="sticky left-0 flex items-center px-2 py-1.5 print:hidden" data-ayar-bar="1">
          <DataTableSettingsMenu
            columns={settingsColumns}
            customized={customized}
            allowReorder={false}
            onToggle={(id) => {
              const next = new Set(hidden)
              if (next.has(id)) next.delete(id)
              else next.add(id)
              save({ hidden: Array.from(next) })
            }}
            onMove={() => undefined}
            onWidth={(id, w) => {
              const next = { ...widths }
              if (w) next[id] = w
              else delete next[id]
              save({ widths: next })
            }}
            onShowAll={() => save({ hidden: [] })}
            onReset={() => setPrefs(null)}
          />
        </div>
      )}
    </div>
  )
}
