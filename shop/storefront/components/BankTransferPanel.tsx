'use client'

import { useState } from 'react'
import Link from 'next/link'

type Account = { bankName: string; accountHolder: string; iban: string; currency?: string }

/*
  KISA ÖDEME KODU — sipariş numarasının son 6 hanesi.

  TEK YERDE: aynı kod hem vitrinde (müşteriye "şunu yaz" denen kod) hem bayi panelindeki
  açık havale listesinde görünmeli. İki yerde ayrı ayrı hesaplanırsa biri değiştiğinde
  diğeri sessizce ayrışır ve ödeme eşleşmez.

  NEDEN SON 6: sipariş numarası tarih + sıra numarası taşıyor; sondaki haneler sıra
  numarası, yani AYNI GÜN açılan siparişler arasında ayırt edici olan kısım o. Baştan
  almak bütün siparişlerde aynı çıkardı.

  ÇAKIŞMA RİSKİ: teorik olarak iki farklı günün siparişi aynı son-6'ya düşebilir. Pratikte
  sorun değil çünkü eşleştirme yalnız AÇIK havale kayıtları arasında yapılıyor (72 saat) ve
  panelde kodun yanında tutar ile müşteri adı da duruyor.
*/
export function kisaOdemeKodu(orderNo: string): string {
  const temiz = (orderNo ?? '').replace(/\s+/g, '')
  return temiz.length <= 6 ? temiz : temiz.slice(-6)
}

export default function BankTransferPanel({
  orderNo,
  amountText,
  status,
  isPaid,
  message,
  accounts,
  timeoutHours,
}: {
  orderNo: string
  amountText: string
  status: string
  isPaid: boolean
  message: string
  accounts: Account[]
  timeoutHours: number
}) {
  const [current, setCurrent] = useState(status)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  const kisaKod = kisaOdemeKodu(orderNo)

  const sent = current === 'BankTransferSent'
  const requested = current === 'BankTransferRequested'
  const closed = !isPaid && !sent && !requested

  const markSent = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/payments/bank-transfer/${encodeURIComponent(orderNo)}/sent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        setError(data?.message ?? 'Bildirim kaydedilemedi.')
        return
      }
      setCurrent('BankTransferSent')
    } catch {
      setError('Bağlantı kurulamadı. Lütfen tekrar deneyin.')
    } finally {
      setBusy(false)
    }
  }

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(text)
      setTimeout(() => setCopied(null), 1500)
    } catch {
      /* pano yoksa sessiz */
    }
  }

  return (
    <div>
      <p className="auth-lede">
        Sipariş No <strong className="num">{orderNo}</strong> · Tutar <strong className="num">{amountText}</strong>
      </p>

      {isPaid && (
        <div className="bank-transfer-box" style={{ borderColor: '#10b981' }}>
          <span className="bank-transfer-status" style={{ background: '#d1fae5', color: '#065f46' }}>Ödeme alındı</span>
          <p>Teşekkür ederiz. Siparişiniz hazırlanıyor; teslimat için sizi arayacağız.</p>
          <Link className="btn btn-dark" href="/hesabim/siparislerim">Siparişlerim</Link>
        </div>
      )}

      {closed && (
        <div className="bank-transfer-box" style={{ borderColor: '#ef4444' }}>
          <span className="bank-transfer-status" style={{ background: '#fee2e2', color: '#991b1b' }}>Kapalı</span>
          <p>{message || 'Bu havale kaydı kapatılmış.'}</p>
          <Link className="btn btn-dark" href="/sepet">Sepete dön</Link>
        </div>
      )}

      {(requested || sent) && (
        <>
          <div className="bank-transfer-box">
            {/*
              TABLO DEĞİL KART (2026-09-21 kullanıcı isteği: "isim ayrı yazsın, IBAN ayrı
              yazsın, genişlik dive dağılsın").

              Önce üç sütunlu bir tabloydu: banka adı + hesap sahibi solda, IBAN ortada,
              kopyala düğmesi sağda. IBAN 26 hane ve boşluksuz; orta sütuna sıkışınca hem
              okunmuyor hem de satır dar bir şeride dönüşüyordu. Müşterinin bankadan
              yapacağı iş TEK TEK okumak: önce kimin hesabı, sonra IBAN.

              Artık her hesap kendi kartında ve bilgiler ALT ALTA:
                1. satır — banka adı ve hesap sahibi
                2. satır — IBAN, büyük ve tek parça; yanında kopyala düğmesi
            */}
            <div className="havale-hesaplar">
              {accounts.map((a, i) => {
                const temizIban = a.iban.replace(/\s+/g, '')
                return (
                  <div key={i} className="havale-hesap">
                    <div className="havale-hesap-ust">
                      <b className="havale-banka">{a.bankName}</b>
                      <span className="havale-sahip">{a.accountHolder}</span>
                    </div>
                    <div className="havale-hesap-alt">
                      <span className="havale-iban num">{a.iban}</span>
                      <button
                        type="button"
                        className="btn btn-line havale-kopyala"
                        onClick={() => void copy(temizIban)}
                      >
                        {copied === temizIban ? 'Kopyalandı' : 'IBAN kopyala'}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
            {/*
              KISA ÖDEME KODU (2026-09-21 kullanıcı isteği: "açıklama kısmına sipariş no
              çok uzun, daha kısa bir şey bul").

              Sipariş numarası 15 hane (`S26092103181284`). Müşteri bunu banka uygulamasında
              açıklama kutusuna ELLE yazıyor; uzun olduğu için ya yanlış yazıyor ya da hiç
              yazmıyor, o zaman ödeme siparişle eşleşmiyor ve bayi elle arıyor.

              Kısa kod = sipariş numarasının SON 6 HANESİ. Türetilmiş olduğu için ayrıca
              saklanmıyor ve eski siparişlerde de çalışıyor; panel açık havale listesinde
              aynı kodu gösteriyor, personel banka ekstresindekiyle birebir karşılaştırıyor.
              Tam numara yine yazılı duruyor (küçük puntoda) — bankaya uzun açıklama yazmayı
              tercih eden ya da telefonla teyit isteyen müşteri için.
            */}
            <div className="havale-kod">
              <span className="havale-kod-etiket">Açıklamaya şunu yazın</span>
              <div className="havale-kod-satir">
                <strong className="havale-kod-deger num">{kisaKod}</strong>
                <button
                  type="button"
                  className="btn btn-line"
                  style={{ height: 32, fontSize: 12 }}
                  onClick={() => void copy(kisaKod)}
                >
                  {copied === kisaKod ? 'Kopyalandı' : 'Kodu kopyala'}
                </button>
              </div>
              <span className="havale-kod-not">
                Sipariş no: <span className="num">{orderNo}</span> · Tutar tam olarak{' '}
                <strong className="num">{amountText}</strong> olmalı.
              </span>
            </div>
          </div>

          {requested && (
            <>
              <p className="auth-lede" style={{ marginTop: 14 }}>
                Havaleyi gönderdiniz mi? Aşağıdaki düğmeye basın, hesabımıza ulaşınca siparişinizi onaylayıp SMS ile haber vereceğiz.
                {timeoutHours > 0 && <> Bildirim gelmezse sipariş {timeoutHours} saat sonra kendiliğinden iptal olur.</>}
              </p>
              {error && <div className="auth-error">{error}</div>}
              <button className="btn btn-dark" type="button" disabled={busy} onClick={() => void markSent()}>
                {busy ? 'Kaydediliyor…' : 'Gönderdim'}
              </button>
            </>
          )}

          {sent && (
            <div className="bank-transfer-box" style={{ marginTop: 14 }}>
              <span className="bank-transfer-status">Bildiriminiz alındı — onay bekliyor</span>
              <p style={{ marginBottom: 0 }}>Ödemeniz hesabımıza ulaştığında siparişiniz onaylanacak ve SMS alacaksınız.</p>
            </div>
          )}
        </>
      )}
    </div>
  )
}
