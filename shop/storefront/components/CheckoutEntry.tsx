'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import GuestCheckoutForm from '@/components/GuestCheckoutForm'
import AuthForm from '@/components/AuthForm'

/*
  ÖDEMEYE GİRİŞ — İKİ BÜYÜK DÜĞME (2026-10-04 kullanıcı isteği: "ödemeye geçince orada sorsun,
  üyelik ile devam / üye olmadan devam et diye 2 tane kocaman buton gözüksün").

  ÜYE OLMADAN: ad soyad, telefon ve adres alınır, aynı sayfada ödemeye geçilir. Oturum
  çerezi tarayıcı kapanınca silinir (bkz. app/api/auth/[action] — guest-checkout), müşteriye
  sipariş numarası ekranda ve SMS'te verilir.

  ÜYELİK İLE: SMS kodu (servis açıksa) ya da e-posta. Üyelik ve giriş aynı ekranda; telefonla
  girişte numara kayıtlıysa doğrudan oturum açılıyor.

  `yol=misafir` (sepete ekleme penceresindeki "Hemen satın al") formu doğrudan açık getirir.

  TELEFONDA FORM GÖRÜNMÜYORDU (2026-10-16, Clarity kaydı): Google reklamından gelen müşteri
  "Hemen satın al" ile `?yol=misafir` sayfasına indi. Ekranda iki büyük düğme vardı, "Üye
  olmadan devam et" zaten seçiliydi; form ise ekranın ALTINDA kalıyordu. Müşteri seçili
  düğmeye iki kez dokundu, hiçbir şey olmadı (seçili düğmeye basmak bir şey yapmıyordu) ve
  6 saniyede çıktı. Şimdi:
  - `yol=misafir` ile gelende iki düğme hiç gösterilmiyor; form en üstte, altında küçük bir
    "üyeliğiniz var mı?" bağlantısı var.
  - Düğmeye basınca (seçili olsa bile) form ekrana kaydırılıyor ve ilk kutu odaklanıyor.
*/
type Yol = 'misafir' | 'uye' | null

export default function CheckoutEntry({ baslangic }: { baslangic?: Yol }) {
  const [yol, setYol] = useState<Yol>(baslangic ?? null)
  // Doğrudan üyesiz yoldan gelen için seçim düğmeleri gösterilmiyor (bkz. üstteki not).
  const [kisaYol, setKisaYol] = useState(baslangic === 'misafir')
  const panelRef = useRef<HTMLDivElement>(null)
  const [kaydir, setKaydir] = useState(0)

  // Telefonda yüzen "Ara"/WhatsApp düğmeleri form kutularını örtmesin (bkz. globals.css odeme-adimi).
  useEffect(() => {
    document.body.classList.add('odeme-adimi')
    return () => document.body.classList.remove('odeme-adimi')
  }, [])

  useEffect(() => {
    if (kaydir === 0) return
    const panel = panelRef.current
    if (!panel) return
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' })
    // Kaydırma bitmeden odaklamak mobil klavyeyi erken açıp sayfayı zıplatıyor.
    const t = window.setTimeout(() => {
      panel.querySelector<HTMLInputElement>('input, select, textarea')?.focus({ preventScroll: true })
    }, 450)
    return () => window.clearTimeout(t)
  }, [kaydir])

  const sec = (y: Exclude<Yol, null>) => {
    setYol(y)
    setKaydir((n) => n + 1)
  }

  const uyeYolunaGec = () => {
    setKisaYol(false)
    sec('uye')
  }

  return (
    <div className="co-entry">
      {!kisaYol && (
        <div className="co-entry-choices" role="group" aria-label="Nasıl devam etmek istersiniz?">
          <button
            type="button"
            aria-pressed={yol === 'misafir'}
            className={`co-entry-btn co-entry-guest${yol === 'misafir' ? ' active' : ''}`}
            onClick={() => sec('misafir')}
          >
            <span className="co-entry-title">Üye olmadan devam et</span>
            <span className="co-entry-sub">Ad, telefon ve adres yeterli · en hızlı yol</span>
          </button>
          <button
            type="button"
            aria-pressed={yol === 'uye'}
            className={`co-entry-btn co-entry-member${yol === 'uye' ? ' active' : ''}`}
            onClick={() => sec('uye')}
          >
            <span className="co-entry-title">Üyelik ile devam et</span>
            <span className="co-entry-sub">Giriş yapın ya da bir dakikada üye olun</span>
          </button>
        </div>
      )}

      {yol === 'misafir' && (
        <div className="co-entry-panel" ref={panelRef}>
          <h2>Teslimat bilgileriniz</h2>
          <p className="co-entry-lede">
            Bilgilerinizi alıp hemen ödemeye geçiyoruz. Üyelik, e-posta ya da şifre gerekmez;
            sipariş numaranız ekranda görünür ve telefonunuza SMS ile gelir.
          </p>
          <GuestCheckoutForm returnTo="/odeme" />
          {kisaYol && (
            <p className="co-entry-switch">
              Üyeliğiniz var mı?{' '}
              <button type="button" className="link-btn" onClick={uyeYolunaGec}>
                Giriş yapın
              </button>
            </p>
          )}
        </div>
      )}

      {yol === 'uye' && (
        <div className="co-entry-panel" ref={panelRef}>
          {/*
            ŞİFRELİ GİRİŞ (2026-10-05): SMS kodu yerine telefon/e-posta + şifre. SMS sağlayıcısı
            kod ulaştıramıyordu; "Üyelik ile devam" müşteriyi koda bekletiyordu.
          */}
          <h2>Giriş yapın</h2>
          <p className="co-entry-lede">Telefon numaranız ya da e-postanız ve şifrenizle girin.</p>
          <AuthForm mode="login" returnTo="/odeme" />
          <div className="co-entry-alt">
            <Link className="btn btn-line" href={`/uye-ol?donus=${encodeURIComponent('/odeme')}`}>
              Hesabım yok, üye ol
            </Link>
            <Link className="btn btn-line" href="/sifremi-unuttum">
              Şifremi unuttum
            </Link>
          </div>
          <p className="co-entry-switch">
            Üyelikle uğraşmak istemiyor musunuz?{' '}
            <button type="button" className="link-btn" onClick={() => sec('misafir')}>
              Üye olmadan devam edin
            </button>
          </p>
        </div>
      )}
    </div>
  )
}
