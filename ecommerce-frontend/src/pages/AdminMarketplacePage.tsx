import { useMemo, useState } from 'react'
import { AdminLayout } from '../components/admin/AdminLayout'
import { Icon } from '../components/Icon'

type ChannelRow = {
  id: string
  channel: string
  listingCount: number
  syncStatus: 'Bağlı' | 'Uyarı' | 'Kapalı'
  lastSync: string
}

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ')
}

export function AdminMarketplacePage() {
  const [q, setQ] = useState('')

  const rows: ChannelRow[] = useMemo(
    () => [
      { id: 'MKT-01', channel: 'Trendyol', listingCount: 128, syncStatus: 'Bağlı', lastSync: '03.05.2026 13:10' },
      { id: 'MKT-02', channel: 'Hepsiburada', listingCount: 96, syncStatus: 'Uyarı', lastSync: '03.05.2026 09:42' },
      { id: 'MKT-03', channel: 'N11', listingCount: 0, syncStatus: 'Kapalı', lastSync: '—' },
    ],
    [],
  )

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return rows
    return rows.filter((r) => `${r.channel} ${r.id} ${r.syncStatus}`.toLowerCase().includes(s))
  }, [q, rows])

  return (
    <AdminLayout
      title="Pazaryeri"
      subtitle="Pazaryeri kanallarını izle, listelemeleri takip et ve senkron durumunu kontrol et."
      top={
        <div className="flex w-full items-center justify-end gap-2">
          <div className="hidden items-center gap-2 rounded-2xl border border-zinc-200 bg-white px-4 py-2 text-sm text-zinc-700 shadow-sm focus-within:ring-2 focus-within:ring-emerald-400/30 md:flex md:w-[520px]">
            <Icon name="search" className="h-4 w-4 text-zinc-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Kanal ara"
              className="w-full bg-transparent text-zinc-900 placeholder:text-zinc-400 outline-none"
            />
          </div>
        </div>
      }
    >
      <div className="md:hidden">
        <div className="flex items-center gap-2 rounded-2xl border border-zinc-200 bg-white px-4 py-2 text-sm text-zinc-700 shadow-sm focus-within:ring-2 focus-within:ring-emerald-400/30">
          <Icon name="search" className="h-4 w-4 text-zinc-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Kanal ara" className="w-full bg-transparent text-zinc-900 placeholder:text-zinc-400 outline-none" />
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-4">
        <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
          <div className="text-[11px] font-bold text-zinc-400 tracking-wide uppercase">Aktif Kanal</div>
          <div className="mt-2 text-2xl font-extrabold tracking-tight text-zinc-900">2</div>
          <div className="mt-1 text-[11px] font-semibold text-zinc-500">Bağlı</div>
        </div>
        <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
          <div className="text-[11px] font-bold text-zinc-400 tracking-wide uppercase">Toplam Listeleme</div>
          <div className="mt-2 text-2xl font-extrabold tracking-tight text-zinc-900">224</div>
          <div className="mt-1 text-[11px] font-semibold text-zinc-500">Ürün</div>
        </div>
        <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
          <div className="text-[11px] font-bold text-zinc-400 tracking-wide uppercase">Senkron Uyarısı</div>
          <div className="mt-2 text-2xl font-extrabold tracking-tight text-zinc-900">1</div>
          <div className="mt-1 text-[11px] font-semibold text-rose-600">Kontrol</div>
        </div>
        <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
          <div className="text-[11px] font-bold text-zinc-400 tracking-wide uppercase">Son Senkron</div>
          <div className="mt-2 text-2xl font-extrabold tracking-tight text-zinc-900">13:10</div>
          <div className="mt-1 text-[11px] font-semibold text-zinc-500">Bugün</div>
        </div>
      </div>

      <div className="mt-4 overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
        <div className="grid grid-cols-12 gap-3 border-b border-zinc-100 bg-zinc-50 px-5 py-3 text-[11px] font-bold tracking-widest text-zinc-400 uppercase">
          <div className="col-span-4">Kanal</div>
          <div className="col-span-3">Listeleme</div>
          <div className="col-span-3">Durum</div>
          <div className="col-span-2 text-right">Son Senkron</div>
        </div>

        <div className="divide-y divide-zinc-100">
          {filtered.map((r) => (
            <div key={r.id} className="grid grid-cols-12 gap-3 px-5 py-4 text-sm transition hover:bg-zinc-50/70">
              <div className="col-span-4 flex flex-col justify-center">
                <div className="font-semibold text-zinc-900">{r.channel}</div>
                <div className="mt-0.5 text-xs text-zinc-400">{r.id}</div>
              </div>
              <div className="col-span-3 text-zinc-600 flex items-center text-xs">{r.listingCount} ürün</div>
              <div className="col-span-3 flex items-center">
                <span
                  className={cx(
                    'rounded-full border px-2.5 py-0.5 text-[10px] font-bold',
                    r.syncStatus === 'Bağlı'
                      ? 'border-primary/20 bg-primary/5 text-primary'
                      : r.syncStatus === 'Uyarı'
                        ? 'border-rose-200 bg-rose-50 text-rose-700'
                        : 'border-zinc-200 bg-zinc-50 text-zinc-500',
                  )}
                >
                  {r.syncStatus}
                </span>
              </div>
              <div className="col-span-2 flex items-center justify-end text-xs text-zinc-500">{r.lastSync}</div>
            </div>
          ))}

          {filtered.length === 0 ? (
            <div className="px-5 py-12 text-center text-sm text-zinc-400">Sonuç bulunamadı.</div>
          ) : null}
        </div>
      </div>
    </AdminLayout>
  )
}
