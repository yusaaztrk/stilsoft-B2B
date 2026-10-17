import type { Metadata } from 'next'
import Link from 'next/link'
import LegalPage, { SellerTable, loadSeller } from '@/components/LegalPage'

export const metadata: Metadata = {
  title: 'Gizlilik Politikası',
  description:
    'STILSOFT DEMO internet sitesinde hangi bilgileri topladığımız, neden topladığımız ve nasıl koruduğumuz.',
  alternates: { canonical: '/gizlilik' },
  robots: { index: true, follow: true },
}

export default async function Page() {
  const seller = await loadSeller()

  return (
    <LegalPage
      title="Gizlilik Politikası"
      lede="Bu sayfa, sitemizi kullanırken hangi bilgilerinizi topladığımızı, neden topladığımızı ve nasıl koruduğumuzu anlatır."
      updated="8 Ağustos 2026"
      seller={seller}
    >
      <h2>1. Veri sorumlusu</h2>
      <SellerTable seller={seller} />

      <h2>2. Topladığımız bilgiler</h2>
      <table className="legal-table">
        <thead>
          <tr><th>Bilgi</th><th>Neden</th></tr>
        </thead>
        <tbody>
          <tr>
            <td>Ad soyad, e-posta, telefon</td>
            <td>Üyelik hesabınızın açılması, siparişinizin size ulaştırılması ve gerektiğinde size ulaşabilmemiz.</td>
          </tr>
          <tr>
            <td>Adres, şehir, bölge</td>
            <td>Siparişin teslim edileceği yerin belirlenmesi ve faturanın düzenlenmesi.</td>
          </tr>
          <tr>
            <td>Sipariş ve fatura kayıtları</td>
            <td>Satışın yasal kaydının tutulması, garanti ve servis süreçleri.</td>
          </tr>
          <tr>
            <td>Ödeme sonucu (tutar, onay kodu, kartın ilk 6 / son 4 hanesi)</td>
            <td>Tahsilatın siparişle eşleştirilmesi ve muhasebe mutabakatı.</td>
          </tr>
          <tr>
            <td>Sipariş işlem kaydı (hangi adımın ne zaman yapıldığı, bağlantı adresi)</td>
            <td>
              Ödeme anlaşmazlıklarının çözülmesi ve kötüye kullanımın engellenmesi. Bu kayıt
              olmadan "ödeme yaptım ama görünmüyor" gibi durumlar çözülemez.
            </td>
          </tr>
        </tbody>
      </table>

      <h2>3. Kart bilgileriniz</h2>
      <p>
        <b>Kart numaranız, son kullanma tarihiniz ve güvenlik kodunuz hiçbir şekilde
        saklanmaz.</b> Bu bilgiler yalnızca ödemenin yapılabilmesi için bankanın 3D Secure
        sistemine iletilir; sunucularımızda tutulmaz, kayıt dosyalarına yazılmaz ve personelimiz
        tarafından görülemez.
      </p>
      <p>
        Şifreniz de okunabilir biçimde saklanmaz: geri döndürülemeyen bir özet (PBKDF2-SHA256)
        olarak tutulur. Şifrenizi biz de göremeyiz.
      </p>

      <h2>4. Bilgilerinizi kimlerle paylaşıyoruz</h2>
      <ul>
        <li>
          <b>Bankalar / ödeme kuruluşları:</b> ödemenin gerçekleşmesi için, yalnızca işlem
          için gerekli olan kadarıyla.
        </li>
        <li>
          <b>Teslimat ekibimiz:</b> siparişin ulaştırılabilmesi için ad, adres ve telefon.
        </li>
        <li>
          <b>Yetkili kamu kurumları:</b> yalnızca mevzuatın gerektirdiği hallerde ve
          gerektirdiği kadarıyla.
        </li>
      </ul>
      <p>
        Bilgilerinizi <b>pazarlama amacıyla üçüncü kişilere satmıyoruz veya kiralamıyoruz.</b>
      </p>

      <h2>5. Ne kadar süre saklıyoruz</h2>
      <p>
        Sipariş, fatura ve tahsilat kayıtları, mevzuatın öngördüğü saklama süresi boyunca
        tutulur. Üyelik bilgileriniz hesabınız açık kaldığı sürece saklanır; hesabınızın
        kapatılmasını istediğinizde, yasal saklama yükümlülüğü bulunan kayıtlar dışındaki
        bilgileriniz silinir.
      </p>

      <h2>6. Haklarınız</h2>
      <p>
        Hakkınızda tuttuğumuz bilgileri öğrenme, yanlış olanların düzeltilmesini isteme,
        yasal saklama yükümlülüğü kalmamış bilgilerinizin silinmesini talep etme hakkınız
        vardır. Adres ve iletişim bilgilerinizi <b>Hesabım</b> ekranından kendiniz
        güncelleyebilirsiniz. Diğer talepleriniz için yukarıdaki iletişim bilgilerinden bize
        ulaşabilirsiniz.
      </p>

      <h2>7. Çerezler</h2>
      <p>
        Sitede yalnızca oturumunuzun açık kalması için zorunlu çerez kullanılıyor. Ayrıntı için{' '}
        <Link href="/cerez">Çerez Politikası</Link> sayfasına bakınız.
      </p>

      <h2>8. Değişiklikler</h2>
      <p>
        Bu politikada değişiklik yapıldığında güncel metin bu sayfada yayımlanır ve sayfanın
        başındaki güncelleme tarihi değişir.
      </p>
    </LegalPage>
  )
}
