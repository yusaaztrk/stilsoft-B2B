'use client'

import { useState } from 'react'

/**
 * Şifre değiştirme.
 *
 * MEVCUT ŞİFRE sorulur — oturumun açık olması yetmez: ortak bilgisayarda açık kalmış bir oturumu
 * bulan kişi, şifreyi değiştirip hesabı tamamen ele geçirebilirdi.
 *
 * İstek doğrudan API'ye değil, Next köprüsüne gidiyor: oturum anahtarı httpOnly çerezde duruyor
 * ve tarayıcıdaki kod onu okuyamıyor. Şifre değişince sunucu yeni bir oturum anahtarı üretiyor;
 * köprü onu çereze yazıyor, böylece kullanıcı bu sekmede giriş ekranına düşmüyor.
 */
export default function ChangePasswordForm() {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [repeat, setRepeat] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setMessage(null)

    if (next.length < 8) {
      setMessage({ ok: false, text: 'Yeni şifre en az 8 karakter olmalı.' })
      return
    }
    if (next !== repeat) {
      setMessage({ ok: false, text: 'Yeni şifreler birbirini tutmuyor.' })
      return
    }

    setBusy(true)
    try {
      const res = await fetch('/api/auth/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      })
      const data = await res.json().catch(() => null)

      if (!res.ok) {
        setMessage({ ok: false, text: data?.message ?? 'Şifre değiştirilemedi.' })
        return
      }

      setMessage({ ok: true, text: data?.message ?? 'Şifreniz değiştirildi.' })
      setCurrent('')
      setNext('')
      setRepeat('')
    } catch {
      setMessage({ ok: false, text: 'Bağlantı kurulamadı. Lütfen tekrar deneyin.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="pw-form" onSubmit={submit}>
      <label>
        <span>Mevcut şifreniz</span>
        <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required />
      </label>

      <label>
        <span>Yeni şifre</span>
        <input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" required />
      </label>

      <label>
        <span>Yeni şifre (tekrar)</span>
        <input type="password" value={repeat} onChange={(e) => setRepeat(e.target.value)} autoComplete="new-password" required />
      </label>

      {message && <p className={message.ok ? 'pw-ok' : 'pw-error'}>{message.text}</p>}

      <button type="submit" className="btn btn-dark btn-sm" disabled={busy}>
        {busy ? 'Değiştiriliyor…' : 'Şifremi değiştir'}
      </button>

      <p className="pw-note">
        Şifreniz değiştiğinde diğer cihazlardaki oturumlarınız kapanır; bu cihazda açık kalırsınız.
      </p>
    </form>
  )
}
