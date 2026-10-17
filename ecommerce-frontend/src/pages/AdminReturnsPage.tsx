import { useEffect, useState } from 'react'
import { AdminLayout } from '../components/admin/AdminLayout'
import { Button } from '../components/ui/Button'
import { getAdminToken, readApiResponse } from '../lib/api'
import { useToast } from '../components/ui/ToastContext'

type ReturnRow = {
  id: string
  returnNo: string
  orderNo: string
  customerName: string
  productName: string
  reason: string
  amount: number
  status: string
  createdAtUtc: string
}

export function AdminReturnsPage() {
  const { showToast } = useToast()
  const [rows, setRows] = useState<ReturnRow[]>([])
  const [selectedTab, setSelectedTab] = useState('All') // All, Requested, Reviewing, Approved, Rejected

  // Sliding panel state
  const [selectedReturn, setSelectedReturn] = useState<ReturnRow | null>(null)
  const [adminDecision, setAdminDecision] = useState('Approved') // Approved, Rejected
  const [refundMethod, setRefundMethod] = useState('StoreCredit')
  const [adminNote, setAdminNote] = useState('')

  async function load() {
    try {
      const res = await fetch('/api/admin/modules/returns', {
        headers: { Authorization: `Bearer ${getAdminToken()}` }
      })
      const json = await readApiResponse(res)
      if (res.ok && Array.isArray(json?.data)) {
        setRows(json.data)
      }
    } catch {
      showToast('İade listesi yüklenemedi.', 'error')
    }
  }

  useEffect(() => {
    load()
  }, [])

  const handleDecisionSave = async () => {
    if (!selectedReturn) return
    try {
      const res = await fetch(`/api/admin/modules/returns/${selectedReturn.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getAdminToken()}`
        },
        body: JSON.stringify({ status: adminDecision })
      })
      if (res.ok) {
        showToast('İade talebi başarıyla güncellendi.', 'success')
        setSelectedReturn(null)
        load()
      } else {
        throw new Error()
      }
    } catch {
      showToast('İade güncellenemedi.', 'error')
    }
  }

  const filteredRows = rows.filter((row) => {
    if (selectedTab === 'Requested') return row.status === 'Requested'
    if (selectedTab === 'Reviewing') return row.status === 'Reviewing'
    if (selectedTab === 'Approved') return row.status === 'Approved'
    if (selectedTab === 'Rejected') return row.status === 'Rejected'
    return true
  })

  const statusColorMap: Record<string, string> = {
    Requested: 'border-amber-200 bg-amber-50/50 text-amber-700',
    Reviewing: 'border-blue-200 bg-blue-50/50 text-blue-700',
    Approved: 'border-green-200 bg-green-50/50 text-green-700',
    Completed: 'border-green-200 bg-green-50/50 text-green-700',
    Rejected: 'border-zinc-200 bg-zinc-50/50 text-zinc-650'
  }

  const statusTextMap: Record<string, string> = {
    Requested: 'Talep Alındı',
    Reviewing: 'İnceleniyor',
    Approved: 'Onaylandı',
    Completed: 'Tamamlandı',
    Rejected: 'Reddedildi'
  }

  return (
    <AdminLayout
      title="İadeler & İptaller"
      subtitle="Müşteri iade taleplerini, arızalı ürün incelemelerini ve geri ödemeleri yönetin."
    >
      {/* KPI Section */}
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: 'Açık İade Talepleri', value: '5', icon: 'pending_actions', color: 'text-amber-600 bg-amber-50 border-amber-100' },
          { label: 'Bu Ay İade Edilen', value: '4.280 ₺', icon: 'payments', color: 'text-zinc-650 bg-zinc-50 border-zinc-150' },
          { label: 'Ort. Çözüm Süresi', value: '1.8 Gün', icon: 'speed', color: 'text-blue-600 bg-blue-50 border-blue-100' },
          { label: 'İade Oranı', value: '%2.4', icon: 'analytics', color: 'text-rose-600 bg-rose-50 border-rose-100' },
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
          { key: 'All', label: `Tümü (${rows.length})` },
          { key: 'Requested', label: `Talep (${rows.filter((x) => x.status === 'Requested').length})` },
          { key: 'Reviewing', label: `İnceleniyor (${rows.filter((x) => x.status === 'Reviewing').length})` },
          { key: 'Approved', label: `Onaylandı (${rows.filter((x) => x.status === 'Approved' || x.status === 'Completed').length})` },
          { key: 'Rejected', label: `Reddedildi (${rows.filter((x) => x.status === 'Rejected').length})` },
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

      {/* Layout Content */}
      <div className="mt-6 flex flex-col lg:flex-row gap-6 items-start">
        {/* Table List */}
        <div className="flex-1 overflow-hidden rounded-3xl border border-zinc-200/80 bg-white shadow-sm w-full">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-zinc-50/80 border-b border-zinc-200/80 text-[10px] font-extrabold tracking-wider text-zinc-455 uppercase">
                  <th className="px-5 py-4">İade No</th>
                  <th className="px-5 py-4">Sipariş No</th>
                  <th className="px-5 py-4">Müşteri</th>
                  <th className="px-5 py-4">Ürün</th>
                  <th className="px-5 py-4">Neden</th>
                  <th className="px-5 py-4 text-center">Tutar</th>
                  <th className="px-5 py-4 text-center">Durum</th>
                  <th className="px-5 py-4 text-right">İşlem</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-150/60 text-xs text-zinc-650">
                {filteredRows.map((row) => (
                  <tr key={row.id} className="hover:bg-zinc-50/50 transition-colors duration-150">
                    <td className="px-5 py-4.5 font-mono font-bold text-zinc-700">{row.returnNo}</td>
                    <td className="px-5 py-4.5 font-mono text-zinc-500 font-semibold">{row.orderNo}</td>
                    <td className="px-5 py-4.5 font-semibold text-zinc-900">{row.customerName}</td>
                    <td className="px-5 py-4.5 font-bold text-zinc-850">{row.productName}</td>
                    <td className="px-5 py-4.5">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-lg text-[10px] font-bold bg-rose-50 border border-rose-100 text-rose-700">
                        {row.reason}
                      </span>
                    </td>
                    <td className="px-5 py-4.5 text-center font-bold text-zinc-900">{row.amount.toLocaleString('tr-TR')} ₺</td>
                    <td className="px-5 py-4.5 text-center">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[9px] font-bold border uppercase tracking-wider ${
                        statusColorMap[row.status] || 'border-zinc-200 bg-zinc-50 text-zinc-650'
                      }`}>
                        {statusTextMap[row.status] || row.status}
                      </span>
                    </td>
                    <td className="px-5 py-4.5 text-right">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setSelectedReturn(row)}
                        className="rounded-xl active:scale-95 text-[10px] font-bold py-1.5 px-3"
                      >
                        İncele
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Slide-out side panel (380px) */}
        {selectedReturn && (
          <aside className="w-full lg:w-96 rounded-3xl border border-zinc-200/80 bg-white p-6 shadow-[0_4px_16px_rgba(0,0,0,0.04)] space-y-5">
            <div className="flex justify-between items-center pb-2 border-b border-zinc-150">
              <div className="min-w-0">
                <span className="block text-sm font-bold text-zinc-950 uppercase tracking-tight">İade İncelemesi</span>
                <span className="block text-[10px] text-zinc-450 font-mono mt-0.5">Talepler & Geri Ödeme</span>
              </div>
              <button
                type="button"
                onClick={() => setSelectedReturn(null)}
                className="w-8 h-8 rounded-full hover:bg-zinc-100 text-zinc-500 flex items-center justify-center"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            <div className="space-y-3.5 text-xs text-zinc-650">
              <div className="flex justify-between">
                <span className="font-bold text-zinc-500">İade Numarası:</span>
                <span className="font-mono font-bold text-zinc-900">{selectedReturn.returnNo}</span>
              </div>
              <div className="flex justify-between">
                <span className="font-bold text-zinc-500">Sipariş No:</span>
                <span className="font-mono font-bold text-zinc-900">{selectedReturn.orderNo}</span>
              </div>
              <div className="flex justify-between">
                <span className="font-bold text-zinc-500">Müşteri:</span>
                <span className="font-bold text-zinc-900">{selectedReturn.customerName}</span>
              </div>
              <div className="flex justify-between">
                <span className="font-bold text-zinc-500">İade Edilecek Ürün:</span>
                <span className="font-bold text-zinc-900">{selectedReturn.productName}</span>
              </div>
              <div className="flex justify-between">
                <span className="font-bold text-zinc-500">İade Nedeni:</span>
                <span className="font-bold text-rose-600 bg-rose-50 px-2 py-0.5 rounded-lg border border-rose-100">{selectedReturn.reason}</span>
              </div>
              <div className="flex justify-between pt-1 border-t border-zinc-100 text-sm font-bold">
                <span className="text-zinc-900">İade Tutarı:</span>
                <span className="text-[#df0000]">{selectedReturn.amount.toLocaleString('tr-TR')} ₺</span>
              </div>
            </div>

            <hr className="border-zinc-150" />

            <div className="space-y-4">
              <span className="text-[9px] font-extrabold text-zinc-400 uppercase tracking-wider block">Yönetici Kararı</span>
              
              <div className="flex gap-4">
                <label className="flex-1 flex items-center gap-2.5 p-3.5 border border-zinc-200 rounded-2xl cursor-pointer hover:bg-zinc-50">
                  <input
                    type="radio"
                    name="decision"
                    checked={adminDecision === 'Approved'}
                    onChange={() => setAdminDecision('Approved')}
                    className="accent-[#df0000]"
                  />
                  <span className="text-xs font-bold text-zinc-700">Talebi Onayla</span>
                </label>
                <label className="flex-1 flex items-center gap-2.5 p-3.5 border border-zinc-200 rounded-2xl cursor-pointer hover:bg-zinc-50">
                  <input
                    type="radio"
                    name="decision"
                    checked={adminDecision === 'Rejected'}
                    onChange={() => setAdminDecision('Rejected')}
                    className="accent-[#df0000]"
                  />
                  <span className="text-xs font-bold text-zinc-700">Talebi Reddet</span>
                </label>
              </div>

              {adminDecision === 'Approved' && (
                <div className="space-y-1.5">
                  <label className="text-[10px] font-extrabold tracking-wider text-zinc-400 uppercase">Geri Ödeme Yöntemi</label>
                  <select
                    value={refundMethod}
                    onChange={(e) => setRefundMethod(e.target.value)}
                    className="w-full h-11 px-4 border border-zinc-200 rounded-2xl text-xs font-semibold text-zinc-700 bg-white outline-none"
                  >
                    <option value="StoreCredit">Cüzdan / Alışveriş Kredisi (Anında)</option>
                    <option value="OriginalMethod">Orijinal Ödeme Yöntemi (Sanal POS)</option>
                  </select>
                </div>
              )}

              <div className="space-y-1.5">
                <label className="text-[10px] font-extrabold tracking-wider text-zinc-400 uppercase">Müşteriye Gönderilecek Not</label>
                <textarea
                  value={adminNote}
                  onChange={(e) => setAdminNote(e.target.value)}
                  placeholder="İade karar gerekçesini girin..."
                  rows={3}
                  className="w-full border border-zinc-200 rounded-2xl p-3.5 text-xs font-semibold text-zinc-700 outline-none"
                />
              </div>

              <Button
                type="button"
                variant="primary"
                onClick={handleDecisionSave}
                className="w-full rounded-2xl bg-[#df0000] hover:bg-[#c00000] active:scale-95 py-3 h-11 font-bold"
              >
                Kaydet & Müşteriyi Bilgilendir
              </Button>
            </div>
          </aside>
        )}
      </div>
    </AdminLayout>
  )
}
