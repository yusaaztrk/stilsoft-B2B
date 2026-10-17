import { useEffect, useMemo, useState } from 'react'
import { AdminLayout } from '../components/admin/AdminLayout'
import { getAdminToken } from '../lib/api'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { useToast } from '../components/ui/ToastContext'
import { useConfirm } from '../components/ui/ConfirmContext'

type SubscriberItem = {
  id: string
  email: string
  subscribedAt: string
  isActive: boolean
}

export function AdminNewsletterPage() {
  const { showToast } = useToast()
  const confirm = useConfirm()
  const [subscribers, setSubscribers] = useState<SubscriberItem[]>([])
  const [loading, setLoading] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')

  const authHeader = useMemo(() => {
    const token = getAdminToken()
    return token ? { Authorization: `Bearer ${token}` } : null
  }, [])

  const fetchSubscribers = async () => {
    if (!authHeader) return
    setLoading(true)
    try {
      const res = await fetch('/api/admin/newsletter', { headers: authHeader })
      const json = await res.json()
      if (res.ok && json?.success) {
        setSubscribers(json.data || [])
      } else {
        showToast(json?.message || 'Abone listesi alınamadı.', 'error')
      }
    } catch (err) {
      showToast('Bağlantı hatası.', 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchSubscribers()
  }, [authHeader])

  const handleDelete = async (id: string) => {
    if (!authHeader) return
    const ok = await confirm('Bu aboneyi listeden kalıcı olarak silmek istediğinizden emin misiniz?', { type: 'danger', confirmText: 'Evet, Sil', title: 'Aboneyi Sil' })
    if (!ok) return

    try {
      const res = await fetch(`/api/admin/newsletter/${id}`, {
        method: 'DELETE',
        headers: authHeader,
      })
      const json = await res.json()
      if (res.ok && json?.success) {
        showToast('Abone kaydı başarıyla silindi.', 'success')
        fetchSubscribers()
      } else {
        showToast(json?.message || 'Silme işlemi başarısız.', 'error')
      }
    } catch (err) {
      showToast('Bağlantı hatası.', 'error')
    }
  }

  // Filter subscribers based on search term
  const filteredSubscribers = useMemo(() => {
    return subscribers.filter((sub) =>
      sub.email.toLowerCase().includes(searchTerm.toLowerCase())
    )
  }, [subscribers, searchTerm])

  const handleExportCSV = () => {
    if (filteredSubscribers.length === 0) {
      showToast('Dışa aktarılacak kayıt bulunmuyor.', 'warning')
      return
    }
    const headers = ['E-posta Adresi', 'Kayıt Tarihi', 'Durum']
    const rows = filteredSubscribers.map((s) => [
      s.email,
      new Date(s.subscribedAt).toLocaleString('tr-TR'),
      s.isActive ? 'Aktif' : 'Pasif',
    ])

    const csvContent =
      'data:text/csv;charset=utf-8,\uFEFF' +
      [headers.join(';'), ...rows.map((e) => e.join(';'))].join('\n')

    const encodedUri = encodeURI(csvContent)
    const link = document.createElement('a')
    link.setAttribute('href', encodedUri)
    link.setAttribute('download', 'stilsoft_bulten_aboneleri.csv')
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    showToast('E-posta listesi başarıyla CSV olarak indirildi.', 'success')
  }

  return (
    <AdminLayout
      title="Bülten Aboneleri"
      subtitle="E-ticaret sitenizin e-posta bültenine kaydolan müşterileri listeleyin ve yönetin."
    >
      <div className="space-y-6">
        {/* Stats card */}
        <div className="grid gap-5 sm:grid-cols-3">
          <div className="bg-white p-5 border border-zinc-200/80 rounded-3xl shadow-[0_2px_8px_rgba(0,0,0,0.02),0_8px_20px_rgba(0,0,0,0.015)] transition-all duration-300 hover:shadow-md hover:border-zinc-350/80">
            <div className="flex justify-between items-start">
              <span className="text-[11px] font-extrabold tracking-wider text-zinc-400 uppercase">Toplam Kayıt</span>
              <span className="material-symbols-outlined text-[20px] p-2 rounded-2xl border border-zinc-150 text-zinc-500 bg-zinc-50">list_alt</span>
            </div>
            <p className="text-2xl font-black text-zinc-900 mt-2">{subscribers.length}</p>
          </div>
          <div className="bg-white p-5 border border-zinc-200/80 rounded-3xl shadow-[0_2px_8px_rgba(0,0,0,0.02),0_8px_20px_rgba(0,0,0,0.015)] transition-all duration-300 hover:shadow-md hover:border-zinc-350/80">
            <div className="flex justify-between items-start">
              <span className="text-[11px] font-extrabold tracking-wider text-zinc-400 uppercase">Aktif Aboneler</span>
              <span className="material-symbols-outlined text-[20px] p-2 rounded-2xl border border-green-100 text-green-600 bg-green-50/50">how_to_reg</span>
            </div>
            <p className="text-2xl font-black text-green-600 mt-2">
              {subscribers.filter((s) => s.isActive).length}
            </p>
          </div>
          <div className="bg-white p-5 border border-zinc-200/80 rounded-3xl shadow-[0_2px_8px_rgba(0,0,0,0.02),0_8px_20px_rgba(0,0,0,0.015)] transition-all duration-300 hover:shadow-md hover:border-zinc-350/80">
            <div className="flex justify-between items-start">
              <span className="text-[11px] font-extrabold tracking-wider text-zinc-400 uppercase">Arama Eşleşmesi</span>
              <span className="material-symbols-outlined text-[20px] p-2 rounded-2xl border border-zinc-150 text-zinc-500 bg-zinc-50">search</span>
            </div>
            <p className="text-2xl font-black text-zinc-900 mt-2">{filteredSubscribers.length}</p>
          </div>
        </div>

        {/* Filter bar */}
        <div className="flex flex-col sm:flex-row justify-between gap-4 bg-white p-4 border border-zinc-200/80 rounded-3xl shadow-[0_2px_8px_rgba(0,0,0,0.02)]">
          <Input
            placeholder="Abone e-postası ara..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            icon="search"
            className="max-w-md w-full rounded-2xl focus:ring-[#df0000]/5 focus:border-[#df0000]"
          />
          <div className="flex gap-2 shrink-0">
            <Button 
              variant="outline" 
              onClick={handleExportCSV} 
              icon="download"
              className="rounded-2xl hover:bg-zinc-50 active:scale-[0.98] transition-all px-4 font-bold"
            >
              Excel / CSV Aktar
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center py-24 bg-white rounded-3xl border border-zinc-200/80 shadow-[0_2px_8px_rgba(0,0,0,0.02)]">
            <div className="w-10 h-10 border-4 border-zinc-200 border-t-[#df0000] rounded-full animate-spin mb-3" />
            <span className="text-sm text-zinc-400 font-medium">Aboneler yükleniyor...</span>
          </div>
        ) : filteredSubscribers.length === 0 ? (
          <div className="bg-white rounded-3xl border border-zinc-200/80 p-16 text-center shadow-[0_2px_8px_rgba(0,0,0,0.02)]">
            <div className="w-16 h-16 bg-zinc-50 rounded-full flex items-center justify-center mx-auto mb-4 border border-zinc-100">
              <span className="material-symbols-outlined text-[32px] text-zinc-450">mail</span>
            </div>
            <h4 className="text-base font-bold text-zinc-850">Kayıt Bulunmuyor</h4>
            <p className="text-xs text-zinc-500 mt-2 max-w-sm mx-auto">
              Aradığınız kriterde veya bültene kayıtlı bir abone bulunamadı.
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-3xl border border-zinc-200/80 bg-white shadow-[0_2px_8px_rgba(0,0,0,0.02),0_8px_24px_rgba(0,0,0,0.02)]">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-zinc-50/80 border-b border-zinc-200/80 text-[10px] font-extrabold tracking-wider text-zinc-450 uppercase">
                    <th className="px-6 py-4">E-posta Adresi</th>
                    <th className="px-6 py-4">Kayıt Tarihi</th>
                    <th className="px-6 py-4 text-center">Durum</th>
                    <th className="px-6 py-4 text-right">İşlemler</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-150/60 text-xs text-zinc-650">
                  {filteredSubscribers.map((item) => (
                    <tr key={item.id} className="hover:bg-zinc-50/50 transition-colors duration-150">
                      <td className="px-6 py-4 font-bold text-zinc-950">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-zinc-50 flex items-center justify-center border border-zinc-150">
                            <span className="material-symbols-outlined text-zinc-400 text-[14px]">email</span>
                          </div>
                          <span className="text-[13px]">{item.email}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-zinc-500 font-medium">
                        {new Date(item.subscribedAt).toLocaleString('tr-TR')}
                      </td>
                      <td className="px-6 py-4 text-center">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[9px] font-bold border uppercase tracking-wider ${
                          item.isActive ? 'bg-green-50 border-green-200 text-green-700' : 'bg-zinc-50 border-zinc-200 text-zinc-500'
                        }`}>
                          {item.isActive ? 'Abone' : 'Ayrıldı'}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <button
                          type="button"
                          onClick={() => handleDelete(item.id)}
                          className="w-8 h-8 rounded-full border border-zinc-200/80 text-zinc-400 hover:text-rose-600 hover:border-rose-200 hover:bg-rose-50/50 transition-all flex items-center justify-center ml-auto"
                          title="Sil"
                        >
                          <span className="material-symbols-outlined text-[16px]">delete</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </AdminLayout>
  )
}
