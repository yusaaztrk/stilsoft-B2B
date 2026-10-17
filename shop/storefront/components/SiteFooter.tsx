import Image from 'next/image'
import Link from 'next/link'
import { getStorefront, listContentPages } from '@/lib/api'
import { resolveCompanyInfo, whatsAppDigits } from '@/lib/companyInfo'
import { summariseWorkingHours } from '@/lib/workingHours'

export default async function SiteFooter() {
  const [pageList, settings] = await Promise.all([listContentPages(), getStorefront()])
  const pages = pageList.filter((p) => p.showInFooter)

  /*
    Yedekler artık burada DEĞİL, `lib/companyInfo` içinde. Aynı bilgi iki yerde iki ayrı
    listeyle tutuluyordu: altbilgi makul yedeklere düşüyor, İletişim sayfası "—" yazıyordu
    (2026-09-09 "firma bilgileri güncellenmiyor" şikâyeti). Telefon yedeği de ikisinde
    farklıydı — burada 0392 000 00 00, ayar varsayılanında 0850 000 00 00.
  */
  const info = resolveCompanyInfo(settings)
  const phone = info.phone
  const company = info.name
  const email = info.email
  const address = info.address
  const logo = settings.logoImageUrl?.trim() || '/stilsoft-logo.png'

  const instagram = settings.instagramUrl?.trim() || 'https://www.instagram.com/'
  const facebook = settings.facebookUrl?.trim() || 'https://www.facebook.com/'
  const youtube = settings.youtubeUrl?.trim() || 'https://www.youtube.com/'

  // Merkez ofis ve SHOWROOM haritaları panelden. Boşsa ilgili blok hiç çizilmiyor.
  const officeMap = settings.mapsEmbedSrc?.trim() || ''
  const showroomMap = settings.showroomMapsEmbedSrc?.trim() || ''
  const hoursSummary = summariseWorkingHours(settings.workingHours)

  return (
    <footer className="site-footer">
      {/* Üst Avantaj Şeritleri */}
      <div className="footer-perks-bar">
        <div className="wrap perks-grid">
          <div className="perk-box">
            <div className="perk-info">
              <h4>Tüm KKTC'ye Ücretsiz Teslimat</h4>
              <p>Lefkoşa, Girne, Mağusa, Güzelyurt ve İskele'ye güvenli nakliye</p>
            </div>
          </div>
          <div className="perk-box">
            <div className="perk-info">
              <h4>Yetkili Servis ve Montaj</h4>
              <p>Uzman teknisyen kadromuzla randevulu profesyonel kurulum</p>
            </div>
          </div>
          <div className="perk-box">
            <div className="perk-info">
              <h4>3 Yıl Resmi Garanti</h4>
              <p>Tüm Stilsoft ürünlerinde %100 orijinal yedek parça ve garanti</p>
            </div>
          </div>
          <div className="perk-box">
            <div className="perk-info">
              <h4>Güvenli ve Esnek Ödeme</h4>
              <p>Tüm yerel ve uluslararası kartlara 3D Secure güvencesiyle taksit</p>
            </div>
          </div>
        </div>
      </div>

      {/* Ana Footer Kolonları */}
      <div className="footer-main-body">
        <div className="wrap footer-grid">
          {/* Kolon 1: Marka & İletişim */}
          <div className="footer-col brand-col">
            <Link href="/" className="footer-logo" aria-label="STILSOFT DEMO">
              <Image src={logo} alt="STILSOFT DEMO" width={150} height={35} />
            </Link>
            <p className="brand-tagline">
              Küçük ev aletleri, ankastre setler, gıda ve içecek hazırlama sistemlerinde 
              yüksek teknoloji ve estetik tasarımlar.
            </p>

            <div className="footer-contact-details">
              <div className="contact-item">
                <span className="c-label">Çağrı Merkezi &amp; WhatsApp</span>
                <a href={`tel:${phone.replace(/[^\d+]/g, '')}`} className="c-val phone-highlight">
                  {phone}
                </a>
              </div>
              <div className="contact-item">
                <span className="c-label">E-Posta</span>
                <a href={`mailto:${email}`} className="c-val">
                  {email}
                </a>
              </div>
              <div className="contact-item">
                <span className="c-label">Merkez Adres</span>
                <span className="c-val">{address}</span>
              </div>

              {/*
                ÇALIŞMA SAATLERİ (2026-09-09 kullanıcı isteği).
                Panelden yönetiliyor; girilmemişse satır hiç çıkmıyor — uydurma bir saat
                yazmaktansa hiç yazmamak doğru.
              */}
              {hoursSummary && (
                <div className="contact-item">
                  <span className="c-label">Çalışma Saatleri</span>
                  <span className="c-val">{hoursSummary}</span>
                </div>
              )}
            </div>

            {/*
              MERKEZ OFİS HARİTASI — altbilgide (2026-09-09 kullanıcı isteği: "iframe
              vermiştim footerda yok").

              Harita yalnızca İletişim sayfasındaydı; müşteri her sayfadan adrese
              bakabilmeli. Kaynak panelden geliyor ve yalnız google.com/maps/embed adresleri
              kabul ediliyor (rastgele iframe = XSS/clickjacking kapısı) — süzgeç
              StorefrontStore.NormalizeMapsEmbed içinde.

              SHOWROOM DA BASILIYOR (2026-09-09 kullanıcı isteği: "footera showroom un konumu
              da basılsın"). Showroom ile merkez ofis AYRI adresler; müşteri mağazaya gitmek
              isterken ofise gidiyordu. Showroom önce geliyor — ziyaretçinin aradığı çoğunlukla
              mağaza. İkisi de panelden, yalnız dolu olan çiziliyor.

              `loading="lazy"`: altbilgi ilk ekranda değil, harita sayfa açılışını yavaşlatmasın.
            */}
            {(showroomMap || officeMap) && (
              /*
                İKİ HARİTA YAN YANA (2026-09-09 kullanıcı isteği).

                Alt alta dizildiklerinde altbilginin ilk kolonu iki kat uzuyor, sağdaki
                bağlantı kolonları boş kalıyordu. Tek harita varsa ızgara tek sütuna
                düşüyor ve o harita kolonun tamamını kaplıyor — boş bir yer tutucu çizilmiyor.
              */
              <div className={`footer-maps${showroomMap && officeMap ? ' pair' : ''}`}>
                {showroomMap && (
                  <div className="footer-map">
                    <span className="c-label">Showroom (Mağaza)</span>
                    <iframe
                      src={showroomMap}
                      title="STILSOFT showroom konumu"
                      loading="lazy"
                      referrerPolicy="strict-origin-when-cross-origin"
                      allowFullScreen
                    />
                  </div>
                )}

                {officeMap && (
                  <div className="footer-map">
                    <span className="c-label">Merkez Ofis</span>
                    <iframe
                      src={officeMap}
                      title="STILSOFT merkez ofis konumu"
                      loading="lazy"
                      referrerPolicy="strict-origin-when-cross-origin"
                      allowFullScreen
                    />
                  </div>
                )}
              </div>
            )}

            {/* Sosyal Medya Bağlantıları */}
            <div className="footer-social-links" aria-label="Sosyal Medya Hesaplarımız">
              <a
                href={instagram}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Instagram'da STILSOFT DEMO"
                className="social-link-btn"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect width="20" height="20" x="2" y="2" rx="5" ry="5" />
                  <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
                  <line x1="17.5" x2="17.51" y1="6.5" y2="6.5" />
                </svg>
              </a>
              <a
                href={facebook}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Facebook'ta STILSOFT DEMO"
                className="social-link-btn"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />
                </svg>
              </a>
              <a
                href={youtube}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="YouTube'da STILSOFT DEMO"
                className="social-link-btn"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M2.5 17a24.12 24.12 0 0 1 0-10 2 2 0 0 1 1.4-1.4 49.56 49.56 0 0 1 16.2 0A2 2 0 0 1 21.5 7a24.12 24.12 0 0 1 0 10 2 2 0 0 1-1.4 1.4 49.55 49.55 0 0 1-16.2 0A2 2 0 0 1 2.5 17" />
                  <polygon points="10 15 15 12 10 9 10 15" fill="currentColor" />
                </svg>
              </a>
              <a
                href={`https://wa.me/${whatsAppDigits(settings)}`}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="WhatsApp Canlı Destek"
                className="social-link-btn"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                </svg>
              </a>
            </div>
          </div>

          {/* Kolon 2: Popüler Kategoriler */}
          <div className="footer-col">
            <h4 className="footer-title">Kategoriler</h4>
            <ul className="footer-links">
              <li><Link href="/kategori/ankastre">Ankastre & Ocak Setleri</Link></li>
              <li><Link href="/kategori/gida-hazirlama">Gıda Hazırlama & Blender</Link></li>
              <li><Link href="/kategori/icecek-hazirlama">Çaycı & Kahve Makineleri</Link></li>
              <li><Link href="/kategori/ev-temizligi">Süpürgeler & Buharlı Ütüler</Link></li>
              <li><Link href="/kategori/kisisel-bakim">Kişisel Bakım & Saç Şekillendirici</Link></li>
              <li><Link href="/urunler">Tüm Ürün Kataloğu</Link></li>
            </ul>
          </div>

          {/* Kolon 3: Müşteri Hizmetleri & Yardım */}
          <div className="footer-col">
            <h4 className="footer-title">Müşteri Hizmetleri</h4>
            <ul className="footer-links">
              <li><Link href="/kurumsal-satis">Kurumsal Satış &amp; Toplu Alım</Link></li>
              <li><Link href="/servis">Yetkili Servis ve Bakım Talebi</Link></li>
              <li><Link href="/siparis-takibi">Kargo & Sipariş Takibi</Link></li>
              <li><Link href="/teslimat">Teslimat & Randevulu Montaj</Link></li>
              <li><Link href="/garanti">Garanti Koşulları & İade</Link></li>
              <li><Link href="/blog">Blog &amp; Ürün Rehberleri</Link></li>
              <li><Link href="/iletisim">Bize Ulaşın / Şubelerimiz</Link></li>
              {pages.map((page) => (
                <li key={page.slug}>
                  <Link href={`/sayfa/${page.slug}`}>{page.title}</Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Kolon 4: Hesabım & Güvenli Alışveriş */}
          <div className="footer-col">
            <h4 className="footer-title">Hesabım & Güven</h4>
            <ul className="footer-links">
              <li><Link href="/giris">Üye Girişi / Yeni Hesap</Link></li>
              <li><Link href="/hesabim/siparislerim">Geçmiş Siparişlerim</Link></li>
              <li><Link href="/sepet">Alışveriş Sepetim</Link></li>
              <li><Link href="/mesafeli-satis">Mesafeli Satış Sözleşmesi</Link></li>
              <li><Link href="/gizlilik">Gizlilik Politikası</Link></li>
              <li><Link href="/kvkk">KVKK Aydınlatma Metni</Link></li>
            </ul>
          </div>
        </div>
      </div>

      {/* Alt Telif ve Ödeme Kartları Barı */}
      <div className="footer-bottom-strip">
        <div className="wrap bottom-strip-inner">
          <div className="copyright-text">
            <span>© {new Date().getFullYear()} {company}. Tüm hakları saklıdır.</span>
          </div>

          <div className="bottom-badges-row">
            <div className="ssl-shield">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
              <span>256-Bit SSL Sertifikalı Güvenli Alışveriş</span>
            </div>
            <div className="card-icons-list">
              <span className="card-badge">VISA</span>
              <span className="card-badge">Mastercard</span>
              <span className="card-badge">Troy</span>
              <span className="card-badge">3D Secure</span>
            </div>
          </div>
        </div>
      </div>
    </footer>
  )
}
