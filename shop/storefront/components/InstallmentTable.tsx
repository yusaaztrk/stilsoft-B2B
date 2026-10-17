import type { InstallmentInfo } from '@/lib/api'
import { formatPrice } from '@/lib/format'

/*
  TAKSİT SEÇENEKLERİ (2026-09-21) — ürün sayfasında fiyatın hemen altında.

  Kıbrıs'ta 18.000 TL'lik fırının ilk sorusu "kaç taksit?". Vitrin "bankanıza göre taksit"
  diyordu; müşteri cevabı öğrenmek için kart numarasını girip ödeme adımına kadar gelmek
  zorundaydı. Kurallar ERP'de zaten var; burada aynı kurallar gösteriliyor, ödeme adımında
  kart numarasına göre aynısı uygulanıyor — vaat ile tahsilat birbirini tutuyor.

  Kural yoksa (banka tanımı girilmemiş) blok HİÇ görünmez; uydurma "12 taksit" yazılmaz.
*/
export default function InstallmentTable({ info, currency = 'TRY' }: { info: InstallmentInfo; currency?: string }) {
  if (!info || info.maxInstallment < 2 || info.banks.length === 0) return null

  const enDusukAylik = Math.min(
    ...info.banks.flatMap((b) => b.options.map((o) => o.monthly ?? Number.POSITIVE_INFINITY)),
  )

  return (
    <details className="pdp-installments">
      <summary>
        <span className="pdp-installments-title">
          <b>{info.maxInstallment} taksite</b> kadar
          {Number.isFinite(enDusukAylik) && <> · ayda <b className="num">{formatPrice(enDusukAylik, currency)}</b>&apos;den başlayan</>}
        </span>
        <span className="pdp-installments-more">Bankaları gör</span>
      </summary>
      <table>
        <tbody>
          {info.banks.map((b) => (
            <tr key={b.bankCode}>
              <th>{b.bankName}</th>
              <td>
                {b.options.map((o) => (
                  <span key={o.count} className="pdp-installment-chip">
                    {o.text}{o.monthly ? <> · <span className="num">{formatPrice(o.monthly, currency)}</span>/ay</> : null}
                  </span>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>Vade farksız; kartınızın bankasına göre ödeme adımında aynı seçenekler sunulur. Havale/EFT ile de ödeyebilirsiniz.</p>
    </details>
  )
}
