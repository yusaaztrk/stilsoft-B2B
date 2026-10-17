import React, { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, RefreshCcw, TrendingDown, Users } from 'lucide-react'
import { PageHeader } from './shared'

/*
  ZİYARET HUNİSİ (2026-09-21).

  SORULAN SORU: "toplam kaç kişi girdi, kaç tane guest oldu, yani üyeliksiz gezme kaç kişi,
  nerede takıldı?"

  NEDEN GA4 DEĞİL: GA4 kimliği panelde boş; girilse bile oradaki oturum bizim sipariş
  numaramızla eşleşmiyor ve "sepete gelen 40 kişiden 33'ü ödemeye geçmedi" cümlesi
  kurulamıyor. Bu rapor siparişin kendi veritabanından geliyor.

  OKUMA BİÇİMİ: her satır, o adıma ULAŞAN oturum sayısı. Sağdaki kırmızı sayı ise o adımda
  TAKILAN — yani bir sonrakine hiç geçmeyen — oturum sayısı. Panelde asıl bakılacak sayı o:
  hangi adımda kaç müşteri kaybediliyor.
*/

const SHOP_API =
  (import.meta as any).env?.VITE_SHOP_API_BASE_URL ||
  (import.meta as any).env?.VITE_SHOP_API_URL ||
  'http://localhost:5150'

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('accessToken')
  const tenant = localStorage.getItem('tenantCode')
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(tenant ? { 'X-Tenant-Code': tenant } : {})
  }
}

type FunnelStep = {
  step: string
  label: string
  sessions: number
  droppedHere: number
}

type PathRow = { path: string; step: string; sessions: number }

type Funnel = {
  days: number
  totalSessions: number
  guestSessions: number
  memberSessions: number
  steps: FunnelStep[]
  topExitPaths: PathRow[]
}

const GUN_SECENEKLERI = [7, 30, 90]

/** Oran metni — payda sıfırken "%0" değil "—" yazılmalı, yoksa veri yokken kötü sonuç izlenimi verir. */
const yuzde = (pay: number, payda: number) =>
  payda > 0 ? `%${Math.round((pay / payda) * 100)}` : '—'

export default function AnalitikPage() {
  const [data, setData] = useState<Funnel | null>(null)
  const [gun, setGun] = useState(30)
  const [busy, setBusy] = useState(false)
  const [hata, setHata] = useState<string | null>(null)

  const yukle = useCallback(async (gunSayisi: number) => {
    setBusy(true)
    setHata(null)
    try {
      const res = await fetch(`${SHOP_API}/api/admin/analytics/funnel?gun=${gunSayisi}`, {
        headers: authHeaders()
      })
      if (!res.ok) throw new Error(`Rapor alınamadı (${res.status})`)
      const json = await res.json()
      setData(json?.data ?? null)
    } catch (e: any) {
      setHata(e?.message || 'Rapor alınamadı.')
      setData(null)
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    void yukle(gun)
  }, [gun, yukle])

  const toplam = data?.totalSessions ?? 0
  // Huninin ilk basamağı payda: "siteye giren" herkes.
  const girisAdimi = data?.steps?.[0]?.sessions ?? 0
  const siparisAdimi = data?.steps?.[data.steps.length - 1]?.sessions ?? 0

  return (
    <div className="p-4 lg:p-6 space-y-4">
      <PageHeader
        title="Ziyaret Analizi"
        desc="Kaç kişi girdi, kaçı üye olmadan gezdi ve hangi adımda kaybedildi."
        right={
          <div className="flex items-center gap-2">
            <div className="flex rounded-2xl border border-gray-200 bg-white overflow-hidden">
              {GUN_SECENEKLERI.map((g) => (
                <button
                  key={g}
                  onClick={() => setGun(g)}
                  className={`px-3 h-9 text-xs font-bold transition ${
                    gun === g ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {g} gün
                </button>
              ))}
            </div>
            <button
              onClick={() => void yukle(gun)}
              disabled={busy}
              className="h-9 px-3 rounded-2xl border border-gray-200 bg-white text-xs font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-50 flex items-center gap-1.5"
            >
              <RefreshCcw className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} />
              Yenile
            </button>
          </div>
        }
      />

      {hata && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{hata}</div>
      )}

      {/* ÖZET KUTULARI */}
      {data && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          <div className="px-4 py-3 rounded-2xl border border-gray-200 bg-white">
            <div className="text-[10px] font-bold text-gray-500 uppercase">Toplam Ziyaret</div>
            <div className="text-2xl font-black text-gray-900">{toplam}</div>
            <div className="text-[11px] text-gray-400 mt-0.5">son {data.days} gün</div>
          </div>
          <div className="px-4 py-3 rounded-2xl border border-amber-200 bg-amber-50">
            <div className="text-[10px] font-bold text-amber-700 uppercase flex items-center gap-1">
              <Users className="w-3 h-3" /> Üye Olmadan
            </div>
            <div className="text-2xl font-black text-amber-900">{data.guestSessions}</div>
            <div className="text-[11px] text-amber-700 mt-0.5">{yuzde(data.guestSessions, toplam)} misafir</div>
          </div>
          <div className="px-4 py-3 rounded-2xl border border-gray-200 bg-white">
            <div className="text-[10px] font-bold text-gray-500 uppercase">Giriş Yapan</div>
            <div className="text-2xl font-black text-gray-900">{data.memberSessions}</div>
            <div className="text-[11px] text-gray-400 mt-0.5">{yuzde(data.memberSessions, toplam)}</div>
          </div>
          <div className="px-4 py-3 rounded-2xl border border-emerald-200 bg-emerald-50">
            <div className="text-[10px] font-bold text-emerald-700 uppercase">Siparişe Dönen</div>
            <div className="text-2xl font-black text-emerald-900">{siparisAdimi}</div>
            <div className="text-[11px] text-emerald-700 mt-0.5">{yuzde(siparisAdimi, girisAdimi)} dönüşüm</div>
          </div>
        </div>
      )}

      {data && toplam === 0 && (
        <div className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-6 text-sm text-gray-600">
          <div className="font-bold text-gray-900 mb-1">Henüz ziyaret kaydı yok.</div>
          Kayıt, bu sürüm yayına alındıktan sonra ziyaretçi geldikçe birikir. Ölçüm kişisel veri
          tutmuyor: IP, çerez ya da e-posta kaydedilmiyor; yalnız oturum başına hangi adıma
          kadar gelindiği yazılıyor.
        </div>
      )}

      {/* HUNİ */}
      {data && toplam > 0 && (
        <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
            <div className="text-sm font-black text-gray-900">Müşteri Yolculuğu</div>
            <p className="text-xs text-gray-500 mt-1">
              Soldaki sayı o adıma <b>ulaşan</b>, sağdaki kırmızı sayı o adımda <b>takılan</b>
              {' '}(bir sonrakine hiç geçmeyen) ziyaret sayısıdır.
            </p>
          </div>

          <div className="p-4 space-y-2">
            {data.steps.map((s, i) => {
              const oran = girisAdimi > 0 ? (s.sessions / girisAdimi) * 100 : 0
              const oncekiler = i > 0 ? data.steps[i - 1].sessions : s.sessions
              const dususOrani = oncekiler > 0 ? Math.round((1 - s.sessions / oncekiler) * 100) : 0

              return (
                <div key={s.step} className="flex items-center gap-3">
                  <div className="w-7 h-7 rounded-full bg-gray-900 text-white text-xs font-black flex items-center justify-center flex-none">
                    {i + 1}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between gap-3 mb-1">
                      <span className="text-sm font-bold text-gray-900 truncate">{s.label}</span>
                      <span className="text-sm font-black text-gray-900 whitespace-nowrap">
                        {s.sessions}
                        <span className="text-[11px] font-bold text-gray-400 ml-1.5">
                          {yuzde(s.sessions, girisAdimi)}
                        </span>
                      </span>
                    </div>
                    {/* Çubuk: ilk adıma göre oran. Genişliği okunur kalsın diye en az %2. */}
                    <div className="h-2.5 rounded-full bg-gray-100 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gray-900"
                        style={{ width: `${Math.max(oran, oran > 0 ? 2 : 0)}%` }}
                      />
                    </div>
                  </div>

                  <div className="w-32 flex-none text-right">
                    {s.droppedHere > 0 ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-bold text-red-700">
                        <TrendingDown className="w-3 h-3" />
                        {s.droppedHere} kişi burada kaldı
                      </span>
                    ) : i > 0 && dususOrani > 0 ? (
                      <span className="text-[11px] font-semibold text-gray-400">−%{dususOrani}</span>
                    ) : null}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* EN ÇOK TERK EDİLEN ADRESLER */}
      {data && data.topExitPaths.length > 0 && (
        <div className="rounded-2xl border border-amber-200 bg-white overflow-hidden">
          <div className="px-4 py-3 border-b border-amber-200 bg-amber-50">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600" />
              <div className="text-sm font-black text-gray-900">Siteden Çıkılan Son Sayfalar</div>
            </div>
            <p className="text-xs text-gray-600 mt-1">
              Huni &quot;hangi adımda&quot; der; bu liste <b>hangi sayfada</b> der. Aynı adres
              başta çıkıyorsa o sayfada bir sorun vardır — boş kategori, tükenen ürün, kafa
              karıştıran bir adım.
            </p>
          </div>
          <div className="overflow-x-auto max-h-[380px]">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white">
                <tr className="text-[11px] font-bold uppercase tracking-wide text-gray-500 border-b border-gray-100">
                  <th className="text-left px-4 py-2">Sayfa</th>
                  <th className="text-left px-3 py-2">Adım</th>
                  <th className="text-right px-4 py-2">Ziyaret</th>
                </tr>
              </thead>
              <tbody>
                {data.topExitPaths.map((r, i) => (
                  <tr key={`${r.path}-${i}`} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/60">
                    <td className="px-4 py-2 font-mono text-xs text-gray-800 truncate max-w-[420px]" title={r.path}>
                      {r.path}
                    </td>
                    <td className="px-3 py-2 text-gray-500">{r.step}</td>
                    <td className="px-4 py-2 text-right font-black text-gray-900">{r.sessions}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
