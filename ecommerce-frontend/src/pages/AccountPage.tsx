import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { getMemberToken, readApiResponse } from '../lib/api'
import { useToast } from '../components/ui/ToastContext'
import { useConfirm } from '../components/ui/ConfirmContext'
import { SearchableSelect } from '../components/ui/SearchableSelect'
import cyprusData from '../lib/cyprusAddresses.json'
import { generateSlug } from '../lib/slug'

type MeDto = {
  id: string
  email: string
  fullName?: string | null
  phone?: string | null
}

type OrderLine = {
  productId: string
  tenantCode: string
  productName: string
  unitPrice: number
  quantity: number
  lineTotal: number
  imageUrl?: string
}

type StoreOrderDto = {
  id: string
  orderNo: string
  status: string
  paymentStatus: string
  total: number
  createdAtUtc: string
  lines: OrderLine[]
  customerName?: string
  email?: string
  phone?: string
  address?: string
  couponCode?: string
  discountAmount?: number
  campaignDiscountAmount?: number
  cargoFee?: number
}

type Address = {
  id: string
  title: string
  fullName: string
  phone: string
  city: string
  district: string
  region?: string
  mahalle?: string
  binaNo?: string
  daireNo?: string
  katNo?: string
  details: string
}

type Warranty = {
  id: string
  serialNo: string
  productName: string
  fullName: string
  email: string
  invoiceDate: string
  durationYears: number
  status: 'active' | 'expired'
  remainingText?: string
}

type ServiceRequest = {
  id: string
  fullName: string
  phone: string
  productGroup: string
  modelNo: string
  description: string
  status: string
  createdAt: string
}

type MyReview = {
  id: string
  productId: string
  productName: string
  rating: number
  comment: string
  status: string
  createdAtUtc: string
}

function initialsOf(nameOrEmail: string) {
  const s = String(nameOrEmail || '').trim()
  if (!s) return '??'
  const parts = s.split(/\s+/g).filter(Boolean)
  if (parts.length >= 2) return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`.toUpperCase()
  return (parts[0].slice(0, 2) || '??').toUpperCase()
}

export function AccountPage() {
  const nav = useNavigate()
  const { showToast } = useToast()
  const confirm = useConfirm()
  const token = useMemo(() => getMemberToken(), [])

  const [me, setMe] = useState<MeDto | null>(null)
  const [orders, setOrders] = useState<StoreOrderDto[]>([])
  const [expandedOrders, setExpandedOrders] = useState<Record<string, boolean>>({})
  const [reviews, setReviews] = useState<MyReview[]>([])

  const toggleOrderExpand = (id: string) => {
    const isExpanding = !expandedOrders[id]
    setExpandedOrders(prev => ({ ...prev, [id]: isExpanding }))
  }
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Navigation state
  const [activeTab, setActiveTab] = useState<'dashboard' | 'orders' | 'reviews' | 'addresses' | 'warranty' | 'service' | 'settings' | 'coupons' | 'registered-products'>('dashboard')
  const [isDropdownOpen, setIsDropdownOpen] = useState(false)

  // Read tab from query parameters
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const tab = params.get('tab')
    if (tab === 'registered-products' || tab === 'orders' || tab === 'reviews' || tab === 'addresses' || tab === 'warranty' || tab === 'service' || tab === 'settings' || tab === 'coupons') {
      setActiveTab(tab as any)
    }
  }, [])

  // Address State
  const [addresses, setAddresses] = useState<Address[]>([])
  const [showAddressForm, setShowAddressForm] = useState(false)
  const [addressToEdit, setAddressToEdit] = useState<Address | null>(null)
  const [addrTitle, setAddrTitle] = useState('')
  const [addrFullName, setAddrFullName] = useState('')
  const [addrPhone, setAddrPhone] = useState('')
  const [addrCity, setAddrCity] = useState('')
  const [addrDistrict, setAddrDistrict] = useState('')
  const [addrRegion, setAddrRegion] = useState('')
  const [addrMahalle, setAddrMahalle] = useState('')
  const [addrBinaNo, setAddrBinaNo] = useState('')
  const [addrDaireNo, setAddrDaireNo] = useState('')
  const [addrKatNo, setAddrKatNo] = useState('')
  const [addrDetails, setAddrDetails] = useState('')

  // Warranty State
  const [warranties, setWarranties] = useState<Warranty[]>([])
  const [warrantySearchQuery, setWarrantySearchQuery] = useState('')
  const [warrantySearchResult, setWarrantySearchResult] = useState<Warranty | null | undefined>(undefined)
  const [newWarrantySerial, setNewWarrantySerial] = useState('')
  const [newWarrantyInvoiceDate, setNewWarrantyInvoiceDate] = useState('')
  const [newWarrantyKVKK, setNewWarrantyKVKK] = useState(false)
  const [warrantyMsg, setWarrantyMsg] = useState<{ type: 'success' | 'error', text: string } | null>(null)

  // Service State
  const [serviceRequests, setServiceRequests] = useState<ServiceRequest[]>([])
  const [showServiceForm, setShowServiceForm] = useState(false)
  const [serviceDescription, setServiceDescription] = useState('')
  const [serviceKVKK, setServiceKVKK] = useState(false)
  const [serviceMsg, setServiceMsg] = useState<{ type: 'success' | 'error', text: string } | null>(null)

  // Coupon State
  const [coupons, setCoupons] = useState<any[]>([])

  // Registered Products State
  const [registeredProducts, setRegisteredProducts] = useState<any[]>([])
  const [showRegForm, setShowRegForm] = useState(false)
  const [regCategoryId, setRegCategoryId] = useState('')
  const [regProductId, setRegProductId] = useState('')
  const [regProductsList, setRegProductsList] = useState<any[]>([])
  const [regLoadingProducts, setRegLoadingProducts] = useState(false)
  const [regSerialNo, setRegSerialNo] = useState('')
  const [regKVKK, setRegKVKK] = useState(false)
  const [regPhone, setRegPhone] = useState('')
  const [regMsg, setRegMsg] = useState<{ type: 'success' | 'error', text: string } | null>(null)
  const [regLoading, setRegLoading] = useState(false)

  // Service Category-Product Selection State
  const [allCategories, setAllCategories] = useState<any[]>([])
  const [allProducts, setAllProducts] = useState<any[]>([])
  const [selectedCategoryId, setSelectedCategoryId] = useState('')
  const [selectedProductId, setSelectedProductId] = useState('')
  const [loadingProducts, setLoadingProducts] = useState(false)

  // Load categories when showServiceForm or showRegForm is activated
  useEffect(() => {
    if (showServiceForm || showRegForm) {
      fetch('/api/storefront/categories')
        .then((r) => r.json())
        .then((json) => {
          if (json?.success && Array.isArray(json.data)) {
            setAllCategories(json.data)
          }
        })
        .catch((err) => console.error('Failed to fetch categories', err))
    }
  }, [showServiceForm, showRegForm])

  // Fetch products when registration category selection changes
  useEffect(() => {
    if (!regCategoryId) {
      setRegProductsList([])
      setRegProductId('')
      return
    }
    const cat = allCategories.find(c => c.id === regCategoryId)
    if (!cat) return

    setRegLoadingProducts(true)
    fetch(`/api/storefront/categories/${cat.slug}/products`)
      .then((r) => r.json())
      .then((json) => {
        if (json?.success && Array.isArray(json.data)) {
          setRegProductsList(json.data)
        } else {
          setRegProductsList([])
        }
        setRegProductId('')
      })
      .catch((err) => {
        console.error('Failed to fetch products', err)
        setRegProductsList([])
      })
      .finally(() => {
        setRegLoadingProducts(false)
      })
  }, [regCategoryId, allCategories])

  // Fetch products when category selection changes
  useEffect(() => {
    if (!selectedCategoryId) {
      setAllProducts([])
      setSelectedProductId('')
      return
    }
    const cat = allCategories.find(c => c.id === selectedCategoryId)
    if (!cat) return

    setLoadingProducts(true)
    fetch(`/api/storefront/categories/${cat.slug}/products`)
      .then((r) => r.json())
      .then((json) => {
        if (json?.success && Array.isArray(json.data)) {
          setAllProducts(json.data)
        } else {
          setAllProducts([])
        }
        setSelectedProductId('')
      })
      .catch((err) => {
        console.error('Failed to fetch products', err)
        setAllProducts([])
      })
      .finally(() => {
        setLoadingProducts(false)
      })
  }, [selectedCategoryId, allCategories])

  // Service Locator State
  const [locatorCity, setLocatorCity] = useState('')
  const [filteredServiceCenters, setFilteredServiceCenters] = useState<{ name: string, type: string, address: string, phone: string, hours: string }[]>([])

  // Social media links (from store design)
  const [socialLinks, setSocialLinks] = useState<{ facebookUrl?: string, instagramUrl?: string, twitterUrl?: string, youtubeUrl?: string }>({})

  // Settings State
  const [settingsFullName, setSettingsFullName] = useState('')
  const [settingsPhone, setSettingsPhone] = useState('')
  const [settingsOldPassword, setSettingsOldPassword] = useState('')
  const [settingsPassword, setSettingsPassword] = useState('')
  const [settingsConfirmPassword, setSettingsConfirmPassword] = useState('')
  const [settingsMsg, setSettingsMsg] = useState<{ type: 'success' | 'error', text: string } | null>(null)
  const [settingsLoading, setSettingsLoading] = useState(false)

  // Load social media links from store design
  useEffect(() => {
    fetch('/api/store-design')
      .then(r => r.json())
      .then(json => {
        if (json?.data) {
          setSocialLinks({
            facebookUrl: json.data.facebookUrl || '',
            instagramUrl: json.data.instagramUrl || '',
            twitterUrl: json.data.twitterUrl || '',
            youtubeUrl: json.data.youtubeUrl || '',
          })
        }
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)

      try {
        const t = getMemberToken()
        if (!t) {
          setMe(null)
          setOrders([])
          setReviews([])
          setError('Hesabını görmek için giriş yapmalısın.')
          return
        }

        const [meRes, ordersRes, reviewsRes] = await Promise.all([
          fetch('/api/auth/me', { headers: { Authorization: `Bearer ${t}` } }),
          fetch('/api/orders/my?take=100', { headers: { Authorization: `Bearer ${t}` } }),
          fetch('/api/storefront/account/reviews', { headers: { Authorization: `Bearer ${t}` } }),
        ])

        const meJson = await readApiResponse(meRes)
        if (!meRes.ok || !meJson?.success) throw new Error(meJson?.message || 'Kullanıcı bilgisi alınamadı')

        const ordersJson = await readApiResponse(ordersRes)
        const reviewsJson = await readApiResponse(reviewsRes)
        if (!ordersRes.ok || !ordersJson?.success) throw new Error(ordersJson?.message || 'Siparişler alınamadı')

        if (!reviewsRes.ok || !reviewsJson?.success) throw new Error(reviewsJson?.message || 'Yorumlar alınamadı')

        const meData: MeDto | null = meJson?.data && typeof meJson.data === 'object' ? (meJson.data as MeDto) : null
        const ordersData: StoreOrderDto[] = Array.isArray(ordersJson?.data) ? (ordersJson.data as StoreOrderDto[]) : []
        const reviewsData: MyReview[] = Array.isArray(reviewsJson?.data) ? (reviewsJson.data as MyReview[]) : []

        if (!cancelled) {
          setMe(meData)
          setOrders(ordersData)
          setReviews(reviewsData)
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Veriler yüklenemedi')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [token])

  // Initialize seeded local data when me is loaded
  useEffect(() => {
    if (me?.id) {
      setSettingsFullName(me.fullName || '')
      setSettingsPhone(me.phone || '')

      const loadBackendData = async () => {
        try {
          const headers = { Authorization: `Bearer ${token}` }

          const [addrRes, wrRes, srRes, cpRes, rpRes] = await Promise.all([
            fetch('/api/storefront/addresses', { headers }),
            fetch('/api/storefront/warranties', { headers }),
            fetch('/api/storefront/service-requests', { headers }),
            fetch('/api/storefront/coupons', { headers }),
            fetch('/api/storefront/registered-products', { headers }),
          ])

          const addrJson = await readApiResponse(addrRes)
          if (addrRes.ok && addrJson?.success && Array.isArray(addrJson.data)) {
            setAddresses(addrJson.data)
          }

          const wrJson = await readApiResponse(wrRes)
          if (wrRes.ok && wrJson?.success && Array.isArray(wrJson.data)) {
            const mappedWarranties = wrJson.data.map((w: any) => ({
              id: w.id,
              serialNo: w.warrantyCode,
              productName: w.productName,
              fullName: w.customerName,
              email: w.customerEmail,
              invoiceDate: w.soldDate,
              durationYears: w.warrantyMonths / 12,
              status: w.status,
              remainingText: w.remainingText
            }))
            setWarranties(mappedWarranties)
          }

          const srJson = await readApiResponse(srRes)
          if (srRes.ok && srJson?.success && Array.isArray(srJson.data)) {
            setServiceRequests(srJson.data)
          }

          const cpJson = await readApiResponse(cpRes)
          if (cpRes.ok && cpJson?.success && Array.isArray(cpJson.data)) {
            setCoupons(cpJson.data)
          }

          const rpJson = await readApiResponse(rpRes)
          if (rpRes.ok && rpJson?.success && Array.isArray(rpJson.data)) {
            setRegisteredProducts(rpJson.data)
          }
        } catch (err) {
          console.error('Failed to load profile details from backend', err)
        }
      }

      loadBackendData()
    }
  }, [me, token])

  const displayName = (me?.fullName || '').trim() || (me?.email || '').trim() || 'Misafir'
  const initials = initialsOf(displayName)

  const activeWarrantiesCount = useMemo(() => {
    return warranties.filter((w) => w.status === 'active').length
  }, [warranties])

  // Service centers filter
  const allServiceCenters = useMemo(() => [
    { city: 'İstanbul', name: 'Merkez Teknik Servis', type: 'Merkez', address: 'Atatürk Mah. İkitelli Cad. No:12/A Küçükçekmece, İstanbul', phone: '444 8 222', hours: '09:00 - 18:00' },
    { city: 'İstanbul', name: 'Anadolu Yakası Servis', type: 'Yetkili', address: 'Fahrettin Kerim Gökay Cad. No:154 Göztepe, Kadıköy', phone: '0216 345 67 89', hours: '09:00 - 19:00' },
    { city: 'Ankara', name: 'Kızılay Yetkili Servisi', type: 'Yetkili', address: 'Atatürk Bulvarı No: 85, Çankaya, Ankara', phone: '0312 419 22 33', hours: '09:00 - 18:30' },
    { city: 'İzmir', name: 'Alsancak Teknik Destek', type: 'Yetkili', address: 'Kıbrıs Şehitleri Cad. No: 122 D: 4, Konak, İzmir', phone: '0232 464 11 22', hours: '09:00 - 18:00' },
    { city: 'Bursa', name: 'Nilüfer Stilsoft Servisi', type: 'Yetkili', address: 'Fatih Sultan Mehmet Bulvarı No: 98, Nilüfer, Bursa', phone: '0224 452 33 44', hours: '09:00 - 19:00' }
  ], [])

  useEffect(() => {
    if (locatorCity) {
      setFilteredServiceCenters(allServiceCenters.filter(c => c.city === locatorCity))
    } else {
      setFilteredServiceCenters([])
    }
  }, [locatorCity, allServiceCenters])

  function logout() {
    localStorage.removeItem('ecom_member_token')
    localStorage.removeItem('ecom_member_user')
    showToast('Çıkış işleminiz başarıyla tamamlandı. Tekrar görüşmek üzere!', 'success', 2000)
    nav('/')
  }

  // Address Actions
  function openAddAddress() {
    setAddressToEdit(null)
    setAddrTitle('')
    setAddrFullName(me?.fullName || '')
    setAddrPhone(me?.phone || '')
    setAddrCity('Kuzey Kıbrıs (KKTC)')
    setAddrDistrict('')
    setAddrRegion('')
    setAddrMahalle('')
    setAddrBinaNo('')
    setAddrDaireNo('')
    setAddrKatNo('')
    setAddrDetails('')
    setShowAddressForm(true)
  }

  function openEditAddress(addr: Address) {
    setAddressToEdit(addr)
    setAddrTitle(addr.title)
    setAddrFullName(addr.fullName)
    setAddrPhone(addr.phone)
    setAddrCity(addr.city || 'Kuzey Kıbrıs (KKTC)')
    setAddrDistrict(addr.district)
    setAddrRegion(addr.region || '')
    setAddrMahalle(addr.mahalle || '')
    setAddrBinaNo(addr.binaNo || '')
    setAddrDaireNo(addr.daireNo || '')
    setAddrKatNo(addr.katNo || '')
    setAddrDetails(addr.details)
    setShowAddressForm(true)
  }

  async function handleSaveAddress(e: React.FormEvent) {
    e.preventDefault()
    if (!me?.id) return
    if (!addrTitle || !addrFullName || !addrPhone || !addrCity || !addrDistrict || !addrRegion || !addrMahalle || !addrBinaNo || !addrDaireNo || !addrKatNo || !addrDetails) {
      showToast('Lütfen tüm alanları doldurun.', 'warning')
      return
    }

    try {
      const payload = {
        title: addrTitle,
        fullName: addrFullName,
        phone: addrPhone,
        city: addrCity,
        district: addrDistrict,
        region: addrRegion,
        mahalle: addrMahalle,
        binaNo: addrBinaNo,
        daireNo: addrDaireNo,
        katNo: addrKatNo,
        details: addrDetails
      }

      let res: Response
      if (addressToEdit) {
        res = await fetch(`/api/storefront/addresses/${addressToEdit.id}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify(payload)
        })
      } else {
        res = await fetch('/api/storefront/addresses', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify(payload)
        })
      }

      const json = await readApiResponse(res)
      if (res.ok && json?.success) {
        // Reload addresses
        const reloadRes = await fetch('/api/storefront/addresses', {
          headers: { Authorization: `Bearer ${token}` }
        })
        const reloadJson = await readApiResponse(reloadRes)
        if (reloadRes.ok && reloadJson?.success && Array.isArray(reloadJson.data)) {
          setAddresses(reloadJson.data)
        }
        setShowAddressForm(false)
        setAddressToEdit(null)
        showToast(addressToEdit ? 'Adres başarıyla güncellendi.' : 'Adres başarıyla eklendi.', 'success')
      } else {
        showToast(json?.message || 'Adres kaydedilemedi.', 'error')
      }
    } catch {
      showToast('Bağlantı hatası oluştu.', 'error')
    }
  }

  async function handleDeleteAddress(id: string) {
    if (!me?.id) return
    const ok = await confirm('Bu adresi silmek istediğinize emin misiniz?', { type: 'danger', confirmText: 'Evet, Sil', title: 'Adres Sil' })
    if (!ok) return
    try {
      const res = await fetch(`/api/storefront/addresses/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      })
      const json = await readApiResponse(res)
      if (res.ok && json?.success) {
        setAddresses(prev => prev.filter(a => a.id !== id))
        showToast('Adres başarıyla silindi.', 'success')
      } else {
        showToast(json?.message || 'Adres silinemedi.', 'error')
      }
    } catch {
      showToast('Bağlantı hatası oluştu.', 'error')
    }
  }

  // Warranty Actions
  function handleRegisterWarranty(e: React.FormEvent) {
    e.preventDefault()
    if (!me?.id) return
    setWarrantyMsg(null)

    if (!newWarrantySerial || !newWarrantyInvoiceDate) {
      setWarrantyMsg({ type: 'error', text: 'Seri numarası ve fatura tarihi gereklidir.' })
      return
    }
    if (!newWarrantyKVKK) {
      setWarrantyMsg({ type: 'error', text: 'Garanti koşullarını kabul etmelisiniz.' })
      return
    }

    const newReq: Warranty = {
      id: String(Date.now()),
      serialNo: newWarrantySerial,
      productName: 'Yeni Kayıtlı Cihaz',
      fullName: me.fullName || '',
      email: me.email || '',
      invoiceDate: newWarrantyInvoiceDate,
      durationYears: 2,
      status: 'active'
    }

    const updated = [...warranties, newReq]
    setWarranties(updated)
    localStorage.setItem(`ecom_warranties_${me.id}`, JSON.stringify(updated))

    setNewWarrantySerial('')
    setNewWarrantyInvoiceDate('')
    setNewWarrantyKVKK(false)
    setWarrantyMsg({ type: 'success', text: 'Garantiniz başarıyla başlatıldı!' })
  }

  async function handleSearchWarranty() {
    if (!warrantySearchQuery.trim()) {
      setWarrantySearchResult(undefined)
      return
    }

    try {
      const res = await fetch(`/api/storefront/warranty/query?code=${encodeURIComponent(warrantySearchQuery.trim())}`)
      const json = await res.json()
      if (res.ok && json?.success && json?.data) {
        setWarrantySearchResult({
          id: json.data.id,
          serialNo: json.data.warrantyCode,
          productName: json.data.productName,
          fullName: json.data.customerName,
          email: '',
          invoiceDate: json.data.soldDate,
          durationYears: json.data.warrantyMonths / 12,
          status: json.data.status,
          remainingText: json.data.remainingText,
        })
      } else {
        setWarrantySearchResult(null)
      }
    } catch {
      setWarrantySearchResult(null)
    }
  }

  // Service Actions
  async function handleCreateServiceRequest(e: React.FormEvent) {
    e.preventDefault()
    if (!me?.id) return
    setServiceMsg(null)

    const catName = allCategories.find(c => c.id === selectedCategoryId)?.name || ''
    const prodName = allProducts.find(p => p.id === selectedProductId)?.name || ''

    if (!catName || !prodName || !serviceDescription) {
      setServiceMsg({ type: 'error', text: 'Lütfen kategori, ürün ve sorununuzun özetini belirtin.' })
      return
    }
    if (!serviceKVKK) {
      setServiceMsg({ type: 'error', text: 'Kişisel verilerinizin işlenmesine onay vermelisiniz.' })
      return
    }

    try {
      const res = await fetch('/api/storefront/service-requests', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          productGroup: catName,
          modelNo: prodName,
          description: serviceDescription
        })
      })

      const json = await readApiResponse(res)
      if (res.ok && json?.success) {
        setSelectedCategoryId('')
        setSelectedProductId('')
        setServiceDescription('')
        setServiceKVKK(false)
        setShowServiceForm(false)
        setServiceMsg({ type: 'success', text: 'Servis talebiniz başarıyla oluşturuldu! Destek ekibimiz en kısa sürede sizinle iletişime geçecektir.' })

        // Reload service requests from backend
        const reloadRes = await fetch('/api/storefront/service-requests', {
          headers: { Authorization: `Bearer ${token}` }
        })
        const reloadJson = await readApiResponse(reloadRes)
        if (reloadRes.ok && reloadJson?.success && Array.isArray(reloadJson.data)) {
          setServiceRequests(reloadJson.data)
        }
      } else {
        setServiceMsg({ type: 'error', text: json?.message || 'Servis talebi oluşturulamadı.' })
      }
    } catch {
      setServiceMsg({ type: 'error', text: 'Bağlantı hatası oluştu.' })
    }
  }

  // Settings Actions
  async function handleUpdateProfile(e: React.FormEvent) {
    e.preventDefault()
    setSettingsMsg(null)

    if (!settingsFullName) {
      setSettingsMsg({ type: 'error', text: 'Ad Soyad alanı zorunludur.' })
      return
    }
    if (settingsPassword) {
      if (!settingsOldPassword) {
        setSettingsMsg({ type: 'error', text: 'Eski şifrenizi girmelisiniz.' })
        return
      }
      if (settingsPassword !== settingsConfirmPassword) {
        setSettingsMsg({ type: 'error', text: 'Şifreler uyuşmuyor.' })
        return
      }
    }

    setSettingsLoading(true)
    try {
      const t = getMemberToken()
      const res = await fetch('/api/auth/update-profile', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${t}`
        },
        body: JSON.stringify({
          fullName: settingsFullName,
          phone: settingsPhone,
          password: settingsPassword || null,
          oldPassword: settingsOldPassword || null
        })
      })

      const json = await readApiResponse(res)
      if (!res.ok || !json?.success) {
        throw new Error(json?.message || 'Profil güncellenirken bir hata oluştu.')
      }

      setSettingsMsg({ type: 'success', text: 'Profiliniz başarıyla güncellendi.' })
      setSettingsOldPassword('')
      setSettingsPassword('')
      setSettingsConfirmPassword('')

      if (json.data) {
        setMe(json.data)
      }
    } catch (e: any) {
      setSettingsMsg({ type: 'error', text: e.message || 'Bir hata oluştu.' })
    } finally {
      setSettingsLoading(false)
    }
  }

  const handleRegisterProductSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!regProductId) {
      setRegMsg({ type: 'error', text: 'Lütfen bir ürün seçin.' })
      return
    }
    if (!regSerialNo.trim()) {
      setRegMsg({ type: 'error', text: 'Seri numarası zorunludur.' })
      return
    }
    const phoneDigits = regPhone.replace(/\D/g, '')
    if (!phoneDigits || phoneDigits.length !== 11) {
      setRegMsg({ type: 'error', text: 'Telefon numarası 11 haneli olmalıdır.' })
      return
    }
    if (!regKVKK) {
      setRegMsg({ type: 'error', text: 'Kişisel verilerin işlenmesini onaylamanız gerekmektedir.' })
      return
    }

    try {
      setRegLoading(true)
      setRegMsg(null)

      const res = await fetch('/api/storefront/registered-products', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          productId: regProductId,
          serialNumber: regSerialNo.trim(),
          phone: phoneDigits
        })
      })

      const json = await readApiResponse(res)
      if (!res.ok || !json?.success) throw new Error(json?.message || 'Ürün kaydedilemedi.')

      // Reload registered products list
      const reloadRes = await fetch('/api/storefront/registered-products', {
        headers: { Authorization: `Bearer ${token}` }
      })
      const reloadJson = await readApiResponse(reloadRes)
      if (reloadRes.ok && reloadJson?.success && Array.isArray(reloadJson.data)) {
        setRegisteredProducts(reloadJson.data)
      }

      // Refetch user profile to update phone number in me state
      const meRes = await fetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${token}` }
      })
      const meJson = await readApiResponse(meRes)
      if (meRes.ok && meJson?.success && meJson?.data) {
        setMe(meJson.data)
      }

      setRegMsg({ type: 'success', text: 'Ürününüz başarıyla kaydedildi!' })
      // Reset form
      setRegCategoryId('')
      setRegProductId('')
      setRegSerialNo('')
      setRegPhone('')
      setRegKVKK(false)
      // Close modal after delay
      setTimeout(() => {
        setShowRegForm(false)
        setRegMsg(null)
      }, 2000)
    } catch (err: any) {
      setRegMsg({ type: 'error', text: err?.message || 'Ürün kaydedilirken bir hata oluştu.' })
    } finally {
      setRegLoading(false)
    }
  }

  return (
    <div className="max-w-7xl mx-auto px-6 pb-20 pt-8">
      <div className="flex flex-col md:flex-row gap-8">
        {/* Sidebar Navigation */}
        <aside className="hidden md:block w-full md:w-72 flex-shrink-0">
          <div className="bg-white rounded-2xl p-6 shadow-sm border border-zinc-100 mb-6">
            <div 
              onClick={() => { setActiveTab('dashboard'); setError(null); }}
              className="flex items-center space-x-4 mb-8 cursor-pointer hover:opacity-80 transition-all duration-200"
            >
              <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-xl border border-primary/20">
                {initials}
              </div>
              <div>
                <p className="font-bold text-lg text-on-surface leading-tight hover:text-primary transition-colors">{displayName}</p>
                <p className="text-xs font-medium text-zinc-500 mt-1">Premium Üye</p>
              </div>
            </div>
            <nav className="space-y-1.5">
              <button
                type="button"
                onClick={() => { setActiveTab('orders'); setError(null); }}
                className={`w-full flex items-center space-x-3 p-3.5 rounded-xl transition-all duration-200 text-left font-medium ${
                  activeTab === 'orders' ? 'bg-primary/10 text-primary font-bold' : 'text-zinc-600 hover:bg-zinc-50 hover:text-primary'
                }`}
              >
                <span className={`material-symbols-outlined text-[20px] ${activeTab === 'orders' ? 'text-primary' : 'text-zinc-400'}`}>shopping_bag</span>
                <span className="text-sm">Siparişlerim</span>
              </button>
              <button
                type="button"
                onClick={() => { setActiveTab('reviews'); setError(null); }}
                className={`w-full flex items-center space-x-3 p-3.5 rounded-xl transition-all duration-200 text-left font-medium ${
                  activeTab === 'reviews' ? 'bg-primary/10 text-primary font-bold' : 'text-zinc-600 hover:bg-zinc-50 hover:text-primary'
                }`}
              >
                <span className={`material-symbols-outlined text-[20px] ${activeTab === 'reviews' ? 'text-primary' : 'text-zinc-400'}`}>rate_review</span>
                <span className="text-sm">Yorumlarım</span>
              </button>
              <button
                type="button"
                onClick={() => { setActiveTab('addresses'); setError(null); }}
                className={`w-full flex items-center space-x-3 p-3.5 rounded-xl transition-all duration-200 text-left font-medium ${
                  activeTab === 'addresses' ? 'bg-primary/10 text-primary font-bold' : 'text-zinc-600 hover:bg-zinc-50 hover:text-primary'
                }`}
              >
                <span className={`material-symbols-outlined text-[20px] ${activeTab === 'addresses' ? 'text-primary' : 'text-zinc-400'}`}>location_on</span>
                <span className="text-sm">Adreslerim</span>
              </button>
              <button
                type="button"
                onClick={() => { setActiveTab('warranty'); setError(null); }}
                className={`w-full flex items-center space-x-3 p-3.5 rounded-xl transition-all duration-200 text-left font-medium ${
                  activeTab === 'warranty' ? 'bg-primary/10 text-primary font-bold' : 'text-zinc-600 hover:bg-zinc-50 hover:text-primary'
                }`}
              >
                <span className={`material-symbols-outlined text-[20px] ${activeTab === 'warranty' ? 'text-primary' : 'text-zinc-400'}`}>verified</span>
                <span className="text-sm">Garanti Takibi</span>
              </button>
              <button
                type="button"
                onClick={() => { setActiveTab('service'); setError(null); }}
                className={`w-full flex items-center space-x-3 p-3.5 rounded-xl transition-all duration-200 text-left font-medium ${
                  activeTab === 'service' ? 'bg-primary/10 text-primary font-bold' : 'text-zinc-600 hover:bg-zinc-50 hover:text-primary'
                }`}
              >
                <span className={`material-symbols-outlined text-[20px] ${activeTab === 'service' ? 'text-primary' : 'text-zinc-400'}`}>build</span>
                <span className="text-sm">Servis Taleplerim</span>
              </button>
              <button
                type="button"
                onClick={() => { setActiveTab('coupons'); setError(null); }}
                className={`w-full flex items-center space-x-3 p-3.5 rounded-xl transition-all duration-200 text-left font-medium ${
                  activeTab === 'coupons' ? 'bg-primary/10 text-primary font-bold' : 'text-zinc-600 hover:bg-zinc-50 hover:text-primary'
                }`}
              >
                <span className={`material-symbols-outlined text-[20px] ${activeTab === 'coupons' ? 'text-primary' : 'text-zinc-400'}`}>confirmation_number</span>
                <span className="text-sm">Kuponlarım</span>
              </button>
              <button
                type="button"
                onClick={() => { setActiveTab('registered-products'); setError(null); }}
                className={`w-full flex items-center space-x-3 p-3.5 rounded-xl transition-all duration-200 text-left font-medium ${
                  activeTab === 'registered-products' ? 'bg-primary/10 text-primary font-bold' : 'text-zinc-600 hover:bg-zinc-50 hover:text-primary'
                }`}
              >
                <span className={`material-symbols-outlined text-[20px] ${activeTab === 'registered-products' ? 'text-primary' : 'text-zinc-400'}`}>app_registration</span>
                <span className="text-sm">Kayıtlı Ürünlerim</span>
              </button>
              <button
                type="button"
                onClick={() => { setActiveTab('settings'); setError(null); }}
                className={`w-full flex items-center space-x-3 p-3.5 rounded-xl transition-all duration-200 text-left font-medium ${
                  activeTab === 'settings' ? 'bg-primary/10 text-primary font-bold' : 'text-zinc-600 hover:bg-zinc-50 hover:text-primary'
                }`}
              >
                <span className={`material-symbols-outlined text-[20px] ${activeTab === 'settings' ? 'text-primary' : 'text-zinc-400'}`}>settings</span>
                <span className="text-sm">Hesap Ayarları</span>
              </button>
              <div className="pt-4 mt-4 border-t border-zinc-100">
                <button
                  type="button"
                  onClick={logout}
                  className="w-full flex items-center space-x-3 p-3.5 rounded-xl text-red-600 hover:bg-red-50 transition-all duration-200 font-medium text-left"
                >
                  <span className="material-symbols-outlined text-[20px]">logout</span>
                  <span className="text-sm">Çıkış Yap</span>
                </button>
              </div>
            </nav>
          </div>
          
          {/* Warranty Inquiry Banner */}
          <div 
            onClick={() => {
              setActiveTab('warranty')
              setError(null)
              setTimeout(() => document.getElementById('warranty-search-input')?.focus(), 150)
            }}
            className="p-6 bg-on-surface rounded-2xl relative overflow-hidden group cursor-pointer active:scale-[0.98] transition-transform shadow-lg"
          >
            <div className="relative z-10">
              <span className="inline-block px-2.5 py-1 bg-white/10 text-white text-[10px] font-bold uppercase tracking-widest rounded mb-3">Hızlı İşlem</span>
              <h4 className="text-white font-bold text-base mb-2">Garanti Sorgula</h4>
              <p className="text-zinc-400 text-xs mb-5 leading-relaxed">Cihazınızın seri numarası ile garanti durumunu anında öğrenin.</p>
              <button className="bg-primary text-white text-xs font-bold py-2.5 px-4 rounded-lg flex items-center gap-1 group-hover:gap-2 transition-all uppercase tracking-wide">
                Sorgula <span className="material-symbols-outlined text-sm">arrow_forward</span>
              </button>
            </div>
            <span className="material-symbols-outlined absolute -right-6 -bottom-6 text-8xl text-white/5 rotate-12 transition-transform duration-500 group-hover:scale-110">security</span>
          </div>
        </aside>

        {/* Mobile Navigation Header */}
        <div className="md:hidden w-full bg-white rounded-2xl border border-zinc-150 p-4 shadow-sm space-y-4 mb-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-base border border-primary/20">
                {initials}
              </div>
              <div>
                <p className="font-bold text-base text-on-surface leading-tight">{displayName}</p>
                <p className="text-[10px] font-medium text-zinc-500 mt-0.5">Premium Üye</p>
              </div>
            </div>
            <button
              type="button"
              onClick={logout}
              className="p-2.5 rounded-xl text-red-650 bg-red-50 hover:bg-red-100 transition-colors flex items-center justify-center"
              title="Çıkış Yap"
            >
              <span className="material-symbols-outlined text-[20px]">logout</span>
            </button>
          </div>

          {/* Section Selector Dropdown */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setIsDropdownOpen(!isDropdownOpen)}
              className="w-full flex items-center justify-between bg-zinc-50 border border-zinc-200 px-4 py-3 rounded-xl text-sm font-bold text-zinc-700 hover:bg-zinc-100/50 transition-colors"
            >
              <span className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-[20px]">
                  {activeTab === 'dashboard' && 'dashboard'}
                  {activeTab === 'orders' && 'shopping_bag'}
                  {activeTab === 'reviews' && 'rate_review'}
                  {activeTab === 'addresses' && 'location_on'}
                  {activeTab === 'warranty' && 'verified'}
                  {activeTab === 'service' && 'build'}
                  {activeTab === 'coupons' && 'confirmation_number'}
                  {activeTab === 'registered-products' && 'app_registration'}
                  {activeTab === 'settings' && 'settings'}
                </span>
                {activeTab === 'dashboard' && 'Panel'}
                {activeTab === 'orders' && 'Siparişlerim'}
                {activeTab === 'reviews' && 'Yorumlarım'}
                {activeTab === 'addresses' && 'Adreslerim'}
                {activeTab === 'warranty' && 'Garanti Takibi'}
                {activeTab === 'service' && 'Servis Taleplerim'}
                {activeTab === 'coupons' && 'Kuponlarım'}
                {activeTab === 'registered-products' && 'Kayıtlı Ürünlerim'}
                {activeTab === 'settings' && 'Hesap Ayarları'}
              </span>
              <span className={`material-symbols-outlined text-zinc-400 transition-transform ${isDropdownOpen ? 'rotate-180' : ''}`}>
                expand_more
              </span>
            </button>

            {isDropdownOpen && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setIsDropdownOpen(false)} />
                <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-zinc-200 rounded-xl shadow-lg z-40 overflow-hidden py-1 divide-y divide-zinc-100 animate-in fade-in slide-in-from-top-1 duration-200">
                  {[
                    { tab: 'dashboard', label: 'Panel', icon: 'dashboard' },
                    { tab: 'orders', label: 'Siparişlerim', icon: 'shopping_bag' },
                    { tab: 'reviews', label: 'Yorumlarım', icon: 'rate_review' },
                    { tab: 'addresses', label: 'Adreslerim', icon: 'location_on' },
                    { tab: 'warranty', label: 'Garanti Takibi', icon: 'verified' },
                    { tab: 'service', label: 'Servis Taleplerim', icon: 'build' },
                    { tab: 'coupons', label: 'Kuponlarım', icon: 'confirmation_number' },
                    { tab: 'registered-products', label: 'Kayıtlı Ürünlerim', icon: 'app_registration' },
                    { tab: 'settings', label: 'Hesap Ayarları', icon: 'settings' },
                  ].map((item) => (
                    <button
                      key={item.tab}
                      type="button"
                      onClick={() => {
                        setActiveTab(item.tab as any)
                        setError(null)
                        setIsDropdownOpen(false)
                      }}
                      className={`w-full flex items-center gap-3 px-4 py-3 text-sm text-left transition-colors ${
                        activeTab === item.tab 
                          ? 'bg-primary/10 text-primary font-bold' 
                          : 'text-zinc-650 hover:bg-zinc-50'
                      }`}
                    >
                      <span className={`material-symbols-outlined text-[20px] ${activeTab === item.tab ? 'text-primary' : 'text-zinc-400'}`}>
                        {item.icon}
                      </span>
                      {item.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Main Content Area */}
        <section className="flex-1 space-y-6">
          {error ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">{error}</div>
          ) : null}

          {/* DASHBOARD TAB */}
          {activeTab === 'dashboard' && !error && (
            <>
              {/* Dashboard Welcome */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div 
                  onClick={() => setActiveTab('orders')}
                  className="bg-white p-6 rounded-2xl border border-zinc-100 shadow-sm flex flex-col justify-between h-32 cursor-pointer hover:border-primary/20 hover:shadow-md transition-all duration-200"
                >
                  <div className="flex justify-between items-start">
                    <p className="text-zinc-400 text-[10px] font-bold uppercase tracking-widest">Toplam Sipariş</p>
                    <span className="material-symbols-outlined text-zinc-300">shopping_cart</span>
                  </div>
                  <p className="text-3xl font-bold text-on-surface">{loading ? '…' : orders.length}</p>
                </div>
                <div 
                  onClick={() => setActiveTab('warranty')}
                  className="bg-white p-6 rounded-2xl border border-zinc-100 shadow-sm flex flex-col justify-between h-32 cursor-pointer hover:border-primary/20 hover:shadow-md transition-all duration-200"
                >
                  <div className="flex justify-between items-start">
                    <p className="text-zinc-400 text-[10px] font-bold uppercase tracking-widest">Aktif Garanti</p>
                    <span className="material-symbols-outlined text-primary/40">verified</span>
                  </div>
                  <p className="text-3xl font-bold text-primary">{loading ? '…' : activeWarrantiesCount}</p>
                </div>
                <div 
                  onClick={() => setActiveTab('coupons')}
                  className="bg-white p-6 rounded-2xl border border-zinc-100 shadow-sm flex flex-col justify-between h-32 cursor-pointer hover:border-primary/20 hover:shadow-md transition-all duration-200"
                >
                  <div className="flex justify-between items-start">
                    <p className="text-zinc-400 text-[10px] font-bold uppercase tracking-widest">Aktif Kuponlar</p>
                    <span className="material-symbols-outlined text-zinc-300">confirmation_number</span>
                  </div>
                  <p className="text-3xl font-bold text-on-surface">{loading ? '…' : coupons.filter(c => !c.isUsed && !c.isExpired && c.isActive).length}</p>
                </div>
              </div>

              {/* Recent Orders */}
              <div className="bg-white rounded-2xl shadow-sm border border-zinc-100 overflow-hidden">
                <div className="p-6 border-b border-zinc-100 flex items-center justify-between bg-zinc-50/50">
                  <h2 className="text-xl font-bold text-on-surface">Son Siparişlerim</h2>
                  <button 
                    onClick={() => setActiveTab('orders')}
                    className="text-primary font-bold text-sm hover:underline flex items-center"
                  >
                    Tümünü Gör <span className="material-symbols-outlined text-lg">chevron_right</span>
                  </button>
                </div>
                <div className="divide-y divide-zinc-100">
                  {loading ? (
                    <div className="p-6 text-sm text-zinc-500">Yükleniyor...</div>
                  ) : orders.length === 0 ? (
                    <div className="p-6 text-sm text-zinc-600">Henüz sipariş yok.</div>
                  ) : (
                    orders.slice(0, 2).map((o) => (
                      <div key={o.id} className="p-6 flex flex-col lg:flex-row lg:items-center gap-6 group hover:bg-zinc-50/50 transition-colors">
                        <div className="w-24 h-24 bg-zinc-50 rounded-xl overflow-hidden flex-shrink-0 border border-zinc-100 p-2 flex items-center justify-center">
                          <span className="material-symbols-outlined text-4xl text-zinc-300">receipt_long</span>
                        </div>
                        <div className="flex-1">
                          <div className="flex flex-wrap items-center gap-3 mb-2">
                            <span className="text-[10px] font-bold px-2 py-1 bg-zinc-100 text-zinc-700 rounded text-center uppercase tracking-wide flex items-center gap-1">
                              <span className="material-symbols-outlined text-[14px]">info</span> {String(o.status ?? '')}
                            </span>
                            <span className="text-zinc-400 text-xs font-mono bg-zinc-100 px-2 py-1 rounded">#{o.orderNo}</span>
                          </div>
                          <h3 className="font-bold text-on-surface text-base">{o.lines?.[0]?.productName || 'Sipariş'}</h3>
                          <p className="text-zinc-500 text-xs mt-1">Sipariş Tarihi: {new Date(o.createdAtUtc).toLocaleDateString('tr-TR')}</p>
                        </div>
                        <div className="flex items-center justify-between lg:justify-end gap-6 w-full lg:w-auto mt-4 lg:mt-0">
                          <p className="text-xl font-bold text-on-surface">₺{Number(o.total ?? 0).toLocaleString('tr-TR')}</p>
                          <button
                            onClick={() => setActiveTab('orders')}
                            className="border-2 border-zinc-200 px-5 py-2.5 rounded-xl text-sm font-bold text-zinc-700 hover:border-zinc-300 hover:bg-zinc-50 active:scale-95 transition-all"
                          >
                            Detaylar
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Bento Grid Actions */}
              <div className="grid grid-cols-1 gap-6">
                <div 
                  onClick={() => {
                    setActiveTab('service')
                    setShowServiceForm(true)
                  }}
                  className="bg-zinc-50 p-8 rounded-2xl border border-zinc-100 flex flex-col justify-between group hover:border-primary/20 hover:bg-white transition-colors cursor-pointer min-h-[220px]"
                >
                  <div>
                    <span className="material-symbols-outlined text-4xl text-primary mb-4 block group-hover:scale-110 transition-transform origin-left">support_agent</span>
                    <h3 className="text-xl font-bold text-on-surface mb-2">Teknik Servis</h3>
                    <p className="text-zinc-500 text-sm leading-relaxed mb-6">Cihazınızla ilgili bir sorun mu yaşıyorsunuz? Hemen bir arıza kaydı oluşturun veya size en yakın servisi bulun.</p>
                  </div>
                  <button className="flex items-center text-primary font-bold gap-1 group-hover:gap-3 transition-all text-sm uppercase tracking-wide text-left">
                    Talep Oluştur <span className="material-symbols-outlined text-base">arrow_forward</span>
                  </button>
                </div>
              </div>
            </>
          )}

          {/* ORDERS TAB */}
          {activeTab === 'orders' && !error && (
            <div className="bg-white rounded-2xl shadow-sm border border-zinc-100 overflow-hidden">
              <div className="p-6 border-b border-zinc-100 bg-zinc-50/50 flex justify-between items-center">
                <div>
                  <h2 className="text-xl font-bold text-on-surface">Tüm Siparişlerim</h2>
                  <p className="text-xs text-zinc-500 mt-0.5">Daha önce vermiş olduğunuz siparişlerin detayları ve güncel durumları.</p>
                </div>
                <button 
                  onClick={() => setActiveTab('dashboard')}
                  className="px-3.5 py-1.5 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 font-bold text-xs rounded-lg transition-colors flex items-center gap-1"
                >
                  <span className="material-symbols-outlined text-sm">arrow_back</span> Panele Dön
                </button>
              </div>
              <div className="divide-y divide-zinc-100 p-6 space-y-4">
                {loading ? (
                  <div className="text-sm text-zinc-500 py-4">Yükleniyor...</div>
                ) : orders.length === 0 ? (
                  <div className="text-sm text-zinc-500 py-8 text-center bg-zinc-50 rounded-xl border border-dashed border-zinc-200">
                    <span className="material-symbols-outlined text-4xl text-zinc-300 block mb-2">shopping_cart</span>
                    Henüz hiçbir siparişiniz bulunmamaktadır.
                  </div>
                ) : (
                  orders.map((o) => {
                    const dateStr = new Date(o.createdAtUtc).toLocaleDateString('tr-TR', {
                      day: 'numeric',
                      month: 'long',
                      year: 'numeric'
                    })
                    const totalQty = o.lines?.reduce((sum, line) => sum + (line.quantity || 0), 0) || 0
                    
                    let statusColor = 'text-amber-600 bg-amber-50/50 border-amber-100'
                    let statusIcon = 'schedule'
                    let statusText = o.status || 'Yeni Sipariş'
                    const s = (o.status || '').toUpperCase()
                    if (s === 'DELIVERED' || s === 'COMPLETED' || s === 'TESLİM EDİLDİ' || s === 'TAMAMLANDI') {
                      statusColor = 'text-green-600 bg-green-50/50 border-green-100'
                      statusIcon = 'check_circle'
                      statusText = 'Teslim Edildi'
                    } else if (s === 'PROCESSING' || s === 'HAZIRLANIYOR') {
                      statusColor = 'text-blue-600 bg-blue-50/50 border-blue-100'
                      statusIcon = 'autorenew'
                      statusText = 'Hazırlanıyor'
                    } else if (s === 'SHIPPED' || s === 'KARGODA' || s === 'DAĞITIMDA') {
                      statusColor = 'text-orange-650 bg-orange-50/50 border-orange-100'
                      statusIcon = 'local_shipping'
                      statusText = 'Dağıtımda'
                    } else if (s === 'PLANLANDI') {
                      statusColor = 'text-indigo-600 bg-indigo-50/50 border-indigo-100'
                      statusIcon = 'schedule'
                      statusText = 'Planlandı'
                    } else if (s === 'SİPARİŞİNİZ ALINDI') {
                      statusColor = 'text-blue-600 bg-blue-50/50 border-blue-100'
                      statusIcon = 'info'
                      statusText = 'Siparişiniz Alındı'
                    } else if (s === 'CANCELLED' || s === 'İPTAL EDİLDİ') {
                      statusColor = 'text-rose-600 bg-rose-50/50 border-rose-100'
                      statusIcon = 'cancel'
                      statusText = 'İptal Edildi'
                    }

                    return (
                      <div key={o.id} className="border border-zinc-150 rounded-2xl bg-white p-5 shadow-sm space-y-4 hover:shadow-md transition-shadow">
                        {/* Top row: Date, Total, and Detail toggle */}
                        <div className="flex justify-between items-start gap-4 flex-wrap">
                          <div className="flex items-center gap-3">
                            <button
                              onClick={() => toggleOrderExpand(o.id)}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-zinc-200 bg-zinc-50 hover:bg-zinc-100 text-xs font-bold text-zinc-700 transition-all active:scale-95 shrink-0"
                            >
                              <span className="material-symbols-outlined text-[16px] transition-transform duration-200" style={{ transform: expandedOrders[o.id] ? 'rotate(90deg)' : 'rotate(0deg)' }}>
                                chevron_right
                              </span>
                              Detay
                            </button>
                            <div>
                              <p className="text-zinc-800 font-bold text-xs">{dateStr}</p>
                              <p className="text-xs text-zinc-500 mt-0.5">
                                Toplam: <strong className="text-primary font-black">₺{Number(o.total ?? 0).toLocaleString('tr-TR')}</strong>
                              </p>
                            </div>
                          </div>
                          <span className="text-[9px] font-mono text-zinc-400 font-bold">Sipariş No: #{o.orderNo}</span>
                        </div>

                        {/* Middle row: Status and Review button */}
                        <div className={`flex justify-between items-center p-2 px-3 rounded-xl border ${statusColor}`}>
                          <div className="flex items-center gap-1.5 text-xs font-bold">
                            <span className="material-symbols-outlined text-sm font-black">{statusIcon}</span>
                            <span>{statusText}</span>
                          </div>
                          
                          {/* Değerlendir (Review) button if delivered or completed */}
                          {(statusText === 'Teslim Edildi' || s === 'COMPLETED') && o.lines?.[0] && (
                            <Link
                              to={`/urun/${generateSlug(o.lines[0].productName || '')}/${o.lines[0].productId}`}
                              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-zinc-200 bg-white text-[10px] font-black text-zinc-700 hover:bg-zinc-50 transition-colors shadow-2xs"
                            >
                              <span className="material-symbols-outlined text-xs text-amber-500" style={{ fontVariationSettings: "'FILL' 1" }}>star</span>
                              Değerlendir
                            </Link>
                          )}
                        </div>

                        {/* Collapsible Detail Section */}
                        {expandedOrders[o.id] ? (
                          <div className="border-t border-zinc-100 pt-4 space-y-4 animate-in fade-in duration-200">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                              {/* Alıcı ve Teslimat Bilgileri */}
                              <div className="bg-zinc-50 rounded-2xl p-4 border border-zinc-100 space-y-2">
                                <h4 className="font-extrabold text-zinc-700 uppercase tracking-wider text-[10px]">Alıcı & Teslimat Bilgileri</h4>
                                <p className="text-zinc-950"><strong className="text-zinc-450 font-bold">Alıcı:</strong> {o.customerName || '-'}</p>
                                <p className="text-zinc-955"><strong className="text-zinc-450 font-bold">E-posta:</strong> {o.email || '-'}</p>
                                <p className="text-zinc-955"><strong className="text-zinc-450 font-bold">Telefon:</strong> {o.phone || '-'}</p>
                                <p className="text-zinc-955"><strong className="text-zinc-450 font-bold">Teslimat Adresi:</strong> {o.address || '-'}</p>
                              </div>

                              {/* Sipariş Özeti ve Fatura */}
                              <div className="bg-zinc-50 rounded-2xl p-4 border border-zinc-100 space-y-3 flex flex-col justify-between">
                                <div className="space-y-1.5">
                                  <h4 className="font-extrabold text-zinc-700 uppercase tracking-wider text-[10px] mb-2">Fatura & Ödeme Özeti</h4>
                                  <div className="flex justify-between">
                                    <span className="text-zinc-500">Ödeme Durumu:</span>
                                    <span className="font-bold text-zinc-800">
                                      {o.paymentStatus === 'Paid' ? 'Ödendi (Kredi Kartı)' : 'Ödeme Bekleniyor'}
                                    </span>
                                  </div>
                                  {o.couponCode && (
                                    <div className="flex justify-between">
                                      <span className="text-zinc-500">Kupon Kodu:</span>
                                      <span className="font-mono font-bold text-zinc-800">{o.couponCode}</span>
                                    </div>
                                  )}
                                  {(o.discountAmount ?? 0) > 0 && (
                                    <div className="flex justify-between">
                                      <span className="text-zinc-500">Kupon İndirimi:</span>
                                      <span className="text-rose-600 font-bold">-₺{Number(o.discountAmount).toLocaleString('tr-TR')}</span>
                                    </div>
                                  )}
                                  {(o.campaignDiscountAmount ?? 0) > 0 && (
                                    <div className="flex justify-between">
                                      <span className="text-zinc-500">Kampanya İndirimi:</span>
                                      <span className="text-rose-600 font-bold">-₺{Number(o.campaignDiscountAmount).toLocaleString('tr-TR')}</span>
                                    </div>
                                  )}
                                  <div className="flex justify-between">
                                    <span className="text-zinc-500">Kargo Ücreti:</span>
                                    <span className="font-bold text-zinc-800">
                                      {(o.cargoFee ?? 0) === 0 ? 'Ücretsiz' : `₺${Number(o.cargoFee).toLocaleString('tr-TR')}`}
                                    </span>
                                  </div>
                                </div>

                                {o.paymentStatus === 'Paid' && (
                                  <button
                                    onClick={() => {
                                      const token = getMemberToken()
                                      window.open(`/api/orders/${o.id}/invoice?token=${token}`, '_blank')
                                    }}
                                    className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-white text-xs font-bold transition-all shadow-sm active:scale-95 mt-2"
                                  >
                                    <span className="material-symbols-outlined text-[18px]">description</span>
                                    Faturayı Görüntüle / İndir
                                  </button>
                                )}
                              </div>
                            </div>


                            {/* Ürün Listesi */}
                            <div className="space-y-2">
                              <h4 className="font-extrabold text-zinc-500 uppercase tracking-wider text-[10px] pl-1">Sipariş Edilen Ürünler</h4>
                              <div className="divide-y divide-zinc-100 border border-zinc-150 rounded-2xl bg-white overflow-hidden shadow-2xs">
                                {o.lines?.map((line, idx) => (
                                  <div key={idx} className="flex justify-between items-center text-xs py-3 px-4 hover:bg-zinc-50/30">
                                    <div className="flex items-center gap-3">
                                      <div className="w-10 h-10 rounded-lg border border-zinc-100 flex items-center justify-center p-0.5 bg-zinc-50 shrink-0">
                                        {line.imageUrl ? (
                                          <img src={line.imageUrl} className="w-full h-full object-contain" alt={line.productName} />
                                        ) : (
                                          <span className="material-symbols-outlined text-zinc-300 text-lg">receipt_long</span>
                                        )}
                                      </div>
                                      <div>
                                        <p className="font-bold text-zinc-800">{line.productName}</p>
                                        <p className="text-[10px] text-zinc-500 font-semibold mt-0.5">Adet: {line.quantity}</p>
                                      </div>
                                    </div>
                                    <div className="text-right">
                                      <p className="font-extrabold text-zinc-900">₺{Number(line.lineTotal || (line.unitPrice * line.quantity)).toLocaleString('tr-TR')}</p>
                                      <p className="text-[10px] text-zinc-400 font-medium">Birim: ₺{Number(line.unitPrice).toLocaleString('tr-TR')}</p>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
                        ) : (
                          <>
                            {/* Images list row (collapsed) */}
                            <div className="flex flex-wrap gap-2.5 pt-1">
                              {o.lines?.map((line, idx) => (
                                <div key={idx} className="relative group/img">
                                  <div className="w-16 h-16 rounded-xl border border-zinc-200 bg-zinc-50 flex items-center justify-center p-1 overflow-hidden shrink-0 hover:shadow-md transition-shadow">
                                    {line.imageUrl ? (
                                      <img src={line.imageUrl} className="w-full h-full object-contain" alt={line.productName} />
                                    ) : (
                                      <span className="material-symbols-outlined text-zinc-300 text-xl">receipt_long</span>
                                    )}
                                  </div>
                                  <span className="absolute -bottom-1.5 -right-1.5 bg-zinc-800 text-white font-mono font-bold text-[9px] w-5 h-5 rounded-full flex items-center justify-center border-2 border-white shadow-sm">
                                    {line.quantity}
                                  </span>
                                </div>
                              ))}
                            </div>

                            {/* Footer text (collapsed) */}
                            <div className="text-[10px] text-zinc-400 font-bold uppercase tracking-wider flex justify-between items-center pt-1">
                              <span>{totalQty} Ürün Sipariş Edildi</span>
                            </div>
                          </>
                        )}
                      </div>
                    )
                  })
                )}
              </div>
            </div>
          )}

          {/* ADDRESSES TAB */}
          {activeTab === 'reviews' && !error && (
            <div className="bg-white rounded-2xl shadow-sm border border-zinc-100 overflow-hidden">
              <div className="p-6 border-b border-zinc-100 bg-zinc-50/50 flex justify-between items-center">
                <div>
                  <h2 className="text-xl font-bold text-on-surface">Yorumlarım</h2>
                  <p className="text-xs text-zinc-500 mt-0.5">Hangi ürüne hangi yorumu yaptığınızı buradan takip edebilirsiniz.</p>
                </div>
                <button
                  onClick={() => setActiveTab('dashboard')}
                  className="px-3.5 py-1.5 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 font-bold text-xs rounded-lg transition-colors flex items-center gap-1"
                >
                  <span className="material-symbols-outlined text-sm">arrow_back</span> Panele Dön
                </button>
              </div>
              <div className="p-6">
                {loading ? (
                  <div className="text-sm text-zinc-500 py-4">Yükleniyor...</div>
                ) : reviews.length === 0 ? (
                  <div className="text-sm text-zinc-500 py-10 text-center bg-zinc-50 rounded-xl border border-dashed border-zinc-200">
                    <span className="material-symbols-outlined text-4xl text-zinc-300 block mb-2">rate_review</span>
                    Henüz yorum yapmadınız.
                  </div>
                ) : (
                  <div className="space-y-4">
                    {reviews.map((review) => (
                      <div key={review.id} className="rounded-2xl border border-zinc-100 bg-white p-5 hover:shadow-md transition-all">
                        <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                          <div className="min-w-0">
                            <Link
                              to={`/urun/${generateSlug(review.productName || '')}/${review.productId}`}
                              className="text-sm font-extrabold text-zinc-900 hover:text-primary transition-colors"
                            >
                              {review.productName || 'Ürün'}
                            </Link>
                            <div className="mt-2 flex flex-wrap items-center gap-3">
                              <div className="flex items-center gap-0.5">
                                {[1, 2, 3, 4, 5].map((star) => (
                                  <span
                                    key={star}
                                    className="material-symbols-outlined text-[16px] text-amber-400"
                                    style={{ fontVariationSettings: star <= review.rating ? "'FILL' 1" : undefined }}
                                  >
                                    star
                                  </span>
                                ))}
                              </div>
                              <span className="text-[10px] font-black uppercase tracking-wider rounded-full bg-zinc-100 px-2 py-0.5 text-zinc-600">
                                {review.status || 'Approved'}
                              </span>
                              <span className="text-[11px] font-semibold text-zinc-400">
                                {review.createdAtUtc ? new Date(review.createdAtUtc).toLocaleString('tr-TR') : ''}
                              </span>
                            </div>
                          </div>
                          <Link
                            to={`/urun/${generateSlug(review.productName || '')}/${review.productId}`}
                            className="shrink-0 inline-flex items-center gap-1 rounded-xl border border-zinc-200 px-3 py-2 text-[11px] font-bold text-zinc-600 hover:border-primary/30 hover:text-primary transition-colors"
                          >
                            Ürüne Git <span className="material-symbols-outlined text-sm">arrow_forward</span>
                          </Link>
                        </div>
                        <p className="mt-4 rounded-xl bg-zinc-50 px-4 py-3 text-sm leading-relaxed text-zinc-650 border border-zinc-100">
                          {review.comment}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'addresses' && !error && (
            <div className="bg-white rounded-2xl shadow-sm border border-zinc-100 overflow-hidden">
              <div className="p-6 border-b border-zinc-100 bg-zinc-50/50 flex justify-between items-center">
                <div>
                  <h2 className="text-xl font-bold text-on-surface">Kayıtlı Adreslerim</h2>
                  <p className="text-xs text-zinc-500 mt-0.5">Siparişlerinizde hızlıca kullanabilmeniz için adres bilgilerinizi yönetin.</p>
                </div>
                {!showAddressForm && (
                  <button 
                    onClick={openAddAddress}
                    className="px-4 py-2 bg-primary text-white font-bold text-xs rounded-xl hover:bg-primary-container shadow-md shadow-primary/10 transition-all flex items-center gap-1.5"
                  >
                    <span className="material-symbols-outlined text-sm font-bold">add</span> Yeni Adres Ekle
                  </button>
                )}
              </div>

              <div className="p-6">
                {showAddressForm ? (
                  <form onSubmit={handleSaveAddress} className="bg-zinc-50 p-6 rounded-2xl border border-zinc-200 max-w-2xl mx-auto space-y-4">
                    <h3 className="text-lg font-bold text-on-surface mb-2">{addressToEdit ? 'Adresi Güncelle' : 'Yeni Adres Ekle'}</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Bu Adrese Bir İsim Verin (Örn: Ev, İş, Yazlık)</label>
                        <input 
                          value={addrTitle} 
                          onChange={e => setAddrTitle(e.target.value)} 
                          className="w-full px-4 py-2.5 bg-white border border-zinc-200 rounded-xl focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all text-sm" 
                          placeholder="Örn: Ev Adresim, Ofis, Yazlık..." 
                          required 
                          type="text" 
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Alıcı Ad Soyad</label>
                        <input 
                          value={addrFullName} 
                          onChange={e => setAddrFullName(e.target.value)} 
                          className="w-full px-4 py-2.5 bg-white border border-zinc-200 rounded-xl focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all text-sm" 
                          placeholder="Ad Soyad" 
                          required 
                          type="text" 
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Alıcı Telefon Numarası</label>
                        <input 
                          value={addrPhone} 
                          onChange={e => setAddrPhone(e.target.value.replace(/\D/g, '').slice(0, 11))} 
                          maxLength={11}
                          className="w-full px-4 py-2.5 bg-white border border-zinc-200 rounded-xl focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all text-sm" 
                          placeholder="05XXXXXXXXX" 
                          required 
                          type="tel" 
                        />
                      </div>
                      <div className="space-y-1 flex gap-2">
                        <div className="w-1/2 space-y-1">
                          <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Şehir (İl)</label>
                          <select 
                            value={addrCity} 
                            onChange={e => {
                              setAddrCity(e.target.value)
                            }}
                            className="w-full px-4 py-2.5 bg-white border border-zinc-200 rounded-xl focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all text-sm" 
                            required
                          >
                            <option value="">İl Seçin</option>
                            <option value="Kuzey Kıbrıs (KKTC)">Kuzey Kıbrıs (KKTC)</option>
                          </select>
                        </div>
                        <div className="w-1/2">
                          <SearchableSelect
                            value={addrDistrict}
                            onChange={(val) => {
                              setAddrDistrict(val)
                              setAddrRegion('')
                            }}
                            options={Object.keys(cyprusData)}
                            placeholder="İlçe Seçin"
                            label="İlçe"
                            required
                          />
                        </div>
                      </div>

                      <div className="space-y-1 flex gap-2">
                        <div className="w-1/2">
                          <SearchableSelect
                            value={addrRegion}
                            onChange={(val) => setAddrRegion(val)}
                            options={(cyprusData as Record<string, string[]>)[addrDistrict] || []}
                            placeholder="Bölge Seçin"
                            label="Bölge"
                            required
                          />
                        </div>
                        <div className="w-1/2 space-y-1">
                          <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Mahalle</label>
                          <input 
                            value={addrMahalle} 
                            onChange={e => setAddrMahalle(e.target.value)} 
                            className="w-full px-4 py-2.5 bg-white border border-zinc-200 rounded-xl focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all text-sm" 
                            placeholder="Mahalle yazın" 
                            required 
                            type="text" 
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-2 col-span-1 md:col-span-2">
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Bina No</label>
                          <input 
                            value={addrBinaNo} 
                            onChange={e => setAddrBinaNo(e.target.value)} 
                            className="w-full px-4 py-2.5 bg-white border border-zinc-200 rounded-xl focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all text-sm" 
                            placeholder="Bina No" 
                            required 
                            type="text" 
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Daire No</label>
                          <input 
                            value={addrDaireNo} 
                            onChange={e => setAddrDaireNo(e.target.value)} 
                            className="w-full px-4 py-2.5 bg-white border border-zinc-200 rounded-xl focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all text-sm" 
                            placeholder="Daire" 
                            required 
                            type="text" 
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Kat No</label>
                          <input 
                            value={addrKatNo} 
                            onChange={e => setAddrKatNo(e.target.value)} 
                            className="w-full px-4 py-2.5 bg-white border border-zinc-200 rounded-xl focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all text-sm" 
                            placeholder="Kat" 
                            required 
                            type="text" 
                          />
                        </div>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Açık Adres Açıklaması</label>
                      <textarea 
                        value={addrDetails} 
                        onChange={e => setAddrDetails(e.target.value)} 
                        className="w-full px-4 py-2.5 bg-white border border-zinc-200 rounded-xl focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all text-sm resize-none" 
                        placeholder="Adres Açıklaması..." 
                        rows={3} 
                        required 
                      />
                    </div>
                    <div className="flex justify-end gap-3 pt-2">
                      <button 
                        type="button" 
                        onClick={() => { setShowAddressForm(false); setAddressToEdit(null); }}
                        className="px-4 py-2 bg-zinc-200 hover:bg-zinc-300 font-bold text-xs rounded-xl text-zinc-700 transition-colors"
                      >
                        İptal
                      </button>
                      <button 
                        type="submit"
                        className="px-4 py-2 bg-primary text-white font-bold text-xs rounded-xl hover:bg-primary-container shadow-md shadow-primary/10 transition-all"
                      >
                        {addressToEdit ? 'Güncelle ve Kaydet' : 'Adresi Kaydet'}
                      </button>
                    </div>
                  </form>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {addresses.map((a) => (
                      <div key={a.id} className="border border-zinc-100 bg-white hover:border-primary/20 hover:shadow-md transition-all p-5 rounded-2xl relative flex flex-col justify-between min-h-[160px]">
                        <div>
                          <div className="flex justify-between items-start mb-2">
                            <span className="px-2.5 py-1 bg-primary/10 text-primary text-[10px] font-extrabold uppercase rounded-lg">
                              {a.title}
                            </span>
                            <span className="text-zinc-400 text-xs font-semibold">{a.fullName}</span>
                          </div>
                          <p className="text-sm font-bold text-on-surface mb-1">
                            {a.district ? `${a.district} / ${a.city}` : a.city}
                          </p>
                          <p className="text-xs text-zinc-500 leading-relaxed pr-6">
                            {a.details}
                            {a.binaNo && `, Bina: ${a.binaNo}`}
                            {a.daireNo && `, Daire: ${a.daireNo}`}
                            {a.katNo && `, Kat: ${a.katNo}`}
                            {a.mahalle && `, ${a.mahalle} Mah.`}
                            {a.region && `, ${a.region}`}
                          </p>
                          <p className="text-xs text-zinc-400 mt-2 flex items-center gap-1">
                            <span className="material-symbols-outlined text-sm">phone</span> {a.phone}
                          </p>
                        </div>
                        <div className="flex justify-end gap-2 mt-4 pt-3 border-t border-zinc-100">
                          <button 
                            onClick={() => openEditAddress(a)}
                            className="px-3 py-1.5 bg-zinc-50 hover:bg-zinc-100 font-bold text-[10px] rounded-lg text-zinc-600 transition-colors flex items-center gap-1"
                          >
                            <span className="material-symbols-outlined text-xs">edit</span> Düzenle
                          </button>
                          <button 
                            onClick={() => handleDeleteAddress(a.id)}
                            className="px-3 py-1.5 bg-red-50 hover:bg-red-100 font-bold text-[10px] rounded-lg text-red-600 transition-colors flex items-center gap-1"
                          >
                            <span className="material-symbols-outlined text-xs">delete</span> Sil
                          </button>
                        </div>
                      </div>
                    ))}
                    <div 
                      onClick={openAddAddress}
                      className="border-2 border-dashed border-zinc-200 hover:border-primary hover:bg-zinc-50/50 transition-colors rounded-2xl flex flex-col items-center justify-center p-6 text-center cursor-pointer min-h-[160px] group"
                    >
                      <span className="material-symbols-outlined text-3xl text-zinc-300 group-hover:text-primary group-hover:scale-110 transition-all mb-2">add_location</span>
                      <p className="text-sm font-bold text-zinc-500 group-hover:text-primary">Yeni Adres Ekle</p>
                      <p className="text-[10px] text-zinc-400 mt-1 max-w-[180px]">Yeni bir teslimat veya fatura adresi eklemek için tıklayın.</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* WARRANTY TAB */}
          {activeTab === 'warranty' && !error && (
            <div className="space-y-6">
              <div className="bg-white rounded-2xl shadow-sm border border-zinc-100 overflow-hidden">
                <div className="p-6 border-b border-zinc-100 bg-zinc-50/50 flex justify-between items-center">
                  <div>
                    <h2 className="text-xl font-bold text-on-surface">Garanti Yönetim Paneli</h2>
                    <p className="text-xs text-zinc-500 mt-0.5">Stilsoft ürünlerinizin garanti sürelerini online olarak başlatabilir ve sorgulayabilirsiniz.</p>
                  </div>
                  <button 
                    onClick={() => setActiveTab('dashboard')}
                    className="px-3.5 py-1.5 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 font-bold text-xs rounded-lg transition-colors flex items-center gap-1"
                  >
                    <span className="material-symbols-outlined text-sm">arrow_back</span> Panele Dön
                  </button>
                </div>

                <div className="p-6 grid grid-cols-1 lg:grid-cols-12 gap-8">
                  {/* Inquiry Column */}
                  <div className="lg:col-span-5 bg-zinc-50 p-6 rounded-2xl border border-zinc-200 flex flex-col justify-between">
                    <div>
                      <div className="flex items-center gap-3.5 mb-4">
                        <span className="material-symbols-outlined text-primary text-2xl">search</span>
                        <h3 className="font-bold text-base text-on-surface">Garanti Sorgula</h3>
                      </div>
                      <p className="text-xs text-zinc-500 mb-5 leading-relaxed">
                        Cihazınızın seri numarasını (örn: STL-2026-AF88) girerek garanti durumunu kontrol edebilirsiniz.
                      </p>
                      <div className="space-y-3.5">
                        <input 
                          id="warranty-search-input"
                          value={warrantySearchQuery}
                          onChange={e => setWarrantySearchQuery(e.target.value)}
                          className="w-full px-4 py-3 bg-white border border-zinc-200 rounded-xl focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all placeholder:text-zinc-400 text-xs font-mono font-bold" 
                          placeholder="STL-XXXX-XXXX" 
                          type="text" 
                        />
                        <button 
                          onClick={handleSearchWarranty}
                          className="w-full py-3 bg-on-surface text-white font-bold rounded-xl hover:bg-zinc-800 transition-all active:scale-[0.98] text-xs uppercase tracking-wider flex items-center justify-center gap-1.5"
                        >
                          <span className="material-symbols-outlined text-base">manage_search</span> Sorgula
                        </button>
                      </div>

                      {/* Search Result display */}
                      {warrantySearchResult !== undefined && (
                        <div className="mt-5 p-4 bg-white border border-zinc-100 rounded-xl shadow-inner">
                          {warrantySearchResult === null ? (
                            <div className="flex items-start gap-2.5 text-red-600">
                              <span className="material-symbols-outlined text-lg mt-0.5">error</span>
                              <p className="text-xs leading-relaxed font-bold">Kayıtlı ürün bulunamadı. Lütfen seri numarasını kontrol edip yeniden deneyin.</p>
                            </div>
                          ) : (
                            <div className="space-y-2">
                              <div className="flex justify-between items-center">
                                <h4 className="font-bold text-xs text-on-surface">{warrantySearchResult.productName}</h4>
                                <span className={`px-2 py-0.5 text-[9px] font-extrabold uppercase rounded-full ${
                                  warrantySearchResult.status === 'active' ? 'bg-green-50 text-green-700 border border-green-100' : 'bg-red-50 text-red-700 border border-red-100'
                                }`}>
                                  {warrantySearchResult.status === 'active' ? 'Aktif' : 'Süresi Doldu'}
                                </span>
                              </div>
                              <p className="text-[10px] text-zinc-400 font-mono">Seri No: {warrantySearchResult.serialNo}</p>
                              <div className="border-t border-zinc-100 pt-2 text-[10px] text-zinc-500 space-y-1">
                                <p>Fatura Tarihi: {new Date(warrantySearchResult.invoiceDate).toLocaleDateString('tr-TR')}</p>
                                <p>Kayıt Sahibi: {warrantySearchResult.fullName}</p>
                                <p className="font-bold text-primary mt-1">Kalan Süre: {warrantySearchResult.remainingText}</p>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="mt-6 p-3 bg-white/70 border border-dashed border-zinc-200 rounded-xl flex items-start gap-2">
                      <span className="material-symbols-outlined text-zinc-400 text-base mt-0.5">info</span>
                      <p className="text-[10px] text-zinc-500 leading-relaxed">Garantiler fatura tarihinden itibaren 2 yıldır. Seri no ürün barkodunda yer alır.</p>
                    </div>
                  </div>

                  {/* Register Column */}
                  <div className="lg:col-span-7 space-y-4">
                    <div className="flex items-center gap-3.5 mb-2">
                      <span className="material-symbols-outlined text-primary text-2xl">verified_user</span>
                      <h3 className="font-bold text-base text-on-surface">Yeni Garanti Kaydı Başlat</h3>
                    </div>
                    <form onSubmit={handleRegisterWarranty} className="space-y-4">
                      {warrantyMsg && (
                        <div className={`p-3 rounded-xl text-xs font-bold border ${
                          warrantyMsg.type === 'success' ? 'bg-green-50 text-green-700 border-green-100' : 'bg-red-50 text-red-700 border-red-100'
                        }`}>
                          {warrantyMsg.text}
                        </div>
                      )}
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Ad Soyad</label>
                          <input 
                            value={me?.fullName || ''} 
                            disabled 
                            className="w-full px-4 py-2.5 bg-zinc-100 border border-zinc-200 rounded-xl text-zinc-500 cursor-not-allowed text-xs font-bold" 
                            type="text" 
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">E-Posta</label>
                          <input 
                            value={me?.email || ''} 
                            disabled 
                            className="w-full px-4 py-2.5 bg-zinc-100 border border-zinc-200 rounded-xl text-zinc-500 cursor-not-allowed text-xs font-bold" 
                            type="email" 
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Ürün Seri No</label>
                          <input 
                            value={newWarrantySerial}
                            onChange={e => setNewWarrantySerial(e.target.value)}
                            className="w-full px-4 py-2.5 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all text-xs font-mono font-bold uppercase" 
                            placeholder="STL-2026-XXXX"
                            required
                            type="text" 
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Fatura Tarihi</label>
                          <input 
                            value={newWarrantyInvoiceDate}
                            onChange={e => setNewWarrantyInvoiceDate(e.target.value)}
                            className="w-full px-4 py-2.5 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all text-xs text-zinc-600 font-bold" 
                            required
                            type="date" 
                          />
                        </div>
                      </div>
                      <div className="flex items-center gap-2.5">
                        <input 
                          id="terms" 
                          checked={newWarrantyKVKK}
                          onChange={e => setNewWarrantyKVKK(e.target.checked)}
                          className="w-4 h-4 rounded border-zinc-300 text-primary focus:ring-primary" 
                          type="checkbox" 
                        />
                        <label className="text-[11px] text-zinc-500 select-none" htmlFor="terms">
                          KVKK metnini ve garanti şartlarını okudum, onaylıyorum.
                        </label>
                      </div>
                      <button 
                        type="submit"
                        className="w-full py-3.5 bg-primary text-white font-bold rounded-xl hover:bg-primary-container transition-all active:scale-[0.98] shadow-lg shadow-primary/20 text-xs uppercase tracking-wider flex items-center justify-center gap-1.5"
                      >
                        <span className="material-symbols-outlined text-base">check_circle</span> Kaydı Tamamla
                      </button>
                    </form>
                  </div>
                </div>
              </div>

              {/* Devices List */}
              <div className="bg-white rounded-2xl shadow-sm border border-zinc-100 overflow-hidden">
                <div className="p-6 border-b border-zinc-100 bg-zinc-50/50">
                  <h3 className="font-bold text-base text-on-surface">Kayıtlı Cihazlarım</h3>
                </div>
                <div className="p-6 grid grid-cols-1 md:grid-cols-3 gap-6">
                  {warranties.map((w) => (
                    <div key={w.id} className="border border-zinc-100 bg-white rounded-2xl p-5 hover:shadow-md transition-all flex flex-col justify-between">
                      <div>
                        <div className="flex justify-between items-start mb-3">
                          <span className="material-symbols-outlined text-2xl text-primary">verified</span>
                          <span className={`px-2 py-0.5 text-[9px] font-extrabold uppercase rounded-full ${
                            w.status === 'active' ? 'bg-green-50 text-green-700 border border-green-100' : 'bg-red-50 text-red-700 border border-red-100'
                          }`}>
                            {w.status === 'active' ? 'Aktif' : 'Süresi Doldu'}
                          </span>
                        </div>
                        <h4 className="font-bold text-sm text-on-surface mb-1">{w.productName}</h4>
                        <p className="text-xs text-zinc-400 font-mono mb-4">Seri: {w.serialNo}</p>
                      </div>
                      <div className="border-t border-zinc-50 pt-3 text-[10px] text-zinc-500 space-y-1">
                        <p>Fatura: {new Date(w.invoiceDate).toLocaleDateString('tr-TR')}</p>
                        <p>Kalan Süre: {(w as any).remainingText || `${w.durationYears} Yıl`}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Social Media Footer */}
              {(socialLinks.instagramUrl || socialLinks.twitterUrl || socialLinks.facebookUrl || socialLinks.youtubeUrl) && (
                <div className="bg-white rounded-2xl shadow-sm border border-zinc-100 overflow-hidden">
                  <div className="p-6 flex flex-col items-center gap-4">
                    <h3 className="text-xs font-extrabold text-zinc-400 uppercase tracking-wider">Bizi Takip Edin</h3>
                    <div className="flex items-center gap-3">
                      {socialLinks.instagramUrl && (
                        <a href={socialLinks.instagramUrl} target="_blank" rel="noopener noreferrer" aria-label="Instagram" className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 via-pink-500 to-orange-400 flex items-center justify-center hover:scale-110 transition-transform shadow-md">
                          <svg className="w-5 h-5 fill-white" viewBox="0 0 24 24"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/></svg>
                        </a>
                      )}
                      {socialLinks.twitterUrl && (
                        <a href={socialLinks.twitterUrl} target="_blank" rel="noopener noreferrer" aria-label="Twitter / X" className="w-10 h-10 rounded-xl bg-zinc-900 flex items-center justify-center hover:scale-110 transition-transform shadow-md">
                          <svg className="w-4.5 h-4.5 fill-white" viewBox="0 0 24 24"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
                        </a>
                      )}
                      {socialLinks.facebookUrl && (
                        <a href={socialLinks.facebookUrl} target="_blank" rel="noopener noreferrer" aria-label="Facebook" className="w-10 h-10 rounded-xl bg-[#1877F2] flex items-center justify-center hover:scale-110 transition-transform shadow-md">
                          <svg className="w-5 h-5 fill-white" viewBox="0 0 24 24"><path d="M9 8h-3v4h3v12h5v-12h3.642l.358-4h-4v-1.667c0-.955.192-1.333 1.115-1.333h2.885v-5h-3.808c-3.596 0-5.192 1.583-5.192 4.615v3.385z"/></svg>
                        </a>
                      )}
                      {socialLinks.youtubeUrl && (
                        <a href={socialLinks.youtubeUrl} target="_blank" rel="noopener noreferrer" aria-label="YouTube" className="w-10 h-10 rounded-xl bg-[#FF0000] flex items-center justify-center hover:scale-110 transition-transform shadow-md">
                          <svg className="w-5 h-5 fill-white" viewBox="0 0 24 24"><path d="M23.498 6.163c-.272-.98-1.077-1.754-2.097-2.022-1.852-.493-9.401-.493-9.401-.493s-7.549 0-9.401.493c-1.02.268-1.825 1.042-2.097 2.022-.493 1.852-.493 5.717-.493 5.717s0 3.865.493 5.718c.272.979 1.077 1.754 2.097 2.021 1.852.493 9.401.493 9.401.493s7.549 0 9.401-.493c1.02-.267 1.825-1.042 2.097-2.021.493-1.853.493-5.718.493-5.718s0-3.865-.493-5.717zm-14.498 8.837v-6l6 3-6 3z"/></svg>
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* SERVICE TAB */}
          {activeTab === 'service' && !error && (
            <div className="space-y-6">
              <div className="bg-white rounded-2xl shadow-sm border border-zinc-100 overflow-hidden">
                <div className="p-6 border-b border-zinc-100 bg-zinc-50/50 flex justify-between items-center">
                  <div>
                    <h2 className="text-xl font-bold text-on-surface">Teknik Servis Taleplerim</h2>
                    <p className="text-xs text-zinc-500 mt-0.5">Ürünlerinizle ilgili destek taleplerini izleyin veya yeni arıza/servis kaydı oluşturun.</p>
                  </div>
                  <div className="flex gap-2">
                    {!showServiceForm && (
                      <button 
                        onClick={() => setShowServiceForm(true)}
                        className="px-4 py-2 bg-primary text-white font-bold text-xs rounded-xl hover:bg-primary-container shadow-md shadow-primary/10 transition-all flex items-center gap-1.5"
                      >
                        <span className="material-symbols-outlined text-sm font-bold">add</span> Yeni Talep Aç
                      </button>
                    )}
                    <button 
                      onClick={() => { setActiveTab('dashboard'); setShowServiceForm(false); }}
                      className="px-3.5 py-1.5 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 font-bold text-xs rounded-lg transition-colors flex items-center gap-1"
                    >
                      <span className="material-symbols-outlined text-sm">arrow_back</span> Panele Dön
                    </button>
                  </div>
                </div>

                <div className="p-6">
                  {showServiceForm ? (
                    <form onSubmit={handleCreateServiceRequest} className="bg-zinc-50 p-6 rounded-2xl border border-zinc-200 max-w-2xl mx-auto space-y-4">
                      <h3 className="text-lg font-bold text-on-surface mb-1">Yeni Teknik Destek Talebi</h3>
                      <p className="text-xs text-zinc-500 mb-3">Lütfen cihazınızdaki sorunu ve detayları eksiksiz doldurun.</p>
                      
                      {serviceMsg && (
                        <div className={`p-3 rounded-xl text-xs font-bold border ${
                          serviceMsg.type === 'success' ? 'bg-green-50 text-green-700 border-green-100' : 'bg-red-50 text-red-700 border-red-100'
                        }`}>
                          {serviceMsg.text}
                        </div>
                      )}

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Ad Soyad</label>
                          <input 
                            value={me?.fullName || ''} 
                            disabled 
                            className="w-full px-4 py-2.5 bg-zinc-150 border border-zinc-200 rounded-xl text-zinc-500 cursor-not-allowed text-xs font-bold" 
                            type="text" 
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">İletişim Telefonu</label>
                          <input 
                            value={me?.phone || ''} 
                            disabled 
                            className="w-full px-4 py-2.5 bg-zinc-150 border border-zinc-200 rounded-xl text-zinc-500 cursor-not-allowed text-xs font-bold" 
                            type="tel" 
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Kategori</label>
                          <select 
                            value={selectedCategoryId}
                            onChange={e => setSelectedCategoryId(e.target.value)}
                            className="w-full px-4 py-2.5 bg-white border border-zinc-200 rounded-xl focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all text-xs font-bold text-zinc-700"
                            required
                          >
                            <option value="">Kategori Seçiniz</option>
                            {allCategories.map((c) => (
                              <option key={c.id} value={c.id}>{c.name}</option>
                            ))}
                          </select>
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Ürün</label>
                          <select 
                            value={selectedProductId}
                            onChange={e => setSelectedProductId(e.target.value)}
                            disabled={!selectedCategoryId || loadingProducts}
                            className="w-full px-4 py-2.5 bg-white border border-zinc-200 rounded-xl focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all text-xs font-bold text-zinc-700 disabled:opacity-60"
                            required
                          >
                            <option value="">
                              {loadingProducts ? 'Ürünler Yükleniyor...' : !selectedCategoryId ? 'Önce Kategori Seçiniz' : 'Ürün Seçiniz'}
                            </option>
                            {allProducts.map((p) => (
                              <option key={p.id} value={p.id}>{p.name}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Arıza / Sorunun Özeti</label>
                        <textarea 
                          value={serviceDescription}
                          onChange={e => setServiceDescription(e.target.value)}
                          className="w-full px-4 py-2.5 bg-white border border-zinc-200 rounded-xl focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all text-xs resize-none" 
                          placeholder="Lütfen arızayı detaylıca açıklayınız..." 
                          rows={4} 
                          required 
                        />
                      </div>
                      <div className="flex items-center gap-2.5">
                        <input 
                          id="kvkk-srv" 
                          checked={serviceKVKK}
                          onChange={e => setServiceKVKK(e.target.checked)}
                          className="w-4 h-4 rounded border-zinc-300 text-primary focus:ring-primary" 
                          type="checkbox" 
                        />
                        <label className="text-[11px] text-zinc-500 select-none" htmlFor="kvkk-srv">
                          Kişisel verilerimin işlenmesine dair KVKK metnini onaylıyorum.
                        </label>
                      </div>
                      <div className="flex justify-end gap-3 pt-2">
                        <button 
                          type="button" 
                          onClick={() => { setShowServiceForm(false); setServiceMsg(null); }}
                          className="px-4 py-2 bg-zinc-200 hover:bg-zinc-300 font-bold text-xs rounded-xl text-zinc-700 transition-colors"
                        >
                          İptal
                        </button>
                        <button 
                          type="submit"
                          className="px-4 py-2 bg-primary text-white font-bold text-xs rounded-xl hover:bg-primary-container shadow-md shadow-primary/10 transition-all flex items-center gap-1"
                        >
                          <span className="material-symbols-outlined text-sm">send</span> Talebi Gönder
                        </button>
                      </div>
                    </form>
                  ) : (
                    <div className="space-y-4">
                      {serviceMsg && (
                        <div className={`p-4 rounded-xl text-xs font-bold border ${
                          serviceMsg.type === 'success' ? 'bg-green-50 text-green-700 border-green-100' : 'bg-red-50 text-red-700 border-red-100'
                        }`}>
                          {serviceMsg.text}
                        </div>
                      )}
                      
                      {serviceRequests.length === 0 ? (
                        <div className="text-center py-8 bg-zinc-50 rounded-2xl border border-dashed border-zinc-200">
                          <span className="material-symbols-outlined text-4xl text-zinc-300 block mb-2">support_agent</span>
                          <p className="text-sm font-bold text-zinc-500">Kayıtlı servis talebiniz bulunmamaktadır.</p>
                          <button 
                            onClick={() => setShowServiceForm(true)} 
                            className="mt-3 text-xs text-primary font-bold hover:underline"
                          >
                            Hemen yeni bir talep oluşturun &rarr;
                          </button>
                        </div>
                      ) : (
                        <div className="space-y-4">
                          {serviceRequests.map((r) => (
                            <div key={r.id} className="border border-zinc-100 rounded-2xl p-5 hover:shadow-md transition-all bg-white flex flex-col md:flex-row justify-between gap-4">
                              <div>
                                <div className="flex flex-wrap items-center gap-3 mb-2">
                                  <span className="text-[10px] font-bold px-2 py-0.5 bg-zinc-100 text-zinc-600 rounded">
                                    {r.productGroup}
                                  </span>
                                  {r.modelNo && (
                                    <span className="text-[10px] bg-zinc-100 text-zinc-500 px-2 py-0.5 rounded">
                                      Ürün: {r.modelNo}
                                    </span>
                                  )}
                                  <span className="text-zinc-400 text-[10px]">
                                    {new Date(r.createdAt).toLocaleDateString('tr-TR')}
                                  </span>
                                </div>
                                <p className="text-sm font-bold text-on-surface mb-1">Talep Detayı</p>
                                <p className="text-xs text-zinc-500 leading-relaxed pr-4">{r.description}</p>
                              </div>
                              <div className="flex items-center md:items-end flex-row md:flex-col justify-between md:justify-center gap-2 min-w-[120px]">
                                <span className={`px-3 py-1 rounded-full text-xs font-bold border text-center whitespace-nowrap ${
                                  r.status === 'Yeni Kayıt' ? 'bg-amber-50 text-amber-700 border-amber-100' :
                                  r.status === 'Planlandı' ? 'bg-blue-50 text-blue-700 border-blue-100' :
                                  r.status === 'Onarımda' ? 'bg-purple-50 text-purple-700 border-purple-100' :
                                  'bg-green-50 text-green-700 border-green-100'
                                }`}>
                                  {r.status}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Servis Bul Locator */}
              <div className="bg-white rounded-2xl shadow-sm border border-zinc-100 overflow-hidden">
                <div className="p-6 border-b border-zinc-100 bg-zinc-50/50">
                  <h3 className="font-bold text-base text-on-surface">Size En Yakın Yetkili Servis</h3>
                  <p className="text-xs text-zinc-500 mt-0.5">İstanbul, Ankara, İzmir veya Bursa yetkili servislerini sorgulayabilirsiniz.</p>
                </div>
                <div className="p-6 grid grid-cols-1 md:grid-cols-12 gap-6">
                  <div className="md:col-span-4 bg-zinc-50 p-6 rounded-2xl border border-zinc-200">
                    <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-2 block">Şehir Seçiniz</label>
                    <div className="relative">
                      <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400">location_on</span>
                      <select 
                        value={locatorCity}
                        onChange={e => setLocatorCity(e.target.value)}
                        className="w-full pl-10 pr-4 py-3 bg-white border border-zinc-200 rounded-xl focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none appearance-none transition-all text-xs font-bold text-zinc-700"
                      >
                        <option value="">Şehir Seçin</option>
                        <option value="İstanbul">İstanbul</option>
                        <option value="Ankara">Ankara</option>
                        <option value="İzmir">İzmir</option>
                        <option value="Bursa">Bursa</option>
                      </select>
                    </div>
                  </div>
                  <div className="md:col-span-8 space-y-4">
                    {locatorCity ? (
                      filteredServiceCenters.map((s, idx) => (
                        <div key={idx} className="p-4 border border-zinc-100 rounded-xl bg-white flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                          <div>
                            <div className="flex items-center gap-2 mb-1.5">
                              <h4 className="font-bold text-sm text-on-surface">{s.name}</h4>
                              <span className={`text-[8px] font-bold px-2 py-0.5 rounded uppercase ${
                                s.type === 'Merkez' ? 'bg-primary text-white' : 'bg-zinc-100 text-zinc-600'
                              }`}>{s.type}</span>
                            </div>
                            <p className="text-xs text-zinc-500 mb-3">{s.address}</p>
                            <div className="flex flex-wrap items-center gap-4 text-[10px] text-zinc-400 font-semibold">
                              <span className="flex items-center gap-1"><span className="material-symbols-outlined text-primary text-[14px]">call</span> {s.phone}</span>
                              <span className="flex items-center gap-1"><span className="material-symbols-outlined text-primary text-[14px]">schedule</span> {s.hours}</span>
                            </div>
                          </div>
                          <a 
                            href={`tel:${s.phone.replace(/\s+/g, '')}`}
                            className="px-3.5 py-2 bg-on-surface hover:bg-zinc-800 text-white rounded-lg text-xs font-bold flex items-center justify-center gap-1 shadow-sm active:scale-95 transition-all"
                          >
                            <span className="material-symbols-outlined text-sm">call</span> Ara
                          </a>
                        </div>
                      ))
                    ) : (
                      <div className="text-center py-6 text-zinc-400 text-xs font-semibold">
                        Lütfen soldaki menüden şehir seçerek yetkili servisleri listeleyin.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* COUPONS TAB */}
          {activeTab === 'coupons' && !error && (
            <div className="bg-white rounded-2xl shadow-sm border border-zinc-100 overflow-hidden">
              <div className="p-6 border-b border-zinc-100 bg-zinc-50/50 flex justify-between items-center">
                <div>
                  <h2 className="text-xl font-bold text-on-surface">Kuponlarım</h2>
                  <p className="text-xs text-zinc-500 mt-0.5">Sizin için tanımlanmış güncel indirim kuponlarını buradan takip edebilirsiniz.</p>
                </div>
                <button 
                  onClick={() => setActiveTab('dashboard')}
                  className="px-3.5 py-1.5 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 font-bold text-xs rounded-lg transition-colors flex items-center gap-1"
                >
                  <span className="material-symbols-outlined text-sm">arrow_back</span> Panele Dön
                </button>
              </div>

              <div className="p-6 space-y-8">
                {/* Active Coupons */}
                <div>
                  <h3 className="text-sm font-bold text-zinc-800 uppercase tracking-wider mb-4 flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
                    Kullanılabilir Kuponlar ({coupons.filter(c => !c.isUsed && !c.isExpired && c.isActive).length})
                  </h3>

                  {coupons.filter(c => !c.isUsed && !c.isExpired && c.isActive).length === 0 ? (
                    <div className="border-2 border-dashed border-zinc-250 rounded-2xl p-10 text-center text-zinc-400">
                      <span className="material-symbols-outlined text-[36px] text-zinc-350 mb-2">confirmation_number</span>
                      <p className="text-xs font-semibold">Şu anda kullanılabilir aktif kuponunuz bulunmuyor.</p>
                    </div>
                  ) : (
                    <div className="grid gap-4 md:grid-cols-2">
                      {coupons.filter(c => !c.isUsed && !c.isExpired && c.isActive).map((c) => (
                        <div 
                          key={c.id} 
                          className="flex rounded-2xl border border-zinc-200 overflow-hidden shadow-[0_2px_8px_rgba(0,0,0,0.02)] hover:shadow-md transition-shadow relative bg-white group"
                        >
                          {/* Left Value Badge */}
                          <div className="w-24 bg-primary text-white flex flex-col items-center justify-center p-3 text-center shrink-0 select-none relative">
                            {/* Inner semi-circle cuts to mimic a ticket */}
                            <div className="absolute top-1/2 -left-2 w-4 h-4 rounded-full bg-white -translate-y-1/2"></div>
                            <div className="absolute top-1/2 -right-2 w-4 h-4 rounded-full bg-white -translate-y-1/2 border-l border-zinc-200"></div>

                            <span className="text-xs font-extrabold uppercase tracking-widest opacity-80">İNDİRİM</span>
                            <span className="text-2xl font-black mt-1 leading-none">
                              {c.discountType === 'Percentage' ? `%${c.discountValue}` : `${c.discountValue}`}
                            </span>
                            <span className="text-[10px] font-bold mt-1 opacity-90">
                              {c.discountType === 'Percentage' ? 'ORAN' : 'TL'}
                            </span>
                          </div>

                          {/* Right Content */}
                          <div className="flex-1 p-4 flex flex-col justify-between min-w-0 bg-white">
                            <div>
                              <div className="flex justify-between items-start gap-2">
                                <span className="font-mono font-bold text-sm bg-zinc-100 text-zinc-850 px-2 py-0.5 rounded border border-zinc-200 uppercase truncate">
                                  {c.code}
                                </span>
                                <button
                                  onClick={() => {
                                    navigator.clipboard.writeText(c.code);
                                    showToast('Kupon kodu panoya kopyalandı!', 'success');
                                  }}
                                  className="text-[10px] font-bold text-primary hover:underline flex items-center gap-1 active:scale-95 transition-transform"
                                >
                                  <span className="material-symbols-outlined text-xs">content_copy</span>
                                  Kopyala
                                </button>
                              </div>

                              {c.description && (
                                <p className="text-xs font-bold text-zinc-900 mt-2 line-clamp-1">{c.description}</p>
                              )}

                              <div className="text-[10px] text-zinc-500 space-y-0.5 mt-2">
                                {c.minOrderAmount > 0 && (
                                  <p>• Min. Sepet Tutarı: <strong className="text-zinc-700">{c.minOrderAmount} TL</strong></p>
                                )}
                                {c.maxDiscountAmount > 0 && (
                                  <p>• Maks. İndirim: <strong className="text-zinc-700">{c.maxDiscountAmount} TL</strong></p>
                                )}
                                {c.productName && (
                                  <p>• Geçerli Ürün: <strong className="text-primary">{c.productName}</strong></p>
                                )}
                                {c.categoryName && (
                                  <p>• Geçerli Kategori: <strong className="text-blue-600">{c.categoryName}</strong></p>
                                )}
                              </div>
                            </div>

                            <div className="text-[10px] text-zinc-400 font-semibold border-t border-zinc-100 pt-2 mt-3 flex justify-between">
                              <span>Son Gün: {new Date(c.validUntil).toLocaleDateString('tr-TR')}</span>
                              <span>Limit: {c.usedCount}/{c.usageLimit}</span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Past Coupons */}
                <div>
                  <h3 className="text-sm font-bold text-zinc-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-zinc-300"></span>
                    Geçmiş Kuponlarım ({coupons.filter(c => c.isUsed || c.isExpired || !c.isActive).length})
                  </h3>

                  {coupons.filter(c => c.isUsed || c.isExpired || !c.isActive).length === 0 ? (
                    <p className="text-xs text-zinc-400 font-semibold italic">Geçmiş kuponunuz bulunmuyor.</p>
                  ) : (
                    <div className="grid gap-4 md:grid-cols-2 opacity-55 grayscale">
                      {coupons.filter(c => c.isUsed || c.isExpired || !c.isActive).map((c) => (
                        <div 
                          key={c.id} 
                          className="flex rounded-2xl border border-zinc-250 overflow-hidden bg-zinc-50 relative animate-fade-in"
                        >
                          <div className="w-24 bg-zinc-400 text-white flex flex-col items-center justify-center p-3 text-center shrink-0">
                            <span className="text-2xl font-black leading-none">
                              {c.discountType === 'Percentage' ? `%${c.discountValue}` : `${c.discountValue}`}
                            </span>
                            <span className="text-[10px] font-bold mt-1 uppercase">
                              {c.discountType === 'Percentage' ? 'ORAN' : 'TL'}
                            </span>
                          </div>

                          <div className="flex-1 p-4 flex flex-col justify-between min-w-0">
                            <div>
                              <div className="flex justify-between items-center gap-2">
                                <span className="font-mono font-bold text-xs bg-zinc-200 text-zinc-650 px-2 py-0.5 rounded border border-zinc-300 uppercase line-through truncate">
                                  {c.code}
                                </span>
                                <span className="text-[9px] font-extrabold uppercase bg-zinc-200 text-zinc-600 px-2 py-0.5 rounded shrink-0">
                                  {c.isUsed ? 'Kullanıldı' : c.isExpired ? 'Süresi Doldu' : 'Pasif'}
                                </span>
                              </div>
                              {c.description && (
                                <p className="text-xs text-zinc-500 mt-2 line-through truncate">{c.description}</p>
                              )}
                            </div>
                            <div className="text-[10px] text-zinc-400 border-t border-zinc-200 pt-2 mt-3">
                              Bitiş: {new Date(c.validUntil).toLocaleDateString('tr-TR')}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* SETTINGS TAB */}
          {activeTab === 'settings' && !error && (
            <div className="bg-white rounded-2xl shadow-sm border border-zinc-100 overflow-hidden">
              <div className="p-6 border-b border-zinc-100 bg-zinc-50/50 flex justify-between items-center">
                <div>
                  <h2 className="text-xl font-bold text-on-surface">Hesap Ayarları</h2>
                  <p className="text-xs text-zinc-500 mt-0.5">Kişisel bilgilerinizi, telefon numaranızı ve şifrenizi güncelleyebilirsiniz.</p>
                </div>
                <button 
                  onClick={() => setActiveTab('dashboard')}
                  className="px-3.5 py-1.5 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 font-bold text-xs rounded-lg transition-colors flex items-center gap-1"
                >
                  <span className="material-symbols-outlined text-sm">arrow_back</span> Panele Dön
                </button>
              </div>

              <div className="p-6 max-w-2xl mx-auto">
                <form onSubmit={handleUpdateProfile} className="space-y-4">
                  {settingsMsg && (
                    <div className={`p-4 rounded-xl text-xs font-bold border ${
                      settingsMsg.type === 'success' ? 'bg-green-50 text-green-700 border-green-100' : 'bg-red-50 text-red-700 border-red-100'
                    }`}>
                      {settingsMsg.text}
                    </div>
                  )}

                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block">Ad Soyad</label>
                    <input 
                      value={settingsFullName}
                      onChange={e => setSettingsFullName(e.target.value)}
                      className="w-full px-4 py-2.5 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all text-xs font-bold" 
                      placeholder="Ad Soyad"
                      required
                      type="text" 
                    />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block">E-Posta Adresi (Değiştirilemez)</label>
                      <input 
                        value={me?.email || ''} 
                        disabled 
                        className="w-full px-4 py-2.5 bg-zinc-100 border border-zinc-200 rounded-xl text-zinc-500 cursor-not-allowed text-xs font-semibold" 
                        type="email" 
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block">Telefon Numarası</label>
                      <input 
                        value={settingsPhone}
                        onChange={e => setSettingsPhone(e.target.value.replace(/\D/g, '').slice(0, 11))}
                        maxLength={11}
                        className="w-full px-4 py-2.5 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all text-xs font-bold" 
                        placeholder="05XXXXXXXXX"
                        required
                        type="tel" 
                      />
                    </div>
                  </div>

                  <div className="border-t border-zinc-100 pt-4 mt-6">
                    <h3 className="text-xs font-bold text-on-surface mb-1">Şifre Güncelle</h3>
                    <p className="text-[10px] text-zinc-400 mb-4">Şifrenizi değiştirmek istemiyorsanız bu alanları boş bırakabilirsiniz.</p>
                    
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block">Mevcut Şifre</label>
                        <input 
                          value={settingsOldPassword}
                          onChange={e => setSettingsOldPassword(e.target.value)}
                          className="w-full px-4 py-2.5 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all text-xs font-bold" 
                          placeholder="••••••••"
                          type="password" 
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block">Yeni Şifre</label>
                        <input 
                          value={settingsPassword}
                          onChange={e => setSettingsPassword(e.target.value)}
                          className="w-full px-4 py-2.5 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all text-xs font-bold" 
                          placeholder="••••••••"
                          type="password" 
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block">Yeni Şifre Tekrar</label>
                        <input 
                          value={settingsConfirmPassword}
                          onChange={e => setSettingsConfirmPassword(e.target.value)}
                          className="w-full px-4 py-2.5 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all text-xs font-bold" 
                          placeholder="••••••••"
                          type="password" 
                        />
                      </div>
                    </div>
                  </div>

                  <div className="flex justify-end pt-4">
                    <button 
                      type="submit"
                      disabled={settingsLoading}
                      className="px-6 py-3 bg-primary text-white font-bold text-xs rounded-xl hover:bg-primary-container shadow-lg shadow-primary/25 disabled:bg-zinc-400 disabled:shadow-none transition-all"
                    >
                      {settingsLoading ? 'Güncelleniyor...' : 'Ayarları Kaydet'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* REGISTERED PRODUCTS TAB */}
          {activeTab === 'registered-products' && !error && (
            <div className="bg-white rounded-2xl shadow-sm border border-zinc-100 overflow-hidden">
              <div className="p-6 border-b border-zinc-100 bg-zinc-50/50 flex justify-between items-center flex-wrap gap-4">
                <div>
                  <h2 className="text-xl font-bold text-on-surface">Kayıtlı Ürünlerim</h2>
                  <p className="text-xs text-zinc-400 mt-1">Sisteme kaydettiğiniz satın aldığınız ürünlerin listesi</p>
                </div>
                <button
                  onClick={() => {
                    setRegPhone(me?.phone || '')
                    setShowRegForm(true)
                  }}
                  className="px-4 py-2 bg-primary text-white text-xs font-bold rounded-xl hover:bg-primary-container transition-all flex items-center gap-1.5 shadow-md shadow-primary/10"
                >
                  <span className="material-symbols-outlined text-sm">add</span>
                  Yeni Ürün Kaydet
                </button>
              </div>

              <div className="p-6">
                {registeredProducts.length === 0 ? (
                  <div className="text-center py-12 text-zinc-550 space-y-4">
                    <span className="material-symbols-outlined text-5xl text-zinc-300">app_registration</span>
                    <h3 className="font-extrabold text-sm text-zinc-700">Henüz Kayıtlı Ürününüz Yok</h3>
                    <p className="text-xs text-zinc-550 max-w-sm mx-auto leading-relaxed">
                      Satın aldığınız Stilsoft ürünlerini kaydetmek için yukarıdaki butona tıklayıp seri numarası ile kayıt oluşturabilirsiniz.
                    </p>
                  </div>
                ) : (
                  <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {registeredProducts.map((p) => (
                      <div 
                        key={p.id} 
                        className="rounded-2xl border border-zinc-150 p-4 bg-zinc-50 flex items-start gap-4 hover:shadow-md transition-shadow relative overflow-hidden group"
                      >
                        <div className="w-16 h-16 bg-white rounded-xl border border-zinc-200 overflow-hidden shrink-0 flex items-center justify-center p-1">
                          {p.imageUrl ? (
                            <img src={p.imageUrl} className="w-full h-full object-contain" alt="" />
                          ) : (
                            <span className="material-symbols-outlined text-zinc-350 text-2xl">image</span>
                          )}
                        </div>
                        <div className="min-w-0 flex-1 space-y-1">
                          <h4 className="font-bold text-xs text-zinc-800 truncate" title={p.productName}>
                            {p.productName}
                          </h4>
                          <div className="text-[10px] text-zinc-400 font-semibold space-y-0.5">
                            <p>Seri No: <strong className="text-zinc-650 font-bold">{p.serialNumber}</strong></p>
                            <p>Kayıt: {new Date(p.createdAtUtc).toLocaleDateString('tr-TR')}</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Registration Form Modal */}
              {showRegForm && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
                  <div className="absolute inset-0 bg-black/40 backdrop-blur-xs" onClick={() => setShowRegForm(false)} />
                  <div className="bg-white rounded-3xl border border-zinc-200 shadow-2xl overflow-hidden w-full max-w-lg relative z-10 animate-in">
                    {/* Header */}
                    <div className="flex items-center justify-between border-b border-zinc-100 px-6 py-5 bg-zinc-50/50">
                      <h2 className="text-base font-bold text-on-surface flex items-center gap-1.5">
                        <span className="material-symbols-outlined text-primary text-xl">app_registration</span>
                        Yeni Ürün Kaydet
                      </h2>
                      <button
                        type="button"
                        onClick={() => setShowRegForm(false)}
                        className="grid h-9 w-9 place-items-center rounded-full hover:bg-zinc-100 transition-colors"
                      >
                        <span className="material-symbols-outlined text-zinc-500">close</span>
                      </button>
                    </div>

                    <form onSubmit={handleRegisterProductSubmit} className="p-6 space-y-4">
                      {regMsg && (
                        <div className={`px-4 py-3 rounded-xl text-xs font-bold border ${
                          regMsg.type === 'success' 
                            ? 'bg-emerald-50 border-emerald-200 text-emerald-700' 
                            : 'bg-rose-50 border-rose-200 text-rose-700'
                        }`}>
                          {regMsg.text}
                        </div>
                      )}

                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block">Kategori</label>
                        <select
                          value={regCategoryId}
                          onChange={(e) => setRegCategoryId(e.target.value)}
                          className="w-full px-4 py-2.5 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all text-xs font-semibold"
                          required
                        >
                          <option value="">Kategori Seçin</option>
                          {allCategories.map((c) => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                          ))}
                        </select>
                      </div>

                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block">Ürün</label>
                        <select
                          value={regProductId}
                          onChange={(e) => setRegProductId(e.target.value)}
                          className="w-full px-4 py-2.5 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all text-xs font-semibold disabled:opacity-50"
                          disabled={!regCategoryId || regLoadingProducts}
                          required
                        >
                          <option value="">{regLoadingProducts ? 'Yükleniyor...' : 'Ürün Seçin'}</option>
                          {regProductsList.map((p) => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                          ))}
                        </select>
                      </div>

                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block">Seri Numarası</label>
                        <input
                          value={regSerialNo}
                          onChange={(e) => setRegSerialNo(e.target.value)}
                          className="w-full px-4 py-2.5 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all text-xs font-semibold"
                          placeholder="Ürünün altındaki seri numarasını girin"
                          required
                          type="text"
                        />
                      </div>

                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block">Telefon Numarası</label>
                        <input
                          value={regPhone}
                          onChange={(e) => setRegPhone(e.target.value.replace(/\D/g, '').slice(0, 11))}
                          maxLength={11}
                          className="w-full px-4 py-2.5 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all text-xs font-semibold"
                          placeholder="Örn: 05XXXXXXXXX"
                          required
                          type="tel"
                        />
                      </div>

                      <div className="flex items-start pt-1">
                        <input
                          id="reg-kvkk-chk"
                          checked={regKVKK}
                          onChange={(e) => setRegKVKK(e.target.checked)}
                          className="w-4 h-4 text-primary border-zinc-300 rounded focus:ring-primary mt-0.5"
                          type="checkbox"
                          required
                        />
                        <label htmlFor="reg-kvkk-chk" className="ml-2 text-[11px] text-zinc-500 leading-normal select-none">
                          Kişisel verilerimin işlenmesine dair <a href="#" className="text-primary font-bold underline">KVKK metnini</a> okudum ve onaylıyorum.
                        </label>
                      </div>

                      <div className="pt-2 flex justify-end gap-2 border-t border-zinc-100 mt-6">
                        <button
                          type="button"
                          onClick={() => setShowRegForm(false)}
                          className="px-4 py-2.5 bg-zinc-100 text-zinc-700 text-xs font-bold rounded-xl hover:bg-zinc-200 transition-colors"
                        >
                          İptal
                        </button>
                        <button
                          type="submit"
                          disabled={regLoading}
                          className="px-6 py-2.5 bg-primary text-white text-xs font-bold rounded-xl hover:bg-primary-container shadow-md shadow-primary/10 disabled:bg-zinc-400 disabled:shadow-none transition-all flex items-center gap-1.5"
                        >
                          {regLoading ? 'Kaydediliyor...' : 'Ürünümü Kaydet'}
                        </button>
                      </div>
                    </form>
                  </div>
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
