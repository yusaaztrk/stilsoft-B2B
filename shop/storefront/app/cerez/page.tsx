import type { Metadata } from 'next'
import Link from 'next/link'
import LegalPage from '@/components/LegalPage'

export const metadata: Metadata = {
  title: 'Çerez Politikası',
  description:
    'Sitemizde hangi çerezleri kullanıyoruz ve neden. Takip ve reklam çerezi kullanılmamaktadır.',
  alternates: { canonical: '/cerez' },
  robots: { index: true, follow: true },
}

export default function Page() {
  return (
    <LegalPage
      title="Çerez Politikası"
      lede="Bu sayfa, sitemizde hangi çerezlerin kullanıldığını ve neden kullanıldığını anlatır."
      updated="8 Ağustos 2026"
    >
      <h2>Kısa cevap</h2>
      <p>
        Sitemizde <b>yalnızca zorunlu çerez</b> kullanılıyor. Reklam çerezi, takip pikseli,
        üçüncü taraf analiz aracı ve sosyal medya izleyicisi <b>kullanılmamaktadır</b>.
      </p>

      <h2>Kullanılan çerezler</h2>
      <table className="legal-table">
        <thead>
          <tr><th>Çerez</th><th>Amaç</th><th>Süre</th><th>Tür</th></tr>
        </thead>
        <tbody>
          <tr>
            <td><code>shop_session</code></td>
            <td>
              Giriş yaptıktan sonra oturumunuzun açık kalması. Bu çerez olmadan her sayfada
              yeniden giriş yapmanız gerekirdi; sepetiniz ve siparişleriniz size bağlanamazdı.
            </td>
            <td>30 gün</td>
            <td>Zorunlu</td>
          </tr>
        </tbody>
      </table>

      <h2>Bu çerez nasıl korunuyor</h2>
      <ul>
        <li>
          <b>httpOnly:</b> çerez, sayfadaki JavaScript kodu tarafından okunamaz. Siteye
          bulaşabilecek bir betiğin oturumunuzu çalması bu şekilde engellenir.
        </li>
        <li>
          <b>sameSite:</b> başka bir sitenin sizin adınıza istek göndermesi engellenir.
        </li>
        <li>
          <b>secure:</b> yayında yalnızca şifreli bağlantı (https) üzerinden gönderilir.
        </li>
        <li>
          Çerezin içinde kişisel bilginiz yoktur; yalnızca sunucudaki oturum kaydına işaret eden
          tahmin edilemez bir anahtar taşır. Çıkış yaptığınızda bu kayıt silinir.
        </li>
      </ul>

      <h2>Onay gerekiyor mu?</h2>
      <p>
        Zorunlu çerezler, hizmetin çalışabilmesi için gereklidir ve ayrı bir onay
        gerektirmez. Reklam veya analiz çerezi kullanılmaya başlanırsa bu sayfa güncellenir ve
        onayınız ayrıca alınır.
      </p>

      <h2>Çerezi silmek</h2>
      <p>
        Tarayıcınızın ayarlarından çerezleri silebilir veya engelleyebilirsiniz. Bu durumda
        oturumunuz kapanır ve giriş yapmanız gereken sayfaları kullanamazsınız.
      </p>

      <p className="legal-links">
        İlgili sayfalar: <Link href="/gizlilik">Gizlilik Politikası</Link> ·{' '}
        <Link href="/kvkk">Kişisel Verilerin Korunması</Link>
      </p>
    </LegalPage>
  )
}
