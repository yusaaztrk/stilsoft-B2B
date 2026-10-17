import React, { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import Modal from '../components/Modal'
import FormInput from '../components/forms/FormInput'
import { API_BASE_URL } from '../config/api'

export default function QrCheckInPage() {
  const [sp] = useSearchParams()
  const tenant = String(sp.get('tenant') ?? '').trim()

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')

  const [busy, setBusy] = useState(false)
  const [msgOpen, setMsgOpen] = useState(false)
  const [msgTitle, setMsgTitle] = useState('')
  const [msgText, setMsgText] = useState('')

  const canSend = useMemo(() => {
    return Boolean(tenant && username.trim() && password.trim())
  }, [tenant, username, password])

  const showMsg = (title: string, text: string) => {
    setMsgTitle(title)
    setMsgText(text)
    setMsgOpen(true)
  }

  const requestLocation = async (): Promise<{ latitude: number; longitude: number }> => {
    return await new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('Konum desteği bulunamadı'))
        return
      }

      navigator.geolocation.getCurrentPosition(
        (pos) => {
          resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude })
        },
        (err) => {
          reject(new Error(err?.message || 'Konum alınamadı'))
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
      )
    })
  }

  const submit = async () => {
    try {
      if (!canSend) {
        showMsg('Uyarı', 'Tenant, kullanıcı adı ve şifre zorunludur')
        return
      }

      setBusy(true)

      const loc = await requestLocation()

      const res = await fetch(`${API_BASE_URL}/api/qr/check-in`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Tenant-Code': tenant
        },
        body: JSON.stringify({
          username: username.trim(),
          password: password.trim(),
          latitude: Number(loc.latitude),
          longitude: Number(loc.longitude)
        })
      })

      if (!res.ok) {
        const t = await res.text().catch(() => '')
        showMsg('Hata', t || `İşlem başarısız (${res.status})`)
        return
      }

      const json = await res.json().catch(() => null)
      const name = String(json?.data?.employeeName ?? '').trim()
      const time = String(json?.data?.checkInTime ?? '').trim()
      showMsg('Başarılı', `${name || 'Çalışan'} giriş kaydı oluşturuldu${time ? `\n${time}` : ''}`)
    } catch (e: any) {
      showMsg('Hata', String(e?.message ?? 'Bir hata oluştu'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <Modal isOpen={msgOpen} onClose={() => setMsgOpen(false)} title={msgTitle || 'Bilgi'}>
        <div className="text-sm text-gray-700 whitespace-pre-line">{msgText}</div>
      </Modal>

      <div className="w-full max-w-md bg-white rounded-xl shadow-sm border border-gray-200 p-5">
        <div className="text-lg font-bold text-gray-900">QR Giriş / Çıkış</div>
        <div className="mt-1 text-xs text-gray-500">Tenant: {tenant || '—'}</div>

        {!tenant ? (
          <div className="mt-4 text-xs font-semibold text-rose-600">Link hatalı: tenant bulunamadı.</div>
        ) : null}

        <div className="mt-4 space-y-3">
          <FormInput label="Kullanıcı Adı" value={username} onChange={(e) => setUsername(String(e.target.value ?? ''))} placeholder="username" />
          <FormInput label="Şifre" value={password} onChange={(e) => setPassword(String(e.target.value ?? ''))} placeholder="password" />

          <button
            type="button"
            disabled={busy || !canSend}
            onClick={() => void submit()}
            className="w-full h-[38px] rounded-lg text-sm font-semibold bg-emerald-600 hover:bg-emerald-700 text-white transition disabled:opacity-60"
          >
            {busy ? 'Gönderiliyor...' : 'Konum ile Giriş Yap'}
          </button>

          {tenant && (
            <a
              href={`/face-checkin?tenant=${encodeURIComponent(tenant)}`}
              className="w-full h-[38px] rounded-lg text-sm font-semibold bg-blue-600 hover:bg-blue-700 text-white transition flex items-center justify-center gap-2"
            >
              📷 Yüz ile Giriş Yap
            </a>
          )}

          <div className="text-[11px] text-gray-500">
            Not: Konum izni vermeniz gerekir.
          </div>
        </div>
      </div>
    </div>
  )
}
