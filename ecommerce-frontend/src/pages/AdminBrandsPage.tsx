import { useEffect, useMemo, useState } from 'react'
import { AdminLayout } from '../components/admin/AdminLayout'
import { Icon } from '../components/Icon'
import { getAdminToken, readApiResponse, extractProductsList, type ErpProductListItem } from '../lib/api'
import { type ProductMetadataDto } from '../lib/productMetadataApi'
import { MediaLibraryModal } from '../components/ui/MediaLibraryModal'
import { useToast } from '../components/ui/ToastContext'
import { useConfirm } from '../components/ui/ConfirmContext'

type Brand = {
  id: string
  name: string
  logoUrl?: string | null
  description?: string | null
  updatedAtUtc?: string
}

type BrandMetric = {
  id: string
  name: string
  logoUrl?: string | null
  description?: string | null
  totalCount: number
  publishedCount: number
  draftCount: number
}

export function AdminBrandsPage() {
  const { showToast } = useToast()
  const confirm = useConfirm()
  
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [products, setProducts] = useState<ErpProductListItem[]>([])
  const [metadata, setMetadata] = useState<Record<string, ProductMetadataDto>>({})
  const [brands, setBrands] = useState<Brand[]>([])
  const [q, setQ] = useState('')
  const [selectedBrand, setSelectedBrand] = useState<string | null>(null)

  // Modal states
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingBrand, setEditingBrand] = useState<Brand | null>(null)
  const [brandName, setBrandName] = useState('')
  const [brandLogoUrl, setBrandLogoUrl] = useState('')
  const [brandDescription, setBrandDescription] = useState('')
  const [saveLoading, setSaveLoading] = useState(false)
  
  // Media picker states
  const [isMediaOpen, setIsMediaOpen] = useState(false)

  const authHeader = useMemo(() => {
    const token = getAdminToken()
    return token ? { Authorization: `Bearer ${token}` } : null
  }, [])

  const loadData = async () => {
    if (!authHeader) return
    try {
      setLoading(true)
      setError(null)

      const [prodRes, metaRes, brandRes] = await Promise.all([
        fetch('/api/admin/products', { headers: authHeader }),
        fetch('/api/admin/products/metadata', { headers: authHeader }),
        fetch('/api/admin/brands', { headers: authHeader }),
      ])

      const prodJson = await readApiResponse(prodRes)
      if (!prodRes.ok) throw new Error(prodJson?.message || 'Ürünler alınamadı')
      const allProds = extractProductsList(prodJson)

      const metaJson = await readApiResponse(metaRes)
      if (!metaRes.ok) throw new Error(metaJson?.message || 'Metadatalar alınamadı')
      const metaList = Array.isArray(metaJson?.data) ? metaJson.data : []
      const metaMap: Record<string, ProductMetadataDto> = {}
      for (const m of metaList) {
        const tc = String(m.productTenantCode ?? '').trim().toUpperCase()
        const key = `${tc}:${m.productId}`
        metaMap[key] = m
      }

      const brandJson = await readApiResponse(brandRes)
      if (!brandRes.ok) throw new Error(brandJson?.message || 'Markalar alınamadı')
      const brandList = Array.isArray(brandJson?.data) ? brandJson.data : []

      setProducts(allProds)
      setMetadata(metaMap)
      setBrands(brandList)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Veriler yüklenemedi')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [authHeader])

  // Compute brand metrics dynamically matching real brands
  const brandMetrics = useMemo<BrandMetric[]>(() => {
    const countsMap: Record<string, { total: number; published: number; draft: number }> = {}

    // Initialize counts for all database brands
    for (const b of brands) {
      countsMap[b.name.trim().toLowerCase()] = { total: 0, published: 0, draft: 0 }
    }

    for (const p of products) {
      const tc = String(p.tenantCode ?? '').trim().toUpperCase()
      const key = `${tc}:${p.id}`
      const meta = metadata[key]
      
      const brandName = (meta?.brand || p.mainCategory || 'Markasız').trim()
      const lower = brandName.toLowerCase()

      if (!countsMap[lower]) {
        countsMap[lower] = { total: 0, published: 0, draft: 0 }
      }

      countsMap[lower].total++
      if (meta?.status === 'Published') {
        countsMap[lower].published++
      } else {
        countsMap[lower].draft++
      }
    }

    return brands.map((b) => {
      const counts = countsMap[b.name.trim().toLowerCase()] || { total: 0, published: 0, draft: 0 }
      return {
        id: b.id,
        name: b.name,
        logoUrl: b.logoUrl,
        description: b.description,
        totalCount: counts.total,
        publishedCount: counts.published,
        draftCount: counts.draft,
      }
    }).sort((a, b) => b.totalCount - a.totalCount)
  }, [brands, products, metadata])

  const filteredBrands = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return brandMetrics
    return brandMetrics.filter((b) => b.name.toLowerCase().includes(s))
  }, [brandMetrics, q])

  // Get products of selected brand
  const selectedBrandProducts = useMemo(() => {
    if (!selectedBrand) return []
    return products.filter((p) => {
      const tc = String(p.tenantCode ?? '').trim().toUpperCase()
      const key = `${tc}:${p.id}`
      const meta = metadata[key]
      const brandName = (meta?.brand || p.mainCategory || 'Markasız').trim()
      return brandName.toLowerCase() === selectedBrand.toLowerCase()
    })
  }, [selectedBrand, products, metadata])

  // Modal actions
  const handleOpenAddModal = () => {
    setEditingBrand(null)
    setBrandName('')
    setBrandLogoUrl('')
    setBrandDescription('')
    setIsModalOpen(true)
  }

  const handleOpenEditModal = (b: BrandMetric) => {
    setEditingBrand({
      id: b.id,
      name: b.name,
      logoUrl: b.logoUrl,
      description: b.description
    })
    setBrandName(b.name)
    setBrandLogoUrl(b.logoUrl || '')
    setBrandDescription(b.description || '')
    setIsModalOpen(true)
  }

  const handleSaveBrand = async () => {
    if (!brandName.trim()) {
      showToast('Marka adı zorunludur.', 'warning')
      return
    }

    if (!authHeader) return

    try {
      setSaveLoading(true)
      const payload = {
        name: brandName.trim(),
        logoUrl: brandLogoUrl.trim() || null,
        description: brandDescription.trim() || null
      }

      const url = editingBrand ? `/api/admin/brands/${editingBrand.id}` : '/api/admin/brands'
      const method = editingBrand ? 'PUT' : 'POST'

      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...authHeader
        },
        body: JSON.stringify(payload)
      })

      const json = await readApiResponse(res)
      if (!res.ok || !json?.success) {
        throw new Error(json?.message || 'Marka kaydedilemedi.')
      }

      showToast(editingBrand ? 'Marka başarıyla güncellendi.' : 'Marka başarıyla eklendi.', 'success')
      setIsModalOpen(false)
      loadData()
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Kaydedilirken hata oluştu.', 'error')
    } finally {
      setSaveLoading(false)
    }
  }

  const handleDeleteBrand = async (id: string) => {
    const ok = await confirm('Bu markayı silmek istediğinizden emin misiniz?', { type: 'danger', confirmText: 'Evet, Sil', title: 'Markayı Sil' })
    if (!ok) return
    if (!authHeader) return

    try {
      setLoading(true)
      const res = await fetch(`/api/admin/brands/${id}`, {
        method: 'DELETE',
        headers: { ...authHeader }
      })

      const json = await readApiResponse(res)
      if (!res.ok || !json?.success) {
        throw new Error(json?.message || 'Marka silinemedi.')
      }

      showToast('Marka başarıyla silindi.', 'success')
      loadData()
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Silinirken hata oluştu.', 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AdminLayout
      title="Markalar"
      subtitle="Ürünlerinizin markalarını tanımlayın, düzenleyin ve ürün atamalarını yönetin."
      top={
        <div className="flex items-center gap-2">
          <button
            onClick={handleOpenAddModal}
            className="flex h-10 px-4 items-center gap-2 rounded-2xl bg-primary hover:bg-[#c00000] text-white text-xs font-bold shadow-md transition-all active:scale-[0.98]"
          >
            <span className="material-symbols-outlined text-[18px]">add</span>
            Yeni Marka Ekle
          </button>
          <button
            onClick={loadData}
            className="flex h-10 w-10 items-center justify-center rounded-2xl border border-zinc-200/80 bg-white text-zinc-700 shadow-[0_2px_8px_rgba(0,0,0,0.02)] transition-all duration-200 hover:border-zinc-300 hover:bg-zinc-50 hover:text-zinc-900 active:scale-[0.98]"
            title="Yenile"
          >
            <span className="material-symbols-outlined text-[20px]">refresh</span>
          </button>
        </div>
      }
    >
      <div className="grid gap-6 lg:grid-cols-12">
        {/* Brands list */}
        <div className={`space-y-4 ${selectedBrand ? 'lg:col-span-6' : 'lg:col-span-12'}`}>
          <div className="flex items-center gap-3 rounded-2xl border border-zinc-200/80 bg-white px-4 py-3 text-sm text-zinc-700 shadow-[0_2px_8px_rgba(0,0,0,0.02)] transition-all duration-200 focus-within:ring-4 focus-within:ring-[#df0000]/5 focus-within:border-[#df0000]">
            <Icon name="search" className="h-5 w-5 text-zinc-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Marka adına göre ara..."
              className="w-full bg-transparent text-sm text-zinc-900 placeholder:text-zinc-400 outline-none"
            />
          </div>

          {loading && brands.length === 0 && (
            <div className="flex items-center justify-center p-12 text-sm text-zinc-400 font-medium bg-white rounded-3xl border border-zinc-200/80 shadow-[0_2px_8px_rgba(0,0,0,0.02)]">
              <span className="animate-spin mr-2 h-4 w-4 border-2 border-zinc-300 border-t-zinc-600 rounded-full" />
              Yükleniyor...
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

          {!loading && !error && (
            <div className="overflow-hidden rounded-3xl border border-zinc-200/80 bg-white shadow-[0_2px_8px_rgba(0,0,0,0.02),0_8px_24px_rgba(0,0,0,0.02)]">
              <div className="grid grid-cols-12 gap-3 border-b border-zinc-200/80 bg-zinc-50/80 px-6 py-4 text-[10px] font-extrabold tracking-wider text-zinc-400 uppercase">
                <div className="col-span-5">Marka</div>
                <div className="col-span-2 text-center">Toplam Ürün</div>
                <div className="col-span-2 text-center text-green-600">Yayında</div>
                <div className="col-span-1 text-center text-amber-600">Taslak</div>
                <div className="col-span-2 text-right">İşlemler</div>
              </div>

              <div className="divide-y divide-zinc-100">
                {filteredBrands.map((b) => (
                  <div
                    key={b.id}
                    onClick={() => setSelectedBrand(b.name === selectedBrand ? null : b.name)}
                    className={`grid grid-cols-12 gap-3 px-6 py-4 text-xs transition-all duration-150 cursor-pointer items-center ${
                      selectedBrand === b.name
                        ? 'bg-[#df0000]/5 font-semibold text-zinc-900 border-l-4 border-[#df0000]'
                        : 'hover:bg-zinc-50/50 text-zinc-600'
                    }`}
                  >
                    <div className="col-span-5 flex items-center gap-3">
                      {b.logoUrl ? (
                        <div className="w-8 h-8 rounded-lg border border-zinc-200 overflow-hidden bg-white flex items-center justify-center shrink-0 p-1 shadow-sm">
                          <img src={b.logoUrl} className="max-h-full max-w-full object-contain" />
                        </div>
                      ) : (
                        <span className={`material-symbols-outlined text-[18px] transition-colors ${selectedBrand === b.name ? 'text-[#df0000]' : 'text-zinc-400'}`}>sell</span>
                      )}
                      <div className="flex flex-col truncate">
                        <span className="truncate text-zinc-900 font-bold">{b.name}</span>
                        {b.description && (
                          <span className="truncate text-[10px] text-zinc-400 font-normal">{b.description}</span>
                        )}
                      </div>
                    </div>
                    <div className="col-span-2 text-center font-semibold text-zinc-800">{b.totalCount}</div>
                    <div className="col-span-2 text-center">
                      <span className="inline-flex items-center justify-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-green-50 text-green-700 border border-green-200/60">
                        {b.publishedCount}
                      </span>
                    </div>
                    <div className="col-span-1 text-center">
                      <span className="inline-flex items-center justify-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200/60">
                        {b.draftCount}
                      </span>
                    </div>
                    <div className="col-span-2 flex justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => handleOpenEditModal(b)}
                        className="w-7 h-7 rounded-lg border border-zinc-200 bg-white hover:bg-zinc-50 hover:text-zinc-900 text-zinc-500 flex items-center justify-center transition active:scale-90 shadow-sm shrink-0"
                        title="Düzenle"
                      >
                        <span className="material-symbols-outlined text-[15px]">edit</span>
                      </button>
                      <button
                        onClick={() => handleDeleteBrand(b.id)}
                        className="w-7 h-7 rounded-lg border border-zinc-200 bg-white hover:bg-rose-50 hover:text-rose-600 text-zinc-500 flex items-center justify-center transition active:scale-90 shadow-sm shrink-0"
                        title="Sil"
                      >
                        <span className="material-symbols-outlined text-[15px]">delete</span>
                      </button>
                    </div>
                  </div>
                ))}

                {filteredBrands.length === 0 && (
                  <div className="px-6 py-12 text-center text-zinc-400 font-medium italic bg-white">
                    Marka bulunamadı.
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Selected Brand Products list */}
        {selectedBrand && (
          <div className="lg:col-span-6 space-y-4 animate-in fade-in slide-in-from-right-4 duration-200">
            <div className="flex items-center justify-between border-b border-zinc-200/60 pb-3">
              <h3 className="text-sm font-bold text-zinc-800 tracking-tight flex items-center gap-2">
                <span className="material-symbols-outlined text-zinc-400">inventory_2</span>
                <span className="text-[#df0000]">"{selectedBrand}"</span> Markalı Ürünler
                <span className="ml-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-zinc-100 text-zinc-600 border border-zinc-200">
                  {selectedBrandProducts.length} adet
                </span>
              </h3>
              <button
                onClick={() => setSelectedBrand(null)}
                className="text-xs font-bold text-zinc-500 hover:text-zinc-950 flex items-center gap-1.5 transition-colors px-2 py-1 rounded-xl hover:bg-zinc-100"
              >
                <span className="material-symbols-outlined text-[16px]">close</span> Kapat
              </button>
            </div>

            <div className="overflow-hidden rounded-3xl border border-zinc-200/80 bg-white shadow-[0_2px_8px_rgba(0,0,0,0.02),0_8px_24px_rgba(0,0,0,0.02)] max-h-[600px] overflow-y-auto">
              <div className="grid grid-cols-12 gap-3 border-b border-zinc-200/80 bg-zinc-50/80 px-5 py-3.5 text-[10px] font-extrabold tracking-wider text-zinc-400 uppercase sticky top-0 backdrop-blur-md z-10">
                <div className="col-span-8">Ürün</div>
                <div className="col-span-2 font-mono">Stok Kodu</div>
                <div className="col-span-2 text-right">Durum</div>
              </div>
              <div className="divide-y divide-zinc-100">
                {selectedBrandProducts.map((p) => {
                  const tc = String(p.tenantCode ?? '').trim().toUpperCase()
                  const key = `${tc}:${p.id}`
                  const meta = metadata[key]
                  const status = meta?.status || 'Draft'

                  return (
                    <div key={p.id} className="grid grid-cols-12 gap-3 px-5 py-4 text-xs items-center hover:bg-zinc-50/30 transition-colors duration-150">
                      <div className="col-span-8 flex items-center gap-3">
                        <div className="w-10 h-10 rounded-2xl border border-zinc-200/80 overflow-hidden shrink-0 bg-zinc-50 flex items-center justify-center shadow-sm">
                          {p.imageUrl ? (
                            <img src={p.imageUrl} className="w-full h-full object-cover" />
                          ) : (
                            <span className="material-symbols-outlined text-[18px] text-zinc-400">image</span>
                          )}
                        </div>
                        <span className="font-semibold text-zinc-900 truncate hover:text-clip">{p.name}</span>
                      </div>
                      <div className="col-span-2 font-mono text-[11px] text-zinc-500 truncate">{p.stockCode}</div>
                      <div className="col-span-2 text-right">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-bold border uppercase tracking-wider ${
                          status === 'Published'
                            ? 'border-green-200 bg-green-50 text-green-700'
                            : 'border-zinc-200 bg-zinc-50 text-zinc-500'
                        }`}>
                          {status === 'Published' ? 'Yayında' : 'Taslak'}
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Brand Add/Edit Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-[70] animate-in fade-in duration-200">
          <div className="absolute inset-0 bg-zinc-950/45 backdrop-blur-sm" onClick={() => setIsModalOpen(false)} />
          <div className="absolute inset-0 flex items-center justify-center p-4">
            <div className="w-full max-w-md overflow-hidden rounded-[28px] border border-zinc-200 bg-white shadow-2xl flex flex-col animate-in zoom-in-95 duration-200">
              {/* Modal Header */}
              <div className="flex items-center justify-between border-b border-zinc-150 px-6 py-4.5 bg-zinc-50/50">
                <div>
                  <div className="text-[10px] font-extrabold tracking-widest text-[#df0000] uppercase">
                    {editingBrand ? 'MARKA DÜZENLE' : 'YENİ MARKA EKLE'}
                  </div>
                  <div className="mt-0.5 text-lg font-black text-zinc-950">
                    {editingBrand ? 'Marka Detaylarını Düzenle' : 'Marka Ekle'}
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
              <div className="p-6 space-y-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wide">Marka Adı *</label>
                  <input
                    type="text"
                    required
                    value={brandName}
                    onChange={(e) => setBrandName(e.target.value)}
                    placeholder="Örn: Stilsoft"
                    className="w-full rounded-2xl border border-zinc-200 bg-white px-3.5 py-2.5 text-xs text-zinc-855 placeholder-zinc-400 outline-none focus:ring-4 focus:ring-primary/10 focus:border-primary transition-all duration-200"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wide">Logo URL</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={brandLogoUrl}
                      onChange={(e) => setBrandLogoUrl(e.target.value)}
                      placeholder="Resim linki girin veya seçin"
                      className="flex-1 rounded-2xl border border-zinc-200 bg-white px-3.5 py-2.5 text-xs text-zinc-855 placeholder-zinc-400 outline-none focus:ring-4 focus:ring-primary/10 focus:border-primary transition-all duration-200"
                    />
                    <button
                      type="button"
                      onClick={() => setIsMediaOpen(true)}
                      className="px-4 rounded-2xl border border-zinc-200 hover:border-zinc-300 hover:bg-zinc-50 text-zinc-700 text-xs font-bold transition-all duration-200 flex items-center justify-center shrink-0 active:scale-95"
                    >
                      Seç
                    </button>
                  </div>
                  {brandLogoUrl && (
                    <div className="mt-3 h-16 w-fit max-w-full rounded-xl overflow-hidden border border-zinc-150 bg-zinc-50 p-2 flex items-center justify-center animate-in fade-in duration-200">
                      <img src={brandLogoUrl} className="h-full object-contain" alt="Logo önizleme" />
                    </div>
                  )}
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wide">Açıklama</label>
                  <textarea
                    rows={3}
                    value={brandDescription}
                    onChange={(e) => setBrandDescription(e.target.value)}
                    placeholder="Marka hakkında kısa bilgi..."
                    className="w-full rounded-2xl border border-zinc-200 bg-white px-3.5 py-2.5 text-xs text-zinc-855 placeholder-zinc-400 outline-none focus:ring-4 focus:ring-primary/10 focus:border-primary transition-all duration-200 resize-none"
                  />
                </div>
              </div>

              {/* Modal Footer */}
              <div className="flex items-center justify-end gap-2 border-t border-zinc-100 px-6 py-4 bg-zinc-50/50">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2.5 rounded-2xl border border-zinc-200 hover:bg-zinc-100 text-zinc-700 text-xs font-bold transition active:scale-[0.98]"
                >
                  Vazgeç
                </button>
                <button
                  type="button"
                  onClick={handleSaveBrand}
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

      {/* Media Library Modal integration */}
      <MediaLibraryModal
        isOpen={isMediaOpen}
        onClose={() => setIsMediaOpen(false)}
        onSelect={(url) => {
          setBrandLogoUrl(url)
          setIsMediaOpen(false)
        }}
      />
    </AdminLayout>
  )
}
