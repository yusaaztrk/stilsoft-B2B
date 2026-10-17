import React, { useMemo, useState, useEffect } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { LayoutGrid, List, Filter, X } from 'lucide-react'
import { AppDataTable, isPriceColumn } from './data-table'
import { getCustomerOrDealerType } from '../utils/customerType'

export type TableColumn<Row> = {
  key: keyof Row | string
  label: string
  sortable?: boolean
  searchable?: boolean
  primary?: boolean
  hideOnMobile?: boolean
  filter?:
    | { type: 'text' }
    | { type: 'number' }
    | { type: 'select'; options: Array<{ label: string; value: string }> }
    | { type: 'date' }
  render?: (value: any, row: Row) => React.ReactNode
  /**
   * SÜZGEÇ HÜCREDEKİ HER ŞEYE BAKSIN (2026-09-18 kullanıcı isteği: "kolon üstünde yazılan
   * her şeye göre arama yapsın, tıpkı müşteri kolonu gibi").
   *
   * Süzgeç normalde satırın HAM alanına bakar; hücrede ikinci bir bilgi gösteriliyorsa
   * (durum + durum tarihi gibi) o bilgi aranamıyordu. Müşteri sütunu bunu ada+telefon+adres
   * için özel durum olarak çözmüştü; kural artık genel: sütun kendi aranacak metnini verir.
   */
  filterText?: (row: Row) => string
}

type TableCellProps<Row> = {
  col: TableColumn<any>
  val: any
  row: Row
}

const TableCell = React.memo(function TableCell<Row>({ col, val, row }: TableCellProps<Row>) {
  if (col.render) {
    return <>{col.render(val, row)}</>
  }
  if (val !== null && val !== undefined) {
    const keyStr = String(col.key)
    const labelStr = String(col.label)
    if (isPriceColumn(keyStr, labelStr)) {
      const num = Number(val)
      if (!isNaN(num)) {
        return <>{num.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</>
      }
    }
    return <>{String(val)}</>
  }
  return null
})

type Props<Row> = {
  columns: TableColumn<Row>[]
  data: Row[]
  onRowClick?: (row: Row) => void
  rowKey?: (row: Row, index: number) => string | number
  rowClassName?: (row: Row) => string
  showColumnFilters?: boolean
  globalSearch?: string
  initialHeaderFilters?: Record<string, string[]>
  initialColumnFilters?: Record<string, any>
  initialPageSize?: number
  pageSize?: number
  onPageSizeChange?: (pageSize: number) => void
  onFilteredDataChange?: (rows: Row[]) => void
  isRowExpanded?: (row: Row) => boolean
  onToggleRowExpanded?: (row: Row) => void
  renderExpandedRow?: (row: Row) => React.ReactNode
  loading?: boolean
  /** Opt out of preselecting today on date columns. */
  disableDateDefaultToday?: boolean
  serverSide?: boolean
  totalCount?: number
  currentPage?: number
  onPageChange?: (page: number) => void
  onSortChange?: (field: any, direction: any) => void
  currentSortField?: string | null
  currentSortDirection?: string | null
  groupByField?: string
  /**
   * Verilirse tablonun üstünde "Kolonlar" menüsü çıkar ve seçim bu anahtarla localStorage'a
   * yazılır. Çok kolonlu listeler laptop genişliğine sığmıyor; kullanıcının kolon kapatabilmesi
   * dar ekranlardaki tek gerçek çare, ama her sayfa açılışında sıfırlanırsa işe yaramaz.
   */
  columnVisibilityKey?: string
}

export default function Table<Row extends Record<string, any>>({
  columns,
  data,
  onRowClick,
  rowKey,
  rowClassName,
  showColumnFilters = true,
  globalSearch,
  initialColumnFilters,
  initialPageSize = 20,
  pageSize: propPageSize,
  onPageSizeChange,
  renderExpandedRow,
  isRowExpanded,
  onToggleRowExpanded,
  onFilteredDataChange,
  loading,
  disableDateDefaultToday,
  serverSide = false,
  totalCount = 0,
  currentPage: propCurrentPage = 1,
  onPageChange,
  columnVisibilityKey
}: Props<Row>) {
  // Kolon görünürlüğü sayfa başına saklanıyor: kullanıcı laptopta kapattığı kolonu her
  // dönüşünde tekrar kapatmak zorunda kalmasın.
  const visibilityStorageKey = columnVisibilityKey ? `table_columns_${columnVisibilityKey}` : null
  const [columnVisibility, setColumnVisibility] = useState<Record<string, boolean>>(() => {
    if (!visibilityStorageKey) return {}
    try {
      const raw = localStorage.getItem(visibilityStorageKey)
      return raw ? JSON.parse(raw) : {}
    } catch {
      return {}
    }
  })

  const handleColumnVisibilityChange = (next: Record<string, boolean>) => {
    setColumnVisibility(next)
    if (!visibilityStorageKey) return
    try {
      localStorage.setItem(visibilityStorageKey, JSON.stringify(next))
    } catch {
      /* kota dolu / gizli mod: görünürlük yine de bu oturumda çalışır */
    }
  }

  /**
   * Görünüm tercihi ÜÇ değerli: 'table', 'card' ve "hiç seçilmemiş" (null).
   *
   * Eskiden iki değerliydi ve seçilmemiş hâli 'table' sayılıyordu: telefonda açan herkes
   * 1100px genişliğinde, 9 punto yazılı tabloyu yatay kaydırarak kullanıyordu. Kart görünümü
   * kodda vardı ama kimse ayarlar arasında gezip açmadığı için sahada hiç görülmedi.
   *
   * Artık dar ekranın VARSAYILANI kart. Elle seçim yine kaydediliyor, yani tabloyu tercih eden
   * kullanıcı tabloda kalır — sadece hiç dokunmayan kullanıcı okunur bir ekranla karşılaşır.
   */
  const [viewPref, setViewPref] = useState<'table' | 'card' | null>(() => {
    const raw = localStorage.getItem('table_view_mode')
    return raw === 'table' || raw === 'card' ? raw : null
  })
  const [windowWidth, setWindowWidth] = useState(() => window.innerWidth)
  const [showFilterModal, setShowFilterModal] = useState(false)

  React.useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth)
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  const isNarrow = windowWidth < 768
  const isCardView = viewPref ? viewPref === 'card' : isNarrow

  const handleToggleView = (mode: 'table' | 'card') => {
    setViewPref(mode)
    try {
      localStorage.setItem('table_view_mode', mode)
    } catch {
      /* kota dolu / gizli mod: seçim yine de bu oturumda geçerli */
    }
  }
  const [internalPageIndex, setInternalPageIndex] = useState(0)
  const pageIndex = serverSide ? (propCurrentPage - 1) : internalPageIndex
  const setPageIndex = (val: number | ((p: number) => number)) => {
    if (serverSide) {
      if (typeof val === 'function') {
        onPageChange?.(val(pageIndex) + 1)
      } else {
        onPageChange?.(val + 1)
      }
    } else {
      if (typeof val === 'function') {
        setInternalPageIndex(val)
      } else {
        setInternalPageIndex(val)
      }
    }
  }

  const [pageSize, setPageSize] = useState(propPageSize ?? initialPageSize)

  useEffect(() => {
    if (propPageSize !== undefined) {
      setPageSize(propPageSize)
    }
  }, [propPageSize])

  const handlePageSizeChange = (size: number) => {
    setPageSize(size)
    onPageSizeChange?.(size)
  }

  // Seeding date columns with today is AppDataTable's job (it is the single place that
  // does it, once per column, so the X really clears). Only explicit page defaults live here.
  const [columnFilters, setColumnFilters] = useState<Record<string, any>>(() => ({
    ...(initialColumnFilters ?? {})
  }))
  const [globalFilter, setGlobalFilter] = useState(globalSearch ?? '')

  const activeFiltersCount = useMemo(() => {
    return Object.values(columnFilters).filter(val => {
      if (!val) return false
      if (typeof val === 'object') {
        return !!(val.value || val.value2 || (val.selectedOptions && val.selectedOptions.length > 0))
      }
      return true
    }).length
  }, [columnFilters])
  React.useEffect(() => {
    if (globalSearch !== undefined) {
      setGlobalFilter(globalSearch)
    }
  }, [globalSearch])

  const appColumns = useMemo<ColumnDef<Row, any>[]>(() => {
    return columns.map((col, idx) => {
      const colKey = String(col.key)
      let filterType: 'text' | 'select' | 'date' | 'number' | undefined = undefined

      if (col.searchable === false || colKey === 'id' || colKey === 'actions') {
        filterType = undefined
      } else if (col.filter) {
        filterType = col.filter.type
      } else if (col.searchable || showColumnFilters) {
        filterType = 'text'
      }

      // İşlem sütunu GİZLENEMEZ. "Kolonlar" menüsü açıldığından beri kullanıcı onu kapatıp
      // satırdaki bütün düğmeleri kaybedebiliyordu; geri getirmenin yolu (Sıfırla) menünün
      // içinde olduğu için de kolay fark edilmiyordu.
      const isActionsCol = colKey === 'actions'

      return {
        id: !isActionsCol ? colKey : `actions_${idx}`,
        enableHiding: !isActionsCol,
        // AKSİYON SÜTUNU KIRPILMASIN (2026-08-21 kullanıcı bildirimi).
        //
        // Sütun genişliği içeriğe göre ayrılmıyor; sabit bir varsayılana oturuyordu ve içine
        // "Fişi Yazdır" düğmesi + detay + sil ikonları sığmıyordu. Sil ikonu satırın sağından
        // taşıp kırpılıyor, kullanıcı düğmeyi göremediği için kaydı silemiyordu. İkonlar
        // büyütülünce (kullanıcı isteği) sorun bütün servis modüllerinde görünür oldu.
        //
        // Genişlik burada, TEK yerde veriliyor: sütunu tanımlayan 7 sayfaya tek tek genişlik
        // yazmak, sonradan eklenecek sayfada yine unutulurdu.
        ...(isActionsCol ? { size: 220, minSize: 220, enableResizing: false } : {}),
        accessorFn: (row: Row) => {
          // Sütun kendi aranacak metnini veriyorsa o kazanır (bkz. `filterText`).
          if (col.filterText) return col.filterText(row)
          if (colKey === 'customerName') {
            const name = (row as any).customerName || ''
            const phone = (row as any).customerPhone || ''
            const address = (row as any).customerAddress || ''
            return `${name} ${phone} ${address}`
          }
          if (colKey === 'customerType') {
            return getCustomerOrDealerType(row).toLowerCase()
          }
          if (colKey === 'isUnderWarranty') {
            // GARANTİ SÜZGECİ HİÇ ÇALIŞMIYORDU: seçenekler 'evet'/'hayır' metniyle
            // tanımlıyken hücrenin ham değeri boolean'dı; MRT `true` ile 'evet'i asla
            // eşleştiremiyor, süzgeç sessizce boş liste döndürüyordu.
            return (row as any).isUnderWarranty ? 'evet' : 'hayır'
          }
          const raw = row[col.key]
          return raw !== undefined && raw !== null ? raw : ''
        },
        header: col.label,
        enableSorting: col.sortable === true,
        meta: {
          filterType,
          filterPlaceholder: typeof col.label === 'string' && col.label ? `${col.label}...` : '',
          filterOptions: col.filter?.type === 'select' ? col.filter.options : undefined
        },
        cell: ({ row, getValue }) => {
          const val = (row.original as any)[colKey] ?? getValue()
          return <TableCell col={col} val={val} row={row.original} />
        }
      }
    })
  }, [columns, showColumnFilters])

  return (
    <div className="relative w-full">
      {/*
        MOBILE ONLY: Görünüm seçici (Tablo / Kart).
        Eskiden `absolute` sağ üstteydi ve ilk kartın üstüne binip içeriğini örtüyordu
        (kullanıcı ekranı, 2026-09-27). Artık akışta, kartların üstünde kendi satırında.
      */}
      <div className="flex md:hidden justify-end px-3 pt-2 items-center">
        <div className="bg-white/95 backdrop-blur-xs p-0.5 rounded-lg flex gap-0.5 items-center border border-slate-200/90 shadow-sm">
          <button
            type="button"
            onClick={() => handleToggleView('table')}
            className={`px-2 py-1 rounded-md text-center font-bold text-[10px] uppercase tracking-wide transition-all cursor-pointer whitespace-nowrap active:scale-95 flex items-center gap-1 ${
              !isCardView
                ? 'bg-[#B91C1C] text-white shadow-sm'
                : 'text-slate-600 hover:text-slate-900 bg-transparent hover:bg-slate-200/40'
            }`}
          >
            <List className="w-3.5 h-3.5" />
            Tablo
          </button>
          <button
            type="button"
            onClick={() => handleToggleView('card')}
            className={`px-2 py-1 rounded-md text-center font-bold text-[10px] uppercase tracking-wide transition-all cursor-pointer whitespace-nowrap active:scale-95 flex items-center gap-1 ${
              isCardView
                ? 'bg-[#B91C1C] text-white shadow-sm'
                : 'text-slate-600 hover:text-slate-900 bg-transparent hover:bg-slate-200/40'
            }`}
          >
            <LayoutGrid className="w-3.5 h-3.5" />
            Kart
          </button>
        </div>
      </div>

      <AppDataTable
        data={data}
        columns={appColumns}
        isCardView={isCardView && isNarrow}
        rowId={(row) => (rowKey ? String(rowKey(row, 0)) : String((row as any).id ?? ''))}
        onRowClick={onRowClick}
        rowClassName={rowClassName}
        renderExpandedRow={renderExpandedRow}
        isRowExpanded={isRowExpanded}
        onToggleRowExpanded={onToggleRowExpanded}
        // Bu prop kabul ediliyor ama aşağı GEÇİRİLMİYORDU: sayfaların `filteredRows` state'i
        // hep boş kalıyor, "Dışa Aktar" filtresiz listeyi yazıyordu.
        onFilteredDataChange={onFilteredDataChange}
        columnVisibility={
          visibilityStorageKey
            ? { columnVisibility, onColumnVisibilityChange: handleColumnVisibilityChange }
            : undefined
        }
        states={loading !== undefined ? { loading } : undefined}
        filtering={{
          globalFilter,
          onGlobalFilterChange: setGlobalFilter,
          columnFilters,
          // Keep the key with a null value on clear: dropping it would look like "never
          // filtered" to anything that inspects the map.
          onColumnFilterChange: (colId, val) => setColumnFilters((p) => ({ ...p, [colId]: val })),
          disableDateDefaultToday,
          manualFiltering: serverSide
        }}
        pagination={{
          pageIndex,
          pageSize,
          totalCount: serverSide ? totalCount : data.length,
          pageCount: Math.ceil((serverSide ? totalCount : data.length) / pageSize) || 1,
          onPageChange: setPageIndex,
          onPageSizeChange: handlePageSizeChange
        }}
      />
    </div>
  )
}
