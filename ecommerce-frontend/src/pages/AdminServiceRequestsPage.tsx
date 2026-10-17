import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AdminLayout } from '../components/admin/AdminLayout'
import { getAdminToken, readApiResponse } from '../lib/api'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { useToast } from '../components/ui/ToastContext'

type ServiceRequestItem = {
  id: string
  userId: string
  fullName: string
  phone: string
  productGroup: string
  modelNo: string
  description: string
  status: string
  createdAtUtc: string
}

export function AdminServiceRequestsPage() {
  const { showToast } = useToast()
  const [searchParams] = useSearchParams()
  const initialSearch = searchParams.get('search') || ''

  const [requests, setRequests] = useState<ServiceRequestItem[]>([])
  const [loading, setLoading] = useState(false)
  const [searchTerm, setSearchTerm] = useState(initialSearch)
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [selectedRequest, setSelectedRequest] = useState<ServiceRequestItem | null>(null)
  const [requestToDelete, setRequestToDelete] = useState<string | null>(null)

  const authHeader = useMemo(() => {
    const token = getAdminToken()
    return token ? { Authorization: `Bearer ${token}` } : null
  }, [])

  const fetchRequests = async () => {
    if (!authHeader) return
    setLoading(true)
    try {
      const res = await fetch('/api/admin/modules/service-requests', { headers: authHeader })
      const json = await readApiResponse(res)
      if (res.ok && json?.success) {
        setRequests(json.data || [])
      } else {
        showToast(json?.message || 'Servis talepleri alınamadı.', 'error')
      }
    } catch (err) {
      showToast('Bağlantı hatası.', 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchRequests()
  }, [authHeader])

  const handleUpdateStatus = async (id: string, newStatus: string) => {
    if (!authHeader) return
    try {
      const res = await fetch(`/api/admin/modules/service-requests/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...authHeader,
        },
        body: JSON.stringify({ status: newStatus }),
      })
      const json = await readApiResponse(res)
      if (res.ok && json?.success) {
        showToast('Talep durumu güncellendi.', 'success')
        setRequests(prev =>
          prev.map(req => (req.id === id ? { ...req, status: newStatus } : req))
        )
        if (selectedRequest?.id === id) {
          setSelectedRequest(prev => prev ? { ...prev, status: newStatus } : null)
        }
      } else {
        showToast(json?.message || 'Güncelleme başarısız.', 'error')
      }
    } catch (err) {
      showToast('Bağlantı hatası.', 'error')
    }
  }

  const handleDelete = async () => {
    if (!authHeader || !requestToDelete) return
    const id = requestToDelete
    setRequestToDelete(null)

    try {
      const res = await fetch(`/api/admin/modules/service-requests/${id}`, {
        method: 'DELETE',
        headers: authHeader,
      })
      const json = await readApiResponse(res)
      if (res.ok && json?.success) {
        showToast('Servis talebi başarıyla silindi.', 'success')
        fetchRequests()
        if (selectedRequest?.id === id) {
          setSelectedRequest(null)
        }
      } else {
        showToast(json?.message || 'Silme işlemi başarısız.', 'error')
      }
    } catch (err) {
      showToast('Bağlantı hatası.', 'error')
    }
  }

  const filteredRequests = useMemo(() => {
    return requests.filter((req) => {
      const matchesSearch =
        req.fullName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        req.phone.includes(searchTerm) ||
        req.productGroup.toLowerCase().includes(searchTerm.toLowerCase()) ||
        req.modelNo.toLowerCase().includes(searchTerm.toLowerCase()) ||
        req.description.toLowerCase().includes(searchTerm.toLowerCase())

      const matchesStatus = statusFilter === 'all' || req.status === statusFilter

      return matchesSearch && matchesStatus
    })
  }, [requests, searchTerm, statusFilter])

  return (
    <AdminLayout
      title="Servis Talepleri"
      subtitle="Kullanıcılar tarafından iletilen tüm teknik servis ve garanti destek taleplerini yönetin."
    >
      <div className="space-y-6">
        {/* Stats card */}
        <div className="grid gap-5 sm:grid-cols-4">
          <div className="bg-white p-5 border border-zinc-200/80 rounded-3xl shadow-[0_2px_8px_rgba(0,0,0,0.02)]">
            <span className="text-[11px] font-extrabold tracking-wider text-zinc-400 uppercase">Toplam Talep</span>
            <p className="text-2xl font-black text-zinc-900 mt-2">{requests.length}</p>
          </div>
          <div className="bg-white p-5 border border-zinc-200/80 rounded-3xl shadow-[0_2px_8px_rgba(0,0,0,0.02)]">
            <span className="text-[11px] font-extrabold tracking-wider text-zinc-400 uppercase">Bekleyen</span>
            <p className="text-2xl font-black text-amber-500 mt-2">
              {requests.filter((r) => r.status === 'Bekliyor').length}
            </p>
          </div>
          <div className="bg-white p-5 border border-zinc-200/80 rounded-3xl shadow-[0_2px_8px_rgba(0,0,0,0.02)]">
            <span className="text-[11px] font-extrabold tracking-wider text-zinc-400 uppercase">İnceleniyor</span>
            <p className="text-2xl font-black text-blue-500 mt-2">
              {requests.filter((r) => r.status === 'İnceleniyor').length}
            </p>
          </div>
          <div className="bg-white p-5 border border-zinc-200/80 rounded-3xl shadow-[0_2px_8px_rgba(0,0,0,0.02)]">
            <span className="text-[11px] font-extrabold tracking-wider text-zinc-400 uppercase">Tamamlandı</span>
            <p className="text-2xl font-black text-green-600 mt-2">
              {requests.filter((r) => r.status === 'Tamamlandı').length}
            </p>
          </div>
        </div>

        {/* Filter bar */}
        <div className="flex flex-col md:flex-row justify-between gap-4 bg-white p-4 border border-zinc-200/80 rounded-3xl shadow-[0_2px_8px_rgba(0,0,0,0.02)]">
          <Input
            placeholder="İsim, telefon, ürün grubu veya model ara..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            icon="search"
            className="max-w-md w-full rounded-2xl focus:ring-[#df0000]/5 focus:border-[#df0000]"
          />
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-zinc-550">Durum:</span>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="h-10 px-4 border border-zinc-200 rounded-2xl text-xs font-semibold text-zinc-700 bg-white outline-none focus:ring-4 focus:ring-[#df0000]/5 focus:border-[#df0000] transition-all"
            >
              <option value="all">Tümü</option>
              <option value="Bekliyor">Bekliyor</option>
              <option value="İnceleniyor">İnceleniyor</option>
              <option value="Tamamlandı">Tamamlandı</option>
              <option value="İptal Edildi">İptal Edildi</option>
            </select>
          </div>
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center py-24 bg-white rounded-3xl border border-zinc-200/80 shadow-[0_2px_8px_rgba(0,0,0,0.02)]">
            <div className="w-10 h-10 border-4 border-zinc-200 border-t-[#df0000] rounded-full animate-spin mb-3" />
            <span className="text-sm text-zinc-400 font-medium">Talepler yükleniyor...</span>
          </div>
        ) : filteredRequests.length === 0 ? (
          <div className="bg-white rounded-3xl border border-zinc-200/80 p-16 text-center shadow-[0_2px_8px_rgba(0,0,0,0.02)]">
            <div className="w-16 h-16 bg-zinc-50 rounded-full flex items-center justify-center mx-auto mb-4 border border-zinc-100">
              <span className="material-symbols-outlined text-[32px] text-zinc-450">build</span>
            </div>
            <h4 className="text-base font-bold text-zinc-850">Kayıt Bulunmuyor</h4>
            <p className="text-xs text-zinc-500 mt-2 max-w-sm mx-auto">
              Aradığınız kriterde veya henüz kullanıcılar tarafından oluşturulmuş teknik servis talebi bulunmamaktadır.
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-3xl border border-zinc-200/80 bg-white shadow-[0_2px_8px_rgba(0,0,0,0.02)]">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-zinc-50/80 border-b border-zinc-200/80 text-[10px] font-extrabold tracking-wider text-zinc-450 uppercase">
                    <th className="px-6 py-4">Müşteri / İletişim</th>
                    <th className="px-6 py-4">Ürün Grubu / Model</th>
                    <th className="px-6 py-4">Tarih</th>
                    <th className="px-6 py-4 text-center">Durum</th>
                    <th className="px-6 py-4 text-right">İşlemler</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-150/60 text-xs text-zinc-650">
                  {filteredRequests.map((item) => (
                    <tr key={item.id} className="hover:bg-zinc-50/50 transition-colors duration-150">
                      <td className="px-6 py-4.5 text-zinc-950">
                        <div className="flex flex-col">
                          <span className="font-bold text-[13px]">{item.fullName}</span>
                          <span className="text-[11px] text-zinc-450 mt-0.5">{item.phone}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4.5 text-zinc-700">
                        <div className="flex flex-col">
                          <span className="font-bold text-[12px]">{item.productGroup}</span>
                          <span className="text-[11px] text-zinc-450 mt-0.5">Model: {item.modelNo}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4.5 text-zinc-500 whitespace-nowrap font-medium">
                        {new Date(item.createdAtUtc).toLocaleString('tr-TR')}
                      </td>
                      <td className="px-6 py-4.5 text-center whitespace-nowrap">
                        <select
                          value={item.status}
                          onChange={(e) => handleUpdateStatus(item.id, e.target.value)}
                          className={`px-3 py-1 rounded-full text-[10px] font-bold border uppercase tracking-wider outline-none cursor-pointer transition-all ${
                            item.status === 'Bekliyor'
                              ? 'bg-amber-50 border-amber-200 text-amber-700'
                              : item.status === 'İnceleniyor'
                              ? 'bg-blue-50 border-blue-200 text-blue-700'
                              : item.status === 'Tamamlandı'
                              ? 'bg-green-50 border-green-200 text-green-700'
                              : 'bg-rose-50 border-rose-200 text-rose-700'
                          }`}
                        >
                          <option value="Bekliyor">Bekliyor</option>
                          <option value="İnceleniyor">İnceleniyor</option>
                          <option value="Tamamlandı">Tamamlandı</option>
                          <option value="İptal Edildi">İptal Edildi</option>
                        </select>
                      </td>
                      <td className="px-6 py-4.5 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setSelectedRequest(item)}
                            className="h-8 rounded-xl border border-zinc-200 bg-white px-3 text-[10px] font-bold text-zinc-700 hover:bg-zinc-50 transition active:scale-[0.97]"
                          >
                            Detay Gör
                          </button>
                          <button
                            type="button"
                            onClick={() => setRequestToDelete(item.id)}
                            className="w-8 h-8 rounded-full border border-zinc-200/80 text-zinc-400 hover:text-rose-600 hover:border-rose-200 hover:bg-rose-50/50 transition-all flex items-center justify-center"
                            title="Sil"
                          >
                            <span className="material-symbols-outlined text-[16px]">delete</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Detail Modal */}
        {selectedRequest && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/45 backdrop-blur-[2px]">
            <div className="bg-white rounded-3xl max-w-3xl w-full border border-zinc-200/80 shadow-2xl overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-200">
              <div className="bg-white text-zinc-900 p-6 flex justify-between items-center border-b border-zinc-150">
                <div className="flex items-center gap-3">
                  <span className="material-symbols-outlined text-[#df0000] text-2xl">build</span>
                  <div>
                    <h3 className="text-base font-bold text-zinc-900">Talep Detayı</h3>
                    <p className="text-[10px] text-zinc-400 font-mono mt-0.5">ID: {selectedRequest.id}</p>
                  </div>
                </div>
                <button
                  onClick={() => setSelectedRequest(null)}
                  className="w-8 h-8 rounded-full hover:bg-zinc-100 text-zinc-500 flex items-center justify-center"
                >
                  <span className="material-symbols-outlined text-lg">close</span>
                </button>
              </div>

              <div className="p-6 space-y-5 overflow-y-auto max-h-[70vh]">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="p-4 bg-zinc-50/50 border border-zinc-150 rounded-2xl">
                    <p className="text-[10px] font-extrabold text-zinc-400 uppercase tracking-wider">Müşteri Ad Soyad</p>
                    <p className="text-sm font-extrabold text-zinc-800 mt-1">{selectedRequest.fullName}</p>
                  </div>
                  <div className="p-4 bg-zinc-50/50 border border-zinc-150 rounded-2xl">
                    <p className="text-[10px] font-extrabold text-zinc-400 uppercase tracking-wider">Telefon Numarası</p>
                    <a href={`tel:${selectedRequest.phone}`} className="text-sm font-extrabold text-[#df0000] hover:underline mt-1 block">
                      {selectedRequest.phone}
                    </a>
                  </div>
                  <div className="p-4 bg-zinc-50/50 border border-zinc-150 rounded-2xl">
                    <p className="text-[10px] font-extrabold text-zinc-400 uppercase tracking-wider">Ürün Grubu</p>
                    <p className="text-sm font-extrabold text-zinc-800 mt-1">{selectedRequest.productGroup}</p>
                  </div>
                  <div className="p-4 bg-zinc-50/50 border border-zinc-150 rounded-2xl">
                    <p className="text-[10px] font-extrabold text-zinc-400 uppercase tracking-wider">Model Numarası</p>
                    <p className="text-sm font-extrabold text-zinc-800 mt-1">{selectedRequest.modelNo}</p>
                  </div>
                </div>

                <div className="p-5 border border-zinc-150 rounded-2xl bg-zinc-50/30">
                  <p className="text-[10px] font-extrabold text-zinc-400 uppercase tracking-wider mb-2">Talep & Sorun Açıklaması</p>
                  <div className="max-h-48 overflow-y-auto pr-1">
                    <p className="text-xs text-zinc-700 leading-relaxed whitespace-pre-wrap font-medium break-all">
                      {selectedRequest.description}
                    </p>
                  </div>
                </div>
              </div>

              <div className="p-5 border-t border-zinc-150 bg-zinc-50 flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-extrabold text-zinc-400 uppercase tracking-wider">Durum Değiştir:</span>
                  <select
                    value={selectedRequest.status}
                    onChange={(e) => handleUpdateStatus(selectedRequest.id, e.target.value)}
                    className="h-9 px-3 border border-zinc-200 rounded-xl text-xs font-bold text-zinc-700 bg-white outline-none"
                  >
                    <option value="Bekliyor">Bekliyor</option>
                    <option value="İnceleniyor">İnceleniyor</option>
                    <option value="Tamamlandı">Tamamlandı</option>
                    <option value="İptal Edildi">İptal Edildi</option>
                  </select>
                </div>
                <div className="flex gap-3">
                  <Button variant="outline" onClick={() => setSelectedRequest(null)} className="rounded-2xl">
                    Kapat
                  </Button>
                  <Button
                    variant="primary"
                    onClick={() => setRequestToDelete(selectedRequest.id)}
                    className="bg-[#df0000] hover:bg-[#c00000] border-none rounded-2xl"
                  >
                    Talebi Sil
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Delete Confirmation Modal */}
        {requestToDelete && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
            <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-200">
              <div className="flex items-center gap-3 text-red-650">
                <span className="material-symbols-outlined text-3xl">warning</span>
                <h3 className="text-lg font-bold text-zinc-900">Talebi Sil</h3>
              </div>
              <p className="mt-3 text-sm text-zinc-600 leading-relaxed">
                Bu servis talebini kalıcı olarak silmek istediğinize emin misiniz? Bu işlem geri alınamaz.
              </p>
              <div className="mt-6 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setRequestToDelete(null)}
                  className="h-10 rounded-xl border border-zinc-200 bg-white px-5 text-sm font-bold text-zinc-650 transition-all hover:bg-zinc-50 active:scale-[0.98]"
                >
                  Vazgeç
                </button>
                <button
                  type="button"
                  onClick={handleDelete}
                  className="h-10 rounded-xl bg-red-650 px-5 text-sm font-bold text-white transition-all hover:bg-red-700 active:scale-[0.98]"
                >
                  Evet, Sil
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </AdminLayout>
  )
}
