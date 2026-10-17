import type { Metadata } from 'next'
import Link from 'next/link'
import LegalPage, { loadSeller } from '@/components/LegalPage'

export const metadata: Metadata = {
  title: 'Teslimat, Kurulum ve İade',
  description:
    'KKTC geneline kendi ekibimizle ücretsiz teslimat ve kurulum. Siparişinizin hangi aşamada olduğunu Hesabım ekranından takip edebilirsiniz.',
  alternates: { canonical: '/teslimat' },
  robots: { index: true, follow: true },
}

export default async function Page() {
  const seller = await loadSeller()

  return (
    <LegalPage
      title="Teslimat, Kurulum ve İade"
      lede="Siparişinizin size nasıl ulaştığı, kurulumun nasıl yapıldığı ve bir sorun çıktığında ne yapmanız gerektiği."
      updated="8 Ağustos 2026"
    >
      <h2>Teslimat</h2>
      <ul>
        <li>Teslimat KKTC geneline <b>kendi ekibimizle</b> yapılır.</li>
        <li><b>Teslimat ücreti alınmaz.</b></li>
        <li>
          Sipariş ödendikten sonra sevkiyat hazırlanır. Sevkiyat için fatura düzenlendiğinde
          teslimat kaydınız açılır ve takip başlar.
        </li>
        <li>
          Teslimat öncesinde ekibimiz size telefonla ulaşır; adreste bulunacağınız bir zaman
          birlikte belirlenir.
        </li>
      </ul>

      <h2>Siparişimi nasıl takip ederim?</h2>
      <p>
        <Link href="/hesabim/siparislerim">Hesabım → Siparişlerim</Link> ekranından siparişinize
        tıklayın. Teslimat çizelgesi beş aşamayı gösterir:
      </p>
      <table className="legal-table">
        <tbody>
          <tr><th>Siparişiniz alındı</th><td>Sevkiyat kaydı açıldı.</td></tr>
          <tr><th>Planlandı</th><td>Teslimat için gün belirlendi.</td></tr>
          <tr><th>Hazırlanıyor</th><td>Ürün depoda hazırlanıyor.</td></tr>
          <tr><th>Dağıtımda</th><td>Ürün yola çıktı.</td></tr>
          <tr><th>Teslim edildi</th><td>Ürün teslim alındı.</td></tr>
        </tbody>
      </table>
      <p>
        Ödemesi tamamlanmış ama henüz sevkiyata çıkmamış siparişler <b>"Hazırlanıyor"</b> olarak
        görünür — bu normaldir, bir hata değildir.
      </p>

      <h2>Kurulum</h2>
      <p>
        Kurulum gerektiren ürünlerde montaj yetkili ekibimizce yapılır. Ankastre ürünlerde
        mobilya ölçülerinin ürüne uygun olması gerekir; uygun olmayan bir dolapta kurulum
        yapılamaz. Elektrik ve su tesisatının hazır olması sizin sorumluluğunuzdadır.
      </p>

      <h2>Teslim alırken nelere dikkat etmeliyim?</h2>
      <ul>
        <li>Ambalajı teslim almadan önce kontrol edin.</li>
        <li>
          Ezik, yırtık veya ıslaklık gördüğünüzde <b>teslim almadan önce</b> ekibimize bildirin.
          Teslim alındıktan sonra fark edilen nakliye hasarlarında işlem yapmak güçleşir.
        </li>
        <li>Fatura ürünle birlikte gelir; garanti işlemlerinde gerekeceği için saklayın.</li>
      </ul>

      <h2>İade ve iptal</h2>
      <p>
        Siparişinizle ilgili bir sorun olduğunda önce bizimle irtibata geçin — telefon{' '}
        <b>{seller.phone}</b>. Talebiniz duruma göre değerlendirilir ve bir çözüme bağlanır.
      </p>
      <ul>
        <li>
          Ödemesi alınmış bir sipariş iptal edilirse iade, ödemenin yapıldığı karta yapılır.
          Tutarın kartınıza yansıma süresi bankanıza bağlıdır.
        </li>
        <li>
          Kullanılmakla değeri düşen, ambalajı açıldığında hijyen açısından iadesi uygun olmayan
          ve kişiye özel üretilen ürünlerde iade kabul edilmeyebilir.
        </li>
      </ul>

      <h2>Garanti ve servis</h2>
      <p>
        Ürünlerin garanti şartları üretici firmanın garanti belgesine tabidir. Arıza durumunda{' '}
        <Link href="/servis">servis talebi</Link> sayfasındaki bilgilerden bize ulaşabilirsiniz.
        Yetkisiz kişilerce yapılan müdahaleler garantiyi geçersiz kılar.
      </p>

      <p className="legal-links">
        İlgili sayfa: <Link href="/mesafeli-satis">Mesafeli Satış Sözleşmesi</Link>
      </p>
    </LegalPage>
  )
}
