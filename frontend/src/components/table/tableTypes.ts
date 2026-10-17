import { ReactNode } from 'react'
import { MRT_ColumnDef, MRT_Row } from 'mantine-react-table'

export type FilterType =
  | 'text'
  | 'number'
  | 'date'
  | 'select'
  | 'multiSelect'
  | 'boolean'
  | 'dateRange'
  | 'numberRange'

export type FilterOperator =
  | 'contains'
  | 'not_contains'
  | 'starts_with'
  | 'ends_with'
  | 'eq'
  | 'neq'
  | 'lt'
  | 'gt'
  | 'lte'
  | 'gte'
  | 'between'
  | 'in'

export interface ColumnFilterMetadata {
  filterType?: FilterType
  defaultOperator?: FilterOperator
  queryKey?: string
  options?: Array<{ value: string; label: string }> | string[]
}

// Extend MRT Column Def with custom meta typing
export type ExtendedColumnDef<TData extends Record<string, any>> = MRT_ColumnDef<TData> & {
  meta?: ColumnFilterMetadata
  /**
   * Kolonun veri niteligi. `ServerDataTable` toplam satirinda hangi kolonlarin toplanacagini
   * secerken okuyor; tipte tanimli olmadigi icin o kosullar tip denetiminde patliyordu.
   */
  type?: 'text' | 'number' | 'currency' | 'date'
}

export interface TableQueryParams {
  page: number
  pageSize: number
  query?: string
  sortBy?: string
  sortDir?: 'asc' | 'desc'
  filters?: Record<string, ColumnFilterState>
  fromDate?: string
  toDate?: string
}

export interface ColumnFilterState {
  op: FilterOperator | string
  v1: string
  v2?: string
}

export interface ServerDataTableProps<TData extends Record<string, any>> {
  columns: ExtendedColumnDef<TData>[]
  queryKey: unknown[]
  fetchData: (params: TableQueryParams) => Promise<{ data: TData[]; total: number }>
  getRowId?: (row: TData) => string
  initialPageSize?: number
  enableGlobalFilter?: boolean
  enableColumnFilters?: boolean
  enableSorting?: boolean
  enableRowActions?: boolean
  enableExpanding?: boolean
  renderRowActions?: (props: { row: MRT_Row<TData>; table: any }) => ReactNode
  renderDetailPanel?: (props: { row: MRT_Row<TData>; table: any }) => ReactNode
  topToolbarCustomActions?: (props: { table: any }) => ReactNode
  dateRangeFilter?: {
    fromDate: string
    toDate: string
    onFromDateChange: (val: string) => void
    onToDateChange: (val: string) => void
  }
  quickDateFilters?: boolean
  exportOptions?: {
    fileName?: string
    exportCurrentPage?: boolean
    exportAllFiltered?: (params: TableQueryParams) => Promise<void>
  }
  permissions?: {
    canExport?: boolean
  }
  emptyMessage?: string
  onDataChange?: (data: TData[]) => void
}
