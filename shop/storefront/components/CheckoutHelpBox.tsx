'use client'

import { useState } from 'react'
import CallbackForm from '@/components/CallbackForm'

/*
  "TAKILDINIZ MI?" KUTUSU (2026-10-04 kullanıcı isteği: "bir yerde takıldınız mı koy, orada da
  telefon numarasını koy, hemen ara bilgi al butonu koy").

  Sepette ve ödemeye giriş ekranında duruyor — müşterinin en çok vazgeçtiği iki adım. Üç
  çıkış: tek dokunuşla arama, WhatsApp, ya da numarasını bırakıp bizim aramamız (mesai
  dışında bakan müşteri için). Ödeme formunun içindeki yardım şeridi (PaymentMethodChooser)
  ayrı; bu kutu henüz kart adımına gelmemiş müşteri için.
*/
export default function CheckoutHelpBox({
  telefon,
  whatsapp,
  kaynak,
}: {
  telefon?: string
  whatsapp?: string
  kaynak: 'sepet' | 'odeme'
}) {
  const [geriAra, setGeriAra] = useState(false)

  // `tel:` ve `wa.me` yalnız rakam kabul eder; ekranda boşluklu biçim gösteriliyor.
  const telefonDijit = (telefon ?? '').replace(/(?!^\+)[^\d]/g, '')
  const whatsappDijit = (whatsapp ?? '').replace(/\D/g, '')

  return (
    <section className="takildiniz" aria-labelledby={`takildiniz-${kaynak}`}>
      <div className="takildiniz-ust">
        <span className="takildiniz-ikon" aria-hidden="true">☎</span>
        <div>
          <h2 id={`takildiniz-${kaynak}`}>Takıldınız mı?</h2>
          <p>
            Siparişinizi telefonda birlikte tamamlayalım; ürün, montaj ya da ödeme hakkında
            aklınıza takılanı hemen yanıtlayalım.
          </p>
        </div>
      </div>

      <div className="takildiniz-dugmeler">
        {telefonDijit && (
          <a className="btn btn-dark takildiniz-ara" href={`tel:${telefonDijit}`}>
            Hemen ara / bilgi al
            <small>{telefon}</small>
          </a>
        )}
        {whatsappDijit && (
          <a
            className="btn btn-line takildiniz-wa"
            href={`https://wa.me/${whatsappDijit}?text=${encodeURIComponent(
              'Merhaba, siparisimi tamamlamak icin bilgi almak istiyorum.',
            )}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            WhatsApp&apos;tan yaz
          </a>
        )}
        <button type="button" className="btn btn-line" onClick={() => setGeriAra((x) => !x)} aria-expanded={geriAra}>
          {geriAra ? 'Kapat' : 'Beni siz arayın'}
        </button>
      </div>

      {geriAra && (
        <div className="takildiniz-form">
          <CallbackForm kaynak={kaynak} gorunum="kutu" />
        </div>
      )}
    </section>
  )
}
