import Link from 'next/link'
import { listCategories } from '@/lib/api'
import RecentlyViewedPrune from '@/components/RecentlyViewedPrune'
import NotFoundCallback from '@/components/NotFoundCallback'

/**
 * 404 sayfası.
 *
 * NEDEN ÖNEMLİ: `notFound()` üç yerde çağrılıyor (ürün, kategori, içerik sayfası) ve bu dosya
 * yokken ziyaretçi Next'in çıplak varsayılan ekranına düşüyordu — İngilizce, başlıksız,
 * menüsüz, siteye dönüş bağlantısı olmayan bir sayfa.
 *
 * Bu, teorik bir durum değil: site aynı alan adına, mevcut OpenCart sitesinin YERİNE kuruluyor
 * (§2) ve eski adres yönlendirme tablosu henüz boş (`lib/legacy-redirects.ts`). Yani Google'ın
 * yıllardır bildiği her eski adres, liste doldurulana kadar tam olarak buraya düşüyor. O
 * ziyaretçiyi kaybetmemenin tek yolu buradan katalogun içine bir kapı açmak.
 *
 * Kategoriler katalogdan geliyor, elle yazılmıyor: yeni ürün grubu eklendiğinde güncellenmeyi
 * unutulacak ilk yer sabit bir listedir.
 *
 * Arama kutusu var çünkü buraya düşen ziyaretçinin çoğu belirli bir ürünü arıyor — ona
 * "aradığınızı bulamadık" deyip anasayfaya yollamak, aramayı sıfırdan yaptırmak olurdu.
 */
export default async function NotFound() {
  const categories = await listCategories()

  return (
    <div className="wrap">
      {/*
        Yayından kalkmış ürünü "son baktıklarınız" listesinden temizler (2026-09-21).
        Ekrana hiçbir şey basmaz; yalnız ürün adresiyle gelinen 404'lerde iş yapar.
      */}
      <RecentlyViewedPrune />

      <div className="notfound">
        <span className="notfound-code num">404</span>
        <h1>Aradığınız sayfayı bulamadık</h1>
        <p>
          Sayfa taşınmış, adı değişmiş ya da ürün yayından kalkmış olabilir. Aşağıdan arama
          yapabilir veya ürün gruplarına göz atabilirsiniz.
        </p>

        <form className="notfound-search" action="/arama">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.6-3.6" />
          </svg>
          <input type="search" name="q" placeholder="Ürün veya model ara" aria-label="Ürün ara" />
          <button className="btn btn-dark btn-sm" type="submit">
            Ara
          </button>
        </form>

        <div className="hero-actions">
          <Link className="btn btn-dark" href="/urunler">
            Tüm ürünler
          </Link>
          <Link className="btn btn-line" href="/iletisim">
            Bize ulaşın
          </Link>
        </div>

        {/* Yayından kalkan ürünü arayan ziyaretçiden iz: ad + numara (2026-09-21). */}
        <NotFoundCallback />

        {categories.length > 0 && (
          <div className="notfound-cats">
            <h2>Ürün grupları</h2>
            <div className="notfound-cat-list">
              {categories.map((c) => (
                <Link key={c.slug} href={`/kategori/${c.slug}`}>
                  {c.name} <span className="num">{c.productCount}</span>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
