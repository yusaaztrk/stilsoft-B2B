import { useEffect, useState, useMemo, useRef } from 'react'
import { AdminLayout } from '../components/admin/AdminLayout'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { MediaLibraryModal } from '../components/ui/MediaLibraryModal'
import { getAdminToken, readApiResponse } from '../lib/api'
import { useToast } from '../components/ui/ToastContext'
import { useConfirm } from '../components/ui/ConfirmContext'

type BrandDiscountRule = {
  brandName: string
  discountType: 'Percentage' | 'FixedAmount'
  discountValue: number
}

type CampaignRule = {
  id: string
  name: string
  description?: string
  type: 'Percentage' | 'FixedAmount' | 'GiftProduct' | 'Brand' | 'BuyXGetY'
  scope?: 'Product' | 'Cart'
  isActive: boolean
  startDate: string
  endDate: string
  priority: number
  imageUrl?: string
  minOrderAmount: number
  maxDiscountAmount?: number
  discountValue: number
  giftProductId?: string
  buyXGetYType?: 'Single' | 'Multi'
  buyQuantity?: number
  giftQuantity?: number
  targetProductIds: string[]
  targetCategoryIds: string[]
  targetBrandNames: string[]
  brandRules?: BrandDiscountRule[]
  buyXGetYScale?: boolean
}

type CampaignStat = {
  campaignId: string
  usageCount: number
  totalDiscount: number
  appliedProductsCount: number
}

type ProductItem = {
  id: string
  name: string
  stockCode: string
  unitPrice: number
}

type CategoryItem = {
  id: string
  name: string
}

type BrandItem = {
  id: string
  name: string
}

interface ProductSearchSelectProps {
  products: ProductItem[]
  value: string
  onChange: (id: string) => void
  placeholder?: string
}

function ProductSearchSelect({ products, value, onChange, placeholder = '-- Seçin --' }: ProductSearchSelectProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [openUpward, setOpenUpward] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  useEffect(() => {
    if (isOpen && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect()
      const spaceBelow = window.innerHeight - rect.bottom
      if (spaceBelow < 280) {
        setOpenUpward(true)
      } else {
        setOpenUpward(false)
      }
    }
  }, [isOpen])

  const selectedProduct = useMemo(() => products.find(p => p.id === value), [products, value])

  const filtered = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    if (!query) return products
    return products.filter(p => 
      p.name.toLowerCase().includes(query) || 
      p.stockCode.toLowerCase().includes(query)
    )
  }, [products, searchQuery])

  return (
    <div ref={containerRef} className="relative w-full">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full h-11 border border-zinc-200 rounded-2xl px-4 text-xs font-semibold text-zinc-700 bg-white outline-none flex items-center justify-between text-left focus:ring-4 focus:ring-[#df0000]/5 focus:border-[#df0000] transition-all"
      >
        <span className="truncate">
          {selectedProduct ? `${selectedProduct.name} (${selectedProduct.stockCode})` : placeholder}
        </span>
        <span className="material-symbols-outlined text-zinc-400 text-[18px]">keyboard_arrow_down</span>
      </button>

      {isOpen && (
        <div className={`absolute z-50 left-0 right-0 ${
          openUpward ? 'bottom-full mb-1.5' : 'top-full mt-1.5'
        } bg-white border border-zinc-250 rounded-2xl shadow-xl p-2.5 space-y-2 animate-in fade-in duration-100`}>
          <input
            type="text"
            placeholder="Ürün adı veya koduna göre ara..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full h-9 border border-zinc-200 rounded-xl px-3 text-xs font-semibold text-zinc-750 outline-none focus:border-[#df0000] transition-colors"
            autoFocus
          />
          <div className="max-h-[240px] overflow-y-auto space-y-1 pr-1 custom-scrollbar">
            {filtered.length === 0 ? (
              <div className="text-[11px] text-zinc-400 text-center py-4 font-medium">Aramayla eşleşen ürün bulunamadı.</div>
            ) : (
              filtered.map(p => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    onChange(p.id)
                    setIsOpen(false)
                    setSearchQuery('')
                  }}
                  className={`w-full text-left h-10 px-3 rounded-xl text-xs font-bold transition-all flex flex-col justify-center ${
                    value === p.id 
                      ? 'bg-[#df0000]/5 text-[#df0000]' 
                      : 'hover:bg-zinc-50 text-zinc-700'
                  }`}
                >
                  <span className="truncate leading-normal text-left">{p.name}</span>
                  <span className={`text-[10px] text-left ${value === p.id ? 'text-[#df0000]/60' : 'text-zinc-400'} font-medium`}>
                    {p.stockCode}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export function AdminCampaignsManagementPage() {
  const { showToast } = useToast()
  const confirm = useConfirm()
  const token = getAdminToken()
  const authHeader = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token])

  const [campaigns, setCampaigns] = useState<CampaignRule[]>([])
  const [stats, setStats] = useState<Record<string, CampaignStat>>({})
  const [products, setProducts] = useState<ProductItem[]>([])
  const [categories, setCategories] = useState<CategoryItem[]>([])
  const [brands, setBrands] = useState<BrandItem[]>([])

  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [mediaOpen, setMediaOpen] = useState(false)

  // Form State
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [type, setType] = useState<'Percentage' | 'FixedAmount' | 'GiftProduct' | 'Brand' | 'BuyXGetY'>('Percentage')
  const [scope, setScope] = useState<'Product' | 'Cart'>('Product')
  const [isActive, setIsActive] = useState(true)
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [priority, setPriority] = useState(0)
  const [imageUrl, setImageUrl] = useState('')
  const [minOrderAmount, setMinOrderAmount] = useState(0)
  const [maxDiscountAmount, setMaxDiscountAmount] = useState('')
  const [discountValue, setDiscountValue] = useState(0)
  const [giftProductId, setGiftProductId] = useState('')
  const [buyXGetYType, setBuyXGetYType] = useState<'Single' | 'Multi'>('Single')
  const [buyQuantity, setBuyQuantity] = useState(1)
  const [giftQuantity, setGiftQuantity] = useState(1)
  const [buyXGetYScale, setBuyXGetYScale] = useState(false)
  const [singleTriggerProductId, setSingleTriggerProductId] = useState('')
  const [multiTriggerProductIds, setMultiTriggerProductIds] = useState<string[]>(['', ''])
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([])
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>([])
  const [selectedBrands, setSelectedBrands] = useState<string[]>([])
  const [brandRules, setBrandRules] = useState<BrandDiscountRule[]>([])

  // Search filters inside target modal
  const [prodSearch, setProdSearch] = useState('')
  const [brandSearch, setBrandSearch] = useState('')

  const fetchCampaigns = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/campaigns', { headers: authHeader })
      const json = await readApiResponse(res)
      if (res.ok && json?.success) {
        setCampaigns(json.data || [])
      }

      // Fetch stats
      const statsRes = await fetch('/api/admin/campaigns/stats', { headers: authHeader })
      const statsJson = await readApiResponse(statsRes)
      if (statsRes.ok && statsJson?.success) {
        const statsMap: Record<string, CampaignStat> = {}
        if (Array.isArray(statsJson.data)) {
          statsJson.data.forEach((s: CampaignStat) => {
            statsMap[s.campaignId] = s
          })
        }
        setStats(statsMap)
      }
    } catch (err) {
      showToast('Kampanya listesi yüklenemedi.', 'error')
    } finally {
      setLoading(false)
    }
  }

  const fetchDependencies = async () => {
    try {
      const prodRes = await fetch('/api/admin/products', { headers: authHeader })
      const prodJson = await prodRes.json()
      if (prodRes.ok && prodJson.success) {
        setProducts(prodJson.data || [])
      }

      const catRes = await fetch('/api/admin/categories', { headers: authHeader })
      const catJson = await catRes.json()
      if (catRes.ok && catJson.success) {
        setCategories(catJson.data || [])
      }

      const brandRes = await fetch('/api/admin/brands', { headers: authHeader })
      const brandJson = await brandRes.json()
      if (brandRes.ok && brandJson.success) {
        setBrands(brandJson.data || [])
      }
    } catch (err) {
      console.error('Dependencies loading failed:', err)
    }
  }

  useEffect(() => {
    fetchCampaigns()
    fetchDependencies()
  }, [])

  const handleOpenAdd = () => {
    setEditingId(null)
    setName('')
    setDescription('')
    setType('Percentage')
    setIsActive(true)
    
    // Set start date to today, end date to next month
    const now = new Date()
    const nextMonth = new Date()
    nextMonth.setMonth(now.getMonth() + 1)
    
    setStartDate(now.toISOString().slice(0, 16))
    setEndDate(nextMonth.toISOString().slice(0, 16))
    setPriority(0)
    setImageUrl('')
    setMinOrderAmount(0)
    setMaxDiscountAmount('')
    setDiscountValue(0)
    setGiftProductId('')
    setBuyXGetYType('Single')
    setBuyQuantity(1)
    setGiftQuantity(1)
    setBuyXGetYScale(false)
    setSingleTriggerProductId('')
    setMultiTriggerProductIds(['', ''])
    setSelectedProductIds([])
    setSelectedCategoryIds([])
    setSelectedBrands([])
    setBrandRules([])
    
    setProdSearch('')
    setBrandSearch('')
    setModalOpen(true)
  }

  const handleOpenEdit = (c: CampaignRule) => {
    setEditingId(c.id)
    setName(c.name)
    setDescription(c.description || '')
    setType(c.type)
    setScope(c.scope || 'Product')
    setIsActive(c.isActive)
    
    // Format dates to local datetime input string
    const sDate = c.startDate ? new Date(c.startDate) : new Date()
    const eDate = c.endDate ? new Date(c.endDate) : new Date()
    
    // Convert to local time zone for input
    const toLocalISO = (d: Date) => {
      const tzOffset = d.getTimezoneOffset() * 60000
      const localISOTime = (new Date(d.getTime() - tzOffset)).toISOString().slice(0, 16)
      return localISOTime
    }

    setStartDate(toLocalISO(sDate))
    setEndDate(toLocalISO(eDate))
    setPriority(c.priority)
    setImageUrl(c.imageUrl || '')
    setMinOrderAmount(c.minOrderAmount)
    setMaxDiscountAmount(c.maxDiscountAmount ? String(c.maxDiscountAmount) : '')
    setDiscountValue(c.discountValue)
    setGiftProductId(c.giftProductId || '')
    setBuyXGetYType(c.buyXGetYType || 'Single')
    setBuyQuantity(c.buyQuantity || 1)
    setGiftQuantity(c.giftQuantity || 1)
    setBuyXGetYScale(c.buyXGetYScale || false)
    if ((c.buyXGetYType || 'Single') === 'Single') {
      setSingleTriggerProductId(c.targetProductIds?.[0] || '')
      setMultiTriggerProductIds(['', ''])
    } else {
      setSingleTriggerProductId('')
      const pids = c.targetProductIds || []
      setMultiTriggerProductIds(pids.length >= 2 ? pids : [...pids, ...Array(2 - pids.length).fill('')])
    }
    setSelectedProductIds(c.targetProductIds || [])
    setSelectedCategoryIds(c.targetCategoryIds || [])
    setSelectedBrands(c.targetBrandNames || [])
    setBrandRules(c.brandRules || [])
    
    setProdSearch('')
    setBrandSearch('')
    setModalOpen(true)
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) {
      showToast('Lütfen kampanya adı girin.', 'error')
      return
    }

    if (type === 'Brand') {
      const hasInvalid = brandRules.some(r => !r.brandName || r.discountValue <= 0)
      if (hasInvalid || brandRules.length === 0) {
        showToast('Lütfen tüm marka indirim satırlarını doldurun (Geçerli marka ve sıfırdan büyük indirim değeri).', 'error')
        return
      }
    }

    if (type === 'BuyXGetY') {
      if (buyXGetYType === 'Single') {
        if (!singleTriggerProductId) {
          showToast('Lütfen satın alınacak ürünü seçin.', 'error')
          return
        }
      } else {
        const filtered = multiTriggerProductIds.filter(Boolean)
        if (filtered.length === 0) {
          showToast('Lütfen en az bir satın alınacak ürün seçin.', 'error')
          return
        }
      }

      if (buyXGetYType === 'Single' && buyQuantity <= 0) {
        showToast('Satın alınacak ürün adedi en az 1 olmalıdır.', 'error')
        return
      }

      if (buyXGetYType === 'Single' && giftQuantity <= 0) {
        showToast('Hediye edilecek ürün adedi en az 1 olmalıdır.', 'error')
        return
      }
    }

    const payload = {
      name,
      description: description || null,
      type,
      isActive,
      startDate: new Date(startDate).toISOString(),
      endDate: new Date(endDate).toISOString(),
      priority,
      imageUrl: imageUrl || null,
      minOrderAmount,
      maxDiscountAmount: maxDiscountAmount ? parseFloat(maxDiscountAmount) : null,
      discountValue: type === 'Brand' ? 0 : discountValue,
      giftProductId: ((type === 'GiftProduct' || type === 'BuyXGetY') && giftProductId && giftProductId.trim() !== '') ? giftProductId.trim() : null,
      buyXGetYType: type === 'BuyXGetY' ? buyXGetYType : null,
      buyQuantity: type === 'BuyXGetY' ? (buyXGetYType === 'Single' ? buyQuantity : 1) : null,
      giftQuantity: type === 'BuyXGetY' ? (buyXGetYType === 'Single' ? giftQuantity : 1) : null,
      buyXGetYScale: type === 'BuyXGetY' ? (buyXGetYType === 'Multi' ? buyXGetYScale : null) : null,
      targetProductIds: type === 'BuyXGetY'
        ? (buyXGetYType === 'Single' ? [singleTriggerProductId].filter(Boolean) : multiTriggerProductIds.filter(Boolean))
        : selectedProductIds,
      targetCategoryIds: type === 'BuyXGetY' ? [] : selectedCategoryIds,
      targetBrandNames: type === 'BuyXGetY' ? [] : (type === 'Brand' ? brandRules.map(r => r.brandName).filter(Boolean) : selectedBrands),
      brandRules: type === 'Brand' ? brandRules : [],
      scope: (type === 'Brand' || type === 'GiftProduct' || type === 'BuyXGetY') ? 'Product' : scope
    }

    console.log('Sending payload to api:', payload)
    if (payload.type === 'GiftProduct' || payload.type === 'BuyXGetY') {
      console.log('Checking giftProductId:', payload.giftProductId)
      if (payload.giftProductId) {
        const guidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
        if (!guidRegex.test(payload.giftProductId)) {
          showToast('Hediye ürün ID\'si geçerli bir GUID formatında olmalıdır.', 'error')
          console.error('Invalid Guid for giftProductId:', payload.giftProductId)
          return
        }
      } else {
        showToast('Lütfen hediye edilecek ürünü seçin.', 'error')
        return
      }
    }

    const url = editingId ? `/api/admin/campaigns/${editingId}` : '/api/admin/campaigns'
    const method = editingId ? 'PUT' : 'POST'

    try {
      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...authHeader
        },
        body: JSON.stringify(payload)
      })

      const json = await readApiResponse(res)
      if (res.ok && json.success) {
        showToast(editingId ? 'Kampanya güncellendi.' : 'Kampanya oluşturuldu.', 'success')
        setModalOpen(false)
        fetchCampaigns()
      } else {
        showToast(json.message || 'Kampanya kaydedilemedi.', 'error')
      }
    } catch (err) {
      showToast('Sunucu bağlantı hatası.', 'error')
    }
  }

  const handleDelete = async (id: string) => {
    const ok = await confirm('Bu kampanya kuralını silmek istediğinizden emin misiniz? Bu işlem geri alınamaz.', {
      type: 'danger',
      confirmText: 'Sil',
      title: 'Kampanyayı Sil'
    })
    if (!ok) return

    try {
      const res = await fetch(`/api/admin/campaigns/${id}`, {
        method: 'DELETE',
        headers: authHeader
      })
      const json = await readApiResponse(res)
      if (res.ok && json.success) {
        showToast('Kampanya kuralı silindi.', 'success')
        fetchCampaigns()
      } else {
        showToast(json.message || 'Kampanya silinemedi.', 'error')
      }
    } catch (err) {
      showToast('Silme işlemi başarısız.', 'error')
    }
  }

  const handleMediaSelect = (url: string) => {
    setImageUrl(url)
    setMediaOpen(false)
  }

  // Filter lists inside modal
  const filteredProducts = useMemo(() => {
    if (!prodSearch.trim()) return products
    const s = prodSearch.toLowerCase()
    return products.filter(p => 
      p.name.toLowerCase().includes(s) || 
      p.stockCode.toLowerCase().includes(s)
    )
  }, [products, prodSearch])

  const filteredBrands = useMemo(() => {
    if (!brandSearch.trim()) return brands
    const s = brandSearch.toLowerCase()
    return brands.filter(b => b.name.toLowerCase().includes(s))
  }, [brands, brandSearch])

  const toggleProduct = (pid: string) => {
    setSelectedProductIds(prev => 
      prev.includes(pid) ? prev.filter(id => id !== pid) : [...prev, pid]
    )
  }

  const toggleCategory = (catId: string) => {
    setSelectedCategoryIds(prev => 
      prev.includes(catId) ? prev.filter(id => id !== catId) : [...prev, catId]
    )
  }

  const toggleBrand = (bname: string) => {
    setSelectedBrands(prev => 
      prev.includes(bname) ? prev.filter(b => b !== bname) : [...prev, bname]
    )
  }

  // Calculate totals for stats
  const totalUsages = Object.values(stats).reduce((sum, s) => sum + Number(s.usageCount), 0)
  const totalDiscount = Object.values(stats).reduce((sum, s) => sum + Number(s.totalDiscount), 0)
  const activeCount = campaigns.filter(c => c.isActive && new Date(c.startDate) <= new Date() && new Date(c.endDate) >= new Date()).length

  return (
    <AdminLayout
      title="Kampanya Kural Motoru"
      subtitle="E-ticaret sepet, marka, kategori ve ürün bazlı aktif kampanya kurallarını yönetin."
    >
      <div className="space-y-6">
        {/* Stats Grid */}
        <div className="grid gap-6 sm:grid-cols-4">
          <div className="bg-white p-6 border border-zinc-200/80 rounded-3xl shadow-[0_2px_8px_rgba(0,0,0,0.02)]">
            <span className="text-[10px] font-extrabold tracking-wider text-zinc-400 uppercase">Toplam Kural</span>
            <div className="text-2xl font-black text-zinc-850 mt-1">{campaigns.length}</div>
            <div className="text-[10px] text-zinc-400 mt-1.5 font-medium">Tanımlı kampanya kuralları</div>
          </div>
          <div className="bg-white p-6 border border-zinc-200/80 rounded-3xl shadow-[0_2px_8px_rgba(0,0,0,0.02)]">
            <span className="text-[10px] font-extrabold tracking-wider text-zinc-400 uppercase">Aktif Dönem</span>
            <div className="text-2xl font-black text-green-600 mt-1">{activeCount}</div>
            <div className="text-[10px] text-zinc-400 mt-1.5 font-medium">Şu an geçerli olanlar</div>
          </div>
          <div className="bg-white p-6 border border-zinc-200/80 rounded-3xl shadow-[0_2px_8px_rgba(0,0,0,0.02)]">
            <span className="text-[10px] font-extrabold tracking-wider text-zinc-400 uppercase">Toplam Sipariş Kullanımı</span>
            <div className="text-2xl font-black text-indigo-600 mt-1">{totalUsages}</div>
            <div className="text-[10px] text-zinc-400 mt-1.5 font-medium">Kampanyadan yararlanan siparişler</div>
          </div>
          <div className="bg-white p-6 border border-zinc-200/80 rounded-3xl shadow-[0_2px_8px_rgba(0,0,0,0.02)]">
            <span className="text-[10px] font-extrabold tracking-wider text-zinc-400 uppercase">Toplam Yapılan İndirim</span>
            <div className="text-2xl font-black text-rose-600 mt-1">₺{totalDiscount.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}</div>
            <div className="text-[10px] text-zinc-400 mt-1.5 font-medium">Müşterilere sağlanan kazanç</div>
          </div>
        </div>

        {/* Action Header */}
        <div className="flex justify-between items-center bg-white p-5 border border-zinc-200/80 rounded-3xl shadow-[0_2px_8px_rgba(0,0,0,0.02)]">
          <span className="text-xs font-bold text-zinc-650">Kampanya Listesi</span>
          <Button 
            variant="primary" 
            onClick={handleOpenAdd} 
            icon="add"
            className="rounded-2xl bg-[#df0000] hover:bg-[#c00000] active:scale-[0.98] transition-all"
          >
            Yeni Kampanya Ekle
          </Button>
        </div>

        {/* Campaigns Table */}
        {loading ? (
          <div className="flex flex-col items-center justify-center py-24 bg-white rounded-3xl border border-zinc-200/80 shadow-[0_2px_8px_rgba(0,0,0,0.02)]">
            <div className="w-10 h-10 border-4 border-zinc-200 border-t-[#df0000] rounded-full animate-spin mb-3" />
            <span className="text-sm text-zinc-400 font-medium">Kampanya kuralları yükleniyor...</span>
          </div>
        ) : campaigns.length === 0 ? (
          <div className="bg-white rounded-3xl border border-zinc-200/80 p-16 text-center shadow-[0_2px_8px_rgba(0,0,0,0.02)]">
            <div className="w-16 h-16 bg-zinc-50 rounded-full flex items-center justify-center mx-auto mb-4 border border-zinc-100">
              <span className="material-symbols-outlined text-[32px] text-zinc-400">payments</span>
            </div>
            <h4 className="text-base font-bold text-zinc-850">Kampanya Tanımlanmamış</h4>
            <p className="text-xs text-zinc-500 mt-2 max-w-sm mx-auto">
              Sepet indirimleri, ücretsiz kargolar veya hediye ürün kampanyaları oluşturarak satışlarınızı artırabilirsiniz.
            </p>
          </div>
        ) : (
          <div className="bg-white border border-zinc-200/80 rounded-3xl overflow-hidden shadow-[0_2px_8px_rgba(0,0,0,0.02)]">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-zinc-200 bg-zinc-50/50 text-[10px] font-extrabold tracking-wider text-zinc-450 uppercase">
                    <th className="py-4 px-6">Görsel & Kampanya Adı</th>
                    <th className="py-4 px-6">Tür & Değer</th>
                    <th className="py-4 px-6">Hedef Kapsam</th>
                    <th className="py-4 px-6">Geçerlilik Tarihi</th>
                    <th className="py-4 px-6 text-center">Öncelik</th>
                    <th className="py-4 px-6 text-center">Durum</th>
                    <th className="py-4 px-6 text-center">Kullanım</th>
                    <th className="py-4 px-6 text-center">İşlem</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200 text-xs text-zinc-700">
                  {campaigns.map((c) => {
                    const cStat = stats[c.id] || { usageCount: 0, totalDiscount: 0, appliedProductsCount: 0 }
                    
                    const isUpcoming = new Date(c.startDate) > new Date()
                    const isExpired = new Date(c.endDate) < new Date()
                    
                    let dateBadge = (
                      <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold bg-green-50 text-green-700 border border-green-200/60">
                        Aktif
                      </span>
                    )
                    if (isUpcoming) {
                      dateBadge = (
                        <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200/60">
                          Beklemede
                        </span>
                      )
                    } else if (isExpired) {
                      dateBadge = (
                        <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold bg-rose-50 text-rose-700 border border-rose-200/60">
                          Süresi Doldu
                        </span>
                      )
                    }

                    // Format type text
                    let typeText = ''
                    if (c.type === 'Percentage') typeText = `%${c.discountValue} Yüzdesel`
                    else if (c.type === 'FixedAmount') typeText = `₺${c.discountValue} Sabit İndirim`
                    else if ((c.type as any) === 'FreeShipping') typeText = 'Ücretsiz Kargo (Pasif)'
                    else if (c.type === 'GiftProduct') typeText = 'Hediye Ürün'
                    else if (c.type === 'Brand') typeText = 'Marka Bazlı'
                    else if (c.type === 'BuyXGetY') typeText = `${c.buyQuantity} Alana ${c.giftQuantity} Hediye (${c.buyXGetYType === 'Single' ? 'Tek Ürün' : 'Çok Ürün'})`

                    // Format targets
                    const targetParts: string[] = []
                    if (c.targetProductIds.length > 0) targetParts.push(`${c.targetProductIds.length} Ürün`)
                    if (c.targetCategoryIds.length > 0) targetParts.push(`${c.targetCategoryIds.length} Kategori`)
                    if (c.targetBrandNames.length > 0) targetParts.push(`${c.targetBrandNames.length} Marka`)
                    const targetStr = c.scope === 'Cart' ? 'Tüm Sepet' : (targetParts.length > 0 ? targetParts.join(', ') : 'Tüm Mağaza')

                    return (
                      <tr key={c.id} className="hover:bg-zinc-50/50 transition-colors">
                        <td className="py-4 px-6">
                          <div className="flex items-center gap-3">
                            <div className="w-12 h-12 rounded-xl bg-zinc-50 border border-zinc-100 overflow-hidden shrink-0 flex items-center justify-center">
                              {c.imageUrl ? (
                                <img src={c.imageUrl} className="w-full h-full object-cover" alt="" />
                              ) : (
                                <span className="material-symbols-outlined text-zinc-300">campaign</span>
                              )}
                            </div>
                            <div>
                              <div className="font-bold text-zinc-850">{c.name}</div>
                              {c.description && <div className="text-[10px] text-zinc-400 mt-0.5 line-clamp-1">{c.description}</div>}
                            </div>
                          </div>
                        </td>
                        <td className="py-4 px-6 font-semibold">
                          <div>{typeText}</div>
                          {c.minOrderAmount > 0 && <div className="text-[10px] text-zinc-400 mt-0.5 font-normal">Min Sepet: ₺{c.minOrderAmount}</div>}
                        </td>
                        <td className="py-4 px-6">
                          <span className="inline-flex px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-zinc-50 text-zinc-600 border border-zinc-200">
                            {targetStr}
                          </span>
                          {cStat.appliedProductsCount > 0 && (
                            <div className="text-[10px] text-zinc-400 mt-1">Eşleşen: {cStat.appliedProductsCount} ürün</div>
                          )}
                        </td>
                        <td className="py-4 px-6 text-zinc-500 font-medium">
                          <div>Başlangıç: {new Date(c.startDate).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' })}</div>
                          <div>Bitiş: {new Date(c.endDate).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' })}</div>
                        </td>
                        <td className="py-4 px-6 text-center font-bold text-zinc-850">
                          {c.priority}
                        </td>
                        <td className="py-4 px-6 text-center">
                          <div className="flex flex-col items-center gap-1">
                            {dateBadge}
                            <span className={`text-[10px] font-bold ${c.isActive ? 'text-green-600' : 'text-zinc-400'}`}>
                              {c.isActive ? 'Aktif' : 'Pasif'}
                            </span>
                          </div>
                        </td>
                        <td className="py-4 px-6 text-center font-semibold text-zinc-650">
                          <div>{cStat.usageCount} Sipariş</div>
                          {cStat.totalDiscount > 0 && <div className="text-[10px] text-rose-500 font-bold mt-0.5">₺{Number(cStat.totalDiscount).toFixed(0)}</div>}
                        </td>
                        <td className="py-4 px-6 text-center">
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleOpenEdit(c)}
                              className="w-8 h-8 rounded-full border border-zinc-200 text-zinc-600 hover:text-zinc-950 hover:bg-zinc-50 flex items-center justify-center transition-all"
                              title="Düzenle"
                            >
                              <span className="material-symbols-outlined text-[16px]">edit</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDelete(c.id)}
                              className="w-8 h-8 rounded-full border border-zinc-200 text-rose-500 hover:text-rose-700 hover:bg-rose-50 flex items-center justify-center transition-all"
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

        {/* Modal: Add/Edit Campaign */}
        {modalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm overflow-y-auto">
            <div className="bg-white rounded-3xl border border-zinc-200 shadow-2xl max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
              <div className="flex items-center justify-between border-b border-zinc-200 px-6 py-4">
                <div>
                  <h3 className="text-base font-black text-zinc-850 uppercase">
                    {editingId ? 'Kampanyayı Düzenle' : 'Yeni Kampanya Tanımla'}
                  </h3>
                  <p className="text-[11px] text-zinc-500 mt-0.5">
                    Kampanya tipini, hedeflerini ve sınır şartlarını belirleyin.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="w-8 h-8 rounded-full hover:bg-zinc-100 flex items-center justify-center text-zinc-400 hover:text-zinc-700 transition-colors"
                >
                  <span className="material-symbols-outlined">close</span>
                </button>
              </div>

              {/* Modal Type Tabs */}
              <div className="bg-zinc-50 border-b border-zinc-200 px-6 py-3">
                <div className="flex flex-wrap gap-2">
                  {[
                    { id: 'Percentage', label: '% İndirim', icon: 'percent' },
                    { id: 'FixedAmount', label: 'Sabit İndirim', icon: 'payments' },
                    { id: 'GiftProduct', label: 'Hediye Ürün', icon: 'featured_seasonal_and_gifts' },
                    { id: 'Brand', label: 'Marka Bazlı', icon: 'branding_watermark' },
                    { id: 'BuyXGetY', label: 'X Alana Y Hediye', icon: 'redeem' }
                  ].map(t => {
                    const active = type === t.id
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => {
                          setType(t.id as any)
                          setDiscountValue(0)
                          setGiftProductId('')
                          setBuyXGetYType('Single')
                          setBuyQuantity(1)
                          setGiftQuantity(1)
                          setSelectedProductIds([])
                          setSelectedCategoryIds([])
                          setSelectedBrands([])
                          setBrandRules([])
                          setMinOrderAmount(0)
                          setMaxDiscountAmount('')
                          setScope('Product')
                        }}
                        className={`flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-bold transition-all border ${
                          active
                            ? 'bg-zinc-900 text-white border-zinc-955 shadow-md scale-102'
                            : 'bg-white text-zinc-600 border-zinc-200 hover:bg-zinc-50'
                        }`}
                      >
                        <span className="material-symbols-outlined text-[16px]">{t.icon}</span>
                        {t.label}
                      </button>
                    )
                  })}
                </div>
              </div>

              <form onSubmit={handleSave} className="flex-1 overflow-y-auto p-6 space-y-6">
                {(type === 'Percentage' || type === 'FixedAmount') && (
                  <div className="border border-zinc-200 rounded-3xl p-5 bg-zinc-50/50 space-y-3">
                    <label className="block text-[11px] font-extrabold tracking-wider text-zinc-400 uppercase">Kampanya Kapsamı</label>
                    <div className="grid grid-cols-2 gap-4">
                      <button
                        type="button"
                        onClick={() => setScope('Product')}
                        className={`flex items-center justify-center gap-2 p-3 rounded-2xl border text-xs font-bold transition-all ${
                          scope === 'Product'
                            ? 'bg-white border-[#df0000] text-[#df0000] shadow-[0_4px_12px_rgba(223,0,0,0.05)]'
                            : 'bg-white border-zinc-200 text-zinc-650 hover:bg-zinc-50'
                        }`}
                      >
                        <span className="material-symbols-outlined text-[18px]">inventory_2</span>
                        Ürün / Kategori Bazlı
                      </button>
                      <button
                        type="button"
                        onClick={() => setScope('Cart')}
                        className={`flex items-center justify-center gap-2 p-3 rounded-2xl border text-xs font-bold transition-all ${
                          scope === 'Cart'
                            ? 'bg-white border-[#df0000] text-[#df0000] shadow-[0_4px_12px_rgba(223,0,0,0.05)]'
                            : 'bg-white border-zinc-200 text-zinc-650 hover:bg-zinc-50'
                        }`}
                      >
                        <span className="material-symbols-outlined text-[18px]">shopping_cart</span>
                        Tüm Sepet Bazlı
                      </button>
                    </div>
                    <p className="text-[10px] text-zinc-400 font-medium">
                      {scope === 'Product' 
                        ? 'Seçilen ürünler, kategoriler veya markalarda geçerlidir. Kataloğda indirimli fiyat ve rozet gösterilir.'
                        : 'Sepet toplam tutarı üzerinden tüm ürünlere uygulanır. Kataloğda crossed-out fiyat veya indirim rozeti gösterilmez.'}
                    </p>
                  </div>
                )}
                {/* Basic Fields */}
                <div className="grid gap-6 md:grid-cols-2">
                  <div className="space-y-4">
                    <Input
                      label="Kampanya Adı *"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Örn: Mutfak Robotlarında Sepette %15 İndirim"
                      required
                    />

                    <div>
                      <label className="block text-[11px] font-extrabold tracking-wider text-zinc-400 uppercase mb-2">Kampanya Açıklaması</label>
                      <textarea
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder="Kampanya detayları ve kuralları..."
                        className="w-full min-h-[90px] border border-zinc-200 rounded-2xl p-4 text-xs font-semibold text-zinc-700 outline-none focus:ring-4 focus:ring-[#df0000]/5 focus:border-[#df0000] transition-all"
                      />
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <label className="block text-[11px] font-extrabold tracking-wider text-zinc-400 uppercase mb-2">Başlangıç Tarihi *</label>
                        <input
                          type="datetime-local"
                          required
                          value={startDate}
                          onChange={(e) => setStartDate(e.target.value)}
                          className="w-full h-11 border border-zinc-200 rounded-2xl px-4 text-xs font-semibold text-zinc-700 outline-none focus:ring-4 focus:ring-[#df0000]/5 focus:border-[#df0000] transition-all"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-extrabold tracking-wider text-zinc-400 uppercase mb-2">Bitiş Tarihi *</label>
                        <input
                          type="datetime-local"
                          required
                          value={endDate}
                          onChange={(e) => setEndDate(e.target.value)}
                          className="w-full h-11 border border-zinc-200 rounded-2xl px-4 text-xs font-semibold text-zinc-700 outline-none focus:ring-4 focus:ring-[#df0000]/5 focus:border-[#df0000] transition-all"
                        />
                      </div>
                    </div>

                    {type === 'BuyXGetY' && (
                      <div className="space-y-4 pt-4 border-t border-zinc-100 animate-in fade-in duration-200">
                        <div>
                          <label className="block text-[11px] font-extrabold tracking-wider text-zinc-400 uppercase mb-2">Kural Önceliği</label>
                          <input
                            type="number"
                            value={priority}
                            onChange={(e) => setPriority(parseInt(e.target.value) || 0)}
                            className="w-full h-11 border border-zinc-200 rounded-2xl px-4 text-xs font-semibold text-zinc-700 outline-none focus:ring-4 focus:ring-[#df0000]/5 focus:border-[#df0000] transition-all"
                            placeholder="0"
                          />
                        </div>
                        <div className="grid gap-4 sm:grid-cols-2">
                          <div>
                            <label className="block text-[11px] font-extrabold tracking-wider text-zinc-400 uppercase mb-2">Minimum Sepet Tutarı (TL)</label>
                            <input
                              type="number"
                              min="0"
                              value={minOrderAmount}
                              onChange={(e) => setMinOrderAmount(parseFloat(e.target.value) || 0)}
                              className="w-full h-11 border border-zinc-200 rounded-2xl px-4 text-xs font-semibold text-zinc-700 outline-none focus:ring-4 focus:ring-[#df0000]/5 focus:border-[#df0000] transition-all"
                              placeholder="₺0"
                            />
                          </div>
                          <div className="flex items-center h-full pt-6">
                            <label className="flex items-center gap-2 cursor-pointer select-none">
                              <input
                                type="checkbox"
                                checked={isActive}
                                onChange={(e) => setIsActive(e.target.checked)}
                                className="w-4 h-4 rounded text-[#df0000] focus:ring-[#df0000]/20 border-zinc-300"
                              />
                              <span className="text-xs font-bold text-zinc-700">Kampanya Aktif / Yayında</span>
                            </label>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="space-y-4">
                    {type !== 'BuyXGetY' && (
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div>
                          <label className="block text-[11px] font-extrabold tracking-wider text-zinc-400 uppercase mb-2">Kural Önceliği</label>
                          <input
                            type="number"
                            value={priority}
                            onChange={(e) => setPriority(parseInt(e.target.value) || 0)}
                            className="w-full h-11 border border-zinc-200 rounded-2xl px-4 text-xs font-semibold text-zinc-700 outline-none focus:ring-4 focus:ring-[#df0000]/5 focus:border-[#df0000] transition-all"
                            placeholder="0"
                          />
                        </div>
                      </div>
                    )}

                    {(type === 'Percentage' || type === 'FixedAmount') && (
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div>
                          <label className="block text-[11px] font-extrabold tracking-wider text-zinc-400 uppercase mb-2">
                            {type === 'Percentage' ? 'İndirim Oranı (%) *' : 'İndirim Tutarı (TL) *'}
                          </label>
                          <input
                            type="number"
                            required
                            min="0.01"
                            step="any"
                            value={discountValue}
                            onChange={(e) => setDiscountValue(parseFloat(e.target.value) || 0)}
                            className="w-full h-11 border border-zinc-200 rounded-2xl px-4 text-xs font-semibold text-zinc-700 outline-none focus:ring-4 focus:ring-[#df0000]/5 focus:border-[#df0000] transition-all"
                            placeholder="0"
                          />
                        </div>
                        {type === 'Percentage' && (
                          <div>
                            <label className="block text-[11px] font-extrabold tracking-wider text-zinc-400 uppercase mb-2">Maksimum İndirim Limiti (Opsiyonel)</label>
                            <input
                              type="number"
                              min="0"
                              value={maxDiscountAmount}
                              onChange={(e) => setMaxDiscountAmount(e.target.value)}
                              className="w-full h-11 border border-zinc-200 rounded-2xl px-4 text-xs font-semibold text-zinc-700 outline-none focus:ring-4 focus:ring-[#df0000]/5 focus:border-[#df0000] transition-all"
                              placeholder="Sınırsız"
                            />
                          </div>
                        )}
                      </div>
                    )}

                    {type !== 'BuyXGetY' && (
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div>
                          <label className="block text-[11px] font-extrabold tracking-wider text-zinc-400 uppercase mb-2">
                            {(scope === 'Product' && (type === 'Percentage' || type === 'FixedAmount')) 
                              ? 'Minimum Ürün Fiyatı (TL)' 
                              : 'Minimum Sepet Tutarı (TL)'}
                          </label>
                          <input
                            type="number"
                            min="0"
                            value={minOrderAmount}
                            onChange={(e) => setMinOrderAmount(parseFloat(e.target.value) || 0)}
                            className="w-full h-11 border border-zinc-200 rounded-2xl px-4 text-xs font-semibold text-zinc-700 outline-none focus:ring-4 focus:ring-[#df0000]/5 focus:border-[#df0000] transition-all"
                            placeholder="₺0"
                          />
                        </div>
                        
                        <div className="flex items-center h-full pt-6">
                          <label className="flex items-center gap-2 cursor-pointer select-none">
                            <input
                              type="checkbox"
                              checked={isActive}
                              onChange={(e) => setIsActive(e.target.checked)}
                              className="w-4 h-4 rounded text-[#df0000] focus:ring-[#df0000]/20 border-zinc-300"
                            />
                            <span className="text-xs font-bold text-zinc-700">Kampanya Aktif / Yayında</span>
                          </label>
                        </div>
                      </div>
                    )}

                    {type === 'GiftProduct' && (
                      <div>
                        <label className="block text-[11px] font-extrabold tracking-wider text-zinc-400 uppercase mb-2">Hediye Verilecek Ürün *</label>
                        <ProductSearchSelect
                          products={products}
                          value={giftProductId}
                          onChange={setGiftProductId}
                          placeholder="-- Hediye Ürün Seçin --"
                        />
                      </div>
                    )}

                    {type === 'BuyXGetY' && (
                      <div className="space-y-4 border border-zinc-200 rounded-3xl p-5 bg-zinc-50/50">
                        <div>
                          <label className="block text-[11px] font-extrabold tracking-wider text-zinc-400 uppercase mb-2">Kampanya Kapsamı</label>
                          <div className="grid grid-cols-2 gap-4">
                            <button
                              type="button"
                              onClick={() => setBuyXGetYType('Single')}
                              className={`flex items-center justify-center gap-2 p-3 rounded-2xl border text-xs font-bold transition-all ${
                                buyXGetYType === 'Single'
                                  ? 'bg-white border-[#df0000] text-[#df0000] shadow-[0_4px_12px_rgba(223,0,0,0.05)]'
                                  : 'bg-white border-zinc-200 text-zinc-650 hover:bg-zinc-50'
                              }`}
                            >
                              <span className="material-symbols-outlined text-[18px]">inventory_2</span>
                              Tek Ürün Bazlı
                            </button>
                            <button
                              type="button"
                              onClick={() => setBuyXGetYType('Multi')}
                              className={`flex items-center justify-center gap-2 p-3 rounded-2xl border text-xs font-bold transition-all ${
                                buyXGetYType === 'Multi'
                                  ? 'bg-white border-[#df0000] text-[#df0000] shadow-[0_4px_12px_rgba(223,0,0,0.05)]'
                                  : 'bg-white border-zinc-200 text-zinc-650 hover:bg-zinc-50'
                              }`}
                            >
                              <span className="material-symbols-outlined text-[18px]">group_work</span>
                              Çok Ürün Bazlı
                            </button>
                          </div>
                          <p className="text-[10px] text-zinc-400 font-medium mt-1">
                            {buyXGetYType === 'Single' 
                              ? 'Seçilen trigger üründen X adet alınması durumunda hediye tetiklenir.'
                              : 'Seçilen trigger ürünlerinin hepsinden en az 1 adet alınması durumunda hediye tetiklenir.'}
                          </p>
                        </div>

                        {/* Trigger Products select based on mode */}
                        {buyXGetYType === 'Single' ? (
                          <div>
                            <label className="block text-[11px] font-extrabold tracking-wider text-zinc-400 uppercase mb-2">Satın Alınacak Ürün *</label>
                            <ProductSearchSelect
                              products={products}
                              value={singleTriggerProductId}
                              onChange={setSingleTriggerProductId}
                              placeholder="-- Satın Alınacak Ürün Seçin --"
                            />
                          </div>
                        ) : (
                          <div className="space-y-3">
                            <div className="flex items-center justify-between">
                              <label className="block text-[11px] font-extrabold tracking-wider text-zinc-400 uppercase">Satın Alınacak Ürünler *</label>
                              <Button
                                type="button"
                                variant="outline"
                                onClick={() => setMultiTriggerProductIds(prev => [...prev, ''])}
                                className="rounded-xl text-xs h-8 border-zinc-200"
                                icon="add"
                              >
                                Ürün Ekle
                              </Button>
                            </div>
                            {multiTriggerProductIds.map((pid, idx) => (
                              <div key={idx} className="flex gap-3 items-center">
                                <div className="flex-1">
                                  <ProductSearchSelect
                                    products={products}
                                    value={pid}
                                    onChange={(newVal) => {
                                      const updated = [...multiTriggerProductIds]
                                      updated[idx] = newVal
                                      setMultiTriggerProductIds(updated)
                                    }}
                                    placeholder="-- Satın Alınacak Ürün Seçin --"
                                  />
                                </div>
                                {multiTriggerProductIds.length > 2 && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setMultiTriggerProductIds(prev => prev.filter((_, i) => i !== idx))
                                    }}
                                    className="w-11 h-11 rounded-2xl hover:bg-red-50 flex items-center justify-center text-red-500 hover:text-red-700 transition-colors border border-zinc-200 bg-white shrink-0 active:scale-95"
                                    title="Sil"
                                  >
                                    <span className="material-symbols-outlined text-[20px]">delete</span>
                                  </button>
                                )}
                              </div>
                            ))}
                          </div>
                        )}

                        {buyXGetYType === 'Single' ? (
                          <div className="grid gap-4 sm:grid-cols-2">
                            <div>
                              <label className="block text-[11px] font-extrabold tracking-wider text-zinc-400 uppercase mb-2">Alınması Gereken Adet (X) *</label>
                              <input
                                type="number"
                                required
                                min="1"
                                value={buyQuantity}
                                onChange={(e) => setBuyQuantity(parseInt(e.target.value) || 1)}
                                className="w-full h-11 border border-zinc-200 rounded-2xl px-4 text-xs font-semibold text-zinc-700 outline-none focus:ring-4 focus:ring-[#df0000]/5 focus:border-[#df0000] transition-all"
                              />
                            </div>
                            <div>
                              <label className="block text-[11px] font-extrabold tracking-wider text-zinc-400 uppercase mb-2">Hediye Edilecek Adet (Y) *</label>
                              <input
                                type="number"
                                required
                                min="1"
                                value={giftQuantity}
                                onChange={(e) => setGiftQuantity(parseInt(e.target.value) || 1)}
                                className="w-full h-11 border border-zinc-200 rounded-2xl px-4 text-xs font-semibold text-zinc-700 outline-none focus:ring-4 focus:ring-[#df0000]/5 focus:border-[#df0000] transition-all"
                              />
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2.5 cursor-pointer select-none py-1">
                            <input
                              type="checkbox"
                              id="buyXGetYScale"
                              checked={buyXGetYScale}
                              onChange={(e) => setBuyXGetYScale(e.target.checked)}
                              className="w-4 h-4 rounded text-[#df0000] focus:ring-[#df0000]/20 border-zinc-300"
                            />
                            <label htmlFor="buyXGetYScale" className="text-xs font-bold text-zinc-700 cursor-pointer select-none">
                              Her üründen X adet alınırsa X adet hediye edilsin mi? (Katlı Hediye)
                            </label>
                          </div>
                        )}

                        <div>
                          <label className="block text-[11px] font-extrabold tracking-wider text-zinc-400 uppercase mb-2">Hediye Edilecek Ürün *</label>
                          <ProductSearchSelect
                            products={products}
                            value={giftProductId}
                            onChange={setGiftProductId}
                            placeholder="-- Hediye Ürün Seçin --"
                          />
                        </div>
                      </div>
                    )}

                    {/* Image picker */}
                    <div>
                      <label className="block text-[11px] font-extrabold tracking-wider text-zinc-400 uppercase mb-2">Kampanya Görseli (Opsiyonel)</label>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={imageUrl}
                          onChange={(e) => setImageUrl(e.target.value)}
                          placeholder="Görsel URL veya medya seçin"
                          className="flex-1 h-11 border border-zinc-200 rounded-2xl px-4 text-xs font-semibold text-zinc-700 outline-none focus:ring-4 focus:ring-[#df0000]/5 focus:border-[#df0000] transition-all"
                        />
                        <Button 
                          type="button"
                          variant="outline" 
                          onClick={() => setMediaOpen(true)}
                          className="rounded-2xl shrink-0 h-11"
                        >
                          Seç
                        </Button>
                      </div>
                      {imageUrl && (
                        <div className="mt-2 w-28 h-16 border border-zinc-200 rounded-xl overflow-hidden bg-zinc-50">
                          <img src={imageUrl} className="w-full h-full object-cover" alt="Preview" />
                        </div>
                      )}
                    </div>

                    {type === 'Brand' && (
                      <div className="border border-zinc-200 rounded-3xl p-5 bg-zinc-50/50 space-y-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <span className="text-xs font-extrabold text-zinc-800 uppercase tracking-wider">Marka Bazlı İndirim Matrisi</span>
                            <p className="text-[10px] text-zinc-400 font-medium mt-0.5">Markalara özel indirim oranlarını veya tutarlarını tanımlayın.</p>
                          </div>
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => {
                              setBrandRules(prev => [...prev, { brandName: '', discountType: 'Percentage', discountValue: 0 }])
                            }}
                            className="rounded-xl text-xs h-9 border-zinc-200"
                            icon="add"
                          >
                            Satır Ekle
                          </Button>
                        </div>

                        {brandRules.length === 0 ? (
                          <div className="border border-dashed border-zinc-300 rounded-2xl py-8 text-center text-xs font-semibold text-zinc-400">
                            Tanımlı marka kuralı bulunmuyor. Başlamak için "Satır Ekle" butonuna tıklayın.
                          </div>
                        ) : (
                          <div className="space-y-3">
                            {brandRules.map((rule, idx) => (
                              <div key={idx} className="flex gap-3 items-center bg-white p-3 border border-zinc-200/60 rounded-2xl shadow-[0_2px_4px_rgba(0,0,0,0.01)] animate-in slide-in-from-top-1 duration-150">
                                <div className="flex-1">
                                  <select
                                    value={rule.brandName}
                                    onChange={(e) => {
                                      const updated = [...brandRules]
                                      updated[idx].brandName = e.target.value
                                      setBrandRules(updated)
                                    }}
                                    className="w-full h-10 border border-zinc-200 rounded-xl px-3 text-xs font-semibold text-zinc-700 bg-white outline-none focus:border-[#df0000]"
                                  >
                                    <option value="">-- Marka Seçin --</option>
                                    {brands.map(b => (
                                      <option key={b.id} value={b.name}>{b.name}</option>
                                    ))}
                                  </select>
                                </div>
                                <div className="w-32">
                                  <select
                                    value={rule.discountType}
                                    onChange={(e) => {
                                      const updated = [...brandRules]
                                      updated[idx].discountType = e.target.value as any
                                      setBrandRules(updated)
                                    }}
                                    className="w-full h-10 border border-zinc-200 rounded-xl px-3 text-xs font-semibold text-zinc-700 bg-white outline-none focus:border-[#df0000]"
                                  >
                                    <option value="Percentage">Yüzdesel (%)</option>
                                    <option value="FixedAmount">Sabit (TL)</option>
                                  </select>
                                </div>
                                <div className="w-36">
                                  <input
                                    type="number"
                                    min="0.01"
                                    step="any"
                                    placeholder="Değer"
                                    value={rule.discountValue || ''}
                                    onChange={(e) => {
                                      const updated = [...brandRules]
                                      updated[idx].discountValue = parseFloat(e.target.value) || 0
                                      setBrandRules(updated)
                                    }}
                                    className="w-full h-10 border border-zinc-200 rounded-xl px-3 text-xs font-semibold text-zinc-700 outline-none focus:border-[#df0000]"
                                  />
                                </div>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setBrandRules(prev => prev.filter((_, i) => i !== idx))
                                  }}
                                  className="w-9 h-9 rounded-xl hover:bg-red-50 flex items-center justify-center text-red-500 hover:text-red-700 transition-colors border border-transparent hover:border-red-100 shrink-0"
                                >
                                  <span className="material-symbols-outlined text-[20px]">delete_forever</span>
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Target Scope Section */}
                {scope !== 'Cart' && type !== 'Brand' && type !== 'BuyXGetY' && (
                  <div className="border-t border-zinc-200 pt-6 space-y-4">
                    <h4 className="text-xs font-extrabold text-zinc-800 uppercase tracking-wider">Hedef Kapsam ve Kısıtlar</h4>
                    <p className="text-[11px] text-zinc-400 font-medium">
                      Hiçbir ürün, kategori veya marka seçilmezse kampanya global / tüm sepete uygulanacaktır.
                    </p>

                    <div className="grid gap-6 md:grid-cols-3">
                      {/* Categories Target */}
                      <div className="border border-zinc-200 rounded-2xl p-4 bg-zinc-50/50 flex flex-col h-[280px]">
                        <span className="text-[10px] font-extrabold tracking-wider text-zinc-400 uppercase mb-2">Hedef Kategoriler</span>
                        <div className="flex-1 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
                          {categories.map(c => (
                            <label key={c.id} className="flex items-center gap-2 cursor-pointer py-0.5 hover:bg-zinc-100/50 rounded px-1">
                              <input
                                type="checkbox"
                                checked={selectedCategoryIds.includes(c.id)}
                                onChange={() => toggleCategory(c.id)}
                                className="w-3.5 h-3.5 rounded text-[#df0000] focus:ring-[#df0000]/10 border-zinc-300"
                              />
                              <span className="text-xs font-semibold text-zinc-700">{c.name}</span>
                            </label>
                          ))}
                        </div>
                      </div>

                      {/* Brands Target */}
                      <div className="border border-zinc-200 rounded-2xl p-4 bg-zinc-50/50 flex flex-col h-[280px]">
                        <span className="text-[10px] font-extrabold tracking-wider text-zinc-400 uppercase mb-1">Hedef Markalar</span>
                        <input
                          type="text"
                          placeholder="Marka ara..."
                          value={brandSearch}
                          onChange={(e) => setBrandSearch(e.target.value)}
                          className="h-8 border border-zinc-200 rounded-xl px-3 text-xs outline-none focus:border-[#df0000] mb-2 font-medium"
                        />
                        <div className="flex-1 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
                          {filteredBrands.map(b => (
                            <label key={b.id} className="flex items-center gap-2 cursor-pointer py-0.5 hover:bg-zinc-100/50 rounded px-1">
                              <input
                                type="checkbox"
                                checked={selectedBrands.includes(b.name)}
                                onChange={() => toggleBrand(b.name)}
                                className="w-3.5 h-3.5 rounded text-[#df0000] focus:ring-[#df0000]/10 border-zinc-300"
                              />
                              <span className="text-xs font-semibold text-zinc-700">{b.name}</span>
                            </label>
                          ))}
                        </div>
                      </div>

                      {/* Products Target */}
                      <div className="border border-zinc-200 rounded-2xl p-4 bg-zinc-50/50 flex flex-col h-[280px]">
                        <span className="text-[10px] font-extrabold tracking-wider text-zinc-400 uppercase mb-1">Hedef Ürünler</span>
                        <input
                          type="text"
                          placeholder="Ürün ara..."
                          value={prodSearch}
                          onChange={(e) => setProdSearch(e.target.value)}
                          className="h-8 border border-zinc-200 rounded-xl px-3 text-xs outline-none focus:border-[#df0000] mb-2 font-medium"
                        />
                        <div className="flex-1 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
                          {filteredProducts.map(p => (
                            <label key={p.id} className="flex items-center gap-2 cursor-pointer py-0.5 hover:bg-zinc-100/50 rounded px-1">
                              <input
                                type="checkbox"
                                checked={selectedProductIds.includes(p.id)}
                                onChange={() => toggleProduct(p.id)}
                                className="w-3.5 h-3.5 rounded text-[#df0000] focus:ring-[#df0000]/10 border-zinc-300"
                              />
                              <span className="text-xs font-semibold text-zinc-700 truncate" title={`${p.name} (${p.stockCode})`}>
                                {p.name}
                              </span>
                            </label>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                <div className="flex justify-end gap-3 border-t border-zinc-200 pt-5">
                  <Button 
                    type="button"
                    variant="outline" 
                    onClick={() => setModalOpen(false)}
                    className="rounded-2xl"
                  >
                    Vazgeç
                  </Button>
                  <Button 
                    type="submit" 
                    variant="primary"
                    icon="save"
                    className="rounded-2xl bg-[#df0000] hover:bg-[#c00000] active:scale-[0.98]"
                  >
                    Kaydet
                  </Button>
                </div>
              </form>
            </div>
          </div>
        )}

        <MediaLibraryModal
          isOpen={mediaOpen}
          onClose={() => setMediaOpen(false)}
          onSelect={handleMediaSelect}
          activeFolder="Campaigns"
        />
      </div>
    </AdminLayout>
  )
}
