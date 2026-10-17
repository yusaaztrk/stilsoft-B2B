import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Gift, RefreshCcw } from 'lucide-react'
import { API_BASE_URL } from '../config/api'

/*
  E-TİCARET → KAMPANYA YÖNETİMİ (2026-09-19, kullanıcı: "B2B'de oluşturulan kampanyalar
  e-ticarete de yansısın; ürünlerdeki gibi ara sayfada anahtarı açıp kapatalım").

  Ürün Yönetimi'nin kampanya karşılığı: B2B'de tanımlı ÜRÜN ve KATEGORİ/MARKA indirimleri
  listelenir, her satırda vitrin anahtarı var. Anahtar ERP'de (`Campaigns.EcommerceEnabled`);
  vitrin (Shop.Api) bu alanı doğrudan okur. Diğer kampanya tipleri (sepet, adet, X al Y öde,
  paket) vitrinde bir ürün fiyatı değiştirmediği için burada yok.

  Fiyat kuralı: indirim F4'e uygulanır; vitrin fiyatı zaten F4 olduğu için 26.000 → 21.000
  klima vitrinde de 21.000 görünür. Kampanyanın B2B'deki fiyat grubu / bayi süzgeçleri vitrinde
  bakılmaz — anahtar + tarih aralığı yeter.
*/

type EcommerceCampaign = {
  id: string
  name: string
  description?: string | null
  kampanyaTipi: string
  startDate?: string | null
  endDate?: string | null
  isIndefinite: boolean
  isActive: boolean
  ecommerceEnabled: boolean
  iskontoTipi?: string | null
  deger?: number | null
  stockCodes: string[]
  groupCodes: string[]
  liveOnShop: boolean
  expired: boolean
  notStarted: boolean
}

function authHeaders(json: boolean): Record<string, string> {
  const token = localStorage.getItem('accessToken')
  const tenant = localStorage.getItem('tenantCode')
  return {
    ...(json ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(tenant ? { 'X-Tenant-Code': tenant } : {})
  }
}

function formatDate(v?: string | null) {
  if (!v) return '—'
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('tr-TR')
}

function formatDiscount(c: EcommerceCampaign) {
  const v = Number(c.deger ?? 0)
  if (!Number.isFinite(v) || v <= 0) return '—'
  return String(c.iskontoTipi ?? '').toLowerCase() === 'oran'
    ? `%${v.toLocaleString('tr-TR', { maximumFractionDigits: 2 })}`
    : `${v.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} TL (F4'ten)`
}

function typeLabel(t: string) {
  const k = String(t ?? '').toLowerCase()
  if (k === 'urunindirimi' || k === '4') return 'Seçili Ürün'
  if (k === 'kategorimarkaindirimi' || k === '5') return 'Kategori / Marka'
  return t
}

export default function EticaretKampanyalarSection() {
  const [rows, setRows] = useState<EcommerceCampaign[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [onlyOpen, setOnlyOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`${API_BASE_URL}/api/campaigns/ecommerce`, { headers: authHeaders(false) })
      const json = await res.json().catch(() => null)
      if (!res.ok || json?.success === false) throw new Error(json?.message || `Kampanyalar alınamadı (${res.status})`)
      setRows((json?.data ?? []) as EcommerceCampaign[])
    } catch (e: any) {
      setError(String(e?.message ?? 'Kampanyalar alınamadı.'))
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const toggle = async (c: EcommerceCampaign, enabled: boolean) => {
    setBusyId(c.id)
    setError('')
    try {
      const res = await fetch(`${API_BASE_URL}/api/campaigns/${encodeURIComponent(c.id)}/ecommerce`, {
        method: 'PUT',
        headers: authHeaders(true),
        body: JSON.stringify({ enabled })
      })
      const json = await res.json().catch(() => null)
      if (!res.ok || json?.success === false) throw new Error(json?.message || `Anahtar değiştirilemedi (${res.status})`)
      // Satırı yerinde güncelle; liste yeniden çekilmezse de doğru görünür.
      setRows((prev) =>
        prev.map((r) =>
          r.id === c.id
            ? { ...r, ecommerceEnabled: enabled, liveOnShop: enabled && r.isActive && !r.expired && !r.notStarted }
            : r
        )
      )
    } catch (e: any) {
      setError(String(e?.message ?? 'Anahtar değiştirilemedi.'))
    } finally {
      setBusyId(null)
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLocaleLowerCase('tr-TR')
    return rows.filter((r) => {
      if (onlyOpen && !r.ecommerceEnabled) return false
      if (!q) return true
      const hay = [r.name, r.description ?? '', ...r.stockCodes, ...r.groupCodes].join(' ').toLocaleLowerCase('tr-TR')
      return hay.includes(q)
    })
  }, [rows, search, onlyOpen])

  const stats = useMemo(
    () => ({
      total: rows.length,
      open: rows.filter((r) => r.ecommerceEnabled).length,
      live: rows.filter((r) => r.liveOnShop).length
    }),
    [rows]
  )

  const statusOf = (r: EcommerceCampaign) => {
    if (!r.ecommerceEnabled) return { text: 'Vitrinde kapalı', cls: 'bg-gray-100 text-gray-700' }
    if (!r.isActive) return { text: 'Kampanya pasif', cls: 'bg-slate-100 text-slate-700' }
    if (r.expired) return { text: 'Süresi doldu', cls: 'bg-red-50 text-red-700' }
    if (r.notStarted) return { text: 'Henüz başlamadı', cls: 'bg-amber-50 text-amber-700' }
    return { text: 'Vitrinde', cls: 'bg-emerald-50 text-emerald-700' }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-gray-200 bg-white">
        <div className="px-6 py-4 border-b border-gray-100 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-base font-semibold text-gray-900 flex items-center gap-2">
              <Gift className="w-4 h-4 text-indigo-600" /> Kampanya Yönetimi
            </div>
            <div className="text-xs text-gray-500 mt-0.5">
              B2B'de tanımlı ürün ve kategori indirimleri. Anahtar açıkken kampanya vitrinde de uygulanır; indirim Fiyat 4'ten düşer, vitrin fiyatı zaten Fiyat 4'tür.
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Kampanya, ürün kodu, kategori…"
              className="rounded-md border border-gray-200 px-3 py-2 text-sm w-64"
            />
            <label className="inline-flex items-center gap-2 text-xs font-medium text-gray-700 select-none">
              <input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} />
              Yalnız açık olanlar
            </label>
            <button
              type="button"
              onClick={() => void load()}
              className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50"
            >
              <RefreshCcw className="w-3.5 h-3.5" /> Yenile
            </button>
          </div>
        </div>

        <div className="px-6 py-3 border-b border-gray-100 flex flex-wrap gap-2">
          {[
            { label: 'Kampanya', value: stats.total, tone: 'border-gray-200 bg-white text-gray-900' },
            { label: 'Anahtarı açık', value: stats.open, tone: 'border-indigo-200 bg-indigo-50 text-indigo-700' },
            { label: 'Şu an vitrinde', value: stats.live, tone: 'border-emerald-200 bg-emerald-50 text-emerald-700' }
          ].map((s) => (
            <div key={s.label} className={`rounded-lg border px-3 py-2 min-w-[120px] ${s.tone}`}>
              <div className="text-[11px] font-medium opacity-80">{s.label}</div>
              <div className="text-lg font-bold leading-tight">{s.value}</div>
            </div>
          ))}
        </div>

        {error && <div className="px-6 py-3 text-sm text-red-700 bg-red-50 border-b border-red-100">{error}</div>}

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-2 text-left">Kampanya</th>
                <th className="px-4 py-2 text-left">Tip</th>
                <th className="px-4 py-2 text-left">Kapsam</th>
                <th className="px-4 py-2 text-left">İndirim</th>
                <th className="px-4 py-2 text-left">Tarih</th>
                <th className="px-4 py-2 text-left">Durum</th>
                <th className="px-4 py-2 text-center">Vitrin</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading && rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-gray-500">Yükleniyor…</td>
                </tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                    {rows.length === 0 ? 'Vitrine açılabilecek kampanya yok. Önce Ayarlar → Kampanya Tanım\'dan ürün ya da kategori indirimi oluşturun.' : 'Süzgece uyan kampanya yok.'}
                  </td>
                </tr>
              )}
              {filtered.map((r) => {
                const st = statusOf(r)
                const scope = r.stockCodes.length > 0
                  ? `${r.stockCodes.slice(0, 4).join(', ')}${r.stockCodes.length > 4 ? ` +${r.stockCodes.length - 4}` : ''}`
                  : r.groupCodes.length > 0
                    ? r.groupCodes.join(', ')
                    : '—'
                return (
                  <tr key={r.id} className="hover:bg-gray-50/60">
                    <td className="px-4 py-2.5">
                      <div className="font-semibold text-gray-900">{r.name}</div>
                      {r.description && <div className="text-xs text-gray-500 line-clamp-1">{r.description}</div>}
                    </td>
                    <td className="px-4 py-2.5 text-gray-700 whitespace-nowrap">{typeLabel(r.kampanyaTipi)}</td>
                    <td className="px-4 py-2.5 text-gray-700 font-mono text-xs">{scope}</td>
                    <td className="px-4 py-2.5 text-gray-900 font-semibold whitespace-nowrap">{formatDiscount(r)}</td>
                    <td className="px-4 py-2.5 text-gray-700 whitespace-nowrap text-xs">
                      {r.isIndefinite ? 'Süresiz' : `${formatDate(r.startDate)} – ${formatDate(r.endDate)}`}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${st.cls}`}>{st.text}</span>
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={r.ecommerceEnabled}
                        disabled={busyId === r.id}
                        onClick={() => void toggle(r, !r.ecommerceEnabled)}
                        title={r.ecommerceEnabled ? 'Vitrinden kaldır' : 'Vitrine aç'}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-50 ${r.ecommerceEnabled ? 'bg-emerald-500' : 'bg-gray-300'}`}
                      >
                        <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${r.ecommerceEnabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
