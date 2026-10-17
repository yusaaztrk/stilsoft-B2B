import { useEffect, useMemo, useState } from 'react'
import { AdminLayout } from '../components/admin/AdminLayout'
import { getAdminToken, readApiResponse } from '../lib/api'
import { Input } from '../components/ui/Input'
import { useToast } from '../components/ui/ToastContext'

type WarrantyItem = {
  id: string
  userId: string | null
  customerName: string
  customerEmail: string
  productId: string
  productName: string
  warrantyCode: string
  warrantyMonths: number
  soldDate: string
  status: string
  remainingText: string
}

export function AdminWarrantiesPage() {
  const { showToast } = useToast()
  const [warranties, setWarranties] = useState<WarrantyItem[]>([])
  const [loading, setLoading] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')

  const authHeader = useMemo(() => {
    const token = getAdminToken()
    return token ? { Authorization: `Bearer ${token}` } : null
  }, [])

  const fetchWarranties = async () => {
    if (!authHeader) return
    setLoading(true)
    try {
      const res = await fetch('/api/admin/modules/warranties', { headers: authHeader })
      const json = await readApiResponse(res)
      if (res.ok && json?.success) {
        setWarranties(json.data || [])
      } else {
        showToast(json?.message || 'Garanti kodları alınamadı.', 'error')
      }
    } catch (err) {
      showToast('Bağlantı hatası.', 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchWarranties()
  }, [authHeader])

  const filteredWarranties = useMemo(() => {
    return warranties.filter((w) => {
      const matchesSearch =
        w.customerName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        w.customerEmail.toLowerCase().includes(searchTerm.toLowerCase()) ||
        w.productName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        w.warrantyCode.toLowerCase().includes(searchTerm.toLowerCase())

      const matchesStatus =
        statusFilter === 'all' ||
        (statusFilter === 'active' && w.remainingText !== 'Süresi Doldu') ||
        (statusFilter === 'expired' && w.remainingText === 'Süresi Doldu')

      return matchesSearch && matchesStatus
    })
  }, [warranties, searchTerm, statusFilter])

  return (
    <AdminLayout
      title="Garanti Kodları"
      subtitle="Satışı gerçekleşen ürünlere atanan benzersiz garanti kodlarını ve kalan garanti sürelerini listeleyin."
    >
      <div className="space-y-6">
        {/* Stats card */}
        <div className="grid gap-5 sm:grid-cols-3">
          <div className="bg-white p-5 border border-zinc-200/80 rounded-3xl shadow-[0_2px_8px_rgba(0,0,0,0.02)]">
            <span className="text-[11px] font-extrabold tracking-wider text-zinc-400 uppercase">Toplam Garanti</span>
            <p className="text-2xl font-black text-zinc-900 mt-2">{warranties.length}</p>
          </div>
          <div className="bg-white p-5 border border-zinc-200/80 rounded-3xl shadow-[0_2px_8px_rgba(0,0,0,0.02)]">
            <span className="text-[11px] font-extrabold tracking-wider text-zinc-400 uppercase">Aktif Garantiler</span>
            <p className="text-2xl font-black text-green-600 mt-2">
              {warranties.filter((w) => w.remainingText !== 'Süresi Doldu').length}
            </p>
          </div>
          <div className="bg-white p-5 border border-zinc-200/80 rounded-3xl shadow-[0_2px_8px_rgba(0,0,0,0.02)]">
            <span className="text-[11px] font-extrabold tracking-wider text-zinc-400 uppercase">Süresi Dolanlar</span>
            <p className="text-2xl font-black text-rose-500 mt-2">
              {warranties.filter((w) => w.remainingText === 'Süresi Doldu').length}
            </p>
          </div>
        </div>

        {/* Filter bar */}
        <div className="flex flex-col md:flex-row justify-between gap-4 bg-white p-4 border border-zinc-200/80 rounded-3xl shadow-[0_2px_8px_rgba(0,0,0,0.02)]">
          <Input
            placeholder="Müşteri adı, e-posta, ürün adı veya garanti kodu ara..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            icon="search"
            className="max-w-md w-full rounded-2xl focus:ring-[#df0000]/5 focus:border-[#df0000]"
          />
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-zinc-550">Kalan Süre Durumu:</span>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="h-10 px-4 border border-zinc-200 rounded-2xl text-xs font-semibold text-zinc-700 bg-white outline-none focus:ring-4 focus:ring-[#df0000]/5 focus:border-[#df0000] transition-all"
            >
              <option value="all">Tümü</option>
              <option value="active">Aktif (Süresi Devam Edenler)</option>
              <option value="expired">Süresi Dolanlar</option>
            </select>
          </div>
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center py-24 bg-white rounded-3xl border border-zinc-200/80 shadow-[0_2px_8px_rgba(0,0,0,0.02)]">
            <div className="w-10 h-10 border-4 border-zinc-200 border-t-[#df0000] rounded-full animate-spin mb-3" />
            <span className="text-sm text-zinc-400 font-medium">Garanti kodları yükleniyor...</span>
          </div>
        ) : filteredWarranties.length === 0 ? (
          <div className="bg-white rounded-3xl border border-zinc-200/80 p-16 text-center shadow-[0_2px_8px_rgba(0,0,0,0.02)]">
            <div className="w-16 h-16 bg-zinc-50 rounded-full flex items-center justify-center mx-auto mb-4 border border-zinc-100">
              <span className="material-symbols-outlined text-[32px] text-zinc-450">verified</span>
            </div>
            <h4 className="text-base font-bold text-zinc-850">Kayıt Bulunmuyor</h4>
            <p className="text-xs text-zinc-500 mt-2 max-w-sm mx-auto">
              Aradığınız kriterde veya satışı yapılmış ürünlere ait herhangi bir garanti kodu bulunmamaktadır.
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-3xl border border-zinc-200/80 bg-white shadow-[0_2px_8px_rgba(0,0,0,0.02)]">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-zinc-50/80 border-b border-zinc-200/80 text-[10px] font-extrabold tracking-wider text-zinc-450 uppercase">
                    <th className="px-6 py-4">Müşteri</th>
                    <th className="px-6 py-4">Ürün Adı</th>
                    <th className="px-6 py-4">Garanti Kodu</th>
                    <th className="px-6 py-4">Garanti Süresi</th>
                    <th className="px-6 py-4">Satış Tarihi</th>
                    <th className="px-6 py-4 text-right">Kalan Süre</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-150/60 text-xs text-zinc-650">
                  {filteredWarranties.map((item) => {
                    const isExpired = item.remainingText === 'Süresi Doldu'
                    return (
                      <tr key={item.id} className="hover:bg-zinc-50/50 transition-colors duration-150">
                        <td className="px-6 py-4.5 text-zinc-950">
                          <div className="flex flex-col">
                            <span className="font-bold text-[13px]">{item.customerName}</span>
                            <span className="text-[11px] text-zinc-450 mt-0.5">{item.customerEmail}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4.5 text-zinc-700 font-bold max-w-xs truncate">
                          {item.productName}
                        </td>
                        <td className="px-6 py-4.5 font-mono font-bold text-[#df0000] text-[13px]">
                          {item.warrantyCode}
                        </td>
                        <td className="px-6 py-4.5 text-zinc-600 font-medium">
                          {item.warrantyMonths} Ay
                        </td>
                        <td className="px-6 py-4.5 text-zinc-500 font-medium">
                          {new Date(item.soldDate).toLocaleDateString('tr-TR')}
                        </td>
                        <td className="px-6 py-4.5 text-right font-bold">
                          <span
                            className={`inline-flex px-2.5 py-0.5 rounded-full text-[10px] uppercase tracking-wide ${
                              isExpired
                                ? 'bg-rose-50 text-rose-650'
                                : 'bg-green-50 text-green-700'
                            }`}
                          >
                            {item.remainingText}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </AdminLayout>
  )
}
