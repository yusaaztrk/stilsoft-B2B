import { useCallback, useEffect, useMemo, useState } from 'react'
import { Download, Plus, Search, Filter, RefreshCw, FileText, Check, Truck, Clock, PackageCheck, Eye, Edit, X, Printer } from 'lucide-react'
import PhoneLinks from '../components/PhoneLinks'
import { printCargoSlip } from '../print/cargoSlip'
import { apiJson } from '../api/client'
import { useSignalREvent } from '../hooks/useSignalR'
import { useTechnicians } from '../hooks/useTechnicians'
import Table, { type TableColumn } from '../components/Table'
import { toast } from 'sonner'

type CargoStatus = 0 | 1 | 2 | 3 | 4
const statusMap: Record<CargoStatus, { label: string; color: string }> = {
  0: { label: 'Siparişiniz Alındı', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' },
  1: { label: 'Planlandı', color: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400' },
  2: { label: 'Hazırlanıyor', color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
  3: { label: 'Dağıtımda', color: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' },
  4: { label: 'Teslim Edildi', color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' },
}

interface CargoTask {
  id: string
  orderNumber: string
  productDetails: string
  customerName: string
  /** Kurye adrese yaklaşınca arayacak; e-ticaret siparişinden geliyor, elle de düzeltilebilir. */
  customerPhone?: string | null
  deliveryAddress: string
  orderDate: string
  assignedTechnicianId: string | null
  assignedTechnicianName: string | null
  status: CargoStatus
  plannedDate?: string
  historyJson?: string
  receiverName?: string
  deliveryProofPhotoUrl?: string
  latitude?: number
  longitude?: number
  createdAt?: string
  updatedAt?: string
}

interface OrderDetailLine {
  productId: string
  tenantCode: string
  productName: string
  unitPrice: number
  quantity: number
  lineTotal: number
}

interface EcommerceOrderDetail {
  id: string
  orderNo: string
  customerName: string
  email: string
  phone: string
  address: string
  status: string
  paymentStatus: string
  total: number
  couponCode?: string
  discountAmount: number
  createdAtUtc: string
  lines: OrderDetailLine[]
}

interface CombinedCargoDetail {
  cargo: CargoTask
  order?: EcommerceOrderDetail
}

function toTurkishUpper(val: string) {
  return val
    .replace(/i/g, 'İ')
    .replace(/ı/g, 'I')
    .toUpperCase()
}

export default function KargoKabulPage() {
  const { technicians } = useTechnicians()
  const [tasks, setTasks] = useState<CargoTask[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  
  // Filter States
  const [draftStatus, setDraftStatus] = useState<string>('')
  const [draftTechnicianId, setDraftTechnicianId] = useState<string>('')
  const [draftQ, setDraftQ] = useState<string>('')
  const [sortBy, setSortBy] = useState<string>('date-desc')
  const [showFiltersMobile, setShowFiltersMobile] = useState(false)

  // Create Modal
  const [createOpen, setCreateOpen] = useState(false)
  const [createLoading, setCreateLoading] = useState(false)
  const [orderNumber, setOrderNumber] = useState('')
  const [customerName, setCustomerName] = useState('')
  const [deliveryAddress, setDeliveryAddress] = useState('')
  const [productDetails, setProductDetails] = useState('')
  const [orderDate, setOrderDate] = useState(new Date().toISOString().slice(0, 10))
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionSuccess, setActionSuccess] = useState<string | null>(null)

  // Details Drawer
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [selectedRecord, setSelectedRecord] = useState<CargoTask | null>(null)
  const [infoLoading, setInfoLoading] = useState(false)
  const [infoData, setInfoData] = useState<CombinedCargoDetail | null>(null)
  const [isEditing, setIsEditing] = useState(false)
  const [editCustomerName, setEditCustomerName] = useState('')
  const [editDeliveryAddress, setEditDeliveryAddress] = useState('')
  const [editProductDetails, setEditProductDetails] = useState('')

  const fetchTasks = async () => {
    setIsLoading(true)
    try {
      const data = await apiJson<CargoTask[]>('/api/cargotracking')
      setTasks(data || [])
    } catch (err) {
      console.error('Error fetching cargo tasks', err)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    fetchTasks()
  }, [])

  // Filter & Sort
  const filteredTasks = useMemo(() => {
    let result = tasks.map(t => {
      const startStr = t.orderDate
      if (!startStr) return { ...t, elapsedDays: 0 }
      const isCompleted = t.status === 4
      const anyT = t as any
      const endStr = isCompleted 
        ? (anyT.completedAt || anyT.CompletedAt || anyT.updatedAt || anyT.UpdatedAt) 
        : null
      const startDate = new Date(startStr)
      const endDate = endStr ? new Date(endStr) : new Date()
      const diffTime = endDate.getTime() - startDate.getTime()
      const diffDays = Math.max(0, Math.floor(diffTime / (1000 * 60 * 60 * 24)))
      return { ...t, elapsedDays: diffDays }
    })
    if (draftStatus !== '') {
      result = result.filter(t => t.status === Number(draftStatus))
    }
    if (draftTechnicianId !== '') {
      result = result.filter(t => t.assignedTechnicianId === draftTechnicianId)
    }
    if (draftQ.trim() !== '') {
      const qLower = draftQ.toLowerCase()
      result = result.filter(t => 
        t.orderNumber.toLowerCase().includes(qLower) ||
        t.customerName.toLowerCase().includes(qLower) ||
        t.productDetails.toLowerCase().includes(qLower) ||
        t.deliveryAddress.toLowerCase().includes(qLower)
      )
    }

    result.sort((a, b) => {
      if (sortBy === 'date-desc') {
        return new Date(b.orderDate).getTime() - new Date(a.orderDate).getTime()
      }
      if (sortBy === 'date-asc') {
        return new Date(a.orderDate).getTime() - new Date(b.orderDate).getTime()
      }
      if (sortBy === 'name-asc') {
        return (a.customerName || '').localeCompare(b.customerName || '', 'tr')
      }
      if (sortBy === 'name-desc') {
        return (b.customerName || '').localeCompare(a.customerName || '', 'tr')
      }
      return 0
    })

    return result
  }, [tasks, draftStatus, draftTechnicianId, draftQ, sortBy])

  useSignalREvent('cargo_updated', useCallback(() => { fetchTasks() }, []))

  const handleExportCsv = useCallback(() => {
    const recordsToExport = selectedIds.length > 0 
      ? tasks.filter(t => selectedIds.includes(t.id))
      : filteredTasks

    const headers = ['Sipariş No', 'Müşteri', 'Adres', 'Ürünler', 'Tarih', 'Kurye', 'Durum']
    const escape = (v: any) => {
      const s = String(v ?? '')
      return /[\n\r",;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }
    const lines = [headers.join(';')]
    for (const r of recordsToExport) {
      lines.push([
        r.orderNumber,
        r.customerName,
        r.deliveryAddress,
        r.productDetails,
        new Date(r.orderDate || '').toLocaleDateString('tr-TR'),
        r.assignedTechnicianName ?? 'Atanmamış',
        statusMap[r.status]?.label ?? 'Bilinmiyor'
      ].map(escape).join(';'))
    }
    const blob = new Blob([`\ufeff${lines.join('\n')}`], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `kargo-kabul-listesi-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }, [tasks, selectedIds, filteredTasks])

  // Shell Event Listeners
  useEffect(() => {
    const handleExport = () => handleExportCsv()
    const handleNew = () => {
      setActionError(null)
      setActionSuccess(null)
      resetCreateForm()
      setCreateOpen(true)
    }

    window.addEventListener('shell:kargo-kabul-export', handleExport)
    window.addEventListener('shell:kargo-kabul-new', handleNew)

    return () => {
      window.removeEventListener('shell:kargo-kabul-export', handleExport)
      window.removeEventListener('shell:kargo-kabul-new', handleNew)
    }
  }, [handleExportCsv])

  const resetCreateForm = () => {
    setOrderNumber('')
    setCustomerName('')
    setDeliveryAddress('')
    setProductDetails('')
    setOrderDate(new Date().toISOString().slice(0, 10))
  }

  const handleCreateCargo = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!orderNumber || !customerName || !deliveryAddress || !productDetails) {
      setActionError('Lütfen tüm zorunlu alanları doldurun.')
      return
    }

    setCreateLoading(true)
    setActionError(null)
    try {
      await apiJson('/api/cargotracking', {
        method: 'POST',
        body: JSON.stringify({
          orderNumber: orderNumber.trim(),
          customerName: customerName.trim(),
          deliveryAddress: deliveryAddress.trim(),
          productDetails: productDetails.trim(),
          orderDate: new Date(orderDate).toISOString(),
        }),
        headers: { 'Content-Type': 'application/json' }
      })
      setActionSuccess('Kargo kaydı başarıyla oluşturuldu.')
      setCreateOpen(false)
      resetCreateForm()
      fetchTasks()
    } catch (err: any) {
      setActionError(err.message || 'Kayıt oluşturulurken bir hata oluştu.')
    } finally {
      setCreateLoading(false)
    }
  }

  const openDetail = async (record: CargoTask) => {
    setSelectedRecord(record)
    setDrawerOpen(true)
    setIsEditing(false)
    setInfoLoading(true)
    setInfoData(null)
    try {
      const data = await apiJson<CombinedCargoDetail>(`/api/cargotracking/${record.id}/details`)
      setInfoData(data)
      setEditCustomerName(data.cargo.customerName)
      setEditDeliveryAddress(data.cargo.deliveryAddress)
      setEditProductDetails(data.cargo.productDetails)
    } catch (err) {
      console.error('Error fetching details', err)
    } finally {
      setInfoLoading(false)
    }
  }

  const handleUpdateDetails = async () => {
    if (!selectedRecord) return
    setInfoLoading(true)
    try {
      await apiJson(`/api/cargotracking/${selectedRecord.id}/details`, {
        method: 'PUT',
        body: JSON.stringify({
          customerName: editCustomerName.trim(),
          deliveryAddress: editDeliveryAddress.trim(),
          productDetails: editProductDetails.trim(),
        }),
        headers: { 'Content-Type': 'application/json' }
      })
      setIsEditing(false)
      // Refetch
      const data = await apiJson<CombinedCargoDetail>(`/api/cargotracking/${selectedRecord.id}/details`)
      setInfoData(data)
      fetchTasks()
    } catch (err) {
      console.error('Error updating details', err)
      toast.error('Güncellenirken bir hata oluştu.')
    } finally {
      setInfoLoading(false)
    }
  }



  const columns = useMemo<TableColumn<CargoTask>[]>(() => {
    return [
      {
        key: 'id' as any,
        label: '',
        render: (_val: any, row: CargoTask) => (
          <div className="flex justify-center items-center h-full">
            <input
              type="checkbox"
              checked={selectedIds.includes(row.id)}
              onChange={(e) => {
                if (e.target.checked) {
                  setSelectedIds(prev => [...prev, row.id])
                } else {
                  setSelectedIds(prev => prev.filter(id => id !== row.id))
                }
              }}
              className="rounded border-gray-300 text-[#B91C1C] focus:ring-[#B91C1C]"
            />
          </div>
        )
      },
      {
        key: 'elapsedDays' as any,
        label: 'GEÇEN GÜN',
        sortable: true,
        searchable: false,
        render: (_v: any, row: any) => {
          const diffDays = row.elapsedDays || 0
          let bgClass = 'bg-emerald-50 text-emerald-700 border-emerald-200'
          if (diffDays >= 15 && diffDays < 30) {
            bgClass = 'bg-amber-50 text-amber-700 border-amber-200'
          } else if (diffDays >= 30) {
            bgClass = 'bg-rose-50 text-rose-700 border-rose-200 font-bold animate-pulse'
          } else if (diffDays > 5 && diffDays < 15) {
            bgClass = 'bg-emerald-50/70 text-emerald-800 border-emerald-150'
          }
          return (
            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border ${bgClass}`}>
              {diffDays} Gün
            </span>
          )
        }
      },
      {
        key: 'orderNumber',
        label: 'SİPARİŞ NO',
        render: (val: any) => <span className="font-mono font-bold text-gray-900">{val}</span>
      },
      {
        key: 'customerName',
        label: 'MÜŞTERİ',
        render: (val: any) => <span className="font-bold text-gray-800">{val}</span>
      },
      {
        /*
          TELEFON (2026-09-10 kullanıcı isteği: "adamın telefon numarası da gelmesi lazımdı").

          Kurye listede yalnız ad ve adres görüyordu; müşteriye ulaşmak için siparişi ayrıca
          e-ticaret panelinden aratmak zorundaydı. `PhoneLinks` montaj ekranlarındaki bileşenin
          aynısı — arama ve WhatsApp kısayolu, numara biçimlendirmesi tek yerde.
        */
        key: 'customerPhone',
        label: 'TELEFON',
        render: (val: any) =>
          val ? <PhoneLinks phone={val} compact /> : <span className="text-gray-400 text-xs">—</span>
      },
      {
        key: 'productDetails',
        label: 'ÜRÜNLER',
        render: (val: any) => <span className="text-gray-600 line-clamp-1">{val}</span>
      },
      {
        key: 'deliveryAddress',
        label: 'ADRES',
        render: (val: any) => <span className="text-gray-500 line-clamp-1 text-xs">{val}</span>
      },
      {
        key: 'orderDate',
        label: 'SİPARİŞ TARİHİ',
        render: (val: any) => <span className="text-gray-600">{val ? new Date(val).toLocaleDateString('tr-TR') : ''}</span>
      },
      {
        key: 'assignedTechnicianName',
        label: 'KURYE',
        render: (val: any) => (
          <span className={`font-semibold ${val ? 'text-blue-600' : 'text-gray-400 italic'}`}>
            {val || 'Atanmamış'}
          </span>
        )
      },
      {
        key: 'status',
        label: 'DURUM',
        render: (val: any) => {
          const m = statusMap[val as CargoStatus] || { label: 'Bilinmiyor', color: 'bg-gray-150 text-gray-700' }
          return (
            <span className={`inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-bold ring-1 ring-inset ${m.color}`}>
              {m.label}
            </span>
          )
        }
      },
      {
        key: 'id' as any,
        label: 'İŞLEMLER',
        render: (_val: any, row: CargoTask) => (
          <div className="flex items-center gap-2">
            <button
              onClick={() => openDetail(row)}
              className="p-1 text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors cursor-pointer"
              title="Detayları Gör"
            >
              <Eye className="w-4 h-4" />
            </button>
            {/*
              TESLİMAT FİŞİ (2026-09-10 kullanıcı isteği: "burada da fiş yazdırma olması
              lazımdı tıpkı montajdaki gibi"). İki nüsha basılıyor — biri müşteride kalır,
              biri imzalı olarak kuryede döner.
            */}
            <button
              onClick={(e) => { e.stopPropagation(); printCargoSlip(row as any) }}
              className="p-1 text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors cursor-pointer"
              title="Teslimat Fişi Yazdır"
            >
              <Printer className="w-4 h-4" />
            </button>
          </div>
        )
      }
    ]
  }, [selectedIds])

  return (
    <>
      {/* Glued Double-Header Filters Bar */}
      <div className="hidden lg:flex bg-white border-b border-gray-200 px-6 py-2.5 mb-0 flex-wrap lg:flex-nowrap items-end gap-2 shadow-xs sticky top-0 z-30">
        <div className="flex flex-col gap-0.5 flex-1 min-w-[100px] lg:min-w-0">
          <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Durum</label>
          <select
            value={draftStatus}
            onChange={(e) => setDraftStatus(e.target.value)}
            className="px-2 py-1 bg-slate-50 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-[#B91C1C] w-full"
          >
            <option value="">Tüm Durumlar</option>
            <option value="0">Sipariş Alındı</option>
            <option value="1">Planlandı</option>
            <option value="2">Hazırlanıyor</option>
            <option value="3">Dağıtımda</option>
            <option value="4">Teslim Edildi</option>
          </select>
        </div>

        <div className="flex flex-col gap-0.5 flex-1 min-w-[110px] lg:min-w-0">
          <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Kurye/Sürücü</label>
          <select
            value={draftTechnicianId}
            onChange={(e) => setDraftTechnicianId(e.target.value)}
            className="px-2 py-1 bg-slate-50 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-[#B91C1C] w-full"
          >
            <option value="">Tüm Kuryeler</option>
            {technicians.map(t => (
              <option key={t.id} value={t.id}>{t.fullName}</option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-0.5 flex-1 min-w-[150px] lg:min-w-0">
          <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Arama</label>
          <input
            type="text"
            value={draftQ}
            onChange={(e) => setDraftQ(toTurkishUpper(e.target.value))}
            placeholder="Sipariş No, Müşteri, Ürün veya Adres"
            className="px-2 py-1 bg-slate-50 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-[#B91C1C] w-full"
          />
        </div>

        <div className="flex flex-col gap-0.5 flex-1 min-w-[100px] lg:min-w-0">
          <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Sıralama</label>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="px-2 py-1 bg-slate-50 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-[#B91C1C] w-full"
          >
            <option value="date-desc">Sipariş Tarihi (Yeniye)</option>
            <option value="date-asc">Sipariş Tarihi (Eskiye)</option>
            <option value="name-asc">Müşteri Adı (A-Z)</option>
            <option value="name-desc">Müşteri Adı (Z-A)</option>
          </select>
        </div>

        {selectedIds.length > 0 && (
          <button
            onClick={() => setSelectedIds([])}
            className="px-3 py-1 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold rounded-lg text-xs transition border border-gray-200 cursor-pointer whitespace-nowrap active:scale-95"
          >
            Seçimi Temizle ({selectedIds.length})
          </button>
        )}

        <button
          onClick={() => {
            setDraftStatus('')
            setDraftTechnicianId('')
            setDraftQ('')
            setSortBy('date-desc')
          }}
          className="px-3 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-lg text-xs transition border border-gray-200 cursor-pointer whitespace-nowrap active:scale-95"
        >
          Temizle
        </button>

        <button
          onClick={handleExportCsv}
          className="px-3 py-1 bg-[#B91C1C] hover:bg-[#991B1B] text-white font-bold rounded-lg text-xs transition shadow-sm cursor-pointer whitespace-nowrap active:scale-95 flex items-center gap-1"
        >
          <Download className="w-3.5 h-3.5" />
          {selectedIds.length > 0 ? 'Seçilenleri Excel\'e Aktar' : 'Dışa Aktar'}
        </button>
      </div>

      <div className="p-4 lg:p-6 flex flex-col gap-4">
        {actionSuccess && (
          <div className="rounded-xl bg-green-50 border border-green-200 px-4 py-3 text-xs font-semibold text-green-700">{actionSuccess}</div>
        )}
        {actionError && (
          <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-xs font-semibold text-red-600">{actionError}</div>
        )}

        {/* Table */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-visible relative">
          {isLoading && filteredTasks.length === 0 ? (
            <div className="py-8 text-center text-sm text-gray-500">Yükleniyor...</div>
          ) : filteredTasks.length === 0 ? (
            <div className="py-8 text-center text-sm text-gray-500">Kayıt bulunamadı.</div>
          ) : (
            <Table
              columns={columns}
              data={filteredTasks}
              showColumnFilters
              rowKey={(r: CargoTask) => r.id}
              rowClassName={(row: CargoTask) => selectedIds.includes(row.id) ? 'bg-[#B91C1C]/5' : ''}
            />
          )}
        </div>
      </div>

      {/* Create Cargo Modal */}
      {createOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden font-sans border border-gray-100 animate-in zoom-in-95 duration-200">
            <div className="px-6 py-4 bg-gray-50 border-b border-gray-150 flex items-center justify-between">
              <h3 className="font-bold text-gray-800 text-sm uppercase tracking-wider">Yeni Kargo Kaydı Oluştur</h3>
              <button onClick={() => setCreateOpen(false)} className="text-gray-400 hover:text-gray-600 p-1 hover:bg-gray-150 rounded-lg">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleCreateCargo} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Sipariş No</label>
                <input
                  type="text"
                  required
                  placeholder="Sipariş numarası giriniz..."
                  value={orderNumber}
                  onChange={(e) => setOrderNumber(toTurkishUpper(e.target.value))}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#B91C1C]/20"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Müşteri Adı</label>
                <input
                  type="text"
                  required
                  placeholder="Alıcı / müşteri adını giriniz..."
                  value={customerName}
                  onChange={(e) => setCustomerName(toTurkishUpper(e.target.value))}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#B91C1C]/20"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Teslimat Adresi</label>
                <textarea
                  required
                  rows={2}
                  placeholder="Tam teslimat adresi giriniz..."
                  value={deliveryAddress}
                  onChange={(e) => setDeliveryAddress(toTurkishUpper(e.target.value))}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#B91C1C]/20"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Ürün Detayları</label>
                <input
                  type="text"
                  required
                  placeholder="Paket içeriği / ürün detayları..."
                  value={productDetails}
                  onChange={(e) => setProductDetails(toTurkishUpper(e.target.value))}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#B91C1C]/20"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Sipariş Tarihi</label>
                <input
                  type="date"
                  required
                  value={orderDate}
                  onChange={(e) => setOrderDate(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#B91C1C]/20"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setCreateOpen(false)}
                  className="px-4 py-2 border border-gray-250 rounded-xl text-xs font-bold text-gray-700 hover:bg-gray-50 transition-colors shadow-sm cursor-pointer"
                >
                  Vazgeç
                </button>
                <button
                  type="submit"
                  disabled={createLoading}
                  className="px-4 py-2 bg-[#B91C1C] hover:bg-[#991B1B] text-white rounded-xl text-xs font-bold shadow-sm transition-colors cursor-pointer"
                >
                  {createLoading ? 'Kaydediliyor...' : 'Oluştur'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Details Drawer */}
      {drawerOpen && selectedRecord && (
        <>
          <div className="fixed inset-0 bg-black/30 z-40" onClick={() => setDrawerOpen(false)} />
          <div className="fixed inset-y-0 right-0 w-full sm:w-[480px] bg-white shadow-2xl z-50 flex flex-col font-sans border-l border-gray-100 animate-in slide-in-from-right duration-250">
            {/* Header */}
            <div className="p-4 bg-gray-50 border-b border-gray-150 flex items-center justify-between shrink-0">
              <div>
                <div className="text-xs font-extrabold text-gray-400 uppercase tracking-widest leading-none">Kargo Detayı</div>
                <div className="text-sm font-bold text-gray-900 mt-1 flex items-center gap-2">
                  <Truck className="w-4 h-4 text-[#B91C1C]" />
                  <span>{selectedRecord.orderNumber}</span>
                </div>
              </div>
              <button onClick={() => setDrawerOpen(false)} className="p-1.5 hover:bg-gray-150 rounded-lg text-gray-500 hover:text-gray-800 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-6">
              {infoLoading ? (
                <div className="py-12 text-center text-sm text-gray-500">Yükleniyor...</div>
              ) : (
                <>
                  {/* Status Progress */}
                  <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                    <div className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">Sevkiyat Durumu</div>
                    <div className="flex items-center gap-3">
                      <span className={`inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-bold ring-1 ring-inset ${statusMap[selectedRecord.status]?.color}`}>
                        {statusMap[selectedRecord.status]?.label}
                      </span>
                      {selectedRecord.assignedTechnicianName && (
                        <div className="text-xs font-semibold text-gray-600">
                          Kurye: <span className="font-bold text-blue-600">{selectedRecord.assignedTechnicianName}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Cargo Fields Form / Details */}
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="text-xs font-bold text-gray-500 uppercase tracking-wider">Kargo Bilgileri</div>
                      {!isEditing && (
                        <button
                          onClick={() => setIsEditing(true)}
                          className="flex items-center gap-1 text-xs font-bold text-[#B91C1C] hover:text-[#991B1B] cursor-pointer"
                        >
                          <Edit className="w-3.5 h-3.5" />
                          Düzenle
                        </button>
                      )}
                    </div>

                    {isEditing ? (
                      <div className="space-y-3 p-4 bg-gray-50 rounded-xl border border-gray-150">
                        <div>
                          <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Müşteri Adı</label>
                          <input
                            type="text"
                            value={editCustomerName}
                            onChange={(e) => setEditCustomerName(toTurkishUpper(e.target.value))}
                            className="w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs focus:ring-1 focus:ring-[#B91C1C]/25"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Teslimat Adresi</label>
                          <textarea
                            rows={2}
                            value={editDeliveryAddress}
                            onChange={(e) => setEditDeliveryAddress(toTurkishUpper(e.target.value))}
                            className="w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs focus:ring-1 focus:ring-[#B91C1C]/25"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Ürün Detayları</label>
                          <input
                            type="text"
                            value={editProductDetails}
                            onChange={(e) => setEditProductDetails(toTurkishUpper(e.target.value))}
                            className="w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs focus:ring-1 focus:ring-[#B91C1C]/25"
                          />
                        </div>
                        <div className="flex justify-end gap-1.5 pt-2">
                          <button
                            onClick={() => setIsEditing(false)}
                            className="px-3 py-1 bg-white border border-gray-200 rounded-lg text-[11px] font-bold text-gray-700 hover:bg-gray-50"
                          >
                            İptal
                          </button>
                          <button
                            onClick={handleUpdateDetails}
                            className="px-3 py-1 bg-[#B91C1C] hover:bg-[#991B1B] text-white rounded-lg text-[11px] font-bold"
                          >
                            Kaydet
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="divide-y divide-gray-100">
                        <div className="py-2.5 flex justify-between gap-4">
                          <span className="text-xs font-semibold text-gray-400 shrink-0">Alıcı Müşteri</span>
                          <span className="text-xs font-bold text-gray-800 text-right">{selectedRecord.customerName}</span>
                        </div>
                        <div className="py-2.5 flex justify-between gap-4">
                          <span className="text-xs font-semibold text-gray-400 shrink-0">Teslimat Adresi</span>
                          <span className="text-xs font-semibold text-gray-700 text-right max-w-[280px]">
                            <a
                              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(selectedRecord.deliveryAddress)}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-600 hover:underline"
                            >
                              {selectedRecord.deliveryAddress}
                            </a>
                          </span>
                        </div>
                        <div className="py-2.5 flex justify-between gap-4">
                          <span className="text-xs font-semibold text-gray-400 shrink-0">Paket İçeriği</span>
                          <span className="text-xs font-semibold text-gray-700 text-right max-w-[280px]">{selectedRecord.productDetails}</span>
                        </div>
                        <div className="py-2.5 flex justify-between gap-4">
                          <span className="text-xs font-semibold text-gray-400 shrink-0">Sipariş Tarihi</span>
                          <span className="text-xs font-bold text-gray-800">{new Date(selectedRecord.orderDate || '').toLocaleDateString('tr-TR')}</span>
                        </div>
                        {selectedRecord.plannedDate && (
                          <div className="py-2.5 flex justify-between gap-4">
                            <span className="text-xs font-semibold text-gray-400 shrink-0">Planlanan Teslimat</span>
                            <span className="text-xs font-bold text-blue-600">{new Date(selectedRecord.plannedDate).toLocaleDateString('tr-TR')}</span>
                          </div>
                        )}
                        {selectedRecord.receiverName && (
                          <div className="py-2.5 flex justify-between gap-4">
                            <span className="text-xs font-semibold text-gray-400 shrink-0">Teslim Alan</span>
                            <span className="text-xs font-bold text-green-600">{selectedRecord.receiverName}</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* E-commerce Order Detail lines */}
                  {infoData?.order && (
                    <div className="space-y-3">
                      <div className="text-xs font-bold text-gray-500 uppercase tracking-wider">E-Ticaret Sipariş Kalemleri</div>
                      <div className="bg-slate-50 border border-slate-150 rounded-xl overflow-hidden">
                        <table className="w-full text-xs text-left mobile-stack">
                          <thead className="bg-slate-100 text-slate-700 border-b border-slate-150">
                            <tr>
                              <th className="p-2 font-bold">Ürün</th>
                              <th className="p-2 font-bold text-center">Adet</th>
                              <th className="p-2 font-bold text-right">Fiyat</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 text-slate-600">
                            {infoData.order.lines?.map((line, idx) => (
                              <tr key={idx} className="hover:bg-slate-50/50">
                                <td data-label="Ürün" className="p-2 font-semibold text-slate-700">{line.productName}</td>
                                <td data-label="Adet" className="p-2 text-center font-bold">{line.quantity}</td>
                                <td data-label="Fiyat" className="p-2 text-right font-mono font-semibold">₺{line.unitPrice.toLocaleString('tr-TR')}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Shipment Status Log / History */}
                  <div className="space-y-4">
                    <div className="text-xs font-bold text-gray-500 uppercase tracking-wider">Gönderi Günlüğü</div>
                    <div className="relative border-l border-gray-150 ml-2.5 pl-4 space-y-5 py-1">
                      {(() => {
                        let history: any[] = []
                        if (selectedRecord.historyJson) {
                          try {
                            const parsed = JSON.parse(selectedRecord.historyJson)
                            if (Array.isArray(parsed)) history = parsed
                          } catch {}
                        }
                        if (history.length === 0) {
                          return <div className="text-xs text-gray-400 italic">Kayıt günlüğü bulunamadı.</div>
                        }
                        return history.map((entry, idx) => {
                          const status = entry.status ?? entry.Status
                          const statusLabel = entry.statusLabel ?? entry.StatusLabel
                          const timestamp = entry.timestamp ?? entry.Timestamp
                          const actor = entry.actor ?? entry.Actor
                          const detail = entry.detail ?? entry.Detail
                          return (
                            <div key={idx} className="relative">
                              <div className={`absolute -left-[22px] top-0.5 w-3 h-3 rounded-full border-2 border-white shadow-xs ${
                                status === 4 ? 'bg-green-500' : status === 3 ? 'bg-orange-500' : 'bg-[#B91C1C]'
                              }`} />
                              <div>
                                <div className="flex items-center gap-1.5">
                                  <span className="font-extrabold text-xs text-gray-800">{statusLabel}</span>
                                  <span className="text-[10px] text-gray-400 font-semibold">{new Date(timestamp || '').toLocaleDateString('tr-TR')} {new Date(timestamp || '').toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}</span>
                                </div>
                                <div className="text-[11px] text-gray-500 font-medium mt-0.5">İşlem Yapan: <span className="font-bold">{actor}</span></div>
                                {detail && <div className="text-[10px] text-gray-400 mt-1 italic">{detail}</div>}
                              </div>
                            </div>
                          )
                        })
                      })()}
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Footer */}
            <div className="p-3 bg-gray-50 border-t border-gray-150 flex justify-end shrink-0">
              <button
                onClick={() => setDrawerOpen(false)}
                className="px-4 py-2 bg-white border border-gray-250 rounded-xl text-xs font-bold text-gray-700 hover:bg-gray-50 transition-colors shadow-sm cursor-pointer"
              >
                Kapat
              </button>
            </div>
          </div>
        </>
      )}

      {/* Mobile slide-over filter modal */}
      {showFiltersMobile && (
        <div className="fixed inset-0 z-50 flex justify-end animate-in fade-in duration-150">
          {/* Backdrop */}
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-xs" onClick={() => setShowFiltersMobile(false)} />
          {/* Drawer content */}
          <div className="relative w-full max-w-[300px] bg-white h-full flex flex-col shadow-2xl p-4 overflow-y-auto z-10 animate-in slide-in-from-right duration-200">
            <div className="flex justify-between items-center pb-3 border-b border-slate-100 mb-4">
              <span className="font-bold text-sm text-slate-800">Filtrele</span>
              <button onClick={() => setShowFiltersMobile(false)} className="p-1 hover:bg-slate-100 rounded-lg text-slate-400">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="space-y-4">
              {/* Durum */}
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Durum</label>
                <select
                  value={draftStatus}
                  onChange={(e) => setDraftStatus(e.target.value)}
                  className="px-3 py-2 bg-slate-50 border border-gray-200 rounded-xl text-xs focus:outline-none focus:ring-1 focus:ring-[#B91C1C] w-full"
                >
                  <option value="">Tüm Durumlar</option>
                  <option value="0">Sipariş Alındı</option>
                  <option value="1">Planlandı</option>
                  <option value="2">Hazırlanıyor</option>
                  <option value="3">Dağıtımda</option>
                  <option value="4">Teslim Edildi</option>
                </select>
              </div>

              {/* Kurye/Sürücü */}
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Kurye/Sürücü</label>
                <select
                  value={draftTechnicianId}
                  onChange={(e) => setDraftTechnicianId(e.target.value)}
                  className="px-3 py-2 bg-slate-50 border border-gray-200 rounded-xl text-xs focus:outline-none focus:ring-1 focus:ring-[#B91C1C] w-full"
                >
                  <option value="">Tüm Kuryeler</option>
                  {technicians.map(t => (
                    <option key={t.id} value={t.id}>{t.fullName}</option>
                  ))}
                </select>
              </div>

              {/* Arama */}
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Arama</label>
                <input
                  type="text"
                  value={draftQ}
                  onChange={(e) => setDraftQ(toTurkishUpper(e.target.value))}
                  placeholder="Sipariş No, Müşteri, Ürün veya Adres"
                  className="px-3 py-2 bg-slate-50 border border-gray-200 rounded-xl text-xs focus:outline-none focus:ring-1 focus:ring-[#B91C1C] w-full"
                />
              </div>

              {/* Sıralama */}
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Sıralama</label>
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value)}
                  className="px-3 py-2 bg-slate-50 border border-gray-200 rounded-xl text-xs focus:outline-none focus:ring-1 focus:ring-[#B91C1C] w-full"
                >
                  <option value="date-desc">Sipariş Tarihi (Yeniye)</option>
                  <option value="date-asc">Sipariş Tarihi (Eskiye)</option>
                  <option value="name-asc">Müşteri Adı (A-Z)</option>
                  <option value="name-desc">Müşteri Adı (Z-A)</option>
                </select>
              </div>
            </div>

            {/* Actions */}
            <div className="mt-6 pt-4 border-t border-slate-100 flex gap-2">
              <button
                onClick={() => {
                  setDraftStatus('')
                  setDraftTechnicianId('')
                  setDraftQ('')
                  setSortBy('date-desc')
                }}
                className="flex-1 py-2 px-3 border border-slate-200 text-slate-650 hover:text-slate-800 rounded-xl text-xs font-bold transition-colors cursor-pointer text-center bg-white hover:bg-slate-50 active:scale-95"
              >
                Sıfırla
              </button>
              <button
                onClick={() => setShowFiltersMobile(false)}
                className="flex-1 py-2 px-3 bg-[#B91C1C] hover:bg-[#991B1B] text-white rounded-xl text-xs font-bold transition-colors cursor-pointer text-center shadow-xs active:scale-95"
              >
                Uygula
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
