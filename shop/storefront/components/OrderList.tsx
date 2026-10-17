import Image from 'next/image'
import Link from 'next/link'
import { displayName, formatPrice, mediaUrl } from '@/lib/format'
import { formatDate, type AccountOrder } from '@/lib/account'

/**
 * Sipariş listesi.
 *
 * Her satırda müşterinin gerçekten aradığı üç şey var: ne aldım, ne kadar ödedim, şu an ne
 * durumda. Durum rozeti ödeme + fatura gerçeğinden türetiliyor (sunucuda), burada yalnızca
 * gösteriliyor — ekranda ikinci bir "sipariş durumu" yorumu doğmasın.
 */
export default function OrderList({ orders, limit }: { orders: AccountOrder[]; limit?: number }) {
  const shown = limit ? orders.slice(0, limit) : orders

  if (shown.length === 0) {
    return (
      <div className="empty">
        <p>Henüz siparişiniz bulunmuyor.</p>
        <Link className="btn btn-dark" href="/urunler">
          Alışverişe başla
        </Link>
      </div>
    )
  }

  return (
    <ul className="order-list">
      {shown.map((order) => {
        const thumbs = order.lines.slice(0, 4)

        return (
          <li key={order.orderNo}>
            <Link href={`/hesabim/siparis/${encodeURIComponent(order.orderNo)}`} className="order-card">
              <div className="order-card-head">
                <div>
                  <span className="order-no">{order.orderNo}</span>
                  <span className="order-date">{formatDate(order.processedAt)}</span>
                </div>
                <span className={`stage stage-${order.stage}`}>{order.stageLabel}</span>
              </div>

              <div className="order-card-body">
                <div className="order-thumbs">
                  {thumbs.map((line) => {
                    const img = mediaUrl(line.imageUrl)
                    return (
                      <span className="order-thumb" key={line.stockCode}>
                        {img ? <Image src={img} alt={displayName(line.name)} width={44} height={44} /> : null}
                      </span>
                    )
                  })}
                  {order.lines.length > thumbs.length && (
                    <span className="order-thumb more">+{order.lines.length - thumbs.length}</span>
                  )}
                </div>

                <div className="order-card-total">
                  <span>{order.lines.length} ürün</span>
                  <b className="num">{formatPrice(order.grandTotal)}</b>
                </div>
              </div>

              {order.invoiceNo && (
                <div className="order-card-foot">
                  Fatura <b>{order.invoiceNo}</b> · {formatDate(order.invoiceDate)}
                </div>
              )}
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
