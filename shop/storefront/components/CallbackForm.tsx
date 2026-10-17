'use client'

import React, { useState } from 'react'

/*
  "SİZİ ARAYALIM" (2026-09-21).

  NEDEN: müşteri kitlesinin büyük bölümü siparişi telefonda kapatıyor; siteyi katalog gibi
  kullanıp arıyor. Gündüz arayabilen zaten arıyor — kaybedilen, MESAİ DIŞINDA bakan ziyaretçi.
  Onun için "adım + numaram" bırakacak tek tıklık bir yol yoksa o ziyaret tamamen kayboluyor:
  ne sepet kalıyor, ne WhatsApp mesajı, ne iz.

  NEDEN SMS'E BAĞLI DEĞİL: sunucuda SMS sağlayıcı bilgisi girilene kadar telefonla giriş,
  üyesiz sipariş ve sepet hatırlatmanın hepsi kapalı. Bu form yalnız panele kayıt düşürüyor,
  yani BUGÜN çalışıyor.

  NEDEN İKİ KUTU: ad ve telefon. Üçüncü bir kutu (e-posta, adres, mesaj) her seferinde
  doldurma oranını düşürür; not kutusu bilerek İSTEĞE BAĞLI ve katlanmış durumda.
*/

type Props = {
  /** Ürün sayfasındaysa ürün künyesi; sepet/genel formda boş bırakılır. */
  stockCode?: string
  productName?: string
  kaynak: 'urun' | 'sepet' | 'genel' | '404' | 'odeme'
  /** Ürün sayfasında daha sade bir kutu isteniyor; sepette dikkat çeken bir şerit. */
  gorunum?: 'kutu' | 'serit'
}

export default function CallbackForm({ stockCode, productName, kaynak, gorunum = 'kutu' }: Props) {
  const [ad, setAd] = useState('')
  const [tel, setTel] = useState('')
  const [not, setNot] = useState('')
  const [notAcik, setNotAcik] = useState(false)
  const [durum, setDurum] = useState<'form' | 'gonderiliyor' | 'tamam'>('form')
  const [hata, setHata] = useState<string | null>(null)

  const gonder = async (e: React.FormEvent) => {
    e.preventDefault()

    if (ad.trim().length < 2) {
      setHata('Adınızı yazın.')
      return
    }
    if (tel.replace(/\D/g, '').length < 10) {
      setHata('Telefon numaranızı başında 0 olacak şekilde yazın.')
      return
    }

    setDurum('gonderiliyor')
    setHata(null)
    try {
      const res = await fetch('/api/catalog/callback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: ad.trim(),
          phone: tel.trim(),
          stockCode: stockCode ?? null,
          productName: productName ?? null,
          note: not.trim() || null,
          source: kaynak,
        }),
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
      <div className={`geri-ara geri-ara-${gorunum} geri-ara-tamam`}>
        <b>Talebiniz alındı, {ad.trim().split(' ')[0]}.</b> En kısa sürede sizi arayacağız.
        Acele ediyorsanız WhatsApp'tan da yazabilirsiniz.
      </div>
    )
  }

  return (
    <form className={`geri-ara geri-ara-${gorunum}`} onSubmit={gonder}>
      <div className="geri-ara-baslik">
        <span className="geri-ara-ikon" aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
          </svg>
        </span>
        Sizi arayalım
      </div>
      {/*
        METİN BAĞLAMA GÖRE DEĞİŞİYOR — üç yer, üç farklı soru:
        ürün sayfasında "bu ürünü soracağım", sepette "siparişi bitiremiyorum",
        boş arama sonucunda "aradığımı bulamadım". Tek bir genel metin, üçünde de
        yanlış soruyu cevaplardı.
      */}
      <p className="geri-ara-lede">
        {kaynak === 'urun'
          ? 'Bu ürünle ilgili fiyat, stok, montaj ve teslimat sorularınızı telefonda cevaplayalım.'
          : kaynak === 'sepet'
            ? 'Numaranızı bırakın, siparişinizi telefonda birlikte tamamlayalım.'
            : kaynak === '404'
              ? 'Aradığınız ürün yayından kalkmış ya da adresi değişmiş olabilir. Numaranızı bırakın; aynısını ya da muadilini bulup sizi arayalım.'
              : kaynak === 'odeme'
                ? 'Ödeme adımında takıldıysanız numaranızı bırakın; siparişinizi telefonda biz tamamlayalım.'
                : 'Aradığınızı bulamadınız mı? Depomuzda sitede henüz görünmeyen ürünler de var. Numaranızı bırakın, sizi arayıp bulalım.'}
      </p>

      <div className="geri-ara-satir">
        <input
          type="text"
          autoComplete="name"
          className="geri-ara-input"
          placeholder="Adınız"
          value={ad}
          onChange={(e) => {
            setAd(e.target.value)
            if (hata) setHata(null)
          }}
          aria-label="Adınız"
        />
        <input
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          className="geri-ara-input"
          placeholder="05XX XXX XX XX"
          value={tel}
          onChange={(e) => {
            setTel(e.target.value)
            if (hata) setHata(null)
          }}
          aria-label="Telefon numaranız"
        />
        <button type="submit" className="btn btn-dark geri-ara-btn" disabled={durum === 'gonderiliyor'}>
          {durum === 'gonderiliyor' ? 'Gönderiliyor…' : 'Beni arayın'}
        </button>
      </div>

      {notAcik ? (
        <textarea
          className="geri-ara-not"
          rows={2}
          maxLength={500}
          placeholder="Eklemek istediğiniz bir şey varsa yazın (isteğe bağlı)"
          value={not}
          onChange={(e) => setNot(e.target.value)}
          aria-label="Notunuz"
        />
      ) : (
        <button type="button" className="geri-ara-not-ac" onClick={() => setNotAcik(true)}>
          + Not eklemek istiyorum
        </button>
      )}

      {hata && <div className="geri-ara-hata">{hata}</div>}
      <p className="geri-ara-kvkk">Numaranız yalnızca bu talebi aramak için kullanılır.</p>
    </form>
  )
}
