import React from 'react'
import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, ListFilter, Trash2 } from 'lucide-react'
import Modal from '../components/Modal'
import { API_BASE_URL } from '../config/api'
import { AppDataTable, type DataTableRowAction } from '../components/data-table'
import type { ColumnDef } from '@tanstack/react-table'

function formatMoney(n: number) {
  const v = Number(n ?? 0)
  return `₺${v.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/**
 * Satırın kendi para birimindeki fiyatı. Tutarlar TL çapasıdır; dolarla satılan bir sipariş
 * raporda yalnız TL karşılığıyla görünürse TL siparişten ayırt edilemiyordu (2026-08-19).
 */
function currencyCodeOfRow(currencyTypeId: any): string {
  const c = Number(currencyTypeId ?? 1)
  return c === 2 ? 'EUR' : c === 3 ? 'USD' : c === 4 ? 'GBP' : 'TL'
}

function currencySymbolOfRow(currencyTypeId: any): string {
  const c = Number(currencyTypeId ?? 1)
  return c === 2 ? '€' : c === 3 ? '$' : c === 4 ? '£' : '₺'
}

/** Siparişin para birimi — uc `currencyTypeId` gönderiyor, eski yanıtta yoksa TL. */
function orderCurrencyTypeIdOf(row: any): number {
  const c = Number(row?.currencyTypeId ?? row?.CurrencyTypeId ?? 1)
  return c === 0 ? 1 : c
}

/** Belgenin KENDİ parasındaki tutar; sembol de o paranın. */
function formatOwnCurrency(n: number, currencyTypeId: any): string {
  const v = Number(n ?? 0)
  const sym = currencySymbolOfRow(currencyTypeId)
  return `${sym}${v.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}


export default function OrderReportPage() {

  const [globalSearch, setGlobalSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rows, setRows] = useState<any[]>([])
  const [totals, setTotals] = useState<any | null>(null)
  const [expanded, setExpanded] = useState<Record<number, boolean>>({})
  const [activeFilterKey, setActiveFilterKey] = useState<string | null>(null)
  const [selectedValues, setSelectedValues] = useState<Record<string, string[]>>({})
  const [draftValues, setDraftValues] = useState<Record<string, string[]>>({})
  const filterPanelRef = React.useRef<HTMLDivElement | null>(null)

  const [filterOps, setFilterOps] = useState<Record<string, string>>({})
  const [filters, setFilters] = useState<Record<string, { v1: string; v2: string }>>({})

  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteLineId, setDeleteLineId] = useState<number | null>(null)
  const [deleteMaxQty, setDeleteMaxQty] = useState<number>(0)
  const [deleteMode, setDeleteMode] = useState<'all' | 'partial'>('all')
  const [deleteQty, setDeleteQty] = useState<string>('')
  const [deleteSaving, setDeleteSaving] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const [msgOpen, setMsgOpen] = useState(false)
  const [msgTitle, setMsgTitle] = useState('')
  const [msgText, setMsgText] = useState('')

  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirmTitle, setConfirmTitle] = useState('')
  const [confirmText, setConfirmText] = useState('')
  const [confirmOrderId, setConfirmOrderId] = useState<number | null>(null)
  const [confirmBusy, setConfirmBusy] = useState(false)

  const showMessage = (title: string, text: string) => {
    setMsgTitle(String(title ?? ''))
    setMsgText(String(text ?? ''))
    setMsgOpen(true)
  }

  const formatDate = (v: any) => {
    const raw = v ?? ''
    const s = String(raw)
    const d = new Date(s)
    if (!Number.isNaN(d.getTime())) return d.toLocaleDateString('tr-TR')
    return s
  }

  const openDeleteModal = (salesOrderLineId: number, maxQty: number) => {
    setDeleteLineId(salesOrderLineId)
    setDeleteMaxQty(Number(maxQty ?? 0))
    setDeleteMode('all')
    setDeleteQty(String(Math.max(0, Math.floor(Number(maxQty ?? 0)))) || '')
    setDeleteError(null)
    setDeleteOpen(true)
  }

  const confirmDelete = async () => {
    if (!deleteLineId) return

    const maxQty = Number(deleteMaxQty ?? 0)
    let qtyParam: number | null = null
    if (deleteMode === 'partial') {
      const n = Number(String(deleteQty ?? '').replace(',', '.'))
      const v = Number.isFinite(n) ? n : 0
      if (v <= 0) {
        setDeleteError('Miktar 0\'dan büyük olmalıdır')
        return
      }
      if (v > maxQty) {
        setDeleteError('Silinecek miktar kalan miktardan büyük olamaz')
        return
      }
      qtyParam = v
    }

    try {
      setDeleteSaving(true)
      setDeleteError(null)
      const token = localStorage.getItem('accessToken')
      const headers: Record<string, string> = {}
      if (token) headers.Authorization = `Bearer ${token}`

      const url =
        qtyParam == null
          ? `${API_BASE_URL}/api/salesorders/lines/${encodeURIComponent(String(deleteLineId))}`
          : `${API_BASE_URL}/api/salesorders/lines/${encodeURIComponent(String(deleteLineId))}?quantity=${encodeURIComponent(String(qtyParam))}`

      const res = await fetch(url, { method: 'DELETE', headers })
      if (!res.ok) {
        const text = await readErrorText(res)
        setDeleteError(text || 'Kalem silinemedi')
        return
      }

      setDeleteOpen(false)
      await load({ background: true })
    } catch {
      setDeleteError('Kalem silinemedi')
    } finally {
      setDeleteSaving(false)
    }
  }

  const getRowId = (r: any) => {
    const v = r?.id ?? r?.Id ?? r?.salesOrderId ?? r?.SalesOrderId
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }

  const getLines = (r: any) => {
    const lines = (r?.lines ?? r?.Lines ?? []) as any[]
    return Array.isArray(lines) ? lines : []
  }

  const columnOptions = useMemo(() => {
    const out: Record<string, string[]> = {}
    const cols = ['processedAt', 'orderNo', 'customerName', 'deliveryCustomerName', 'customerInvoiceType', 'subtotal', 'discount', 'netTotal', 'vatTotal', 'grandTotal', 'plasiyer', 'processedBy']
    for (const key of cols) {
      const values = new Set<string>()
      for (const row of rows) {
        const raw = (row as any)[key] ?? (row as any)[key[0].toUpperCase() + key.slice(1)]
        values.add(String(raw ?? '').trim())
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

  const filteredRows = useMemo(() => {
    const normalizeDateValue = (value: string) => {
      const raw = String(value ?? '').trim()
      if (!raw) return ''
      const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/)
      if (iso) return `${iso[1]}${iso[2]}${iso[3]}`
      const dotted = raw.match(/^(\d{2})\.(\d{2})\.(\d{4})$/)
      if (dotted) return `${dotted[3]}${dotted[2]}${dotted[1]}`
      return raw
    }

    const activeTextFilters = ['processedAt', 'orderNo', 'customerName', 'deliveryCustomerName', 'customerInvoiceType', 'plasiyer', 'processedBy']
      .map((k) => {
        const fv = filters[k] ?? { v1: '', v2: '' }
        const v1 = String(fv.v1 ?? '').trim()
        const v2 = String(fv.v2 ?? '').trim()
        const op = String(filterOps[k] ?? (k === 'processedAt' ? 'eq' : 'contains'))
        return { key: k, v1, v2, op }
      })
      .filter((x) => x.v1.length > 0 || (x.op === 'between' && x.v2.length > 0))

    const byText =
      activeTextFilters.length === 0
        ? rows
        : rows.filter((r) => {
            for (const f of activeTextFilters) {
              const raw = (r as any)[f.key] ?? (r as any)[f.key[0].toUpperCase() + f.key.slice(1)]

              if (f.key === 'processedAt') {
                const cell = normalizeDateValue(String(raw ?? '').slice(0, 10))
                if (!cell) return false

                const q1 = normalizeDateValue(f.v1)
                const q2 = normalizeDateValue(f.v2)
                const cellNum = Number(cell)
                const q1Num = q1 ? Number(q1) : NaN
                const q2Num = q2 ? Number(q2) : NaN

                if (f.op === 'between') {
                  if (!q1 || !q2) return false
                  const a = Math.min(q1Num, q2Num)
                  const b = Math.max(q1Num, q2Num)
                  if (!(cellNum >= a && cellNum <= b)) return false
                  continue
                }

                if (!q1) return false
                if (f.op === 'eq' && cellNum !== q1Num) return false
                if (f.op === 'neq' && cellNum === q1Num) return false
                if (f.op === 'lt' && !(cellNum < q1Num)) return false
                if (f.op === 'gt' && !(cellNum > q1Num)) return false
                if (f.op === 'lte' && !(cellNum <= q1Num)) return false
                if (f.op === 'gte' && !(cellNum >= q1Num)) return false
                continue
              }

              const cell = String(raw ?? '').toLowerCase()
              const q = f.v1.toLowerCase()
              if (f.op === 'contains' && !cell.includes(q)) return false
              if (f.op === 'not_contains' && cell.includes(q)) return false
              if (f.op === 'starts_with' && !cell.startsWith(q)) return false
              if (f.op === 'ends_with' && !cell.endsWith(q)) return false
              if (f.op === 'eq' && cell !== q) return false
              if (f.op === 'neq' && cell === q) return false
            }
            return true
          })

    const gs = globalSearch.trim().toLowerCase()
    const byGlobal =
      !gs
        ? byText
        : byText.filter((r) => {
            const cells = [
              r?.orderNo ?? r?.OrderNo,
              r?.processedAt ?? r?.ProcessedAt,
              r?.customerName ?? r?.CustomerName,
              r?.deliveryCustomerName ?? r?.DeliveryCustomerName,
              r?.customerInvoiceType ?? r?.CustomerInvoiceType,
              String(r?.subtotal ?? r?.Subtotal ?? ''),
              String(r?.discount ?? r?.Discount ?? ''),
              String(r?.netTotal ?? r?.NetTotal ?? ''),
              String(r?.vatTotal ?? r?.VatTotal ?? ''),
              String(r?.grandTotal ?? r?.GrandTotal ?? ''),
              r?.plasiyer ?? r?.Plasiyer,
              r?.processedBy ?? r?.ProcessedBy
            ]
              .filter((x) => x !== null && x !== undefined)
              .map((x) => String(x).toLowerCase())
            return cells.some((c) => c.includes(gs))
          })

    const active = Object.entries(selectedValues).filter(([, v]) => (v ?? []).length > 0)
    if (active.length === 0) return byGlobal

    return byGlobal.filter((r) => {
      for (const [k, list] of active) {
        const raw = (r as any)[k] ?? (r as any)[k[0].toUpperCase() + k.slice(1)]
        const cell = String(raw ?? '').toLowerCase()
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

  const readErrorText = async (res: Response) => {
    const text = await res.text().catch(() => '')
    const trimmed = String(text ?? '').trim()
    if (!trimmed) return `İşlem başarısız (${res.status})`
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        const j = JSON.parse(trimmed)
        const msg = j?.message || j?.error || j?.title
        if (typeof msg === 'string' && msg.trim()) return msg.trim()
      } catch {
        // ignore
      }
    }
    return trimmed
  }

  /**
   * `background`: liste EKRANDA KALARAK tazelenir.
   *
   * `loading` bayrağı tabloyu iskelet ekranla değiştiriyor, yani bileşeni söküp yeniden
   * kuruyordu. Silme ya da kayıttan sonra sütun süzgeçleri, sıralama ve kaydırma konumu
   * sıfırlanıyor; kullanıcı bunu "sayfa yenileniyor" diye görüyordu. İlk açılışta iskelet
   * doğru — gösterilecek bir şey yok; ama dolu bir listeyi tazelemek için boşaltmak gerekmez.
   */
  const load = async (options?: { background?: boolean }) => {
    const background = options?.background ?? false
    try {
      if (!background) setLoading(true)
      setError(null)
      const token = localStorage.getItem('accessToken')
      const headers: Record<string, string> = {}
      if (token) headers.Authorization = `Bearer ${token}`

      const res = await fetch(`${API_BASE_URL}/api/salesorders/uninvoiced-report?query=${encodeURIComponent(globalSearch)}`, { headers })
      if (!res.ok) {
        const text = await res.text()
        throw new Error(text || 'Order report could not be loaded')
      }

      const json = await res.json()
      setRows((json?.data?.items ?? []) as any[])
      setTotals(json?.data?.totals ?? null)
    } catch (e: any) {
      setError(e?.message ?? 'Bir hata oluştu')
      setRows([])
      setTotals(null)
    } finally {
      if (!background) setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const requestDeleteOrder = (id: number) => {
    setConfirmTitle('Onay')
    setConfirmText('Siparişi silmek istediğinize emin misiniz?')
    setConfirmOrderId(id)
    setConfirmOpen(true)
  }

  const performDeleteOrder = async (id: number) => {
    try {
      setConfirmBusy(true)
      const token = localStorage.getItem('accessToken')
      const headers: Record<string, string> = {}
      if (token) headers.Authorization = `Bearer ${token}`

      const res = await fetch(`${API_BASE_URL}/api/salesorders/${encodeURIComponent(String(id))}`, { method: 'DELETE', headers })
      if (!res.ok) {
        const text = await readErrorText(res)
        showMessage('Hata', text || 'Sipariş silinemedi')
        return
      }

      setConfirmOpen(false)
      showMessage('Bilgi', 'Sipariş silindi')
      await load({ background: true })
    } catch {
      showMessage('Hata', 'Sipariş silinemedi')
    } finally {
      setConfirmBusy(false)
    }
  }

  const [pageIndex, setPageIndex] = useState(0)
  const [pageSize, setPageSize] = useState(20)
  const [columnFiltersState, setColumnFiltersState] = useState<Record<string, any>>({})

  const orderColumns = useMemo<ColumnDef<any, any>[]>(
    () => [
      {
        id: 'processedAt',
        accessorFn: (row) => row.processedAt ?? row.ProcessedAt ?? '',
        header: 'Tarih',
        meta: { filterType: 'date', filterPlaceholder: 'Tarih...' },
        cell: ({ getValue }) => formatDate(getValue())
      },
      {
        id: 'orderNo',
        accessorFn: (row) => String(row.orderNo ?? row.OrderNo ?? ''),
        header: 'Sipariş No',
        meta: { filterType: 'text', filterPlaceholder: 'Sipariş No...' },
        cell: ({ getValue }) => getValue()
      },
      {
        id: 'customerName',
        accessorFn: (row) => String(row.customerName ?? row.CustomerName ?? ''),
        header: 'Cari Adı',
        meta: { filterType: 'text', filterPlaceholder: 'Cari Adı...' },
        cell: ({ getValue }) => getValue()
      },
      {
        /*
          TESLİM CARİSİ — şubeli bayide sipariş ana firmaya yazılır, mal şubeye gider
          (2026-09-06). Fatura carisiyle AYNIYSA tire gösterilir: her satıra aynı ismi iki kez
          yazmak sütunu gürültüye çevirir. Farklıysa asıl bilgi budur — plasiyer listede kendi
          müşterisini bu sütundan tanıyor, yoksa "bu satır neden bende" diye soruyor.
        */
        id: 'deliveryCustomerName',
        accessorFn: (row) => {
          const teslim = String(row.deliveryCustomerName ?? row.DeliveryCustomerName ?? '').trim()
          const fatura = String(row.customerName ?? row.CustomerName ?? '').trim()
          return teslim && teslim !== fatura ? teslim : ''
        },
        header: 'Teslim Carisi',
        meta: { filterType: 'text', filterPlaceholder: 'Teslim Carisi...' },
        cell: ({ getValue, row }) => {
          const ad = String(getValue() ?? '')
          if (!ad) return <span className="text-slate-300">-</span>
          const kod = String(row.original?.deliveryCustomerCode ?? row.original?.DeliveryCustomerCode ?? '')
          return (
            <span className="text-slate-700 font-medium truncate block" title={kod ? `${kod} - ${ad}` : ad}>
              {ad}
            </span>
          )
        }
      },
      {
        id: 'customerInvoiceType',
        accessorFn: (row) => String(row.customerInvoiceType ?? row.CustomerInvoiceType ?? ''),
        header: 'Fatura/Açık',
        meta: { filterType: 'text', filterPlaceholder: 'Fatura/Açık...' },
        cell: ({ getValue }) => {
          const val = String(getValue() || '').trim().toUpperCase()
          if (val === 'ASKERIYE' || val === 'ASKERİYE') {
            return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-emerald-100 text-emerald-800">ASKERİYE</span>
          }
          if (val === 'FATURA') {
            return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-blue-100 text-blue-800">FATURA</span>
          }
          if (val === 'ACIK' || val === 'AÇIK') {
            return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-amber-100 text-amber-800">AÇIK</span>
          }
          return val
        }
      },
      // ======================================================================
      // TUTARLAR SİPARİŞİN KENDİ PARASINDA (2026-08-19).
      //
      // Uc hem TL çapasını (`subtotal`...) hem belgenin kendi parasındaki karşılığını
      // (`dovizSubtotal`...) gönderiyor. Ekran kendi parasını basar; TL karşılığı ayrı
      // sütunda durur. Eski yanıtta `doviz*` yoksa TL alanlarına düşer, davranış değişmez.
      //
      // Toplam satırı bu sütunlarda para birimi başına AYRI satır gösterir
      // (AppDataTable), yani farklı kurlar tek rakamda toplanmaz.
      // ======================================================================
      {
        id: 'subtotal',
        accessorFn: (row) => Number(row.dovizSubtotal ?? row.subtotal ?? row.Subtotal ?? 0),
        header: 'Brüt Tutar',
        meta: { filterType: 'number', showTotal: true },
        cell: ({ getValue, row }) => (
          <div className="text-right font-medium text-slate-700">
            {formatOwnCurrency(getValue(), orderCurrencyTypeIdOf(row.original))}
          </div>
        )
      },
      {
        id: 'discount',
        accessorFn: (row) => Number(row.dovizDiscount ?? row.discount ?? row.Discount ?? 0),
        header: 'İskonto',
        meta: { filterType: 'number', showTotal: true },
        cell: ({ getValue, row }) => (
          <div className="text-right font-medium text-slate-700">
            {formatOwnCurrency(getValue(), orderCurrencyTypeIdOf(row.original))}
          </div>
        )
      },
      {
        id: 'netTotal',
        accessorFn: (row) => Number(row.dovizNetTotal ?? row.netTotal ?? row.NetTotal ?? 0),
        header: 'Net Tutar',
        meta: { filterType: 'number', showTotal: true },
        cell: ({ getValue, row }) => (
          <div className="text-right font-semibold text-slate-800">
            {formatOwnCurrency(getValue(), orderCurrencyTypeIdOf(row.original))}
          </div>
        )
      },
      {
        id: 'vatTotal',
        accessorFn: (row) => Number(row.dovizVatTotal ?? row.vatTotal ?? row.VatTotal ?? 0),
        header: 'KDV Tutar',
        meta: { filterType: 'number', showTotal: true },
        cell: ({ getValue, row }) => (
          <div className="text-right font-medium text-slate-700">
            {formatOwnCurrency(getValue(), orderCurrencyTypeIdOf(row.original))}
          </div>
        )
      },
      // ======================================================================
      // GENEL TOPLAM TEK SÜTUN (2026-08-19 kullanıcı kararı — önceki dört sütunlu
      // düzenin yerine geçer).
      //
      // "Toplam ₺ / € / $ / £" diye dört sütun vardı; her sipariş yalnız birini
      // dolduruyor, diğer üçünde "—" duruyordu. Kullanıcı bunu gereksiz genişlik
      // olarak gördü: tek "Genel Toplam" sütunu, siparişin KENDİ parasında yazılır,
      // hangi para olduğu yanındaki "Döviz" sütununda durur.
      //
      // Alttaki TOPLAM satırı yine para birimi başına AYRI çıkar — `AppDataTable`
      // satırın `currencyTypeId`sine bakıp kovalıyor ve karışıkken alt alta yazıyor.
      // Bu yüzden `totalCurrencyCode` VERİLMEZ (verilseydi hepsi tek kovaya girerdi).
      // ======================================================================
      {
        id: 'orderCurrency',
        accessorFn: (row: any) => currencyCodeOfRow(orderCurrencyTypeIdOf(row)),
        header: 'Döviz',
        meta: {
          filterType: 'select',
          filterPlaceholder: 'Döviz...',
          filterOptions: [
            { value: 'TL', label: 'TL' },
            { value: 'EUR', label: 'EUR' },
            { value: 'USD', label: 'USD' },
            { value: 'GBP', label: 'GBP' }
          ]
        },
        cell: ({ getValue }: any) => (
          <div className="text-center">
            <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold bg-slate-100 text-slate-700 border border-slate-200">
              {String(getValue() ?? 'TL')}
            </span>
          </div>
        )
      },
      {
        id: 'grandTotalOwn',
        accessorFn: (row: any) => Number(row.dovizGrandTotal ?? row.grandTotal ?? row.GrandTotal ?? 0),
        header: 'Genel Toplam',
        meta: { filterType: 'number', showTotal: true },
        cell: ({ getValue, row }: any) => (
          <div className="text-right font-bold text-slate-900">
            {formatOwnCurrency(getValue(), orderCurrencyTypeIdOf(row.original))}
          </div>
        )
      },
      {
        id: 'grandTotal',
        accessorFn: (row) => Number(row.grandTotal ?? row.GrandTotal ?? 0),
        header: 'TL Karşılığı',
        meta: { filterType: 'number', showTotal: true, totalCurrencyCode: 'TRY' },
        cell: ({ getValue }) => <div className="text-right font-medium text-slate-500">{formatMoney(getValue())}</div>
      },
      {
        id: 'plasiyer',
        accessorFn: (row) => String(row.plasiyer ?? row.Plasiyer ?? ''),
        header: 'Plasiyer',
        meta: { filterType: 'text', filterPlaceholder: 'Plasiyer...' },
        cell: ({ getValue }) => getValue()
      },
      {
        id: 'processedBy',
        accessorFn: (row) => String(row.processedBy ?? row.ProcessedBy ?? ''),
        header: 'İşlem Yapan',
        meta: { filterType: 'text', filterPlaceholder: 'İşlem Yapan...' },
        cell: ({ getValue }) => getValue()
      }
    ],
    []
  )

  const getRowActions = (row: any): DataTableRowAction<any>[] => [
    {
      label: 'Sil',
      icon: <Trash2 size={14} />,
      variant: 'danger',
      onClick: (r) => {
        const idNum = Number(getRowId(r))
        if (!Number.isFinite(idNum) || idNum <= 0) return
        requestDeleteOrder(idNum)
      }
    }
  ]

  const renderExpandedRowContent = (row: any) => {
    const lines = getLines(row)
    return (
      <div className="border border-slate-200 rounded-lg overflow-hidden bg-white shadow-sm p-3">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-slate-100 text-slate-700 font-semibold border-b border-slate-200">
              <th className="px-2 py-2 text-left">Stok Kodu</th>
              <th className="px-2 py-2 text-left">Stok Adı</th>
              <th className="px-2 py-2 text-left">Açıklama</th>
              <th className="px-2 py-2 text-right">KDV %</th>
              <th className="px-2 py-2 text-right">Teslim</th>
              <th className="px-2 py-2 text-right font-bold">Kalan</th>
              <th className="px-2 py-2 text-right">Birim Fiyat</th>
              <th className="px-2 py-2 text-right font-bold">Tutar</th>
              <th className="px-2 py-2 text-center">Döviz</th>
              <th className="px-2 py-2 text-right">Döviz Tutar</th>
              <th className="px-2 py-2 text-right">İşlem</th>
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 ? (
              <tr>
                <td colSpan={11} className="px-3 py-3 text-slate-500">Kalem bulunamadı.</td>
              </tr>
            ) : (
              lines.map((l: any, i: number) => {
                const lineId = Number(l.salesOrderLineId ?? l.SalesOrderLineId)
                const remQty = Number(l.remainingQuantity ?? l.RemainingQuantity ?? l.quantity ?? l.Quantity ?? 0)
                const unitPrice = Number(l.unitPrice ?? l.UnitPrice ?? 0)
                const lineTotal = Number(l.lineTotal ?? l.LineTotal ?? (remQty * unitPrice))

                // Kalemin kendi para birimi. Tutar sütunları TL çapasıdır; dövizli sipariş
                // yalnız TL karşılığıyla gösterilirse TL siparişten ayırt edilemiyordu.
                const lineCurrencyTypeId = Number(l.currencyTypeId ?? l.CurrencyTypeId ?? 1)
                const lineCurrencyUnit = Number(l.currencyUnitPrice ?? l.CurrencyUnitPrice ?? 0)
                const isForeignLine = lineCurrencyTypeId > 1
                const fxUnit = lineCurrencyUnit > 0 ? lineCurrencyUnit : unitPrice

                return (
                  <tr key={String(lineId || i)} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-2 py-2 font-mono text-slate-800">{String(l.stockCode ?? l.StockCode ?? '')}</td>
                    <td className="px-2 py-2 text-slate-800">{String(l.productName ?? l.ProductName ?? '')}</td>
                    <td className="px-2 py-2 text-slate-500">{String(l.description ?? l.Description ?? '-')}</td>
                    <td className="px-2 py-2 text-right text-slate-700">{Number(l.vatRate ?? l.VatRate ?? 0)}</td>
                    <td className="px-2 py-2 text-right text-slate-700">{Number(l.deliveredQuantity ?? l.DeliveredQuantity ?? 0)}</td>
                    <td className="px-2 py-2 text-right font-semibold text-slate-800">{remQty}</td>
                    <td className="px-2 py-2 text-right text-slate-700">{formatMoney(unitPrice)}</td>
                    <td className="px-2 py-2 text-right font-bold text-slate-900">{formatMoney(lineTotal)}</td>
                    <td className="px-2 py-2 text-center text-slate-600 font-semibold">
                      {currencyCodeOfRow(lineCurrencyTypeId)}
                    </td>
                    <td className="px-2 py-2 text-right font-semibold text-emerald-700">
                      {isForeignLine
                        ? `${currencySymbolOfRow(lineCurrencyTypeId)}${(fxUnit * remQty).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                        : '—'}
                    </td>
                    <td className="px-2 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => openDeleteModal(lineId, remQty)}
                        className="px-2 py-1 text-[11px] font-medium rounded bg-red-50 text-red-700 hover:bg-red-100 border border-red-200 transition-colors"
                      >
                        Kalem Sil
                      </button>
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
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-gray-900 tracking-tight">Sipariş Listesi</h1>
          <p className="text-xs text-gray-400 mt-0.5">Satış İşlemleri / Faturalanmamış Siparişler</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input
              value={globalSearch}
              onChange={(e) => setGlobalSearch(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void load() }}
              placeholder="Genel arama..."
              className="w-56 h-[34px] pl-8 pr-3 text-xs border border-gray-200 rounded-lg bg-white focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition"
            />
          </div>
          <button
            type="button"
            onClick={() => void load()}
            className="h-[34px] inline-flex items-center gap-1.5 px-4 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className={loading ? 'animate-spin' : ''}><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10"/><path d="M20.49 15a9 9 0 0 1-14.85 3.36L1 14"/></svg>
            Yenile
          </button>
        </div>
      </div>

      {error && <div className="mb-3 text-xs font-semibold text-red-600">{error}</div>}

      <AppDataTable
        onRefresh={() => void load()}
        data={filteredRows}
        columns={orderColumns}
        rowId={(row) => String(getRowId(row))}
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
        isOpen={deleteOpen}
        onClose={() => {
          if (deleteSaving) return
          setDeleteOpen(false)
        }}
        title="Kalem Sil"
        footer={
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setDeleteOpen(false)}
              disabled={deleteSaving}
              className="h-[34px] px-4 text-xs font-semibold rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 transition disabled:opacity-60"
            >
              Vazgeç
            </button>
            <button
              type="button"
              onClick={() => void confirmDelete()}
              disabled={deleteSaving || !deleteLineId}
              className="h-[34px] inline-flex items-center gap-1.5 px-4 text-xs font-semibold rounded-lg bg-red-600 hover:bg-red-700 text-white shadow-sm transition disabled:opacity-60"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
              {deleteSaving ? 'Siliniyor...' : 'Sil'}
            </button>
          </div>
        }
      >
        <div className="text-xs text-gray-700">
          <div className="mb-2">Kalan Miktar: <span className="font-semibold">{Number(deleteMaxQty ?? 0)}</span></div>

          <div className="space-y-2">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                checked={deleteMode === 'all'}
                onChange={() => setDeleteMode('all')}
              />
              <span>Hepsi</span>
            </label>

            <label className="flex items-center gap-2">
              <input
                type="radio"
                checked={deleteMode === 'partial'}
                onChange={() => setDeleteMode('partial')}
              />
              <span>Kaç adet</span>
            </label>

            {deleteMode === 'partial' && (
              <div className="pl-6">
                <input
                  type="number"
                  min={0}
                  max={Number(deleteMaxQty ?? 0)}
                  value={deleteQty}
                  onChange={(e) => setDeleteQty(e.target.value)}
                  className="w-28 px-2 py-1 text-xs border border-gray-300 rounded"
                />
              </div>
            )}

            {deleteError && <div className="text-xs font-semibold text-red-600">{deleteError}</div>}
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={msgOpen}
        onClose={() => setMsgOpen(false)}
        title={msgTitle || 'Bilgi'}
        footer={
          <button
            type="button"
            onClick={() => setMsgOpen(false)}
            className="h-[34px] px-4 text-xs font-semibold rounded-lg bg-gray-800 hover:bg-gray-900 text-white shadow-sm transition"
          >
            Tamam
          </button>
        }
      >
        <div className="text-xs text-gray-700 whitespace-pre-line">{msgText}</div>
      </Modal>

      <Modal
        isOpen={confirmOpen}
        onClose={() => {
          if (confirmBusy) return
          setConfirmOpen(false)
        }}
        title={confirmTitle || 'Onay'}
        footer={
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              disabled={confirmBusy}
              onClick={() => setConfirmOpen(false)}
              className="h-[34px] px-4 text-xs font-semibold rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 transition disabled:opacity-60"
            >
              Vazgeç
            </button>
            <button
              type="button"
              disabled={confirmBusy || !confirmOrderId}
              onClick={() => {
                if (!confirmOrderId) return
                void performDeleteOrder(confirmOrderId)
              }}
              className="h-[34px] inline-flex items-center gap-1.5 px-4 text-xs font-semibold rounded-lg bg-red-600 hover:bg-red-700 text-white shadow-sm transition disabled:opacity-60"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
              {confirmBusy ? 'Siliniyor...' : 'Sil'}
            </button>
          </div>
        }
      >
        <div className="text-xs text-gray-700 whitespace-pre-line">{confirmText}</div>
      </Modal>

      {totals && (
        <div className="mt-4 bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
          <div className="grid grid-cols-12 text-[11px] font-semibold text-gray-700">
            <div className="col-span-4 px-3 py-2 text-right">Toplam</div>
            <div className="col-span-1 px-3 py-2 text-right">{formatMoney(Number(totals.brutTutar ?? 0))}</div>
            <div className="col-span-1 px-3 py-2 text-right">{formatMoney(Number(totals.iskonto ?? 0))}</div>
            <div className="col-span-1 px-3 py-2 text-right">{formatMoney(Number(totals.netTutar ?? 0))}</div>
            <div className="col-span-1 px-3 py-2 text-right">{formatMoney(Number(totals.kdvTutari ?? 0))}</div>
            <div className="col-span-1 px-3 py-2 text-right">{formatMoney(Number(totals.genelToplam ?? 0))}</div>
            <div className="col-span-3 px-3 py-2" />
          </div>
        </div>
      )}
    </div>
  )
}
