import React, { useEffect, useMemo, useState } from 'react'
import { fetchAllPages } from '../lib/fetchAllPages'
import { normalizeDiscountType } from '../utils/discountType'
import { ChevronDown, ChevronRight, Eye, ListFilter, Printer, Trash2 } from 'lucide-react'
import { useOutletContext } from 'react-router-dom'
import FormInput from '../components/forms/FormInput'
import Modal from '../components/Modal'
import PageHeader from '../components/PageHeader'
import { AppDataTable, type DataTableRowAction } from '../components/data-table'
import type { ColumnDef } from '@tanstack/react-table'
import { deleteProformaFromOffer, fetchProformaOffers, updateProformaHeader, type CustomerOfferListItemDto } from '../api/customerOffers'
import {
  deleteCariProformaFromOffer,
  fetchCariProformaOffers,
  updateCariProformaHeader,
  type CariOfferListItemDto
} from '../api/cariOffers'
import { fetchCustomersDropdown, type CustomerDto } from '../api/customers'
import { printProforma } from '../utils/proformaPrint'
import { fetchLatestFxRate } from '../api/fx'

function getCurrencySymbol(code: any) {
  const c = String(code ?? '').trim()
  if (c === '0' || c === '1' || c === 'TRY' || c === 'TL' || !c) return '₺'
  if (c === '3' || c === 'USD') return '$'
  if (c === '2' || c === 'EUR') return '€'
  if (c === '4' || c === 'GBP') return '£'
  return c
}

function formatMoneyWithCurrency(n: number, code: any) {
  const v = Number(n ?? 0)
  const sym = getCurrencySymbol(code)
  return `${sym}${v.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function getInvoiceCurrency(lines: any[]) {
  const arr = Array.isArray(lines) ? lines : []
  if (arr.length === 0) return '0'
  const currencies = new Set<string>()
  for (const l of arr) {
    const cur = String(l.currencyCode ?? l.CurrencyCode ?? '0')
    currencies.add(cur)
  }
  if (currencies.size === 1) {
    return Array.from(currencies)[0]
  }
  if (currencies.has('0') || currencies.has('TRY') || currencies.has('TL')) {
    return '0'
  }
  const firstLineCur = String(arr[0]?.currencyCode ?? arr[0]?.CurrencyCode ?? '0')
  return firstLineCur
}

function calcInvoiceTotalsWithConversion(lines: any[], vatExempt: boolean, targetCurrency: string, fxRates: Record<string, number>) {
  let subTotal = 0
  let discountTotal = 0
  let netTotal = 0
  let vatTotal = 0

  const targetRate = fxRates[targetCurrency] || 1

  const arr = Array.isArray(lines) ? lines : []
  for (const l of arr) {
    const qty = Number(l.quantity ?? 0)
    const originalPrice = Number(l.unitPrice ?? 0)
    const lineCurrency = String(l.currencyCode ?? l.CurrencyCode ?? '0')

    const sourceRate = fxRates[lineCurrency] || 1
    const tryPrice = originalPrice * sourceRate
    const price = targetRate > 0 ? tryPrice / targetRate : 0

    const base = qty * price

    const dv = Number((l as any).discountValue ?? 0)
    let discount = 0
    if (normalizeDiscountType((l as any).discountType) === 'amount') {
      const tryDiscountValue = dv * sourceRate
      const targetDiscountValue = targetRate > 0 ? tryDiscountValue / targetRate : 0
      discount = Math.max(0, targetDiscountValue)
    }
    if (normalizeDiscountType((l as any).discountType) === 'percentage') {
      discount = Math.max(0, (base * dv) / 100)
    }
    discount = Math.min(discount, base)

    const net = base - discount
    const vatRate = Math.max(0, Number(l.vatRate ?? 0))
    const vatAmount = vatExempt ? 0 : (net * vatRate) / 100

    subTotal += base
    discountTotal += discount
    netTotal += net
    vatTotal += vatAmount
  }

  const grandTotal = vatExempt ? netTotal : netTotal + vatTotal

  return { subTotal, discountTotal, netTotal, vatTotal, grandTotal }
}

type LayoutContext = {
  isSuperAdmin?: boolean
  roleCode?: string
  allowedKeys?: Set<string>
}

type ProformaSource = 'customer' | 'cari'

type ProformaRow = {
  id: number
  source: ProformaSource
  date: string
  documentNo: string
  customerCode?: string
  customerName: string
  description: string
  invoiceId?: number | null
  invoiceNo?: string | null
  vatExempt: boolean
  subtotal: number
  discountTotal: number
  netTotal: number
  vatTotal: number
  grandTotal: number
  createUser: string
  currencyCode?: string
  lines: Array<{
    id: number
    stockCode: string
    stockName: string
    quantity: number
    unitPrice: number
    vatRate: number
    currencyCode?: any
  }>
}

type ColumnKey = 'date' | 'documentNo' | 'customerName' | 'description' | 'vatExempt' | 'createUser'

function formatMoney(n: number) {
  const v = Number(n ?? 0)
  return `₺${v.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export default function BayiTeklifleriPage() {
  const { isSuperAdmin, allowedKeys, roleCode } = useOutletContext<LayoutContext>()

  const canView =
    Boolean(isSuperAdmin) ||
    Boolean(allowedKeys?.has('invoice/bayiTeklifleriGoruntule')) ||
    Boolean(allowedKeys?.has('invoice/bayiTeklifleriBasim')) ||
    Boolean(allowedKeys?.has('invoice/proformaBasim')) ||
    Boolean(allowedKeys?.has('invoice/bayiTeklifleri'))

  const canPrint =
    Boolean(isSuperAdmin) ||
    Boolean(allowedKeys?.has('invoice/bayiTeklifleriBasim')) ||
    Boolean(allowedKeys?.has('invoice/proformaBasim')) ||
    Boolean(allowedKeys?.has('invoice/bayiTeklifleri'))

  const canDelete =
    Boolean(isSuperAdmin) ||
    Boolean(allowedKeys?.has('invoice/bayiTeklifleriSil')) ||
    Boolean(allowedKeys?.has('invoice/proformaSil'))

  const isBayi = String(roleCode ?? '').trim().toUpperCase() === 'BAYI'

  const isAbortError = (e: any) => {
    const name = String(e?.name ?? '')
    const msg = String(e?.message ?? '')
    if (name === 'AbortError') return true
    if (msg.toLowerCase().includes('aborted')) return true
    return false
  }

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rows, setRows] = useState<ProformaRow[]>([])
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null)

  const [msgModalOpen, setMsgModalOpen] = useState(false)
  const [msgModalTitle, setMsgModalTitle] = useState('')
  const [msgModalText, setMsgModalText] = useState('')

  const showMessage = (title: string, text: string) => {
    setMsgModalTitle(title)
    setMsgModalText(text)
    setMsgModalOpen(true)
  }

  const [actionsOpenForId, setActionsOpenForId] = useState<string | null>(null)

  const [fxRates, setFxRates] = useState<Record<string, number>>({
    'TRY': 1,
    'TL': 1,
    '0': 1,
    'USD': 1,
    '3': 1,
    'EUR': 1,
    '2': 1,
    'GBP': 1,
    '4': 1
  })

  useEffect(() => {
    void (async () => {
      try {
        const [usd, eur, gbp] = await Promise.all([
          fetchLatestFxRate('USD').catch(() => 1),
          fetchLatestFxRate('EUR').catch(() => 1),
          fetchLatestFxRate('GBP').catch(() => 1)
        ])
        setFxRates((prev) => ({
          ...prev,
          'USD': usd,
          '3': usd,
          'EUR': eur,
          '2': eur,
          'GBP': gbp,
          '4': gbp
        }))
      } catch {
        // Fallback to 1
      }
    })()
  }, [])

  const [customersLoading, setCustomersLoading] = useState(false)
  const [customers, setCustomers] = useState<CustomerDto[]>([])

  const [globalSearch, setGlobalSearch] = useState('')
  const [activeFilterKey, setActiveFilterKey] = useState<string | null>(null)
  const [selectedValues, setSelectedValues] = useState<Record<string, string[]>>({})
  const [draftValues, setDraftValues] = useState<Record<string, string[]>>({})
  const filterPanelRef = React.useRef<HTMLDivElement | null>(null)

  const [filterOps, setFilterOps] = useState<Record<ColumnKey, string>>({
    date: 'eq',
    documentNo: 'contains',
    customerName: 'contains',
    description: 'contains',
    vatExempt: 'eq',
    createUser: 'contains'
  })
  const [filters, setFilters] = useState<Record<ColumnKey, { v1: string; v2: string }>>({
    date: { v1: '', v2: '' },
    documentNo: { v1: '', v2: '' },
    customerName: { v1: '', v2: '' },
    description: { v1: '', v2: '' },
    vatExempt: { v1: '', v2: '' },
    createUser: { v1: '', v2: '' }
  })

  const setFilterV1 = (key: ColumnKey, v: string) => {
    setFilters((p) => ({ ...p, [key]: { v1: v, v2: p[key]?.v2 ?? '' } }))
  }

  const setFilterV2 = (key: ColumnKey, v: string) => {
    setFilters((p) => ({ ...p, [key]: { v1: p[key]?.v1 ?? '', v2: v } }))
  }

  useEffect(() => {
    const ac = new AbortController()
    void (async () => {
      try {
        setCustomersLoading(true)
        const list = await fetchCustomersDropdown({ includeInactive: false, includeMuhtelif: false, forOrder: true, signal: ac.signal })
        setCustomers(list ?? [])
      } catch {
        setCustomers([])
      } finally {
        setCustomersLoading(false)
      }
    })()
    return () => ac.abort()
  }, [])

  const toggleExpand = (id: number) => {
    const k = String(id)
    setExpanded((p) => ({ ...p, [k]: !p[k] }))
  }

  const mapCariRow = (x: CariOfferListItemDto): ProformaRow => {
    const yyyyMmDd = String((x as any).date ?? '').slice(0, 10)
    const proformaCurrency = (() => {
      const cid = Number((x as any).currencyTypeId ?? (x as any).CurrencyTypeId ?? 0)
      return cid === 2 ? 'EUR' : cid === 3 ? 'USD' : cid === 4 ? 'GBP' : 'TRY'
    })()
    return {
      id: Number((x as any).id),
      source: 'cari',
      date: yyyyMmDd,
      documentNo: String((x as any).documentNo ?? ''),
      customerCode: String((x as any).customerCode ?? '').trim() || undefined,
      customerName: String((x as any).customerName ?? ''),
      description: String((x as any).description ?? ''),
      invoiceId: (x as any)?.invoiceId ?? null,
      invoiceNo: (x as any)?.invoiceNo ?? null,
      vatExempt: Boolean((x as any).vatExempt),
      subtotal: Number((x as any).subtotal ?? 0),
      discountTotal: Number((x as any).discountTotal ?? 0),
      netTotal: Number((x as any).netTotal ?? 0),
      vatTotal: Number((x as any).vatTotal ?? 0),
      grandTotal: Number((x as any).grandTotal ?? 0),
      createUser: String((x as any).createUser ?? ''),
      currencyCode: proformaCurrency,
      lines: (((x as any).lines ?? []) as any[]).map((l: any) => {
        const lineCid = Number(l.currencyCode ?? l.CurrencyCode ?? (x as any).currencyTypeId ?? 0)
        const lineCur = lineCid === 2 ? 'EUR' : lineCid === 3 ? 'USD' : lineCid === 4 ? 'GBP' : (proformaCurrency || 'TRY')
        return {
          id: Number(l.id),
          stockCode: String(l.stockCode ?? ''),
          stockName: String((l as any).stockName ?? l.description ?? ''),
          quantity: Number(l.quantity ?? 0),
          unitPrice: Number(l.unitPrice ?? 0),
          vatRate: Number(l.vatRate ?? 0),
          currencyCode: lineCur
        }
      })
    }
  }

  const deleteProforma = async (id: number) => {
    const safeId = Number(id)
    if (!Number.isFinite(safeId) || safeId <= 0) {
      setError('Geçersiz id')
      return
    }

    try {
      setLoading(true)
      setError(null)
      await deleteCariProformaFromOffer(safeId)
      await load()
    } catch (e: any) {
      if (isAbortError(e)) return
      setError(String(e?.message ?? 'Proforma silinemedi'))
      showMessage('Hata', String(e?.message ?? 'Proforma silinemedi'))
    } finally {
      setLoading(false)
    }
  }

  const load = async (signal?: AbortSignal) => {
    try {
      setLoading(true)
      setError(null)
      // Bütün kayıtlar sayfa sayfa (2026-10-08): eskiden yalnız son 200 geliyordu, eski kayıtlar
      // aramada/süzgeçte görünmüyordu. İlk sayfa hemen ekrana basılır, kalanlar arkadan eklenir.
      await fetchAllPages((skip, take) => fetchCariProformaOffers({ take, skip, signal }), {
        key: (x) => String(x.id),
        onPage: (all, first) => {
          setRows(all.map(mapCariRow))
          if (first) setLoading(false)
        }
      })
    } catch (e: any) {
      if (isAbortError(e)) return
      setError(String(e?.message ?? 'Cari proformalar alınamadı'))
      setRows([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const ac = new AbortController()
    void load(ac.signal)
    return () => ac.abort()
  }, [])

  const columnOptions = useMemo(() => {
    const out: Record<string, string[]> = {}
    const cols = ['date', 'documentNo', 'customerName', 'description', 'createUser']
    for (const key of cols) {
      const values = new Set<string>()
      for (const row of rows) {
        values.add(String((row as any)[key] ?? '').trim())
      }
      out[key] = Array.from(values).filter((v) => v.length > 0).sort((a, b) => a.localeCompare(b))
    }
    return out
  }, [rows])

  useEffect(() => {
    if (!activeFilterKey) return
    const handleClick = (event: MouseEvent) => {
      if (!filterPanelRef.current) return
      if (!filterPanelRef.current.contains(event.target as Node)) {
        setActiveFilterKey(null)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [activeFilterKey])

  const normalizeDateValue = (value: string) => {
    const raw = String(value ?? '').trim()
    if (!raw) return ''
    const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/)
    if (iso) return `${iso[1]}${iso[2]}${iso[3]}`
    const dotted = raw.match(/^(\d{2})\.(\d{2})\.(\d{4})$/)
    if (dotted) return `${dotted[3]}${dotted[2]}${dotted[1]}`
    return raw
  }

  const filteredRows = useMemo(() => {
    const matchText = (cell: string, op: string, v1: string, v2: string) => {
      const c = cell.toLowerCase()
      const a = v1.toLowerCase()
      const b = v2.toLowerCase()
      if (!a && !(op === 'between' && b)) return true

      if (op === 'contains') return c.includes(a)
      if (op === 'not_contains') return !c.includes(a)
      if (op === 'starts_with') return c.startsWith(a)
      if (op === 'ends_with') return c.endsWith(a)
      if (op === 'eq') return c === a
      if (op === 'neq') return c !== a
      if (op === 'between') return c >= a && c <= b
      return c.includes(a)
    }

    const matchComparable = (cellValue: string, op: string, v1: string, v2: string) => {
      const c = cellValue
      const a = v1
      const b = v2
      if (!a && !(op === 'between' && b)) return true

      if (op === 'eq') return c === a
      if (op === 'neq') return c !== a
      if (op === 'lt') return c < a
      if (op === 'gt') return c > a
      if (op === 'lte') return c <= a
      if (op === 'gte') return c >= a
      if (op === 'between') {
        const left = a
        const right = b
        if (!left || !right) return Boolean(left ? c >= left : true) && Boolean(right ? c <= right : true)
        return c >= left && c <= right
      }
      return c.includes(a)
    }

    const activeFilters = (['date', 'documentNo', 'customerName', 'description', 'vatExempt', 'createUser'] as ColumnKey[])
      .map((k) => {
        const fv = filters[k] ?? { v1: '', v2: '' }
        const v1 = String(fv.v1 ?? '').trim()
        const v2 = String(fv.v2 ?? '').trim()
        const op = String(filterOps[k] ?? (k === 'date' ? 'eq' : 'contains'))
        return { key: k, v1, v2, op }
      })
      .filter((x) => x.v1.length > 0 || (x.op === 'between' && x.v2.length > 0))

    const byText =
      activeFilters.length === 0
        ? rows
        : rows.filter((r) => {
            for (const f of activeFilters) {
              const raw = (r as any)[f.key]
              if (f.key === 'date') {
                const normalizedCell = normalizeDateValue(String(raw ?? ''))
                const normalizedV1 = normalizeDateValue(f.v1)
                const normalizedV2 = normalizeDateValue(f.v2)
                const ok = matchComparable(normalizedCell, f.op, normalizedV1, normalizedV2)
                if (!ok) return false
                continue
              }

              if (f.key === 'vatExempt') {
                const cell = (r as any).vatExempt ? 'evet' : 'hayır'
                const ok = matchText(cell, f.op, f.v1, f.v2)
                if (!ok) return false
                continue
              }

              const cell = String(raw ?? '')
              const ok = matchText(cell, f.op, f.v1, f.v2)
              if (!ok) return false
            }
            return true
          })

    const gs = String(globalSearch ?? '').trim().toLowerCase()
    const byGlobal = byText.filter((row) => {
      if (!gs) return true
      const blob = [row.date, row.documentNo, row.customerName, row.description, row.createUser]
        .map((x) => String(x ?? '').toLowerCase())
        .join(' ')
      return blob.includes(gs)
    })

    const active = Object.entries(selectedValues).filter(([, v]) => (v ?? []).length > 0)
    if (active.length === 0) return byGlobal

    return byGlobal.filter((r) => {
      for (const [k, list] of active) {
        const cell = String((r as any)[k] ?? '').toLowerCase()
        if (!list.map((v) => v.toLowerCase()).includes(cell)) return false
      }
      return true
    })
  }, [filterOps, filters, globalSearch, rows, selectedValues])

  const renderFilterPanel = (key: string, label: string) => (
    <div
      ref={filterPanelRef}
      className="absolute left-0 top-full mt-2 w-64 bg-white border border-gray-200 rounded-lg shadow-lg z-50"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="px-3 py-2 border-b border-gray-200 text-xs font-semibold text-gray-600">{label}</div>

      <div className="max-h-56 overflow-auto px-3 py-2 text-xs">
        {columnOptions[key]?.length ? (
          <label className="flex items-center gap-2 py-1">
            <input
              type="checkbox"
              checked={(draftValues[key] ?? []).length === columnOptions[key].length}
              onChange={(e) => {
                const allValues = columnOptions[key] ?? []
                setDraftValues((p) => ({ ...p, [key]: e.target.checked ? allValues : [] }))
              }}
            />
            Tümünü seç
          </label>
        ) : null}

        {columnOptions[key]?.length ? (
          columnOptions[key].map((opt) => (
            <label key={opt} className="flex items-center gap-2 py-1">
              <input
                type="checkbox"
                checked={(draftValues[key] ?? []).includes(opt)}
                onChange={(e) => {
                  const current = new Set(draftValues[key] ?? [])
                  if (e.target.checked) current.add(opt)
                  else current.delete(opt)
                  setDraftValues((p) => ({ ...p, [key]: Array.from(current) }))
                }}
              />
              {opt || '(Boş)'}
            </label>
          ))
        ) : (
          <div className="text-gray-400 py-4">Gösterilecek bilgi yok</div>
        )}
      </div>

      <div className="flex items-center justify-end gap-2 px-3 py-2 border-t border-gray-200">
        <button type="button" className="text-xs font-semibold text-blue-600 hover:text-blue-700" onClick={() => setActiveFilterKey(null)}>
          İPTAL
        </button>
        <button
          type="button"
          className="text-xs font-semibold text-blue-600 hover:text-blue-700"
          onClick={() => {
            setSelectedValues((p) => ({ ...p, [key]: draftValues[key] ?? [] }))
            setActiveFilterKey(null)
          }}
        >
          TAMAM
        </button>
      </div>
    </div>
  )

  const renderHeaderCell = (label: string, key: string, alignClass = 'text-left') => (
    <th className={`px-2 py-1 text-left text-[10px] font-semibold text-gray-600 uppercase tracking-wide border border-gray-300 relative ${alignClass}`}>
      <div className="flex items-center gap-1">
        {label}
        <button
          type="button"
          className="ml-1 inline-flex items-center justify-center w-5 h-5 rounded hover:bg-gray-200 text-gray-500"
          title="Filtrele"
          onClick={(e) => {
            e.stopPropagation()
            setActiveFilterKey((prev) => (prev === key ? null : key))
            setDraftValues((p) => ({ ...p, [key]: selectedValues[key] ?? [] }))
          }}
        >
          <ListFilter size={12} />
        </button>
      </div>
      {activeFilterKey === key && renderFilterPanel(key, label)}
    </th>
  )

  const [pageIndex, setPageIndex] = useState(0)
  const [pageSize, setPageSize] = useState(20)
  const [columnFiltersState, setColumnFiltersState] = useState<Record<string, any>>({})

  const bayiColumns = useMemo<ColumnDef<ProformaRow, any>[]>(
    () => [
      {
        accessorKey: 'date',
        header: 'Tarih',
        meta: { filterType: 'date', filterPlaceholder: 'Tarih...' }
      },
      {
        accessorKey: 'documentNo',
        header: 'Belge No',
        meta: { filterType: 'text', filterPlaceholder: 'Belge No...' }
      },
      {
        accessorKey: 'customerName',
        header: 'Cari Adı',
        meta: { filterType: 'text', filterPlaceholder: 'Cari Adı...' }
      },
      {
        accessorKey: 'description',
        header: 'Açıklama',
        meta: { filterType: 'text', filterPlaceholder: 'Açıklama...' }
      },
      {
        accessorKey: 'vatExempt',
        header: 'KDV İstisna',
        meta: { filterType: 'select', filterOptions: [{ value: 'true', label: 'EVET' }, { value: 'false', label: 'HAYIR' }] },
        cell: ({ getValue }) => (getValue() ? 'EVET' : 'HAYIR')
      },
      {
        id: 'currency',
        accessorFn: (row: any) => {
          const rowCurrency = row.currencyCode || getInvoiceCurrency(row.lines)
          return rowCurrency === 'USD' ? 'USD' : rowCurrency === 'EUR' ? 'EUR' : rowCurrency === 'GBP' ? 'GBP' : 'TRY'
        },
        header: 'Döviz',
        meta: { filterType: 'text' },
        cell: ({ getValue }) => {
          return <span className="font-semibold text-blue-700">{getValue()}</span>
        }
      },
      {
        id: 'subTotal',
        accessorFn: (row) => {
          const rowCurrency = (row as any).currencyCode || getInvoiceCurrency(row.lines)
          return calcInvoiceTotalsWithConversion(row.lines, row.vatExempt, rowCurrency, fxRates).subTotal
        },
        header: 'Ara Toplam',
        meta: { filterType: 'number', showTotal: true },
        cell: ({ row, getValue }) => {
          const rowCurrency = (row.original as any).currencyCode || getInvoiceCurrency(row.original.lines)
          return <div className="text-right font-medium text-slate-700">{formatMoneyWithCurrency(getValue(), rowCurrency)}</div>
        }
      },
      {
        id: 'discountTotal',
        accessorFn: (row) => {
          const rowCurrency = (row as any).currencyCode || getInvoiceCurrency(row.lines)
          return calcInvoiceTotalsWithConversion(row.lines, row.vatExempt, rowCurrency, fxRates).discountTotal
        },
        header: 'İndirim',
        meta: { filterType: 'number', showTotal: true },
        cell: ({ row, getValue }) => {
          const rowCurrency = (row.original as any).currencyCode || getInvoiceCurrency(row.original.lines)
          return <div className="text-right font-medium text-slate-700">{formatMoneyWithCurrency(getValue(), rowCurrency)}</div>
        }
      },
      {
        id: 'netTotal',
        accessorFn: (row) => {
          const rowCurrency = (row as any).currencyCode || getInvoiceCurrency(row.lines)
          return calcInvoiceTotalsWithConversion(row.lines, row.vatExempt, rowCurrency, fxRates).netTotal
        },
        header: 'Net Toplam',
        meta: { filterType: 'number', showTotal: true },
        cell: ({ row, getValue }) => {
          const rowCurrency = (row.original as any).currencyCode || getInvoiceCurrency(row.original.lines)
          return <div className="text-right font-semibold text-slate-800">{formatMoneyWithCurrency(getValue(), rowCurrency)}</div>
        }
      },
      {
        id: 'vatTotal',
        accessorFn: (row) => {
          const rowCurrency = (row as any).currencyCode || getInvoiceCurrency(row.lines)
          return calcInvoiceTotalsWithConversion(row.lines, row.vatExempt, rowCurrency, fxRates).vatTotal
        },
        header: 'KDV Toplam',
        meta: { filterType: 'number', showTotal: true },
        cell: ({ row, getValue }) => {
          const rowCurrency = (row.original as any).currencyCode || getInvoiceCurrency(row.original.lines)
          return <div className="text-right font-medium text-slate-700">{formatMoneyWithCurrency(getValue(), rowCurrency)}</div>
        }
      },
      {
        id: 'grandTotal',
        accessorFn: (row) => {
          const rowCurrency = (row as any).currencyCode || getInvoiceCurrency(row.lines)
          return calcInvoiceTotalsWithConversion(row.lines, row.vatExempt, rowCurrency, fxRates).grandTotal
        },
        header: 'Genel Toplam',
        meta: { filterType: 'number', showTotal: true },
        cell: ({ row, getValue }) => {
          const rowCurrency = (row.original as any).currencyCode || getInvoiceCurrency(row.original.lines)
          return <div className="text-right font-bold text-slate-900">{formatMoneyWithCurrency(getValue(), rowCurrency)}</div>
        }
      },
      {
        accessorKey: 'createUser',
        header: 'İşlemi Yapan',
        meta: { filterType: 'text', filterPlaceholder: 'İşlemi Yapan...' }
      }
    ],
    [fxRates]
  )

  const getRowActions = (row: ProformaRow): DataTableRowAction<ProformaRow>[] => {
    const actions: DataTableRowAction<ProformaRow>[] = []
    const isTransferredToInvoice = Boolean((row as any).invoiceId || (row as any).invoiceNo)
    if (canPrint) {
      actions.push({
        label: 'Yazdır',
        icon: <Printer size={14} />,
        onClick: async (r) => {
          try {
            await printProforma(r.id, r.source, false)
          } catch (err: any) {
            showMessage('Hata', err?.message || 'Yazdırma işlemi başarısız')
          }
        }
      })
    }
    if (canDelete) {
      actions.push({
        label: 'Sil',
        icon: <Trash2 size={14} />,
        variant: 'danger',
        disabled: isTransferredToInvoice,
        onClick: (r) => {
          if (!isTransferredToInvoice) setDeleteConfirmId(r.id)
        }
      })
    }
    return actions
  }

  const renderExpandedRowContent = (row: ProformaRow) => {
    return (
      <div className="border border-slate-200 rounded-lg overflow-hidden bg-white shadow-sm p-3">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-slate-100 text-slate-700 font-semibold border-b border-slate-200">
              <th className="px-3 py-2 text-left">Stok Kodu</th>
              <th className="px-3 py-2 text-left">Stok Adı</th>
              <th className="px-3 py-2 text-center">Döviz Tipi</th>
              <th className="px-3 py-2 text-right">KDV %</th>
              <th className="px-3 py-2 text-right font-bold">Miktar</th>
              <th className="px-3 py-2 text-right">Fiyat</th>
              <th className="px-3 py-2 text-right font-bold">Toplam</th>
            </tr>
          </thead>
          <tbody>
            {row.lines.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-3 text-slate-500">Kalem bulunamadı.</td>
              </tr>
            ) : (
              row.lines.map((l) => {
                const qty = Number(l.quantity ?? 0)
                const unitPrice = Number(l.unitPrice ?? 0)
                const isForeign = String(l.currencyCode) !== '0' && String(l.currencyCode) !== 'TRY' && String(l.currencyCode) !== 'TL' && !!l.currencyCode
                const rate = fxRates[String(l.currencyCode)] || 1
                const tryUnitPrice = unitPrice * rate
                const tryTotal = (qty * unitPrice) * rate
                const currencyText = (() => {
                  const c = String(l.currencyCode ?? '').trim()
                  if (c === '3' || c === 'USD') return 'USD'
                  if (c === '2' || c === 'EUR') return 'EUR'
                  if (c === '4' || c === 'GBP') return 'GBP'
                  return 'TRY'
                })()
                return (
                  <tr key={String(l.id)} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-3 py-2 font-mono text-slate-800">{l.stockCode}</td>
                    <td className="px-3 py-2 text-slate-800">{l.stockName}</td>
                    <td className="px-3 py-2 text-center font-medium text-slate-600">{currencyText}</td>
                    <td className="px-3 py-2 text-right text-slate-700">{Number(l.vatRate ?? 0)}</td>
                    <td className="px-3 py-2 text-right font-semibold text-slate-800">{qty}</td>
                    <td className="px-3 py-2 text-right text-slate-700">
                      <div>{formatMoneyWithCurrency(unitPrice, l.currencyCode)}</div>
                    </td>
                    <td className="px-3 py-2 text-right font-bold text-slate-900">
                      <div>{formatMoneyWithCurrency(qty * unitPrice, l.currencyCode)}</div>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    )
  }

  return (
    <div className="p-4">
      <PageHeader
        title="Bayi Teklifleri"
        breadcrumb="Satış İşlemleri / Bayi Teklif Takibi"
        rightActions={
          <button
            type="button"
            onClick={() => void load()}
            className="h-[38px] inline-flex items-center gap-1.5 px-4 text-xs font-semibold uppercase tracking-wider bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white rounded-lg shadow-sm transition"
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              className={loading ? 'animate-spin' : ''}
            >
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
            </svg>
            {loading ? 'Yükleniyor...' : 'Yenile'}
          </button>
        }
      />

      {error && <div className="mb-3 text-xs font-semibold text-red-600">{error}</div>}

      <AppDataTable
        onRefresh={() => void load()}
        data={filteredRows}
        columns={bayiColumns}
        rowId={(row) => String(row.id)}
        rowClassName={(row) => ((row.invoiceId || row.invoiceNo) ? 'bg-amber-100/90 hover:bg-amber-200/90 font-medium text-amber-950 border-b border-amber-200' : '')}
        renderExpandedRow={renderExpandedRowContent}
        rowActions={getRowActions}
        states={{ loading, error: error ?? undefined }}
        filtering={{
          globalFilter: globalSearch,
          onGlobalFilterChange: setGlobalSearch,
          columnFilters: columnFiltersState,
          onColumnFilterChange: (colId, val) => setColumnFiltersState((p) => ({ ...p, [colId]: val }))
        }}
        pagination={{
          pageIndex,
          pageSize,
          totalCount: filteredRows.length,
          pageCount: Math.ceil(filteredRows.length / pageSize),
          onPageChange: setPageIndex,
          onPageSizeChange: setPageSize
        }}
      />

      <Modal
        isOpen={msgModalOpen}
        onClose={() => setMsgModalOpen(false)}
        title={msgModalTitle}
        footer={
          <button
            type="button"
            onClick={() => setMsgModalOpen(false)}
            className="h-[34px] px-4 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition"
          >
            Tamam
          </button>
        }
      >
        <div className="text-xs text-gray-700 whitespace-pre-line">{msgModalText}</div>
      </Modal>

      {deleteConfirmId !== null && (
        <Modal
          isOpen={deleteConfirmId !== null}
          onClose={() => setDeleteConfirmId(null)}
          title="Proforma Silme Onayı"
          footer={
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="h-[34px] px-4 text-xs font-semibold rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 transition"
                onClick={() => setDeleteConfirmId(null)}
              >
                Vazgeç
              </button>
              <button
                type="button"
                className="h-[34px] px-4 text-xs font-semibold rounded-lg bg-red-600 hover:bg-red-700 text-white shadow-sm transition"
                onClick={() => {
                  const idToDelete = deleteConfirmId
                  setDeleteConfirmId(null)
                  void deleteProforma(idToDelete)
                }}
              >
                Sil
              </button>
            </div>
          }
        >
          <div className="text-xs text-gray-700">
            Bu proformayı silmek istediğinize emin misiniz?
          </div>
        </Modal>
      )}
    </div>
  )
}
