import React from 'react'
import type {
  ColumnDef,
  RowData,
  ColumnPinningState,
  OnChangeFn,
  RowSelectionState,
  SortingState,
  VisibilityState
} from '@tanstack/react-table'

export type FilterOperator =
  | 'contains'
  | 'not_contains'
  | 'starts_with'
  | 'ends_with'
  | 'eq'
  | 'neq'
  | 'lt'
  | 'lte'
  | 'gt'
  | 'gte'
  | 'between'
  | 'in'

export type ColumnFilterStateValue = {
  value?: string
  value2?: string
  operator?: FilterOperator
  selectedOptions?: string[]
}

declare module '@tanstack/react-table' {
  interface ColumnMeta<TData extends RowData, TValue> {
    filterType?: 'text' | 'select' | 'number' | 'date' | 'checkbox'
    filterOptions?: Array<{ label: string; value: string }>
    filterPlaceholder?: string
    enableMultiSelectFilter?: boolean
    /**
     * Sütun genişliği (CSS değeri: '90px', '8rem'…).
     *
     * Tablo genişlikleri içeriğe göre dağıtılıyor ve dar sütunlar (Sıra, Tarih) başlık
     * süzgeç kutusu yüzünden gereğinden geniş kalıyordu. Verilmediğinde davranış birebir
     * eskisi gibidir — yalnızca değer verilen sütun sabitlenir.
     */
    width?: string
    showTotal?: boolean
    /**
     * Toplama HANGİ satırlar girsin (opt-in). Verilmezse görünen bütün satırlar toplanır.
     * POS çekim raporu gibi "başarısız/tamamlanmamış" satırların da listelendiği tablolarda
     * toplam yalnız gerçekten tahsil edilenleri saymalı; süzgeç burada verilir.
     */
    totalRowFilter?: (row: any) => boolean
    /**
     * Alt TOPLAM satırında sütun değerini satırın para birimine çevir.
     * Sütun değeri TL ÇAPASI ise açılır; zaten belge parasındaysa AÇILMAZ (çifte çevrim).
     */
    totalConvertFromTry?: boolean
    /**
     * Toplam satırının para birimini SABİTLER ('TRY' | 'EUR' | 'USD' | 'GBP').
     * Verilmezse toplam satırın kendi para birimine göre kovalanır (karışık tabloda
     * her kur ayrı satırda görünür). Tek para birimine ayrılmış sütunlarda
     * ("Toplam $" gibi) bunu ver, yoksa diğer satırlar kendi kovalarına 0 ekler.
     */
    totalCurrencyCode?: string
    /**
     * Toplam satırındaki TL kovasının önüne yazılacak etiket (örn. 'TL').
     * Verilmezse TL toplamı çıplak sayı olarak yazılır (eski davranış); dövizle
     * yan yana duran tablolarda 'TL' verilerek iki kova aynı biçimde okunur.
     */
    tryTotalLabel?: string
    /**
     * Toplam satırı varsayılan olarak filtrelenmiş satırları toplar. Rapor genel toplamı
     * istenen ekranlarda 'all' verilirse search/sütun filtresi toplamı değiştirmez.
     */
    totalScope?: 'filtered' | 'all'
    /**
     * Hazır toplam değeri. Verilirse footer satırı satırlardan yeniden hesaplamaz,
     * doğrudan bu değeri gösterir.
     */
    totalValue?: number
  }
}

export type { ColumnDef, SortingState, VisibilityState, RowSelectionState }

export type DataTablePaginationConfig = {
  pageIndex: number
  pageSize: number
  totalCount: number
  pageCount?: number
  onPageChange: (pageIndex: number) => void
  onPageSizeChange: (pageSize: number) => void
  pageSizeOptions?: number[]
  onExportExcel?: () => void
  /**
   * Verilirse alt cubukta "Yenile" dugmesi cikar.
   *
   * Dugme YALNIZCA veriyi tazeler; tablonun suzgecleri, siralamasi ve sayfa numarasi
   * tablonun KENDI durumunda tutuldugu icin dokunulmadan kalir. Sayfayi tarayicidan
   * yenilemek ise her seyi sifirliyordu — kullanici her tazelemede suzgecleri bastan
   * kuruyordu.
   *
   * Verilmezse dugme hic gorunmez; mevcut ekranlarin gorunumu degismez.
   */
  onRefresh?: () => void | Promise<void>
  /** Yenileme suruyor mu — dugme bu sirada pasif ve ikonu doner. */
  refreshing?: boolean
  /** Excel'in yanina cizilecek ek dugme (tablo ayarlari). Tabloyu AppDataTable doldurur. */
  settingsSlot?: React.ReactNode
}

export type DataTableSortingConfig = {
  sorting: SortingState
  onSortingChange: (sorting: SortingState) => void
  manualSorting?: boolean
}

export type DataTableFilteringConfig = {
  globalFilter?: string
  onGlobalFilterChange?: (filter: string) => void
  manualFiltering?: boolean
  columnFilters?: Record<string, ColumnFilterStateValue | string>
  onColumnFilterChange?: (columnId: string, value: ColumnFilterStateValue | string | null) => void
  showColumnFilters?: boolean
  /**
   * Date columns preselect today on first render. Each column is seeded once and only
   * once, so clearing the filter with the X keeps it cleared. Vade / due-date columns
   * are never seeded. Set to true to opt a table out entirely.
   */
  disableDateDefaultToday?: boolean
}

export type DataTableSelectionConfig<TData> = {
  selectedRowIds?: RowSelectionState
  onSelectionChange?: (selection: RowSelectionState) => void
  isRowSelectable?: (row: TData) => boolean
}

export type DataTableColumnVisibilityConfig = {
  columnVisibility: VisibilityState
  onColumnVisibilityChange: (visibility: VisibilityState) => void
}

export type DataTableStatesConfig = {
  loading?: boolean
  error?: string | null
  onRetry?: () => void
  emptyTitle?: string
  emptyDescription?: string
}

export type DataTableRowAction<TData> = {
  key?: string
  label: string
  icon?: React.ReactNode
  onClick: (row: TData) => void
  danger?: boolean
  variant?: 'danger' | 'default' | 'primary' | string
  disabled?: boolean
  disabledReason?: string
  hidden?: boolean
}

export type DataTableToolbarConfig<TData> = {
  searchPlaceholder?: string
  searchDebounceMs?: number
  showSearch?: boolean
  showColumnVisibility?: boolean
  showExcelExport?: boolean
  excelFileName?: string
  dateRange?: {
    fromDate?: string
    toDate?: string
    onFromDateChange?: (date: string) => void
    onToDateChange?: (date: string) => void
  }
  filterSlot?: React.ReactNode
  rightActionsSlot?: React.ReactNode
}

export type AppDataTableProps<TData extends Record<string, any>> = {
  data: TData[]
  columns: ColumnDef<TData, any>[]
  /** Satir kimligi. Kimliksiz veride sira numarasina dusulebilsin diye `idx` de verilir. */
  rowId?: (row: TData, idx: number) => string
  pagination?: DataTablePaginationConfig
  sorting?: DataTableSortingConfig
  filtering?: DataTableFilteringConfig
  selection?: DataTableSelectionConfig<TData>
  columnVisibility?: DataTableColumnVisibilityConfig
  states?: DataTableStatesConfig
  toolbar?: DataTableToolbarConfig<TData>
  showExcelExport?: boolean
  excelFileName?: string
  rowActions?: (row: TData) => DataTableRowAction<TData>[]
  onRowClick?: (row: TData) => void
  onPreviewRow?: (row: TData) => void
  renderExpandedRow?: (row: TData) => React.ReactNode
  isRowExpanded?: (row: TData) => boolean
  onToggleRowExpanded?: (row: TData) => void
  showFooterTotals?: boolean
  stickyHeader?: boolean
  showColumnLines?: boolean
  rowClassName?: (row: TData) => string
  className?: string
  containerClassName?: string
  /**
   * Tablonun SUZGECTEN GECMIS satirlari degistiginde cagrilir.
   *
   * Kolon suzgecleri tablonun ICINDE calisiyor; sayfa yalnizca ham veriyi verdigi icin
   * ustteki ozet kutulari (adet / toplam tutar / ortalama vade) suzgecten habersizdi:
   * tabloda 1 satir kalirken ozet 15 satirin toplamini gosteriyordu. Bu geri cagri, ozeti
   * ekranda GORUNEN satirlarla ayni kaynaga baglar.
   */
  onFilteredRowsChange?: (rows: TData[]) => void
  /**
   * "Yenile" dugmesi. `pagination.onRefresh` ile ayni is; ust seviyede de kabul ediliyor
   * cunku bazi sayfalar `AppDataTable`'i DOGRUDAN cagiriyor ve sayfalama nesnesinin icine
   * yazmak orada gereksiz zahmet. Ikisi birden verilirse ust seviyedeki kazanir.
   */
  onRefresh?: () => void | Promise<void>
  refreshing?: boolean
  /**
   * TABLO AYARLARI (2026-10-11): sutun gizle/goster, sira, genislik — KULLANICI BAZLI saklanir.
   *
   * Verilmezse anahtar kendiliginden uretilir (sayfa yolu + ilk sutunlar; bkz.
   * `lib/tablePreferences.tablePrefsKey`). Ayni sayfada ayni sutunlarla baslayan iki FARKLI
   * tablo ayari paylasmasin isteniyorsa buraya sabit bir ad verilir. `false` = bu tabloda
   * ayar dugmesi yok, sutunlar hep sayfanin verdigi gibi.
   */
  preferencesKey?: string | false
}
