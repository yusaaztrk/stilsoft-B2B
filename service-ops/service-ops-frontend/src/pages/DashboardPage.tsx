import React, { useMemo, useRef, useCallback, useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowRight,
  BarChart3,
  Building2,
  Calendar,
  CalendarDays,
  Clock,
  Home,
  MapPin,
  Package,
  Printer,
  Receipt,
  Settings,
  Shield,
  Truck,
  User,
  Users,
  Wrench,
  Zap
} from 'lucide-react'
import { usePermissions } from '../auth/PermissionsContext'
import { getUsername, getUserRole } from '../auth/storage'

/* ───────────────────────── types ───────────────────────── */

type HomeCard = {
  key: string
  title: string
  subtitle: string
  tag: string
  color: string
  colorMid: string
  colorSoft: string
  to: string
  icon: React.ComponentType<any>
}

/* ───────────────────────── helpers ───────────────────────── */

function getGreeting() {
  const h = new Date().getHours()
  if (h < 6) return 'İyi geceler'
  if (h < 12) return 'Günaydın'
  if (h < 18) return 'İyi günler'
  if (h < 22) return 'İyi akşamlar'
  return 'İyi geceler'
}

function getEmoji() {
  const h = new Date().getHours()
  if (h < 6) return '🌙'
  if (h < 12) return '☀️'
  if (h < 18) return '🌤️'
  if (h < 22) return '🌆'
  return '🌙'
}

/* ───────────────────────── LiveClock ───────────────────────── */

function LiveClock() {
  const [now, setNow] = useState(new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])
  return (
    <span className="tabular-nums font-semibold">
      {now.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
    </span>
  )
}

/* ───────────────────────── ModuleCard ───────────────────────── */

function ModuleCard({ card, index, onClick }: { card: HomeCard; index: number; onClick: () => void }) {
  const ref = useRef<HTMLButtonElement>(null)
  const glowRef = useRef<HTMLDivElement>(null)
  const Icon = card.icon

  const handleClick = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    const btn = ref.current
    if (!btn) { onClick(); return }
    const rect = btn.getBoundingClientRect()
    const x = e.clientX - rect.left, y = e.clientY - rect.top
    const ripple = document.createElement('span')
    const sz = Math.max(rect.width, rect.height) * 2.5
    ripple.style.cssText = `position:absolute;left:${x - sz / 2}px;top:${y - sz / 2}px;width:${sz}px;height:${sz}px;border-radius:50%;background:${card.colorMid};transform:scale(0);animation:hp-ripple .55s cubic-bezier(.4,0,.2,1) forwards;pointer-events:none;z-index:20;opacity:.4;`
    btn.appendChild(ripple)
    ripple.addEventListener('animationend', () => ripple.remove())
    setTimeout(onClick, 140)
  }, [onClick, card.colorMid])

  const handleMove = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    const btn = ref.current, glow = glowRef.current
    if (!btn) return
    const rect = btn.getBoundingClientRect()
    const px = e.clientX - rect.left, py = e.clientY - rect.top
    const rx = ((px / rect.width) - 0.5) * 8
    const ry = ((py / rect.height) - 0.5) * 8
    btn.style.transform = `perspective(800px) translateY(-5px) scale(1.02) rotateX(${-ry}deg) rotateY(${rx}deg)`
    if (glow) glow.style.background = `radial-gradient(circle 160px at ${px}px ${py}px, ${card.colorMid}, transparent 70%)`
  }, [card.colorMid])

  const handleLeave = useCallback(() => {
    const btn = ref.current, glow = glowRef.current
    if (btn) btn.style.transform = ''
    if (glow) glow.style.background = 'none'
  }, [])

  return (
    <button
      ref={ref}
      type="button"
      onClick={handleClick}
      onMouseMove={handleMove}
      onMouseLeave={handleLeave}
      className="hp-card group relative overflow-hidden rounded-[20px] text-left focus:outline-none transition-all duration-300"
      style={{ animation: `hp-card-in .55s cubic-bezier(.16,1,.3,1) both ${index * 60}ms` }}
    >
      {/* Animated gradient border */}
      <div className="absolute -inset-[1px] rounded-[20px] hp-border-anim opacity-0 group-hover:opacity-100 transition-opacity duration-500" style={{ background: `conic-gradient(from var(--hp-angle,0deg), ${card.color}, ${card.colorMid}, ${card.colorSoft}, ${card.color})` }} />

      {/* Cursor-following spotlight */}
      <div ref={glowRef} className="absolute inset-0 rounded-[20px] opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none z-[1]" />

      {/* Card body */}
      <div className="hp-card-body relative h-full rounded-[19px] border border-gray-200/80 overflow-hidden z-[2]" style={{ background: `linear-gradient(160deg, #ffffff 0%, #fefefe 50%, ${card.colorSoft} 100%)` }}>

        {/* Ambient glow bottom-right */}
        <div className="absolute -bottom-8 -right-8 w-40 h-40 rounded-full opacity-30 group-hover:opacity-60 transition-opacity duration-700 pointer-events-none blur-2xl" style={{ background: card.color }} />

        {/* Top accent strip */}
        <div className="absolute top-0 left-0 right-0 h-[3px] origin-left scale-x-0 group-hover:scale-x-100 transition-transform duration-500" style={{ background: `linear-gradient(90deg, ${card.color}, ${card.colorMid}, ${card.colorSoft})` }} />

        {/* Content */}
        <div className="relative h-full flex flex-col p-5 z-[4]">

          {/* Icon + badge */}
          <div className="flex items-start justify-between mb-auto">
            <div className="relative">
              <div className="relative h-[48px] w-[48px] rounded-2xl flex items-center justify-center transition-all duration-300 group-hover:scale-110 group-hover:rotate-[-4deg] shadow-xs group-hover:shadow-md" style={{ background: `linear-gradient(135deg, ${card.colorSoft}, ${card.colorMid})` }}>
                <Icon size={22} style={{ color: card.color }} strokeWidth={2} className="transition-transform duration-300 group-hover:scale-110" />
              </div>
            </div>

            <span className="hp-tag px-3 py-1 rounded-full text-[10px] font-bold tracking-wider uppercase border transition-all duration-300" style={{ color: card.color, backgroundColor: card.colorSoft, borderColor: card.colorMid }}>
              {card.tag}
            </span>
          </div>

          {/* Text */}
          <div className="mt-4">
            <h3 className="text-[15px] font-extrabold text-gray-900 leading-tight tracking-tight group-hover:text-gray-800">
              {card.title}
            </h3>
            <p className="mt-1 text-[12px] text-gray-500 leading-relaxed font-medium">
              {card.subtitle}
            </p>

            {/* CTA */}
            <div className="mt-3 flex items-center gap-2 opacity-0 translate-y-3 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-300 ease-out">
              <span className="text-[11px] font-bold tracking-wide" style={{ color: card.color }}>Sayfaya Git</span>
              <div className="h-5 w-5 rounded-full flex items-center justify-center transition-all duration-300 group-hover:translate-x-1 shadow-xs" style={{ background: `linear-gradient(135deg, ${card.colorMid}, ${card.colorSoft})` }}>
                <ArrowRight size={10} style={{ color: card.color }} strokeWidth={2.5} />
              </div>
            </div>
          </div>

        </div>
      </div>
    </button>
  )
}

/* ───────────────────────── DashboardPage ───────────────────────── */

export default function DashboardPage() {
  const navigate = useNavigate()
  const { loaded: permissionsLoaded, canOpen, isSuperAdmin } = usePermissions()
  const username = getUsername() || 'Kullanıcı'
  const userRole = getUserRole() || 'Admin'

  const hasPagePermission = (to: string | undefined) => {
    if (!to || to === '#' || to.startsWith('http')) return true
    if (isSuperAdmin || userRole.toLowerCase() === 'superadmin' || userRole.toLowerCase() === 'supersuperadmin') return true
    return canOpen(to)
  }

  const allCards = useMemo<HomeCard[]>(() => [
    { key: 'montajKabul', title: 'Montaj Kabul', subtitle: 'Yeni montaj talebi ve evrak girişi', tag: 'Montaj', color: '#E11D48', colorMid: 'rgba(225,29,72,0.15)', colorSoft: 'rgba(225,29,72,0.06)', to: '/montaj-kabul', icon: Package },
    { key: 'montajYonetimi', title: 'Montaj Planlama', subtitle: 'Montaj ve kurulum operasyonları', tag: 'Montaj', color: '#F43F5E', colorMid: 'rgba(244,63,94,0.15)', colorSoft: 'rgba(244,63,94,0.06)', to: '/montaj-yonetimi', icon: Wrench },
    { key: 'buyukEvKabul', title: 'Beyaz Eşya Arıza Kabul', subtitle: 'Beyaz eşya servis kabulü', tag: 'Beyaz Eşya', color: '#F97316', colorMid: 'rgba(249,115,22,0.15)', colorSoft: 'rgba(249,115,22,0.06)', to: '/buyuk-urun-kabul', icon: Package },
    { key: 'sahaAriza', title: 'Beyaz Eşya Arıza Planlama', subtitle: 'Beyaz eşya arıza onarım ve servis takibi', tag: 'Beyaz Eşya', color: '#F59E0B', colorMid: 'rgba(245,158,11,0.15)', colorSoft: 'rgba(245,158,11,0.06)', to: '/saha-ariza', icon: MapPin },
    { key: 'kucukEvKabul', title: 'Küçük Ürün Kabul', subtitle: 'Küçük ürün atölye kabulü', tag: 'Atölye', color: '#0EA5E9', colorMid: 'rgba(14,165,233,0.15)', colorSoft: 'rgba(14,165,233,0.06)', to: '/kucuk-urun-kabul', icon: Package },
    { key: 'atolyeAriza', title: 'Küçük Ürün Planlama', subtitle: 'Atölye tamir ve arıza kayıtları', tag: 'Atölye', color: '#06B6D4', colorMid: 'rgba(6,182,212,0.15)', colorSoft: 'rgba(6,182,212,0.06)', to: '/atolye-ariza', icon: Wrench },
    { key: 'kargoTakibi', title: 'Kargo Takibi', subtitle: 'Gelen & giden kargo takibi', tag: 'Kargo', color: '#8B5CF6', colorMid: 'rgba(139,92,246,0.15)', colorSoft: 'rgba(139,92,246,0.06)', to: '/kargo-takibi', icon: Truck },
    { key: 'kargoPlanlama', title: 'Kargo Planlama', subtitle: 'Sevkiyat ve teslimat planlaması', tag: 'Kargo', color: '#6366F1', colorMid: 'rgba(99,102,241,0.15)', colorSoft: 'rgba(99,102,241,0.06)', to: '/kargo-planlama', icon: Calendar },
    { key: 'teknisyenler', title: 'Teknisyenler', subtitle: 'Saha teknisyen listesi ve durumu', tag: 'Saha Ekibi', color: '#10B981', colorMid: 'rgba(16,185,129,0.15)', colorSoft: 'rgba(16,185,129,0.06)', to: '/teknisyenler', icon: Users },
    { key: 'stok', title: 'Stok Yönetimi', subtitle: 'Yedek parça ve şema entegrasyonu', tag: 'Sistem', color: '#3B82F6', colorMid: 'rgba(59,130,246,0.15)', colorSoft: 'rgba(59,130,246,0.06)', to: '/stok', icon: Home },
    { key: 'aracDepolari', title: 'Araç Depoları', subtitle: 'Teknisyen araç içi stok takibi', tag: 'Sistem', color: '#2563EB', colorMid: 'rgba(37,99,235,0.15)', colorSoft: 'rgba(37,99,235,0.06)', to: '/arac-depolari', icon: Truck },
    { key: 'musteriler', title: 'Müşteriler / Bayiler', subtitle: 'Cari adres rehberi ve bayiler', tag: 'Sistem', color: '#4F46E5', colorMid: 'rgba(79,70,229,0.15)', colorSoft: 'rgba(79,70,229,0.06)', to: '/musteriler', icon: Users },
    { key: 'raporlar', title: 'Raporlar & Analiz', subtitle: 'Servis performans ve analizler', tag: 'Yönetim', color: '#475569', colorMid: 'rgba(71,85,105,0.15)', colorSoft: 'rgba(71,85,105,0.06)', to: '/raporlar', icon: BarChart3 },
    { key: 'ayarlar', title: 'Ayarlar', subtitle: 'Kullanıcı yetkileri ve sistem ayarları', tag: 'Yönetim', color: '#64748B', colorMid: 'rgba(100,116,139,0.15)', colorSoft: 'rgba(100,116,139,0.06)', to: '/ayarlar', icon: Settings },
  ], [])

  const visibleCards = useMemo(() => {
    return allCards.filter(c => hasPagePermission(c.to))
  }, [allCards, permissionsLoaded, isSuperAdmin])

  const dateStr = new Date().toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

  useEffect(() => {
    let angle = 0, raf = 0
    const tick = () => {
      angle = (angle + 0.8) % 360
      document.documentElement.style.setProperty('--hp-angle', `${angle}deg`)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <div className="max-w-[1240px] mx-auto font-outfit py-2">
      <style>{`
        @keyframes hp-ripple { to { transform:scale(1); opacity:0 } }
        @keyframes hp-card-in {
          from { opacity:0; transform:translateY(24px) scale(.95) }
          to   { opacity:1; transform:translateY(0)   scale(1)   }
        }
        @keyframes hp-hero-in {
          from { opacity:0; transform:translateY(-12px) }
          to   { opacity:1; transform:translateY(0)     }
        }
        @keyframes hp-float {
          0%,100% { transform:translateY(0) }
          50%     { transform:translateY(-6px) }
        }
        .hp-card {
          cursor:pointer;
          height:200px;
        }
        .hp-card:hover { z-index:2; box-shadow: 0 20px 40px -12px rgba(0,0,0,.08); }
      `}</style>

      {/* Hero Banner */}
      <div
        className="relative rounded-[24px] overflow-hidden mb-8 px-6 sm:px-8 py-8 sm:py-10 border border-gray-200/80 shadow-xs"
        style={{
          background: 'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 50%, #e2e8f0 100%)',
          animation: 'hp-hero-in .6s cubic-bezier(.16,1,.3,1) both'
        }}
      >
        <div className="absolute top-0 left-0 w-64 h-64 rounded-full pointer-events-none opacity-[0.08]" style={{ background: 'radial-gradient(circle, #e11d48, transparent 70%)', filter: 'blur(40px)' }} />
        <div className="absolute bottom-0 right-0 w-48 h-48 rounded-full pointer-events-none opacity-[0.06]" style={{ background: 'radial-gradient(circle, #0ea5e9, transparent 70%)', filter: 'blur(40px)' }} />

        <div className="relative flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div className="flex-1">
            {/* Date + Clock */}
            <div className="flex items-center gap-3 mb-3">
              <div className="flex items-center gap-1.5 text-[11px] text-gray-500 font-semibold">
                <CalendarDays size={13} className="text-gray-400" />
                <span className="capitalize">{dateStr}</span>
              </div>
              <div className="w-px h-3 bg-gray-300" />
              <div className="flex items-center gap-1.5 text-[11px] text-gray-500 font-semibold">
                <Clock size={13} className="text-gray-400" />
                <LiveClock />
              </div>
            </div>

            {/* Greeting */}
            <h1 className="text-3xl sm:text-4xl font-black text-gray-900 tracking-tight leading-none">
              {getGreeting()}, <span className="text-[#B91C1C]">{username}</span>
              <span className="inline-block ml-2.5" style={{ animation: 'hp-float 3s ease-in-out infinite' }}>{getEmoji()}</span>
            </h1>

            <p className="mt-2 text-base text-gray-900 font-extrabold italic">
              Stilsoft mutlu günler diler.
            </p>

            <p className="mt-3 text-sm text-gray-500 font-medium leading-relaxed max-w-lg">
              Hangi modülle devam etmek istersiniz? Hızlı erişim kartlarından birini seçin.
            </p>
          </div>

          {/* Right Stats */}
          <div className="flex items-center gap-3 shrink-0">
            <div className="bg-white/90 backdrop-blur-sm rounded-2xl px-5 py-3.5 border border-gray-200/80 shadow-xs min-w-[120px]">
              <div className="flex items-center gap-2 mb-1">
                <Zap size={13} className="text-amber-500" />
                <span className="text-[10px] font-extrabold text-gray-400 uppercase tracking-widest">Aktif Modüller</span>
              </div>
              <div className="text-2xl font-black text-gray-900 tabular-nums">{visibleCards.length}</div>
            </div>
            <div className="bg-white/90 backdrop-blur-sm rounded-2xl px-5 py-3.5 border border-gray-200/80 shadow-xs min-w-[120px]">
              <div className="flex items-center gap-2 mb-1">
                <Shield size={13} className="text-emerald-500" />
                <span className="text-[10px] font-extrabold text-gray-400 uppercase tracking-widest">Rol</span>
              </div>
              <div className="text-2xl font-black text-gray-900 truncate max-w-[120px]">{userRole}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Section Label */}
      <div className="flex items-center gap-3 mb-6 px-1" style={{ animation: 'hp-hero-in .6s cubic-bezier(.16,1,.3,1) both .15s' }}>
        <div className="h-px flex-1 bg-gradient-to-r from-gray-200 via-gray-200 to-transparent" />
        <span className="text-[11px] font-extrabold text-gray-400 uppercase tracking-[0.2em]">Servis Modülleri</span>
        <div className="h-px flex-1 bg-gradient-to-l from-gray-200 via-gray-200 to-transparent" />
      </div>

      {/* Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {visibleCards.map((c, i) => (
          <ModuleCard key={c.key} card={c} index={i} onClick={() => navigate(c.to)} />
        ))}
      </div>

      {/* Footer message */}
      <div className="mt-12 mb-4 text-center space-y-1">
        <p className="text-xs text-gray-400 font-medium tracking-wide">
          Stilsoft Servis Ops — Tüm servis işlemlerinize sol menüden veya kartlara tıklayarak erişebilirsiniz
        </p>
        <p className="text-xs text-gray-400 font-semibold italic tracking-wide">
          Stilsoft mutlu günler diler.
        </p>
      </div>
    </div>
  )
}
