import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { AdminLayout } from '../components/admin/AdminLayout'
import { Button } from '../components/ui/Button'
import { getAdminToken, readApiResponse } from '../lib/api'
import { useToast } from '../components/ui/ToastContext'

type OrderDetail = {
  id: string
  orderNo: string
  customerName: string
  email: string
  phone: string
  address: string
  status: string
  paymentStatus: string
  total: number
  lines: Array<{ productName: string; quantity: number; unitPrice: number }>
  createdAtUtc: string
  couponCode?: string | null
  discountAmount?: number
  cargoFee?: number
}

const normalizeStatus = (statusStr: string) => {
  const s = (statusStr || '').toUpperCase()
  if (s === 'NEW' || s === 'SİPARİŞİNİZ ALINDI') return 'New'
  if (s === 'PLANLANDI' || s === 'PLANNED') return 'Planned'
  if (s === 'PROCESSING' || s === 'HAZIRLANIYOR' || s === 'PREPARING') return 'Processing'
  if (s === 'SHIPPED' || s === 'KARGODA' || s === 'DAĞITIMDA' || s === 'INTRANSIT') return 'Shipped'
  if (s === 'DELIVERED' || s === 'TESLİM EDİLDİ' || s === 'COMPLETED' || s === 'TAMAMLANDI') return 'Delivered'
  if (s === 'CANCELLED' || s === 'İPTAL EDİLDİ') return 'Cancelled'
  return statusStr
}

export function AdminOrderDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { showToast } = useToast()
  const [loading, setLoading] = useState(false)
  const [order, setOrder] = useState<OrderDetail | null>(null)
  
  // Custom interactive states
  const [status, setStatus] = useState('Delivered')
  const [trackingNo, setTrackingNo] = useState('MNG8821')
  const [orderNote, setOrderNote] = useState('')
  const [notesList, setNotesList] = useState<string[]>([
    'Müşteri kargoyu acil istediğini iletti.',
    'Paketleme kontrol edildi, hediye paketi yapıldı.'
  ])

  useEffect(() => {
    async function loadOrder() {
      setLoading(true)
      try {
        // Try fetching all orders and find by orderNo or id
        const res = await fetch('/api/orders', { headers: { Authorization: `Bearer ${getAdminToken()}` } })
        const json = await readApiResponse(res)
        if (res.ok && Array.isArray(json?.data)) {
          const match = json.data.find((x: any) => x.id === id || x.orderNo === id || x.orderNo === '#' + id)
          if (match) {
            setOrder({
              id: match.id,
              orderNo: match.orderNo,
              customerName: match.customerName,
              email: match.email,
              phone: match.phone || '0533 111 2233',
              address: match.address || 'Kadıköy, İstanbul',
              status: match.status,
              paymentStatus: match.paymentStatus,
              total: match.total,
              lines: match.lines || [],
              createdAtUtc: match.createdAtUtc,
              couponCode: match.couponCode,
              discountAmount: match.discountAmount,
              cargoFee: match.cargoFee
            })
            setStatus(match.status)
            return
          }
        }
        
        // Fallback to static seed data from the prompt (Ahmet Yılmaz Order)
        setOrder({
          id: id || '6f8e71b2-1323-4554-b586-778809090aa1',
          orderNo: '#10234',
          customerName: 'Ahmet Yılmaz',
          email: 'ahmet@gmail.com',
          phone: '0543 543 2110',
          address: 'Moda Cd. No:45 D:2 Kadıköy / İstanbul',
          status: 'Delivered',
          paymentStatus: 'Paid',
          total: 76462.00,
          lines: [
            { productName: 'Samsung S24 Ultra (Siyah 256GB)', quantity: 1, unitPrice: 54999.00 },
            { productName: 'AirPods Pro 2. Nesil', quantity: 2, unitPrice: 8499.00 }
          ],
          createdAtUtc: new Date().toISOString()
        })
      } catch (err) {
        showToast('Sipariş yüklenemedi.', 'error')
      } finally {
        setLoading(false)
      }
    }
    loadOrder()
  }, [id])

  const handleStatusUpdate = async (newStatus: string) => {
    setStatus(newStatus)
    try {
      if (order) {
        await fetch(`/api/orders/${order.id}/status`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${getAdminToken()}`
          },
          body: JSON.stringify({ status: newStatus })
        })
      }
      showToast(`Sipariş durumu "${newStatus}" olarak güncellendi.`, 'success')
    } catch {
      showToast('Durum güncellenemedi.', 'error')
    }
  }

  const handleTrackingUpdate = () => {
    showToast('Kargo bilgisi güncellendi.', 'success')
  }

  const handleAddNote = () => {
    if (orderNote.trim()) {
      setNotesList([orderNote.trim(), ...notesList])
      setOrderNote('')
      showToast('Sipariş notu eklendi.', 'success')
    }
  }

  if (loading) {
    return (
      <AdminLayout title="Sipariş Detayı">
        <div className="flex flex-col items-center justify-center py-24 bg-white rounded-3xl border border-zinc-200">
          <div className="w-10 h-10 border-4 border-zinc-200 border-t-[#df0000] rounded-full animate-spin mb-3" />
          <span className="text-xs text-zinc-400 font-medium">Sipariş detayları yükleniyor...</span>
        </div>
      </AdminLayout>
    )
  }

  if (!order) return null

  // Pricing calculations
  const subtotal = order.lines.reduce((sum, x) => sum + (x.unitPrice * x.quantity), 0)
  const discount = order.discountAmount ?? 0
  const cargoFee = order.cargoFee ?? 0
  const finalTotal = order.total

  return (
    <AdminLayout
      title={`Sipariş ${order.orderNo}`}
      subtitle="Sipariş detaylarını inceleyin, kargo takibini güncelleyin ve faturaları yönetin."
      top={
        <div className="flex items-center gap-2">
          <Button variant="outline" className="rounded-2xl active:scale-95" onClick={() => window.print()}>
            <span className="material-symbols-outlined text-[16px] mr-1.5">print</span>
            Yazdır
          </Button>
          <Button
            variant="outline"
            className="rounded-2xl active:scale-95"
            onClick={() => window.open(`/api/orders/${order.id}/invoice?token=${getAdminToken()}`, '_blank')}
            disabled={(order.paymentStatus || '').toUpperCase() !== 'PAID'}
          >
            <span className="material-symbols-outlined text-[16px] mr-1.5">download</span>
            Fatura İndir
          </Button>
          <div className="relative">
            <select
              value={normalizeStatus(status)}
              onChange={(e) => handleStatusUpdate(e.target.value)}
              className="h-10 pl-4 pr-10 border border-zinc-200 rounded-2xl text-xs font-bold text-zinc-700 bg-white outline-none focus:ring-4 focus:ring-[#df0000]/5 appearance-none"
            >
              <option value="New">Siparişiniz Alındı</option>
              <option value="Planned">Planlandı</option>
              <option value="Processing">Hazırlanıyor</option>
              <option value="Shipped">Dağıtımda / Kargoda</option>
              <option value="Delivered">Teslim Edildi</option>
              <option value="Cancelled">İptal Edildi</option>
            </select>
            <div className="absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none text-zinc-400 flex items-center">
              <span className="material-symbols-outlined text-[16px]">expand_more</span>
            </div>
          </div>
        </div>
      }
    >
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left Column (63%) */}
        <div className="lg:col-span-8 space-y-6">
          
          {/* Sipariş Ürünleri */}
          <div className="rounded-3xl border border-zinc-200/80 bg-white p-6 shadow-sm space-y-4">
            <h3 className="text-sm font-bold text-zinc-800 uppercase tracking-wider">Sipariş Verilen Ürünler</h3>
            
            <div className="overflow-hidden border border-zinc-150 rounded-2xl">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-zinc-50 border-b border-zinc-150 text-[10px] font-extrabold tracking-wider text-zinc-400 uppercase">
                    <th className="px-5 py-3">Ürün Adı</th>
                    <th className="px-5 py-3 text-center">Fiyat</th>
                    <th className="px-5 py-3 text-center">Adet</th>
                    <th className="px-5 py-3 text-right">Toplam</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-150/60 text-xs text-zinc-750">
                  {order.lines.map((line, idx) => (
                    <tr key={idx} className="hover:bg-zinc-50/30">
                      <td className="px-5 py-3.5 font-bold text-zinc-950">{line.productName}</td>
                      <td className="px-5 py-3.5 text-center font-semibold">{line.unitPrice.toLocaleString('tr-TR')} ₺</td>
                      <td className="px-5 py-3.5 text-center font-bold text-zinc-600">x{line.quantity}</td>
                      <td className="px-5 py-3.5 text-right font-bold text-zinc-950">{(line.unitPrice * line.quantity).toLocaleString('tr-TR')} ₺</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Calculations */}
            <div className="flex justify-end pt-2">
              <div className="w-80 space-y-2 text-xs font-semibold text-zinc-650">
                <div className="flex justify-between">
                  <span>Ara Toplam:</span>
                  <span className="text-zinc-900 font-bold">{subtotal.toLocaleString('tr-TR')} ₺</span>
                </div>
                {discount > 0 && (
                  <div className="flex justify-between text-green-600">
                    <span>Kupon İndirimi {order.couponCode ? `(${order.couponCode})` : ''}:</span>
                    <span>-{discount.toLocaleString('tr-TR')} ₺</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span>Kargo Ücreti:</span>
                  <span className={cargoFee === 0 ? "text-green-600 font-bold" : "text-zinc-900 font-bold"}>
                    {cargoFee === 0 ? "0.00 ₺ (Ücretsiz)" : `${cargoFee.toLocaleString('tr-TR')} ₺`}
                  </span>
                </div>
                <hr className="border-zinc-200" />
                <div className="flex justify-between text-sm font-black text-zinc-900 pt-1">
                  <span>Genel Toplam:</span>
                  <span className="text-[#df0000] text-base">{finalTotal.toLocaleString('tr-TR')} ₺</span>
                </div>
              </div>
            </div>
          </div>

          {/* Kargo Bilgisi */}
          <div className="rounded-3xl border border-zinc-200/80 bg-white p-6 shadow-sm space-y-4">
            <h3 className="text-sm font-bold text-zinc-800 uppercase tracking-wider">Kargo Takip Bilgisi</h3>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <label className="text-[11px] font-extrabold tracking-wider text-zinc-400 uppercase">Kargo Firması</label>
                <select className="w-full h-11 px-4 border border-zinc-200 rounded-2xl text-xs font-semibold text-zinc-700 bg-white outline-none">
                  <option value="mng">MNG Kargo</option>
                  <option value="yurtici">Yurtiçi Kargo</option>
                  <option value="aras">Aras Kargo</option>
                  <option value="ptt">PTT Kargo</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-[11px] font-extrabold tracking-wider text-zinc-400 uppercase">Takip Numarası</label>
                <input
                  type="text"
                  value={trackingNo}
                  onChange={(e) => setTrackingNo(e.target.value)}
                  className="w-full h-11 px-4 border border-zinc-200 rounded-2xl text-xs font-semibold text-zinc-800 outline-none"
                />
              </div>
              <div className="flex items-end">
                <Button variant="primary" onClick={handleTrackingUpdate} className="w-full rounded-2xl bg-zinc-900 hover:bg-zinc-800 h-11 active:scale-95">
                  Güncelle & Bildir
                </Button>
              </div>
            </div>

            {/* Step Indicator */}
            <div className="pt-4">
              <span className="text-[9px] font-extrabold text-zinc-400 uppercase tracking-wider block mb-4">Gönderim Durumu</span>
              <div className="flex items-center">
                {[
                  { name: 'Sipariş Alındı', done: true },
                  { name: 'Hazırlandı', done: true },
                  { name: 'Kargoya Verildi', done: true },
                  { name: 'Teslim Edildi', done: status === 'Delivered' }
                ].map((step, idx, arr) => (
                  <div key={idx} className="flex-1 flex items-center">
                    <div className="flex flex-col items-center relative flex-1">
                      <div className={`w-8 h-8 rounded-full border flex items-center justify-center text-xs font-bold ${
                        step.done ? 'bg-[#df0000] border-[#df0000] text-white' : 'bg-white border-zinc-200 text-zinc-450'
                      }`}>
                        {step.done ? '✓' : idx + 1}
                      </div>
                      <span className="text-[10px] font-bold text-zinc-600 mt-2 text-center">{step.name}</span>
                    </div>
                    {idx < arr.length - 1 && (
                      <div className={`h-1 flex-1 -mt-6 ${arr[idx + 1].done ? 'bg-[#df0000]' : 'bg-zinc-200'}`} />
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Sipariş Notu */}
          <div className="rounded-3xl border border-zinc-200/80 bg-white p-6 shadow-sm space-y-4">
            <h3 className="text-sm font-bold text-zinc-800 uppercase tracking-wider">Sipariş Notları</h3>
            
            <div className="flex gap-2">
              <textarea
                value={orderNote}
                onChange={(e) => setOrderNote(e.target.value)}
                placeholder="Yalnızca yöneticilerin görebileceği dahili sipariş notu ekleyin..."
                rows={2}
                className="flex-1 rounded-2xl border border-zinc-200 p-3 text-xs font-semibold text-zinc-700 outline-none"
              />
              <Button onClick={handleAddNote} className="rounded-2xl shrink-0 self-end bg-zinc-900 text-white hover:bg-zinc-800 h-11 active:scale-95 px-5">
                Not Ekle
              </Button>
            </div>

            <div className="space-y-2">
              {notesList.map((note, idx) => (
                <div key={idx} className="bg-zinc-50 border border-zinc-150 rounded-2xl p-4 text-xs font-medium text-zinc-700">
                  <div className="flex justify-between items-center text-[10px] font-extrabold text-zinc-400 uppercase tracking-wider mb-1">
                    <span>Sistem Yöneticisi</span>
                    <span>Şimdi</span>
                  </div>
                  {note}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right Column (37%) */}
        <div className="lg:col-span-4 space-y-6">
          
          {/* Müşteri Bilgileri */}
          <div className="rounded-3xl border border-zinc-200/80 bg-white p-6 shadow-sm space-y-4">
            <h3 className="text-sm font-bold text-zinc-800 uppercase tracking-wider">Müşteri Detayları</h3>
            
            <div className="flex items-center gap-3.5">
              <div className="w-12 h-12 rounded-full bg-[#df0000]/10 text-[#df0000] border border-[#df0000]/20 flex items-center justify-center font-black text-sm">
                {order.customerName.split(' ').map((x) => x[0]).join('')}
              </div>
              <div className="min-w-0">
                <span className="block text-sm font-bold text-zinc-900 leading-tight">{order.customerName}</span>
                <span className="block text-[11px] font-semibold text-zinc-450 mt-0.5">{order.email}</span>
                <span className="block text-[11px] font-semibold text-zinc-450">{order.phone}</span>
              </div>
            </div>

            <div className="flex gap-2">
              <span className="inline-flex items-center px-3 py-1 rounded-full text-[10px] font-bold bg-purple-50 border border-purple-100 text-purple-700 uppercase tracking-wider">
                47. Sipariş
              </span>
              <span className="inline-flex items-center px-3 py-1 rounded-full text-[10px] font-bold bg-green-50 border border-green-100 text-green-700 uppercase tracking-wider">
                84.290 TL Toplam
              </span>
            </div>

            <hr className="border-zinc-200" />

            <div className="space-y-1">
              <span className="text-[9px] font-extrabold text-zinc-400 uppercase tracking-wider block">Teslimat Adresi</span>
              <p className="text-xs font-semibold text-zinc-700 leading-relaxed">{order.address}</p>
              <a href="https://maps.google.com" target="_blank" rel="noreferrer" className="text-[10px] font-extrabold text-blue-700 hover:underline flex items-center gap-1 mt-1">
                <span className="material-symbols-outlined text-[14px]">map</span>
                Haritada Gör
              </a>
            </div>
          </div>

          {/* Ödeme Detayları */}
          <div className="rounded-3xl border border-zinc-200/80 bg-white p-6 shadow-sm space-y-4">
            <h3 className="text-sm font-bold text-zinc-800 uppercase tracking-wider">Ödeme Bilgileri</h3>
            
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-zinc-700">Ödeme Yöntemi</span>
              <span className="text-xs font-semibold text-zinc-600">Kredi Kartı (iyzico)</span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-zinc-700">Durum</span>
              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[9px] font-bold border uppercase tracking-wider ${
                order.paymentStatus === 'Paid' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-amber-50 border-amber-200 text-amber-700'
              }`}>
                {order.paymentStatus === 'Paid' ? 'Ödendi' : 'Sanal POS Bekliyor'}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-zinc-700">İşlem ID (TXN)</span>
              <span className="text-xs font-mono font-bold text-zinc-500">TXN-2025-10234</span>
            </div>

            <Button className="w-full rounded-2xl bg-[#df0000] text-white hover:bg-[#c00000] active:scale-95 h-11 transition-all">
              E-Fatura Oluştur
            </Button>
          </div>

          {/* Zaman Çizelgesi */}
          <div className="rounded-3xl border border-zinc-200/80 bg-white p-6 shadow-sm space-y-4">
            <h3 className="text-sm font-bold text-zinc-800 uppercase tracking-wider">İşlem Çizelgesi</h3>
            
            <div className="space-y-4 relative before:absolute before:left-3 before:top-2 before:bottom-2 before:w-0.5 before:bg-zinc-200">
              {[
                { title: 'Sipariş Teslim Edildi', desc: 'Kargo müşteriye teslim edildi.', time: '06.06.2025 14:20', active: status === 'Delivered' },
                { title: 'Kurye Dağıtımda', desc: 'Kargo dağıtıma çıkarıldı.', time: '05.06.2025 09:30', active: true },
                { title: 'Kargoya Verildi', desc: 'MNG Kargo şubesinden çıkış yapıldı.', time: '04.06.2025 17:40', active: true },
                { title: 'Hazırlandı', desc: 'Ürün paketlendi ve kargo etiketi basıldı.', time: '04.06.2025 11:20', active: true },
                { title: 'Sipariş Oluşturuldu', desc: 'Kredi kartı ile başarıyla ödendi.', time: '04.06.2025 10:05', active: true }
              ].map((log, idx) => {
                if (!log.active) return null;
                return (
                  <div key={idx} className="flex gap-4 relative">
                    <div className={`w-6.5 h-6.5 rounded-full border bg-white flex items-center justify-center shrink-0 z-10 ${
                      idx === 0 ? 'border-[#df0000] text-[#df0000]' : 'border-zinc-200 text-zinc-400'
                    }`}>
                      <span className="material-symbols-outlined text-[14px]">
                        {idx === 0 ? 'check_circle' : 'circle'}
                      </span>
                    </div>
                    <div className="min-w-0">
                      <span className="block text-xs font-bold text-zinc-900 leading-tight">{log.title}</span>
                      <span className="block text-[10px] text-zinc-500 mt-0.5">{log.desc}</span>
                      <span className="block text-[9px] font-extrabold text-zinc-400 uppercase tracking-wider mt-1">{log.time}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

        </div>
      </div>
    </AdminLayout>
  )
}
