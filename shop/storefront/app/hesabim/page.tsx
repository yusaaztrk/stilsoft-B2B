import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import AddressManager from '@/components/AddressManager'
import ChangePasswordForm from '@/components/ChangePasswordForm'
import LogoutButton from '@/components/LogoutButton'
import OrderList from '@/components/OrderList'
import ProfileForm from '@/components/ProfileForm'
import { formatPrice } from '@/lib/format'
import { formatDate, getProfile, listInvoices, listOrders } from '@/lib/account'
import { loginWithReturn } from '@/lib/returnPath'
import { currentMember } from '@/lib/session'

export const metadata: Metadata = {
  title: 'Hesabım',
  robots: { index: false, follow: false },
}

export default async function AccountPage() {
  const member = await currentMember()
  if (!member) redirect(loginWithReturn('/hesabim'))

  const [orders, invoices, profile] = await Promise.all([listOrders(), listInvoices(), getProfile()])

  const awaitingPayment = orders.filter((x) => x.stage === 'awaiting_payment')

  // Initials for avatar
  const initials = (member.fullName || 'M')
    .split(' ')
    .map((n) => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()

  return (
    <div className="wrap account-dashboard-wrapper">
      {/* Üst Karşılama ve Profil Başlığı */}
      <div className="account-hero-card">
        <div className="account-user-profile">
          <div className="account-avatar">{initials}</div>
          <div className="account-user-meta">
            <div className="user-title-row">
              <h1>{member.fullName}</h1>
              {member.customerCode && (
                <span className="account-badge">Cari: {member.customerCode}</span>
              )}
            </div>
            <div className="user-contact-pills">
              <span>{member.email}</span>
              {member.phone && (
                <>
                  <span className="u-sep">•</span>
                  <span>{member.phone}</span>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="account-hero-actions">
          <LogoutButton />
        </div>
      </div>

      {/* Ödeme Bekleyen Sipariş Uyarısı */}
      {awaitingPayment.length > 0 && (
        <div className="account-payment-alert">
          <div className="alert-icon">⚠️</div>
          <div className="alert-text">
            <strong>Ödeme Bekleyen Siparişiniz Bulunuyor:</strong> Ödemesi henüz tamamlanmamış {awaitingPayment.length} adet siparişiniz mevcut.
          </div>
          <Link
            href={`/hesabim/siparis/${encodeURIComponent(awaitingPayment[0].orderNo)}`}
            className="btn btn-dark btn-sm"
          >
            Siparişi Görüntüle &amp; Öde
          </Link>
        </div>
      )}

      {/* 1. BÖLÜM: KAYITLI ADRESLERİM */}
      <section className="account-box">
        <div className="account-box-body">
          <AddressManager />
        </div>
      </section>

      {/* 2. BÖLÜM: PROFİL & ŞİFRE BİLGİLERİ */}
      <div className="account-dashboard-grid">
        {/* SOL: Profil ve İletişim Bilgileri */}
        <section className="account-box">
          <div className="account-box-header">
            <div>
              <h2>Hesap &amp; İletişim Bilgileri</h2>
              <p>Sipariş teslimatında ve faturanızda kullanılacak profil bilgilerinizi güncelleyin.</p>
            </div>
          </div>

          <div className="account-box-body">
            <div className="account-fixed-meta-grid">
              <div className="f-meta-item">
                <span className="f-meta-label">Kayıtlı E-Posta</span>
                <span className="f-meta-val">{member.email}</span>
              </div>
              <div className="f-meta-item">
                <span className="f-meta-label">Müşteri / Cari Kodu</span>
                <span className="f-meta-val num">{member.customerCode || 'Bireysel Müşteri'}</span>
              </div>
            </div>

            <div className="form-divider" />

            {profile ? (
              <ProfileForm profile={profile} />
            ) : (
              <div className="account-fixed-meta-grid">
                <div className="f-meta-item">
                  <span className="f-meta-label">Ad Soyad</span>
                  <span className="f-meta-val">{member.fullName}</span>
                </div>
                <div className="f-meta-item">
                  <span className="f-meta-label">Telefon</span>
                  <span className="f-meta-val">{member.phone || '—'}</span>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* SAĞ: Şifre Değiştir ve Faturalar */}
        <div className="account-right-stack">
          {/* Şifre Değiştir */}
          <section className="account-box">
            <div className="account-box-header">
              <div>
                <h2>Şifre &amp; Hesap Güvenliği</h2>
                <p>Hesabınızın güvenliği için parolanızı belirli aralıklarla güncelleyin.</p>
              </div>
            </div>

            <div className="account-box-body">
              <ChangePasswordForm />
            </div>
          </section>

          {/* Faturalarım */}
          <section className="account-box">
            <div className="account-box-header">
              <div>
                <h2>Faturalarım</h2>
                <p>Adınıza düzenlenen son e-fatura kayıtları.</p>
              </div>
              {invoices.length > 0 && (
                <Link className="textlink-sm" href="/hesabim/faturalarim">
                  Tümünü Gör ({invoices.length})
                </Link>
              )}
            </div>

            <div className="account-box-body">
              {invoices.length === 0 ? (
                <div className="empty-sub-card">
                  <p>Henüz adınıza kesilmiş bir fatura bulunmuyor.</p>
                </div>
              ) : (
                <div className="invoices-mini-list">
                  {invoices.slice(0, 3).map((invoice) => (
                    <div key={invoice.invoiceNo} className="invoice-mini-row">
                      <div className="inv-left">
                        <span className="inv-no">{invoice.invoiceNo}</span>
                        <span className="inv-date">{formatDate(invoice.date)}</span>
                      </div>
                      <span className="inv-price num">{formatPrice(invoice.grandTotal)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        </div>
      </div>

      {/* 3. BÖLÜM: SON SİPARİŞLERİM */}
      <section className="account-box account-orders-box">
        <div className="account-box-header">
          <div>
            <h2>Son Siparişlerim</h2>
            <p>Geçmiş ve devam eden tüm siparişlerinizin durumunu takip edin.</p>
          </div>
          {orders.length > 3 && (
            <Link className="textlink-sm" href="/hesabim/siparislerim">
              Tüm Siparişlerim ({orders.length}) →
            </Link>
          )}
        </div>

        <div className="account-box-body">
          <OrderList orders={orders} limit={4} />
        </div>
      </section>
    </div>
  )
}
