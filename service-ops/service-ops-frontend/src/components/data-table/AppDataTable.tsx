import React, { useMemo, useRef } from 'react'
import * as XLSX from 'xlsx'
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnFiltersState,
  type FilterFn,
  type Row,
  type SortingFn
} from '@tanstack/react-table'
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronDown, ChevronRight, Eye, FileSpreadsheet } from 'lucide-react'
import { DataTablePagination } from './DataTablePagination'
import { DataTableRowActions } from './DataTableRowActions'
import { TableEmptyState, TableErrorState, TableSkeleton } from './DataTableStates'
import { DataTableToolbar } from './DataTableToolbar'
import { DataTableColumnVisibility } from './DataTableColumnVisibility'
import { ColumnHeaderFilterMenu } from './ColumnHeaderFilterMenu'
import { ColumnFilterInputCell } from './ColumnFilterInputCell'
import type { AppDataTableProps, ColumnFilterStateValue } from './types'
import { DataTableSettingsMenu, MAX_COLUMN_WIDTH, MIN_COLUMN_WIDTH, type SettingsColumn } from './DataTableSettingsMenu'
import { tablePrefsKey, useTablePrefs } from '../../lib/tablePreferences'
import { toast } from 'sonner'

/**
 * Kartta ilk bakışta gösterilen alan sayısı.
 *
 * 6'ydı, 4'e indirildi: saha ekibi listeyi TARIYOR, okumuyor. Bir satırda gerçekten aradıkları
 * dar — kime gidiyor, nereye, ne zaman. Altı alan kartı ekranın yarısına çıkarıyor ve üç kayıt
 * görmek için kaydırmak gerekiyordu. Gerisi "Tüm alanlar" ile tek dokunuşta açılıyor,
 * hiçbir bilgi kaybolmuyor.
 */
// 2026-09-27: 4 → 6. Bayi ve Ürün öne alınınca Adres/Bölge ilk dörtten düşüyordu; durum ve
// geçen gün artık başlık satırında olduğu için iki alan kart boyunu fazla uzatmıyor.
const CARD_VISIBLE_FIELDS = 6

/**
 * Kart görünümündeki alan listesi.
 *
 * Kart, satırdaki HER kolonu birden basıyordu: montaj planlama gibi 15 kolonlu listelerde
 * telefonda tek kayıt neredeyse bir ekran boyu yer kaplıyor, liste taranamaz hâle geliyordu.
 * İlk alanlar açık duruyor, kalanı isteyen açıyor — hiçbir alan kaybolmuyor, sadece
 * varsayılan görünüm taranabilir kalıyor.
 */
/**
 * Telefonda önce gösterilecek alanlar — ÖNEM sırasına göre.
 *
 * Kart eskiden kolon sırasının ilk dördünü basıyordu ve o sıra masaüstü için kurulmuş:
 * Montaj ID, Geçen Gün, Ürün, Adet. Saha ekibinin telefonda aradığı bunlar değil —
 * KİME gidiyor, NEREYE, NE ZAMAN, KİM götürüyor. O alanlar kolon listesinin arkasında
 * kaldığı için kartta hiç görünmüyordu.
 *
 * Eşleşme başlık metni üzerinden, parça olarak: sayfalar aynı bilgiye farklı ad veriyor
 * (Müşteri / Müşteri Adı / Cari). Listede olmayan alanlar sırasını koruyup arkaya geçer;
 * hiçbiri kaybolmuyor, "Tüm alanlar" ile açılıyor.
 */
// 2026-09-27: 'bayi' ve 'ürün' öne alındı. Kabul listelerinde kartta Bayi/Ürün hiç çıkmıyor,
// yerlerine Kayıt Tarihi / Müşteri Tipi / Geçen Gün basılıyordu (kullanıcı ekranı).
const CARD_FIELD_PRIORITY = [
  'müşteri', 'musteri', 'cari',
  'bayi',
  'ürün', 'urun',
  'adres', 'bölge', 'bolge', 'şehir', 'sehir',
  'teknisyen', 'personel', 'atanan',
  'fatura', 'kalem',
  'telefon',
  'planlanan', 'vade', 'tarih',
  'durum'
]

/**
 * "Müşteri Tipi" / "Ürün Kodu" gibi TÜREV alanlar, içlerinde ana kelime geçtiği için
 * asıl alanla aynı önemi alıyordu — "Müşteri Tipi" teknisyenin önüne geçmişti. Bunlar
 * bir basamak geriye atılıyor: bilgi değerli ama sahada ikinci sırada.
 */
const CARD_FIELD_DEMOTE = ['tip', 'tür', 'tur', 'kod', 'grup', 'kategori', 'id']

function fieldRank(label: string): number {
  const l = String(label || '').toLocaleLowerCase('tr-TR')
  const demoted = CARD_FIELD_DEMOTE.some((d) => l.includes(d))
  for (let i = 0; i < CARD_FIELD_PRIORITY.length; i++) {
    if (l.includes(CARD_FIELD_PRIORITY[i])) {
      // Türev alan, ana alanların TAMAMINDAN sonra ama listede olmayanlardan önce.
      return demoted ? CARD_FIELD_PRIORITY.length - 0.5 : i
    }
  }
  return CARD_FIELD_PRIORITY.length
}

/** Uzun metin taşıyan alanlar kartta tam satır alır ve iki satıra kadar kırılır. */
function isWideField(label: string): boolean {
  const l = String(label || '').toLocaleLowerCase('tr-TR')
  return ['adres', 'ürün', 'urun', 'açıklama', 'aciklama', 'not'].some((k) => l.includes(k))
}

function cardLabel(c: any): string {
  return typeof c.column.columnDef.header === 'string' ? c.column.columnDef.header : ''
}

/**
 * Kart başlığı KAYIT NUMARASI olmalı (Fiş No / Servis No / Montaj ID / Sipariş No).
 * Eskiden ilk kolon alınıyordu; montaj listelerinde ilk kolon aç/kapa oku olduğu için başlıkta
 * yalnız bir ok görünüyor, fiş numarası "Tüm alanlar"ın arkasında kalıyordu.
 */
function isRecordNoField(label: string): boolean {
  const l = String(label || '').toLocaleLowerCase('tr-TR').trim()
  if (['kağıt', 'kagit', 'fatura', 'seri', 'telefon'].some((k) => l.includes(k))) return false
  return /(^|\s)(no|id)$/.test(l) || l.includes('numara')
}

function MobileCardDetails({ cells }: { cells: any[] }) {
  const [showAll, setShowAll] = React.useState(false)

  // Sıralama KARARLI: aynı önemdekiler kolon sırasını korur, yoksa kart her açılışta
  // farklı diziliyormuş gibi görünürdü.
  const ordered = React.useMemo(() => {
    const labelOf = (c: any) => (typeof c.column.columnDef.header === 'string' ? c.column.columnDef.header : '')
    return cells
      .map((c, i) => ({ c, i, r: fieldRank(labelOf(c)) }))
      .sort((a, b) => (a.r - b.r) || (a.i - b.i))
      .map((x) => x.c)
  }, [cells])

  const hiddenCount = ordered.length - CARD_VISIBLE_FIELDS
  const visible = showAll || hiddenCount <= 0 ? ordered : ordered.slice(0, CARD_VISIBLE_FIELDS)

  return (
    <div className="py-2 border-t border-slate-100 mt-2">
      <div className="grid grid-cols-2 gap-y-2 gap-x-3 text-xs">
        {visible.map((cell) => {
          const label = typeof cell.column.columnDef.header === 'string' ? cell.column.columnDef.header : ''
          return (
            <div key={cell.id} className={`min-w-0 ${isWideField(label) ? 'col-span-2' : ''}`}>
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-0.5">{label}</span>
              {/* Kutu `flex` DEĞİL: düz metin flex içinde anonim öğe olur ve "..." almadan kesilir. */}
              <div className={`text-slate-800 font-semibold min-h-[20px] [&>*]:min-w-0 [&>*]:max-w-full ${isWideField(label) ? 'line-clamp-2 break-words' : 'truncate'}`}>
                {flexRender(cell.column.columnDef.cell, cell.getContext())}
              </div>
            </div>
          )
        })}
      </div>
      {hiddenCount > 0 && (
        <button
          type="button"
          data-interactive="true"
          onClick={(e) => {
            // Satır tıklaması kartın tamamında dinleniyor; alan açmak detay ekranını açmasın.
            e.stopPropagation()
            setShowAll((v) => !v)
          }}
          className="mt-2 w-full min-h-[36px] rounded-lg border border-slate-200 bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-600 active:scale-[0.99] transition"
        >
          {showAll ? 'Alanları gizle' : `Tüm alanlar (+${hiddenCount})`}
        </button>
      )}
    </div>
  )
}

function formatCurrencyLocal(val: number): string {
  if (!Number.isFinite(val)) return '0,00'
  return val.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function getTodayFormatted(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`
}

/**
 * Vade / due / termin columns hold a future date, so seeding them with today would hide
 * every row. Shared by Table.tsx and AppDataTable so both agree on what to skip.
 */
export function isDueDateColumn(key: unknown, label?: unknown): boolean {
  const haystack = `${String(key ?? '')} ${typeof label === 'string' ? label : ''}`.toLowerCase()
  return (
    haystack.includes('due') ||
    haystack.includes('vade') ||
    haystack.includes('termin') ||
    haystack.includes('maturity')
  )
}

/**
 * Sayısal hizalama ve binlik ayracı için "bu kolon para mı" kararı.
 *
 * Bu fonksiyonun birebir kopyası `components/Table.tsx` içinde de duruyordu; ikisi ayrışırsa
 * aynı kolon başlıkta sağa yaslanıp hücrede sola yaslanabiliyordu. Tek kaynak burası, Table
 * bunu içe aktarıyor.
 */
export function isPriceColumn(key: string, label: string): boolean {
  const k = String(key).toLowerCase()
  const l = String(label).toLowerCase()

  if (
    k.includes('oran') || k.includes('field') || 
    k.includes('tip') || k.includes('grup') || k.includes('kategori') ||
    l.includes('oran') || l.includes('tip') || l.includes('grup') || l.includes('kategori') ||
    k.includes('gun') || l.includes('gun') || k.includes('adet') || l.includes('adet') ||
    k.includes('id') || k.includes('no') || k.includes('tarih') || l.includes('tarih') ||
    k.includes('tckn') || l.includes('tckn') || k.includes('vkn') || l.includes('vkn')
  ) {
    return false
  }

  const keywords = [
    'fiyat', 'tutar', 'bakiye', 'borc', 'alacak', 'tahsilat', 
    'odeme', 'giren', 'cikan', 'matrah', 'toplam', 'iskonto', 
    'para', 'net', 'brut', 'limit', 'risk', 'bedel', 'balance', 
    'price', 'amount', 'total', 'debit', 'credit', 'payment'
  ]
  
  return keywords.some(keyword => k.includes(keyword) || l.includes(keyword))
}
/**
 * Normalize any value to a comparable string for filtering.
 */
function normalizeToString(val: any): string {
  if (val == null) return ''
  if (typeof val === 'number') return String(val)
  if (typeof val === 'boolean') return val ? 'true' : 'false'
  // Date nesnesi: aşağıdaki nesne dalına düşerse `Object.values(date)` BOŞ dizi verir ve hücre
  // boş metne dönerdi — Date taşıyan kolonlar hiçbir süzgeçle eşleşmiyordu. Yerel gün alanları
  // kullanılıyor; UTC'ye çeviren toISOString bir gün geriye kaydırabilir.
  if (val instanceof Date) {
    if (isNaN(val.getTime())) return ''
    const p = (n: number) => String(n).padStart(2, '0')
    return `${val.getFullYear()}-${p(val.getMonth() + 1)}-${p(val.getDate())}`
  }
  if (typeof val === 'object') {
    return Object.values(val)
      .filter((v) => v != null && typeof v !== 'object' && typeof v !== 'function')
      .map((v) => String(v))
      .join(' ')
  }
  return String(val)
}

/**
 * Parse a Turkish formatted number or a plain number to a float.
 * Handles formats like "1.234,56" or "₺1.234,56" or plain 1234.56
 */
function parseNumericValue(val: any): number {
  if (typeof val === 'number') return val
  if (val == null) return NaN
  const s = String(val).replace(/[₺$€£\s]/g, '').trim()
  // Turkish format: 1.234,56 -> 1234.56
  if (s.includes(',')) {
    const normalized = s.replace(/\./g, '').replace(',', '.')
    return parseFloat(normalized)
  }
  return parseFloat(s)
}

/**
 * Normalizes text for Turkish-aware, case-insensitive, punctuation-insensitive matching.
 */
function normalizeForSearch(str: any): { full: string; compact: string; words: string[] } {
  if (str == null) return { full: '', compact: '', words: [] }
  
  let s = String(str)
  
  // Normalize Turkish & Latin characters to lowercase ASCII equivalents
  s = s
    .replace(/İ/g, 'i')
    .replace(/I/g, 'ı')
    .toLowerCase()
    .replace(/ı/g, 'i')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
  
  const full = s.trim()
  // Strip all non-alphanumeric characters for compact comparison (ignores spaces, -, ., /, (), etc.)
  const compact = s.replace(/[^a-z0-9]/g, '')
  // Split into alphanumeric words for multi-word queries
  const words = full.split(/[^a-z0-9]+/).filter(Boolean)
  
  return { full, compact, words }
}

function matchStringWithPhoneFlexibility(cellStr: string, searchVal: string, operator: string = 'contains'): boolean {
  if (!searchVal) return true
  
  const cell = normalizeForSearch(cellStr)
  const search = normalizeForSearch(searchVal)

  if (!search.full) return true

  // For exact or not-equal operators
  if (operator === 'eq') {
    return cell.full === search.full || cell.compact === search.compact
  }
  if (operator === 'neq') {
    return cell.full !== search.full && cell.compact !== search.compact
  }
  if (operator === 'starts_with') {
    return cell.full.startsWith(search.full) || cell.compact.startsWith(search.compact)
  }
  if (operator === 'ends_with') {
    return cell.full.endsWith(search.full) || cell.compact.endsWith(search.compact)
  }
  if (operator === 'not_contains') {
    return !cell.full.includes(search.full) && !cell.compact.includes(search.compact)
  }

  // Default / 'contains' / flexible matching:

  // 1. Direct full substring match
  if (cell.full.includes(search.full)) return true

  // 2. Compact match (ignores spaces, dashes, dots, slashes, etc.)
  if (search.compact && cell.compact.includes(search.compact)) return true

  // 3. Multi-word search matching: all search words must be found in cell
  if (search.words.length > 0) {
    const allWordsFound = search.words.every((sw) => {
      return cell.full.includes(sw) || cell.compact.includes(sw)
    })
    if (allWordsFound) return true
  }

  return false
}

/**
 * Custom column filter function that handles our ColumnFilterStateValue format.
 * This is the heart of client-side filtering — it interprets operators like
 * contains, eq, between, in, starts_with, etc.
 */
const appColumnFilterFn: FilterFn<any> = (row: Row<any>, columnId: string, filterValue: ColumnFilterStateValue | string) => {
  // Get the cell value from the row
  let cellValue = row.getValue(columnId)
  // Fallback to original row data if getValue returns undefined
  if (cellValue === undefined || cellValue === null) {
    cellValue = row.original[columnId]
  }

  // If still no value, try common casing variants
  if (cellValue === undefined || cellValue === null) {
    const camelKey = columnId.charAt(0).toLowerCase() + columnId.slice(1)
    const pascalKey = columnId.charAt(0).toUpperCase() + columnId.slice(1)
    cellValue = row.original[camelKey] ?? row.original[pascalKey] ?? ''
  }

  const cellStr = normalizeToString(cellValue).toLowerCase().trim()

  // Simple string filter
  if (typeof filterValue === 'string') {
    const search = filterValue.toLowerCase().trim()
    if (!search) return true
    if (search.includes(',')) {
      const options = search.split(',').map((s) => s.trim()).filter(Boolean)
      return options.some((opt) => matchStringWithPhoneFlexibility(cellStr, opt, 'contains'))
    }
    return matchStringWithPhoneFlexibility(cellStr, search, 'contains')
  }

  // Object-based filter (ColumnFilterStateValue)
  const { value = '', value2 = '', operator = 'contains', selectedOptions } = filterValue

  // Handle multi-select "in" operator
  if (selectedOptions && selectedOptions.length > 0) {
    return selectedOptions.some((opt) => matchStringWithPhoneFlexibility(cellStr, opt, 'contains'))
  }

  // Handle value-based "in" operator (comma-separated)
  if (operator === 'in' && value) {
    const options = value.split(',').map((s) => s.trim()).filter(Boolean)
    if (options.length === 0) return true
    return options.some((opt) => matchStringWithPhoneFlexibility(cellStr, opt, 'contains'))
  }

  const searchVal = value.trim().toLowerCase()
  if (!searchVal) return true

  if (searchVal.includes(',')) {
    const options = searchVal.split(',').map((s) => s.trim()).filter(Boolean)
    return options.some((opt) => matchStringWithPhoneFlexibility(cellStr, opt, 'contains'))
  }

  // Date comparison check FIRST (if searchVal and cellStr can be parsed as dates)
  const searchDate = parseDateToComparable(searchVal)
  const cellDate = parseDateToComparable(cellStr)
  if (searchDate) {
    // Aranan gerçek bir TARİH ise, satırın değeri tarih değilse o satır eşleşemez. Eskiden
    // ayrıştırılamayan hücreler bu bloğu atlayıp metin karşılaştırmasına düşüyor ve tarih
    // süzgeci açıkken alakasız satırlar listede kalıyordu.
    if (!cellDate) return false

    if (operator === 'between') {
      return dateRangeMatch(cellStr, searchVal, (value2 || searchVal).toLowerCase().trim())
    }
    if (operator === 'neq') return cellDate !== searchDate
    if (operator === 'lt') return cellDate < searchDate
    if (operator === 'lte') return cellDate <= searchDate
    if (operator === 'gt') return cellDate > searchDate
    if (operator === 'gte') return cellDate >= searchDate

    // eq VE metin operatörleri (contains/starts_with/varsayılan) aynı güne bakar.
    //
    // Bir tarih seçmek "bu gün" demektir. Metin operatörleri eskiden buradan düşüyordu ve
    // takvimden seçilen "2026-08-10" değeri, ekranda "10.08.2026" yazan hücreyle metin olarak
    // karşılaştırılıp HİÇBİR SATIRI eşleştiremiyordu — tarih süzgeci boş liste veriyordu.
    return cellDate === searchDate
  }

  // Numeric operators
  if (operator === 'eq' || operator === 'neq' || operator === 'lt' || operator === 'lte' || operator === 'gt' || operator === 'gte' || operator === 'between') {
    const cellNum = parseNumericValue(cellValue)
    const searchNum = parseNumericValue(searchVal)

    // If both are numbers, do numeric comparison
    if (Number.isFinite(cellNum) && Number.isFinite(searchNum)) {
      switch (operator) {
        case 'eq': return cellNum === searchNum
        case 'neq': return cellNum !== searchNum
        case 'lt': return cellNum < searchNum
        case 'lte': return cellNum <= searchNum
        case 'gt': return cellNum > searchNum
        case 'gte': return cellNum >= searchNum
        case 'between': {
          const searchNum2 = parseNumericValue(value2 || searchVal)
          if (!Number.isFinite(searchNum2)) return cellNum >= searchNum
          const low = Math.min(searchNum, searchNum2)
          const high = Math.max(searchNum, searchNum2)
          return cellNum >= low && cellNum <= high
        }
      }
    }

    // Date comparison for between operator fallback
    if (operator === 'between') {
      return dateRangeMatch(cellStr, searchVal, (value2 || searchVal).toLowerCase().trim())
    }

    // Fall through to string comparison for eq/neq on non-numeric
    if (operator === 'eq' || operator === 'neq') {
      return matchStringWithPhoneFlexibility(cellStr, searchVal, operator)
    }
  }

  // String operators
  return matchStringWithPhoneFlexibility(cellStr, searchVal, operator)
}

/**
 * Date range matching helper for Turkish date format (dd.MM.yyyy).
 */
function dateRangeMatch(cellStr: string, from: string, to: string): boolean {
  const fromDate = parseDateToComparable(from)
  const toDate = parseDateToComparable(to)
  // Sınır verilmemişse süzgeç yok sayılır.
  if (!fromDate && !toDate) return true

  // Tarih aralığı verilmişken tarihi olmayan satır kapsam dışıdır. Burada da eskiden
  // "ayrıştıramadıysan eleme" (fail-open) vardı: 01–10 Ağustos aralığı seçilince tarihsiz
  // satırlar listede kalıyor ve aralık işe yaramamış gibi görünüyordu.
  const cellDate = parseDateToComparable(cellStr)
  if (!cellDate) return false

  if (fromDate && toDate) {
    // Kullanıcı sınırları ters girse de aralık çalışsın.
    const low = fromDate <= toDate ? fromDate : toDate
    const high = fromDate <= toDate ? toDate : fromDate
    return cellDate >= low && cellDate <= high
  }
  if (fromDate) return cellDate >= fromDate
  return cellDate <= (toDate as string)
}

/**
 * Bir metni karşılaştırılabilir güne (yyyy-MM-dd) çevirir; gün değilse null.
 *
 * Üç ayrı hata buradaydı ve tabloların "tarih ve filtreler düzgün çalışmıyor" halinin
 * kaynağıydı:
 *
 * 1. ÇIPLAK SAYILAR TARİH SAYILIYORDU. Eskiden son çare olarak `new Date(metin)` deneniyordu:
 *    `new Date('3')` geçerli bir tarih üretir (2001-03-01). Böylece ADET gibi sayısal
 *    kolonlarda "3" araması sayı değil TARİH karşılaştırmasına giriyordu; 12'ye kadar
 *    tesadüfen doğru, 12'den sonra ayrıştırma başarısız olduğu için bambaşka davranıyordu.
 *    Artık tarih için ayıraç şart — sayı gibi görünen değer tarih sayılmaz.
 *
 * 2. GÜN KAYMASI. Sonuç `toISOString()` ile üretiliyordu; bu UTC'ye çevirir. Yerel saatle
 *    gece yarısı olan bir tarih (+03'te) UTC'de bir önceki günün 21:00'ı olur ve tarih BİR GÜN
 *    GERİ kayardı. Artık yerel gün/ay/yıl alanları kullanılıyor.
 *
 * 3. SAAT EKLİ METİNLER. "10.08.2026 14:30" değeri nokta ile bölününce yıl alanı "2026 14:30"
 *    oluyordu ve karşılaştırma bozuluyordu. Artık kalıp eşlemesi yapılıyor.
 */
function parseDateToComparable(str: string): string | null {
  if (!str) return null
  const trimmed = str.trim()
  if (!trimmed) return null

  const pad = (v: string, n: number) => v.padStart(n, '0')

  // gg.AA.yyyy — nokta, eğik çizgi veya tire ile. Arkasından saat gelebilir.
  const dmy = trimmed.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})(?![\d])/)
  if (dmy) {
    const [, d, m, y] = dmy
    if (Number(m) >= 1 && Number(m) <= 12 && Number(d) >= 1 && Number(d) <= 31) {
      return `${y}-${pad(m, 2)}-${pad(d, 2)}`
    }
    return null
  }

  // yyyy-AA-gg (ISO) — tarih seçicinin ve API'nin ürettiği biçim.
  const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})(?![\d])/)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`

  // Buraya kadar eşleşmediyse: yalnızca içinde tarih ayıracı VE dört haneli yıl olan metinler
  // Date'e verilir. "3", "2026", "12,5" gibi değerler tarih değildir.
  if (!/[./-]/.test(trimmed) || !/\d{4}/.test(trimmed)) return null

  const d = new Date(trimmed)
  if (isNaN(d.getTime())) return null
  return `${d.getFullYear()}-${pad(String(d.getMonth() + 1), 2)}-${pad(String(d.getDate()), 2)}`
}

/**
 * Smart sorting function that automatically handles dates (DD.MM.YYYY),
 * Turkish numbers/currencies (₺1.234,56), and text strings.
 */
const appSortingFn: SortingFn<any> = (rowA: Row<any>, rowB: Row<any>, columnId: string) => {
  let valA = rowA.getValue(columnId)
  let valB = rowB.getValue(columnId)

  if (valA == null) valA = rowA.original[columnId] ?? ''
  if (valB == null) valB = rowB.original[columnId] ?? ''

  const strA = normalizeToString(valA).toLowerCase().trim()
  const strB = normalizeToString(valB).toLowerCase().trim()

  // TARİH ÖNCE BAKILIR.
  //
  // Sayı kontrolü baştaydı ve tarihleri yutuyordu: parseFloat("10.08.2026") = 10.08 sonucunu
  // verir, yani gg.AA parçası ondalık sayı sanılıyordu. Kolon buna göre sıralanınca YIL hiç
  // hesaba katılmıyordu — 10.08.2020, 05.01.2026'dan sonra geliyordu. Tarih olan kolonlar artık
  // gerçek güne göre sıralanır. (String(Date) yerine normalizeToString: Date nesnesi de doğru
  // biçime çevriliyor.)
  const dateA = parseDateToComparable(strA)
  const dateB = parseDateToComparable(strB)
  if (dateA && dateB) {
    return dateA < dateB ? -1 : dateA > dateB ? 1 : 0
  }
  // Biri tarih biri değilse: tarihsizler sona.
  if (dateA && !dateB) return -1
  if (!dateA && dateB) return 1

  // Check if cell is formatted money or plain number
  const numA = typeof valA === 'number' ? valA : parseNumericValue(valA)
  const numB = typeof valB === 'number' ? valB : parseNumericValue(valB)

  if (Number.isFinite(numA) && Number.isFinite(numB)) {
    return numA < numB ? -1 : numA > numB ? 1 : 0
  }

  // Fallback string sorting using Turkish locale
  return strA.localeCompare(strB, 'tr-TR', { numeric: true })
}

/**
 * Convert our page-level columnFilters Record into TanStack Table's ColumnFiltersState array.
 */
function convertToTanStackColumnFilters(
  filters: Record<string, ColumnFilterStateValue | string> | undefined
): ColumnFiltersState {
  if (!filters) return []
  const result: ColumnFiltersState = []
  for (const [colId, val] of Object.entries(filters)) {
    if (!val) continue
    if (typeof val === 'string') {
      if (val.trim()) {
        result.push({ id: colId, value: val })
      }
    } else {
      // Check if filter has any actual content
      const hasContent =
        Boolean(val.value) ||
        Boolean(val.value2) ||
        (val.selectedOptions && val.selectedOptions.length > 0)
      if (hasContent) {
        result.push({ id: colId, value: val })
      }
    }
  }
  return result
}

/**
 * Kullanicinin AYARLAYAMADIGI sutunlar: secim kutusu (`select` / `id`), genislet oku, islem
 * dugmeleri. Bunlar gizlenmez, yer degistirmez; ayar penceresinde de listelenmez.
 */
function isFixedColumnId(id: string): boolean {
  return id === 'select' || id === 'id' || id === 'expand' || id === 'actions' || id.startsWith('actions') || id === '__selected'
}

/** Sutunun kullaniciya gosterilecek adi (ayar penceresi ve Excel basligi ayni kurali kullanir). */
function columnLabelOf(columnDef: any, id: string): string {
  const h = columnDef?.header
  if (typeof h === 'string' && h.trim()) return h.trim()
  if (columnDef?.meta?.title) return String(columnDef.meta.title).trim()
  if (columnDef?.meta?.filterPlaceholder) {
    const t = String(columnDef.meta.filterPlaceholder).replace('...', '').trim()
    if (t) return t
  }
  return id
}

const clampColumnWidth = (w: number) => Math.max(MIN_COLUMN_WIDTH, Math.min(MAX_COLUMN_WIDTH, Math.round(w)))

export function AppDataTable<TData extends Record<string, any>>({
  data,
  columns,
  rowId,
  pagination,
  sorting,
  filtering,
  selection,
  columnVisibility,
  states,
  toolbar,
  showExcelExport = true,
  excelFileName,
  rowActions,
  onRowClick,
  onPreviewRow,
  renderExpandedRow,
  isRowExpanded,
  onToggleRowExpanded,
  showFooterTotals = true,
  stickyHeader = false,
  showColumnLines = true,
  rowClassName,
  onFilteredDataChange,
  className = '',
  containerClassName = '',
  isCardView = false,
  preferencesKey
}: AppDataTableProps<TData>) {
  const rowActionsRef = useRef(rowActions)
  rowActionsRef.current = rowActions


  const isRowExpandedRef = useRef(isRowExpanded)
  isRowExpandedRef.current = isRowExpanded

  const onToggleRowExpandedRef = useRef(onToggleRowExpanded)
  onToggleRowExpandedRef.current = onToggleRowExpanded

  const onPreviewRowRef = useRef(onPreviewRow)
  onPreviewRowRef.current = onPreviewRow

  // Convert page-level column filters to TanStack format.
  // Nothing is injected here on purpose: the today-default lives in the effect below so
  // that a cleared filter stays cleared instead of being re-added on the next render.
  const tanstackColumnFilters = useMemo(
    () => convertToTanStackColumnFilters(filtering?.columnFilters),
    [filtering?.columnFilters]
  )

  // Seed date columns ref kept for backwards compatibility if needed
  const seededDateColumnsRef = useRef<Set<string>>(new Set())

  React.useEffect(() => {
    // Automatic date seeding is disabled by default to prevent filtering out historical records
    // and breaking search bar queries across the application.
  }, [])

  // Build columns list incorporating selection checkbox, row actions, and Eye preview button
  const tableColumns = useMemo(() => {
    const cols: ColumnDef<TData, any>[] = []

    // Selection Column
    if (selection) {
      cols.push({
        id: 'select',
        enableHiding: false,
        enableColumnFilter: false,
        header: ({ table }) => (
          <input
            type="checkbox"
            checked={table.getIsAllPageRowsSelected()}
            onChange={table.getToggleAllPageRowsSelectedHandler()}
            className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500 border-slate-300 cursor-pointer"
            aria-label="Tümünü seç"
          />
        ),
        cell: ({ row }) => (
          <input
            type="checkbox"
            checked={row.getIsSelected()}
            disabled={!row.getCanSelect()}
            onChange={row.getToggleSelectedHandler()}
            className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500 border-slate-300 cursor-pointer disabled:opacity-40"
            aria-label="Satır seç"
          />
        )
      })
    }

    // Expandable Row Toggle Column
    if (renderExpandedRow) {
      cols.push({
        id: 'expand',
        enableHiding: false,
        enableColumnFilter: false,
        header: () => null,
        cell: ({ row }) => {
          const expanded = isRowExpandedRef.current ? isRowExpandedRef.current(row.original) : row.getIsExpanded()
          return (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                if (onToggleRowExpandedRef.current) {
                  onToggleRowExpandedRef.current(row.original)
                } else {
                  row.toggleExpanded()
                }
              }}
              className="p-1 rounded hover:bg-slate-100 text-slate-500 transition-colors cursor-pointer"
              aria-label={expanded ? 'Daralt' : 'Genişlet'}
            >
              {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            </button>
          )
        }
      })
    }

    // Add appColumnFilterFn & appSortingFn to all user columns that don't already have one
    const enhancedColumns = columns.map((col) => {
      const colDef = col as any
      const filterFn = colDef.filterFn ?? (colDef.enableColumnFilter !== false ? (appColumnFilterFn as FilterFn<TData>) : undefined)
      const sortingFn = colDef.sortingFn ?? (colDef.enableSorting !== false ? (appSortingFn as SortingFn<TData>) : undefined)
      return {
        ...col,
        filterFn,
        sortingFn
      }
    })

    cols.push(...enhancedColumns)

    // Row Actions Column with Eye Preview Button (only if not already provided in columns)
    const hasUserActions = columns.some((c) => String(c.id).startsWith('actions') || String(c.id) === 'actions')
    if ((rowActions || onPreviewRow) && !hasUserActions) {
      cols.push({
        id: 'actions',
        enableHiding: false,
        enableColumnFilter: false,
        header: () => <span className="sr-only">İşlemler</span>,
        cell: ({ row }) => {
          const actions = rowActionsRef.current ? rowActionsRef.current(row.original) : []
          return (
            <div className="flex items-center justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
              {/* Quick Eye Preview Icon Button */}
              <button
                type="button"
                onClick={() => {
                  if (onPreviewRowRef.current) {
                    onPreviewRowRef.current(row.original)
                  } else if (onToggleRowExpandedRef.current) {
                    onToggleRowExpandedRef.current(row.original)
                  } else {
                    row.toggleExpanded()
                  }
                }}
                className="p-1.5 rounded-md hover:bg-red-50 text-[#B91C1C] hover:text-[#991B1B] transition-colors cursor-pointer"
                title="Fatura Detayını Önizle (Göz)"
              >
                <Eye size={15} />
              </button>

              {/* Actions Dropdown */}
              {actions.length > 0 && <DataTableRowActions actions={actions} row={row.original} />}
            </div>
          )
        }
      })
    }

    return cols
  }, [columns, Boolean(selection), Boolean(renderExpandedRow), Boolean(rowActions), Boolean(onPreviewRow)])

  const isManualFiltering = Boolean(filtering?.manualFiltering)

  // Internal sorting state for pages that don't provide their own
  const [internalSorting, setInternalSorting] = React.useState<import('@tanstack/react-table').SortingState>([])
  const effectiveSorting = sorting?.sorting ?? internalSorting

  const table = useReactTable({
    data,
    columns: tableColumns,
    getRowId: rowId ? (row) => rowId(row) : (row, idx) => (row.id ? String(row.id) : String(idx)),
    // Manual modes — only use when the page does server-side operations
    manualPagination: isManualFiltering,
    manualSorting: false, // Always allow client-side sorting
    manualFiltering: isManualFiltering,
    pageCount: isManualFiltering
      ? (pagination?.pageCount ?? (pagination ? Math.ceil(pagination.totalCount / pagination.pageSize) : -1))
      : undefined,
    autoResetPageIndex: false,
    autoResetExpanded: false,
    state: {
      pagination: pagination
        ? {
            pageIndex: pagination.pageIndex,
            pageSize: pagination.pageSize
          }
        : undefined,
      sorting: effectiveSorting,
      columnVisibility: columnVisibility?.columnVisibility,
      rowSelection: selection?.selectedRowIds ?? {},
      // Connect column filters and global filter to TanStack Table
      columnFilters: tanstackColumnFilters,
      globalFilter: filtering?.globalFilter ?? ''
    },
    onPaginationChange: (updater) => {
      if (!pagination) return
      const nextState = typeof updater === 'function' ? updater({ pageIndex: pagination.pageIndex, pageSize: pagination.pageSize }) : updater
      if (nextState.pageIndex !== pagination.pageIndex) {
        pagination.onPageChange(nextState.pageIndex)
      }
      if (nextState.pageSize !== pagination.pageSize) {
        pagination.onPageSizeChange(nextState.pageSize)
      }
    },
    onSortingChange: (updater) => {
      const current = effectiveSorting
      const nextState = typeof updater === 'function' ? updater(current) : updater
      if (sorting?.onSortingChange) {
        sorting.onSortingChange(nextState)
      } else {
        setInternalSorting(nextState)
      }
    },
    onColumnVisibilityChange: (updater) => {
      if (!columnVisibility) return
      const nextState = typeof updater === 'function' ? updater(columnVisibility.columnVisibility) : updater
      columnVisibility.onColumnVisibilityChange(nextState)
    },
    onRowSelectionChange: (updater) => {
      if (!selection?.onSelectionChange) return
      const nextState = typeof updater === 'function' ? updater(selection.selectedRowIds ?? {}) : updater
      selection.onSelectionChange(nextState)
    },
    onGlobalFilterChange: (updater) => {
      if (!filtering?.onGlobalFilterChange) return
      const nextVal = typeof updater === 'function' ? updater(filtering.globalFilter ?? '') : updater
      filtering.onGlobalFilterChange(nextVal)
    },
    globalFilterFn: (row, _columnId, filterValue) => {
      if (!filterValue || typeof filterValue !== 'string') return true
      const search = filterValue.toLowerCase().trim()
      if (!search) return true

      // 1. Search visible cells
      const matchCell = row.getVisibleCells().some((cell) => {
        const val = cell.getValue()
        if (val == null) return false
        const cellStr = normalizeToString(val)
        return matchStringWithPhoneFlexibility(cellStr, search, 'contains')
      })
      if (matchCell) return true

      // 2. Search all primitive properties of row.original for non-visible columns / raw fields
      const orig = row.original
      if (orig && typeof orig === 'object') {
        return Object.values(orig).some((val) => {
          if (val == null) return false
          if (typeof val === 'object' || typeof val === 'function') return false
          const str = normalizeToString(val)
          return matchStringWithPhoneFlexibility(str, search, 'contains')
        })
      }

      return false
    },
    enableRowSelection: selection?.isRowSelectable ? (row: any) => selection.isRowSelectable!(row.original) : Boolean(selection),
    enableSorting: true,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel()
  })

  /*
    TABLO AYARLARI — KULLANICI BAZLI (2026-10-11, kullanici istegi; B2B'deki tablonun esi).

    Sol alttaki "Ayarlar" dugmesinden: sutunu gizle/goster, sirayi degistir, genislik ver.
    Secimler kullaniciya ozel saklanir (tarayici + sunucu) ve sayfa yeniden acildiginda tablo
    ayni ayarla gelir. Ayrinti: lib/tablePreferences.ts.

    KART GORUNUMUNDE UYGULANMAZ: mobil kart basligini ve alan sirasini sutun sirasindan
    turetiyor; kullanicinin masaustunde yaptigi siralama telefondaki karti bozmasin.

    Sayfanin kendi sutun gizleme durumu varsa (Montaj Yonetimi, `columnVisibilityKey`) o,
    kullanici henuz kendi secimini YAPMAMISKEN baslangic degeri olarak kullanilir; ilk
    degisiklikten sonra tek kaynak bu ayardir.
  */
  const allLeafIds = table.getAllLeafColumns().map((c) => c.id)
  const allLeafIdsKey = allLeafIds.join('|')
  const configurableIds = useMemo(() => allLeafIds.filter((id) => !isFixedColumnId(id)), [allLeafIdsKey])
  const prefsEnabled = preferencesKey !== false && !isCardView && configurableIds.length > 1
  const prefsKey = useMemo(
    () => (!prefsEnabled ? null : typeof preferencesKey === 'string' && preferencesKey ? preferencesKey : tablePrefsKey(configurableIds)),
    [prefsEnabled, preferencesKey, configurableIds]
  )
  const [prefs, savePrefs] = useTablePrefs(prefsKey)

  const prefsView = useMemo(() => {
    const known = new Set(configurableIds)
    // Kayitli sira + kayittan sonra eklenen sutunlar: yenisi varsayilandaki ONCEKI komsusunun
    // arkasina girer (en saga atilmaz).
    const ordered = (prefs.order ?? []).filter((id) => known.has(id))
    const placed = new Set(ordered)
    configurableIds.forEach((id, idx) => {
      if (placed.has(id)) return
      let at = 0
      for (let i = idx - 1; i >= 0; i--) {
        const pos = ordered.indexOf(configurableIds[i])
        if (pos >= 0) {
          at = pos + 1
          break
        }
      }
      ordered.splice(at, 0, id)
      placed.add(id)
    })

    const pageHidden = Object.entries(columnVisibility?.columnVisibility ?? {})
      .filter(([, visible]) => visible === false)
      .map(([id]) => id)
    let hidden = new Set((prefs.hidden ?? pageHidden).filter((id) => known.has(id)))
    // Eski kayit bugunku sutunlarin HEPSINI gizliyorsa yok sayilir: bos tablo acilmaz.
    if (hidden.size >= configurableIds.length) hidden = new Set()

    const widths: Record<string, number> = {}
    for (const [id, w] of Object.entries(prefs.widths ?? {})) {
      if (known.has(id) && Number.isFinite(w) && w > 0) widths[id] = clampColumnWidth(Number(w))
    }

    // Sabit sutunlar kendi konumunda kalir; ayarlanabilir yuvalar kullanici sirasiyla dolar.
    const queue = [...ordered]
    const fullOrder = allLeafIds.map((id) => (isFixedColumnId(id) ? id : (queue.shift() as string)))
    const visibility: Record<string, boolean> = {}
    hidden.forEach((id) => {
      visibility[id] = false
    })
    return { ordered, hidden, widths, fullOrder, visibility }
  }, [prefs, configurableIds, allLeafIdsKey, columnVisibility?.columnVisibility])

  if (prefsEnabled) {
    table.setOptions((prev) => ({
      ...prev,
      state: { ...prev.state, columnOrder: prefsView.fullOrder, columnVisibility: prefsView.visibility }
    }))
  }

  const isDefaultOrder = (order: string[]) => order.length === configurableIds.length && order.every((id, i) => id === configurableIds[i])
  const customized = Boolean(prefs.hidden?.length || prefs.order?.length || (prefs.widths && Object.keys(prefs.widths).length))

  const settingsColumns: SettingsColumn[] = prefsEnabled
    ? prefsView.ordered.map((id) => ({
        id,
        label: columnLabelOf(table.getColumn(id)?.columnDef, id),
        visible: !prefsView.hidden.has(id),
        width: prefsView.widths[id]
      }))
    : []

  const toggleColumn = (id: string) => {
    const next = new Set(prefsView.hidden)
    if (next.has(id)) next.delete(id)
    else if (configurableIds.length - next.size > 1) next.add(id)
    savePrefs({ ...prefs, hidden: Array.from(next) })
  }
  const moveColumn = (id: string, toIndex: number) => {
    const next = prefsView.ordered.filter((x) => x !== id)
    next.splice(Math.max(0, Math.min(toIndex, next.length)), 0, id)
    savePrefs({ ...prefs, order: isDefaultOrder(next) ? [] : next })
  }
  const setColumnWidth = (id: string, width: number | null) => {
    const next = { ...prefsView.widths }
    if (width == null) delete next[id]
    else next[id] = clampColumnWidth(width)
    savePrefs({ ...prefs, widths: next })
  }

  /** Kullanicinin verdigi genislik hucreye de yazilir: yalniz basliga yazilsa icerik sutunu geri acardi. */
  const userWidthStyle = (colId: string): React.CSSProperties | undefined => {
    const w = prefsEnabled ? prefsView.widths[colId] : undefined
    return w ? { width: w, minWidth: w, maxWidth: w } : undefined
  }

  /*
    BASLIKTAN SURUKLEYEREK GENISLIK. Surukleme boyunca tablo yeniden CIZILMEZ ("Sinirsiz" sayfa
    boyutunda binlerce satir var): yalniz mavi bir kilavuz cizgisi fareyi izler, genislik
    birakinca bir kez yazilir.
  */
  const scrollWrapRef = useRef<HTMLDivElement | null>(null)
  const startColumnResize = (colId: string) => (e: React.MouseEvent<HTMLSpanElement>) => {
    e.preventDefault()
    e.stopPropagation()
    const th = e.currentTarget.parentElement as HTMLElement | null
    if (!th) return
    const thRect = th.getBoundingClientRect()
    const wrapRect = scrollWrapRef.current?.getBoundingClientRect()
    const startX = e.clientX
    const startW = thRect.width

    const guide = document.createElement('div')
    guide.style.cssText =
      `position:fixed;top:${thRect.top}px;height:${Math.max(thRect.height, (wrapRect?.bottom ?? thRect.bottom) - thRect.top)}px;` +
      `width:2px;background:#0ea5e9;z-index:1000;pointer-events:none;left:${thRect.right}px`
    document.body.appendChild(guide)
    const prevCursor = document.body.style.cursor
    const prevSelect = document.body.style.userSelect
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const widthAt = (clientX: number) => clampColumnWidth(startW + (clientX - startX))
    const onMove = (ev: MouseEvent) => {
      guide.style.left = `${thRect.left + widthAt(ev.clientX)}px`
    }
    const onUp = (ev: MouseEvent) => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      guide.remove()
      document.body.style.cursor = prevCursor
      document.body.style.userSelect = prevSelect
      const w = widthAt(ev.clientX)
      if (Math.abs(w - startW) >= 2) setColumnWidth(colId, w)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  const settingsButton = prefsEnabled ? (
    <DataTableSettingsMenu
      columns={settingsColumns}
      customized={customized}
      onToggle={toggleColumn}
      onMove={moveColumn}
      onWidth={setColumnWidth}
      onShowAll={() => savePrefs({ ...prefs, hidden: [] })}
      onReset={() => savePrefs(null)}
    />
  ) : null

  // Gizlenen sutunlar dusuldukten sonraki sutun sayisi: bos durum / genisleyen satir bunu kaplar.
  const visibleColumnCount = table.getVisibleLeafColumns().length

  /*
   * Süzgeçten geçen satırları sayfaya bildir.
   *
   * Ref üzerinden çağrılıyor ki sayfa her render'da yeni bir fonksiyon geçse bile efekt
   * yeniden koşmasın; bağımlılık yalnızca satırların KENDİSİ. `getFilteredRowModel()` her
   * render'da yeni bir dizi ürettiği için bağımlılığa satır kimliklerinin imzası konuyor,
   * aksi halde setState → render → setState döngüsüne giriyordu.
   */
  const onFilteredDataChangeRef = useRef(onFilteredDataChange)
  onFilteredDataChangeRef.current = onFilteredDataChange

  const filteredRows = table.getFilteredRowModel().rows
  const filteredSignature = filteredRows.map((r) => r.id).join('|')

  React.useEffect(() => {
    onFilteredDataChangeRef.current?.(filteredRows.map((r) => r.original))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredSignature])

  const borderClass = showColumnLines ? 'border-r border-slate-200 last:border-r-0' : ''
  const hasColumnFilters = filtering?.showColumnFilters !== false && Boolean(filtering?.onColumnFilterChange)

  // Check if any column has showTotal enabled
  const hasAnyTotal = useMemo(() => {
    return tableColumns.some((col) => (col as any).meta?.showTotal)
  }, [tableColumns])

  const handleExportExcel = useMemo(() => {
    return () => {
      const rows = table.getFilteredRowModel().rows
      if (!rows || rows.length === 0) {
        toast.error('Dışa aktarılacak veri bulunamadı.')
        return
      }

      const visibleCols = table.getVisibleLeafColumns().filter((col) => {
        const id = col.id
        return id !== 'select' && id !== 'expand' && id !== 'actions' && !id.startsWith('actions_')
      })

      if (visibleCols.length === 0) {
        toast.error('Aktarılacak görünür sütun bulunamadı.')
        return
      }

      const getHeaderLabel = (col: any): string => columnLabelOf(col.columnDef, col.id)

      const headers = visibleCols.map(getHeaderLabel)
      const aoa: any[][] = [headers]

      rows.forEach((row) => {
        const rowVals: any[] = []
        visibleCols.forEach((col) => {
          let val = row.getValue(col.id)
          if (val === undefined || val === null) {
            val = (row.original as any)[col.id]
          }

          if (val === undefined || val === null) {
            rowVals.push('')
            return
          }

          if (typeof val === 'boolean') {
            rowVals.push(val ? 'Evet' : 'Hayır')
            return
          }

          if (typeof val === 'number') {
            rowVals.push(val)
            return
          }

          const strVal = String(val).trim()

          if (/[₺$€£]/.test(strVal) || /TL|EUR|USD/i.test(strVal)) {
            const clean = strVal.replace(/[₺$€£TL\s]/gi, '').trim()
            if (clean.includes(',')) {
              const num = parseFloat(clean.replace(/\./g, '').replace(',', '.'))
              rowVals.push(isNaN(num) ? strVal : num)
            } else {
              const num = parseFloat(clean)
              rowVals.push(isNaN(num) ? strVal : num)
            }
          } else if (/^-?\d{1,3}(\.\d{3})*(,\d+)?$/.test(strVal)) {
            const num = parseFloat(strVal.replace(/\./g, '').replace(',', '.'))
            rowVals.push(isNaN(num) ? strVal : num)
          } else if (/^-?\d+(\.\d+)?$/.test(strVal)) {
            const num = parseFloat(strVal)
            rowVals.push(isNaN(num) ? strVal : num)
          } else {
            rowVals.push(strVal.replace(/<[^>]*>?/gm, ''))
          }
        })
        aoa.push(rowVals)
      })

      const ws = XLSX.utils.aoa_to_sheet(aoa)
      const range = XLSX.utils.decode_range(ws['!ref'] || 'A1')

      for (let R = range.s.r + 1; R <= range.e.r; ++R) {
        for (let C = range.s.c; C <= range.e.c; ++C) {
          const cellRef = XLSX.utils.encode_cell({ r: R, c: C })
          const cell = ws[cellRef]
          if (cell && cell.t === 'n') {
            cell.z = Number.isInteger(cell.v) ? '#,##0' : '#,##0.00'
          }
        }
      }

      const colWidths = headers.map((header, colIdx) => {
        let maxLen = header.length
        for (let R = 1; R < aoa.length; R++) {
          const cellVal = aoa[R][colIdx]
          if (cellVal != null) {
            const len = String(cellVal).length
            if (len > maxLen) maxLen = len
          }
        }
        return { wch: Math.min(Math.max(maxLen + 3, 10), 38) }
      })
      ws['!cols'] = colWidths

      const name = excelFileName || toolbar?.excelFileName || `tablo-dokumu_${new Date().toISOString().slice(0, 10)}.xlsx`
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'Rapor')
      XLSX.writeFile(wb, name)
    }
  }, [table, excelFileName, toolbar?.excelFileName])

  const canShowExport = showExcelExport !== false && toolbar?.showExcelExport !== false

  const hasToolbarContent = Boolean(
    toolbar &&
      (toolbar.showSearch !== false ||
        toolbar.filterSlot ||
        toolbar.rightActionsSlot ||
        toolbar.dateRange)
  )

  return (
    <div className={`bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col ${containerClassName}`}>
      {/* Toolbar - Only rendered if explicit search/filter content exists */}
      {hasToolbarContent && (
        <DataTableToolbar
          table={table}
          config={toolbar!}
          globalFilter={filtering?.globalFilter}
          onGlobalFilterChange={filtering?.onGlobalFilterChange}
          showColumnVisibility={false}
        />
      )}

      {/* Error State Banner */}
      {states?.error && <TableErrorState error={states.error} onRetry={states.onRetry} />}

      {/*
        Yatay kaydırma sarmalayıcısı.
        `overflow-x-auto` tek başına yazılınca CSS diğer ekseni de `auto`ya çeviriyor ve bu kutu
        DİKEY bir kaydırma kabı hâline geliyordu. İçindeki `sticky` thead o kaba bağlanıyor, kap
        ise hiç dikey kaymadığı için başlık sayfayı kaydırırken YAPIŞMIYORDU — sabit
        `--table-sticky-top` değerleri de bu yüzden hiçbir işe yaramıyordu. `overflow-y-visible`
        açıkça yazılınca sticky en yakın gerçek kaydırma kabına (sayfa) bağlanıyor.
      */}
      <div ref={scrollWrapRef} className="overflow-x-auto overflow-y-visible relative w-full flex-1">
        {isCardView ? (
          states?.loading && data.length === 0 ? (
            <div className="grid grid-cols-1 gap-4 p-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="bg-white rounded-2xl border border-slate-100 p-4 animate-pulse shadow-xs">
                  <div className="h-4 bg-slate-200 rounded w-1/3 mb-3"></div>
                  <div className="h-3 bg-slate-100/80 rounded w-full mb-2"></div>
                  <div className="h-3 bg-slate-100/80 rounded w-2/3"></div>
                </div>
              ))}
            </div>
          ) : table.getRowModel().rows.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 p-3 bg-slate-50/50">
              {table.getRowModel().rows.map((row) => {
                const cells = row.getVisibleCells()
                const checkboxCell = cells.find(c => c.column.id === 'select' || c.column.id === 'id')
                const expandCell = cells.find(c => c.column.id === 'expand')
                const actionsCell = cells.find(c => c.column.id === 'actions' || c.column.id.startsWith('actions_'))
                const statusCell = cells.find(c => c.column.id === 'status')
                  ?? cells.find(c => cardLabel(c).toLocaleLowerCase('tr-TR') === 'durum')
                // "Geçen Gün" rozeti başlıkta durumun yanında: alan listesinde yer kaplamasın.
                const ageCell = cells.find(c => cardLabel(c).toLocaleLowerCase('tr-TR').includes('geçen gün'))
                const isFree = (c: any) => c !== checkboxCell && c !== expandCell && c !== actionsCell && c !== statusCell && c !== ageCell && !c.column.id.startsWith('actions')
                const titleCell = cells.find(c => isFree(c) && isRecordNoField(cardLabel(c)))
                  ?? cells.find(c => isFree(c) && cardLabel(c))
                const detailCells = cells.filter(c => isFree(c) && c !== titleCell)
                const isSelected = selection ? row.getIsSelected() : false
                const expanded = isRowExpandedRef.current ? isRowExpandedRef.current(row.original) : row.getIsExpanded()

                return (
                  <div
                    key={row.id}
                    onClick={(e) => {
                      const target = e.target as HTMLElement | null
                      if (target?.closest('button, a, input, select, textarea, [data-interactive="true"], .relative')) {
                        return
                      }
                      onRowClick?.(row.original)
                    }}
                    className={`bg-white rounded-2xl border transition-all duration-300 p-3 shadow-xs ${
                      isSelected ? 'border-red-200 bg-red-50/20' : 'border-slate-200/80 hover:border-slate-355'
                    } ${onRowClick ? 'cursor-pointer hover:shadow-md' : ''}`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0">
                        {expandCell && (
                          <div className="flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                            {flexRender(expandCell.column.columnDef.cell, expandCell.getContext())}
                          </div>
                        )}
                        {checkboxCell && (
                          <div className="scale-110 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                            {flexRender(checkboxCell.column.columnDef.cell, checkboxCell.getContext())}
                          </div>
                        )}
                        {titleCell && (
                          <div className="font-bold text-sm text-slate-900 truncate">
                            {flexRender(titleCell.column.columnDef.cell, titleCell.getContext())}
                          </div>
                        )}
                        {statusCell && (
                          <div className="flex-shrink-0">
                            {flexRender(statusCell.column.columnDef.cell, statusCell.getContext())}
                          </div>
                        )}
                        {ageCell && (
                          <div className="flex-shrink-0">
                            {flexRender(ageCell.column.columnDef.cell, ageCell.getContext())}
                          </div>
                        )}
                      </div>
                    </div>

                    {detailCells.length > 0 && <MobileCardDetails cells={detailCells} />}

                    {actionsCell && (
                      <div className="flex items-center justify-end gap-2 border-t border-slate-100/70 pt-2 mt-2 w-full" onClick={(e) => e.stopPropagation()}>
                        {flexRender(actionsCell.column.columnDef.cell, actionsCell.getContext())}
                      </div>
                    )}

                    {expanded && renderExpandedRow && (
                      <div className="mt-3 border-t border-slate-100 bg-slate-50/50 -mx-3 -mb-3 p-3 rounded-b-2xl">
                        {renderExpandedRow(row.original)}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="py-12 text-center bg-white border border-slate-200/80 rounded-2xl m-4">
              <p className="text-sm font-semibold text-slate-500">{states?.emptyTitle || 'Kayıt bulunamadı'}</p>
              <p className="text-xs text-slate-400 mt-1">{states?.emptyDescription || 'Filtreleri temizlemeyi deneyin.'}</p>
            </div>
          )
        ) : (
          /*
            `min-w-[1100px]` mobil için; `md:min-w-full` onu 768px üstünde kaldırıyor. Tablo
            yine de içeriğe göre genişleyip yatay kayabiliyor — çok kolonlu ekranlarda (Montaj
            Planlama'da 15 kolon) laptop genişliğinde bu kaçınılmaz. Çözüm kolon gizleme, o da
            yukarıdaki "Kolonlar" menüsünde: `columnVisibility` verilen sayfalarda çıkıyor.
          */
          <table className={`min-w-[1100px] md:min-w-full text-left border-collapse text-[9px] lg:text-[10px] 2xl:text-[11px] ${className}`}>
            <thead className={`bg-slate-100 text-slate-700 font-semibold border-b border-slate-200 ${stickyHeader ? 'sticky top-[var(--table-sticky-top,0px)] z-10' : ''}`}>
              {/* Header Titles Row */}
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id} className="border-b border-slate-200">
                  {headerGroup.headers.map((header) => {
                    const canSort = header.column.getCanSort()
                    const isSorted = header.column.getIsSorted()
                    const colId = header.column.id
                    const isSpecialCol = colId === 'select' || colId === 'expand' || colId === 'actions'
                    const meta = header.column.columnDef.meta

                    // Properly parse selected options array so checkboxes remain checked when reopening 3-line menu!
                    const filterStateRaw = filtering?.columnFilters?.[colId]
                    let selectedOptions: string[] = []
                    if (filterStateRaw) {
                      if (typeof filterStateRaw === 'string') {
                        selectedOptions = filterStateRaw.split(',').map((s) => s.trim()).filter(Boolean)
                      } else if (typeof filterStateRaw === 'object') {
                        if (filterStateRaw.selectedOptions && filterStateRaw.selectedOptions.length > 0) {
                          selectedOptions = filterStateRaw.selectedOptions
                        } else if (filterStateRaw.value) {
                          selectedOptions = filterStateRaw.value.split(',').map((s) => s.trim()).filter(Boolean)
                        }
                      }
                    }

                    const headerText = typeof header.column.columnDef.header === 'string' ? header.column.columnDef.header : ''
                    const isPrice = isPriceColumn(colId, headerText)

                    const isCheckboxCol = colId === 'select' || colId === 'id'
                    return (
                      <th
                        key={header.id}
                        colSpan={header.colSpan}
                        aria-sort={isSorted === 'asc' ? 'ascending' : isSorted === 'desc' ? 'descending' : undefined}
                        className={`py-1 2xl:py-1.5 ${isCheckboxCol ? 'px-1 w-10 min-w-[40px] max-w-[40px]' : 'px-1 lg:px-1.5 2xl:px-2.5'} select-none relative text-[9px] lg:text-[10px] 2xl:text-[11px] ${borderClass}`}
                        style={userWidthStyle(colId)}
                      >
                        {header.isPlaceholder ? null : (
                          <div
                            className={`flex items-center gap-1.5 ${
                              isCheckboxCol ? 'justify-center w-full' : ''
                            } ${
                              isPrice ? 'justify-end text-right w-full' : ''
                            } ${canSort ? 'cursor-pointer hover:text-slate-900' : ''}`}
                            onClick={canSort ? header.column.getToggleSortingHandler() : undefined}
                          >
                            <span className="truncate">{flexRender(header.column.columnDef.header, header.getContext())}</span>
                            {canSort && (
                              <span className="text-[9px] lg:text-[10px] text-slate-400 shrink-0">
                                {isSorted === 'asc' ? '▲' : isSorted === 'desc' ? '▼' : '⇅'}
                              </span>
                            )}
                          </div>
                        )}
                        {/* Sutun ayirici: surukle = genislik, cift tikla = otomatige don. */}
                        {prefsEnabled && !isFixedColumnId(colId) && (
                          <span
                            role="separator"
                            aria-orientation="vertical"
                            onMouseDown={startColumnResize(colId)}
                            onClick={(e) => e.stopPropagation()}
                            onDoubleClick={(e) => {
                              e.stopPropagation()
                              if (prefsView.widths[colId]) setColumnWidth(colId, null)
                            }}
                            className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize hover:bg-sky-400/70 active:bg-sky-500 z-[1]"
                            title="Sürükleyin: sütun genişliği · Çift tıklayın: otomatik genişlik"
                          />
                        )}
                      </th>
                    )
                  })}
                </tr>
              ))}

              {/* Column Filters Row */}
              {hasColumnFilters && (
                <tr className="bg-slate-50/50">
                  {table.getFlatHeaders().map((header) => {
                    const colId = header.column.id
                    const isSpecialCol = colId === 'select' || colId === 'expand' || colId === 'actions'
                    const meta = header.column.columnDef.meta
                    const isCheckboxCol = colId === 'select' || colId === 'id'

                    return (
                      <th
                        key={`filter-${header.id}`}
                        className={`py-1 2xl:py-1.5 ${isCheckboxCol ? 'px-1 w-10 min-w-[40px] max-w-[40px]' : 'px-2 2xl:px-3.5'} ${borderClass}`}
                      >
                        {!isSpecialCol && meta?.filterType ? (
                          <ColumnFilterInputCell
                            columnId={colId}
                            filterType={meta.filterType}
                            filterPlaceholder={meta.filterPlaceholder}
                            placeholder={meta.filterPlaceholder}
                            options={meta.filterOptions}
                            filterValue={filtering?.columnFilters?.[colId]}
                            value={filtering?.columnFilters?.[colId]}
                            onChange={(id, val) => filtering?.onColumnFilterChange?.(id, val)}
                          />
                        ) : null}
                      </th>
                    )
                  })}
                </tr>
              )}
            </thead>

            <tbody className="divide-y divide-slate-200 text-slate-800">
              {states?.loading && data.length === 0 ? (
                <TableSkeleton columnsCount={visibleColumnCount} rowsCount={pagination?.pageSize ?? 20} />
              ) : table.getRowModel().rows.length > 0 ? (
                table.getRowModel().rows.map((row) => {
                  const isSelected = selection ? row.getIsSelected() : false
                  const expanded = isRowExpandedRef.current ? isRowExpandedRef.current(row.original) : row.getIsExpanded()

                  return (
                    <React.Fragment key={row.id}>
                      {/* Fixed Height Uniform Table Row */}
                      <tr
                        onClick={(e) => {
                          const target = e.target as HTMLElement | null
                          if (target?.closest('button, a, input, select, textarea, [data-interactive="true"], .relative')) {
                            return
                          }
                          onRowClick?.(row.original)
                        }}
                        className={
                          rowClassName
                            ? `${rowClassName(row.original)} transition-colors ${onRowClick ? 'cursor-pointer' : ''}`
                            /*
                             * SATIR YÜKSEKLİĞİ SABİT DEĞİL, EN AZ.
                             *
                             * Burada `h-9 max-h-9` (36px) vardı ve büyük olanı (`h-11`) yalnızca
                             * `2xl:` yani 1536px ve ÜSTÜNDE devreye giriyordu. Sayfalar ise
                             * hücrelere üç-dört satır basıyor (Montaj ID: numara + "1 / 2 kalem" +
                             * "…'den bölündü"; Adet: sayı + üç alt döküm). Sonuç: 1366/1440px
                             * laptopta içerik 36px'e sıkışıp kırpılıyor, masaüstü monitörde sorun
                             * görünmüyordu — "laptopta tablo bozuk" şikayetinin kaynağı buydu.
                             * min-h ile taban korunuyor, içerik uzunsa satır büyüyor.
                             */
                            : `min-h-9 2xl:min-h-11 transition-colors ${onRowClick ? 'cursor-pointer' : ''} ${
                                isSelected ? 'bg-red-50/60 hover:bg-red-50' : 'hover:bg-slate-50/80'
                              }`
                        }
                      >
                         {row.getVisibleCells().map((cell) => {
                          const colId = cell.column.id
                          const isCheckboxCol = colId === 'select' || colId === 'id'
                          const isActionsCol = colId === 'actions' || colId.startsWith('actions')
                          const header = cell.column.columnDef.header
                          const label = typeof header === 'string' ? header : ''
                          const isPrice = isPriceColumn(colId, label)
                          return (
                            /*
                             * YALNIZCA YÜKSEKLİK KELEPÇESİ KALDIRILDI (`h-9 max-h-9` / 2xl:h-11).
                             *
                             * Asıl kusur oydu: sayfalar hücreye üç-dört satır basıyor (Montaj ID,
                             * Adet dökümü) ve 36px'lik sabit yükseklik bunları 1366/1440px
                             * laptopta kırpıyordu — büyük yükseklik yalnızca `2xl:` (1536px)
                             * üstünde açıldığı için masaüstü monitörde sorun görünmüyordu.
                             *
                             * `truncate whitespace-nowrap` KORUNDU: düz metin taşıyan hücreler
                             * eskisi gibi tek satırda kalsın. Kaldırılsaydı uzun adres/açıklama
                             * kolonları satır kaydırıp bütün listelerde satırları şişirirdi —
                             * görsel olarak doğrulayamadığım ~20 sayfayı da etkilerdi.
                             * Blok elemanlar (sayfaların kendi üst üste <div>'leri) nowrap'ten
                             * etkilenmez; onlar artık dikeyde yer bulduğu için kırpılmıyor.
                             */
                            <td
                              key={cell.id}
                              className={`py-0.5 2xl:py-1 align-middle ${isCheckboxCol ? 'px-1 w-10 min-w-[40px] max-w-[40px]' : 'px-1 lg:px-1.5 2xl:px-2.5'} text-[9px] lg:text-[10px] 2xl:text-[11px] ${isActionsCol ? 'relative overflow-visible z-20 hover:z-50 focus-within:z-50' : 'truncate whitespace-nowrap overflow-hidden text-ellipsis'} ${borderClass}`}
                              style={userWidthStyle(colId)}
                            >
                              <div className={`flex items-center ${isCheckboxCol ? 'justify-center w-full' : ''} ${isPrice ? 'justify-end text-right font-semibold text-slate-900 w-full' : ''} ${isActionsCol ? 'overflow-visible' : 'truncate whitespace-nowrap overflow-hidden'}`}>
                                {flexRender(cell.column.columnDef.cell, cell.getContext())}
                              </div>
                            </td>
                          )
                        })}
                      </tr>

                      {/* Expanded Detail Panel Row */}
                      {expanded && renderExpandedRow && (
                        <tr className="bg-slate-50/50">
                          <td colSpan={visibleColumnCount} className="p-4 border-b border-slate-200">
                            {renderExpandedRow(row.original)}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  )
                })
              ) : (
                <tr>
                  <td colSpan={visibleColumnCount} className="py-12 text-center text-slate-400">
                    <div className="flex flex-col items-center justify-center gap-1">
                      <span className="font-semibold text-sm text-slate-500">{states?.emptyTitle || 'Kayıt bulunamadı'}</span>
                      <span className="text-xs text-slate-400">{states?.emptyDescription || 'Filtreleri temizlemeyi deneyin.'}</span>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>

            {/* Render footer summary row if enabled */}
            {showFooterTotals && table.getFlatHeaders().some(h => h.column.columnDef.meta?.showTotal) && (
              <tfoot className="bg-slate-50 font-bold border-t-2 border-slate-200 text-slate-900">
                <tr className="h-10 max-h-10">
                  {table.getFlatHeaders().map((header, idx) => {
                    const colId = header.column.id
                    const meta = header.column.columnDef.meta
                    const headerText = typeof header.column.columnDef.header === 'string' ? header.column.columnDef.header : ''
                    const isPrice = isPriceColumn(colId, headerText)
                    const border = idx < table.getFlatHeaders().length - 1 ? 'border-r border-slate-200' : ''

                    if (idx === 0) {
                      return (
                        <td key="footer-total-label" className={`py-2.5 px-3.5 text-left border-l border-slate-200 ${border}`}>
                          TOPLAM
                        </td>
                      )
                    }

                    if (meta?.showTotal) {
                      const rows = table.getFilteredRowModel().rows
                      const sum = rows.reduce((acc, r) => {
                        const val = r.getValue(colId)
                        const num = Number(val)
                        return acc + (isNaN(num) ? 0 : num)
                      }, 0)

                      return (
                        <td key={`footer-total-${colId}`} className={`py-2.5 px-3.5 ${isPrice ? 'text-right' : 'text-left'} ${border}`}>
                          {formatCurrencyLocal(sum)}
                        </td>
                      )
                    }

                    return <td key={`footer-empty-${idx}`} className={`py-2.5 px-3.5 ${border}`}></td>
                  })}
                </tr>
              </tfoot>
            )}
          </table>
        )}
      </div>

      {/* Pagination Footer & Bottom-Left Excel Button */}
      {pagination ? (
        <DataTablePagination
          pageIndex={pagination.pageIndex}
          pageSize={pagination.pageSize}
          totalCount={isManualFiltering ? pagination.totalCount : table.getFilteredRowModel().rows.length}
          pageCount={isManualFiltering ? pagination.pageCount : table.getPageCount()}
          onPageChange={pagination.onPageChange}
          onPageSizeChange={pagination.onPageSizeChange}
          pageSizeOptions={pagination.pageSizeOptions}
          onExportExcel={canShowExport ? handleExportExcel : undefined}
          settingsSlot={settingsButton}
        />
      ) : canShowExport ? (
        <div className="flex items-center justify-start gap-3 px-4 py-2.5 border-t border-slate-100 bg-white rounded-b-xl">
          <button
            type="button"
            onClick={handleExportExcel}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 transition-colors cursor-pointer"
            title="Excel'e Aktar"
          >
            <FileSpreadsheet size={15} className="text-emerald-600" />
            <span>Excel</span>
          </button>
          {settingsButton}
        </div>
      ) : null}
    </div>
  )
}
