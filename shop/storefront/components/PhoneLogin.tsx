'use client'

import Link from 'next/link'
import { useState } from 'react'
import PhoneVerification from './PhoneVerification'
import { safeReturnPath } from '@/lib/returnPath'

/*
  ŞİFRESİZ TELEFON GİRİŞİ (2026-09-20).

  Kıbrıs'taki müşteri e-posta ve şifre hatırlamıyor; giriş duvarı satışı kesiyordu. Akış:
  telefon → SMS kodu → içeride. Numara kayıtlı değilse yalnız AD sorulur (ödeme adımında
  açılıyorsa adres de), üyelik o anda arkada açılır; e-posta ve şifre yok.

  Aynı bileşen üç yerde: /giris, /uye-ol ve /odeme (girişsiz müşteri ödemeye geldiğinde).
  `askAddress` ödemede açık: adres siparişte zaten gerekiyor, iki kez sormayalım.
*/
export default function PhoneLogin({
  returnTo = '/',
  askAddress = false,
  title,
  onDone,
  initialPhone,
}: {
  returnTo?: string
  askAddress?: boolean
  title?: string
  /** Verilirse yönlendirme yerine çağrılır (ödeme sayfası yerinde yenilemek için). */
  onDone?: () => void
  /** Numara başka bir formda zaten yazıldıysa (üyesiz sipariş → kayıtlı numara) tekrar sorulmasın. */
  initialPhone?: string
}) {
  const [ticket, setTicket] = useState<string | null>(null)
  const [phone, setPhone] = useState('')
  const [needsProfile, setNeedsProfile] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Numara zaten bir hesaba kayıtlı (sunucu 409): giriş / şifre sıfırlama yolu gösterilir.
  const [accountExists, setAccountExists] = useState(false)

  const finish = () => {
    if (onDone) onDone()
    else window.location.href = safeReturnPath(returnTo)
  }

  const submit = async (profile?: { fullName: string; city?: string; district?: string; address?: string }) => {
    if (!ticket) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/auth/phone-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, ticket, ...(profile ?? {}) }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        if (data?.phoneVerificationRequired) {
          setTicket(null)
          setNeedsProfile(false)
        }
        setAccountExists(data?.accountExists === true)
        setError(data?.message ?? 'Giriş yapılamadı.')
        return
      }
      if (data?.needsProfile) {
        setNeedsProfile(true)
        return
      }
      finish()
    } catch {
      setError('Bağlantı kurulamadı. Lütfen tekrar deneyin.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-form phone-login">
      {title && <h2 className="phone-login-title">{title}</h2>}

      {!needsProfile && (
        <>
          <PhoneVerification
            purpose="login"
            name="phone"
            initialPhone={initialPhone}
            internationalSlot={
              <>
                <p>
                  <strong>Yurt dışı numarası.</strong> Bu numaraya SMS gönderemiyoruz; siparişinize e-posta ile
                  devam edebilirsiniz.
                </p>
                <p lang="en">
                  <strong>International number.</strong> We can&apos;t send SMS to this number — please continue
                  with your e-mail.
                </p>
                <div className="pv-intl-actions">
                  <a className="btn btn-dark" href={`/uye-ol?yontem=eposta&donus=${encodeURIComponent(safeReturnPath(returnTo))}`}>
                    E-posta ile devam et · Continue with e-mail
                  </a>
                  <a href={`/giris?yontem=eposta&donus=${encodeURIComponent(safeReturnPath(returnTo))}`}>
                    Hesabım var · I have an account
                  </a>
                </div>
              </>
            }
            onVerified={(t, p) => {
              setTicket(t)
              setPhone(p)
              setError(null)
              // Kod doğrulandı: kayıtlıysa bu çağrı direkt oturum açar, değilse ad ister.
              void (async () => {
                setBusy(true)
                try {
                  const res = await fetch('/api/auth/phone-login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ phone: p, ticket: t }),
                  })
                  const data = await res.json().catch(() => null)
                  if (!res.ok) {
                    setAccountExists(data?.accountExists === true)
                    setError(data?.message ?? 'Giriş yapılamadı.')
                    if (data?.phoneVerificationRequired) setTicket(null)
                    return
                  }
                  if (data?.needsProfile) {
                    setNeedsProfile(true)
                    return
                  }
                  finish()
                } catch {
                  setError('Bağlantı kurulamadı. Lütfen tekrar deneyin.')
                } finally {
                  setBusy(false)
                }
              })()
            }}
            onReset={() => {
              setTicket(null)
              setNeedsProfile(false)
            }}
          />
          {busy && <small className="auth-hint">Giriş yapılıyor…</small>}
        </>
      )}

      {needsProfile && (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            const fd = new FormData(e.currentTarget)
            const fullName = String(fd.get('fullName') ?? '').trim()
            if (fullName.length < 3) {
              setError('Lütfen adınızı ve soyadınızı yazın.')
              return
            }
            void submit({
              fullName,
              city: askAddress ? String(fd.get('city') ?? '') : undefined,
              district: askAddress ? String(fd.get('district') ?? '') : undefined,
              address: askAddress ? String(fd.get('address') ?? '') : undefined,
            })
          }}
        >
          <p className="auth-lede">
            <strong>{phone}</strong> numarası doğrulandı. Sizi tanıyalım, hepsi bu kadar.
          </p>
          <label>
            <span>Ad Soyad</span>
            <input name="fullName" required maxLength={150} autoComplete="name" autoFocus />
          </label>
          {askAddress && (
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
                  <input name="district" maxLength={100} placeholder="İsteğe bağlı — örn: Dereboyu, Alsancak" />
                </label>
              </div>
              <label>
                <span>Teslimat Adresi</span>
                <textarea name="address" required rows={3} maxLength={500} placeholder="Açık adresiniz" />
              </label>
            </>
          )}
          {error && <div className="auth-error">{error}{accountExists && <AccountExistsLinks />}</div>}
          <button className="btn btn-dark" type="submit" disabled={busy}>
            {busy ? 'Lütfen bekleyin…' : 'Devam et'}
          </button>
        </form>
      )}

      {!needsProfile && error && <div className="auth-error">{error}{accountExists && <AccountExistsLinks />}</div>}
    </div>
  )
}

/** "Kayıtlı numaranız var": giriş ve şifre oluşturma bağlantıları (hata kutusunun altında). */
export function AccountExistsLinks() {
  return (
    <div className="auth-error-links">
      <Link href="/giris">Giriş yap</Link>
      <span aria-hidden="true">·</span>
      <Link href="/sifremi-unuttum">Şifre oluştur / sıfırla</Link>
    </div>
  )
}
