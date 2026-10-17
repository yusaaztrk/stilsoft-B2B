import { useCallback, useEffect, useState } from 'react'
import { ShieldAlert, RefreshCw, Check, ExternalLink } from 'lucide-react'
import { apiFetch } from '../config/api'
import AyarliTablo from './table/AyarliTablo'

/**
 * ŞÜPHELİ İŞLEMLER (2026-10-16, sahte konum / Fake GPS tespiti).
 *
 * Sunucu her giriş/çıkışta kaydın izine bakar (bkz. Employee.Service.Api
 * `AttendanceSuspicionDetector`): farklı günde birebir aynı koordinat, bölge merkezinin
 * kopyası, imkânsız hız, olağandışı hassasiyet. Şüphe girişi ENGELLEMEZ; burada listelenir,
 * yönetici inceleyip "İncelendi" der. Konum ayarları ekranında durur — aynı yetki.
 */
type Suspicion = {
  id: number
  employeeId: number
  employeeName: string
  employeeCode?: string | null
  eventKind: string
  ruleCode: string
  ruleLabel: string
  detail: string
  source: string
  latitude: number
  longitude: number
  accuracy?: number | null
  createTime: string
  reviewedBy?: string | null
  reviewedAt?: string | null
}

const SOURCE_LABEL: Record<string, string> = { yuz: 'Yüz', qr: 'QR', 'mesaiyi-bitir': 'Mesaiyi Bitir' }

function fmt(value: string) {
  return new Date(value).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export default function SupheliIslemler() {
  const [rows, setRows] = useState<Suspicion[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [days, setDays] = useState(30)
  const [includeReviewed, setIncludeReviewed] = useState(false)
  const [busyId, setBusyId] = useState<number | null>(null)

  const load = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const json = await apiFetch<{ data: Suspicion[] }>(
        `/api/EmployeeLocationSettings/suspicions?days=${days}&includeReviewed=${includeReviewed}`,
        { fallbackError: 'Şüpheli işlemler alınamadı' }
      )
      setRows(json?.data ?? [])
    } catch (e: any) {
      setError(String(e?.message ?? 'Şüpheli işlemler alınamadı'))
    } finally {
      setLoading(false)
    }
  }, [days, includeReviewed])

  useEffect(() => {
    void load()
  }, [load])

  const review = async (id: number) => {
    try {
      setBusyId(id)
      await apiFetch(`/api/EmployeeLocationSettings/suspicions/${id}/review`, { method: 'POST', body: {}, fallbackError: 'İşaretlenemedi' })
      await load()
    } catch (e: any) {
      setError(String(e?.message ?? 'İşaretlenemedi'))
    } finally {
      setBusyId(null)
    }
  }

  const open = rows.filter((r) => !r.reviewedAt).length

  return (
    <div className="mt-6 rounded-2xl border border-slate-200/90 bg-white p-5 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <ShieldAlert className={`mt-0.5 h-5 w-5 shrink-0 ${open > 0 ? 'text-rose-600' : 'text-slate-400'}`} />
          <div>
            <h3 className="text-base font-black text-slate-900">
              Şüpheli İşlemler {open > 0 ? <span className="ml-1 rounded-full bg-rose-100 px-2 py-0.5 text-xs text-rose-700">{open}</span> : null}
            </h3>
            <p className="mt-0.5 max-w-3xl text-[11px] leading-4 text-slate-500">
              Sahte konum (Fake GPS) izi taşıyan giriş/çıkışlar. Kayıt engellenmez; inceleyip "İncelendi" deyin.
              Tarayıcı sahte konum uygulamasını doğrudan söyleyemez — liste kaydın izinden çıkarılır, kesin hüküm değildir.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="h-8 rounded-lg border border-slate-200 bg-white px-2">
            {[7, 30, 90, 365].map((d) => (
              <option key={d} value={d}>Son {d} gün</option>
            ))}
          </select>
          <label className="inline-flex items-center gap-1.5 font-semibold text-slate-600">
            <input type="checkbox" checked={includeReviewed} onChange={(e) => setIncludeReviewed(e.target.checked)} />
            İncelenenler de
          </label>
          <button type="button" onClick={() => void load()} className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 px-2.5 font-semibold text-slate-700 hover:bg-slate-50">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Yenile
          </button>
        </div>
      </div>

      {error ? <div className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">{error}</div> : null}

      <div className="mt-4 overflow-x-auto">
        <AyarliTablo ayarKey="supheli-islemler">
          <table className="w-full min-w-[880px] text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-left text-[10px] font-black uppercase tracking-wider text-slate-500">
                <th className="px-2 py-2">Zaman</th>
                <th className="px-2 py-2">Personel</th>
                <th className="px-2 py-2">İşlem</th>
                <th className="px-2 py-2">Şüphe</th>
                <th className="px-2 py-2">Açıklama</th>
                <th className="px-2 py-2">Konum</th>
                <th className="px-2 py-2">Durum</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-2 py-6 text-center text-slate-400">
                    {loading ? 'Yükleniyor…' : 'Şüpheli işlem yok.'}
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id} className="border-b border-slate-100 align-top">
                    <td className="whitespace-nowrap px-2 py-2 text-slate-700">{fmt(r.createTime)}</td>
                    <td className="px-2 py-2 font-semibold text-slate-900">
                      {r.employeeName || `#${r.employeeId}`}
                      {r.employeeCode ? <div className="text-[10px] font-normal text-slate-400">{r.employeeCode}</div> : null}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 text-slate-700">
                      {r.eventKind} · {SOURCE_LABEL[r.source] ?? r.source}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2">
                      <span className="rounded-full bg-rose-50 px-2 py-0.5 font-bold text-rose-700">{r.ruleLabel}</span>
                    </td>
                    <td className="px-2 py-2 leading-4 text-slate-600">{r.detail}</td>
                    <td className="whitespace-nowrap px-2 py-2">
                      <a
                        href={`https://www.google.com/maps?q=${r.latitude},${r.longitude}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 font-semibold text-sky-700 hover:underline"
                      >
                        Haritada <ExternalLink size={11} />
                      </a>
                      {r.accuracy != null ? <div className="text-[10px] text-slate-400">±{Math.round(r.accuracy)} m</div> : null}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2">
                      {r.reviewedAt ? (
                        <span className="text-[11px] text-emerald-700">İncelendi · {r.reviewedBy}</span>
                      ) : (
                        <button
                          type="button"
                          disabled={busyId === r.id}
                          onClick={() => void review(r.id)}
                          className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1 font-bold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
                        >
                          <Check size={12} /> İncelendi
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </AyarliTablo>
      </div>
    </div>
  )
}
