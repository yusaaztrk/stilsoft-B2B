import React, { useEffect, useMemo, useRef, useState } from 'react'
import { fetchAllPages } from '../lib/fetchAllPages'
import { normalizeDiscountType } from '../utils/discountType'
import { ChevronDown, ChevronRight, Clock, CheckCircle2, Search, ArrowRight, BarChart3 } from 'lucide-react'
import { useOutletContext, useLocation, useNavigate } from 'react-router-dom'
import { createPortal } from 'react-dom'
import { fetchLatestFxRate } from '../api/fx'
import Modal from '../components/Modal'
import Table, { type TableColumn } from '../components/Table'
import { fetchTerminPurchaseInvoices, updatePurchaseInvoiceTerminStatus, kismiTeslimPurchaseInvoice, updatePurchaseInvoiceEstimatedArrivalDate, fetchTeslimatGecmisi, type PurchaseInvoiceListItemDto, type TeslimatGecmisiParti } from '../api/purchaseInvoices'
import { fetchWarehousesDropdown, pickDefaultWarehouseCode, type WarehouseDropdownItem } from '../api/warehouses'

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
}

type PurchaseInvoiceRow = {
  id: number | string
  approved: boolean
  date: string
  documentNo: string
  kind: number
  terminStatus: number
  supplierCode?: string
  serviceCode?: string
  customerCode: string
  customerName: string
  description: string
  vatExempt: boolean
  currencyTypeId?: number
  exchangeRate?: number
  subtotal: number
  discountTotal: number
  netTotal: number
  vatTotal: number
  grandTotal: number
  salesmanCode?: string
  createUser?: string
  estimatedArrivalDate?: string
  lines: InvoiceLine[]
}

function formatMoney(n: number) {
  const v = Number(n ?? 0)
  return `₺${v.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

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

    const dv = Number(l.discountValue ?? 0)
    let discount = 0
    // İNDİRİM TİPİ METİN GELİYOR + TUTAR İNDİRİMİ ADET BAŞINA (2026-08-22).
    //
    // API enum'ları metin olarak gönderiyor ("Amount"/"Percentage"); buradaki sayı ve
    // küçük harf karşılaştırmalarının ikisi de tutmuyor, indirim SESSİZCE 0 hesaplanıyordu.
    // Proforma listesinde her satırın indirimi 0,00 görünmesinin sebebi buydu.
    // Ayrıca tutar indirimi artık satırın tamamına değil HER ÜRÜNE uygulanıyor.
    if (normalizeDiscountType(l.discountType) === 'amount') {
      const tryDiscountValue = dv * sourceRate * qty
      const targetDiscountValue = targetRate > 0 ? tryDiscountValue / targetRate : 0
      discount = Math.max(0, targetDiscountValue)
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

function calcLineTotals(line: InvoiceLine, vatExempt: boolean) {
  const qty = safeNumber(line.quantity ?? 0)
  const price = safeNumber(line.unitPrice ?? 0)
  const base = qty * price

  const dv = safeNumber(line.discountValue ?? 0)
  let discount = 0
  if (line.discountType === 'amount') discount = Math.max(0, dv)
  if (line.discountType === 'percentage') discount = Math.max(0, (base * dv) / 100)
  discount = Math.min(discount, base)

  const net = base - discount
  const vatRate = Math.max(0, safeNumber(line.vatRate ?? 0))
  const vatAmount = vatExempt ? 0 : (net * vatRate) / 100

  return { base, discount, net, vatAmount }
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

export default function TerminPage() {
  const { isSuperAdmin, allowedKeys } = useOutletContext<LayoutContext>()
  const location = useLocation()

  const canDurumDegistir =
    Boolean(isSuperAdmin) ||
    (Boolean(allowedKeys?.has('invoice/termin')) && Boolean(allowedKeys?.has('invoice/terminDurumDegistir')))
  const navigate = useNavigate()

  const queryParams = useMemo(() => new URLSearchParams(location.search), [location.search])
  const stockCodeFilter = queryParams.get('stockCode')

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

  const filteredRows = useMemo(() => {
    let result = rows
    if (stockCodeFilter) {
      const term = stockCodeFilter.trim().toLowerCase()
      result = result.filter(
        (r) =>
          r.terminStatus === 0 &&
          r.lines.some((l) => String(l.stockCode).trim().toLowerCase() === term)
      )
    }
    return result
  }, [rows, stockCodeFilter])

  const clearStockFilter = () => {
    navigate('/invoice/termin')
  }

  const [actionsOpenForId, setActionsOpenForId] = useState<string | null>(null)
  const actionsAnchorByIdRef = useRef<Record<string, HTMLButtonElement | null>>({})
  const [actionsMenuPos, setActionsMenuPos] = useState<{ top: number; left: number } | null>(null)
  const actionsMenuRef = useRef<HTMLDivElement | null>(null)

  // Status Change Modal State
  const [statusModalOpen, setStatusModalOpen] = useState(false)
  const [statusBusy, setStatusBusy] = useState(false)
  const [selectedRow, setSelectedRow] = useState<PurchaseInvoiceRow | null>(null)
  const [newStatus, setNewStatus] = useState<number>(0)

  // Warehouses state
  const [warehouses, setWarehouses] = useState<WarehouseDropdownItem[]>([])
  const [warehousesLoading, setWarehousesLoading] = useState(false)

  // Line warehouse selections
  const [lineWarehouses, setLineWarehouses] = useState<Record<number, number>>({}) // maps lineId to warehouseCode
  const [kismiWarehouses, setKismiWarehouses] = useState<Record<number, number>>({}) // maps lineId to warehouseCode

  // Kısmi Teslim Modal State
  const [kismiModalOpen, setKismiModalOpen] = useState(false)
  const [kismiBusy, setKismiBusy] = useState(false)
  const [kismiRow, setKismiRow] = useState<PurchaseInvoiceRow | null>(null)
  const [kismiQuantities, setKismiQuantities] = useState<Record<string, number>>({}) // maps line.id to delivered qty

  // Tahmini Geliş Tarihi Modal State
  const [arrivalModalOpen, setArrivalModalOpen] = useState(false)
  const [arrivalBusy, setArrivalBusy] = useState(false)
  const [arrivalRow, setArrivalRow] = useState<PurchaseInvoiceRow | null>(null)
  const [selectedArrivalDate, setSelectedArrivalDate] = useState('')
  const [arrivalWarning, setArrivalWarning] = useState('')

  const [globalSearch, setGlobalSearch] = useState('')

  const mapApiToRow = (x: PurchaseInvoiceListItemDto): PurchaseInvoiceRow => {
    const yyyyMmDd = String(x.date ?? '').slice(0, 10)
    return {
      id: x.id,
      approved: Boolean((x as any).approved),
      date: yyyyMmDd,
      documentNo: String(x.documentNo ?? ''),
      kind: Number((x as any).kind ?? 0),
      terminStatus: Number((x as any).terminStatus ?? 0),
      supplierCode: String((x as any).supplierCode ?? ''),
      serviceCode: String((x as any).serviceCode ?? ''),
      customerCode: String(x.customerCode ?? ''),
      customerName: String(x.customerName ?? ''),
      description: String(x.description ?? ''),
      vatExempt: Boolean(x.vatExempt),
      // Belgenin para birimi ve kuru: kısmi teslim ekranı bunları gösterip kullanıyor.
      currencyTypeId: Number((x as any).currencyTypeId ?? 0),
      exchangeRate: Number((x as any).exchangeRate ?? 1),
      subtotal: Number(x.subtotal ?? 0),
      discountTotal: Number(x.discountTotal ?? 0),
      netTotal: Number(x.netTotal ?? 0),
      vatTotal: Number(x.vatTotal ?? 0),
      grandTotal: Number(x.grandTotal ?? 0),
      salesmanCode: String((x as any).salesmanCode ?? ''),
      createUser: String((x as any).createUser ?? ''),
      estimatedArrivalDate: x.estimatedArrivalDate || undefined,
      lines: (x.lines ?? []).map((l) => ({
        id: String(l.id),
        productId: l.productId ? String(l.productId) : undefined,
        warehouseCode: l.warehouseCode !== null && l.warehouseCode !== undefined ? String(l.warehouseCode) : '',
        stockCode: String(l.stockCode ?? ''),
        stockName: String((l as any).stockName ?? l.description ?? ''),
        description: String((l as any).description ?? ''),
        quantity: Number(l.quantity ?? 0),
        /*
          EKRAN BELGENIN PARA BIRIMINDE GOSTERIR (2026-09-01 duzeltmesi).

          Burasi `l.unitPrice` yaziyordu; o alan TL CAPASIDIR. Belgenin kendi parasindaki
          fiyat `currencyUnitPrice`ta durur. Sonuc: 117,50 $ girilen kalem termin listesinde
          5.670,70 $ (=117,50 x 48,26) gorunuyor, 422.950 $'lik siparis 20.412.113 $ diye
          toplaniyordu. Alis Siparisleri ekraninda ayni hata duzeltilmisti; bu sayfa ayri
          bir dosya oldugu icin geride kalmisti.

          Damgasiz ESKI kayitlarda `currencyUnitPrice` 0 gelir, o zaman TL capasina duser.
        */
        unitPrice: Number((l as any).currencyUnitPrice ?? 0) > 0
          ? Number((l as any).currencyUnitPrice)
          : Number(l.unitPrice ?? 0),
        currencyUnitPrice: Number((l as any).currencyUnitPrice ?? l.unitPrice ?? 0),
        // Uçtan METİN geliyor ("Amount"/"Percentage"); `=== 1` karşılaştırması hiç tutmuyor ve
        // her satır 'none' oluyordu, yani indirim sessizce sıfırlanıyordu (2026-08-22).
        discountType: normalizeDiscountType(l.discountType),
        discountValue: Number(l.discountValue ?? 0),
        vatRate: Number(l.vatRate ?? 0),
        // Etiket BELGENIN dovizi; urun kartininki degil (urun USD alisli olunca
        // tesadufen dogru gorunuyor, TL belgede ise yanlis simge basiyordu).
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

  const loadAll = async (signal?: AbortSignal) => {
    try {
      setLoading(true)
      setError(null)
      
      setWarehousesLoading(true)
      const whList = await fetchWarehousesDropdown({ signal })
      setWarehouses(whList ?? [])
      setWarehousesLoading(false)

      /*
        TÜR SÜZGECİ SUNUCUDA (2026-08-19).

        Liste eskiden "son 200 fatura"yı TÜR AYIRMADAN çekip ALIŞ olanları burada
        süzüyordu: araya giren hizmet/iade faturaları 200'lük pencereyi doldurunca
        yeni alınan ürünler termin ekranında hiç görünmüyordu. Artık sunucu yalnızca
        Kind=0 (Alış) döndürüyor, pencere de sadece alış faturalarına ayrılıyor.
      */
      // Termin'in kendi ucu: alış tipi yetkisine bakmaz, `invoice/termin` yetkisiyle çalışır.
      // Bütün kayıtlar sayfa sayfa (2026-10-08): eskiden yalnız son 500 geliyordu, eski kayıtlar
      // aramada/süzgeçte görünmüyordu. İlk sayfa hemen ekrana basılır, kalanlar arkadan eklenir.
      await fetchAllPages((skip, take) => fetchTerminPurchaseInvoices({ take, skip, signal }), {
        key: (x: any) => String(x.id),
        onPage: (all, first) => {
          setRows(all.map(mapApiToRow).filter((r) => r.kind === 0))
          if (first) setLoading(false)
        }
      })
    } catch (e: any) {
      if (isAbortError(e)) return
      setRows([])
      setError(String(e?.message ?? 'Termin listesi alınamadı'))
    } finally {
      setLoading(false)
      setWarehousesLoading(false)
    }
  }

  useEffect(() => {
    const ac = new AbortController()
    void loadAll(ac.signal)
    return () => ac.abort()
  }, [])

  // Deep Link status modal trigger from Alış Faturaları page
  useEffect(() => {
    const queryParams = new URLSearchParams(location.search)
    const openStatusModalForId = queryParams.get('openStatusModalForId')
    if (openStatusModalForId && rows.length > 0 && canDurumDegistir) {
      const row = rows.find((x) => String(x.id) === String(openStatusModalForId))
      if (row) {
        setSelectedRow(row)
        setNewStatus(row.terminStatus)
        setStatusModalOpen(true)

        // Clear query parameters
        const cleanSearch = new URLSearchParams(window.location.search)
        cleanSearch.delete('openStatusModalForId')
        const newRelativePathQuery = window.location.pathname + (cleanSearch.toString() ? '?' + cleanSearch.toString() : '')
        window.history.replaceState(null, '', newRelativePathQuery)
      }
    }
  }, [location.search, rows])

  useEffect(() => {
    if (!actionsOpenForId) {
      setActionsMenuPos(null)
      return
    }

    const anchor = actionsAnchorByIdRef.current[actionsOpenForId]
    if (!anchor) return

    const updatePos = () => {
      const r = anchor.getBoundingClientRect()
      const width = 180
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

  const openStatusChange = (row: PurchaseInvoiceRow) => {
    setSelectedRow(row)
    setNewStatus(row.terminStatus)
    
    const initialWarehouses: Record<number, number> = {}
    const defaultWarehouse = pickDefaultWarehouseCode(warehouses) ?? 0
    
    ;(row.lines ?? []).forEach((line) => {
      initialWarehouses[Number(line.id)] = line.warehouseCode ? Number(line.warehouseCode) : defaultWarehouse
    })
    setLineWarehouses(initialWarehouses)
    
    setStatusModalOpen(true)
  }

  const handleStatusSubmit = async () => {
    if (!selectedRow) return
    try {
      setStatusBusy(true)
      setError(null)
      
      let payloadLineWarehouses: { lineId: number; warehouseCode: number }[] | undefined = undefined
      
      if (newStatus === 1) { // Delivered
        const lineWarehouseList: { lineId: number; warehouseCode: number }[] = []
        for (const line of selectedRow.lines ?? []) {
          const wh = lineWarehouses[Number(line.id)]
          if (!wh || wh <= 0) {
            throw new Error(`${line.stockCode} için depo seçilmelidir.`)
          }
          lineWarehouseList.push({
            lineId: Number(line.id),
            warehouseCode: wh
          })
        }
        payloadLineWarehouses = lineWarehouseList
      }
      
      await updatePurchaseInvoiceTerminStatus(Number(selectedRow.id), newStatus, payloadLineWarehouses)
      setStatusModalOpen(false)
      setSelectedRow(null)
      await loadAll()
    } catch (e: any) {
      alert(e?.message ?? 'Durum güncellenemedi.')
    } finally {
      setStatusBusy(false)
    }
  }

  const openKismiTeslim = (row: PurchaseInvoiceRow) => {
    setKismiRow(row)
    const q: Record<string, number> = {}
    const w: Record<number, number> = {}
    const p: Record<number, string> = {}
    const defaultWarehouse = pickDefaultWarehouseCode(warehouses) ?? 0
    row.lines.forEach((l) => {
      q[l.id] = 0
      w[Number(l.id)] = l.warehouseCode ? Number(l.warehouseCode) : defaultWarehouse
      // Fiyat siparişteki değerle açılır; parti farklı fiyata geldiyse elle düzeltilir.
      p[Number(l.id)] = String((l as any).currencyUnitPrice ?? l.unitPrice ?? 0)
    })
    setKismiQuantities(q)
    setKismiWarehouses(w)
    setKismiPrices(p)
    setKismiDocNo('')
    setKismiRate(String((row as any).exchangeRate ?? 1))
    setKismiRateTouched(false)
    // Parti varsayılan olarak SİPARİŞİN para biriminde açılır; kullanıcı değiştirebilir.
    setKismiDoviz(Number((row as any).currencyTypeId ?? 0) || 1)
    setKismiIncludeRemainder(false)
    setKismiNotice(null)
    setKismiBelgeModu('yeni')
    setKismiHedefBelge('')
    setKismiModalOpen(true)

    /*
      ÖNERİLEN BELGE NO 15 KARAKTERİ AŞAMAZ.

      Öneri "sipariş numarası + parti eki" biçiminde ("333333-1"). Sipariş numarası zaten
      15 haneye yakınsa ek onu taşırıyor ve kayıt anında veritabanı reddediyor
      (`22001: varying(15) veri tipi için çok uzun`). Ek KORUNUR, kırpma numaranın
      SONUNDAN değil ÖNÜNDEN yapılır: parti eki kaybolursa iki teslimat aynı numarayı
      önerir ve ikincisi birincinin faturasına eklenir.
    */
    const belgeOnerisi = (ek: string) => {
      const kok = String(row.documentNo ?? '')
      const kalan = Math.max(0, 15 - ek.length)
      return `${kok.slice(0, kalan)}${ek}`
    }

    // Teslimat geçmişi: bu siparişten daha önce ne kadarı hangi depoya girdi.
    setKismiHistoryLoading(true)
    fetchTeslimatGecmisi(Number(row.id))
      .then((d) => {
        setKismiHistory(d)
        // Belge no OTOMATİK önerilir: siparişin numarası + kaçıncı parti olduğu.
        // Kullanıcı dilerse tedarikçinin gerçek irsaliye numarasıyla değiştirir.
        setKismiDocNo(belgeOnerisi(`-${d.length + 1}`))
      })
      .catch(() => {
        setKismiHistory([])
        setKismiDocNo(belgeOnerisi('-1'))
      })
      .finally(() => setKismiHistoryLoading(false))
  }

  /*
    KISMİ TESLİM EKRANININ YENİ ALANLARI (2026-08-29 kullanıcı isteği).

    Fiyat, kur ve belge no artık parti başına düzenlenebiliyor; geçmiş partiler listeleniyor.
    Sebep: gerçekte her sevkiyat farklı fiyata ve kura geliyor, tedarikçinin kendi irsaliye
    numarası var ve "ne kadarı nereye girdi" sorusunun ekranda cevabı yoktu.
  */
  const [kismiPrices, setKismiPrices] = useState<Record<number, string>>({})
  const [kismiDocNo, setKismiDocNo] = useState('')
  const [kismiRate, setKismiRate] = useState('1')
  const [kismiRateTouched, setKismiRateTouched] = useState(false)
  const [kismiIncludeRemainder, setKismiIncludeRemainder] = useState(false)
  const [kismiHistory, setKismiHistory] = useState<TeslimatGecmisiParti[]>([])
  const [kismiHistoryLoading, setKismiHistoryLoading] = useState(false)
  const [kismiNotice, setKismiNotice] = useState<string | null>(null)
  /*
    TESLİMAT BELGESİ: YENİ Mİ, MEVCUDA MI (2026-08-30 kullanıcı isteği).

    Önce tek bir serbest metin kutusu vardı ve "bu numara zaten varsa o faturaya eklenir"
    diye küçük bir not yazıyordu — kullanıcı hangi faturaya ekleyeceğini bilmiyor, numarayı
    ezberden yazmak zorunda kalıyordu. Artık seçim açık:

      'yeni'   → numara sorulur (otomatik önerilir, değiştirilebilir)
      'mevcut' → önceki teslimat faturaları listelenir, numara SORULMAZ
  */
  const [kismiBelgeModu, setKismiBelgeModu] = useState<'yeni' | 'mevcut'>('yeni')
  const [kismiHedefBelge, setKismiHedefBelge] = useState('')

  /*
    TESLİMATIN PARA BİRİMİ (2026-08-30 kullanıcı bildirimi: "TL mi dolar mı gözükmüyor").

    Sipariş hangi para biriminde kesildiyse teslimat da odur; kısmi teslimat faturayı BÖLER,
    para birimini değiştirmez. Ekranda görünmediği için kullanıcı hangi birimde fiyat
    yazdığını bilemiyordu.
  */
  /*
    PARTİNİN PARA BİRİMİ SEÇİLEBİLİR (2026-09-01 kullanıcı isteği:
    "burada da TL'ye çevirebilmem lazımdı, ona göre carisine yazılacaktı").

    Sipariş USD kesilmiş olabilir ama mal geldiğinde fatura TL kesiliyor olabilir. Uç bunu
    ZATEN destekliyordu (`KismiTeslimRequest.CurrencyTypeId` — "bu partinin para birimi");
    eksik olan yalnızca ekrandı, seçim gönderilmediği için parti hep siparişin para
    biriminde açılıyordu. Cari ekstresine yazılan tutar da bu para biriminden türüyor.
  */
  const [kismiDoviz, setKismiDoviz] = useState<number>(1)

  const kismiDovizId = kismiDoviz > 0 ? kismiDoviz : Number((kismiRow as any)?.currencyTypeId ?? 0)
  const kismiDovizKodu = kismiDovizId === 2 ? 'EUR' : kismiDovizId === 3 ? 'USD' : kismiDovizId === 4 ? 'GBP' : 'TL'
  const kismiSimge = kismiDovizId === 2 ? '€' : kismiDovizId === 3 ? '$' : kismiDovizId === 4 ? '£' : '₺'
  const kismiTlMi = kismiDovizId <= 1

  /**
   * Parti para birimi değişince KALEM FİYATLARINI çevirir.
   *
   * KUR 1 İSE ÇEVİRİ YAPILMAZ, İŞLEM REDDEDİLİR (2026-09-01 hata düzeltmesi).
   *
   * İlk sürüm kuru `fxRates`ten okuyordu. O tablo `fetchLatestFxRate(...).catch(() => 1)`
   * ile doluyor: TCMB isteği başarısız olursa kur SESSİZCE 1 kalıyor. Sonuç felaketti —
   * fiyatlar hiç çevrilmeden para birimi USD yapılıyordu, yani 5.670,70 TL değeri
   * "5.670,70 USD" olarak kaydediliyor ve fatura dökümünde 144 milyon dolar görünüyordu.
   *
   * Artık kur şu sırayla aranıyor ve bulunamazsa DEĞİŞİKLİK YAPILMIYOR:
   *   1) Hedef, SİPARİŞİN para birimiyse siparişin DONMUŞ kuru (en güvenilir kaynak).
   *   2) Ekrandaki kur kutusunda geçerli bir değer varsa o.
   *   3) `fxRates` — ama yalnızca 1'den BÜYÜKSE; 1 "çekilemedi" demek.
   * Sessizce yanlış kaydetmektense kullanıcıya kuru sormak doğrusu.
   */
  const kismiDovizDegistir = (yeniDoviz: number) => {
    if (yeniDoviz === kismiDovizId) return

    const eskiTlMi = kismiDovizId <= 1
    const yeniTlMi = yeniDoviz <= 1

    // Mevcut birimin kuru: TL ise 1, değilse ekrandaki kutu (oraya siparişin kuru yüklenir).
    const ekrandakiKur = Number(String(kismiRate).replace(',', '.'))
    const eskiKur = eskiTlMi ? 1 : (ekrandakiKur > 0 ? ekrandakiKur : 0)
    if (!eskiTlMi && !(eskiKur > 1)) {
      setError('Mevcut para biriminin kuru okunamadı; önce kur alanını doldurun.')
      return
    }

    let yeniKur = 1
    if (!yeniTlMi) {
      const siparisDovizi = Number((kismiRow as any)?.currencyTypeId ?? 0)
      const siparisKuru = Number((kismiRow as any)?.exchangeRate ?? 0)
      const kod = yeniDoviz === 2 ? 'EUR' : yeniDoviz === 3 ? 'USD' : 'GBP'
      const tabloKuru = Number(fxRates[kod])

      if (yeniDoviz === siparisDovizi && siparisKuru > 1) yeniKur = siparisKuru
      else if (tabloKuru > 1) yeniKur = tabloKuru
      else {
        setError(
          `${kod} kuru alınamadı (güncel kur servisi yanıt vermiyor). ` +
          'Para birimini değiştirmeden önce kuru elle girin ya da TL olarak kaydedin.'
        )
        return
      }
    }

    setKismiPrices((prev) => {
      const next: Record<number, string> = {}
      for (const [id, deger] of Object.entries(prev)) {
        const fiyat = Number(String(deger).replace(',', '.'))
        if (!Number.isFinite(fiyat) || fiyat === 0) { next[Number(id)] = String(deger); continue }
        const tl = eskiTlMi ? fiyat : fiyat * eskiKur      // önce TL çapasına
        const yeni = yeniTlMi ? tl : tl / yeniKur          // sonra hedef birime
        next[Number(id)] = String(Math.round(yeni * 10000) / 10000)
      }
      return next
    })

    setError(null)
    setKismiDoviz(yeniDoviz)
    setKismiRate(String(yeniKur))
    setKismiRateTouched(true)
  }

  const handleKismiSubmit = async () => {
    if (!kismiRow) return
    
    setError(null)
    const items: { lineId: number; deliveredQuantity: number; warehouseCode: number }[] = []
    
    for (const l of kismiRow.lines) {
      const deliveredQty = Number(kismiQuantities[l.id] ?? 0)
      const qty = Number.isNaN(deliveredQty) ? 0 : deliveredQty
      
      if (qty > 0) {
        const wh = kismiWarehouses[Number(l.id)]
        if (!wh || wh <= 0) {
          setError(`${l.stockCode} için depo seçilmelidir.`)
          return
        }
        items.push({
          lineId: Number(l.id),
          deliveredQuantity: qty,
          warehouseCode: wh
        })
      }
    }

    if (items.length === 0 && !kismiIncludeRemainder) {
      setError('Lütfen en az bir ürün için teslim edilen miktar giriniz.')
      return
    }

    for (const item of items) {
      const line = kismiRow.lines.find((l) => Number(l.id) === item.lineId)
      if (line && item.deliveredQuantity > line.quantity) {
        setError(`${line.stockCode} için teslim edilen miktar kalan miktardan fazla olamaz.`)
        return
      }
    }

    try {
      setKismiBusy(true)
      setError(null)
      /*
        "KALANI DAHİL ET" İŞARETLİYSE BÜTÜN SATIRLAR GÖNDERİLİR.

        Sunucu boş `items` isteğini en başta reddediyor; kullanıcı hiç miktar yazmadan kutuyu
        işaretlediğinde istek boş gidiyordu. Miktarı sunucu kalanın tamamına çekecek, ama
        DEPO bilgisi buradan gitmek zorunda — mal bir yere girmek zorunda.
      */
      const gonderilecek = kismiIncludeRemainder
        ? kismiRow.lines.map((l) => ({
          lineId: Number(l.id),
          deliveredQuantity: Number(kismiQuantities[l.id] ?? 0),
          warehouseCode: Number(kismiWarehouses[Number(l.id)] ?? 0)
        }))
        : items

      if (kismiBelgeModu === 'mevcut' && !kismiHedefBelge) {
        setError('Hangi faturaya ekleneceğini seçiniz.')
        setKismiBusy(false)
        return
      }
      if (kismiIncludeRemainder && gonderilecek.some((x) => !(x.warehouseCode > 0))) {
        setError('Kalanı dahil etmek için tüm satırlarda depo seçilmelidir.')
        setKismiBusy(false)
        return
      }

      const sonuc = await kismiTeslimPurchaseInvoice(Number(kismiRow.id), {
        items: gonderilecek.map((it) => ({
          ...it,
          // Fiyat boş bırakılırsa sunucu siparişteki fiyatı kullanır.
          unitPrice: kismiPrices[it.lineId] !== undefined && String(kismiPrices[it.lineId]).trim() !== ''
            ? Number(String(kismiPrices[it.lineId]).replace(',', '.'))
            : null
        })),
        // 'mevcut' modunda seçilen faturanın numarası gider; sunucu numara eşleşince
        // teslimatı o faturaya ekler (aynı fiyat → miktar toplanır, farklı → ayrı kalem).
        documentNo: kismiBelgeModu === 'mevcut' ? (kismiHedefBelge || null) : (kismiDocNo.trim() || null),
        // Partinin para birimi: ekrandan seçilen. Gönderilmezse uç siparişinkini kopyalıyordu.
        currencyTypeId: kismiDovizId,
        exchangeRate: kismiRateTouched ? (Number(String(kismiRate).replace(',', '.')) || null) : null,
        rateSource: kismiRateTouched ? 'Manuel' : null,
        includeRemainder: kismiIncludeRemainder
      })

      // Sunucu mevcut faturaya eklediyse ya da fiyat farkı yüzünden ayrı kalem açtıysa söyler.
      if (sonuc?.message) setKismiNotice(sonuc.message)

      setKismiModalOpen(false)
      setKismiRow(null)
      await loadAll()
    } catch (e: any) {
      setError(String(e?.message ?? 'Kısmi teslimat işlemi başarısız.'))
    } finally {
      setKismiBusy(false)
    }
  }

  const openEstimatedArrival = (row: PurchaseInvoiceRow) => {
    setArrivalRow(row)
    const cleanDate = row.estimatedArrivalDate ? row.estimatedArrivalDate.split('T')[0] : ''
    setSelectedArrivalDate(cleanDate)
    setArrivalWarning('')
    setArrivalModalOpen(true)
  }

  const handleArrivalDateChange = (val: string) => {
    setSelectedArrivalDate(val)
    if (arrivalRow && val) {
      const terminDateStr = arrivalRow.date.slice(0, 10)
      const selectedDateStr = val.slice(0, 10)
      if (selectedDateStr < terminDateStr) {
        setArrivalWarning('Tahmini geliş tarihi, termin oluşturma tarihinden önce olamaz.')
      } else {
        setArrivalWarning('')
      }
    } else {
      setArrivalWarning('')
    }
  }

  const handleArrivalSubmit = async () => {
    if (!arrivalRow) return
    if (arrivalWarning) return

    try {
      setArrivalBusy(true)
      setError(null)
      const valToSend = selectedArrivalDate ? new Date(selectedArrivalDate).toISOString() : null
      await updatePurchaseInvoiceEstimatedArrivalDate(Number(arrivalRow.id), valToSend)
      setArrivalModalOpen(false)
      setArrivalRow(null)
      await loadAll()
    } catch (e: any) {
      setError(String(e?.message ?? 'Tahmini geliş tarihi güncellenemedi.'))
    } finally {
      setArrivalBusy(false)
    }
  }

  const columns = useMemo<TableColumn<PurchaseInvoiceRow>[]>(() => [
    {
      key: 'date',
      label: 'Tarih',
      searchable: true,
      sortable: true,
      filter: { type: 'date' },
      render: (val) => <span className="text-gray-700 whitespace-nowrap">{String(val)}</span>
    },
    {
      key: 'documentNo',
      label: 'Belge No',
      searchable: true,
      sortable: true,
      filter: { type: 'text' },
      render: (val) => <span className="font-semibold text-gray-900 whitespace-nowrap">{String(val)}</span>
    },
    {
      key: 'customerCode',
      label: 'Cari Kodu',
      searchable: true,
      sortable: true,
      filter: { type: 'text' },
      render: (val) => <span className="text-gray-700">{String(val || '')}</span>
    },
    {
      key: 'customerName',
      label: 'Cari Adı',
      searchable: true,
      sortable: true,
      filter: { type: 'text' },
      render: (val) => <span className="font-medium text-gray-800">{String(val || '')}</span>
    },
    {
      key: 'description',
      label: 'Açıklama',
      searchable: true,
      sortable: true,
      filter: { type: 'text' },
      render: (val) => <span className="text-gray-600 truncate max-w-[200px] block">{String(val || '—')}</span>
    },
    {
      key: 'terminStatus',
      label: 'Termin Durumu',
      searchable: true,
      sortable: true,
      filter: {
        type: 'select',
        options: [
          { label: 'Bekliyor', value: '0' },
          { label: 'Teslim Edildi', value: '1' }
        ]
      },
      render: (val) => {
        const isDelivered = Number(val) === 1
        return (
          <span
            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-bold border transition ${
              isDelivered
                ? 'bg-emerald-50 border-emerald-200/50 text-emerald-800 shadow-[0_1px_2px_rgba(16,185,129,0.05)]'
                : 'bg-amber-50 border-amber-200/50 text-amber-800 shadow-[0_1px_2px_rgba(245,158,11,0.05)]'
            }`}
          >
            {isDelivered ? (
              <>
                <CheckCircle2 size={11} className="text-emerald-600" />
                Teslim Edildi
              </>
            ) : (
              <>
                <Clock size={11} className="text-amber-600 animate-pulse" />
                Bekliyor
              </>
            )}
          </span>
        )
      }
    },
    {
      key: 'estimatedArrivalDate',
      label: 'Tahmini Geliş Tarihi',
      searchable: true,
      sortable: true,
      filter: { type: 'date' },
      render: (val) => {
        if (!val) return <span className="text-gray-405 font-medium">—</span>
        const clean = String(val).split('T')[0]
        const parts = clean.split('-')
        const formatted = parts.length === 3 ? `${parts[2]}.${parts[1]}.${parts[0]}` : String(val)
        return <span className="text-gray-750 font-bold whitespace-nowrap">{formatted}</span>
      }
    },
    {
      key: 'createUser',
      label: 'İşlem Yapan',
      searchable: true,
      sortable: true,
      filter: { type: 'text' },
      render: (val) => <span className="text-gray-600 whitespace-nowrap">{String(val || '')}</span>
    },
    {
      key: 'salesmanCode',
      label: 'Satış Yapan',
      searchable: true,
      sortable: true,
      filter: { type: 'text' },
      render: (val) => <span className="text-gray-600 whitespace-nowrap">{String(val || '—')}</span>
    },
    {
      key: 'subtotal',
      label: 'Ara Toplam',
      sortable: true,
      render: (val, row) => {
        const invCurrency = getInvoiceCurrency(row.lines)
        const totals = calcInvoiceTotalsWithConversion(row.lines, row.vatExempt, invCurrency, fxRates)
        return <span className="text-right font-semibold text-gray-850 block">{formatMoneyWithCurrency(totals.subTotal, invCurrency)}</span>
      }
    },
    {
      key: 'discountTotal',
      label: 'İndirim',
      sortable: true,
      render: (val, row) => {
        const invCurrency = getInvoiceCurrency(row.lines)
        const totals = calcInvoiceTotalsWithConversion(row.lines, row.vatExempt, invCurrency, fxRates)
        return <span className="text-right text-gray-600 block">{formatMoneyWithCurrency(totals.discountTotal, invCurrency)}</span>
      }
    },
    {
      key: 'netTotal',
      label: 'Net Tutar',
      sortable: true,
      render: (val, row) => {
        const invCurrency = getInvoiceCurrency(row.lines)
        const totals = calcInvoiceTotalsWithConversion(row.lines, row.vatExempt, invCurrency, fxRates)
        return <span className="text-right text-gray-800 font-medium block">{formatMoneyWithCurrency(totals.netTotal, invCurrency)}</span>
      }
    },
    {
      key: 'vatTotal',
      label: 'KDV Tutar',
      sortable: true,
      render: (val, row) => {
        const invCurrency = getInvoiceCurrency(row.lines)
        const totals = calcInvoiceTotalsWithConversion(row.lines, row.vatExempt, invCurrency, fxRates)
        return <span className="text-right text-gray-600 block">{formatMoneyWithCurrency(totals.vatTotal, invCurrency)}</span>
      }
    },
    {
      key: 'grandTotal',
      label: 'Genel Toplam',
      sortable: true,
      render: (val, row) => {
        const invCurrency = getInvoiceCurrency(row.lines)
        const totals = calcInvoiceTotalsWithConversion(row.lines, row.vatExempt, invCurrency, fxRates)
        return <span className="text-right font-bold text-gray-950 block">{formatMoneyWithCurrency(totals.grandTotal, invCurrency)}</span>
      }
    },
    {
      key: 'id',
      label: 'İşlemler',
      render: (val, row) => (
        <div className="text-right relative" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setActionsOpenForId((p) => (p === String(val) ? null : String(val)))
            }}
            ref={(el) => {
              actionsAnchorByIdRef.current[String(val)] = el
            }}
            className="w-8 h-8 inline-flex items-center justify-center rounded-xl border border-gray-200/80 bg-white hover:bg-gray-50 text-gray-500 hover:text-gray-900 transition-all shadow-[0_1px_2px_rgba(0,0,0,0.02)] active:scale-95"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <circle cx="12" cy="5" r="1" />
              <circle cx="12" cy="12" r="1" />
              <circle cx="12" cy="19" r="1" />
            </svg>
          </button>
        </div>
      )
    }
  ], [rows])

  const renderExpandedRow = (row: PurchaseInvoiceRow) => {
    return (
      <div className="p-1 sm:p-2 bg-gray-50/30 rounded-2xl border border-gray-200/60 shadow-[inset_0_2px_4px_rgba(0,0,0,0.01)] overflow-hidden">
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
          <table className="w-full text-[11px] border-collapse">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200 text-left text-gray-400 font-bold uppercase text-[9px] tracking-wider">
                <th className="px-4 py-3">Stok Kodu</th>
                <th className="px-4 py-3">Stok Adı</th>
                <th className="px-4 py-3">Açıklama</th>
                <th className="px-4 py-3 text-right">Miktar</th>
                <th className="px-4 py-3 text-right">Birim Fiyat</th>
                <th className="px-4 py-3 text-right">KDV</th>
                <th className="px-4 py-3 text-right">İndirim</th>
                <th className="px-4 py-3 text-right font-bold">Toplam</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {row.lines.map((l) => {
                const lt = calcLineTotals(l, row.vatExempt)
                return (
                  <tr key={l.id} className="text-gray-700 hover:bg-gray-50/40 transition">
                    <td className="px-4 py-2.5 font-semibold text-gray-900">{l.stockCode}</td>
                    <td className="px-4 py-2.5 font-medium">{l.stockName}</td>
                    <td className="px-4 py-2.5 text-gray-500 max-w-[200px] truncate">{l.description || '—'}</td>
                    <td className="px-4 py-2.5 text-right font-bold text-gray-900">{l.quantity}</td>
                    <td className="px-4 py-2.5 text-right">{formatMoneyWithCurrency(l.unitPrice, l.currencyCode)}</td>
                    <td className="px-4 py-2.5 text-right text-gray-500">%{l.vatRate}</td>
                    <td className="px-4 py-2.5 text-right text-gray-500">
                      {l.discountType === 'none'
                        ? '—'
                        : l.discountType === 'amount'
                        ? formatMoneyWithCurrency(l.discountValue, l.currencyCode)
                        : `%${l.discountValue}`}
                    </td>
                    <td className="px-4 py-2.5 text-right font-black text-gray-900">
                      {formatMoneyWithCurrency(lt.net + (row.vatExempt ? 0 : lt.vatAmount), l.currencyCode)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 font-inter text-gray-900 min-h-[calc(100vh-140px)] pb-12 px-3 sm:px-6">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-gray-100 pb-5">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight flex items-center gap-2">
            <Clock className="text-red-600" size={24} />
            Termin Listesi
          </h1>
          <p className="text-xs text-gray-500 mt-1">Alış siparişlerinin termin durumlarını takip edin, durum güncelleyerek stoğa etki etmesini yönetin.</p>
        </div>
        {/* Termin Raporu (2026-09-17): modal değil ayrı sayfa, yetkisi bu sayfanınki. */}
        <button
          type="button"
          onClick={() => navigate('/invoice/termin/rapor')}
          className="h-10 px-4 rounded-2xl bg-red-600 hover:bg-red-700 text-white text-xs font-bold flex items-center justify-center gap-2 shadow-sm transition-all self-start md:self-auto"
        >
          <BarChart3 size={15} />
          Termin Raporu
        </button>
      </div>

      {/* Filter / Search Area - Responsive */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
        <div className="relative flex-1 w-full">
          <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center text-gray-400 pointer-events-none">
            <Search size={15} />
          </span>
          <input
            type="text"
            placeholder="Belge no, cari kodu, cari adı veya açıklama ile ara..."
            value={globalSearch}
            onChange={(e) => setGlobalSearch(e.target.value)}
            className="w-full h-10 pl-10 pr-4 rounded-2xl border border-gray-200 bg-white/80 text-xs shadow-sm focus:ring-4 focus:ring-red-500/10 focus:border-red-600 transition-all placeholder:text-gray-400"
          />
        </div>
        <button
          type="button"
          onClick={() => void loadAll()}
          className="h-10 px-5 rounded-2xl border border-gray-200/80 bg-white text-xs font-bold hover:bg-gray-50 text-gray-700 flex items-center justify-center gap-2 transition-all shadow-sm active:scale-98"
        >
          Yenile
        </button>
      </div>

      {error && (
        <div className="p-4 text-xs font-semibold text-red-700 bg-red-50 border border-red-200/50 rounded-2xl shadow-sm">
          {error}
        </div>
      )}

      {stockCodeFilter && (
        <div className="flex items-center justify-between p-4 text-xs font-semibold text-blue-700 bg-blue-50 border border-blue-200/50 rounded-2xl shadow-sm">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
            <span>
              <strong>"{stockCodeFilter}"</strong> stok kodlu ürün için bekleyen termin satırları filtreleniyor.
            </span>
          </div>
          <button
            type="button"
            onClick={clearStockFilter}
            className="px-3 py-1 bg-white hover:bg-blue-100/50 border border-blue-200 text-blue-800 rounded-xl transition duration-150"
          >
            Filtreyi Temizle
          </button>
        </div>
      )}

      {/* Main Table Enclosure - Overflow hidden + scroll */}
      <div className="bg-white rounded-3xl border border-gray-200/70 shadow-[0_4px_20px_rgba(0,0,0,0.015)] overflow-hidden relative">
        {loading && rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-gray-400">
            <div className="w-10 h-10 border-4 border-red-600 border-t-transparent rounded-full animate-spin mb-4" />
            <p className="text-xs font-semibold">Yükleniyor...</p>
          </div>
        ) : (
          <div className="overflow-x-auto w-full">
            <Table<PurchaseInvoiceRow>
          onRefresh={() => void loadAll()}
              columns={columns}
              data={filteredRows}
              showColumnFilters={true}
              globalSearch={globalSearch}
              rowKey={(row) => String(row.id)}
              renderExpandedRow={renderExpandedRow}
              rowClassName={() => "transition-colors duration-150"}
            />
          </div>
        )}
      </div>

      {/* Action Portal Dropdown */}
      {actionsOpenForId && actionsMenuPos && canDurumDegistir
        ? createPortal(
            <div
              ref={actionsMenuRef}
              className="fixed z-[9999] w-[180px] bg-white border border-gray-150 rounded-2xl shadow-xl overflow-hidden py-1.5 animate-in fade-in slide-in-from-top-1 duration-100"
              style={{ top: actionsMenuPos.top, left: actionsMenuPos.left }}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                className="w-full px-4 py-2.5 text-xs text-gray-700 hover:bg-gray-50 flex items-center gap-2.5 font-bold transition-colors"
                onClick={() => {
                  const id = actionsOpenForId
                  setActionsOpenForId(null)
                  const row = rows.find((x) => String(x.id) === String(id))
                  if (row) openStatusChange(row)
                }}
              >
                <Clock size={13} className="text-amber-500" />
                Durum Değiştir
              </button>
              {(() => {
                const row = rows.find((x) => String(x.id) === String(actionsOpenForId))
                if (!row || row.terminStatus !== 0) return null
                return (
                  <>
                    <button
                      type="button"
                      className="w-full px-4 py-2.5 text-xs text-gray-700 hover:bg-gray-50 flex items-center gap-2.5 font-bold transition-colors border-t border-gray-100"
                      onClick={() => {
                        setActionsOpenForId(null)
                        openKismiTeslim(row)
                      }}
                    >
                      <ArrowRight size={13} className="text-rose-500" />
                      Kısmi Teslim
                    </button>
                    <button
                      type="button"
                      className="w-full px-4 py-2.5 text-xs text-gray-700 hover:bg-gray-50 flex items-center gap-2.5 font-bold transition-colors border-t border-gray-100"
                      onClick={() => {
                        setActionsOpenForId(null)
                        openEstimatedArrival(row)
                      }}
                    >
                      <Clock size={13} className="text-blue-500" />
                      Tahmini Geliş Tarihi
                    </button>
                  </>
                )
              })()}
            </div>,
            document.body
          )
        : null}

      {/* Premium UI Termin Status Change Modal */}
      <Modal
        isOpen={statusModalOpen}
        onClose={() => {
          if (!statusBusy) {
            setStatusModalOpen(false)
            setSelectedRow(null)
          }
        }}
        title="Termin Durumu Değiştir"
        containerClassName="max-w-md rounded-3xl"
      >
        <div className="space-y-5">
          {selectedRow && (
            <div className="p-4 bg-gray-50/80 rounded-2xl border border-gray-100 space-y-3 shadow-[inset_0_2px_4px_rgba(0,0,0,0.01)]">
              <div className="flex items-center justify-between text-[10px] text-gray-400 font-bold uppercase tracking-wider">
                <span>Belge No</span>
                <span>Tarih</span>
              </div>
              <div className="flex items-center justify-between text-sm font-black text-gray-900">
                <span>{selectedRow.documentNo}</span>
                <span className="bg-white px-2 py-0.5 rounded-lg border border-gray-200/60 text-xs font-semibold text-gray-600">{selectedRow.date}</span>
              </div>
              <div className="border-t border-gray-200/60 pt-2.5 text-xs text-gray-650 flex flex-col gap-1">
                <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Cari Bilgisi</span>
                <span className="font-bold text-gray-800">{selectedRow.customerName}</span>
                <span className="text-[10px] text-gray-500 font-mono">({selectedRow.customerCode})</span>
              </div>
            </div>
          )}

          {/* Premium Durum Kartları */}
          <div className="space-y-2">
            <span className="text-[10px] text-gray-400 font-black uppercase tracking-wider block mb-1">Yeni Durum Seçimi</span>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setNewStatus(0)}
                disabled={statusBusy}
                className={`flex items-start gap-3.5 p-4 rounded-2xl border text-left transition-all relative ${
                  newStatus === 0
                    ? 'border-amber-500 bg-amber-50/40 ring-4 ring-amber-500/10'
                    : 'border-gray-200/80 bg-white hover:bg-gray-50/80'
                }`}
              >
                <div className={`p-2 rounded-xl transition-all ${newStatus === 0 ? 'bg-amber-100 text-amber-700 shadow-sm' : 'bg-gray-100 text-gray-400'}`}>
                  <Clock size={16} />
                </div>
                <div>
                  <div className="text-xs font-bold text-gray-900">Bekliyor</div>
                  <div className="text-[10px] text-gray-500 mt-0.5 leading-relaxed">Fatura stoğa etki etmez, termin durumunda bekler.</div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setNewStatus(1)}
                disabled={statusBusy}
                className={`flex items-start gap-3.5 p-4 rounded-2xl border text-left transition-all relative ${
                  newStatus === 1
                    ? 'border-emerald-500 bg-emerald-50/40 ring-4 ring-emerald-500/10'
                    : 'border-gray-200/80 bg-white hover:bg-gray-50/80'
                }`}
              >
                <div className={`p-2 rounded-xl transition-all ${newStatus === 1 ? 'bg-emerald-100 text-emerald-700 shadow-sm' : 'bg-gray-100 text-gray-400'}`}>
                  <CheckCircle2 size={16} />
                </div>
                <div>
                  <div className="text-xs font-bold text-gray-900">Teslim Edildi</div>
                  <div className="text-[10px] text-gray-500 mt-0.5 leading-relaxed">Ürünler depolara aktarılır ve stoklar güncellenir.</div>
                </div>
              </button>
            </div>
          </div>

          {newStatus === 1 && selectedRow && selectedRow.lines && selectedRow.lines.length > 0 && (
            <div className="space-y-2.5 border-t border-gray-100 pt-4">
              <span className="text-[10px] text-gray-400 font-black uppercase tracking-wider block">Depo Seçimi (Ürün Bazlı)</span>
              <div className="max-h-[220px] overflow-y-auto space-y-2 pr-1">
                {selectedRow.lines.map((line) => (
                  <div key={line.id} className="flex items-center justify-between gap-3 p-2 bg-gray-50/80 rounded-xl border border-gray-100">
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-bold text-gray-900 truncate">{line.stockName || line.stockCode}</div>
                      <div className="text-[10px] text-gray-500 mt-0.5">Kalan: {line.quantity} adet</div>
                    </div>
                    <select
                      className="px-2 py-1 text-xs border border-gray-300 rounded-lg bg-white w-[150px] shrink-0"
                      value={lineWarehouses[Number(line.id)] ?? ''}
                      onChange={(e) => {
                        const val = Number(e.target.value)
                        setLineWarehouses(prev => ({ ...prev, [Number(line.id)]: val }))
                      }}
                    >
                      <option value="">Depo Seçiniz...</option>
                      {warehouses.map((w) => (
                        <option key={String(w.warehouseCode)} value={String(w.warehouseCode)}>
                          {`${w.warehouseCode} - ${w.name ?? ''}`.trim()}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Aksiyon Butonları */}
          <div className="flex justify-end items-center gap-2.5 pt-3 border-t border-gray-100">
            <button
              type="button"
              onClick={() => {
                setStatusModalOpen(false)
                setSelectedRow(null)
              }}
              disabled={statusBusy}
              className="h-10 px-5 rounded-2xl border border-gray-200 bg-white hover:bg-gray-50 text-xs font-bold text-gray-700 transition disabled:opacity-50 active:scale-98"
            >
              Vazgeç
            </button>
            <button
              type="button"
              onClick={() => void handleStatusSubmit()}
              disabled={statusBusy}
              className="h-10 px-5 rounded-2xl bg-gradient-to-r from-red-700 via-rose-600 to-red-700 hover:opacity-95 text-white text-xs font-bold transition-all disabled:opacity-50 flex items-center gap-1.5 shadow-md shadow-red-500/10 active:scale-98"
            >
              {statusBusy ? (
                <>
                  <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Güncelleniyor...
                </>
              ) : (
                'Durumu Güncelle'
              )}
            </button>
          </div>
        </div>
      </Modal>

      {/* Premium UI Kısmi Teslim Modal */}
      <Modal
        isOpen={kismiModalOpen}
        onClose={() => {
          if (!kismiBusy) {
            setKismiModalOpen(false)
            setKismiRow(null)
          }
        }}
        title="Kısmi Teslimat"
        containerClassName="max-w-2xl rounded-3xl"
      >
        <div className="space-y-5">
          {kismiRow && (
            <div className="p-4 bg-gray-50/80 rounded-2xl border border-gray-100 space-y-3 shadow-[inset_0_2px_4px_rgba(0,0,0,0.01)]">
              <div className="flex items-center justify-between text-[10px] text-gray-400 font-bold uppercase tracking-wider">
                <span>Belge No</span>
                <span>Tarih</span>
              </div>
              <div className="flex items-center justify-between text-sm font-black text-gray-900">
                <span>{kismiRow.documentNo}</span>
                <span className="bg-white px-2 py-0.5 rounded-lg border border-gray-200/60 text-xs font-semibold text-gray-600">{kismiRow.date}</span>
              </div>
              {/*
                İSTİSNA DAMGASI GÖRÜNÜR DURUYOR. Aşağıdaki satırlarda KDV %0 yazacak; kalemin
                kendi oranı (örn. %16) kayıtta durduğu için sebebi yazılmazsa "oran nereye
                gitti" sorusu doğuyor.
              */}
              {kismiRow.vatExempt && (
                <div className="flex">
                  <span className="px-2 py-0.5 rounded-lg bg-amber-50 border border-amber-200 text-[10px] font-black uppercase tracking-wider text-amber-700">
                    KDV İstisnalı — bu teslimata KDV eklenmez
                  </span>
                </div>
              )}
              <div className="border-t border-gray-200/60 pt-2.5 text-xs text-gray-650 flex flex-col gap-1">
                <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Cari Bilgisi</span>
                <span className="font-bold text-gray-800">{kismiRow.customerName}</span>
                <span className="text-[10px] text-gray-500 font-mono">({kismiRow.customerCode})</span>
              </div>
            </div>
          )}

          {/*
            TESLİMAT GEÇMİŞİ (2026-08-29): bu siparişten daha önce ne kadarı, hangi depoya,
            hangi fiyat ve kurla girdi. Önce ekranda hiç görünmüyordu.
          */}
          {kismiRow && (kismiHistoryLoading || kismiHistory.length > 0) && (
            <div className="space-y-2">
              <span className="text-[10px] text-gray-400 font-black uppercase tracking-wider block">
                Önceki Teslimatlar {kismiHistoryLoading ? '· yükleniyor…' : `· ${kismiHistory.length} parti`}
              </span>
              {kismiHistory.length > 0 && (
                <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white max-h-[180px] overflow-y-auto">
                  <table className="w-full text-xs border-collapse">
                    <thead className="sticky top-0 bg-gray-50 z-10">
                      <tr className="border-b border-gray-200 text-gray-400 font-bold uppercase text-[9px] tracking-wider">
                        <th className="px-3 py-2 text-left">Belge No</th>
                        <th className="px-3 py-2 text-left">Ürün</th>
                        <th className="px-3 py-2 text-right">Miktar</th>
                        <th className="px-3 py-2 text-left">Depo</th>
                        <th className="px-3 py-2 text-right">Birim Fiyat</th>
                        <th className="px-3 py-2 text-right">Kur</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {kismiHistory.flatMap((p) =>
                        p.lines.map((hl, i) => (
                          <tr key={`${p.id}-${i}`} className="text-gray-700">
                            <td className="px-3 py-2 font-mono text-[11px]">{i === 0 ? p.documentNo : ''}</td>
                            <td className="px-3 py-2">{hl.stockName || hl.stockCode}</td>
                            <td className="px-3 py-2 text-right font-bold">{hl.quantity}</td>
                            <td className="px-3 py-2 text-[11px]">{hl.warehouseName || hl.warehouseCode || '-'}</td>
                            <td className="px-3 py-2 text-right">{Number(hl.currencyUnitPrice).toFixed(2)}</td>
                            <td className="px-3 py-2 text-right text-[11px] text-slate-500">
                              {i === 0 ? `${Number(p.exchangeRate ?? 1).toFixed(4)}${p.rateSource === 'Manuel' ? ' · elle' : ''}` : ''}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/*
            PARTİNİN BELGE NO'SU VE KURU. Belge no boşsa sistem üretir; DOLU VE ZATEN VARSA
            teslimat o faturaya eklenir (aynı fiyat → miktar toplanır, farklı fiyat → ayrı kalem).
          */}
          {kismiRow && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="block text-[10px] text-gray-400 font-black uppercase tracking-wider mb-1">
                  Teslimat Belgesi
                </label>

                {/* Önce KARAR, sonra alan: yeni fatura mı, mevcuda ekleme mi. */}
                <div className="flex gap-1.5 mb-2">
                  {([
                    { k: 'yeni' as const, e: 'Yeni fatura' },
                    { k: 'mevcut' as const, e: 'Mevcuda ekle' }
                  ]).map((o) => (
                    <button
                      key={o.k}
                      type="button"
                      disabled={kismiBusy || (o.k === 'mevcut' && kismiHistory.length === 0)}
                      onClick={() => setKismiBelgeModu(o.k)}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition disabled:opacity-40 ${
                        kismiBelgeModu === o.k
                          ? 'bg-red-600 text-white border-red-600'
                          : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      {o.e}
                    </button>
                  ))}
                </div>

                {kismiBelgeModu === 'yeni' ? (
                  <>
                    {/*
                      15 KARAKTER SINIRI: `PurchaseInvoices."DocumentNo"` kolonu varchar(15).
                      Sınır olmadan uzun numara sunucuya gidiyor ve veritabanı
                      "22001: varying(15) veri tipi için çok uzun" diye reddediyordu;
                      kullanıcı ham DbUpdateException görüyordu. Sunucu tarafına da aynı
                      sınır kondu (KismiTeslimRequest) — bu kutu yalnızca ilk kapı.
                    */}
                    <input
                      className="w-full h-9 px-2 rounded-lg border border-slate-200 text-sm"
                      value={kismiDocNo}
                      disabled={kismiBusy}
                      maxLength={15}
                      onChange={(e) => setKismiDocNo(e.target.value.slice(0, 15))}
                      placeholder="Boş bırakılırsa sistem üretir"
                    />
                    <div className="mt-1 text-[10px] text-slate-500">
                      Tedarikçinin gerçek irsaliye numarasını yazabilirsiniz (en fazla 15 karakter).
                    </div>
                  </>
                ) : (
                  <>
                    <select
                      className="w-full h-9 px-2 rounded-lg border border-slate-200 text-sm bg-white"
                      value={kismiHedefBelge}
                      disabled={kismiBusy}
                      onChange={(e) => setKismiHedefBelge(e.target.value)}
                    >
                      <option value="">Fatura seçiniz...</option>
                      {kismiHistory.map((p) => (
                        <option key={p.id} value={p.documentNo}>
                          {p.documentNo} · {String(p.date).slice(0, 10)} · {Number(p.grandTotal ?? 0).toFixed(2)}
                        </option>
                      ))}
                    </select>
                    <div className="mt-1 text-[10px] text-slate-500">
                      Aynı fiyattaki kalemler birleşir, farklı fiyat ayrı kalem olur.
                    </div>
                  </>
                )}

                {kismiHistory.length === 0 && (
                  <div className="mt-1 text-[10px] text-slate-400">
                    Bu siparişin henüz teslimatı yok, mevcuda ekleme yapılamaz.
                  </div>
                )}
              </div>
              <div>
                <label className="block text-[10px] text-gray-400 font-black uppercase tracking-wider mb-1">
                  Para Birimi / Kur
                </label>
                {/*
                  Para birimi ARTIK SEÇİLEBİLİR: sipariş USD olsa da mal gelince fatura TL
                  kesilebiliyor. Seçim değişince kalem fiyatları da çevrilir.
                */}
                <select
                  className="w-full h-9 px-2 mb-1 rounded-lg border border-slate-200 text-sm bg-white font-semibold"
                  value={String(kismiDovizId)}
                  disabled={kismiBusy}
                  onChange={(e) => kismiDovizDegistir(Number(e.target.value) || 1)}
                >
                  <option value="1">₺ TL</option>
                  <option value="3">$ USD</option>
                  <option value="2">€ EUR</option>
                  <option value="4">£ GBP</option>
                </select>
                {kismiTlMi ? (
                  <div className="mb-1 text-[10px] text-slate-500 font-semibold">Kur uygulanmaz</div>
                ) : null}
                <input
                  className="w-full h-9 px-2 rounded-lg border border-slate-200 text-sm disabled:bg-slate-50 disabled:text-slate-400"
                  value={kismiRate}
                  disabled={kismiBusy || kismiTlMi}
                  onChange={(e) => { setKismiRate(e.target.value); setKismiRateTouched(true) }}
                />
                <div className="mt-1 text-[10px] text-slate-500">
                  {kismiRateTouched ? 'Elle girildi · Manuel damgalanır' : 'Siparişin kuru'}
                </div>
              </div>
              <div className="flex items-end pb-1">
                <label className="inline-flex items-center gap-2 text-xs font-semibold text-gray-700 cursor-pointer">
                  <input
                    type="checkbox"
                    className="w-4 h-4 rounded border-gray-300 text-emerald-600"
                    checked={kismiIncludeRemainder}
                    disabled={kismiBusy}
                    onChange={(e) => {
                      const acik = e.target.checked
                      setKismiIncludeRemainder(acik)
                      /*
                        İŞARETLENİNCE MİKTARLAR ANINDA DOLAR (2026-08-30 kullanıcı bildirimi:
                        "boş bir buton gibi, çok anlamsız").

                        Önce yalnızca sunucuya bir bayrak gönderiyordu; ekranda hiçbir şey
                        değişmediği için ne yaptığı anlaşılmıyordu. Artık kalan miktarların
                        tamamı kutulara yazılır, kullanıcı ne teslim alacağını görür ve
                        isterse tek tek düzeltir. Kutu kaldırılınca sıfırlanır.
                      */
                      setKismiQuantities(() => {
                        const q: Record<string, number> = {}
                        kismiRow?.lines.forEach((l) => { q[l.id] = acik ? l.quantity : 0 })
                        return q
                      })
                    }}
                  />
                  Kalanı da bu teslimata dahil et
                  <span className="ml-1 text-[10px] font-normal text-slate-500">
                    (kalan miktarların tamamını doldurur)
                  </span>
                </label>
              </div>
            </div>
          )}

          {kismiNotice && (
            <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-800">
              {kismiNotice}
            </div>
          )}

          {/* Lines Table */}
          {kismiRow && (
            <div className="space-y-2">
              <span className="text-[10px] text-gray-400 font-black uppercase tracking-wider block mb-1">Ürün Teslimat Bilgileri</span>
              <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white shadow-sm max-h-[300px] overflow-y-auto">
                <table className="w-full text-xs text-left border-collapse">
                  <thead className="sticky top-0 bg-gray-50 z-10">
                    <tr className="border-b border-gray-200 text-gray-400 font-bold uppercase text-[9px] tracking-wider">
                      <th className="px-3 py-3">Stok Kodu</th>
                      <th className="px-3 py-3">Stok Adı</th>
                      <th className="px-3 py-3 text-right">Kalan</th>
                      <th className="px-3 py-3 text-right w-[110px]">Teslim Edilen</th>
                      <th className="px-3 py-3 text-right w-[120px]">Birim Fiyat ({kismiSimge})</th>
                      <th className="px-3 py-3 text-right w-[60px]">KDV</th>
                      <th className="px-3 py-3 text-right w-[110px]">KDV Tutar</th>
                      <th className="px-3 py-3 text-right w-[120px]">Toplam</th>
                      <th className="px-3 py-3 text-left w-[160px]">Depo</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {kismiRow.lines.map((l) => {
                      /*
                        SATIR HESABI ALIŞ FATURASIYLA AYNI (2026-08-30 kullanıcı isteği:
                        "burası aynı alış faturasındaki gibi açılacak, aynı bilgileri
                        göreceğiz"). Miktar × fiyat, KDV oranı, KDV tutarı ve satır toplamı
                        ekranda görünür; kullanıcı neyi teslim aldığını ve kaça aldığını
                        kaydetmeden önce görür.
                      */
                      const teslimMiktar = Number(kismiQuantities[l.id] ?? 0)
                      const birimFiyat = Number(String(kismiPrices[Number(l.id)] ?? '').replace(',', '.')) || 0
                      const satirNet = teslimMiktar * birimFiyat
                      /*
                        KDV İSTİSNASI BURADA DA GEÇERLİ (2026-09-03 kullanıcı bildirimi:
                        "kdvsi yok ama terminde kdv gözüküyor").

                        Satır KDV'yi kalemin oranından hesaplıyor ama belgenin `vatExempt`
                        damgasına BAKMIYORDU: KDV İstisna = Evet olan bir alışta (KEA1, KDV
                        Tutar ₺0,00) bu önizleme %16 ve ₺105.332,64 gösteriyor, satır
                        toplamını da o kadar şişiriyordu.

                        Yalnız EKRAN yanlıştı: listenin kendi hesabı (`calcLineTotals`) ve
                        sunucu (`ApplyTotalsAsync` → `VatExempt ? 0 : ...`, ayrıca kısmi
                        teslimatta `VatExempt = original.VatExempt` kopyalanıyor) istisnayı
                        zaten uyguluyor — kesilen fatura doğru, kullanıcının kaydetmeden önce
                        gördüğü sayı yanlıştı.
                      */
                      const kdvMuaf = Boolean(kismiRow.vatExempt)
                      const kdvOrani = kdvMuaf ? 0 : Number((l as any).vatRate ?? 0)
                      const kdvTutar = (satirNet * kdvOrani) / 100
                      return (
                      <tr key={l.id} className="text-gray-700 hover:bg-gray-50/40 transition">
                        <td className="px-3 py-3 font-semibold text-gray-900">{l.stockCode}</td>
                        <td className="px-3 py-3">{l.stockName}</td>
                        <td className="px-3 py-3 text-right font-bold text-gray-900">{l.quantity}</td>

                        <td className="px-3 py-2 text-right">
                          <input
                            type="number"
                            min={0}
                            max={l.quantity}
                            step="any"
                            disabled={kismiBusy}
                            value={kismiQuantities[l.id] ?? ''}
                            onChange={(e) => {
                              const val = Math.max(0, Math.min(l.quantity, Number(e.target.value) || 0))
                              setKismiQuantities((prev) => ({ ...prev, [l.id]: val }))
                            }}
                            className="w-full h-8 px-2 text-right rounded-lg border border-gray-200 bg-white text-xs font-semibold focus:ring-4 focus:ring-red-500/10 focus:border-red-600 transition"
                          />
                        </td>

                        <td className="px-3 py-2 text-right">
                          <input
                            type="number"
                            min={0}
                            step="any"
                            disabled={kismiBusy}
                            className="w-full h-8 px-2 text-right rounded-lg border border-gray-200 bg-white text-xs"
                            value={kismiPrices[Number(l.id)] ?? ''}
                            onChange={(e) => setKismiPrices((prev) => ({ ...prev, [Number(l.id)]: e.target.value }))}
                          />
                        </td>

                        <td className="px-3 py-3 text-right text-slate-500">%{kdvOrani}</td>
                        <td className="px-3 py-3 text-right">{kismiSimge}{kdvTutar.toFixed(2)}</td>
                        <td className="px-3 py-3 text-right font-bold text-gray-900">{kismiSimge}{(satirNet + kdvTutar).toFixed(2)}</td>

                        <td className="px-3 py-2 text-left">
                          {/* Depo ARTIK HER ZAMAN seçilebilir: eskiden miktar girilene kadar
                              kilitliydi ve kullanıcı depoyu seçemiyordu. */}
                          <select
                            className="px-2 py-1 text-xs border border-gray-300 rounded-lg bg-white w-full disabled:opacity-50"
                            disabled={kismiBusy}
                            value={kismiWarehouses[Number(l.id)] ?? ''}
                            onChange={(e) => setKismiWarehouses((prev) => ({ ...prev, [Number(l.id)]: Number(e.target.value) }))}
                          >
                            <option value="">Depo Seçiniz...</option>
                            {warehouses.map((w) => (
                              <option key={String(w.warehouseCode)} value={String(w.warehouseCode)}>
                                {`${w.warehouseCode} - ${w.name ?? ''}`.trim()}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex justify-end items-center gap-2.5 pt-3 border-t border-gray-100">
            <button
              type="button"
              onClick={() => {
                setKismiModalOpen(false)
                setKismiRow(null)
              }}
              disabled={kismiBusy}
              className="h-10 px-5 rounded-2xl border border-gray-200 bg-white hover:bg-gray-50 text-xs font-bold text-gray-700 transition disabled:opacity-50 active:scale-98"
            >
              Vazgeç
            </button>
            <button
              type="button"
              onClick={() => void handleKismiSubmit()}
              disabled={kismiBusy}
              className="h-10 px-5 rounded-2xl bg-gradient-to-r from-red-700 via-rose-600 to-red-700 hover:opacity-95 text-white text-xs font-bold transition-all disabled:opacity-50 flex items-center gap-1.5 shadow-md shadow-red-500/10 active:scale-98"
            >
              {kismiBusy ? (
                <>
                  <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Kaydediliyor...
                </>
              ) : (
                'Kısmi Teslim Et'
              )}
            </button>
          </div>
        </div>
      </Modal>

      {/* Tahmini Geliş Tarihi Modal */}
      <Modal
        isOpen={arrivalModalOpen}
        onClose={() => {
          if (!arrivalBusy) {
            setArrivalModalOpen(false)
            setArrivalRow(null)
          }
        }}
        title="Tahmini Geliş Tarihi Belirle"
        containerClassName="max-w-md rounded-3xl"
      >
        <div className="space-y-5">
          {arrivalRow && (
            <div className="p-4 bg-gray-50/80 rounded-2xl border border-gray-100 space-y-3 shadow-[inset_0_2px_4px_rgba(0,0,0,0.01)]">
              <div className="flex items-center justify-between text-[10px] text-gray-400 font-bold uppercase tracking-wider">
                <span>Belge No</span>
                <span>Termin Tarihi</span>
              </div>
              <div className="flex items-center justify-between text-sm font-black text-gray-900">
                <span>{arrivalRow.documentNo}</span>
                <span className="bg-white px-2 py-0.5 rounded-lg border border-gray-200/60 text-xs font-semibold text-gray-600">
                  {(() => {
                    const clean = arrivalRow.date.split('T')[0]
                    const parts = clean.split('-')
                    return parts.length === 3 ? `${parts[2]}.${parts[1]}.${parts[0]}` : arrivalRow.date
                  })()}
                </span>
              </div>
              <div className="border-t border-gray-200/60 pt-2.5 text-xs text-gray-650 flex flex-col gap-1">
                <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Cari Bilgisi</span>
                <span className="font-bold text-gray-800">{arrivalRow.customerName}</span>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <label htmlFor="arrival-date" className="text-[10px] text-gray-400 font-black uppercase tracking-wider block">
              Tahmini Geliş Tarihi
            </label>
            <input
              id="arrival-date"
              type="date"
              disabled={arrivalBusy}
              value={selectedArrivalDate}
              onChange={(e) => handleArrivalDateChange(e.target.value)}
              className="w-full h-10 px-4 rounded-2xl border border-gray-200 bg-white text-xs font-semibold focus:ring-4 focus:ring-red-500/10 focus:border-red-600 transition"
            />
            {arrivalWarning && (
              <p className="text-[11px] font-semibold text-amber-600 mt-1.5 flex items-center gap-1 animate-pulse">
                ⚠️ {arrivalWarning}
              </p>
            )}
          </div>

          <div className="flex justify-end items-center gap-2.5 pt-3 border-t border-gray-100">
            <button
              type="button"
              onClick={() => {
                setArrivalModalOpen(false)
                setArrivalRow(null)
              }}
              disabled={arrivalBusy}
              className="h-10 px-5 rounded-2xl border border-gray-200 bg-white hover:bg-gray-50 text-xs font-bold text-gray-700 transition disabled:opacity-50 active:scale-98"
            >
              Vazgeç
            </button>
            <button
              type="button"
              onClick={() => void handleArrivalSubmit()}
              disabled={arrivalBusy || Boolean(arrivalWarning)}
              className="h-10 px-5 rounded-2xl bg-gradient-to-r from-red-700 via-rose-600 to-red-700 hover:opacity-95 text-white text-xs font-bold transition-all disabled:opacity-50 flex items-center gap-1.5 shadow-md shadow-red-500/10 active:scale-98"
            >
              {arrivalBusy ? (
                <>
                  <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Kaydediliyor...
                </>
              ) : (
                'Tarihi Kaydet'
              )}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
