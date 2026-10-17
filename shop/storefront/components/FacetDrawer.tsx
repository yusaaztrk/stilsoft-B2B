'use client'

import { useEffect, useState, type ReactNode } from 'react'

/*
  MOBİLDE FİLTRE/KATEGORİ ÇEKMECESİ (2026-09-21).

  ÖLÇÜLEN SORUN (kullanıcı bildirimi: "sol menüden ürün seçiyorum, tüm kategoriler üstte
  kalıyor, çok kötü"): 375px telefonda kategori sayfasında filtre paneli **1184px** yer
  kaplıyor ve ilk ürün kartı **1630px**'de başlıyordu. Yani müşteri iki ekran dolusu filtre
  geçmeden tek bir ürün göremiyordu. Mobilde ızgara tek sütuna indiğinde kenar çubuğu
  ürünlerin ÜSTÜNE yığılıyor — masaüstünde yan yana durduğu için bu hiç fark edilmiyordu.

  ÇÖZÜM: mobilde panel bir düğmenin arkasına giriyor, tam ekran çekmece olarak açılıyor.
  Masaüstünde hiçbir şey değişmiyor — orada kenar çubuğu zaten doğru yerde.

  NEDEN CSS İLE GİZLEYİP AÇMAK YETMEDİ: panel içinde `Link`ler ve form alanları var;
  `display:none` ile gizlense bile ekran okuyucu ve klavye sırası için sorun olmaz ama
  "aç/kapa" durumunun React'te tutulması gerekiyor. Ayrıca açıkken arka planın kaymaması
  (`body` kilidi) yalnız JS ile yapılabiliyor.

  NEDEN SUNUCU BİLEŞENİ DEĞİL: durum var (açık/kapalı). Panelin İÇERİĞİ yine sunucuda
  üretiliyor ve `children` olarak geliyor — yani kategori bağlantıları ilk HTML'de yer
  alıyor, arama motoru görüyor. İçerik istemcide üretilseydi bu bağlantılar taranamazdı.
*/

export default function FacetDrawer({
  children,
  /** Düğmede gösterilecek özet ("32 ürün" gibi); boşsa yalnız başlık yazılır. */
  ozet,
  /** Kaç filtre etkin — rozet olarak düğmede görünür, sıfırsa rozet çizilmez. */
  etkinFiltre = 0,
}: {
  children: ReactNode
  ozet?: string
  etkinFiltre?: number
}) {
  const [acik, setAcik] = useState(false)

  useEffect(() => {
    if (!acik) return

    // Çekmece açıkken arkadaki liste kaymasın.
    const onceki = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAcik(false)
    }
    window.addEventListener('keydown', esc)

    return () => {
      document.body.style.overflow = onceki
      window.removeEventListener('keydown', esc)
    }
  }, [acik])

  return (
    <>
      {/* Açma düğmesi — yalnız mobilde çiziliyor (CSS). */}
      <button type="button" className="facet-ac-btn" onClick={() => setAcik(true)}>
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 6h18M7 12h10M10 18h4" />
        </svg>
        <span>Kategoriler &amp; Filtre</span>
        {etkinFiltre > 0 && <span className="facet-ac-rozet">{etkinFiltre}</span>}
        {ozet && <span className="facet-ac-ozet">{ozet}</span>}
      </button>

      {acik && (
        <div
          className="facet-perde"
          onClick={() => setAcik(false)}
          aria-hidden="true"
        />
      )}

      <div className={`facet-kabi${acik ? ' is-acik' : ''}`}>
        {/* Çekmece başlığı yalnız mobilde görünür; masaüstünde panel doğrudan akışta. */}
        <div className="facet-kabi-baslik">
          <strong>Kategoriler &amp; Filtre</strong>
          <button type="button" onClick={() => setAcik(false)} aria-label="Kapat">
            ✕
          </button>
        </div>

        <div className="facet-kabi-govde">{children}</div>

        <div className="facet-kabi-alt">
          <button type="button" className="btn btn-dark" onClick={() => setAcik(false)}>
            Ürünleri göster
          </button>
        </div>
      </div>
    </>
  )
}
