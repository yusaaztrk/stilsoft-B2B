import { useEffect, useMemo, useState } from 'react'
import { AdminLayout } from '../components/admin/AdminLayout'
import { Icon } from '../components/Icon'
import { getAdminToken, readApiResponse } from '../lib/api'

type OrderRow = {
  id: string
  orderNo: string
  createdAtUtc: string
  customerName: string
  email: string
  total: number
  status: string
  paymentStatus: string
  lines: Array<{ productName: string; quantity: number; lineTotal: number }>
}

export function AdminOrdersPage() {
  const [q, setQ] = useState('')
  const [rows, setRows] = useState<OrderRow[]>([])
  const [loading, setLoading] = useState(false)
  const [expandedOrders, setExpandedOrders] = useState<Record<string, boolean>>({})

  const toggleExpand = (id: string) => {
    setExpandedOrders((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  async function load() {
    setLoading(true)
    try {
      const res = await fetch('/api/orders', { headers: { Authorization: `Bearer ${getAdminToken()}` } })
      const json = await readApiResponse(res)
      if (res.ok && Array.isArray(json?.data)) setRows(json.data)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return rows
    return rows.filter((r) => `${r.orderNo} ${r.customerName} ${r.email} ${r.status}`.toLowerCase().includes(s))
  }, [q, rows])

  const totalRevenue = rows.reduce((sum, x) => sum + x.total, 0)

  const getStatusColorClass = (status: string) => {
    const s = (status || '').toUpperCase()
    if (s === 'NEW' || s === 'SİPARİŞİNİZ ALINDI') return 'border-blue-200 bg-blue-50/50 text-blue-700'
    if (s === 'PLANLANDI') return 'border-indigo-200 bg-indigo-50/50 text-indigo-700'
    if (s === 'PROCESSING' || s === 'HAZIRLANIYOR') return 'border-amber-250 bg-amber-50/50 text-amber-700'
    if (s === 'SHIPPED' || s === 'KARGODA' || s === 'DAĞITIMDA') return 'border-orange-250 bg-orange-50/50 text-orange-700'
    if (s === 'DELIVERED' || s === 'COMPLETED' || s === 'TESLİM EDİLDİ' || s === 'TAMAMLANDI') return 'border-green-200 bg-green-50/50 text-green-700'
    if (s === 'CANCELLED' || s === 'İPTAL EDİLDİ') return 'border-rose-200 bg-rose-50/50 text-rose-700'
    return 'border-primary/20 bg-primary/5 text-primary'
  }

  const getStatusText = (status: string) => {
    const s = (status || '').toUpperCase()
    if (s === 'NEW' || s === 'SİPARİŞİNİZ ALINDI') return 'SİPARİŞİNİZ ALINDI'
    if (s === 'PLANLANDI') return 'PLANLANDI'
    if (s === 'PROCESSING' || s === 'HAZIRLANIYOR') return 'HAZIRLANIYOR'
    if (s === 'SHIPPED' || s === 'KARGODA' || s === 'DAĞITIMDA') return 'DAĞITIMDA / GÖNDERİLDİ'
    if (s === 'DELIVERED') return 'TESLİM EDİLDİ'
    if (s === 'COMPLETED') return 'TAMAMLANDI'
    if (s === 'CANCELLED' || s === 'İPTAL EDİLDİ') return 'İPTAL EDİLDİ'
    return status
  }

  const getPaymentStatusColorClass = (status: string) => {
    const s = (status || '').toUpperCase()
    if (s === 'PENDINGVIRTUALPOS') return 'border-amber-205 bg-amber-50/50 text-amber-700'
    if (s === 'PAID') return 'border-emerald-200 bg-emerald-50/50 text-emerald-700'
    if (s === 'PENDING') return 'border-zinc-250 bg-zinc-50/50 text-zinc-650'
    if (s === 'FAILED') return 'border-rose-200 bg-rose-50/50 text-rose-700'
    return 'border-zinc-200 bg-zinc-50/50 text-zinc-600'
  }

  const getPaymentStatusText = (status: string) => {
    const s = (status || '').toUpperCase()
    if (s === 'PENDINGVIRTUALPOS') return 'Sanal POS Bekliyor'
    if (s === 'PAID') return 'Ödendi'
    if (s === 'PENDING') return 'Beklemede'
    if (s === 'FAILED') return 'Başarısız'
    return status
  }

  return (
    <AdminLayout
      title="Siparişler"
      subtitle="Sanal POS bekleyen siparişler dahil tüm siparişleri yönetin."
      top={
        <div className="hidden items-center gap-3 rounded-2xl border border-zinc-200/80 bg-white px-4 py-2.5 text-sm text-zinc-700 shadow-[0_2px_8px_rgba(0,0,0,0.02)] focus-within:ring-4 focus-within:ring-[#df0000]/5 focus-within:border-[#df0000] md:flex md:w-[480px] transition-all duration-200">
          <Icon name="search" className="h-5 w-5 text-zinc-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Sipariş numarası, müşteri adı veya e-posta ile ara..."
            className="w-full bg-transparent text-sm text-zinc-900 placeholder:text-zinc-400 outline-none"
          />
        </div>
      }
    >
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: 'Toplam Sipariş', value: rows.length.toString(), icon: 'shopping_bag', color: 'text-zinc-650 bg-zinc-50 border-zinc-150' },
          { label: 'Yeni Siparişler', value: rows.filter((x) => (x.status || '').toUpperCase() === 'NEW').length.toString(), icon: 'new_releases', color: 'text-blue-600 bg-blue-50/50 border-blue-100' },
          { label: 'Ödeme Bekleyen', value: rows.filter((x) => (x.paymentStatus || '').toUpperCase() === 'PENDINGVIRTUALPOS').length.toString(), icon: 'hourglass_empty', color: 'text-amber-600 bg-amber-50/50 border-amber-100' },
          { label: 'Toplam Ciro', value: `${totalRevenue.toLocaleString('tr-TR')} TL`, icon: 'payments', color: 'text-green-600 bg-green-50/50 border-green-100' },
        ].map((item) => (
          <div key={item.label} className="rounded-3xl border border-zinc-200/85 bg-white p-5 shadow-[0_2px_8px_rgba(0,0,0,0.02),0_8px_20px_rgba(0,0,0,0.015)] transition-all duration-300 hover:shadow-md hover:border-zinc-350/80 hover:-translate-y-0.5">
            <div className="flex justify-between items-start">
              <span className="text-[11px] font-extrabold tracking-wider text-zinc-450 uppercase">{item.label}</span>
              <span className={`material-symbols-outlined text-[20px] p-2 rounded-2xl border ${item.color}`}>{item.icon}</span>
            </div>
            <div className="mt-2 text-2xl font-black tracking-tight text-zinc-900">{item.value}</div>
          </div>
        ))}
      </div>

      <div className="mt-6 overflow-hidden rounded-3xl border border-zinc-200/80 bg-white shadow-[0_2px_8px_rgba(0,0,0,0.02),0_8px_24px_rgba(0,0,0,0.02)]">
        <div className="grid grid-cols-12 gap-3 border-b border-zinc-200/80 bg-zinc-50/80 px-6 py-4 text-[10px] font-extrabold tracking-wider text-zinc-400 uppercase">
          <div className="col-span-1 text-center">Fatura</div>
          <div className="col-span-1 text-center">Detay</div>
          <div className="col-span-1">No</div>
          <div className="col-span-2">Tarih</div>
          <div className="col-span-3">Müşteri</div>
          <div className="col-span-2">Ödeme</div>
          <div className="col-span-1">Toplam</div>
          <div className="col-span-1 text-right">Durum</div>
        </div>
        <div className="divide-y divide-zinc-150/60">
          {filtered.map((r) => {
            const isExpanded = !!expandedOrders[r.id]
            return (
              <div key={r.id} className="transition-all">
                {/* Main Row */}
                <div className="grid grid-cols-12 gap-3 px-6 py-4 text-xs items-center transition duration-150 hover:bg-zinc-50/50">
                  <div className="col-span-1 flex items-center justify-center">
                    {(r.paymentStatus || '').toUpperCase() === 'PAID' ? (
                      <button
                        onClick={() => window.open(`/api/orders/${r.id}/invoice?token=${getAdminToken()}`, '_blank')}
                        className="w-7 h-7 rounded-lg hover:bg-zinc-100 flex items-center justify-center text-primary transition-all duration-200"
                        title="Fatura Önizle"
                      >
                        <span className="material-symbols-outlined text-[20px]">description</span>
                      </button>
                    ) : (
                      <span className="text-[10px] text-zinc-350 font-extrabold italic" title="Ödenmedi">-</span>
                    )}
                  </div>
                  <div className="col-span-1 flex items-center justify-center">
                    <button
                      onClick={() => toggleExpand(r.id)}
                      className="w-7 h-7 rounded-lg hover:bg-zinc-100 flex items-center justify-center text-zinc-500 transition-all duration-200"
                    >
                      <span
                        className="material-symbols-outlined text-[20px] transition-transform duration-200"
                        style={{ transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)' }}
                      >
                        chevron_right
                      </span>
                    </button>
                  </div>
                  <div className="col-span-1 font-mono font-bold text-zinc-700 flex items-center">{r.orderNo}</div>
                  <div className="col-span-2 text-zinc-500 font-medium flex items-center">{new Date(r.createdAtUtc).toLocaleString('tr-TR')}</div>
                  <div className="col-span-3 flex flex-col justify-center">
                    <div className="font-semibold text-zinc-900 text-[13px]">{r.customerName}</div>
                    <div className="text-[11px] text-zinc-450 font-medium">{r.email}</div>
                  </div>
                  <div className="col-span-2 flex items-center">
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold border uppercase tracking-wider ${
                      getPaymentStatusColorClass(r.paymentStatus)
                    }`}>
                      {getPaymentStatusText(r.paymentStatus)}
                    </span>
                  </div>
                  <div className="col-span-1 font-bold text-zinc-900 text-[13px] flex items-center">{r.total.toLocaleString('tr-TR')} TL</div>
                  <div className="col-span-1 flex items-center justify-end">
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold border uppercase tracking-wider ${
                      getStatusColorClass(r.status)
                    }`}>
                      {getStatusText(r.status)}
                    </span>
                  </div>
                </div>

                {/* Details Row */}
                {isExpanded && (
                  <div className="px-6 pb-4 pt-1 bg-zinc-50/40 border-t border-zinc-100 animate-in fade-in duration-200">
                    <div className="pl-10 space-y-2">
                      <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mt-2">Sipariş Edilen Ürünler</p>
                      <div className="space-y-1.5 max-w-3xl">
                        {r.lines?.map((line, idx) => (
                          <div key={idx} className="flex justify-between items-center text-xs py-2 px-3 bg-white border border-zinc-150 rounded-xl shadow-2xs">
                            <div className="flex items-center gap-3">
                              <span className="w-5 h-5 rounded-md bg-zinc-100 flex items-center justify-center text-zinc-500 text-[10px] font-bold font-mono">
                                {idx + 1}
                              </span>
                              <div>
                                <span className="font-bold text-zinc-855">{line.productName}</span>
                                <span className="text-zinc-450 font-semibold ml-2">x {line.quantity}</span>
                              </div>
                            </div>
                            <span className="font-extrabold text-zinc-700">
                              {Number(line.lineTotal || 0).toLocaleString('tr-TR')} TL
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
          {!loading && filtered.length === 0 ? (
            <div className="px-6 py-16 text-center text-zinc-400 font-medium italic bg-white">
              Sipariş bulunamadı.
            </div>
          ) : null}
        </div>
      </div>
    </AdminLayout>
  )
}
