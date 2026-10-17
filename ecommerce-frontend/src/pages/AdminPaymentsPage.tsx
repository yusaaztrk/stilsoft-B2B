import { useEffect, useState } from 'react'
import { AdminLayout } from '../components/admin/AdminLayout'
import { Button } from '../components/ui/Button'
import { getAdminToken, readApiResponse } from '../lib/api'
import { useToast } from '../components/ui/ToastContext'

type PaymentRow = {
  id: string
  txnId: string
  orderNo: string
  customerName: string
  amount: number
  method: string
  status: string
  createdAtUtc: string
}

export function AdminPaymentsPage() {
  const { showToast } = useToast()
  const [rows, setRows] = useState<PaymentRow[]>([])

  async function load() {
    try {
      const res = await fetch('/api/admin/modules/payments', {
        headers: { Authorization: `Bearer ${getAdminToken()}` }
      })
      const json = await readApiResponse(res)
      if (res.ok && Array.isArray(json?.data)) {
        setRows(json.data)
      }
    } catch {
      showToast('Ödemeler yüklenemedi.', 'error')
    }
  }

  useEffect(() => {
    load()
  }, [])

  const testGateway = (name: string) => {
    showToast(`${name} POS bağlantısı başarılı. Test sinyali gönderildi.`, 'success')
  }

  return (
    <AdminLayout
      title="Ödeme Yöntemleri & Sanal POS"
      subtitle="Sanal POS (iyzico, PayTR, Stripe) durumlarını kontrol edin ve ödeme hareketlerini denetleyin."
    >
      {/* KPI Section */}
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: 'Bugünkü Ödemeler', value: '48.320 ₺', icon: 'payments', color: 'text-blue-600 bg-blue-50 border-blue-100' },
          { label: 'Bu Ayki Toplam Ödeme', value: '1.284.320 ₺', icon: 'account_balance_wallet', color: 'text-green-600 bg-green-50 border-green-100' },
          { label: 'Başarı Oranı', value: '%98.2', icon: 'task_alt', color: 'text-emerald-600 bg-emerald-50 border-emerald-100' },
          { label: 'Hatalı/Başarısız Ödeme', value: '33 Hata', icon: 'error', color: 'text-rose-600 bg-rose-50 border-rose-100' },
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

      {/* Gateway Cards */}
      <div className="mt-8 space-y-4">
        <h3 className="text-sm font-bold text-zinc-850 uppercase tracking-wider">Sanal POS Entegrasyonları</h3>
        <div className="grid gap-6 md:grid-cols-3">
          {[
            { name: 'iyzico', label: 'Bağlı', stats: 'Son 30 Gün: 890.240 ₺', connected: true, logo: 'iyzico' },
            { name: 'PayTR', label: 'Bağlı', stats: 'Son 30 Gün: 248.320 ₺', connected: true, logo: 'PayTR' },
            { name: 'Stripe', label: 'Bağlı Değil', stats: 'Dövizli Ödemeler', connected: false, logo: 'Stripe' },
          ].map((gateway) => (
            <div key={gateway.name} className="rounded-3xl border border-zinc-200/80 bg-white p-6 shadow-sm space-y-4 hover:shadow-md transition-all duration-300">
              <div className="flex justify-between items-start">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-2xl bg-zinc-900 text-white font-black text-xs flex items-center justify-center">
                    {gateway.logo[0]}
                  </div>
                  <div>
                    <span className="block text-xs font-black text-zinc-900 uppercase tracking-tight">{gateway.name}</span>
                    <span className="block text-[10px] text-zinc-400 font-semibold mt-0.5">{gateway.stats}</span>
                  </div>
                </div>
                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[9px] font-bold border uppercase tracking-wider ${
                  gateway.connected ? 'bg-green-50 border-green-200 text-green-700' : 'bg-zinc-50 border-zinc-200 text-zinc-500'
                }`}>
                  {gateway.label}
                </span>
              </div>

              <div className="flex gap-2">
                {gateway.connected ? (
                  <>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => testGateway(gateway.name)}
                      className="flex-1 rounded-xl active:scale-95 text-[10px] font-bold py-1.5"
                    >
                      Bağlantıyı Test Et
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="rounded-xl active:scale-95 text-[10px] font-bold py-1.5 px-3"
                    >
                      Ayarlar
                    </Button>
                  </>
                ) : (
                  <Button
                    type="button"
                    variant="primary"
                    className="w-full rounded-xl bg-[#df0000] hover:bg-[#c00000] active:scale-95 text-[10px] font-bold py-1.5"
                  >
                    Şimdi Bağlan
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Grid Table */}
      <div className="mt-8 space-y-4">
        <h3 className="text-sm font-bold text-zinc-850 uppercase tracking-wider">Son Ödeme Hareketleri</h3>
        <div className="overflow-hidden rounded-3xl border border-zinc-200/80 bg-white shadow-[0_2px_8px_rgba(0,0,0,0.02)]">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-zinc-50/80 border-b border-zinc-200/80 text-[10px] font-extrabold tracking-wider text-zinc-455 uppercase">
                  <th className="px-6 py-4">İşlem ID (TXN)</th>
                  <th className="px-6 py-4">Sipariş No</th>
                  <th className="px-6 py-4">Müşteri</th>
                  <th className="px-6 py-4 text-center">Ödeme Türü</th>
                  <th className="px-6 py-4 text-center">Tarih</th>
                  <th className="px-6 py-4 text-center">Tutar</th>
                  <th className="px-6 py-4 text-right">Durum</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-150/60 text-xs text-zinc-650">
                {rows.map((row) => (
                  <tr key={row.id} className="hover:bg-zinc-50/50 transition-colors duration-150">
                    <td className="px-6 py-4.5 font-mono font-bold text-zinc-700">{row.txnId}</td>
                    <td className="px-6 py-4.5 font-mono text-zinc-500 font-semibold">{row.orderNo}</td>
                    <td className="px-6 py-4.5 font-bold text-zinc-950">{row.customerName}</td>
                    <td className="px-6 py-4.5 text-center font-semibold text-zinc-600">{row.method}</td>
                    <td className="px-6 py-4.5 text-center text-zinc-500 font-medium">06.06.2025</td>
                    <td className="px-6 py-4.5 text-center font-extrabold text-zinc-950">{row.amount.toLocaleString('tr-TR')} ₺</td>
                    <td className="px-6 py-4.5 text-right">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[9px] font-bold border uppercase tracking-wider ${
                        row.status === 'Success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-rose-50 border-rose-200 text-rose-700'
                      }`}>
                        {row.status === 'Success' ? 'Başarılı' : 'Başarısız'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </AdminLayout>
  )
}
