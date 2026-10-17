import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { API_BASE_URL } from '../config/api'

type TenantListItem = {
  code: string
  name: string
}

export default function TenantSelectPage() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tenants, setTenants] = useState<TenantListItem[]>([])
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return tenants
    return tenants.filter((t) => `${t.code} ${t.name}`.toLowerCase().includes(q))
  }, [query, tenants])

  useEffect(() => {
    void (async () => {
      try {
        setLoading(true)
        setError(null)

        const res = await fetch(`${API_BASE_URL}/api/tenants/public`)
        if (!res.ok) {
          const t = await res.text().catch(() => '')
          throw new Error(t || `Tenant listesi alınamadı (${res.status})`)
        }

        const json = await res.json()
        const data = (json?.data ?? []) as TenantListItem[]
        setTenants(data)
      } catch (e: any) {
        setError(String(e?.message ?? 'Tenant listesi alınamadı'))
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  return (
    <div className="min-h-[calc(100vh-64px)] flex items-start justify-center pt-10 px-4">
      <div className="w-full max-w-[720px] bg-white border border-gray-200 rounded-2xl shadow-sm p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Firma / Proje Seç</h1>
            <p className="text-sm text-gray-500 mt-1">
              Devam etmek için bir firma seç.
            </p>
          </div>
          <button
            type="button"
            onClick={() => navigate('/users/projeYonetimi')}
            className="h-10 px-4 rounded-xl bg-gray-900 text-white text-sm font-semibold hover:bg-black transition"
          >
            Yeni Firma Oluştur
          </button>
        </div>

        <div className="mt-5">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Ara (kod / isim)"
            className="w-full h-11 px-4 rounded-xl border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-gray-900/10"
          />
        </div>

        {error && (
          <div className="mt-4 text-sm font-semibold text-red-600 bg-red-50 border border-red-100 rounded-xl px-4 py-3">
            {error}
          </div>
        )}

        <div className="mt-4 divide-y divide-gray-100 border border-gray-200 rounded-xl overflow-hidden">
          {loading ? (
            <div className="p-4 text-sm text-gray-500">Yükleniyor...</div>
          ) : filtered.length === 0 ? (
            <div className="p-4 text-sm text-gray-500">Kayıt bulunamadı</div>
          ) : (
            filtered.map((t) => (
              <button
                key={t.code}
                type="button"
                onClick={() => {
                  localStorage.setItem('tenantCode', t.code)
                  navigate('/home', { replace: true })
                }}
                className="w-full text-left p-4 hover:bg-gray-50 transition flex items-center justify-between gap-4"
              >
                <div>
                  <div className="text-sm font-bold text-gray-900">{t.name}</div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    Kod: <span className="font-semibold">{t.code}</span>
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
