import { useCallback, useEffect, useMemo, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import Table, { type TableColumn } from '../components/Table'
import { CARI_SEARCH_LIMIT, buildCariSearchQuery } from '../utils/cariRemoteSearch'
import {
  ShieldCheck,
  Save,
  Search,
  Trash2,
  Pencil,
  AlertTriangle,
  ArrowRight,
  Package,
  Calendar,
  Building2,
  FileText,
  DollarSign,
  TrendingDown,
  TrendingUp,
  Minus,
  CheckCircle2,
  RefreshCw,
  Info
} from 'lucide-react'
import NotificationPopup from '../components/NotificationPopup'
import SearchableCariSelect, { type CariOption } from '../components/SearchableCariSelect'
import { fetchCustomersDropdown } from '../api/customers'
import { fetchProducts } from '../api/products'
import { fetchLatestFxRate } from '../api/fx'
import type { Product } from '../types/Product'
import { fetchAuthorizedWarehousesDropdown, type WarehouseDropdownItem } from '../api/warehouses'
import {
  createWarrantyExchange,
  updateWarrantyExchange,
  deleteWarrantyExchange,
  fetchWarrantyExchangeSettings,
  fetchWarrantyExchanges,
  warrantyExchangeCurrencySymbol,
  WARRANTY_EXCHANGE_CURRENCIES,
  type WarrantyExchangeRow
} from '../api/warrantyExchanges'

type LayoutContext = {
  isSuperAdmin?: boolean
  isSuperSuperAdmin?: boolean
  allowedKeys?: Set<string>
}

type ProductPickerProps = {
  label: string
  value: string
  productName?: string | null
  onPick: (product: Product | null) => void
  disabled?: boolean
  variant?: 'danger' | 'success'
}

/**
 * Gelişmiş Ürün Seçici Bileşeni
 */
function ProductPicker({ label, value, productName, onPick, disabled, variant = 'danger' }: ProductPickerProps) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<Product[]>([])
  const [searching, setSearching] = useState(false)

  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) {
      setItems([])
      return
    }

    const ac = new AbortController()
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          setSearching(true)
          const res = await fetchProducts({ q, page: 1, pageSize: 20 }, { signal: ac.signal })
          setItems(res?.items ?? [])
        } catch {
          setItems([])
        } finally {
          setSearching(false)
        }
      })()
    }, 300)

    return () => {
      window.clearTimeout(timer)
      ac.abort()
    }
  }, [query])

  const isSuccess = variant === 'success'

  return (
    <div className="space-y-1.5 relative">
      <div className="flex items-center justify-between">
        <label className="text-[11px] font-bold text-gray-700 uppercase tracking-wider flex items-center gap-1.5">
          <Package size={13} className={isSuccess ? 'text-emerald-600' : 'text-red-600'} />
          {label}
        </label>
        {value && !disabled && (
          <button
            type="button"
            className="text-[11px] font-semibold text-gray-500 hover:text-gray-900 transition underline cursor-pointer"
            onClick={() => {
              onPick(null)
              setQuery('')
              setItems([])
            }}
          >
            Farklı Ürün Seç
          </button>
        )}
      </div>

      {value ? (
        <div
          className={`flex items-center justify-between gap-3 p-2.5 rounded-lg border transition ${
            isSuccess
              ? 'border-emerald-200 bg-emerald-50 text-emerald-950 shadow-xs'
              : 'border-red-200 bg-red-50 text-red-950 shadow-xs'
          }`}
        >
          <div className="min-w-0 flex-1">
            <div className="text-xs font-bold truncate flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${isSuccess ? 'bg-emerald-500' : 'bg-red-500'}`} />
              {productName || value}
            </div>
            <div className="text-[10px] opacity-75 font-mono truncate mt-0.5">
              Kod: <b>{value}</b>
            </div>
          </div>
          <span
            className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider shrink-0 ${
              isSuccess ? 'bg-emerald-200/80 text-emerald-900' : 'bg-red-200/80 text-red-900'
            }`}
          >
            Seçildi
          </span>
        </div>
      ) : (
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input
            value={query}
            disabled={disabled}
            onChange={(e) => {
              setQuery(e.target.value)
              setOpen(true)
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => window.setTimeout(() => setOpen(false), 200)}
            placeholder="Stok kodu veya ürün adı ara (en az 2 karakter)..."
            className="w-full h-9 pl-9 pr-3 text-xs rounded-lg border border-gray-200 bg-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-200 focus:border-orange-500 transition"
            data-no-capitalize="true"
          />
          {open && query.trim().length >= 2 && (
            <div className="absolute z-40 left-0 right-0 mt-1 max-h-64 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg py-1 divide-y divide-gray-100">
              {searching && (
                <div className="px-4 py-3 text-xs text-gray-500 flex items-center gap-2">
                  <RefreshCw size={13} className="animate-spin text-orange-600" />
                  Ürünler aranıyor...
                </div>
              )}
              {!searching && items.length === 0 && (
                <div className="px-4 py-3 text-xs text-gray-500 text-center">
                  "{query}" ile eşleşen ürün bulunamadı.
                </div>
              )}
              {items.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="w-full text-left px-3.5 py-2 hover:bg-orange-50/70 transition flex items-center justify-between gap-3 group"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    onPick(p)
                    setQuery('')
                    setItems([])
                    setOpen(false)
                  }}
                >
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-gray-800 group-hover:text-[#D84315] truncate">
                      {p.name}
                    </div>
                    <div className="text-[10px] text-gray-500 font-mono mt-0.5">
                      {p.stockCode} {p.barcode ? `• Barkod: ${p.barcode}` : ''}
                    </div>
                  </div>
                  <span className="text-[11px] font-semibold text-gray-400 group-hover:text-[#D84315] shrink-0">
                    Seç →
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function toNumber(v: string): number {
  const n = Number(String(v ?? '').replace(',', '.'))
  return Number.isFinite(n) ? n : 0
}

function formatInvoiceNo15(serie: string, num: string): string {
  const s = String(serie ?? '').trim().toUpperCase()
  const n = String(num ?? '').trim()
  if (!s && !n) return ''
  const cleanSerie = s || 'A'
  if (!n) {
    return `${cleanSerie}${'0'.repeat(Math.max(0, 15 - cleanSerie.length))}`
  }
  if (n.length >= 15) {
    return n.slice(0, 15)
  }
  const remaining = Math.max(0, 15 - cleanSerie.length - n.length)
  return `${cleanSerie}${'0'.repeat(remaining)}${n}`
}

const money = (n: number, code: string = 'TRY') =>
  new Intl.NumberFormat('tr-TR', { style: 'currency', currency: code || 'TRY' }).format(Number(n) || 0)

/** Uçtan gelen cari satırlarını seçim kutusu biçimine çevirir (açılış ve arama aynı yoldan). */
function buildGarantiCariOptions(customers: any[]): CariOption[] {
  return (customers ?? []).map((c: any) => ({
    value: c.customerCode,
    label: `[${c.customerCode}] ${c.name}`,
    code: c.customerCode,
    name: c.name,
    phone: c.phone ?? undefined,
    customerType: c.customerType
  }))
}

export default function GarantiDegisimPage() {
  const layout = useOutletContext<LayoutContext>()
  const canDelete =
    Boolean(layout?.isSuperAdmin) ||
    Boolean(layout?.isSuperSuperAdmin) ||
    Boolean(layout?.allowedKeys?.has('invoice/garantiDegisimSil'))

  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const [warrantyWarehouseCode, setWarrantyWarehouseCode] = useState(0)
  const [warrantyWarehouseName, setWarrantyWarehouseName] = useState<string | null>(null)

  const [warehouses, setWarehouses] = useState<WarehouseDropdownItem[]>([])
  const [customers, setCustomers] = useState<CariOption[]>([])

  /**
   * CARİ ARAMASI SUNUCUDA (2026-08-22) — Cari Ekstre'deki düzenin aynısı.
   * Uç parametresi AYNEN korundu: muhtelif cari yine listede.
   */
  const cariRemoteSearch = useCallback(async (query: string, typeKey: string): Promise<CariOption[]> => {
    try {
      const list = await fetchCustomersDropdown({
        includeMuhtelif: true,
        q: buildCariSearchQuery(query, typeKey),
        limit: CARI_SEARCH_LIMIT
      })
      const opts = buildGarantiCariOptions(list ?? [])
      setCustomers(opts)
      return opts
    } catch {
      return []
    }
  }, [])

  const [customerCode, setCustomerCode] = useState('')
  const [invoiceSerie, setInvoiceSerie] = useState('A')
  const [invoiceNumber, setInvoiceNumber] = useState('')
  const computedInvoiceNo = useMemo(() => formatInvoiceNo15(invoiceSerie, invoiceNumber), [invoiceSerie, invoiceNumber])
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [outWarehouseCode, setOutWarehouseCode] = useState('')

  const [returned, setReturned] = useState<{ stockCode: string; name: string | null }>({ stockCode: '', name: null })
  const [returnedQty, setReturnedQty] = useState('1')
  const [returnedPrice, setReturnedPrice] = useState('')
  const [returnedSerial, setReturnedSerial] = useState('')

  const [given, setGiven] = useState<{ stockCode: string; name: string | null }>({ stockCode: '', name: null })
  const [givenQty, setGivenQty] = useState('1')
  const [givenPrice, setGivenPrice] = useState('')
  const [givenSerial, setGivenSerial] = useState('')

  const [discount, setDiscount] = useState('')
  const [currencyTypeId, setCurrencyTypeId] = useState('1')
  const [currencyRate, setCurrencyRate] = useState('')
  const currencyCode = useMemo(
    () => WARRANTY_EXCHANGE_CURRENCIES.find((c) => String(c.value) === currencyTypeId)?.code ?? 'TRY',
    [currencyTypeId]
  )
  const currencySymbol = useMemo(
    () => warrantyExchangeCurrencySymbol(Number(currencyTypeId)),
    [currencyTypeId]
  )
  const isTryForm = currencyCode === 'TRY'
  const [rateLoading, setRateLoading] = useState(false)

  useEffect(() => {
    if (isTryForm) {
      setCurrencyRate('')
      return
    }

    let cancelled = false
    setRateLoading(true)
    void (async () => {
      try {
        const rate = await fetchLatestFxRate(currencyCode)
        if (cancelled) return
        if (Number(rate) > 0) {
          setCurrencyRate(String(rate))
        }
      } catch {
        // ignore
      } finally {
        if (!cancelled) setRateLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [currencyCode, isTryForm])

  const [postToLedger, setPostToLedger] = useState(false)
  const [description, setDescription] = useState('')

  const [rows, setRows] = useState<WarrantyExchangeRow[]>([])
  /*
    DÜZENLEME KİPİ (2026-09-02 kullanıcı isteği).

    Ayrı bir düzenleme penceresi AÇILMADI: aynı form kullanılıyor, yalnızca hedef kayıt
    tutuluyor. İkinci bir form, iki yerde ayrışan doğrulama demekti — bu ekranda tutar,
    kur ve depo kuralları zaten iç içe.
  */
  const [editingId, setEditingId] = useState<number | null>(null)
  const [listLoading, setListLoading] = useState(false)

  const loadList = useCallback(async (signal?: AbortSignal) => {
    try {
      setListLoading(true)
      const list = await fetchWarrantyExchanges(undefined, { signal })
      setRows(list ?? [])
    } catch (e: any) {
      if (e?.name !== 'AbortError') setError(String(e?.message ?? 'Kayıtlar alınamadı'))
    } finally {
      setListLoading(false)
    }
  }, [])

  useEffect(() => {
    const ac = new AbortController()
    void (async () => {
      try {
        const [settings, whs, custs] = await Promise.all([
          fetchWarrantyExchangeSettings({ signal: ac.signal }),
          fetchAuthorizedWarehousesDropdown({ signal: ac.signal }),
          // Cari listesi ARTIK TÜMÜYLE İNDİRİLMİYOR — seçim kutusu sunucudan arıyor
          // (bkz. cariRemoteSearch). Açılışta yalnızca ilk sayfa çekilir.
          fetchCustomersDropdown({ includeMuhtelif: true, limit: CARI_SEARCH_LIMIT, signal: ac.signal })
        ])

        setWarrantyWarehouseCode(Number(settings?.warehouseCode ?? 0))
        setWarrantyWarehouseName(settings?.warehouseName ?? null)
        setWarehouses(whs ?? [])
        setCustomers(buildGarantiCariOptions(custs ?? []))

        if ((whs ?? []).length === 1) setOutWarehouseCode(String(whs[0].warehouseCode))
      } catch (e: any) {
        if (e?.name !== 'AbortError') setError(String(e?.message ?? 'Sayfa yüklenemedi'))
      }
      await loadList(ac.signal)
    })()
    return () => ac.abort()
  }, [loadList])

  const returnedTotal = useMemo(
    () => toNumber(returnedPrice) * toNumber(returnedQty),
    [returnedPrice, returnedQty]
  )

  const givenTotal = useMemo(
    () => toNumber(givenPrice) * toNumber(givenQty) - toNumber(discount),
    [givenPrice, givenQty, discount]
  )

  const difference = useMemo(
    () => givenTotal - returnedTotal,
    [givenTotal, returnedTotal]
  )

  const canSave =
    warrantyWarehouseCode !== 0 &&
    Boolean(customerCode) &&
    Boolean(returned.stockCode) &&
    Boolean(given.stockCode) &&
    toNumber(returnedQty) > 0 &&
    toNumber(givenQty) > 0 &&
    String(outWarehouseCode ?? '').trim() !== ''

  const resetForm = () => {
    setInvoiceSerie('A')
    setInvoiceNumber('')
    setReturned({ stockCode: '', name: null })
    setReturnedQty('1')
    setReturnedPrice('')
    setReturnedSerial('')
    setGiven({ stockCode: '', name: null })
    setGivenQty('1')
    setGivenPrice('')
    setGivenSerial('')
    setDiscount('')
    setCurrencyTypeId('1')
    setCurrencyRate('')
    setPostToLedger(false)
    setDescription('')
    setEditingId(null)
  }

  const onSave = async () => {
    if (!canSave) return
    try {
      setSaving(true)
      setError(null)

      const govde = {
        date: new Date(`${date}T00:00:00Z`).toISOString(),
        customerCode,
        invoiceNo: computedInvoiceNo.trim() || null,
        outWarehouseCode: Number(outWarehouseCode),
        returnedStockCode: returned.stockCode,
        returnedQuantity: toNumber(returnedQty),
        returnedUnitPrice: toNumber(returnedPrice),
        returnedSerialNo: returnedSerial.trim() || null,
        givenStockCode: given.stockCode,
        givenQuantity: toNumber(givenQty),
        givenUnitPrice: toNumber(givenPrice),
        givenSerialNo: givenSerial.trim() || null,
        discountAmount: toNumber(discount),
        currencyTypeId: Number(currencyTypeId),
        currencyRate: isTryForm ? 1 : toNumber(currencyRate),
        postToLedger,
        description: description.trim() || null
      }

      const res = editingId
        ? await updateWarrantyExchange(editingId, govde)
        : await createWarrantyExchange(govde)

      setSuccess(
        `${editingId ? 'Garanti değişim güncellendi' : 'Garanti değişim kaydedildi'}: ${res?.exchangeNo}. ` +
          (res?.postedToLedger
            ? `Cari ekstreye ${money(Math.abs(res.difference), currencyCode)} ${res.difference > 0 ? 'BORÇ' : 'ALACAK'} işlendi.`
            : 'Cari ekstreye herhangi bir satır işlenmedi.')
      )
      resetForm()
      await loadList()
    } catch (e: any) {
      setError(String(e?.message ?? 'Kaydedilemedi'))
    } finally {
      setSaving(false)
    }
  }

  /**
   * Kaydı forma yükler. Belge no seri + sıra olarak ikiye ayrılıyor: form iki ayrı kutu
   * tutuyor, kayıtta ise tek metin var.
   */
  const onEdit = (row: WarrantyExchangeRow) => {
    setEditingId(row.id)
    setError(null)
    setSuccess(null)

    setDate(new Date(row.date).toISOString().slice(0, 10))
    setCustomerCode(row.customerCode)

    const belge = String(row.invoiceNo ?? '')
    const seri = belge.slice(0, 1)
    setInvoiceSerie(/[A-Za-z]/.test(seri) ? seri.toUpperCase() : 'A')
    setInvoiceNumber(belge.replace(/^[A-Za-z]/, '').replace(/^0+/, ''))

    setOutWarehouseCode(String(row.outWarehouseCode))
    setReturned({ stockCode: row.returnedStockCode, name: row.returnedProductName ?? null })
    setReturnedQty(String(row.returnedQuantity))
    setReturnedPrice(String(row.returnedUnitPrice))
    setReturnedSerial(row.returnedSerialNo ?? '')
    setGiven({ stockCode: row.givenStockCode, name: row.givenProductName ?? null })
    setGivenQty(String(row.givenQuantity))
    setGivenPrice(String(row.givenUnitPrice))
    setGivenSerial(row.givenSerialNo ?? '')
    setDiscount(row.discountAmount ? String(row.discountAmount) : '')
    setCurrencyTypeId(String(row.currencyTypeId ?? 1))
    setCurrencyRate(row.currencyRate && row.currencyRate !== 1 ? String(row.currencyRate) : '')
    setPostToLedger(Boolean(row.postedToLedger))
    setDescription(row.description ?? '')

    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const onDelete = async (row: WarrantyExchangeRow) => {
    const ok = window.confirm(
      `${row.exchangeNo} numaralı garanti değişim silinecek.\n\n` +
        `Stok hareketleri geri alınacak${row.postedToLedger ? ' ve cari ekstredeki fark satırı da silinecek' : ''}.\n\nOnaylıyor musunuz?`
    )
    if (!ok) return

    try {
      await deleteWarrantyExchange(row.id)
      setSuccess(`${row.exchangeNo} silindi.`)
      await loadList()
    } catch (e: any) {
      setError(String(e?.message ?? 'Silinemedi'))
    }
  }


  const columns = useMemo<TableColumn<WarrantyExchangeRow>[]>(() => {
    const cols: TableColumn<WarrantyExchangeRow>[] = [
      {
        key: 'exchangeNo',
        label: 'İşlem No',
        render: (_v, r) => <span className="font-mono font-bold text-gray-900 whitespace-nowrap">{r.exchangeNo}</span>
      },
      {
        key: 'date',
        label: 'Tarih',
        // Süzgeç ve sıralama ekrandaki metin üzerinden; ham ISO değerinde "22.08" aranamıyordu.
        filter: { type: 'date' },
        accessorFn: (r) => new Date(r.date).toLocaleDateString('tr-TR'),
        /*
          BİÇİM SATIRIN KENDİSİNDEN ÜRETİLİR, `v`'DEN DEĞİL.

          `Table` hücreye `row.original[key] ?? getValue()` veriyor: ham alan doluysa
          `accessorFn` sonucu hiç kullanılmıyor. Bu yüzden sütun ekranda ISO metnini
          ("2026-09-02T00:00:00Z") gösteriyordu. `accessorFn` süzme ve sıralama için
          duruyor; gösterim burada.
        */
        render: (_v, r) => (
          <span className="text-gray-600 whitespace-nowrap">
            {r.date ? new Date(r.date).toLocaleDateString('tr-TR') : ''}
          </span>
        )
      },
      {
        key: 'customer',
        label: 'Cari / Müşteri',
        accessorFn: (r) => `${r.customerName ?? ''} ${r.customerCode ?? ''}`.trim(),
        render: (_v, r) => (
          <>
            <div className="font-semibold text-gray-800 truncate max-w-[200px]" title={r.customerName ?? r.customerCode}>
              {r.customerName ?? r.customerCode}
            </div>
            <div className="text-[10px] text-gray-400 font-mono">{r.customerCode}</div>
          </>
        )
      },
      {
        key: 'exchange',
        label: 'Değişim Hareketi',
        accessorFn: (r) =>
          `${r.returnedProductName ?? r.returnedStockCode ?? ''} ${r.givenProductName ?? r.givenStockCode ?? ''}`.trim(),
        render: (_v, r) => (
          <div className="flex items-center gap-2 text-xs">
            <span className="px-2 py-0.5 rounded bg-red-50 border border-red-200 text-red-800 font-medium truncate max-w-[150px]" title={r.returnedProductName ?? r.returnedStockCode}>
              {r.returnedProductName ?? r.returnedStockCode}
            </span>
            <ArrowRight size={12} className="text-gray-400 shrink-0" />
            <span className="px-2 py-0.5 rounded bg-emerald-50 border border-emerald-200 text-emerald-800 font-medium truncate max-w-[150px]" title={r.givenProductName ?? r.givenStockCode}>
              {r.givenProductName ?? r.givenStockCode}
            </span>
          </div>
        )
      },
      {
        /*
          DEPO HAREKETİ (2026-09-02 kullanıcı isteği).

          Liste "hangi üründen hangi ürüne" diyordu ama malın nereden çıkıp nereye
          girdiğini söylemiyordu. Garanti değişiminin tamamı iki depo hareketidir;
          bu sütun olmadan kayıt stok tarafından okunamıyordu.
        */
        key: 'warehouses',
        label: 'Depo Hareketi',
        accessorFn: (r) => `${r.outWarehouseName ?? r.outWarehouseCode} ${r.warrantyWarehouseName ?? r.warrantyWarehouseCode}`.trim(),
        render: (_v, r) => (
          <div className="text-[11px] leading-tight">
            <div className="flex items-center gap-1 text-emerald-700">
              <span className="text-gray-400">çıkış</span>
              <span className="font-semibold truncate max-w-[130px]" title={`${r.outWarehouseCode} — ${r.outWarehouseName ?? ''}`}>
                {r.outWarehouseName ?? `Depo ${r.outWarehouseCode}`}
              </span>
            </div>
            <div className="flex items-center gap-1 text-red-700">
              <span className="text-gray-400">giriş</span>
              <span className="font-semibold truncate max-w-[130px]" title={`${r.warrantyWarehouseCode} — ${r.warrantyWarehouseName ?? ''}`}>
                {r.warrantyWarehouseName ?? `Depo ${r.warrantyWarehouseCode}`}
              </span>
            </div>
          </div>
        )
      },
      {
        // Adet ve birim fiyat: farkın nereden çıktığı satırda görünmeliydi.
        key: 'quantities',
        label: 'Adet / Fiyat',
        sortable: false,
        accessorFn: (r) => `${r.returnedQuantity} ${r.givenQuantity}`,
        render: (_v, r) => (
          <div className="text-[11px] leading-tight font-mono">
            <div className="text-red-700">{r.returnedQuantity} × {money(r.returnedUnitPrice, r.currencyCode ?? 'TRY')}</div>
            <div className="text-emerald-700">{r.givenQuantity} × {money(r.givenUnitPrice, r.currencyCode ?? 'TRY')}</div>
            {r.discountAmount > 0 ? (
              <div className="text-amber-700">iskonto {money(r.discountAmount, r.currencyCode ?? 'TRY')}</div>
            ) : null}
          </div>
        )
      },
      {
        key: 'serials',
        label: 'Seri No',
        accessorFn: (r) => `${r.returnedSerialNo ?? ''} ${r.givenSerialNo ?? ''}`.trim(),
        render: (_v, r) =>
          r.returnedSerialNo || r.givenSerialNo ? (
            <div className="text-[10.5px] font-mono leading-tight">
              {r.returnedSerialNo ? <div className="text-red-700">{r.returnedSerialNo}</div> : null}
              {r.givenSerialNo ? <div className="text-emerald-700">{r.givenSerialNo}</div> : null}
            </div>
          ) : (
            <span className="text-[10px] text-gray-300">—</span>
          )
      },
      {
        key: 'differenceAmount',
        label: 'Fark Tutarı',
        // Sıralama SAYIYA göre; işaretli ham değer taşınıyor ki borç/alacak yönü de sırayı belirlesin.
        accessorFn: (r) => Number(r.differenceAmount ?? 0),
        render: (_v, r) => (
          <span className={`font-mono font-bold whitespace-nowrap ${
            r.differenceAmount > 0 ? 'text-red-600' : r.differenceAmount < 0 ? 'text-emerald-600' : 'text-gray-400'
          }`}>
            {money(Math.abs(r.differenceAmount), r.currencyCode ?? 'TRY')}
          </span>
        )
      },
      {
        key: 'postedToLedger',
        label: 'Cari Ekstre',
        accessorFn: (r) => (r.postedToLedger ? (r.differenceAmount > 0 ? 'BORÇ İŞLENDİ' : 'ALACAK İŞLENDİ') : '—'),
        render: (_v, r) =>
          r.postedToLedger ? (
            <span className={`px-2 py-0.5 rounded text-[10px] font-bold border whitespace-nowrap ${
              r.differenceAmount > 0
                ? 'bg-red-50 border-red-200 text-red-800'
                : 'bg-emerald-50 border-emerald-200 text-emerald-800'
            }`}>
              {r.differenceAmount > 0 ? 'BORÇ İŞLENDİ' : 'ALACAK İŞLENDİ'}
            </span>
          ) : (
            <span className="text-[10px] text-gray-400 font-medium">—</span>
          )
      },
      {
        key: 'description',
        label: 'Açıklama',
        render: (_v, r) =>
          r.description ? (
            <span className="text-[11px] text-gray-700 truncate max-w-[220px] block" title={r.description}>
              {r.description}
            </span>
          ) : (
            <span className="text-[10px] text-gray-300">—</span>
          )
      },
      {
        key: 'createUser',
        label: 'İşlemi Yapan',
        render: (_v, r) => (
          <div className="leading-tight">
            <span className="px-2 py-0.5 rounded bg-gray-100 text-gray-700 text-[10.5px] font-medium whitespace-nowrap">
              {r.createUser ?? '—'}
            </span>
            {/* Düzenlenmiş kayıt işaretlenir: aynı satırın sonradan değiştiğini gösterir. */}
            {r.editUser ? (
              <div className="mt-0.5 text-[9.5px] text-amber-700 whitespace-nowrap" title={r.editTime ? new Date(r.editTime).toLocaleString('tr-TR') : undefined}>
                düzenledi: {r.editUser}
              </div>
            ) : null}
          </div>
        )
      }
    ]

    /*
      İŞLEM SÜTUNU — DÜZENLE + SİL (2026-09-02 kullanıcı kuralı).

      Kural: HERKES KENDİ İŞLEMİNİ, YALNIZCA BUGÜN düzenleyip silebilir. Karar sunucudan
      gelen `canModify` bayrağıyla veriliyor; burada kullanıcı adı karşılaştırmak ya da
      "bugün"ü tarayıcı saatiyle ölçmek kuralın ikinci bir kopyası olurdu ve sunucununkinden
      ayrışabilirdi.

      Hakkı olmayan satırda düğmeler GİZLENMEZ, PASİF gösterilir: kaybolan düğme
      "yetkim yok mu, ekran mı bozuk?" sorusunu doğuruyor; pasif düğme sebebini ipucunda
      söylüyor.

      Sütun, silme yetkisi olmayan kullanıcıda da çıkar — düzenleme ayrı bir haktır
      (`garantiDegisim`), silmeye bağlı değildir.
    */
    cols.push({
      key: 'actions',
      label: 'İşlem',
      sortable: false,
      render: (_v, r) => {
        const izinli = r.canModify !== false
        const sebep = izinli
          ? undefined
          : 'Yalnızca kendi işleminizi ve yalnızca bugün açılan kayıtları düzenleyip silebilirsiniz.'

        return (
          <div className="flex justify-end gap-1.5">
            <button
              type="button"
              disabled={!izinli}
              onClick={() => onEdit(r)}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-blue-200 text-blue-700 hover:bg-blue-50 text-[11px] font-bold transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
              title={sebep ?? 'Değişimi düzenle'}
            >
              <Pencil size={12} />
              Düzenle
            </button>

            {canDelete && (
              <button
                type="button"
                disabled={!izinli}
                onClick={() => onDelete(r)}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-red-200 text-red-700 hover:bg-red-50 text-[11px] font-bold transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                title={sebep ?? 'Değişimi ve stok hareketlerini sil'}
              >
                <Trash2 size={12} />
                Sil
              </button>
            )}
          </div>
        )
      }
    })

    return cols
  }, [canDelete, onDelete, onEdit])

  return (
    <div className="p-4 md:p-6 max-w-[1600px] mx-auto space-y-4">
      <NotificationPopup isOpen={Boolean(error)} variant="error" title="Hata" message={error ?? ''} onClose={() => setError(null)} />
      <NotificationPopup isOpen={Boolean(success)} variant="success" title="Başarılı" message={success ?? ''} onClose={() => setSuccess(null)} />

      {/* SAYFA BAŞLIĞI VE BİLGİ ŞERİDİ */}
      <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-red-50 text-red-600 border border-red-200 flex items-center justify-center shrink-0">
            <ShieldCheck size={22} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base md:text-lg font-bold text-gray-900">Garanti Değişim İşlemleri</h1>
              <span className="bg-red-50 text-red-700 border border-red-200 text-[10px] font-bold px-2 py-0.5 rounded">
                Faturasız İşlem
              </span>
            </div>
            <p className="text-xs text-gray-500 mt-0.5">
              Arızalı ürün girişi ve yeni ürün çıkışını tek adımda yönetin.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {warrantyWarehouseCode === 0 ? (
            <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-50 border border-amber-300 text-amber-800 text-xs font-semibold">
              <AlertTriangle size={14} />
              Garanti Deposu Tanımsız!
            </div>
          ) : (
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gray-50 border border-gray-200 text-xs text-gray-700">
              <span className="text-gray-500">Garanti Deposu:</span>
              <span className="font-bold text-gray-900">
                [{warrantyWarehouseCode}] {warrantyWarehouseName ?? 'Garanti Deposu'}
              </span>
            </div>
          )}
        </div>
      </div>

      {warrantyWarehouseCode === 0 && (
        <div className="flex items-start gap-3 p-3.5 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900 shadow-xs">
          <AlertTriangle size={16} className="shrink-0 text-amber-600 mt-0.5" />
          <div>
            <strong className="font-semibold">Garanti Deposu Seçilmemiş:</strong>
            <p className="mt-0.5 text-amber-800">
              Ayarlar → Garanti Deposu ekranından aktif bir garanti deposu belirlenene kadar sistem değişim kaydına izin vermemektedir.
            </p>
          </div>
        </div>
      )}

      {/* ANA FORM KARTI */}
      <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm space-y-4">
        {/* ÜST SATIR: CARİ, FATURA VE TARİH BİLGİLERİ */}
        <div className="bg-gray-50/80 border border-gray-200 rounded-lg p-3.5">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3.5 items-end">
            {/* Cari Seçici */}
            <div className="md:col-span-4 space-y-1">
              <label className="text-[11px] font-bold text-gray-700 uppercase tracking-wider flex items-center gap-1.5">
                <Building2 size={13} className="text-[#D84315]" />
                İlgili Cari / Müşteri *
              </label>
              <SearchableCariSelect
                value={customerCode}
                onChange={setCustomerCode}
                options={customers}
                remoteSearch={cariRemoteSearch}
                remoteLimit={CARI_SEARCH_LIMIT}
              />
            </div>

            {/* Fatura Seri & Sıra No */}
            <div className="md:col-span-5 space-y-1">
              <div className="flex items-center justify-between">
                <label className="text-[11px] font-bold text-gray-700 uppercase tracking-wider flex items-center gap-1.5">
                  <FileText size={13} className="text-indigo-600" />
                  Referans Fatura Bilgisi
                </label>
                {computedInvoiceNo && (
                  <span className="text-[10px] font-mono font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 px-1.5 py-0.5 rounded">
                    No: {computedInvoiceNo}
                  </span>
                )}
              </div>
              <div className="grid grid-cols-12 gap-2">
                <div className="col-span-4">
                  <input
                    value={invoiceSerie}
                    onChange={(e) => setInvoiceSerie(e.target.value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase())}
                    placeholder="Seri (A)"
                    className="w-full h-9 px-3 text-xs font-mono font-bold uppercase rounded-lg border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-500 transition"
                    data-no-capitalize="true"
                  />
                </div>
                <div className="col-span-8">
                  <input
                    value={invoiceNumber}
                    onChange={(e) => setInvoiceNumber(e.target.value.replace(/[^0-9]/g, '').slice(0, 14))}
                    placeholder="Sıra no (ör: 6326)"
                    className="w-full h-9 px-3 text-xs font-mono font-medium rounded-lg border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-500 transition"
                    data-no-capitalize="true"
                  />
                </div>
              </div>
            </div>

            {/* Tarih */}
            <div className="md:col-span-3 space-y-1">
              <label className="text-[11px] font-bold text-gray-700 uppercase tracking-wider flex items-center gap-1.5">
                <Calendar size={13} className="text-gray-500" />
                İşlem Tarihi
              </label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full h-9 px-3 text-xs font-medium rounded-lg border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-orange-200 focus:border-orange-500 transition"
              />
            </div>
          </div>
        </div>

        {/* ORTA BÖLÜM: GELEN (ARIZALI) vs VERİLEN (SAĞLAM) ÜRÜN KARTLARI */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* GELEN ÜRÜN (ARIZALI) */}
          <div className="rounded-lg border border-red-200 bg-red-50/20 p-4 space-y-3.5 shadow-xs relative">
            <div className="flex items-center justify-between pb-2.5 border-b border-red-100">
              <div className="flex items-center gap-2">
                <span className="w-5 h-5 rounded bg-red-600 text-white flex items-center justify-center text-xs font-bold">
                  ↓
                </span>
                <div>
                  <h3 className="text-xs font-bold text-red-950 uppercase tracking-wide">
                    Gelen Ürün (Arızalı)
                  </h3>
                  <span className="text-[10px] font-semibold text-red-700">
                    Hedef: Garanti Deposu [{warrantyWarehouseCode}]
                  </span>
                </div>
              </div>
              <span className="bg-red-100 text-red-800 text-[10px] font-bold px-2 py-0.5 rounded">
                Stok Girişi
              </span>
            </div>

            <ProductPicker
              label="Arızalı Ürünü Seçin"
              value={returned.stockCode}
              productName={returned.name}
              onPick={(p) => setReturned({ stockCode: p?.stockCode ?? '', name: p?.name ?? null })}
              variant="danger"
            />

            <div className="grid grid-cols-3 gap-2.5">
              <div className="space-y-1">
                <label className="text-[10.5px] font-bold text-gray-700 uppercase tracking-wider">Miktar</label>
                <input
                  value={returnedQty}
                  onChange={(e) => setReturnedQty(e.target.value)}
                  inputMode="decimal"
                  className="w-full h-9 px-2.5 text-xs font-bold rounded-lg border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-red-200 focus:border-red-500 text-center"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10.5px] font-bold text-gray-700 uppercase tracking-wider">
                  Birim Fiyat ({currencySymbol})
                </label>
                <input
                  value={returnedPrice}
                  onChange={(e) => setReturnedPrice(e.target.value)}
                  inputMode="decimal"
                  placeholder="Satıldığı fiyat"
                  className="w-full h-9 px-2.5 text-xs font-bold rounded-lg border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-red-200 focus:border-red-500 text-right"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10.5px] font-bold text-gray-700 uppercase tracking-wider">Seri No</label>
                <input
                  value={returnedSerial}
                  onChange={(e) => setReturnedSerial(e.target.value)}
                  placeholder="Opsiyonel"
                  className="w-full h-9 px-2.5 text-xs font-mono rounded-lg border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-red-200 focus:border-red-500"
                  data-no-capitalize="true"
                />
              </div>
            </div>

            {/* Gelen Tutar Çubuğu */}
            <div className="flex items-center justify-between p-2.5 rounded-lg bg-red-50 border border-red-200 text-red-950">
              <span className="text-xs font-semibold">Arızalı Ürün Bedeli:</span>
              <span className="text-sm font-bold font-mono">
                {money(returnedTotal, currencyCode)}
              </span>
            </div>
          </div>

          {/* VERİLEN ÜRÜN (SAĞLAM) */}
          <div className="rounded-lg border border-emerald-200 bg-emerald-50/20 p-4 space-y-3.5 shadow-xs relative">
            <div className="flex items-center justify-between pb-2.5 border-b border-emerald-100">
              <div className="flex items-center gap-2">
                <span className="w-5 h-5 rounded bg-emerald-600 text-white flex items-center justify-center text-xs font-bold">
                  ↑
                </span>
                <div>
                  <h3 className="text-xs font-bold text-emerald-950 uppercase tracking-wide">
                    Verilen Ürün (Sağlam)
                  </h3>
                  <span className="text-[10px] font-semibold text-emerald-700">
                    Kaynak: Seçilen Çıkış Deposu
                  </span>
                </div>
              </div>
              <span className="bg-emerald-100 text-emerald-800 text-[10px] font-bold px-2 py-0.5 rounded">
                Stok Çıkışı
              </span>
            </div>

            <ProductPicker
              label="Verilen Ürünü Seçin"
              value={given.stockCode}
              productName={given.name}
              onPick={(p) => setGiven({ stockCode: p?.stockCode ?? '', name: p?.name ?? null })}
              variant="success"
            />

            <div className="grid grid-cols-3 gap-2.5">
              <div className="space-y-1">
                <label className="text-[10.5px] font-bold text-gray-700 uppercase tracking-wider">Miktar</label>
                <input
                  value={givenQty}
                  onChange={(e) => setGivenQty(e.target.value)}
                  inputMode="decimal"
                  className="w-full h-9 px-2.5 text-xs font-bold rounded-lg border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-200 focus:border-emerald-500 text-center"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10.5px] font-bold text-gray-700 uppercase tracking-wider">
                  Birim Fiyat ({currencySymbol})
                </label>
                <input
                  value={givenPrice}
                  onChange={(e) => setGivenPrice(e.target.value)}
                  inputMode="decimal"
                  placeholder="Liste fiyatı"
                  className="w-full h-9 px-2.5 text-xs font-bold rounded-lg border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-200 focus:border-emerald-500 text-right"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10.5px] font-bold text-gray-700 uppercase tracking-wider">Seri No</label>
                <input
                  value={givenSerial}
                  onChange={(e) => setGivenSerial(e.target.value)}
                  placeholder="Opsiyonel"
                  className="w-full h-9 px-2.5 text-xs font-mono rounded-lg border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-200 focus:border-emerald-500"
                  data-no-capitalize="true"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
              <div className="space-y-1">
                <label className="text-[10.5px] font-bold text-gray-700 uppercase tracking-wider">
                  İndirim Tutarı ({currencySymbol})
                </label>
                <input
                  value={discount}
                  onChange={(e) => setDiscount(e.target.value)}
                  inputMode="decimal"
                  placeholder="0,00"
                  className="w-full h-9 px-2.5 text-xs font-bold rounded-lg border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-200 focus:border-emerald-500 text-right"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10.5px] font-bold text-gray-700 uppercase tracking-wider">Çıkış Deposu *</label>
                <select
                  value={outWarehouseCode}
                  onChange={(e) => setOutWarehouseCode(String(e.target.value))}
                  className="w-full h-9 px-2.5 text-xs font-semibold rounded-lg border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-200 focus:border-emerald-500 cursor-pointer"
                >
                  <option value="">Depo Seçiniz...</option>
                  {warehouses.map((w) => (
                    <option key={String(w.warehouseCode)} value={String(w.warehouseCode)}>
                      [{w.warehouseCode}] {w.name ?? ''}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Para Birimi & Kur Satırı */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 pt-1 border-t border-emerald-100">
              <div className="space-y-1">
                <label className="text-[10.5px] font-bold text-gray-700 uppercase tracking-wider">Para Birimi</label>
                <select
                  value={currencyTypeId}
                  onChange={(e) => setCurrencyTypeId(String(e.target.value))}
                  className="w-full h-9 px-2.5 text-xs font-semibold rounded-lg border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-200 focus:border-emerald-500 cursor-pointer"
                >
                  {WARRANTY_EXCHANGE_CURRENCIES.map((c) => (
                    <option key={c.value} value={String(c.value)}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>

              {!isTryForm && (
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="text-[10.5px] font-bold text-gray-700 uppercase tracking-wider">
                      Kur (1 {currencyCode} = ? ₺)
                    </label>
                    {rateLoading && <span className="text-[10px] text-orange-600 font-bold">Yükleniyor…</span>}
                  </div>
                  <input
                    value={currencyRate}
                    onChange={(e) => setCurrencyRate(e.target.value)}
                    inputMode="decimal"
                    placeholder={rateLoading ? 'Günün kuru alınıyor...' : 'Günün kuru'}
                    className="w-full h-9 px-2.5 text-xs font-mono font-bold rounded-lg border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-200 focus:border-emerald-500 text-right"
                  />
                </div>
              )}
            </div>

            {/* Verilen Net Tutar Çubuğu */}
            <div className="flex items-center justify-between p-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-950">
              <span className="text-xs font-semibold">Sağlam Ürün Net Tutarı:</span>
              <span className="text-sm font-bold font-mono">
                {money(givenTotal, currencyCode)}
              </span>
            </div>
          </div>
        </div>

        {/* ALT FİNANSAL ÖZET & CARİ EKSTRE ENTEGRASYONU */}
        <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="bg-red-50/60 border border-red-200 rounded-lg p-3">
              <div className="text-[11px] font-bold text-red-800 uppercase tracking-wider flex items-center gap-1.5">
                <TrendingDown size={14} className="text-red-600" />
                Arızalı Ürün Değeri
              </div>
              <div className="text-base md:text-lg font-bold font-mono text-red-700 mt-1">
                {money(returnedTotal, currencyCode)}
              </div>
            </div>

            <div className="bg-emerald-50/60 border border-emerald-200 rounded-lg p-3">
              <div className="text-[11px] font-bold text-emerald-800 uppercase tracking-wider flex items-center gap-1.5">
                <TrendingUp size={14} className="text-emerald-600" />
                Verilen Ürün Değeri
              </div>
              <div className="text-base md:text-lg font-bold font-mono text-emerald-700 mt-1">
                {money(givenTotal, currencyCode)}
              </div>
            </div>

            <div className={`border rounded-lg p-3 transition ${
              difference > 0
                ? 'bg-amber-50/80 border-amber-300 text-amber-900'
                : difference < 0
                ? 'bg-emerald-50/80 border-emerald-300 text-emerald-900'
                : 'bg-gray-50 border-gray-200 text-gray-800'
            }`}>
              <div className="text-[11px] font-bold uppercase tracking-wider flex items-center justify-between">
                <span className="text-gray-700">Net Değişim Farkı</span>
                {difference > 0 ? (
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-300">
                    Müşteri Borçlu
                  </span>
                ) : difference < 0 ? (
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 border border-emerald-300">
                    Müşteri Alacaklı
                  </span>
                ) : (
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-gray-200 text-gray-700">
                    Fark Yok (0)
                  </span>
                )}
              </div>
              <div className="text-base md:text-lg font-bold font-mono mt-1 text-gray-900">
                {money(Math.abs(difference), currencyCode)}
              </div>
            </div>
          </div>

          {/* Ekstre Entegrasyonu Checkbox & Açıklama */}
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-3.5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <label className="flex items-center gap-2 text-xs font-semibold text-gray-800 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={postToLedger}
                  disabled={difference === 0}
                  onChange={(e) => setPostToLedger(e.target.checked)}
                  className="w-4 h-4 rounded text-orange-600 accent-orange-600 cursor-pointer"
                />
                <span>Farkı Müşteri Cari Ekstresine Otomatik İşle</span>
              </label>

              <div className="text-[11px] text-gray-500 flex items-center gap-1.5">
                <Info size={13} className="text-gray-400 shrink-0" />
                {postToLedger ? (
                  <span className="text-amber-800 font-semibold">
                    {difference > 0 ? 'Cariye BORÇ kaydı yazılacaktır.' : 'Cariye ALACAK kaydı yazılacaktır.'}
                  </span>
                ) : (
                  <span>İşaretlenmezse fark hediye / sıfır bakiye sayılır.</span>
                )}
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-gray-700">İşlem Açıklaması</label>
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Örn: Garanti kapsamında birebir ürün değişimi yapıldı..."
                className="w-full h-9 px-3 text-xs rounded-lg border border-gray-300 bg-white text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-200 focus:border-orange-500 transition"
              />
            </div>
          </div>

          {/*
            DÜZENLEME ŞERİDİ. Aynı form iki iş yapıyor; hangi kipte olunduğu ekranda
            açıkça yazmazsa kullanıcı yeni kayıt açtığını sanıp mevcut kaydı ezer.
          */}
          {editingId !== null && (
            <div className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200">
              <div className="flex items-center gap-2 text-[11.5px] text-amber-900 font-semibold">
                <Pencil size={14} className="text-amber-700 shrink-0" />
                <span>
                  Düzenleme kipi — {rows.find((r) => r.id === editingId)?.exchangeNo ?? ''} numaralı kayıt
                  güncellenecek. Stok hareketleri ve varsa ekstre satırı yeniden yazılır.
                </span>
              </div>
              <button
                type="button"
                onClick={resetForm}
                className="shrink-0 px-3 py-1 rounded border border-amber-300 text-amber-900 hover:bg-amber-100 text-[11px] font-bold transition cursor-pointer"
              >
                Vazgeç
              </button>
            </div>
          )}

          {/* KAYDET BUTONU */}
          <div className="flex items-center justify-between pt-1">
            <div className="text-xs">
              {!canSave ? (
                <span className="text-amber-700 font-semibold flex items-center gap-1">
                  <AlertTriangle size={14} className="text-amber-600 shrink-0" />
                  Kayıt için Cari, Depo ve her iki Ürün seçimini tamamlayınız.
                </span>
              ) : (
                <span className="text-emerald-700 font-semibold flex items-center gap-1">
                  <CheckCircle2 size={14} className="text-emerald-600 shrink-0" />
                  Tüm zorunlu alanlar dolduruldu.
                </span>
              )}
            </div>

            <button
              type="button"
              onClick={onSave}
              disabled={!canSave || saving}
              className={`inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-white text-xs font-bold uppercase tracking-wider shadow-sm transition active:scale-98 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none ${
                editingId !== null ? 'bg-amber-600 hover:bg-amber-700' : 'bg-emerald-600 hover:bg-emerald-700'
              }`}
            >
              <Save size={15} />
              {saving
                ? 'Kaydediliyor…'
                : editingId !== null
                  ? 'Değişikliği Kaydet'
                  : 'Garanti Değişimini Tamamla'}
            </button>
          </div>
        </div>
      </div>

      {/* SON GARANTİ DEĞİŞİMLERİ GEÇMİŞİ */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden shadow-sm">
        <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="text-xs font-bold text-gray-800 uppercase tracking-wider">
              Son Garanti Değişim Hareketleri
            </h2>
            <span className="bg-gray-200 text-gray-700 text-[10px] font-bold px-2 py-0.5 rounded">
              {rows.length} Kayıt
            </span>
          </div>
          <button
            type="button"
            onClick={() => loadList()}
            className="text-xs font-semibold text-gray-600 hover:text-gray-900 transition flex items-center gap-1 cursor-pointer"
          >
            <RefreshCw size={12} className={listLoading ? 'animate-spin' : ''} />
            Yenile
          </button>
        </div>

        <Table<WarrantyExchangeRow>
          onRefresh={() => void loadList()}
          columns={columns}
          data={rows}
          rowKey={(r) => String(r.id)}
          loading={listLoading}
        />
      </div>
    </div>
  )
}
