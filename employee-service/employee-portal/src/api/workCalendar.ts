import { apiFetch } from '../config/api'

/** Haftalık mesai bloğu: "pazartesi 08:00–12:00, katsayı 1,00" gibi. */
export type ShiftBlockDto = {
  id?: number
  /** 0 = Pazar, 1 = Pazartesi ... 6 = Cumartesi */
  dayOfWeek: number
  /** Gün başından itibaren dakika (480 = 08:00) */
  startMinute: number
  /** Gece yarısını aşan vardiyada 1440'tan büyük olabilir */
  endMinute: number
  /** Bu blokta çalışılan dakikanın ücret katsayısı (1,00 = normal) */
  payMultiplier: number
  label?: string | null
}

export type WorkScheduleDto = {
  id: number
  name: string
  mondayMinutes: number
  tuesdayMinutes: number
  wednesdayMinutes: number
  thursdayMinutes: number
  fridayMinutes: number
  saturdayMinutes: number
  sundayMinutes: number
  breakMinutes: number
  startTimeMinutes: number
  /** Giriş toleransı: bu kadar geç gelen tam saatinde gelmiş sayılır (dakika hesabına girer). */
  lateToleranceMinutes: number
  /** Çıkış toleransı: bu kadar erken çıkan tam saatinde çıkmış sayılır. */
  earlyLeaveToleranceMinutes: number
  overtimeMultiplier: number
  countHolidaysAsWorkDay: boolean
  isDefault: boolean
  isActive: boolean
  weeklyMinutes: number
  weightedWeeklyMinutes: number
  blocks: ShiftBlockDto[]
}

export type HolidayDto = {
  id: number
  date: string
  name: string
  isHalfDay: boolean
  isRecurringYearly: boolean
}

export type CalendarPreviewDto = {
  period: string
  scheduleName: string
  workDayCount: number
  expectedMinutes: number
  holidayCount: number
  days: Array<{
    date: string
    expectedMinutes: number
    isWorkDay: boolean
    isHoliday: boolean
    isHalfDayHoliday: boolean
    holidayName?: string | null
    blocks: Array<{ startMinute: number; endMinute: number; payMultiplier: number; label?: string | null }>
  }>
  weightedMinutes: number
}

export type UpsertSchedulePayload = Omit<WorkScheduleDto, 'id' | 'weeklyMinutes' | 'weightedWeeklyMinutes'>

/** Gün başından itibaren dakikayı "08:30" biçimine çevirir (1440'ı aşan gece vardiyası dâhil). */
export function minuteToClock(minute: number): string {
  const v = Math.max(0, Math.round(Number(minute) || 0))
  const normalized = v % 1440
  return `${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(normalized % 60).padStart(2, '0')}`
}

/** "08:30" → 510. */
export function clockToMinute(clock: string): number {
  const [h, m] = String(clock ?? '').split(':')
  return Math.max(0, Math.min(1439, (Number(h) || 0) * 60 + (Number(m) || 0)))
}

/** Dakikayı "7 sa 30 dk" biçiminde yazar. */
export function minutesToText(minutes: number): string {
  const total = Math.max(0, Math.round(Number(minutes) || 0))
  const h = Math.floor(total / 60)
  const m = total % 60
  if (h === 0) return `${m} dk`
  if (m === 0) return `${h} sa`
  return `${h} sa ${m} dk`
}

export const WEEK_DAYS = [
  { value: 1, short: 'Pzt', long: 'Pazartesi' },
  { value: 2, short: 'Sal', long: 'Salı' },
  { value: 3, short: 'Çar', long: 'Çarşamba' },
  { value: 4, short: 'Per', long: 'Perşembe' },
  { value: 5, short: 'Cum', long: 'Cuma' },
  { value: 6, short: 'Cmt', long: 'Cumartesi' },
  { value: 0, short: 'Paz', long: 'Pazar' }
] as const

export async function fetchSchedules(signal?: AbortSignal): Promise<WorkScheduleDto[]> {
  const json = await apiFetch('/api/WorkCalendar/schedules', { signal, fallbackError: 'Mesai tanımları alınamadı' })
  return (Array.isArray(json) ? json : (json?.data ?? [])) as WorkScheduleDto[]
}

export async function createSchedule(payload: UpsertSchedulePayload) {
  return apiFetch('/api/WorkCalendar/schedules', {
    method: 'POST',
    body: payload,
    fallbackError: 'Mesai tanımı eklenemedi'
  })
}

export async function updateSchedule(id: number, payload: UpsertSchedulePayload) {
  return apiFetch(`/api/WorkCalendar/schedules/${id}`, {
    method: 'PUT',
    body: payload,
    fallbackError: 'Mesai tanımı güncellenemedi'
  })
}

export async function deleteSchedule(id: number) {
  return apiFetch(`/api/WorkCalendar/schedules/${id}`, {
    method: 'DELETE',
    fallbackError: 'Mesai tanımı silinemedi'
  })
}

export async function fetchHolidays(year: number, signal?: AbortSignal): Promise<HolidayDto[]> {
  const json = await apiFetch(`/api/WorkCalendar/holidays?year=${year}`, { signal, fallbackError: 'Tatil takvimi alınamadı' })
  return (Array.isArray(json) ? json : (json?.data ?? [])) as HolidayDto[]
}

export async function createHoliday(payload: { date: string; name: string; isHalfDay: boolean; isRecurringYearly: boolean }) {
  return apiFetch('/api/WorkCalendar/holidays', {
    method: 'POST',
    body: payload,
    fallbackError: 'Tatil eklenemedi'
  })
}

export async function updateHoliday(
  id: number,
  payload: { date: string; name: string; isHalfDay: boolean; isRecurringYearly: boolean }
) {
  return apiFetch(`/api/WorkCalendar/holidays/${id}`, {
    method: 'PUT',
    body: payload,
    fallbackError: 'Tatil güncellenemedi'
  })
}

export async function deleteHoliday(id: number) {
  return apiFetch(`/api/WorkCalendar/holidays/${id}`, {
    method: 'DELETE',
    fallbackError: 'Tatil silinemedi'
  })
}

export async function seedOfficialHolidays(): Promise<number> {
  const json = await apiFetch('/api/WorkCalendar/holidays/seed-official', {
    method: 'POST',
    body: {},
    fallbackError: 'Resmî tatiller eklenemedi'
  })
  return Number(json?.added ?? 0)
}

export async function fetchCalendarPreview(period: string, scheduleId?: number, signal?: AbortSignal): Promise<CalendarPreviewDto> {
  const qs = new URLSearchParams({ period })
  if (scheduleId && scheduleId > 0) qs.set('scheduleId', String(scheduleId))

  const json = await apiFetch(`/api/WorkCalendar/preview?${qs.toString()}`, { signal, fallbackError: 'Takvim alınamadı' })
  return json?.data as CalendarPreviewDto
}
