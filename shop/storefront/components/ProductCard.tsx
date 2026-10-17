'use client'

import Image from 'next/image'
import Link from 'next/link'
import AddToCartButton from '@/components/AddToCartButton'
import type { CatalogItem } from '@/lib/api'
import { useStorefrontDisplay } from '@/context/StorefrontContext'
import { displayName, formatPrice, mediaUrl, stockLabel } from '@/lib/format'

export default function ProductCard({
  item,
  priority = false,
}: {
  item: CatalogItem
  priority?: boolean
}) {
  // "Son N adet" eşiği bayi panelinden geliyor. Prop olarak değil context'ten okunuyor:
  // ürün kartını render eden dört ayrı yer var (liste, kaydırıcı, benzer ürünler, detay) ve
  // birine geçirmeyi unutmak sessizce varsayılana düşürürdü.
  const { lowStockThreshold } = useStorefrontDisplay()

  const img = mediaUrl(item.imageUrl)
  const name = displayName(item.name)

  // "12+" biçimlemesi tek yerde (lib/format). Adet gelmiyorsa null döner ve eski
  // "KKTC Stokta" rozetine düşülür.
  const stock = stockLabel(item.stockQuantity, item.stockCapped)

  /*
   * BURADA "ESKİ FİYAT" HESAPLANMAZ.
   *
   * Önceki hâlde her kartta `grossPrice * 1.15` uydurulup üstü çizili "eski fiyat" ve "-%15"
   * rozeti basılıyordu. Böyle bir indirim HİÇ YOKTU: ürün hiçbir zaman o fiyattan satılmadı,
   * rakam satış fiyatından geriye doğru üretiliyordu. Katalogdaki 163 ürünün tamamı sürekli
   * indirimde görünüyordu. Gerçek bir kampanya kurgusu (ERP'de eski fiyat alanı) olmadan
   * indirim göstermek yanıltıcı fiyat beyanıdır; alan açılırsa buraya o alan bağlanır,
   * hesaplanmış bir sayı değil.
   *
   * 2026-09-19: alan açıldı. `originalGrossPrice` ERP kampanyasından (bayi panelinde
   * vitrin anahtarı açık olanlar) geliyor; vitrin yalnız gösterir.
   */
  const installmentAmount = item.grossPrice > 0 ? item.grossPrice / 3 : 0
  const hasCampaign = Number(item.originalGrossPrice ?? 0) > item.grossPrice
  const campaignChip = hasCampaign
    ? (item.campaignPercent != null && item.campaignPercent > 0
        ? `-%${Math.round(item.campaignPercent)}`
        : `-${formatPrice(Number(item.originalGrossPrice) - item.grossPrice, item.currency)}`)
    : ''

  return (
    <article className="product modern-product-card">
      {/* Üst Rozetler (Temiz, ikonsuz) */}
      <div className="product-card-badges">
        {!item.inStock ? (
          <span className="p-badge p-badge-out">Tükendi</span>
        ) : (
          <>
            {/*
              ROZETLER SEYRELTİLDİ (2026-09-21 kullanıcı isteği: "KKTC Stokta ve Ücretsiz
              Montaj yazıları ürünü çok kapatıyor, onları kaldır").

              Rozetler görselin SOL ÜSTÜNDE duruyor ve ürünün üzerine biniyor. Kaldırılanlar
              her kartta AYNI yazan, yani hiçbir ayırt edici bilgi taşımayanlardı:
                • "KKTC Stokta"    — stokta olan her üründe çıkıyordu
                • "Ücretsiz Montaj" — montajlı her üründe çıkıyordu
              Montaj bilgisi zaten kartın altında "Montaj dahil" satırında yazıyor.

              KALANLAR gerçek ve DEĞİŞEN bilgi: "Tükendi" (yukarıda), "Son N adet" (aciliyet)
              ve "N adet stokta". Bunlar karardan önce bakılan sayılar, görseli kapatmaya değer.
            */}
            {/*
              2026-09-22: "KKTC STOKTA" GERİ GELDİ — ama bambaşka bir boyda.

              Yukarıdaki not, rozetin 2026-09-21'de neden kaldırıldığını anlatıyor: o
              zamanki hâli büyük puntolu, dolu renkli bir bloktu ve ürün fotoğrafını
              kapatıyordu. Kullanıcı bu sefer "biraz daha küçük yaz" diyerek geri istedi;
              yeni rozet 9px, açık kırmızı zeminli ve yarı saydam — görseli kapatmıyor.

              KART BAŞINA TEK ROZET: üçü birbirinin alternatifi, asla yan yana çıkmıyorlar.
                • stok yok              -> "Tükendi"        (yukarıda)
                • az kaldı (aciliyet)   -> "Son N adet"
                • normal                -> "KKTC STOKTA"
              "N adet stokta" rozetinin yerini "KKTC STOKTA" aldı: ikisi aynı köşede aynı
              anda durunca kart kalabalıklaşıyordu ve adet bilgisi zaten ürün sayfasında var.
            */}
            {stock && !item.stockCapped && (item.stockQuantity ?? 0) <= lowStockThreshold ? (
              // "Son N adet" yalnızca TAVANA TAKILMAMIŞ ve eşiğin altındaki gerçek adette
              // çıkar: "12+" için "son 12 adet" demek yanlış olurdu, orada stok bol.
              <span className="p-badge p-badge-low">Son {stock} adet</span>
            ) : (
              <span className="p-badge p-badge-kktc">KKTC STOKTA</span>
            )}
          </>
        )}
      </div>

      {/* Ürün Görseli */}
      <Link href={`/urun/${item.slug}`} className="photo modern-photo" aria-label={name}>
        {img ? (
          <Image
            src={img}
            alt={name}
            fill
            sizes="(max-width: 760px) 50vw, (max-width: 1080px) 33vw, 280px"
            priority={priority}
            className="product-card-img"
          />
        ) : (
          <div className="photo-placeholder">
            <span>STILSOFT</span>
          </div>
        )}
      </Link>

      {/* Marka & Model / Stok Kodu */}
      <div className="p-meta-row">
        <span className="p-brand">STILSOFT</span>
        <span className="p-code">{item.stockCode}</span>
      </div>

      {/* Ürün Adı (Sabit 2 Satır Yükseklik) */}
      <h3 className="p-name">
        <Link href={`/urun/${item.slug}`} title={name}>
          {name}
        </Link>
      </h3>

      {/*
        "3 renk" rozeti (2026-09-20). Bayi renk gruplamasını açtıysa listede aynı ürünün tek
        kartı görünüyor; kaç renk olduğunu söylemezsek müşteri diğer renkleri hiç bilmez.
        Seçim ürün sayfasında.
      */}
      {(item.variantCount ?? 0) > 1 && (
        <div className="card-variant-badge">{item.variantCount} renk</div>
      )}

      {/* Fiyat & Taksit Alanı */}
      <div className="p-price modern-price-block">
        {hasCampaign && (
          <div className="p-orig-row" title={item.campaignName ?? 'Kampanya'}>
            <span className="p-orig num">{formatPrice(Number(item.originalGrossPrice), item.currency)}</span>
            <span className="p-discount-chip">{campaignChip}</span>
          </div>
        )}
        <div className="p-current-row">
          <span className="p-now num">{formatPrice(item.grossPrice, item.currency)}</span>
          <span className="p-vat">KDV Dahil</span>
        </div>
        {/*
          "Peşin fiyatına 3 taksit" iddiası KALDIRILDI (2026-09-20): taksit sayısı ve komisyon
          bankaya göre değişiyor, ödeme adımında farklı tutar çıkınca sepet terk ediliyordu.
          Gerçek tablo kartın BIN'i girilince ödeme adımında görünüyor.
        */}
        {installmentAmount > 0 && (
          <div className="p-installment">
            <span>Kredi kartına <strong>taksit imkânı</strong> · Havale/EFT</span>
          </div>
        )}
      </div>

      {/* Sepete Ekle Butonu */}
      <div className="p-action-row">
        {/*
          Tükenmiş ürünün düğmesi artık YOK. Önceden rozet "Tükendi" derken düğme çalışmaya
          devam ediyordu: ürün sepete giriyor, sipariş açılıyor ve kart çekiliyordu. Asıl kapı
          sunucuda (mağaza API'si stoksuz eklemeyi reddediyor); burası kullanıcıyı boşuna
          tıklatmamak için.
        */}
        {item.inStock ? (
          <AddToCartButton
            stockCode={item.stockCode}
            className="p-add modern-add-btn"
            installable={item.isInstallable}
            installationFee={item.installationFee}
            currency={item.currency}
          />
        ) : (
          <button type="button" className="p-add modern-add-btn" disabled>
            Stokta yok
          </button>
        )}
      </div>
    </article>
  )
}
