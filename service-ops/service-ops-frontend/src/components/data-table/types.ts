import React from 'react'
// ColumnPinningState / ColumnVisibilityState / OnChangeFn buradan içe aktarılıyordu ama hiç
// kullanılmıyordu; üstelik `ColumnVisibilityState` diye bir dışa aktarım yok (doğrusu
// `VisibilityState`) ve bu tek başına bir derleme hatası üretiyordu.
import type {
  ColumnDef,
  RowData,
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
    filterType?: 'text' | 'select' | 'number' | 'date'
    filterOptions?: Array<{ label: string; value: string }>
    filterPlaceholder?: string
    enableMultiSelectFilter?: boolean
    showTotal?: boolean
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
  rowId?: (row: TData) => string
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
  /**
   * Kolon süzgeçlerinden ve genel aramadan GEÇEN satırlar; süzgeç her değiştiğinde çağrılır.
   *
   * `Table` bu prop'u zaten alıyordu ama buraya HİÇ geçirmiyordu, dolayısıyla sayfalardaki
   * `filteredRows` daima boş kalıyordu — "Dışa Aktar" da listenin tamamını yazıyordu ve
   * kullanıcı süzdüğünü sanıp filtresiz dosya indiriyordu.
   */
  onFilteredDataChange?: (rows: TData[]) => void
  showFooterTotals?: boolean
  stickyHeader?: boolean
  showColumnLines?: boolean
  rowClassName?: (row: TData) => string
  className?: string
  containerClassName?: string
  isCardView?: boolean
  /**
   * TABLO AYARLARI (2026-10-11): sutun gizle/goster, sira, genislik — KULLANICI BAZLI saklanir.
   * Verilmezse anahtar kendiliginden uretilir (sayfa yolu + ilk sutunlar). `false` = bu tabloda
   * ayar dugmesi yok. Kart gorunumunde (mobil) ayar uygulanmaz.
   */
  preferencesKey?: string | false
}
