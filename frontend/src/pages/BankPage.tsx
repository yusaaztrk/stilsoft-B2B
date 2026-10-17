import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import Table, { type TableColumn } from '../components/Table'
import Modal from '../components/Modal'
import NotificationPopup, { type NotificationVariant } from '../components/NotificationPopup'
import FormInput from '../components/forms/FormInput'
import FormSelect from '../components/forms/FormSelect'
import FormSearchableSelect from '../components/forms/FormSearchableSelect'
import SearchableCariSelect, { type CariOption } from '../components/SearchableCariSelect'
import { CARI_SEARCH_LIMIT, buildCariSearchQuery } from '../utils/cariRemoteSearch'
import { CUSTOMER_ACCOUNT_OPTIONS, DEFAULT_CUSTOMER_ACCOUNT_ID } from '../constants/customerAccountOptions'
import { fetchBankAccountDefinitions, type BankAccountDefinitionDto } from '../api/bankAccountDefinitions'
import { fetchCustomerByCode, fetchCustomersDropdown, type CustomerDto } from '../api/customers'
import { fetchLatestFxRate, fetchCrossFxRate } from '../api/fx'
import { AppDataTable, type DataTableRowAction } from '../components/data-table'
import type { ColumnDef } from '@tanstack/react-table'
import {
  createBankAccountTransaction,
  deleteBankAccountTransaction,
  fetchBankAccountBalance,
  fetchBankAccountBalanceByCurrency,
  fetchBankAccountTransactions,
  fetchLinkedInvoiceHeaderByBankTransactionId,
  fetchLinkedInvoiceLinesByBankTransactionId,
  type BankAccountTransactionCounterpartyType,
  type BankAccountTransactionDirection,
  type BankAccountTransactionListItemDto,
  type LinkedInvoiceHeaderDto,
  type LinkedInvoiceLineDto
} from '../api/bankAccountTransactions'
import { createBankAccountTransfer } from '../api/bankAccountTransfers'
import { fetchSuppliers, type SupplierDto } from '../api/suppliers'
import { BANK_ACCOUNT_TYPES, bankAccountTypeLabel } from '../constants/bankAccountTypes'

type LayoutContext = {
  activeMenuId: string
  activeTabId?: string
  setActiveTabId?: (id?: string) => void
  isSuperAdmin?: boolean
  allowedKeys?: Set<string>
}

function formatMoney(n: number) {
  const v = Number(n ?? 0)
  if (!Number.isFinite(v)) return '0,00'
  return new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v)
}

function parseFormattedAmount(val: any): number {
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

/**
 * DÖVİZ KURU okuyucusu — tutar okuyucusu (`parseFormattedAmount`) kurlar için KULLANILAMAZ.
 *
 * `parseFormattedAmount` para tutarı içindir ve tr-TR'de "1.234" bin iki yüz otuz dört demek
 * olduğu için tek noktayı BİNLİK AYRACI sayar. Kur alanında ise "1.234" bir tam bir virgül iki
 * üç dört demektir. Sonuç: üç ondalıklı her kur 1000 katına çıkıyordu —
 *   47.123 -> 47123,  8.125 -> 8125,  1.234 -> 1234
 * ve hesaplar arası transferde hedef tutar 1000 kat küçülüyordu (60 TL -> 0,0013 USD).
 * Doğrulandı: 2026-08-11.
 *
 * Kural farkı tek cümle: kurda tek ayraç HER ZAMAN ondalıktır, asla binlik değildir.
 * Binlik ayracı yalnızca iki ayraç birden varsa (ör. "1.234,56") anlamlıdır.
 */
function parseRate(val: any): number {
  if (val === null || val === undefined) return 0
  if (typeof val === 'number') return Number.isFinite(val) ? val : 0

  let str = String(val).trim().replace(/[^\d.,-]/g, '')
  if (!str) return 0

  const lastDot = str.lastIndexOf('.')
  const lastComma = str.lastIndexOf(',')

  if (lastDot >= 0 && lastComma >= 0) {
    // İki ayraç birden: sonuncusu ondalık, diğerleri binlik.
    const decimalSep = lastComma > lastDot ? ',' : '.'
    const groupSep = decimalSep === ',' ? '.' : ','
    str = str.split(groupSep).join('').replace(decimalSep, '.')
  } else {
    // Tek ayraç: ondalıktır. Tutar okuyucusundan ayrıldığımız yer burası.
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

function handleCurrencyInputChange(val: string): string {
  if (!val || val.trim() === '') return '0,00'
  const rawDigits = val.replace(/[^\d]/g, '')
  if (!rawDigits) return '0,00'
  const cents = parseInt(rawDigits, 10)
  const num = cents / 100
  return formatMoney(num)
}

function normalizeCurrencyTypeId(cur: number) {
  const v = Number(cur ?? 1)
  return v === 0 ? 1 : v
}

/**
 * TL mi? 0 ve 1'in İKİSİ de TL (eski kayıtlar 0, hesap tanımı ekranları 1 yazıyor).
 * Backend'deki CurrencyTypeHelper.IsTry ile aynı kural. `=== 0` diye sorulan her yer,
 * 1 ile kaydedilmiş TL hesapları TL değilmiş gibi işliyordu.
 */
function isTryTypeId(cur: number) {
  const v = Number(cur ?? 1)
  return v === 0 || v === 1
}

function currencyCodeByTypeId(cur: number) {
  const v = Number(cur ?? 1)
  return v === 2 ? 'EUR' : v === 3 ? 'USD' : v === 4 ? 'GBP' : 'TRY'
}

function currencySymbolByCode(code: string) {
  return code === 'TRY' ? '₺' : code === 'USD' ? '$' : code === 'EUR' ? '€' : code === 'GBP' ? '£' : code
}

function BankaHavaleEftView() {
  const { isSuperAdmin, allowedKeys } = useOutletContext<LayoutContext>()
  // `isOpeningBalance` GERCEK BIR HAREKET DEGIL: hesabin acilis (devir) bakiyesini listenin
  // en altina koyan sanal satirin damgasi. Silme/duzenleme yollari bu satiri disarida
  // birakmali, `id` alani gercek bir kaydi gostermiyor.
  type Row = BankAccountTransactionListItemDto & {
    actions: string
    isim: string
    borc: number
    alacak: number
    isOpeningBalance?: boolean
  }

  const [items, setItems] = useState<Row[]>([])
  const [loading, setLoading] = useState(false)

  const [bankAccounts, setBankAccounts] = useState<BankAccountDefinitionDto[]>([])
  const [selectedBankAccountId, setSelectedBankAccountId] = useState('')

  // Hesap turu ONCE secilir, hesap SONRA. Tur secilmeden hesap kutusu acilmaz; bu yuzden
  // ikisinin de baslangici BOS ve acilista hicbir hesap otomatik secilmez (bkz. reloadBanks).
  const [selectedAccountType, setSelectedAccountType] = useState('')


  const [balanceLoading, setBalanceLoading] = useState(false)
  const [balance, setBalance] = useState<number | null>(null)
  const [multiCurrencyBalances, setMultiCurrencyBalances] = useState<Array<{ currencyTypeId: number; currencyCode: string; balance: number }>>([])

  const [listLoadedOnce, setListLoadedOnce] = useState(false)

  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [deleteRow, setDeleteRow] = useState<Row | null>(null)

  const [customerModalOpen, setCustomerModalOpen] = useState(false)
  const [customerModalLoading, setCustomerModalLoading] = useState(false)
  const [customerModalError, setCustomerModalError] = useState<string | null>(null)
  const [customerModalData, setCustomerModalData] = useState<CustomerDto | null>(null)

  const [invoiceModalOpen, setInvoiceModalOpen] = useState(false)
  const [invoiceModalLoading, setInvoiceModalLoading] = useState(false)
  const [invoiceModalError, setInvoiceModalError] = useState<string | null>(null)
  const [invoiceModalHeader, setInvoiceModalHeader] = useState<LinkedInvoiceHeaderDto | null>(null)
  const [invoiceModalLines, setInvoiceModalLines] = useState<LinkedInvoiceLineDto[]>([])

  const [popupOpen, setPopupOpen] = useState(false)
  const [popupVariant, setPopupVariant] = useState<NotificationVariant>('info')
  const [popupTitle, setPopupTitle] = useState('')
  const [popupMessage, setPopupMessage] = useState('')

  const showPopup = (variant: NotificationVariant, title: string, message: string) => {
    setPopupVariant(variant)
    setPopupTitle(title)
    setPopupMessage(message)
    setPopupOpen(true)
  }

  const selectedBankId = useMemo(() => {
    const id = Number(String(selectedBankAccountId ?? '').trim())
    return Number.isFinite(id) && id > 0 ? id : null
  }, [selectedBankAccountId])

  const selectedBank = useMemo(() => {
    const id = selectedBankId
    if (!id) return null
    return bankAccounts.find((x) => x.id === id) ?? null
  }, [bankAccounts, selectedBankAccountId, selectedBankId])

  // Modaldaki kilitli "Hesap" alaninin gosterecegi metin. Ustteki secim degistiginde
  // kendiliginden guncellenir; modal her acilista o anki hesapla acilir.
  const selectedBankLabel = useMemo(() => {
    if (!selectedBank) return ''
    const cur = normalizeCurrencyTypeId(Number((selectedBank as any)?.currencyTypeId ?? 0) || 0)
    const suffix = cur === 2 ? 'EUR' : cur === 3 ? 'USD' : cur === 4 ? 'GBP' : 'TL'
    return `${selectedBank.accountName || selectedBank.accountCode} (${suffix})`
  }, [selectedBank])

  const [selectedCurrencyTypeIdState, setSelectedCurrencyTypeIdState] = useState<string>('1')

  const selectedCurrencyTypeId = useMemo(() => {
    return Number(selectedCurrencyTypeIdState)
  }, [selectedCurrencyTypeIdState])

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
    if (selectedBank) {
      const next = normalizeCurrencyTypeId(Number((selectedBank as any)?.currencyTypeId ?? 0) || 0)
      pendingCurrencyRef.current = next
      setSelectedCurrencyTypeIdState(String(next))
    }
  }, [selectedBank])

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
    setInvoiceModalOpen(true)
    setInvoiceModalLoading(true)
    setInvoiceModalError(null)
    setInvoiceModalHeader(null)
    setInvoiceModalLines([])

    void (async () => {
      try {
        const [h2, lines2] = await Promise.all([
          fetchLinkedInvoiceHeaderByBankTransactionId(Number((row as any)?.id ?? 0)),
          fetchLinkedInvoiceLinesByBankTransactionId(Number((row as any)?.id ?? 0))
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
      } catch (e: any) {
        setInvoiceModalError(String(e?.message ?? 'Fatura bilgileri alınamadı'))
      } finally {
        setInvoiceModalLoading(false)
      }
    })()
  }

  const [pageIndex, setPageIndex] = useState(0)
  const [pageSize, setPageSize] = useState(20)
  const [columnFiltersState, setColumnFiltersState] = useState<Record<string, any>>({})

  const bankColumns = useMemo<ColumnDef<Row, any>[]>(() => {
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
        accessorKey: 'bankAccountName',
        header: 'Banka Adı',
        meta: { filterType: 'text', filterPlaceholder: 'Banka Adı...' }
      },
      {
        accessorKey: 'dovizTuru',
        header: 'Döviz',
        meta: { filterType: 'text', filterPlaceholder: 'Döviz...' }
      },
      {
        accessorKey: 'isim',
        header: 'İsim',
        meta: { filterType: 'text', filterPlaceholder: 'İsim...' },
        // Devir satiri gercek bir hareket degil; kalin yazi onu diger satirlardan ayirir.
        cell: ({ row, getValue }) => {
          const v = String(getValue() ?? '')
          return row.original?.isOpeningBalance ? <span className="font-bold text-gray-700">{v}</span> : v
        }
      },
      {
        accessorKey: 'description',
        header: 'Açıklama',
        meta: { filterType: 'text', filterPlaceholder: 'Açıklama...' }
      },
      {
        id: 'borc',
        accessorFn: (row) => Number(row.borc ?? 0),
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
        id: 'alacak',
        accessorFn: (row) => Number(row.alacak ?? 0),
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
      /*
        YÜRÜYEN BAKİYE (2026-10-03, kullanıcı isteği: "her işlemden sonra bakiye ne olmuş görelim").
        Değer `reloadList`te hesaplanıyor: devir + hareketler TARİH SIRASIYLA (en eskiden), her
        satır o işlemden SONRAKİ bakiyeyi taşır — banka ekstresindeki gibi. Saklanmaz, her
        okumada baştan kurulur; geçmişe dönük girilen hareket sonraki bütün bakiyeleri kaydırır.
        Tablo başka sütuna göre sıralansa da her satır kendi anındaki bakiyeyi gösterir.
      */
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
        header: 'İşlem Yapan',
        meta: { filterType: 'text', filterPlaceholder: 'İşlem Yapan...' }
      }
    ]
  }, [selectedCurrencyTypeId])

  const getRowActions = (row: Row): DataTableRowAction<Row>[] => {
    // Devir satiri gercek bir hareket degil: musteri/fatura bilgisi yok, silinecek kaydi da
    // yok. `id` alani 0 oldugu icin silme cagrisi rastgele bir kaydi hedefleyebilirdi.
    if (row.isOpeningBalance) return []

    const actions: DataTableRowAction<Row>[] = []
    actions.push({
      label: 'Müşteri Bilgi',
      onClick: (r) => openCustomerModal(r)
    })
    actions.push({
      label: 'Fatura Bilgi',
      onClick: (r) => openInvoiceModal(r)
    })
    const canDeleteAll = isSuperAdmin || allowedKeys?.has('deleteRule/tumIslemleriSilebilsin') || allowedKeys?.has('deleteRule/deleteRule/tumIslemleriSilebilsin')
    const currentUsername = (localStorage.getItem('userName') || '').toLowerCase()
    // `islemYapan` diye bir alan yok: API `CreateUser` donuyor, kolon da onu gosteriyor
    // (accessorKey: 'createUser'). Olu yedek, tip hatasi uretiyordu.
    const recordUser = String(row.createUser || '').toLowerCase()
    const isOwner = Boolean(currentUsername) && currentUsername === recordUser
    const allowedDelete = canDeleteAll || isOwner

    actions.push({
      label: 'Sil',
      variant: 'danger',
      disabled: !allowedDelete,
      disabledReason: !allowedDelete ? 'Bu işlemi sadece işlemi yapan kullanıcı silebilir' : undefined,
      onClick: (r) => {
        if (!allowedDelete) return
        setDeleteRow(r)
        setDeleteConfirmOpen(true)
      }
    })
    return actions
  }

  /**
   * Hesap turu secenekleri GELEN HESAPLARDAN turetilir, sabit listeden degil.
   *
   * Firmadan firmaya hangi turlerin tanimli oldugu degisiyor: POS hesabi acilmamis bir
   * firmada "POS Hesabi" secenegi HIC gorunmemeli, secilince bos liste veren olu bir
   * secenek birakmak yerine. BANK_ACCOUNT_TYPES yalnizca siralamayi ve etiketi verir.
   */
  const accountTypeOptions = useMemo(() => {
    // SECIM SIRASI: KUR -> HESAP TURU -> HESAP (2026-08-23 kullanici karari, kasa ekraniyla ayni).
    // Tur listesi artik secili DOVIZE gore suzuluyor: o dovizde hic hesabi olmayan bir tur
    // secilebilir kalsaydi, secildiginde hesap listesi bos gelen olu bir secenek olurdu.
    const wantedCur = normalizeCurrencyTypeId(selectedCurrencyTypeId)
    const inCurrency = (bankAccounts ?? []).filter(
      (b) => normalizeCurrencyTypeId(Number((b as any)?.currencyTypeId ?? 0)) === wantedCur
    )
    const present = new Set<number>(inCurrency.map((b) => Number((b as any)?.accountType ?? 0)))
    const known = BANK_ACCOUNT_TYPES.filter((t) => present.has(t.value)).map((t) => ({
      value: String(t.value),
      label: t.label
    }))
    // Listede olmayan bir tur veritabaninda varsa yutulmasin: hesap erisilemez kalirdi.
    const knownValues = new Set(BANK_ACCOUNT_TYPES.map((t) => t.value))
    const unknown = [...present]
      .filter((v) => !knownValues.has(v))
      .sort((a, b) => a - b)
      .map((v) => ({ value: String(v), label: bankAccountTypeLabel(v) }))
    return [...known, ...unknown]
  }, [bankAccounts, selectedCurrencyTypeId])

  const bankOptions = useMemo(() => {
    const suffix = (cur: number) => {
      const v = normalizeCurrencyTypeId(cur)
      return v === 2 ? 'EUR' : v === 3 ? 'USD' : v === 4 ? 'GBP' : 'TL'
    }
    // Tur secilmeden hesap listesi BOS gelir; kutu zaten kapali ama ikisinin ayni yerden
    // beslenmesi, tur degisince eski hesabin listede sirittigi durumu da kapatir.
    const typeId = String(selectedAccountType ?? '').trim()
    if (!typeId) return []
    // Hem tur HEM doviz suzuluyor: kur en basta secildigi icin listede baska para biriminden
    // bir hesabin gorunmesi, secildiginde bakiyeyi/hareketi bos gostermek demekti.
    const wantedCur = normalizeCurrencyTypeId(selectedCurrencyTypeId)
    const base = (bankAccounts ?? [])
      .filter((b) => String(Number((b as any)?.accountType ?? 0)) === typeId)
      .filter((b) => normalizeCurrencyTypeId(Number((b as any)?.currencyTypeId ?? 0)) === wantedCur)
      .map((b) => ({
        value: String(b.id),
        label: `${b.accountName || b.accountCode} (${suffix(Number((b as any)?.currencyTypeId ?? 0))})`
      }))
    // POS masrafi BURADA LISTELENMEZ (2026-08-20, kullanici karari): kendi ekrani var
    // (Banka Islemleri > Banka Masraflari). Havale/EFT listesinde ikinci kez gorunmesi,
    // ayni hareketi iki ayri yerde sayiyormus izlenimi veriyordu.
    return base
  }, [bankAccounts, selectedAccountType, selectedCurrencyTypeId])

  const reloadBanks = async () => {
    const ac = new AbortController()
    try {
      const data = await fetchBankAccountDefinitions({ signal: ac.signal } as any)
      setBankAccounts(data)
      // Acilista hesap OTOMATIK SECILMEZ. Once tur secilecek (kullanici karari 2026-08-22).
      // Yan faydasi: sayfa acilirken bakiye ve hareket listesi istegi hic atilmiyor.
    } catch {
      setBankAccounts([])
    }
    return () => ac.abort()
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
  const listSeqRef = useRef(0)
  const listAbortRef = useRef<AbortController | null>(null)
  const balanceSeqRef = useRef(0)
  const balanceAbortRef = useRef<AbortController | null>(null)

  const reloadBalance = async (id: number) => {
    balanceAbortRef.current?.abort()
    const ac = new AbortController()
    balanceAbortRef.current = ac
    const seq = ++balanceSeqRef.current
    try {
      setBalanceLoading(true)
      const [r, multi] = await Promise.all([
        fetchBankAccountBalance(id, { signal: ac.signal }),
        fetchBankAccountBalanceByCurrency(id, { signal: ac.signal })
      ])
      if (seq !== balanceSeqRef.current) return
      setBalance(Number(r?.balance ?? 0))
      setMultiCurrencyBalances((multi?.balances ?? []).map((x) => ({ currencyTypeId: Number(x.currencyTypeId ?? 0), currencyCode: String(x.currencyCode ?? ''), balance: Number(x.balance ?? 0) })))
    } catch {
      if (seq !== balanceSeqRef.current) return
      setBalance(null)
      setMultiCurrencyBalances([])
    } finally {
      if (seq === balanceSeqRef.current) setBalanceLoading(false)
    }
  }

  const reloadList = async (id: number) => {
    listAbortRef.current?.abort()
    const ac = new AbortController()
    listAbortRef.current = ac
    const seq = ++listSeqRef.current
    try {
      setLoading(true)
      // Hesabın BÜTÜN hareketleri: liste kesilirse alttaki TOPLAM ve DEVİR satırı üstteki
      // bakiyeyi tutmaz (2026-10-03, "200 kayıtta sınırlıyor").
      const data = await fetchBankAccountTransactions(id, { currencyTypeId: selectedCurrencyTypeId, take: 100000, signal: ac.signal })
      if (seq !== listSeqRef.current) return

      /**
       * DEVIR BAKIYESI satiri.
       *
       * Hesabin acilis bakiyesi (`budget` kolonu) bakiye kutusuna zaten giriyordu
       * (`bakiye = acilis + giren - cikan`) ama listede hicbir izi yoktu: kullanici
       * satirlari toplayinca kutudaki rakami tutturamiyordu. Artik en eski satir olarak
       * gorunuyor ve Giren/Cikan toplamlarina katiliyor.
       *
       * Yalnizca HESABIN KENDI para biriminde gosterilir: acilis bakiyesi tek para
       * birimindedir, baska bir dovize gecildiginde o dovizin hareketleriyle toplanmasi
       * anlamsiz olurdu (bakiye ucu da ayni kurali uyguluyor).
       */
      const bankDef = (bankAccounts ?? []).find((x) => Number(x.id) === Number(id))
      const openingBalance = Number((bankDef as any)?.budget ?? 0)
      const accountCurrency = normalizeCurrencyTypeId(Number((bankDef as any)?.currencyTypeId ?? 0) || 0)
      const viewCurrency = normalizeCurrencyTypeId(selectedCurrencyTypeId)
      const showOpeningRow = Number.isFinite(openingBalance) && openingBalance !== 0 && accountCurrency === viewCurrency

      let runningBalance = showOpeningRow ? openingBalance : 0
      const listWithBalances = [...(data ?? [])].reverse().map((x) => {
        const dirStr = String(x.direction ?? '').toLowerCase()
        const isIn = dirStr === '1' || dirStr === 'in'
        const showAsIn = isIn
        const amt = (selectedCurrencyTypeId === 0 || selectedCurrencyTypeId === 1) ? Number(x.amount ?? 0) : Number((x as any)?.currencyAmount ?? 0)

        const giren = showAsIn ? amt : 0
        const cikan = !showAsIn ? amt : 0
        runningBalance += giren
        runningBalance -= cikan

        return {
          ...x,
          actions: '',
          isim: String(x.counterpartyName ?? ''),
          borc: giren,
          alacak: cikan,
          runningBalance,
          bankAccountName: x.bankAccountName || `Banka #${x.bankAccountDefinitionId}`,
          dovizTuru: currencyCodeByTypeId(normalizeCurrencyTypeId(x.currencyTypeId ?? 0))
        }
      })
      const rows: Row[] = listWithBalances.reverse()

      if (showOpeningRow) {
        const openingRow = {
          id: 0,
          isOpeningBalance: true,
          actions: '',
          // Tarih YOK: devir icin gercek bir tarih tutulmuyor, hesabin olusturma tarihini
          // yazmak uydurma bir tarih gostermek olurdu. Sutunda "-" cikar.
          date: '',
          bankAccountDefinitionId: Number(id),
          bankAccountName: String((bankDef as any)?.accountName || (bankDef as any)?.accountCode || ''),
          dovizTuru: currencyCodeByTypeId(accountCurrency),
          currencyTypeId: accountCurrency,
          isim: 'DEVİR BAKİYESİ',
          description: 'Açılış bakiyesi (devir)',
          borc: openingBalance > 0 ? openingBalance : 0,
          alacak: openingBalance < 0 ? -openingBalance : 0,
          runningBalance: openingBalance,
          createUser: ''
        } as unknown as Row

        // Liste yeniden eskiye siralidir; devir EN ESKI kayittir, bu yuzden en sona.
        rows.push(openingRow)
      }

      setItems(rows)
      setListLoadedOnce(true)
    } catch (e: any) {
      // Iptal edilen ya da gecikmis istek sessizce dusurulur (bkz. sira korumasi notu).
      if (seq !== listSeqRef.current || ac.signal.aborted) return
      setItems([])
      const msg = String(e?.message ?? 'Liste alınamadı')
      if (listLoadedOnce || (!msg.toLowerCase().includes('failed to fetch') && !msg.toLowerCase().includes('networkerror'))) {
        showPopup('error', 'Hata', msg)
      }
    } finally {
      if (seq === listSeqRef.current) setLoading(false)
    }
  }

  useEffect(() => {
    void reloadBanks()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const id = Number(selectedBankId)
    if (!id) {
      setBalance(null)
      setMultiCurrencyBalances([])
      setItems([])
      return
    }
    // Suzgec, secilen hesabin dovizine henuz varmadiysa bekle (bkz. `pendingCurrencyRef`).
    if (pendingCurrencyRef.current !== null && pendingCurrencyRef.current !== normalizeCurrencyTypeId(selectedCurrencyTypeId)) return
    void reloadBalance(id)
    void reloadList(id)
    // `selectedBank` de bagimlilikta: acilis bakiyesi ORADAN okunuyor (bkz. kasa ekrani).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBankAccountId, selectedBankId, selectedCurrencyTypeId, selectedBank])

  const onDelete = async (row: Row) => {
    const prevItems = items
    try {
      setItems((prev) => (prev ?? []).filter((x) => Number(x.id) !== Number(row.id)))
      await deleteBankAccountTransaction(Number(row.id))
      showPopup('success', 'Başarılı', 'Silme tamamlandı')
      const id = Number(selectedBankAccountId)
      if (id) {
        await reloadBalance(id)
        await reloadList(id)
      }
    } catch (e: any) {
      setItems(prevItems)
      showPopup('error', 'Hata', String(e?.message ?? 'Silme başarısız'))
    }
  }

  const confirmDelete = async () => {
    if (!deleteRow) return
    const row = deleteRow
    setDeleteConfirmOpen(false)
    setDeleteRow(null)
    await onDelete(row)
  }

  const totalBorc = useMemo(() => items.reduce((sum, x) => sum + (x.borc ?? 0), 0), [items])

  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  const [createForms, setCreateForms] = useState<any[]>([])

  const currencyCode = useMemo(() => currencyCodeByTypeId(selectedCurrencyTypeId), [selectedCurrencyTypeId])
  const currencySymbol = useMemo(() => currencySymbolByCode(currencyCode), [currencyCode])

  // POS masrafı (tutar, döviz tipi, kur) artık kayıt seviyesinde tek bir state değil, her
  // `createForms` satırının kendi alanı — bir kaydette birden çok satır girilebiliyor ve her
  // satırın masrafı/kuru ayrı. Burada duran üç useMemo o taşımadan artakalmıştı: artık var
  // olmayan `posFee` / `posFeeCurrencyRate` / `posFeeCurrencyTypeId` değişkenlerini okuyup
  // sayfayı render anında ReferenceError ile düşürüyordu ve hesapladıkları değerler hiçbir
  // yerde kullanılmıyordu. Satır bazlı karşılıkları `posFeeTryAmount` alanında
  // (bkz. `updateCreateRow` / `fetchRatesForForm`) hesaplanıyor.

  const currencyOptions = [
    { value: '1', label: 'TL (TRY)' },
    { value: '2', label: 'EUR' },
    { value: '3', label: 'USD' },
    { value: '4', label: 'GBP' }
  ]

  const [customers, setCustomers] = useState<CustomerDto[]>([])
  const [suppliers, setSuppliers] = useState<SupplierDto[]>([])
  const [lookupsLoading, setLookupsLoading] = useState(false)
  const lookupsLoadedRef = useRef(false)

  /**
   * Karsi hesap listeleri banka hesabi tanimlarinin AYNISIDIR — ayri bir istek atmak
   * gereksizdi ve acilista ayni ucu iki kez cagiriyordu.
   */
  const counterpartyBanks = bankAccounts

  /**
   * Cari ve tedarikci listeleri SAYFA ACILISINDA DEGIL, "Yeni Transfer" modali acilinca
   * yuklenir.
   *
   * Eskiden acilista iki sinirsiz istek atiliyordu: butun cariler + butun tedarikciler
   * (ikincisi `includeCustomers: true` ile carileri TEKRAR indiriyor). Bu listeler yalnizca
   * modal icindeki karsi hesap kutusunda kullaniliyor, yani sayfayi acan ama transfer
   * girmeyen herkes bedelini bosuna oduyordu. Ayni desen Fatura Dokumu'nde de boyle
   * duzeltildi. `includeCustomers` bayragi BILEREK duruyor: tedarikci listesinde cari
   * kayitlari da karsi hesap olarak secilebiliyor, kaldirmak secenekleri eksiltirdi.
   */
  const ensureLookupsLoaded = async () => {
    if (lookupsLoadedRef.current || lookupsLoading) return
    setLookupsLoading(true)
    try {
      const [custs, sups] = await Promise.all([
        fetchCustomersDropdown(),
        fetchSuppliers({ includeCustomers: true })
      ])
      setCustomers(custs ?? [])
      setSuppliers(sups ?? [])
      lookupsLoadedRef.current = true
    } catch {
      setCustomers([])
      setSuppliers([])
      // lookupsLoadedRef BILEREK isaretlenmiyor: modal bir dahaki acilista tekrar denesin.
    } finally {
      setLookupsLoading(false)
    }
  }

  /**
   * CARI / TEDARIKCI ARAMASI SUNUCUDA (2026-08-22) — Cari Ekstre'deki duzenin AYNISI.
   * Hangi ucun cagrilacagini satirin "Hesap Tipi" secimi belirler; uc parametreleri
   * modalin daha once kullandiklariyla AYNI.
   */
  /*
    KARŞI HESAP ARAMASI TÜM CARİLERİ KAPSAR (2026-08-31 kullanıcı bildirimi: "burada
    tedarikçiler çıkmıyor, tüm carilerin çıkması lazımdı").

    Eskiden hesap tipi 'Cari' iken yalnızca müşteriler aranıyor, 320'li tedarikçiler listede
    hiç görünmüyordu; kullanıcı aradığını bulmak için önce doğru tipi seçmek zorundaydı.
    'supplier' kipi zaten `includeCustomers: true` ile hepsini getiriyordu, o yüzden çağrı
    yerleri artık hep onu kullanıyor.

    Hesap tipini SEÇİM düzeltir: bkz. handleCounterpartyCodeChangeForForm — 320 ile başlayan
    kod tedarikçi defterine, diğerleri cari defterine yazılır.
  */
  /**
   * Karsi hesap aramasi — MUSTERI VE TEDARIKCI BIRLIKTE.
   *
   * Onceki surum tek uc cagiriyordu ve cagri yerinde `'supplier'` SABIT yazilmisti: hesap
   * tipi "Cari" secilse bile yalnizca tedarikci ucu taraniyor, musteri carileri hic
   * gelmiyordu. Kullanici "arama barlarinda tum cariler gelmiyor" diye bildirdi; ornek
   * `770-01-000063 AHMET PEHLIVANOGLU DOVIZ BUROSU` — Cari Ekstre sayfasi buluyor, burasi
   * bulamiyordu.
   *
   * Cari Ekstre ile AYNI yontem: iki uc paralel sorgulanip sonuc birlestiriliyor. Tek uca
   * dusmek, o ucun kapsamadigi her cariyi (600/770 gider carileri dahil) gorunmez yapiyor.
   */
  const counterpartyRemoteSearch = useCallback(
    async (query: string, typeKey: string): Promise<CariOption[]> => {
      const q = buildCariSearchQuery(query, typeKey)
      try {
        const [custs, sups] = await Promise.all([
          fetchCustomersDropdown({ q, limit: CARI_SEARCH_LIMIT }).catch(() => [] as any[]),
          fetchSuppliers({ includeCustomers: true, q, limit: CARI_SEARCH_LIMIT }).catch(() => [] as any[])
        ])

        setCustomers(custs ?? [])
        setSuppliers(sups ?? [])

        const custOpts: CariOption[] = (custs ?? []).map((c: any) => ({
          value: String(c.customerCode ?? ''),
          label: `${c.customerCode}${c.name ? ` - ${c.name}` : ''}`,
          code: String(c.customerCode ?? ''),
          name: String(c.name ?? ''),
          phone: String(c.phone ?? c.fax ?? ''),
          customerType: String(c.customerType ?? '')
        }))

        const supOpts: CariOption[] = (sups ?? []).map((sup: any) => ({
          value: String(sup.supplierCode ?? ''),
          label: `${sup.supplierCode}${sup.fullName ? ` - ${sup.fullName}` : ''}`,
          code: String(sup.supplierCode ?? ''),
          name: String(sup.fullName ?? ''),
          phone: String(sup.phoneNumber ?? ''),
          type: 'supplier',
          customerType: '320'
        }))

        // `includeCustomers: true` yuzunden iki uc ayni cariyi dondurebiliyor; kod tekillestirilir.
        const gorulen = new Set<string>()
        return [...custOpts, ...supOpts]
          .filter((o) => {
            const k = String(o.code ?? '').toUpperCase()
            if (!k || gorulen.has(k)) return false
            gorulen.add(k)
            return true
          })
          .sort((a, b) => a.label.localeCompare(b.label, 'tr-TR'))
      } catch {
        return []
      }
    },
    []
  )

  const getCounterpartyOptions = (form: any) => {
    const type = form.counterpartyType
    // Banka disindaki her durumda liste BIRLESIK: musteri + tedarikci. Tip ayrimi secimden
    // SONRA kodun onekinden turetiliyor (handleCounterpartyCodeChangeForForm), listeyi
    // onceden daraltmak kullanicinin aradigi cariyi gizliyordu.
    if (type !== 'bank') {
      const gorulen = new Set<string>()
      return [
        ...(customers ?? []).map((c) => ({
          value: String(c.customerCode ?? ''),
          label: `${c.customerCode}${c.name ? ` - ${c.name}` : ''}`
        })),
        ...(suppliers ?? []).map((s) => ({
          value: String(s.supplierCode ?? ''),
          label: `${s.supplierCode}${s.fullName ? ` - ${s.fullName}` : ''}`
        }))
      ]
        .filter((o) => {
          const k = o.value.toUpperCase()
          if (!k || gorulen.has(k)) return false
          gorulen.add(k)
          return true
        })
        .sort((a, b) => a.label.localeCompare(b.label, 'tr-TR'))
    }
    return (counterpartyBanks ?? [])
      .filter((b) => Number(b.id) !== Number(selectedBankId ?? 0))
      .map((b) => ({ value: String(b.id), label: b.accountName || b.accountCode || '' }))
      .sort((a, b) => a.label.localeCompare(b.label, 'tr-TR'))
  }

  const getEmptyCreateForm = () => {
    const typeId = selectedCurrencyTypeId || 1
    return {
      txDate: new Date().toLocaleDateString('sv-SE'),
      selectedBankAccountId: String(selectedBankAccountId ?? ''),
      counterpartyType: 'cari' as const,
      counterpartyCode: '',
      customerAccountCurrencyTypeId: DEFAULT_CUSTOMER_ACCOUNT_ID,
      // VARSAYILAN GİRİŞ (kullanıcı kararı 2026-08-22). Ekranda ağırlıklı olarak tahsilat
      // giriliyor; varsayılan "Çıkış" iken her kayıtta tek tek değiştiriliyordu.
      direction: 'in' as const,
      amount: '0,00',
      currencyTypeId: String(typeId),
      currencyRate: (typeId === 1 || typeId === 0) ? '1' : '0',
      currencyRateTouched: false,
      currencyRateLoading: false,
      currencyAmount: '0,00',
      targetCurrencyRate: '1',
      targetCurrencyRateLoading: false,
      description: '',
      posFee: '0,00',
      posFeeCurrencyTypeId: String(typeId),
      posFeeCurrencyRate: '1',
      posFeeCurrencyRateLoading: false,
      posFeeDescription: '',
      posFeeTryAmount: 0,
      // POS masrafı vergi oranları (denetim md. A4). İkisi de ELLE girilir; boş bırakılırsa
      // ayrıştırma yapılmaz ve hesaptan düşen tutar bugüne kadarki gibi kalır. Bu oranlar
      // masrafı BÜYÜTMEZ — girilen tutarın içindeki bileşeni açıklar.
      posFeeBsmvRate: '',
      posFeeVatRate: ''
    }
  }

  const addCreateRow = () => {
    setCreateForms((prev) => {
      const rows = [...(prev ?? [])]
      if (!rows.length) return [getEmptyCreateForm()]
      const last = rows[rows.length - 1] ?? getEmptyCreateForm()
      const newIndex = rows.length
      const newRow = { 
        ...(last ?? {}), 
        currencyRateLoading: false,
        posFeeCurrencyRateLoading: false,
        targetCurrencyRateLoading: false
      }
      
      // Fetch rates asynchronously for the new row
      setTimeout(() => {
        void fetchRatesForForm(newIndex, newRow)
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

      // 1. Calculate Target Bank Currency Amount (currencyAmount) or TRY equivalent
      const srcAmount = parseFormattedAmount(newRow.amount)
      const sourceRate = parseRate(newRow.currencyRate)
      const targetRate = parseRate(newRow.targetCurrencyRate)
      
      const bankDef = (bankAccounts ?? []).find((x) => String(x.id) === newRow.selectedBankAccountId)
      const sourceTypeId = normalizeCurrencyTypeId(Number(bankDef?.currencyTypeId ?? selectedCurrencyTypeId ?? 0) || 0)

      const isTry = (typeId: number) => typeId === 1

      const tryAmount = isTry(sourceTypeId)
        ? srcAmount
        : srcAmount * (sourceRate > 0 ? sourceRate : 0)

      if (newRow.counterpartyType === 'bank') {
        const tBank = (counterpartyBanks ?? []).find((x) => String(x.id) === newRow.counterpartyCode)
        const tTypeId = normalizeCurrencyTypeId(Number(tBank?.currencyTypeId ?? 0) || 0)

        /*
          HEDEF TUTAR ↔ HEDEF KUR İKİ YÖNLÜ (2026-09-02 kullanıcı isteği).

          Hedef banka tutarı salt okunurdu: yalnız `tryAmount / kur` ile yazılıyordu.
          Kullanıcı çoğu zaman kuru değil KARŞI BANKAYA GEÇEN TUTARI biliyor (dekonttaki
          rakam) ve onu yazıp kurun kendiliğinden çıkmasını istiyor.

          Gönderilen tutar (`amount`) SABİT çapadır; ikisinden hangisi elle yazıldıysa
          diğeri ondan türer:
            kur yazıldıysa   → hedef tutar = TL karşılığı / kur
            tutar yazıldıysa → kur         = TL karşılığı / hedef tutar

          `hedefTutarElle` yalnızca o tuş vuruşunun geldiği yamada bulunur; satırda
          saklanmaz. Saklansaydı sonraki her değişiklikte de tutar sabit sanılır, kur
          durmadan yeniden hesaplanırdı.
        */
        const hedefTutarElleGirildi = Object.prototype.hasOwnProperty.call(patch ?? {}, 'currencyAmount')

        if (hedefTutarElleGirildi && !isTry(tTypeId)) {
          const hedefTutar = parseFormattedAmount(newRow.currencyAmount)
          // Sıfıra bölünmez; tutar boşaltıldığında kur son değerinde kalır.
          if (hedefTutar > 0 && tryAmount > 0) {
            newRow.targetCurrencyRate = formatCrossRate(tryAmount / hedefTutar)
          }
        } else {
          const tRate = isTry(tTypeId) ? 1 : (targetRate > 0 ? targetRate : 0)
          const targetAmt = isTry(tTypeId) ? tryAmount : (tRate > 0 ? (tryAmount / tRate) : 0)
          newRow.currencyAmount = formatMoney(targetAmt)
        }
      } else if (newRow.counterpartyType === 'cari') {
        const custAccRate = sourceRate > 0 ? sourceRate : 1
        newRow.currencyAmount = formatMoney(srcAmount * custAccRate)
      } else {
        newRow.currencyAmount = formatMoney(tryAmount)
      }

      // 2. Recalculate POS Fee TRY amount
      const pf = parseFormattedAmount(newRow.posFee)
      const feeTypeId = normalizeCurrencyTypeId(Number(newRow.posFeeCurrencyTypeId) || 0)
      if (isTry(feeTypeId)) {
        newRow.posFeeTryAmount = pf
      } else {
        const r = parseRate(newRow.posFeeCurrencyRate)
        newRow.posFeeTryAmount = (r > 0) ? pf * r : 0
      }

      next[index] = newRow
      return next
    })
  }

  const fetchRatesForForm = async (index: number, formOverride?: any) => {
    const row = { ...((createForms ?? [])[index] as any), ...(formOverride ?? {}) }
    if (!row) return

    const currTypeId = Number(row.currencyTypeId) || 1
    const cpType = row.counterpartyType
    const cpCode = row.counterpartyCode
    const custAccCur = Number(row.customerAccountCurrencyTypeId) || 1

    if (cpType === 'cari') {
      // KUR DAİMA "1 döviz = X ₺" (2026-08-19). Burada ÇAPRAZ kur çekiliyordu
      // (1 £ = 1,17 €) ve aynı alan hem `currencyRate` hem `tenderRate` olarak uca
      // gidiyordu; uç ise onu TL kuru sanıyor, TL çapasını 58 kat küçültüyordu.
      // Kasa kardeşiyle aynı düzeltme — gerekçe `CashAccountTransactionsController`ta.
      const tenderCode = currencyCodeByTypeId(currTypeId)

      updateCreateRow(index, { currencyRateLoading: true, ...(formOverride ?? {}) })
      try {
        if (tenderCode === 'TRY') {
          updateCreateRow(index, { currencyRate: '1', currencyRateTouched: false })
        } else {
          const rate = await fetchLatestFxRate(tenderCode)
          updateCreateRow(index, { currencyRate: formatCrossRate(rate), currencyRateTouched: false })
        }
      } catch {
        updateCreateRow(index, { currencyRate: '1', currencyRateTouched: false })
      } finally {
        updateCreateRow(index, { currencyRateLoading: false })
      }
    } else {
      // 1. Fetch Source Currency Rate
      if (currTypeId !== 1 && currTypeId !== 0) {
        const code = currTypeId === 2 ? 'EUR' : currTypeId === 3 ? 'USD' : currTypeId === 4 ? 'GBP' : ''
        if (code) {
          updateCreateRow(index, { currencyRateLoading: true, ...(formOverride ?? {}) })
          try {
            const rate = await fetchLatestFxRate(code)
            updateCreateRow(index, { currencyRate: formatCrossRate(rate), currencyRateTouched: false })
          } catch {
            // ignore
          } finally {
            updateCreateRow(index, { currencyRateLoading: false })
          }
        }
      } else {
        updateCreateRow(index, { currencyRate: '1', currencyRateTouched: false, ...(formOverride ?? {}) })
      }
    }

    // 2. Fetch POS Fee Currency Rate
    const feeTypeId = Number(row.posFeeCurrencyTypeId) || 0
    if (feeTypeId !== 1 && feeTypeId !== 0) {
      const code = feeTypeId === 2 ? 'EUR' : feeTypeId === 3 ? 'USD' : feeTypeId === 4 ? 'GBP' : ''
      if (code) {
        updateCreateRow(index, { posFeeCurrencyRateLoading: true })
        try {
          const rate = await fetchLatestFxRate(code)
          updateCreateRow(index, { posFeeCurrencyRate: formatCrossRate(rate) })
        } catch {
          // ignore
        } finally {
          updateCreateRow(index, { posFeeCurrencyRateLoading: false })
        }
      }
    } else {
      updateCreateRow(index, { posFeeCurrencyRate: '1' })
    }

    // 3. Fetch Target Bank Currency Rate
    if (cpType === 'bank' && cpCode) {
      const tBank = (counterpartyBanks ?? []).find((x) => String(x.id) === cpCode)
      const tTypeId = normalizeCurrencyTypeId(Number(tBank?.currencyTypeId ?? 0) || 0)
      if (tTypeId !== 1 && tTypeId !== 0) {
        const code = tTypeId === 2 ? 'EUR' : tTypeId === 3 ? 'USD' : tTypeId === 4 ? 'GBP' : ''
        if (code) {
          updateCreateRow(index, { targetCurrencyRateLoading: true })
          try {
            const rate = await fetchLatestFxRate(code)
            updateCreateRow(index, { targetCurrencyRate: formatCrossRate(rate) })
          } catch {
            // ignore
          } finally {
            updateCreateRow(index, { targetCurrencyRateLoading: false })
          }
        }
      } else {
        updateCreateRow(index, { targetCurrencyRate: '1' })
      }
    } else {
      updateCreateRow(index, { targetCurrencyRate: '1' })
    }
  }

  const handleCurrencyTypeChangeForForm = (index: number, typeId: string) => {
    const patch = { 
      currencyTypeId: typeId,
      posFeeCurrencyTypeId: typeId 
    }
    updateCreateRow(index, patch)
    void fetchRatesForForm(index, patch)
  }

  const handlePosFeeCurrencyTypeChange = (index: number, feeTypeId: string) => {
    const patch = { posFeeCurrencyTypeId: feeTypeId }
    updateCreateRow(index, patch)
    void fetchRatesForForm(index, patch)
  }

  const handleCounterpartyTypeChangeForForm = (index: number, val: 'bank' | 'cari' | 'supplier') => {
    const patch = { 
      counterpartyType: val,
      counterpartyCode: '',
      direction: 'out' as const
    }
    updateCreateRow(index, patch)
    void fetchRatesForForm(index, patch)
  }

  const handleCounterpartyCodeChangeForForm = (index: number, val: string) => {
    /*
      HESAP TİPİ SEÇİLEN KODDAN TÜRETİLİR (2026-08-31).

      Arama artık müşteri ve tedarikçiyi birlikte gösteriyor. Tip elle seçili kalsaydı,
      kullanıcı 'Cari' modundayken bir tedarikçi seçtiğinde hareket `Customer` damgalanır
      ve tutar TEDARİKÇİ DEFTERİNE HİÇ İŞLENMEZDİ — para sessizce yanlış deftere giderdi.

      Kod ön eki tipi kesin olarak söylüyor: 320 ile başlayan tedarikçi, diğerleri cari.
      Bu yüzden tahmin değil, kuraldır.
    */
    const kod = String(val ?? '').trim()
    const tip: 'cari' | 'supplier' = kod.startsWith('320') ? 'supplier' : 'cari'

    const patch = { counterpartyCode: val, counterpartyType: tip }
    updateCreateRow(index, patch as any)
    void fetchRatesForForm(index, patch as any)
  }

  /**
   * KARSI BANKA secimi. Yalnizca kodu yazar, TIPI DEGISTIRMEZ.
   *
   * Banka secicisi de `handleCounterpartyCodeChangeForForm`i cagiriyordu; o fonksiyon tipi
   * kodun onekinden turetiyor ve banka secicisinden gelen deger bir cari kodu degil, banka
   * KIMLIGI ("12" gibi). Kimlik "320" ile baslamadigi icin tip 'cari' yapiliyor, kullanici
   * Banka'yi secip listeden birine tikladigi anda ekran Cari moduna atliyordu -- banka hic
   * secilemiyordu. Onek kurali cari/tedarikci ayrimi icindir, bankaya uygulanamaz.
   */
  const handleCounterpartyBankChangeForForm = (index: number, val: string) => {
    const patch = { counterpartyCode: val, counterpartyType: 'bank' as const }
    updateCreateRow(index, patch as any)
    void fetchRatesForForm(index, patch as any)
  }

  const openNewTransaction = () => {
    setOpen(true)
    const initialForm = getEmptyCreateForm()
    setCreateForms([initialForm])

    // Karsi hesap listeleri burada yuklenir (bkz. ensureLookupsLoaded).
    void ensureLookupsLoaded()

    // Fetch initial rates
    void fetchRatesForForm(0, initialForm)
  }

  const submit = async () => {
    const forms = (createForms ?? []).filter((f) => f)
    if (!forms.length) {
      showPopup('error', 'Hata', 'Kayıt bulunamadı')
      return
    }

    try {
      // Validate all forms first
      const validatedPayloads = forms.map((f, index) => {
        const bankId = Number(f.selectedBankAccountId)
        if (!bankId) {
          throw new Error(`Satır ${index + 1}: Banka hesabı seçiniz`)
        }

        const a = parseFormattedAmount(f.amount)
        const r = parseRate(f.currencyRate)
        const ca = parseFormattedAmount(f.currencyAmount)
        const pf = parseFormattedAmount(f.posFee)

        if (!f.txDate) {
          throw new Error(`Satır ${index + 1}: Tarih zorunlu`)
        }
        if (!f.counterpartyCode.trim()) {
          throw new Error(`Satır ${index + 1}: Karşı hesap seçiniz`)
        }
        if (!(a > 0)) {
          throw new Error(`Satır ${index + 1}: Tutar zorunlu`)
        }

        const dir: BankAccountTransactionDirection = f.direction === 'in' ? 1 : 2
        const cpType: BankAccountTransactionCounterpartyType = f.counterpartyType === 'cari' ? 1 : f.counterpartyType === 'supplier' ? 3 : 2

        const selectedCounterpartyName = (() => {
          const v = f.counterpartyCode.trim()
          if (f.counterpartyType === 'cari') {
            const c = (customers ?? []).find((x: any) => String(x.code ?? x.customerCode ?? '').trim() === v)
            return String(c?.name ?? '')
          }
          if (f.counterpartyType === 'supplier') {
            const s = (suppliers ?? []).find((x: any) => String(x.supplierCode ?? '').trim() === v)
            return String(s?.fullName ?? '')
          }
          const id = Number(v)
          const b = (counterpartyBanks ?? []).find((x) => Number(x.id) === id)
          return String(b?.accountName ?? '')
        })()

        const cTypeId = Number(f.currencyTypeId) || 1
        const sourceAmount = Number.isFinite(a) ? a : 0
        const sourceTryRate = (cTypeId === 1 || cTypeId === 0) ? 1 : (Number.isFinite(r) && r > 0 ? r : 0)
        const tryAmount = (cTypeId === 1 || cTypeId === 0) ? sourceAmount : (sourceTryRate > 0 ? sourceAmount * sourceTryRate : 0)

        const tBank = (counterpartyBanks ?? []).find((x) => String(x.id) === f.counterpartyCode)
        const tCurrencyTypeId = normalizeCurrencyTypeId(Number(tBank?.currencyTypeId ?? 0) || 0)
        const tRateParsed = parseRate(f.targetCurrencyRate)
        const tTryRate = (tCurrencyTypeId === 1 || tCurrencyTypeId === 0) ? 1 : (Number.isFinite(tRateParsed) && tRateParsed > 0 ? tRateParsed : 0)

        return {
          bankId,
          txDate: f.txDate,
          counterpartyType: f.counterpartyType,
          counterpartyCode: f.counterpartyCode.trim(),
          // Paranın işleneceği cari hesap: ekrandan seçilen (varsayılan TL). Uç bunu yalnızca
          // HEDEF DAMGASI olarak kullanır, tutarı çevirmez.
          customerAccountCurrencyTypeId: Number(f.customerAccountCurrencyTypeId) || 1,
          selectedCounterpartyName,
          direction: f.direction,
          dir,
          cpType,
          cTypeId,
          sourceAmount,
          sourceTryRate,
          tryAmount,
          tCurrencyTypeId,
          tTryRate,
          description: f.description.trim() ? f.description.trim() : null,
          posFeeTryAmount: Number.isFinite(Number(f.posFeeTryAmount)) && Number(f.posFeeTryAmount) > 0
            ? Number(f.posFeeTryAmount)
            : 0,
          posFeeDescription: Number.isFinite(pf) && pf > 0 && f.posFeeDescription.trim() ? f.posFeeDescription.trim() : undefined,
          posFeeBsmvRate: parseRate(f.posFeeBsmvRate) > 0 ? parseRate(f.posFeeBsmvRate) : undefined,
          posFeeVatRate: parseRate(f.posFeeVatRate) > 0 ? parseRate(f.posFeeVatRate) : undefined,
          ca,
          pf,
          currencyRate: r
        }
      })

      // Execute sequential saves
      setSaving(true)
      for (const payload of validatedPayloads) {
        if (payload.counterpartyType === 'bank') {
          const targetId = Number(payload.counterpartyCode)
          await createBankAccountTransfer({
            sourceBankAccountDefinitionId: payload.direction === 'in' ? targetId : payload.bankId,
            targetBankAccountDefinitionId: payload.direction === 'in' ? payload.bankId : targetId,
            date: payload.txDate,
            amount: payload.direction === 'in' ? (Number.isFinite(payload.ca) ? payload.ca : 0) : payload.sourceAmount,
            description: payload.description,
            sourceCurrencyRate: payload.direction === 'in' ? ((payload.tCurrencyTypeId === 1 || payload.tCurrencyTypeId === 0) ? 1 : payload.tTryRate) : ((payload.cTypeId === 1 || payload.cTypeId === 0) ? 1 : payload.sourceTryRate),
            targetCurrencyRate: payload.direction === 'in' ? ((payload.cTypeId === 1 || payload.cTypeId === 0) ? 1 : payload.sourceTryRate) : ((payload.tCurrencyTypeId === 1 || payload.tCurrencyTypeId === 0) ? 1 : payload.tTryRate),
            posFee: payload.posFeeTryAmount,
            posFeeDescription: payload.posFeeDescription,
            posFeeBsmvRate: payload.posFeeBsmvRate,
            posFeeVatRate: payload.posFeeVatRate
          })
        } else {
          await createBankAccountTransaction({
            bankAccountDefinitionId: payload.bankId,
            date: payload.txDate,
            direction: payload.dir,
            amount: payload.tryAmount,
            currencyTypeId: payload.cTypeId,
            currencyRate: (payload.cTypeId === 1 || payload.cTypeId === 0) ? 1 : payload.sourceTryRate,
            currencyAmount: payload.sourceAmount,
            tenderCurrencyTypeId: payload.cTypeId,
            // TL kuru gönderilir (çapraz kur DEĞİL); uç bunu "1 döviz = X ₺" olarak okur.
            tenderRate: payload.sourceTryRate > 0 ? payload.sourceTryRate : 1,
            tenderAmount: payload.sourceAmount,
            customerAccountCurrencyTypeId: payload.customerAccountCurrencyTypeId,
            counterpartyType: payload.cpType,
            counterpartyCode: payload.counterpartyCode,
            counterpartyName: payload.selectedCounterpartyName,
            description: payload.description,
            posFee: payload.posFeeTryAmount,
            posFeeDescription: payload.posFeeDescription,
            posFeeBsmvRate: payload.posFeeBsmvRate,
            posFeeVatRate: payload.posFeeVatRate
          })
        }
      }

      showPopup('success', 'Başarılı', `${validatedPayloads.length} kayıt başarıyla oluşturuldu`)
      setOpen(false)
      const primaryBankId = Number(selectedBankId)
      if (primaryBankId) {
        await reloadBalance(primaryBankId)
        await reloadList(primaryBankId)
      }
    } catch (e: any) {
      showPopup('error', 'Hata', String(e?.message ?? 'İşlem başarısız'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-4">
      <NotificationPopup isOpen={popupOpen} variant={popupVariant} title={popupTitle} message={popupMessage} onClose={() => setPopupOpen(false)} />

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
        <div className="text-sm text-gray-700">Bu kaydı silmek istediğinize emin misiniz?</div>
      </Modal>

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
                <div className="mt-1 font-semibold text-gray-900">{String((customerModalData as any)?.customerType ?? '') || '-'}</div>
              </div>
              <div className="bg-gray-50 border border-gray-200 rounded p-3">
                <div className="text-[11px] font-semibold text-gray-500">Fatura Tipi</div>
                <div className="mt-1 font-semibold text-gray-900">{String((customerModalData as any)?.invoiceType ?? '') || '-'}</div>
              </div>
              <div className="bg-gray-50 border border-gray-200 rounded p-3">
                <div className="text-[11px] font-semibold text-gray-500">Telefon</div>
                <div className="mt-1 font-semibold text-gray-900">{String((customerModalData as any)?.phone ?? '') || '-'}</div>
              </div>
              <div className="bg-gray-50 border border-gray-200 rounded p-3">
                <div className="text-[11px] font-semibold text-gray-500">E-posta</div>
                <div className="mt-1 font-semibold text-gray-900">{String((customerModalData as any)?.email ?? '') || '-'}</div>
              </div>
              <div className="bg-gray-50 border border-gray-200 rounded p-3 md:col-span-2">
                <div className="text-[11px] font-semibold text-gray-500">Adres</div>
                <div className="mt-1 font-semibold text-gray-900 whitespace-pre-line">{String((customerModalData as any)?.address ?? '') || '-'}</div>
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
                <div className="mt-1 font-extrabold text-gray-900">{(invoiceModalHeader as any)?.faturaNo || '-'}</div>
              </div>
              <div className="bg-gray-50 border border-gray-200 rounded p-3">
                <div className="text-[11px] font-semibold text-gray-500">Cari Kodu</div>
                <div className="mt-1 font-semibold text-gray-900">{(invoiceModalHeader as any)?.cariKodu || '-'}</div>
              </div>
              <div className="bg-gray-50 border border-gray-200 rounded p-3">
                <div className="text-[11px] font-semibold text-gray-500">Açıklama</div>
                <div className="mt-1 font-semibold text-gray-900">{String((invoiceModalHeader as any)?.faturaAcik ?? '') || '-'}</div>
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
                  <div key={String((ln as any)?.id)} className="grid grid-cols-12 px-3 py-2 text-[11px] bg-white">
                    <div className="col-span-5 font-semibold text-gray-900 truncate" title={`${String((ln as any)?.stockCode ?? '')} ${String((ln as any)?.stockName ?? '')}`.trim()}>
                      {`[${String((ln as any)?.stockCode ?? '')}] ${String((ln as any)?.stockName ?? '')}`.trim()}
                    </div>
                    <div className="col-span-3 text-gray-700 truncate" title={String((ln as any)?.description ?? '')}>{String((ln as any)?.description ?? '')}</div>
                    <div className="col-span-1 text-right text-gray-800 font-semibold">{Number((ln as any)?.quantity ?? 0)}</div>
                    <div className="col-span-1 text-right text-gray-800 font-semibold">{formatMoney(Number((ln as any)?.unitPrice ?? 0))}</div>
                    <div className="col-span-2 text-right text-gray-900 font-extrabold">{formatMoney(Number((ln as any)?.total ?? 0))}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="p-2 text-sm text-gray-500">Kayıt yok.</div>
        )}
      </Modal>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-gray-900 tracking-tight">Banka Havale/Virman/EFT</h1>
          <p className="text-xs text-gray-400 mt-0.5">Banka İşlemleri / Banka Havale/EFT</p>
        </div>
        <button
          type="button"
          onClick={openNewTransaction}
          disabled={!selectedBankId}
          title={!selectedBankId ? 'Önce hesap türü ve hesap seçiniz' : undefined}
          className="h-[34px] inline-flex items-center gap-1.5 px-4 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition disabled:bg-gray-300 disabled:cursor-not-allowed disabled:hover:bg-gray-300"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Yeni Transfer
        </button>
      </div>

      <div className="bg-white border border-gray-100 rounded-xl shadow-sm p-4 mb-4">
        <div className="flex items-center gap-3">
          {/*
            SIRA: KUR -> HESAP TURU -> HESAP (2026-08-23 kullanici karari).
            Kasa ekranindaki duzenin ayni. Kur en basta ve HER ZAMAN acik (varsayilan TL);
            sonraki iki kutu ona gore suzuluyor.
          */}
          <select
            className="h-[34px] w-36 px-3 text-xs border border-gray-200 rounded-lg bg-white focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition"
            value={selectedCurrencyTypeIdState}
            onChange={(e) => {
              // Elle secim: beklenen doviz de ayni anda guncellenir (bkz. `pendingCurrencyRef`).
              pendingCurrencyRef.current = normalizeCurrencyTypeId(Number(e.target.value))
              setSelectedCurrencyTypeIdState(e.target.value)
              // Kur degisince tur ve hesap DUSER: ikisi de artik baska bir para birimine ait
              // olabilir. Dusurulmezse liste bir hesabi, baslik baska kuru gosterirdi.
              setSelectedAccountType('')
              setSelectedBankAccountId('')
            }}
          >
            {[
              // TL degeri '1' — '0' DEGIL. Durumun baslangici '1' ve `normalizeCurrencyTypeId`
              // 0'i 1'e ceviriyor; secenek '0' kaldiginda select hicbir secenekle eslesmiyor,
              // ekranda ilk secenek gorunuyor ama deger bambaska oluyordu.
              { value: '1', label: 'TL (TRY)' },
              { value: '2', label: 'EUR' },
              { value: '3', label: 'USD' },
              { value: '4', label: 'GBP' }
            ].map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>

          <div className="w-56">
            <FormSearchableSelect
              value={selectedAccountType}
              onChange={(e) => {
                const v = String(e.target.value)
                setSelectedAccountType(v)
                // Tur degisince hesap secimi DUSER: onceki hesap yeni ture ait olmayabilir ve
                // kalirsa liste bir hesabi, baslik baska turu gosterir.
                setSelectedBankAccountId('')
              }}
              options={accountTypeOptions}
              placeholder="Hesap Türü Seçiniz..."
            />
          </div>

          <div className="w-80">
            <FormSearchableSelect
              value={selectedBankAccountId}
              onChange={(e) => setSelectedBankAccountId(String(e.target.value))}
              options={bankOptions}
              disabled={!selectedAccountType}
              placeholder={selectedAccountType ? 'Hesap Seçiniz...' : 'Önce hesap türü seçiniz'}
            />
          </div>

          <div className="h-[34px] flex-1 inline-flex items-center justify-end px-3 rounded-lg border border-gray-200 bg-gray-50 text-xs text-gray-700 gap-2 overflow-x-auto">
            <span className="font-semibold mr-2 whitespace-nowrap">Bakiye:</span>
            {selectedBankAccountId ? (
              balanceLoading ? (
                <span className="text-gray-500">Yükleniyor...</span>
              ) : (
                <>
                  <span className="font-semibold whitespace-nowrap">
                    {formatMoney(Number(balance ?? 0))} {currencySymbol} ({currencyCode})
                  </span>
                  {(multiCurrencyBalances ?? []).length > 0 ? (
                    <span className="inline-flex items-center gap-2 ml-2">
                      {multiCurrencyBalances
                        .filter((x) => Number(x.balance ?? 0) !== 0 && normalizeCurrencyTypeId(Number(x.currencyTypeId ?? 0)) !== selectedCurrencyTypeId)
                        .map((x) => {
                          const code = currencyCodeByTypeId(Number(x.currencyTypeId ?? 0))
                          const sym = currencySymbolByCode(code)
                          return (
                            <span key={String(x.currencyTypeId)} className="inline-flex items-center px-2 h-[22px] rounded-md border border-gray-200 bg-white text-[11px] whitespace-nowrap">
                              {formatMoney(Number(x.balance ?? 0))} {sym}
                            </span>
                          )
                        })}
                    </span>
                  ) : null}
                </>
              )
            ) : (
              <span className="text-gray-500">{selectedAccountType ? 'Hesap seçiniz' : 'Önce hesap türü seçiniz'}</span>
            )}
          </div>
        </div>
      </div>

      <AppDataTable
        onRefresh={() => void reloadBanks()}
        data={items}
        columns={bankColumns}
        rowId={(row) => (row.isOpeningBalance ? 'devir-bakiyesi' : String(row.id))}
        rowActions={getRowActions}
        states={{
          loading,
          emptyTitle: selectedBankId ? 'Kayıt bulunamadı' : 'Hesap seçilmedi',
          emptyDescription: selectedAccountType
            ? (selectedBankId ? undefined : 'Hareketleri görmek için bir hesap seçiniz.')
            : 'Önce hesap türünü, ardından hesabı seçiniz.'
        }}
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

      {/* Modal for new Havale/EFT */}
      <Modal
        isOpen={open}
        onClose={() => {
          if (saving) return
          setOpen(false)
        }}
        title="Eft"
        footer={
          <>
            <button
              type="button"
              disabled={saving}
              className="h-[34px] inline-flex items-center gap-1.5 px-4 text-xs font-semibold rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 transition"
              onClick={addCreateRow}
            >
              Satır Ekle
            </button>
            <button
              type="button"
              disabled={saving}
              className="h-[34px] inline-flex items-center gap-1.5 px-4 text-xs font-semibold rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 transition"
              onClick={() => setOpen(false)}
            >
              Vazgeç
            </button>
            <button
              type="button"
              disabled={saving}
              className="h-[34px] inline-flex items-center gap-1.5 px-4 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition"
              onClick={() => void submit()}
            >
              Kaydet
            </button>
          </>
        }
      >
        <div className="space-y-6">
          {(createForms ?? []).map((form, idx) => {
            const accCode = currencyCodeByTypeId(normalizeCurrencyTypeId(Number(form.currencyTypeId) || 0))
            const accSymbol = currencySymbolByCode(accCode)
            const feeCode = currencyCodeByTypeId(Number(form.posFeeCurrencyTypeId) || 0)
            const feeSymbol = currencySymbolByCode(feeCode)
            const counterpartOptions = getCounterpartyOptions(form)
            const formBankDef = (bankAccounts ?? []).find((x) => String(x.id) === form.selectedBankAccountId)
            const formTargetBank = form.counterpartyType === 'bank' ? (counterpartyBanks ?? []).find((x) => String(x.id) === form.counterpartyCode) : null
            const formTargetCurrencyTypeId = normalizeCurrencyTypeId(Number(formTargetBank?.currencyTypeId ?? 0) || 0)

            return (
              <div key={idx} className="border border-gray-100 rounded-xl p-4 bg-white shadow-sm relative">
                <div className="flex items-center justify-between mb-4 pb-2 border-b border-gray-100">
                  <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">
                    Kayıt #{idx + 1}
                  </span>
                  {createForms.length > 1 && (
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => removeCreateRow(idx)}
                      className="text-[11px] font-semibold text-red-600 hover:text-red-700 bg-red-50 hover:bg-red-100 px-2.5 py-1 rounded transition-colors"
                    >
                      Kayıt Sil
                    </button>
                  )}
                </div>

                <div className="space-y-4">
                  {/* Tarih ile hesap YAN YANA (kullanıcı kararı 2026-08-22): ikisi de kaydın
                      kimliği, alt alta durunca form gereksiz uzuyordu. */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormInput
                      label="Tarih"
                      requiredMark
                      type="date"
                      value={form.txDate}
                      onChange={(e) => updateCreateRow(idx, { txDate: e.target.value })}
                    />
                    {/*
                      HESAP KILITLI (kullanici karari 2026-08-22). Kayit, ustte secili hesabin
                      uzerine yazilir; modal icinden baska bir hesaba gecilemez. Once bu alan
                      serbestti ve liste bir hesabi gosterirken kayit baska hesaba dusebiliyordu.
                      Deger yine `form.selectedBankAccountId`de duruyor (submit oradan okuyor),
                      yalnizca degistirme yolu kapatildi.
                    */}
                    <FormInput
                      label="Hesap"
                      requiredMark
                      readOnly
                      disabled
                      value={selectedBankLabel}
                      hint="Hesap üstteki seçimden gelir ve bu ekranda değiştirilemez."
                    />
                  </div>
                  {/*
                    TEDARIKCI AYRI BIR TIP DEGIL (2026-09-01 kullanici duzeltmesi:
                    "tedarikci diye bir ayrim yapmana gerek yoktu").

                    Kullanicidan tip secmesini istemek gereksizdi: tip zaten secilen KODUN
                    onekinden kesin olarak turetiliyor (320 -> tedarikci, digerleri cari,
                    bkz. handleCounterpartyCodeChangeForForm). Ustelik ayrim listeyi
                    daraltip aranan cariyi gizliyordu. Geriye iki secenek kaldi: karsi taraf
                    bir CARI mi yoksa baska bir BANKA hesabi mi.

                    Icerideki 'supplier' degeri KORUNUYOR - kayit sirasinda hareketin hangi
                    deftere yazilacagini o belirliyor; yalnizca ekranda gosterilmiyor.
                  */}
                  <FormSelect
                    label="Hesap Tipi"
                    requiredMark
                    value={form.counterpartyType === 'bank' ? 'bank' : 'cari'}
                    onChange={(e) => handleCounterpartyTypeChangeForForm(idx, e.target.value as any)}
                    options={[
                      { value: 'cari', label: 'Cari' },
                      { value: 'bank', label: 'Banka' }
                    ]}
                  />
                  {form.counterpartyType === 'bank' ? (
                    <FormSearchableSelect
                      label="Karşı Banka"
                      requiredMark
                      value={form.counterpartyCode}
                      onChange={(e) => handleCounterpartyBankChangeForForm(idx, e.target.value)}
                      options={counterpartOptions}
                      placeholder="Karşı Banka Ara (Kod veya Ad)..."
                    />
                  ) : (
                    <div className="space-y-2">
                      <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide">
                        Cari Seçimi <span className="text-red-500">*</span>
                      </label>
                      {/*
                        Zengin secici (telefon, kod rozeti) + SUNUCU ARAMASI. Banka hesabi
                        listesi kucuk oldugu icin o dal eski kutuda birakildi.
                      */}
                      <SearchableCariSelect
                        value={String(form.counterpartyCode ?? '')}
                        onChange={(v) => handleCounterpartyCodeChangeForForm(idx, v)}
                        options={counterpartOptions as any}
                        remoteSearch={counterpartyRemoteSearch}
                        remoteLimit={CARI_SEARCH_LIMIT}
                        placeholder="Karşı Hesap Ara (Kod, İsim, Telefon)..."
                      />
                    </div>
                  )}

                  {/* CARİ HESABI SEÇİCİSİ — kasa ekranıyla AYNI kural.
                      Tutar, seçilen hesabın para birimine TL ÇAPASINDAN çevrilir; çapraz kur yok. */}
                  {form.counterpartyType === 'cari' && (
                    <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
                      <div className="flex items-center justify-between mb-2 gap-3">
                        <label className="block text-xs font-bold text-slate-800">
                          Cari Hesabı (Paranın İşleneceği Hesap) <span className="text-red-500">*</span>
                        </label>
                        <span className="text-[11px] text-slate-500 font-medium">
                          Varsayılan TL hesabı — banka hesabının dövizinden bağımsız
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
                        Ödeme {accCode} olarak alınır; ekstreye seçilen hesabın para biriminde,
                        TL karşılığı üzerinden güncel kurla işlenir.
                      </p>
                    </div>
                  )}

                  <FormSelect
                    label="İşlem Tipi"
                    requiredMark
                    value={form.direction}
                    onChange={(e) => updateCreateRow(idx, { direction: String(e.target.value) === 'in' ? 'in' : 'out' })}
                    disabled={form.counterpartyType === 'bank'}
                    options={[
                      { value: 'in', label: 'Giriş (Tahsilat / Havale Alma)' },
                      { value: 'out', label: 'Çıkış (Ödeme / Havale Gönderme)' }
                    ]}
                  />
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormInput
                      label={`Tutar (${accSymbol})`}
                      requiredMark
                      value={form.amount}
                      onChange={(e) => updateCreateRow(idx, { amount: handleCurrencyInputChange(e.target.value) })}
                      onBlur={() => {
                        const num = parseFormattedAmount(form.amount)
                        updateCreateRow(idx, { amount: formatMoney(num) })
                      }}
                    />
                    <FormSelect
                      label="Banka / İşlem Para Birimi (Hesaba Göre Sabittir)"
                      requiredMark
                      value={form.currencyTypeId}
                      onChange={(e) => handleCurrencyTypeChangeForForm(idx, e.target.value)}
                      disabled={true}
                      options={currencyOptions}
                    />
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="block text-xs font-bold text-slate-700">
                          {form.counterpartyType === 'cari'
                            ? `Kur (1 ${accCode} = X ₺)`
                            : `Döviz Kuru (${accCode})`} <span className="text-red-500">*</span>
                        </label>
                        <button
                          type="button"
                          onClick={() => void fetchRatesForForm(idx)}
                          disabled={form.currencyRateLoading}
                          title="Güncel Kuru Çek"
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
                      />
                    </div>
                    {/*
                      Hedef banka tutarı YALNIZCA dövizli hedef hesapta yazılabilir: TL
                      hedefte tutar gönderilenin aynısıdır, elle değiştirilmesi anlamsız
                      (ve kur 1 olduğu için türetilecek bir şey de yok). Cari ve diğer
                      dallarda alan eskisi gibi salt okunur.
                    */}
                    <FormInput
                      label={form.counterpartyType === 'cari' ? 'Cari Hesaba İşlenecek Tutar' : form.counterpartyType === 'bank' ? `Hedef Banka Tutarı ${form.targetCurrencyRateLoading ? '(yükleniyor...)' : ''}` : 'TRY Karşılığı'}
                      requiredMark
                      value={form.currencyAmount}
                      disabled={!(form.counterpartyType === 'bank' && formTargetBank && !isTryTypeId(formTargetCurrencyTypeId))}
                      onChange={(e) => updateCreateRow(idx, { currencyAmount: handleCurrencyInputChange(e.target.value) })}
                      onBlur={() => {
                        if (!(form.counterpartyType === 'bank' && formTargetBank && !isTryTypeId(formTargetCurrencyTypeId))) return
                        updateCreateRow(idx, { currencyAmount: formatMoney(parseFormattedAmount(form.currencyAmount)) })
                      }}
                    />
                    {/*
                      HEDEF HESABIN KURU — çevrimi asıl belirleyen sayı
                    */}
                    {form.counterpartyType === 'bank' && formTargetBank && !isTryTypeId(formTargetCurrencyTypeId) ? (
                      <FormInput
                        label={`Hedef Hesap Döviz Kuru (${currencyCodeByTypeId(formTargetCurrencyTypeId)}) ${form.targetCurrencyRateLoading ? '(yükleniyor...)' : ''}`}
                        requiredMark
                        value={form.targetCurrencyRate}
                        onChange={(e) => updateCreateRow(idx, { targetCurrencyRate: e.target.value })}
                      />
                    ) : null}

                    {/* CARİ İŞLEM ÖNİZLEME KARTI */}
                    {form.counterpartyType === 'cari' && (
                      <div className="md:col-span-2 p-3.5 bg-gradient-to-br from-slate-50 to-blue-50/50 border border-blue-200/80 rounded-xl text-xs space-y-2 text-slate-800 shadow-sm">
                        <div className="font-bold flex items-center justify-between border-b border-blue-200/60 pb-1.5 text-slate-900">
                          <span className="flex items-center gap-1.5 text-xs font-black">
                            <span>ℹ️</span> İşlem & Cari Hesap Önizlemesi
                          </span>
                          <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-blue-100 text-blue-800">
                            {form.direction === 'in' ? 'Tahsilat (Giriş)' : 'Ödeme (Çıkış)'}
                          </span>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                          <div className="flex justify-between items-center py-0.5">
                            <span className="text-slate-500">Banka Ödeme Tutarı:</span>
                            <span className="font-bold text-slate-900">{formatMoney(parseFormattedAmount(form.amount))} {accCode}</span>
                          </div>
                          <div className="flex justify-between items-center py-0.5">
                            <span className="text-slate-500">Banka Hesabı:</span>
                            <span className="font-bold text-slate-900">{formBankDef?.accountName || 'Banka'} ({accCode})</span>
                          </div>
                          <div className="flex justify-between items-center py-0.5">
                            <span className="text-slate-500">Cari Hesabı:</span>
                            <span className="font-bold text-blue-700">
                              {form.counterpartyCode ? (customers.find(c => String(c.customerCode) === form.counterpartyCode)?.name || form.counterpartyCode) : 'Cari'} · {accCode} olarak işlenir
                            </span>
                          </div>
                          <div className="flex justify-between items-center py-0.5">
                            <span className="text-slate-500">Kur:</span>
                            <span className="font-bold text-slate-800">1 {accCode} = {form.currencyRate} ₺</span>
                          </div>
                        </div>

                        <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-2.5 flex items-center justify-between text-emerald-900 font-bold">
                          <div className="flex items-center gap-1.5">
                            <span>✨</span>
                            <span>Cari Hesaba İşlenecek Tutar:</span>
                          </div>
                          <span className="text-sm font-black text-emerald-700">
                            {formatMoney(parseFormattedAmount(form.amount))} {accCode}
                          </span>
                        </div>
                      </div>
                    )}
                    {/*
                      POS MASRAFI TAM SATIRI KAPLAR (`md:col-span-2`).

                      Bu blok iki sütunlu ızgaranın TEK hücresindeydi, yani modalın yarısı.
                      Üç alanı o yarıya sığdırınca her biri ~90 px kalıyor ve etiketler iki
                      satıra kırılıyordu. Etiketler de kısaldı: "POS Masrafı" başlığı bir kez
                      yazılıyor, alanlar "Tutar / Para Birimi / Döviz Kuru" diyor — üç kez
                      "POS MASRAF" tekrarına gerek yok.
                    */}
                    <div className="md:col-span-2 space-y-1">
                      <div className="rounded-lg border border-gray-200 bg-gray-50/60 p-3 space-y-2.5">
                        {/*
                          Bu ekran Havale/EFT'tir; buradan girilen masraf da HAVALE/EFT
                          masrafıdır. Başlık "POS Masrafı" yazıyordu ve satır da öyle
                          damgalanıyordu — POS masraf hesabını şişiriyordu. Alan adları
                          (`posFee…`) tarihsel olarak öyle kaldı, anlamı bu başlıktır.
                        */}
                        <div className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">
                          Havale/EFT Masrafı
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                          <FormInput
                            label="Tutar"
                            value={form.posFee}
                            onChange={(e) => updateCreateRow(idx, { posFee: handleCurrencyInputChange(e.target.value) })}
                            onBlur={() => {
                              const num = parseFormattedAmount(form.posFee)
                              if (num > 0) updateCreateRow(idx, { posFee: formatMoney(num) })
                            }}
                          />
                          <FormSelect
                            label="Para Birimi"
                            value={form.posFeeCurrencyTypeId}
                            onChange={(e) => handlePosFeeCurrencyTypeChange(idx, String(e.target.value))}
                            options={currencyOptions}
                          />
                          <FormInput
                            label={`Döviz Kuru ${form.posFeeCurrencyRateLoading ? '(yükleniyor...)' : ''}`}
                            value={form.posFeeCurrencyRate}
                            onChange={(e) => updateCreateRow(idx, { posFeeCurrencyRate: e.target.value })}
                            // TL seçiliyken kur alanı kilitli olmalı. Koşul `=== 0` idi ve TL'nin
                            // değeri '1' olduğu için hiç tutmuyordu: TL'de de kur kutusu açık
                            // kalıyor, oraya girilen her sayı masrafı sessizce çarpıyordu.
                            disabled={isTryTypeId(Number(form.posFeeCurrencyTypeId))}
                          />
                        </div>
                      {parseFormattedAmount(form.posFee) > 0 ? (
                        <div className="text-[11px] text-gray-500">
                          {isTryTypeId(Number(form.posFeeCurrencyTypeId))
                            ? `POS masrafı: ${formatMoney(parseFormattedAmount(form.posFee))} ₺`
                            : `POS masrafı: ${formatMoney(parseFormattedAmount(form.posFee))} ${feeSymbol} ≈ ${formatMoney(form.posFeeTryAmount)} ₺`}
                        </div>
                      ) : null}
                      {/*
                        POS MASRAFINDA VERGİ AYRIŞTIRMASI (denetim md. A4).
                        Bankanın kestiği tutar tek kalem gider olarak yazılıyordu; içindeki
                        BSMV/KDV hiçbir yerde görünmüyordu. Oranların ikisi de elle girilir
                        (bankaya ve ürüne göre değişir, sabit oran varsaymak yanlış olurdu).
                        Boş bırakılırsa hiçbir şey değişmez.
                      */}
                      {parseFormattedAmount(form.posFee) > 0 && (
                        <div className="rounded-lg border border-gray-200 bg-gray-50 p-2 space-y-2">
                          <div className="text-[11px] font-semibold text-gray-600">
                            Vergi Ayrıştırması (isteğe bağlı) — girilen masraf brüttür, tutar değişmez
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                            <FormInput
                              label="BSMV Oranı (%)"
                              value={form.posFeeBsmvRate}
                              onChange={(e) => updateCreateRow(idx, { posFeeBsmvRate: e.target.value })}
                              placeholder="Örn: 5"
                            />
                            <FormInput
                              label="KDV Oranı (%)"
                              value={form.posFeeVatRate}
                              onChange={(e) => updateCreateRow(idx, { posFeeVatRate: e.target.value })}
                              placeholder="Örn: 20"
                            />
                          </div>
                          {(() => {
                            const brut = parseFormattedAmount(form.posFee)
                            const bsmvOran = parseRate(form.posFeeBsmvRate)
                            const kdvOran = parseRate(form.posFeeVatRate)
                            if (brut <= 0 || (bsmvOran <= 0 && kdvOran <= 0)) return null
                            // Dışarıdan içeri soyulur: önce KDV, sonra BSMV. Sunucudaki
                            // `PosFeeTaxBreakdown` ile birebir aynı sıra — iki taraf aynı
                            // rakamı göstersin diye burada da tekrarlanıyor.
                            const bsmvDahil = kdvOran > 0 ? brut / (1 + kdvOran / 100) : brut
                            const kdvTutar = brut - bsmvDahil
                            const net = bsmvOran > 0 ? bsmvDahil / (1 + bsmvOran / 100) : bsmvDahil
                            const bsmvTutar = bsmvDahil - net
                            return (
                              <div className="text-[11px] text-gray-600 space-y-0.5">
                                <div>Komisyon (net): <b>{formatMoney(net)}</b></div>
                                {bsmvOran > 0 && <div>BSMV (%{bsmvOran}): <b>{formatMoney(bsmvTutar)}</b></div>}
                                {kdvOran > 0 && <div>KDV (%{kdvOran}): <b>{formatMoney(kdvTutar)}</b></div>}
                                <div className="pt-0.5 border-t border-gray-200">Brüt (hesaptan düşen): <b>{formatMoney(brut)}</b></div>
                              </div>
                            )
                          })()}
                        </div>
                      )}
                      </div>
                    </div>
                  </div>
                  {parseFormattedAmount(form.posFee) > 0 && (
                    <FormInput
                      label="POS Masraf Açıklaması"
                      value={form.posFeeDescription}
                      onChange={(e) => updateCreateRow(idx, { posFeeDescription: e.target.value })}
                      placeholder="Örn: Visa işlem masrafı"
                    />
                  )}
                  <FormInput label="Açıklama" value={form.description} onChange={(e) => updateCreateRow(idx, { description: e.target.value })} />
                  {formBankDef ? <div className="text-[11px] text-gray-500">{formBankDef.accountCode} - {formBankDef.accountName}</div> : null}
                </div>
              </div>
            )
          })}
        </div>
      </Modal>
    </div>
  )
}

export default function BankPage() {
  useOutletContext<LayoutContext>()
  return <BankaHavaleEftView />
}
