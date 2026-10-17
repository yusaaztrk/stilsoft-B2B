import { MRT_ColumnFiltersState, MRT_SortingState } from 'mantine-react-table'
import { TableQueryParams, ExtendedColumnDef } from './tableTypes'

/**
 * Normalizes a date-only string to UTC Start of Day ISO String.
 */
export function toUtcIsoStartOfDay(dateOnly: string) {
  const s = String(dateOnly ?? '').trim()
  if (!s) return ''
  return new Date(`${s}T00:00:00.000Z`).toISOString()
}

/**
 * Normalizes a date-only string to UTC End of Day ISO String.
 */
export function toUtcIsoEndOfDay(dateOnly: string) {
  const s = String(dateOnly ?? '').trim()
  if (!s) return ''
  return new Date(`${s}T23:59:59.999Z`).toISOString()
}

/**
 * Maps MRT column filters, sorting, and pagination states to generic TableQueryParams.
 */
function formatDateToYyyyMmDd(d: any): string {
  if (!d) return ''
  const dt = d instanceof Date ? d : new Date(d)
  if (Number.isNaN(dt.getTime())) return String(d)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`
}

function normalizeFilterOperator(mode: string | undefined, defaultOp: string) {
  switch (mode) {
    case 'fuzzy':
    case 'contains':
      return 'contains'
    case 'notContains':
      return 'not_contains'
    case 'startsWith':
      return 'starts_with'
    case 'endsWith':
      return 'ends_with'
    case 'equals':
    case 'weakEquals':
      return 'eq'
    case 'notEquals':
      return 'neq'
    case 'lessThan':
      return 'lt'
    case 'lessThanOrEqualTo':
      return 'lte'
    case 'greaterThan':
      return 'gt'
    case 'greaterThanOrEqualTo':
      return 'gte'
    case 'between':
    case 'betweenInclusive':
    case 'inNumberRange':
      return 'between'
    case 'empty':
      return 'empty'
    case 'notEmpty':
      return 'not_empty'
    default:
      return defaultOp
  }
}

function normalizeNumberFilterValue(value: any): string {
  let s = String(value ?? '')
    .trim()
    .replace(/\s/g, '')
    .replace(/[^\d,.-]/g, '')
  if (s.includes(',') && s.includes('.')) {
    s = s.replace(/\./g, '').replace(',', '.')
  } else if (s.includes(',')) {
    s = s.replace(',', '.')
  }
  return s
}

export function buildTableQueryParams<TData extends Record<string, any>>({
  pageIndex,
  pageSize,
  sorting,
  columnFilters,
  columnFilterModes,
  globalFilter,
  columns,
  fromDate,
  toDate
}: {
  pageIndex: number
  pageSize: number
  sorting: MRT_SortingState
  columnFilters: MRT_ColumnFiltersState
  columnFilterModes?: Record<string, string>
  globalFilter?: string
  columns: ExtendedColumnDef<TData>[]
  fromDate?: string
  toDate?: string
}): TableQueryParams {
  const queryParams: TableQueryParams = {
    page: pageIndex + 1,
    pageSize,
    query: globalFilter || undefined,
    fromDate: fromDate || undefined,
    toDate: toDate || undefined,
    filters: {}
  }

  // Map sorting
  if (sorting && sorting.length > 0) {
    const activeSort = sorting[0]
    queryParams.sortBy = activeSort.id
    queryParams.sortDir = activeSort.desc ? 'desc' : 'asc'
  }

  // Map column filters checking both meta and direct properties on colDef
  if (columnFilters && columnFilters.length > 0) {
    columnFilters.forEach((filter) => {
      const colDef = columns.find((c) => c.accessorKey === filter.id || c.id === filter.id)
      const meta = colDef?.meta
      const queryKey = meta?.queryKey || (colDef as any)?.queryKey || String(filter.id)
      const filterType = meta?.filterType || (colDef as any)?.filterType || 'text'
      const defaultOp = meta?.defaultOperator || (colDef as any)?.defaultOperator || (filterType === 'date' || filterType === 'number' ? 'eq' : (filterType === 'dateRange' || filterType === 'date-range') ? 'between' : 'contains')

      // Determine the operator
      const mode = columnFilterModes?.[filter.id]
      const op = normalizeFilterOperator(mode, defaultOp)

      // Handle empty / not empty comparison modes
      if (op === 'empty' || op === 'not_empty') {
        queryParams.filters![queryKey] = {
          op: op,
          v1: ''
        }
        return
      }

      const value = filter.value

      if (value === undefined || value === null) return

      // Handle select / multi-select by forcing "in" operator (which maps to KeyIn=val1,val2 query params)
      if (filterType === 'select' || filterType === 'multiSelect') {
        const arrayVal = Array.isArray(value) ? value : [value]
        const filteredArray = arrayVal.map((v) => String(v ?? '').trim()).filter(Boolean)
        if (filteredArray.length > 0) {
          queryParams.filters![queryKey] = {
            op: 'in',
            v1: filteredArray.join(',')
          }
        }
        return
      }

      if (op === 'between') {
        if (Array.isArray(value)) {
          const [start, end] = value
          const isDateRange = filterType === 'date' || filterType === 'date-range' || filterType === 'dateRange' || start instanceof Date || end instanceof Date
          const sStr = isDateRange ? formatDateToYyyyMmDd(start) : normalizeNumberFilterValue(start)
          const eStr = isDateRange ? formatDateToYyyyMmDd(end) : normalizeNumberFilterValue(end)
          if (sStr || eStr) {
            queryParams.filters![queryKey] = {
              op: 'between',
              v1: sStr,
              v2: eStr || undefined
            }
          }
        } else {
          const isDate = filterType === 'date' || filterType === 'date-range' || filterType === 'dateRange' || value instanceof Date
          const sStr = isDate ? formatDateToYyyyMmDd(value) : normalizeNumberFilterValue(value)
          if (sStr) {
            queryParams.filters![queryKey] = {
              op: 'between',
              v1: sStr,
              v2: undefined
            }
          }
        }
        return
      }

      // If it's a date or a Date object
      if (filterType === 'date' || filterType === 'date-range' || filterType === 'dateRange' || value instanceof Date) {
        if (Array.isArray(value)) {
          const start = value[0]
          const sStr = formatDateToYyyyMmDd(start)
          if (sStr) {
            queryParams.filters![queryKey] = {
              op: op,
              v1: sStr
            }
          }
        } else {
          const valStr = formatDateToYyyyMmDd(value)
          if (valStr) {
            queryParams.filters![queryKey] = {
              op: op,
              v1: valStr
            }
          }
        }
        return
      }

      // Handle numbers
      if (filterType === 'number') {
        if (Array.isArray(value)) {
          const start = value[0]
          const sStr = normalizeNumberFilterValue(start)
          const eStr = normalizeNumberFilterValue(value[1])
          if (sStr) {
            queryParams.filters![queryKey] = {
              op: op,
              v1: sStr,
              v2: op === 'between' && eStr ? eStr : undefined
            }
          }
        } else {
          const valStr = normalizeNumberFilterValue(value)
          if (valStr) {
            queryParams.filters![queryKey] = {
              op: op,
              v1: valStr
            }
          }
        }
        return
      }

      // Handle multi-select / array values for other filter types
      if (Array.isArray(value)) {
        const filteredArray = value.map((v) => String(v ?? '').trim()).filter(Boolean)
        if (filteredArray.length > 0) {
          queryParams.filters![queryKey] = {
            op: 'in',
            v1: filteredArray.join(',')
          }
        }
        return
      }

      // Handle single values
      const valStr = String(value).trim()
      if (!valStr) return

      queryParams.filters![queryKey] = {
        op,
        v1: valStr
      }
    })
  }

  return queryParams
}

/**
 * Converts TableQueryParams into URLSearchParams query string.
 */
export function convertToUrlQueryString(params: TableQueryParams): string {
  const qs = new URLSearchParams()

  qs.set('page', String(params.page))
  qs.set('pageSize', String(params.pageSize))

  if (params.query) {
    qs.set('query', params.query.trim().toLowerCase())
  }

  if (params.fromDate) {
    qs.set('fromDate', toUtcIsoStartOfDay(params.fromDate))
  }
  if (params.toDate) {
    qs.set('toDate', toUtcIsoEndOfDay(params.toDate))
  }

  if (params.sortBy) {
    qs.set('sortBy', params.sortBy)
    qs.set('sortDir', params.sortDir || 'asc')
  }

  // Map filters into individual Op, V1, V2 parameters
  if (params.filters) {
    Object.entries(params.filters).forEach(([key, filter]) => {
      if (filter.op === 'in') {
        // Special case: e.g. islemTipiIn=SATIŞ,ALIŞ
        qs.set(`${key}In`, filter.v1)
      } else {
        qs.set(`${key}Op`, String(filter.op))
        qs.set(`${key}V1`, filter.v1)
        if (filter.v2) {
          qs.set(`${key}V2`, filter.v2)
        }
      }
    })
  }

  return qs.toString()
}
