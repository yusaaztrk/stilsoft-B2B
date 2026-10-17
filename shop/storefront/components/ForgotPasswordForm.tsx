'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import PhoneVerification from './PhoneVerification'

type Channel = 'email' | 'sms'

/**
 * Şifremi Unuttum — iki yol.
 *
 * <b>E-posta:</b> bugüne kadarki davranış; 15 dakikalık tek kullanımlık bağlantı gönderilir.
 * <b>SMS:</b> 6 haneli kod gelir, doğrulanınca şifre belirleme adımına biletle geçilir.
 *
 * NEDEN SMS'TE LİNK DEĞİL KOD: operatörler SMS içindeki bağlantıları kırpıyor ve oltalama
 * filtreleri işaretliyor; ayrıca müşteri telefondaki linke basınca tarayıcı oturumu farklı
 * olabiliyor. Kod, kullanıcının zaten açık olan sekmesinde kalmasını sağlıyor.
 *
 * SMS seçeneği yalnızca sunucu "açık" derse görünüyor — kredentials girilmemişken kullanıcıya
 * hiç gelmeyecek bir yol sunmak, seçeneği hiç göstermemekten kötü.
 */
export default function ForgotPasswordForm({ smsEnabled }: { smsEnabled: boolean }) {
  const router = useRouter()
  const [channel, setChannel] = useState<Channel>('email')

  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (busy) return

    setBusy(true)
    setError(null)

    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      })

      const data = await res.json().catch(() => null)

      if (!res.ok) {
        setError(data?.message ?? 'İşlem sırasında bir hata oluştu.')
        return
      }

      setSuccess(true)
    } catch {
      setError('Sunucu ile bağlantı kurulamadı. Lütfen tekrar deneyin.')
    } finally {
      setBusy(false)
    }
  }

  if (success) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div className="auth-success">
          <strong>Şifre sıfırlama bağlantısı gönderildi.</strong>
          <p style={{ margin: '8px 0 0', fontSize: 13.5 }}>
            Eğer <strong>{email}</strong> adresi sistemimizde kayıtlı ise, şifre sıfırlama
            bağlantısını içeren bir e-posta gönderdik. Lütfen gelen kutunuzu ve spam klasörünüzü
            kontrol ediniz.
          </p>
        </div>
        <p className="auth-alt" style={{ marginTop: 8 }}>
          <Link href="/giris" className="btn btn-dark" style={{ display: 'block', textAlign: 'center', textDecoration: 'none' }}>
            Giriş Ekranına Dön
          </Link>
        </p>
      </div>
    )
  }

  return (
    <>
      {smsEnabled && (
        <div className="channel-tabs" role="tablist" aria-label="Sıfırlama yöntemi">
          <button
            type="button"
            role="tab"
            aria-selected={channel === 'email'}
            className={`channel-tab ${channel === 'email' ? 'active' : ''}`}
            onClick={() => { setChannel('email'); setError(null) }}
          >
            E-posta ile
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={channel === 'sms'}
            className={`channel-tab ${channel === 'sms' ? 'active' : ''}`}
            onClick={() => { setChannel('sms'); setError(null) }}
          >
            SMS ile
          </button>
        </div>
      )}

      {channel === 'sms' && smsEnabled ? (
        <div className="auth-form">
          <p className="auth-lede" style={{ marginTop: 0 }}>
            Hesabınıza kayıtlı cep telefonu numaranızı girin; doğrulama kodu gönderelim.
          </p>

          <PhoneVerification
            purpose="reset"
            name="resetPhone"
            label="Cep Telefonu"
            onVerified={(ticket) => {
              // Bilet adres çubuğuna yazılıyor: şifre belirleme ekranı ayrı bir sayfa ve
              // e-posta yolundaki `?token=` ile aynı deseni izliyor. Bilet tek kullanımlık,
              // 15 dakikalık ve yalnız şifre sıfırlama amacı için geçerli.
              router.push(`/sifre-sifirla?ticket=${encodeURIComponent(ticket)}`)
            }}
          />

          <p className="auth-alt">
            Şifrenizi hatırladınız mı? <Link href="/giris">Giriş yapın</Link>
          </p>
        </div>
      ) : (
        <form className="auth-form" onSubmit={onSubmit}>
          <label>
            <span>E-posta Adresi</span>
            <input
              type="email"
              required
              autoComplete="email"
              placeholder="ornek@alanadi.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>

          {error && <div className="auth-error">{error}</div>}

          <button className="btn btn-dark" type="submit" disabled={busy}>
            {busy ? 'Gönderiliyor…' : 'Sıfırlama Bağlantısı Gönder'}
          </button>

          <p className="auth-alt">
            Şifrenizi hatırladınız mı? <Link href="/giris">Giriş yapın</Link>
          </p>
        </form>
      )}
    </>
  )
}
