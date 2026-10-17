import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { fetchAllPages } from '../lib/fetchAllPages'
import { normalizeDiscountType } from '../utils/discountType'
import { ChevronDown, ChevronRight, Coins, Eye, FileText, ListFilter, Printer, Trash2, Wallet, Receipt, ShieldCheck, Sparkles, Building2, Package, Layers, CheckCircle2, AlertCircle, RefreshCw } from 'lucide-react'
import { useOutletContext } from 'react-router-dom'
import FormInput from '../components/forms/FormInput'
import ColumnFilterSearchBar from '../components/table/ColumnFilterSearchBar'
import Modal from '../components/Modal'
import PageHeader from '../components/PageHeader'
import { deleteProformaFromOffer, fetchProformaOffers, transferProformaToInvoice, updateProformaHeader, type CustomerOfferListItemDto } from '../api/customerOffers'
import {
  deleteCariProformaFromOffer,
  fetchCariProformaOffers,
  transferCariProformaToInvoice,
  updateCariProformaHeader,
  type CariOfferListItemDto
} from '../api/cariOffers'
import { fetchCustomersDropdown, type CustomerDto } from '../api/customers'
import { fetchAuthorizedWarehousesDropdown, fetchAuthorizedStockBalances, pickDefaultWarehouseCode, type WarehouseDropdownItem, type AuthorizedStockBalancesResponse } from '../api/warehouses'
import { printProforma } from '../utils/proformaPrint'
import { fetchLatestFxRate } from '../api/fx'
import { AppDataTable, type DataTableRowAction } from '../components/data-table'
import type { ColumnDef } from '@tanstack/react-table'

function getCurrencySymbol(code: any) {
  const c = String(code ?? '').trim()
  if (c === '0' || c === '1' || c === 'TRY' || c === 'TL' || !c) return '₺'
  if (c === '3' || c === 'USD') return '$'
  if (c === '2' || c === 'EUR') return '€'
  if (c === '4' || c === 'GBP') return '£'
  return c
}

function getCurrencyCode(code: any): 'TRY' | 'USD' | 'EUR' | 'GBP' {
  const c = String(code ?? '').trim().toUpperCase()
  if (c === '3' || c === 'USD') return 'USD'
  if (c === '2' || c === 'EUR') return 'EUR'
  if (c === '4' || c === 'GBP') return 'GBP'
  return 'TRY'
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
    // İNDİRİM TİPİ METİN GELİYOR + TUTAR İNDİRİMİ ADET BAŞINA (2026-08-22).
    //
    // API enum'ları metin olarak gönderiyor ("Amount"/"Percentage"); buradaki sayı ve
    // küçük harf karşılaştırmalarının ikisi de tutmuyor, indirim SESSİZCE 0 hesaplanıyordu.
    // Proforma listesinde her satırın indirimi 0,00 görünmesinin sebebi buydu.
    // Ayrıca tutar indirimi artık satırın tamamına değil HER ÜRÜNE uygulanıyor.
    if (normalizeDiscountType((l as any).discountType) === 'amount') {
      const tryDiscountValue = dv * sourceRate * qty
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
  targetAccountType?: 'FATURA' | 'ACIK' | 'ASKERIYE' | string | null
  customerInvoiceType?: string | null
  priceGroupCode?: number | null
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

export default function ProformaPage() {
  const { isSuperAdmin, allowedKeys, roleCode } = useOutletContext<LayoutContext>()
  /** Depo adedinde tam rakam: Satış Faturası'ndaki "Depo Stok Bilgisi" kuralı (2026-09-17). */
  const tamStokGorsun = Boolean(isSuperAdmin) || Boolean(allowedKeys?.has('invoice/satisFaturaDepoBakiyeGorsun'))

  const canPrint =
    Boolean(isSuperAdmin) ||
    (Boolean(allowedKeys?.has('invoice/proforma')) && Boolean(allowedKeys?.has('invoice/proformaBasim')))

  const canDelete =
    Boolean(isSuperAdmin) ||
    (Boolean(allowedKeys?.has('invoice/proforma')) && Boolean(allowedKeys?.has('invoice/proformaSil')))

  const isBayi = String(roleCode ?? '').trim().toUpperCase() === 'BAYI'
  const isSsa = String(roleCode ?? '').trim().toUpperCase() === 'SSA'
  const canSelectWarehouse = Boolean(isSuperAdmin) || isSsa
  const canTransferToInvoice =
    !isBayi &&
    (Boolean(isSuperAdmin) ||
      (Boolean(allowedKeys?.has('invoice/proforma')) && Boolean(allowedKeys?.has('invoice/proformaFaturaDokumeAktar'))))

  const isAbortError = (e: any) => {
    const name = String(e?.name ?? '')
    const msg = String(e?.message ?? '')
    if (name === 'AbortError') return true
    if (msg.toLowerCase().includes('aborted')) return true
    return false
  }

  const activeSource: ProformaSource = 'customer'
  const transferOfferSource: ProformaSource = 'customer'

  const openTransferToInvoice = (id: number, source: ProformaSource) => {
    if (!canTransferToInvoice) {
      setError('Satış faturasına aktarma yetkiniz yok')
      return
    }
    const safeId = Number(id)
    if (!Number.isFinite(safeId) || safeId <= 0) {
      setError('Geçersiz id')
      return
    }

    const row = rows.find((x) => x.id === safeId && x.source === source)
    const cCode = String(row?.customerCode ?? '').trim()
    let initialType: 'ACIK' | 'FATURA' | 'ASKERIYE' = 'FATURA'
    
    if (row?.targetAccountType === 'ACIK' || row?.targetAccountType === 'ASKERIYE' || row?.targetAccountType === 'FATURA') {
      initialType = row.targetAccountType as any
    } else if (cCode.endsWith('-2')) {
      initialType = 'ACIK'
    } else if (cCode.endsWith('-3')) {
      initialType = 'ASKERIYE'
    } else if (cCode.endsWith('-1')) {
      initialType = 'FATURA'
    } else {
      initialType = 'FATURA'
    }

    setTransferOfferId(safeId)
    setTransferAccountType(initialType)
    setTransferSerie('A')
    setTransferNumber('')

    const varsayilanDepo = pickDefaultWarehouseCode(warehouses)
    const defaultWh = varsayilanDepo != null ? String(varsayilanDepo) : ''
    setTransferWarehouseCode(defaultWh)

    const initialLineWh: Record<number, string> = {}
    if (row?.lines) {
      row.lines.forEach((l) => {
        initialLineWh[l.id] = defaultWh
      })
    }
    setTransferLineWarehouseById(initialLineWh)
    setTransferError(null)
    setTransferOpen(true)
  }

  const submitTransferToInvoice = async () => {
    if (!transferOfferId || !transferRow) return

    /*
      ELLE FATURA NO: RESMİ FATURA (-1) VE MUAF/ASKERİYE (-3) — 2026-08-29.

      Muaf hesap eskiden açık cari ile aynı kefedeydi ve numarayı sistem üretiyordu. Askeri
      birlik resmi numaralı belge istediği için personel numara girebilmek adına işi -3 yerine
      -1 hesabına aktarıyordu; denetimdeki "-1 hesabında KDV'siz fatura" bulgusu buradan
      doğmuştu. Kapı açıldı, kaçak yola gerek kalmadı.

      Açık cari (-2) DEĞİŞMEDİ: orada numara otomatik üretilir.
    */
    const elleNumaraGerekir = transferAccountType === 'FATURA' || transferAccountType === 'ASKERIYE'
    const isFatura = elleNumaraGerekir
    const serie = String(transferSerie ?? '').trim().toUpperCase()
    const numberStr = String(transferNumber ?? '').trim()

    if (isFatura) {
      if (serie.length < 1 || serie.length > 2) {
        setTransferError('Seri No 1 veya 2 karakter olmalıdır (Örn: A)')
        return
      }
      if (!/^\d{1,14}$/.test(numberStr)) {
        setTransferError('Fatura No en fazla 14 haneli ve sadece sayısal olmalıdır')
        return
      }
    }

    const invoiceNumber = isFatura ? Number(numberStr) : null
    const whRaw = String(transferWarehouseCode ?? '').trim()
    const parsedHeaderWh = Number(whRaw) || null

    const linePayload = (transferRow.lines ?? []).map((l) => {
      const lineWhRaw = String(transferLineWarehouseById[l.id] ?? '').trim() || whRaw
      return {
        lineId: l.id,
        warehouseCode: Number(lineWhRaw) || (parsedHeaderWh ?? 0)
      }
    })

    const missingWh = linePayload.some((x) => !(x.warehouseCode > 0))
    if (missingWh && !parsedHeaderWh) {
      setTransferError('Lütfen tüm ürünler için geçerli bir çıkış deposu seçiniz')
      return
    }

    // Belgenin para biriminin kuru boş bırakılmışsa aktarma: kutuda görünenle faturaya
    // yazılan kur ayrışmasın.
    if (transferCurrencyCode !== 'TRY') {
      const typedRate = Number(String(fxRatesInput[transferCurrencyCode] ?? '').replace(',', '.'))
      if (!(typedRate > 0)) {
        setTransferError(`${transferCurrencyCode} kuru geçerli değil. Lütfen kur alanına 0'dan büyük bir değer girin.`)
        return
      }
    }

    try {
      setTransferBusy(true)
      setTransferError(null)

      await transferProformaToInvoice(transferOfferId, {
        targetAccountType: transferAccountType,
        invoiceSerie: isFatura ? serie : null,
        invoiceNumber: invoiceNumber,
        warehouseCode: parsedHeaderWh,
        lineWarehouses: linePayload,
        // Ekranda görünen kur ne ise fatura o kurla kesilir; TCMB'den farklıysa sunucu
        // fatura kur kaynağını "Manuel" damgalar.
        usdRate: Number(fxRates.USD) > 0 ? Number(fxRates.USD) : null,
        eurRate: Number(fxRates.EUR) > 0 ? Number(fxRates.EUR) : null,
        gbpRate: Number(fxRates.GBP) > 0 ? Number(fxRates.GBP) : null
      })

      setTransferOpen(false)
      setTransferOfferId(null)
      await load()
    } catch (e: any) {
      setTransferError(String(e?.message ?? 'Satış faturasına aktarılamadı'))
    } finally {
      setTransferBusy(false)
    }
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

  const [transferOpen, setTransferOpen] = useState(false)
  const [transferOfferId, setTransferOfferId] = useState<number | null>(null)
  const [transferAccountType, setTransferAccountType] = useState<'ACIK' | 'FATURA' | 'ASKERIYE'>('ACIK')
  const [transferSerie, setTransferSerie] = useState('')
  const [transferNumber, setTransferNumber] = useState('')
  const [transferBusy, setTransferBusy] = useState(false)
  const [transferError, setTransferError] = useState<string | null>(null)
  const [transferWarehouseCode, setTransferWarehouseCode] = useState<string>('')
  const [transferLineWarehouseById, setTransferLineWarehouseById] = useState<Record<number, string>>({})

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

  /**
   * KUR ÇUBUĞU (satış faturasındaki ile aynı davranış).
   *
   * Kurlar TCMB'den otomatik gelir ama kullanıcı elle değiştirebilir; ekranda görünen kur
   * hem listedeki/penceredeki TL karşılıklarını hem de aktarımda kesilecek faturanın
   * `ExchangeRate` alanını belirler (sunucuya `usdRate/eurRate/gbpRate` olarak gider).
   */
  const [fxRatesLoading, setFxRatesLoading] = useState(false)
  const [fxRatesInput, setFxRatesInput] = useState<Record<'USD' | 'EUR' | 'GBP', string>>({ USD: '', EUR: '', GBP: '' })

  const refreshFxRates = useCallback(async () => {
    setFxRatesLoading(true)
    try {
      const [usd, eur, gbp] = await Promise.all([
        fetchLatestFxRate('USD').catch(() => 1),
        fetchLatestFxRate('EUR').catch(() => 1),
        fetchLatestFxRate('GBP').catch(() => 1)
      ])
      const next = {
        USD: Number(usd) > 0 ? Number(usd) : 1,
        EUR: Number(eur) > 0 ? Number(eur) : 1,
        GBP: Number(gbp) > 0 ? Number(gbp) : 1
      }
      setFxRates((prev) => ({
        ...prev,
        'USD': next.USD,
        '3': next.USD,
        'EUR': next.EUR,
        '2': next.EUR,
        'GBP': next.GBP,
        '4': next.GBP
      }))
      setFxRatesInput({
        USD: String(next.USD),
        EUR: String(next.EUR),
        GBP: String(next.GBP)
      })
    } finally {
      setFxRatesLoading(false)
    }
  }, [])

  useEffect(() => {
    void refreshFxRates()
  }, [refreshFxRates])

  const handleRateInputChange = (currency: 'USD' | 'EUR' | 'GBP', value: string) => {
    setFxRatesInput((prev) => ({ ...prev, [currency]: value }))
    const num = Number(String(value).replace(',', '.'))
    if (num > 0) {
      const alias = currency === 'USD' ? '3' : currency === 'EUR' ? '2' : '4'
      setFxRates((prev) => ({ ...prev, [currency]: num, [alias]: num }))
    }
  }
  const [warehouses, setWarehouses] = useState<WarehouseDropdownItem[]>([])
  const [warehousesLoading, setWarehousesLoading] = useState(false)
  const [balances, setBalances] = useState<AuthorizedStockBalancesResponse | null>(null)
  const [balancesLoading, setBalancesLoading] = useState(false)

  const transferRow = useMemo(() => {
    if (!transferOfferId) return null
    return rows.find((x) => x.id === transferOfferId && x.source === transferOfferSource) || null
  }, [rows, transferOfferId, transferOfferSource])

  /**
   * Faturanın yazılacağı ALT HESAP kodu.
   *
   * Cari kartı üç alt hesapla birlikte açılır ve fatura ana koda DEĞİL bu alt hesaplardan
   * birine yazılır: `-1` resmi fatura, `-2` açık cari, `-3` muaf/askeriye. Kodu sunucu
   * çözüyor (`CustomerAccountService.ResolveTargetInvoiceCustomerCodeAsync`, eksikse üçünü
   * de oluşturur); burada yalnızca kullanıcıya HANGİ hesaba gideceği gösteriliyor.
   */
  const transferMainCustomerCode = useMemo(() => {
    return String(transferRow?.customerCode ?? '').trim().replace(/-[123]$/, '')
  }, [transferRow])

  /** Aktarılacak belgenin para birimi: başlıkta yoksa kalemlerden çözülür. */
  const transferCurrencyCode = useMemo(() => {
    if (!transferRow) return 'TRY' as const
    const headerCur = getCurrencyCode(transferRow.currencyCode ?? (transferRow as any).currencyTypeId)
    if (headerCur !== 'TRY') return headerCur
    return getCurrencyCode(getInvoiceCurrency(transferRow.lines ?? []))
  }, [transferRow])

  const transferAppliedRate = useMemo(() => {
    if (transferCurrencyCode === 'TRY') return 1
    const r = Number(fxRates[transferCurrencyCode] ?? 0)
    return r > 0 ? r : 1
  }, [transferCurrencyCode, fxRates])

  const transferTargetCustomerCode = useMemo(() => {
    if (!transferMainCustomerCode) return ''
    const suffix = transferAccountType === 'FATURA' ? '-1' : transferAccountType === 'ACIK' ? '-2' : '-3'
    return transferMainCustomerCode + suffix
  }, [transferMainCustomerCode, transferAccountType])

  const selectedStockCodes = useMemo(() => {
    if (!transferRow) return []
    return (transferRow.lines ?? [])
      .map((x) => String(x.stockCode ?? '').trim())
      .filter(Boolean)
      .filter((x, idx, arr) => arr.findIndex((y) => y.toLowerCase() === x.toLowerCase()) === idx)
  }, [transferRow])

  const balanceByWarehouseAndStockCode = useMemo(() => {
    const map = new Map<number, Map<string, number>>()
      ; (balances?.items ?? []).forEach((it) => {
        const sc = String(it?.stockCode ?? '').trim()
        if (!sc) return
          ; (it?.balances ?? []).forEach((b) => {
            const wc = Number(b?.warehouseCode)
            if (!Number.isFinite(wc) || wc <= 0) return
            if (!map.has(wc)) map.set(wc, new Map())
            map.get(wc)!.set(sc.toLowerCase(), Number(b?.balance) || 0)
          })
      })
    return map
  }, [balances])

  useEffect(() => {
    const ac = new AbortController()
    void (async () => {
      try {
        setWarehousesLoading(true)
        const list = await fetchAuthorizedWarehousesDropdown({ signal: ac.signal })
        // Sunucu sırası korunur: varsayılan depo en başta gelir.
        setWarehouses(list ?? [])
      } catch {
        setWarehouses([])
      } finally {
        setWarehousesLoading(false)
      }
    })()
    return () => ac.abort()
  }, [])

  useEffect(() => {
    if (transferOpen && warehouses.length === 1 && !transferWarehouseCode) {
      setTransferWarehouseCode(String(warehouses[0].warehouseCode))
    }
  }, [transferOpen, warehouses, transferWarehouseCode])

  useEffect(() => {
    const ac = new AbortController()
    void (async () => {
      try {
        if (selectedStockCodes.length === 0) {
          setBalances(null)
          return
        }
        setBalancesLoading(true)
        const res = await fetchAuthorizedStockBalances(selectedStockCodes, { signal: ac.signal })
        setBalances(res)
      } catch {
        setBalances(null)
      } finally {
        setBalancesLoading(false)
      }
    })()
    return () => ac.abort()
  }, [selectedStockCodes])


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

  const mapCustomerRow = (x: CustomerOfferListItemDto): ProformaRow => {
    const yyyyMmDd = String(x.date ?? '').slice(0, 10)
    const proformaCurrency = (() => {
      const cid = Number((x as any).currencyTypeId ?? (x as any).CurrencyTypeId ?? 0);
      return cid === 2 ? 'EUR' : cid === 3 ? 'USD' : cid === 4 ? 'GBP' : 'TRY';
    })()
    return {
      id: Number(x.id),
      source: 'customer',
      date: yyyyMmDd,
      documentNo: String(x.documentNo ?? ''),
      customerCode: String((x as any).customerCode ?? '').trim() || undefined,
      customerName: String(x.customerName ?? ''),
      targetAccountType: x.targetAccountType ?? null,
      customerInvoiceType: x.customerInvoiceType ?? null,
      priceGroupCode: x.priceGroupCode ?? null,
      description: String(x.description ?? ''),
      invoiceId: (x as any)?.invoiceId ?? null,
      invoiceNo: (x as any)?.invoiceNo ?? null,
      vatExempt: Boolean(x.vatExempt),
      subtotal: Number(x.subtotal ?? 0),
      discountTotal: Number(x.discountTotal ?? 0),
      netTotal: Number(x.netTotal ?? 0),
      vatTotal: Number(x.vatTotal ?? 0),
      grandTotal: Number(x.grandTotal ?? 0),
      createUser: String(x.createUser ?? ''),
      currencyCode: proformaCurrency,
      lines: (x.lines ?? []).map((l) => ({
        id: Number(l.id),
        stockCode: String(l.stockCode ?? ''),
        stockName: String(((l as any).stockName ?? l.description ?? '') as any),
        quantity: Number(l.quantity ?? 0),
        unitPrice: Number(l.unitPrice ?? 0),
        vatRate: Number(l.vatRate ?? 0),
        // İNDİRİM ALANLARI TAŞINMAK ZORUNDA (2026-08-22).
        //
        // Bu eşleme `discountType`/`discountValue`'yu atıyordu. Uç ikisini de gönderiyor ve
        // veritabanında doğru duruyor, ama satırlar hesap fonksiyonuna ulaşmadan bu alanlar
        // siliniyordu; sonuçta proforma listesinde İNDİRİM sütunu HER satırda 0,00 çıkıyordu —
        // tutar indiriminde de oran indiriminde de. Ara Toplam doğru görünmesi yanıltıcıydı:
        // miktar ve fiyat taşındığı için o hesap tutuyordu.
        discountType: (l as any).discountType,
        discountValue: Number((l as any).discountValue ?? 0),
        currencyCode: proformaCurrency
      }))
    }
  }

  const mapCariRow = (x: CariOfferListItemDto): ProformaRow => {
    const yyyyMmDd = String((x as any).date ?? '').slice(0, 10)
    const proformaCurrency = (() => {
      const cid = Number((x as any).currencyTypeId ?? (x as any).CurrencyTypeId ?? 0);
      return cid === 2 ? 'EUR' : cid === 3 ? 'USD' : cid === 4 ? 'GBP' : 'TRY';
    })()
    return {
      id: Number((x as any).id),
      source: 'cari',
      date: yyyyMmDd,
      documentNo: String((x as any).documentNo ?? ''),
      customerCode: String((x as any).customerCode ?? '').trim() || undefined,
      customerName: String((x as any).customerName ?? ''),
      targetAccountType: x.targetAccountType ?? null,
      customerInvoiceType: x.customerInvoiceType ?? null,
      priceGroupCode: x.priceGroupCode ?? null,
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
      lines: (((x as any).lines ?? []) as any[]).map((l: any) => ({
        id: Number(l.id),
        stockCode: String(l.stockCode ?? ''),
        stockName: String((l as any).stockName ?? l.description ?? ''),
        quantity: Number(l.quantity ?? 0),
        unitPrice: Number(l.unitPrice ?? 0),
        vatRate: Number(l.vatRate ?? 0),
        // İNDİRİM ALANLARI TAŞINMAK ZORUNDA (2026-08-22).
        //
        // Bu eşleme `discountType`/`discountValue`'yu atıyordu. Uç ikisini de gönderiyor ve
        // veritabanında doğru duruyor, ama satırlar hesap fonksiyonuna ulaşmadan bu alanlar
        // siliniyordu; sonuçta proforma listesinde İNDİRİM sütunu HER satırda 0,00 çıkıyordu —
        // tutar indiriminde de oran indiriminde de. Ara Toplam doğru görünmesi yanıltıcıydı:
        // miktar ve fiyat taşındığı için o hesap tutuyordu.
        discountType: (l as any).discountType,
        discountValue: Number((l as any).discountValue ?? 0),
        currencyCode: proformaCurrency
      }))
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
      await deleteProformaFromOffer(safeId)
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
      await fetchAllPages((skip, take) => fetchProformaOffers({ take, skip, signal }), {
        key: (x) => String(x.id),
        onPage: (all, first) => {
          setRows(all.map(mapCustomerRow))
          if (first) setLoading(false)
        }
      })
    } catch (e: any) {
      if (isAbortError(e)) return
      setError(String(e?.message ?? 'Proformalar alınamadı'))
      setRows([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const ac = new AbortController()
    void load(ac.signal)
    return () => ac.abort()
  }, [activeSource])

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

  const [pageIndex, setPageIndex] = useState(0)
  const [pageSize, setPageSize] = useState(20)
  const [columnFiltersState, setColumnFiltersState] = useState<Record<string, any>>({})

  const proformaColumns = useMemo<ColumnDef<ProformaRow, any>[]>(
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
        meta: {
          filterType: 'select',
          filterPlaceholder: 'KDV İstisna...',
          filterOptions: [
            { value: 'evet', label: 'Evet' },
            { value: 'hayır', label: 'Hayır' }
          ]
        },
        cell: ({ getValue }) => (
          <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold ${getValue() ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-700'}`}>
            {getValue() ? 'Evet' : 'Hayır'}
          </span>
        )
      },
      {
        id: 'currency',
        accessorFn: (row) => {
          const invCurrency = getInvoiceCurrency(row.lines)
          return invCurrency === '3' || invCurrency === 'USD' ? 'USD' : invCurrency === '2' || invCurrency === 'EUR' ? 'EUR' : invCurrency === '4' || invCurrency === 'GBP' ? 'GBP' : 'TRY'
        },
        header: 'Döviz',
        meta: { filterType: 'text' },
        cell: ({ getValue }) => {
          return <span className="font-semibold text-sky-700">{getValue()}</span>
        }
      },
      {
        id: 'subtotal',
        accessorFn: (row) => {
          const invCurrency = getInvoiceCurrency(row.lines)
          // KAYITLI DEĞER ÖNCELİKLİ (2026-08-22).
          //
          // Bu sütunlar satırlardan yeniden hesaplanıyordu ve hesap, satır eşlemesinde
          // indirim alanları düştüğü için İNDİRİM'i her zaman 0 veriyordu. Oysa sunucu
          // toplamları zaten hesaplayıp kaydediyor ve uç bunları gönderiyor
          // (`subtotal`, `discountTotal`, `netTotal`, `vatTotal`, `grandTotal`).
          // Kayıtlı değer tek doğru kaynak: ekranla sunucu bir daha ayrışamaz.
          // Hesap yalnızca alan hiç gelmediğinde yedek olarak kalıyor.
          const kayitli = Number((row as any).subtotal ?? 0)
          if (kayitli !== 0) return kayitli
          return calcInvoiceTotalsWithConversion(row.lines, row.vatExempt, invCurrency, fxRates).subTotal
        },
        header: 'Ara Toplam',
        meta: { filterType: 'number', showTotal: true },
        cell: ({ row, getValue }) => {
          const invCurrency = getInvoiceCurrency(row.original.lines)
          return <div className="text-right font-medium text-slate-700">{formatMoneyWithCurrency(getValue(), invCurrency)}</div>
        }
      },
      {
        id: 'discountTotal',
        accessorFn: (row) => {
          const invCurrency = getInvoiceCurrency(row.lines)
          // KAYITLI DEĞER ÖNCELİKLİ (2026-08-22).
          //
          // Bu sütunlar satırlardan yeniden hesaplanıyordu ve hesap, satır eşlemesinde
          // indirim alanları düştüğü için İNDİRİM'i her zaman 0 veriyordu. Oysa sunucu
          // toplamları zaten hesaplayıp kaydediyor ve uç bunları gönderiyor
          // (`subtotal`, `discountTotal`, `netTotal`, `vatTotal`, `grandTotal`).
          // Kayıtlı değer tek doğru kaynak: ekranla sunucu bir daha ayrışamaz.
          // Hesap yalnızca alan hiç gelmediğinde yedek olarak kalıyor.
          const kayitli = Number((row as any).discountTotal ?? 0)
          if (kayitli !== 0) return kayitli
          return calcInvoiceTotalsWithConversion(row.lines, row.vatExempt, invCurrency, fxRates).discountTotal
        },
        header: 'İndirim',
        meta: { filterType: 'number', showTotal: true },
        cell: ({ row, getValue }) => {
          const invCurrency = getInvoiceCurrency(row.original.lines)
          return <div className="text-right font-medium text-slate-700">{formatMoneyWithCurrency(getValue(), invCurrency)}</div>
        }
      },
      {
        id: 'netTotal',
        accessorFn: (row) => {
          const invCurrency = getInvoiceCurrency(row.lines)
          // KAYITLI DEĞER ÖNCELİKLİ (2026-08-22).
          //
          // Bu sütunlar satırlardan yeniden hesaplanıyordu ve hesap, satır eşlemesinde
          // indirim alanları düştüğü için İNDİRİM'i her zaman 0 veriyordu. Oysa sunucu
          // toplamları zaten hesaplayıp kaydediyor ve uç bunları gönderiyor
          // (`subtotal`, `discountTotal`, `netTotal`, `vatTotal`, `grandTotal`).
          // Kayıtlı değer tek doğru kaynak: ekranla sunucu bir daha ayrışamaz.
          // Hesap yalnızca alan hiç gelmediğinde yedek olarak kalıyor.
          const kayitli = Number((row as any).netTotal ?? 0)
          if (kayitli !== 0) return kayitli
          return calcInvoiceTotalsWithConversion(row.lines, row.vatExempt, invCurrency, fxRates).netTotal
        },
        header: 'Net Tutar',
        meta: { filterType: 'number', showTotal: true },
        cell: ({ row, getValue }) => {
          const invCurrency = getInvoiceCurrency(row.original.lines)
          return <div className="text-right font-semibold text-slate-800">{formatMoneyWithCurrency(getValue(), invCurrency)}</div>
        }
      },
      {
        id: 'vatTotal',
        accessorFn: (row) => {
          const invCurrency = getInvoiceCurrency(row.lines)
          // KAYITLI DEĞER ÖNCELİKLİ (2026-08-22).
          //
          // Bu sütunlar satırlardan yeniden hesaplanıyordu ve hesap, satır eşlemesinde
          // indirim alanları düştüğü için İNDİRİM'i her zaman 0 veriyordu. Oysa sunucu
          // toplamları zaten hesaplayıp kaydediyor ve uç bunları gönderiyor
          // (`subtotal`, `discountTotal`, `netTotal`, `vatTotal`, `grandTotal`).
          // Kayıtlı değer tek doğru kaynak: ekranla sunucu bir daha ayrışamaz.
          // Hesap yalnızca alan hiç gelmediğinde yedek olarak kalıyor.
          const kayitli = Number((row as any).vatTotal ?? 0)
          if (kayitli !== 0) return kayitli
          return calcInvoiceTotalsWithConversion(row.lines, row.vatExempt, invCurrency, fxRates).vatTotal
        },
        header: 'KDV Tutar',
        meta: { filterType: 'number', showTotal: true },
        cell: ({ row, getValue }) => {
          const invCurrency = getInvoiceCurrency(row.original.lines)
          return <div className="text-right font-medium text-slate-700">{formatMoneyWithCurrency(getValue(), invCurrency)}</div>
        }
      },
      {
        id: 'grandTotal',
        accessorFn: (row) => {
          const invCurrency = getInvoiceCurrency(row.lines)
          // KAYITLI DEĞER ÖNCELİKLİ (2026-08-22).
          //
          // Bu sütunlar satırlardan yeniden hesaplanıyordu ve hesap, satır eşlemesinde
          // indirim alanları düştüğü için İNDİRİM'i her zaman 0 veriyordu. Oysa sunucu
          // toplamları zaten hesaplayıp kaydediyor ve uç bunları gönderiyor
          // (`subtotal`, `discountTotal`, `netTotal`, `vatTotal`, `grandTotal`).
          // Kayıtlı değer tek doğru kaynak: ekranla sunucu bir daha ayrışamaz.
          // Hesap yalnızca alan hiç gelmediğinde yedek olarak kalıyor.
          const kayitli = Number((row as any).grandTotal ?? 0)
          if (kayitli !== 0) return kayitli
          return calcInvoiceTotalsWithConversion(row.lines, row.vatExempt, invCurrency, fxRates).grandTotal
        },
        header: 'Genel Toplam',
        meta: { filterType: 'number', showTotal: true },
        cell: ({ row, getValue }) => {
          const invCurrency = getInvoiceCurrency(row.original.lines)
          return <div className="text-right font-bold text-slate-900">{formatMoneyWithCurrency(getValue(), invCurrency)}</div>
        }
      },
      {
        accessorKey: 'createUser',
        header: 'İşlem Yapan',
        meta: { filterType: 'text', filterPlaceholder: 'İşlem Yapan...' }
      }
    ],
    [fxRates]
  )

  const getRowActions = (row: ProformaRow): DataTableRowAction<ProformaRow>[] => {
    const actions: DataTableRowAction<ProformaRow>[] = []
    const isTransferredToInvoice = Boolean((row as any).invoiceId || (row as any).invoiceNo)
    actions.push({
      label: 'Yazdır',
      icon: <Printer size={14} />,
      onClick: (r) => {
        void printProforma(r.id, r.source, false)
      }
    })
    actions.push({
      label: isTransferredToInvoice ? 'Faturaya Aktarıldı' : 'Faturaya Aktar',
      icon: <Printer size={14} />,
      disabled: isTransferredToInvoice,
      onClick: (r) => {
        // Modal doğrudan açılıyordu: `openTransferToInvoice` hiç çağrılmadığı için hedef
        // hesap tipi ilk durumda ("ACIK") kalıyor, fatura no alanları hiç görünmüyor ve
        // depo öntanımları kurulmuyordu. Ekranda HER cari "Açık Cari (Otomatik Fatura No)"
        // görünmesinin sebebi buydu.
        if (!isTransferredToInvoice) {
          openTransferToInvoice(r.id, r.source)
        }
      }
    })
    actions.push({
      label: 'Sil',
      icon: <Trash2 size={14} />,
      variant: 'danger',
      onClick: (r) => {
        void (async () => {
          try {
            if (r.source === 'cari') {
              await deleteCariProformaFromOffer(r.id)
            } else {
              await deleteProformaFromOffer(r.id)
            }
            await load()
          } catch (err: any) {
            showMessage('Hata', err?.message || 'Silme işlemi başarısız')
          }
        })()
      }
    })
    return actions
  }

  const renderExpandedRowContent = (row: ProformaRow) => {
    return (
      <div className="border border-slate-200 rounded-lg overflow-hidden bg-white shadow-sm p-2">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-slate-100 text-slate-700 font-semibold border-b border-slate-200">
              <th className="px-3 py-2 text-left">Stok Kodu</th>
              <th className="px-3 py-2 text-left">Stok Adı</th>
              <th className="px-3 py-2 text-center">Döviz Tipi</th>
              <th className="px-3 py-2 text-right">Miktar</th>
              <th className="px-3 py-2 text-right">Fiyat</th>
              <th className="px-3 py-2 text-right">Toplam</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {row.lines.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-3 text-center text-slate-400">Kalem bulunamadı.</td>
              </tr>
            ) : (
              row.lines.map((line: any) => {
                return (
                  <tr key={line.id} className="hover:bg-slate-50">
                    <td className="px-3 py-2 font-mono font-medium text-slate-800">{line.stockCode}</td>
                    <td className="px-3 py-2 text-slate-700">{line.stockName}</td>
                    <td className="px-3 py-2 text-center text-slate-600 font-medium">{getCurrencySymbol(line.currencyCode)}</td>
                    <td className="px-3 py-2 text-right font-medium">{line.quantity}</td>
                    <td className="px-3 py-2 text-right">{formatMoneyWithCurrency(line.unitPrice, line.currencyCode)}</td>
                    {/*
                      SATIR TOPLAMI INDIRIMLI VE KDV'LI (2026-08-24, kullanici bildirimi:
                      "musteri teklifinden proformaya aktariyorum, fark geliyor").

                      Burada `miktar x fiyat` yaziyordu: ne satir indirimi ne KDV. Ayni belgenin
                      Musteri Teklifi ekrani ise indirim dusulmus net + KDV gosteriyor. Iki ekran
                      ayni satir icin iki farkli rakam veriyordu (ornek: 70.285,71 / 62.730,00).

                      Hesap `CustomerOffersController.ComputeTotals` ile ayni: tutar indirimi
                      ADET BASINA, oran indirimi taban uzerinden, tavan satir tabani; KDV muafta
                      ve oran 0'da yok.
                    */}
                    <td className="px-3 py-2 text-right font-semibold text-slate-900">
                      {(() => {
                        const miktar = Number(line.quantity ?? 0)
                        const taban = miktar * Number(line.unitPrice ?? 0)
                        const deger = Math.max(0, Number(line.discountValue ?? 0))
                        const tip = String(line.discountType ?? '').toLowerCase()
                        let indirim = 0
                        if (tip === 'amount' || tip === '1') indirim = deger * miktar
                        else if (tip === 'percentage' || tip === '2') indirim = (taban * deger) / 100
                        indirim = Math.min(indirim, taban)
                        const net = taban - indirim
                        const oran = Number(line.vatRate ?? 0)
                        const kdv = (row.vatExempt || oran === 0) ? 0 : (net * oran) / 100
                        return formatMoneyWithCurrency(net + kdv, line.currencyCode)
                      })()}
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

  return (
    <div>


      <Modal
        isOpen={transferOpen}
        onClose={() => {
          if (transferBusy) return
          setTransferOpen(false)
          setTransferOfferId(null)
        }}
        maxWidth="max-w-5xl"
        title="Proformayı Satış Faturasına Aktar"
        footer={
          <div className="flex items-center justify-between w-full">
            <div className="text-xs text-gray-500 font-medium">
              {transferRow?.customerCode ? (
                <span>Cari: <strong className="text-gray-900">[{transferRow.customerCode}] {transferRow.customerName}</strong></span>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={transferBusy}
                onClick={() => {
                  setTransferOpen(false)
                  setTransferOfferId(null)
                }}
                className="px-4 py-2 text-xs font-semibold bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 disabled:opacity-60 transition"
              >
                Vazgeç
              </button>
              <button
                type="button"
                disabled={transferBusy}
                onClick={() => void submitTransferToInvoice()}
                className="px-5 py-2 text-xs font-semibold bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-60 transition shadow-xs flex items-center gap-1.5"
              >
                {transferBusy ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Aktarılıyor...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Faturaya Aktar</span>
                  </>
                )}
              </button>
            </div>
          </div>
        }
      >
        {transferError && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-xs font-semibold text-red-600 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span className="whitespace-pre-line">{transferError}</span>
          </div>
        )}

        {/* Döviz Kurları — otomatik gelir, elle değiştirilebilir; fatura bu kurla kesilir. */}
        <div className="mb-4 p-3.5 bg-white border border-slate-200 rounded-xl">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5 text-xs font-bold text-slate-700 mr-1">
              <Coins className="w-4 h-4 text-amber-500" />
              <span>Döviz Kurları (TL):</span>
            </div>

            {([
              { code: 'USD' as const, flag: '🇺🇸', label: 'USD ($)', placeholder: '47.91', title: 'Dolar Kurunu Düzenle (TL)' },
              { code: 'EUR' as const, flag: '🇪🇺', label: 'EUR (€)', placeholder: '55.46', title: 'Euro Kurunu Düzenle (TL)' },
              { code: 'GBP' as const, flag: '🇬🇧', label: 'GBP (£)', placeholder: '64.93', title: 'Sterlin Kurunu Düzenle (TL)' }
            ]).map((c) => (
              <div
                key={`transfer-fx-${c.code}`}
                className={`flex items-center bg-slate-50 border rounded-lg overflow-hidden focus-within:ring-1 focus-within:ring-emerald-500 focus-within:border-emerald-500 ${
                  transferCurrencyCode === c.code ? 'border-emerald-400 ring-1 ring-emerald-200' : 'border-slate-200'
                }`}
              >
                <span className="px-2.5 py-1 bg-slate-100 text-[11px] font-bold text-slate-700 border-r border-slate-200 flex items-center gap-1">
                  <span>{c.flag}</span> {c.label}
                </span>
                <input
                  type="text"
                  value={fxRatesInput[c.code]}
                  onChange={(e) => handleRateInputChange(c.code, e.target.value)}
                  disabled={transferBusy}
                  placeholder={c.placeholder}
                  className="w-20 px-2 py-1 text-xs font-mono font-bold text-slate-900 bg-transparent text-center focus:outline-none disabled:opacity-60"
                  title={c.title}
                />
                <span className="pr-2 text-[10px] font-bold text-slate-400">₺</span>
              </div>
            ))}

            <button
              type="button"
              onClick={() => void refreshFxRates()}
              disabled={fxRatesLoading || transferBusy}
              className="p-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-600 hover:text-emerald-600 transition-colors disabled:opacity-50 cursor-pointer"
              title="TCMB Canlı Kurlarını Yeniden Çek"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${fxRatesLoading ? 'animate-spin text-emerald-600' : ''}`} />
            </button>
          </div>

          <div className="mt-2 text-[11px] font-semibold text-slate-500">
            {transferCurrencyCode === 'TRY' ? (
              <span>Bu proforma TL düzenlenmiş; fatura kursuz (1,0000) kesilecek.</span>
            ) : (
              <span>
                Fatura <strong className="text-slate-800">{transferCurrencyCode}</strong> kesilecek — uygulanacak kur:{' '}
                <strong className="font-mono text-slate-900">
                  {transferAppliedRate.toLocaleString('tr-TR', { minimumFractionDigits: 4, maximumFractionDigits: 4 })} ₺
                </strong>{' '}
                · TL karşılığı:{' '}
                <strong className="font-mono text-slate-900">
                  {formatMoneyWithCurrency(Number(transferRow?.grandTotal ?? 0) * transferAppliedRate, '0')}
                </strong>
              </span>
            )}
          </div>
        </div>

        {/* Üst Bilgi Kartı */}
        <div className="mb-4 p-4 bg-slate-50 border border-slate-200 rounded-xl flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-0.5">
            <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Hedef Cari Bilgisi</div>
            <div className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Building2 className="w-4 h-4 text-slate-600" />
              <span>[{transferMainCustomerCode || transferRow?.customerCode}] {transferRow?.customerName}</span>
            </div>
            {transferTargetCustomerCode ? (
              <div className="text-[11px] font-semibold text-slate-600">
                Fatura şu hesaba yazılacak:{' '}
                <strong className="font-mono text-slate-900">{transferTargetCustomerCode}</strong>
              </div>
            ) : null}
          </div>
          <div className="flex items-center gap-2.5">
            {transferAccountType === 'FATURA' ? (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold bg-blue-100 text-blue-800 border border-blue-200">
                <FileText className="w-3.5 h-3.5 text-blue-600" />
                Resmi Fatura Hesabı (-1)
              </span>
            ) : transferAccountType === 'ASKERIYE' ? (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
                Muaf Hesabı (-3)
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold bg-amber-100 text-amber-800 border border-amber-200">
                <Sparkles className="w-3.5 h-3.5 text-amber-600" />
                Açık Cari (-2, Otomatik Fatura No)
              </span>
            )}
            <span className="px-3 py-1.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
              Toplam: {formatMoneyWithCurrency(transferRow?.grandTotal ?? 0, transferRow?.currencyCode || (transferRow as any)?.currencyTypeId)}
            </span>
          </div>
        </div>

        {/* Hedef Hesap Seçimi — üç alt hesap cari açılırken birlikte oluşturulur, üçü de seçilebilir. */}
        <div className="mb-4 p-3.5 bg-white border border-slate-200 rounded-xl">
          <div className="text-xs font-bold text-slate-800 mb-1">Hangi Hesaba Aktarılacak?</div>
          <p className="text-[11px] text-slate-500 mb-2.5">
            Varsayılan, carinin kartındaki fatura tipine göre seçilir; gerekirse buradan değiştirebilirsiniz.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {([
              { key: 'FATURA' as const, label: 'Resmi Fatura (-1)', hint: 'Fatura no el ile girilir', active: 'bg-blue-600' },
              { key: 'ACIK' as const, label: 'Açık Cari (-2)', hint: 'Fatura no otomatik', active: 'bg-amber-600' },
              { key: 'ASKERIYE' as const, label: 'Muaf / Askeriye (-3)', hint: 'Fatura no el ile girilir', active: 'bg-emerald-600' }
            ]).map((opt) => (
              <button
                key={opt.key}
                type="button"
                disabled={transferBusy}
                onClick={() => {
                  setTransferAccountType(opt.key)
                  setTransferError(null)
                }}
                title={opt.hint}
                className={`h-[34px] px-3.5 text-xs font-bold rounded-lg transition disabled:opacity-60 ${
                  transferAccountType === opt.key
                    ? `${opt.active} text-white shadow-sm`
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Fatura Numarası Alanı */}
        {transferAccountType === 'ACIK' ? (
          <div className="mb-4 p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-emerald-100 flex items-center justify-center shrink-0 text-emerald-700">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <div className="text-xs font-bold text-emerald-900">Fatura Numarası: Otomatik Oluşturulacak</div>
              <div className="text-[11px] text-emerald-700">
                Açık cari (-2) hesabına aktarıldığı için fatura numarası sistem tarafından sıradaki
                15 haneli numara ile otomatik atanacaktır. Numarayı el ile girmek için yukarıdan
                "Resmi Fatura (-1)" ya da "Muaf / Askeriye (-3)" seçin.
              </div>
            </div>
          </div>
        ) : (
          <div className="mb-4 p-4 bg-white border border-slate-200 rounded-xl space-y-3">
            <div className="text-xs font-bold text-slate-800">
              {transferAccountType === 'ASKERIYE' ? 'Muaf / Askeriye Fatura Numarası Girişi' : 'Resmi Fatura Numarası Girişi'}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormInput
                label="Seri No"
                value={transferSerie}
                onChange={(e) => {
                  const raw = String(e.target.value ?? '').toUpperCase().slice(0, 2)
                  setTransferSerie(raw)
                }}
                placeholder="Örn: A"
              />
              <FormInput
                label="Fatura No"
                value={transferNumber}
                onChange={(e) => {
                  const digitsOnly = String(e.target.value ?? '').replace(/\D/g, '').slice(0, 14)
                  setTransferNumber(digitsOnly)
                }}
                placeholder="14 haneli (sadece sayı)"
              />
            </div>
            <div className="text-xs text-slate-500 font-mono">
              Oluşacak Fatura No: <strong className="text-slate-900">{String(transferSerie || 'A').trim().toUpperCase() + String(transferNumber || '0').padStart(14, '0')}</strong>
            </div>
          </div>
        )}

        {/* Toplu Çıkış Deposu */}
        <div className="mb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-3.5 bg-slate-50 border border-slate-200 rounded-xl">
          <div>
            <label className="block text-xs font-bold text-slate-800">Toplu Çıkış Deposu</label>
            <p className="text-[11px] text-slate-500">Aşağıdaki tüm ürünlerin deposunu tek tıkla değiştirmek için seçebilirsiniz.</p>
          </div>
          <div className="w-full sm:w-72">
            <select
              value={transferWarehouseCode}
              onChange={(e) => {
                const val = String(e.target.value ?? '')
                setTransferWarehouseCode(val)
                if (transferRow?.lines) {
                  const updated: Record<number, string> = {}
                  transferRow.lines.forEach((l) => {
                    updated[l.id] = val
                  })
                  setTransferLineWarehouseById(updated)
                }
              }}
              disabled={warehousesLoading}
              className="w-full h-[40px] px-3 text-xs font-semibold border border-slate-200 rounded-lg bg-white focus:ring-2 focus:ring-emerald-200 focus:border-emerald-400 transition"
            >
              <option value="">Depo Seçiniz...</option>
              {warehouses.map((w) => (
                <option key={`top-wh-${w.warehouseCode}`} value={String(w.warehouseCode)}>
                  {w.warehouseCode} {w.name ? `- ${w.name}` : ''}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Ürün Kalemleri Tablosu */}
        <div className="border border-slate-200 rounded-xl overflow-hidden shadow-2xs">
          <div className="bg-slate-100 px-4 py-2.5 border-b border-slate-200 flex items-center justify-between">
            <span className="text-xs font-bold text-slate-700 flex items-center gap-2">
              <Package className="w-4 h-4 text-slate-500" />
              Faturaya Aktarılacak Kalemler ve Depo Ataması ({transferRow?.lines?.length ?? 0} Kalem)
            </span>
            <span className="text-[11px] text-slate-500 font-medium">Her kaleme özel depo seçebilirsiniz</span>
          </div>
          <div className="max-h-[350px] overflow-y-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold">
                  <th className="py-2.5 px-3.5 w-10 text-center">#</th>
                  <th className="py-2.5 px-3.5 w-36">Stok Kodu</th>
                  <th className="py-2.5 px-3.5">Ürün Adı</th>
                  <th className="py-2.5 px-3.5 text-center w-20">Miktar</th>
                  <th className="py-2.5 px-3.5 text-right w-32">Birim Fiyat</th>
                  <th className="py-2.5 px-3.5 w-60">Çıkış Deposu</th>
                  <th className="py-2.5 px-3.5 text-right w-28">Depo Stoğu</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(transferRow?.lines ?? []).map((line, idx) => {
                  const lineWhCode = Number(transferLineWarehouseById[line.id] || transferWarehouseCode || 0)
                  const perStock = balanceByWarehouseAndStockCode.get(lineWhCode)
                  const availableQty = perStock?.get(line.stockCode.toLowerCase()) ?? 0
                  const isSufficient = availableQty >= Number(line.quantity || 1)

                  return (
                    <tr key={line.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-2.5 px-3.5 text-slate-400 font-mono font-medium text-center">{idx + 1}</td>
                      <td className="py-2.5 px-3.5 font-mono font-bold text-slate-900">{line.stockCode}</td>
                      <td className="py-2.5 px-3.5 text-slate-700 truncate max-w-[280px]" title={line.stockName || line.stockCode}>
                        {line.stockName || line.stockCode}
                      </td>
                      <td className="py-2.5 px-3.5 text-center font-bold text-slate-900">{line.quantity}</td>
                      <td className="py-2.5 px-3.5 text-right font-mono font-semibold text-slate-900">
                        {formatMoneyWithCurrency(line.unitPrice, line.currencyCode || transferRow?.currencyCode || (transferRow as any)?.currencyTypeId)}
                      </td>
                      <td className="py-2.5 px-3.5">
                        <select
                          value={String(transferLineWarehouseById[line.id] || transferWarehouseCode || '')}
                          onChange={(e) => {
                            const val = e.target.value
                            setTransferLineWarehouseById((prev) => ({
                              ...prev,
                              [line.id]: val
                            }))
                          }}
                          className="w-full h-[34px] px-2.5 text-xs font-medium border border-slate-200 rounded-lg bg-white focus:ring-2 focus:ring-emerald-200 focus:border-emerald-400"
                        >
                          <option value="">Depo Seçiniz...</option>
                          {warehouses.map((w) => (
                            <option key={`line-${line.id}-wh-${w.warehouseCode}`} value={String(w.warehouseCode)}>
                              {w.warehouseCode} {w.name ? `- ${w.name}` : ''}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-2.5 px-3.5 text-right">
                        {lineWhCode > 0 ? (
                          <span
                            className={`inline-block px-2.5 py-1 rounded-md text-[11px] font-bold ${
                              isSufficient ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                            }`}
                          >
                            {!tamStokGorsun && availableQty > 12 ? '12+' : availableQty} Adet
                          </span>
                        ) : (
                          <span className="text-slate-400 text-xs">-</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </Modal>

      <PageHeader
        title="Proforma"
        breadcrumb="Fatura İşlemleri / Proforma"
        searchValue={globalSearch}
        onSearchChange={setGlobalSearch}
        leftActions={undefined}
        rightActions={
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
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
        columns={proformaColumns}
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
