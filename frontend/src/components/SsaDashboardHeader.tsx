import React, { useMemo, useState } from 'react'
import { Building2, LayoutDashboard, LogOut, User, Users } from 'lucide-react'

import Modal from './Modal'

type Props = {
  title: string
  subtitle?: string
  searchValue?: string
  onSearchChange?: (value: string) => void
  tertiaryLabel?: string
  onTertiaryClick?: () => void
  primaryLabel?: string
  onPrimaryClick?: () => void
  secondaryLabel?: string
  onSecondaryClick?: () => void
  onLogout: () => void
}

export default function SsaDashboardHeader({
  title,
  subtitle,
  searchValue,
  onSearchChange,
  tertiaryLabel,
  onTertiaryClick,
  primaryLabel,
  onPrimaryClick,
  secondaryLabel,
  onSecondaryClick,
  onLogout
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false)

  const navItems = useMemo(
    () => [
      { key: 'projeYonetimi', label: 'Proje Yönetimi', href: '/users/projeYonetimi', icon: Building2 },
      { key: 'allUsers', label: 'Tüm Kullanıcılar', href: '/users/allUsers', icon: Users },
      { key: 'onboard', label: 'Onboard', href: '/users/onboard', icon: LayoutDashboard }
    ],
    []
  )

  return (
    <div className="relative overflow-hidden rounded-3xl border border-gray-200 bg-gradient-to-br from-red-950 via-rose-900 to-zinc-950 shadow-[0_18px_45px_-32px_rgba(17,24,39,0.45)]">
      <div className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/0 to-white/0" />
      <div className="absolute -top-24 -left-24 w-96 h-96 rounded-full bg-rose-500/25 blur-3xl" />
      <div className="absolute -bottom-24 -right-24 w-96 h-96 rounded-full bg-red-500/20 blur-3xl" />

      <div className="relative p-5 sm:p-6">
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
          <div>
            <div className="text-[11px] font-black uppercase tracking-[0.22em] text-white/70">SSA</div>
            <h2 className="text-2xl sm:text-3xl font-black text-white tracking-tight mt-1">{title}</h2>
            {subtitle ? <p className="text-sm text-white/70 mt-2 max-w-[820px]">{subtitle}</p> : null}
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center gap-2">
            {typeof searchValue === 'string' && onSearchChange ? (
              <input
                value={searchValue}
                onChange={(e) => onSearchChange(e.target.value)}
                className="w-full sm:w-[360px] h-11 px-4 rounded-2xl border border-white/15 bg-white/95 backdrop-blur text-sm font-semibold text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-white/20 focus:border-white/30 transition"
                placeholder="Her şeyi ara..."
              />
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              {tertiaryLabel && onTertiaryClick ? (
                <button
                  type="button"
                  onClick={onTertiaryClick}
                  className="h-11 px-4 rounded-2xl border border-white/15 bg-white/95 backdrop-blur text-sm font-semibold text-gray-800 hover:bg-white transition"
                >
                  {tertiaryLabel}
                </button>
              ) : null}

              {secondaryLabel && onSecondaryClick ? (
                <button
                  type="button"
                  onClick={onSecondaryClick}
                  className="h-11 px-4 rounded-2xl border border-white/15 bg-white/95 backdrop-blur text-sm font-semibold text-gray-800 hover:bg-white transition"
                >
                  {secondaryLabel}
                </button>
              ) : null}

              {primaryLabel && onPrimaryClick ? (
                <button
                  type="button"
                  onClick={onPrimaryClick}
                  className="h-11 px-5 rounded-2xl bg-white text-gray-900 text-sm font-semibold hover:bg-white/90 transition shadow-[0_18px_35px_-22px_rgba(0,0,0,0.55)]"
                >
                  {primaryLabel}
                </button>
              ) : null}

              <button
                type="button"
                onClick={() => setMenuOpen(true)}
                className="h-11 w-11 rounded-2xl border border-white/15 bg-white/95 backdrop-blur hover:bg-white transition grid place-items-center"
                aria-label="Kullanıcı"
                title="Kullanıcı"
              >
                <User size={16} className="text-gray-800" />
              </button>
            </div>
          </div>
        </div>

        <Modal isOpen={menuOpen} onClose={() => setMenuOpen(false)} title="Menü">
          <div className="space-y-2">
            {navItems.map((x) => {
              const Icon = x.icon
              return (
                <button
                  key={x.key}
                  type="button"
                  onClick={() => {
                    setMenuOpen(false)
                    window.location.assign(x.href)
                  }}
                  className="w-full h-11 px-4 rounded-2xl border border-gray-200 bg-white hover:bg-gray-50 transition text-sm font-semibold text-gray-800 flex items-center gap-2"
                >
                  <Icon size={16} className="text-gray-700" />
                  {x.label}
                </button>
              )
            })}

            <button
              type="button"
              onClick={() => {
                setMenuOpen(false)
                onLogout()
              }}
              className="w-full h-11 px-4 rounded-2xl border border-red-200 bg-white hover:bg-red-50 transition text-sm font-semibold text-red-700 flex items-center gap-2"
            >
              <LogOut size={16} className="text-red-700" />
              Çıkış Yap
            </button>
          </div>
        </Modal>
      </div>
    </div>
  )
}
