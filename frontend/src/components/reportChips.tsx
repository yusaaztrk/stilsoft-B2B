import React from 'react'

/**
 * RAPOR/LİSTE ROZETLERİ — TEK KAYNAK.
 *
 * Renk süsleme değil okuma hızı için: bu ekranlar yan yana üç para sütunu gösteriyor
 * (Giriş / Çıkış / Bakiye) ve hepsi aynı siyah metindi. Hangi satırın para aldığını hangisinin
 * ödediğini görmek için tek tek okumak gerekiyordu.
 *
 * Dört ekran aynı görünsün diye burada: Banka Raporları, Kasa Raporu, Kasa İşlemleri,
 * Banka Havale/EFT. Kopyalasaydık biri değişip diğeri kalırdı ve aynı sayı iki ekranda iki
 * farklı renkte görünürdü.
 */

const CHIP = 'inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset whitespace-nowrap tabular-nums'

const TONE_IN = 'bg-emerald-50 text-emerald-800 ring-emerald-600/25'
const TONE_OUT = 'bg-rose-50 text-rose-800 ring-rose-600/25'
const TONE_ZERO = 'bg-gray-50 text-gray-500 ring-gray-400/20'

export type MoneyFormatter = (value: number) => string

/**
 * Giriş/çıkış tutarı.
 *
 * SIFIRLAR ROZETSİZ ve soluk: tablo yüzlerce satırda sıfır taşıyor; her birine renkli bir kutu
 * koymak asıl hareketleri görünmez kılardı.
 */
export function MoneyChip({ value, format, tone }: { value: number; format: MoneyFormatter; tone: 'in' | 'out' }) {
  const v = Number(value ?? 0)
  if (!(v > 0)) return <span className="text-gray-300 tabular-nums">{format(0)}</span>
  return <span className={`${CHIP} ${tone === 'in' ? TONE_IN : TONE_OUT}`}>{format(v)}</span>
}

/** Bakiye: artı yeşil, eksi kırmızı, sıfır nötr — borçlu hesap bir bakışta belli olsun. */
export function BalanceChip({ value, format }: { value: number; format: MoneyFormatter }) {
  const v = Number(value ?? 0)
  const tone = v > 0 ? TONE_IN : v < 0 ? TONE_OUT : TONE_ZERO
  return <span className={`${CHIP} ${tone}`}>{format(v)}</span>
}

/** Döviz rozeti — TL nötr, dövizler ayrı renk; kur karışıklığı gözden kaçmasın. */
const CURRENCY_TONE: Record<number, string> = {
  1: 'bg-gray-50 text-gray-600 ring-gray-400/20',
  2: 'bg-blue-50 text-blue-800 ring-blue-600/25',
  3: 'bg-teal-50 text-teal-800 ring-teal-600/25',
  4: 'bg-purple-50 text-purple-800 ring-purple-600/25'
}

export function CurrencyChip({ currencyTypeId, label }: { currencyTypeId: number; label: string }) {
  const id = Number(currencyTypeId ?? 0) === 0 ? 1 : Number(currencyTypeId ?? 0)
  return <span className={`${CHIP} ${CURRENCY_TONE[id] ?? CURRENCY_TONE[1]}`}>{label}</span>
}

/** Serbest metin rozeti (hesap tipi, durum vb.). */
export function TextChip({ text, tone }: { text: string; tone: string }) {
  return <span className={`${CHIP} ${tone}`}>{text}</span>
}

/**
 * ADA GÖRE SABİT RENK — banka ve kasa adları için.
 *
 * Ziraat hep aynı renkte, Haspolat hep aynı renkte görünsün diye renk addan TÜRETİLİYOR:
 * elle tanımlanmış bir liste olsaydı yeni açılan her banka/kasa listede olmadığı için gri
 * kalır, listeyi güncellemeyi unutan da fark etmezdi.
 *
 * Türetme kararlı (aynı ad → hep aynı renk) ve büyük/küçük harf ile boşluklardan bağımsız;
 * "ZİRAAT VADESİZ" ile "Ziraat Vadesiz" aynı rengi alır.
 *
 * Palet kasıtlı olarak soluk: bunlar metin sütunu, tutar sütunlarının önüne geçmemeli.
 */
const NAME_TONES = [
  'bg-sky-50 text-sky-800 ring-sky-600/20',
  'bg-emerald-50 text-emerald-800 ring-emerald-600/20',
  'bg-amber-50 text-amber-800 ring-amber-600/20',
  'bg-violet-50 text-violet-800 ring-violet-600/20',
  'bg-rose-50 text-rose-800 ring-rose-600/20',
  'bg-teal-50 text-teal-800 ring-teal-600/20',
  'bg-indigo-50 text-indigo-800 ring-indigo-600/20',
  'bg-orange-50 text-orange-800 ring-orange-600/20',
  'bg-cyan-50 text-cyan-800 ring-cyan-600/20',
  'bg-fuchsia-50 text-fuchsia-800 ring-fuchsia-600/20',
  'bg-lime-50 text-lime-800 ring-lime-600/20',
  'bg-slate-100 text-slate-700 ring-slate-500/20'
]

export function toneForName(name: unknown): string {
  const key = String(name ?? '').trim().toLowerCase().replace(/\s+/g, '')
  if (!key) return TONE_ZERO
  let hash = 0
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0
  }
  return NAME_TONES[hash % NAME_TONES.length]
}

/** Banka/kasa adı rozeti; rengi adından türer. */
export function NameChip({ text }: { text: unknown }) {
  const label = String(text ?? '').trim()
  if (!label) return <span className="text-gray-300">—</span>
  return <span className={`${CHIP} ${toneForName(label)}`}>{label}</span>
}

/**
 * TARİH — GÜN.AY.YIL.
 *
 * Listeler tarihi uçtan geldiği gibi (`2026-08-20`) basıyordu: hem ters sırada hem tireli,
 * yani Kasa/Banka İşlemleri ekranlarındaki `23.08.2026` biçiminden farklı. Aynı tarih iki
 * ekranda iki türlü görünüyordu.
 */
export function formatDateTr(value: unknown): string {
  const raw = String(value ?? '').trim()
  if (!raw) return ''
  const iso = raw.slice(0, 10)
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (m) return `${m[3]}.${m[2]}.${m[1]}`
  // Zaten gg.aa.yyyy ya da tanınmayan bir biçimse olduğu gibi bırak — bozmaktansa dokunma.
  return raw.length > 10 ? raw.slice(0, 10) : raw
}
