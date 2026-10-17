import { useCallback, useEffect, useMemo, useState } from 'react'
import Table, { type TableColumn } from '../components/Table'
import { Landmark, Layers, Plus, RefreshCw, Trash2, TriangleAlert, Wallet } from 'lucide-react'

import Modal from '../components/Modal'
import FormInput from '../components/forms/FormInput'
import FormSelect from '../components/forms/FormSelect'
import NotificationPopup, { type NotificationVariant } from '../components/NotificationPopup'
import { fetchLatestFxRate } from '../api/fx'
import {
  BANK_EXPENSE_TYPE,
  createBankExpense,
  deleteBankExpense,
  fetchBankExpenseLoans,
  fetchBankExpenseOverview,
  fetchBankExpenses,
  type BankExpenseAccountDto,
  type BankExpenseBucketDto,
  type BankExpenseLoanDto,
  type BankExpenseRowDto
} from '../api/bankExpenses'

/**
 * BANKA MASRAFLARI — soldan banka seçilir, sağda o hesabın masrafları görünür.
 *
 * NEDEN YENİ SAYFA. Eski POS Masrafları ekranı bütün bankaların masrafını `amount`
 * (TL çapası) üzerinden topluyordu: dolar hesabın 10 $ masrafı ile TL hesabın 10 ₺ masrafı
 * aynı sütunda toplanıyordu, üstüne Havale/EFT yolunda masraf satırı sabit TL damgalandığı
 * için dövizli hesabın masrafı hiçbir ekranda görünmüyordu.
 *
 * KURAL. Masraf, ait olduğu hesabın PARA BİRİMİNDEDİR ve her para birimi kendi kovasında
 * yürür — farklı para birimleri tek toplama indirilmez. "Genel" görünümündeki TL karşılığı
 * ayrı bir sütundur, masrafın kendisi değildir.
 */

const GENEL = 0 as const

const CURRENCY_SYMBOLS: Record<string, string> = {
  TRY: '₺',
  USD: '$',
  EUR: '€',
  GBP: '£'
}

function sym(code?: string | null) {
  const c = String(code ?? 'TRY').toUpperCase()
  return CURRENCY_SYMBOLS[c] ?? c
}

function money(n: number | null | undefined) {
  const v = Number(n ?? 0)
  if (!Number.isFinite(v)) return '0,00'
  return new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v)
}

/** Tutarı KENDİ para birimiyle yazar — sembolsüz gösterim iki kovayı karıştırır. */
function amountWithCode(n: number | null | undefined, code?: string | null) {
  return `${money(n)} ${sym(code)}`
}

function shortDate(value?: string | null) {
  if (!value) return '-'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '-'
  return d.toLocaleDateString('tr-TR')
}

function toInputDate(d: Date) {
  return d.toISOString().slice(0, 10)
}

/** Varsayılan aralık: içinde bulunduğumuz ay — masraf takibi aylık yapılıyor. */
function monthRange() {
  const now = new Date()
  return {
    from: toInputDate(new Date(now.getFullYear(), now.getMonth(), 1)),
    to: toInputDate(new Date(now.getFullYear(), now.getMonth() + 1, 0))
  }
}

function parseAmount(text: string) {
  const t = String(text ?? '').trim().replace(/\./g, '').replace(',', '.')
  const n = Number(t)
  return Number.isFinite(n) ? n : 0
}

/**
 * KUR ALANI TÜRKÇE BİÇİMDE DOLDURULUR (2026-09-02).
 *
 * `parseAmount` bu ekranın her sayısını TÜRKÇE okur: nokta = binlik ayracı, virgül = ondalık.
 * Kur alanı ise `String(rate)` ile doldurulunca JS biçiminde geliyordu ("65.6846") ve
 * `parseAmount` noktayı binlik sanıp SİLİYORDU: 65,6846 yerine 656846 gidiyordu.
 *
 * Canlıda 5 "Kredi Kullanım Masrafı" satırı bu yüzden 10.000 kat şişti; toplam 6,5 MİLYAR TL
 * hayali gider yazıldı (banka bakiyeleri eksi milyarlarda görünüyordu). Kullanıcı kuru elle
 * virgüllü yazdığında sorun çıkmıyordu, o yüzden yalnız otomatik dolan satırlar bozuldu.
 *
 * Kurda 2 ondalık yetmez (48,1331 gibi dört haneli kurlar var), o yüzden `money` değil bu
 * kullanılıyor. Buraya asla `String(rate)` geri konmasın.
 */
function formatRate(n: number | null | undefined) {
  const v = Number(n ?? 0)
  if (!Number.isFinite(v) || v <= 0) return ''
  return new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 6 }).format(v)
}

/** Hiçbir para birimi 10.000 ₺ etmez; bu eşiğin üstü biçim hatasıdır (bkz. formatRate). */
const MAKUL_KUR_UST_SINIRI = 10000

/**
 * TUTAR ALANI BANKA EKRANIYLA AYNI DAVRANIR (2026-08-20).
 *
 * Burası ham `<input>` gibi çalışıyordu: yazılan "1500" bin beş yüz mü, on beş lira mı belli
 * değildi ve binlik ayracı hiç görünmüyordu. `BankPage`'teki kural tek satır: girilen rakamlar
 * KURUŞ'tur, yani yazım virgülün sağından başlar ve sola doğru kayar —
 *   1 -> 0,01   150 -> 1,50   1500 -> 15,00   150000 -> 1.500,00
 * Böylece kullanıcı iki ekranda aynı refleksle yazıyor; kuruş girmek için ayrıca virgül
 * aramak gerekmiyor. Okuma tarafı (`parseAmount`) biçimli metni zaten çözüyor.
 */
function handleCurrencyInputChange(val: string): string {
  if (!val || val.trim() === '') return '0,00'
  const rawDigits = val.replace(/[^\d]/g, '')
  if (!rawDigits) return '0,00'
  const cents = parseInt(rawDigits, 10)
  return money(cents / 100)
}

type CurrencyTotal = {
  currencyCode: string
  gross: number
  bsmv: number
  vat: number
  net: number
  tryAmount: number
  count: number
}

/** Kova listesini para birimi başına toplar; TL karşılığı ayrıca taşınır. */
function sumByCurrency(buckets: BankExpenseBucketDto[]): CurrencyTotal[] {
  const map = new Map<string, CurrencyTotal>()
  for (const b of buckets) {
    const key = b.currencyCode || 'TRY'
    let t = map.get(key)
    if (!t) {
      t = { currencyCode: key, gross: 0, bsmv: 0, vat: 0, net: 0, tryAmount: 0, count: 0 }
      map.set(key, t)
    }
    t.gross += Number(b.gross) || 0
    t.bsmv += Number(b.bsmv) || 0
    t.vat += Number(b.vat) || 0
    t.net += Number(b.net) || 0
    t.tryAmount += Number(b.tryAmount) || 0
    t.count += Number(b.count) || 0
  }
  return Array.from(map.values()).sort((a, b) => b.tryAmount - a.tryAmount)
}

export default function BankExpensesPage() {
  const [accounts, setAccounts] = useState<BankExpenseAccountDto[]>([])
  const [buckets, setBuckets] = useState<BankExpenseBucketDto[]>([])
  const [expenseTypes, setExpenseTypes] = useState<{ value: number; name: string }[]>([])
  const [rows, setRows] = useState<BankExpenseRowDto[]>([])

  const [selectedAccountId, setSelectedAccountId] = useState<number>(GENEL)
  const [typeFilter, setTypeFilter] = useState<number>(0)
  const [range, setRange] = useState(monthRange)
  const [accountQuery, setAccountQuery] = useState('')

  const [loading, setLoading] = useState(false)
  const [rowsLoading, setRowsLoading] = useState(false)
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null)
  const [note, setNote] = useState<{ open: boolean; message: string; variant: NotificationVariant }>({
    open: false,
    message: '',
    variant: 'info'
  })

  const notify = useCallback((message: string, variant: NotificationVariant = 'info') => {
    setNote({ open: true, message, variant })
  }, [])

  /**
   * Sol liste + kırılım. `background` ile iskelet açılmaz: bir kayıt/silme sonrası tam
   * iskelet açmak tabloyu söküyor ve kullanıcı bunu sayfa yenilemesi sanıyor.
   */
  const loadOverview = useCallback(
    async (options?: { background?: boolean }) => {
      if (!options?.background) setLoading(true)
      try {
        const data = await fetchBankExpenseOverview({
          startDate: range.from || null,
          endDate: range.to || null
        })
        setAccounts(data.accounts ?? [])
        setBuckets(data.buckets ?? [])
        setExpenseTypes(data.expenseTypes ?? [])
      } catch (e: any) {
        notify(String(e?.message ?? 'Masraf özeti yüklenemedi'), 'error')
      } finally {
        if (!options?.background) setLoading(false)
      }
    },
    [range.from, range.to, notify]
  )

  const loadRows = useCallback(
    async (options?: { background?: boolean }) => {
      if (!options?.background) setRowsLoading(true)
      try {
        const data = await fetchBankExpenses(selectedAccountId > 0 ? selectedAccountId : null, {
          startDate: range.from || null,
          endDate: range.to || null,
          expenseType: typeFilter > 0 ? typeFilter : null,
          take: 1000
        })
        setRows(data ?? [])
      } catch (e: any) {
        notify(String(e?.message ?? 'Masraf hareketleri yüklenemedi'), 'error')
      } finally {
        if (!options?.background) setRowsLoading(false)
      }
    },
    [selectedAccountId, typeFilter, range.from, range.to, notify]
  )

  useEffect(() => {
    void loadOverview()
  }, [loadOverview])

  useEffect(() => {
    void loadRows()
  }, [loadRows])

  /** Hesap kimliği → o hesabın kovaları. */
  const bucketsByAccount = useMemo(() => {
    const map = new Map<number, BankExpenseBucketDto[]>()
    for (const b of buckets) {
      const list = map.get(b.bankAccountDefinitionId)
      if (list) list.push(b)
      else map.set(b.bankAccountDefinitionId, [b])
    }
    return map
  }, [buckets])

  /** Tür süzgeci uygulanmış kovalar — sol listedeki toplamlar da süzgece uymalı. */
  const visibleBuckets = useMemo(
    () => (typeFilter > 0 ? buckets.filter((b) => b.expenseType === typeFilter) : buckets),
    [buckets, typeFilter]
  )

  const generalTotals = useMemo(() => sumByCurrency(visibleBuckets), [visibleBuckets])

  /**
   * GENEL görünümün tür kırılımı: masraf türü × para birimi.
   *
   * Bütün bankalar tek satırda toplanır ama PARA BİRİMİ BAŞINA ayrı satır çıkar —
   * "POS Masrafı" hem dolar hem TL hesaplarda olabilir ve bu ikisi toplanamaz.
   */
  const generalByType = useMemo(() => {
    const map = new Map<number, { expenseType: number; name: string; raw: BankExpenseBucketDto[] }>()
    for (const b of visibleBuckets) {
      let row = map.get(b.expenseType)
      if (!row) {
        row = { expenseType: b.expenseType, name: b.expenseTypeName, raw: [] }
        map.set(b.expenseType, row)
      }
      row.raw.push(b)
    }
    return Array.from(map.values())
      .map((r) => ({ expenseType: r.expenseType, name: r.name, totals: sumByCurrency(r.raw) }))
      .sort((a, b) => a.expenseType - b.expenseType)
  }, [visibleBuckets])

  const filteredAccounts = useMemo(() => {
    const q = accountQuery.trim().toLocaleLowerCase('tr-TR')
    if (!q) return accounts
    return accounts.filter((a) =>
      `${a.accountName} ${a.accountCode} ${a.bankName} ${a.accountNo}`.toLocaleLowerCase('tr-TR').includes(q)
    )
  }, [accounts, accountQuery])

  const selectedAccount = useMemo(
    () => accounts.find((a) => a.id === selectedAccountId) ?? null,
    [accounts, selectedAccountId]
  )

  const selectedBuckets = useMemo(() => {
    const list = bucketsByAccount.get(selectedAccountId) ?? []
    return typeFilter > 0 ? list.filter((b) => b.expenseType === typeFilter) : list
  }, [bucketsByAccount, selectedAccountId, typeFilter])

  const selectedTotals = useMemo(() => sumByCurrency(selectedBuckets), [selectedBuckets])

  // ——— Masraf işleme penceresi ———————————————————————————————————————————

  const [formOpen, setFormOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [loans, setLoans] = useState<BankExpenseLoanDto[]>([])
  const [form, setForm] = useState({
    bankAccountDefinitionId: '',
    date: toInputDate(new Date()),
    expenseType: String(BANK_EXPENSE_TYPE.PosFee),
    amount: '',
    currencyRate: '1',
    rateLoading: false,
    bsmvRate: '',
    vatRate: '',
    description: '',
    loanId: ''
  })

  const formAccount = useMemo(
    () => accounts.find((a) => a.id === Number(form.bankAccountDefinitionId)) ?? null,
    [accounts, form.bankAccountDefinitionId]
  )

  /**
   * Seçilen hesabın günün kuru. TL hesapta kur 1'dir ve hiç sorulmaz; dövizli hesapta
   * öneri olarak doldurulur, kullanıcı bankanın ekstresindeki kurla değiştirebilir.
   * Yön DAİMA "1 döviz = X ₺" — ters yön 42.000 ₺'yi 999 $ yapar.
   */
  const loadRateForAccount = useCallback(async (account: BankExpenseAccountDto | null) => {
    if (!account) return
    if ((account.currencyCode || 'TRY').toUpperCase() === 'TRY') {
      setForm((p) => ({ ...p, currencyRate: '1', rateLoading: false }))
      return
    }
    setForm((p) => ({ ...p, rateLoading: true }))
    try {
      const rate = await fetchLatestFxRate(account.currencyCode)
      // Türkçe biçim ŞART: String(rate) "65.6846" verir, parseAmount noktayı silip 656846 yapar.
      setForm((p) => ({ ...p, currencyRate: formatRate(rate), rateLoading: false }))
    } catch {
      // Kur çekilemezse alan boş bırakılır: sunucu da çekemezse kullanıcıdan istenir.
      setForm((p) => ({ ...p, currencyRate: '', rateLoading: false }))
    }
  }, [])

  const openForm = useCallback(() => {
    const preset = selectedAccountId > 0 ? selectedAccountId : accounts[0]?.id ?? 0
    const acc = accounts.find((a) => a.id === preset) ?? null
    setForm({
      bankAccountDefinitionId: preset ? String(preset) : '',
      date: toInputDate(new Date()),
      expenseType: String(typeFilter > 0 ? typeFilter : BANK_EXPENSE_TYPE.PosFee),
      amount: '',
      currencyRate: '1',
      rateLoading: false,
      bsmvRate: '',
      vatRate: '',
      description: '',
      loanId: ''
    })
    setFormOpen(true)
    void loadRateForAccount(acc)
    void fetchBankExpenseLoans(preset || null)
      .then(setLoans)
      .catch(() => setLoans([]))
  }, [accounts, selectedAccountId, typeFilter, loadRateForAccount])

  const onFormAccountChange = useCallback(
    (value: string) => {
      const acc = accounts.find((a) => a.id === Number(value)) ?? null
      // Kredi seçimi hesaba bağlı: hesap değişince eski kredi kalırsa masraf başka
      // bankanın kredisine bağlanmış görünür.
      setForm((p) => ({ ...p, bankAccountDefinitionId: value, loanId: '' }))
      void loadRateForAccount(acc)
      void fetchBankExpenseLoans(Number(value) || null)
        .then(setLoans)
        .catch(() => setLoans([]))
    },
    [accounts, loadRateForAccount]
  )

  const onSave = useCallback(async () => {
    const accountId = Number(form.bankAccountDefinitionId) || 0
    const amount = parseAmount(form.amount)
    const expenseType = Number(form.expenseType) || 0

    if (accountId <= 0) return notify('Banka hesabı seçiniz.', 'error')
    if (expenseType <= 0) return notify('Masraf türü seçiniz.', 'error')
    if (!(amount > 0)) return notify('Masraf tutarı sıfırdan büyük olmalıdır.', 'error')

    const isTry = (formAccount?.currencyCode || 'TRY').toUpperCase() === 'TRY'
    const rate = isTry ? 1 : parseAmount(form.currencyRate)
    if (!isTry && !(rate > 0)) {
      return notify('Dövizli hesapta kur girilmelidir (1 birim kaç ₺).', 'error')
    }
    /*
      SON KAPI: biçim hatası buradan geçmesin. 2026-09-02'de kur 656846 olarak kaydedildi
      (65,6846 olmalıydı) ve tek satır 1,8 MİLYAR ₺ gider yazdı. Kaynak `formatRate` ile
      düzeltildi ama kullanıcı da elle yanlış yazabilir; bu kontrol ucuz ve geri dönüşü yok.
    */
    if (!isTry && rate > MAKUL_KUR_UST_SINIRI) {
      return notify(
        `Kur çok yüksek görünüyor (${form.currencyRate}). Ondalık ayracı VİRGÜL olmalı: 65,6846 gibi.`,
        'error'
      )
    }

    setSaving(true)
    try {
      await createBankExpense({
        bankAccountDefinitionId: accountId,
        date: form.date,
        expenseType,
        amount,
        currencyRate: rate,
        bsmvRate: parseAmount(form.bsmvRate) > 0 ? parseAmount(form.bsmvRate) : undefined,
        vatRate: parseAmount(form.vatRate) > 0 ? parseAmount(form.vatRate) : undefined,
        description: form.description.trim() ? form.description.trim() : undefined,
        loanId: expenseType === BANK_EXPENSE_TYPE.LoanUsageFee && Number(form.loanId) > 0 ? Number(form.loanId) : null
      })

      setFormOpen(false)
      notify('Masraf işlendi.', 'success')
      await loadOverview({ background: true })
      await loadRows({ background: true })
    } catch (e: any) {
      notify(String(e?.message ?? 'Masraf işlenemedi'), 'error')
    } finally {
      setSaving(false)
    }
  }, [form, formAccount, notify, loadOverview, loadRows])

  const onDelete = useCallback(
    async (id: number) => {
      try {
        await deleteBankExpense(id)
        // Satır iyimser düşürülür, tazeleme arka planda: tablo sökülmesin.
        setRows((prev) => prev.filter((r) => r.id !== id))
        setPendingDeleteId(null)
        notify('Masraf silindi.', 'success')
        await loadOverview({ background: true })
        await loadRows({ background: true })
      } catch (e: any) {
        notify(String(e?.message ?? 'Masraf silinemedi'), 'error')
      }
    },
    [notify, loadOverview, loadRows]
  )

  const typeOptions = useMemo(
    () => [{ value: '0', label: 'Tüm masraf türleri' }, ...expenseTypes.map((t) => ({ value: String(t.value), label: t.name }))],
    [expenseTypes]
  )

  const isGeneral = selectedAccountId === GENEL

  const expenseColumns = useMemo<TableColumn<BankExpenseRowDto>[]>(() => {
    const cols: TableColumn<BankExpenseRowDto>[] = [
      {
        key: 'date',
        label: 'Tarih',
        // Süzgeç ve sıralama ekrandaki metin üzerinden; ham ISO değerinde "22.08" aranamıyordu.
        filter: { type: 'date' },
        accessorFn: (r) => shortDate(r.date),
        render: (v) => <span className="whitespace-nowrap text-xs">{String(v ?? '')}</span>
      }
    ]

    // Banka hesabı sütunu YALNIZCA "genel" görünümde çıkar; tek hesap seçiliyken
    // her satırda aynı hesabı tekrar yazmanın anlamı yok (eski tablodaki kural).
    if (isGeneral) {
      cols.push({
        key: 'bankAccountName',
        label: 'Banka Hesabı',
        accessorFn: (r) => `${r.bankAccountName ?? ''} ${r.bankAccountCode ?? ''}`.trim(),
        render: (_v, r) => (
          <div className="text-xs">
            <div className="font-semibold text-gray-800">{r.bankAccountName}</div>
            <div className="text-[10px] font-mono text-gray-400">{r.bankAccountCode}</div>
          </div>
        )
      })
    }

    cols.push(
      {
        key: 'expenseTypeName',
        label: 'Masraf Hesabı',
        accessorFn: (r) => `${r.expenseTypeName ?? ''} ${r.loanCode ?? ''}`.trim(),
        render: (_v, r) => (
          <span className="text-xs">
            <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-700 font-semibold">{r.expenseTypeName}</span>
            {r.loanCode && <span className="ml-1 text-[10px] text-gray-500">({r.loanCode})</span>}
          </span>
        )
      },
      {
        key: 'description',
        label: 'Açıklama',
        render: (_v, r) => <span className="text-xs text-gray-600">{r.description || '-'}</span>
      },
      {
        key: 'createUser',
        label: 'Kaydeden',
        render: (_v, r) => <span className="text-xs text-gray-500">{r.createUser || '-'}</span>
      },
      {
        key: 'net',
        label: 'Komisyon (Net)',
        // Sıralama SAYIYA göre: ayrıştırılmamış satırda değer yok, 0 sayılır.
        accessorFn: (r) => ((r.bsmvRate ?? 0) > 0 || (r.vatRate ?? 0) > 0 ? Number(r.net ?? 0) : 0),
        render: (_v, r) => (
          <span className="whitespace-nowrap text-xs text-gray-700">
            {(r.bsmvRate ?? 0) > 0 || (r.vatRate ?? 0) > 0 ? amountWithCode(r.net, r.currencyCode) : '-'}
          </span>
        )
      },
      {
        key: 'bsmv',
        label: 'BSMV',
        accessorFn: (r) => ((r.bsmvRate ?? 0) > 0 ? Number(r.bsmv ?? 0) : 0),
        render: (_v, r) => (
          <span className="whitespace-nowrap text-xs text-gray-700">
            {(r.bsmvRate ?? 0) > 0 ? amountWithCode(r.bsmv, r.currencyCode) : '-'}
          </span>
        )
      },
      {
        key: 'vat',
        label: 'KDV',
        accessorFn: (r) => ((r.vatRate ?? 0) > 0 ? Number(r.vat ?? 0) : 0),
        render: (_v, r) => (
          <span className="whitespace-nowrap text-xs text-gray-700">
            {(r.vatRate ?? 0) > 0 ? amountWithCode(r.vat, r.currencyCode) : '-'}
          </span>
        )
      },
      {
        key: 'gross',
        label: 'Tutar (Brüt)',
        accessorFn: (r) => Number(r.gross ?? 0),
        render: (_v, r) => (
          <span className="whitespace-nowrap font-semibold text-gray-900">{amountWithCode(r.gross, r.currencyCode)}</span>
        )
      },
      {
        key: 'tryAmount',
        label: 'TL Karşılığı',
        accessorFn: (r) => Number(r.tryAmount ?? 0),
        render: (_v, r) => <span className="whitespace-nowrap text-xs text-gray-500">{money(r.tryAmount)} ₺</span>
      },
      {
        key: 'actions',
        label: '',
        render: (_v, r) => (
          <div className="flex justify-end whitespace-nowrap">
            {pendingDeleteId === r.id ? (
              <span className="inline-flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => void onDelete(r.id)}
                  className="px-2 py-1 rounded bg-red-600 text-white text-[11px] font-semibold"
                >
                  Sil
                </button>
                <button
                  type="button"
                  onClick={() => setPendingDeleteId(null)}
                  className="px-2 py-1 rounded border border-gray-200 text-[11px] font-semibold text-gray-600"
                >
                  Vazgeç
                </button>
              </span>
            ) : (
              <button
                type="button"
                title="Masrafı sil"
                onClick={() => setPendingDeleteId(r.id)}
                className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50"
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
        )
      }
    )

    return cols
  }, [isGeneral, pendingDeleteId, onDelete])
  const activeTotals = isGeneral ? generalTotals : selectedTotals

  return (
    <div className="p-4 space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900 tracking-tight">Banka Masrafları</h1>
          <p className="text-xs text-gray-500 mt-0.5">
            Her banka hesabının kendi masraf defteri. Tutarlar <b>hesabın kendi para biriminde</b>;
            TL karşılığı yalnızca genel toplam içindir.
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-bold uppercase tracking-wide text-gray-500">Başlangıç</span>
            <input
              type="date"
              value={range.from}
              onChange={(e) => setRange((p) => ({ ...p, from: e.target.value }))}
              className="px-2 py-1.5 border border-gray-200 rounded-lg text-sm"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-bold uppercase tracking-wide text-gray-500">Bitiş</span>
            <input
              type="date"
              value={range.to}
              onChange={(e) => setRange((p) => ({ ...p, to: e.target.value }))}
              className="px-2 py-1.5 border border-gray-200 rounded-lg text-sm"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-bold uppercase tracking-wide text-gray-500">Masraf Türü</span>
            <select
              value={String(typeFilter)}
              onChange={(e) => setTypeFilter(Number(e.target.value) || 0)}
              className="px-2 py-1.5 border border-gray-200 rounded-lg text-sm"
            >
              {typeOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => {
              void loadOverview()
              void loadRows()
            }}
            disabled={loading || rowsLoading}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-200 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            <RefreshCw size={14} className={loading || rowsLoading ? 'animate-spin' : ''} /> Yenile
          </button>
          <button
            type="button"
            onClick={openForm}
            disabled={accounts.length === 0}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800 disabled:opacity-50"
          >
            <Plus size={14} /> Masraf İşle
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[320px_minmax(0,1fr)] gap-4">
        {/* SOL: banka seçici. Masrafı olmayan hesap da listede kalır — düşseydi
            "masrafı yok" ile "hesap yok" ayırt edilemezdi. */}
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden self-start">
          <div className="px-3 py-2.5 border-b border-gray-200 bg-gray-50">
            <div className="text-[10px] font-bold uppercase tracking-wide text-gray-500 mb-1.5">Banka Hesabı</div>
            <input
              value={accountQuery}
              onChange={(e) => setAccountQuery(e.target.value)}
              placeholder="Hesap, banka, kod ara"
              className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-sm"
            />
          </div>

          <div className="max-h-[70vh] overflow-y-auto">
            {/* GENEL: bütün bankaların toplamı. Kullanıcının istediği "genel POS masraf". */}
            <button
              type="button"
              onClick={() => setSelectedAccountId(GENEL)}
              className={`w-full text-left px-3 py-2.5 border-b border-gray-100 transition-colors ${
                isGeneral ? 'bg-slate-900 text-white' : 'hover:bg-gray-50'
              }`}
            >
              <div className="flex items-center gap-2">
                <Layers size={15} className={isGeneral ? 'text-white' : 'text-gray-500'} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-bold truncate">GENEL — TÜM BANKALAR</div>
                  <div className={`text-[11px] truncate ${isGeneral ? 'text-slate-300' : 'text-gray-500'}`}>
                    {generalTotals.length === 0
                      ? 'Bu aralıkta masraf yok'
                      : generalTotals.map((t) => amountWithCode(t.gross, t.currencyCode)).join(' · ')}
                  </div>
                </div>
              </div>
            </button>

            {filteredAccounts.map((a) => {
              const own = (bucketsByAccount.get(a.id) ?? []).filter(
                (b) => typeFilter <= 0 || b.expenseType === typeFilter
              )
              const totals = sumByCurrency(own)
              const active = selectedAccountId === a.id
              return (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => setSelectedAccountId(a.id)}
                  className={`w-full text-left px-3 py-2.5 border-b border-gray-100 transition-colors ${
                    active ? 'bg-slate-900 text-white' : 'hover:bg-gray-50'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <Landmark size={15} className={`mt-0.5 ${active ? 'text-white' : 'text-gray-400'}`} />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold truncate">{a.accountName || a.accountCode}</div>
                      <div className={`text-[10px] font-mono truncate ${active ? 'text-slate-300' : 'text-gray-400'}`}>
                        {a.accountCode} · {a.currencyCode}
                      </div>
                      <div className={`text-[11px] font-semibold mt-0.5 ${active ? 'text-white' : 'text-gray-700'}`}>
                        {totals.length === 0
                          ? '—'
                          : totals.map((t) => amountWithCode(t.gross, t.currencyCode)).join(' · ')}
                      </div>
                    </div>
                  </div>
                </button>
              )
            })}

            {filteredAccounts.length === 0 && (
              <div className="px-3 py-6 text-center text-sm text-gray-500">Hesap bulunamadı.</div>
            )}
          </div>
        </div>

        {/* SAĞ: seçilen hesabın (ya da genelin) masrafları */}
        <div className="space-y-4 min-w-0">
          <div className="bg-white border border-gray-200 rounded-xl px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="w-9 h-9 rounded-lg bg-red-50 text-red-600 flex items-center justify-center">
                  <Wallet size={17} />
                </span>
                <div>
                  <div className="text-sm font-bold text-gray-900">
                    {isGeneral ? 'Genel Masraf Toplamı' : selectedAccount?.accountName || 'Banka Hesabı'}
                  </div>
                  <div className="text-[11px] text-gray-500">
                    {isGeneral
                      ? `${accounts.length} hesap · ${range.from || '—'} → ${range.to || '—'}`
                      : `${selectedAccount?.bankName || ''} ${selectedAccount?.accountCode || ''} · ${
                          selectedAccount?.currencyCode || ''
                        }`}
                  </div>
                </div>
              </div>

              {/*
                HER PARA BİRİMİ AYRI KUTU. Tek toplama indirilmesi (eski ekranın yaptığı)
                dolar masrafı ile TL masrafı aynı sayıda toplamak demekti.
              */}
              <div className="flex flex-wrap items-center gap-2">
                {activeTotals.length === 0 && <span className="text-sm text-gray-500">Bu aralıkta masraf yok.</span>}
                {activeTotals.map((t) => (
                  <div key={t.currencyCode} className="px-3 py-1.5 rounded-lg bg-gray-50 border border-gray-200">
                    <div className="text-[10px] font-bold uppercase tracking-wide text-gray-500">
                      {t.currencyCode} · {t.count} hareket
                    </div>
                    <div className="text-base font-bold text-gray-900 leading-tight">
                      {amountWithCode(t.gross, t.currencyCode)}
                    </div>
                    {t.currencyCode !== 'TRY' && (
                      <div className="text-[10px] text-gray-500">≈ {money(t.tryAmount)} ₺</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Masraf türü kırılımı — "her bankanın ayrı masraf hesabı" bu tablodur. */}
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-200 text-sm font-bold text-gray-900">
              Masraf Hesapları
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-white border-b border-gray-100">
                  <tr className="text-left text-[10px] uppercase tracking-wide text-gray-500">
                    <th className="px-3 py-2">Masraf Hesabı</th>
                    <th className="px-3 py-2">Para Birimi</th>
                    <th className="px-3 py-2 text-right">Komisyon (Net)</th>
                    <th className="px-3 py-2 text-right">BSMV</th>
                    <th className="px-3 py-2 text-right">KDV</th>
                    <th className="px-3 py-2 text-right">Toplam (Brüt)</th>
                    <th className="px-3 py-2 text-right">TL Karşılığı</th>
                    <th className="px-3 py-2 text-right">Hareket</th>
                  </tr>
                </thead>
                <tbody>
                  {(isGeneral
                    ? generalByType.flatMap((r) => r.totals.map((t) => ({ name: r.name, t })))
                    : selectedBuckets.map((b) => ({
                        name: b.expenseTypeName,
                        // Kova zaten CurrencyTotal alanlarının hepsini taşıyor; seçili
                        // hesapta tür başına tek satır olduğu için ayrıca toplanmıyor.
                        t: {
                          currencyCode: b.currencyCode,
                          gross: b.gross,
                          bsmv: b.bsmv,
                          vat: b.vat,
                          net: b.net,
                          tryAmount: b.tryAmount,
                          count: b.count
                        } as CurrencyTotal
                      }))
                  ).map((item, idx) => (
                    <tr key={`${item.name}__${item.t.currencyCode}__${idx}`} className="border-b border-gray-50">
                      <td className="px-3 py-2 font-semibold text-gray-800">{item.name}</td>
                      <td className="px-3 py-2 text-gray-600">{item.t.currencyCode}</td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">{amountWithCode(item.t.net, item.t.currencyCode)}</td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        {item.t.bsmv > 0 ? amountWithCode(item.t.bsmv, item.t.currencyCode) : '-'}
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        {item.t.vat > 0 ? amountWithCode(item.t.vat, item.t.currencyCode) : '-'}
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap font-bold text-gray-900">
                        {amountWithCode(item.t.gross, item.t.currencyCode)}
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap text-gray-600">{money(item.t.tryAmount)} ₺</td>
                      <td className="px-3 py-2 text-right text-gray-600">{item.t.count}</td>
                    </tr>
                  ))}

                  {(isGeneral ? generalByType.length === 0 : selectedBuckets.length === 0) && (
                    <tr>
                      <td colSpan={8} className="px-3 py-6 text-center text-sm text-gray-500">
                        {loading ? 'Yükleniyor…' : 'Bu aralıkta masraf yok.'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Masraf hareketleri */}
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-200 flex items-center justify-between gap-2">
              <div className="text-sm font-bold text-gray-900">Masraf Hareketleri</div>
              <div className="text-xs text-gray-500">{rows.length} kayıt</div>
            </div>
            <Table<BankExpenseRowDto>
          onRefresh={() => void loadRows()}
              columns={expenseColumns}
              data={rows}
              rowKey={(r) => String(r.id)}
              loading={rowsLoading}
            />
          </div>
        </div>
      </div>

      <Modal isOpen={formOpen} onClose={() => setFormOpen(false)} title="Masraf İşle" maxWidth="max-w-2xl">
        <div className="space-y-4">
          <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-[11px] text-amber-800">
            <TriangleAlert size={14} className="mt-0.5 shrink-0" />
            <span>
              Masraf, seçilen hesaptan <b>çıkış hareketi</b> olarak yazılır ve banka bakiyesinden düşer.
              Tutarı <b>hesabın kendi para biriminde</b> giriniz.
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <FormSelect
              label="Banka Hesabı"
              requiredMark
              value={form.bankAccountDefinitionId}
              onChange={(e) => onFormAccountChange(e.target.value)}
              options={[
                { value: '', label: 'Seçiniz' },
                ...accounts.map((a) => ({
                  value: String(a.id),
                  label: `${a.accountName || a.accountCode} (${a.currencyCode})`
                }))
              ]}
            />

            <FormSelect
              label="Masraf Hesabı"
              requiredMark
              value={form.expenseType}
              onChange={(e) => setForm((p) => ({ ...p, expenseType: e.target.value, loanId: '' }))}
              options={expenseTypes.map((t) => ({ value: String(t.value), label: t.name }))}
            />

            <FormInput
              label="Tarih"
              type="date"
              value={form.date}
              onChange={(e) => setForm((p) => ({ ...p, date: e.target.value }))}
            />

            <FormInput
              label={`Tutar (Brüt${formAccount ? ` — ${formAccount.currencyCode}` : ''})`}
              requiredMark
              inputMode="decimal"
              placeholder="0,00"
              value={form.amount}
              onChange={(e) => setForm((p) => ({ ...p, amount: handleCurrencyInputChange(e.target.value) }))}
              hint="Bankanın hesaptan çektiği toplam tutar. BSMV/KDV bu tutarın İÇİNDEDİR."
            />

            {/* Kur yalnız dövizli hesapta sorulur; TL hesapta 1 sabittir. */}
            {formAccount && formAccount.currencyCode.toUpperCase() !== 'TRY' && (
              <FormInput
                label={`Kur (1 ${formAccount.currencyCode} = ? ₺)`}
                inputMode="decimal"
                value={form.rateLoading ? 'Yükleniyor…' : form.currencyRate}
                onChange={(e) => setForm((p) => ({ ...p, currencyRate: e.target.value }))}
                hint="TL karşılığı bu kurdan hesaplanır; masrafın kendisi hesabın para biriminde kalır."
              />
            )}

            {Number(form.expenseType) === BANK_EXPENSE_TYPE.LoanUsageFee && (
              <FormSelect
                label="Kredi (isteğe bağlı)"
                value={form.loanId}
                onChange={(e) => setForm((p) => ({ ...p, loanId: e.target.value }))}
                options={[
                  { value: '', label: 'Krediye bağlama' },
                  ...loans.map((l) => ({
                    value: String(l.id),
                    label: `${l.loanCode}${l.contractNo ? ` · ${l.contractNo}` : ''}`
                  }))
                ]}
                hint="Kullandırım masrafını hangi krediye ait olduğuna bağlar."
              />
            )}

            <FormInput
              label="BSMV Oranı (%)"
              inputMode="decimal"
              placeholder="örn. 5"
              value={form.bsmvRate}
              onChange={(e) => setForm((p) => ({ ...p, bsmvRate: e.target.value }))}
              hint="Boş bırakılırsa ayrıştırma yapılmaz."
            />

            <FormInput
              label="KDV Oranı (%)"
              inputMode="decimal"
              placeholder="örn. 20"
              value={form.vatRate}
              onChange={(e) => setForm((p) => ({ ...p, vatRate: e.target.value }))}
              hint="Boş bırakılırsa ayrıştırma yapılmaz."
            />
          </div>

          <FormInput
            label="Açıklama"
            value={form.description}
            onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
            placeholder="Boş bırakılırsa masraf türü ve hesap adı yazılır"
          />

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setFormOpen(false)}
              className="px-3 py-2 rounded-lg border border-gray-200 text-sm font-semibold text-gray-700 hover:bg-gray-50"
            >
              Vazgeç
            </button>
            <button
              type="button"
              onClick={() => void onSave()}
              disabled={saving}
              className="px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800 disabled:opacity-50"
            >
              {saving ? 'Kaydediliyor…' : 'Masrafı İşle'}
            </button>
          </div>
        </div>
      </Modal>

      <NotificationPopup
        isOpen={note.open}
        message={note.message}
        variant={note.variant}
        onClose={() => setNote((p) => ({ ...p, open: false }))}
      />
    </div>
  )
}
