import React, { useEffect, useMemo, useState } from 'react'
import { FileSpreadsheet, RefreshCw, Calendar, BarChart3, List, PieChart, Info, TrendingUp, DollarSign, Award, Percent, Users } from 'lucide-react'
import Table, { type TableColumn } from '../components/Table'
import { fetchSalesMarketingReport, type SalesMarketingReportItemDto } from '../api/reports'
import { fetchSalesmenDropdown, type SalesmanDropdownItem } from '../api/salesmen'

const premiumColors = [
  '#4f46e5', // Indigo
  '#0d9488', // Teal
  '#0284c7', // Sky
  '#e11d48', // Rose
  '#d97706', // Amber
  '#7c3aed', // Violet
  '#2563eb', // Blue
  '#059669', // Emerald
  '#db2777', // Pink
  '#ea580c', // Orange
  '#4b5563', // Slate
  '#9333ea', // Purple
]

function formatMoney(n: number) {
  const v = Number(n ?? 0)
  const isNegative = v < 0
  const absVal = Math.abs(v).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return `${isNegative ? '-' : ''}₺${absVal}`
}

/** Satırın kendi para birimindeki tutar; sembol de o paranın. */
function currencySymbolOf(currencyTypeId: any): string {
  const c = Number(currencyTypeId ?? 1)
  return c === 2 ? '€' : c === 3 ? '$' : c === 4 ? '£' : '₺'
}

function currencyCodeOf(currencyTypeId: any): string {
  const c = Number(currencyTypeId ?? 1)
  return c === 2 ? 'EUR' : c === 3 ? 'USD' : c === 4 ? 'GBP' : 'TL'
}

function formatOwnCurrency(n: number, currencyTypeId: any) {
  const v = Number(n ?? 0)
  const isNegative = v < 0
  const absVal = Math.abs(v).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return `${isNegative ? '-' : ''}${currencySymbolOf(currencyTypeId)}${absVal}`
}

/** Rapordaki işlem tipleri. TAMİR = servis geliri (2026-09-30'dan beri ciroya dahil). */
const ISLEM_TIPLERI: Array<{ value: string; label: string; aktif: string }> = [
  { value: 'SATIŞ', label: 'Satış', aktif: 'border-emerald-600 text-emerald-700 bg-emerald-50' },
  { value: 'İADE', label: 'İade', aktif: 'border-rose-600 text-rose-700 bg-rose-50' },
  { value: 'TAMİR', label: 'Tamir (Servis)', aktif: 'border-amber-600 text-amber-700 bg-amber-50' }
]

/** Yerel tarih → "yyyy-MM-dd" (toISOString UTC'ye çevirip günü kaydırırdı). */
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** offset 0 = bu ay (1'inden BUGÜNE), -1 = önceki ayın tamamı. */
function ayAraligi(offset: number): [string, string] {
  const now = new Date()
  const bas = new Date(now.getFullYear(), now.getMonth() + offset, 1)
  const bit = offset === 0 ? now : new Date(now.getFullYear(), now.getMonth() + offset + 1, 0)
  return [ymd(bas), ymd(bit)]
}

/** TARİH ARALIĞI HIZLI SEÇİMLERİ (2026-09-30 kullanıcı isteği: "2 tarih arası seçilsin"). */
const HIZLI_ARALIKLAR: Array<{ label: string; aralik: () => [string, string] }> = [
  { label: 'Bugün', aralik: () => [ymd(new Date()), ymd(new Date())] },
  { label: 'Bu Ay', aralik: () => ayAraligi(0) },
  { label: 'Önceki Ay', aralik: () => ayAraligi(-1) },
  { label: 'Bu Yıl', aralik: () => [`${new Date().getFullYear()}-01-01`, ymd(new Date())] }
]

const CURRENCY_FILTERS: Array<{ id: number; label: string }> = [
  { id: 1, label: '₺ TL' },
  { id: 2, label: '€ EUR' },
  { id: 3, label: '$ USD' },
  { id: 4, label: '£ GBP' }
]

function formatDate(v: any) {
  if (!v) return '—'
  const d = new Date(v)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('tr-TR')
}

function getCoordinatesForPercent(percent: number) {
  const x = Math.cos(2 * Math.PI * percent)
  const y = Math.sin(2 * Math.PI * percent)
  return [x, y]
}

/*
  DİLİM BÜYÜKLÜĞÜ ile GÖSTERİLEN DEĞER AYRI (2026-09-30).

  Halka eskiden dilimleri MUTLAK değerle çizip ortaya bunların TOPLAMINI "Net Toplam" diye
  yazıyordu: Satış 2.857.566 + İade 85.235 = 2.942.801 — iade DÜŞÜLECEKKEN EKLENİYORDU ve
  hemen yanındaki "Net Toplam Ciro" kartıyla (2.772.330,67) çelişiyordu. Ayrıca değerler
  tam sayıya yuvarlanıyordu. Artık dilim `value` (büyüklük) ile çizilir, lejantta `display`
  (işaretli gerçek tutar) yazar, ortada verilen `centerValue` (kartla aynı net) durur.
*/
type DonutSlice = { label: string; value: number; display: number; color: string }

const SalesmanDonutChart = ({ data, title, centerLabel, centerValue }: { data: DonutSlice[]; title: string; centerLabel: string; centerValue: number }) => {
  const total = data.reduce((acc, d) => acc + d.value, 0)
  if (total === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[16rem] text-gray-400 text-xs bg-white border border-gray-100 rounded-3xl p-6 shadow-sm">
        <span className="text-2xl mb-2">📊</span>
        <span>Bu Kriterlere Ait Grafik Verisi Yok</span>
      </div>
    )
  }

  let accumulatedPercent = 0

  return (
    <div className="bg-white border border-gray-200/60 rounded-3xl p-5 shadow-sm flex flex-col items-center h-full hover:shadow-md transition-shadow duration-200">
      <h3 className="text-xs font-bold text-gray-800 mb-4 uppercase tracking-wider text-center">{title}</h3>

      <div className="relative w-44 h-44">
        <svg viewBox="-1 -1 2 2" className="transform -rotate-90 w-full h-full">
          {data.map((slice, index) => {
            const percent = slice.value / total
            if (percent === 0) return null

            const [startX, startY] = getCoordinatesForPercent(accumulatedPercent)
            accumulatedPercent += percent
            const [endX, endY] = getCoordinatesForPercent(accumulatedPercent)

            const largeArcFlag = percent > 0.5 ? 1 : 0

            const pathData = [
              `M 0 0`,
              `L ${startX} ${startY}`,
              `A 1 1 0 ${largeArcFlag} 1 ${endX} ${endY}`,
              `Z`
            ].join(' ')

            return (
              <path
                key={index}
                d={pathData}
                fill={slice.color}
                className="transition-all duration-300 hover:opacity-90 hover:scale-[1.03] origin-center cursor-pointer"
                style={{ transformOrigin: '0 0' }}
              >
                <title>{slice.label}: {formatMoney(slice.display)} (%{Math.round(percent * 100)})</title>
              </path>
            )
          })}
          <circle cx="0" cy="0" r="0.65" fill="#ffffff" />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none px-4 text-center">
          <span className="text-[9px] uppercase font-bold text-gray-400 tracking-wider">{centerLabel}</span>
          <span className={`text-xs font-black leading-tight mt-1 truncate max-w-[120px] block ${centerValue < 0 ? 'text-rose-600' : 'text-gray-900'}`}>{formatMoney(centerValue)}</span>
        </div>
      </div>

      {/* Legend list */}
      <div className="mt-4 w-full space-y-2 max-h-40 overflow-y-auto pr-1 select-none">
        {data.map((slice, index) => {
          const percent = slice.value / total
          return (
            <div key={index} className="flex items-center justify-between text-[11px] text-gray-600 border-b border-gray-50 pb-1.5 last:border-0 last:pb-0">
              <div className="flex items-center gap-2 truncate">
                <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: slice.color }} />
                <span className="font-semibold truncate uppercase" title={slice.label}>{slice.label}</span>
              </div>
              <span className={`font-bold ml-2 whitespace-nowrap ${slice.display < 0 ? 'text-rose-600' : 'text-gray-900'}`}>
                {formatMoney(slice.display)} (%{Math.round(percent * 100)})
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function SalesMarketingReports() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reportData, setReportData] = useState<SalesMarketingReportItemDto[] | null>(null)
  const [globalSearch, setGlobalSearch] = useState('')

  // Salesmen and filter states
  const [salesmen, setSalesmen] = useState<SalesmanDropdownItem[]>([])
  const [salesmenLoading, setSalesmenLoading] = useState(false)
  const [selectedSalesmanCode, setSelectedSalesmanCode] = useState('')
  // İŞLEM TİPİ ÇOKLU SEÇİM (2026-09-30): Satış / İade / Tamir (servis geliri) ayrı ayrı açılıp
  // kapatılır; kartlar, grafik ve tablo seçime göre gelir. Üçü seçiliyken süzgeç gönderilmez.
  const [selectedTipler, setSelectedTipler] = useState<string[]>(['SATIŞ', 'İADE', 'TAMİR'])
  // 0 = Tümü. Süzgeç ÇEVİRMEZ, yalnız o para birimindeki faturaları toplar.
  // AY SEÇİCİ (2026-08-20). Rapor eskiden bütün geçmişi çekiyordu; ay sınırı yoktu.
  // İlk açılış tarayıcının ayıyla başlar, sunucu firmanın ayını döndürünce onunla eşitlenir
  // (firma saat dilimi sunucuda, tarayıcıda değil).
  // İKİ TARİH ARASI (2026-09-30): ay/yıl seçicisinin yerine. Varsayılan ayın 1'inden bugüne.
  const [startDate, setStartDate] = useState(() => ayAraligi(0)[0])
  const [endDate, setEndDate] = useState(() => ayAraligi(0)[1])

  const [selectedCurrencyTypeId, setSelectedCurrencyTypeId] = useState(0)
  const [availableCurrencyTypeIds, setAvailableCurrencyTypeIds] = useState<number[]>([])

  /**
   * Oturum bir PLASİYERE aitse sunucu veriyi zaten yalnızca onun koduna daraltıyor; burada
   * seçici de o koda kilitleniyor. Kısıt sunucuda — bu state yalnızca ekranın "başkasını
   * seçebiliyormuş" gibi görünmesini engelliyor.
   */
  const [restrictedSalesmanCode, setRestrictedSalesmanCode] = useState<string | null>(null)

  // Load Salesmen
  useEffect(() => {
    const loadSalesmen = async () => {
      try {
        setSalesmenLoading(true)
        const list = await fetchSalesmenDropdown()
        setSalesmen(list ?? [])
      } catch (err) {
        console.error('Plasiyerler alınamadı:', err)
      } finally {
        setSalesmenLoading(false)
      }
    }
    loadSalesmen()
  }, [])

  // Load Sales Marketing Report Data
  const loadReport = async (signal?: AbortSignal) => {
    try {
      setLoading(true)
      setError(null)
      const result = await fetchSalesMarketingReport({
        salesmanCode: selectedSalesmanCode || undefined,
        islemTipi: selectedTipler.length === ISLEM_TIPLERI.length ? undefined : selectedTipler.join(','),
        currencyTypeId: selectedCurrencyTypeId || undefined,
        startDate,
        endDate
      }, signal)
      setReportData(result.items)
      setRestrictedSalesmanCode(result.restrictedSalesmanCode)
      setAvailableCurrencyTypeIds(result.availableCurrencyTypeIds)
      // Seçici kısıtlı koda oturur: kullanıcı listeden başkasını seçmiş olsa bile ekranda
      // gördüğü veri kendi verisi; seçim ile başlık ayrışmasın.
      if (result.restrictedSalesmanCode && selectedSalesmanCode !== result.restrictedSalesmanCode) {
        setSelectedSalesmanCode(result.restrictedSalesmanCode)
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') return
      setError(err.message || 'Satış pazarlama raporu yüklenemedi.')
      setReportData(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const ac = new AbortController()
    loadReport(ac.signal)
    return () => ac.abort()
  }, [selectedSalesmanCode, selectedTipler.join(','), selectedCurrencyTypeId, startDate, endDate])

  // Get active salesman name description for title
  const activeSalesmanName = useMemo(() => {
    if (!selectedSalesmanCode) return ''
    const found = salesmen.find(s => s.salesmanCode === selectedSalesmanCode)
    return found ? found.description : selectedSalesmanCode
  }, [selectedSalesmanCode, salesmen])

  // Summary statistics
  const summary = useMemo(() => {
    if (!reportData || reportData.length === 0) {
      return { totalNet: 0, totalKdvli: 0, bestSalesman: '—', bestSalesmanAmount: 0, dailyAverage: 0 }
    }

    let net = 0
    let kdvli = 0
    const plasiyerSums: Record<string, number> = {}
    const activeDays = new Set<string>()

    reportData.forEach(x => {
      net += x.toplamSatisNet
      kdvli += x.toplamSatisKdvli
      plasiyerSums[x.plasiyer] = (plasiyerSums[x.plasiyer] || 0) + x.toplamSatisNet
      activeDays.add(new Date(x.tarih).toDateString())
    })

    // Find best salesman
    let bestName = '—'
    let bestAmt = 0
    Object.entries(plasiyerSums).forEach(([name, val]) => {
      if (val > bestAmt) {
        bestAmt = val
        bestName = name
      }
    })

    const dayCount = activeDays.size || 1
    const avg = net / dayCount

    return {
      totalNet: net,
      totalKdvli: kdvli,
      bestSalesman: bestName,
      bestSalesmanAmount: bestAmt,
      dailyAverage: avg
    }
  }, [reportData])

  // Chart share formatting
  //
  // Tutarlar İŞARETLİ toplanır (iade eksi) ve YUVARLANMAZ; dilim büyüklüğü mutlak değerdir.
  // Eskiden hem mutlak toplanıyor hem tam sayıya yuvarlanıyordu: ortadaki "Net Toplam"
  // iadeyi eklemiş oluyordu (bkz. SalesmanDonutChart notu).
  const chartData = useMemo<DonutSlice[]>(() => {
    if (!reportData) return []

    const sums: Record<string, number> = {}
    reportData.forEach(item => {
      const key = selectedSalesmanCode ? item.islemTipi : item.plasiyer
      sums[key] = (sums[key] || 0) + Number(item.toplamSatisNet || 0)
    })

    return Object.entries(sums)
      .map(([label, net]) => ({ label, display: Math.round(net * 100) / 100, value: Math.abs(net) }))
      .filter((x) => x.value > 0)
      .sort((a, b) => b.value - a.value)
      .map((x, idx) => ({ ...x, color: premiumColors[idx % premiumColors.length] }))
  }, [reportData, selectedSalesmanCode])

  // Grid Columns
  const columns = useMemo<TableColumn<SalesMarketingReportItemDto>[]>(
    () => [
      {
        key: 'faturaNo',
        label: 'Fatura No',
        sortable: true,
        searchable: true,
        render: (v) => <span className="font-mono text-[11px] font-bold text-slate-900">{String(v || '—')}</span>
      },
      {
        key: 'tarih',
        label: 'Tarih',
        sortable: true,
        render: (v) => <span className="font-mono text-gray-600 text-xs">{formatDate(v)}</span>
      },
      {
        key: 'cariKodu',
        label: 'Cari Kodu',
        sortable: true,
        searchable: true,
        // Belge -1/-2/-3 alt hesabına yazılır ama kullanıcı ANA kodu tanır; ham hesap kodu
        // yalnız ipucunda, ekstreyle karşılaştırmak isteyen görebilsin diye.
        render: (v, row: any) => (
          <span className="font-mono text-[11px] text-slate-700" title={String(row?.cariHesapKodu || '')}>
            {String(v || '—')}
          </span>
        )
      },
      {
        key: 'cariAdi',
        label: 'Cari / Bayi Adı',
        sortable: true,
        searchable: true,
        render: (v) => <span className="font-bold text-xs text-gray-900">{String(v || '—')}</span>
      },
      {
        key: 'plasiyer',
        label: 'Plasiyer',
        sortable: true,
        searchable: true,
        render: (v, row: any) => (
          <span className="font-extrabold text-xs uppercase text-gray-900" title={String(row?.plasiyerKodu || '')}>
            {String(v || '—')}
          </span>
        )
      },
      {
        key: 'islemTipi',
        label: 'İşlem Tipi',
        sortable: true,
        searchable: true,
        filter: { type: 'checkbox', options: [{ label: 'SATIŞ', value: 'SATIŞ' }, { label: 'İADE', value: 'İADE' }, { label: 'TAMİR', value: 'TAMİR' }] },
        render: (v) => {
          // SATIŞ / İADE / TAMİR (servis geliri). ALIŞ ve alış kaynaklı HİZMET raporda yok.
          const type = String(v)
          const badgeColor = type === 'İADE'
            ? 'bg-rose-50 text-rose-700 border-rose-200/50'
            : type === 'TAMİR'
              ? 'bg-amber-50 text-amber-700 border-amber-200/50'
              : 'bg-emerald-50 text-emerald-700 border-emerald-200/50'

          return (
            <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${badgeColor}`}>
              {type}
            </span>
          )
        }
      },
      {
        key: 'currencyTypeId',
        label: 'Döviz',
        sortable: true,
        render: (v) => (
          <span className="px-2 py-0.5 rounded text-[10px] font-bold border bg-slate-50 text-slate-700 border-slate-200/60">
            {currencyCodeOf(v)}
          </span>
        )
      },
      /*
        TUTAR SÜTUNLARI FATURA DÖKÜM DÜZENİNDE (2026-09-30 kullanıcı isteği: "tabloyu fatura
        döküm gibi yap, en altta toplamı görelim").

        İlk üçü belgenin KENDİ parasında: toplam satırı para birimine göre ayrı kovalanır
        (dolar ile TL tek rakamda toplanmaz). Son ikisi TL çapası: toplamları tek kovaya
        sabitli ve üstteki "Net Toplam Ciro" / "KDV'li Genel Toplam" kartlarıyla birebir aynı.
        Toplam, süzgeç/arama varken yalnız görünen satırlardan hesaplanır.
      */
      {
        key: 'dovizBrut',
        label: 'Brüt Tutar',
        sortable: true,
        showTotal: true,
        filter: { type: 'number' },
        render: (v, row: any) => (
          <span className={`font-medium text-xs text-right block ${Number(v) < 0 ? 'text-rose-600' : 'text-slate-700'}`}>
            {formatOwnCurrency(Number(v ?? row?.brut ?? 0), row?.currencyTypeId)}
          </span>
        )
      },
      {
        // ELLE girilen iskonto — kampanya ayrı sütunda (Fatura Döküm ile aynı kural).
        key: 'dovizIskonto',
        label: 'İskonto',
        sortable: true,
        showTotal: true,
        filter: { type: 'number' },
        render: (v, row: any) => (
          <span className={`font-medium text-xs text-right block ${Number(v) !== 0 ? 'text-red-600' : 'text-slate-400'}`}>
            {formatOwnCurrency(Number(v ?? row?.iskonto ?? 0), row?.currencyTypeId)}
          </span>
        )
      },
      {
        key: 'dovizKampanya',
        label: 'Kampanya',
        sortable: true,
        showTotal: true,
        filter: { type: 'number' },
        render: (v, row: any) => (
          <span className={`font-medium text-xs text-right block ${Number(v) !== 0 ? 'text-red-600' : 'text-slate-400'}`}>
            {formatOwnCurrency(Number(v ?? row?.kampanya ?? 0), row?.currencyTypeId)}
          </span>
        )
      },
      {
        key: 'dovizNet',
        label: 'Net Tutar',
        sortable: true,
        showTotal: true,
        filter: { type: 'number' },
        render: (v, row: any) => (
          <span className={`font-bold text-xs text-right block ${Number(v) < 0 ? 'text-rose-600' : 'text-slate-900'}`}>
            {formatOwnCurrency(Number(v ?? row?.toplamSatisNet ?? 0), row?.currencyTypeId)}
          </span>
        )
      },
      {
        key: 'dovizKdv',
        label: 'KDV Tutarı',
        sortable: true,
        showTotal: true,
        filter: { type: 'number' },
        accessorFn: (row) => Math.round((Number(row.dovizKdvli ?? 0) - Number(row.dovizNet ?? 0)) * 100) / 100,
        render: (v, row: any) => (
          <span className={`font-medium text-xs text-right block ${Number(v) < 0 ? 'text-rose-600' : 'text-slate-600'}`}>
            {formatOwnCurrency(Number(v ?? 0), row?.currencyTypeId)}
          </span>
        )
      },
      {
        key: 'dovizKdvli',
        label: 'Genel Toplam',
        sortable: true,
        showTotal: true,
        filter: { type: 'number' },
        render: (v, row: any) => (
          <span className={`font-black text-xs text-right block ${Number(v) < 0 ? 'text-rose-600' : 'text-indigo-950'}`}>
            {formatOwnCurrency(Number(v ?? row?.toplamSatisKdvli ?? 0), row?.currencyTypeId)}
          </span>
        )
      },
      {
        key: 'toplamSatisNet',
        label: 'TL Net',
        sortable: true,
        showTotal: true,
        filter: { type: 'number' },
        totalCurrencyCode: 'TRY',
        render: (v) => (
          <span className={`font-semibold text-xs text-right block ${Number(v) < 0 ? 'text-rose-600' : 'text-slate-500'}`}>
            {formatMoney(Number(v))}
          </span>
        )
      },
      {
        key: 'toplamSatisKdvli',
        label: 'TL KDV\'li',
        sortable: true,
        showTotal: true,
        filter: { type: 'number' },
        totalCurrencyCode: 'TRY',
        render: (v) => (
          <span className={`font-semibold text-xs text-right block ${Number(v) < 0 ? 'text-rose-600' : 'text-slate-500'}`}>
            {formatMoney(Number(v))}
          </span>
        )
      }
    ],
    []
  )

  // CSV Exporter
  const handleExport = () => {
    if (!reportData || reportData.length === 0) return

    // Döviz sütunu olmadan dışa aktarımda dolarlı satır TL satırdan ayırt edilemiyordu.
    // Ekrandaki tabloyla aynı sütunlar (2026-09-30).
    const headers = ['Fatura No', 'Tarih', 'Cari Kodu', 'Cari Adi', 'Plasiyer', 'Islem Tipi', 'Doviz', 'Brut Tutar', 'Iskonto', 'Kampanya', 'Net Tutar', 'KDV Tutari', 'Genel Toplam', 'TL Net', 'TL KDVli']
    const csvRows = [headers.join(';')]

    reportData.forEach((item: any) => {
      const net = Number(item.dovizNet ?? item.toplamSatisNet)
      const kdvli = Number(item.dovizKdvli ?? item.toplamSatisKdvli)
      const row = [
        item.faturaNo,
        formatDate(item.tarih),
        item.cariKodu,
        item.cariAdi,
        item.plasiyer,
        item.islemTipi,
        currencyCodeOf(item.currencyTypeId),
        Number(item.dovizBrut ?? item.brut ?? 0).toFixed(2),
        Number(item.dovizIskonto ?? item.iskonto ?? 0).toFixed(2),
        Number(item.dovizKampanya ?? item.kampanya ?? 0).toFixed(2),
        net.toFixed(2),
        (kdvli - net).toFixed(2),
        kdvli.toFixed(2),
        Number(item.toplamSatisNet).toFixed(2),
        Number(item.toplamSatisKdvli).toFixed(2)
      ]
      csvRows.push(row.map((val) => `"${String(val ?? '').replace(/"/g, '""')}"`).join(';'))
    })

    const csvContent = '\uFEFF' + csvRows.join('\n')
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.setAttribute('href', url)
    link.setAttribute('download', `Satis_Pazarlama_Performans_Raporu_${new Date().toISOString().slice(0, 10)}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  return (
    <div className="space-y-6 font-inter text-gray-900 min-h-[calc(100vh-140px)] pb-12 px-3 sm:px-6">
      
      {/* Header section */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-gray-100 pb-5">
        <div>
          <h1 className="text-2xl font-black text-gray-900 tracking-tight flex items-center gap-3">
            Satış Pazarlama Raporu
            <span className="text-[10px] font-black text-indigo-700 bg-indigo-50 border border-indigo-100 px-3 py-1 rounded-full uppercase tracking-wider">
              Performans
            </span>
          </h1>
          <p className="text-xs text-gray-500 mt-1.5">
            Plasiyer ve işlem tipi bazında filtreleyerek ciroları, dağılımları ve işlem performanslarını analiz edin.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleExport}
            disabled={!reportData || reportData.length === 0}
            className="h-9 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-bold flex items-center gap-2 shadow-sm shadow-emerald-500/10 transition-all active:scale-98"
          >
            <FileSpreadsheet size={14} />
            <span>Excel'e Aktar</span>
          </button>
          
          <button
            type="button"
            onClick={() => void loadReport()}
            disabled={loading}
            className="h-9 px-3 rounded-xl border border-gray-200 bg-white text-xs font-bold hover:bg-gray-50 text-gray-700 flex items-center gap-2 transition-all shadow-sm active:scale-98 disabled:opacity-50"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            <span>Yenile</span>
          </button>
        </div>
      </div>

      {/*
        ÜST BÖLÜM (2026-09-30 kullanıcı isteği): solda süzgeçler + özet kartlar, SAĞ ÜSTTE ciro
        dağılımı. Tablo altta tam genişlikte — eskiden grafik sol sütunda tabloyu daraltıyordu.
      */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-stretch">
      <div className="lg:col-span-2 space-y-4">
      {/* Advanced Filter Box */}
      <div className="bg-white border border-gray-200/70 rounded-3xl p-5 shadow-sm">
        {/* TARİH ARALIĞI (2026-09-30): iki tarih arası, bitiş günü DAHİL. Eskiden yalnız ay
            seçiliyordu. Hızlı düğmeler en sık bakılan aralıkları tek tıkla kurar. */}
        <div className="mb-4 space-y-1.5">
          <label className="block text-[11px] font-bold text-gray-600 uppercase tracking-wider flex items-center gap-1.5">
            <Calendar size={12} className="text-gray-400" />
            Tarih Aralığı
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="date"
              value={startDate}
              max={endDate || undefined}
              onChange={(e) => e.target.value && setStartDate(e.target.value)}
              className="h-9 px-3 text-[11px] border border-gray-200 rounded-xl bg-gray-50/50 hover:bg-gray-50 font-bold text-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/15 focus:border-indigo-600"
              aria-label="Başlangıç tarihi"
            />
            <span className="text-xs font-bold text-gray-400">–</span>
            <input
              type="date"
              value={endDate}
              min={startDate || undefined}
              onChange={(e) => e.target.value && setEndDate(e.target.value)}
              className="h-9 px-3 text-[11px] border border-gray-200 rounded-xl bg-gray-50/50 hover:bg-gray-50 font-bold text-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/15 focus:border-indigo-600"
              aria-label="Bitiş tarihi"
            />
            {HIZLI_ARALIKLAR.map((h) => {
              const [b, e] = h.aralik()
              const secili = b === startDate && e === endDate
              return (
                <button
                  key={h.label}
                  type="button"
                  onClick={() => { setStartDate(b); setEndDate(e) }}
                  className={
                    'h-9 px-3 rounded-xl border text-[11px] font-bold transition ' +
                    (secili ? 'border-indigo-600 text-indigo-700 bg-indigo-50' : 'border-gray-200 bg-gray-50/50 hover:bg-gray-50 text-gray-700')
                  }
                >
                  {h.label}
                </button>
              )
            })}
          </div>
        </div>

        {/* PARA BİRİMİ SÜZGECİ. Düğme listesi süzgeçten BAĞIMSIZ kapsamdan gelir
            (`availableCurrencyTypeIds`) — yoksa USD seçilince diğer düğmeler kaybolurdu.
            Süzgeç ÇEVİRMEZ: yalnız o para birimindeki faturaları toplar. */}
        <div className="mb-4 space-y-1.5">
          <label className="block text-[11px] font-bold text-gray-600 uppercase tracking-wider flex items-center gap-1.5">
            <DollarSign size={12} className="text-gray-400" />
            Para Birimi
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setSelectedCurrencyTypeId(0)}
              className={
                'h-9 px-3 rounded-xl border text-[11px] font-bold transition ' +
                (selectedCurrencyTypeId === 0
                  ? 'border-indigo-600 text-indigo-700 bg-indigo-50'
                  : 'border-gray-200 text-gray-700 bg-gray-50/50 hover:bg-gray-50')
              }
            >
              Tümü
            </button>
            {CURRENCY_FILTERS.filter((c) => availableCurrencyTypeIds.includes(c.id) || selectedCurrencyTypeId === c.id).map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setSelectedCurrencyTypeId(c.id)}
                className={
                  'h-9 px-3 rounded-xl border text-[11px] font-bold transition ' +
                  (selectedCurrencyTypeId === c.id
                    ? 'border-indigo-600 text-indigo-700 bg-indigo-50'
                    : 'border-gray-200 text-gray-700 bg-gray-50/50 hover:bg-gray-50')
                }
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          
          {/* Salesman filter */}
          <div className="space-y-1.5">
            <label className="block text-[11px] font-bold text-gray-600 uppercase tracking-wider flex items-center gap-1.5">
              <Users size={12} className="text-gray-400" />
              Plasiyer Seçimi
            </label>
            <select
              value={selectedSalesmanCode}
              onChange={(e) => setSelectedSalesmanCode(e.target.value)}
              className="w-full h-10 px-3 py-2 text-xs border border-gray-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-indigo-500/15 focus:border-indigo-600 bg-gray-50/50 hover:bg-gray-50 transition-all font-bold text-gray-800 uppercase disabled:bg-gray-100 disabled:cursor-not-allowed"
              disabled={salesmenLoading || Boolean(restrictedSalesmanCode)}
            >
              {/*
                PLASİYER OTURUMUNDA LİSTE KENDİSİNE İNER.
                Kısıt sunucuda uygulanıyor; burada seçeneği de kaldırmak, kullanıcının
                seçtiği plasiyer ile ekranda gördüğü verinin ayrışmasını engelliyor
                (başkasını seçiyor, kendi verisini görüyor → "rapor yanlış" sanılıyordu).
              */}
              {restrictedSalesmanCode ? (
                (() => {
                  const own = salesmen.find((s) => s.salesmanCode === restrictedSalesmanCode)
                  return (
                    <option value={restrictedSalesmanCode}>
                      ({restrictedSalesmanCode}){own ? ` ${own.description}` : ''}
                    </option>
                  )
                })()
              ) : (
                <>
                  <option value="">— TÜM PLASİYERLER —</option>
                  {salesmen.map((s) => (
                    <option key={s.salesmanCode} value={s.salesmanCode}>
                      ({s.salesmanCode}) {s.description}
                    </option>
                  ))}
                </>
              )}
            </select>
            {restrictedSalesmanCode && (
              <p className="text-[10px] font-semibold text-gray-400">
                Plasiyer hesabı: yalnızca kendi satışlarınız listelenir.
              </p>
            )}
          </div>

          {/* Transaction Type Filter */}
          <div className="space-y-1.5">
            <label className="block text-[11px] font-bold text-gray-600 uppercase tracking-wider flex items-center gap-1.5">
              <List size={12} className="text-gray-400" />
              İşlem Tipi
            </label>
            {/* ÇOKLU SEÇİM (2026-09-30). ALIŞ ve alış kaynaklı HİZMET yine yok (2026-08-20):
                tedarikçi alışı ve su/elektrik gideri ciro değildir. En az biri seçili kalır. */}
            <div className="flex flex-wrap items-center gap-2">
              {ISLEM_TIPLERI.map((t) => {
                const secili = selectedTipler.includes(t.value)
                return (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() =>
                      setSelectedTipler((prev) =>
                        prev.includes(t.value)
                          ? (prev.length > 1 ? prev.filter((x) => x !== t.value) : prev)
                          : ISLEM_TIPLERI.map((x) => x.value).filter((v) => v === t.value || prev.includes(v))
                      )
                    }
                    className={
                      'h-10 px-4 rounded-2xl border text-xs font-bold transition flex items-center gap-2 ' +
                      (secili ? t.aktif : 'border-gray-200 text-gray-400 bg-gray-50/50 hover:bg-gray-50')
                    }
                    title={secili ? 'Rapordan çıkarmak için tıklayın' : 'Rapora eklemek için tıklayın'}
                  >
                    <span className={'w-3.5 h-3.5 rounded border flex items-center justify-center text-[9px] ' + (secili ? 'border-current bg-white' : 'border-gray-300')}>
                      {secili ? '✓' : ''}
                    </span>
                    {t.label}
                  </button>
                )
              })}
            </div>
          </div>

        </div>
      </div>

      {/* Statistics summary widgets */}
      {reportData && (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <div className="bg-gradient-to-br from-indigo-50 to-indigo-100/50 border border-indigo-200/30 p-5 rounded-3xl shadow-sm flex items-start gap-4">
            <div className="p-3 bg-indigo-600 text-white rounded-2xl">
              <DollarSign size={18} />
            </div>
            <div>
              <span className="text-[10px] font-bold text-indigo-600 uppercase tracking-widest block">Net Toplam Ciro</span>
              <span className="text-lg font-black text-indigo-950 block mt-1">{formatMoney(summary.totalNet)}</span>
            </div>
          </div>

          <div className="bg-gradient-to-br from-emerald-50 to-emerald-100/50 border border-emerald-200/30 p-5 rounded-3xl shadow-sm flex items-start gap-4">
            <div className="p-3 bg-emerald-600 text-white rounded-2xl">
              <Percent size={18} />
            </div>
            <div>
              <span className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest block">KDV'li Genel Toplam</span>
              <span className="text-lg font-black text-emerald-950 block mt-1">{formatMoney(summary.totalKdvli)}</span>
            </div>
          </div>

          <div className="bg-gradient-to-br from-amber-50 to-amber-100/50 border border-amber-200/30 p-5 rounded-3xl shadow-sm flex items-start gap-4">
            <div className="p-3 bg-amber-600 text-white rounded-2xl">
              <Award size={18} />
            </div>
            <div className="truncate">
              <span className="text-[10px] font-bold text-amber-600 uppercase tracking-widest block">En Başarılı Plasiyer</span>
              <span className="text-xs font-black text-amber-950 truncate block mt-1 uppercase" title={summary.bestSalesman}>
                {summary.bestSalesman}
              </span>
              <span className="text-[10px] text-amber-600 font-bold block mt-0.5">{formatMoney(summary.bestSalesmanAmount)}</span>
            </div>
          </div>

          <div className="bg-gradient-to-br from-purple-50 to-purple-100/50 border border-purple-200/30 p-5 rounded-3xl shadow-sm flex items-start gap-4">
            <div className="p-3 bg-purple-600 text-white rounded-2xl">
              <TrendingUp size={18} />
            </div>
            <div>
              <span className="text-[10px] font-bold text-purple-600 uppercase tracking-widest block">Günlük Ortalama Ciro</span>
              <span className="text-lg font-black text-purple-950 block mt-1">{formatMoney(summary.dailyAverage)}</span>
            </div>
          </div>
        </div>
      )}
      </div>

      {/* Sağ üst: ciro dağılımı */}
      <div className="lg:col-span-1">
        <SalesmanDonutChart
          data={chartData}
          title={selectedSalesmanCode ? `${activeSalesmanName} CİRO DAĞILIMI` : 'PLASİYER CİRO DAĞILIMI'}
          centerLabel="Net Toplam"
          centerValue={summary.totalNet}
        />
      </div>
      </div>

      {error && (
        <div className="p-4 text-xs font-semibold text-red-700 bg-red-50 border border-red-200/50 rounded-2xl shadow-sm flex items-center gap-2">
          <Info size={16} />
          <span>{error}</span>
        </div>
      )}

      {/* Main views rendering */}
      {loading && !reportData ? (
        <div className="flex flex-col items-center justify-center py-24 text-gray-400 bg-white border border-gray-100 rounded-3xl shadow-sm">
          <div className="w-9 h-9 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mb-4" />
          <p className="text-xs font-semibold text-gray-500">Satış Pazarlama Verileri Hesaplanıyor...</p>
        </div>
      ) : reportData && reportData.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-gray-400 bg-white border border-gray-100 rounded-3xl shadow-sm">
          <span className="text-3xl mb-2">📊</span>
          <p className="text-xs font-semibold text-gray-500">Filtreleme kriterlerine uygun ciro hareketi bulunamadı.</p>
        </div>
      ) : reportData ? (
        /* TABLO FATURA DÖKÜM DÜZENİNDE: tam genişlik, sütun süzgeçleri, EN ALTTA TOPLAM satırı. */
        <div className="space-y-3">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-white px-4 py-3 border border-gray-100 rounded-2xl shadow-sm">
            <span className="text-xs font-bold text-gray-500 uppercase tracking-widest">
              Fatura Bazlı Ciro Hareketleri <span className="text-gray-400">({reportData.length} belge)</span>
            </span>
            <input
              type="text"
              placeholder="Tablodan hızlı ara..."
              value={globalSearch}
              onChange={(e) => setGlobalSearch(e.target.value)}
              className="w-full sm:max-w-xs h-9 px-4 rounded-xl border border-gray-200 bg-white text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-600"
            />
          </div>

          <div className="bg-white rounded-2xl border border-gray-200/70 overflow-hidden shadow-sm">
            <Table<SalesMarketingReportItemDto>
              onRefresh={() => void loadReport()}
              columns={columns}
              data={reportData}
              showColumnFilters={true}
              globalSearch={globalSearch}
              initialPageSize={50}
              // Aylık rapor: tarih sütunu bugüne süzülmesin.
              disableDateDefaultToday
              rowKey={(row, idx) => `${(row as any).id ?? idx}`}
              rowClassName={() => 'hover:bg-slate-50/50 transition-all text-gray-700'}
            />
          </div>
        </div>
      ) : null}

    </div>
  )
}
