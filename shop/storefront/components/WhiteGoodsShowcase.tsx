import Image from 'next/image'
import Link from 'next/link'
import AddToCartButton from '@/components/AddToCartButton'
import type { CatalogItem } from '@/lib/api'
import { displayName, formatPrice, mediaUrl } from '@/lib/format'

/*
  BEYAZ EŞYA VİTRİNİ (2026-09-21).

  NEDEN AYRI BİR BİLEŞEN: kullanıcı isteği — "ana sayfada 2 tane daha div olmalı beyaz
  eşyalarla ilgili, onlarda listelenmeli ama aşırı dikkat çekici olmalı, yani normal ürün
  divlerinden olmayacak, beyaz eşyalarımız üstlerde listelenmeli, zaten amaç beyaz eşya satmak".

  Anasayfada altı tane `ProductSlider` var ve hepsi aynı görünüyor: beyaz zemin, küçük kartlar,
  yan yana kayan şerit. Beyaz eşyayı bir yedincisi olarak koymak, satmak istenen ürünü tam da
  göze çarpmayan biçimde koymak olurdu.

  BURADAKİ FARKLAR:
  • Tam genişlik KOYU zemin (kırmızı ya da gece siyahı) — sayfadaki tek koyu ürün bloğu.
  • Animasyonlu SVG zemin: yavaş süzülen ışık kütleleri + kayan ızgara.
  • Kartlar büyük, fiyat büyük, "Sepete ekle" doğrudan kartın üstünde.
  • Solda satış argümanı (teslimat, montaj, garanti) — şeritlerde bu hiç yok.

  İKİ TEMA: aynı bileşen iki kez kullanılıyor ama `tema` ayrı. Aynı görünselerdi yine
  "birbirinin tekrarı iki blok" olurdu; kırmızı olan soğutucuları, koyu olan yıkama
  grubunu taşıyor.

  SUNUCU BİLEŞENİ: içinde durum yok. `AddToCartButton` zaten istemci bileşeni ve tek başına
  hidrate oluyor; bloğun tamamını istemciye taşımak gereksiz betik yükü olurdu.
*/

export type BeyazEsyaTema = 'kirmizi' | 'gece'

export default function WhiteGoodsShowcase({
  tema,
  rozet,
  baslik,
  altBaslik,
  maddeler,
  tumuLink,
  tumuMetin,
  items,
  ters = false,
}: {
  tema: BeyazEsyaTema
  rozet: string
  baslik: string
  altBaslik: string
  /** Sol sütundaki satış argümanları; en fazla dört madde okunur kalıyor. */
  maddeler: string[]
  tumuLink: string
  tumuMetin: string
  items: CatalogItem[]
  /**
   * Metin SAĞDA, ürünler SOLDA (2026-09-22 kullanıcı isteği: "çamaşır makinesinde yazılar
   * sağda ürünler solda olsun, üsttekinin tam tersi").
   *
   * İki blok arka arkaya geldiği için aynı iskeletin iki kez tekrarı göze "aynı şey" gibi
   * görünüyordu; ikincisini aynalamak, aşağı inen gözü yeniden yakalıyor.
   *
   * Yalnız geniş ekranda geçerli: dar ekranda ikisi de tek sütuna iniyor ve orada BAŞLIK
   * her zaman önce geliyor — ürünlerin üstünde başlık olmadan kart görmek kafa karıştırır.
   */
  ters?: boolean
}) {
  // Ürün yoksa blok hiç çizilmiyor: boş bir "beyaz eşya" başlığı, hiç başlık olmamasından kötü.
  if (!items || items.length === 0) return null

  const idOnek = `bg-${tema}`

  return (
    <section className={`beyaz-esya beyaz-esya-${tema}${ters ? ' beyaz-esya-ters' : ''}`}>
      {/* Animasyonlu zemin — dekoratif, ekran okuyucudan gizli. */}
      <div className="be-zemin" aria-hidden="true">
        <svg className="be-zemin-svg" viewBox="0 0 1440 560" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
          <defs>
            {/*
              v3: zemin artık koyu gece tonu (CSS'te), kırmızı/çelik ışık da CSS'te
              radial-gradient olarak veriliyor. Buradaki SVG yalnız İNCE DOKU ekliyor:
              çok düşük opaklıkta beyaz kütleler ve kayan ızgara. Opaklıklar bilerek düşük —
              v2'de bu katman baskındı ve zemin "slab" gibi duruyordu.
            */}
            <radialGradient id={`${idOnek}-a`} cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#ffffff" stopOpacity="0.10" />
              <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
            </radialGradient>
            <radialGradient id={`${idOnek}-b`} cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor={tema === 'kirmizi' ? '#ffb4a8' : '#9ecbff'} stopOpacity="0.12" />
              <stop offset="100%" stopColor={tema === 'kirmizi' ? '#ffb4a8' : '#9ecbff'} stopOpacity="0" />
            </radialGradient>
            <pattern id={`${idOnek}-grid`} width="64" height="64" patternUnits="userSpaceOnUse">
              <path d="M64 0H0V64" fill="none" stroke="#ffffff" strokeOpacity="0.05" strokeWidth="1" />
            </pattern>
          </defs>

          <rect className="be-grid" x="-64" y="-64" width="1568" height="688" fill={`url(#${idOnek}-grid)`} />
          <circle className="be-blob be-blob-a" cx="200" cy="120" r="320" fill={`url(#${idOnek}-a)`} />
          <circle className="be-blob be-blob-b" cx="1240" cy="430" r="300" fill={`url(#${idOnek}-b)`} />
        </svg>
      </div>

      {/*
        İKİ SÜTUN (2026-09-21 — ikinci tasarım).

        İlk hâlde başlık, alt başlık, maddeler ve düğme ÜST ÜSTE dizilip kartlar altına
        iniyordu. Sonuç: bloğun üst yarısı yazı, alt yarısı kart; geniş ekranda sağ taraf
        boş kırmızı kalıyor ve iki blok arka arkaya gelince aynı iskelet iki kez tekrar
        ediyordu (kullanıcı: "bu 2 divin tasarımını sevemedim").

        Yeni düzen metni SOL sütuna sabitliyor, kartları SAĞA 2×2 ızgaraya alıyor:
        genişlik gerçekten kullanılıyor, göz soldaki vaatten sağdaki ürüne akıyor.
        Maddeler yan yana değil ALT ALTA — dördü yan yana dizilince tek bir gri şerit
        gibi görünüyor ve hiçbiri okunmuyordu.
      */}
      <div className="wrap be-icerik">
        <div className="be-govde">
          <div className="be-sol">
            <span className="be-rozet">{rozet}</span>
            <h2>{baslik}</h2>
            <p>{altBaslik}</p>

            <ul className="be-maddeler">
              {maddeler.map((m) => (
                <li key={m}>
                  <span className="be-madde-tik" aria-hidden="true">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                  </span>
                  {m}
                </li>
              ))}
            </ul>

            <Link href={tumuLink} className="be-tumu">
              {tumuMetin}
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m9 18 6-6-6-6" />
              </svg>
            </Link>
          </div>

        <div className="be-kartlar">
          {items.map((item) => {
            const gorsel = mediaUrl(item.imageUrl)
            const ad = displayName(item.name)
            const indirimli =
              Number(item.originalGrossPrice ?? 0) > item.grossPrice
                ? Number(item.originalGrossPrice)
                : null

            return (
              <article key={item.stockCode} className="be-kart">
                <Link href={`/urun/${item.slug}`} className="be-kart-gorsel" aria-label={ad}>
                  {gorsel ? (
                    <Image src={gorsel} alt={ad} width={240} height={240} sizes="240px" />
                  ) : (
                    <span className="be-kart-gorselsiz">STILSOFT</span>
                  )}

                  {/*
                    SOL ÜST — STOK DURUMU (2026-09-22 kullanıcı isteği: "ürünlerin sol üstüne
                    KKTC stokta yaz, ufak container ile kırmızı küçük güzel bir yazı").

                    Ada içinde en çok sorulan şey "bu ürün burada mı, yoksa ısmarlanacak mı".
                    Rozet tam da o soruyu kart seviyesinde cevaplıyor.

                    Aynı köşe hem stok hem tükendi için kullanılıyor: ikisi birbirinin
                    alternatifi, asla yan yana çıkmıyor. Kampanya rozeti bu yüzden SAĞ üste
                    alındı — eskiden ikisi de sol üstteydi ve üst üste biniyordu.
                  */}
                  {item.inStock ? (
                    <span className="be-kart-stok">KKTC STOKTA</span>
                  ) : (
                    <span className="be-kart-tukendi">Tükendi</span>
                  )}

                  {indirimli && <span className="be-kart-indirim">Kampanya</span>}
                </Link>

                <div className="be-kart-govde">
                  <Link href={`/urun/${item.slug}`} className="be-kart-ad">{ad}</Link>

                  <div className="be-kart-fiyat">
                    <b className="num">{formatPrice(item.grossPrice, item.currency)}</b>
                    {indirimli && <s className="num">{formatPrice(indirimli, item.currency)}</s>}
                  </div>

                  {item.inStock ? (
                    <AddToCartButton
                      stockCode={item.stockCode}
                      className="be-kart-btn"
                      installable={item.isInstallable}
                      installationFee={item.installationFee}
                      currency={item.currency}
                    />
                  ) : (
                    <Link href={`/urun/${item.slug}`} className="be-kart-btn be-kart-btn-pasif">
                      Gelince haber ver
                    </Link>
                  )}
                </div>
              </article>
            )
          })}
        </div>
        </div>
      </div>
    </section>
  )
}
