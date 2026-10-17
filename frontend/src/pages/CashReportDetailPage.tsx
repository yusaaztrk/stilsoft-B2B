import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import Table, { type TableColumn } from '../components/Table'
import { MoneyChip, BalanceChip, CurrencyChip, formatDateTr } from '../components/reportChips'
import { fetchCashAccountTransactions, type CashAccountTransactionDto } from '../api/cashAccountTransactions'
import { fetchCashAccounts, type CashAccountDto } from '../api/cashAccounts'
import { isInflowDirection } from '../utils/transactionDirection'
import * as XLSX from 'xlsx'

type Row = CashAccountTransactionDto & {
  actions: string
  documentNoText: string
  currencyText: string
  inAmount: number
  outAmount: number
  balance: number
  /** Devir satırı: hareket değil, listenin başlangıç noktası. Süzgeçlerden muaftır. */
  isOpeningBalance?: boolean
}

const currencySymbols: Record<number, string> = { 1: '₺', 2: '€', 3: '$', 4: '£' }

/**
 * Kasa detayında bütün tutarlar sabit `₺` ile basılıyordu: euro/sterlin kasasının
 * hareketleri de TL görünüyordu (kullanıcı bildirimi). Sayfa tek kasa gösterdiği için
 * simge kasanın kendi para biriminden gelir.
 */
function formatMoney(n: number, currencyTypeId: number = 1) {
  const v = Number(n ?? 0)
  const normalized = Number(currencyTypeId ?? 1) === 0 ? 1 : Number(currencyTypeId ?? 1)
  const symbol = currencySymbols[normalized] ?? '₺'
  return `${symbol}${v.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

const currencyOptions: Array<{ value: number; label: string }> = [
  { value: 1, label: 'TL' },
  { value: 3, label: 'DOLAR' },
  { value: 2, label: 'EURO' },
  { value: 4, label: 'STERLİN' }
]

function currencyLabel(v: number) {
  // 0 da TL (eski varsayılan). Normalize edilmezse eski kasa kaydı etiket yerine ham "0"
  // gösteriyordu — kardeş ekranlar (CariEkstre, YönetimEkstre) bunu zaten yapıyor.
  const normalized = Number(v ?? 0) === 0 ? 1 : Number(v)
  return currencyOptions.find((x) => x.value === normalized)?.label ?? 'TL'
}

/**
 * Kasa hareket dökümü — HEM SAYFA HEM MODAL.
 *
 * Banka detayı bir açılır pencerede, kasa detayı ayrı bir sayfada açılıyordu: aynı işi yapan
 * iki ekran iki farklı şekilde davranıyor, kasada geri dönünce liste süzgeçleri sıfırlanıyordu.
 *
 * Bileşen ikisini de karşılıyor: `cashAccountId` PROP olarak verilirse modal içinde çalışır
 * (adres çubuğu değişmez, "Geri" düğmesi `onClose` çağırır); verilmezse eskisi gibi rotadan
 * okur. Rota kaldırılmadı — dışarıya verilmiş bağlantılar ve yer imleri çalışmaya devam etsin.
 */
export default function CashReportDetailPage({
  cashAccountId: cashAccountIdProp,
  onClose
}: { cashAccountId?: string; onClose?: () => void } = {}) {
  const params = useParams()
  const cashAccountId = cashAccountIdProp ?? params.cashAccountId
  const navigate = useNavigate()

  const id = Number(cashAccountId ?? 0)

  const [accounts, setAccounts] = useState<CashAccountDto[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [items, setItems] = useState<CashAccountTransactionDto[]>([])
  const [globalSearch, setGlobalSearch] = useState('')

  const load = async () => {
    const ac = new AbortController()
    try {
      setLoading(true)
      setError(null)
      const [accs, txs] = await Promise.all([
        fetchCashAccounts({ signal: ac.signal }),
        fetchCashAccountTransactions({ cashAccountId: id, take: 1000 }, { signal: ac.signal })
      ])
      setAccounts(accs ?? [])
      setItems(txs ?? [])
    } catch (e: any) {
      setError(String(e?.message ?? 'Kasa rapor detay alınamadı'))
      setItems([])
    } finally {
      setLoading(false)
    }
    return () => ac.abort()
  }

  useEffect(() => {
    if (!Number.isFinite(id) || id <= 0) return
    void load()
  }, [id])

  const selected = useMemo(() => {
    if (!id) return null
    return accounts.find((x) => x.id === id) ?? null
  }, [accounts, id])

  /** Sayfa tek kasayı gösterir; bütün tutarlar bu kasanın para biriminde yazılır. */
  const accountCurrencyTypeId = useMemo(() => Number((selected as any)?.currencyTypeId ?? 1), [selected])
  const accountCurrencyLabel = useMemo(() => currencyLabel(accountCurrencyTypeId), [accountCurrencyTypeId])

  /**
   * DEVİR (AÇILIŞ) BAKİYESİ (2026-08-22).
   *
   * Bu ekran devri hiç hesaba katmıyordu: yürüyen bakiye sıfırdan başlıyor, kutudaki
   * "Bakiye" de yalnızca giren − çıkan oluyordu. Kasa Raporu listesi ise deviri katıyor
   * (uçta `bakiye = devir + giren − çıkan`), dolayısıyla listeden detaya girince rakam
   * tutmuyordu — MUHASEBE KASA listede 32.530 ₺, detayda 30.030 ₺ görünüyordu.
   */
  const carryAmount = useMemo(() => {
    const v = Number((selected as any)?.lastCarryAmount ?? 0)
    return Number.isFinite(v) ? v : 0
  }, [selected])

  const rows: Row[] = useMemo(() => {
    const selectedAccount = selected
    const curText = currencyLabel(Number(selectedAccount?.currencyTypeId ?? 0))

    const asc = [...(items ?? [])].sort((a, b) => {
      const da = new Date(String(a.date ?? '')).getTime()
      const db = new Date(String(b.date ?? '')).getTime()
      if (da !== db) return da - db
      return Number(a.id ?? 0) - Number(b.id ?? 0)
    })

    let running = carryAmount
    const out: Row[] = []

    /**
     * Devir EN ESKİ satır olarak en başa konur ve yürüyen bakiyeyi başlatır.
     *
     * Giriş/Çıkış sütunları BOŞ bırakılır: devir bir hareket değil. Böylece sütun
     * toplamları (ve alttaki TOPLAM şeridi) Kasa Raporu listesindeki Giriş/Çıkış
     * rakamlarıyla birebir aynı kalıyor; tek fark Bakiye, ki orada da devir zaten olmalı.
     */
    if (carryAmount !== 0) {
      out.push({
        id: 0,
        isOpeningBalance: true,
        actions: '',
        date: String((selected as any)?.lastCarryDate ?? ''),
        documentNoText: '',
        description: 'Kasa devir bakiyesi',
        counterpartyName: 'DEVİR BAKİYESİ',
        currencyText: curText,
        inAmount: 0,
        outAmount: 0,
        balance: carryAmount
      } as unknown as Row)
    }

    for (const x of asc) {
      // `direction` bu uçtan METİN geliyor ("In"/"Out"). Eskiden `Number(x.direction) === 1`
      // deniyordu; NaN olduğu için bütün hareketler çıkış sayılıyor ve bakiye ters çıkıyordu.
      const isIn = isInflowDirection(x.direction)
      const inAmount = isIn ? Number(x.amount ?? 0) : 0
      const outAmount = !isIn ? Number(x.amount ?? 0) : 0
      running = running + (inAmount - outAmount)

      out.push({
        ...x,
        actions: '',
        documentNoText: String((x as any).documentNo ?? ''),
        currencyText: curText,
        inAmount,
        outAmount,
        balance: running
      })
    }

    return out
  }, [items, selected, carryAmount])

  const filteredRows = useMemo(() => {
    const q = globalSearch.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) =>
      // Devir satırı aramadan da muaf: bakiyenin başlangıcı olmadan liste yanlış okunur.
      r.isOpeningBalance === true ||
      String(r.date ?? '').toLowerCase().includes(q) ||
      String(r.counterpartyName ?? '').toLowerCase().includes(q) ||
      String(r.counterpartyCode ?? '').toLowerCase().includes(q) ||
      String(r.description ?? '').toLowerCase().includes(q) ||
      String(r.cashAccountCode ?? '').toLowerCase().includes(q)
    )
  }, [rows, globalSearch])

  const totals = useMemo(() => {
    let inTotal = 0
    let outTotal = 0
    for (const r of rows) {
      inTotal += Number(r.inAmount ?? 0)
      outTotal += Number(r.outAmount ?? 0)
    }
    // Devir satırı Giriş/Çıkış taşımıyor; bakiyeye AYRICA eklenir.
    const balance = carryAmount + inTotal - outTotal
    return { inTotal, outTotal, balance }
  }, [rows, carryAmount])

  const columns: TableColumn<Row>[] = useMemo(
    () => [
      // Tarih gg.aa.yyyy: uçtan ISO geliyor ve Kasa İşlemleri ekranıyla farklı görünüyordu.
      { key: 'date', label: 'Tarih', searchable: true, width: '108px', filter: { type: 'date' }, render: (v) => formatDateTr(v) },
      { key: 'documentNoText', label: 'Belge No', searchable: true, width: '140px' },
      { key: 'description', label: 'Açıklama', searchable: true },
      { key: 'counterpartyName', label: 'Cari Adı', searchable: true },
      {
        key: 'currencyText',
        label: 'Döviz Tipi',
        searchable: true,
        width: '110px',
        filter: { type: 'select', options: [{ label: 'Tümünü Seç', value: '' }, ...currencyOptions.map((o) => ({ label: o.label, value: o.label }))] },
        render: (_v, row) => <CurrencyChip currencyTypeId={Number((row as any).currencyTypeId ?? accountCurrencyTypeId)} label={String((row as any).currencyText ?? '')} />
      },
      { key: 'inAmount', label: `Giriş (${accountCurrencyLabel})`, searchable: true, render: (v) => <MoneyChip value={Number(v ?? 0)} tone="in" format={(x) => formatMoney(x, accountCurrencyTypeId)} /> },
      { key: 'outAmount', label: `Çıkış (${accountCurrencyLabel})`, searchable: true, render: (v) => <MoneyChip value={Number(v ?? 0)} tone="out" format={(x) => formatMoney(x, accountCurrencyTypeId)} /> },
      { key: 'balance', label: `Bakiye (${accountCurrencyLabel})`, searchable: true, render: (v) => <BalanceChip value={Number(v ?? 0)} format={(x) => formatMoney(x, accountCurrencyTypeId)} /> },
      { key: 'createUser', label: 'İşlem Yapan', searchable: true, width: '130px' },
      { key: 'actions', label: '', render: () => <div className="w-6" /> }
    ],
    // Para birimi değişince başlıklar ve simgeler de değişmeli.
    [accountCurrencyTypeId, accountCurrencyLabel]
  )

  const exportToExcel = () => {
    const accountLabel = selected ? `${selected.code} - ${String(selected.name ?? '').trim()}` : 'Kasa Detay'
    const excelData = filteredRows.map((r) => ({
      'Tarih': String(r.date ?? '').slice(0, 10),
      'Belge No': String(r.documentNoText ?? ''),
      'Açıklama': String(r.description ?? ''),
      'Cari Adı': String(r.counterpartyName ?? ''),
      'Döviz Tipi': String(r.currencyText ?? ''),
      // Excel'de de tutarın hangi paradan olduğu sütun başlığında yazar.
      [`Giriş (${accountCurrencyLabel})`]: Number(r.inAmount ?? 0),
      [`Çıkış (${accountCurrencyLabel})`]: Number(r.outAmount ?? 0),
      [`Bakiye (${accountCurrencyLabel})`]: Number(r.balance ?? 0),
      'İşlem Yapan': String(r.createUser ?? '')
    }))

    excelData.push({
      'Tarih': 'TOPLAM',
      'Belge No': '',
      'Açıklama': '',
      'Cari Adı': '',
      'Döviz Tipi': accountCurrencyLabel,
      [`Giriş (${accountCurrencyLabel})`]: totals.inTotal,
      [`Çıkış (${accountCurrencyLabel})`]: totals.outTotal,
      [`Bakiye (${accountCurrencyLabel})`]: totals.balance,
      'İşlem Yapan': ''
    })

    const ws = XLSX.utils.json_to_sheet(excelData)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Kasa Detay')

    const colWidths = [
      { wch: 12 },
      { wch: 15 },
      { wch: 30 },
      { wch: 25 },
      { wch: 12 },
      { wch: 18 },
      { wch: 18 },
      { wch: 18 },
      { wch: 15 }
    ]
    ws['!cols'] = colWidths

    const safeName = String(selected?.code ?? 'kasa').replace(/[^a-zA-Z0-9_-]/g, '_')
    XLSX.writeFile(wb, `kasa-detay-${safeName}.xlsx`)
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-gray-900 tracking-tight">
            Kasa Rapor Detay{selected ? ` : ${selected.code} - ${String(selected.name ?? '').trim()}` : ''}
          </h1>
          <p className="text-xs text-gray-400 mt-0.5">Raporlar / Kasa Raporları</p>
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
          <button
            type="button"
            onClick={() => (onClose ? onClose() : navigate('/reports/kasaRaporlari'))}
            className="h-[34px] inline-flex items-center gap-1.5 px-4 text-xs font-semibold rounded-lg bg-white hover:bg-gray-50 text-gray-700 border border-gray-200 shadow-sm transition"
          >
            {onClose ? 'Kapat' : 'Geri'}
          </button>
          <button
            type="button"
            onClick={exportToExcel}
            disabled={filteredRows.length === 0}
            className="h-[34px] inline-flex items-center gap-1.5 px-4 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /><polyline points="10 9 9 9 8 9" /></svg>
            Excel İndir
          </button>
          <button
            type="button"
            onClick={() => void load()}
            className="h-[34px] inline-flex items-center gap-1.5 px-4 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" /></svg>
            Yenile
          </button>
        </div>
      </div>

      {error && <div className="mb-3 text-xs font-semibold text-red-600">{error}</div>}
      {loading && <div className="mt-2 text-xs text-gray-500">Yükleniyor...</div>}

      {!loading && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="bg-gray-50 border border-gray-100 rounded-lg p-3">
              <div className="text-[11px] text-gray-500">Devir</div>
              <div className="text-sm font-semibold text-gray-900">{formatMoney(carryAmount, accountCurrencyTypeId)}</div>
            </div>
            <div className="bg-gray-50 border border-gray-100 rounded-lg p-3">
              <div className="text-[11px] text-gray-500">Bakiye</div>
              <div className="text-sm font-semibold text-gray-900">{formatMoney(Number(totals.balance ?? 0), accountCurrencyTypeId)}</div>
            </div>
            <div className="bg-gray-50 border border-gray-100 rounded-lg p-3">
              <div className="text-[11px] text-gray-500">Giriş</div>
              <div className="text-sm font-semibold text-gray-900">{formatMoney(Number(totals.inTotal ?? 0), accountCurrencyTypeId)}</div>
            </div>
            <div className="bg-gray-50 border border-gray-100 rounded-lg p-3">
              <div className="text-[11px] text-gray-500">Çıkış</div>
              <div className="text-sm font-semibold text-gray-900">{formatMoney(Number(totals.outTotal ?? 0), accountCurrencyTypeId)}</div>
            </div>
          </div>

          <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-visible relative">
            <div className="px-4 py-3 border-b border-gray-100 text-xs font-semibold text-gray-700">Kasa Hareketleri</div>
            <Table
          onRefresh={() => void load()} columns={columns} data={filteredRows} showColumnFilters globalSearch={globalSearch} />
          </div>

          {filteredRows.length > 0 && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl shadow-sm overflow-hidden">
              <div className="grid grid-cols-10 text-[11px] font-bold text-emerald-900">
                <div className="px-3 py-2.5">TOPLAM</div>
                <div className="px-3 py-2.5" />
                <div className="px-3 py-2.5" />
                <div className="px-3 py-2.5" />
                <div className="px-3 py-2.5" />
                <div className="px-3 py-2.5 text-right">{formatMoney(totals.inTotal, accountCurrencyTypeId)}</div>
                <div className="px-3 py-2.5 text-right">{formatMoney(totals.outTotal, accountCurrencyTypeId)}</div>
                <div className="px-3 py-2.5 text-right">{formatMoney(totals.balance, accountCurrencyTypeId)}</div>
                <div className="px-3 py-2.5" />
                <div className="px-3 py-2.5" />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
