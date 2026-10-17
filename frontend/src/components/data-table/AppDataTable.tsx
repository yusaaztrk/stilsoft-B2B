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
import { ColumnHeaderFilterMenu } from './ColumnHeaderFilterMenu'
import { ColumnFilterInputCell } from './ColumnFilterInputCell'
import { OverflowTooltip } from '../common/OverflowTooltip'
import { DataTableSettingsMenu, MAX_COLUMN_WIDTH, MIN_COLUMN_WIDTH, type SettingsColumn } from './DataTableSettingsMenu'
import { tablePrefsKey, useTablePrefs } from '../../lib/tablePreferences'
import { normalizeTurkishForSearch, normalizeForSearch, matchTurkishString, turkishIncludes } from '../../utils/turkishSearch'
import type { AppDataTableProps, ColumnFilterStateValue } from './types'

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

function isPriceColumn(key: string, label: string): boolean {
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
  if (typeof val === 'boolean') return val ? 'true evet yes' : 'false hayir hayır no'
  if (typeof val === 'object') {
    return Object.values(val)
      .filter((v) => v != null && typeof v !== 'object' && typeof v !== 'function')
      .map((v) => String(v))
      .join(' ')
  }
  const s = String(val).trim()
  const lower = s.toLowerCase()
  if (lower === 'true') return 'true evet yes'
  if (lower === 'false') return 'false hayir hayır no'
  return s
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

// Exported for backwards compatibility
export { normalizeTurkishForSearch, normalizeForSearch, matchTurkishString }
const matchStringWithPhoneFlexibility = matchTurkishString

/**
 * Custom column filter function that handles our ColumnFilterStateValue format.
 * This is the heart of client-side filtering — it interprets operators like
 * contains, eq, between, in, starts_with, etc.
 */
/**
 * SEÇİM KUTUSU SÜZGECİ TAM EŞLEŞİR (2026-08-22).
 *
 * Açılır listeden seçilen değer serbest metin değil, KAPALI BİR LİSTEDEN gelir; alt dizi
 * araması orada yanlış cevap üretiyordu. Somut hata: Banka Hesap Tanımları'nda "Hesap Tip"
 * süzgecinden "0 vadesiz hesap" seçilince 300, 20, 10 gibi TÜM türler de listede kalıyordu —
 * çünkü `'300'` metni `'0'` içeriyor. Aynı tuzak "3 teminat hesabı" için 300'de tekrar ediyor.
 *
 * Serbest metin sütunları (`text`, `number`, `date`) eskisi gibi `appColumnFilterFn` kullanır;
 * orada alt dizi araması DOĞRU davranış — kullanıcı kelimenin bir parçasını yazıyor.
 */
/**
 * MANTIKSAL HÜCRENİN EŞLEŞEBİLECEĞİ DEĞERLER (2026-08-23, kullanıcı bildirimi).
 *
 * `normalizeToString(true)` arama kolaylığı için `"true evet yes"` üretiyor. Serbest metin
 * süzgecinde bu doğru — kullanıcı "evet" yazınca da bulsun diye. Ama seçim kutusu TAM
 * EŞLEŞTİĞİ için `"true evet yes" === "true"` tutmuyordu ve sonuç HİÇBİR SATIR oluyordu:
 * Cari listesinde "Durum: Aktif" seçilince liste boşalıyor, süzgeç kaldırılınca geri geliyordu.
 * Aynı tuzak Ürün Yönetimi'ndeki "Durum" sütununda da vardı.
 *
 * Çözüm: mantıksal hücre için tek bir metin değil, kabul edilebilir değerler LİSTESİ
 * karşılaştırılıyor. Sayfalar seçenek değeri olarak `true/false` da `Aktif/Pasif` de
 * yazabiliyor; ikisi de tutar. Yanlış eşleşme riski yok — iki listenin ortak öğesi yok.
 */
const BOOLEAN_MATCH_TOKENS = {
  true: ['true', 'evet', 'yes', 'aktif', 'var', 'acik', 'açık', '1'],
  false: ['false', 'hayir', 'hayır', 'no', 'pasif', 'yok', 'kapali', 'kapalı', '0']
} as const

const appExactColumnFilterFn: FilterFn<any> = (row: Row<any>, columnId: string, filterValue: ColumnFilterStateValue | string) => {
  let cellValue = row.getValue(columnId)
  if (cellValue === undefined || cellValue === null) {
    cellValue = row.original[columnId]
  }
  if (cellValue === undefined || cellValue === null) {
    const camelKey = columnId.charAt(0).toLowerCase() + columnId.slice(1)
    const pascalKey = columnId.charAt(0).toUpperCase() + columnId.slice(1)
    cellValue = row.original[camelKey] ?? row.original[pascalKey] ?? ''
  }

  const cellTokens = typeof cellValue === 'boolean'
    ? BOOLEAN_MATCH_TOKENS[cellValue ? 'true' : 'false'].map((t) => normalizeTurkishForSearch(t).trim())
    : [normalizeTurkishForSearch(normalizeToString(cellValue)).trim()]
  const equals = (option: string) => {
    const opt = normalizeTurkishForSearch(option).trim()
    return cellTokens.includes(opt)
  }

  if (typeof filterValue === 'string') {
    const search = filterValue.trim()
    return !search || equals(search)
  }

  const { value = '', operator = 'contains', selectedOptions } = filterValue ?? ({} as ColumnFilterStateValue)

  if (selectedOptions && selectedOptions.length > 0) {
    return selectedOptions.some(equals)
  }

  if (operator === 'in' && value) {
    const options = value.split(',').map((x) => x.trim()).filter(Boolean)
    return options.length === 0 || options.some(equals)
  }

  const searchVal = (value ?? '').trim()
  return !searchVal || equals(searchVal)
}

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

  const cellStr = normalizeToString(cellValue)

  // Simple string filter
  if (typeof filterValue === 'string') {
    const search = filterValue.trim()
    if (!search) return true
    return matchTurkishString(cellStr, search, 'contains')
  }

  // Object-based filter (ColumnFilterStateValue)
  const { value = '', value2 = '', operator = 'contains', selectedOptions } = filterValue

  // Handle multi-select "in" operator
  if (selectedOptions && selectedOptions.length > 0) {
    return selectedOptions.some((opt) => matchTurkishString(cellStr, opt, 'contains'))
  }

  // Handle value-based "in" operator (comma-separated)
  if (operator === 'in' && value) {
    const options = value.split(',').map((s) => s.trim()).filter(Boolean)
    if (options.length === 0) return true
    return options.some((opt) => matchTurkishString(cellStr, opt, 'contains'))
  }

  const searchVal = (value ?? '').trim()
  if (!searchVal) return true

  // Date comparison check FIRST (if searchVal and cellStr can be parsed as dates)
  const searchDate = parseDateToComparable(searchVal)
  const cellDate = parseDateToComparable(cellStr)
  if (cellDate && searchDate) {
    if (operator === 'between') {
      return dateRangeMatch(cellStr, searchVal, (value2 || searchVal).trim())
    }
    if (operator === 'eq') return cellDate === searchDate
    if (operator === 'neq') return cellDate !== searchDate
    if (operator === 'lt') return cellDate < searchDate
    if (operator === 'lte') return cellDate <= searchDate
    if (operator === 'gt') return cellDate > searchDate
    if (operator === 'gte') return cellDate >= searchDate
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
      return dateRangeMatch(cellStr, searchVal, (value2 || searchVal).trim())
    }

    // Fall through to string comparison for eq/neq on non-numeric
    if (operator === 'eq' || operator === 'neq') {
      return matchTurkishString(cellStr, searchVal, operator)
    }
  }

  // String operators
  return matchTurkishString(cellStr, searchVal, operator)
}

/**
 * Date range matching helper for Turkish date format (dd.MM.yyyy).
 */
function dateRangeMatch(cellStr: string, from: string, to: string): boolean {
  const cellDate = parseDateToComparable(cellStr)
  const fromDate = parseDateToComparable(from)
  const toDate = parseDateToComparable(to)
  if (!cellDate) return true // If can't parse cell date, don't filter it out
  if (!fromDate && !toDate) return true
  if (fromDate && toDate) return cellDate >= fromDate && cellDate <= toDate
  if (fromDate) return cellDate >= fromDate
  if (toDate) return cellDate <= toDate
  return true
}

/**
 * Bir hucre ya da suzgec metnini `yyyy-MM-dd`'ye indirger. Karsilastirmalar bu bicim
 * uzerinden yapiliyor.
 *
 * SAAT KISMI ONCE ATILIR (2026-08-22). Tablolarin hepsi tarihi ayni yazmiyor: kimi
 * `22.08.2026`, kimi `22.08.2026 14:30`, kimi `2026-08-22T14:30:00`. Noktali bicimde saat
 * atilmadiginda yila yapisiyor ("2026 14:30") ve ortaya `2026 14:30-08-22` gibi hicbir
 * seyle eslesmeyen bir anahtar cikiyordu — o kolonda tarih suzgeci sessizce hicbir satir
 * dondurmuyordu.
 */
function parseDateToComparable(str: string): string | null {
  if (!str) return null
  const raw = str.trim()
  if (!raw) return null

  const pad = (n: number) => String(n).padStart(2, '0')
  const localYmd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

  /*
    ZAMAN DAMGASI YEREL GUNE CEVRILIR (2026-08-23).

    Cek/senet tarihleri veritabaninda YEREL GECE YARISININ UTC karsiligi olarak durur:
    `2026-09-09` (+03) => `2026-09-08T21:00:00Z`. Ekran `toLocaleDateString` ile bastigi
    icin listede dogru gun (09.09.2026) gorunuyordu, ama burasi metnin ilk 10 karakterini
    aliyordu => `2026-09-08`. Sonuc:
      - Vade suzgecine 09.09.2026 yazilinca "Kayit bulunamadi",
      - 08.09.2026 yazilinca satir GELIYOR ama kolonda 09.09.2026 yaziyordu.
    Yani suzgec UTC gununu, ekran yerel gunu konusuyordu.

    Kural: metin bir ANI (saat + Z/ofset) tasiyorsa gun YEREL alanlardan okunur; saf tarih
    (`2026-09-09`, `09.09.2026`) ise oldugu gibi alinir — onlarin saat dilimi yoktur ve
    `new Date` onlari UTC sanip bir gun geri kaydirir.
  */
  const isoInstant = /^\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}/.test(raw)
  if (isoInstant) {
    const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(raw)
    if (hasZone) {
      const d = new Date(raw)
      if (!isNaN(d.getTime())) return localYmd(d)
    }
    // Saat var ama saat dilimi yok: ani degil, yerel tarih-saat. Gun kismi zaten dogru.
    return raw.substring(0, 10)
  }

  // Saat ya `T` ya da bosluk ile ayriliyor; ikisini de kesiyoruz.
  const trimmed = raw.split(/[T\s]/)[0]
  if (!trimmed) return null

  // dd.MM.yyyy
  const dotParts = trimmed.split('.')
  if (dotParts.length === 3 && dotParts[0].length <= 2 && dotParts[1].length <= 2) {
    return `${dotParts[2].padStart(4, '0')}-${dotParts[1].padStart(2, '0')}-${dotParts[0].padStart(2, '0')}`
  }

  // dd/MM/yyyy
  const slashParts = trimmed.split('/')
  if (slashParts.length === 3 && slashParts[0].length <= 2 && slashParts[1].length <= 2) {
    return `${slashParts[2].padStart(4, '0')}-${slashParts[1].padStart(2, '0')}-${slashParts[0].padStart(2, '0')}`
  }

  // yyyy-MM-dd (saf tarih; saat dilimi yok, oldugu gibi karsilastirilabilir)
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed

  /*
    GENEL `new Date(...)` YEDEGI KALDIRILDI (2026-08-23).

    Motor "1234" gibi duz sayilari da gecerli bir tarih (yil 1234) sayiyor. Bu yedek
    durdugunda cek numarasi / fatura numarasi gibi sayi kolonlari "tarih" muamelesi
    goruyor ve siralama bozuluyordu. Tarih olarak yalniz TANINAN bicimler kabul edilir.
  */
  return null
}

/** Bugunun tarihi, tablolarin ve takvim secicisinin kullandigi `dd.MM.yyyy` biciminde. */
function formatTodayTr(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`
}

/**
 * VADE kolonlari bugune ayarlanmaz.
 *
 * Vade GELECEK bir tarih: bugune sabitlenirse cek/senet ve termin listeleri acilir acilmaz
 * bos gelir ve kullanici tablonun bozuldugunu sanir. Islem tarihi kolonlarinda ise bugun
 * anlamli bir baslangic.
 */
const DUE_DATE_COLUMN_HINTS = ['vade', 'duedate', 'maturity', 'termin']

function isDueDateColumnId(colId: string): boolean {
  const key = colId.toLowerCase().replace(/[\s_-]/g, '')
  return DUE_DATE_COLUMN_HINTS.some((hint) => key.includes(hint))
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

  /*
    TARIH SINAMASI SAYIDAN ONCE (2026-08-23).

    Once sayi denenirken tarih kolonlari yanlis siralaniyordu, cunku `parseFloat` tarihleri
    de "sayi" sayiyor:
      - `parseFloat('09.09.2026')`          => 9.09   (ikinci noktada durur; gune gore siralar)
      - `parseFloat('2026-09-08T21:00:00Z')` => 2026   (butun satirlar ayni yila esitlenir,
                                                        siralama hic calismaz)
    Bu yuzden vade/giris tarihi kolonlarinda ok'a basmak siralamayi degistirmiyor ya da
    saçma bir sira uretiyordu. Tarih tanimliysa tarih olarak karsilastirilir; degilse sayi.

    `parseDateToComparable` artik yalniz TANINAN tarih bicimlerini kabul ediyor, dolayisiyla
    cek no / fatura no gibi duz sayilar bu dala hic girmez.
  */
  const dateA = parseDateToComparable(String(valA))
  const dateB = parseDateToComparable(String(valB))

  if (dateA && dateB) {
    return dateA < dateB ? -1 : dateA > dateB ? 1 : 0
  }

  // Check if cell is formatted money or plain number
  const numA = typeof valA === 'number' ? valA : parseNumericValue(valA)
  const numB = typeof valB === 'number' ? valB : parseNumericValue(valB)

  if (Number.isFinite(numA) && Number.isFinite(numB)) {
    return numA < numB ? -1 : numA > numB ? 1 : 0
  }

  // Fallback string sorting using Turkish locale
  const strA = normalizeToString(valA).toLowerCase().trim()
  const strB = normalizeToString(valB).toLowerCase().trim()
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
 * Kullanicinin AYARLAYAMADIGI sutunlar: secim kutusu, genislet oku, islem dugmeleri.
 * Bunlar gizlenmez, yer degistirmez; ayar penceresinde de listelenmez.
 */
function isFixedColumnId(id: string): boolean {
  return id === 'select' || id === 'expand' || id === 'actions' || id.startsWith('actions_') || id === '__selected'
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
  stickyHeader = true,
  showColumnLines = true,
  rowClassName,
  className = '',
  containerClassName = '',
  onFilteredRowsChange,
  onRefresh,
  refreshing,
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

  /**
   * TARIH SUZGECLERI ILK ACILISTA BUGUNE AYARLANIR (2026-08-22).
   *
   * Tek yer BURASI. `Table` de dogrudan `AppDataTable` kullanan sayfalar da buradan gectigi
   * icin kural butun tablolarda ayni.
   *
   * Her kolon YALNIZCA BIR KEZ tohumlanir (`seededDateColumnsRef`). Aksi halde kullanici
   * X'e basip suzgeci temizledigi anda bir sonraki render onu geri koyar ve suzgec
   * temizlenemezdi.
   *
   * Sayfa o kolon icin kendi baslangic suzgecini vermisse dokunulmaz; vade kolonlari da
   * disarida (bkz. `isDueDateColumnId`). Bir tablo tumuyle disarida kalsin isteniyorsa
   * `filtering.disableDateDefaultToday` verilir.
   *
   * DIKKAT: bu, tablolarin acilista YALNIZCA BUGUNU gostermesi demek. Gecmis kayitlar
   * suzgec temizlenmeden gorunmez.
   */
  const seededDateColumnsRef = useRef<Set<string>>(new Set())
  const filteringRef = useRef(filtering)
  filteringRef.current = filtering

  React.useEffect(() => {
    const config = filteringRef.current
    if (!config || config.disableDateDefaultToday === true) return

    const pushFilter = config.onColumnFilterChange
    if (typeof pushFilter !== 'function') return

    const today = formatTodayTr()

    for (const col of columns) {
      const colId = String((col as any)?.id ?? (col as any)?.accessorKey ?? '')
      if (!colId) continue
      if ((col as any)?.meta?.filterType !== 'date') continue
      if (isDueDateColumnId(colId)) continue
      if (seededDateColumnsRef.current.has(colId)) continue

      // Isaret DENEMEDEN once konur: sayfanin kendi suzgeci yuzunden atlanan bir kolon da
      // "islendi" sayilmali, yoksa o suzgec kalkinca kolon sonradan bugune sicrardi.
      seededDateColumnsRef.current.add(colId)

      if (config.columnFilters?.[colId]) continue

      pushFilter(colId, { value: today, operator: 'eq' })
    }
  }, [columns])

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
      // Kapalı listeden seçilen sütunlar TAM eşleşir; serbest metin sütunları alt dizi arar.
      const optionFilter = colDef.meta?.filterType === 'select' || colDef.meta?.filterType === 'checkbox'
      const baseFilterFn =
        colDef.filterFn ??
        (colDef.enableColumnFilter !== false
          ? ((optionFilter ? appExactColumnFilterFn : appColumnFilterFn) as FilterFn<TData>)
          : undefined)

      /**
       * DEVİR (AÇILIŞ) SATIRI HİÇBİR SÜTUN SÜZGECİYLE ELENMEZ (2026-08-22).
       *
       * Devir satırının tarihi devir tarihidir; tarih süzgeci bugüne ayarlıyken satır
       * listeden düşüyordu. Düştüğü anda yürüyen bakiye sıfırdan başlıyor ve tablo,
       * kutudaki bakiyeyi tutturamıyor — kullanıcının "devir gelmiyor" dediği şey buydu.
       *
       * Açılış bakiyesi bir HAREKET değil, listenin başlangıç noktası: hangi süzgeç
       * uygulanırsa uygulansın yerinde kalmalı. Satırlar bu bayrağı kendileri taşıyor
       * (`isOpeningBalance`), kasa ve banka ekranları zaten koyuyordu.
       */
      const filterFn: FilterFn<TData> | undefined = baseFilterFn
        ? (((row: any, columnId: any, value: any, addMeta: any) =>
            row?.original?.isOpeningBalance === true
              ? true
              : (baseFilterFn as any)(row, columnId, value, addMeta)) as FilterFn<TData>)
        : undefined
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
                className="p-1.5 rounded-md hover:bg-sky-50 text-sky-600 hover:text-sky-800 transition-colors cursor-pointer"
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
    getRowId: rowId ? (row, idx) => rowId(row, idx) : (row, idx) => (row.id ? String(row.id) : String(idx)),
    // Manual modes — only use when the page does server-side operations
    manualPagination: isManualFiltering,
    manualSorting: false, // Always allow client-side sorting
    manualFiltering: isManualFiltering,
    pageCount: isManualFiltering
      ? (pagination?.pageCount ?? (pagination ? Math.ceil(pagination.totalCount / pagination.pageSize) : -1))
      : undefined,
    autoResetPageIndex: false,
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
      const search = filterValue.trim()
      if (!search) return true

      // 1. Search visible cells
      const matchCell = row.getVisibleCells().some((cell) => {
        const val = cell.getValue()
        if (val == null) return false
        const cellStr = normalizeToString(val)
        return matchTurkishString(cellStr, search, 'contains')
      })
      if (matchCell) return true

      // 2. Search all primitive properties of row.original for non-visible columns / raw fields
      const orig = row.original
      if (orig && typeof orig === 'object') {
        return Object.values(orig).some((val) => {
          if (val == null) return false
          if (typeof val === 'object' || typeof val === 'function') return false
          const str = normalizeToString(val)
          return matchTurkishString(str, search, 'contains')
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
    TABLO AYARLARI — KULLANICI BAZLI (2026-10-11, kullanici istegi).

    Sol alttaki "Ayarlar" dugmesinden: sutunu gizle/goster, sirayi degistir, genislik ver.
    Secimler kullaniciya ozel saklanir (tarayici + sunucu) ve sayfa yeniden acildiginda tablo
    ayni ayarla gelir. Ayrinti: lib/tablePreferences.ts.

    Sutun kimlikleri TABLODAN okunur (tablonun kendi turettigi kimlik), sonra sira ve gorunurluk
    `setOptions` ile duruma yazilir — TanStack'in "tam denetimli durum" kalibi. Kimligi kendimiz
    turetseydik motorunkiyle ayrisan tek sutun sirayi bozardi.

    Sabit sutunlar (secim, genislet, islemler) yerinden oynamaz: sira yalniz AYARLANABILIR
    sutunlarin kendi aralarinda degisir.
  */
  const allLeafIds = table.getAllLeafColumns().map((c) => c.id)
  const allLeafIdsKey = allLeafIds.join('|')
  const configurableIds = useMemo(() => allLeafIds.filter((id) => !isFixedColumnId(id)), [allLeafIdsKey])
  const prefsEnabled = preferencesKey !== false && configurableIds.length > 1
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

    let hidden = new Set((prefs.hidden ?? []).filter((id) => known.has(id)))
    // Eski kayit bugunku sutunlarin HEPSINI gizliyorsa yok sayilir: bos tablo acilmaz.
    if (hidden.size >= configurableIds.length) hidden = new Set()

    const widths: Record<string, number> = {}
    for (const [id, w] of Object.entries(prefs.widths ?? {})) {
      if (known.has(id) && Number.isFinite(w) && w > 0) widths[id] = clampColumnWidth(Number(w))
    }

    // Sabit sutunlar kendi konumunda kalir; ayarlanabilir yuvalar kullanici sirasiyla dolar.
    const queue = [...ordered]
    const fullOrder = allLeafIds.map((id) => (isFixedColumnId(id) ? id : (queue.shift() as string)))
    const visibility: Record<string, boolean> = { ...(columnVisibility?.columnVisibility ?? {}) }
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
    BASLIKTAN SURUKLEYEREK GENISLIK. Surukleme boyunca tablo yeniden CIZILMEZ (sayfa boyutu
    "Sinirsiz" iken binlerce satir var): yalniz mavi bir kilavuz cizgisi fareyi izler, genislik
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
    SUZGECTEN GECEN SATIRLARI SAYFAYA BILDIR (2026-08-23).

    Kolon suzgecleri tablonun icinde calisiyor ve disari hicbir sey sizmiyordu. Sayfalar
    ustteki ozet kutularini (adet / toplam tutar / ortalama vade) kendi ham verilerinden
    hesapladigi icin ozet ile ekranda gorunen satirlar birbirini tutmuyordu: cek listesinde
    vadeye gore suzulup tek satir kalirken ustte hala 15 cekin toplami yaziyordu.

    Bagimlilik satir DIZISI degil, satir KIMLIKLERI uzerinden kurulu: `rows` her render'da
    yeni bir dizi nesnesi olur ve diziye baglanmak sonsuz donguye yol acardi.
  */
  const filteredRowsCallbackRef = useRef(onFilteredRowsChange)
  filteredRowsCallbackRef.current = onFilteredRowsChange

  const filteredRows = table.getFilteredRowModel().rows
  const filteredRowsKey = filteredRows.map((r) => r.id).join('|')

  React.useEffect(() => {
    const cb = filteredRowsCallbackRef.current
    if (typeof cb !== 'function') return
    cb(filteredRows.map((r) => r.original))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredRowsKey])

  const borderClass = showColumnLines ? 'border-r border-slate-200 last:border-r-0' : ''
  const hasColumnFilters = filtering?.showColumnFilters !== false && Boolean(filtering?.onColumnFilterChange)

  // Check if any column has showTotal enabled
  /**
   * PERFORMANS (2026-08-22): "para sütunu mu" kararı SÜTUN BAŞINA bir kez.
   *
   * `isPriceColumn` sütun adı ve başlık üzerinde onlarca `includes` çalıştırıyor ve
   * bu, HER HÜCREDE HER RENDER'DA çağrılıyordu. Sütun kimliği ile başlığı render'dan
   * render'a değişmediği için sonuç önbelleğe alınabilir.
   */
  const priceColumnIds = useMemo(() => {
    const set = new Set<string>()
    for (const col of tableColumns) {
      const id = String((col as any).id ?? (col as any).accessorKey ?? '')
      if (!id) continue
      const header = (col as any).header
      const label = typeof header === 'string' ? header : ''
      if (isPriceColumn(id, label)) set.add(id)
    }
    return set
  }, [tableColumns])

  const hasAnyTotal = useMemo(() => {
    return tableColumns.some((col) => (col as any).meta?.showTotal)
  }, [tableColumns])

  const handleExportExcel = useMemo(() => {
    return () => {
      const rows = table.getFilteredRowModel().rows
      if (!rows || rows.length === 0) {
        alert('Dışa aktarılacak veri bulunamadı.')
        return
      }

      const visibleCols = table.getVisibleLeafColumns().filter((col) => {
        const id = col.id
        return id !== 'select' && id !== 'expand' && id !== 'actions' && !id.startsWith('actions_')
      })

      if (visibleCols.length === 0) {
        alert('Aktarılacak görünür sütun bulunamadı.')
        return
      }

      const getHeaderLabel = (col: any): string => columnLabelOf(col.columnDef, col.id)

      const headers = visibleCols.map(getHeaderLabel)
      const aoa: any[][] = [headers]

      // EXCEL'DE PARA BİRİMİ KAYBOLMASIN (2026-08-19).
      //
      // Aktarım tutarı sayıya çevirmek için sembolü SİLİYORDU: dolarlı bir satır ile TL bir
      // satır Excel'de birbirinin aynı görünüyor, hangisinin hangi parada olduğu anlaşılmıyordu.
      // Değer sayı kalmalı (toplam alınabilsin) ama HÜCRE BİÇİMİ sembolü taşımalı. Satır/sütun
      // bazında yakalanan sembol burada birikiyor, aşağıda `cell.z`ye yazılıyor.
      const cellCurrency: Record<string, string> = {}

      const detectCurrencySymbol = (raw: string): string | null => {
        if (raw.includes('₺')) return '₺'
        if (raw.includes('$')) return '$'
        if (raw.includes('€')) return '€'
        if (raw.includes('£')) return '£'
        const upper = raw.toUpperCase()
        if (/\bUSD\b/.test(upper)) return '$'
        if (/\bEUR\b/.test(upper)) return '€'
        if (/\bGBP\b/.test(upper)) return '£'
        if (/\b(TL|TRY)\b/.test(upper)) return '₺'
        return null
      }

      rows.forEach((row, rowIdx) => {
        const rowVals: any[] = []
        visibleCols.forEach((col, colIdx) => {
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

          // GBP eskiden bu dala HİÇ girmiyordu (`/TL|EUR|USD/`): sterlinli tutar metin
          // olarak aktarılıyor, Excel'de toplanamıyordu. Sembol de artık atılmıyor,
          // hücre biçimine taşınıyor.
          const detectedSymbol = detectCurrencySymbol(strVal)

          if (detectedSymbol) {
            const clean = strVal.replace(/[₺$€£]/g, '').replace(/\b(TL|TRY|USD|EUR|GBP)\b/gi, '').replace(/\s/g, '').trim()
            const num = clean.includes(',')
              ? parseFloat(clean.replace(/\./g, '').replace(',', '.'))
              : parseFloat(clean)

            if (isNaN(num)) {
              rowVals.push(strVal)
            } else {
              rowVals.push(num)
              cellCurrency[`${rowIdx + 1}:${colIdx}`] = detectedSymbol
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
            const symbol = cellCurrency[`${R}:${C}`]
            if (symbol) {
              // Değer sayı kalır (toplanabilir), sembol biçimden gelir.
              cell.z = `"${symbol}"#,##0.00`
            } else {
              cell.z = Number.isInteger(cell.v) ? '#,##0' : '#,##0.00'
            }
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
          showColumnVisibility={Boolean(columnVisibility)}
        />
      )}

      {/* Error State Banner */}
      {states?.error && <TableErrorState error={states.error} onRetry={states.onRetry} />}

      {/* Scrollable Table Wrapper */}
      <div ref={scrollWrapRef} className="overflow-x-auto relative w-full flex-1">
        <table className={`min-w-[1100px] md:min-w-full text-left border-collapse text-xs ${className}`}>
          <thead className={`bg-slate-100/90 backdrop-blur-sm text-slate-700 font-semibold border-b border-slate-200 ${stickyHeader ? 'sticky top-0 z-10' : ''}`}>
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

                  const isPrice = priceColumnIds.has(colId)

                  return (
                    <th
                      key={header.id}
                      colSpan={header.colSpan}
                      aria-sort={isSorted === 'asc' ? 'ascending' : isSorted === 'desc' ? 'descending' : undefined}
                      className={`py-3 px-3.5 select-none relative ${borderClass}`}
                      // Kullanicinin verdigi genislik once gelir; yoksa sayfanin `meta.width`'i.
                      // Ikisi de yoksa sutun icerige gore dagilir.
                      style={
                        userWidthStyle(colId) ??
                        ((header.column.columnDef.meta as any)?.width ? { width: (header.column.columnDef.meta as any).width } : undefined)
                      }
                    >
                      {header.isPlaceholder ? null : (
                        <div
                          className={`flex items-center gap-1.5 ${
                            isPrice ? 'justify-end text-right w-full' : ''
                          } ${canSort ? 'cursor-pointer hover:text-slate-900' : ''}`}
                          onClick={canSort ? header.column.getToggleSortingHandler() : undefined}
                          // Ok isareti tek basina ne olacagini soylemiyor; tiklamanin SONUCU
                          // yaziyla anlatiliyor. Sira TanStack varsayilani: artan -> azalan -> yok.
                          title={
                            canSort
                              ? isSorted === 'asc'
                                ? 'Büyükten küçüğe sırala'
                                : isSorted === 'desc'
                                ? 'Sıralamayı kaldır'
                                : 'Küçükten büyüğe sırala'
                              : undefined
                          }
                        >
                          <OverflowTooltip as="span" className="truncate">
                            {flexRender(header.column.columnDef.header, header.getContext())}
                          </OverflowTooltip>
                          {canSort && (
                            <span className="text-[10px] text-slate-400 shrink-0">
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

                  return (
                    <th key={`filter-${header.id}`} className={`py-1.5 px-2 ${borderClass}`}>
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
                        /*
                          SATIRA TIKLAMA HİÇBİR TABLODA ÇALIŞMIYORDU (2026-09-09'da bulundu).

                          Kapı `target.closest(...)` ile kuruluyordu ve listede `.relative` de
                          vardı — niyet "hücre içindeki açılır menü sarmalayıcısına tıklandıysa
                          satırı açma" idi. Ama TABLONUN KENDİ KAYDIRMA KABI da `relative`
                          (`overflow-x-auto relative w-full flex-1`), ve `closest` satırın
                          dışına çıkıp onu buluyor. Yani her tıklama yutuluyordu: `onRowClick`
                          veren bütün sayfalarda (e-ticaret siparişleri, mutabakat, raporlar)
                          satıra tıklamak hiçbir şey yapmıyordu ve ekrandaki "satıra tıklayınca
                          detay açılır" yazısı yıllardır yanlıştı.

                          Düzeltme: bulunan öğe SATIRIN İÇİNDE olmalı. `e.currentTarget` bu
                          `<tr>`; kaydırma kabı onun ATASI olduğu için artık eşleşmiyor,
                          satır içindeki düğme/bağlantı/menü ise eşleşmeye devam ediyor.
                        */
                        const target = e.target as HTMLElement | null
                        const interactive = target?.closest(
                          'button, a, input, select, textarea, [data-interactive="true"], .relative'
                        )
                        if (interactive && e.currentTarget.contains(interactive)) {
                          return
                        }
                        onRowClick?.(row.original)
                      }}
                      className={
                        rowClassName
                          ? `${rowClassName(row.original)} transition-colors ${onRowClick ? 'cursor-pointer' : ''}`
                          : `h-11 max-h-11 transition-colors ${onRowClick ? 'cursor-pointer' : ''} ${
                              isSelected ? 'bg-sky-50/60 hover:bg-sky-50' : 'hover:bg-slate-50/80'
                            }`
                      }
                    >
                      {row.getVisibleCells().map((cell) => {
                        const isPrice = priceColumnIds.has(cell.column.id)
                        return (
                          <td
                            key={cell.id}
                            className={`py-2 px-3.5 h-11 max-h-11 truncate whitespace-nowrap overflow-hidden text-ellipsis ${borderClass}`}
                            style={userWidthStyle(cell.column.id)}
                          >
                            <OverflowTooltip
                              className={`whitespace-nowrap overflow-hidden flex items-center ${
                                isPrice ? 'justify-end text-right font-semibold text-slate-900 w-full' : 'w-full'
                              }`}
                            >
                              {flexRender(cell.column.columnDef.cell, cell.getContext())}
                            </OverflowTooltip>
                          </td>
                        )
                      })}
                    </tr>

                    {/* Expanded Detail Panel Row */}
                    {expanded && renderExpandedRow && (
                      <tr className="bg-slate-50/80 border-b border-slate-200">
                        <td colSpan={visibleColumnCount} className="p-4 border-r border-slate-200">
                          {renderExpandedRow(row.original)}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                )
              })
            ) : (
              <tr>
                <td colSpan={visibleColumnCount} className="border-r border-slate-200">
                  <TableEmptyState
                    title={states?.emptyTitle}
                    description={states?.emptyDescription}
                    onClearFilters={filtering?.globalFilter ? () => filtering?.onGlobalFilterChange?.('') : undefined}
                  />
                </td>
              </tr>
            )}
          </tbody>

          {/* Totals Footer Row at Bottom of Table */}
          {showFooterTotals && hasAnyTotal && data.length > 0 && (
            <tfoot className="bg-slate-100/90 border-t-2 border-slate-300 text-slate-900 font-bold">
              <tr className="h-11">
                {/* Toplam satiri GORUNEN sutunlari, GORUNEN sirayla izler: gizlenen ya da yeri
                    degisen sutunda toplam baska sutunun altina kaymasin. */}
                {table.getVisibleLeafColumns().map((column, idx) => {
                  const col = column.columnDef
                  const colId = column.id
                  const meta = (col as any).meta
                  const border = showColumnLines ? 'border-r border-slate-300 last:border-r-0' : ''

                  // First column label
                  if (idx === 0) {
                    return (
                      <td key="footer-label" className={`py-2.5 px-3.5 ${border} text-left font-bold text-slate-800`}>
                        TOPLAM
                      </td>
                    )
                  }

                  if (meta?.showTotal && colId) {
                    const sumsByCurrency: { [currencyCode: string]: number } = {}

                    // Sütunun para birimi SABİTLENEBİLİR (`meta.totalCurrencyCode`).
                    // Varsayılan davranış toplamı SATIRIN para birimine göre kovalıyor; ama
                    // "Toplam $" gibi tek para birimine ayrılmış bir sütunda diğer satırlar
                    // kendi kovalarına 0 ekleyip altta "₺0,00 / USD 1.200,00" gibi bir toplam
                    // üretiyordu. Sabitlenince o sütun tek kovada, doğru simgeyle toplanır.
                    const forcedCurrency = String((meta as any)?.totalCurrencyCode ?? '').trim().toUpperCase()
                    const forcedCode = forcedCurrency === 'TRY' || forcedCurrency === 'TL' ? '₺' : forcedCurrency
                    const providedTotal = Number((meta as any)?.totalValue)

                    // SÜZGEÇ VARKEN SUNUCUDAN GELEN SABİT TOPLAM KULLANILMAZ.
                    //
                    // `meta.totalValue` raporun TAMAMININ toplamı (sunucu hesaplıyor). Süzgeç
                    // veya arama uygulandığında ekranda 3 satır kalıyor ama alttaki TOPLAM
                    // satırı hâlâ bütün raporun toplamını yazıyordu — görünen satırlarla
                    // tutmayan bir rakam. Süzülmüş durumda toplam görünen satırlardan
                    // hesaplanır; süzgeç yokken sunucunun rakamı (yuvarlama farkı olmasın diye)
                    // aynen kullanılır.
                    //
                    // `totalScope: 'all'` diyen sütun bunu bilerek istiyordur, ona dokunulmaz.
                    const kapsamHepsi = (meta as any)?.totalScope === 'all'
                    const suzuluyor =
                      !kapsamHepsi &&
                      table.getFilteredRowModel().rows.length !== table.getCoreRowModel().rows.length

                    if (Number.isFinite(providedTotal) && !suzuluyor) {
                      sumsByCurrency[forcedCode || '₺'] = providedTotal
                    } else {
                      const totalRows = kapsamHepsi
                        ? table.getCoreRowModel().rows
                        : table.getFilteredRowModel().rows

                      const rowFilter = (meta as any)?.totalRowFilter as ((row: any) => boolean) | undefined

                      totalRows.forEach((rowModel) => {
                        const orig = rowModel.original as any
                        if (rowFilter && !rowFilter(orig)) return
                        const curId = Number(orig?.paraBirimiTipi ?? orig?.currencyTypeId ?? 0)
                        const curCode = String(orig?.currencyCode ?? orig?.CurrencyCode ?? '').trim().toUpperCase()
                        const rate = Number(orig?.kur ?? orig?.exchangeRate ?? 1) || 1
                        const rawVal = rowModel.getValue(colId) ?? orig[colId]
                        let num = 0
                        if (typeof rawVal === 'number') {
                          num = rawVal
                        } else if (typeof rawVal === 'string') {
                          const parsed = parseFloat(rawVal.replace(',', '.').replace(/[^\d.-]/g, ''))
                          if (Number.isFinite(parsed)) num = parsed
                        }
                        if (!Number.isFinite(num)) return

                        let code = forcedCode || '₺'
                        if (forcedCode) {
                          // sabitlenmiş sütun: satırın para birimine bakılmaz
                        } else if (curCode === 'USD' || curCode === '3' || curId === 3) {
                          code = 'USD'
                        } else if (curCode === 'EUR' || curCode === '2' || curId === 2) {
                          code = 'EUR'
                        } else if (curCode === 'GBP' || curCode === '4' || curId === 4) {
                          code = 'GBP'
                        }

                        /*
                          TL ÇAPASINI SATIRIN PARA BİRİMİNE ÇEVİR (2026-09-01) — OPT-IN.

                          Toplam satırı kovaları satırın para birimine göre ayırıyor ama
                          değeri HAM alıyordu. Fatura dökümünde tutarlar TL çapası olduğu
                          için USD kovası TL rakamlarını topluyor ve altta
                          "144.127.963,77 USD" gibi bir toplam çıkıyordu.

                          Çevrim BİLEREK opt-in: bazı sayfalar sütun değerini ZATEN belgenin
                          para biriminde üretiyor (ör. Alış Siparişleri, kalemin
                          `currencyUnitPrice` alanından hesaplıyor). Orada bölmek ikinci bir
                          çevrim olurdu. Yalnızca `totalConvertFromTry: true` diyen sütun
                          çevrilir.

                          Eşik sunucudaki kuralla aynı (`BelgeParasiGenelToplam`): kur 1 ise
                          damgalanmamış demektir, bölme yapılmaz.
                        */
                        const tldenCevir = Boolean((meta as any)?.totalConvertFromTry)
                        const effectiveNum =
                          tldenCevir && curId > 1 && rate > 1.0001 ? num / rate : num

                        sumsByCurrency[code] = (sumsByCurrency[code] || 0) + effectiveNum
                      })
                    }

                    const currencyKeys = Object.keys(sumsByCurrency)

                    // TL kovası varsayılan olarak etiketsiz yazılır; sütun `tryTotalLabel`
                    // verdiyse ("TL") döviz kovalarıyla aynı biçimde okunur.
                    const tryLabel = String((meta as any)?.tryTotalLabel ?? '').trim()
                    // PARA BİRİMİ SONDA (2026-08-22 kullanıcı kararı) — satırlarla AYNI kural.
                    // Toplam satırı önek, satırlar sonek yazsaydı aynı sütun iki farklı
                    // biçimde okunur ve bozuk görünürdü.
                    const renderBucket = (code: string, value: number) => {
                      const text = value.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                      if (code !== '₺') return `${text} ${code}`
                      return tryLabel ? `${text} ${tryLabel}` : formatCurrencyLocal(value)
                    }

                    return (
                      <td
                        key={`footer-${colId}`}
                        className={`py-2 px-3 ${border} text-right font-bold text-sky-900 bg-sky-50/70 whitespace-nowrap`}
                      >
                        {currencyKeys.length === 0 ? (
                          renderBucket('₺', 0)
                        ) : currencyKeys.length === 1 ? (
                          renderBucket(currencyKeys[0], sumsByCurrency[currencyKeys[0]])
                        ) : (
                          <div className="flex flex-col items-end gap-0.5 text-xs">
                            {currencyKeys.map((code) => (
                              <div key={code}>{renderBucket(code, sumsByCurrency[code])}</div>
                            ))}
                          </div>
                        )}
                      </td>
                    )
                  }

                  return <td key={`footer-empty-${idx}`} className={`py-2.5 px-3.5 ${border}`}></td>
                })}
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* Pagination Footer & Bottom-Left Excel Button */}
      {pagination ? (
        <DataTablePagination
          pageIndex={pagination.pageIndex}
          pageSize={pagination.pageSize}
          totalCount={isManualFiltering ? pagination.totalCount : table.getFilteredRowModel().rows.length}
          // `pageCount` verilmediyse toplam/sayfa boyutundan türet — tablo motoru (yukarıda)
          // bu yedeğe zaten sahipti, alt şerit sahip değildi ve sayfa sayısı `undefined`
          // kalıyordu. Bayrağı unutan her sayfa için ağı geniş tutmak daha güvenli.
          pageCount={
            isManualFiltering
              ? (pagination.pageCount ?? Math.max(1, Math.ceil((pagination.totalCount || 0) / (pagination.pageSize || 1))))
              : table.getPageCount()
          }
          onPageChange={pagination.onPageChange}
          onPageSizeChange={pagination.onPageSizeChange}
          pageSizeOptions={pagination.pageSizeOptions}
          onExportExcel={canShowExport ? handleExportExcel : undefined}
          onRefresh={onRefresh ?? pagination.onRefresh}
          refreshing={refreshing ?? pagination.refreshing}
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
