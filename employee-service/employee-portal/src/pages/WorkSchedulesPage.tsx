import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Clock, Copy, Plus, RefreshCw, Trash2 } from 'lucide-react'
import Layout from '../components/Layout'
import Modal from '../components/Modal'
import NotificationPopup, { type NotificationVariant } from '../components/NotificationPopup'
import {
  clockToMinute,
  createSchedule,
  deleteSchedule,
  fetchSchedules,
  minuteToClock,
  minutesToText,
  updateSchedule,
  WEEK_DAYS,
  type ShiftBlockDto,
  type UpsertSchedulePayload,
  type WorkScheduleDto
} from '../api/workCalendar'

/**
 * Mesai tanımları — haftanın hangi saatlerinde çalışıldığı blok blok kurulur.
 *
 * Her blok bir gün + saat aralığı + ücret katsayısıdır. Hesap dakika bazlıdır: puantajda
 * çalışılan aralık hangi bloğa denk geliyorsa o bloğun katsayısıyla değerlenir, hiçbir bloğa
 * denk gelmeyen kısım fazla mesai sayılır.
 */

const EMPTY_SCHEDULE: UpsertSchedulePayload = {
  name: '',
  mondayMinutes: 0,
  tuesdayMinutes: 0,
  wednesdayMinutes: 0,
  thursdayMinutes: 0,
  fridayMinutes: 0,
  saturdayMinutes: 0,
  sundayMinutes: 0,
  breakMinutes: 60,
  startTimeMinutes: 540,
  lateToleranceMinutes: 15,
  earlyLeaveToleranceMinutes: 15,
  overtimeMultiplier: 1.5,
  countHolidaysAsWorkDay: false,
  isDefault: false,
  isActive: true,
  blocks: []
}

/**
 * Yeni tanımda başlangıç noktası: Pzt–Cum TEK blok 08:00–17:00 (2026-10-16 kullanıcı isteği: "öğleden
 * önce / öğleden sonra muhabbeti yok, tek gün olsa kafi"). Öğle arası bloğu bölmek yerine "Mola (dk)"
 * alanından düşülür (varsayılan 60 dk → günde 8 saat).
 */
function defaultBlocks(): ShiftBlockDto[] {
  const out: ShiftBlockDto[] = []
  for (const day of [1, 2, 3, 4, 5]) {
    out.push({ dayOfWeek: day, startMinute: 480, endMinute: 1020, payMultiplier: 1, label: 'Mesai' })
  }
  return out
}

function multiplierBadge(multiplier: number): string {
  if (multiplier > 1) return 'badge-amber'
  if (multiplier < 1) return 'badge-navy'
  return 'badge-editorial'
}

export default function WorkSchedulesPage() {
  const [schedules, setSchedules] = useState<WorkScheduleDto[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [popup, setPopup] = useState<{ variant: NotificationVariant; title: string; message: string } | null>(null)

  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState<UpsertSchedulePayload>(EMPTY_SCHEDULE)

  const notify = (variant: NotificationVariant, title: string, message: string) => setPopup({ variant, title, message })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setSchedules(await fetchSchedules())
    } catch (e: any) {
      notify('error', 'Hata', String(e?.message ?? 'Mesai tanımları alınamadı'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const openCreate = () => {
    setEditingId(null)
    setForm({ ...EMPTY_SCHEDULE, isDefault: schedules.length === 0, blocks: defaultBlocks() })
    setModalOpen(true)
  }

  const openEdit = (schedule: WorkScheduleDto) => {
    setEditingId(schedule.id)
    const { id, weeklyMinutes, weightedWeeklyMinutes, ...rest } = schedule
    setForm({ ...rest, blocks: (schedule.blocks ?? []).map((b) => ({ ...b })) })
    setModalOpen(true)
  }

  const addBlock = (dayOfWeek: number) => {
    setForm((p) => {
      const dayBlocks = p.blocks.filter((b) => b.dayOfWeek === dayOfWeek).sort((a, b) => a.startMinute - b.startMinute)
      const last = dayBlocks[dayBlocks.length - 1]

      // Yeni blok, o günün son bloğunun bitiminden bir saat sonra başlar; boş günde 08:00.
      const start = last ? Math.min(1380, last.endMinute % 1440 + 60) : 480

      return {
        ...p,
        // Boş güne eklenen blok tam gün (08:00–17:00, "Mesai"); dolu güne eklenen ek blok 4 saat.
        blocks: [
          ...p.blocks,
          last
            ? { dayOfWeek, startMinute: start, endMinute: Math.min(1440, start + 240), payMultiplier: 1, label: '' }
            : { dayOfWeek, startMinute: 480, endMinute: 1020, payMultiplier: 1, label: 'Mesai' }
        ]
      }
    })
  }

  const updateBlock = (index: number, patch: Partial<ShiftBlockDto>) => {
    setForm((p) => ({
      ...p,
      blocks: p.blocks.map((b, i) => (i === index ? { ...b, ...patch } : b))
    }))
  }

  const removeBlock = (index: number) => {
    setForm((p) => ({ ...p, blocks: p.blocks.filter((_, i) => i !== index) }))
  }

  /** Bir günün bloklarını başka güne kopyalar — haftayı kurmanın en hızlı yolu. */
  const copyDay = (fromDay: number, toDay: number) => {
    setForm((p) => {
      const source = p.blocks.filter((b) => b.dayOfWeek === fromDay)
      const rest = p.blocks.filter((b) => b.dayOfWeek !== toDay)
      return { ...p, blocks: [...rest, ...source.map((b) => ({ ...b, id: undefined, dayOfWeek: toDay }))] }
    })
  }

  const formTotals = useMemo(() => {
    const total = form.blocks.reduce((sum, b) => sum + Math.max(0, b.endMinute - b.startMinute), 0)
    const weighted = form.blocks.reduce(
      (sum, b) => sum + Math.max(0, b.endMinute - b.startMinute) * (Number(b.payMultiplier) || 1),
      0
    )
    return { total, weighted }
  }, [form.blocks])

  const save = async () => {
    if (!form.name.trim()) {
      notify('warning', 'Eksik bilgi', 'Mesai tanımına bir ad verin.')
      return
    }

    if (form.blocks.length === 0) {
      notify('warning', 'Blok yok', 'En az bir mesai bloğu ekleyin; aksi hâlde bu tanımda hiç iş günü olmaz.')
      return
    }

    setSaving(true)
    try {
      const payload: UpsertSchedulePayload = {
        ...form,
        blocks: form.blocks.map((b) => ({
          dayOfWeek: b.dayOfWeek,
          startMinute: b.startMinute,
          endMinute: b.endMinute,
          payMultiplier: Number(b.payMultiplier) || 1,
          label: b.label?.trim() || null
        }))
      }

      if (editingId) await updateSchedule(editingId, payload)
      else await createSchedule(payload)

      setModalOpen(false)
      await load()
      notify('success', 'Kaydedildi', 'Mesai tanımı güncellendi. Puantaj ve hakediş bu tanıma göre hesaplanır.')
    } catch (e: any) {
      notify('error', 'Kaydedilemedi', String(e?.message ?? 'Mesai tanımı kaydedilemedi'))
    } finally {
      setSaving(false)
    }
  }

  const remove = async (schedule: WorkScheduleDto) => {
    try {
      await deleteSchedule(schedule.id)
      await load()
      notify('success', 'Silindi', `"${schedule.name}" tanımı silindi.`)
    } catch (e: any) {
      notify('error', 'Silinemedi', String(e?.message ?? 'Mesai tanımı silinemedi'))
    }
  }

  return (
    <Layout>
      <div className="space-y-6 pb-12">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 pt-2">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 text-[10px] tracking-[0.22em] text-bronze-700 font-semibold uppercase">
              <span>TANIMLAR</span>
              <span className="text-bronze-300">•</span>
              <span>DAKİKA BAZLI</span>
            </div>
            <h1 className="font-serif text-3xl md:text-4xl text-obsidian-850 font-normal tracking-tight">
              Mesai Tanımları
            </h1>
            <p className="text-xs text-neutral-500 max-w-2xl">
              Haftanın hangi saatlerinde çalışıldığını blok blok belirleyin. Her bloğun kendi ücret
              katsayısı olur; puantaj çalışılan dakikayı ilgili bloğa denk getirip o katsayıyla değerler.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button type="button" onClick={() => void load()} className="btn-editorial">
              <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
              <span>Yenile</span>
            </button>
            <button type="button" onClick={openCreate} className="btn-editorial-primary">
              <Plus size={13} />
              <span>Mesai Tanımı</span>
            </button>
          </div>
        </div>

        {schedules.length === 0 && !loading && (
          <div className="card shadow-card p-10 text-center text-sm text-neutral-500">
            Henüz mesai tanımı yok. "Mesai Tanımı" ile başlayın.
          </div>
        )}

        <div className="space-y-4">
          {schedules.map((schedule) => {
            const byDay = WEEK_DAYS.map((d) => ({
              ...d,
              blocks: (schedule.blocks ?? [])
                .filter((b) => b.dayOfWeek === d.value)
                .sort((a, b) => a.startMinute - b.startMinute)
            }))

            return (
              <div key={schedule.id} className="card shadow-card p-5">
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-ivory-300 pb-3 mb-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="font-serif text-xl text-obsidian-850">{schedule.name}</h2>
                      {schedule.isDefault && <span className="badge-editorial">VARSAYILAN</span>}
                      {!schedule.isActive && <span className="badge-rose">PASİF</span>}
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-neutral-500 mt-1.5">
                      <span>Haftalık {minutesToText(schedule.weeklyMinutes)}</span>
                      {(schedule.weightedWeeklyMinutes ?? 0) > schedule.weeklyMinutes && (
                        <span className="text-bronze-700">
                          Ücret ağırlıklı {minutesToText(schedule.weightedWeeklyMinutes ?? 0)}
                        </span>
                      )}
                      <span>Tolerans {schedule.lateToleranceMinutes}/{schedule.earlyLeaveToleranceMinutes} dk</span>
                      <span>Fazla mesai ×{schedule.overtimeMultiplier}</span>
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <button type="button" onClick={() => openEdit(schedule)} className="btn-editorial">
                      Düzenle
                    </button>
                    <button
                      type="button"
                      onClick={() => void remove(schedule)}
                      className="btn-danger"
                      aria-label={`${schedule.name} tanımını sil`}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7 gap-2.5">
                  {byDay.map((day) => (
                    <div
                      key={day.value}
                      className={`rounded-lg border p-2.5 ${
                        day.blocks.length > 0 ? 'border-ivory-300 bg-white' : 'border-ivory-200 bg-ivory-100'
                      }`}
                    >
                      <div className="text-[10px] uppercase tracking-wider text-neutral-400 mb-1.5">{day.short}</div>

                      {day.blocks.length === 0 && <div className="text-[11px] text-neutral-400">tatil</div>}

                      <div className="space-y-1.5">
                        {day.blocks.map((b, i) => (
                          <div key={i} className="text-[11px]">
                            <div className="text-obsidian-850 font-medium">
                              {minuteToClock(b.startMinute)}–{minuteToClock(b.endMinute)}
                            </div>
                            <div className="flex items-center gap-1 mt-0.5">
                              {b.payMultiplier !== 1 && (
                                <span className={multiplierBadge(b.payMultiplier)}>×{b.payMultiplier}</span>
                              )}
                              {b.label && <span className="text-neutral-400 truncate">{b.label}</span>}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingId ? 'Mesai Tanımını Düzenle' : 'Yeni Mesai Tanımı'}
      >
        <div className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="schedule-name" className="block text-[11px] text-neutral-500 mb-1">Tanım adı</label>
              <input
                id="schedule-name"
                className="input-base"
                value={form.name}
                onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                placeholder="Ofis Mesaisi / Gece Vardiyası"
              />
            </div>
            <div>
              <label htmlFor="schedule-overtime" className="block text-[11px] text-neutral-500 mb-1">
                Plan dışı çalışma katsayısı
              </label>
              <input
                id="schedule-overtime"
                type="number"
                min={1}
                max={5}
                step={0.25}
                className="input-base"
                value={form.overtimeMultiplier}
                onChange={(e) => setForm((p) => ({ ...p, overtimeMultiplier: Number(e.target.value) || 1.5 }))}
              />
              <p className="text-[10px] text-neutral-400 mt-1">Hiçbir bloğa denk gelmeyen mesai. Kanuni asgari 1,50.</p>
            </div>
            <div>
              <label htmlFor="schedule-tolerance" className="block text-[11px] text-neutral-500 mb-1">
                Geç kalma toleransı (dk)
              </label>
              <input
                id="schedule-tolerance"
                type="number"
                min={0}
                max={480}
                className="input-base"
                value={form.lateToleranceMinutes}
                onChange={(e) => setForm((p) => ({ ...p, lateToleranceMinutes: Number(e.target.value) || 0 }))}
              />
              <p className="text-[10px] text-neutral-400 mt-1">
                Mesai başlangıcından bu kadar sonra gelen tam saatinde gelmiş sayılır; hakedişten
                dakika kesilmez.
              </p>
            </div>
            <div>
              <label htmlFor="schedule-exit-tolerance" className="block text-[11px] text-neutral-500 mb-1">
                Erken çıkma toleransı (dk)
              </label>
              <input
                id="schedule-exit-tolerance"
                type="number"
                min={0}
                max={480}
                className="input-base"
                value={form.earlyLeaveToleranceMinutes}
                onChange={(e) => setForm((p) => ({ ...p, earlyLeaveToleranceMinutes: Number(e.target.value) || 0 }))}
              />
              <p className="text-[10px] text-neutral-400 mt-1">
                Mesai bitişinden bu kadar önce çıkan tam saatinde çıkmış sayılır.
              </p>
            </div>
            <div>
              <label htmlFor="schedule-break" className="block text-[11px] text-neutral-500 mb-1">Mola (dk)</label>
              <input
                id="schedule-break"
                type="number"
                min={0}
                max={480}
                className="input-base"
                value={form.breakMinutes}
                onChange={(e) => setForm((p) => ({ ...p, breakMinutes: Number(e.target.value) || 0 }))}
              />
              <p className="text-[10px] text-neutral-400 mt-1">Blokları araya boşluk bırakarak kurduysanız 0 yapın.</p>
            </div>
          </div>

          {/* Haftalık blok editörü */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <h4 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-bronze-700">
                Haftalık Mesai Blokları
              </h4>
              <span className="text-[11px] text-neutral-500">
                Toplam {minutesToText(formTotals.total)}
                {formTotals.weighted !== formTotals.total && (
                  <span className="text-bronze-700"> · ücret ağırlıklı {minutesToText(formTotals.weighted)}</span>
                )}
              </span>
            </div>

            {WEEK_DAYS.map((day) => {
              const indexed = form.blocks
                .map((b, index) => ({ b, index }))
                .filter((x) => x.b.dayOfWeek === day.value)
                .sort((a, b) => a.b.startMinute - b.b.startMinute)

              const dayTotal = indexed.reduce((sum, x) => sum + Math.max(0, x.b.endMinute - x.b.startMinute), 0)

              return (
                <div key={day.value} className="rounded-lg border border-ivory-300 p-3">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-baseline gap-2">
                      <span className="text-xs font-medium text-obsidian-850">{day.long}</span>
                      <span className="text-[10px] text-neutral-400">
                        {dayTotal > 0 ? minutesToText(dayTotal) : 'çalışılmıyor'}
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5">
                      {indexed.length > 0 && (
                        <select
                          className="h-[26px] text-[10px] rounded border border-ivory-300 bg-white px-1.5 text-neutral-600"
                          value=""
                          onChange={(e) => {
                            const target = Number(e.target.value)
                            if (!Number.isNaN(target)) copyDay(day.value, target)
                            e.currentTarget.value = ''
                          }}
                          aria-label={`${day.long} bloklarını başka güne kopyala`}
                        >
                          <option value="">Kopyala →</option>
                          {WEEK_DAYS.filter((d) => d.value !== day.value).map((d) => (
                            <option key={d.value} value={d.value}>{d.long}</option>
                          ))}
                        </select>
                      )}
                      <button
                        type="button"
                        onClick={() => addBlock(day.value)}
                        className="btn-editorial h-[26px] text-[10px] px-2"
                      >
                        <Plus size={11} />
                        Blok
                      </button>
                    </div>
                  </div>

                  {indexed.length === 0 && (
                    <p className="text-[11px] text-neutral-400">Bu gün için blok yok — hafta tatili sayılır.</p>
                  )}

                  <div className="space-y-2">
                    {indexed.map(({ b, index }) => {
                      const overnight = b.endMinute > 1440
                      return (
                        <div key={index} className="flex flex-wrap items-end gap-2">
                          <div>
                            <label className="block text-[10px] text-neutral-400 mb-0.5">Başlangıç</label>
                            <input
                              type="time"
                              className="input-base w-[110px]"
                              value={minuteToClock(b.startMinute)}
                              onChange={(e) => updateBlock(index, { startMinute: clockToMinute(e.target.value) })}
                            />
                          </div>

                          <div>
                            <label className="block text-[10px] text-neutral-400 mb-0.5">Bitiş</label>
                            <input
                              type="time"
                              className="input-base w-[110px]"
                              value={minuteToClock(b.endMinute)}
                              onChange={(e) => {
                                const raw = clockToMinute(e.target.value)
                                // Bitiş başlangıçtan küçükse gece yarısını aşan vardiyadır.
                                updateBlock(index, { endMinute: raw <= b.startMinute ? raw + 1440 : raw })
                              }}
                            />
                          </div>

                          <div>
                            <label className="block text-[10px] text-neutral-400 mb-0.5">Katsayı</label>
                            <input
                              type="number"
                              min={0.1}
                              max={10}
                              step={0.05}
                              className="input-base w-[80px]"
                              value={b.payMultiplier}
                              onChange={(e) => updateBlock(index, { payMultiplier: Number(e.target.value) || 1 })}
                            />
                          </div>

                          <div className="flex-1 min-w-[120px]">
                            <label className="block text-[10px] text-neutral-400 mb-0.5">Etiket</label>
                            <input
                              className="input-base"
                              value={b.label ?? ''}
                              onChange={(e) => updateBlock(index, { label: e.target.value })}
                              placeholder="Sabah / Gece"
                            />
                          </div>

                          <button
                            type="button"
                            onClick={() => removeBlock(index)}
                            className="btn-danger h-[38px]"
                            aria-label="Bloğu sil"
                          >
                            <Trash2 size={12} />
                          </button>

                          <div className="w-full flex items-center gap-2 text-[10px] text-neutral-400 -mt-1">
                            <Clock size={10} />
                            <span>{minutesToText(Math.max(0, b.endMinute - b.startMinute))}</span>
                            {overnight && <span className="text-bronze-700">ertesi güne sarkıyor</span>}
                            {b.payMultiplier !== 1 && (
                              <span className="text-bronze-700">
                                bu dilimde dakika ücreti ×{b.payMultiplier}
                              </span>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>

          <div className="space-y-2">
            {([
              { key: 'countHolidaysAsWorkDay', label: 'Resmî tatiller iş günü sayılsın' },
              { key: 'isDefault', label: 'Varsayılan mesai tanımı' },
              { key: 'isActive', label: 'Aktif' }
            ] as const).map((item) => (
              <label key={item.key} className="flex items-center gap-2 text-xs text-neutral-600 cursor-pointer">
                <input
                  type="checkbox"
                  checked={Boolean(form[item.key])}
                  onChange={(e) => setForm((p) => ({ ...p, [item.key]: e.target.checked }))}
                  className="accent-bronze-500"
                />
                {item.label}
              </label>
            ))}
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-ivory-300">
            <button type="button" className="btn-secondary" onClick={() => setModalOpen(false)}>
              Vazgeç
            </button>
            <button type="button" className="btn-editorial-primary" disabled={saving} onClick={() => void save()}>
              {saving ? 'Kaydediliyor…' : 'Kaydet'}
            </button>
          </div>
        </div>
      </Modal>

      {popup && (
        <NotificationPopup
          isOpen
          variant={popup.variant}
          title={popup.title}
          message={popup.message}
          onClose={() => setPopup(null)}
        />
      )}
    </Layout>
  )
}
