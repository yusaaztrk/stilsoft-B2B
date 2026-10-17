import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { displayName, formatPrice } from '@/lib/format'
import { formatDate, listInvoices } from '@/lib/account'
import { loginWithReturn } from '@/lib/returnPath'
import { currentMember } from '@/lib/session'

export const metadata: Metadata = {
  title: 'Faturalarım',
  robots: { index: false, follow: false },
}

export default async function InvoicesPage() {
  const member = await currentMember()
  if (!member) redirect(loginWithReturn('/hesabim/faturalarim'))

  const invoices = await listInvoices()

  return (
    <div className="wrap">
      <div className="crumbs">
        <Link href="/hesabim">Hesabım</Link>
        <span>›</span>
        <span>Faturalarım</span>
      </div>

      <div className="account">
        <div className="account-head">
          <div>
            <h1>Faturalarım</h1>
            <p>{invoices.length} fatura</p>
          </div>
        </div>

        {invoices.length === 0 ? (
          <div className="empty">
            <p>Henüz faturanız bulunmuyor. Fatura, siparişiniz sevkiyata hazırlanırken kesilir.</p>
            <Link className="btn btn-dark" href="/hesabim/siparislerim">
              Siparişlerim
            </Link>
          </div>
        ) : (
          <ul className="invoice-list">
            {invoices.map((invoice) => (
              <li key={invoice.invoiceNo} className="invoice-card">
                <div className="invoice-head">
                  <div>
                    <span className="order-no">{invoice.invoiceNo}</span>
                    <span className="order-date">{formatDate(invoice.date)}</span>
                  </div>
                  {invoice.orderNo && (
                    <Link className="textlink" href={`/hesabim/siparis/${encodeURIComponent(invoice.orderNo)}`}>
                      Sipariş {invoice.orderNo}
                    </Link>
                  )}
                </div>

                <div className="cart-scroll">
                  <table className="cart-table">
                    <thead>
                      <tr>
                        <th>Ürün</th>
                        <th className="center">Adet</th>
                        <th className="right">Birim Fiyat</th>
                        <th className="right">KDV</th>
                      </tr>
                    </thead>
                    <tbody>
                      {invoice.lines.map((line, index) => (
                        <tr key={`${line.stockCode}-${index}`}>
                          <td>{displayName(line.name)}</td>
                          <td className="center num">{line.quantity}</td>
                          <td className="right num">{formatPrice(line.unitPrice)}</td>
                          <td className="right num">%{line.vatRate}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <dl className="invoice-totals">
                  <dt>Ara toplam</dt>
                  <dd className="num">{formatPrice(invoice.netTotal)}</dd>
                  <dt>KDV</dt>
                  <dd className="num">{formatPrice(invoice.vatTotal)}</dd>
                  <dt className="strong">Genel toplam</dt>
                  <dd className="num strong">{formatPrice(invoice.grandTotal)}</dd>
                </dl>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
