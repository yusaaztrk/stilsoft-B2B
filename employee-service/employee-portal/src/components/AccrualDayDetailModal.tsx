import React, { useCallback, useEffect, useMemo, useState } from 'react'
import Modal from './Modal'
import { money } from './PaymentReportView'
import { closeOpenCheckIns } from '../api/employeeCheckIns'
import {
  fetchAccrualDetail,
  fetchDailyOverrides,
  saveDailyOverride,
  deleteDailyOverride,
  formatMinutes,
  type AccrualDto,
  type DailyOverrideDto
} from '../api/employeeAccruals'
import AyarliTablo from './table/AyarliTablo'

/**
 * Bir personelin dönem içindeki GÜN GÜN hakediş dökümü.
 *
 * Hakediş dakika bazlı ilerler: her günün çalışılan dakikası o günün blok katsayılarıyla
 * değerlenir, gün kapandığında hakedişe eklenir ve ertesi gün sıfırdan sayılmaya başlar.
 * Bu ekran o zinciri gösterir — hangi gün kaç dakika çalışılmış, kaç TL değerlenmiş.
 *
 * Satırdaki "Düzelt" ile tek bir gün elle düzeltilebilir: dakika verilirse tutar dakika
 * ücretiyle yeniden hesaplanır (unutulan çıkış için doğru olan budur), tutar verilirse günün
 * TL değeri doğrudan o olur. Düzeltme yalnızca o günü etkiler.
 */
export default function AccrualDayDetailModal({
  isOpen,
  onClose,
  employeeId,
  employeeName,
  period,
  kind = 1,
  onSaved
}: {
  isOpen: boolean
  onClose: () => void
  employeeId: number | null
  employeeName: string
  period: string
  /** 1 = maaş, 2 = yemek */
  kind?: number
  onSaved?: () => void
}) {
  const [detail, setDetail] = useState<AccrualDto | null>(null)
  const [overrides, setOverrides] = useState<DailyOverrideDto[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [editDate, setEditDate] = useState<string | null>(null)
  const [editMinutes, setEditMinutes] = useState('')
  const [editAmount, setEditAmount] = useState('')
  const [editNote, setEditNote] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    if (!employeeId) return
    setLoading(true)
    setError(null)
    try {
      const [d, ov] = await Promise.all([
        fetchAccrualDetail(employeeId, period),
        fetchDailyOverrides(employeeId, period, kind)
      ])
      setDetail(d)
      setOverrides(ov)
    } catch (e: any) {
      setError(String(e?.message ?? 'Gün dökümü alınamadı'))
    } finally {
      setLoading(false)
    }
  }, [employeeId, period, kind])

  useEffect(() => {
    if (isOpen) void load()
  }, [isOpen, load])

  const overrideByDate = useMemo(() => {
    const m: Record<string, DailyOverrideDto> = {}
    overrides.forEach((o) => { m[o.date] = o })
    return m
  }, [overrides])

  const days = detail?.days ?? []

  const totals = useMemo(() => {
    return days.reduce(
      (acc, d) => ({
        expected: acc.expected + (d.expectedMinutes ?? 0),
        worked: acc.worked + (d.workedMinutes ?? 0),
        pay: acc.pay + (d.dayPay ?? 0)
      }),
      { expected: 0, worked: 0, pay: 0 }
    )
  }, [days])

  const startEdit = (date: string, workedMinutes: number, dayPay: number) => {
    const ov = overrideByDate[date]
    setEditDate(date)
    setEditMinutes(String(ov?.overrideMinutes ?? workedMinutes ?? 0))
    setEditAmount(ov?.overrideAmount != null ? String(ov.overrideAmount) : '')
    setEditNote(ov?.description ?? '')
  }

  const submitEdit = async () => {
    if (!employeeId || !editDate) return
    const mins = Number(String(editMinutes).replace(',', '.'))
    const amt = String(editAmount).trim() === '' ? null : Number(String(editAmount).replace(',', '.'))

    setSaving(true)
    setError(null)
    try {
      await saveDailyOverride({
        employeeId,
        date: editDate,
        kind,
        overrideMinutes: Number.isFinite(mins) ? Math.round(mins) : null,
        overrideAmount: amt != null && Number.isFinite(amt) ? amt : null,
        description: editNote.trim() || undefined
      })
      setEditDate(null)
      await load()
      onSaved?.()
    } catch (e: any) {
      setError(String(e?.message ?? 'Düzeltme kaydedilemedi'))
    } finally {
      setSaving(false)
    }
  }

  /** O günün açık kalan girişini mesai bitişiyle kapatır; gün yeniden değerlenir. */
  const closeOpenDay = async (date: string) => {
    if (!employeeId) return
    setSaving(true)
    setError(null)
    try {
      const res = await closeOpenCheckIns({ employeeIds: [employeeId], date })
      if (res.closedCount === 0) setError(res.message)
      await load()
      onSaved?.()
    } catch (e: any) {
      setError(String(e?.message ?? 'Açık giriş kapatılamadı'))
    } finally {
      setSaving(false)
    }
  }

  const removeOverride = async (date: string) => {
    if (!employeeId) return
    setSaving(true)
    try {
      await deleteDailyOverride(employeeId, date, kind)
      await load()
      onSaved?.()
    } catch (e: any) {
      setError(String(e?.message ?? 'Düzeltme kaldırılamadı'))
    } finally {
      setSaving(false)
    }
  }

  const dayLabel = (iso: string) => {
    const d = new Date(`${iso}T00:00:00`)
    if (Number.isNaN(d.getTime())) return iso
    return d.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', weekday: 'short' })
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Gün Gün Hakediş — ${employeeName}`}>
      <div className="space-y-3">
        <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-700">
          <strong>{period}</strong> dönemi. Hakediş dakika bazlı ilerler: her günün çalışılan dakikası
          o günün katsayılarıyla değerlenir, gün kapandığında hakedişe eklenir ve ertesi gün sıfırdan
          sayılmaya başlar.
          {detail?.minuteWage ? (
            <> Dakika ücreti: <strong>{money(detail.minuteWage)}</strong>.</>
          ) : null}
        </div>

        {error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50/60 p-3 text-sm text-rose-800">{error}</div>
        )}

        <div className="max-h-[52vh] overflow-y-auto rounded-xl border border-slate-200">
          <AyarliTablo>
          <table className="w-full text-xs">
            <thead className="bg-slate-100 sticky top-0 text-[10px] uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-2 py-2 text-left">Gün</th>
                <th className="px-2 py-2 text-right">Beklenen</th>
                <th className="px-2 py-2 text-right">Çalışılan</th>
                <th className="px-2 py-2 text-right">Değerlenen</th>
                <th className="px-2 py-2 text-left">Durum</th>
                <th className="px-2 py-2 text-right">İşlem</th>
              </tr>
            </thead>
            <tbody>
              {loading && days.length === 0 ? (
                <tr><td colSpan={6} className="px-2 py-6 text-center text-slate-400">Yükleniyor...</td></tr>
              ) : days.length === 0 ? (
                <tr><td colSpan={6} className="px-2 py-6 text-center text-slate-400">Bu dönemde gün kaydı yok.</td></tr>
              ) : (
                days.map((d) => {
                  const ov = overrideByDate[d.date]
                  const isEditing = editDate === d.date
                  return (
                    <React.Fragment key={d.date}>
                      <tr className={`border-t border-slate-100 ${ov ? 'bg-amber-50/60' : ''}`}>
                        <td className="px-2 py-1.5 whitespace-nowrap font-medium">{dayLabel(d.date)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-slate-500">
                          {formatMinutes(d.expectedMinutes)}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{formatMinutes(d.workedMinutes)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums font-bold">{money(d.dayPay ?? 0)}</td>
                        <td className="px-2 py-1.5 text-[11px]">
                          {ov ? <span className="text-amber-800 font-bold">Elle düzeltildi</span>
                            : d.isHoliday ? <span className="text-indigo-700">{d.holidayName || 'Tatil'}</span>
                            : d.isLeave ? <span className="text-blue-700">{d.isPaidLeave ? 'Ücretli izin' : 'Ücretsiz izin'}</span>
                            : d.hasOpenCheckIn ? <span className="text-rose-700">Çıkış yapılmamış</span>
                            : d.isAbsent ? <span className="text-rose-700">Gelmedi</span>
                            : d.isLate ? <span className="text-amber-700">Geç geldi</span>
                            : d.expectedMinutes > 0 ? <span className="text-slate-400">—</span>
                            : <span className="text-slate-300">Çalışma yok</span>}
                        </td>
                        <td className="px-2 py-1.5 text-right whitespace-nowrap">
                          {d.hasOpenCheckIn ? (
                            <button
                              type="button"
                              onClick={() => void closeOpenDay(d.date)}
                              disabled={saving}
                              className="mr-1 px-2 py-0.5 rounded border border-emerald-300 text-emerald-800 bg-emerald-50 hover:bg-emerald-100 font-bold"
                              title="Çıkış yapılmamış — mesai bitişiyle kapat"
                            >
                              Çıkışı kapat
                            </button>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => startEdit(d.date, d.workedMinutes ?? 0, d.dayPay ?? 0)}
                            className="px-2 py-0.5 rounded border border-slate-300 text-slate-700 hover:bg-slate-100 font-bold"
                          >
                            Düzelt
                          </button>
                          {ov ? (
                            <button
                              type="button"
                              onClick={() => void removeOverride(d.date)}
                              disabled={saving}
                              className="ml-1 px-2 py-0.5 rounded border border-rose-200 text-rose-700 hover:bg-rose-50 font-bold"
                            >
                              Geri al
                            </button>
                          ) : null}
                        </td>
                      </tr>

                      {isEditing && (
                        <tr className="bg-slate-50">
                          <td colSpan={6} className="px-3 py-2">
                            <div className="flex flex-wrap items-end gap-2">
                              <div className="space-y-1">
                                <label className="block text-[10px] uppercase text-slate-500">Çalışılan (dakika)</label>
                                <input
                                  value={editMinutes}
                                  inputMode="numeric"
                                  onChange={(e) => setEditMinutes(e.target.value.replace(/[^0-9]/g, ''))}
                                  className="input-base w-32"
                                />
                              </div>
                              <div className="space-y-1">
                                <label className="block text-[10px] uppercase text-slate-500">
                                  Tutar (₺) — boş bırakırsan dakikadan hesaplanır
                                </label>
                                <input
                                  value={editAmount}
                                  inputMode="decimal"
                                  placeholder="otomatik"
                                  onChange={(e) => setEditAmount(e.target.value.replace(/[^0-9.,]/g, ''))}
                                  className="input-base w-36"
                                />
                              </div>
                              <div className="space-y-1 flex-1 min-w-[140px]">
                                <label className="block text-[10px] uppercase text-slate-500">Açıklama</label>
                                <input
                                  value={editNote}
                                  onChange={(e) => setEditNote(e.target.value)}
                                  className="input-base"
                                  placeholder="Örn. çıkış yapmayı unuttu"
                                />
                              </div>
                              <button type="button" onClick={() => setEditDate(null)} className="btn-editorial" disabled={saving}>
                                Vazgeç
                              </button>
                              <button type="button" onClick={() => void submitEdit()} className="btn-primary" disabled={saving}>
                                {saving ? 'Kaydediliyor...' : 'Kaydet'}
                              </button>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  )
                })
              )}
            </tbody>
            {days.length > 0 && (
              <tfoot className="bg-slate-100 font-black sticky bottom-0">
                <tr className="border-t border-slate-300">
                  <td className="px-2 py-2">Toplam</td>
                  <td className="px-2 py-2 text-right tabular-nums">{formatMinutes(totals.expected)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{formatMinutes(totals.worked)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{money(totals.pay)}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            )}
          </table>
          </AyarliTablo>
        </div>

        <div className="flex items-center justify-end pt-2 border-t border-slate-200">
          <button type="button" onClick={onClose} className="btn-editorial">Kapat</button>
        </div>
      </div>
    </Modal>
  )
}
