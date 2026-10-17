import { useEffect, useMemo, useState } from 'react'
import { AdminLayout } from '../components/admin/AdminLayout'
import { getAdminToken } from '../lib/api'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { useToast } from '../components/ui/ToastContext'
import { useConfirm } from '../components/ui/ConfirmContext'

type ContactMessageItem = {
  id: string
  fullName: string
  email: string
  phone?: string
  subject: string
  message: string
  createdAt: string
  isRead: boolean
}

export function AdminContactPage() {
  const { showToast } = useToast()
  const confirm = useConfirm()
  const [messages, setMessages] = useState<ContactMessageItem[]>([])
  const [loading, setLoading] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedMessage, setSelectedMessage] = useState<ContactMessageItem | null>(null)

  const authHeader = useMemo(() => {
    const token = getAdminToken()
    return token ? { Authorization: `Bearer ${token}` } : null
  }, [])

  const fetchMessages = async () => {
    if (!authHeader) return
    setLoading(true)
    try {
      const res = await fetch('/api/admin/contact-messages', { headers: authHeader })
      const json = await res.json()
      if (res.ok && json?.success) {
        setMessages(json.data || [])
      } else {
        showToast(json?.message || 'Mesajlar alınamadı.', 'error')
      }
    } catch (err) {
      showToast('Bağlantı hatası.', 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchMessages()
  }, [authHeader])

  const handleMarkAsRead = async (id: string) => {
    if (!authHeader) return
    try {
      const res = await fetch(`/api/admin/contact-messages/${id}/read`, {
        method: 'POST',
        headers: authHeader,
      })
      if (res.ok) {
        setMessages(prev =>
          prev.map(msg => (msg.id === id ? { ...msg, isRead: true } : msg))
        )
      }
    } catch (err) {
      console.error('Okundu işaretleme hatası:', err)
    }
  }

  const handleDelete = async (id: string) => {
    if (!authHeader) return
    const ok = await confirm('Bu mesajı kalıcı olarak silmek istediğinizden emin misiniz?', { type: 'danger', confirmText: 'Evet, Sil', title: 'Mesajı Sil' })
    if (!ok) return

    try {
      const res = await fetch(`/api/admin/contact-messages/${id}`, {
        method: 'DELETE',
        headers: authHeader,
      })
      const json = await res.json()
      if (res.ok && json?.success) {
        showToast('Mesaj başarıyla silindi.', 'success')
        fetchMessages()
        if (selectedMessage?.id === id) {
          setSelectedMessage(null)
        }
      } else {
        showToast(json?.message || 'Silme işlemi başarısız.', 'error')
      }
    } catch (err) {
      showToast('Bağlantı hatası.', 'error')
    }
  }

  const handleOpenDetail = (msg: ContactMessageItem) => {
    setSelectedMessage(msg)
    if (!msg.isRead) {
      handleMarkAsRead(msg.id)
    }
  }

  const filteredMessages = useMemo(() => {
    return messages.filter((msg) =>
      msg.fullName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      msg.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
      msg.subject.toLowerCase().includes(searchTerm.toLowerCase()) ||
      msg.message.toLowerCase().includes(searchTerm.toLowerCase())
    )
  }, [messages, searchTerm])

  return (
    <AdminLayout
      title="İletişim Talepleri"
      subtitle="Ziyaretçilerinizin 'Bize Mesaj Gönderin' formundan gönderdiği tüm iletileri listeleyin ve inceleyin."
    >
      <div className="space-y-6">
        {/* Stats card */}
        <div className="grid gap-5 sm:grid-cols-3">
          <div className="bg-white p-5 border border-zinc-200/80 rounded-3xl shadow-[0_2px_8px_rgba(0,0,0,0.02),0_8px_20px_rgba(0,0,0,0.015)] transition-all duration-300 hover:shadow-md hover:border-zinc-350/80">
            <div className="flex justify-between items-start">
              <span className="text-[11px] font-extrabold tracking-wider text-zinc-400 uppercase">Toplam İleti</span>
              <span className="material-symbols-outlined text-[20px] p-2 rounded-2xl border border-zinc-150 text-zinc-500 bg-zinc-50">mail</span>
            </div>
            <p className="text-2xl font-black text-zinc-900 mt-2">{messages.length}</p>
          </div>
          <div className="bg-white p-5 border border-zinc-200/80 rounded-3xl shadow-[0_2px_8px_rgba(0,0,0,0.02),0_8px_20px_rgba(0,0,0,0.015)] transition-all duration-300 hover:shadow-md hover:border-zinc-350/80">
            <div className="flex justify-between items-start">
              <span className="text-[11px] font-extrabold tracking-wider text-zinc-400 uppercase">Okunmamış İletiler</span>
              <span className="material-symbols-outlined text-[20px] p-2 rounded-2xl border border-rose-100 text-[#df0000] bg-rose-50/50">mark_email_unread</span>
            </div>
            <p className="text-2xl font-black text-[#df0000] mt-2">
              {messages.filter((m) => !m.isRead).length}
            </p>
          </div>
          <div className="bg-white p-5 border border-zinc-200/80 rounded-3xl shadow-[0_2px_8px_rgba(0,0,0,0.02),0_8px_20px_rgba(0,0,0,0.015)] transition-all duration-300 hover:shadow-md hover:border-zinc-350/80">
            <div className="flex justify-between items-start">
              <span className="text-[11px] font-extrabold tracking-wider text-zinc-400 uppercase">Arama Eşleşmesi</span>
              <span className="material-symbols-outlined text-[20px] p-2 rounded-2xl border border-zinc-150 text-zinc-500 bg-zinc-50">search</span>
            </div>
            <p className="text-2xl font-black text-zinc-900 mt-2">{filteredMessages.length}</p>
          </div>
        </div>

        {/* Filter bar */}
        <div className="flex flex-col sm:flex-row justify-between gap-4 bg-white p-4 border border-zinc-200/80 rounded-3xl shadow-[0_2px_8px_rgba(0,0,0,0.02)]">
          <Input
            placeholder="İsim, e-posta, konu veya mesaj içeriğinde ara..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            icon="search"
            className="max-w-md w-full rounded-2xl focus:ring-[#df0000]/5 focus:border-[#df0000]"
          />
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center py-24 bg-white rounded-3xl border border-zinc-200/80 shadow-[0_2px_8px_rgba(0,0,0,0.02)]">
            <div className="w-10 h-10 border-4 border-zinc-200 border-t-[#df0000] rounded-full animate-spin mb-3" />
            <span className="text-sm text-zinc-400 font-medium">Mesajlar yükleniyor...</span>
          </div>
        ) : filteredMessages.length === 0 ? (
          <div className="bg-white rounded-3xl border border-zinc-200/80 p-16 text-center shadow-[0_2px_8px_rgba(0,0,0,0.02)]">
            <div className="w-16 h-16 bg-zinc-50 rounded-full flex items-center justify-center mx-auto mb-4 border border-zinc-100">
              <span className="material-symbols-outlined text-[32px] text-zinc-450">chat</span>
            </div>
            <h4 className="text-base font-bold text-zinc-850">Kayıt Bulunmuyor</h4>
            <p className="text-xs text-zinc-500 mt-2 max-w-sm mx-auto">
              Aradığınız kriterde veya henüz ziyaretçileriniz tarafından gönderilmiş herhangi bir iletişim talebi mesajı bulunmamaktadır.
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-3xl border border-zinc-200/80 bg-white shadow-[0_2px_8px_rgba(0,0,0,0.02),0_8px_24px_rgba(0,0,0,0.02)]">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-zinc-50/80 border-b border-zinc-200/80 text-[10px] font-extrabold tracking-wider text-zinc-450 uppercase">
                    <th className="px-6 py-4">Gönderen</th>
                    <th className="px-6 py-4">Telefon</th>
                    <th className="px-6 py-4">Konu / Mesaj Özeti</th>
                    <th className="px-6 py-4">Tarih</th>
                    <th className="px-6 py-4 text-center">Durum</th>
                    <th className="px-6 py-4 text-right">İşlemler</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-150/60 text-xs text-zinc-650">
                  {filteredMessages.map((item) => (
                    <tr
                      key={item.id}
                      className={`hover:bg-zinc-50/50 transition-colors duration-150 ${
                        !item.isRead ? 'bg-blue-50/10 font-medium' : ''
                      }`}
                    >
                      <td className="px-6 py-4.5 text-zinc-950">
                        <div className="flex flex-col">
                          <span className="font-bold text-[13px]">{item.fullName}</span>
                          <span className="text-[11px] text-zinc-450 mt-0.5">{item.email}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4.5 text-zinc-600 font-bold whitespace-nowrap">
                        {item.phone || '-'}
                      </td>
                      <td className="px-6 py-4.5 text-zinc-700">
                        <div className="flex items-center gap-2">
                          <span className="inline-block px-2.5 py-0.5 rounded-lg bg-zinc-100 text-zinc-800 text-[10px] font-extrabold border border-zinc-200">
                            {item.subject}
                          </span>
                          <span className="text-zinc-500 font-medium line-clamp-1 max-w-xs xl:max-w-md">
                            {item.message}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4.5 text-zinc-500 whitespace-nowrap font-medium">
                        {new Date(item.createdAt).toLocaleString('tr-TR')}
                      </td>
                      <td className="px-6 py-4.5 text-center whitespace-nowrap">
                        <span
                          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[9px] font-bold border uppercase tracking-wider ${
                            item.isRead
                              ? 'bg-zinc-50 border-zinc-200 text-zinc-500'
                              : 'bg-rose-50 border-rose-200 text-[#df0000]'
                          }`}
                        >
                          {item.isRead ? 'Okundu' : 'Yeni'}
                        </span>
                      </td>
                      <td className="px-6 py-4.5 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => handleOpenDetail(item)}
                            className="h-8 rounded-xl border border-zinc-200 bg-white px-3 text-[10px] font-bold text-zinc-700 hover:bg-zinc-50 transition active:scale-[0.97] flex items-center justify-center"
                          >
                            Detay Gör
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(item.id)}
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
        {selectedMessage && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/45 backdrop-blur-[2px]">
            <div className="bg-white rounded-3xl max-w-3xl w-full border border-zinc-200/80 shadow-2xl overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-200">
              <div className="bg-white text-zinc-900 p-6 flex justify-between items-center border-b border-zinc-150">
                <div className="flex items-center gap-3">
                  <span className="material-symbols-outlined text-[#df0000] text-2xl">chat</span>
                  <div>
                    <h3 className="text-base font-bold text-zinc-900">İleti Detayı</h3>
                    <p className="text-[10px] text-zinc-400 font-mono mt-0.5">ID: {selectedMessage.id}</p>
                  </div>
                </div>
                <button
                  onClick={() => setSelectedMessage(null)}
                  className="w-8 h-8 rounded-full hover:bg-zinc-100 text-zinc-500 flex items-center justify-center transition-colors"
                >
                  <span className="material-symbols-outlined text-lg">close</span>
                </button>
              </div>

              <div className="p-6 space-y-5 overflow-y-auto max-h-[70vh]">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="p-4 bg-zinc-50/50 border border-zinc-150 rounded-2xl">
                    <p className="text-[10px] font-extrabold text-zinc-400 uppercase tracking-wider">Gönderen Ad Soyad</p>
                    <p className="text-sm font-extrabold text-zinc-800 mt-1">{selectedMessage.fullName}</p>
                  </div>
                  <div className="p-4 bg-zinc-50/50 border border-zinc-150 rounded-2xl">
                    <p className="text-[10px] font-extrabold text-zinc-400 uppercase tracking-wider">E-posta Adresi</p>
                    <a href={`mailto:${selectedMessage.email}`} className="text-sm font-extrabold text-[#df0000] hover:underline mt-1 block">
                      {selectedMessage.email}
                    </a>
                  </div>
                  {selectedMessage.phone && (
                    <div className="p-4 bg-zinc-50/50 border border-zinc-150 rounded-2xl">
                      <p className="text-[10px] font-extrabold text-zinc-400 uppercase tracking-wider">Telefon Numarası</p>
                      <p className="text-sm font-extrabold text-zinc-800 mt-1">{selectedMessage.phone}</p>
                    </div>
                  )}
                  <div className="p-4 bg-zinc-50/50 border border-zinc-150 rounded-2xl">
                    <p className="text-[10px] font-extrabold text-zinc-400 uppercase tracking-wider">Seçilen Konu</p>
                    <p className="text-sm font-extrabold text-zinc-800 mt-1">{selectedMessage.subject}</p>
                  </div>
                  <div className="p-4 bg-zinc-50/50 border border-zinc-150 rounded-2xl">
                    <p className="text-[10px] font-extrabold text-zinc-400 uppercase tracking-wider">Gönderim Tarihi</p>
                    <p className="text-sm font-extrabold text-zinc-800 mt-1">
                      {new Date(selectedMessage.createdAt).toLocaleString('tr-TR')}
                    </p>
                  </div>
                </div>

                <div className="p-5 border border-zinc-150 rounded-2xl bg-zinc-50/30">
                  <p className="text-[10px] font-extrabold text-zinc-400 uppercase tracking-wider mb-2">Mesaj İçeriği</p>
                  <div className="max-h-48 overflow-y-auto pr-1">
                    <p className="text-xs text-zinc-700 leading-relaxed whitespace-pre-wrap font-medium break-all">
                      {selectedMessage.message}
                    </p>
                  </div>
                </div>
              </div>

              <div className="p-5 border-t border-zinc-150 bg-zinc-50 flex justify-end gap-3">
                <Button 
                  variant="outline" 
                  onClick={() => setSelectedMessage(null)}
                  className="rounded-2xl active:scale-[0.98]"
                >
                  Kapat
                </Button>
                <Button
                  variant="primary"
                  onClick={() => {
                    handleDelete(selectedMessage.id)
                  }}
                  className="bg-[#df0000] hover:bg-[#c00000] text-white border-none rounded-2xl active:scale-[0.98]"
                >
                  Mesajı Sil
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </AdminLayout>
  )
}
