'use client'

import { useState } from 'react'

/**
 * İletişim formu.
 *
 * Daha önce bu form hiçbir yere gönderilmiyordu (`onSubmit` boştu, düğme `type="button"`) —
 * müşteri mesajını yazıp gönderdiğinde ekranda hiçbir şey olmuyor, bayi de hiçbir zaman
 * haberdar olmuyordu (2026-09-05 denetiminde bulundu). Artık `/api/contact` üzerinden bayinin
 * firma e-postasına (panelde girilen adrese) iletiliyor.
 */
export default function ContactForm() {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (busy) return

    const form = e.currentTarget
    const data = new FormData(form)
    const payload = {
      name: String(data.get('name') ?? '').trim(),
      phone: String(data.get('phone') ?? '').trim(),
      email: String(data.get('email') ?? '').trim() || undefined,
      subject: String(data.get('subject') ?? ''),
      message: String(data.get('message') ?? '').trim(),
    }

    setBusy(true)
    setResult(null)
    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const body = await res.json().catch(() => null)

      if (!res.ok) {
        setResult({ kind: 'err', text: body?.message ?? 'Mesajınız gönderilemedi. Lütfen tekrar deneyin.' })
        return
      }

      setResult({ kind: 'ok', text: 'Mesajınız iletildi. En kısa sürede size dönüş yapacağız.' })
      form.reset()
    } catch {
      setResult({ kind: 'err', text: 'Bağlantı hatası oluştu. Lütfen tekrar deneyin.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="modern-contact-form" onSubmit={onSubmit}>
      <div className="form-row-2">
        <div className="form-group">
          <label htmlFor="contact-name">Adınız Soyadınız *</label>
          <input id="contact-name" name="name" type="text" placeholder="Örn: Ahmet Yılmaz" className="c-input" required />
        </div>
        <div className="form-group">
          <label htmlFor="contact-phone">Telefon Numaranız *</label>
          <input id="contact-phone" name="phone" type="tel" placeholder="0533 000 00 00" className="c-input" required />
        </div>
      </div>

      <div className="form-row-2">
        <div className="form-group">
          <label htmlFor="contact-email">E-Posta Adresiniz</label>
          <input id="contact-email" name="email" type="email" placeholder="ahmet@example.com" className="c-input" />
        </div>
        <div className="form-group">
          <label htmlFor="contact-subject">Konu *</label>
          <select id="contact-subject" name="subject" className="c-select" required defaultValue="siparis">
            <option value="siparis">Sipariş &amp; Teslimat</option>
            <option value="urun">Ürün Bilgisi</option>
            <option value="servis">Servis &amp; Garanti</option>
            <option value="kurumsal">Toptan &amp; Kurumsal</option>
            <option value="diger">Diğer</option>
          </select>
        </div>
      </div>

      <div className="form-group">
        <label htmlFor="contact-message">Mesajınız *</label>
        <textarea
          id="contact-message"
          name="message"
          rows={5}
          placeholder="Mesajınızı buraya yazınız..."
          className="c-textarea"
          required
        />
      </div>

      {result && <div className={result.kind === 'ok' ? 'auth-success' : 'auth-error'}>{result.text}</div>}

      <button type="submit" className="btn btn-dark btn-sm contact-submit-btn" disabled={busy}>
        {busy ? 'Gönderiliyor…' : 'Mesajı Gönder'}
      </button>
    </form>
  )
}
