import { useEffect, useMemo, useState } from 'react'
import { getAdminToken } from '../lib/api'
import { fetchAdminCategories, uploadAdminCategoryImage, upsertAdminCategory, type CategoryDto } from '../lib/categoriesApi'
import { AdminLayout } from '../components/admin/AdminLayout'
import { useToast } from '../components/ui/ToastContext'

type TreeNode = CategoryDto & { children: TreeNode[] }

type EditingCategory = {
  id?: string
  parentId: string | null
  name: string
  slug: string
  imageUrl: string
  showInHeader: boolean
  showInFooter: boolean
  sortOrder: number
  isActive: boolean
}

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ')
}

function generateSlug(val: string): string {
  return val
    .toLowerCase()
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ı/g, 'i')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '')
}

function getCategoryIcon(slug: string, name: string): string {
  const s = slug.toLowerCase()
  const n = name.toLowerCase()
  if (s.includes('mutfak') || n.includes('mutfak')) return 'restaurant'
  if (s.includes('supurge') || n.includes('süpürge')) return 'cleaning_services'
  if (s.includes('bakim') || n.includes('bakım')) return 'face'
  if (s.includes('utu') || n.includes('ütü')) return 'iron'
  if (s.includes('icecek') || n.includes('içecek')) return 'local_cafe'
  if (s.includes('elektronik') || n.includes('elektronik')) return 'devices'
  if (s.includes('aksesuar') || n.includes('aksesuar')) return 'cable'
  if (s.includes('bilgisayar') || n.includes('bilgisayar')) return 'laptop'
  if (s.includes('telefon') || n.includes('telefon')) return 'smartphone'
  if (s.includes('ev') || n.includes('ev')) return 'home'
  if (s.includes('moda') || n.includes('moda') || s.includes('giyim')) return 'checkroom'
  return 'folder'
}

function buildTree(list: CategoryDto[]): TreeNode[] {
  const byId = new Map<string, TreeNode>()
  for (const c of list) {
    byId.set(c.id, { ...c, children: [] })
  }

  const roots: TreeNode[] = []
  for (const n of byId.values()) {
    if (n.parentId && byId.has(n.parentId)) {
      byId.get(n.parentId)!.children.push(n)
    } else {
      roots.push(n)
    }
  }

  const sortRec = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name, 'tr'))
    for (const n of nodes) sortRec(n.children)
  }
  sortRec(roots)

  return roots
}

type ParentOption = {
  id: string
  name: string
  indent: string
}

function getParentOptions(cats: CategoryDto[], editingId?: string): ParentOption[] {
  const byId = new Map<string, CategoryDto & { children: any[] }>()
  for (const c of cats) {
    byId.set(c.id, { ...c, children: [] })
  }
  const roots: any[] = []
  for (const n of byId.values()) {
    if (n.parentId && byId.has(n.parentId)) {
      byId.get(n.parentId)!.children.push(n)
    } else {
      roots.push(n)
    }
  }
  
  const sortRec = (nodes: any[]) => {
    nodes.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name, 'tr'))
    for (const n of nodes) sortRec(n.children)
  }
  sortRec(roots)

  const options: ParentOption[] = []
  const traverse = (nodes: any[], depth: number, skip: boolean) => {
    for (const node of nodes) {
      const isEditing = node.id === editingId
      const shouldSkip = skip || isEditing
      
      if (!shouldSkip) {
        options.push({
          id: node.id,
          name: node.name,
          indent: '— '.repeat(depth)
        })
      }
      
      if (node.children.length > 0) {
        traverse(node.children, depth + 1, shouldSkip)
      }
    }
  }
  
  traverse(roots, 0, false)
  return options
}

export function AdminCategoriesPage() {
  const { showToast } = useToast()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cats, setCats] = useState<CategoryDto[]>([])
  const [q, setQ] = useState('')

  const [editing, setEditing] = useState<EditingCategory>({
    parentId: null,
    name: '',
    slug: '',
    imageUrl: '',
    showInHeader: true,
    showInFooter: false,
    sortOrder: 0,
    isActive: true,
  })

  // Mock and SEO fields matching design template
  const [description, setDescription] = useState('')
  const [metaTitle, setMetaTitle] = useState('')
  const [metaDesc, setMetaDesc] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [tagInput, setTagInput] = useState('')

  // Expanded tree states
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({})
  const [allCollapsed, setAllCollapsed] = useState(false)

  const [imageFile, setImageFile] = useState<File | null>(null)

  const authHeader = useMemo(() => {
    const token = getAdminToken()
    return token ? { Authorization: `Bearer ${token}` } : null
  }, [])

  async function reload() {
    if (!authHeader) {
      setError('Yetki yok. Tekrar giriş yap.')
      return
    }

    try {
      setLoading(true)
      setError(null)
      const list = await fetchAdminCategories(authHeader)
      setCats(list)
      
      // Auto-expand root categories initially
      const initialExpand: Record<string, boolean> = {}
      list.forEach(c => {
        if (!c.parentId) {
          initialExpand[c.id] = true
        }
      })
      setExpandedIds(initialExpand)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kategoriler alınamadı')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authHeader])

  const tree = useMemo(() => buildTree(cats), [cats])
  const parentOptions = useMemo(() => getParentOptions(cats, editing.id), [cats, editing.id])

  const handleToggleExpand = (id: string) => {
    setExpandedIds(prev => ({ ...prev, [id]: !prev[id] }))
  }

  const toggleAllExpanded = () => {
    if (allCollapsed) {
      const next: Record<string, boolean> = {}
      cats.forEach(c => { next[c.id] = true })
      setExpandedIds(next)
      setAllCollapsed(false)
    } else {
      setExpandedIds({})
      setAllCollapsed(true)
    }
  }

  const handleGenerateAI = () => {
    if (!editing.name) {
      showToast('AI ile SEO oluşturmak için lütfen önce Kategori Adı girin.', 'error')
      return
    }
    const catName = editing.name
    setMetaTitle(`En Kaliteli ${catName} Modelleri ve Fiyatları | Stilsoft Kıbrıs`)
    setMetaDesc(`Orijinal ${catName.toLowerCase()} serisi, bütçe dostu ödeme imkanları ve Stilsoft güvencesiyle Kıbrıs mağazamızda sizleri bekliyor. Hemen keşfedin!`)
    setTags([catName.toLowerCase(), 'stilsoft', `${catName.toLowerCase()} fiyatlari`, 'kibris'])
    showToast('Kategori meta başlığı, açıklaması ve anahtar kelimeleri AI tarafından oluşturuldu.', 'success')
  }

  const resetForm = () => {
    setEditing({
      parentId: null,
      name: '',
      slug: '',
      imageUrl: '',
      showInHeader: true,
      showInFooter: false,
      sortOrder: 0,
      isActive: true,
    })
    setImageFile(null)
    setDescription('')
    setMetaTitle('')
    setMetaDesc('')
    setTags([])
    setTagInput('')
  }

  async function onSave(e: React.FormEvent) {
    e.preventDefault()
    if (!authHeader) {
      setError('Yetki yok. Tekrar giriş yap.')
      return
    }

    try {
      setLoading(true)
      setError(null)
      const id = await upsertAdminCategory(authHeader, {
        id: editing.id,
        parentId: editing.parentId,
        name: editing.name,
        slug: editing.slug || undefined,
        imageUrl: editing.imageUrl,
        showInHeader: editing.showInHeader,
        showInFooter: editing.showInFooter,
        sortOrder: editing.sortOrder,
        isActive: editing.isActive,
      })

      if (imageFile) {
        const url = await uploadAdminCategoryImage(authHeader, id, imageFile)
        setEditing((x) => ({ ...x, imageUrl: url }))
        setImageFile(null)
      }

      showToast(editing.id ? 'Kategori başarıyla güncellendi.' : 'Yeni kategori eklendi.', 'success')
      resetForm()
      await reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kaydedilemedi')
      showToast('İşlem kaydedilirken bir hata oluştu.', 'error')
    } finally {
      setLoading(false)
    }
  }

  function selectForEdit(c: CategoryDto) {
    setEditing({
      id: c.id,
      parentId: c.parentId,
      name: c.name,
      slug: c.slug,
      imageUrl: (c.imageUrl ?? '').trim(),
      showInHeader: Boolean(c.showInHeader ?? true),
      showInFooter: Boolean(c.showInFooter),
      sortOrder: c.sortOrder ?? 0,
      isActive: true,
    })
    setImageFile(null)

    // Set mockup text areas
    setDescription(`${c.name} kategorisinde bulunan tüm kaliteli ve orijinal ürünleri buradan inceleyebilir, detaylı filtreleme yapabilirsiniz.`)
    setMetaTitle(`En Kaliteli ${c.name} Ürünleri ve Çeşitleri | Stilsoft Mağazası`)
    setMetaDesc(`Aradığınız en ucuz ve en kaliteli ${c.name.toLowerCase()} ürünleri hızlı kargo seçeneğiyle Stilsoft'ta.`)
    setTags([c.slug.replace('-', ' '), 'stilsoft', c.name.toLowerCase()])
  }

  // Calculate dynamic breadcrumb path
  const breadcrumbPath = useMemo(() => {
    if (!editing.parentId) {
      return `Katalog / ${editing.name || 'Yeni Kategori'}`
    }
    const chain: string[] = []
    let currId: string | null = editing.parentId
    const maxDepth = 6
    let depth = 0
    while (currId && depth < maxDepth) {
      const parent = cats.find((x) => x.id === currId)
      if (parent) {
        chain.unshift(parent.name)
        currId = parent.parentId
      } else {
        break
      }
      depth++
    }
    return `Katalog / ${chain.join(' / ')} / ${editing.name || 'Yeni Kategori'}`
  }, [editing.parentId, editing.name, cats])

  return (
    <AdminLayout
      title="Kategori Yönetimi"
      subtitle="Kategori hiyerarşisini düzenleyin, katalog ağacını yönetin ve ürünleri kategorilere bağlayın."
      top={
        <div className="flex items-center gap-2.5">
          <div className="hidden items-center gap-2.5 rounded-2xl border border-zinc-200 bg-white px-4 py-2 text-xs text-zinc-700 shadow-sm focus-within:ring-4 focus-within:ring-primary/10 focus-within:border-[#df0000] transition-all duration-200 md:flex md:w-[320px]">
            <span className="material-symbols-outlined text-zinc-400 text-[18px]">search</span>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Kategori ağacında hızlı ara..."
              className="w-full bg-transparent outline-none text-xs font-semibold text-zinc-700"
            />
          </div>
          <button
            type="button"
            className="flex items-center gap-1.5 h-10 px-4 rounded-2xl border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 hover:border-zinc-350 transition-all duration-150 active:scale-95 text-xs font-bold shadow-sm"
            onClick={reload}
          >
            Yenile
          </button>
        </div>
      }
    >
      {error && (
        <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-xs font-semibold text-rose-700 flex items-center gap-2">
          <span className="material-symbols-outlined text-rose-600">error</span>
          <span>{error}</span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left Column: Kategori Ağacı */}
        <section className="lg:col-span-4 w-full flex flex-col bg-white border border-zinc-200/80 rounded-3xl overflow-hidden shadow-sm">
          <div className="p-4 border-b border-zinc-150 flex justify-between items-center bg-zinc-50/50">
            <span className="text-xs font-black text-zinc-800 uppercase tracking-wider">Kategori Ağacı</span>
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={toggleAllExpanded}
                className="w-7 h-7 rounded-lg hover:bg-zinc-150 text-zinc-650 flex items-center justify-center transition-colors"
                title={allCollapsed ? 'Tümünü Genişlet' : 'Tümünü Daralt'}
              >
                <span className="material-symbols-outlined text-[18px]">
                  {allCollapsed ? 'unfold_more' : 'unfold_less'}
                </span>
              </button>
              <button
                type="button"
                onClick={resetForm}
                className="w-7 h-7 rounded-lg hover:bg-zinc-150 text-[#df0000] flex items-center justify-center transition-colors"
                title="Yeni Kategori Ekle"
              >
                <span className="material-symbols-outlined text-[18px]">add_circle</span>
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4 custom-scrollbar bg-white max-h-[680px]">
            {tree.length === 0 ? (
              <div className="text-xs text-zinc-400 italic text-center py-12">Yükleniyor veya kategori bulunamadı.</div>
            ) : (
              <div className="space-y-1">
                {tree.map((node) => (
                  <TreeItem
                    key={node.id}
                    node={node}
                    level={0}
                    onEdit={selectForEdit}
                    editingId={editing.id}
                    expandedIds={expandedIds}
                    onToggleExpand={handleToggleExpand}
                    q={q}
                  />
                ))}
              </div>
            )}
          </div>

          <div className="p-3.5 bg-zinc-50 text-[10px] text-zinc-500 font-bold text-center border-t border-zinc-150">
            Sıralamak için formdan Sıralama Değerini güncelleyebilirsiniz.
          </div>
        </section>

        {/* Right Column: Detay Formu */}
        <section className="lg:col-span-8 flex flex-col bg-white border border-zinc-200/80 rounded-3xl overflow-hidden shadow-sm">
          <div className="p-4.5 border-b border-zinc-150 flex justify-between items-center bg-zinc-50/50">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-[#df0000]/10 text-[#df0000] flex items-center justify-center shadow-sm">
                <span className="material-symbols-outlined text-[20px]">edit_note</span>
              </div>
              <div className="min-w-0">
                <h3 className="text-xs font-black text-zinc-950 uppercase tracking-tight">
                  {editing.id ? `Kategori Detayları: ${editing.name}` : 'Yeni Kategori Tanımla'}
                </h3>
                <p className="text-[10px] text-zinc-400 font-extrabold uppercase mt-0.5 tracking-wider truncate max-w-lg">
                  {breadcrumbPath}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <span
                className={cx(
                  'px-2.5 py-0.5 rounded-lg text-[9px] font-bold border uppercase tracking-wider',
                  editing.isActive ? 'bg-green-50 border-green-200 text-green-700' : 'bg-zinc-50 border-zinc-200 text-zinc-500'
                )}
              >
                {editing.isActive ? 'Aktif' : 'Pasif / Taslak'}
              </span>
              {editing.id && (
                <button
                  type="button"
                  onClick={() =>
                    showToast(
                      "Kategoriyi devre dışı bırakmak için lütfen durum ayarını 'Pasif / Taslak' olarak güncelleyin.",
                      'warning'
                    )
                  }
                  className="w-8 h-8 rounded-xl hover:bg-rose-50 text-rose-600 flex items-center justify-center transition"
                  title="Silme Talebi"
                >
                  <span className="material-symbols-outlined text-[18px]">delete</span>
                </button>
              )}
            </div>
          </div>

          <form onSubmit={onSave} className="flex flex-col flex-grow">
            <div className="p-6 space-y-6 flex-grow">
            {/* Basic Info and Image Row */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Left Side fields */}
              <div className="space-y-4">
                <span className="text-[10px] font-extrabold text-zinc-450 uppercase tracking-wider block">Temel Bilgiler</span>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-zinc-655">Kategori Adı *</label>
                  <input
                    required
                    value={editing.name}
                    onChange={(e) => {
                      const val = e.target.value
                      setEditing((x) => ({
                        ...x,
                        name: val,
                        slug: x.id ? x.slug : generateSlug(val)
                      }))
                    }}
                    placeholder="Örn: Mutfak Aletleri"
                    className="h-11 w-full rounded-2xl border border-zinc-200 px-4 text-xs font-semibold text-zinc-800 outline-none focus:ring-4 focus:ring-[#df0000]/5 focus:border-[#df0000] transition-all"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-zinc-650">Üst Kategori</label>
                  <select
                    value={editing.parentId ?? ''}
                    onChange={(e) => setEditing((x) => ({ ...x, parentId: e.target.value ? e.target.value : null }))}
                    className="h-11 w-full rounded-2xl border border-zinc-200 bg-white px-4 text-xs font-semibold text-zinc-700 outline-none focus:ring-4 focus:ring-[#df0000]/5 focus:border-[#df0000] transition-all cursor-pointer"
                  >
                    <option value="">(Ana kategori olarak tanımla)</option>
                    {parentOptions.map((opt) => (
                      <option key={opt.id} value={opt.id}>
                        {opt.indent}{opt.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-zinc-650">Slug (URL)</label>
                  <div className="flex h-11 border border-zinc-200 rounded-2xl overflow-hidden focus-within:ring-4 focus-within:ring-[#df0000]/5 focus-within:border-[#df0000] transition-all">
                    <span className="flex items-center px-4 bg-zinc-50 border-r border-zinc-200 text-zinc-400 text-xs font-bold select-none">
                      example.com/k/
                    </span>
                    <input
                      value={editing.slug}
                      onChange={(e) => setEditing((x) => ({ ...x, slug: e.target.value }))}
                      placeholder="kategori-slug-linki"
                      className="flex-1 px-4 text-xs font-semibold text-zinc-800 outline-none"
                    />
                  </div>
                </div>
              </div>

              {/* Right Side: Image Upload */}
              <div className="space-y-4">
                <span className="text-[10px] font-extrabold text-zinc-455 uppercase tracking-wider block">Kategori Görseli</span>

                <div className="relative h-[185px] w-full border-2 border-dashed border-zinc-200 hover:border-[#df0000] rounded-3xl flex flex-col items-center justify-center bg-zinc-50/20 group transition-all cursor-pointer overflow-hidden">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => {
                      const f = e.target.files?.[0] ?? null
                      setImageFile(f)
                    }}
                    className="absolute inset-0 opacity-0 cursor-pointer z-20"
                  />
                  {imageFile || editing.imageUrl.trim() ? (
                    <div className="absolute inset-0 bg-white flex flex-col items-center justify-center p-2 z-10">
                      <img
                        src={imageFile ? URL.createObjectURL(imageFile) : editing.imageUrl.trim()}
                        alt="Preview"
                        className="w-full h-full object-cover rounded-2xl opacity-60"
                      />
                      <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/80 p-4">
                        <span className="material-symbols-outlined text-[#df0000] text-3xl mb-1">cloud_upload</span>
                        <span className="text-[11px] font-extrabold text-zinc-800 truncate max-w-xs">
                          {imageFile ? imageFile.name : 'Görseli Değiştir'}
                        </span>
                        <span className="text-[9px] text-zinc-450 mt-0.5">Yüklemek için tıklayın</span>
                      </div>
                    </div>
                  ) : (
                    <div className="text-center p-5">
                      <span className="material-symbols-outlined text-[#df0000] text-3xl mb-2">cloud_upload</span>
                      <p className="text-xs font-bold text-zinc-700">Görsel Yüklemek İçin Tıklayın</p>
                      <p className="text-[10px] text-zinc-450 mt-1">JPG, PNG veya WebP (Maks. 2MB)</p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Description Editor (Simulated WYSIWYG) */}
            <div className="space-y-2">
              <span className="text-[10px] font-extrabold text-zinc-450 uppercase tracking-wider block">Açıklama</span>
              <div className="border border-zinc-200 rounded-3xl overflow-hidden focus-within:ring-4 focus-within:ring-[#df0000]/5 focus-within:border-[#df0000] transition-all">
                <div className="bg-zinc-50/80 px-4 py-2 border-b border-zinc-200 flex gap-4 text-zinc-500">
                  <button type="button" className="material-symbols-outlined hover:text-[#df0000] text-[18px] transition-colors">
                    format_bold
                  </button>
                  <button type="button" className="material-symbols-outlined hover:text-[#df0000] text-[18px] transition-colors">
                    format_italic
                  </button>
                  <button type="button" className="material-symbols-outlined hover:text-[#df0000] text-[18px] transition-colors">
                    format_list_bulleted
                  </button>
                  <button type="button" className="material-symbols-outlined hover:text-[#df0000] text-[18px] transition-colors">
                    link
                  </button>
                </div>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Kategori açıklamasını detaylı olarak buraya yazabilirsiniz..."
                  rows={3}
                  className="w-full p-4 outline-none border-none resize-none text-xs font-semibold text-zinc-700 placeholder:text-zinc-450 bg-white"
                />
              </div>
            </div>

            {/* SEO Settings Panel */}
            <div className="space-y-4 pt-2 border-t border-zinc-100">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-extrabold text-zinc-450 uppercase tracking-wider">SEO Ayarları</span>
                <button
                  type="button"
                  onClick={handleGenerateAI}
                  className="text-[10px] text-[#df0000] flex items-center gap-1.5 font-black hover:underline active:scale-95 transition"
                >
                  <span className="material-symbols-outlined text-[14px]">auto_awesome</span>
                  AI ile SEO Oluştur
                </button>
              </div>

              <div className="space-y-3.5">
                <div className="space-y-1.5">
                  <div className="flex justify-between items-center">
                    <label className="text-[11px] font-extrabold tracking-wider text-zinc-450 uppercase">
                      Meta Başlığı (Title)
                    </label>
                    <span className="text-[10px] font-bold text-zinc-400">{metaTitle.length}/60</span>
                  </div>
                  <input
                    value={metaTitle}
                    onChange={(e) => setMetaTitle(e.target.value.slice(0, 60))}
                    placeholder="Arama sonuçlarında görünecek başlık..."
                    className="h-11 w-full rounded-2xl border border-zinc-200 px-4 text-xs font-semibold text-zinc-800 outline-none focus:ring-4 focus:ring-[#df0000]/5 focus:border-[#df0000] transition-all"
                  />
                </div>

                <div className="space-y-1.5">
                  <div className="flex justify-between items-center">
                    <label className="text-[11px] font-extrabold tracking-wider text-zinc-455 uppercase">
                      Meta Açıklaması (Description)
                    </label>
                    <span className="text-[10px] font-bold text-zinc-400">{metaDesc.length}/160</span>
                  </div>
                  <textarea
                    value={metaDesc}
                    onChange={(e) => setMetaDesc(e.target.value.slice(0, 160))}
                    placeholder="Arama sonuçlarında görünecek açıklama..."
                    rows={2}
                    className="w-full rounded-2xl border border-zinc-200 p-3.5 text-xs font-semibold text-zinc-700 outline-none focus:ring-4 focus:ring-[#df0000]/5 focus:border-[#df0000] transition-all"
                  />
                </div>

                {/* Keywords tag editor */}
                <div className="space-y-1.5">
                  <label className="text-[11px] font-extrabold tracking-wider text-zinc-450 uppercase">Anahtar Kelimeler</label>
                  <div className="flex flex-wrap gap-2 p-2 border border-zinc-200 rounded-2xl bg-zinc-50/50 min-h-[44px] focus-within:ring-4 focus-within:ring-[#df0000]/5 focus-within:border-[#df0000] transition-all">
                    {tags.map((tag, idx) => (
                      <span
                        key={idx}
                        className="bg-zinc-900 text-white text-[10px] font-bold px-2.5 py-1 rounded-xl flex items-center gap-1.5 shadow-sm"
                      >
                        {tag}
                        <button
                          type="button"
                          onClick={() => setTags(tags.filter((_, i) => i !== idx))}
                          className="hover:text-red-400 flex items-center shrink-0"
                        >
                          <span className="material-symbols-outlined text-[12px]">close</span>
                        </button>
                      </span>
                    ))}
                    <input
                      value={tagInput}
                      onChange={(e) => setTagInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ',') {
                          e.preventDefault()
                          const trimmed = tagInput.trim().replace(',', '')
                          if (trimmed && !tags.includes(trimmed)) {
                            setTags([...tags, trimmed])
                          }
                          setTagInput('')
                        }
                      }}
                      placeholder={tags.length === 0 ? "Kelime ekleyin ve Enter'a basın..." : "Ekle..."}
                      className="flex-1 border-none outline-none p-1 text-xs font-semibold text-zinc-700 bg-transparent min-w-[120px]"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Layout Toggles and Sort Order */}
            <div className="space-y-4 pt-4 border-t border-zinc-100">
              <div className="grid gap-4 md:grid-cols-2">
                <label className="flex items-center gap-3 rounded-2xl border border-zinc-200 bg-zinc-50/30 px-4 py-3 cursor-pointer hover:bg-zinc-50 transition active:scale-[0.99]">
                  <input
                    type="checkbox"
                    checked={editing.showInHeader}
                    onChange={(e) => setEditing((x) => ({ ...x, showInHeader: e.target.checked }))}
                    className="h-4 w-4 rounded border-zinc-350 text-[#df0000] accent-[#df0000] cursor-pointer"
                  />
                  <span className="text-xs font-bold text-zinc-700 select-none">Header (Üst Menü)'da Göster</span>
                </label>

                <label className="flex items-center gap-3 rounded-2xl border border-zinc-200 bg-zinc-50/30 px-4 py-3 cursor-pointer hover:bg-zinc-50 transition active:scale-[0.99]">
                  <input
                    type="checkbox"
                    checked={editing.showInFooter}
                    onChange={(e) => setEditing((x) => ({ ...x, showInFooter: e.target.checked }))}
                    className="h-4 w-4 rounded border-zinc-350 text-[#df0000] accent-[#df0000] cursor-pointer"
                  />
                  <span className="text-xs font-bold text-zinc-700 select-none">Footer (Alt Menü)'da Göster</span>
                </label>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-1.5">
                  <label className="text-[11px] font-extrabold tracking-wider text-zinc-405 uppercase">Sıralama Değeri</label>
                  <input
                    value={String(editing.sortOrder)}
                    onChange={(e) => {
                      const n = Number(e.target.value)
                      setEditing((x) => ({ ...x, sortOrder: Number.isFinite(n) ? n : 0 }))
                    }}
                    className="h-11 w-full rounded-2xl border border-zinc-200 px-4 text-xs font-semibold text-zinc-800 outline-none focus:ring-4 focus:ring-[#df0000]/5 focus:border-[#df0000] transition-all"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[11px] font-extrabold tracking-wider text-zinc-405 uppercase">Yayın Durumu</label>
                  <select
                    value={editing.isActive ? '1' : '0'}
                    onChange={(e) => setEditing((x) => ({ ...x, isActive: e.target.value === '1' }))}
                    className="h-11 w-full rounded-2xl border border-zinc-200 bg-white px-4 text-xs font-semibold text-zinc-700 outline-none focus:ring-4 focus:ring-[#df0000]/5 focus:border-[#df0000] transition-all cursor-pointer"
                  >
                    <option value="1">Aktif / Yayında</option>
                    <option value="0">Pasif / Taslak</option>
                  </select>
                </div>
              </div>
            </div>
            </div>

            {/* Action buttons footer */}
            <div className="p-5 bg-zinc-50/50 border-t border-zinc-150 flex justify-end gap-3 shrink-0 rounded-b-[24px]">
              <button
                type="button"
                onClick={resetForm}
                className="px-6 py-2.5 border border-zinc-200 bg-white hover:bg-zinc-50 text-zinc-700 text-xs font-bold rounded-2xl transition active:scale-[0.98]"
              >
                İptal Et
              </button>
              <button
                type="submit"
                disabled={loading}
                className="px-6 py-2.5 bg-[#df0000] hover:bg-[#c00000] text-white text-xs font-bold rounded-2xl shadow-sm shadow-red-500/10 transition active:scale-[0.98] disabled:opacity-50"
              >
                {loading ? 'Değişiklikler Uygulanıyor...' : 'Değişiklikleri Uygula'}
              </button>
            </div>
          </form>
        </section>
      </div>
    </AdminLayout>
  )
}

function TreeItem({
  node,
  level,
  onEdit,
  editingId,
  expandedIds,
  onToggleExpand,
  q,
}: {
  node: TreeNode
  level: number
  onEdit: (c: CategoryDto) => void
  editingId?: string
  expandedIds: Record<string, boolean>
  onToggleExpand: (id: string) => void
  q: string
}) {
  const isExpanded = !!expandedIds[node.id]
  const isActive = editingId === node.id
  const hasChildren = node.children.length > 0
  const isSearchMatched = q && (node.name.toLowerCase().includes(q.toLowerCase()) || node.slug.toLowerCase().includes(q.toLowerCase()))

  const icon = getCategoryIcon(node.slug, node.name)
  const productCount = node.productCount ?? 0

  return (
    <div className="space-y-1">
      <div
        onClick={() => onEdit(node)}
        className={cx(
          'flex items-center py-2 px-3 rounded-2xl hover:bg-zinc-50 border cursor-pointer transition-all duration-200 select-none group',
          isActive
            ? 'bg-[#df0000]/5 border-[#df0000] text-zinc-900 shadow-sm'
            : isSearchMatched
            ? 'bg-amber-50 border-amber-200 text-zinc-900'
            : 'bg-white border-zinc-200/80 text-zinc-700'
        )}
        style={{ marginLeft: level * 16 }}
      >
        {/* Toggle expansion chevron */}
        {hasChildren ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onToggleExpand(node.id)
            }}
            className="w-6 h-6 rounded-lg hover:bg-zinc-200/50 text-zinc-400 flex items-center justify-center mr-1 transition-colors"
          >
            <span className="material-symbols-outlined text-[18px]">
              {isExpanded ? 'expand_more' : 'chevron_right'}
            </span>
          </button>
        ) : (
          <div className="w-6 h-6 mr-1" />
        )}

        {/* Drag handle */}
        <span className="material-symbols-outlined text-zinc-400 mr-2 drag-handle select-none opacity-40 group-hover:opacity-100 transition-opacity">
          drag_indicator
        </span>

        {/* Category icon */}
        <span className={cx('material-symbols-outlined mr-2 text-[18px]', isActive ? 'text-[#df0000]' : 'text-zinc-400')}>
          {icon}
        </span>

        {/* Category name */}
        <span className={cx('flex-1 text-xs truncate', isActive ? 'font-bold text-zinc-900' : 'font-semibold text-zinc-700')}>
          {node.name}
        </span>

        {/* Product count */}
        <span className="text-[9px] text-zinc-400 font-bold bg-zinc-50 border border-zinc-150 px-2 py-0.5 rounded-lg select-none">
          {productCount} Ürün
        </span>
      </div>

      {hasChildren && isExpanded ? (
        <div className="space-y-1 mt-1 border-l border-zinc-100 ml-4.5 pl-2">
          {node.children.map((c) => (
            <TreeItem
              key={c.id}
              node={c}
              level={level + 1}
              onEdit={onEdit}
              editingId={editingId}
              expandedIds={expandedIds}
              onToggleExpand={onToggleExpand}
              q={q}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}
