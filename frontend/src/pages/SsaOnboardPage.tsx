import React, { useEffect, useMemo, useState } from 'react'

import { API_BASE_URL } from '../config/api'

import SsaDashboardHeader from '../components/SsaDashboardHeader'
import { redirectToLogin } from '../auth/redirectToLogin'

type TenantListItem = {
  tenantId: number
  code: string
  name: string
  dbName?: string
  isActive?: boolean
}

type SsaUserRow = {
  username: string
  mail: string
  unvan: string
  isActive: boolean
  userKey: string
  tenants: Array<{
    tenantId: number
    tenantCode: string
    tenantName: string
    userId: number
    roleId: number
    roleCode: string
    roleName: string
    isActive: boolean
  }>
}

export default function SsaOnboardPage() {
  const Spark = ({ values, className }: { values: number[]; className?: string }) => {
    const v = (values ?? []).map((x) => (Number.isFinite(Number(x)) ? Number(x) : 0))
    if (v.length === 0) return <div className={className} />
    const min = Math.min(...v)
    const max = Math.max(...v)
    const w = 120
    const h = 34
    const norm = (n: number) => {
      if (max === min) return h / 2
      return h - ((n - min) / (max - min)) * (h - 2) - 1
    }
    const step = v.length <= 1 ? w : w / (v.length - 1)
    const d = v
      .map((n, i) => {
        const x = i * step
        const y = norm(n)
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`
      })
      .join(' ')

    return (
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className={className}>
        <path d={d} fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" />
      </svg>
    )
  }

  const buildHeaders = (includeJson: boolean) => {
    const headers: Record<string, string> = {}
    if (includeJson) headers['Content-Type'] = 'application/json'
    const token = localStorage.getItem('accessToken')
    if (token) headers.Authorization = `Bearer ${token}`
    return headers
  }

  const handleLogout = () => {
    localStorage.removeItem('accessToken')
    localStorage.removeItem('refreshToken')
    localStorage.removeItem('userName')
    localStorage.removeItem('tenantCode')
    localStorage.removeItem('tenantName')
    localStorage.removeItem('ssaViewMode')
    sessionStorage.removeItem('userName')
    redirectToLogin()
  }

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [tenants, setTenants] = useState<TenantListItem[]>([])
  const [users, setUsers] = useState<SsaUserRow[]>([])

  const [query, setQuery] = useState('')

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const [tenantRes, usersRes] = await Promise.all([
        fetch(`${API_BASE_URL}/api/tenants`, { headers: { ...buildHeaders(false) } }),
        fetch(`${API_BASE_URL}/api/ssa-users/grouped`, { headers: { ...buildHeaders(false) } })
      ])

      if (!tenantRes.ok) {
        const t = await tenantRes.text().catch(() => '')
        throw new Error(t || `Firmalar alınamadı (${tenantRes.status})`)
      }
      if (!usersRes.ok) {
        const t = await usersRes.text().catch(() => '')
        throw new Error(t || `Kullanıcılar alınamadı (${usersRes.status})`)
      }

      const tenantJson = await tenantRes.json().catch(() => null)
      const usersJson = await usersRes.json().catch(() => null)

      setTenants((tenantJson?.data ?? []) as TenantListItem[])
      setUsers((usersJson?.data ?? []) as SsaUserRow[])
    } catch (e: any) {
      setError(String(e?.message ?? 'Yükleme hatası'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const filteredTenants = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = tenants ?? []
    if (!q) return list
    return list.filter((t) => String(t.name ?? '').toLowerCase().includes(q) || String(t.code ?? '').toLowerCase().includes(q) || String(t.dbName ?? '').toLowerCase().includes(q))
  }, [query, tenants])

  const filteredUsers = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = users ?? []
    if (!q) return list
    return list.filter((u) => {
      return (
        String(u.username ?? '').toLowerCase().includes(q) ||
        String(u.mail ?? '').toLowerCase().includes(q) ||
        String(u.unvan ?? '').toLowerCase().includes(q) ||
        (u.tenants ?? []).some((t) => String(t.tenantCode ?? '').toLowerCase().includes(q) || String(t.tenantName ?? '').toLowerCase().includes(q))
      )
    })
  }, [query, users])

  const recentTenants = useMemo(() => {
    return (filteredTenants ?? [])
      .slice()
      // Sayısal kimlik metin olarak sıralanınca "9" "10"dan sonra geliyor ve "son eklenenler"
      // listesi yanlış altı firmayı gösteriyordu.
      .sort((a, b) => Number(b.tenantId ?? 0) - Number(a.tenantId ?? 0))
      .slice(0, 6)
  }, [filteredTenants])

  const recentUsers = useMemo(() => {
    return (filteredUsers ?? [])
      .slice()
      .sort((a, b) => String(b.userKey ?? '').localeCompare(String(a.userKey ?? '')))
      .slice(0, 8)
  }, [filteredUsers])

  const quickStats = useMemo(() => {
    const t = tenants ?? []
    const u = users ?? []

    const totalTenants = t.length
    const activeTenants = t.filter((x) => Boolean(x.isActive)).length

    const totalUsers = u.length
    const activeUsers = u.filter((x) => Boolean(x.isActive)).length

    const totalTenantLinks = u.reduce((sum, x) => sum + Number((x.tenants ?? []).length), 0)
    const avgUsersPerTenant = totalTenants > 0 ? totalTenantLinks / totalTenants : 0

    const recentTenantsCount = Math.min(20, totalTenants)
    const recentUsersCount = Math.min(50, totalUsers)

    return {
      totalTenants,
      activeTenants,
      totalUsers,
      activeUsers,
      avgUsersPerTenant,
      recentTenantsCount,
      recentUsersCount
    }
  }, [tenants, users])

  const kpiSparks = useMemo(() => {
    const t = tenants ?? []
    const u = users ?? []

    const tenantIds = t
      .map((x) => Number(x.tenantId ?? 0))
      .filter((x) => Number.isFinite(x) && x > 0)
      .sort((a, b) => a - b)
      .slice(-10)

    const userKeys = u
      .map((x) => Number(String(x.userKey ?? '').replace(/\D/g, '')))
      .filter((x) => Number.isFinite(x) && x >= 0)
      .sort((a, b) => a - b)
      .slice(-10)

    const tenantActiveSeries = (t.slice(-10) ?? []).map((x) => (x.isActive ? 1 : 0))
    const userActiveSeries = (u.slice(-10) ?? []).map((x) => (x.isActive ? 1 : 0))

    return {
      tenants: tenantIds.length ? tenantIds : [0, 1, 2, 3, 4, 5, 6],
      users: userKeys.length ? userKeys : [0, 1, 2, 3, 4, 5, 6],
      tenantActive: tenantActiveSeries.length ? tenantActiveSeries : [0, 1, 1, 1, 0, 1, 1],
      userActive: userActiveSeries.length ? userActiveSeries : [1, 1, 0, 1, 1, 1, 1]
    }
  }, [tenants, users])

  return (
    <div className="space-y-4 min-h-[calc(100vh-64px)] px-4 py-6 bg-gradient-to-b from-gray-50 via-white to-white">
      <SsaDashboardHeader
        title="Onboard"
        subtitle="SSA genel panel. Firma ve kullanıcı durumlarını izleyin, hızlı aksiyonlarla yönetin."
        searchValue={query}
        onSearchChange={setQuery}
        tertiaryLabel="Proje Yönetimi"
        onTertiaryClick={() => window.location.assign('/users/projeYonetimi')}
        secondaryLabel="Tüm Kullanıcılar"
        onSecondaryClick={() => window.location.assign('/users/allUsers')}
        primaryLabel="Yenile"
        onPrimaryClick={() => void load()}
        onLogout={handleLogout}
      />

      {error && <div className="text-sm font-semibold text-red-700 bg-red-50 border border-red-200 rounded-2xl px-4 py-3">{error}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
        <div className="lg:col-span-9 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
          <div className="rounded-3xl border border-gray-200 bg-white p-4 shadow-[0_18px_45px_-32px_rgba(17,24,39,0.35)]">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[11px] font-black uppercase tracking-[0.22em] text-gray-500">Firmalar</div>
                <div className="text-2xl font-black text-gray-900 mt-1">{quickStats.totalTenants}</div>
                <div className="text-xs text-gray-500 mt-1">Aktif: {quickStats.activeTenants}</div>
              </div>
              <div className="text-rose-700">
                <Spark values={kpiSparks.tenants} className="text-rose-600" />
              </div>
            </div>
          </div>

          <div className="rounded-3xl border border-gray-200 bg-white p-4 shadow-[0_18px_45px_-32px_rgba(17,24,39,0.35)]">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[11px] font-black uppercase tracking-[0.22em] text-gray-500">Kullanıcılar</div>
                <div className="text-2xl font-black text-gray-900 mt-1">{quickStats.totalUsers}</div>
                <div className="text-xs text-gray-500 mt-1">Aktif: {quickStats.activeUsers}</div>
              </div>
              <div className="text-rose-700">
                <Spark values={kpiSparks.users} className="text-rose-600" />
              </div>
            </div>
          </div>

          <div className="rounded-3xl border border-gray-200 bg-white p-4 shadow-[0_18px_45px_-32px_rgba(17,24,39,0.35)]">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[11px] font-black uppercase tracking-[0.22em] text-gray-500">Aktiflik</div>
                <div className="text-2xl font-black text-gray-900 mt-1">{quickStats.totalTenants === 0 ? '—' : `${Math.round((quickStats.activeTenants / Math.max(1, quickStats.totalTenants)) * 100)}%`}</div>
                <div className="text-xs text-gray-500 mt-1">Firma aktif oranı</div>
              </div>
              <div className="text-emerald-700">
                <Spark values={kpiSparks.tenantActive} className="text-emerald-600" />
              </div>
            </div>
          </div>

          <div className="rounded-3xl border border-gray-200 bg-white p-4 shadow-[0_18px_45px_-32px_rgba(17,24,39,0.35)]">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[11px] font-black uppercase tracking-[0.22em] text-gray-500">Yoğunluk</div>
                <div className="text-2xl font-black text-gray-900 mt-1">{quickStats.totalTenants === 0 ? '—' : quickStats.avgUsersPerTenant.toFixed(1)}</div>
                <div className="text-xs text-gray-500 mt-1">Ortalama kullanıcı/firma</div>
              </div>
              <div className="text-sky-700">
                <Spark values={kpiSparks.userActive} className="text-sky-600" />
              </div>
            </div>
          </div>
        </div>

        <div className="lg:col-span-3 rounded-3xl border border-gray-200 bg-white p-4 shadow-[0_18px_45px_-32px_rgba(17,24,39,0.35)]">
          <div className="text-[11px] font-black uppercase tracking-[0.22em] text-gray-500">Hızlı İşlemler</div>
          <div className="text-lg font-black text-gray-900 mt-1">Kısayollar</div>
          <div className="mt-4 grid grid-cols-1 gap-2">
            <button
              type="button"
              onClick={() => window.location.assign('/users/projeYonetimi')}
              className="h-11 rounded-2xl border border-gray-200 bg-white hover:bg-gray-50 text-sm font-extrabold text-gray-900"
            >
              Firma Yönetimi
            </button>
            <button
              type="button"
              onClick={() => window.location.assign('/users/allUsers')}
              className="h-11 rounded-2xl border border-gray-200 bg-white hover:bg-gray-50 text-sm font-extrabold text-gray-900"
            >
              Kullanıcı Yönetimi
            </button>
            <button
              type="button"
              onClick={() => window.location.assign('/users/rolYetkileri')}
              className="h-11 rounded-2xl border border-gray-200 bg-white hover:bg-gray-50 text-sm font-extrabold text-gray-900"
            >
              Rol Yetkileri
            </button>
            <button
              type="button"
              onClick={() => void load()}
              className="h-11 rounded-2xl bg-gradient-to-r from-red-700 via-rose-600 to-red-700 text-white hover:from-red-800 hover:via-rose-700 hover:to-red-800 text-sm font-extrabold"
            >
              Yenile
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-7 rounded-3xl border border-gray-200 bg-white shadow-[0_18px_45px_-32px_rgba(17,24,39,0.35)] p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[11px] font-black uppercase tracking-[0.22em] text-gray-500">Projects</div>
              <div className="text-lg font-black text-gray-900 mt-1">Firmalar</div>
              <div className="text-sm text-gray-500 mt-1">Son eklenen firmaları açıp firma moduna geçebilirsiniz.</div>
            </div>
            <div className="text-xs font-extrabold text-gray-600">Gösterilen: {recentTenants.length}</div>
          </div>

          <div className="mt-4 overflow-hidden rounded-2xl border border-gray-200">
            <div className="grid grid-cols-12 gap-0 bg-gray-50 text-[10px] font-black uppercase tracking-[0.22em] text-gray-500 border-b border-gray-200">
              <div className="col-span-7 px-3 py-2">Firma</div>
              <div className="col-span-3 px-3 py-2">Durum</div>
              <div className="col-span-2 px-3 py-2 text-right">İşlem</div>
            </div>

            {loading ? (
              <div className="px-3 py-6 text-sm text-gray-500">Yükleniyor...</div>
            ) : recentTenants.length === 0 ? (
              <div className="px-3 py-6 text-sm text-gray-500">Firma yok</div>
            ) : (
              recentTenants.map((t) => {
                const active = Boolean(t.isActive)
                return (
                  <div key={t.tenantId} className="grid grid-cols-12 gap-0 items-center border-b border-gray-100 last:border-b-0 hover:bg-gray-50">
                    <div className="col-span-7 px-3 py-3 min-w-0">
                      <div className="text-sm font-extrabold text-gray-900 truncate">{t.name}</div>
                      <div className="text-xs text-gray-500 mt-0.5 truncate">
                        {String(t.code ?? '').toUpperCase()} {String(t.dbName ?? '').trim() ? `— ${String(t.dbName ?? '').trim()}` : ''}
                      </div>
                    </div>
                    <div className="col-span-3 px-3 py-3">
                      <span className={`inline-flex items-center h-7 px-3 rounded-full text-[11px] font-black border ${active ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-gray-50 border-gray-200 text-gray-700'}`}>
                        {active ? 'aktif' : 'pasif'}
                      </span>
                    </div>
                    <div className="col-span-2 px-3 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => {
                          localStorage.setItem('tenantCode', String(t.code ?? '').trim())
                          localStorage.setItem('tenantName', String(t.name ?? '').trim())
                          localStorage.setItem('ssaViewMode', 'tenant')
                          window.location.assign('/users/kullaniciListesi')
                        }}
                        className="h-9 px-4 rounded-2xl bg-gradient-to-r from-red-700 via-rose-600 to-red-700 text-white hover:from-red-800 hover:via-rose-700 hover:to-red-800 text-sm font-extrabold"
                      >
                        Aç
                      </button>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>

        <div className="lg:col-span-5 space-y-4">
          <div className="rounded-3xl border border-gray-200 bg-white shadow-[0_18px_45px_-32px_rgba(17,24,39,0.35)] p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[11px] font-black uppercase tracking-[0.22em] text-gray-500">Latest Updates</div>
                <div className="text-lg font-black text-gray-900 mt-1">Son Kullanıcılar</div>
              </div>
              <div className="text-xs font-extrabold text-gray-600">Gösterilen: {recentUsers.length}</div>
            </div>

            <div className="mt-4 space-y-2">
              {loading ? (
                <div className="text-sm text-gray-500">Yükleniyor...</div>
              ) : recentUsers.length === 0 ? (
                <div className="text-sm text-gray-500">Kullanıcı yok</div>
              ) : (
                recentUsers.map((u) => {
                  const isActive = Boolean(u.isActive)
                  const tenantCodes = (u.tenants ?? [])
                    .map((t) => String(t.tenantCode ?? '').trim().toUpperCase())
                    .filter(Boolean)
                    .slice(0, 4)
                    .join(', ')
                  return (
                    <div key={u.userKey} className="rounded-2xl border border-gray-200 bg-white p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm font-extrabold text-gray-900 truncate">{u.username}</div>
                          <div className="text-xs text-gray-500 mt-0.5 truncate">
                            {String(u.mail ?? '').trim()} {String(u.unvan ?? '').trim() ? `— ${String(u.unvan ?? '').trim()}` : ''}
                          </div>
                          <div className="text-xs text-gray-500 mt-1 truncate">{tenantCodes ? `Firmalar: ${tenantCodes}` : 'Firma yok'}</div>
                        </div>
                        <span className={`inline-flex items-center h-7 px-3 rounded-full text-[11px] font-black border whitespace-nowrap ${isActive ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-gray-50 border-gray-200 text-gray-700'}`}>
                          {isActive ? 'aktif' : 'pasif'}
                        </span>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </div>

          <div className="rounded-3xl border border-gray-200 bg-white shadow-[0_18px_45px_-32px_rgba(17,24,39,0.35)] p-5">
            <div className="text-[11px] font-black uppercase tracking-[0.22em] text-gray-500">Özet</div>
            <div className="text-lg font-black text-gray-900 mt-1">Günlük Kontrol</div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div className="rounded-2xl border border-gray-200 bg-gradient-to-b from-white to-gray-50 p-4">
                <div className="text-[11px] font-black uppercase tracking-[0.22em] text-gray-500">Son firma</div>
                <div className="mt-2 text-sm font-extrabold text-gray-900 truncate">{recentTenants[0]?.name ?? '—'}</div>
              </div>
              <div className="rounded-2xl border border-gray-200 bg-gradient-to-b from-white to-gray-50 p-4">
                <div className="text-[11px] font-black uppercase tracking-[0.22em] text-gray-500">Son kullanıcı</div>
                <div className="mt-2 text-sm font-extrabold text-gray-900 truncate">{recentUsers[0]?.username ?? '—'}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
