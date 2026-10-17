'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { looksInternational } from '@/lib/phone'

type Purpose = 'register' | 'reset' | 'login'

/**
 * Telefon doğrulama adımı — SMS kodu gönder, gir, doğrula.
 *
 * TEK BİLEŞEN İKİ YERDE: üye kaydı ve şifre sıfırlama aynı akışı kullanıyor (kod → doğrula →
 * bilet). İki kopya yazılsaydı geri sayım, hata metinleri ve kilitleme davranışı zamanla
 * ayrışırdı; sunucu tarafı da zaten tek mekanizma.
 *
 * DOĞRULANDIKTAN SONRA NUMARA KİLİTLENİR: bilet yalnız doğrulanan numara için geçerli ve
 * sunucu kayıt sırasında ikisini karşılaştırıyor. Alan açık bırakılsaydı kullanıcı numarayı
 * değiştirip "doğrulandı" rozetiyle formu gönderir, sunucudan anlamsız bir hata alırdı.
 */
export default function PhoneVerification({
  purpose,
  name = 'phone',
  label = 'Telefon',
  initialPhone = '',
  onVerified,
  onReset,
  onPhoneChange,
  internationalSlot,
}: {
  purpose: Purpose
  /** Form alanının adı — kayıt formunda `phone` olarak gönderiliyor. */
  name?: string
  label?: string
  initialPhone?: string
  /** Doğrulama başarılı olduğunda bileti ve numarayı verir. */
  onVerified: (ticket: string, phone: string) => void
  /** Kullanıcı numarayı değiştirmek için kilidi açtığında. */
  onReset?: () => void
  /** Numara her değiştiğinde (çağıran, SMS gerekip gerekmediğine buna göre karar veriyor). */
  onPhoneChange?: (phone: string) => void
  /**
   * YURT DIŞI NUMARA (2026-09-27): SMS yalnız KKTC/Türkiye cep hattına gidiyor. Verilirse, yabancı
   * numara yazıldığında "Kod gönder" gizlenir ve bu içerik gösterilir (e-posta yolu). Verilmezse
   * davranış eskisi gibi.
   */
  internationalSlot?: ReactNode
}) {
  const [phone, setPhone] = useState(initialPhone)
  const [code, setCode] = useState('')
  const [stage, setStage] = useState<'idle' | 'sent' | 'verified'>('idle')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [wait, setWait] = useState(0)
  // Sunucu da "bu numaraya SMS gidemez" dediyse (istemci kuralı kaçırdıysa) aynı yol gösterilir.
  const [serverSaysInternational, setServerSaysInternational] = useState(false)
  const international = Boolean(internationalSlot) && stage !== 'verified'
    && (looksInternational(phone) || serverSaysInternational)

  const codeRef = useRef<HTMLInputElement>(null)

  // Yeniden gönderme geri sayımı. Sunucu da aynı sınırı uyguluyor; buradaki sayaç yalnızca
  // kullanıcıya ne kadar bekleyeceğini söylüyor, güvenlik sınırı değil.
  useEffect(() => {
    if (wait <= 0) return
    const t = setInterval(() => setWait((w) => (w <= 1 ? 0 : w - 1)), 1000)
    return () => clearInterval(t)
  }, [wait])

  const post = useCallback(async (action: string, body: unknown) => {
    const res = await fetch(`/api/auth/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json().catch(() => null)
    return { ok: res.ok, status: res.status, data }
  }, [])

  const sendCode = async () => {
    if (busy || wait > 0) return
    setBusy(true)
    setError(null)
    setInfo(null)

    try {
      const { ok, data } = await post('phone-send-code', { phone: phone.trim(), purpose })

      if (!ok) {
        if (data?.internationalNumber && internationalSlot) {
          setServerSaysInternational(true)
          return
        }
        setError(data?.message ?? 'Kod gönderilemedi.')
        if (typeof data?.retryAfterSeconds === 'number') setWait(data.retryAfterSeconds)
        return
      }

      setStage('sent')
      setInfo('Kod telefonunuza gönderildi.')
      setWait(typeof data?.resendAfterSeconds === 'number' ? data.resendAfterSeconds : 60)
      setTimeout(() => codeRef.current?.focus(), 50)
    } catch {
      setError('Bağlantı kurulamadı. Lütfen tekrar deneyin.')
    } finally {
      setBusy(false)
    }
  }

  const verify = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    setInfo(null)

    try {
      const { ok, data } = await post('phone-verify', {
        phone: phone.trim(),
        purpose,
        code: code.trim(),
      })

      if (!ok || !data?.ticket) {
        setError(data?.message ?? 'Doğrulama kodu hatalı.')
        return
      }

      setStage('verified')
      setWait(0)
      onVerified(data.ticket as string, phone.trim())
    } catch {
      setError('Bağlantı kurulamadı. Lütfen tekrar deneyin.')
    } finally {
      setBusy(false)
    }
  }

  const unlock = () => {
    setStage('idle')
    setCode('')
    setError(null)
    setInfo(null)
    onReset?.()
  }

  return (
    <div className="phone-verify">
      <label>
        <span>{label}</span>
        <div className="phone-verify-row">
          <input
            name={name}
            value={phone}
            onChange={(e) => {
              setPhone(e.target.value)
              setServerSaysInternational(false)
              onPhoneChange?.(e.target.value)
            }}
            required
            maxLength={30}
            inputMode="tel"
            autoComplete="tel"
            placeholder="0533 000 00 00"
            readOnly={stage === 'verified'}
            aria-describedby="phone-verify-help"
          />

          {international ? null : stage === 'verified' ? (
            <button type="button" className="pv-btn pv-btn-ghost" onClick={unlock}>
              Değiştir
            </button>
          ) : (
            <button
              type="button"
              className="pv-btn"
              onClick={sendCode}
              disabled={busy || wait > 0 || phone.trim().length < 10}
            >
              {wait > 0 ? `${wait} sn` : stage === 'sent' ? 'Tekrar gönder' : 'Kod gönder'}
            </button>
          )}
        </div>
      </label>

      {stage === 'verified' && (
        <div className="pv-ok" role="status">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M20 6 9 17l-5-5" />
          </svg>
          Telefon doğrulandı
        </div>
      )}

      {stage === 'sent' && (
        <label className="pv-code-label">
          <span>SMS ile gelen 6 haneli kod</span>
          <div className="phone-verify-row">
            <input
              ref={codeRef}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="000000"
              className="pv-code"
              /*
                Enter tuşu formu göndermesin: kullanıcı kodu yazıp Enter'a bastığında kayıt
                formu doğrulanmadan gönderilirdi. Enter burada "Doğrula" demek.
              */
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  void verify()
                }
              }}
            />
            <button type="button" className="pv-btn" onClick={verify} disabled={busy || code.length < 4}>
              Doğrula
            </button>
          </div>
        </label>
      )}

      {international && <div className="pv-intl">{internationalSlot}</div>}

      {info && !error && <div className="pv-info" id="phone-verify-help">{info}</div>}
      {error && <div className="auth-error pv-error">{error}</div>}
    </div>
  )
}
