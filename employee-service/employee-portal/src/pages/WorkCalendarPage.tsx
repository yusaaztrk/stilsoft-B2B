import React, { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarDays, Plus, RefreshCw, Trash2 } from 'lucide-react'
import Layout from '../components/Layout'
import Modal from '../components/Modal'
import NotificationPopup, { type NotificationVariant } from '../components/NotificationPopup'
import {
  createHoliday,
  deleteHoliday,
  fetchCalendarPreview,
  fetchHolidays,
  minuteToClock,
  minutesToText,
  type CalendarPreviewDto,
  type HolidayDto
} from '../api/workCalendar'
import AyarliTablo from '../components/table/AyarliTablo'

/**
 * Resmî tatil takvimi ve dönem önizlemesi.
 *
 * Mesai (iş günü) tanımı ayrı sayfaya taşındı: /work-schedules. Bu sayfa yalnızca tatilleri
 * yönetir ve seçilen dönemin gün gün nasıl göründüğünü gösterir.
 */

function currentPeriod(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

const DAY_LABELS = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz']

export default function WorkCalendarPage() {
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [popup, setPopup] = useState<{ variant: NotificationVariant; title: string; message: string } | null>(null)

  const [holidays, setHolidays] = useState<HolidayDto[]>([])
  const [preview, setPreview] = useState<CalendarPreviewDto | null>(null)

  const [year, setYear] = useState(() => new Date().getFullYear())
  const [period, setPeriod] = useState(currentPeriod)

  const [holidayModalOpen, setHolidayModalOpen] = useState(false)
  const [holidayForm, setHolidayForm] = useState({ date: '', name: '', isHalfDay: false, isRecurringYearly: false })

  const notify = (variant: NotificationVariant, title: string, message: string) => setPopup({ variant, title, message })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [holidayList, previewData] = await Promise.all([fetchHolidays(year), fetchCalendarPreview(period)])
      setHolidays(holidayList)
      setPreview(previewData)
    } catch (e: any) {
      notify('error', 'Hata', String(e?.message ?? 'Takvim bilgileri alınamadı'))
    } finally {
      setLoading(false)
    }
  }, [year, period])

  useEffect(() => {
    void load()
  }, [load])

  const saveHoliday = async () => {
    if (!holidayForm.date || !holidayForm.name.trim()) {
      notify('warning', 'Eksik bilgi', 'Tarih ve tatil adı zorunludur.')
      return
    }

    setSaving(true)
    try {
      await createHoliday(holidayForm)
      setHolidayModalOpen(false)
      setHolidayForm({ date: '', name: '', isHalfDay: false, isRecurringYearly: false })
      await load()
      notify('success', 'Eklendi', 'Tatil takvime eklendi.')
    } catch (e: any) {
      notify('error', 'Eklenemedi', String(e?.message ?? 'Tatil eklenemedi'))
    } finally {
      setSaving(false)
    }
  }

  const removeHoliday = async (holiday: HolidayDto) => {
    try {
      await deleteHoliday(holiday.id)
      await load()
      notify('success', 'Silindi', `"${holiday.name}" takvimden kaldırıldı.`)
    } catch (e: any) {
      notify('error', 'Silinemedi', String(e?.message ?? 'Tatil silinemedi'))
    }
  }

  return (
    <Layout>
      <div className="space-y-6 pb-12">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 pt-2">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 text-[10px] tracking-[0.22em] text-bronze-700 font-semibold uppercase">
              <span>TAKVİM</span>
              <span className="text-bronze-300">•</span>
              <span>PUANTAJ TEMELİ</span>
            </div>
            <h1 className="font-serif text-3xl md:text-4xl text-obsidian-850 font-normal tracking-tight">
              Tatil Takvimi
            </h1>
            <p className="text-xs text-neutral-500 max-w-2xl">
              Resmî ve firma tatilleri burada tanımlanır; iş günü sayımı, izin gün hesabı ve hakediş
              bu takvime bakar. Haftalık mesai düzeni için{' '}
              <Link to="/work-schedules" className="text-bronze-700 underline underline-offset-2">
                Mesai Tanımları
              </Link>{' '}
              sayfasını kullanın.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button type="button" onClick={() => void load()} className="btn-editorial">
              <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
              <span>Yenile</span>
            </button>
          </div>
        </div>

        {/* Dönem özeti */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="card shadow-card p-5">
            <div className="text-[10px] text-neutral-400 font-medium tracking-[0.2em] uppercase">DÖNEM</div>
            <input
              type="month"
              value={period}
              onChange={(e) => setPeriod(e.target.value || currentPeriod())}
              className="input-base mt-2"
              aria-label="Takvim dönemi"
            />
          </div>

          <div className="card shadow-card p-5">
            <div className="text-[10px] text-neutral-400 font-medium tracking-[0.2em] uppercase">İŞ GÜNÜ</div>
            <div className="font-serif text-3xl text-obsidian-850 my-1.5">{preview?.workDayCount ?? '—'}</div>
            <div className="text-[11px] text-neutral-500">{preview?.scheduleName ?? 'mesai tanımı yok'}</div>
          </div>

          <div className="card shadow-card p-5">
            <div className="text-[10px] text-neutral-400 font-medium tracking-[0.2em] uppercase">BEKLENEN MESAİ</div>
            <div className="font-serif text-2xl text-obsidian-850 my-1.5">
              {preview ? minutesToText(preview.expectedMinutes) : '—'}
            </div>
            <div className="text-[11px] text-neutral-500">
              {preview && (preview.weightedMinutes ?? 0) > preview.expectedMinutes
                ? `ücret ağırlıklı ${minutesToText(preview.weightedMinutes ?? 0)}`
                : 'dönem toplamı'}
            </div>
          </div>

          <div className="card shadow-card p-5">
            <div className="text-[10px] text-neutral-400 font-medium tracking-[0.2em] uppercase">TATİL</div>
            <div className="font-serif text-3xl text-obsidian-850 my-1.5">{preview?.holidayCount ?? '—'}</div>
            <div className="text-[11px] text-neutral-500">bu dönemde</div>
          </div>
        </div>

        {/* Tatil listesi */}
        <div className="space-y-4">
          <div className="flex flex-wrap justify-between items-center gap-2">
            <div className="flex items-center gap-2">
              <label htmlFor="holiday-year" className="text-xs text-neutral-500">Yıl</label>
              <input
                id="holiday-year"
                type="number"
                min={2000}
                max={2100}
                value={year}
                onChange={(e) => setYear(Number(e.target.value) || new Date().getFullYear())}
                className="input-base w-28"
              />
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => setHolidayModalOpen(true)} className="btn-editorial-primary">
                <Plus size={13} />
                <span>Tatil Ekle</span>
              </button>
            </div>
          </div>

          <div className="overflow-x-auto card shadow-card">
            <AyarliTablo>
            <table className="w-full text-xs min-w-[560px]">
              <thead>
                <tr className="border-b border-ivory-300 text-left text-[10px] uppercase tracking-wider text-neutral-400">
                  <th className="px-4 py-3 font-medium">Tarih</th>
                  <th className="px-4 py-3 font-medium">Tatil</th>
                  <th className="px-4 py-3 font-medium text-center">Süre</th>
                  <th className="px-4 py-3 font-medium text-center">Tekrar</th>
                  <th className="px-4 py-3 font-medium text-right">İşlem</th>
                </tr>
              </thead>
              <tbody>
                {holidays.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-neutral-400">
                      {year} yılı için özel tatil tanımlı değil. İsteğe bağlı olarak yukarıdaki "+ Tatil Ekle" butonu ile ekleyebilirsiniz.
                    </td>
                  </tr>
                )}

                {holidays.map((h) => (
                  <tr key={`${h.id}-${h.date}`} className="border-b border-ivory-200 hover:bg-ivory-100/60">
                    <td className="px-4 py-3 font-medium text-obsidian-850">{h.date}</td>
                    <td className="px-4 py-3 text-neutral-600">{h.name}</td>
                    <td className="px-4 py-3 text-center">
                      {h.isHalfDay ? <span className="badge-amber">YARIM GÜN</span> : <span className="badge-navy">TAM GÜN</span>}
                    </td>
                    <td className="px-4 py-3 text-center text-neutral-500">
                      {h.isRecurringYearly ? 'Her yıl' : 'Tek sefer'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => void removeHoliday(h)}
                        className="btn-danger"
                        aria-label={`${h.name} tatilini sil`}
                      >
                        <Trash2 size={12} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </AyarliTablo>
          </div>

          <p className="text-[11px] text-neutral-400">
            Dinî bayramlar her yıl kaydığı için "her yıl tekrar" olarak işaretlenmez; yıl yıl eklenmelidir.
          </p>
        </div>

        {/* Dönem takvimi önizlemesi */}
        {preview && (
          <div className="card shadow-card p-5">
            <div className="flex items-center gap-2 mb-3">
              <CalendarDays size={14} className="text-bronze-700" />
              <h2 className="font-serif text-lg text-obsidian-850">{preview.period} takvimi</h2>
              <span className="text-[11px] text-neutral-400">{preview.scheduleName}</span>
            </div>

            <div className="grid grid-cols-7 gap-1.5">
              {DAY_LABELS.map((label) => (
                <div key={label} className="text-[10px] text-neutral-400 text-center uppercase tracking-wider pb-1">
                  {label}
                </div>
              ))}

              {(() => {
                const first = preview.days[0]
                if (!first) return null
                const firstDate = new Date(`${first.date}T00:00:00`)
                const offset = (firstDate.getDay() + 6) % 7
                return Array.from({ length: offset }).map((_, i) => <div key={`pad-${i}`} />)
              })()}

              {preview.days.map((d) => (
                <div
                  key={d.date}
                  title={
                    // `blocks` sunucudan gelmeyebilir (eski sürüm çalışıyorsa). Alan yokken
                    // doğrudan `.length` okumak sayfanın tamamını çökertiyordu; API sözleşmesi
                    // değiştiğinde ekran veri eksikliğine dayanabilmeli.
                    d.holidayName ??
                    ((d.blocks ?? []).length > 0
                      ? (d.blocks ?? [])
                          .map((b) => `${minuteToClock(b.startMinute)}–${minuteToClock(b.endMinute)}`)
                          .join(', ')
                      : 'Çalışılmıyor')
                  }
                  className={`h-[58px] rounded-md border flex flex-col items-center justify-center px-1 text-[11px] overflow-hidden ${
                    d.isHoliday
                      ? d.isHalfDayHoliday
                        ? 'border-amber-300 bg-amber-50 text-amber-900'
                        : 'border-sky-300 bg-sky-50 text-sky-900'
                      : d.isWorkDay
                        ? 'border-ivory-300 bg-white text-obsidian-850'
                        : 'border-ivory-200 bg-ivory-100 text-neutral-400'
                  }`}
                >
                  <span className="font-medium leading-none">{Number(d.date.slice(8, 10))}</span>
                  {d.isWorkDay && !d.isHoliday && (
                    <span className="text-[9px] text-neutral-400 leading-none mt-0.5">
                      {Math.round(d.expectedMinutes / 60)}s
                    </span>
                  )}
                  {/*
                    Özel günün adı kutunun altında görünür. Tek satıra sığmayan uzun adlar
                    kesilir; tam hâli kutunun title'ında zaten var.
                  */}
                  {d.isHoliday && d.holidayName ? (
                    <span className="mt-0.5 w-full truncate text-center text-[8px] font-semibold leading-tight">
                      {d.holidayName}
                    </span>
                  ) : null}
                </div>
              ))}
            </div>

            <div className="flex flex-wrap gap-3 mt-4 text-[11px] text-neutral-500">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-3 h-3 rounded border border-ivory-300 bg-white" /> İş günü
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-3 h-3 rounded border border-ivory-200 bg-ivory-100" /> Çalışılmayan gün
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-3 h-3 rounded border border-sky-300 bg-sky-50" /> Özel gün (tam)
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-3 h-3 rounded border border-amber-300 bg-amber-50" /> Özel gün (yarım)
              </span>
            </div>
          </div>
        )}
      </div>

      <Modal isOpen={holidayModalOpen} onClose={() => setHolidayModalOpen(false)} title="Tatil Ekle">
        <div className="space-y-4">
          <div>
            <label htmlFor="holiday-date" className="block text-[11px] text-neutral-500 mb-1">Tarih</label>
            <input
              id="holiday-date"
              type="date"
              className="input-base"
              value={holidayForm.date}
              onChange={(e) => setHolidayForm((p) => ({ ...p, date: e.target.value }))}
            />
          </div>
          <div>
            <label htmlFor="holiday-name" className="block text-[11px] text-neutral-500 mb-1">Tatil adı</label>
            <input
              id="holiday-name"
              className="input-base"
              value={holidayForm.name}
              onChange={(e) => setHolidayForm((p) => ({ ...p, name: e.target.value }))}
              placeholder="Ramazan Bayramı 1. Gün"
            />
          </div>
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-xs text-neutral-600 cursor-pointer">
              <input
                type="checkbox"
                checked={holidayForm.isHalfDay}
                onChange={(e) => setHolidayForm((p) => ({ ...p, isHalfDay: e.target.checked }))}
                className="accent-bronze-500"
              />
              Yarım gün (arife)
            </label>
            <label className="flex items-center gap-2 text-xs text-neutral-600 cursor-pointer">
              <input
                type="checkbox"
                checked={holidayForm.isRecurringYearly}
                onChange={(e) => setHolidayForm((p) => ({ ...p, isRecurringYearly: e.target.checked }))}
                className="accent-bronze-500"
              />
              Her yıl aynı gün tekrar eder
            </label>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-ivory-300">
            <button type="button" className="btn-secondary" onClick={() => setHolidayModalOpen(false)}>
              Vazgeç
            </button>
            <button type="button" className="btn-editorial-primary" disabled={saving} onClick={() => void saveHoliday()}>
              {saving ? 'Kaydediliyor…' : 'Ekle'}
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
