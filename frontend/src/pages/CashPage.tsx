import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { fetchAllPages } from '../lib/fetchAllPages'
import { useOutletContext } from 'react-router-dom'
import Modal from '../components/Modal'
import Table, { type TableColumn } from '../components/Table'
import FormInput from '../components/forms/FormInput'
import FormSelect from '../components/forms/FormSelect'
import FormSearchableSelect from '../components/forms/FormSearchableSelect'
import SearchableCariSelect, { type CariOption } from '../components/SearchableCariSelect'
import { CARI_SEARCH_LIMIT, buildCariSearchQuery } from '../utils/cariRemoteSearch'
import { isOutflowDirection } from '../utils/transactionDirection'
import NotificationPopup from '../components/NotificationPopup'
import { fetchCashAccounts, type CashAccountDto } from '../api/cashAccounts'
import {
  createCashAccountTransaction,
  deleteCashAccountTransaction,
  fetchCashAccountTransactions,
  updateCashAccountTransaction,
  type CashAccountTransactionDto,
  fetchLinkedInvoiceHeaderByCashTransactionId,
  fetchLinkedInvoiceLinesByCashTransactionId
} from '../api/cashAccountTransactions'
import {
  createCashAccountTransfer,
  deleteCashAccountTransfer,
  fetchCashAccountTransfers,
  type CashAccountTransferDto
} from '../api/cashAccountTransfers'
import { fetchCashAccountBalance, fetchCashAccountBalanceByCurrency, type CurrencyBalanceDto } from '../api/cashAccounts'
import { fetchCustomerByCode, fetchCustomersDropdown, type CustomerDto } from '../api/customers'
import { CUSTOMER_ACCOUNT_OPTIONS, DEFAULT_CUSTOMER_ACCOUNT_ID } from '../constants/customerAccountOptions'
import { fetchBankAccountDefinitions } from '../api/bankAccountDefinitions'
import { fetchInvoiceHeader, fetchInvoiceLines, type InvoiceHeaderDto, type InvoiceLineDto } from '../api/invoices'
import { getInvoiceList } from '../lib/invoices'
import { fetchLatestFxRate, fetchCrossFxRate } from '../api/fx'
import { AppDataTable, type DataTableRowAction } from '../components/data-table'
import type { ColumnDef } from '@tanstack/react-table'

type LayoutContext = {
  activeMenuId: string
  activeTabId?: string
  setActiveTabId?: (id?: string) => void
  isSuperAdmin?: boolean
  allowedKeys?: Set<string>
}

const normalizeCurrencyTypeId = (cur: number) => {
  const v = Number(cur ?? 1)
  return v === 0 ? 1 : v
}

const currencyCodeByTypeId = (cur: number) => {
  const v = Number(cur ?? 1)
  return v === 2 ? 'EUR' : v === 3 ? 'USD' : v === 4 ? 'GBP' : 'TRY'
}

const currencySymbolByCode = (code: string) => {
  return code === 'TRY' ? '₺' : code === 'USD' ? '$' : code === 'EUR' ? '€' : code === 'GBP' ? '£' : code
}

const isTryCurrency = (cur: number) => {
  const v = Number(cur ?? 1)
  return v === 1 || v === 0
}

const todayYmd = () => new Date().toISOString().slice(0, 10)

const formatMoney = (n: number) => {
  try {
    return new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n ?? 0))
  } catch {
    return String(n ?? 0)
  }
}

function parseRate(val: any): number {
  if (val === null || val === undefined) return 0
  if (typeof val === 'number') return Number.isFinite(val) ? val : 0

  let str = String(val).trim().replace(/[^\d.,-]/g, '')
  if (!str) return 0

  const lastDot = str.lastIndexOf('.')
  const lastComma = str.lastIndexOf(',')

  if (lastDot >= 0 && lastComma >= 0) {
    const decimalSep = lastComma > lastDot ? ',' : '.'
    const groupSep = decimalSep === ',' ? '.' : ','
    str = str.split(groupSep).join('').replace(decimalSep, '.')
  } else {
    str = str.replace(',', '.')
  }

  const num = parseFloat(str)
  return Number.isFinite(num) ? num : 0
}

function formatCrossRate(rate: number): string {
  if (!Number.isFinite(rate) || !(rate > 0)) return '1'
  if (rate === 1) return '1'
  return Number(rate.toFixed(4)).toString()
}

const parseFormattedAmount = (val: any): number => {
  if (val === null || val === undefined) return 0
  if (typeof val === 'number') return Number.isFinite(val) ? val : 0

  let str = String(val).trim()
  if (!str) return 0

  str = str.replace(/[^\d.,-]/g, '')
  if (!str) return 0

  const hasDot = str.includes('.')
  const hasComma = str.includes(',')

  if (hasDot && hasComma) {
    const lastDot = str.lastIndexOf('.')
    const lastComma = str.lastIndexOf(',')
    if (lastComma > lastDot) {
      str = str.replace(/\./g, '').replace(',', '.')
    } else {
      str = str.replace(/,/g, '')
    }
  } else if (hasComma) {
    const parts = str.split(',')
    if (parts.length === 2 && parts[1].length === 3 && parts[0].length <= 3) {
      str = str.replace(',', '')
    } else {
      str = str.replace(',', '.')
    }
  } else if (hasDot) {
    const parts = str.split('.')
    if (parts.length > 2) {
      str = str.replace(/\./g, '')
    } else if (parts.length === 2 && parts[1].length === 3 && parts[0].length <= 3) {
      str = str.replace('.', '')
    }
  }

  const num = parseFloat(str)
  return Number.isFinite(num) ? num : 0
}

const handleCurrencyInputChange = (val: string): string => {
  if (!val || val.trim() === '') return '0,00'
  const rawDigits = val.replace(/[^\d]/g, '')
  if (!rawDigits) return '0,00'
  const cents = parseInt(rawDigits, 10)
  const num = cents / 100
  return formatMoney(num)
}

const cleanCashName = (name?: string | null, fallbackCode?: string): string => {
  const raw = String(name ?? '').trim()
  if (!raw) return String(fallbackCode ?? '').trim()
  if (raw.includes(' - ')) {
    const parts = raw.split(' - ')
    if (parts.length >= 2) {
      return parts.slice(1).join(' - ').trim()
    }
  }
  return raw
}

function KasaGirisCikisView() {
  const { isSuperAdmin, allowedKeys } = useOutletContext<LayoutContext>()
  // `isOpeningBalance` GERCEK BIR HAREKET DEGIL: kasanin devir bakiyesini listenin en
  // altina koyan sanal satirin damgasi. Silme/duzenleme yollari bu satiri disarida
  // birakmali, `id` alani gercek bir kaydi gostermiyor.
  type Row = CashAccountTransactionDto & { actions: string; isOpeningBalance?: boolean }

  const [open, setOpen] = useState(false)
  const [guardOpen, setGuardOpen] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [items, setItems] = useState<Row[]>([])
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [deleteRow, setDeleteRow] = useState<Row | null>(null)

  const askDelete = (row: Row) => {
    const ref: any = (row as any)?.referenceType
    const isManual = ref === 1 || ref === '1' || String(ref ?? '').toLowerCase() === 'manual'
    const isInvoice = ref === 2 || ref === '2' || String(ref ?? '').toLowerCase() === 'invoice'

    if (!isManual && !isInvoice) {
      showPopup('error', 'Hata', 'Sistem kaydı silinemez')
      return
    }

    setDeleteRow(row)
    setDeleteConfirmOpen(true)
  }

  const confirmDelete = async () => {
    if (!deleteRow) return
    const rowToDelete = deleteRow
    setDeleteConfirmOpen(false)
    setDeleteRow(null)
    try {
      await deleteCashAccountTransaction(rowToDelete.id)
      showPopup('success', 'Başarılı', 'Kayıt silindi')
      await reload(selectedCashId)
      await reloadBalance(selectedCashId)
    } catch (e: any) {
      showPopup('error', 'Hata', String(e?.message ?? 'Silinemedi'))
    }
  }

  const [cashAccounts, setCashAccounts] = useState<CashAccountDto[]>([])
  const [cashAccountId, setCashAccountId] = useState<string>('')

  const [balanceLoading, setBalanceLoading] = useState(false)
  const [balance, setBalance] = useState<number | null>(null)
  const [multiCurrencyBalances, setMultiCurrencyBalances] = useState<CurrencyBalanceDto[]>([])

  const [createForms, setCreateForms] = useState<any[]>([])

  const [customers, setCustomers] = useState<Array<{ customerCode: string; name: string; currencyTypeId: number; phone?: string }>>([])
  const [banks, setBanks] = useState<Array<{ accountCode: string; accountName: string; currencyTypeId: number }>>([])

  /**
   * TL'nin degeri '0' DEGIL '1' (2026-08-22).
   *
   * Suzgec, secilen kasanin para birimini `normalizeCurrencyTypeId` ile yaziyor ve o
   * fonksiyon TL icin 1 donuyor. Secenek listesinde TL '0' oldugu surece TL bir kasa
   * secildiginde `<select>` degeri hicbir secenekle eslesmiyor ve kutu BOS gorunuyordu.
   * Uc iki degeri de TL sayiyor (bkz. CashAccountTransactionsController.List), o yuzden
   * 1 gondermek davranisi degistirmiyor.
   */
  const currencyOptions = [
    { value: '1', label: 'TL (TRY)' },
    { value: '2', label: 'EUR' },
    { value: '3', label: 'USD' },
    { value: '4', label: 'GBP' }
  ]

  const [popupOpen, setPopupOpen] = useState(false)
  const [popupVariant, setPopupVariant] = useState<'success' | 'error' | 'info'>('info')
  const [popupTitle, setPopupTitle] = useState('')
  const [popupMessage, setPopupMessage] = useState('')

  const [customerModalOpen, setCustomerModalOpen] = useState(false)
  const [customerModalLoading, setCustomerModalLoading] = useState(false)
  const [customerModalError, setCustomerModalError] = useState<string | null>(null)
  const [customerModalData, setCustomerModalData] = useState<CustomerDto | null>(null)

  const [invoiceModalOpen, setInvoiceModalOpen] = useState(false)
  const [invoiceModalLoading, setInvoiceModalLoading] = useState(false)
  const [invoiceModalError, setInvoiceModalError] = useState<string | null>(null)
  const [invoiceModalHeader, setInvoiceModalHeader] = useState<InvoiceHeaderDto | null>(null)
  const [invoiceModalLines, setInvoiceModalLines] = useState<InvoiceLineDto[]>([])

  const showPopup = (variant: 'success' | 'error' | 'info', title: string, message: string) => {
    setPopupVariant(variant)
    setPopupTitle(title)
    setPopupMessage(message)
    setPopupOpen(true)
  }

  const openCustomerModal = (row: Row) => {
    const t: any = (row as any)?.counterpartyType
    const isCustomer = Number(t) === 1 || String(t ?? '').toLowerCase() === 'customer'
    const code = String((row as any)?.counterpartyCode ?? '').trim()

    if (!isCustomer || !code) {
      showPopup('info', 'Bilgi', 'Bu satırda cari bilgisi yok')
      return
    }

    setCustomerModalOpen(true)
    setCustomerModalLoading(true)
    setCustomerModalError(null)
    setCustomerModalData(null)

    void (async () => {
      try {
        const data = await fetchCustomerByCode(code)
        if (!data) throw new Error('Cari bulunamadı')
        setCustomerModalData(data)
      } catch (e: any) {
        setCustomerModalError(String(e?.message ?? 'Cari bilgileri alınamadı'))
      } finally {
        setCustomerModalLoading(false)
      }
    })()
  }

  const openInvoiceModal = (row: Row) => {
    const ref: any = (row as any)?.referenceType
    const refId = Number((row as any)?.referenceId ?? 0)
    const isInvoice = Number(ref) === 2 || String(ref ?? '').toLowerCase() === 'invoice'

    const extractInvoiceNoFromDescription = (desc: string | null | undefined) => {
      const s = String(desc ?? '')
      if (!s) return null
      const m = s.match(/satış\s*faturası\s*:\s*([0-9]{10,20})/i)
      if (m && m[1]) return String(m[1]).trim()
      const m2 = s.match(/faturası\s*:\s*([0-9]{10,20})/i)
      if (m2 && m2[1]) return String(m2[1]).trim()
      return null
    }

    setInvoiceModalOpen(true)
    setInvoiceModalLoading(true)
    setInvoiceModalError(null)
    setInvoiceModalHeader(null)
    setInvoiceModalLines([])

    void (async () => {
      try {
        // Prefer cash-authorized endpoint to avoid invoice permission issues.
        try {
          const [h2, lines2] = await Promise.all([
            fetchLinkedInvoiceHeaderByCashTransactionId(Number((row as any)?.id ?? 0)),
            fetchLinkedInvoiceLinesByCashTransactionId(Number((row as any)?.id ?? 0))
          ])
          setInvoiceModalHeader({ id: h2.id, faturaNo: h2.faturaNo, cariKodu: h2.cariKodu, faturaAcik: String(h2.faturaAcik ?? '') })
          setInvoiceModalLines(
            (lines2 ?? []).map((x) => ({
              id: x.id,
              stockCode: x.stockCode,
              stockName: x.stockName,
              description: x.description ?? null,
              vatRate: x.vatRate,
              quantity: x.quantity,
              unitPrice: x.unitPrice,
              total: x.total
            }))
          )
          return
        } catch {
          // Fall back to invoice endpoints below.
        }

        let resolvedId = Number.isFinite(refId) && refId > 0 ? refId : 0
        if (!resolvedId || resolvedId <= 0) {
          const invoiceNo = extractInvoiceNoFromDescription((row as any)?.description)
          if (invoiceNo) {
            const list = await getInvoiceList({ query: invoiceNo, page: 1, pageSize: 10 })
            const found = (list?.items ?? []).find((x: any) => String(x?.faturaNo ?? '').trim() === invoiceNo)
            const id = Number(found?.id ?? 0)
            if (Number.isFinite(id) && id > 0) resolvedId = id
          }
        }

        if (!resolvedId || resolvedId <= 0) {
          if (!isInvoice) throw new Error('Bu satır bir fatura kaydı değil')
          throw new Error('Fatura id bulunamadı')
        }

        const [h, lines] = await Promise.all([fetchInvoiceHeader(resolvedId), fetchInvoiceLines(resolvedId)])
        setInvoiceModalHeader(h)
        setInvoiceModalLines(lines)
      } catch (e: any) {
        setInvoiceModalError(String(e?.message ?? 'Fatura bilgileri alınamadı'))
      } finally {
        setInvoiceModalLoading(false)
      }
    })()
  }



  const [selectedCurrencyTypeIdState, setSelectedCurrencyTypeIdState] = useState<string>('1')

  const selectedCurrencyTypeId = useMemo(() => {
    return Number(selectedCurrencyTypeIdState)
  }, [selectedCurrencyTypeIdState])

  /**
   * KASA LISTESI SECILI DOVIZE GORE SUZULUR (2026-08-22).
   *
   * Ekrandaki sira artik "once doviz, sonra kasa" — banka ekranindaki "once hesap turu,
   * sonra hesap" duzeninin ayni. GBP secilince listede yalnizca GBP kasalari kalir.
   *
   * Karsilastirma NORMALIZE edilerek yapilir: TL kasalar veritabaninda 0 ya da 1 olarak
   * durabiliyor (eski kayitlar 0). Ham esitlik arasaydik TL suzgecinde eski kasalar
   * listeden duserdi.
   */
  const cashOptions = useMemo(() => {
    const suffix = (cur: number) => {
      const v = normalizeCurrencyTypeId(cur)
      return v === 2 ? 'EUR' : v === 3 ? 'USD' : v === 4 ? 'GBP' : 'TL'
    }
    const wanted = normalizeCurrencyTypeId(selectedCurrencyTypeId)
    return (cashAccounts ?? [])
      .filter((c) => normalizeCurrencyTypeId(Number((c as any)?.currencyTypeId ?? 0)) === wanted)
      .map((c) => ({
        value: String(c.id),
        label: `${cleanCashName(c.name, c.code)} (${suffix(Number((c as any)?.currencyTypeId ?? 0))})`
      }))
      .sort((a, b) => a.label.localeCompare(b.label, 'tr-TR'))
  }, [cashAccounts, selectedCurrencyTypeId])

  const selectedCashId = useMemo(() => {
    const id = Number(String(cashAccountId ?? '').trim())
    return Number.isFinite(id) && id > 0 ? id : null
  }, [cashAccountId])

  const selectedCashAccount = useMemo(() => {
    const id = Number(selectedCashId ?? 0)
    if (!id) return null
    return (cashAccounts ?? []).find((x) => Number(x.id) === id) ?? null
  }, [cashAccounts, selectedCashId])

  /**
   * BEKLENEN DOVIZ — hesap degisince atilan GEREKSIZ ilk istegi engeller.
   *
   * Doviz suzgeci, secilen hesabin para birimini yukaridaki efektle takip ediyor; ama
   * `setState` ancak bir sonraki render'da gorunur oluyor. O arada liste efekti bir kez
   * ONCEKI dovizle calisiyordu: hem bosa giden bir istek, hem de bir an icin yanlis
   * dovizli liste (ve devir satirinin kaybolmasi).
   *
   * Burada "suzgecin varmasi gereken deger" ref'te tutuluyor. Liste efekti, suzgec o
   * degere ulasana kadar bekliyor. Kullanici suzgeci ELLE degistirdiginde ref de ayni
   * anda guncellendigi icin bekleme olusmaz — elle secim eskisi gibi calisir.
   */
  const pendingCurrencyRef = useRef<number | null>(null)

  useEffect(() => {
    if (selectedCashAccount) {
      const next = normalizeCurrencyTypeId(Number((selectedCashAccount as any)?.currencyTypeId ?? 0) || 0)
      pendingCurrencyRef.current = next
      setSelectedCurrencyTypeIdState(String(next))
    }
  }, [selectedCashAccount])

  /**
   * Doviz suzgeci ELLE degistirildiginde: secili kasa yeni dovize ait degilse secim DUSER.
   * Kalsaydi kutu bir kasayi, suzgec baska bir dovizi gosterir; liste de bos gelirdi.
   * (Banka ekraninda hesap turu degisince yapilan sey ile ayni.)
   */
  const handleCurrencyFilterChange = (value: string) => {
    const next = normalizeCurrencyTypeId(Number(value))
    // Beklenen doviz de ayni anda guncellenir, yoksa liste efekti kasanin kendi dovizini
    // bekler ve elle secim hicbir zaman yuklenmezdi (bkz. `pendingCurrencyRef`).
    pendingCurrencyRef.current = next
    setSelectedCurrencyTypeIdState(String(next))

    const acc = (cashAccounts ?? []).find((x) => Number(x.id) === Number(selectedCashId ?? 0))
    if (acc && normalizeCurrencyTypeId(Number((acc as any)?.currencyTypeId ?? 0)) !== next) {
      setCashAccountId('')
    }
  }

  // Helper methods to resolve currency details for form rows
  const getIsTryCurrency = (cur: number | string) => {
    const v = Number(cur ?? 1)
    return v === 0 || v === 1
  }

  const getKasaCurrencyTypeId = (form: any) => {
    const id = Number(String(form.cashAccountId ?? '').trim())
    if (!Number.isFinite(id) || id <= 0) return selectedCurrencyTypeId
    const acc = (cashAccounts ?? []).find((x) => Number(x.id) === id) as any
    return normalizeCurrencyTypeId(Number(acc?.currencyTypeId ?? selectedCurrencyTypeId ?? 0) || 0)
  }

  const getCustomerAccountCurrencyTypeId = (form: any) => {
    const raw = Number(form?.customerAccountCurrencyTypeId ?? 1)
    return normalizeCurrencyTypeId(raw)
  }

  const getTenderCurrencyTypeId = (form: any) => {
    return getKasaCurrencyTypeId(form)
  }

  // KUR DAİMA "1 döviz = X ₺" YÖNÜNDEDİR (2026-08-19).
  // Burası bir dönem ÇAPRAZ kur etiketliyordu (1 £ = X €) ve ekran o çapraz kuru
  // uca `currencyRate`/`tenderRate` olarak gönderiyordu; uç ise onu TL kuru sanıyordu.
  // Sonuç: 1.500 £ girildiğinde TL çapası 1.756 ₺ oluyordu (olması gereken ~102.000 ₺).
  const getRateLabel = (_custAccCurr: number, tenderCurr: number) => {
    const tCode = currencyCodeByTypeId(tenderCurr)
    if (tCode === 'TRY') return 'KUR (TL)'
    return `KUR (1 ${tCode} = X ₺)`
  }

  const getSummaryInfo = (form: any) => {
    const amt = parseFormattedAmount(form.amount)
    const rate = parseRate(form.currencyRate) || 1
    const kasaCurr = getKasaCurrencyTypeId(form)
    const tenderCurr = getTenderCurrencyTypeId(form)
    const kasaCode = currencyCodeByTypeId(kasaCurr)
    const tenderCode = currencyCodeByTypeId(tenderCurr)

    // CARİ EKSTREYE ÖDEMENİN KENDİSİ YAZILIR — çevrim yok (uçtaki nota bakınız).
    // 1.500 £ yatan bir işlem ekstreye 1.500 £ olarak düşer.
    const cariAmt = amt
    // TL karşılığı yalnız bilgi amaçlı; kur "1 ödeme dövizi = X ₺".
    const tryAmt = tenderCode === 'TRY' ? amt : (rate > 0 ? Math.round(amt * rate * 100) / 100 : amt)

    return {
      kasaCode,
      tenderCode,
      // Cari hareketi ödemenin para biriminde yazılır; ayrı bir "cari hesap dövizi" yok.
      custAccCode: tenderCode,
      tenderAmt: amt,
      cariAmt,
      tryAmt,
      rate
    }
  }

  /**
   * ISTEK SIRA KORUMASI (2026-08-22) — "devir satiri bazen dusuyor bazen dusmuyor"nun sebebi.
   *
   * Bir hesap secildiginde AYNI anda IKI istek gidiyordu. Sebebi su: doviz suzgeci secilen
   * hesabin para birimini bir efektte TAKIP EDIYOR, ama o efektin setState'i ancak bir
   * sonraki render'da gorunur oluyor. Ilk render'da liste HALA ONCEKI dovizle cekiliyor,
   * doviz guncellenince ikinci kez dogru dovizle cekiliyor.
   *
   * Ikisi de ucta; hangisi once biterse bitsin SONUNCU donen `setItems` kazaniyordu. Yanlis
   * dovizli birinci istek gec dondugunde ekrana o yaziliyor ve devir satiri (yalnizca
   * hesabin KENDI dovizinde gosterildigi icin) kayboluyordu. Dovizli kasalarda/hesaplarda
   * gorulmesinin sebebi bu: TL'de iki istegin dovizi ayni oldugu icin fark etmiyordu.
   *
   * Artik her cagri bir sira numarasi aliyor; yalnizca EN SON cagrinin sonucu ekrana
   * yazilir, onceki istek de iptal edilir.
   */
  const reloadSeqRef = useRef(0)
  const reloadAbortRef = useRef<AbortController | null>(null)
  const balanceSeqRef = useRef(0)
  const balanceAbortRef = useRef<AbortController | null>(null)

  const reloadBalance = async (id?: number | null) => {
    const cashId = id ?? null
    if (!cashId) {
      setBalance(null)
      setMultiCurrencyBalances([])
      return
    }

    balanceAbortRef.current?.abort()
    const ac = new AbortController()
    balanceAbortRef.current = ac
    const seq = ++balanceSeqRef.current
    try {
      setBalanceLoading(true)
      // Fetch both single balance and multi-currency balances
      const [b, multi] = await Promise.all([
        fetchCashAccountBalance(cashId, { signal: ac.signal }),
        fetchCashAccountBalanceByCurrency(cashId, { signal: ac.signal })
      ])
      if (seq !== balanceSeqRef.current) return
      setBalance(Number(b?.balance ?? 0))
      setMultiCurrencyBalances(multi?.balances ?? [])
    } catch {
      if (seq !== balanceSeqRef.current) return
      setBalance(null)
      setMultiCurrencyBalances([])
    } finally {
      if (seq === balanceSeqRef.current) setBalanceLoading(false)
    }
  }

  const reload = async (id?: number | null) => {
    reloadAbortRef.current?.abort()
    const ac = new AbortController()
    reloadAbortRef.current = ac
    const seq = ++reloadSeqRef.current
    try {
      setLoading(true)
      const list = await fetchCashAccountTransactions(
        // Tek kasada BÜTÜN hareketler (bkz. BankPage reloadList, 2026-10-03).
        { cashAccountId: id ?? null, currencyTypeId: selectedCurrencyTypeId, take: id ? 100000 : 500 },
        { signal: ac.signal }
      )
      if (seq !== reloadSeqRef.current) return
      /**
       * DEVIR BAKIYESI satiri (2026-08-22) — banka ekranindakinin aynisi.
       *
       * Kasanin devir tutari (`lastCarryAmount`) bakiye kutusuna zaten giriyordu ama
       * listede hicbir izi yoktu: kullanici satirlari toplayinca kutudaki rakami
       * tutturamiyordu. Artik en eski satir olarak gorunuyor ve Giren/Cikan toplamlarina
       * katiliyor.
       *
       * Yalnizca KASANIN KENDI para biriminde gosterilir: devir tek para birimindedir,
       * baska bir dovize gecildiginde o dovizin hareketleriyle toplanmasi anlamsiz olurdu.
       */
      const accForCarry = (cashAccounts ?? []).find((x) => Number(x.id) === Number(id ?? 0))
      const carryAmount = Number((accForCarry as any)?.lastCarryAmount ?? 0)
      const accCurrency = normalizeCurrencyTypeId(Number((accForCarry as any)?.currencyTypeId ?? 0) || 0)
      const viewCurrency = normalizeCurrencyTypeId(selectedCurrencyTypeId)
      const showCarryRow = Boolean(accForCarry) && Number.isFinite(carryAmount) && carryAmount !== 0 && accCurrency === viewCurrency

      let runningBalance = showCarryRow ? carryAmount : 0
      const listWithBalances = [...(list ?? [])].reverse().map((tx) => {
        const isOut = tx.direction === 2 || String(tx.direction) === '2' || String(tx.direction ?? '').toLowerCase() === 'out'
        const amt = (tx.currencyTypeId === 0 || tx.currencyTypeId === 1) ? Number(tx.amount ?? 0) : Number(tx.currencyAmount ?? 0)
        const giren = isOut ? 0 : amt
        const cikan = isOut ? amt : 0
        runningBalance += giren
        runningBalance -= cikan
        return {
          ...tx,
          giren,
          cikan,
          runningBalance,
          cashAccountName: tx.cashAccountName || `Kasa #${tx.cashAccountId}`,
          dovizTuru: currencyCodeByTypeId(normalizeCurrencyTypeId(tx.currencyTypeId ?? 0))
        }
      })
      const rows: Row[] = listWithBalances.reverse().map((x) => ({ ...x, actions: '' })) as Row[]

      if (showCarryRow) {
        rows.push({
          id: 0,
          isOpeningBalance: true,
          actions: '',
          // Tarih olarak kasanin DEVIR TARIHI yazilir; banka hesabinda boyle bir alan yok,
          // kasada var ve anlamli.
          date: String((accForCarry as any)?.lastCarryDate ?? '').slice(0, 10),
          cashAccountId: Number(id ?? 0),
          cashAccountName: String((accForCarry as any)?.name || (accForCarry as any)?.code || ''),
          dovizTuru: currencyCodeByTypeId(accCurrency),
          currencyTypeId: accCurrency,
          counterpartyName: 'DEVİR BAKİYESİ',
          description: 'Kasa devir bakiyesi',
          giren: carryAmount > 0 ? carryAmount : 0,
          cikan: carryAmount < 0 ? -carryAmount : 0,
          runningBalance: carryAmount
        } as unknown as Row)
      }

      setItems(rows)
    } catch (e: any) {
      // Iptal edilen ya da gecikmis istek sessizce dusurulur: ekrandaki liste ARTIK BASKA
      // bir istegin sonucu, uzerine hata yazmak yanlis olurdu.
      if (seq !== reloadSeqRef.current || ac.signal.aborted) return
      setItems([])
      showPopup('error', 'Hata', String(e?.message ?? 'Kasa hareketleri alınamadı'))
    } finally {
      if (seq === reloadSeqRef.current) setLoading(false)
    }
  }

  useEffect(() => {
    const ac = new AbortController()
    void (async () => {
      try {
        const list = await fetchCashAccounts({ signal: ac.signal })
        setCashAccounts(list ?? [])
        if ((list ?? []).length === 1) {
          const only = list[0]
          if (only?.id) setCashAccountId(String(only.id))
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
        // Liste ARTIK TUMUYLE INDIRILMIYOR — secim kutusu sunucudan ariyor
        // (bkz. cariRemoteSearch). Acilista yalnizca ilk sayfa cekilir.
        const list = await fetchCustomersDropdown({ includeInactive: false, includeMuhtelif: false, limit: CARI_SEARCH_LIMIT, signal: ac.signal })
        setCustomers(mapCashCustomers(list ?? []))
      } catch {
        setCustomers([])
      }
    })()
    return () => ac.abort()
  }, [])

  useEffect(() => {
    const ac = new AbortController()
    void (async () => {
      try {
        const list = await fetchBankAccountDefinitions({ signal: ac.signal })
        setBanks((list ?? []).map((x) => ({ accountCode: String(x.accountCode ?? ''), accountName: String(x.accountName ?? ''), currencyTypeId: Number(x.currencyTypeId ?? 1) })).filter((x) => x.accountCode))
      } catch {
        setBanks([])
      }
    })()
    return () => ac.abort()
  }, [])

  useEffect(() => {
    // Suzgec, secilen hesabin dovizine henuz varmadiysa bekle (bkz. `pendingCurrencyRef`).
    if (pendingCurrencyRef.current !== null && pendingCurrencyRef.current !== normalizeCurrencyTypeId(selectedCurrencyTypeId)) return
    void reload(selectedCashId)
    void reloadBalance(selectedCashId)
    // `selectedCashAccount` de bagimlilikta: devir tutari ORADAN okunuyor. Hesap listesi
    // secimden SONRA gelirse (yavas ag) liste bir kez devir satirsiz kurulur ve bir daha
    // yenilenmezdi.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCashId, selectedCurrencyTypeId, selectedCashAccount])



  const fetchEffectiveFxRate = async (kCode: string, cCode: string) => {
    if (kCode === cCode) return 1
    try {
      const rate = await fetchCrossFxRate(kCode, cCode)
      return Number(formatCrossRate(rate))
    } catch {
      return 1
    }
  }

  /**
   * DÜZENLEMEDE SEÇİLİ CARİNİN ETİKETİ (2026-08-26 bildirimi).
   *
   * `SearchableCariSelect` sunucu aramasıyla çalışıyor: `options` listesi yalnızca SEÇİLİ
   * kaydın etiketini çözmek için kullanılıyor, listelenenler her aramada uçtan geliyor.
   * Düzenle açıldığında kutuya sadece cari KODU veriliyordu; o kod aranmış kayıtlar arasında
   * bulunmadığı için etiket çözülemiyor ve kutu BOŞ görünüyordu — kayıtta cari duruyor olsa
   * bile. Kullanıcı "eski kaydettiğim şekliyle gelmiyor" diye bildirdi.
   *
   * Çözüm: düzenlenen satırın carisi bir seçenek olarak listeye ÖNDEN ekleniyor. Arama
   * sonuçları geldiğinde zaten içinde varsa tekrar eklenmiyor.
   */
  const [editSeedOption, setEditSeedOption] = useState<CariOption | null>(null)

  const customerOptions = useMemo(() => {
    const base = buildCashCariOptions(customers ?? [])
    if (!editSeedOption) return base
    return base.some((o) => o.value === editSeedOption.value) ? base : [editSeedOption, ...base]
  }, [customers, editSeedOption])

  /**
   * Sıfır ATLANMALI: `??` yalnız null/undefined'ı geçer, `0 ?? x` yine 0 verir.
   * Düzenle formunda tutar `tenderAmount ?? currencyAmount ?? amount` zinciriyle
   * dolduruluyordu; `tenderAmount` 0 olan eski kayıtlarda zincir orada durup ekrana
   * "0,00" yazıyordu. İlk POZİTİF değer alınmalı.
   */
  const ilkPozitif = (...degerler: unknown[]) => {
    for (const d of degerler) {
      const n = Number(d ?? 0)
      if (Number.isFinite(n) && n > 0) return n
    }
    return 0
  }

  /**
   * CARI ARAMASI SUNUCUDA (2026-08-22) — Cari Ekstre'deki duzenin AYNISI.
   * Uc parametreleri AYNEN korundu: pasif ve muhtelif disarida.
   */
  const cariRemoteSearch = useCallback(async (query: string, typeKey: string): Promise<CariOption[]> => {
    try {
      const list = await fetchCustomersDropdown({
        includeInactive: false,
        includeMuhtelif: false,
        q: buildCariSearchQuery(query, typeKey),
        limit: CARI_SEARCH_LIMIT
      })
      const mapped = mapCashCustomers(list ?? [])
      setCustomers(mapped)
      return buildCashCariOptions(mapped)
    } catch {
      return []
    }
  }, [])

  const bankOptions = useMemo(() => {
    return (banks ?? []).map((b) => {
      const code = currencyCodeByTypeId(b.currencyTypeId)
      return {
        value: String(b.accountCode),
        label: `${b.accountName || b.accountCode}${code && code !== 'TRY' ? ` (${code})` : ''}`
      }
    }).sort((a, b) => a.label.localeCompare(b.label, 'tr-TR'))
  }, [banks])

  const getEmptyCreateForm = () => ({
    cashAccountId: String(selectedCashId ?? ''),
    date: new Date().toISOString().slice(0, 10),
    direction: '1',
    counterpartyType: '1',
    counterpartyValue: '',
    counterpartyCode: '',
    counterpartyName: '',
    customerAccountCurrencyTypeId: DEFAULT_CUSTOMER_ACCOUNT_ID,
    tenderCurrencyTypeId: String(selectedCurrencyTypeId ?? '1'),
    amount: '0,00',
    currencyTypeId: String(selectedCurrencyTypeId ?? '0'),
    currencyRate: '1',
    currencyRateTouched: false,
    currencyAmount: '0,00',
    description: '',
    currencyRateLoading: false
  })

  const addCreateRow = () => {
    setCreateForms((prev) => {
      const rows = [...(prev ?? [])]
      if (!rows.length) return [getEmptyCreateForm()]
      const last = rows[rows.length - 1] ?? getEmptyCreateForm()
      const newIndex = rows.length
      const newRow = { ...(last ?? {}), currencyRateLoading: false }
      
      setTimeout(() => {
        void fetchAndSetFxRate(newIndex)
      }, 0)

      return [...rows, newRow]
    })
  }

  const removeCreateRow = (index: number) => {
    setCreateForms((prev) => {
      const next = [...(prev ?? [])]
      next.splice(index, 1)
      return next.length ? next : [getEmptyCreateForm()]
    })
  }

  const updateCreateRow = (index: number, patch: any) => {
    setCreateForms((prev) => {
      const next = [...(prev ?? [])]
      if (!next[index]) return prev
      
      const newRow = { ...next[index], ...patch }
      
      const amt = parseFormattedAmount(newRow.amount)
      const rate = parseRate(newRow.currencyRate)
      const tenderCurr = getTenderCurrencyTypeId(newRow)
      const isTenderTry = getIsTryCurrency(tenderCurr)
      const tryAmt = !isTenderTry ? (rate > 0 ? amt * rate : amt) : amt
      newRow.currencyAmount = formatMoney(tryAmt)
      
      next[index] = newRow
      return next
    })
  }

  const fetchAndSetFxRate = async (index: number, patchOverride?: any) => {
    const row = { ...((createForms ?? [])[index] as any), ...(patchOverride ?? {}) }
    if (!row) return

    const cpType = String(row?.counterpartyType ?? '1')
    const tenderCurr = getKasaCurrencyTypeId(row)
    const custAccCurr = getCustomerAccountCurrencyTypeId(row)
    const kasaCurr = getKasaCurrencyTypeId(row)

    const tenderCode = currencyCodeByTypeId(tenderCurr)

    updateCreateRow(index, { currencyRateLoading: true, tenderCurrencyTypeId: String(tenderCurr), ...(patchOverride ?? {}) })
    try {
      // ÇAPRAZ KUR ÇEKİMİ KALDIRILDI: uç kuru "1 döviz = X ₺" olarak yorumluyor.
      const tryRate = tenderCode === 'TRY' ? 1 : await fetchLatestFxRate(tenderCode).catch(() => 1)
      updateCreateRow(index, {
        currencyRate: formatCrossRate(tryRate),
        currencyRateTouched: false,
        tryRate
      })
    } catch {
      updateCreateRow(index, {
        currencyRate: '1',
        currencyRateTouched: false,
        tryRate: 1
      })
    } finally {
      updateCreateRow(index, { currencyRateLoading: false })
    }
  }

  const handleCounterpartyTypeChange = (index: number, val: string) => {
    const t = Number(val) || 0
    let patch: any = { counterpartyType: val }
    if (t === 3) {
      patch.counterpartyValue = 'muhtelif'
      patch.counterpartyCode = ''
      patch.counterpartyName = 'Muhtelif'
    } else {
      patch.counterpartyValue = ''
      patch.counterpartyCode = ''
      patch.counterpartyName = ''
    }
    
    updateCreateRow(index, patch)
    void fetchAndSetFxRate(index, patch)
  }

  const handleCounterpartyValueChange = (index: number, val: string, type: string) => {
    let code = val
    let name = ''
    if (type === '1') {
      const found = customers.find((x) => x.customerCode === val)
      name = found?.name ?? ''
    } else if (type === '2') {
      const found = banks.find((x) => x.accountCode === val)
      name = found?.accountName ?? ''
    }
    
    const patch = {
      counterpartyValue: val,
      counterpartyCode: code,
      counterpartyName: name
    }
    updateCreateRow(index, patch)
    void fetchAndSetFxRate(index, patch)
  }

  const openNewTransaction = () => {
    if (!selectedCashId) {
      setGuardOpen(true)
      return
    }
    setEditId(null)
    setEditSeedOption(null)
    const initialForm = getEmptyCreateForm()
    setCreateForms([initialForm])
    setOpen(true)
    
    // Fetch initial rate
    void fetchAndSetFxRate(0, initialForm)
  }

  const openEdit = (row: Row) => {
    const ref: any = (row as any)?.referenceType
    const isManual = ref === 1 || ref === '1' || String(ref ?? '').toLowerCase() === 'manual'
    if (!isManual) {
      showPopup('info', 'Bilgi', 'Sistem kaydı düzenlenemez')
      return
    }

    const curType = Number((row as any)?.currencyTypeId ?? selectedCurrencyTypeId ?? '0')
    const existingRate = String((row as any)?.currencyRate ?? 1)
    const custAccCur = Number((row as any)?.customerAccountCurrencyTypeId ?? (row as any)?.currencyTypeId ?? 1)
    const tenderCur = Number((row as any)?.tenderCurrencyTypeId ?? (row as any)?.currencyTypeId ?? 1)

    // ENUM ALANLARI METİN GELEBİLİYOR (2026-08-26 bildirimi).
    //
    // Liste ucu enum'ları ADIYLA veriyor ("In"/"Out", "Customer"/"Bank"/"Muhtelif"),
    // yazma tarafı ise SAYI bekliyor. Düzenle formu ham değeri olduğu gibi alıyordu:
    //   • `direction` = "In" → kaydederken `Number("In") || 0` = 0 → "Yön seçimi
    //     zorunludur" hatası. Üstelik ekranda yön SEÇİLİ görünüyordu, çünkü hata
    //     yalnızca kaydetme anında çıkıyor.
    //   • `counterpartyType` = "Customer" → `=== '1'` karşılaştırması tutmuyor, `else`
    //     dalına düşüp hesap alanına "Muhtelif" yazıyordu; cari kaydı muhtelife dönüyordu.
    //
    // Sonuç: hiçbir kasa hareketi düzenlenemiyordu. `referenceType` kontrolü (yukarıda)
    // bu toleransı zaten taşıyordu; bu iki alan atlanmış.
    const dirNo = isOutflowDirection((row as any)?.direction) ? '2' : '1'

    const cpRaw = String((row as any)?.counterpartyType ?? '').trim().toLowerCase()
    const cpNo =
      cpRaw === '2' || cpRaw === 'bank' ? '2'
      : cpRaw === '3' || cpRaw === 'muhtelif' ? '3'
      : '1'

    const cpCode = String(row.counterpartyCode ?? '').trim()
    const cpName = String(row.counterpartyName ?? '').trim()

    setEditSeedOption(
      cpNo === '3' || !cpCode
        ? null
        : {
            value: cpCode,
            label: cpName ? `(${cpCode}) ${cpName}` : cpCode,
            code: cpCode,
            name: cpName
          }
    )

    setEditId(Number(row.id) || null)
    setCreateForms([{
      cashAccountId: String(row.cashAccountId ?? selectedCashId ?? ''),
      date: String(row.date ?? '').slice(0, 10) || new Date().toISOString().slice(0, 10),
      direction: dirNo,
      counterpartyType: cpNo,
      counterpartyValue: cpNo === '3' ? 'muhtelif' : String(row.counterpartyCode ?? ''),
      counterpartyCode: String(row.counterpartyCode ?? ''),
      counterpartyName: String(row.counterpartyName ?? ''),
      customerAccountCurrencyTypeId: String(custAccCur > 0 ? custAccCur : 1),
      tenderCurrencyTypeId: String(tenderCur > 0 ? tenderCur : 1),
      amount: formatMoney(ilkPozitif((row as any)?.tenderAmount, (row as any)?.currencyAmount, row.amount)),
      currencyTypeId: String(curType),
      currencyRate: existingRate,
      currencyRateTouched: Number(existingRate) > 0 && Number(existingRate) !== 1,
      currencyAmount: formatMoney(Number(row.amount ?? 0)),
      description: String(row.description ?? ''),
      currencyRateLoading: false
    }])
    setOpen(true)
  }

  const submit = async () => {
    if (submitting) return
    const forms = (createForms ?? []).filter((f) => f)
    if (!forms.length) {
      showPopup('error', 'Hata', 'Kayıt bulunamadı')
      return
    }

    try {
      setSubmitting(true)
      // Validate all forms first
      const validatedPayloads = forms.map((f, index) => {
        const counterpartyType = Number(f.counterpartyType) || 0
        const direction = Number(f.direction) || 0
        const tenderAmount = parseFormattedAmount(f.amount)
        const currencyTypeId = Number(f.currencyTypeId) || 0
        const currencyRate = parseRate(f.currencyRate) || 1
        const kasaCurr = getKasaCurrencyTypeId(f)
        const tenderCurr = getTenderCurrencyTypeId(f)
        const custAccCurr = getCustomerAccountCurrencyTypeId(f)
        const isTenderTry = getIsTryCurrency(tenderCurr)
        const isConverted = normalizeCurrencyTypeId(tenderCurr) !== normalizeCurrencyTypeId(kasaCurr)

        const amountTry = !isTenderTry ? (currencyRate > 0 ? tenderAmount * currencyRate : tenderAmount) : tenderAmount
        const currencyAmount = getIsTryCurrency(kasaCurr)
          ? amountTry
          : (currencyRate > 0 && !isConverted ? tenderAmount : amountTry)

        const payload = {
          cashAccountId: Number(f.cashAccountId) || 0,
          date: f.date ? new Date(`${String(f.date).trim()}T00:00:00.000Z`).toISOString() : new Date().toISOString(),
          direction,
          counterpartyType,
          counterpartyCode: String(f.counterpartyCode ?? '').trim() || undefined,
          counterpartyName: String(f.counterpartyName ?? '').trim() || undefined,
          // Paranın işleneceği cari hesap: ekrandan seçilen (varsayılan TL). Uç bunu
          // yalnızca HEDEF DAMGASI olarak kullanır, tutarı çevirmez.
          customerAccountCurrencyTypeId: getCustomerAccountCurrencyTypeId(f),
          amount: amountTry,
          currencyTypeId,
          currencyRate,
          currencyAmount,
          tenderCurrencyTypeId: normalizeCurrencyTypeId(tenderCurr),
          tenderRate: currencyRate,
          tenderAmount,
          description: String(f.description ?? '').trim() || null
        }

        const prefix = forms.length > 1 ? `Satır ${index + 1}: ` : ''

        if (payload.cashAccountId <= 0) {
          throw new Error(`${prefix}Kasa seçimi zorunludur`)
        }

        if (payload.direction !== 1 && payload.direction !== 2) {
          throw new Error(`${prefix}Yön seçimi zorunludur`)
        }

        if (payload.counterpartyType !== 1 && payload.counterpartyType !== 2 && payload.counterpartyType !== 3) {
          throw new Error(`${prefix}İşlem tipi zorunludur`)
        }

        if (payload.amount <= 0) {
          throw new Error(`${prefix}Tutar 0 veya daha az olamaz`)
        }

        if (payload.currencyRate <= 0) {
          throw new Error(`${prefix}Döviz kuru 0 olamaz`)
        }

        return payload
      })

      if (editId) {
        const payload = validatedPayloads[0]
        await updateCashAccountTransaction(editId, {
          date: payload.date,
          direction: payload.direction,
          amount: payload.amount,
          currencyTypeId: payload.currencyTypeId,
          currencyRate: payload.currencyRate,
          currencyAmount: payload.currencyAmount,
          tenderCurrencyTypeId: payload.tenderCurrencyTypeId,
          tenderRate: payload.tenderRate,
          tenderAmount: payload.tenderAmount,
          customerAccountCurrencyTypeId: payload.customerAccountCurrencyTypeId,
          counterpartyType: payload.counterpartyType,
          counterpartyCode: String(payload.counterpartyCode ?? ''),
          counterpartyName: String(payload.counterpartyName ?? ''),
          description: payload.description
        })
        showPopup('success', 'Başarılı', 'Kayıt güncellendi')
      } else {
        for (const payload of validatedPayloads) {
          await createCashAccountTransaction(payload)
        }
        showPopup('success', 'Başarılı', `${validatedPayloads.length} işlem başarıyla kaydedildi`)
      }

      setOpen(false)
      setEditId(null)
      await reload(selectedCashId)
      await reloadBalance(selectedCashId)
    } catch (e: any) {
      showPopup('error', 'Hata', String(e?.message ?? 'Kaydedilemedi'))
    } finally {
      setSubmitting(false)
    }
  }

  const [pageIndex, setPageIndex] = useState(0)
  const [pageSize, setPageSize] = useState(20)
  const [columnFiltersState, setColumnFiltersState] = useState<Record<string, any>>({})

  const cashTransactionColumns = useMemo<ColumnDef<Row, any>[]>(() => {
    const code = currencyCodeByTypeId(selectedCurrencyTypeId)
    const symbol = currencySymbolByCode(code)

    return [
      {
        accessorKey: 'date',
        header: 'Tarih',
        meta: { filterType: 'date', filterPlaceholder: 'Tarih...' },
        cell: ({ getValue }) => {
          const s = String(getValue() ?? '').trim()
          if (!s) return '-'
          if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
            const [y, m, d] = s.slice(0, 10).split('-')
            return `${d}.${m}.${y}`
          }
          return s.slice(0, 10)
        }
      },
      {
        accessorKey: 'cashAccountName',
        header: 'Kasa Adı',
        meta: { filterType: 'text', filterPlaceholder: 'Kasa Adı...' }
      },
      {
        accessorKey: 'dovizTuru',
        header: 'Döviz',
        meta: { filterType: 'text', filterPlaceholder: 'Döviz...' }
      },
      {
        accessorKey: 'counterpartyName',
        header: 'İsim',
        meta: { filterType: 'text', filterPlaceholder: 'İsim...' },
        // Devir satiri gercek bir hareket degil; kalin yazi onu digerlerinden ayirir.
        cell: ({ row, getValue }) => {
          const v = String(getValue() ?? '')
          return (row.original as any)?.isOpeningBalance ? <span className="font-bold text-gray-700">{v}</span> : v
        }
      },
      {
        accessorKey: 'description',
        header: 'Açıklama',
        meta: { filterType: 'text', filterPlaceholder: 'Açıklama...' }
      },
      {
        accessorKey: 'giren',
        header: `Giren (${symbol})`,
        meta: { filterType: 'number', showTotal: true },
        cell: ({ getValue }) => {
          const val = Number(getValue() ?? 0)
          return val > 0 ? (
            <div className="text-right font-semibold text-emerald-600">
              {formatMoney(val)} {symbol}
            </div>
          ) : '-'
        }
      },
      {
        accessorKey: 'cikan',
        header: `Çıkan (${symbol})`,
        meta: { filterType: 'number', showTotal: true },
        cell: ({ getValue }) => {
          const val = Number(getValue() ?? 0)
          return val > 0 ? (
            <div className="text-right font-semibold text-red-600">
              {formatMoney(val)} {symbol}
            </div>
          ) : '-'
        }
      },
      // YÜRÜYEN BAKİYE — her satır o işlemden SONRAKİ bakiye (bkz. BankPage, 2026-10-03).
      {
        id: 'runningBalance',
        accessorFn: (row) => Number((row as any).runningBalance ?? 0),
        header: `Bakiye (${symbol})`,
        meta: { filterType: 'number' },
        cell: ({ getValue }) => {
          const val = Number(getValue() ?? 0)
          return (
            <div className={`text-right font-bold ${val < 0 ? 'text-red-600' : 'text-gray-800'}`}>
              {formatMoney(val)} {symbol}
            </div>
          )
        }
      },
      {
        accessorKey: 'createUser',
        header: 'İşlemi yapan',
        meta: { filterType: 'text', filterPlaceholder: 'İşlemi yapan...' }
      }
    ]
  }, [selectedCurrencyTypeId])

  const getRowActions = (row: Row): DataTableRowAction<Row>[] => {
    // Devir satiri gercek bir hareket degil: duzenlenecek ya da silinecek kaydi yok.
    if (row.isOpeningBalance) return []

    const actions: DataTableRowAction<Row>[] = []
    const ref: any = (row as any)?.referenceType
    const isManual = ref === 1 || ref === '1' || String(ref ?? '').toLowerCase() === 'manual'
    const isInvoice = ref === 2 || ref === '2' || String(ref ?? '').toLowerCase() === 'invoice'

    actions.push({
      label: 'Müşteri Bilgi',
      onClick: (r) => openCustomerModal(r)
    })
    actions.push({
      label: 'Fatura Bilgi',
      onClick: (r) => openInvoiceModal(r)
    })

    if (isManual) {
      actions.push({
        label: 'Düzenle',
        onClick: (r) => openEdit(r)
      })
    }

    const canDeleteAll = isSuperAdmin || allowedKeys?.has('deleteRule/tumIslemleriSilebilsin') || allowedKeys?.has('deleteRule/deleteRule/tumIslemleriSilebilsin')
    const currentUsername = (localStorage.getItem('userName') || '').toLowerCase()
    const recordUser = String(row.createUser || (row as any).islemYapan || '').toLowerCase()
    const isOwner = Boolean(currentUsername) && currentUsername === recordUser
    const allowedDelete = canDeleteAll || isOwner

    actions.push({
      label: 'Sil',
      variant: 'danger',
      disabled: !allowedDelete,
      disabledReason: !allowedDelete ? 'Bu işlemi sadece işlemi yapan kullanıcı silebilir' : undefined,
      onClick: (r) => {
        if (!allowedDelete) return
        askDelete(r)
      }
    })

    return actions
  }

  return (
    <div className="p-4">
      <NotificationPopup isOpen={popupOpen} variant={popupVariant} title={popupTitle} message={popupMessage} onClose={() => setPopupOpen(false)} />

      <Modal
        isOpen={customerModalOpen}
        onClose={() => {
          setCustomerModalOpen(false)
          setCustomerModalError(null)
          setCustomerModalData(null)
        }}
        title="Müşteri Bilgileri"
      >
        {customerModalLoading ? (
          <div className="p-2 text-sm text-gray-500">Yükleniyor...</div>
        ) : customerModalError ? (
          <div className="p-2 text-sm text-red-600 whitespace-pre-line">{customerModalError}</div>
        ) : customerModalData ? (
          <div className="space-y-3">
            <div className="text-sm font-extrabold text-gray-900">[{customerModalData.customerCode}] {customerModalData.name}</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
              <div className="bg-gray-50 border border-gray-200 rounded p-3">
                <div className="text-[11px] font-semibold text-gray-500">Cari Tipi</div>
                <div className="mt-1 font-semibold text-gray-900">{String(customerModalData.customerType ?? '') || '-'}</div>
              </div>
              <div className="bg-gray-50 border border-gray-200 rounded p-3">
                <div className="text-[11px] font-semibold text-gray-500">Fatura Tipi</div>
                <div className="mt-1 font-semibold text-gray-900">{String(customerModalData.invoiceType ?? '') || '-'}</div>
              </div>
              <div className="bg-gray-50 border border-gray-200 rounded p-3">
                <div className="text-[11px] font-semibold text-gray-500">Telefon</div>
                <div className="mt-1 font-semibold text-gray-900">{String(customerModalData.phone ?? '') || '-'}</div>
              </div>
              <div className="bg-gray-50 border border-gray-200 rounded p-3">
                <div className="text-[11px] font-semibold text-gray-500">E-posta</div>
                <div className="mt-1 font-semibold text-gray-900">{String(customerModalData.email ?? '') || '-'}</div>
              </div>
              <div className="bg-gray-50 border border-gray-200 rounded p-3 md:col-span-2">
                <div className="text-[11px] font-semibold text-gray-500">Adres</div>
                <div className="mt-1 font-semibold text-gray-900 whitespace-pre-line">
                  {String(customerModalData.address ?? '') || '-'}
                  {(customerModalData.district || customerModalData.city) ? `\n${String(customerModalData.district ?? '')} ${String(customerModalData.city ?? '')}`.trim() : ''}
                </div>
              </div>
              <div className="bg-gray-50 border border-gray-200 rounded p-3">
                <div className="text-[11px] font-semibold text-gray-500">Aktif</div>
                <div className="mt-1 font-semibold text-gray-900">{customerModalData.isActive ? 'Evet' : 'Hayır'}</div>
              </div>
              <div className="bg-gray-50 border border-gray-200 rounded p-3">
                <div className="text-[11px] font-semibold text-gray-500">İskonto Oranı</div>
                <div className="mt-1 font-semibold text-gray-900">{Number.isFinite(Number(customerModalData.discountRate)) ? `%${Number(customerModalData.discountRate)}` : '-'}</div>
              </div>
              <div className="bg-gray-50 border border-gray-200 rounded p-3">
                <div className="text-[11px] font-semibold text-gray-500">Vergi Dairesi</div>
                <div className="mt-1 font-semibold text-gray-900">{String(customerModalData.taxOffice ?? '') || '-'}</div>
              </div>
              <div className="bg-gray-50 border border-gray-200 rounded p-3">
                <div className="text-[11px] font-semibold text-gray-500">Vergi No</div>
                <div className="mt-1 font-semibold text-gray-900">{String(customerModalData.taxNumber ?? '') || '-'}</div>
              </div>
              <div className="bg-gray-50 border border-gray-200 rounded p-3">
                <div className="text-[11px] font-semibold text-gray-500">Plasiyer</div>
                <div className="mt-1 font-semibold text-gray-900">{String(customerModalData.salesmanCode ?? '') || '-'}</div>
              </div>
              <div className="bg-gray-50 border border-gray-200 rounded p-3">
                <div className="text-[11px] font-semibold text-gray-500">Bağlı Cari</div>
                <div className="mt-1 font-semibold text-gray-900">{String(customerModalData.parentCustomerCode ?? '') || '-'}</div>
              </div>
            </div>
          </div>
        ) : (
          <div className="p-2 text-sm text-gray-500">Kayıt yok.</div>
        )}
      </Modal>

      <Modal
        isOpen={invoiceModalOpen}
        onClose={() => {
          setInvoiceModalOpen(false)
          setInvoiceModalError(null)
          setInvoiceModalHeader(null)
          setInvoiceModalLines([])
        }}
        title="Fatura Bilgileri"
      >
        {invoiceModalLoading ? (
          <div className="p-2 text-sm text-gray-500">Yükleniyor...</div>
        ) : invoiceModalError ? (
          <div className="p-2 text-sm text-red-600 whitespace-pre-line">{invoiceModalError}</div>
        ) : invoiceModalHeader ? (
          <div className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
              <div className="bg-gray-50 border border-gray-200 rounded p-3">
                <div className="text-[11px] font-semibold text-gray-500">Fatura No</div>
                <div className="mt-1 font-extrabold text-gray-900">{invoiceModalHeader.faturaNo || '-'}</div>
              </div>
              <div className="bg-gray-50 border border-gray-200 rounded p-3">
                <div className="text-[11px] font-semibold text-gray-500">Cari Kodu</div>
                <div className="mt-1 font-semibold text-gray-900">{invoiceModalHeader.cariKodu || '-'}</div>
              </div>
              <div className="bg-gray-50 border border-gray-200 rounded p-3">
                <div className="text-[11px] font-semibold text-gray-500">Açıklama</div>
                <div className="mt-1 font-semibold text-gray-900">{invoiceModalHeader.faturaAcik || '-'}</div>
              </div>
            </div>

            <div className="border border-gray-200 rounded overflow-hidden">
              <div className="grid grid-cols-12 bg-gray-50 text-[11px] font-semibold text-gray-600 px-3 py-2">
                <div className="col-span-5">Ürün</div>
                <div className="col-span-3">Açıklama</div>
                <div className="col-span-1 text-right">Adet</div>
                <div className="col-span-1 text-right">Fiyat</div>
                <div className="col-span-2 text-right">Toplam</div>
              </div>
              <div className="divide-y divide-gray-100">
                {(invoiceModalLines ?? []).slice(0, 50).map((ln) => (
                  <div key={String(ln.id)} className="grid grid-cols-12 px-3 py-2 text-[11px] bg-white">
                    <div className="col-span-5 font-semibold text-gray-900 truncate" title={`${ln.stockCode} ${ln.stockName}`.trim()}>
                      {`[${ln.stockCode}] ${ln.stockName}`.trim()}
                    </div>
                    <div className="col-span-3 text-gray-700 truncate" title={String(ln.description ?? '')}>{String(ln.description ?? '')}</div>
                    <div className="col-span-1 text-right text-gray-800 font-semibold">{Number(ln.quantity ?? 0)}</div>
                    <div className="col-span-1 text-right text-gray-800 font-semibold">{formatMoney(Number(ln.unitPrice ?? 0))}</div>
                    <div className="col-span-2 text-right text-gray-900 font-extrabold">{formatMoney(Number(ln.total ?? 0))}</div>
                  </div>
                ))}
                {invoiceModalLines.length > 50 ? <div className="px-3 py-2 text-[11px] text-gray-500">İlk 50 satır gösteriliyor.</div> : null}
              </div>
            </div>
          </div>
        ) : (
          <div className="p-2 text-sm text-gray-500">Kayıt yok.</div>
        )}
      </Modal>

      <Modal
        isOpen={deleteConfirmOpen}
        onClose={() => {
          setDeleteConfirmOpen(false)
          setDeleteRow(null)
        }}
        title="Silme Onayı"
        footer={
          <>
            <button
              type="button"
              className="h-[34px] inline-flex items-center gap-1.5 px-4 text-xs font-semibold rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 transition"
              onClick={() => {
                setDeleteConfirmOpen(false)
                setDeleteRow(null)
              }}
            >
              Vazgeç
            </button>
            <button
              type="button"
              className="h-[34px] inline-flex items-center gap-1.5 px-4 text-xs font-semibold rounded-lg bg-red-600 hover:bg-red-700 text-white shadow-sm transition"
              onClick={() => void confirmDelete()}
            >
              Sil
            </button>
          </>
        }
      >
        <div className="p-2 text-sm text-gray-700">
          Bu işlemi silmek istediğinize emin misiniz? Bu işlem geri alınamaz.
        </div>
      </Modal>

      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-gray-900 tracking-tight">Kasa Giriş/Çıkış</h1>
          <p className="text-xs text-gray-400 mt-0.5">Kasa İşlemleri / Giriş & Çıkış</p>
        </div>
        <button type="button" onClick={openNewTransaction} className="h-[34px] inline-flex items-center gap-1.5 px-4 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Yeni Giriş/Çıkış
        </button>
      </div>

      <div className="bg-white border border-gray-100 rounded-xl shadow-sm p-4 mb-4">
        <div className="flex items-center gap-3">
          {/*
            ONCE DOVIZ, SONRA KASA. Doviz secimi kasa listesini suzuyor (bkz. `cashOptions`),
            bu yuzden solda duruyor: daraltan kutu daraltilanin solunda olmali.
          */}
          <select
            className="h-[34px] w-36 px-3 text-xs border border-gray-200 rounded-lg bg-white focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition"
            value={selectedCurrencyTypeIdState}
            onChange={(e) => handleCurrencyFilterChange(e.target.value)}
          >
            {currencyOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>

          <div className="w-72">
            <FormSearchableSelect
              value={cashAccountId}
              onChange={(e) => setCashAccountId(e.target.value)}
              options={cashOptions}
              placeholder={cashOptions.length ? 'Kasa Seçiniz...' : 'Bu dövizde kasa yok'}
            />
          </div>

          {selectedCashId ? (
            <div className="text-xs text-gray-700 flex items-center gap-2">
              <span className="text-gray-500">Bakiye:</span>
              {balanceLoading ? (
                <span className="font-semibold">Yükleniyor...</span>
              ) : multiCurrencyBalances.length > 0 ? (
                <div className="flex items-center gap-2">
                  {(() => {
                    const bal = [...multiCurrencyBalances].find((x) => Number(x.currencyTypeId) === Number(selectedCurrencyTypeId))
                    if (!bal) return null
                    const code = String(bal.currencyCode ?? '').toUpperCase()
                    const symbol = code === 'TRY' ? '₺' : code === 'USD' ? '$' : code === 'EUR' ? '€' : code === 'GBP' ? '£' : ''
                    return (
                      <span key={bal.currencyTypeId} className="font-semibold bg-gray-100 px-2 py-0.5 rounded inline-flex items-center gap-1">
                        <span className="text-gray-600">{symbol || code}</span>
                        <span>{formatMoney(bal.balance)}</span>
                      </span>
                    )
                  })()}
                </div>
              ) : (
                <span className="font-semibold">{formatMoney(Number(balance ?? 0))} TL</span>
              )}
            </div>
          ) : null}
        </div>
      </div>

      <AppDataTable
        // Seçili kasayla yenilenir: kimliksiz çağrı bütün kasaları karışık (500 kayıt) getiriyor,
        // yürüyen bakiye de anlamsızlaşıyordu (2026-10-03).
        onRefresh={() => void reload(selectedCashId)}
        data={items}
        columns={cashTransactionColumns}
        rowId={(row) => ((row as any)?.isOpeningBalance ? 'devir-bakiyesi' : String(row.id))}
        rowActions={getRowActions}
        states={{ loading }}
        filtering={{
          columnFilters: columnFiltersState,
          onColumnFilterChange: (colId, val) => setColumnFiltersState((p) => ({ ...p, [colId]: val }))
        }}
        pagination={{
          pageIndex,
          pageSize,
          totalCount: items.length,
          pageCount: Math.ceil(items.length / pageSize),
          onPageChange: setPageIndex,
          onPageSizeChange: setPageSize
        }}
      />

      <Modal
        isOpen={open}
        onClose={() => setOpen(false)}
        title={editId ? 'Kasa Giriş/Çıkış - Düzenle' : 'Kasa Giriş/Çıkış'}
        footer={
          <>
            {!editId && (
              <button
                type="button"
                disabled={submitting}
                className="h-[34px] px-4 text-xs font-semibold rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 transition disabled:opacity-50"
                onClick={addCreateRow}
              >
                Satır Ekle
              </button>
            )}
            <button
              type="button"
              disabled={submitting}
              className="h-[34px] px-4 text-xs font-semibold rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 transition disabled:opacity-50"
              onClick={() => setOpen(false)}
            >
              Vazgeç
            </button>
            <button
              type="button"
              disabled={submitting}
              className="h-[34px] inline-flex items-center gap-1.5 px-4 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition disabled:opacity-50"
              onClick={() => void submit()}
            >
              {submitting ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Kaydediliyor...
                </>
              ) : (
                <>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
                  Kaydet
                </>
              )}
            </button>
          </>
        }
      >
        <div className="space-y-6">
          {(createForms ?? []).map((form, idx) => {
            const kasaCurr = getKasaCurrencyTypeId(form)
            const cpCurr = getTenderCurrencyTypeId(form)
            const isKasaTry = getIsTryCurrency(kasaCurr)
            const isCounterpartyTry = getIsTryCurrency(cpCurr)
            const labelRate = getRateLabel(kasaCurr, cpCurr)
            const summary = getSummaryInfo(form)

            return (
              <div key={idx} className="border border-gray-100 rounded-xl p-4 bg-white shadow-sm relative">
                <div className="flex items-center justify-between mb-4 pb-2 border-b border-gray-100">
                  <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">
                    Kayıt #{idx + 1}
                  </span>
                  {!editId && createForms.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeCreateRow(idx)}
                      className="text-[11px] font-semibold text-red-600 hover:text-red-700 bg-red-50 hover:bg-red-100 px-2.5 py-1 rounded transition-colors"
                    >
                      Kayıt Sil
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormSelect
                    label="İşlem Tipi"
                    requiredMark
                    value={form.counterpartyType}
                    onChange={(e) => handleCounterpartyTypeChange(idx, e.target.value)}
                    options={[
                      { value: '1', label: 'Cari' },
                      { value: '2', label: 'Banka' },
                      { value: '3', label: 'Muhtelif' }
                    ]}
                  />

                  {String(form.counterpartyType) === '1' ? (
                    <div className="space-y-2">
                      <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide">
                        Cari Seçimi <span className="text-red-500">*</span>
                      </label>
                      {/*
                        Zengin cari secici (telefon, kod rozeti, tur pastilleri) + SUNUCU
                        ARAMASI. Eski `FormSearchableSelect` butun listeyi tarayicida
                        suzuyordu ve telefonla arama yoktu.
                      */}
                      <SearchableCariSelect
                        value={String(form.counterpartyValue ?? '')}
                        onChange={(v) => handleCounterpartyValueChange(idx, v, '1')}
                        options={customerOptions}
                        remoteSearch={cariRemoteSearch}
                        remoteLimit={CARI_SEARCH_LIMIT}
                        placeholder="Cari Ara (Kod, Isim, Telefon)..."
                      />
                    </div>
                  ) : String(form.counterpartyType) === '2' ? (
                    <FormSearchableSelect
                      label="Banka Hesabı"
                      requiredMark
                      value={form.counterpartyValue}
                      onChange={(e) => handleCounterpartyValueChange(idx, e.target.value, '2')}
                      options={bankOptions}
                      placeholder="Banka Hesabı Ara..."
                    />
                  ) : (
                    <FormInput label="Hesap" value="Muhtelif" disabled onChange={() => { }} />
                  )}

                  {/* CARİ HESABI SEÇİCİSİ.
                      Tutar, seçilen hesabın para birimine TL ÇAPASINDAN çevrilir: gelen paranın
                      TL karşılığı bulunur, sonra hedef hesabın güncel kuruyla o hesabın parasına
                      dönüştürülür. Çapraz kur KULLANILMAZ (£→€ çaprazı bir dönem 1.500 £'yi
                      31,66 €'ya düşürmüştü); iki bacak da "1 döviz = X ₺" yönündedir. */}
                  {String(form.counterpartyType) === '1' && (
                    <div className="md:col-span-2 bg-slate-50 border border-slate-200 rounded-xl p-3">
                      <div className="flex items-center justify-between mb-2 gap-3">
                        <label className="block text-xs font-bold text-slate-800">
                          Cari Hesabı (Paranın İşleneceği Hesap) <span className="text-red-500">*</span>
                        </label>
                        <span className="text-[11px] text-slate-500 font-medium">
                          Varsayılan TL hesabı — kasa dövizinden bağımsız
                        </span>
                      </div>
                      <div className="grid grid-cols-4 gap-2">
                        {CUSTOMER_ACCOUNT_OPTIONS.map((btn) => {
                          const isSel = String(form.customerAccountCurrencyTypeId ?? '1') === btn.id
                          return (
                            <button
                              key={btn.id}
                              type="button"
                              onClick={() => updateCreateRow(idx, { customerAccountCurrencyTypeId: btn.id })}
                              className={`py-2 px-3 text-xs font-bold rounded-lg border transition text-center ${
                                isSel ? `${btn.active} shadow-sm` : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100'
                              }`}
                            >
                              {btn.label}
                            </button>
                          )
                        })}
                      </div>
                      <p className="text-[11px] text-slate-500 mt-2">
                        Ödeme {currencyCodeByTypeId(getTenderCurrencyTypeId(form))} olarak alınır; ekstreye
                        seçilen hesabın para biriminde, TL karşılığı üzerinden güncel kurla işlenir.
                      </p>
                    </div>
                  )}

                  <FormSearchableSelect
                    label="Kasa (Paranın Gireceği/Çıkacağı Kasa)"
                    requiredMark
                    value={form.cashAccountId}
                    onChange={(e) => {
                      const v = e.target.value
                      const kCur = String(getKasaCurrencyTypeId({ ...form, cashAccountId: v }))
                      updateCreateRow(idx, { cashAccountId: v, tenderCurrencyTypeId: kCur })
                      void fetchAndSetFxRate(idx, { cashAccountId: v, tenderCurrencyTypeId: kCur })
                    }}
                    options={cashOptions}
                    placeholder="Kasa Seçiniz..."
                  />

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-xs font-bold text-slate-700">
                        Ödeme Dövizi (Müşterinin Verdiği/Aldığı Para) <span className="text-red-500">*</span>
                      </label>
                      <span className="text-[10px] text-slate-500 font-semibold bg-slate-100 px-1.5 py-0.5 rounded flex items-center gap-1">
                        <span>🔒</span> Kasaya göre sabittir
                      </span>
                    </div>
                    <div className="grid grid-cols-4 gap-1.5">
                      {[
                        { id: '1', label: 'TL', active: 'bg-blue-600 text-white border-blue-600' },
                        { id: '3', label: 'USD', active: 'bg-emerald-600 text-white border-emerald-600' },
                        { id: '2', label: 'EUR', active: 'bg-amber-600 text-white border-amber-600' },
                        { id: '4', label: 'GBP', active: 'bg-purple-600 text-white border-purple-600' }
                      ].map((btn) => {
                        const isSel = String(getKasaCurrencyTypeId(form)) === btn.id
                        return (
                          <button
                            key={btn.id}
                            type="button"
                            disabled
                            title="Ödeme dövizi seçilen kasaya göre sabittir"
                            className={`py-1.5 px-2 text-xs font-bold rounded-lg border text-center cursor-not-allowed ${
                              isSel ? `${btn.active} shadow-sm opacity-100 ring-2 ring-offset-1 ring-blue-400` : 'bg-slate-50 border-slate-200 text-slate-400 opacity-60'
                            }`}
                          >
                            {btn.label}
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  <FormSelect
                    label="Yön"
                    requiredMark
                    value={form.direction}
                    onChange={(e) => updateCreateRow(idx, { direction: e.target.value })}
                    options={[
                      { value: '1', label: 'Giriş (Tahsilat)' },
                      { value: '2', label: 'Çıkış (Ödeme)' }
                    ]}
                  />

                  <FormInput
                    label="Tarih"
                    type="date"
                    requiredMark
                    value={form.date}
                    onChange={(e) => updateCreateRow(idx, { date: e.target.value })}
                  />

                  <FormInput
                    label={`Ödeme Tutarı (${currencySymbolByCode(currencyCodeByTypeId(getTenderCurrencyTypeId(form)))})`}
                    requiredMark
                    value={form.amount}
                    onChange={(e) => updateCreateRow(idx, { amount: handleCurrencyInputChange(e.target.value) })}
                    onBlur={() => {
                      const num = parseFormattedAmount(form.amount)
                      updateCreateRow(idx, { amount: formatMoney(num) })
                    }}
                  />

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-xs font-bold text-slate-700">
                        {getRateLabel(getCustomerAccountCurrencyTypeId(form), getTenderCurrencyTypeId(form))} <span className="text-red-500">*</span>
                      </label>
                      <button
                        type="button"
                        onClick={() => void fetchAndSetFxRate(idx)}
                        disabled={form.currencyRateLoading}
                        title="Güncel Çapraz Kuru Çek"
                        className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-600 hover:text-blue-800 disabled:opacity-50 transition-colors bg-blue-50 hover:bg-blue-100 px-2 py-0.5 rounded border border-blue-200"
                      >
                        <span className={`inline-block text-xs ${form.currencyRateLoading ? 'animate-spin' : ''}`}>🔄</span>
                        {form.currencyRateLoading ? 'Çekiliyor...' : 'Kuru Yenile'}
                      </button>
                    </div>
                    <FormInput
                      label=""
                      requiredMark={false}
                      value={form.currencyRate}
                      onChange={(e) => {
                        updateCreateRow(idx, {
                          currencyRateTouched: true,
                          currencyRate: e.target.value
                        })
                      }}
                      onBlur={() => {
                        const num = parseRate(form.currencyRate)
                        if (num > 0) updateCreateRow(idx, { currencyRate: String(num) })
                      }}
                    />
                  </div>

                  {/* CANLI ÖNİZLEME KARTI (İŞLEM ÖZETİ) */}
                  <div className="md:col-span-2 p-4 bg-gradient-to-br from-slate-50 to-blue-50/50 border border-blue-200/80 rounded-xl text-xs space-y-2.5 text-slate-800 shadow-sm">
                    <div className="font-bold flex items-center justify-between border-b border-blue-200/60 pb-2 text-slate-900">
                      <span className="flex items-center gap-1.5 text-xs font-black">
                        <span>ℹ️</span> İşlem & Cari Hesap Önizlemesi
                      </span>
                      <span className="px-2.5 py-0.5 rounded text-[11px] font-bold bg-blue-100 text-blue-800">
                        {form.direction === '1' ? 'Tahsilat (Kasaya Giriş)' : 'Ödeme (Kasadan Çıkış)'}
                      </span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                      <div className="flex justify-between items-center py-0.5">
                        <span className="text-slate-500">Ödeme Tutarı & Dövizi:</span>
                        <span className="font-bold text-slate-900">{formatMoney(summary.tenderAmt)} {summary.tenderCode}</span>
                      </div>
                      <div className="flex justify-between items-center py-0.5">
                        <span className="text-slate-500">Kasa:</span>
                        <span className="font-bold text-slate-900">{summary.kasaCode} Kasası</span>
                      </div>
                      <div className="flex justify-between items-center py-0.5">
                        <span className="text-slate-500">Cari Hesabı:</span>
                        <span className="font-bold text-blue-700">{form.counterpartyName || form.counterpartyCode || 'Cari'} · {summary.tenderCode} olarak işlenir</span>
                      </div>
                      <div className="flex justify-between items-center py-0.5">
                        <span className="text-slate-500">Kur:</span>
                        <span className="font-bold text-slate-800">1 {summary.tenderCode} = {form.currencyRate} ₺</span>
                      </div>
                    </div>

                    <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-2.5 flex items-center justify-between text-emerald-900 font-bold">
                      <div className="flex items-center gap-1.5">
                        <span>✨</span>
                        <span>Cari Hesaba İşlenecek Tutar:</span>
                      </div>
                      <span className="text-sm font-black text-emerald-700">{formatMoney(summary.cariAmt)} {summary.tenderCode}</span>
                    </div>

                    <div className="flex justify-between items-center text-slate-500 text-[11px] pt-1 border-t border-slate-200/60">
                      <span>Bilgi Amaçlı Yerel Para (TRY) Karşılığı:</span>
                      <span className="font-semibold text-slate-700">{formatMoney(summary.tryAmt)} TRY</span>
                    </div>
                  </div>

                  <div className="md:col-span-2">
                    <FormInput label="Açıklama" value={form.description} onChange={(e) => updateCreateRow(idx, { description: e.target.value })} />
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </Modal>

      <Modal
        isOpen={guardOpen}
        onClose={() => setGuardOpen(false)}
        title="Uyarı"
        footer={
          <>
            <button type="button" className="h-[34px] inline-flex items-center gap-1.5 px-4 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition" onClick={() => setGuardOpen(false)}>
              Tamam
            </button>
          </>
        }
      >
        <div className="text-sm text-gray-700">Lütfen Kasa Seçiniz</div>
      </Modal>
    </div>
  )
}

function KasalarArasiTransferView() {
  const { isSuperAdmin, allowedKeys } = useOutletContext<LayoutContext>()
  type Row = CashAccountTransferDto & { actions: string }

  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<Row[]>([])
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const [guardOpen, setGuardOpen] = useState(false)

  const openNewTransfer = () => {
    if (!balanceCashId) {
      setGuardOpen(true)
      return
    }
    setFromId(balanceCashId)
    setToId('')
    setDate(todayYmd())
    setAmount('0,00')
    setConvertedAmount('0,00')
    setDescription('')
    setOpen(true)
  }

  const [balanceLoading, setBalanceLoading] = useState(false)
  const [selectedBalance, setSelectedBalance] = useState<number | null>(null)
  const [cashAccounts, setCashAccounts] = useState<CashAccountDto[]>([])
  const [balanceCashId, setBalanceCashId] = useState('')

  const [fromId, setFromId] = useState('')
  const [toId, setToId] = useState('')
  const [date, setDate] = useState('')
  const [amount, setAmount] = useState('0,00')
  const [description, setDescription] = useState('')

  const [transferRate, setTransferRate] = useState('1')
  const [transferRateTouched, setTransferRateTouched] = useState(false)
  const [rateLoading, setRateLoading] = useState(false)

  const [popupOpen, setPopupOpen] = useState(false)
  const [popupVariant, setPopupVariant] = useState<'success' | 'error' | 'info'>('info')
  const [popupTitle, setPopupTitle] = useState('')
  const [popupMessage, setPopupMessage] = useState('')

  const showPopup = (variant: 'success' | 'error' | 'info', title: string, message: string) => {
    setPopupVariant(variant)
    setPopupTitle(title)
    setPopupMessage(message)
    setPopupOpen(true)
  }

  const cashOptions = useMemo(() => {
    return (cashAccounts ?? [])
      .map((x) => {
        const code = currencyCodeByTypeId(Number((x as any)?.currencyTypeId ?? 0))
        return {
          value: String(x.id),
          label: `${cleanCashName(x.name, x.code)} (${code})`
        }
      })
      .sort((a, b) => a.label.localeCompare(b.label, 'tr-TR'))
  }, [cashAccounts])

  const cashLabelById = useMemo(() => {
    const m = new Map<number, string>()
    for (const c of cashAccounts ?? []) {
      const code = currencyCodeByTypeId(Number((c as any)?.currencyTypeId ?? 0))
      m.set(c.id, `${cleanCashName(c.name, c.code)} (${code})`)
    }
    return m
  }, [cashAccounts])

  const cashById = useMemo(() => {
    const m = new Map<number, CashAccountDto>()
    for (const c of cashAccounts ?? []) {
      m.set(c.id, c)
    }
    return m
  }, [cashAccounts])

  const selectedFrom = useMemo(() => cashById.get(Number(fromId) || 0) ?? null, [cashById, fromId])
  const selectedTo = useMemo(() => cashById.get(Number(toId) || 0) ?? null, [cashById, toId])

  const selectedBalanceCash = useMemo(() => cashById.get(Number(balanceCashId) || 0) ?? null, [balanceCashId, cashById])
  const selectedBalanceCurrencyCode = useMemo(
    () => currencyCodeByTypeId(Number((selectedBalanceCash as any)?.currencyTypeId ?? 0)),
    [selectedBalanceCash]
  )

  const selectedCashAccountIdNum = useMemo(() => Number(balanceCashId) || 0, [balanceCashId])
  const selectedCashCurrencyCode = selectedBalanceCurrencyCode

  const sourceCurrencyTypeId = Number(selectedFrom?.currencyTypeId ?? 1)
  const targetCurrencyTypeId = Number(selectedTo?.currencyTypeId ?? 1)
  const sourceCurrencyCode = useMemo(() => currencyCodeByTypeId(sourceCurrencyTypeId), [sourceCurrencyTypeId])
  const targetCurrencyCode = useMemo(() => currencyCodeByTypeId(targetCurrencyTypeId), [targetCurrencyTypeId])

  const rateLabel = useMemo(() => {
    if (sourceCurrencyCode !== 'TRY' && targetCurrencyCode !== 'TRY' && sourceCurrencyCode !== targetCurrencyCode) {
      return `ÇAPRAZ KUR (${targetCurrencyCode}/${sourceCurrencyCode})`
    }
    const fxCode = sourceCurrencyCode !== 'TRY' ? sourceCurrencyCode : targetCurrencyCode
    return `DÖVİZ KURU (${fxCode}/TRY)`
  }, [sourceCurrencyCode, targetCurrencyCode])

  const fetchEffectiveFxRateForTransfer = async (sCode: string, tCode: string) => {
    if (sCode === tCode) return { rate: 1, sourceTryRate: 1, targetTryRate: 1 }
    try {
      const [rate, rSource, rTarget] = await Promise.all([
        fetchCrossFxRate(sCode, tCode),
        sCode === 'TRY' ? Promise.resolve(1) : fetchLatestFxRate(sCode).catch(() => 1),
        tCode === 'TRY' ? Promise.resolve(1) : fetchLatestFxRate(tCode).catch(() => 1)
      ])
      return { rate: Number(formatCrossRate(rate)), sourceTryRate: rSource, targetTryRate: rTarget }
    } catch {
      return { rate: 1, sourceTryRate: 1, targetTryRate: 1 }
    }
  }

  const [convertedAmount, setConvertedAmount] = useState('0,00')

  const calculateConverted = (sAmtStr: string, rStr: string) => {
    const amt = parseFormattedAmount(sAmtStr)
    const rate = parseFormattedAmount(rStr) || 1
    if (sourceCurrencyCode === 'TRY' && targetCurrencyCode !== 'TRY') {
      return rate > 0 ? Math.round((amt / rate) * 100) / 100 : amt
    } else if (sourceCurrencyCode !== 'TRY' && targetCurrencyCode === 'TRY') {
      return rate > 0 ? amt * rate : amt
    } else if (sourceCurrencyCode !== 'TRY' && targetCurrencyCode !== 'TRY' && sourceCurrencyCode !== targetCurrencyCode) {
      return rate > 0 ? Math.round((amt / rate) * 100) / 100 : amt
    }
    return amt
  }

  const handleAmountChange = (val: string) => {
    const formatted = handleCurrencyInputChange(val)
    setAmount(formatted)
    const conv = calculateConverted(formatted, transferRate)
    setConvertedAmount(formatMoney(conv))
  }

  const handleRateChange = (rateVal: string) => {
    setTransferRateTouched(true)
    setTransferRate(rateVal)
    const conv = calculateConverted(amount, rateVal)
    setConvertedAmount(formatMoney(conv))
  }

  const handleConvertedAmountChange = (val: string) => {
    const formatted = handleCurrencyInputChange(val)
    setConvertedAmount(formatted)
    const targetAmt = parseFormattedAmount(formatted)
    const sourceAmt = parseFormattedAmount(amount)
    if (sourceAmt > 0 && targetAmt > 0) {
      if (sourceCurrencyCode === 'TRY' && targetCurrencyCode !== 'TRY') {
        const calcRate = Math.round((sourceAmt / targetAmt) * 10000) / 10000
        setTransferRate(String(calcRate))
        setTransferRateTouched(true)
      } else if (sourceCurrencyCode !== 'TRY' && targetCurrencyCode === 'TRY') {
        const calcRate = Math.round((targetAmt / sourceAmt) * 10000) / 10000
        setTransferRate(String(calcRate))
        setTransferRateTouched(true)
      } else if (sourceCurrencyCode !== 'TRY' && targetCurrencyCode !== 'TRY' && sourceCurrencyCode !== targetCurrencyCode) {
        const calcRate = Math.round((sourceAmt / targetAmt) * 10000) / 10000
        setTransferRate(String(calcRate))
        setTransferRateTouched(true)
      }
    }
  }

  const handleRefreshTransferRate = async () => {
    setRateLoading(true)
    try {
      const res = await fetchEffectiveFxRateForTransfer(sourceCurrencyCode, targetCurrencyCode)
      const rStr = String(res.rate)
      setTransferRate(rStr)
      setTransferRateTouched(false)
      const conv = calculateConverted(amount, rStr)
      setConvertedAmount(formatMoney(conv))
    } finally {
      setRateLoading(false)
    }
  }

  useEffect(() => {
    if (!open) return
    if (!selectedFrom || !selectedTo) return
    setRateLoading(true)
    let cancelled = false
    void (async () => {
      try {
        const res = await fetchEffectiveFxRateForTransfer(sourceCurrencyCode, targetCurrencyCode)
        if (cancelled) return
        const rStr = transferRateTouched && Number(transferRate) > 0 ? transferRate : String(res.rate)
        setTransferRate(rStr)
        const conv = calculateConverted(amount, rStr)
        setConvertedAmount(formatMoney(conv))
      } catch {
        setTransferRate('1')
      } finally {
        if (!cancelled) setRateLoading(false)
      }
    })()

    return () => { cancelled = true }
  }, [open, selectedFrom, selectedTo, sourceCurrencyCode, targetCurrencyCode])

  const summaryInfo = useMemo(() => {
    const amt = parseFormattedAmount(amount)
    const rate = parseFormattedAmount(transferRate) || 1

    let tryAmt = amt
    let sourceAmt = amt
    let targetAmt = amt

    if (sourceCurrencyCode === 'TRY' && targetCurrencyCode === 'TRY') {
      tryAmt = amt
      sourceAmt = amt
      targetAmt = amt
    } else if (sourceCurrencyCode === 'TRY' && targetCurrencyCode !== 'TRY') {
      tryAmt = amt
      sourceAmt = amt
      targetAmt = rate > 0 ? Math.round((amt / rate) * 100) / 100 : amt
    } else if (sourceCurrencyCode !== 'TRY' && targetCurrencyCode === 'TRY') {
      tryAmt = rate > 0 ? amt * rate : amt
      sourceAmt = amt
      targetAmt = tryAmt
    } else if (sourceCurrencyCode !== 'TRY' && targetCurrencyCode !== 'TRY') {
      if (sourceCurrencyCode === targetCurrencyCode) {
        tryAmt = rate > 0 ? amt * rate : amt
        sourceAmt = amt
        targetAmt = amt
      } else {
        sourceAmt = amt
        targetAmt = rate > 0 ? Math.round((amt / rate) * 100) / 100 : amt
        tryAmt = amt
      }
    }

    return {
      sourceCode: sourceCurrencyCode,
      targetCode: targetCurrencyCode,
      sourceName: cleanCashName(selectedFrom?.name, selectedFrom?.code) || 'Çıkış Kasa',
      targetName: cleanCashName(selectedTo?.name, selectedTo?.code) || 'Giriş Kasa',
      amt,
      tryAmt,
      sourceAmt,
      targetAmt,
      rate
    }
  }, [amount, transferRate, sourceCurrencyCode, targetCurrencyCode, selectedFrom, selectedTo])

  const reloadSelectedBalance = async (cashId?: number | null) => {
    const ac = new AbortController()
    try {
      setBalanceLoading(true)

      if (cashId && cashId > 0) {
        const r = await fetchCashAccountBalance(cashId, { signal: ac.signal })
        setSelectedBalance(Number(r?.balance ?? 0))
      } else {
        setSelectedBalance(null)
      }
    } catch {
      setSelectedBalance(null)
    } finally {
      setBalanceLoading(false)
    }
    return () => ac.abort()
  }

  const reload = async () => {
    const ac = new AbortController()
    try {
      setLoading(true)
      // Bütün kayıtlar sayfa sayfa (2026-10-08): eskiden yalnız son 500 geliyordu, eski kayıtlar
      // aramada/süzgeçte görünmüyordu. İlk sayfa hemen ekrana basılır, kalanlar arkadan eklenir.
      const cashAccountId = selectedCashAccountIdNum > 0 ? selectedCashAccountIdNum : undefined
      await fetchAllPages((skip, take) => fetchCashAccountTransfers({ take, skip, cashAccountId }, { signal: ac.signal }), {
        // Kasa seçiliyken aynı transfer giriş/çıkış olarak iki satır gelebilir: yön de anahtarda.
        key: (x) => `${x.id}:${x.selectedDirection ?? ''}`,
        onPage: (all, first) => {
          setItems(all.map((x) => ({ ...x, actions: '' })))
          if (first) setLoading(false)
        }
      })
    } catch (e: any) {
      setItems([])
      showPopup('error', 'Hata', String(e?.message ?? 'Transferler alınamadı'))
    } finally {
      setLoading(false)
    }
    return () => ac.abort()
  }

  useEffect(() => {
    const ac = new AbortController()
    void (async () => {
      try {
        const list = await fetchCashAccounts({ signal: ac.signal })
        setCashAccounts(list ?? [])
      } catch {
        setCashAccounts([])
      }
    })()
    return () => ac.abort()
  }, [])

  useEffect(() => {
    void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCashAccountIdNum])

  useEffect(() => {
    const id = Number(balanceCashId) || null
    void reloadSelectedBalance(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [balanceCashId])

  useEffect(() => {
    if (!open) return
    if (String(date ?? '').trim()) return
    setDate(todayYmd())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const [transferPageIndex, setTransferPageIndex] = useState(0)
  const [transferPageSize, setTransferPageSize] = useState(20)
  const [transferColumnFiltersState, setTransferColumnFiltersState] = useState<Record<string, any>>({})

  const cashTransferColumns = useMemo<ColumnDef<Row, any>[]>(
    () => [
      {
        accessorKey: 'date',
        header: 'Tarih',
        meta: { filterType: 'date', filterPlaceholder: 'Tarih...' },
        cell: ({ getValue }) => {
          const s = String(getValue() ?? '').trim()
          if (!s) return '-'
          if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
            const [y, m, d] = s.slice(0, 10).split('-')
            return `${d}.${m}.${y}`
          }
          return s.slice(0, 10)
        }
      },
      {
        accessorKey: 'sourceCashAccountId',
        header: 'Çıkış Kasa',
        meta: { filterType: 'text', filterPlaceholder: 'Çıkış Kasa...' },
        cell: ({ getValue }) => cashLabelById.get(Number(getValue() ?? 0)) ?? String(getValue() ?? '')
      },
      {
        accessorKey: 'targetCashAccountId',
        header: 'Giriş Kasa',
        meta: { filterType: 'text', filterPlaceholder: 'Giriş Kasa...' },
        cell: ({ getValue }) => cashLabelById.get(Number(getValue() ?? 0)) ?? String(getValue() ?? '')
      },
      {
        accessorKey: 'amount',
        header: selectedCashAccountIdNum > 0 ? `Tutar (${selectedCashCurrencyCode})` : 'Tutar',
        meta: { filterType: 'number', showTotal: true },
        cell: ({ row }) => {
          const selectedId = selectedCashAccountIdNum
          const dir = Number((row.original as any)?.selectedDirection ?? 0)
          const isIn = dir === 1
          const isOut = dir === 2
          const amt = Number((row.original as any)?.selectedCurrencyAmount ?? 0)

          if (selectedId > 0 && (isIn || isOut)) {
            const signed = isOut ? -Math.abs(amt) : Math.abs(amt)
            const color = isOut ? 'text-red-600' : 'text-emerald-600'
            return <div className={`text-right font-semibold ${color}`}>{formatMoney(signed)}</div>
          }

          return <div className="text-right font-semibold">{formatMoney(Number(row.original.amount ?? 0))}</div>
        }
      },
      {
        accessorKey: 'createUser',
        header: 'İşlemi yapan',
        meta: { filterType: 'text', filterPlaceholder: 'İşlemi yapan...' }
      },
      {
        accessorKey: 'description',
        header: 'Açıklama',
        meta: { filterType: 'text', filterPlaceholder: 'Açıklama...' }
      }
    ],
    [cashLabelById, selectedCashAccountIdNum, selectedCashCurrencyCode]
  )

  const getTransferRowActions = (row: Row): DataTableRowAction<Row>[] => {
    const actions: DataTableRowAction<Row>[] = []
    const canDeleteAll = isSuperAdmin || allowedKeys?.has('deleteRule/tumIslemleriSilebilsin') || allowedKeys?.has('deleteRule/deleteRule/tumIslemleriSilebilsin')
    const currentUsername = (localStorage.getItem('userName') || '').toLowerCase()
    const recordUser = String(row.createUser || (row as any).islemYapan || '').toLowerCase()
    const isOwner = Boolean(currentUsername) && currentUsername === recordUser
    const allowedDelete = canDeleteAll || isOwner

    actions.push({
      label: 'Sil',
      variant: 'danger',
      disabled: !allowedDelete,
      disabledReason: !allowedDelete ? 'Bu işlemi sadece işlemi yapan kullanıcı silebilir' : undefined,
      onClick: (r) => {
        if (!allowedDelete) return
        void (async () => {
          try {
            await deleteCashAccountTransfer(r.id)
            showPopup('success', 'Başarılı', 'Transfer silindi')
            await reload()
          } catch (err: any) {
            showPopup('error', 'Hata', String(err?.message ?? 'Silinemedi'))
          }
        })()
      }
    })
    return actions
  }

  const submit = async () => {
    if (submitting) return
    const amt = parseFormattedAmount(amount)
    const rate = parseFormattedAmount(transferRate) || 1

    let sRate = 1
    let tRate = 1

    if (sourceCurrencyCode !== 'TRY' && targetCurrencyCode === 'TRY') {
      sRate = rate
      tRate = 1
    } else if (sourceCurrencyCode === 'TRY' && targetCurrencyCode !== 'TRY') {
      sRate = 1
      tRate = rate
    } else if (sourceCurrencyCode !== 'TRY' && targetCurrencyCode !== 'TRY') {
      sRate = rate
      tRate = 1
    }

    const payload = {
      sourceCashAccountId: Number(fromId) || 0,
      targetCashAccountId: Number(toId) || 0,
      date: date ? new Date(`${String(date).trim()}T00:00:00.000Z`).toISOString() : new Date().toISOString(),
      amount: amt,
      description: String(description ?? '').trim() || null,
      sourceCurrencyRate: sRate,
      targetCurrencyRate: tRate
    }

    if (payload.sourceCashAccountId <= 0 || payload.targetCashAccountId <= 0) {
      showPopup('error', 'Hata', 'Kasa seçimi zorunludur')
      return
    }

    if (payload.sourceCashAccountId === payload.targetCashAccountId) {
      showPopup('error', 'Hata', 'Çıkış kasa ve giriş kasa aynı olamaz')
      return
    }

    if (payload.amount <= 0) {
      showPopup('error', 'Hata', 'Tutar 0 olamaz')
      return
    }

    try {
      setSubmitting(true)
      await createCashAccountTransfer(payload)
      setOpen(false)
      setFromId('')
      setToId('')
      setDate('')
      setAmount('0,00')
      setDescription('')
      setTransferRate('1')
      setTransferRateTouched(false)
      showPopup('success', 'Başarılı', 'Transfer kaydedildi')
      await reload()
    } catch (e: any) {
      showPopup('error', 'Hata', String(e?.message ?? 'Kaydedilemedi'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="p-4">
      <NotificationPopup isOpen={popupOpen} variant={popupVariant} title={popupTitle} message={popupMessage} onClose={() => setPopupOpen(false)} />

      <Modal
        isOpen={guardOpen}
        onClose={() => setGuardOpen(false)}
        title="Kasa Seçimi Zorunlu"
        footer={
          <button
            type="button"
            className="h-[34px] px-4 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition"
            onClick={() => setGuardOpen(false)}
          >
            Tamam
          </button>
        }
      >
        <div className="py-2 text-sm text-slate-700">
          Transfer işlemi yapabilmek için lütfen önce sol üstteki filtre alanından bir kasa seçiniz.
        </div>
      </Modal>

      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-gray-900 tracking-tight">Kasalar Arası Transfer</h1>
          <p className="text-xs text-gray-400 mt-0.5">Kasa İşlemleri / Transfer</p>
        </div>
        <button
          type="button"
          onClick={openNewTransfer}
          className="h-[34px] inline-flex items-center gap-1.5 px-4 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition"
        >
          Yeni Transfer
        </button>
      </div>

      <div className="bg-white border border-gray-100 rounded-xl shadow-sm p-4 mb-4">
        <div className="flex items-center gap-3">
          <div className="w-72">
            <FormSearchableSelect
              value={balanceCashId}
              onChange={(e) => setBalanceCashId(String(e.target.value))}
              options={cashOptions}
              placeholder="Kasa Seçiniz..."
            />
          </div>

          <div className="h-[34px] inline-flex items-center px-3 rounded-lg border border-gray-200 bg-gray-50 text-xs text-gray-700">
            <span className="font-semibold mr-2">Bakiye:</span>
            {balanceCashId ? (
              balanceLoading ? (
                <span className="text-gray-500">Yükleniyor...</span>
              ) : (
                <span className="font-semibold">
                  {formatMoney(Number(selectedBalance ?? 0))} {currencySymbolByCode(selectedBalanceCurrencyCode)}
                </span>
              )
            ) : (
              <span className="text-gray-500">-</span>
            )}
          </div>
        </div>
      </div>

      <AppDataTable
          onRefresh={() => void reload()}
        data={items}
        columns={cashTransferColumns}
        rowId={(row) => String(row.id)}
        rowActions={getTransferRowActions}
        states={{ loading }}
        filtering={{
          columnFilters: transferColumnFiltersState,
          onColumnFilterChange: (colId, val) => setTransferColumnFiltersState((p) => ({ ...p, [colId]: val }))
        }}
        pagination={{
          pageIndex: transferPageIndex,
          pageSize: transferPageSize,
          totalCount: items.length,
          pageCount: Math.ceil(items.length / transferPageSize),
          onPageChange: setTransferPageIndex,
          onPageSizeChange: setTransferPageSize
        }}
      />

      <Modal
        isOpen={open}
        onClose={() => setOpen(false)}
        title="Kasalar Arası Transfer"
        footer={
          <>
            <button
              type="button"
              disabled={submitting}
              className="h-[34px] px-4 text-xs font-semibold rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 transition disabled:opacity-50"
              onClick={() => setOpen(false)}
            >
              Vazgeç
            </button>
            <button
              type="button"
              disabled={submitting}
              className="h-[34px] inline-flex items-center gap-1.5 px-4 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition disabled:opacity-50"
              onClick={() => void submit()}
            >
              {submitting ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Kaydediliyor...
                </>
              ) : (
                <>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
                  Kaydet
                </>
              )}
            </button>
          </>
        }
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormSearchableSelect label="Giriş Kasa" requiredMark value={toId} onChange={(e) => setToId(e.target.value)} options={cashOptions} placeholder="Giriş Kasa Seçiniz..." />
          <FormSearchableSelect label="Çıkış Kasa" requiredMark value={fromId} onChange={(e) => setFromId(e.target.value)} options={cashOptions} placeholder="Çıkış Kasa Seçiniz..." />
          <FormInput label="Tarih" type="date" requiredMark value={date} onChange={(e) => setDate(e.target.value)} />
          <FormInput
            label={`Tutar (${currencySymbolByCode(sourceCurrencyCode)})`}
            requiredMark
            value={amount}
            onChange={(e) => handleAmountChange(e.target.value)}
            onBlur={() => {
              const num = parseFormattedAmount(amount)
              setAmount(formatMoney(num))
            }}
          />

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs font-bold text-slate-700">
                {rateLabel} <span className="text-red-500">*</span>
              </label>
              {(sourceCurrencyTypeId !== 1 || targetCurrencyTypeId !== 1) && (
                <button
                  type="button"
                  onClick={handleRefreshTransferRate}
                  disabled={rateLoading}
                  title="Güncel Kur(lar)ı Çek"
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-600 hover:text-blue-800 disabled:opacity-50 transition-colors bg-blue-50 hover:bg-blue-100 px-2 py-0.5 rounded border border-blue-200"
                >
                  <span className={`inline-block text-xs ${rateLoading ? 'animate-spin' : ''}`}>🔄</span>
                  {rateLoading ? 'Çekiliyor...' : 'Kuru Yenile'}
                </button>
              )}
            </div>
            <FormInput
              label=""
              requiredMark={false}
              value={transferRate}
              onChange={(e) => handleRateChange(e.target.value)}
              onBlur={() => {
                const num = parseFormattedAmount(transferRate)
                if (num > 0) handleRateChange(String(num))
              }}
            />
          </div>

          <FormInput
            label={`Dönüşen Tutar (${currencySymbolByCode(targetCurrencyCode)})`}
            requiredMark
            value={convertedAmount}
            onChange={(e) => handleConvertedAmountChange(e.target.value)}
            onBlur={() => {
              const num = parseFormattedAmount(convertedAmount)
              setConvertedAmount(formatMoney(num))
            }}
          />

          <div className="md:col-span-2 p-3.5 bg-gradient-to-br from-sky-50 to-blue-50 border border-sky-200 rounded-lg text-xs space-y-1.5 text-sky-900 shadow-sm">
            <div className="font-bold flex items-center justify-between border-b border-sky-200/80 pb-1.5 text-sky-950">
              <span className="flex items-center gap-1.5">
                <span>ℹ️</span> Kasalar Arası Transfer Özeti
              </span>
              <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-sky-100 text-sky-800">
                Kasalar Arası Transfer
              </span>
            </div>

            <div className="flex justify-between items-center py-0.5">
              <span className="text-slate-600">Kaynak (Çıkan) Kasa:</span>
              <span className="font-semibold text-slate-800">
                {summaryInfo.sourceName} ({formatMoney(summaryInfo.sourceAmt)} {summaryInfo.sourceCode})
              </span>
            </div>

            <div className="flex justify-between items-center py-0.5">
              <span className="text-slate-600">Hedef (Giren) Kasa:</span>
              <span className="font-semibold text-slate-800">
                {summaryInfo.targetName} ({formatMoney(summaryInfo.targetAmt)} {summaryInfo.targetCode})
              </span>
            </div>

            {(sourceCurrencyTypeId !== 1 || targetCurrencyTypeId !== 1) && (
              <div className="flex justify-between items-center py-0.5">
                <span className="text-slate-600">Uygulanan Kur:</span>
                <span className="font-bold text-blue-700">{rateLabel}: {transferRate}</span>
              </div>
            )}

            <div className="flex justify-between items-center text-emerald-800 font-bold border-t border-sky-200/80 pt-1.5">
              <span>Yerel Para (TRY) Karşılığı:</span>
              <span className="text-sm">{formatMoney(summaryInfo.tryAmt)} TRY</span>
            </div>
          </div>

          <div className="md:col-span-2">
            <FormInput label="Açıklama" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
        </div>
      </Modal>
    </div>
  )
}

/** Uctan gelen cari satirlarini sayfanin kendi bicimine indirger (telefon dahil). */
function mapCashCustomers(list: any[]): Array<{ customerCode: string; name: string; currencyTypeId: number; phone?: string }> {
  return (list ?? [])
    .map((x: any) => ({
      customerCode: String(x.customerCode ?? ''),
      name: String(x.name ?? ''),
      currencyTypeId: Number(x.currencyTypeId ?? 1),
      phone: String(x.phone ?? x.gsm ?? '')
    }))
    .filter((x) => x.customerCode)
}

/** Secim kutusu bicimi. Acilis ve arama ayni yoldan gecer. */
function buildCashCariOptions(customers: Array<{ customerCode: string; name: string; phone?: string }>): CariOption[] {
  return (customers ?? [])
    .map((c) => ({
      value: String(c.customerCode),
      label: `${c.customerCode}${c.name ? ` - ${c.name}` : ''}`,
      code: String(c.customerCode),
      name: String(c.name ?? ''),
      phone: String(c.phone ?? '')
    }))
    .sort((a, b) => a.label.localeCompare(b.label, 'tr-TR'))
}

export default function CashPage() {
  const { activeTabId } = useOutletContext<LayoutContext>()

  if (activeTabId === 'kasaGirisCikis') {
    return <KasaGirisCikisView />
  }

  if (activeTabId === 'kasalarArasiTransfer') {
    return <KasalarArasiTransferView />
  }

  return <KasaGirisCikisView />
}
