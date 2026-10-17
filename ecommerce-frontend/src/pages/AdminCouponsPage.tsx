import { useEffect, useMemo, useState } from 'react'
import { AdminLayout } from '../components/admin/AdminLayout'
import { getAdminToken } from '../lib/api'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { useToast } from '../components/ui/ToastContext'
import { useConfirm } from '../components/ui/ConfirmContext'

type AssignedUser = {
  userId: string
  userEmail: string | null
  userFullName: string | null
}

type CouponItem = {
  id: string
  code: string
  userId: string | null
  userEmail: string | null
  userFullName: string | null
  discountType: 'Percentage' | 'FixedAmount'
  discountValue: number
  minOrderAmount: number
  maxDiscountAmount: number | null
  applicableProductId: string | null
  productName: string | null
  applicableCategoryId: string | null
  categoryName: string | null
  validFrom: string
  validUntil: string
  usageLimit: number
  usedCount: number
  isActive: boolean
  description: string | null
  createdAt: string
  assignedUsers?: AssignedUser[]
}

type CustomerItem = {
  id: string
  fullName: string
  email: string
}

type ProductItem = {
  id: string
  name: string
  stockCode: string
}

type CategoryItem = {
  id: string
  name: string
}

export function AdminCouponsPage() {
  const { showToast } = useToast()
  const confirm = useConfirm()
  const [coupons, setCoupons] = useState<CouponItem[]>([])
  const [customers, setCustomers] = useState<CustomerItem[]>([])
  const [products, setProducts] = useState<ProductItem[]>([])
  const [categories, setCategories] = useState<CategoryItem[]>([])
  const [loading, setLoading] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [editingCoupon, setEditingCoupon] = useState<CouponItem | null>(null)

  // Form State
  const [code, setCode] = useState('')
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([])
  const [showCustomerModal, setShowCustomerModal] = useState(false)
  const [customerSearchTerm, setCustomerSearchTerm] = useState('')
  const [discountType, setDiscountType] = useState<'Percentage' | 'FixedAmount'>('Percentage')
  const [discountValue, setDiscountValue] = useState<number>(10)
  const [minOrderAmount, setMinOrderAmount] = useState<number>(0)
  const [maxDiscountAmount, setMaxDiscountAmount] = useState<string>('')
  const [applicableProductId, setApplicableProductId] = useState<string>('')
  const [applicableCategoryId, setApplicableCategoryId] = useState<string>('')
  const [validFrom, setValidFrom] = useState('')
  const [validUntil, setValidUntil] = useState('')
  const [usageLimit, setUsageLimit] = useState<number>(1)
  const [isActive, setIsActive] = useState(true)
  const [description, setDescription] = useState('')

  // Filter customers for modal search
  const filteredCustomers = useMemo(() => {
    return customers.filter((c) => {
      const search = customerSearchTerm.toLowerCase()
      return (
        c.fullName.toLowerCase().includes(search) ||
        c.email.toLowerCase().includes(search)
      )
    })
  }, [customers, customerSearchTerm])

  const toggleCustomer = (id: string) => {
    setSelectedUserIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    )
  }

  const toggleAllCustomers = () => {
    if (selectedUserIds.length === customers.length) {
      setSelectedUserIds([])
    } else {
      setSelectedUserIds(customers.map((c) => c.id))
    }
  }

  const authHeader = useMemo(() => {
    const token = getAdminToken()
    return token ? { Authorization: `Bearer ${token}` } : null
  }, [])

  const fetchCoupons = async () => {
    if (!authHeader) return
    setLoading(true)
    try {
      const res = await fetch('/api/admin/modules/coupons', { headers: authHeader })
      const json = await res.json()
      if (res.ok && json?.success) {
        setCoupons(json.data || [])
      } else {
        showToast(json?.message || 'Kuponlar yüklenemedi.', 'error')
      }
    } catch (err) {
      showToast('Kuponlar yüklenirken bir bağlantı hatası oluştu.', 'error')
    } finally {
      setLoading(false)
    }
  }

  const fetchDependencies = async () => {
    if (!authHeader) return
    try {
      // 1. Fetch Customers
      const custRes = await fetch('/api/admin/customers', { headers: authHeader })
      const custJson = await custRes.json()
      if (custRes.ok && custJson.success) {
        setCustomers(custJson.data || [])
      }

      // 2. Fetch Products
      const prodRes = await fetch('/api/admin/products', { headers: authHeader })
      const prodJson = await prodRes.json()
      if (prodRes.ok && prodJson.success) {
        setProducts(prodJson.data || [])
      }

      // 3. Fetch Categories
      const catRes = await fetch('/api/admin/categories', { headers: authHeader })
      const catJson = await catRes.json()
      if (catRes.ok && catJson.success) {
        setCategories(catJson.data || [])
      }
    } catch (err) {
      console.error('Bağımlılıklar yüklenirken hata:', err)
    }
  }

  useEffect(() => {
    fetchCoupons()
    fetchDependencies()
  }, [authHeader])

  const generateRandomCode = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
    let result = 'ST-'
    for (let i = 0; i < 6; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length))
    }
    setCode(result)
  }

  const handleOpenAddModal = () => {
    setEditingCoupon(null)
    setCode('')
    setSelectedUserIds([])
    setDiscountType('Percentage')
    setDiscountValue(10)
    setMinOrderAmount(0)
    setMaxDiscountAmount('')
    setApplicableProductId('')
    setApplicableCategoryId('')
    
    // Set default dates (today to next month)
    const today = new Date()
    const nextMonth = new Date()
    nextMonth.setMonth(today.getMonth() + 1)
    
    setValidFrom(today.toISOString().split('T')[0] + 'T00:00')
    setValidUntil(nextMonth.toISOString().split('T')[0] + 'T23:59')
    setUsageLimit(1)
    setIsActive(true)
    setDescription('')
    
    setShowModal(true)
  }

  const handleOpenEditModal = (coupon: CouponItem) => {
    setEditingCoupon(coupon)
    setCode(coupon.code)
    const userIds = coupon.assignedUsers ? coupon.assignedUsers.map(u => u.userId) : (coupon.userId ? [coupon.userId] : [])
    setSelectedUserIds(userIds)
    setDiscountType(coupon.discountType)
    setDiscountValue(coupon.discountValue)
    setMinOrderAmount(coupon.minOrderAmount)
    setMaxDiscountAmount(coupon.maxDiscountAmount ? String(coupon.maxDiscountAmount) : '')
    setApplicableProductId(coupon.applicableProductId || '')
    setApplicableCategoryId(coupon.applicableCategoryId || '')
    
    // Format dates for input (datetime-local expects yyyy-MM-ddThh:mm)
    const formatToInputDate = (isoStr: string) => {
      const d = new Date(isoStr)
      const pad = (n: number) => String(n).padStart(2, '0')
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
    }

    setValidFrom(formatToInputDate(coupon.validFrom))
    setValidUntil(formatToInputDate(coupon.validUntil))
    setUsageLimit(coupon.usageLimit)
    setIsActive(coupon.isActive)
    setDescription(coupon.description || '')
    
    setShowModal(true)
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!authHeader) return
    if (!code.trim()) {
      showToast('Kupon kodu girilmelidir.', 'warning')
      return
    }

    const payload = {
      code: code.trim().toUpperCase(),
      userIds: selectedUserIds,
      discountType,
      discountValue: Number(discountValue),
      minOrderAmount: Number(minOrderAmount),
      maxDiscountAmount: maxDiscountAmount ? Number(maxDiscountAmount) : null,
      applicableProductId: applicableProductId ? applicableProductId : null,
      applicableCategoryId: applicableCategoryId ? applicableCategoryId : null,
      validFrom: new Date(validFrom).toISOString(),
      validUntil: new Date(validUntil).toISOString(),
      usageLimit: Number(usageLimit),
      isActive,
      description: description.trim() ? description.trim() : null
    }

    try {
      const url = editingCoupon 
        ? `/api/admin/modules/coupons/${editingCoupon.id}`
        : '/api/admin/modules/coupons'
      
      const method = editingCoupon ? 'PUT' : 'POST'

      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...authHeader
        },
        body: JSON.stringify(payload)
      })

      const json = await res.json()
      if (res.ok && json.success) {
        showToast(editingCoupon ? 'Kupon başarıyla güncellendi.' : 'Kupon başarıyla oluşturuldu.', 'success')
        setShowModal(false)
        fetchCoupons()
      } else {
        showToast(json.message || 'Kayıt işlemi başarısız oldu.', 'error')
      }
    } catch (err) {
      showToast('Bağlantı hatası.', 'error')
    }
  }

  const handleDelete = async (id: string, codeStr: string) => {
    if (!authHeader) return
    const ok = await confirm(`"${codeStr}" kuponunu tamamen silmek istediğinizden emin misiniz?`, { type: 'danger', confirmText: 'Evet, Sil', title: 'Kuponu Sil' })
    if (!ok) return

    try {
      const res = await fetch(`/api/admin/modules/coupons/${id}`, {
        method: 'DELETE',
        headers: authHeader
      })
      const json = await res.json()
      if (res.ok && json.success) {
        showToast('Kupon başarıyla silindi.', 'success')
        fetchCoupons()
      } else {
        showToast(json.message || 'Silme işlemi başarısız.', 'error')
      }
    } catch (err) {
      showToast('Bağlantı hatası.', 'error')
    }
  }

  const filteredCoupons = useMemo(() => {
    return coupons.filter((c) => {
      const search = searchTerm.toLowerCase()
      return (
        c.code.toLowerCase().includes(search) ||
        (c.userEmail && c.userEmail.toLowerCase().includes(search)) ||
        (c.userFullName && c.userFullName.toLowerCase().includes(search)) ||
        (c.description && c.description.toLowerCase().includes(search))
      )
    })
  }, [coupons, searchTerm])

  return (
    <AdminLayout
      title="Kupon Yönetimi"
      subtitle="Müşterileriniz için indirim kuponları tanımlayın, kullanım koşullarını ve limitlerini yönetin."
    >
      <div className="space-y-6">
        {/* Stats card */}
        <div className="grid gap-5 sm:grid-cols-3">
          <div className="bg-white p-5 border border-zinc-200/80 rounded-3xl shadow-[0_2px_8px_rgba(0,0,0,0.02),0_8px_20px_rgba(0,0,0,0.015)]">
            <div className="flex justify-between items-start">
              <span className="text-[11px] font-extrabold tracking-wider text-zinc-400 uppercase">Toplam Kupon</span>
              <span className="material-symbols-outlined text-[20px] p-2 rounded-2xl border border-zinc-150 text-zinc-500 bg-zinc-50">confirmation_number</span>
            </div>
            <p className="text-2xl font-black text-zinc-900 mt-2">{coupons.length}</p>
          </div>
          <div className="bg-white p-5 border border-zinc-200/80 rounded-3xl shadow-[0_2px_8px_rgba(0,0,0,0.02),0_8px_20px_rgba(0,0,0,0.015)]">
            <div className="flex justify-between items-start">
              <span className="text-[11px] font-extrabold tracking-wider text-zinc-400 uppercase">Aktif Kuponlar</span>
              <span className="material-symbols-outlined text-[20px] p-2 rounded-2xl border border-green-100 text-green-600 bg-green-50/50">check_circle</span>
            </div>
            <p className="text-2xl font-black text-green-600 mt-2">
              {coupons.filter((c) => c.isActive && new Date(c.validUntil) >= new Date()).length}
            </p>
          </div>
          <div className="bg-white p-5 border border-zinc-200/80 rounded-3xl shadow-[0_2px_8px_rgba(0,0,0,0.02),0_8px_20px_rgba(0,0,0,0.015)]">
            <div className="flex justify-between items-start">
              <span className="text-[11px] font-extrabold tracking-wider text-zinc-400 uppercase">Toplam Kullanım</span>
              <span className="material-symbols-outlined text-[20px] p-2 rounded-2xl border border-blue-100 text-blue-600 bg-blue-50/50">shopping_bag</span>
            </div>
            <p className="text-2xl font-black text-blue-600 mt-2">
              {coupons.reduce((acc, c) => acc + c.usedCount, 0)}
            </p>
          </div>
        </div>

        {/* Filter bar */}
        <div className="flex flex-col sm:flex-row justify-between gap-4 bg-white p-4 border border-zinc-200/80 rounded-3xl shadow-[0_2px_8px_rgba(0,0,0,0.02)]">
          <Input
            placeholder="Kod veya müşteri ara..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            icon="search"
            className="max-w-md w-full rounded-2xl focus:ring-primary/5 focus:border-primary"
          />
          <div className="flex gap-2 shrink-0">
            <Button 
              onClick={handleOpenAddModal} 
              icon="add"
              className="rounded-2xl bg-primary text-white hover:bg-primary/95 active:scale-[0.98] transition-all px-4 font-bold"
            >
              Yeni Kupon Tanımla
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center py-24 bg-white rounded-3xl border border-zinc-200/80 shadow-[0_2px_8px_rgba(0,0,0,0.02)]">
            <div className="w-10 h-10 border-4 border-zinc-200 border-t-primary rounded-full animate-spin mb-3" />
            <span className="text-sm text-zinc-400 font-medium">Kuponlar yükleniyor...</span>
          </div>
        ) : filteredCoupons.length === 0 ? (
          <div className="bg-white rounded-3xl border border-zinc-200/80 p-16 text-center shadow-[0_2px_8px_rgba(0,0,0,0.02)]">
            <div className="w-16 h-16 bg-zinc-50 rounded-full flex items-center justify-center mx-auto mb-4 border border-zinc-100">
              <span className="material-symbols-outlined text-[32px] text-zinc-400">confirmation_number</span>
            </div>
            <h4 className="text-base font-bold text-zinc-800">Kupon Bulunmuyor</h4>
            <p className="text-xs text-zinc-500 mt-2 max-w-sm mx-auto">
              Sistemde tanımlı veya arama kriterinize uygun bir kupon bulunamadı. "Yeni Kupon Tanımla" butonuna basarak ilk kuponunuzu oluşturabilirsiniz.
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-3xl border border-zinc-200/80 bg-white shadow-[0_2px_8px_rgba(0,0,0,0.02)]">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-zinc-50 border-b border-zinc-200/80 text-[10px] font-extrabold tracking-wider text-zinc-450 uppercase">
                    <th className="px-6 py-4">Kupon Kodu</th>
                    <th className="px-6 py-4">Tanımlanan Müşteri</th>
                    <th className="px-6 py-4">İndirim Detayı</th>
                    <th className="px-6 py-4">Koşullar & Kapsam</th>
                    <th className="px-6 py-4">Geçerlilik Tarihi</th>
                    <th className="px-6 py-4 text-center">Kullanım</th>
                    <th className="px-6 py-4 text-center">Durum</th>
                    <th className="px-6 py-4 text-right">İşlemler</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-150/60 text-xs text-zinc-600">
                  {filteredCoupons.map((item) => {
                    const isExpired = new Date(item.validUntil) < new Date()
                    return (
                      <tr key={item.id} className="hover:bg-zinc-50/50 transition-colors duration-150">
                        <td className="px-6 py-4 font-bold text-zinc-950">
                          <span className="font-mono bg-zinc-100 text-zinc-800 px-2.5 py-1 rounded-lg border border-zinc-200">
                            {item.code}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          {item.assignedUsers && item.assignedUsers.length > 0 ? (
                            <div>
                              <p className="font-bold text-zinc-900">
                                {item.assignedUsers.length === 1 
                                  ? item.assignedUsers[0].userFullName 
                                  : `${item.assignedUsers.length} Müşteri`}
                              </p>
                              <p className="text-[10px] text-zinc-500 truncate max-w-[185px]" title={item.assignedUsers.map(u => u.userEmail || u.userFullName).join(', ')}>
                                {item.assignedUsers.map(u => u.userFullName || u.userEmail).join(', ')}
                              </p>
                            </div>
                          ) : (
                            <span className="inline-flex items-center text-zinc-500 font-semibold">
                              <span className="material-symbols-outlined text-[14px] mr-1">public</span>
                              Tüm Müşteriler
                            </span>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-extrabold ${
                            item.discountType === 'Percentage'
                              ? 'bg-amber-50 text-amber-800 border border-amber-200'
                              : 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                          }`}>
                            {item.discountType === 'Percentage' 
                              ? `%${item.discountValue} İndirim`
                              : `${item.discountValue.toLocaleString('tr-TR')} TL İndirim`
                            }
                          </span>
                          {item.description && (
                            <p className="text-[10px] text-zinc-400 mt-1 max-w-[150px] truncate" title={item.description}>
                              {item.description}
                            </p>
                          )}
                        </td>
                        <td className="px-6 py-4 space-y-1">
                          {item.minOrderAmount > 0 && (
                            <p className="text-[10px] font-semibold text-zinc-500">
                              Min. Sepet: <span className="text-zinc-800">{item.minOrderAmount} TL</span>
                            </p>
                          )}
                          {item.maxDiscountAmount && (
                            <p className="text-[10px] font-semibold text-zinc-500">
                              Maks. İndirim: <span className="text-zinc-800">{item.maxDiscountAmount} TL</span>
                            </p>
                          )}
                          {item.applicableProductId && (
                            <p className="text-[10px] font-semibold text-zinc-500">
                              Ürün: <span className="text-primary font-bold truncate block max-w-[140px]" title={item.productName || ''}>{item.productName || 'Ürün Kısıtı'}</span>
                            </p>
                          )}
                          {item.applicableCategoryId && (
                            <p className="text-[10px] font-semibold text-zinc-500">
                              Kategori: <span className="text-blue-600 font-bold block max-w-[140px]" title={item.categoryName || ''}>{item.categoryName || 'Kategori Kısıtı'}</span>
                            </p>
                          )}
                          {!item.minOrderAmount && !item.maxDiscountAmount && !item.applicableProductId && !item.applicableCategoryId && (
                            <span className="text-[10px] text-zinc-400">Koşulsuz</span>
                          )}
                        </td>
                        <td className="px-6 py-4 text-zinc-500 font-medium">
                          <div>{new Date(item.validFrom).toLocaleDateString('tr-TR')}</div>
                          <div className="text-[10px] text-zinc-400">{new Date(item.validUntil).toLocaleDateString('tr-TR')}</div>
                        </td>
                        <td className="px-6 py-4 text-center font-bold text-zinc-850">
                          {item.usedCount} / {item.usageLimit}
                        </td>
                        <td className="px-6 py-4 text-center">
                          {isExpired ? (
                            <span className="inline-flex px-2 py-0.5 rounded-full text-[9px] font-bold border border-zinc-200 bg-zinc-100 text-zinc-400 uppercase tracking-wider">
                              Süresi Doldu
                            </span>
                          ) : (
                            <span className={`inline-flex px-2 py-0.5 rounded-full text-[9px] font-bold border uppercase tracking-wider ${
                              item.isActive 
                                ? 'bg-green-50 border-green-200 text-green-700' 
                                : 'bg-rose-50 border-rose-200 text-rose-700'
                            }`}>
                              {item.isActive ? 'Aktif' : 'Pasif'}
                            </span>
                          )}
                        </td>
                        <td className="px-6 py-4 text-right">
                          <div className="flex justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleOpenEditModal(item)}
                              className="w-8 h-8 rounded-full border border-zinc-200 text-zinc-500 hover:text-primary hover:border-primary/30 hover:bg-primary/5 transition-all flex items-center justify-center"
                              title="Düzenle"
                            >
                              <span className="material-symbols-outlined text-[16px]">edit</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDelete(item.id, item.code)}
                              className="w-8 h-8 rounded-full border border-zinc-200 text-zinc-400 hover:text-rose-600 hover:border-rose-200 hover:bg-rose-50/50 transition-all flex items-center justify-center"
                              title="Sil"
                            >
                              <span className="material-symbols-outlined text-[16px]">delete</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Create/Edit Modal */}
        {showModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/40 backdrop-blur-sm p-4 overflow-y-auto">
            <div className="bg-white rounded-3xl shadow-xl w-full max-w-2xl border border-zinc-150 p-6 flex flex-col max-h-[90vh]">
              <div className="flex justify-between items-center pb-4 border-b border-zinc-100">
                <h3 className="text-lg font-extrabold text-zinc-950">
                  {editingCoupon ? `Kuponu Düzenle: ${code}` : 'Yeni Kupon Oluştur'}
                </h3>
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="w-8 h-8 rounded-full flex items-center justify-center border border-zinc-200 text-zinc-400 hover:bg-zinc-550 transition-colors"
                >
                  <span className="material-symbols-outlined text-[18px]">close</span>
                </button>
              </div>

              <form onSubmit={handleSave} className="flex-1 overflow-y-auto mt-4 space-y-4 pr-1">
                {/* Coupon Code input with generator */}
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-zinc-600">Kupon Kodu *</label>
                    <div className="flex gap-2">
                      <input
                        required
                        type="text"
                        placeholder="Örn: YAZ10"
                        value={code}
                        onChange={(e) => setCode(e.target.value.toUpperCase())}
                        className="h-10 flex-1 rounded-xl border border-zinc-200 px-3 outline-none focus:border-primary text-sm uppercase font-mono font-bold"
                      />
                      <button
                        type="button"
                        onClick={generateRandomCode}
                        className="h-10 px-3 rounded-xl border border-zinc-200 text-xs font-bold bg-zinc-50 hover:bg-zinc-100 flex items-center gap-1 active:scale-95 transition-all text-zinc-600 shrink-0"
                      >
                        <span className="material-symbols-outlined text-[14px]">autorenew</span>
                        Kod Üret
                      </button>
                    </div>
                  </div>

                  {/* Customer Selector */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-zinc-600">Hedef Müşteriler *</label>
                    <div className="flex gap-2">
                      <div className="h-10 flex-1 rounded-xl border border-zinc-200 px-3 flex items-center bg-zinc-50 text-sm font-semibold text-zinc-800 truncate select-none">
                        {selectedUserIds.length === 0 ? (
                          <span className="text-zinc-500 flex items-center gap-1 font-bold">
                            <span className="material-symbols-outlined text-[16px]">public</span>
                            Tüm Müşteriler (Genel Kupon)
                          </span>
                        ) : selectedUserIds.length === customers.length ? (
                          <span className="text-primary flex items-center gap-1 font-black">
                            <span className="material-symbols-outlined text-[16px]">group</span>
                            Tüm Müşteriler ({selectedUserIds.length} Müşteri)
                          </span>
                        ) : (
                          <span className="text-zinc-900 flex items-center gap-1 font-bold">
                            <span className="material-symbols-outlined text-[16px]">person</span>
                            {selectedUserIds.length} Müşteri Seçildi
                          </span>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setCustomerSearchTerm('')
                          setShowCustomerModal(true)
                        }}
                        className="h-10 px-4 rounded-xl border border-primary/20 text-xs font-bold bg-primary/5 hover:bg-primary/10 text-primary flex items-center gap-1 active:scale-95 transition-all shrink-0"
                      >
                        <span className="material-symbols-outlined text-[16px]">group</span>
                        Seç ({selectedUserIds.length})
                      </button>
                    </div>
                  </div>
                </div>

                {/* Discount type and value */}
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-zinc-600">İndirim Türü *</label>
                    <select
                      value={discountType}
                      onChange={(e) => setDiscountType(e.target.value as 'Percentage' | 'FixedAmount')}
                      className="h-10 w-full rounded-xl border border-zinc-200 px-3 outline-none focus:border-primary text-sm bg-white"
                    >
                      <option value="Percentage">Oransal (%)</option>
                      <option value="FixedAmount">Tutar Bazlı (TL)</option>
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-zinc-600">
                      {discountType === 'Percentage' ? 'İndirim Oranı (%) *' : 'İndirim Tutarı (TL) *'}
                    </label>
                    <input
                      required
                      type="number"
                      min="1"
                      value={discountValue}
                      onChange={(e) => setDiscountValue(Number(e.target.value))}
                      className="h-10 w-full rounded-xl border border-zinc-200 px-3 outline-none focus:border-primary text-sm font-bold"
                    />
                  </div>
                </div>

                {/* Minimum and maximum limits */}
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-zinc-600">Minimum Sepet Tutarı (TL)</label>
                    <input
                      type="number"
                      min="0"
                      value={minOrderAmount}
                      onChange={(e) => setMinOrderAmount(Number(e.target.value))}
                      className="h-10 w-full rounded-xl border border-zinc-200 px-3 outline-none focus:border-primary text-sm font-semibold"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-zinc-600">
                      Maksimum İndirim Limiti (TL) {discountType !== 'Percentage' && '(Oransal İndirimde Geçerlidir)'}
                    </label>
                    <input
                      type="number"
                      min="0"
                      disabled={discountType !== 'Percentage'}
                      value={maxDiscountAmount}
                      onChange={(e) => setMaxDiscountAmount(e.target.value)}
                      placeholder="Sınırsız"
                      className="h-10 w-full rounded-xl border border-zinc-200 px-3 outline-none focus:border-primary text-sm font-semibold disabled:bg-zinc-50"
                    />
                  </div>
                </div>

                {/* Scope Constraints (Products & Categories) */}
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-zinc-600">Geçerli Ürün Kısıtı (Opsiyonel)</label>
                    <select
                      value={applicableProductId}
                      onChange={(e) => {
                        setApplicableProductId(e.target.value)
                        if (e.target.value) setApplicableCategoryId('') // Mutually exclusive for simplicity
                      }}
                      className="h-10 w-full rounded-xl border border-zinc-200 px-3 outline-none focus:border-primary text-sm bg-white"
                    >
                      <option value="">Tüm Ürünler</option>
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} ({p.stockCode})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-zinc-600">Geçerli Kategori Kısıtı (Opsiyonel)</label>
                    <select
                      value={applicableCategoryId}
                      onChange={(e) => {
                        setApplicableCategoryId(e.target.value)
                        if (e.target.value) setApplicableProductId('') // Mutually exclusive for simplicity
                      }}
                      className="h-10 w-full rounded-xl border border-zinc-200 px-3 outline-none focus:border-primary text-sm bg-white"
                    >
                      <option value="">Tüm Kategoriler</option>
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Validity Dates */}
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-zinc-600">Başlangıç Tarihi *</label>
                    <input
                      required
                      type="datetime-local"
                      value={validFrom}
                      onChange={(e) => setValidFrom(e.target.value)}
                      className="h-10 w-full rounded-xl border border-zinc-200 px-3 outline-none focus:border-primary text-sm font-semibold"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-zinc-600">Bitiş Tarihi *</label>
                    <input
                      required
                      type="datetime-local"
                      value={validUntil}
                      onChange={(e) => setValidUntil(e.target.value)}
                      className="h-10 w-full rounded-xl border border-zinc-200 px-3 outline-none focus:border-primary text-sm font-semibold"
                    />
                  </div>
                </div>

                {/* Limit & Toggle */}
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-zinc-600">Toplam Kullanım Limiti *</label>
                    <input
                      required
                      type="number"
                      min="1"
                      value={usageLimit}
                      onChange={(e) => setUsageLimit(Number(e.target.value))}
                      className="h-10 w-full rounded-xl border border-zinc-200 px-3 outline-none focus:border-primary text-sm font-bold"
                    />
                  </div>

                  <div className="flex items-center pt-6">
                    <label className="flex items-center gap-2 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={isActive}
                        onChange={(e) => setIsActive(e.target.checked)}
                        className="w-4.5 h-4.5 rounded border-zinc-300 text-primary focus:ring-primary/20 cursor-pointer"
                      />
                      <span className="text-sm font-bold text-zinc-700">Kupon Aktif</span>
                    </label>
                  </div>
                </div>

                {/* Description */}
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-zinc-600">Kupon Açıklaması (Müşteri Görebilir)</label>
                  <textarea
                    rows={2}
                    placeholder="Örn: Sepette %10 ek indirim fırsatı"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className="w-full rounded-xl border border-zinc-200 p-3 outline-none focus:border-primary text-sm"
                  />
                </div>

                {/* Footer buttons */}
                <div className="flex justify-end gap-2 pt-4 border-t border-zinc-100">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setShowModal(false)}
                    className="rounded-xl border-zinc-200 font-bold active:scale-[0.98] transition-all px-4"
                  >
                    Vazgeç
                  </Button>
                  <Button
                    type="submit"
                    className="rounded-xl bg-primary text-white hover:bg-primary/95 active:scale-[0.98] transition-all font-bold px-5"
                  >
                    Kaydet
                  </Button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Customer Multi-Select Modal */}
        {showCustomerModal && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-zinc-950/45 backdrop-blur-sm p-4 overflow-y-auto">
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md border border-zinc-150 p-6 flex flex-col max-h-[80vh]">
              <div className="flex justify-between items-center pb-4 border-b border-zinc-100">
                <div>
                  <h4 className="text-base font-extrabold text-zinc-950">Müşteri Seçimi</h4>
                  <p className="text-[11px] text-zinc-400 font-semibold mt-0.5">Kuponun tanımlanacağı müşterileri belirleyin.</p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowCustomerModal(false)}
                  className="w-8 h-8 rounded-full flex items-center justify-center border border-zinc-200 text-zinc-400 hover:bg-zinc-550 transition-colors"
                >
                  <span className="material-symbols-outlined text-[18px]">close</span>
                </button>
              </div>

              {/* Search filter in modal */}
              <div className="mt-4">
                <Input
                  placeholder="Müşteri adı veya e-posta ara..."
                  value={customerSearchTerm}
                  onChange={(e) => setCustomerSearchTerm(e.target.value)}
                  icon="search"
                  className="rounded-2xl focus:ring-primary/5 focus:border-primary w-full"
                />
              </div>

              {/* All customers option at the top */}
              <div className="mt-4 p-3 bg-zinc-50 rounded-2xl border border-zinc-150 flex items-center justify-between shrink-0">
                <label className="flex items-center gap-3 cursor-pointer select-none w-full">
                  <input
                    type="checkbox"
                    checked={customers.length > 0 && selectedUserIds.length === customers.length}
                    onChange={toggleAllCustomers}
                    className="w-5 h-5 rounded border-zinc-300 text-primary focus:ring-primary/20 cursor-pointer"
                  />
                  <div className="flex-1">
                    <p className="text-xs font-bold text-zinc-900">Tüm Müşteriler</p>
                    <p className="text-[10px] text-zinc-450 font-semibold">Tüm kullanıcıları seçer veya kaldırır.</p>
                  </div>
                </label>
              </div>

              {/* Customer List */}
              <div className="flex-1 overflow-y-auto mt-3 pr-1 space-y-1 max-h-[300px] border border-zinc-100 rounded-2xl p-2 bg-zinc-50/30">
                {filteredCustomers.length === 0 ? (
                  <div className="py-8 text-center text-zinc-400 text-xs font-medium">
                    Aranan kriterlere uygun müşteri bulunamadı.
                  </div>
                ) : (
                  filteredCustomers.map((c) => {
                    const isSelected = selectedUserIds.includes(c.id)
                    return (
                      <label
                        key={c.id}
                        className={`flex items-center gap-3 p-2.5 rounded-xl border cursor-pointer select-none transition-all ${
                          isSelected
                            ? 'bg-primary/5 border-primary/25'
                            : 'bg-white border-zinc-150 hover:bg-zinc-50/50'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleCustomer(c.id)}
                          className="w-4.5 h-4.5 rounded border-zinc-300 text-primary focus:ring-primary/10 cursor-pointer"
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-bold text-zinc-900 truncate">{c.fullName}</p>
                          <p className="text-[10px] text-zinc-500 truncate mt-0.5">{c.email}</p>
                        </div>
                      </label>
                    )
                  })
                )}
              </div>

              {/* Modal footer */}
              <div className="flex justify-between items-center pt-4 border-t border-zinc-100 mt-4 shrink-0">
                <button
                  type="button"
                  onClick={() => setSelectedUserIds([])}
                  className="text-xs font-bold text-zinc-400 hover:text-zinc-650 transition-colors"
                >
                  Seçimleri Temizle
                </button>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setShowCustomerModal(false)}
                    className="h-9 px-4 rounded-xl border border-zinc-200 text-xs font-bold text-zinc-650 hover:bg-zinc-50 transition-colors active:scale-95"
                  >
                    Kapat
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </AdminLayout>
  )
}
