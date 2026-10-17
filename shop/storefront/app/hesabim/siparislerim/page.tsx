import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import OrderList from '@/components/OrderList'
import { listOrders } from '@/lib/account'
import { loginWithReturn } from '@/lib/returnPath'
import { currentMember } from '@/lib/session'

export const metadata: Metadata = {
  title: 'Siparişlerim',
  robots: { index: false, follow: false },
}

export default async function OrdersPage() {
  const member = await currentMember()
  if (!member) redirect(loginWithReturn('/hesabim/siparislerim'))

  const orders = await listOrders()

  return (
    <div className="wrap">
      <div className="crumbs">
        <Link href="/hesabim">Hesabım</Link>
        <span>›</span>
        <span>Siparişlerim</span>
      </div>

      <div className="account">
        <div className="account-head">
          <div>
            <h1>Siparişlerim</h1>
            <p>{orders.length} sipariş</p>
          </div>
        </div>

        <OrderList orders={orders} />
      </div>
    </div>
  )
}
