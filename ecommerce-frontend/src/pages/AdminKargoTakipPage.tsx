import { useEffect, useState } from 'react'
import { Search, RefreshCw } from 'lucide-react'

export function AdminKargoTakipPage() {
  const [tasks, setTasks] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [q, setQ] = useState('')

  const fetchTasks = async () => {
    setLoading(true)
    try {
      const token = localStorage.getItem('admin_token') || ''
      const res = await fetch('/api/orders/cargo-tracking', {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      const data = await res.json()
      if (data.success) {
        setTasks(data.data || [])
      }
    } catch (err) {
      console.error('Error fetching cargo tracking', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchTasks()
  }, [])

  const filteredTasks = tasks.filter(t => 
    (t.orderNumber || '').toLowerCase().includes(q.toLowerCase()) || 
    (t.customerName || '').toLowerCase().includes(q.toLowerCase())
  )

  const getStatusBadge = (status: number) => {
    switch (status) {
      case 0: return <span className="inline-flex items-center rounded-md bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 ring-1 ring-inset ring-blue-700/10">Siparişiniz Alındı</span>
      case 1: return <span className="inline-flex items-center rounded-md bg-indigo-50 px-2 py-1 text-xs font-medium text-indigo-700 ring-1 ring-inset ring-indigo-700/10">Planlandı</span>
      case 2: return <span className="inline-flex items-center rounded-md bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700 ring-1 ring-inset ring-amber-600/20">Hazırlanıyor</span>
      case 3: return <span className="inline-flex items-center rounded-md bg-orange-50 px-2 py-1 text-xs font-medium text-orange-700 ring-1 ring-inset ring-orange-600/20">Dağıtımda</span>
      case 4: return <span className="inline-flex items-center rounded-md bg-green-50 px-2 py-1 text-xs font-medium text-green-700 ring-1 ring-inset ring-green-600/20">Teslim Edildi</span>
      default: return <span className="inline-flex items-center rounded-md bg-gray-50 px-2 py-1 text-xs font-medium text-gray-600 ring-1 ring-inset ring-gray-500/10">Bilinmiyor</span>
    }
  }

  return (
    <div className="p-6">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Kargo Takibi</h1>
          <p className="mt-1 text-sm text-gray-500">
            Müşterilerin kargo süreçlerini izleyin ve durumlarını görüntüleyin.
          </p>
        </div>
        <button
          onClick={fetchTasks}
          className="inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50"
        >
          <RefreshCw className="h-4 w-4" />
          Yenile
        </button>
      </div>

      <div className="mb-6 max-w-md relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <input
          type="text"
          placeholder="Sipariş No veya Müşteri Ara..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="w-full rounded-lg border-0 py-2 pl-10 pr-4 text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 focus:ring-2 focus:ring-inset focus:ring-brand-600 sm:text-sm"
        />
      </div>

      <div className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-gray-200">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Sipariş No</th>
              <th className="px-6 py-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Tarih</th>
              <th className="px-6 py-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Müşteri & Adres</th>
              <th className="px-6 py-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Durum</th>
              <th className="px-6 py-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Teknisyen/Kurye</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {loading ? (
              <tr><td colSpan={5} className="py-8 text-center text-gray-500">Yükleniyor...</td></tr>
            ) : filteredTasks.length === 0 ? (
              <tr><td colSpan={5} className="py-8 text-center text-gray-500">Kayıt bulunamadı.</td></tr>
            ) : (
              filteredTasks.map((t, idx) => (
                <tr key={idx} className="hover:bg-gray-50">
                  <td className="whitespace-nowrap px-6 py-4 text-sm font-medium text-gray-900">
                    {t.orderNumber}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                    {new Date(t.orderDate).toLocaleDateString('tr-TR')}
                  </td>
                  <td className="px-6 py-4 text-sm">
                    <div className="font-medium text-gray-900">{t.customerName}</div>
                    <div className="text-gray-500 text-xs truncate max-w-xs">{t.deliveryAddress}</div>
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm">
                    {getStatusBadge(t.status)}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                    {t.assignedTechnicianName || '-'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
