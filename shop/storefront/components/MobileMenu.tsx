'use client'

import Link from 'next/link'
import SearchSuggest from '@/components/SearchSuggest'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { CatalogCategory } from '@/lib/api'

/**
 * Telefon ve tablette gezinme.
 *
 * NEDEN GEREKLİ: masaüstü menüsü (nav.primary) 1080px altında, arama kutusu 780px altında
 * gizleniyor ve yerlerine hiçbir şey konmamıştı. Telefonla giren ziyaretçinin başlıkta yalnızca
 * logo, hesap ve sepet simgesi vardı — kategoriye de aramaya da ulaşmanın yolu yoktu. Perakende
 * trafiğinin çoğunluğu mobil olduğu için bu, katalogun büyük kısmının erişilemez olması demekti.
 *
 * NEDEN İSTEMCİ BİLEŞENİ: açılır çekmece durum tutuyor. Kategori listesi yine sunucudan geliyor
 * (özellik olarak veriliyor), böylece menü içeriği ilk HTML'de yer alıyor ve arama motoru
 * bağlantıları görüyor — istemcide veri çekilseydi bu bağlantılar taranamazdı.
 *
 * NEDEN TAM LİSTE: masaüstü menüsü ilk altı kategoriyi gösteriyor, çünkü yatayda yer o kadar.
 * Çekmecede böyle bir kısıt yok; kısaltmak, mobil ziyaretçiye daha az katalog göstermek olurdu.
 */
export default function MobileMenu({ categories }: { categories: CatalogCategory[] }) {
  const [open, setOpen] = useState(false)

  /*
    ÇEKMECE GÖVDEYE TAŞINIYOR (2026-09-21 — canlıda duran hata).

    SORUN: menü açılınca üstteki duyuru şeridi menünün ÜSTÜNDE kalıyor, çekmecenin başını
    kapatıyordu (kullanıcı ekran görüntüsü).

    NEDEN: bu bileşen `<header class="main-header">` İÇİNDE çiziliyor ve o başlık
    `position: sticky; z-index: 60` ile kendi YIĞIN BAĞLAMINI yaratıyor. Çekmecenin
    `z-index: 90`'ı o bağlamın içinde geçerli; dışarıdaki duyuru şeridini (z-index 65)
    hiçbir değer aşamıyor. Sayıyı büyütmek çözmez — bağlamı terk etmek gerekiyor.

    ÇÖZÜM: çekmece `document.body`ye portal ile taşınıyor; artık başlığın bağlamında değil,
    en üst düzeyde. Tam ekran bir örtü için zaten doğru yer orası.

    `monteEdildi`: portal yalnız tarayıcıda kurulabiliyor. Sunucu render'ında `null` dönüp
    ilk boyamadan sonra kuruluyor — aksi hâlde sunucu/istemci çıktısı ayrışır. Menü
    bağlantılarının ilk HTML'de bulunması SEO için önemliydi; bu yüzden aşağıda portal
    kurulamadığında çekmece yine eski yerinde çiziliyor.
  */
  const [monteEdildi, setMonteEdildi] = useState(false)
  useEffect(() => setMonteEdildi(true), [])
  const pathname = usePathname()

  // Bağlantıya tıklanınca adres değişiyor ama bileşen ayakta kalıyor; çekmece elle
  // kapatılmazsa yeni sayfanın üstünde açık durur.
  useEffect(() => {
    setOpen(false)
  }, [pathname])

  useEffect(() => {
    if (!open) return

    // Çekmece açıkken arkadaki sayfanın kayması, dokunmatik ekranda hangi katmanın
    // kaydırıldığını belirsizleştiriyor.
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    /*
      Yüzen "Ara" ve WhatsApp düğmeleri `z-index: 990`; çekmeceden (90) yüksek oldukları
      için menü açıkken içeriğin üstünde duruyorlardı. Menü zaten telefonu ve WhatsApp'ı
      kendi içinde barındırıyor; açıkken gizlenmeleri hem görüntüyü hem dokunma hedeflerini
      temizliyor.
    */
    document.body.classList.add('menu-acik')

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)

    return () => {
      document.body.style.overflow = previous
      document.body.classList.remove('menu-acik')
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const cekmece = (
      <div className={`drawer-root${open ? ' on' : ''}`} aria-hidden={!open}>
        <button type="button" className="drawer-veil" aria-label="Menüyü kapat" tabIndex={-1} onClick={() => setOpen(false)} />

        <nav className="drawer" aria-label="Site menüsü">
          <div className="drawer-head">
            <span className="logo">
              STILSOFT <em>| DEMO</em>
            </span>
            <button type="button" className="tool" aria-label="Kapat" onClick={() => setOpen(false)}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
                <path d="m6 6 12 12" />
                <path d="M18 6 6 18" />
              </svg>
            </button>
          </div>

          {/*
            Mobil arama da öneri gösteriyor (2026-09-21). Trafiğin çoğu mobil; masaüstü arama
            kutusu 780px altında gizlendiği için mobil kullanıcının tek arama yolu burası.
          */}
          <SearchSuggest variant="drawer" placeholder="Ürün veya model ara" />

          <div className="drawer-scroll">
            <div className="drawer-group">
              <h2>Kategoriler</h2>
              <Link href="/urunler">
                <span>Tüm ürünler</span>
              </Link>
              {categories.map((c) => (
                <Link key={c.slug} href={`/kategori/${c.slug}`}>
                  <span>{c.name}</span>
                  <span className="num">{c.productCount}</span>
                </Link>
              ))}
            </div>

            <div className="drawer-group">
              <h2>Hesabım</h2>
              <Link href="/hesabim">
                <span>Hesabım</span>
              </Link>
              <Link href="/hesabim/siparislerim">
                <span>Siparişlerim</span>
              </Link>
              <Link href="/hesabim/faturalarim">
                <span>Faturalarım</span>
              </Link>
            </div>

            <div className="drawer-group">
              <h2>Yardım</h2>
              <Link href="/siparis-takibi">
                <span>Sipariş takibi</span>
              </Link>
              <Link href="/teslimat">
                <span>Teslimat ve kurulum</span>
              </Link>
              <Link href="/servis">
                <span>Servis talebi</span>
              </Link>
              <Link href="/kurumsal-satis">
                <span>Kurumsal satış &amp; toplu alım</span>
              </Link>
              <Link href="/iletisim">
                <span>İletişim</span>
              </Link>
            </div>

            {/*
              BAYİ GİRİŞİ ÇEKMECEYE TAŞINDI (2026-09-21).

              Üst şeritteki bağlantı telefonda o şeridi üç satıra çıkarıyordu ve perakende
              müşterinin hiç işine yaramıyordu. Şeritten kaldırıldı; ama BAŞKA HİÇBİR YERDE
              yoktu — mobil menüde de, altbilgide de. Kaldırılıp yerine konmasaydı bayiler
              telefondan panele hiç ulaşamazdı.

              Ayrı bir uygulama (b2b.example.com) olduğu için `Link` değil düz `<a>`:
              Next'in istemci yönlendirmesi başka alan adına gidemez.
            */}
            <div className="drawer-group">
              <a
                className="drawer-dealer-link"
                href="https://b2b.example.com"
                target="_blank"
                rel="noopener noreferrer"
              >
                <span>Bayi Girişi</span>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  <path d="M15 3h6v6M10 14 21 3" />
                </svg>
              </a>
            </div>
          </div>
        </nav>
      </div>
  )

  return (
    <>
      <button
        type="button"
        className="tool burger"
        aria-label="Menü"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
          <path d="M4 7h16" />
          <path d="M4 12h16" />
          <path d="M4 17h16" />
        </svg>
      </button>

      {/*
        Çekmece açık değilken de DOM'da duruyor ve yalnızca gizleniyor: bağlantıların ilk
        HTML'de bulunması, arama motorunun mobil sürümde de kategori bağlantılarını görmesini
        sağlıyor (Google mobil sürümü tarıyor).
      */}
      {monteEdildi ? createPortal(cekmece, document.body) : cekmece}
    </>
  )
}