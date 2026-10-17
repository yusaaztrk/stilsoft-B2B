import React, { useEffect, useMemo, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { FileSpreadsheet, RefreshCw, Calendar, Users, BarChart3, List, PieChart, Info } from 'lucide-react'
import { CARI_SEARCH_LIMIT, buildCariSearchQuery } from '../utils/cariRemoteSearch'
import SearchableCariSelect, { type CariOption } from '../components/SearchableCariSelect'
import Table, { type TableColumn } from '../components/Table'
import { fetchCariSatisReport, type CariSatisReportItemDto } from '../api/reports'
import { fetchCustomersDropdown, type CustomerDto } from '../api/customers'

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

/** Tutarlar TL çapasıdır; belgenin kendi parası ayrı sütunlarda gösterilir. */
function formatMoney(n: number) {
  const v = Number(n ?? 0)
  const isNegative = v < 0
  const absVal = Math.abs(v).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return `${isNegative ? '-' : ''}₺${absVal}`
}

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

const DonutChart = ({ data, title }: { data: { label: string; value: number; color: string }[]; title: string }) => {
  const total = data.reduce((acc, d) => acc + d.value, 0)
  if (total === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-gray-400 text-xs">
        Bu Yıl İçin Veri Bulunamadı
      </div>
    )
  }

  let accumulatedPercent = 0

  return (
    <div className="bg-white border border-gray-200/60 rounded-3xl p-6 shadow-sm flex flex-col items-center hover:shadow-md transition-shadow duration-200">
      <h3 className="text-xs font-bold text-gray-800 mb-5 uppercase tracking-wider text-center">{title}</h3>
      <div className="relative w-48 h-48">
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
                <title>{slice.label}: {slice.value.toLocaleString('tr-TR')} Adet (%{Math.round(percent * 100)})</title>
              </path>
            )
          })}
          <circle cx="0" cy="0" r="0.62" fill="#ffffff" />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="text-[9px] uppercase font-bold text-gray-400 tracking-wider">Toplam</span>
          <span className="text-base font-black text-gray-900 leading-tight">{total.toLocaleString('tr-TR')}</span>
          <span className="text-[9px] text-gray-400">Adet</span>
        </div>
      </div>

      <div className="mt-6 w-full space-y-2 max-h-40 overflow-y-auto pr-1 select-none">
        {data.map((slice, index) => {
          const percent = slice.value / total
          return (
            <div key={index} className="flex items-center justify-between text-[11px] text-gray-600">
              <div className="flex items-center gap-2 truncate">
                <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: slice.color }} />
                <span className="font-semibold truncate uppercase" title={slice.label}>{slice.label}</span>
              </div>
              <span className="font-bold text-gray-900 ml-2 whitespace-nowrap">
                {slice.value.toLocaleString('tr-TR')} (%{Math.round(percent * 100)})
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/**
 * Uçtan gelen cari satırlarını seçim kutusunun beklediği biçime çevirir.
 * Hem açılıştaki ilk sayfa hem de her sunucu araması bundan geçer — iki ayrı eşleme
 * olsaydı aramada çıkan satırla listede duran satır farklı görünürdü.
 */
function buildCariOptionsFrom(customers: CustomerDto[]): CariOption[] {
  return (customers ?? [])
    .filter((c) => {
      const code = String(c.customerCode ?? '').toUpperCase()
      const name = String(c.name ?? '').toUpperCase()
      return !code.includes('MUHTELIF') && !code.includes('MUHTELİF') && !name.includes('MUHTELIF') && !name.includes('MUHTELİF')
    })
    .map((c) => ({
      value: c.customerCode,
      label: `(${c.customerCode}) ${c.name}`,
      code: c.customerCode,
      name: c.name,
      phone: c.phone || c.fax || '',
      type: c.customerType === 'gider' ? 'expense' : 'customer',
      customerType: c.customerType || (c.customerCode?.startsWith('120-01') ? '120-01' : c.customerCode?.startsWith('120-02') ? '120-02' : c.customerCode?.startsWith('120-04') ? '120-04' : c.customerCode?.startsWith('120-05') ? '120-05' : c.customerCode?.startsWith('120-06') ? '120-06' : c.customerCode?.startsWith('120-07') ? '120-07' : '120-03')
    }))
}

export default function CurrentSalesReport() {
  const navigate = useNavigate()

  // States
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reportData, setReportData] = useState<CariSatisReportItemDto[] | null>(null)
  
  const [customers, setCustomers] = useState<CustomerDto[]>([])
  const [selectedCustomerCode, setSelectedCustomerCode] = useState('')

  const allCariOptions: CariOption[] = useMemo(() => buildCariOptionsFrom(customers ?? []), [customers])


  // Date filters
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')

  // Active view tab: 'detailed' | 'group' | 'product'
  const [activeTab, setActiveTab] = useState<'detailed' | 'group' | 'product'>('detailed')
  const [globalSearch, setGlobalSearch] = useState('')

  /**
   * CARİ ARAMASI SUNUCUDA (2026-08-22) — Cari Ekstre'deki düzenin aynısı.
   *
   * Eskiden açılışta BÜTÜN cari listesi indiriliyordu ve seçim kutusu o gelene kadar boş
   * duruyordu. Artık her arama sunucuda süzülüyor; açılışta yalnızca ilk sayfa çekiliyor.
   */
  const cariRemoteSearch = useCallback(async (query: string, typeKey: string): Promise<CariOption[]> => {
    try {
      const list = await fetchCustomersDropdown({
        q: buildCariSearchQuery(query, typeKey),
        limit: CARI_SEARCH_LIMIT
      })
      setCustomers(list ?? [])
      return buildCariOptionsFrom(list ?? [])
    } catch (err) {
      console.error('Müşteriler alınamadı:', err)
      return []
    }
  }, [])

  useEffect(() => {
    void cariRemoteSearch('', 'all')
  }, [cariRemoteSearch])

  // Load Sales Report Data
  const loadReport = async (signal?: AbortSignal) => {
    try {
      setLoading(true)
      setError(null)
      const data = await fetchCariSatisReport({
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        customerCode: selectedCustomerCode || undefined
      }, signal)
      setReportData(data)
    } catch (err: any) {
      if (err?.name === 'AbortError') return
      setError(err.message || 'Cari satış raporu yüklenemedi.')
      setReportData(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const ac = new AbortController()
    loadReport(ac.signal)
    return () => ac.abort()
  }, [startDate, endDate, selectedCustomerCode])

  // Date Presets
  const applyPreset = (preset: 'all' | 'thisYear' | 'prevYear' | 'thisMonth' | 'last12Months') => {
    const now = new Date()
    if (preset === 'all') {
      setStartDate('')
      setEndDate('')
    } else if (preset === 'thisYear') {
      setStartDate(`${now.getFullYear()}-01-01`)
      setEndDate(now.toISOString().slice(0, 10))
    } else if (preset === 'prevYear') {
      setStartDate(`${now.getFullYear() - 1}-01-01`)
      setEndDate(`${now.getFullYear() - 1}-12-31`)
    } else if (preset === 'thisMonth') {
      const month = String(now.getMonth() + 1).padStart(2, '0')
      setStartDate(`${now.getFullYear()}-${month}-01`)
      setEndDate(now.toISOString().slice(0, 10))
    } else if (preset === 'last12Months') {
      const past = new Date()
      past.setMonth(past.getMonth() - 12)
      setStartDate(past.toISOString().slice(0, 10))
      setEndDate(now.toISOString().slice(0, 10))
    }
  }

  /**
   * PARA BİRİMİ SÜZGECİ (2026-08-19 kullanıcı isteği).
   *
   * Rapor satır bazında `paraBirimi` döndürüyordu ama ekranda süzgeç yoktu; kullanıcı
   * "her şey TL yazıyor, üstten dolar/euro/sterlin seçebileyim" dedi. Süzgeç İSTEMCİDE
   * çalışır (rapor zaten tek seferde yükleniyor); düğme listesi süzgeçten BAĞIMSIZ olarak
   * yüklenen bütün satırlardan çıkar, yoksa USD seçilince diğer düğmeler kaybolurdu.
   */
  const [currencyFilter, setCurrencyFilter] = useState<'ALL' | 'TRY' | 'EUR' | 'USD' | 'GBP'>('ALL')

  const normalizeCurrencyCode = (raw: any): 'TRY' | 'EUR' | 'USD' | 'GBP' => {
    const c = String(raw ?? '').trim().toUpperCase()
    if (c === 'EUR' || c === '2') return 'EUR'
    if (c === 'USD' || c === '3') return 'USD'
    if (c === 'GBP' || c === '4') return 'GBP'
    return 'TRY'
  }

  const availableCurrencies = useMemo(() => {
    const set = new Set<string>(['TRY'])
    ;(reportData ?? []).forEach((r) => set.add(normalizeCurrencyCode((r as any)?.paraBirimi)))
    return ['ALL', ...Array.from(set)] as Array<'ALL' | 'TRY' | 'EUR' | 'USD' | 'GBP'>
  }, [reportData])

  const currencyFilteredData = useMemo(() => {
    if (!reportData) return null
    if (currencyFilter === 'ALL') return reportData
    return reportData.filter((r) => normalizeCurrencyCode((r as any)?.paraBirimi) === currencyFilter)
  }, [reportData, currencyFilter])

  // Memoized tables data
  const detailedRows = useMemo(() => {
    return currencyFilteredData || []
  }, [currencyFilteredData])

  const groupedByGroupRows = useMemo(() => {
    if (!currencyFilteredData) return []
    const groups: Record<string, {
      islemTipi: string
      stokGrup: string
      kdvOran: number
      adet: number
      fiyat: number
      kdvTutar: number
      kdvliTutar: number
    }> = {}

    currencyFilteredData.forEach(item => {
      const key = `${item.islemTipi}_${item.stokGrup.trim().toUpperCase()}_${item.kdvOran}`
      if (!groups[key]) {
        groups[key] = {
          islemTipi: item.islemTipi,
          stokGrup: item.stokGrup.trim().toUpperCase(),
          kdvOran: item.kdvOran,
          adet: 0,
          fiyat: 0,
          kdvTutar: 0,
          kdvliTutar: 0
        }
      }
      groups[key].adet += item.adet
      groups[key].fiyat += item.fiyat
      groups[key].kdvTutar += item.kdvTutar
      groups[key].kdvliTutar += item.kdvliTutar
    })

    return Object.values(groups)
  }, [currencyFilteredData])

  const groupedByProductRows = useMemo(() => {
    if (!currencyFilteredData) return []
    const products: Record<string, {
      islemTipi: string
      stokKodu: string
      stokAdi: string
      stokGrup: string
      kdvOran: number
      adet: number
      fiyat: number
      kdvTutar: number
      kdvliTutar: number
    }> = {}

    currencyFilteredData.forEach(item => {
      const key = `${item.islemTipi}_${item.stokKodu.trim().toUpperCase()}_${item.kdvOran}`
      if (!products[key]) {
        products[key] = {
          islemTipi: item.islemTipi,
          stokKodu: item.stokKodu.trim().toUpperCase(),
          stokAdi: item.stokAdi,
          stokGrup: item.stokGrup,
          kdvOran: item.kdvOran,
          adet: 0,
          fiyat: 0,
          kdvTutar: 0,
          kdvliTutar: 0
        }
      }
      products[key].adet += item.adet
      products[key].fiyat += item.fiyat
      products[key].kdvTutar += item.kdvTutar
      products[key].kdvliTutar += item.kdvliTutar
    })

    return Object.values(products)
  }, [currencyFilteredData])

  // Donut chart groupings
  const groupChartDataByYear = useMemo(() => {
    if (!currencyFilteredData) return {}
    const yearMap: Record<number, Record<string, number>> = {}

    currencyFilteredData.forEach(item => {
      const year = new Date(item.tarih).getFullYear()
      if (isNaN(year)) return

      if (!yearMap[year]) yearMap[year] = {}

      const qty = Math.abs(item.adet)
      if (qty === 0) return

      const grp = item.stokGrup.trim().toUpperCase()
      yearMap[year][grp] = (yearMap[year][grp] || 0) + qty
    })

    const result: Record<number, { label: string; value: number; color: string }[]> = {}

    Object.entries(yearMap).forEach(([yearStr, groups]) => {
      const year = Number(yearStr)
      const sortedGroups = Object.entries(groups)
        .map(([label, value]) => ({ label, value }))
        .sort((a, b) => b.value - a.value)

      result[year] = sortedGroups.map((g, idx) => ({
        label: g.label,
        value: g.value,
        color: premiumColors[idx % premiumColors.length]
      }))
    })

    return result
  }, [currencyFilteredData])

  const productChartDataByYear = useMemo(() => {
    if (!currencyFilteredData) return {}
    const yearMap: Record<number, Record<string, number>> = {}

    currencyFilteredData.forEach(item => {
      const year = new Date(item.tarih).getFullYear()
      if (isNaN(year)) return

      if (!yearMap[year]) yearMap[year] = {}

      const qty = Math.abs(item.adet)
      if (qty === 0) return

      const label = `${item.stokKodu} - ${item.stokAdi}`
      yearMap[year][label] = (yearMap[year][label] || 0) + qty
    })

    const result: Record<number, { label: string; value: number; color: string }[]> = {}

    Object.entries(yearMap).forEach(([yearStr, products]) => {
      const year = Number(yearStr)
      const sortedProducts = Object.entries(products)
        .map(([label, value]) => ({ label, value }))
        .sort((a, b) => b.value - a.value)

      const topCount = 5
      let chartSlices: { label: string; value: number; color: string }[] = []

      if (sortedProducts.length <= topCount) {
        chartSlices = sortedProducts.map((p, idx) => ({
          label: p.label,
          value: p.value,
          color: premiumColors[idx % premiumColors.length]
        }))
      } else {
        const top = sortedProducts.slice(0, topCount)
        const othersValue = sortedProducts.slice(topCount).reduce((acc, p) => acc + p.value, 0)

        chartSlices = top.map((p, idx) => ({
          label: p.label,
          value: p.value,
          color: premiumColors[idx % premiumColors.length]
        }))

        chartSlices.push({
          label: 'DİĞER ÜRÜNLER',
          value: othersValue,
          color: '#94a3b8'
        })
      }

      result[year] = chartSlices
    })

    return result
  }, [currencyFilteredData])

  const uniqueYears = useMemo(() => {
    if (!currencyFilteredData) return []
    const years = new Set<number>()
    currencyFilteredData.forEach(item => {
      const y = new Date(item.tarih).getFullYear()
      if (!isNaN(y)) years.add(y)
    })
    return Array.from(years).sort((a, b) => b - a)
  }, [currencyFilteredData])

  // Table Columns Definition
  const detailedColumns = useMemo<TableColumn<CariSatisReportItemDto>[]>(
    () => [
      {
        key: 'islemTipi',
        label: 'Tip',
        sortable: true,
        searchable: true,
        render: (v) => {
          const type = String(v)
          const isReturn = type === 'İADE'
          return (
            <span
              className={`px-2.5 py-1 rounded-full text-[10px] font-bold border ${
                isReturn
                  ? 'bg-rose-50 text-rose-700 border-rose-200/50'
                  : 'bg-emerald-50 text-emerald-700 border-emerald-200/50'
              }`}
            >
              {type}
            </span>
          )
        }
      },
      {
        key: 'tarih',
        label: 'Tarih',
        sortable: true,
        render: (v) => <span className="font-mono text-gray-600 text-xs">{formatDate(v)}</span>
      },
      {
        key: 'faturaNo',
        label: 'Fatura No',
        sortable: true,
        searchable: true,
        render: (v) => <span className="font-bold text-gray-800 text-xs">{String(v || '—')}</span>
      },
      {
        key: 'cariAdi',
        label: 'Cari / Müşteri',
        sortable: true,
        searchable: true,
        render: (v, row) => (
          <div className="flex flex-col">
            <span className="font-semibold text-gray-900 text-xs uppercase">{String(v || '—')}</span>
            <span className="text-[10px] text-gray-400 font-mono">Kod: {row.cariKodu}</span>
          </div>
        )
      },
      {
        key: 'stokKodu',
        label: 'Stok Kodu',
        sortable: true,
        searchable: true,
        render: (v) => <span className="font-mono text-gray-700 text-xs font-semibold">{String(v || '—')}</span>
      },
      {
        key: 'stokAdi',
        label: 'Stok Adı',
        sortable: true,
        searchable: true,
        render: (v) => <span className="text-gray-700 text-xs uppercase max-w-[240px] truncate block" title={String(v)}>{String(v || '—')}</span>
      },
      {
        key: 'stokGrup',
        label: 'Grup',
        sortable: true,
        searchable: true,
        render: (v) => <span className="text-xs uppercase font-bold text-gray-500">{String(v || '—')}</span>
      },
      {
        key: 'adet',
        label: 'Adet',
        sortable: true,
        render: (v) => {
          const val = Number(v ?? 0)
          return (
            <span className={`font-black text-xs text-right block ${val < 0 ? 'text-rose-600 animate-pulse' : 'text-gray-950'}`}>
              {val.toLocaleString('tr-TR')}
            </span>
          )
        }
      },
      {
        key: 'fiyat',
        label: 'Net Tutar',
        sortable: true,
        render: (v) => (
          <span className={`font-semibold text-xs text-right block ${Number(v) < 0 ? 'text-rose-600' : 'text-gray-900'}`}>
            {formatMoney(Number(v))}
          </span>
        )
      },
      {
        key: 'kdvOran',
        label: 'KDV Oran',
        sortable: true,
        render: (v) => <span className="text-gray-600 text-xs text-right block font-mono">%{Number(v)}</span>
      },
      {
        key: 'kdvTutar',
        label: 'KDV Tutar',
        sortable: true,
        render: (v) => (
          <span className={`text-xs text-right block text-gray-500 font-medium ${Number(v) < 0 ? 'text-rose-500' : ''}`}>
            {formatMoney(Number(v))}
          </span>
        )
      },
      {
        key: 'kdvliTutar',
        label: 'KDV\'li Tutar',
        sortable: true,
        render: (v) => (
          <span className={`font-extrabold text-xs text-right block ${Number(v) < 0 ? 'text-rose-600' : 'text-indigo-950'}`}>
            {formatMoney(Number(v))}
          </span>
        )
      },
      // BELGENİN KENDİ PARA BİRİMİ (2026-08-19). Sunucu bu üç alanı zaten gönderiyordu ama
      // ekran hiç göstermiyordu: dolarla kesilmiş bir fatura raporda yalnız TL karşılığıyla
      // ve ₺ işaretiyle çıkıyor, TL faturadan ayırt edilemiyordu.
      {
        key: 'paraBirimi',
        label: 'Para Birimi',
        sortable: true,
        render: (v) => <span className="text-gray-600 text-xs text-center block font-semibold">{String(v ?? 'TL')}</span>
      },
      {
        key: 'kur',
        label: 'Kur',
        sortable: true,
        render: (v) => {
          const rate = Number(v ?? 1)
          return (
            <span className="text-gray-500 text-xs text-right block font-mono">
              {rate > 1 ? rate.toLocaleString('tr-TR', { minimumFractionDigits: 4, maximumFractionDigits: 4 }) : '—'}
            </span>
          )
        }
      },
      {
        key: 'dovizKdvliTutar',
        label: 'Döviz Tutar',
        sortable: true,
        render: (v, row) => {
          if (v == null) return <span className="text-gray-300 text-xs text-right block">—</span>
          const code = String(row?.paraBirimi ?? '').toUpperCase()
          const sym = code === 'USD' ? '$' : code === 'EUR' ? '€' : code === 'GBP' ? '£' : ''
          return (
            <span className="font-bold text-xs text-right block text-emerald-700">
              {sym}
              {Number(v).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          )
        }
      }
    ],
    []
  )

  const groupColumns = useMemo<TableColumn<any>[]>(
    () => [
      {
        key: 'islemTipi',
        label: 'Tip',
        sortable: true,
        searchable: true,
        render: (v) => {
          const isReturn = String(v) === 'İADE'
          return (
            <span
              className={`px-2.5 py-1 rounded-full text-[10px] font-bold border ${
                isReturn
                  ? 'bg-rose-50 text-rose-700 border-rose-200/50'
                  : 'bg-emerald-50 text-emerald-700 border-emerald-200/50'
              }`}
            >
              {v}
            </span>
          )
        }
      },
      {
        key: 'stokGrup',
        label: 'Stok Grubu',
        sortable: true,
        searchable: true,
        render: (v) => <span className="font-extrabold text-xs uppercase text-gray-800">{String(v || '—')}</span>
      },
      {
        key: 'adet',
        label: 'Toplam Adet',
        sortable: true,
        render: (v) => (
          <span className={`font-black text-xs text-right block ${Number(v) < 0 ? 'text-rose-600' : 'text-gray-900'}`}>
            {Number(v).toLocaleString('tr-TR')}
          </span>
        )
      },
      {
        key: 'kdvOran',
        label: 'KDV Oran',
        sortable: true,
        render: (v) => <span className="font-mono text-xs text-right block text-gray-500">%{Number(v)}</span>
      },
      {
        key: 'fiyat',
        label: 'Toplam Tutar (Net)',
        sortable: true,
        render: (v) => (
          <span className={`font-bold text-xs text-right block ${Number(v) < 0 ? 'text-rose-600' : 'text-gray-900'}`}>
            {formatMoney(Number(v))}
          </span>
        )
      },
      {
        key: 'kdvTutar',
        label: 'Toplam KDV',
        sortable: true,
        render: (v) => (
          <span className={`text-xs text-right block text-gray-500 font-medium ${Number(v) < 0 ? 'text-rose-500' : ''}`}>
            {formatMoney(Number(v))}
          </span>
        )
      },
      {
        key: 'kdvliTutar',
        label: 'KDV\'li Genel Toplam',
        sortable: true,
        render: (v) => (
          <span className={`font-black text-xs text-right block ${Number(v) < 0 ? 'text-rose-600' : 'text-indigo-950'}`}>
            {formatMoney(Number(v))}
          </span>
        )
      }
    ],
    []
  )

  const productColumns = useMemo<TableColumn<any>[]>(
    () => [
      {
        key: 'islemTipi',
        label: 'Tip',
        sortable: true,
        searchable: true,
        render: (v) => {
          const isReturn = String(v) === 'İADE'
          return (
            <span
              className={`px-2.5 py-1 rounded-full text-[10px] font-bold border ${
                isReturn
                  ? 'bg-rose-50 text-rose-700 border-rose-200/50'
                  : 'bg-emerald-50 text-emerald-700 border-emerald-200/50'
              }`}
            >
              {v}
            </span>
          )
        }
      },
      {
        key: 'stokKodu',
        label: 'Stok Kodu',
        sortable: true,
        searchable: true,
        render: (v) => <span className="font-mono text-gray-700 text-xs font-semibold">{String(v || '—')}</span>
      },
      {
        key: 'stokAdi',
        label: 'Stok Adı',
        sortable: true,
        searchable: true,
        render: (v) => <span className="text-gray-700 text-xs uppercase max-w-[240px] truncate block" title={String(v)}>{String(v || '—')}</span>
      },
      {
        key: 'stokGrup',
        label: 'Grup',
        sortable: true,
        searchable: true,
        render: (v) => <span className="text-xs uppercase text-gray-400 font-bold">{String(v || '—')}</span>
      },
      {
        key: 'adet',
        label: 'Toplam Adet',
        sortable: true,
        render: (v) => (
          <span className={`font-black text-xs text-right block ${Number(v) < 0 ? 'text-rose-600' : 'text-gray-900'}`}>
            {Number(v).toLocaleString('tr-TR')}
          </span>
        )
      },
      {
        key: 'kdvOran',
        label: 'KDV',
        sortable: true,
        render: (v) => <span className="font-mono text-xs text-right block text-gray-500">%{Number(v)}</span>
      },
      {
        key: 'fiyat',
        label: 'Toplam Tutar (Net)',
        sortable: true,
        render: (v) => (
          <span className={`font-bold text-xs text-right block ${Number(v) < 0 ? 'text-rose-600' : 'text-gray-900'}`}>
            {formatMoney(Number(v))}
          </span>
        )
      },
      {
        key: 'kdvTutar',
        label: 'Toplam KDV',
        sortable: true,
        render: (v) => (
          <span className={`text-xs text-right block text-gray-500 font-medium ${Number(v) < 0 ? 'text-rose-500' : ''}`}>
            {formatMoney(Number(v))}
          </span>
        )
      },
      {
        key: 'kdvliTutar',
        label: 'Toplam KDV\'li',
        sortable: true,
        render: (v) => (
          <span className={`font-black text-xs text-right block ${Number(v) < 0 ? 'text-rose-600' : 'text-indigo-950'}`}>
            {formatMoney(Number(v))}
          </span>
        )
      }
    ],
    []
  )

  // Excel Export
  const handleExport = () => {
    if (!currencyFilteredData || currencyFilteredData.length === 0) return

    const headers = [
      'Islem Tipi',
      'Tarih',
      'Fatura No',
      'Cari Kodu',
      'Cari Adi',
      'Stok Kodu',
      'Stok Adi',
      'Stok Grubu',
      'Adet',
      'Para Birimi',
      'Kur',
      'Net Tutar (TL)',
      'KDV Orani',
      'KDV Tutari (TL)',
      'KDV\'li Toplam (TL)',
      'KDV\'li Toplam (Belge Parasi)'
    ]

    // Excel'de para birimi ve kur açıkça yazar; TL sütunları TL çapası olduğunu söyler,
    // belgenin kendi parasındaki tutar ayrı sütunda durur.
    const csvRows = [
      `Cari Satis Raporu - Para Birimi Suzgeci: ${currencyFilter === 'ALL' ? 'TUMU' : currencyFilter}`,
      headers.join(';')
    ]

    currencyFilteredData.forEach((item) => {
      const row = [
        item.islemTipi,
        formatDate(item.tarih),
        item.faturaNo,
        item.cariKodu,
        item.cariAdi,
        item.stokKodu,
        item.stokAdi,
        item.stokGrup,
        item.adet,
        normalizeCurrencyCode((item as any).paraBirimi),
        (item as any).kur != null ? Number((item as any).kur).toFixed(4) : '',
        item.fiyat.toFixed(2),
        item.kdvOran,
        item.kdvTutar.toFixed(2),
        item.kdvliTutar.toFixed(2),
        (item as any).dovizKdvliTutar != null ? Number((item as any).dovizKdvliTutar).toFixed(2) : ''
      ]
      csvRows.push(row.map((val) => `"${String(val ?? '').replace(/"/g, '""')}"`).join(';'))
    })

    const csvContent = '\uFEFF' + csvRows.join('\n')
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.setAttribute('href', url)
    link.setAttribute('download', `Cari_Satis_Raporu_${currencyFilter === 'ALL' ? 'TUMU' : currencyFilter}_${new Date().toISOString().slice(0, 10)}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  // Summary widgets
  const summaryWidgets = useMemo(() => {
    if (!currencyFilteredData) return { totalSales: 0, totalReturns: 0, netVolume: 0, totalQty: 0 }
    let salesVal = 0
    let returnsVal = 0
    let qty = 0

    currencyFilteredData.forEach(x => {
      qty += x.adet
      if (x.islemTipi === 'SATIŞ') {
        salesVal += x.kdvliTutar
      } else {
        returnsVal += x.kdvliTutar
      }
    })

    return {
      totalSales: salesVal,
      totalReturns: returnsVal,
      netVolume: salesVal + returnsVal, // returnsVal is already negative
      totalQty: qty
    }
  }, [currencyFilteredData])

  return (
    <div className="space-y-6 font-inter text-gray-900 min-h-[calc(100vh-140px)] pb-12 px-3 sm:px-6">
      
      {/* 1. Page Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-gray-100 pb-5">
        <div>
          <h1 className="text-2xl font-black text-gray-900 tracking-tight flex items-center gap-3">
            Cari Satış Raporu
            <span className="text-[10px] font-black text-indigo-700 bg-indigo-50 border border-indigo-100 px-3 py-1 rounded-full uppercase tracking-wider">
              Analiz
            </span>
          </h1>
          <p className="text-xs text-gray-500 mt-1.5">
            Bayi ve müşterilerinize kesilen SATIŞ ve İADE faturalarını detaylı veya gruplanmış olarak görün, satış trendlerini analiz edin.
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

      {/* 2. Advanced Premium Filter Panel */}
      <div className="bg-white border border-gray-200/70 rounded-3xl p-5 shadow-sm space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          
          {/* Dealer Dropdown */}
          <div className="space-y-1.5">
            <label className="block text-[11px] font-bold text-gray-600 uppercase tracking-wider flex items-center gap-1.5">
              <Users size={12} className="text-gray-400" />
              Bayi / Cari Seçimi
            </label>
            <SearchableCariSelect
              value={selectedCustomerCode}
              onChange={(v) => setSelectedCustomerCode(v)}
              options={allCariOptions}
              remoteSearch={cariRemoteSearch}
              remoteLimit={CARI_SEARCH_LIMIT}
              placeholder="Tüm Bayi / Müşteriler"
              showTypeFilter={true}
            />
          </div>

          {/* Start Date */}
          <div className="space-y-1.5">
            <label className="block text-[11px] font-bold text-gray-600 uppercase tracking-wider flex items-center gap-1.5">
              <Calendar size={12} className="text-gray-400" />
              Başlangıç Tarihi
            </label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full h-10 px-3 py-2 text-xs border border-gray-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-indigo-500/15 focus:border-indigo-600 bg-gray-50/50 hover:bg-gray-50 transition-all font-mono text-gray-800"
            />
          </div>

          {/* End Date */}
          <div className="space-y-1.5">
            <label className="block text-[11px] font-bold text-gray-600 uppercase tracking-wider flex items-center gap-1.5">
              <Calendar size={12} className="text-gray-400" />
              Bitiş Tarihi
            </label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full h-10 px-3 py-2 text-xs border border-gray-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-indigo-500/15 focus:border-indigo-600 bg-gray-50/50 hover:bg-gray-50 transition-all font-mono text-gray-800"
            />
          </div>

        </div>

        {/* PARA BİRİMİ SÜZGECİ — rapor satırın kendi para birimini taşır; seçim istemcide süzer. */}
        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-gray-100 text-[10px] text-gray-500 font-bold uppercase">
          <span className="mr-1">Para Birimi:</span>
          {([
            { id: 'ALL', label: 'Tümü' },
            { id: 'TRY', label: '₺ TL' },
            { id: 'EUR', label: '€ EUR' },
            { id: 'USD', label: '$ USD' },
            { id: 'GBP', label: '£ GBP' }
          ] as Array<{ id: 'ALL' | 'TRY' | 'EUR' | 'USD' | 'GBP'; label: string }>)
            .filter((c) => availableCurrencies.includes(c.id))
            .map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setCurrencyFilter(c.id)}
                className={
                  'px-3 py-1.5 rounded-full border transition-all active:scale-95 ' +
                  (currencyFilter === c.id
                    ? 'border-indigo-600 text-indigo-700 bg-indigo-50'
                    : 'border-gray-200 text-gray-600 hover:border-indigo-500 hover:text-indigo-600 hover:bg-indigo-50/20')
                }
              >
                {c.label}
              </button>
            ))}
        </div>

        {/* Date presets toolbar */}
        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-gray-100 text-[10px] text-gray-500 font-bold uppercase">
          <span className="mr-1">Hızlı Filtre:</span>
          {[
            { id: 'all', label: 'Tüm Zamanlar' },
            { id: 'thisMonth', label: 'Bu Ay' },
            { id: 'thisYear', label: 'Bu Yıl' },
            { id: 'prevYear', label: 'Geçen Yıl' },
            { id: 'last12Months', label: 'Son 12 Ay' }
          ].map(p => (
            <button
              key={p.id}
              type="button"
              onClick={() => applyPreset(p.id as any)}
              className="px-3 py-1.5 rounded-full border border-gray-200 hover:border-indigo-500 hover:text-indigo-600 hover:bg-indigo-50/20 active:scale-95 transition-all text-gray-600"
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* 3. Stat widgets panel */}
      {reportData && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-gradient-to-br from-indigo-50 to-indigo-100/50 border border-indigo-200/30 p-5 rounded-3xl shadow-sm">
            <span className="text-[10px] font-bold text-indigo-600 uppercase tracking-widest block">Toplam Satış</span>
            <span className="text-xl font-black text-indigo-950 block mt-1">{formatMoney(summaryWidgets.totalSales)}</span>
          </div>

          <div className="bg-gradient-to-br from-rose-50 to-rose-100/50 border border-rose-200/30 p-5 rounded-3xl shadow-sm">
            <span className="text-[10px] font-bold text-rose-600 uppercase tracking-widest block">Toplam İade</span>
            <span className="text-xl font-black text-rose-950 block mt-1">{formatMoney(summaryWidgets.totalReturns)}</span>
          </div>

          <div className="bg-gradient-to-br from-emerald-50 to-emerald-100/50 border border-emerald-200/30 p-5 rounded-3xl shadow-sm">
            <span className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest block">Net Hacim (KDV'li)</span>
            <span className="text-xl font-black text-emerald-950 block mt-1">{formatMoney(summaryWidgets.netVolume)}</span>
          </div>

          <div className="bg-gradient-to-br from-slate-50 to-slate-100/50 border border-slate-200/30 p-5 rounded-3xl shadow-sm">
            <span className="text-[10px] font-bold text-slate-600 uppercase tracking-widest block">Net Adetsel Satış</span>
            <span className="text-xl font-black text-slate-950 block mt-1">
              {summaryWidgets.totalQty.toLocaleString('tr-TR')} <span className="text-xs font-semibold text-slate-500">Adet</span>
            </span>
          </div>
        </div>
      )}

      {/* 4. Tab selection */}
      <div className="flex items-center gap-1 border-b border-gray-200/80">
        {[
          { id: 'detailed', label: 'Detaylı Döküm', icon: List },
          { id: 'group', label: 'Gruba Göre Satış', icon: PieChart },
          { id: 'product', label: 'Ürüne Göre Satış', icon: BarChart3 }
        ].map(tab => {
          const Icon = tab.icon
          const active = activeTab === tab.id
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                setActiveTab(tab.id as any)
                setGlobalSearch('')
              }}
              className={`flex items-center gap-2 px-5 py-3 text-xs font-extrabold transition-all border-b-2 uppercase tracking-wider ${
                active
                  ? 'border-indigo-600 text-indigo-700 font-black'
                  : 'border-transparent text-gray-500 hover:text-gray-800'
              }`}
            >
              <Icon size={14} />
              <span>{tab.label}</span>
            </button>
          )
        })}
      </div>

      {error && (
        <div className="p-4 text-xs font-semibold text-red-700 bg-red-50 border border-red-200/50 rounded-2xl shadow-sm flex items-center gap-2">
          <Info size={16} />
          <span>{error}</span>
        </div>
      )}

      {/* 5. Sub-views rendering */}
      {loading && !reportData ? (
        <div className="flex flex-col items-center justify-center py-24 text-gray-400 bg-white border border-gray-100 rounded-3xl shadow-sm">
          <div className="w-9 h-9 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mb-4" />
          <p className="text-xs font-semibold text-gray-500">Cari Satış Verileri Kaplanıyor...</p>
        </div>
      ) : reportData && reportData.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-gray-400 bg-white border border-gray-100 rounded-3xl shadow-sm">
          <span className="text-3xl mb-2">📊</span>
          <p className="text-xs font-semibold text-gray-500">Seçilen filtrelere uygun veri bulunamadı.</p>
        </div>
      ) : (
        <div className="space-y-6">
          
          {/* A. DETAILED TAB */}
          {activeTab === 'detailed' && (
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
                <input
                  type="text"
                  placeholder="Seçilen listeyi tablodan filtrele (fatura no, stok kodu, ürün adı)..."
                  value={globalSearch}
                  onChange={(e) => setGlobalSearch(e.target.value)}
                  className="w-full sm:max-w-md h-9 px-4 rounded-xl border border-gray-200 bg-white text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-600"
                />
                <span className="text-xs text-gray-500 font-bold">Toplam Hareket: {detailedRows.length} satır</span>
              </div>

              <div className="bg-white rounded-3xl border border-gray-200/70 overflow-hidden shadow-sm">
                <Table<CariSatisReportItemDto>
          onRefresh={() => void loadReport()}
                  columns={detailedColumns}
                  data={detailedRows}
                  showColumnFilters={true}
                  globalSearch={globalSearch}
                  rowKey={(row, idx) => `${row.faturaNo}_${row.stokKodu}_${idx}`}
                  rowClassName={() => 'hover:bg-slate-50/50 transition-all text-gray-700'}
                />
              </div>
            </div>
          )}

          {/* B. GROUP TAB */}
          {activeTab === 'group' && (
            <div className="space-y-6">
              
              {/* Dynamic Donut Charts */}
              {uniqueYears.length > 0 && (
                <div className="space-y-3">
                  <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest flex items-center gap-1.5">
                    <PieChart size={13} />
                    Gruba Göre Yıllık Satış Dağılımı (Adetsel)
                  </h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {uniqueYears.slice(0, 3).map(year => {
                      const chartData = groupChartDataByYear[year] || []
                      return (
                        <DonutChart
                          key={year}
                          data={chartData}
                          title={`${year} YILI GRUPLARA GÖRE SATIŞ`}
                        />
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Grouped Table */}
              <div className="space-y-3 pt-4">
                <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
                  <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest flex items-center gap-1.5">
                    <List size={13} />
                    Grup Bazlı Satış Özeti
                  </h2>
                  <input
                    type="text"
                    placeholder="Tablodan ara..."
                    value={globalSearch}
                    onChange={(e) => setGlobalSearch(e.target.value)}
                    className="w-full sm:max-w-xs h-9 px-4 rounded-xl border border-gray-200 bg-white text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-600"
                  />
                </div>

                <div className="bg-white rounded-3xl border border-gray-200/70 overflow-hidden shadow-sm">
                  <Table<any>
          onRefresh={() => void loadReport()}
                    columns={groupColumns}
                    data={groupedByGroupRows}
                    showColumnFilters={true}
                    globalSearch={globalSearch}
                    rowKey={(row, idx) => `${row.islemTipi}_${row.stokGrup}_${row.kdvOran}_${idx}`}
                    rowClassName={() => 'hover:bg-slate-50/50 transition-all text-gray-700'}
                  />
                </div>
              </div>

            </div>
          )}

          {/* C. PRODUCT TAB */}
          {activeTab === 'product' && (
            <div className="space-y-6">
              
              {/* Dynamic Donut Charts */}
              {uniqueYears.length > 0 && (
                <div className="space-y-3">
                  <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest flex items-center gap-1.5">
                    <PieChart size={13} />
                    Ürüne Göre Yıllık Satış Dağılımı (Adetsel)
                  </h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {uniqueYears.slice(0, 3).map(year => {
                      const chartData = productChartDataByYear[year] || []
                      return (
                        <DonutChart
                          key={year}
                          data={chartData}
                          title={`${year} YILI EN ÇOK SATAN ÜRÜNLER`}
                        />
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Product Table */}
              <div className="space-y-3 pt-4">
                <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
                  <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest flex items-center gap-1.5">
                    <List size={13} />
                    Ürün Bazlı Satış Özeti
                  </h2>
                  <input
                    type="text"
                    placeholder="Tablodan ara..."
                    value={globalSearch}
                    onChange={(e) => setGlobalSearch(e.target.value)}
                    className="w-full sm:max-w-xs h-9 px-4 rounded-xl border border-gray-200 bg-white text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-600"
                  />
                </div>

                <div className="bg-white rounded-3xl border border-gray-200/70 overflow-hidden shadow-sm">
                  <Table<any>
          onRefresh={() => void loadReport()}
                    columns={productColumns}
                    data={groupedByProductRows}
                    showColumnFilters={true}
                    globalSearch={globalSearch}
                    rowKey={(row, idx) => `${row.islemTipi}_${row.stokKodu}_${row.kdvOran}_${idx}`}
                    rowClassName={() => 'hover:bg-slate-50/50 transition-all text-gray-700'}
                  />
                </div>
              </div>

            </div>
          )}

        </div>
      )}

    </div>
  )
}
