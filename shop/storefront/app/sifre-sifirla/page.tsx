'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Suspense, useState } from 'react'

function ResetPasswordContent() {
  const searchParams = useSearchParams()

  /*
    İKİ GİRİŞ YOLU:
      ?token=…   e-postayla gönderilen bağlantı (bugüne kadarki yol)
      ?ticket=…  SMS kodu doğrulandığında `sifremi-unuttum`un verdiği bilet

    Sunucu ikisinden yalnız BİRİNİ kabul ediyor; ikisi birden gönderilirse isteği reddediyor.
    Bu yüzden burada da tek bir alan seçiliyor, ikisi birden yollanmıyor.
  */
  const token = searchParams.get('token')
  const ticket = searchParams.get('ticket')
  const viaSms = !token && !!ticket

  const [password, setPassword] = useState('')
  const [passwordRepeat, setPasswordRepeat] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  if (!token && !ticket) {
    return (
      <div className="auth-card">
        <h1>Geçersiz Bağlantı</h1>
        <p className="auth-lede">Şifre sıfırlama bağlantısı eksik veya geçersiz görünüyor.</p>
        <div className="auth-error">
          Lütfen e-postanızdaki bağlantıyı eksiksiz tıkladığınızdan emin olun veya yeni bir sıfırlama talebinde bulunun.
        </div>
        <p className="auth-alt" style={{ marginTop: 20 }}>
          <Link href="/sifremi-unuttum" className="btn btn-dark" style={{ display: 'block', textAlign: 'center', textDecoration: 'none' }}>
            Yeni Sıfırlama Bağlantısı İste
          </Link>
        </p>
      </div>
    )
  }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (busy) return

    if (password.length < 8) {
      setError('Şifreniz en az 8 karakter uzunluğunda olmalıdır.')
      return
    }

    if (password !== passwordRepeat) {
      setError('Girdiğiniz şifreler birbiriyle eşleşmiyor.')
      return
    }

    setBusy(true)
    setError(null)

    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          viaSms
            ? { ticket: ticket!.trim(), newPassword: password }
            : { token: token!.trim(), newPassword: password },
        ),
      })

      const data = await res.json().catch(() => null)

      if (!res.ok) {
        setError(
          data?.message ??
            (viaSms
              ? 'Şifre sıfırlanamadı. Doğrulamanın süresi dolmuş olabilir, yeni kod isteyin.'
              : 'Şifre sıfırlanamadı. Bağlantının süresi dolmuş olabilir.'),
        )
        return
      }

      setSuccess(true)
    } catch {
      setError('Sunucu ile bağlantı kurulamadı. Lütfen tekrar deneyin.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-card">
      <h1>Yeni Şifre Belirleyin</h1>
      <p className="auth-lede">Hesabınız için yeni bir şifre giriniz.</p>

      {success ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div className="auth-success">
            <strong>Şifreniz başarıyla güncellendi!</strong>
            <p style={{ margin: '8px 0 0', fontSize: 13.5 }}>
              Artık yeni şifrenizle hesabınıza güvenle giriş yapabilirsiniz.
            </p>
          </div>
          <p className="auth-alt" style={{ marginTop: 8 }}>
            <Link href="/giris" className="btn btn-dark" style={{ display: 'block', textAlign: 'center', textDecoration: 'none' }}>
              Giriş Yap
            </Link>
          </p>
        </div>
      ) : (
        <form className="auth-form" onSubmit={onSubmit}>
          <label>
            <span>Yeni Şifre</span>
            <input
              type="password"
              required
              minLength={8}
              maxLength={128}
              autoComplete="new-password"
              placeholder="En az 8 karakter"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <small>En az 8 karakter olmalıdır.</small>
          </label>

          <label>
            <span>Yeni Şifre (Tekrar)</span>
            <input
              type="password"
              required
              minLength={8}
              maxLength={128}
              autoComplete="new-password"
              placeholder="Şifrenizi tekrar girin"
              value={passwordRepeat}
              onChange={(e) => setPasswordRepeat(e.target.value)}
            />
          </label>

          {error && <div className="auth-error">{error}</div>}

          <button className="btn btn-dark" type="submit" disabled={busy}>
            {busy ? 'Güncelleniyor…' : 'Şifreyi Güncelle'}
          </button>

          <p className="auth-alt">
            <Link href="/giris">Giriş ekranına dön</Link>
          </p>
        </form>
      )}
    </div>
  )
}

export default function ResetPasswordPage() {
  return (
    <div className="wrap">
      <div className="auth-page">
        <Suspense fallback={<div className="auth-card"><h1>Yükleniyor…</h1></div>}>
          <ResetPasswordContent />
        </Suspense>
      </div>
    </div>
  )
}
