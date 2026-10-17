import { useEffect, useState, Fragment } from 'react'
import { AdminLayout } from '../components/admin/AdminLayout'
import { Button } from '../components/ui/Button'
import { getAdminToken, readApiResponse } from '../lib/api'
import { useToast } from '../components/ui/ToastContext'
import { useConfirm } from '../components/ui/ConfirmContext'

type ReviewItem = {
  id: string
  productId: string
  productName: string
  customerName: string
  rating: number
  comment: string
  status: string
  adminReply?: string
  createdAtUtc: string
}

export function AdminReviewsPage() {
  const { showToast } = useToast()
  const confirm = useConfirm()
  const [rows, setRows] = useState<ReviewItem[]>([])
  const [selectedTab, setSelectedTab] = useState('All') // All, Deleted

  // Expanded row and reply
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [replyText, setReplyText] = useState('')
  const [isEditingReply, setIsEditingReply] = useState(false)

  async function load() {
    try {
      const res = await fetch('/api/admin/modules/reviews', {
        headers: { Authorization: `Bearer ${getAdminToken()}` }
      })
      const json = await readApiResponse(res)
      if (res.ok && Array.isArray(json?.data)) {
        setRows(json.data)
      }
    } catch {
      showToast('Yorumlar yüklenemedi.', 'error')
    }
  }

  useEffect(() => {
    load()
  }, [])

  const handleStatusUpdate = async (id: string, newStatus: string) => {
    try {
      const res = await fetch(`/api/admin/modules/reviews/${id}/status`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getAdminToken()}`
        },
        body: JSON.stringify({ status: newStatus })
      })
      if (res.ok) {
        showToast(`Yorum durumu "${newStatus}" olarak güncellendi.`, 'success')
        load()
      } else {
        throw new Error()
      }
    } catch {
      showToast('Yorum güncellenemedi.', 'error')
    }
  }

  const handleDelete = async (id: string, isDeletedTab: boolean) => {
    const confirmMsg = isDeletedTab 
      ? 'Bu yorumu kalıcı olarak veritabanından silmek istediğinizden emin misiniz?' 
      : 'Bu yorumu silinenler klasörüne taşımak istediğinizden emin misiniz?'
    
    const ok = await confirm(confirmMsg, { 
      type: 'danger', 
      confirmText: isDeletedTab ? 'Evet, Kalıcı Olarak Sil' : 'Evet, Sil', 
      title: isDeletedTab ? 'Yorumu Kalıcı Sil' : 'Yorumu Sil' 
    })
    
    if (!ok) return
    
    try {
      const res = await fetch(`/api/admin/modules/reviews/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${getAdminToken()}` }
      })
      if (res.ok) {
        showToast(isDeletedTab ? 'Yorum kalıcı olarak silindi.' : 'Yorum silinenlere taşındı.', 'success')
        load()
      } else {
        throw new Error()
      }
    } catch {
      showToast('İşlem başarısız oldu.', 'error')
    }
  }

  const handleSendReply = async (id: string) => {
    if (!replyText.trim()) return
    try {
      const res = await fetch(`/api/admin/modules/reviews/${id}/reply`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getAdminToken()}`
        },
        body: JSON.stringify({ reply: replyText.trim() })
      })
      if (res.ok) {
        showToast('Yanıtınız başarıyla kaydedildi.', 'success')
        setReplyText('')
        setIsEditingReply(false)
        load()
      } else {
        throw new Error()
      }
    } catch {
      showToast('Yanıt kaydedilemedi.', 'error')
    }
  }

  // Active / Deleted separation
  const activeReviews = rows.filter((r) => r.status !== 'Deleted')
  const deletedReviews = rows.filter((r) => r.status === 'Deleted')

  const totalCount = activeReviews.length
  const deletedCount = deletedReviews.length

  const approvedReviews = activeReviews.filter((r) => r.status === 'Approved')
  const avgRating = approvedReviews.length > 0
    ? (approvedReviews.reduce((sum, r) => sum + r.rating, 0) / approvedReviews.length).toFixed(1)
    : '0.0'

  const now = new Date()
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
  const newThisMonth = activeReviews.filter((r) => new Date(r.createdAtUtc) >= startOfMonth).length

  const filteredRows = rows.filter((row) => {
    if (selectedTab === 'Deleted') return row.status === 'Deleted'
    return row.status !== 'Deleted'
  })

  const statusColorMap: Record<string, string> = {
    Pending: 'border-amber-200 bg-amber-50/50 text-amber-700',
    Approved: 'border-green-200 bg-green-50/50 text-green-700',
    Rejected: 'border-zinc-200 bg-zinc-50/50 text-zinc-500',
    Deleted: 'border-rose-200 bg-rose-50/50 text-rose-700'
  }

  const statusTextMap: Record<string, string> = {
    Pending: 'Bekleyen',
    Approved: 'Onaylandı',
    Rejected: 'Reddedildi',
    Deleted: 'Silindi'
  }

  return (
    <AdminLayout
      title="Yorumlar & Değerlendirmeler"
      subtitle="Ürün sayfalarında yayınlanan müşteri yorumlarını onaylayın, yanıtlayın ve silinen yorumları yönetin."
    >
      {/* KPI Section */}
      <div className="grid gap-5 sm:grid-cols-3">
        {[
          { label: 'Toplam Yorum', value: totalCount.toString(), icon: 'chat', color: 'text-zinc-650 bg-zinc-50 border-zinc-150' },
          { label: 'Ortalama Puan', value: `★ ${avgRating}`, icon: 'star', color: 'text-amber-500 bg-amber-50 border-amber-100' },
          { label: 'Bu Ay Yeni Yorum', value: newThisMonth.toString(), icon: 'new_releases', color: 'text-blue-600 bg-blue-50 border-blue-100' },
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

      {/* Tabs */}
      <div className="mt-6 flex gap-2 border-b border-zinc-200 pb-3 overflow-x-auto">
        {[
          { key: 'All', label: `Tümü (${totalCount})` },
          { key: 'Deleted', label: `Silinen Yorumlar (${deletedCount})` },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setSelectedTab(tab.key)}
            className={`px-4 py-2 rounded-2xl text-xs font-bold transition-all shrink-0 ${
              selectedTab === tab.key
                ? 'bg-zinc-900 text-white shadow-sm'
                : 'text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Grid Table */}
      <div className="mt-6 overflow-hidden rounded-3xl border border-zinc-200/80 bg-white shadow-[0_2px_8px_rgba(0,0,0,0.02),0_8px_24px_rgba(0,0,0,0.02)]">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-zinc-50/80 border-b border-zinc-200/80 text-[10px] font-extrabold tracking-wider text-zinc-455 uppercase">
                <th className="px-6 py-4">Ürün Detayı</th>
                <th className="px-6 py-4">Müşteri</th>
                <th className="px-6 py-4 text-center">Puan</th>
                <th className="px-6 py-4">Yorum Özeti</th>
                <th className="px-6 py-4 text-center">Tarih</th>
                <th className="px-6 py-4 text-center">Durum</th>
                <th className="px-6 py-4 text-right">İşlem</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-150/60 text-xs text-zinc-650">
              {filteredRows.map((row) => {
                const isExpanded = expandedId === row.id
                const isDeletedTab = selectedTab === 'Deleted'
                return (
                  <Fragment key={row.id}>
                    <tr
                      onClick={() => {
                        if (isExpanded) {
                          setExpandedId(null)
                          setIsEditingReply(false)
                          setReplyText('')
                        } else {
                          setExpandedId(row.id)
                          setIsEditingReply(false)
                          setReplyText(row.adminReply || '')
                        }
                      }}
                      className="hover:bg-zinc-50/50 cursor-pointer transition-colors duration-150"
                    >
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-2xl bg-zinc-100 text-zinc-400 flex items-center justify-center font-bold text-xs">
                            IMG
                          </div>
                          <span className="font-bold text-zinc-950 text-[13px]">{row.productName}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 font-semibold text-zinc-800">{row.customerName}</td>
                      <td className="px-6 py-4 text-center">
                        <div className="flex items-center justify-center gap-0.5 text-amber-500">
                          {Array.from({ length: 5 }).map((_, i) => (
                            <span
                              key={i}
                              className={`material-symbols-outlined text-[15px] ${i < row.rating ? 'fill-current' : 'text-zinc-300'}`}
                            >
                              star
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-6 py-4 max-w-xs truncate font-medium text-zinc-600">"{row.comment}"</td>
                      <td className="px-6 py-4 text-center text-zinc-500 font-medium">{new Date(row.createdAtUtc).toLocaleDateString('tr-TR')}</td>
                      <td className="px-6 py-4 text-center">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[9px] font-bold border uppercase tracking-wider ${
                          statusColorMap[row.status] || 'border-zinc-200 bg-zinc-50 text-zinc-650'
                        }`}>
                          {statusTextMap[row.status] || row.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex justify-end gap-1.5">
                          {row.status === 'Pending' && (
                            <>
                              <button
                                type="button"
                                onClick={() => handleStatusUpdate(row.id, 'Approved')}
                                className="w-7 h-7 rounded-full bg-green-50 border border-green-200 text-green-600 hover:bg-green-100 flex items-center justify-center"
                                title="Onayla"
                              >
                                <span className="material-symbols-outlined text-[16px]">check</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => handleStatusUpdate(row.id, 'Rejected')}
                                className="w-7 h-7 rounded-full bg-zinc-50 border border-zinc-200 text-zinc-500 hover:bg-zinc-150 flex items-center justify-center"
                                title="Reddet"
                              >
                                <span className="material-symbols-outlined text-[16px]">close</span>
                              </button>
                            </>
                          )}
                          {row.status === 'Deleted' && (
                            <button
                              type="button"
                              onClick={() => handleStatusUpdate(row.id, 'Approved')}
                              className="w-7 h-7 rounded-full bg-green-50 border border-green-200 text-green-600 hover:bg-green-100 flex items-center justify-center"
                              title="Geri Yükle (Yayınla)"
                            >
                              <span className="material-symbols-outlined text-[16px]">restore</span>
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleDelete(row.id, isDeletedTab)}
                            className="w-7 h-7 rounded-full border border-zinc-200 text-zinc-400 hover:text-rose-600 hover:border-rose-200 hover:bg-rose-50 flex items-center justify-center"
                            title={isDeletedTab ? "Kalıcı Olarak Sil" : "Yorumu Sil"}
                          >
                            <span className="material-symbols-outlined text-[16px]">delete</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="bg-zinc-50/50">
                        <td colSpan={7} className="px-6 py-5">
                          <div className="space-y-4 max-w-3xl border-l-2 border-[#df0000] pl-4.5">
                            <div>
                              <span className="text-[9px] font-extrabold text-zinc-400 uppercase tracking-wider block">Yorum Detayı</span>
                              <p className="text-xs font-semibold text-zinc-800 mt-1 leading-relaxed">"{row.comment}"</p>
                            </div>

                            {/* Existing reply or form */}
                            {row.status !== 'Deleted' && (
                              row.adminReply && !isEditingReply ? (
                                <div className="bg-white border border-zinc-200 rounded-2xl p-4.5 space-y-1">
                                  <div className="flex justify-between items-center text-[10px] font-extrabold text-zinc-400 uppercase tracking-wider">
                                    <span>Yönetici Yanıtı</span>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setIsEditingReply(true)
                                        setReplyText(row.adminReply || '')
                                      }}
                                      className="text-[#df0000] hover:underline font-bold text-[10px] tracking-normal uppercase"
                                    >
                                      Düzenle
                                    </button>
                                  </div>
                                  <p className="text-xs font-semibold text-zinc-800">{row.adminReply}</p>
                                </div>
                              ) : (
                                <div className="space-y-2">
                                  <span className="text-[9px] font-extrabold text-zinc-400 uppercase tracking-wider block">
                                    {row.adminReply ? 'Yanıtı Düzenle' : 'Yorumu Yanıtla'}
                                  </span>
                                  <div className="flex gap-2">
                                    <textarea
                                      value={replyText}
                                      onChange={(e) => setReplyText(e.target.value)}
                                      placeholder="Müşteriye iletilecek yanıt yazın..."
                                      rows={2}
                                      className="flex-1 rounded-2xl border border-zinc-200 bg-white p-3 text-xs font-semibold text-zinc-700 outline-none focus:ring-4 focus:ring-[#df0000]/5 focus:border-[#df0000]"
                                    />
                                    <div className="flex flex-col gap-1.5 justify-end">
                                      <Button
                                        type="button"
                                        onClick={() => handleSendReply(row.id)}
                                        className="rounded-2xl bg-zinc-900 hover:bg-zinc-800 text-white font-bold px-4 h-11 active:scale-95"
                                      >
                                        {row.adminReply ? 'Güncelle' : 'Yanıt Gönder'}
                                      </Button>
                                      {row.adminReply && (
                                        <Button
                                          type="button"
                                          onClick={() => {
                                            setIsEditingReply(false)
                                            setReplyText('')
                                          }}
                                          className="rounded-2xl bg-zinc-200 hover:bg-zinc-300 text-zinc-700 font-bold px-4 h-11 active:scale-95"
                                        >
                                          İptal
                                        </Button>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              )
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </AdminLayout>
  )
}
