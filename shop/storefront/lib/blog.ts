/**
 * BLOG / MAKALE MODÜLÜ — arama motoru için içerik yüzeyi.
 *
 * <b>Neden kodda, panelde değil (kullanıcı kararı 2026-09-09):</b> panelin "Sayfalar"
 * özelliği gövdeyi DÜZ METİN saklıyor — bilerek, çünkü panele HTML yazdırmak bir personel
 * hesabı ele geçtiğinde vitrinin her sayfasına betik sokulabilmesi demek. Ama düz metin
 * SEO için yetersiz: başlık hiyerarşisi (H2/H3), listeler, tablo, iç bağlantı ve
 * yapılandırılmış veri üretilemiyor. Yazılar burada YAPILANDIRILMIŞ veri olarak duruyor;
 * işaretlemeyi sayfa bileşeni üretiyor, yani hiçbir noktada dışarıdan HTML çalışmıyor.
 *
 * <b>SEO tarafında ne veriyor:</b> her yazı kendi `title`/`description`/`canonical`ıyla,
 * Article + BreadcrumbList JSON-LD'siyle ve site haritasında gerçek `lastModified`
 * tarihiyle çıkıyor. SSS'i olan yazılar ayrıca FAQPage şeması üretiyor — arama sonucunda
 * açılır soru-cevap olarak görünme ihtimali bunun için var.
 *
 * <b>Yerellik:</b> hedef kitle KKTC. Metinler Lefkoşa/Girne/Mağusa/Güzelyurt/İskele,
 * KKTC elektrik şebekesi, ada koşulları gibi yerel niyetleri açıkça karşılıyor — genel
 * Türkçe içerikle rekabet etmek yerine yerel aramada karşılık bulmak için.
 */

import { BLOG_POSTS_1 } from '@/lib/blogPosts'
import { BLOG_POSTS_2 } from '@/lib/blogPosts2'
import { BLOG_POSTS_3 } from '@/lib/blogPosts3'
import { BLOG_POSTS_4 } from '@/lib/blogPosts4'
import { BLOG_POSTS_5 } from '@/lib/blogPosts5'
import { BLOG_POSTS_6 } from '@/lib/blogPosts6'
import { BLOG_POSTS_7 } from '@/lib/blogPosts7'

/**
 * Bütün yazılar tek listede. Bölümler ayrı dosyalarda duruyor (uzun metinler tek dosyada
 * birikince dosya okunamaz hâle geliyordu); okuma tarafı bu farkı hiç görmüyor.
 *
 * 2026-09-21'de 20 yazıya 26 yazı daha eklendi (bölüm 4-5-6). Gerekçe: "kktc televizyon",
 * "kıbrıs çamaşır makinesi", "kktc klima" aramalarında site hiç görünmüyordu; televizyon ve
 * klima konusunda tek satır içerik yoktu. Yeni bölümlerin konu dağılımı kendi dosyalarının
 * başında yazılı.
 */
const BLOG_POSTS: BlogPost[] = [
  ...BLOG_POSTS_1,
  ...BLOG_POSTS_2,
  ...BLOG_POSTS_3,
  ...BLOG_POSTS_4,
  ...BLOG_POSTS_5,
  ...BLOG_POSTS_6,
  ...BLOG_POSTS_7,
]

export type BlogBlock =
  | { kind: 'p'; text: string }
  | { kind: 'h2'; text: string }
  | { kind: 'h3'; text: string }
  | { kind: 'ul'; items: string[] }
  | { kind: 'ol'; items: string[] }
  | { kind: 'quote'; text: string }
  | { kind: 'note'; title: string; text: string }
  | { kind: 'table'; head: string[]; rows: string[][] }

export type BlogFaq = { q: string; a: string }

export type BlogPost = {
  slug: string
  title: string
  /** Arama sonucunda görünen açıklama. 150-160 karakter hedefleniyor. */
  description: string
  /** Kart ve yazı başında görünen kısa giriş. */
  excerpt: string
  category: string
  tags: string[]
  /** ISO tarih (yyyy-MM-dd). Site haritasındaki `lastModified` bundan üretiliyor. */
  publishedAt: string
  updatedAt?: string
  /** Okuma süresi dakika; boşsa gövdeden hesaplanır. */
  readingMinutes?: number
  blocks: BlogBlock[]
  faqs?: BlogFaq[]
  /** İlgili kategori adresleri — yazıdan katalog sayfasına iç bağlantı. */
  relatedCategories?: { label: string; href: string }[]
}

/** Kelime sayısından okuma süresi. Türkçe için ~190 kelime/dakika kabul edildi. */
export function readingTime(post: BlogPost): number {
  if (post.readingMinutes && post.readingMinutes > 0) return post.readingMinutes

  let words = 0
  for (const b of post.blocks) {
    if (b.kind === 'ul' || b.kind === 'ol') words += b.items.join(' ').split(/\s+/).length
    else if (b.kind === 'table') words += b.rows.flat().join(' ').split(/\s+/).length
    else if (b.kind === 'note') words += (b.title + ' ' + b.text).split(/\s+/).length
    else words += b.text.split(/\s+/).length
  }
  for (const f of post.faqs ?? []) words += (f.q + ' ' + f.a).split(/\s+/).length

  return Math.max(2, Math.round(words / 190))
}

export function formatBlogDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('tr-TR', { day: '2-digit', month: 'long', year: 'numeric' })
}

/**
 * Yazılar yeniden eskiye. Liste sayfası ve site haritası aynı sırayı kullanıyor —
 * iki yerde ayrı sıralama yazılsaydı biri güncellendiğinde diğeri sessizce eskirdi.
 */
export function listPosts(): BlogPost[] {
  return [...BLOG_POSTS].sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : -1))
}

export function getPost(slug: string): BlogPost | null {
  return BLOG_POSTS.find((p) => p.slug === slug) ?? null
}

export function listCategoriesOfPosts(): string[] {
  return Array.from(new Set(BLOG_POSTS.map((p) => p.category)))
}

/**
 * Aynı kategoriden, kendisi hariç en yeni yazılar.
 *
 * İç bağlantı SEO'nun en ucuz kazancı: ziyaretçi sitede kalıyor, tarayıcı da yazılar
 * arasında bağ kuruyor. Kategoride yeterli yazı yoksa listeyi diğer yazılarla tamamlıyor —
 * "İlgili yazılar" bölümünün bazı sayfalarda boş çıkması, olmamasından kötü.
 */
export function relatedPosts(slug: string, count = 3): BlogPost[] {
  const current = getPost(slug)
  if (!current) return []

  const sameCategory = listPosts().filter((p) => p.slug !== slug && p.category === current.category)
  if (sameCategory.length >= count) return sameCategory.slice(0, count)

  const others = listPosts().filter((p) => p.slug !== slug && p.category !== current.category)
  return [...sameCategory, ...others].slice(0, count)
}
