'use client'

import React, { useState } from 'react'

/*
  "GELİNCE HABER VER" (2026-09-20).

  Tükenen üründe tek seçenek "Stok için bize ulaşın" bağlantısıydı: müşteri iletişim
  sayfasına gidiyor ve orada kayboluyordu. Gelen ziyaret, ilgilenen müşteri ve o ziyareti
  getiren reklam parası birlikte çöpe gidiyordu.

  Burada müşteri tek kutuya telefonunu yazıp bırakıyor; stok gelince SMS gidiyor. Üyelik,
  e-posta, şifre yok — zaten amaç üye olmayan ziyaretçiyi kaybetmemek.

  Bayi tarafında da talep listesi oluşuyor ("bu ürünü 12 kişi bekliyor"), yani ne sipariş
  edilmesi gerektiği tahmin edilmiyor.
*/

export default function StockAlertForm({ stockCode }: { stockCode: string }) {
  const [phone, setPhone] = useState('')
  const [durum, setDurum] = useState<'form' | 'gonderiliyor' | 'tamam'>('form')
  const [hata, setHata] = useState<string | null>(null)

  const gonder = async (e: React.FormEvent) => {
    e.preventDefault()
    const temiz = phone.trim()
    if (temiz.replace(/\D/g, '').length < 10) {
      setHata('Telefon numaranızı başında 0 olacak şekilde yazın.')
      return
    }

    setDurum('gonderiliyor')
    setHata(null)
    try {
      const res = await fetch('/api/catalog/stock-alert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stockCode, phone: temiz }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        setHata(body?.message ?? 'Kayıt alınamadı, lütfen tekrar deneyin.')
        setDurum('form')
        return
      }
      setDurum('tamam')
    } catch {
      setHata('Bağlantı kurulamadı, lütfen tekrar deneyin.')
      setDurum('form')
    }
  }

  if (durum === 'tamam') {
    return (
      <div className="stock-alert stock-alert-done">
        <b>Kaydınız alındı.</b> Ürün stoklarımıza girdiğinde size SMS ile haber vereceğiz.
      </div>
    )
  }

  return (
    <form className="stock-alert" onSubmit={gonder}>
      <div className="stock-alert-title">Bu ürün şu anda tükendi</div>
      <p className="stock-alert-lede">
        Telefonunuzu bırakın, stoklarımıza girdiğinde ilk siz haberdar olun. Üyelik gerekmez.
      </p>
      <div className="stock-alert-row">
        <input
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          className="stock-alert-input"
          placeholder="05XX XXX XX XX"
          value={phone}
          onChange={(e) => {
            setPhone(e.target.value)
            if (hata) setHata(null)
          }}
          aria-label="Telefon numaranız"
        />
        <button type="submit" className="btn btn-dark" disabled={durum === 'gonderiliyor'}>
          {durum === 'gonderiliyor' ? 'Gönderiliyor…' : 'Gelince haber ver'}
        </button>
      </div>
      {hata && <div className="stock-alert-error">{hata}</div>}
    </form>
  )
}
