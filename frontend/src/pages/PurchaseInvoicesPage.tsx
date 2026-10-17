import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { fetchAllPages } from '../lib/fetchAllPages'
import { normalizeDiscountType } from '../utils/discountType'
import { ChevronDown, ChevronRight, ListFilter, Pencil, Plus, Printer, Search, Trash2 } from 'lucide-react'
import { useOutletContext, useNavigate } from 'react-router-dom'
import { createPortal } from 'react-dom'
import { fetchLatestFxRate } from '../api/fx'
import Modal from '../components/Modal'
import CariEkstreModal from '../components/CariEkstreModal'
import PageHeader from '../components/PageHeader'
import FormInput from '../components/forms/FormInput'
import FormSelect from '../components/forms/FormSelect'
import { CARI_SEARCH_LIMIT, buildCariSearchQuery } from '../utils/cariRemoteSearch'
import SearchableCariSelect, { type CariOption } from '../components/SearchableCariSelect'
import ColumnFilterSearchBar from '../components/table/ColumnFilterSearchBar'
import { fetchCustomersDropdown, type CustomerDto } from '../api/customers'
import { fetchSalesmenDropdown, type SalesmanDropdownItem } from '../api/salesmen'
import { fetchSuppliers, type SupplierDto } from '../api/suppliers'
import { createServiceCatalogItem, fetchServiceCatalog, type ServiceCatalogItemDto } from '../api/serviceCatalog'
import { fetchProducts } from '../api/products'
import { fetchProductPricesByProducts, type ProductPriceResponse } from '../api/productPrices'
import { fetchAuthorizedWarehousesDropdown, pickDefaultWarehouseCode, type WarehouseDropdownItem } from '../api/warehouses'
import { useProductCategories } from '../hooks/useProductCategories'
import { fetchPriceGroups, type PriceGroupDto } from '../api/priceGroups'
import { fetchCashAccounts } from '../api/cashAccounts'
import {
  createPurchaseInvoice,
  deletePurchaseInvoice,
  fetchNewPurchaseInvoiceDocumentNo,
  fetchPurchaseInvoices,
  updatePurchaseInvoiceHeader,
  updatePurchaseInvoice,
  fetchReturnSources,
  fetchReturnSourceLines,
  type ReturnSourceInvoice,
  type PurchaseInvoiceListItemDto
} from '../api/purchaseInvoices'
import { AppDataTable, type DataTableRowAction } from '../components/data-table'
import type { ColumnDef } from '@tanstack/react-table'
import {
  fetchServiceOpsSparePartOrderRequests,
  completeServiceOpsSparePartOrderRequest,
  type ServiceOpsSparePartOrderRequestDto
} from '../api/serviceOpsSparePartOrders'


type LayoutContext = {
  isSuperAdmin?: boolean
  allowedKeys?: Set<string>
}

type DiscountType = 'none' | 'amount' | 'percentage'

type InvoiceLine = {
  id: string
  productId?: string
  warehouseCode?: string
  stockCode: string
  stockName: string
  description?: string
  quantity: number
  unitPrice: number
  discountType: DiscountType
  discountValue: number
  vatRate: number
  currencyCode?: any
  /** Belgenin para birimindeki birim fiyat. `unitPrice` TL çapasıdır — karıştırma. */
  currencyUnitPrice?: number
}

type PurchaseInvoiceRow = {
  id: number | string
  approved: boolean
  date: string
  documentNo: string
  kind: number
  supplierCode?: string
  serviceCode?: string
  customerCode: string
  customerName: string
  description: string
  vatExempt: boolean
  subtotal: number
  discountTotal: number
  netTotal: number
  vatTotal: number
  grandTotal: number
  salesmanCode?: string
  createUser?: string
  terminStatus?: number
  /**
   * Faturanın para birimi — KALEMLERDEN türetilir (`getInvoiceCurrency`), çünkü alış
   * faturasında döviz satır seviyesinde tutuluyor.
   *
   * Neden satırın üstünde de duruyor: alttaki TOPLAM satırı, para birimi kovalarını satır
   * nesnesinin `currencyCode`/`currencyTypeId` alanından okuyor. Bu alan yokken her satır
   * TL kovasına düşüyor ve 70 TRY + 367 USD "437" diye TEK BİR rakam olarak toplanıyordu.
   */
  currencyCode: string
  /** Belgenin DAMGALI para birimi (0/1 TL, 2 EUR, 3 USD, 4 GBP) ve kuru. */
  currencyTypeId: number
  exchangeRate: number
  lines: InvoiceLine[]
}

type ColumnKey = 'date' | 'documentNo' | 'customerCode' | 'customerName' | 'description' | 'createUser' | 'salesmanCode' | 'vatExempt' | 'kind'

/**
 * HİZMET VE İADE FATURALARINDA OTOMATİK BELGE NO.
 *
 * Biçim: önek + yyMMddHHmmss + 1 karakter (36 tabanı) = **15 karakter**.
 *   Hizmet → `HZ260824153012K`
 *   İade   → `IA260824153012K`
 *
 * Neden tam 15: `PurchaseInvoice.DocumentNo` alanı `varchar(15)` ve ÜZERİNDE TEKİL indeks
 * var. Bütçe dolu — tarih+saat zaten 12 karakter yiyor.
 *
 * Kullanıcı adı neden yok: sığmıyor. Ama gerek de yok; faturayı kimin oluşturduğu
 * `CreateUser` alanında saklanıyor ve listede "Oluşturan" sütununda zaten görünüyor.
 * Numaraya da yazmak, tekillik için kalan tek karakteri harcamak olurdu.
 *
 * Son karakter neden var: saniye çözünürlüğü, aynı saniyede kaydeden iki kullanıcıda
 * çakışır. Sunucu bu durumda kaydı "Bu Belge No zaten kullanılmaktadır" diye reddediyor;
 * rastgele karakter o ihtimali 36 kat seyreltiyor.
 */
const OTOMATIK_BELGE_ONEKI: Record<string, string> = { service: 'HZ', return: 'IA' }

function otomatikBelgeNoUret(kind: string): string {
  const onek = OTOMATIK_BELGE_ONEKI[kind]
  if (!onek) return ''

  const d = new Date()
  const iki = (n: number) => String(n).padStart(2, '0')
  const damga =
    String(d.getFullYear()).slice(-2) +
    iki(d.getMonth() + 1) +
    iki(d.getDate()) +
    iki(d.getHours()) +
    iki(d.getMinutes()) +
    iki(d.getSeconds())

  const son = Math.floor(Math.random() * 36).toString(36).toUpperCase()
  return `${onek}${damga}${son}`
}

/**
 * Alandaki değer BİZİM ürettiğimiz otomatik numara mı?
 *
 * Tip değiştirildiğinde numara yenileniyor; ama kullanıcı elle bir belge numarası
 * yazdıysa o EZİLMEMELİ. Eski kod yalnızca "HZ ile başlıyor mu" diye bakıyordu.
 */
function otomatikBelgeNoMu(deger: string): boolean {
  return /^(HZ|IA)\d{12}[0-9A-Z]?$/.test(String(deger ?? '').trim().toUpperCase())
}

function formatMoney(n: number) {
  const v = Number(n ?? 0)
  return `₺${v.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/**
 * Hizmet tanımında seçilebilen para birimleri.
 *
 * Kodlama arka uçtaki `CurrencyTypeHelper` ile aynı: 0/1 = TRY, 2 = EUR, 3 = USD, 4 = GBP.
 * TL için 0 gönderiliyor — mevcut kayıtların taşıdığı değer bu, böylece "TL seçili" ile
 * "hiç seçilmemiş" aynı şeye denk gelir ve eski hizmetler ayrı bir kovaya düşmez.
 */
const SERVICE_CURRENCY_OPTIONS = [
  { value: 0, label: 'TL (₺)' },
  { value: 3, label: 'USD ($)' },
  { value: 2, label: 'EUR (€)' },
  { value: 4, label: 'GBP (£)' }
] as const

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

  /*
    KULLANICI BELGENİN PARA BİRİMİNDE YAZAR — ÇEVRİM YOK (2026-08-29).

    Burası satırın fiyatını ÜRÜN KARTININ para biriminde sanıp önce TL'ye, sonra hedef
    para birimine çeviriyordu. Belge dövizi artık ekranda seçildiği için bu çevrim yanlış
    sonuç veriyordu: USD seçili belgede 100 yazınca toplam 100/48,1331 = 2,08 $ çıkıyordu.

    Doğrusu: kullanıcı hangi para birimini seçtiyse rakamları o para biriminde yazıyor.
    Toplam düz toplamdır. TL karşılığını sunucu belgenin kuruyla türetir.

    `sourceRate`/`targetRate` bilerek KALDIRILDI; bırakılsalardı bir sonraki düzenlemede
    yeniden devreye girme riski taşırlardı.
  */
  const arr = Array.isArray(lines) ? lines : []
  for (const l of arr) {
    const qty = Number(l.quantity ?? 0)
    const price = Number(l.unitPrice ?? 0)

    const base = qty * price

    const dv = Number(l.discountValue ?? 0)
    let discount = 0
    // İNDİRİM TİPİ METİN GELİYOR + TUTAR İNDİRİMİ ADET BAŞINA (2026-08-22).
    //
    // API enum'ları metin olarak gönderiyor ("Amount"/"Percentage"); buradaki sayı ve
    // küçük harf karşılaştırmalarının ikisi de tutmuyor, indirim SESSİZCE 0 hesaplanıyordu.
    // Proforma listesinde her satırın indirimi 0,00 görünmesinin sebebi buydu.
    // Ayrıca tutar indirimi artık satırın tamamına değil HER ÜRÜNE uygulanıyor.
    if (normalizeDiscountType(l.discountType) === 'amount') {
      // İskonto da belgenin para biriminde girilir; çevrim yok. Tutar indirimi ADET BAŞINA.
      discount = Math.max(0, dv * qty)
    }
    if (normalizeDiscountType(l.discountType) === 'percentage') {
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

/**
 * `kind` alanını sayıya çevirir.
 *
 * Uç, enum'ları `JsonStringEnumConverter` ile METİN olarak yazıyor: alan `0/1/2` değil
 * `"Purchase"/"Service"/"Return"` geliyor. Burası `Number(...)` yapıyordu, metin `NaN`'a
 * düşüyor ve tablodaki Tip sütunu her satırda "Bilinmiyor" gösteriyordu.
 * Sayısal biçim de destekleniyor — uç ayarı değişirse ekran bozulmasın.
 */
function parseInvoiceKind(raw: unknown): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw

  const text = String(raw ?? '').trim()
  if (!text) return 0

  const asNumber = Number(text)
  if (Number.isFinite(asNumber)) return asNumber

  switch (text.toLowerCase()) {
    case 'purchase': return 0
    case 'service': return 1
    case 'return': return 2
    default: return 0
  }
}

/**
 * Fatura tipinin METİN karşılığı (2026-08-30 kullanıcı bildirimi: "tip kolonunun
 * selection boxu çalışmıyor").
 *
 * Sütun `kind` alanını okuyordu ve o alan SAYI (0/1/2); süzgeç seçenekleri ise metindi
 * ('alış'/'hizmet'/'iade'). Tablo tam eşleşme yapıyor, "0" ile "alış" hiç tutmuyordu —
 * seçim yapılıyor ama liste hiç değişmiyordu.
 *
 * Sütun artık bu metni üretiyor: süzgeç de, sıralama da, Excel çıktısı da anlamlı oluyor.
 */
export function kindLabel(kind: number): string {
  switch (kind) {
    case 0: return 'Alış'
    case 1: return 'Hizmet'
    case 2: return 'İade'
    default: return 'Bilinmiyor'
  }
}

function getKindBadge(kind: number, terminStatus?: number | null) {
  switch (kind) {
    case 0:
      if (terminStatus === 1) {
        return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-green-50 text-green-700 border border-green-100">Alış</span>
      } else {
        return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-red-50 text-red-700 border border-red-100">Alış</span>
      }
    case 1:
      return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-purple-50 text-purple-700 border border-purple-100">Hizmet</span>
    case 2:
      return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-100">İade</span>
    default:
      return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-gray-50 text-gray-700 border border-gray-100">Bilinmiyor</span>
  }
}

function isAbortError(e: any) {
  if (!e) return false
  const name = String(e?.name ?? '')
  const msg = String(e?.message ?? '')
  return name === 'AbortError' || msg.toLowerCase().includes('aborted')
}

function safeNumber(v: any, fallback = 0) {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

function trimId(value: any) {
  return String(value ?? '').trim()
}

function calcLineTotals(line: InvoiceLine, vatExempt: boolean) {
  const qty = safeNumber(line.quantity ?? 0)
  const price = safeNumber(line.unitPrice ?? 0)
  const base = qty * price

  const dv = safeNumber(line.discountValue ?? 0)
  let discount = 0
  // Tutar indirimi ADET BAŞINADIR (bkz. calcInvoiceTotalsWithConversion) — burası qty ile
  // çarpmıyordu, bu yüzden satırın kendi "Toplam" hücresi aynı formun altındaki özet
  // kutusuyla (Ara Toplam/İndirim/Genel Toplam) ÇELİŞİYORDU (2026-09-10).
  if (line.discountType === 'amount') discount = Math.max(0, dv * qty)
  if (line.discountType === 'percentage') discount = Math.max(0, (base * dv) / 100)
  discount = Math.min(discount, base)

  const net = base - discount
  const vatRate = Math.max(0, safeNumber(line.vatRate ?? 0))
  const vatAmount = vatExempt ? 0 : (net * vatRate) / 100
  const total = net + vatAmount

  return { base, discount, net, vatAmount, total }
}

function calcInvoiceTotals(row: PurchaseInvoiceRow) {
  let subTotal = 0
  let discountTotal = 0
  let netTotal = 0
  let vatTotal = 0

  for (const l of row.lines) {
    const t = calcLineTotals(l, row.vatExempt)
    subTotal += t.base
    discountTotal += t.discount
    netTotal += t.net
    vatTotal += t.vatAmount
  }

  if (!Number.isFinite(subTotal) || subTotal < 0) subTotal = 0
  if (!Number.isFinite(discountTotal) || discountTotal < 0) discountTotal = 0
  if (!Number.isFinite(netTotal) || netTotal < 0) netTotal = 0
  if (!Number.isFinite(vatTotal) || vatTotal < 0) vatTotal = 0

  const grandTotal = row.vatExempt ? netTotal : netTotal + vatTotal

  return { subTotal, discountTotal, netTotal, vatTotal, grandTotal }
}

function createId(prefix: string) {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now()}`
}

function createEmptyLine(): InvoiceLine {
  return {
    id: createId('line'),
    productId: undefined,
    warehouseCode: '',
    stockCode: '',
    stockName: '',
    description: '',
    quantity: 1,
    unitPrice: 0,
    discountType: 'none',
    discountValue: 0,
    vatRate: 20,
    currencyCode: '0'
  }
}

function createEmptyInvoice(): PurchaseInvoiceRow {
  const d = new Date()
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')

  return {
    id: 0,
    approved: false,
    date: `${yyyy}-${mm}-${dd}`,
    documentNo: '',
    kind: 0,
    supplierCode: '',
    serviceCode: '',
    customerCode: '',
    customerName: '',
    description: '',
    vatExempt: false,
    subtotal: 0,
    discountTotal: 0,
    netTotal: 0,
    vatTotal: 0,
    grandTotal: 0,
    currencyTypeId: 0,
    exchangeRate: 1,
    salesmanCode: '',
    createUser: '',
    currencyCode: '0',
    lines: [createEmptyLine()]
  }
}

const discountTypeOptions = [
  { value: 'none', label: 'Yok' },
  { value: 'amount', label: 'Tutar' },
  { value: 'percentage', label: 'Oran' }
]

/** Tedarikci satirlarini secim kutusu bicimine cevirir (acilis ve arama ayni yoldan). */
function buildSupplierOptions(suppliers: any[]): CariOption[] {
  return (suppliers ?? []).map((s: any) => ({
    value: String(s.supplierCode ?? ''),
    label: `[${String(s.supplierCode ?? '')}] ${String(s.fullName ?? '')}`.trim(),
    code: String(s.supplierCode ?? ''),
    name: String(s.fullName ?? ''),
    phone: String(s.phone ?? s.gsm ?? ''),
    type: 'supplier'
  }))
}

/** Cari satirlarini secim kutusu bicimine cevirir. */
function buildCustomerOptions(customers: any[]): CariOption[] {
  return (customers ?? []).map((c: any) => ({
    value: String(c.customerCode ?? ''),
    label: `[${String(c.customerCode ?? '')}] ${String(c.name ?? '')}`.trim(),
    code: String(c.customerCode ?? ''),
    name: String(c.name ?? ''),
    phone: String(c.phone ?? c.gsm ?? ''),
    customerType: String(c.customerType ?? '')
  }))
}

/** Yalnizca HIZMET carileri. Suzgec `customerType` alaninda, kod onekinde degil. */
function buildServiceCustomerOptions(customers: any[]): CariOption[] {
  return buildCustomerOptions(
    (customers ?? []).filter((c: any) => String(c.customerType ?? '').toLocaleLowerCase('tr-TR') === 'hizmet')
  )
}

export default function PurchaseInvoicesPage() {
  const { isSuperAdmin, allowedKeys } = useOutletContext<LayoutContext>()
  const navigate = useNavigate()

  const canUpdateHeader =
    Boolean(isSuperAdmin) ||
    (Boolean(allowedKeys?.has('invoice/alis')) && Boolean(allowedKeys?.has('invoice/alisUstBilgiGuncelle')))

  const canDuzenle =
    Boolean(isSuperAdmin) ||
    (Boolean(allowedKeys?.has('invoice/alis')) && Boolean(allowedKeys?.has('invoice/alisDuzenle')))

  const canTermin =
    Boolean(isSuperAdmin) ||
    (Boolean(allowedKeys?.has('invoice/alis')) && Boolean(allowedKeys?.has('invoice/alisTermin')))

  const canSil =
    Boolean(isSuperAdmin) ||
    (Boolean(allowedKeys?.has('invoice/alis')) && Boolean(allowedKeys?.has('invoice/alisSil')))

  /*
    TİP YETKİSİ = HEM KESME HEM GÖRME (2026-08-20 kullanıcı kararı).

    Bu üç anahtar önceden yalnız yeni kayıt ekranındaki tip seçicisini süzüyordu; liste
    tür ayırmadan hepsini gösteriyordu. Artık satırları SUNUCU süzüyor
    (`PurchaseInvoicesController.GetAllowedPurchaseKindsAsync`); buradaki bayraklar
    yalnızca ekranın süzgeç seçenekleriyle tutarlı kalması için.
    Hiçbiri açık değilse liste boş gelir — kural tek cümle: "hangi tipler açıksa o tipler
    görünür".
  */
  const canSeeKindPurchase = Boolean(isSuperAdmin) || Boolean(allowedKeys?.has('invoice/alisTipAlis'))
  const canSeeKindService = Boolean(isSuperAdmin) || Boolean(allowedKeys?.has('invoice/alisTipHizmet'))
  const canSeeKindReturn = Boolean(isSuperAdmin) || Boolean(allowedKeys?.has('invoice/alisTipIade'))

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

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

  const [rows, setRows] = useState<PurchaseInvoiceRow[]>([])

  const [customersLoading, setCustomersLoading] = useState(false)
  const [customers, setCustomers] = useState<CustomerDto[]>([])

  const [salesmenLoading, setSalesmenLoading] = useState(false)
  const [salesmen, setSalesmen] = useState<SalesmanDropdownItem[]>([])

  const [suppliersLoading, setSuppliersLoading] = useState(false)
  const [suppliers, setSuppliers] = useState<SupplierDto[]>([])

  const [servicesLoading, setServicesLoading] = useState(false)
  const [services, setServices] = useState<ServiceCatalogItemDto[]>([])

  const [warehousesLoading, setWarehousesLoading] = useState(false)
  const [warehouses, setWarehouses] = useState<WarehouseDropdownItem[]>([])

  /**
   * CARI/TEDARIKCI ARAMASI SUNUCUDA (2026-08-22) — Cari Ekstre'deki duzenin AYNISI.
   * Uc parametreleri AYNEN korundu; bu sayfadaki uc secim kutusunun her biri kendi
   * listesini kendi kurallariyla ariyor.
   */
  const supplierRemoteSearch = useCallback(async (query: string, typeKey: string): Promise<CariOption[]> => {
    try {
      const list = await fetchSuppliers({
        includeCustomers: true,
        onlyWithProducts: true,
        q: buildCariSearchQuery(query, typeKey),
        limit: CARI_SEARCH_LIMIT
      })
      setSuppliers(list ?? [])
      return buildSupplierOptions(list ?? [])
    } catch {
      return []
    }
  }, [])

  const customerRemoteSearch = useCallback(async (query: string, typeKey: string): Promise<CariOption[]> => {
    try {
      const list = await fetchCustomersDropdown({
        includeInactive: false,
        includeMuhtelif: false,
        q: buildCariSearchQuery(query, typeKey),
        limit: CARI_SEARCH_LIMIT
      })
      setCustomers((list ?? []) as any)
      return buildCustomerOptions(list ?? [])
    } catch {
      return []
    }
  }, [])

  /**
   * HIZMET CARILERI (2026-08-23 duzeltildi).
   *
   * Eskiden sunucuya '120-07' kod oneki gonderiliyordu. O onek bu firmada CALISAN carilerine
   * ait; hizmet carileri 770-01'de duruyor. Sunucu 50 calisan satiri donduruyor, ekrandaki
   * `customerType === 'hizmet'` suzgeci hepsini eliyor ve kutu BOS kaliyordu — "hizmet
   * alisinda hicbir hizmet carisi gelmiyor" sikayetinin sebebi buydu.
   *
   * Artik tur SUNUCUDA `CustomerType` alanindan suzuluyor, kod onegi tahmin edilmiyor.
   */
  const serviceCustomerRemoteSearch = useCallback(async (query: string): Promise<CariOption[]> => {
    try {
      const list = await fetchCustomersDropdown({
        includeInactive: false,
        includeMuhtelif: false,
        customerType: 'Hizmet',
        q: String(query ?? '').trim(),
        limit: CARI_SEARCH_LIMIT
      })
      setCustomers((list ?? []) as any)
      return buildServiceCustomerOptions(list ?? [])
    } catch {
      return []
    }
  }, [])

  const supplierCariOptions: CariOption[] = useMemo(() => buildSupplierOptions(suppliers ?? []), [suppliers])

  const allCustomerCariOptions: CariOption[] = useMemo(() => buildCustomerOptions(customers ?? []), [customers])

  /*
    HİZMET CARİLERİ AYRI TUTULUYOR (2026-08-23).

    Açılıştaki genel cari isteği ilk 50 satırı getiriyor ve bu firmada onların hepsi müşteri
    carisi; hizmet carisi hiç girmiyordu. Kutu açıldığında liste boş görünüyor, kullanıcı
    yazmaya başlayana kadar hiçbir şey çıkmıyordu.

    Hizmet carisi sayısı küçük (bu firmada 50), tek seferde alınıp kutuya öntanımlı liste
    olarak veriliyor. Arama yine sunucuya gidiyor.
  */
  const [serviceCustomers, setServiceCustomers] = useState<CustomerDto[]>([])

  useEffect(() => {
    const ac = new AbortController()
    void (async () => {
      try {
        const list = await fetchCustomersDropdown({
          includeInactive: false,
          includeMuhtelif: false,
          customerType: 'Hizmet',
          limit: 200,
          signal: ac.signal
        })
        setServiceCustomers((list ?? []) as any)
      } catch {
        setServiceCustomers([])
      }
    })()
    return () => ac.abort()
  }, [])

  /*
    Öntanımlı liste ayrı çekilen hizmet carilerinden; aramayla gelenler de eklenir ki
    kullanıcı arayıp seçtiğinde seçim kutusu o kaydı kaybetmesin. Kod bazında tekilleştirilir.
  */
  const serviceCustomerCariOptions: CariOption[] = useMemo(() => {
    const birlesik = [...(serviceCustomers ?? []), ...(customers ?? [])]
    const gorulen = new Set<string>()
    const tekil = birlesik.filter((c: any) => {
      const kod = String(c?.customerCode ?? '')
      if (!kod || gorulen.has(kod)) return false
      gorulen.add(kod)
      return true
    })
    return buildServiceCustomerOptions(tekil)
  }, [serviceCustomers, customers])

  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [actionsOpenForId, setActionsOpenForId] = useState<string | null>(null)
  const actionsAnchorByIdRef = useRef<Record<string, HTMLButtonElement | null>>({})
  const [actionsMenuPos, setActionsMenuPos] = useState<{ top: number; left: number } | null>(null)
  const actionsMenuRef = useRef<HTMLDivElement | null>(null)

  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirmBusy, setConfirmBusy] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const [confirmId, setConfirmId] = useState<number | null>(null)

  const [msgModalOpen, setMsgModalOpen] = useState(false)
  const [msgModalTitle, setMsgModalTitle] = useState('')
  const [msgModalText, setMsgModalText] = useState('')

  const showMessage = (title: string, text: string) => {
    setMsgModalTitle(title)
    setMsgModalText(text)
    setMsgModalOpen(true)
  }

  const [headerEditOpen, setHeaderEditOpen] = useState(false)
  const [headerEditBusy, setHeaderEditBusy] = useState(false)
  const [headerEditId, setHeaderEditId] = useState<number | null>(null)
  const [headerEditKind, setHeaderEditKind] = useState<'purchase' | 'service' | 'return'>('purchase')
  const [headerEditForm, setHeaderEditForm] = useState({
    documentNo: '',
    supplierCode: '',
    serviceCode: '',
    customerCode: ''
  })

  const [createOpen, setCreateOpen] = useState(false)
  const [draft, setDraft] = useState(() => createEmptyInvoice())

  /*
    BELGENİN DÖVİZİ ARTIK SEÇİLİYOR (2026-08-29 kullanıcı isteği: "alış kurunu seç diye bir
    buton olsun, biz genelde TL alıyoruz ama seçime bağlı olmalı").

    Eskiden ekranda hiçbir döviz göstergesi yoktu; sunucu para birimini ÜRÜN KARTINDAN tahmin
    ediyordu. Kullanıcı hangi para biriminde yazdığını göremiyordu — canlıda USD tedarikçiye
    TL tutar girilmesine yol açtı (belge no "1").

    Varsayılan TL: alışların çoğu TL, seçim kimseyi yavaşlatmasın.
  */
  const [belgeDovizi, setBelgeDovizi] = useState<number>(1)
  const [belgeKuru, setBelgeKuru] = useState<string>('1')
  // Kur elle değiştirildi mi — sunucuya "Manuel" damgası için gider.
  const [kurElleGirildi, setKurElleGirildi] = useState(false)

  const belgeDovizKodu = belgeDovizi === 2 ? 'EUR' : belgeDovizi === 3 ? 'USD' : belgeDovizi === 4 ? 'GBP' : 'TRY'
  const belgeSimgesi = belgeDovizi === 2 ? '€' : belgeDovizi === 3 ? '$' : belgeDovizi === 4 ? '£' : '₺'
  const belgeTlMi = belgeDovizi <= 1

  // Belge dövizi değişince kur TCMB'den tazelenir; kullanıcı elle girdiyse dokunulmaz.
  useEffect(() => {
    if (belgeTlMi) {
      setBelgeKuru('1')
      setKurElleGirildi(false)
      return
    }
    if (kurElleGirildi) return
    const g = Number((fxRates as any)?.[belgeDovizKodu] ?? 0)
    if (g > 0) setBelgeKuru(String(g))
  }, [belgeDovizi, belgeTlMi, belgeDovizKodu, kurElleGirildi, fxRates])
  const [editId, setEditId] = useState<number | null>(null)
  const [draftError, setDraftError] = useState<string | null>(null)

  const [montajOrdersOpen, setMontajOrdersOpen] = useState(false)
  const [montajOrdersLoading, setMontajOrdersLoading] = useState(false)
  const [montajOrdersError, setMontajOrdersError] = useState<string | null>(null)
  const [montajOrders, setMontajOrders] = useState<ServiceOpsSparePartOrderRequestDto[]>([])
  const [montajOrderTargetId, setMontajOrderTargetId] = useState<string | null>(null)

  useEffect(() => {
    if (!actionsOpenForId) {
      setActionsMenuPos(null)
      return
    }

    const anchor = actionsAnchorByIdRef.current[actionsOpenForId]
    if (!anchor) return

    const updatePos = () => {
      const r = anchor.getBoundingClientRect()
      const width = 220
      const left = Math.max(8, Math.min(window.innerWidth - width - 8, r.right - width))
      const top = Math.min(window.innerHeight - 8, r.bottom + 8)
      setActionsMenuPos({ top, left })
    }

    updatePos()
    window.addEventListener('resize', updatePos)
    window.addEventListener('scroll', updatePos, true)
    return () => {
      window.removeEventListener('resize', updatePos)
      window.removeEventListener('scroll', updatePos, true)
    }
  }, [actionsOpenForId])

  useEffect(() => {
    if (!actionsOpenForId) return

    const onDown = (e: MouseEvent) => {
      const menu = actionsMenuRef.current
      const target = e.target as Node | null
      if (!menu || !target) {
        setActionsOpenForId(null)
        return
      }

      if (!menu.contains(target)) {
        setActionsOpenForId(null)
      }
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setActionsOpenForId(null)
    }

    document.addEventListener('mousedown', onDown, true)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown, true)
      document.removeEventListener('keydown', onKey)
    }
  }, [actionsOpenForId])

  const [draftKind, setDraftKind] = useState<'' | 'purchase' | 'service' | 'return'>('')
  const [draftSupplier, setDraftSupplier] = useState('')
  const [draftService, setDraftService] = useState('')
  const [draftCustomer, setDraftCustomer] = useState('')
  const [draftSalesRep, setDraftSalesRep] = useState('')
  const [cashAccounts, setCashAccounts] = useState<any[]>([])
  const [selectedCashAccountId, setSelectedCashAccountId] = useState<string>('')
  const [selectedWarehouseCode, setSelectedWarehouseCode] = useState<string>('')

  useEffect(() => {
    void (async () => {
      try {
        const list = await fetchCashAccounts()
        setCashAccounts(list ?? [])
      } catch {
        setCashAccounts([])
      }
    })()
  }, [])

  useEffect(() => {
    if (cashAccounts.length === 1) {
      setSelectedCashAccountId(String(cashAccounts[0].id))
    }
  }, [cashAccounts])

  useEffect(() => {
    if (warehouses.length === 1) {
      setSelectedWarehouseCode(String(warehouses[0].warehouseCode))
    }
  }, [warehouses])

  const openHeaderEdit = (row: PurchaseInvoiceRow) => {
    const safeId = Number(row.id)
    if (!Number.isFinite(safeId) || safeId <= 0) {
      setError('Geçersiz id')
      return
    }

    setHeaderEditId(safeId)
    setHeaderEditKind(Number(row.kind) === 1 ? 'service' : Number(row.kind) === 2 ? 'return' : 'purchase')
    setHeaderEditForm({
      documentNo: String(row.documentNo ?? ''),
      supplierCode: String((row as any).supplierCode ?? ''),
      serviceCode: String((row as any).serviceCode ?? ''),
      customerCode: String((row as any).customerCode ?? '')
    })
    setHeaderEditOpen(true)
  }

  const submitHeaderEdit = async () => {
    const id = headerEditId
    if (!id) return
    const kindNumber = headerEditKind === 'service' ? 1 : headerEditKind === 'return' ? 2 : 0
    try {
      setHeaderEditBusy(true)
      setError(null)
      await updatePurchaseInvoiceHeader(id, {
        documentNo: headerEditForm.documentNo.trim() || undefined,
        kind: kindNumber,
        supplierCode: kindNumber === 0 ? (headerEditForm.supplierCode.trim() || undefined) : undefined,
        serviceCode: kindNumber === 1 ? (headerEditForm.serviceCode.trim() || undefined) : undefined,
        customerCode: kindNumber === 2 ? (headerEditForm.customerCode.trim() || undefined) : undefined
      })

      setHeaderEditOpen(false)
      setHeaderEditId(null)
      await loadAll()
    } catch (e: any) {
      setError(String(e?.message ?? 'Üst bilgi güncellenemedi'))
    } finally {
      setHeaderEditBusy(false)
    }
  }

  const [serviceCreateOpen, setServiceCreateOpen] = useState(false)
  const [serviceCreateBusy, setServiceCreateBusy] = useState(false)
  // `currencyTypeId`: 0/1 = TL, 2 = EUR, 3 = USD, 4 = GBP. Varsayilan 0 (TL) — eski davranis.
  const [serviceCreateForm, setServiceCreateForm] = useState(() => ({ code: 'HIZ-', name: '', currencyTypeId: 0 }))

  const [globalSearch, setGlobalSearch] = useState('')
  const [activeFilterKey, setActiveFilterKey] = useState<string | null>(null)
  const [selectedValues, setSelectedValues] = useState<Record<string, string[]>>({})
  const [draftValues, setDraftValues] = useState<Record<string, string[]>>({})
  const filterPanelRef = useRef<HTMLDivElement | null>(null)

  const [filterOps, setFilterOps] = useState<Record<ColumnKey, string>>({
    date: 'eq',
    documentNo: 'contains',
    customerCode: 'contains',
    customerName: 'contains',
    description: 'contains',
    createUser: 'contains',
    salesmanCode: 'contains',
    vatExempt: 'eq',
    kind: 'eq'
  })
  const [filters, setFilters] = useState<Record<ColumnKey, { v1: string; v2: string }>>({
    date: { v1: '', v2: '' },
    documentNo: { v1: '', v2: '' },
    customerCode: { v1: '', v2: '' },
    customerName: { v1: '', v2: '' },
    description: { v1: '', v2: '' },
    createUser: { v1: '', v2: '' },
    salesmanCode: { v1: '', v2: '' },
    vatExempt: { v1: '', v2: '' },
    kind: { v1: '', v2: '' }
  })

  const setFilterV1 = (key: ColumnKey, v: string) => {
    setFilters((p) => ({ ...p, [key]: { v1: v, v2: p[key]?.v2 ?? '' } }))
  }

  const setFilterV2 = (key: ColumnKey, v: string) => {
    setFilters((p) => ({ ...p, [key]: { v1: p[key]?.v1 ?? '', v2: v } }))
  }

  const [productPickerOpen, setProductPickerOpen] = useState(false)
  /**
   * Urun secici HIZMET kipinde mi acildi (2026-09-18).
   *
   * Alis faturasina nakliye/iscilik gibi hizmet bedeli eklenebiliyor. Kip acikken liste
   * yalnizca hizmet kartlarini (ProductType HIZMET/SERVIS) gosterir ve secilen satir
   * DEPOSUZ kurulur: hizmet envanteri hareket ettirmez.
   */
  const [productPickerServiceOnly, setProductPickerServiceOnly] = useState(false)
  /** Modal acikken kac urun eklendi — kullaniciya geri bildirim. */
  const [eklenenUrunSayisi, setEklenenUrunSayisi] = useState(0)
  const [productPickerForLineId, setProductPickerForLineId] = useState<string | null>(null)
  const [productPickerLoading, setProductPickerLoading] = useState(false)
  const [productPickerError, setProductPickerError] = useState<string | null>(null)
  const [productPickerQuery, setProductPickerQuery] = useState('')
  const [productPickerItems, setProductPickerItems] = useState<any[]>([])

  const f4GroupRankRef = useRef<Record<string, number> | null>(null)
  const f4GroupIdsRef = useRef<Set<string> | null>(null)

  const ensureF4Groups = async () => {
    if (f4GroupIdsRef.current && f4GroupRankRef.current) return
    try {
      const list: PriceGroupDto[] = await fetchPriceGroups({ includeInactive: false })
      const rankById: Record<string, number> = {}

      ;(list ?? []).forEach((x) => {
        const id = trimId((x as any)?.id)
        if (!id) return
        const code = Number((x as any)?.code ?? 0)
        const formula = String((x as any)?.formula ?? '').trim().toUpperCase()
        const name = String((x as any)?.name ?? '').trim()

        const nameNorm = name.toLowerCase()
        const exact60 = /^0?4\s*[-–]\s*60\b/.test(nameNorm) || (nameNorm.includes('60') && nameNorm.startsWith('4'))
        const looksLike4ByName = name.startsWith('4') || name.startsWith('04')

        const removeKdvPrefix = 'REMOVE_KDV' + '(F4'
        const isF4Formula = formula === 'F4' || formula.startsWith('F4*') || formula.startsWith(removeKdvPrefix)

        let rank: number | null = null
        if (code === 4 && exact60) rank = 0
        else if (exact60) rank = 1
        else if (code === 4) rank = 2
        else if (looksLike4ByName) rank = 3
        else if (isF4Formula) rank = 4

        if (rank == null) return
        const prev = rankById[id]
        if (prev == null || rank < prev) rankById[id] = rank
      })

      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.log('[PurchaseInvoicesPage] ensureF4Groups: total groups from API:', list?.length, 'F4 matched ids:', Object.keys(rankById).length, 'rankById:', rankById)
      }

      f4GroupRankRef.current = rankById
      f4GroupIdsRef.current = new Set(Object.keys(rankById))
    } catch (err: any) {
      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.error('[PurchaseInvoicesPage] ensureF4Groups ERROR:', err?.message ?? err)
      }
      f4GroupRankRef.current = {}
      f4GroupIdsRef.current = new Set()
    }
  }

  const fetchF4PriceMapForProductIds = async (ids: string[]) => {
    await ensureF4Groups()
    const f4GroupIds = f4GroupIdsRef.current ?? new Set<string>()
    const f4GroupRank = f4GroupRankRef.current ?? {}
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.log('[PurchaseInvoicesPage] fetchF4PriceMap: productIds count:', ids.length, 'f4GroupIds count:', f4GroupIds.size, 'f4GroupIds:', [...f4GroupIds])
    }
    if (f4GroupIds.size === 0 || ids.length === 0) return {}

    const prices: ProductPriceResponse[] = await fetchProductPricesByProducts(ids)
    const map: Record<string, { price: number; currency: string }> = {}
    const bestRankByProductId: Record<string, number> = {}

    ;(prices ?? []).forEach((pp) => {
      const rawId = trimId((pp as any)?.productId ?? (pp as any)?.productID)
      const productId = rawId
      const productIdLower = rawId.toLowerCase()
      const priceGroupId = trimId((pp as any)?.priceGroupId ?? (pp as any)?.priceGroupID)
      if (!productId || !f4GroupIds.has(priceGroupId)) return

      const rank = f4GroupRank[priceGroupId]
      if (rank == null) return

      const prevRank = bestRankByProductId[productId]
      if (prevRank != null && prevRank <= rank) return
      bestRankByProductId[productId] = rank

      const value = { price: Number((pp as any)?.price ?? 0), currency: String((pp as any)?.currency ?? '') }
      map[productId] = value
      if (productIdLower && productIdLower !== productId) map[productIdLower] = value
    })

    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.log('[PurchaseInvoicesPage] fetchF4PriceMap result: matched products:', Object.keys(map).length / 2, 'map keys sample:', Object.keys(map).slice(0, 6))
    }
    return map
  }

  const dealerCodeForPricing = useMemo(() => {
    if (draftKind !== 'return') return undefined
    const cc = String(draftCustomer ?? '').trim()
    return cc ? cc : undefined
  }, [draftCustomer, draftKind])

  const { data: categoriesState } = useProductCategories({ includeDealer: true, dealerCode: dealerCodeForPricing })
  const [pickerMainCat, setPickerMainCat] = useState('')
  const [pickerSubCat, setPickerSubCat] = useState('')

  const selectedCustomer = useMemo(() => {
    if (draftKind !== 'return') return null
    const cc = String(draftCustomer ?? '').trim()
    if (!cc) return null
    return customers.find((c) => c.customerCode === cc) ?? null
  }, [customers, draftCustomer, draftKind])

  const selectedService = useMemo(() => {
    const sc = String(draftService ?? '').trim()
    if (!sc) return null
    return services.find((s) => String(s.code) === sc) ?? null
  }, [draftService, services])

  /**
   * Seçilen hizmetin para birimi kalemlere ÖNTANIM olarak iner.
   *
   * Hizmet tanımında para birimi yokken gümrük gibi dövizli hizmetler faturaya TL açılıyor,
   * kullanıcı her kalemde elle çeviriyordu. Burada yalnızca hizmet DEĞİŞTİĞİNDE yazılır;
   * sonrasında kalemde başka bir para birimi seçilirse ona dokunulmaz.
   *
   * Kalem tarafındaki kodlama metin ('0','2','3','4'); hizmetteki 1 (TRY) de '0'a düşürülür,
   * çünkü kalemlerde TL bu değerle tutuluyor.
   */
  useEffect(() => {
    if (draftKind !== 'service') return
    if (!selectedService) return

    const raw = Number((selectedService as any)?.currencyTypeId ?? 0)
    const lineCurrency = raw === 1 || raw === 0 ? '0' : String(raw)

    setDraft((p) => ({
      ...p,
      lines: p.lines.map((l) => (l.currencyCode === lineCurrency ? l : { ...l, currencyCode: lineCurrency }))
    }))
  }, [draftKind, selectedService])

  const selectedSupplier = useMemo(() => {
    if (draftKind !== 'purchase') return null
    const code = String(draftSupplier ?? '').trim()
    if (!code) return null
    return suppliers.find((s) => String(s.supplierCode ?? '').trim() === code) ?? null
  }, [draftKind, draftSupplier, suppliers])

  const totalsById = useMemo(() => {
    const out: Record<string, ReturnType<typeof calcInvoiceTotals>> = {}
    for (const r of rows) out[String(r.id)] = calcInvoiceTotals(r)
    return out
  }, [rows])

  const toggleExpand = (id: number | string) => {
    const k = String(id)
    setExpanded((p) => ({ ...p, [k]: !p[k] }))
  }

  const mapApiToRow = (x: PurchaseInvoiceListItemDto): PurchaseInvoiceRow => {
    const yyyyMmDd = String(x.date ?? '').slice(0, 10)
    return {
      id: x.id,
      approved: Boolean((x as any).approved),
      date: yyyyMmDd,
      documentNo: String(x.documentNo ?? ''),
      kind: parseInvoiceKind((x as any).kind),
      supplierCode: String((x as any).supplierCode ?? ''),
      serviceCode: String((x as any).serviceCode ?? ''),
      customerCode: String(x.customerCode ?? ''),
      customerName: String(x.customerName ?? ''),
      description: String(x.description ?? ''),
      vatExempt: Boolean(x.vatExempt),
      subtotal: Number(x.subtotal ?? 0),
      discountTotal: Number(x.discountTotal ?? 0),
      netTotal: Number(x.netTotal ?? 0),
      vatTotal: Number(x.vatTotal ?? 0),
      grandTotal: Number(x.grandTotal ?? 0),
      salesmanCode: String((x as any).salesmanCode ?? ''),
      createUser: String((x as any).createUser ?? ''),
      terminStatus: x.terminStatus !== null && x.terminStatus !== undefined ? Number(x.terminStatus) : undefined,
      /*
        PARA BIRIMI VE FIYAT (2026-09-01 duzeltmesi).

        Liste, kalemin `unitPrice` alanini "belgenin para biriminde" sanip topluyor ve
        etiketi URUNUN dovizinden kuruyordu. Ikisi de yanlisti:

          * `unitPrice` TL CAPASIDIR. Belgenin kendi parasindaki deger `currencyUnitPrice`
            alaninda durur (bkz. PurchaseInvoicesController: "UnitPrice TL capasi,
            CurrencyUnitPrice belgenin kendi parasi").
          * Etiket, kalemin bagli oldugu URUN KARTININ alis dovizinden geliyordu; belgenin
            damgali dovizi degil.

        Sonuc: 117,50 $ girilen kalem listede 5.670,70 $ gorunuyordu (117,50 x 48,26 kuru
        TL degeri, ustune $ isareti). 422.950 $'lik fatura 20.412.113 $ diye toplaniyordu.
        Kayitli VERI dogruydu; bozuk olan yalnizca okuma tarafiydi.

        ESKI FATURALAR: damgalama 2026-08-29'da geldi; oncesinde `CurrencyUnitPrice` bos
        (0) ve `CurrencyTypeId` 0. Onlarda eski davranis korunuyor - `unitPrice` ve
        kalemden turetilen doviz kullaniliyor.
      */
      currencyTypeId: Number((x as any).currencyTypeId ?? 0),
      exchangeRate: Number((x as any).exchangeRate ?? 0),
      currencyCode: (x.lines ?? []).some((l: any) => Number(l?.currencyUnitPrice ?? 0) > 0)
        ? String(Number((x as any).currencyTypeId ?? 0))
        : getInvoiceCurrency(x.lines ?? []),
      lines: (x.lines ?? []).map((l) => ({
        id: String(l.id),
        productId: l.productId ? String(l.productId) : undefined,
        warehouseCode: l.warehouseCode !== null && l.warehouseCode !== undefined ? String(l.warehouseCode) : '',
        stockCode: String(l.stockCode ?? ''),
        stockName: String((l as any).stockName ?? l.description ?? ''),
        description: String((l as any).description ?? ''),
        quantity: Number(l.quantity ?? 0),
        /*
          Ekranin her yeri (toplamlar, genisletilmis satir, alt toplam kovalari) bu alani
          "belgenin para biriminde" kabul ediyor. Bu yuzden ÇEVRİLMİŞ deger degil, belgenin
          kendi parasindaki fiyat yaziliyor; boylece asagidaki hesaplarin hicbiri
          degistirilmek zorunda kalmiyor. Damgasiz eski kalemlerde alan 0 gelir, o zaman
          eski davranis (TL capasi) korunur.
        */
        unitPrice: Number((l as any).currencyUnitPrice ?? 0) > 0
          ? Number((l as any).currencyUnitPrice)
          : Number(l.unitPrice ?? 0),
        currencyUnitPrice: Number((l as any).currencyUnitPrice ?? 0),
        // Uçtan METİN geliyor ("Amount"/"Percentage"); `=== 1` karşılaştırması hiç tutmuyor ve
        // her satır 'none' oluyordu, yani indirim sessizce sıfırlanıyordu (2026-08-22).
        discountType: normalizeDiscountType(l.discountType),
        discountValue: Number(l.discountValue ?? 0),
        vatRate: Number(l.vatRate ?? 0),
        // Etiket BELGENIN dovizi; urun kartininki degil. Damgasizsa eski kaynaga duser.
        currencyCode: Number((l as any).currencyUnitPrice ?? 0) > 0
          ? String(Number((x as any).currencyTypeId ?? 0))
          : String((l as any).currencyCode ?? (l as any).CurrencyCode ?? '0')
      }))
    }
  }

  useEffect(() => {
    const close = () => setActionsOpenForId(null)
    window.addEventListener('click', close)
    return () => {
      window.removeEventListener('click', close)
    }
  }, [])

  /*
    BÜTÜN ALIŞ FATURALARI (2026-10-08). Eskiden yalnız son 200 fatura çekiliyordu; arama, sütun
    süzgeçleri ve sayfalama tarayıcıda o 200'ün içinde çalıştığı için daha eski bir fatura
    (ör. 25.08'deki 0081820) Fatura Dökümü'nde ve cari ekstrede görünürken burada HİÇ
    bulunamıyordu. Artık 500'erli sayfalarla hepsi çekiliyor (bkz. lib/fetchAllPages).
  */
  const loadAll = async (signal?: AbortSignal) => {
    try {
      setLoading(true)
      setError(null)
      await fetchAllPages((skip, take) => fetchPurchaseInvoices({ take, skip, signal }), {
        key: (x: any) => String(x.id),
        onPage: (all, first) => {
          setRows(all.map(mapApiToRow))
          if (first) setLoading(false) // ilk sayfa geldi; ekran beklemesin
        }
      })
    } catch (e: any) {
      if (isAbortError(e)) return
      setRows([])
      setError(String(e?.message ?? 'Alış siparişleri alınamadı'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const ac = new AbortController()
    void loadAll(ac.signal)
    return () => ac.abort()
  }, [])

  useEffect(() => {
    const ac = new AbortController()
    void (async () => {
      try {
        setSalesmenLoading(true)
        const s = await fetchSalesmenDropdown({ signal: ac.signal })
        setSalesmen(s ?? [])
      } catch (e: any) {
        if (!isAbortError(e)) setSalesmen([])
      } finally {
        setSalesmenLoading(false)
      }
    })()
    return () => ac.abort()
  }, [])

  useEffect(() => {
    const ac = new AbortController()
    void (async () => {
      try {
        setSuppliersLoading(true)
        // Yalnızca ÜRÜNÜ OLAN tedarikçiler listelenir (2026-08-19 kullanıcı kararı):
        // mal alınmayan yüzlerce cari listeyi kullanılmaz hâle getiriyordu.
        // Liste ARTIK TUMUYLE INDIRILMIYOR — secim kutusu sunucudan ariyor
        // (bkz. supplierRemoteSearch). Acilista yalnizca ilk sayfa cekilir.
        const s = await fetchSuppliers({ includeCustomers: true, onlyWithProducts: true, limit: CARI_SEARCH_LIMIT, signal: ac.signal })
        setSuppliers(s ?? [])
      } catch (e: any) {
        if (!isAbortError(e)) setSuppliers([])
      } finally {
        setSuppliersLoading(false)
      }
    })()
    return () => ac.abort()
  }, [])

  const loadServices = async (signal?: AbortSignal) => {
    try {
      setServicesLoading(true)
      const s = await fetchServiceCatalog({ signal })
      setServices(s ?? [])
    } catch (e: any) {
      if (!isAbortError(e)) setServices([])
    } finally {
      setServicesLoading(false)
    }
  }

  useEffect(() => {
    const ac = new AbortController()
    void loadServices(ac.signal)
    return () => ac.abort()
  }, [])

  useEffect(() => {
    const ac = new AbortController()
    void (async () => {
      try {
        setWarehousesLoading(true)
        const list = await fetchAuthorizedWarehousesDropdown({ signal: ac.signal })
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
    const ac = new AbortController()
    void (async () => {
      try {
        setCustomersLoading(true)
        setCustomers([])
        // Liste ARTIK TUMUYLE INDIRILMIYOR — secim kutulari sunucudan ariyor.
        const list = await fetchCustomersDropdown({ includeInactive: false, includeMuhtelif: false, limit: CARI_SEARCH_LIMIT, signal: ac.signal })
        setCustomers((list ?? []) as any)
      } catch {
        setCustomers([] as any)
      } finally {
        setCustomersLoading(false)
      }
    })()


    return () => ac.abort()
  }, [])

  const openCreate = () => {
    const init = createEmptyInvoice()
    setDraft({ ...init, vatExempt: true })
    setDraftKind('')
    setDraftSupplier('')
    setDraftService('')
    setDraftCustomer('')
    setDraftSalesRep('')
    setEditId(null)
    setCreateOpen(true)
    setDraftError(null) // Add this line
  }

  const openMontajOrders = async () => {
    try {
      setMontajOrdersError(null)
      setMontajOrdersLoading(true)
      setMontajOrders([])
      setMontajOrdersOpen(true)
      const list = await fetchServiceOpsSparePartOrderRequests('Pending')
      setMontajOrders(Array.isArray(list) ? list : [])
    } catch (e: any) {
      setMontajOrdersError(String(e?.message ?? 'Siparişler alınamadı'))
      setMontajOrders([])
    } finally {
      setMontajOrdersLoading(false)
    }
  }

  const openEdit = (id: number | string) => {
    const safeId = Number(id)
    if (!Number.isFinite(safeId) || safeId <= 0) {
      setError('Geçersiz id')
      return
    }

    const row = rows.find((r) => Number(r.id) === safeId)
    if (!row) {
      setError('Kayıt bulunamadı')
      return
    }

    setEditId(safeId)
    setDraft((p) => ({ ...p, ...row, id: safeId }))
    const k = Number((row as any).kind ?? 0)
    setDraftKind(k === 1 ? 'service' : k === 2 ? 'return' : 'purchase')
    setDraftSupplier(String((row as any).supplierCode ?? '').trim())
    setDraftService(String((row as any).serviceCode ?? '').trim())
    setDraftCustomer(String(row.customerCode ?? '').trim())
    setDraftSalesRep(String(row.salesmanCode ?? '').trim())
    setSelectedCashAccountId(String((row as any).cashAccountId ?? ''))
    const firstLineWarehouse = (row.lines ?? [])[0]?.warehouseCode ? String((row.lines ?? [])[0].warehouseCode) : ''
    setSelectedWarehouseCode(firstLineWarehouse)

    /*
      BELGENİN PARA BİRİMİ VE KURU DA YÜKLENİR (2026-09-01 düzeltmesi).

      `belgeDovizi`/`belgeKuru` YALNIZCA ekrandaki açılır kutudan set ediliyordu; düzenlemeye
      açarken hiç okunmuyordu. Sonuç: sayfa yenilendikten sonra bir USD faturayı açmak onu
      ekranda TL gösteriyor (durum varsayılanı 1), kaydedince de belge SESSİZCE TL'ye
      dönüyordu — kalem fiyatları aynı sayıda kalıp para birimi değiştiği için tedarikçi
      borcu kur katı yanlış oluyordu.

      Kur da "elle girildi" işaretleniyor: yoksa efekt TCMB'nin GÜNCEL kurunu yazıp belgenin
      kendi (fatura tarihindeki) kurunu ezerdi.
    */
    const kayitliDoviz = Number((row as any).currencyTypeId ?? 0)
    const kayitliKur = Number((row as any).exchangeRate ?? 0)
    setBelgeDovizi(kayitliDoviz > 0 ? kayitliDoviz : 1)
    if (kayitliDoviz > 1 && kayitliKur > 0) {
      setBelgeKuru(String(kayitliKur))
      setKurElleGirildi(true)
    } else {
      setBelgeKuru('1')
      setKurElleGirildi(false)
    }

    setDraftError(null)
    setCreateOpen(true)
  }

  /*
    EKRANIN PARA BİRİMİ DE ARTIK SEÇİMDEN GELİYOR (2026-08-29).

    Burası `getInvoiceCurrency(draft.lines)` ile para birimini SATIRLARIN ÜRÜNLERİNDEN
    türetiyordu — sunucudaki tahminin frontend'deki ikizi. Toplamlar da ondan hesaplandığı
    için ekran, kullanıcının yazdığı sayıyı hiç seçmediği bir para biriminde gösteriyordu.

    İade/hizmet faturasında para birimi hâlâ CARİNİN kartından gelir (o kural doğru ve
    sunucuyla aynı); değişen yalnızca NORMAL ALIŞ: orada kullanıcının seçimi esastır.
  */
  const draftCurrency = useMemo(() => {
    // İADE ARTIK BELGENİN PARA BİRİMİYLE GÖSTERİLİR (2026-10-14 canlı bildirim: "burda niye euro
    // gözüküyor"). Kartı EUR olan caride fiyat sütunu ₺, toplamlar € görünüyordu; sunucu ise belgeyi
    // BEYAN EDİLEN para birimiyle (belgeDovizi, iade için TL) kaydedip cari deftere kuruyla çeviriyor.
    // Ekran kaydedilecek olanı göstersin. Hizmet faturasının kuralı değişmedi.
    if (draftKind === 'service') {
      const cc = String(draftCustomer ?? '').trim()
      const isMuhtelif = cc.toUpperCase() === 'MUHTELIF'
      if (!isMuhtelif && cc) {
        const selectedCustomer = customers.find((c) => c.customerCode === cc)
        if (selectedCustomer?.currencyTypeId) {
          if (selectedCustomer.currencyTypeId === 2) return 'EUR'
          if (selectedCustomer.currencyTypeId === 3) return 'USD'
          if (selectedCustomer.currencyTypeId === 4) return 'GBP'
        }
      }
    }
    return belgeDovizKodu === 'TRY' ? 'TRY' : belgeDovizKodu
  }, [draftKind, draftCustomer, customers, belgeDovizKodu])
  const draftTotals = useMemo(() => {
    return calcInvoiceTotalsWithConversion(draft.lines, draft.vatExempt, draftCurrency, fxRates)
  }, [draft.lines, draft.vatExempt, draftCurrency, fxRates])

  const columnOptions = useMemo(() => {
    const out: Record<string, string[]> = {}
    const cols = ['date', 'documentNo', 'customerCode', 'customerName', 'description', 'createUser', 'salesmanCode']
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

    const normalizeNumberValue = (value: unknown) => {
      const raw = String(value ?? '').trim().replace(',', '.')
      const n = Number(raw)
      return Number.isFinite(n) ? n : null
    }

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

    const activeFilters = (['date', 'documentNo', 'customerCode', 'customerName', 'description', 'createUser', 'salesmanCode', 'vatExempt', 'kind'] as ColumnKey[])
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

              if (f.key === 'kind') {
                const kindVal = Number(raw)
                const cell = kindVal === 1 ? 'hizmet' : kindVal === 2 ? 'iade' : 'alış'
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
      const blob = [row.date, row.documentNo, row.customerCode, row.customerName, row.description, row.createUser, row.salesmanCode]
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

  /*
    CARİ EKSTRE — cari adına tıklayınca Fatura Dökümü'ndeki ekstre modalının AYNISI açılır
    (2026-09-17 kullanıcı isteği). Bileşen ortak: `components/CariEkstreModal`; tedarikçi
    (320) kodları kendi ekstre ucundan okunur.
  */
  const [ekstreOpen, setEkstreOpen] = useState(false)
  const [ekstreCari, setEkstreCari] = useState<{ kod: string; ad: string } | null>(null)
  const openCariEkstre = useCallback((kod: string, ad: string) => {
    setEkstreCari({ kod, ad })
    setEkstreOpen(true)
  }, [])

  const purchaseInvoiceColumns = useMemo<ColumnDef<PurchaseInvoiceRow, any>[]>(
    () => [
      {
        // Süzgecin çalışması için hücre değeri ETİKET olmalı; bkz. kindLabel açıklaması.
        id: 'kind',
        accessorFn: (r: PurchaseInvoiceRow) => kindLabel(r.kind),
        header: 'Tip',
        meta: {
          filterType: 'select',
          filterPlaceholder: 'Tip...',
          /*
            SÜTUN SÜZGECİ DE YETKİYE UYAR (2026-08-20 kullanıcı kararı).

            Rol Yetkileri'ndeki "Alış Tipi / Hizmet Tipi / İade Tipi" anahtarları artık
            yalnız fatura kesmeyi değil GÖRMEYİ de belirliyor; satırları sunucu süzüyor.
            Burada da yalnız görülebilen tipler listeleniyor, yoksa kullanıcı hiç sonuç
            dönmeyecek bir tipi seçebiliyor ve "liste bozuk" sanıyordu.
            Asıl kapı SUNUCUDA (`GetAllowedPurchaseKindsAsync`); burası sadece görünüm.
          */
          // Değerler hücrenin ürettiği metinle BİREBİR aynı olmalı (tam eşleşme yapılıyor).
          filterOptions: [
            ...(canSeeKindPurchase ? [{ value: 'Alış', label: 'Alış' }] : []),
            ...(canSeeKindService ? [{ value: 'Hizmet', label: 'Hizmet' }] : []),
            ...(canSeeKindReturn ? [{ value: 'İade', label: 'İade' }] : [])
          ]
        },
        cell: ({ row }) => getKindBadge(row.original.kind, row.original.terminStatus)
      },
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
        accessorKey: 'customerCode',
        header: 'Cari Kodu',
        meta: { filterType: 'text', filterPlaceholder: 'Cari Kodu...' }
      },
      {
        accessorKey: 'customerName',
        header: 'Cari Adı',
        meta: { filterType: 'text', filterPlaceholder: 'Cari Adı...' },
        // Fatura Dökümü ile aynı: kod varsa ad tıklanır ve ekstre açılır; yoksa düz metin.
        cell: ({ getValue, row }) => {
          const ad = String(getValue() ?? '')
          const kod = String((row.original as any)?.customerCode ?? '').trim()
          if (!ad) return null
          if (!kod) {
            return <span className="font-medium text-slate-900 truncate block" title={ad}>{ad}</span>
          }
          return (
            <button
              type="button"
              title={`${ad} — cari ekstre`}
              onClick={(e) => { e.stopPropagation(); openCariEkstre(kod, ad) }}
              className="font-medium text-indigo-700 hover:text-indigo-900 hover:underline truncate block max-w-full text-left"
            >
              {ad}
            </button>
          )
        }
      },
      {
        accessorKey: 'description',
        header: 'Açıklama',
        meta: { filterType: 'text', filterPlaceholder: 'Açıklama...' }
      },
      {
        accessorKey: 'createUser',
        header: 'İşlem Yapan',
        meta: { filterType: 'text', filterPlaceholder: 'İşlem Yapan...' }
      },
      {
        accessorKey: 'salesmanCode',
        header: 'Satış Yapan',
        meta: { filterType: 'text', filterPlaceholder: 'Satış Yapan...' }
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
        header: 'Döviz',
        cell: ({ row }) => {
          const invCurrency = getInvoiceCurrency(row.original.lines)
          return <span className="font-semibold text-sky-700">{invCurrency === '3' || invCurrency === 'USD' ? 'USD' : invCurrency === '2' || invCurrency === 'EUR' ? 'EUR' : invCurrency === '4' || invCurrency === 'GBP' ? 'GBP' : 'TRY'}</span>
        }
      },
      {
        id: 'subtotal',
        accessorFn: (row) => {
          const invCurrency = getInvoiceCurrency(row.lines)
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
          return calcInvoiceTotalsWithConversion(row.lines, row.vatExempt, invCurrency, fxRates).grandTotal
        },
        header: 'Genel Toplam',
        meta: { filterType: 'number', showTotal: true },
        cell: ({ row, getValue }) => {
          const invCurrency = getInvoiceCurrency(row.original.lines)
          return <div className="text-right font-bold text-slate-900">{formatMoneyWithCurrency(getValue(), invCurrency)}</div>
        }
      }
    ],
    // Tip süzgeci seçenekleri yetkiye bağlı: bayraklar bağımlılıkta olmazsa sütun tanımı
    // ilk render'daki (yetkiler henüz yüklenmemiş) seçeneklerle donup kalır.
    [fxRates, canSeeKindPurchase, canSeeKindService, canSeeKindReturn, openCariEkstre]
  )

  const getRowActions = (row: PurchaseInvoiceRow): DataTableRowAction<PurchaseInvoiceRow>[] => {
    const actions: DataTableRowAction<PurchaseInvoiceRow>[] = []
    if (canDuzenle) {
      actions.push({
        label: 'Düzenle',
        icon: <Pencil size={14} />,
        onClick: (r) => void openEdit(r.id)
      })
    }
    if (canSil) {
      actions.push({
        label: 'Sil',
        icon: <Trash2 size={14} />,
        variant: 'danger',
        onClick: (r) => requestDelete(r)
      })
    }
    return actions
  }

  const renderExpandedRowContent = (row: PurchaseInvoiceRow) => {
    return (
      <div className="border border-slate-200 rounded-lg overflow-hidden bg-white shadow-sm p-2">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-slate-100 text-slate-700 font-semibold border-b border-slate-200">
              <th className="px-3 py-2 text-left">Stok Kodu</th>
              <th className="px-3 py-2 text-left">Stok Adı</th>
              <th className="px-3 py-2 text-left">Açıklama</th>
              <th className="px-3 py-2 text-center">Döviz Tipi</th>
              <th className="px-3 py-2 text-right">Miktar</th>
              <th className="px-3 py-2 text-right">Fiyat</th>
              <th className="px-3 py-2 text-right">Toplam</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {row.lines.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-3 text-center text-slate-400">Kalem bulunamadı.</td>
              </tr>
            ) : (
              row.lines.map((line) => {
                const lineTotals = calcLineTotals(line, row.vatExempt)
                return (
                  <tr key={line.id} className="hover:bg-slate-50">
                    <td className="px-3 py-2 font-mono font-medium text-slate-800">{line.stockCode}</td>
                    <td className="px-3 py-2 text-slate-700">{line.stockName}</td>
                    <td className="px-3 py-2 text-slate-500">{line.description || '-'}</td>
                    <td className="px-3 py-2 text-center text-slate-600 font-medium">{getCurrencySymbol(line.currencyCode)}</td>
                    <td className="px-3 py-2 text-right font-medium">{line.quantity}</td>
                    <td className="px-3 py-2 text-right">{formatMoneyWithCurrency(line.unitPrice, line.currencyCode)}</td>
                    <td className="px-3 py-2 text-right font-semibold text-slate-900">{formatMoneyWithCurrency(lineTotals.total, line.currencyCode)}</td>
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

  const saveDraft = async () => {
    try {
      setLoading(true)
      setError(null)
      setDraftError(null)

      if (!draftKind) throw new Error('Tip seçimi zorunlu')

      const kindNumber = draftKind === 'service' ? 1 : draftKind === 'return' ? 2 : 0

      if (!String(draft.documentNo ?? '').trim()) throw new Error('Belge No zorunlu')

       const payload = {
        documentNo: String(draft.documentNo ?? '').trim(),
        date: draft.date,
        kind: kindNumber,
        vatExempt: draftKind === 'service' || draftKind === 'purchase' ? true : Boolean(draft.vatExempt),
        supplierCode: draftKind === 'purchase' ? draftSupplier : null,
        serviceCode: draftKind === 'service' ? draftService : null,
        customerCode: draftKind === 'return' || draftKind === 'service' ? draftCustomer : null,
        salesmanCode: draftSalesRep || null,
        description: draft.description,
        cashAccountId: draftKind === 'return' ? (Number(selectedCashAccountId) || null) : null,
        // Belgenin BEYAN EDİLEN para birimi ve kuru. Sunucu bunlar gelirse tahmin yapmaz.
        currencyTypeId: belgeDovizi,
        exchangeRate: belgeTlMi ? 1 : Number(String(belgeKuru).replace(',', '.')) || 0,
        rateSource: belgeTlMi ? 'TCMB' : (kurElleGirildi ? 'Manuel' : 'TCMB'),
        lines: draft.lines.map((l) => ({
          /*
            BOS STRING GONDERILMEZ (2026-09-18).

            Sunucuda `ProductId` bir `Guid?`; bos metin ("") o tipe baglanamiyor ve istek
            daha controller'a girmeden "One or more validation errors occurred" ile 400
            donuyordu. Urun karti olmayan hizmet satirinda alan NULL gitmeli — satirin
            kimligi `stockCode` (katalog kodu) uzerinden kuruluyor.
          */
          productId: draftKind === 'service' ? null : (String(l.productId ?? '').trim() || null),
          /*
            Urun karti OLMAYAN satirin stok kodu gonderilir: "Hizmet Ekle" ile eklenen satir
            hizmet katalogundan geliyor (HIZ-NAKLIYE...) ve `Products`ta karsiligi yok.
            Sunucu bu kodu katalogda arar; bulamazsa satiri yine reddeder.
          */
          stockCode: String(l.productId ?? '').trim() ? undefined : (String(l.stockCode ?? '').trim() || undefined),
          description: String(l.description ?? '').trim() || null,
          warehouseCode: draftKind === 'return' ? (selectedWarehouseCode ? Number(selectedWarehouseCode) : null) : null,
          quantity: Number(l.quantity ?? 0),
          // Kullanıcı belgenin para biriminde yazıyor. Sunucu TL çapasını kendi kuruyla türetir.
          unitPrice: Number(l.unitPrice ?? 0),
          currencyUnitPrice: Number(l.unitPrice ?? 0),
          vatRate: draftKind === 'service' ? 0 : Number(l.vatRate ?? 0),
          discountType: draftKind === 'service' ? 0 : l.discountType === 'amount' ? 1 : l.discountType === 'percentage' ? 2 : 0,
          discountValue: draftKind === 'service' ? 0 : Number(l.discountValue ?? 0)
        }))
      }

      if (draftKind === 'purchase' && !String(payload.supplierCode ?? '').trim()) throw new Error('Tedarikçi seçimi zorunlu')
      if (draftKind === 'service' && !String(payload.serviceCode ?? '').trim()) throw new Error('Hizmet seçimi zorunlu')
      if (draftKind === 'service' && !String(payload.customerCode ?? '').trim()) throw new Error('Cari seçimi zorunlu')
      if (draftKind === 'return' && !String(payload.customerCode ?? '').trim()) throw new Error('Cari seçimi zorunlu')
      if (draftKind === 'return' && (!selectedWarehouseCode || Number(selectedWarehouseCode) <= 0)) throw new Error('Depo seçimi zorunlu')

      if (!belgeTlMi && !(Number(payload.exchangeRate) > 0)) {
        throw new Error('Dövizli alış siparişinde kur 0 olamaz. Kuru girin ya da belgeyi TL yapın.')
      }
      if (payload.lines.length === 0) throw new Error('En az 1 satır eklemelisiniz')
      if (payload.lines.length > 17) throw new Error('En fazla 17 kalem sipariş edebilirsiniz.')
      if (payload.lines.some((l) => Number(l.quantity ?? 0) <= 0)) throw new Error('Miktar 0 olamaz')
      /*
        Hizmet satirinda urun karti ARANMAZ (2026-09-18): katalogdan secilen hizmetin
        (HIZ-NAKLIYE...) urun karti yoktur, yalnizca stok kodu vardir. Kodun gercekten
        katalogda olup olmadigina SUNUCU bakar; burada ikisi de bos olan satir elenir.
      */
      if (
        draftKind !== 'service' &&
        payload.lines.some((l) => !String(l.productId ?? '').trim() && !String((l as any).stockCode ?? '').trim())
      ) {
        throw new Error('Tüm satırlarda ürün seçmelisiniz')
      }

      if (editId) {
        await updatePurchaseInvoice(editId, payload as any)
      } else {
        await createPurchaseInvoice(payload as any)
      }

      if (montajOrderTargetId) {
        try {
          await completeServiceOpsSparePartOrderRequest(montajOrderTargetId)
        } catch {
          // ignore
        }
        setMontajOrderTargetId(null)
      }

      setCreateOpen(false)
      setEditId(null)
      await loadAll()
    } catch (e: any) {
      const msg = String(e?.message ?? 'Alış siparişi kaydedilemedi')
      setDraftError(msg)
    } finally {
      setLoading(false)
    }
  }

  const requestDelete = (row: PurchaseInvoiceRow) => {
    const id = Number(row.id)
    if (!Number.isFinite(id) || id <= 0) {
      setError('Geçersiz id')
      return
    }
    setConfirmId(id)
    setConfirmText(`Alış siparişi silinsin mi? (${row.documentNo})`)
    setConfirmOpen(true)
  }

  const doDelete = async () => {
    try {
      if (!confirmId) return
      setConfirmBusy(true)
      await deletePurchaseInvoice(confirmId)
      setConfirmOpen(false)
      setConfirmId(null)
      await loadAll()
    } catch (e: any) {
      setError(String(e?.message ?? 'Alış siparişi silinemedi'))
      showMessage('Hata', String(e?.message ?? 'Alış siparişi silinemedi'))
    } finally {
      setConfirmBusy(false)
    }
  }

  const openProductPicker = (lineId: string, opts?: { serviceOnly?: boolean }) => {
    if (!draftKind) return
    if (draftKind === 'purchase' && !String(draftSupplier ?? '').trim()) return
    setEklenenUrunSayisi(0)
    setProductPickerServiceOnly(Boolean(opts?.serviceOnly))
    setProductPickerOpen(true)
    setProductPickerForLineId(lineId)
    setProductPickerQuery('')
    setProductPickerItems([])
    setProductPickerError(null)
  }

  /**
   * `serviceOnly` PARAMETRE olarak da alinir: `openProductPicker` state'i ayni tick icinde
   * guncelleyemedigi icin, hemen ardindan cagrilan arama `productPickerServiceOnly`yi hala
   * `false` goruyor ve hizmet yerine URUN listesi cekiyordu (pencere bos aciliyordu).
   */
  const searchProducts = async (q: string, filters?: { main?: string; sub?: string; serviceOnly?: boolean }) => {
    try {
      setProductPickerLoading(true)
      setProductPickerError(null)
      const cc = String(draftCustomer ?? '').trim()
      const dealerCode = draftKind === 'return' && cc ? cc : undefined
      /**
       * İADE'DE ÜRÜN LİSTESİ CARİNİN DÖVİZİNE GÖRE SÜZÜLMEZ (2026-08-20).
       *
       * Buradan uca `currencyCode` gönderiliyordu ve uç bunu ürünün FİYAT para birimine
       * uyguluyor. Sonuç: dövizli bir cari seçildiği anda ürün seçici TAMAMEN BOŞ kalıyordu —
       * "iade'de ürünler gelmiyor" şikâyeti bu. Canlı uçta doğrulandı: aynı cari için
       * `currencyCode` yokken 166 ürün, `currencyCode=2` (EUR cari) iken 0 ürün.
       *
       * Süzgeç zaten anlamsızdı: iade belgesinin para birimi ürünün değil CARİNİN dövizidir
       * (uç, iade kalemlerinin `currencyCode`unu carinin dövizinden türetiyor) ve iade,
       * daha önce satılmış malın geri alınmasıdır — ürünün fiyat kartı hangi dövizdeyse
       * öyledir, bu onu iade edilemez yapmaz. Fiyat yine cariye göre geliyor
       * (`priceCustomerCode`), yalnız KATALOG daraltılmıyor.
       *
       * Not: `cid === 4` (GBP) burada 3'e (USD) eşleniyordu; süzgeçle birlikte o hata da gitti.
       */
      const supplierId = draftKind === 'purchase' ? (selectedSupplier?.id ?? undefined) : undefined
      const main = filters?.main !== undefined ? filters.main : pickerMainCat
      const sub = filters?.sub !== undefined ? filters.sub : pickerSubCat

      /*
        HIZMET KIPI URUN KARTLARINA DEGIL HIZMET KATALOGUNA BAKAR (2026-09-18 duzeltme).

        Ilk surum `Products` icinde ProductType=HIZMET arayordu ve canlida listede tek bir
        kart cikti (MONTAJ-BEDELI). Bu firmanin gercek hizmet listesi `ServiceCatalogItems`
        tablosunda: HIZ-NAKLIYE, HIZ-ELEKTRIK, HIZ-GUMRUK... Hizmet faturasindaki "HIZMET"
        kutusu da ayni kaynaktan besleniyor; ikisi ayni listeyi gormeli, yoksa ayni nakliye
        bedeli iki farkli isimle raporlanirdi.

        Katalogda fiyat YOKTUR (kod + ad + para birimi): tutar her belgede farklidir, kullanici
        elle girer.
      */
      const hizmetKipi = filters?.serviceOnly ?? productPickerServiceOnly

      if (hizmetKipi) {
        const katalog = await fetchServiceCatalog()
        const arama = String(q ?? '').trim().toLocaleLowerCase('tr')
        const suzulmus = (katalog ?? [])
          .filter((x) => x.isActive !== false)
          .filter((x) =>
            !arama ||
            String(x.code ?? '').toLocaleLowerCase('tr').includes(arama) ||
            String(x.name ?? '').toLocaleLowerCase('tr').includes(arama)
          )

        setProductPickerItems(
          suzulmus.map((x) => ({
            id: '',
            stockCode: String(x.code ?? ''),
            name: String(x.name ?? ''),
            taxRate: 0,
            __basePrice: 0,
            __baseCurrency: (() => {
              const raw = Number(x.currencyTypeId ?? 0)
              return raw === 1 || raw === 0 ? '0' : String(raw)
            })(),
            __hizmetKatalogu: true
          }))
        )
        return
      }

      const res = await fetchProducts({
        q,
        main: main || undefined,
        sub: sub || undefined,
        page: 1,
        pageSize: 50,
        includeDealer: true,
        dealerCode,
        priceCustomerCode: dealerCode,
        supplierId,
        includeInactive: false
      })

      const items = (res.items ?? []) as any[]
      const ids = items.map((p) => trimId((p as any)?.id)).filter(Boolean)
      const f4Map = await fetchF4PriceMapForProductIds(ids)

      setProductPickerItems(
        items.map((p) => {
          const rawId = trimId((p as any)?.id)
          const f4 = (draftKind !== 'return' && rawId) ? f4Map[rawId] ?? f4Map[rawId.toLowerCase()] : undefined
          /*
            ALIŞTA PARA BİRİMİ ÜRÜNÜN ALIŞ DÖVİZİDİR (2026-08-29 kullanıcı bildirimi:
            "seçimde de TL geliyor, bazılarının varsayılan alımları dolar").

            Burası alış faturasında bile ÖNCE F4 fiyat grubunun dövizine bakıyordu. F4 SATIŞ
            tarafıdır ve çoğu üründe TL'dir; bu yüzden ürün seçim listesinde alış dövizi USD
            olan ürünler bile ₺ görünüyordu. Ürünün alış dövizi (`currencyCode`) sıralamada en
            sondaydı, sırası hiç gelmiyordu.

            Kural artık belgeye göre:
              alış      → ürünün ALIŞ dövizi (`currencyCode`)
              iade/hizmet → satış tarafı (F4 / `currency`), eski davranış

            Kodlama her yerde aynı: 1 TL, 2 EUR, 3 USD, 4 GBP. Eski kodda `dc === '3'` hem
            USD hem GBP dalında yazılıydı; ikincisi ölü koddu, temizlendi.
          */
          const dovizeCevir = (deger: unknown) => {
            const v = String(deger ?? '').trim().toUpperCase()
            if (!v) return ''
            if (v === '3' || v === 'USD') return 'USD'
            if (v === '2' || v === 'EUR') return 'EUR'
            if (v === '4' || v === 'GBP') return 'GBP'
            if (v === '1' || v === '0' || v === 'TL' || v === 'TRY') return 'TRY'
            return ''
          }

          const baseCurrency = (() => {
            if (draftKind === 'purchase') {
              return dovizeCevir(p.currencyCode ?? p.CurrencyCode) || 'TRY'
            }
            return dovizeCevir(f4?.currency)
              || dovizeCevir(p.currency ?? p.Currency)
              || dovizeCevir(p.currencyCode ?? p.CurrencyCode)
              || 'TRY'
          })()
          return {
            ...p,
            __basePrice: draftKind === 'purchase'
              ? (p.purchasePrice ?? p.PurchasePrice ?? 0)
              : draftKind === 'return'
                ? (p.unitPrice ?? p.UnitPrice ?? 0)
                : (f4?.price ?? p.unitPrice ?? p.UnitPrice ?? 0),
            __baseCurrency: baseCurrency
          }
        })
      )
    } catch (e: any) {
      setProductPickerItems([])
      setProductPickerError(String(e?.message ?? 'Ürünler alınamadı'))
    } finally {
      setProductPickerLoading(false)
    }
  }

  /*
    KART FİYATINI BELGENİN PARA BİRİMİNE ÇEVİRİR.

    Önce TL'ye (kartın kendi kuruyla), sonra belgenin kuruyla belge para birimine. Belge TL ise
    ikinci adım yoktur. Belgenin kuru başlıktaki kutudan gelir — kullanıcı elle değiştirdiyse
    TCMB değil ONUN kuru kullanılır, çünkü fatura o kurla kesiliyor.
  */
  const belgeFiyatinaCevir = (kartFiyati: number, kartDovizi: string) => {
    const tutar = Number(kartFiyati) || 0
    if (tutar <= 0) return 0
    const kartKuru = kartDovizi === 'TRY' || !kartDovizi ? 1 : (Number((fxRates as any)?.[kartDovizi]) || 1)
    const tl = tutar * kartKuru
    if (belgeTlMi) return Math.round(tl * 100) / 100
    const bKur = Number(String(belgeKuru).replace(',', '.')) || 1
    return bKur > 0 ? Math.round((tl / bKur) * 100) / 100 : 0
  }

  /*
    BELGE DÖVİZİ/KURU DEĞİŞİNCE YALNIZCA ELLE DÜZENLENMEMİŞ satırlar yeniden hesaplanır.

    Kullanıcı kararı (B): "kullanıcı ne yazdıysa o kalır". Elle girilmiş bir fiyatı döviz
    değişti diye ezmek, girilen veriyi sessizce kaybetmek olurdu. Otomatik doldurulmuş
    satırların güncellenmemesi ise ekranda tutarsız rakam bırakırdı.
  */
  useEffect(() => {
    setDraft((prev) => ({
      ...prev,
      lines: prev.lines.map((l: any) =>
        l.fiyatElleGirildi || !(Number(l.kartFiyati) > 0)
          ? l
          : { ...l, unitPrice: belgeFiyatinaCevir(Number(l.kartFiyati), String(l.kartDovizi ?? 'TRY')) }
      )
    }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [belgeDovizi, belgeKuru])

  /**
   * Secilen urunun satira yazacagi alanlar. Iki dugme de (Sec / Satira Ekle) BURAYI
   * kullanir; kopyalanmis iki ayri esleme birbirinden ayrisirdi.
   */
  const urunSatirYamasi = (p: any, mevcutSatir?: InvoiceLine) => {
    const defaultDiscountRate = Number((selectedCustomer as any)?.discountRate ?? 0)
    const shouldApplyDiscount =
      defaultDiscountRate > 0 &&
      (mevcutSatir?.discountType ?? 'none') === 'none' &&
      Number(mevcutSatir?.discountValue ?? 0) === 0

    return {
      productId: String(p?.id ?? ''),
      stockCode: String(p?.stockCode ?? p?.StockCode ?? ''),
      stockName: String(p?.name ?? p?.Name ?? ''),
      /*
        KART FİYATI SATIRDA SAKLANIR (2026-08-29).

        Ürün kartındaki alış fiyatı ve para birimi satırın üstünde referans olarak
        gösterilecek; fiyat kutusu ise BELGENİN para biriminde dolar.
      */
      kartFiyati: Number(p?.__basePrice ?? p?.unitPrice ?? p?.UnitPrice ?? 0),
      kartDovizi: p?.__baseCurrency ?? 'TRY',
      fiyatElleGirildi: false,
      unitPrice: belgeFiyatinaCevir(
        Number(p?.__basePrice ?? p?.unitPrice ?? p?.UnitPrice ?? 0),
        p?.__baseCurrency ?? 'TRY'
      ),
      vatRate: Number(p?.taxRate ?? p?.TaxRate ?? 0),
      currencyCode: p?.__baseCurrency ?? '0',
      ...(shouldApplyDiscount
        ? { discountType: 'percentage' as const, discountValue: defaultDiscountRate }
        : null)
    }
  }

  const selectProductForLine = (p: any) => {
    const lineId = productPickerForLineId
    if (!lineId) return

    // Hizmet satırı DEPOSUZ kurulur: hizmetin envanteri yok. Depo dolu kalsaydı ekranda
    // seçili görünür, kullanıcı stok girişi bekler; sunucu ise (haklı olarak) yazmazdı.
    const hizmetKipi = productPickerServiceOnly

    setDraft((prev) => ({
      ...prev,
      lines: prev.lines.map((l) =>
        l.id !== lineId ? l : { ...l, ...urunSatirYamasi(p, l), ...(hizmetKipi ? { warehouseCode: '' } : null) }
      )
    }))

    setProductPickerOpen(false)
    setProductPickerForLineId(null)
  }

  /**
   * MODALI KAPATMADAN SATIR EKLER (2026-09-01 kullanici istegi).
   *
   * Onceden tek yol vardi: "Sec" -> satir dolar, modal KAPANIR. Ayni tedarikciden bes
   * farkli klima almak icin kullanici bes kez "Satir Ekle > Sec > ara > sec" dongusunu
   * tekrarliyor, her seferinde aramayi bastan yaziyordu.
   *
   * Bu dugme urunu ekler ve modali ACIK BIRAKIR: bir kez "klima" aranir, bes urun de
   * ust uste eklenir. Hedef satir henuz bossa (urun secilmemis) once O doldurulur -
   * yoksa listede bos bir satir asili kalirdi.
   */
  const urunuYeniSatiraEkle = (p: any) => {
    if (draft.lines.length >= 17) {
      showMessage('Hata', 'En fazla 17 kalem sipariş edebilirsiniz.')
      return
    }

    setDraft((prev) => {
      const hedef = prev.lines.find((l) => l.id === productPickerForLineId)
      const hedefBos = hedef && !String(hedef.productId ?? '').trim() && !String(hedef.stockCode ?? '').trim()

      if (hedefBos) {
        return {
          ...prev,
          lines: prev.lines.map((l) => (l.id !== hedef!.id ? l : { ...l, ...urunSatirYamasi(p, l) }))
        }
      }

      const yeniSatir = { ...createEmptyLine(), ...urunSatirYamasi(p) }
      return { ...prev, lines: [...prev.lines, yeniSatir] }
    })

    // Hedef satir dolduruldu; sonraki "Ekle" yeni satir acsin.
    setProductPickerForLineId(null)
    setEklenenUrunSayisi((n) => n + 1)
  }

  /*
    İADE — SATIŞ FATURASINDAN DOLDUR (2026-10-14 kullanıcı isteği: "iade seçildiğinde fatura
    dökümünden fatura seçip satırları otomatik doldurabilelim; ne kadardan aldıysa ona göre").

    Seçilen faturaya ve fatura dökümüne HİÇBİR ŞEY yazılmaz: uçlar yalnız okur, satırlar iade
    taslağına KOPYALANIR. Kullanıcı sonra satır silip ekleyebilir; kayıt her zamanki iade yolundan
    geçer. Fiyat müşterinin ödediği NET birim fiyattır (başlık indirimi satırlara dağıtılmış).
  */
  const [iadeKaynakOpen, setIadeKaynakOpen] = useState(false)
  const [iadeKaynakQ, setIadeKaynakQ] = useState('')
  const [iadeKaynakList, setIadeKaynakList] = useState<ReturnSourceInvoice[]>([])
  const [iadeKaynakLoading, setIadeKaynakLoading] = useState(false)
  const [iadeKaynakError, setIadeKaynakError] = useState<string | null>(null)
  const [iadeKaynakSecilen, setIadeKaynakSecilen] = useState('')

  const iadeKaynaklariYukle = async (q?: string) => {
    const cari = String(draftCustomer ?? '').trim()
    if (!cari) return
    setIadeKaynakLoading(true)
    setIadeKaynakError(null)
    try {
      setIadeKaynakList(await fetchReturnSources(cari, q))
    } catch (e: any) {
      setIadeKaynakList([])
      setIadeKaynakError(e?.message || 'Faturalar alınamadı')
    } finally {
      setIadeKaynakLoading(false)
    }
  }

  const iadeKaynagiUygula = async (inv: ReturnSourceInvoice) => {
    setIadeKaynakLoading(true)
    setIadeKaynakError(null)
    try {
      const d = await fetchReturnSourceLines(inv.id)
      const tumu = d?.lines ?? []
      const satirlar = tumu.slice(0, 17)
      if (satirlar.length === 0) throw new Error('Bu faturada iade edilecek satır yok.')

      // Fatura dövizliyse iade de aynı para biriminde; kur her zamanki gibi TCMB'den gelir.
      const doviz = Number(d.currencyTypeId) > 1 ? Number(d.currencyTypeId) : 1
      setBelgeDovizi(doviz)
      setKurElleGirildi(false)

      const depo = satirlar.find((x) => Number(x.warehouseCode) > 0)?.warehouseCode
      if (depo && !selectedWarehouseCode && warehouses.some((w) => Number(w.warehouseCode) === Number(depo))) {
        setSelectedWarehouseCode(String(depo))
      }

      setDraft((p) => ({
        ...p,
        description: String(p.description ?? '').trim() ? p.description : `İade - Fatura No ${d.invoiceNo}`,
        // İade, faturanın KDV durumunu izler: KDV'li satılan mal KDV'siz iade alınırsa müşteriye eksik ödenir.
        vatExempt: satirlar.every((x) => !(Number(x.vatRate) > 0)),
        lines: satirlar.map((x) => ({
          ...createEmptyLine(),
          productId: x.productId ?? undefined,
          stockCode: x.stockCode,
          stockName: x.stockName,
          quantity: Number(x.quantity) || 1,
          unitPrice: Math.round((Number(x.netUnitPrice) || 0) * 100) / 100,
          vatRate: Number(x.vatRate) || 0,
          currencyCode: doviz > 1 ? String(doviz) : '0'
        }))
      }))
      setIadeKaynakSecilen(d.invoiceNo)
      setIadeKaynakOpen(false)
      if (tumu.length > 17) showMessage('Bilgi', 'Faturada 17\'den fazla satır var; ilk 17 satır alındı.')
    } catch (e: any) {
      setIadeKaynakError(e?.message || 'Fatura satırları alınamadı')
    } finally {
      setIadeKaynakLoading(false)
    }
  }

  const addDraftLine = () => {
    if (!draftKind) return
    if (draft.lines.length >= 17) {
      showMessage('Hata', 'En fazla 17 kalem sipariş edebilirsiniz.')
      return
    }
    setDraft((p) => ({ ...p, lines: [...p.lines, createEmptyLine()] }))
  }

  /**
   * HİZMET EKLE (2026-09-18 kullanıcı isteği).
   *
   * Alış faturasının içinde nakliye / işçilik gibi bedeller olabiliyor; bunlar ürün değil.
   * Düğme boş bir satır açıp ürün seçiciyi HİZMET kipinde gösterir: listede yalnız hizmet
   * kartları (ProductType HIZMET/SERVIS) çıkar.
   *
   * Satır faturanın TOPLAMINA girer (kullanıcı kararı): KDV'si hesaplanır, tedarikçi borcu
   * ve ekstre bu tutarı içerir. Ürün maliyetine DAĞITILMAZ ve stok hareketi yazmaz —
   * sunucuda satırın niteliği "hizmet" damgalandığı için stok yolu o satırı atlıyor.
   */
  const addServiceLine = () => {
    if (!draftKind) return
    if (draft.lines.length >= 17) {
      showMessage('Hata', 'En fazla 17 kalem sipariş edebilirsiniz.')
      return
    }
    const line = createEmptyLine()
    setDraft((p) => ({ ...p, lines: [...p.lines, line] }))
    openProductPicker(line.id, { serviceOnly: true })

    // Hizmet listesi KISA ve tedarikçiden bağımsız: pencere boş açılıp kullanıcıyı "Ara"ya
    // basmaya zorlamasın. Ürün seçicide bu yapılmıyor çünkü orada binlerce kayıt var ve
    // filtresiz ilk sayfa anlamsız.
    void searchProducts('', { main: '', sub: '', serviceOnly: true })
  }

  /**
   * Seçilen satırın HEMEN ALTINA boş bir satır açar.
   *
   * Alttaki "Satır Ekle" düğmesi listenin SONUNA ekliyor; 10 kalemlik bir belgede 3.
   * kalemin yanına ilgili ürünü koymak isteyen kullanıcı satırı en sona alıp elle
   * taşımak zorunda kalıyordu. Ürünü sonra bu yeni satırda seçiyor.
   */
  const insertDraftLineBelow = (lineId: string) => {
    if (!draftKind) return
    if (draft.lines.length >= 17) {
      showMessage('Hata', 'En fazla 17 kalem sipariş edebilirsiniz.')
      return
    }
    setDraft((p) => {
      const i = p.lines.findIndex((l) => l.id === lineId)
      if (i < 0) return { ...p, lines: [...p.lines, createEmptyLine()] }
      const next = [...p.lines]
      next.splice(i + 1, 0, createEmptyLine())
      return { ...p, lines: next }
    })
  }

  const removeDraftLine = (lineId: string) => {
    setDraft((p) => {
      const next = p.lines.filter((l) => l.id !== lineId)
      return { ...p, lines: next.length > 0 ? next : [createEmptyLine()] }
    })
  }

  const updateDraftLine = (lineId: string, patch: Partial<InvoiceLine>) => {
    setDraft((p) => ({ ...p, lines: p.lines.map((l) => (l.id === lineId ? { ...l, ...patch } : l)) }))
  }

  const submitCreateService = async () => {
    const name = String(serviceCreateForm.name ?? '').trim()
    let code = String(serviceCreateForm.code ?? '').trim().toUpperCase()
    if (!name) {
      setError('Hizmet adı zorunlu')
      return
    }

    if (!code) {
      code = 'HIZ-'
    }
    if (!code.toUpperCase().startsWith('HIZ-')) code = 'HIZ-' + code.replace(/^[-]+/, '')

    try {
      setServiceCreateBusy(true)
      setError(null)
      const created = await createServiceCatalogItem({
        code,
        name,
        isActive: true,
        currencyTypeId: Number(serviceCreateForm.currencyTypeId ?? 0)
      })
      await loadServices()
      setDraftService(String(created.code ?? ''))
      setServiceCreateOpen(false)
      setServiceCreateForm({ code: 'HIZ-', name: '', currencyTypeId: 0 })
    } catch (e: any) {
      setError(String(e?.message ?? 'Hizmet eklenemedi'))
    } finally {
      setServiceCreateBusy(false)
    }
  }

  return (
    <div>
      <Modal
        isOpen={confirmOpen}
        onClose={() => {
          if (confirmBusy) return
          setConfirmOpen(false)
          setConfirmId(null)
        }}
        title="Onay"
        footer={
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              disabled={confirmBusy}
              onClick={() => {
                setConfirmOpen(false)
                setConfirmId(null)
              }}
              className="px-3 py-2 text-xs font-semibold bg-gray-100 text-gray-700 rounded hover:bg-gray-200 disabled:opacity-60"
            >
              Vazgeç
            </button>
            <button
              type="button"
              disabled={confirmBusy || !confirmId}
              onClick={() => void doDelete()}
              className="px-3 py-2 text-xs font-semibold bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-60"
            >
              {confirmBusy ? 'Siliniyor...' : 'Sil'}
            </button>
          </div>
        }
      >
        <div className="text-xs text-gray-700 whitespace-pre-line">{confirmText}</div>
      </Modal>

      <Modal
        isOpen={iadeKaynakOpen}
        onClose={() => {
          if (!iadeKaynakLoading) setIadeKaynakOpen(false)
        }}
        title="Satış Faturasından İade Doldur"
        maxWidth="max-w-3xl"
      >
        <div className="space-y-3">
          <div className="text-[11px] text-gray-600">
            Seçilen faturanın satırları, müşterinin ödediği net birim fiyatla iade taslağına kopyalanır. Seçilen fatura
            değişmez; satırları sonra silip yenisini ekleyebilirsiniz.
          </div>
          <div className="flex items-center gap-2">
            <input
              className="flex-1 px-2.5 py-1.5 text-xs border border-gray-300 rounded bg-white"
              value={iadeKaynakQ}
              onChange={(e) => setIadeKaynakQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void iadeKaynaklariYukle(iadeKaynakQ)
              }}
              placeholder="Fatura no ile ara..."
            />
            <button
              type="button"
              onClick={() => void iadeKaynaklariYukle(iadeKaynakQ)}
              disabled={iadeKaynakLoading}
              className="px-3 py-1.5 text-xs font-semibold bg-gray-100 text-gray-700 rounded hover:bg-gray-200 disabled:opacity-60"
            >
              Ara
            </button>
          </div>
          {iadeKaynakError ? <div className="text-xs font-semibold text-red-600">{iadeKaynakError}</div> : null}
          <div className="border border-gray-200 rounded-lg overflow-auto max-h-[420px]">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 text-[11px] font-semibold text-gray-600 sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-left">Fatura No</th>
                  <th className="px-3 py-2 text-left">Tarih</th>
                  <th className="px-3 py-2 text-left">Cari</th>
                  <th className="px-3 py-2 text-right">Satır</th>
                  <th className="px-3 py-2 text-right">Genel Toplam</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {iadeKaynakLoading && iadeKaynakList.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-4 text-center text-gray-500">Yükleniyor...</td>
                  </tr>
                ) : iadeKaynakList.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-4 text-center text-gray-500">Bu cariye kesilmiş satış faturası bulunamadı.</td>
                  </tr>
                ) : (
                  iadeKaynakList.map((inv) => (
                    <tr key={inv.id} className="border-t border-gray-100 hover:bg-amber-50/40">
                      <td className="px-3 py-2 font-semibold text-gray-900">{inv.invoiceNo}</td>
                      <td className="px-3 py-2">{inv.date ? new Date(inv.date).toLocaleDateString('tr-TR') : '-'}</td>
                      <td className="px-3 py-2">{inv.customerCode}</td>
                      <td className="px-3 py-2 text-right">{inv.lineCount}</td>
                      <td className="px-3 py-2 text-right">{/* Fatura toplamı TL çapasıdır; başlıktaki para birimi eski faturalarda yanıltıcı olabiliyor. */}
                        {formatMoneyWithCurrency(Number(inv.grandTotal) || 0, '0')}</td>
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          disabled={iadeKaynakLoading}
                          onClick={() => void iadeKaynagiUygula(inv)}
                          className="px-2.5 py-1 text-[11px] font-semibold bg-amber-600 text-white rounded hover:bg-amber-700 disabled:opacity-60"
                        >
                          Seç
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={serviceCreateOpen}
        onClose={() => {
          if (serviceCreateBusy) return
          setServiceCreateOpen(false)
        }}
        title="Yeni Hizmet"
        containerClassName="max-w-xl"
        overlayClassName="z-[10000]"
        footer={
          <>
            <button
              type="button"
              disabled={serviceCreateBusy}
              onClick={() => setServiceCreateOpen(false)}
              className="px-4 py-2 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-800 font-semibold"
            >
              Vazgeç
            </button>
            <button
              type="button"
              disabled={serviceCreateBusy || !String(serviceCreateForm.name ?? '').trim()}
              onClick={() => void submitCreateService()}
              className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold disabled:opacity-60"
            >
              {serviceCreateBusy ? 'Kaydediliyor...' : 'Kaydet'}
            </button>
          </>
        }
      >
        <div className="grid grid-cols-12 gap-4">
          <div className="col-span-12 md:col-span-5">
            <FormInput
              label="Hizmet Kodu"
              value={serviceCreateForm.code}
              onChange={(e) => {
                const raw = String(e.target.value ?? '').toUpperCase().trim()
                if (!raw) {
                  setServiceCreateForm((p) => ({ ...p, code: '' }))
                  return
                }
                if (raw === 'HIZ') {
                  setServiceCreateForm((p) => ({ ...p, code: 'HIZ-' }))
                  return
                }
                if (raw.startsWith('HIZ-')) {
                  setServiceCreateForm((p) => ({ ...p, code: raw }))
                  return
                }
                const cleaned = raw.replace(/^[-]+/, '')
                setServiceCreateForm((p) => ({ ...p, code: 'HIZ-' + cleaned }))
              }}
              maxLength={50}
            />
          </div>
          <div className="col-span-12 md:col-span-7">
            <FormInput
              label="Hizmet Adı"
              value={serviceCreateForm.name}
              onChange={(e) => setServiceCreateForm((p) => ({ ...p, name: e.target.value }))}
            />
          </div>
          <div className="col-span-12 md:col-span-5">
            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">
              Para Birimi
            </label>
            <select
              className="input-base h-9 text-sm"
              value={String(serviceCreateForm.currencyTypeId ?? 0)}
              onChange={(e) =>
                setServiceCreateForm((p) => ({ ...p, currencyTypeId: Number(e.target.value) || 0 }))
              }
            >
              {SERVICE_CURRENCY_OPTIONS.map((opt) => (
                <option key={opt.value} value={String(opt.value)}>
                  {opt.label}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-gray-500 leading-relaxed mt-2">
              Hizmet faturaya eklendiğinde kalem bu para birimiyle açılır; kalemde
              değiştirilebilir.
            </p>
          </div>
        </div>
      </Modal>

      <PageHeader
        title="Alış Siparişleri"
        breadcrumb="Fatura İşlemleri / Alış Siparişleri"
        searchValue={globalSearch}
        onSearchChange={setGlobalSearch}
        leftActions={
          <button
            type="button"
            onClick={() => void openMontajOrders()}
            className="h-[38px] inline-flex items-center gap-2 px-4 text-xs font-semibold uppercase tracking-wider bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded-lg shadow-sm transition"
          >
            montajdan gelenler
          </button>
        }
        rightActions={
          <>
            <button
              type="button"
              onClick={() => void loadAll()}
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
            <button
              type="button"
              onClick={openCreate}
              className="h-[38px] inline-flex items-center gap-1.5 px-4 text-xs font-semibold uppercase tracking-wider bg-slate-900 hover:bg-slate-800 text-white rounded-lg shadow-sm transition"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M12 5v14" />
                <path d="M5 12h14" />
              </svg>
              Yeni Alış Siparişi
            </button>
          </>
        }
      />

      <Modal
        isOpen={montajOrdersOpen}
        onClose={() => setMontajOrdersOpen(false)}
        title="Montajdan Gelen Siparişler"
        footer={
          <button
            type="button"
            onClick={() => setMontajOrdersOpen(false)}
            className="h-[34px] px-4 text-xs font-semibold rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 transition"
          >
            Kapat
          </button>
        }
      >
        {montajOrdersError ? <div className="mb-3 text-xs font-semibold text-red-600">{montajOrdersError}</div> : null}
        {montajOrdersLoading ? (
          <div className="text-sm text-gray-600">Yükleniyor...</div>
        ) : montajOrders.length === 0 ? (
          <div className="text-sm text-gray-500">Kayıt bulunamadı.</div>
        ) : (
          <div className="space-y-2">
            {montajOrders.map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={async () => {
                  try {
                    const init = createEmptyInvoice()
                    const docNo = ''

                    const dealerCode = (() => {
                      try {
                        const raw = localStorage.getItem('selected_dealer_v1')
                        if (!raw) return undefined
                        const parsed = JSON.parse(raw)
                        const code = String(parsed?.code ?? '').trim()
                        return code || undefined
                      } catch {
                        return undefined
                      }
                    })()

                    const effectiveSuppliers = await (async () => {
                      if (Array.isArray(suppliers) && suppliers.length > 0) return suppliers
                      try {
                        const ac = new AbortController()
                        const s = await fetchSuppliers({ includeCustomers: true, signal: ac.signal })
                        setSuppliers(s ?? [])
                        return s ?? []
                      } catch {
                        return [] as SupplierDto[]
                      }
                    })()

                    const pid = String((o as any)?.erpProductId ?? '').trim()
                    if (!pid) throw new Error('Ürün id bulunamadı')

                    const [priceMap, byIdRes] = await Promise.all([
                      fetchF4PriceMapForProductIds([pid]).catch(() => ({})),
                      fetchProducts({
                        id: pid,
                        includeInactive: true,
                        page: 1,
                        pageSize: 5
                      }).catch(() => null)
                    ])

                    const productFromId: any = (byIdRes as any)?.items?.[0] ?? (byIdRes as any)?.data?.items?.[0] ?? null

                    const res = await fetchProducts({
                      q: String(o.stockCode ?? '').trim(),
                      includeDealer: true,
                      dealerCode,
                      includeInactive: true,
                      page: 1,
                      pageSize: 5
                    })

                    const item: any = productFromId ?? (res as any)?.items?.[0] ?? (res as any)?.data?.items?.[0] ?? null
                    const productId = pid
                    const stockCode = String(item?.stockCode ?? o.stockCode ?? '').trim()
                    const stockName = String(item?.name ?? o.partName ?? '').trim()
                    const unitPrice = Number(item?.purchasePrice ?? 0)
                    const vatRate = Number(item?.taxRate ?? 0)
                    const supplierId = item?.supplierId == null ? null : Number(item.supplierId)

                    const supplierCode = supplierId
                      ? (effectiveSuppliers.find((s) => Number(s.id) === Number(supplierId))?.supplierCode ?? '')
                      : ''

                    const defaultWarehouse = pickDefaultWarehouseCode(warehouses)
                    const lineId = 'line-0'
                    setDraft({
                      ...init,
                      vatExempt: true,
                      documentNo: docNo || init.documentNo,
                      lines: [
                        {
                          id: lineId,
                          productId: productId || undefined,
                          warehouseCode: defaultWarehouse ? String(defaultWarehouse) : undefined,
                          stockCode,
                          stockName,
                          description: '',
                          quantity: Number(o.quantityRequested ?? 1),
                          unitPrice: Number.isFinite(unitPrice) ? unitPrice : 0,
                          discountType: 'none',
                          discountValue: 0,
                          vatRate: Number.isFinite(vatRate) ? vatRate : 0,
                        }
                      ]
                    })
                    setDraftKind('purchase')
                    setDraftSupplier(String(supplierCode ?? '').trim())
                    setDraftService('')
                    setDraftCustomer('')
                    setDraftSalesRep('')
                    setEditId(null)
                    setDraftError(null)
                    setMontajOrderTargetId(String(o.id))
                    setMontajOrdersOpen(false)
                    setCreateOpen(true)
                  } catch (e: any) {
                    setMontajOrdersError(String(e?.message ?? 'Fatura açılamadı'))
                  }
                }}
                className="w-full text-left px-4 py-3 rounded-lg border border-gray-200 hover:bg-gray-50 transition"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-bold text-gray-900 truncate">{o.partName}</div>
                  <div className="text-xs font-semibold text-gray-600">{o.quantityRequested} adet</div>
                </div>
                <div className="mt-1 text-[11px] text-gray-500">{o.technicianName} teknisyeni</div>
                <div className="mt-0.5 text-[11px] text-gray-400 font-mono">{o.stockCode}</div>
              </button>
            ))}
          </div>
        )}
      </Modal>

      {error && <div className="mb-3 text-sm font-semibold text-red-600">{error}</div>}

      <AppDataTable
        onRefresh={() => void loadAll()}
        data={filteredRows}
        columns={purchaseInvoiceColumns}
        rowId={(row) => String(row.id)}
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
        isOpen={headerEditOpen}
        onClose={() => {
          if (headerEditBusy) return
          setHeaderEditOpen(false)
          setHeaderEditId(null)
        }}
        title="Üst Bilgi Güncelle"
        footer={
          <>
            <button
              type="button"
              disabled={headerEditBusy}
              onClick={() => {
                setHeaderEditOpen(false)
                setHeaderEditId(null)
              }}
              className="px-4 py-2 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-800 font-semibold"
            >
              Kapat
            </button>
            <button
              type="button"
              disabled={headerEditBusy}
              onClick={() => void submitHeaderEdit()}
              className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold disabled:opacity-60"
            >
              {headerEditBusy ? 'Kaydediliyor...' : 'Kaydet'}
            </button>
          </>
        }
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormInput
            label="Belge No"
            value={headerEditForm.documentNo}
            onChange={(e) => setHeaderEditForm((p) => ({ ...p, documentNo: e.target.value }))}
            maxLength={15}
          />

          {headerEditKind === 'purchase' ? (
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">Tedarikçi</label>
              <SearchableCariSelect
                value={headerEditForm.supplierCode}
                onChange={(val) => setHeaderEditForm((p) => ({ ...p, supplierCode: val }))}
                options={supplierCariOptions}
                remoteSearch={supplierRemoteSearch}
                remoteLimit={CARI_SEARCH_LIMIT}
                showTypeFilter={false}
                placeholder="Tedarikçi Ara (Kod, İsim, Tel)..."
                disabled={suppliersLoading}
              />
            </div>
          ) : headerEditKind === 'service' ? (
            <>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Cari (Hizmet)</label>
                <SearchableCariSelect
                  value={headerEditForm.customerCode}
                  onChange={(val) => setHeaderEditForm((p) => ({ ...p, customerCode: val }))}
                  options={serviceCustomerCariOptions}
                  remoteSearch={serviceCustomerRemoteSearch}
                  remoteLimit={CARI_SEARCH_LIMIT}
                  showTypeFilter={false}
                  placeholder="Hizmet Carisi Ara (Kod, İsim, Tel)..."
                  disabled={customersLoading}
                />
              </div>
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <FormSelect
                    label="Hizmet"
                    value={headerEditForm.serviceCode}
                    onChange={(e) => setHeaderEditForm((p) => ({ ...p, serviceCode: e.target.value }))}
                    options={[
                      { value: '', label: servicesLoading ? 'Yükleniyor...' : 'Seçiniz...' },
                      ...(services ?? []).map((s) => ({ value: String((s as any).code ?? ''), label: `${String((s as any).code ?? '')} - ${String((s as any).name ?? '')}`.trim() }))
                    ]}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setError(null)
                    setServiceCreateOpen(true)
                  }}
                  className="h-9 px-3 rounded-md bg-white border border-gray-200 text-gray-700 hover:bg-gray-50"
                  title="Yeni Hizmet"
                >
                  <Plus size={16} />
                </button>
              </div>
            </>
          ) : (
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">Cari</label>
              <SearchableCariSelect
                value={headerEditForm.customerCode}
                onChange={(val) => setHeaderEditForm((p) => ({ ...p, customerCode: val }))}
                options={allCustomerCariOptions}
                remoteSearch={customerRemoteSearch}
                remoteLimit={CARI_SEARCH_LIMIT}
                showTypeFilter={false}
                placeholder="Cari Ara (Kod, İsim, Tel)..."
                disabled={customersLoading}
              />
            </div>
          )}
        </div>
      </Modal>

      <Modal
        isOpen={createOpen}
        onClose={() => {
          if (loading) return
          setCreateOpen(false)
          setEditId(null)
          setDraftError(null)
        }}
        title={editId ? 'Alış Siparişi (Düzenle)' : 'Alış Siparişi'}
        scrollable
        containerClassName="max-w-[95vw]"
        footer={
          <>
            <button
              type="button"
              onClick={() => {
                setCreateOpen(false)
                setEditId(null)
              }}
              className="px-4 py-2 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-800 font-semibold"
            >
              Vazgeç
            </button>
            <button
              type="button"
              onClick={() => void saveDraft()}
              className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
            >
              {loading ? 'Kaydediliyor...' : 'Kaydet'}
            </button>
          </>
        }
      >
        {draftError && <div className="mb-3 text-sm font-semibold text-red-600">{draftError}</div>}
        <div className="grid grid-cols-12 gap-5">
          <div className="col-span-12">
            <div className="border border-slate-200/90 rounded-xl bg-slate-50/60 p-3.5 shadow-sm space-y-3">
              {/* Row 1: Document details */}
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 items-end">
                <FormInput
                  label="Belge No"
                  value={draft.documentNo}
                  onChange={(e) => setDraft((p) => ({ ...p, documentNo: e.target.value.slice(0, 15) }))}
                  placeholder="Belge numarası"
                  requiredMark
                  maxLength={15}
                />
                <FormInput label="Tarih" type="date" value={draft.date} onChange={(e) => setDraft((p) => ({ ...p, date: e.target.value }))} />

                <FormSelect
                  label="Tip"
                  value={draftKind}
                  onChange={(e) => {
                    const v = e.target.value as any

                    setDraftKind(v)
                    setDraftSupplier('')
                    setDraftService('')
                    setDraftCustomer('')
                    setDraftSalesRep('')
                    setDraft((p) => {
                      // Elle yazılmış numara KORUNUR; yalnızca boş alan ya da bizim
                      // ürettiğimiz eski otomatik numara yenilenir.
                      const onceki = String(p.documentNo ?? '')
                      const elleYazilmis = onceki.trim().length > 0 && !otomatikBelgeNoMu(onceki)

                      return {
                      ...p,
                      documentNo: elleYazilmis ? onceki : otomatikBelgeNoUret(v),
                      vatExempt: v === 'service' || v === 'purchase' ? true : p.vatExempt,
                      lines: p.lines.map((l) =>
                        v === 'service'
                          ? { ...l, productId: undefined, warehouseCode: '', stockCode: '', stockName: '', vatRate: 0, discountType: 'none', discountValue: 0 }
                          : l
                      )
                      }
                    })
                  }}
                  options={[
                    { value: '', label: 'Seçiniz...', disabled: true },
                    ...(isSuperAdmin || allowedKeys?.has('invoice/alisTipAlis') ? [{ value: 'purchase', label: 'Alış' }] : []),
                    ...(isSuperAdmin || allowedKeys?.has('invoice/alisTipHizmet') ? [{ value: 'service', label: 'Hizmet' }] : []),
                    ...(isSuperAdmin || allowedKeys?.has('invoice/alisTipIade') ? [{ value: 'return', label: 'İade' }] : [])
                  ]}
                />

                {draftKind ? (
                  <FormSelect
                    label="Plasiyer Kodu"
                    value={draftSalesRep}
                    onChange={(e) => setDraftSalesRep(e.target.value)}
                    options={[
                      { value: '', label: salesmenLoading ? 'Yükleniyor...' : 'Seçiniz...' },
                      ...(salesmen ?? []).map((s) => ({
                        value: s.salesmanCode,
                        label: `${s.salesmanCode} - ${s.description}`
                      }))
                    ]}
                    disabled={!draftKind || salesmenLoading}
                  />
                ) : (
                  <div className="space-y-1">
                    <label className="block text-xs font-semibold text-gray-400 select-none">Plasiyer</label>
                    <div className="h-9 bg-white/60 border border-dashed border-gray-200 rounded-lg" />
                  </div>
                )}
              </div>

              {/* Row 2: Customer / Partner Details + Description + VAT */}
              {draftKind && (
                <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end pt-1 border-t border-slate-200/60">
                  {draftKind === 'purchase' && (
                    <>
                      <div className="md:col-span-6">
                        <label className="block text-xs font-semibold text-gray-700 mb-1">
                          Tedarikçi <span className="text-red-500">*</span>
                        </label>
                        <SearchableCariSelect
                          value={draftSupplier}
                          onChange={(val) => setDraftSupplier(val)}
                          options={supplierCariOptions}
                          remoteSearch={supplierRemoteSearch}
                          remoteLimit={CARI_SEARCH_LIMIT}
                          showTypeFilter={false}
                          placeholder="Tedarikçi Ara (Kod, İsim, Tel)..."
                          disabled={suppliersLoading}
                        />
                      </div>
                      <div className="md:col-span-4">
                        <FormInput
                          label="Açıklama"
                          value={draft.description ?? ''}
                          onChange={(e) => setDraft((p) => ({ ...p, description: e.target.value }))}
                          placeholder="Fatura açıklaması..."
                        />
                      </div>
                      <div className="md:col-span-2 pb-2">
                        <label className="inline-flex items-center gap-2 text-xs font-semibold text-gray-700 cursor-pointer bg-white px-2.5 py-1.5 rounded-lg border border-slate-200 shadow-2xs">
                          <input
                            type="checkbox"
                            className="w-4 h-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                            checked={true}
                            onChange={(e) => setDraft((p) => ({ ...p, vatExempt: e.target.checked }))}
                            disabled={true}
                          />
                          KDV İstisna
                        </label>
                      </div>

                      {/*
                        ALIŞ DÖVİZİ + KUR (2026-08-29).
                        Belgenin para birimi artık burada BEYAN EDİLİYOR. Varsayılan TL;
                        dövizli seçilirse kur TCMB'den dolu gelir ama elle değiştirilebilir —
                        tedarikçinin faturasındaki kur günün kurundan farklı olabilir.
                      */}
                      <div className="md:col-span-2">
                        <label className="block text-xs font-semibold text-gray-700 mb-1">Alış Dövizi</label>
                        <select
                          className="w-full h-9 px-2 rounded-lg border border-slate-200 text-sm bg-white"
                          value={String(belgeDovizi)}
                          onChange={(e) => { setBelgeDovizi(Number(e.target.value) || 1); setKurElleGirildi(false) }}
                        >
                          <option value="1">₺ TL</option>
                          <option value="3">$ USD</option>
                          <option value="2">€ EUR</option>
                          <option value="4">£ GBP</option>
                        </select>
                      </div>

                      {!belgeTlMi && (
                        <div className="md:col-span-2">
                          <FormInput
                            label={`Kur (1 ${belgeDovizKodu} = ₺)`}
                            value={belgeKuru}
                            onChange={(e) => { setBelgeKuru(e.target.value); setKurElleGirildi(true) }}
                            placeholder="48,1331"
                          />
                          <div className="mt-1 text-[11px] text-slate-500">
                            {kurElleGirildi
                              ? 'Elle girildi — kayıtta "Manuel" damgalanır'
                              : `TCMB kuru · 1 ${belgeDovizKodu} = ${String((fxRates as any)?.[belgeDovizKodu] ?? '-')} ₺`}
                          </div>
                        </div>
                      )}
                    </>
                  )}

                  {draftKind === 'service' && (
                    <>
                      <div className="md:col-span-4">
                        <label className="block text-xs font-semibold text-gray-700 mb-1">
                          Cari (Hizmet) <span className="text-red-500">*</span>
                        </label>
                        <SearchableCariSelect
                          value={draftCustomer}
                          onChange={(val) => setDraftCustomer(val)}
                          options={serviceCustomerCariOptions}
                          remoteSearch={serviceCustomerRemoteSearch}
                          remoteLimit={CARI_SEARCH_LIMIT}
                          showTypeFilter={false}
                          placeholder="Hizmet Carisi Ara (Kod, İsim, Tel)..."
                          disabled={customersLoading}
                        />
                      </div>
                      <div className="md:col-span-4 flex items-end gap-1.5">
                        <div className="flex-1">
                          <FormSelect
                            label="Hizmet"
                            value={draftService}
                            onChange={(e) => setDraftService(e.target.value)}
                            options={[
                              { value: '', label: servicesLoading ? 'Yükleniyor...' : 'Seçiniz...', disabled: true },
                              ...(services ?? []).map((s) => ({ value: s.code, label: `${s.code} - ${s.name}` }))
                            ]}
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setError(null)
                            setServiceCreateOpen(true)
                          }}
                          className="h-9 px-2.5 rounded-md bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 flex items-center justify-center shadow-2xs"
                          title="Yeni Hizmet"
                        >
                          <Plus size={16} />
                        </button>
                      </div>
                      <div className="md:col-span-4">
                        <FormInput
                          label="Açıklama"
                          value={draft.description ?? ''}
                          onChange={(e) => setDraft((p) => ({ ...p, description: e.target.value }))}
                          placeholder="Fatura açıklaması..."
                        />
                      </div>
                    </>
                  )}

                  {draftKind === 'return' && (
                    <>
                      <div className="md:col-span-4">
                        <label className="block text-xs font-semibold text-gray-700 mb-1">
                          Cari <span className="text-red-500">*</span>
                        </label>
                        <SearchableCariSelect
                          value={draftCustomer}
                          onChange={(val) => {
                            setDraftCustomer(val)
                            setIadeKaynakSecilen('')
                            setDraft((p) => ({ ...p, lines: [createEmptyLine()] }))
                          }}
                          options={allCustomerCariOptions}
                remoteSearch={customerRemoteSearch}
                remoteLimit={CARI_SEARCH_LIMIT}
                          showTypeFilter={false}
                          placeholder="Cari Ara (Kod, İsim, Tel)..."
                          disabled={customersLoading}
                        />
                        <div className="mt-1.5 flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            disabled={!String(draftCustomer ?? '').trim()}
                            onClick={() => {
                              setIadeKaynakOpen(true)
                              setIadeKaynakQ('')
                              void iadeKaynaklariYukle()
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-amber-50 text-amber-800 border border-amber-200 hover:bg-amber-100 disabled:opacity-50 disabled:cursor-not-allowed"
                            title={String(draftCustomer ?? '').trim() ? 'Carinin satış faturalarından birini seçip satırları doldurun' : 'Önce cari seçin'}
                          >
                            Satış faturasından doldur
                          </button>
                          {iadeKaynakSecilen ? (
                            <span className="text-[11px] text-gray-600">
                              Kaynak fatura: <b>{iadeKaynakSecilen}</b> (fatura değişmedi)
                            </span>
                          ) : null}
                        </div>
                      </div>

                      {warehouses.length > 1 ? (
                        <div className="md:col-span-3">
                          <FormSelect
                            label="Giriş Deposu"
                            value={selectedWarehouseCode}
                            onChange={(e) => setSelectedWarehouseCode(e.target.value)}
                            options={[
                              { value: '', label: 'Depo Seçiniz...' },
                              ...(warehouses ?? []).map((w) => ({ value: String(w.warehouseCode), label: `${w.warehouseCode} - ${w.name}` }))
                            ]}
                            requiredMark
                          />
                        </div>
                      ) : null}

                      <div className={warehouses.length > 1 ? "md:col-span-3" : "md:col-span-6"}>
                        <FormInput
                          label="Açıklama"
                          value={draft.description ?? ''}
                          onChange={(e) => setDraft((p) => ({ ...p, description: e.target.value }))}
                          placeholder="İade açıklaması..."
                        />
                      </div>
                      <div className="md:col-span-2 pb-2">
                        <label className="inline-flex items-center gap-2 text-xs font-semibold text-gray-700 cursor-pointer bg-white px-2.5 py-1.5 rounded-lg border border-slate-200 shadow-2xs">
                          <input
                            type="checkbox"
                            className="w-4 h-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                            checked={draft.vatExempt}
                            onChange={(e) => setDraft((p) => ({ ...p, vatExempt: e.target.checked }))}
                            disabled={!draftKind}
                          />
                          KDV İstisna
                        </label>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="col-span-12">
            <div className="flex items-center justify-between mb-3">
              <div className="text-sm font-semibold text-gray-900">Kalemler</div>
              {!draftKind ? <div className="text-xs font-semibold text-gray-500">Önce Tip seçiniz</div> : null}
            </div>

            <div className="border border-gray-200 rounded-lg bg-white overflow-x-auto">
              <table className="w-full min-w-[1400px]">
                <thead>
                  <tr className="bg-gray-50 text-[11px] font-semibold text-gray-600">
                    <th className="px-3 py-2 text-left w-[72px]">Stok</th>
                    <th className="px-3 py-2 text-left">Stok Kodu / Adı</th>
                    <th className="px-3 py-2 text-left w-[220px]">Açıklama</th>
                    <th className="px-3 py-2 text-right w-[110px]">Miktar</th>
                    {/* Para birimi başlıkta yazar: kullanıcı hangi birimde yazdığını görmeli. */}
                    <th className="px-3 py-2 text-right w-[140px]">Fiyat ({belgeSimgesi})</th>
                    <th className="px-3 py-2 text-left w-[130px]">İndirim Tipi</th>
                    <th className="px-3 py-2 text-right w-[110px]">İskonto</th>
                    <th className="px-3 py-2 text-right">Net</th>
                    <th className="px-3 py-2 text-right w-[80px]">KDV</th>
                    <th className="px-3 py-2 text-right">KDV Tutar</th>
                    <th className="px-3 py-2 text-right">Toplam</th>
                    <th className="px-3 py-2 text-right w-[60px]" />
                  </tr>
                </thead>

                <tbody className="text-[12px]">
                  {draft.lines.map((l) => {
                    const t = calcLineTotals(l, draft.vatExempt)
                    const stockText =
                      draftKind === 'service'
                        ? `${String(draftService ?? '').trim()} ${(selectedService?.name ?? '').trim()}`.trim()
                        : `${(l.stockCode ?? '').trim()} ${(l.stockName ?? '').trim()}`.trim()

                    return (
                      <tr key={l.id} className="border-t border-gray-100 hover:bg-gray-50">

                        <td className="px-3 py-2 align-top">
                          {
                            draftKind === 'service' ? null : (
                              <button
                                type="button"
                                className="text-xs font-semibold text-blue-600 hover:text-blue-700"
                                onClick={() => {
                                  openProductPicker(l.id)
                                }}
                                disabled={!draftKind || (draftKind === 'purchase' && !String(draftSupplier ?? '').trim())}
                              >
                                Seç
                              </button>
                            )
                          }
                        </td>

                        <td className="px-3 py-2 align-top">
                          <input
                            className="w-full px-2 py-1 text-xs border border-gray-300 rounded bg-white"
                            value={stockText}
                            onChange={() => { }}
                            placeholder="Stok Kodu / Adı"
                            readOnly
                          />
                        </td>

                        <td className="px-3 py-2 align-top">
                          <input
                            className="w-full px-2 py-1 text-xs border border-gray-300 rounded"
                            value={String(l.description ?? '')}
                            onChange={(e) => updateDraftLine(l.id, { description: e.target.value })}
                            placeholder="Kalem açıklaması"
                            disabled={!draftKind}
                          />
                        </td>

                        <td className="px-3 py-2 align-top text-right">
                          <input
                            type="number"
                            min={0}
                            className="w-[100px] px-2 py-1 text-xs border border-gray-300 rounded text-right"
                            value={String(l.quantity)}
                            onChange={(e) => updateDraftLine(l.id, { quantity: Math.max(0, Number(e.target.value)) })}
                            disabled={!draftKind}
                          />
                        </td>

                        <td className="px-3 py-2 align-top text-right">
                          <input
                            type="number"
                            className="w-[120px] px-2 py-1 text-xs border border-gray-300 rounded text-right"
                            value={String(l.unitPrice)}
                            onChange={(e) => updateDraftLine(l.id, {
                              unitPrice: Math.max(0, Number(e.target.value)),
                              // Elle girildi: bundan sonra döviz/kur değişse de bu fiyat korunur.
                              fiyatElleGirildi: true
                            } as any)}
                            disabled={!draftKind}
                          />
                          {/*
                            KART FİYATI + EFEKTİF KUR (2026-08-29).
                            Kart fiyatı referanstır: kullanıcı 159 USD'lik ürünü TL belgeye
                            yazarken neyin karşılığını girdiğini görür. Efektif kur BİLGİDİR —
                            kullanıcı kararı (B) gereği başka satırı etkilemez, faturanın kuru
                            başlıktaki kutudan gelir.
                          */}
                          {Number((l as any).kartFiyati) > 0 && (
                            <div className="mt-1 text-[10px] leading-tight text-slate-500">
                              <div>
                                Kart: {formatMoneyWithCurrency(Number((l as any).kartFiyati), String((l as any).kartDovizi ?? 'TRY'))}
                              </div>
                              {String((l as any).kartDovizi ?? 'TRY') !== draftCurrency && Number(l.unitPrice) > 0 && (
                                <div className={(l as any).fiyatElleGirildi ? 'text-amber-600 font-semibold' : ''}>
                                  Efektif kur: {(Number(l.unitPrice) / Number((l as any).kartFiyati)).toFixed(4)}
                                  {(l as any).fiyatElleGirildi ? ' · elle' : ''}
                                </div>
                              )}
                            </div>
                          )}
                        </td>

                        <td className="px-3 py-2 align-top">
                          <select
                            className="w-[120px] px-2 py-1 text-xs border border-gray-300 rounded"
                            value={l.discountType}
                            onChange={(e) => updateDraftLine(l.id, { discountType: e.target.value as DiscountType, discountValue: 0 })}
                            disabled={!draftKind || draftKind === 'service'}
                          >
                            {discountTypeOptions.map((o) => (
                              <option key={o.value} value={o.value}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                        </td>

                        <td className="px-3 py-2 align-top text-right">
                          <input
                            type="number"
                            min={0}
                            className="w-[90px] px-2 py-1 text-xs border border-gray-300 rounded text-right"
                            value={String(l.discountValue)}
                            onChange={(e) => updateDraftLine(l.id, { discountValue: Math.max(0, Number(e.target.value)) })}
                            disabled={!draftKind || draftKind === 'service' || l.discountType === 'none'}
                          />
                        </td>

                        <td className="px-3 py-2 align-top text-right">{formatMoneyWithCurrency(t.net, draftCurrency)}</td>

                        <td className="px-3 py-2 align-top text-right">
                          <input
                            type="number"
                            min={0}
                            className="w-[70px] px-2 py-1 text-xs border border-gray-300 rounded text-right"
                            value={String(l.vatRate)}
                            onChange={(e) => updateDraftLine(l.id, { vatRate: Math.max(0, Number(e.target.value)) })}
                            disabled={!draftKind || draft.vatExempt || draftKind === 'service'}
                          />
                        </td>

                        <td className="px-3 py-2 align-top text-right">{formatMoneyWithCurrency(t.vatAmount, draftCurrency)}</td>
                        <td className="px-3 py-2 align-top text-right font-semibold">{formatMoneyWithCurrency(t.total, draftCurrency)}</td>

                        <td className="px-3 py-2 align-top text-right whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => insertDraftLineBelow(l.id)}
                            className="inline-flex items-center justify-center w-8 h-8 rounded hover:bg-emerald-50"
                            title="Altına satır ekle"
                            disabled={!draftKind}
                          >
                            <Plus size={16} className="text-emerald-600" />
                          </button>
                          <button
                            type="button"
                            onClick={() => removeDraftLine(l.id)}
                            className="inline-flex items-center justify-center w-8 h-8 rounded hover:bg-red-50"
                            title="Sil"
                            disabled={!draftKind}
                          >
                            <Trash2 size={16} className="text-red-600" />
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <div className="mt-2 flex justify-end gap-2">
              {draftKind === 'purchase' && (
                <button
                  type="button"
                  onClick={addServiceLine}
                  disabled={!draftKind}
                  title="Nakliye, işçilik gibi hizmet bedelini faturaya ekle"
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-indigo-200 bg-indigo-50 hover:bg-indigo-100 text-indigo-800 font-semibold disabled:opacity-60"
                >
                  <Plus size={16} />
                  Hizmet Ekle
                </button>
              )}
              <button
                type="button"
                onClick={addDraftLine}
                disabled={!draftKind}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-800 font-semibold disabled:opacity-60"
              >
                <Plus size={16} />
                Satır Ekle
              </button>
            </div>

            <div className="mt-4 border border-gray-200 rounded-lg bg-gray-50 p-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                {(() => {
                  return (
                    <>
                      <div className="text-gray-600">Ara Toplam</div>
                      <div className="text-right font-semibold text-gray-900">{formatMoneyWithCurrency(draftTotals.subTotal, draftCurrency)}</div>
                      <div className="text-gray-600">İndirim</div>
                      <div className="text-right font-semibold text-gray-900">{formatMoneyWithCurrency(draftTotals.discountTotal, draftCurrency)}</div>
                      <div className="text-gray-600">Net Toplam</div>
                      <div className="text-right font-semibold text-gray-900">{formatMoneyWithCurrency(draftTotals.netTotal, draftCurrency)}</div>
                      <div className="text-gray-600">KDV Toplam</div>
                      <div className="text-right font-semibold text-gray-900">{formatMoneyWithCurrency(draftTotals.vatTotal, draftCurrency)}</div>
                      <div className="text-gray-800">Genel Toplam</div>
                      <div className="text-right font-bold text-gray-900">{formatMoneyWithCurrency(draftTotals.grandTotal, draftCurrency)}</div>
                    </>
                  )
                })()}
              </div>
            </div>
          </div>
        </div>
      </Modal>

      {actionsOpenForId && actionsMenuPos
        ? createPortal(
          <div
            ref={actionsMenuRef}
            className="fixed z-[9999] w-[210px] bg-white border border-gray-100 rounded-xl shadow-lg overflow-hidden py-1"
            style={{ top: actionsMenuPos.top, left: actionsMenuPos.left }}
            onMouseDown={(e) => {
              e.preventDefault()
              e.stopPropagation()
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {canDuzenle && (
              <button
                type="button"
                className="w-full px-3 py-2 text-xs text-gray-700 hover:bg-gray-50 flex items-center gap-2 font-medium"
                onClick={() => {
                  const id = actionsOpenForId
                  setActionsOpenForId(null)
                  const row = rows.find((x) => String(x.id) === String(id))
                  if (row) void openEdit(row.id)
                }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-blue-600"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                Düzenle
              </button>
            )}

            {(() => {
              const row = rows.find((x) => String(x.id) === String(actionsOpenForId))
              if (row && Number(row.kind) === 0 && canTermin) {
                return (
                  <button
                    type="button"
                    className="w-full px-3 py-2 text-xs text-gray-700 hover:bg-gray-50 flex items-center gap-2 font-medium"
                    onClick={() => {
                      setActionsOpenForId(null)
                      navigate(`/invoice/termin?openStatusModalForId=${row.id}`)
                    }}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-purple-600"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                    Termin
                  </button>
                )
              }
              return null
            })()}

            {canUpdateHeader && (
              <button
                type="button"
                className="w-full px-3 py-2 text-xs text-gray-700 hover:bg-gray-50 flex items-center gap-2 font-medium"
                onClick={() => {
                  const id = actionsOpenForId
                  setActionsOpenForId(null)
                  const row = rows.find((x) => String(x.id) === String(id))
                  if (row) openHeaderEdit(row)
                }}
              >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-emerald-600"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
              Üst Bilgi Güncelle
              </button>
            )}

            {canSil && (() => {
              const row = rows.find((x) => String(x.id) === String(actionsOpenForId))
              if (!row) return null
              const canDeleteAll = isSuperAdmin || allowedKeys?.has('deleteRule/tumIslemleriSilebilsin') || allowedKeys?.has('deleteRule/deleteRule/tumIslemleriSilebilsin')
              const currentUsername = (localStorage.getItem('userName') || '').toLowerCase()
              // `islemYapan` diye bir alan yok: API `CreateUser` donuyor ve liste de onu gosteriyor.
              // Olu yedek, tip hatasi uretiyordu.
              const recordUser = String(row.createUser || '').toLowerCase()
              const isOwner = Boolean(currentUsername) && currentUsername === recordUser
              const allowedDelete = canDeleteAll || isOwner

              return (
                <>
                  <div className="border-t border-gray-100 my-1" />
                  <button
                    type="button"
                    disabled={!allowedDelete}
                    title={!allowedDelete ? 'Bu işlemi sadece işlemi yapan kullanıcı silebilir' : undefined}
                    className={
                      'w-full px-3 py-2 text-xs flex items-center gap-2 font-medium transition ' +
                      (allowedDelete
                        ? 'text-red-600 hover:bg-red-50 cursor-pointer'
                        : 'text-slate-300 bg-transparent cursor-not-allowed')
                    }
                    onClick={() => {
                      if (!allowedDelete) return
                      setActionsOpenForId(null)
                      requestDelete(row)
                    }}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className={allowedDelete ? "text-red-500" : "text-slate-300"}><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
                    Sil
                  </button>
                </>
              )
            })()}
          </div>,
          document.body
        )
        : null}

      <Modal
        isOpen={productPickerOpen}
        onClose={() => {
          setProductPickerOpen(false)
          setProductPickerForLineId(null)
        }}
        title={productPickerServiceOnly ? 'Hizmet Seç' : 'Ürün Seç'}
        sizeKey="alisFaturasiUrunSecici"
        containerClassName="max-w-4xl"
        overlayClassName="z-[90]"
        footer={
          <div className="flex items-center justify-between w-full gap-3">
            {/* Modal acikken kac kalem eklendigi gorunur; yoksa "ekledim mi" belirsiz kaliyor. */}
            <span className="text-xs font-semibold text-emerald-700">
              {eklenenUrunSayisi > 0 ? `${eklenenUrunSayisi} kalem eklendi` : ''}
            </span>
            <button
              type="button"
              onClick={() => {
                setProductPickerOpen(false)
                setProductPickerForLineId(null)
                setEklenenUrunSayisi(0)
              }}
              className="px-4 py-2 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-800 font-semibold"
            >
              Kapat
            </button>
          </div>
        }
        scrollable
      >
        <div className="flex items-center gap-2 mb-3">
          <div className="flex-1">
            <FormInput
              label="Ara"
              value={productPickerQuery}
              onChange={(e) => setProductPickerQuery(e.target.value)}
              placeholder="Stok kodu / ürün adı"
            />
          </div>
          <button
            type="button"
            onClick={() => searchProducts(productPickerQuery)}
            className="mt-6 inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-800 font-semibold"
          >
            <Search size={16} />
            Ara
          </button>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-4">
          <FormSelect
            label="Ana Kategori"
            value={pickerMainCat}
            onChange={(e) => {
              const v = e.target.value
              setPickerMainCat(v)
              setPickerSubCat('')
              if (v) {
                void searchProducts(productPickerQuery, { main: v, sub: '' })
              } else {
                setProductPickerItems([])
              }
            }}
            options={[
              { value: '', label: 'Tümü' },
              ...(categoriesState?.mains ?? []).map((m: string) => ({ value: m, label: m }))
            ]}
          />
          <FormSelect
            label="Alt Kategori"
            value={pickerSubCat}
            onChange={(e) => {
              const v = e.target.value
              setPickerSubCat(v)
              void searchProducts(productPickerQuery, { sub: v })
            }}
            options={[
              { value: '', label: 'Tümü' },
              ...(((categoriesState as any)?.subsByMain?.[pickerMainCat] ?? []) as string[]).map((s) => ({ value: s, label: s }))
            ]}
            disabled={!pickerMainCat}
          />
        </div>

        {productPickerError && <div className="mb-3 text-sm font-semibold text-red-600">{productPickerError}</div>}

        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 text-[11px] font-semibold text-gray-600">
                <th className="px-3 py-2 text-left">Stok Kodu</th>
                <th className="px-3 py-2 text-left">Ürün Adı</th>
                <th className="px-3 py-2 text-right">Fiyat</th>
                <th className="px-3 py-2 text-right w-[190px]" />
              </tr>
            </thead>
            <tbody className="text-[12px]">
              {productPickerLoading ? (
                <tr>
                  <td colSpan={4} className="px-3 py-3 text-sm text-gray-500">
                    Yükleniyor...
                  </td>
                </tr>
              ) : productPickerItems.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-3 py-3 text-sm text-gray-500">
                    Ürün bulunamadı.
                  </td>
                </tr>
              ) : (
                productPickerItems.map((p) => (
                  <tr key={String(p?.id ?? '')} className="border-t border-gray-100 hover:bg-gray-50">
                    <td className="px-3 py-2">{String(p?.stockCode ?? '')}</td>
                    <td className="px-3 py-2">{String(p?.name ?? '')}</td>
                    {/*
                      İKİ SATIR: ÜSTTE KART FİYATI, ALTTA BELGE KARŞILIĞI (2026-08-29).
                      Alış dövizi USD olan ürünü TL belgeye eklerken kullanıcı hem 140 $'ı hem
                      de o anki kurla TL karşılığını görür; "kaça alıyorum" sorusu listede
                      cevaplanmış olur. Belge zaten aynı para birimindeyse alt satır yazılmaz.
                    */}
                    <td className="px-3 py-2 text-right">
                      {p?.__basePrice == null ? '-' : (
                        <>
                          <div className="font-semibold">
                            {formatMoneyWithCurrency(Number(p?.__basePrice ?? 0), p?.__baseCurrency)}
                          </div>
                          {String(p?.__baseCurrency ?? 'TRY') !== draftCurrency && Number(p?.__basePrice) > 0 && (
                            <div className="text-[11px] text-slate-500">
                              {formatMoneyWithCurrency(
                                belgeFiyatinaCevir(Number(p?.__basePrice ?? 0), String(p?.__baseCurrency ?? 'TRY')),
                                draftCurrency
                              )}
                              <span className="ml-1 opacity-70">· {belgeTlMi ? 'TCMB' : `kur ${belgeKuru}`}</span>
                            </div>
                          )}
                        </>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      {/*
                        "Satıra Ekle" modalı KAPATMAZ: aynı aramadan arka arkaya birden çok
                        ürün eklenebilsin diye. "Seç" eski davranış — ekleyip kapatır.
                      */}
                      <button
                        type="button"
                        className="px-2.5 py-1 mr-1.5 rounded border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-xs font-bold"
                        title="Ekle ve pencereyi açık tut"
                        onClick={() => urunuYeniSatiraEkle(p)}
                      >
                        + Satıra Ekle
                      </button>
                      <button
                        type="button"
                        className="px-3 py-1 rounded border border-gray-200 bg-white hover:bg-gray-50 text-gray-800 text-xs font-semibold"
                        title="Ekle ve pencereyi kapat"
                        onClick={() => selectProductForLine(p)}
                      >
                        Seç
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Modal>

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

      {/* CARİ EKSTRE — Fatura Dökümü ile aynı modal */}
      <CariEkstreModal open={ekstreOpen} cari={ekstreCari} onClose={() => setEkstreOpen(false)} />
    </div >
  )
}
