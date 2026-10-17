import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { readApiResponse } from '../lib/api'
import { useToast } from '../components/ui/ToastContext'

export function AdminLoginPage() {
  const nav = useNavigate()
  const { showToast } = useToast()
  const [username, setUsername] = useState('admin')
  const [password, setPassword] = useState('Admin123!')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canSubmit = useMemo(() => username.trim().length > 0 && password.length > 0, [username, password])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return

    try {
      setLoading(true)
      setError(null)
      const res = await fetch('/api/admin/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })

      const json = await readApiResponse(res)
      if (!res.ok || !json?.success) {
        throw new Error(json?.message || 'Giriş başarısız')
      }

      const token = json?.data?.accessToken
      if (!token) throw new Error('Token alınamadı')

      localStorage.setItem('ecom_admin_token', token)
      showToast('Yönetici girişi başarılı. Panel yükleniyor...', 'success', 2000)
      setTimeout(() => {
        nav('/admin')
      }, 1800)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Giriş başarısız')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-tr from-[#090a0f] via-[#0f111a] to-[#141829] text-zinc-100 flex items-center justify-center font-inter px-4">
      <div className="w-full max-w-[440px]">
        {/* Logo / Header Section */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-3 bg-white/5 px-4 py-2 rounded-2xl border border-white/10 backdrop-blur-sm shadow-inner mb-4">
            <span className="h-2.5 w-2.5 rounded-full bg-primary animate-pulse" />
            <span className="text-[10px] font-extrabold tracking-widest text-zinc-400 uppercase">STILSOFT DEMO</span>
          </div>
          <h1 className="text-3xl font-black tracking-tight text-white uppercase">YÖNETİM PANELİ</h1>
          <p className="mt-2 text-xs text-zinc-400">Lütfen kimlik bilgilerinizle oturum açın</p>
        </div>

        {/* Login Form */}
        <form
          onSubmit={onSubmit}
          className="space-y-5 rounded-[28px] border border-white/15 bg-white/[0.03] backdrop-blur-xl p-8 shadow-[0_20px_50px_rgba(0,0,0,0.3),0_0_80px_rgba(223,0,0,0.05)]"
        >
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold tracking-wider text-zinc-400 uppercase block">Kullanıcı adı</label>
            <div className="relative">
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Kullanıcı adınızı girin"
                className="h-11 w-full rounded-2xl border border-white/10 bg-black/40 px-4 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:ring-4 focus:ring-primary/15 focus:border-primary transition-all duration-200"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] font-bold tracking-wider text-zinc-400 uppercase block">Şifre</label>
            <div className="relative">
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Şifrenizi girin"
                className="h-11 w-full rounded-2xl border border-white/10 bg-black/40 px-4 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:ring-4 focus:ring-primary/15 focus:border-primary transition-all duration-200"
              />
            </div>
          </div>

          {error && (
            <div className="rounded-2xl border border-rose-500/25 bg-rose-500/10 p-3 text-xs font-semibold text-rose-300 flex items-center gap-2 animate-shake">
              <span className="material-symbols-outlined text-[16px] text-rose-400">warning</span>
              <span>{error}</span>
            </div>
          )}

          <button
            disabled={!canSubmit || loading}
            className="h-12 w-full rounded-2xl bg-primary hover:bg-[#c00000] text-sm font-bold text-white shadow-md shadow-primary/20 hover:shadow-lg hover:shadow-primary/30 transition-all duration-200 active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none flex items-center justify-center gap-2"
            type="submit"
          >
            {loading ? (
              <>
                <div className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                <span>Giriş yapılıyor…</span>
              </>
            ) : (
              <span>Giriş yap</span>
            )}
          </button>
        </form>
      </div>
    </div>
  )
}
