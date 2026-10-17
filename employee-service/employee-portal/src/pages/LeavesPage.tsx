import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { CalendarDays, Check, Plus, RefreshCw, Rows3, Scale, Search, X } from 'lucide-react'
import Layout from '../components/Layout'
import Modal from '../components/Modal'
import {
  LEAVE_TYPES,
  LEAVE_STATUSES,
  leaveTypeLabel,
  fetchLeavesInRange,
  fetchPendingLeaves,
  createEmployeeLeave,
  decideEmployeeLeave,
  deleteEmployeeLeave,
  earlyReturnEmployeeLeave,
  fetchLeaveBalances,
  type LeaveRangeDto,
  type PendingLeaveDto,
  type LeaveBalanceRowDto
} from '../api/employeeLeaves'
import { fetchEmployees, type EmployeeDto } from '../api/employees'
import AyarliTablo from '../components/table/AyarliTablo'

/** İzin türüne göre renk — takvimde ve listede aynı renk kullanılır. */
const TYPE_COLOR: Record<number, string> = {
  1: 'bg-sky-100 text-sky-900 border-sky-300',
  2: 'bg-violet-100 text-violet-900 border-violet-300',
  3: 'bg-slate-200 text-slate-800 border-slate-400',
  4: 'bg-rose-100 text-rose-900 border-rose-300',
  5: 'bg-pink-100 text-pink-900 border-pink-300',
  6: 'bg-amber-100 text-amber-900 border-amber-300',
  7: 'bg-neutral-200 text-neutral-800 border-neutral-400',
  99: 'bg-emerald-100 text-emerald-900 border-emerald-300'
}

const DAY_LABELS = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz']

function currentMonth(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function monthBounds(period: string): { from: string; to: string; first: Date; days: number } {
  const [y, m] = period.split('-').map(Number)
  const first = new Date(y, m - 1, 1)
  const days = new Date(y, m, 0).getDate()
  const pad = (n: number) => String(n).padStart(2, '0')
  return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(days)}`, first, days }
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function dmy(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('tr-TR')
}

/**
 * İzin Yönetimi — Çalışan Yönetimi'nden bağımsız, izne adanmış ekran.
 *
 * Üç parça: (1) onay bekleyen talepler, (2) ay takvimi — hangi gün kim izinli, (3) satır listesi.
 * Takvim "aynı gün kaç kişi yok" sorusunu bir bakışta cevaplar; liste ise arama ve tekil işlem
 * için. İkisi aynı veriden beslenir, ayrı sorgu yapmaz.
 */
export default function LeavesPage() {
  const [period, setPeriod] = useState(currentMonth)
  const [view, setView] = useState<'calendar' | 'list' | 'balance'>('calendar')
  const [balances, setBalances] = useState<LeaveBalanceRowDto[]>([])
  const [leaves, setLeaves] = useState<LeaveRangeDto[]>([])
  const [pending, setPending] = useState<PendingLeaveDto[]>([])
  const [employees, setEmployees] = useState<EmployeeDto[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  const [createOpen, setCreateOpen] = useState(false)

  /*
    İZİNDEN ERKEN DÖNÜŞ (2026-10-04 kullanıcı bildirimi: "izin alıp erken gelince yine izinli
    gösteriyordu"). Hakediş, izinli günde yapılan çalışmayı artık kendiliğinden çalışma sayıyor;
    bu pencere izin KAYDINI kısaltır ki yıllık izin bakiyesinden fazla gün düşmesin.
  */
  const [earlyReturn, setEarlyReturn] = useState<{ id: number; name: string; date: string; time: string; useFirstCheckIn: boolean } | null>(null)
  const [earlySaving, setEarlySaving] = useState(false)
  const [form, setForm] = useState({
    employeeId: '',
    start: ymd(new Date()),
    end: ymd(new Date()),
    leaveType: 1,
    description: '',
    approved: true
  })
  const [saving, setSaving] = useState(false)

  const bounds = useMemo(() => monthBounds(period), [period])

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true)
    setError(null)
    try {
      const [range, pend, bal] = await Promise.all([
        fetchLeavesInRange({ from: bounds.from, to: bounds.to, signal }),
        fetchPendingLeaves(signal),
        fetchLeaveBalances(Number(period.slice(0, 4)), signal).catch(() => [])
      ])
      setLeaves(range)
      setPending(pend)
      setBalances(bal)
    } catch (e: any) {
      if (e?.name === 'AbortError') return
      setError(String(e?.message ?? 'İzinler yüklenemedi'))
    } finally {
      setLoading(false)
    }
  }, [bounds.from, bounds.to, period])

  useEffect(() => {
    const ac = new AbortController()
    void load(ac.signal)
    return () => ac.abort()
  }, [load])

  useEffect(() => {
    if (!createOpen) return
    const ac = new AbortController()
    void fetchEmployees({ signal: ac.signal }).then((l) => setEmployees(l ?? [])).catch(() => setEmployees([]))
    return () => ac.abort()
  }, [createOpen])

  /** Gün -> o gün izinli olanlar. İzin aralığı gün gün açılır. */
  const byDay = useMemo(() => {
    const map: Record<string, LeaveRangeDto[]> = {}
    leaves.forEach((l) => {
      if (l.status === 3 || l.status === 4) return // reddedilen/iptal takvimde yer kaplamasın
      const s = new Date(l.leaveStartTime)
      const e = new Date(l.returnTime)
      for (let d = new Date(s.getFullYear(), s.getMonth(), s.getDate()); d <= e; d.setDate(d.getDate() + 1)) {
        const key = ymd(d)
        if (!key.startsWith(period)) continue
        ;(map[key] ??= []).push(l)
      }
    })
    return map
  }, [leaves, period])

  const filteredList = useMemo(() => {
    const q = search.trim().toLocaleLowerCase('tr-TR')
    if (!q) return leaves
    return leaves.filter((l) =>
      `${l.employeeName} ${l.employeeCode ?? ''} ${l.description ?? ''}`.toLocaleLowerCase('tr-TR').includes(q)
    )
  }, [leaves, search])

  const decide = async (id: number, approve: boolean) => {
    const reason = approve ? undefined : (window.prompt('Reddetme nedeni:') ?? '').trim() || undefined
    if (!approve && !reason) return
    try {
      await decideEmployeeLeave(id, approve, reason)
      setInfo(approve ? 'İzin onaylandı.' : 'İzin reddedildi.')
      await load()
    } catch (e: any) {
      setError(String(e?.message ?? 'İşlem yapılamadı'))
    }
  }

  const remove = async (id: number) => {
    if (!window.confirm('Bu izin kaydı silinsin mi?')) return
    try {
      await deleteEmployeeLeave(id)
      setInfo('İzin kaydı silindi.')
      await load()
    } catch (e: any) {
      setError(String(e?.message ?? 'Silinemedi'))
    }
  }

  const openEarlyReturn = (id: number, name: string) => {
    const now = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    setEarlyReturn({
      id,
      name,
      date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
      time: '08:00',
      useFirstCheckIn: true
    })
  }

  const submitEarlyReturn = async () => {
    if (!earlyReturn) return
    setEarlySaving(true)
    setError(null)
    try {
      // Tarayıcı saati yerel; ISO'ya çevrilince sunucuya UTC gider.
      const iso = earlyReturn.useFirstCheckIn
        ? null
        : new Date(`${earlyReturn.date}T${earlyReturn.time}:00`).toISOString()
      const res: any = await earlyReturnEmployeeLeave(earlyReturn.id, iso)
      setEarlyReturn(null)
      setInfo(String(res?.message ?? 'İzin erken dönüşle kapatıldı.'))
      await load()
    } catch (e: any) {
      setError(String(e?.message ?? 'Erken dönüş kaydedilemedi'))
    } finally {
      setEarlySaving(false)
    }
  }

  const submitCreate = async () => {
    const id = Number(form.employeeId)
    if (!id) { setError('Çalışan seçin.'); return }
    if (form.end < form.start) { setError('Dönüş tarihi başlangıçtan önce olamaz.'); return }

    setSaving(true)
    setError(null)
    try {
      await createEmployeeLeave({
        employeeId: id,
        leaveStartTime: `${form.start}T00:00:00Z`,
        // Dönüş günü de izne dahil olsun diye gün sonu gönderilir; sunucu öğleden sonrayı
        // dönüş gününü de sayacak şekilde yorumluyor.
        returnTime: `${form.end}T17:00:00Z`,
        leaveType: form.leaveType,
        description: form.description.trim() || undefined,
        status: form.approved ? 2 : 1
      })
      setCreateOpen(false)
      setForm((p) => ({ ...p, description: '' }))
      setInfo('İzin kaydı oluşturuldu.')
      await load()
    } catch (e: any) {
      setError(String(e?.message ?? 'İzin kaydedilemedi'))
    } finally {
      setSaving(false)
    }
  }

  const offset = (bounds.first.getDay() + 6) % 7

  return (
    <Layout>
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-neutral-900 flex items-center gap-2">
              <CalendarDays size={18} />
              İzin Yönetimi
            </h1>
            <p className="text-sm text-neutral-500 mt-1">
              Talepleri onayla, kimin ne zaman izinli olduğunu takvimde gör, yeni izin tanımla.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} className="input-base py-1.5" />
            <button type="button" onClick={() => void load()} className="btn-editorial" disabled={loading}>
              <RefreshCw size={13} className={loading ? 'animate-spin' : undefined} />
              Yenile
            </button>
            <button type="button" onClick={() => setCreateOpen(true)} className="btn-primary">
              <Plus size={13} />
              İzin Ver
            </button>
          </div>
        </div>

        {info && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900 flex items-center justify-between">
            <span>{info}</span>
            <button type="button" onClick={() => setInfo(null)} className="text-emerald-700 font-bold">Kapat</button>
          </div>
        )}
        {error && <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</div>}

        {/* Onay bekleyenler en üstte: ekranın asıl işi bu */}
        {pending.length > 0 && (
          <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-4">
            <div className="text-[11px] font-bold uppercase tracking-wider text-amber-800 mb-2">
              Onay Bekleyen Talepler ({pending.length})
            </div>
            <div className="space-y-2">
              {pending.map((p) => (
                <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white border border-amber-200 px-3 py-2">
                  <div className="text-sm">
                    <span className="font-bold text-neutral-900">{p.employeeName}</span>
                    <span className="text-neutral-500"> · {leaveTypeLabel(p.leaveType)} · </span>
                    <span className="text-neutral-700">{dmy(p.leaveStartTime)} → {dmy(p.returnTime)}</span>
                    <span className="text-neutral-500"> · {p.dayCount} gün</span>
                    {p.description ? <span className="text-neutral-400"> · {p.description}</span> : null}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => void decide(p.id, true)}
                      className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700"
                    >
                      <Check size={12} /> Onayla
                    </button>
                    <button
                      type="button"
                      onClick={() => void decide(p.id, false)}
                      className="inline-flex items-center gap-1 rounded-lg border border-rose-300 px-3 py-1.5 text-xs font-bold text-rose-700 hover:bg-rose-50"
                    >
                      <X size={12} /> Reddet
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setView('calendar')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold border ${
              view === 'calendar' ? 'bg-slate-900 text-white border-slate-900' : 'border-slate-300 text-slate-600'
            }`}
          >
            <CalendarDays size={13} /> Takvim
          </button>
          <button
            type="button"
            onClick={() => setView('balance')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold border ${
              view === 'balance' ? 'bg-slate-900 text-white border-slate-900' : 'border-slate-300 text-slate-600'
            }`}
          >
            <Scale size={13} /> Bakiyeler
          </button>
          <button
            type="button"
            onClick={() => setView('list')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold border ${
              view === 'list' ? 'bg-slate-900 text-white border-slate-900' : 'border-slate-300 text-slate-600'
            }`}
          >
            <Rows3 size={13} /> Liste
          </button>

          {view === 'list' && (
            <div className="relative ml-auto">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Personel veya açıklama ara"
                className="input-base pl-8 py-1.5 w-64"
              />
            </div>
          )}
        </div>

        {view === 'balance' ? (
          <div className="rounded-xl border border-ivory-300 bg-white overflow-hidden">
            <div className="overflow-x-auto">
              <AyarliTablo>
              <table className="w-full text-sm">
                <thead className="bg-ivory-100 text-[11px] uppercase tracking-wider text-neutral-500">
                  <tr>
                    <th className="px-3 py-2 text-left">Personel</th>
                    <th className="px-3 py-2 text-left">İşyeri</th>
                    <th className="px-3 py-2 text-right">Kıdem</th>
                    <th className="px-3 py-2 text-right">Hak Ediş</th>
                    <th className="px-3 py-2 text-right">Devir</th>
                    <th className="px-3 py-2 text-right">Toplam</th>
                    <th className="px-3 py-2 text-right">Kullanılan</th>
                    <th className="px-3 py-2 text-right">Bekleyen</th>
                    <th className="px-3 py-2 text-right">Kalan</th>
                  </tr>
                </thead>
                <tbody>
                  {balances.length === 0 ? (
                    <tr><td colSpan={9} className="px-3 py-6 text-center text-neutral-400">Bakiye bilgisi yok.</td></tr>
                  ) : (
                    balances.map((b) => (
                      <tr key={b.employeeId} className="border-t border-ivory-200 hover:bg-ivory-50">
                        <td className="px-3 py-2">
                          <div className="font-medium text-neutral-900">{b.employeeName}</div>
                          <div className="text-[11px] text-neutral-400">
                            {b.employeeCode ?? '-'}{b.isOverridden ? ' · elle tanımlı' : ''}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-neutral-500">{b.workplace ?? '-'}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{b.seniorityYears} yıl</td>
                        <td className="px-3 py-2 text-right tabular-nums">{b.entitlementDays}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-amber-800">
                          {b.carryOverDays > 0 ? `+${b.carryOverDays}` : '—'}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums font-bold">{b.totalEntitlementDays}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{b.usedDays}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-neutral-500">
                          {b.pendingDays > 0 ? b.pendingDays : '—'}
                        </td>
                        <td className={`px-3 py-2 text-right tabular-nums font-black ${
                          b.remainingDays <= 0 ? 'text-rose-700' : 'text-emerald-700'
                        }`}>
                          {b.remainingDays}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
              </AyarliTablo>
            </div>
            <div className="px-3 py-2 text-[11px] text-neutral-400 border-t border-ivory-200">
              Devir yalnızca sistemin izlediği yıllardan sayılır; sisteme geçmeden önceki
              kullanılmamış günler personel kartındaki manuel alandan girilir.
            </div>
          </div>
        ) : view === 'calendar' ? (
          <div className="rounded-xl border border-ivory-300 bg-white p-4">
            <div className="grid grid-cols-7 gap-1.5">
              {DAY_LABELS.map((l) => (
                <div key={l} className="text-[10px] text-neutral-400 text-center uppercase tracking-wider pb-1">{l}</div>
              ))}
              {Array.from({ length: offset }).map((_, i) => <div key={`pad-${i}`} />)}

              {Array.from({ length: bounds.days }).map((_, i) => {
                const day = new Date(bounds.first.getFullYear(), bounds.first.getMonth(), i + 1)
                const key = ymd(day)
                const items = byDay[key] ?? []
                return (
                  <div
                    key={key}
                    className={`min-h-[76px] rounded-md border p-1 text-[10px] ${
                      items.length > 0 ? 'border-slate-300 bg-slate-50' : 'border-ivory-200 bg-white'
                    }`}
                  >
                    <div className="font-bold text-neutral-700 leading-none mb-1">{i + 1}</div>
                    <div className="space-y-0.5">
                      {items.slice(0, 3).map((l) => (
                        <div
                          key={`${key}-${l.id}`}
                          title={`${l.employeeName} — ${leaveTypeLabel(l.leaveType)}${l.description ? ` · ${l.description}` : ''}`}
                          className={`truncate rounded border px-1 py-0.5 ${TYPE_COLOR[l.leaveType] ?? TYPE_COLOR[99]}`}
                        >
                          {l.employeeName}
                        </div>
                      ))}
                      {items.length > 3 ? (
                        <div className="text-neutral-400">+{items.length - 3} kişi</div>
                      ) : null}
                    </div>
                  </div>
                )
              })}
            </div>

            <div className="flex flex-wrap gap-3 mt-4 text-[11px] text-neutral-500">
              {LEAVE_TYPES.map((t) => (
                <span key={t.value} className="inline-flex items-center gap-1.5">
                  <span className={`w-3 h-3 rounded border ${TYPE_COLOR[t.value] ?? TYPE_COLOR[99]}`} />
                  {t.label}
                </span>
              ))}
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-ivory-300 bg-white overflow-hidden">
            <div className="overflow-x-auto">
              <AyarliTablo>
              <table className="w-full text-sm">
                <thead className="bg-ivory-100 text-[11px] uppercase tracking-wider text-neutral-500">
                  <tr>
                    <th className="px-3 py-2 text-left">Personel</th>
                    <th className="px-3 py-2 text-left">Tür</th>
                    <th className="px-3 py-2 text-left">Başlangıç</th>
                    <th className="px-3 py-2 text-left">Dönüş</th>
                    <th className="px-3 py-2 text-right">Gün</th>
                    <th className="px-3 py-2 text-left">Durum</th>
                    <th className="px-3 py-2 text-left">Açıklama</th>
                    <th className="px-3 py-2 text-right">İşlem</th>
                  </tr>
                </thead>
                <tbody>
                  {loading && filteredList.length === 0 ? (
                    <tr><td colSpan={8} className="px-3 py-6 text-center text-neutral-400">Yükleniyor...</td></tr>
                  ) : filteredList.length === 0 ? (
                    <tr><td colSpan={8} className="px-3 py-6 text-center text-neutral-400">Bu ayda izin kaydı yok.</td></tr>
                  ) : (
                    filteredList.map((l) => (
                      <tr key={l.id} className="border-t border-ivory-200 hover:bg-ivory-50">
                        <td className="px-3 py-2">
                          <div className="font-medium text-neutral-900">{l.employeeName}</div>
                          <div className="text-[11px] text-neutral-400">{l.employeeCode ?? '-'}</div>
                        </td>
                        <td className="px-3 py-2">
                          <span className={`rounded border px-2 py-0.5 text-[11px] ${TYPE_COLOR[l.leaveType] ?? TYPE_COLOR[99]}`}>
                            {leaveTypeLabel(l.leaveType)}
                          </span>
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">{dmy(l.leaveStartTime)}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{dmy(l.returnTime)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{l.dayCount}</td>
                        <td className="px-3 py-2 text-[11px]">
                          {LEAVE_STATUSES[l.status] ?? l.status}
                          {l.rejectReason ? <div className="text-rose-600">{l.rejectReason}</div> : null}
                        </td>
                        <td className="px-3 py-2 text-neutral-500">{l.description ?? '-'}</td>
                        <td className="px-3 py-2 text-right whitespace-nowrap">
                          {l.status === 1 ? (
                            <>
                              <button type="button" onClick={() => void decide(l.id, true)} className="px-2 py-0.5 rounded border border-emerald-300 text-emerald-700 text-xs font-bold hover:bg-emerald-50">
                                Onayla
                              </button>
                              <button type="button" onClick={() => void decide(l.id, false)} className="ml-1 px-2 py-0.5 rounded border border-rose-300 text-rose-700 text-xs font-bold hover:bg-rose-50">
                                Reddet
                              </button>
                            </>
                          ) : null}
                          {l.status === 2 && (
                            <button
                              type="button"
                              onClick={() => openEarlyReturn(l.id, l.employeeName)}
                              className="ml-1 px-2 py-0.5 rounded border border-sky-300 text-sky-700 text-xs font-bold hover:bg-sky-50"
                              title="Personel izinden erken döndüyse izni kısaltır, bakiyeyi düzeltir"
                            >
                              Erken Dönüş
                            </button>
                          )}
                          <button type="button" onClick={() => void remove(l.id)} className="ml-1 px-2 py-0.5 rounded border border-slate-300 text-slate-600 text-xs font-bold hover:bg-slate-100">
                            Sil
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
              </AyarliTablo>
            </div>
          </div>
        )}
      </div>

      <Modal isOpen={Boolean(earlyReturn)} onClose={() => setEarlyReturn(null)} title="İzinden Erken Dönüş">
        {earlyReturn && (
          <div className="space-y-4 text-sm">
            <div className="text-neutral-600">
              <b>{earlyReturn.name}</b> izninden erken döndü. İzin bu andan itibaren kapatılır ve izin gün sayısı
              yeniden hesaplanır.
            </div>
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="radio"
                checked={earlyReturn.useFirstCheckIn}
                onChange={() => setEarlyReturn((p) => (p ? { ...p, useFirstCheckIn: true } : p))}
                className="mt-1"
              />
              <span>
                <span className="font-medium text-neutral-900">İlk giriş kaydına göre</span>
                <span className="block text-[12px] text-neutral-500">İzin süresinde yaptığı ilk giriş (QR / yüz / elle) dönüş anı sayılır.</span>
              </span>
            </label>
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="radio"
                checked={!earlyReturn.useFirstCheckIn}
                onChange={() => setEarlyReturn((p) => (p ? { ...p, useFirstCheckIn: false } : p))}
                className="mt-1"
              />
              <span className="flex-1">
                <span className="font-medium text-neutral-900">Tarih ve saat seç</span>
                <span className="mt-2 flex gap-2">
                  <input
                    type="date"
                    value={earlyReturn.date}
                    disabled={earlyReturn.useFirstCheckIn}
                    onChange={(e) => setEarlyReturn((p) => (p ? { ...p, date: e.target.value } : p))}
                    className="input-base"
                  />
                  <input
                    type="time"
                    value={earlyReturn.time}
                    disabled={earlyReturn.useFirstCheckIn}
                    onChange={(e) => setEarlyReturn((p) => (p ? { ...p, time: e.target.value } : p))}
                    className="input-base"
                  />
                </span>
              </span>
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setEarlyReturn(null)} className="btn-editorial" disabled={earlySaving}>Vazgeç</button>
              <button type="button" onClick={() => void submitEarlyReturn()} className="btn-primary" disabled={earlySaving}>
                {earlySaving ? 'Kaydediliyor…' : 'İzni Kapat'}
              </button>
            </div>
          </div>
        )}
      </Modal>

      <Modal isOpen={createOpen} onClose={() => setCreateOpen(false)} title="İzin Ver">
        <div className="space-y-4">
          <div className="space-y-1">
            <label htmlFor="lv-emp" className="block text-[11px] uppercase tracking-wider text-neutral-400">Çalışan</label>
            <select
              id="lv-emp"
              value={form.employeeId}
              onChange={(e) => setForm((p) => ({ ...p, employeeId: e.target.value }))}
              className="input-base"
            >
              <option value="">Seçiniz...</option>
              {[...employees]
                .sort((a, b) => `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`, 'tr-TR'))
                .map((e) => (
                  <option key={e.id} value={String(e.id)}>{e.firstName} {e.lastName} — {e.employeeCode}</option>
                ))}
            </select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label htmlFor="lv-start" className="block text-[11px] uppercase tracking-wider text-neutral-400">Başlangıç</label>
              <input id="lv-start" type="date" value={form.start} onChange={(e) => setForm((p) => ({ ...p, start: e.target.value }))} className="input-base" />
            </div>
            <div className="space-y-1">
              <label htmlFor="lv-end" className="block text-[11px] uppercase tracking-wider text-neutral-400">Son Gün (dahil)</label>
              <input id="lv-end" type="date" value={form.end} onChange={(e) => setForm((p) => ({ ...p, end: e.target.value }))} className="input-base" />
            </div>
          </div>

          <div className="space-y-1">
            <label htmlFor="lv-type" className="block text-[11px] uppercase tracking-wider text-neutral-400">İzin Türü</label>
            <select
              id="lv-type"
              value={form.leaveType}
              onChange={(e) => setForm((p) => ({ ...p, leaveType: Number(e.target.value) }))}
              className="input-base"
            >
              {LEAVE_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}{t.paid ? '' : ' (ücretsiz)'}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label htmlFor="lv-desc" className="block text-[11px] uppercase tracking-wider text-neutral-400">Açıklama</label>
            <input id="lv-desc" value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} className="input-base" />
          </div>

          <label className="flex items-center gap-2 text-sm text-neutral-700">
            <input type="checkbox" checked={form.approved} onChange={(e) => setForm((p) => ({ ...p, approved: e.target.checked }))} />
            Doğrudan onaylı olarak kaydet
          </label>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-ivory-300">
            <button type="button" onClick={() => setCreateOpen(false)} className="btn-editorial" disabled={saving}>Vazgeç</button>
            <button type="button" onClick={() => void submitCreate()} className="btn-primary" disabled={saving}>
              {saving ? 'Kaydediliyor...' : 'İzni Kaydet'}
            </button>
          </div>
        </div>
      </Modal>
    </Layout>
  )
}
