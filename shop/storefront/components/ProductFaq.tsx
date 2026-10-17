import { jsonLdScript } from '@/lib/jsonld'
import type { CatalogDetail, StorefrontSettings } from '@/lib/api'
import { displayName, formatPrice } from '@/lib/format'

/*
  ÜRÜN SAYFASI SIKÇA SORULAN SORULAR (2026-09-21).

  İki iş birden:
  1. MÜŞTERİ: telefonla sormadan cevaplanan sorular — teslimat kaç gün, montaj dahil mi,
     garanti, ödeme şekli, stok, değişim. Kıbrıs müşterisi bunları arayıp soruyor; sayfada
     yazılıysa mesai dışında da satış kapanabiliyor.
  2. GOOGLE: FAQPage yapısal verisi. Not: Google, FAQ zengin sonucunu 2023'ten beri yalnız
     kamu/sağlık sitelerinde gösteriyor; buradaki kazanç sıralama sinyali ve "People also ask"
     eşleşmesi, yıldızlı kutu değil. Yapısal veri SAYFADA GÖRÜNEN metinle birebir aynı —
     görünmeyen içerik işaretlemek Google'ın cezalandırdığı bir durum.

  Cevaplar ÜRÜNE ve PANEL AYARLARINA göre üretiliyor (sabit metin değil): montaj bedeli olan
  televizyonda "ücretsiz kurulum" yazmaz, IBAN girilmemişse havale seçeneği anılmaz, tükenen
  üründe "stokta" denmez.
*/
/** Tesisata bağlanan, ücretsiz montajı olmayan ürünler (termosifon, şofben, ani su ısıtıcı). */
function tesisatUrunuMu(name: string | null | undefined): boolean {
  const n = (name ?? '').toLocaleUpperCase('tr-TR')
  return /TERMOS[İI]FON|ŞOFBEN|SOFBEN|AN[İI] SU ISITICI|ISITICILI MUSLUK/.test(n)
}

export default function ProductFaq({
  product,
  settings,
  phone,
}: {
  product: CatalogDetail
  settings: StorefrontSettings
  phone: string
}) {
  const ad = displayName(product.name)
  const teslimat = settings.deliveryPromise?.trim() || 'Tüm KKTC ilçelerine randevulu nakliye'
  // "14 gün iade" varsayılanı kaldırıldı (2026-10-04 kullanıcı kararı). Panelde değişim politikası
  // yazılıysa o gösterilir; boşsa yalnız hasarlı teslimat güvencesi anılır, gün sözü verilmez.
  const degisim = settings.exchangePolicy?.trim() || ''
  const havaleVar = (settings.bankTransferAccounts ?? []).some((a) => a.iban?.trim())
  const montajBedeli = product.installationFee ?? 0

  const sorular: Array<{ soru: string; cevap: string }> = [
    {
      soru: `${ad} teslimatı ne kadar sürer, ücreti var mı?`,
      cevap: `Teslimat ücretsizdir. ${teslimat}. Teslimat günü ve saati için sizi arayıp randevu veriyoruz.`,
    },
    product.isInstallable
      ? {
          soru: 'Montaj / kurulum fiyata dahil mi?',
          cevap:
            montajBedeli > 0
              ? `Montaj isteğe bağlıdır ve ${formatPrice(montajBedeli, product.currency)} (KDV dahil) bedelle yetkili teknisyenimiz tarafından randevulu yapılır; sepette "Montaj istiyorum" seçtiğinizde tutara eklenir.`
              : 'Evet. Yetkili teknisyenimiz randevulu ve ücretsiz kurulum yapar; sepette "Montaj istiyorum" seçmeniz yeterlidir.',
        }
      : tesisatUrunuMu(product.name)
        ? {
            // TERMOSİFON / ŞOFBEN (2026-10-04 kullanıcı bildirimi: "termosifonda ücretsiz montaj yok").
            // Bu ürünler tesisata bağlanır; "kutusundan çıkıp kullanılır" demek yanlıştı, ücretsiz
            // montaj da sunulmuyor.
            soru: 'Montaj fiyata dahil mi?',
            cevap: `Hayır. Bu ürün su ve elektrik tesisatına bağlanarak kurulur; montaj fiyata dahil değildir ve ücretsiz montaj hizmetimiz yoktur. Montaj talebiniz için ${phone} numarasından bize ulaşabilirsiniz.`,
          }
        : {
            soru: 'Kurulum gerektirir mi?',
            cevap: 'Hayır, bu ürün kutusundan çıkıp doğrudan kullanılır; ayrıca kurulum randevusu gerekmez.',
          },
    {
      soru: 'Garanti süresi ne kadar?',
      cevap: 'Stilsoft ürünleri KKTC resmi distribütör güvencesiyle 3 yıl garantilidir. Servis ve yedek parça KKTC içinde yetkili servisimizden sağlanır.',
    },
    {
      soru: 'Nasıl ödeme yapabilirim?',
      cevap: havaleVar
        ? 'Kredi/banka kartıyla 3D Secure güvenli ödeme (bankanıza göre taksit) veya havale/EFT ile ödeyebilirsiniz. Kapıda ödeme yoktur.'
        : 'Kredi/banka kartıyla 3D Secure güvenli ödeme yapabilirsiniz (bankanıza göre taksit). Kapıda ödeme yoktur.',
    },
    product.inStock
      ? {
          soru: 'Stokta var mı?',
          cevap: `Evet, ${ad} şu an stokta; siparişiniz ödeme onayından sonra hemen hazırlığa alınır.`,
        }
      : {
          soru: 'Ürün tükenmiş, ne zaman gelir?',
          cevap: 'Şu an stokta yok. Ürün sayfasındaki "Gelince haber ver" kutusuna numaranızı bırakırsanız stoğa girdiği an SMS ile haber veririz.',
        },
    // Değişim/iade sorusu YALNIZ panelde bir politika yazılıysa çıkar (2026-10-04 kullanıcı kararı:
    // sitede iade/değişim sözü verilmeyecek). Metin olduğu gibi gösterilir, ek vaat eklenmez.
    ...(degisim
      ? [{ soru: 'Değişim ve iade koşulları nedir?', cevap: `${degisim.replace(/[.\s]+$/, '')}.` }]
      : []),
    {
      soru: 'Telefonla sipariş verebilir miyim?',
      cevap: `Evet. ${phone} numarasını arayın ya da WhatsApp'tan yazın; siparişinizi telefonda birlikte tamamlarız. Mesai dışındaysanız "Sizi arayalım" kutusuna numaranızı bırakın.`,
    },
  ]

  const faqLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: sorular.map((s) => ({
      '@type': 'Question',
      name: s.soru,
      acceptedAnswer: { '@type': 'Answer', text: s.cevap },
    })),
  }

  return (
    <section className="pdp-faq" aria-labelledby="pdp-faq-title">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(faqLd) }} />
      <div className="block-head">
        <div>
          <h2 id="pdp-faq-title">Sıkça sorulan sorular</h2>
        </div>
      </div>
      <div className="pdp-faq-list">
        {sorular.map((s, i) => (
          <details key={i} className="pdp-faq-item" open={i === 0}>
            <summary>{s.soru}</summary>
            <p>{s.cevap}</p>
          </details>
        ))}
      </div>
    </section>
  )
}
