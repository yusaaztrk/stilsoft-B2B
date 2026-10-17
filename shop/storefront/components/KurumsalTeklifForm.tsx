'use client'

import { useState } from 'react'

/*
  KURUMSAL TEKLİF FORMU (2026-10-04).

  "Sizi arayalım" altyapısını kullanıyor (kaynak = "kurumsal"): talep panelde Talep Raporu →
  "Sizi Arayalım Talepleri" listesine "Kurumsal satış" etiketiyle düşer. Ayrı bir tablo ve
  ayrı bir panel ekranı açmak yerine aynı listede; satış ekibi zaten orayı takip ediyor.

  Firma, sektör ve ihtiyaç tek bir nota birleştiriliyor (API notu 500 karakterde kesiyor).
  Zorunlu olan yalnız ad ve telefon — kurumsal müşteri de formu uzun görünce bırakıyor.
*/

const SEKTORLER = [
  'Otel / Pansiyon',
  'Site / Apartman projesi',
  'Müteahhit / İnşaat',
  'Ofis / Şirket',
  'Restoran / Kafe',
  'Okul / Yurt / Kamu',
  'Kiralık daire yatırımı',
  'Diğer',
]

export default function KurumsalTeklifForm() {
  const [ad, setAd] = useState('')
  const [firma, setFirma] = useState('')
  const [tel, setTel] = useState('')
  const [sektor, setSektor] = useState('')
  const [ihtiyac, setIhtiyac] = useState('')
  const [durum, setDurum] = useState<'form' | 'gonderiliyor' | 'tamam'>('form')
  const [hata, setHata] = useState<string | null>(null)

  const gonder = async (e: React.FormEvent) => {
    e.preventDefault()
    if (ad.trim().length < 2) return setHata('Adınızı yazın.')
    if (tel.replace(/\D/g, '').length < 10) return setHata('Telefon numaranızı başında 0 olacak şekilde yazın.')

    const not = [
      firma.trim() && `Firma: ${firma.trim()}`,
      sektor && `Sektör: ${sektor}`,
      ihtiyac.trim() && `İhtiyaç: ${ihtiyac.trim()}`,
    ]
      .filter(Boolean)
      .join(' | ')
      .slice(0, 500)

    setDurum('gonderiliyor')
    setHata(null)
    try {
      const res = await fetch('/api/catalog/callback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: ad.trim(), phone: tel.trim(), note: not || null, source: 'kurumsal' }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        setHata(body?.message ?? 'Talebiniz alınamadı, lütfen tekrar deneyin.')
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
      <div className="kt-form kt-tamam" role="status">
        <span className="kt-tamam-ikon" aria-hidden="true">✓</span>
        <div>
          <b>Teşekkürler {ad.trim().split(' ')[0]}, talebiniz bize ulaştı.</b>
          <p>Kurumsal satış danışmanımız ihtiyacınızı görüşmek için sizi arayacak.</p>
        </div>
      </div>
    )
  }

  return (
    <form className="kt-form" onSubmit={gonder} noValidate>
      <div className="kt-row">
        <label>
          <span>Ad Soyad *</span>
          <input value={ad} onChange={(e) => setAd(e.target.value)} autoComplete="name" placeholder="Adınız Soyadınız" />
        </label>
        <label>
          <span>Telefon *</span>
          <input
            value={tel}
            onChange={(e) => setTel(e.target.value)}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="05XX XXX XX XX"
          />
        </label>
      </div>
      <div className="kt-row">
        <label>
          <span>Firma / Kurum</span>
          <input value={firma} onChange={(e) => setFirma(e.target.value)} autoComplete="organization" placeholder="İsteğe bağlı" />
        </label>
        <label>
          <span>Sektör</span>
          <select value={sektor} onChange={(e) => setSektor(e.target.value)}>
            <option value="">Seçiniz</option>
            {SEKTORLER.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="kt-full">
        <span>İhtiyacınız</span>
        <textarea
          rows={4}
          maxLength={400}
          value={ihtiyac}
          onChange={(e) => setIhtiyac(e.target.value)}
          placeholder="Örn. 24 daire için ankastre set + buzdolabı + çamaşır makinesi, teslim Mart 2027"
        />
      </label>

      {hata && <div className="kt-hata">{hata}</div>}

      <button type="submit" className="btn btn-dark kt-gonder" disabled={durum === 'gonderiliyor'}>
        {durum === 'gonderiliyor' ? 'Gönderiliyor…' : 'Teklif iste'}
      </button>
      <p className="kt-not">Bilgileriniz yalnız teklif için kullanılır. Ücretsizdir, bağlayıcı değildir.</p>
    </form>
  )
}
