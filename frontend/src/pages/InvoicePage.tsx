import React from 'react'

import Table, { type TableColumn } from '../components/Table'

import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { formatPhoneNumber } from '../utils/phone'

import { resolveProductSalesCurrency, isTryCurrency } from '../utils/productCurrency'

import { Navigate, useLocation, useNavigate, useOutletContext } from 'react-router-dom'
import { API_BASE_URL, apiUrl } from '../config/api'

import FormSelect from '../components/forms/FormSelect'
import CustomerSelect from '../components/forms/CustomerSelect'
import { fetchCustomerByCode, fetchCustomersDropdown, type CustomerDto } from '../api/customers'
// Fatura kaydedilir kaydedilmez basim PDF'i cekilir (bkz. olusturma akisi).
import { fetchInvoicePrintPdf } from '../api/invoices'

import FormInput from '../components/forms/FormInput'

import { useCart } from '../contexts/CartContext'
import { faturaTipiBelirle } from '../components/Orders/kdvKarari'
import { MontajFormModal } from '../components/Orders/MontajFormModal'
import CurrencyFilterDropdown from '../components/Orders/CurrencyFilterDropdown'

import { invoiceTabLabels, pathToInvoiceTabId } from '../routes'
import IrsaliyePage from './IrsaliyePage'

import { useProducts } from '../hooks/useProducts'

import type { Product as ApiProduct } from '../types/Product'

import { useDealer } from '../contexts/DealerContext'

import Modal from '../components/Modal'

import CampaignCreateModal from '../components/Campaigns/CampaignCreateModal'

import BasketTotalDiscountModal from '../components/Campaigns/BasketTotalDiscountModal'

import QuantityTieredDiscountModal from '../components/Campaigns/QuantityTieredDiscountModal'

import BuyXGetYModal from '../components/Campaigns/BuyXGetYModal'

import SelectedProductDiscountModal from '../components/Campaigns/SelectedProductDiscountModal'

import CategoryBrandDiscountModal from '../components/Campaigns/CategoryBrandDiscountModal'

const COMING_SOON_IMAGE_URI = '/images/coming_soon_product.png'

import PackageCampaignModal from '../components/Campaigns/PackageCampaignModal'

import { fetchCampaignById, fetchCampaigns, softDeleteCampaign, type CampaignDetailsResponse } from '../api/campaigns'

import { fetchProducts } from '../api/products'

import { useProductCategories } from '../hooks/useProductCategories'

import { ArrowUpDown, ChevronDown, ChevronRight, Filter, Gift, LayoutGrid, List, Plus, Search, X, CreditCard, Wallet, Check, CircleAlert, FileText, Banknote, Users, Eye, ShoppingCart, Save, Trash2, SlidersHorizontal, Coins, RefreshCw } from 'lucide-react'

import DataGrid, { type DataGridColumn } from '../components/datagrid/DataGrid'

import CampaignCarousel from '../components/Orders/CampaignCarousel'

import CampaignsListModal from '../components/Orders/CampaignsListModal'

import ProductCampaignBadge from '../components/Orders/ProductCampaignBadge'

import ColumnFilterSearchBar from '../components/table/ColumnFilterSearchBar'



import CampaignDetailPopover from '../components/Orders/CampaignDetailPopover'
import { fetchActiveCampaigns, type ActiveCampaignDto } from '../api/campaigns'
import { applyCampaignsToCart, campaignAppliesToPriceGroup, campaignPriceForProduct, type CartItem as CampaignCartItem } from '../services/campaignApplier'
import { fetchPriceGroups, type PriceGroupDto } from '../api/priceGroups'

import MagazaSiparisPage from './MagazaSiparisPage'
import SiparisCartSection from '../components/Orders/SiparisCartSection'

import ProformaPage from './ProformaPage'
import BayiTeklifleriPage from './BayiTeklifleriPage'
import CariOfferPage from './CariOfferPage'
import PurchaseInvoicesPage from './PurchaseInvoicesPage'
import TerminPage from './TerminPage'
import TerminRaporPage from './TerminRaporPage'
import StokHareketDokumuPage from './StokHareketDokumuPage'
import DepoTransferPage from './DepoTransferPage'
import DepoStokPage from './DepoStokPage'
import GarantiDegisimPage from './GarantiDegisimPage'
import FaturaTakipPage from './FaturaTakipPage'
import EtiketBasimPage from './EtiketBasimPage'
import { fetchAuthorizedStockBalances, fetchAuthorizedWarehousesDropdown, type AuthorizedStockBalancesResponse, type WarehouseDropdownItem } from '../api/warehouses'
import { fetchCashAccountBalance, fetchCashAccounts, type CashAccountDto } from '../api/cashAccounts'
import { fetchBankAccountDefinitions, type BankAccountDefinitionDto } from '../api/bankAccountDefinitions'
import { fetchBankAccountBalance } from '../api/bankAccountTransactions'
import { fetchLatestFxRate } from '../api/fx'
// BSY kurali TEK KAYNAKTA — bkz. utils/productSaleStatus.ts
import { isClosedToSale as isClosedToSaleRule } from '../utils/productSaleStatus'
import { ShipSailingAnimation } from '../components/ShipSailingAnimation'
import { kampanyaliToplam, type KampanyaAyrimi } from '../utils/invoiceDiscount'

const KAMPANYA_YOK: KampanyaAyrimi = { satirNet: 0, satirKdv: 0, siparisGeneli: 0 }

function currencyCodeByTypeId(cur: number) {
  const v = Number(cur ?? 1)
  return v === 2 ? 'EUR' : v === 3 ? 'USD' : v === 4 ? 'GBP' : 'TRY'
}

function getAccountCurrencyCode(acc: { currencyTypeId?: number; accountName?: string; name?: string; accountCode?: string; code?: string } | null | undefined): string {
  if (!acc) return 'TRY'
  const text = `${acc.accountName ?? ''} ${acc.name ?? ''} ${acc.accountCode ?? ''} ${acc.code ?? ''}`.toUpperCase()
  if (text.includes('USD') || text.includes('DOLAR')) return 'USD'
  if (text.includes('EUR') || text.includes('EURO')) return 'EUR'
  if (text.includes('GBP') || text.includes('STERLİN') || text.includes('STERLIN')) return 'GBP'

  const v = Number(acc.currencyTypeId ?? 1)
  if (v === 2) return 'EUR'
  if (v === 3) return 'USD'
  if (v === 4) return 'GBP'
  return 'TRY'
}

function computeSingleCurrencySummary(
  lines: any[] | null | undefined,
  qtyByLineId: Record<string, number>,
  /** Kampanyanın parçaları, belgenin parasında (bkz. `kampanyaliToplam`). */
  kampanya: KampanyaAyrimi = KAMPANYA_YOK,
  manualDiscount: number = 0,
  isNoVat: boolean = false,
  /** Yüzde indirim: verilirse `manualDiscount` yok sayılır, KDV dahil tabandan hesaplanır. */
  manualDiscountPercent: number | null = null,
  /** Tutar iskontosunun yetki üst sınırı (%), KDV dahil tabana uygulanır. */
  maxDiscountRate: number | null = null
) {
  const arr = Array.isArray(lines) ? lines : []
  if (arr.length === 0) return null

  const rawCurrencyIds = new Set<number>()
  for (const l of arr) {
    const curTypeId = Number((l as any)?.currencyTypeId ?? 0)
    rawCurrencyIds.add(curTypeId)
  }

  const nonZeroCurrencyIds = Array.from(rawCurrencyIds).filter((c) => c > 0)
  if (nonZeroCurrencyIds.length > 1) return null

  const currencyTypeId = nonZeroCurrencyIds.length === 1 ? nonZeroCurrencyIds[0] : (Array.from(rawCurrencyIds)[0] || 1)
  if (currencyTypeId === 0) return null

  const subtotal = arr.reduce((acc, l) => {
    const id = String((l as any)?.salesOrderLineId ?? '')
    const qty = Number(qtyByLineId[id] ?? 0)
    const isGift = Boolean((l as any)?.isGift)
    const curUnit = isGift ? 0.01 : Number((l as any)?.currencyUnitPrice || (l as any)?.unitPrice || 0)
    if (!Number.isFinite(qty) || qty <= 0) return acc
    if (!Number.isFinite(curUnit) || curUnit <= 0) return acc
    return acc + qty * curUnit
  }, 0)

  const vatTotal = isNoVat ? 0 : arr.reduce((acc, l) => {
    const id = String((l as any)?.salesOrderLineId ?? '')
    const qty = Number(qtyByLineId[id] ?? 0)
    if (Boolean((l as any)?.isGift)) return acc
    const curUnit = Number((l as any)?.currencyUnitPrice || (l as any)?.unitPrice || 0)
    const vatRate = Number((l as any)?.vatRate ?? 0)
    if (!Number.isFinite(qty) || qty <= 0) return acc
    if (!Number.isFinite(curUnit) || curUnit <= 0) return acc
    if (!Number.isFinite(vatRate) || vatRate <= 0) return acc
    return acc + qty * curUnit * (vatRate / 100)
  }, 0)

  // Yüzde ve üst sınır KDV dahil tabandan — TL özetiyle ve sunucuyla aynı (2026-09-16).
  const kdvDahilTaban = subtotal + vatTotal
  let manual = manualDiscountPercent != null
    ? kdvDahilTaban * (manualDiscountPercent / 100)
    : manualDiscount
  if (maxDiscountRate != null) manual = Math.min(manual, kdvDahilTaban * (maxDiscountRate / 100))
  manual = Math.max(0, manual)

  // Dövizli özet de aynı hesabı kullanır; iki panel farklı KDV göstermesin.
  const _fx = kampanyaliToplam(subtotal, vatTotal, kampanya, manual)
  return {
    currencyTypeId,
    subtotal,
    vatTotal: _fx.kdvToplam,
    grandTotal: _fx.genelToplam,
    kampanyaNet: _fx.kampanyaNet
  }
}

type LayoutContext = {

  activeMenuId: string

  activeTabId?: string

  isSuperAdmin?: boolean

  isSuperSuperAdmin?: boolean

  allowedKeys?: Set<string>

  roleCode?: string

  userRoleId?: number | null

  userDiscountRate?: number | null

  currentCode?: string

}

type CustomerDropdownItem = {
  customerCode: string
  name: string
  priceGroupId?: string | null
  parentCustomerCode?: string | null
  currencyTypeId?: number
}



function formatMoney(n: number) {

  let v = Number(n ?? 0)

  if (Math.abs(v) < 0.005) {
    v = 0
  }

  return `₺${v.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

}

function getActiveUserDiscountRate(layout: LayoutContext | null | undefined): number {
  if (!layout) return 100
  const isSsa = Boolean(layout.isSuperSuperAdmin || layout.roleCode === 'SSA' || layout.roleCode === 'SuperSuperAdmin')
  if (isSsa) return 100

  if (layout.userDiscountRate === null || layout.userDiscountRate === undefined) {
    return 100
  }

  const rate = Number(layout.userDiscountRate)
  return Number.isFinite(rate) ? rate : 100
}

/**
 * Bayinin para birimini ürün süzgecine geçirir.
 *
 * ESKİ ürün kodlamasına çeviriyordu (`3 → 43` USD, `4 → 3` GBP). Göçten sonra backend `43`'ü
 * tanımıyor ve bilinmeyen kodu TL'ye düşürüyor: dolar bayi, fatura ekranında dolarlı ürünleri
 * kaçırıp TL ürünleri görüyordu. Sterlinde ise süzgeç DOLARA dönüyordu.
 * (Aynı hata `MagazaSiparisPage`'te de vardı — iki dosyada da bu ikinci yardımcı atlanmıştı.)
 */
function mapCurrencyTypeIdToCode(currencyTypeId: number | string | undefined | null): number | undefined {
  const cid = Number(currencyTypeId)
  if (cid === 1 || cid === 0) return 1  // TL
  if (cid === 2) return 2               // EUR
  if (cid === 3) return 3               // USD
  if (cid === 4) return 4               // GBP
  return undefined
}



function parseKdvRate(input: string) {

  const s = String(input ?? '')

  const m = s.match(/Kdv\s*:\s*(\d+[\.,]?\d*)/i)

  if (!m) return 0

  const n = Number(String(m[1]).replace(',', '.'))

  return Number.isFinite(n) ? n : 0

}



function SatisFaturaView() {

  type CustomerOption = { value: string; label: string }

  type InvoiceLine = {

    salesOrderLineId: number

    salesOrderId: number

    orderSubtotal: number

    orderGrandTotal: number

    orderDate: string

    orderNo: string

    customerCode: string

    deliveryCustomerCode: string

    stockCode: string

    productName: string

    description: string | null

    orderQuantity: number

    deliveredQuantity: number

    remainingQuantity: number

    serialNo: string | null

    unitPrice: number

    currencyTypeId?: number | null

    currencyRate?: number | null

    currencyUnitPrice?: number | null

    vatRate: number

    processedBy: string

    installationId: number | null

    installationName: string | null

    campaignDiscount: number
    isGift?: boolean
    discountAmount?: number

    /** Servisten gelen kalemin damgalı çıkış deposu. Servis dışı kalemde null. */
    sourceWarehouseCode?: number | null
    servicePerformerName?: string | null

    /** Kalemi giren kullanıcı — öntanımlı depo bu kişinin varsayılan deposundan geliyor. */
    createdByUsername?: string | null

    /**
     * KALEMİN ÖNTANIMLI ÇIKIŞ DEPOSU — sunucu hesaplar (bkz.
     * `SalesOrdersController.FillDefaultWarehousesAsync`): servis damgası, yoksa kalemi giren
     * kişinin varsayılan deposu, yoksa o kişinin tek depo yetkisi. Hiçbiri yoksa null gelir ve
     * depo kullanıcıya sorulur.
     */
    defaultWarehouseCode?: number | null
    defaultWarehouseName?: string | null
    /** `servis` | `kullanici` | null — rozet ve ipucu metni bundan seçiliyor. */
    defaultWarehouseSource?: string | null
  }

  /**
   * BİR FATURADA TEK DÖVİZ (2026-08-20 kullanıcı kararı).
   *
   * Kalemin dövizi karşılaştırma için tekilleştirilir. Sipariş satırlarında TL iki ayrı değerle
   * geliyor: eski kayıtlarda `currencyTypeId` hiç yazılmamış (0/null), yenilerde açıkça 1.
   * İkisi de TL'dir; ayrı sayılsaydı iki TL kalemi "farklı döviz" diye birbirini engellerdi.
   */
  const lineCurrencyTypeId = (l: { currencyTypeId?: number | null } | null | undefined) => {
    const v = Number(l?.currencyTypeId ?? 0)
    return Number.isFinite(v) && v > 0 ? v : 1
  }

  const formatUnitPriceDisplay = (l: InvoiceLine) => {
    const curTypeId = Number(l.currencyTypeId ?? 0)
    const code = currencyCodeByTypeId(curTypeId)

    if (l.isGift) {
      const price = 0.01;
      return `${code === 'TRY' ? '' : `${code} `}${curTypeId > 1 ? price.toFixed(2) : formatMoney(price)}${code === 'TRY' ? ' TL' : ''}`;
    }

    const curUnit = Number(l.currencyUnitPrice || l.unitPrice || 0)
    if (!Number.isFinite(curTypeId) || curTypeId <= 0) return formatMoney(Number(l.unitPrice ?? 0))
    if (!Number.isFinite(curUnit) || curUnit <= 0) return formatMoney(Number(l.unitPrice ?? 0))
    return `${curUnit.toFixed(2)} ${code}`
  }

  const readErrorText = async (res: Response) => {
    const text = await res.text().catch(() => '')
    const trimmed = String(text ?? '').trim()
    if (!trimmed) return `İşlem başarısız (${res.status})`
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        const j = JSON.parse(trimmed)
        const msg = j?.message || j?.error || j?.title
        if (typeof msg === 'string' && msg.trim()) return msg.trim()

        const errors = j?.errors
        if (errors && typeof errors === 'object') {
          const parts: string[] = []
          Object.entries(errors).forEach(([k, v]) => {
            if (Array.isArray(v)) v.forEach((x) => parts.push(`${k}: ${x}`))
            else if (typeof v === 'string') parts.push(`${k}: ${v}`)
          })
          if (parts.length) return parts.join('\n')
        }
      } catch {
      }
    }
    return trimmed
  }



  type DiscountType = 'amount' | 'percentage'

  const parseMontajTag = (desc: string | null | undefined) => {
    const s = String(desc ?? '')
    if (!s) return null
    const m = s.match(/\[MONTAJ\s+net=([0-9.]+)\s+vat=([0-9.]+)\s+gross=([0-9.]+)\s+rate=([0-9.]+)\]/i)
    if (!m) return null
    const net = Number(m[1])
    const vat = Number(m[2])
    const gross = Number(m[3])
    const rate = Number(m[4])
    if (![net, vat, gross, rate].every((x) => Number.isFinite(x))) return null
    if (gross <= 0) return null
    return { net, vat, gross, rate }
  }

  const parseCampaignLine = (desc: string | null | undefined): string | null => {
    const match = String(desc ?? '').match(/\[Kampanya\][^\n]*/i)
    return match ? match[0].replace(/^\[Kampanya\]\s*/i, '').trim() : null
  }

  const stripCampaignLine = (desc: string | null | undefined): string =>
    String(desc ?? '').replace(/\n?\[Kampanya\][^\n]*/gi, '').trim()

  const cleanupDescription = (desc: string | null | undefined) => {
    const s = String(desc ?? '').trim()
    if (!s) return ''
    const lines = s
      .split(/\r?\n/)
      .map((x) => x.trim())
      .filter(Boolean)
      .filter((x) => !/^Montaj\s*\(KDV\s*hariç\)/i.test(x))
      .filter((x) => !/^\[MONTAJ\s+/i.test(x))
    return lines.join('\n')
  }




  const layout = useOutletContext<LayoutContext>()
  const canSatisFaturaDepoBakiyeGorsun = Boolean(layout?.isSuperAdmin) || Boolean(layout?.allowedKeys?.has('invoice/satisFaturaDepoBakiyeGorsun'))

  const navigate = useNavigate()

  const POS_DRAFT_KEY = 'satis_fatura_pos_draft_v1'



  const location = useLocation()

  const [fxRates, setFxRates] = useState<Record<string, number>>({ USD: 1, EUR: 1, GBP: 1 })
  const [fxRatesInput, setFxRatesInput] = useState<Record<string, string>>({ USD: '', EUR: '', GBP: '' })
  const [fxRatesLoading, setFxRatesLoading] = useState(false)
  const [invoiceRateInput, setInvoiceRateInput] = useState('1')
  const [paymentRateInput, setPaymentRateInput] = useState('1')
  const [changeRateInput, setChangeRateInput] = useState('1')

  const refreshFxRates = useCallback(async () => {
    setFxRatesLoading(true)
    try {
      const [usd, eur, gbp] = await Promise.all([
        fetchLatestFxRate('USD').catch(() => 1),
        fetchLatestFxRate('EUR').catch(() => 1),
        fetchLatestFxRate('GBP').catch(() => 1)
      ])
      const newRates = {
        USD: usd > 0 ? usd : 1,
        EUR: eur > 0 ? eur : 1,
        GBP: gbp > 0 ? gbp : 1
      }
      setFxRates(newRates)
      setFxRatesInput({
        USD: String(newRates.USD),
        EUR: String(newRates.EUR),
        GBP: String(newRates.GBP)
      })
    } finally {
      setFxRatesLoading(false)
    }
  }, [])

  useEffect(() => {
    void refreshFxRates()
  }, [refreshFxRates])

  /**
   * KUR TEK KAYNAKTAN: sayfanın üstündeki çubuk.
   *
   * Tahsilat/para üstü kurları eskiden doğrudan TCMB'den (`fetchLatestFxRate`) çekiliyordu;
   * kullanıcı üstteki çubukta kuru değiştirse bile ödeme tarafı eski kuru kullanıyor,
   * ekranda iki farklı kur görünüyordu. Artık ikisi de bu fonksiyondan besleniyor.
   */
  const rateOf = useCallback(
    (code: string) => {
      const c = String(code ?? '').trim().toUpperCase()
      if (!c || c === 'TRY' || c === 'TL') return 1
      const r = Number((fxRates as any)[c] ?? 0)
      return r > 0 ? r : 1
    },
    [fxRates]
  )

  const handleRateInputChange = (currency: 'USD' | 'EUR' | 'GBP', value: string) => {
    setFxRatesInput((prev) => ({ ...prev, [currency]: value }))
    const num = Number(value.replace(',', '.'))
    if (num > 0) {
      setFxRates((prev) => ({ ...prev, [currency]: num }))
    }
  }

  const [customersState, setCustomersState] = useState<CustomerOption[]>([])

  const [customerInvoiceTypeByCode, setCustomerInvoiceTypeByCode] = useState<Record<string, string>>({})
  const [customerPriceGroupCodeByCode, setCustomerPriceGroupCodeByCode] = useState<Record<string, number>>({})

  const [selectedCustomer, setSelectedCustomer] = useState<string>('')

  const [loading, setLoading] = useState(false)



  /*
    FATURA SERİSİ (2026-10-11 düzeltmesi). Kutu eskiden `invoiceSerie || 'A'` gösteriyordu: A silinince
    boş değer yine A'ya düştüğü için seri DEĞİŞTİRİLEMİYORDU ("A" yazısı silinmiyor). Artık durum A ile
    başlar, kutu durumu olduğu gibi gösterir; boş bırakılırsa kayıtta yine A kullanılır. Sunucu seriyi TEK
    karakter kabul ediyor: yazılan yeni harf eskisinin yerine geçer (A varken B yazınca B olur).
  */
  const [invoiceSerie, setInvoiceSerie] = useState('A')

  const [invoiceNumber, setInvoiceNumber] = useState('')

  /*
    FATURA TARİHİ YEREL GÜNDEN ALINIR (2026-08-26, kullanıcı: "fatura dökümünde saat doğru
    geliyor ama gün yanlış, ayın 25'i olarak aldı").

    `toISOString()` UTC'ye çevirir. Kıbrıs UTC+3 olduğu için gece 00:00–03:00 arasında UTC
    hâlâ ÖNCEKİ gündedir: saat 01:07'de açılan fatura `2026-08-25` diye damgalanıyordu.
    Saat sütunu doğru görünüyordu çünkü o ayrı bir alandan (`CreateTime`) geliyor.

    Artık gün/ay/yıl tarayıcının YEREL takviminden okunuyor. Değişen tek şey alanın AÇILIŞ
    değeri: kullanıcı tarihi elle yine değiştirebiliyor, gönderim biçimi (2152. satır)
    aynı kaldı. 03:00–24:00 arasında iki hesap zaten aynı sonucu veriyor.
  */
  const [invoiceDate, setInvoiceDate] = useState(() => {
    const d = new Date()
    const iki = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${iki(d.getMonth() + 1)}-${iki(d.getDate())}`
  })

  const [discountType, setDiscountType] = useState<DiscountType>('amount')

  const [discountValue, setDiscountValue] = useState('0')

  const [campaignDiscountTotal, setCampaignDiscountTotal] = useState(0)
  const [kampanyaAyrimi, setKampanyaAyrimi] = useState<{ tl: KampanyaAyrimi; doc: KampanyaAyrimi }>({
    tl: KAMPANYA_YOK,
    doc: KAMPANYA_YOK
  })



  const [linesLoading, setLinesLoading] = useState(false)

  const [linesState, setLinesState] = useState<InvoiceLine[]>([])

  const [selectedLineIds, setSelectedLineIds] = useState<Record<number, boolean>>({})

  const [montajModalOpen, setMontajModalOpen] = useState(false)
  const [editingMontajLineId, setEditingMontajLineId] = useState<number | null>(null)
  const [montajInitialValues, setMontajInitialValues] = useState<any>(null)
  const [customMontajs, setCustomMontajs] = useState<Record<number, any>>({})

  const [invoiceQtyByLineId, setInvoiceQtyByLineId] = useState<Record<number, number>>({})

  const [draftSelectedLineIds, setDraftSelectedLineIds] = useState<Record<number, boolean>>({})

  const [draftInvoiceQtyByLineId, setDraftInvoiceQtyByLineId] = useState<Record<number, number>>({})

  const [note, setNote] = useState('')

  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const showToast = (message: string) => {
    setToastMessage(message)
    window.setTimeout(() => setToastMessage(null), 1800)
  }

  const [warehousesLoading, setWarehousesLoading] = useState(false)
  const [warehouses, setWarehouses] = useState<WarehouseDropdownItem[]>([])
  const [selectedWarehouseCode, setSelectedWarehouseCode] = useState<string>('')

  const [balancesLoading, setBalancesLoading] = useState(false)
  const [balances, setBalances] = useState<AuthorizedStockBalancesResponse | null>(null)
  const [activeCell, setActiveCell] = useState<{ pIndex: number; wIndex: number } | null>(null)

  const [cashAccounts, setCashAccounts] = useState<CashAccountDto[]>([])
  const [selectedCashAccountId, setSelectedCashAccountId] = useState<string>('')

  const [paymentMode, setPaymentMode] = useState<'open_account' | 'pay_now' | 'pay_with_change'>('open_account')
  const [isPriceOverridden, setIsPriceOverridden] = useState(false)
  const [customFxRateInput, setCustomFxRateInput] = useState('')
  const [takePaymentNow, setTakePaymentNow] = useState(false)

  const [payNowModalOpen, setPayNowModalOpen] = useState(false)

  const [cashReceivedAmount, setCashReceivedAmount] = useState('')
  const [changeSource, setChangeSource] = useState<'cash' | 'bank'>('cash')
  const [selectedChangeCashAccountId, setSelectedChangeCashAccountId] = useState<string>('')
  const [selectedChangeBankAccountDefinitionId, setSelectedChangeBankAccountDefinitionId] = useState<string>('')

  const [changeAccountBalance, setChangeAccountBalance] = useState<number | null>(null)
  const [changeAccountBalanceLoading, setChangeAccountBalanceLoading] = useState(false)

  const [payNowSource, setPayNowSource] = useState<string>('cash')
  const [bankAccounts, setBankAccounts] = useState<BankAccountDefinitionDto[]>([])
  const [selectedBankAccountDefinitionId, setSelectedBankAccountDefinitionId] = useState<string>('')

  const [selectedPosBankAccountDefinitionId, setSelectedPosBankAccountDefinitionId] = useState<string>('')

  const selectedAccountObj = useMemo(() => {
    if (payNowSource === 'cash') {
      return cashAccounts.find((x) => String(x.id) === String(selectedCashAccountId))
    }
    if (payNowSource === 'bank') {
      return bankAccounts.find((x) => String(x.id) === String(selectedBankAccountDefinitionId))
    }
    if (payNowSource === 'pos') {
      return bankAccounts.find((x) => String(x.id) === String(selectedPosBankAccountDefinitionId))
    }
    return null
  }, [payNowSource, selectedCashAccountId, selectedBankAccountDefinitionId, selectedPosBankAccountDefinitionId, cashAccounts, bankAccounts])

  const accountCurrencyCode = useMemo(() => {
    if (!selectedAccountObj) return 'TRY'
    const cCode = (selectedAccountObj as any)?.currencyCode || (selectedAccountObj as any)?.currency
    if (cCode && typeof cCode === 'string') return cCode.toUpperCase()
    const cTypeId = Number((selectedAccountObj as any)?.currencyTypeId)
    if (cTypeId === 1) return 'TRY'
    if (cTypeId === 2) return 'EUR'
    if (cTypeId === 3) return 'USD'
    if (cTypeId === 4) return 'GBP'
    return 'TRY'
  }, [selectedAccountObj])

  const targetFxRate = useMemo(() => {
    if (accountCurrencyCode === 'TRY') return 1
    const customInput = Number(String(customFxRateInput || paymentRateInput).replace(',', '.'))
    if (Number.isFinite(customInput) && customInput > 0) return customInput
    return 1
  }, [accountCurrencyCode, customFxRateInput, paymentRateInput])

  const selectedAccountLabel = useMemo(() => {
    if (!selectedAccountObj) return ''
    if (payNowSource === 'cash') {
      return `${(selectedAccountObj as any).name || ''} (${accountCurrencyCode})`
    }
    return `${(selectedAccountObj as any).accountName || (selectedAccountObj as any).name || ''} (${accountCurrencyCode})`
  }, [selectedAccountObj, payNowSource, accountCurrencyCode])

  const selectedChangeAccountObj = useMemo(() => {
    return cashAccounts.find((x) => String(x.id) === String(selectedChangeCashAccountId))
  }, [cashAccounts, selectedChangeCashAccountId])

  const selectedChangeAccountLabel = useMemo(() => {
    if (!selectedChangeAccountObj) return ''
    return `${selectedChangeAccountObj.name} (TL)`
  }, [selectedChangeAccountObj])

  /*
    "Müşterinin verdiği tutar" hesabı buradan KALDIRILDI (2026-08-19).

    `givenNum * targetFxRate` yalnızca fatura TL iken doğru bir TL tutarı üretiyordu; dövizli
    faturada oran ters yönde olduğu için anlamsız bir çarpım oluyordu. Para üstü artık
    `parsedCashReceivedInInvoiceCurrency` üzerinden, faturanın parasında hesaplanıyor
    (bkz. `changeInInvoiceCurrency`).
  */


  const [payNowBalanceLoading, setPayNowBalanceLoading] = useState(false)
  const [payNowBalance, setPayNowBalance] = useState<number | null>(null)

  const [fxOpen, setFxOpen] = useState(false)
  const [fxBusy, setFxBusy] = useState(false)
  const [fxCurrencyCode, setFxCurrencyCode] = useState('')
  const [fxFromCurrencyCode, setFxFromCurrencyCode] = useState('')
  const [fxFromAmount, setFxFromAmount] = useState(0)
  const [fxFromTryRate, setFxFromTryRate] = useState(1)
  const [fxRateLabel, setFxRateLabel] = useState('')
  const [fxRate, setFxRate] = useState('')
  const [fxInvoiceTryAmount, setFxInvoiceTryAmount] = useState(0)
  const [fxInvoiceBrut, setFxInvoiceBrut] = useState(0)
  const [fxInvoiceKdv, setFxInvoiceKdv] = useState(0)
  const [fxConfirmAction, setFxConfirmAction] = useState<null | ((rate: number) => Promise<void>)>(null)
  const [confirmCreateOpen, setConfirmCreateOpen] = useState(false)
  const [confirmCreateAction, setConfirmCreateAction] = useState<null | (() => Promise<void>)>(null)






  const [msgOpen, setMsgOpen] = useState(false)

  const [msgTitle, setMsgTitle] = useState('')

  const [msgText, setMsgText] = useState('')



  const showMessage = (title: string, text: string) => {

    setMsgTitle(String(title ?? ''))

    setMsgText(String(text ?? ''))

    setMsgOpen(true)

  }



  const MAX_SELECTED_LINES = 17

  useEffect(() => {
    void reloadCustomers()
  }, [])

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(POS_DRAFT_KEY)
      if (!raw) return
      const d = JSON.parse(raw)
      const cc = String(d?.selectedCustomer ?? '').trim()
      if (!cc) return

      setSelectedCustomer(cc)

      const nextSelected: Record<number, boolean> = {}
      const ids = Array.isArray(d?.selectedLineIds) ? d.selectedLineIds : []
      for (const id of ids) {
        const n = Number(id)
        if (Number.isFinite(n) && n > 0) nextSelected[n] = true
      }
      if (Object.keys(nextSelected).length) setSelectedLineIds(nextSelected)

      if (d?.invoiceQtyByLineId && typeof d.invoiceQtyByLineId === 'object') {
        const map: Record<number, number> = {}
        for (const [k, v] of Object.entries(d.invoiceQtyByLineId)) {
          const nk = Number(k)
          const nv = Number(v)
          if (!Number.isFinite(nk) || nk <= 0) continue
          if (!Number.isFinite(nv) || nv < 0) continue
          map[nk] = nv
        }
        setInvoiceQtyByLineId(map)
      }

      const savedDate = String(d?.invoiceDate ?? '').trim()
      if (savedDate) setInvoiceDate(savedDate)

      const savedWarehouse = String(d?.selectedWarehouseCode ?? '').trim()
      if (savedWarehouse) setSelectedWarehouseCode(savedWarehouse)
    } catch {
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])



  const reloadCustomers = async () => {

    try {

      setLoading(true)

      const token = localStorage.getItem('accessToken')

      const headers: Record<string, string> = {}

      if (token) headers.Authorization = `Bearer ${token}`



      const res = await fetch(`${API_BASE_URL}/api/salesorders/customers-with-orders?includeInactive=false`, { headers })

      if (!res.ok) {

        const text = await res.text()

        showMessage('Hata', text || 'Cari listesi alınamadı')

        setCustomersState([{ value: '', label: 'Seçiniz...' }])

        return

      }



      const json = await res.json()

      const items = (json?.data ?? []) as any[]

      const invoiceTypeMap: Record<string, string> = {}
      const priceGroupCodeMap: Record<string, number> = {}

      const opts = items
        .map((x) => {
          const code = String(x?.customerCode ?? '').trim()
          const name = String(x?.name ?? '').trim()
          const invoiceType = String(x?.invoiceType ?? x?.InvoiceType ?? '').trim()
          const pgCode = Number(x?.priceGroupCode ?? x?.priceGroup?.code ?? x?.PriceGroupCode ?? 0)

          if (!code) return null

          if (invoiceType) invoiceTypeMap[code] = invoiceType
          if (pgCode > 0) priceGroupCodeMap[code] = pgCode

          return { value: code, label: `[${code}] ${name || code}` }
        })
        .filter(Boolean) as CustomerOption[]

      setCustomersState([{ value: '', label: 'Seçiniz...' }, ...opts])
      setCustomerInvoiceTypeByCode(invoiceTypeMap)
      setCustomerPriceGroupCodeByCode(priceGroupCodeMap)

    } catch {

      setCustomersState([{ value: '', label: 'Seçiniz...' }])

      setCustomerInvoiceTypeByCode({})

    } finally {

      setLoading(false)

    }

  }



  const reloadLines = async (customerCode: string, isInitialForCustomer: boolean = false) => {
    const cc = String(customerCode ?? '').trim()

    if (!cc) {
      setLinesState([])
      setSelectedLineIds({})
      setInvoiceQtyByLineId({})
      setDraftSelectedLineIds({})
      setDraftInvoiceQtyByLineId({})
      setCustomMontajs({})
      setNote('')
      return
    }

    try {
      setLinesLoading(true)
      const token = localStorage.getItem('accessToken')
      const headers: Record<string, string> = {}
      if (token) headers.Authorization = `Bearer ${token}`

      const res = await fetch(`${API_BASE_URL}/api/salesorders/lines-for-invoice?customerCode=${encodeURIComponent(cc)}`, { headers })

      if (!res.ok) {
        const text = await res.text()
        showMessage('Hata', text || 'Sipariş listesi alınamadı')
        setLinesState([])
        setSelectedLineIds({})
        setInvoiceQtyByLineId({})
        setDraftSelectedLineIds({})
        setDraftInvoiceQtyByLineId({})
        setCustomMontajs({})
        setNote('')
        return
      }

      const json = await res.json()
      const items = (json?.data ?? []) as InvoiceLine[]
      setLinesState(items)

      if (isInitialForCustomer) {
        setSelectedLineIds({})
        setInvoiceQtyByLineId({})
        setDraftSelectedLineIds({})
        setDraftInvoiceQtyByLineId({})
        setCustomMontajs({})
        setNote('')
      } else {
        // Filter out non-existent items from committed selections
        setSelectedLineIds((prev) => {
          const next = { ...prev }
          for (const key of Object.keys(next)) {
            const numKey = Number(key)
            if (!items.some((x) => x.salesOrderLineId === numKey)) {
              delete next[numKey]
            }
          }
          return next
        })
        setInvoiceQtyByLineId((prev) => {
          const next = { ...prev }
          for (const key of Object.keys(next)) {
            const numKey = Number(key)
            if (!items.some((x) => x.salesOrderLineId === numKey)) {
              delete next[numKey]
            }
          }
          return next
        })
        // Filter out non-existent items from draft selections
        setDraftSelectedLineIds((prev) => {
          const next = { ...prev }
          for (const key of Object.keys(next)) {
            const numKey = Number(key)
            if (!items.some((x) => x.salesOrderLineId === numKey)) {
              delete next[numKey]
            }
          }
          return next
        })
        setDraftInvoiceQtyByLineId((prev) => {
          const next = { ...prev }
          for (const key of Object.keys(next)) {
            const numKey = Number(key)
            if (!items.some((x) => x.salesOrderLineId === numKey)) {
              delete next[numKey]
            }
          }
          return next
        })
      }
    } catch {
      setLinesState([])
      setSelectedLineIds({})
      setInvoiceQtyByLineId({})
      setDraftSelectedLineIds({})
      setDraftInvoiceQtyByLineId({})
      setNote('')
    } finally {
      setLinesLoading(false)
    }

  }

  const handleOpenMontajModal = async (l: InvoiceLine) => {
    if (customMontajs[l.salesOrderLineId]) {
      setMontajInitialValues(customMontajs[l.salesOrderLineId])
      setEditingMontajLineId(l.salesOrderLineId)
      setMontajModalOpen(true)
      return
    }

    try {
      setLinesLoading(true)
      const token = localStorage.getItem('accessToken')
      const headers: Record<string, string> = {}
      if (token) headers.Authorization = `Bearer ${token}`

      const res = await fetch(`${API_BASE_URL}/api/salesorders/lines/${l.salesOrderLineId}/installation`, { headers })
      const json = await res.json()

      if (json.success && json.data) {
        const data = json.data
        const initialVal = {
          isimSoyisim: data.installationName || '',
          telefon: data.installationPhone || '',
          adres: data.address || '',
          bolge: data.region || '',
          bayiAciklama: data.dealerDescription || '',
          bayiAdi: data.dealerName || l.customerCode || selectedCustomer || '',
          urunAdi: data.productName || l.productName || '',
          miktar: data.quantity || l.orderQuantity || 1
        }
        setMontajInitialValues(initialVal)
        setEditingMontajLineId(l.salesOrderLineId)
        setMontajModalOpen(true)
      } else {
        throw new Error('No data')
      }
    } catch (err) {
      console.error('Failed to load installation:', err)
      const initialVal = {
        isimSoyisim: '',
        telefon: '',
        adres: '',
        bolge: '',
        bayiAciklama: '',
        bayiAdi: l.customerCode || selectedCustomer || '',
        urunAdi: l.productName || '',
        miktar: l.orderQuantity || 1
      }
      setMontajInitialValues(initialVal)
      setEditingMontajLineId(l.salesOrderLineId)
      setMontajModalOpen(true)
    } finally {
      setLinesLoading(false)
    }
  }

  const handleSaveMontaj = (details: any) => {
    if (editingMontajLineId !== null) {
      setCustomMontajs((prev) => ({
        ...prev,
        [editingMontajLineId]: details
      }))
    }
    setMontajModalOpen(false)
    setEditingMontajLineId(null)
    setMontajInitialValues(null)
  }

  const handleDeleteLine = async (l: InvoiceLine) => {
    const maxQty = Number(l.remainingQuantity ?? l.orderQuantity ?? 0)
    let deleteQty: number | null = null

    if (maxQty > 1) {
      const input = window.prompt(`Silmek/azaltmak istediğiniz miktarı giriniz (Kalan Miktar: ${maxQty}):`, String(maxQty))
      if (input === null) return // Canceled
      const parsed = Number(input)
      if (Number.isNaN(parsed) || parsed <= 0 || parsed > maxQty) {
        showMessage('Hata', 'Lütfen geçerli bir miktar giriniz.')
        return
      }
      deleteQty = parsed
    } else {
      if (!window.confirm('Bu kalemi silmek istediğinize emin misiniz?')) {
        return
      }
    }

    try {
      setLinesLoading(true)
      const token = localStorage.getItem('accessToken')
      const headers: Record<string, string> = {}
      if (token) headers.Authorization = `Bearer ${token}`

      const url = `${API_BASE_URL}/api/salesorders/lines/${l.salesOrderLineId}` + (deleteQty ? `?quantity=${deleteQty}` : '')
      const res = await fetch(url, {
        method: 'DELETE',
        headers
      })

      if (!res.ok) {
        throw new Error(await readErrorText(res))
      }

      showToast('Kalem başarıyla silindi/azaltıldı.')
      // Refresh the lines!
      await reloadLines(selectedCustomer)
    } catch (err: any) {
      showMessage('Hata', err?.message || 'Kalem silinirken hata oluştu')
    } finally {
      setLinesLoading(false)
    }
  }


  useEffect(() => {
    const ac = new AbortController()
    void (async () => {
      try {
        setWarehousesLoading(true)
        const list = await fetchAuthorizedWarehousesDropdown({ signal: ac.signal })
        setWarehouses(list ?? [])

        if ((list ?? []).length === 1) {
          const only = list[0]
          if (only?.warehouseCode) setSelectedWarehouseCode(String(only.warehouseCode))
        }
      } catch {
        setWarehouses([])
      } finally {
        setWarehousesLoading(false)
      }
    })()
    return () => ac.abort()
  }, [])

  /**
   * KALEM BAZLI ÇIKIŞ DEPOSU (kullanıcı kuralı, 2026-08-13).
   *
   * Fatura başlığındaki depo hâlâ varsayılan; bu sözlük yalnızca "bu kalem farklı bir depodan
   * çıkacak" diyen satırları taşır. İki kaynağı var:
   *   - servisten gelen kalemin damgası (`sourceWarehouseCode`) — otomatik doldurulur,
   *   - kullanıcının satır bazında yaptığı seçim — damganın üzerine yazar.
   *
   * Neden gerekiyor: müdür faturayı imzalıyor ama parça teknisyenin araç deposundan çıkmış
   * oluyor. Tek depoyla kesilen fatura hem müdürün deposunu eksiye düşürüyor hem teknisyenin
   * arabasındaki stoğu olduğu gibi bırakıyordu.
   */
  const [lineWarehouseByLineId, setLineWarehouseByLineId] = useState<Record<number, string>>({})

  const userHasSingleWarehouse = useMemo(() => warehouses.length === 1, [warehouses.length])
  const resolvedWarehouseCode = useMemo(() => {
    if (userHasSingleWarehouse) return String(warehouses[0]?.warehouseCode ?? '')
    return String(selectedWarehouseCode ?? '')
  }, [selectedWarehouseCode, userHasSingleWarehouse, warehouses])

  const selectedCustomerLabel = useMemo(() => {
    if (!selectedCustomer) return ''
    const found = customersState.find((c) => c.value === selectedCustomer)
    return found ? found.label : selectedCustomer
  }, [selectedCustomer, customersState])

  /**
   * KALEMİN ÖNTANIMLI DEPOSU — sunucudan gelir, ekranda TAHMİN EDİLMEZ.
   *
   * `defaultWarehouseCode`: servis damgası, yoksa kalemi GİREN kişinin varsayılan deposu
   * (bkz. `SalesOrdersController.FillDefaultWarehousesAsync`). `sourceWarehouseCode` yalnızca
   * eski/ önbellekten gelen yanıtlar için geriye dönük yedek.
   *
   * NEGATİF DEPO KODU GEÇERLİDİR (ör. -21 YP SİPARİŞ); kontroller `!== 0`.
   */
  const lineDefaultWarehouseCode = useCallback(
    (line: { sourceWarehouseCode?: number | null; defaultWarehouseCode?: number | null }): number => {
      const fromServer = Number(line.defaultWarehouseCode ?? 0)
      if (fromServer !== 0) return fromServer
      return Number(line.sourceWarehouseCode ?? 0) || 0
    },
    []
  )

  /**
   * Bir kalemin gerçek çıkış deposu: kullanıcının satır seçimi > kalemin öntanımlı deposu >
   * başlıktaki TOPLU depo. Sıralama kasıtlı — kullanıcı öntanımlıyı ezebilir, ama hiçbiri yoksa
   * başlıktaki toplu seçim yalnızca BOŞ kalemleri doldurur.
   *
   * Not: burası eskiden hiçbir depo çözülemediğinde 0 dönüyordu ve seçicide 0'a karşılık gelen
   * bir seçenek olmadığı için tarayıcı listenin ilk deposunu (-21 YP SİPARİŞ) gösteriyordu.
   * Ekran "her kalem -21'den çıkıyor" diyordu ama arkada hiçbir depo seçili değildi. Bu yüzden
   * seçicide artık gerçek bir boş seçenek var.
   */
  const resolveLineWarehouseCode = useCallback(
    (line: { salesOrderLineId: number; sourceWarehouseCode?: number | null; defaultWarehouseCode?: number | null }): number => {
      const manual = lineWarehouseByLineId[line.salesOrderLineId]
      if (manual && String(manual).trim()) return Number(manual) || 0
      const preset = lineDefaultWarehouseCode(line)
      if (preset !== 0) return preset
      return Number(resolvedWarehouseCode) || 0
    },
    [lineWarehouseByLineId, resolvedWarehouseCode, lineDefaultWarehouseCode]
  )

  /** Depo kodunu okunabilir ada çevirir; liste henüz gelmediyse kodu basar. */
  const warehouseLabel = useCallback(
    (code: number): string => {
      if (!code) return '-'
      const w = warehouses.find((x) => Number(x.warehouseCode) === Number(code))
      // Yetkili olunmayan (başkasının deposundan damgalanmış) depo listede olmaz; kodu basmak yeterli.
      return w ? `${w.warehouseCode} - ${w.name ?? ''}`.trim() : `${code} (Diğer Depo)`
    },
    [warehouses]
  )

  const resolvedWarehouseName = useMemo(() => {
    const code = Number(resolvedWarehouseCode)
    if (!code) return ''
    const w = warehouses.find((x) => x.warehouseCode === code)
    return w ? `${w.name} (${w.warehouseCode})` : String(code)
  }, [resolvedWarehouseCode, warehouses])

  useEffect(() => {
    const ac = new AbortController()
    void (async () => {
      try {
        const list = await fetchCashAccounts({ signal: ac.signal })
        setCashAccounts(list ?? [])
        if ((list ?? []).length === 1) {
          const only = list[0]
          if (only?.id) setSelectedCashAccountId(String(only.id))
        }
      } catch {
        setCashAccounts([])
      }
    })()
    return () => ac.abort()
  }, [])

  useEffect(() => {
    const ac = new AbortController()
    void (async () => {
      try {
        const list = await fetchBankAccountDefinitions({ signal: ac.signal })
        setBankAccounts(list ?? [])
        if ((list ?? []).length === 1) {
          const only = list[0]
          if (only?.id) setSelectedBankAccountDefinitionId(String(only.id))
        }
      } catch {
        setBankAccounts([])
      }
    })()
    return () => ac.abort()
  }, [])

  useEffect(() => {
    if (changeSource === 'cash') {
      const cashId = Number(selectedChangeCashAccountId)
      if (!(cashId > 0)) {
        setChangeAccountBalance(null)
        return
      }
      const acc = cashAccounts.find(c => Number(c.id) === cashId)
      setChangeAccountBalance(acc ? Number(acc.balance) : 0)
    } else if (changeSource === 'bank') {
      const bankId = Number(selectedChangeBankAccountDefinitionId)
      if (!(bankId > 0)) {
        setChangeAccountBalance(null)
        return
      }
      const ac = new AbortController()
      void (async () => {
        try {
          setChangeAccountBalanceLoading(true)
          const b = await fetchBankAccountBalance(bankId, { signal: ac.signal })
          setChangeAccountBalance(Number(b?.balance ?? 0))
        } catch {
          setChangeAccountBalance(null)
        } finally {
          setChangeAccountBalanceLoading(false)
        }
      })()
      return () => ac.abort()
    } else {
      setChangeAccountBalance(null)
    }
  }, [changeSource, selectedChangeCashAccountId, selectedChangeBankAccountDefinitionId, cashAccounts])

  const cashAccountOptions = useMemo(() => {
    return (cashAccounts ?? [])
      .map((c) => ({ value: String(c.id), label: `${c.code}${c.name ? ` - ${c.name}` : ''}` }))
      .sort((a, b) => a.label.localeCompare(b.label, 'tr-TR'))
  }, [cashAccounts])

  const bankAccountOptions = useMemo(() => {
    return (bankAccounts ?? [])
      .map((b) => ({ value: String(b.id), label: `${b.accountCode}${b.accountName ? ` - ${b.accountName}` : ''}` }))
      .sort((a, b) => a.label.localeCompare(b.label, 'tr-TR'))
  }, [bankAccounts])

  const posAccountOptions = useMemo(() => {
    return (bankAccounts ?? [])
      .filter((b) => Number((b as any)?.accountType ?? 0) === 14)
      .map((b) => ({ value: String(b.id), label: `${b.accountCode}${b.accountName ? ` - ${b.accountName}` : ''}` }))
  }, [bankAccounts])

  const reloadPayNowBalance = async () => {
    const source = String(payNowSource ?? '')
    const cashId = Number(selectedCashAccountId) || 0
    const bankId = Number(selectedBankAccountDefinitionId) || 0
    const posId = Number(selectedPosBankAccountDefinitionId) || 0

    if (source === 'cash') {
      if (cashId <= 0) {
        setPayNowBalance(null)
        return
      }
      const ac = new AbortController()
      try {
        setPayNowBalanceLoading(true)
        const b = await fetchCashAccountBalance(cashId, { signal: ac.signal })
        setPayNowBalance(Number((b as any)?.balance ?? (b as any)?.Balance ?? 0))
      } catch {
        setPayNowBalance(null)
      } finally {
        setPayNowBalanceLoading(false)
      }
      return
    }

    if (source === 'bank') {
      if (bankId <= 0) {
        setPayNowBalance(null)
        return
      }
      const ac = new AbortController()
      try {
        setPayNowBalanceLoading(true)
        const b = await fetchBankAccountBalance(bankId, { signal: ac.signal })
        setPayNowBalance(Number(b?.balance ?? 0))
      } catch {
        setPayNowBalance(null)
      } finally {
        setPayNowBalanceLoading(false)
      }
    }

    if (source === 'pos') {
      if (posId <= 0) {
        setPayNowBalance(null)
        return
      }
      const ac = new AbortController()
      try {
        setPayNowBalanceLoading(true)
        const b = await fetchBankAccountBalance(posId, { signal: ac.signal })
        setPayNowBalance(Number(b?.balance ?? 0))
      } catch {
        setPayNowBalance(null)
      } finally {
        setPayNowBalanceLoading(false)
      }
    }
  }

  useEffect(() => {
    void reloadPayNowBalance()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payNowSource, selectedCashAccountId, selectedBankAccountDefinitionId, selectedPosBankAccountDefinitionId])

  const selectedStockCodes = useMemo(() => {
    return linesState
      .filter((x) => Boolean(selectedLineIds[x.salesOrderLineId]))
      .map((x) => String(x.stockCode ?? '').trim())
      .filter(Boolean)
      .filter((x, idx, arr) => arr.findIndex((y) => y.toLowerCase() === x.toLowerCase()) === idx)
  }, [linesState, selectedLineIds])

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

  const balanceByStockCode = useMemo(() => {
    const map = new Map<string, Array<{ warehouseCode: number; balance: number }>>()
      ; (balances?.items ?? []).forEach((it) => {
        const sc = String(it?.stockCode ?? '').trim()
        if (!sc) return
        map.set(sc, (it?.balances ?? []).map((b) => ({ warehouseCode: Number(b.warehouseCode), balance: Number(b.balance) || 0 })))
      })
    return map
  }, [balances])

  const selectedProducts = useMemo(() => {
    return linesState
      .filter((x) => Boolean(selectedLineIds[x.salesOrderLineId]))
      .map((l) => ({ stockCode: String(l.stockCode ?? '').trim(), name: String(l.productName ?? '').trim() }))
      .filter((x) => x.stockCode)
      .filter((x, idx, arr) => arr.findIndex((y) => y.stockCode.toLowerCase() === x.stockCode.toLowerCase()) === idx)
  }, [linesState, selectedLineIds])

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



  const isOpenCustomer = useMemo(() => {
    const t = String(customerInvoiceTypeByCode[selectedCustomer] ?? '').trim().toLowerCase()
    const pgCode = customerPriceGroupCodeByCode[selectedCustomer]
    return t === 'açık' || t === 'acik' || t === 'acık' || (pgCode !== undefined && pgCode >= 4 && pgCode <= 6)
  }, [customerInvoiceTypeByCode, customerPriceGroupCodeByCode, selectedCustomer])

  const isAskeriyeCustomer = useMemo(() => {
    if (!selectedCustomer) return false
    const pgCode = customerPriceGroupCodeByCode[selectedCustomer]
    if (pgCode === 7) return true
    const invType = String(customerInvoiceTypeByCode[selectedCustomer] ?? '').trim().toUpperCase()
    if (invType === 'ASKERIYE' || invType === 'ASKERİYE') return true
    const lbl = String(selectedCustomerLabel || '').toUpperCase()
    if (lbl.includes('ASKERİYE') || lbl.includes('ASKERIYE') || selectedCustomer.toUpperCase().includes('ASKER')) return true
    return false
  }, [selectedCustomer, customerPriceGroupCodeByCode, customerInvoiceTypeByCode, selectedCustomerLabel])



  useEffect(() => {
    setInvoiceNumber('')
    setInvoiceSerie('A')
  }, [selectedCustomer])


  useEffect(() => {
    void (async () => {
      if (!selectedCustomer) {
        await reloadLines('', true)
        return
      }

      await reloadLines(selectedCustomer, true)
    })()
  }, [selectedCustomer])

  useEffect(() => {
    const onFocus = () => {
      void reloadCustomers()
      if (selectedCustomer) {
        void reloadLines(selectedCustomer, false)
      }
    }

    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [selectedCustomer, location.pathname])



  const computedInvoiceNo = useMemo(() => {
    if (!selectedCustomer) return ''
    if (isOpenCustomer) return 'Otomatik Oluşturulacak'
    const numStr = String(invoiceNumber ?? '').replace(/[^0-9]/g, '')
    if (!numStr) return ''
    const prefix = invoiceSerie || 'A'
    return prefix + numStr.padStart(Math.max(0, 15 - prefix.length), '0')
  }, [selectedCustomer, isOpenCustomer, invoiceNumber, invoiceSerie])



  const selectedLines = useMemo(() => {

    const picked = linesState.filter((x) => Boolean(selectedLineIds[x.salesOrderLineId]))

    return picked

  }, [linesState, selectedLineIds])

  /**
   * Faturanın BAŞLIK deposu — sunucu bunu hâlâ zorunlu tutuyor.
   *
   * Kullanıcının bildirdiği hata: her kalemin kendi deposu seçili olmasına rağmen "Depo seçiniz"
   * uyarısı çıkıyordu. Sebebi, doğrulamanın yalnızca üstteki tek seçiciye bakmasıydı; servisten
   * gelen kalem depoyu zaten damgalı getirdiği için üstteki seçici çoğu zaman boş kalıyor.
   *
   * Artık başlık deposu boşsa seçili kalemlerin çözülmüş depolarından İLKİNE düşülüyor: fatura
   * başlığı bir yere yazılmak zorunda ve kalemler kendi depolarını zaten satır satır taşıyor.
   */
  const effectiveWarehouseCode = useMemo(() => {
    const header = Number(resolvedWarehouseCode) || 0
    if (header !== 0) return header

    for (const line of selectedLines) {
      const manual = Number(lineWarehouseByLineId[line.salesOrderLineId] ?? 0)
      if (manual !== 0) return manual
      const preset = lineDefaultWarehouseCode(line)
      if (preset !== 0) return preset
    }
    return 0
  }, [resolvedWarehouseCode, selectedLines, lineWarehouseByLineId, lineDefaultWarehouseCode])

  /**
   * BAŞLIKTAKİ DEPO ARTIK "TOPLU DEPO" (kullanıcı kuralı, 2026-08-14).
   *
   * Kalemlerin kendi deposu varsa üstte depo sormanın anlamı yok. Bu sayaç, üstteki seçicinin
   * gösterilip gösterilmeyeceğine karar veriyor: yalnızca deposu ÇÖZÜLEMEYEN kalem kaldığında
   * seçici çıkar ve seçim yalnızca o boş kalemleri doldurur (dolu kalemler ezilmez —
   * `resolveLineWarehouseCode` başlığı en sona koyuyor).
   */
  const linesMissingWarehouseCount = useMemo(
    () =>
      linesState.filter((l) => {
        const manual = String(lineWarehouseByLineId[l.salesOrderLineId] ?? '').trim()
        if (manual) return false
        return lineDefaultWarehouseCode(l) === 0
      }).length,
    [linesState, lineWarehouseByLineId, lineDefaultWarehouseCode]
  )




  const allSelected = useMemo(() => {

    if (linesState.length === 0) return false

    return linesState.every((l) => Boolean(selectedLineIds[l.salesOrderLineId]))

  }, [linesState, selectedLineIds])



  const fxTotals = useMemo(() => {
    if (!selectedLines || selectedLines.length === 0) return null

    const activeRate = getActiveUserDiscountRate(layout)

    const dv = Number(String(discountValue ?? '0').replace(',', '.'))
    const discountRaw = Number.isFinite(dv) ? dv : 0
    let manualDiscount = 0
    let manualDiscountPercent: number | null = null
    let maxDiscountRate: number | null = null

    if (discountType === 'amount') {
      const rate = Number(String(invoiceRateInput || paymentRateInput).replace(',', '.')) || 1
      manualDiscount = rate > 0 ? discountRaw / rate : discountRaw
      maxDiscountRate = activeRate
    } else {
      manualDiscountPercent = Math.min(discountRaw, activeRate)
    }

    return computeSingleCurrencySummary(
      selectedLines as any[],
      invoiceQtyByLineId as any,
      kampanyaAyrimi.doc,
      manualDiscount,
      isAskeriyeCustomer || isOpenCustomer,
      manualDiscountPercent,
      maxDiscountRate
    )
  }, [invoiceQtyByLineId, selectedLines, kampanyaAyrimi, isAskeriyeCustomer, isOpenCustomer, discountType, discountValue, invoiceRateInput, paymentRateInput, layout?.isSuperSuperAdmin, layout?.roleCode, layout?.userDiscountRate])

  const invoiceCurrencyTypeId = useMemo(() => Number(fxTotals?.currencyTypeId ?? 0), [fxTotals?.currencyTypeId])
  const invoiceCurrencyCode = useMemo(() => currencyCodeByTypeId(invoiceCurrencyTypeId), [invoiceCurrencyTypeId])

  // Itemized breakdown of all campaign discounts for modal and totals
  const campaignBreakdown = useMemo(() => {
    const selected = selectedLines
    if (selected.length === 0) return []

    /*
      Her kalem TÜRÜNÜ taşır; toplam hesabı (`kampanyaliToplam`) ikisini farklı uygular:
        line  → KDV HARİÇ, yalnız kendi kalemini ve kendi oranıyla KDV'sini küçültür
        order → sipariş geneli, KDV DAHİL (genel toplamdan düşer)
      `amount` TL çapasıdır (siparişteki gibi); `amountDoc` belgenin parasındaki karşılığı —
      sunucudaki `ToDocCurrency` ile aynı: dövizli kalemde siparişin donmuş kuruna bölünür.
    */
    const items: Array<{
      title: string
      subtitle?: string
      amount: number
      isGift?: boolean
      kind: 'gift' | 'line' | 'order'
      amountDoc: number
      vatRate?: number
      /** Kalemin indirimsiz tutarı (TL / belge parası) — kampanya bunu aşamaz. */
      tutar?: number
      tutarDoc?: number
    }> = []

    // 1. Gift lines and line-level campaign discounts
    for (const line of selected) {
      const qty = Number(
        invoiceQtyByLineId[line.salesOrderLineId] ??
        line.remainingQuantity ??
        line.orderQuantity ??
        0
      )
      if (qty <= 0) continue

      const unitP = fxTotals ? Number(line.currencyUnitPrice || line.unitPrice || 0) : Number(line.unitPrice ?? 0)

      if (line.isGift) {
        const giftUnitPrice = 0.01
        const giftAmount = qty * giftUnitPrice
        items.push({
          title: `🎁 Hediye Ürün: ${line.productName || line.stockCode}`,
          subtitle: `${qty} Adet x ${giftUnitPrice.toFixed(2)} ${invoiceCurrencyCode} (Hediye Ürün)`,
          amount: giftAmount,
          isGift: true,
          kind: 'gift',
          amountDoc: giftAmount
        })
      } else if (Number(line.discountAmount ?? 0) > 0 && Number(line.orderQuantity ?? 0) > 0) {
        const allLinesForOrder = linesState.filter((l) => l.salesOrderId === line.salesOrderId)
        const hasMatchingGiftLine = allLinesForOrder.some(
          (l) => l.isGift && Math.abs(Number(l.unitPrice || 0) * Number(l.orderQuantity || 0) - Number(line.discountAmount || 0)) < 0.01
        )
        const parsedDesc = parseCampaignLine(line.description)

        if (!hasMatchingGiftLine || parsedDesc) {
          const prorate = Math.min(1, qty / Number(line.orderQuantity))
          const lineDisc = Number(line.discountAmount) * prorate
          const dovizli = Number(line.currencyTypeId ?? 0) > 1
          const kur = Number(line.currencyRate ?? 0)
          const docUnit = dovizli && Number(line.currencyUnitPrice ?? 0) > 0
            ? Number(line.currencyUnitPrice)
            : Number(line.unitPrice ?? 0)
          items.push({
            title: `🏷️ ${line.productName || line.stockCode} Kampanya İndirimi`,
            subtitle: parsedDesc || `Satır İndirimi (${qty} Adet)`,
            amount: lineDisc,
            kind: 'line',
            amountDoc: dovizli && kur > 0 ? lineDisc / kur : lineDisc,
            vatRate: Number(line.vatRate ?? 0),
            tutar: qty * Number(line.unitPrice ?? 0),
            tutarDoc: qty * docUnit
          })
        }
      }
    }

    // 2. Pure order-level campaign discounts (e.g. Quantity-Tiered, Basket discount)
    const selectedByOrderId = new Map<number, typeof selected>()
    for (const line of selected) {
      const arr = selectedByOrderId.get(line.salesOrderId) || []
      arr.push(line)
      selectedByOrderId.set(line.salesOrderId, arr)
    }

    for (const [orderId, orderLines] of selectedByOrderId.entries()) {
      const allLinesForOrder = linesState.filter((l) => l.salesOrderId === orderId)
      const orderCampaignDiscount = Number(allLinesForOrder[0]?.campaignDiscount ?? 0)
      if (orderCampaignDiscount <= 0) continue

      // Hediyenin indirimi de kalem kampanyasıdır; "sipariş geneli" sayılırsa hediyenin değeri
      // faturadan bir daha düşülür (sunucudaki CreateSalesInvoice ile aynı, 2026-10-01).
      const totalLineDiscountsSum = allLinesForOrder.reduce((sum, l) => {
        return sum + Number(l.discountAmount ?? 0)
      }, 0)

      const pureOrderLevelPart = Math.max(0, orderCampaignDiscount - totalLineDiscountsSum)
      if (pureOrderLevelPart <= 0) continue

      const orderSubtotal = allLinesForOrder.reduce((sum, l) => {
        if (l.isGift) return sum
        return sum + Number(l.orderQuantity ?? 0) * Number(l.unitPrice ?? 0)
      }, 0)

      if (orderSubtotal <= 0) continue

      const selectedGrossForOrder = orderLines.reduce((sum, l) => {
        if (l.isGift) return sum
        const qty = Number(
          invoiceQtyByLineId[l.salesOrderLineId] ??
          l.remainingQuantity ??
          l.orderQuantity ??
          0
        )
        return sum + qty * Number(l.unitPrice ?? 0)
      }, 0)

      if (selectedGrossForOrder <= 0) continue

      const ratio = Math.min(1, Math.max(0, selectedGrossForOrder / orderSubtotal))
      const proratedOrderDiscount = pureOrderLevelPart * ratio

      if (proratedOrderDiscount > 0) {
        const orderNo = allLinesForOrder[0]?.orderNo ? ` (Sipariş: ${allLinesForOrder[0].orderNo})` : ''
        const ilkKalem = orderLines[0]
        const dovizli = Number(ilkKalem?.currencyTypeId ?? 0) > 1
        const kur = Number(ilkKalem?.currencyRate ?? 0)
        items.push({
          title: `💥 Genel Kampanya İndirimi${orderNo}`,
          subtitle: `Sipariş Geneli İndirim Payı`,
          amount: proratedOrderDiscount,
          kind: 'order',
          amountDoc: dovizli && kur > 0 ? proratedOrderDiscount / kur : proratedOrderDiscount
        })
      }
    }

    return items
  }, [selectedLines, invoiceQtyByLineId, linesState, fxTotals, invoiceCurrencyCode])

  // Automatically calculate campaign discount total from campaign breakdown (excluding gift items already priced at symbolic price)
  useEffect(() => {
    const total = campaignBreakdown.reduce((sum, item) => {
      if (item.isGift) return sum
      return sum + item.amount
    }, 0)
    setCampaignDiscountTotal(total)

    // Kampanyanın parçaları — toplamlar bunlarla, sunucuyla BİREBİR hesaplanır.
    const tl = { satirNet: 0, satirKdv: 0, siparisGeneli: 0 }
    const doc = { satirNet: 0, satirKdv: 0, siparisGeneli: 0 }
    for (const item of campaignBreakdown) {
      if (item.kind === 'line') {
        const oran = Number(item.vatRate ?? 0) / 100
        const netTl = Math.min(item.amount, item.tutar ?? item.amount)
        const netDoc = Math.min(item.amountDoc, item.tutarDoc ?? item.amountDoc)
        tl.satirNet += netTl
        tl.satirKdv += netTl * oran
        doc.satirNet += netDoc
        doc.satirKdv += netDoc * oran
      } else if (item.kind === 'order') {
        tl.siparisGeneli += item.amount
        doc.siparisGeneli += item.amountDoc
      }
    }
    const ayni = (a: KampanyaAyrimi, b: KampanyaAyrimi) =>
      a.satirNet === b.satirNet && a.satirKdv === b.satirKdv && a.siparisGeneli === b.siparisGeneli
    setKampanyaAyrimi((prev) => (ayni(prev.tl, tl) && ayni(prev.doc, doc) ? prev : { tl, doc }))
  }, [campaignBreakdown])

  const isDirty = useMemo(() => {
    const equals = (a: any, b: any) => {
      const keysA = Object.keys(a).filter(k => Boolean(a[k]))
      const keysB = Object.keys(b).filter(k => Boolean(b[k]))
      if (keysA.length !== keysB.length) return false
      for (const k of keysA) {
        if (a[k] !== b[k]) return false
      }
      return true
    }
    const qtyEquals = (a: any, b: any) => {
      const keysA = Object.keys(a).filter(k => Number(a[k]) > 0)
      const keysB = Object.keys(b).filter(k => Number(b[k]) > 0)
      if (keysA.length !== keysB.length) return false
      for (const k of keysA) {
        if (Number(a[k]) !== Number(b[k])) return false
      }
      return true
    }
    return !equals(draftSelectedLineIds, selectedLineIds) || !qtyEquals(draftInvoiceQtyByLineId, invoiceQtyByLineId)
  }, [draftSelectedLineIds, selectedLineIds, draftInvoiceQtyByLineId, invoiceQtyByLineId])

  /**
   * FATURANIN DÖVİZİNİ İLK SEÇİLEN KALEM KİLİTLER (2026-08-20 kullanıcı kararı).
   *
   * Seçili kalem yoksa null döner: bütün kalemler seçilebilir durumdadır. İlk kalem
   * işaretlendiği anda faturanın dövizi bellidir ve farklı dövizli satırlar kilitlenir.
   *
   * Neden gerekli: ekran USD bir kalemle TRY bir kalemi birlikte seçtirebiliyordu. O durumda
   * `computeSingleCurrencySummary` null dönüyor, sayfa sessizce TL moduna düşüyor ve dövizli
   * kalem O ANKİ kurdan TL'ye çevrilip toplama giriyordu. Yani fatura "iki dövizli" olmuyor,
   * dövizli kalemin döviz kimliğini KAYBEDİYORDU: sonradan kur değişince o satırın aslında
   * kaç dolar olduğu belgede kalmıyor, cari ekstresinde döviz bakiyesi tutmuyordu.
   */
  const draftCurrencyTypeId = useMemo(() => {
    for (const l of linesState) {
      if (draftSelectedLineIds[l.salesOrderLineId]) return lineCurrencyTypeId(l)
    }
    return null
  }, [linesState, draftSelectedLineIds])

  const toggleSelectAll = () => {
    if (linesState.length === 0) return
    const limit = Math.min(linesState.length, MAX_SELECTED_LINES)
    const draftAllSelected = linesState.length > 0 && linesState.slice(0, limit).every((l) => Boolean(draftSelectedLineIds[l.salesOrderLineId]))

    if (draftAllSelected) {
      setDraftSelectedLineIds({})
      setDraftInvoiceQtyByLineId({})
      return
    }

    // "Hepsini Seç" de tek dövize uyar: listedeki İLK kalemin dövizi esas alınır, farklı
    // dövizli satırlar atlanır. Aksi hâlde tek tıkla karışık fatura kurulabilirdi.
    const anchorCurrency = lineCurrencyTypeId(linesState[0])

    const nextSelected: Record<number, boolean> = {}
    const nextQty: Record<number, number> = {}
    let skippedByCurrency = 0

    for (let i = 0; i < limit; i++) {
      const l = linesState[i]
      if (lineCurrencyTypeId(l) !== anchorCurrency) {
        skippedByCurrency++
        continue
      }
      nextSelected[l.salesOrderLineId] = true
      nextQty[l.salesOrderLineId] = Number(l.remainingQuantity ?? l.orderQuantity ?? 0)
    }

    setDraftSelectedLineIds(nextSelected)
    setDraftInvoiceQtyByLineId(nextQty)

    // İki uyarı da çıkabilir (hem sınır aşıldı hem farklı dövizli kalem atlandı); biri
    // diğerini gizlerse kullanıcı listede neden eksik seçim gördüğünü anlayamaz.
    const notlar: string[] = []

    if (linesState.length > MAX_SELECTED_LINES) {
      notlar.push(`En fazla ${MAX_SELECTED_LINES} kalem seçilebilir; ilk ${MAX_SELECTED_LINES} kalem değerlendirildi.`)
    }

    if (skippedByCurrency > 0) {
      notlar.push(
        `Bir faturada tek döviz olabilir. ${currencyCodeByTypeId(anchorCurrency)} kalemler seçildi, farklı dövizli ${skippedByCurrency} kalem atlandı — onlar için ayrı fatura kesin.`
      )
    }

    if (notlar.length > 0) {
      showMessage('Uyarı', notlar.join(' '))
    }
  }



  useEffect(() => {

    const seen = new Set<string>()

    const parts = selectedLines

      .map((x) => {
        const full = String(x.description ?? '').trim()
        const userLines = full.split('\n').filter((l) => {
          const t = l.trim()
          return t.length > 0 && !t.startsWith('Montaj (KDV') && !t.startsWith('[MONTAJ')
        })
        const cleaned = userLines.join('\n').trim()
        if (!cleaned) return ''

        // E-ticaret siparişindeki müşterinin teslimat notu, bayi siparişindeki serbest
        // notla karışmasın diye "MN:" (Müşteri Notu) ön ekiyle ayrılıyor (2026-09-13
        // kullanıcı isteği). Aynı siparişin her kalemi aynı notu taşıyor (bkz.
        // SalesOrdersController.cs CreateEcommerceOrder: Description = request.DeliveryNote);
        // birden çok kalem seçilince alttaki `seen` tekrarını eliyor.
        const isEcommerce = String(x.processedBy ?? '').trim().toUpperCase() === 'ETICARET'
        return isEcommerce ? `MN: ${cleaned}` : cleaned
      })

      .filter(Boolean)

      .filter((line) => {
        if (seen.has(line)) return false
        seen.add(line)
        return true
      })

    setNote(parts.join('\n'))

  }, [selectedLines])



  const totals = useMemo(() => {
    if (selectedLines.length === 0) {
      return { subtotal: 0, kdvDahilTaban: 0, discount: 0, campaignDiscount: 0, netTotal: 0, vatTotal: 0, grandTotal: 0 }
    }

    const subtotal = selectedLines.reduce((acc, l) => {

      const qty = Number(invoiceQtyByLineId[l.salesOrderLineId] ?? 0)

      // Hediye faturaya 0,01'den girer (sunucu `GetLineActualUnitPrice`, dövizli özet de böyle);
      // "indirim satırı" modunda siparişte normal fiyatıyla durduğu için burada sabitleniyor.
      return acc + qty * (l.isGift ? 0.01 : Number(l.unitPrice ?? 0))

    }, 0)

    const vatTotal = (isOpenCustomer || isAskeriyeCustomer)
      ? 0
      : selectedLines.reduce((acc, l) => {
          const qty = Number(invoiceQtyByLineId[l.salesOrderLineId] ?? 0)
          if (l.isGift) return acc // Skip KDV for gift items
          const baseTotal = qty * Number(l.unitPrice ?? 0)
          const vat = baseTotal * (Number(l.vatRate ?? 0) / 100)
          return acc + vat
        }, 0)

    /*
      YÜZDE İNDİRİM KDV DAHİL TABANDAN (2026-09-16) — sunucudaki `CreateSalesInvoice` ile aynı.
      Girilen iskonto KDV dahil sayılıyor; yüzde ise KDV hariç ara toplamdan alınıyordu. %10 KDV'li
      faturada %10 indirim genel toplamı ara toplama eşitliyordu (63.840 → 58.036,36; doğrusu
      57.456,00). Tutar iskontosunun üst sınırı da aynı tabana bakar.
    */
    const kdvDahilTaban = subtotal + vatTotal

    const activeRate = getActiveUserDiscountRate(layout)

    const dv = Number(String(discountValue ?? '0').replace(',', '.'))

    const discountRaw = Number.isFinite(dv) ? dv : 0

    let discount = 0

    if (discountType === 'amount') {
      const maxAllowed = kdvDahilTaban * (activeRate / 100)
      discount = Math.max(0, Math.min(discountRaw, maxAllowed))
    } else {
      const cappedPercent = Math.min(discountRaw, activeRate)
      discount = Math.max(0, kdvDahilTaban * (cappedPercent / 100))
    }

    if (kdvDahilTaban > 0 && discount > kdvDahilTaban) discount = kdvDahilTaban

    /*
      İSKONTO KDV DAHİL, KALEM KAMPANYASI KDV HARİÇ — sunucudaki `CreateSalesInvoice` ile
      BİREBİR (bkz. `kampanyaliToplam`, 2026-09-30). Ekran kalem kampanyasını da KDV dahil
      iskontoyla topluyordu: sipariş 16.800,00 iken ekran (ve eski sunucu) 16.990,48 diyordu.
      "Fatura İndirimi" ve "Kampanya" satırlarında NET karşılıklar görünüyor (basımdakiyle ve
      Fatura Döküm'dekiyle aynı), böylece Brüt − Kampanya − İndirim + KDV = Genel Toplam tutar.
    */
    const _sonuc = kampanyaliToplam(subtotal, vatTotal, kampanyaAyrimi.tl, discount)

    return {
      subtotal,
      kdvDahilTaban,
      discount: _sonuc.elleIskontoNet,
      campaignDiscount: _sonuc.kampanyaNet,
      netTotal: _sonuc.netToplam,
      vatTotal: _sonuc.kdvToplam,
      grandTotal: _sonuc.genelToplam
    }
  }, [discountType, discountValue, invoiceQtyByLineId, selectedLines, kampanyaAyrimi, isOpenCustomer, isAskeriyeCustomer, layout?.isSuperSuperAdmin, layout?.roleCode, layout?.userDiscountRate])

  const invoiceCurrencyGrandTotal = useMemo(
    () => (fxTotals ? Number(fxTotals.grandTotal ?? 0) : Number(totals.grandTotal ?? 0)),
    [fxTotals, totals.grandTotal]
  )

  const requiredPaymentAmount = useMemo(() => {
    const fromCode = (invoiceCurrencyCode || 'TRY').toUpperCase()
    const entryCode = accountCurrencyCode
    const rateVal = targetFxRate
    if (fromCode === entryCode) {
      return invoiceCurrencyGrandTotal
    } else if (fromCode === 'TRY' && entryCode !== 'TRY') {
      return rateVal > 0 ? invoiceCurrencyGrandTotal / rateVal : 0
    } else if (fromCode !== 'TRY' && entryCode === 'TRY') {
      return invoiceCurrencyGrandTotal * rateVal
    } else {
      return invoiceCurrencyGrandTotal * rateVal
    }
  }, [invoiceCurrencyCode, accountCurrencyCode, targetFxRate, invoiceCurrencyGrandTotal])

  useEffect(() => {
    if (!isPriceOverridden && requiredPaymentAmount > 0) {
      setCashReceivedAmount(String(Number(requiredPaymentAmount.toFixed(2))))
    }
  }, [requiredPaymentAmount, isPriceOverridden])

  const parsedCashReceived = useMemo(() => Number(String(cashReceivedAmount ?? '').replace(',', '.')) || 0, [cashReceivedAmount])

  /**
   * Hesaba giren tutarın FATURANIN parasındaki karşılığı.
   *
   * `targetFxRate` yön olarak `requiredPaymentAmount`ın tersidir: orada fatura parası hesabın
   * parasına ÇEVRİLİR, burada hesabın parası faturanınkine geri döner. Çapraz kurda (fatura
   * USD, hesap EUR gibi) bu satır da çarpıyordu; oran "1 fatura parası = ? hesap parası"
   * olduğu için geri dönüşte BÖLÜNMESİ gerekir — 100 USD'lik fatura için tahsil edilen
   * 85,70 EUR, 73,45 USD sanılıyordu.
   */
  const parsedCashReceivedInInvoiceCurrency = useMemo(() => {
    const fromCode = (invoiceCurrencyCode || 'TRY').toUpperCase()
    const entryCode = accountCurrencyCode
    const rateVal = targetFxRate
    let val = 0
    if (fromCode === entryCode) {
      val = parsedCashReceived
    } else if (fromCode === 'TRY' && entryCode !== 'TRY') {
      // rateVal = 1 hesap parası kaç TL
      val = parsedCashReceived * rateVal
    } else if (fromCode !== 'TRY' && entryCode === 'TRY') {
      // rateVal = 1 fatura parası kaç TL
      val = rateVal > 0 ? parsedCashReceived / rateVal : 0
    } else {
      // rateVal = 1 fatura parası kaç hesap parası (çapraz)
      val = rateVal > 0 ? parsedCashReceived / rateVal : 0
    }
    return Math.round(val * 100) / 100
  }, [invoiceCurrencyCode, accountCurrencyCode, targetFxRate, parsedCashReceived])

  const changeAmount = useMemo(() => {
    const diff = parsedCashReceivedInInvoiceCurrency - invoiceCurrencyGrandTotal
    return diff > 1.00 ? diff : 0
  }, [parsedCashReceivedInInvoiceCurrency, invoiceCurrencyGrandTotal])

  const changeCurrency = useMemo(() => {
    let code = invoiceCurrencyCode
    if (changeSource === 'cash') {
      const acc = cashAccounts.find(c => String(c.id) === String(selectedChangeCashAccountId))
      if (acc) code = currencyCodeByTypeId(acc.currencyTypeId)
    } else if (changeSource === 'bank') {
      const acc = bankAccounts.find(b => String(b.id) === String(selectedChangeBankAccountDefinitionId))
      if (acc) code = currencyCodeByTypeId(acc.currencyTypeId)
    }
    return (code || 'TRY').toUpperCase()
  }, [changeSource, selectedChangeCashAccountId, selectedChangeBankAccountDefinitionId, cashAccounts, bankAccounts, invoiceCurrencyCode])

  const changeAmountVal = useMemo(() => {
    if (changeAmount <= 0) return 0

    const invoiceRateVal = Number(String(invoiceRateInput).replace(',', '.')) || 1
    const changeRateVal = Number(String(changeRateInput).replace(',', '.')) || 1

    const fromCode = (invoiceCurrencyCode || 'TRY').toUpperCase()
    const toCode = changeCurrency

    if (fromCode === toCode) {
      return changeAmount
    } else if (fromCode === 'TRY' && toCode !== 'TRY') {
      return changeRateVal > 0 ? changeAmount / changeRateVal : 0
    } else if (fromCode !== 'TRY' && toCode === 'TRY') {
      return changeAmount * invoiceRateVal
    } else {
      return changeAmount * changeRateVal
    }
  }, [changeAmount, invoiceCurrencyCode, changeCurrency, invoiceRateInput, changeRateInput])

  /** Para üstü — FATURANIN parasında (hesaba giren tutarın borcu aşan kısmı). */
  const changeInInvoiceCurrency = useMemo(() => {
    if (paymentMode !== 'pay_with_change') return 0
    return Math.max(0, parsedCashReceivedInInvoiceCurrency - invoiceCurrencyGrandTotal)
  }, [paymentMode, parsedCashReceivedInInvoiceCurrency, invoiceCurrencyGrandTotal])

  const invoiceCurrencyRate = useMemo(() => {
    if (!fxTotals) return 1
    const first = selectedLines[0] as any
    const r = Number(first?.currencyRate ?? 0)
    return r > 0 ? r : 0
  }, [fxTotals, selectedLines])

  // Auto-match invoice currency rate from active fxRates
  useEffect(() => {
    if (!invoiceCurrencyCode || invoiceCurrencyCode === 'TRY') {
      setInvoiceRateInput('1')
      return
    }
    const cur = invoiceCurrencyCode as 'USD' | 'EUR' | 'GBP'
    const curVal = fxRates[cur]
    if (curVal && curVal > 0) {
      setInvoiceRateInput(String(curVal))
    }
  }, [invoiceCurrencyCode, fxRates])

  /**
   * TAHSİLAT HESABI FATURANIN PARASINA GÖRE KENDİLİĞİNDEN SEÇİLİR (2026-08-19 kullanıcı kararı).
   *
   * Kullanıcı "hangi hesaba işleneceğini ben seçmeyeyim" dedi: kalemler EUR ise EUR hesabı,
   * USD ise USD hesabı, TL ise TL hesabı gelsin. Seçim yöntem + para birimi çifti başına
   * BİR KEZ yapılır (ref), böylece kullanıcı sonradan başka bir hesap seçerse üstüne
   * yazılmaz. Aynı paradan hesap yoksa dokunulmaz — yanlış paradaki hesabı sessizce
   * seçmek tahsilatı yanlış kasaya yazardı.
   */
  const autoPaymentAccountKeyRef = useRef<string>('')
  useEffect(() => {
    if (!takePaymentNow) {
      autoPaymentAccountKeyRef.current = ''
      return
    }
    const want = (invoiceCurrencyCode || 'TRY').toUpperCase()
    const key = `${payNowSource}|${want}`
    if (autoPaymentAccountKeyRef.current === key) return
    if (cashAccounts.length === 0 && bankAccounts.length === 0) return

    const currencyOf = (acc: any) => (getAccountCurrencyCode(acc) || 'TRY').toUpperCase()
    autoPaymentAccountKeyRef.current = key

    if (payNowSource === 'cash') {
      const match = cashAccounts.find((x) => currencyOf(x) === want)
      if (match) setSelectedCashAccountId(String(match.id))
      return
    }

    if (payNowSource === 'bank') {
      const match = bankAccounts.find((x) => currencyOf(x) === want)
      if (match) setSelectedBankAccountDefinitionId(String(match.id))
      return
    }

    if (payNowSource === 'pos') {
      const posAccounts = (bankAccounts ?? []).filter((b) => Number((b as any)?.accountType ?? 0) === 14)
      const match = posAccounts.find((x) => currencyOf(x) === want)
      if (match) setSelectedPosBankAccountDefinitionId(String(match.id))
    }
  }, [takePaymentNow, payNowSource, invoiceCurrencyCode, cashAccounts, bankAccounts])

  // Auto-fetch payment account rate (cross-rate with invoice currency)
  useEffect(() => {
    if (!takePaymentNow) return
    let acc: any = null
    if (payNowSource === 'cash') {
      acc = cashAccounts.find(c => String(c.id) === String(selectedCashAccountId))
    } else if (payNowSource === 'bank') {
      acc = bankAccounts.find(b => String(b.id) === String(selectedBankAccountDefinitionId))
    } else if (payNowSource === 'pos') {
      acc = bankAccounts.find(b => String(b.id) === String(selectedPosBankAccountDefinitionId))
    }
    const toCode = (getAccountCurrencyCode(acc) || 'TRY').toUpperCase()
    const fromCode = (invoiceCurrencyCode || 'TRY').toUpperCase()

    if (!toCode || fromCode === toCode) {
      setPaymentRateInput('1')
      return
    }

    // Kurlar üstteki çubuktan; kullanıcı orada değiştirdiğinde tahsilat da aynı kuru görür.
    if (fromCode === 'TRY' && toCode !== 'TRY') {
      setPaymentRateInput(String(rateOf(toCode)))
      return
    }

    if (fromCode !== 'TRY' && toCode === 'TRY') {
      setPaymentRateInput(String(rateOf(fromCode)))
      return
    }

    if (fromCode !== 'TRY' && toCode !== 'TRY' && fromCode !== toCode) {
      const fromRate = rateOf(fromCode)
      const toRate = rateOf(toCode)
      const cross = fromRate > 0 && toRate > 0 ? fromRate / toRate : 1
      setPaymentRateInput(String(Number(cross.toFixed(4))))
    }
  }, [payNowSource, selectedCashAccountId, selectedBankAccountDefinitionId, selectedPosBankAccountDefinitionId, takePaymentNow, cashAccounts, bankAccounts, invoiceCurrencyCode, rateOf])

  // Auto-fetch change account rate
  useEffect(() => {
    if (!takePaymentNow) return
    let acc: any = null
    if (changeSource === 'cash') {
      acc = cashAccounts.find(c => String(c.id) === String(selectedChangeCashAccountId))
    } else if (changeSource === 'bank') {
      acc = bankAccounts.find(b => String(b.id) === String(selectedChangeBankAccountDefinitionId))
    }
    const toCode = (getAccountCurrencyCode(acc) || 'TRY').toUpperCase()
    const fromCode = (invoiceCurrencyCode || 'TRY').toUpperCase()

    if (!toCode || fromCode === toCode) {
      setChangeRateInput('1')
      return
    }

    if (fromCode === 'TRY' && toCode !== 'TRY') {
      setChangeRateInput(String(rateOf(toCode)))
      return
    }

    if (fromCode !== 'TRY' && toCode === 'TRY') {
      setChangeRateInput(String(rateOf(fromCode)))
      return
    }

    if (fromCode !== 'TRY' && toCode !== 'TRY' && fromCode !== toCode) {
      const fromRate = rateOf(fromCode)
      const toRate = rateOf(toCode)
      const cross = fromRate > 0 && toRate > 0 ? fromRate / toRate : 1
      setChangeRateInput(String(Number(cross.toFixed(4))))
    }
  }, [changeSource, selectedChangeCashAccountId, selectedChangeBankAccountDefinitionId, takePaymentNow, cashAccounts, bankAccounts, invoiceCurrencyCode, rateOf])



  const handleCreateConfirm = async () => {
    if (takePaymentNow) {
      if (String(payNowSource) === 'cash' && !String(selectedCashAccountId ?? '').trim()) {
        showMessage('Uyarı', 'Lütfen kasa seçiniz')
        return
      }
      if (String(payNowSource) === 'bank' && !String(selectedBankAccountDefinitionId ?? '').trim()) {
        showMessage('Uyarı', 'Lütfen banka seçiniz')
        return
      }
      if (String(payNowSource) === 'pos' && !String(selectedPosBankAccountDefinitionId ?? '').trim()) {
        showMessage('Uyarı', 'Lütfen POS hesabı seçiniz')
        return
      }

      if (paymentMode === 'pay_with_change') {
        const cashReceivedRaw = String(cashReceivedAmount ?? '').trim()
        if (!cashReceivedRaw) {
          showMessage('Uyarı', 'Lütfen alınan tutarı (müşterinin verdiği miktarı) giriniz')
          return
        }
        const receivedNum = Number(String(cashReceivedRaw).replace(',', '.')) || 0
        if (!(receivedNum > 0)) {
          showMessage('Uyarı', 'Lütfen geçerli bir alınan tutar giriniz')
          return
        }
        if (parsedCashReceivedInInvoiceCurrency + 0.01 < invoiceCurrencyGrandTotal) {
          showMessage('Uyarı', 'Alınan tutar fatura tutarından küçük olamaz')
          return
        }
        if (changeInInvoiceCurrency > 0.01 && !String(selectedChangeCashAccountId ?? '').trim()) {
          showMessage('Uyarı', 'Lütfen para üstünün çıkacağı TL kasasını seçiniz')
          return
        }
      }
    }

    try {
      const first = selectedLines[0]
      const parsedNumber = Number(String(invoiceNumber ?? '').replace(/[^0-9]/g, ''))
      const invoiceNoValue = Number.isFinite(parsedNumber) ? parsedNumber : 0

      const invoiceLinesPayload = selectedLines
        .map((l) => {
          const customMontaj = customMontajs[l.salesOrderLineId]
          const lineWarehouse = resolveLineWarehouseCode(l)
          return {
            salesOrderLineId: l.salesOrderLineId,
            invoiceQuantity: Number(invoiceQtyByLineId[l.salesOrderLineId] ?? 0),
            // Başlık deposuyla aynıysa gönderilmez: sunucu alan yoksa başlığa düşüyor ve
            // gereksiz yere satır satır depo doğrulaması yapmıyor.
            warehouseCode: lineWarehouse && lineWarehouse !== effectiveWarehouseCode ? lineWarehouse : null,
            installation: customMontaj ? {
              quantity: Number(customMontaj.miktar || l.orderQuantity || 1),
              customerName: customMontaj.isimSoyisim,
              phone: customMontaj.telefon,
              address: customMontaj.adres,
              region: customMontaj.bolge,
              note: customMontaj.bayiAciklama,
              dealerName: customMontaj.bayiAdi,
              productName: customMontaj.urunAdi
            } : null
          }
        })
        .filter((l) => Number(l.invoiceQuantity ?? 0) > 0)

      const token = localStorage.getItem('accessToken')
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (token) headers.Authorization = `Bearer ${token}`

      const activeRate = getActiveUserDiscountRate(layout)

      const rawDiscountValue = Number(String(discountValue ?? '0').replace(',', '.')) || 0
      let finalDiscountValue = rawDiscountValue

      if (discountType === 'percentage') {
        finalDiscountValue = Math.min(rawDiscountValue, activeRate)
      } else if (discountType === 'amount') {
        const maxAllowedAmount = totals.kdvDahilTaban * (activeRate / 100)
        finalDiscountValue = Math.min(rawDiscountValue, maxAllowedAmount)
      }

      let targetAcc: any = null
      if (String(payNowSource) === 'cash') {
        targetAcc = cashAccounts.find((x) => x.id === Number(selectedCashAccountId))
      } else if (String(payNowSource) === 'bank') {
        targetAcc = bankAccounts.find((x) => x.id === Number(selectedBankAccountDefinitionId))
      } else if (String(payNowSource) === 'pos') {
        targetAcc = bankAccounts.find((x) => x.id === Number(selectedPosBankAccountDefinitionId))
      }

      const currencyCode = getAccountCurrencyCode(targetAcc)
      const fromCode = (invoiceCurrencyCode || 'TRY').toUpperCase()
      const toCode = (currencyCode || 'TRY').toUpperCase()

      /**
       * SUNUCUYA GİDEN `currencyRate` = 1 HESAP PARASI KAÇ TL.
       *
       * Sunucu bu oranı kasa/banka satırının `CurrencyRate`i olarak kullanıyor ve hesabın
       * kendi parasındaki tutarı `TL tutar / oran` ile buluyor. Eskiden oran yalnızca
       * "fatura parası ≠ hesap parası" olduğunda gönderiliyordu: fatura USD, kasa da USD
       * iken oran 1 gidiyor, USD kasaya TL tutar USD gibi yazılıyordu ("hesaba giren her
       * şey TL kalıyor" şikâyetinin kaynağı). Artık dört hâl de tek formülden çıkıyor:
       *
       *   accPerInv = 1 fatura parası kaç hesap parası
       *   TL/hesap  = (1 fatura parası kaç TL) / accPerInv
       *
       * Ekranda kullanılan oranların aynısından türetiliyor; kullanıcı kuru elle
       * değiştirdiyse kasaya yazılan tutar da tam yazdığı tutar oluyor.
       */
      const invoiceTryRateVal = Number(String(invoiceRateInput).replace(',', '.')) || 1
      const changeRateVal = Number(String(changeRateInput).replace(',', '.')) || 1
      const chgCode = (changeCurrency || 'TRY').toUpperCase()
      const chgPerInv =
        fromCode === chgCode
          ? 1
          : fromCode === 'TRY' && chgCode !== 'TRY'
            ? (changeRateVal > 0 ? 1 / changeRateVal : 1)
            : (changeRateVal > 0 ? changeRateVal : 1)
      const submitChangeRate = chgCode === 'TRY' ? 1 : (chgPerInv > 0 ? invoiceTryRateVal / chgPerInv : 1)
      const accPerInv =
        fromCode === toCode
          ? 1
          : fromCode === 'TRY' && toCode !== 'TRY'
            ? (targetFxRate > 0 ? 1 / targetFxRate : 1)
            : (targetFxRate > 0 ? targetFxRate : 1)

      const submitRate = toCode === 'TRY' ? 1 : (accPerInv > 0 ? invoiceTryRateVal / accPerInv : 1)

      const payload = {
        customerCode: selectedCustomer,
        deliveryCustomerCode: first?.deliveryCustomerCode ?? selectedCustomer,
        invoiceSerie: isOpenCustomer ? '1' : (invoiceSerie || 'A'),
        invoiceNumber: isOpenCustomer ? null : invoiceNoValue,
        warehouseCode: effectiveWarehouseCode,
        date: new Date(`${String(invoiceDate ?? '').trim()}T00:00:00.000Z`).toISOString(),
        vatIncluded: false,
        discountType: discountType === 'amount' ? 0 : 1,
        discountValue: finalDiscountValue,
        description: note,
        lines: invoiceLinesPayload,
        campaignDiscount: campaignDiscountTotal,
        campaignDetailsJson: null,
        takePaymentNow: Boolean(takePaymentNow),
        currencyRate: 0,
        cashReceivedAmount:
          takePaymentNow && String(cashReceivedAmount ?? '').trim()
            ? parsedCashReceivedInInvoiceCurrency
            : null,
        invoiceCurrencyRate:
          invoiceCurrencyTypeId > 0 || (Number(String(invoiceRateInput).replace(',', '.')) || 1) > 1
            ? (Number(String(invoiceRateInput).replace(',', '.')) || 1)
            : null,
        // Para üstü hesabının kuru da "1 hesap parası kaç TL" olarak gider (giriş hesabıyla
        // aynı kural); ekrandaki oran fatura parası eksenli olduğu için çevriliyor.
        changeCurrencyRate:
          takePaymentNow && String(cashReceivedAmount ?? '').trim() && changeAmount > 0
            ? submitChangeRate
            : null,
        cashAccountId:
          takePaymentNow && String(payNowSource) === 'cash' && String(selectedCashAccountId ?? '').trim() ? Number(selectedCashAccountId) : null,
        bankAccountDefinitionId:
          takePaymentNow && String(payNowSource) === 'bank' && String(selectedBankAccountDefinitionId ?? '').trim()
            ? Number(selectedBankAccountDefinitionId)
            : takePaymentNow && String(payNowSource) === 'pos' && String(selectedPosBankAccountDefinitionId ?? '').trim()
              ? Number(selectedPosBankAccountDefinitionId)
              : null,
        changeCashAccountId:
          takePaymentNow && String(cashReceivedAmount ?? '').trim() && changeAmount > 0 && changeSource === 'cash' && String(selectedChangeCashAccountId ?? '').trim()
            ? Number(selectedChangeCashAccountId)
            : null,
        changeBankAccountDefinitionId:
          takePaymentNow && String(cashReceivedAmount ?? '').trim() && changeAmount > 0 && changeSource === 'bank' && String(selectedChangeBankAccountDefinitionId ?? '').trim()
            ? Number(selectedChangeBankAccountDefinitionId)
            : null,
        isPriceOverridden: takePaymentNow && paymentMode === 'pay_now' ? isPriceOverridden : false
      }

      const submitPayload = { ...payload, currencyRate: Number(submitRate) || 0 }
      const res = await fetch(`${API_BASE_URL}/api/invoices/create-sales-invoice`, {
        method: 'POST',
        headers,
        body: JSON.stringify(submitPayload)
      })

      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error(json?.message || 'Fatura oluşturulamadı')
      }

      /**
       * FATURA OLUŞUNCA BASIM DOĞRUDAN AÇILIR (2026-08-22 kullanıcı kararı).
       *
       * Önce Fatura Dökümü'ne gidiliyor, satır bulunuyor, "İşlemler > Basım" tıklanıyordu.
       * Artık basım PDF'i kaydetmenin hemen ardından yeni sekmede açılıyor; bu sekme de
       * Fatura Dökümü'ne geçiyor.
       *
       * Basım başarısız olsa BİLE yönlendirme yapılır: fatura KAYDEDİLDİ, kullanıcıyı dolu
       * formun başında bırakmak aynı faturayı ikinci kez kesmesine yol açardı. Uyarı, liste
       * ekranına yönlendirme durumuyla taşınıyor — burada göstermek işe yaramaz, pencere
       * zaten kapanıyor.
       */
      const created = await res.json().catch(() => ({} as any))
      const createdInvoiceId = Number(created?.data?.id ?? 0)

      setConfirmCreateOpen(false)

      let printWarning = ''
      if (createdInvoiceId > 0) {
        try {
          const blob = await fetchInvoicePrintPdf(createdInvoiceId)
          const url = URL.createObjectURL(blob)
          const printWindow = window.open(url, '_blank')
          if (printWindow) {
            // Sekmenin PDF'i yüklemesine zaman bırakılır; hemen iptal etmek açılışla yarışır.
            window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
          } else {
            URL.revokeObjectURL(url)
            printWarning = 'Fatura oluşturuldu ancak basım penceresi açılamadı (pop-up engelleyici). Listeden "İşlemler > Basım" ile yazdırabilirsiniz.'
          }
        } catch {
          printWarning = 'Fatura oluşturuldu ancak basım alınamadı. Listeden "İşlemler > Basım" ile yazdırabilirsiniz.'
        }
      } else {
        printWarning = 'Fatura oluşturuldu ancak numarası okunamadığı için basım açılamadı. Listeden "İşlemler > Basım" ile yazdırabilirsiniz.'
      }

      navigate('/invoice/fatura-dokumu', printWarning ? { state: { printWarning } } : undefined)
    } catch (err: any) {
      showMessage('Hata', err?.message || 'Fatura oluşturulamadı')
    }
  }

  return (

    <div>

      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-5">
        <div>
          <h1 className="text-xl font-bold text-gray-900 tracking-tight">Satış Faturası</h1>
          <p className="text-xs text-gray-400 mt-0.5">Fatura İşlemleri / Satış Faturası</p>
        </div>

        {/* Canlı TCMB Kurları (USD, EUR, GBP) */}
        <div className="flex items-center gap-2 bg-white px-3.5 py-2 rounded-xl border border-slate-200 shadow-xs flex-wrap">
          <div className="flex items-center gap-1.5 text-xs font-bold text-slate-700 mr-1">
            <Coins className="w-4 h-4 text-amber-500" />
            <span className="hidden sm:inline">Döviz Kurları (TL):</span>
            <span className="sm:hidden">Kurlar:</span>
          </div>

          {/* USD */}
          <div className="flex items-center bg-slate-50 border border-slate-200 rounded-lg overflow-hidden focus-within:ring-1 focus-within:ring-emerald-500 focus-within:border-emerald-500">
            <span className="px-2.5 py-1 bg-slate-100 text-[11px] font-bold text-slate-700 border-r border-slate-200 flex items-center gap-1">
              <span>🇺🇸</span> USD ($)
            </span>
            <input
              type="text"
              value={fxRatesInput.USD}
              onChange={(e) => handleRateInputChange('USD', e.target.value)}
              placeholder="47.91"
              className="w-16 sm:w-20 px-2 py-1 text-xs font-mono font-bold text-slate-900 bg-transparent text-center focus:outline-none"
              title="Dolar Kurunu Düzenle (TL)"
            />
            <span className="pr-2 text-[10px] font-bold text-slate-400">₺</span>
          </div>

          {/* EUR */}
          <div className="flex items-center bg-slate-50 border border-slate-200 rounded-lg overflow-hidden focus-within:ring-1 focus-within:ring-emerald-500 focus-within:border-emerald-500">
            <span className="px-2.5 py-1 bg-slate-100 text-[11px] font-bold text-slate-700 border-r border-slate-200 flex items-center gap-1">
              <span>🇪🇺</span> EUR (€)
            </span>
            <input
              type="text"
              value={fxRatesInput.EUR}
              onChange={(e) => handleRateInputChange('EUR', e.target.value)}
              placeholder="55.46"
              className="w-16 sm:w-20 px-2 py-1 text-xs font-mono font-bold text-slate-900 bg-transparent text-center focus:outline-none"
              title="Euro Kurunu Düzenle (TL)"
            />
            <span className="pr-2 text-[10px] font-bold text-slate-400">₺</span>
          </div>

          {/* GBP */}
          <div className="flex items-center bg-slate-50 border border-slate-200 rounded-lg overflow-hidden focus-within:ring-1 focus-within:ring-emerald-500 focus-within:border-emerald-500">
            <span className="px-2.5 py-1 bg-slate-100 text-[11px] font-bold text-slate-700 border-r border-slate-200 flex items-center gap-1">
              <span>🇬🇧</span> GBP (£)
            </span>
            <input
              type="text"
              value={fxRatesInput.GBP}
              onChange={(e) => handleRateInputChange('GBP', e.target.value)}
              placeholder="64.93"
              className="w-16 sm:w-20 px-2 py-1 text-xs font-mono font-bold text-slate-900 bg-transparent text-center focus:outline-none"
              title="Sterlin Kurunu Düzenle (TL)"
            />
            <span className="pr-2 text-[10px] font-bold text-slate-400">₺</span>
          </div>

          <button
            type="button"
            onClick={() => refreshFxRates()}
            disabled={fxRatesLoading}
            className="p-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-600 hover:text-emerald-600 transition-colors disabled:opacity-50 cursor-pointer"
            title="TCMB Canlı Kurlarını Yeniden Çek"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${fxRatesLoading ? 'animate-spin text-emerald-600' : ''}`} />
          </button>
        </div>
      </div>

        {/* FX Confirm Modal removed */}

        <Modal
          isOpen={payNowModalOpen}
          onClose={() => setPayNowModalOpen(false)}
          title="Nakit Tahsilat"
          footer={
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                className="h-[34px] px-4 text-xs font-semibold rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 transition"
                onClick={() => setPayNowModalOpen(false)}
              >
                Kapat
              </button>
            </div>
          }
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-end">
            <div className="flex flex-col space-y-1">
              <label className="text-xs font-bold text-gray-700">Alınan Para ({invoiceCurrencyCode})</label>
              <input
                type="text"
                placeholder="0.00"
                value={cashReceivedAmount}
                onChange={(e) => setCashReceivedAmount(String(e.target.value))}
                className="w-full h-9 px-3 rounded-lg border border-gray-200 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-xs font-medium transition-all"
              />
            </div>
            <div className="flex items-center h-9 px-3 bg-blue-50/80 border border-blue-100 text-blue-800 rounded-lg text-[11px] font-medium leading-snug">
              Para üstü ödemek için bu kısmı kullanın
            </div>

            {invoiceCurrencyCode !== 'TRY' && (
              <div className="flex flex-col space-y-1 md:col-span-2">
                <label className="text-xs font-bold text-gray-700">Fatura Kuru ({invoiceCurrencyCode}/TRY)</label>
                <input
                  type="text"
                  value={invoiceRateInput}
                  onChange={(e) => setInvoiceRateInput(e.target.value)}
                  className="w-full h-9 px-3 rounded-lg border border-gray-200 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-xs font-medium transition-all"
                />
              </div>
            )}

            <FormSelect
              label="Ödeme Alınacak Yer"
              value={payNowSource}
              onChange={(e) => {
                const v = String(e.target.value)
                setPayNowSource(v)
                setPayNowBalance(null)
                if (v === 'cash') setSelectedBankAccountDefinitionId('')
                if (v === 'bank') setSelectedCashAccountId('')
                if (v !== 'pos') setSelectedPosBankAccountDefinitionId('')
                if (v === 'pos') {
                  setSelectedCashAccountId('')
                  setSelectedBankAccountDefinitionId('')
                }
              }}
              options={[
                { value: 'cash', label: 'Kasa' },
                { value: 'bank', label: 'Banka' },
                { value: 'pos', label: 'POS' }
              ]}
            />

            {String(payNowSource) === 'bank' ? (
              <FormSelect
                label="Ödeme Alınacak Banka"
                value={selectedBankAccountDefinitionId}
                onChange={(e) => setSelectedBankAccountDefinitionId(String(e.target.value))}
                options={
                  bankAccountOptions.length > 0
                    ? [{ value: '', label: 'Seçiniz...' }, ...bankAccountOptions]
                    : [{ value: '', label: 'Banka bulunamadı' }]
                }
              />
            ) : String(payNowSource) === 'pos' ? (
              <FormSelect
                label="Ödeme Alınacak POS Hesabı"
                value={selectedPosBankAccountDefinitionId}
                onChange={(e) => setSelectedPosBankAccountDefinitionId(String(e.target.value))}
                options={
                  posAccountOptions.length > 0
                    ? [{ value: '', label: 'Seçiniz...' }, ...posAccountOptions]
                    : [{ value: '', label: 'POS hesabı bulunamadı' }]
                }
              />
            ) : (
              <FormSelect
                label="Ödeme Alınacak Kasa"
                value={selectedCashAccountId}
                onChange={(e) => setSelectedCashAccountId(String(e.target.value))}
                options={
                  cashAccountOptions.length > 0
                    ? [{ value: '', label: 'Seçiniz...' }, ...cashAccountOptions]
                    : [{ value: '', label: 'Kasa bulunamadı' }]
                }
              />
            )}

            {/* Entry Account Rate Input */}
            {(() => {
              let acc: any = null
              if (payNowSource === 'cash') {
                acc = cashAccounts.find(c => String(c.id) === String(selectedCashAccountId))
              } else if (payNowSource === 'bank') {
                acc = bankAccounts.find(b => String(b.id) === String(selectedBankAccountDefinitionId))
              } else if (payNowSource === 'pos') {
                acc = bankAccounts.find(b => String(b.id) === String(selectedPosBankAccountDefinitionId))
              }
              const toCode = (getAccountCurrencyCode(acc) || 'TRY').toUpperCase()
              const fromCode = (invoiceCurrencyCode || 'TRY').toUpperCase()
              if (!toCode || fromCode === toCode) return null

              let label = `Giriş Hesabı Kuru (${toCode}/TRY)`
              if (fromCode !== 'TRY' && toCode !== 'TRY' && fromCode !== toCode) {
                label = `Giriş Hesabı Kuru (${fromCode}/${toCode})`
              } else if (fromCode !== 'TRY' && toCode === 'TRY') {
                label = `Giriş Hesabı Kuru (${fromCode}/TRY)`
              }

              return (
                <div className="flex flex-col space-y-1 md:col-span-2">
                  <label className="text-xs font-bold text-gray-700">{label}</label>
                  <input
                    type="text"
                    value={paymentRateInput}
                    onChange={(e) => setPaymentRateInput(e.target.value)}
                    className="w-full h-9 px-3 rounded-lg border border-gray-200 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-xs font-medium transition-all"
                  />
                </div>
              )
            })()}

            {changeAmount > 0 ? (
              <>
                <FormSelect
                  label="Para Üstü Ödenecek Yer"
                  value={changeSource}
                  onChange={(e) => {
                    const v = String(e.target.value) as any
                    setChangeSource(v)
                    if (v === 'cash') setSelectedChangeBankAccountDefinitionId('')
                    if (v === 'bank') setSelectedChangeCashAccountId('')
                  }}
                  options={[
                    { value: 'cash', label: 'Kasa' },
                    { value: 'bank', label: 'Banka' }
                  ]}
                />

                {changeSource === 'bank' ? (
                  <FormSelect
                    label="Para Üstü Ödenecek Banka"
                    value={selectedChangeBankAccountDefinitionId}
                    onChange={(e) => setSelectedChangeBankAccountDefinitionId(String(e.target.value))}
                    options={
                      bankAccounts
                        .map((b) => ({ value: String(b.id), label: `${b.accountCode}${b.accountName ? ` - ${b.accountName}` : ''}` }))
                        .reduce((acc: any[], o) => {
                          if (!acc.find((x) => x.value === o.value)) acc.push(o)
                          return acc
                        }, [{ value: '', label: 'Seçiniz...' }])
                    }
                  />
                ) : (
                  <FormSelect
                    label="Para Üstü Ödenecek Kasa"
                    value={selectedChangeCashAccountId}
                    onChange={(e) => setSelectedChangeCashAccountId(String(e.target.value))}
                    options={
                      cashAccounts
                        .map((c) => ({ value: String(c.id), label: `${c.code}${c.name ? ` - ${c.name}` : ''}` }))
                        .reduce((acc: any[], o) => {
                          if (!acc.find((x) => x.value === o.value)) acc.push(o)
                          return acc
                        }, [{ value: '', label: 'Seçiniz...' }])
                    }
                  />
                )}

                {/* Change Account Rate Input */}
                {(() => {
                  let acc: any = null
                  if (changeSource === 'cash') {
                    acc = cashAccounts.find(c => String(c.id) === String(selectedChangeCashAccountId))
                  } else if (changeSource === 'bank') {
                    acc = bankAccounts.find(b => String(b.id) === String(selectedChangeBankAccountDefinitionId))
                  }
                  const toCode = (getAccountCurrencyCode(acc) || 'TRY').toUpperCase()
                  const fromCode = (invoiceCurrencyCode || 'TRY').toUpperCase()
                  if (!toCode || fromCode === toCode) return null

                  let label = `Para Üstü Kuru (${toCode}/TRY)`
                  if (fromCode !== 'TRY' && toCode !== 'TRY' && fromCode !== toCode) {
                    label = `Para Üstü Kuru (${fromCode}/${toCode})`
                  } else if (fromCode !== 'TRY' && toCode === 'TRY') {
                    label = `Para Üstü Kuru (${fromCode}/TRY)`
                  }

                  return (
                    <div className="flex flex-col space-y-1 md:col-span-2">
                      <label className="text-xs font-bold text-gray-700">{label}</label>
                      <input
                        type="text"
                        value={changeRateInput}
                        onChange={(e) => setChangeRateInput(e.target.value)}
                        className="w-full h-9 px-3 rounded-lg border border-gray-200 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-xs font-medium transition-all"
                      />
                    </div>
                  )
                })()}
              </>
            ) : null}

            {(() => {
              const hasEntryAccountSelected =
                (payNowSource === 'cash' && Boolean(selectedCashAccountId)) ||
                (payNowSource === 'bank' && Boolean(selectedBankAccountDefinitionId)) ||
                (payNowSource === 'pos' && Boolean(selectedPosBankAccountDefinitionId))

              const hasChangeAccountSelected =
                (changeSource === 'cash' && Boolean(selectedChangeCashAccountId)) ||
                (changeSource === 'bank' && Boolean(selectedChangeBankAccountDefinitionId))

              const showSummaryCard = hasEntryAccountSelected || (changeAmount > 0 && hasChangeAccountSelected)
              if (!showSummaryCard) return null

              let receivingAccName = ''
              let receivingCurrency = invoiceCurrencyCode
              if (payNowSource === 'cash') {
                const acc = cashAccounts.find(c => String(c.id) === String(selectedCashAccountId))
                if (acc) {
                  receivingAccName = acc.name || acc.code
                  receivingCurrency = currencyCodeByTypeId(acc.currencyTypeId)
                }
              } else if (payNowSource === 'bank') {
                const acc = bankAccounts.find(b => String(b.id) === String(selectedBankAccountDefinitionId))
                if (acc) {
                  receivingAccName = acc.accountName || acc.accountCode
                  receivingCurrency = currencyCodeByTypeId(acc.currencyTypeId)
                }
              } else if (payNowSource === 'pos') {
                const acc = bankAccounts.find(b => String(b.id) === String(selectedPosBankAccountDefinitionId))
                if (acc) {
                  receivingAccName = acc.accountName || acc.accountCode
                  receivingCurrency = currencyCodeByTypeId(acc.currencyTypeId)
                }
              }

              let changeAccName = ''
              let changeCurrency = invoiceCurrencyCode
              let changeAcc: any = null
              if (changeSource === 'cash') {
                changeAcc = cashAccounts.find(c => String(c.id) === String(selectedChangeCashAccountId))
                if (changeAcc) {
                  changeAccName = changeAcc.name || changeAcc.code
                  changeCurrency = currencyCodeByTypeId(changeAcc.currencyTypeId)
                }
              } else if (changeSource === 'bank') {
                changeAcc = bankAccounts.find(b => String(b.id) === String(selectedChangeBankAccountDefinitionId))
                if (changeAcc) {
                  changeAccName = changeAcc.accountName || changeAcc.accountCode
                  changeCurrency = currencyCodeByTypeId(changeAcc.currencyTypeId)
                }
              }

              const invoiceRateVal = Number(String(invoiceRateInput).replace(',', '.')) || 1
              const paymentRateVal = Number(String(paymentRateInput).replace(',', '.')) || 1
              const changeRateVal = Number(String(changeRateInput).replace(',', '.')) || 1

              const fromCode = (invoiceCurrencyCode || 'TRY').toUpperCase()
              const entryCode = (receivingCurrency || 'TRY').toUpperCase()
              const toCode = (getAccountCurrencyCode(changeAcc) || 'TRY').toUpperCase()

              let entryAmountVal = 0
              if (paymentMode === 'pay_with_change') {
                entryAmountVal = parsedCashReceived
              } else {
                if (fromCode === entryCode) {
                  entryAmountVal = invoiceCurrencyGrandTotal
                } else if (fromCode === 'TRY' && entryCode !== 'TRY') {
                  entryAmountVal = paymentRateVal > 0 ? invoiceCurrencyGrandTotal / paymentRateVal : 0
                } else if (fromCode !== 'TRY' && entryCode === 'TRY') {
                  entryAmountVal = invoiceCurrencyGrandTotal * invoiceRateVal
                } else {
                  entryAmountVal = invoiceCurrencyGrandTotal * paymentRateVal
                }
              }

              let changeAmountVal = 0
              if (fromCode === toCode) {
                changeAmountVal = changeAmount
              } else if (fromCode === 'TRY' && toCode !== 'TRY') {
                changeAmountVal = changeRateVal > 0 ? changeAmount / changeRateVal : 0
              } else if (fromCode !== 'TRY' && toCode === 'TRY') {
                changeAmountVal = changeAmount * invoiceRateVal
              } else {
                changeAmountVal = changeAmount * changeRateVal
              }

              return (
                <div className="md:col-span-2 rounded-2xl border border-blue-200 bg-blue-50/50 p-4 space-y-2.5 shadow-[inset_0_2px_4px_rgba(0,0,0,0.01)] text-xs text-blue-900 mt-2">
                  <div className="font-bold flex items-center gap-1.5 text-blue-950">
                    <CircleAlert size={14} className="text-blue-700" />
                    Ödeme Dağılım Özeti
                  </div>
                  <div className="grid grid-cols-1 gap-2 border-t border-blue-200/50 pt-2.5">
                    {hasEntryAccountSelected && (
                      <div className="flex justify-between items-center">
                        <span className="font-medium text-blue-800">Giriş Yapılacak ({receivingAccName}):</span>
                        <span className="font-extrabold text-blue-950 text-sm">
                          {entryAmountVal.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {receivingCurrency}
                        </span>
                      </div>
                    )}
                    {changeAmount > 0 && hasChangeAccountSelected && (
                      <div className="flex justify-between items-center border-t border-blue-200/20 pt-2">
                        <span className="font-medium text-blue-800">Para Üstü Ödenecek ({changeAccName}):</span>
                        <span className="font-extrabold text-amber-900 text-sm">
                          {changeAmountVal.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {changeCurrency}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )
            })()}
          </div>
        </Modal>

        <Modal
          isOpen={confirmCreateOpen}
          onClose={() => {
            setConfirmCreateOpen(false)
          }}
          title="Satış Faturası Oluşturma ve Ödeme Ayarları"
          hideHeader={false}
          containerClassName="max-w-4xl"
        >
          <div className="p-1">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              {/* Left Panel: Invoice Details & Financial Summary */}
              <div className="lg:col-span-5 space-y-4">
                <div className="bg-gray-50 rounded-2xl p-4 border border-gray-200/60 text-left space-y-3">
                  <h4 className="text-xs font-bold text-gray-800 uppercase tracking-wide border-b border-gray-200 pb-2">
                    Fatura Bilgileri
                  </h4>

                  <div className="flex justify-between items-start gap-4 text-xs">
                    <span className="font-semibold text-gray-400 whitespace-nowrap">Cari Hesabı:</span>
                    <span className="font-bold text-gray-700 text-right truncate max-w-[200px]" title={selectedCustomerLabel}>
                      {selectedCustomerLabel}
                    </span>
                  </div>

                  <div className="flex justify-between items-center gap-4 text-xs">
                    <span className="font-semibold text-gray-400">Tarih:</span>
                    <span className="font-bold text-gray-700">
                      {invoiceDate ? new Date(invoiceDate).toLocaleDateString('tr-TR') : '-'}
                    </span>
                  </div>

                  <div className="flex justify-between items-center gap-4 text-xs">
                    <span className="font-semibold text-gray-400">Depo:</span>
                    <span className="font-bold text-gray-700">
                      {resolvedWarehouseName || '-'}
                    </span>
                  </div>

                  <div className="flex justify-between items-center gap-4 text-xs">
                    <span className="font-semibold text-gray-400">Fatura Seri/No:</span>
                    <span className="font-bold text-gray-700">
                      {selectedCustomer ? (isOpenCustomer ? '1 / Otomatik' : `${invoiceSerie || 'A'} / ${computedInvoiceNo || '-'}`) : '-'}
                    </span>
                  </div>

                  <div className="flex justify-between items-center gap-4 text-xs">
                    <span className="font-semibold text-gray-400">Kalem Sayısı:</span>
                    <span className="font-bold text-gray-700">
                      {selectedLines.length} Kalem
                    </span>
                  </div>

                  {campaignBreakdown.length > 0 && (
                    <div className="border-t border-gray-200 pt-2.5 mt-2 space-y-1.5">
                      <div className="text-[11px] font-bold text-amber-800 uppercase tracking-wider flex items-center gap-1.5 mb-1">
                        <Gift size={13} className="text-amber-600" />
                        <span>Kampanya İndirimleri ({campaignBreakdown.length})</span>
                      </div>
                      <div className="bg-amber-50/70 border border-amber-200/60 rounded-xl p-2.5 space-y-1.5 max-h-36 overflow-y-auto">
                        {campaignBreakdown.map((item, idx) => (
                          <div key={idx} className="flex justify-between items-start text-[11px] border-b border-amber-100 last:border-0 pb-1 last:pb-0">
                            <div className="flex flex-col pr-2">
                              <span className="font-bold text-amber-950">{item.title}</span>
                              {item.subtitle && <span className="text-[10px] text-amber-700">{item.subtitle}</span>}
                            </div>
                            <span className={`font-extrabold whitespace-nowrap ${item.isGift ? 'text-amber-800' : 'text-red-600'}`}>
                              {item.isGift ? `${item.amount.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${invoiceCurrencyCode}` : `-${item.amount.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${invoiceCurrencyCode}`}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Financial Summary */}
                  <div className="border-t border-gray-250 my-2 pt-2.5 space-y-2">
                    <div className="flex justify-between items-center text-xs">
                      <span className="font-medium text-gray-500">Brüt Tutar:</span>
                      <span className="font-bold text-gray-700">
                        {(fxTotals ? Number(fxTotals.subtotal) : totals.subtotal).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{' '}
                        {invoiceCurrencyCode}
                      </span>
                    </div>

                    {campaignDiscountTotal > 0 && (
                      <div className="flex justify-between items-center text-xs">
                        <span className="font-semibold text-amber-700">Kampanya İndirimi:</span>
                        <span className="font-bold text-red-600">
                          -{(fxTotals ? Number(fxTotals.kampanyaNet) : totals.campaignDiscount).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{' '}
                          {invoiceCurrencyCode}
                        </span>
                      </div>
                    )}

                    {totals.discount > 0 && (
                      <div className="flex justify-between items-center text-xs">
                        <span className="font-semibold text-blue-700">Manuel İndirim:</span>
                        <span className="font-bold text-blue-600">
                          -{totals.discount.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{' '}
                          {invoiceCurrencyCode}
                        </span>
                      </div>
                    )}

                    <div className="flex justify-between items-center text-xs">
                      <span className="font-medium text-gray-500">KDV Tutarı:</span>
                      <span className="font-bold text-gray-700">
                        {(fxTotals ? Number(fxTotals.vatTotal) : totals.vatTotal).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{' '}
                        {invoiceCurrencyCode}
                      </span>
                    </div>

                    <div className="flex justify-between items-center pt-2 border-t border-gray-300">
                      <span className="text-xs font-bold text-gray-800">Toplam Fatura Tutarı:</span>
                      <span className="text-base font-extrabold text-emerald-600">
                        {invoiceCurrencyGrandTotal.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{' '}
                        {invoiceCurrencyCode}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Right Panel: Payment Settings */}
              <div className="lg:col-span-7 border-t lg:border-t-0 lg:border-l border-gray-200 pt-4 lg:pt-0 lg:pl-6 space-y-4">
                {/* Check permission for payment mode change */}
                {(() => {
                  const canChangePaymentMode = Boolean(layout?.isSuperAdmin) || Boolean(layout?.allowedKeys?.has('invoice/changePaymentMode'))
                  if (!canChangePaymentMode) {
                    return (
                      <div className="p-4 bg-gray-50 border border-gray-200 rounded-xl space-y-2">
                        <span className="block text-[11px] font-extrabold text-gray-400 uppercase tracking-wider">
                          Ödeme Şekli Yetkisi
                        </span>
                        <p className="text-xs font-semibold text-gray-600 leading-relaxed">
                          Ödeme şekli yetkiniz bulunmamaktadır. Bu fatura otomatik olarak <b className="text-gray-900">Açık Hesap (Vadeli)</b> olarak kaydedilecektir.
                        </p>
                      </div>
                    )
                  }

                  return (
                    <div className="space-y-4">
                      <div>
                        <span className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-2">Ödeme Şekli</span>
                        <div className="flex border border-gray-200 rounded-xl p-1 bg-gray-50/50">
                          <button
                            type="button"
                            onClick={() => {
                              setPaymentMode('open_account')
                              setTakePaymentNow(false)
                              setCashReceivedAmount('')
                            }}
                            className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${
                              paymentMode === 'open_account'
                                ? 'bg-blue-600 text-white shadow-md'
                                : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100/50'
                            }`}
                          >
                            Açık Hesap (Vadeli)
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setPaymentMode('pay_now')
                              setTakePaymentNow(true)
                              setCashReceivedAmount('')
                              if (!payNowSource) setPayNowSource('cash')
                            }}
                            className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${
                              paymentMode === 'pay_now'
                                ? 'bg-emerald-600 text-white shadow-md'
                                : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100/50'
                            }`}
                          >
                            Hemen Tahsil Et
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setPaymentMode('pay_with_change')
                              setTakePaymentNow(true)
                              setCashReceivedAmount('')
                              if (!payNowSource) setPayNowSource('cash')
                            }}
                            className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${
                              paymentMode === 'pay_with_change'
                                ? 'bg-purple-600 text-white shadow-md'
                                : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100/50'
                            }`}
                          >
                            Artan Hesaplı (Para Üstü)
                          </button>
                        </div>
                      </div>

                      {/* Detail block for Option 2: Ödemeyi Hemen Al */}
                      {paymentMode === 'pay_now' && (
                        <div className="p-4 border border-emerald-100 bg-emerald-50/10 rounded-xl space-y-4 text-left">
                          <div className="flex items-center gap-2 text-[10px] font-bold text-emerald-800 uppercase tracking-wider">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                            <span>Net Tahsilat Girişi & Kur Hesaplaması</span>
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <FormSelect
                              label="Tahsilat Yöntemi"
                              value={payNowSource}
                              onChange={(e) => {
                                const v = String(e.target.value)
                                setPayNowSource(v)
                                if (v === 'cash') setSelectedBankAccountDefinitionId('')
                                if (v === 'bank') setSelectedCashAccountId('')
                                if (v !== 'pos') setSelectedPosBankAccountDefinitionId('')
                              }}
                              options={[
                                { value: 'cash', label: 'Nakit (Kasa)' },
                                { value: 'bank', label: 'Banka (Havale/EFT)' },
                                { value: 'pos', label: 'POS (Kredi Kartı)' }
                              ]}
                            />

                            {String(payNowSource) === 'bank' ? (
                              <FormSelect
                                label="Banka Hesabı *"
                                value={selectedBankAccountDefinitionId}
                                onChange={(e) => setSelectedBankAccountDefinitionId(String(e.target.value))}
                                options={bankAccountOptions.length > 0 ? [{ value: '', label: 'Seçiniz...' }, ...bankAccountOptions] : [{ value: '', label: 'Banka bulunamadı' }]}
                              />
                            ) : String(payNowSource) === 'pos' ? (
                              <FormSelect
                                label="POS Hesabı *"
                                value={selectedPosBankAccountDefinitionId}
                                onChange={(e) => setSelectedPosBankAccountDefinitionId(String(e.target.value))}
                                options={posAccountOptions.length > 0 ? [{ value: '', label: 'Seçiniz...' }, ...posAccountOptions] : [{ value: '', label: 'POS hesabı bulunamadı' }]}
                              />
                            ) : (
                              <FormSelect
                                label="Kasa Hesabı *"
                                value={selectedCashAccountId}
                                onChange={(e) => setSelectedCashAccountId(String(e.target.value))}
                                options={cashAccountOptions.length > 0 ? [{ value: '', label: 'Seçiniz...' }, ...cashAccountOptions] : [{ value: '', label: 'Kasa bulunamadı' }]}
                              />
                            )}
                          </div>

                          <div className="flex items-center gap-2 py-1 px-1">
                            <input
                              type="checkbox"
                              id="isPriceOverridden"
                              checked={isPriceOverridden}
                              onChange={(e) => {
                                const checked = e.target.checked
                                setIsPriceOverridden(checked)
                                if (!checked && requiredPaymentAmount > 0) {
                                  setCashReceivedAmount(String(Number(requiredPaymentAmount.toFixed(2))))
                                }
                              }}
                              className="rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                            />
                            <label htmlFor="isPriceOverridden" className="text-xs font-semibold text-gray-750 select-none cursor-pointer">
                              Farklı Tutar Öde / Tutarı Değiştir (Kısmi Ödeme)
                            </label>
                          </div>

                          <div className="p-3 bg-white border border-emerald-100 rounded-xl grid grid-cols-1 md:grid-cols-2 gap-4">
                            {accountCurrencyCode !== 'TRY' && (
                              <FormInput
                                /*
                                  Bu alan hesabın parasını FATURANIN parasına çeviren orandır
                                  (ikisi aynıysa 1). TL karşılığı üstteki kur çubuğundan
                                  hesaplanıp aşağıdaki özette ayrıca gösteriliyor — etiket
                                  eskiden "= ? TL" diyordu ama değer TL kuru değildi.
                                */
                                label={`Uygulanan Kur (1 ${accountCurrencyCode} = ? ${invoiceCurrencyCode})`}
                                value={customFxRateInput || String(targetFxRate)}
                                onChange={(e) => setCustomFxRateInput(e.target.value)}
                              />
                            )}
                            <FormInput
                              label={`Hesaba Giren Tutar (${accountCurrencyCode}) *`}
                              placeholder="0.00"
                              value={cashReceivedAmount}
                              disabled={!isPriceOverridden}
                              onChange={(e) => {
                                const val = e.target.value
                                if (/^[0-9]*[.,]?[0-9]*$/.test(val)) {
                                  setCashReceivedAmount(val)
                                }
                              }}
                            />
                          </div>

                          {/* HESAP ÖZETİ Panel */}
                          <div className="p-3.5 bg-white border border-gray-200 rounded-xl space-y-1.5 shadow-xs text-xs">
                            <div className="text-[10px] font-black text-emerald-600 uppercase tracking-wide mb-2">HESAP ÖZETİ</div>
                            <div className="flex justify-between py-1 border-b border-gray-100">
                              <span className="font-semibold text-gray-600">Hesaba Giren Tutar:</span>
                              <span className="font-bold text-gray-950">
                                {accountCurrencyCode !== 'TRY'
                                  ? `${Number(parsedCashReceived || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${accountCurrencyCode}`
                                  : `${Number(parsedCashReceived || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} TL`}
                              </span>
                            </div>
                            {accountCurrencyCode !== invoiceCurrencyCode && (
                              <div className="flex justify-between py-1 border-b border-gray-100">
                                <span className="font-semibold text-gray-600">Uygulanan Kur:</span>
                                <span className="font-bold text-gray-950">1 {accountCurrencyCode} = {targetFxRate} {invoiceCurrencyCode}</span>
                              </div>
                            )}
                            {accountCurrencyCode !== 'TRY' && (
                              <div className="flex justify-between py-1 border-b border-gray-100">
                                <span className="font-semibold text-gray-600">Kur (üstteki çubuktan):</span>
                                <span className="font-bold text-gray-950">
                                  1 {accountCurrencyCode} = {rateOf(accountCurrencyCode).toLocaleString('tr-TR', { minimumFractionDigits: 4, maximumFractionDigits: 4 })} TL
                                </span>
                              </div>
                            )}
                            {/*
                              Ekstreye işlenen tutar FATURANIN parasındadır; burada her şey
                              "₺" ile yazılıyordu, dövizli faturada ekranda TL sanılıyordu.
                              TL karşılığı ayrı satırda ve üstteki kur çubuğundan hesaplanıyor.
                            */}
                            <div className="flex justify-between py-1 border-b border-gray-100">
                              <span className="font-semibold text-gray-600">Ekstreye İşlenecek ({invoiceCurrencyCode}):</span>
                              <span className="font-bold text-emerald-700">
                                {Number(parsedCashReceivedInInvoiceCurrency || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {invoiceCurrencyCode === 'TRY' ? 'TL' : invoiceCurrencyCode}
                              </span>
                            </div>
                            {(accountCurrencyCode !== 'TRY' || invoiceCurrencyCode !== 'TRY') && (
                              <div className="flex justify-between py-1 border-b border-gray-100">
                                <span className="font-semibold text-gray-600">TL Karşılığı:</span>
                                <span className="font-bold text-emerald-700">
                                  ₺{(Number(parsedCashReceived || 0) * rateOf(accountCurrencyCode)).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </span>
                              </div>
                            )}
                            <div className="flex justify-between py-1">
                              <span className="font-semibold text-gray-600">Giriş Hesabı (Kasaya/Bankaya Giren):</span>
                              <span className="font-bold text-gray-950">{selectedAccountLabel || 'Lütfen hesap seçiniz'}</span>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Detail block for Option 3: Artan Hesaplı Ödeme (Para Üstü) */}
                      {paymentMode === 'pay_with_change' && (
                        <div className="p-4 border border-purple-100 bg-purple-50/10 rounded-xl space-y-4 text-left">
                          <div className="flex items-center gap-2 text-[10px] font-bold text-purple-800 uppercase tracking-wider">
                            <span className="w-1.5 h-1.5 rounded-full bg-purple-500 animate-pulse"></span>
                            <span>Peşinat & Tahsilat Girişi (Artan Hesaplı / Para Üstülü)</span>
                          </div>

                          <div className="space-y-4">
                            {/* Alınacak Hesap */}
                            <div>
                              {String(payNowSource) === 'bank' ? (
                                <FormSelect
                                  label="ALINACAK KASA / BANKA HESABI *"
                                  value={selectedBankAccountDefinitionId}
                                  onChange={(e) => setSelectedBankAccountDefinitionId(String(e.target.value))}
                                  options={bankAccountOptions.length > 0 ? [{ value: '', label: 'Seçiniz...' }, ...bankAccountOptions] : [{ value: '', label: 'Banka bulunamadı' }]}
                                />
                              ) : String(payNowSource) === 'pos' ? (
                                <FormSelect
                                  label="ALINACAK KASA / BANKA HESABI *"
                                  value={selectedPosBankAccountDefinitionId}
                                  onChange={(e) => setSelectedPosBankAccountDefinitionId(String(e.target.value))}
                                  options={posAccountOptions.length > 0 ? [{ value: '', label: 'Seçiniz...' }, ...posAccountOptions] : [{ value: '', label: 'POS hesabı bulunamadı' }]}
                                />
                              ) : (
                                <FormSelect
                                  label="ALINACAK KASA / BANKA HESABI *"
                                  value={selectedCashAccountId}
                                  onChange={(e) => setSelectedCashAccountId(String(e.target.value))}
                                  options={cashAccountOptions.length > 0 ? [{ value: '', label: 'Seçiniz...' }, ...cashAccountOptions] : [{ value: '', label: 'Kasa bulunamadı' }]}
                                />
                              )}
                            </div>

                            {/* Borç Tutarı & Ödeme Türü */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              <FormInput
                                label="BORÇ TUTARI"
                                value={`${invoiceCurrencyGrandTotal.toFixed(2)} ${invoiceCurrencyCode}`}
                                disabled
                              />
                              <FormSelect
                                label="ÖDEME TÜRÜ"
                                value={payNowSource}
                                onChange={(e) => {
                                  const v = String(e.target.value)
                                  setPayNowSource(v)
                                  if (v === 'cash') setSelectedBankAccountDefinitionId('')
                                  if (v === 'bank') setSelectedCashAccountId('')
                                  if (v !== 'pos') setSelectedPosBankAccountDefinitionId('')
                                }}
                                options={[
                                  { value: 'cash', label: 'Nakit (Kasa)' },
                                  { value: 'bank', label: 'Banka (Havale/EFT)' },
                                  { value: 'pos', label: 'POS (Kredi Kartı)' }
                                ]}
                              />
                            </div>

                            {/* Kur Oranı & Ödenen Tutar */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              <FormInput
                                /* Oran hesabın parasını FATURANIN parasına çevirir (aynıysa 1). */
                                label={`UYGULANAN KUR (1 ${accountCurrencyCode} = ? ${invoiceCurrencyCode})`}
                                value={customFxRateInput || String(targetFxRate)}
                                onChange={(e) => setCustomFxRateInput(e.target.value)}
                                disabled={accountCurrencyCode === invoiceCurrencyCode}
                              />
                              <FormInput
                                label={`ÖDENEN TUTAR (KASAYA GİREN) *`}
                                /* Gereken tutar dört hâli de doğru çözen `requiredPaymentAmount`tan gelir. */
                                placeholder={`Gerekli: ${requiredPaymentAmount.toFixed(2)} ${accountCurrencyCode}`}
                                value={cashReceivedAmount}
                                onChange={(e) => setCashReceivedAmount(e.target.value)}
                              />
                            </div>

                            {/* Para Üstü Çıkacak Kasa/Banka */}
                            <div>
                              <FormSelect
                                label="PARA ÜSTÜ ÇIKACAK KASA/BANKA *"
                                value={selectedChangeCashAccountId}
                                onChange={(e) => {
                                  const val = String(e.target.value)
                                  setSelectedChangeCashAccountId(val)
                                  setSelectedChangeBankAccountDefinitionId('')
                                }}
                                options={[
                                  { value: '', label: 'Gerekirse seçin (Para üstünün verileceği TL Kasası)' },
                                  ...cashAccountOptions
                                ]}
                              />
                            </div>
                          </div>

                          {/* HESAP ÖZETİ Panel */}
                          <div className="p-3.5 bg-white border border-purple-200 rounded-xl space-y-1.5 shadow-xs text-xs">
                            <div className="text-[10px] font-black text-purple-700 uppercase tracking-wide mb-2">HESAP ÖZETİ</div>
                            <div className="flex justify-between py-1 border-b border-gray-100">
                              <span className="font-semibold text-gray-600">Gereken Tutar:</span>
                              <span className="font-bold text-gray-950">
                                {requiredPaymentAmount.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{' '}
                                {accountCurrencyCode === 'TRY' ? 'TL' : accountCurrencyCode}
                              </span>
                            </div>
                            {accountCurrencyCode !== invoiceCurrencyCode && (
                              <div className="flex justify-between py-1 border-b border-gray-100">
                                <span className="font-semibold text-gray-600">Uygulanan Kur:</span>
                                <span className="font-bold text-gray-950">1 {accountCurrencyCode} = {targetFxRate} {invoiceCurrencyCode}</span>
                              </div>
                            )}
                            {accountCurrencyCode !== 'TRY' && (
                              <div className="flex justify-between py-1 border-b border-gray-100">
                                <span className="font-semibold text-gray-600">Kur (üstteki çubuktan):</span>
                                <span className="font-bold text-gray-950">
                                  1 {accountCurrencyCode} = {rateOf(accountCurrencyCode).toLocaleString('tr-TR', { minimumFractionDigits: 4, maximumFractionDigits: 4 })} TL
                                </span>
                              </div>
                            )}
                            <div className="flex justify-between py-1 border-b border-gray-100">
                              <span className="font-semibold text-gray-600">Alınan Miktar:</span>
                              <span className="font-bold text-indigo-700">
                                {Number(cashReceivedAmount) > 0 ? `${Number(cashReceivedAmount).toFixed(2)} ${accountCurrencyCode}` : '-'}
                              </span>
                            </div>
                            {changeAmount > 0 && (
                              <div className="flex justify-between py-1 border-b border-gray-100">
                                <span className="font-semibold text-gray-600">Para Üstü ({invoiceCurrencyCode === 'TRY' ? 'TL' : invoiceCurrencyCode}):</span>
                                <span className="font-bold text-amber-700">
                                  {formatMoney(changeInInvoiceCurrency)} {invoiceCurrencyCode === 'TRY' ? 'TL' : invoiceCurrencyCode}
                                </span>
                              </div>
                            )}
                            {changeAmount > 0 && (
                              <div className="flex justify-between py-1 border-b border-gray-100">
                                <span className="font-semibold text-gray-600">Para Üstü Tutar:</span>
                                <span className="font-bold text-amber-700">{changeAmountVal.toFixed(2)} {changeCurrency}</span>
                              </div>
                            )}
                            <div className="flex justify-between py-1">
                              <span className="font-semibold text-gray-600">Alınan Hesap (Giriş):</span>
                              <span className="font-bold text-gray-950">{selectedAccountLabel || '-'}</span>
                            </div>
                            {changeAmount > 0 && (
                              <div className="flex justify-between py-1 border-t border-gray-100 pt-1 mt-1">
                                <span className="font-semibold text-gray-600">Para Üstü Verilen (Çıkış):</span>
                                <span className="font-bold text-gray-950">{selectedChangeAccountLabel || '-'}</span>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })()}
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center gap-3 w-full mt-6 border-t border-gray-200 pt-4">
              <button
                type="button"
                onClick={() => {
                  setConfirmCreateOpen(false)
                }}
                className="flex-1 h-[42px] px-4 text-xs font-bold rounded-xl border border-gray-200 bg-white hover:bg-gray-50 active:bg-gray-100 text-gray-700 transition active:scale-95 shadow-xs"
              >
                Vazgeç
              </button>
              <button
                type="button"
                onClick={handleCreateConfirm}
                className="flex-1 h-[42px] px-4 text-xs font-bold rounded-xl bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white transition active:scale-95 shadow-md hover:shadow-lg flex items-center justify-center gap-2"
              >
                <Check size={16} />
                <span>Evet, Faturayı Oluştur</span>
              </button>
            </div>
          </div>
        </Modal>

      <div className="w-[520px] max-w-full">

        <FormSelect

          label="Cari"

          value={selectedCustomer}

          onChange={(e) => setSelectedCustomer(String(e.target.value))}

          options={customersState.length > 0 ? customersState : [{ value: '', label: loading ? 'Yükleniyor...' : 'Seçiniz...' }]}

        />

      </div>



      {selectedCustomer ? (

        <div className="mt-4 border border-gray-200 rounded bg-white">

          <div className="p-4 border-b border-gray-200">
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2 items-end mt-2">
              <div className="col-span-1">
                <FormInput label="Cari Kodu" value={selectedCustomer} disabled onChange={() => { }} />
              </div>

              <div className="col-span-1">
                <FormInput
                  label="Fatura Seri"
                  value={selectedCustomer ? (isOpenCustomer ? '1' : invoiceSerie) : 'Otomatik'}
                  disabled={!selectedCustomer || isOpenCustomer}
                  placeholder={isOpenCustomer ? '1' : 'Seri (ör: A)'}
                  onChange={(e) => setInvoiceSerie(e.target.value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(-1))}
                  data-no-capitalize="true"
                />
              </div>

              <div className="col-span-1">
                <FormInput
                  label="Fatura No"
                  value={isOpenCustomer ? '' : invoiceNumber}
                  disabled={!selectedCustomer || isOpenCustomer}
                  placeholder={isOpenCustomer ? 'Otomatik' : 'Fatura No'}
                  onChange={(e) => setInvoiceNumber(e.target.value.replace(/[^0-9]/g, '').slice(0, 14))}
                  data-no-capitalize="true"
                />
              </div>

              <div className="col-span-1">
                <FormInput label="Tarih" type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(String(e.target.value))} />
              </div>

              {/*
                DÖVİZ KURU ALANI KALDIRILDI (2026-08-19 kullanıcı kararı).

                Aynı kur sayfanın en üstündeki TCMB çubuğunda zaten var ve elle
                değiştirilebiliyor; burada ikinci bir giriş kutusu iki ayrı doğruluk kaynağı
                yaratıyordu. `invoiceRateInput` state'i duruyor — belgenin para birimine göre
                üstteki çubuktan otomatik besleniyor (aşağıdaki "Auto-match invoice currency
                rate" efekti) ve tahsilat hesaplarında kullanılıyor.
              */}

              <div className="col-span-1">
                <FormInput
                  label="Fatura IRD"
                  value={computedInvoiceNo || (selectedCustomer ? (isOpenCustomer ? 'Otomatik' : `${invoiceSerie || 'A'}${'0'.repeat(15 - (invoiceSerie || 'A').length)}`) : 'Otomatik')}
                  disabled
                  onChange={() => { }}
                  data-no-capitalize="true"
                />
              </div>

              {/*
                TOPLU DEPO (kullanıcı kuralı, 2026-08-14).

                Kalemlerin kendi deposu varsa üstte depo sormaya gerek yok — seçici yalnızca
                deposu çözülemeyen kalem kaldığında çıkıyor ve seçim SADECE o boş kalemleri
                dolduruyor. Kullanıcının tek deposu varsa zaten sorulmuyor.
              */}
              {!userHasSingleWarehouse && (
                <div className="col-span-1">
                  {linesMissingWarehouseCount === 0 && linesState.length > 0 ? (
                    <div className="flex flex-col justify-end h-full">
                      <div className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide mb-1">Depo</div>
                      <div className="h-9 flex items-center gap-1.5 px-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-[11px] font-bold text-emerald-800">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 shrink-0"></span>
                        <span className="truncate" title="Her kalem, işlemi yapan kişinin varsayılan deposundan çıkıyor.">
                          Kalemler kendi deposundan
                        </span>
                      </div>
                    </div>
                  ) : (
                    <FormSelect
                      label={linesMissingWarehouseCount > 0 ? `Toplu Depo (${linesMissingWarehouseCount} boş kalem)` : 'Toplu Depo'}
                      value={selectedWarehouseCode}
                      onChange={(e) => setSelectedWarehouseCode(String(e.target.value))}
                      disabled={warehousesLoading}
                      options={[
                        { value: '', label: warehousesLoading ? 'Yükleniyor...' : 'Seçiniz...' },
                        ...warehouses.map((w) => ({
                          value: String(w.warehouseCode),
                          label: `${w.warehouseCode} - ${w.name ?? ''}`.trim()
                        }))
                      ]}
                    />
                  )}
                </div>
              )}

              <div className="col-span-1 flex justify-end">
                <button
                  type="button"
                  disabled={!selectedCustomer}
                  className="w-full py-2 px-3 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg shadow-xs transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={async () => {
                    try {
                      if (!selectedCustomer) {
                        showMessage('Uyarı', 'Cari seçiniz')
                        return
                      }
                      if (!isOpenCustomer && !String(invoiceNumber ?? '').trim()) {
                        showMessage('Uyarı', 'Fatura numarası girmediniz')
                        return
                      }
                      if (selectedLines.length === 0) {
                        showMessage('Uyarı', 'Ürün seçmediniz')
                        return
                      }
                      if (selectedLines.length > MAX_SELECTED_LINES) {
                        showMessage('Uyarı', `En fazla ${MAX_SELECTED_LINES} kalem faturalaştırabilirsiniz.`)
                        return
                      }
                      // Kalemlerin kendi deposu varsa üstteki seçici boş kalabilir; uyarı
                      // yalnızca HİÇBİR depo çözülemediğinde çıkar.
                      if (!userHasSingleWarehouse && effectiveWarehouseCode === 0) {
                        showMessage('Uyarı', 'Depo seçiniz')
                        return
                      }
                      // Deposu ÇÖZÜLEMEYEN kalem varken fatura kesilemez. Eskiden tek bir kalemin
                      // deposu çözülünce kontrol geçiyordu ve kalan kalemler sessizce başlık
                      // deposundan (çoğu zaman yanlış depodan) düşüyordu.
                      const unresolved = selectedLines.filter((l) => resolveLineWarehouseCode(l) === 0)
                      if (unresolved.length > 0) {
                        showMessage(
                          'Uyarı',
                          `${unresolved.length} kalemin çıkış deposu belirlenemedi. Satırdaki depo seçicisinden ya da üstteki "Toplu Depo" alanından seçim yapın.`
                        )
                        return
                      }
                      if (isDirty) {
                        showMessage('Uyarı', "Lütfen sipariş listesindeki değişikliklerinizi uygulamak için önce 'Seçimleri Kaydet ve Hesapla' butonuna tıklayınız.")
                        return
                      }

                      const invoiceLinesPayload = selectedLines
                        .map((l) => ({
                          salesOrderLineId: l.salesOrderLineId,
                          invoiceQuantity: Number(invoiceQtyByLineId[l.salesOrderLineId] ?? 0)
                        }))
                        .filter((l) => Number(l.invoiceQuantity ?? 0) > 0)

                      if (invoiceLinesPayload.length === 0) {
                        showMessage('Hata', 'Fatura miktarı 0 olan satırlar faturalanamaz.')
                        return
                      }

                      // Initialize payment fields to default (Vadeli) when modal is opened
                      setPaymentMode('open_account')
                      setTakePaymentNow(false)
                      setCashReceivedAmount('')
                      setSelectedCashAccountId('')
                      setSelectedBankAccountDefinitionId('')
                      setSelectedPosBankAccountDefinitionId('')
                      setSelectedChangeCashAccountId('')
                      setSelectedChangeBankAccountDefinitionId('')
                      setConfirmCreateOpen(true)
                    } catch {
                      showMessage('Hata', 'İşlem gerçekleştirilemedi')
                    }
                  }}
                >
                  OLUŞTUR
                </button>
              </div>
            </div>
          </div>

          <div className="p-4">



            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="text-xs font-bold text-gray-700">Siparişler</div>
                {isDirty && (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[9px] font-extrabold bg-amber-50 text-amber-800 animate-pulse border border-amber-200 shadow-xs">
                    ⚠️ Değişiklikler Kaydedilmedi
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={linesState.length === 0}
                  onClick={toggleSelectAll}
                  className="px-3 py-1.5 text-[11px] font-bold rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 transition"
                >
                  {linesState.length > 0 && linesState.slice(0, Math.min(linesState.length, MAX_SELECTED_LINES)).every((l) => Boolean(draftSelectedLineIds[l.salesOrderLineId])) ? 'Seçimi Kaldır' : 'Hepsini Seç'}
                </button>

                <button
                  type="button"
                  disabled={linesState.length === 0}
                  onClick={() => {
                    setSelectedLineIds(draftSelectedLineIds)
                    setInvoiceQtyByLineId(draftInvoiceQtyByLineId)
                    showToast('Seçimler uygulandı ve genel toplam hesaplandı.')
                  }}
                  className={`px-3 py-1.5 text-[11px] font-extrabold rounded-lg shadow-sm transition flex items-center gap-1 ${
                    isDirty
                      ? 'bg-blue-600 hover:bg-blue-700 text-white animate-bounce'
                      : 'bg-gray-100 text-gray-400 border border-gray-200 cursor-not-allowed'
                  }`}
                >
                  <Save size={13} />
                  <span>Seçimleri Kaydet ve Hesapla</span>
                </button>
              </div>
            </div>

            <div className="border border-gray-200 rounded overflow-hidden">

              <div className="grid grid-cols-12 bg-gray-50 text-[11px] font-semibold text-gray-600 px-3 py-2">

                <div className="col-span-1" />

                <div className="col-span-1">Sipariş Tarihi</div>

                <div className="col-span-2">Sipariş No</div>

                {/*
                  "İşlemi Yapan" sütununun altında kalemin ÇIKIŞ DEPOSU seçicisi duruyor;
                  tek birimlik sütunda seçici "Ürün Adı" sütununa dayanıyordu. Sütun iki
                  birime çıkarıldı, karşılığında yalnızca bir düğme taşıyan "Montaj" sütunu
                  bire indirildi (toplam yine 12).
                */}
                <div className="col-span-2">İşlemi Yapan</div>

                <div className="col-span-2">Ürün Adı</div>

                <div className="col-span-1">Açıklama</div>

                <div className="col-span-1">Montaj</div>

                <div className="col-span-1 text-right">Sipariş Mikt.</div>

                <div className="col-span-1 text-right">Fatura Mikt.</div>

              </div>



              {linesLoading ? (

                <div className="p-6 text-sm text-gray-500">Yükleniyor...</div>

              ) : linesState.length === 0 ? (

                <div className="p-6 text-sm text-gray-500">Kayıt bulunamadı.</div>

              ) : (

                <div className="divide-y divide-gray-100">

                  {linesState.map((l) => {

                    const checked = Boolean(draftSelectedLineIds[l.salesOrderLineId])

                    // TEK DÖVİZ KİLİDİ: seçili bir kalem varsa, farklı dövizli satır işaretlenemez.
                    // Kilit yalnız İŞARETLEMEYİ kapatır — zaten seçili bir satır her zaman
                    // kaldırılabilir, yoksa kullanıcı yanlış seçimden çıkamazdı.
                    const currencyLocked = !checked && draftCurrencyTypeId !== null && lineCurrencyTypeId(l) !== draftCurrencyTypeId

                    const maxQty = Number(l.remainingQuantity ?? l.orderQuantity ?? 0)

                    const qty = Number(draftInvoiceQtyByLineId[l.salesOrderLineId] ?? 0)

                    const montaj = parseMontajTag(l.description)
                    const baseDesc = cleanupDescription(stripCampaignLine(l.description))
                    const campaignInfo = parseCampaignLine(l.description)

                    return (

                      <div key={l.salesOrderLineId} className={"grid grid-cols-12 px-3 py-2 text-[11px] " + (checked ? 'bg-green-100/50' : currencyLocked ? 'bg-gray-50 opacity-60' : 'bg-white')}>

                        <div className="col-span-1 flex items-center gap-1.5">

                          <input

                            type="checkbox"

                            checked={checked}

                            disabled={currencyLocked}

                            title={currencyLocked
                              ? `Bu fatura ${currencyCodeByTypeId(draftCurrencyTypeId ?? 1)} olarak kesiliyor. ${currencyCodeByTypeId(lineCurrencyTypeId(l))} kalem aynı faturaya giremez; ayrı fatura kesin.`
                              : undefined}

                            className={currencyLocked ? 'cursor-not-allowed' : undefined}

                            onChange={(e) => {

                              const next = Boolean(e.target.checked)



                              if (next) {

                                // Kilitli satır zaten `disabled`; bu kapı klavye/otomasyon gibi
                                // `disabled`ı atlayan yollar için duruyor.
                                if (currencyLocked) {
                                  showMessage(
                                    'Farklı döviz',
                                    `Bir faturada tek döviz olabilir. Bu fatura ${currencyCodeByTypeId(draftCurrencyTypeId ?? 1)} olarak kesiliyor; ${currencyCodeByTypeId(lineCurrencyTypeId(l))} kalem için ayrı fatura kesin.`
                                  )
                                  return
                                }

                                const nextCount = Object.values(draftSelectedLineIds).filter(Boolean).length + 1

                                if (nextCount > MAX_SELECTED_LINES) {

                                  showMessage('Uyarı', `En fazla ${MAX_SELECTED_LINES} kalem faturalaştırabilirsiniz.`)

                                  return

                                }

                              }



                              setDraftSelectedLineIds((prev) => ({ ...prev, [l.salesOrderLineId]: next }))

                              if (next) {

                                setDraftInvoiceQtyByLineId((prev) => ({ ...prev, [l.salesOrderLineId]: maxQty }))

                              } else {

                                setDraftInvoiceQtyByLineId((prev) => {

                                  const copy = { ...prev }

                                  delete copy[l.salesOrderLineId]

                                  return copy

                                })

                              }

                            }}

                          />

                        </div>

                        <div className="col-span-1">{new Date(l.orderDate).toLocaleDateString('tr-TR')}</div>

                        <div className="col-span-2">{l.orderNo}</div>

                        <div className="col-span-2 pr-3">
                          <div className="font-bold text-gray-900 truncate">
                            {l.servicePerformerName || l.createdByUsername || l.processedBy || 'Servis Yetkilisi'}
                          </div>

                          {/*
                            SERVİS ROZETİ + KALEM DEPOSU.

                            Rozet yalnızca SERVİSTEN damgalı kalemde çıkar (`defaultWarehouseSource
                            === 'servis'`). Kontrol eskiden `sourceWarehouseCode > 0` idi; negatif
                            kodlu depolar (ör. -21) yüzünden rozet hiç görünmüyordu.
                          */}
                          {l.defaultWarehouseSource === 'servis' && (
                            <div
                              className="mt-0.5 text-[9px] font-black text-white bg-rose-600 rounded px-1.5 py-0.5 inline-block"
                              title={`Servis kalemi — ${l.servicePerformerName || 'işlemi yapan'} kişinin deposundan çıkar`}
                            >
                              SERVİS
                            </div>
                          )}

                          {(() => {
                            const resolved = resolveLineWarehouseCode(l)
                            const preset = lineDefaultWarehouseCode(l)
                            // Kalemin öntanımlı deposu, faturayı kesen kişinin YETKİLİ olduğu
                            // depolar arasında olmayabilir ve bu normaldir: depo, kalemi giren
                            // kişinin varsayılanıdır. Seçeneği elle eklemezsek `value` hiçbir
                            // seçenekle eşleşmez, tarayıcı listenin ilk deposunu gösterir ve
                            // ekran yalan söyler — bu ekranda tam olarak yaşanmış tuzak budur.
                            const presetMissing = preset !== 0 && !warehouses.some((w) => Number(w.warehouseCode) === preset)

                            return (
                              <select
                                value={String(resolved || '')}
                                onChange={(e) => {
                                  const val = String(e.target.value)
                                  setLineWarehouseByLineId((prev) => ({ ...prev, [l.salesOrderLineId]: val }))
                                }}
                                onClick={(e) => e.stopPropagation()}
                                disabled={warehousesLoading || warehouses.length === 0}
                                title={
                                  resolved === 0
                                    ? 'Bu kalemin çıkış deposu belirlenemedi — seçin ya da üstteki Toplu Depo alanını kullanın.'
                                    : `Bu kalemin çıkış deposu: ${warehouseLabel(resolved)}${
                                        l.defaultWarehouseSource === 'kullanici' && preset === resolved
                                          ? ` (${l.createdByUsername || 'işlemi yapan'} kişinin varsayılan deposu)`
                                          : ''
                                      }`
                                }
                                className={`mt-0.5 w-full text-[9px] font-bold rounded border px-1 py-0.5 ${
                                  resolved === 0
                                    ? 'bg-rose-50 border-rose-300 text-rose-800'
                                    : resolved !== effectiveWarehouseCode
                                      ? 'bg-amber-50 border-amber-300 text-amber-900'
                                      : 'bg-white border-gray-200 text-gray-600'
                                }`}
                              >
                                {/*
                                  GERÇEK BOŞ SEÇENEK. Depo çözülemediğinde `value=""` buna oturur;
                                  olmadığı sürece tarayıcı ilk depoyu seçili GÖSTERİYOR ama state
                                  boş kalıyordu — "hepsi -21 YP SİPARİŞ'ten geliyor" şikâyetinin
                                  kaynağı buydu.
                                */}
                                {resolved === 0 && <option value="">Depo seçiniz...</option>}

                                {presetMissing && (
                                  <option value={String(preset)}>
                                    {`${preset} - ${l.defaultWarehouseName ?? (l.defaultWarehouseSource === 'servis' ? 'Servis Deposu' : 'Diğer Depo')}`}
                                  </option>
                                )}
                                {warehouses.map((w) => (
                                  <option key={String(w.warehouseCode)} value={String(w.warehouseCode)}>
                                    {`${w.warehouseCode} - ${w.name ?? ''}`.trim()}
                                  </option>
                                ))}
                              </select>
                            )
                          })()}

                          {(l as any).assignedWarehouses ? (
                            <div className="mt-0.5 text-[9px] font-bold text-amber-800 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5 inline-block truncate max-w-full" title={(l as any).assignedWarehouses}>
                              📦 {(l as any).assignedWarehouses}
                            </div>
                          ) : null}
                        </div>

                        <div className="col-span-2">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="truncate">{l.productName}</span>
                            {l.isGift && (
                              <span className="px-1 py-0.5 rounded bg-green-100 text-green-700 text-[8px] font-extrabold uppercase shrink-0">Hediye</span>
                            )}
                          </div>
                          <div className="mt-0.5 text-[10px] font-bold text-slate-600">{formatUnitPriceDisplay(l)}</div>
                        </div>

                        <div className="col-span-1" title={baseDesc}>
                          {baseDesc && <div className="truncate">{baseDesc}</div>}
                          {campaignInfo && (
                            <div className="mt-1 flex items-start gap-1 rounded bg-green-50 border border-green-200 px-2 py-1">
                              <Gift size={11} className="text-green-600 mt-0.5 shrink-0" />
                              <span className="text-[10px] font-semibold text-green-700 leading-tight break-words">
                                {campaignInfo}
                              </span>
                            </div>
                          )}
                          {montaj ? (
                            <div className="mt-1 rounded border border-slate-200 bg-slate-50 px-2 py-1">
                              <div className="flex items-center justify-between text-[10px] font-semibold text-slate-600">
                                <div className="uppercase tracking-wide">Montaj</div>
                                <div className="text-slate-900 font-extrabold">{formatMoney(montaj.gross)}</div>
                              </div>
                              <div className="mt-1 grid grid-cols-3 gap-2 text-[10px] font-semibold text-slate-600">
                                <div>
                                  <div className="uppercase tracking-wide">KDV Hariç</div>
                                  <div className="text-slate-800 font-bold">{formatMoney(montaj.net)}</div>
                                </div>
                                <div>
                                  <div className="uppercase tracking-wide">KDV {Number.isFinite(montaj.rate) && montaj.rate > 0 ? `%${Math.round(montaj.rate)}` : '%0'}</div>
                                  <div className="text-slate-800 font-bold">{formatMoney(montaj.vat)}</div>
                                </div>
                                <div className="text-right">
                                  <div className="uppercase tracking-wide">KDV Dahil</div>
                                  <div className="text-slate-900 font-extrabold">{formatMoney(montaj.gross)}</div>
                                </div>
                              </div>
                            </div>
                          ) : null}
                        </div>

                        <div className="col-span-1">
                          {customMontajs[l.salesOrderLineId]?.isimSoyisim || l.installationName ? (
                            <div className="space-y-1">
                              <div className="font-extrabold text-orange-700 uppercase truncate">
                                {customMontajs[l.salesOrderLineId]?.isimSoyisim || l.installationName}
                              </div>
                              <button
                                type="button"
                                onClick={() => handleOpenMontajModal(l)}
                                className="text-[9px] font-bold text-orange-600 hover:text-orange-700 bg-orange-50 hover:bg-orange-100 border border-orange-200 rounded px-1.5 py-0.5 block transition-colors"
                              >
                                Montaj Düzenle
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleOpenMontajModal(l)}
                              className="text-[9px] font-bold text-gray-500 hover:text-gray-700 bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded px-1.5 py-0.5 transition-colors"
                            >
                              Montaj Ekle
                            </button>
                          )}
                        </div>

                        <div className="col-span-1 text-right">{Number(l.remainingQuantity ?? l.orderQuantity ?? 0)}</div>

                        <div className="col-span-1 text-right">
                          <input
                            type="number"
                            min={0}
                            max={maxQty}
                            disabled={!checked}
                            value={checked ? String(qty) : ''}
                            onChange={(e) => {
                              const n = Number(e.target.value)
                              const clamped = Math.max(0, Math.min(maxQty, Number.isFinite(n) ? n : 0))
                              setDraftInvoiceQtyByLineId((prev) => ({ ...prev, [l.salesOrderLineId]: clamped }))
                            }}
                            className={
                              'w-20 px-2 py-1 border rounded bg-white text-[11px] ' +
                              (checked ? 'border-gray-300' : 'border-gray-200 text-gray-400')
                            }
                          />
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

              {isDirty && linesState.length > 0 && (
                <div className="p-3 bg-amber-50/50 border-t border-amber-200/60 flex items-center justify-between text-xs rounded-b-xl">
                  <span className="text-amber-800 font-semibold flex items-center gap-1.5">
                    <CircleAlert size={14} className="text-amber-600 shrink-0" />
                    Seçim veya miktarlarda değişiklik yaptınız. Genel toplamı güncellemek için kaydetmelisiniz.
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedLineIds(draftSelectedLineIds)
                      setInvoiceQtyByLineId(draftInvoiceQtyByLineId)
                      showToast('Seçimler uygulandı ve genel toplam hesaplandı.')
                    }}
                    className="px-3 py-1.5 text-[11px] font-bold rounded-lg bg-blue-600 hover:bg-blue-700 text-white shadow-xs flex items-center gap-1 transition"
                  >
                    <Save size={13} />
                    <span>Seçimleri Kaydet ve Hesapla</span>
                  </button>
                </div>
              )}
            </div>

            <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="border border-gray-200 rounded-lg p-2.5 bg-gray-50 flex flex-col justify-between">
                <div>
                  <div className="text-xs font-bold text-gray-700 mb-1 flex items-center justify-between">
                    <span>NOT / Açıklama</span>
                    <span className="text-[11px] font-medium text-gray-500">Kalem Sayısı: <b className="text-gray-800">{selectedLines.length}</b></span>
                  </div>
                  <textarea
                    value={note}
                    onChange={(e) => setNote(String(e.target.value))}
                    placeholder="Fatura genel notu veya açıklaması..."
                    className="w-full h-16 bg-white border border-gray-200 rounded-md p-2 text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500 font-medium"
                  />
                </div>
              </div>

              <div className="border border-gray-200 rounded-lg p-2.5 bg-gray-50 space-y-1.5">
                <div className="text-xs font-bold text-gray-700 mb-1">Fatura Özeti & Toplamlar</div>
                <div className="space-y-1 text-xs">
                  <div className="flex items-center justify-between bg-white border border-gray-200 rounded px-2.5 py-1">
                    <div className="text-gray-600 font-medium">Ara Toplam</div>
                    <div className="text-gray-900 font-bold">
                      {fxTotals ? (
                        `${fxTotals.subtotal.toFixed(2)} ${currencyCodeByTypeId(fxTotals.currencyTypeId)}`
                      ) : (
                        formatMoney(totals.subtotal)
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-1.5 items-center">
                    <div className="col-span-1">
                      <select
                        value={discountType}
                        onChange={(e) => setDiscountType(e.target.value as DiscountType)}
                        className="w-full px-2 py-1 text-xs border border-gray-200 rounded bg-white font-medium"
                      >
                        <option value="amount">İndirim ({fxTotals ? currencyCodeByTypeId(fxTotals.currencyTypeId) : '₺'})</option>
                        <option value="percentage">İndirim (%)</option>
                      </select>
                    </div>
                    <div className="col-span-2">
                      <input
                        type="text"
                        placeholder={`Maks. %${getActiveUserDiscountRate(layout)}`}
                        value={discountValue}
                        onChange={(e) => {
                          const val = String(e.target.value ?? '')
                          const maxRate = getActiveUserDiscountRate(layout)
                          const num = Number(val.replace(',', '.'))
                          if (Number.isFinite(num) && num > 0) {
                            if (discountType === 'percentage' && num > maxRate) {
                              setDiscountValue(String(maxRate))
                              return
                            }
                            if (discountType === 'amount') {
                              const maxAmount = totals.kdvDahilTaban * (maxRate / 100)
                              if (num > maxAmount) {
                                setDiscountValue(String(maxAmount.toFixed(2)))
                                return
                              }
                            }
                          }
                          setDiscountValue(val)
                        }}
                        className="w-full px-2 py-1 text-xs border border-gray-200 rounded bg-white font-medium"
                      />
                      {getActiveUserDiscountRate(layout) < 100 && (
                        <div className="text-[10px] text-amber-700 font-semibold mt-0.5">
                          Maks. Yetkiniz: %{getActiveUserDiscountRate(layout)}
                        </div>
                      )}
                    </div>
                  </div>

                  {totals.discount > 0 && (
                    <div className="flex items-center justify-between bg-emerald-50 border border-emerald-200 rounded px-2.5 py-1 text-emerald-800">
                      <div className="font-semibold">Fatura İndirimi</div>
                      <div className="font-bold">
                        {fxTotals ? (
                          `${currencyCodeByTypeId(fxTotals.currencyTypeId)} -${(totals.discount / (Number(invoiceRateInput || paymentRateInput) || 1)).toFixed(2)}`
                        ) : (
                          `-${formatMoney(totals.discount)}`
                        )}
                      </div>
                    </div>
                  )}

                  <div className="flex items-center justify-between bg-white border border-gray-200 rounded px-2.5 py-1">
                    <div className="text-gray-600 font-medium">KDV Tutar</div>
                    <div className="text-gray-900 font-bold">
                      {fxTotals ? (
                        `${fxTotals.vatTotal.toFixed(2)} ${currencyCodeByTypeId(fxTotals.currencyTypeId)}`
                      ) : (
                        formatMoney(totals.vatTotal)
                      )}
                    </div>
                  </div>

                  {campaignDiscountTotal >= 0.01 && (
                    <div className="flex items-center justify-between bg-green-50 border border-green-200 rounded px-3 py-2">
                      <div className="text-green-700 font-semibold">İndirim/Kampanya</div>
                      <div className="text-green-700 font-semibold">
                        {fxTotals ? (
                          `-${currencyCodeByTypeId(fxTotals.currencyTypeId)} ${Number(fxTotals.kampanyaNet).toFixed(2)}`
                        ) : (
                          `-${formatMoney(totals.campaignDiscount)}`
                        )}
                      </div>
                    </div>
                  )}

                  <div className="flex items-center justify-between bg-white border border-gray-200 rounded px-3 py-2">
                    <div className="text-gray-600 font-semibold">Genel Toplam</div>
                    <div className="text-gray-900 font-semibold">
                      {fxTotals ? (
                        `${fxTotals.grandTotal.toFixed(2)} ${currencyCodeByTypeId(fxTotals.currencyTypeId)}`
                      ) : (
                        formatMoney(totals.grandTotal)
                      )}
                    </div>
                  </div>

                </div>
              </div>
            </div>

            {warehouses.length > 0 && selectedProducts.length > 0 ? (() => {
              const activeWarehouses = warehouses.filter((w) => {
                return selectedProducts.some((p) => {
                  const perStock = balanceByWarehouseAndStockCode.get(Number(w.warehouseCode))
                  const qty = perStock?.get(p.stockCode.toLowerCase()) ?? 0
                  return Math.floor(qty) > 0
                })
              })

              if (activeWarehouses.length === 0) {
                return (
                  <div className="mt-6 border border-slate-100 rounded-xl p-3 bg-white shadow-xs">
                    <div className="flex items-center gap-1.5 mb-2 border-b border-slate-50 pb-1.5">
                      <span className="text-xs">🏬</span>
                      <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Depo Stok Durumları</div>
                    </div>
                    <div className="text-[10px] text-slate-400 py-1 font-medium italic bg-slate-50 border border-slate-150 border-dashed rounded px-2.5">
                      Seçili ürünler için depolarda stok bulunamadı.
                    </div>
                  </div>
                )
              }

              return (
                <div className="mt-6 border border-slate-100 rounded-xl p-3 bg-white shadow-xs">
                  <div className="flex items-center gap-1.5 mb-3 border-b border-slate-100 pb-2">
                    <span className="text-xs">🏬</span>
                    <div className="text-[10px] font-bold text-slate-600 uppercase tracking-wider">Depo Stok Matrisi (Excel Görünümü)</div>
                  </div>
                  {balancesLoading ? (
                    <div className="text-[10px] text-slate-400 py-1 flex items-center gap-1.5">
                      <div className="w-3.5 h-3.5 border border-orange-500 border-t-transparent rounded-full animate-spin"></div>
                      Stoklar yükleniyor...
                    </div>
                  ) : (
                    <div className="overflow-x-auto max-h-60 overflow-y-auto pr-1">
                      <table className="w-full border-collapse border border-slate-200 text-[10px]">
                        <thead>
                          <tr className="sticky top-0 z-10">
                            <th className="border border-slate-200 p-1.5 text-left font-bold text-slate-600 bg-slate-50 min-w-[140px] sticky left-0 z-20 shadow-[1px_0_0_0_#e2e8f0]">
                              Ürün Adı
                            </th>
                            {activeWarehouses.map((w, wIndex) => {
                              const isColActive = activeCell?.wIndex === wIndex
                              return (
                                <th
                                  key={String(w.warehouseCode)}
                                  className={`border border-slate-200 p-1.5 text-center font-bold text-slate-600 truncate max-w-[85px] transition-colors ${
                                    isColActive ? 'bg-amber-100 text-amber-900 font-extrabold' : 'bg-slate-50'
                                  }`}
                                  title={w.name || undefined}
                                >
                                  {w.name?.replace('DEPO', '').trim() || `#${w.warehouseCode}`}
                                </th>
                              )
                            })}
                          </tr>
                        </thead>
                        <tbody>
                          {selectedProducts.map((p, pIndex) => {
                            const isRowActive = activeCell?.pIndex === pIndex

                            return (
                              <tr key={p.stockCode} className="hover:bg-slate-50/50">
                                {/* Product Info Column (Sticky Left) */}
                                <td
                                  className={`border border-slate-200 p-1.5 text-left transition-colors max-w-[180px] truncate sticky left-0 z-10 shadow-[1px_0_0_0_#e2e8f0] ${
                                    isRowActive ? 'bg-amber-100 text-slate-900 font-semibold' : 'bg-slate-50 text-slate-600'
                                  }`}
                                  title={p.name || p.stockCode}
                                >
                                  <div className="truncate font-semibold">{p.name || p.stockCode}</div>
                                  <div className="text-[8px] text-slate-400 font-mono mt-0.5">{p.stockCode}</div>
                                </td>

                                {/* Warehouse Stock Columns */}
                                {activeWarehouses.map((w, wIndex) => {
                                  const perStock = balanceByWarehouseAndStockCode.get(Number(w.warehouseCode))
                                  const qty = perStock?.get(p.stockCode.toLowerCase()) ?? 0
                                  const floorQty = Math.max(0, Math.floor(qty))

                                  const isCellClicked = activeCell?.pIndex === pIndex && activeCell?.wIndex === wIndex
                                  const isCellInHighlightedLine = activeCell && (activeCell.pIndex === pIndex || activeCell.wIndex === wIndex)

                                  const displayQty = canSatisFaturaDepoBakiyeGorsun
                                    ? `${floorQty}`
                                    : floorQty <= 12
                                      ? `${floorQty}`
                                      : `12+`

                                  return (
                                    <td
                                      key={String(w.warehouseCode)}
                                      onClick={() => setActiveCell({ pIndex, wIndex })}
                                      className={`border border-slate-200 p-1.5 text-center cursor-pointer transition-all select-none ${
                                        isCellClicked
                                          ? 'bg-amber-300 text-amber-950 font-bold scale-[1.01] shadow-xs'
                                          : isCellInHighlightedLine
                                            ? 'bg-amber-50/60 text-slate-900'
                                            : floorQty > 0
                                              ? 'bg-white text-emerald-600 font-bold hover:bg-slate-100'
                                              : 'bg-white text-slate-300 hover:bg-slate-100'
                                      }`}
                                    >
                                      {floorQty > 0 ? displayQty : '-'}
                                    </td>
                                  )
                                })}
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )
            })() : null}

          </div>

        </div>

      ) : (

        <div className="mt-4 text-sm text-gray-500">Cari seçiniz.</div>

      )}

      <Modal

        isOpen={msgOpen}

        onClose={() => setMsgOpen(false)}

        title={msgTitle || 'Bilgi'}

        footer={

          <button

            type="button"

            onClick={() => setMsgOpen(false)}

            className="px-3 py-2 text-xs font-semibold bg-gray-700 text-white rounded hover:bg-gray-800"

          >

            Tamam

          </button>

        }

      >
        <div className="text-xs text-gray-700 whitespace-pre-line">{msgText}</div>
      </Modal>

      {montajInitialValues && (
        <MontajFormModal
          isOpen={montajModalOpen}
          onClose={() => {
            setMontajModalOpen(false)
            setEditingMontajLineId(null)
            setMontajInitialValues(null)
          }}
          onSave={handleSaveMontaj}
          initialValues={montajInitialValues}
          customerCode={selectedCustomer || undefined}
          dealerName={montajInitialValues.bayiAdi || ''}
          productName={montajInitialValues.urunAdi || ''}
          quantity={montajInitialValues.miktar || 1}
          maxQuantity={(() => {
            if (!editingMontajLineId) return montajInitialValues.miktar || 1
            const line = linesState.find((l) => l.salesOrderLineId === editingMontajLineId)
            if (!line) return montajInitialValues.miktar || 1
            return Number(draftInvoiceQtyByLineId[line.salesOrderLineId] ?? line.remainingQuantity ?? line.orderQuantity ?? 1)
          })()}
        />
      )}

      {toastMessage && (
        <div className="fixed left-1/2 -translate-x-1/2 bottom-6 z-[60] w-[520px] max-w-[92vw]">
          <div className="bg-green-300/80 text-gray-900 text-sm font-semibold px-6 py-3 rounded shadow-lg border border-green-400">
            {toastMessage}
          </div>
        </div>
      )}
    </div>

  )

}



type Product = {

  id: string

  name: string

  code: string

  depot: string

  stock: number

  kdv: string

  price: string

}



type CartLine = {

  qty: number

  montaj: 'Montaj istemiyorum.' | 'Montaj istiyorum.'

}



type MontajForm = {

  bayiAdi: string

  urunAdi: string

  miktar: number

  isimSoyisim: string

  telefon: string

  adres: string

  bolge: string

  bayiAciklama: string

}



function parsePriceToNumber(price: string) {

  const cleaned = price

    .replace(/₺/g, '')

    .replace(/\./g, '')

    .replace(/\s/g, '')

    .replace(/,/g, '.')

  const n = Number(cleaned)

  return Number.isFinite(n) ? n : 0

}

function normalizeProductSearchText(val: string | null | undefined): string {
  if (!val) return ''
  return String(val)
    .toLowerCase()
    .replace(/i̇/g, 'i')
    .replace(/ı/g, 'i')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .replace(/[\s\-().,\/_]+/g, '')
}

function matchesProductSearch(p: any, query: string): boolean {
  const trimmed = query.trim()
  if (!trimmed) return true

  const qNorm = normalizeProductSearchText(trimmed)
  const qWords = trimmed.toLowerCase().split(/\s+/).filter(Boolean)

  const name = String(p?.name ?? '')
  const stockCode = String(p?.stockCode ?? '')
  const barcode = String(p?.barcode ?? '')
  const groupCode = String(p?.groupCode ?? '')
  const subGroupCode = String(p?.subGroupCode ?? '')
  const description = String(p?.description ?? '')

  const nameNorm = normalizeProductSearchText(name)
  const stockNorm = normalizeProductSearchText(stockCode)
  const barcodeNorm = normalizeProductSearchText(barcode)
  const groupNorm = normalizeProductSearchText(groupCode)
  const subGroupNorm = normalizeProductSearchText(subGroupCode)
  const descNorm = normalizeProductSearchText(description)

  if (
    nameNorm.includes(qNorm) ||
    stockNorm.includes(qNorm) ||
    barcodeNorm.includes(qNorm) ||
    groupNorm.includes(qNorm) ||
    subGroupNorm.includes(qNorm) ||
    descNorm.includes(qNorm)
  ) {
    return true
  }

  const fullText = `${name} ${stockCode} ${barcode} ${groupCode} ${subGroupCode} ${description}`
  const fullNorm = normalizeProductSearchText(fullText)

  return qWords.every((word) => {
    const wNorm = normalizeProductSearchText(word)
    return fullNorm.includes(wNorm)
  })
}

function SiparisView() {

  const layout = useOutletContext<LayoutContext>()

  const cart = useCart()

  const { dealer, setDealer } = useDealer()

  type CustomerOption = { value: string; label: string }

  const [bayiOptionsState, setBayiOptionsState] = useState<CustomerOption[]>([])
  const [customerPriceGroupIdByCode, setCustomerPriceGroupIdByCode] = useState<Record<string, string>>({})

  const canOnlySeePriceGroup4 = !layout?.isSuperSuperAdmin && !layout?.isSuperAdmin && Boolean(layout?.allowedKeys?.has('invoice/siparisSadeceFiyat4Gorsun'))

  const { data: categoriesState, loading: categoriesLoading } = useProductCategories({ includeDealer: true, dealerCode: dealer?.code })

  const selectedDealerCode = dealer?.code || ''

  /**
   * Ürün listesi İSTENDİĞİNDE çekilir.
   *
   * `useProducts`'ın `enabled` bayrağı hook KURULURKEN okunuyor, dolayısıyla hook'un kendi
   * seçim durumunu (main/sub) burada okuyamayız — bu yüzden ayrı ve daha erken bir bayrak.
   * Kullanıcı bir kategoriye bastığında ya da arama kutusuna yazdığında true olur.
   *
   * Sadece gizlemek yetmezdi: sayfa açılışında 500 ürünlük istek boşuna gidiyordu.
   */
  const [catalogRequested, setCatalogRequested] = useState(false)

  const productsQuery = useProducts({
    includeDealer: true,
    dealerCode: dealer?.code,
    priceCustomerCode: dealer?.code || undefined,
    defaultIncludeInactive: false,
    defaultPageSize: 500,
    displayPriceGroupCode: canOnlySeePriceGroup4 ? 4 : undefined,
    useUrlParams: false,
    // Kategori seçilmeden ürün ÇEKİLMEZ; yalnızca gizlemek yetmezdi, istek yine giderdi.
    enabled: !categoriesLoading && Boolean(dealer?.code) && catalogRequested
  })

  const visibleProductPrice = (product: any) => canOnlySeePriceGroup4 && product?.displayUnitPrice ? product.displayUnitPrice : product?.unitPrice
  const visibleProductCurrency = (product: any) => canOnlySeePriceGroup4 && product?.displayCurrency ? product.displayCurrency : product?.currency
  // SATIŞ dövizi. Burada `currencyCode` (ALIŞ dövizi) okunuyordu: "dolarla al, TL sat" olan
  // 211 ürün bu yüzden USD listeleniyordu. Bkz. utils/productCurrency.ts
  const visibleProductCurrencyCode = (product: any) => canOnlySeePriceGroup4 && product?.displayCurrencyCode ? product.displayCurrencyCode : product?.salesCurrencyCode

  const isAvailableForOrdering = useCallback((p: any): boolean => {
    if (!p) return false
    if (p.isActive === false) return false
    if (isClosedToSaleRule(p)) return false
    return true
  }, [])

  const searchFilteredItems = useMemo(() => {
    return (productsQuery.items ?? []).filter(isAvailableForOrdering)
  }, [productsQuery.items, isAvailableForOrdering])

  useEffect(() => {
    // Reset auto-persisted dealer selection when Siparis page mounts freshly
    setDealer(null)
  }, [])

  const canBsyHHide = Boolean(layout?.allowedKeys?.has('invoice/bsyHHide'))
  const canBsyHComingSoon = Boolean(layout?.allowedKeys?.has('invoice/bsyHComingSoon'))

  // STOKTA OLMAYANI SİPARİŞ EDEBİLME (invoice/stokYokSiparis).
  // Yetki bir KISITLAMAYI KALDIRIR: verilmediğinde bugünkü davranış aynen sürer (stok 0 ise
  // sepete eklenemez). Rozet ve gri görünüm KORUNUR — kullanıcı stokta olmadığını görmeli,
  // yalnızca düğmeler açılır. Sipariş oluşturma ucunda zaten stok kontrolü yok.
  //
  // SSA AYRICA KONTROL EDİLİYOR: SSA'da `allowedKeys` BOŞ küme olarak geliyor (menü ayrı
  // yoldan açılıyor, bkz. AppLayout). Kısıtlama EKLEYEN yetkilerde boş küme doğru sonucu
  // veriyor, ama bu yetki kısıtlama KALDIRDIĞI için boş küme SSA'yı tam ters yönde
  // engelliyordu — sistemdeki en yetkili kullanıcı stokta olmayanı sipariş edemiyordu.
  const canOrderOutOfStock =
    Boolean(layout?.isSuperSuperAdmin) || Boolean(layout?.allowedKeys?.has('invoice/stokYokSiparis'))

  const productSearchRef = useRef<HTMLInputElement | null>(null)

  const toAbsoluteMediaUrl = (url: string | null | undefined) => {
    const s = String(url ?? '').trim()
    if (!s) return ''
    if (s.startsWith('http://') || s.startsWith('https://')) return s
    return apiUrl(s)
  }

  useEffect(() => {
    if ((productsQuery as any).pageSize && (productsQuery as any).pageSize < 200) {
      ; (productsQuery as any).setPageSize?.(500)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const [priceGroups, setPriceGroups] = useState<PriceGroupDto[]>([])
  const [productTaxByProductId, setProductTaxByProductId] = useState<Record<string, { taxRate: number }>>({})

  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [sortMode, setSortMode] = useState<'default' | 'priceAsc' | 'priceDesc' | 'stockDesc'>('default')
  const [onlyInStock, setOnlyInStock] = useState(false)
  const [showOutOfStock, setShowOutOfStock] = useState(false)

  // KUR SÜZGECİ — ürünün SATIŞ dövizi. Alış dövizine ASLA düşülmez (utils/productCurrency.ts):
  // 211 ürün "dolarla al, TL sat" olduğu için alış dövizine düşüldüğünde TL satılan ürün
  // listede USD görünüyordu.
  // ÇOKLU SEÇİM (2026-08-19 kullanıcı kararı): tek seçimli düğme yerine kutucuk. Birden çok
  // para birimi işaretlenebilir; hiçbiri işaretli değilse süzgeç kapalıdır (tümü listelenir).
  const [productCurrencyFilters, setProductCurrencyFilters] = useState<Array<'TRY' | 'EUR' | 'USD' | 'GBP'>>([])

  const isCurrencyFilterChecked = (value: 'ALL' | 'TRY' | 'EUR' | 'USD' | 'GBP') =>
    value === 'ALL' ? productCurrencyFilters.length === 0 : productCurrencyFilters.includes(value)

  const toggleCurrencyFilter = (value: 'ALL' | 'TRY' | 'EUR' | 'USD' | 'GBP') => {
    if (value === 'ALL') {
      setProductCurrencyFilters([])
      return
    }
    setProductCurrencyFilters((prev) =>
      prev.includes(value) ? prev.filter((x) => x !== value) : [...prev, value]
    )
  }

  const productCurrencyOf = (product: any): 'TRY' | 'EUR' | 'USD' | 'GBP' => {
    const code = resolveProductSalesCurrency({
      currency: visibleProductCurrency(product),
      salesCurrencyCode: visibleProductCurrencyCode(product)
    })
    if (isTryCurrency(code)) return 'TRY'
    const upper = String(code ?? '').trim().toUpperCase()
    return upper === 'EUR' || upper === 'USD' || upper === 'GBP' ? (upper as 'EUR' | 'USD' | 'GBP') : 'TRY'
  }

  const currencyFilterOptions: Array<{ value: 'ALL' | 'TRY' | 'EUR' | 'USD' | 'GBP'; label: string }> = [
    { value: 'ALL', label: 'Tümü' },
    { value: 'TRY', label: '₺ TL' },
    { value: 'EUR', label: '€ EUR' },
    { value: 'USD', label: '$ USD' },
    { value: 'GBP', label: '£ GBP' }
  ]
  const [onlyPriced, setOnlyPriced] = useState(false)
  const [onlyCampaignProducts, setOnlyCampaignProducts] = useState(false)
  const [mobileFilterOpen, setMobileFilterOpen] = useState(false)
  const [highlightedProductId, setHighlightedProductId] = useState<number | string | null>(null)

  const categoryMeta = categoriesState.meta ?? {}



  const metaToKey = (s: string) =>

    String(s ?? '')

      .trim()

      .toUpperCase()

      .replace(/İ/g, 'I')

      .replace(/ı/g, 'I')

      .replace(/Ğ/g, 'G')

      .replace(/ğ/g, 'G')

      .replace(/Ü/g, 'U')

      .replace(/ü/g, 'U')

      .replace(/Ş/g, 'S')

      .replace(/ş/g, 'S')

      .replace(/Ö/g, 'O')

      .replace(/ö/g, 'O')

      .replace(/Ç/g, 'C')

      .replace(/ç/g, 'C')

      .replace(/\s+/g, ' ')



  const categoryToKey = (s: string) =>

    String(s ?? '')

      .trim()

      .toUpperCase()

      .replace(/İ/g, 'I')

      .replace(/ı/g, 'I')

      .replace(/Ğ/g, 'G')

      .replace(/ğ/g, 'G')

      .replace(/Ü/g, 'U')

      .replace(/ü/g, 'U')

      .replace(/Ş/g, 'S')

      .replace(/ş/g, 'S')

      .replace(/Ö/g, 'O')

      .replace(/ö/g, 'O')

      .replace(/Ç/g, 'C')

      .replace(/ç/g, 'C')

      .replace(/\s+/g, ' ')



  const metaMainId = (label: string) => `m:${metaToKey(label)}`

  const metaSubId = (mainLabel: string, subLabel: string) => `s:${metaToKey(mainLabel)}:${metaToKey(subLabel)}`

  const isActiveMain = (label: string) => (categoryMeta[metaMainId(label)]?.status ?? 'active') !== 'passive'

  const isActiveSub = (mainLabel: string, subLabel: string) => (categoryMeta[metaSubId(mainLabel, subLabel)]?.status ?? 'active') !== 'passive'

  const categoryKeyVariants = (label: string) => {
    const raw = String(label ?? '').trim()
    if (!raw) return [] as string[]

    const normSpace = metaToKey(raw)
    const normUnderscore = categoryToKey(raw)
    const rawUpper = raw.toUpperCase()
    const rawUnderscore = raw.replace(/\s+/g, '_')
    const rawUnderscoreUpper = rawUnderscore.toUpperCase()

    return Array.from(new Set([raw, rawUpper, normSpace, normUnderscore, rawUnderscore, rawUnderscoreUpper]))
  }



  const getSubsForMain = (mainLabel: string) => {
    const map = categoriesState.subsByMain as Record<string, string[]>
    const keys = categoryKeyVariants(mainLabel)
    for (const k of keys) {
      const v = map[k]
      if (Array.isArray(v) && v.length) return v
    }
    return []

  }



  const mainTabs = useMemo(() => {
    const activeMains = (categoriesState.mains ?? []).filter((m) => {
      if (!isActiveMain(m)) return false
      const subs = getSubsForMain(m)
      const activeSubs = subs.filter((s) => isActiveSub(m, s))
      return activeSubs.length > 0
    })
    return activeMains.filter((m) => m !== 'Tüm Ürünler')
  }, [categoriesState.mains, categoriesState.subsByMain, categoryMeta])

  const subTabsByMain = useMemo(() => {
    const out: Record<string, string[]> = {}

    mainTabs.forEach((m) => {
      if (m === 'Tüm Ürünler') return
      const subs = getSubsForMain(m)
      out[m] = subs.filter((s) => isActiveSub(m, s))
    })

    return out
  }, [categoriesState.subsByMain, categoryMeta, mainTabs])




  const fetchSiparisCariList = useCallback(async (opts?: { q?: string; includeInactive?: boolean; limit?: number; signal?: AbortSignal }) => {
    // `limit` GECIRILMEK ZORUNDA — bkz. CustomersController.GetDropdown. Dusurulurse istek
    // yine butun cari listesini indirir ve donma geri gelir.
    const list = await fetchCustomersDropdown({ q: opts?.q, includeInactive: false, includeMuhtelif: false, forOrder: true, limit: opts?.limit, signal: opts?.signal })
    return (list ?? []).filter((c) => {
      const code = String(c.customerCode ?? '').trim()
      if (!code) return false
      if (code.startsWith('120-04-') || code.startsWith('770-01-') || code.startsWith('120-10-')) return false
      return true
    })
  }, [])

  useEffect(() => {
    void (async () => {
      try {
        const pg = await fetchPriceGroups({ includeInactive: false })
        setPriceGroups(pg)
      } catch {
        setPriceGroups([])
      }
    })()
  }, [])



  const bayiOptions = useMemo(() => bayiOptionsState, [bayiOptionsState])



  const bayiSelectOptions = useMemo(() => {

    return [{ value: '', label: 'Seçiniz...' }]

  }, [])



  const bayiSelectOptionsWithPlaceholder = useMemo(() => {

    if (bayiOptions.length === 0) return bayiSelectOptions

    if (layout?.isSuperAdmin) return [{ value: '', label: 'Seçiniz...' }, ...bayiOptions]

    return bayiOptions

  }, [bayiOptions, bayiSelectOptions, layout?.isSuperAdmin])



  const selectedBayi = useMemo(() => {
    if (!dealer?.code) return ''
    return dealer.code
  }, [dealer?.code])

  const selectedBayiLabel = useMemo(
    () => (selectedBayi ? (bayiOptions.find((x) => x.value === selectedBayi)?.label ?? dealer?.label ?? '') : ''),
    [bayiOptions, dealer?.label, selectedBayi]
  )

  /**
   * FİYAT GRUBU ARTIK TEK CARİ İÇİN OKUNUR (2026-08-22).
   *
   * Burada elle yazılmış, `limit` İÇERMEYEN bir istek vardı:
   *   /api/customers/dropdown?includeInactive=false&includeMuhtelif=false&forOrder=true
   * Sipariş sayfası her açılışta BÜTÜN cari listesini indiriyordu — canlıda ölçüldü:
   * **4,2 MB ve 24,6 saniye**. Sayfanın yavaşlığının sebebi buydu; arkasındaki
   * `PriceGroups` isteği de 18 saniye kuyrukta bekliyordu.
   *
   * Oysa bu devasa haritanın (`customerPriceGroupIdByCode`) HER kullanımı tek bir koda
   * ait: seçili cari (`selectedBayi`). Yani 5855 carinin tamamı, bir carinin fiyat
   * grubunu öğrenmek için indiriliyordu. Artık seçim yapıldığında o carinin TEK satırı
   * çekiliyor ve haritaya ekleniyor; harita önbellek gibi davrandığı için aynı cariye
   * dönüldüğünde ikinci istek atılmıyor.
   *
   * `bayiOptionsState` de bu istekten doluyordu ve hiçbir yerde kullanılmıyor:
   * `bayiSelectOptionsWithPlaceholder` ölü kod, `selectedBayiLabel` ise zaten
   * `dealer.label` yedeğine düşüyor (cari seçicisi onu her seçimde yazıyor).
   */
  /**
   * Cari fiyat grubu bilinmiyor mu — "grubu YOK" ile karıştırılmamalı.
   *
   * Bu ikisi eskiden aynı değerle (boş string) temsil ediliyordu ve sepet, öğrenemediği
   * durumu "grubu yok" sanıp fatura tipini FATURA varsayarak KDV EKLİYORDU. SERVİS HİZMET
   * carisi (grup 4, AÇIK) bir kullanıcıda "700 + KDV", diğerinde "700" görünmesinin sebebi
   * buydu.
   */
  const [priceGroupUnknownCodes, setPriceGroupUnknownCodes] = useState<Set<string>>(new Set())

  // "Bu kod için istek atıldı mı" işareti REF'te tutuluyor, state'te değil — aşağıdaki
  // etkinin bağımlılığı olmaması için (gerekçe etkinin içinde).
  const priceGroupFetchedRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    const code = String(selectedBayi || '').trim()
    if (!code) return
    if (priceGroupFetchedRef.current.has(code)) return
    priceGroupFetchedRef.current.add(code)

    /*
      ETKİ ARTIK KENDİ KENDİNİ İPTAL ETMİYOR (2026-08-24, kullanıcı bildirimi:
      "bende düşmüyor başkasında düşüyor").

      Bağımlılık dizisinde `customerPriceGroupIdByCode` vardı — yani etkinin KENDİ yazdığı
      state. O state her değiştiğinde etki yeniden kuruluyor, temizleme fonksiyonu uçuştaki
      isteği `ac.abort()` ile iptal ediyor, iptal `catch`e düşüyor ve `catch` bunu
      "cevap alamadım" değil "bu carinin fiyat grubu YOK" diye kaydediyordu. Üstüne
      "zaten çekildi" kontrolü de aynı state'e baktığı için bir daha HİÇ denenmiyordu.

      Cevap hızlı gelirse yarışı kazanıyor, ağ yavaşsa ya da o sırada başka bir render
      tetiklenirse kaybediyor — bu yüzden makineden makineye değişiyordu.

      Şimdi: işaret ref'te (etkiyi tetiklemez), iptal cevap sayılmaz, gerçek hata
      "bilinmiyor" olarak işaretlenir ve bir kez daha denenir.
    */
    const ac = new AbortController()

    void (async () => {
      for (let deneme = 0; deneme < 2; deneme++) {
        try {
          const rec = await fetchCustomerByCode(code, { signal: ac.signal })
          const pgId = String((rec as any)?.priceGroupId ?? '').trim()
          setCustomerPriceGroupIdByCode((prev) => ({ ...prev, [code]: pgId }))
          setPriceGroupUnknownCodes((prev) => {
            if (!prev.has(code)) return prev
            const next = new Set(prev)
            next.delete(code)
            return next
          })
          return
        } catch (err: any) {
          /*
            İPTAL CEVAP DEĞİLDİR: kullanıcı cariyi değiştirdiği için iptal edilmiş olabilir.
            Hiçbir şey YAZILMAZ — ama "bu kod soruldu" işareti de KALDIRILMALI.

            (2026-08-24, kullanıcı bildirimi: "sayfayı yeniledim, tekrar o cariyi seçtim,
            KDV'ler gitti.") İşaret bir REF'te duruyor ve bileşen yaşadığı sürece siliniyor.
            Cari A → B → A yapıldığında A'nın isteği temizlemede iptal ediliyor, buradan
            işaret kaldırılmadan çıkılıyordu; A'ya dönüldüğünde "zaten soruldu" denip istek
            BİR DAHA HİÇ atılmıyor ve o carinin fiyat grubu kalıcı olarak boş kalıyordu.
            Boş grup ise sepette KDV'nin sessizce düşmesine yol açıyordu.
          */
          if (ac.signal.aborted || err?.name === 'AbortError') {
            priceGroupFetchedRef.current.delete(code)
            return
          }
          if (deneme === 0) {
            await new Promise((r) => setTimeout(r, 800))
            continue
          }
          // İki deneme de başarısız: BİLİNMİYOR olarak işaretlenir. Sepet bu durumda
          // tahmin yürütmez, uyarı gösterir ve sipariş oluşturmayı kapatır.
          priceGroupFetchedRef.current.delete(code)
          setPriceGroupUnknownCodes((prev) => new Set(prev).add(code))
        }
      }
    })()

    return () => ac.abort()
  }, [selectedBayi])

  /**
   * Fatura tipi — SEPETLE AYNI KAYNAKTAN (`kdvKarari.ts`).
   *
   * Buradaki kopya, grup çözülemediğinde `null` döndürüyordu; aşağıdaki hesap ise
   * `invoiceType === 'FATURA'` diye sorduğu için null sessizce "KDV yok" anlamına
   * geliyordu. Grubu atanmamış bir cari, hiçbir uyarı vermeden KDV'siz toplam üretiyordu.
   *
   * Artık üç hâl ayrı: grup atanmamışsa FATURA (karar verilebilir), grup atanmış ama
   * çözülememişse BİLİNMİYOR (KDV eklenmez, ama bu bilinçli bir bekleme hâli).
   */
  const selectedBayiPriceGroupInvoiceType = useMemo(() => {
    const pgId = customerPriceGroupIdByCode[String(selectedBayi || '')]
    const pg = pgId ? priceGroups.find((x) => x.id === pgId) : null
    const cozuldu = !pgId || Boolean(pg)
    const tip = faturaTipiBelirle({
      cozuldu,
      kod: pg ? Number((pg as any)?.code ?? 0) : null,
      formul: (pg as any)?.formula ?? null,
      faturaTipi: (pg as any)?.invoiceType ?? null,
    })
    return tip === 'BILINMIYOR' ? null : tip
  }, [customerPriceGroupIdByCode, priceGroups, selectedBayi])

  const getEffectiveTaxRate = (p: any) => {
    const inlineTax = Number(p?.taxRate ?? p?.kdvRate ?? 0)
    const metaTax = Number(productTaxByProductId[String(p?.id ?? '')]?.taxRate)
    const effectiveTax = Number.isFinite(metaTax) && metaTax > 0 ? metaTax : inlineTax
    return Number.isFinite(effectiveTax) ? effectiveTax : 0
  }

  useEffect(() => {
    if (bayiOptions.length === 1) {
      const single = bayiOptions[0]
      if (!dealer) {
        setDealer({ code: single.value, label: single.label })
      }
    }
  }, [bayiOptions, dealer, setDealer])



  const toKey = (s: string) =>

    s

      .trim()

      .toUpperCase()

      .replace(/İ/g, 'I')

      .replace(/ı/g, 'I')

      .replace(/Ğ/g, 'G')

      .replace(/ğ/g, 'G')

      .replace(/Ü/g, 'U')

      .replace(/ü/g, 'U')

      .replace(/Ş/g, 'S')

      .replace(/ş/g, 'S')

      .replace(/Ö/g, 'O')

      .replace(/ö/g, 'O')

      .replace(/Ç/g, 'C')

      .replace(/ç/g, 'C')

      .replace(/\s+/g, '_')



  const setCategory = (mainLabel: string, subLabel: string) => {
    setCatalogRequested(true)
    if (mainLabel === 'Tüm Ürünler') {
      productsQuery.setMainSub('', '', true)
    } else {
      productsQuery.setMainSub(String(mainLabel ?? '').trim(), String(subLabel ?? '').trim(), true)
    }
  }

  const handleSelectSearchedProduct = (p: any) => {
    // 1. Blur focus to close mobile keyboard immediately
    if (typeof document !== 'undefined' && document.activeElement) {
      (document.activeElement as HTMLElement).blur()
    }

    // 2. Resolve matching category and subcategory
    const pGroup = String(p.groupCode ?? p.mainCategory ?? '').trim()
    const pSubGroup = String(p.subGroupCode ?? p.subCategory ?? '').trim()

    let targetMain = mainTabs.find((m) => toKey(m) === toKey(pGroup)) || mainTabs[0] || ''
    let targetSubs = subTabsByMain[targetMain] ?? []
    let targetSub = targetSubs.find((s) => toKey(s) === toKey(pSubGroup)) || targetSubs[0] || ''

    if (targetMain && targetSub) {
      setCategory(targetMain, targetSub)
    }

    // 3. Clear search query so normal category view displays cleanly
    productsQuery.setQ('')

    // 4. Highlight & Scroll to product card
    setHighlightedProductId(p.id)

    setTimeout(() => {
      const el = document.getElementById(`product-card-${p.id}`)
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
    }, 300)

    setTimeout(() => {
      setHighlightedProductId(null)
    }, 3500)
  }



  const fromKey = (key: string) => {

    const k = String(key ?? '').trim().toUpperCase()

    const exact = mainTabs.find((t) => toKey(t) === k)

    return exact ?? ''

  }



  const defaultMain = mainTabs[0] ?? ''

  /**
   * KATEGORİ SEÇİMİ.
   *
   * 2026-08-13'te "açılışta hiçbir kategori seçili olmasın" denmişti; 2026-08-19'da kullanıcı
   * bunu değiştirdi: cari seçildikten sonra ayrı bir "kategori seçin" adımı istemiyor, cariye
   * açık olan ilk kategori kendiliğinden listelensin diyor. Otomatik seçimi aşağıdaki
   * `autoCategoryDealerRef` efekti yapıyor; buradaki türetmeler (seçim var mı, hangi sekme
   * etkin) aynen duruyor. Cari yokken hâlâ hiçbir ürün çekilmez.
   */
  const hasCategorySelection = Boolean(String(productsQuery.main ?? '').trim() && String(productsQuery.sub ?? '').trim())

  const activeMainKey = productsQuery.main ? productsQuery.main.trim().toUpperCase() : ''

  const activeMainTab = fromKey(activeMainKey)





  // Üst sekme seçilmeden alt sekme listelenmez. Eskiden `defaultMain`e düşüyordu ve seçili
  // olmayan bir üst sekmenin alt kategorileri ekranda duruyordu.
  const categories = useMemo(

    () => (activeMainTab ? subTabsByMain[activeMainTab] ?? [] : []),

    [activeMainTab, subTabsByMain]

  )

  const defaultSub = categories[0] ?? ''

  const activeSubKey = productsQuery.sub ? productsQuery.sub.trim().toUpperCase() : ''

  const activeCategory = useMemo(
    () => (activeSubKey ? categories.find((c) => toKey(c) === activeSubKey) ?? '' : ''),
    [activeSubKey, categories]
  )





  /**
   * BU EFEKT ARTIK SEÇİM ÜRETMİYOR, YALNIZCA GEÇERSİZ SEÇİMİ TEMİZLİYOR.
   *
   * Eskiden seçim yokken ilk üst/alt kategoriyi kendiliğinden yazıyordu — bayi giriş yapar
   * yapmaz bütün ürünlerin listelenmesinin sebebi buydu. Kaldırıldı.
   *
   * Kalan iş: kullanıcının seçtiği kategori sonradan PASİFE çekilmişse (kategori yönetiminden)
   * ekranda "yok olan kategori seçili" durumunda kalmamak. O durumda seçim boşaltılır ve
   * kullanıcı yeniden seçer; yerine başka bir kategori ATANMAZ, çünkü hangisini istediğini
   * bilmiyoruz.
   */
  useEffect(() => {
    if (!hasCategorySelection) return
    if (!activeMainTab || !activeCategory) {
      productsQuery.setMainSub('', '')
      return
    }
    if (!isActiveMain(activeMainTab) || !isActiveSub(activeMainTab, activeCategory)) {
      productsQuery.setMainSub('', '')
    }
  }, [activeCategory, activeMainTab, hasCategorySelection, isActiveMain, isActiveSub, productsQuery])



  /**
   * CARİ SEÇİLİNCE İLK KATEGORİ KENDİLİĞİNDEN AÇILIR (2026-08-19 kullanıcı kararı).
   *
   * Önceki kural "açılışta hiçbir kategori seçili değil" idi; kullanıcı bunu değiştirdi:
   * cariyi seçtikten sonra ayrıca "kategori seçin" adımı istemiyor, cariye AÇIK olan
   * kategori/fiyat gruplarından ilk sıradaki doğrudan listelensin diyor.
   *
   * `mainTabs`/`subTabsByMain` zaten pasif kategorileri eliyor, dolayısıyla "ilk sıradaki"
   * her zaman o cariye açık olan bir kategori olur. Seçim cari başına BİR KEZ yapılır
   * (ref ile), yoksa kullanıcının sonradan yaptığı seçimin üstüne yazardı.
   */
  const autoCategoryDealerRef = useRef<string | null>(null)
  useEffect(() => {
    const code = String(dealer?.code ?? '').trim()
    if (!code) {
      autoCategoryDealerRef.current = null
      return
    }
    if (categoriesLoading) return
    if (autoCategoryDealerRef.current === code) return
    if (hasCategorySelection) {
      autoCategoryDealerRef.current = code
      return
    }

    const firstMain = mainTabs[0] ?? ''
    const firstSub = (subTabsByMain[firstMain] ?? [])[0] ?? ''
    if (!firstMain || !firstSub) return

    autoCategoryDealerRef.current = code
    setCatalogRequested(true)
    productsQuery.setMainSub(firstMain, firstSub, true)
  }, [categoriesLoading, dealer?.code, hasCategorySelection, mainTabs, subTabsByMain, productsQuery])

  const loadedInvoiceDealerRef = useRef<string | null>(null)
  useEffect(() => {
    const code = selectedBayi ? String(selectedBayi).trim() : ''
    if (code && loadedInvoiceDealerRef.current !== code) {
      loadedInvoiceDealerRef.current = code
      void cart.loadCustomerBasket(code)
    }
  }, [selectedBayi, cart])

  useEffect(() => {
    if (selectedBayi && productsQuery.items && productsQuery.items.length > 0) {
      cart.syncProductPrices(productsQuery.items, selectedBayi)
    }
  }, [selectedBayi, productsQuery.items])

  const productMap = useMemo(() => {

    const m = new Map<string, ApiProduct>()

    productsQuery.items.forEach((p) => m.set(p.id, p))

    return m

  }, [productsQuery.items])

  const [draftQty, setDraftQty] = useState<Record<string, number>>({})

  const [draftMontaj, setDraftMontaj] = useState<Record<string, CartLine['montaj']>>({})

  const [montajOpen, setMontajOpen] = useState(false)

  const [montajProductId, setMontajProductId] = useState<string | null>(null)

  const [toastMessage, setToastMessage] = useState<string | null>(null)

  const [msgOpen, setMsgOpen] = useState(false)

  const [msgTitle, setMsgTitle] = useState('')

  const [msgText, setMsgText] = useState('')

  const showMessage = (title: string, text: string) => {

    setMsgTitle(String(title ?? ''))

    setMsgText(String(text ?? ''))

    setMsgOpen(true)

  }

  const [inspectOpen, setInspectOpen] = useState(false)
  const [inspectProductId, setInspectProductId] = useState<string | null>(null)
  const [inspectDetail, setInspectDetail] = useState<{ description?: string | null; features?: string | null } | null>(null)
  const [inspectMediaIndex, setInspectMediaIndex] = useState(0)
  const [fullImagePreviewUrl, setFullImagePreviewUrl] = useState<string | null>(null)

  const [montajForm, setMontajForm] = useState<MontajForm>({

    bayiAdi: '[120-01-000000] TEST CARİSİ 123456',

    urunAdi: '',

    miktar: 1,

    isimSoyisim: '',

    telefon: '',

    adres: '',

    bolge: '',

    bayiAciklama: ''

  })

  const [montajDetails, setMontajDetails] = useState<Record<string, MontajForm>>({})

  const [montajError, setMontajError] = useState<string | null>(null)

  const montajDetailsByProductId = useMemo(() => {
    const out: Record<string, any> = {}
    for (const [productId, d] of Object.entries(montajDetails ?? {})) {
      out[String(productId)] = {
        bayiAdi: (d as any)?.bayiAdi,
        urunAdi: (d as any)?.urunAdi,
        miktar: (d as any)?.miktar,
        isimSoyisim: (d as any)?.isimSoyisim,
        telefon: (d as any)?.telefon,
        adres: (d as any)?.adres,
        bolge: (d as any)?.bolge,
        bayiAciklama: (d as any)?.bayiAciklama
      }
    }
    return out
  }, [montajDetails])



  // Campaign states

  const [campaigns, setCampaigns] = useState<ActiveCampaignDto[]>([])

  /**
   * Seçili bayinin FİYAT GRUBU KODU. Hem sepet indirimi hem ürün kartındaki kampanyalı fiyat
   * bunu kullanır; iki yer ayrı hesaplasaydı kartta gösterilen fiyat sepettekinden farklı
   * çıkabilirdi.
   */
  const siparisPriceGroupCode = useMemo(() => {
    const pgId = customerPriceGroupIdByCode[String(selectedBayi || '')]
    const pg = pgId ? priceGroups.find((x) => x.id === pgId) : null
    const code = pg ? Number((pg as any).code ?? 0) : 0
    return code > 0 ? code : undefined
  }, [customerPriceGroupIdByCode, priceGroups, selectedBayi])

  /**
   * Bayinin fiyat grubu FORMÜLÜ — kampanyalı fiyat F4'ten bu formülle türer
   * (`campaignPriceForProduct` + `kampanyaKatalogIndirimi`). Yalnız Fiyat 4 gören kullanıcıda
   * kartta zaten F4 duruyor; formül taban grup (F4) sayılır ki indirim olduğu gibi düşsün.
   */
  const siparisPriceGroupFormula = useMemo(() => {
    if (canOnlySeePriceGroup4) return 'F4'
    const pgId = customerPriceGroupIdByCode[String(selectedBayi || '')]
    const pg = pgId ? priceGroups.find((x) => x.id === pgId) : null
    return pg ? String((pg as any).formula ?? '') : ''
  }, [canOnlySeePriceGroup4, customerPriceGroupIdByCode, priceGroups, selectedBayi])

  const [campaignsLoading, setCampaignsLoading] = useState(false)

  const [campaignsModalOpen, setCampaignsModalOpen] = useState(false)

  const [campaignDetailOpen, setCampaignDetailOpen] = useState(false)

  const [selectedCampaign, setSelectedCampaign] = useState<ActiveCampaignDto | null>(null)

  const normalizeForCampaignMatch = (s: string) =>
    String(s ?? '')
      .trim()
      .toUpperCase()
      .replace(/İ/g, 'I')
      .replace(/ı/g, 'I')
      .replace(/Ğ/g, 'G')
      .replace(/ğ/g, 'G')
      .replace(/Ü/g, 'U')
      .replace(/ü/g, 'U')
      .replace(/Ş/g, 'S')
      .replace(/ş/g, 'S')
      .replace(/Ö/g, 'O')
      .replace(/ö/g, 'O')
      .replace(/Ç/g, 'C')
      .replace(/ç/g, 'C')
      .replace(/_/g, '')
      .replace(/\s+/g, '')

  const hasCampaignForMainTab = (mainLabel: string) => {
    const key = normalizeForCampaignMatch(mainLabel)
    if (!key) return false
    return campaigns.some((campaign) =>
      campaign.kampanyaTipi === 5 &&
      campaign.conditions.some((cond) =>
        cond.categoryCode && normalizeForCampaignMatch(cond.categoryCode) === key
      )
    )
  }

  const hasCampaignForSubTab = (mainLabel: string, subLabel: string) => {
    const mainKey = normalizeForCampaignMatch(mainLabel)
    const subKey = normalizeForCampaignMatch(subLabel)
    if (!subKey) return false
    return campaigns.some((campaign) =>
      campaign.kampanyaTipi === 5 &&
      campaign.conditions.some((cond) => {
        if (!cond.categoryCode) return false
        const condKey = normalizeForCampaignMatch(cond.categoryCode)
        return condKey === subKey || condKey === mainKey
      })
    )
  }

  const [selectedProductForCampaign, setSelectedProductForCampaign] = useState<{ stockCode: string; name: string } | null>(null)

  const hasAnyCampaignForStockCode = (stockCodeRaw: string) => {
    const sc = String(stockCodeRaw ?? '').trim()
    if (!sc) return false
    return campaigns.some((campaign) => {
      // "Kampanyalı" süzgeci de bayinin fiyat grubuna UYGULANAN kampanyalara bakar (rozetle aynı).
      if (!campaignAppliesToPriceGroup(campaign, siparisPriceGroupCode)) return false
      if (campaign.discounts.some((d) => String(d?.stokKodu ?? '').trim() === sc)) return true
      return campaign.conditions.some((cond) => {
        const json = String((cond as any)?.productStockCodesJson ?? '').trim()
        if (!json) return false
        try {
          const list = JSON.parse(json) as string[]
          return Array.isArray(list) && list.includes(sc)
        } catch {
          return false
        }
      })
    })
  }

  const [allProductsForCampaigns, setAllProductsForCampaigns] = useState<any[]>([])
  const [allProductsForCampaignsLoading, setAllProductsForCampaignsLoading] = useState(false)

  useEffect(() => {
    if (!dealer?.code) {
      setAllProductsForCampaigns([])
      return
    }
    void (async () => {
      try {
        setAllProductsForCampaignsLoading(true)
        const res = await fetchProducts({
          page: 1,
          pageSize: 2000,
          includeDealer: true,
          dealerCode: dealer.code,
          includeInactive: true
        })
        setAllProductsForCampaigns(res.items ?? [])
      } catch (err) {
        console.error('Failed to fetch all products for campaigns', err)
      } finally {
        setAllProductsForCampaignsLoading(false)
      }
    })()
  }, [dealer?.code])

  const campaignCountsByCategory = useMemo(() => {
    const mainCounts: Record<string, number> = {}
    const subCounts: Record<string, number> = {}

    mainTabs.forEach((m) => {
      mainCounts[toKey(m)] = 0
      const subs = subTabsByMain[m] ?? []
      subs.forEach((s) => {
        subCounts[`${toKey(m)}_${toKey(s)}`] = 0
      })
    })

    ;(allProductsForCampaigns ?? []).forEach((p: any) => {
      const stockCode = String(p?.stockCode ?? '').trim()
      if (!stockCode) return
      
      if (hasAnyCampaignForStockCode(stockCode)) {
        const pGroup = String(p.groupCode ?? p.mainCategory ?? '').trim()
        const pSubGroup = String(p.subGroupCode ?? p.subCategory ?? '').trim()

        const groupKey = toKey(pGroup)
        const subKey = `${toKey(pGroup)}_${toKey(pSubGroup)}`

        if (mainCounts[groupKey] !== undefined) {
          mainCounts[groupKey]++
        }
        if (subCounts[subKey] !== undefined) {
          subCounts[subKey]++
        }
      }
    })

    return { mainCounts, subCounts }
  }, [mainTabs, subTabsByMain, allProductsForCampaigns, campaigns])



  const showToast = (message: string) => {

    setToastMessage(message)

    window.setTimeout(() => setToastMessage(null), 1800)

  }



  // Fetch active campaigns

  useEffect(() => {

    void (async () => {

      try {

        setCampaignsLoading(true)

        const data = await fetchActiveCampaigns({

          customerCode: selectedBayi || undefined,

          includeExpired: false

        })

        console.log('✅ Campaigns loaded:', data.length, data)

        setCampaigns(data)

      } catch (error) {

        console.error('❌ Failed to fetch campaigns:', error)

        setCampaigns([])

      } finally {

        setCampaignsLoading(false)

      }

    })()

  }, [selectedBayi])



  useEffect(() => {
    const code = String(inspectProduct?.stockCode ?? '').trim()
    if (!code) {
      setInspectDetail(null)
      return
    }

    const ac = new AbortController()
    void (async () => {
      try {
        const token = localStorage.getItem('accessToken')
        const res = await fetch(`${API_BASE_URL}/api/products/${encodeURIComponent(code)}/detail`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          signal: ac.signal
        })
        if (!res.ok) return
        const json = await res.json()
        setInspectDetail(json?.data ?? null)
      } catch {
        // Copy is optional; the panel still works without it.
      }
    })()
    return () => ac.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inspectProductId])

  const inspectProduct = useMemo(() => {

    if (!inspectProductId) return null

    return productsQuery.items.find((x) => x.id === inspectProductId) ?? null

  }, [inspectProductId, productsQuery.items])



  const inspectMedia = useMemo(() => {

    const p = inspectProduct

    if (!p) return [] as Array<{ kind: 'image' | 'video'; url: string }>



    const images: string[] = []

    if (p.imageUrl) images.push(toAbsoluteMediaUrl(String(p.imageUrl)))

    if (Array.isArray(p.imageUrls)) {

      for (const u of p.imageUrls) {

        if (!u) continue

        images.push(toAbsoluteMediaUrl(String(u)))

      }

    }



    const videos: string[] = []

    if (p.videoUrl) videos.push(toAbsoluteMediaUrl(String(p.videoUrl)))

    if (Array.isArray(p.videoUrls)) {

      for (const u of p.videoUrls) {

        if (!u) continue

        videos.push(toAbsoluteMediaUrl(String(u)))

      }

    }



    const media: Array<{ kind: 'image' | 'video'; url: string }> = []

    for (const url of Array.from(new Set(images))) media.push({ kind: 'image', url })

    for (const url of Array.from(new Set(videos))) media.push({ kind: 'video', url })

    return media

  }, [inspectProduct])



  useEffect(() => {

    setInspectMediaIndex(0)

  }, [inspectProductId])



  const checkCurrencyLock = (targetCurrency: string): boolean => {
    const activeDealerId = `${selectedBayi}`
    const dealerLines = cart.lines.filter((l) => String(l.dealer?.id) === activeDealerId)
    if (dealerLines.length > 0) {
      const existingRaw = String(dealerLines[0]?.product?.currency ?? 'TRY').trim().toUpperCase()
      const existingCurr = (existingRaw === 'TL' || !existingRaw) ? 'TRY' : existingRaw
      const newCurr = (targetCurrency === 'TL' || !targetCurrency) ? 'TRY' : targetCurrency
      if (existingCurr !== newCurr) {
        showMessage(
          'Farklı Para Birimi Uyarısı',
          `Sepetinizde ${existingCurr} para biriminde ürünler bulunmaktadır. Farklı para birimindeki (${newCurr}) ürünleri aynı siparişe ekleyemezsiniz. Lütfen önce mevcut siparişi tamamlayın veya sepeti temizleyin.`
        )
        return false
      }
    }
    return true
  }

  const addToCart = (productId: string) => {
    const qty = Math.max(1, Number(draftQty[productId] ?? 1))
    const montaj = (draftMontaj[productId] ?? 'Montaj istemiyorum.') as CartLine['montaj']

    const product = productMap.get(productId)
    if (!product) return
    const resolvedUnitPrice = product.unitPrice === null ? null : Number(product.unitPrice)
    if (resolvedUnitPrice === null || !Number.isFinite(resolvedUnitPrice) || resolvedUnitPrice <= 0) {
      showMessage('Hata', 'Fiyat tanımlı olmadığı için sepete eklenemiyor.')
      return
    }
    const isInstallable = Boolean((product as any)?.isInstallable)
    const installationFee = Number((product as any)?.installationFee ?? 0)

    if (montaj === 'Montaj istiyorum.') {
      if (!isInstallable) {
        setDraftMontaj((prev) => ({ ...prev, [productId]: 'Montaj istemiyorum.' }))
        showToast('Bu ürün için montaj seçeneği yok')
        return
      }
      setMontajProductId(productId)
      setMontajForm((prev) => ({
        ...prev,
        bayiAdi: selectedBayiLabel,
        urunAdi: product?.name ?? '',
        miktar: qty
      }))
      setMontajError(null)
      setMontajOpen(true)
      return
    }

    const unitPrice = resolvedUnitPrice
    const kdvRate = Number(product.taxRate ?? 0)
    const isClosedToSale = isClosedToSaleRule(product as any)
    if (isClosedToSale && canBsyHHide) {
      showToast('Bu ürünü görüntüleme yetkiniz yok')
      return
    }
    // "Yakında" kilidini stokYokSiparis yetkisi KALDIRIR (2026-08-21 kullanıcı kuralı).
    // Gelecek ürün de stoğu olmayan üründür; yetkinin anlamı tam olarak budur.
    if (isClosedToSale && canBsyHComingSoon && !canOrderOutOfStock) {
      showToast('Gelecek ürünler için henüz sipariş verilemez.')
      return
    }

    const currency = resolveProductSalesCurrency(product as any)

    if (!checkCurrencyLock(currency)) {
      return
    }

    cart.addLine({
      product: {
        id: productId,
        name: product?.name ?? '',
        stockCode: product?.stockCode ?? '',
        unitPrice,
        displayUnitPrice: product?.displayUnitPrice ?? null,
        kdvRate,
        imageUrl: product.imageUrl ?? null,
        isInstallable,
        installationFee: Number.isFinite(installationFee) ? installationFee : 0,
        currency
      },
      dealer: { id: `${selectedBayi}`, label: selectedBayiLabel },
      montaj,
      qty
    })
    showToast('Ürün sepete eklendi')
  }



  const saveMontajAndAddToCart = () => {

    if (!montajProductId) return



    if (!montajForm.isimSoyisim.trim() || !montajForm.telefon.trim() || !montajForm.adres.trim() || !montajForm.bolge.trim()) {

      setMontajError('Lütfen zorunlu alanları doldurun.')

      return

    }



    const qty = Math.max(1, Number(montajForm.miktar || 1))



    const product = productMap.get(montajProductId)

    if (!product) return

    const resolvedUnitPrice = product.unitPrice === null ? null : Number(product.unitPrice)

    if (resolvedUnitPrice === null || !Number.isFinite(resolvedUnitPrice) || resolvedUnitPrice <= 0) {

      setMontajOpen(false)

      showMessage('Hata', 'Fiyat tanımlı olmadığı için sepete eklenemiyor.')

      return

    }



    if (!Boolean((product as any)?.isInstallable)) {

      setDraftMontaj((prev) => ({ ...prev, [montajProductId]: 'Montaj istemiyorum.' }))

      setMontajOpen(false)

      showToast('Bu ürün için montaj seçeneği yok')

      return

    }

    const unitPrice = resolvedUnitPrice

    const kdvRate = Number(product.taxRate ?? 0)

    const isClosedToSale = isClosedToSaleRule(product as any)
    if (isClosedToSale && canBsyHHide) {
      setMontajOpen(false)
      showToast('Bu ürünü görüntüleme yetkiniz yok')
      return
    }
    if (isClosedToSale && canBsyHComingSoon && !canOrderOutOfStock) {
      setMontajOpen(false)
      showToast('Gelecek ürünler için henüz sipariş verilemez.')
      return
    }



    const currency = resolveProductSalesCurrency(product as any)

    if (!checkCurrencyLock(currency)) {
      setMontajOpen(false)
      return
    }

    cart.addLine({

      product: {

        id: montajProductId,

        name: product?.name ?? '',

        stockCode: product?.stockCode ?? '',

        unitPrice,

        displayUnitPrice: product?.displayUnitPrice ?? null,

        kdvRate,

        imageUrl: product.imageUrl ?? null,

        isInstallable: true,

        installationFee: Number.isFinite(Number((product as any)?.installationFee ?? 0)) ? Number((product as any)?.installationFee ?? 0) : 0,

        currency

      },

      dealer: { id: `${selectedBayi}`, label: selectedBayiLabel },

      montaj: 'Montaj istiyorum.',

      qty

    })



    setMontajDetails((prev) => ({ ...prev, [montajProductId]: { ...montajForm, miktar: qty } }))



    setMontajOpen(false)

    showToast('Ürün sepete eklendi')

  }




  const cartItems = useMemo(() => {

    return cart.lines

      .map((l) => {

        const baseUnit = Number(l.product.unitPrice ?? 0)

        let installUnit = 0



        const wantsInstall = String(l.montaj ?? '')

          .toLowerCase()

          .includes('montaj istiyorum')



        if (wantsInstall) {

          const inlineFeeUnit = Number((l.product as any)?.installationFee ?? 0)

          const inlineIsInstallable = Boolean((l.product as any)?.isInstallable) || (Number.isFinite(inlineFeeUnit) && inlineFeeUnit > 0)



          if (inlineIsInstallable && Number.isFinite(inlineFeeUnit) && inlineFeeUnit > 0) {

            installUnit = inlineFeeUnit

          } else {

            const product = productMap.get(l.product.id)

            const isInstallable = Boolean((product as any)?.isInstallable)

            if (isInstallable) {

              const feeUnit = Number((product as any)?.installationFee ?? 0)

              if (Number.isFinite(feeUnit) && feeUnit > 0) installUnit = feeUnit

            }

          }

        }



        const unitWithInstall = baseUnit + installUnit

        const rawLineTotal = unitWithInstall * l.qty



        const metaTax = Number(productTaxByProductId[l.product.id]?.taxRate)
        const effectiveTaxRate = Number.isFinite(metaTax) ? metaTax : Number(l.product.kdvRate ?? 0)

        const pgId = customerPriceGroupIdByCode[String(selectedBayi || '')]
        const pg = pgId ? priceGroups.find((x) => x.id === pgId) : null
        const isAskeriye = (pg ? Number((pg as any)?.code ?? 0) === 7 : false) || selectedBayiPriceGroupInvoiceType === 'ASKERİYE'
        /*
          FORMUL BILINMIYORSA BOLME YAPILMAZ (2026-08-24). Ayni hata sepette de vardi;
          ayrintili gerekce `SiparisCartSection` icinde. Ozeti: fiyat grubu cozulemediginde
          formul bos okunuyor, kod fiyati BRUT sanip 1,16'ya boluyor ve ayni cari icin farkli
          tutar gosteriyordu. Grup bilinmiyorsa fiyata DOKUNULMAZ.
        */
        const formula = String((pg as any)?.formula ?? '')
        const formulaAlreadyNet = pg
          ? formula.toUpperCase().includes('REMOVE_KDV')
          : true

        const invoiceType = selectedBayiPriceGroupInvoiceType
        const shouldApplyVat = invoiceType === 'FATURA' && !isAskeriye

        // For ACIK, show and use assigned price as-is (no VAT, no VAT removal).
        // For FATURA, normalize to NET (KDV hariç) and compute VAT from NET.
        const vatFactor = 1 + (Number(effectiveTaxRate) || 0) / 100
        const lineTotal = shouldApplyVat
          ? (!formulaAlreadyNet && vatFactor > 0 ? rawLineTotal / vatFactor : rawLineTotal)
          : rawLineTotal

        const lineKdv = shouldApplyVat ? (lineTotal * effectiveTaxRate) / 100 : 0

        return { line: l, lineTotal, lineKdv, baseUnit, installUnit, unitWithInstall, effectiveTaxRate }

      })
      .filter(Boolean)
  }, [cart.lines, customerPriceGroupIdByCode, priceGroups, productMap, productTaxByProductId, selectedBayi, selectedBayiPriceGroupInvoiceType])

  useEffect(() => {
    if (dealer?.code && productsQuery.items && productsQuery.items.length > 0) {
      cart.syncProductPrices(productsQuery.items, String(dealer.code))
    }
  }, [dealer?.code, productsQuery.items, cart])

  const installationFeeTotal = useMemo(() => {

    return cartItems.reduce((acc, it: any) => acc + Number(it.installUnit ?? 0) * Number(it.line?.qty ?? 0), 0)

  }, [cartItems])

  const installationFeeBreakdown = useMemo(() => {

    return (cartItems as any[])

      .filter((it) => Number(it.installUnit ?? 0) > 0)

      .map((it) => {

        const qty = Number(it.line?.qty ?? 0)

        const unit = Number(it.installUnit ?? 0)

        return {

          key: String(it.line?.key ?? it.line?.product?.id ?? ''),

          name: String(it.line?.product?.name ?? ''),

          qty,

          unit,

          total: unit * qty

        }

      })

      .filter((x) => x.total > 0)

  }, [cartItems])



  // Apply campaigns to cart

  const campaignResult = useMemo(() => {

    if (campaigns.length === 0 || cartItems.length === 0) {

      return { appliedCampaigns: [], totalDiscount: 0, giftItems: [], itemDiscounts: {} }

    }



    // Convert cart items to campaign cart items

    const campaignCartItems: CampaignCartItem[] = cartItems.map((it) => ({

      product: it.line.product,

      dealer: it.line.dealer,

      montaj: it.line.montaj,

      qty: it.line.qty

    }))



    return applyCampaignsToCart(campaignCartItems, campaigns, siparisPriceGroupCode)
  }, [campaigns, cartItems, siparisPriceGroupCode])

  useEffect(() => {
    void (async () => {
      try {
        const m: Record<string, { taxRate: number }> = {}
        for (const p of productsQuery.items as any[]) {
          const id = String(p?.id ?? '')
          if (!id) continue
          m[id] = { taxRate: Number(p?.taxRate ?? 0) }
        }

        setProductTaxByProductId(m)
      } catch {

        setProductTaxByProductId({})

      }
    })()
  }, [productsQuery.items])



  return (

    <div className="w-full px-2 sm:px-4 lg:px-4 2xl:px-6 py-6">

      {!campaignsLoading && campaigns.length > 0 && (
        <div className="mb-6 flex items-stretch justify-between gap-4">
          <div className="flex-1">
            <CampaignCarousel
              campaigns={campaigns}
              onCampaignClick={(c) => {
                setSelectedCampaign(c)
                setCampaignDetailOpen(true)
              }}
            />
          </div>

          <div className="shrink-0 flex items-center">
            <button
              type="button"
              onClick={() => setCampaignsModalOpen(true)}
              className="relative h-full min-w-[120px] px-3 py-2 text-white rounded-xl shadow-md transition-all hover:opacity-90 active:scale-95"
              style={{ background: 'linear-gradient(90deg, var(--tenant-gradient-from, #8F2500), var(--tenant-gradient-to, #BD390C))' }}
            >
              <span className="flex flex-col items-center leading-[1.05]">
                <span className="font-script text-[13px]">Tüm</span>
                <span className="font-montserrat font-extrabold text-[12px]">Kampanyaları</span>
                <span className="font-montserrat font-light text-[12px]">Gör</span>
              </span>

              <span
                className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-white border-2 border-red-600 text-red-600 text-[11px] font-extrabold flex items-center justify-center"
                aria-label={`Kampanya sayısı ${campaigns.length}`}
                title={`Kampanya sayısı: ${campaigns.length}`}
              >
                {campaigns.length}
              </span>
            </button>
          </div>
        </div>
      )}



      {/* Campaigns List Modal */}

      <CampaignsListModal

        isOpen={campaignsModalOpen}

        onClose={() => setCampaignsModalOpen(false)}

        campaigns={campaigns}

      />



      {/* Campaign Detail Popover */}

      <CampaignDetailPopover

        isOpen={campaignDetailOpen}
        onClose={() => {

          setCampaignDetailOpen(false)

          setSelectedProductForCampaign(null)

          setSelectedCampaign(null)

        }}

        campaign={selectedCampaign}

        campaigns={campaigns.filter((c) =>

          selectedProductForCampaign

            ? c.discounts.some((d) => d.stokKodu === selectedProductForCampaign.stockCode) ||

            c.conditions.some((cond) => {

              if (!cond.productStockCodesJson) return false

              try {

                const stockCodes = JSON.parse(cond.productStockCodesJson) as string[]

                return stockCodes.includes(selectedProductForCampaign.stockCode)

              } catch {

                return false

              }

            })

            : false

        )}

        productName={selectedProductForCampaign?.name}

      />



      {/* 1. SATIR: CARİ SEÇİMİ */}
      <div className="relative z-[39] bg-white border border-gray-200/60 rounded-xl shadow-[0_1px_3px_rgba(0,0,0,0.04)] px-4 py-3 mb-3">
        <div className="w-full min-w-0">
          <CustomerSelect
            label="Cari Seçimi"
            value={
              dealer?.code
                ? ({
                  customerCode: dealer.code,
                  name: dealer.label ? dealer.label.replace(/^\[.*?\]\s*/, '').split(' • ')[0] : dealer.code
                } as CustomerDto)
                : null
            }
            onChange={(next) => {
              if (next) {
                const code = String(next.customerCode ?? '').trim()
                const name = String(next.name ?? '').trim()
                const label = `[${code}] ${name}`
                setDealer({ code, label })
              } else {
                setDealer(null)
              }
            }}
            placeholder="Cari kodu, adı veya telefon ile hızlı arayın"
            minQueryLength={1}
            limit={50}
            fetcher={fetchSiparisCariList}
          />
        </div>
      </div>

      {/* 2. SATIR: ÜRÜN ARAMA VE FİLTRELEME İŞLEMLERİ */}
      <div className="relative z-30 bg-white border border-gray-200/60 rounded-xl shadow-[0_1px_3px_rgba(0,0,0,0.04)] px-4 py-3 mb-4">
        <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-3">
          <div className="w-full xl:max-w-md min-w-0 relative z-40">
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <input
                ref={productSearchRef}
                value={productsQuery.q}
                onChange={(e) => {
                  // Arama da bir daraltmadır: kategori seçilmemiş olsa bile listeyi açar,
                  // yoksa arama kutusu hiçbir sonuç bulamazdı (istek kapalı olurdu).
                  if (e.target.value.trim()) setCatalogRequested(true)
                  productsQuery.setQ(e.target.value)
                }}
                placeholder="Ürün adı, stok kodu veya barkod ile hızlı ara..."
                className="w-full bg-white border border-slate-200 rounded-xl h-[40px] pl-9 pr-8 text-xs sm:text-sm font-medium focus:ring-2 focus:ring-[#D84315]/20 focus:border-[#D84315]/40 transition-all placeholder:text-slate-400 shadow-xs"
              />
              {productsQuery.q && (
                <button
                  type="button"
                  onClick={() => productsQuery.setQ('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1"
                  title="Temizle"
                >
                  <X size={14} />
                </button>
              )}
            </div>

            {productsQuery.q.trim().length >= 2 && (
              <div className="absolute left-0 right-0 top-full mt-1.5 z-50 bg-white border border-slate-200 rounded-2xl shadow-2xl max-h-80 overflow-y-auto p-2 space-y-1 w-full min-w-[320px] sm:min-w-[440px]">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wide px-3 py-1 flex items-center justify-between border-b border-slate-100 pb-1.5 mb-1">
                  <span>Arama Sonuçları</span>
                  <span className="text-[#D84315] font-extrabold">{searchFilteredItems.length} ürün bulundu</span>
                </div>
                {searchFilteredItems.length === 0 ? (
                  <div className="px-3 py-4 text-center text-xs text-slate-400 font-semibold">Satışa açık uygun ürün bulunamadı.</div>
                ) : (
                  searchFilteredItems.slice(0, 10).map((p: any) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => handleSelectSearchedProduct(p)}
                      className="w-full text-left p-2.5 rounded-xl hover:bg-orange-50/80 border border-transparent hover:border-orange-200 transition-all flex items-center justify-between gap-3 group"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-10 h-10 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center shrink-0 overflow-hidden relative">
                          <span className="text-xs font-bold text-slate-400 select-none">{String(p.name ?? 'U').charAt(0).toUpperCase()}</span>
                          {p.imageUrl ? (
                            <img
                              src={toAbsoluteMediaUrl(String(p.imageUrl))}
                              alt={p.name}
                              className="absolute inset-0 w-full h-full object-contain p-0.5 bg-white"
                              onError={(e) => {
                                ;(e.currentTarget as HTMLElement).style.display = 'none'
                              }}
                            />
                          ) : null}
                        </div>
                        <div className="min-w-0">
                          <div className="text-xs font-bold text-slate-800 truncate group-hover:text-[#D84315]">{p.name}</div>
                          <div className="text-[10px] text-slate-400 truncate font-semibold">
                            {p.stockCode ? `Stok: ${p.stockCode}` : ''} {p.groupCode ? `• Kategori: ${p.groupCode}` : ''}
                          </div>
                        </div>
                      </div>
                      <div className="text-xs font-black text-[#D84315] shrink-0">
                        {visibleProductPrice(p) ? formatMoney(Number(visibleProductPrice(p))) : 'Fiyat Yok'}
                      </div>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          {/* Mobile Filter Button */}
          <div className="w-full sm:hidden">
            <button
              type="button"
              onClick={() => setMobileFilterOpen((v) => !v)}
              className="w-full h-10 px-4 rounded-xl border border-slate-200 bg-white text-slate-800 font-bold text-xs flex items-center justify-between shadow-sm active:scale-[0.98] transition-all"
            >
              <div className="flex items-center gap-2">
                <SlidersHorizontal size={16} className="text-[#D84315]" />
                <span>Filtreleme Seçenekleri</span>
              </div>
              <div className="flex items-center gap-1.5">
                {(onlyCampaignProducts || showOutOfStock || productCurrencyFilters.length > 0 || sortMode !== 'default') && (
                  <span className="w-2 h-2 rounded-full bg-[#D84315] animate-pulse" />
                )}
                <span className="text-[11px] text-slate-400 font-normal">
                  {mobileFilterOpen ? 'Gizle' : 'Göster'}
                </span>
                <ChevronDown size={14} className={`text-slate-400 transition-transform ${mobileFilterOpen ? 'rotate-180' : ''}`} />
              </div>
            </button>

            {mobileFilterOpen && (
              <div className="mt-2.5 bg-slate-50/90 border border-slate-200 rounded-xl p-3.5 space-y-3 shadow-inner">
                {/* View Mode Selection */}
                <div>
                  <span className="block text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-1.5">Görünüm Modu</span>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setViewMode('grid')}
                      className={'h-9 px-3 rounded-lg border text-xs font-bold flex items-center justify-center gap-2 ' + (viewMode === 'grid' ? 'border-[#D84315] text-[#D84315] bg-orange-50' : 'border-slate-200 text-slate-700 bg-white')}
                    >
                      <LayoutGrid size={14} />
                      Kutu
                    </button>
                    <button
                      type="button"
                      onClick={() => setViewMode('list')}
                      className={'h-9 px-3 rounded-lg border text-xs font-bold flex items-center justify-center gap-2 ' + (viewMode === 'list' ? 'border-[#D84315] text-[#D84315] bg-orange-50' : 'border-slate-200 text-slate-700 bg-white')}
                    >
                      <List size={14} />
                      Liste
                    </button>
                  </div>
                </div>

                {/* Filter Badges */}
                <div>
                  <span className="block text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-1.5">Özel Filtreler</span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setOnlyCampaignProducts((p) => !p)}
                      className={'h-9 px-3 rounded-lg border text-xs font-bold flex items-center justify-center gap-2 ' + (onlyCampaignProducts ? 'border-orange-600 text-orange-700 bg-orange-50' : 'border-slate-200 text-slate-700 bg-white')}
                    >
                      <Gift size={14} />
                      Kampanyalı Ürünler
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowOutOfStock((p) => !p)}
                      className={'h-9 px-3 rounded-lg border text-xs font-bold flex items-center justify-center gap-2 ' + (showOutOfStock ? 'border-red-600 text-red-700 bg-red-50' : 'border-slate-200 text-slate-700 bg-white')}
                    >
                      <CircleAlert size={14} className={showOutOfStock ? 'text-red-600' : 'text-slate-500'} />
                      Stokta Olmayanları Göster
                    </button>
                  </div>
                </div>

                {/* Kur süzgeci (mobil) */}
                <div>
                  <span className="block text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-1.5">Para Birimi / Kur</span>
                  <CurrencyFilterDropdown
                    selected={productCurrencyFilters}
                    onChange={setProductCurrencyFilters}
                    className="w-full"
                  />
                </div>

                {/* Sort & PageSize */}
                <div className="grid grid-cols-2 gap-2.5 pt-1">
                  <div>
                    <span className="block text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-1">Sıralama</span>
                    <select
                      value={sortMode}
                      onChange={(e) => setSortMode(e.target.value as any)}
                      className="w-full h-9 px-2 text-xs font-bold border border-slate-200 rounded-lg bg-white"
                    >
                      <option value="default">Varsayılan</option>
                      <option value="priceAsc">Fiyat (Düşük → Yüksek)</option>
                      <option value="priceDesc">Fiyat (Yüksek → Düşük)</option>
                      <option value="stockDesc">Stok (Çoktan aza)</option>
                    </select>
                  </div>
                  <div>
                    <span className="block text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-1">Gösterim</span>
                    <select
                      value={productsQuery.pageSize}
                      onChange={(e) => productsQuery.setPageSize(Number(e.target.value))}
                      className="w-full h-9 px-2 text-xs font-bold border border-slate-200 rounded-lg bg-white"
                    >
                      <option value={20}>20 Ürün</option>
                      <option value={50}>50 Ürün</option>
                      <option value={100}>100 Ürün</option>
                      <option value={500}>500 Ürün</option>
                    </select>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Desktop Toolbar */}
          <div className="hidden sm:flex flex-wrap items-center gap-3 shrink-0">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setViewMode('grid')}
                className={
                  'h-8 px-3 rounded-lg border text-xs font-bold flex items-center gap-2 ' +
                  (viewMode === 'grid' ? 'border-[#D84315] text-[#D84315] bg-orange-50' : 'border-slate-200 text-slate-700 bg-white')
                }
                title="Kutu görünüm"
              >
                <LayoutGrid size={14} />
                Kutu
              </button>
              <button
                type="button"
                onClick={() => setViewMode('list')}
                className={
                  'h-8 px-3 rounded-lg border text-xs font-bold flex items-center gap-2 ' +
                  (viewMode === 'list' ? 'border-[#D84315] text-[#D84315] bg-orange-50' : 'border-slate-200 text-slate-700 bg-white')
                }
                title="Liste görünüm"
              >
                <List size={14} />
                Liste
              </button>
              <button
                type="button"
                onClick={() => setOnlyCampaignProducts((p) => !p)}
                className={
                  'h-8 px-3 rounded-lg border text-xs font-bold flex items-center gap-2 ' +
                  (onlyCampaignProducts ? 'border-orange-600 text-orange-700 bg-orange-50' : 'border-slate-200 text-slate-700 bg-white')
                }
                title="Kampanyalı ürünler"
              >
                <Gift size={14} />
                Kampanyalı
              </button>
              <button
                type="button"
                onClick={() => setShowOutOfStock((p) => !p)}
                className={
                  'h-8 px-3 rounded-lg border text-xs font-bold flex items-center gap-2 transition ' +
                  (showOutOfStock ? 'border-red-600 text-red-700 bg-red-50 ring-1 ring-red-300' : 'border-slate-200 text-slate-700 bg-white hover:bg-slate-50')
                }
                title="Sadece stokta olmayan ürünleri gösterir"
              >
                <CircleAlert size={14} className={showOutOfStock ? 'text-red-600' : 'text-slate-500'} />
                Stokta Olmayanları Göster
              </button>
            </div>

            <div className="h-6 w-px bg-slate-300 mx-1 hidden sm:block" />

            {/* KUR SÜZGECİ — ürünün satış dövizi (Açılır Onay Kutulu Dropdown) */}
            <CurrencyFilterDropdown
              selected={productCurrencyFilters}
              onChange={setProductCurrencyFilters}
            />

            <div className="h-6 w-px bg-slate-300 mx-1 hidden sm:block" />

            <div className="flex items-center gap-2">
              <span className="text-[10px] font-semibold text-slate-600">Sırala</span>
              <select
                value={sortMode}
                onChange={(e) => setSortMode(e.target.value as any)}
                className="h-8 px-2 text-[11px] font-bold border border-slate-200 rounded-lg bg-white"
              >
                <option value="default">Varsayılan</option>
                <option value="priceAsc">Fiyat (Düşük → Yüksek)</option>
                <option value="priceDesc">Fiyat (Yüksek → Düşük)</option>
                <option value="stockDesc">Stok (Çoktan aza)</option>
              </select>
            </div>

            <div className="h-6 w-px bg-slate-300 mx-1 hidden sm:block" />

            <div className="flex items-center gap-2">
              <span className="text-[10px] font-semibold text-slate-600">Göster</span>
              <select
                value={productsQuery.pageSize}
                onChange={(e) => productsQuery.setPageSize(Number(e.target.value))}
                className="h-8 px-2 text-[11px] font-bold border border-slate-200 rounded-lg bg-white"
              >
                <option value={20}>20</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
                <option value={500}>500</option>
              </select>
            </div>
          </div>
        </div>
      </div>



      <div className="relative z-20 bg-white/80 backdrop-blur-md border border-gray-200/60 rounded-xl shadow-[0_1px_3px_rgba(0,0,0,0.04)] px-4 py-3 mb-4">

        <div className="overflow-x-auto overflow-y-hidden [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden pt-2.5">

          <div className="flex items-center gap-6 text-[11px] font-semibold text-gray-700 min-w-max">

            {mainTabs.map((t) => {

              const isActive = t === activeMainTab

              return (

                <button

                  key={t}

                  type="button"

                  onClick={() => {

                    const nextCats = subTabsByMain[t] ?? []

                    const nextSub = nextCats[0] ?? ''

                    if (!nextSub) return

                    setCategory(t, nextSub)

                  }}

                  className={
                    'py-2 border-b-2 flex items-center gap-1.5 relative ' +
                    (isActive ? 'text-[#B73A0B] border-[#B73A0B]' : 'text-gray-700 border-transparent hover:text-gray-900')
                  }
                >
                  {categoriesState.labels?.[t] || t}
                  {hasCampaignForMainTab(t) && (
                    <span title="Kategoriye özel kampanya var!">
                      <Gift size={13} className="text-red-500 animate-pulse shrink-0" />
                    </span>
                  )}
                  {onlyCampaignProducts && (campaignCountsByCategory.mainCounts[toKey(t)] ?? 0) > 0 && (
                    <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 bg-red-600 text-white text-[9px] font-extrabold min-w-[18px] h-[16px] px-1 rounded-full flex items-center justify-center border border-white shadow-xs leading-none pointer-events-none z-10">
                      {campaignCountsByCategory.mainCounts[toKey(t)]}
                    </span>
                  )}
                </button>

              )

            })}

          </div>

        </div>

      </div>



      {/* Üst kategori seçilmeden alt şerit HİÇ basılmaz; boş beyaz bir bant kalıyordu. */}
      {categories.length > 0 && (
      <div className="relative z-10 bg-white/80 backdrop-blur-md border border-gray-200/60 rounded-xl shadow-[0_1px_3px_rgba(0,0,0,0.04)] px-4 py-3 mb-6">

        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">

          <div className="flex-1 min-w-0 overflow-x-auto overflow-y-hidden [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden pt-2.5">

            {/*
              HAP (PILL) ROZETLER — kullanıcı kararı, 2026-08-13.
              Alt çizgili sekme dar ekranda hangi kategorinin seçili olduğunu zor okutuyordu.
              Seçilinin yanındaki sayı GERÇEK sonuç adedi (`productsQuery.total`); seçili
              olmayanlarda sayı YAZILMIYOR, çünkü o kategorilerin adedi sunucudan gelmiyor ve
              uydurma bir sayı yazmak yanlış bilgi olurdu.
            */}
            <div className="flex items-center gap-2 min-w-max py-0.5">

              {categories.map((c) => {
                const isActive = c === activeCategory

                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => {
                      setCategory(activeMainTab, c)
                    }}
                    className={
                      'text-[12px] font-semibold rounded-full px-3.5 py-1.5 border transition-colors flex items-center gap-1.5 relative whitespace-nowrap ' +
                      (isActive
                        ? 'bg-[#B73A0B] border-[#B73A0B] text-white shadow-sm'
                        : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100 hover:border-slate-300')
                    }
                  >
                    {categoriesState.labels?.[c] || c}
                    {isActive && !productsQuery.loading && productsQuery.total > 0 && (
                      <span className="text-[10px] font-black bg-white/25 rounded-full px-1.5 py-px">
                        {productsQuery.total}
                      </span>
                    )}
                    {hasCampaignForSubTab(activeMainTab, c) && (
                      <span title="Alt kategoriye özel kampanya var!">
                        <Gift size={11} className="text-red-500 animate-pulse shrink-0" />
                      </span>
                    )}
                    {onlyCampaignProducts && (campaignCountsByCategory.subCounts[`${toKey(activeMainTab)}_${toKey(c)}`] ?? 0) > 0 && (
                      <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 bg-red-600 text-white text-[8px] font-extrabold min-w-[16px] h-[15px] px-1 rounded-full border border-white shadow-xs flex items-center justify-center leading-none pointer-events-none z-10">
                        {campaignCountsByCategory.subCounts[`${toKey(activeMainTab)}_${toKey(c)}`]}
                      </span>
                    )}
                  </button>
                )
              })}

            </div>

          </div>

        </div>
      </div>
      )}



      {productsQuery.error && <div className="mb-3 text-sm font-semibold text-red-600">{productsQuery.error}</div>}



      <div className="w-full">

        <div className="w-full">

          <div>

            <div
              className={
                viewMode === 'grid'
                  ? 'grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-2 sm:gap-4'
                  : 'grid grid-cols-1 min-[900px]:grid-cols-2 gap-3.5'
              }
            >

              {!dealer?.code ? (
                <div className="col-span-full py-16 px-4 text-center bg-white/90 rounded-2xl border-2 border-dashed border-slate-200 shadow-sm flex flex-col items-center justify-center gap-2">
                  <div className="w-12 h-12 rounded-full bg-orange-50 border border-orange-100 flex items-center justify-center text-orange-600 mb-1">
                    <Users size={24} />
                  </div>
                  <div className="text-base font-bold text-slate-800">Lütfen cari seçiniz</div>
                  <div className="text-xs text-slate-500 max-w-sm">Ürünlerin ve cariye özel fiyatların listelenebilmesi için lütfen yukarıdaki alandan bir cari / bayi seçin.</div>
                </div>
              ) : !catalogRequested ? (
                /*
                  AÇILIŞ EKRANI. Bayinin carisi otomatik seçili geldiği için burası eskiden
                  doğrudan 500 ürünlük listeye açılıyordu; kullanıcı bunun yanlış olduğunu
                  söyledi. Artık ne gösterileceğini kullanıcı seçiyor.
                */
                <div className="col-span-full py-16 px-4 text-center bg-white/90 rounded-2xl border-2 border-dashed border-slate-200 shadow-sm flex flex-col items-center justify-center gap-2">
                  <div className="w-12 h-12 rounded-full bg-orange-50 border border-orange-100 flex items-center justify-center text-orange-600 mb-1">
                    <Search size={24} />
                  </div>
                  <div className="text-base font-bold text-slate-800">Kategori seçin veya ürün arayın</div>
                  <div className="text-xs text-slate-500 max-w-sm">
                    Yukarıdaki sekmelerden bir kategori seçin ya da arama kutusuna ürün adı, stok
                    kodu veya barkod yazın. Ürünler seçiminize göre listelenir.
                  </div>
                </div>
              ) : (
                <>
                  {productsQuery.loading && <div className="col-span-full text-xs text-gray-500 py-8 text-center">Yükleniyor...</div>}

                  {!productsQuery.loading && productsQuery.items.length === 0 && (
                    <div className="col-span-full text-xs text-gray-500 py-8 text-center">Ürün bulunamadı.</div>
                  )}



                  {productsQuery.items
                    .filter((p: any) => {
                      const stockNumber = Number((p as any)?.stock ?? 0)
                      const bsyFlag = String((p as any)?.bsyVisibleFlag ?? 'E').trim().toUpperCase()

                      // BSY Rule A: If product is closed to sale (isActive === false), hide product completely when canBsyHHide is active
                      const isClosedToSale = isClosedToSaleRule(p as any)
                      if (canBsyHHide && isClosedToSale) {
                        return false
                      }

                      if (!showOutOfStock && stockNumber <= 0) return false
                      if (onlyInStock && stockNumber <= 0) return false

                      // Kur süzgeci: ürünün SATIŞ dövizi
                      if (productCurrencyFilters.length > 0 && !productCurrencyFilters.includes(productCurrencyOf(p))) return false
                      const visiblePrice = visibleProductPrice(p)
                      const hasPrice = visiblePrice !== null && Number(visiblePrice) > 0
                      if (onlyPriced && !hasPrice) return false
                      if (onlyCampaignProducts && !hasAnyCampaignForStockCode(String(p?.stockCode ?? ''))) return false
                      if (productsQuery.q && productsQuery.q.trim()) {
                        return matchesProductSearch(p, productsQuery.q)
                      }
                      return true
                    })
                    .slice()
                    .sort((a: any, b: any) => {
                      if (sortMode === 'default') return 0
                      if (sortMode === 'stockDesc') return Number((b as any)?.stock ?? 0) - Number((a as any)?.stock ?? 0)
                      const ap = Number(visibleProductPrice(a) ?? 0)
                      const bp = Number(visibleProductPrice(b) ?? 0)
                      if (sortMode === 'priceAsc') return ap - bp
                      if (sortMode === 'priceDesc') return bp - ap
                      return 0
                    })
                    .map((p) => {

                      const qty = draftQty[p.id] ?? 1

                      const montaj = draftMontaj[p.id] ?? 'Montaj istemiyorum.'

                      const isInstallable = Boolean((p as any)?.isInstallable)

                      const visiblePrice = visibleProductPrice(p)
                      const hasPrice = visiblePrice !== null && Number(visiblePrice) > 0

                      const currencyText = resolveProductSalesCurrency({
                        currency: visibleProductCurrency(p),
                        salesCurrencyCode: visibleProductCurrencyCode(p)
                      })

                      const priceText = hasPrice

                        ? currencyText && currencyText !== 'TL' && currencyText !== 'TRY'
                          ? `${currencyText} ${Number(visiblePrice ?? 0).toFixed(2)}`
                          : formatMoney(Number(visiblePrice ?? 0))

                        : 'Fiyat Tanımlı Değil'

                      /*
                        KAMPANYALI FİYAT (2026-09-18 kullanıcı isteği: "ürünün fiyatı
                        değişmiyor, eski fiyatın üstünü çizmeli"). Hesap sepetle AYNI kaynaktan
                        (`campaignPriceForProduct`) ve bayinin fiyat grubuna göre yapılıyor.
                      */
                      const kampanyaFiyati = hasPrice
                        ? campaignPriceForProduct(
                            { stockCode: p.stockCode, groupCode: (p as any).groupCode, subGroupCode: (p as any).subGroupCode, kod4: (p as any).kod4, kod5: (p as any).kod5 },
                            Number(visiblePrice ?? 0),
                            campaigns,
                            siparisPriceGroupCode,
                            // İndirim F4'e uygulanır, bayinin grubuna formülle taşınır.
                            {
                              catalogPrice: (p as any).catalogUnitPrice,
                              catalogCurrency: (p as any).catalogCurrency,
                              formula: siparisPriceGroupFormula,
                              taxRate: (p as any).taxRate,
                              discountRate: (p as any).discountRate
                            }
                          )
                        : null

                      const kampanyaFiyatText = kampanyaFiyati
                        ? (currencyText && currencyText !== 'TL' && currencyText !== 'TRY'
                            ? `${currencyText} ${kampanyaFiyati.newPrice.toFixed(2)}`
                            : formatMoney(kampanyaFiyati.newPrice))
                        : ''

                      const codeLine = p.stockCode ? `Stok: ${p.stockCode}` : ''

                      const groupLine = p.groupCode ? `Grup: ${p.groupCode}` : ''

                      const subGroupLine = p.subGroupCode ? `Alt: ${p.subGroupCode}` : ''

                      const stockNumber = Number((p as any)?.stock ?? 0)
                      const isClosedToSale = isClosedToSaleRule(p as any)
                      const isComingSoonFlag = Boolean((p as any)?.isComingSoon) || Boolean((p as any)?.comingSoon)
                      // GÖRÜNÜM ile SİPARİŞ KİLİDİ AYRI (2026-08-21 kullanıcı kuralı).
                      // Gemi görseli/rozeti satışa kapalı üründe HER ZAMAN görünür; yetki
                      // yalnızca sipariş kilidini kaldırır — kullanıcı gemiyi görür ama
                      // sipariş girebilir.
                      const shouldShowComingSoon = isComingSoonFlag || (canBsyHComingSoon && isClosedToSale)
                      const comingSoonBlocksOrder = shouldShowComingSoon && !canOrderOutOfStock

                      const stockStatus = stockNumber <= 0 ? 'out' : stockNumber <= 12 ? 'limited' : 'in'
                      // Stok yokken siparişi ENGELLEYEN koşul. Rozet ve gri görünüm
                      // `stockStatus`ten devam eder; yalnızca düğmeler bu bayrağa bakar.
                      const blockOutOfStock = stockStatus === 'out' && !canOrderOutOfStock
                      const stockBadgeText =
                        shouldShowComingSoon
                          ? 'YAKINDA STOĞA GELECEK'
                          : stockStatus === 'out'
                            ? 'Stokta Yok'
                            : stockStatus === 'limited'
                              ? `Sınırlı Stok (${Math.max(0, Math.trunc(stockNumber))})`
                              : 'Stokta'
                      const stockBadgeClass =
                        shouldShowComingSoon
                          ? 'bg-amber-500 text-slate-950 ring-1 ring-amber-400 font-extrabold'
                          : stockStatus === 'out'
                            ? 'bg-red-100 text-red-800 ring-1 ring-red-200'
                            : stockStatus === 'limited'
                              ? 'bg-amber-100 text-amber-800 ring-1 ring-amber-200'
                              : 'bg-emerald-100 text-emerald-800 ring-1 ring-emerald-200'

                      const depotText = stockNumber > 12 ? '+12' : String(Math.max(0, Math.trunc(stockNumber)))
                      const boxQty = Number((p as any)?.boxQuantity ?? 0)
                      const boxText = String(Math.max(0, Math.trunc(boxQty)))
                      const effectiveTax = getEffectiveTaxRate(p)
                      const taxLine = `KDV: %${Number(effectiveTax ?? 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`





                      const cartQty = cart.lines.find((l) => l.product.id === p.id)?.qty ?? 0

                      if (viewMode === 'list') {
                        return (
                          <div
                            key={p.id}
                            id={`product-card-${p.id}`}
                            className={
                              'relative bg-white border border-slate-200/80 rounded-xl p-3.5 hover:shadow-md hover:border-[#D84315]/40 transition-all flex flex-col justify-between gap-2.5 min-h-[125px] ' +
                              (stockStatus === 'out' && !shouldShowComingSoon ? 'opacity-75 grayscale hover:grayscale-0 hover:opacity-100 ' : '') +
                              (highlightedProductId === p.id ? ' ring-4 ring-[#D84315] shadow-[0_0_30px_rgba(216,67,21,0.6)] animate-pulse border-2 border-[#D84315] bg-orange-50/80 scale-[1.02] ' : '')
                            }
                          >
                            <ProductCampaignBadge
                              productStockCode={p.stockCode}
                              productCategory={p.groupCode}
                              productSubCategory={p.subGroupCode}
                              productKod4={p.kod4}
                              productKod5={p.kod5}
                              campaigns={campaigns}
                              priceGroupCode={siparisPriceGroupCode}
                              position="top-left"
                              onClick={() => {
                                setSelectedProductForCampaign({ stockCode: p.stockCode, name: p.name })
                                setCampaignDetailOpen(true)
                              }}
                            />

                            <div className="flex items-start gap-3 flex-1">
                              {/* Left Section: 80x80 image / placeholder */}
                              <div
                                onClick={() => {
                                  setInspectProductId(p.id)
                                  setInspectOpen(true)
                                }}
                                className="w-20 h-20 bg-slate-50 border border-slate-200 rounded-lg overflow-hidden flex items-center justify-center shrink-0 relative cursor-pointer group p-1"
                                title="Ürün detayını incele"
                              >
                                {shouldShowComingSoon ? (
                                  <ShipSailingAnimation size="md" />
                                ) : p.imageUrl ? (
                                  <img src={toAbsoluteMediaUrl(String(p.imageUrl))} alt={p.name} className="w-full h-full object-contain p-1 bg-white group-hover:scale-105 transition-transform" />
                                ) : (
                                  <div className="w-full h-full flex items-center justify-center text-slate-400 font-extrabold text-lg bg-slate-100">
                                    {String(p.name ?? 'U').charAt(0).toUpperCase()}
                                  </div>
                                )}
                              </div>

                              {/* Middle Section: Name, StockCode, Barcode, Depo/Koli */}
                              <div className="flex-1 min-w-0 flex flex-col justify-between min-h-[80px]">
                                <div>
                                  <div
                                    onClick={() => {
                                      setInspectProductId(p.id)
                                      setInspectOpen(true)
                                    }}
                                    className="text-xs font-bold text-slate-900 line-clamp-2 cursor-pointer hover:text-[#D84315] transition-colors leading-snug"
                                    title={p.name}
                                  >
                                    {p.name}
                                  </div>
                                  <div className="mt-1 text-[11px] font-sans font-bold text-slate-900 leading-tight">
                                    {p.stockCode ? `Stok Kodu: ${p.stockCode}` : ''}
                                  </div>
                                  {p.barcode && (
                                    <div className="text-[11px] font-sans font-bold text-slate-900 leading-tight">
                                      {`Barkod: ${p.barcode}`}
                                    </div>
                                  )}
                                </div>
                                <div className="mt-1 text-[10px] text-slate-500 font-medium leading-tight">
                                  {`Depo: ${depotText} • Koli: ${boxText} • ${taxLine}`}
                                </div>
                              </div>

                              {/* Right Section: Price & Stock Badge */}
                              <div className="w-[140px] sm:w-[160px] shrink-0 flex flex-col items-end text-right justify-between min-h-[80px]">
                                <div className="flex flex-col items-end">
                                  {kampanyaFiyati ? (
                                    <div className="flex flex-col items-end leading-tight">
                                      <span className="text-[11px] font-semibold text-slate-400 line-through">{priceText}</span>
                                      <span className="text-sm sm:text-base font-extrabold text-emerald-700">{kampanyaFiyatText}</span>
                                      <span className="text-[9px] font-bold text-emerald-600">
                                        {kampanyaFiyati.percent !== null ? `Kampanya %${kampanyaFiyati.percent}` : 'Kampanyalı fiyat'}
                                      </span>
                                    </div>
                                  ) : (
                                    <div className={'text-sm sm:text-base font-extrabold ' + (hasPrice ? 'text-slate-900' : 'text-red-600')}>
                                      {priceText}
                                    </div>
                                  )}
                                  <div className="mt-0.5">
                                    <span className={stockBadgeClass + ' text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider'}>
                                      {stockBadgeText}
                                    </span>
                                  </div>

                                  {/* Cart indicator badge */}
                                  {cartQty > 0 && (
                                    <div className="mt-1.5 inline-flex items-center gap-1 text-[10px] font-extrabold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200 shadow-2xs">
                                      <Check size={11} /> Sepette · {cartQty} adet
                                    </div>
                                  )}
                                </div>

                                <div className="flex items-center gap-1.5 justify-end mt-1">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setInspectProductId(p.id)
                                      setInspectOpen(true)
                                    }}
                                    className="p-1.5 rounded-lg border border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors"
                                    title="Ürün Detayı"
                                  >
                                    <Eye size={14} />
                                  </button>
                                </div>
                              </div>
                            </div>

                            {/* Bottom Controls Row: Montaj, Qty, Add to Cart */}
                            <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-2">
                              {isInstallable ? (
                                <select
                                  value={montaj}
                                  onChange={(e) => setDraftMontaj((prev) => ({ ...prev, [p.id]: e.target.value as any }))}
                                  className="h-7 px-2 text-[10px] border border-slate-200 rounded-lg bg-slate-50 text-slate-700 flex-1 max-w-[140px]"
                                >
                                  <option>Montaj istemiyorum.</option>
                                  <option>Montaj istiyorum.</option>
                                </select>
                              ) : <div />}

                              <div className="flex items-center gap-2">
                                <div className="flex items-center bg-slate-100 rounded-lg p-0.5 border border-slate-200 h-7">
                                  <button
                                    type="button"
                                    onClick={() => setDraftQty((prev) => ({ ...prev, [p.id]: Math.max(1, Number((prev as any)[p.id] ?? qty) - 1) }))}
                                    className="w-6 h-6 flex items-center justify-center text-slate-600 hover:text-[#D84315] disabled:opacity-50 font-bold"
                                    aria-label="Azalt"
                                    disabled={blockOutOfStock && !shouldShowComingSoon}
                                  >
                                    -
                                  </button>
                                  <input
                                    type="number"
                                    min={1}
                                    value={qty}
                                    onChange={(e) => setDraftQty((prev) => ({ ...prev, [p.id]: Number(e.target.value) }))}
                                    className="w-9 bg-transparent border-none text-center p-0 text-xs font-extrabold focus:ring-0 disabled:opacity-50"
                                    disabled={blockOutOfStock && !shouldShowComingSoon}
                                  />
                                  <button
                                    type="button"
                                    onClick={() => setDraftQty((prev) => ({ ...prev, [p.id]: Math.max(1, Number((prev as any)[p.id] ?? qty) + 1) }))}
                                    className="w-6 h-6 flex items-center justify-center text-slate-600 hover:text-[#D84315] disabled:opacity-50 font-bold"
                                    aria-label="Arttır"
                                    disabled={blockOutOfStock && !shouldShowComingSoon}
                                  >
                                    +
                                  </button>
                                </div>

                                <button
                                  type="button"
                                  onClick={() => addToCart(p.id)}
                                  className={
                                    'h-7 text-white text-xs font-bold px-3 rounded-lg transition-all shadow-xs flex items-center gap-1 ' +
                                    (blockOutOfStock || comingSoonBlocksOrder ? 'bg-amber-600/80 cursor-not-allowed' : 'bg-[#D84315] hover:bg-orange-700 active:scale-95')
                                  }
                                  disabled={blockOutOfStock || comingSoonBlocksOrder}
                                >
                                  {comingSoonBlocksOrder ? 'Yakında Stoğa Gelecek' : 'Sepete Ekle'}
                                </button>
                              </div>
                            </div>
                          </div>
                        )
                      }

                      return (
                        <div
                          key={p.id}
                          id={`product-card-${p.id}`}
                          className={
                            'relative group bg-white border border-slate-100 rounded-xl overflow-hidden hover:shadow-xl hover:shadow-slate-200/40 transition-all duration-300 flex flex-col ' +
                            (stockStatus === 'out' && !shouldShowComingSoon ? 'opacity-75 grayscale hover:grayscale-0 hover:opacity-100 ' : '') +
                            (highlightedProductId === p.id ? ' ring-4 ring-[#D84315] shadow-[0_0_30px_rgba(216,67,21,0.6)] animate-pulse border-2 border-[#D84315] bg-orange-50/80 scale-[1.02] ' : '')
                          }
                        >

                          {/* Campaign Badge */}

                          <ProductCampaignBadge
                            productStockCode={p.stockCode}
                            productCategory={p.groupCode}
                            productSubCategory={p.subGroupCode}
                            productKod4={p.kod4}
                            productKod5={p.kod5}
                            campaigns={campaigns}
                            priceGroupCode={siparisPriceGroupCode}
                            onClick={() => {
                              setSelectedProductForCampaign({ stockCode: p.stockCode, name: p.name })
                              setCampaignDetailOpen(true)
                            }}
                          />



                          <div
                            onClick={() => {
                              setInspectProductId(p.id)
                              setInspectOpen(true)
                            }}
                            className={(shouldShowComingSoon ? "relative aspect-[4/3] overflow-hidden bg-white" : "relative aspect-[4/3] overflow-hidden bg-slate-900") + " cursor-pointer group"}
                            title="Ürün detayını incele"
                          >
                            <div className="absolute top-3 left-3 z-10">
                              <span className={stockBadgeClass + ' text-[9px] sm:text-[10px] font-black px-2 py-0.5 rounded uppercase tracking-wider shadow-md'}>
                                {stockBadgeText}
                              </span>
                            </div>
                            {shouldShowComingSoon ? (
                              <ShipSailingAnimation size="lg" />
                            ) : p.imageUrl ? (

                              <img src={toAbsoluteMediaUrl(String(p.imageUrl))} alt={p.name} className="w-full h-full object-contain group-hover:scale-110 transition-transform duration-500 p-2 sm:p-6 bg-white" />
                            ) : (

                              <div className="w-full h-full bg-slate-50" />
                            )}

                          </div>



                          <div className="p-3 sm:p-4 flex-1 flex flex-col">

                            <div className="mb-3">

                              <div className="flex justify-between items-start gap-2 mb-1">
                                <span className="text-[9px] sm:text-[10px] font-semibold text-[#D84315] uppercase tracking-widest">{String(p.groupCode ?? 'Ürün')}</span>
                                <div className="text-right">
                                  <div className="text-[9px] sm:text-[11px] font-sans font-bold text-slate-500">{p.stockCode ? `Stok: ${p.stockCode}` : ''}</div>
                                  {p.barcode && <div className="text-[9px] sm:text-[11px] font-sans font-bold text-slate-500 mt-0.5">{`Barkod: ${p.barcode}`}</div>}
                                </div>
                              </div>

                              <div className="font-bold text-xs sm:text-sm text-slate-900 leading-snug group-hover:text-[#D84315] transition-colors line-clamp-3 min-h-[54px] sm:min-h-[60px] flex items-center">{p.name}</div>

                              <div className="text-[10px] sm:text-xs text-slate-500 mt-1.5">{`Depo: ${depotText}  •  Koli: ${boxText}`}</div>
                              <div className="text-[10px] sm:text-xs text-slate-500 mt-0.5">{taxLine}</div>

                            </div>

                            <div className="mt-auto">

                              <div className="mb-2">
                                {kampanyaFiyati && (
                                  <div className="text-[11px] font-semibold text-slate-400 line-through leading-none mb-0.5">{priceText}</div>
                                )}
                                <div className="flex items-baseline gap-1">
                                  <span className={'text-base sm:text-lg font-bold ' + (kampanyaFiyati ? 'text-emerald-700' : (hasPrice ? 'text-slate-900' : 'text-red-600'))}>
                                    {kampanyaFiyati ? kampanyaFiyatText : priceText}
                                  </span>
                                  <span className="text-[10px] sm:text-xs font-medium text-slate-500 uppercase tracking-tighter">{currencyText || 'TRY'}</span>
                                </div>
                                {kampanyaFiyati && (
                                  <div className="text-[10px] font-bold text-emerald-600 leading-none mt-0.5">
                                    {kampanyaFiyati.percent !== null ? `Kampanya %${kampanyaFiyati.percent}` : 'Kampanyalı fiyat'}
                                  </div>
                                )}
                              </div>

                              {isInstallable && (
                                <div className="mb-2 h-8">
                                  <select
                                    value={montaj}
                                    onChange={(e) =>
                                      setDraftMontaj((prev) => ({
                                        ...prev,
                                        [p.id]: e.target.value as CartLine['montaj']
                                      }))
                                    }
                                    className="w-full h-8 px-2 text-[10px] border rounded-lg focus:outline-none focus:ring-2 focus:ring-[#D84315]/15 focus:border-[#D84315]/30 border-slate-200 bg-slate-50 text-slate-800"
                                  >
                                    <option>Montaj istemiyorum.</option>
                                    <option>Montaj istiyorum.</option>
                                  </select>
                                </div>
                              )}

                              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-1.5 sm:gap-2">
                                <div className="flex items-center bg-slate-100 rounded-lg p-0.5 border border-slate-200 justify-between">
                                  <button
                                    type="button"
                                    onClick={() => setDraftQty((prev) => ({ ...prev, [p.id]: Math.max(1, Number((prev as any)[p.id] ?? qty) - 1) }))}
                                    className="w-6 h-6 flex items-center justify-center text-slate-500 hover:text-[#D84315] disabled:opacity-50 disabled:cursor-not-allowed text-xs font-bold"
                                    disabled={blockOutOfStock || comingSoonBlocksOrder}
                                  >
                                    -
                                  </button>

                                  <input
                                    type="number"
                                    min={1}
                                    value={qty}
                                    onChange={(e) => setDraftQty((prev) => ({ ...prev, [p.id]: Number(e.target.value) }))}
                                    className="w-8 sm:w-10 bg-transparent border-none text-center p-0 text-xs font-bold focus:ring-0 disabled:opacity-50"
                                    disabled={blockOutOfStock || comingSoonBlocksOrder}
                                  />

                                  <button
                                    type="button"
                                    onClick={() => setDraftQty((prev) => ({ ...prev, [p.id]: Math.max(1, Number((prev as any)[p.id] ?? qty) + 1) }))}
                                    className="w-6 h-6 flex items-center justify-center text-slate-500 hover:text-[#D84315] disabled:opacity-50 disabled:cursor-not-allowed text-xs font-bold"
                                    disabled={blockOutOfStock || comingSoonBlocksOrder}
                                  >
                                    +
                                  </button>
                                </div>

                                <button
                                  type="button"
                                  onClick={() => addToCart(p.id)}
                                  className={
                                    'flex-1 text-white text-[11px] sm:text-xs font-bold py-1.5 sm:py-2 px-2 rounded-lg flex items-center justify-center gap-1.5 transition-colors shadow-md ' +
                                    (blockOutOfStock || comingSoonBlocksOrder ? 'bg-slate-300 cursor-not-allowed' : 'bg-[#D84315] hover:bg-orange-700 shadow-orange-600/10')
                                  }
                                  disabled={blockOutOfStock || comingSoonBlocksOrder}
                                >
                                  {comingSoonBlocksOrder ? 'Yakında' : 'Sepete Ekle'}
                                </button>
                              </div>

                              <div className="mt-2">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setInspectProductId(p.id)
                                    setInspectOpen(true)
                                  }}
                                  className="w-full px-3 py-2.5 rounded-lg border border-slate-200 bg-white text-slate-700 text-xs font-bold hover:bg-slate-50"
                                >
                                  İncele
                                </button>
                              </div>

                              {montajError && <div className="mt-4 text-sm font-semibold text-red-600">{montajError}</div>}

                            </div>

                          </div>

                        </div>

                      )

                    })}
                </>
              )}

            </div>

          </div>



          <div className="mt-6 flex items-center justify-center gap-2">
            <button
              type="button"
              disabled={productsQuery.page <= 1}
              onClick={() => productsQuery.setPage(productsQuery.page - 1)}
              className={
                'px-3 py-2 text-xs font-semibold rounded border ' +
                (productsQuery.page <= 1
                  ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed'
                  : 'bg-white text-gray-700 border-gray-300')
              }
            >
              Önceki
            </button>
            <div className="text-xs text-gray-600">Sayfa {productsQuery.page}</div>
            <button
              type="button"
              disabled={productsQuery.page * productsQuery.pageSize >= productsQuery.total}
              onClick={() => productsQuery.setPage(productsQuery.page + 1)}
              className={
                'px-3 py-2 text-xs font-semibold rounded border ' +
                (productsQuery.page * productsQuery.pageSize >= productsQuery.total
                  ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed'
                  : 'bg-white text-gray-700 border-gray-300')
              }
            >
              Sonraki
            </button>
          </div>

        </div>



      </div>

      <SiparisCartSection
        dealerCode={selectedBayi}
        dealerLabel={selectedBayiLabel}
        deliveryCustomerCode={selectedBayi}
        deliveryCustomerLabel={selectedBayiLabel}
        priceGroupId={String(customerPriceGroupIdByCode[String(selectedBayi || '')] ?? '').trim() || undefined}
        priceGroupUnknown={priceGroupUnknownCodes.has(String(selectedBayi || '').trim())}
        fabAnchorRef={productSearchRef as any}
        toAbsoluteMediaUrl={toAbsoluteMediaUrl}
        montajDetailsByProductId={montajDetailsByProductId}
        hideCampaignHeader
        canOnlySeePriceGroup4={canOnlySeePriceGroup4}
      />
      <Modal

        isOpen={inspectOpen}

        onClose={() => {

          setInspectOpen(false)

          setInspectProductId(null)

          setInspectMediaIndex(0)

        }}

        title="İncele"

        hideHeader

        scrollable

        overlayClassName="p-2 sm:p-6"

        containerClassName="max-w-6xl w-[96vw]"

      >

        {inspectProduct ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div>
              <div className="w-full aspect-video bg-white border border-slate-200 rounded-xl flex items-center justify-center overflow-hidden">
                {(() => {
                  const isClosedToSale = isClosedToSaleRule(inspectProduct)
                  const isComingSoonFlag = Boolean((inspectProduct as any)?.isComingSoon) || Boolean((inspectProduct as any)?.comingSoon)
                  // Salt görünüm: gemi animasyonu yetkiden bağımsız gösterilir.
                  const shouldShowComingSoon = isComingSoonFlag || (canBsyHComingSoon && isClosedToSale)

                  if (shouldShowComingSoon) {
                    return (
                      <div className="w-full h-full border border-sky-100 rounded-xl overflow-hidden bg-sky-50 shadow-inner">
                        <ShipSailingAnimation size="full" />
                      </div>
                    )
                  }

                  if (inspectMedia && inspectMedia.length > 0) {
                    const activeMedia = inspectMedia[Math.min(inspectMediaIndex, inspectMedia.length - 1)]
                    if (activeMedia?.kind === 'video') {
                      return (
                        <video
                          key={activeMedia.url}
                          src={activeMedia.url}
                          controls
                          className="w-full h-full"
                        />
                      )
                    }
                    return (
                      <img
                        src={activeMedia.url}
                        alt={inspectProduct.name}
                        className="w-full h-full object-contain cursor-pointer hover:opacity-90 transition-opacity"
                        onClick={() => setFullImagePreviewUrl(activeMedia.url)}
                        title="Resmi tam ekranda görüntüle"
                      />
                    )
                  }

                  return <div className="w-full h-full bg-slate-50 flex items-center justify-center text-xs text-gray-400">Görsel yok</div>
                })()}
              </div>

              {inspectMedia.length > 1 && (
                <div className="mt-3 w-full overflow-x-auto">
                  <div className="flex items-center gap-2">
                    {inspectMedia.map((m, idx) => (
                      <button
                        key={m.kind + '::' + m.url + '::' + idx}
                        type="button"
                        onClick={() => setInspectMediaIndex(idx)}
                        className={
                          'w-[72px] h-[54px] rounded-lg border overflow-hidden flex items-center justify-center bg-white shrink-0 ' +
                          (idx === inspectMediaIndex ? 'border-[#D84315]' : 'border-slate-200 hover:border-slate-300')
                        }
                        title={m.kind === 'video' ? 'Video' : 'Görsel'}
                      >
                        {m.kind === 'video' ? (
                          <div className="w-full h-full bg-gray-900/90 flex items-center justify-center text-white text-[11px] font-bold">Video</div>
                        ) : (
                          <img src={m.url} alt="" className="w-full h-full object-cover" />
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="lg:sticky lg:top-2 self-start">
              <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
                <div className="text-sm font-sans font-extrabold italic text-slate-900">{inspectProduct.stockCode ? `Stok Kodu: ${inspectProduct.stockCode}` : ''}</div>
                {inspectProduct.barcode && <div className="mt-0.5 text-sm font-sans font-extrabold italic text-slate-900">{`Barkod: ${inspectProduct.barcode}`}</div>}
                <div className="mt-1 text-2xl font-extrabold text-slate-900 leading-tight">{inspectProduct.name}</div>

                <div className="mt-3 flex items-baseline justify-between gap-3">
                  <div className="text-2xl font-extrabold text-[#D84315]">
                    {(() => {
                      // Kart ile AYNI kural: "TRY" da TL'dir, ham metne bakmak fiyatı
                      // "TRY 2172.41" diye yazdırıyordu.
                      const cur = resolveProductSalesCurrency({
                        currency: visibleProductCurrency(inspectProduct),
                        salesCurrencyCode: visibleProductCurrencyCode(inspectProduct)
                      })
                      const value = Number(visibleProductPrice(inspectProduct) ?? 0)
                      return cur === 'TRY' ? formatMoney(value) : `${cur} ${value.toFixed(2)}`
                    })()}
                  </div>
                  <div className="text-xs font-bold text-slate-600">KDV: %{Number(getEffectiveTaxRate(inspectProduct)).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                </div>

                <div className="mt-3 text-xs font-semibold text-slate-600">
                  Depo: {Number((inspectProduct as any)?.stock ?? 0) > 12 ? '+12' : String(Math.max(0, Math.trunc(Number((inspectProduct as any)?.stock ?? 0))))}
                </div>

                {/* Maintained offer copy: the description paragraph and, below it, the feature list. */}
                {String(inspectDetail?.description ?? '').trim() ? (
                  <div className="mt-3">
                    <div className="text-[11px] font-semibold text-slate-600 mb-1">Açıklama</div>
                    <div className="text-xs text-slate-700 whitespace-pre-line">{String(inspectDetail?.description ?? '')}</div>
                  </div>
                ) : null}

                {(() => {
                  const ozellikler = String(inspectDetail?.features ?? '')
                    .split(String.fromCharCode(10))
                    .map((x) => x.trim())
                    .filter(Boolean)
                  if (ozellikler.length === 0) return null
                  return (
                    <div className="mt-3">
                      <div className="text-[11px] font-semibold text-slate-600 mb-1">Özellikler</div>
                      <ul className="space-y-0.5">
                        {ozellikler.map((o, i) => (
                          <li key={i} className="text-xs text-slate-700 flex gap-1.5">
                            <span className="text-slate-400">•</span>
                            <span>{o}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )
                })()}


                {Boolean((inspectProduct as any)?.isInstallable) ? (
                  <div className="mt-4">
                    <div className="text-[11px] font-semibold text-slate-600 mb-1">Montaj</div>
                    <select
                      value={draftMontaj[inspectProduct.id] ?? 'Montaj istemiyorum.'}
                      onChange={(e) => setDraftMontaj((prev) => ({ ...prev, [inspectProduct.id]: e.target.value as CartLine['montaj'] }))}
                      className="w-full h-10 px-3 text-xs font-bold border border-slate-200 rounded-lg bg-white"
                    >
                      <option>Montaj istemiyorum.</option>
                      <option>Montaj istiyorum.</option>
                    </select>
                  </div>
                ) : null}

                <div className="mt-4">
                  <div className="text-[11px] font-semibold text-slate-600 mb-1">Miktar</div>
                  <div className="flex items-center gap-2">
                    <div className="flex items-center bg-slate-100 rounded-lg p-1 border border-slate-200">
                      <button
                        type="button"
                        onClick={() => setDraftQty((prev) => ({ ...prev, [inspectProduct.id]: Math.max(1, Number((prev as any)[inspectProduct.id] ?? 1) - 1) }))}
                        className="w-8 h-8 flex items-center justify-center text-slate-600 hover:text-[#D84315]"
                        aria-label="Azalt"
                        title="Azalt"
                      >
                        -
                      </button>
                      <input
                        type="number"
                        min={1}
                        value={draftQty[inspectProduct.id] ?? 1}
                        onChange={(e) => setDraftQty((prev) => ({ ...prev, [inspectProduct.id]: Number(e.target.value) }))}
                        className="w-14 bg-transparent border-none text-center p-0 text-sm font-extrabold focus:ring-0"
                      />
                      <button
                        type="button"
                        onClick={() => setDraftQty((prev) => ({ ...prev, [inspectProduct.id]: Math.max(1, Number((prev as any)[inspectProduct.id] ?? 1) + 1) }))}
                        className="w-8 h-8 flex items-center justify-center text-slate-600 hover:text-[#D84315]"
                        aria-label="Arttır"
                        title="Arttır"
                      >
                        +
                      </button>
                    </div>

                    {(() => {
                      const stockNumber = Number((inspectProduct as any)?.stock ?? 0)
                      const bsyFlag = String((inspectProduct as any)?.bsyVisibleFlag ?? 'E').trim().toUpperCase()
                      const isBsyHBelowMinStock = isClosedToSaleRule({ isActive: true, bsyVisibleFlag: bsyFlag, stock: stockNumber, bsyMinStock: (inspectProduct as any)?.bsyMinStock })
                      // Görünüm yetkiden bağımsız; kilidi yalnızca yetki kaldırır.
                      const shouldShowComingSoon = isBsyHBelowMinStock && !canBsyHHide && canBsyHComingSoon
                      const isDisabled =
                        (shouldShowComingSoon && !canOrderOutOfStock) || (stockNumber <= 0 && !canOrderOutOfStock)

                      return (
                        <button
                          type="button"
                          disabled={isDisabled}
                          onClick={() => {
                            addToCart(inspectProduct.id)
                            setInspectOpen(false)
                            setInspectProductId(null)
                          }}
                          className={
                            'flex-1 h-10 text-white text-xs font-extrabold rounded-lg shadow-lg ' +
                            (isDisabled ? 'bg-slate-300 cursor-not-allowed' : 'bg-[#D84315] hover:bg-orange-700 shadow-orange-600/20')
                          }
                        >
                          {shouldShowComingSoon ? 'Gelecek Ürün' : 'Sepete Ekle'}
                        </button>
                      )
                    })()}
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : null}

      </Modal>

      {fullImagePreviewUrl && (
        <Modal
          isOpen={Boolean(fullImagePreviewUrl)}
          onClose={() => setFullImagePreviewUrl(null)}
          title=""
          hideHeader
          scrollable={false}
          overlayClassName="p-2 sm:p-4 z-[300]"
          containerClassName="max-w-5xl w-full bg-slate-950/95 border border-slate-800 p-4 rounded-2xl flex flex-col items-center justify-center relative shadow-2xl"
        >
          <button
            type="button"
            onClick={() => setFullImagePreviewUrl(null)}
            className="absolute top-4 right-4 z-10 p-2.5 rounded-full bg-slate-800/80 hover:bg-slate-700 text-white transition cursor-pointer shadow-lg"
            title="Kapat"
          >
            <X size={22} />
          </button>
          <div className="w-full h-full flex items-center justify-center p-2">
            <img
              src={fullImagePreviewUrl}
              alt="Görsel Detay"
              className="max-w-full max-h-[85vh] object-contain rounded-lg shadow-2xl"
            />
          </div>
        </Modal>
      )}



      {toastMessage && (

        <div className="fixed left-1/2 -translate-x-1/2 bottom-6 z-[60] w-[520px] max-w-[92vw]">

          <div className="bg-green-300/80 text-gray-900 text-sm font-semibold px-6 py-3 rounded shadow-lg border border-green-400">

            {toastMessage}

          </div>

        </div>

      )}

      <Modal

        isOpen={msgOpen}

        onClose={() => setMsgOpen(false)}

        title={msgTitle || 'Bilgi'}

        footer={

          <button

            type="button"

            onClick={() => setMsgOpen(false)}

            className="px-3 py-2 text-xs font-semibold bg-gray-700 text-white rounded hover:bg-gray-800"

          >

            Tamam

          </button>

        }

      >

        <div className="text-xs text-gray-700 whitespace-pre-line">{msgText}</div>

      </Modal>



      {/* Montaj Formu Modalı */}
      <MontajFormModal
        isOpen={montajOpen}
        onClose={() => setMontajOpen(false)}
        onSave={(details) => {
          if (!montajProductId) return
          const qty = Math.max(1, Number(details.miktar || 1))
          const product = productMap.get(montajProductId) || (productsQuery.items || []).find((p) => p.id === montajProductId)
          if (!product) return

          const unitPrice = product.unitPrice === null ? null : Number(product.unitPrice)
          if (unitPrice === null || !Number.isFinite(unitPrice) || unitPrice <= 0) {
            setMontajOpen(false)
            setMsgTitle('Uyarı')
            setMsgText('Fiyat Tanımlı Değil')
            setMsgOpen(true)
            return
          }

          const kdvRate = Number(product.taxRate ?? 0)
          const installationFee = Number((product as any)?.installationFee ?? 0)
          const currency = resolveProductSalesCurrency(product as any)

          if (!checkCurrencyLock(currency)) {
            setMontajOpen(false)
            return
          }

          cart.addLine({
            product: {
              id: montajProductId,
              name: product?.name ?? '',
              stockCode: product?.stockCode ?? '',
              unitPrice,
              kdvRate,
              imageUrl: product.imageUrl ?? null,
              isInstallable: true,
              installationFee: Number.isFinite(installationFee) ? installationFee : 0,
              currency
            },
            dealer: { id: `${selectedBayi}`, label: selectedBayiLabel },
            montaj: 'Montaj istiyorum.',
            montajDetails: details,
            qty
          })
          setMontajDetails((prev) => ({ ...prev, [montajProductId]: details as any }))
          setMontajOpen(false)
          showToast('Ürün sepete eklendi')
        }}
        dealerName={montajForm.bayiAdi || ''}
        productName={montajForm.urunAdi || ''}
        quantity={montajForm.miktar || 1}
        initialValues={montajProductId ? montajDetails[montajProductId] : undefined}
        customerCode={selectedBayi || undefined}
        submitButtonText="Kaydet ve Uygula"
      />

    </div>

  )

}



function PlaceholderView({ title }: { title: string }) {

  const lastOrderId = sessionStorage.getItem('lastOrderId')

  return (

    <div>

      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-gray-900 tracking-tight">{title}</h1>
          <p className="text-xs text-gray-400 mt-0.5">Fatura İşlemleri</p>
        </div>
      </div>

      <div className="bg-white border border-gray-100 rounded-xl shadow-sm px-6 py-10 text-center">

        {lastOrderId && <div className="text-sm font-semibold text-gray-800 mb-2">Sipariş No: {lastOrderId}</div>}

        <div className="text-gray-300 text-2xl mb-1">📝</div>
        <div className="text-xs text-gray-400 font-medium">Bu ekran sonraki adımda birebir yapılacak.</div>

      </div>

    </div>

  )

}



function CampaignListModernView() {

  type Row = {

    id: string

    KAMPANYA_ADI: string

    KAMPANYA_ACIKLAMA: string

    BASLANGIC_TARIH: string

    BITIS_TARIH: string

    KAMPANYA_TIPI: string

    AKTIF: boolean

  }



  type ColumnKey = 'KAMPANYA_ADI' | 'KAMPANYA_ACIKLAMA' | 'BASLANGIC_TARIH' | 'BITIS_TARIH' | 'KAMPANYA_TIPI' | 'AKTIF'

  type SortDir = 'asc' | 'desc'



  const [createOpen, setCreateOpen] = useState(false)

  const [basketDiscountOpen, setBasketDiscountOpen] = useState(false)

  const [basketDiscountDraft, setBasketDiscountDraft] = useState<null | { name: string; description: string; startDate: string; endDate: string }>(null)

  const [basketDiscountEditingId, setBasketDiscountEditingId] = useState<string | null>(null)

  const [basketDiscountInitialForm, setBasketDiscountInitialForm] = useState<any>(null)

  const [qtyTierOpen, setQtyTierOpen] = useState(false)

  const [qtyTierDraft, setQtyTierDraft] = useState<null | { name: string; description: string; startDate: string; endDate: string }>(null)

  const [qtyTierEditingId, setQtyTierEditingId] = useState<string | null>(null)

  const [qtyTierInitialForm, setQtyTierInitialForm] = useState<any>(null)

  const [buyXGetYOpen, setBuyXGetYOpen] = useState(false)

  const [buyXGetYDraft, setBuyXGetYDraft] = useState<null | { name: string; description: string; startDate: string; endDate: string }>(null)

  const [buyXGetYEditingId, setBuyXGetYEditingId] = useState<string | null>(null)

  const [buyXGetYInitialForm, setBuyXGetYInitialForm] = useState<any>(null)

  const [productDiscountOpen, setProductDiscountOpen] = useState(false)

  const [productDiscountDraft, setProductDiscountDraft] = useState<null | { name: string; description: string; startDate: string; endDate: string }>(null)

  const [productDiscountEditingId, setProductDiscountEditingId] = useState<string | null>(null)

  const [productDiscountInitialForm, setProductDiscountInitialForm] = useState<any>(null)

  const [catBrandOpen, setCatBrandOpen] = useState(false)

  const [catBrandDraft, setCatBrandDraft] = useState<null | { name: string; description: string; startDate: string; endDate: string }>(null)

  const [catBrandEditingId, setCatBrandEditingId] = useState<string | null>(null)

  const [catBrandInitialForm, setCatBrandInitialForm] = useState<any>(null)

  const [packageOpen, setPackageOpen] = useState(false)

  const [packageDraft, setPackageDraft] = useState<null | { name: string; description: string; startDate: string; endDate: string }>(null)

  const [packageEditingId, setPackageEditingId] = useState<string | null>(null)

  const [packageInitialForm, setPackageInitialForm] = useState<any>(null)



  const [loading, setLoading] = useState(false)

  const [error, setError] = useState<string | null>(null)



  const [rows, setRows] = useState<Row[]>([])



  const [detailsOpen, setDetailsOpen] = useState(false)

  const [detailsLoading, setDetailsLoading] = useState(false)

  const [detailsError, setDetailsError] = useState<string | null>(null)

  const [details, setDetails] = useState<CampaignDetailsResponse | null>(null)



  const [page, setPage] = useState(1)

  const [pageSize, setPageSize] = useState(20)

  const [total, setTotal] = useState(0)

  const [totalPages, setTotalPages] = useState(1)



  const [deleteCampaignConfirm, setDeleteCampaignConfirm] = useState<{ id: string; name: string } | null>(null)

  const [deleteCampaignLoading, setDeleteCampaignLoading] = useState(false)

  const [deleteCampaignError, setDeleteCampaignError] = useState<string | null>(null)



  const [filterOps, setFilterOps] = useState<Record<ColumnKey, string>>({
    KAMPANYA_ADI: 'contains',
    KAMPANYA_ACIKLAMA: 'contains',
    BASLANGIC_TARIH: 'eq',
    BITIS_TARIH: 'eq',
    KAMPANYA_TIPI: 'contains',
    AKTIF: 'contains'
  })

  const [filters, setFilters] = useState<Record<ColumnKey, { v1: string; v2: string }>>({

    KAMPANYA_ADI: { v1: '', v2: '' },

    KAMPANYA_ACIKLAMA: { v1: '', v2: '' },

    BASLANGIC_TARIH: { v1: '', v2: '' },

    BITIS_TARIH: { v1: '', v2: '' },

    KAMPANYA_TIPI: { v1: '', v2: '' },

    AKTIF: { v1: '', v2: '' }

  })



  const [sort, setSort] = useState<{ key: ColumnKey; dir: SortDir } | null>(null)

  const [menuOpenKey, setMenuOpenKey] = useState<ColumnKey | null>(null)



  const toDateText = (v: any) => {

    const s = String(v ?? '').trim()

    if (!s) return ''

    return s.length >= 10 ? s.slice(0, 10) : s

  }



  const kampanyaTipiLabel = (v: any) => {

    const n = Number(v)

    if (n === 1) return 'Sepet Toplam İndirim'

    if (n === 2) return 'Adet Bazlı Kademeli İndirim'

    if (n === 3) return 'X Alana Y Hediye / İndirimli Ürün'

    if (n === 4) return 'Seçili Ürün İndirimi'

    if (n === 5) return 'Kategori-Marka Bazlı İndirim'

    if (n === 6) return 'Paket Kampanya'

    return String(v ?? '').trim()

  }



  const load = async () => {

    try {

      setLoading(true)

      setError(null)



      const typeFilterText = String(filters.KAMPANYA_TIPI.v1 ?? '').trim().toLowerCase()

      const typeToCode = () => {

        if (!typeFilterText) return ''

        const asNum = Number(typeFilterText)

        if (Number.isFinite(asNum) && asNum > 0) return String(asNum)

        if (typeFilterText.includes('sepet')) return '1'

        if (typeFilterText.includes('kademeli') || typeFilterText.includes('adet')) return '2'

        if (typeFilterText.includes('x alana') || typeFilterText.includes('hediye') || typeFilterText.includes('indirimli')) return '3'

        if (typeFilterText.includes('seçili') || typeFilterText.includes('urun') || typeFilterText.includes('ürün')) return '4'

        if (typeFilterText.includes('kategori') || typeFilterText.includes('marka')) return '5'

        if (typeFilterText.includes('paket')) return '6'

        return ''

      }



      const mapSortKey = (key: ColumnKey) => {

        if (key === 'KAMPANYA_ADI') return 'name'

        if (key === 'KAMPANYA_ACIKLAMA') return 'description'

        if (key === 'BASLANGIC_TARIH') return 'startDate'

        if (key === 'BITIS_TARIH') return 'endDate'

        if (key === 'KAMPANYA_TIPI') return 'kampanyaTipi'

        if (key === 'AKTIF') return 'isActive'

        return 'createTime'

      }



      const res = await fetchCampaigns({

        page,

        pageSize,

        name: filters.KAMPANYA_ADI.v1,

        description: filters.KAMPANYA_ACIKLAMA.v1,

        startDate: filters.BASLANGIC_TARIH.v1,

        endDate: filters.BITIS_TARIH.v1,

        kampanyaTipi: typeToCode(),

        isActive: filters.AKTIF.v1,

        sort: sort ? mapSortKey(sort.key) : 'createTime',

        dir: sort?.dir ?? 'desc'

      })



      setTotal(res.total)

      setTotalPages(res.totalPages)

      setPage(res.page)

      setPageSize(res.pageSize)



      const mapped = (res.items ?? []).map((x: any) => {

        return {

          id: String(x.id ?? ''),

          KAMPANYA_ADI: String(x.name ?? ''),

          KAMPANYA_ACIKLAMA: String(x.description ?? ''),

          BASLANGIC_TARIH: toDateText(x.startDate),

          BITIS_TARIH: toDateText(x.endDate),

          KAMPANYA_TIPI: kampanyaTipiLabel(x.kampanyaTipi),

          AKTIF: Boolean(x.isActive)

        } as Row

      })

      setRows(mapped)

    } catch (e: any) {

      setRows([])

      setError(String(e?.message ?? 'Kampanyalar alınamadı'))

    } finally {

      setLoading(false)

    }

  }



  useEffect(() => {

    void load()

  }, [page, pageSize, sort])



  const confirmDeleteCampaign = async () => {

    if (!deleteCampaignConfirm?.id) return

    try {

      setDeleteCampaignLoading(true)

      setDeleteCampaignError(null)

      await softDeleteCampaign(deleteCampaignConfirm.id)

      setDeleteCampaignConfirm(null)

      await load()

    } catch (e: any) {

      setDeleteCampaignError(String(e?.message ?? 'Kampanya silinemedi'))

    } finally {

      setDeleteCampaignLoading(false)

    }

  }



  const norm = (v: any) => String(v ?? '').trim().toLowerCase()

  const match = (value: string, q: string) => {

    const v = norm(value)

    const n = norm(q)

    if (!n) return true

    return v.includes(n)

  }



  const matchBool = (value: boolean, q: string) => {

    const n = norm(q)

    if (!n) return true

    if (['evet', 'e', 'true', '1', 'aktif'].includes(n)) return value === true

    if (['hayir', 'h', 'false', '0', 'pasif'].includes(n)) return value === false

    return true

  }



  const normalizeDateValue = (value: string) => {
    const raw = String(value ?? '').trim()
    if (!raw) return ''
    const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/)
    if (iso) return `${iso[1]}${iso[2]}${iso[3]}`
    const dotted = raw.match(/^(\d{2})\.(\d{2})\.(\d{4})$/)
    if (dotted) return `${dotted[3]}${dotted[2]}${dotted[1]}`
    return raw
  }

  const visibleRows = useMemo(() => {
    const active = (Object.keys(filters) as ColumnKey[]).filter((k) => {
      const f = filters[k]
      const op = String(filterOps[k] ?? (k === 'BASLANGIC_TARIH' || k === 'BITIS_TARIH' ? 'eq' : 'contains'))
      return String(f?.v1 ?? '').trim().length > 0 || (op === 'between' && String(f?.v2 ?? '').trim().length > 0)
    })

    if (active.length === 0) return rows

    return rows.filter((r) => {
      for (const k of active) {
        const op = String(filterOps[k] ?? (k === 'BASLANGIC_TARIH' || k === 'BITIS_TARIH' ? 'eq' : 'contains'))
        const v1 = String(filters[k]?.v1 ?? '').trim()
        const v2 = String(filters[k]?.v2 ?? '').trim()

        const cellRaw = String((r as any)[k] ?? '')

        if (k === 'BASLANGIC_TARIH' || k === 'BITIS_TARIH') {
          const cell = normalizeDateValue(cellRaw.slice(0, 10))
          const q1 = normalizeDateValue(v1)
          const q2 = normalizeDateValue(v2)
          if (!cell) return false

          const cellNum = Number(cell)
          const q1Num = q1 ? Number(q1) : NaN
          const q2Num = q2 ? Number(q2) : NaN

          if (op === 'between') {
            if (!q1 || !q2) return false
            const a = Math.min(q1Num, q2Num)
            const b = Math.max(q1Num, q2Num)
            if (!(cellNum >= a && cellNum <= b)) return false
            continue
          }

          if (!q1) return false
          if (op === 'eq' && cellNum !== q1Num) return false
          if (op === 'neq' && cellNum === q1Num) return false
          if (op === 'lt' && !(cellNum < q1Num)) return false
          if (op === 'gt' && !(cellNum > q1Num)) return false
          if (op === 'lte' && !(cellNum <= q1Num)) return false
          if (op === 'gte' && !(cellNum >= q1Num)) return false
          continue
        }

        const cell = cellRaw.trim().toLowerCase()
        const q = v1.toLowerCase()
        if (op === 'contains' && !cell.includes(q)) return false
        if (op === 'not_contains' && cell.includes(q)) return false
        if (op === 'starts_with' && !cell.startsWith(q)) return false
        if (op === 'ends_with' && !cell.endsWith(q)) return false
        if (op === 'eq' && cell !== q) return false
        if (op === 'neq' && cell === q) return false
      }
      return true
    })
  }, [filterOps, filters, rows])



  const setFilterV1 = (key: ColumnKey, v1: string) => {
    setFilters((prev) => ({ ...prev, [key]: { ...prev[key], v1 } }))

    setPage(1)

  }

  const setFilterV2 = (key: ColumnKey, v2: string) => {
    setFilters((prev) => ({ ...prev, [key]: { ...prev[key], v2 } }))
    setPage(1)
  }



  useEffect(() => {

    const t = window.setTimeout(() => {

      void load()

    }, 250)

    return () => window.clearTimeout(t)

  }, [filters])



  const pageButtons = useMemo(() => {

    const cur = page

    const last = totalPages

    const out: Array<number | '...'> = []

    const push = (v: number | '...') => {

      if (out.length === 0 || out[out.length - 1] !== v) out.push(v)

    }

    const windowSize = 2

    const start = Math.max(2, cur - windowSize)

    const end = Math.min(last - 1, cur + windowSize)



    push(1)

    if (start > 2) push('...')

    for (let p = start; p <= end; p++) push(p)

    if (end < last - 1) push('...')

    if (last > 1) push(last)

    return out

  }, [page, totalPages])



  const toggleAktif = (id: string) => {

    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, AKTIF: !r.AKTIF } : r)))

  }



  const openDetails = async (id: string) => {

    try {

      setDetailsOpen(true)

      setDetailsLoading(true)

      setDetailsError(null)

      setDetails(null)



      const data = await fetchCampaignById(id)

      setDetails(data)

    } catch (e: any) {

      setDetailsError(String(e?.message ?? 'Detay alınamadı'))

    } finally {

      setDetailsLoading(false)

    }

  }



  function extractSelectedPriceGroups(d: any) {

    // Sunucunun alt tablosu (priceGroupCodes) varsa o esas — 7 = ASKERİYE gibi 6 üstü gruplar
    // yalnız orada (2026-09-21). Eski kolonlardan türetmek düzenlemede 7'yi sessizce düşürürdü.
    if (Array.isArray(d?.priceGroupCodes) && d.priceGroupCodes.length > 0) {
      return d.priceGroupCodes.map((x: unknown) => Number(x)).filter((n: number) => Number.isFinite(n) && n > 0)
    }

    const out: number[] = []

    if (d?.iskontoFiyat1 != null) out.push(1)

    if (d?.iskontoFiyat2 != null) out.push(2)

    if (d?.iskontoFiyat3 != null) out.push(3)

    if (d?.iskontoFiyat4 != null) out.push(4)

    if (d?.iskontoFiyat5 != null) out.push(5)

    if (d?.iskontoFiyat6 != null) out.push(6)

    return out

  }



  const normalizeIskontoKind = (v: any) => {

    const n = Number(v)

    if (n === 1) return 'Tutar'

    if (n === 2) return 'Oran'



    const s = String(v ?? '').trim().toLowerCase()

    if (s === 'tutar') return 'Tutar'

    if (s === 'oran') return 'Oran'

    return null

  }



  const resolveKampanyaTipiCode = (v: any) => {

    const n = Number(v)

    if (Number.isFinite(n) && n > 0) return n



    const s = String(v ?? '').trim().toLowerCase()

    if (!s) return 0

    if (s.includes('kategorimarka') || (s.includes('kategori') && s.includes('marka'))) return 5

    if (s.includes('paket')) return 6

    if (s.includes('sepet')) return 1

    if (s.includes('kademeli') || s.includes('adet')) return 2

    if (s.includes('xal') || s.includes('x al') || s.includes('hediye')) return 3

    if (s.includes('urun') || s.includes('ürün')) return 4

    return 0

  }



  const openEdit = async (id: string) => {

    try {

      setError(null)

      const data = await fetchCampaignById(id)



      const tip = resolveKampanyaTipiCode((data as any)?.kampanyaTipi)

      const name = String((data as any)?.name ?? '')

      const description = String((data as any)?.description ?? '')

      const startDate = toDateText((data as any)?.startDate)

      const endDate = toDateText((data as any)?.endDate)



      if (tip === 1) {

        const cond = ((data as any)?.conditions ?? [])[0]

        const disc = ((data as any)?.discounts ?? [])[0]



        const groupCode = String(cond?.categoryCode ?? disc?.grupKodu ?? '').trim()

        const productStockCodes = ((cond?.productStockCodes ?? []) as any[]).map((x) => String(x ?? '').trim()).filter(Boolean)

        const minBasketTotalText = String(disc?.minSepetTutari ?? '')

        const discountKind = normalizeIskontoKind(disc?.iskontoTipi)

        const discountValueText = String(disc?.deger ?? '')

        const selectedPriceGroupCodes = extractSelectedPriceGroups(disc)



        setBasketDiscountInitialForm({

          name,

          description,

          startDate,

          endDate,

          groupCode,

          productStockCodes,

          minBasketTotalText,

          discountKind,

          discountValueText,

          selectedPriceGroupCodes

        })

        setBasketDiscountEditingId(id)

        setBasketDiscountDraft(null)

        setBasketDiscountOpen(true)

        return

      }



      if (tip === 4) {

        const cond = ((data as any)?.conditions ?? [])[0]

        const disc = ((data as any)?.discounts ?? [])[0]



        const groupCode = String(cond?.categoryCode ?? disc?.grupKodu ?? '').trim()

        const productStockCodes = ((cond?.productStockCodes ?? []) as any[]).map((x) => String(x ?? '').trim()).filter(Boolean)

        const discountKind = normalizeIskontoKind(disc?.iskontoTipi)

        const discountValueText = String(disc?.deger ?? '')

        const selectedPriceGroupCodes = extractSelectedPriceGroups(disc)

        // Ürüne özel kampanyalı fiyat (2026-10-07): hedef fiyatlı satırlar listeye döner;
        // verilmezse pencere eski modda boş kategoriyle açılır (CampaignsPage ile aynı eşleme).
        const targetItems = (((data as any)?.discounts ?? []) as any[])
          .filter((d) => d?.hedefFiyat != null && String(d?.stokKodu ?? '').trim())
          .map((d) => ({
            stockCode: String(d.stokKodu).trim(),
            productId: d.targetProductId ?? null,
            targetPrice: Number(d.hedefFiyat)
          }))



        setProductDiscountInitialForm({

          name,

          description,

          startDate,

          endDate,

          groupCode,

          productStockCodes,

          discountKind,

          discountValueText,

          selectedPriceGroupCodes,

          targetItems

        })

        setProductDiscountEditingId(id)

        setProductDiscountDraft(null)

        setProductDiscountOpen(true)

        return

      }



      if (tip === 2) {

        const conditions = (((data as any)?.conditions ?? []) as any[]).slice()

        const discounts = (((data as any)?.discounts ?? []) as any[]).slice()

        const cond0 = conditions[0] ?? {}

        const selectedGroupCode = String(((cond0?.groupCodes ?? [])[0] ?? cond0?.categoryCode ?? '') as any).trim()

        const selectedStockCodes = ((cond0?.productStockCodes ?? []) as any[]).map((x) => String(x ?? '').trim()).filter(Boolean)



        const tiers = conditions.map((c: any, idx: number) => {

          const d = discounts[idx] ?? {}

          return {

            minQuantityText: String(c?.minimum ?? ''),

            maxQuantityText: c?.maximum == null ? '' : String(c.maximum),

            discountKind: (normalizeIskontoKind(d?.iskontoTipi) ?? 'Oran') as any,

            discountValueText: String(d?.deger ?? ''),

            priceGroupCodes: extractSelectedPriceGroups(d)

          }

        })



        setQtyTierInitialForm({

          name,

          description,

          startDate,

          endDate,

          selectedGroupCode,

          selectedStockCodes,

          tiers

        })

        setQtyTierEditingId(id)

        setQtyTierDraft(null)

        setQtyTierOpen(true)

        return

      }



      if (tip === 3) {

        const cond = ((data as any)?.conditions ?? [])[0]

        const actions = (((data as any)?.actions ?? []) as any[]).slice()

        const discounts = (((data as any)?.discounts ?? []) as any[]).slice()



        const triggerGroupCode = String(cond?.categoryCode ?? '').trim()

        const triggerStockCodes = ((cond?.productStockCodes ?? []) as any[]).map((x) => String(x ?? '').trim()).filter(Boolean)

        const triggerMinQtyText = String(cond?.minimum ?? '1')



        const productIds: string[] = []

        for (const a of actions) {

          if (a?.targetProductId) productIds.push(String(a.targetProductId))

        }

        for (const d of discounts) {

          if (d?.targetProductId) productIds.push(String(d.targetProductId))

        }



        const distinctIds = Array.from(new Set(productIds.filter(Boolean)))

        const idToGroup: Record<string, string> = {}

        if (distinctIds.length > 0) {

          const res = await fetchProducts({ ids: distinctIds.join(','), page: 1, pageSize: 200, includeDealer: true })

            ; (res.items ?? []).forEach((p: any) => {

              const pid = String(p?.id ?? '').trim()

              const g = String(p?.groupCode ?? '').trim()

              if (pid) idToGroup[pid] = g

            })

        }



        const rewardLines: any[] = []



        for (const a of actions) {

          const pid = String(a?.targetProductId ?? '').trim()

          if (!pid) continue

          rewardLines.push({

            targetGroupCode: idToGroup[pid] ?? '',

            targetProductId: pid,

            quantityText: String(a?.quantity ?? 1),

            mode: 'gift',

            discountKind: 'Oran',

            discountValueText: '',

            priceGroupCodes: []

          })

        }



        for (const d of discounts) {

          const pid = String(d?.targetProductId ?? '').trim()

          if (!pid) continue

          rewardLines.push({

            targetGroupCode: idToGroup[pid] ?? '',

            targetProductId: pid,

            quantityText: '1',

            mode: 'discount',

            discountKind: (normalizeIskontoKind(d?.iskontoTipi) ?? 'Oran') as any,

            discountValueText: String(d?.deger ?? ''),

            priceGroupCodes: extractSelectedPriceGroups(d)

          })

        }



        setBuyXGetYInitialForm({

          name,

          description,

          startDate,

          endDate,

          triggerGroupCode,

          triggerStockCodes,

          triggerMinQtyText,

          rewardLines

        })

        setBuyXGetYEditingId(id)

        setBuyXGetYDraft(null)

        setBuyXGetYOpen(true)

        return

      }



      if (tip === 5) {

        const cond = ((data as any)?.conditions ?? [])[0]

        const disc = ((data as any)?.discounts ?? [])[0]



        const categoryCode = String(cond?.categoryCode ?? '').trim()

        const brandField = (String(cond?.brandField ?? '').trim() || null) as any

        const brandCode = String(cond?.brandCode ?? '').trim()

        const discountKind = (normalizeIskontoKind(disc?.iskontoTipi) || null) as any

        const discountValueText = String(disc?.deger ?? '')

        const selectedPriceGroupCodes = extractSelectedPriceGroups(disc)



        setCatBrandInitialForm({

          name,

          description,

          startDate,

          endDate,

          categoryCode,

          brandField,

          brandCode,

          discountKind,

          discountValueText,

          selectedPriceGroupCodes

        })

        setCatBrandEditingId(id)

        setCatBrandDraft(null)

        setCatBrandOpen(true)

        return

      }



      if (tip === 6) {

        const cond = ((data as any)?.conditions ?? []).find((x: any) => x?.packageItemsJson) ?? ((data as any)?.conditions ?? [])[0]

        const disc = ((data as any)?.discounts ?? [])[0]



        const pkg = parsePackageItems(cond?.packageItemsJson)

        const stockCodes = pkg.map((p: any) => String(p.stockCode ?? '').trim()).filter(Boolean)

        const groupCodeByStock: Record<string, string> = {}

        if (stockCodes.length > 0) {

          const results = await Promise.all(

            stockCodes.map(async (sc: string) => {

              try {

                const r = await fetchProducts({ q: sc, page: 1, pageSize: 20, includeDealer: true })

                const exact = (r.items ?? []).find((x: any) => String(x?.stockCode ?? '').trim().toLowerCase() === sc.toLowerCase())

                return { stockCode: sc, groupCode: String((exact as any)?.groupCode ?? '').trim() }

              } catch {

                return { stockCode: sc, groupCode: '' }

              }

            })

          )

          results.forEach((x) => {

            if (x.stockCode) groupCodeByStock[x.stockCode] = x.groupCode

          })

        }



        const items = pkg.map((p: any) => {

          const sc = String(p.stockCode ?? '').trim()

          return { groupCode: groupCodeByStock[sc] ?? '', stockCode: sc, quantity: Number(p.quantity ?? 1) }

        })

        const operationKind = (normalizeIskontoKind(disc?.iskontoTipi) || null) as any

        const operationValueText = String(disc?.deger ?? '')

        const selectedPriceGroupCodes = extractSelectedPriceGroups(disc)



        setPackageInitialForm({

          name,

          description,

          startDate,

          endDate,

          items,

          operationKind,

          operationValueText,

          selectedPriceGroupCodes

        })

        setPackageEditingId(id)

        setPackageDraft(null)

        setPackageOpen(true)

        return

      }



      setError('Bu kampanya tipi için düzenleme henüz desteklenmiyor.')

    } catch (e: any) {

      setError(String(e?.message ?? 'Kampanya düzenleme verisi alınamadı'))

    }

  }



  const parsePackageItems = (jsonText: string | null | undefined) => {

    const raw = String(jsonText ?? '').trim()

    if (!raw) return [] as Array<{ stockCode: string; quantity: number }>

    try {

      const arr = JSON.parse(raw)

      if (!Array.isArray(arr)) return []

      return arr

        .map((x: any) => ({ stockCode: String(x?.stockCode ?? x?.stokKodu ?? '').trim(), quantity: Number(x?.quantity ?? x?.adet ?? 0) }))

        .filter((x: any) => x.stockCode)

    } catch {

      return []

    }

  }



  const discountTypeLabel = (v: any) => {

    const s = String(v ?? '').trim().toLowerCase()

    if (s === 'tutar' || s === '1') return 'Tutar'

    if (s === 'oran' || s === '2') return 'Oran'

    return String(v ?? '').trim()

  }



  const conditionTypeLabel = (v: any) => {

    const n = Number(v)

    if (n === 1) return 'Minimum Adet'

    if (n === 2) return 'Minimum Tutar'

    if (n === 3) return 'Kategori Bazlı'

    if (n === 4) return 'Ürün Bazlı'

    if (n === 5) return 'Müşteri Grubu Bazlı'

    if (n === 6) return 'Paket Ürünleri'

    return String(v ?? '').trim()

  }



  const actionTypeLabel = (v: any) => {

    const n = Number(v)

    if (n === 1) return 'Oransal İndirim'

    if (n === 2) return 'Tutar İndirim'

    if (n === 3) return 'Hediye Ürün'

    if (n === 4) return 'Ücretsiz Kargo'

    if (n === 5) return 'Fiyat Grubu Değiştir'

    const s = String(v ?? '').trim().toLowerCase()

    if (s.includes('percentage')) return 'Oransal İndirim'

    if (s.includes('fixed')) return 'Tutar İndirim'

    if (s.includes('gift')) return 'Hediye Ürün'

    if (s.includes('free')) return 'Ücretsiz Kargo'

    if (s.includes('pricegroup')) return 'Fiyat Grubu Değiştir'

    return String(v ?? '').trim()

  }



  const targetTypeLabel = (v: any) => {

    const n = Number(v)

    if (n === 1) return 'Tüm Müşteriler'

    if (n === 2) return 'Belirli Müşteri'

    if (n === 3) return 'Bölge'

    if (n === 4) return 'Müşteri Fiyat Grubu'

    return String(v ?? '').trim()

  }



  const fmtDiscountValue = (kind: any, value: any) => {

    const t = discountTypeLabel(kind)

    const n = Number(value ?? 0)

    if (t === 'Oran') return `%${n}`

    if (t === 'Tutar') return `${n} TL`

    return String(value ?? '')

  }



  const priceGroupsLabel = (d: any) => {

    if (Array.isArray(d?.priceGroupCodes) && d.priceGroupCodes.length > 0) {
      return d.priceGroupCodes.map((x: unknown) => Number(x)).filter((n: number) => Number.isFinite(n) && n > 0).join(', ') || '-'
    }

    const out: number[] = []

    if (d?.iskontoFiyat1 != null) out.push(1)

    if (d?.iskontoFiyat2 != null) out.push(2)

    if (d?.iskontoFiyat3 != null) out.push(3)

    if (d?.iskontoFiyat4 != null) out.push(4)

    if (d?.iskontoFiyat5 != null) out.push(5)

    if (d?.iskontoFiyat6 != null) out.push(6)

    return out.length ? out.join(', ') : '-'

  }



  return (

    <div>

      <div className="flex items-start justify-between gap-4 mb-4">

        <div className="text-2xl font-extrabold text-gray-900">Kampanya Listesi</div>

        <button

          type="button"

          className="bg-green-600 hover:bg-green-700 text-white text-xs font-semibold px-4 py-2 rounded shadow"

          onClick={() => setCreateOpen(true)}

        >

          Kampanya Ekle

        </button>

      </div>



      {error && <div className="mb-3 text-sm font-semibold text-red-600">{error}</div>}

      {loading && <div className="mb-3 text-sm text-gray-500">Yükleniyor...</div>}



      <div className="bg-white rounded-lg shadow-md overflow-hidden border border-gray-200">

        <table className="w-full table-fixed">

          <colgroup>

            <col style={{ width: '18%' }} />

            <col style={{ width: '16%' }} />

            <col style={{ width: '12%' }} />

            <col style={{ width: '12%' }} />

            <col style={{ width: '14%' }} />

            <col style={{ width: '8%' }} />

            <col style={{ width: '20%' }} />

          </colgroup>

          <thead>

            <tr className="bg-gray-100 border-b border-gray-300">

              {(

                [

                  { key: 'KAMPANYA_ADI', label: 'Kampanya Adı' },

                  { key: 'KAMPANYA_ACIKLAMA', label: 'Açıklama' },

                  { key: 'BASLANGIC_TARIH', label: 'Başlangıç Tarihi' },

                  { key: 'BITIS_TARIH', label: 'Bitiş Tarihi' },

                  { key: 'KAMPANYA_TIPI', label: 'Kampanya Tipi' },

                  { key: 'AKTIF', label: 'Aktif' }

                ] as Array<{ key: ColumnKey; label: string }>

              ).map((c) => (

                <th

                  key={c.key}

                  className="px-3 py-3 text-center text-xs font-semibold text-gray-700 uppercase tracking-wide"

                >

                  <div className="flex items-center justify-center gap-2">

                    <button

                      type="button"

                      className="inline-flex items-center justify-center gap-1"

                      onClick={() => {

                        setSort((prev) => {

                          if (!prev || prev.key !== c.key) return { key: c.key, dir: 'asc' }

                          return { key: c.key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }

                        })

                      }}

                      title="Sırala"

                    >

                      {c.label}

                      <ArrowUpDown size={12} className="text-gray-500" />

                    </button>



                    <div className="relative">

                      <button

                        type="button"

                        className={

                          'inline-flex items-center justify-center w-7 h-7 rounded border ' +

                          (menuOpenKey === c.key ? 'border-blue-300 bg-blue-50' : 'border-gray-200 bg-white')

                        }

                        onClick={() => setMenuOpenKey((prev) => (prev === c.key ? null : c.key))}

                        title="Filtre"

                      >

                        <Filter size={14} className="text-gray-600" />

                      </button>



                      {menuOpenKey === c.key && (

                        <div className="absolute right-0 mt-2 w-56 bg-white border border-gray-200 rounded-lg shadow-lg z-30 p-2">

                          <div className="text-[11px] font-semibold text-gray-500 uppercase px-2 py-1">Sıralama</div>

                          <button

                            type="button"

                            className="w-full text-left px-2 py-2 text-xs hover:bg-gray-50 rounded"

                            onClick={() => {

                              setSort({ key: c.key, dir: 'asc' })

                              setMenuOpenKey(null)

                            }}

                          >

                            A-Z

                          </button>

                          <button

                            type="button"

                            className="w-full text-left px-2 py-2 text-xs hover:bg-gray-50 rounded"

                            onClick={() => {

                              setSort({ key: c.key, dir: 'desc' })

                              setMenuOpenKey(null)

                            }}

                          >

                            Z-A

                          </button>

                        </div>

                      )}

                    </div>

                  </div>

                </th>

              ))}



              <th className="px-3 py-3 text-center text-xs font-semibold text-gray-700 uppercase tracking-wide">İşlemler</th>

            </tr>



            <tr className="bg-white border-b border-gray-200">

              {(

                [

                  { key: 'KAMPANYA_ADI', placeholder: 'Ara...' },

                  { key: 'KAMPANYA_ACIKLAMA', placeholder: 'Ara...' },

                  { key: 'BASLANGIC_TARIH', placeholder: 'YYYY-AA-GG' },

                  { key: 'BITIS_TARIH', placeholder: 'YYYY-AA-GG' },

                  { key: 'KAMPANYA_TIPI', placeholder: 'Ara...' },

                  { key: 'AKTIF', placeholder: 'Evet/Hayır' }

                ] as Array<{ key: ColumnKey; placeholder: string }>

              ).map((c) => (

                <th key={c.key} className="px-2 py-2">
                  <ColumnFilterSearchBar
                    kind={c.key === 'BASLANGIC_TARIH' || c.key === 'BITIS_TARIH' ? 'date' : 'text'}
                    op={String(filterOps[c.key] ?? (c.key === 'BASLANGIC_TARIH' || c.key === 'BITIS_TARIH' ? 'eq' : 'contains'))}
                    v1={String(filters[c.key]?.v1 ?? '')}
                    v2={String(filters[c.key]?.v2 ?? '')}
                    onOpChange={(nextOp: string) => {
                      setFilterOps((p) => ({ ...p, [c.key]: nextOp }))
                      setFilters((p) => {
                        const prev = p[c.key] ?? { v1: '', v2: '' }
                        return { ...p, [c.key]: { v1: prev.v1, v2: nextOp === 'between' ? prev.v2 : '' } }
                      })
                      setPage(1)
                    }}
                    onChangeV1={(v: string) => setFilterV1(c.key, v)}
                    onChangeV2={(v: string) => setFilterV2(c.key, v)}
                    onClear={() => {
                      setFilterOps((p) => ({ ...p, [c.key]: c.key === 'BASLANGIC_TARIH' || c.key === 'BITIS_TARIH' ? 'eq' : 'contains' }))
                      setFilters((p) => ({ ...p, [c.key]: { v1: '', v2: '' } }))
                      setPage(1)
                    }}
                  />
                </th>

              ))}

              <th className="px-2 py-2">

                <div className="text-[11px] text-gray-400 text-center">-</div>

              </th>

            </tr>

          </thead>



          <tbody>

            {visibleRows.map((r, idx) => (

              <tr

                key={r.id}

                className={

                  'border-b border-gray-200 hover:bg-gray-50 transition-colors ' + (idx % 2 === 1 ? 'bg-gray-50/50' : 'bg-white')

                }

              >

                <td className="px-3 py-3 text-sm text-gray-800 text-center truncate">{r.KAMPANYA_ADI}</td>

                <td className="px-3 py-3 text-sm text-gray-800 text-center truncate">{r.KAMPANYA_ACIKLAMA || '-'}</td>

                <td className="px-3 py-3 text-sm text-gray-800 text-center">{r.BASLANGIC_TARIH}</td>

                <td className="px-3 py-3 text-sm text-gray-800 text-center">{r.BITIS_TARIH}</td>

                <td className="px-3 py-3 text-sm text-gray-800 text-center truncate">{r.KAMPANYA_TIPI || '-'}</td>

                <td className="px-3 py-3 text-sm text-gray-800 text-center">

                  <input type="checkbox" checked={r.AKTIF} onChange={() => toggleAktif(r.id)} className="h-4 w-4" />

                </td>

                <td className="px-3 py-3 text-sm text-gray-800">

                  <div className="flex items-center justify-center gap-2 flex-wrap">

                    <button

                      type="button"

                      className="inline-flex items-center gap-1 px-3 py-2 text-xs font-semibold bg-gray-100 text-gray-800 rounded hover:bg-gray-200"

                      onClick={() => void openDetails(r.id)}

                    >

                      Detay

                    </button>

                    <button

                      type="button"

                      className="inline-flex items-center gap-1 px-3 py-2 text-xs font-semibold bg-blue-50 text-blue-700 rounded hover:bg-blue-100"

                      onClick={() => void openEdit(r.id)}

                    >

                      Düzenle

                    </button>

                    <button

                      type="button"

                      className="inline-flex items-center gap-1 px-3 py-2 text-xs font-semibold bg-red-50 text-red-700 rounded hover:bg-red-100"

                      onClick={() => setDeleteCampaignConfirm({ id: r.id, name: String(r.KAMPANYA_ADI ?? '').trim() })}

                    >

                      Sil

                    </button>

                  </div>

                </td>

              </tr>

            ))}



            {visibleRows.length === 0 && (

              <tr>

                <td colSpan={7} className="px-6 py-10 text-center text-sm text-gray-500">

                  Kriterlere uygun kayıt bulunamadı.

                </td>

              </tr>

            )}

          </tbody>

        </table>

      </div>



      {deleteCampaignConfirm != null && (

        <div className="fixed inset-0 z-[80] bg-black/40 flex items-center justify-center p-6">

          <div className="bg-white w-full max-w-md rounded-lg shadow-2xl border border-gray-200 p-8 text-center">

            <div className="mx-auto w-14 h-14 rounded-full border-4 border-yellow-400 flex items-center justify-center text-yellow-500 text-3xl font-extrabold">

              !

            </div>

            <div className="mt-5 text-lg font-semibold text-gray-900">Kampanya silinsin mi?</div>

            <div className="mt-3 text-sm text-gray-700">

              <span className="font-semibold text-gray-900">{deleteCampaignConfirm?.name || '-'}</span> kampanyasını silmek istediğinize emin misiniz?

            </div>



            {deleteCampaignError && <div className="mt-3 text-sm font-semibold text-red-600">{deleteCampaignError}</div>}



            <div className="mt-6 flex items-center justify-center gap-4">

              <button

                type="button"

                className="px-6 py-2 text-sm font-semibold bg-pink-600 text-white rounded hover:bg-pink-700 disabled:bg-gray-200 disabled:text-gray-500"

                disabled={deleteCampaignLoading}

                onClick={() => void confirmDeleteCampaign()}

              >

                Evet

              </button>

              <button

                type="button"

                className="px-6 py-2 text-sm font-semibold bg-green-500 text-white rounded hover:bg-green-600 disabled:bg-gray-200 disabled:text-gray-500"

                disabled={deleteCampaignLoading}

                onClick={() => {

                  setDeleteCampaignConfirm(null)

                  setDeleteCampaignError(null)

                }}

              >

                Hayır

              </button>

            </div>

          </div>

        </div>

      )}



      <div className="mt-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">

        <div className="text-xs text-gray-500">

          Toplam: <span className="font-semibold text-gray-700">{total}</span>

        </div>



        <div className="flex items-center gap-3">

          <div className="flex items-center gap-2">

            <div className="text-xs text-gray-600">Sayfa başına</div>

            <select

              className="input-base h-9 text-xs"

              value={String(pageSize)}

              onChange={(e) => {

                setPageSize(Number(e.target.value) || 20)

                setPage(1)

              }}

            >

              {[10, 20, 50, 100].map((n) => (

                <option key={n} value={String(n)}>

                  {n}

                </option>

              ))}

            </select>

          </div>



          <div className="flex items-center gap-1">

            <button

              type="button"

              disabled={page <= 1}

              onClick={() => setPage((p) => Math.max(1, p - 1))}

              className={

                'px-3 py-2 text-xs font-semibold rounded border ' +

                (page <= 1 ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed' : 'bg-white text-gray-700 border-gray-300')

              }

            >

              Geri

            </button>



            {pageButtons.map((p, idx) =>

              p === '...' ? (

                <div key={`e_${idx}`} className="px-2 text-xs text-gray-400">

                  ...

                </div>

              ) : (

                <button

                  key={p}

                  type="button"

                  onClick={() => setPage(p)}

                  className={

                    'w-9 h-9 text-xs font-semibold rounded border ' +

                    (p === page ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50')

                  }

                >

                  {p}

                </button>

              )

            )}



            <button

              type="button"

              disabled={page >= totalPages}

              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}

              className={

                'px-3 py-2 text-xs font-semibold rounded border ' +

                (page >= totalPages ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed' : 'bg-white text-gray-700 border-gray-300')

              }

            >

              İleri

            </button>

          </div>

        </div>

      </div>



      <CampaignCreateModal

        isOpen={createOpen}

        onClose={() => setCreateOpen(false)}

        onContinue={(draft) => {

          setCreateOpen(false)



          const type = String(draft.KAMPANYA_TIPI ?? '').trim()

          if (type === 'BasketTotalDiscount') {

            setBasketDiscountDraft({

              name: draft.KAMPANYA_ADI,

              description: draft.KAMPANYA_ACIKLAMA,

              startDate: draft.BASLANGIC_TARIH,

              endDate: draft.BITIS_TARIH

            })

            setBasketDiscountOpen(true)

          }

          if (type === 'QuantityTieredDiscount') {

            setQtyTierDraft({

              name: draft.KAMPANYA_ADI,

              description: draft.KAMPANYA_ACIKLAMA,

              startDate: draft.BASLANGIC_TARIH,

              endDate: draft.BITIS_TARIH

            })

            setQtyTierOpen(true)

          }



          if (type === 'BuyXGetY') {

            setBuyXGetYDraft({

              name: draft.KAMPANYA_ADI,

              description: draft.KAMPANYA_ACIKLAMA,

              startDate: draft.BASLANGIC_TARIH,

              endDate: draft.BITIS_TARIH

            })

            setBuyXGetYOpen(true)

          }



          if (type === 'ProductDiscount') {

            setProductDiscountDraft({

              name: draft.KAMPANYA_ADI,

              description: draft.KAMPANYA_ACIKLAMA,

              startDate: draft.BASLANGIC_TARIH,

              endDate: draft.BITIS_TARIH

            })

            setProductDiscountOpen(true)

          }



          if (type === 'CategoryBrandDiscount') {

            setCatBrandDraft({

              name: draft.KAMPANYA_ADI,

              description: draft.KAMPANYA_ACIKLAMA,

              startDate: draft.BASLANGIC_TARIH,

              endDate: draft.BITIS_TARIH

            })

            setCatBrandOpen(true)

          }



          if (type === 'PackageCampaign') {

            setPackageDraft({

              name: draft.KAMPANYA_ADI,

              description: draft.KAMPANYA_ACIKLAMA,

              startDate: draft.BASLANGIC_TARIH,

              endDate: draft.BITIS_TARIH

            })

            setPackageOpen(true)

          }

        }}

      />



      <BasketTotalDiscountModal

        isOpen={basketDiscountOpen}

        onClose={() => {

          setBasketDiscountOpen(false)

          setBasketDiscountEditingId(null)

          setBasketDiscountInitialForm(null)

        }}

        campaignDraft={basketDiscountDraft}

        editingCampaignId={basketDiscountEditingId}

        initialForm={basketDiscountInitialForm}

        onCreated={() => {

          setBasketDiscountDraft(null)

          setBasketDiscountEditingId(null)

          setBasketDiscountInitialForm(null)

          void load()

        }}

      />



      <QuantityTieredDiscountModal

        isOpen={qtyTierOpen}

        onClose={() => {

          setQtyTierOpen(false)

          setQtyTierEditingId(null)

          setQtyTierInitialForm(null)

        }}

        campaignDraft={qtyTierDraft}

        editingCampaignId={qtyTierEditingId}

        initialForm={qtyTierInitialForm}

        onCreated={() => {

          setQtyTierDraft(null)

          setQtyTierEditingId(null)

          setQtyTierInitialForm(null)

          void load()

        }}

      />



      <BuyXGetYModal

        isOpen={buyXGetYOpen}

        onClose={() => {

          setBuyXGetYOpen(false)

          setBuyXGetYEditingId(null)

          setBuyXGetYInitialForm(null)

        }}

        campaignDraft={buyXGetYDraft}

        editingCampaignId={buyXGetYEditingId}

        initialForm={buyXGetYInitialForm}

        onCreated={() => {

          setBuyXGetYDraft(null)

          setBuyXGetYEditingId(null)

          setBuyXGetYInitialForm(null)

          void load()

        }}

      />



      <SelectedProductDiscountModal

        isOpen={productDiscountOpen}

        onClose={() => {

          setProductDiscountOpen(false)

          setProductDiscountEditingId(null)

          setProductDiscountInitialForm(null)

        }}

        campaignDraft={productDiscountDraft}

        editingCampaignId={productDiscountEditingId}

        initialForm={productDiscountInitialForm}

        onCreated={() => {

          setProductDiscountDraft(null)

          setProductDiscountEditingId(null)

          setProductDiscountInitialForm(null)

          void load()

        }}

      />



      <CategoryBrandDiscountModal

        isOpen={catBrandOpen}

        onClose={() => {

          setCatBrandOpen(false)

          setCatBrandEditingId(null)

          setCatBrandInitialForm(null)

        }}

        campaignDraft={catBrandDraft}

        editingCampaignId={catBrandEditingId}

        initialForm={catBrandInitialForm}

        onCreated={() => {

          setCatBrandDraft(null)

          setCatBrandEditingId(null)

          setCatBrandInitialForm(null)

          void load()

        }}

      />



      <PackageCampaignModal

        isOpen={packageOpen}

        onClose={() => {

          setPackageOpen(false)

          setPackageEditingId(null)

          setPackageInitialForm(null)

        }}

        campaignDraft={packageDraft}

        editingCampaignId={packageEditingId}

        initialForm={packageInitialForm}

        onCreated={() => {

          setPackageDraft(null)

          setPackageEditingId(null)

          setPackageInitialForm(null)

          void load()

        }}

      />



      <Modal

        isOpen={detailsOpen}

        onClose={() => {

          setDetailsOpen(false)

          setDetails(null)

          setDetailsError(null)

        }}

        title="Kampanya Detayı"

        footer={

          <button

            type="button"

            className="px-4 py-2 text-xs font-semibold border border-gray-200 text-gray-700 rounded hover:bg-gray-50"

            onClick={() => {

              setDetailsOpen(false)

              setDetails(null)

              setDetailsError(null)

            }}

          >

            Kapat

          </button>

        }

        scrollable

      >

        {detailsError && <div className="mb-3 text-sm font-semibold text-red-600">{detailsError}</div>}

        {detailsLoading && <div className="text-sm text-gray-500">Yükleniyor...</div>}



        {!detailsLoading && details && (

          <div className="space-y-4">

            <div className="border border-gray-200 rounded-lg bg-white">

              <div className="px-4 py-2 text-xs font-semibold text-gray-600 uppercase bg-gray-50 border-b border-gray-200">Genel Bilgiler</div>

              <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">

                <div>

                  <div className="text-xs font-semibold text-gray-500">Kampanya Adı</div>

                  <div className="text-gray-900">{String(details.name ?? '')}</div>

                </div>

                <div>

                  <div className="text-xs font-semibold text-gray-500">Durum</div>

                  <div className="text-gray-900">{details.isActive ? 'Aktif' : 'Pasif'}</div>

                </div>

                <div className="md:col-span-2">

                  <div className="text-xs font-semibold text-gray-500">Açıklama</div>

                  <div className="text-gray-900 whitespace-pre-line">{String(details.description ?? '').trim() || '-'}</div>

                </div>

                <div>

                  <div className="text-xs font-semibold text-gray-500">Başlangıç</div>

                  <div className="text-gray-900">{toDateText(details.startDate)}</div>

                </div>

                <div>

                  <div className="text-xs font-semibold text-gray-500">Bitiş</div>

                  <div className="text-gray-900">{toDateText(details.endDate)}</div>

                </div>

                <div>

                  <div className="text-xs font-semibold text-gray-500">Öncelik</div>

                  <div className="text-gray-900">{Number((details as any).priority ?? 0)}</div>

                </div>

              </div>

            </div>



            <div className="border border-gray-200 rounded-lg bg-white">

              <div className="px-4 py-2 text-xs font-semibold text-gray-600 uppercase bg-gray-50 border-b border-gray-200">Koşullar / Kapsam</div>

              <div className="p-4">

                {(details.conditions ?? []).length === 0 ? (

                  <div className="text-sm text-gray-500">Koşul bulunamadı.</div>

                ) : (

                  <div className="space-y-3">

                    {(details.conditions ?? []).map((c) => {

                      const pkg = parsePackageItems((c as any).packageItemsJson)

                      const stocks = ((c as any).productStockCodes ?? []) as string[]

                      const min = (c as any).minimum

                      const max = (c as any).maximum

                      const op = String((c as any).operator ?? '').trim()

                      const val = (c as any).value

                      return (

                        <div key={String((c as any).id ?? '')} className="border border-gray-200 rounded-lg">

                          <div className="px-3 py-2 text-xs font-semibold bg-gray-50 border-b border-gray-200">{conditionTypeLabel((c as any).conditionType)}</div>

                          <div className="p-3 grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">

                            <div>

                              <div className="text-xs font-semibold text-gray-500">Kategori</div>

                              <div className="text-gray-900">{String((c as any).categoryCode ?? '').trim() || '-'}</div>

                            </div>

                            <div>

                              <div className="text-xs font-semibold text-gray-500">Koşul</div>

                              <div className="text-gray-900">

                                {op || val != null ? `${op || ''} ${val != null ? String(val) : ''}`.trim() : '-'}

                              </div>

                            </div>

                            <div>

                              <div className="text-xs font-semibold text-gray-500">KOD Alanı</div>

                              <div className="text-gray-900">{String((c as any).brandField ?? '').trim() || '-'}</div>

                            </div>

                            <div>

                              <div className="text-xs font-semibold text-gray-500">KOD Değeri</div>

                              <div className="text-gray-900">{String((c as any).brandCode ?? '').trim() || '-'}</div>

                            </div>



                            <div>

                              <div className="text-xs font-semibold text-gray-500">Minimum</div>

                              <div className="text-gray-900">{min == null ? '-' : Number(min)}</div>

                            </div>

                            <div>

                              <div className="text-xs font-semibold text-gray-500">Maksimum</div>

                              <div className="text-gray-900">{max == null ? '-' : Number(max)}</div>

                            </div>



                            {stocks.length > 0 && (

                              <div className="md:col-span-2">

                                <div className="text-xs font-semibold text-gray-500 mb-2">Seçili Ürünler</div>

                                <div className="flex flex-wrap gap-2">

                                  {stocks.slice(0, 50).map((s, idx) => (

                                    <div key={s + '_' + idx} className="px-2 py-1 text-xs border border-gray-200 rounded bg-white">

                                      {String(s ?? '').trim()}

                                    </div>

                                  ))}

                                  {stocks.length > 50 && (

                                    <div className="px-2 py-1 text-xs text-gray-500">+{stocks.length - 50} daha</div>

                                  )}

                                </div>

                              </div>

                            )}



                            {pkg.length > 0 && (

                              <div className="md:col-span-2">

                                <div className="text-xs font-semibold text-gray-500 mb-2">Paket Ürünleri</div>

                                <div className="border border-gray-200 rounded overflow-hidden">

                                  <table className="w-full text-sm">

                                    <thead>

                                      <tr className="bg-gray-50 text-xs text-gray-600">

                                        <th className="px-3 py-2 text-left">Stok Kodu</th>

                                        <th className="px-3 py-2 text-right">Adet</th>

                                      </tr>

                                    </thead>

                                    <tbody>

                                      {pkg.map((p, idx) => (

                                        <tr key={p.stockCode + '_' + idx} className="border-t border-gray-100">

                                          <td className="px-3 py-2">{p.stockCode}</td>

                                          <td className="px-3 py-2 text-right">{p.quantity}</td>

                                        </tr>

                                      ))}

                                    </tbody>

                                  </table>

                                </div>

                              </div>

                            )}

                          </div>

                        </div>

                      )

                    })}

                  </div>

                )}

              </div>

            </div>



            <div className="border border-gray-200 rounded-lg bg-white">

              <div className="px-4 py-2 text-xs font-semibold text-gray-600 uppercase bg-gray-50 border-b border-gray-200">İndirim / Fiyat Grupları</div>

              <div className="p-4">

                {(details.discounts ?? []).length === 0 ? (

                  <div className="text-sm text-gray-500">İndirim kaydı bulunamadı.</div>

                ) : (

                  <div className="border border-gray-200 rounded overflow-hidden">

                    <table className="w-full text-sm">

                      <thead>

                        <tr className="bg-gray-50 text-xs text-gray-600">

                          <th className="px-3 py-2 text-left">Hedef</th>

                          <th className="px-3 py-2 text-left">Tip</th>

                          <th className="px-3 py-2 text-left">Değer</th>

                          <th className="px-3 py-2 text-right">Min. Sepet</th>

                          <th className="px-3 py-2 text-left">Fiyat Grupları</th>

                        </tr>

                      </thead>

                      <tbody>

                        {(details.discounts ?? []).map((d: any) => (

                          <tr key={String(d?.id ?? '')} className="border-t border-gray-100">

                            <td className="px-3 py-2">{String(d?.stokKodu ?? d?.grupKodu ?? '').trim() || '-'}</td>

                            <td className="px-3 py-2">{discountTypeLabel(d?.iskontoTipi)}</td>

                            <td className="px-3 py-2">{fmtDiscountValue(d?.iskontoTipi, d?.deger)}</td>

                            <td className="px-3 py-2 text-right">{Number(d?.minSepetTutari ?? 0)}</td>

                            <td className="px-3 py-2">{priceGroupsLabel(d)}</td>

                          </tr>

                        ))}

                      </tbody>

                    </table>

                  </div>

                )}

              </div>

            </div>

          </div>

        )}

      </Modal>

    </div>

  )

}



export default function InvoicePage() {

  useOutletContext<LayoutContext>()

  const location = useLocation()



  if (location.pathname === '/invoice' || location.pathname === '/invoice/') {

    return null

  }



  const tabId = pathToInvoiceTabId(location.pathname)

  if (!tabId) {

    return <PlaceholderView title="Fatura İşlemleri" />

  }



  if (tabId === 'siparis') return <SiparisView />

  if (tabId === 'satisFatura') return <SatisFaturaView />

  if (tabId === 'cariTeklifleri') return <CariOfferPage />

  if (tabId === 'bayiTeklifleri') return <BayiTeklifleriPage />


  if (tabId === 'magaza') return <MagazaSiparisPage />


  if (tabId === 'proforma') return <ProformaPage />
  if (tabId === 'alis') return <PurchaseInvoicesPage />
  // Termin raporu termin sekmesinin ALT SAYFASI: yol önekiyle aynı yetkiye düşer (2026-09-17).
  if (tabId === 'termin') return /\/invoice\/termin\/rapor\/?$/i.test(location.pathname) ? <TerminRaporPage /> : <TerminPage />

  if (tabId === 'depoTransfer') return <DepoTransferPage />

  if (tabId === 'stokHareket') return <StokHareketDokumuPage />

  if (tabId === 'depoStock') return <DepoStokPage />

  if (tabId === 'irsaliye') return <IrsaliyePage />

  if (tabId === 'kampanya') return <CampaignListModernView />
  if (tabId === 'etiketFiyatli') return <EtiketBasimPage showPrice={true} />
  if (tabId === 'etiketFiyatsiz') return <EtiketBasimPage showPrice={false} />

  // Garanti değişim: fatura kesmez, iki stok hareketi + isteğe bağlı cari fark satırı yazar.
  if (tabId === 'garantiDegisim') return <GarantiDegisimPage />

  // Fatura takip: kesilen faturanın teknisyene atanıp imzalatılması.
  if (tabId === 'faturaTakip') return <FaturaTakipPage />


  return <PlaceholderView title={invoiceTabLabels[tabId]} />
}
