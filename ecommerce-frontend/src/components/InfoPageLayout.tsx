import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useSEO } from '../hooks/useSEO'

export function InfoPageLayout({
  pageKey,
  title,
  seoDescription,
}: {
  pageKey: 'about-us' | 'kvkk' | 'privacy' | 'distance-selling' | 'returns' | 'help'
  title: string
  seoDescription: string
}) {
  useSEO({
    title: `${title} | Stilsoft KKTC`,
    description: seoDescription,
  })

  const loc = useLocation()
  const [contentHtml, setContentHtml] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    ;(async () => {
      setLoading(true)
      try {
        const res = await fetch(`/api/info-pages/${pageKey}`)
        const json = await res.json()
        if (res.ok && json?.data?.contentHtml) {
          setContentHtml(json.data.contentHtml)
        }
      } catch (err) {
        console.error('Bilgi sayfası yüklenemedi:', err)
      } finally {
        setLoading(false)
      }
    })()
  }, [pageKey])

  const menuItems = [
    { to: '/hakkimizda', label: 'Hakkımızda', icon: 'info' },
    { to: '/kvkk', label: 'KVKK Aydınlatma Metni', icon: 'gavel' },
    { to: '/gizlilik-politikasi', label: 'Gizlilik Politikası', icon: 'security' },
    { to: '/mesafeli-satis-sozlesmesi', label: 'Mesafeli Satış Sözleşmesi', icon: 'contract' },
    { to: '/iade-ve-degisim-kosullari', label: 'İade ve Değişim Koşulları', icon: 'keyboard_return' },
    { to: '/destek-sss', label: 'Destek / SSS', icon: 'help' },
  ]

  return (
    <div className="pb-24 bg-zinc-50 min-h-screen">
      {/* Page Header Banner */}
      <section className="bg-zinc-950 text-white py-16 px-6 mb-12 border-b border-zinc-900">
        <div className="max-w-7xl mx-auto">
          <nav className="flex text-xs text-zinc-500 gap-1.5 mb-3 font-medium">
            <Link to="/" className="hover:text-white transition-colors">Anasayfa</Link>
            <span className="material-symbols-outlined text-[14px]">chevron_right</span>
            <span className="text-primary font-semibold">{title}</span>
          </nav>
          <h1 className="text-3xl md:text-4xl font-black tracking-tight leading-none uppercase">{title}</h1>
        </div>
      </section>

      {/* Main Content Layout */}
      <div className="max-w-7xl mx-auto px-6">
        <div className="grid gap-8 lg:grid-cols-12">
          {/* Sticky Sidebar Navigation */}
          <aside className="lg:col-span-3">
            <div className="bg-white rounded-3xl border border-zinc-200/80 p-5 shadow-sm sticky top-[90px] space-y-1.5">
              <p className="text-[10px] font-extrabold text-zinc-400 uppercase tracking-widest px-3 mb-3">
                KURUMSAL & YASAL
              </p>
              <nav className="space-y-1">
                {menuItems.map((item) => {
                  const isActive = loc.pathname === item.to
                  return (
                    <Link
                      key={item.to}
                      to={item.to}
                      className={`flex items-center gap-3 px-4 py-3 text-xs font-bold rounded-2xl transition-all duration-200 border-l-4 active:scale-[0.98] ${
                        isActive
                          ? 'bg-primary/5 border-primary text-zinc-950 font-extrabold'
                          : 'border-transparent text-zinc-500 hover:bg-zinc-50 hover:text-zinc-950'
                      }`}
                    >
                      <span className={`material-symbols-outlined text-[18px] ${isActive ? 'text-primary' : 'text-zinc-400'}`}>
                        {item.icon}
                      </span>
                      <span>{item.label}</span>
                    </Link>
                  )
                })}
              </nav>
            </div>
          </aside>

          {/* Page Rich Text Article Card */}
          <main className="lg:col-span-9">
            <div className="bg-white rounded-3xl border border-zinc-200/80 p-8 md:p-12 shadow-sm min-h-[500px]">
              {loading ? (
                <div className="flex flex-col items-center justify-center py-24">
                  <div className="w-10 h-10 border-4 border-zinc-200 border-t-primary rounded-full animate-spin mb-3" />
                  <span className="text-xs text-zinc-400 font-medium">Sayfa içeriği yükleniyor...</span>
                </div>
              ) : contentHtml ? (
                <article
                  className="space-y-4 text-zinc-650 text-sm leading-relaxed 
                    [&_h1]:text-2xl [&_h1]:font-black [&_h1]:text-zinc-950 [&_h1]:tracking-tight [&_h1]:uppercase [&_h1]:mb-5 [&_h1]:border-b [&_h1]:pb-2 [&_h1]:border-zinc-100
                    [&_h2]:text-lg [&_h2]:font-bold [&_h2]:text-zinc-900 [&_h2]:tracking-tight [&_h2]:uppercase [&_h2]:mt-8 [&_h2]:mb-4
                    [&_h3]:text-base [&_h3]:font-bold [&_h3]:text-zinc-800 [&_h3]:mt-6 [&_h3]:mb-3
                    [&_p]:mb-4 [&_p]:leading-relaxed
                    [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:space-y-2 [&_ul]:mb-5 [&_ul]:text-zinc-650
                    [&_ol]:list-decimal [&_ol]:pl-6 [&_ol]:space-y-2 [&_ol]:mb-5 [&_ol]:text-zinc-650
                    [&_li]:pl-1
                    [&_a]:text-primary [&_a]:font-bold [&_a]:underline hover:[&_a]:text-primary-container"
                  dangerouslySetInnerHTML={{ __html: contentHtml }}
                />
              ) : (
                <div className="flex flex-col items-center justify-center py-20 text-zinc-400 text-xs">
                  <span className="material-symbols-outlined text-4xl mb-2 text-zinc-350">article</span>
                  <span>Bu sayfa için henüz bir içerik girilmemiş.</span>
                </div>
              )}
            </div>
          </main>
        </div>
      </div>
    </div>
  )
}
