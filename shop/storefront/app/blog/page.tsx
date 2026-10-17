import type { Metadata } from 'next'
import Link from 'next/link'
import { jsonLdScript } from '@/lib/jsonld'
import { formatBlogDate, listCategoriesOfPosts, listPosts, readingTime } from '@/lib/blog'

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'

export const metadata: Metadata = {
  // Başlıkta "Kıbrıs" var: aramalar bu kelimeyle yapılıyor, şablon zaten sona "KKTC" ekliyor.
  title: 'Blog — Beyaz Eşya, Televizyon ve Klima Rehberleri',
  description:
    'Kıbrıs’ta beyaz eşya, ankastre, televizyon, klima ve küçük ev aleti seçim rehberleri; ölçü tabloları, BTU hesabı, montaj ve bakım bilgileri.',
  alternates: { canonical: '/blog' },
  robots: { index: true, follow: true },
  openGraph: {
    type: 'website',
    title: 'STILSOFT Kıbrıs Blog — Beyaz Eşya, TV ve Klima Rehberleri',
    description:
      'Kıbrıs’ta beyaz eşya, ankastre, televizyon ve klima seçim rehberleri; ölçü tabloları, montaj ve bakım bilgileri.',
    url: `${siteUrl}/blog`,
  },
}

export default function BlogIndexPage() {
  const posts = listPosts()
  const categories = listCategoriesOfPosts()
  const [lead, ...rest] = posts

  /*
    Liste sayfası için CollectionPage + ItemList şeması.

    Tek tek yazıların Article şeması detay sayfasında; burada tarayıcıya "bu bir yazı
    koleksiyonu ve içinde şu adresler var" deniyor. Sitede yeni bir bölüm açıldığında
    taranma hızını artıran en pratik sinyal bu.
  */
  const collectionLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: 'STILSOFT DEMO Blog',
    description:
      'Beyaz eşya, ankastre ve küçük ev aletleri seçim rehberleri; KKTC için montaj, garanti ve bakım bilgileri.',
    url: `${siteUrl}/blog`,
    mainEntity: {
      '@type': 'ItemList',
      itemListElement: posts.map((p, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        url: `${siteUrl}/blog/${p.slug}`,
        name: p.title,
      })),
    },
  }

  return (
    <div className="blog-index-page">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(collectionLd) }} />

      <div className="wrap">
        <div className="crumbs">
          <Link href="/">Anasayfa</Link>
          <span>›</span>
          <span>Blog</span>
        </div>

        <header className="blog-index-head">
          <h1>Blog &amp; Rehberler</h1>
          <p>
            Ankastre set kurmaktan buzdolabı seçmeye, montaj hazırlığından garanti kapsamına kadar
            KKTC’de beyaz eşya alırken işinize yarayacak pratik yazılar.
          </p>
        </header>

        {categories.length > 0 && (
          <div className="blog-cat-row" aria-label="Yazı konuları">
            {categories.map((c) => (
              <span key={c} className="blog-cat-chip">
                {c}
              </span>
            ))}
          </div>
        )}

        {/* En yeni yazı öne çıkarılıyor: liste sayfalarında ilk kartın belirgin olması,
            ziyaretçinin nereden başlayacağını bilmesini sağlıyor. */}
        {lead && (
          <Link href={`/blog/${lead.slug}`} className="blog-lead-card">
            <div className="blog-lead-body">
              <span className="blog-badge">{lead.category}</span>
              <h2>{lead.title}</h2>
              <p>{lead.excerpt}</p>
              <div className="blog-meta">
                <time dateTime={lead.publishedAt}>{formatBlogDate(lead.publishedAt)}</time>
                <span>·</span>
                <span>{readingTime(lead)} dk okuma</span>
              </div>
            </div>
          </Link>
        )}

        <div className="blog-grid">
          {rest.map((post) => (
            <Link key={post.slug} href={`/blog/${post.slug}`} className="blog-card">
              <span className="blog-badge">{post.category}</span>
              <h3>{post.title}</h3>
              <p>{post.excerpt}</p>
              <div className="blog-meta">
                <time dateTime={post.publishedAt}>{formatBlogDate(post.publishedAt)}</time>
                <span>·</span>
                <span>{readingTime(post)} dk okuma</span>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
