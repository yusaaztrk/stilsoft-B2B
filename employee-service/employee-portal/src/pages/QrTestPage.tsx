import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Modal from '../components/Modal'
import Layout from '../components/Layout'
import { API_BASE_URL } from '../config/api'
import QRCode from 'qrcode'

type DailyQr = {
  date: string
  path: string
}

type QrKind = 'checkin' | 'checkout'

type QrCardProps = {
  kind: QrKind
  title: string
  description: string
  qrDataUrl: string
  url: string
  disabled: boolean
  onCopy: () => void
  onPrint: () => void
  onOpenFull: () => void
}

function escapeHtml(value: string) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function QrCard({ kind, title, description, qrDataUrl, url, disabled, onCopy, onPrint, onOpenFull }: QrCardProps) {
  const isCheckIn = kind === 'checkin'
  return (
    <div className="card card-hover overflow-hidden">
      <div className={(isCheckIn ? 'bg-gradient-to-r from-emerald-700 via-emerald-800 to-slate-900' : 'bg-gradient-to-r from-blue-700 via-blue-900 to-slate-950') + ' px-6 py-5 text-white'}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-lg font-black tracking-tight">{title}</div>
            <div className="text-xs text-white/80 mt-0.5">{description}</div>
          </div>
          <div className="rounded-xl bg-white/15 border border-white/20 px-3 py-1 text-[11px] font-extrabold shadow-sm">
            Günlük QR
          </div>
        </div>
      </div>

      <div className="p-6">
        <div className="relative mx-auto w-full max-w-[340px] rounded-2xl border border-slate-200/80 bg-slate-50 p-4">
          <button
            type="button"
            onClick={onOpenFull}
            disabled={disabled}
            className="absolute right-3 top-3 h-8 w-8 rounded-xl bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 shadow-sm flex items-center justify-center disabled:opacity-50 transition"
            title="QR büyüt"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M15 3h6v6" /><path d="M9 21H3v-6" /><path d="M21 3l-7 7" /><path d="M3 21l7-7" /></svg>
          </button>
          <div className="flex items-center justify-center min-h-[300px]">
            {qrDataUrl ? <img src={qrDataUrl} alt={title} className="w-[290px] h-[290px] object-contain" /> : <div className="text-xs text-slate-400 font-semibold">QR oluşturuluyor...</div>}
          </div>
        </div>

        <div className="mt-5">
          <div className="text-[11px] font-bold text-slate-500 mb-1.5">Erişim Bağlantısı</div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-[11px] font-medium text-slate-700 break-all min-h-[42px] select-all">
            {url || '—'}
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={onCopy}
            disabled={disabled}
            className="btn-secondary w-full"
          >
            Bağlantıyı Kopyala
          </button>
          <button
            type="button"
            onClick={onPrint}
            disabled={disabled}
            className={(isCheckIn ? 'btn-success' : 'btn-navy') + ' w-full disabled:opacity-50'}
          >
            QR Yazdır
          </button>
        </div>
      </div>
    </div>
  )
}


export default function QrTestPage() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<DailyQr | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [qrDataUrlIn, setQrDataUrlIn] = useState<string>('')
  const [qrDataUrlOut, setQrDataUrlOut] = useState<string>('')
  const [msgOpen, setMsgOpen] = useState(false)
  const [msgTitle, setMsgTitle] = useState('')
  const [msgText, setMsgText] = useState('')

  const showMsg = (title: string, text: string) => {
    setMsgTitle(title)
    setMsgText(text)
    setMsgOpen(true)
  }

  const dailyDate = useMemo(() => {
    if (data?.date) return data.date
    return new Date().toISOString().slice(0, 10)
  }, [data])

  const fullUrlBase = useMemo(() => {
    if (!data?.path) return ''
    const base = window.location.origin.replace(/\/+$/, '')
    return `${base}${data.path}`
  }, [data])

  const fullUrlCheckIn = useMemo(() => {
    if (!fullUrlBase) return ''
    const sep = fullUrlBase.includes('?') ? '&' : '?'
    return `${fullUrlBase}${sep}mode=checkin&d=${encodeURIComponent(dailyDate)}`
  }, [fullUrlBase, dailyDate])

  const fullUrlCheckOut = useMemo(() => {
    if (!fullUrlBase) return ''
    const sep = fullUrlBase.includes('?') ? '&' : '?'
    return `${fullUrlBase}${sep}mode=checkout&d=${encodeURIComponent(dailyDate)}`
  }, [fullUrlBase, dailyDate])

  const generateQr = async (url: string) => {
    if (!url) return ''
    return await QRCode.toDataURL(url, {
      margin: 1,
      width: 360,
      errorCorrectionLevel: 'M'
    })
  }

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const url = await generateQr(fullUrlCheckIn)
        if (alive) setQrDataUrlIn(url)
      } catch {
        if (alive) setQrDataUrlIn('')
      }
    })()
    return () => {
      alive = false
    }
  }, [fullUrlCheckIn])

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const url = await generateQr(fullUrlCheckOut)
        if (alive) setQrDataUrlOut(url)
      } catch {
        if (alive) setQrDataUrlOut('')
      }
    })()
    return () => {
      alive = false
    }
  }, [fullUrlCheckOut])

  const load = async () => {
    try {
      setLoading(true)
      setError(null)

      const token = localStorage.getItem('accessToken')
      const tenantCode = String(localStorage.getItem('tenantCode') ?? '').trim()

      const res = await fetch(`${API_BASE_URL}/api/qr/daily`, {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(tenantCode ? { 'X-Tenant-Code': tenantCode } : {})
        }
      })

      if (!res.ok) {
        const t = await res.text().catch(() => '')
        throw new Error(t || `QR alınamadı (${res.status})`)
      }

      const json = await res.json().catch(() => null)
      const d = json?.data
      setData({ date: String(d?.date ?? new Date().toISOString().slice(0, 10)), path: String(d?.path ?? '') })
    } catch (e: any) {
      setData(null)
      setError(String(e?.message ?? 'Bir hata oluştu'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const copyLink = async (url: string) => {
    try {
      if (!url) return
      await navigator.clipboard.writeText(url)
      showMsg('Kopyalandı', url)
    } catch {
      showMsg('Bilgi', url)
    }
  }

  const openQrPage = (title: string, qrDataUrl: string, url: string, autoPrint = false) => {
    if (!qrDataUrl || !url) return
    const w = window.open('', '_blank')
    if (!w) {
      showMsg('Bilgi', 'Tarayıcı yeni pencereyi engelledi. Lütfen açılır pencere izni verin.')
      return
    }
    w.document.write(`<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    *{box-sizing:border-box}
    body{margin:0;min-height:100vh;font-family:Arial,sans-serif;background:#f8fafc;color:#0f172a;display:flex;align-items:center;justify-content:center;padding:32px}
    .card{width:min(720px,100%);background:white;border:1px solid #e2e8f0;border-radius:28px;box-shadow:0 20px 60px rgba(15,23,42,.12);padding:32px;text-align:center}
    h1{margin:0 0 6px;font-size:28px}
    .date{font-size:13px;color:#64748b;font-weight:700;margin-bottom:24px}
    img{width:min(520px,90vw);height:min(520px,90vw);object-fit:contain}
    .url{margin-top:22px;padding:14px;border-radius:16px;background:#f1f5f9;color:#334155;font-size:12px;word-break:break-all;text-align:left}
    .actions{margin-top:22px;display:flex;gap:10px;justify-content:center}
    button{height:40px;border:0;border-radius:12px;padding:0 18px;font-weight:800;cursor:pointer}
    .print{background:#059669;color:white}
    .close{background:#e2e8f0;color:#334155}
    @media print{body{background:white;padding:0}.card{border:0;box-shadow:none}.actions{display:none}.url{font-size:10px}}
  </style>
</head>
<body>
  <div class="card">
    <h1>${escapeHtml(title)}</h1>
    <div class="date">Tarih: ${escapeHtml(dailyDate)}</div>
    <img src="${qrDataUrl}" alt="${escapeHtml(title)}" />
    <div class="url">${escapeHtml(url)}</div>
    <div class="actions">
      <button class="print" onclick="window.print()">Yazdır</button>
      <button class="close" onclick="window.close()">Kapat</button>
    </div>
  </div>
  ${autoPrint ? '<script>window.addEventListener("load",()=>setTimeout(()=>window.print(),250))</script>' : ''}
</body>
</html>`)
    w.document.close()
  }

  const qrDisabledIn = !fullUrlCheckIn || !qrDataUrlIn
  const qrDisabledOut = !fullUrlCheckOut || !qrDataUrlOut

  return (
    <Layout>
      <Modal isOpen={msgOpen} onClose={() => setMsgOpen(false)} title={msgTitle || 'Bilgi'}>
        <div className="text-sm text-gray-700 whitespace-pre-line break-all">{msgText}</div>
      </Modal>

      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="text-2xl font-black text-slate-900 tracking-tight">Günlük QR Kodları</div>
            <div className="text-xs text-slate-500 mt-1">
              Her gün farklı QR üretilir. Tarih: <span className="font-bold text-slate-700">{dailyDate || '—'}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => navigate('/employees')}
              className="h-10 px-4 rounded-xl text-xs font-extrabold bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 shadow-sm transition"
            >
              Geri
            </button>
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className="h-10 px-4 rounded-xl text-xs font-extrabold bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition disabled:opacity-60"
            >
              {loading ? 'Yükleniyor...' : 'Yenile'}
            </button>
          </div>
        </div>

        {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-bold text-rose-700">{error}</div> : null}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <QrCard
            kind="checkin"
            title="QR ile Giriş"
            description="Çalışan giriş işlemi için okutulur."
            qrDataUrl={qrDataUrlIn}
            url={fullUrlCheckIn}
            disabled={qrDisabledIn}
            onCopy={() => void copyLink(fullUrlCheckIn)}
            onPrint={() => openQrPage('QR ile Giriş', qrDataUrlIn, fullUrlCheckIn, true)}
            onOpenFull={() => openQrPage('QR ile Giriş', qrDataUrlIn, fullUrlCheckIn)}
          />

          <QrCard
            kind="checkout"
            title="QR ile Çıkış"
            description="Çalışan çıkış işlemi için okutulur."
            qrDataUrl={qrDataUrlOut}
            url={fullUrlCheckOut}
            disabled={qrDisabledOut}
            onCopy={() => void copyLink(fullUrlCheckOut)}
            onPrint={() => openQrPage('QR ile Çıkış', qrDataUrlOut, fullUrlCheckOut, true)}
            onOpenFull={() => openQrPage('QR ile Çıkış', qrDataUrlOut, fullUrlCheckOut)}
          />
        </div>
      </div>
    </Layout>
  )
}
