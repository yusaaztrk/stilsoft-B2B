import type { Metadata } from 'next'
import LegalPage, { SellerTable, loadSeller } from '@/components/LegalPage'

export const metadata: Metadata = {
  title: 'Mesafeli Satış Sözleşmesi',
  description:
    'STILSOFT DEMO internet sitesi üzerinden yapılan satışlara ilişkin mesafeli satış sözleşmesi.',
  alternates: { canonical: '/mesafeli-satis' },
  robots: { index: true, follow: true },
}

export default async function Page() {
  const seller = await loadSeller()

  return (
    <LegalPage
      title="Mesafeli Satış Sözleşmesi"
      lede="Bu sözleşme, internet sitemizden verdiğiniz siparişlerde tarafların hak ve yükümlülüklerini düzenler. Siparişi onayladığınızda sözleşmeyi okuduğunuzu ve kabul ettiğinizi beyan etmiş olursunuz."
      updated="8 Ağustos 2026"
      seller={seller}
    >
      <h2>1. Taraflar</h2>
      <p><b>Satıcı</b></p>
      <SellerTable seller={seller} />
      <p>
        <b>Alıcı:</b> Siteye üye olurken ve sipariş verirken bildirdiğiniz ad, adres ve
        iletişim bilgileri esas alınır. Sipariş yalnızca üyelere açıktır; misafir alışverişi
        yapılamaz.
      </p>

      <h2>2. Sözleşmenin konusu</h2>
      <p>
        Sözleşmenin konusu, Alıcı'nın siteden elektronik ortamda sipariş verdiği, nitelikleri ve
        satış fiyatı sipariş sayfasında belirtilen ürünün satışı ve teslimidir. Siparişe konu
        ürünün cinsi, adedi, KDV dahil satış fiyatı ve ödeme şekli sipariş özetinde yer alır ve
        sipariş onayınızla birlikte kayda geçer.
      </p>

      <h2>3. Fiyat ve ödeme</h2>
      <ul>
        <li>Sitede gösterilen fiyatlar <b>KDV dahildir</b> ve Türk Lirası üzerindendir.</li>
        <li>
          Ödeme yalnızca <b>banka/kredi kartı ile 3D Secure</b> üzerinden yapılır. Havale, EFT
          ve kapıda ödeme kabul edilmemektedir.
        </li>
        <li>
          Karttan çekilecek tutar, sipariş kaydındaki tutardır. Ödeme adımında gösterilen tutar
          ile siparişinizin tutarı her zaman aynıdır.
        </li>
        <li>
          Kart bilgileriniz Satıcı tarafından <b>saklanmaz</b>. Bilgiler, ödemenin yapılabilmesi
          için doğrudan bankanın 3D Secure sayfasına iletilir.
        </li>
        <li>
          Taksit seçenekleri kartınızın bankasına göre değişir ve ödeme adımında gösterilir.
          Taksit farkları banka tarafından belirlenir.
        </li>
      </ul>

      <h2>4. Teslimat</h2>
      <ul>
        <li>
          Teslimat, KKTC sınırları içinde <b>Satıcı'nın kendi ekibi</b> tarafından yapılır ve
          ayrıca teslimat ücreti alınmaz.
        </li>
        <li>
          Ürün, sevkiyat hazırlanırken düzenlenen fatura ile birlikte gönderilir. Sevkiyat
          hazırlandığında teslimat kaydınız oluşur ve <b>Hesabım → Siparişlerim</b> ekranından
          takip edebilirsiniz.
        </li>
        <li>
          Teslimat, siparişte bildirilen adrese yapılır. Adresin doğruluğu ve teslim anında
          adreste ürünü teslim alacak birinin bulunması Alıcı'nın sorumluluğundadır.
        </li>
        <li>
          Ürünü teslim alırken <b>ambalajı kontrol ediniz</b>. Hasarlı görünen bir ürünü teslim
          almadan önce durumu teslim eden ekibe bildiriniz.
        </li>
      </ul>

      <h2>5. Kurulum ve garanti</h2>
      <p>
        Kurulum gerektiren ürünlerde montaj, Satıcı'nın yetkili ekibince yapılır. Ürünlerin
        garanti şartları üretici firmanın garanti belgesine tabidir. Yetkisiz kişilerce yapılan
        müdahaleler garantiyi geçersiz kılar.
      </p>

      <h2>6. Sipariş iptali ve iade</h2>
      <p>
        Siparişinizle ilgili bir sorun olduğunda öncelikle bizimle irtibata geçmeniz gerekir;
        talebiniz duruma göre değerlendirilir. İptal edilen siparişlerin kaydı sistemde tutulur
        ve ödemesi alınmış bir siparişin iptalinde iade, ödemenin yapıldığı karta yapılır.
        Bankadan kaynaklanan iade süreleri Satıcı'nın kontrolünde değildir.
      </p>
      <p>
        Kişiye özel üretilen, ambalajı açıldığında sağlık ve hijyen açısından iadesi uygun
        olmayan ve kullanılmakla değeri düşen ürünlerde iade kabul edilmeyebilir.
      </p>

      <h2>7. Uyuşmazlık</h2>
      <p>
        Bu sözleşmeden doğan uyuşmazlıklarda <b>Kuzey Kıbrıs Türk Cumhuriyeti mevzuatı</b>
        {' '}uygulanır ve KKTC mahkemeleri yetkilidir.
      </p>

      <h2>8. Yürürlük</h2>
      <p>
        Siparişi onayladığınızda bu sözleşmenin tüm koşullarını kabul etmiş sayılırsınız.
        Sözleşmenin bir kopyası, sipariş kaydınızla birlikte sistemimizde saklanır.
      </p>
    </LegalPage>
  )
}
