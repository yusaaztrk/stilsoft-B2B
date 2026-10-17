import type { Metadata } from 'next'
import Link from 'next/link'
import ContactForm from '@/components/ContactForm'
import { getStorefront } from '@/lib/api'
import { resolveCompanyInfo } from '@/lib/companyInfo'
import { parseWorkingHours } from '@/lib/workingHours'

export const metadata: Metadata = {
  title: 'İletişim & Showroom',
  description: 'STILSOFT DEMO iletişim bilgileri, telefon, e-posta ve mağaza adresi.',
  alternates: { canonical: '/iletisim' },
}

export default async function ContactPage() {
  const settings = await getStorefront().catch(() => null)

  /*
    TELEFON / E-POSTA / ADRES ARTIK "—" GÖSTERMİYOR (2026-09-09).

    Bu sayfa `loadSeller()` okuyordu; o fonksiyon panelde boş kalan her alanı bilerek "—"
    yapıyor çünkü MESAFELİ SATIŞ SÖZLEŞMESİNİ besliyor — orada uydurma bir firma basmak
    ziyaretçiyi var olmayan bir tüzel kişiyle sözleşmeye sokardı. Ama iletişim sayfası
    sözleşme değil: aynı kural burada üç kartı birden boşaltıyor, altbilgi ise yedeklerle
    dolu görünüyordu. Kullanıcının "firma bilgileri güncellenmiyor" şikâyeti bu çelişkiydi.

    Artık tanıtım yüzeyleri tek kaynaktan okuyor (`lib/companyInfo`), hukuki metinler
    `loadSeller()` ile dürüst kalıyor.
  */
  const company = resolveCompanyInfo(settings)

  const mapsSrc = settings?.mapsEmbedSrc?.trim() || ''
  // Showroom ve merkez ofis AYRI adresler; tek harita gösterilirken müşteri hangisine
  // gideceğini bilemiyordu (2026-09-09 kullanıcı bildirimi).
  const showroomSrc = settings?.showroomMapsEmbedSrc?.trim() || ''
  const hours = parseWorkingHours(settings?.workingHours)
  const socials = [
    { label: 'Instagram', href: settings?.instagramUrl?.trim() || 'https://www.instagram.com/' },
    { label: 'Facebook', href: settings?.facebookUrl?.trim() || 'https://www.facebook.com/' },
    { label: 'YouTube', href: settings?.youtubeUrl?.trim() || 'https://www.youtube.com/' },
  ].filter((s) => s.href)

  return (
    <div className="contact-page-wrapper">
      <div className="wrap">
        {/* Breadcrumbs */}
        <div className="crumbs">
          <Link href="/">Anasayfa</Link>
          <span>›</span>
          <span>İletişim</span>
        </div>

        {/* Hero Header */}
        <div className="contact-header">
          <h1>İletişim</h1>
          <p className="contact-header-desc">
            Ürünlerimiz, siparişleriniz veya servis talepleriniz için bize telefon, e-posta veya mağazamız üzerinden ulaşabilirsiniz.
          </p>
        </div>

        {/* 3'lü Sade İletişim Kartları Grid */}
        <div className="human-contact-cards">
          {/* Telefon Kartı */}
          <div className="human-card">
            <span className="human-card-tag">TELEFON</span>
            <h3>
              <a href={`tel:${company.phone.replace(/[^\d+]/g, '')}`}>{company.phone}</a>
            </h3>
            <p className="human-card-meta">Pazartesi – Cumartesi: 08:30 – 18:00</p>
          </div>

          {/* E-Posta Kartı */}
          <div className="human-card">
            <span className="human-card-tag">E-POSTA</span>
            <h3>
              <a href={`mailto:${company.email}`}>{company.email}</a>
            </h3>
            <p className="human-card-meta">24 saat içinde yanıt verilir</p>
          </div>

          {/* Adres Kartı */}
          <div className="human-card">
            <span className="human-card-tag">SHOWROOM &amp; MERKEZ</span>
            <h3>{company.address}</h3>
            <p className="human-card-meta">Lefkoşa / KKTC</p>
          </div>
        </div>

        {/* Ana Form ve Yan Menü */}
        <div className="contact-main-section">
          <div className="contact-grid">
            {/* Sol: İletişim Formu */}
            <div className="contact-form-col">
              <div className="contact-form-card">
                <div className="form-card-head">
                  <h2>Bize Mesaj Bırakın</h2>
                  <p>Aşağıdaki formu doldurarak bize doğrudan yazabilirsiniz. En kısa sürede dönüş sağlayacağız.</p>
                </div>

                <ContactForm />
              </div>
            </div>

            {/* Sağ: Sıkça Başvurulan Bağlantılar */}
            <div className="contact-side-col">
              <div className="contact-help-card">
                <h3>Hızlı İşlemler</h3>
                <p className="side-help-sub">Aradığınız işlemi doğrudan ilgili sayfadan gerçekleştirebilirsiniz:</p>

                <div className="help-links-list">
                  <Link href="/siparis-takibi" className="human-quick-link">
                    <b>Sipariş Takibi</b>
                    <span>Kargo ve teslimat aşamasını sorgulayın</span>
                  </Link>

                  <Link href="/servis" className="human-quick-link">
                    <b>Yetkili Servis Talebi</b>
                    <span>Arıza, bakım veya montaj kaydı açın</span>
                  </Link>

                  <Link href="/hesabim/faturalarim" className="human-quick-link">
                    <b>Faturalarım</b>
                    <span>E-faturalarınızı görüntüleyin ve indirin</span>
                  </Link>

                  <Link href="/teslimat" className="human-quick-link">
                    <b>Teslimat &amp; Kurulum Şartları</b>
                    <span>KKTC geneli teslimat kuralları ve montaj bilgisi</span>
                  </Link>
                </div>

{/*
                  FİRMA BİLGİLERİ KUTUSU YALNIZCA DOLUYSA ÇIKAR (2026-09-09).

                  Unvan ve vergi bilgisi bayi panelinden girilene kadar kutu "—" gösteriyordu;
                  ziyaretçiye boş bir kurumsal kutu göstermek, kutuyu hiç göstermemekten kötü.
                  Alanlar girildiği anda kutu kendiliğinden geri geliyor.
                */}
                <div className="corporate-details-box">
                  <h4>Firma Bilgileri</h4>
                  <dl className="corp-dl">
                    <dt>Ünvan:</dt>
                    <dd>{company.name}</dd>
                    <dt>Adres:</dt>
                    <dd>{company.address}</dd>
                    {/* Vergi bilgisinin yedeği YOK — uydurulamaz. Girilmediyse satır çıkmaz. */}
                    {company.taxInfo && (
                      <>
                        <dt>Vergi Bilgisi:</dt>
                        <dd>{company.taxInfo}</dd>
                      </>
                    )}
                  </dl>
                </div>

                {socials.length > 0 && (
                  <div className="contact-social-box">
                    <h4>Bizi Takip Edin</h4>
                    <div className="contact-social-row">
                      {socials.map((s) => (
                        <a key={s.label} href={s.href} target="_blank" rel="noopener noreferrer" className="contact-social-chip">
                          {s.label}
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Çalışma saatleri — panelden yönetiliyor, girilmemişse bölüm hiç çıkmıyor. */}
        {hours.length > 0 && (
          <section className="contact-map-section" aria-label="Çalışma saatleri">
            <h2 className="contact-map-title">Çalışma Saatleri</h2>
            <table className="hours-table">
              <tbody>
                {hours.map((row) => (
                  <tr key={row.day}>
                    <td>{row.day}</td>
                    <td className={/kapal/i.test(row.hours) ? 'hours-closed' : undefined}>
                      {row.hours}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {/*
          İKİ AYRI HARİTA (2026-09-09).

          Showroom ile merkez ofis farklı adreslerde. Tek harita varken başlıkta
          "Showroom & Merkez Ofis" yazıyor ama tek bir konum gösteriliyordu; müşteri
          mağazaya gitmek isterken ofise gidebilirdi. İkisi de panelden yönetiliyor ve
          yalnız biri doluysa yalnız o çiziliyor.
        */}
        {(showroomSrc || mapsSrc) && (
          <section className="contact-map-section" aria-label="Konumlarımız">
            <h2 className="contact-map-title">Konumlarımız</h2>
            <div className="contact-maps">
              {showroomSrc && (
                <div className="contact-map-card">
                  <h3>Showroom (Mağaza)</h3>
                  <iframe
                    src={showroomSrc}
                    title="STILSOFT DEMO showroom — harita"
                    allowFullScreen
                    loading="lazy"
                    referrerPolicy="strict-origin-when-cross-origin"
                  />
                </div>
              )}
              {mapsSrc && (
                <div className="contact-map-card">
                  <h3>Merkez Ofis</h3>
                  <iframe
                    src={mapsSrc}
                    title="DEMO TİCARET LİMİTED merkez ofis — harita"
                    allowFullScreen
                    loading="lazy"
                    referrerPolicy="strict-origin-when-cross-origin"
                  />
                </div>
              )}
            </div>
          </section>
        )}

        {/* Alt Bilgi Şeridi */}
        <div className="contact-legal-foot">
          <Link href="/mesafeli-satis">Mesafeli Satış Sözleşmesi</Link>
          <span>·</span>
          <Link href="/gizlilik">Gizlilik</Link>
          <span>·</span>
          <Link href="/kvkk">KVKK</Link>
          <span>·</span>
          <Link href="/cerez">Çerez Politikası</Link>
        </div>
      </div>
    </div>
  )
}
