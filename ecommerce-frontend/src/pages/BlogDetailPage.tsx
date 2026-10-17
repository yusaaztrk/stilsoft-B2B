import { useEffect, useMemo, useState } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import { readApiResponse } from '../lib/api'
import { useSEO } from '../hooks/useSEO'

interface BlogPost {
  id: string
  title: string
  slug: string
  content: string
  imageUrl: string
  metaTitle: string
  metaDescription: string
  readTimeMinutes: number
  createdAtUtc: string
  updatedAtUtc: string
}

export function BlogDetailPage() {
  const { slug } = useParams()
  const navigate = useNavigate()
  const [post, setPost] = useState<BlogPost | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    if (!slug) return
    ;(async () => {
      try {
        setLoading(true)
        setError(null)
        const res = await fetch(`/api/storefront/blog/${encodeURIComponent(slug)}`)
        const json = await readApiResponse(res)
        if (!res.ok) throw new Error(json?.message || 'Blog yazısı bulunamadı.')
        if (!cancelled) {
          setPost(json.data)
        }
      } catch (e: any) {
        if (!cancelled) setError(e.message || 'Blog yazısı yüklenemedi.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [slug])

  // JSON-LD structured data for article/blog posting
  const blogSchema = useMemo(() => {
    if (!post) return null
    return {
      '@context': 'https://schema.org',
      '@type': 'BlogPosting',
      headline: post.title,
      image: post.imageUrl ? [post.imageUrl] : [],
      datePublished: post.createdAtUtc,
      dateModified: post.updatedAtUtc || post.createdAtUtc,
      author: {
        '@type': 'Organization',
        name: 'Stilsoft KKTC',
      },
      publisher: {
        '@type': 'Organization',
        name: 'Stilsoft KKTC',
        logo: {
          '@type': 'ImageObject',
          url: window.location.origin + '/logo.png', // Fallback or dynamic logic
        },
      },
      description: post.metaDescription || post.title,
      mainEntityOfPage: {
        '@type': 'WebPage',
        '@id': window.location.href,
      },
    }
  }, [post])

  useSEO({
    title: post?.metaTitle || post?.title,
    description: post?.metaDescription || (post ? post.content.replace(/<[^>]*>/g, '').slice(0, 150) : undefined),
    image: post?.imageUrl || undefined,
    type: 'article',
    schema: blogSchema,
  })

  const formatDate = (dateStr: string) => {
    if (!dateStr) return ''
    try {
      const date = new Date(dateStr)
      return date.toLocaleDateString('tr-TR', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    } catch {
      return ''
    }
  }

  return (
    <div className="max-w-4xl mx-auto px-6 pb-20">
      {/* Back & Breadcrumbs */}
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <nav className="flex items-center gap-2 text-xs text-zinc-400">
          <Link to="/" className="hover:text-primary transition-colors">Ana Sayfa</Link>
          <span className="material-symbols-outlined text-xs">chevron_right</span>
          <Link to="/blog" className="hover:text-primary transition-colors">Blog</Link>
          <span className="material-symbols-outlined text-xs">chevron_right</span>
          <span className="text-on-surface font-medium truncate max-w-[200px]">{post?.title || 'Yazı'}</span>
        </nav>
        <button
          onClick={() => navigate('/blog')}
          className="inline-flex items-center gap-1 text-xs font-bold text-zinc-500 hover:text-zinc-900"
        >
          <span className="material-symbols-outlined text-sm font-bold">arrow_back</span>
          Tüm Yazılara Dön
        </button>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-xl border border-primary/20 bg-primary/5 p-6 text-sm text-primary flex items-center gap-3">
          <span className="material-symbols-outlined">error</span>
          {error}
        </div>
      )}

      {/* Article Content */}
      {!loading && !error && post && (
        <article className="space-y-8">
          {/* Header metadata */}
          <div className="space-y-4 text-center md:text-left">
            <div className="flex flex-wrap items-center justify-center md:justify-start gap-4 text-xs font-bold text-zinc-400">
              <span className="bg-primary/10 text-primary px-2.5 py-1 rounded-md uppercase tracking-wider">Yaşam & Teknoloji</span>
              <span className="flex items-center gap-1">
                <span className="material-symbols-outlined text-sm">calendar_month</span>
                {formatDate(post.createdAtUtc)}
              </span>
              <span className="flex items-center gap-1">
                <span className="material-symbols-outlined text-sm">schedule</span>
                {post.readTimeMinutes} Dakika Okuma
              </span>
            </div>
            <h1 className="text-3xl md:text-4xl font-extrabold text-on-surface leading-tight tracking-tight">
              {post.title}
            </h1>
          </div>

          {/* Hero Image */}
          {post.imageUrl && (
            <div className="aspect-[21/9] overflow-hidden rounded-3xl bg-zinc-55 border border-zinc-150 shadow-md">
              <img
                src={post.imageUrl}
                alt={post.title}
                className="w-full h-full object-cover"
              />
            </div>
          )}

          {/* Rich Content Area */}
          <div className="prose prose-zinc max-w-none prose-sm md:prose-base leading-relaxed text-zinc-700 whitespace-pre-wrap font-medium">
            {post.content}
          </div>

          {/* Sharing Section */}
          <div className="border-t border-zinc-200 pt-8 mt-12 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Paylaş:</span>
              <a
                href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(window.location.href)}`}
                target="_blank"
                rel="noreferrer"
                className="grid h-8 w-8 place-items-center rounded-full bg-zinc-100 text-zinc-550 hover:bg-primary/10 hover:text-primary transition-all active:scale-95"
                title="Facebook'ta Paylaş"
              >
                <img alt="Facebook" className="w-3.5 h-3.5" src="https://lh3.googleusercontent.com/aida-public/AB6AXuCCZfdrYAESUY6v8lv0gsByL2HHBmExla0uNKeZZGTLBiOzzWEGV1sXRgf1GCpo6NF4UcxtG-a3mg-KyXKr_a1k7hN01OASsgTepSj0rML3mJ9KWd5lUcn6-Llsk8YXDL8quuBrIgFK3nDqg98NwX79dGbEXaalgS6RJj8P8GIykYop8e_kwrXYkYabbS4OiylzBHDzj7lGFSZkuAM0-9DdfgEMGezgSEcJ6SOe1Rm3x_jvpjY7mVD-j6EEucwix2BeXcs8ie2Mv_U" />
              </a>
              <button
                onClick={() => {
                  void navigator.clipboard.writeText(window.location.href)
                  alert('Sayfa linki kopyalandı!') // custom toast can be triggered instead
                }}
                className="grid h-8 w-8 place-items-center rounded-full bg-zinc-100 text-zinc-550 hover:bg-primary/10 hover:text-primary transition-all active:scale-95"
                title="Bağlantıyı Kopyala"
              >
                <span className="material-symbols-outlined text-sm">link</span>
              </button>
            </div>
            
            <Link
              to="/blog"
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-zinc-100 hover:bg-zinc-200 text-xs font-bold text-zinc-700 rounded-xl transition-all"
            >
              <span className="material-symbols-outlined text-sm font-bold">arrow_back</span>
              Diğer Blog Yazılarını Oku
            </Link>
          </div>
        </article>
      )}
    </div>
  )
}
