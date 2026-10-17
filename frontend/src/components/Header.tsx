import IslemBildirimleri from './IslemBildirimleri'
import { Bell, BellOff, ChevronDown, LayoutDashboard, LogOut, Search, RefreshCw, Menu, X, ArrowLeftRight, Send, UserCheck, MessageCircle } from 'lucide-react'
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { API_BASE_URL, asistanBaseUrl, employeePortalBaseUrl, serviceOpsBaseUrl } from '../config/api'
import Modal from './Modal'
import { fetchNotifications, fetchUnreadNotificationsCount, markNotificationAsRead } from '../api/notifications'
import { NotificationModal } from '../pages/NotificationsPage'

function buildServiceOpsUrl(path: string = '/') {
  const base = serviceOpsBaseUrl()
  const url = new URL(`${base}${path}`)
  const token = localStorage.getItem('accessToken')
  if (!token) return url.toString()
  url.searchParams.set('sync_token', token)
  url.searchParams.set('sync_tenant', localStorage.getItem('tenantCode') || '')
  url.searchParams.set('sync_username', localStorage.getItem('userName') || '')
  url.searchParams.set('sync_userId', localStorage.getItem('userId') || '')
  url.searchParams.set('sync_role', localStorage.getItem('roleCode') || '')
  // Servisteki "Personele Gec" dugmesinin gorunurlugu icin. Yalnizca BAYRAK tasinir, token
  // degil: servis tarafinda adrese token eklemek bilerek yasak (bkz. oradaki Header uyarisi).
  url.searchParams.set('sync_employeeAccess', hasEmployeeAccess() ? '1' : '0')
  return url.toString()
}

/**
 * Personel portalinin adresi — OTURUM DEVRIYLE.
 *
 * Onceki hali yalnizca firma kodunu tasiyordu: kullanici ERP'de giris yapmisken portalda
 * TEKRAR sifre soruluyor, kabul edilirse de ERP oturumundan bagimsiz, gunlerce yasayan
 * AYRI bir oturum aciliyordu. Artik ServiceOps ile ayni desen: token tasinir, portal onu
 * `/api/EmployeePortalAuth/exchange` ucunda kendi token'ina cevirir ve ERP oturumunun
 * BITIS ANINI devralir.
 *
 * `tenant` parametresi KALIYOR: devir herhangi bir sebeple basarisiz olursa portal giris
 * ekranina duser ve orada firmanin yine secili gelmesi gerekir.
 */
function buildEmployeePortalUrl(): string {
  const base = employeePortalBaseUrl()
  try {
    const url = new URL(`${base}/login`)
    const tenant = localStorage.getItem('tenantCode') || ''
    if (tenant) url.searchParams.set('tenant', tenant)

    const token = localStorage.getItem('accessToken')
    if (token) {
      url.searchParams.set('sync_token', token)
      url.searchParams.set('sync_tenant', tenant)
      url.searchParams.set('sync_username', localStorage.getItem('userName') || '')
    }
    return url.toString()
  } catch {
    return base
  }
}

/**
 * ERP'deki kullanici duzenleme ekranindaki "Calisan Yonetimi" kutusu isaretli mi?
 *
 * Yalnizca dugmeyi GOSTERIP gizlemek icin. Gercek kapi personel servisinde
 * (`Users.EmployeeAccess`); buradaki degeri elle degistiren biri portala giremez,
 * sadece kendisine calismayan bir dugme gosterir.
 */
function hasEmployeeAccess(): boolean {
  try {
    return localStorage.getItem('employeeAccess') === '1'
  } catch {
    return false
  }
}

/**
 * "Asistan'a Geç" (WhatsApp, 2026-10-07): ayrı program, servis/personel gibi oturum DEVRİYLE.
 * Asistan B2B token'ını `/api/auth/exchange`'te BİR KEZ doğrulayıp kendi token'ına çevirir;
 * yetkiyi (Rol Yetkileri → Asistan → WhatsApp Mesajları) kendisi de kontrol eder.
 */
function buildAsistanUrl(): string {
  const base = asistanBaseUrl()
  try {
    const url = new URL(`${base}/login`)
    const tenant = localStorage.getItem('tenantCode') || ''
    const token = localStorage.getItem('accessToken')
    if (tenant) url.searchParams.set('tenant', tenant)
    if (token) {
      url.searchParams.set('sync_token', token)
      url.searchParams.set('sync_tenant', tenant)
    }
    return url.toString()
  } catch {
    return base
  }
}

/**
 * Düğmeyi yalnız GÖSTERMEK için; gerçek kapı asistan sunucusunda.
 * Asistan canlıya çıkana kadar KAPALI (2026-10-08 kullanıcı kararı): derlemede
 * `VITE_ASISTAN_ENABLED=1` verilmezse düğme hiç görünmez. Geliştirmede (vite dev) açık.
 */
function hasAsistanAccess(): boolean {
  const env = (import.meta as any).env ?? {}
  if (!env.DEV && String(env.VITE_ASISTAN_ENABLED ?? '') !== '1') return false
  try {
    // Kullanıcı bazında bayrak (Kullanıcılar → "Asistan (WhatsApp)"); girişte yazılır.
    if (localStorage.getItem('isSuperSuperAdmin') === 'true') return true
    return localStorage.getItem('asistanAccess') === '1'
  } catch {
    return false
  }
}

export type HeaderMenuItem = {
  id: string
  label: string
  href?: string
}

type Props = {
  items: HeaderMenuItem[]
  activeId?: string
  onSelect?: (id: string) => void
  menuTabs?: Record<string, { id: string; label: string; href?: string }[]>
  activeSubId?: string
  onNavigate?: (href: string) => void
  userInitial?: string
  userName?: string
  tenantName?: string
  tenantLogoUrl?: string
  headerGradientFrom?: string
  headerGradientTo?: string
  sessionRemainingLabel?: string
  sessionExpiresAtLabel?: string
  onHome?: () => void
  onProfile?: () => void
  onLogout?: () => void
  showBackToProjeYonetimi?: boolean
  onBackToProjeYonetimi?: () => void

  showEcommercePanel?: boolean
  isSuperAdmin?: boolean
  allowedKeys?: Set<string>
}

export default function Header({
  items,
  activeId,
  onSelect,
  menuTabs = {},
  activeSubId,
  onNavigate,
  userInitial = 'A',
  userName,
  tenantName,
  tenantLogoUrl,
  headerGradientFrom,
  headerGradientTo,
  sessionRemainingLabel,
  sessionExpiresAtLabel,
  onHome,
  onProfile,
  onLogout,
  showBackToProjeYonetimi,
  onBackToProjeYonetimi,

  showEcommercePanel,
  isSuperAdmin,
  allowedKeys
}: Props) {
  const [open, setOpen] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [expandedModule, setExpandedModule] = useState<string | null>(activeId || null)

  const [ecommerceOpen, setEcommerceOpen] = useState(false)
  type EcommerceProduct = {
    id: string
    stockCode?: string | null
    name?: string | null
    unitPrice?: number | null
    currency?: string | null
    stock?: number | null
    isActive?: boolean | null
    imageUrl?: string | null
    imageUrls?: string[] | null
  }
  const [ecommerceLoading, setEcommerceLoading] = useState(false)
  const [ecommerceError, setEcommerceError] = useState<string | null>(null)
  const [ecommerceProducts, setEcommerceProducts] = useState<EcommerceProduct[]>([])
  const [ecommerceQuery, setEcommerceQuery] = useState('')
  const [ecommerceSelected, setEcommerceSelected] = useState<Set<string>>(new Set())
  const [ecommerceImporting, setEcommerceImporting] = useState(false)
  const [ecommerceImportMessage, setEcommerceImportMessage] = useState<string | null>(null)
  const dropdownRef = useRef<HTMLDivElement | null>(null)
  const dropdownPanelRef = useRef<HTMLDivElement | null>(null)
  const [logoOk, setLogoOk] = useState(true)
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number } | null>(null)

  const tenantCode = (localStorage.getItem('tenantCode') || '').trim()
  const isDemoTest = tenantCode.toUpperCase() === 'DEMO_TEST' || tenantCode.toUpperCase() === 'DEMOTEST'

  type GlobalSearchItem = {
    type: string
    title: string
    subtitle: string
    href: string
    key: string
  }

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node
      if (dropdownRef.current && dropdownRef.current.contains(target)) return
      if (dropdownPanelRef.current && dropdownPanelRef.current.contains(target)) return
      if (bellRef.current && bellRef.current.contains(target)) return
      if (bellPanelRef.current && bellPanelRef.current.contains(target)) return
      {
        setOpen(false)
        setBellOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setBellOpen(false)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  useLayoutEffect(() => {
    const update = () => {
      if (!open) return
      const el = dropdownRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const width = 240
      const pad = 8
      const left = Math.max(pad, Math.min(window.innerWidth - width - pad, rect.right - width))
      const top = Math.max(pad, rect.bottom + 8)
      setDropdownPos({ top, left })
    }

    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [open])

  const buildHeaders = (includeJson: boolean) => {
    const headers: Record<string, string> = {}
    if (includeJson) headers['Content-Type'] = 'application/json'
    const token = localStorage.getItem('accessToken')
    if (token) headers.Authorization = `Bearer ${token}`
    const tenantCode = String(localStorage.getItem('tenantCode') ?? '').trim()
    if (tenantCode) headers['X-Tenant-Code'] = tenantCode
    return headers
  }

  useEffect(() => {
    if (!ecommerceOpen) return
    let cancelled = false

    const load = async () => {
      setEcommerceLoading(true)
      setEcommerceError(null)
      setEcommerceImportMessage(null)
      try {
        const res = await fetch(`${API_BASE_URL}/api/products?page=1&pageSize=200&includeInactive=false`, {
          headers: {
            ...buildHeaders(false)
          }
        })
        const json = await res.json().catch(() => null)
        if (!res.ok) {
          const msg = String(json?.message ?? 'Ürünler alınamadı')
          throw new Error(msg)
        }

        const items = (json?.data?.items ?? []) as EcommerceProduct[]
        if (!cancelled) {
          setEcommerceProducts(Array.isArray(items) ? items : [])
        }
      } catch (e: any) {
        if (!cancelled) {
          setEcommerceProducts([])
          setEcommerceError(String(e?.message ?? 'Ürünler alınamadı'))
        }
      } finally {
        if (!cancelled) setEcommerceLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [ecommerceOpen])

  const submitEcommerceImport = async () => {
    if (ecommerceImporting) return
    const ids = Array.from(ecommerceSelected)
    if (ids.length === 0) return

    const byId = new Map(ecommerceProducts.map((p) => [String(p.id), p]))
    const items = ids
      .map((id) => byId.get(id))
      .filter(Boolean)
      .map((p) => ({
        erpProductId: String(p?.id),
        stockCode: p?.stockCode ?? null,
        name: p?.name ?? null,
        unitPrice: p?.unitPrice ?? null,
        currency: p?.currency ?? null,
        stock: p?.stock ?? null,
        isActive: p?.isActive ?? null,
        imageUrl: p?.imageUrl ?? null,
        imageUrls: Array.isArray(p?.imageUrls) ? p?.imageUrls : null
      }))

    if (items.length === 0) return

    setEcommerceImporting(true)
    setEcommerceImportMessage(null)
    try {
      const res = await fetch(`${API_BASE_URL}/api/ecommerce/import-products`, {
        method: 'POST',
        headers: {
          ...buildHeaders(true)
        },
        body: JSON.stringify({ items })
      })

      const json = await res.json().catch(() => null)
      if (!res.ok || json?.success === false) {
        const msg = String(json?.message ?? 'Aktarım başarısız')
        throw new Error(msg)
      }

      const imported = Number(json?.data?.data?.imported ?? json?.data?.imported ?? items.length)
      setEcommerceImportMessage(`Aktarım tamamlandı. Aktarılan ürün: ${Number.isFinite(imported) ? imported : items.length}`)
    } catch (e: any) {
      setEcommerceImportMessage(String(e?.message ?? 'Aktarım başarısız'))
    } finally {
      setEcommerceImporting(false)
    }
  }



  const navigate = useNavigate()
  const [unreadCount, setUnreadCount] = useState<number>(0)
  const [bellOpen, setBellOpen] = useState(false)
  const [bellPos, setBellPos] = useState<{ top: number; left: number } | null>(null)
  const [recentNotifications, setRecentNotifications] = useState<any[]>([])
  const [bellLoading, setBellLoading] = useState(false)
  const bellRef = useRef<HTMLDivElement | null>(null)
  const bellPanelRef = useRef<HTMLDivElement | null>(null)

  const [notificationModalOpen, setNotificationModalOpen] = useState(false)
  const [notificationModalTab, setNotificationModalTab] = useState<'incoming' | 'send' | 'history'>('incoming')

  const openNotificationModal = (tab: 'incoming' | 'send' | 'history' = 'incoming') => {
    setNotificationModalTab(tab)
    setNotificationModalOpen(true)
  }

  const loadUnreadCount = async () => {
    const token = localStorage.getItem('accessToken')
    if (!token) return
    try {
      const count = await fetchUnreadNotificationsCount()
      setUnreadCount(count)
    } catch (err) {
      console.error('Failed to load unread notifications count:', err)
    }
  }

  const loadNotifications = async () => {
    const token = localStorage.getItem('accessToken')
    if (!token) return
    setBellLoading(true)
    try {
      const list = await fetchNotifications()
      setRecentNotifications(list.slice(0, 5))
    } catch (err) {
      console.error('Failed to load notifications:', err)
    } finally {
      setBellLoading(false)
    }
  }

  const handleNotificationClick = async (item: any) => {
    setBellOpen(false)
    if (!item.isRead) {
      try {
        await markNotificationAsRead(item.id)
        window.dispatchEvent(new CustomEvent('notification-read'))
      } catch (err) {
        console.error('Failed to mark notification as read:', err)
      }
    }
    openNotificationModal('incoming')
  }

  useEffect(() => {
    void loadUnreadCount()

    const handleReadEvent = () => {
      void loadUnreadCount()
      if (bellOpen) {
        void loadNotifications()
      }
    }

    const handleOpenModalEvent = (e: any) => {
      const tab = e?.detail?.tab || 'incoming'
      openNotificationModal(tab)
    }

    window.addEventListener('notification-read', handleReadEvent)
    window.addEventListener('recheck-notifications', handleReadEvent)
    window.addEventListener('open-notification-modal', handleOpenModalEvent)

    return () => {
      window.removeEventListener('notification-read', handleReadEvent)
      window.removeEventListener('recheck-notifications', handleReadEvent)
      window.removeEventListener('open-notification-modal', handleOpenModalEvent)
    }
  }, [bellOpen])

  useLayoutEffect(() => {
    const update = () => {
      if (!bellOpen) return
      const el = bellRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const width = 320
      const pad = 8
      const left = Math.max(pad, Math.min(window.innerWidth - width - pad, rect.right - width))
      const top = Math.max(pad, rect.bottom + 8)
      setBellPos({ top, left })
    }

    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [bellOpen])

  const displayName = (userName ?? '').trim() || 'Kullanıcı'
  const displayTenant = (tenantName ?? '').trim()

  const gradientFrom = (headerGradientFrom ?? '').trim() || '#8F2500'
  const gradientTo = (headerGradientTo ?? '').trim() || '#FF4B1F'

  const logoSrc = (tenantLogoUrl ?? '').trim() || '/s-logo-white.png'

  useEffect(() => {
    setLogoOk(true)
  }, [logoSrc])

  return (
    <header
      className="fixed top-0 left-0 right-0 z-[40] h-[64px] font-outfit shadow-[0_10px_28px_rgba(0,0,0,0.25)] border-b border-black/10 flex items-center px-2 sm:px-4 lg:px-6"
      style={{ background: `linear-gradient(90deg, ${gradientFrom}, ${gradientTo})` }}
    >
      {/* Hamburger Menu (Mobile/Tablet Only) */}
      <button
        type="button"
        onClick={() => setSidebarOpen(true)}
        className="lg:hidden flex items-center justify-center h-10 w-10 rounded-full bg-white/10 text-white hover:bg-white/20 transition-all outline-none mr-2 relative z-10"
        aria-label="Menüyü Aç"
      >
        <Menu size={20} />
      </button>

      {/* Brand Section */}
      <div className="flex items-center gap-4 relative z-10">
        <button
          type="button"
          onClick={onHome}
          className="group relative flex items-center gap-3 transition-transform active:scale-95 outline-none"
        >
          {isDemoTest ? (
            <div className="relative flex flex-col items-start pt-1">
              <style dangerouslySetInnerHTML={{__html: `
                @import url('https://fonts.googleapis.com/css2?family=Caveat:wght@700&family=Dancing+Script:wght@700&display=swap');
                .loading-handwriting { font-family: 'Caveat', 'Dancing Script', cursive; }
              `}} />
              <img
                src={logoSrc}
                alt="STILSOFT"
                className="h-8 w-auto object-contain filter brightness-0 invert"
                onError={() => setLogoOk(false)}
              />
              <span className="loading-handwriting text-black font-extrabold text-2xl -mt-3.5 ml-12 transform -rotate-6 tracking-wide select-none">
                bayi
              </span>
            </div>
          ) : (
            <div className="relative">
              {logoOk ? (
                <img
                  src={logoSrc}
                  alt="Logo"
                  className="h-[36px] w-auto drop-shadow-md"
                  onError={() => setLogoOk(false)}
                />
              ) : (
                <div className="h-[36px] w-[36px]" />
              )}
            </div>
          )}
          <div className="hidden lg:block h-6 w-px bg-white/20 ml-2" />
        </button>
      </div>

      {/* Navigation Section */}
      <nav className="hidden lg:flex flex-1 items-center h-full px-2 sm:px-3 lg:px-6 overflow-hidden min-w-0">
        <div className="flex items-center gap-1 overflow-x-auto no-scrollbar pb-0.5">
          {items.map((item) => {
            const isActive = item.id === activeId
            return (
              <a
                key={item.id}
                href={String(item.href ?? '').trim() || '#'}
                onClick={(e) => {
                  const isExternal = String(item.href ?? '').startsWith('http://') || String(item.href ?? '').startsWith('https://')
                  if (isExternal) {
                    return
                  }
                  if (onSelect) {
                    e.preventDefault()
                    onSelect(item.id)
                  }
                }}
                className={`group relative px-2.5 sm:px-3 lg:px-4 py-2 rounded-lg text-[12px] sm:text-sm font-black transition-all duration-200 outline-none flex items-center gap-2 whitespace-nowrap ${isActive ? 'text-white' : 'text-white/85 hover:text-white'
                  }`}
              >
                {isActive && (
                  <motion.div
                    layoutId="nav-pill"
                    className="absolute inset-0 bg-white/15 rounded-lg shadow-[inset_0_1px_1px_rgba(255,255,255,0.2)]"
                    transition={{ type: 'spring', bounce: 0.2, duration: 0.6 }}
                  />
                )}
                <span className="relative z-10 max-w-[120px] sm:max-w-[180px] lg:max-w-none truncate">{item.label}</span>
                <ChevronDown
                  size={14}
                  className={`relative z-10 transition-transform duration-200 ${isActive ? 'rotate-180 opacity-100' : 'opacity-70 group-hover:opacity-100'}`}
                />
                {!isActive && (
                  <div className="absolute bottom-0 left-4 right-4 h-0.5 bg-white scale-x-0 group-hover:scale-x-100 transition-transform duration-200" />
                )}
              </a>
            )
          })}
        </div>
      </nav>

      {/* Action Section */}
      <div className="flex items-center gap-2 sm:gap-3 ml-auto">
        {/* Mode Indicator & Switcher Badge (Matching Login Page Style) */}
        <button
          type="button"
          onClick={() => {
            window.location.assign(buildServiceOpsUrl())
          }}
          title="Servis Moduna Geçiş Yap"
          className="bg-black/15 border border-white/20 hover:border-white/40 px-3.5 py-1.5 rounded-2xl shadow-[inset_0_1px_1px_rgba(255,255,255,0.15)] hover:bg-black/20 active:scale-95 group cursor-pointer shrink-0 select-none transition-all hidden sm:flex items-center gap-3 text-white"
        >
          <div className="flex flex-col items-start leading-none gap-0.5">
            <span className="font-bold text-[8px] text-white/50 tracking-wider uppercase">Aktif Panel</span>
            <span className="font-black text-[11px] sm:text-xs text-white uppercase tracking-wider">BAYİ</span>
          </div>
          <div className="h-6 w-px bg-white/10" />
          <div className="flex items-center gap-1.5 bg-red-600/90 group-hover:bg-red-500 px-2.5 py-1 rounded-xl border border-red-500/20 shadow-sm transition-all duration-300">
            <span className="font-extrabold text-[10px] sm:text-[11px] text-white uppercase tracking-wider">SERVİS'E GEÇ</span>
            <ArrowLeftRight size={12} className="text-white/80 group-hover:translate-x-0.5 transition-transform" />
          </div>
        </button>

        {/*
          "Personele Geç" ÜST ÇUBUKTA DEĞİL, avatar açılır menüsünde (kullanıcı kararı).
          Üst çubukta yalnızca "Servis'e Geç" durur; iki büyük geçiş düğmesi yan yana
          kalabalık yapıyordu.
        */}

        {/* Notification Bell Dropdown */}
        <div className="relative" ref={bellRef}>
          <button
            type="button"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => {
              if (bellOpen) {
                setBellOpen(false)
                return
              }
              const el = bellRef.current
              if (el) {
                const rect = el.getBoundingClientRect()
                const width = 320
                const pad = 8
                const left = Math.max(pad, Math.min(window.innerWidth - width - pad, rect.right - width))
                const top = Math.max(pad, rect.bottom + 8)
                setBellPos({ top, left })
              }
              setBellOpen(true)
              void loadNotifications()
            }}
            className="relative h-10 w-10 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white/90 hover:text-white transition-all outline-none"
            aria-label="Bildirimler"
          >
            <Bell size={18} />
            {unreadCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 bg-rose-500 rounded-full text-[10px] font-black text-white flex items-center justify-center shadow-sm border border-indigo-900 animate-pulse">
                {unreadCount}
              </span>
            )}
          </button>

          {bellOpen && bellPos &&
            createPortal(
              <motion.div
                ref={bellPanelRef}
                initial={{ opacity: 0, y: 10, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ duration: 0.2, ease: 'easeOut' }}
                style={{ top: bellPos.top, left: bellPos.left }}
                className="fixed z-[70] w-[320px] bg-white rounded-2xl shadow-[0_10px_40px_-10px_rgba(0,0,0,0.2)] border border-slate-100 overflow-hidden"
                onMouseDown={(e) => e.stopPropagation()}
              >
                <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-slate-800 shrink-0">Bildirimler ({unreadCount})</span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setBellOpen(false)
                        openNotificationModal('send')
                      }}
                      className="px-2.5 py-1 text-[10px] font-bold rounded-lg bg-orange-600 hover:bg-orange-700 text-white shadow-2xs transition-all flex items-center gap-1 cursor-pointer whitespace-nowrap"
                    >
                      <Send size={10} />
                      <span>Bildirim Gönder</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setBellOpen(false)
                        openNotificationModal('incoming')
                      }}
                      className="text-[11px] font-semibold text-indigo-600 hover:text-indigo-700 transition-colors cursor-pointer whitespace-nowrap"
                    >
                      Tümünü Gör
                    </button>
                  </div>
                </div>

                <div className="max-h-[300px] overflow-y-auto divide-y divide-slate-50">
                  {bellLoading ? (
                    <div className="p-4 text-center text-xs text-slate-400">Yükleniyor...</div>
                  ) : recentNotifications.length === 0 ? (
                    <div className="p-8 text-center text-xs text-slate-400 flex flex-col items-center justify-center gap-2">
                      <BellOff className="w-8 h-8 text-slate-300" />
                      <span>Henüz bildiriminiz yok.</span>
                    </div>
                  ) : (
                    recentNotifications.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => void handleNotificationClick(item)}
                        className={`w-full text-left p-3 hover:bg-slate-50/80 transition-colors flex gap-3 items-start ${
                          !item.isRead ? 'bg-indigo-50/20' : ''
                        }`}
                      >
                        <div className={`mt-1 w-2 h-2 rounded-full flex-shrink-0 ${
                          !item.isRead ? 'bg-indigo-600' : 'bg-transparent'
                        }`} />
                        <div className="flex-1 min-w-0">
                          <div className="flex justify-between items-start gap-1">
                            <span className={`text-xs truncate ${!item.isRead ? 'font-bold text-slate-800' : 'text-slate-600'}`}>
                              {item.title}
                            </span>
                            <span className="text-[9px] text-slate-400 whitespace-nowrap">
                              {new Date(item.createTime).toLocaleDateString('tr-TR', { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-400 truncate mt-0.5">
                            {item.content}
                          </p>
                          <span className="text-[9px] font-semibold text-indigo-500 mt-1 block">
                            {item.senderName || item.createUser}
                          </span>
                        </div>
                      </button>
                    ))
                  )}
                </div>

                <div className="p-2 border-t border-slate-100 bg-slate-50/60 text-center">
                  <button
                    type="button"
                    onClick={() => {
                      setBellOpen(false)
                      openNotificationModal('incoming')
                    }}
                    className="w-full py-1 text-xs font-bold text-orange-600 hover:text-orange-700 transition-colors cursor-pointer"
                  >
                    Bildirim Merkezini Aç
                  </button>
                </div>
              </motion.div>,
              document.body
            )}
        </div>

        {/* Anlık işlem bildirimleri — zilin sağında (2026-10-04; eskiden sol altta kutuydu). */}
        <IslemBildirimleri />

        {/* Refresh Page Button */}
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="h-10 w-10 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white/90 hover:text-white transition-all outline-none"
          title="Sayfayı Yenile"
        >
          <RefreshCw size={18} />
        </button>

        {/* Profile Dropdown */}
        <div className="relative" ref={dropdownRef}>
          <button
            type="button"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => {
              if (open) {
                setOpen(false)
                return
              }

              const el = dropdownRef.current
              if (el) {
                const rect = el.getBoundingClientRect()
                const width = 240
                const pad = 8
                const left = Math.max(pad, Math.min(window.innerWidth - width - pad, rect.right - width))
                const top = Math.max(pad, rect.bottom + 8)
                setDropdownPos({ top, left })
              }

              setOpen(true)
            }}
            className="flex items-center gap-3 p-1 rounded-full hover:bg-white/10 transition-all duration-200 outline-none group"
          >
            <div className="hidden sm:flex flex-col items-end mr-1 max-w-[180px]">
              <span className="text-white text-sm font-bold leading-tight group-hover:text-white transition-colors">
                {displayName}
              </span>
              <span className="text-white/60 text-[10px] uppercase font-bold tracking-wider leading-tight">
                Premium Üye
              </span>
            </div>

            <div className="relative w-10 h-10 rounded-xl bg-white shadow-inner flex items-center justify-center transform transition-transform group-hover:rotate-3">
              <span className="text-[#B73A0B] font-black text-lg select-none">{userInitial}</span>
              <div className="absolute -right-0.5 -bottom-0.5 w-3.5 h-3.5 bg-emerald-500 rounded-full border-2 border-[#B73A0B] shadow-sm" />
            </div>
          </button>

          {open && dropdownPos &&
            createPortal(
              <motion.div
                ref={dropdownPanelRef}
                initial={{ opacity: 0, y: 10, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ duration: 0.2, ease: 'easeOut' }}
                style={{ top: dropdownPos.top, left: dropdownPos.left }}
                className="fixed z-[70] w-[240px] bg-white rounded-2xl shadow-[0_10px_40px_-10px_rgba(0,0,0,0.2)] border border-gray-100 overflow-hidden"
                onMouseDown={(e) => e.stopPropagation()}
              >
                <div className="px-5 py-4 bg-gray-50/50">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-[#B73A0B] flex items-center justify-center text-white font-bold text-lg">
                      {userInitial}
                    </div>
                    <div className="overflow-hidden">
                      <div className="text-sm font-bold text-gray-900 truncate">{displayName}</div>
                      <div className="text-xs text-gray-500 truncate lowercase">@{displayName.replace(/\s+/g, '')}</div>
                    </div>
                  </div>
                </div>

                <div className="p-2">
                  {(sessionRemainingLabel || sessionExpiresAtLabel) && (
                    <div className="px-3 py-3 rounded-2xl bg-gradient-to-b from-gray-50 to-white border border-gray-100 mb-2">
                      <div className="text-[11px] font-black uppercase tracking-[0.22em] text-gray-500">Oturum</div>
                      <div className="mt-1 grid grid-cols-2 gap-2">
                        <div className="rounded-xl bg-white border border-gray-100 px-3 py-2">
                          <div className="text-[11px] font-bold text-gray-500">JWT Süresi</div>
                          <div className="text-sm font-extrabold text-gray-900 mt-0.5 truncate">
                            {sessionRemainingLabel ?? '-'}
                          </div>
                        </div>
                        <div className="rounded-xl bg-white border border-gray-100 px-3 py-2">
                          <div className="text-[11px] font-bold text-gray-500">Bitiş</div>
                          <div className="text-sm font-extrabold text-gray-900 mt-0.5 truncate">
                            {sessionExpiresAtLabel ?? '-'}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                  {showBackToProjeYonetimi && (
                    <button
                      type="button"
                      onClick={() => {
                        setOpen(false)
                        onBackToProjeYonetimi?.()
                      }}
                      className="w-full px-3 py-2.5 text-sm font-semibold text-gray-800 hover:bg-gray-50 rounded-xl transition-all flex items-center gap-3 group"
                    >
                      <div className="w-8 h-8 rounded-lg bg-gray-100/70 flex items-center justify-center group-hover:bg-gray-100 transition-colors">
                        <LayoutDashboard size={18} />
                      </div>
                      Proje Yönetimi
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false)
                      openNotificationModal('incoming')
                    }}
                    className="w-full px-3 py-2.5 text-sm font-semibold text-gray-800 hover:bg-gray-50 rounded-xl transition-all flex items-center justify-between group"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-gray-100/70 flex items-center justify-center group-hover:bg-gray-100 transition-colors">
                        <Bell size={18} />
                      </div>
                      <span>Bildirimler</span>
                    </div>
                    {unreadCount > 0 && (
                      <span className="min-w-[18px] h-[18px] px-1.5 bg-rose-500 rounded-full text-[10px] font-bold text-white flex items-center justify-center">
                        {unreadCount}
                      </span>
                    )}
                  </button>
                  {hasEmployeeAccess() && (
                    <button
                      type="button"
                      onClick={() => {
                        setOpen(false)
                        window.location.assign(buildEmployeePortalUrl())
                      }}
                      className="w-full px-3 py-2.5 text-sm font-semibold text-gray-800 hover:bg-gray-50 rounded-xl transition-all flex items-center gap-3 group"
                    >
                      <div className="w-8 h-8 rounded-lg bg-gray-100/70 flex items-center justify-center group-hover:bg-gray-100 transition-colors">
                        <UserCheck size={18} />
                      </div>
                      Personele Geç
                    </button>
                  )}
                  {hasAsistanAccess() && (
                    <button
                      type="button"
                      onClick={() => {
                        setOpen(false)
                        window.location.assign(buildAsistanUrl())
                      }}
                      className="w-full px-3 py-2.5 text-sm font-semibold text-gray-800 hover:bg-gray-50 rounded-xl transition-all flex items-center gap-3 group"
                    >
                      <div className="w-8 h-8 rounded-lg bg-green-50 flex items-center justify-center group-hover:bg-green-100 transition-colors">
                        <MessageCircle size={18} className="text-green-700" />
                      </div>
                      Asistan'a Geç (WhatsApp)
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false)
                      onLogout?.()
                    }}
                    className="w-full px-3 py-2.5 text-sm font-semibold text-red-600 hover:bg-red-50 rounded-xl transition-all flex items-center gap-3 group"
                  >
                    <div className="w-8 h-8 rounded-lg bg-red-100/50 flex items-center justify-center group-hover:bg-red-100 transition-colors">
                      <LogOut size={18} />
                    </div>
                    Güvenli Çıkış
                  </button>
                </div>
              </motion.div>,
              document.body
            )}
        </div>
      </div>



      <Modal
        isOpen={ecommerceOpen}
        onClose={() => setEcommerceOpen(false)}
        title="Eticaret Paneli"
      >
        <div className="space-y-3">

          <div className="flex flex-col sm:flex-row sm:items-center gap-2">
            <input
              value={ecommerceQuery}
              onChange={(e) => setEcommerceQuery(e.target.value)}
              className="h-11 w-full sm:flex-1 px-4 rounded-2xl border border-gray-200 bg-white text-sm font-semibold text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-900/30 transition"
              placeholder="Ürün ara (stok kodu, isim)"
            />
            <button
              type="button"
              onClick={() => {
                const ids = ecommerceProducts.map((p) => String(p.id))
                setEcommerceSelected(new Set(ids.filter(Boolean)))
              }}
              className="h-11 px-4 rounded-2xl border border-gray-200 bg-white text-sm font-semibold text-gray-700 hover:bg-gray-50 transition"
            >
              Hepsini seç
            </button>
            <button
              type="button"
              onClick={() => setEcommerceSelected(new Set())}
              className="h-11 px-4 rounded-2xl border border-gray-200 bg-white text-sm font-semibold text-gray-700 hover:bg-gray-50 transition"
            >
              Temizle
            </button>
          </div>

          <div className="text-xs text-gray-500">
            Seçili: <span className="font-bold">{ecommerceSelected.size}</span>
          </div>

          {ecommerceError ? (
            <div className="text-sm font-semibold text-red-700 bg-red-50 border border-red-200 rounded-2xl px-4 py-3">
              {ecommerceError}
            </div>
          ) : null}

          {ecommerceImportMessage ? (
            <div className="text-sm font-semibold text-gray-800 bg-gray-50 border border-gray-200 rounded-2xl px-4 py-3">
              {ecommerceImportMessage}
            </div>
          ) : null}

          <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
            <div className="max-h-[420px] overflow-auto">
              {ecommerceLoading ? (
                <div className="p-4 text-sm font-semibold text-gray-600">Yükleniyor...</div>
              ) : (() => {
                const q = String(ecommerceQuery ?? '').trim().toLowerCase()
                const filtered = q
                  ? ecommerceProducts.filter((p) => {
                      const name = String(p.name ?? '').toLowerCase()
                      const stockCode = String(p.stockCode ?? '').toLowerCase()
                      return name.includes(q) || stockCode.includes(q)
                    })
                  : ecommerceProducts

                if (filtered.length === 0) {
                  return <div className="p-4 text-sm font-semibold text-gray-600">Ürün bulunamadı</div>
                }

                return filtered.map((p) => {
                  const id = String(p.id)
                  const checked = ecommerceSelected.has(id)
                  return (
                    <label
                      key={id}
                      className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 last:border-b-0 hover:bg-gray-50 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          const on = e.target.checked
                          setEcommerceSelected((prev) => {
                            const next = new Set(prev)
                            if (on) next.add(id)
                            else next.delete(id)
                            return next
                          })
                        }}
                        className="h-4 w-4"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-extrabold text-gray-900 truncate">
                          {String(p.name ?? '').trim() || '(İsimsiz ürün)'}
                        </div>
                        <div className="text-xs text-gray-500 truncate mt-0.5">
                          {String(p.stockCode ?? '').trim() ? `Stok: ${String(p.stockCode ?? '').trim()}` : null}
                          {String(p.currency ?? '').trim() && p.unitPrice != null
                            ? ` • Fiyat: ${String(p.unitPrice)} ${String(p.currency)}`
                            : null}
                          {p.stock != null ? ` • Stok: ${String(p.stock)}` : null}
                        </div>
                      </div>
                      <div className="shrink-0 text-[11px] font-bold text-gray-500">
                        {p.isActive === false ? 'Pasif' : 'Aktif'}
                      </div>
                    </label>
                  )
                })
              })()}
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setEcommerceOpen(false)}
              className="h-11 px-4 rounded-2xl border border-gray-200 bg-white text-sm font-semibold hover:bg-gray-50"
            >
              Kapat
            </button>
            <button
              type="button"
              disabled={ecommerceSelected.size === 0}
              onClick={() => void submitEcommerceImport()}
              className="h-11 px-5 rounded-2xl bg-gradient-to-r from-red-700 via-rose-600 to-red-700 text-white hover:from-red-800 hover:via-rose-700 hover:to-red-800 text-sm font-semibold disabled:opacity-60"
            >
              {ecommerceImporting ? 'Aktarılıyor...' : 'Eticarete aktar'}
            </button>
          </div>
        </div>
      </Modal>

      {sidebarOpen &&
        createPortal(
          <div className="fixed inset-0 z-[100] flex">
            {/* Backdrop overlay */}
            <div
              onClick={() => setSidebarOpen(false)}
              className="fixed inset-0 bg-black/75 backdrop-blur-sm transition-opacity duration-300 animate-fade-in"
            />

            {/* Sidebar content panel */}
            <div className="relative w-[290px] sm:w-[330px] h-full bg-gradient-to-b from-[#1C0500] via-[#5C1A05] to-[#0A0200] border-r border-[#8F2500]/30 flex flex-col z-[110] shadow-[10px_0_40px_rgba(0,0,0,0.6)] font-outfit text-white animate-slide-in">
              
              {/* Header inside sidebar */}
              <div className="p-5 flex items-center justify-between border-b border-white/10 bg-black/40">
                <div className="flex items-center gap-3">
                  {isDemoTest ? (
                    <div className="relative flex flex-col items-start pt-1">
                      <style dangerouslySetInnerHTML={{__html: `
                        @import url('https://fonts.googleapis.com/css2?family=Caveat:wght@700&family=Dancing+Script:wght@700&display=swap');
                        .loading-handwriting { font-family: 'Caveat', 'Dancing Script', cursive; }
                      `}} />
                      <img
                        src={logoSrc}
                        alt="STILSOFT"
                        className="h-8 w-auto object-contain filter brightness-0 invert"
                        onError={() => setLogoOk(false)}
                      />
                      <span className="loading-handwriting text-red-500 font-extrabold text-2xl -mt-3.5 ml-12 transform -rotate-6 tracking-wide select-none">
                        bayi
                      </span>
                    </div>
                  ) : logoOk ? (
                    <img
                      src={logoSrc}
                      alt="Logo"
                      className="h-[32px] w-auto drop-shadow-md filter brightness-0 invert"
                      onError={() => setLogoOk(false)}
                    />
                  ) : (
                    <span className="text-white text-2xl font-black">STILSOFT</span>
                  )}
                </div>
                
                <button
                  type="button"
                  onClick={() => setSidebarOpen(false)}
                  className="h-10 w-10 flex items-center justify-center rounded-full bg-white/5 hover:bg-white/10 border border-white/10 text-white/80 hover:text-white transition outline-none"
                >
                  <X size={20} />
                </button>
              </div>

              {/* Sidebar Scrollable Body */}
              <div className="flex-1 overflow-y-auto px-4 py-6 space-y-4 no-scrollbar">
                
                {/* Section 1: Modules (B2B links) */}
                <div>
                  <div className="flex items-center gap-2 px-2 text-[10px] font-black tracking-widest text-red-400 uppercase mb-3">
                    <ArrowLeftRight size={12} />
                    <span>Modüller</span>
                  </div>
                  <div className="space-y-2">
                    {items.map((item) => {
                      const isActive = item.id === activeId
                      const isExpanded = expandedModule === item.id
                      const subItemsForModule = menuTabs?.[item.id] || []

                      return (
                        <div key={item.id} className="space-y-1">
                          <button
                            type="button"
                            onClick={() => {
                              if (subItemsForModule.length > 0) {
                                setExpandedModule(isExpanded ? null : item.id)
                              } else {
                                setSidebarOpen(false)
                                onSelect?.(item.id)
                              }
                            }}
                            className={`w-full px-4 py-3 rounded-xl flex items-center justify-between text-sm transition-all duration-200 outline-none ${
                              isActive
                                ? 'bg-gradient-to-r from-[#B73A0B] to-[#782202] border border-[#B73A0B]/40 text-white font-extrabold shadow-lg'
                                : 'text-white/70 hover:text-white hover:bg-white/5'
                            }`}
                          >
                            <span>{item.label}</span>
                            {subItemsForModule.length > 0 && (
                              <ChevronDown
                                size={16}
                                className={`transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
                              />
                            )}
                          </button>

                          {/* Accordion sub-items */}
                          {isExpanded && subItemsForModule.length > 0 && (
                            <div className="pl-4 pr-2 py-1.5 space-y-1 bg-black/25 rounded-xl border border-white/5 mt-1">
                              {subItemsForModule.map((sub) => {
                                const isSubActive = sub.id === activeSubId
                                return (
                                  <a
                                    key={sub.id}
                                    href={sub.href ?? '#'}
                                    onClick={(e) => {
                                      setSidebarOpen(false)
                                      if (onNavigate && sub.href) {
                                        const isExternal = sub.href.startsWith('http://') || sub.href.startsWith('https://')
                                        if (!isExternal) {
                                          e.preventDefault()
                                          onSelect?.(item.id)
                                          onNavigate(sub.href)
                                        }
                                      }
                                    }}
                                    className={`w-full px-4 py-2 rounded-lg flex items-center justify-between text-xs transition-all duration-200 outline-none ${
                                      isSubActive
                                        ? 'bg-white/10 text-white font-bold'
                                        : 'text-white/60 hover:text-white hover:bg-white/5'
                                    }`}
                                  >
                                    <span>{sub.label}</span>
                                  </a>
                                )
                              })}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>

              {/* Sidebar Footer (User Info & Logout) */}
              <div className="p-4 border-t border-white/10 bg-black/40 space-y-3">
                <div className="flex items-center gap-3 px-2">
                  <div className="w-10 h-10 rounded-xl bg-white shadow-inner flex items-center justify-center text-[#B73A0B] font-black text-lg">
                    {userInitial}
                  </div>
                  <div className="overflow-hidden">
                    <div className="text-sm font-bold text-white truncate">{displayName}</div>
                    <div className="text-xs text-white/50 truncate uppercase font-bold tracking-wider">{displayTenant}</div>
                  </div>
                </div>

                <div className="space-y-2">
                  <button
                    type="button"
                    onClick={() => {
                      setSidebarOpen(false)
                      window.location.assign(buildServiceOpsUrl())
                    }}
                    className="w-full bg-white/5 border border-white/10 hover:border-white/20 p-2.5 rounded-2xl shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)] active:scale-[0.98] group cursor-pointer transition-all flex items-center justify-between gap-3 text-white"
                  >
                    <div className="flex flex-col items-start leading-none gap-0.5">
                      <span className="font-bold text-[8px] text-white/50 tracking-wider uppercase">Aktif Panel</span>
                      <span className="font-black text-[11px] text-white uppercase tracking-wider">BAYİ</span>
                    </div>
                    <ArrowLeftRight size={14} className="text-white/40 group-hover:rotate-180 transition-transform duration-350" />
                    <div className="flex items-center gap-1.5 bg-red-600/90 group-hover:bg-red-500 px-3 py-1.5 rounded-xl border border-red-500/20 shadow-sm transition-all duration-300">
                      <span className="font-extrabold text-[11px] text-white uppercase tracking-wider">SERVİS'E GEÇ</span>
                    </div>
                  </button>
                  {hasEmployeeAccess() && (
                    <button
                      type="button"
                      onClick={() => {
                        setSidebarOpen(false)
                        window.location.assign(buildEmployeePortalUrl())
                      }}
                      className="w-full bg-white/5 border border-white/10 hover:border-white/20 p-2.5 rounded-2xl shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)] active:scale-[0.98] group cursor-pointer transition-all flex items-center justify-between gap-3 text-white"
                    >
                      <div className="flex flex-col items-start leading-none gap-0.5">
                        <span className="font-bold text-[8px] text-white/50 tracking-wider uppercase">Aktif Panel</span>
                        <span className="font-black text-[11px] text-white uppercase tracking-wider">BAYİ</span>
                      </div>
                      <UserCheck size={14} className="text-white/40 group-hover:scale-110 transition-transform duration-300" />
                      <div className="flex items-center gap-1.5 bg-emerald-600/90 group-hover:bg-emerald-500 px-3 py-1.5 rounded-xl border border-emerald-500/20 shadow-sm transition-all duration-300">
                        <span className="font-extrabold text-[11px] text-white uppercase tracking-wider">PERSONELE GEÇ</span>
                      </div>
                    </button>
                  )}
                  {hasAsistanAccess() && (
                    <button
                      type="button"
                      onClick={() => {
                        setSidebarOpen(false)
                        window.location.assign(buildAsistanUrl())
                      }}
                      className="w-full bg-white/5 border border-white/10 hover:border-white/20 p-2.5 rounded-2xl shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)] active:scale-[0.98] group cursor-pointer transition-all flex items-center justify-between gap-3 text-white"
                    >
                      <div className="flex flex-col items-start leading-none gap-0.5">
                        <span className="font-bold text-[8px] text-white/50 tracking-wider uppercase">Aktif Panel</span>
                        <span className="font-black text-[11px] text-white uppercase tracking-wider">BAYİ</span>
                      </div>
                      <MessageCircle size={14} className="text-white/40 group-hover:scale-110 transition-transform duration-300" />
                      <div className="flex items-center gap-1.5 bg-green-600/90 group-hover:bg-green-500 px-3 py-1.5 rounded-xl border border-green-500/20 shadow-sm transition-all duration-300">
                        <span className="font-extrabold text-[11px] text-white uppercase tracking-wider">ASİSTAN'A GEÇ</span>
                      </div>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setSidebarOpen(false)
                      onLogout?.()
                    }}
                    className="w-full py-2.5 px-3 text-center text-xs font-bold bg-rose-950/20 hover:bg-rose-900/40 border border-rose-900/30 text-rose-350 hover:text-rose-200 rounded-lg transition-all"
                  >
                    Çıkış Yap
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}

      <style dangerouslySetInnerHTML={{
        __html: `
        .no-scrollbar::-webkit-scrollbar {
          display: none;
        }
        .no-scrollbar {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
        @keyframes slideIn {
          from { transform: translateX(-100%); }
          to { transform: translateX(0); }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        .animate-slide-in {
          animation: slideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
        .animate-fade-in {
          animation: fadeIn 0.2s ease-out forwards;
        }
      `}} />

      <NotificationModal
        isOpen={notificationModalOpen}
        initialTab={notificationModalTab}
        onClose={() => setNotificationModalOpen(false)}
        isSuperAdmin={isSuperAdmin}
        allowedKeys={allowedKeys}
      />
    </header>
  )
}
