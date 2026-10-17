import React, { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Lock, MessageCircle } from 'lucide-react'
import { ApiError, api, b2bUrl, lastTenant, rememberTenant, setSession, type SessionUser } from '../lib/session'

type LoginResponse = { token: string; expiresAt?: string; user: SessionUser }
type Tenant = { code: string; name: string }

const HANDOVER_PARAMS = ['sync_token', 'sync_tenant', 'tenant']

/** Devir parametrelerini adres çubuğundan siler (token ekranda/geçmişte kalmasın). */
function stripHandover() {
  const url = new URL(window.location.href)
  let changed = false
  for (const k of HANDOVER_PARAMS) {
    if (url.searchParams.has(k)) {
      url.searchParams.delete(k)
      changed = true
    }
  }
  if (changed) window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`)
}

/*
  GİRİŞ — B2B kullanıcısıyla. İki yol:
   1. B2B'den "Asistan'a Geç": adreste sync_token → /api/auth/exchange. Başarılıysa form hiç görünmez.
   2. Firma + kullanıcı adı + şifre → /api/auth/login (sunucu ERP'ye sorar, şifre burada tutulmaz).
  Yetki (B2B Kullanıcılar → "Asistan (WhatsApp)" kutusu) iki yolda da sunucuda kontrol edilir.
*/
export default function LoginPage() {
  const navigate = useNavigate()
  const params = new URLSearchParams(window.location.search)
  const syncToken = params.get('sync_token')
  const syncTenant = params.get('sync_tenant') || params.get('tenant') || ''

  const [tenants, setTenants] = useState<Tenant[]>([])
  const [tenant, setTenant] = useState(syncTenant || lastTenant())
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [exchanging, setExchanging] = useState(!!syncToken)
  const exchangedRef = useRef(false)

  useEffect(() => {
    api<Tenant[]>('/api/auth/tenants', { anonymous: true })
      .then((list) => {
        setTenants(list)
        setTenant((t) => t || (list.length === 1 ? list[0].code : ''))
      })
      .catch(() => setTenants([]))
  }, [])

  // B2B'den devir — StrictMode'da efekt iki kez çalışır; takas bir kez yapılır.
  useEffect(() => {
    if (!syncToken || exchangedRef.current) return
    exchangedRef.current = true
    api<LoginResponse>('/api/auth/exchange', { method: 'POST', anonymous: true, body: JSON.stringify({ token: syncToken, tenantCode: syncTenant }) })
      .then((r) => {
        stripHandover()
        setSession(r.token, r.user)
        rememberTenant(r.user.tenantCode)
        navigate('/', { replace: true })
      })
      .catch((e: ApiError) => {
        stripHandover()
        setError(e.status === 403 ? e.message : 'B2B oturumunuz aktarılamadı; lütfen giriş yapın.')
        setExchanging(false)
      })
  }, [syncToken, syncTenant, navigate])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const r = await api<LoginResponse>('/api/auth/login', {
        method: 'POST',
        anonymous: true,
        body: JSON.stringify({ tenantCode: tenant, username: username.trim(), password })
      })
      setSession(r.token, r.user)
      rememberTenant(r.user.tenantCode)
      navigate('/', { replace: true })
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const b2b = b2bUrl()

  return (
    <div className="min-h-full flex items-center justify-center p-4 bg-gradient-to-br from-green-700 via-green-800 to-gray-900">
      <div className="w-full max-w-sm bg-white rounded-3xl shadow-2xl p-7">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-11 h-11 rounded-2xl bg-green-600 flex items-center justify-center">
            <MessageCircle className="w-6 h-6 text-white" />
          </div>
          <div>
            <div className="text-lg font-black text-gray-900 leading-tight">Stilsoft Asistan</div>
            <div className="text-xs text-gray-500 font-semibold">WhatsApp müşteri mesajları</div>
          </div>
        </div>

        {exchanging ? (
          <div className="py-8 text-center text-sm font-semibold text-gray-600">B2B oturumunuz aktarılıyor…</div>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <label className="block">
              <span className="text-xs font-bold text-gray-600">Firma</span>
              {tenants.length > 0 ? (
                <select
                  value={tenant}
                  onChange={(e) => setTenant(e.target.value)}
                  className="mt-1 w-full h-11 px-3 rounded-2xl border border-gray-200 bg-white text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-green-600/20"
                  required
                >
                  <option value="">Seçin…</option>
                  {tenants.map((t) => (
                    <option key={t.code} value={t.code}>
                      {t.name}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  value={tenant}
                  onChange={(e) => setTenant(e.target.value.toUpperCase())}
                  placeholder="Firma kodu"
                  className="mt-1 w-full h-11 px-3 rounded-2xl border border-gray-200 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-green-600/20"
                  required
                />
              )}
            </label>
            <label className="block">
              <span className="text-xs font-bold text-gray-600">Kullanıcı adı</span>
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                autoFocus
                className="mt-1 w-full h-11 px-3 rounded-2xl border border-gray-200 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-green-600/20"
                required
              />
            </label>
            <label className="block">
              <span className="text-xs font-bold text-gray-600">Şifre</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                className="mt-1 w-full h-11 px-3 rounded-2xl border border-gray-200 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-green-600/20"
                required
              />
            </label>

            {error && <div className="px-3 py-2.5 rounded-2xl bg-red-50 border border-red-200 text-sm font-semibold text-red-700">{error}</div>}

            <button
              type="submit"
              disabled={busy}
              className="w-full h-11 rounded-2xl bg-green-600 hover:bg-green-700 text-white text-sm font-bold disabled:opacity-60 inline-flex items-center justify-center gap-2"
            >
              <Lock className="w-4 h-4" /> {busy ? 'Giriş yapılıyor…' : 'Giriş yap'}
            </button>
            <p className="text-[11px] text-gray-500 text-center">B2B kullanıcı adı ve şifrenizle girin.</p>
            {b2b && (
              <a href={b2b} className="block text-center text-xs font-bold text-gray-500 hover:text-gray-800">
                ← B2B'ye dön
              </a>
            )}
          </form>
        )}
      </div>
    </div>
  )
}
