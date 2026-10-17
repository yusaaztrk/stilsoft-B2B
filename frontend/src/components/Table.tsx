import React, { useMemo, useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { AppDataTable } from './data-table'
export { OverflowTooltip, extractTextContent } from './common/OverflowTooltip'

export type TableColumn<Row> = {
  /**
   * DTO alani ya da TURETILMIS kolon icin serbest kimlik.
   *
   * Aylik kirilim gibi kolonlarin karsiligi veride yok: deger `render` icinde bir diziden
   * okunuyor (`monthlyIn[0]` gibi) ve `key` yalnizca benzersiz kimlik gorevi goruyor.
   * `keyof Row` kisiti bu kolonlari bastan disliyordu.
   */
  key: keyof Row | (string & {})
  /** Baslik JSX olabilir: secim kolonunda "tumunu sec" onay kutusu basiliyor. */
  label: React.ReactNode
  sortable?: boolean
  searchable?: boolean
  accessorFn?: (row: Row) => any
  filterValue?: (row: Row) => string
  filter?:
    | { type: 'text' }
    | { type: 'number' }
    | { type: 'select'; options: Array<{ label: string; value: string }> }
    | { type: 'checkbox'; options: Array<{ label: string; value: string }> }
    | { type: 'date' }
  /** Sutun genisligi (CSS degeri, '90px' gibi). Verilmezse icerige gore dagilir. */
  width?: string
  showTotal?: boolean
  totalCurrencyCode?: string
  tryTotalLabel?: string
  totalScope?: 'filtered' | 'all'
  totalValue?: number
  /** Toplama girecek satırlar (opt-in); bkz. data-table/types.ts. */
  totalRowFilter?: (row: Row) => boolean
  /**
   * Hucre degeri. Tip `any`: `Row[keyof Row]` TUM alanlarin birlesimi oldugu icin pratikte
   * hicbir kolonda dogru tipi vermiyor, ustelik turetilmis kolonlarda veride karsiligi da
   * yok. Deger zaten `(row.original as any)[key]` ile okunuyor.
   */
  render?: (value: any, row: Row) => React.ReactNode
}

type TableCellProps<Row> = {
  col: TableColumn<Row>
  val: any
  row: Row
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
  // React.memo jenerik bileseni sarinca tip parametresini yutuyor ve bilesen
  // `TableCellProps<unknown>` gibi gorunuyordu; sonucu jenerik imzayla yeniden tiplemek
  // bu kalibin bilinen cozumu.
}) as <Row>(props: TableCellProps<Row>) => React.ReactElement | null

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
  onFilteredDataChange?: (rows: Row[]) => void
  isRowExpanded?: (row: Row) => boolean
  onToggleRowExpanded?: (row: Row) => void
  renderExpandedRow?: (row: Row) => React.ReactNode
  /**
   * Verilirse tablonun alt cubugunda "Yenile" dugmesi cikar ve basildiginda bu cagrilir.
   * Sayfanin mevcut veri cekme fonksiyonu (`refetch`) dogrudan verilebilir.
   * Suzgecler tablonun KENDI durumunda oldugu icin tazeleme onlari SIFIRLAMAZ — tarayiciyi
   * yenilemek ise hepsini sifirliyordu.
   */
  onRefresh?: () => void | Promise<void>
  refreshing?: boolean
  loading?: boolean
  /** Opt out of preselecting today on date columns. */
  disableDateDefaultToday?: boolean
}

export default function Table<Row extends Record<string, any>>({
  columns,
  data,
  onRowClick,
  rowKey,
  rowClassName,
  showColumnFilters = true,
  globalSearch,
  initialHeaderFilters,
  initialColumnFilters,
  initialPageSize = 20,
  renderExpandedRow,
  isRowExpanded,
  onToggleRowExpanded,
  loading,
  disableDateDefaultToday,
  onFilteredDataChange,
  onRefresh,
  refreshing
}: Props<Row>) {
  const [pageIndex, setPageIndex] = useState(0)
  const [pageSize, setPageSize] = useState(initialPageSize)
  // Seeding date columns with today is AppDataTable's job (it is the single place that
  // does it, once per column, so the X really clears). Only explicit page defaults live here.
  const [columnFilters, setColumnFilters] = useState<Record<string, any>>(() => ({
    ...Object.fromEntries(
      Object.entries(initialHeaderFilters ?? {}).map(([key, values]) => [
        key,
        { selectedOptions: values, operator: 'in' }
      ])
    ),
    ...(initialColumnFilters ?? {})
  }))
  const [globalFilter, setGlobalFilter] = useState(globalSearch ?? '')

  React.useEffect(() => {
    if (globalSearch !== undefined) {
      setGlobalFilter(globalSearch)
    }
  }, [globalSearch])

  /**
   * SÜZGEÇ DEĞİŞİNCE SAYFA BAŞA DÖNER (denetim md. 39).
   *
   * `pageIndex` süzgeçlerden bağımsız duruyordu: 5. sayfadayken süzgeç uygulanıp sonuç 1
   * sayfaya düştüğünde tablo hâlâ 5. sayfayı göstermeye çalışıyor ve kullanıcı "Gösterilecek
   * veri yok" ekranında kilitli kalıyordu. Süzgeç ya da sayfa boyutu değişince başa dönülür.
   */
  React.useEffect(() => {
    setPageIndex(0)
  }, [globalFilter, columnFilters, pageSize])

  /**
   * Veri küçüldüğünde de sayfa dışarıda kalmasın: satır sayısı azalıp mevcut sayfa
   * kaybolduysa son geçerli sayfaya çekilir (süzgeç dışı sebepler için — veri yenilenmesi gibi).
   */
  React.useEffect(() => {
    const lastPage = Math.max(0, Math.ceil(data.length / pageSize) - 1)
    if (pageIndex > lastPage) setPageIndex(lastPage)
  }, [data.length, pageSize, pageIndex])

  const appColumns = useMemo<ColumnDef<Row, any>[]>(() => {
    return columns.map((col, idx) => {
      const colKey = String(col.key)
      let filterType: 'text' | 'select' | 'date' | 'number' | 'checkbox' | undefined = undefined

      if (col.filter) {
        filterType = col.filter.type
      } else if (col.searchable || showColumnFilters) {
        filterType = 'text'
      }

      return {
        id: colKey !== 'actions' ? colKey : `actions_${idx}`,
        accessorFn: (row: Row) => {
          if (col.filterValue) {
            return col.filterValue(row)
          }
          if (col.accessorFn) {
            return col.accessorFn(row)
          }
          const raw = row[col.key]
          return raw !== undefined && raw !== null ? raw : ''
        },
        // TanStack basligi `string` ya da SABLON FONKSIYONU bekliyor; JSX baslik (secim
        // kolonundaki onay kutusu gibi) ancak fonksiyon olarak gecebilir.
        header: typeof col.label === 'string' ? col.label : () => col.label,
        /**
         * SIRALAMA VARSAYILAN OLARAK ACIK (2026-08-22).
         *
         * Onceki hali `col.sortable === true` idi: sıralama yalnizca kolonda ACIKCA
         * istendiginde calisiyordu ve 40 sayfanin cogunda hic istenmemisti. Bu yuzden
         * Fatura Dokumu'nde (dogrudan `AppDataTable` kullaniyor, orada varsayilan ACIK)
         * sutun basliklarinda siralama oku varken diger tablolarda hic yoktu.
         *
         * Artik kural iki tarafta da ayni: `sortable: false` demedikce siralanir.
         * Islem ve secim kolonlari disarida — birinin degeri bos metin, digeri onay kutusu;
         * ikisini de siralamak anlamsiz, tiklanabilir gorunmeleri yaniltici olurdu.
         */
        enableSorting: colKey !== 'actions' && colKey !== '__selected' && col.sortable !== false,
        meta: {
          filterType: colKey === 'actions' || colKey === '__selected' ? undefined : filterType,
          filterPlaceholder: typeof col.label === 'string' && col.label ? `${col.label}...` : '',
          filterOptions: col.filter?.type === 'select' || col.filter?.type === 'checkbox' ? col.filter.options : undefined,
          width: col.width,
          showTotal: col.showTotal,
          totalCurrencyCode: col.totalCurrencyCode,
          tryTotalLabel: col.tryTotalLabel,
          totalScope: col.totalScope,
          totalValue: col.totalValue,
          totalRowFilter: col.totalRowFilter
        },
        cell: ({ row, getValue }) => {
          const val = (row.original as any)[colKey] ?? getValue()
          return <TableCell col={col} val={val} row={row.original} />
        }
      }
    })
  }, [columns, showColumnFilters])

  return (
    <AppDataTable
      data={data}
      columns={appColumns}
      rowId={(row, idx) => (rowKey ? String(rowKey(row, idx)) : String(row.id ?? idx))}
      onRowClick={onRowClick}
      rowClassName={rowClassName}
      renderExpandedRow={renderExpandedRow}
      isRowExpanded={isRowExpanded}
      onToggleRowExpanded={onToggleRowExpanded}
      states={loading !== undefined ? { loading } : undefined}
      /* Suzgecten gecen satirlar sayfaya bildirilir. Bu prop tipte VARDI ama hicbir yere
         baglanmamisti; sayfalar ustteki ozetleri ham veriden hesapladigi icin tabloda tek
         satir kalsa bile ozet butun satirlarin toplamini gosteriyordu. */
      onFilteredRowsChange={onFilteredDataChange}
      filtering={{
        globalFilter,
        onGlobalFilterChange: setGlobalFilter,
        columnFilters,
        // Keep the key with a null value on clear: dropping it would look like "never
        // filtered" to anything that inspects the map.
        onColumnFilterChange: (colId, val) => setColumnFilters((p) => ({ ...p, [colId]: val })),
        disableDateDefaultToday
      }}
      pagination={{
        pageIndex,
        pageSize,
        totalCount: data.length,
        pageCount: Math.ceil(data.length / pageSize) || 1,
        onPageChange: setPageIndex,
        onPageSizeChange: setPageSize,
        onRefresh,
        refreshing
      }}
    />
  )
}
