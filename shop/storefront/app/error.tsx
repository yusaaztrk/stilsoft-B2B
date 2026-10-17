'use client'

import Link from 'next/link'
import { useEffect } from 'react'

/**
 * Beklenmeyen hata ekranı.
 *
 * Bu dosya yokken bir sayfa render sırasında patladığında ziyaretçi Next'in geliştirici
 * ekranına ya da üretimde boş bir hata sayfasına düşüyordu.
 *
 * HATA METNİ EKRANDA GÖSTERİLMİYOR. İstisna mesajları bağlantı dizgesi, sunucu adı, sorgu
 * parçası ve dosya yolu taşıyabiliyor; bunları ziyaretçiye basmak, sitenin iç yapısını
 * dışarıya anlatmak olur. Gösterilen tek teknik veri `digest`: Next'in ürettiği, sunucu
 * günlüğündeki kaydı işaret eden kimlik. Arayan müşteri bunu söylediğinde hangi hata olduğu
 * bulunabiliyor, ama kendisi hiçbir şey öğrenmiyor.
 *
 * `reset()` yeniden denemeyi sağlıyor: hataların önemli bir kısmı geçici (ERP ya da mağaza
 * servisi bir an cevap vermemiş olabilir) ve bu durumda kullanıcıyı sayfayı elle yenilemeye
 * zorlamanın anlamı yok.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Tarayıcı konsoluna yazılıyor ki geliştirme sırasında sebep kaybolmasın; sunucu
    // tarafındaki asıl kayıt Next'in kendi günlüğünde.
    console.error(error)
  }, [error])

  return (
    <div className="wrap">
      <div className="notfound">
        <span className="notfound-code">!</span>
        <h1>Bir şeyler ters gitti</h1>
        <p>
          Sayfa şu anda görüntülenemiyor. Kısa süreli bir aksaklık olabilir; tekrar denemek
          çoğu zaman yeterli oluyor.
        </p>

        <div className="hero-actions">
          <button className="btn btn-dark" type="button" onClick={reset}>
            Tekrar dene
          </button>
          <Link className="btn btn-line" href="/">
            Anasayfaya dön
          </Link>
        </div>

        <p className="notfound-note">
          Sorun sürerse <Link href="/iletisim">bize ulaşın</Link>.
          {error.digest ? (
            <>
              {' '}
              Görüşmede şu kodu iletirseniz kaydı hemen buluruz: <b className="num">{error.digest}</b>
            </>
          ) : null}
        </p>
      </div>
    </div>
  )
}
