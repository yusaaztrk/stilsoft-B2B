import { Bell, BellOff, ChevronDown, LogOut, RefreshCw, Menu, X, ArrowLeftRight } from 'lucide-react'
import { sekmeGorunur } from '../utils/sekmeGorunur'
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate, useLocation } from 'react-router-dom'
import { apiFetch, apiJson } from '../api/client'
import { b2bBaseUrl } from '../config'
import { buildEmployeePortalUrl, hasEmployeeAccess } from '../auth/b2bLink'
import { NotificationModal } from '../pages/NotificationsPage'

/**
 * The bordeaux/black palette. The top bar and the mobile slide-out sidebar are the same surface
 * to the user, so they read from these two constants rather than each carrying their own colours
 * — the header used to be orange (#8F2500 → #FF4B1F) while the sidebar was bordeaux, and the
 * two looked like parts of different applications.
 *
 * Tenant branding still overrides the header when it supplies its own gradient.
 */
export const SHELL_GRADIENT_FROM = '#120208'
export const SHELL_GRADIENT_TO = '#4A0D25'

/**
 * B2B'ye dönüş bağlantısı. `StilsoftShell.getB2BBaseUrl` ile aynı kural.
 *
 * DİKKAT — buraya sync_token/sync_tenant EKLEMEYİN. Oturum devri BİLEREK tek yönlüdür
 * (B2B → ServiceOps). Ters yönde denendiğinde iki şey oluyordu: (1) B2B'nin RequireAuth'ı
 * URL'den gelen token'ı sorgusuz kendi accessToken'ının üzerine yazıyor, geçerli B2B oturumu
 * bozuluyor ve kullanıcı firma seçimine düşüyordu; (2) URL'den gelen herhangi bir token kabul
 * edildiği için enjeksiyon açığı oluşuyordu. Tüketici taraf 2026-08-05'te kaldırıldı, yani
 * parametreler bugün zaten hiçbir işe yaramaz — sadece servis JWT'sini tarayıcı geçmişine,
 * Referer başlığına ve sunucu log'larına yazarlar.
 */
function buildB2BUrl(path: string = '/') {
  return new URL(`${b2bBaseUrl()}${path}`).toString()
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
  subItems?: { id: string; label: string; href?: string }[]
  subItemGroups?: {
    id: string
    label: string
    items: { id: string; label: string; href?: string }[]
  }[]
  activeSubId?: string
  userInitial?: string
  userName?: string
  tenantName?: string
  tenantLogoUrl?: string
  headerGradientFrom?: string
  headerGradientTo?: string
  onLogout?: () => void
}

export default function Header({
  items,
  activeId,
  onSelect,
  subItems = [],
  subItemGroups = [],
  activeSubId,
  userInitial = 'A',
  userName,
  tenantName,
  tenantLogoUrl,
  headerGradientFrom,
  headerGradientTo,
  onLogout
}: Props) {
  const navigate = useNavigate()
  const location = useLocation()
  const [open, setOpen] = useState(false)
  const [logoOk, setLogoOk] = useState(true)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [expandedModule, setExpandedModule] = useState<string | null>(activeId || null)
  const dropdownRef = useRef<HTMLDivElement | null>(null)
  const dropdownPanelRef = useRef<HTMLDivElement | null>(null)
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number } | null>(null)

  const [unreadCount, setUnreadCount] = useState<number>(0)
  const [bellOpen, setBellOpen] = useState(false)
  const [allNotificationsOpen, setAllNotificationsOpen] = useState(false)
  const [bellPos, setBellPos] = useState<{ top: number; left: number } | null>(null)
  const [recentNotifications, setRecentNotifications] = useState<any[]>([])
  const [bellLoading, setBellLoading] = useState(false)
  const bellRef = useRef<HTMLDivElement | null>(null)
  const bellPanelRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node
      if (dropdownRef.current && dropdownRef.current.contains(target)) return
      if (dropdownPanelRef.current && dropdownPanelRef.current.contains(target)) return
      if (bellRef.current && bellRef.current.contains(target)) return
      if (bellPanelRef.current && bellPanelRef.current.contains(target)) return
      setOpen(false)
      setBellOpen(false)
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

  const loadUnreadCount = async () => {
    try {
      const count = await apiJson<number>('/api/notifications/unread-count')
      setUnreadCount(count)
    } catch (err) {
      console.warn('Failed to load unread notifications count:', err)
    }
  }

  const loadNotifications = async () => {
    setBellLoading(true)
    try {
      const list = await apiJson<any[]>('/api/notifications')
      setRecentNotifications(list.slice(0, 5))
    } catch (err) {
      console.warn('Failed to load notifications:', err)
    } finally {
      setBellLoading(false)
    }
  }

  const handleNotificationClick = async (item: any) => {
    setBellOpen(false)
    if (!item.isRead) {
      try {
        // PATCH — sunucudaki uç [HttpPatch("{id:guid}/read")]. POST gönderiliyordu, yani her
        // istek 405 alıyor ve bildirim hiçbir zaman okundu işaretlenmiyordu (rozet düşmüyordu).
        await apiFetch(`/api/notifications/${item.id}/read`, { method: 'PATCH' })
        void loadUnreadCount()
      } catch (err) {
        console.warn('Failed to mark notification as read:', err)
      }
    }
    // Bildirimi açmak ayrı bir sayfaya gitmek yerine modalı açıyor: kullanıcı baktığı ekranı
    // kaybetmiyor ve `/bildirimler` yönlendirme zincirine hiç girilmiyor.
    setAllNotificationsOpen(true)
  }

  useEffect(() => {
    void loadUnreadCount()
    const handleUpdate = () => void loadUnreadCount()
    window.addEventListener('notifications_updated', handleUpdate)
    const interval = setInterval(() => { if (sekmeGorunur()) void loadUnreadCount() }, 30000)
    return () => {
      window.removeEventListener('notifications_updated', handleUpdate)
      clearInterval(interval)
    }
  }, [])

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

  const gradientFrom = (headerGradientFrom ?? '').trim() || SHELL_GRADIENT_FROM
  const gradientTo = (headerGradientTo ?? '').trim() || SHELL_GRADIENT_TO

  const logoSrc = (tenantLogoUrl ?? '').trim() || '/s-logo-white.png'

  useEffect(() => {
    setLogoOk(true)
  }, [logoSrc])

  return (
    <>
      <header
        className="fixed top-0 left-0 right-0 z-[40] h-[64px] font-outfit shadow-[0_10px_28px_rgba(0,0,0,0.25)] border-b border-black/10 flex items-center px-2 sm:px-4 lg:px-6 overflow-hidden"
        style={{
          background: `linear-gradient(180deg, ${gradientFrom}, ${gradientTo})`
        }}
      >
        {/* 0.2 Opacity Dark Overlay */}
        <div className="absolute inset-0 bg-black/20 pointer-events-none z-0" />

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
            onClick={() => navigate('/')}
            className="group relative flex items-center gap-3 transition-transform active:scale-95 outline-none"
          >
            <div className="relative flex flex-col items-start pt-1">
              <style dangerouslySetInnerHTML={{__html: `
                @import url('https://fonts.googleapis.com/css2?family=Caveat:wght@700&family=Dancing+Script:wght@700&display=swap');
                .loading-handwriting { font-family: 'Caveat', 'Dancing Script', cursive; }
              `}} />
              {logoOk ? (
                <>
                  <img
                    src={logoSrc}
                    alt="STILSOFT"
                    className="h-8 w-auto object-contain filter brightness-0 invert"
                    onError={() => setLogoOk(false)}
                  />
                  <span className="loading-handwriting text-red-500 font-extrabold text-2xl -mt-3.5 ml-12 transform -rotate-6 tracking-wide select-none">
                    servis
                  </span>
                </>
              ) : (
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-red-600 flex items-center justify-center text-white font-black text-sm shadow-md">
                    S
                  </div>
                  <span className="font-extrabold text-white text-sm tracking-tight hidden sm:inline">STILSOFT</span>
                </div>
              )}
            </div>
            <div className="hidden lg:block h-6 w-px bg-white/20 ml-2" />
          </button>
        </div>

        {/* Navigation Section (Desktop Only) */}
        <nav className="hidden lg:flex flex-1 items-center h-full px-2 sm:px-3 lg:px-6 overflow-hidden min-w-0 relative z-10">
          <div className="flex items-center gap-1 overflow-x-auto no-scrollbar pb-0.5">
            {items.map((item) => {
              const isActive = item.id === activeId
              return (
                <a
                  key={item.id}
                  href={item.href ?? '#'}
                  onClick={(e) => {
                    if (item.href === '#' || isActive) {
                      e.preventDefault()
                    }
                    if (onSelect) {
                      onSelect(item.id)
                    }
                  }}
                  className={`group relative px-2.5 sm:px-3 lg:px-4 py-2 rounded-lg text-[12px] sm:text-sm font-black transition-all duration-200 outline-none flex items-center gap-2 whitespace-nowrap ${
                    isActive ? 'text-white bg-white/15 shadow-[inset_0_1px_1px_rgba(255,255,255,0.2)]' : 'text-white/85 hover:text-white hover:bg-white/5'
                  }`}
                >
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
        <div className="flex items-center gap-2 sm:gap-3 ml-auto relative z-10">
          {/* Notification Bell */}
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
                <div
                  ref={bellPanelRef}
                  style={{ top: bellPos.top, left: bellPos.left }}
                  className="fixed z-[70] w-[320px] bg-white rounded-2xl shadow-[0_10px_40px_-10px_rgba(0,0,0,0.2)] border border-slate-100 overflow-hidden text-slate-800"
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-800">Bildirimler ({unreadCount})</span>
                    <button
                      type="button"
                      onClick={() => {
                        // Sayfaya YÖNLENDİRMİYOR. `/bildirimler`, teknisyen olmayan oturumları
                        // `/`'a atıyordu, `/` da yetkiye göre ilk açılabilir sayfaya gidiyordu —
                        // "Tümünü Gör'e basınca Montaj Yönetimi açılıyor" bu zincirdi.
                        setBellOpen(false)
                        setAllNotificationsOpen(true)
                      }}
                      className="text-[11px] font-semibold text-indigo-600 hover:text-indigo-700 transition-colors"
                    >
                      Tümünü Gör
                    </button>
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
                                {new Date(item.createdAt).toLocaleDateString('tr-TR', { hour: '2-digit', minute: '2-digit' })}
                              </span>
                            </div>
                            <p className="text-[11px] text-slate-400 truncate mt-0.5">
                              {item.message}
                            </p>
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                </div>,
                document.body
              )}
          </div>

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
                  {displayTenant}
                </span>
              </div>

              <div className="relative w-10 h-10 rounded-xl bg-white shadow-inner flex items-center justify-center transform transition-transform group-hover:rotate-3">
                <span className="text-[#B73A0B] font-black text-lg select-none">{userInitial}</span>
                <div className="absolute -right-0.5 -bottom-0.5 w-3.5 h-3.5 bg-emerald-500 rounded-full border-2 border-[#B73A0B] shadow-sm" />
              </div>
            </button>

            {open && dropdownPos &&
              createPortal(
                <div
                  ref={dropdownPanelRef}
                  style={{ top: dropdownPos.top, left: dropdownPos.left }}
                  className="fixed z-[70] w-[240px] bg-white rounded-2xl shadow-[0_10px_40px_-10px_rgba(0,0,0,0.2)] border border-gray-100 overflow-hidden text-slate-800"
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
                    <button
                      type="button"
                      onClick={() => {
                        setOpen(false)
                        onLogout?.()
                      }}
                      className="w-full px-3 py-2.5 text-sm font-semibold text-red-650 hover:bg-red-50 rounded-xl transition-all flex items-center gap-3 group"
                    >
                      <div className="w-8 h-8 rounded-lg bg-red-100/50 flex items-center justify-center group-hover:bg-red-100 transition-colors">
                        <LogOut size={18} />
                      </div>
                      Güvenli Çıkış
                    </button>
                  </div>
                </div>,
                document.body
              )}
          </div>
        </div>
      </header>

      {/* Slide-out Sidebar for Mobile & Tablet (Bordeaux & Black Theme) */}
      {sidebarOpen &&
        createPortal(
          <div className="fixed inset-0 z-[100] flex">
            {/* Backdrop overlay */}
            <div
              onClick={() => setSidebarOpen(false)}
              className="fixed inset-0 bg-black/75 backdrop-blur-sm transition-opacity duration-300 animate-fade-in"
            />

            {/* Sidebar content panel */}
            <div
              className="relative w-[290px] sm:w-[330px] h-full pt-safe pb-safe border-r border-[#4A0D25] flex flex-col z-[110] shadow-[10px_0_40px_rgba(0,0,0,0.6)] font-outfit text-white animate-slide-in"
              style={{
                background: `linear-gradient(180deg, ${SHELL_GRADIENT_FROM}, ${SHELL_GRADIENT_TO})`
              }}
            >
              
              {/* Header inside sidebar */}
              <div className="p-5 flex items-center justify-between border-b border-white/10 bg-black/40">
                <div className="flex items-center gap-3">
                  {logoOk ? (
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
                        servis
                      </span>
                    </div>
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
                  <div className="flex items-center gap-2 px-2 text-[10px] font-black tracking-widest text-[#B31D56] uppercase mb-3">
                    <ArrowLeftRight size={12} />
                    <span>Modüller</span>
                  </div>
                  <div className="space-y-2">
                    {items.map((item) => {
                      const isActive = item.id === activeId
                      const isServiceModule = item.id === 'service'
                      const isExpanded = expandedModule === item.id
                      const subItemsForModule = isServiceModule ? subItems : []
                      const hasSubItems = subItemsForModule.length > 0 || (isServiceModule && subItemGroups.length > 0)

                      return (
                        <div key={item.id} className="space-y-1">
                          {hasSubItems ? (
                            <button
                              type="button"
                              onClick={() => {
                                setExpandedModule(isExpanded ? null : item.id)
                              }}
                              className={`w-full px-4 py-3 rounded-xl flex items-center justify-between text-sm transition-all duration-200 outline-none ${
                                isActive
                                  ? 'bg-gradient-to-r from-[#5B0E2D] to-[#3D0A1E] border border-[#B31D56]/40 text-white font-extrabold shadow-lg'
                                  : 'text-white/70 hover:text-white hover:bg-white/5'
                              }`}
                            >
                              <span>{item.label}</span>
                              <ChevronDown
                                size={16}
                                className={`transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
                              />
                            </button>
                          ) : (
                            <a
                              href={item.href ?? '#'}
                              onClick={(e) => {
                                if (item.href === '#' || isActive) {
                                  e.preventDefault()
                                }
                                setSidebarOpen(false)
                                if (onSelect) {
                                  onSelect(item.id)
                                }
                              }}
                              className={`w-full px-4 py-3 rounded-xl flex items-center justify-between text-sm transition-all duration-200 outline-none ${
                                isActive
                                  ? 'bg-gradient-to-r from-[#5B0E2D] to-[#3D0A1E] border border-[#B31D56]/40 text-white font-extrabold shadow-lg'
                                  : 'text-white/70 hover:text-white hover:bg-white/5'
                              }`}
                            >
                              <span>{item.label}</span>
                            </a>
                          )}

                          {/* Accordion sub-items */}
                          {isExpanded && hasSubItems && (
                            <div className="pl-3 pr-2 py-1.5 space-y-3 bg-black/25 rounded-xl border border-white/5 mt-1">
                              {subItemGroups.length > 0 ? (
                                subItemGroups.map((group) => (
                                  <div key={group.id} className="space-y-1">
                                    <div className="text-[10px] font-bold text-[#FF4B1F]/80 uppercase px-3 pt-1 pb-0.5 tracking-wider">
                                      {group.label}
                                    </div>
                                    {group.items.map((sub) => {
                                      const isSubActive = sub.id === activeSubId
                                      return (
                                        <a
                                          key={sub.id}
                                          href={sub.href ?? '#'}
                                          onClick={(e) => {
                                            setSidebarOpen(false)
                                            if (sub.href) {
                                              e.preventDefault()
                                              navigate(sub.href)
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
                                ))
                              ) : (
                                subItemsForModule.map((sub) => {
                                  const isSubActive = sub.id === activeSubId
                                  return (
                                    <a
                                      key={sub.id}
                                      href={sub.href ?? '#'}
                                      onClick={(e) => {
                                        setSidebarOpen(false)
                                        if (sub.href) {
                                          e.preventDefault()
                                          navigate(sub.href)
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
                                })
                              )}
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
                  <div className="w-10 h-10 rounded-xl bg-white shadow-inner flex items-center justify-center text-slate-900 font-black text-lg">
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
                      window.location.assign(buildB2BUrl('/invoice'))
                    }}
                    className="w-full bg-white/5 border border-white/10 hover:border-white/20 p-2.5 rounded-2xl shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)] active:scale-[0.98] group cursor-pointer transition-all flex items-center justify-between gap-3 text-white"
                  >
                    <div className="flex flex-col items-start leading-none gap-0.5">
                      <span className="font-bold text-[8px] text-white/50 tracking-wider uppercase">Aktif Panel</span>
                      <span className="font-black text-[11px] text-red-400 uppercase tracking-wider">SERVİS</span>
                    </div>
                    <ArrowLeftRight size={14} className="text-white/40 group-hover:rotate-180 transition-transform duration-350" />
                    <div className="flex items-center gap-1.5 bg-white/95 group-hover:bg-white px-3 py-1.5 rounded-xl border border-white/20 shadow-sm transition-all duration-300">
                      <span className="font-extrabold text-[11px] text-gray-900 uppercase tracking-wider">BAYİ'YE GEÇ</span>
                    </div>
                  </button>
                  {hasEmployeeAccess() && buildEmployeePortalUrl() && (
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
                        <span className="font-black text-[11px] text-red-400 uppercase tracking-wider">SERVİS</span>
                      </div>
                      <ArrowLeftRight size={14} className="text-white/40 group-hover:rotate-180 transition-transform duration-350" />
                      <div className="flex items-center gap-1.5 bg-white/95 group-hover:bg-white px-3 py-1.5 rounded-xl border border-white/20 shadow-sm transition-all duration-300">
                        <span className="font-extrabold text-[11px] text-gray-900 uppercase tracking-wider">PERSONELE GEÇ</span>
                      </div>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setSidebarOpen(false)
                      onLogout?.()
                    }}
                    className="w-full py-2 px-3 text-center text-xs font-semibold bg-rose-950/20 hover:bg-rose-900/40 border border-rose-900/30 text-rose-350 hover:text-rose-200 rounded-lg transition-all"
                  >
                    Çıkış Yap
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}

      <NotificationModal
        open={allNotificationsOpen}
        onClose={() => {
          setAllNotificationsOpen(false)
          void loadUnreadCount()
        }}
      />

      {/* Local keyframe animation injection */}
      <style dangerouslySetInnerHTML={{
        __html: `
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
    </>
  )
}
