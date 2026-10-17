import React, { useMemo, useRef, useCallback, useState, useEffect } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import {
  ArrowRight,
  BarChart3,
  Building2,
  CreditCard,
  FileText,
  Receipt,
  Ticket,
  Users,
  Landmark,
  Clock,
  CalendarDays,
  Zap,
  Settings
} from 'lucide-react'


/* ───────────────────────── types ───────────────────────── */

type LayoutContext = { isSuperAdmin?: boolean; allowedKeys?: Set<string> }

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

function canSeeModule(sa: boolean, keys: Set<string>, id: string) {
  if (sa) return true
  for (const k of keys) { if (k.startsWith(`${id}/`)) return true }
  return false
}

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
  useEffect(() => { const id = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(id) }, [])
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
    const rx = ((px / rect.width) - 0.5) * 10
    const ry = ((py / rect.height) - 0.5) * 10
    btn.style.transform = `perspective(800px) translateY(-6px) scale(1.02) rotateX(${-ry}deg) rotateY(${rx}deg)`
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
      className="hp-card group relative overflow-hidden rounded-[20px] text-left focus:outline-none"
      style={{ animation: `hp-card-in .55s cubic-bezier(.16,1,.3,1) both ${index * 80}ms` }}
    >
      {/* Animated gradient border */}
      <div className="absolute -inset-[1px] rounded-[20px] hp-border-anim opacity-0 group-hover:opacity-100 transition-opacity duration-500" style={{ background: `conic-gradient(from var(--hp-angle,0deg), ${card.color}, ${card.colorMid}, ${card.colorSoft}, ${card.color})` }} />

      {/* Cursor-following spotlight */}
      <div ref={glowRef} className="absolute inset-0 rounded-[20px] opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none z-[1]" />

      {/* Card body */}
      <div className="hp-card-body relative h-full rounded-[19px] overflow-hidden z-[2]" style={{ background: `linear-gradient(160deg, #ffffff 0%, #fefefe 50%, ${card.colorSoft} 100%)` }}>

        {/* Ambient glow bottom-right */}
        <div className="absolute -bottom-8 -right-8 w-40 h-40 rounded-full opacity-40 group-hover:opacity-70 transition-opacity duration-700 pointer-events-none blur-2xl" style={{ background: card.color }} />

        {/* Shimmer sweep on hover */}
        <div className="absolute inset-0 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-500 z-[3]" style={{ background: 'linear-gradient(110deg, transparent 25%, rgba(255,255,255,.5) 50%, transparent 75%)', backgroundSize: '250% 100%', animation: 'hp-shimmer 1.8s ease-in-out infinite' }} />

        {/* Top accent strip */}
        <div className="absolute top-0 left-0 right-0 h-[3px] origin-left scale-x-0 group-hover:scale-x-100 transition-transform duration-600" style={{ background: `linear-gradient(90deg, ${card.color}, ${card.colorMid}, ${card.colorSoft})` }} />

        {/* Content */}
        <div className="relative h-full flex flex-col p-5 z-[4]">

          {/* Icon + badge */}
          <div className="flex items-start justify-between mb-auto">
            <div className="relative">
              {/* Pulse ring on hover */}
              <div className="absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 scale-100 group-hover:scale-[1.6] transition-all duration-700 pointer-events-none" style={{ background: card.colorMid }} />
              <div className="relative h-[52px] w-[52px] rounded-2xl flex items-center justify-center transition-all duration-300 group-hover:scale-110 group-hover:rotate-[-4deg] shadow-sm group-hover:shadow-lg" style={{ background: `linear-gradient(135deg, ${card.colorSoft}, ${card.colorMid})` }}>
                <Icon size={24} style={{ color: card.color }} strokeWidth={2} className="transition-transform duration-300 group-hover:scale-110" />
              </div>
            </div>

            <span className="hp-tag px-3 py-1 rounded-full text-[10px] font-bold tracking-wider uppercase border transition-all duration-300" style={{ color: card.color, backgroundColor: card.colorSoft, borderColor: card.colorMid }}>
              {card.tag}
            </span>
          </div>

          {/* Text */}
          <div className="mt-4">
            <h3 className="text-[16px] font-extrabold text-gray-900 leading-tight tracking-tight transition-colors duration-300 group-hover:text-gray-800">
              {card.title}
            </h3>
            <p className="mt-1 text-[12px] text-gray-400 leading-relaxed font-medium">
              {card.subtitle}
            </p>

            {/* CTA */}
            <div className="mt-3 flex items-center gap-2 opacity-0 translate-y-3 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-400 ease-out">
              <span className="text-[11px] font-bold tracking-wide" style={{ color: card.color }}>Ayrıntılar</span>
              <div className="h-6 w-6 rounded-full flex items-center justify-center transition-all duration-300 group-hover:translate-x-1 shadow-sm" style={{ background: `linear-gradient(135deg, ${card.colorMid}, ${card.colorSoft})` }}>
                <ArrowRight size={11} style={{ color: card.color }} strokeWidth={2.5} />
              </div>
            </div>
          </div>

        </div>
      </div>
    </button>
  )
}

/* ───────────────────────── HomePage ───────────────────────── */

export default function HomePage() {
  const navigate = useNavigate()
  const layout = useOutletContext<LayoutContext>()
  const isSuperAdmin = Boolean(layout?.isSuperAdmin)
  const allowedKeys = (layout?.allowedKeys as Set<string> | undefined) ?? new Set<string>()

  const userName = useMemo(() => {
    const name = localStorage.getItem('userName') || sessionStorage.getItem('userName') || ''
    if (name.includes('@')) {
      return name.split('@')[0]
    }
    return name
  }, [])

  const cards = useMemo<HomeCard[]>(() => [
    { key: 'invoice', title: 'Fatura İşlemleri', subtitle: 'Alış & satış faturaları', tag: 'Finans', color: '#E11D48', colorMid: 'rgba(225,29,72,0.15)', colorSoft: 'rgba(225,29,72,0.06)', to: '/invoice', icon: Receipt },
    { key: 'pos', title: 'Sanal Pos', subtitle: 'Online ödeme işlemleri', tag: 'Ödeme', color: '#F97316', colorMid: 'rgba(249,115,22,0.15)', colorSoft: 'rgba(249,115,22,0.06)', to: '/pos', icon: CreditCard },
    { key: 'cash', title: 'Kasa İşlemleri', subtitle: 'Nakit giriş & çıkış', tag: 'Kasa', color: '#0EA5E9', colorMid: 'rgba(14,165,233,0.15)', colorSoft: 'rgba(14,165,233,0.06)', to: '/cash', icon: Landmark },
    { key: 'check', title: 'Çek / Senet', subtitle: 'Çek ve senet takibi', tag: 'Takip', color: '#8B5CF6', colorMid: 'rgba(139,92,246,0.15)', colorSoft: 'rgba(139,92,246,0.06)', to: '/check', icon: Ticket },
    { key: 'bank', title: 'Banka İşlemleri', subtitle: 'Hesap hareketleri', tag: 'Banka', color: '#10B981', colorMid: 'rgba(16,185,129,0.15)', colorSoft: 'rgba(16,185,129,0.06)', to: '/bank', icon: Building2 },
    { key: 'reports', title: 'Raporlar', subtitle: 'Analiz & istatistikler', tag: 'Analiz', color: '#6366F1', colorMid: 'rgba(99,102,241,0.15)', colorSoft: 'rgba(99,102,241,0.06)', to: '/reports', icon: BarChart3 },
    { key: 'users', title: 'Ayarlar', subtitle: 'Kullanıcı & ayarlar', tag: 'Yönetim', color: '#475569', colorMid: 'rgba(71,85,105,0.15)', colorSoft: 'rgba(71,85,105,0.06)', to: '/users', icon: Settings }
  ], [])

  const visible = useMemo(() => cards.filter((c) => canSeeModule(isSuperAdmin, allowedKeys, c.key)), [allowedKeys, cards, isSuperAdmin])

  const dateStr = new Date().toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

  /* Animated border angle via JS (CSS @property not universal) */
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
    <div className="max-w-[1120px] mx-auto">
      <style>{`
        @keyframes hp-ripple { to { transform:scale(1); opacity:0 } }
        @keyframes hp-card-in {
          from { opacity:0; transform:translateY(32px) scale(.92) }
          to   { opacity:1; transform:translateY(0)   scale(1)   }
        }
        @keyframes hp-hero-in {
          from { opacity:0; transform:translateY(-16px) }
          to   { opacity:1; transform:translateY(0)     }
        }
        @keyframes hp-float {
          0%,100% { transform:translateY(0) }
          50%     { transform:translateY(-8px) }
        }
        @keyframes hp-shimmer {
          0%   { background-position:200% center }
          100% { background-position:-200% center }
        }
        @keyframes hp-orbit {
          from { transform:rotate(0deg) translateX(40px) rotate(0deg) }
          to   { transform:rotate(360deg) translateX(40px) rotate(-360deg) }
        }
        @keyframes hp-pulse {
          0%,100% { opacity:.6; transform:scale(1) }
          50%     { opacity:1; transform:scale(1.15) }
        }
        @keyframes hp-gradient-x {
          0%   { background-position:0% 50% }
          50%  { background-position:100% 50% }
          100% { background-position:0% 50% }
        }

        .hp-card {
          cursor:pointer;
          height:210px;
          transition: transform .25s cubic-bezier(.4,0,.2,1), box-shadow .25s ease;
        }
        .hp-card:hover { z-index:2; box-shadow: 0 20px 50px -12px rgba(0,0,0,.12), 0 4px 16px -4px rgba(0,0,0,.08); }

        .hp-border-anim {
          background-size:100% 100%;
        }

        .hp-hero-mesh {
          background-size:400% 400%;
          animation: hp-gradient-x 12s ease infinite;
        }
      `}</style>

      {/* ━━━━━━━━━ HERO ━━━━━━━━━ */}
      <div
        className="relative rounded-[24px] overflow-hidden mb-8 px-8 py-10"
        style={{
          background: 'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 50%, #e2e8f0 100%)',
          animation: 'hp-hero-in .7s cubic-bezier(.16,1,.3,1) both'
        }}
      >
        {/* Soft decorative blobs */}
        <div className="absolute top-0 left-0 w-64 h-64 rounded-full pointer-events-none opacity-[0.06]" style={{ background: 'radial-gradient(circle, #6366f1, transparent 70%)', filter: 'blur(40px)' }} />
        <div className="absolute bottom-0 right-0 w-48 h-48 rounded-full pointer-events-none opacity-[0.05]" style={{ background: 'radial-gradient(circle, #0ea5e9, transparent 70%)', filter: 'blur(40px)' }} />

        <div className="relative flex items-end justify-between gap-6">
          <div className="flex-1">
            {/* Date + clock */}
            <div className="flex items-center gap-3 mb-4">
              <div className="flex items-center gap-1.5 text-[11px] text-gray-400 font-medium">
                <CalendarDays size={12} className="text-gray-300" />
                <span className="capitalize">{dateStr}</span>
              </div>
              <div className="w-px h-3 bg-gray-200" />
              <div className="flex items-center gap-1.5 text-[11px] text-gray-400 font-medium">
                <Clock size={12} className="text-gray-300" />
                <LiveClock />
              </div>
            </div>

            {/* Greeting */}
            <h1 className="text-[36px] font-black text-gray-900 tracking-tight leading-none">
              {getGreeting()}
              {userName && (
                <>
                  , <span className="text-[#B91C1C]">{userName}</span>
                </>
              )}
              <span className="inline-block ml-2" style={{ animation: 'hp-float 3s ease-in-out infinite' }}>{getEmoji()}</span>
            </h1>

            <p className="mt-2 text-[16px] text-gray-900 font-extrabold italic">
              Stilsoft mutlu günler diler.
            </p>

            <p className="mt-3 text-[14px] text-gray-400 font-medium leading-relaxed max-w-md">
              Hangi modülle devam etmek istersiniz? Hızlı erişim kartlarından birini seçin.
            </p>
          </div>

          {/* Right side glass stats */}
          <div className="hidden lg:flex items-center gap-3">
            <div className="bg-white/80 backdrop-blur-sm rounded-2xl px-5 py-4 border border-gray-100/80 shadow-sm">
              <div className="flex items-center gap-2 mb-1">
                <Zap size={12} className="text-amber-500" />
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Aktif Modüller</span>
              </div>
              <div className="text-2xl font-black text-gray-800 tabular-nums">{visible.length}</div>
            </div>
            <div className="bg-white/80 backdrop-blur-sm rounded-2xl px-5 py-4 border border-gray-100/80 shadow-sm">
              <div className="flex items-center gap-2 mb-1">
                <Users size={12} className="text-emerald-500" />
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Rol</span>
              </div>
              <div className="text-2xl font-black text-gray-800">{isSuperAdmin ? 'Admin' : 'Kullanıcı'}</div>
            </div>
          </div>
        </div>
      </div>

      {/* ━━━━━━━━━ SECTION LABEL ━━━━━━━━━ */}
      <div className="flex items-center gap-3 mb-5 px-1" style={{ animation: 'hp-hero-in .7s cubic-bezier(.16,1,.3,1) both .2s' }}>
        <div className="h-px flex-1 bg-gradient-to-r from-gray-200 to-transparent" />
        <span className="text-[11px] font-bold text-gray-300 uppercase tracking-[.15em]">Modüller</span>
        <div className="h-px flex-1 bg-gradient-to-l from-gray-200 to-transparent" />
      </div>

      {/* ━━━━━━━━━ CARDS GRID ━━━━━━━━━ */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        {visible.map((c, i) => (
          <ModuleCard key={c.key} card={c} index={i} onClick={() => navigate(c.to)} />
        ))}

        {visible.length === 0 && (
          <div className="col-span-full py-24 text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gray-50 mb-4">
              <Users size={28} className="text-gray-300" />
            </div>
            <p className="text-sm text-gray-400 font-medium">Bu kullanıcı için gösterilecek modül bulunamadı.</p>
          </div>
        )}
      </div>

      {/* ━━━━━━━━━ FOOTER ━━━━━━━━━ */}
      <div className="mt-12 mb-2 text-center space-y-1">
        <p className="text-[11px] text-gray-300 font-medium tracking-wide">
          Stilsoft B2B ERP — Tüm modüller üst menüden de erişilebilir
        </p>
        <p className="text-[11px] text-gray-400 font-semibold italic tracking-wide">
          Stilsoft mutlu günler diler.
        </p>
      </div>
    </div>
  )
}
