import React, { useEffect, useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import { FileSpreadsheet, RefreshCw, Search, Wrench } from 'lucide-react'
import PageHeader from '../components/PageHeader'
import {
  fetchHizmetHarcamaRaporu,
  type HizmetHarcamaRaporu as Rapor,
  type HizmetHarcamaSatiri
} from '../api/serviceExpenseReport'

/**
 * HİZMET HARCAMA RAPORU — "hangi hizmete ne kadar harcadım".
 *
 * İKİ KAYNAK: (1) "Hizmet" tipindeki alış belgeleri — bu firmada hizmet harcamaları böyle
 * giriliyor; (2) alış faturasının içine eklenen hizmet satırları (nakliye, işçilik…).
 * Satılan hizmetler bu rapora girmez; kapsam yalnız harcama tarafı.
 *
 * Tutarlar KDV hariç ve TL çapasındadır: belgeler farklı dövizlerde olabiliyor, ham toplamak
 * 100 $ ile 100 ₺'yi eşitlerdi. Satır kırılımında belgenin kendi parası da gösteriliyor.
 */

const iso = (d: Date) => {
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

const money = (v: number) =>
  `₺${Number(v ?? 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const moneyIn = (v: number, code: string) => {
  const sym = code === 'USD' ? '$' : code === 'EUR' ? '€' : code === 'GBP' ? '£' : '₺'
  return `${sym}${Number(v ?? 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

const qty = (v: number) => Number(v ?? 0).toLocaleString('tr-TR', { maximumFractionDigits: 2 })

const dateTr = (v?: string | null) => {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('tr-TR')
}

const aySozel = (m: string) => {
  const [y, mm] = String(m ?? '').split('-')
  const adlar = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara']
  const i = Number(mm) - 1
  return i >= 0 && i < 12 ? `${adlar[i]} ${y}` : m
}

/** Aylık seyir — küçük bir sütun grafiği. Kütüphane yok: tek bir dizi, saf CSS yükseklik. */
function AylikSeyir({ data }: { data: Array<{ month: string; amount: number }> }) {
  if (!data.length) return null
  const max = Math.max(...data.map((x) => x.amount), 0)
  if (max <= 0) return null

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-3">Aylık Seyir</div>
      <div className="flex items-end gap-1.5 h-32">
        {data.map((x) => {
          const h = Math.max(4, Math.round((x.amount / max) * 100))
          return (
            <div key={x.month} className="flex-1 min-w-0 flex flex-col items-center justify-end h-full group">
              <div className="text-[9px] font-bold text-gray-500 mb-1 opacity-0 group-hover:opacity-100 transition whitespace-nowrap">
                {money(x.amount)}
              </div>
              <div
                className="w-full rounded-t-md bg-indigo-500/80 hover:bg-indigo-600 transition"
                style={{ height: `${h}%` }}
                title={`${aySozel(x.month)} · ${money(x.amount)}`}
              />
            </div>
          )
        })}
      </div>
      <div className="flex gap-1.5 mt-2">
        {data.map((x) => (
          <div key={x.month} className="flex-1 min-w-0 text-center text-[9px] text-gray-400 truncate">
            {aySozel(x.month)}
          </div>
        ))}
      </div>
    </div>
  )
}

export default function HizmetHarcamaRaporu() {
  const today = new Date()
  const [from, setFrom] = useState(iso(new Date(today.getFullYear(), 0, 1)))
  const [to, setTo] = useState(iso(today))
  const [search, setSearch] = useState('')
  const [data, setData] = useState<Rapor | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [acikHizmet, setAcikHizmet] = useState<string | null>(null)

  useEffect(() => {
    const ac = new AbortController()
    setLoading(true)
    setError(null)
    fetchHizmetHarcamaRaporu({ from, to }, { signal: ac.signal })
      .then((r) => setData(r))
      .catch((e: any) => {
        if (e?.name === 'AbortError') return
        setError(String(e?.message ?? 'Rapor alınamadı'))
        setData(null)
      })
      .finally(() => setLoading(false))
    return () => ac.abort()
  }, [from, to, reloadKey])

  const hizmetler = useMemo(() => {
    const q = search.trim().toLocaleLowerCase('tr')
    const list = data?.services ?? []
    if (!q) return list
    return list.filter(
      (s) =>
        s.name.toLocaleLowerCase('tr').includes(q) ||
        s.suppliers.some((t) => t.supplierName.toLocaleLowerCase('tr').includes(q))
    )
  }, [data, search])

  const gosterilenToplam = useMemo(() => hizmetler.reduce((a, s) => a + s.amount, 0), [hizmetler])

  const detaylar = useMemo(() => {
    if (!acikHizmet) return []
    return (data?.details ?? []).filter((d) => d.key === acikHizmet)
  }, [data, acikHizmet])

  const exportExcel = () => {
    if (!data) return
    const wb = XLSX.utils.book_new()

    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        (data.services ?? []).map((s) => ({
          'Hizmet / Gider Türü': s.name,
          'Fatura Adedi': s.invoiceCount,
          'Tutar (TL)': s.amount,
          'Pay (%)': s.sharePercent,
          'Son Tarih': s.lastDate ? new Date(s.lastDate).toLocaleDateString('tr-TR') : '',
          Cariler: s.suppliers.map((t) => `${t.supplierName}: ${t.amount}`).join(' | ')
        }))
      ),
      'Hizmetler'
    )

    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        (data.details ?? []).map((d) => ({
          Tarih: new Date(d.date).toLocaleDateString('tr-TR'),
          'Belge No': d.documentNo,
          Kaynak: d.source,
          'Hizmet / Gider Türü': d.name,
          Cari: d.supplierName,
          'Tutar (TL)': d.amount,
          'Belge Parası': d.currencyCode,
          'Belge Tutarı': d.currencyAmount,
          Açıklama: d.description ?? ''
        }))
      ),
      'Detay'
    )

    XLSX.writeFile(wb, `hizmet-harcama-${from}_${to}.xlsx`)
  }

  return (
    <div>
      <PageHeader
        title="Hizmet Harcama Raporu"
        breadcrumb="Raporlar / Hizmet Harcama"
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Hizmet veya tedarikçi ara..."
        rightActions={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setReloadKey((k) => k + 1)}
              className="h-[38px] inline-flex items-center gap-2 px-3 text-xs font-semibold rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 transition"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              Yenile
            </button>
            <button
              type="button"
              onClick={exportExcel}
              disabled={!data || (data.services?.length ?? 0) === 0}
              className="h-[38px] inline-flex items-center gap-2 px-4 text-xs font-semibold uppercase tracking-wider bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg shadow-sm transition disabled:opacity-50"
            >
              <FileSpreadsheet size={14} />
              Excel
            </button>
          </div>
        }
      />

      <div className="flex flex-wrap items-end gap-3 mb-4">
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1">Başlangıç</label>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="h-[38px] px-3 text-sm border border-gray-200 rounded-lg bg-white"
          />
        </div>
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1">Bitiş</label>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="h-[38px] px-3 text-sm border border-gray-200 rounded-lg bg-white"
          />
        </div>
      </div>

      {error && (
        <div className="mb-4 text-sm font-bold text-red-600 bg-red-50 border border-red-200 p-3.5 rounded-xl">{error}</div>
      )}

      {loading && !data ? (
        <div className="py-16 text-center text-xs text-gray-500 flex items-center justify-center gap-2">
          <RefreshCw size={14} className="animate-spin" /> Rapor hazırlanıyor...
        </div>
      ) : !data || (data.services?.length ?? 0) === 0 ? (
        <div className="py-16 text-center bg-white rounded-2xl border border-gray-200">
          <Wrench size={28} className="mx-auto text-gray-300 mb-2" />
          <div className="text-sm text-gray-500 font-semibold">Bu tarih aralığında hizmet harcaması yok.</div>
          <div className="text-xs text-gray-400 mt-1">
            "Hizmet" tipi faturalar ve alış faturasına eklenen hizmet satırları burada listelenir.
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
              <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Toplam Harcama</div>
              <div className="mt-1 text-xl font-black text-gray-900">{money(data.totalAmount)}</div>
              <div className="text-[10px] text-gray-400 mt-0.5">KDV hariç</div>
            </div>
            <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
              <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Hizmet / Gider Türü</div>
              <div className="mt-1 text-xl font-black text-indigo-700">{data.serviceCount}</div>
            </div>
            <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
              <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Fatura</div>
              <div className="mt-1 text-xl font-black text-gray-900">{data.invoiceCount}</div>
            </div>
            <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
              <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Satır</div>
              <div className="mt-1 text-xl font-black text-gray-900">{data.lineCount}</div>
            </div>
          </div>

          <AylikSeyir data={data.monthly ?? []} />

          <div className="rounded-2xl border border-gray-300 bg-white shadow-sm overflow-x-auto">
            <table className="w-full text-xs min-w-[880px] border-collapse">
              <thead className="bg-gray-100 text-[10px] uppercase tracking-wider text-gray-600">
                <tr>
                  <th className="text-left px-4 py-3 border-b border-r border-gray-300">Hizmet / Gider Türü</th>
                  <th className="text-left px-3 py-3 border-b border-r border-gray-300">Cariler</th>
                  <th className="text-right px-3 py-3 border-b border-r border-gray-300">Fatura</th>
                  <th className="text-right px-3 py-3 border-b border-r border-gray-300">Tutar</th>
                  <th className="text-left px-3 py-3 border-b border-r border-gray-300 w-[160px]">Pay</th>
                  <th className="text-right px-4 py-3 border-b border-gray-300">Son İşlem</th>
                </tr>
              </thead>
              <tbody>
                {hizmetler.map((s: HizmetHarcamaSatiri) => {
                  const acik = acikHizmet === s.key
                  return (
                    <React.Fragment key={s.key}>
                      <tr
                        className={`cursor-pointer transition ${acik ? 'bg-indigo-50' : 'even:bg-gray-50/60 hover:bg-indigo-50/40'}`}
                        onClick={() => setAcikHizmet(acik ? null : s.key)}
                        title="Fatura kırılımını aç/kapat"
                      >
                        <td className="px-4 py-2.5 border-b border-r border-gray-200">
                          <div className="font-bold text-gray-900">{s.name}</div>
                        </td>
                        <td className="px-3 py-2.5 border-b border-r border-gray-200 text-gray-600">
                          <div className="max-w-[220px] truncate" title={s.suppliers.map((t) => t.supplierName).join(', ')}>
                            {s.suppliers.map((t) => t.supplierName).join(', ') || '—'}
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-right border-b border-r border-gray-200 font-semibold">{s.invoiceCount}</td>
                        <td className="px-3 py-2.5 text-right border-b border-r border-gray-200 font-black text-gray-900">{money(s.amount)}</td>
                        <td className="px-3 py-2.5 border-b border-r border-gray-200">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden">
                              <div className="h-full rounded-full bg-indigo-500" style={{ width: `${Math.min(100, s.sharePercent)}%` }} />
                            </div>
                            <span className="text-[10px] font-bold text-gray-500 w-10 text-right">
                              %{s.sharePercent.toLocaleString('tr-TR', { maximumFractionDigits: 1 })}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-right border-b border-gray-200 text-gray-600">{dateTr(s.lastDate)}</td>
                      </tr>

                      {acik && (
                        <tr>
                          <td colSpan={6} className="px-4 py-3 bg-indigo-50/40 border-b border-gray-200">
                            <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-2">
                              Fatura kırılımı — {s.name}
                            </div>
                            <div className="rounded-xl border border-gray-300 bg-white overflow-x-auto">
                              <table className="w-full text-[11px] min-w-[680px] border-collapse">
                                <thead className="bg-gray-100 text-[10px] uppercase tracking-wider text-gray-600">
                                  <tr>
                                    <th className="text-left px-3 py-2 border-b border-r border-gray-300">Tarih</th>
                                    <th className="text-left px-3 py-2 border-b border-r border-gray-300">Belge No</th>
                                    <th className="text-left px-3 py-2 border-b border-r border-gray-300">Kaynak</th>
                                    <th className="text-left px-3 py-2 border-b border-r border-gray-300">Cari</th>
                                    <th className="text-right px-3 py-2 border-b border-r border-gray-300">Belge Tutarı</th>
                                    <th className="text-right px-3 py-2 border-b border-gray-300">Tutar (TL)</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {detaylar.map((d, i) => (
                                    <tr key={`${d.invoiceId}-${d.documentNo}-${i}`} className="even:bg-gray-50/60">
                                      <td className="px-3 py-2 border-b border-r border-gray-200">{dateTr(d.date)}</td>
                                      <td className="px-3 py-2 border-b border-r border-gray-200 font-mono">{d.documentNo || '—'}</td>
                                      <td className="px-3 py-2 border-b border-r border-gray-200">
                                        <span className={'px-1.5 py-0.5 rounded text-[9px] font-bold ' + (d.source === 'Alış Faturası' ? 'bg-amber-100 text-amber-800' : 'bg-indigo-100 text-indigo-800')}>
                                          {d.source}
                                        </span>
                                      </td>
                                      <td className="px-3 py-2 border-b border-r border-gray-200">{d.supplierName}</td>
                                      <td className="px-3 py-2 text-right border-b border-r border-gray-200 text-gray-600">
                                        {moneyIn(d.currencyAmount, d.currencyCode)}
                                      </td>
                                      <td className="px-3 py-2 text-right border-b border-gray-200 font-bold">{money(d.amount)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  )
                })}
              </tbody>
              <tfoot className="bg-gray-100 font-bold text-gray-900">
                <tr>
                  <td className="px-4 py-3 border-r border-gray-300" colSpan={3}>
                    Toplam ({hizmetler.length} tür)
                  </td>
                  <td className="px-3 py-3 text-right border-r border-gray-300">{money(gosterilenToplam)}</td>
                  <td className="px-3 py-3 border-r border-gray-300" />
                  <td className="px-4 py-3" />
                </tr>
              </tfoot>
            </table>
          </div>

          {search.trim() && hizmetler.length === 0 && (
            <div className="py-10 text-center text-sm text-gray-400 bg-white rounded-2xl border border-gray-200">
              <Search size={20} className="mx-auto mb-2 text-gray-300" />
              Aramayla eşleşen hizmet yok.
            </div>
          )}
        </div>
      )}
    </div>
  )
}
