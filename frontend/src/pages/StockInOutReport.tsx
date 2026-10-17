import React from 'react'
import { useEffect, useMemo, useState } from 'react'
import Table, { type TableColumn } from '../components/Table'
import Modal from '../components/Modal'
import TerminDetayModal from '../components/TerminDetayModal'
import StokHareketDetayModal, { type HareketTuru } from '../components/StokHareketDetayModal'
import {
  fetchStockInOutReport,
  fetchPendingInstallationDetails,
  type StockInOutReportItemDto,
  type PendingInstallationDetailDto
} from '../api/reports'

/*
  Tiklanabilir sayi hucresi. TOPLAM satiri tiklanmaz (kirilimi yok) ve sifir degerde de
  pencere acilmaz - BAKIYE haric: bakiye 0 iken bile "bir depoda +5 bir depoda -5" olabilir,
  asil merak edilen de odur.
*/
function SayiButonu({
  deger,
  row,
  renk,
  baslik,
  onAc,
  sifirdaAc = false
}: {
  deger: number
  row: any
  renk: string
  baslik: string
  onAc: () => void
  sifirdaAc?: boolean
}) {
  const tiklanabilir = row?.stockCode !== 'TOTAL' && (sifirdaAc || deger !== 0)

  if (!tiklanabilir) {
    return <span className={`font-semibold ${deger === 0 ? 'text-gray-400' : renk}`}>{deger.toLocaleString('tr-TR')}</span>
  }

  return (
    <button
      type="button"
      onClick={onAc}
      title={baslik}
      className={`font-semibold ${renk} hover:underline active:scale-95 transition cursor-pointer`}
    >
      {deger.toLocaleString('tr-TR')}
    </button>
  )
}

export default function StockInOutReport() {
  const [data, setData] = useState<StockInOutReportItemDto[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // ServiceOps (montaj) veritabanı okunamadıysa kolon "—" ve uyarı bandı.
  const [montajOkunamadi, setMontajOkunamadi] = useState(false)
  const [year, setYear] = useState<number>(() => new Date().getFullYear())
  const [searchQuery, setSearchQuery] = useState('')
  const [movementFilter, setMovementFilter] = useState<'all' | 'in' | 'out'>('all')

  const [detailModalOpen, setDetailModalOpen] = useState(false)
  /*
    GIRIS / CIKIS / BAKIYE KIRILIMI (2026-09-03 kullanici istegi: "girislere cikislara
    bakiyelere basinca da bir modal acilsin, nerede ne kadar var onu da gormus oluruz").
    Termin penceresinin ayni deseni; `tur` hangi sutuna basildigini tasir.
  */
  const [hareketStok, setHareketStok] = useState<{ kod: string; ad: string; tur: HareketTuru } | null>(null)

  /** Termin kırılımı açılan stok; null ise pencere kapalı. */
  const [terminStok, setTerminStok] = useState<{ kod: string; ad: string } | null>(null)
  const [selectedStockCode, setSelectedStockCode] = useState<string | null>(null)
  const [selectedStockName, setSelectedStockName] = useState<string | null>(null)
  const [detailsLoading, setDetailsLoading] = useState(false)
  const [detailsError, setDetailsError] = useState<string | null>(null)
  const [detailsData, setDetailsData] = useState<PendingInstallationDetailDto[]>([])

  const handleOpenDetails = (stockCode: string, stockName: string, count: number) => {
    if (count <= 0) return
    setSelectedStockCode(stockCode)
    setSelectedStockName(stockName)
    setDetailModalOpen(true)
    setDetailsLoading(true)
    setDetailsError(null)
    setDetailsData([])

    void (async () => {
      try {
        const res = await fetchPendingInstallationDetails(stockCode)
        setDetailsData(res ?? [])
      } catch (err: any) {
        setDetailsError(err?.message ?? 'Detaylar yüklenirken bir hata oluştu.')
      } finally {
        setDetailsLoading(false)
      }
    })()
  }

  const years = useMemo(() => {
    const currentYear = new Date().getFullYear()
    const list = []
    for (let y = currentYear - 5; y <= currentYear + 5; y++) {
      list.push(y)
    }
    return list
  }, [])

  const load = async () => {
    const ac = new AbortController()
    try {
      setLoading(true)
      setError(null)
      const res = await fetchStockInOutReport(year, ac.signal)
      setData(res.items ?? [])
      setMontajOkunamadi(res.montajKaynagiOkunamadi)
    } catch (e: any) {
      setError(String(e?.message ?? 'Stok giriş/çıkış raporu alınamadı.'))
      setData([])
    } finally {
      setLoading(false)
    }
    return () => ac.abort()
  }

  useEffect(() => {
    void load()
  }, [year])

  const filteredMainRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return data

    return data.filter((r) =>
      String(r.stockCode ?? '').toLowerCase().includes(q) ||
      String(r.stockName ?? '').toLowerCase().includes(q) ||
      String(r.groupCode ?? '').toLowerCase().includes(q) ||
      String(r.subGroupCode ?? '').toLowerCase().includes(q) ||
      String(r.supplierName ?? '').toLowerCase().includes(q)
    )
  }, [data, searchQuery])

  const totals = useMemo(() => {
    let openingBalance = 0
    let totalIn = 0
    let totalOut = 0
    let balance = 0
    let pendingMontage = 0
    let termin = 0
    const monthlyIn = Array(12).fill(0)
    const monthlyOut = Array(12).fill(0)

    filteredMainRows.forEach((r) => {
      openingBalance += Number(r.openingBalance ?? 0)
      totalIn += Number(r.totalIn ?? 0)
      totalOut += Number(r.totalOut ?? 0)
      balance += Number(r.balance ?? 0)
      pendingMontage += Number(r.pendingMontage ?? 0)
      termin += Number(r.termin ?? 0)
      for (let i = 0; i < 12; i++) {
        monthlyIn[i] += Number(r.monthlyIn?.[i] ?? 0)
        monthlyOut[i] += Number(r.monthlyOut?.[i] ?? 0)
      }
    })

    return { openingBalance, totalIn, totalOut, balance, pendingMontage, termin, monthlyIn, monthlyOut }
  }, [filteredMainRows])

  const rowsWithTotal = useMemo(() => {
    if (filteredMainRows.length === 0) return []

    const list = [...filteredMainRows]
    list.push({
      stockCode: 'TOTAL',
      stockName: 'GENEL TOPLAM',
      groupCode: '',
      subGroupCode: '',
      supplierName: '',
      openingBalance: totals.openingBalance,
      totalIn: totals.totalIn,
      totalOut: totals.totalOut,
      balance: totals.balance,
      pendingMontage: totals.pendingMontage,
      termin: totals.termin,
      monthlyIn: totals.monthlyIn,
      monthlyOut: totals.monthlyOut
    })
    return list
  }, [filteredMainRows, totals])

  const columns: TableColumn<StockInOutReportItemDto>[] = useMemo(
    () => [
      { key: 'stockCode', label: 'STOK KODU', sortable: true },
      { key: 'stockName', label: 'STOK ADI', sortable: true },
      { key: 'groupCode', label: 'GRUP KODU', sortable: true },
      { key: 'subGroupCode', label: 'KOD 1', sortable: true },
      { key: 'supplierName', label: 'TEDARİKÇİ', sortable: true },
      {
        /*
          DEVİR (2026-10-11): önceki yıllar + programa geçişteki açılış stoğu. Açılış stoğu eskiden
          TOP GİRİŞ'e (ve Ağustos girişine) sayılıyordu; alış gibi görünüp girişleri şişiriyordu.
          BAKİYE = DEVİR + GİRİŞ − ÇIKIŞ.
        */
        key: 'openingBalance',
        label: 'DEVİR',
        sortable: true,
        accessorFn: (row: StockInOutReportItemDto) => Number(row.openingBalance ?? 0),
        render: (_v: any, row: StockInOutReportItemDto) => (
          <SayiButonu
            deger={Number(row.openingBalance ?? 0)}
            row={row}
            renk="text-slate-700 hover:text-slate-900"
            baslik="Devir: önceki yıllar + açılış stoğu — depo kırılımı"
            onAc={() => setHareketStok({ kod: row.stockCode, ad: row.stockName ?? '', tur: 'balance' })}
          />
        )
      },
      {
        key: 'totalIn',
        label: 'TOP GİRİŞ',
        sortable: true,
        render: (v, row) => (
          <SayiButonu
            deger={Number(v || 0)}
            row={row}
            renk="text-emerald-600 hover:text-emerald-800"
            baslik="Hangi belgeyle, hangi depoya girdi?"
            onAc={() => setHareketStok({ kod: row.stockCode, ad: row.stockName ?? '', tur: 'in' })}
          />
        )
      },
      {
        key: 'totalOut',
        label: 'TOP ÇIKIŞ',
        sortable: true,
        render: (v, row) => (
          <SayiButonu
            deger={Number(v || 0)}
            row={row}
            renk="text-rose-600 hover:text-rose-800"
            baslik="Hangi belgeyle, hangi depodan çıktı?"
            onAc={() => setHareketStok({ kod: row.stockCode, ad: row.stockName ?? '', tur: 'out' })}
          />
        )
      },
      {
        key: 'balance',
        label: 'BAKİYE',
        sortable: true,
        render: (v, row) => {
          const val = Number(v || 0)
          return (
            <SayiButonu
              deger={val}
              row={row}
              renk={val >= 0 ? 'text-emerald-700 hover:text-emerald-900' : 'text-rose-700 hover:text-rose-900'}
              baslik="Nerede ne kadar var?"
              sifirdaAc
              onAc={() => setHareketStok({ kod: row.stockCode, ad: row.stockName ?? '', tur: 'balance' })}
            />
          )
        }
      },
      {
        /*
          TERMİN: teslim alınmamış alış siparişlerindeki miktar. Bakiyenin SAĞINDA duruyor
          çünkü bakiyeye dahil DEĞİL — belge "Teslim Edildi" olana kadar stoğa girmiyor.
        */
        key: 'termin',
        label: 'TERMİN',
        sortable: true,
        render: (v, row) => {
          const val = Number(v || 0)
          if (row.stockCode === 'TOTAL' || val <= 0) {
            return <span className="font-semibold text-gray-400">{val.toLocaleString('tr-TR')}</span>
          }
          return (
            <button
              type="button"
              onClick={() => { setTerminStok({ kod: row.stockCode, ad: row.stockName ?? '' }) }}
              className="font-semibold text-amber-600 hover:text-amber-800 hover:underline active:scale-95 transition cursor-pointer"
              title="Hangi alış siparişinde bekliyor?"
            >
              {val.toLocaleString('tr-TR')}
            </button>
          )
        }
      },
      {
        /*
          TERMİNİN TAHMİNİ GELİŞ TARİHİ — miktarın hemen sağında: "ne kadar yolda" sorusunun
          hemen ardından "ne zaman gelecek" geliyor. Birden çok bekleyen sipariş varsa EN ERKEN
          tarih gösterilir. Termin sayfası ayrı bir yetkiye bağlı; bu tarih bu raporu görebilen
          herkese açık (kullanıcı kararı, 2026-09-05).
        */
        key: 'terminEstimatedArrivalDate',
        label: 'TAHMİNİ GELİŞ',
        sortable: true,
        render: (v, row) => {
          if (row.stockCode === 'TOTAL') return <span className="text-gray-400">—</span>
          if (!v) return <span className="text-gray-300">—</span>
          const d = new Date(String(v))
          if (Number.isNaN(d.getTime())) return <span className="text-gray-300">—</span>
          // Geçmiş tarih = mal gecikmiş; gözden kaçmasın diye kırmızı.
          const bugun = new Date()
          bugun.setHours(0, 0, 0, 0)
          const gecikmis = d < bugun
          return (
            <span
              className={`font-semibold whitespace-nowrap ${gecikmis ? 'text-red-600' : 'text-amber-700'}`}
              title={gecikmis ? 'Tahmini geliş tarihi geçmiş' : 'Bekleyen alış siparişinin en erken tahmini geliş tarihi'}
            >
              {d.toLocaleDateString('tr-TR')}
            </span>
          )
        }
      },
      {
        key: 'pendingMontage',
        label: 'MONTAJ BEKLEYEN',
        sortable: true,
        render: (v, row) => {
          if (v === null || v === undefined) {
            return <span className="text-gray-300" title="Servis (montaj) veritabanı okunamadı">—</span>
          }
          const val = Number(v || 0)
          if (row.stockCode === 'TOTAL' || val <= 0) {
            return <span className="font-semibold text-gray-400">{val.toLocaleString('tr-TR')}</span>
          }
          return (
            <button
              type="button"
              title="Servisteki bekleyen montaj kayıtları"
              onClick={() => handleOpenDetails(row.stockCode, row.stockName ?? '', val)}
              className="font-semibold text-indigo-600 hover:text-indigo-800 hover:underline active:scale-95 transition cursor-pointer"
            >
              {val.toLocaleString('tr-TR')}
            </button>
          )
        }
      },
      /*
        AYLIK GİRİŞ/ÇIKIŞ KOLONLARI.

        Excel'e aktarım `row[col.key]` okuyor (AppDataTable.handleExportExcel); aylık veri
        `monthlyIn` / `monthlyOut` dizilerinde durduğu ve `key` (janIn, febOut...) veride
        karşılığı olmadığı için 12 ayın hepsi Excel'de BOŞ çıkıyordu. `accessorFn` eklendi:
        dışa aktarım artık diziden okuyor, ekrandaki `render` değişmedi.
      */
      ...Array.from({ length: 12 }).flatMap((_, m) => {
        const ay = ['OCAK', 'ŞUBAT', 'MART', 'NİSAN', 'MAYIS', 'HAZİRAN', 'TEMMUZ', 'AĞUSTOS', 'EYLÜL', 'EKİM', 'KASIM', 'ARALIK'][m]
        return [
          {
            key: `m${m}In`,
            label: `${ay} GİRİŞ`,
            accessorFn: (row: StockInOutReportItemDto) => Number(row.monthlyIn?.[m] ?? 0),
            render: (_: any, row: StockInOutReportItemDto) => Number(row.monthlyIn?.[m] ?? 0).toLocaleString('tr-TR')
          },
          {
            key: `m${m}Out`,
            label: `${ay} ÇIKIŞ`,
            accessorFn: (row: StockInOutReportItemDto) => Number(row.monthlyOut?.[m] ?? 0),
            render: (_: any, row: StockInOutReportItemDto) => Number(row.monthlyOut?.[m] ?? 0).toLocaleString('tr-TR')
          }
        ]
      })
    ],
    []
  )

  const filteredColumns = useMemo(() => {
    return columns.filter((col) => {
      // Base columns that are always shown
      if (
        col.key === 'stockCode' ||
        col.key === 'stockName' ||
        col.key === 'groupCode' ||
        col.key === 'subGroupCode' ||
        col.key === 'supplierName' ||
        col.key === 'openingBalance' ||
        col.key === 'balance' ||
        col.key === 'termin' ||
        col.key === 'terminEstimatedArrivalDate' ||
        col.key === 'pendingMontage'
      ) {
        return true
      }

      if (movementFilter === 'all') {
        return true
      }

      if (movementFilter === 'in') {
        return col.key === 'totalIn' || col.key.endsWith('In')
      }

      if (movementFilter === 'out') {
        return col.key === 'totalOut' || col.key.endsWith('Out')
      }

      return true
    })
  }, [columns, movementFilter])

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900 tracking-tight">Stok Giriş/Çıkış Raporu</h1>
          <p className="text-xs text-gray-400 mt-0.5">Raporlar / Stok Giriş/Çıkış Raporu</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <select
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              className="h-9 px-3 text-xs border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-400 transition"
            >
              {years.map((y) => (
                <option key={y} value={y}>
                  {y} Yılı
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="h-9 px-5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg text-xs shadow-sm active:scale-95 transition-all disabled:opacity-50"
          >
            {loading ? 'Yükleniyor...' : 'RAPORLA'}
          </button>

          <div className="flex items-center border border-gray-200 rounded-lg p-0.5 bg-gray-50/50 h-9">
            <button
              type="button"
              onClick={() => setMovementFilter('all')}
              className={`px-3 h-full rounded-md text-xs font-semibold transition ${
                movementFilter === 'all'
                  ? 'bg-white text-emerald-700 shadow-sm border border-gray-100'
                  : 'text-gray-500 hover:text-gray-900'
              }`}
            >
              Tümü
            </button>
            <button
              type="button"
              onClick={() => setMovementFilter('in')}
              className={`px-3 h-full rounded-md text-xs font-semibold transition ${
                movementFilter === 'in'
                  ? 'bg-white text-emerald-700 shadow-sm border border-gray-100'
                  : 'text-gray-500 hover:text-gray-900'
              }`}
            >
              Girenler
            </button>
            <button
              type="button"
              onClick={() => setMovementFilter('out')}
              className={`px-3 h-full rounded-md text-xs font-semibold transition ${
                movementFilter === 'out'
                  ? 'bg-white text-emerald-700 shadow-sm border border-gray-100'
                  : 'text-gray-500 hover:text-gray-900'
              }`}
            >
              Çıkanlar
            </button>
          </div>

          <div className="relative">
            <span className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-gray-400 text-xs">
              🔍
            </span>
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Stok Kodu, Adı, Grup..."
              className="h-9 w-64 pl-8 pr-3 text-xs border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-400 transition"
            />
          </div>
        </div>
      </div>

      <div className="text-[11px] text-gray-500 -mt-3">
        <b>DEVİR</b> = önceki yıllar + açılış stoğu · <b>BAKİYE</b> = Devir + Giriş − Çıkış · Depo transferleri giriş/çıkışa
        sayılmaz (malın firmaya girişi/çıkışı değil; depo kırılımında ayrı görünür) · <b>Montaj bekleyen</b> servis
        programındaki açık montaj kalemlerinden gelir.
      </div>
      {montajOkunamadi && (
        <div className="-mt-3 p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800">
          Montaj bekleyen bilgisi servis veritabanından okunamadı; sütun "—" gösteriyor. Diğer sütunlar doğru.
        </div>
      )}

      <div className="overflow-x-auto bg-white border border-gray-100 rounded-xl shadow-sm">
        <div className="min-w-[2800px] p-4 relative">
          {error && (
            <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-100 text-xs font-semibold text-red-600">
              {error}
            </div>
          )}
          {loading && (
            <div className="mb-4 text-xs text-gray-500 flex items-center gap-2">
              <div className="w-4 h-4 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin"></div>
              <span>Veriler yükleniyor...</span>
            </div>
          )}
          <Table
          onRefresh={() => void load()}
            columns={filteredColumns as any}
            data={rowsWithTotal}
            showColumnFilters
            rowKey={(r) => String((r as any).stockCode ?? '')}
            rowClassName={(r) => (r.stockCode === 'TOTAL' ? 'bg-slate-50 font-semibold border-t-2 border-slate-200 hover:bg-slate-50 cursor-default' : '')}
          />
        </div>
      </div>

      <StokHareketDetayModal
        acik={!!hareketStok}
        onKapat={() => setHareketStok(null)}
        stockCode={hareketStok?.kod ?? null}
        stockName={hareketStok?.ad ?? null}
        yil={year}
        tur={hareketStok?.tur ?? 'balance'}
      />

      <TerminDetayModal
        acik={!!terminStok}
        onKapat={() => setTerminStok(null)}
        stockCode={terminStok?.kod ?? null}
        stockName={terminStok?.ad ?? null}
        kaynak="stockInOut"
      />

      <Modal
        isOpen={detailModalOpen}
        onClose={() => setDetailModalOpen(false)}
        title={`${selectedStockName ?? ''} (${selectedStockCode ?? ''}) - Montaj Bekleyenler`}
        containerClassName="max-w-4xl"
      >
        {detailsLoading && (
          <div className="py-8 text-center text-xs text-gray-500 flex items-center justify-center gap-2">
            <div className="w-5 h-5 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
            <span>Yükleniyor...</span>
          </div>
        )}

        {detailsError && (
          <div className="p-3 bg-rose-50 border border-rose-100 text-xs text-rose-600 rounded-lg">
            {detailsError}
          </div>
        )}

        {!detailsLoading && !detailsError && detailsData.length === 0 && (
          <div className="py-8 text-center text-xs text-gray-400">
            Bekleyen montaj kaydı bulunamadı.
          </div>
        )}

        {!detailsLoading && !detailsError && detailsData.length > 0 && (
          <div className="overflow-x-auto border border-gray-100 rounded-lg">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-gray-50 text-gray-600 border-b border-gray-100 font-semibold">
                  <th className="p-3">Servis No</th>
                  <th className="p-3">Bayi Adı</th>
                  <th className="p-3">Müşteri</th>
                  <th className="p-3">Telefon</th>
                  <th className="p-3">Adres</th>
                  <th className="p-3">Kayıt</th>
                  <th className="p-3">Planlanan Tarih</th>
                  <th className="p-3">Durum</th>
                  <th className="p-3 text-right">Adet</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-gray-700">
                {detailsData.map((d) => (
                  <tr key={d.id} className="hover:bg-gray-50/50">
                    <td className="p-3 font-mono font-semibold">{d.serviceNumber || '-'}</td>
                    <td className="p-3 font-medium">{d.dealerName || '-'}</td>
                    <td className="p-3">{d.installationName || '-'}</td>
                    <td className="p-3">{d.installationPhone || '-'}</td>
                    <td className="p-3 max-w-[220px] truncate" title={d.address || ''}>{d.address || '-'}</td>
                    <td className="p-3">{d.createdAt ? new Date(d.createdAt).toLocaleDateString('tr-TR') : '-'}</td>
                    <td className="p-3">
                      {d.plannedDate
                        ? new Date(d.plannedDate).toLocaleDateString('tr-TR')
                        : '-'}
                    </td>
                    <td className="p-3">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-50 text-amber-700 border border-amber-100">
                        {d.status}
                      </span>
                    </td>
                    <td className="p-3 text-right font-semibold">{d.quantity}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Modal>
    </div>
  )
}
