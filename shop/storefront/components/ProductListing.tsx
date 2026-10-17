import Link from 'next/link'
import ProductCard from '@/components/ProductCard'
import CallbackForm from '@/components/CallbackForm'
import FacetDrawer from '@/components/FacetDrawer'
import { listCategories, listProducts } from '@/lib/api'
import { formatPrice } from '@/lib/format'

export type ListingFilters = {
  minFiyat?: number
  maxFiyat?: number
  stokta: boolean
  montaj: boolean
}

type Props = {
  title: string
  categorySlug?: string
  search?: string
  page: number
  sort: string
  basePath: string
  filters: ListingFilters
  /** Yalnız kampanyalı ürünler (Haftanın Fırsatları). */
  campaignOnly?: boolean
  /** Liste boşken gösterilecek metin. */
  emptyText?: string
  /**
   * Bu listeleme gerçek bir ziyaretçi araması mı (yalnız /arama sayfası true veriyor).
   * Kayıt yalnız ilk sayfada atılıyor: 2. sayfaya geçmek yeni bir arama değil.
   */
  logSearch?: boolean
}

/**
 * VARSAYILAN SIRALAMA — FİYAT: AZALAN (2026-09-09 kullanıcı kararı: "ürün sıralamalarında
 * ada göre değil fiyat azalana göre default sıralama olacak").
 *
 * Değer üç yerde birden geçiyordu (kategori sayfası, tüm ürünler sayfası, adres üretimi) ve
 * sunucuda dördüncü bir varsayılan daha vardı. Sabit tek yerde tutuluyor; adres üretimi de
 * buna bakıp varsayılanı URL'ye YAZMIYOR — böylece `/kategori/ankastre` ile
 * `/kategori/ankastre?sirala=fiyat-azalan` aynı sayfa olarak kalıyor (arama motoru için
 * yinelenen adres üretmemek önemli).
 */
export const VARSAYILAN_SIRALAMA = 'fiyat-azalan'

const sortOptions = [
  { value: 'yeni', label: 'En Yeniler' },
  { value: 'ilgi', label: 'En Uygun Sonuç' },
  { value: 'fiyat-artan', label: 'Fiyat: Artan' },
  { value: 'fiyat-azalan', label: 'Fiyat: Azalan' },
  { value: 'ad', label: 'Ada Göre (A-Z)' },
]

const pricePresets = [
  { label: '0 – 2.500 ₺', min: 0, max: 2500 },
  { label: '2.500 – 7.500 ₺', min: 2500, max: 7500 },
  { label: '7.500 – 15.000 ₺', min: 7500, max: 15000 },
  { label: '15.000 ₺ +', min: 15000, max: undefined },
]

export default async function ProductListing({
  title,
  categorySlug,
  search,
  page,
  sort,
  basePath,
  filters,
  campaignOnly = false,
  emptyText,
  logSearch = false,
}: Props) {
  const [result, categories] = await Promise.all([
    listProducts({
      kategori: categorySlug,
      ara: search,
      sirala: sort,
      sayfa: page,
      adet: 24,
      minFiyat: filters.minFiyat,
      maxFiyat: filters.maxFiyat,
      stokta: filters.stokta,
      montaj: filters.montaj,
      kampanya: campaignOnly || undefined,
      /*
        YALNIZ YAZILAN ARAMA KAYDEDİLİR (2026-09-27). Arama sonucunda fiyat/stok/montaj filtresine
        ya da sıralamaya tıklamak sayfayı yeniden istiyor ve aynı terim FİLTRELİ sonuç sayısıyla
        tekrar kaydediliyordu: "televizyon" 10 sonuç verirken raporda 20 kez "0 sonuç" görünüyordu
        (canlıda doğrulandı: filtresiz 10, 10.000 TL altı 5, montajlı 8). Talep Raporu'nun
        "sonuç çıkmayan" listesi bu yüzden yanıltıyordu.
      */
      kaynak:
        logSearch && search && page === 1 && (sort ?? 'ilgi') === 'ilgi'
          && filters.minFiyat === undefined && filters.maxFiyat === undefined
          && !filters.stokta && !filters.montaj
          ? 'arama'
          : undefined,
    }),
    listCategories(),
  ])

  const totalPages = Math.max(1, Math.ceil(result.totalCount / result.pageSize))
  const filterActive =
    filters.minFiyat !== undefined ||
    filters.maxFiyat !== undefined ||
    filters.stokta ||
    filters.montaj

  /*
    Kaç filtre etkin — mobil "Kategoriler & Filtre" düğmesindeki rozet.
    Fiyat aralığı TEK filtre sayılıyor: müşteri için "0–2.500 ₺" bir seçim, iki değil.
  */
  const etkinFiltreSayisi =
    (filters.minFiyat !== undefined || filters.maxFiyat !== undefined ? 1 : 0) +
    (filters.stokta ? 1 : 0) +
    (filters.montaj ? 1 : 0)

  /** Adres kurulurken bütün seçimler korunuyor; yalnızca değişen parça yenisiyle geliyor. */
  const buildHref = (patch: {
    sayfa?: number
    sirala?: string
    min?: number | null
    max?: number | null
    stokta?: boolean | null
    montaj?: boolean | null
  }) => {
    const qs = new URLSearchParams()
    if (search) qs.set('q', search)

    const nextSort = patch.sirala ?? sort
    if (nextSort && nextSort !== VARSAYILAN_SIRALAMA) qs.set('sirala', nextSort)

    const nextMin = patch.min !== undefined ? (patch.min === null ? undefined : patch.min) : filters.minFiyat
    const nextMax = patch.max !== undefined ? (patch.max === null ? undefined : patch.max) : filters.maxFiyat
    const nextStokta = patch.stokta !== undefined ? patch.stokta : filters.stokta
    const nextMontaj = patch.montaj !== undefined ? patch.montaj : filters.montaj

    if (nextMin !== undefined) qs.set('min', String(nextMin))
    if (nextMax !== undefined) qs.set('max', String(nextMax))
    if (nextStokta) qs.set('stokta', '1')
    if (nextMontaj) qs.set('montaj', '1')

    const nextPage = patch.sirala !== undefined || patch.min !== undefined || patch.max !== undefined || patch.stokta !== undefined || patch.montaj !== undefined
      ? 1
      : (patch.sayfa ?? page)
    if (nextPage > 1) qs.set('sayfa', String(nextPage))

    const query = qs.toString()
    return query ? `${basePath}?${query}` : basePath
  }

  return (
    <div className="wrap listing-page-wrap">
      {/* Breadcrumb Nav */}
      <div className="crumbs">
        <Link href="/">Anasayfa</Link>
        <span>›</span>
        {categorySlug ? (
          <>
            <Link href="/urunler">Katalog</Link>
            <span>›</span>
            <span>{title}</span>
          </>
        ) : (
          <span>{title}</span>
        )}
      </div>

      <div className="listing-layout-grid">
        {/*
          SOL FİLTRELEME KENAR ÇUBUĞU.

          Mobilde `FacetDrawer` bunu bir düğmenin arkasına alıyor: telefonda panel 1184px
          yer kaplıyor ve ilk ürünü 1630px'e itiyordu (bkz. FacetDrawer). Masaüstünde
          çekmece hiçbir şey yapmıyor, kenar çubuğu olduğu yerde kalıyor.
        */}
        <FacetDrawer ozet={`${result.totalCount} ürün`} etkinFiltre={etkinFiltreSayisi}>
        <aside className="facets-sidebar">
          <div className="facet-card">
            <div className="facet-header">
              <h3>Kategoriler</h3>
            </div>
            <div className="facet-links-list">
              <Link
                href="/urunler"
                className={`facet-cat-link ${!categorySlug ? 'active' : ''}`}
              >
                <span>Tüm Ürünler</span>
                <span className="cat-badge">{categories.reduce((acc, c) => acc + c.productCount, 0)}</span>
              </Link>
              {categories.map((c) => (
                <Link
                  key={c.slug}
                  href={`/kategori/${c.slug}`}
                  className={`facet-cat-link ${categorySlug === c.slug ? 'active' : ''}`}
                >
                  <span>{c.name}</span>
                  <span className="cat-badge">{c.productCount}</span>
                </Link>
              ))}
            </div>
          </div>

          {/* SÜZGEÇ FORMU */}
          <form className="facet-card facet-form-card" action={basePath}>
            {search && <input type="hidden" name="q" value={search} />}
            {sort !== VARSAYILAN_SIRALAMA && <input type="hidden" name="sirala" value={sort} />}

            <div className="facet-header">
              <h3>Fiyat Seçenekleri</h3>
            </div>

            {/* Hızlı Fiyat Aralıkları */}
            <div className="quick-price-chips">
              {pricePresets.map((preset, idx) => {
                const isSelected =
                  filters.minFiyat === preset.min &&
                  ((preset.max === undefined && filters.maxFiyat === undefined) ||
                    filters.maxFiyat === preset.max)
                return (
                  <Link
                    key={idx}
                    href={buildHref({
                      min: isSelected ? null : preset.min,
                      max: isSelected ? null : preset.max,
                    })}
                    className={`q-price-chip ${isSelected ? 'active' : ''}`}
                  >
                    {preset.label}
                  </Link>
                )
              })}
            </div>

            {/* Özel Fiyat Aralığı Kutuları */}
            <div className="facet-price-inputs-row">
              <div className="price-input-wrapper">
                <span className="p-label">En Az</span>
                <input
                  type="number"
                  name="min"
                  inputMode="numeric"
                  min={0}
                  placeholder={Math.floor(result.minPrice).toString()}
                  defaultValue={filters.minFiyat ?? ''}
                />
              </div>
              <span className="p-sep">–</span>
              <div className="price-input-wrapper">
                <span className="p-label">En Çok</span>
                <input
                  type="number"
                  name="max"
                  inputMode="numeric"
                  min={0}
                  placeholder={Math.ceil(result.maxPrice).toString()}
                  defaultValue={filters.maxFiyat ?? ''}
                />
              </div>
            </div>

            <div className="facet-divider" />

            <div className="facet-header">
              <h3>Hizmet &amp; Durum</h3>
            </div>

            {/* Checkbox Seçenekleri */}
            <div className="facet-checkboxes">
              <label className="facet-checkbox-row">
                <input
                  type="checkbox"
                  name="stokta"
                  value="1"
                  defaultChecked={filters.stokta}
                />
                <span className="c-box-label">Yalnızca Stokta Olanlar</span>
              </label>

              <label className="facet-checkbox-row">
                <input
                  type="checkbox"
                  name="montaj"
                  value="1"
                  defaultChecked={filters.montaj}
                />
                <span className="c-box-label">Ücretsiz Montaj Hizmeti</span>
              </label>
            </div>

            <div className="facet-actions-row">
              <button className="btn btn-dark btn-sm w-full" type="submit">
                Filtreleri Uygula
              </button>
              {filterActive && (
                <Link className="facet-clear-btn" href={basePath}>
                  Temizle
                </Link>
              )}
            </div>
          </form>
        </aside>
        </FacetDrawer>

        {/* SAĞ ÜRÜN LİSTE ALANI */}
        <div className="listing-main-content">
          <div className="listing-top-bar">
            <div>
              <h1 className="listing-title">{title}</h1>
              <span className="listing-count-text">
                Toplam <b>{result.totalCount}</b> ürün listeleniyor
              </span>
            </div>

            {/* Sıralama Seçenekleri */}
            <div className="listing-sorter-pills" role="group" aria-label="Sıralama">
              {sortOptions.filter((o) => o.value !== 'ilgi' || !!search).map((option) => {
                const isActive = sort === option.value || (!sort && option.value === 'yeni')
                return (
                  <Link
                    key={option.value}
                    href={buildHref({ sirala: option.value })}
                    rel="nofollow"
                    className={`sort-pill ${isActive ? 'active' : ''}`}
                    aria-current={isActive ? 'true' : undefined}
                  >
                    {option.label}
                  </Link>
                )
              })}
            </div>
          </div>

          {/* AKTİF FİLTRE ROZETLERİ ŞERİDİ */}
          {filterActive && (
            <div className="active-filters-bar">
              <span className="af-title">Seçili Filtreler:</span>

              {filters.minFiyat !== undefined || filters.maxFiyat !== undefined ? (
                <Link
                  href={buildHref({ min: null, max: null })}
                  className="af-chip"
                  title="Fiyat filtresini kaldır"
                >
                  <span>
                    Fiyat: {filters.minFiyat ? `${filters.minFiyat} ₺` : '0 ₺'} –{' '}
                    {filters.maxFiyat ? `${filters.maxFiyat} ₺` : 'Üzeri'}
                  </span>
                  <span className="af-x">✕</span>
                </Link>
              ) : null}

              {filters.stokta && (
                <Link
                  href={buildHref({ stokta: null })}
                  className="af-chip"
                  title="Stok filtresini kaldır"
                >
                  <span>Yalnızca Stoktakiler</span>
                  <span className="af-x">✕</span>
                </Link>
              )}

              {filters.montaj && (
                <Link
                  href={buildHref({ montaj: null })}
                  className="af-chip"
                  title="Montaj filtresini kaldır"
                >
                  <span>Ücretsiz Montaj Dahil</span>
                  <span className="af-x">✕</span>
                </Link>
              )}

              <Link href={basePath} className="af-clear-all">
                Tümünü Temizle
              </Link>
            </div>
          )}

          {/* Ürün Listesi Izgarası */}
          {result.items.length === 0 ? (
            <div className="listing-empty-box">
              <div className="empty-inner">
                {/*
                  BAŞLIK VE METİN FİLTREYE GÖRE (2026-09-21). Önceden her iki durumda da
                  "seçtiğiniz filtre kombinasyonu" yazıyordu: hiç filtre seçmeden arama yapan
                  müşteriye olmayan bir filtreyi temizlemesi söyleniyordu.
                */}
                <h3>{filterActive ? 'Seçtiğiniz Filtrelere Uygun Ürün Bulunamadı' : 'Aradığınız Ürünü Bulamadık'}</h3>
                <p>
                  {emptyText ??
                    (filterActive
                      ? 'Filtreleri temizleyerek ya da fiyat aralığını genişleterek tekrar deneyebilirsiniz.'
                      : 'Ürün adını kısaltarak (örneğin yalnız "fırın") tekrar arayabilirsiniz.')}
                </p>
                {filterActive && (
                  <Link className="btn btn-dark" href={basePath}>
                    Filtreleri Temizle
                  </Link>
                )}
              </div>

              {/*
                BOŞ SONUÇTA "SİZİ ARAYALIM" (2026-09-21).

                Burası sitenin en pahalı ekranı: müşteri aramış, ilgilendiğini yazmış ve
                karşısına boş sayfa çıkmış. Elde hiçbir şey kalmadan çıkıyordu.

                Ürünlerin büyük bölümü YALNIZCA fotoğrafı olmadığı için vitrine girmiyor —
                yani aranan şey çoğu zaman gerçekten DEPODA VAR, sadece görünmüyor. O yüzden
                buradaki doğru cevap "ürün yok" değil, "size ulaşalım".

                Arama terimi nota yazılıyor: personel aradığında müşterinin ne istediğini
                zaten biliyor.
              */}
              <div className="listing-empty-callback">
                <CallbackForm
                  kaynak="genel"
                  gorunum="serit"
                  productName={search ? `Arama: ${search}` : undefined}
                />
              </div>
            </div>
          ) : (
            <>
              <div className="grid">
                {result.items.map((item, i) => (
                  <ProductCard
                    key={item.stockCode}
                    item={item}
                    priority={i < 4}
                  />
                ))}
              </div>

              {/* Sayfalama */}
              {totalPages > 1 && (
                <nav className="pager" aria-label="Sayfalar">
                  {page > 1 && <Link href={buildHref({ sayfa: page - 1 })}>Önceki</Link>}
                  {Array.from({ length: totalPages }, (_, i) => i + 1)
                    .filter((p) => p === 1 || p === totalPages || Math.abs(p - page) <= 2)
                    .map((p, idx, arr) => (
                      <span key={p} style={{ display: 'contents' }}>
                        {idx > 0 && arr[idx - 1] !== p - 1 && <span>…</span>}
                        {p === page ? (
                          <span className="on num">{p}</span>
                        ) : (
                          <Link className="num" href={buildHref({ sayfa: p })}>
                            {p}
                          </Link>
                        )}
                      </span>
                    ))}
                  {page < totalPages && <Link href={buildHref({ sayfa: page + 1 })}>Sonraki</Link>}
                </nav>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
