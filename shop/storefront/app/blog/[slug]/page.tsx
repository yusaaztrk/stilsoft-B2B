import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import BlogBody from '@/components/BlogBody'
import { jsonLdScript } from '@/lib/jsonld'
import { formatBlogDate, getPost, listPosts, readingTime, relatedPosts } from '@/lib/blog'

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'

type Params = { slug: string }

/** Bütün yazı adresleri derleme anında üretilir — tarayıcının bulacağı sayfalar bunlar. */
export function generateStaticParams(): Params[] {
  return listPosts().map((p) => ({ slug: p.slug }))
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { slug } = await params
  const post = getPost(slug)
  if (!post) return { title: 'Yazı bulunamadı' }

  const url = `${siteUrl}/blog/${post.slug}`

  return {
    title: post.title,
    description: post.description,
    keywords: post.tags,
    alternates: { canonical: `/blog/${post.slug}` },
    robots: { index: true, follow: true },
    openGraph: {
      type: 'article',
      title: post.title,
      description: post.description,
      url,
      publishedTime: post.publishedAt,
      modifiedTime: post.updatedAt ?? post.publishedAt,
      tags: post.tags,
    },
    twitter: {
      card: 'summary_large_image',
      title: post.title,
      description: post.description,
    },
  }
}

export default async function BlogPostPage({ params }: { params: Promise<Params> }) {
  const { slug } = await params
  const post = getPost(slug)
  if (!post) notFound()

  const related = relatedPosts(post.slug)
  const url = `${siteUrl}/blog/${post.slug}`

  /*
    ÜÇ AYRI ŞEMA, ÜÇ AYRI İŞ:
      Article        → yazının kendisi (başlık, tarih, yazar, yayıncı)
      BreadcrumbList → arama sonucunda adres yolunu göstermek için
      FAQPage        → yazının SSS'i varsa; sonuçta açılır soru-cevap olarak çıkabiliyor

    Üçü tek bir @graph içinde veriliyor. Ayrı ayrı script etiketleri de geçerli olurdu ama
    tek grafikte birbirine referans verebiliyorlar ve sayfada tek bir blok duruyor.
  */
  const graph: Record<string, unknown>[] = [
    {
      '@type': 'Article',
      headline: post.title,
      description: post.description,
      datePublished: post.publishedAt,
      dateModified: post.updatedAt ?? post.publishedAt,
      inLanguage: 'tr-TR',
      mainEntityOfPage: { '@type': 'WebPage', '@id': url },
      author: { '@type': 'Organization', name: 'STILSOFT DEMO' },
      publisher: { '@type': 'Organization', name: 'STILSOFT DEMO' },
      keywords: post.tags.join(', '),
      articleSection: post.category,
    },
    {
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Anasayfa', item: siteUrl },
        { '@type': 'ListItem', position: 2, name: 'Blog', item: `${siteUrl}/blog` },
        { '@type': 'ListItem', position: 3, name: post.title, item: url },
      ],
    },
  ]

  if (post.faqs && post.faqs.length > 0) {
    graph.push({
      '@type': 'FAQPage',
      mainEntity: post.faqs.map((f) => ({
        '@type': 'Question',
        name: f.q,
        acceptedAnswer: { '@type': 'Answer', text: f.a },
      })),
    })
  }

  return (
    <div className="blog-post-page">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript({ '@context': 'https://schema.org', '@graph': graph }) }}
      />

      <div className="wrap blog-wrap">
        <div className="crumbs">
          <Link href="/">Anasayfa</Link>
          <span>›</span>
          <Link href="/blog">Blog</Link>
          <span>›</span>
          <span>{post.title}</span>
        </div>

        <article className="blog-article">
          <header className="blog-article-head">
            <span className="blog-badge">{post.category}</span>
            <h1>{post.title}</h1>
            <p className="blog-lede">{post.excerpt}</p>
            <div className="blog-meta">
              <time dateTime={post.publishedAt}>{formatBlogDate(post.publishedAt)}</time>
              <span>·</span>
              <span>{readingTime(post)} dk okuma</span>
            </div>
          </header>

          <BlogBody blocks={post.blocks} />

          {post.faqs && post.faqs.length > 0 && (
            <section className="blog-faq" aria-label="Sıkça sorulan sorular">
              <h2>Sıkça Sorulan Sorular</h2>
              {post.faqs.map((f) => (
                <details key={f.q} className="blog-faq-item">
                  <summary>{f.q}</summary>
                  <p>{f.a}</p>
                </details>
              ))}
            </section>
          )}

          {/* Yazıdan katalog sayfasına iç bağlantı: okuyanı ürüne götüren tek adım. */}
          {post.relatedCategories && post.relatedCategories.length > 0 && (
            <section className="blog-cta" aria-label="İlgili ürün kategorileri">
              <h2>İlgili ürünlere göz atın</h2>
              <div className="blog-cta-row">
                {post.relatedCategories.map((c) => (
                  <Link key={c.href} href={c.href} className="blog-cta-link">
                    {c.label}
                  </Link>
                ))}
              </div>
            </section>
          )}

          {post.tags.length > 0 && (
            <div className="blog-tags" aria-label="Etiketler">
              {post.tags.map((t) => (
                <span key={t} className="blog-tag">
                  #{t}
                </span>
              ))}
            </div>
          )}
        </article>

        {related.length > 0 && (
          <section className="blog-related" aria-label="İlgili yazılar">
            <h2>İlgili yazılar</h2>
            <div className="blog-grid">
              {related.map((r) => (
                <Link key={r.slug} href={`/blog/${r.slug}`} className="blog-card">
                  <span className="blog-badge">{r.category}</span>
                  <h3>{r.title}</h3>
                  <p>{r.excerpt}</p>
                  <div className="blog-meta">
                    <time dateTime={r.publishedAt}>{formatBlogDate(r.publishedAt)}</time>
                    <span>·</span>
                    <span>{readingTime(r)} dk okuma</span>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
