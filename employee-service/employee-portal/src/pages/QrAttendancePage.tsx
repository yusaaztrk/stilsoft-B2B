import React, { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import Modal from '../components/Modal'
import { qrCheckIn, qrCheckOut } from '../api/qrAttendance'
import { getPosition } from '../utils/geo'

type Mode = 'checkin' | 'checkout'

function normalizeTenant(input: string) {
  return String(input ?? '').trim()
}

function parseTenantFromText(text: string): string {
  const t = String(text ?? '').trim()
  if (!t) return ''
  try {
    const u = new URL(t)
    const tenant = u.searchParams.get('tenant')
    return normalizeTenant(tenant ?? '')
  } catch {
    // allow raw tenant
    return normalizeTenant(t)
  }
}

export default function QrAttendancePage() {
  const [sp] = useSearchParams()
  const navigate = useNavigate()

  const mode = (String(sp.get('mode') ?? '').toLowerCase() === 'checkout' ? 'checkout' : 'checkin') as Mode
  const tenant = normalizeTenant(String(sp.get('tenant') ?? ''))

  const [tenantInput, setTenantInput] = useState('')

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [inlineError, setInlineError] = useState<string | null>(null)

  const [msgOpen, setMsgOpen] = useState(false)
  const [msgTitle, setMsgTitle] = useState('')
  const [msgText, setMsgText] = useState('')

  const effectiveTenant = useMemo(() => {
    const t = tenant || parseTenantFromText(tenantInput)
    return normalizeTenant(t)
  }, [tenant, tenantInput])

  const showMsg = (title: string, text: string) => {
    setMsgTitle(title)
    setMsgText(text)
    setMsgOpen(true)
  }

  /**
   * Konum zorunlu (2026-10-16): alınamazsa sebebi (izin kapalı / GPS kapalı / zaman aşımı)
   * personele söylenir ve istek gönderilmez. Eskiden 0,0 gönderiliyordu.
   */
  const getLocation = async (): Promise<{ latitude: number; longitude: number; accuracy: number }> => {
    const pos = await getPosition()
    if (!pos.ok) throw new Error(pos.message)
    return { latitude: pos.latitude, longitude: pos.longitude, accuracy: pos.accuracy }
  }

  const submit = async () => {
    try {
      if (!effectiveTenant) {
        setInlineError('Tenant bulunamadı. Lütfen tenant kodunu girin.')
        return
      }

      const u = username.trim()
      const p = password
      if (!u || !p) {
        setInlineError('Kullanıcı adı ve şifre zorunludur')
        return
      }

      setBusy(true)
      setInlineError(null)

      const loc = await getLocation()

      if (mode === 'checkin') {
        await qrCheckIn({ tenant: effectiveTenant, username: u, password: p, latitude: loc.latitude, longitude: loc.longitude, accuracy: loc.accuracy })
        showMsg('Başarılı', 'Giriş kaydedildi')
      } else {
        await qrCheckOut({ tenant: effectiveTenant, username: u, password: p, latitude: loc.latitude, longitude: loc.longitude, accuracy: loc.accuracy })
        showMsg('Başarılı', 'Çıkış kaydedildi')
      }

      setPassword('')
    } catch (e: any) {
      setInlineError(String(e?.message ?? 'İşlem başarısız'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center px-4 py-8">
      <Modal isOpen={msgOpen} onClose={() => setMsgOpen(false)} title={msgTitle || 'Bilgi'}>
        <div className="text-sm text-gray-700 whitespace-pre-line">{msgText}</div>
      </Modal>

      <div className="w-full max-w-3xl">
        <div className="rounded-3xl border border-white/10 bg-gradient-to-b from-white/10 to-white/5 shadow-2xl overflow-hidden">
          <div className="px-6 py-5 border-b border-white/10 flex items-center justify-between gap-4">
            <div>
              <div className="text-xl font-extrabold tracking-tight">QR ile {mode === 'checkin' ? 'Giriş' : 'Çıkış'}</div>
              <div className="mt-2 text-[11px] text-white/60">Tenant: {effectiveTenant || '-'}</div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="text-xs font-extrabold text-white/80">Tenant</div>
              <div className="mt-2 text-[11px] text-white/60">
                QR okutulduğunda bu sayfa otomatik açılır. Tenant parametresi yoksa buradan girebilirsiniz.
              </div>
              <input
                value={tenant || tenantInput}
                onChange={(e) => setTenantInput(String(e.target.value ?? ''))}
                disabled={Boolean(tenant)}
                className="mt-3 w-full h-10 rounded-xl border border-white/10 bg-white/5 px-3 text-xs text-white placeholder:text-white/30 disabled:opacity-60"
                placeholder="Tenant kodu"
              />
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="text-xs font-extrabold text-white/80">Giriş Bilgileri</div>

              <div className="rounded-2xl border border-white/10 bg-white/5 p-4 space-y-3">
                <div>
                  <div className="text-[11px] font-bold text-white/50">Kullanıcı Adı</div>
                  <input
                    value={username}
                    onChange={(e) => setUsername(String(e.target.value ?? ''))}
                    className="mt-1 h-10 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-sm font-bold text-white"
                    placeholder="username"
                    autoComplete="username"
                  />
                </div>

                <div>
                  <div className="text-[11px] font-bold text-white/50">Şifre</div>
                  <input
                    value={password}
                    onChange={(e) => setPassword(String(e.target.value ?? ''))}
                    type="password"
                    className="mt-1 h-10 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-sm font-bold text-white"
                    placeholder="••••••••"
                    autoComplete="current-password"
                  />
                </div>

                {inlineError ? <div className="text-[11px] text-rose-300">{inlineError}</div> : null}

                <button
                  type="button"
                  onClick={() => void submit()}
                  disabled={busy}
                  className={
                    'h-10 w-full rounded-xl text-white text-sm font-extrabold disabled:opacity-60 ' +
                    (mode === 'checkin' ? 'bg-emerald-600/90 hover:bg-emerald-600' : 'bg-indigo-600/90 hover:bg-indigo-600')
                  }
                >
                  {busy ? 'İşleniyor...' : (mode === 'checkin' ? 'Lokasyon ile Giriş Yap' : 'Lokasyon ile Çıkış Yap')}
                </button>

                <div className="text-[11px] text-white/50">
                  Not: Konum izni istenecektir.
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
