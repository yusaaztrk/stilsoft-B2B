import type { Metadata } from 'next'
import ForgotPasswordForm from '@/components/ForgotPasswordForm'
import { getSmsStatus, getStorefront } from '@/lib/api'
import { resolveCompanyInfo } from '@/lib/companyInfo'

export const metadata: Metadata = {
  title: 'Şifremi Unuttum',
  // Metin SMS'ten söz ETMİYOR: `metadata` sabit bir dışa aktarım, çalışma anındaki
  // "SMS açık mı" bayrağını göremiyor. Kapalıyken var olmayan bir yolu vaat etmesin.
  description: 'STILSOFT DEMO hesabınızın şifresini yenileyin.',
  robots: { index: false, follow: true },
}

/*
  HER İSTEKTE YENİDEN ÜRETİLİYOR (2026-09-21) — CANLIDA DURAN HATANIN KÖKÜ.

  Bu sayfanın SMS sekmesini gösterip göstermeyeceğine `getSmsStatus()` karar veriyor. Sayfada
  hiçbir dinamik işaret olmadığı için Next onu DERLEME ANINDA üretiyordu: `prerender-manifest`
  içinde `/sifremi-unuttum` statik olarak listeleniyor. Derleme kendi bilgisayarımızda
  yapılıyor ve oradan canlı mağaza API'sine ulaşılamıyor; `getSmsStatus()` yedek değeri
  (`enabled: false`) döndürüyor ve sayfa "SMS kapalı" hâliyle PAKETE GİRİYOR.

  Sonuç canlıda görülen tabloydu: giriş ekranı telefonla girişi gösterirken (`/giris` dinamik,
  çünkü `searchParams` okuyor) şifre sıfırlamada telefon seçeneği hiç çıkmıyordu.

  `force-dynamic` bu kararı istek anına taşıyor. Maliyeti yok: sayfa zaten `noindex`,
  arama motoru için önbelleğe alınmasının bir faydası bulunmuyor.
*/
export const dynamic = 'force-dynamic'

/**
 * Sayfa SUNUCU bileşeni, form istemci bileşeni.
 *
 * Sebep: SMS seçeneğinin gösterilip gösterilmeyeceği sunucudan geliyor (`sms-status`). Tarayıcıdan
 * sorulsaydı sekmeler bir an görünüp kaybolur ya da tersi olurdu.
 */
export default async function ForgotPasswordPage() {
  const [sms, settings] = await Promise.all([getSmsStatus(), getStorefront().catch(() => null)])
  const company = resolveCompanyInfo(settings)
  const telDijit = company.phone.replace(/(?!^\+)[^\d]/g, '')

  return (
    <div className="wrap">
      <div className="auth-page">
        <div className="auth-card">
          <h1>Şifremi Unuttum</h1>
          <p className="auth-lede">
            {sms.enabled
              ? 'Hesabınızı e-posta adresinizle ya da kayıtlı cep telefonunuzla doğrulayıp yeni şifre belirleyebilirsiniz.'
              : 'Kayıtlı e-posta adresinizi girin, şifrenizi yenilemeniz için size bir bağlantı gönderelim.'}
          </p>

          <ForgotPasswordForm smsEnabled={sms.enabled} />

          {/*
            BİZİ ARAYIN YOLU (2026-10-05): SMS sağlayıcısı kod ulaştıramıyor; telefonla üye olanların
            e-postası da yok. Mağaza şifreyi B2B → E-Ticaret → Üyeler → "Şifre değiştir" ile hemen
            yenileyebiliyor.
          */}
          <p className="auth-help">
            E-posta ya da SMS gelmedi mi? <a href={`tel:${telDijit}`}>{company.phone}</a> numarasından bizi
            arayın; şifrenizi hemen yenileyelim.
          </p>
        </div>
      </div>
    </div>
  )
}
