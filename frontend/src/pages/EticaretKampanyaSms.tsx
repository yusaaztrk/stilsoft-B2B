import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { MessageSquare, RefreshCcw, Send } from 'lucide-react'

/*
  ÜYELERE KAMPANYA SMS'İ (2026-09-20) — E-Ticaret → Kampanyalar sekmesinin altında.

  Vitrin üyelerine (telefonu olan, aktif, SMS'ten çıkmamış gerçek üyeler) tek metin gider.
  Gönderim mağaza API'sinde ARKA PLANDA koşar; burası başlatır ve ilerlemeyi 2 sn'de bir sorar.
  Yanlışlıkla 800 kişiye SMS gitmesin diye: önce "Deneme gönder" (kendi numarana), sonra
  "N kişiye gönder" onay kutusu. Türkçe karakter mağaza tarafında ASCII'ye çevrilir (SMS iki
  kredi olmasın); önizleme aynı dönüşümü gösterir.
*/

const SHOP_API =
  (import.meta as any).env?.VITE_SHOP_API_BASE_URL ||
  (import.meta as any).env?.VITE_SHOP_API_URL ||
  'http://localhost:5150'

function authHeaders(json = true): Record<string, string> {
  const token = localStorage.getItem('accessToken')
  const tenant = localStorage.getItem('tenantCode')
  return {
    ...(json ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(tenant ? { 'X-Tenant-Code': tenant } : {})
  }
}

type Audience = { configured: boolean; credit: number | null; audience: number; maxRecipients: number; maxLength: number; running: boolean }
type Job = { logId: number; message: string; startedBy: string; startedAtUtc: string; total: number; sent: number; failed: number; finished: boolean; error?: string | null }
type LogRow = { id: number; sentAtUtc: string; sentBy?: string | null; message: string; recipients: number; succeeded: number; failed: number; finishedAtUtc?: string | null }

const ascii = (s: string) =>
  s.replace(/ç/g, 'c').replace(/Ç/g, 'C').replace(/ğ/g, 'g').replace(/Ğ/g, 'G').replace(/ı/g, 'i').replace(/İ/g, 'I')
    .replace(/ö/g, 'o').replace(/Ö/g, 'O').replace(/ş/g, 's').replace(/Ş/g, 'S').replace(/ü/g, 'u').replace(/Ü/g, 'U')

const fmt = (v?: string | null) => {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('tr-TR')
}

export default function EticaretKampanyaSms() {
  const [aud, setAud] = useState<Audience | null>(null)
  const [message, setMessage] = useState('')
  const [testPhone, setTestPhone] = useState('')
  const [job, setJob] = useState<Job | null>(null)
  const [recent, setRecent] = useState<LogRow[]>([])
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [confirming, setConfirming] = useState(false)

  const loadAudience = useCallback(async () => {
    try {
      const res = await fetch(`${SHOP_API}/api/admin/marketing/sms-audience`, { headers: authHeaders(false) })
      const json = await res.json().catch(() => null)
      if (res.ok) setAud(json?.data ?? null)
    } catch {
      setAud(null)
    }
  }, [])

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch(`${SHOP_API}/api/admin/marketing/sms/status`, { headers: authHeaders(false) })
      const json = await res.json().catch(() => null)
      if (res.ok) {
        setJob(json?.data?.current ?? null)
        setRecent((json?.data?.recent ?? []) as LogRow[])
      }
    } catch {
      /* sessiz */
    }
  }, [])

  useEffect(() => {
    void loadAudience()
    void loadStatus()
  }, [loadAudience, loadStatus])

  // Gönderim sürerken ilerleme
  useEffect(() => {
    if (!job || job.finished) return
    const t = window.setInterval(() => void loadStatus(), 2000)
    return () => window.clearInterval(t)
  }, [job, loadStatus])

  const preview = useMemo(() => ascii(message.trim()), [message])
  const maxLen = aud?.maxLength ?? 300
  const smsParts = preview.length === 0 ? 0 : preview.length <= 160 ? 1 : Math.ceil(preview.length / 153)

  const post = async (body: Record<string, unknown>) => {
    const res = await fetch(`${SHOP_API}/api/admin/marketing/sms`, { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) })
    const json = await res.json().catch(() => null)
    if (!res.ok) throw new Error(json?.message ?? `İstek başarısız (${res.status})`)
    return json
  }

  const sendTest = async () => {
    if (!preview || !testPhone.trim()) return
    setBusy(true)
    setNotice(null)
    try {
      const json = await post({ message: preview, testPhone: testPhone.trim() })
      setNotice({ kind: 'ok', text: json?.message ?? 'Deneme SMS\'i gönderildi.' })
    } catch (e: any) {
      setNotice({ kind: 'err', text: String(e?.message ?? 'Deneme gönderilemedi.') })
    } finally {
      setBusy(false)
    }
  }

  const sendAll = async () => {
    setBusy(true)
    setNotice(null)
    setConfirming(false)
    try {
      const json = await post({ message: preview })
      setJob(json?.data ?? null)
      setNotice({ kind: 'ok', text: `Gönderim başladı: ${json?.data?.total ?? '?'} kişi.` })
      setMessage('')
    } catch (e: any) {
      setNotice({ kind: 'err', text: String(e?.message ?? 'Gönderim başlatılamadı.') })
      void loadStatus()
    } finally {
      setBusy(false)
      void loadAudience()
    }
  }

  const disabled = !aud?.configured || busy || (job ? !job.finished : false)

  return (
    <div className="rounded-xl border border-gray-200 bg-white mt-4">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between gap-3">
        <div className="text-sm font-bold text-gray-900 flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-blue-600" /> Üyelere kampanya SMS'i
        </div>
        <button type="button" onClick={() => { void loadAudience(); void loadStatus() }} className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50">
          <RefreshCcw className="w-3.5 h-3.5" /> Yenile
        </button>
      </div>

      <div className="px-4 py-3 grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          {!aud ? (
            <div className="text-sm text-gray-500">Durum okunuyor…</div>
          ) : !aud.configured ? (
            <div className="rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800">
              SMS servisi kapalı. Sunucudaki <code>appsettings.Local.json</code> içine PostaGüvercini kullanıcı adı/şifresi girilince açılır.
            </div>
          ) : (
            <div className="text-xs text-gray-600 mb-2">
              Gidecek üye: <b className="text-gray-900">{aud.audience.toLocaleString('tr-TR')}</b>
              {aud.audience > aud.maxRecipients && <> (bir gönderimde en fazla {aud.maxRecipients})</>}
              {aud.credit !== null && <> · Kalan kredi: <b className="text-gray-900">{aud.credit.toLocaleString('tr-TR')}</b></>}
            </div>
          )}

          <textarea
            className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm min-h-[96px]"
            placeholder="Ornek: STILSOFT DEMO: Bu hafta tum klimalarda 5.000 TL indirim! Ucretsiz teslimat + montaj. example.com/firsatlar"
            value={message}
            maxLength={maxLen}
            onChange={(e) => setMessage(e.target.value)}
            disabled={disabled}
          />
          <div className="flex items-center justify-between text-[11px] text-gray-500 mt-1">
            <span>{preview.length}/{maxLen} karakter · {smsParts} SMS{smsParts > 1 ? ' (uzun metin her kişiye ' + smsParts + ' kredi yazar)' : ''}</span>
            {preview !== message.trim() && <span>Türkçe karakterler gönderimde sadeleşir (ç→c, ş→s …)</span>}
          </div>
          {preview && preview !== message.trim() && (
            <div className="mt-1 rounded-md bg-gray-50 border border-gray-200 px-3 py-2 text-xs text-gray-700 font-mono whitespace-pre-wrap">{preview}</div>
          )}

          {notice && (
            <div className={`mt-2 rounded-md px-3 py-2 text-sm ${notice.kind === 'ok' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>{notice.text}</div>
          )}

          <div className="mt-3 flex flex-wrap items-end gap-2">
            <label className="block">
              <span className="block text-[11px] font-semibold text-gray-600 mb-1">Deneme numarası</span>
              <input className="rounded-md border border-gray-200 px-3 py-2 text-sm w-44" placeholder="05xx xxx xx xx" value={testPhone} onChange={(e) => setTestPhone(e.target.value)} disabled={disabled} />
            </label>
            <button type="button" disabled={disabled || !preview || !testPhone.trim()} onClick={() => void sendTest()} className="rounded-md border border-gray-200 bg-white text-gray-800 text-xs font-bold px-4 py-2 disabled:opacity-50 hover:bg-gray-50">
              Deneme gönder
            </button>
            <div className="flex-1" />
            {!confirming ? (
              <button type="button" disabled={disabled || !preview || !aud || aud.audience === 0} onClick={() => setConfirming(true)} className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold px-4 py-2 disabled:opacity-50">
                <Send className="w-3.5 h-3.5" /> Üyelere gönder
              </button>
            ) : (
              <div className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2">
                <span className="text-xs text-red-800 font-semibold">
                  {Math.min(aud?.audience ?? 0, aud?.maxRecipients ?? 800).toLocaleString('tr-TR')} kişiye {smsParts > 1 ? `${smsParts}'er ` : ''}SMS gidecek. Emin misiniz?
                </span>
                <button type="button" disabled={busy} onClick={() => void sendAll()} className="rounded-md bg-red-600 hover:bg-red-700 text-white text-xs font-bold px-3 py-1.5 disabled:opacity-50">Evet, gönder</button>
                <button type="button" onClick={() => setConfirming(false)} className="rounded-md border border-gray-200 bg-white text-gray-700 text-xs font-semibold px-3 py-1.5">Vazgeç</button>
              </div>
            )}
          </div>
        </div>

        <div>
          {job && (
            <div className={`rounded-md border px-3 py-2 text-xs mb-3 ${job.finished ? 'border-emerald-200 bg-emerald-50' : 'border-blue-200 bg-blue-50'}`}>
              <div className="font-bold text-gray-900 mb-1">{job.finished ? 'Son gönderim bitti' : 'Gönderim sürüyor…'}</div>
              <div className="text-gray-700">{job.sent + job.failed}/{job.total} işlendi · {job.sent} gitti · {job.failed} gitmedi</div>
              {!job.finished && (
                <div className="mt-1.5 h-1.5 rounded-full bg-white overflow-hidden">
                  <div className="h-full bg-blue-500 transition-all" style={{ width: `${job.total ? Math.round(((job.sent + job.failed) / job.total) * 100) : 0}%` }} />
                </div>
              )}
              {job.error && <div className="text-red-700 mt-1">{job.error}</div>}
            </div>
          )}
          <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1">Son gönderimler</div>
          {recent.length === 0 ? (
            <div className="text-xs text-gray-500">Henüz gönderim yok.</div>
          ) : (
            <ul className="divide-y divide-gray-100 text-xs">
              {recent.map((r) => (
                <li key={r.id} className="py-1.5">
                  <div className="flex justify-between gap-2 text-gray-500">
                    <span>{fmt(r.sentAtUtc)}{r.sentBy ? ` · ${r.sentBy}` : ''}</span>
                    <span className="whitespace-nowrap">{r.succeeded}/{r.recipients}{r.finishedAtUtc ? '' : ' (yarım)'}</span>
                  </div>
                  <div className="text-gray-800 line-clamp-2">{r.message}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
