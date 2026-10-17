import { useEffect, useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { AdminLayout } from '../components/admin/AdminLayout'
import { getAdminToken, readApiResponse } from '../lib/api'
import { useToast } from '../components/ui/ToastContext'

interface AdminLog {
  id: string
  userEmail: string
  action: string
  details: string
  ipAddress: string
  createdAt: string
}

type DashboardData = {
  kpi: {
    totalRevenue: number
    totalOrders: number
    totalCustomers: number
    avgOrder: number
    totalProducts: number
    totalSubscribers: number
  }
  weeklySales: Array<{ day: string; current: number; previous: number }>
  dailySales?: Array<{ day: string; current: number; previous: number }>
  monthlySales?: Array<{ day: string; current: number; previous: number }>
  categories: Array<{ name: string; count: number }>
  orderStatuses: Record<string, number>
  recentOrders: Array<{
    orderNo: string
    customerName: string
    total: number
    status: string
    createdAtUtc: string
  }>
  lowStock: Array<{ name: string; stock: number }>
  recentActivities: Array<{ action: string; details: string; createdAt: string }>
}

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ')
}

export function translateAction(action: string): string {
  const mapping: Record<string, string> = {
    'MediaUpload': 'Görsel Yüklemesi',
    'MediaDelete': 'Görsel Silinmesi',
    'ProductMetadataUpdate': 'Ürün Detay Güncellemesi',
    'CreateProduct': 'Ürün Oluşturma',
    'UpdateProduct': 'Ürün Güncelleme',
    'DeleteProduct': 'Ürün Silme',
    'UpdateCategory': 'Kategori Güncelleme',
    'CreateCategory': 'Kategori Oluşturma',
    'DeleteCategory': 'Kategori Silme',
    'AddSlider': 'Slider Ekleme',
    'UpdateSlider': 'Slider Güncelleme',
    'DeleteSlider': 'Slider Silme',
    'AddBanner': 'Banner Ekleme',
    'UpdateBanner': 'Banner Güncelleme',
    'DeleteBanner': 'Banner Silme',
    'UpdateSettings': 'Ayar Güncelleme',
    'Login': 'Sisteme Giriş',
    'Logout': 'Sistemden Çıkış',
    'UpdateShipping': 'Kargo Bilgisi Güncelleme',
    'UpdateReturn': 'İade Talebi Güncelleme',
    'UpdateReviewStatus': 'Yorum Durumu Güncelleme',
    'DeleteReview': 'Yorum Silme',
    'SaveIntegrations': 'Entegrasyon Güncelleme',
  }
  
  if (mapping[action]) return mapping[action]

  let text = action
  text = text.replace(/([A-Z])/g, ' $1').trim()
  text = text
    .replace(/Create/gi, 'Oluşturma')
    .replace(/Update/gi, 'Güncelleme')
    .replace(/Delete/gi, 'Silme')
    .replace(/Upload/gi, 'Yükleme')
    .replace(/Product/gi, 'Ürün')
    .replace(/Category/gi, 'Kategori')
    .replace(/Media/gi, 'Medya')
    .replace(/Shipping/gi, 'Kargo')
    .replace(/Return/gi, 'İade')
    .replace(/Review/gi, 'Yorum')
    .replace(/Slider/gi, 'Slider')
    .replace(/Banner/gi, 'Banner')
    .replace(/Setting/gi, 'Ayar')

  return text
}

export function translateDetails(details: string): string {
  if (!details) return details

  // 1. Uploaded media file
  if (details.includes('Uploaded media file:')) {
    const match = details.match(/Uploaded media file:\s*(.+?)\s*\(Folder:\s*(.+?)\)/)
    if (match) {
      return `Medya dosyası yüklendi: ${match[1]} (Klasör: ${match[2]})`
    }
  }

  // 2. Deleted media file
  if (details.includes('Deleted media file:')) {
    const match = details.match(/Deleted media file:\s*(.+?)\s*from folder:\s*(.+)/)
    if (match) {
      return `Medya dosyası silindi: ${match[1]} (Klasör: ${match[2]})`
    }
  }

  // 3. Updated product metadata
  if (details.includes('Updated product metadata for ID')) {
    const match = details.match(/Updated product metadata for ID\s*(.+?)\s*\(Status:\s*(.+?),\s*Slug:\s*(.+?)\)/)
    if (match) {
      return `Ürün detayları güncellendi (Ürün : ${match[3]})`
    }
  }

  // 4. Coupons
  if (details.includes('Yeni kupon oluşturuldu:')) {
    return details
  }
  if (details.includes('Kupon güncellendi:')) {
    return details
  }
  if (details.includes('Kupon silindi:')) {
    return details
  }

  return details
}

export function AdminDashboardPage() {
  const { showToast } = useToast()
  const [logs, setLogs] = useState<AdminLog[]>([])
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)

  const authHeader = useMemo(() => {
    const token = getAdminToken()
    return token ? { Authorization: `Bearer ${token}` } : null
  }, [])

  const fetchDashboardData = async () => {
    if (!authHeader) return
    try {
      setLoading(true)
      const [dashRes, logsRes] = await Promise.all([
        fetch('/api/admin/modules/dashboard', { headers: authHeader }),
        fetch('/api/admin/logs?limit=10', { headers: authHeader }),
      ])

      const dashJson = await readApiResponse(dashRes)
      const logsJson = await readApiResponse(logsRes)

      if (dashJson?.success && dashJson?.data) {
        setData(dashJson.data)
      }
      if (Array.isArray(logsJson)) {
        setLogs(logsJson)
      }
    } catch (e) {
      console.error('Failed to load dashboard data', e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchDashboardData()
  }, [authHeader])

  const kpi = data?.kpi || {
    totalRevenue: 0,
    totalOrders: 0,
    totalCustomers: 0,
    avgOrder: 0,
    totalProducts: 0,
    totalSubscribers: 0,
  }

  const [salesPeriod, setSalesPeriod] = useState<'daily' | 'weekly' | 'monthly'>('weekly')

  const recentOrders = data?.recentOrders || []
  const lowStock = data?.lowStock || []
  const recentActivities = data?.recentActivities || []

  const salesData = useMemo(() => {
    if (salesPeriod === 'daily') return data?.dailySales || []
    if (salesPeriod === 'monthly') return data?.monthlySales || []
    return data?.weeklySales || []
  }, [data, salesPeriod])

  // Dynamic max value for sales chart
  const maxSalesVal = useMemo(() => {
    if (salesData.length === 0) return 1000
    const vals = salesData.map((d) => Math.max(d.current, d.previous))
    const max = Math.max(...vals)
    return max === 0 ? 1000 : max
  }, [salesData])

  // Process dynamic categories for donut chart
  const processedCategories = useMemo(() => {
    const categories = data?.categories || []
    if (categories.length === 0) {
      return [
        { name: 'Ürün Yok', count: 0, pct: 100, offset: 0, rotation: 0, colorClass: 'text-zinc-200', dotColor: 'bg-zinc-200' }
      ]
    }
    const total = categories.reduce((sum, c) => sum + c.count, 0)
    if (total === 0) {
      return [
        { name: 'Kategorisiz', count: 0, pct: 100, offset: 0, rotation: 0, colorClass: 'text-zinc-200', dotColor: 'bg-zinc-200' }
      ]
    }

    const sorted = [...categories].sort((a, b) => b.count - a.count)
    const top = sorted.slice(0, 3)
    const rest = sorted.slice(3)
    const restCount = rest.reduce((sum, c) => sum + c.count, 0)

    const list = [...top]
    if (restCount > 0) {
      list.push({ name: 'Diğer', count: restCount })
    }

    let currentRotation = 0
    return list.map((c, idx) => {
      const pct = (c.count / total) * 100
      const offset = 314.15 - (pct / 100) * 314.15
      const rotation = currentRotation
      currentRotation += pct

      let colorClass = 'text-[#df0000]'
      let dotColor = 'bg-[#df0000]'
      if (idx === 1) {
        colorClass = 'text-zinc-800'
        dotColor = 'bg-zinc-800'
      } else if (idx === 2) {
        colorClass = 'text-blue-500'
        dotColor = 'bg-blue-500'
      } else if (idx === 3) {
        colorClass = 'text-amber-500'
        dotColor = 'bg-amber-500'
      }

      return {
        name: c.name,
        count: c.count,
        pct,
        offset,
        rotation: rotation * 3.6,
        colorClass,
        dotColor,
      }
    })
  }, [data?.categories])


  return (
    <AdminLayout
      title="Dashboard"
      subtitle="Stilsoft KKTC e-ticaret sitenizin genel durumunu ve son etkinlikleri izleyin."
      top={
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              fetchDashboardData()
              showToast('İstatistikler güncellendi.', 'success')
            }}
            className="flex items-center gap-1.5 h-10 px-4 rounded-2xl border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 transition active:scale-95 text-xs font-bold shadow-sm"
          >
            <span className="material-symbols-outlined text-[16px]">refresh</span>
            Verileri Güncelle
          </button>
        </div>
      }
    >
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-4 border-[#df0000]/20 border-t-[#df0000] rounded-full animate-spin" />
        </div>
      ) : (
        <div className="space-y-6">
          {/* Breadcrumb Header Canvas */}
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-2">
            <div>
              <nav className="flex text-xs text-zinc-400 gap-1.5 mb-2 font-medium">
                <span>Genel</span>
                <span className="material-symbols-outlined text-[14px]">chevron_right</span>
                <span className="text-[#df0000] font-semibold">Dashboard</span>
              </nav>
              <h2 className="text-xl font-bold text-zinc-900 tracking-tight">Genel Durum Kontrol Paneli</h2>
              <p className="text-xs text-zinc-550 mt-1 max-w-xl">Satış hacmini, müşteri verilerini ve kritik operasyonları izleyin.</p>
            </div>
          </div>

          {/* KPI Row (4 Cards) */}
          <div className="grid gap-5 grid-cols-2 md:grid-cols-4">
            {/* Toplam Ciro */}
            <div className="bg-white rounded-3xl border border-zinc-200/80 p-5 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-300">
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-[10px] font-extrabold text-zinc-400 uppercase tracking-widest">TOPLAM CİRO</p>
                  <p className="text-2xl font-black text-zinc-950 mt-1">
                    ₺{kpi.totalRevenue.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
                  </p>
                </div>
                <div className="p-2.5 rounded-2xl bg-[#df0000]/5 text-[#df0000]">
                  <span className="material-symbols-outlined text-[24px]">payments</span>
                </div>
              </div>
              <div className="mt-3.5 pt-3 border-t border-zinc-100 flex items-center gap-1.5 text-[10px] font-bold text-green-600 uppercase tracking-wider">
                <span className="material-symbols-outlined text-[14px]">trending_up</span>
                <span>Aktif Satış Ciro</span>
              </div>
            </div>

            {/* Siparişler */}
            <div className="bg-white rounded-3xl border border-zinc-200/80 p-5 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-300">
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-[10px] font-extrabold text-zinc-400 uppercase tracking-widest">SİPARİŞLER</p>
                  <p className="text-2xl font-black text-zinc-950 mt-1">{kpi.totalOrders}</p>
                </div>
                <div className="p-2.5 rounded-2xl bg-blue-50 text-blue-600">
                  <span className="material-symbols-outlined text-[24px]">shopping_cart</span>
                </div>
              </div>
              <div className="mt-3.5 pt-3 border-t border-zinc-100 flex items-center gap-1.5 text-[10px] font-bold text-green-600 uppercase tracking-wider">
                <span className="material-symbols-outlined text-[14px]">done_all</span>
                <span>Toplam Sipariş</span>
              </div>
            </div>

            {/* Müşteriler */}
            <div className="bg-white rounded-3xl border border-zinc-200/80 p-5 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-300">
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-[10px] font-extrabold text-zinc-400 uppercase tracking-widest">KULLANICILAR</p>
                  <p className="text-2xl font-black text-zinc-950 mt-1">{kpi.totalCustomers}</p>
                </div>
                <div className="p-2.5 rounded-2xl bg-emerald-50 text-emerald-600">
                  <span className="material-symbols-outlined text-[24px]">group</span>
                </div>
              </div>
              <div className="mt-3.5 pt-3 border-t border-zinc-100 flex items-center gap-1.5 text-[10px] font-bold text-green-600 uppercase tracking-wider">
                <span className="material-symbols-outlined text-[14px]">how_to_reg</span>
                <span>Kayıtlı Müşteri</span>
              </div>
            </div>

            {/* Ortalama Sepet */}
            <div className="bg-white rounded-3xl border border-zinc-200/80 p-5 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-300">
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-[10px] font-extrabold text-zinc-400 uppercase tracking-widest">ORTALAMA SEPET</p>
                  <p className="text-2xl font-black text-zinc-950 mt-1">
                    ₺{kpi.avgOrder.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}
                  </p>
                </div>
                <div className="p-2.5 rounded-2xl bg-amber-50 text-amber-600">
                  <span className="material-symbols-outlined text-[24px]">shopping_bag</span>
                </div>
              </div>
              <div className="mt-3.5 pt-3 border-t border-zinc-100 flex items-center gap-1.5 text-[10px] font-bold text-green-600 uppercase tracking-wider">
                <span className="material-symbols-outlined text-[14px]">local_mall</span>
                <span>Sepet Ortalaması</span>
              </div>
            </div>
          </div>

          {/* Graphics Row: Weekly Sales & Category Distribution */}
          <div className="grid gap-6 grid-cols-1 lg:grid-cols-10">
            {/* Sales Chart (60%) */}
            <div className="lg:col-span-6 bg-white border border-zinc-200/80 rounded-3xl p-6 shadow-sm flex flex-col justify-between">
              <div className="flex items-center justify-between flex-wrap gap-4">
                <div>
                  <h3 className="text-sm font-bold text-zinc-800 uppercase tracking-wider">
                    {salesPeriod === 'daily' ? 'Günlük Satış Hacmi' : salesPeriod === 'monthly' ? 'Aylık Satış Hacmi' : 'Haftalık Satış Hacmi'}
                  </h3>
                  <p className="text-[11px] font-semibold text-zinc-400 mt-1">
                    {salesPeriod === 'daily' 
                      ? 'Bugün ve dünün karşılaştırmalı analizi (3\'er saatlik bloklar)' 
                      : salesPeriod === 'monthly' 
                        ? 'Son 6 ay ve geçen yılın aynı döneminin karşılaştırmalı analizi' 
                        : 'Bu dönem ve önceki dönemin karşılaştırmalı analizi'}
                  </p>
                </div>
                
                <div className="flex items-center gap-1 bg-zinc-100 p-1 rounded-xl">
                  <button
                    onClick={() => setSalesPeriod('daily')}
                    className={cx(
                      'px-2.5 py-1 text-[11px] font-bold rounded-lg transition-all duration-200 active:scale-95',
                      salesPeriod === 'daily' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-800'
                    )}
                  >
                    Günlük
                  </button>
                  <button
                    onClick={() => setSalesPeriod('weekly')}
                    className={cx(
                      'px-2.5 py-1 text-[11px] font-bold rounded-lg transition-all duration-200 active:scale-95',
                      salesPeriod === 'weekly' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-800'
                    )}
                  >
                    Haftalık
                  </button>
                  <button
                    onClick={() => setSalesPeriod('monthly')}
                    className={cx(
                      'px-2.5 py-1 text-[11px] font-bold rounded-lg transition-all duration-200 active:scale-95',
                      salesPeriod === 'monthly' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-800'
                    )}
                  >
                    Aylık
                  </button>
                </div>
              </div>

              {/* Pure CSS Bar Chart with Gridlines */}
              <div className="h-56 relative pt-6 border-b border-zinc-150 pb-2 mt-4">
                {/* Horizontal Gridlines */}
                <div className="absolute inset-x-0 bottom-8 top-6 flex flex-col justify-between pointer-events-none">
                  <div className="border-t border-zinc-100/70 w-full" />
                  <div className="border-t border-zinc-100/70 w-full" />
                  <div className="border-t border-zinc-100/70 w-full" />
                  <div className="border-t border-zinc-100/70 w-full" />
                </div>

                {/* Bars flexbox container */}
                <div className="absolute inset-0 pt-6 pb-2 flex items-end justify-between gap-3 z-10">
                  {salesData.map((item) => {
                    const currHeight = (item.current / maxSalesVal) * 100
                    const prevHeight = (item.previous / maxSalesVal) * 100
                    return (
                      <div key={item.day} className="flex-1 flex flex-col items-center h-full justify-end group cursor-pointer">
                        <div className="w-full flex items-end justify-center gap-1.5 h-full relative">
                          {/* Tooltip */}
                          <div className="absolute -top-12 bg-zinc-900/95 backdrop-blur text-white text-[9px] font-bold rounded-xl px-2.5 py-1.5 opacity-0 group-hover:opacity-100 transition-all duration-200 pointer-events-none whitespace-nowrap z-20 shadow-xl border border-zinc-800 flex flex-col gap-0.5">
                            <span className="text-rose-400">
                              {salesPeriod === 'daily' ? 'Bugün' : salesPeriod === 'monthly' ? 'Bu Yıl' : 'Bu Dönem'}: ₺{item.current.toLocaleString('tr-TR')}
                            </span>
                            <span className="text-zinc-400">
                              {salesPeriod === 'daily' ? 'Dün' : salesPeriod === 'monthly' ? 'Geçen Yıl' : 'Önceki'}: ₺{item.previous.toLocaleString('tr-TR')}
                            </span>
                          </div>

                          {/* Previous Period Bar */}
                          <div
                            className="w-2.5 bg-gradient-to-t from-zinc-200 to-zinc-300 rounded-t-full transition-all duration-500 hover:scale-y-105"
                            style={{ height: `${prevHeight}%` }}
                          />
                          {/* Current Period Bar */}
                          <div
                            className="w-2.5 bg-gradient-to-t from-[#df0000] to-[#ff4d4d] rounded-t-full transition-all duration-500 hover:scale-y-105 group-hover:shadow-[0_0_8px_rgba(223,0,0,0.3)]"
                            style={{ height: `${currHeight}%` }}
                          />
                        </div>
                        <span className="text-[10px] text-zinc-400 font-bold mt-2">{item.day}</span>
                      </div>
                    )
                  })}
                  {salesData.length === 0 && (
                    <div className="w-full text-center py-20 text-xs italic text-zinc-400">Veri bulunmuyor</div>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-4 pt-3 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-gradient-to-t from-[#df0000] to-[#ff4d4d]" />
                  <span>{salesPeriod === 'daily' ? 'Bugün' : salesPeriod === 'monthly' ? 'Bu Yıl' : 'Bu Dönem'}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-gradient-to-t from-zinc-200 to-zinc-300" />
                  <span>{salesPeriod === 'daily' ? 'Dün' : salesPeriod === 'monthly' ? 'Geçen Yıl' : 'Önceki Dönem'}</span>
                </div>
              </div>
            </div>

            {/* Category Distribution (40%) */}
            <div className="lg:col-span-4 bg-white border border-zinc-200/80 rounded-3xl p-6 shadow-sm flex flex-col justify-between">
              <div>
                <h3 className="text-sm font-bold text-zinc-800 uppercase tracking-wider">Kategori Dağılımı</h3>
                <p className="text-[11px] font-semibold text-zinc-400 mt-1">Ürünlerin kategorilere göre dağılımı</p>
              </div>

              {/* Donut Chart representation */}
              <div className="flex items-center justify-center py-4">
                <div className="relative w-32 h-32 flex items-center justify-center">
                  <svg className="w-full h-full transform -rotate-90">
                    <circle className="text-zinc-100" cx="64" cy="64" fill="transparent" r="50" stroke="currentColor" strokeWidth="8" />
                    {processedCategories.map((c, idx) => (
                      <circle
                        key={idx}
                        cx="64"
                        cy="64"
                        fill="transparent"
                        r="50"
                        stroke="currentColor"
                        strokeDasharray="314.15"
                        strokeDashoffset={c.offset}
                        strokeWidth="10"
                        className={cx(c.colorClass, 'transition-all duration-300 hover:stroke-[12px]')}
                        style={{
                          transform: `rotate(${c.rotation}deg)`,
                          transformOrigin: '64px 64px',
                        }}
                      />
                    ))}
                  </svg>
                  <div className="absolute flex flex-col items-center justify-center text-center">
                    <span className="text-2xl font-black text-zinc-900 tracking-tight leading-none">
                      {data?.categories?.length || 0}
                    </span>
                    <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-widest mt-1">
                      Kategori
                    </span>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 text-[10px] font-bold uppercase tracking-wider text-zinc-500 pt-3 border-t border-zinc-100">
                {processedCategories.map((c, idx) => (
                  <div key={idx} className="flex items-center justify-between w-full font-semibold">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className={cx('w-2 h-2 rounded-full shadow-sm flex-shrink-0', c.dotColor)} />
                      <span className="truncate text-zinc-700 font-bold" title={c.name}>{c.name}</span>
                    </div>
                    <span className="text-zinc-400 font-mono text-[9px] ml-1 flex-shrink-0">
                      {c.count} ad. (%{c.pct.toFixed(0)})
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Lower Grid: Son Siparişler & Düşük Stok */}
          <div className="grid gap-6 grid-cols-1 lg:grid-cols-10">
            {/* Son Siparişler (60%) */}
            <div className="lg:col-span-6 bg-white border border-zinc-200/80 rounded-3xl shadow-sm overflow-hidden flex flex-col justify-between">
              <div className="p-5 border-b border-zinc-150 flex justify-between items-center bg-zinc-50/50">
                <span className="text-xs font-black text-zinc-800 uppercase tracking-wider">Son Siparişler</span>
                <Link to="/admin/orders" className="text-[10px] font-bold text-[#df0000] hover:underline uppercase">Tümünü Gör</Link>
              </div>
              <div className="overflow-x-auto w-full flex-1">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-zinc-50 border-b border-zinc-200 text-zinc-400 font-extrabold uppercase text-[9px] tracking-wider">
                      <th className="px-5 py-3.5">No</th>
                      <th className="px-5 py-3.5">Müşteri</th>
                      <th className="px-5 py-3.5">Tutar</th>
                      <th className="px-5 py-3.5">Durum</th>
                      <th className="px-5 py-3.5 text-right">Tarih</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 text-zinc-650">
                    {recentOrders.map((order, idx) => {
                      const getStatusStyle = (status: string) => {
                        if (status === 'Delivered') return 'bg-green-50 text-green-700 border-green-200'
                        if (status === 'Shipped') return 'bg-blue-50 text-blue-700 border-blue-200'
                        if (status === 'Processing') return 'bg-indigo-50 text-indigo-700 border-indigo-200'
                        if (status === 'Cancelled') return 'bg-rose-50 text-rose-700 border-rose-200'
                        return 'bg-amber-50 text-amber-700 border-amber-200'
                      }

                      const getStatusText = (status: string) => {
                        if (status === 'Delivered') return 'Teslim Edildi'
                        if (status === 'Shipped') return 'Kargoda'
                        if (status === 'Processing') return 'Hazırlanıyor'
                        if (status === 'Cancelled') return 'İptal Edildi'
                        return 'Bekliyor'
                      }

                      return (
                        <tr key={idx} className="hover:bg-zinc-50/50 transition">
                          <td className="px-5 py-3.5 font-mono font-bold text-zinc-950">
                            {order.orderNo ? order.orderNo.substring(0, 8) : `#${idx}`}
                          </td>
                          <td className="px-5 py-3.5 font-semibold text-zinc-900">{order.customerName}</td>
                          <td className="px-5 py-3.5 font-black text-zinc-950">
                            ₺{order.total.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
                          </td>
                          <td className="px-5 py-3.5">
                            <span className={cx('inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-bold border', getStatusStyle(order.status))}>
                              {getStatusText(order.status)}
                            </span>
                          </td>
                          <td className="px-5 py-3.5 text-right text-zinc-400 font-medium whitespace-nowrap">
                            {new Date(order.createdAtUtc).toLocaleDateString('tr-TR')}
                          </td>
                        </tr>
                      )
                    })}
                    {recentOrders.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-5 py-8 text-center text-zinc-400 italic">
                          Henüz sipariş kaydı bulunmamaktadır.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Düşük Stok Listesi (40%) */}
            <div className="lg:col-span-4 bg-white border border-zinc-200/80 rounded-3xl shadow-sm flex flex-col justify-between overflow-hidden">
              <div className="p-5 border-b border-zinc-150 flex justify-between items-center bg-zinc-50/50">
                <span className="text-xs font-black text-zinc-800 uppercase tracking-wider">Kritik Stok Uyarısı</span>
                <Link to="/admin/inventory" className="text-[10px] font-bold text-[#df0000] hover:underline uppercase">Envanter</Link>
              </div>
              <div className="p-5 space-y-3.5 flex-1 bg-white">
                {lowStock.map((item, idx) => (
                  <div key={idx} className="flex justify-between items-center text-xs font-bold text-zinc-700">
                    <span className="truncate max-w-[190px] text-zinc-850 font-medium" title={item.name}>{item.name}</span>
                    <span className={cx(
                      'inline-flex items-center gap-1.5 px-2 py-0.5 rounded border text-[9px] font-extrabold uppercase tracking-wider',
                      item.stock === 0 ? 'bg-rose-50 text-rose-700 border-rose-250' :
                      item.stock <= 5 ? 'bg-amber-50 text-amber-700 border-amber-250 animate-pulse' :
                      'bg-zinc-50 text-zinc-650 border-zinc-200'
                    )}>
                      {item.stock === 0 ? 'Tükendi' : `${item.stock} Adet`}
                    </span>
                  </div>
                ))}
                {lowStock.length === 0 && (
                  <div className="text-center py-8 text-xs italic text-zinc-450">Kritik stokta ürün yok</div>
                )}
              </div>
            </div>
          </div>

          {/* Bottom Grid: Timeline / Admin Logs */}
          <div className="grid gap-6 grid-cols-1 lg:grid-cols-10">
            {/* Son Aktiviteler / Timeline (100%) */}
            <div className="lg:col-span-10 bg-white border border-zinc-200/80 rounded-3xl p-6 shadow-sm space-y-4">
              <div>
                <h3 className="text-sm font-bold text-zinc-800 uppercase tracking-wider">Son Sistem Aktiviteleri</h3>
                <p className="text-[11px] font-semibold text-zinc-400 mt-1">Sistemdeki son idari ve operasyonel hareketler</p>
              </div>
              <div className="relative border-l border-zinc-150 pl-5 ml-2.5 space-y-4.5 pt-2">
                {recentActivities.map((act, idx) => {
                  const getIcon = (action: string) => {
                    const a = action.toLowerCase()
                    if (a.includes('order') || a.includes('checkout')) return 'shopping_cart'
                    if (a.includes('product')) return 'inventory_2'
                    if (a.includes('category')) return 'folder'
                    if (a.includes('user') || a.includes('customer')) return 'person'
                    if (a.includes('login') || a.includes('auth')) return 'login'
                    return 'info'
                  }

                  const getColorClass = (action: string) => {
                    const a = action.toLowerCase()
                    if (a.includes('order') || a.includes('checkout')) return 'bg-green-500 text-white'
                    if (a.includes('product')) return 'bg-blue-500 text-white'
                    if (a.includes('category')) return 'bg-amber-500 text-white'
                    if (a.includes('login') || a.includes('auth')) return 'bg-zinc-800 text-white'
                    return 'bg-indigo-500 text-white'
                  }

                  return (
                    <div key={idx} className="relative">
                      <span className={cx(
                        'absolute -left-8 top-0.5 w-6 h-6 rounded-full flex items-center justify-center text-[13px] font-black shadow-sm',
                        getColorClass(act.action)
                      )}>
                        <span className="material-symbols-outlined text-[13px]">{getIcon(act.action)}</span>
                      </span>
                      <div className="text-xs">
                        <div className="flex justify-between items-center font-bold text-zinc-800">
                          <span className="truncate max-w-[180px]">{translateAction(act.action)}</span>
                          <span className="text-[10px] text-zinc-400 font-medium whitespace-nowrap">
                            {new Date(act.createdAt).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                        <p className="text-zinc-505 text-[11px] font-medium mt-0.5 leading-relaxed">{translateDetails(act.details)}</p>
                      </div>
                    </div>
                  )
                })}
                {recentActivities.length === 0 && (
                  <div className="text-xs italic text-zinc-400 py-8 text-center">Henüz aktivite bulunmuyor</div>
                )}
              </div>
            </div>
          </div>

          {/* Audit Logs Table Card */}
          <div className="bg-white border border-zinc-200/80 rounded-3xl shadow-sm overflow-hidden mt-6">
            <div className="p-5 border-b border-zinc-150 flex justify-between items-center bg-zinc-50/50">
              <span className="text-xs font-black text-zinc-800 uppercase tracking-wider">İdari Sistem Günlükleri (Audit Log)</span>
            </div>
            <div className="overflow-x-auto w-full">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-zinc-50 border-b border-zinc-200 text-zinc-400 font-extrabold uppercase text-[9px] tracking-wider">
                    <th className="px-5 py-3.5 pl-6">Kullanıcı</th>
                    <th className="px-5 py-3.5">İşlem</th>
                    <th className="px-5 py-3.5">Detaylar</th>
                    <th className="px-5 py-3.5 pr-6 text-right">Zaman</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 text-zinc-650">
                  {logs.slice(0, 5).map((log) => (
                    <tr key={log.id} className="hover:bg-zinc-50/30 transition duration-150">
                      <td className="px-5 py-3.5 pl-6 font-semibold text-zinc-900">{log.userEmail}</td>
                      <td className="px-5 py-3.5">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-bold border ${
                          log.action.includes('Update') || log.action.includes('Add') || log.action.includes('Create')
                            ? 'bg-[#df0000]/5 text-[#df0000] border-[#df0000]/10'
                            : 'bg-zinc-50 text-zinc-600 border-zinc-200'
                        }`}>
                          {translateAction(log.action)}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-zinc-500 font-medium">{translateDetails(log.details)}</td>
                      <td className="px-5 py-3.5 pr-6 text-right text-zinc-400 font-medium whitespace-nowrap">
                        {new Date(log.createdAt).toLocaleString('tr-TR')}
                      </td>
                    </tr>
                  ))}
                  {logs.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-5 py-8 text-center text-zinc-400 italic">
                        Henüz kayıtlı günlük bulunmamaktadır.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  )
}
