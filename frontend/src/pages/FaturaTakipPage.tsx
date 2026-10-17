import { useCallback, useEffect, useMemo, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import {
  AlertTriangle,
  CalendarDays,
  Camera,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  History,
  Printer,
  RefreshCw,
  Truck,
  XCircle
} from 'lucide-react'
import Table, { type TableColumn } from '../components/Table'
import Modal from '../components/Modal'
import ActionDropdown, { type ActionDropdownItem } from '../components/ActionDropdown'
import NotificationPopup from '../components/NotificationPopup'
import {
  addTrackingNote,
  assignInvoices,
  completeInvoice,
  failInvoice,
  fetchRoute,
  fetchTrackingHistory,
  fetchTrackingList,
  fetchTrackingPhotoUrl,
  fetchTrackingSettings,
  fetchTrackingSummary,
  fetchTrackingTechnicians,
  reopenInvoice,
  unassignInvoices,
  uploadTrackingPhotos,
  type FieldTechnician,
  type RouteRow,
  type TrackingHistory,
  type TrackingRow,
  type TrackingSummary,
  type TrackingView
} from '../api/invoiceTracking'

type LayoutContext = {
  isSuperAdmin?: boolean
  isSuperSuperAdmin?: boolean
  allowedKeys?: Set<string>
}

/** Ekrandaki görünüm. "teslimEdilemeyen" sunucuda planlanmamış listesinin bir süzgeci. */
type ScreenView = TrackingView | 'teslimEdilemeyen'

const CURRENCY_SYMBOL: Record<number, string> = { 1: '₺', 2: '€', 3: '$', 4: '£' }

const EVENT_LABEL: Record<string, string> = {
  PLANLANDI: 'Planlandı',
  YENIDEN_PLANLANDI: 'Yeniden planlandı',
  PLAN_KALDIRILDI: 'Plan kaldırıldı',
  TESLIM_EDILDI: 'Teslim edildi',
  TESLIM_EDILEMEDI: 'Teslim edilemedi',
  DURUM_GERI_ALINDI: 'Durum geri alındı',
  NOT: 'Not'
}

/** Belge günleri sunucuda "firma günü 00:00, UTC türünde" tutuluyor; saat dilimine çevrilmeden okunur. */
const dayOf = (iso?: string | null) => (iso ? String(iso).slice(0, 10) : '')

const trDay = (iso?: string | null) => {
  const d = dayOf(iso)
  if (!d) return ''
  const [y, m, dd] = d.split('-')
  return `${dd}.${m}.${y}`
}

const trDateTime = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' }) : '')

const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

const money = (value: number, currencyTypeId: number) =>
  `${Number(value ?? 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${CURRENCY_SYMBOL[currencyTypeId] ?? '₺'}`

const escapeHtml = (s: unknown) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

function StatusBadge({ row }: { row: TrackingRow }) {
  if (row.status === 'TAMAMLANDI') {
    return <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">Tamamlandı</span>
  }
  if (row.status === 'OTOMATIK_TAMAMLANDI') {
    return (
      <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50/50 text-emerald-600 border border-emerald-100" title="Takip başlangıcından önce kaydedilmiş">
        Tamamlandı (otomatik)
      </span>
    )
  }
  if (row.status === 'PLANLANDI') {
    return row.isLate ? (
      <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-red-50 text-red-700 border border-red-200">Gecikti</span>
    ) : (
      <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-blue-50 text-blue-700 border border-blue-200">Planlandı</span>
    )
  }
  return (
    <div className="flex flex-col gap-0.5">
      <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-gray-100 text-gray-700 border border-gray-200 w-fit">Planlanmadı</span>
      {row.lastFailedDate && (
        <span className="text-[10px] font-semibold text-orange-700">{trDay(row.lastFailedDate)} teslim edilemedi</span>
      )}
    </div>
  )
}

type ActionKind = 'assign' | 'complete' | 'fail' | 'reopen' | 'note' | 'photo' | 'unassign'

export default function FaturaTakipPage() {
  const layout = useOutletContext<LayoutContext>()
  const isAdmin = Boolean(layout?.isSuperAdmin) || Boolean(layout?.isSuperSuperAdmin)
  const has = (key: string) => isAdmin || Boolean(layout?.allowedKeys?.has(`invoice/${key}`))
  const canPlan = has('faturaTakipPlanla')
  const canStatus = has('faturaTakipDurum')
  const canPrint = has('faturaTakipBasim')

  const [today, setToday] = useState<string>('')
  const [startDate, setStartDate] = useState<string>('')
  const [day, setDay] = useState<string>('')
  const [view, setView] = useState<ScreenView>('planlanmamis')
  const [technicianFilter, setTechnicianFilter] = useState<string>('')
  const [rangeFrom, setRangeFrom] = useState<string>('')
  const [rangeTo, setRangeTo] = useState<string>('')

  const [technicians, setTechnicians] = useState<FieldTechnician[]>([])
  const [technicianError, setTechnicianError] = useState<string | null>(null)

  const [rows, setRows] = useState<TrackingRow[]>([])
  const [summary, setSummary] = useState<TrackingSummary | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const [visibleRows, setVisibleRows] = useState<TrackingRow[]>([])

  const [bulkTechnician, setBulkTechnician] = useState('')
  const [bulkDay, setBulkDay] = useState('')
  const [bulkNote, setBulkNote] = useState('')
  const [busy, setBusy] = useState(false)

  const [action, setAction] = useState<{ kind: ActionKind; row: TrackingRow } | null>(null)
  const [actionNote, setActionNote] = useState('')
  const [actionTechnician, setActionTechnician] = useState('')
  const [actionDay, setActionDay] = useState('')
  const [actionFiles, setActionFiles] = useState<File[]>([])

  const [historyRow, setHistoryRow] = useState<TrackingRow | null>(null)
  const [history, setHistory] = useState<TrackingHistory | null>(null)
  const [photoUrls, setPhotoUrls] = useState<Record<number, string>>({})
  const [bigPhoto, setBigPhoto] = useState<string | null>(null)

  // İlk açılış: gün sunucunun firma gününden gelir; tarayıcı saatine güvenilmez.
  useEffect(() => {
    void (async () => {
      try {
        const s = await fetchTrackingSettings()
        const t = dayOf(s.today)
        setToday(t)
        setDay(t)
        setBulkDay(t)
        setStartDate(dayOf(s.startDate))
        setRangeFrom(addDays(t, -30))
        setRangeTo(t)
      } catch (e: any) {
        setError(String(e?.message ?? e))
      }
    })()

    void (async () => {
      try {
        setTechnicians(await fetchTrackingTechnicians())
        setTechnicianError(null)
      } catch (e: any) {
        setTechnicianError(String(e?.message ?? 'Teknisyen listesi alınamadı'))
      }
    })()
  }, [])

  const load = useCallback(async () => {
    if (!day) return
    setLoading(true)
    try {
      const serverView: TrackingView = view === 'teslimEdilemeyen' ? 'planlanmamis' : view
      const [list, sum] = await Promise.all([
        fetchTrackingList({
          view: serverView,
          date: day,
          from: view === 'tamamlanan' ? day : view === 'tumu' ? rangeFrom : undefined,
          to: view === 'tamamlanan' ? day : view === 'tumu' ? rangeTo : undefined,
          technicianId: technicianFilter || undefined,
          invoiceFrom: rangeFrom || undefined,
          invoiceTo: rangeTo || undefined
        }),
        fetchTrackingSummary({ date: day, technicianId: technicianFilter || undefined, invoiceFrom: rangeFrom || undefined, invoiceTo: rangeTo || undefined })
      ])
      setRows(view === 'teslimEdilemeyen' ? list.filter((r) => Boolean(r.lastFailedDate)) : list)
      setSummary(sum)
      setSelectedIds([])
    } catch (e: any) {
      setError(String(e?.message ?? e))
    } finally {
      setLoading(false)
    }
  }, [day, view, technicianFilter, rangeFrom, rangeTo])

  useEffect(() => {
    void load()
  }, [load])

  const run = async (fn: () => Promise<{ message?: string }>) => {
    setBusy(true)
    try {
      const res = await fn()
      setSuccess(res?.message || 'İşlem tamamlandı.')
      setAction(null)
      await load()
      return true
    } catch (e: any) {
      setError(String(e?.message ?? e))
      return false
    } finally {
      setBusy(false)
    }
  }

  const openAction = (kind: ActionKind, row: TrackingRow) => {
    setAction({ kind, row })
    setActionNote('')
    setActionFiles([])
    setActionTechnician(row.technicianId ?? '')
    setActionDay(dayOf(row.plannedDate) || day || today)
  }

  const submitAction = async () => {
    if (!action) return
    const { kind, row } = action
    if (kind === 'assign') {
      if (!actionTechnician) return setError('Teknisyen seçin.')
      if (!actionDay) return setError('Gün seçin.')
      await run(() => assignInvoices({ invoiceIds: [row.invoiceId], technicianId: actionTechnician, plannedDate: actionDay, note: actionNote || undefined }))
    } else if (kind === 'complete') {
      await run(async () => {
        const res = await completeInvoice(row.invoiceId, actionNote || undefined)
        if (actionFiles.length > 0) await uploadTrackingPhotos(row.invoiceId, actionFiles, 'Teslim görseli')
        return res
      })
    } else if (kind === 'fail') {
      if (!actionNote.trim()) return setError('Teslim edilememe nedenini yazın.')
      await run(async () => {
        const res = await failInvoice(row.invoiceId, actionNote)
        if (actionFiles.length > 0) await uploadTrackingPhotos(row.invoiceId, actionFiles, 'Teslim edilemedi görseli')
        return res
      })
    } else if (kind === 'reopen') {
      await run(() => reopenInvoice(row.invoiceId, actionNote || undefined))
    } else if (kind === 'unassign') {
      await run(() => unassignInvoices({ invoiceIds: [row.invoiceId], note: actionNote || undefined }))
    } else if (kind === 'note') {
      if (!actionNote.trim()) return setError('Not boş olamaz.')
      await run(() => addTrackingNote(row.invoiceId, actionNote))
    } else if (kind === 'photo') {
      if (actionFiles.length === 0) return setError('Görsel seçin.')
      await run(() => uploadTrackingPhotos(row.invoiceId, actionFiles, actionNote || undefined))
    }
  }

  const submitBulkAssign = async () => {
    if (selectedIds.length === 0) return
    if (!bulkTechnician) return setError('Teknisyen seçin.')
    if (!bulkDay) return setError('Gün seçin.')
    const ok = await run(() =>
      assignInvoices({ invoiceIds: selectedIds, technicianId: bulkTechnician, plannedDate: bulkDay, note: bulkNote || undefined })
    )
    if (ok) setBulkNote('')
  }

  const submitBulkUnassign = async () => {
    if (selectedIds.length === 0) return
    if (!window.confirm(`${selectedIds.length} faturanın planı kaldırılsın mı?`)) return
    await run(() => unassignInvoices({ invoiceIds: selectedIds }))
  }

  // ---- Geçmiş ----
  const openHistory = async (row: TrackingRow) => {
    setHistoryRow(row)
    setHistory(null)
    try {
      const h = await fetchTrackingHistory(row.invoiceId)
      setHistory(h)
      const urls: Record<number, string> = {}
      await Promise.all(
        h.photos.map(async (p) => {
          try {
            urls[p.id] = await fetchTrackingPhotoUrl(p.id)
          } catch {
            // tek görsel alınamazsa geçmişin geri kalanı yine gösterilir
          }
        })
      )
      setPhotoUrls((prev) => {
        Object.values(prev).forEach((u) => URL.revokeObjectURL(u))
        return urls
      })
    } catch (e: any) {
      setError(String(e?.message ?? e))
      setHistoryRow(null)
    }
  }

  // ---- Rota basımı ----
  const printRoute = async () => {
    try {
      const data = await fetchRoute({ date: day, technicianId: technicianFilter || undefined })
      if (data.rows.length === 0) {
        setError(`${trDay(day)} için rotada fatura yok.`)
        return
      }

      const groups = new Map<string, RouteRow[]>()
      data.rows.forEach((r) => {
        const key = r.technicianName || 'Teknisyen yok'
        groups.set(key, [...(groups.get(key) ?? []), r])
      })

      const sheet = (tech: string, list: RouteRow[]) => `
        <section class="sheet">
          <header>
            <div>
              <div class="title">GÜNLÜK FATURA ROTASI</div>
              <div class="meta">Tarih: <b>${escapeHtml(trDay(day))}</b> &nbsp;·&nbsp; Teknisyen: <b>${escapeHtml(tech)}</b> &nbsp;·&nbsp; ${list.length} fatura</div>
            </div>
            <img class="logo" src="/stilsoft-logo.png" alt="" />
          </header>
          <table>
            <thead>
              <tr>
                <th style="width:5%">#</th>
                <th style="width:13%">Fatura No</th>
                <th style="width:25%">Cari</th>
                <th style="width:27%">Adres / Telefon</th>
                <th style="width:11%" class="num">Tutar</th>
                <th style="width:19%">Teslim Alan / İmza</th>
              </tr>
            </thead>
            <tbody>
              ${list
                .map((r, i) => {
                  const failed = r.outcome === 'TESLIM_EDILEMEDI'
                  const done = r.outcome === 'TESLIM_EDILDI'
                  const mark = failed
                    ? `<div class="out fail">− Teslim edilemedi${r.movedTo ? ` → ${escapeHtml(trDay(r.movedTo))}` : ''}${r.outcomeNote ? `<br/><i>${escapeHtml(r.outcomeNote)}</i>` : ''}</div>`
                    : done
                      ? `<div class="out ok">✓ Teslim edildi</div>`
                      : ''
                  return `
                  <tr class="${failed ? 'failed' : ''}">
                    <td>${i + 1}</td>
                    <td><b>${escapeHtml(r.invoiceNo)}</b><div class="sub">${escapeHtml(r.typeLabel)} · ${escapeHtml(trDay(r.invoiceDate))}</div></td>
                    <td>${escapeHtml(r.customerName)}${r.lastNote && !failed ? `<div class="sub">Not: ${escapeHtml(r.lastNote)}</div>` : ''}</td>
                    <td>${escapeHtml(r.address ?? '')}<div class="sub">${escapeHtml(r.phone ?? '')}</div></td>
                    <td class="num">${escapeHtml(money(r.grandTotal, r.currencyTypeId))}</td>
                    <td>${mark}</td>
                  </tr>`
                })
                .join('')}
            </tbody>
          </table>
          <footer>Teslim eden: ______________________ &nbsp;&nbsp;&nbsp; İmza: ______________</footer>
        </section>`

      const html = `<!doctype html><html><head><meta charset="utf-8"/><title>Rota ${escapeHtml(trDay(day))}</title>
        <style>
          @page { size: A4; margin: 10mm; }
          * { box-sizing: border-box; }
          body { font-family: Arial, Helvetica, sans-serif; color: #111; margin: 0; }
          .sheet { page-break-after: always; }
          .sheet:last-child { page-break-after: auto; }
          header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #111; padding-bottom: 6px; margin-bottom: 8px; }
          .title { font-size: 16px; font-weight: 800; letter-spacing: .04em; }
          .meta { font-size: 11px; margin-top: 3px; }
          .logo { height: 34px; }
          table { width: 100%; border-collapse: collapse; table-layout: fixed; }
          th, td { border: 1px solid #999; padding: 4px 5px; font-size: 10px; vertical-align: top; overflow-wrap: anywhere; }
          th { background: #f1f1f1; text-align: left; font-size: 9.5px; text-transform: uppercase; }
          tr { page-break-inside: avoid; }
          td { height: 40px; }
          .num { text-align: right; white-space: nowrap; }
          .sub { color: #555; font-size: 9px; margin-top: 2px; }
          .out { font-weight: 700; font-size: 10px; }
          .out.fail { color: #b91c1c; }
          .out.ok { color: #047857; }
          tr.failed td { background: #fff5f5; }
          footer { margin-top: 14px; font-size: 11px; }
        </style></head><body>
        ${Array.from(groups.entries()).map(([tech, list]) => sheet(tech, list)).join('')}
        </body></html>`

      // about:blank sekmesi açılmıyor: orada /stilsoft-logo.png gibi kök yollar çözülmüyor.
      // srcdoc'lu iframe arayüzün kaynağını devralıyor.
      const frame = document.createElement('iframe')
      frame.style.position = 'fixed'
      frame.style.right = '0'
      frame.style.bottom = '0'
      frame.style.width = '0'
      frame.style.height = '0'
      frame.style.border = '0'
      frame.srcdoc = html
      frame.onload = () => {
        setTimeout(() => {
          frame.contentWindow?.focus()
          frame.contentWindow?.print()
          setTimeout(() => frame.remove(), 1500)
        }, 300)
      }
      document.body.appendChild(frame)
    } catch (e: any) {
      setError(String(e?.message ?? e))
    }
  }

  // ---- Tablo ----
  const tableData = useMemo(
    () => rows.map((r) => ({ ...r, __selected: selectedIds.includes(r.invoiceId), id: r.invoiceId })),
    [rows, selectedIds]
  )

  const selectable = canPlan

  const columns = useMemo<TableColumn<TrackingRow & { __selected: boolean }>[]>(() => {
    const cols: TableColumn<TrackingRow & { __selected: boolean }>[] = []

    if (selectable) {
      cols.push({
        key: '__selected',
        width: '38px',
        label: (
          <input
            type="checkbox"
            checked={visibleRows.length > 0 && visibleRows.every((r) => selectedIds.includes(r.invoiceId))}
            onChange={(e) => setSelectedIds(e.target.checked ? visibleRows.map((r) => r.invoiceId) : [])}
            onClick={(e) => e.stopPropagation()}
            title="Görünenlerin tümünü seç"
            className="w-4 h-4 rounded border-gray-300 cursor-pointer"
          />
        ),
        render: (_v, row) => (
          <input
            type="checkbox"
            checked={Boolean(row.__selected)}
            onChange={(e) => {
              const checked = e.target.checked
              setSelectedIds((prev) => {
                const s = new Set(prev)
                if (checked) s.add(row.invoiceId)
                else s.delete(row.invoiceId)
                return Array.from(s)
              })
            }}
            onClick={(e) => e.stopPropagation()}
            className="w-4 h-4 rounded border-gray-300 cursor-pointer"
          />
        )
      })
    }

    cols.push(
      {
        key: 'invoiceNo',
        label: 'Fatura No',
        render: (_v, r) => <span className="font-mono font-bold text-gray-900 whitespace-nowrap">{r.invoiceNo}</span>
      },
      {
        key: 'invoiceDate',
        label: 'Tarih',
        accessorFn: (r) => trDay(r.invoiceDate),
        filterValue: (r) => trDay(r.invoiceDate),
        render: (_v, r) => <span className="whitespace-nowrap">{trDay(r.invoiceDate)}</span>
      },
      {
        key: 'typeLabel',
        label: 'Tip',
        filter: { type: 'checkbox', options: ['SATIŞ', 'İADE', 'TAMİR', 'AÇIK'].map((x) => ({ label: x, value: x })) },
        render: (_v, r) => <span className="text-[11px] font-bold text-gray-600">{r.typeLabel}</span>
      },
      {
        key: 'customerName',
        label: 'Cari',
        render: (_v, r) => <span className="font-semibold text-gray-800">{r.customerName}</span>
      },
      {
        key: 'grandTotal',
        label: 'Tutar',
        render: (_v, r) => <span className="whitespace-nowrap font-semibold">{money(r.grandTotal, r.currencyTypeId)}</span>
      },
      {
        key: 'status',
        label: 'Durum',
        filterValue: (r) => r.status,
        render: (_v, r) => <StatusBadge row={r} />
      },
      {
        key: 'technicianName',
        label: 'Teknisyen',
        render: (_v, r) => <span className="whitespace-nowrap">{r.technicianName ?? (r.routeTechnicianName ? r.routeTechnicianName : '—')}</span>
      },
      {
        key: 'plannedDate',
        label: 'Plan Günü',
        accessorFn: (r) => trDay(r.plannedDate),
        filterValue: (r) => trDay(r.plannedDate),
        render: (_v, r) => <span className="whitespace-nowrap">{trDay(r.plannedDate) || '—'}</span>
      }
    )

    if (view === 'rota') {
      cols.push({
        key: 'routeOutcome',
        label: 'Günün Sonucu',
        render: (_v, r) =>
          r.routeOutcome === 'TESLIM_EDILDI' ? (
            <span className="text-[11px] font-bold text-emerald-700">✓ Teslim edildi</span>
          ) : r.routeOutcome === 'TESLIM_EDILEMEDI' ? (
            <span className="text-[11px] font-bold text-red-700" title={r.routeOutcomeNote ?? ''}>
              − Teslim edilemedi{r.routeOutcomeNote ? `: ${r.routeOutcomeNote}` : ''}
            </span>
          ) : (
            <span className="text-[11px] text-gray-400">Bekliyor</span>
          )
      })
    }

    cols.push(
      {
        key: 'photoCount',
        label: 'Görsel',
        render: (_v, r) =>
          r.photoCount > 0 ? (
            <button type="button" onClick={() => void openHistory(r)} className="inline-flex items-center gap-1 text-[11px] font-bold text-blue-700 hover:underline">
              <Camera size={13} /> {r.photoCount}
            </button>
          ) : (
            <span className="text-gray-300">—</span>
          )
      },
      {
        key: 'lastNote',
        label: 'Son Not',
        render: (_v, r) => <span className="text-[11px] text-gray-600 line-clamp-2" title={r.lastNote ?? ''}>{r.lastNote ?? ''}</span>
      },
      {
        key: 'actions',
        label: 'İşlemler',
        render: (_v, r) => {
          const done = r.status === 'TAMAMLANDI' || r.status === 'OTOMATIK_TAMAMLANDI'
          const btn = 'h-7 px-2 rounded-md border text-[11px] font-bold whitespace-nowrap transition inline-flex items-center gap-1'

          // Satır başına en sık iki iş görünür kalıyor; geri kalanı menüde. Hepsi görünür
          // olunca düğmeler beş satıra sarıyor ve 30 faturalık liste okunamıyordu.
          const menu: ActionDropdownItem[] = []
          if (canPlan && r.status === 'PLANLANDI') menu.push({ key: 'move', label: 'Değiştir / Başka Güne Al', onClick: () => openAction('assign', r) })
          if (canStatus && r.status === 'PLANLANDI') menu.push({ key: 'complete', label: '✓ Tamamlandı', onClick: () => openAction('complete', r) })
          if (canStatus && done) menu.push({ key: 'reopen', label: 'Durumu Geri Al', onClick: () => openAction('reopen', r) })
          if (canPlan && r.status === 'PLANLANDI') menu.push({ key: 'unassign', label: 'Planı Kaldır', onClick: () => openAction('unassign', r), danger: true })
          menu.push({ key: 'note', label: 'Not Ekle', onClick: () => openAction('note', r) })
          if (canStatus) menu.push({ key: 'photo', label: 'Görsel Ekle', onClick: () => openAction('photo', r) })
          menu.push({ key: 'history', label: 'Geçmiş', onClick: () => void openHistory(r) })

          return (
            <div className="flex items-center gap-1 whitespace-nowrap">
              {canPlan && r.status === 'PLANLANMADI' && (
                <button type="button" className={`${btn} border-blue-200 text-blue-700 hover:bg-blue-50`} onClick={() => openAction('assign', r)}>
                  Ata
                </button>
              )}
              {canStatus && r.status === 'PLANLANMADI' && (
                <button type="button" className={`${btn} border-emerald-200 text-emerald-700 hover:bg-emerald-50`} onClick={() => openAction('complete', r)} title="Tamamlandı (imzalı döndü)">
                  ✓
                </button>
              )}
              {canStatus && r.status === 'PLANLANDI' && (
                <>
                  <button type="button" className={`${btn} border-emerald-200 text-emerald-700 hover:bg-emerald-50`} onClick={() => openAction('complete', r)}>
                    ✓ Teslim
                  </button>
                  <button type="button" className={`${btn} border-red-200 text-red-700 hover:bg-red-50`} onClick={() => openAction('fail', r)}>
                    ✗ Edilemedi
                  </button>
                </>
              )}
              <ActionDropdown buttonLabel="" items={menu} />
            </div>
          )
        }
      }
    )

    return cols
  }, [selectable, visibleRows, selectedIds, view, canPlan, canStatus])

  const chip = (key: ScreenView, label: string, count: number | undefined, tone: string, icon: JSX.Element) => (
    <button
      type="button"
      onClick={() => setView(key)}
      className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-left transition ${
        view === key ? `${tone} ring-2 ring-offset-1 ring-gray-900/10` : 'bg-white border-gray-200 hover:border-gray-300'
      }`}
    >
      <span className="shrink-0">{icon}</span>
      <span className="flex flex-col leading-tight">
        <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">{label}</span>
        <span className="text-lg font-extrabold text-gray-900">{count ?? '—'}</span>
      </span>
    </button>
  )

  const actionTitle: Record<ActionKind, string> = {
    assign: 'Teknisyene Ata',
    complete: 'Tamamlandı (imzalı döndü)',
    fail: 'Teslim Edilemedi',
    reopen: 'Durumu Geri Al',
    note: 'Not Ekle',
    photo: 'Görsel Ekle',
    unassign: 'Planı Kaldır'
  }

  return (
    <div className="space-y-3">
      <NotificationPopup isOpen={Boolean(error)} variant="error" title="Hata" message={error ?? ''} onClose={() => setError(null)} />
      <NotificationPopup isOpen={Boolean(success)} variant="success" title="Başarılı" message={success ?? ''} onClose={() => setSuccess(null)} />

      {/* ÜST ŞERİT */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-blue-50 text-blue-700 border border-blue-200 flex items-center justify-center shrink-0">
            <Truck size={22} />
          </div>
          <div>
            <div className="text-base font-extrabold text-gray-900">Fatura Takip</div>
            <div className="text-xs text-gray-500">
              Kesilen faturaların teknisyenle müşteriye imzalatılıp geri getirilmesi.
              {startDate && <> Takip başlangıcı: <b>{trDay(startDate)}</b></>}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1">
            <button type="button" className="h-9 w-9 rounded-lg border border-gray-200 flex items-center justify-center hover:bg-gray-50" onClick={() => setDay(addDays(day, -1))} title="Önceki gün">
              <ChevronLeft size={16} />
            </button>
            <div className="relative">
              <CalendarDays size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              <input type="date" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} className="h-9 pl-8 pr-2 rounded-lg border border-gray-200 text-sm font-semibold" />
            </div>
            <button type="button" className="h-9 w-9 rounded-lg border border-gray-200 flex items-center justify-center hover:bg-gray-50" onClick={() => setDay(addDays(day, 1))} title="Sonraki gün">
              <ChevronRight size={16} />
            </button>
            {today && day !== today && (
              <button type="button" className="h-9 px-3 rounded-lg border border-gray-200 text-xs font-bold hover:bg-gray-50" onClick={() => setDay(today)}>
                Bugün
              </button>
            )}
          </div>

          {/*
            FATURA TARİHİ ARALIĞI (2026-10-11). Eskiden yalnız "Tümü" sekmesindeydi; artık üstte ve
            bütün sekmelere + sayaçlara uygulanıyor (sunucu: InvoiceTrackingService.InvoiceDateRange).
            Soldaki gün seçici ROTA/TAMAMLANAN günüdür, bu aralık FATURANIN tarihidir — ikisi ayrı.
          */}
          <div className={`flex items-center gap-1 h-9 px-2 rounded-lg border text-xs font-semibold ${rangeFrom || rangeTo ? 'border-blue-300 bg-blue-50' : 'border-gray-200'}`}>
            <span className="text-gray-500 whitespace-nowrap">Fatura tarihi</span>
            <input type="date" value={rangeFrom} max={rangeTo || undefined} onChange={(e) => setRangeFrom(e.target.value)} className="h-7 px-1 rounded border border-gray-200 bg-white" title="Başlangıç (boş = sınırsız)" />
            <span>—</span>
            <input type="date" value={rangeTo} min={rangeFrom || undefined} onChange={(e) => setRangeTo(e.target.value)} className="h-7 px-1 rounded border border-gray-200 bg-white" title="Bitiş (boş = sınırsız)" />
            {(rangeFrom || rangeTo) && (
              <button type="button" onClick={() => { setRangeFrom(''); setRangeTo('') }} className="ml-1 text-gray-500 hover:text-gray-900" title="Aralığı temizle">
                <XCircle size={14} />
              </button>
            )}
          </div>

          <select value={technicianFilter} onChange={(e) => setTechnicianFilter(e.target.value)} className="h-9 px-2 rounded-lg border border-gray-200 text-sm font-semibold min-w-[180px]">
            <option value="">Tüm teknisyenler</option>
            {technicians.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>

          {canPrint && (
            <button type="button" onClick={() => void printRoute()} className="h-9 px-3 rounded-lg bg-gray-900 text-white text-xs font-bold inline-flex items-center gap-1.5 hover:bg-black">
              <Printer size={14} /> Günün Rotasını Bas
            </button>
          )}
          <button type="button" onClick={() => void load()} className="h-9 w-9 rounded-lg border border-gray-200 flex items-center justify-center hover:bg-gray-50" title="Yenile">
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {technicianError && (
        <div className="flex items-start gap-2 p-3 rounded-xl border border-amber-200 bg-amber-50 text-amber-800 text-xs font-semibold">
          <AlertTriangle size={16} className="shrink-0 mt-0.5" />
          <span>{technicianError}</span>
        </div>
      )}

      {/* SAYAÇLAR */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2">
        {chip('planlanmamis', 'Planlanmamış', summary?.unplanned, 'bg-gray-50 border-gray-300', <ClipboardList size={20} className="text-gray-500" />)}
        {chip('rota', `Rota · ${trDay(day)}`, summary?.route, 'bg-blue-50 border-blue-300', <Truck size={20} className="text-blue-600" />)}
        {chip('geciken', 'Geciken', summary?.late, 'bg-red-50 border-red-300', <AlertTriangle size={20} className="text-red-600" />)}
        {chip('teslimEdilemeyen', 'Teslim Edilemeyen', summary?.failedWaiting, 'bg-orange-50 border-orange-300', <XCircle size={20} className="text-orange-600" />)}
        {chip('tamamlanan', `Tamamlanan · ${trDay(day)}`, summary?.completedOnDate, 'bg-emerald-50 border-emerald-300', <CheckCircle2 size={20} className="text-emerald-600" />)}
        {chip('tumu', 'Tümü', undefined, 'bg-slate-50 border-slate-300', <CalendarDays size={20} className="text-slate-500" />)}
      </div>

      {view === 'tumu' && !rangeFrom && !rangeTo && (
        <div className="text-[11px] text-gray-500 px-1">Tümü: aralık seçilmediği için son 30 günün faturaları listeleniyor.</div>
      )}

      {/* TOPLU ATAMA */}
      {canPlan && selectedIds.length > 0 && (
        <div className="sticky top-2 z-20 flex flex-wrap items-center gap-2 p-3 rounded-xl border border-blue-200 bg-blue-50 shadow-sm">
          <span className="text-xs font-extrabold text-blue-900">{selectedIds.length} fatura seçildi</span>
          <select value={bulkTechnician} onChange={(e) => setBulkTechnician(e.target.value)} className="h-9 px-2 rounded-lg border border-blue-200 text-sm font-semibold bg-white min-w-[180px]" disabled={technicians.length === 0}>
            <option value="">Teknisyen seçin</option>
            {technicians.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
          <input type="date" value={bulkDay} onChange={(e) => setBulkDay(e.target.value)} className="h-9 px-2 rounded-lg border border-blue-200 text-sm font-semibold bg-white" />
          <input type="text" value={bulkNote} onChange={(e) => setBulkNote(e.target.value)} placeholder="Not (isteğe bağlı)" className="h-9 px-3 rounded-lg border border-blue-200 text-sm bg-white flex-1 min-w-[160px]" maxLength={2000} />
          <button type="button" disabled={busy} onClick={() => void submitBulkAssign()} className="h-9 px-4 rounded-lg bg-blue-700 text-white text-xs font-bold hover:bg-blue-800 disabled:opacity-50">
            Ata
          </button>
          <button type="button" disabled={busy} onClick={() => void submitBulkUnassign()} className="h-9 px-3 rounded-lg border border-blue-200 bg-white text-blue-800 text-xs font-bold hover:bg-blue-100 disabled:opacity-50">
            Planı Kaldır
          </button>
          <button type="button" onClick={() => setSelectedIds([])} className="h-9 px-3 rounded-lg text-blue-800 text-xs font-bold hover:underline">
            Seçimi temizle
          </button>
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-xl shadow-sm">
        <Table
          columns={columns}
          data={tableData}
          rowKey={(r) => r.invoiceId}
          loading={loading}
          onRefresh={load}
          refreshing={loading}
          onFilteredDataChange={setVisibleRows}
          disableDateDefaultToday
          rowClassName={(r) => (r.isLate ? 'bg-red-50/40' : r.routeOutcome === 'TESLIM_EDILEMEDI' ? 'bg-orange-50/40' : '')}
        />
      </div>

      {/* SATIR İŞLEMİ */}
      <Modal isOpen={Boolean(action)} onClose={() => setAction(null)} title={action ? `${actionTitle[action.kind]} · ${action.row.invoiceNo}` : ''} maxWidth="max-w-lg" sizeKey="faturaTakipAction">
        {action && (
          <div className="space-y-3 text-sm">
            <div className="text-xs text-gray-600">
              <b>{action.row.customerName}</b> · {money(action.row.grandTotal, action.row.currencyTypeId)}
              {action.row.technicianName && <> · Şu an: <b>{action.row.technicianName}</b> ({trDay(action.row.plannedDate)})</>}
            </div>

            {action.kind === 'assign' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <label className="text-xs font-bold text-gray-600">
                  Teknisyen
                  <select value={actionTechnician} onChange={(e) => setActionTechnician(e.target.value)} className="mt-1 w-full h-9 px-2 rounded-lg border border-gray-200 text-sm" disabled={technicians.length === 0}>
                    <option value="">Seçin</option>
                    {technicians.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                </label>
                <label className="text-xs font-bold text-gray-600">
                  Gün
                  <input type="date" value={actionDay} onChange={(e) => setActionDay(e.target.value)} className="mt-1 w-full h-9 px-2 rounded-lg border border-gray-200 text-sm" />
                </label>
              </div>
            )}

            {action.kind === 'unassign' && <div className="text-xs text-gray-600">Fatura planlanmamış listesine döner.</div>}
            {action.kind === 'reopen' && <div className="text-xs text-gray-600">Fatura "Planlanmadı" durumuna döner ve yeniden atanabilir.</div>}
            {action.kind === 'fail' && <div className="text-xs text-gray-600">O günün rotasında "teslim edilemedi" olarak kalır, fatura planlama listesine döner.</div>}

            <label className="block text-xs font-bold text-gray-600">
              {action.kind === 'fail' ? 'Neden (zorunlu)' : 'Not'}
              <textarea value={actionNote} onChange={(e) => setActionNote(e.target.value)} rows={3} maxLength={2000} className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 text-sm" />
            </label>

            {(action.kind === 'complete' || action.kind === 'fail' || action.kind === 'photo') && (
              <label className="block text-xs font-bold text-gray-600">
                Görsel {action.kind === 'photo' ? '' : '(isteğe bağlı)'} · en fazla 5
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={(e) => setActionFiles(Array.from(e.target.files ?? []).slice(0, 5))}
                  className="mt-1 block w-full text-xs"
                />
              </label>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={() => setAction(null)} className="h-9 px-3 rounded-lg border border-gray-200 text-xs font-bold">
                Vazgeç
              </button>
              <button type="button" disabled={busy} onClick={() => void submitAction()} className="h-9 px-4 rounded-lg bg-gray-900 text-white text-xs font-bold disabled:opacity-50">
                {busy ? 'Kaydediliyor…' : 'Kaydet'}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* GEÇMİŞ */}
      <Modal isOpen={Boolean(historyRow)} onClose={() => setHistoryRow(null)} title={historyRow ? `Geçmiş · ${historyRow.invoiceNo}` : ''} maxWidth="max-w-2xl" scrollable sizeKey="faturaTakipHistory">
        {historyRow && (
          <div className="space-y-3">
            <div className="text-xs text-gray-600">
              <b>{historyRow.customerName}</b> · {money(historyRow.grandTotal, historyRow.currencyTypeId)} · <StatusBadge row={historyRow} />
            </div>
            {!history ? (
              <div className="text-xs text-gray-400">Yükleniyor…</div>
            ) : history.events.length === 0 ? (
              <div className="text-xs text-gray-500">Henüz bir işlem yok.</div>
            ) : (
              <ol className="relative border-l border-gray-200 ml-2 space-y-3">
                {history.events.map((ev) => (
                  <li key={ev.id} className="ml-4">
                    <span
                      className={`absolute -left-1.5 mt-1.5 w-3 h-3 rounded-full border-2 border-white ${
                        ev.eventType === 'TESLIM_EDILDI' ? 'bg-emerald-500' : ev.eventType === 'TESLIM_EDILEMEDI' ? 'bg-red-500' : 'bg-blue-400'
                      }`}
                    />
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="font-extrabold text-gray-900">{EVENT_LABEL[ev.eventType] ?? ev.eventType}</span>
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${ev.source === 'SERVIS' ? 'bg-purple-50 text-purple-700' : 'bg-gray-100 text-gray-600'}`}>
                        {ev.source === 'SERVIS' ? 'Servis' : 'B2B'}
                      </span>
                      <span className="text-gray-500">{ev.actor}</span>
                      <span className="text-gray-400">{trDateTime(ev.createdAt)}</span>
                    </div>
                    <div className="text-[11px] text-gray-600 mt-0.5">
                      {ev.technicianName && <>Teknisyen: <b>{ev.technicianName}</b> </>}
                      {ev.routeDate && <>· Rota: {trDay(ev.routeDate)} </>}
                      {ev.newPlannedDate && <>→ {trDay(ev.newPlannedDate)}</>}
                    </div>
                    {ev.note && <div className="mt-1 text-xs text-gray-800 bg-gray-50 border border-gray-100 rounded-lg px-2 py-1 whitespace-pre-line">{ev.note}</div>}
                    {ev.photoIds.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {ev.photoIds.map((pid) =>
                          photoUrls[pid] ? (
                            <button key={pid} type="button" onClick={() => setBigPhoto(photoUrls[pid])} className="w-20 h-20 rounded-lg overflow-hidden border border-gray-200 hover:ring-2 hover:ring-blue-300">
                              <img src={photoUrls[pid]} alt="" className="w-full h-full object-cover" />
                            </button>
                          ) : (
                            <div key={pid} className="w-20 h-20 rounded-lg bg-gray-100 border border-gray-200" />
                          )
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}
      </Modal>

      {bigPhoto && (
        <div className="fixed inset-0 z-[10001] bg-black/80 flex items-center justify-center p-4" onClick={() => setBigPhoto(null)}>
          <img src={bigPhoto} alt="" className="max-w-full max-h-full object-contain rounded-lg shadow-2xl" />
        </div>
      )}
    </div>
  )
}
