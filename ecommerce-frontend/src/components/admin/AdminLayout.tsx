import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { getAdminToken } from '../../lib/api'

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ')
}

export function AdminLayout({
  title,
  subtitle,
  top,
  children,
}: {
  title: string
  subtitle?: string
  top?: React.ReactNode
  children: React.ReactNode
}) {
  const nav = useNavigate()
  const loc = useLocation()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [unreadCount, setUnreadCount] = useState(0)

  useEffect(() => {
    async function fetchNotifications() {
      try {
        const token = getAdminToken()
        if (!token) return
        const res = await fetch('/api/admin/modules/notifications', {
          headers: { Authorization: `Bearer ${token}` }
        })
        if (res.ok) {
          const json = await res.json()
          if (json?.success && Array.isArray(json.data)) {
            const count = json.data.filter((n: any) => !n.isRead).length
            setUnreadCount(count)
          }
        }
      } catch (err) {
        console.error('Error fetching notifications count:', err)
      }
    }
    fetchNotifications()
    const interval = setInterval(fetchNotifications, 8000)
    return () => clearInterval(interval)
  }, [])

  const active = (path: string) => {
    if (path === '/admin') {
      return loc.pathname === '/admin' || loc.pathname === '/admin/products'
    }
    return loc.pathname === path || loc.pathname.startsWith(path + '/')
  }

  function logout() {
    localStorage.removeItem('ecom_admin_token')
    nav('/admin/login')
  }

  const token = getAdminToken()

  const navItems = [
    { to: '/admin/dashboard', label: 'Dashboard', icon: 'dashboard', group: 'Genel' },
    { to: '/admin/notifications', label: 'Bildirimler', icon: 'notifications', group: 'Genel' },

    { to: '/admin', label: 'Ürün Yönetimi', icon: 'shopping_bag', group: 'Katalog' },
    { to: '/admin/categories', label: 'Kategoriler', icon: 'category', group: 'Katalog' },
    { to: '/admin/brands', label: 'Markalar', icon: 'star', group: 'Katalog' },
    { to: '/admin/inventory', label: 'Stok Yönetimi', icon: 'warehouse', group: 'Katalog' },

    { to: '/admin/orders', label: 'Siparişler', icon: 'shopping_cart', group: 'Satış & Ödeme' },
    { to: '/admin/shipping', label: 'Kargo Takip', icon: 'local_shipping', group: 'Satış & Ödeme' },
    { to: '/admin/returns', label: 'İadeler & İptaller', icon: 'assignment_return', group: 'Satış & Ödeme' },
    { to: '/admin/invoices', label: 'Fatura Yönetimi', icon: 'description', group: 'Satış & Ödeme' },
    { to: '/admin/payments', label: 'Ödemeler & POS', icon: 'payments', group: 'Satış & Ödeme' },

    { to: '/admin/customers', label: 'Müşteriler', icon: 'group', group: 'Müşteri & İletişim' },
    { to: '/admin/reviews', label: 'Yorumlar', icon: 'chat', group: 'Müşteri & İletişim' },
    { to: '/admin/contact-messages', label: 'İletişim Talepleri', icon: 'question_answer', group: 'Müşteri & İletişim' },
    { to: '/admin/service-requests', label: 'Servis Talepleri', icon: 'build', group: 'Müşteri & İletişim' },
    { to: '/admin/warranties', label: 'Garanti Kodları', icon: 'verified', group: 'Müşteri & İletişim' },
    { to: '/admin/registered-products', label: 'Kayıtlı Ürünler', icon: 'app_registration', group: 'Müşteri & İletişim' },
    { to: '/admin/survey', label: 'Memnuniyet Anketi', icon: 'quiz', group: 'Müşteri & İletişim' },
    { to: '/admin/newsletter', label: 'Bülten Aboneleri', icon: 'mail', group: 'Müşteri & İletişim' },

    { to: '/admin/campaigns', label: 'Kampanyalar', icon: 'campaign', group: 'Pazarlama' },
    { to: '/admin/coupons', label: 'Kupon Tanımla', icon: 'confirmation_number', group: 'Pazarlama' },
    { to: '/admin/affiliate', label: 'Ortaklık (Affiliate)', icon: 'handshake', group: 'Pazarlama' },

    { to: '/admin/sliders', label: 'Slider Yönetimi', icon: 'slideshow', group: 'İçerik & Medya' },
    { to: '/admin/bento-campaigns', label: 'Bento Kampanyalar (Ana Sayfa)', icon: 'view_quilt', group: 'İçerik & Medya' },
    { to: '/admin/announcement', label: 'Duyuru Çubuğu', icon: 'campaign', group: 'İçerik & Medya' },
    { to: '/admin/banners', label: 'Banner Yönetimi', icon: 'view_carousel', group: 'İçerik & Medya' },
    { to: '/admin/grid-images', label: "4'lü Görsel", icon: 'grid_view', group: 'İçerik & Medya' },
    { to: '/admin/catalogs', label: 'PDF Kataloglar', icon: 'picture_as_pdf', group: 'İçerik & Medya' },
    { to: '/admin/media', label: 'Medya Kütüphanesi', icon: 'image', group: 'İçerik & Medya' },
    { to: '/admin/pages', label: 'Bilgi Sayfaları', icon: 'article', group: 'İçerik & Medya' },
    { to: '/admin/blog', label: 'Blog Yönetimi', icon: 'edit_note', group: 'İçerik & Medya' },

    { to: '/admin/integrations', label: 'Entegrasyonlar', icon: 'integration_instructions', group: 'Sistem' },
    { to: '/admin/settings', label: 'Site Ayarları', icon: 'settings', group: 'Sistem' },
  ]

  const SidebarContent = () => {
    const containerRef = useRef<HTMLDivElement>(null)

    useLayoutEffect(() => {
      const savedScroll = sessionStorage.getItem('admin_sidebar_scroll')
      if (savedScroll && containerRef.current) {
        containerRef.current.scrollTop = parseInt(savedScroll, 10)
      }
    }, [])

    const mappedItems = navItems.map((item) => {
      if (item.to === '/admin/notifications') {
        return {
          ...item,
          label: unreadCount > 0 ? `Bildirimler ${unreadCount}` : 'Bildirimler',
        }
      }
      return item
    })

    // Group items
    const groups = mappedItems.reduce((acc, item) => {
      acc[item.group] = acc[item.group] || []
      acc[item.group].push(item)
      return acc
    }, {} as Record<string, typeof navItems>)

    return (
      <div className="flex h-full flex-col justify-between bg-[#0d0d0d] text-white">
        <div
          ref={containerRef}
          onScroll={(e) => {
            sessionStorage.setItem('admin_sidebar_scroll', String(e.currentTarget.scrollTop))
          }}
          className="overflow-y-auto flex-1 custom-scrollbar"
        >
          <div className="flex items-center gap-2 border-b border-zinc-800 px-6 py-5">
            <div className="flex items-center gap-2">
              <div className="bg-[#df0000] text-white font-black px-4 py-1.5 rounded-lg text-lg uppercase tracking-tighter shadow-md shadow-[#df0000]/20">
                STILSOFT
              </div>
              <div className="text-xs font-bold text-zinc-400 uppercase tracking-widest leading-none">
                KIBRIS
                <span className="block text-[8px] text-zinc-500 font-normal">Yönetim</span>
              </div>
            </div>
          </div>

          <div className="py-2">
            {Object.entries(groups).map(([groupName, items]) => (
              <div key={groupName} className="space-y-0.5">
                <div className="px-6 py-2.5 text-[9px] font-extrabold tracking-wider text-zinc-550 uppercase">
                  {groupName}
                </div>
                <nav className="px-3 space-y-0.5">
                  {items.map((item) => {
                    const isItemActive = active(item.to)
                    return (
                      <Link
                        key={item.to}
                        to={item.to}
                        onClick={() => setMobileOpen(false)}
                        className={cx(
                          'flex items-center gap-3 rounded-lg px-3 py-2.5 text-[11px] font-bold transition-all border-l-4',
                          isItemActive
                            ? 'bg-[#df0000]/10 border-[#df0000] text-white'
                            : 'border-transparent text-zinc-455 hover:bg-white/5 hover:text-white',
                        )}
                      >
                        <span
                          className={cx(
                            'material-symbols-outlined text-[16px]',
                            isItemActive ? 'text-[#df0000]' : 'text-zinc-500'
                          )}
                        >
                          {item.icon}
                        </span>
                        <span className="truncate">{item.label}</span>
                      </Link>
                    )
                  })}
                </nav>
              </div>
            ))}
          </div>
        </div>

        <div className="border-t border-zinc-800 p-4 shrink-0 bg-[#0d0d0d]">
          <div className="flex items-center gap-3 mb-4 px-2">
            <div className="grid h-8 w-8 place-items-center rounded-full bg-zinc-800 text-zinc-300">
              <span className="material-symbols-outlined text-[18px]">admin_panel_settings</span>
            </div>
            <div className="min-w-0">
              <div className="truncate text-xs font-bold text-white">Yönetici</div>
              <div className="text-[10px] text-zinc-500">Stilsoft Panel</div>
            </div>
          </div>
          <button
            type="button"
            onClick={logout}
            disabled={!token}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs font-bold text-zinc-300 hover:bg-[#df0000] hover:text-white disabled:opacity-60 transition-colors"
          >
            <span className="material-symbols-outlined text-[16px]">logout</span>
            Çıkış Yap
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 font-inter">
      <div className="flex min-h-screen w-full">
        <aside className="hidden w-[260px] shrink-0 border-r border-zinc-800 bg-[#0d0d0d] lg:block">
          <div className="sticky top-0 h-screen">
            <SidebarContent />
          </div>
        </aside>

        {mobileOpen && (
          <div
            className="fixed inset-0 z-50 bg-black/50 lg:hidden"
            onClick={() => setMobileOpen(false)}
          />
        )}

        <aside
          className={cx(
            'fixed bottom-0 top-0 left-0 z-50 w-[280px] border-r border-zinc-800 bg-[#0d0d0d] transition-transform duration-300 ease-in-out lg:hidden',
            mobileOpen ? 'translate-x-0' : '-translate-x-full'
          )}
        >
          <SidebarContent />
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-40 border-b border-zinc-200 bg-white/90 backdrop-blur shadow-sm">
            <div className="flex items-center justify-between gap-3 px-4 py-4 lg:px-6">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setMobileOpen(true)}
                  className="grid h-10 w-10 place-items-center rounded-lg border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 lg:hidden"
                >
                  <span className="material-symbols-outlined">menu</span>
                </button>
                <div className="min-w-0">
                  <h1 className="truncate text-base lg:text-lg font-black tracking-tight text-zinc-950 uppercase">
                    {title}
                  </h1>
                  {subtitle ? (
                    <p className="truncate text-[11px] lg:text-xs font-medium text-zinc-500 mt-0.5">
                      {subtitle}
                    </p>
                  ) : null}
                </div>
              </div>
              <div className="flex min-w-0 items-center justify-end gap-2">{top ?? null}</div>
            </div>
          </header>

          <div className="flex-1 px-4 py-6 lg:px-6">{children}</div>
        </main>
      </div>
    </div>
  )
}
