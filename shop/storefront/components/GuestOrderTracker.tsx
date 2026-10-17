'use client'

import { useState } from 'react'

type Result = {
  orderNo: string
  processedAt: string
  grandTotal: number
  isPaid: boolean
  paymentStatus: string
  stage: string
  stageLabel: string
  invoiceNo?: string | null
  lines: Array<{ name: string; quantity: number }>
}

/*
  ÜYELİKSİZ SİPARİŞ TAKİBİ (2026-09-20): sipariş no + sipariş verilen telefon. Eskiden takip
  için giriş şarttı; "siparişim nerede" sorusu telefona düşüyordu.
*/
export default function GuestOrderTracker({ initialOrderNo = '' }: { initialOrderNo?: string }) {
  const [orderNo, setOrderNo] = useState(initialOrderNo)
  const [phone, setPhone] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<Result | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      const res = await fetch('/api/orders/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderNo: orderNo.trim(), phone: phone.trim() }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        setError(data?.message ?? 'Sorgu tamamlanamadı.')
        return
      }
      setResult(data as Result)
    } catch {
      setError('Bağlantı kurulamadı. Lütfen tekrar deneyin.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="modern-track-form" onSubmit={submit}>
      <label htmlFor="track-no" className="track-input-label">Sipariş Numarası</label>
      <div className="track-input-group">
        <input id="track-no" className="track-input-field" value={orderNo} onChange={(e) => setOrderNo(e.target.value)} placeholder="Örn: S26091915211246" required />
      </div>
      <label htmlFor="track-phone" className="track-input-label" style={{ marginTop: 10 }}>Sipariş verdiğiniz telefon</label>
      <div className="track-input-group">
        <input id="track-phone" className="track-input-field" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0533 000 00 00" inputMode="tel" required />
        <button type="submit" className="btn btn-dark btn-sm" disabled={busy}>{busy ? 'Sorgulanıyor…' : 'Sorgula'}</button>
      </div>
      {error && <div className="auth-error" style={{ marginTop: 10 }}>{error}</div>}
      {result && (
        <div className="bank-transfer-box" style={{ marginTop: 14 }}>
          <div><b className="num">{result.orderNo}</b> · {new Date(result.processedAt).toLocaleDateString('tr-TR')}</div>
          <div style={{ margin: '6px 0' }}>
            <span className="bank-transfer-status">{result.stageLabel}</span>
          </div>
          <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 13 }}>
            {result.lines.map((l, i) => (
              <li key={i}>{l.name} × {l.quantity}</li>
            ))}
          </ul>
        </div>
      )}
    </form>
  )
}
