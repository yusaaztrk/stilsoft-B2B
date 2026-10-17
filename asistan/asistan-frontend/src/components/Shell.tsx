import React, { useEffect, useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { ArrowLeft, Inbox, LogOut, MessageCircle, Settings } from 'lucide-react'
import { api, b2bUrl, clearSession, getUser } from '../lib/session'

/** Üst bant: program adı, kullanıcı, B2B'ye dönüş, çıkış. */
export default function Shell({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate()
  const user = getUser()
  const b2b = b2bUrl()
  // Ayarlar sekmesi yalnız yöneticiye (kapı yine sunucuda).
  const [isAdmin, setIsAdmin] = useState(false)
  useEffect(() => {
    api<{ isAdmin: boolean }>('/api/panel/status').then((s) => setIsAdmin(!!s.isAdmin)).catch(() => setIsAdmin(false))
  }, [])
  const tab = ({ isActive }: { isActive: boolean }) =>
    `h-9 px-3 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 ${isActive ? 'bg-white text-green-800' : 'bg-white/10 hover:bg-white/20 text-white'}`

  const logout = () => {
    clearSession()
    navigate('/login', { replace: true })
  }

  return (
    <div className="h-full flex flex-col">
      <header className="h-14 shrink-0 bg-gradient-to-r from-green-700 to-green-800 text-white flex items-center justify-between px-4 shadow">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-white/15 flex items-center justify-center">
            <MessageCircle className="w-5 h-5" />
          </div>
          <div className="leading-tight">
            <div className="text-sm font-black tracking-tight">Stilsoft Asistan</div>
            <div className="text-[10px] font-semibold text-white/70 uppercase tracking-wider">WhatsApp</div>
          </div>
          <nav className="ml-3 flex items-center gap-1.5">
            <NavLink to="/" end className={tab}><Inbox className="w-4 h-4" /> <span className="hidden sm:inline">Mesajlar</span></NavLink>
            {isAdmin && <NavLink to="/ayarlar" className={tab}><Settings className="w-4 h-4" /> <span className="hidden sm:inline">Ayarlar</span></NavLink>}
          </nav>
        </div>
        <div className="flex items-center gap-2">
          {b2b && (
            <a href={b2b} className="hidden sm:inline-flex h-9 px-3 rounded-xl bg-white/10 hover:bg-white/20 text-xs font-bold items-center gap-1.5">
              <ArrowLeft className="w-4 h-4" /> B2B'ye dön
            </a>
          )}
          <div className="hidden sm:block text-right leading-tight px-2">
            <div className="text-xs font-bold">{user?.userName}</div>
            <div className="text-[10px] text-white/70">{user?.tenantCode}</div>
          </div>
          <button type="button" onClick={logout} title="Çıkış" className="h-9 px-3 rounded-xl bg-white/10 hover:bg-white/20 text-xs font-bold inline-flex items-center gap-1.5">
            <LogOut className="w-4 h-4" /> <span className="hidden sm:inline">Çıkış</span>
          </button>
        </div>
      </header>
      <main className="flex-1 min-h-0 p-3 sm:p-4">{children}</main>
    </div>
  )
}
