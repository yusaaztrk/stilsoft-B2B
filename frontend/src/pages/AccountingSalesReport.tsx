import React from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import Table, { type TableColumn } from '../components/Table'
import { fetchAccountingSalesReport, type AccountingSalesReportItemDto } from '../api/reports'

function formatMoney(n: number) {
  const v = Number(n ?? 0)
  return `₺${v.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export default function AccountingSalesReport() {
  const [data, setData] = useState<AccountingSalesReportItemDto[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [startDate, setStartDate] = useState<string>(() => {
    const now = new Date()
    const yyyy = now.getFullYear()
    const mm = String(now.getMonth() + 1).padStart(2, '0')
    return `${yyyy}-${mm}-01`
  })

  const [endDate, setEndDate] = useState<string>(() => {
    const now = new Date()
    const yyyy = now.getFullYear()
    const mm = now.getMonth()
    const lastDay = new Date(yyyy, mm + 1, 0)
    const lastDd = String(lastDay.getDate()).padStart(2, '0')
    const monthStr = String(mm + 1).padStart(2, '0')
    return `${yyyy}-${monthStr}-${lastDd}`
  })

  const [searchQuery, setSearchQuery] = useState('')

  // PARA BİRİMİ SÜZGECİ (2026-08-19). 0 = "Tümü": bütün para birimleri tek listede, her
  // satır kendi para birimi ve kuruyla. Bir para birimi seçilirse yalnız o belgeler gelir.
  const [currencyFilter, setCurrencyFilter] = useState<number>(0)
  const [availableCurrencies, setAvailableCurrencies] = useState<number[]>([1])

  useEffect(() => {
    if (startDate && endDate) {
      void load()
    }
  }, [])

  // Para birimi seçimi anında raporlar; kullanıcı ayrıca "RAPORLA"ya basmak zorunda kalmasın.
  const isFirstCurrencyRender = useRef(true)
  useEffect(() => {
    if (isFirstCurrencyRender.current) {
      isFirstCurrencyRender.current = false
      return
    }
    if (startDate && endDate) void load()
  }, [currencyFilter])

  const load = async () => {
    if (!startDate || !endDate) {
      setError('Lütfen raporlamak için başlangıç ve bitiş tarihlerini seçin.')
      setData([])
      return
    }
    const ac = new AbortController()
    try {
      setLoading(true)
      setError(null)
      const res = await fetchAccountingSalesReport(startDate, endDate, searchQuery, ac.signal, currencyFilter || null)
      setData(res?.items ?? [])
      setAvailableCurrencies(res?.availableCurrencyTypeIds?.length ? res.availableCurrencyTypeIds : [1])
    } catch (e: any) {
      setError(String(e?.message ?? 'Muhasebe satış raporu alınamadı.'))
      setData([])
    } finally {
      setLoading(false)
    }
    return () => ac.abort()
  }

  /*
    GENEL TOPLAM ARTIK SAHTE BİR SATIR DEĞİL (2026-09-02 kullanıcı bildirimi).

    Toplam, veriye eklenen `cariKodu: 'TOTAL'` satırıyla gösteriliyordu. O satır da
    tablonun süzgecinden geçtiği için Tip'ten bir seçim yapılır yapılmaz eleniyor ve
    toplam EKRANDAN KAYBOLUYORDU; yalnız süzgeçsiz ilk açılışta görünüyordu.

    Ortak tablonun kendi toplam altlığı kullanılıyor (`showTotal`): altlık satır değil,
    süzgece takılmıyor ve GÖRÜNEN satırlardan hesaplanıyor — süzünce toplam da süzülmüş
    tutarı gösteriyor. Sayfanın kendi toplamını hesaplamasına da gerek kalmadı.
  */

  /**
   * SATIRIN ETİKETLERİ — tek kural.
   *
   * Aynı hesap üç yerde lazım: hücrenin çizimi, süzgeç değeri ve süzgeç seçenekleri.
   * Üçü ayrı yazılırsa listede olmayan bir seçenek çıkar ya da seçilen etiket hiçbir
   * satırı tutmaz.
   */
  const satirNiteligi = (
    row: AccountingSalesReportItemDto
  ): { etiket: string; isIade: boolean; isMuaf: boolean } => {
    const isIade = String(row.belgeNiteligi ?? '') === 'IADE'
    const isMuaf =
      Boolean(row.isMuaf) ||
      String(row.cariKodu ?? '').endsWith('-3') ||
      String(row.cariKodu ?? '').includes('-3]') ||
      String(row.cariKodu ?? '').split('-').pop() === '3'

    /*
      TEK ROZET, ÖNCELİK: İADE > ASKERİYE > belgenin kendi damgası
      (2026-09-02 kullanıcı kararı).

      Önce üç rozet birden basılıyordu (ASKERİYE + MUAF + İADE) ve sütun okunmuyordu.

      MUAF damgası KALDIRILDI: bilgisi ASKERİYE'nin içinde zaten var — muaf satış
      "ASKERIYE" damgalanıyor, `-3` alt hesabı da muaf demek.

      İADE en üstte: askeriye bir belge iade olduğunda da "İADE" yazar. Belgenin YÖNÜ
      KDV rejiminden önce gelir. Tutarlar 2026-09-02'den beri artı işaretli olduğu için
      satırın iade olduğunu söyleyen TEK şey bu rozet. Muaf olduğu bilgisi rozetin
      ipucunda (`title`) ve zaten %0 görünen KDV sütununda duruyor.
    */
    const etiket = isIade ? 'İADE' : isMuaf ? 'ASKERİYE' : String(row.type ?? '').trim() || 'FATURA'
    return { etiket, isIade, isMuaf }
  }

  /** Süzgeç ve seçenek listesi de AYNI etiketi kullanır; rozet ile süzgeç ayrışmasın. */
  const satirEtiketi = (row: AccountingSalesReportItemDto): string => satirNiteligi(row).etiket

  /** Süzgeç seçenekleri VERİDEN üretilir; bu dönemde olmayan etiket listelenmez. */
  const tipSecenekleri = useMemo(() => {
    const kume = new Set<string>()
    for (const row of data ?? []) {
      const e = satirEtiketi(row)
      if (e) kume.add(e)
    }
    return Array.from(kume)
      .sort((a, b) => a.localeCompare(b, 'tr-TR'))
      .map((v) => ({ label: v, value: v }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  const columns: TableColumn<AccountingSalesReportItemDto>[] = useMemo(
    () => [
      {
        key: 'type',
        label: 'Tip',
        searchable: true,
        /*
          ÇOKLU SEÇİM (2026-09-02 kullanıcı isteği). Tek seçimli kutu değil onay kutusuydu
          istenen: aynı anda hem FATURA hem İADE listelenebilsin.
        */
        filter: { type: 'select', options: tipSecenekleri },
        filterValue: (row) => satirEtiketi(row),
        render: (_v, row) => {
          const nitelik = satirNiteligi(row)

          // Renk etikete göre.
          // Renk de etiketle AYNI sırayı izler; yoksa "İADE" yazan rozet yeşil olurdu.
          // İade tutarları 2026-09-02'den beri EKSİ DEĞİL (bkz. AccountingSalesReportController);
          // satırı ayırt eden tek şey bu rozet, o yüzden rengi belirgin kalıyor.
          const renk = nitelik.isIade
            ? 'bg-rose-50 text-rose-700 border-rose-100'
            : nitelik.isMuaf
              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
              : 'bg-blue-50 text-blue-700 border-blue-100'

          const ipucu = nitelik.isMuaf
            ? nitelik.isIade
              ? 'KDV muaf (askeriye) iade faturası. Tutarlar Fatura Dökümü ile aynı, artı işaretli.'
              : 'KDV muaf (askeriye) fatura.'
            : nitelik.isIade
              ? 'İade faturası. Tutarlar Fatura Dökümü ile aynı, artı işaretli.'
              : 'Satış faturası.'

          return (
            <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${renk}`} title={ipucu}>
              {nitelik.etiket}
            </span>
          )
        }
      },
      {
        key: 'tarih',
        label: 'Tarih',
        searchable: true,
        render: (v) => (v ? new Date(String(v)).toLocaleDateString('tr-TR') : '')
      },
      {
        key: 'belgeNo',
        label: 'Belge No',
        searchable: true,
        render: (v) => <span className="font-semibold text-slate-900">{v}</span>
      },
      {
        key: 'cariKodu',
        label: 'Cari Kodu',
        searchable: true,
      },
      {
        key: 'cariAdi',
        label: 'Cari Adı',
        searchable: true,
        render: (v) => <span className="font-medium text-slate-800">{v}</span>
      },
      {
        key: 'adres',
        label: 'Adres',
        searchable: true,
        render: (v) => <span className="text-slate-500 max-w-[200px] truncate block" title={String(v ?? '')}>{v}</span>
      },
      {
        key: 'sehir',
        label: 'Şehir',
        searchable: true,
      },
      {
        key: 'telefon',
        label: 'Telefon',
        searchable: true
      },
      {
        key: 'brut',
        label: 'Brüt',
        searchable: true,
        // Bu beş sütun DAİMA TL (fatura başlığı TL saklar), o yüzden farklı para
        // birimlerindeki satırlar tek kovada toplanabilir.
        showTotal: true,
        totalCurrencyCode: 'TRY',
        tryTotalLabel: 'TL',
        render: (v) => <span>{formatMoney(Number(v ?? 0))}</span>
      },
      {
        key: 'iskonto',
        label: 'İskonto',
        searchable: true,
        // Bu beş sütun DAİMA TL (fatura başlığı TL saklar), o yüzden farklı para
        // birimlerindeki satırlar tek kovada toplanabilir.
        showTotal: true,
        totalCurrencyCode: 'TRY',
        tryTotalLabel: 'TL',
        render: (v) => <span>{formatMoney(Number(v ?? 0))}</span>
      },
      {
        key: 'netTutar',
        label: 'Net Tutar',
        searchable: true,
        // Bu beş sütun DAİMA TL (fatura başlığı TL saklar), o yüzden farklı para
        // birimlerindeki satırlar tek kovada toplanabilir.
        showTotal: true,
        totalCurrencyCode: 'TRY',
        tryTotalLabel: 'TL',
        render: (v) => <span className="font-medium text-slate-900">{formatMoney(Number(v ?? 0))}</span>
      },
      {
        key: 'kdv',
        label: 'KDV %',
        searchable: true,
        render: (v) => `%${Number(v ?? 0)}`
      },
      {
        key: 'kdvTutari',
        label: 'KDV Tutarı',
        searchable: true,
        // Bu beş sütun DAİMA TL (fatura başlığı TL saklar), o yüzden farklı para
        // birimlerindeki satırlar tek kovada toplanabilir.
        showTotal: true,
        totalCurrencyCode: 'TRY',
        tryTotalLabel: 'TL',
        render: (v) => <span>{formatMoney(Number(v ?? 0))}</span>
      },
      {
        key: 'genelToplam',
        label: 'Genel Toplam',
        searchable: true,
        // Bu beş sütun DAİMA TL (fatura başlığı TL saklar), o yüzden farklı para
        // birimlerindeki satırlar tek kovada toplanabilir.
        showTotal: true,
        totalCurrencyCode: 'TRY',
        tryTotalLabel: 'TL',
        render: (v) => <span className="font-semibold text-emerald-600">{formatMoney(Number(v ?? 0))}</span>
      },
      // Yukarıdaki tutarların HEPSİ TL. Belgenin kendi para birimi ve fatura anındaki
      // donmuş kur ayrı sütunlarda: muhasebeci KDV beyanı ve yevmiye fişi için ikisini de
      // istiyor, TL değer tek başına dövizli faturayı TL faturadan ayırt ettirmiyor.
      {
        key: 'paraBirimi',
        label: 'Para Birimi',
        searchable: true,
        render: (v) => <span className="text-xs font-semibold text-slate-600">{String(v ?? 'TRY')}</span>
      },
      {
        key: 'kur',
        label: 'Kur',
        searchable: true,
        render: (v) => {
          const rate = Number(v ?? 1)
          // TL faturada kur 1; her satıra "1,000000" yazmak tabloyu okunmaz yapıyor.
          return rate === 1 ? <span className="text-gray-300">—</span> : <span className="text-xs">{rate.toLocaleString('tr-TR', { minimumFractionDigits: 4, maximumFractionDigits: 6 })}</span>
        }
      },
      {
        key: 'dovizGenelToplam',
        label: 'Döviz Toplam',
        searchable: true,
        render: (v, row) => {
          if (v === null || v === undefined) {
            return <span className="text-gray-300">—</span>
          }
          return (
            <span className="text-xs font-semibold text-slate-700">
              {Number(v).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {String((row as any).paraBirimi ?? '')}
            </span>
          )
        }
      }
    ],
    // Seçenekler veriden üretiliyor: bağımlılık verilmezse liste ilk render'daki
    // BOŞ hâlinde donar ve süzgeç hiç açılmaz.
    [tipSecenekleri]
  )

  return (
    <div className="p-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-5 pb-5 border-b border-slate-100">
        <div>
          <h1 className="text-xl font-bold text-gray-900 tracking-tight">Muhasebe Satış Raporu</h1>
          <p className="text-xs text-gray-400 mt-0.5">Raporlar / Muhasebe Satış Raporu</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="h-9 px-3 text-xs border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-400 transition"
            />
            <span className="text-gray-400 text-xs">-</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="h-9 px-3 text-xs border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-400 transition"
            />
          </div>
          {/* Döviz süzgeci — cari ekstredekiyle aynı kalıp; hareketi olmayan para birimi
              düğme olarak çıkmaz. "Tümü" seçiliyken her satır kendi para birimini gösterir. */}
          <div className="flex items-center gap-1 bg-gray-50 p-0.5 rounded-lg border border-gray-200">
            <span className="text-[10px] font-bold text-gray-400 px-2 uppercase tracking-wider">Döviz:</span>
            <button
              type="button"
              onClick={() => setCurrencyFilter(0)}
              className={`h-[28px] px-2.5 text-xs font-bold rounded-md transition ${
                currencyFilter === 0 ? 'bg-slate-900 text-white shadow-sm' : 'text-gray-600 hover:bg-gray-200'
              }`}
            >
              Tümü
            </button>
            {availableCurrencies.map((curId) => {
              const meta =
                curId === 2 ? { label: '€ EUR', active: 'bg-amber-600' } :
                curId === 3 ? { label: '$ USD', active: 'bg-emerald-600' } :
                curId === 4 ? { label: '£ GBP', active: 'bg-purple-600' } :
                { label: '₺ TL', active: 'bg-blue-600' }

              return (
                <button
                  key={curId}
                  type="button"
                  onClick={() => setCurrencyFilter(curId)}
                  className={`h-[28px] px-2.5 text-xs font-bold rounded-md transition ${
                    currencyFilter === curId ? `${meta.active} text-white shadow-sm` : 'text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {meta.label}
                </button>
              )
            })}
          </div>

          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="h-9 px-5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg text-xs shadow-sm active:scale-95 transition-all disabled:opacity-50"
          >
            {loading ? 'Yükleniyor...' : 'RAPORLA'}
          </button>

          <div className="relative">
            <span className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-gray-400 text-xs">
              🔍
            </span>
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Fatura No, Cari Kodu/Adı, Şehir..."
              className="h-9 w-64 pl-8 pr-3 text-xs border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-400 transition"
            />
          </div>
        </div>
      </div>

      <div className="overflow-x-auto bg-white border border-gray-100 rounded-xl shadow-sm">
        <div className="min-w-[1400px] p-4 relative">
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
            columns={columns as any}
            data={data}
            showColumnFilters
            rowKey={(r) => String((r as any).id ?? '')}
          />
        </div>
      </div>
    </div>
  )
}
