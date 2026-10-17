import { useEffect, useMemo, useState } from 'react'
import { extractProductsList, getAdminToken, readApiResponse, type ErpProductListItem } from '../lib/api'
import {
  addProductCategory,
  fetchAdminCategories,
  fetchProductCategories,
  removeProductCategory,
  setProductPrimaryCategory,
  type CategoryDto,
  type ProductCategoryMapDto,
} from '../lib/categoriesApi'
import { formatPrice } from '../lib/format'
import { ProductCategoryPicker } from '../components/admin/ProductCategoryPicker'
import { ProductMetadataModal } from '../components/admin/ProductMetadataModal'
import { ProductImagesModal } from '../components/admin/ProductImagesModal'
import { fetchAllAdminProductMetadata } from '../lib/productMetadataApi'
import { AdminLayout } from '../components/admin/AdminLayout'

type ProductSettingDto = {
  tenantCode?: string
  productId: string
  isFeatured: boolean
  overridePrice: number | null
  overrideCurrency: string | null
}

type DraftSetting = {
  isFeatured: boolean
  overridePriceText: string
}


export function AdminPage() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [items, setItems] = useState<ErpProductListItem[]>([])
  const [statusFilter, setStatusFilter] = useState<'All' | 'Draft' | 'Published'>('All')
  const [metadataMap, setMetadataMap] = useState<Record<string, string>>({})
  const [q, setQ] = useState('')
  const [settings, setSettings] = useState<Record<string, ProductSettingDto>>({})
  const [drafts, setDrafts] = useState<Record<string, DraftSetting>>({})
  const [dirty, setDirty] = useState<Record<string, boolean>>({})
  const [saving, setSaving] = useState<Record<string, boolean>>({})
  const [categories, setCategories] = useState<CategoryDto[]>([])
  const [productCats, setProductCats] = useState<Record<string, ProductCategoryMapDto[]>>({})
  const [catDrafts, setCatDrafts] = useState<Record<string, ProductCategoryMapDto[]>>({})
  const [metaOpen, setMetaOpen] = useState(false)
  const [metaProduct, setMetaProduct] = useState<ErpProductListItem | null>(null)
  const [imagesOpen, setImagesOpen] = useState(false)
  const [imagesProduct, setImagesProduct] = useState<ErpProductListItem | null>(null)
  const [toast, setToast] = useState<string | null>(null)


  const authHeader = useMemo(() => {
    const token = getAdminToken()
    return token ? { Authorization: `Bearer ${token}` } : null
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        setLoading(true)
        setError(null)

        const [prodRes, settingsRes] = await Promise.all([
          fetch('/api/admin/products', { headers: { ...(authHeader ?? {}) } }),
          fetch('/api/admin/product-settings', { headers: { ...(authHeader ?? {}) } }),
        ])

        const prodJson = await readApiResponse(prodRes)
        if (!prodRes.ok) throw new Error(prodJson?.message || 'Ürünler alınamadı')
        const prods = extractProductsList(prodJson)

        const settingsJson = await readApiResponse(settingsRes)
        if (!settingsRes.ok) throw new Error(settingsJson?.message || 'Ayarlar alınamadı')
        const list: ProductSettingDto[] = Array.isArray(settingsJson?.data) ? settingsJson.data : []
        const map: Record<string, ProductSettingDto> = {}
        for (const s of list) {
          const tc = String(s.tenantCode ?? '').trim().toUpperCase()
          const key = tc ? `${tc}:${s.productId}` : s.productId
          map[key] = s
        }

        if (!cancelled) {
          setItems(prods)
          setSettings(map)
          const nextDrafts: Record<string, DraftSetting> = {}
          for (const p of prods.slice(0, 500)) {
            const tc = String(p.tenantCode ?? '').trim().toUpperCase()
            if (!tc) continue
            const key = `${tc}:${p.id}`
            const cur = map[key]
            nextDrafts[key] = {
              isFeatured: cur?.isFeatured ?? false,
              overridePriceText: cur?.overridePrice === null || cur?.overridePrice === undefined ? '' : String(cur.overridePrice),
            }
          }
          setDrafts(nextDrafts)
          setDirty({})
        }

        // Categories loaded independently now
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Ürünler alınamadı')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [authHeader])

  useEffect(() => {
    if (!authHeader) return
    let cancelled = false
    ;(async () => {
      try {
        const cats = await fetchAdminCategories(authHeader)
        if (!cancelled) setCategories(cats)
      } catch {
        if (!cancelled) setCategories([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [authHeader])

  useEffect(() => {
    if (!authHeader) return
    let cancelled = false
    ;(async () => {
      try {
        const list = await fetchAllAdminProductMetadata(authHeader)
        const map: Record<string, string> = {}
        for (const m of list) {
          map[m.productId] = m.status || 'Draft'
        }
        if (!cancelled) setMetadataMap(map)
      } catch (e) {
        console.error('Failed to load product metadatas', e)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [authHeader])

  async function refreshCategories() {
    if (!authHeader) return
    try {
      setError(null)
      const cats = await fetchAdminCategories(authHeader)
      setCategories(cats)
      showToast('Kategoriler yenilendi.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kategoriler yenilenemedi')
    }
  }

  function showToast(message: string) {
    setToast(message)
    window.setTimeout(() => setToast(null), 2200)
  }

  function parseOverridePrice(text: string): number | null | undefined {
    const t = (text ?? '').trim()
    if (t === '') return null
    const normalized = t.replace(',', '.')
    const n = Number(normalized)
    if (!Number.isFinite(n)) return undefined
    return n
  }

  useEffect(() => {
    if (!authHeader) return
    if (items.length === 0) return

    let cancelled = false
    ;(async () => {
      try {
        const next: Record<string, ProductCategoryMapDto[]> = {}
        const slice = items.slice(0, 200)
        for (const p of slice) {
          const tc = String(p.tenantCode ?? '').trim().toUpperCase()
          if (!tc) continue
          const key = `${tc}:${p.id}`
          next[key] = await fetchProductCategories(authHeader, p.id, tc)
        }
        if (!cancelled) {
          setProductCats(next)
          setCatDrafts(next)
        }
      } catch {
        if (!cancelled) setProductCats({})
      }
    })()

    return () => {
      cancelled = true
    }
  }, [authHeader, items])

  function normalizeCatDraft(list: ProductCategoryMapDto[]): ProductCategoryMapDto[] {
    const uniq = new Map<string, ProductCategoryMapDto>()
    for (const x of list ?? []) {
      if (!x?.categoryId) continue
      uniq.set(x.categoryId, {
        categoryId: x.categoryId,
        isPrimary: !!x.isPrimary,
        sortOrder: Number.isFinite(x.sortOrder) ? x.sortOrder : 0,
      })
    }

    let primaryId: string | null = null
    for (const x of uniq.values()) {
      if (x.isPrimary) {
        primaryId = x.categoryId
        break
      }
    }

    if (primaryId) {
      for (const x of uniq.values()) {
        x.isPrimary = x.categoryId === primaryId
      }
    }

    return Array.from(uniq.values())
  }

  function updateProductCategories(key: string, categoryPathIds: string[]) {
    setCatDrafts((prev) => {
      const lastIndex = categoryPathIds.length - 1
      const nextList: ProductCategoryMapDto[] = categoryPathIds.map((categoryId, index) => ({
        categoryId,
        isPrimary: index === lastIndex,
        sortOrder: index,
      }))
      return { ...prev, [key]: nextList }
    })
    setDirty((prev) => ({ ...prev, [key]: true }))
  }

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    
    let list = items
    if (statusFilter === 'Draft') {
      list = items.filter(p => (metadataMap[p.id] ?? 'Draft') === 'Draft')
    } else if (statusFilter === 'Published') {
      list = items.filter(p => (metadataMap[p.id] ?? 'Draft') === 'Published')
    }

    if (!s) return list
    return list.filter((p) => {
      const hay = `${p.name ?? ''} ${p.stockCode ?? ''} ${p.mainCategory ?? ''} ${p.subCategory ?? ''}`.toLowerCase()
      return hay.includes(s)
    })
  }, [items, q, statusFilter, metadataMap])

  async function saveCategories(productId: string, tenantCode: string | undefined, key: string) {
    if (!authHeader) {
      setError('Yetki yok. Tekrar giriş yap.')
      return
    }

    const tc = String(tenantCode ?? '').trim().toUpperCase()
    if (!tc) {
      setError('Tenant bilgisi bulunamadı')
      return
    }

    const server = normalizeCatDraft(productCats[key] ?? [])
    const draft = normalizeCatDraft(catDrafts[key] ?? server)

    const serverPrimary = server.find((x) => x.isPrimary)?.categoryId ?? null
    const draftPrimary = draft.find((x) => x.isPrimary)?.categoryId ?? null

    const serverIds = new Set(server.map((x) => x.categoryId))
    const draftIds = new Set(draft.map((x) => x.categoryId))

    const toAdd = Array.from(draftIds).filter((id) => !serverIds.has(id))
    const toRemove = Array.from(serverIds).filter((id) => !draftIds.has(id))

    if (draftPrimary)
    {
      // If primary category is newly selected but not yet mapped, create mapping as primary first.
      if (!serverIds.has(draftPrimary))
      {
        await addProductCategory(authHeader, productId, tc, draftPrimary, true)
      }
      else if (draftPrimary != serverPrimary)
      {
        await setProductPrimaryCategory(authHeader, productId, tc, draftPrimary)
      }
    }

    for (const id of toAdd) {
      if (id === draftPrimary) continue
      await addProductCategory(authHeader, productId, tc, id, false)
    }

    for (const id of toRemove) {
      await removeProductCategory(authHeader, productId, tc, id)
    }

    setProductCats((prev) => ({ ...prev, [key]: draft }))
    setCatDrafts((prev) => ({ ...prev, [key]: draft }))
  }

  async function upsert(productId: string, tenantCode: string | undefined, patch: Partial<ProductSettingDto>) {
    if (!authHeader) {
      setError('Yetki yok. Tekrar giriş yap.')
      return
    }

    const tc = String(tenantCode ?? '').trim().toUpperCase()
    if (!tc) {
      setError('Tenant bilgisi bulunamadı')
      return
    }

    try {
      setSaving((x) => ({ ...x, [productId]: true }))
      setError(null)

      const current = settings[`${tc}:${productId}`] ?? settings[productId]
      const body = {
        isFeatured: patch.isFeatured ?? current?.isFeatured ?? false,
        overridePrice: patch.overridePrice ?? current?.overridePrice ?? null,
        overrideCurrency: patch.overrideCurrency ?? current?.overrideCurrency ?? null,
      }

      const res = await fetch(`/api/admin/product-settings/${productId}?tenantCode=${encodeURIComponent(tc)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify(body),
      })

      const json = await readApiResponse(res)
      if (!res.ok || !json?.success) throw new Error(json?.message || 'Kaydedilemedi')

      setSettings((prev) => ({
        ...prev,
        [`${tc}:${productId}`]: {
          tenantCode: tc,
          productId,
          isFeatured: body.isFeatured,
          overridePrice: body.overridePrice,
          overrideCurrency: body.overrideCurrency,
        },
      }))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kaydedilemedi')
    } finally {
      setSaving((x) => ({ ...x, [productId]: false }))
    }
  }

  // Dynamic Catalog Stock Distribution
  const catalogStockDistribution = useMemo(() => {
    const map: Record<string, number> = {}
    const catMap = new Map<string, any>()
    categories.forEach(c => catMap.set(c.id, c))

    items.forEach((p) => {
      const tc = String(p.tenantCode ?? '').trim().toUpperCase()
      const key = `${tc}:${p.id}`
      const catsForProduct = productCats[key] || []
      
      let categoryName = 'Genel'
      const primaryCatMap = catsForProduct.find(c => c.isPrimary) || catsForProduct[0]
      if (primaryCatMap) {
        let cat = catMap.get(primaryCatMap.categoryId)
        if (cat) {
          while (cat && cat.parentId) {
            const parent = catMap.get(cat.parentId)
            if (!parent) break
            cat = parent
          }
          if (cat) {
            categoryName = cat.name
          }
        }
      }

      const stock = p.stock || 0
      map[categoryName] = (map[categoryName] || 0) + stock
    })
    
    const arr = Object.entries(map).map(([label, count]) => ({
      label,
      count,
    }))
    
    arr.sort((a, b) => b.count - a.count)
    
    const top = arr.slice(0, 4)
    const maxCount = top.length > 0 ? top[0].count : 1
    const colors = ['bg-[#df0000]', 'bg-zinc-800', 'bg-blue-500', 'bg-emerald-500']
    
    return top.map((st, idx) => ({
      label: st.label,
      count: st.count,
      pct: maxCount > 0 ? Math.round((st.count / maxCount) * 100) : 0,
      color: colors[idx % colors.length]
    }))
  }, [items, productCats, categories])



  return (
    <AdminLayout
      title="Ürün Yönetimi"
      subtitle="ERP’den gelen ürünleri yönetin, kategorilerini düzenleyin ve fiyatlarını ayarlayın."
      top={
        <div className="flex w-full items-center justify-end gap-3">
          <div className="hidden items-center gap-2.5 rounded-2xl border border-zinc-200 bg-white px-4 py-2 text-xs text-zinc-700 shadow-sm focus-within:ring-4 focus-within:ring-primary/10 focus-within:border-[#df0000] transition-all duration-200 md:flex md:w-[320px]">
            <span className="material-symbols-outlined text-zinc-400 text-[18px]">search</span>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Ürün listesinde hızlı ara..."
              className="w-full bg-transparent text-zinc-900 placeholder:text-zinc-400 outline-none text-xs font-semibold"
            />
          </div>
          <button
            type="button"
            onClick={refreshCategories}
            className="flex items-center gap-1.5 h-10 px-4 rounded-2xl border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 hover:border-zinc-350 transition active:scale-95 text-xs font-bold shadow-sm"
          >
            <span className="material-symbols-outlined text-[18px]">refresh</span>
            <span>Kategorileri Yenile</span>
          </button>
          <button
            type="button"
            onClick={() => { setMetaProduct(null); setMetaOpen(true); }}
            className="flex items-center gap-1.5 h-10 px-4 rounded-2xl bg-[#df0000] text-white hover:bg-[#c00000] transition active:scale-95 text-xs font-bold shadow-sm shadow-[#df0000]/10"
          >
            <span className="material-symbols-outlined text-[18px]">add</span>
            <span>Yeni Ürün Ekle</span>
          </button>
        </div>
      }
    >
      {toast && (
        <div className="sticky top-[76px] z-30 mb-4 animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="mx-auto w-full max-w-3xl rounded-2xl border border-[#df0000]/20 bg-[#df0000]/5 px-4 py-3 text-xs font-semibold text-[#df0000] shadow-sm text-center">
            {toast}
          </div>
        </div>
      )}

      {/* Breadcrumb Header Canvas */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-6">
        <div>
          <nav className="flex text-xs text-zinc-400 gap-1.5 mb-2 font-medium">
            <span>Katalog</span>
            <span className="material-symbols-outlined text-[14px]">chevron_right</span>
            <span className="text-[#df0000] font-semibold">Ürün Yönetimi</span>
          </nav>
          <h2 className="text-xl font-bold text-zinc-900 tracking-tight">Katalog Ürünleri</h2>
          <p className="text-xs text-zinc-500 max-w-2xl mt-1">ERP sisteminden gelen ham ürün listesini kontrol edin, kategori atamaları yapın ve vitrin/fiyat override ayarlarını uygulayın.</p>
        </div>
      </div>

      {/* Bento Grid Analytics */}
      <div className="grid gap-5 grid-cols-2 md:grid-cols-4 mb-6">
        {/* Toplam Ürün */}
        <div className="bg-white rounded-3xl border border-zinc-200/80 p-5 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-300">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-[10px] font-extrabold text-zinc-400 uppercase tracking-widest">TOPLAM KATALOG</p>
              <p className="text-2xl font-black text-zinc-950 mt-1">{items.length}</p>
            </div>
            <div className="p-2.5 rounded-2xl bg-[#df0000]/5 text-[#df0000]">
              <span className="material-symbols-outlined text-[24px]">inventory_2</span>
            </div>
          </div>
          <div className="mt-3.5 pt-3 border-t border-zinc-100 text-[10px] text-zinc-500 font-semibold uppercase tracking-wider">
            Sistemdeki aktif ürün sayısı
          </div>
        </div>

        {/* Vitrin Ürünleri */}
        <div className="bg-white rounded-3xl border border-zinc-200/80 p-5 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-300">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-[10px] font-extrabold text-zinc-400 uppercase tracking-widest">VİTRİN (FEATURED)</p>
              <p className="text-2xl font-black text-zinc-950 mt-1">
                {Object.values(settings).filter(x => x.isFeatured).length}
              </p>
            </div>
            <div className="p-2.5 rounded-2xl bg-blue-50 text-blue-600">
              <span className="material-symbols-outlined text-[24px]">grade</span>
            </div>
          </div>
          <div className="mt-3.5 pt-3 border-t border-zinc-100 text-[10px] text-zinc-500 font-semibold uppercase tracking-wider">
            Anasayfada öne çıkarılanlar
          </div>
        </div>

        {/* Kategori Eksik */}
        <div className="bg-white rounded-3xl border border-zinc-200/80 p-5 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-300">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-[10px] font-extrabold text-zinc-400 uppercase tracking-widest">KATEGORİSİZ</p>
              <p className="text-2xl font-black text-amber-600 mt-1">
                {items.filter(p => {
                  const tc = String(p.tenantCode ?? '').trim().toUpperCase()
                  const key = `${tc}:${p.id}`
                  return !productCats[key]?.length
                }).length}
              </p>
            </div>
            <div className="p-2.5 rounded-2xl bg-amber-50 text-amber-600">
              <span className="material-symbols-outlined text-[24px]">warning</span>
            </div>
          </div>
          <div className="mt-3.5 pt-3 border-t border-zinc-100 text-[10px] text-zinc-500 font-semibold uppercase tracking-wider">
            Kategori atanması gerekenler
          </div>
        </div>

        {/* Override Fiyatlı Ürünler */}
        <div className="bg-white rounded-3xl border border-zinc-200/80 p-5 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-300">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-[10px] font-extrabold text-zinc-400 uppercase tracking-widest">ÖZEL FİYATLI</p>
              <p className="text-2xl font-black text-emerald-600 mt-1">
                {Object.values(settings).filter(x => x.overridePrice !== null && x.overridePrice !== undefined).length}
              </p>
            </div>
            <div className="p-2.5 rounded-2xl bg-emerald-50 text-emerald-600">
              <span className="material-symbols-outlined text-[24px]">sell</span>
            </div>
          </div>
          <div className="mt-3.5 pt-3 border-t border-zinc-100 text-[10px] text-zinc-500 font-semibold uppercase tracking-wider">
            Manuel fiyat girilenler
          </div>
        </div>
      </div>

      {/* Stock Health & Integration Bento Row */}
      <div className="grid gap-6 grid-cols-1 lg:grid-cols-10 mb-6">
        {/* Stok Sağlığı Grafiği (60%) */}
        <div className="lg:col-span-6 bg-white border border-zinc-200/80 rounded-3xl p-6 shadow-sm flex flex-col justify-between">
          <div>
            <h3 className="text-sm font-bold text-zinc-800 uppercase tracking-wider">Katalog Stok Dağılımı</h3>
            <p className="text-[11px] font-semibold text-zinc-400 mt-1">En yüksek envanter oranına sahip ürünlerin dağılımı</p>
          </div>
          <div className="space-y-4 pt-6">
            {catalogStockDistribution.length === 0 ? (
              <p className="text-xs text-zinc-400 italic">Katalogda ürün veya stok bulunmuyor.</p>
            ) : (
              catalogStockDistribution.map((st, idx) => (
                <div key={idx} className="space-y-2">
                  <div className="flex justify-between text-xs font-bold text-zinc-700">
                    <span>{st.label}</span>
                    <span>{st.count} Adet Stok</span>
                  </div>
                  <div className="h-2 w-full bg-zinc-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${st.color}`}
                      style={{ width: `${st.pct}%` }}
                    />
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* ERP Sync Status Bento Card (40%) */}
        <div className="lg:col-span-4 bg-zinc-900 text-white rounded-3xl p-6 shadow-lg relative overflow-hidden group cursor-pointer flex flex-col justify-between">
          <div className="absolute -right-8 -bottom-8 opacity-10 group-hover:scale-110 transition-transform duration-500">
            <span className="material-symbols-outlined text-[160px] text-white">sync_alt</span>
          </div>
          <div className="relative z-10 space-y-3">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping" />
              <h3 className="text-sm font-bold uppercase tracking-wider text-emerald-400">ERP Entegrasyonu Aktif</h3>
            </div>
            <p className="text-xs text-zinc-350 leading-relaxed">
              Logo/Netsis ERP sisteminizdeki stok, barkod ve baz fiyat verileri Kıbrıs e-ticaret portalınızla anlık olarak entegre edilmektedir.
            </p>
          </div>
          <button
            onClick={() => showToast('ERP Entegrasyon logları sayfasına yönlendiriliyorsunuz.')}
            className="mt-6 px-4 py-2.5 bg-white text-zinc-900 hover:bg-zinc-100 rounded-2xl font-bold text-xs w-fit active:scale-95 transition-all shadow-md relative z-10"
          >
            Entegrasyonu Yönet
          </button>
        </div>
      </div>

      {/* Mobile Search and Add Actions */}
      <div className="md:hidden flex gap-2 items-center mb-4">
        <div className="flex-1 flex items-center gap-2.5 rounded-2xl border border-zinc-200 bg-white px-4 py-2.5 text-xs text-zinc-700 shadow-sm focus-within:ring-4 focus-within:ring-primary/10 focus-within:border-[#df0000] transition-all duration-200">
          <span className="material-symbols-outlined text-zinc-400 text-[18px]">search</span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Ürün ara..."
            className="w-full bg-transparent text-zinc-900 placeholder:text-zinc-400 outline-none text-xs font-semibold"
          />
        </div>
        <button
          type="button"
          onClick={() => { setMetaProduct(null); setMetaOpen(true); }}
          className="flex items-center justify-center h-10 w-10 rounded-2xl bg-[#df0000] text-white hover:bg-[#c00000] transition active:scale-95 shrink-0"
        >
          <span className="material-symbols-outlined">add</span>
        </button>
      </div>

      {loading && <div className="mt-4 text-xs font-semibold text-zinc-500 animate-pulse">Veriler yükleniyor…</div>}
      {error && (
        <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-xs font-semibold text-rose-700 flex items-center gap-2">
          <span className="material-symbols-outlined text-rose-600">error</span>
          <span>{error}</span>
        </div>
      )}

      {/* Tabs for Status filtering */}
      <div className="flex border-b border-zinc-200 mb-4 bg-transparent gap-2 px-1">
        {[
          { id: 'All', label: 'Tüm Ürünler' },
          { id: 'Published', label: 'Yayındakiler' },
          { id: 'Draft', label: 'Taslaklar' },
        ].map((t) => {
          const count = t.id === 'All'
            ? items.length
            : t.id === 'Draft'
              ? items.filter(p => (metadataMap[p.id] ?? 'Draft') === 'Draft').length
              : items.filter(p => (metadataMap[p.id] ?? 'Draft') === 'Published').length

          return (
            <button
              key={t.id}
              onClick={() => setStatusFilter(t.id as any)}
              className={`flex items-center gap-1.5 py-2.5 px-4 font-bold text-xs uppercase border-b-2 transition-all -mb-[1px] ${
                statusFilter === t.id
                  ? 'border-[#df0000] text-[#df0000]'
                  : 'border-transparent text-zinc-500 hover:text-zinc-800'
              }`}
            >
              <span>{t.label}</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-extrabold ${
                statusFilter === t.id
                  ? 'bg-[#df0000]/10 text-[#df0000]'
                  : 'bg-zinc-100 text-zinc-555'
              }`}>
                {count}
              </span>
            </button>
          )
        })}
      </div>

      {/* Products Table Card Container */}
      <div className="bg-white border border-zinc-200/80 rounded-3xl overflow-hidden shadow-sm">
        {/* Filters and summary bar */}
        <div className="p-4 flex flex-wrap gap-4 items-center bg-zinc-50/50 border-b border-zinc-150">
          <div className="flex-1 min-w-[240px] relative">
            <span className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400 text-[18px]">
              filter_list
            </span>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Ürün adı, SKU veya kategori ile filtrele..."
              className="w-full pl-10 pr-4 py-2 bg-white border border-zinc-200 rounded-2xl focus:border-[#df0000] focus:ring-4 focus:ring-[#df0000]/5 transition-all text-xs font-semibold text-zinc-700 outline-none"
            />
          </div>
          
          <div className="flex items-center gap-2 text-xs font-bold text-zinc-500">
            <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-zinc-100 text-zinc-700">
              Toplam: {items.length} Ürün
            </span>
            <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-50 text-amber-700 border border-amber-250">
              Kategori Eksik: {items.filter(p => {
                const tc = String(p.tenantCode ?? '').trim().toUpperCase()
                const key = `${tc}:${p.id}`
                return !productCats[key]?.length
              }).length}
            </span>
          </div>
        </div>

        {/* The HTML Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead className="bg-zinc-50 border-b border-zinc-200 text-[10px] font-extrabold tracking-wider text-zinc-450 uppercase">
              <tr>
                <th className="px-6 py-4">Ürün Bilgisi</th>
                <th className="px-6 py-4">Stok Kodu</th>
                <th className="px-6 py-4">Kategori Tanımı</th>
                <th className="px-6 py-4 text-center">Vitrin (Featured)</th>
                <th className="px-6 py-4">Fiyat Override (₺)</th>
                <th className="px-6 py-4 text-right">Baz Fiyat</th>
                <th className="px-6 py-4 text-right">İşlemler</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-150/60 text-xs text-zinc-600 bg-white">
              {filtered.slice(0, 200).map((p) => {
                const tc = String(p.tenantCode ?? '').trim().toUpperCase()
                const s = (tc ? settings[`${tc}:${p.id}`] : null) ?? settings[p.id]
                const isBusy = saving[p.id] ?? false
                const pcKey = tc ? `${tc}:${p.id}` : p.id
                const serverCats = tc ? productCats[pcKey] ?? [] : []
                const draftCats = tc ? catDrafts[pcKey] ?? serverCats : []
                const key = tc ? `${tc}:${p.id}` : p.id
                const d = drafts[key] ?? {
                  isFeatured: s?.isFeatured ?? false,
                  overridePriceText: s?.overridePrice === null || s?.overridePrice === undefined ? '' : String(s.overridePrice),
                }
                const isDirty = (dirty[key] ?? false) || (dirty[pcKey] ?? false)

                return (
                  <tr
                    key={p.id}
                    className={`transition-all duration-200 group relative border-l-4 ${
                      isDirty
                        ? 'border-l-[#df0000] bg-orange-50/15 hover:bg-orange-50/25'
                        : 'border-l-transparent hover:bg-zinc-50/40 hover:shadow-[0_4px_16px_rgba(0,0,0,0.015)]'
                    }`}
                  >
                    <td className="px-6 py-3.5">
                      <div className="flex items-center gap-3.5">
                        <div className="w-14 h-14 rounded-2xl border border-zinc-200 overflow-hidden bg-white flex-shrink-0 flex items-center justify-center shadow-sm group-hover:scale-105 transition-transform duration-300">
                          {p.imageUrl ? (
                            <img src={p.imageUrl} alt={p.name} className="h-full w-full object-contain" />
                          ) : (
                            <span className="material-symbols-outlined text-zinc-300 text-[24px]">image</span>
                          )}
                        </div>
                        <div className="space-y-1 min-w-0">
                          <div className="font-extrabold text-zinc-900 text-[13px] max-w-xs truncate leading-snug tracking-tight" title={p.name}>
                            {p.name ?? 'Ürün'}
                          </div>
                          <div className="flex flex-wrap items-center gap-1.5">
                            {p.tenantCode && (
                              <span className="text-[9px] font-black bg-zinc-100 text-zinc-500 border border-zinc-200/50 px-1.5 py-0.5 rounded uppercase tracking-wider">
                                {p.tenantCode}
                              </span>
                            )}
                            {p.subCategory && (
                              <span className="text-[9px] font-black bg-rose-50 text-[#df0000] border border-[#df0000]/10 px-1.5 py-0.5 rounded uppercase tracking-wider">
                                {p.subCategory}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-3.5">
                      <span className="inline-block font-mono font-bold text-zinc-500 text-[11px] bg-zinc-50 border border-zinc-200/60 px-2 py-0.5 rounded-lg shadow-sm">
                        {p.stockCode ?? ''}
                      </span>
                    </td>
                    <td className="px-6 py-3.5">
                      <ProductCategoryPicker
                        categories={categories}
                        selected={draftCats}
                        busy={isBusy}
                        onChange={(categoryPathIds) => updateProductCategories(pcKey, categoryPathIds)}
                      />
                    </td>
                    <td className="px-6 py-3.5 text-center">
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => {
                          const v = !d.isFeatured
                          setDrafts((prev) => ({
                            ...prev,
                            [key]: {
                              ...(prev[key] ?? d),
                              isFeatured: v,
                            },
                          }))
                          setDirty((prev) => ({ ...prev, [key]: true }))
                        }}
                        className={`inline-flex items-center justify-center w-9 h-9 rounded-xl transition-all duration-200 active:scale-90 ${
                          d.isFeatured
                            ? 'bg-amber-50 text-amber-500 hover:bg-amber-100 hover:text-amber-600 shadow-sm border border-amber-200/60'
                            : 'text-zinc-350 hover:text-zinc-550 hover:bg-zinc-100/60'
                        }`}
                        title={d.isFeatured ? 'Öne Çıkarılmış (Vitrin)' : 'Vitrine Ekle'}
                      >
                        <span
                          className="material-symbols-outlined text-[20px]"
                          style={{ fontVariationSettings: d.isFeatured ? "'FILL' 1" : "'FILL' 0" }}
                        >
                          star
                        </span>
                      </button>
                    </td>
                    <td className="px-6 py-3.5">
                      <div className="relative max-w-[130px] flex items-center rounded-xl border border-zinc-200 bg-zinc-50/50 hover:bg-white hover:border-zinc-350 focus-within:bg-white focus-within:border-[#df0000] focus-within:ring-4 focus-within:ring-[#df0000]/5 transition-all duration-200 px-2.5 py-1.5">
                        <span className="text-zinc-400 font-extrabold text-xs mr-1 select-none">₺</span>
                        <input
                          value={d.overridePriceText}
                          disabled={isBusy}
                          placeholder="Fiyat girin..."
                          className="w-full bg-transparent text-xs font-bold text-zinc-800 placeholder:text-zinc-350 outline-none outline-0 border-0 p-0"
                          onChange={(e) => {
                            const v = e.target.value
                            setDrafts((prev) => ({
                              ...prev,
                              [key]: {
                                ...(prev[key] ?? d),
                                overridePriceText: v,
                              },
                            }))
                            setDirty((prev) => ({ ...prev, [key]: true }))
                          }}
                        />
                        {d.overridePriceText && (
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => {
                              setDrafts((prev) => ({
                                ...prev,
                                [key]: {
                                  ...(prev[key] ?? d),
                                  overridePriceText: '',
                                },
                              }))
                              setDirty((prev) => ({ ...prev, [key]: true }))
                            }}
                            className="text-zinc-400 hover:text-zinc-655 flex items-center justify-center p-0.5 rounded-full hover:bg-zinc-200 transition-colors ml-1 shrink-0"
                          >
                            <span className="material-symbols-outlined text-[12px]">close</span>
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-3.5 text-right font-black text-zinc-955 text-[13.5px]">
                      {formatPrice(p)}
                    </td>
                    <td className="px-6 py-3.5 text-right">
                      {isDirty ? (
                        <div className="flex items-center justify-end gap-1.5 animate-in slide-in-from-right-2 duration-150">
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={async () => {
                              const n = parseOverridePrice(d.overridePriceText)
                              if (n === undefined) {
                                setError('Override fiyat geçersiz')
                                return
                              }

                              try {
                                setError(null)
                                await upsert(p.id, p.tenantCode, {
                                  isFeatured: d.isFeatured,
                                  overridePrice: n,
                                })
                                await saveCategories(p.id, p.tenantCode, pcKey)
                                setDirty((prev) => ({ ...prev, [key]: false, [pcKey]: false }))
                                showToast('Değişiklikler kaydedildi')
                              } catch (e) {
                                setError(e instanceof Error ? e.message : 'Kaydedilemedi')
                              }
                            }}
                            className="h-8 rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 px-3 text-xs font-bold shadow-md shadow-emerald-600/10 transition active:scale-95 flex items-center justify-center gap-1 shrink-0"
                          >
                            {isBusy ? (
                              <span className="material-symbols-outlined text-[16px] animate-spin">sync</span>
                            ) : (
                              <span className="material-symbols-outlined text-[16px]">check</span>
                            )}
                            <span>{isBusy ? '...' : 'Kaydet'}</span>
                          </button>
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => {
                              const tc = String(p.tenantCode ?? '').trim().toUpperCase()
                              const cur = tc ? settings[`${tc}:${p.id}`] : settings[p.id]
                              setDrafts((prev) => ({
                                ...prev,
                                [key]: {
                                  isFeatured: cur?.isFeatured ?? false,
                                  overridePriceText: cur?.overridePrice === null || cur?.overridePrice === undefined ? '' : String(cur.overridePrice),
                                },
                              }))
                              setCatDrafts((prev) => ({
                                ...prev,
                                [pcKey]: productCats[pcKey] ?? [],
                              }))
                              setDirty((prev) => ({ ...prev, [key]: false, [pcKey]: false }))
                            }}
                            className="w-8 h-8 rounded-xl border border-zinc-200 bg-white hover:bg-zinc-50 text-zinc-550 hover:text-zinc-800 flex items-center justify-center transition active:scale-95 shadow-sm shrink-0"
                            title="Değişiklikleri Geri Al"
                          >
                            <span className="material-symbols-outlined text-[16px]">close</span>
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center justify-end gap-1.5 md:opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                          <button
                            type="button"
                            className="w-8 h-8 rounded-xl border border-zinc-200 bg-white hover:bg-zinc-50 text-zinc-550 hover:text-zinc-950 flex items-center justify-center transition active:scale-95 shadow-sm shrink-0"
                            title="Detayları Düzenle"
                            onClick={() => {
                              setMetaProduct(p)
                              setMetaOpen(true)
                            }}
                          >
                            <span className="material-symbols-outlined text-[16.5px]">edit</span>
                          </button>
                          <button
                            type="button"
                            className="w-8 h-8 rounded-xl border border-zinc-200 bg-white hover:bg-zinc-50 text-zinc-550 hover:text-[#df0000] flex items-center justify-center transition active:scale-95 shadow-sm shrink-0"
                            title="Görselleri Yönet"
                            onClick={() => {
                              setImagesProduct(p)
                              setImagesOpen(true)
                            }}
                          >
                            <span className="material-symbols-outlined text-[16.5px]">image</span>
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}

              {filtered.length === 0 && !loading && !error && (
                <tr>
                  <td colSpan={7} className="px-6 py-20 text-center text-zinc-400 font-medium italic bg-white">
                    Ürün bulunamadı.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <ProductMetadataModal
        open={metaOpen}
        onClose={() => setMetaOpen(false)}
        authHeader={authHeader}
        product={metaProduct}
        onSuccess={(updatedOrCreatedProd) => {
          setItems((prev) => {
            const exists = prev.some((item) => item.id === updatedOrCreatedProd.id)
            if (exists) {
              return prev.map((item) => (item.id === updatedOrCreatedProd.id ? { ...item, ...updatedOrCreatedProd } : item))
            } else {
              return [updatedOrCreatedProd, ...prev]
            }
          })
          if (updatedOrCreatedProd.status) {
            setMetadataMap((prev) => ({
              ...prev,
              [updatedOrCreatedProd.id]: updatedOrCreatedProd.status
            }))
          }
        }}
      />

      <ProductImagesModal
        open={imagesOpen}
        onClose={() => setImagesOpen(false)}
        authHeader={authHeader}
        product={imagesProduct}
        onUpdated={(dto) => {
          if (!imagesProduct) return
          setItems((prev) => prev.map((x) => (x.id === imagesProduct.id ? { ...x, imageUrl: dto.imageUrl ?? undefined } : x)))
        }}
      />
    </AdminLayout>
  )
}
