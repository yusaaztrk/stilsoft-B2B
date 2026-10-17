import Image from 'next/image'
import Link from 'next/link'

/*
  MARKA BLOĞU — v2 (2026-09-21).

  İSTEK: "ilk girişte animasyonlu bir div, Kıbrıs'ta distribütör değiliz, markanın sahibiyiz
  felan övsün övsün, altta da ürünleri keşfet yazsın."

  v1 BEĞENİLMEDİ: "2. görseldeki tasarımı beğenmedim, daha güzel bir şey yap, oraya logoyu
  mu koysan acaba". v1 iki sütunluydu: solda başlık, sağda paragraf ve vaatler. Sorunları:
    • Marka bloğuydu ama MARKA İŞARETİ yoktu — sadece koyu zeminde yazıydı.
    • İki sütun, bakışı ikiye bölüyordu; "ilan panosu" gibi duruyordu, anlatı gibi değil.
    • Vaatler sağ altta madde listesiydi; hiçbiri tek tek okunmuyordu.

  v2 KARARLARI:
    • LOGO merkezde ve blok ONUN etrafında kuruluyor. Arkada aynı logo çok düşük opaklıkta
      dev bir filigran olarak duruyor — derinlik veriyor, ayrıca ek görsel dosya gerektirmiyor.
    • Tek eksende, ORTALI anlatı: logo → ince ayraç → başlık → cümle → vaat çipleri → düğme.
      Göz yukarıdan aşağı tek yol izliyor.
    • Vaatler madde listesi değil, kenarlıklı cam ÇİP; dördü de ayrı ayrı okunuyor.
    • Zemin düz siyah değil: derin lacivert-siyah taban + marka kırmızısı ışık + çok ince
      ızgara dokusu. Düz siyah ucuz duruyordu.

  LOGO PANELDEN: adres `StorefrontSettings.logoImageUrl`; başlıkla aynı kaynak. Kodda
  sabitlenseydi bayi logoyu değiştirdiğinde burası eski logoda kalırdı.

  ANİMASYON SAF CSS (bileşen istemci bileşeni DEĞİL): v1'in ilk hâlinde metin `opacity: 0`
  ile başlıyor, IntersectionObserver açıyordu — blok hem telefonda hem masaüstünde İÇİ BOŞ
  çıktı, açma sınıfı bazı yüklemelerde hiç eklenmedi. Metnin görünürlüğünü betiğe bağlamak,
  betik bir kez takıldığında içeriği yok ediyor; arama motoru için de gizli metin demek.
  `animation ... both` ile son kare korunuyor, betik hiç çalışmasa bile yazı görünür.

  METİN NOTU: iddialar sitede zaten yazılı olanlarla sınırlı (resmi distribütör güvencesi,
  3 yıl garanti, kendi servis ekibi, ücretsiz teslimat/montaj). Uydurma ödül ya da rakam yok.
*/

const VAATLER = [
  'KKTC geneli ücretsiz teslimat',
  '3 yıl resmi garanti',
  'Kendi yetkili servis ekibimiz',
  'Ücretsiz montaj',
]

export default function BrandIntro({ logo }: { logo: string }) {
  return (
    <section className="marka-giris">
      {/* Dekoratif zemin: ışık kütleleri + ince ızgara + logo filigranı. */}
      <div className="marka-zemin" aria-hidden="true">
        <span className="marka-isik marka-isik-1" />
        <span className="marka-isik marka-isik-2" />
        <span className="marka-izgara" />
        <span className="marka-filigran">
          <Image src={logo} alt="" width={1100} height={326} priority={false} />
        </span>
      </div>

      <div className="wrap marka-icerik">
        <span className="marka-logo">
          <Image src={logo} alt="STILSOFT" width={190} height={56} priority={false} />
        </span>

        {/* İnce ayraç — ortada küçük bir marka noktası. */}
        <span className="marka-ayrac" aria-hidden="true">
          <i />
          <b />
          <i />
        </span>

        {/*
          METİN KULLANICIDAN GELDİ (2026-09-22). Önceki hâli "Kıbrıs'ta aracı değil, markanın
          kendisiyiz." idi; kullanıcı yerine bu iki metni verdi. Kendi sözleri korundu, yalnız
          "Evinide" yazım hatası "Evinizde" olarak düzeltildi.
        */}
        <h1 className="marka-baslik">
          <span className="marka-satir">Evinizde konforu ve</span>
          <span className="marka-satir marka-satir-vurgu">teknolojiyi keşfedin.</span>
        </h1>

        {/*
          Ürün grupları bu cümlede geçmeye devam ediyor: anasayfada H1 HİÇ YOKTU ve "beyaz
          eşya", "ankastre", "televizyon", "klima" kelimeleri sayfanın üst kısmında düz metin
          olarak bulunmuyordu. Yeni metin de dördünü birden taşıyor, o kazanç korundu.
        */}
        <p className="marka-alt">
          Beyaz eşyadan televizyona, klimadan ankastre setlerine kadar yaşam alanlarınızı daha
          konforlu ve akıllı hale getirmek için en iyi teknolojileri sunuyoruz. Stilsoft
          güvencesiyle, kaliteli hizmet ve yerel destekle tanışın.
        </p>

        <ul className="marka-vaatler">
          {VAATLER.map((v, i) => (
            <li key={v} style={{ animationDelay: `${640 + i * 90}ms` }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M20 6 9 17l-5-5" />
              </svg>
              {v}
            </li>
          ))}
        </ul>

        <Link href="/urunler" className="marka-btn">
          Ürünleri keşfet
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M5 12h13M13 6l6 6-6 6" />
          </svg>
        </Link>
      </div>
    </section>
  )
}
