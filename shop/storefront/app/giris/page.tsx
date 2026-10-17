import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import AuthForm from '@/components/AuthForm'
import { getStorefront } from '@/lib/api'
import { resolveCompanyInfo } from '@/lib/companyInfo'
import { safeReturnPath } from '@/lib/returnPath'
import { currentMember } from '@/lib/session'

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ donus?: string }>
}): Promise<Metadata> {
  // Sekme başlığı da aynı ayrımı yapıyor: ödeme akışındaki müşteri sekmede "Giriş Yap"
  // görmemeli, çünkü yaptığı iş giriş değil sipariş.
  const { donus } = await searchParams
  const hedef = safeReturnPath(donus)
  const siparisIcin = hedef.startsWith('/odeme') || hedef.startsWith('/sepet')
  return {
    title: siparisIcin ? 'Siparişi Tamamlayın' : 'Giriş Yap',
    robots: { index: false, follow: true },
  }
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ donus?: string; yontem?: string }>
}) {
  const params = await searchParams
  // Doğrulama burada yapılıyor ki hem yönlendirmede hem "üye ol" bağlantısında aynı güvenli
  // değer kullanılsın; ham değeri iki yere taşımak, birinde kontrolü atlamanın yolu olurdu.
  const returnTo = safeReturnPath(params.donus)

  if (await currentMember()) redirect(returnTo)

  /*
    ŞİFRELİ GİRİŞ VARSAYILAN, KOD YOK (2026-10-05 kullanıcı isteği: "girişlerde kod zorunlu
    olmasın, direkt şifre — telefon veya mail şifre kombinasyonları ile giriş yapılabilsin").
    SMS sağlayıcısı kod ulaştıramıyordu; SMS'le giriş ekranı kaldırıldı. Yeni sağlayıcı gelince
    yeniden eklenebilir (PhoneLogin bileşeni duruyor).

    HIZ: sayfa artık SMS durumunu sormuyor; ekrana gelmeden önce mağaza API'sine giden tek
    istek oturum kontrolü (ayarlar önbellekli).
  */

  /*
    SİPARİŞ İÇİN GELEN MÜŞTERİYE "GİRİŞ YAP" DEME (2026-09-21 kullanıcı isteği). Başlık ve
    metin nereden gelindiğine göre değişiyor; `donus` ödeme/sepet ise sipariş dili.
  */
  const siparisIcin = returnTo.startsWith('/odeme') || returnTo.startsWith('/sepet')
  const company = resolveCompanyInfo(await getStorefront().catch(() => null))
  const telDijit = company.phone.replace(/(?!^\+)[^\d]/g, '')

  return (
    <div className="wrap">
      <div className="auth-page">
        <div className="auth-card">
          <h1>{siparisIcin ? 'Siparişi tamamlayın' : 'Giriş yap'}</h1>
          <p className="auth-lede">
            {siparisIcin
              ? 'Telefon numaranız (ya da e-postanız) ve şifrenizle girin. Üye değilseniz ödeme sayfasında "Üye olmadan devam et" ile sipariş verebilirsiniz.'
              : 'Telefon numaranız ya da e-posta adresiniz ve şifrenizle girin.'}
          </p>
          <AuthForm mode="login" returnTo={returnTo} />
          <p className="auth-alt">
            Hesabınız yok mu?{' '}
            <Link href={`/uye-ol?donus=${encodeURIComponent(returnTo)}`}>Hemen üye olun</Link>
          </p>
          {siparisIcin && (
            <p className="auth-alt">
              <Link href="/odeme?yol=misafir">Üye olmadan devam et</Link>
            </p>
          )}
          <p className="auth-help">
            Şifrenizi bilmiyor musunuz? <Link href="/sifremi-unuttum">Şifremi unuttum</Link> ya da{' '}
            <a href={`tel:${telDijit}`}>{company.phone}</a> numarasından bizi arayın, hemen yenileyelim.
          </p>
        </div>
      </div>
    </div>
  )
}
