import { useCallback, useEffect, useMemo, useState } from 'react'
import { Camera, CheckCircle2, ChevronDown, History, MapPin, Phone, RefreshCw, X, XCircle } from 'lucide-react'
import { API_BASE_URL } from '../config'
import { apiFetch, apiJson } from '../api/client'
import { getAccessToken, getTenantCode } from '../auth/storage'
import { confirmStatusChangeAhead } from '../api/statusChangeGate'
import { usePermissions } from '../auth/PermissionsContext'
import GorselOnizleyici from '../components/GorselOnizleyici'

/**
 * FATURA TAKİP — teknisyen ekranı (2026-09-15).
 *
 * Ofis B2B'den faturayı teknisyene ve güne atar; teknisyen burada görür, müşteriye imzalatır ve
 * iki düğmeden birine basar: ✓ Teslim Edildi / ✗ Teslim Edilemedi. İkisinde de yorum ve görsel
 * eklenebilir (edilemedi için neden zorunlu). Kayıt B2B ERP'ye yazılır, ofis B2B'de görür.
 */

type FieldInvoice = {
  invoiceId: number
  invoiceNo: string
  invoiceDate: string
  typeLabel: string
  customerCode: string
  customerName: string
  phone?: string | null
  address?: string | null
  grandTotal: number
  currencyTypeId: number
  technicianId?: string | null
  technicianName?: string | null
  plannedDate?: string | null
  status: string
  outcome?: 'TESLIM_EDILDI' | 'TESLIM_EDILEMEDI' | null
  outcomeNote?: string | null
  outcomeAt?: string | null
  lastNote?: string | null
  photoCount: number
}

type HistoryEvent = {
  id: number
  eventType: string
  routeDate?: string | null
  newPlannedDate?: string | null
  technicianName?: string | null
  note?: string | null
  source: string
  actor: string
  createdAt: string
  photoIds: number[]
}

const EVENT_LABEL: Record<string, string> = {
  PLANLANDI: 'Planlandı',
  YENIDEN_PLANLANDI: 'Yeniden planlandı',
  PLAN_KALDIRILDI: 'Plan kaldırıldı',
  TESLIM_EDILDI: 'Teslim edildi',
  TESLIM_EDILEMEDI: 'Teslim edilemedi',
  DURUM_GERI_ALINDI: 'Durum geri alındı',
  NOT: 'Not'
}

const CURRENCY: Record<number, string> = { 1: '₺', 2: '€', 3: '$', 4: '£' }
const money = (v: number, c: number) =>
  `${Number(v ?? 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${CURRENCY[c] ?? '₺'}`

/** Belge günü "firma günü 00:00 UTC" olarak geliyor; saat dilimine çevrilmeden okunur. */
const dayOf = (iso?: string | null) => (iso ? String(iso).slice(0, 10) : '')
const trDay = (iso?: string | null) => {
  const d = dayOf(iso)
  if (!d) return ''
  const [y, m, dd] = d.split('-')
  return `${dd}.${m}.${y}`
}
const localToday = () => {
  const n = new Date()
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`
}

/**
 * Telefon fotoğrafı 4-8 MB; beş tanesi mobil veride dakikalar sürer. Yüklemeden önce en uzun
 * kenar 2000px'e indirilir — faturayı okumak için yeterli. Küçültülemeyen dosya olduğu gibi gider.
 */
async function shrinkImage(file: File): Promise<File> {
  if (!file.type.startsWith('image/') || file.size < 600_000) return file
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85))
    if (!blob) return file
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' })
  } catch {
    return file
  }
}

export default function FaturaTakipPage() {
  const { can, isSuperAdmin } = usePermissions()
  const canViewAll = isSuperAdmin || can('faturaTakip.tumIsleriGorme')

  const [rows, setRows] = useState<FieldInvoice[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [techFilter, setTechFilter] = useState('')

  const [sheet, setSheet] = useState<{ row: FieldInvoice; kind: 'deliver' | 'fail' } | null>(null)
  const [note, setNote] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [previews, setPreviews] = useState<string[]>([])
  const [saving, setSaving] = useState(false)

  const [historyRow, setHistoryRow] = useState<FieldInvoice | null>(null)
  const [historyEvents, setHistoryEvents] = useState<HistoryEvent[] | null>(null)
  const [photoUrls, setPhotoUrls] = useState<Record<number, string>>({})
  const [viewer, setViewer] = useState<{ urls: string[]; index: number } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await apiJson<{ data: FieldInvoice[]; message?: string }>('/api/invoice-tracking/list?daysAhead=7')
      setRows(res.data ?? [])
      setInfo(res.message ?? null)
    } catch (e: any) {
      setError(String(e?.message ?? 'Liste alınamadı'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const urls = files.map((f) => URL.createObjectURL(f))
    setPreviews(urls)
    return () => urls.forEach((u) => URL.revokeObjectURL(u))
  }, [files])

  const today = localToday()

  const filtered = useMemo(() => (techFilter ? rows.filter((r) => r.technicianName === techFilter) : rows), [rows, techFilter])
  const techNames = useMemo(() => Array.from(new Set(rows.map((r) => r.technicianName).filter(Boolean))) as string[], [rows])

  const open = filtered.filter((r) => !r.outcome && dayOf(r.plannedDate) <= today)
  const upcoming = filtered.filter((r) => !r.outcome && dayOf(r.plannedDate) > today)
  const done = filtered.filter((r) => r.outcome)

  const openSheet = (row: FieldInvoice, kind: 'deliver' | 'fail') => {
    setSheet({ row, kind })
    setNote('')
    setFiles([])
  }

  const submit = async () => {
    if (!sheet) return
    const { row, kind } = sheet
    if (kind === 'fail' && !note.trim()) {
      setError('Teslim edilememe nedenini yazın.')
      return
    }

    const gate = await confirmStatusChangeAhead({
      subject: `${row.invoiceNo} · ${row.customerName}`,
      kind: 'Fatura Takip',
      fromLabel: 'Planlandı',
      toLabel: kind === 'deliver' ? 'Teslim Edildi' : 'Teslim Edilemedi',
      hasPhoto: files.length > 0,
      photoCount: files.length,
      hasNote: Boolean(note.trim()),
      note: note.trim() || null
    })
    if (!gate.ok) return

    setSaving(true)
    try {
      const form = new FormData()
      form.append('note', note.trim())
      for (const f of files) form.append('files', await shrinkImage(f))

      const token = getAccessToken()
      const tenant = getTenantCode()
      // apiFetch gövdeyi JSON sayıp Content-Type'ı eziyor; çok parçalı gövde doğrudan gönderiliyor.
      const res = await fetch(`${API_BASE_URL}/api/invoice-tracking/${row.invoiceId}/${kind}`, {
        method: 'POST',
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(tenant ? { 'X-Tenant-Code': tenant } : {})
        },
        body: form
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.message || json?.detail || `Kaydedilemedi (${res.status})`)

      setSheet(null)
      await load()
    } catch (e: any) {
      setError(String(e?.message ?? e))
    } finally {
      gate.release()
      setSaving(false)
    }
  }

  const openHistory = async (row: FieldInvoice) => {
    setHistoryRow(row)
    setHistoryEvents(null)
    try {
      const res = await apiJson<{ data: { events: HistoryEvent[]; photos: Array<{ id: number }> } }>(`/api/invoice-tracking/${row.invoiceId}/history`)
      setHistoryEvents(res.data.events)
      const urls: Record<number, string> = {}
      await Promise.all(
        res.data.photos.map(async (p) => {
          try {
            const r = await apiFetch(`/api/invoice-tracking/photos/${p.id}`)
            if (r.ok) urls[p.id] = URL.createObjectURL(await r.blob())
          } catch {
            // tek görsel düşerse geçmiş yine gösterilir
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

  const card = (r: FieldInvoice) => {
    const late = !r.outcome && dayOf(r.plannedDate) < today
    return (
      <div key={`${r.invoiceId}-${r.outcome ?? ''}`} className={`rounded-2xl border bg-white dark:bg-gray-800 shadow-sm p-4 ${late ? 'border-red-300' : 'border-gray-100 dark:border-gray-700'}`}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[15px] font-extrabold text-gray-900 dark:text-white break-words">{r.customerName}</div>
            <div className="text-xs text-gray-500 mt-0.5">
              <span className="font-mono font-bold text-gray-700 dark:text-gray-300">{r.invoiceNo}</span> · {r.typeLabel} · {trDay(r.invoiceDate)}
            </div>
          </div>
          <div className="text-right shrink-0">
            <div className="text-sm font-extrabold text-gray-900 dark:text-white whitespace-nowrap">{money(r.grandTotal, r.currencyTypeId)}</div>
            <div className={`text-[11px] font-bold mt-0.5 ${late ? 'text-red-600' : 'text-gray-500'}`}>
              {late ? `Gecikti · ${trDay(r.plannedDate)}` : trDay(r.plannedDate)}
            </div>
          </div>
        </div>

        {canViewAll && r.technicianName && <div className="text-[11px] font-semibold text-indigo-600 mt-1">{r.technicianName}</div>}

        {(r.address || r.phone) && (
          <div className="mt-2 space-y-1 text-xs text-gray-600 dark:text-gray-300">
            {r.address && (
              <div className="flex items-start gap-1.5">
                <MapPin size={13} className="shrink-0 mt-0.5 text-gray-400" />
                <span className="break-words">{r.address}</span>
              </div>
            )}
            {r.phone && (
              <a href={`tel:${r.phone.replace(/[^\d+]/g, '')}`} className="inline-flex items-center gap-1.5 font-bold text-blue-600">
                <Phone size={13} /> {r.phone}
              </a>
            )}
          </div>
        )}

        {r.lastNote && !r.outcome && (
          <div className="mt-2 text-xs bg-amber-50 dark:bg-amber-900/20 text-amber-900 dark:text-amber-200 border border-amber-100 dark:border-amber-800 rounded-lg px-2.5 py-1.5 break-words">
            {r.lastNote}
          </div>
        )}

        {r.outcome ? (
          <div className={`mt-3 text-xs font-bold rounded-xl px-3 py-2 ${r.outcome === 'TESLIM_EDILDI' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
            {r.outcome === 'TESLIM_EDILDI' ? '✓ Teslim edildi' : '✗ Teslim edilemedi'}
            {r.outcomeNote && <span className="font-medium"> · {r.outcomeNote}</span>}
          </div>
        ) : (
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button type="button" onClick={() => openSheet(r, 'deliver')} className="h-12 rounded-xl bg-emerald-600 text-white font-extrabold text-sm inline-flex items-center justify-center gap-1.5 active:scale-[0.98]">
              <CheckCircle2 size={20} /> Teslim Edildi
            </button>
            <button type="button" onClick={() => openSheet(r, 'fail')} className="h-12 rounded-xl bg-red-600 text-white font-extrabold text-sm inline-flex items-center justify-center gap-1.5 active:scale-[0.98]">
              <XCircle size={20} /> Edilemedi
            </button>
          </div>
        )}

        <button type="button" onClick={() => void openHistory(r)} className="mt-2 inline-flex items-center gap-1 text-[11px] font-bold text-gray-500">
          <History size={13} /> Geçmiş{r.photoCount > 0 ? ` · ${r.photoCount} görsel` : ''}
        </button>
      </div>
    )
  }

  const section = (title: string, list: FieldInvoice[], defaultOpen = true) => (
    <details open={defaultOpen} className="group">
      <summary className="list-none cursor-pointer flex items-center justify-between py-2">
        <span className="text-xs font-extrabold uppercase tracking-wider text-gray-500">
          {title} <span className="text-gray-900 dark:text-white">({list.length})</span>
        </span>
        <ChevronDown size={16} className="text-gray-400 transition group-open:rotate-180" />
      </summary>
      {list.length === 0 ? <div className="text-xs text-gray-400 pb-2">Kayıt yok.</div> : <div className="space-y-3 pb-2">{list.map(card)}</div>}
    </details>
  )

  return (
    <div className="p-4 sm:p-5 max-w-3xl">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div>
          <h1 className="text-gray-900 dark:text-white font-bold text-lg leading-tight">Fatura Takip</h1>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Size atanan faturaları müşteriye imzalatın, sonucu işaretleyin.</p>
        </div>
        <button type="button" onClick={() => void load()} className="h-10 w-10 rounded-xl border border-gray-200 dark:border-gray-700 flex items-center justify-center" title="Yenile">
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {canViewAll && techNames.length > 0 && (
        <select value={techFilter} onChange={(e) => setTechFilter(e.target.value)} className="mb-3 w-full h-10 px-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm font-semibold">
          <option value="">Tüm teknisyenler</option>
          {techNames.map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
      )}

      {error && (
        <div className="mb-3 flex items-start justify-between gap-2 p-3 rounded-xl bg-red-50 text-red-700 text-xs font-semibold">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)}><X size={14} /></button>
        </div>
      )}
      {info && <div className="mb-3 p-3 rounded-xl bg-amber-50 text-amber-800 text-xs font-semibold">{info}</div>}

      {section('Bugün ve geciken', open)}
      {section('Yaklaşan', upcoming, false)}
      {section('Bugün sonuçlanan', done, false)}

      {/* ✓ / ✗ PENCERESİ */}
      {sheet && (
        <div className="fixed inset-0 z-[9000] bg-black/40 flex items-end sm:items-center justify-center" onClick={() => !saving && setSheet(null)}>
          <div className="w-full sm:max-w-md bg-white dark:bg-gray-900 rounded-t-3xl sm:rounded-2xl p-5 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-2">
              <div className={`text-base font-extrabold ${sheet.kind === 'deliver' ? 'text-emerald-700' : 'text-red-700'}`}>
                {sheet.kind === 'deliver' ? '✓ Teslim Edildi' : '✗ Teslim Edilemedi'}
              </div>
              <button type="button" onClick={() => !saving && setSheet(null)} className="p-1"><X size={18} /></button>
            </div>
            <div className="text-xs text-gray-600 dark:text-gray-300 mb-3">
              <b>{sheet.row.customerName}</b> · {sheet.row.invoiceNo}
            </div>

            <label className="block text-xs font-bold text-gray-600 dark:text-gray-300">
              {sheet.kind === 'fail' ? 'Neden (zorunlu)' : 'Yorum (isteğe bağlı)'}
              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={2000} className="mt-1 w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm" placeholder={sheet.kind === 'fail' ? 'Örn. müşteri adreste yoktu' : 'Örn. imzayı kapıcı aldı'} />
            </label>

            <div className="mt-3">
              <div className="text-xs font-bold text-gray-600 dark:text-gray-300 mb-1">Görsel (en fazla 5)</div>
              <label className="flex items-center justify-center gap-2 h-12 rounded-xl border-2 border-dashed border-gray-300 dark:border-gray-600 text-sm font-bold text-gray-600 dark:text-gray-300 cursor-pointer">
                <Camera size={18} /> Fotoğraf çek / seç
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    const picked = Array.from(e.target.files ?? [])
                    setFiles((prev) => [...prev, ...picked].slice(0, 5))
                    e.target.value = ''
                  }}
                />
              </label>
              {previews.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {previews.map((u, i) => (
                    <div key={u} className="relative w-20 h-20 rounded-lg overflow-hidden border border-gray-200">
                      <img src={u} alt="" className="w-full h-full object-cover" />
                      <button type="button" onClick={() => setFiles((prev) => prev.filter((_, idx) => idx !== i))} className="absolute top-0.5 right-0.5 w-6 h-6 rounded-full bg-black/60 text-white flex items-center justify-center">
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <button
              type="button"
              disabled={saving}
              onClick={() => void submit()}
              className={`mt-4 w-full h-12 rounded-xl text-white font-extrabold text-sm disabled:opacity-50 ${sheet.kind === 'deliver' ? 'bg-emerald-600' : 'bg-red-600'}`}
            >
              {saving ? 'Kaydediliyor…' : 'Kaydet'}
            </button>
          </div>
        </div>
      )}

      {/* GEÇMİŞ */}
      {historyRow && (
        <div className="fixed inset-0 z-[9000] bg-black/40 flex items-end sm:items-center justify-center" onClick={() => setHistoryRow(null)}>
          <div className="w-full sm:max-w-lg bg-white dark:bg-gray-900 rounded-t-3xl sm:rounded-2xl p-5 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <div className="text-base font-extrabold text-gray-900 dark:text-white">Geçmiş · {historyRow.invoiceNo}</div>
              <button type="button" onClick={() => setHistoryRow(null)} className="p-1"><X size={18} /></button>
            </div>
            {!historyEvents ? (
              <div className="text-xs text-gray-400">Yükleniyor…</div>
            ) : historyEvents.length === 0 ? (
              <div className="text-xs text-gray-500">Kayıt yok.</div>
            ) : (
              <ol className="space-y-3">
                {historyEvents.map((ev) => {
                  const urls = ev.photoIds.map((id) => photoUrls[id]).filter(Boolean)
                  return (
                    <li key={ev.id} className="border-l-2 border-gray-200 dark:border-gray-700 pl-3">
                      <div className="text-xs font-extrabold text-gray-900 dark:text-white">
                        {EVENT_LABEL[ev.eventType] ?? ev.eventType}
                        <span className="ml-1.5 font-semibold text-gray-400">{ev.source === 'SERVIS' ? 'Servis' : 'Ofis'}</span>
                      </div>
                      <div className="text-[11px] text-gray-500">
                        {ev.actor} · {new Date(ev.createdAt).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' })}
                        {ev.newPlannedDate && <> · Gün: {trDay(ev.newPlannedDate)}</>}
                      </div>
                      {ev.note && <div className="mt-1 text-xs text-gray-800 dark:text-gray-200 break-words">{ev.note}</div>}
                      {urls.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {urls.map((u, i) => (
                            <button key={u} type="button" onClick={() => setViewer({ urls, index: i })} className="w-16 h-16 rounded-lg overflow-hidden border border-gray-200">
                              <img src={u} alt="" className="w-full h-full object-cover" />
                            </button>
                          ))}
                        </div>
                      )}
                    </li>
                  )
                })}
              </ol>
            )}
          </div>
        </div>
      )}

      <GorselOnizleyici gorseller={viewer?.urls ?? []} acikIndex={viewer ? viewer.index : null} onKapat={() => setViewer(null)} />
    </div>
  )
}
