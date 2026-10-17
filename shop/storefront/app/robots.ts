import type { MetadataRoute } from 'next'

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        // Arama ve hesap sayfaları indekslenmez: ilki ince içerik üretir, ikincisi özel veridir.
        disallow: ['/arama', '/hesabim', '/sepet', '/odeme'],
      },
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
  }
}
