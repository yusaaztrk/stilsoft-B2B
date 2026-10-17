import { Link, NavLink, useNavigate, useLocation } from 'react-router-dom'
import { useEffect, useMemo, useRef, useState } from 'react'
import { MemberAuthModal } from './MemberAuthModal'
import { CartSidebar } from './CartSidebar'
import { CART_ADD_EVENT, CART_EVENT, cartCount, readCart } from '../lib/cart'
import { getMemberToken, readApiResponse, extractProductsList, type ErpProductListItem } from '../lib/api'
import { generateSlug } from '../lib/slug'
import { useToast } from './ui/ToastContext'

import { fetchStorefrontCategories, type CategoryDto } from '../lib/categoriesApi'

function getCategoryIcon(slug: string, name: string): string {
  const s = (slug || '').toLowerCase()
  const n = (name || '').toLowerCase()
  if (s.includes('beyaz') || n.includes('beyaz')) return 'kitchen'
  if (s.includes('ankastre') || n.includes('ankastre')) return 'oven'
  if (s.includes('tv') || s.includes('televizyon') || n.includes('televizyon')) return 'tv'
  if (s.includes('elektronik') || n.includes('elektronik')) return 'devices'
  if (s.includes('isitma') || s.includes('sogutma') || n.includes('ısıtma') || n.includes('soğutma')) return 'thermostat'
  if (s.includes('kucuk') || s.includes('ev-alet') || n.includes('küçük ev') || n.includes('aletleri')) return 'blender'
  if (s.includes('hijyen') || s.includes('oto') || n.includes('hijyen') || n.includes('aksesuar')) return 'cable'
  return 'shopping_bag'
}

function ResetPasswordForm({
  email,
  token,
  onSuccess,
  onCancel,
  showToast
}: {
  email: string
  token: string
  onSuccess: () => void
  onCancel: () => void
  showToast: any
}) {
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const hint = useMemo(() => {
    if (!newPassword) return 'Yeni şifre giriniz.'
    if (newPassword.length < 8) return 'Şifre en az 8 karakter olmalı.'
    if (newPassword !== confirmPassword) return 'Şifreler eşleşmiyor.'
    return null
  }, [newPassword, confirmPassword])

  const isValid = newPassword.length >= 8 && newPassword === confirmPassword

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!isValid) return
    setError(null)
    setBusy(true)
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, token, newPassword })
      })
      const data = await res.json()
      if (!res.ok || !data?.success) {
        setError(data?.message || 'Şifre sıfırlama başarısız.')
        return
      }
      showToast('Şifreniz başarıyla sıfırlandı.', 'success', 3000)
      onSuccess()
    } catch (err) {
      setError('Ağ hatası oluştu. Lütfen tekrar deneyin.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="relative z-10 flex flex-col justify-between min-h-[340px] pt-4">
      <div className="space-y-4">
        <div className="text-center">
          <h2 className="text-xl font-black text-zinc-900 tracking-tight">Yeni Şifre Belirleyin</h2>
          <p className="text-xs text-zinc-400 font-semibold mt-1">Lütfen yeni şifrenizi giriniz</p>
        </div>

        {error && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50/50 px-4 py-3 text-xs font-bold text-rose-700 animate-in">
            {error}
          </div>
        )}

        <div className="space-y-1.5">
          <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-wider pl-1">Yeni Şifre</label>
          <div className="relative group/input">
            <span className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400 text-lg group-focus-within/input:text-primary transition-colors">lock</span>
            <input
              type={showPassword ? 'text' : 'password'}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full pl-11 pr-12 py-3 bg-zinc-50/50 border border-zinc-200/80 rounded-2xl text-sm outline-none focus:bg-white focus:ring-4 focus:ring-primary/5 focus:border-zinc-800 transition-all font-semibold text-zinc-800 placeholder:text-zinc-300"
              placeholder="••••••••"
              required
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-wider pl-1">Yeni Şifre (Tekrar)</label>
          <div className="relative group/input">
            <span className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400 text-lg group-focus-within/input:text-primary transition-colors">lock</span>
            <input
              type={showPassword ? 'text' : 'password'}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full pl-11 pr-12 py-3 bg-zinc-50/50 border border-zinc-200/80 rounded-2xl text-sm outline-none focus:bg-white focus:ring-4 focus:ring-primary/5 focus:border-zinc-800 transition-all font-semibold text-zinc-800 placeholder:text-zinc-300"
              placeholder="••••••••"
              required
            />
            <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-655 transition-colors">
              <span className="material-symbols-outlined text-lg">{showPassword ? 'visibility_off' : 'visibility'}</span>
            </button>
          </div>
        </div>

        {hint && !error && (
          <div className="text-[10px] font-bold text-zinc-400 text-center leading-none mt-1 animate-in">
            {hint}
          </div>
        )}
      </div>

      <div className="space-y-2 pt-4">
        <button
          type="submit"
          disabled={!isValid || busy}
          className="w-full bg-gradient-to-r from-primary via-rose-600 to-primary bg-[length:200%_auto] hover:bg-right hover:scale-[1.01] active:scale-[0.99] text-white py-3.5 rounded-2xl font-extrabold text-sm shadow-[0_8px_24px_rgba(223,0,0,0.2)] hover:shadow-[0_12px_28px_rgba(223,0,0,0.35)] transition-all duration-300 flex items-center justify-center gap-1.5 group"
        >
          {busy ? 'Güncelleniyor...' : 'Şifreyi Güncelle'}
          <span className="material-symbols-outlined text-lg group-hover:translate-x-1 transition-transform">arrow_forward</span>
        </button>

        <button
          type="button"
          onClick={onCancel}
          className="w-full py-2.5 border border-zinc-200 rounded-2xl text-xs font-bold text-zinc-500 hover:bg-zinc-50 hover:text-zinc-700 transition-all active:scale-[0.98]"
        >
          İptal
        </button>
      </div>
    </form>
  )
}

const storefrontPages = [
  { to: '/hakkimizda', label: 'Hakkımızda', desc: 'Şirketimiz ve kurumsal vizyonumuz' },
  { to: '/kvkk', label: 'KVKK Aydınlatma Metni', desc: 'Kişisel verilerin korunması kanunu şartları' },
  { to: '/gizlilik-politikasi', label: 'Gizlilik Politikası', desc: 'Güvenlik ve gizlilik sözleşmesi' },
  { to: '/mesafeli-satis-sozlesmesi', label: 'Mesafeli Satış Sözleşmesi', desc: 'Mesafeli satış şartları ve mesafeli sözleşme' },
  { to: '/iade-ve-degisim-kosullari', label: 'İade ve Değişim Koşulları', desc: 'İade şartları ve iade talepleri süreci' },
  { to: '/destek-sss', label: 'Destek / SSS', desc: 'Sıkça sorulan sorular ve müşteri destek hizmetleri' },
  { to: '/iletisim', label: 'İletişim', desc: 'İletişim formları, telefon numarası ve mağaza adresi' },
  { to: '/teknik-servis', label: 'Teknik Servis', desc: 'Arıza bildirimi, servis kaydı ve servis sorgulama' },
  { to: '/garanti', label: 'Garanti Sorgulama', desc: 'Ürün garanti süresi sorgulama paneli' },
  { to: '/kampanyalar', label: 'Kampanyalar', desc: 'Güncel indirimler, kampanyalı ürünler ve hediye çekleri' },
  { to: '/blog', label: 'Blog / Haberler', desc: 'Küçük ev aletleri kullanımı ve lezzetli yemek tarifleri blogu' }
]

export function Shell({ children }: { children: React.ReactNode }) {
  const { showToast } = useToast()
  const location = useLocation()
  const isCheckoutPage = location.pathname === '/checkout' || location.pathname === '/odeme'

  const [memberOpen, setMemberOpen] = useState(false)
  const [memberMenuOpen, setMemberMenuOpen] = useState(false)
  const [showRegPromptModal, setShowRegPromptModal] = useState(false)
  const [cartOpen, setCartOpen] = useState(false)
  const [cartNoticeVisible, setCartNoticeVisible] = useState(false)
  const [liveSupportOpen, setLiveSupportOpen] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  const [resetModalState, setResetModalState] = useState<{
    isOpen: boolean
    step: 'confirm' | 'form' | 'success'
    token: string
    email: string
  } | null>(null)

  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const resetToken = params.get('resetToken')
    const email = params.get('email')
    if (resetToken && email) {
      setResetModalState({
        isOpen: true,
        step: 'confirm',
        token: resetToken,
        email: email,
      })
      // Clear URL params
      const newParams = new URLSearchParams(location.search)
      newParams.delete('resetToken')
      newParams.delete('email')
      const newSearch = newParams.toString()
      const newPath = location.pathname + (newSearch ? `?${newSearch}` : '')
      window.history.replaceState(null, '', newPath)
    }
  }, [location])

  const handleRegisterProductClick = () => {
    const token = getMemberToken()
    if (token) {
      navigate('/hesabim?tab=registered-products')
    } else {
      sessionStorage.setItem('reg_product_pending_redirect', 'true')
      setShowRegPromptModal(true)
    }
  }
  const [mobileCategoryOpen, setMobileCategoryOpen] = useState(false)
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [cartItems, setCartItems] = useState(() => readCart())
  const [member, setMember] = useState<{ id: string; email: string; fullName: string; phone?: string | null } | null>(null)
  const memberMenuRef = useRef<HTMLDivElement | null>(null)
  const cartNoticeTimerRef = useRef<number | null>(null)

  // Newsletter subscription state
  const [newsletterEmail, setNewsletterEmail] = useState('')
  const [subscribing, setSubscribing] = useState(false)
  const [newsletterStatus, setNewsletterStatus] = useState<'idle' | 'success' | 'error'>('idle')

  // Search Autocomplete state
  const searchRef = useRef<HTMLDivElement | null>(null)
  const [isSearchFocused, setIsSearchFocused] = useState(false)
  const [productsList, setProductsList] = useState<ErpProductListItem[]>([])
  const [recentSearches, setRecentSearches] = useState<string[]>(() =>
    JSON.parse(localStorage.getItem('ecom_recent_searches') || '[]')
  )
  const [design, setDesign] = useState<{
    brandName: string
    logoUrl?: string
    announcement: string
    footerText: string
    primaryColor: string
    facebookUrl?: string
    instagramUrl?: string
    twitterUrl?: string
    youtubeUrl?: string
    announcementHtml?: string
    announcementBgColor?: string
    announcementTextColor?: string
    announcementActive?: boolean
    announcementLink?: string
    announcements?: Array<{
      id: string
      contentHtml: string
      bgColor: string
      textColor: string
      isActive: boolean
      link: string
      order: number
    }>
  }>({
    brandName: 'STILSOFT',
    logoUrl: '',
    announcement: '2.000 TL ve uzeri alisverislerde UCRETSIZ KARGO',
    footerText: 'Guvenli alisveris, hizli teslimat ve kolay iade.',
    primaryColor: '#16a34a',
    announcementHtml: '',
    announcementBgColor: '#D32F2F',
    announcementTextColor: '#FFFFFF',
    announcementActive: true,
    announcementLink: '',
    announcements: [],
  })
  const [categories, setCategories] = useState<CategoryDto[]>([])
  const [isMegaMenuOpen, setIsMegaMenuOpen] = useState(false)
  const [activeMenuCategory, setActiveMenuCategory] = useState<string | null>(null)
  const [activeSubCategory, setActiveSubCategory] = useState<string | null>(null)
  const [activeLeafCategory, setActiveLeafCategory] = useState<string | null>(null)
  const [megaMenuProducts, setMegaMenuProducts] = useState<Record<string, ErpProductListItem[]>>({})
  const [megaMenuProductsLoading, setMegaMenuProductsLoading] = useState<string | null>(null)

  const matchingCategories = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return []
    return categories.filter((c) => c.name.toLowerCase().includes(q)).slice(0, 3)
  }, [categories, searchQuery])

  const matchingPages = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return []
    return storefrontPages.filter(
      (p) =>
        p.label.toLowerCase().includes(q) ||
        p.desc.toLowerCase().includes(q)
    ).slice(0, 3)
  }, [searchQuery])

  const matchingProducts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return []
    return productsList.filter((p) => (p.name ?? '').toLowerCase().includes(q)).slice(0, 5)
  }, [productsList, searchQuery])

  const activeAnnouncements = useMemo(() => {
    if (Array.isArray(design.announcements)) {
      const activeList = design.announcements.filter((a) => a.isActive)
      if (activeList.length > 0) {
        return [...activeList].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      }
    }
    if (design.announcementActive && design.announcementHtml) {
      return [
        {
          id: 'legacy',
          contentHtml: design.announcementHtml,
          bgColor: design.announcementBgColor || '#D32F2F',
          textColor: design.announcementTextColor || '#FFFFFF',
          isActive: true,
          link: design.announcementLink || '',
          order: 0,
        },
      ]
    }
    return []
  }, [design])

  const megaMenuLeafCategories = useMemo(() => {
    if (!activeSubCategory) return []
    return categories
      .filter((c) => c.parentId === activeSubCategory)
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name, 'tr'))
  }, [categories, activeSubCategory])

  const megaMenuPreviewCategory = useMemo(() => {
    const leaf = activeLeafCategory ? categories.find((c) => c.id === activeLeafCategory) : null
    if (leaf) return leaf
    if (megaMenuLeafCategories.length > 0) return megaMenuLeafCategories[0]
    return activeSubCategory ? categories.find((c) => c.id === activeSubCategory) ?? null : null
  }, [activeLeafCategory, activeSubCategory, categories, megaMenuLeafCategories])

  const fetchProductsForSearch = async () => {
    if (productsList.length > 0) return
    try {
      const res = await fetch('/api/storefront/products')
      const json = await readApiResponse(res)
      if (res.ok) {
        setProductsList(extractProductsList(json))
      }
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    if (!isMegaMenuOpen || !megaMenuPreviewCategory) return
    if (megaMenuProducts[megaMenuPreviewCategory.id]) return

    let cancelled = false
    setMegaMenuProductsLoading(megaMenuPreviewCategory.id)
    ;(async () => {
      try {
        const res = await fetch(`/api/storefront/categories/${encodeURIComponent(megaMenuPreviewCategory.slug)}/products`)
        const json = await readApiResponse(res)
        const products = res.ok ? extractProductsList(json).slice(0, 4) : []
        if (!cancelled) {
          setMegaMenuProducts((prev) => ({ ...prev, [megaMenuPreviewCategory.id]: products }))
        }
      } catch {
        if (!cancelled) {
          setMegaMenuProducts((prev) => ({ ...prev, [megaMenuPreviewCategory.id]: [] }))
        }
      } finally {
        if (!cancelled) {
          setMegaMenuProductsLoading((current) => (current === megaMenuPreviewCategory.id ? null : current))
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [isMegaMenuOpen, megaMenuPreviewCategory, megaMenuProducts])

  const megaMenuPreviewProducts = megaMenuPreviewCategory ? megaMenuProducts[megaMenuPreviewCategory.id] ?? [] : []

  const handleSearchFocus = () => {
    setIsSearchFocused(true)
    void fetchProductsForSearch()
  }
  const navigate = useNavigate()

  const isAuthed = useMemo(() => Boolean(getMemberToken()), [member])

  const loadMember = async () => {
    const token = getMemberToken()
    if (!token) {
      const hadMember = member !== null
      setMember(null)
      if (hadMember) {
        window.dispatchEvent(new CustomEvent('ecom-cart-changed'))
      }
      return
    }

    const raw = localStorage.getItem('ecom_member_user')
    if (raw) {
      try {
        const u = JSON.parse(raw)
        const fullName = String(u?.fullName ?? '')
        const email = String(u?.email ?? '')
        const id = String(u?.id ?? '')
        const phone = u?.phone ?? null
        if (fullName || email) {
          const changed = !member || member.id !== id
          setMember({ id, email, fullName, phone })
          if (changed) {
            window.dispatchEvent(new CustomEvent('ecom-cart-changed'))
          }
        }
      } catch {
        // ignore
      }
    }

    try {
      const res = await fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } })
      const json = await readApiResponse(res)
      if (!res.ok || !json?.success) {
        const hadMember = member !== null
        setMember(null)
        if (hadMember) {
          window.dispatchEvent(new CustomEvent('ecom-cart-changed'))
        }
        return
      }
      const d = json?.data
      const next = { id: String(d?.id ?? ''), email: String(d?.email ?? ''), fullName: String(d?.fullName ?? ''), phone: d?.phone ?? null }
      const changed = !member || member.id !== next.id
      setMember(next)
      localStorage.setItem('ecom_member_user', JSON.stringify(next))
      if (changed) {
        window.dispatchEvent(new CustomEvent('ecom-cart-changed'))
      }
    } catch {
      const hadMember = member !== null
      setMember(null)
      if (hadMember) {
        window.dispatchEvent(new CustomEvent('ecom-cart-changed'))
      }
    }
  }

  useEffect(() => {
    const sync = () => setCartItems(readCart())
    window.addEventListener(CART_EVENT, sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(CART_EVENT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  useEffect(() => {
    const showCartNotice = () => {
      setCartNoticeVisible(true)
      if (cartNoticeTimerRef.current) {
        window.clearTimeout(cartNoticeTimerRef.current)
      }
      cartNoticeTimerRef.current = window.setTimeout(() => {
        setCartNoticeVisible(false)
        cartNoticeTimerRef.current = null
      }, 1000)
    }

    window.addEventListener(CART_ADD_EVENT, showCartNotice)
    return () => {
      window.removeEventListener(CART_ADD_EVENT, showCartNotice)
      if (cartNoticeTimerRef.current) {
        window.clearTimeout(cartNoticeTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    void loadMember()
    const handleLoginSuccess = () => {
      void loadMember()
      window.dispatchEvent(new CustomEvent('ecom-cart-changed'))
      if (sessionStorage.getItem('reg_product_pending_redirect') === 'true') {
        sessionStorage.removeItem('reg_product_pending_redirect')
        navigate('/hesabim?tab=registered-products')
      }
    }
    window.addEventListener('member-login-success', handleLoginSuccess)
    return () => {
      window.removeEventListener('member-login-success', handleLoginSuccess)
    }
  }, [])

  useEffect(() => {
    if (memberOpen) return
    void loadMember()
  }, [memberOpen])

  useEffect(() => {
    function onDocDown(e: MouseEvent) {
      if (!memberMenuOpen) return
      const target = e.target as Node | null
      if (memberMenuRef.current && target && memberMenuRef.current.contains(target)) return
      setMemberMenuOpen(false)
    }
    document.addEventListener('mousedown', onDocDown)
    return () => document.removeEventListener('mousedown', onDocDown)
  }, [memberMenuOpen])

  useEffect(() => {
    function onDocDown(e: MouseEvent) {
      if (!isSearchFocused) return
      const target = e.target as Node | null
      if (searchRef.current && target && searchRef.current.contains(target)) return
      setIsSearchFocused(false)
    }
    document.addEventListener('mousedown', onDocDown)
    return () => document.removeEventListener('mousedown', onDocDown)
  }, [isSearchFocused])

  useEffect(() => {
    ;(async () => {
      try {
        const res = await fetch('/api/store-design')
        const json = await res.json()
        if (res.ok && json?.data) {
          setDesign((prev) => ({ ...prev, ...json.data }))
          localStorage.setItem('ecom_store_design', JSON.stringify(json.data))
          if (json.data.primaryColor) document.documentElement.style.setProperty('--color-primary', json.data.primaryColor)
          if (json.data.accentColor) document.documentElement.style.setProperty('--color-accent', json.data.accentColor)
        }
      } catch {
        // Keep the storefront usable if the design endpoint is temporarily unavailable.
      }
    })()
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const list = await fetchStorefrontCategories()
        if (!cancelled) setCategories(list)
      } catch {
        if (!cancelled) setCategories([])
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  const headerCategories = useMemo(
    () =>
      categories
        .filter((c) => !c.parentId)
        .filter((c) => c.showInHeader ?? true)
        .slice()
        .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name, 'tr'))
        .slice(0, 6),
    [categories],
  )

  const footerCategories = useMemo(
    () =>
      categories
        .filter((c) => !c.parentId)
        .filter((c) => Boolean(c.showInFooter))
        .slice()
        .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name, 'tr'))
        .slice(0, 8),
    [categories],
  )

  const handleSubscribe = async (e: React.FormEvent) => {
    e.preventDefault()
    const email = newsletterEmail.trim()
    if (!email) return
    setSubscribing(true)
    setNewsletterStatus('idle')
    try {
      const res = await fetch('/api/storefront/newsletter/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      if (res.ok) {
        setNewsletterStatus('success')
        setNewsletterEmail('')
      } else {
        setNewsletterStatus('error')
      }
    } catch {
      setNewsletterStatus('error')
    } finally {
      setSubscribing(false)
      // Reset status message after 5 seconds
      setTimeout(() => setNewsletterStatus('idle'), 5000)
    }
  }

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = searchQuery.trim()
    if (trimmed) {
      // Save to recent searches
      const recent = JSON.parse(localStorage.getItem('ecom_recent_searches') || '[]') as string[]
      const updated = [trimmed, ...recent.filter((x) => x !== trimmed)].slice(0, 5)
      localStorage.setItem('ecom_recent_searches', JSON.stringify(updated))
      setRecentSearches(updated)

      navigate(`/arama?q=${encodeURIComponent(trimmed)}`)
      setSearchQuery('')
      setIsSearchFocused(false)
    }
  }

  const openMember = () => {
    const token = getMemberToken()
    if (!token) {
      setMemberOpen(true)
      return
    }
    setMemberMenuOpen((x) => !x)
  }

  const logout = () => {
    localStorage.removeItem('ecom_member_token')
    localStorage.removeItem('ecom_member_user')
    setMember(null)
    setMemberMenuOpen(false)
    window.dispatchEvent(new CustomEvent('ecom-cart-changed'))
    showToast('Çıkış işleminiz başarıyla tamamlandı. Tekrar görüşmek üzere!', 'success', 2000)
    navigate('/')
  }

  return (
    <div className="min-h-screen bg-[#f4f4f6] text-zinc-900 font-inter">
      {/* Tier 1: Utility Navigation Bar */}
      <div className="bg-[#191919] text-zinc-300 text-[11px] font-bold py-2 border-b border-zinc-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 flex items-center justify-between gap-4 overflow-x-auto whitespace-nowrap scrollbar-none">
          <div className="flex items-center gap-4 sm:gap-6 shrink-0">
            <Link to="/iletisim" className="hover:text-white transition-colors flex items-center gap-1 shrink-0 whitespace-nowrap">
              <span className="material-symbols-outlined text-[13px] text-zinc-400">storefront</span>
              Mağazalarımız
            </Link>
            <Link to="/teknik-servis" className="hover:text-white transition-colors flex items-center gap-1 shrink-0 whitespace-nowrap">
              <span className="material-symbols-outlined text-[13px] text-zinc-400">support_agent</span>
              Müşteri Hizmetleri & Teknik Servis
            </Link>
            <Link to="/garanti" className="hover:text-white transition-colors flex items-center gap-1 shrink-0 whitespace-nowrap">
              <span className="material-symbols-outlined text-[13px] text-zinc-400">verified_user</span>
              Garanti Takibi
            </Link>
            <button
              onClick={handleRegisterProductClick}
              className="hover:text-white transition-colors flex items-center gap-1 bg-transparent border-none text-[11px] font-bold cursor-pointer outline-none shrink-0 whitespace-nowrap"
            >
              <span className="material-symbols-outlined text-[13px] text-zinc-400">app_registration</span>
              Ürünü Kaydet
            </button>
            <Link to="/survey" className="hover:text-white transition-colors flex items-center gap-1 shrink-0 whitespace-nowrap">
              <span className="material-symbols-outlined text-[13px] text-zinc-400">quiz</span>
              Memnuniyet Anketi
            </Link>
          </div>
          <div className="flex items-center gap-3 shrink-0 whitespace-nowrap">
            <span className="bg-primary hover:bg-primary-container text-white px-2 py-0.5 rounded-sm text-[9px] font-black tracking-wider uppercase cursor-pointer select-none shrink-0 whitespace-nowrap">
              CLUB {design.brandName}
            </span>
            <span className="text-zinc-400 shrink-0">|</span>
            <span className="opacity-80 hover:opacity-100 cursor-pointer shrink-0 whitespace-nowrap">Sipariş Takibi</span>
          </div>
        </div>
      </div>

      {/* Header */}
      <header className="sticky top-0 w-full z-50">
        {/* Announcement Bar (Kayan Yazı - LTR) */}
        {activeAnnouncements.length > 0 && (
          <>
            <style dangerouslySetInnerHTML={{ __html: `
              @keyframes marquee-ltr {
                0% { transform: translate3d(-100%, 0, 0); }
                100% { transform: translate3d(100vw, 0, 0); }
              }
              .marquee-inner p, .marquee-inner div {
                display: inline !important;
                margin: 0 !important;
              }
            `}} />
            <div 
              className="relative h-9 w-full overflow-hidden flex items-center border-b border-black/5 select-none animate-in fade-in duration-300"
              style={{ backgroundColor: activeAnnouncements[0].bgColor || '#D32F2F' }}
            >
              <div 
                className="absolute whitespace-nowrap text-xs font-bold tracking-wide flex items-center gap-2 marquee-inner"
                style={{
                  left: 0,
                  color: activeAnnouncements[0].textColor || '#FFFFFF',
                  animation: 'marquee-ltr 22s linear infinite',
                }}
                dangerouslySetInnerHTML={{ 
                  __html: activeAnnouncements.map((a) => {
                    if (a.link) {
                      return `<a href="${a.link}" style="color: inherit; text-decoration: none; display: inline-flex; align-items: center;" class="hover:underline">${a.contentHtml}</a>`
                    }
                    return `<span style="display: inline-flex; align-items: center;">${a.contentHtml}</span>`
                  }).join(' <span style="margin: 0 2rem; opacity: 0.6; display: inline-block;">-</span> ')
                }}
              />
            </div>
          </>
        )}

        {/* Tier 2: Main Header Red Bar */}
        <div className="bg-primary text-white py-3.5 shadow-md">
          <div className="max-w-7xl mx-auto px-6 flex items-center justify-between gap-6">
            {/* Logo */}
            <Link to="/" className="flex items-center gap-2 select-none active:scale-95 transition-transform flex-shrink-0">
              {design.logoUrl ? (
                <img src={design.logoUrl} alt={design.brandName} className="h-10 sm:h-12 max-w-[150px] sm:max-w-[200px] object-contain" />
              ) : (
                <div className="bg-black text-white px-4 py-1.5 font-black text-2xl italic tracking-tighter uppercase border-r-4 border-white flex items-center shadow-lg">
                  {design.brandName}
                </div>
              )}
            </Link>

            {/* Search Input Bar */}
            <div ref={searchRef} className="flex-1 max-w-xl relative hidden md:block">
              <form onSubmit={handleSearch} className="flex items-center bg-white rounded-md px-4 py-2.5 shadow-inner">
                <input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onFocus={handleSearchFocus}
                  className="bg-transparent border-none focus:ring-0 text-sm text-zinc-900 outline-none w-full placeholder:text-zinc-400 font-semibold"
                  placeholder="Hangi ürünü aramıştınız? (Örn: Blender, Mikser...)"
                  type="text"
                />
                <button type="submit" className="text-primary hover:scale-110 active:scale-95 transition-all ml-2 flex items-center justify-center">
                  <span className="material-symbols-outlined text-2xl font-bold">search</span>
                </button>
              </form>

              {/* Autocomplete Popover */}
              {isSearchFocused && (
                <div className="absolute left-0 right-0 mt-2 bg-white rounded-xl border border-zinc-200 shadow-2xl overflow-hidden z-[90] p-4 space-y-4 text-zinc-900">
                  {searchQuery.trim() === '' ? (
                    <>
                      {recentSearches.length > 0 && (
                        <div>
                          <div className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-2 flex items-center gap-1">
                            <span className="material-symbols-outlined text-xs">history</span> Son Aramalar
                          </div>
                          <div className="space-y-1">
                            {recentSearches.map((s) => (
                              <button
                                key={s}
                                type="button"
                                onClick={() => {
                                  setSearchQuery(s)
                                  navigate(`/arama?q=${encodeURIComponent(s)}`)
                                  setIsSearchFocused(false)
                                }}
                                className="w-full text-left px-2 py-1.5 hover:bg-zinc-50 text-xs font-bold text-zinc-700 rounded-lg flex items-center justify-between"
                              >
                                {s}
                                <span className="material-symbols-outlined text-[10px] text-zinc-400">north_west</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                      <div>
                        <div className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-2 flex items-center gap-1">
                          <span className="material-symbols-outlined text-xs">trending_up</span> Popüler Aramalar
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {['Blender', 'Mikser', 'Ütü', 'Çay Makinesi', 'Tost Makinesi'].map((term) => (
                            <button
                              key={term}
                              type="button"
                              onClick={() => {
                                setSearchQuery(term)
                                navigate(`/arama?q=${encodeURIComponent(term)}`)
                                setIsSearchFocused(false)
                              }}
                              className="px-2.5 py-1.5 bg-zinc-100 hover:bg-zinc-200 text-[11px] font-extrabold text-zinc-600 rounded-lg transition"
                            >
                              {term}
                            </button>
                          ))}
                        </div>
                      </div>
                    </>
                  ) : (
                    <>
                      {matchingCategories.length > 0 && (
                        <div>
                          <div className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-2">Kategoriler</div>
                          <div className="space-y-1">
                            {matchingCategories.map((c) => (
                              <Link
                                key={c.id}
                                to={`/kategori/${encodeURIComponent(c.slug)}`}
                                onClick={() => setIsSearchFocused(false)}
                                className="flex items-center gap-2 px-2 py-1.5 hover:bg-zinc-50 text-xs font-bold text-zinc-700 rounded-lg"
                              >
                                <span className="material-symbols-outlined text-zinc-400 text-sm">folder</span>
                                {c.name}
                              </Link>
                            ))}
                          </div>
                        </div>
                      )}

                      {matchingPages.length > 0 && (
                        <div>
                          <div className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-2">Sayfalar</div>
                          <div className="space-y-1">
                            {matchingPages.map((p) => (
                              <Link
                                key={p.to}
                                to={p.to}
                                onClick={() => setIsSearchFocused(false)}
                                className="flex flex-col gap-0.5 px-2 py-1.5 hover:bg-zinc-50 text-xs font-bold text-zinc-700 rounded-lg"
                              >
                                <span className="text-xs font-bold text-zinc-700">{p.label}</span>
                                <span className="text-[9px] text-zinc-400 font-semibold">{p.desc}</span>
                              </Link>
                            ))}
                          </div>
                        </div>
                      )}

                      <div>
                        <div className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-2">Ürünler</div>
                        {matchingProducts.length > 0 ? (
                          <div className="space-y-1.5">
                            {matchingProducts.map((p) => (
                              <Link
                                key={p.id}
                                to={`/urun/${generateSlug(p.name || '')}/${p.id}`}
                                onClick={() => setIsSearchFocused(false)}
                                className="flex items-center gap-2.5 px-2 py-1 hover:bg-zinc-50 rounded-lg transition"
                              >
                                <div className="w-8 h-8 rounded-md bg-zinc-50 overflow-hidden border border-zinc-100 flex-shrink-0 flex items-center justify-center">
                                  {p.imageUrl ? (
                                    <img src={p.imageUrl} className="w-full h-full object-contain p-0.5" alt="" />
                                  ) : (
                                    <span className="material-symbols-outlined text-zinc-300 text-xs">image</span>
                                  )}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <p className="text-xs font-bold text-zinc-800 truncate">{p.name}</p>
                                  <p className="text-[10px] text-primary font-extrabold">{p.unitPrice ? `₺${p.unitPrice.toLocaleString('tr-TR')}` : ''}</p>
                                </div>
                              </Link>
                            ))}
                          </div>
                        ) : (
                          <p className="text-[11px] text-zinc-400 px-2 py-1">Eşleşen ürün bulunamadı.</p>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Actions Area */}
            <div className="flex items-center gap-6">
              <button
                className="flex items-center gap-1.5 text-white hover:text-zinc-200 transition-colors"
                title="Favorilerim"
                type="button"
                onClick={() => navigate('/favoriler')}
              >
                <span className="material-symbols-outlined text-[24px]">favorite</span>
                <span className="hidden lg:block text-xs font-black uppercase tracking-wider">Favoriler</span>
              </button>
              <button
                className="flex items-center gap-1.5 text-white hover:text-zinc-200 transition-colors"
                title="Karşılaştır"
                type="button"
                onClick={() => navigate('/karsilastir')}
              >
                <span className="material-symbols-outlined text-[24px]">compare_arrows</span>
                <span className="hidden lg:block text-xs font-black uppercase tracking-wider">Karşılaştır</span>
              </button>
              <button
                className="flex items-center gap-1.5 text-white hover:text-zinc-200 transition-colors relative"
                onClick={() => setCartOpen(true)}
                title="Sepetim"
              >
                <span className="material-symbols-outlined text-[24px]">shopping_cart</span>
                <span className="absolute -top-1.5 -right-2 bg-white text-primary text-[10px] w-[18px] h-[18px] rounded-full flex items-center justify-center font-black shadow-md">{cartCount(cartItems)}</span>
                <span className="hidden lg:block text-xs font-black uppercase tracking-wider ml-1">Sepetim</span>
              </button>

              {/* Login / Auth */}
              <div className="relative" ref={memberMenuRef}>
                <button
                  className="flex items-center gap-1.5 text-white hover:text-zinc-200 transition-colors px-1"
                  onClick={openMember}
                  title={isAuthed ? 'Hesabım' : 'Giriş Yap'}
                  type="button"
                >
                  <span className="material-symbols-outlined text-[24px]">person</span>
                  <span className="hidden lg:block text-xs font-black uppercase tracking-wider">{member?.fullName ? member.fullName.split(' ')[0] : 'Giriş Yap'}</span>
                </button>

                {memberMenuOpen && (
                  <div className="absolute right-0 mt-2 w-56 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-2xl text-zinc-900 z-50">
                    <div className="px-4 py-3 border-b border-zinc-100 bg-zinc-50">
                      <div className="text-sm font-extrabold text-on-surface truncate">{member?.fullName || 'Hesabım'}</div>
                      <div className="text-[11px] text-zinc-500 truncate">{member?.email || ''}</div>
                    </div>
                    <div className="p-2">
                      <button
                        type="button"
                        onClick={() => {
                          setMemberMenuOpen(false)
                          navigate('/hesabim')
                        }}
                        className="w-full flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-bold text-zinc-700 hover:bg-zinc-50"
                      >
                        <span className="material-symbols-outlined text-[20px] text-zinc-500">person</span>
                        Profilim
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setMemberMenuOpen(false)
                          navigate('/hesabim?tab=orders')
                        }}
                        className="w-full flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-bold text-zinc-700 hover:bg-zinc-50"
                      >
                        <span className="material-symbols-outlined text-[20px] text-zinc-500">shopping_bag</span>
                        Siparişlerim
                      </button>
                      <button
                        type="button"
                        onClick={logout}
                        className="w-full flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-bold text-rose-700 hover:bg-rose-50"
                      >
                        <span className="material-symbols-outlined text-[20px]">logout</span>
                        Çıkış
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Mobile Menu Toggle */}
              <button
                className="lg:hidden w-10 h-10 grid place-items-center rounded-full hover:bg-white/10 active:scale-90 transition-all"
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                aria-label="Menü"
              >
                <span className="material-symbols-outlined text-white text-[22px]">{mobileMenuOpen ? 'close' : 'menu'}</span>
              </button>
            </div>
          </div>
        </div>

        {/* Tier 3: Category Nav Bar */}
        <div 
          className="bg-white border-b border-zinc-200/80 shadow-xs hidden lg:block relative"
          onMouseLeave={() => {
            setIsMegaMenuOpen(false)
            setActiveMenuCategory(null)
            setActiveSubCategory(null)
            setActiveLeafCategory(null)
          }}
        >
          <div className="max-w-7xl mx-auto px-6 py-2.5 flex items-center justify-between">
            <div className="flex items-center gap-6">
              <button
                onClick={() => navigate('/kategoriler')}
                onMouseEnter={() => {
                  setIsMegaMenuOpen(true)
                  const rootCats = categories.filter((c) => !c.parentId)
                  if (rootCats.length > 0 && !activeMenuCategory) {
                    setActiveMenuCategory(rootCats[0].id)
                  }
                  setActiveLeafCategory(null)
                }}
                className="flex items-center gap-1.5 text-zinc-950 hover:text-primary transition-colors text-xs font-black uppercase tracking-wider"
              >
                <span className="material-symbols-outlined text-[20px]">menu</span> Tüm Kategoriler
              </button>
              <div className="h-4 w-[1px] bg-zinc-200" />
              {headerCategories.map((c) => (
                <Link
                  key={c.id}
                  to={`/kategori/${encodeURIComponent(c.slug)}`}
                  onMouseEnter={() => {
                    setIsMegaMenuOpen(true)
                    setActiveMenuCategory(c.id)
                    setActiveSubCategory(null)
                    setActiveLeafCategory(null)
                  }}
                  className="text-zinc-600 hover:text-primary transition-colors text-xs font-extrabold uppercase tracking-wider"
                >
                  {c.name}
                </Link>
              ))}
            </div>
            <div>
              <Link
                to="/kampanyalar"
                className="flex items-center gap-1 text-primary hover:text-red-700 transition-colors text-xs font-black uppercase tracking-wider"
              >
                <span className="material-symbols-outlined text-[16px] animate-pulse">local_fire_department</span> KAMPANYALAR
              </Link>
            </div>
          </div>

          {/* Mega Dropdown Menu */}
          {isMegaMenuOpen && (
            <div className="absolute left-0 right-0 top-full bg-white border-b border-zinc-200 shadow-2xl z-[9999] animate-fade-in flex">
              <div className="max-w-7xl mx-auto px-6 w-full flex min-h-[420px] max-h-[500px]">
                {/* Column 1: Root Categories */}
                <div className="w-[280px] bg-zinc-50 border-r border-zinc-150 py-4 overflow-y-auto">
                  {categories
                    .filter((c) => !c.parentId)
                    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name, 'tr'))
                    .map((c) => {
                      const hasSub = categories.some((x) => x.parentId === c.id)
                      const isHovered = activeMenuCategory === c.id
                      const icon = getCategoryIcon(c.slug, c.name)
                      return (
                        <div
                          key={c.id}
                          onMouseEnter={() => {
                            setActiveMenuCategory(c.id)
                            setActiveSubCategory(null)
                            setActiveLeafCategory(null)
                          }}
                          onClick={() => {
                            navigate(`/kategori/${encodeURIComponent(c.slug)}`)
                            setIsMegaMenuOpen(false)
                          }}
                          className={`flex items-center justify-between px-5 py-3 text-xs font-bold transition-all cursor-pointer border-l-4 ${
                            isHovered
                              ? 'bg-white border-primary text-primary'
                              : 'border-transparent text-zinc-700 hover:bg-zinc-100/60'
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <span className={`material-symbols-outlined text-lg ${isHovered ? 'text-primary' : 'text-zinc-400'}`}>
                              {icon}
                            </span>
                            {c.name}
                          </div>
                          {hasSub && (
                            <span className="material-symbols-outlined text-xs opacity-60">chevron_right</span>
                          )}
                        </div>
                      )
                    })}
                </div>

                {/* Column 2: Subcategories (Level 2) */}
                <div className="w-[280px] bg-white border-r border-zinc-150 py-4 overflow-y-auto">
                  {activeMenuCategory &&
                    categories
                      .filter((c) => c.parentId === activeMenuCategory)
                      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name, 'tr'))
                      .map((c) => {
                        const hasSub = categories.some((x) => x.parentId === c.id)
                        const isHovered = activeSubCategory === c.id
                        return (
                          <div
                            key={c.id}
                            onMouseEnter={() => {
                              setActiveSubCategory(c.id)
                              setActiveLeafCategory(null)
                            }}
                            onClick={() => {
                              navigate(`/kategori/${encodeURIComponent(c.slug)}`)
                              setIsMegaMenuOpen(false)
                            }}
                            className={`flex items-center justify-between px-5 py-3 text-xs font-semibold transition-all cursor-pointer ${
                              isHovered
                                ? 'bg-zinc-50/70 text-primary font-bold'
                                : 'text-zinc-650 hover:bg-zinc-50/50'
                            }`}
                          >
                            <span>{c.name}</span>
                            {hasSub && (
                              <span className="material-symbols-outlined text-xs opacity-60">chevron_right</span>
                            )}
                          </div>
                        )
                      })}
                </div>

                {/* Column 3: Sub-subcategories (Level 3) */}
                <div className="flex-1 bg-white py-4 px-6 overflow-y-auto">
                  {activeSubCategory && (
                    <div className="space-y-4">
                      {megaMenuLeafCategories.length > 0 && (
                        <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                          {megaMenuLeafCategories.map((c) => (
                            <Link
                              key={c.id}
                              to={`/kategori/${encodeURIComponent(c.slug)}`}
                              onMouseEnter={() => setActiveLeafCategory(c.id)}
                              onClick={() => setIsMegaMenuOpen(false)}
                              className={`text-xs font-medium transition-colors py-1 block ${
                                (activeLeafCategory ?? megaMenuLeafCategories[0]?.id) === c.id
                                  ? 'text-primary font-black'
                                  : 'text-zinc-600 hover:text-primary'
                              }`}
                            >
                              {c.name}
                            </Link>
                          ))}
                        </div>
                      )}

                      {megaMenuPreviewCategory && (
                        <div className="pt-4 border-t border-zinc-100">
                          <div className="flex items-center justify-between mb-3">
                            <div>
                              <p className="text-[10px] font-black uppercase tracking-wider text-zinc-400">Ürünler</p>
                              <h3 className="text-sm font-black text-zinc-900 mt-0.5">{megaMenuPreviewCategory.name}</h3>
                            </div>
                            <Link
                              to={`/kategori/${encodeURIComponent(megaMenuPreviewCategory.slug)}`}
                              onClick={() => setIsMegaMenuOpen(false)}
                              className="text-[10px] font-black text-primary hover:text-red-700 flex items-center gap-1 uppercase tracking-wider"
                            >
                              Tümünü Gör <span className="material-symbols-outlined text-xs">arrow_forward</span>
                            </Link>
                          </div>

                          {megaMenuProductsLoading === megaMenuPreviewCategory.id ? (
                            <div className="grid grid-cols-4 gap-3">
                              {[0, 1, 2, 3].map((i) => (
                                <div key={i} className="h-28 rounded-xl bg-zinc-100 animate-pulse" />
                              ))}
                            </div>
                          ) : megaMenuPreviewProducts.length > 0 ? (
                            <div className="grid grid-cols-4 gap-3">
                              {megaMenuPreviewProducts.map((product) => (
                                <Link
                                  key={`${product.tenantCode ?? ''}:${product.id}`}
                                  to={`/urun/${generateSlug(product.name || '')}/${product.id}${product.tenantCode ? `?tenantCode=${encodeURIComponent(product.tenantCode)}` : ''}`}
                                  onClick={() => setIsMegaMenuOpen(false)}
                                  className="group rounded-xl border border-zinc-100 bg-white p-2 shadow-sm hover:border-primary/30 hover:shadow-md transition-all"
                                  title={product.name ?? 'Ürün'}
                                >
                                  <div className="aspect-square rounded-lg bg-zinc-50 border border-zinc-100 flex items-center justify-center overflow-hidden">
                                    {product.imageUrl ? (
                                      <img
                                        src={product.imageUrl}
                                        alt={product.name ?? ''}
                                        className="h-full w-full object-contain p-1.5 group-hover:scale-105 transition-transform duration-300"
                                      />
                                    ) : (
                                      <span className="material-symbols-outlined text-zinc-300 text-2xl">image</span>
                                    )}
                                  </div>
                                  <p className="mt-2 line-clamp-2 text-[10px] font-bold leading-snug text-zinc-700 group-hover:text-primary">
                                    {product.name ?? product.stockCode ?? 'Ürün'}
                                  </p>
                                </Link>
                              ))}
                            </div>
                          ) : (
                            <div className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50/60 px-4 py-5 text-xs font-semibold text-zinc-400">
                              Bu kategoriye bağlı ürün bulunamadı.
                            </div>
                          )}
                        </div>
                      )}

                      <div className="pt-4 border-t border-zinc-100">
                        {(() => {
                          const subCat = categories.find((x) => x.id === activeSubCategory)
                          return subCat ? (
                            <Link
                              to={`/kategori/${encodeURIComponent(subCat.slug)}`}
                              onClick={() => setIsMegaMenuOpen(false)}
                              className="text-xs font-black text-primary hover:text-red-700 flex items-center gap-1"
                            >
                              Tüm Ürünler <span className="material-symbols-outlined text-xs">arrow_forward</span>
                            </Link>
                          ) : null
                        })()}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Mobile Menu Drawer */}
        {mobileMenuOpen && (
          <div className="lg:hidden border-t border-zinc-100 bg-white animate-in">
            <div className="max-w-7xl mx-auto px-6 py-4 space-y-1">
              {/* Mobile search */}
              <form onSubmit={handleSearch} className="md:hidden flex items-center bg-zinc-50 rounded-xl px-4 py-3 border border-zinc-200/60 mb-3">
                <span className="material-symbols-outlined text-zinc-400 text-lg">search</span>
                <input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="bg-transparent border-none focus:ring-0 text-sm flex-1 text-zinc-700 outline-none ml-2 placeholder:text-zinc-400"
                  placeholder="Ürün Ara..."
                  type="text"
                />
              </form>
              <NavLink
                to="/kategoriler"
                onClick={() => setMobileMenuOpen(false)}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold transition-all ${
                    isActive ? 'bg-primary/5 text-primary' : 'text-zinc-600 hover:bg-zinc-50'
                  }`
                }
              >
                Kategoriler
              </NavLink>
              {headerCategories.map((c) => (
                <NavLink
                  key={c.id}
                  to={`/kategori/${encodeURIComponent(c.slug)}`}
                  onClick={() => setMobileMenuOpen(false)}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold transition-all ${
                      isActive ? 'bg-primary/5 text-primary' : 'text-zinc-600 hover:bg-zinc-50'
                    }`
                  }
                >
                  {c.name}
                </NavLink>
              ))}
              <NavLink
                to="/kampanyalar"
                onClick={() => setMobileMenuOpen(false)}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold transition-all ${
                    isActive ? 'bg-primary/5 text-primary' : 'text-zinc-600 hover:bg-zinc-50'
                  }`
                }
              >
                Kampanyalar
              </NavLink>
              <div className="pt-3 border-t border-zinc-100 mt-3 space-y-1">
                <Link to="/teknik-servis" onClick={() => setMobileMenuOpen(false)} className="flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium text-zinc-500 hover:bg-zinc-50">
                  <span className="material-symbols-outlined text-lg">build</span> Teknik Servis
                </Link>
                <Link to="/garanti" onClick={() => setMobileMenuOpen(false)} className="flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium text-zinc-500 hover:bg-zinc-50">
                  <span className="material-symbols-outlined text-lg">verified_user</span> Garanti Sorgulama
                </Link>
                <Link to="/iletisim" onClick={() => setMobileMenuOpen(false)} className="flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium text-zinc-500 hover:bg-zinc-50">
                  <span className="material-symbols-outlined text-lg">call</span> İletişim
                </Link>
              </div>
            </div>
          </div>
        )}
      </header>

      <main className={isCheckoutPage ? "pb-0 lg:pb-0" : "pb-16 lg:pb-0"}>{children}</main>

      <MemberAuthModal open={memberOpen} onClose={() => setMemberOpen(false)} />

      {resetModalState?.isOpen && (
        <div className="fixed inset-0 z-[60]">
          {/* Backdrop */}
          <div 
            className="absolute inset-0 bg-zinc-950/40 backdrop-blur-md transition-opacity duration-300" 
            onClick={() => setResetModalState(null)} 
          />
          
          {/* Background Floating Ambient Glow Circles */}
          <div className="ambient-glow-circle-1" />
          <div className="ambient-glow-circle-2" />

          {/* Modal Container */}
          <div className="absolute inset-0 flex items-center justify-center p-4 z-10">
            <div className="w-full max-w-md overflow-hidden rounded-[32px] bg-white shadow-[0_32px_64px_-16px_rgba(0,0,0,0.18),0_16px_32px_-8px_rgba(0,0,0,0.08)] border border-zinc-150/40 animate-modal-spring relative p-6 md:p-8">
              
              {/* Ambient Glow Bar at the top */}
              <div className="animated-glow-bar" />
              
              {/* Decorative Glowing Accent Splash */}
              <div className="absolute top-0 left-1/2 -translate-x-1/2 w-56 h-28 bg-gradient-to-b from-primary/10 to-transparent blur-3xl pointer-events-none z-0" />
              
              {/* Close button */}
              <button
                type="button"
                onClick={() => setResetModalState(null)}
                className="absolute top-6 right-6 z-20 grid h-9 w-9 place-items-center rounded-full bg-zinc-100/50 hover:bg-zinc-100 text-zinc-400 hover:text-zinc-655 hover:scale-105 active:scale-95 transition-all duration-200"
                aria-label="Kapat"
              >
                <span className="material-symbols-outlined text-lg">close</span>
              </button>

              {/* STEP 1: CONFIRM */}
              {resetModalState.step === 'confirm' && (
                <div className="relative z-10 text-center space-y-6 pt-4">
                  <div className="mx-auto w-14 h-14 bg-gradient-to-tr from-primary/15 to-rose-600/5 rounded-2xl flex items-center justify-center text-primary mb-2 shadow-[0_8px_20px_-6px_rgba(223,0,0,0.15)] border border-primary/10 animate-bounce">
                    <span className="material-symbols-outlined text-2xl font-light">lock_reset</span>
                  </div>
                  <div className="space-y-2">
                    <h2 className="text-xl font-black text-zinc-900 tracking-tight">Şifrenizi Yenilemek İstiyor musunuz?</h2>
                    <p className="text-xs text-zinc-500 leading-relaxed font-semibold px-4">
                      Şifre sıfırlama bağlantısıyla giriş yaptınız. Şifrenizi hemen şimdi yenilemek ister misiniz?
                    </p>
                  </div>

                  <div className="space-y-2 pt-2">
                    <button
                      type="button"
                      onClick={() => setResetModalState(prev => prev ? { ...prev, step: 'form' } : null)}
                      className="w-full bg-gradient-to-r from-primary via-rose-600 to-primary bg-[length:200%_auto] hover:bg-right hover:scale-[1.01] active:scale-[0.99] text-white py-3.5 rounded-2xl font-extrabold text-sm shadow-[0_8px_24px_rgba(223,0,0,0.2)] hover:shadow-[0_12px_28px_rgba(223,0,0,0.35)] transition-all duration-300"
                    >
                      Evet, Şifremi Yenile
                    </button>
                    <button
                      type="button"
                      onClick={() => setResetModalState(null)}
                      className="w-full py-3 border border-zinc-200 rounded-2xl text-xs font-bold text-zinc-500 hover:bg-zinc-50 hover:text-zinc-700 transition-all active:scale-[0.98]"
                    >
                      Hayır, Şifremi Değiştirme
                    </button>
                  </div>
                </div>
              )}

              {/* STEP 2: FORM */}
              {resetModalState.step === 'form' && (
                <ResetPasswordForm 
                  email={resetModalState.email} 
                  token={resetModalState.token} 
                  onSuccess={() => setResetModalState(prev => prev ? { ...prev, step: 'success' } : null)}
                  onCancel={() => setResetModalState(null)}
                  showToast={showToast}
                />
              )}

              {/* STEP 3: SUCCESS */}
              {resetModalState.step === 'success' && (
                <div className="relative z-10 text-center space-y-6 pt-4">
                  <div className="mx-auto w-14 h-14 bg-gradient-to-tr from-green-500/15 to-emerald-600/5 rounded-2xl flex items-center justify-center text-green-650 mb-2 shadow-[0_8px_20px_-6px_rgba(22,163,74,0.15)] border border-green-500/10">
                    <span className="material-symbols-outlined text-2xl font-bold">check_circle</span>
                  </div>
                  <div className="space-y-2">
                    <h2 className="text-xl font-black text-zinc-900 tracking-tight">Şifreniz Güncellendi</h2>
                    <p className="text-xs text-zinc-500 leading-relaxed font-semibold px-4">
                      Şifreniz başarıyla güncellendi. Yeni şifrenizi kullanarak giriş yapabilirsiniz.
                    </p>
                  </div>

                  <div className="pt-2">
                    <button
                      type="button"
                      onClick={() => {
                        setResetModalState(null);
                        setMemberOpen(true);
                      }}
                      className="w-full bg-gradient-to-r from-zinc-900 to-zinc-950 hover:bg-zinc-900 hover:scale-[1.01] active:scale-[0.99] text-white py-3.5 rounded-2xl font-extrabold text-sm shadow-[0_8px_24px_rgba(0,0,0,0.1)] transition-all duration-300"
                    >
                      Giriş Yap
                    </button>
                  </div>
                </div>
              )}

            </div>
          </div>
        </div>
      )}

      <CartSidebar open={cartOpen} onClose={() => setCartOpen(false)} />

      {cartNoticeVisible && (
        <div className="fixed right-4 top-4 z-[120] sm:right-6 animate-in">
          <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-600 px-4 py-3 text-white shadow-xl shadow-emerald-900/15">
            <span className="material-symbols-outlined text-[20px]">check_circle</span>
            <span className="text-xs font-black uppercase tracking-wide">Sepete eklendi</span>
          </div>
        </div>
      )}

      <div className="fixed bottom-20 right-4 z-40 flex flex-col items-end gap-3 lg:bottom-6 lg:right-6">
        {liveSupportOpen && (
          <div className="w-[300px] overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl animate-in">
            <div className="flex items-center justify-between bg-zinc-950 px-4 py-3 text-white">
              <div className="flex items-center gap-2">
                <span className="grid h-8 w-8 place-items-center rounded-full bg-emerald-500 text-white">
                  <span className="material-symbols-outlined text-[18px]">support_agent</span>
                </span>
                <div>
                  <p className="text-xs font-black uppercase tracking-wide">Canlı Destek</p>
                  <p className="text-[10px] font-semibold text-zinc-300">Müşteri temsilcisi</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setLiveSupportOpen(false)}
                className="grid h-8 w-8 place-items-center rounded-full text-zinc-300 hover:bg-white/10 hover:text-white"
                aria-label="Canlı destek panelini kapat"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>
            <div className="space-y-3 p-4">
              <div className="rounded-xl bg-zinc-100 px-3 py-2">
                <p className="text-xs font-semibold leading-relaxed text-zinc-700">
                  Merhaba, size nasıl yardımcı olabiliriz?
                </p>
              </div>
              <div className="rounded-xl border border-dashed border-zinc-200 px-3 py-3 text-center">
                <p className="text-[11px] font-bold text-zinc-500">
                  Bu modül şu anda statik olarak gösteriliyor.
                </p>
              </div>
            </div>
          </div>
        )}
        <button
          type="button"
          onClick={() => setLiveSupportOpen((prev) => !prev)}
          className="flex items-center gap-2 rounded-full bg-zinc-950 px-4 py-3 text-white shadow-xl shadow-zinc-950/20 transition-all hover:bg-primary active:scale-95"
          aria-label="Canlı müşteri temsilcisi"
        >
          <span className="relative grid h-9 w-9 place-items-center rounded-full bg-emerald-500">
            <span className="material-symbols-outlined text-[21px]">support_agent</span>
            <span className="absolute right-0 top-0 h-2.5 w-2.5 rounded-full border-2 border-zinc-950 bg-emerald-300" />
          </span>
          <span className="hidden text-left sm:block">
            <span className="block text-xs font-black uppercase tracking-wide">Canlı Destek</span>
            <span className="block text-[10px] font-semibold text-zinc-300">Temsilciye bağlan</span>
          </span>
        </button>
      </div>

      {showRegPromptModal && (
        <div className="fixed inset-0 z-[60]">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowRegPromptModal(false)} />
          <div className="absolute inset-0 flex items-center justify-center p-4">
            <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl border border-zinc-100 animate-in">
              <div className="flex items-center justify-between border-b border-zinc-100 px-6 py-5">
                <h2 className="text-lg font-bold text-on-surface">Ürün Kaydı</h2>
                <button
                  type="button"
                  onClick={() => setShowRegPromptModal(false)}
                  className="grid h-9 w-9 place-items-center rounded-full hover:bg-zinc-100 transition-colors"
                >
                  <span className="material-symbols-outlined text-zinc-500">close</span>
                </button>
              </div>
              <div className="p-6 text-center space-y-4">
                <div className="mx-auto w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center text-primary">
                  <span className="material-symbols-outlined text-3xl font-bold">app_registration</span>
                </div>
                <h3 className="text-base font-extrabold text-zinc-800">Ürününüzü Kaydedin</h3>
                <p className="text-xs text-zinc-500 leading-relaxed">
                  Satın aldığınız ürünleri kaydederek garanti sürelerini takip edebilir, teknik servis taleplerinizi hızlıca iletebilirsiniz. Devam etmek için üye olmanız veya giriş yapmanız gerekmektedir.
                </p>
                <div className="pt-2 flex flex-col gap-2">
                  <button
                    onClick={() => {
                      setShowRegPromptModal(false)
                      setMemberOpen(true)
                    }}
                    className="w-full bg-primary text-on-primary py-3 rounded-lg font-bold text-sm shadow-md hover:bg-primary-container transition-all"
                  >
                    Üye Ol / Giriş Yap
                  </button>
                  <button
                    onClick={() => setShowRegPromptModal(false)}
                    className="w-full bg-zinc-100 text-zinc-700 py-3 rounded-lg font-bold text-sm hover:bg-zinc-200 transition-all"
                  >
                    Vazgeç
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Mobile Sticky Bottom Bar */}
      {!isCheckoutPage && (
        <div className="fixed bottom-0 inset-x-0 h-16 bg-white/95 backdrop-blur-md border-t border-zinc-100 flex items-center justify-around z-50 lg:hidden shadow-[0_-4px_16px_rgba(0,0,0,0.06)] px-4">
          <Link to="/" className="flex flex-col items-center gap-1 text-zinc-500 hover:text-primary transition-colors">
            <span className="material-symbols-outlined text-[22px]">home</span>
            <span className="text-[9px] font-bold uppercase tracking-wider">Ana Sayfa</span>
          </Link>
          <button onClick={() => setMobileCategoryOpen(true)} className="flex flex-col items-center gap-1 text-zinc-500 hover:text-primary transition-colors">
            <span className="material-symbols-outlined text-[22px]">widgets</span>
            <span className="text-[9px] font-bold uppercase tracking-wider">Kategoriler</span>
          </button>
          <button onClick={() => setMobileSearchOpen(true)} className="flex flex-col items-center gap-1 text-zinc-500 hover:text-primary transition-colors">
            <span className="material-symbols-outlined text-[22px]">search</span>
            <span className="text-[9px] font-bold uppercase tracking-wider">Arama</span>
          </button>
          <Link to="/favoriler" className="flex flex-col items-center gap-1 text-zinc-500 hover:text-primary transition-colors">
            <span className="material-symbols-outlined text-[22px]">favorite</span>
            <span className="text-[9px] font-bold uppercase tracking-wider">Favoriler</span>
          </Link>
          <button onClick={() => setCartOpen(true)} className="flex flex-col items-center gap-1 text-zinc-500 hover:text-primary transition-colors relative">
            <span className="material-symbols-outlined text-[22px]">shopping_cart</span>
            <span className="absolute -top-1.5 -right-2 bg-primary text-white text-[9px] w-[16px] h-[16px] rounded-full flex items-center justify-center font-bold leading-none">{cartCount(cartItems)}</span>
            <span className="text-[9px] font-bold uppercase tracking-wider">Sepetim</span>
          </button>
        </div>
      )}

      {/* Mobile Category Drawer */}
      {mobileCategoryOpen && (
        <div className="fixed inset-0 z-[100] lg:hidden">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-xs transition-opacity"
            onClick={() => setMobileCategoryOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 w-4/5 max-w-sm bg-white shadow-2xl flex flex-col animate-slide-in-left">
            <div className="flex items-center justify-between p-4 border-b border-zinc-100 bg-zinc-50">
              <span className="text-sm font-bold uppercase tracking-wider text-zinc-800 flex items-center gap-1.5">
                <span className="material-symbols-outlined text-primary text-lg">widgets</span>
                Kategoriler
              </span>
              <button
                onClick={() => setMobileCategoryOpen(false)}
                className="w-8 h-8 rounded-full hover:bg-zinc-200 grid place-items-center"
              >
                <span className="material-symbols-outlined text-lg">close</span>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              <Link
                to="/kategoriler"
                onClick={() => setMobileCategoryOpen(false)}
                className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-bold text-zinc-700 hover:bg-zinc-50"
              >
                <span className="material-symbols-outlined text-zinc-400">grid_view</span>
                Tüm Kategoriler
              </Link>
              {categories.filter(c => !c.parentId).map((c) => (
                <div key={c.id} className="space-y-1">
                  <Link
                    to={`/kategori/${encodeURIComponent(c.slug)}`}
                    onClick={() => setMobileCategoryOpen(false)}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold text-zinc-800 hover:bg-zinc-50 border-l-2 border-transparent hover:border-primary"
                  >
                    <span className="material-symbols-outlined text-zinc-400 text-sm">folder</span>
                    {c.name}
                  </Link>
                  {categories.filter(sub => sub.parentId === c.id).map(sub => (
                    <Link
                      key={sub.id}
                      to={`/kategori/${encodeURIComponent(sub.slug)}`}
                      onClick={() => setMobileCategoryOpen(false)}
                      className="flex items-center gap-3 pl-8 pr-3 py-2 rounded-xl text-xs font-semibold text-zinc-500 hover:bg-zinc-50"
                    >
                      <span className="material-symbols-outlined text-zinc-300 text-[10px]">subdirectory_arrow_right</span>
                      {sub.name}
                    </Link>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Mobile Search Overlay */}
      {mobileSearchOpen && (
        <div className="fixed inset-0 bg-white z-[110] flex flex-col p-4 animate-in lg:hidden">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setMobileSearchOpen(false)}
              className="w-10 h-10 rounded-full hover:bg-zinc-100 grid place-items-center"
            >
              <span className="material-symbols-outlined">arrow_back</span>
            </button>
            <form onSubmit={(e) => {
              handleSearch(e);
              setMobileSearchOpen(false);
            }} className="flex-1 flex items-center bg-zinc-50 rounded-xl px-4 py-2 border border-zinc-200">
              <input
                autoFocus
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onFocus={fetchProductsForSearch}
                className="bg-transparent border-none focus:ring-0 text-sm w-full text-zinc-700 outline-none placeholder:text-zinc-400"
                placeholder="Ürün Ara..."
                type="text"
              />
              {searchQuery && (
                <button type="button" onClick={() => setSearchQuery('')} className="text-zinc-400 hover:text-zinc-600">
                  <span className="material-symbols-outlined text-sm">close</span>
                </button>
              )}
            </form>
          </div>

          <div className="flex-1 overflow-y-auto mt-4 space-y-6">
            {searchQuery.trim() === '' ? (
              <>
                {recentSearches.length > 0 && (
                  <div>
                    <div className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-2 flex items-center gap-1">
                      <span className="material-symbols-outlined text-xs">history</span> Son Aramalar
                    </div>
                    <div className="space-y-1">
                      {recentSearches.map((s) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => {
                            setSearchQuery(s);
                            navigate(`/arama?q=${encodeURIComponent(s)}`);
                            setMobileSearchOpen(false);
                          }}
                          className="w-full text-left px-2 py-2 hover:bg-zinc-50 text-xs font-semibold text-zinc-700 rounded-lg flex items-center justify-between"
                        >
                          {s}
                          <span className="material-symbols-outlined text-[10px] text-zinc-400">north_west</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <div>
                  <div className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-2 flex items-center gap-1">
                    <span className="material-symbols-outlined text-xs">trending_up</span> Popüler Aramalar
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {['Blender', 'Mikser', 'Ütü', 'Çay Makinesi', 'Tost Makinesi'].map((term) => (
                      <button
                        key={term}
                        type="button"
                        onClick={() => {
                          setSearchQuery(term);
                          navigate(`/arama?q=${encodeURIComponent(term)}`);
                          setMobileSearchOpen(false);
                        }}
                        className="px-3 py-2 bg-zinc-50 hover:bg-zinc-100 text-xs font-bold text-zinc-600 rounded-lg transition"
                      >
                        {term}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            ) : (
              <>
                {matchingCategories.length > 0 && (
                  <div>
                    <div className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-2">Kategoriler</div>
                    <div className="space-y-1">
                      {matchingCategories.map((c) => (
                        <Link
                          key={c.id}
                          to={`/kategori/${encodeURIComponent(c.slug)}`}
                          onClick={() => setMobileSearchOpen(false)}
                          className="flex items-center gap-2 px-2 py-2 hover:bg-zinc-50 text-xs font-semibold text-zinc-700 rounded-lg"
                        >
                          <span className="material-symbols-outlined text-zinc-400 text-sm">folder</span>
                          {c.name}
                        </Link>
                      ))}
                    </div>
                  </div>
                )}

                {matchingPages.length > 0 && (
                  <div>
                    <div className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-2">Sayfalar</div>
                    <div className="space-y-1">
                      {matchingPages.map((p) => (
                        <Link
                          key={p.to}
                          to={p.to}
                          onClick={() => setMobileSearchOpen(false)}
                          className="flex flex-col gap-0.5 px-2 py-2 hover:bg-zinc-50 rounded-lg transition"
                        >
                          <span className="text-xs font-semibold text-zinc-700">{p.label}</span>
                          <span className="text-[9px] text-zinc-400 font-medium">{p.desc}</span>
                        </Link>
                      ))}
                    </div>
                  </div>
                )}

                <div>
                  <div className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-2">Ürünler</div>
                  {matchingProducts.length > 0 ? (
                    <div className="space-y-2">
                      {matchingProducts.map((p) => (
                        <Link
                          key={p.id}
                          to={`/urun/${generateSlug(p.name || '')}/${p.id}`}
                          onClick={() => setMobileSearchOpen(false)}
                          className="flex items-center gap-3 px-2 py-1.5 hover:bg-zinc-50 rounded-lg transition"
                        >
                          <div className="w-10 h-10 rounded-md bg-zinc-50 overflow-hidden border border-zinc-100 flex-shrink-0 flex items-center justify-center">
                            {p.imageUrl ? (
                                <img src={p.imageUrl} className="w-full h-full object-contain p-0.5" alt="" />
                            ) : (
                              <span className="material-symbols-outlined text-zinc-300 text-sm">image</span>
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-semibold text-zinc-800 truncate">{p.name}</p>
                            <p className="text-xs text-primary font-bold">{p.unitPrice ? `₺${p.unitPrice.toLocaleString('tr-TR')}` : ''}</p>
                          </div>
                        </Link>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-zinc-400 px-2 py-1">Eşleşen ürün bulunamadı.</p>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="w-full border-t border-zinc-200 bg-zinc-950 text-zinc-400 font-inter text-sm" title={design.footerText}>
        {/* Footer Main */}
        <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-12 gap-10 px-6 py-16">
          {/* Brand */}
          <div className="md:col-span-4 space-y-6">
            <Link to="/" className="flex items-center gap-2 select-none active:scale-95 transition-transform w-fit">
              {design.logoUrl ? (
                <img src={design.logoUrl} alt={design.brandName} className="h-10 sm:h-12 max-w-[150px] sm:max-w-[200px] object-contain" />
              ) : (
                <div className="bg-primary text-white px-4 py-1.5 font-black text-2xl italic tracking-tighter uppercase border-r-4 border-white flex items-center shadow-lg">
                  {design.brandName}
                </div>
              )}
            </Link>
            <p className="leading-relaxed text-zinc-500">Evinizin teknolojisi, yaşamınızın konforu için çalışıyoruz.</p>
            <div className="flex gap-3">
              {design.facebookUrl && (
                <a className="w-9 h-9 rounded-lg bg-zinc-800 flex items-center justify-center hover:bg-primary transition-colors cursor-pointer group" href={design.facebookUrl} target="_blank" rel="noopener noreferrer" aria-label="Facebook">
                  <svg className="w-4 h-4 fill-zinc-400 group-hover:fill-white transition-colors" viewBox="0 0 24 24">
                    <path d="M9 8h-3v4h3v12h5v-12h3.642l.358-4h-4v-1.667c0-.955.192-1.333 1.115-1.333h2.885v-5h-3.808c-3.596 0-5.192 1.583-5.192 4.615v3.385z"/>
                  </svg>
                </a>
              )}
              {design.instagramUrl && (
                <a className="w-9 h-9 rounded-lg bg-zinc-800 flex items-center justify-center hover:bg-primary transition-colors cursor-pointer group" href={design.instagramUrl} target="_blank" rel="noopener noreferrer" aria-label="Instagram">
                  <svg className="w-4 h-4 fill-zinc-400 group-hover:fill-white transition-colors" viewBox="0 0 24 24">
                    <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0 3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/>
                  </svg>
                </a>
              )}
              {design.youtubeUrl && (
                <a className="w-9 h-9 rounded-lg bg-zinc-800 flex items-center justify-center hover:bg-primary transition-colors cursor-pointer group" href={design.youtubeUrl} target="_blank" rel="noopener noreferrer" aria-label="YouTube">
                  <svg className="w-4 h-4 fill-zinc-400 group-hover:fill-white transition-colors" viewBox="0 0 24 24">
                    <path d="M23.498 6.163c-.272-.98-1.077-1.754-2.097-2.022-1.852-.493-9.401-.493-9.401-.493s-7.549 0-9.401.493c-1.02.268-1.825 1.042-2.097 2.022-.493 1.852-.493 5.717-.493 5.717s0 3.865.493 5.718c.272.979 1.077 1.754 2.097 2.021 1.852.493 9.401.493 9.401.493s7.549 0 9.401-.493c1.02-.267 1.825-1.042 2.097-2.021.493-1.853.493-5.718.493-5.718s0-3.865-.493-5.717zm-14.498 8.837v-6l6 3-6 3z"/>
                  </svg>
                </a>
              )}
              {design.twitterUrl && (
                <a className="w-9 h-9 rounded-lg bg-zinc-800 flex items-center justify-center hover:bg-primary transition-colors cursor-pointer group" href={design.twitterUrl} target="_blank" rel="noopener noreferrer" aria-label="Twitter">
                  <svg className="w-3.5 h-3.5 fill-zinc-400 group-hover:fill-white transition-colors" viewBox="0 0 24 24">
                    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                  </svg>
                </a>
              )}
            </div>
          </div>

          {/* Links */}
          <div className="md:col-span-2">
            <h6 className="font-bold text-white mb-5 text-xs uppercase tracking-[0.15em]">Kurumsal</h6>
            <ul className="space-y-3">
              <li><Link to="/hakkimizda" className="hover:text-white transition-colors">Hakkımızda</Link></li>
              <li><Link to="/teknik-servis" className="hover:text-white transition-colors">Teknik Servis</Link></li>
              <li><Link to="/garanti" className="hover:text-white transition-colors">Garanti Sorgulama</Link></li>
              <li><Link to="/blog" className="hover:text-white transition-colors">Blog</Link></li>
              <li><Link to="/kvkk" className="hover:text-white transition-colors">KVKK Aydınlatma Metni</Link></li>
              <li><Link to="/iletisim" className="hover:text-white transition-colors">İletişim</Link></li>
            </ul>
          </div>
          <div className="md:col-span-2">
            <h6 className="font-bold text-white mb-5 text-xs uppercase tracking-[0.15em]">Kategoriler</h6>
            <ul className="space-y-3">
              {footerCategories.map((c) => (
                <li key={c.id}>
                  <Link to={`/kategori/${encodeURIComponent(c.slug)}`} className="hover:text-white transition-colors">
                    {c.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Newsletter */}
          <div className="md:col-span-4">
            <h6 className="font-bold text-white mb-5 text-xs uppercase tracking-[0.15em]">Bülten</h6>
            <p className="mb-5 text-zinc-500">Kampanyalardan ve yeni ürünlerden ilk siz haberdar olun.</p>
            <form className="flex gap-2" onSubmit={handleSubscribe}>
              <input
                className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-2.5 text-sm text-white placeholder:text-zinc-500 focus:ring-2 focus:ring-primary focus:border-primary outline-none transition-all disabled:opacity-50"
                placeholder="E-posta adresiniz"
                type="email"
                required
                value={newsletterEmail}
                onChange={(e) => setNewsletterEmail(e.target.value)}
                disabled={subscribing || newsletterStatus === 'success'}
              />
              <button
                className="bg-primary text-white px-5 py-2.5 rounded-lg font-bold text-sm hover:bg-primary-container transition-all active:scale-95 whitespace-nowrap disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-1.5"
                type="submit"
                disabled={subscribing || newsletterStatus === 'success'}
              >
                {subscribing ? (
                  <>
                    <span className="material-symbols-outlined text-sm animate-spin">progress_activity</span>
                    Gönderiliyor
                  </>
                ) : newsletterStatus === 'success' ? (
                  <>
                    <span className="material-symbols-outlined text-sm">check_circle</span>
                    Abone Oldunuz
                  </>
                ) : 'Abone Ol'}
              </button>
            </form>
            {newsletterStatus === 'success' && (
              <p className="mt-3 text-[11px] text-emerald-400 flex items-center gap-1">
                <span className="material-symbols-outlined text-xs">check_circle</span>
                Bültenimize başarıyla abone oldunuz!
              </p>
            )}
            {newsletterStatus === 'error' && (
              <p className="mt-3 text-[11px] text-rose-400 flex items-center gap-1">
                <span className="material-symbols-outlined text-xs">error</span>
                Bir hata oluştu, lütfen tekrar deneyin.
              </p>
            )}
            {newsletterStatus === 'idle' && (
              <p className="mt-3 text-[11px] text-zinc-600">Kayıt olarak KVKK aydınlatma metnini kabul etmiş olursunuz.</p>
            )}
          </div>
        </div>

        {/* Footer Bottom */}
        <div className="border-t border-zinc-800">
          <div className="max-w-7xl mx-auto px-6 py-5 flex flex-col md:flex-row items-center justify-between gap-4">
            <p className="text-zinc-600 text-xs">© {new Date().getFullYear()} Stilsoft Ev Gereçleri A.Ş. Tüm hakları saklıdır.</p>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-zinc-600">
              <Link to="/gizlilik-politikasi" className="hover:text-white transition-colors">Gizlilik Politikası</Link>
              <Link to="/mesafeli-satis-sozlesmesi" className="hover:text-white transition-colors">Mesafeli Satış Sözleşmesi</Link>
              <Link to="/iade-ve-degisim-kosullari" className="hover:text-white transition-colors">İade ve Değişim Koşulları</Link>
              <Link to="/destek-sss" className="hover:text-white transition-colors">Destek / SSS</Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}
