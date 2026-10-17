import type { Metadata } from 'next'
import Link from 'next/link'
import LegalPage, { SellerTable, loadSeller } from '@/components/LegalPage'

export const metadata: Metadata = {
  title: 'Kişisel Verilerin Korunması',
  description:
    'KKTC Kişisel Verilerin Korunması mevzuatı kapsamında aydınlatma metni: hangi veriler, hangi amaçla işleniyor ve haklarınız neler.',
  alternates: { canonical: '/kvkk' },
  robots: { index: true, follow: true },
}

export default async function Page() {
  const seller = await loadSeller()

  return (
    <LegalPage
      title="Kişisel Verilerin Korunması — Aydınlatma Metni"
      lede="Kuzey Kıbrıs Türk Cumhuriyeti kişisel verilerin korunması mevzuatı kapsamında, verilerinizin hangi amaçla ve hangi hukuki sebeple işlendiğini açıklar."
      updated="8 Ağustos 2026"
      seller={seller}
    >
      <h2>1. Veri sorumlusu</h2>
      <SellerTable seller={seller} />

      <h2>2. İşleme amacı ve hukuki sebebi</h2>
      <table className="legal-table">
        <thead>
          <tr><th>Amaç</th><th>Hukuki sebep</th></tr>
        </thead>
        <tbody>
          <tr>
            <td>Üyelik hesabının açılması ve yönetilmesi</td>
            <td>Sözleşmenin kurulması ve ifası</td>
          </tr>
          <tr>
            <td>Siparişin alınması, ödemenin tahsili, ürünün teslimi</td>
            <td>Sözleşmenin ifası</td>
          </tr>
          <tr>
            <td>Fatura düzenlenmesi ve muhasebe kayıtlarının tutulması</td>
            <td>Hukuki yükümlülük</td>
          </tr>
          <tr>
            <td>Garanti ve satış sonrası servis</td>
            <td>Sözleşmenin ifası ve hukuki yükümlülük</td>
          </tr>
          <tr>
            <td>Ödeme uyuşmazlıklarının çözülmesi, sahtecilik ve kötüye kullanımın önlenmesi</td>
            <td>Meşru menfaat</td>
          </tr>
        </tbody>
      </table>

      <h2>3. Toplama yöntemi</h2>
      <p>
        Verileriniz, siteye üye olurken ve sipariş verirken doğrudan sizin girdiğiniz bilgilerden
        ve sistemin sipariş akışı sırasında ürettiği kayıtlardan (sipariş numarası, ödeme sonucu,
        teslimat durumu) elektronik ortamda toplanır. Çağrı merkezi kaydı, konum takibi ve
        profilleme yapılmaz.
      </p>

      <h2>4. Aktarım</h2>
      <p>
        Verileriniz; ödemenin gerçekleşmesi için bankalara/ödeme kuruluşlarına, teslimatın
        yapılabilmesi için kendi teslimat ekibimize ve mevzuatın gerektirdiği hallerde yetkili
        kamu kurumlarına, <b>yalnızca ilgili amaçla sınırlı olarak</b> aktarılır. Yurt dışına
        veri aktarımı yapılmamaktadır.
      </p>

      <h2>5. Saklama süresi</h2>
      <p>
        Sipariş, fatura ve tahsilat kayıtları mevzuatın öngördüğü süre boyunca; üyelik bilgileri
        hesabınız açık kaldığı sürece saklanır. Süre dolduğunda veriler silinir veya
        anonimleştirilir.
      </p>

      <h2>6. Haklarınız</h2>
      <ul>
        <li>Kişisel verilerinizin işlenip işlenmediğini öğrenme,</li>
        <li>İşlenmişse buna ilişkin bilgi talep etme,</li>
        <li>İşleme amacını ve amacına uygun kullanılıp kullanılmadığını öğrenme,</li>
        <li>Yurt içinde verilerin aktarıldığı üçüncü kişileri bilme,</li>
        <li>Eksik veya yanlış işlenmişse düzeltilmesini isteme,</li>
        <li>Şartları oluştuğunda silinmesini veya yok edilmesini isteme,</li>
        <li>İşlemenin hukuka aykırı olması nedeniyle zarara uğramanız halinde zararın giderilmesini talep etme.</li>
      </ul>
      <p>
        Taleplerinizi yukarıdaki iletişim bilgilerinden yazılı olarak iletebilirsiniz. Ad, adres
        ve telefon bilgilerinizi <Link href="/hesabim">Hesabım</Link> ekranından kendiniz
        güncelleyebilirsiniz.
      </p>

      <h2>7. Güvenlik</h2>
      <p>
        Şifreniz geri döndürülemeyen bir özet olarak saklanır; kart bilgileriniz hiçbir şekilde
        kaydedilmez. Ödeme işlemleri 3D Secure ile yapılır ve ödeme sonucunun doğruluğu bankanın
        imzasıyla doğrulanır.
      </p>
    </LegalPage>
  )
}
