import { useEffect, useMemo, useState } from 'react'
import { Users, Clock, Target, CheckCircle2, RefreshCw, AlertCircle } from 'lucide-react'
import { fetchServiceAnalytics, type ServiceAnalyticsDto, type ServiceType } from '../api/serviceRecords'

const STATUS_LABELS: Record<string, string> = {
  New: 'Yeni Kayıt', Planned: 'Planlandı', Workshop: 'Atölyede',
  InRepair: 'Tamirde', WaitingForParts: 'Parça Bekliyor',
  Ready: 'Hazır', Delivered: 'Teslim Edildi',
  Cancelled: 'İptal', Delayed: 'Gecikti',
}

function pct(part: number, total: number) {
  if (!total) return 0
  return Math.round((part / total) * 100)
}

function initials(name: string) {
  const parts = String(name ?? '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  return parts.slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('')
}

type TypeFilter = '' | ServiceType

export default function AnalizPage() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<ServiceAnalyticsDto | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('')

  useEffect(() => {
    const ac = new AbortController()
    let intervalId: number | undefined

    const load = async () => {
      try {
        setError(null)
        setLoading(true)
        const res = await fetchServiceAnalytics({
          type: typeFilter ? typeFilter : undefined,
          signal: ac.signal,
        })
        setData(res)
      } catch (e: any) {
        if (String(e?.name ?? '') === 'AbortError') return
        setError(String(e?.message ?? 'Analiz verileri alınamadı.'))
      } finally {
        setLoading(false)
      }
    }

    void load()

    intervalId = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
      void load()
    }, 30_000)

    return () => {
      ac.abort()
      if (intervalId !== undefined) window.clearInterval(intervalId)
    }
  }, [reloadKey, typeFilter])

  const totals = data?.totals
  const completion = Math.round(totals?.completionRate ?? 0)
  const statusTotal = useMemo(() => (data?.byStatus ?? []).reduce((a, b) => a + (Number(b.count) || 0), 0), [data])
  const regionTotal = useMemo(() => (data?.byRegion ?? []).reduce((a, b) => a + (Number(b.count) || 0), 0), [data])
  const techMax = useMemo(() => Math.max(1, ...(data?.byTechnician ?? []).map((t) => Number(t.total) || 0)), [data])
  const productMax = useMemo(() => Math.max(1, ...(data?.byProduct ?? []).map((p) => Number(p.count) || 0)), [data])
  const trendMax = useMemo(() => Math.max(1, ...(data?.monthlyTrend ?? []).map((m) => Number(m.total) || 0)), [data])

  const metrics = [
    { label: 'Toplam Kayıt', value: totals?.total ?? 0, icon: Target },
    { label: 'Aktif İş Emri', value: totals?.active ?? 0, icon: Clock },
    { label: 'Tamamlanan', value: totals?.done ?? 0, icon: CheckCircle2 },
    { label: 'Tamamlanma Oranı', value: `${completion}%`, icon: Users },
  ]

  return (
    <div className="p-4 lg:p-6">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-xl lg:text-2xl font-bold text-gray-900">Analiz Paneli</h1>
          <p className="text-sm text-gray-500 mt-1">Montaj &amp; arıza süreçlerine ait canlı performans göstergeleri.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex bg-white border border-gray-200 rounded-lg p-0.5">
            {([
              { v: '', l: 'Tümü' },
              { v: 'Installation', l: 'Montaj' },
              { v: 'Repair', l: 'Arıza' },
            ] as Array<{ v: TypeFilter; l: string }>).map((opt) => (
              <button
                key={opt.l}
                type="button"
                onClick={() => setTypeFilter(opt.v)}
                className={
                  'px-3 py-1.5 text-sm rounded-md font-medium transition-colors ' +
                  (typeFilter === opt.v ? 'bg-[#B91C1C] text-white' : 'text-gray-600 hover:bg-gray-50')
                }
              >
                {opt.l}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setReloadKey((k) => k + 1)}
            disabled={loading}
            className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 disabled:opacity-60"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Yenile
          </button>
        </div>
      </div>

      {error ? (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <AlertCircle className="w-4 h-4" /> {error}
        </div>
      ) : null}

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3.5 mb-6">
        {metrics.map((m) => {
          const Icon = m.icon
          return (
            <div key={m.label} className="bg-white rounded-xl p-5 border border-gray-100 shadow-sm">
              <div className="p-2 rounded-lg w-fit mb-3 bg-red-50 text-[#B91C1C]">
                <Icon className="w-5 h-5" />
              </div>
              <div className="text-2xl font-bold text-gray-900">{m.value}</div>
              <div className="text-xs text-gray-500 mt-1">{m.label}</div>
            </div>
          )
        })}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3.5 mb-6">
        {[
          { l: 'Bugün Açılan', v: totals?.today ?? 0 },
          { l: 'Bu Ay', v: totals?.thisMonth ?? 0 },
          { l: 'Atölye', v: totals?.workshop ?? 0 },
          { l: 'Plan Süresi (Ort. Gün)', v: totals?.avgPlanLeadDays ?? 0 },
        ].map((c) => (
          <div key={c.l} className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm">
            <div className="text-[11px] text-gray-500 font-medium uppercase tracking-wide">{c.l}</div>
            <div className="text-xl font-bold text-gray-900 mt-1">{c.v}</div>
          </div>
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-6 mb-6">
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-900">Teknisyen Performansı</h3>
            <span className="text-xs text-gray-500">{data?.byTechnician?.length ?? 0} teknisyen</span>
          </div>
          <div className="space-y-4">
            {(data?.byTechnician ?? []).length === 0 ? (
              <div className="text-sm text-gray-500">Veri yok.</div>
            ) : (
              (data?.byTechnician ?? []).map((tech) => (
                <div key={tech.technician} className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center font-medium text-gray-700">
                    {initials(tech.technician)}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-medium text-gray-900">{tech.technician}</span>
                      <span className="text-sm text-gray-600">{tech.done}/{tech.total} tamamlandı</span>
                    </div>
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full bg-gradient-to-r from-[#B91C1C] to-[#DC2626] rounded-full" style={{ width: `${pct(tech.total, techMax)}%` }} />
                    </div>
                  </div>
                  <div className="text-xs font-semibold text-amber-600 whitespace-nowrap">{tech.active} aktif</div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-900">Bölgesel Dağılım</h3>
            <span className="text-xs text-gray-500">{regionTotal} kayıt</span>
          </div>
          <div className="space-y-4">
            {(data?.byRegion ?? []).length === 0 ? (
              <div className="text-sm text-gray-500">Veri yok.</div>
            ) : (
              (data?.byRegion ?? []).map((item) => (
                <div key={item.region}>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="text-gray-700">{item.region}</span>
                    <span className="font-medium text-gray-900">{item.count} servis · %{pct(item.count, regionTotal)}</span>
                  </div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-[#B91C1C] to-[#DC2626] rounded-full" style={{ width: `${pct(item.count, regionTotal)}%` }} />
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-900">Durum Dağılımı</h3>
            <span className="text-xs text-gray-500">{statusTotal} kayıt</span>
          </div>
          <div className="space-y-3">
            {(data?.byStatus ?? []).length === 0 ? (
              <div className="text-sm text-gray-500">Veri yok.</div>
            ) : (
              (data?.byStatus ?? []).map((s) => (
                <div key={s.status}>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="text-gray-700">{STATUS_LABELS[s.status] ?? s.status}</span>
                    <span className="font-medium text-gray-900">{s.count} · %{pct(s.count, statusTotal)}</span>
                  </div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-[#B91C1C] to-[#DC2626] rounded-full" style={{ width: `${pct(s.count, statusTotal)}%` }} />
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-900">Aylık Trend (Son 6 Ay)</h3>
            <span className="text-xs text-gray-500">Toplam / Tamamlanan</span>
          </div>
          {(data?.monthlyTrend ?? []).length === 0 ? (
            <div className="text-sm text-gray-500">Veri yok.</div>
          ) : (
            <div className="flex items-end gap-3 h-44">
              {(data?.monthlyTrend ?? []).map((m) => {
                const totalH = pct(m.total, trendMax)
                const doneH = pct(m.done, trendMax)
                return (
                  <div key={m.month} className="flex-1 flex flex-col items-center gap-2">
                    <div className="flex items-end gap-1 h-32 w-full justify-center">
                      <div className="w-3 rounded-t bg-[#FCA5A5]" style={{ height: `${totalH}%` }} title={`Toplam: ${m.total}`} />
                      <div className="w-3 rounded-t bg-[#B91C1C]" style={{ height: `${doneH}%` }} title={`Tamamlanan: ${m.done}`} />
                    </div>
                    <div className="text-[10px] text-gray-500">{m.month}</div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-900">En Çok Arıza Veren Ürünler</h3>
            <span className="text-xs text-gray-500">İlk 10 Ürün</span>
          </div>
          <div className="space-y-3">
            {(data?.byProduct ?? []).length === 0 ? (
              <div className="text-sm text-gray-500">Veri yok.</div>
            ) : (
              (data?.byProduct ?? []).map((p) => (
                <div key={p.product}>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="text-gray-700 truncate pr-2" title={p.product}>{p.product}</span>
                    <span className="font-medium text-gray-900 shrink-0">{p.count} kayıt</span>
                  </div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-[#B91C1C] rounded-full" style={{ width: `${pct(p.count, productMax)}%` }} />
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
