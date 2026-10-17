/**
 * GÖRSELLERİ WEBP'YE ÇEVİRİR.
 *
 * Kullanım (storefront klasöründen):
 *   node scripts/webp-cevir.mjs public/posters/_kaynak public/posters 1200
 *   node scripts/webp-cevir.mjs public/renders/_kaynak public/renders 1000
 *
 * Argümanlar: <kaynak klasör> <hedef klasör> [en fazla genişlik]
 *
 * NEDEN AYRI BETİK: afişler tasarımcıdan JPG/PNG geliyor ve olduğu gibi konursa
 * anasayfa megabaytlarca görsel indiriyor. WebP aynı kalitede %60-70 daha küçük.
 * Next'in kendi görsel iyileştirmesi de var ama kaynak dosya yine depoya giriyor;
 * kaynağı bir kez çevirip küçük tutmak hem depoyu hem ilk yüklemeyi rahatlatıyor.
 *
 * DOSYA ADI KORUNUR: `poster-anka-s.jpg` → `poster-anka-s.webp`. Adlar
 * `lib/posters.ts` içindeki listeyle BİREBİR eşleşmeli, yoksa afiş görünmez.
 *
 * Kaynak klasör (`_kaynak`) hedefin ALTINDA olabilir; betik `.webp` dosyalarını ve
 * alt klasörleri atlar, bu yüzden kendi çıktısını tekrar çevirmez.
 */
import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'

const [, , srcArg, outArg, widthArg] = process.argv

if (!srcArg || !outArg) {
  console.error('Kullanım: node scripts/webp-cevir.mjs <kaynak> <hedef> [maxGenislik]')
  process.exit(1)
}

const srcDir = path.resolve(srcArg)
const outDir = path.resolve(outArg)
const maxWidth = Number(widthArg) > 0 ? Number(widthArg) : 1200

if (!fs.existsSync(srcDir)) {
  console.error(`Kaynak klasör yok: ${srcDir}`)
  process.exit(1)
}
fs.mkdirSync(outDir, { recursive: true })

const KABUL = new Set(['.jpg', '.jpeg', '.png', '.tif', '.tiff', '.avif'])

const dosyalar = fs
  .readdirSync(srcDir, { withFileTypes: true })
  .filter((d) => d.isFile() && KABUL.has(path.extname(d.name).toLowerCase()))
  .map((d) => d.name)
  .sort()

if (dosyalar.length === 0) {
  console.log(`${srcDir} içinde çevrilecek görsel yok.`)
  process.exit(0)
}

let toplamOnce = 0
let toplamSonra = 0

for (const ad of dosyalar) {
  const girdi = path.join(srcDir, ad)
  const cikti = path.join(outDir, `${path.parse(ad).name}.webp`)

  const meta = await sharp(girdi).metadata()
  const yenidenBoyutla = (meta.width ?? 0) > maxWidth

  await sharp(girdi)
    .rotate() // EXIF yönünü uygula, yoksa dikey afiş yan yatabiliyor
    .resize(yenidenBoyutla ? { width: maxWidth, withoutEnlargement: true } : undefined)
    .webp({ quality: 82, effort: 5 })
    .toFile(cikti)

  const once = fs.statSync(girdi).size
  const sonra = fs.statSync(cikti).size
  toplamOnce += once
  toplamSonra += sonra

  const kb = (n) => `${Math.round(n / 1024)} KB`
  console.log(
    `${ad}  ${meta.width}x${meta.height}  ${kb(once)}  →  ${path.basename(cikti)}  ${kb(sonra)}` +
      (yenidenBoyutla ? `  (en ${maxWidth}px'e indirildi)` : ''),
  )
}

const oran = toplamOnce > 0 ? Math.round((1 - toplamSonra / toplamOnce) * 100) : 0
console.log(
  `\n${dosyalar.length} dosya çevrildi. ` +
    `${Math.round(toplamOnce / 1024)} KB → ${Math.round(toplamSonra / 1024)} KB (%${oran} küçüldü)`,
)
console.log(`Hedef: ${outDir}`)
