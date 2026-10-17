import { useEffect, useState } from 'react'
import { AdminLayout } from '../components/admin/AdminLayout'
import { Button } from '../components/ui/Button'
import { getAdminToken, readApiResponse } from '../lib/api'
import { useToast } from '../components/ui/ToastContext'

type ShippingRow = {
  id: string
  orderNo: string
  customerName: string
  carrier: string
  trackingNo: string
  shippedAt: string
  deliveryDate: string | null
  status: string
  historyJson: string | null
  deliveryAddress: string | null
  linesJson: string | null
  orderDate: string | null
  email: string | null
  phone: string | null
  total: number
  paymentStatus: string | null
  discountAmount: number
  couponCode: string | null
}

interface OrderDetailLine {
  productId: string
  tenantCode: string
  productName: string
  unitPrice: number
  quantity: number
  lineTotal: number
}

export function AdminShippingPage() {
  const { showToast } = useToast()
  const [rows, setRows] = useState<ShippingRow[]>([])
  const [loading, setLoading] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [activeTab, setActiveTab] = useState<'bekleyen' | 'teslim'>('bekleyen')

  // Modals state
  const [infoRow, setInfoRow] = useState<ShippingRow | null>(null)

  async function load() {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/modules/shipping', {
        headers: { Authorization: `Bearer ${getAdminToken()}` }
      })
      const json = await readApiResponse(res)
      if (res.ok && Array.isArray(json?.data)) {
        setRows(json.data)
      }
    } catch {
      showToast('Kargo listesi yüklenemedi.', 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const statusColorMap: Record<string, string> = {
    Received: 'border-blue-200 bg-blue-50/50 text-blue-700',
    Planned: 'border-indigo-200 bg-indigo-50/50 text-indigo-700',
    Preparing: 'border-amber-200 bg-amber-50/50 text-amber-700',
    InTransit: 'border-orange-200 bg-orange-50/50 text-orange-700',
    Delivered: 'border-green-200 bg-green-50/50 text-green-700',
    Delayed: 'border-rose-200 bg-rose-50/50 text-rose-700',
    Shipped: 'border-zinc-200 bg-zinc-50/50 text-zinc-650'
  }

  const statusTextMap: Record<string, string> = {
    Received: 'Siparişiniz Alındı',
    Planned: 'Planlandı',
    Preparing: 'Hazırlanıyor',
    InTransit: 'Dağıtımda',
    Delivered: 'Teslim Edildi',
    Delayed: 'Gecikmiş',
    Shipped: 'Kargoda'
  }

  // Calculate KPIs dynamically
  const activeCargoCount = rows.filter(r => r.status !== 'Delivered').length
  const todayDeliveredCount = rows.filter(r => r.status === 'Delivered').length

  // Tab Filtering
  const filteredRows = rows.filter(r => {
    // 1. Tab filter
    if (activeTab === 'bekleyen') {
      if (r.status === 'Delivered') return false
    } else {
      if (r.status !== 'Delivered') return false
    }

    // 2. Search query filter
    if (!searchQuery.trim()) return true
    const searchVal = searchQuery.toLowerCase()
    return (
      r.orderNo?.toLowerCase().includes(searchVal) ||
      r.customerName?.toLowerCase().includes(searchVal) ||
      r.carrier?.toLowerCase().includes(searchVal)
    )
  })

  const parseJson = (str: string | null | undefined): any[] => {
    if (!str) return []
    try {
      return JSON.parse(str)
    } catch {
      return []
    }
  }



  return (
    <AdminLayout
      title="Kargo Takip"
      subtitle="Siparişlerinizin kargo süreçlerini ve teslimat durumlarını takip edin."
    >
      {/* KPI Section */}
      <div className="grid gap-5 sm:grid-cols-2">
        {[
          { label: 'Kargo Bekleyen', value: String(activeCargoCount), icon: 'pending_actions', color: 'text-zinc-650 bg-zinc-50 border-zinc-150' },
          { label: 'Teslim Edilenler', value: String(todayDeliveredCount), icon: 'task_alt', color: 'text-green-600 bg-green-50 border-green-100' },
        ].map((item) => (
          <div key={item.label} className="rounded-3xl border border-zinc-200/85 bg-white p-5 shadow-[0_2px_8px_rgba(0,0,0,0.02)] transition-all duration-300 hover:shadow-md hover:border-zinc-350/80 hover:-translate-y-0.5">
            <div className="flex justify-between items-start">
              <span className="text-[11px] font-extrabold tracking-wider text-zinc-455 uppercase">{item.label}</span>
              <span className={`material-symbols-outlined text-[20px] p-2 rounded-2xl border ${item.color}`}>{item.icon}</span>
            </div>
            <div className="mt-2 text-2xl font-black tracking-tight text-zinc-900">{item.value}</div>
          </div>
        ))}
      </div>

      {/* Tabs Layout */}
      <div className="flex gap-4 mt-6">
        <button
          onClick={() => setActiveTab('bekleyen')}
          className={`flex-1 px-4 py-3 rounded-2xl text-center font-bold text-xs border transition-all duration-200 uppercase tracking-wider ${
            activeTab === 'bekleyen'
              ? 'bg-[#df0000] text-white border-[#df0000] shadow-md shadow-red-900/10'
              : 'bg-white text-zinc-650 border-zinc-200 hover:bg-zinc-50'
          }`}
        >
          Kargo Bekleyen
        </button>
        <button
          onClick={() => setActiveTab('teslim')}
          className={`flex-1 px-4 py-3 rounded-2xl text-center font-bold text-xs border transition-all duration-200 uppercase tracking-wider ${
            activeTab === 'teslim'
              ? 'bg-[#df0000] text-white border-[#df0000] shadow-md shadow-red-900/10'
              : 'bg-white text-zinc-650 border-zinc-200 hover:bg-zinc-50'
          }`}
        >
          Teslim Edilenler
        </button>
      </div>

      {/* Search and Refresh bar */}
      <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 max-w-md">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 text-[18px]">search</span>
          <input
            type="text"
            placeholder="Sipariş No, Müşteri veya Kargo Ara..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full h-10 rounded-2xl border border-zinc-200 pl-10 pr-4 text-xs font-semibold text-zinc-700 bg-white outline-none focus:border-zinc-400 transition-colors"
          />
        </div>
        <button 
          onClick={load} 
          className="inline-flex items-center justify-center gap-1.5 h-10 rounded-2xl bg-white px-4 border border-zinc-200 text-xs font-bold text-zinc-700 hover:bg-zinc-50 active:scale-95 transition-all"
        >
          <span className="material-symbols-outlined text-[16px]">refresh</span>
          Yenile
        </button>
      </div>

      {/* Grid Table */}
      <div className="mt-6 overflow-hidden rounded-3xl border border-zinc-200/80 bg-white shadow-[0_2px_8px_rgba(0,0,0,0.02),0_8px_24px_rgba(0,0,0,0.02)]">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-zinc-50/80 border-b border-zinc-200/80 text-[10px] font-extrabold tracking-wider text-zinc-455 uppercase">
                <th className="px-6 py-4">Sipariş No</th>
                <th className="px-6 py-4 text-center">Tarih</th>
                <th className="px-6 py-4">Müşteri</th>
                <th className="px-6 py-4">Adres</th>
                <th className="px-6 py-4 text-center">Durum</th>
                <th className="px-6 py-4 text-center">İşlemler</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-150/60 text-xs text-zinc-650">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-zinc-400 font-medium">Yükleniyor...</td>
                </tr>
              ) : filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-zinc-400 font-medium">Bu bölüme ait kargo kaydı bulunamadı.</td>
                </tr>
              ) : (
                filteredRows.map((row) => (
                  <tr key={row.id} className="hover:bg-zinc-50/50 transition-colors duration-150">
                    <td className="px-6 py-4.5 font-mono font-bold text-zinc-700">{row.orderNo}</td>
                    <td className="px-6 py-4.5 text-center text-zinc-500 font-bold">
                      {row.orderDate ? new Date(row.orderDate).toLocaleDateString('tr-TR') : row.shippedAt ? new Date(row.shippedAt).toLocaleDateString('tr-TR') : '—'}
                    </td>
                    <td className="px-6 py-4.5 text-xs text-zinc-900 font-bold">
                      {row.customerName}
                    </td>
                    <td className="px-6 py-4.5 text-xs text-zinc-500">
                      <div className="max-w-[220px] truncate" title={row.deliveryAddress || ''}>
                        {row.deliveryAddress || 'Adres Girilmemiş'}
                      </div>
                    </td>
                    <td className="px-6 py-4.5 text-center">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[9px] font-bold border uppercase tracking-wider ${
                        statusColorMap[row.status] || 'border-zinc-200 bg-zinc-50 text-zinc-650'
                      }`}>
                        {statusTextMap[row.status] || row.status}
                      </span>
                    </td>
                    <td className="px-6 py-4.5 text-center">
                      <div className="flex items-center justify-center gap-2">
                        <button
                          type="button"
                          onClick={() => setInfoRow(row)}
                          className="w-8 h-8 rounded-full border border-blue-200 bg-blue-50/50 hover:bg-blue-100/60 text-blue-700 flex items-center justify-center transition-all active:scale-90"
                          title="Detay & Geçmiş Gör"
                        >
                          <span className="material-symbols-outlined text-[18px]">info</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Details & Timeline Modal */}
      {infoRow && (
        <div className="fixed inset-0 z-[80] overflow-y-auto">
          <div className="absolute inset-0 bg-black/45 backdrop-blur-[2px]" onClick={() => setInfoRow(null)} />
          <div className="flex min-h-screen items-center justify-center p-4">
            <div className="relative w-full max-w-3xl bg-white rounded-3xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200 flex flex-col max-h-[90vh]">
              {/* Header */}
              <div className="flex items-center justify-between border-b border-zinc-150 px-6 py-6 bg-zinc-50/50">
                <div>
                  <span className="text-sm font-bold text-zinc-800 uppercase tracking-tight block">Kargo Detay & Geçmiş Çizelgesi</span>
                  <span className="text-[10px] text-zinc-400 font-bold mt-0.5">Sipariş No: {infoRow.orderNo}</span>
                </div>
                <button type="button" onClick={() => setInfoRow(null)} className="w-8 h-8 rounded-full hover:bg-zinc-150 text-zinc-500 flex items-center justify-center">
                  <span className="material-symbols-outlined text-[20px]">close</span>
                </button>
              </div>

              {/* Scrollable Content */}
              <div className="p-6 overflow-y-auto space-y-6 flex-1">
                {/* Cargo Details Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-zinc-50 border border-zinc-150/70 p-5 rounded-2xl text-xs text-zinc-650">
                  <div>
                    <div className="text-[10px] text-zinc-400 uppercase font-extrabold tracking-wider">Müşteri</div>
                    <div className="font-bold text-zinc-900 mt-0.5">{infoRow.customerName || '-'}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-zinc-400 uppercase font-extrabold tracking-wider">Tarih</div>
                    <div className="font-semibold text-zinc-900 mt-0.5">
                      {infoRow.orderDate ? new Date(infoRow.orderDate).toLocaleDateString('tr-TR') : infoRow.shippedAt ? new Date(infoRow.shippedAt).toLocaleDateString('tr-TR') : '—'}
                    </div>
                  </div>
                  <div className="md:col-span-2">
                    <div className="text-[10px] text-zinc-400 uppercase font-extrabold tracking-wider">Teslimat Adresi</div>
                    <div className="font-semibold text-zinc-900 mt-0.5 leading-relaxed">{infoRow.deliveryAddress || '-'}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-zinc-400 uppercase font-extrabold tracking-wider">Kargo Firması</div>
                    <div className="font-bold text-[#df0000] mt-0.5">{infoRow.carrier || 'Kargo Belirtilmemiş'}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-zinc-400 uppercase font-extrabold tracking-wider">Takip Numarası</div>
                    <div className="font-mono font-bold text-zinc-900 mt-0.5">{infoRow.trackingNo || 'Takip No Yok'}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-zinc-400 uppercase font-extrabold tracking-wider">Kargo Durumu</div>
                    <div className="mt-0.5">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[9px] font-bold border uppercase tracking-wider ${
                        statusColorMap[infoRow.status] || 'border-zinc-200 bg-zinc-50 text-zinc-650'
                      }`}>
                        {statusTextMap[infoRow.status] || infoRow.status}
                      </span>
                    </div>
                  </div>
                </div>

                {/* E-Commerce Order Items */}
                {infoRow.linesJson ? (
                  <div className="border border-zinc-150 rounded-2xl p-5">
                    <h4 className="text-[11px] font-extrabold text-zinc-800 uppercase tracking-wider mb-3">E-Ticaret Sipariş Detayları</h4>
                    <div className="divide-y divide-zinc-150 text-xs text-zinc-650">
                      {parseJson(infoRow.linesJson).map((line: OrderDetailLine, idx: number) => (
                        <div key={idx} className="py-2.5 flex justify-between items-center">
                          <div>
                            <div className="font-bold text-zinc-950">{line.productName}</div>
                            <div className="text-[10px] text-zinc-400 mt-0.5">{line.quantity} Adet x ₺{line.unitPrice.toLocaleString('tr-TR')}</div>
                          </div>
                          <div className="font-black text-zinc-900">₺{(line.unitPrice * line.quantity).toLocaleString('tr-TR')}</div>
                        </div>
                      ))}
                    </div>
                    <div className="border-t border-zinc-150 pt-3 mt-2 flex flex-col gap-1 text-xs">
                      {infoRow.discountAmount > 0 && (
                        <div className="flex justify-between text-green-600 font-bold">
                          <span>İndirim {infoRow.couponCode ? `(${infoRow.couponCode})` : ''}</span>
                          <span>- ₺{infoRow.discountAmount.toLocaleString('tr-TR')}</span>
                        </div>
                      )}
                      <div className="flex justify-between font-black text-zinc-950 text-sm">
                        <span>Genel Toplam</span>
                        <span>₺{infoRow.total ? infoRow.total.toLocaleString('tr-TR') : '0'}</span>
                      </div>
                      <div className="mt-2 text-[10px] text-zinc-450 flex justify-between">
                        <span>Ödeme Durumu: <span className="font-bold text-green-600">{infoRow.paymentStatus === 'Paid' ? 'Ödendi' : infoRow.paymentStatus || 'Bekleniyor'}</span></span>
                        <span>Sipariş Durumu: <span className="font-bold text-[#df0000]">{infoRow.status}</span></span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-xs text-amber-600 bg-amber-50 border border-amber-100 p-3.5 rounded-2xl flex items-center gap-1.5 font-semibold">
                    <span className="material-symbols-outlined text-[18px]">warning</span>
                    E-ticaret sipariş detayları bulunamadı.
                  </div>
                )}


              </div>

              {/* Footer */}
              <div className="flex justify-end border-t border-zinc-150 px-6 py-6 bg-zinc-50/50">
                <Button variant="outline" onClick={() => setInfoRow(null)} className="rounded-2xl">Kapat</Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  )
}
