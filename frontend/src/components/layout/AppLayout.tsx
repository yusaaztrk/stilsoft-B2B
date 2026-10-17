import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { clearCredentialsNative } from '../../native/credentials'

import { useEffect, useMemo, useState } from 'react'

import {
  AlertTriangle,
  ArrowLeftRight,
  BarChart3,
  Bell,
  ClipboardList,
  Clock,
  CreditCard,
  FileSpreadsheet,
  FileText,
  LogIn,
  MessageCircle,
  Package,
  Printer,
  Receipt,
  RefreshCw,
  Search,
  ShoppingCart,
  Tags,
  Truck,
  Users,
  Wallet,
  Warehouse,
  ShieldCheck,
  Calendar,
  Wrench,
  Building2,
  Settings,
  MapPin,
  Activity,
  Layout,
  Landmark,
  Megaphone,
  Image as ImageIcon,
  Gift,
  TrendingUp
} from 'lucide-react'

import Header from '../Header'
import SubNavigation from '../SubNavigation'
import { useCart } from '../../contexts/CartContext'
import { invoiceTabIdToPath, pathToInvoiceTabId, type InvoiceTabId } from '../../routes'
import { API_BASE_URL, serviceOpsBaseUrl } from '../../config/api'
import { assistantKnowledgeBase } from '../../constants/assistantKnowledgeBase'
import SessionExpiryPopup from '../SessionExpiryPopup'
import { fetchNotifications, markNotificationAsRead, type NotificationResponse } from '../../api/notifications'



/**
 * Link that carries the current B2B session across to ServiceOps.
 *
 * Built at the moment it is needed, never memoised: the session lives in localStorage, which
 * is not reactive, so a value computed once at mount keeps handing over the token that
 * existed back then — empty on the render straight after login, stale after a refresh. Either
 * one lands the user on the ServiceOps login screen while they are still signed in here.
 */
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
  return url.toString()
}

export default function AppLayout() {

  const cart = useCart()



  const buildHeaders = (includeJson: boolean) => {

    const headers: Record<string, string> = {}

    if (includeJson) headers['Content-Type'] = 'application/json'

    const token = localStorage.getItem('accessToken')

    if (token) headers.Authorization = `Bearer ${token}`

    return headers

  }



  const menuItems = useMemo(
    () => [
      { id: 'invoice', label: 'Fatura İşlemleri' },
      { id: 'pos', label: 'Sanal Pos İşlemleri' },
      { id: 'cash', label: 'Kasa İşlemleri' },
      { id: 'check', label: 'Çek/Senet İşlemleri' },
      { id: 'bank', label: 'Banka İşlemleri' },
      { id: 'reports', label: 'Raporlar' },
      { id: 'eticaret', label: 'E-Ticaret' },
      // Bildirimler Ayarlar'ın altından çıkarıldı: bir yapılandırma ekranı değil, günlük
      // kullanılan bir yer. Yetkileri de Rol Yetkileri'nde kendi başlığı altında.
      { id: 'bildirimler', label: 'Bildirimler' },
      { id: 'users', label: 'Ayarlar' }
    ],
    []
  )

  const menuIdToPath = useMemo(
    () => {
      const serviceBase = serviceOpsBaseUrl()
      // Deliberately no session in this value: the memo has no dependencies, so anything
      // read from localStorage here is frozen at mount. That is why the handover kept
      // asking for a password — the link carried whatever token existed on first render,
      // which is none on the render right after login and a stale one after a refresh.
      // The real link is built by buildServiceOpsUrl at the moment it is used.
      return {
        invoice: '/invoice',
        pos: '/pos',
        cash: '/cash',
        check: '/check',
        bank: '/bank',
        reports: '/reports',
        service: serviceBase,
        eticaret: '/eticaret',
        bildirimler: '/bildirimler',
        users: '/users'
      }
    },
    []
  )



  const location = useLocation()

  const navigate = useNavigate()



  const handleLogout = async () => {
    /*
      Telefon kabugundaki kayitli giris bilgisi ACIK CIKISTA silinir (2026-08-24).
      Silinmezse otomatik giris kullaniciyi hemen geri sokar ve hesap degistirmek
      imkansiz hale gelir. Oturum SURESI dolmasi bunu tetiklemez — otomatik giris
      zaten onun icin var. Tarayicida bu cagri hicbir sey yapmaz.
    */
    clearCredentialsNative()

    try {

      const token = localStorage.getItem('accessToken')

      if (token) {

        await fetch(`${API_BASE_URL}/api/auth/logout`, {

          method: 'POST',

          headers: {

            ...buildHeaders(false)

          }

        }).catch(() => undefined)

      }

    } finally {

      // DO NOT call cart.clear() here — that would delete DB basket data permanently.
      // Only clear the local state/storage so the next user starts fresh in UI.
      localStorage.removeItem('cart_v1')

      localStorage.removeItem('accessToken')

      localStorage.removeItem('refreshToken')

      localStorage.removeItem('userName')

      sessionStorage.removeItem('userName')

      navigate('/login', { replace: true })

    }

  }



  const [permissionsReady, setPermissionsReady] = useState(false)
  const [showSplash, setShowSplash] = useState(true)
  useEffect(() => {
    const timer = setTimeout(() => {
      setShowSplash(false)
    }, 1000)
    return () => clearTimeout(timer)
  }, [])
  const [activeMenuOverride, setActiveMenuOverride] = useState<string | null>(null)

  const [isSuperAdmin, setIsSuperAdmin] = useState(false)

  const [isSuperSuperAdmin, setIsSuperSuperAdmin] = useState(false)

  const [roleCode, setRoleCode] = useState<string>('')

  const [currentCode, setCurrentCode] = useState<string>('')
  const [salesmanCode, setSalesmanCode] = useState<string>('')

  const [userDiscountRate, setUserDiscountRate] = useState<number | null>(null)

  const [userRoleId, setUserRoleId] = useState<number | null>(null)

  const [ssaViewMode, setSsaViewMode] = useState<'global' | 'tenant'>(() => {

    const raw = String(localStorage.getItem('ssaViewMode') ?? '').trim().toLowerCase()

    return raw === 'tenant' ? 'tenant' : 'global'

  })

  const [allowedKeys, setAllowedKeys] = useState<Set<string>>(new Set())

  const [userName, setUserName] = useState<string>('')

  const [tenantName, setTenantName] = useState<string>('')

  const [tenantLogoUrl, setTenantLogoUrl] = useState<string | null>(null)

  const [headerGradientFrom, setHeaderGradientFrom] = useState<string | null>(null)

  const [headerGradientTo, setHeaderGradientTo] = useState<string | null>(null)

  const [isEcommerceEnabled, setIsEcommerceEnabled] = useState<boolean>(false)

  const [tenantEnabledKeys, setTenantEnabledKeys] = useState<Set<string> | null>(null)

  const loadTenantBranding = async () => {

    const tenantCode = String(localStorage.getItem('tenantCode') ?? '').trim()

    if (!tenantCode) {

      setTenantLogoUrl(null)

      setHeaderGradientFrom(null)

      setHeaderGradientTo(null)

      setIsEcommerceEnabled(false)

      return

    }

    try {

      const res = await fetch(`${API_BASE_URL}/api/tenants/branding`, {

        headers: {

          ...buildHeaders(false),

          'X-Tenant-Code': tenantCode

        }

      })

      if (!res.ok) {

        setTenantLogoUrl(null)

        setHeaderGradientFrom(null)

        setHeaderGradientTo(null)

        setIsEcommerceEnabled(false)

        return

      }

      const json = await res.json().catch(() => null)

      const data = json?.data
      const logoVal = String(data?.logoUrl ?? '').trim() || null
      setTenantLogoUrl(logoVal)
      if (logoVal) localStorage.setItem('tenantLogoUrl', logoVal)

      setHeaderGradientFrom(String(data?.headerGradientFrom ?? '').trim() || null)

      setHeaderGradientTo(String(data?.headerGradientTo ?? '').trim() || null)

      setIsEcommerceEnabled(Boolean(data?.isEcommerceEnabled))

      if (data?.campaignGradientFrom) localStorage.setItem('campaignBannerGradientFrom', String(data.campaignGradientFrom))
      if (data?.campaignGradientTo) localStorage.setItem('campaignBannerGradientTo', String(data.campaignGradientTo))
      if (data?.campaignTextColor) localStorage.setItem('campaignBannerTextColor', String(data.campaignTextColor))
      window.dispatchEvent(new Event('tenant-branding-loaded'))

    } catch {

      setTenantLogoUrl(null)

      setHeaderGradientFrom(null)

      setHeaderGradientTo(null)

      setIsEcommerceEnabled(false)

    }

  }

  useEffect(() => {

    void loadTenantBranding()

    const onBrandingChanged = () => void loadTenantBranding()

    window.addEventListener('tenant-branding-changed', onBrandingChanged as any)

    return () => window.removeEventListener('tenant-branding-changed', onBrandingChanged as any)

  }, [location.pathname])

  useEffect(() => {
    if (!isSuperSuperAdmin) return
    const selectedTenant = String(localStorage.getItem('tenantCode') ?? '').trim()
    const nextMode: 'global' | 'tenant' = selectedTenant ? 'tenant' : 'global'
    const raw = String(localStorage.getItem('ssaViewMode') ?? '').trim().toLowerCase()
    const lsMode: 'global' | 'tenant' = raw === 'tenant' ? 'tenant' : 'global'
    if (ssaViewMode !== nextMode) setSsaViewMode(nextMode)
    if (lsMode !== nextMode) localStorage.setItem('ssaViewMode', nextMode)
  }, [isSuperSuperAdmin, location.pathname, ssaViewMode])

  useEffect(() => {
    const fromVal = headerGradientFrom || '#8F2500'
    const toVal = headerGradientTo || '#BD390C'
    document.documentElement.style.setProperty('--tenant-gradient-from', fromVal)
    document.documentElement.style.setProperty('--tenant-gradient-to', toVal)
  }, [headerGradientFrom, headerGradientTo])



  type AssistantMessage = { id: string; role: 'bot' | 'user'; text: string }

  const [assistantOpen, setAssistantOpen] = useState(false)
  const [assistantMessages, setAssistantMessages] = useState<AssistantMessage[]>([])
  const [assistantSelectedMenuId, setAssistantSelectedMenuId] = useState<string | null>(null)
  const [assistantSelectedPageKey, setAssistantSelectedPageKey] = useState<string | null>(null)
  const [assistantInput, setAssistantInput] = useState<string>('')

  const [popupNotifications, setPopupNotifications] = useState<any[]>([])
  const [activePopupNotification, setActivePopupNotification] = useState<NotificationResponse | null>(null)

  const checkPopupNotifications = async () => {
    const token = localStorage.getItem('accessToken')
    if (!token) return
    try {
      const list = await fetchNotifications()
      const unreads = list.filter(n => !n.isRead && n.isPopup)
      if (unreads.length > 0) {
        setPopupNotifications(unreads)
        setActivePopupNotification((prev) => {
          // If we already have one open, keep it, otherwise show first
          if (prev && unreads.some(u => u.id === prev.id)) {
            return prev
          }
          return unreads[0]
        })
      } else {
        setActivePopupNotification(null)
      }
    } catch (err) {
      console.error('Failed to fetch notifications for popup check:', err)
    }
  }

  const handleDismissPopup = async (notificationId: number) => {
    try {
      await markNotificationAsRead(notificationId)
      window.dispatchEvent(new CustomEvent('notification-read'))
    } catch (err) {
      console.error('Failed to mark notification as read:', err)
    }
    setPopupNotifications(prev => {
      const nextList = prev.filter(n => n.id !== notificationId)
      if (nextList.length > 0) {
        setActivePopupNotification(nextList[0])
      } else {
        setActivePopupNotification(null)
      }
      return nextList
    })
  }

  useEffect(() => {
    void checkPopupNotifications()
    const interval = setInterval(() => {
      void checkPopupNotifications()
    }, 60000)

    const handleRecheck = () => {
      void checkPopupNotifications()
    }
    window.addEventListener('recheck-notifications', handleRecheck)

    return () => {
      clearInterval(interval)
      window.removeEventListener('recheck-notifications', handleRecheck)
    }
  }, [])



  const [sessionAlertBeforeMinutes, setSessionAlertBeforeMinutes] = useState<number | null>(null)

  const [sessionExpiresAtUtcMs, setSessionExpiresAtUtcMs] = useState<number | null>(null)

  const [sessionRemainingMinutes, setSessionRemainingMinutes] = useState<number | null>(null)

  const [sessionPopupOpen, setSessionPopupOpen] = useState(false)

  /**
   * YÖNETİCİNİN BAŞLATTIĞI TOPLU KAPATMA (2026-09-05).
   *
   * Sunucu "şu an herkes düşecek" diye ileri bir zaman damgalıyor; burada o ana kadar geri
   * sayan bir uyarı gösterilir ve süre dolunca kullanıcı kendi kendini çıkarır. Süre dolmasını
   * beklemeden atmak, kullanıcıyı hiçbir açıklama görmeden giriş ekranında bırakırdı.
   */
  const [scheduledRevokeAtMs, setScheduledRevokeAtMs] = useState<number | null>(null)
  const [scheduledRevokeSecondsLeft, setScheduledRevokeSecondsLeft] = useState<number>(0)

  const [sessionExtending, setSessionExtending] = useState(false)

  const [sessionPopupShownForExp, setSessionPopupShownForExp] = useState<number | null>(null)



  const decodeJwtExpMs = (jwt: string | null) => {

    try {

      if (!jwt) return null

      const parts = jwt.split('.')

      if (parts.length < 2) return null

      const payloadRaw = parts[1].replace(/-/g, '+').replace(/_/g, '/')

      const json = JSON.parse(atob(payloadRaw))

      const exp = Number(json?.exp)

      if (!Number.isFinite(exp) || exp <= 0) return null

      return exp * 1000

    } catch {

      return null

    }

  }



  const formatHm = (msUtc: number) => {
    const d = new Date(msUtc)

    const h = String(d.getHours()).padStart(2, '0')

    const m = String(d.getMinutes()).padStart(2, '0')

    return `${h}.${m}`

  }



  const refreshSessionExpiryFromToken = () => {

    const expMs = decodeJwtExpMs(localStorage.getItem('accessToken'))

    setSessionExpiresAtUtcMs(expMs)

  }



  const refreshSessionSettings = async () => {
    try {
      const headers: Record<string, string> = { ...buildHeaders(false) }
      const tenantCode = String(localStorage.getItem('tenantCode') ?? '').trim()
      if (tenantCode) headers['X-Tenant-Code'] = tenantCode

      const ssRes = await fetch(`${API_BASE_URL}/api/SessionSettings`, { headers })

      if (ssRes.ok) {
        const ssJson = await ssRes.json().catch(() => null)
        const alertMin = Number(ssJson?.data?.alertBeforeMinutes)
        if (Number.isFinite(alertMin) && alertMin >= 0) setSessionAlertBeforeMinutes(alertMin)
      }
    } catch {

    }
  }



  /**
   * ServiceOps ile ORTAK oturumun durumu.
   *
   * Oturum artık tek bir sunucu kaydında yaşıyor: süresi, uzatılması ve kapatılması iki uygulama
   * için de aynı yerden yürüyor. Bu yoklama üç şeyi sağlıyor:
   *   - servis tarafından (ya da başka bir cihazdan) çıkış yapıldıysa burası da düşer,
   *   - servis tarafından uzatıldıysa buradaki geri sayım da uzar (sunucu tazelenmiş token yollar),
   *   - süre dolduğunda kullanıcı, hiçbir şeyin yüklenmediği ölü bir ekranda kalmaz.
   */
  const syncSharedSession = async () => {
    const token = localStorage.getItem('accessToken')
    if (!token) return

    try {
      const headers: Record<string, string> = { ...buildHeaders(false) }
      const tenantCode = String(localStorage.getItem('tenantCode') ?? '').trim()
      if (tenantCode) headers['X-Tenant-Code'] = tenantCode

      const res = await fetch(`${API_BASE_URL}/api/auth/session-state`, { headers })

      if (res.status === 401) {
        forceLogin()
        return
      }

      if (!res.ok) return

      const json = await res.json().catch(() => null)
      if (!json) return

      if (json.valid === false) {
        forceLogin()
        return
      }

      const alertMin = Number(json.alertBeforeMinutes)
      if (Number.isFinite(alertMin) && alertMin >= 0) setSessionAlertBeforeMinutes(alertMin)

      // Yönetici "herkesi düşür" dediyse sunucu kapanma anını yolluyor. Geri sayım aşağıdaki
      // sayaçta yürüyor; iptal edilirse (yeniden giriş vb.) alan boş döner ve uyarı kapanır.
      const revokeAtRaw = String(json.scheduledRevokeAtUtc ?? '').trim()
      if (revokeAtRaw) {
        const ms = new Date(revokeAtRaw).getTime()
        setScheduledRevokeAtMs(Number.isFinite(ms) ? ms : null)
      } else {
        setScheduledRevokeAtMs(null)
      }

      // Ortak bitiş bu token'ınkinden farklıysa sunucu yenisini yolluyor; sessizce devralınır.
      const refreshed = String(json.accessToken ?? '').trim()
      if (refreshed) {
        localStorage.setItem('accessToken', refreshed)
        setSessionPopupShownForExp(null)
        setSessionPopupOpen(false)
        refreshSessionExpiryFromToken()
      }
    } catch {
      // Ağ hatası oturumun bittiği anlamına gelmez; kullanıcı atılmaz.
    }
  }



  const forceLogin = () => {

    // Veritabanındaki sepete DOKUNMAZ — bkz. CartContext.resetLocal.
    cart.resetLocal()

    localStorage.removeItem('accessToken')

    localStorage.removeItem('refreshToken')

    localStorage.removeItem('userName')

    sessionStorage.removeItem('userName')

    navigate('/login', { replace: true })

  }



  useEffect(() => {

    const raw = String(localStorage.getItem('ssaViewMode') ?? '').trim().toLowerCase()

    const next = raw === 'tenant' ? 'tenant' : 'global'

    if (next !== ssaViewMode) setSsaViewMode(next)

  }, [location.pathname, ssaViewMode])



  useEffect(() => {

    void (async () => {

      try {

        const token = localStorage.getItem('accessToken')

        if (!token) {

          setPermissionsReady(true)

          return

        }



        const meRes = await fetch(`${API_BASE_URL}/api/auth/me`, {

          headers: {

            ...buildHeaders(true)

          }

        })



        if (meRes.status === 401) {

          forceLogin()

          return

        }



        if (!meRes.ok) {

          const cachedName = localStorage.getItem('userName') || sessionStorage.getItem('userName')

          if (cachedName) setUserName(String(cachedName))

          setPermissionsReady(true)

          return

        }



        const meJson = await meRes.json()

        const me = meJson?.data

        const maybeName = String(me?.username ?? me?.fullName ?? me?.name ?? me?.email ?? '')

        setUserName(maybeName)

        if (maybeName) localStorage.setItem('userName', maybeName)

        const currentCode = String(me?.currentCode ?? me?.CurrentCode ?? '').trim()

        setCurrentCode(currentCode)

        if (currentCode) localStorage.setItem('currentCode', currentCode)

        const salesmanCode = String(me?.salesmanCode ?? me?.SalesmanCode ?? '').trim()

        setSalesmanCode(salesmanCode)

        if (salesmanCode) localStorage.setItem('salesmanCode', salesmanCode)

        const rc = String(me?.roleCode ?? me?.RoleCode ?? '').trim()

        setRoleCode(rc)

        const meIsSuperAdmin = Boolean(me?.isSuperAdmin)
        setIsSuperAdmin(meIsSuperAdmin)
        localStorage.setItem('isSuperAdmin', String(meIsSuperAdmin))

        const meRoleId = Number(me?.roleId ?? 0)
        setUserRoleId(Number.isFinite(meRoleId) && meRoleId > 0 ? meRoleId : null)

        const meDr = me?.discountRate
        setUserDiscountRate(meDr !== undefined && meDr !== null ? Number(meDr) : null)

        const meIsSsa = Boolean(me?.isSuperSuperAdmin)
        setIsSuperSuperAdmin(meIsSsa)
        localStorage.setItem('isSuperSuperAdmin', String(meIsSsa))



        if (meIsSsa) {

          const selectedTenant = localStorage.getItem('tenantCode')

          const isGlobalAllowed =
            location.pathname === '/users/allUsers' ||
            location.pathname === '/users/projeYonetimi' ||
            location.pathname === '/users/onboard'

          if (!selectedTenant && isGlobalAllowed && ssaViewMode === 'tenant') {

            localStorage.setItem('ssaViewMode', 'global')

            setSsaViewMode('global')

          }

          if (!selectedTenant && (!isGlobalAllowed || ssaViewMode === 'tenant')) {

            navigate('/users/projeYonetimi', { replace: true })

            return

          }

        }



        const selectedTenant = String(localStorage.getItem('tenantCode') ?? '').trim()

        if (meIsSsa) {

          setTenantEnabledKeys(null)

        } else if (selectedTenant) {

          try {

            const enabledRes = await fetch(`${API_BASE_URL}/api/pages/enabled-keys`, {

              headers: {

                ...buildHeaders(true),

                'X-Tenant-Code': selectedTenant

              }

            })

            if (enabledRes.ok) {

              const enabledJson = await enabledRes.json()

              const enabledItems = (enabledJson?.data ?? []) as Array<{ moduleKey: string; pageKey: string }>

              const next = new Set<string>()

              enabledItems.forEach((x) => {

                if (!x) return

                const mk = String(x.moduleKey ?? '').trim()

                const pk = String(x.pageKey ?? '').trim()

                if (mk && pk) next.add(`${mk}/${pk}`)

              })

              setTenantEnabledKeys(next)

            } else {

              setTenantEnabledKeys(new Set())

            }

          } catch {

            setTenantEnabledKeys(new Set())

          }

        } else {

          setTenantEnabledKeys(null)

        }



        await refreshSessionSettings()

        if (meIsSsa) {
          setAllowedKeys(new Set())
          setPermissionsReady(true)
          return
        }



        const roleId = Number(me?.roleId)

        if (!Number.isFinite(roleId) || roleId <= 0) {

          setPermissionsReady(true)

          return

        }



        const permRes = await fetch(`${API_BASE_URL}/api/roles/${roleId}/permissions`, {

          headers: {

            ...buildHeaders(true)

          }

        })



        if (permRes.status === 401) {

          forceLogin()

          return

        }



        if (!permRes.ok) {

          setPermissionsReady(true)

          return

        }



        const permJson = await permRes.json()

        const items = (permJson?.data ?? []) as Array<{ moduleKey: string; pageKey: string; canAccess: boolean }>

        const next = new Set<string>()

        items.forEach((x) => {
          if (x?.canAccess) {
            const key = `${x.moduleKey}/${x.pageKey}`;
            next.add(key);
          }
        })

        setAllowedKeys(next)
        localStorage.setItem('allowedKeys', JSON.stringify(Array.from(next)))

        setPermissionsReady(true)

      } catch {

        const cachedName = localStorage.getItem('userName') || sessionStorage.getItem('userName')

        if (cachedName) setUserName(String(cachedName))

        setPermissionsReady(true)

      }

    })()

  }, [location.pathname, navigate])



  useEffect(() => {

    const onSessionSettingsChanged = () => {

      void refreshSessionSettings()

      refreshSessionExpiryFromToken()

      setSessionPopupShownForExp(null)

    }

    window.addEventListener('jwt-session-settings-changed', onSessionSettingsChanged)

    return () => window.removeEventListener('jwt-session-settings-changed', onSessionSettingsChanged)

  }, [])



  useEffect(() => {

    refreshSessionExpiryFromToken()

  }, [location.pathname])



  useEffect(() => {

    const t = window.setInterval(() => {

      const expMs = decodeJwtExpMs(localStorage.getItem('accessToken'))

      setSessionExpiresAtUtcMs(expMs)

      if (!expMs) {

        setSessionRemainingMinutes(null)

        setSessionPopupOpen(false)

        return

      }

      const remainingMin = (expMs - Date.now()) / 60000

      setSessionRemainingMinutes(remainingMin)

      // Süre dolduğunda giriş ekranına düşülür. Eskiden yalnızca uyarı kapanıyordu; kullanıcı
      // her isteğin 401 döndüğü, hiçbir şeyin yüklenmediği bir ekranda kalıyordu.
      if (remainingMin <= 0) {
        forceLogin()
        return
      }



      const alertBefore = sessionAlertBeforeMinutes ?? 3

      if (alertBefore > 0 && remainingMin <= alertBefore && remainingMin > 0) {
        if (sessionPopupShownForExp !== expMs) {
          setSessionPopupOpen(true)
          setSessionPopupShownForExp(expMs)
        }
      }

    }, 1000)

    return () => window.clearInterval(t)

  }, [sessionAlertBeforeMinutes, sessionPopupShownForExp])



  /*
    TOPLU KAPATMA GERİ SAYIMI.

    Saniyede bir kalan süreyi tazeler; sıfıra inince kullanıcıyı çıkarır. Çıkarmayı burada
    yapmak, sunucunun bir sonraki yoklamasını beklemekten daha doğru: kullanıcı ekranda
    "0 saniye" yazarken çalışmaya devam ediyor gibi görünmesin.
  */
  useEffect(() => {
    if (scheduledRevokeAtMs == null) {
      setScheduledRevokeSecondsLeft(0)
      return
    }

    const hesapla = () => {
      const kalan = Math.max(0, Math.ceil((scheduledRevokeAtMs - Date.now()) / 1000))
      setScheduledRevokeSecondsLeft(kalan)
      if (kalan <= 0) forceLogin()
    }

    hesapla()
    const t = window.setInterval(hesapla, 1000)
    return () => window.clearInterval(t)
  }, [scheduledRevokeAtMs])

  // Ortak oturum yoklaması: 20 saniyede bir, ayrıca sekme öne geldiğinde. Uyuyan bir sekme,
  // kullanıcı ona döndüğünde çoktan kapatılmış bir oturumu göstermeye devam etmemeli.
  useEffect(() => {

    void syncSharedSession()

    const t = window.setInterval(() => void syncSharedSession(), 20000)

    const onFocus = () => void syncSharedSession()

    const onVisible = () => {
      if (document.visibilityState === 'visible') void syncSharedSession()
    }

    window.addEventListener('focus', onFocus)

    document.addEventListener('visibilitychange', onVisible)

    return () => {
      window.clearInterval(t)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisible)
    }

  }, [])



  const extendSession = async () => {

    if (sessionExtending) return

    setSessionExtending(true)

    try {

      const tenantCode = String(localStorage.getItem('tenantCode') ?? '').trim()

      const res = await fetch(`${API_BASE_URL}/api/auth/extend-session`, {

        method: 'POST',

        headers: {

          ...buildHeaders(false),

          ...(tenantCode ? { 'X-Tenant-Code': tenantCode } : {})

        }

      })

      if (res.status === 401) {

        forceLogin()

        return

      }

      if (!res.ok) {

        return

      }

      const json = await res.json().catch(() => null)

      const newToken = String(json?.data?.accessToken ?? '').trim()

      if (newToken) {

        localStorage.setItem('accessToken', newToken)

        refreshSessionExpiryFromToken()

        setSessionPopupOpen(false)

      }

    } finally {

      setSessionExtending(false)

    }

  }



  useEffect(() => {

    const fromStorage = String(localStorage.getItem('tenantName') ?? '').trim()

    if (fromStorage !== tenantName) setTenantName(fromStorage)

  }, [location.pathname, tenantName])



  const activeMenuId = useMemo(() => {
    const pathname = location.pathname

    if (pathname === '/home' || pathname.startsWith('/home/')) return 'home'

    const found = Object.entries(menuIdToPath).find(([, path]) => pathname.startsWith(path))

    return found?.[0] ?? 'invoice'
  }, [location.pathname, menuIdToPath])

  const currentActiveMenuId = activeMenuOverride ?? activeMenuId

  useEffect(() => {
    setActiveMenuOverride(null)
  }, [location.pathname])



  const menuTabs = useMemo(() => {

    const invoiceTabs = (

      [

        { id: 'siparis', label: 'Sipariş', icon: ShoppingCart },

        { id: 'satisFatura', label: 'Satış Faturası', icon: Receipt },



        { id: 'faturaDokum', label: 'Fatura Dökümü', icon: FileSpreadsheet },
        { id: 'faturaTakip', label: 'Fatura Takip', icon: Truck },
        { id: 'musteriTeklifi', label: 'Müşteri Teklifi', icon: FileText },

        { id: 'proforma', label: 'Proforma', icon: FileText },
        { id: 'cariTeklifleri', label: 'Cari Müşteri Teklifi', icon: FileText },

        { id: 'bayiTeklifleri', label: 'Cari Proforma', icon: FileText },


        { id: 'etiketFiyatli', label: 'Etiket Basım\nFiyatlı', icon: Printer },

        { id: 'etiketFiyatsiz', label: 'Etiket Basım\nFiyatsız', icon: Printer },


        { id: 'magaza', label: 'Mağaza\nSipariş', icon: ClipboardList },

        { id: 'alis', label: 'Alış\nFaturaları', icon: Receipt },

        { id: 'depoTransfer', label: 'Depo\nTransfer', icon: ArrowLeftRight },

        { id: 'stokHareket', label: 'Stok Hareket\nDökümü', icon: RefreshCw },

        { id: 'depoStock', label: 'Depo Stok\nDurumu', icon: Warehouse },

        { id: 'irsaliye', label: 'Konsinye', icon: FileSpreadsheet },

        { id: 'termin', label: 'Termin', icon: Clock },

        // Garanti değişim (2026-08-14). Fatura kesmez; arızalı ürün garanti deposuna girer,
        // sağlam ürün seçilen depodan çıkar.
        { id: 'garantiDegisim', label: 'Garanti\nDeğişim', icon: ShieldCheck }

      ] as Array<{ id: InvoiceTabId; label: string; icon?: any }>

    ).map((t) => ({

      ...t,

      href: invoiceTabIdToPath[t.id]

    }))



    const cashTabs = [
      { id: 'kasaGirisCikis', label: 'Kasa Giriş/Çıkış', icon: LogIn },
      { id: 'kasalarArasiTransfer', label: 'Kasalar Arası Transfer', icon: ArrowLeftRight },
      { id: 'virmanListesi', label: 'Virman', icon: ArrowLeftRight }
    ].map((t) => ({
      ...t,
      href: `/cash/${t.id}`
    }))

    const posTabs = [
      { id: 'posPayment', label: 'Kredi Kartı ile Ödeme', icon: CreditCard },
      { id: 'posReport', label: 'Kredi Kartı Çekim Raporu', icon: FileSpreadsheet },
      { id: 'taksitOranlari', label: 'Taksit Oranları', icon: FileSpreadsheet }
    ].map((t) => ({
      ...t,
      href: `/pos/${t.id}`
    }))

    const checkTabs = [

      { id: 'customerCheck', label: 'Müşteri Çeki', icon: Receipt },

      { id: 'debtCheck', label: 'Borç Çeki', icon: Receipt },

      { id: 'debtNote', label: 'Borç Seneti', icon: FileText }

    ].map((t) => ({

      ...t,

      href: `/check/${t.id}`

    }))



    const bankTabs = [

      { id: 'bankaHavaleEft', label: 'Banka Havale/EFT', icon: ArrowLeftRight },

      // Taksitli banka kredilerimiz. Sekme anahtarı 'bank/krediler' — rol yetkilerinde de
      // bu adla görünür (bkz. LoanSchema.LoansDdl sayfa seed'i).
      { id: 'krediler', label: 'Krediler', icon: Landmark },

      // Banka Masrafları — POS ve kredi kullanım masraflarının banka hesabı bazlı defteri.
      // Tutarlar hesabın KENDİ para biriminde; kayıt girişi bu ekranda da yapılabilir.
      // Sayfa yetkisi yalnız Yönetim/SuperAdmin'e seed ediliyor (SSA claim'iyle geçer).
      { id: 'bankaMasraflari', label: 'Banka Masrafları', icon: Receipt }

    ].map((t) => ({

      ...t,

      href: `/bank/${t.id}`

    }))



    const reportsTabs = [

      { id: 'cariEkstre', label: 'Cari\nEkstre', icon: FileText },

      { id: 'yonetimEkstre', label: 'Yönetim\nEkstre', icon: FileText },

      { id: 'cariBorcAlacak', label: 'Cari Borç\nAlacak', icon: FileText },

      { id: 'yaslandirma', label: 'Yaşlandırma', icon: FileText },

      { id: 'cariSatisRaporu', label: 'Cari Satış\nRaporu', icon: FileSpreadsheet },

      { id: 'bankaRaporlari', label: 'Banka\nRaporları', icon: CreditCard },

      { id: 'krediVadeTakvimi', label: 'Kredi Vade\nTakvimi', icon: Landmark },

      { id: 'hizmetHarcamaRaporu', label: 'Hizmet\nHarcama', icon: FileSpreadsheet },

      { id: 'kasaRaporlari', label: 'Kasa\nRaporları', icon: Receipt },

      { id: 'virmanRaporlari', label: 'Virman\nRaporları', icon: ArrowLeftRight },

      { id: 'urunSatisRaporuDetayli', label: 'Ürün Satış\nRaporu Detaylı', icon: FileSpreadsheet },

      { id: 'urunSatisRaporuAylik', label: 'Ürün Satış\nRaporu (Aylık)', icon: FileSpreadsheet },

      { id: 'siparisRaporu', label: 'Sipariş\nRaporu', icon: ShoppingCart },

      { id: 'aktifSepetRaporu', label: 'Aktif Sepet\nRaporu', icon: ShoppingCart },

      { id: 'limitRiskSatisRaporu', label: 'Limit Risk\nSatış Raporu', icon: FileSpreadsheet },

      { id: 'muhasebeStokGirisCikisRaporu', label: 'Stok\nGiriş/Çıkış Raporu', icon: Warehouse },
      { id: 'accountingSalesReport', label: 'Muhasebe Satış\nRaporu', icon: FileSpreadsheet },
      { id: 'garantiFormu', label: 'Garanti\nFormu', icon: ShieldCheck },
      { id: 'garantiKayitlari', label: 'Garanti\nKayıtları', icon: FileSpreadsheet },
      // Garanti DEĞİŞİM raporu — yukarıdaki garanti KAYITLARI ile karıştırılmamalı: orası
      // ürünün garanti takibi, burası arızalı ürünün başka ürünle değiştirilmesi.
      { id: 'garantiDegisimRaporu', label: 'Garanti Değişim\nRaporu', icon: ShieldCheck },
      { id: 'satisPazarlamaRaporu', label: 'Satış\nPazarlama Raporu', icon: FileSpreadsheet },

      { id: 'fiyatListesi', label: 'Fiyat\nListesi', icon: Tags }

    ].map((t) => ({

      ...t,

      href: t.id === 'siparisRaporu' ? '/reports/order-report' : `/reports/${t.id}`

    }))



    const usersTabs = (() => {

      const selectedTenant = String(localStorage.getItem('tenantCode') ?? '').trim()

      const base = [

        ...(isSuperSuperAdmin

          ? ssaViewMode === 'tenant'

            ? [{ id: 'kullaniciListesi', label: 'Kullanıcı Listesi', icon: Users }]

            : [{ id: 'allUsers', label: 'Tüm Kullanıcılar', icon: Users }]

          : [{ id: 'kullaniciListesi', label: 'Kullanıcı Listesi', icon: Users }]),

        { id: 'genelAyarlar', label: 'Genel Ayarlar', icon: Clock },

        { id: 'kampanya', label: 'Kampanya Tanım', icon: Tags },

        { id: 'topluFiyatAtama', label: 'Toplu Fiyat Atama', icon: Tags },

        { id: 'kasalarim', label: 'Kasalarım', icon: Wallet },

        { id: 'depolar', label: 'Depolar', icon: Warehouse },

        // Arızalı ürünlerin toplandığı depo. Tek ayar; varsayılan olarak yalnızca SuperAdmin
        // rolüne açık (bkz. WarrantyExchangeSchema rol yetkisi seed'i).
        { id: 'garantiDeposu', label: 'Garanti Deposu', icon: ShieldCheck },

        { id: 'subeler', label: 'Şube Tanımları', icon: Building2 },

        { id: 'bankaHesapTanim', label: 'Banka Hesap Tanım', icon: CreditCard },

        { id: 'posHesapAyar', label: 'POS Hesap Ayarları', icon: CreditCard },

        { id: 'posAktarim', label: 'POS Aktarım', icon: CreditCard },

        { id: 'rolYetkileri', label: 'Rol Yetkileri', icon: Users },

        ...(isSuperSuperAdmin
          ? [
              ...(ssaViewMode === 'global' ? [{ id: 'projeYonetimi', label: 'Proje Yönetimi', icon: FileText }] : []),
              ...(!selectedTenant && ssaViewMode === 'global' ? [{ id: 'onboard', label: 'Onboard', icon: BarChart3 }] : [])
            ]
          : []),

        { id: 'kategoriYonetimi', label: 'Kategori Yönetimi', icon: Tags },

        { id: 'urunYonetimi', label: 'Ürün Yönetimi', icon: Package },

        { id: 'atiliFiyatlandirma', label: 'Fiyat Atama', icon: FileSpreadsheet },

        { id: 'fiyatKategorileri', label: 'Fiyat Kategorileri', icon: Tags },

        { id: 'cariEkle', label: 'Cari Ekle', icon: FileSpreadsheet },

        { id: 'tedarikciEkle', label: 'Tedarikçi Ekle', icon: Truck },

        { id: 'silinenKayitlar', label: 'Silinen Kayıtlar', icon: FileText },
        { id: 'installmentRules', label: 'Taksit Bilgileri', icon: FileSpreadsheet },
        { id: 'userActivities', label: 'Kullanıcı Hareketleri', icon: Activity },
        { id: 'maliDonemler', label: 'Mali Dönemler', icon: Calendar },
        { id: 'systemErrorLogs', label: 'Hata Logları', icon: AlertTriangle },
        { id: 'sistemDenetimi', label: 'Sistem Denetimi', icon: ClipboardList }
      ]


      if (isSuperSuperAdmin && !selectedTenant) {

        const allowed = new Set<string>(['projeYonetimi', 'onboard', ssaViewMode === 'tenant' ? 'kullaniciListesi' : 'allUsers'])

        return base.filter((x) => allowed.has(x.id))

      }



      return base

    })()



    // Mağaza yönetimi bayi panelinin içinde: ikinci bir admin paneli açmak, ikinci bir yetki
    // modeli ve ikinci bir şifre demekti. Yetkiler buradaki rol sisteminden geliyor.
    const eticaretTabs = [
      // E-TİCARET SAYFALARI (2026-09-21): tek dev "Vitrin Yönetimi" formu ayrı sayfalara
      // dağıtıldı. Her anahtar ERP'de Pages(ModuleKey='eticaret') satırı — Rol Yetkileri'nden
      // açılır/kapanır; burada hardcode yetki yok. Sıra: günlük iş önce, ayarlar sonda.
      { id: 'siparisler', label: 'Siparişler', icon: ShoppingCart },
      { id: 'uyeler', label: 'Üyeler', icon: Users },
      { id: 'urunYayin', label: 'Ürün Yönetimi', icon: Package },
      { id: 'kampanyalar', label: 'Kampanyalar', icon: Gift },
      { id: 'arama', label: 'Talep Raporu', icon: Search },
      { id: 'analitik', label: 'Ziyaret Analizi', icon: TrendingUp },
      { id: 'gorseller', label: 'Görseller', icon: ImageIcon },
      { id: 'kataloglar', label: 'Kataloglar', icon: FileText },
      { id: 'sayfalar', label: 'İçerik\nSayfaları', icon: FileText },
      { id: 'kategoriler', label: 'Kategoriler', icon: Tags },
      { id: 'vitrin', label: 'Anasayfa &\nVitrin', icon: Layout },
      { id: 'firmaBilgileri', label: 'Firma &\nİletişim', icon: Building2 },
      { id: 'odeme', label: 'Ödeme &\nHavale', icon: Landmark },
      { id: 'pazarlama', label: 'Pazarlama &\nGüven', icon: Megaphone },
      { id: 'mutabakat', label: 'Mutabakat', icon: ShieldCheck }
    ].map((t) => ({ ...t, href: `/eticaret/${t.id}` }))

    const usersTabsWithHref = usersTabs.map((t) => ({

      ...t,

      href: `/users/${t.id}`

    }))



    const placeholder = (prefix: string) => [

      { id: `${prefix}-1`, label: 'Liste', icon: ClipboardList },

      { id: `${prefix}-2`, label: 'Tanım', icon: FileText },

      { id: `${prefix}-3`, label: 'Transfer', icon: Truck },

      { id: `${prefix}-4`, label: 'Stok', icon: Package }

    ]



    const serviceBase = serviceOpsBaseUrl()
    const serviceTabs = [
      { id: 'dashboard', label: 'Dashboard', icon: ClipboardList, path: '/' },
      { id: 'montajKabul', label: 'Montaj Kabul', icon: Package, path: '/montaj-kabul' },
      { id: 'montajYonetimi', label: 'Montaj Yönetimi', icon: AlertTriangle, path: '/montaj-yonetimi' },
      { id: 'buyukEvAletleriKabul', label: 'Büyük Ev Aletleri Kabul', icon: Package, path: '/buyuk-urun-kabul' },
      { id: 'buyukUrun', label: 'Büyük Ürün', icon: MapPin, path: '/saha-ariza' },
      { id: 'kucukUrunKabul', label: 'Küçük Ev Aletleri Kabul', icon: Package, path: '/kucuk-urun-kabul' },
      { id: 'atolyeAriza', label: 'Küçük Ürün', icon: Wrench, path: '/atolye-ariza' },
      { id: 'kargoTakibi', label: 'Kargo Takibi', icon: Package, path: '/kargo-takibi' },
      { id: 'kargoPlanlama', label: 'Kargo Planlama', icon: Calendar, path: '/kargo-planlama' },
      { id: 'teknisyenler', label: 'Teknisyenler', icon: Users, path: '/teknisyenler' },
      { id: 'rota', label: 'Rota', icon: MapPin, path: '/rota' },
      { id: 'musteriler', label: 'Müşteriler / Bayiler', icon: Building2, path: '/musteriler' },
      { id: 'stok', label: 'Stok', icon: Warehouse, path: '/stok' },
      { id: 'aracDepolari', label: 'Araç Depoları (Satış)', icon: Warehouse, path: '/arac-depolari' },
      { id: 'hakedis', label: 'Hakediş', icon: Wallet, path: '/hakedis' },
      { id: 'silinenKayitlar', label: 'Silinen Kayıtlar', icon: FileText, path: '/silinen-kayitlar' },
      { id: 'teknisyenTakip', label: 'Teknisyen Takip', icon: MapPin, path: '/teknisyen-takip' },
      { id: 'teknisyenNotu', label: 'Teknisyen Notu', icon: MessageCircle, path: '/teknisyen-notu' },
      { id: 'bildirimler', label: 'Bildirimler', icon: Bell, path: '/bildirimler' },
      { id: 'raporlar', label: 'Raporlar', icon: FileText, path: '/raporlar' },
      { id: 'analiz', label: 'Analiz', icon: BarChart3, path: '/analiz' },
      { id: 'ayarlar', label: 'Ayarlar', icon: Settings, path: '/ayarlar' }
    ].map((t) => {
      return {
        ...t,
        href: buildServiceOpsUrl(t.path)
      }
    })

    // Bildirimler menüsünün sekmeleri. Sekme kimlikleri Pages tablosundaki Key'lerle birebir:
    // yetki süzgeci `${menuId}/${tabId}` kurar, yani 'bildirimler/bildirimlerGelen'.
    const bildirimlerTabs = [
      { id: 'bildirimlerGelen', label: 'Gelen Bildirimler', icon: Bell },
      { id: 'bildirimlerGonder', label: 'Bildirim Gönder', icon: Bell }
    ]

    return {
      invoice: invoiceTabs,
      pos: posTabs,
      cash: cashTabs,
      check: checkTabs,
      bank: bankTabs,
      reports: reportsTabs,
      service: serviceTabs,
      eticaret: eticaretTabs,
      bildirimler: bildirimlerTabs,
      users: usersTabsWithHref
    } as Record<string, { id: string; label: string; icon?: any; href?: string }[]>
  }, [isSuperSuperAdmin, ssaViewMode])



  const allTabs = useMemo(() => menuTabs[currentActiveMenuId] ?? [], [menuTabs, currentActiveMenuId])



  const tabs = useMemo(() => {
    if (!permissionsReady) return allTabs
    if (currentActiveMenuId === 'service') return allTabs

    const base = isSuperSuperAdmin ? allTabs : allTabs.filter((t) => {
      const key = `${currentActiveMenuId}/${t.id}`
      if (key === 'cash/virmanListesi') {
        return allowedKeys.has('cash/virmanListesi') || allowedKeys.has('virman/virmanListesi')
      }
      return allowedKeys.has(key)
    })

    if (currentActiveMenuId === 'users' && isSuperSuperAdmin && ssaViewMode === 'global') {
      return base
    }

    if (tenantEnabledKeys === null) return base

    if (currentActiveMenuId === 'users' && isSuperSuperAdmin) {
      const always = new Set<string>(['onboard', 'projeYonetimi', 'allUsers', 'kullaniciListesi', 'subeler'])
      return base.filter((t) => always.has(String(t.id)) || tenantEnabledKeys.has(`${currentActiveMenuId}/${t.id}`))
    }

    return base.filter((t) => String(t.id) === 'subeler' || tenantEnabledKeys.has(`${currentActiveMenuId}/${t.id}`))
  }, [currentActiveMenuId, allTabs, allowedKeys, isSuperSuperAdmin, permissionsReady, ssaViewMode, tenantEnabledKeys])

  const actualUrlTabs = useMemo(() => {
    if (!permissionsReady) return menuTabs[activeMenuId] ?? []
    if (activeMenuId === 'service') return menuTabs[activeMenuId] ?? []

    const allUrlTabs = menuTabs[activeMenuId] ?? []
    const base = isSuperSuperAdmin ? allUrlTabs : allUrlTabs.filter((t) => {
      const key = `${activeMenuId}/${t.id}`
      if (key === 'cash/virmanListesi') {
        return allowedKeys.has('cash/virmanListesi') || allowedKeys.has('virman/virmanListesi')
      }
      return allowedKeys.has(key)
    })

    if (activeMenuId === 'users' && isSuperSuperAdmin && ssaViewMode === 'global') {
      return base
    }

    if (tenantEnabledKeys === null) return base

    if (activeMenuId === 'users' && isSuperSuperAdmin) {
      const always = new Set<string>(['onboard', 'projeYonetimi', 'allUsers', 'kullaniciListesi', 'subeler'])
      return base.filter((t) => always.has(String(t.id)) || tenantEnabledKeys.has(`${activeMenuId}/${t.id}`))
    }

    return base.filter((t) => String(t.id) === 'subeler' || tenantEnabledKeys.has(`${activeMenuId}/${t.id}`))
  }, [activeMenuId, menuTabs, allowedKeys, isSuperSuperAdmin, permissionsReady, ssaViewMode, tenantEnabledKeys])

  const filteredMenuTabs = useMemo(() => {
    if (!permissionsReady) return menuTabs

    const result: Record<string, { id: string; label: string; icon?: any; href?: string }[]> = {}

    for (const [modId, rawTabList] of Object.entries(menuTabs)) {
      if (modId === 'service') {
        result[modId] = rawTabList
        continue
      }

      const base = isSuperSuperAdmin
        ? rawTabList
        : rawTabList.filter((t) => {
            const key = `${modId}/${t.id}`
            if (key === 'cash/virmanListesi') {
              return allowedKeys.has('cash/virmanListesi') || allowedKeys.has('virman/virmanListesi')
            }
            return allowedKeys.has(key)
          })

      if (tenantEnabledKeys === null) {
        result[modId] = base
        continue
      }

      if (modId === 'users' && isSuperSuperAdmin) {
        if (ssaViewMode === 'global') {
          result[modId] = base
          continue
        }
        const always = new Set<string>(['onboard', 'projeYonetimi', 'allUsers', 'kullaniciListesi', 'subeler'])
        result[modId] = base.filter((t) => always.has(String(t.id)) || tenantEnabledKeys.has(`${modId}/${t.id}`))
        continue
      }

      result[modId] = base.filter((t) => String(t.id) === 'subeler' || tenantEnabledKeys.has(`${modId}/${t.id}`))
    }

    return result
  }, [menuTabs, permissionsReady, isSuperSuperAdmin, allowedKeys, tenantEnabledKeys, ssaViewMode])

  const isPathUnauthorized = useMemo(() => {
    if (!permissionsReady) return false
    if (isSuperSuperAdmin) return false

    const p = location.pathname.toLowerCase()

    if (activeMenuId !== 'home' && activeMenuId !== 'service') {
      const groupTabs = menuTabs[activeMenuId]
      if (groupTabs && groupTabs.length > 0) {
        if (actualUrlTabs.length === 0) {
          return true
        }

        const normalize = (s: string) => s.replace(/\/$/, '')
        const normalizedP = normalize(p)
        const isBasePath = normalizedP === `/${activeMenuId}` || normalizedP === '/virman'

        const hasMatch = actualUrlTabs.some((t) => {
          if (!t.href) return false
          const normalizedHref = normalize(t.href.toLowerCase())
          return normalizedP === normalizedHref || normalizedP.startsWith(normalizedHref + '/')
        })

        if (!isBasePath && !hasMatch) {
          return true
        }
      }
    }

    return false
  }, [permissionsReady, isSuperSuperAdmin, location.pathname, activeMenuId, tabs, menuTabs, actualUrlTabs])



  const assistantMenuOptions = useMemo(() => {
    if (!permissionsReady) return [] as Array<{ id: string; label: string }>

    const base = isSuperSuperAdmin
      ? menuItems
      : menuItems.filter((m) => {
          if (m.id === 'service') return true
          const prefix = `${m.id}/`
          for (const k of allowedKeys) {
            if (k.startsWith(prefix)) return true
            if (m.id === 'cash' && k === 'virman/virmanListesi') return true
          }
          return false
        })

    if (tenantEnabledKeys === null) return base

    return base.filter((m) => {
      if (m.id === 'service') return true
      const prefix = `${m.id}/`
      for (const k of tenantEnabledKeys) {
        if (k.startsWith(prefix)) return true
      }
      return false
    })
  }, [allowedKeys, isSuperSuperAdmin, menuItems, permissionsReady, tenantEnabledKeys])



  const assistantPageOptions = useMemo(() => {

    if (!permissionsReady) return [] as Array<{ key: string; label: string }>

    if (!assistantSelectedMenuId) return [] as Array<{ key: string; label: string }>



    const menuId = assistantSelectedMenuId

    const menuLabel = menuItems.find((x) => x.id === menuId)?.label ?? menuId



    const list = (menuTabs as Record<string, Array<{ id: string; label: string }>>)[menuId] ?? []



    const out: Array<{ key: string; label: string }> = []

    for (const t of list) {

      const key = `${menuId}/${String(t.id ?? '')}`

      const hasPermission = isSuperSuperAdmin || 
                            allowedKeys.has(key) || 
                            (key === 'cash/virmanListesi' && allowedKeys.has('virman/virmanListesi'))
      if (!hasPermission) continue

      if (tenantEnabledKeys !== null && !tenantEnabledKeys.has(key)) continue

      out.push({ key, label: `${menuLabel} / ${String(t.label ?? '')}` })

    }



    out.sort((a, b) => a.label.localeCompare(b.label, 'tr'))

    return out

  }, [allowedKeys, assistantSelectedMenuId, isSuperSuperAdmin, menuItems, menuTabs, permissionsReady, tenantEnabledKeys])



  const getAssistantInfoText = (pageKey: string) => {

    const item = assistantKnowledgeBase.items?.[pageKey]

    if (item?.description) return item.description

    return 'Bu sayfa için özet bilgi yakında eklenecek.'

  }

  const askAssistant = async (args: {
    pageKey?: string | null
    pageLabel?: string
    question: string
  }) => {
    const pageKey = String(args.pageKey ?? '').trim()
    const kbItem = pageKey ? assistantKnowledgeBase.items?.[pageKey] : undefined
    const pageTitle = String(kbItem?.title ?? '').trim()
    const pageDescription = String(kbItem?.description ?? '').trim()

    const question = String(args.question ?? '').trim()
    if (!question) return

    const loadingId = `${Date.now()}_${Math.random().toString(16).slice(2)}`
    const userText = String(args.pageLabel ?? question).trim() || question

    setAssistantMessages((prev) => [
      ...prev,
      { id: `${loadingId}_user`, role: 'user', text: userText },
      { id: loadingId, role: 'bot', text: 'Yanıt hazırlanıyor...' }
    ])

    try {
      const tenantCode = String(localStorage.getItem('tenantCode') ?? '').trim()
      const res = await fetch(`${API_BASE_URL}/api/assistant/chat`, {
        method: 'POST',
        headers: {
          ...buildHeaders(true),
          ...(tenantCode ? { 'X-Tenant-Code': tenantCode } : {})
        },
        body: JSON.stringify({
          pageKey,
          pageTitle,
          pageDescription,
          question
        })
      })

      const data = await res.json().catch(() => null)
      const ok = res.ok && data?.success
      const answer = ok ? String(data?.answer ?? '').trim() : ''
      const errorText = String(data?.error ?? '').trim()

      setAssistantMessages((prev) =>
        prev.map((m) => {
          if (m.id !== loadingId) return m
          if (ok && answer) return { ...m, text: answer }
          if (ok) return { ...m, text: 'Boş yanıt alındı. Lütfen tekrar deneyin.' }
          return { ...m, text: errorText || 'Asistan yanıt üretemedi. Lütfen tekrar deneyin.' }
        })
      )
    } catch (e: any) {
      setAssistantMessages((prev) =>
        prev.map((m) => (m.id === loadingId ? { ...m, text: String(e?.message ?? 'İstek sırasında hata oluştu.') } : m))
      )
    }
  }

  const askAssistantForPage = async (pageKey: string, pageLabel: string) => {
    setAssistantSelectedPageKey(pageKey)
    await askAssistant({
      pageKey,
      pageLabel,
      question: 'Bu sayfayı, programı hiç bilmeyen bir kullanıcıya tek paragrafta öğretici şekilde açıkla.'
    })
  }

  const filteredMenuItems = useMemo(() => {
    if (!permissionsReady) return menuItems

    const base = isSuperSuperAdmin
      ? menuItems
      : menuItems.filter((m) => {
          if (m.id === 'service') return true
          const prefix = `${m.id}/`
          for (const k of allowedKeys) {
            if (k.startsWith(prefix)) return true
            if (m.id === 'cash' && k === 'virman/virmanListesi') return true
          }
          return false
        })

    if (tenantEnabledKeys === null) return base

    return base.filter((m) => {
      if (m.id === 'service') return true
      const prefix = `${m.id}/`
      for (const k of tenantEnabledKeys) {
        if (k.startsWith(prefix)) return true
      }
      return false
    })
  }, [allowedKeys, isSuperSuperAdmin, menuItems, permissionsReady, tenantEnabledKeys])



  const [activeTabIdState, setActiveTabIdState] = useState<string | undefined>(undefined)



  const activeTabId = useMemo(() => {

    if (activeMenuId === 'invoice') return pathToInvoiceTabId(location.pathname) ?? undefined

    if (activeMenuId === 'reports') {

      const p = location.pathname

      if (p === '/reports' || p === '/reports/') return undefined

      if (p.startsWith('/reports/')) {

        const seg = p.slice('/reports/'.length).split('/')[0]

        if (!seg) return undefined

        if (seg === 'order-report') return 'siparisRaporu'

        return seg

      }

      return undefined

    }

    if (activeMenuId === 'users') {

      const p = location.pathname

      if (p === '/users' || p === '/users/') return undefined

      if (p.startsWith('/users/')) {

        const seg = p.slice('/users/'.length).split('/')[0]

        return seg || undefined

      }

      return undefined

    }

    if (activeMenuId === 'pos') {

      const p = location.pathname

      if (p === '/pos' || p === '/pos/') return undefined

      if (p.startsWith('/pos/')) {

        const seg = p.slice('/pos/'.length).split('/')[0]

        return seg || undefined

      }

      return undefined

    }

    if (activeMenuId === 'cash') {
      const p = location.pathname
      if (p === '/cash' || p === '/cash/') return undefined
      if (p.startsWith('/cash/')) {
        const seg = p.slice('/cash/'.length).split('/')[0]
        return seg || undefined
      }
      if (p.startsWith('/virman/')) {
        return 'virmanListesi'
      }
      return undefined
    }

    if (activeMenuId === 'check') {

      const p = location.pathname

      if (p === '/check' || p === '/check/') return undefined

      if (p.startsWith('/check/')) {

        const seg = p.slice('/check/'.length).split('/')[0]

        return seg || undefined

      }

      return undefined

    }

    if (activeMenuId === 'bank') {

      const p = location.pathname

      if (p === '/bank' || p === '/bank/') return undefined

      if (p.startsWith('/bank/')) {

        const seg = p.slice('/bank/'.length).split('/')[0]

        return seg || undefined

      }

      return undefined

    }

    /*
     * E-TİCARET SEKMESİ ADRESTEN OKUNUR.
     *
     * Eskiden bu blok yoktu ve e-ticaret sekmesi yalnızca `activeTabIdState`'ten geliyordu.
     * İki ayrı yoldan bozuluyordu:
     *
     *  1. Sayfa yenilendiğinde state sıfırlanıyor, `EticaretPage` içindeki
     *     `activeTabId || 'vitrin'` devreye giriyor ve kullanıcı hangi ekranda olursa olsun
     *     Vitrin Yönetimi'ne düşüyordu.
     *  2. Daha kötüsü: aşağıdaki "ilk sekmeye git" etkisinin bağımlılıklarında
     *     `location.pathname` var ve etki, adres her değiştiğinde sonunda
     *     `setActiveTabIdState(tabs[0].id)` çalıştırıyor. Yani Siparişler'e geçmek bile
     *     state'i 'vitrin'e geri çeviriyordu — "bazı ekranlar sürekli Vitrin Yönetimi'ne
     *     dönüyor" şikayetinin kaynağı buydu.
     *
     * Adres tek kaynak olunca ikisi de kapanıyor; fatura, rapor, kasa gibi diğer menülerde
     * zaten uygulanan desenin aynısı.
     */
    if (activeMenuId === 'eticaret') {

      const p = location.pathname

      if (p === '/eticaret' || p === '/eticaret/') return undefined

      if (p.startsWith('/eticaret/')) {

        const seg = p.slice('/eticaret/'.length).split('/')[0]

        return seg || undefined

      }

      return undefined

    }

    return activeTabIdState

  }, [activeMenuId, activeTabIdState, location.pathname])

  const hideChrome = useMemo(() => {
    if (!permissionsReady) return false
    const selectedTenant = String(localStorage.getItem('tenantCode') ?? '').trim()
    return Boolean(isSuperSuperAdmin) && ssaViewMode === 'global' && !selectedTenant
  }, [isSuperSuperAdmin, permissionsReady, ssaViewMode])



  const parseQuery = (search: string) => {

    const p = new URLSearchParams(search)

    return {

      q: String(p.get('q') ?? '').trim()

    }

  }







  useEffect(() => {

    if (!permissionsReady) return

    if (isPathUnauthorized) return

    if (activeMenuOverride !== null) return // Skip redirects if menu is overridden

    if (activeMenuId === 'invoice') {
      const first = tabs[0]?.id as InvoiceTabId | undefined
      if (!first) return
      const p = location.pathname
      if (p === '/invoice' || p === '/invoice/') {
        navigate(invoiceTabIdToPath[first], { replace: true })
        return
      }
      if (p.startsWith('/invoice/')) {
        const currentTabId = pathToInvoiceTabId(p)
        if (!currentTabId || !tabs.some((t) => t.id === currentTabId)) {
          navigate(invoiceTabIdToPath[first], { replace: true })
        }
      }
      return
    }

    if (activeMenuId === 'reports') {

      const first = tabs[0]?.id

      if (!first) return

      const p = location.pathname

      if (p === '/reports' || p === '/reports/') {

        if (first === 'siparisRaporu') {

          navigate('/reports/order-report', { replace: true })

          return

        }

        navigate(`/reports/${first}`, { replace: true })

        return

      }

      if (p.startsWith('/reports/')) {
        const currentReportId = p.slice('/reports/'.length).split('/')[0]
        const currentReportTabId = currentReportId === 'order-report' ? 'siparisRaporu' : currentReportId
        if (!tabs.some((t) => t.id === currentReportTabId)) {
          if (first === 'siparisRaporu') {
            navigate('/reports/order-report', { replace: true })
          } else {
            navigate(`/reports/${first}`, { replace: true })
          }
        }
      }

      return

    }

    if (activeMenuId === 'users') {

      const first = tabs[0]?.id

      if (!first) return

      const p = location.pathname

      if (p === '/users' || p === '/users/') {

        navigate(`/users/${first}`, { replace: true })

        return

      }

      if (p.startsWith('/users/')) {

        const seg = p.slice('/users/'.length).split('/')[0]

        const selectedTenant = String(localStorage.getItem('tenantCode') ?? '').trim()
        if (selectedTenant && seg === 'onboard') {
          navigate(`/users/${first}`, { replace: true })
          return
        }

        const ok = seg === 'onboard' ? true : tabs.some((t) => t.id === seg)
        if (!ok) {
          navigate(`/users/${first}`, { replace: true })
        }

      }

      return

    }



    const first = tabs[0]

    if (first?.href) {
      if (
        location.pathname === `/${activeMenuId}` ||
        location.pathname === `/${activeMenuId}/` ||
        location.pathname === '/virman' ||
        location.pathname === '/virman/'
      ) {
        const isExternal = first.href.startsWith('http://') || first.href.startsWith('https://')
        if (isExternal) {
          window.location.replace(first.href)
        } else {
          navigate(first.href, { replace: true })
        }
        return
      }
    }

    setActiveTabIdState(first?.id)

  }, [activeMenuId, location.pathname, navigate, permissionsReady, tabs])



  useEffect(() => {

    if (!permissionsReady) return

    if (isPathUnauthorized) return



    if (activeMenuId === 'home') return



    if (!isSuperAdmin) {

      const canSeeActiveMenu = filteredMenuItems.some((x) => x.id === activeMenuId)

      if (!canSeeActiveMenu && filteredMenuItems.length > 0) {

        const fallbackMenuId = filteredMenuItems[0].id

        // ServiceOps is a different origin, so it needs the session in the URL and a full
        // page load — react-router's navigate() would try to treat it as an internal path.
        if (fallbackMenuId === 'service') {

          window.location.assign(buildServiceOpsUrl())

          return

        }

        const to = (menuIdToPath as Record<string, string>)[fallbackMenuId]

        if (to) {

          navigate(to)

          return

        }

      }

    }

  }, [activeMenuId, filteredMenuItems, isSuperAdmin, menuIdToPath, navigate, permissionsReady])



  if (!permissionsReady || showSplash) {
    const cachedLogo = localStorage.getItem('tenantLogoUrl') || '/s-logo-white.png'
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#8F2500] via-[#C83200] to-[#E63900] flex flex-col items-center justify-center px-4 font-outfit relative overflow-hidden">
        <style dangerouslySetInnerHTML={{__html: `
          @import url('https://fonts.googleapis.com/css2?family=Caveat:wght@500;700&family=Dancing+Script:wght@700&display=swap');
          .loading-handwriting {
            font-family: 'Caveat', 'Dancing Script', cursive;
          }
          .glow-pulse-white {
            animation: glowPulseWhite 2s infinite ease-in-out;
          }
          @keyframes glowPulseWhite {
            0%, 100% {
              filter: drop-shadow(0 0 15px rgba(255, 255, 255, 0.4));
              transform: scale(1);
            }
            50% {
              filter: drop-shadow(0 0 30px rgba(255, 255, 255, 0.8));
              transform: scale(1.05);
            }
          }
        `}} />

        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-white/10 rounded-full blur-[100px] pointer-events-none" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-white/5 rounded-full blur-[100px] pointer-events-none" />

        <div className="relative mb-8 z-10 flex flex-col items-center">
          <div className="w-48 h-48 rounded-[2.5rem] bg-white/10 border border-white/20 backdrop-blur-xl flex items-center justify-center p-8 shadow-2xl glow-pulse-white transition-transform duration-500">
            {cachedLogo ? (
              <img
                src={cachedLogo}
                alt="STILSOFT"
                className="w-full h-full object-contain filter brightness-0 invert"
                onError={(e) => {
                  e.currentTarget.style.display = 'none';
                }}
              />
            ) : (
              <span className="text-white text-5xl font-black">S</span>
            )}
          </div>
        </div>

        <div className="text-center z-10">
          <p className="loading-handwriting text-white text-7xl font-extrabold tracking-wide drop-shadow-lg">
            bayi
          </p>
        </div>

        <div className="w-48 h-1 bg-white/20 rounded-full overflow-hidden mt-8 max-w-xs z-10 border border-white/10">
          <div className="h-full bg-white rounded-full w-2/3 animate-[loadingProgress_1.5s_infinite_ease-in-out]"></div>
        </div>

        <style dangerouslySetInnerHTML={{__html: `
          @keyframes loadingProgress {
            0% { transform: translateX(-100%); }
            100% { transform: translateX(150%); }
          }
        `}} />
      </div>
    )
  }

  return (

    <div className="min-h-screen bg-white">

      <SessionExpiryPopup
        isOpen={sessionPopupOpen}
        remainingMinutes={sessionRemainingMinutes ?? 0}
        expiresAtLabel={sessionExpiresAtUtcMs ? formatHm(sessionExpiresAtUtcMs) : '-'}
        extending={sessionExtending}
        onExtend={() => void extendSession()}
        onClose={() => setSessionPopupOpen(false)}
      />

      {/*
        TOPLU KAPATMA UYARISI (2026-09-05).

        Kapatılamaz ve "Uzat" düğmesi YOKTUR: bu, süre dolması değil yöneticinin kararıdır;
        kullanıcının erteleyebilmesi işlemi anlamsız kılardı. Tek amacı, kişinin işini
        kaydedecek kadar önceden haberdar olması.
      */}
      {scheduledRevokeAtMs != null && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-slate-900/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-red-200 bg-white shadow-2xl overflow-hidden">
            <div className="bg-red-600 px-5 py-3">
              <h3 className="text-sm font-black uppercase tracking-wide text-white">
                Oturumunuz kapatılıyor
              </h3>
            </div>
            <div className="p-5 text-center">
              <div className="text-5xl font-black tabular-nums text-red-600">
                {scheduledRevokeSecondsLeft}
              </div>
              <div className="mt-1 text-xs font-bold uppercase tracking-wide text-gray-500">saniye</div>
              <p className="mt-4 text-sm text-gray-700 leading-relaxed">
                Yönetici tüm kullanıcıları programdan düşürüyor. Kaydedilmemiş bir işiniz varsa
                <b> hemen kaydedin</b>; süre dolunca giriş ekranına yönlendirileceksiniz.
              </p>
              <p className="mt-3 text-[11px] text-gray-500">
                Sonrasında tekrar giriş yapabilirsiniz.
              </p>
            </div>
          </div>
        </div>
      )}
      {activePopupNotification && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm transition-all duration-300">
          <div className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden transform scale-100 transition-all m-4">
            <div className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2 rounded-xl bg-indigo-50 text-indigo-600">
                  <Bell className="w-6 h-6 animate-bounce" />
                </div>
                <div>
                  <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Yeni Mesaj / Bildirim</span>
                  <h3 className="text-lg font-bold text-slate-800 line-clamp-1">{activePopupNotification.title}</h3>
                </div>
              </div>
              
              <div className="bg-slate-50/50 rounded-xl p-4 border border-slate-100 mb-6 max-h-60 overflow-y-auto">
                <p className="text-sm text-slate-600 whitespace-pre-wrap leading-relaxed">
                  {activePopupNotification.content}
                </p>
              </div>

              <div className="flex items-center justify-between text-xs text-slate-400 mb-6">
                <span>Gönderen: <strong className="text-slate-600">{activePopupNotification.senderName || activePopupNotification.createUser}</strong></span>
                <span>{new Date(activePopupNotification.createTime).toLocaleDateString('tr-TR', { hour: '2-digit', minute: '2-digit' })}</span>
              </div>

              <button
                type="button"
                onClick={() => void handleDismissPopup(activePopupNotification.id)}
                className="w-full h-11 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-xl shadow-md shadow-indigo-600/10 hover:shadow-indigo-600/20 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
              >
                Tamam, Okudum
              </button>
            </div>
          </div>
        </div>
      )}
      {!hideChrome && (
        <Header
          items={filteredMenuItems.map((x) => ({
            ...x,
            href: x.id === 'service' ? buildServiceOpsUrl() : ((menuIdToPath as any)?.[x.id] || '/')
          }))}
          activeId={currentActiveMenuId}
          menuTabs={filteredMenuTabs}
          activeSubId={activeTabId}
          onNavigate={navigate}
          onSelect={(id) => {
            setActiveMenuOverride(id)
          }}
          onHome={() => navigate('/home')}
          userInitial={(userName?.[0] ?? 'A').toUpperCase()}
          userName={userName}
          tenantName={tenantName}
          tenantLogoUrl={tenantLogoUrl ?? undefined}
          headerGradientFrom={headerGradientFrom ?? undefined}
          headerGradientTo={headerGradientTo ?? undefined}

          showEcommercePanel={Boolean(isEcommerceEnabled)}
          showBackToProjeYonetimi={
            Boolean(isSuperSuperAdmin) &&
            ssaViewMode === 'tenant' &&
            Boolean(String(localStorage.getItem('tenantCode') ?? '').trim())
          }
          onBackToProjeYonetimi={() => {
            localStorage.setItem('ssaViewMode', 'global')
            localStorage.removeItem('tenantCode')
            localStorage.removeItem('tenantName')
            setSsaViewMode('global')
            navigate('/users/projeYonetimi', { replace: true })
          }}
          sessionRemainingLabel={
            sessionRemainingMinutes == null
              ? undefined
              : `${Math.max(0, Math.floor(sessionRemainingMinutes))} dk`
          }
          sessionExpiresAtLabel={sessionExpiresAtUtcMs ? formatHm(sessionExpiresAtUtcMs) : undefined}
          onProfile={() => {
            const path = menuIdToPath.users
            navigate(path)
          }}
          onLogout={() => void handleLogout()}
          isSuperAdmin={isSuperAdmin || isSuperSuperAdmin}
          allowedKeys={allowedKeys}
        />
      )}

      <div className={hideChrome ? '' : 'pt-[64px]'}>
        {!hideChrome && (
          <SubNavigation
            tabs={tabs}
            activeId={activeTabId}
            onSelect={(id) => {
              if (currentActiveMenuId === 'invoice') {
                const tabId = id as InvoiceTabId
                const to = invoiceTabIdToPath[tabId]
                if (to) {
                  navigate(to)
                  return
                }
                return
              }

              if (currentActiveMenuId === 'pos') {
                navigate(`/pos/${id}`)
                return
              }

              if (currentActiveMenuId === 'cash') {
                if (id === 'virmanListesi') {
                  navigate('/cash/virmanListesi')
                } else {
                  navigate(`/cash/${id}`)
                }
                return
              }

              if (currentActiveMenuId === 'check') {
                navigate(`/check/${id}`)
                return
              }

              if (currentActiveMenuId === 'bank') {
                navigate(`/bank/${id}`)
                return
              }

              if (currentActiveMenuId === 'users') {
                const selectedTenant = String(localStorage.getItem('tenantCode') ?? '').trim()
                if (isSuperSuperAdmin && !selectedTenant && (id === 'allUsers' || id === 'projeYonetimi' || id === 'onboard')) {
                  localStorage.setItem('ssaViewMode', 'global')
                }
                navigate(`/users/${id}`)
                return
              }

              if (currentActiveMenuId === 'reports') {
                if (id === 'siparisRaporu') {
                  navigate('/reports/order-report')
                  return
                }
                navigate(`/reports/${id}`)
                return
              }

              if (currentActiveMenuId === 'eticaret') {
                // Sekme adrese yazılıyor: yenilemede ve geri/ileri tuşunda kullanıcı aynı
                // ekranda kalsın. State'e yazmak yetmiyordu (bkz. activeTabId hesabı).
                navigate(`/eticaret/${id}`)
                return
              }

              if (currentActiveMenuId === 'bildirimler') {
                // Bildirimler sayfası sekmesini `?tab=` üzerinden okuyor (gelen/gönder aynı
                // ekranın iki sekmesi), bu yüzden yol parçası değil sorgu değişkeni veriliyor.
                navigate(id === 'bildirimlerGonder' ? '/bildirimler?tab=send' : '/bildirimler?tab=incoming')
                return
              }

              setActiveTabIdState(id)
            }}
          />
        )}

        <main className={hideChrome ? '' : 'p-6'}>
          {isPathUnauthorized ? (
            <div className="flex flex-col items-center justify-center py-20 px-6 max-w-md mx-auto text-center bg-white rounded-2xl border border-slate-100 shadow-sm mt-10">
              <div className="w-16 h-16 rounded-2xl bg-rose-50 flex items-center justify-center text-rose-500 mb-6 shadow-sm">
                <AlertTriangle size={32} />
              </div>
              <h1 className="text-xl font-bold text-slate-800 mb-2">Yetkisiz Erişim (403)</h1>
              <p className="text-sm text-slate-500 mb-8 leading-relaxed">
                Bu sayfaya erişim yetkiniz bulunmamaktadır. Lütfen sistem yöneticinizle iletişime geçin.
              </p>
              <button
                type="button"
                onClick={() => navigate(-1)}
                className="px-5 h-11 bg-slate-900 hover:bg-slate-800 text-white font-semibold rounded-xl active:scale-[0.98] transition-all flex items-center justify-center gap-2 shadow-sm"
              >
                Geri Dön
              </button>
            </div>
          ) : (
            <Outlet
              context={{
                activeMenuId,
                activeTabId,
                setActiveTabId: setActiveTabIdState,
                isSuperAdmin,
                isSuperSuperAdmin,
                currentCode,
                salesmanCode,
                roleCode,
                allowedKeys,
                userDiscountRate,
                userRoleId
              }}
            />
          )}
        </main>

      </div>

      {/* AI Assistant UI (Disabled for now - Source code preserved) */}
      {false && (
        <>
          <button
            type="button"
            onClick={() => {
              setAssistantOpen(true)
              setAssistantSelectedMenuId(null)
              setAssistantSelectedPageKey(null)
              setAssistantMessages((prev) => {
                if (prev.length > 0) return prev
                const name = String(userName ?? '').trim() || 'Kullanıcı'
                return [
                  {
                    id: 'greeting',
                    role: 'bot',
                    text: `Hoş Geldin ${name}. Hangi modül/sayfa için bilgi almak istiyorsunuz?`
                  }
                ]
              })
            }}
            className="fixed bottom-6 right-6 z-[80] h-12 w-12 rounded-full bg-[#B73A0B] text-white shadow-lg hover:shadow-xl transition-shadow flex items-center justify-center"
            aria-label="Asistan"
          >
            <MessageCircle size={20} />
          </button>

          {assistantOpen && (
            <>
              <div className="fixed inset-0 z-[89] bg-transparent" onClick={() => setAssistantOpen(false)} />

              <div className="fixed bottom-24 right-6 z-[90] w-[360px] max-w-[92vw] h-[520px] max-h-[70vh] bg-white shadow-2xl rounded-2xl border border-gray-100 flex flex-col overflow-hidden">
                <div className="h-[52px] px-4 border-b border-gray-100 flex items-center justify-between">
                  <div className="text-sm font-bold text-gray-900">Asistan</div>
                  <button
                    type="button"
                    className="text-xs font-semibold text-gray-500 hover:text-gray-900"
                    onClick={() => setAssistantOpen(false)}
                  >
                    Kapat
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                  {assistantMessages.map((m) => (
                    <div key={m.id} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                      <div
                        className={
                          'max-w-[85%] rounded-2xl px-3 py-2 text-xs leading-relaxed ' +
                          (m.role === 'user'
                            ? 'bg-[#B73A0B] text-white'
                            : 'bg-gray-100 text-gray-800')
                        }
                      >
                        {m.text}
                      </div>
                    </div>
                  ))}

                  <div className="pt-2">
                    {assistantSelectedMenuId ? (
                      <>
                        <div className="flex items-center justify-between mb-2">
                          <div className="text-[11px] font-semibold text-gray-600">Sayfa seçiniz</div>
                          <button
                            type="button"
                            className="text-[11px] font-semibold text-gray-500 hover:text-gray-900"
                            onClick={() => setAssistantSelectedMenuId(null)}
                          >
                            Geri
                          </button>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {assistantPageOptions.map((p) => (
                            <button
                              key={p.key}
                              type="button"
                              className="h-8 px-3 rounded-full border border-gray-200 bg-white text-[11px] font-semibold text-gray-700 hover:bg-gray-50"
                              onClick={() => {
                                void askAssistantForPage(p.key, p.label)
                              }}
                            >
                              {p.label}
                            </button>
                          ))}
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="text-[11px] font-semibold text-gray-600 mb-2">Modül seçiniz</div>
                        <div className="flex flex-wrap gap-2">
                          {assistantMenuOptions.map((m) => (
                            <button
                              key={m.id}
                              type="button"
                              className="h-8 px-3 rounded-full border border-gray-200 bg-white text-[11px] font-semibold text-gray-700 hover:bg-gray-50"
                              onClick={() => {
                                setAssistantSelectedMenuId(m.id)
                                setAssistantMessages((prev) => [
                                  ...prev,
                                  { id: `${Date.now()}_${Math.random().toString(16).slice(2)}_menu`, role: 'user', text: m.label },
                                  {
                                    id: `${Date.now()}_${Math.random().toString(16).slice(2)}_menu_bot`,
                                    role: 'bot',
                                    text: 'Lütfen bilgi almak istediğiniz sayfayı seçiniz.'
                                  }
                                ])
                              }}
                            >
                              {m.label}
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                </div>

                <div className="p-3 border-t border-gray-100">
                  <div className="flex items-end gap-2">
                    <textarea
                      value={assistantInput}
                      onChange={(e) => setAssistantInput(e.target.value)}
                      placeholder={
                        assistantSelectedPageKey
                          ? 'Sorunuzu yazın (seçili sayfa bağlamında yanıtlanır)'
                          : 'Sorunuzu yazın (daha iyi sonuç için önce bir sayfa seçebilirsiniz)'
                      }
                      className="flex-1 min-h-[38px] max-h-[96px] resize-none rounded-lg border border-gray-200 px-3 py-2 text-xs text-gray-800 outline-none focus:ring-2 focus:ring-[#B73A0B]/20"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault()
                          const q = String(assistantInput ?? '').trim()
                          if (!q) return
                          setAssistantInput('')
                          void askAssistant({ pageKey: assistantSelectedPageKey, question: q })
                        }
                      }}
                    />
                    <button
                      type="button"
                      className="h-[38px] px-3 rounded-lg bg-[#B73A0B] text-white text-xs font-semibold disabled:opacity-50"
                      disabled={!String(assistantInput ?? '').trim()}
                      onClick={() => {
                        const q = String(assistantInput ?? '').trim()
                        if (!q) return
                        setAssistantInput('')
                        void askAssistant({ pageKey: assistantSelectedPageKey, question: q })
                      }}
                    >
                      Gönder
                    </button>
                  </div>
                  <div className="mt-2 text-[11px] text-gray-400">
                    Bu asistan, seçtiğiniz sayfa için açıklama üretir ve sistemi daha kolay öğrenmenize yardımcı olur.
                  </div>
                </div>
              </div>
            </>
          )}
        </>
      )}

    </div>

  )

}
