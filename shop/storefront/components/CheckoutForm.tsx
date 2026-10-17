'use client'

import { useMemo, useState } from 'react'
import { formatPrice } from '@/lib/format'
import { withAttribution } from '@/lib/track'
import CreditCardPreview, { type BankVariant, type CardType, type ThemeVariant } from '@/components/CreditCardPreview'

type InstallmentOption = {
  merchantInstallment: number
  installmentText: string
  totalAmount: number
  monthlyAmount: number
}

type CardOptions = {
  bankCode: number
  bankName: string
  cardType1: string
  cardType2: string
  installments: InstallmentOption[]
}

/**
 * Kart formu.
 *
 * Kart bilgisi yalnızca bu formun ömrü boyunca bellekte durur: hiçbir yere kaydedilmez,
 * saklanmaz, kayıt sonrası yeniden doldurulmaz. Tutar da burada YOK — ne gönderilir ne
 * hesaplanır; karttan çekilecek tutarı sipariş belirler. Bu ekran tutarı yalnızca gösterir.
 */
export default function CheckoutForm({
  orderNo,
  /**
   * Müşteri ödeme yöntemi olarak "Taksitli Ödeme"yi seçtiyse true. Akış aynı (tek kart formu,
   * tek 3D çağrısı); fark BEKLENTİYİ KARŞILAMAK: taksit kutusu en üstte, kart numarası
   * girilene kadar "kart numarasını girin" diyen bir yer tutucu duruyor ve kart taksidi
   * desteklemiyorsa bu açıkça yazılıyor. Önceden taksit yalnız desteklendiğinde beliren
   * sıradan bir açılır kutuydu; desteklenmediğinde ekranda hiçbir şey değişmiyor, müşteri
   * "taksit nerede" diye soruyordu.
   */
  taksitModu = false,
}: {
  orderNo: string
  taksitModu?: boolean
}) {
  const [cardNumber, setCardNumber] = useState('')
  const [cardHolderName, setCardHolderName] = useState('')
  const [expMonth, setExpMonth] = useState('')
  const [expYear, setExpYear] = useState('')
  const [cvc, setCvc] = useState('')
  const [flipped, setFlipped] = useState(false)
  const [options, setOptions] = useState<CardOptions | null>(null)
  const [installment, setInstallment] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // Konum doğrulaması artık sayfa düzeyinde (KktcGate); form içinde kapı yok (2026-09-20).
  const isLocationValid = true

  const digits = cardNumber.replace(/\D/g, '')

  /** Kartın taksit seçeneği var mı — 1 taksit "tek çekim" demek, o yüzden > 1 arıyoruz. */
  const taksitSecenekleri = (options?.installments ?? []).filter((x) => x.merchantInstallment > 1)
  const taksitDestekliyor = taksitSecenekleri.length > 0

  /**
   * Kart görseli ve banka tanıması B2B panelindeki Sanal POS ekranıyla BİREBİR aynı kural
   * seti kullanıyor (frontend/src/pages/PosPage.tsx detectedCardType/detectedVariant) —
   * kullanıcı isteği: "banka tanıması felan bu frontend güncellemelerini yap".
   */
  const detectedCardType = useMemo<CardType | ''>(() => {
    if (!digits) return ''
    if (digits.startsWith('9792')) return 'troy'
    if (digits.startsWith('4')) return 'visa'
    const first2 = Number(digits.slice(0, 2))
    if (first2 >= 51 && first2 <= 55) return 'mastercard'
    return ''
  }, [digits])

  const detectedVariant = useMemo<BankVariant | ThemeVariant>(() => {
    const b = String(options?.bankName ?? '')
      .trim()
      .toLowerCase()
      .replace(/ı/g, 'i')
      .normalize('NFD')
      .replace(/\p{Diacritic}+/gu, '')
      .replace(/\./g, '')
      .replace(/\s+/g, ' ')
      .trim()
    if (!b) return 'gradient-blue'

    if (b.includes('is bankasi') || b.includes('isbank') || b.includes('turkiye is bankasi') || b.includes('turkiyeisbankasi')) return 'isbank'
    if (b.includes('garanti')) return 'garanti'
    if (b.includes('yapi kredi') || b.includes('yapikredi')) return 'yapikredi'
    if (b.includes('akbank')) return 'akbank'
    if (b.includes('ziraat')) return 'ziraat'
    if (b.includes('halk')) return 'halkbank'
    if (b.includes('qnb') || b.includes('finansbank')) return 'qnb'
    if (b.includes('deniz')) return 'denizbank'
    if (b.includes('teb') || b.includes('turk ekonomi bankasi') || b.includes('turk ekonomibankasi')) return 'teb'
    if (b.includes('enpara')) return 'enpara'
    if (b.includes('albaraka')) return 'albaraka'
    if (b.includes('kuveyt turk') || b.includes('kuveytturk')) return 'kuveytturk'

    return 'gradient-blue'
  }, [options?.bankName])

  /**
   * Kartın ilk 6 hanesi bankayı belirler; taksit seçenekleri ona ve sipariş tutarına bağlı.
   * Tutar sorguya konmuyor — sunucu siparişten okuyor.
   */
  const loadOptions = async (value: string) => {
    const bin = value.replace(/\D/g, '').slice(0, 6)
    if (bin.length < 6) {
      setOptions(null)
      setInstallment(0)
      return
    }

    try {
      const res = await fetch(
        `/api/payments/card-options?bin=${encodeURIComponent(bin)}&orderNo=${encodeURIComponent(orderNo)}`,
      )
      if (!res.ok) return
      setOptions((await res.json()) as CardOptions)
    } catch {
      // Taksit seçenekleri alınamazsa tek çekim ile devam edilebilir; ödeme engellenmemeli.
    }
  }

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy) return

    if (!isLocationValid) {
      setError(
        'Sipariş oluşturabilmek için teslimat konumunuzun KKTC (Kuzey Kıbrıs) sınırları içerisinde olduğunu doğrulamanız veya onaylamanız gerekmektedir.',
      )
      return
    }

    setBusy(true)
    setError(null)

    const form = new FormData(event.currentTarget)

    try {
      const res = await fetch('/api/payments/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cardHolderName: String(form.get('cardHolderName') ?? ''),
          cardNumber: digits,
          expMonth: String(form.get('expMonth') ?? ''),
          expYear: String(form.get('expYear') ?? ''),
          cvc: String(form.get('cvc') ?? ''),
          installmentCount: installment,
          bankCode: options?.bankCode ?? 0,
          // Reklamdan geldiyse nota "[Reklam kaynağı: …]" satırı eklenir (bkz. lib/track.ts).
          deliveryNote: withAttribution(String(form.get('deliveryNote') ?? '')),
        }),
      })

      const data = await res.json().catch(() => null)

      if (!res.ok || !data?.htmlForm) {
        setError(data?.message ?? 'Ödeme başlatılamadı.')
        return
      }

      // Banka kendi 3D formunu HTML olarak veriyor ve form kendini gönderiyor. Sayfanın
      // tamamı onunla değiştiriliyor: çerçeve içine koymak bazı bankaların 3D sayfasında
      // engelleniyor ve müşteri boş bir kutuya bakıyor.
      document.open()
      document.write(data.htmlForm as string)
      document.close()
    } catch {
      setError('Bağlantı kurulamadı. Lütfen tekrar deneyin.')
      setBusy(false)
    }
  }

  return (
    <form className="checkout-form" onSubmit={onSubmit}>
      {/*
        KART BÖLÜMÜ AYRI BİR PANELDE (2026-09-10 kullanıcı isteği: "kart girilirkenki kısmın
        frontendi aşırı kötü").

        Eskiden alanlar sayfanın geri kalanıyla aynı düzlemde, düz bir liste hâlinde
        duruyordu; ödeme adımı olduğunu anlatan hiçbir görsel işaret yoktu. Ödeme formunda
        güven ipucu (kilit, 3D Secure) sadece süs değil — kart bilgisini girerken kullanıcı
        nerede olduğunu görmek ister.
      */}
      <div className="pay-card">
        <div className="pay-card-head">
          <span className="pay-card-title">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
              <rect x="4" y="11" width="16" height="10" rx="2" />
              <path d="M8 11V7a4 4 0 0 1 8 0v4" />
            </svg>
            Kart Bilgileri
          </span>
          <span className="pay-card-secure">3D Secure</span>
        </div>

        <div className="pay-card-preview">
          <CreditCardPreview
            cardNumber={cardNumber}
            cardHolder={cardHolderName}
            expiryDate={`${expMonth}${expYear}`}
            cvv={cvc}
            cardType={detectedCardType}
            bankName={options?.bankName ?? ''}
            variant={detectedVariant}
            hasContactless
            flipped={flipped}
            onFlippedChange={setFlipped}
          />
        </div>

        <label>
          <span>Kart üzerindeki isim</span>
          <input
            name="cardHolderName"
            required
            maxLength={100}
            autoComplete="cc-name"
            placeholder="AHMET YILMAZ"
            value={cardHolderName}
            onChange={(e) => setCardHolderName(e.target.value)}
          />
        </label>

        <label>
          <span>Kart numarası</span>
          {/* Kart numarası tek tip aralıklı yazıyla: 16 hane okunurken göz kayması olmasın. */}
          <input
            className="pay-card-number"
            name="cardNumber"
            required
            inputMode="numeric"
            autoComplete="cc-number"
            maxLength={19}
            placeholder="0000 0000 0000 0000"
            value={cardNumber}
            onChange={(e) => {
              setCardNumber(e.target.value)
              void loadOptions(e.target.value)
            }}
            onFocus={() => setFlipped(false)}
          />
          {options && (
            <small className="pay-card-bank">
              {options.bankName} · {options.cardType1} {options.cardType2}
            </small>
          )}
        </label>

      <div className="checkout-row">
        <label>
          <span>Ay</span>
          <input
            name="expMonth"
            required
            inputMode="numeric"
            maxLength={2}
            placeholder="01"
            autoComplete="cc-exp-month"
            value={expMonth}
            onChange={(e) => setExpMonth(e.target.value.replace(/\D/g, '').slice(0, 2))}
            onFocus={() => setFlipped(false)}
          />
        </label>
        <label>
          <span>Yıl</span>
          <input
            name="expYear"
            required
            inputMode="numeric"
            maxLength={2}
            placeholder="30"
            autoComplete="cc-exp-year"
            value={expYear}
            onChange={(e) => setExpYear(e.target.value.replace(/\D/g, '').slice(0, 2))}
            onFocus={() => setFlipped(false)}
          />
        </label>
        <label>
          <span>CVC</span>
          <input
            name="cvc"
            required
            inputMode="numeric"
            maxLength={4}
            placeholder="000"
            autoComplete="cc-csc"
            value={cvc}
            onChange={(e) => setCvc(e.target.value.replace(/\D/g, '').slice(0, 4))}
            onFocus={() => setFlipped(true)}
            onBlur={() => setFlipped(false)}
          />
        </label>
      </div>

      {/*
        TAKSİT BÖLÜMÜ.

        ÜÇ AYRI HÂL VAR ve üçü de ekranda söyleniyor (2026-09-21). Önceden yalnız "taksit
        destekleniyor" hâli çiziliyordu; diğer ikisinde ekranda hiçbir şey olmuyordu ve
        taksit bekleyen müşteri ne olduğunu anlamıyordu.
      */}
      {taksitModu && !options && (
        <div className="taksit-kutu taksit-bekliyor">
          <b>Taksit seçenekleri</b>
          <span>Kart numaranızın ilk 6 hanesini girin; kartınıza uygun taksitler burada listelenecek.</span>
        </div>
      )}

      {options && !taksitDestekliyor && (
        <div className="taksit-kutu taksit-yok">
          <b>Kartınız taksitli ödemeyi desteklemiyor</b>
          <span>
            {options.bankName} kartınızda bu tutar için taksit tanımlı değil. Tek çekim ile
            devam edebilir ya da geri dönüp havale/EFT seçebilirsiniz.
          </span>
        </div>
      )}

      {taksitDestekliyor && (
        <label className={taksitModu ? 'taksit-secim taksit-secim-odak' : 'taksit-secim'}>
          <span>Taksit</span>
          <select value={installment} onChange={(e) => setInstallment(Number(e.target.value))}>
            {options!.installments.map((option) => (
              <option key={option.merchantInstallment} value={option.merchantInstallment}>
                {option.installmentText}
                {option.merchantInstallment > 1
                  ? ` — ${formatPrice(option.monthlyAmount, 'TRY')} × ${option.merchantInstallment}`
                  : ''}
              </option>
            ))}
          </select>
        </label>
      )}
      </div>

      <label>
        <span>Teslimat notu (isteğe bağlı)</span>
        <textarea name="deliveryNote" rows={2} maxLength={1000} />
      </label>

      {error && <div className="auth-error">{error}</div>}

      <button className="btn btn-dark" type="submit" disabled={busy || !isLocationValid}>
        {busy ? 'Bankaya yönlendiriliyorsunuz…' : !isLocationValid ? 'Konum Doğrulaması Gerekiyor' : 'Ödemeyi tamamla'}
      </button>

      <p className="checkout-secure">
        Ödeme 3D Secure ile bankanızın sayfasında tamamlanır. Kart bilgileriniz mağazada saklanmaz.
      </p>
    </form>
  )
}
