import { useCallback, useEffect, useMemo, useState } from 'react'
import { ShieldCheck, Search, ArrowRight, RefreshCw, FileSpreadsheet } from 'lucide-react'
import * as XLSX from 'xlsx'
import NotificationPopup from '../components/NotificationPopup'
import Table, { type TableColumn } from '../components/Table'
import { fetchWarrantyExchanges, type WarrantyExchangeRow } from '../api/warrantyExchanges'

/**
 * RAPORLAR → GARANTİ DEĞİŞİM RAPORU (kullanıcı kuralı, 2026-08-14).
 *
 * "Yapılan tüm işlemler görünecek: kime, ne zaman, ne vermişiz."
 * AppDataTable / Table bileşeni ile arama, sıralama ve kolon bazlı filtreleme desteklenir.
 */
const tl = (n: number) =>
  new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' }).format(Number(n) || 0)

/** Satır tutarı KENDİ para biriminde; toplamlar için TL karşılığı kullanılır. */
const money = (n: number, code: string = 'TRY') =>
  new Intl.NumberFormat('tr-TR', { style: 'currency', currency: code || 'TRY' }).format(Number(n) || 0)

export default function GarantiDegisimRaporuPage() {
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [rows, setRows] = useState<WarrantyExchangeRow[]>([])

  const [search, setSearch] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        setLoading(true)
        const list = await fetchWarrantyExchanges(
          {
            search: search.trim() || undefined,
            startDate: startDate || undefined,
            endDate: endDate || undefined
          },
          { signal }
        )
        setRows(list ?? [])
      } catch (e: any) {
        if (e?.name !== 'AbortError') setError(String(e?.message ?? 'Rapor alınamadı'))
      } finally {
        setLoading(false)
      }
    },
    [search, startDate, endDate]
  )

  useEffect(() => {
    const ac = new AbortController()
    void load(ac.signal)
    return () => ac.abort()
  }, [])

  /**
   * TOPLAMLAR TL KARŞILIĞINDAN ALINIR.
   *
   * Satırlar farklı para birimlerinde olabiliyor; `differenceAmount` toplanırsa 100 USD ile
   * 100 TL aynı sayı sanılır ve toplam anlamsız çıkar. Backend her satırda
   * `tryDifferenceAmount` (kaydın kendi kuruyla dondurulmuş TL karşılığı) gönderiyor.
   * Eski kayıtlar TL ve kur 1 olduğu için değer aynı kalır.
   */
  const totals = useMemo(() => {
    let debit = 0
    let credit = 0
    let postedCount = 0
    const currencies = new Set<string>()
    for (const r of rows) {
      currencies.add(r.currencyCode ?? 'TRY')
      if (!r.postedToLedger) continue
      postedCount += 1
      const tryValue = r.tryDifferenceAmount ?? r.differenceAmount
      if (r.differenceAmount > 0) debit += tryValue
      else credit += Math.abs(tryValue)
    }
    return { debit, credit, postedCount, mixedCurrency: currencies.size > 1 }
  }, [rows])

  const exportToExcel = () => {
    if (rows.length === 0) return
    const exportData = rows.map((r) => ({
      'İşlem No': r.exchangeNo,
      'Tarih': new Date(r.date).toLocaleDateString('tr-TR'),
      'Cari Kodu': r.customerCode,
      'Cari Adı': r.customerName ?? '',
      'Fatura No': r.invoiceNo ?? '',
      'Gelen Ürün Kodu': r.returnedStockCode,
      'Gelen Ürün Adı': r.returnedProductName ?? '',
      'Gelen Miktar': r.returnedQuantity,
      'Gelen Birim Fiyat': r.returnedUnitPrice,
      'Gelen Seri No': r.returnedSerialNo ?? '',
      'Verilen Ürün Kodu': r.givenStockCode,
      'Verilen Ürün Adı': r.givenProductName ?? '',
      'Verilen Miktar': r.givenQuantity,
      'Verilen Birim Fiyat': r.givenUnitPrice,
      'Verilen Seri No': r.givenSerialNo ?? '',
      'Çıkış Deposu': r.outWarehouseName ?? r.outWarehouseCode,
      'Garanti Deposu': r.warrantyWarehouseName ?? r.warrantyWarehouseCode,
      'İndirim Tutarı': r.discountAmount,
      'Para Birimi': r.currencyCode ?? 'TRY',
      'Kur': r.currencyRate ?? 1,
      'Fark Tutarı': r.differenceAmount,
      'Fark (TL Karşılığı)': r.tryDifferenceAmount ?? r.differenceAmount,
      'Ekstre Durumu': r.postedToLedger ? (r.differenceAmount > 0 ? 'BORÇ' : 'ALACAK') : 'İşlenmedi',
      'İşlemi Yapan': r.createUser ?? '',
      'İşlem Zamanı': new Date(r.createTime).toLocaleString('tr-TR'),
      'Açıklama': r.description ?? ''
    }))

    const ws = XLSX.utils.json_to_sheet(exportData)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Garanti Değişim')
    const fileName = `Garanti_Degisim_Raporu_${new Date().toISOString().slice(0, 10)}.xlsx`
    XLSX.writeFile(wb, fileName)
  }

  const columns = useMemo<TableColumn<WarrantyExchangeRow>[]>(
    () => [
      {
        key: 'exchangeNo',
        label: 'İşlem No',
        sortable: true,
        searchable: true,
        filter: { type: 'text' },
        render: (_, r) => <span className="font-bold text-slate-900 font-mono text-[11px]">{r.exchangeNo}</span>
      },
      {
        key: 'date',
        label: 'Tarih',
        sortable: true,
        filter: { type: 'date' },
        render: (_, r) => <span className="whitespace-nowrap">{new Date(r.date).toLocaleDateString('tr-TR')}</span>
      },
      {
        key: 'customerName',
        label: 'Cari',
        sortable: true,
        searchable: true,
        filter: { type: 'text' },
        render: (_, r) => (
          <div className="min-w-0 max-w-[220px]">
            <div className="font-semibold text-slate-800 truncate" title={r.customerName ?? r.customerCode}>
              {r.customerName ?? r.customerCode}
            </div>
            <div className="text-[10px] text-slate-500 font-mono">{r.customerCode}</div>
          </div>
        )
      },
      {
        key: 'invoiceNo',
        label: 'Fatura No',
        sortable: true,
        searchable: true,
        filter: { type: 'text' },
        render: (_, r) => (
          <span className="font-mono text-slate-700 font-medium text-[11px]">{r.invoiceNo ?? '—'}</span>
        )
      },
      {
        key: 'returnedProductName',
        label: 'Gelen Ürün (Arızalı)',
        searchable: true,
        filter: { type: 'text' },
        render: (_, r) => (
          <div className="min-w-0 max-w-[240px] space-y-0.5">
            <div className="text-rose-800 font-semibold truncate text-[11px]" title={r.returnedProductName ?? r.returnedStockCode}>
              {r.returnedProductName ?? r.returnedStockCode}
            </div>
            <div className="text-[10px] text-slate-500">
              {/* Birim fiyat satırın KENDİ para biriminde: `tl(...)` ile basılınca 500 $'lık
                  cihaz "500 ₺" görünüyor, aynı satırdaki fark kolonu ise "500 $" diyordu. */}
              <span className="font-mono font-medium">{r.returnedStockCode}</span> • {r.returnedQuantity} adet • {money(r.returnedUnitPrice, r.currencyCode ?? 'TRY')}
              {r.returnedSerialNo ? <span className="text-slate-600 font-mono"> • SN: {r.returnedSerialNo}</span> : ''}
            </div>
          </div>
        )
      },
      {
        key: 'givenProductName',
        label: 'Verilen Ürün (Sağlam)',
        searchable: true,
        filter: { type: 'text' },
        render: (_, r) => (
          <div className="min-w-0 max-w-[240px] space-y-0.5">
            <div className="text-emerald-800 font-semibold truncate text-[11px]" title={r.givenProductName ?? r.givenStockCode}>
              {r.givenProductName ?? r.givenStockCode}
            </div>
            <div className="text-[10px] text-slate-500">
              <span className="font-mono font-medium">{r.givenStockCode}</span> • {r.givenQuantity} adet • {money(r.givenUnitPrice, r.currencyCode ?? 'TRY')}
              {r.givenSerialNo ? <span className="text-slate-600 font-mono"> • SN: {r.givenSerialNo}</span> : ''}
            </div>
          </div>
        )
      },
      {
        key: 'outWarehouseName',
        label: 'Depolar',
        searchable: true,
        filter: { type: 'text' },
        render: (_, r) => (
          <div className="flex items-center gap-1 text-[10px] text-slate-700 whitespace-nowrap">
            <span title="Çıkış Deposu" className="text-slate-600 truncate max-w-[90px]">{r.outWarehouseName ?? r.outWarehouseCode}</span>
            <ArrowRight size={10} className="text-slate-400 shrink-0" />
            <span title="Garanti Deposu" className="font-semibold text-rose-700 truncate max-w-[90px]">
              {r.warrantyWarehouseName ?? r.warrantyWarehouseCode}
            </span>
          </div>
        )
      },
      {
        key: 'discountAmount',
        label: 'İndirim',
        sortable: true,
        filter: { type: 'number' },
        render: (_, r) => (
          <span className="font-medium text-slate-700 whitespace-nowrap">
            {r.discountAmount ? money(r.discountAmount, r.currencyCode ?? 'TRY') : '—'}
          </span>
        )
      },
      {
        key: 'differenceAmount',
        label: 'Fark',
        sortable: true,
        filter: { type: 'number' },
        render: (_, r) => (
          <span
            className={`font-bold font-mono whitespace-nowrap ${
              r.differenceAmount > 0 ? 'text-rose-700' : r.differenceAmount < 0 ? 'text-emerald-700' : 'text-slate-400'
            }`}
          >
            {money(Math.abs(r.differenceAmount), r.currencyCode ?? 'TRY')}
          </span>
        )
      },
      {
        key: 'postedToLedger',
        label: 'Ekstre',
        filter: {
          type: 'select',
          options: [
            { label: 'Borç', value: 'borc' },
            { label: 'Alacak', value: 'alacak' },
            { label: 'İşlenmedi', value: 'islenmedi' }
          ]
        },
        render: (_, r) =>
          r.postedToLedger ? (
            <span className="px-1.5 py-0.5 rounded bg-indigo-50 border border-indigo-200 text-indigo-800 text-[10px] font-bold whitespace-nowrap">
              {r.differenceAmount > 0 ? 'BORÇ' : 'ALACAK'}
            </span>
          ) : (
            <span className="text-[10px] text-slate-400 whitespace-nowrap">İşlenmedi</span>
          )
      },
      {
        key: 'createUser',
        label: 'İşlemi Yapan',
        sortable: true,
        searchable: true,
        filter: { type: 'text' },
        render: (_, r) => (
          <div className="min-w-0 whitespace-nowrap">
            <div className="text-slate-700 font-medium text-[11px]">{r.createUser ?? '—'}</div>
            <div className="text-[10px] text-slate-400">{new Date(r.createTime).toLocaleString('tr-TR')}</div>
          </div>
        )
      }
    ],
    []
  )

  return (
    <div className="p-4 space-y-4">
      <NotificationPopup isOpen={Boolean(error)} variant="error" title="Hata" message={error ?? ''} onClose={() => setError(null)} />

      {/* BAŞLIK */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-indigo-600 text-white flex items-center justify-center shadow-xs">
            <ShieldCheck size={18} />
          </div>
          <div>
            <div className="text-base font-bold text-slate-900">Garanti Değişim Raporu</div>
            <div className="text-xs text-slate-500">Raporlar / Garanti Değişim Raporu</div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={exportToExcel}
            disabled={rows.length === 0}
            className="h-9 inline-flex items-center gap-1.5 px-3.5 text-xs font-semibold rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <FileSpreadsheet size={15} />
            Excel İndir
          </button>
        </div>
      </div>

      {/* FİLTRE KARTI */}
      <div className="bg-white border border-slate-200 rounded-2xl p-3 shadow-2xs">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
          <div className="md:col-span-2 space-y-1">
            <div className="text-[11px] font-semibold text-slate-600 uppercase tracking-wide">Genel Arama</div>
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void load()
                }}
                placeholder="İşlem no, cari, ürün, fatura no, seri no ara..."
                className="input-base h-9 text-xs w-full pl-8"
                data-no-capitalize="true"
              />
            </div>
          </div>

          <div className="space-y-1">
            <div className="text-[11px] font-semibold text-slate-600 uppercase tracking-wide">Başlangıç Tarihi</div>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="input-base h-9 text-xs w-full" />
          </div>

          <div className="flex gap-2">
            <div className="flex-1 space-y-1">
              <div className="text-[11px] font-semibold text-slate-600 uppercase tracking-wide">Bitiş Tarihi</div>
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="input-base h-9 text-xs w-full" />
            </div>
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className="h-9 mt-auto px-3.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold inline-flex items-center gap-1.5 disabled:opacity-50 cursor-pointer shadow-xs transition"
            >
              <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
              Filtrele
            </button>
          </div>
        </div>
      </div>

      {/* ÖZET KARTLAR */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-2xs">
          <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">İşlem Sayısı</div>
          <div className="text-lg font-black text-slate-900 mt-0.5">{rows.length}</div>
        </div>
        <div className="bg-white border border-rose-200 bg-rose-50/20 rounded-xl p-3 shadow-2xs">
          <div className="text-[10px] font-bold text-rose-600 uppercase tracking-wider">
            Ekstreye İşlenen Borç{totals.mixedCurrency ? ' (TL karşılığı)' : ''}
          </div>
          <div className="text-lg font-black text-rose-700 mt-0.5">{tl(totals.debit)}</div>
        </div>
        <div className="bg-white border border-emerald-200 bg-emerald-50/20 rounded-xl p-3 shadow-2xs">
          <div className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider">
            Ekstreye İşlenen Alacak{totals.mixedCurrency ? ' (TL karşılığı)' : ''}
          </div>
          <div className="text-lg font-black text-emerald-700 mt-0.5">{tl(totals.credit)}</div>
        </div>
      </div>

      {/* TABLO BİLEŞENİ */}
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-2xs">
        <Table
          onRefresh={() => void load()}
          columns={columns}
          data={rows}
          showColumnFilters={true}
          globalSearch={search}
        />
      </div>
    </div>
  )
}
