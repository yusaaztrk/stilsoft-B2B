import type { NextConfig } from 'next'
import { buildLegacyRedirectRules } from './lib/legacy-redirects'

/**
 * Ürün görselleri mağaza API'sinin medya ucundan geliyor (ERP doğrudan internete açılmıyor).
 * Next görselleri boyutlandırıp modern biçimlere çevirebilmek için kaynağı önceden bilmek
 * istiyor — sayfa hızı doğrudan sıralama sinyali olduğu için bu optimizasyondan vazgeçmiyoruz.
 */
const mediaUrl = new URL(process.env.NEXT_PUBLIC_MEDIA_URL ?? 'http://localhost:5150/api/media')

const nextConfig: NextConfig = {
  // Üretimde yalnızca gerekli dosyaları (kullanılan node_modules alt kümesi + küçük bir
  // server.js) içeren bağımsız bir klasör üretir — tüm node_modules'ı elle sunucuya taşımak
  // yerine (yavaş, kırılgan) yalnızca .next/standalone kopyalanır.
  output: 'standalone',

  images: {
    remotePatterns: [
      {
        protocol: mediaUrl.protocol.replace(':', '') as 'http' | 'https',
        hostname: mediaUrl.hostname,
        port: mediaUrl.port || undefined,
        pathname: `${mediaUrl.pathname.replace(/\/$/, '')}/**`,
      },
    ],
    // Bu her zaman açık: mağaza tek sunucuda, tek alan adı altında (example.com/shopapi)
    // barındığı için "medya sunucusu" DNS'te bile olsa sunucunun kendi loopback adresine
    // (127.0.0.1) çözülüyor — üretimde de. Next'in SSRF koruması bunu "yerel adres" sayıp
    // görselleri optimize etmeyi reddediyordu (kategori/ürün sayfaları 500 veriyordu).
    // Risksiz: kaynak adres kullanıcıdan gelmiyor, yukarıdaki remotePatterns ile zaten sabit
    // ve tek bir yola (kendi medya ucumuz) kilitli.
    dangerouslyAllowLocalIP: true,
  },

  // Eski OpenCart adresleri → yeni adresler. Liste ve gerekçesi lib/legacy-redirects.ts'te.
  async redirects() {
    return [
      /*
        www → www'suz (2026-10-15). `www.example.com` yönlendirilmeden aynı siteyi
        sunuyordu; Google iki ayrı site görüp ikisini de dizine alıyordu (ör.
        www.example.com/firsatlar). Canonical adres www'suz olduğu için kalıcı (308)
        yönlendirme oraya. Yol ve sorgu (gclid, utm…) korunuyor.
      */
      {
        source: '/:path*',
        has: [{ type: 'host' as const, value: 'www.example.com' }],
        destination: 'https://example.com/:path*',
        permanent: true,
      },
      ...buildLegacyRedirectRules(),
    ]
  },
}

export default nextConfig
