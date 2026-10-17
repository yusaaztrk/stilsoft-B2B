import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Loader2, RefreshCw } from 'lucide-react'

import { apiJson } from '../api/client'

/**
 * GÜNLÜK TAHSİLATLAR — bir gün içinde KİMİN NE SATTIĞI ve kaç para.
 *
 * Yönetim ekranıdır: yetkisi `gunlukTahsilat` anahtarında ve teknisyen rollerine varsayılan
 * KAPALIDIR (kullanıcı kararı, 2026-08-21: SSA / superadmin / yönetim / müdür).
 *
 * Veri kalem seviyesinde gelir, gruplama burada yapılır: müdür hem kişi başı toplamı hem tek
 * tek hangi ürünün satıldığını görmek istiyor. Gün sınırı sunucuda FİRMA SAATİYLE hesaplanır —
 * UTC ile hesaplanınca gece yarısına yakın satışlar komşu güne kayıyordu.
 */

type SatirDto = {
  user: string | null
  orderNo: string
  customerCode: string
  customerName: string | null
  createTime: string
  stockCode: string
  description: string | null
  quantity: number
  unitPrice: number
  discountAmount: number
  vatRate: number
  warehouseCode: number | null
  netAmount: number
  grossAmount: number
}

const para = (n: number) =>
  Number(n || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const bugunIso = () => {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const saat = (iso: string) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? '—'
    : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export default function GunlukTahsilatlarPage() {
  const [tarih, setTarih] = useState(bugunIso())
  const [satirlar, setSatirlar] = useState<SatirDto[]>([])
  const [yukleniyor, setYukleniyor] = useState(false)
  const [hata, setHata] = useState<string | null>(null)
  const [acik, setAcik] = useState<Record<string, boolean>>({})

  const yukle = async (signal?: AbortSignal) => {
    setYukleniyor(true)
    setHata(null)
    try {
      const res = await apiJson<{ success: boolean; data: SatirDto[] }>(
        `/api/erp/daily-sales?date=${encodeURIComponent(tarih)}`,
        { signal }
      )
      setSatirlar(Array.isArray(res?.data) ? res.data : [])
    } catch (e: any) {
      if (e?.name === 'AbortError') return
      setHata(String(e?.message ?? 'Günlük satışlar alınamadı'))
      setSatirlar([])
    } finally {
      setYukleniyor(false)
    }
  }

  useEffect(() => {
    const ac = new AbortController()
    void yukle(ac.signal)
    return () => ac.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tarih])

  /** Kişi bazında gruplama — sıralama en çok satandan aza. */
  const gruplar = useMemo(() => {
    const map = new Map<string, { user: string; satirlar: SatirDto[]; net: number; brut: number; adet: number }>()
    for (const s of satirlar) {
      const key = (s.user ?? '').trim() || '(bilinmiyor)'
      const g = map.get(key) ?? { user: key, satirlar: [], net: 0, brut: 0, adet: 0 }
      g.satirlar.push(s)
      g.net += Number(s.netAmount || 0)
      g.brut += Number(s.grossAmount || 0)
      g.adet += Number(s.quantity || 0)
      map.set(key, g)
    }
    return Array.from(map.values()).sort((a, b) => b.brut - a.brut)
  }, [satirlar])

  const genelNet = gruplar.reduce((t, g) => t + g.net, 0)
  const genelBrut = gruplar.reduce((t, g) => t + g.brut, 0)

  return (
    <div className="p-4 sm:p-5">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-gray-900 dark:text-white font-bold text-lg leading-tight">Günlük Tahsilatlar</h1>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Seçilen günde kimin ne sattığı ve tutarı.
          </p>
        </div>

        <div className="flex items-end gap-2">
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wide text-gray-500 mb-1">
              Tarih
            </label>
            <input
              type="date"
              value={tarih}
              max={bugunIso()}
              onChange={(e) => setTarih(e.target.value || bugunIso())}
              className="h-10 px-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 dark:text-white"
            />
          </div>
          <button
            type="button"
            onClick={() => void yukle()}
            disabled={yukleniyor}
            className="h-10 px-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs font-semibold text-gray-700 dark:text-gray-200 disabled:opacity-50 flex items-center gap-1.5"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${yukleniyor ? 'animate-spin' : ''}`} />
            Yenile
          </button>
        </div>
      </div>

      {hata && (
        <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 dark:bg-rose-950/20 dark:border-rose-900 px-4 py-3 text-xs text-rose-800 dark:text-rose-200 break-words">
          {hata}
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
        <span className="px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200">
          Satan kişi: <b>{gruplar.length}</b>
        </span>
        <span className="px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200">
          Kalem: <b>{satirlar.length}</b>
        </span>
        <span className="px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200">
          Net: <b>{para(genelNet)} ₺</b>
        </span>
        <span className="px-3 py-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/20 text-emerald-800 dark:text-emerald-300">
          KDV Dahil: <b>{para(genelBrut)} ₺</b>
        </span>
      </div>

      {yukleniyor && satirlar.length === 0 ? (
        <div className="py-12 flex items-center justify-center text-gray-400">
          <Loader2 className="w-5 h-5 animate-spin" />
        </div>
      ) : gruplar.length === 0 ? (
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-10 text-center text-sm text-gray-500">
          Bu güne ait satış yok.
        </div>
      ) : (
        <div className="space-y-2">
          {gruplar.map((g) => {
            const gAcik = acik[g.user] ?? false
            return (
              <div
                key={g.user}
                className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden"
              >
                <button
                  type="button"
                  onClick={() => setAcik((p) => ({ ...p, [g.user]: !gAcik }))}
                  className="w-full px-4 py-3 flex items-center justify-between gap-3 hover:bg-gray-50 dark:hover:bg-gray-700/40 text-left"
                >
                  <span className="flex items-center gap-2 min-w-0">
                    {gAcik ? (
                      <ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0" />
                    ) : (
                      <ChevronRight className="w-4 h-4 text-gray-400 flex-shrink-0" />
                    )}
                    <span className="font-bold text-sm text-gray-900 dark:text-white break-words">{g.user}</span>
                    <span className="text-[11px] text-gray-500 flex-shrink-0">
                      {g.satirlar.length} kalem · {g.adet} adet
                    </span>
                  </span>
                  <span className="text-sm font-bold text-emerald-700 dark:text-emerald-400 flex-shrink-0">
                    {para(g.brut)} ₺
                  </span>
                </button>

                {gAcik && (
                  <div className="overflow-x-auto border-t border-gray-100 dark:border-gray-700">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50 dark:bg-gray-900/40 text-gray-600 dark:text-gray-300">
                        <tr>
                          <th className="text-left px-3 py-2">Saat</th>
                          <th className="text-left px-3 py-2">Cari</th>
                          <th className="text-left px-3 py-2">Ürün</th>
                          <th className="text-right px-3 py-2">Adet</th>
                          <th className="text-right px-3 py-2">Birim</th>
                          <th className="text-right px-3 py-2">Net</th>
                          <th className="text-right px-3 py-2">KDV Dahil</th>
                          <th className="text-left px-3 py-2">Depo</th>
                          <th className="text-left px-3 py-2">Sipariş</th>
                        </tr>
                      </thead>
                      <tbody>
                        {g.satirlar.map((s, i) => (
                          <tr key={`${s.orderNo}-${s.stockCode}-${i}`} className="border-t border-gray-100 dark:border-gray-700">
                            <td className="px-3 py-2 text-gray-500">{saat(s.createTime)}</td>
                            <td className="px-3 py-2 break-words">
                              <div className="text-gray-900 dark:text-white">{s.customerName || s.customerCode}</div>
                              <div className="text-[10px] text-gray-500">{s.customerCode}</div>
                            </td>
                            <td className="px-3 py-2 break-words">
                              <div className="text-gray-900 dark:text-white">{s.description || s.stockCode}</div>
                              <div className="text-[10px] text-gray-500">{s.stockCode}</div>
                            </td>
                            <td className="px-3 py-2 text-right">{s.quantity}</td>
                            <td className="px-3 py-2 text-right">{para(s.unitPrice)}</td>
                            <td className="px-3 py-2 text-right">{para(s.netAmount)}</td>
                            <td className="px-3 py-2 text-right font-semibold">{para(s.grossAmount)}</td>
                            <td className="px-3 py-2 text-gray-500">{s.warehouseCode ?? '—'}</td>
                            <td className="px-3 py-2 text-gray-500 break-words">{s.orderNo}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
