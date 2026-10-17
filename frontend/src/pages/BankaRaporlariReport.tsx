import React from 'react'
import { useEffect, useMemo, useState } from 'react'
import Table, { type TableColumn } from '../components/Table'
import Modal from '../components/Modal'
import {
  MoneyChip as SharedMoneyChip,
  BalanceChip as SharedBalanceChip,
  CurrencyChip as SharedCurrencyChip,
  NameChip,
  formatDateTr
} from '../components/reportChips'
import { fetchBankAccountDefinitions, type BankAccountDefinitionDto } from '../api/bankAccountDefinitions'
import { isInflowDirection } from '../utils/transactionDirection'
import IslemTakibiModal from '../components/IslemTakibiModal'
import {
  fetchBankAccountBalance,
  fetchBankAccountTransactions,
  type BankAccountBalanceDto,
  type BankAccountTransactionListItemDto
} from '../api/bankAccountTransactions'

// CurrencyTypeId: 0/1 = TRY, 2 = EUR, 3 = USD, 4 = GBP
const currencySymbols: Record<number, string> = { 1: '₺', 2: '€', 3: '$', 4: '£' }

function normalizeCurrency(v: number) {
  const n = Number(v ?? 0)
  return n === 0 ? 1 : n
}

function formatMoney(n: number, currencyTypeId: number = 1) {
  const v = Number(n ?? 0)
  const symbol = currencySymbols[normalizeCurrency(currencyTypeId)] ?? '₺'
  return `${symbol}${v.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

const accountTypeOptions: Array<{ value: number; label: string }> = [
  { value: 14, label: 'Kredi Kartları' },
  { value: 7, label: 'Nakit Kredi' },
  { value: 20, label: 'Taksitli Kredi' },
  { value: 3, label: 'Teminat Çekleri' },
  { value: 0, label: 'Vadesiz Hesap' },
  { value: 300, label: 'Şirket Kredi Kartı' }
]

const currencyOptions: Array<{ value: number; label: string }> = [
  { value: 1, label: 'TL' },
  { value: 3, label: 'DOLAR' },
  { value: 2, label: 'EURO' },
  { value: 4, label: 'STERLİN' }
]

function accountTypeLabel(v: number) {
  return accountTypeOptions.find((x) => x.value === v)?.label ?? String(v)
}

function currencyLabel(v: number) {
  // 0 da TL (eski varsayılan). Normalize edilmezse eski satırlar etiket yerine ham "0"
  // gösteriyordu — kardeş ekranlar (CariEkstre, YönetimEkstre) bunu zaten yapıyor.
  const normalized = normalizeCurrency(Number(v ?? 0))
  return currencyOptions.find((x) => x.value === normalized)?.label ?? 'TL'
}

/*
  RENK, SÜSLEME DEĞİL OKUMA HIZI İÇİN.

  Rapor ekranı yan yana üç para sütunu gösteriyor (Giriş / Çıkış / Bakiye) ve hepsi aynı
  siyah metindi; hangi satırın para aldığını hangisinin ödediğini görmek için tek tek okumak
  gerekiyordu. Rozetler yönü BİR BAKIŞTA veriyor: giriş yeşil, çıkış kırmızı.

  Sıfırlar bilerek rozetsiz ve soluk: tablo yüzlerce satırda sıfır taşıyor, her birine renkli
  bir kutu koymak asıl hareketleri görünmez kılardı.
*/
const chipBase = 'inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset whitespace-nowrap'

/** Hesap türü rozetleri. Vadesiz ile kredi hesabı aynı renkte olursa ayrım kaybolur. */
const accountTypeTone: Record<number, string> = {
  0: 'bg-sky-50 text-sky-800 ring-sky-600/25',        // Vadesiz
  3: 'bg-amber-50 text-amber-800 ring-amber-600/25',  // Teminat Çekleri
  7: 'bg-violet-50 text-violet-800 ring-violet-600/25', // Nakit Kredi
  14: 'bg-indigo-50 text-indigo-800 ring-indigo-600/25', // POS / Kredi Kartları
  20: 'bg-fuchsia-50 text-fuchsia-800 ring-fuchsia-600/25', // Taksitli Kredi
  300: 'bg-slate-100 text-slate-700 ring-slate-500/25'  // Şirket Kredi Kartı
}

function AccountTypeChip({ value }: { value: number }) {
  const v = Number(value ?? 0)
  return <span className={`${chipBase} ${accountTypeTone[v] ?? 'bg-gray-50 text-gray-600 ring-gray-400/20'}`}>{accountTypeLabel(v)}</span>
}

function CurrencyChip({ value }: { value: number }) {
  const v = normalizeCurrency(Number(value ?? 0))
  return <SharedCurrencyChip currencyTypeId={v} label={currencyLabel(v)} />
}

/** Ortak rozetlerin bu ekrandaki para birimi bilen sarmalayıcıları. */
function MoneyChip({ value, currencyTypeId, tone }: { value: number; currencyTypeId: number; tone: 'in' | 'out' }) {
  return <SharedMoneyChip value={value} tone={tone} format={(v) => formatMoney(v, currencyTypeId)} />
}

function BalanceChip({ value, currencyTypeId }: { value: number; currencyTypeId: number }) {
  return <SharedBalanceChip value={value} format={(v) => formatMoney(v, currencyTypeId)} />
}

export default function BankaRaporlariReport() {
  type BankRow = {
    id: number
    bankName: string
    accountCode: string
    accountName: string
    currencyTypeId: number
    accountType: number
    balance: number
    inAmount: number
    outAmount: number
    actions: string
  }

  const [bankAccounts, setBankAccounts] = useState<BankAccountDefinitionDto[]>([])
  /** İşlem takibi penceresi açık mı. */
  const [islemTakibiAcik, setIslemTakibiAcik] = useState(false)
  const [balancesById, setBalancesById] = useState<Record<string, BankAccountBalanceDto>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [globalSearch, setGlobalSearch] = useState('')

  const [detailOpen, setDetailOpen] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailAccountId, setDetailAccountId] = useState<number | null>(null)
  const [detailTransactions, setDetailTransactions] = useState<BankAccountTransactionListItemDto[]>([])

  const load = async () => {
    const ac = new AbortController()
    try {
      setLoading(true)
      setError(null)

      const accounts = await fetchBankAccountDefinitions({ signal: ac.signal })
      setBankAccounts(accounts ?? [])

      const balResults = await Promise.all(
        (accounts ?? []).map(async (a) => {
          try {
            const b = await fetchBankAccountBalance(a.id, { signal: ac.signal })
            return { id: a.id, b }
          } catch {
            return { id: a.id, b: null as any }
          }
        })
      )

      const balances: Record<string, BankAccountBalanceDto> = {}
      for (const r of balResults) {
        if (r?.b) balances[String(r.id)] = r.b
      }
      setBalancesById(balances)
    } catch (e: any) {
      setError(String(e?.message ?? 'Banka raporları alınamadı'))
      setBankAccounts([])
      setBalancesById({})
    } finally {
      setLoading(false)
    }
    return () => ac.abort()
  }

  useEffect(() => {
    void load()
  }, [])

  const rows: BankRow[] = useMemo(() => {
    return (bankAccounts ?? []).map((a) => {
      const b = balancesById[String(a.id)]
      return {
        id: a.id,
        bankName: String(a.bankName ?? ''),
        accountCode: String(a.accountCode ?? ''),
        accountName: String(a.accountName ?? ''),
        currencyTypeId: Number((a as any).currencyTypeId ?? 0),
        accountType: Number((a as any).accountType ?? 0),
        balance: Number(b?.balance ?? 0),
        inAmount: Number(b?.inAmount ?? 0),
        outAmount: Number(b?.outAmount ?? 0),
        actions: ''
      }
    })
  }, [bankAccounts, balancesById])

  const filteredRows = useMemo(() => {
    const q = globalSearch.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) =>
      String(r.bankName ?? '').toLowerCase().includes(q) ||
      String(r.accountCode ?? '').toLowerCase().includes(q) ||
      String(r.accountName ?? '').toLowerCase().includes(q)
    )
  }, [rows, globalSearch])

  const openDetail = async (row: BankRow) => {
    setDetailAccountId(row.id)
    setDetailOpen(true)
    setDetailTransactions([])
    const ac = new AbortController()
    try {
      setDetailLoading(true)
      const txs = await fetchBankAccountTransactions(row.id, { take: 300, signal: ac.signal })
      setDetailTransactions(txs ?? [])
    } catch {
      setDetailTransactions([])
    } finally {
      setDetailLoading(false)
    }
    return () => ac.abort()
  }

  const selectedAccount = useMemo(() => {
    const id = Number(detailAccountId ?? 0)
    if (!id) return null
    return bankAccounts.find((x) => x.id === id) ?? null
  }, [detailAccountId, bankAccounts])

  type TxRow = BankAccountTransactionListItemDto & {
    actions: string
    documentNoText: string
    accountCode: string
    maturityDate: string
    currencyText: string
    inAmount: number
    outAmount: number
    balance: number
  }
  const txColumns: TableColumn<TxRow>[] = useMemo(
    () => [
      // Sıra ve Tarih dar sabitlenir: içerikleri kısa, başlık süzgeci yüzünden gereğinden
      // geniş kalıyor ve asıl okunacak sütunlardan (Açıklama, tutarlar) yer çalıyorlardı.
      { key: 'id', label: 'Sıra', searchable: true, width: '72px' },
      { key: 'date', label: 'Tarih', searchable: true, width: '108px', filter: { type: 'date' }, render: (v) => formatDateTr(v) },
      { key: 'documentNoText', label: 'Belge No', searchable: true, width: '140px' },
      { key: 'counterpartyName', label: 'Cari Adı', searchable: true },
      // Açıklama Havale/EFT ekranında vardı, raporda YOKTU: aynı harekete iki ekrandan
      // bakan kişi burada "bu para neydi" sorusunu cevaplayamıyordu.
      { key: 'description', label: 'Açıklama', searchable: true, render: (v) => <span className="text-gray-600">{String(v ?? '')}</span> },
      { key: 'accountCode', label: 'Hesap Kodu', searchable: true },
      { key: 'maturityDate', label: 'Vade Tarihi', searchable: true, width: '118px', filter: { type: 'date' }, render: (v) => formatDateTr(v) },
      { key: 'currencyText', label: 'Döviz Tipi', searchable: true, width: '110px', filter: { type: 'select', options: currencyOptions.map((o) => ({ label: o.label, value: o.label })) }, render: (_v, row) => <CurrencyChip value={Number(row.currencyTypeId ?? 0)} /> },
      { key: 'inAmount', label: 'Giriş', searchable: true, render: (v, row) => <MoneyChip value={Number(v ?? 0)} currencyTypeId={Number(row.currencyTypeId ?? 0)} tone="in" /> },
      { key: 'outAmount', label: 'Çıkış', searchable: true, render: (v, row) => <MoneyChip value={Number(v ?? 0)} currencyTypeId={Number(row.currencyTypeId ?? 0)} tone="out" /> },
      { key: 'balance', label: 'Bakiye', searchable: true, render: (v, row) => <BalanceChip value={Number(v ?? 0)} currencyTypeId={Number(row.currencyTypeId ?? 0)} /> },
      { key: 'createUser', label: 'İşlem Yapan', searchable: true, width: '130px' },
      { key: 'actions', label: '', render: () => <div className="w-6" /> }
    ],
    []
  )

  const txRows: TxRow[] = useMemo(() => {
    const selected = selectedAccount
    const code = String(selected?.accountCode ?? '')
    const accCurrencyTypeId = Number((selected as any)?.currencyTypeId ?? 0)
    const curText = currencyLabel(accCurrencyTypeId)

    // DÖVİZLİ HESAPTA SATIR TUTARI `currencyAmount`TAN OKUNUR (2026-08-26 bildirimi).
    //
    // `amount` TL ÇAPASIDIR — her satır TL karşılığını taşır. Detay tablosu onu okuyup
    // başına hesabın sembolünü koyuyordu: GBP hesapta 15.000,00 £'lik bir giriş
    // "£984.906,00" görünüyordu (kur 65,70 ile çarpılmış TL değeri).
    //
    // Üstteki özet kartlar (Bakiye/Giriş/Çıkış) zaten doğruydu, çünkü onlar sunucudan
    // döviz cinsinden geliyor. Yalnız alt tablo ayrışmıştı.
    //
    // Kural `BankPage`'teki Havale/EFT listesiyle AYNI (orada doğru çalışıyor):
    // 0 ve 1 = TL → `amount`; diğer her para birimi → `currencyAmount`.
    const isTryAccount = accCurrencyTypeId === 0 || accCurrencyTypeId === 1
    const satirTutari = (t: BankAccountTransactionListItemDto) =>
      isTryAccount ? Number(t.amount ?? 0) : Number((t as any)?.currencyAmount ?? 0)
    const b = balancesById[String(detailAccountId ?? '')]
    const endBalance = Number(b?.balance ?? 0)
    const startBalance = endBalance - (Number(b?.inAmount ?? 0) - Number(b?.outAmount ?? 0))

    const asc = [...(detailTransactions ?? [])]
      .sort((a, b) => {
        const da = new Date(String(a.date ?? '')).getTime()
        const db = new Date(String(b.date ?? '')).getTime()
        if (da !== db) return da - db
        return Number(a.id ?? 0) - Number(b.id ?? 0)
      })

    let running = startBalance
    const out: TxRow[] = []

    for (const x of asc) {
      // `direction` METİN gelebiliyor ("In"/"Out"); Number(...) NaN verip her hareketi
      // çıkış yapıyordu. Bkz. isInflowDirection.
      const isIn = isInflowDirection(x.direction)
      const tutar = satirTutari(x)
      const inAmount = isIn ? tutar : 0
      const outAmount = !isIn ? tutar : 0
      running = running + (inAmount - outAmount)

      out.push({
        ...x,
        actions: '',
        documentNoText: String((x as any).documentNo ?? ''),
        accountCode: code,
        maturityDate: String((x as any).maturityDate ?? '').slice(0, 10) || String(x.date ?? '').slice(0, 10),
        currencyText: curText,
        inAmount,
        outAmount,
        balance: running
      })
    }

    return out
  }, [balancesById, detailAccountId, detailTransactions, selectedAccount])

  const columns: TableColumn<BankRow>[] = useMemo(
    () => [
      { key: 'accountCode', label: 'Hesap Kodu', searchable: true },
      // Banka adı renkli: 61 hesaplı listede aynı bankanın satırlarını gözle gruplamak
      // için. Renk addan türüyor, yeni banka eklenince kendiliğinden bir renk alıyor.
      { key: 'bankName', label: 'Banka Adı', searchable: true, render: (v) => <NameChip text={v} /> },
      { key: 'accountName', label: 'Hesap Adı', searchable: true },
      {
        key: 'currencyTypeId',
        label: 'Döviz Tipi',
        searchable: true,
        filter: {
          type: 'select',
          options: [{ label: 'Tümünü Seç', value: '' }, ...currencyOptions.map((o) => ({ label: o.label, value: String(o.value) }))]
        },
        render: (v) => <CurrencyChip value={Number(v ?? 0)} />
      },
      {
        key: 'accountType',
        label: 'Hesap Tipi',
        searchable: true,
        filter: {
          type: 'select',
          options: [{ label: 'Tümünü Seç', value: '' }, ...accountTypeOptions.map((o) => ({ label: o.label, value: String(o.value) }))]
        },
        render: (v) => <AccountTypeChip value={Number(v ?? 0)} />
      },
      // Tutarlar HESABIN KENDİ para biriminde. Uç (`/balance`) dolarlı hesapta zaten
      // `CurrencyAmount` topluyor; ekran sembolü sabit ₺ bastığı için dolar hesap TL
      // görünüyordu — aynı satırda "Döviz Tipi: DOLAR" yazarken tutar "₺" idi.
      { key: 'inAmount', label: 'Giriş', searchable: true, render: (v, row) => <MoneyChip value={Number(v ?? 0)} currencyTypeId={Number(row.currencyTypeId ?? 0)} tone="in" /> },
      { key: 'outAmount', label: 'Çıkış', searchable: true, render: (v, row) => <MoneyChip value={Number(v ?? 0)} currencyTypeId={Number(row.currencyTypeId ?? 0)} tone="out" /> },
      { key: 'balance', label: 'Bakiye', searchable: true, render: (v, row) => <BalanceChip value={Number(v ?? 0)} currencyTypeId={Number(row.currencyTypeId ?? 0)} /> },
      {
        key: 'actions',
        label: '',
        render: (_v, row) => (
          <div className="flex items-center justify-end">
            <button
              type="button"
              className="inline-flex items-center gap-1 h-[24px] px-2 rounded-md text-[10px] font-medium bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-100 transition-colors"
              onClick={(e) => {
                e.stopPropagation()
                void openDetail(row)
              }}
            >
              Detay
            </button>
          </div>
        )
      }
    ],
    [bankAccounts, balancesById]
  )

  return (
    <div>
      <Modal
        isOpen={detailOpen}
        onClose={() => {
          if (detailLoading) return
          setDetailOpen(false)
          setDetailAccountId(null)
        }}
        title={selectedAccount ? `${selectedAccount.accountCode} - ${selectedAccount.accountName}` : 'Banka Detay'}
        containerClassName="max-w-6xl max-h-[95vh]"
        footer={
          <button
            type="button"
            disabled={detailLoading}
            onClick={() => setDetailOpen(false)}
            className="px-4 py-2 rounded-md text-xs font-semibold border border-gray-200 text-gray-700 hover:bg-gray-50"
          >
            Kapat
          </button>
        }
      >
        {detailLoading && <div className="text-xs text-gray-500">Yükleniyor...</div>}

        {!detailLoading && (
          <div className="space-y-4">
            {/*
              Detay özet kutuları sembolsüz `formatMoney` çağırıyordu, yani euro/sterlin
              hesabın bakiyesi de ₺ ile yazılıyordu (tablo satırları zaten doğruydu).
              Simge hesabın kendi para biriminden geliyor.
            */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="bg-gray-50 border border-gray-100 rounded-lg p-3">
                <div className="text-[11px] text-gray-500">Bakiye ({currencyLabel(Number(selectedAccount?.currencyTypeId ?? 0))})</div>
                <div className="text-sm font-semibold text-gray-900">
                  {formatMoney(Number(balancesById[String(detailAccountId ?? '')]?.balance ?? 0), Number(selectedAccount?.currencyTypeId ?? 0))}
                </div>
              </div>
              <div className="bg-gray-50 border border-gray-100 rounded-lg p-3">
                <div className="text-[11px] text-gray-500">Giriş ({currencyLabel(Number(selectedAccount?.currencyTypeId ?? 0))})</div>
                <div className="text-sm font-semibold text-gray-900">
                  {formatMoney(Number(balancesById[String(detailAccountId ?? '')]?.inAmount ?? 0), Number(selectedAccount?.currencyTypeId ?? 0))}
                </div>
              </div>
              <div className="bg-gray-50 border border-gray-100 rounded-lg p-3">
                <div className="text-[11px] text-gray-500">Çıkış ({currencyLabel(Number(selectedAccount?.currencyTypeId ?? 0))})</div>
                <div className="text-sm font-semibold text-gray-900">
                  {formatMoney(Number(balancesById[String(detailAccountId ?? '')]?.outAmount ?? 0), Number(selectedAccount?.currencyTypeId ?? 0))}
                </div>
              </div>
            </div>

            <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-visible relative">
              <div className="px-4 py-3 border-b border-gray-100 text-xs font-semibold text-gray-700">Banka Hareketleri</div>
              <Table
          onRefresh={() => void load()} columns={txColumns} data={txRows} showColumnFilters />
            </div>

          </div>
        )}
      </Modal>

      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-gray-900 tracking-tight">Banka Raporları</h1>
          <p className="text-xs text-gray-400 mt-0.5">Raporlar / Banka Raporları</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
            <input
              value={globalSearch}
              onChange={(e) => setGlobalSearch(e.target.value)}
              placeholder="Arama..."
              className="h-[34px] w-72 pl-8 pr-3 text-xs border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-400 transition"
            />
          </div>
          {/*
            "Yenile" yerine İŞLEM TAKİBİ (2026-09-01 kullanıcı isteği). Rapor sayfası hesap
            bazında ÖZET gösteriyor; hareketlerin tamamını görmek için ayrı bir ekrana gitmek
            gerekiyordu. Pencere zaten ortak tabloyu kullanıyor, kendi süzgeçleri ve
            yenilemesi orada.
          */}
          <button
            type="button"
            onClick={() => setIslemTakibiAcik(true)}
            className="h-[34px] inline-flex items-center gap-1.5 px-4 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
            İşlem Takibi
          </button>
        </div>
      </div>

      {error && <div className="mb-3 text-xs font-semibold text-red-600">{error}</div>}
      {loading && <div className="mt-2 text-xs text-gray-500">Yükleniyor...</div>}

      <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-visible relative">
        <Table
          onRefresh={() => void load()} columns={columns} data={filteredRows} showColumnFilters globalSearch={globalSearch}
          /*
            AÇILIŞ SÜZGECİ: TL + Vadesiz Hesap (2026-08-24, kullanıcı isteği).

            61 hesabın çoğu kredi kartı, POS ve teminat hesabı; günlük bakılan yer vadesiz TL
            hesaplardır. Süzgeç KİLİTLİ DEĞİL, yalnızca başlangıç değeri — başlıktaki
            açılır listeden "Tümünü Seç" ile kaldırılabilir.

            Değerler `currencyOptions` / `accountTypeOptions` ile aynı: TL = 1,
            Vadesiz Hesap = 0.
          */
          initialColumnFilters={{
            currencyTypeId: { selectedOptions: ['1'], value: '1', operator: 'in' },
            accountType: { selectedOptions: ['0'], value: '0', operator: 'in' }
          }}
        />
      </div>

      <IslemTakibiModal
        acik={islemTakibiAcik}
        onKapat={() => setIslemTakibiAcik(false)}
        kaynak="banka"
        bankaHesaplari={bankAccounts}
      />

    </div>
  )
}
