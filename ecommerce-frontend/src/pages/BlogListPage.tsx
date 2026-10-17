import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
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
}

export function BlogListPage() {
  const [posts, setPosts] = useState<BlogPost[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useSEO({
    title: 'Blog | Ev Aletleri, İpuçları ve Mutfak Sırları',
    description: 'Stilsoft ev aletleri, lezzetli yemek tarifleri, temizlik ipuçları ve mutfak sırları içeren güncel blog yazılarımız.',
  })

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        setLoading(true)
        setError(null)
        const res = await fetch('/api/storefront/blog')
        const json = await readApiResponse(res)
        if (!res.ok) throw new Error(json?.message || 'Blog yazıları yüklenemedi.')
        if (!cancelled) {
          setPosts(json.data || [])
        }
      } catch (e: any) {
        if (!cancelled) setError(e.message || 'Blog yazıları yüklenemedi.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

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

  const getExcerpt = (content: string) => {
    if (!content) return ''
    // Strip HTML tag approximations if any
    const text = content.replace(/<[^>]*>/g, '')
    if (text.length <= 150) return text
    return text.slice(0, 150) + '...'
  }

  return (
    <div className="max-w-7xl mx-auto px-6 pb-20">
      {/* Header */}
      <div className="mb-12 text-center max-w-2xl mx-auto space-y-4">
        <nav className="flex items-center justify-center gap-2 text-sm text-zinc-400">
          <Link to="/" className="hover:text-primary transition-colors">Ana Sayfa</Link>
          <span className="material-symbols-outlined text-xs">chevron_right</span>
          <span className="text-on-surface font-medium">Blog</span>
        </nav>
        <h1 className="text-4xl font-extrabold text-on-surface tracking-tight">Stilsoft Yaşam Bloğu</h1>
        <p className="text-zinc-500 text-sm leading-relaxed">
          Ev teknolojileri, hayatı kolaylaştıran temizlik sırları, pratik tarifler ve yaşam alanınıza değer katacak fikirler.
        </p>
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

      {/* Blog Grid */}
      {!loading && !error && (
        <>
          {posts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <span className="material-symbols-outlined text-6xl text-zinc-200 mb-4 font-light">article</span>
              <h3 className="text-lg font-bold text-zinc-500 mb-2">Henüz yazı yayınlanmadı</h3>
              <p className="text-sm text-zinc-400">Yeni blog yazılarımız çok yakında burada olacak.</p>
            </div>
          ) : (
            <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
              {posts.map((post) => (
                <article
                  key={post.id}
                  className="group flex flex-col justify-between overflow-hidden rounded-2xl border border-zinc-200 bg-white hover:border-primary/30 hover:shadow-xl transition-all duration-300"
                >
                  <Link to={`/blog/${post.slug}`} className="block flex-grow space-y-4">
                    {/* Post Image */}
                    <div className="aspect-[16/10] overflow-hidden bg-zinc-50 border-b border-zinc-100 relative">
                      {post.imageUrl ? (
                        <img
                          src={post.imageUrl}
                          alt={post.title}
                          className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
                          loading="lazy"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-zinc-300">
                          <span className="material-symbols-outlined text-5xl">image</span>
                        </div>
                      )}
                      <div className="absolute bottom-3 left-3 bg-white/90 backdrop-blur-xs px-2.5 py-1 rounded-md text-[10px] font-bold text-zinc-650 uppercase tracking-wide shadow-sm flex items-center gap-1">
                        <span className="material-symbols-outlined text-xs">schedule</span>
                        {post.readTimeMinutes} Dk Okuma
                      </div>
                    </div>

                    {/* Post Info */}
                    <div className="px-5 pb-5 space-y-2">
                      <div className="text-[10px] font-bold text-primary uppercase tracking-wider">
                        {formatDate(post.createdAtUtc)}
                      </div>
                      <h2 className="text-lg font-extrabold text-on-surface leading-snug group-hover:text-primary transition-colors line-clamp-2">
                        {post.title}
                      </h2>
                      <p className="text-xs text-zinc-500 leading-relaxed line-clamp-3">
                        {getExcerpt(post.content)}
                      </p>
                    </div>
                  </Link>

                  {/* Read More button */}
                  <div className="px-5 pb-5 pt-3 border-t border-zinc-100 flex items-center justify-between">
                    <Link
                      to={`/blog/${post.slug}`}
                      className="text-xs font-bold text-primary hover:text-primary-container flex items-center gap-1 transition-colors group-hover:translate-x-1 duration-200"
                    >
                      Devamını Oku
                      <span className="material-symbols-outlined text-sm font-bold">arrow_forward</span>
                    </Link>
                  </div>
                </article>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
