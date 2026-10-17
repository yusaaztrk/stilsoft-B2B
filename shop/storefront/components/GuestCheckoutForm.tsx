'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { KKTC_CITIES } from '@/lib/cyprusLocation'

/*
  ÜYE OLMADAN SİPARİŞ (2026-09-20; 2026-10-04'ten beri HER ZAMAN açık).

  Ad + telefon + adres alıp siparişi sürdürüyor. Şifre, e-posta ve SMS kodu SORULMAZ.

  KAYITLI NUMARADA DA DOĞRUDAN DEVAM (2026-10-05 kullanıcı kararı: "sizi tanıyoruz gelmesin").
  Mağaza API'si her üyesiz siparişte yeni bir kayıt (gerekirse yeni cari) açıyor; numara
  kayıtlı bir hesaba BAĞLANMADIĞI için başkasının siparişleri görünmez. Bkz.
  AccountController.GuestCheckout.

  ADRES KONTROLÜ (2026-10-05): "her şeyi doldurmama rağmen adres eksik diyordu". Adres en az
  10 karakter isteniyordu; "Girne merkez" gibi kısa ama gerçek bir adres "Teslimat adresinizi
  yazın" hatası alıyordu. Alt sınır 5 karaktere indi, hata hangi kutuda olduğunu söylüyor ve
  o kutu kırmızıyla işaretleniyor.
*/

type Alan = 'ad' | 'telefon' | 'sehir' | 'adres'

export default function GuestCheckoutForm({ returnTo = '/odeme' }: { returnTo?: string }) {
  const router = useRouter()
  const [ad, setAd] = useState('')
  const [telefon, setTelefon] = useState('')
  const [sehir, setSehir] = useState('')
  const [ilce, setIlce] = useState('')
  const [adres, setAdres] = useState('')
  const [busy, setBusy] = useState(false)
  const [hata, setHata] = useState<string | null>(null)
  const [hataliAlan, setHataliAlan] = useState<Alan | null>(null)

  const uyar = (alan: Alan, mesaj: string) => {
    setHataliAlan(alan)
    setHata(mesaj)
  }

  const gonder = async (e: React.FormEvent) => {
    e.preventDefault()
    setHata(null)
    setHataliAlan(null)

    if (ad.trim().length < 3) return uyar('ad', 'Ad Soyad kutusunu doldurun.')
    if (telefon.replace(/\D/g, '').length < 10) return uyar('telefon', 'Telefon numaranızı başında 0 olacak şekilde yazın (ör. 0533 123 45 67).')
    if (!sehir) return uyar('sehir', 'Şehir kutusundan şehrinizi seçin.')
    if (adres.trim().length < 5) return uyar('adres', 'Teslimat adresi çok kısa: mahalle / sokak ve bina bilgisini yazın.')

    setBusy(true)
    try {
      const res = await fetch('/api/auth/guest-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: ad.trim(),
          phone: telefon.trim(),
          city: sehir,
          district: ilce.trim(),
          address: adres.trim(),
        }),
      })

      const body = await res.json().catch(() => null)
      if (!res.ok) {
        setHata(body?.message ?? 'Bilgileriniz kaydedilemedi, lütfen tekrar deneyin.')
        setBusy(false)
        return
      }

      // Oturum çerezi köprüde yazıldı; sayfayı sunucudan yeniden alıp ödemeye geçiyoruz.
      router.replace(returnTo)
      router.refresh()
    } catch {
      setHata('Bağlantı kurulamadı, lütfen tekrar deneyin.')
      setBusy(false)
    }
  }

  const sinif = (alan: Alan) => (hataliAlan === alan ? 'gc-invalid' : undefined)
  const temizle = (alan: Alan) => {
    if (hataliAlan === alan) {
      setHataliAlan(null)
      setHata(null)
    }
  }

  return (
    <form className="guest-checkout" onSubmit={gonder} noValidate>
      <div className="gc-row">
        <label>
          <span>Ad Soyad</span>
          <input
            id="gc-ad"
            className={sinif('ad')}
            aria-invalid={hataliAlan === 'ad'}
            value={ad}
            onChange={(e) => {
              setAd(e.target.value)
              temizle('ad')
            }}
            autoComplete="name"
            placeholder="Adınız Soyadınız"
          />
        </label>
        <label>
          <span>Telefon</span>
          <input
            id="gc-telefon"
            className={sinif('telefon')}
            aria-invalid={hataliAlan === 'telefon'}
            value={telefon}
            onChange={(e) => {
              setTelefon(e.target.value)
              temizle('telefon')
            }}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="05XX XXX XX XX"
          />
        </label>
      </div>

      <div className="gc-row">
        <label>
          <span>Şehir</span>
          <select
            id="gc-sehir"
            className={sinif('sehir')}
            aria-invalid={hataliAlan === 'sehir'}
            value={sehir}
            onChange={(e) => {
              setSehir(e.target.value)
              temizle('sehir')
            }}
          >
            <option value="">Seçiniz</option>
            {KKTC_CITIES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>İlçe / Bölge</span>
          <input id="gc-ilce" value={ilce} onChange={(e) => setIlce(e.target.value)} placeholder="İsteğe bağlı" />
        </label>
      </div>

      <label className="gc-full">
        <span>Teslimat adresi</span>
        <textarea
          id="gc-adres"
          className={sinif('adres')}
          aria-invalid={hataliAlan === 'adres'}
          rows={3}
          value={adres}
          onChange={(e) => {
            setAdres(e.target.value)
            temizle('adres')
          }}
          autoComplete="street-address"
          placeholder="Mahalle, sokak, bina, daire"
        />
      </label>

      {hata && (
        <div className="gc-error" role="alert">
          {hata}
        </div>
      )}

      <button type="submit" className="btn btn-dark gc-submit" disabled={busy}>
        {busy ? 'Devam ediliyor…' : 'Ödemeye devam et'}
      </button>

      <p className="gc-note">
        🔒 Bilgileriniz yalnız teslimat için kullanılır. Sipariş numaranız ekranda görünür ve
        telefonunuza SMS ile gelir.
      </p>
    </form>
  )
}
