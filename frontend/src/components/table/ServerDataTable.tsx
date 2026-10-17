import React, { useEffect, useState, useMemo } from 'react'
import {
  MantineReactTable,
  MRT_ColumnFiltersState,
  MRT_SortingState
} from 'mantine-react-table'
import { useDebouncedValue } from '@mantine/hooks'
import { DatePickerInput } from '@mantine/dates'
import {
  Group,
  Menu,
  Select
} from '@mantine/core'
import {
  IconCalendar,
  IconRefresh,
  IconDownload,
  IconFileSpreadsheet,
  IconFileText,
  IconChartPie
} from '@tabler/icons-react'
import { ServerDataTableProps, TableQueryParams } from './tableTypes'
import { buildTableQueryParams } from './tableQueryUtils'
import { exportToExcel, exportToCsv, exportToPdf, exportToWord } from './exportUtils'

const MRT_Localization_TR = {
  actions: 'Eylemler',
  and: 've',
  cancel: 'İptal',
  changeFilterMode: 'Filtre modunu değiştir',
  changeSearchMode: 'Arama modunu değiştir',
  clearFilter: 'Filtreyi temizle',
  clearSearch: 'Aramayı temizle',
  clearSort: 'Sıralamayı temizle',
  clickToCopy: 'Kopyalamak için tıklayın',
  columnActions: 'Kolon Eylemleri',
  copiedToClipboard: 'Panoya kopyalandı',
  collapse: 'Daralt',
  collapseAll: 'Tümünü daralt',
  expanded: 'Genişletildi',
  expand: 'Genişlet',
  expandAll: 'Tümünü genişlet',
  filterArrIncludes: 'İçerir',
  filterArrNotEmpty: 'Boş değil',
  filterBetween: 'Arasında',
  filterBetweenHeader: 'Arasında',
  filterByColumn: 'Filtrele: {column}',
  filterContains: 'İçerir',
  filterEmpty: 'Boş',
  filterEndsWith: 'İle biter',
  filterEquals: 'Eşittir',
  filterEqualsString: 'Eşittir',
  filterFuzzy: 'Fuzzy',
  filterGreaterThan: 'Büyüktür',
  filterGreaterThanOrEqualTo: 'Büyüktür veya eşittir',
  filterInNumberRange: 'Sayı aralığında',
  filterLessThan: 'Küçüktür',
  filterLessThanOrEqualTo: 'Küçüktür veya eşittir',
  filterListContains: 'İçerir',
  filterNotEmpty: 'Boş değil',
  filterNotEquals: 'Eşit değil',
  filterStartsWith: 'İle başlar',
  filterWeakEquals: 'Eşittir',
  filteringByColumn: 'Filtreleniyor: {column}',
  goToFirstPage: 'İlk sayfaya git',
  goToLastPage: 'Son sayfaya git',
  goToNextPage: 'Sonraki sayfaya git',
  goToPreviousPage: 'Önceki sayfaya git',
  grab: 'Sürükle',
  groupByColumn: 'Grupla: {column}',
  groupedBy: 'Gruplandı: ',
  hideAll: 'Tümünü gizle',
  hideColumn: 'Sütunu gizle',
  max: 'Maks',
  min: 'Min',
  move: 'Taşı',
  noRecordsToDisplay: 'Gösterilecek kayıt yok',
  noResultsFound: 'Sonuç bulunamadı',
  of: 'in',
  or: 'veya',
  pinToLeft: 'Sola sabitle',
  pinToRight: 'Sağa sabitle',
  resetColumnSize: 'Sütun boyutunu sıfırla',
  resetOrder: 'Sıralamayı sıfırla',
  rowActions: 'İşlemler',
  rowNumber: 'No',
  rowNumbers: 'Satır numaraları',
  rowsPerPage: 'Sayfa başına satır:',
  save: 'Kaydet',
  search: 'Ara',
  selectedCountOfRowsSelected: '{selectedCount} satır seçildi',
  select: 'Seç',
  showAll: 'Tümünü göster',
  showAllColumns: 'Tüm sütunları göster',
  showHideAlerts: 'Uyarıları göster/gizle',
  showHideFilters: 'Filtreleri göster/gizle',
  showHideSearch: 'Aramayı göster/gizle',
  sortByColumnAsc: 'Sırala: {column} artan',
  sortByColumnDesc: 'Sırala: {column} azalan',
  sortedByColumnAsc: 'Sıralandı: {column} artan',
  sortedByColumnDesc: 'Sıralandı: {column} azalan',
  thenBy: 've sonra',
  toggleDensity: 'Yoğunluğu değiştir',
  toggleFullScreen: 'Tam ekran yap',
  toggleSelectAll: 'Tümünü seç/seçme',
  toggleSelectRow: 'Satırı seç/seçme',
  toggleVisibility: 'Görünürlüğü değiştir',
  ungroupByColumn: 'Grubu kaldır: {column}',
  unpin: 'Sabitlemeyi kaldır',
  unpinAll: 'Tüm sabitlemeleri kaldır',
  unsorted: 'Sıralanmamış'
}

export function ServerDataTable<TData extends Record<string, any>>({
  columns,
  queryKey,
  fetchData,
  getRowId,
  initialPageSize = 10,
  enableGlobalFilter = true,
  enableColumnFilters = true,
  enableSorting = true,
  enableRowActions = false,
  enableExpanding = false,
  renderRowActions,
  renderDetailPanel,
  dateRangeFilter,
  quickDateFilters = true,
  exportOptions,
  permissions,
  emptyMessage = 'Kayıt bulunamadı.',
  onDataChange,
  topToolbarCustomActions
}: ServerDataTableProps<TData>) {
  // MRT States
  const [data, setData] = useState<TData[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(initialPageSize)
  const [sorting, setSorting] = useState<MRT_SortingState>([])
  const [columnFilters, setColumnFilters] = useState<MRT_ColumnFiltersState>([])
  const [columnFilterFns, setColumnFilterFns] = useState<Record<string, string>>({})
  const [globalFilter, setGlobalFilter] = useState('')
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [columnVisibility, setColumnVisibility] = useState<Record<string, boolean>>({})
  const [columnOrder, setColumnOrder] = useState<string[]>([])

  // Pivot Table & Chart States
  const [pivotMode, setPivotMode] = useState(false)
  const [pivotRowField, setPivotRowField] = useState<string>('')
  const [pivotColField, setPivotColField] = useState<string>('')
  const [pivotValueField, setPivotValueField] = useState<string>('')
  const [pivotAggregation, setPivotAggregation] = useState<'sum' | 'count' | 'avg'>('sum')
  const [pivotChartType, setPivotChartType] = useState<'bar' | 'hbar' | 'line'>('bar')

  // Generate options for Pivot selector dropdowns
  const fieldOptions = useMemo(() => {
    return columns
      .filter((col) => col.accessorKey && col.header)
      .map((col) => ({
        value: col.accessorKey as string,
        label: String(col.header)
      }))
  }, [columns])

  const numericFieldOptions = useMemo(() => {
    return columns
      .filter((col) => {
        const id = (col.accessorKey as string)?.toLowerCase() || ''
        return (
          col.type === 'number' ||
          col.type === 'currency' ||
          id.includes('toplam') ||
          id.includes('tutar') ||
          id.includes('iskonto') ||
          id.includes('fiyat') ||
          id.includes('miktar') ||
          id.includes('adet') ||
          id.includes('net') ||
          id.includes('brut') ||
          id.includes('kdv')
        )
      })
      .map((col) => ({
        value: col.accessorKey as string,
        label: String(col.header)
      }))
  }, [columns])

  // Automatically initialize Pivot fields when Pivot Mode is toggled
  const handleTogglePivotMode = () => {
    if (!pivotMode) {
      if (fieldOptions.length > 0 && !pivotRowField) {
        const row = fieldOptions.find(f => f.value === 'islemTipi' || f.value === 'cariAdi') || fieldOptions[0]
        setPivotRowField(row.value)
      }
      if (numericFieldOptions.length > 0 && !pivotValueField) {
        const val = numericFieldOptions.find(f => f.value === 'genelToplam' || f.value === 'netTutar') || numericFieldOptions[0]
        setPivotValueField(val.value)
      }
    }
    setPivotMode(!pivotMode)
  }

  // Pivot calculator
  const pivotData = useMemo(() => {
    if (!pivotRowField || !pivotValueField) return null

    const result: Record<string, { values: Record<string, number>; total: number; count: number }> = {}
    const colValuesSet = new Set<string>()

    data.forEach((item) => {
      const rowVal = String(item[pivotRowField] ?? 'Boş')
      const colVal = pivotColField ? String(item[pivotColField] ?? 'Boş') : 'Değer'
      if (pivotColField) colValuesSet.add(colVal)

      const rawVal = Number(item[pivotValueField])
      const val = Number.isFinite(rawVal) ? rawVal : 0

      if (!result[rowVal]) {
        result[rowVal] = { values: {}, total: 0, count: 0 }
      }

      if (!result[rowVal].values[colVal]) {
        result[rowVal].values[colVal] = 0
      }

      result[rowVal].values[colVal] += val
      result[rowVal].total += val
      result[rowVal].count += 1
    })

    const aggregatedResult: Record<string, { values: Record<string, number>; finalVal: number }> = {}
    
    Object.entries(result).forEach(([rowKey, r]) => {
      const finalRowValues: Record<string, number> = {}
      const colKeys = pivotColField ? Array.from(colValuesSet) : ['Değer']

      colKeys.forEach((cKey) => {
        const sum = r.values[cKey] ?? 0
        let val = sum
        if (pivotAggregation === 'count') {
          val = r.count
        } else if (pivotAggregation === 'avg') {
          val = r.count > 0 ? sum / r.count : 0
        }
        finalRowValues[cKey] = val
      })

      aggregatedResult[rowKey] = {
        values: finalRowValues,
        finalVal: pivotAggregation === 'avg' ? (r.count > 0 ? r.total / r.count : 0) : (pivotAggregation === 'count' ? r.count : r.total)
      }
    })

    return {
      rows: aggregatedResult,
      columns: Array.from(colValuesSet)
    }
  }, [data, pivotRowField, pivotColField, pivotValueField, pivotAggregation])

  // Track only visible columns for data exports, ordered by the drag-and-drop state
  const visibleColumnsForExport = useMemo(() => {
    const visible = columns.filter((col) => {
      const id = (col.id || col.accessorKey) as string
      if (!id) return false
      if (columnVisibility[id] === false) return false
      if (id === 'mrt-row-actions' || id === 'mrt-row-expand') return false
      return true
    })

    if (columnOrder && columnOrder.length > 0) {
      const orderMap = new Map(columnOrder.map((id, index) => [id, index]))
      visible.sort((a, b) => {
        const idA = (a.id || a.accessorKey) as string
        const idB = (b.id || b.accessorKey) as string
        const indexA = orderMap.has(idA) ? orderMap.get(idA)! : 9999
        const indexB = orderMap.has(idB) ? orderMap.get(idB)! : 9999
        return indexA - indexB
      })
    }

    return visible
  }, [columns, columnVisibility, columnOrder])

  // Convert Pivot data matrix for exporting
  const pivotExportData = useMemo(() => {
    if (!pivotData) return { columns: [], data: [] }
    
    const rowFieldName = String(columns.find(c => c.accessorKey === pivotRowField)?.header || pivotRowField)
    const pivotCols = [
      { accessorKey: 'rowKey', header: rowFieldName },
      ...pivotData.columns.map(colVal => ({
        accessorKey: colVal,
        header: colVal
      })),
      { accessorKey: 'total', header: 'Genel Toplam' }
    ]

    const pivotRows = Object.entries(pivotData.rows).map(([rowKey, r]) => {
      const rowObj: Record<string, any> = {
        rowKey,
        total: r.finalVal
      }
      pivotData.columns.forEach(colVal => {
        rowObj[colVal] = r.values[colVal] ?? 0
      })
      return rowObj
    })

    return { columns: pivotCols, data: pivotRows }
  }, [pivotData, pivotRowField, columns])

  // Debounced filters to prevent duplicate API requests
  const [debouncedGlobalFilter] = useDebouncedValue(globalFilter, 400)
  const [debouncedColumnFilters] = useDebouncedValue(columnFilters, 400)

  // Fetch pagination parameters
  const pagination = useMemo(() => ({
    pageIndex: page - 1,
    pageSize
  }), [page, pageSize])

  // Check if a filter value is actually non-empty
  const isFilterValueFilled = (value: any): boolean => {
    if (value === undefined || value === null || value === '') return false
    if (Array.isArray(value)) return value.some((v) => v !== undefined && v !== null && v !== '')
    return true
  }

  const activeFilterCount = columnFilters.filter((f) => isFilterValueFilled(f.value)).length

  const hasActiveColumnDateFilter = useMemo(() => {
    return columnFilters.some((filter) => {
      if (!isFilterValueFilled(filter.value)) return false
      const colDef = columns.find((col) => col.id === filter.id || col.accessorKey === filter.id)
      const filterType = colDef?.meta?.filterType || (colDef as any)?.filterType
      return filterType === 'date' || filterType === 'dateRange' || filterType === 'date-range'
    })
  }, [columnFilters, columns])

  const handleClearFilters = () => {
    setColumnFilters([])
    setGlobalFilter('')
    setColumnFilterFns({})
    setPage(1)
  }

  // Single Controlled Load Function
  const loadData = async () => {
    try {
      setLoading(true)
      setError(null)

      const params: TableQueryParams = buildTableQueryParams({
        pageIndex: pagination.pageIndex,
        pageSize: pagination.pageSize,
        sorting,
        columnFilters: debouncedColumnFilters,
        columnFilterModes: columnFilterFns,
        globalFilter: debouncedGlobalFilter,
        columns,
        fromDate: hasActiveColumnDateFilter ? undefined : dateRangeFilter?.fromDate,
        toDate: hasActiveColumnDateFilter ? undefined : dateRangeFilter?.toDate
      })

      const res = await fetchData(params)
      const fetchedData = res.data || []
      setData(fetchedData)
      setTotal(res.total || 0)
      if (onDataChange) {
        onDataChange(fetchedData)
      }
    } catch (err: any) {
      setError(err?.message || 'Veriler yüklenirken bir hata oluştu.')
      setData([])
      setTotal(0)
      if (onDataChange) {
        onDataChange([])
      }
    } finally {
      setLoading(false)
    }
  }

  // Trigger load on state changes
  useEffect(() => {
    void loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    pagination.pageIndex,
    pagination.pageSize,
    sorting,
    debouncedGlobalFilter,
    debouncedColumnFilters,
    JSON.stringify(columnFilterFns),
    dateRangeFilter?.fromDate,
    dateRangeFilter?.toDate,
    ...queryKey
  ])

  // Export handlers (detects if Pivot Mode is active, and exports the Pivot matrix instead of raw data)
  const handleExport = async (type: 'excel' | 'csv' | 'pdf' | 'word', allFiltered = false) => {
    const exportFileName = exportOptions?.fileName || 'rapor'

    if (pivotMode) {
      const { columns: pCols, data: pData } = pivotExportData
      if (type === 'excel') {
        exportToExcel(pCols as any, pData, `${exportFileName}_pivot`)
      } else if (type === 'csv') {
        exportToCsv(pCols as any, pData, `${exportFileName}_pivot`)
      } else if (type === 'pdf') {
        exportToPdf(pCols as any, pData, `${exportFileName} Pivot Raporu`)
      } else if (type === 'word') {
        exportToWord(pCols as any, pData, `${exportFileName}_pivot`)
      }
      return
    }
    
    if (allFiltered && exportOptions?.exportAllFiltered) {
      const params = buildTableQueryParams({
        pageIndex: 0,
        pageSize: 100000, // retrieve all
        sorting,
        columnFilters: debouncedColumnFilters,
        columnFilterModes: columnFilterFns,
        globalFilter: debouncedGlobalFilter,
        columns: visibleColumnsForExport,
        fromDate: hasActiveColumnDateFilter ? undefined : dateRangeFilter?.fromDate,
        toDate: hasActiveColumnDateFilter ? undefined : dateRangeFilter?.toDate
      })
      await exportOptions.exportAllFiltered(params)
      return
    }

    if (type === 'excel') {
      exportToExcel(visibleColumnsForExport, data, exportFileName)
    } else if (type === 'csv') {
      exportToCsv(visibleColumnsForExport, data, exportFileName)
    } else if (type === 'pdf') {
      exportToPdf(visibleColumnsForExport, data, exportFileName)
    } else if (type === 'word') {
      exportToWord(visibleColumnsForExport, data, exportFileName)
    }
  }

  // Natively map ExtendedColumnDef properties to MRT format
  const mrtColumns = useMemo(() => {
    return columns.map((col) => {
      const newCol = { ...col }
      const colId = (col.id || col.accessorKey) as string
      const currentMode = colId ? columnFilterFns[colId] : undefined
      const isBetween = currentMode === 'between' || currentMode === 'betweenInclusive' || currentMode === 'inNumberRange'

      const resolvedFilterType = col.meta?.filterType || (col as any)?.filterType || 'text'
      const fOpts = col.meta?.options || (col as any)?.filterSelectOptions || (col as any)?.filterOptions

      if (resolvedFilterType === 'select') {
        newCol.filterVariant = 'select'
        newCol.mantineFilterSelectProps = {
          data: (fOpts || []).map((o: any) =>
            typeof o === 'string' ? { value: o, label: o } : o
          ) as any
        }
      } else if (resolvedFilterType === 'multiSelect') {
        newCol.filterVariant = 'multi-select'
        newCol.mantineFilterMultiSelectProps = {
          data: (fOpts || []).map((o: any) =>
            typeof o === 'string' ? { value: o, label: o } : o
          ) as any
        }
      } else if (resolvedFilterType === 'number') {
        newCol.filterVariant = isBetween ? 'range' : 'text'
      } else if (resolvedFilterType === 'date') {
        newCol.filterVariant = isBetween ? 'date-range' : 'date'
      } else if (resolvedFilterType === 'date-range' || resolvedFilterType === 'dateRange') {
        newCol.filterVariant = 'date-range'
      } else if (resolvedFilterType === 'boolean') {
        newCol.filterVariant = 'checkbox'
      }

      if (isBetween) {
        newCol.size = 320
        newCol.minSize = 320
        newCol.maxSize = 400

        const existingHeadProps = typeof col.mantineTableHeadCellProps === 'function'
          ? col.mantineTableHeadCellProps
          : col.mantineTableHeadCellProps || {}

        newCol.mantineTableHeadCellProps = (props: any) => {
          const resolved = typeof existingHeadProps === 'function' ? (existingHeadProps as any)(props) : existingHeadProps
          return {
            ...resolved,
            sx: {
              ...(resolved.sx || {}),
              minWidth: '320px !important',
              width: '320px !important',
              maxWidth: '400px !important'
            }
          }
        }

        const existingBodyProps = typeof col.mantineTableBodyCellProps === 'function'
          ? col.mantineTableBodyCellProps
          : col.mantineTableBodyCellProps || {}

        newCol.mantineTableBodyCellProps = (props: any) => {
          const resolved = typeof existingBodyProps === 'function' ? (existingBodyProps as any)(props) : existingBodyProps
          return {
            ...resolved,
            sx: {
              ...(resolved.sx || {}),
              minWidth: '320px !important',
              width: '320px !important',
              maxWidth: '400px !important'
            }
          }
        }
      }

      const originalHeader = col.header
      newCol.Header = (props: any) => {
        const colFilterId = props.column.id
        const hasActiveFilter = columnFilters.some((f) => f.id === colFilterId && isFilterValueFilled(f.value))
        const renderedHeader = typeof originalHeader === 'function'
          ? (originalHeader as any)(props)
          : originalHeader
        return (
          <div className="flex items-center justify-between w-full gap-1" style={{ width: '100%' }}>
            <span className="truncate">{renderedHeader}</span>
            {hasActiveFilter && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  setColumnFilters((prev) => prev.filter((f) => f.id !== colFilterId))
                  setColumnFilterFns((prev) => {
                    const next = { ...prev }
                    delete next[colFilterId]
                    return next
                  })
                }}
                className="shrink-0 inline-flex items-center justify-center w-4 h-4 rounded-full bg-red-100 hover:bg-red-200 text-red-600 transition font-bold text-[9px]"
                title="Filtreyi Temizle"
                style={{ cursor: 'pointer', border: '1px solid #fca5a5', padding: 0 }}
              >
                ✕
              </button>
            )}
          </div>
        )
      }

      return newCol
    })
  }, [columns, columnFilterFns, columnFilters])

  // Date conversion helpers for DatePickerInput (range)
  const parsedDateRangeValue = useMemo<[Date | null, Date | null]>(() => {
    const from = dateRangeFilter?.fromDate ? new Date(dateRangeFilter.fromDate) : null
    const to = dateRangeFilter?.toDate ? new Date(dateRangeFilter.toDate) : null
    return [
      from && !Number.isNaN(from.getTime()) ? from : null,
      to && !Number.isNaN(to.getTime()) ? to : null
    ]
  }, [dateRangeFilter?.fromDate, dateRangeFilter?.toDate])

  const handleDateRangeChange = (val: [Date | null, Date | null]) => {
    const [start, end] = val
    const pad = (n: number) => String(n).padStart(2, '0')
    const fmt = (d: Date | null) => d ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : ''
    
    if (dateRangeFilter) {
      dateRangeFilter.onFromDateChange(fmt(start))
      dateRangeFilter.onToDateChange(fmt(end))
    }
    setPage(1)
  }

  // Calculate highest aggregated value for Chart scale
  const maxPivotVal = useMemo(() => {
    if (!pivotData) return 1
    const vals = Object.values(pivotData.rows).map(r => r.finalVal)
    return Math.max(...vals, 1)
  }, [pivotData])

  return (
    <div className="space-y-4">
      {/* Error Message */}
      {error && <div className="p-3 text-xs font-semibold text-red-600 bg-red-50 border border-red-200 rounded-lg">{error}</div>}

      {/* Main Table Toolbar Actions */}
      <div className="flex items-center justify-between flex-wrap gap-3 bg-gray-50 border border-gray-200 rounded-xl p-3 shadow-sm">
        <Group spacing="xs" className="w-full flex-wrap items-center">
          {dateRangeFilter && (
            <div className="flex items-center gap-1.5 border border-gray-200 rounded-lg p-1 bg-white">
              <IconCalendar size={14} className="text-gray-400 ml-1.5" />
              <DatePickerInput
                type="range"
                {...({ placeholder: 'Tarih Aralığı Seçin' } as any)}
                value={parsedDateRangeValue}
                onChange={handleDateRangeChange}
                size="xs"
                className="w-48"
                clearable
              />

              {quickDateFilters && (
                <div className="flex items-center gap-1">
                  {[
                    { key: 'today', label: 'Bugün' },
                    { key: 'week', label: 'Hafta' },
                    { key: 'month', label: 'Ay' },
                    { key: 'all', label: 'Tümü' }
                  ].map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => {
                        const pad = (n: number) => String(n).padStart(2, '0')
                        const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
                        const today = new Date()
                        if (item.key === 'today') {
                          const s = fmt(today); dateRangeFilter.onFromDateChange(s); dateRangeFilter.onToDateChange(s)
                        } else if (item.key === 'week') {
                          const mon = new Date(today); mon.setDate(today.getDate() - today.getDay() + 1)
                          const sun = new Date(mon); sun.setDate(mon.getDate() + 6)
                          dateRangeFilter.onFromDateChange(fmt(mon)); dateRangeFilter.onToDateChange(fmt(sun))
                        } else if (item.key === 'month') {
                          const first = new Date(today.getFullYear(), today.getMonth(), 1)
                          const last = new Date(today.getFullYear(), today.getMonth() + 1, 0)
                          dateRangeFilter.onFromDateChange(fmt(first)); dateRangeFilter.onToDateChange(fmt(last))
                        } else {
                          dateRangeFilter.onFromDateChange(''); dateRangeFilter.onToDateChange('')
                        }
                        setPage(1)
                      }}
                      className="h-[30px] px-2.5 text-[11px] font-semibold rounded bg-white text-gray-500 border border-gray-200 hover:border-gray-400 hover:text-gray-900 transition"
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <button
            type="button"
            disabled={loading}
            onClick={() => void loadData()}
            className="h-[34px] inline-flex items-center gap-1.5 px-4 text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white rounded-lg shadow-sm transition"
          >
            <IconRefresh size={14} className={loading ? 'animate-spin' : ''} />
            Yenile
          </button>

          <button
            type="button"
            onClick={handleTogglePivotMode}
            className={`h-[34px] inline-flex items-center gap-1.5 px-4 text-xs font-semibold rounded-lg shadow-sm transition ${
              pivotMode 
                ? 'bg-blue-600 hover:bg-blue-700 text-white' 
                : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50'
            }`}
          >
            <IconChartPie size={14} />
            {pivotMode ? 'Normal Tabloya Dön' : 'Pivot / Analiz Modu'}
          </button>

          {(activeFilterCount > 0 || globalFilter) && (
            <button
              type="button"
              onClick={handleClearFilters}
              className="h-[34px] inline-flex items-center gap-1.5 px-4 text-xs font-semibold bg-white border border-red-200 text-red-600 hover:bg-red-50 rounded-lg shadow-sm transition"
            >
              Filtreleri Temizle
            </button>
          )}

          {permissions?.canExport !== false && (exportOptions?.exportCurrentPage !== false || exportOptions?.exportAllFiltered) && (
            <Menu shadow="md" width={200}>
              <Menu.Target>
                <button
                  type="button"
                  className="h-[34px] inline-flex items-center gap-1.5 px-4 text-xs font-semibold bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 rounded-lg shadow-sm transition"
                >
                  <IconDownload size={14} />
                  Dışa Aktar
                </button>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Label>{pivotMode ? 'Pivot Rapor' : 'Aktif Sayfa'}</Menu.Label>
                <Menu.Item icon={<IconFileSpreadsheet size={14} />} onClick={() => handleExport('excel')}>
                  Excel (.xlsx)
                </Menu.Item>
                <Menu.Item icon={<IconFileText size={14} />} onClick={() => handleExport('csv')}>
                  CSV (.csv)
                </Menu.Item>
                <Menu.Item icon={<IconFileText size={14} />} onClick={() => handleExport('pdf')}>
                  PDF (Yazdır)
                </Menu.Item>
                <Menu.Item icon={<IconFileText size={14} />} onClick={() => handleExport('word')}>
                  Word (.doc)
                </Menu.Item>

                {!pivotMode && exportOptions?.exportAllFiltered && (
                  <>
                    <Menu.Divider />
                    <Menu.Label>Tüm Filtrelenmiş Kayıtlar</Menu.Label>
                    <Menu.Item icon={<IconDownload size={14} />} onClick={() => handleExport('excel', true)}>
                      Excel (.xlsx)
                    </Menu.Item>
                  </>
                )}
              </Menu.Dropdown>
            </Menu>
          )}

          {topToolbarCustomActions?.({ table: null })}
        </Group>
      </div>

      {pivotMode ? (
        /* Pivot Matrix & Chart view */
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-3 border border-gray-200 rounded-xl p-4 bg-gray-50/70">
            <Select
              label="Satır Alanı (Row)"
              placeholder="Grup Alanı Seçin"
              value={pivotRowField}
              onChange={(v) => setPivotRowField(v ?? '')}
              data={fieldOptions}
              size="xs"
            />
            <Select
              label="Sütun Alanı (Column - Opsiyonel)"
              placeholder="Yok"
              value={pivotColField}
              onChange={(v) => setPivotColField(v ?? '')}
              data={[{ value: '', label: 'Yok' }, ...fieldOptions]}
              size="xs"
            />
            <Select
              label="Hesaplanacak Değer (Value)"
              placeholder="Değer Alanı Seçin"
              value={pivotValueField}
              onChange={(v) => setPivotValueField(v ?? '')}
              data={numericFieldOptions}
              size="xs"
            />
            <Select
              label="Hesaplama Türü"
              value={pivotAggregation}
              onChange={(v) => setPivotAggregation((v as any) || 'sum')}
              data={[
                { value: 'sum', label: 'Toplam (Sum)' },
                { value: 'count', label: 'Adet (Count)' },
                { value: 'avg', label: 'Ortalama (Average)' }
              ]}
              size="xs"
            />
            <Select
              label="Grafik Türü"
              value={pivotChartType}
              onChange={(v) => setPivotChartType((v as any) || 'bar')}
              data={[
                { value: 'bar', label: 'Dikey Sütun Grafik' },
                { value: 'hbar', label: 'Yatay Çubuk Grafik' }
              ]}
              size="xs"
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            {/* Pivot Table */}
            <div className="lg:col-span-6 border border-gray-200 rounded-xl p-4 bg-white shadow-sm overflow-x-auto">
              <h3 className="text-xs font-bold text-gray-700 mb-3 uppercase tracking-wide flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-blue-500"></span>
                Pivot Matris Tablosu
              </h3>

              {!pivotData || Object.keys(pivotData.rows).length === 0 ? (
                <div className="p-10 text-center text-xs text-gray-400">
                  Tablo oluşturmak için geçerli satır, sütun ve değer alanları seçiniz.
                </div>
              ) : (
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="p-2 text-left text-gray-600 font-bold border-r border-gray-100">
                        {columns.find(c => c.accessorKey === pivotRowField)?.header as string || pivotRowField}
                      </th>
                      {pivotData.columns.map((cVal) => (
                        <th key={cVal} className="p-2 text-right text-gray-600 font-semibold border-r border-gray-100">
                          {cVal}
                        </th>
                      ))}
                      <th className="p-2 text-right text-gray-700 font-bold">Genel Toplam</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(pivotData.rows).map(([rowKey, r]) => (
                      <tr key={rowKey} className="border-b border-gray-150 hover:bg-gray-50/50">
                        <td className="p-2 font-medium text-gray-900 border-r border-gray-100">{rowKey}</td>
                        {pivotData.columns.map((cVal) => {
                          const val = r.values[cVal] ?? 0
                          return (
                            <td key={cVal} className="p-2 text-right text-gray-800 border-r border-gray-100">
                              {pivotAggregation === 'count' ? val : `₺${val.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}`}
                            </td>
                          )
                        })}
                        <td className="p-2 text-right font-bold text-gray-900 bg-gray-50/30">
                          {pivotAggregation === 'count' ? r.finalVal : `₺${r.finalVal.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Pivot Chart */}
            <div className="lg:col-span-6">
              {!pivotData || Object.keys(pivotData.rows).length === 0 ? (
                <div className="border border-gray-200 rounded-xl p-5 bg-white shadow-sm h-full flex items-center justify-center text-xs text-gray-400">
                  Grafik çizmek için ayarları yapılandırın.
                </div>
              ) : pivotChartType === 'hbar' ? (
                <div className="border border-gray-200 rounded-xl p-5 bg-white shadow-sm space-y-4">
                  <h3 className="text-xs font-bold text-gray-700 uppercase tracking-wide flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                    Yatay Çubuk Analiz Grafiği
                  </h3>
                  <div className="space-y-3.5">
                    {Object.entries(pivotData.rows).map(([key, row]) => {
                      const pct = (row.finalVal / maxPivotVal) * 100
                      return (
                        <div key={key} className="space-y-1">
                          <div className="flex items-center justify-between text-xs font-semibold text-gray-700">
                            <span className="truncate pr-2">{key}</span>
                            <span className="font-bold text-gray-900">
                              {pivotAggregation === 'count' ? row.finalVal : `₺${row.finalVal.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}`}
                            </span>
                          </div>
                          <div className="h-4 w-full bg-gray-100 rounded-full overflow-hidden shadow-inner">
                            <div
                              className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 rounded-full transition-all duration-500"
                              style={{ width: `${Math.max(pct, 2)}%` }}
                            />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ) : (
                <div className="border border-gray-200 rounded-xl p-5 bg-white shadow-sm flex flex-col h-full justify-between">
                  <h3 className="text-xs font-bold text-gray-700 mb-6 uppercase tracking-wide flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                    Dikey Sütun Analiz Grafiği
                  </h3>

                  <div className="relative h-64 border-b border-l border-gray-200 pb-6 pl-4 flex items-end justify-around">
                    {/* Grid lines absolute background */}
                    {[100, 75, 50, 25].map((level) => (
                      <div
                        key={level}
                        className="absolute left-0 right-0 border-t border-dashed border-gray-200 flex items-center justify-start text-[9px] text-gray-400"
                        style={{ bottom: `${level}%`, height: 0 }}
                      >
                        <span className="-mt-3 ml-1 bg-white px-1 font-semibold">
                          {pivotAggregation === 'count' 
                            ? Math.round(maxPivotVal * (level / 100)) 
                            : `₺${Math.round(maxPivotVal * (level / 100)).toLocaleString('tr-TR')}`}
                        </span>
                      </div>
                    ))}

                    {/* Render columns */}
                    {Object.entries(pivotData.rows).map(([key, row]) => {
                      const pct = (row.finalVal / maxPivotVal) * 100
                      return (
                        <div key={key} className="flex flex-col items-center flex-1 group relative">
                          <div className="absolute bottom-full mb-2 hidden group-hover:flex flex-col items-center z-10 transition-all duration-200">
                            <div className="bg-gray-800 text-white text-[10px] font-bold py-1 px-2 rounded shadow-lg whitespace-nowrap">
                              {key}: {pivotAggregation === 'count' ? row.finalVal : `₺${row.finalVal.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}`}
                            </div>
                            <div className="w-1.5 h-1.5 bg-gray-800 rotate-45 -mt-1" />
                          </div>

                          <div
                            className="w-8 sm:w-12 bg-gradient-to-t from-emerald-500 to-teal-400 hover:from-emerald-600 hover:to-teal-500 rounded-t-md transition-all duration-500 shadow-sm cursor-pointer"
                            style={{ height: `${Math.max(pct, 4)}%` }}
                          />

                          <span className="absolute top-full mt-2 text-[10px] font-semibold text-gray-500 max-w-[80px] truncate text-center" title={key}>
                            {key}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        /* Standard MantineReactTable view */
        <MantineReactTable
          columns={mrtColumns as any}
          data={data}
          enableColumnActions={true}
          enableColumnFilters={enableColumnFilters}
          enableGlobalFilter={enableGlobalFilter}
          enablePagination={true}
          enableSorting={enableSorting}
          enableBottomToolbar={true}
          enableTopToolbar={false} /* we use our custom toolbar at the top */
          enableColumnDragging={true}
          enableColumnOrdering={true}
          enableColumnResizing={true}
          enableGrouping={true}
          manualPagination={true}
          manualSorting={true}
          manualFiltering={true}
          rowCount={total}
          getRowId={getRowId}
          state={{
            pagination,
            isLoading: loading,
            expanded,
            sorting,
            columnFilters,
            globalFilter,
            columnVisibility,
            columnFilterFns,
            columnPinning: {
              right: ['mrt-row-actions']
            },
            ...(columnOrder && columnOrder.length > 0 ? { columnOrder } : {})
          }}
          enableColumnFilterModes={true}
          onColumnFilterFnsChange={(updater) => {
            const next = typeof updater === 'function' ? updater(columnFilterFns as any) : updater
            setColumnFilterFns(next as Record<string, string>)
            setPage(1)
          }}
          onColumnVisibilityChange={setColumnVisibility}
          onColumnOrderChange={setColumnOrder}
          onPaginationChange={(updater) => {
            const next = typeof updater === 'function' ? updater(pagination) : updater
            setPage(next.pageIndex + 1)
            setPageSize(next.pageSize)
          }}
          onSortingChange={(updater) => {
            const next = typeof updater === 'function' ? updater(sorting) : updater
            setSorting(next)
            setPage(1)
          }}
          onColumnFiltersChange={(updater) => {
            const next = typeof updater === 'function' ? updater(columnFilters) : updater
            setColumnFilters(next)
            setPage(1)
          }}
          onGlobalFilterChange={(updater) => {
            const next = typeof updater === 'function' ? updater(globalFilter) : updater
            setGlobalFilter(next)
            setPage(1)
          }}
          enableExpanding={enableExpanding}
          onExpandedChange={setExpanded as any}
          renderDetailPanel={renderDetailPanel}
          enableRowActions={enableRowActions}
          positionActionsColumn="last"
          renderRowActions={renderRowActions}
          localization={useMemo(() => ({
            ...MRT_Localization_TR,
            noRecordsToDisplay: emptyMessage
          }), [emptyMessage])}
          enablePinning={true}
          initialState={{
            showColumnFilters: true,
            columnPinning: {
              right: ['mrt-row-actions']
            }
          }}
          displayColumnDefOptions={{
            'mrt-row-actions': {
              header: 'İŞLEMLER',
              size: 110,
              mantineTableHeadCellProps: {
                align: 'center'
              },
              mantineTableBodyCellProps: {
                align: 'center'
              }
            }
          }}
          mantineTableContainerProps={{
            sx: {
              maxHeight: 'auto',
              overflowX: 'auto'
            },
          }}
          mantineTableProps={{
            withColumnBorders: true,
            withBorder: true,
            // !important'li degerler Emotion'in CSS tipine uymuyor (tip yalnizca literal
            // degerleri taniyor); stil aynen gecerli, yalnizca tip denetimi disinda.
            sx: ({
              'thead tr th': {
                backgroundColor: '#f8fafc',
                color: '#475569',
                fontSize: '11px',
                fontWeight: 600,
                textTransform: 'uppercase',
                '&:has(div:has(input) ~ div:has(input)), &:has(input[placeholder="Min"]), &:has(input[placeholder="Maks"]), &:has(.mantine-Input-wrapper ~ .mantine-Input-wrapper), &:has(.mantine-InputWrapper-root ~ .mantine-InputWrapper-root)': {
                  minWidth: '320px !important'
                },
                '&:has(div:has(input) ~ div:has(input)) .mantine-Group-root, &:has(div:has(input) ~ div:has(input)) .mantine-Flex-root, &:has(input[placeholder="Min"]) .mantine-Group-root, &:has(input[placeholder="Min"]) .mantine-Flex-root': {
                  flexWrap: 'nowrap !important',
                  gap: '4px !important',
                  width: '100% !important'
                },
                '&:has(div:has(input) ~ div:has(input)) .mantine-Input-wrapper, &:has(div:has(input) ~ div:has(input)) .mantine-InputWrapper-root, &:has(input[placeholder="Min"]) .mantine-Input-wrapper, &:has(input[placeholder="Min"]) .mantine-InputWrapper-root': {
                  minWidth: '0 !important',
                  flex: '1 !important'
                },
                '&:has(div:has(input) ~ div:has(input)) input, &:has(input[placeholder="Min"]) input': {
                  minWidth: '0 !important',
                  width: '100% !important'
                }
              },
              'tbody tr td': {
                fontSize: '12px'
              }
            } as any),
          }}
        />
      )}
    </div>
  )
}
