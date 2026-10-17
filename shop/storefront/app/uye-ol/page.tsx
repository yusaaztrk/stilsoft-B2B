import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import AuthForm from '@/components/AuthForm'
import { safeReturnPath } from '@/lib/returnPath'
import { currentMember } from '@/lib/session'

export const metadata: Metadata = {
  title: 'Üye Ol',
  description: 'STILSOFT DEMO mağazasına üye olun; siparişlerinizi ve faturalarınızı tek yerden takip edin.',
  robots: { index: false, follow: true },
}

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ donus?: string; yontem?: string }>
}) {
  const params = await searchParams
  const returnTo = safeReturnPath(params.donus)

  if (await currentMember()) redirect(returnTo)

  return (
    <div className="wrap">
      <div className="auth-page">
        <div className="auth-card">
          <h1>Üye ol</h1>
          {/* Muhasebe dili ("cari hesap açılır") müşteriyi ürkütüyordu — 2026-10-04 kullanıcı kararıyla kaldırıldı. */}
          <p className="auth-lede">
            Bir dakikada üye olun; siparişinizi ve teslimat durumunu tek yerden takip edin.
          </p>

          {/*
            KODSUZ ÜYELİK (2026-10-05 kullanıcı isteği: "kod gönder kısmını kaldır, koda gerek yok,
            direkt üye olabilelim"). Tek form: ad, telefon, şifre, adres; e-posta isteğe bağlı.
            SMS kodu adımı ve "telefonla hızlı üyelik" bağlantısı kaldırıldı — SMS sağlayıcısı kod
            ulaştıramıyordu. `yontem` parametresi eski bağlantılar kırılmasın diye yok sayılıyor.
          */}
          <AuthForm mode="register" returnTo={returnTo} />

          <p className="auth-alt">
            Hesabınız var mı? <Link href={`/giris?donus=${encodeURIComponent(returnTo)}`}>Giriş yapın</Link>
          </p>
        </div>
      </div>
    </div>
  )
}
