import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Table, { type TableColumn } from '../components/Table'
import Modal from '../components/Modal'
import CashReportDetailPage from './CashReportDetailPage'
import { MoneyChip, BalanceChip, CurrencyChip, NameChip } from '../components/reportChips'
import { fetchCashAccountReport, type CashAccountReportListItemDto } from '../api/cashAccounts'
import * as XLSX from 'xlsx'
import IslemTakibiModal from '../components/IslemTakibiModal'

// CurrencyTypeId convention used across the ERP: 0/1 = TRY, 2 = EUR, 3 = USD, 4 = GBP.
// This page used to be shifted by one (1 = DOLAR, 3 = STERLİN), so every TL kasa was
// labelled DOLAR and every dolar kasa STERLİN.
const cashCurrencyOptions: Array<{ value: number; label: string }> = [
  { value: 1, label: 'TL' },
  { value: 2, label: 'EURO' },
  { value: 3, label: 'DOLAR' },
  { value: 4, label: 'STERLİN' }
]

const currencySymbols: Record<number, string> = { 1: '₺', 2: '€', 3: '$', 4: '£' }

function normalizeCurrency(v: number) {
  const n = Number(v ?? 0)
  return n === 0 ? 1 : n
}

function cashCurrencyLabel(v: number) {
  const n = normalizeCurrency(v)
  return cashCurrencyOptions.find((x) => x.value === n)?.label ?? String(n)
}

function formatMoney(n: number, currencyTypeId: number = 1) {
  const v = Number(n ?? 0)
  const symbol = currencySymbols[normalizeCurrency(currencyTypeId)] ?? '₺'
  return `${symbol}${v.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

type Row = CashAccountReportListItemDto & {
  actions: string
}

export default function CashReportPage() {
  const navigate = useNavigate()
  // Detay artık açılır pencerede; boş = kapalı.
  const [detailAccountId, setDetailAccountId] = useState<string | null>(null)
  /** İşlem takibi penceresi açık mı. */
  const [islemTakibiAcik, setIslemTakibiAcik] = useState(false)

  const [items, setItems] = useState<CashAccountReportListItemDto[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [globalSearch, setGlobalSearch] = useState('')

  const load = async () => {
    const ac = new AbortController()
    try {
      setLoading(true)
      setError(null)
      const data = await fetchCashAccountReport({ signal: ac.signal })
      setItems(data ?? [])
    } catch (e: any) {
      setError(String(e?.message ?? 'Kasa raporları alınamadı'))
      setItems([])
    } finally {
      setLoading(false)
    }
    return () => ac.abort()
  }

  useEffect(() => {
    void load()
  }, [])

  const rows: Row[] = useMemo(() => {
    return (items ?? []).map((x) => ({
      ...x,
      actions: ''
    }))
  }, [items])

  const filteredRows = useMemo(() => {
    const q = globalSearch.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) =>
      String(r.code ?? '').toLowerCase().includes(q) ||
      String(r.name ?? '').toLowerCase().includes(q) ||
      cashCurrencyLabel(Number(r.currencyTypeId ?? 0)).toLowerCase().includes(q)
    )
  }, [rows, globalSearch])

  // Kasalar farklı para birimlerinde olabilir; TL + EUR + USD tek bir sayıda toplanamaz.
  // Bu yüzden toplamlar para birimi bazında ayrı ayrı gösteriliyor.
  const totalsByCurrency = useMemo(() => {
    const map = new Map<number, { currencyTypeId: number; inAmount: number; outAmount: number; balance: number }>()
    for (const r of filteredRows) {
      const cur = normalizeCurrency(Number(r.currencyTypeId ?? 0))
      const acc = map.get(cur) ?? { currencyTypeId: cur, inAmount: 0, outAmount: 0, balance: 0 }
      acc.inAmount += Number(r.inAmount ?? 0)
      acc.outAmount += Number(r.outAmount ?? 0)
      acc.balance += Number(r.balance ?? 0)
      map.set(cur, acc)
    }
    return Array.from(map.values()).sort((a, b) => a.currencyTypeId - b.currencyTypeId)
  }, [filteredRows])

  const columns: TableColumn<Row>[] = useMemo(
    () => [
      { key: 'code', label: 'Kasa Kodu', searchable: true },
      // Kasa adı renkli: HASPOLAT / MAĞAZA / MUHASEBE satırları listede gözle ayrılsın.
      // Renk addan türüyor, yeni kasa açılınca kendiliğinden bir renk alıyor.
      { key: 'name', label: 'Kasa Adı', searchable: true, render: (v) => <NameChip text={v} /> },
      {
        key: 'currencyTypeId',
        label: 'Döviz Tipi',
        searchable: true,
        filter: {
          type: 'select',
          options: [{ label: 'Tümünü Seç', value: '' }, ...cashCurrencyOptions.map((o) => ({ label: o.label, value: String(o.value) }))]
        },
        render: (v) => <CurrencyChip currencyTypeId={Number(v ?? 0)} label={cashCurrencyLabel(Number(v ?? 0))} />
      },
      { key: 'inAmount', label: 'Giriş', searchable: true, render: (v, row) => <MoneyChip value={Number(v ?? 0)} tone="in" format={(x) => formatMoney(x, Number(row.currencyTypeId ?? 0))} /> },
      { key: 'outAmount', label: 'Çıkış', searchable: true, render: (v, row) => <MoneyChip value={Number(v ?? 0)} tone="out" format={(x) => formatMoney(x, Number(row.currencyTypeId ?? 0))} /> },
      { key: 'balance', label: 'Bakiye', searchable: true, render: (v, row) => <BalanceChip value={Number(v ?? 0)} format={(x) => formatMoney(x, Number(row.currencyTypeId ?? 0))} /> },
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
                // Banka raporundaki gibi AÇILIR PENCEREDE: ayrı sayfaya gidip geri dönmek
                // listenin süzgeçlerini ve sayfa numarasını sıfırlıyordu.
                setDetailAccountId(String((row as any).id ?? ''))
              }}
            >
              Detay
            </button>
          </div>
        )
      }
    ],
    []
  )

  const exportToExcel = () => {
    const excelData = filteredRows.map((r) => ({
      'Kasa Kodu': String(r.code ?? ''),
      'Kasa Adı': String(r.name ?? ''),
      'Döviz Tipi': cashCurrencyLabel(Number(r.currencyTypeId ?? 0)),
      'Giriş': Number(r.inAmount ?? 0),
      'Çıkış': Number(r.outAmount ?? 0),
      'Bakiye': Number(r.balance ?? 0)
    }))

    for (const t of totalsByCurrency) {
      excelData.push({
        'Kasa Kodu': `TOPLAM (${cashCurrencyLabel(t.currencyTypeId)})`,
        'Kasa Adı': '',
        'Döviz Tipi': cashCurrencyLabel(t.currencyTypeId),
        'Giriş': t.inAmount,
        'Çıkış': t.outAmount,
        'Bakiye': t.balance
      })
    }

    const ws = XLSX.utils.json_to_sheet(excelData)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Kasa Raporları')

    const colWidths = [
      { wch: 15 },
      { wch: 20 },
      { wch: 12 },
      { wch: 18 },
      { wch: 18 },
      { wch: 18 }
    ]
    ws['!cols'] = colWidths

    XLSX.writeFile(wb, 'kasa-raporlari.xlsx')
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-gray-900 tracking-tight">Kasa Raporu</h1>
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
            onClick={exportToExcel}
            disabled={filteredRows.length === 0}
            className="h-[34px] inline-flex items-center gap-1.5 px-4 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /><polyline points="10 9 9 9 8 9" /></svg>
            Excel İndir
          </button>
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
          onRefresh={() => void load()} columns={columns} data={filteredRows} showColumnFilters globalSearch={globalSearch} />
      </div>

      {filteredRows.length > 0 && (
        <div className="mt-0 bg-emerald-50 border border-emerald-200 rounded-b-xl shadow-sm overflow-hidden -mt-[1px]">
          {totalsByCurrency.map((t) => (
            <div key={t.currencyTypeId} className="grid grid-cols-7 text-[11px] font-bold text-emerald-900 border-b border-emerald-100 last:border-b-0">
              <div className="px-3 py-2.5">TOPLAM</div>
              <div className="px-3 py-2.5" />
              <div className="px-3 py-2.5">{cashCurrencyLabel(t.currencyTypeId)}</div>
              <div className="px-3 py-2.5 text-right">{formatMoney(t.inAmount, t.currencyTypeId)}</div>
              <div className="px-3 py-2.5 text-right">{formatMoney(t.outAmount, t.currencyTypeId)}</div>
              <div className="px-3 py-2.5 text-right">{formatMoney(t.balance, t.currencyTypeId)}</div>
              <div className="px-3 py-2.5" />
            </div>
          ))}
        </div>
      )}

      {/* Kasa hareket dökümü — banka raporundaki gibi açılır pencerede. */}
      <Modal
        isOpen={Boolean(detailAccountId)}
        onClose={() => setDetailAccountId(null)}
        title="Kasa Hareketleri"
        maxWidth="max-w-[1400px]"
        scrollable
      >
        {detailAccountId && (
          <CashReportDetailPage cashAccountId={detailAccountId} onClose={() => setDetailAccountId(null)} />
        )}
      </Modal>

      <IslemTakibiModal
        acik={islemTakibiAcik}
        onKapat={() => setIslemTakibiAcik(false)}
        kaynak="kasa"
      />

    </div>
  )
}
