'use client'

import Link from 'next/link'
import { useState } from 'react'
import { safeReturnPath } from '@/lib/returnPath'
import { AccountExistsLinks } from './PhoneLogin'

type Mode = 'login' | 'register'

/**
 * Giriş ve üyelik formu.
 *
 * KOD YOK, ŞİFRE VAR (2026-10-05 kullanıcı isteği: "girişlerde kod zorunlu olmasın, direkt şifre
 * — telefon veya mail şifre kombinasyonları ile giriş yapılabilsin", "kod gönder kısmını kaldır,
 * direkt üye olabilelim"). SMS sağlayıcısı kod ulaştıramadığı için müşteri ne üye olabiliyor ne
 * girebiliyordu.
 *
 * - Giriş: tek kutu "Telefon veya e-posta" + şifre. Sunucu '@' içermeyeni telefon sayıyor.
 * - Üyelik: ad, telefon, şifre, adres; e-posta İSTEĞE BAĞLI.
 *
 * `returnTo` sunucudan geliyor ve orada zaten doğrulanmış; burada bir kez daha geçiriliyor
 * çünkü bu bileşen başka bir yerden doğrulanmamış değerle de çağrılabilir (bkz. lib/returnPath.ts).
 */
export default function AuthForm({
  mode,
  returnTo,
}: {
  mode: Mode
  returnTo?: string
}) {
  const [error, setError] = useState<string | null>(null)
  const [accountExists, setAccountExists] = useState(false)
  const [busy, setBusy] = useState(false)

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy) return

    setBusy(true)
    setError(null)

    const form = new FormData(event.currentTarget)
    const payload: Record<string, unknown> = Object.fromEntries(form.entries())

    try {
      const res = await fetch(`/api/auth/${mode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      const data = await res.json().catch(() => null)

      if (!res.ok) {
        setAccountExists(data?.accountExists === true)
        setError(data?.message ?? 'İşlem tamamlanamadı. Bilgileri kontrol edip tekrar deneyin.')
        return
      }

      window.location.href = safeReturnPath(returnTo)
    } catch {
      setError('Bağlantı kurulamadı. Lütfen tekrar deneyin.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="auth-form" onSubmit={onSubmit}>
      {mode === 'register' ? (
        <>
          <label>
            <span>Ad Soyad</span>
            <input name="fullName" required maxLength={150} autoComplete="name" placeholder="Adınız Soyadınız" />
          </label>
          <label>
            <span>Cep telefonu</span>
            <input
              name="phone"
              required
              maxLength={30}
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="0533 000 00 00"
            />
            <small>Girişte bu numarayı ve şifrenizi kullanacaksınız.</small>
          </label>
          <label>
            <span>E-posta (isteğe bağlı)</span>
            <input name="email" type="email" maxLength={200} autoComplete="email" placeholder="ornek@mail.com" />
          </label>
        </>
      ) : (
        <label>
          <span>Telefon veya e-posta</span>
          <input
            name="email"
            type="text"
            required
            maxLength={200}
            autoComplete="username"
            placeholder="0533 000 00 00 ya da ornek@mail.com"
          />
        </label>
      )}

      <label>
        <div className="auth-label-row">
          <span>Şifre</span>
          {mode === 'login' && (
            <Link href="/sifremi-unuttum" className="auth-forgot-link">
              Şifremi unuttum
            </Link>
          )}
        </div>
        <input
          name="password"
          type="password"
          required
          minLength={mode === 'register' ? 8 : undefined}
          autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
        />
        {mode === 'register' && <small>En az 8 karakter.</small>}
      </label>

      {mode === 'register' && (
        <>
          <div className="auth-row">
            <label>
              <span>Şehir (KKTC)</span>
              <select name="city" defaultValue="Lefkoşa" className="c-select">
                <option value="Lefkoşa">Lefkoşa</option>
                <option value="Girne">Girne</option>
                <option value="Gazimağusa">Gazimağusa</option>
                <option value="Güzelyurt">Güzelyurt</option>
                <option value="İskele">İskele</option>
                <option value="Lefke">Lefke</option>
              </select>
            </label>
            <label>
              <span>İlçe / Bölge</span>
              <input name="district" maxLength={100} placeholder="İsteğe bağlı" />
            </label>
          </div>
          <label>
            <span>Teslimat adresi</span>
            <textarea name="address" rows={3} maxLength={500} placeholder="Mahalle, sokak, bina, daire" />
          </label>
          <small className="auth-kktc-note">
            📍 Satış ve teslimat yalnızca Kuzey Kıbrıs Türk Cumhuriyeti (KKTC) içindir.
          </small>
        </>
      )}

      {error && (
        <div className="auth-error" role="alert">
          {error}
          {accountExists && <AccountExistsLinks />}
        </div>
      )}

      <button className="btn btn-dark auth-submit" type="submit" disabled={busy}>
        {busy ? 'Lütfen bekleyin…' : mode === 'register' ? 'Üye ol' : 'Giriş yap'}
      </button>
    </form>
  )
}
