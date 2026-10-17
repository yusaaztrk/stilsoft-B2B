import type { Metadata } from 'next'
import Link from 'next/link'
import KurumsalTeklifForm from '@/components/KurumsalTeklifForm'
import { KURUMSAL_DANISMAN } from '@/lib/companyInfo'
import { jsonLdScript } from '@/lib/jsonld'

/*
  KURUMSAL SATIŞ SAYFASI (2026-10-04 kullanıcı isteği: "yeni bir sayfa lazım, kurumsal satış
  danışmanı Demo Danışman +90 533 000 00 01 … daha çok satış gelmeli").

  Hedef: otel, site/apartman projesi, müteahhit, ofis, restoran ve kiralık daire yatırımcısı.
  Bu müşteri sepete 20 ürün atıp kartla ödemiyor; bir İNSANLA konuşup teklif istiyor. Sayfa o
  yüzden üç çıkışı en üste koyuyor: ara, WhatsApp, teklif formu. Form talebi panelde
  "Kurumsal satış" etiketiyle görünür (bkz. KurumsalTeklifForm).

  SÖZ VERİLMEYENLER (bilerek): vade, sabit iskonto oranı, "24 saatte teklif". Bunlar firma
  kararı; sayfa yalnız sitenin başka yerlerinde de verilen sözleri tekrarlıyor (ücretsiz
  teslimat, yetkili servis montajı, 3 yıl distribütör garantisi).
*/

export const metadata: Metadata = {
  title: 'Kurumsal Satış — Otel, Proje ve Toplu Alım',
  description:
    'Kıbrıs’ta otel, site ve apartman projeleri, ofis ve restoranlar için toplu beyaz eşya, ankastre ve klima alımı. Proje bazlı fiyat teklifi, KKTC geneli teslimat, yetkili servis montajı. Kurumsal satış danışmanı: Demo Danışman.',
  alternates: { canonical: '/kurumsal-satis' },
  openGraph: {
    title: 'Stilsoft Kurumsal Satış — Kıbrıs Toplu Beyaz Eşya ve Ankastre',
    description: 'Otel, proje ve ofisler için toplu alımda tek muhatap, proje bazlı teklif.',
  },
}

const KIMLER = [
  { ikon: '🏨', baslik: 'Otel & Pansiyon', metin: 'Oda buzdolabı, klima, su ısıtıcı, saç kurutma — oda sayısına göre tek seferde.' },
  { ikon: '🏗️', baslik: 'Site & Apartman Projeleri', metin: 'Dairelere ankastre set, buzdolabı ve çamaşır makinesi; teslim planı projeye göre.' },
  { ikon: '🏢', baslik: 'Ofis & Şirketler', metin: 'Çay ocağı, su sebili, kahve makinesi, klima ve mutfak ekipmanı.' },
  { ikon: '🍽️', baslik: 'Restoran & Kafe', metin: 'Derin dondurucu, buzdolabı, içecek hazırlama ve küçük mutfak aletleri.' },
  { ikon: '🎓', baslik: 'Okul, Yurt & Kamu', metin: 'Yurt odaları, öğretmenler odası ve ortak alanlar için toplu ihtiyaç.' },
  { ikon: '🔑', baslik: 'Kiralık Daire Yatırımcıları', metin: 'Kiraya hazır daire paketi: beyaz eşya + klima + küçük ev aletleri.' },
]

const AVANTAJLAR = [
  { baslik: 'Proje bazlı fiyat', metin: 'Adet ve ürün karmasına göre size özel teklif hazırlanır.' },
  { baslik: 'Tek muhatap', metin: 'Teklif, teslimat ve montajı aynı danışman takip eder.' },
  { baslik: 'KKTC geneli teslimat', metin: 'Lefkoşa, Girne, Gazimağusa, Güzelyurt, İskele ve Lefke’ye ücretsiz.' },
  { baslik: 'Yetkili servis montajı', metin: 'Kurulumu kendi yetkili servis ekibimiz yapar.' },
  { baslik: '3 yıl distribütör garantisi', metin: 'Satış sonrası servis ve yedek parça bizde.' },
  { baslik: 'Faturalı satış', metin: 'Firmanız adına fatura kesilir.' },
]

const ADIMLAR = [
  { baslik: 'İhtiyacınızı iletin', metin: 'Arayın, WhatsApp’tan yazın ya da formu doldurun.' },
  { baslik: 'Teklifinizi alın', metin: 'Danışmanımız ürün ve adetleri netleştirip teklif hazırlar.' },
  { baslik: 'Teslim planı', metin: 'Teslimat tarihleri projenizin takvimine göre planlanır.' },
  { baslik: 'Montaj & servis', metin: 'Yetkili servis kurulumu yapar; garanti süresince yanınızdayız.' },
]

const KATEGORILER = [
  { href: '/kategori/ankastre', ad: 'Ankastre Setler' },
  { href: '/kategori/buzdolabi', ad: 'Buzdolapları' },
  { href: '/kategori/camasir-makinesi', ad: 'Çamaşır Makineleri' },
  { href: '/kategori/klima', ad: 'Klimalar' },
  { href: '/kategori/icecek-hazirlama', ad: 'Çay & Kahve Makineleri' },
  { href: '/kategori/ev-temizligi', ad: 'Süpürgeler' },
]

const SSS = [
  {
    soru: 'Kaç adetten itibaren kurumsal teklif alabilirim?',
    cevap: 'Alt sınır yok. Birden fazla ürün ya da aynı üründen birkaç adet alacaksanız danışmanımız sizin için ayrıca fiyat çalışır.',
  },
  {
    soru: 'Sitede görmediğim ürünleri de teklife ekleyebilir miyim?',
    cevap: 'Evet. Depomuzda sitede henüz yayında olmayan ürünler de var; ihtiyacınızı yazın, uygun ürünleri danışmanımız önersin.',
  },
  {
    soru: 'Teslimat ve montaj nasıl planlanıyor?',
    cevap: 'KKTC geneline teslimat ücretsizdir. Proje teslimlerinde tarih sizinle birlikte planlanır, kurulumu yetkili servis ekibimiz yapar.',
  },
  {
    soru: 'Firmam adına fatura kesilir mi?',
    cevap: 'Evet. Teklif aşamasında firma unvanı ve vergi bilgilerinizi iletmeniz yeterli.',
  },
]

export default function KurumsalSatisPage() {
  const d = KURUMSAL_DANISMAN
  const waMesaj = encodeURIComponent('Merhaba Esra Hanım, kurumsal/toplu alım için teklif almak istiyorum.')
  const waHref = `https://wa.me/${d.whatsappDijit}?text=${waMesaj}`

  const faqLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: SSS.map((s) => ({
      '@type': 'Question',
      name: s.soru,
      acceptedAnswer: { '@type': 'Answer', text: s.cevap },
    })),
  }
  const iletisimLd = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'STILSOFT DEMO',
    contactPoint: {
      '@type': 'ContactPoint',
      telephone: d.telefon,
      contactType: 'sales',
      name: `${d.ad} — ${d.unvan}`,
      areaServed: 'CY',
      availableLanguage: ['Turkish', 'English'],
    },
  }

  return (
    <div className="ks-page">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(faqLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(iletisimLd) }} />

      <div className="wrap">
        <div className="crumbs">
          <Link href="/">Anasayfa</Link>
          <span>›</span>
          <span>Kurumsal Satış</span>
        </div>

        {/* ÜST: başlık + danışman kartı */}
        <section className="ks-hero">
          <div className="ks-hero-text">
            <span className="ks-eyebrow">Kurumsal &amp; Toplu Alım</span>
            <h1>Oteliniz, projeniz ya da ofisiniz için tek muhatap</h1>
            <p className="ks-lede">
              Beyaz eşya, ankastre, klima ve küçük ev aletlerinde toplu alımlara özel fiyat
              teklifi. Teslimattan montaja kadar her adımı kurumsal satış danışmanınız takip eder.
            </p>
            <ul className="ks-hero-list">
              <li>Proje bazlı fiyat</li>
              <li>KKTC geneli ücretsiz teslimat</li>
              <li>Yetkili servis montajı</li>
              <li>3 yıl distribütör garantisi</li>
            </ul>
          </div>

          <aside className="ks-danisman" aria-label="Kurumsal satış danışmanı">
            <div className="ks-avatar" aria-hidden="true">
              {d.ad
                .split(' ')
                .map((p) => p[0])
                .join('')}
            </div>
            <div className="ks-danisman-ad">{d.ad}</div>
            <div className="ks-danisman-unvan">{d.unvan}</div>
            <a className="ks-danisman-tel" href={`tel:${d.telefonDijit}`}>
              {d.telefon}
            </a>
            <div className="ks-danisman-btns">
              <a className="btn ks-btn-ara" href={`tel:${d.telefonDijit}`}>
                Hemen ara
              </a>
              <a className="btn ks-btn-wa" href={waHref} target="_blank" rel="noopener noreferrer">
                WhatsApp&apos;tan yaz
              </a>
              <a className="btn btn-line ks-btn-teklif" href="#teklif">
                Teklif formu
              </a>
            </div>
            <p className="ks-danisman-not">Pazartesi – Cumartesi, mesai saatlerinde</p>
          </aside>
        </section>

        {/* KİMLER İÇİN */}
        <section className="ks-section">
          <h2>Kimlere hizmet veriyoruz?</h2>
          <div className="ks-kimler">
            {KIMLER.map((k) => (
              <div key={k.baslik} className="ks-kart">
                <span className="ks-kart-ikon" aria-hidden="true">
                  {k.ikon}
                </span>
                <h3>{k.baslik}</h3>
                <p>{k.metin}</p>
              </div>
            ))}
          </div>
        </section>

        {/* AVANTAJLAR */}
        <section className="ks-section ks-band">
          <h2>Neden Stilsoft Kurumsal?</h2>
          <div className="ks-avantajlar">
            {AVANTAJLAR.map((a) => (
              <div key={a.baslik} className="ks-avantaj">
                <span className="ks-tik" aria-hidden="true">
                  ✓
                </span>
                <div>
                  <b>{a.baslik}</b>
                  <p>{a.metin}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* NASIL İŞLER */}
        <section className="ks-section">
          <h2>Nasıl çalışıyoruz?</h2>
          <ol className="ks-adimlar">
            {ADIMLAR.map((a, i) => (
              <li key={a.baslik}>
                <span className="ks-adim-no">{i + 1}</span>
                <b>{a.baslik}</b>
                <p>{a.metin}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* TEKLİF FORMU */}
        <section className="ks-section ks-teklif" id="teklif">
          <div className="ks-teklif-sol">
            <h2>Ücretsiz teklif isteyin</h2>
            <p>
              Ne kadar ayrıntı verirseniz teklif o kadar net olur: ürün türleri, adetler, tercih
              ettiğiniz markalar ve teslim tarihi. Acele ediyorsanız doğrudan arayın:
            </p>
            <a className="ks-teklif-tel" href={`tel:${d.telefonDijit}`}>
              {d.telefon}
            </a>
            <span className="ks-teklif-ad">
              {d.ad} · {d.unvan}
            </span>
          </div>
          <KurumsalTeklifForm />
        </section>

        {/* KATEGORİLER */}
        <section className="ks-section">
          <h2>Projelerde en çok tercih edilenler</h2>
          <div className="ks-kategoriler">
            {KATEGORILER.map((k) => (
              <Link key={k.href} href={k.href} className="ks-kategori">
                {k.ad} <span aria-hidden="true">→</span>
              </Link>
            ))}
          </div>
        </section>

        {/* SSS */}
        <section className="ks-section">
          <h2>Sık sorulan sorular</h2>
          <div className="ks-sss">
            {SSS.map((s) => (
              <details key={s.soru}>
                <summary>{s.soru}</summary>
                <p>{s.cevap}</p>
              </details>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
