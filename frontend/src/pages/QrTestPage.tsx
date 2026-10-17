import React, { useEffect, useMemo, useState } from 'react'
import Modal from '../components/Modal'
import { API_BASE_URL } from '../config/api'
import QRCode from 'qrcode'

type DailyQr = {
  date: string
  path: string
}

export default function QrTestPage() {
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<DailyQr | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [qrDataUrl, setQrDataUrl] = useState<string>('')

  const [baseOrigin, setBaseOrigin] = useState(() => {
    try {
      const saved = String(localStorage.getItem('qrBaseOrigin') ?? '').trim()
      if (saved) return saved
    } catch {
      // ignore
    }
    return window.location.origin
  })

  const [apiBase, setApiBase] = useState(() => {
    try {
      const saved = String(localStorage.getItem('qrApiBase') ?? '').trim()
      if (saved) return saved
    } catch {
      // ignore
    }
    return API_BASE_URL
  })

  const [msgOpen, setMsgOpen] = useState(false)
  const [msgTitle, setMsgTitle] = useState('')
  const [msgText, setMsgText] = useState('')

  const showMsg = (title: string, text: string) => {
    setMsgTitle(title)
    setMsgText(text)
    setMsgOpen(true)
  }

  const fullUrl = useMemo(() => {
    if (!data?.path) return ''
    const base = String(baseOrigin ?? '').trim().replace(/\/+$/, '')
    if (!base) return `${window.location.origin}${data.path}`
    const raw = `${base}${data.path}`

    const api = String(apiBase ?? '').trim().replace(/\/+$/, '')
    if (!api) return raw
    return raw.includes('?')
      ? `${raw}&apiBase=${encodeURIComponent(api)}`
      : `${raw}?apiBase=${encodeURIComponent(api)}`
  }, [apiBase, baseOrigin, data])

  useEffect(() => {
    try {
      const v = String(baseOrigin ?? '').trim()
      localStorage.setItem('qrBaseOrigin', v)
    } catch {
      // ignore
    }
  }, [baseOrigin])

  useEffect(() => {
    try {
      const v = String(apiBase ?? '').trim()
      localStorage.setItem('qrApiBase', v)
    } catch {
      // ignore
    }
  }, [apiBase])

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        if (!fullUrl) {
          if (alive) setQrDataUrl('')
          return
        }
        const url = await QRCode.toDataURL(fullUrl, {
          margin: 1,
          width: 320,
          errorCorrectionLevel: 'M'
        })
        if (alive) setQrDataUrl(url)
      } catch {
        if (alive) setQrDataUrl('')
      }
    })()
    return () => {
      alive = false
    }
  }, [fullUrl])

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
      setData({ date: String(d?.date ?? ''), path: String(d?.path ?? '') })
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

  const copy = async () => {
    try {
      if (!fullUrl) return
      await navigator.clipboard.writeText(fullUrl)
      showMsg('Kopyalandı', fullUrl)
    } catch {
      showMsg('Bilgi', fullUrl)
    }
  }

  return (
    <div className="p-4">
      <Modal isOpen={msgOpen} onClose={() => setMsgOpen(false)} title={msgTitle || 'Bilgi'}>
        <div className="text-sm text-gray-700 whitespace-pre-line">{msgText}</div>
      </Modal>

      <div className="flex items-center justify-between">
        <div>
          <div className="text-xl font-bold text-gray-900">QR Test</div>
          <div className="text-xs text-gray-500 mt-0.5">Günlük QR linkini gösterir.</div>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="h-[34px] px-4 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition disabled:opacity-60"
        >
          {loading ? 'Yükleniyor...' : 'Yenile'}
        </button>
      </div>

      {error ? <div className="mt-3 text-xs font-semibold text-rose-600">{error}</div> : null}

      <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="border border-gray-200 rounded-xl bg-white p-4">
          <div className="text-xs font-semibold text-gray-600">Tarih</div>
          <div className="mt-1 text-sm font-bold text-gray-900">{data?.date || '—'}</div>

          <div className="mt-3 text-xs font-semibold text-gray-600">QR Base URL (Mobil)</div>
          <input
            value={baseOrigin}
            onChange={(e) => setBaseOrigin(String(e.target.value ?? ''))}
            className="mt-1 w-full h-[34px] px-3 text-xs border border-gray-200 rounded-lg bg-white focus:ring-2 focus:ring-emerald-200 focus:border-emerald-300 transition"
            placeholder="http://172.20.10.4:5173"
          />

          <div className="mt-3 text-xs font-semibold text-gray-600">API Base URL (Backend)</div>
          <input
            value={apiBase}
            onChange={(e) => setApiBase(String(e.target.value ?? ''))}
            className="mt-1 w-full h-[34px] px-3 text-xs border border-gray-200 rounded-lg bg-white focus:ring-2 focus:ring-emerald-200 focus:border-emerald-300 transition"
            placeholder="https://xxxx.trycloudflare.com"
          />

          <div className="mt-3 text-xs font-semibold text-gray-600">Link</div>
          <div className="mt-1 text-xs text-gray-700 break-all">{fullUrl || '—'}</div>

          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={() => void copy()}
              disabled={!fullUrl}
              className="h-[30px] px-3 rounded text-[11px] font-semibold border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 disabled:opacity-60"
            >
              Kopyala
            </button>
            <a
              href={fullUrl || '#'}
              onClick={(e) => {
                if (!fullUrl) e.preventDefault()
              }}
              className={`h-[30px] px-3 rounded text-[11px] font-semibold inline-flex items-center border ${fullUrl ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100' : 'border-gray-200 bg-gray-50 text-gray-400'}`}
            >
              Aç
            </a>
          </div>
        </div>

        <div className="border border-gray-200 rounded-xl bg-white p-4">
          <div className="text-xs font-semibold text-gray-600">QR Görsel</div>
          {!fullUrl ? (
            <div className="mt-2 text-xs text-gray-500">Link yok</div>
          ) : !qrDataUrl ? (
            <div className="mt-2 text-xs text-gray-500">QR üretiliyor...</div>
          ) : (
            <div className="mt-3 flex items-center justify-center">
              <img src={qrDataUrl} alt="QR" className="w-[260px] h-[260px]" />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
