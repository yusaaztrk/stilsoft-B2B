import { useEffect, useMemo, useState } from 'react'
import { AdminLayout } from '../components/admin/AdminLayout'
import { MediaLibraryModal } from '../components/ui/MediaLibraryModal'
import { useToast } from '../components/ui/ToastContext'
import { useConfirm } from '../components/ui/ConfirmContext'
import { getAdminToken, readApiResponse } from '../lib/api'
import { generateSlug } from '../lib/slug'

type BlogPost = {
  id: string
  title: string
  slug: string
  content: string
  imageUrl: string
  metaTitle: string
  metaDescription: string
  readTimeMinutes: number
  isPublished: boolean
  createdAtUtc: string
  updatedAtUtc: string
}

export function AdminBlogPage() {
  const { showToast } = useToast()
  const confirm = useConfirm()

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [posts, setPosts] = useState<BlogPost[]>([])
  const [q, setQ] = useState('')

  // Modal & Form states
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingPost, setEditingPost] = useState<BlogPost | null>(null)
  const [title, setTitle] = useState('')
  const [slug, setSlug] = useState('')
  const [content, setContent] = useState('')
  const [imageUrl, setImageUrl] = useState('')
  const [metaTitle, setMetaTitle] = useState('')
  const [metaDescription, setMetaDescription] = useState('')
  const [readTime, setReadTime] = useState(5)
  const [isPublished, setIsPublished] = useState(true)
  const [saveLoading, setSaveLoading] = useState(false)

  // Media Library Picker state
  const [isMediaOpen, setIsMediaOpen] = useState(false)

  const authHeader = useMemo(() => {
    const token = getAdminToken()
    return token ? { Authorization: `Bearer ${token}` } : null
  }, [])

  const loadPosts = async () => {
    if (!authHeader) return
    try {
      setLoading(true)
      setError(null)
      const res = await fetch('/api/admin/blog', { headers: authHeader })
      const json = await readApiResponse(res)
      if (!res.ok) throw new Error(json?.message || 'Blog yazıları yüklenemedi.')
      setPosts(json.data || [])
    } catch (err: any) {
      setError(err.message || 'Veriler yüklenemedi.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadPosts()
  }, [authHeader])

  const filteredPosts = useMemo(() => {
    const query = q.trim().toLowerCase()
    if (!query) return posts
    return posts.filter((p) => p.title.toLowerCase().includes(query) || p.slug.toLowerCase().includes(query))
  }, [posts, q])

  // Form helpers
  const handleOpenAddModal = () => {
    setEditingPost(null)
    setTitle('')
    setSlug('')
    setContent('')
    setImageUrl('')
    setMetaTitle('')
    setMetaDescription('')
    setReadTime(5)
    setIsPublished(true)
    setIsModalOpen(true)
  }

  const handleOpenEditModal = (post: BlogPost) => {
    setEditingPost(post)
    setTitle(post.title)
    setSlug(post.slug)
    setContent(post.content)
    setImageUrl(post.imageUrl)
    setMetaTitle(post.metaTitle)
    setMetaDescription(post.metaDescription)
    setReadTime(post.readTimeMinutes)
    setIsPublished(post.isPublished)
    setIsModalOpen(true)
  }

  const handleSavePost = async () => {
    if (!title.trim()) {
      showToast('Başlık alanı zorunludur.', 'warning')
      return
    }
    if (!content.trim()) {
      showToast('İçerik alanı zorunludur.', 'warning')
      return
    }
    if (!authHeader) return

    try {
      setSaveLoading(true)
      const payload = {
        title: title.trim(),
        slug: slug.trim() || generateSlug(title),
        content: content.trim(),
        imageUrl: imageUrl.trim(),
        metaTitle: metaTitle.trim() || title.trim(),
        metaDescription: metaDescription.trim() || content.trim().slice(0, 150),
        readTimeMinutes: Number(readTime) || 5,
        isPublished,
      }

      const url = editingPost ? `/api/admin/blog/${editingPost.id}` : '/api/admin/blog'
      const method = editingPost ? 'PUT' : 'POST'

      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...authHeader,
        },
        body: JSON.stringify(payload),
      })

      const json = await readApiResponse(res)
      if (!res.ok || !json?.success) {
        throw new Error(json?.message || 'Blog yazısı kaydedilemedi.')
      }

      showToast(editingPost ? 'Yazı başarıyla güncellendi.' : 'Yazı başarıyla eklendi.', 'success')
      setIsModalOpen(false)
      loadPosts()
    } catch (err: any) {
      showToast(err.message || 'Kaydedilirken hata oluştu.', 'error')
    } finally {
      setSaveLoading(false)
    }
  }

  const handleDeletePost = async (id: string) => {
    const ok = await confirm('Bu blog yazısını kalıcı olarak silmek istediğinizden emin misiniz?', {
      type: 'danger',
      confirmText: 'Evet, Sil',
      title: 'Yazıyı Sil',
    })
    if (!ok) return
    if (!authHeader) return

    try {
      setLoading(true)
      const res = await fetch(`/api/admin/blog/${id}`, {
        method: 'DELETE',
        headers: { ...authHeader },
      })
      const json = await readApiResponse(res)
      if (!res.ok || !json?.success) {
        throw new Error(json?.message || 'Yazı silnemedi.')
      }
      showToast('Blog yazısı başarıyla silindi.', 'success')
      loadPosts()
    } catch (err: any) {
      showToast(err.message || 'Silinirken hata oluştu.', 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AdminLayout
      title="Blog Yönetimi"
      subtitle="Mağazanız için SEO dostu blog yazıları oluşturun, düzenleyin ve içerik pazarlaması yapın."
      top={
        <div className="flex items-center gap-2">
          <button
            onClick={handleOpenAddModal}
            className="flex h-10 px-4 items-center gap-2 rounded-2xl bg-primary hover:bg-[#c00000] text-white text-xs font-bold shadow-md transition-all active:scale-[0.98]"
          >
            <span className="material-symbols-outlined text-[18px]">add</span>
            Yeni Blog Yazısı Ekle
          </button>
          <button
            onClick={loadPosts}
            className="flex h-10 w-10 items-center justify-center rounded-2xl border border-zinc-200/80 bg-white text-zinc-700 shadow-[0_2px_8px_rgba(0,0,0,0.02)] transition-all duration-200 hover:border-zinc-300 hover:bg-zinc-50 hover:text-zinc-900 active:scale-[0.98]"
            title="Yenile"
          >
            <span className="material-symbols-outlined text-[20px]">refresh</span>
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Search input */}
        <div className="flex items-center gap-3 rounded-2xl border border-zinc-200/80 bg-white px-4 py-3 text-sm text-zinc-700 shadow-[0_2px_8px_rgba(0,0,0,0.02)] focus-within:ring-4 focus-within:ring-[#df0000]/5 focus-within:border-[#df0000] transition-all">
          <span className="material-symbols-outlined text-zinc-400">search</span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Başlık veya URL adresi (slug) ile ara..."
            className="w-full bg-transparent text-sm text-zinc-900 placeholder:text-zinc-400 outline-none"
          />
        </div>

        {/* Loading / Error States */}
        {loading && posts.length === 0 && (
          <div className="flex items-center justify-center p-12 text-sm text-zinc-400 font-medium bg-white rounded-3xl border border-zinc-200/80 shadow-[0_2px_8px_rgba(0,0,0,0.02)]">
            <span className="animate-spin mr-2 h-4 w-4 border-2 border-zinc-300 border-t-zinc-600 rounded-full" />
            Yazılar yükleniyor...
          </div>
        )}
        {error && (
          <div className="rounded-3xl border border-rose-200 bg-rose-50/50 p-5 text-sm text-rose-700 shadow-[0_2px_8px_rgba(0,0,0,0.02)]">
            <div className="flex gap-2 items-center font-semibold mb-1">
              <span className="material-symbols-outlined text-rose-500 text-[18px]">error</span>
              Hata Oluştu
            </div>
            <p className="text-rose-600">{error}</p>
          </div>
        )}

        {/* Posts Table */}
        {!loading && !error && (
          <div className="overflow-hidden rounded-3xl border border-zinc-200/80 bg-white shadow-[0_2px_8px_rgba(0,0,0,0.02),0_8px_24px_rgba(0,0,0,0.02)]">
            <div className="grid grid-cols-12 gap-3 border-b border-zinc-200/80 bg-zinc-50/80 px-6 py-4 text-[10px] font-extrabold tracking-wider text-zinc-400 uppercase">
              <div className="col-span-5">Yazı Başlığı</div>
              <div className="col-span-3">URL Adresi (Slug)</div>
              <div className="col-span-2 text-center">Okuma Süresi</div>
              <div className="col-span-1 text-center">Durum</div>
              <div className="col-span-1 text-right">İşlemler</div>
            </div>

            <div className="divide-y divide-zinc-100">
              {filteredPosts.map((post) => (
                <div
                  key={post.id}
                  className="grid grid-cols-12 gap-3 px-6 py-4.5 text-xs text-zinc-600 hover:bg-zinc-50/50 transition-colors items-center"
                >
                  <div className="col-span-5 flex items-center gap-3">
                    {post.imageUrl ? (
                      <div className="w-10 h-10 rounded-xl border border-zinc-250/60 overflow-hidden bg-white flex items-center justify-center shrink-0 p-0.5 shadow-sm">
                        <img src={post.imageUrl} className="h-full w-full object-cover rounded-lg" />
                      </div>
                    ) : (
                      <div className="w-10 h-10 rounded-xl bg-zinc-100 text-zinc-400 flex items-center justify-center shrink-0 shadow-xs">
                        <span className="material-symbols-outlined text-lg">article</span>
                      </div>
                    )}
                    <div className="flex flex-col truncate">
                      <span className="truncate text-zinc-900 font-bold text-sm">{post.title}</span>
                      <span className="text-[10px] text-zinc-400 mt-0.5">
                        {new Date(post.createdAtUtc).toLocaleDateString('tr-TR')}
                      </span>
                    </div>
                  </div>

                  <div className="col-span-3 truncate font-mono text-[11px] text-zinc-500">
                    /blog/{post.slug}
                  </div>

                  <div className="col-span-2 text-center font-bold text-zinc-700">
                    {post.readTimeMinutes} Dk
                  </div>

                  <div className="col-span-1 text-center">
                    <span
                      className={`inline-flex items-center justify-center px-2 py-0.5 rounded-full text-[10px] font-bold border uppercase tracking-wider ${
                        post.isPublished
                          ? 'border-green-200 bg-green-50 text-green-700'
                          : 'border-zinc-200 bg-zinc-50 text-zinc-500'
                      }`}
                    >
                      {post.isPublished ? 'Yayında' : 'Taslak'}
                    </span>
                  </div>

                  <div className="col-span-1 flex justify-end gap-1.5">
                    <button
                      onClick={() => handleOpenEditModal(post)}
                      className="w-7 h-7 rounded-lg border border-zinc-200 bg-white hover:bg-zinc-50 hover:text-zinc-900 text-zinc-500 flex items-center justify-center transition active:scale-90 shadow-sm shrink-0"
                      title="Düzenle"
                    >
                      <span className="material-symbols-outlined text-[15px]">edit</span>
                    </button>
                    <button
                      onClick={() => handleDeletePost(post.id)}
                      className="w-7 h-7 rounded-lg border border-zinc-200 bg-white hover:bg-rose-50 hover:text-rose-600 text-zinc-500 flex items-center justify-center transition active:scale-90 shadow-sm shrink-0"
                      title="Sil"
                    >
                      <span className="material-symbols-outlined text-[15px]">delete</span>
                    </button>
                  </div>
                </div>
              ))}

              {filteredPosts.length === 0 && (
                <div className="px-6 py-12 text-center text-zinc-400 font-medium italic bg-white">
                  Henüz blog yazısı eklenmemiş veya arama sonucu bulunamadı.
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Blog Post Add/Edit Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-[70] animate-in fade-in duration-200">
          <div className="absolute inset-0 bg-zinc-950/45 backdrop-blur-sm" onClick={() => setIsModalOpen(false)} />
          <div className="absolute inset-0 flex items-center justify-center p-4">
            <div className="w-full max-w-2xl overflow-hidden rounded-[28px] border border-zinc-200 bg-white shadow-2xl flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200">
              {/* Modal Header */}
              <div className="flex items-center justify-between border-b border-zinc-150 px-6 py-4 bg-zinc-50/50 shrink-0">
                <div>
                  <div className="text-[10px] font-extrabold tracking-widest text-[#df0000] uppercase">
                    {editingPost ? 'YAZIYI DÜZENLE' : 'YENİ YAZI EKLE'}
                  </div>
                  <div className="mt-0.5 text-lg font-black text-zinc-950">
                    {editingPost ? 'Blog Yazısı Detaylarını Düzenle' : 'Blog Yazısı Ekle'}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="h-9 w-9 rounded-xl hover:bg-zinc-150 text-zinc-550 hover:text-zinc-800 flex items-center justify-center transition active:scale-90"
                >
                  <span className="material-symbols-outlined text-[20px]">close</span>
                </button>
              </div>

              {/* Modal Body */}
              <div className="p-6 space-y-4 overflow-y-auto custom-scrollbar flex-1">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wide">Yazı Başlığı *</label>
                    <input
                      type="text"
                      required
                      value={title}
                      onChange={(e) => {
                        setTitle(e.target.value)
                        if (!editingPost) setSlug(generateSlug(e.target.value))
                      }}
                      placeholder="Örn: Ev Aletlerinde Enerji Tasarrufu"
                      className="w-full rounded-2xl border border-zinc-200 bg-white px-3.5 py-2.5 text-xs text-zinc-855 outline-none focus:ring-4 focus:ring-primary/10 focus:border-primary transition-all duration-200"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wide">URL Adresi (Slug)</label>
                    <input
                      type="text"
                      value={slug}
                      onChange={(e) => setSlug(generateSlug(e.target.value))}
                      placeholder="url-adresi-slug"
                      className="w-full rounded-2xl border border-zinc-200 bg-white px-3.5 py-2.5 text-xs text-zinc-855 outline-none focus:ring-4 focus:ring-primary/10 focus:border-primary transition-all duration-200 font-mono"
                    />
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wide">Görsel URL</label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={imageUrl}
                        onChange={(e) => setImageUrl(e.target.value)}
                        placeholder="Örn: /uploads/resim.jpg"
                        className="flex-1 rounded-2xl border border-zinc-200 bg-white px-3.5 py-2.5 text-xs text-zinc-855 outline-none focus:ring-4 focus:ring-primary/10 focus:border-primary transition-all duration-200"
                      />
                      <button
                        type="button"
                        onClick={() => setIsMediaOpen(true)}
                        className="px-4 rounded-2xl border border-zinc-200 hover:border-zinc-300 hover:bg-zinc-50 text-zinc-700 text-xs font-bold transition active:scale-95 flex items-center justify-center shrink-0"
                      >
                        Seç
                      </button>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wide">Okuma Süresi (Dakika)</label>
                    <input
                      type="number"
                      min={1}
                      value={readTime}
                      onChange={(e) => setReadTime(Math.max(1, Number(e.target.value)))}
                      className="w-full rounded-2xl border border-zinc-200 bg-white px-3.5 py-2.5 text-xs text-zinc-855 outline-none focus:ring-4 focus:ring-primary/10 focus:border-primary transition-all duration-200"
                    />
                  </div>
                </div>

                {imageUrl && (
                  <div className="h-24 w-fit max-w-full rounded-xl overflow-hidden border border-zinc-150 bg-zinc-50 p-2 flex items-center justify-center animate-in fade-in duration-200">
                    <img src={imageUrl} className="h-full object-contain" alt="Yazı görseli" />
                  </div>
                )}

                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wide">İçerik Metni *</label>
                  <textarea
                    rows={8}
                    required
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    placeholder="Blog yazısı içeriğini buraya girin..."
                    className="w-full rounded-2xl border border-zinc-200 bg-white px-3.5 py-2.5 text-xs text-zinc-855 outline-none focus:ring-4 focus:ring-primary/10 focus:border-primary transition-all duration-200 font-medium leading-relaxed resize-none"
                  />
                </div>

                {/* SEO Section Accordion/Card */}
                <div className="bg-zinc-50 border border-zinc-200 p-5 rounded-2xl space-y-4">
                  <div className="text-xs font-bold text-zinc-800 flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-[16px] text-zinc-500">search</span>
                    SEO Meta Ayarları (Arama Motoru Optimizasyonu)
                  </div>
                  
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wide">SEO Başlığı (Meta Title)</label>
                      <input
                        type="text"
                        value={metaTitle}
                        onChange={(e) => setMetaTitle(e.target.value)}
                        placeholder={title || 'Max 60 karakter başlık'}
                        maxLength={60}
                        className="w-full rounded-2xl border border-zinc-200 bg-white px-3.5 py-2.5 text-xs text-zinc-855 outline-none focus:ring-4 focus:ring-primary/10 focus:border-primary transition-all duration-200"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wide">SEO Açıklaması (Meta Description)</label>
                      <textarea
                        rows={2}
                        value={metaDescription}
                        onChange={(e) => setMetaDescription(e.target.value)}
                        placeholder="Yazı hakkında arama motorlarında çıkacak maks 160 karakterlik açıklama."
                        maxLength={160}
                        className="w-full rounded-2xl border border-zinc-200 bg-white px-3.5 py-2.5 text-xs text-zinc-855 outline-none focus:ring-4 focus:ring-primary/10 focus:border-primary transition-all duration-200 resize-none"
                      />
                    </div>
                  </div>
                </div>

                {/* Publication checkbox */}
                <div className="flex items-center gap-2 pt-2">
                  <input
                    type="checkbox"
                    id="isPublished"
                    checked={isPublished}
                    onChange={(e) => setIsPublished(e.target.checked)}
                    className="h-4 w-4 rounded border-zinc-300 text-primary focus:ring-primary"
                  />
                  <label htmlFor="isPublished" className="text-xs font-bold text-zinc-700 cursor-pointer select-none">
                    Hemen Yayınla (Müşteriler tarafından görüntülenebilir hale getir)
                  </label>
                </div>
              </div>

              {/* Modal Footer */}
              <div className="flex items-center justify-end gap-2 border-t border-zinc-100 px-6 py-4 bg-zinc-50/50 shrink-0">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2.5 rounded-2xl border border-zinc-200 hover:bg-zinc-100 text-zinc-700 text-xs font-bold transition active:scale-[0.98]"
                >
                  Vazgeç
                </button>
                <button
                  type="button"
                  onClick={handleSavePost}
                  disabled={saveLoading}
                  className="px-5 py-2.5 rounded-2xl bg-primary hover:bg-[#c00000] text-white text-xs font-bold transition active:scale-[0.98] flex items-center gap-1.5 shadow-sm disabled:opacity-55"
                >
                  {saveLoading && <span className="animate-spin h-3.5 w-3.5 border-2 border-white border-t-transparent rounded-full" />}
                  Kaydet
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Media Picker Modal */}
      <MediaLibraryModal
        isOpen={isMediaOpen}
        onClose={() => setIsMediaOpen(false)}
        onSelect={(url) => {
          setImageUrl(url)
          setIsMediaOpen(false)
        }}
      />
    </AdminLayout>
  )
}
