import { useCallback, useEffect, useRef, useState } from 'react'
import type { InvoiceListItem } from '../../lib/invoices'
import { API_BASE_URL } from '../../config/api'
import { convertToUrlQueryString } from '../../components/table/tableQueryUtils'
import type { TableQueryParams } from '../../components/table/tableTypes'
import type { SortingState } from '@tanstack/react-table'
import type { ColumnFilterStateValue } from '../../components/data-table/types'

type UseInvoiceListOptions = {
  fromDate?: string
  toDate?: string
  refreshKey: number
}

function parseTurkishDateToYyyyMmDd(str: string): string {
  if (!str) return ''
  const parts = str.trim().split('.')
  if (parts.length === 3) {
    const d = parts[0].padStart(2, '0')
    const m = parts[1].padStart(2, '0')
    const y = parts[2]
    return `${y}-${m}-${d}`
  }
  return str
}

function getTodayFormatted(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`
}

export function useInvoiceList({ fromDate, toDate, refreshKey }: UseInvoiceListOptions) {
  const [data, setData] = useState<InvoiceListItem[]>([])
  const [totalCount, setTotalCount] = useState<number>(0)
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)

  const [pageIndex, setPageIndex] = useState<number>(0)
  const [pageSize, setPageSize] = useState<number>(20) // 1. Start with 20 invoices per page
  const [sorting, setSorting] = useState<SortingState>([{ id: 'tarih', desc: true }]) // 2. Newest invoice first!
  const [globalFilter, setGlobalFilter] = useState<string>('')

  // 3. Default initial date filter: TODAY (between today and today)
  const todayStr = getTodayFormatted()
  const [columnFilters, setColumnFilters] = useState<Record<string, ColumnFilterStateValue | string>>(() => ({
    tarih: {
      value: todayStr,
      value2: todayStr,
      operator: 'between'
    },
    /**
     * ILK ACILISTA ISLEM TIPI = SATIS (2026-08-22 kullanici karari).
     *
     * Ekran gunluk satis takibi icin aciliyor; hizmet, alis, tamir ve iade satirlari
     * araya karisinca gunun satis dokumu okunamiyordu. Kullanici suzgeci degistirebilir ya
     * da X ile temizleyip hepsini gorebilir — bu yalnizca BASLANGIC degeri.
     *
     * Operator `in`: uc bu kolonu yalnizca `islemTipiIn` ile taniyor (bkz. sorgu kurulumu).
     */
    islemTipi: {
      value: 'SATIŞ',
      operator: 'in'
    }
  }))

  const activeAbortController = useRef<AbortController | null>(null)

  const handlePageChange = useCallback((newPageIndex: number) => {
    setPageIndex(newPageIndex)
  }, [])

  const handlePageSizeChange = useCallback((newPageSize: number) => {
    setPageSize(newPageSize)
    setPageIndex(0) // Reset to first page
  }, [])

  const handleGlobalFilterChange = useCallback((newFilter: string) => {
    setGlobalFilter(newFilter)
    setPageIndex(0) // Reset to first page
  }, [])

  const handleSortingChange = useCallback((newSorting: SortingState) => {
    setSorting(newSorting)
  }, [])

  const handleColumnFilterChange = useCallback((columnId: string, val: ColumnFilterStateValue | string | null) => {
    setColumnFilters((prev) => {
      const next = { ...prev }
      // Keep the key and store null when a filter is cleared. Deleting it made the column
      // look "never filtered", which is indistinguishable from a fresh table — the date
      // column was then reseeded with today and the X appeared to do nothing.
      if (!val) {
        next[columnId] = null as any
      } else if (typeof val === 'string') {
        next[columnId] = val.trim() ? val : (null as any)
      } else {
        const hasContent =
          Boolean(val.value) ||
          Boolean(val.value2) ||
          (val.selectedOptions && val.selectedOptions.length > 0)
        next[columnId] = hasContent ? val : (null as any)
      }
      return next
    })
    setPageIndex(0) // Reset to first page
  }, [])

  const fetchInvoices = useCallback(async () => {
    if (activeAbortController.current) {
      activeAbortController.current.abort()
    }
    const ac = new AbortController()
    activeAbortController.current = ac

    setLoading(true)
    setError(null)

    try {
      const token = localStorage.getItem('accessToken')
      const headers: Record<string, string> = {}
      if (token) headers.Authorization = `Bearer ${token}`

      const hasColumnTarih = Boolean(columnFilters.tarih)
      const isTarihCleared = columnFilters.tarih === null
      // Build TableQueryParams
      const queryParams: TableQueryParams = {
        page: pageIndex + 1, // 1-indexed for backend API
        pageSize,
        query: globalFilter ? globalFilter.trim() : undefined,
        fromDate: !isTarihCleared && !hasColumnTarih && fromDate ? fromDate : undefined,
        toDate: !isTarihCleared && !hasColumnTarih && toDate ? toDate : undefined,
        filters: {}
      }

      if (sorting.length > 0) {
        queryParams.sortBy = sorting[0].id
        queryParams.sortDir = sorting[0].desc ? 'desc' : 'asc'
      }

      // Process column filters
      Object.entries(columnFilters).forEach(([colId, val]) => {
        if (!val) return

        if (typeof val === 'string') {
          if (val.trim()) {
            // `faturaAcik` LISTE olarak gider: uc yalnizca `faturaAcikIn` parametresini
            // taniyor, `Op`/`V1` gonderildiginde suzgeci sessizce yok sayiyordu.
            const defaultOp = colId === 'islemTipi' || colId === 'faturaAcik' ? 'in' : colId === 'odemeDurumu' ? 'eq' : 'contains'
            queryParams.filters![colId] = { op: defaultOp, v1: val.trim() }
          }
          return
        }

        if (val.selectedOptions && val.selectedOptions.length > 0) {
          queryParams.filters![colId] = { op: 'in', v1: val.selectedOptions.join(',') }
          return
        }

        const filterValue = (val.value ?? '').trim()
        const filterValue2 = (val.value2 ?? '').trim()
        const filterOp = val.operator ?? (colId === 'tarih' ? 'between' : 'contains')

        if (!filterValue) return

        if (colId === 'tarih') {
          const v1Parsed = parseTurkishDateToYyyyMmDd(filterValue)
          const v2Parsed = parseTurkishDateToYyyyMmDd(filterValue2 || filterValue)
          if (filterOp === 'between') {
            queryParams.filters!.tarih = { op: 'between', v1: v1Parsed, v2: v2Parsed }
          } else {
            queryParams.filters!.tarih = { op: filterOp, v1: v1Parsed }
          }
        } else if (colId === 'faturaAcik' || colId === 'islemTipi') {
          /**
           * BU IKI KOLONUN UCTA YALNIZCA `...In` KARSILIGI VAR.
           *
           * `Op`/`V1` gonderildiginde uc o parametreleri hic baglamiyor ve suzgec sessizce
           * yok sayiliyordu — Islem Tipi ve Fatura Tipi secim kutulari bu yuzden hicbir
           * sey yapmiyordu. Secim kutusu zaten "sunlardan biri" demek; `in` dogru operator.
           */
          queryParams.filters![colId] = { op: 'in', v1: filterValue }
        } else if (colId === 'odemeDurumu') {
          queryParams.filters!.odemeAlindi = { op: filterOp, v1: filterValue }
        } else {
          if (filterOp === 'between') {
            queryParams.filters![colId] = { op: 'between', v1: filterValue, v2: filterValue2 || filterValue }
          } else {
            queryParams.filters![colId] = { op: filterOp, v1: filterValue }
          }
        }
      })

      const qs = convertToUrlQueryString(queryParams)
      const res = await fetch(`${API_BASE_URL}/api/invoices/list?${qs}`, {
        headers,
        signal: ac.signal
      })

      if (!res.ok) {
        const text = await res.text()
        throw new Error(text || 'Fatura listesi alınamadı')
      }

      const json = await res.json()
      const respData = json?.data
      const rawItems: any[] = Array.isArray(respData)
        ? respData
        : Array.isArray(respData?.items)
          ? respData.items
          : []

      const items: InvoiceListItem[] = rawItems.map((x) => {
        const dt = x?.tarih
        let tarih = String(dt ?? '')
        const d = new Date(tarih)
        if (!Number.isNaN(d.getTime())) {
          tarih = d.toLocaleDateString('tr-TR')
        }

        const sdt = x?.saat
        let saat = ''
        const sd = new Date(sdt)
        if (!Number.isNaN(sd.getTime())) {
          saat = sd.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
        }

        return {
          id: String(x?.id ?? ''),
          islemTipi: String(x?.islemTipi ?? ''),
          tarih,
          tarihRaw: String(dt ?? ''),
          saat,
          faturaNo: String(x?.faturaNo ?? ''),
          sourceCustomerOfferId: (x as any)?.sourceCustomerOfferId ?? null,
          cariAdi: String(x?.cariAdi ?? ''),
          cariKodu: String(x?.cariKodu ?? ''),
          faturaAcik: String(x?.faturaAcik ?? ''),
          brutTutar: Number(x?.brutTutar ?? 0),
          iskonto: Number(x?.iskonto ?? 0),
          kampanyaIndirimi: Number((x as any)?.kampanyaIndirimi ?? 0),
          netTutar: Number(x?.netTutar ?? 0),
          kdvTutari: Number(x?.kdvTutari ?? 0),
          genelToplam: Number(x?.genelToplam ?? 0),
          paraBirimiTipi: Number((x as any)?.paraBirimiTipi ?? 0),
          kur: Number((x as any)?.kur ?? 0),
          cikisDeposu: (x as any)?.cikisDeposu ? String((x as any).cikisDeposu) : null,
          plasiyer: String(x?.plasiyer ?? ''),
          islemYapan: String(x?.islemYapan ?? ''),
          createUser: String(x?.createUser ?? x?.islemYapan ?? ''),
          odemeAlindi: Boolean((x as any)?.odemeAlindi),
          odemeHedefi: (x as any)?.odemeHedefi ? String((x as any).odemeHedefi) : null,
          odemeKasaId: (x as any)?.odemeKasaId ?? null,
          odemeBankaId: (x as any)?.odemeBankaId ?? null
        }
      })

      let filteredItems = items
      if (columnFilters.odemeDurumu) {
        const rawVal = columnFilters.odemeDurumu
        let searchTerms: string[] = []
        if (typeof rawVal === 'string') {
          searchTerms = [rawVal]
        } else if (typeof rawVal === 'object') {
          if (rawVal.selectedOptions && rawVal.selectedOptions.length > 0) {
            searchTerms = rawVal.selectedOptions
          } else if (rawVal.value) {
            searchTerms = [rawVal.value]
          }
        }

        if (searchTerms.length > 0) {
          filteredItems = items.filter((x) => {
            const isPaid = x.odemeAlindi === true
            const label = isPaid ? 'ödendi' : 'ödenmedi'

            return searchTerms.some((term) => {
              const t = term.trim().toLowerCase()
              if (!t) return true
              if (t === 'true' || t === '1' || t === 'evet' || t === 'paid') return isPaid
              if (t === 'false' || t === '0' || t === 'hayır' || t === 'unpaid') return !isPaid

              if (t === 'ödenmedi' || t === 'ödenmed' || t === 'ödenme' || t === 'ödenm') {
                return !isPaid
              }
              if (t === 'ödendi' || t === 'öden') {
                return isPaid
              }
              return label.includes(t)
            })
          })
        }
      }

      const totalRaw = Number((respData as any)?.total ?? (respData as any)?.count ?? rawItems.length)
      const nextTotal = Number.isFinite(totalRaw) ? totalRaw : filteredItems.length

      setData(filteredItems)
      setTotalCount(nextTotal)
    } catch (err: any) {
      if (err.name === 'AbortError') return
      setError(err?.message || 'Fatura listesi alınamadı')
    } finally {
      if (activeAbortController.current === ac) {
        setLoading(false)
      }
    }
  }, [pageIndex, pageSize, globalFilter, fromDate, toDate, sorting, columnFilters])

  useEffect(() => {
    void fetchInvoices()
  }, [fetchInvoices, refreshKey])

  return {
    data,
    totalCount,
    loading,
    error,
    pageIndex,
    pageSize,
    sorting,
    globalFilter,
    columnFilters,
    handlePageChange,
    handlePageSizeChange,
    handleGlobalFilterChange,
    handleSortingChange,
    handleColumnFilterChange,
    refetch: fetchInvoices
  }
}
