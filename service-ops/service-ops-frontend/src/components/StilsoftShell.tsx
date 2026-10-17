import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { sekmeGorunur } from '../utils/sekmeGorunur'
import { useLocation, useNavigate, NavLink } from 'react-router-dom'
import { clearSession, getTenantCode, getUsername, isTechnicianSession, getTechnicianId, getAccessToken, getUserRole } from '../auth/storage'
import { buildB2BUrl, buildEmployeePortalUrl as employeePortalLink, hasEmployeeAccess } from '../auth/b2bLink'
import { apiFetch, apiJson } from '../api/client'
import { logoutShared } from '../api/session'
import { clearCredentialsNative } from '../native/bridge'
import { useSignalREvent } from '../hooks/useSignalR'
import { usePermissions } from '../auth/PermissionsContext'
import { SAHA_ARIZA_TAB_KEYS } from '../auth/pagePermissions'
import Header, { SHELL_GRADIENT_FROM, SHELL_GRADIENT_TO } from './Header'
import SubNavigation from './SubNavigation'
import {
  LayoutDashboard,
  Package,
  AlertTriangle,
  Wrench,
  Calendar,
  MapPin,
  FileText,
  BarChart3,
  Settings,
  Bell,
  ChevronDown,
  LogOut,
  User,
  Trash2,
  MessageSquare,
  Home,
  Truck,
  Zap,
  CreditCard,
  ArrowLeftRight,
  Activity,
  X,
  ChevronLeft,
  ChevronRight,
  Menu,
  MoreHorizontal
} from 'lucide-react'

// Bayiye oturum taşıyan bağlantı TEK KAYNAKTA — bkz. auth/b2bLink.ts.
// Araç Depoları'ndaki satış düğmesi de aynı yerden geçiyor.

interface NavItem {
  to?: string
  label?: string
  icon?: React.ElementType
  badge?: number
  isDivider?: boolean
}

interface StilsoftShellProps {
  children: React.ReactNode
}

/**
 * "Pasife Alınanları Göster" kutusunun çıktığı sayfalar.
 *
 * Kabul ekranlarıyla başladı; kullanıcı planlama ekranlarında da istedi (2026-08-23).
 * `/saha-ariza` beyaz eşya arıza planlamasını da barındırıyor (eski `/saha-ariza-planlama`
 * oraya yönleniyor), `/planlama` ise küçük ürün planlaması.
 */
const PASSIVE_TOGGLE_ROUTES = [
  '/buyuk-urun-kabul', '/kucuk-urun-kabul', '/saha-ariza', '/planlama',
  // 2026-09-18 kullanıcı isteği: "90 günden fazla olanlar da görünsün, planlama atölye vs
  // sayfalarında üstte tik olsun; küçük üründe yok mesela". Küçük Ürün Planlama ekranı
  // `/atolye-ariza` adresinde; montaj planlaması da aynı süzgece takılıyordu.
  '/atolye-ariza', '/montaj-yonetimi'
]

export default function StilsoftShell({ children }: StilsoftShellProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const [logoUrl, setLogoUrl] = useState<string | null>(null)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem('sidebar_collapsed') === 'true')
  const [sidebarHovered, setSidebarHovered] = useState(false)
  const [userDropdownOpen, setUserDropdownOpen] = useState(false)
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [unreadCount, setUnreadCount] = useState(0)
  const [recentNotifications, setRecentNotifications] = useState<any[]>([])
  /** Yeni iş atandığında ekranın sağ altında beliren uyarı. */
  const [assignmentToast, setAssignmentToast] = useState<{ id: string; title: string; message: string } | null>(null)
  const [windowWidth, setWindowWidth] = useState(window.innerWidth)
  const [shellShowDelivered, setShellShowDelivered] = useState(() => {
    return !!(window as any).__showDelivered
  })

  const handleShowDeliveredChange = (checked: boolean) => {
    setShellShowDelivered(checked)
    ;(window as any).__showDelivered = checked
    window.dispatchEvent(new CustomEvent('shell:show-delivered-changed', { detail: checked }))
  }

  /**
   * PASİFE ALINANLARI GÖSTER (2026-08-23, kullanıcı isteği).
   *
   * 90 günden eski kayıtlar varsayılan listede yok. Kutu, "Gerçekleşenleri Göster" ile aynı
   * yolu kullanıyor: `window` üzerinde bayrak + olay. Sebebi, üst çubuğun sayfalarla ortak
   * bir durum deposu olmaması; yeni bir bağlam eklemek yerine yerleşik desen izleniyor.
   */
  const [shellShowPassive, setShellShowPassive] = useState(() => {
    return !!(window as any).__showPassive
  })

  const handleShowPassiveChange = (checked: boolean) => {
    setShellShowPassive(checked)
    ;(window as any).__showPassive = checked
    window.dispatchEvent(new CustomEvent('shell:show-passive-changed', { detail: checked }))
  }

  const [shellShowCancelled, setShellShowCancelled] = useState(() => {
    return !!(window as any).__showCancelled
  })

  const handleShowCancelledChange = (checked: boolean) => {
    setShellShowCancelled(checked)
    ;(window as any).__showCancelled = checked
    window.dispatchEvent(new CustomEvent('shell:show-cancelled-changed', { detail: checked }))
  }

  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth)
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  const [sahaActiveTab, setSahaActiveTab] = useState<'planlama' | 'saha' | 'bekleyen' | 'aktif' | 'teslimat'>('planlama')

  useEffect(() => {
    const handleTabUpdated = () => {
      const val = (window as any).__sahaActiveTab
      if (val) {
        setSahaActiveTab(val)
      }
    }
    window.addEventListener('saha-ariza:tab-updated', handleTabUpdated)
    if ((window as any).__sahaActiveTab) {
      setSahaActiveTab((window as any).__sahaActiveTab)
    }
    return () => window.removeEventListener('saha-ariza:tab-updated', handleTabUpdated)
  }, [])

  const [selectedCount, setSelectedCount] = useState(0)

  useEffect(() => {
    const handleSelectionChanged = () => {
      setSelectedCount((window as any).__selectedIdsLength || 0)
    }
    window.addEventListener('shell:selection-changed', handleSelectionChanged)
    setSelectedCount(0)
    ;(window as any).__selectedIdsLength = 0
    return () => window.removeEventListener('shell:selection-changed', handleSelectionChanged)
  }, [location.pathname])

  const [atolyeActiveTab, setAtolyeActiveTab] = useState<'bekleyen' | 'aktif' | 'teslimat'>('bekleyen')

  useEffect(() => {
    const handleTabUpdated = () => {
      const val = (window as any).__atolyeActiveTab
      if (val) {
        setAtolyeActiveTab(val)
      }
    }
    window.addEventListener('atolye-ariza:tab-updated', handleTabUpdated)
    if ((window as any).__atolyeActiveTab) {
      setAtolyeActiveTab((window as any).__atolyeActiveTab)
    }
    return () => window.removeEventListener('atolye-ariza:tab-updated', handleTabUpdated)
  }, [])

  const [montajActiveTab, setMontajActiveTab] = useState<'bekleyen' | 'aktif'>('bekleyen')

  useEffect(() => {
    const handleTabUpdated = () => {
      const val = (window as any).__montajActiveTab
      if (val) {
        setMontajActiveTab(val)
      }
    }
    window.addEventListener('montaj-yonetimi:tab-updated', handleTabUpdated)
    if ((window as any).__montajActiveTab) {
      setMontajActiveTab((window as any).__montajActiveTab)
    }
    return () => window.removeEventListener('montaj-yonetimi:tab-updated', handleTabUpdated)
  }, [])

  const [kargoActiveTab, setKargoActiveTab] = useState<'bekleyen' | 'aktif'>('bekleyen')

  useEffect(() => {
    const handleTabUpdated = () => {
      const val = (window as any).__kargoActiveTab
      if (val) {
        setKargoActiveTab(val)
      }
    }
    window.addEventListener('kargo-takibi:tab-updated', handleTabUpdated)
    if ((window as any).__kargoActiveTab) {
      setKargoActiveTab((window as any).__kargoActiveTab)
    }
    return () => window.removeEventListener('kargo-takibi:tab-updated', handleTabUpdated)
  }, [])

  const [sahaCounts, setSahaCounts] = useState<Record<string, number>>({})
  const [atolyeCounts, setAtolyeCounts] = useState<Record<string, number>>({})
  const [montajCounts, setMontajCounts] = useState<Record<string, number>>({})
  const [kargoCounts, setKargoCounts] = useState<Record<string, number>>({})

  const fetchCounts = React.useCallback(async () => {
    try {
      const accessToken = getAccessToken()
      if (!accessToken) return

      // 1. Saha Ariza counts (Repair, large)
      const sahaKeys = {
        planlama: { statuses: 'New,LargeProductPlanning', scope: 'buyukUrun.planlama' },
        saha: { statuses: 'FieldPlanned,Planned', scope: 'buyukUrun.sahaPlanlama' },
        bekleyen: { statuses: 'Workshop,InRepair,WaitingForParts,Delayed', scope: 'buyukUrun.atolye' },
        aktif: { statuses: 'Ready,WorkshopReady,DeliveryPlanning', scope: 'buyukUrun.hazirTeslimat' },
        teslimat: { statuses: 'InDelivery,Planned', scope: 'buyukUrun.teslimattakiler' }
      }
      /*
        ROZET SAYIMLARI PARALEL (2026-08-25, kullanici: "servis uygulamasi asiri yavas").

        Bu blok ve asagidaki iki blok `for` icinde `await` ile SIRAYLA istek atiyordu:
        saha 5 + atolye 3 + montaj 2 + kargo 1 = 11 istek, ardi ardina. Her biri 150 ms
        surse tek tazeleme 1,6 saniye demek. Ustelik tazeleme 15 saniyede bir, HER sayfa
        gecisinde ve DORT ayri SignalR olayinda tetikleniyor: baska bir kullanicinin durum
        guncellemesi, bagli her istemcide 11 istek daha aciyor.

        Istekler birbirinden bagimsiz; hepsi ayni anda gidiyor. Sure artik en yavas
        istegin suresi kadar, toplamlari kadar degil.

        `allSettled`: bir sayim yetkisizlikten (403) duserse digerleri yine yazilir.
      */
      const sahaEntries = Object.entries(sahaKeys)
      const sahaResults = await Promise.allSettled(
        sahaEntries.map(([, cfg]) =>
          apiJson<any>(`/api/servicerecords/paged?type=Repair&category=large&statuses=${cfg.statuses}&scopeKey=${cfg.scope}&page=1&pageSize=1&countOnly=true`))
      )
      const newSahaCounts: Record<string, number> = {}
      sahaEntries.forEach(([key], i) => {
        const r = sahaResults[i]
        if (r.status === 'fulfilled') newSahaCounts[key] = (r.value as any)?.totalCount ?? 0
      })
      setSahaCounts(newSahaCounts)

      // 2. Atolye Ariza counts (Repair, small)
      const atolyeKeys = {
        bekleyen: { statuses: 'Workshop,InRepair,WaitingForParts,Delayed', scope: 'atolyeAriza.atolye' },
        aktif: { statuses: 'Ready,WorkshopReady,DeliveryPlanning', scope: 'atolyeAriza.hazirTeslimat' },
        teslimat: { statuses: 'InDelivery,Planned', scope: 'atolyeAriza.teslimattakiler' }
      }
      const atolyeEntries = Object.entries(atolyeKeys)
      const atolyeResults = await Promise.allSettled(
        atolyeEntries.map(([, cfg]) =>
          apiJson<any>(`/api/servicerecords/paged?type=Repair&category=small&statuses=${cfg.statuses}&scopeKey=${cfg.scope}&page=1&pageSize=1&countOnly=true`))
      )
      const newAtolyeCounts: Record<string, number> = {}
      atolyeEntries.forEach(([key], i) => {
        const r = atolyeResults[i]
        if (r.status === 'fulfilled') newAtolyeCounts[key] = (r.value as any)?.totalCount ?? 0
      })
      setAtolyeCounts(newAtolyeCounts)

      // 3. Montaj counts (Installation)
      const montajKeys = {
        bekleyen: 'New,Planned',
        aktif: 'Workshop,InRepair,WaitingForParts'
      }
      const montajEntries = Object.entries(montajKeys)
      const montajResults = await Promise.allSettled(
        montajEntries.map(([, statuses]) =>
          apiJson<any>(`/api/servicerecords/paged?type=Installation&statuses=${statuses}&page=1&pageSize=1&countOnly=true`))
      )
      const newMontajCounts: Record<string, number> = {}
      montajEntries.forEach(([key], i) => {
        const r = montajResults[i]
        if (r.status === 'fulfilled') newMontajCounts[key] = (r.value as any)?.totalCount ?? 0
      })
      setMontajCounts(newMontajCounts)

      // 4. Kargo counts
      try {
        const cargoTasks = await apiJson<any[]>('/api/cargotracking')
        if (Array.isArray(cargoTasks)) {
          const bekleyen = cargoTasks.filter(t => t.status === 0).length
          const aktif = cargoTasks.filter(t => t.status !== 0).length
          setKargoCounts({ bekleyen, aktif })
        }
      } catch (e) {
        /*
          403 BURADA HATA DEGIL (2026-08-24).

          Kargo rozetleri ust cubukta herkese cizilmeye calisiliyor; kargo yetkisi olmayan
          kullanicida uc 403 donuyor ve konsol her yoklamada kirmizi hatayla doluyordu.
          Kullanici bunu "programda hata var" diye okuyor, asil hatalar da bu gurultunun
          icinde kayboluyordu.

          Yetkisizlik beklenen bir sonuc: rozet cizilmez, gecilir. Diger durumlar (ag hatasi,
          500) eskisi gibi konsola yaziliyor.
        */
        const mesaj = String((e as any)?.message ?? '')
        if (!mesaj.includes('403')) {
          console.error('Error fetching kargo counts', e)
        }
      }

    } catch (err) {
      console.error('Error fetching badge counts', err)
    }
  }, [])

  /*
    SIGNALR TETIKLEMESI GECIKTIRILIR (2026-08-25).

    Asagidaki DORT olayin ucu AYNI islem icin yayinlanabiliyor (`service_record_updated`,
    `ReceiveServiceRecordUpdate`, `ServiceRecordUpdated` — sunucuda uc isim de kullaniliyor).
    Her biri dogrudan `fetchCounts` cagiriyordu: tek bir durum guncellemesi, bagli HER
    istemcide rozet sayimlarini uc kez bastan cektiriyordu.

    Ayrica olaylar toplu islemlerde art arda yagiyor (10 satirin durumu degistirildiginde
    10+ olay). Kisa bir bekleme, art arda gelen olaylari TEK tazelemede birlestiriyor.

    Rozetler sayac; 400 ms gec guncellenmeleri kullanicinin fark edecegi bir sey degil.
  */
  const fetchTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const fetchCountsDebounced = React.useCallback(() => {
    if (fetchTimerRef.current) clearTimeout(fetchTimerRef.current)
    fetchTimerRef.current = setTimeout(() => { void fetchCounts() }, 400)
  }, [fetchCounts])

  useEffect(() => () => {
    if (fetchTimerRef.current) clearTimeout(fetchTimerRef.current)
  }, [])

  useSignalREvent('service_record_updated', fetchCountsDebounced)
  useSignalREvent('ReceiveServiceRecordUpdate', fetchCountsDebounced)
  useSignalREvent('ServiceRecordUpdated', fetchCountsDebounced)
  useSignalREvent('cargo_updated', fetchCountsDebounced)

  /*
    ROZET YOKLAMASI 15 SN -> 60 SN, YALNIZ GÖRÜNÜR SEKMEDE (2026-10-05, "servis çok yavaş").
    Rozetler zaten canlı olaylarla (yukarıdaki SignalR) ve her sayfa geçişinde tazeleniyor;
    yoklama yalnız bağlantı koparsa diye yedek. 15 saniyede bir 11 istek, gün boyu açık her
    ekrandan, sunucunun en büyük sabit yüküydü. Sekmeye dönünce hemen tazelenir.
  */
  useEffect(() => {
    fetchCounts()
    const interval = setInterval(() => { if (sekmeGorunur()) void fetchCounts() }, 60_000)
    const onVisible = () => { if (sekmeGorunur()) fetchCountsDebounced() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [location.pathname, fetchCounts, fetchCountsDebounced])

  const getBadge = (count?: number, isActive?: boolean) => {
    if (!count || count <= 0) return null
    return (
      <span className={`absolute -top-1.5 -right-2 text-[9px] font-extrabold px-1.5 py-0.5 rounded-full border min-w-[16px] h-[16px] flex items-center justify-center shadow-xs ${
        isActive 
          ? 'bg-white text-[#B91C1C] border-white' 
          : 'bg-[#B91C1C] text-white border-white'
      }`}>
        {count}
      </span>
    )
  }

  const userDropdownRef = useRef<HTMLDivElement>(null)
  const notificationsRef = useRef<HTMLDivElement>(null)

  const [gradientFrom, setGradientFrom] = useState(SHELL_GRADIENT_FROM)
  const [gradientTo, setGradientTo] = useState(SHELL_GRADIENT_TO)

  const tenantCode = getTenantCode()?.toUpperCase() || 'KKTC'
  const username = getUsername() || 'Admin'
  const userRole = getUserRole()?.toLowerCase()
  const isSuperAdminUser = userRole === 'superadmin' || userRole === 'supersuperadmin'

  const handleLogout = async () => {
    if (isTechnicianSession()) {
      const techId = getTechnicianId()
      if (techId) {
        try {
          await apiFetch(`/api/technicians/${techId}/online`, {
            method: 'PATCH',
            body: JSON.stringify({ isOnline: false })
          })
        } catch (e) {
          console.error('Failed to set online status to false on logout', e)
        }
      }
    }
    // Çıkış ortak kayda yazılır: kullanıcının bayideki oturumu da düşer.
    /*
      Kabuktaki kayitli giris bilgisi ACIK CIKISTA silinir (2026-08-24). Silinmezse otomatik
      giris kullaniciyi hemen geri sokar. Sure dolmasi bunu tetiklemez.
    */
    clearCredentialsNative()
    await logoutShared()
    clearSession()
    navigate('/login', { replace: true })
  }

  useEffect(() => {
    if (isTechnicianSession()) {
      const techId = getTechnicianId()
      if (techId) {
        apiFetch(`/api/technicians/${techId}/online`, {
          method: 'PATCH',
          body: JSON.stringify({ isOnline: true })
        }).catch(e => console.error('Failed to set online status to true on mount', e))
      }
    }
  }, [])

  const fetchUnreadData = async () => {
    if (!isTechnicianSession()) return
    try {
      const count = await apiJson<number>('/api/notifications/unread-count')
      setUnreadCount(count)
      const all = await apiJson<any[]>('/api/notifications')
      setRecentNotifications(all.slice(0, 5))
    } catch (e) {
      console.warn('Failed to fetch unread notifications count:', e)
    }
  }

  useEffect(() => {
    fetchUnreadData()
    const handleUpdate = () => void fetchUnreadData()
    window.addEventListener('notifications_updated', handleUpdate)
    const interval = setInterval(() => { if (sekmeGorunur()) void fetchUnreadData() }, 30000)
    return () => {
      window.removeEventListener('notifications_updated', handleUpdate)
      clearInterval(interval)
    }
  }, [])

  useSignalREvent('service_record_updated', () => {
    fetchUnreadData()
  })

  // İŞ ATAMASI CANLI DÜŞER.
  //
  // 30 saniyelik yoklama tek başına yeterli değil: teknisyen ekrana bakarken kendisine atanan
  // işi yarım dakika sonra görüyordu. Sunucu bu olayı yalnızca ilgili teknisyenin grubuna
  // gönderiyor, yani gelen mesaj her zaman "bana ait".
  useSignalREvent('notification_created', (payload: any) => {
    fetchUnreadData()
    if (payload?.title) {
      setAssignmentToast({
        id: String(payload.id ?? Date.now()),
        title: String(payload.title),
        message: String(payload.message ?? ''),
      })
    }
  })

  // Uyarı kutusu kendiliğinden kapanır; kullanıcı bir şeye basmak zorunda kalmasın.
  useEffect(() => {
    if (!assignmentToast) return
    const timer = setTimeout(() => setAssignmentToast(null), 12000)
    return () => clearTimeout(timer)
  }, [assignmentToast])

  useEffect(() => {
    let mounted = true
    if (tenantCode) {
      apiFetch(`/api/tenants/public-branding?tenantCode=${tenantCode}`)
        .then(async (res) => {
          if (!res.ok) return null
          const text = await res.text()
          return text ? JSON.parse(text) : null
        })
        .then((json) => {
          if (mounted && json?.success) {
            if (json.data?.logoUrl) {
              setLogoUrl(json.data.logoUrl)
              localStorage.setItem('tenantLogoUrl', json.data.logoUrl)
            }
            if (json.data?.headerGradientFrom) setGradientFrom(json.data.headerGradientFrom)
            if (json.data?.headerGradientTo) setGradientTo(json.data.headerGradientTo)
          }
        })
        .catch(() => {})
    }
    return () => {
      mounted = false
    }
  }, [tenantCode])

  const { loaded: permissionsLoaded, canOpen, isSuperAdmin, can } = usePermissions()

  /**
   * Sekme chip'i gösterilsin mi.
   *
   * Şeritler bütün sekmeleri KOŞULSUZ basıyordu: yalnızca "Teslimattakiler" yetkisi olan
   * kullanıcı "Planlama" chip'ini de görüyor, tıklıyor ve yetkisi olmayan bir listeye
   * düşüyordu. Sayfa varsayılan sekmeyi zaten yetkiye göre seçiyor (MontajYonetimiPage);
   * eksik olan şeridin aynı kaynağa bakmasıydı.
   *
   * Yetkiler HENÜZ YÜKLENMEDİYSE artık GİZLENİYOR (eskiden gösteriliyordu).
   *
   * Eski hâli `!permissionsLoaded || ...` idi, yani açık-başarısızdı: yetki isteği yavaşsa
   * sekmeler bir an herkese görünüyor, istek HATA verirse (enabled-keys 500) `loaded` hiç true
   * olmadığı için sekmeler KALICI olarak herkese açık kalıyordu. Kapı konduğu hâlde sızıntının
   * sürmesinin sebebi buydu.
   *
   * Titreme gerekçesi hâlâ geçerli ama yönü ters çevrildi: "önce göster sonra gizle" hem sızdırır
   * hem göz alır; "önce gizle sonra göster" en kötü ihtimalle şeridi bir an boş bırakır.
   */
  const gateTab = useCallback(
    (key: string) => permissionsLoaded && (isSuperAdmin || can(key)),
    [permissionsLoaded, isSuperAdmin, can]
  )

  const canCreateInKabul = useMemo(() => {
    if (!permissionsLoaded) return false
    if (isSuperAdmin) return true
    if (location.pathname === '/buyuk-urun-kabul') return can('buyukEvAletleriKabul.yeniKabul')
    if (location.pathname === '/kucuk-urun-kabul') return can('kucukUrunKabul.yeniKabul')
    if (location.pathname === '/montaj-kabul') return can('montajKabul.yeniKabul')
    if (location.pathname === '/kargo-kabul') return can('kargoPlanlama.yeniPlan') || can('kargoTakibi')
    return true
  }, [permissionsLoaded, isSuperAdmin, location.pathname, can])

  const [showSplash, setShowSplash] = useState(true)
  useEffect(() => {
    const timer = setTimeout(() => {
      setShowSplash(false)
    }, 1000)
    return () => clearTimeout(timer)
  }, [])
  const [loadingStuck, setLoadingStuck] = useState(false)

  useEffect(() => {
    if (!permissionsLoaded) {
      const timer = setTimeout(() => {
        setLoadingStuck(true)
      }, 2000)
      return () => clearTimeout(timer)
    }
  }, [permissionsLoaded])

  const hasPagePermission = (to: string | undefined) => {
    if (!to || to === '#' || to.startsWith('http')) return true
    if (isSuperAdmin || isSuperAdminUser) return true
    return canOpen(to)
  }

  const mainMenuItems = [
    { id: 'service', label: 'Servis İşlemleri', href: '#' }
  ]

  const serviceSubTabs = [
    { id: 'montajKabul', label: 'Montaj Kabul', href: '/montaj-kabul' },
    { id: 'montajYonetimi', label: 'Montaj Planlama', href: '/montaj-yonetimi' },
    { id: 'montajGecmisi', label: 'Montaj Geçmişi', href: '/montaj-gecmisi' },
    { id: 'buyukEvAletleriKabul', label: 'Beyaz Eşya Arıza Kabul', href: '/buyuk-urun-kabul' },
    { id: 'buyukUrun', label: 'Beyaz Eşya Arıza Planlama', href: '/saha-ariza' },
    { id: 'kucukUrunKabul', label: 'Küçük Ürün Kabul', href: '/kucuk-urun-kabul' },
    { id: 'atolyeAriza', label: 'Küçük Ürün Planlama', href: '/atolye-ariza' },
    { id: 'kargoKabul', label: 'Kargo Kabul', href: '/kargo-kabul' },
    { id: 'kargoTakibi', label: 'Kargo Takibi', href: '/kargo-takibi' },
    { id: 'teknisyenler', label: 'Teknisyenler', href: '/teknisyenler' },
    { id: 'musterilerBayiler', label: 'Müşteriler / Bayiler', href: '/musteriler' },
    { id: 'stok', label: 'Stok', href: '/stok' },
    { id: 'aracDepolari', label: 'Araç Depoları', href: '/arac-depolari' },
    { id: 'hizliServis', label: 'Hızlı Servis', href: '/hizli-servis' },
    { id: 'gunlukTahsilat', label: 'Günlük Tahsilatlar', href: '/gunluk-tahsilatlar' },
    { id: 'tahsilat', label: 'Tahsilat', href: '/tahsilat' },
    { id: 'hakedis', label: 'Hakediş', href: '/hakedis' },
    { id: 'personelEkstre', label: 'Personel Ekstresi', href: '/personel-ekstre' },
    { id: 'faturaTakip', label: 'Fatura Takip', href: '/fatura-takip' },
    { id: 'silinenKayitlar', label: 'Silinen Kayıtlar', href: '/silinen-kayitlar' },
    { id: 'userActivities', label: 'Kullanıcı Hareketleri', href: '/kullanici-hareketleri' },
    { id: 'teknisyenTakip', label: 'Teknisyen Takip', href: '/teknisyen-takip' },
    { id: 'bildirimler', label: 'Bildirimler', href: '/bildirimler' },
    { id: 'raporlar', label: 'Raporlar', href: '/raporlar' },
    { id: 'analiz', label: 'Analiz', href: '/analiz' },
    { id: 'ayarlar', label: 'Ayarlar', href: '/ayarlar' }
  ]

  const filteredSubTabs = serviceSubTabs.filter(t => hasPagePermission(t.href))

  const groupsDefinition = [
    {
      id: 'montaj',
      label: 'Montaj',
      items: [
        { id: 'montajKabul', label: 'Montaj Kabul', href: '/montaj-kabul' },
        { id: 'montajYonetimi', label: 'Montaj Planlama', href: '/montaj-yonetimi' },
        { id: 'montajGecmisi', label: 'Montaj Geçmişi', href: '/montaj-gecmisi' }
      ]
    },
    {
      id: 'buyukUrun',
      label: 'Beyaz Eşya',
      items: [
        { id: 'buyukEvAletleriKabul', label: 'Beyaz Eşya Arıza Kabul', href: '/buyuk-urun-kabul' },
        { id: 'buyukUrun', label: 'Beyaz Eşya Arıza Planlama', href: '/saha-ariza' }
      ]
    },
    {
      id: 'atolye',
      label: 'Atölye (Küçük Ürün)',
      items: [
        { id: 'kucukUrunKabul', label: 'Küçük Ürün Kabul', href: '/kucuk-urun-kabul' },
        { id: 'atolyeAriza', label: 'Küçük Ürün Planlama', href: '/atolye-ariza' }
      ]
    },
    {
      id: 'kargo',
      label: 'Kargo',
      items: [
        { id: 'kargoKabul', label: 'Kargo Kabul', href: '/kargo-kabul' },
        { id: 'kargoTakibi', label: 'Kargo Takibi', href: '/kargo-takibi' }
      ]
    },
    {
      id: 'sahaEkibi',
      label: 'Saha Ekibi',
      items: [
        { id: 'teknisyenler', label: 'Teknisyenler', href: '/teknisyenler' },
        { id: 'teknisyenTakip', label: 'Teknisyen Takip', href: '/teknisyen-takip' },
        { id: 'faturaTakip', label: 'Fatura Takip', href: '/fatura-takip' }
      ]
    },
    {
      id: 'sistem',
      label: 'Sistem',
      items: [
        { id: 'musterilerBayiler', label: 'Müşteriler / Bayiler', href: '/musteriler' },
        { id: 'stok', label: 'Stok', href: '/stok' },
        { id: 'aracDepolari', label: 'Araç Depoları', href: '/arac-depolari' },
        { id: 'hizliServis', label: 'Hızlı Servis', href: '/hizli-servis' },
        { id: 'gunlukTahsilat', label: 'Günlük Tahsilatlar', href: '/gunluk-tahsilatlar' },
        { id: 'tahsilat', label: 'Tahsilat', href: '/tahsilat' },
        { id: 'hakedis', label: 'Hakediş', href: '/hakedis' },
        { id: 'personelEkstre', label: 'Personel Ekstresi', href: '/personel-ekstre' },
        { id: 'silinenKayitlar', label: 'Silinen Kayıtlar', href: '/silinen-kayitlar' },
        { id: 'userActivities', label: 'Kullanıcı Hareketleri', href: '/kullanici-hareketleri' },
        { id: 'raporlar', label: 'Raporlar', href: '/raporlar' },
        { id: 'analiz', label: 'Analiz', href: '/analiz' },
        { id: 'ayarlar', label: 'Ayarlar', href: '/ayarlar' },
        { id: 'bildirimler', label: 'Bildirimler', href: '/bildirimler' }
      ]
    }
  ]

  const allowedGroups = groupsDefinition
    .map(g => ({
      ...g,
      items: g.items.filter(item => filteredSubTabs.some(t => t.id === item.id))
    }))
    .filter(g => g.items.length > 0)

  const activeSubTabId = filteredSubTabs.find(t => {
    if (t.href === '/') return location.pathname === '/'
    return location.pathname.startsWith(t.href)
  })?.id || ''

  const activeGroup = allowedGroups.find(g => g.items.some(item => item.id === activeSubTabId)) || allowedGroups[0]
  const activeGroupId = activeGroup?.id || ''

  const rawMainNav: NavItem[] = [
    { to: '/montaj-kabul', label: 'Montaj Kabul', icon: Package },
    { to: '/montaj-yonetimi', label: 'Montaj Planlama', icon: AlertTriangle },
    { to: '/montaj-gecmisi', label: 'Montaj Geçmişi', icon: FileText },
    { isDivider: true },
    { to: '/buyuk-urun-kabul', label: 'Beyaz Eşya Arıza Kabul', icon: Package },
    { to: '/saha-ariza', label: 'Beyaz Eşya Arıza Planlama', icon: MapPin },
    { isDivider: true },
    { to: '/kucuk-urun-kabul', label: 'Küçük Ürün Kabul', icon: Package },
    { to: '/atolye-ariza', label: 'Küçük Ürün Planlama', icon: Wrench },
    { isDivider: true },
    { to: '/kargo-kabul', label: 'Kargo Kabul', icon: Package },
    { to: '/kargo-takibi', label: 'Kargo Takibi', icon: Truck },
    { isDivider: true },
    { to: '/teknisyenler', label: 'Teknisyenler', icon: User },
    { to: '/musteriler', label: 'Müşteriler / Bayiler', icon: User },
    { to: '/stok', label: 'Stok', icon: Home },
    { to: '/arac-depolari', label: 'Araç Depoları', icon: Truck },
    { to: '/hizli-servis', label: 'Hızlı Servis', icon: Zap },
    { to: '/gunluk-tahsilatlar', label: 'Günlük Tahsilatlar', icon: FileText },
    { to: '/tahsilat', label: 'Tahsilat', icon: CreditCard },
    { to: '/hakedis', label: 'Hakediş', icon: FileText },
    { to: '/personel-ekstre', label: 'Personel Ekstresi', icon: FileText },
    { to: '/silinen-kayitlar', label: 'Silinen Kayıtlar', icon: Trash2 },
    { to: '/kullanici-hareketleri', label: 'Kullanıcı Hareketleri', icon: Activity },
    { to: '/teknisyen-takip', label: 'Teknisyen Takip', icon: MapPin },
    { to: '/fatura-takip', label: 'Fatura Takip', icon: FileText },
    { isDivider: true },
    { to: '/bildirimler', label: 'Bildirimler', icon: Bell, badge: unreadCount > 0 ? unreadCount : undefined },
  ]

  const rawSecondaryNav: NavItem[] = [
    { to: '/raporlar', label: 'Raporlar', icon: FileText },
    { to: '/analiz', label: 'Analiz', icon: BarChart3 },
    { to: '/ayarlar', label: 'Ayarlar', icon: Settings },
  ]

  const filterNavItems = (items: NavItem[]) => {
    const filtered = items.filter(item => item.isDivider || hasPagePermission(item.to))
    const result: NavItem[] = []
    filtered.forEach((item, index) => {
      if (item.isDivider) {
        if (result.length > 0 && !result[result.length - 1].isDivider && index < filtered.length - 1) {
          result.push(item)
        }
      } else {
        result.push(item)
      }
    })
    if (result.length > 0 && result[result.length - 1].isDivider) {
      result.pop()
    }
    return result
  }

  const mainNavItems = filterNavItems(rawMainNav)
  const secondaryNavItems = filterNavItems(rawSecondaryNav)

  const isActive = (path?: string) => {
    if (!path) return false
    if (path === '/') return location.pathname === '/'
    return location.pathname.startsWith(path)
  }

  const renderNavLinks = (items: NavItem[]) => (
    <div className="space-y-1 px-3">
      {items.map((item, idx) => {
        if (item.isDivider) {
          return <div key={`div-${idx}`} className="my-2 border-t border-gray-100" />
        }

        if (!item.to || !item.icon) return null
        const Icon = item.icon
        const active = isActive(item.to)

        return (
          <NavLink
            key={item.to}
            to={item.to}
            className={`flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-semibold transition-all ${
              active
                ? 'bg-rose-50 text-[#B91C1C] border border-rose-100 shadow-xs'
                : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
            }`}
          >
            <div className="flex items-center gap-3 min-w-0">
              <Icon className={`w-4 h-4 shrink-0 ${active ? 'text-[#B91C1C]' : 'text-gray-400'}`} />
              <span className="truncate">{item.label}</span>
            </div>
            {Boolean(item.badge) && (
              <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-rose-600 text-white shadow-xs">
                {item.badge}
              </span>
            )}
          </NavLink>
        )
      })}
    </div>
  )

  if (!permissionsLoaded || showSplash) {
    const cachedLogo = localStorage.getItem('tenantLogoUrl') || logoUrl || '/s-logo-white.png'
    return (
      <div className="min-h-[100dvh] bg-gradient-to-b from-[#140202] via-[#050000] to-black flex flex-col items-center justify-center px-4 font-outfit relative overflow-hidden">
        <style dangerouslySetInnerHTML={{__html: `
          @import url('https://fonts.googleapis.com/css2?family=Caveat:wght@500;700&family=Dancing+Script:wght@700&display=swap');
          .loading-handwriting {
            font-family: 'Caveat', 'Dancing Script', cursive;
          }
          .glow-pulse-red {
            animation: glowPulseRed 2s infinite ease-in-out;
          }
          @keyframes glowPulseRed {
            0%, 100% {
              filter: drop-shadow(0 0 15px rgba(239, 68, 68, 0.4));
              transform: scale(1);
            }
            50% {
              filter: drop-shadow(0 0 30px rgba(239, 68, 68, 0.8));
              transform: scale(1.05);
            }
          }
          .red-logo-filter {
            filter: brightness(0) saturate(100%) invert(27%) sepia(82%) saturate(5833%) hue-rotate(353deg) brightness(96%) contrast(121%);
          }
        `}} />

        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-red-600/10 rounded-full blur-[120px] pointer-events-none" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-rose-650/5 rounded-full blur-[120px] pointer-events-none" />

        <div className="relative mb-8 z-10 flex flex-col items-center">
          <div className="w-48 h-48 rounded-[2.5rem] bg-black/40 border border-red-900/30 backdrop-blur-xl flex items-center justify-center p-8 shadow-2xl glow-pulse-red transition-transform duration-500">
            {cachedLogo ? (
              <img
                src={cachedLogo}
                alt="STILSOFT"
                className="w-full h-full object-contain red-logo-filter"
                onError={(e) => {
                  e.currentTarget.style.display = 'none';
                }}
              />
            ) : (
              <span className="text-red-500 text-5xl font-black">S</span>
            )}
          </div>
        </div>

        <div className="text-center z-10 min-h-[96px] flex flex-col items-center justify-center">
          {loadingStuck ? (
            <p className="loading-handwriting text-red-500/90 text-7xl font-extrabold tracking-wide drop-shadow animate-pulse">
               STILSOFT servis
            </p>
          ) : (
            <p className="loading-handwriting text-red-500 text-7xl font-extrabold tracking-wide drop-shadow">
              servis
            </p>
          )}
        </div>

        <div className="w-48 h-1 bg-red-950/30 rounded-full overflow-hidden mt-8 max-w-xs z-10 border border-red-900/20">
          <div className="h-full bg-red-600 rounded-full w-2/3 animate-[loadingProgress_1.5s_infinite_ease-in-out]"></div>
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

  const effectiveLogo = logoUrl || localStorage.getItem('tenantLogoUrl')

  return (
    <div className="min-h-[100dvh] bg-[#F8F9FA] dark:bg-[#111827] flex flex-col lg:flex-row relative overflow-x-hidden font-outfit">
      
      {/* MOBILE ONLY: Top Header & SubNavigation (Hidden on Desktop lg:hidden) */}
      <div className="block lg:hidden">
        <Header
          items={mainMenuItems}
          activeId="service"
          subItemGroups={allowedGroups}
          activeSubId={activeSubTabId}
          userInitial={username.slice(0, 2).toUpperCase()}
          userName={username}
          tenantName={tenantCode}
          tenantLogoUrl={logoUrl || undefined}
          headerGradientFrom={SHELL_GRADIENT_FROM}
          headerGradientTo={SHELL_GRADIENT_TO}
          onLogout={handleLogout}
        />
        <div className="pt-[64px]">
          <SubNavigation
            groups={allowedGroups}
            activeGroupId={activeGroupId}
            activeTabId={activeSubTabId}
          />
        </div>
      </div>

      {/* DESKTOP ONLY: Left Sidebar (Hidden on Mobile, Visible on Desktop lg:flex) */}
      <aside
        className={`hidden lg:flex bg-white border-r border-gray-200 flex-col fixed inset-y-0 z-50 transition-all duration-300 ease-in-out transform ${
          sidebarCollapsed && !sidebarHovered
            ? 'w-0 -translate-x-full opacity-0 pointer-events-none'
            : 'w-64 translate-x-0 opacity-100 shadow-xl'
        }`}
        onMouseEnter={() => setSidebarHovered(true)}
        onMouseLeave={() => setSidebarHovered(false)}
      >
        <style dangerouslySetInnerHTML={{__html: `
          @import url('https://fonts.googleapis.com/css2?family=Caveat:wght@700&family=Dancing+Script:wght@700&display=swap');
          .loading-handwriting { font-family: 'Caveat', 'Dancing Script', cursive; }
          .red-logo-filter {
            filter: brightness(0) saturate(100%) invert(27%) sepia(82%) saturate(5833%) hue-rotate(353deg) brightness(96%) contrast(121%);
          }
        `}} />
        <div className="h-16 px-6 border-b border-gray-100 flex items-center justify-between">
          <button
            type="button"
            onClick={() => navigate('/')}
            className="flex items-center gap-2.5 group focus:outline-none select-none text-left"
          >
            <div className="relative flex flex-col items-start pt-1">
              <img
                src={effectiveLogo || '/s-logo-white.png'}
                alt="STILSOFT"
                className="h-8 w-auto object-contain red-logo-filter"
                onError={(e) => { e.currentTarget.style.display = 'none' }}
              />
              <span className="loading-handwriting text-gray-900 font-extrabold text-2xl -mt-3.5 ml-12 transform -rotate-6 tracking-wide select-none">
                servis
              </span>
            </div>
          </button>

          <button
            type="button"
            onClick={() => {
              setSidebarCollapsed(true)
              localStorage.setItem('sidebar_collapsed', 'true')
            }}
            className="p-1 rounded-lg text-gray-400 hover:bg-red-50 hover:text-[#B91C1C] transition-all duration-200 active:scale-95 flex items-center justify-center border border-transparent hover:border-red-100"
            title="Menüyü Gizle"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto py-4 space-y-4">
          <div>
            <div className="px-6 mb-2 text-[10px] font-bold uppercase tracking-wider text-gray-400">Modüller</div>
            {renderNavLinks(mainNavItems)}
          </div>

          <div>
            <div className="px-6 mb-2 text-[10px] font-bold uppercase tracking-wider text-gray-400">Yönetim</div>
            {renderNavLinks(secondaryNavItems)}
          </div>
        </div>

        <div className="p-4 border-t border-gray-100 bg-gray-50/50">
          <div className="flex items-center justify-between p-2 rounded-xl bg-white border border-gray-200/80 shadow-xs">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-lg bg-gray-900 text-white flex items-center justify-center font-bold text-xs shrink-0">
                {username.slice(0, 2).toUpperCase()}
              </div>
              <div className="min-w-0">
                <div className="text-xs font-bold text-gray-900 truncate">{username}</div>
                <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">{tenantCode}</div>
              </div>
            </div>
            <button
              onClick={handleLogout}
              className="p-1.5 text-gray-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
              title="Çıkış Yap"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Invisible Hover Zone on the Left Screen Edge to Trigger Collapsed Sidebar Slide-Open */}
      {sidebarCollapsed && (
        <div
          className="fixed left-0 top-0 bottom-0 w-3 z-40 cursor-pointer"
          onMouseEnter={() => setSidebarHovered(true)}
        />
      )}

      {/* Main Content Area (With lg:pl-64 for Desktop Sidebar Offset) */}
      <div className={`flex-1 flex flex-col min-w-0 transition-all duration-300 ease-in-out ${
        sidebarCollapsed ? 'lg:pl-0' : 'lg:pl-64'
      }`}>
        {/* DESKTOP ONLY: Top Header Bar (Hidden on Mobile, Visible on Desktop lg:flex) */}
        <header className="hidden lg:flex h-16 bg-white border-b border-gray-200 items-center justify-between gap-2 px-6 sticky top-0 z-40">
          <div className="flex items-center gap-3 shrink-0">
            {sidebarCollapsed && (
              <button
                type="button"
                onClick={() => {
                  setSidebarCollapsed(false)
                  localStorage.setItem('sidebar_collapsed', 'false')
                }}
                className="p-1.5 rounded-lg text-gray-500 hover:bg-red-50 hover:text-[#B91C1C] transition-all duration-200 active:scale-95 flex items-center justify-center border border-gray-200 shadow-xs mr-2"
                title="Menüyü Göster"
              >
                <Menu className="w-5 h-5" />
              </button>
            )}
            {['/buyuk-urun-kabul', '/kucuk-urun-kabul', '/montaj-kabul', '/saha-ariza', '/atolye-ariza', '/montaj-yonetimi', '/montaj-gecmisi', '/kargo-kabul', '/kargo-takibi'].includes(location.pathname) ? (
              <div className="flex items-center gap-4 text-sm lg:text-base whitespace-nowrap shrink-0 select-none">
                <div className="flex items-center gap-2">
                  <span className="font-extrabold text-gray-950 tracking-tight">
                    {location.pathname === '/buyuk-urun-kabul' ? 'Beyaz Eşya Arıza Kabul' : location.pathname === '/kucuk-urun-kabul' ? 'Küçük Ürün Kabul' : location.pathname === '/montaj-kabul' ? 'Montaj' : location.pathname === '/saha-ariza' ? 'Beyaz Eşya Arıza Planlama' : location.pathname === '/atolye-ariza' ? 'Küçük Ürün Planlama' : location.pathname === '/montaj-yonetimi' ? 'Montaj Planlama' : location.pathname === '/montaj-gecmisi' ? 'Montaj Geçmişi' : location.pathname === '/kargo-kabul' ? 'Kargo' : 'Kargo Takibi'}
                  </span>
                  <span className="text-gray-400 font-semibold italic">
                    {location.pathname === '/saha-ariza' ? 'Arıza ve Teslimat Yönetimi' : location.pathname === '/atolye-ariza' ? 'Arıza ve Atölye Yönetimi' : location.pathname === '/montaj-yonetimi' ? 'Montaj Operasyon Yönetimi' : location.pathname === '/montaj-gecmisi' ? 'Montaj Kayıt Defteri — Kabulden Kapanışa' : location.pathname === '/kargo-takibi' ? 'Kargo Sevkiyat Yönetimi' : 'Kabul ve Takip'}
                  </span>
                </div>

                {/* Saha Ariza Segmented Sub-Tabs inside Header */}
                {location.pathname === '/saha-ariza' && (
                  <div className="bg-slate-100 p-0.5 rounded-xl flex gap-0.5 items-center border border-slate-200/50 max-w-[620px]">
                    {gateTab(SAHA_ARIZA_TAB_KEYS.planlama) && (
                    <button
                      onClick={() => window.dispatchEvent(new CustomEvent('shell:saha-ariza-tab-change', { detail: 'planlama' }))}
                      className={`relative px-2.5 py-1.5 rounded-lg text-center font-extrabold text-xs uppercase tracking-wider transition-all cursor-pointer whitespace-nowrap active:scale-95 ${
                        sahaActiveTab === 'planlama'
                          ? 'bg-[#B91C1C] text-white shadow-sm'
                          : 'text-slate-600 hover:text-slate-900 bg-transparent hover:bg-slate-200/40'
                      }`}
                    >
                      Planlama
                      {getBadge(sahaCounts.planlama, sahaActiveTab === 'planlama')}
                    </button>
                    )}
                    {gateTab(SAHA_ARIZA_TAB_KEYS.saha) && (
                    <button
                      onClick={() => window.dispatchEvent(new CustomEvent('shell:saha-ariza-tab-change', { detail: 'saha' }))}
                      className={`relative px-2.5 py-1.5 rounded-lg text-center font-extrabold text-xs uppercase tracking-wider transition-all cursor-pointer whitespace-nowrap active:scale-95 ${
                        sahaActiveTab === 'saha'
                          ? 'bg-[#B91C1C] text-white shadow-sm'
                          : 'text-slate-600 hover:text-slate-900 bg-transparent hover:bg-slate-200/40'
                      }`}
                    >
                      Saha
                      {getBadge(sahaCounts.saha, sahaActiveTab === 'saha')}
                    </button>
                    )}
                    {gateTab(SAHA_ARIZA_TAB_KEYS.bekleyen) && (
                    <button
                      onClick={() => window.dispatchEvent(new CustomEvent('shell:saha-ariza-tab-change', { detail: 'bekleyen' }))}
                      className={`relative px-2.5 py-1.5 rounded-lg text-center font-extrabold text-xs uppercase tracking-wider transition-all cursor-pointer whitespace-nowrap active:scale-95 ${
                        sahaActiveTab === 'bekleyen'
                          ? 'bg-[#B91C1C] text-white shadow-sm'
                          : 'text-slate-600 hover:text-slate-900 bg-transparent hover:bg-slate-200/40'
                      }`}
                    >
                      Atölye
                      {getBadge(sahaCounts.bekleyen, sahaActiveTab === 'bekleyen')}
                    </button>
                    )}
                    {gateTab(SAHA_ARIZA_TAB_KEYS.aktif) && (
                    <button
                      onClick={() => window.dispatchEvent(new CustomEvent('shell:saha-ariza-tab-change', { detail: 'aktif' }))}
                      className={`relative px-2.5 py-1.5 rounded-lg text-center font-extrabold text-xs uppercase tracking-wider transition-all cursor-pointer whitespace-nowrap active:scale-95 ${
                        sahaActiveTab === 'aktif'
                          ? 'bg-[#B91C1C] text-white shadow-sm'
                          : 'text-slate-600 hover:text-slate-900 bg-transparent hover:bg-slate-200/40'
                      }`}
                    >
                      Teslimat Planlama
                      {getBadge(sahaCounts.aktif, sahaActiveTab === 'aktif')}
                    </button>
                    )}
                    {gateTab(SAHA_ARIZA_TAB_KEYS.teslimat) && (
                    <button
                      onClick={() => window.dispatchEvent(new CustomEvent('shell:saha-ariza-tab-change', { detail: 'teslimat' }))}
                      className={`relative px-2.5 py-1.5 rounded-lg text-center font-extrabold text-xs uppercase tracking-wider transition-all cursor-pointer whitespace-nowrap active:scale-95 ${
                        sahaActiveTab === 'teslimat'
                          ? 'bg-[#B91C1C] text-white shadow-sm'
                          : 'text-slate-600 hover:text-slate-900 bg-transparent hover:bg-slate-200/40'
                      }`}
                    >
                      Teslimattakiler
                      {getBadge(sahaCounts.teslimat, sahaActiveTab === 'teslimat')}
                    </button>
                    )}
                  </div>
                )}

                {/* Atolye Ariza Segmented Sub-Tabs inside Header */}
                {location.pathname === '/atolye-ariza' && (
                  <div className="bg-slate-100 p-0.5 rounded-xl flex gap-0.5 items-center border border-slate-200/50 max-w-[450px]">
                    {gateTab('atolyeAriza.atolye') && (
                    <button
                      onClick={() => window.dispatchEvent(new CustomEvent('shell:atolye-ariza-tab-change', { detail: 'bekleyen' }))}
                      className={`relative px-2.5 py-1.5 rounded-lg text-center font-extrabold text-xs uppercase tracking-wider transition-all cursor-pointer whitespace-nowrap active:scale-95 ${
                        atolyeActiveTab === 'bekleyen'
                          ? 'bg-[#B91C1C] text-white shadow-sm'
                          : 'text-slate-600 hover:text-slate-900 bg-transparent hover:bg-slate-200/40'
                      }`}
                    >
                      Atölye
                      {getBadge(atolyeCounts.bekleyen, atolyeActiveTab === 'bekleyen')}
                    </button>
                    )}
                    {gateTab('atolyeAriza.hazirTeslimat') && (
                    <button
                      onClick={() => window.dispatchEvent(new CustomEvent('shell:atolye-ariza-tab-change', { detail: 'aktif' }))}
                      className={`relative px-2.5 py-1.5 rounded-lg text-center font-extrabold text-xs uppercase tracking-wider transition-all cursor-pointer whitespace-nowrap active:scale-95 ${
                        atolyeActiveTab === 'aktif'
                          ? 'bg-[#B91C1C] text-white shadow-sm'
                          : 'text-slate-600 hover:text-slate-900 bg-transparent hover:bg-slate-200/40'
                      }`}
                    >
                      Teslimat Planlama
                      {getBadge(atolyeCounts.aktif, atolyeActiveTab === 'aktif')}
                    </button>
                    )}
                    {gateTab('atolyeAriza.teslimattakiler') && (
                    <button
                      onClick={() => window.dispatchEvent(new CustomEvent('shell:atolye-ariza-tab-change', { detail: 'teslimat' }))}
                      className={`relative px-2.5 py-1.5 rounded-lg text-center font-extrabold text-xs uppercase tracking-wider transition-all cursor-pointer whitespace-nowrap active:scale-95 ${
                        atolyeActiveTab === 'teslimat'
                          ? 'bg-[#B91C1C] text-white shadow-sm'
                          : 'text-slate-600 hover:text-slate-900 bg-transparent hover:bg-slate-200/40'
                      }`}
                    >
                      Teslimattakiler
                      {getBadge(atolyeCounts.teslimat, atolyeActiveTab === 'teslimat')}
                    </button>
                    )}
                  </div>
                )}

                {/* Montaj Yonetimi Segmented Sub-Tabs inside Header */}
                {location.pathname === '/montaj-yonetimi' && (
                  <div className="bg-slate-100 p-0.5 rounded-xl flex gap-0.5 items-center border border-slate-200/50 max-w-[300px]">
                    {gateTab('montajYonetimi.planlama') && (
                    <button
                      onClick={() => window.dispatchEvent(new CustomEvent('shell:montaj-yonetimi-tab-change', { detail: 'bekleyen' }))}
                      className={`relative px-2.5 py-1.5 rounded-lg text-center font-extrabold text-xs uppercase tracking-wider transition-all cursor-pointer whitespace-nowrap active:scale-95 ${
                        montajActiveTab === 'bekleyen'
                          ? 'bg-[#B91C1C] text-white shadow-sm'
                          : 'text-slate-600 hover:text-slate-900 bg-transparent hover:bg-slate-200/40'
                      }`}
                    >
                      Planlama
                      {getBadge(montajCounts.bekleyen, montajActiveTab === 'bekleyen')}
                    </button>
                    )}
                    {gateTab('montajYonetimi.teslimat') && (
                    <button
                      onClick={() => window.dispatchEvent(new CustomEvent('shell:montaj-yonetimi-tab-change', { detail: 'aktif' }))}
                      className={`relative px-2.5 py-1.5 rounded-lg text-center font-extrabold text-xs uppercase tracking-wider transition-all cursor-pointer whitespace-nowrap active:scale-95 ${
                        montajActiveTab === 'aktif'
                          ? 'bg-[#B91C1C] text-white shadow-sm'
                          : 'text-slate-600 hover:text-slate-900 bg-transparent hover:bg-slate-200/40'
                      }`}
                    >
                      Teslimattakiler
                      {getBadge(montajCounts.aktif, montajActiveTab === 'aktif')}
                    </button>
                    )}
                  </div>
                )}

                {/* Kargo Takibi Segmented Sub-Tabs inside Header */}
                {location.pathname === '/kargo-takibi' && (
                  <div className="bg-slate-100 p-0.5 rounded-xl flex gap-0.5 items-center border border-slate-200/50 max-w-[300px]">
                    <button
                      onClick={() => window.dispatchEvent(new CustomEvent('shell:kargo-takibi-tab-change', { detail: 'bekleyen' }))}
                      className={`relative px-2.5 py-1.5 rounded-lg text-center font-extrabold text-xs uppercase tracking-wider transition-all cursor-pointer whitespace-nowrap active:scale-95 ${
                        kargoActiveTab === 'bekleyen'
                          ? 'bg-[#B91C1C] text-white shadow-sm'
                          : 'text-slate-650 hover:text-slate-900 bg-transparent hover:bg-slate-200/40'
                      }`}
                    >
                      Planlama
                      {getBadge(kargoCounts.bekleyen, kargoActiveTab === 'bekleyen')}
                    </button>
                    <button
                      onClick={() => window.dispatchEvent(new CustomEvent('shell:kargo-takibi-tab-change', { detail: 'aktif' }))}
                      className={`relative px-2.5 py-1.5 rounded-lg text-center font-extrabold text-xs uppercase tracking-wider transition-all cursor-pointer whitespace-nowrap active:scale-95 ${
                        kargoActiveTab === 'aktif'
                          ? 'bg-[#B91C1C] text-white shadow-sm'
                          : 'text-slate-650 hover:text-slate-900 bg-transparent hover:bg-slate-200/40'
                      }`}
                    >
                      Dağıtımdakiler
                      {getBadge(kargoCounts.aktif, kargoActiveTab === 'aktif')}
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-2 text-sm text-gray-500 shrink-0">
                <span className="font-semibold text-gray-700 whitespace-nowrap">STILSOFT SERVİS</span>
                <span className="text-gray-300">/</span>
                <span className="text-gray-900 font-bold whitespace-nowrap">
                  {mainNavItems.find(i => i.to && isActive(i.to))?.label || secondaryNavItems.find(i => i.to && isActive(i.to))?.label || 'Panel'}
                </span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-3 shrink-0 ml-auto">
            {/* Pasif kutusu kabul/planlama ekranlarinin ORTAK ogesi; asagidaki dal ayrimindan
                (kabul mu, yonetim mi) bagimsiz durur, yoksa planlama sayfalari else dalina
                dustugu icin kutuyu hic gormezdi. */}
            {PASSIVE_TOGGLE_ROUTES.includes(location.pathname) && (
              <label className="flex items-center gap-1.5 px-2.5 py-1.5 mr-1 bg-white border border-gray-200 hover:bg-gray-50 rounded-xl text-xs font-bold text-gray-700 shadow-sm cursor-pointer select-none transition active:scale-95 whitespace-nowrap">
                <input
                  type="checkbox"
                  checked={shellShowPassive}
                  onChange={(e) => handleShowPassiveChange(e.target.checked)}
                  className="w-3.5 h-3.5 text-[#B91C1C] border-gray-300 rounded focus:ring-[#B91C1C]/20 cursor-pointer"
                />
                <span>Pasife Alınanları Göster</span>
              </label>
            )}
            {['/buyuk-urun-kabul', '/kucuk-urun-kabul', '/montaj-kabul', '/saha-ariza', '/atolye-ariza', '/montaj-yonetimi', '/montaj-gecmisi', '/kargo-kabul', '/kargo-takibi'].includes(location.pathname) && (
              <div className="flex items-center gap-1.5 sm:gap-2 mr-2 shrink-0">
                {['/buyuk-urun-kabul', '/kucuk-urun-kabul', '/montaj-kabul', '/kargo-kabul'].includes(location.pathname) ? (
                  <>
                    {['/buyuk-urun-kabul', '/kucuk-urun-kabul', '/montaj-kabul'].includes(location.pathname) && (
                      <label className="flex items-center gap-1.5 px-2.5 py-1.5 bg-white border border-gray-200 hover:bg-gray-50 rounded-xl text-xs font-bold text-gray-700 shadow-sm cursor-pointer select-none transition active:scale-95 whitespace-nowrap">
                        <input
                          type="checkbox"
                          checked={shellShowDelivered}
                          onChange={(e) => handleShowDeliveredChange(e.target.checked)}
                          className="w-3.5 h-3.5 text-[#B91C1C] border-gray-300 rounded focus:ring-[#B91C1C]/20 cursor-pointer"
                        />
                        <span>Gerçekleşenleri Göster</span>
                      </label>
                    )}
                    {location.pathname === '/montaj-kabul' && (
                      <label className="flex items-center gap-1.5 px-2.5 py-1.5 bg-white border border-gray-200 hover:bg-gray-50 rounded-xl text-xs font-bold text-gray-700 shadow-sm cursor-pointer select-none transition active:scale-95 whitespace-nowrap">
                        <input
                          type="checkbox"
                          checked={shellShowCancelled}
                          onChange={(e) => handleShowCancelledChange(e.target.checked)}
                          className="w-3.5 h-3.5 text-[#B91C1C] border-gray-300 rounded focus:ring-[#B91C1C]/20 cursor-pointer"
                        />
                        <span>İptalleri Göster</span>
                      </label>
                    )}
                    <button
                      onClick={() => window.dispatchEvent(new CustomEvent(
                        location.pathname === '/kargo-kabul' ? 'shell:kargo-kabul-export' : 'shell:kabul-export'
                      ))}
                      title={selectedCount > 0 ? "Seçilenleri Excel'e Aktar" : "Excel Aktar"}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 bg-white border border-gray-200 hover:bg-gray-50 rounded-xl text-xs font-bold text-gray-700 shadow-sm cursor-pointer select-none transition active:scale-95 whitespace-nowrap"
                    >
                      <svg className="w-3.5 h-3.5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                      {windowWidth >= 1350 && (
                        <span>{selectedCount > 0 ? "Seçilenleri Excel'e Aktar" : "Excel Aktar"}</span>
                      )}
                    </button>
                    {location.pathname !== '/kargo-kabul' && (
                      <>
                        <button
                          onClick={() => window.dispatchEvent(new CustomEvent('shell:kabul-calendar'))}
                          title="Takvim"
                          className="flex items-center gap-1.5 px-2.5 py-1.5 bg-white border border-gray-200 hover:bg-gray-50 rounded-xl text-xs font-bold text-gray-700 shadow-sm cursor-pointer select-none transition active:scale-95 whitespace-nowrap"
                        >
                          <svg className="w-3.5 h-3.5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                          {windowWidth >= 1350 && <span>Takvim</span>}
                        </button>
                        <button
                          onClick={() => window.dispatchEvent(new CustomEvent('shell:kabul-print'))}
                          title="Yazdır"
                          className="flex items-center gap-1.5 px-2.5 py-1.5 bg-white border border-gray-200 hover:bg-gray-50 rounded-xl text-xs font-bold text-gray-700 shadow-sm cursor-pointer select-none transition active:scale-95 whitespace-nowrap"
                        >
                          <svg className="w-3.5 h-3.5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H7a2 2 0 00-2 2v4h10z" /></svg>
                          {windowWidth >= 1350 && <span>Yazdır</span>}
                        </button>
                      </>
                    )}
                    {canCreateInKabul && (
                      <button
                        onClick={() => window.dispatchEvent(new CustomEvent(
                          location.pathname === '/kargo-kabul' ? 'shell:kargo-kabul-new' : 'shell:kabul-new'
                        ))}
                        title={
                          location.pathname === '/kargo-kabul' ? 'Yeni Kargo Kaydı' : 
                          location.pathname === '/montaj-kabul' ? 'Yeni Montaj Kaydı' : 
                          'Yeni Servis Kaydı'
                        }
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-[#B91C1C] hover:bg-[#991B1B] text-white rounded-xl text-xs font-bold shadow-md cursor-pointer select-none transition active:scale-95 whitespace-nowrap"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                        {windowWidth >= 1150 ? (
                          <span>
                            {location.pathname === '/kargo-kabul' ? 'Yeni Kargo Kaydı' : 
                             location.pathname === '/montaj-kabul' ? 'Yeni Montaj Kaydı' : 
                             'Yeni Servis Kaydı'}
                          </span>
                        ) : (
                          <span>Yeni</span>
                        )}
                      </button>
                    )}
                  </>
                ) : (
                  <button
                    onClick={() => window.dispatchEvent(new CustomEvent(
                      location.pathname === '/saha-ariza' ? 'shell:saha-ariza-export' : 
                      location.pathname === '/atolye-ariza' ? 'shell:atolye-ariza-export' : 
                      location.pathname === '/montaj-yonetimi' || location.pathname === '/montaj-gecmisi' ? 'shell:montaj-yonetimi-export' :
                      'shell:kargo-takibi-export'
                    ))}
                    title="Excel Aktar"
                    className="flex items-center gap-1.5 px-2.5 py-1.5 bg-white border border-gray-200 hover:bg-gray-50 rounded-xl text-xs font-bold text-gray-700 shadow-sm cursor-pointer select-none transition active:scale-95 whitespace-nowrap"
                  >
                    <svg className="w-3.5 h-3.5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                    <span>Excel Aktar</span>
                  </button>
                )}
              </div>
            )}

            {/* Switch to Bayi Button — teknisyenin bayi panelinde işi yok, düğme de gösterilmez. */}
            {!isTechnicianSession() && (
            <button
              type="button"
              onClick={() => {
                window.location.assign(buildB2BUrl('/invoice'))
              }}
              title="Bayi Moduna Geçiş Yap"
              className="bg-slate-50 border border-gray-200/80 hover:border-gray-300 px-3.5 py-1.5 rounded-2xl shadow-xs hover:bg-slate-100/80 active:scale-95 group cursor-pointer shrink-0 select-none transition-all flex items-center gap-3 text-slate-800"
            >
              <div className="flex flex-col items-start leading-none gap-0.5">
                <span className="font-bold text-[8px] text-gray-400 tracking-wider uppercase">Aktif Panel</span>
                <span className="font-black text-[11px] sm:text-xs text-red-650 uppercase tracking-wider">SERVİS</span>
              </div>
              <div className="h-6 w-px bg-gray-200" />
              <div className="flex items-center gap-1.5 bg-gray-900 group-hover:bg-black px-2.5 py-1 rounded-xl border border-gray-900 shadow-sm transition-all duration-300">
                <span className="font-extrabold text-[10px] sm:text-[11px] text-white uppercase tracking-wider">BAYİ'YE GEÇ</span>
                <ArrowLeftRight size={12} className="text-white/80 group-hover:translate-x-0.5 transition-transform" />
              </div>
            </button>
            )}

            {/*
              "Personele Geç" ÜST ÇUBUKTA DEĞİL, kullanıcı açılır menüsünde (kullanıcı kararı).
              Üst çubukta yalnızca "Bayi'ye Geç" durur.
            */}

            {/* Notifications Bell */}
            <div className="relative" ref={notificationsRef}>
              <button
                onClick={() => setNotificationsOpen(!notificationsOpen)}
                className="relative p-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <Bell className="w-5 h-5" />
                {unreadCount > 0 && (
                  <span className="absolute top-1 right-1 w-4 h-4 bg-rose-600 text-white text-[9px] font-bold rounded-full flex items-center justify-center shadow-xs">
                    {unreadCount}
                  </span>
                )}
              </button>
              {notificationsOpen && (
                <div className="absolute right-0 top-full mt-2 w-80 bg-white text-gray-900 rounded-xl shadow-2xl border border-gray-100 z-50 overflow-hidden">
                  <div className="p-3 border-b border-gray-100 flex items-center justify-between">
                    <span className="font-bold text-xs uppercase tracking-wider text-gray-700">Bildirimler</span>
                    <button 
                      onClick={() => { navigate('/bildirimler'); setNotificationsOpen(false) }}
                      className="text-xs text-rose-600 hover:underline font-semibold"
                    >
                      Tümünü Gör
                    </button>
                  </div>
                  <div className="max-h-64 overflow-y-auto divide-y divide-gray-50">
                    {recentNotifications.length === 0 ? (
                      <div className="p-4 text-xs text-gray-500 text-center">Yeni bildirim bulunmuyor.</div>
                    ) : (
                      recentNotifications.map(n => (
                        <div 
                          key={n.id} 
                          onClick={async () => {
                            setNotificationsOpen(false)
                            if (!n.isRead) {
                              try {
                                await apiJson(`/api/notifications/${n.id}/read`, { method: 'PATCH' })
                                setUnreadCount(prev => Math.max(0, prev - 1))
                              } catch (e) {
                                console.warn('Mark as read error:', e)
                              }
                            }
                            const jt = (n.jobType || '').toLowerCase()
                            if (n.jobId) {
                              if (jt.includes('servicerecord') || jt.includes('ariza') || jt.includes('saha')) {
                                navigate('/saha-ariza')
                                return
                              }
                              if (jt.includes('installation') || jt.includes('montaj')) {
                                navigate('/montaj-yonetimi')
                                return
                              }
                              if (jt.includes('cargo') || jt.includes('kargo')) {
                                navigate('/kargo-takibi')
                                return
                              }
                            }
                            navigate('/bildirimler')
                          }}
                          className={`p-3 hover:bg-gray-50 cursor-pointer text-left transition-all ${!n.isRead ? 'bg-rose-50/30' : ''}`}
                        >
                          <div className="font-semibold text-xs text-gray-900 flex items-center gap-1.5">
                            {n.title}
                            {!n.isRead && <span className="w-1.5 h-1.5 rounded-full bg-rose-600 flex-shrink-0" />}
                          </div>
                          <div className="text-[10px] text-gray-500 mt-0.5 line-clamp-1">{n.message}</div>
                          <div className="text-[9px] text-gray-400 mt-1">{new Date(n.createdAt).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}</div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* User Dropdown */}
            <div className="relative" ref={userDropdownRef}>
              <button
                onClick={() => setUserDropdownOpen(!userDropdownOpen)}
                className="flex items-center gap-2 p-1.5 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-gray-800 to-gray-900 text-white flex items-center justify-center font-bold text-xs shadow-xs">
                  {username.slice(0, 2).toUpperCase()}
                </div>
                <ChevronDown className="w-4 h-4 text-gray-500 transition-transform" />
              </button>
              {userDropdownOpen && (
                <div className="absolute right-0 top-full mt-2 w-56 bg-white text-gray-900 rounded-xl shadow-2xl border border-gray-100 z-50 overflow-hidden">
                  <div className="p-4 bg-gradient-to-br from-gray-800 to-gray-900 text-white">
                    <div className="font-bold text-sm">{username}</div>
                    <div className="text-xs text-gray-400 font-medium">{tenantCode}</div>
                  </div>
                  <div className="p-1.5">
                    {/*
                      Panel geçişleri menüde de duruyor: üst çubuktaki düğmeler dar ekranda
                      gizleniyor ve kullanıcı geçişi burada arıyor. Görünürlük kuralı üsttekiyle
                      AYNI — teknisyen değil + bayiden gelen `employeeAccess` bayrağı dolu.
                    */}
                    {!isTechnicianSession() && hasEmployeeAccess() && employeePortalLink() && (
                      <button
                        onClick={() => {
                          setUserDropdownOpen(false)
                          window.location.assign(employeePortalLink())
                        }}
                        className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-50 text-xs font-semibold text-gray-700 transition-colors"
                      >
                        <ArrowLeftRight className="w-4 h-4 text-gray-500" />
                        Personele Geç
                      </button>
                    )}
                    {/* "Bayi'ye Geç" menüde YOK: üst çubuktaki düğme zaten o iş için duruyor. */}
                    <button
                      onClick={handleLogout}
                      className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-rose-50 text-xs font-semibold text-rose-600 transition-colors"
                    >
                      <LogOut className="w-4 h-4 text-rose-500" />
                      Çıkış Yap
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* MOBILE ONLY: Segmented Sub-Tabs Bar & Operational Quick Actions */}
        {['/buyuk-urun-kabul', '/kucuk-urun-kabul', '/montaj-kabul', '/saha-ariza', '/atolye-ariza', '/montaj-yonetimi', '/montaj-gecmisi', '/kargo-kabul', '/kargo-takibi'].includes(location.pathname) && (
          <div className="block lg:hidden sticky top-[64px] z-30 bg-white/95 backdrop-blur-md border-b border-slate-200/80 py-1.5 px-3 shadow-xs overflow-x-auto no-scrollbar">
            <div className="flex items-center justify-between gap-2 min-w-max">
              {['/saha-ariza', '/atolye-ariza', '/montaj-yonetimi', '/kargo-takibi'].includes(location.pathname) && (
                <div className="flex items-center gap-1 min-w-max">
                  {location.pathname === '/saha-ariza' && (
                    <div className="bg-slate-100 p-0.5 rounded-xl flex gap-0.5 items-center border border-slate-200/50">
                      {gateTab(SAHA_ARIZA_TAB_KEYS.planlama) && (
                      <button
                        onClick={() => window.dispatchEvent(new CustomEvent('shell:saha-ariza-tab-change', { detail: 'planlama' }))}
                        className={`relative px-2.5 py-1 rounded-lg text-center font-extrabold text-xs uppercase tracking-wide transition-all cursor-pointer whitespace-nowrap active:scale-95 ${
                          sahaActiveTab === 'planlama'
                            ? 'bg-[#B91C1C] text-white shadow-sm'
                            : 'text-slate-600 hover:text-slate-900 bg-transparent hover:bg-slate-200/40'
                        }`}
                      >
                        Planlama
                        {getBadge(sahaCounts.planlama, sahaActiveTab === 'planlama')}
                      </button>
                      )}
                      {gateTab(SAHA_ARIZA_TAB_KEYS.saha) && (
                      <button
                        onClick={() => window.dispatchEvent(new CustomEvent('shell:saha-ariza-tab-change', { detail: 'saha' }))}
                        className={`relative px-2.5 py-1 rounded-lg text-center font-extrabold text-xs uppercase tracking-wide transition-all cursor-pointer whitespace-nowrap active:scale-95 ${
                          sahaActiveTab === 'saha'
                            ? 'bg-[#B91C1C] text-white shadow-sm'
                            : 'text-slate-600 hover:text-slate-900 bg-transparent hover:bg-slate-200/40'
                        }`}
                      >
                        Saha
                        {getBadge(sahaCounts.saha, sahaActiveTab === 'saha')}
                      </button>
                      )}
                      {gateTab(SAHA_ARIZA_TAB_KEYS.bekleyen) && (
                      <button
                        onClick={() => window.dispatchEvent(new CustomEvent('shell:saha-ariza-tab-change', { detail: 'bekleyen' }))}
                        className={`relative px-2.5 py-1 rounded-lg text-center font-extrabold text-xs uppercase tracking-wide transition-all cursor-pointer whitespace-nowrap active:scale-95 ${
                          sahaActiveTab === 'bekleyen'
                            ? 'bg-[#B91C1C] text-white shadow-sm'
                            : 'text-slate-600 hover:text-slate-900 bg-transparent hover:bg-slate-200/40'
                        }`}
                      >
                        Atölye
                        {getBadge(sahaCounts.bekleyen, sahaActiveTab === 'bekleyen')}
                      </button>
                      )}
                      {gateTab(SAHA_ARIZA_TAB_KEYS.aktif) && (
                      <button
                        onClick={() => window.dispatchEvent(new CustomEvent('shell:saha-ariza-tab-change', { detail: 'aktif' }))}
                        className={`relative px-2.5 py-1 rounded-lg text-center font-extrabold text-xs uppercase tracking-wide transition-all cursor-pointer whitespace-nowrap active:scale-95 ${
                          sahaActiveTab === 'aktif'
                            ? 'bg-[#B91C1C] text-white shadow-sm'
                            : 'text-slate-600 hover:text-slate-900 bg-transparent hover:bg-slate-200/40'
                        }`}
                      >
                        Teslimat Planlama
                        {getBadge(sahaCounts.aktif, sahaActiveTab === 'aktif')}
                      </button>
                      )}
                      {gateTab(SAHA_ARIZA_TAB_KEYS.teslimat) && (
                      <button
                        onClick={() => window.dispatchEvent(new CustomEvent('shell:saha-ariza-tab-change', { detail: 'teslimat' }))}
                        className={`relative px-2.5 py-1 rounded-lg text-center font-extrabold text-xs uppercase tracking-wide transition-all cursor-pointer whitespace-nowrap active:scale-95 ${
                          sahaActiveTab === 'teslimat'
                            ? 'bg-[#B91C1C] text-white shadow-sm'
                            : 'text-slate-600 hover:text-slate-900 bg-transparent hover:bg-slate-200/40'
                        }`}
                      >
                        Teslimattakiler
                        {getBadge(sahaCounts.teslimat, sahaActiveTab === 'teslimat')}
                      </button>
                      )}
                    </div>
                  )}

                  {location.pathname === '/atolye-ariza' && (
                    <div className="bg-slate-100 p-0.5 rounded-xl flex gap-0.5 items-center border border-slate-200/50">
                      {gateTab('atolyeAriza.atolye') && (
                      <button
                        onClick={() => window.dispatchEvent(new CustomEvent('shell:atolye-ariza-tab-change', { detail: 'bekleyen' }))}
                        className={`relative px-2.5 py-1 rounded-lg text-center font-extrabold text-xs uppercase tracking-wide transition-all cursor-pointer whitespace-nowrap active:scale-95 ${
                          atolyeActiveTab === 'bekleyen'
                            ? 'bg-[#B91C1C] text-white shadow-sm'
                            : 'text-slate-600 hover:text-slate-900 bg-transparent hover:bg-slate-200/40'
                        }`}
                      >
                        Atölye
                        {getBadge(atolyeCounts.bekleyen, atolyeActiveTab === 'bekleyen')}
                      </button>
                      )}
                      {gateTab('atolyeAriza.hazirTeslimat') && (
                      <button
                        onClick={() => window.dispatchEvent(new CustomEvent('shell:atolye-ariza-tab-change', { detail: 'aktif' }))}
                        className={`relative px-2.5 py-1 rounded-lg text-center font-extrabold text-xs uppercase tracking-wide transition-all cursor-pointer whitespace-nowrap active:scale-95 ${
                          atolyeActiveTab === 'aktif'
                            ? 'bg-[#B91C1C] text-white shadow-sm'
                            : 'text-slate-600 hover:text-slate-900 bg-transparent hover:bg-slate-200/40'
                        }`}
                      >
                        Teslimat Planlama
                        {getBadge(atolyeCounts.aktif, atolyeActiveTab === 'aktif')}
                      </button>
                      )}
                      {gateTab('atolyeAriza.teslimattakiler') && (
                      <button
                        onClick={() => window.dispatchEvent(new CustomEvent('shell:atolye-ariza-tab-change', { detail: 'teslimat' }))}
                        className={`relative px-2.5 py-1 rounded-lg text-center font-extrabold text-xs uppercase tracking-wide transition-all cursor-pointer whitespace-nowrap active:scale-95 ${
                          atolyeActiveTab === 'teslimat'
                            ? 'bg-[#B91C1C] text-white shadow-sm'
                            : 'text-slate-600 hover:text-slate-900 bg-transparent hover:bg-slate-200/40'
                        }`}
                      >
                        Teslimattakiler
                        {getBadge(atolyeCounts.teslimat, atolyeActiveTab === 'teslimat')}
                      </button>
                      )}
                    </div>
                  )}

                  {location.pathname === '/montaj-yonetimi' && (
                    <div className="bg-slate-100 p-0.5 rounded-xl flex gap-0.5 items-center border border-slate-200/50">
                      {gateTab('montajYonetimi.planlama') && (
                      <button
                        onClick={() => window.dispatchEvent(new CustomEvent('shell:montaj-yonetimi-tab-change', { detail: 'bekleyen' }))}
                        className={`relative px-2.5 py-1 rounded-lg text-center font-extrabold text-xs uppercase tracking-wide transition-all cursor-pointer whitespace-nowrap active:scale-95 ${
                          montajActiveTab === 'bekleyen'
                            ? 'bg-[#B91C1C] text-white shadow-sm'
                            : 'text-slate-600 hover:text-slate-900 bg-transparent hover:bg-slate-200/40'
                        }`}
                      >
                        Planlama
                        {getBadge(montajCounts.bekleyen, montajActiveTab === 'bekleyen')}
                      </button>
                      )}
                      {gateTab('montajYonetimi.teslimat') && (
                      <button
                        onClick={() => window.dispatchEvent(new CustomEvent('shell:montaj-yonetimi-tab-change', { detail: 'aktif' }))}
                        className={`relative px-2.5 py-1 rounded-lg text-center font-extrabold text-xs uppercase tracking-wide transition-all cursor-pointer whitespace-nowrap active:scale-95 ${
                          montajActiveTab === 'aktif'
                            ? 'bg-[#B91C1C] text-white shadow-sm'
                            : 'text-slate-600 hover:text-slate-900 bg-transparent hover:bg-slate-200/40'
                        }`}
                      >
                        Teslimattakiler
                        {getBadge(montajCounts.aktif, montajActiveTab === 'aktif')}
                      </button>
                      )}
                    </div>
                  )}

                  {location.pathname === '/kargo-takibi' && (
                    <div className="bg-slate-100 p-0.5 rounded-xl flex gap-0.5 items-center border border-slate-200/50">
                      <button
                        onClick={() => window.dispatchEvent(new CustomEvent('shell:kargo-takibi-tab-change', { detail: 'bekleyen' }))}
                        className={`relative px-2.5 py-1 rounded-lg text-center font-extrabold text-xs uppercase tracking-wide transition-all cursor-pointer whitespace-nowrap active:scale-95 ${
                          kargoActiveTab === 'bekleyen'
                            ? 'bg-[#B91C1C] text-white shadow-sm'
                            : 'text-slate-600 hover:text-slate-900 bg-transparent hover:bg-slate-200/40'
                        }`}
                      >
                        Planlama
                        {getBadge(kargoCounts.bekleyen, kargoActiveTab === 'bekleyen')}
                      </button>
                      <button
                        onClick={() => window.dispatchEvent(new CustomEvent('shell:kargo-takibi-tab-change', { detail: 'aktif' }))}
                        className={`relative px-2.5 py-1 rounded-lg text-center font-extrabold text-xs uppercase tracking-wide transition-all cursor-pointer whitespace-nowrap active:scale-95 ${
                          kargoActiveTab === 'aktif'
                            ? 'bg-[#B91C1C] text-white shadow-sm'
                            : 'text-slate-600 hover:text-slate-900 bg-transparent hover:bg-slate-200/40'
                        }`}
                      >
                        Dağıtımdakiler
                        {getBadge(kargoCounts.aktif, kargoActiveTab === 'aktif')}
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Mobile Quick Action Items */}
              <div className="flex items-center gap-1.5 shrink-0 ml-auto">
                {['/buyuk-urun-kabul', '/kucuk-urun-kabul', '/montaj-kabul'].includes(location.pathname) && (
                  <label className="flex items-center gap-1 px-2 py-1 bg-slate-100 border border-slate-200 rounded-lg text-[10px] font-bold text-slate-700 select-none cursor-pointer active:scale-95 whitespace-nowrap">
                    <input
                      type="checkbox"
                      checked={shellShowDelivered}
                      onChange={(e) => handleShowDeliveredChange(e.target.checked)}
                      className="w-3.5 h-3.5 text-[#B91C1C] border-gray-300 rounded focus:ring-[#B91C1C]/20"
                    />
                    <span>Gerçekleşenler</span>
                  </label>
                )}
                {PASSIVE_TOGGLE_ROUTES.includes(location.pathname) && (
                  <label className="flex items-center gap-1 px-2 py-1 bg-slate-100 border border-slate-200 rounded-lg text-[10px] font-bold text-slate-700 select-none cursor-pointer active:scale-95 whitespace-nowrap">
                    <input
                      type="checkbox"
                      checked={shellShowPassive}
                      onChange={(e) => handleShowPassiveChange(e.target.checked)}
                      className="w-3.5 h-3.5 text-[#B91C1C] border-gray-300 rounded focus:ring-[#B91C1C]/20"
                    />
                    <span>Pasifler</span>
                  </label>
                )}
                {location.pathname === '/montaj-kabul' && (
                  <label className="flex items-center gap-1 px-2 py-1 bg-slate-100 border border-slate-200 rounded-lg text-[10px] font-bold text-slate-700 select-none cursor-pointer active:scale-95 whitespace-nowrap">
                    <input
                      type="checkbox"
                      checked={shellShowCancelled}
                      onChange={(e) => handleShowCancelledChange(e.target.checked)}
                      className="w-3.5 h-3.5 text-[#B91C1C] border-gray-300 rounded focus:ring-[#B91C1C]/20"
                    />
                    <span>İptaller</span>
                  </label>
                )}
                {['/buyuk-urun-kabul', '/kucuk-urun-kabul', '/montaj-kabul', '/kargo-kabul'].includes(location.pathname) && canCreateInKabul && (
                  <button
                    type="button"
                    onClick={() => window.dispatchEvent(new CustomEvent(
                      location.pathname === '/kargo-kabul' ? 'shell:kargo-kabul-new' : 'shell:kabul-new'
                    ))}
                    className="flex items-center gap-1 px-2.5 py-1 bg-[#B91C1C] text-white rounded-lg text-[11px] font-extrabold shadow-xs cursor-pointer active:scale-95 whitespace-nowrap"
                  >
                    <span>+ Yeni Kayıt</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        <main className={`flex-1 min-w-0 pb-[calc(5rem+env(safe-area-inset-bottom,0px))] lg:pb-6 ${location.pathname === '/rota' ? 'lg:h-[calc(100vh-64px)] lg:overflow-hidden' : 'overflow-auto'} ${['/buyuk-urun-kabul', '/kucuk-urun-kabul', '/montaj-kabul', '/saha-ariza', '/atolye-ariza', '/montaj-yonetimi', '/montaj-gecmisi', '/kargo-kabul', '/kargo-takibi'].includes(location.pathname) ? 'p-0' : 'p-4 lg:p-6'}`}>
          {children}
        </main>
      </div>

      {/* Yeni iş atandı uyarısı */}
      {assignmentToast && (
        <div className="fixed bottom-4 right-4 z-[100] w-[min(360px,calc(100vw-2rem))]">
          <div className="bg-white rounded-2xl shadow-2xl border border-gray-200 overflow-hidden">
            <div className="flex items-start gap-3 p-4">
              <div className="w-9 h-9 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center shrink-0">
                <Bell className="w-5 h-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-bold text-gray-900">{assignmentToast.title}</div>
                <div className="text-xs text-gray-600 mt-0.5">{assignmentToast.message}</div>
                <button
                  onClick={() => { navigate('/bildirimler'); setAssignmentToast(null) }}
                  className="mt-2 text-xs font-semibold text-rose-600 hover:underline cursor-pointer"
                >
                  Bildirimlere git
                </button>
              </div>
              <button
                onClick={() => setAssignmentToast(null)}
                className="p-1 text-gray-400 hover:text-gray-700 rounded-lg cursor-pointer"
                aria-label="Kapat"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
