import type { MetadataRoute } from 'next'
import { listAllSlugs, listCategories, listContentPages } from '@/lib/api'
import { listPosts } from '@/lib/blog'

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'

/**
 * Site haritası katalogdan üretiliyor, elle tutulmuyor: yeni ürün yayınlandığı anda
 * haritaya girer, yayından kalkınca çıkar. Elle tutulan haritalar her zaman eskir.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [slugs, categories, contentPages] = await Promise.all([
    listAllSlugs(),
    listCategories(),
    listContentPages(),
  ])
  const now = new Date()

  // Bilgi ve yasal sayfalar haritaya elle giriyor: katalogdan türetilemezler ve sayıları
  // sabit. Hesabım altındaki sayfalar bilerek YOK — oturum gerektiren sayfanın arama
  // sonucunda çıkması, tıklayan herkesi giriş ekranına düşürmek demek.
  const staticPages = [
    '/teslimat',
    '/kurumsal-satis',
    '/servis',
    '/siparis-takibi',
    '/iletisim',
    '/blog',
    '/mesafeli-satis',
    '/gizlilik',
    '/kvkk',
    '/cerez',
  ]

  return [
    { url: siteUrl, lastModified: now, changeFrequency: 'daily', priority: 1 },
    { url: `${siteUrl}/urunler`, lastModified: now, changeFrequency: 'daily', priority: 0.9 },
    ...staticPages.map((path) => ({
      url: `${siteUrl}${path}`,
      lastModified: now,
      changeFrequency: 'monthly' as const,
      priority: 0.3,
    })),
    // Bayinin yazdığı sayfalar. `lastModified` gerçek güncelleme tarihinden geliyor: her
    // taramada "bugün" demek, Google'a her sayfanın her gün değiştiğini söylemek olurdu.
    ...contentPages.map((page) => ({
      url: `${siteUrl}/sayfa/${page.slug}`,
      lastModified: new Date(page.updatedAt),
      changeFrequency: 'monthly' as const,
      priority: 0.4,
    })),
    /*
      Blog yazıları. `lastModified` yazının KENDİ tarihinden geliyor; "bugün" demek
      tarayıcıya her sayfanın her gün değiştiğini söylemek olurdu ve zamanla güven
      kaybettiren bir sinyal. Öncelik kategori sayfalarının altında, ürünlerin üstünde:
      yazılar arama trafiğini getiren giriş sayfaları.
    */
    ...listPosts().map((post) => ({
      url: `${siteUrl}/blog/${post.slug}`,
      lastModified: new Date(post.updatedAt ?? post.publishedAt),
      changeFrequency: 'monthly' as const,
      priority: 0.6,
    })),
    ...categories.map((c) => ({
      url: `${siteUrl}/kategori/${c.slug}`,
      lastModified: now,
      changeFrequency: 'weekly' as const,
      priority: 0.8,
    })),
    ...slugs.map((slug) => ({
      url: `${siteUrl}/urun/${slug}`,
      lastModified: now,
      changeFrequency: 'weekly' as const,
      priority: 0.7,
    })),
  ]
}
