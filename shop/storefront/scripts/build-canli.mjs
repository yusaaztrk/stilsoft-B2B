/**
 * ÜRETİM DERLEMESİ — ortam değişkenlerini KESİN olarak vererek `next build` çalıştırır.
 *
 * <b>Neden bir betik, neden `npm script` içinde tek satır değil:</b> `VAR=deger next build`
 * sözdizimi yalnız POSIX kabuklarında çalışıyor. npm, Windows'ta betikleri **cmd.exe** ile
 * çalıştırıyor ve orada bu satır `'SHOP_API_URL' is not recognized...` hatasıyla düşüyor.
 * (2026-09-09'da tam olarak bu yaşandı.) `cross-env` eklemek yeni bir bağımlılık demekti;
 * Node zaten var, iş dört satır.
 *
 * <b>Neden gerçek ortam değişkeni:</b> Next'in öncelik sırasında `.env.local`,
 * `.env.production`'ı EZER. Bu depoda `.env.local` geliştirme değerlerini tutuyor
 * (`http://localhost:5150`). Düz `next build` ile alınan paket bu yüzden canlıya localhost
 * adresi taşıyor: bütün ürün görselleri kırılıyor, canonical ve site haritası
 * `http://localhost:3000` oluyor. Gerçek `process.env` ise `.env.local`in de üstünde —
 * tuzağı kapatan tek yol bu.
 *
 * Ayrıntı ve paket öncesi doğrulama adımları: `storefront/YAYIN.md`.
 */
import { spawnSync } from 'node:child_process'

const ORTAM = {
  SHOP_API_URL: 'https://example.com/shopapi',
  NEXT_PUBLIC_MEDIA_URL: 'https://example.com/shopapi/api/media',
  NEXT_PUBLIC_SITE_URL: 'https://example.com',
  NEXT_PUBLIC_SHOP_API_URL: 'https://example.com/shopapi',
}

console.log('[yayin] uretim degiskenleriyle derleniyor:')
for (const [k, v] of Object.entries(ORTAM)) console.log(`  ${k}=${v}`)

const sonuc = spawnSync('next', ['build'], {
  stdio: 'inherit',
  env: { ...process.env, ...ORTAM },
  // Windows'ta `next` bir .cmd sarmalayıcısı; kabuk olmadan bulunamıyor.
  shell: true,
})

process.exit(sonuc.status ?? 1)
