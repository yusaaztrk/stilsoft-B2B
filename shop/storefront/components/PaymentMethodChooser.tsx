'use client'

import { useState } from 'react'
import CheckoutForm from '@/components/CheckoutForm'
import CallbackForm from '@/components/CallbackForm'
import { withAttribution } from '@/lib/track'

/*
  ÖDEME YÖNTEMİ SEÇİMİ.

  2026-09-20: kapıda ödeme YOK, havale/EFT VAR (kullanıcı kararı).

  2026-09-21 — ÜÇ DEĞİŞİKLİK (kullanıcı: "havale ile ödeme taksit ile ödeme felan olmalıydı
  nerde bunlar", "ödeme yöntemi seçildikten sonra kart arayüzü açılır"):

  1. SEÇİM HİÇBİR ŞEY SEÇİLİ DEĞİLKEN AÇILIYOR. Önceden `method` doğrudan 'card' başlıyordu:
     müşteri sayfaya girer girmez kart formunu görüyor, havale seçeneğinin varlığını fark
     etmiyordu. Artık önce yöntem seçiliyor, kart arayüzü ondan SONRA açılıyor.

  2. TAKSİT AYRI BİR SEÇENEK OLARAK GÖRÜNÜYOR. Teknik olarak taksit de kart ödemesi; ama
     müşteri "taksit var mı" sorusunun cevabını ödeme yöntemleri arasında arıyor. Tek çekim
     ile taksit ayrı kutu olunca soru ekranda cevaplanmış oluyor. İkisi de aynı forma gidiyor,
     fark yalnızca taksit tablosunun açık gelmesi.

  3. HAVALE SEÇENEĞİ KAPALIYSA NEDENİ YAZIYOR. Önceden panelde IBAN tanımlı değilse seçenek
     hiç çizilmiyordu ve dışarıdan "havale kaldırılmış" gibi görünüyordu. Artık kutu duruyor,
     üstünde "şu an kapalı" rozeti var — hem müşteri boşuna aramıyor hem bayi eksiği görüyor.
*/

type Yontem = 'card' | 'taksit' | 'bank'

export default function PaymentMethodChooser({
  orderNo,
  bankTransferEnabled,
  telefon,
  whatsapp,
}: {
  orderNo: string
  bankTransferEnabled: boolean
  /** Panelden gelen firma telefonu; boşsa "Ara" bağlantısı hiç çizilmez. */
  telefon?: string
  /** Panelden gelen WhatsApp numarası; boşsa o düğme çizilmez. */
  whatsapp?: string
}) {
  const [method, setMethod] = useState<Yontem | null>(null)
  const [geriAra, setGeriAra] = useState(false)

  /* `tel:` ve `wa.me` yalnız rakam kabul eder; ekranda gösterilen boşluklu biçim korunuyor. */
  const telefonDijit = (telefon ?? '').replace(/(?!^\+)[^\d]/g, '')
  const whatsappDijit = (whatsapp ?? '').replace(/\D/g, '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const startBankTransfer = async () => {
    setBusy(true)
    setError(null)
    try {
      const note = (document.querySelector('textarea[name="deliveryNote"]') as HTMLTextAreaElement | null)?.value ?? ''
      const res = await fetch('/api/payments/bank-transfer/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Reklamdan geldiyse nota "[Reklam kaynağı: …]" satırı eklenir (bkz. lib/track.ts).
        body: JSON.stringify({ deliveryNote: withAttribution(note) }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.orderNo) {
        setError(data?.message ?? 'Havale kaydı açılamadı.')
        return
      }
      window.location.href = `/odeme/havale?siparis=${encodeURIComponent(data.orderNo)}`
    } catch {
      setError('Bağlantı kurulamadı. Lütfen tekrar deneyin.')
    } finally {
      setBusy(false)
    }
  }

  const kutu = (
    deger: Yontem,
    baslik: string,
    aciklama: string,
    ikon: React.ReactNode,
    kapali = false,
  ) => (
    <button
      type="button"
      role="radio"
      aria-checked={method === deger}
      disabled={kapali}
      className={`payment-method-card ${method === deger ? 'active' : ''} ${kapali ? 'is-kapali' : ''}`}
      onClick={() => !kapali && setMethod(deger)}
    >
      <span className="pm-ikon" aria-hidden="true">{ikon}</span>
      <span className="pm-metin">
        <b>
          {baslik}
          {kapali && <span className="pm-kapali-rozet">Şu an kapalı</span>}
        </b>
        <span>{aciklama}</span>
      </span>
      <span className="pm-tik" aria-hidden="true">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 6 9 17l-5-5" />
        </svg>
      </span>
    </button>
  )

  return (
    <div className="payment-method-wrap">
      <div className="payment-method-baslik">
        <b>Ödeme yöntemini seçin</b>
        <span>Seçtiğiniz yönteme göre devam edeceksiniz.</span>
      </div>

      <div className="payment-method-grid" role="radiogroup" aria-label="Ödeme yöntemi">
        {kutu(
          'card',
          'Tek Çekim',
          'Kredi / banka kartı ile 3D Secure. Tutarın tamamı tek seferde çekilir.',
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="5" width="20" height="14" rx="2.5" />
            <path d="M2 10h20" />
          </svg>,
        )}
        {kutu(
          'taksit',
          'Taksitli Ödeme',
          'Kartınız destekliyorsa taksit seçenekleri kart numarasını girince listelenir.',
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="5" width="20" height="14" rx="2.5" />
            <path d="M6 15h3M13 15h5" />
          </svg>,
        )}
        {kutu(
          'bank',
          'Havale / EFT',
          bankTransferEnabled
            ? 'IBAN\'ımıza gönderin, "Gönderdim" deyin; hesabımıza ulaşınca siparişiniz onaylanır.'
            : 'Banka hesabı henüz tanımlanmadı. Sipariş için bizi arayabilirsiniz.',
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 10h18M5 10V20M19 10V20M3 20h18M12 3 3 8h18z" />
          </svg>,
          !bankTransferEnabled,
        )}
      </div>

      {/*
        "ZORLANIYOR MUSUNUZ" ŞERİDİ (2026-09-21 kullanıcı isteği: "ödeme yöntemlerine de
        bir şeyler koy... siteye giren müşteriyi hiçbir şekilde kaçırmamamız gerekiyor").

        Ödeme adımı, sepeti dolduran müşterinin en çok takıldığı yer: kart bilgisi girmek
        istemiyor, 3D şifresi gelmiyor, havaleden emin olamıyor. O anda ekranda çıkış yolu
        yoksa sekmeyi kapatıyor ve sipariş kayboluyor. Burada üç çıkış birden var: ara,
        WhatsApp'tan yaz, ya da numaranı bırak biz arayalım.

        SİPARİŞ NUMARASI mesaja ekleniyor — temsilci hangi siparişten bahsedildiğini sormasın.
      */}
      <div className="odeme-yardim">
        <span className="odeme-yardim-metin">
          <b>Takıldınız mı?</b> Telefonda birlikte tamamlayalım.
        </span>
        <span className="odeme-yardim-dugmeler">
          {telefonDijit && (
            <a className="odeme-yardim-btn odeme-yardim-ara" href={`tel:${telefonDijit}`}>
              Hemen ara / bilgi al: {telefon}
            </a>
          )}
          {whatsappDijit && (
            <a
              className="odeme-yardim-btn odeme-yardim-wa"
              href={`https://wa.me/${whatsappDijit}?text=${encodeURIComponent(
                `Merhaba, ${orderNo} numarali siparisimi tamamlamakta yardim istiyorum.`,
              )}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              WhatsApp'tan yaz
            </a>
          )}
          <button type="button" className="odeme-yardim-btn odeme-yardim-geri" onClick={() => setGeriAra((x) => !x)}>
            {geriAra ? 'Kapat' : 'Beni siz arayın'}
          </button>
        </span>
      </div>

      {geriAra && (
        <div className="odeme-yardim-form">
          <CallbackForm kaynak="odeme" gorunum="serit" productName={`Sipariş: ${orderNo}`} />
        </div>
      )}

      {/*
        SEÇİM YAPILMADAN kart formu çizilmiyor. Bu bilerek: formu baştan açık göstermek,
        müşterinin diğer iki seçeneği hiç okumadan karta yönelmesi demekti.
      */}
      {method === null && (
        <div className="payment-method-bos">
          Devam etmek için yukarıdan bir ödeme yöntemi seçin.
        </div>
      )}

      {(method === 'card' || method === 'taksit') && (
        <CheckoutForm orderNo={orderNo} taksitModu={method === 'taksit'} />
      )}

      {method === 'bank' && (
        <div className="bank-transfer-box">
          <div className="havale-adimlar">
            <div className="havale-adim">
              <span className="havale-adim-no">1</span>
              <span>
                <b>Siparişi başlatın.</b> Aşağıdaki düğmeye bastığınızda sipariş numaranız
                oluşur ve IBAN bilgilerimiz ekrana gelir.
              </span>
            </div>
            <div className="havale-adim">
              <span className="havale-adim-no">2</span>
              <span>
                <b>Parayı gönderin.</b> Açıklama kısmına, bir sonraki adımda vereceğimiz{' '}
                <b>6 haneli kodu</b> yazmanız yeterli.
              </span>
            </div>
            <div className="havale-adim">
              <span className="havale-adim-no">3</span>
              <span>
                <b>&quot;Gönderdim&quot; düğmesine basın.</b> Başka bir şey yapmanıza gerek yok;
                para hesabımıza ulaşınca siparişiniz onaylanır ve size haber veririz.
              </span>
            </div>
          </div>

          <label>
            <span>Teslimat notu (isteğe bağlı)</span>
            <textarea name="deliveryNote" rows={2} maxLength={1000} />
          </label>
          {error && <div className="auth-error">{error}</div>}
          <button className="btn btn-dark" type="button" disabled={busy} onClick={() => void startBankTransfer()}>
            {busy ? 'Sipariş oluşturuluyor…' : 'Havale / EFT ile sipariş ver'}
          </button>
        </div>
      )}
    </div>
  )
}
