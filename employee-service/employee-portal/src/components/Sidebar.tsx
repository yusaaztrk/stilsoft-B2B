import React, { useMemo, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Calendar, LogOut, Menu, QrCode, Users, X, Compass, LayoutDashboard, CalendarDays, Wallet, Clock, Gift, HandCoins, UtensilsCrossed, Scale, Landmark, ScanFace } from 'lucide-react'
import { ArrowLeftRight } from 'lucide-react'
import { useTenantBranding } from '../hooks/useTenantBranding'
import { canViewPage, clearSessionPermissions, isErpManagerSession } from '../utils/portalPermissions'
import { erpAppBaseUrl, serviceOpsAppBaseUrl } from '../config/api'

/**
 * PANEL GEÇİŞ DÜĞMELERİ — görünürlük YETKİYE bağlı.
 *
 * Düğmeler yalnızca ERP'den devralınmış bir yönetici oturumunda çıkar
 * (`portalIsErpManager`). Şifresiyle giren bir PERSONELİN bayi ya da servis panelinde işi
 * yoktur; ona gösterilen düğme, tıklayınca giriş ekranıyla karşılaşacağı ölü bir bağlantı olur.
 *
 * İkisinde de token TAŞINMAZ. Her panel kendi alan adında ayrı bir oturum tutuyor
 * (`erp.<alan>`, `servis.<alan>`); kullanıcı oraya bir kez girmişse oturum hâlâ açıktır ve
 * düz gitmek yeter, girmemişse zaten o panelin giriş ekranını görmesi doğrudur.
 *
 * İlk sürüm "Servis'e Geç"i devirle alınan ham ERP token'ına bağlamıştı: devir herhangi bir
 * sebeple tamamlanmazsa token hiç yazılmıyor ve düğme SESSİZCE kayboluyordu — kullanıcının
 * "servise geç butonu yok" şikâyeti tam olarak buydu. Görünürlüğü, oluşup oluşmayacağı belirsiz
 * bir yan ürüne bağlamak yerine oturumun kendisine bağlamak doğrusu.
 */
function switchTargets(): { erp: string; servis: string } {
  if (!isErpManagerSession()) return { erp: '', servis: '' }
  return { erp: erpAppBaseUrl(), servis: serviceOpsAppBaseUrl() }
}

export default function Sidebar() {
  const location = useLocation()
  const navigate = useNavigate()
  const [isOpen, setIsOpen] = useState(false)
  const { branding } = useTenantBranding()

  // Oturum boyunca degismez: kimlik ve devir token'i girise yazilir.
  const switchLinks = useMemo(() => switchTargets(), [])

  const role = useMemo(() => {
    try {
      const v = String(localStorage.getItem('portalLoginAs') ?? '').trim().toLowerCase()
      return v === 'employee' ? 'employee' : 'admin'
    } catch {
      return 'admin'
    }
  }, [])

  const tenantName = useMemo(() => {
    try {
      return String(localStorage.getItem('tenantName') ?? '').trim()
    } catch {
      return ''
    }
  }, [])

  const userName = useMemo(() => {
    try {
      return String(localStorage.getItem('userName') ?? sessionStorage.getItem('userName') ?? '').trim()
    } catch {
      return ''
    }
  }, [])

  const tenantSearchString = useMemo(() => {
    if (location.search && location.search.includes('tenant=')) {
      return location.search
    }
    const saved = localStorage.getItem('employee_portal_tenant') || localStorage.getItem('tenantCode')
    return saved ? `?tenant=${encodeURIComponent(saved)}` : ''
  }, [location.search])

  const menuItems = useMemo(() => {
    if (role === 'employee') {
      return [
        {
          label: 'Giriş / Çıkış Paneli',
          path: `/qr-checkin${tenantSearchString}`,
          icon: QrCode,
          description: 'Hızlı mesai kaydı ve durum'
        },
        {
          label: 'Takvim & Ödemeler',
          path: `/me${tenantSearchString}`,
          icon: Calendar,
          description: 'Çalışma planı ve hakedişler'
        }
      ]
    } else {
      return [
        {
          label: 'Dashboard',
          path: '/dashboard',
          pageKey: 'personelPanel',
          icon: LayoutDashboard,
          description: 'İstatistikler ve genel analiz'
        },
        {
          label: 'Çalışan Yönetimi',
          path: '/employees',
          pageKey: 'personelCalisanlar',
          icon: Users,
          description: 'Personel, izinler, hakedişler'
        },
        {
          label: 'İzin Yönetimi',
          path: '/leaves',
          pageKey: 'personelIzinler',
          icon: CalendarDays,
          description: 'Talepleri onayla, izin takvimini gör'
        },
        {
          label: 'Hakedişler',
          path: '/accruals',
          pageKey: 'personelHakedis',
          icon: Wallet,
          description: 'Puantaj, fazla mesai ve ödenecek tutar'
        },
        {
          label: 'Cari Ekstre',
          path: '/ledger',
          pageKey: 'personelEkstre',
          icon: Scale,
          description: 'Kime ne kadar borçluyuz',
          section: 'ÖDEMELER'
        },
        {
          label: 'Maaş Ödemeleri',
          path: '/payments/salary',
          pageKey: 'personelMaas',
          icon: Wallet,
          description: 'Maaş yatır ve dökümünü gör'
        },
        {
          label: 'Avanslar',
          path: '/payments/advance',
          pageKey: 'personelAvans',
          icon: HandCoins,
          description: 'Avans ver, mahsup durumunu izle'
        },
        {
          label: 'Prim Ödemeleri',
          path: '/payments/bonus',
          pageKey: 'personelPrim',
          icon: Gift,
          description: 'Bekleyen primleri öde'
        },
        {
          label: 'Yemek Ödemeleri',
          path: '/payments/meal',
          pageKey: 'personelYemek',
          icon: UtensilsCrossed,
          description: 'Yemek bedeli ödemeleri'
        },
        {
          label: 'Kasa Hareketleri',
          path: '/cash-transactions',
          pageKey: 'personelKasa',
          icon: Landmark,
          description: 'Personel ödemelerinin kasa/banka dökümü'
        },
        {
          label: 'Mesai Tanımları',
          section: 'AYARLAR',
          path: '/work-schedules',
          pageKey: 'personelMesaiTanimlari',
          icon: Clock,
          description: 'Haftalık mesai blokları ve saat katsayıları'
        },
        {
          label: 'Tatil Takvimi',
          path: '/work-calendar',
          pageKey: 'personelTatilTakvimi',
          icon: CalendarDays,
          description: 'Resmî ve firma tatilleri'
        },
        {
          label: 'Yüz ile Giriş Linki',
          path: '/face-link',
          pageKey: 'personelYuzLink',
          icon: ScanFace,
          description: 'Anonim yüz tanıma linki ve QR'
        },
        {
          label: 'QR Test & Üretici',
          path: '/qr-test',
          pageKey: 'personelQrTest',
          icon: QrCode,
          description: 'Günlük mesai QR araçları'
        },
        {
          label: 'Konum Ayarları',
          path: '/location-settings',
          pageKey: 'personelKonumAyarlari',
          icon: Compass,
          description: 'GPS ve mesafe sınırlandırması'
        }
      ].filter((item) => !item.pageKey || canViewPage(item.pageKey))
    }
  }, [role, tenantSearchString])

  const logout = () => {
    try {
      localStorage.removeItem('accessToken')
      localStorage.removeItem('refreshToken')
      localStorage.removeItem('userName')
      localStorage.removeItem('currentCode')
      localStorage.removeItem('tenantCode')
      localStorage.removeItem('tenantName')
      // Devir token'i oturumla birlikte gider: cikan kullanicinin bayi token'ini birakmak,
      // sonra giren baska birine "Servis'e Gec" ile onun oturumunu acardi.
      localStorage.removeItem('erpHandoverToken')
      sessionStorage.removeItem('userName')
    } catch {}
    clearSessionPermissions()
    navigate('/login', { replace: true })
  }

  return (
    <>
      {/* Mobile Header Bar */}
      <div className="md:hidden sticky top-0 z-50 bg-[#121212] border-b border-neutral-800 h-16 flex items-center justify-between px-4">
        <div className="flex items-center gap-3">
          <div className="relative flex flex-col items-start pt-1">
            <img
              src="/s-logo-white.png"
              alt="STILSOFT"
              className="h-7 w-auto object-contain filter brightness-0 invert"
              onError={(e) => {
                e.currentTarget.src = '/stilsoft-logo.png'
              }}
            />
            <span className="loading-handwriting text-orange-400 font-extrabold text-xl -mt-3.5 ml-10 transform -rotate-6 tracking-wide select-none">
              personel
            </span>
          </div>
          <span className="px-1.5 py-0.5 rounded border border-[#c5a059] text-[#c5a059] text-[9px] font-medium tracking-wider uppercase ml-1">
            {role === 'admin' ? 'YÖNETİCİ' : 'ÇALIŞAN'}
          </span>
        </div>

        <button
          onClick={() => setIsOpen((prev) => !prev)}
          className="p-2 rounded text-neutral-400 hover:text-white"
          aria-label="Menü"
        >
          {isOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>

      {/* Mobile Backdrop */}
      {isOpen && (
        <div
          onClick={() => setIsOpen(false)}
          className="md:hidden fixed inset-0 z-40 bg-black/80 backdrop-blur-xs transition-opacity"
        />
      )}

      {/* Main Sidebar */}
      <aside
        className={`fixed md:sticky top-0 left-0 z-40 h-screen w-[260px] shrink-0 flex flex-col bg-[#121212] text-white border-r border-[#222222] transition-all duration-300 ease-out transform md:transform-none ${
          isOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
        }`}
      >
        {/* Brand Header */}
        <div className="p-6 border-b border-[#222222]/80">
          <div className="space-y-2.5">
            <Link to="/" className="inline-block outline-none group">
              <div className="relative flex flex-col items-start pt-1">
                <img
                  src="/s-logo-white.png"
                  alt="STILSOFT"
                  className="h-8 w-auto object-contain filter brightness-0 invert"
                  onError={(e) => {
                    e.currentTarget.src = '/stilsoft-logo.png'
                  }}
                />
                <span className="loading-handwriting text-orange-400 font-extrabold text-2xl -mt-3.5 ml-11 transform -rotate-6 tracking-wide select-none drop-shadow-sm">
                  personel
                </span>
              </div>
            </Link>

            <div className="flex items-center gap-2 pt-0.5">
              <span className="px-1.5 py-0.5 border border-[#c5a059]/80 text-[#c5a059] text-[9px] font-semibold tracking-widest uppercase rounded-sm">
                {role === 'admin' ? 'YÖNETİCİ' : 'ÇALIŞAN'}
              </span>
              <span className="text-[11px] text-neutral-400 font-normal leading-tight font-sans">
                İnsan Kaynakları Konsolü
              </span>
            </div>
          </div>
        </div>




        {/* Navigation */}
        <nav className="flex-1 px-4 py-6 space-y-4 overflow-y-auto scrollbar-none">
          <div className="text-[10px] font-medium tracking-[0.22em] text-neutral-500 uppercase px-2 mb-3">
            NAVİGASYON
          </div>

          <div className="space-y-2">
            {menuItems.map((item) => {
              const isActive = location.pathname === item.path.split('?')[0]
              const section = (item as { section?: string }).section
              return (
                <React.Fragment key={item.path}>
                  {/* Bolum basligi: menu uzadikca hangi isin nerede oldugu kaybolmasin. */}
                  {section && (
                    <div className="text-[10px] font-medium tracking-[0.22em] text-neutral-500 uppercase px-2 pt-4 pb-1">
                      {section}
                    </div>
                  )}
                <Link
                  to={item.path}
                  onClick={() => setIsOpen(false)}
                  className={`block transition-all duration-150 pl-3.5 py-2 ${
                    isActive
                      ? 'border-l-2 border-[#c5a059] text-white'
                      : 'border-l-2 border-transparent text-neutral-400 hover:text-white'
                  }`}
                >
                  <div className={`text-[13px] tracking-tight ${isActive ? 'font-semibold text-white' : 'font-normal text-neutral-300 hover:text-white'}`}>
                    {item.label}
                  </div>
                  <div className="text-[11px] text-neutral-500 font-normal mt-0.5 leading-snug">
                    {item.description}
                  </div>
                </Link>
                </React.Fragment>
              )
            })}
          </div>
        </nav>

        {/* User Card & Footer */}
        <div className="p-5 border-t border-[#222222]/80 space-y-3 bg-[#0d0d0d]">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-medium text-neutral-500 tracking-[0.2em] uppercase">
              GİRİŞ YAPILDI
            </span>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-emerald-400 font-medium lowercase">çevrimiçi</span>
            </div>
          </div>

          <div className="text-xs font-semibold text-white font-sans truncate" title={userName}>
            {userName || 'hayri.demirci'}
          </div>

          {(switchLinks.erp || switchLinks.servis) && (
            <div className="mt-1 pt-2 border-t border-[#222222] space-y-1.5">
              {switchLinks.erp && (
                <button
                  onClick={() => window.location.assign(switchLinks.erp)}
                  className="w-full text-neutral-400 hover:text-white text-[11px] font-medium flex items-center justify-between transition-colors"
                >
                  <span>BAYİ'YE GEÇ</span>
                  <ArrowLeftRight size={12} />
                </button>
              )}
              {switchLinks.servis && (
                <button
                  onClick={() => window.location.assign(switchLinks.servis)}
                  className="w-full text-neutral-400 hover:text-white text-[11px] font-medium flex items-center justify-between transition-colors"
                >
                  <span>SERVİS'E GEÇ</span>
                  <ArrowLeftRight size={12} />
                </button>
              )}
            </div>
          )}

          <button
            onClick={logout}
            className="w-full mt-1 pt-2 border-t border-[#222222] text-neutral-500 hover:text-neutral-300 text-[11px] font-normal flex items-center justify-between transition-colors"
          >
            <span>Oturumu Kapat</span>
            <LogOut size={12} />
          </button>
        </div>
      </aside>
    </>
  )
}



