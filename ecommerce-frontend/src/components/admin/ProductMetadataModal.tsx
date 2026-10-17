import { useEffect, useMemo, useState, useRef } from 'react'
import { readApiResponse, type ErpProductListItem } from '../../lib/api'
import { fetchAdminProductMetadata, upsertAdminProductMetadata, type ProductMetadataDto } from '../../lib/productMetadataApi'
import { fetchAdminCategories, fetchProductCategories, type CategoryDto } from '../../lib/categoriesApi'
import { MediaLibraryModal } from '../ui/MediaLibraryModal'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { useToast } from '../ui/ToastContext'

interface VariantGroupItem {
  value: string
  link: string
}

interface VariantGroup {
  groupName: string
  items: VariantGroupItem[]
}

interface SpecRow {
  keyTr: string
  valTr: string
  keyEn: string
  valEn: string
}

interface RichTextEditorProps {
  value: string
  onChange: (value: string) => void
}

function RichTextEditor({ value, onChange }: RichTextEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const editorInstanceRef = useRef<any>(null)
  const [loaded, setLoaded] = useState(!!(window as any).ClassicEditor)
  const [usePlainFallback, setUsePlainFallback] = useState(false)
  const lastValueRef = useRef(value)

  useEffect(() => {
    if ((window as any).ClassicEditor) {
      setLoaded(true)
      return
    }

    const scriptId = 'ckeditor-script'
    let script = document.getElementById(scriptId) as HTMLScriptElement
    if (!script) {
      script = document.createElement('script')
      script.id = scriptId
      script.src = '/ckeditor.js'
      script.async = true
      document.body.appendChild(script)
    }

    const handleLoad = () => setLoaded(true)
    const handleError = () => {
      setUsePlainFallback(true)
    }
    script.addEventListener('load', handleLoad)
    script.addEventListener('error', handleError)

    // Set a timeout to switch to fallback if loading takes too long (e.g. 3 seconds)
    const timer = setTimeout(() => {
      if (!(window as any).ClassicEditor) {
        setUsePlainFallback(true)
      }
    }, 3000)

    return () => {
      script.removeEventListener('load', handleLoad)
      script.removeEventListener('error', handleError)
      clearTimeout(timer)
    }
  }, [])

  useEffect(() => {
    if (usePlainFallback || !loaded || !containerRef.current) return

    let editor: any = null
    let active = true

    const element = document.createElement('div')
    containerRef.current.appendChild(element)

    ;(window as any).ClassicEditor.create(element, {
      toolbar: [
        'heading',
        '|',
        'bold',
        'italic',
        'link',
        'bulletedList',
        'numberedList',
        'blockQuote',
        '|',
        'undo',
        'redo',
      ],
    })
      .then((createdEditor: any) => {
        if (!active) {
          createdEditor.destroy()
          return
        }
        editor = createdEditor
        editorInstanceRef.current = editor
        editor.setData(value)

        editor.model.document.on('change:data', () => {
          const data = editor.getData()
          lastValueRef.current = data
          onChange(data)
        })
      })
      .catch((err: any) => {
        console.error('CKEditor error:', err)
        setUsePlainFallback(true)
      })

    return () => {
      active = false
      if (editor) {
        editor.destroy().then(() => {
          if (editorInstanceRef.current === editor) {
            editorInstanceRef.current = null
          }
        })
      }
      if (containerRef.current) {
        containerRef.current.innerHTML = ''
      }
    }
  }, [loaded, usePlainFallback])

  useEffect(() => {
    const editor = editorInstanceRef.current
    if (editor && value !== lastValueRef.current) {
      lastValueRef.current = value
      editor.setData(value)
    }
  }, [value])

  if (usePlainFallback) {
    return (
      <div className="border border-zinc-200/80 rounded-2xl overflow-hidden min-h-[320px] bg-white shadow-sm focus-within:ring-4 focus-within:ring-[#df0000]/5 focus-within:border-[#df0000] transition-all duration-200 flex flex-col">
        <div className="flex justify-between items-center bg-zinc-50 border-b border-zinc-150 px-4 py-2 text-[10px] font-bold text-zinc-500 uppercase tracking-wider">
          <span>Düz Metin Editörü (CKEditor Yüklenemedi)</span>
          <button
            type="button"
            onClick={() => setUsePlainFallback(false)}
            className="text-primary hover:underline lowercase font-bold text-[9px] tracking-normal"
          >
            Yeniden Dene
          </button>
        </div>
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Ürün açıklamasını buraya girin (HTML etiketleri kullanabilirsiniz)..."
          className="flex-1 w-full min-h-[260px] p-4 text-xs outline-none resize-none font-semibold text-zinc-700"
        />
      </div>
    )
  }

  return (
    <div className="border border-zinc-200/80 rounded-2xl overflow-hidden min-h-[320px] bg-white shadow-sm focus-within:ring-4 focus-within:ring-[#df0000]/5 focus-within:border-[#df0000] transition-all duration-200">
      {!loaded && (
        <div className="flex flex-col items-center justify-center p-16 text-zinc-400 text-xs gap-3 animate-pulse">
          <div className="w-8 h-8 border-4 border-zinc-200 border-t-[#df0000] rounded-full animate-spin" />
          <span>Zengin metin editörü yükleniyor...</span>
          <button
            type="button"
            onClick={() => setUsePlainFallback(true)}
            className="mt-2 text-[#df0000] hover:underline font-bold text-[10px]"
          >
            Düz Metin Editörüne Geç
          </button>
        </div>
      )}
      <div ref={containerRef} className="prose max-w-none p-4 min-h-[260px] outline-none" />
    </div>
  )
}

export function ProductMetadataModal({
  open,
  onClose,
  authHeader,
  product,
  onSuccess,
}: {
  open: boolean
  onClose: () => void
  authHeader: Record<string, string> | null
  product: ErpProductListItem | null
  onSuccess?: (prod: any) => void
}) {
  const { showToast, dismissToast } = useToast()

  // Resolved Product states
  const [localProductId, setLocalProductId] = useState(product?.id ?? '')
  const [localProductTenantCode, setLocalProductTenantCode] = useState(product?.tenantCode ?? 'DEMO')
  const [localProduct, setLocalProduct] = useState<ErpProductListItem | null>(product)

  // Basic product fields
  const [name, setName] = useState('')
  const [sku, setSku] = useState('')
  const [barcode, setBarcode] = useState('')
  const [price, setPrice] = useState<number>(0)
  const [currency, setCurrency] = useState('TL')
  const [tags, setTags] = useState<string[]>([])
  const [tagInput, setTagInput] = useState('')
  const [cost, setCost] = useState<number>(0)
  const [discountPrice, setDiscountPrice] = useState<number>(0)
  const [discountExpiry, setDiscountExpiry] = useState('')
  const [stock, setStock] = useState<number>(0)
  const [alertLimit, setAlertLimit] = useState<number>(5)
  const [images, setImages] = useState<string[]>([])
  const [uploadingImages, setUploadingImages] = useState(false)

  // Categories
  const [categories, setCategories] = useState<CategoryDto[]>([])
  const [selectedMainCat, setSelectedMainCat] = useState('')
  const [selectedSubCat, setSelectedSubCat] = useState('')
  const [selectedSubSubCat, setSelectedSubSubCat] = useState('')

  const subSubCategories = useMemo(() => {
    if (!selectedSubCat) return []
    return categories.filter(c => c.parentId === selectedSubCat)
  }, [categories, selectedSubCat])

  // Featured toggles
  const [isNew, setIsNew] = useState(false)
  const [isBestSeller, setIsBestSeller] = useState(false)

  // Base states
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Navigation
  const [activeTab, setActiveTab] = useState<'settings' | 'content' | 'specs' | 'variants'>('settings')
  const [contentLang, setContentLang] = useState<'tr' | 'en'>('tr')

  // Metadata settings fields
  const [status, setStatus] = useState('Draft')
  const [brand, setBrand] = useState('')
  const [brands, setBrands] = useState<Array<{ id: string; name: string }>>([])
  const [slug, setSlug] = useState('')
  const [showOnHome, setShowOnHome] = useState(false)
  const [isCampaign, setIsCampaign] = useState(false)
  const [isFreeShipping, setIsFreeShipping] = useState(false)
  const [manualPdfUrl, setManualPdfUrl] = useState('')
  const [catalogPdfUrl, setCatalogPdfUrl] = useState('')
  const [warrantyMonths, setWarrantyMonths] = useState(0)


  // Related products states
  const [allProducts, setAllProducts] = useState<Array<{ id: string; name: string; stockCode: string; imageUrl?: string }>>([])
  const [relatedProductIds, setRelatedProductIds] = useState<string[]>([])
  const [productSearch, setProductSearch] = useState('')
  const [showDropdown, setShowDropdown] = useState(false)

  const selectedRelatedProducts = useMemo(() => {
    return relatedProductIds
      .map((id) => allProducts.find((p) => p.id === id))
      .filter(Boolean) as Array<{ id: string; name: string; stockCode: string; imageUrl?: string }>
  }, [relatedProductIds, allProducts])

  const filteredSearchProducts = useMemo(() => {
    return allProducts.filter((p) => {
      if (p.id === localProductId) return false
      if (!productSearch.trim()) return false
      const matchesName = p.name.toLowerCase().includes(productSearch.toLowerCase())
      const matchesCode = p.stockCode?.toLowerCase().includes(productSearch.toLowerCase())
      const isAlreadySelected = relatedProductIds.includes(p.id)
      return (matchesName || matchesCode) && !isAlreadySelected
    })
  }, [allProducts, productSearch, relatedProductIds, localProductId])

  // TR contents
  const [shortDescription, setShortDescription] = useState('')
  const [description, setDescription] = useState('')
  const [featuresText, setFeaturesText] = useState('')
  const [seoTitle, setSeoTitle] = useState('')
  const [seoDescription, setSeoDescription] = useState('')

  // EN contents
  const [shortDescriptionEn, setShortDescriptionEn] = useState('')
  const [descriptionEn, setDescriptionEn] = useState('')
  const [featuresTextEn, setFeaturesTextEn] = useState('')
  const [seoTitleEn, setSeoTitleEn] = useState('')
  const [seoDescriptionEn, setSeoDescriptionEn] = useState('')

  // Specs editor list
  const [specs, setSpecs] = useState<SpecRow[]>([])

  // Variants state
  const [variantsEnabled, setVariantsEnabled] = useState(false)
  const [variantGroups, setVariantGroups] = useState<VariantGroup[]>([])

  // Custom dialogs/banners states
  const [draftAvailable, setDraftAvailable] = useState<any | null>(null)
  const [showCloseConfirm, setShowCloseConfirm] = useState(false)

  // Media picker states
  const [isMediaOpen, setIsMediaOpen] = useState(false)
  const [mediaPickerField, setMediaPickerField] = useState<'manual' | 'catalog' | 'images' | null>(null)

  // AI Assistant drawer state
  const [aiDrawerOpen, setAiDrawerOpen] = useState(false)
  const [aiAction, setAiAction] = useState('fix_description')
  const [aiLang, setAiLang] = useState('tr')
  const [aiLoading, setAiLoading] = useState(false)
  const [aiResult, setAiResult] = useState<{ output?: string; seoTitle?: string; seoDescription?: string } | null>(null)

  // Track initial state to detect changes
  const [initialStateJson, setInitialStateJson] = useState('')

  // Profit margin calculation
  const profitMargin = useMemo(() => {
    if (price > 0) {
      const margin = ((price - cost) / price) * 100
      return Math.round(margin)
    }
    return 0
  }, [price, cost])

  // Lock body scroll when modal is open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden'
      document.documentElement.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
      document.documentElement.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
      document.documentElement.style.overflow = ''
    }
  }, [open])

  // Auto slug & SEO Title generation in Create Mode
  useEffect(() => {
    if (!localProductId && name) {
      setSlug(
        name
          .toLowerCase()
          .replace(/[^a-z0-9\s-]/g, '')
          .replace(/\s+/g, '-')
      )
      setSeoTitle(name.slice(0, 60))
    }
  }, [name, localProductId])

  const convertToGrouped = (rawList: any[]): VariantGroup[] => {
    const groups: Record<string, VariantGroupItem[]> = {}
    rawList.forEach((v: any) => {
      if (v.groupName && Array.isArray(v.items)) {
        const gName = (v.groupName || '').trim()
        if (!gName) return
        if (!groups[gName]) groups[gName] = []
        v.items.forEach((it: any) => {
          groups[gName].push({
            value: (it.value || '').trim(),
            link: (it.link || '').trim(),
          })
        })
      } else {
        const gName = (v.optionName || v.group || '').trim()
        const val = (v.value || '').trim()
        const lnk = (v.link || '').trim()
        if (gName && val && lnk) {
          if (!groups[gName]) groups[gName] = []
          groups[gName].push({ value: val, link: lnk })
        }
      }
    })

    return Object.entries(groups).map(([groupName, items]) => ({
      groupName,
      items,
    }))
  }

  // Compile current values into a metadata payload object
  const getCurrentPayload = (overrideStatus?: string): ProductMetadataDto => {
    const trObj: Record<string, string> = {}
    const enObj: Record<string, string> = {}
    specs.forEach((s) => {
      if (s.keyTr.trim()) trObj[s.keyTr.trim()] = s.valTr.trim()
      if (s.keyEn.trim()) enObj[s.keyEn.trim()] = s.valEn.trim()
    })

    const features = featuresText
      .split('\n')
      .map((x) => x.trim())
      .filter(Boolean)

    const featuresEn = featuresTextEn
      .split('\n')
      .map((x) => x.trim())
      .filter(Boolean)

    let variantsJson: string | null = null
    if (variantsEnabled && variantGroups.length > 0) {
      const validGroups = variantGroups
        .map((vg) => ({
          groupName: vg.groupName.trim(),
          items: vg.items.filter((it) => it.value.trim() && it.link.trim()),
        }))
        .filter((vg) => vg.groupName && vg.items.length > 0)

      if (validGroups.length > 0) {
        variantsJson = JSON.stringify(validGroups)
      }
    }

    return {
      status: overrideStatus ?? status,
      brand: brand.trim() || null,
      slug: slug.trim() || null,
      showOnHome,
      isCampaign,
      isFreeShipping,
      manualPdfUrl: manualPdfUrl.trim() || null,
      catalogPdfUrl: catalogPdfUrl.trim() || null,
      warrantyMonths: warrantyMonths || 0,
      shortDescription: shortDescription.trim() || null,
      description: description.trim() || null,
      features,
      seoTitle: seoTitle.trim() || null,
      seoDescription: seoDescription.trim() || null,
      shortDescriptionEn: shortDescriptionEn.trim() || null,
      descriptionEn: descriptionEn.trim() || null,
      featuresEn,
      seoTitleEn: seoTitleEn.trim() || null,
      seoDescriptionEn: seoDescriptionEn.trim() || null,
      technicalSpecsJson: Object.keys(trObj).length > 0 ? JSON.stringify(trObj) : null,
      technicalSpecsEnJson: Object.keys(enObj).length > 0 ? JSON.stringify(enObj) : null,
      variantsJson,
      relatedProductIds,
      labelsJson: tags.length > 0 ? JSON.stringify(tags) : null,
    }
  }


  const handleImageUpload = async (files: FileList) => {
    if (files.length === 0) return
    const token = localStorage.getItem('ecom_admin_token')
    if (!token) {
      showToast('Oturum anahtarı bulunamadı.', 'error')
      return
    }

    setUploadingImages(true)
    const toastId = showToast('Görseller yükleniyor...', 'loading', 0)
    try {
      const uploadedUrls: string[] = []
      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        const formData = new FormData()
        formData.append('file', file)
        formData.append('folder', 'Ürünler')

        const response = await fetch('/api/admin/media', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`
          },
          body: formData
        })
        const res = await response.json()
        if (response.ok && res?.success) {
          uploadedUrls.push(res.data.url)
        } else {
          showToast(res?.message || `${file.name} yüklenemedi.`, 'error')
        }
      }
      if (uploadedUrls.length > 0) {
        setImages(prev => [...prev, ...uploadedUrls])
        showToast('Görsel(ler) başarıyla yüklendi.', 'success')
      }
    } catch (err) {
      showToast('Görsel yükleme sırasında bağlantı hatası oluştu.', 'error')
    } finally {
      setUploadingImages(false)
      dismissToast(toastId)
    }
  }

  const removeImage = (url: string) => {
    setImages(prev => prev.filter(img => img !== url))
  }

  const setCoverImage = (url: string) => {
    setImages(prev => {
      const filtered = prev.filter(img => img !== url)
      return [url, ...filtered]
    })
  }

  const reorderImage = (fromIndex: number, toIndex: number) => {
    setImages(prev => {
      const next = [...prev]
      const [moved] = next.splice(fromIndex, 1)
      next.splice(toIndex, 0, moved)
      return next
    })
  }

  // Load metadata for Creation Mode
  const loadMetadataForCreate = async () => {
    setName('')
    setSku('')
    setBarcode('')
    setPrice(0)
    setCost(0)
    setDiscountPrice(0)
    setDiscountExpiry('')
    setStock(0)
    setAlertLimit(5)
    setImages([])
    setSelectedMainCat('')
    setSelectedSubCat('')
    setSelectedSubSubCat('')

    setStatus('Draft')
    setBrand('')
    setSlug('')
    setShowOnHome(false)
    setIsCampaign(false)
    setIsFreeShipping(false)
    setManualPdfUrl('')
    setCatalogPdfUrl('')
    setWarrantyMonths(0)
    setRelatedProductIds([])

    setShortDescription('')
    setDescription('')
    setFeaturesText('')
    setSeoTitle('')
    setSeoDescription('')

    setShortDescriptionEn('')
    setDescriptionEn('')
    setFeaturesTextEn('')
    setSeoTitleEn('')
    setSeoDescriptionEn('')
    setSpecs([])
    setVariantGroups([])
    setVariantsEnabled(false)

    if (!authHeader) return
    try {
      setLoading(true)
      const cats = await fetchAdminCategories(authHeader)
      setCategories(cats)

      const brandRes = await fetch('/api/admin/brands', { headers: authHeader })
      const brandJson = await readApiResponse(brandRes)
      if (brandRes.ok && brandJson?.success) {
        setBrands(brandJson.data || [])
      }

      const prodRes = await fetch('/api/admin/products', { headers: authHeader })
      const prodJson = await readApiResponse(prodRes)
      if (prodRes.ok && prodJson?.success) {
        setAllProducts(prodJson.data || [])
      }
      
      setInitialStateJson(JSON.stringify({}))
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  // Load from DB for Edit Mode
  const loadMetadata = async () => {
    if (!authHeader || !localProductId || !localProductTenantCode) return
    try {
      setLoading(true)
      setError(null)

      // Initialize basic product states from product prop
      setName(localProduct?.name ?? '')
      setSku(localProduct?.stockCode ?? '')
      setPrice(localProduct?.unitPrice ?? 0)
      setCurrency(localProduct?.currency ?? 'TL')
      setStock(localProduct?.stock ?? 0)
      setImages(localProduct?.imageUrls ?? (localProduct?.imageUrl ? [localProduct.imageUrl] : []))
      
      // Clear/defaults for mock fields
      setBarcode('')
      setCost(0)
      setDiscountPrice(0)
      setDiscountExpiry('')
      setAlertLimit(5)


      let cats: CategoryDto[] = []
      try {
        cats = await fetchAdminCategories(authHeader)
        setCategories(cats)
      } catch (err) {
        console.error('Failed to load categories', err)
      }

      try {
        const brandRes = await fetch('/api/admin/brands', { headers: authHeader })
        const brandJson = await readApiResponse(brandRes)
        if (brandRes.ok && brandJson?.success) {
          setBrands(brandJson.data || [])
        }
      } catch (err) {
        console.error('Failed to load brands', err)
      }

      try {
        const prodRes = await fetch('/api/admin/products', { headers: authHeader })
        const prodJson = await readApiResponse(prodRes)
        if (prodRes.ok && prodJson?.success) {
          setAllProducts(prodJson.data || [])
        }
      } catch (err) {
        console.error('Failed to load products for related products selection', err)
      }

      // Load product categories mapping
      try {
        const prodCats = await fetchProductCategories(authHeader, localProductId, localProductTenantCode)
        const mappedIds = prodCats.map(pc => pc.categoryId)
        
        let resolvedMain = ''
        let resolvedSub = ''
        let resolvedSubSub = ''

        // Find Level 3 category (parent is Level 2 which has a parent)
        const lvl3 = cats.find(c => {
          if (!mappedIds.includes(c.id)) return false
          if (!c.parentId) return false
          const parent = cats.find(p => p.id === c.parentId)
          return !!(parent && parent.parentId)
        })

        if (lvl3) {
          resolvedSubSub = lvl3.id
          resolvedSub = lvl3.parentId!
          const parent = cats.find(p => p.id === lvl3.parentId)
          resolvedMain = parent?.parentId ?? ''
        } else {
          // Level 2 (parent is Level 1)
          const lvl2 = cats.find(c => {
            if (!mappedIds.includes(c.id)) return false
            if (!c.parentId) return false
            const parent = cats.find(p => p.id === c.parentId)
            return !!(parent && !parent.parentId)
          })

          if (lvl2) {
            resolvedSub = lvl2.id
            resolvedMain = lvl2.parentId!
          } else {
            // Level 1
            const lvl1 = cats.find(c => mappedIds.includes(c.id) && !c.parentId)
            if (lvl1) {
              resolvedMain = lvl1.id
            }
          }
        }

        setSelectedMainCat(resolvedMain)
        setSelectedSubCat(resolvedSub)
        setSelectedSubSubCat(resolvedSubSub)
      } catch (err) {
        console.error('Failed to load product category mapping', err)
      }

      const meta = await fetchAdminProductMetadata(authHeader, localProductId, localProductTenantCode)
      
      setStatus(meta.status || 'Draft')
      setBrand(meta.brand || '')
      setSlug(meta.slug || '')
      setShowOnHome(!!meta.showOnHome)
      setIsCampaign(!!meta.isCampaign)
      setIsFreeShipping(!!meta.isFreeShipping)

      // Parse labels/tags
      try {
        const parsedTags = JSON.parse(meta.labelsJson || '[]')
        setTags(Array.isArray(parsedTags) ? parsedTags.map(String) : [])
      } catch (err) {
        console.error('Failed to parse tags', err)
        setTags([])
      }
      setManualPdfUrl(meta.manualPdfUrl || '')
      setCatalogPdfUrl(meta.catalogPdfUrl || '')
      const defaultWarranty = meta.warrantyMonths || localProduct?.warrantyMonths || 0
      setWarrantyMonths(defaultWarranty)
      setRelatedProductIds(meta.relatedProductIds || [])

      setShortDescription(meta.shortDescription || '')
      setDescription(meta.description || '')
      setFeaturesText((meta.features || []).join('\n'))
      setSeoTitle(meta.seoTitle || '')
      setSeoDescription(meta.seoDescription || '')

      setShortDescriptionEn(meta.shortDescriptionEn || '')
      setDescriptionEn(meta.descriptionEn || '')
      setFeaturesTextEn((meta.featuresEn || []).join('\n'))
      setSeoTitleEn(meta.seoTitleEn || '')
      setSeoDescriptionEn(meta.seoDescriptionEn || '')

      // Parse technical specs
      const loadedSpecs: SpecRow[] = []
      try {
        const trObj = JSON.parse(meta.technicalSpecsJson || '{}')
        const enObj = JSON.parse(meta.technicalSpecsEnJson || '{}')
        const trKeys = Object.keys(trObj)
        const enKeys = Object.keys(enObj)
        const maxLen = Math.max(trKeys.length, enKeys.length)
        for (let i = 0; i < maxLen; i++) {
          loadedSpecs.push({
            keyTr: trKeys[i] || '',
            valTr: trObj[trKeys[i]] || '',
            keyEn: enKeys[i] || '',
            valEn: enObj[enKeys[i]] || '',
          })
        }
      } catch (err) {
        console.error('Failed to parse specs', err)
      }
      setSpecs(loadedSpecs)

      // Parse variants
      if (meta.variantsJson) {
        try {
          const parsed = JSON.parse(meta.variantsJson)
          if (Array.isArray(parsed)) {
            setVariantGroups(convertToGrouped(parsed))
            setVariantsEnabled(true)
          } else if (parsed && Array.isArray(parsed.variants)) {
            // Migrating old format to new format
            const legacyLinks: any[] = []
            parsed.variants.forEach((v: any) => {
              Object.entries(v.attributes || {}).forEach(([optName, optVal]) => {
                legacyLinks.push({
                  optionName: optName,
                  value: String(optVal),
                  link: v.imageUrl || `/products/${localProductId}`,
                })
              })
            })
            setVariantGroups(convertToGrouped(legacyLinks))
            setVariantsEnabled(true)
          }
        } catch (e) {
          console.error('Failed to parse variants JSON', e)
        }
      } else {
        setVariantGroups([])
        setVariantsEnabled(false)
      }

      // Track original signature to detect changes
      const sign = JSON.stringify({
        status: meta.status || 'Draft',
        brand: meta.brand || '',
        slug: meta.slug || '',
        showOnHome: !!meta.showOnHome,
        isCampaign: !!meta.isCampaign,
        isFreeShipping: !!meta.isFreeShipping,
        manualPdfUrl: meta.manualPdfUrl || '',
        catalogPdfUrl: meta.catalogPdfUrl || '',
        warrantyMonths: defaultWarranty,
        shortDescription: meta.shortDescription || '',
        description: meta.description || '',
        features: meta.features || [],
        seoTitle: meta.seoTitle || '',
        seoDescription: meta.seoDescription || '',
        shortDescriptionEn: meta.shortDescriptionEn || '',
        descriptionEn: meta.descriptionEn || '',
        featuresEn: meta.featuresEn || [],
        seoTitleEn: meta.seoTitleEn || '',
        seoDescriptionEn: meta.seoDescriptionEn || '',
        technicalSpecsJson: meta.technicalSpecsJson || null,
        technicalSpecsEnJson: meta.technicalSpecsEnJson || null,
        variantsJson: meta.variantsJson || null,
        relatedProductIds: meta.relatedProductIds || [],
      })
      setInitialStateJson(sign)

      // Check if we have a locally autosaved draft
      const cached = localStorage.getItem(`stilsoft_draft_${localProductId}`)
      if (cached) {
        try {
          const parsedCached = JSON.parse(cached)
          if (JSON.stringify(parsedCached) !== sign) {
            setDraftAvailable(parsedCached)
          }
        } catch (e) {
          localStorage.removeItem(`stilsoft_draft_${localProductId}`)
        }
      }

    } catch (e) {
      setError(e instanceof Error ? e.message : 'Detaylar alınamadı')
    } finally {
      setLoading(false)
    }
  }

  const loadedRef = useRef(false)

  // Reset loadedRef on close or open change
  useEffect(() => {
    if (!open) {
      loadedRef.current = false
    }
  }, [open])

  // Load effect
  useEffect(() => {
    if (open && authHeader && !loadedRef.current) {
      if (localProductId) {
        loadedRef.current = true
        loadMetadata()
        setActiveTab('settings')
        setAiResult(null)
        setAiDrawerOpen(false)
      } else if (product === null) {
        loadedRef.current = true
        loadMetadataForCreate()
        setActiveTab('settings')
        setAiResult(null)
        setAiDrawerOpen(false)
      }
    }
  }, [open, localProductId, authHeader, product])

  // Sync props state initially or on prop change
  useEffect(() => {
    setLocalProductId(product?.id ?? '')
    setLocalProductTenantCode(product?.tenantCode ?? 'DEMO')
    setLocalProduct(product)
  }, [product, open])

  // Local Autosave triggers on change
  useEffect(() => {
    if (!open || loading || !localProductId || !initialStateJson) return
    const payload = getCurrentPayload()
    const currentJson = JSON.stringify({
      status: payload.status,
      brand: payload.brand || '',
      slug: payload.slug || '',
      showOnHome: payload.showOnHome,
      isCampaign: payload.isCampaign,
      isFreeShipping: payload.isFreeShipping,
      manualPdfUrl: payload.manualPdfUrl || '',
      catalogPdfUrl: payload.catalogPdfUrl || '',
      warrantyMonths: payload.warrantyMonths || 0,
      shortDescription: payload.shortDescription || '',
      description: payload.description || '',
      features: payload.features || [],
      seoTitle: payload.seoTitle || '',
      seoDescription: payload.seoDescription || '',
      shortDescriptionEn: payload.shortDescriptionEn || '',
      descriptionEn: payload.descriptionEn || '',
      featuresEn: payload.featuresEn || [],
      seoTitleEn: payload.seoTitleEn || '',
      seoDescriptionEn: payload.seoDescriptionEn || '',
      technicalSpecsJson: payload.technicalSpecsJson,
      technicalSpecsEnJson: payload.technicalSpecsEnJson,
      variantsJson: payload.variantsJson,
      relatedProductIds: payload.relatedProductIds || [],
    })

    if (currentJson !== initialStateJson) {
      localStorage.setItem(`stilsoft_draft_${localProductId}`, currentJson)
    } else {
      localStorage.removeItem(`stilsoft_draft_${localProductId}`)
    }
  }, [
    status, brand, slug, showOnHome, isCampaign, isFreeShipping, manualPdfUrl, catalogPdfUrl, warrantyMonths,
    shortDescription, description, featuresText, seoTitle, seoDescription,
    shortDescriptionEn, descriptionEn, featuresTextEn, seoTitleEn, seoDescriptionEn,
    specs, variantsEnabled, variantGroups, relatedProductIds
  ])

  const applyCachedDraft = (cached: any) => {
    setStatus(cached.status || 'Draft')
    setBrand(cached.brand || '')
    setSlug(cached.slug || '')
    setShowOnHome(!!cached.showOnHome)
    setIsCampaign(!!cached.isCampaign)
    setIsFreeShipping(!!cached.isFreeShipping)
    setManualPdfUrl(cached.manualPdfUrl || '')
    setCatalogPdfUrl(cached.catalogPdfUrl || '')
    setWarrantyMonths(cached.warrantyMonths || 0)
    setRelatedProductIds(cached.relatedProductIds || [])

    setShortDescription(cached.shortDescription || '')
    setDescription(cached.description || '')
    setFeaturesText((cached.features || []).join('\n'))
    setSeoTitle(cached.seoTitle || '')
    setSeoDescription(cached.seoDescription || '')

    setShortDescriptionEn(cached.shortDescriptionEn || '')
    setDescriptionEn(cached.descriptionEn || '')
    setFeaturesTextEn((cached.featuresEn || []).join('\n'))
    setSeoTitleEn(cached.seoTitleEn || '')
    setSeoDescriptionEn(cached.seoDescriptionEn || '')

    // Parse technical specs
    const loadedSpecs: SpecRow[] = []
    try {
      const trObj = JSON.parse(cached.technicalSpecsJson || '{}')
      const enObj = JSON.parse(cached.technicalSpecsEnJson || '{}')
      const trKeys = Object.keys(trObj)
      const enKeys = Object.keys(enObj)
      const maxLen = Math.max(trKeys.length, enKeys.length)
      for (let i = 0; i < maxLen; i++) {
        loadedSpecs.push({
          keyTr: trKeys[i] || '',
          valTr: trObj[trKeys[i]] || '',
          keyEn: enKeys[i] || '',
          valEn: enObj[enKeys[i]] || '',
        })
      }
    } catch (err) {
      console.error(err)
    }
    setSpecs(loadedSpecs)

    // Variants
    if (cached.variantsJson) {
      try {
        const parsed = JSON.parse(cached.variantsJson)
        if (Array.isArray(parsed)) {
          setVariantGroups(convertToGrouped(parsed))
          setVariantsEnabled(true)
        }
      } catch (e) {
        console.error(e)
      }
    } else {
      setVariantGroups([])
      setVariantsEnabled(false)
    }
  }

  // Handle closing modal with change verification
  const handleModalClose = () => {
    if (!localProductId) {
      // In create mode and not yet resolved, just close
      onClose()
      return
    }

    const payload = getCurrentPayload()
    const currentJson = JSON.stringify({
      status: payload.status,
      brand: payload.brand || '',
      slug: payload.slug || '',
      showOnHome: payload.showOnHome,
      isCampaign: payload.isCampaign,
      isFreeShipping: payload.isFreeShipping,
      manualPdfUrl: payload.manualPdfUrl || '',
      catalogPdfUrl: payload.catalogPdfUrl || '',
      warrantyMonths: payload.warrantyMonths || 0,
      shortDescription: payload.shortDescription || '',
      description: payload.description || '',
      features: payload.features || [],
      seoTitle: payload.seoTitle || '',
      seoDescription: payload.seoDescription || '',
      shortDescriptionEn: payload.shortDescriptionEn || '',
      descriptionEn: payload.descriptionEn || '',
      featuresEn: payload.featuresEn || [],
      seoTitleEn: payload.seoTitleEn || '',
      seoDescriptionEn: payload.seoDescriptionEn || '',
      technicalSpecsJson: payload.technicalSpecsJson,
      technicalSpecsEnJson: payload.technicalSpecsEnJson,
      variantsJson: payload.variantsJson,
      relatedProductIds: payload.relatedProductIds || [],
    })

    if (currentJson !== initialStateJson) {
      setShowCloseConfirm(true)
    } else {
      onClose()
    }
  }

  // Unified save helper for product details & metadata
  const saveProductData = async (showToastAlert: boolean = false, overrideStatus?: string) => {
    if (!authHeader || !localProductId) return false

    try {
      setSaving(true)
      setError(null)

      // 1. Update basic fields
      const basicRes = await fetch(`/api/admin/products/${localProductId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...authHeader
        },
        body: JSON.stringify({
          name: name.trim(),
          stockCode: sku.trim(),
          unitPrice: Number(price) || 0,
          currency: currency,
          stock: Number(stock) || 0,
          imageUrl: images[0] || '',
          imageUrls: images,
          mainCategoryId: selectedMainCat || null,
          subCategoryId: selectedSubSubCat || selectedSubCat || null,
          variantsJson: variantsEnabled && variantGroups.length > 0 ? JSON.stringify(variantGroups) : null,
          slug: slug,
          brand: brand || null,
          shortDescription: shortDescription,
          description: description,
          showOnHome: showOnHome,
          isCampaign: isCampaign,
          status: overrideStatus ?? status,
          relatedProductIds: relatedProductIds,
          warrantyMonths: warrantyMonths
        })
      })

      const basicJson = await readApiResponse(basicRes)
      if (!basicRes.ok || !basicJson?.success) {
        throw new Error(basicJson?.message || 'Ürün bilgileri güncellenemedi.')
      }

      // 2. Save metadata details
      const payload = getCurrentPayload(overrideStatus)
      await upsertAdminProductMetadata(authHeader, localProductId, localProductTenantCode, payload)

      // Clear autosave
      localStorage.removeItem(`stilsoft_draft_${localProductId}`)

      if (showToastAlert) {
        showToast('Ürün detayları başarıyla kaydedildi.', 'success')
      }
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kaydedilemedi')
      showToast(e instanceof Error ? e.message : 'Kaydedilirken bir hata oluştu', 'error')
      return false
    } finally {
      setSaving(false)
    }
  }

  // Save changes and close
  const handleSave = async () => {
    if (!authHeader) return

    // 1. Final validation - name & SKU are required
    if (!name.trim() || !sku.trim()) {
      showToast('Ürün Adı ve Stok Kodu (SKU) alanları zorunludur.', 'error')
      setActiveTab('settings') // Focus the settings tab where these fields are
      return
    }

    try {
      setSaving(true)
      setError(null)

      let currentProductId = localProductId
      let currentTenantCode = localProductTenantCode

      // 2. If it's a new product, create it first
      if (!currentProductId) {
        const res = await fetch('/api/admin/products', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...authHeader
          },
          body: JSON.stringify({
            name: name.trim(),
            stockCode: sku.trim(),
            unitPrice: Number(price) || 0,
            currency: currency,
            stock: Number(stock) || 0,
            imageUrl: images[0] || '',
            imageUrls: images,
            mainCategoryId: selectedMainCat || null,
            subCategoryId: selectedSubSubCat || selectedSubCat || null,
            variantsJson: variantsEnabled && variantGroups.length > 0 ? JSON.stringify(variantGroups) : null,
            slug: slug,
            brand: brand || null,
            shortDescription: shortDescription,
            description: description,
            showOnHome: showOnHome,
            isCampaign: isCampaign,
            status: 'Draft',
            relatedProductIds: relatedProductIds,
            warrantyMonths: warrantyMonths
          })
        })
        const json = await readApiResponse(res)
        if (!res.ok || !json?.success) {
          throw new Error(json?.message || 'Ürün oluşturulamadı')
        }
        const newProd = json.data
        currentProductId = newProd.id
        currentTenantCode = newProd.tenantCode
        setLocalProductId(newProd.id)
        setLocalProductTenantCode(newProd.tenantCode)
        setLocalProduct(newProd)
      }

      // 3. Save basic details & metadata
      // Update basic fields
      const basicRes = await fetch(`/api/admin/products/${currentProductId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...authHeader
        },
        body: JSON.stringify({
          name: name.trim(),
          stockCode: sku.trim(),
          unitPrice: Number(price) || 0,
          currency: currency,
          stock: Number(stock) || 0,
          imageUrl: images[0] || '',
          imageUrls: images,
          mainCategoryId: selectedMainCat || null,
          subCategoryId: selectedSubSubCat || selectedSubCat || null,
          variantsJson: variantsEnabled && variantGroups.length > 0 ? JSON.stringify(variantGroups) : null,
          slug: slug,
          brand: brand || null,
          shortDescription: shortDescription,
          description: description,
          showOnHome: showOnHome,
          isCampaign: isCampaign,
          status: status, // Final status
          relatedProductIds: relatedProductIds,
          warrantyMonths: warrantyMonths
        })
      })

      const basicJson = await readApiResponse(basicRes)
      if (!basicRes.ok || !basicJson?.success) {
        throw new Error(basicJson?.message || 'Ürün bilgileri güncellenemedi.')
      }

      // Save metadata details
      const payload = getCurrentPayload()
      await upsertAdminProductMetadata(authHeader, currentProductId, currentTenantCode, payload)

      // Clear autosave
      localStorage.removeItem(`stilsoft_draft_${currentProductId}`)

      showToast('Ürün başarıyla kaydedildi.', 'success')

      if (onSuccess) {
        onSuccess({
          id: currentProductId,
          tenantCode: currentTenantCode,
          stockCode: sku,
          name: name,
          unitPrice: price,
          currency: currency,
          stock: stock,
          isActive: status !== 'Passive',
          imageUrl: images[0] || '',
          imageUrls: images,
          status: status
        })
      }
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kaydedilemedi')
      showToast(err instanceof Error ? err.message : 'Kaydedilirken bir hata oluştu', 'error')
    } finally {
      setSaving(false)
    }
  }

  // Wizard Tab Navigation
  const handleNext = async () => {
    if (activeTab === 'settings') {
      setActiveTab('content')
    } else if (activeTab === 'content') {
      setActiveTab('specs')
    } else if (activeTab === 'specs') {
      setActiveTab('variants')
    } else if (activeTab === 'variants') {
      await handleSave()
    }
  }

  const handleBack = () => {
    if (activeTab === 'content') {
      setActiveTab('settings')
    } else if (activeTab === 'specs') {
      setActiveTab('content')
    } else if (activeTab === 'variants') {
      setActiveTab('specs')
    }
  }

  const handleTabClick = async (tabId: 'settings' | 'content' | 'specs' | 'variants') => {
    if (tabId === activeTab) return

    // Simply switch tab on frontend without any validation or saving if product is not created yet!
    if (!localProductId) {
      setActiveTab(tabId)
      return
    }

    // If product is already created, save the current tab's details before switching to prevent data loss!
    const success = await saveProductData(false, 'Draft')
    if (success) {
      setActiveTab(tabId)
    }
  }

  // AI Assistant trigger
  const runAiAssistant = async () => {
    const token = localStorage.getItem('ecom_admin_token')
    if (!token) return

    setAiLoading(true)
    setAiResult(null)
    try {
      const trObj: Record<string, string> = {}
      specs.forEach((s) => {
        if (s.keyTr.trim()) trObj[s.keyTr.trim()] = s.valTr.trim()
      })

      const res = await fetch('/api/admin/ai/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          action: aiAction,
          productName: name || 'Ürün',
          description: aiLang === 'en' ? descriptionEn : description,
          technicalSpecsJson: JSON.stringify(trObj),
          language: aiLang,
        }),
      })
      const json = await res.json()
      if (res.ok) {
        setAiResult(json)
        showToast('AI içerik oluşturuldu.', 'success')
      } else {
        showToast(json.errorMessage || 'AI çalışırken hata oluştu.', 'error')
      }
    } catch (err) {
      showToast('Bağlantı hatası.', 'error')
    } finally {
      setAiLoading(false)
    }
  }

  const applyAiResult = () => {
    if (!aiResult) return

    if (aiAction === 'generate_seo') {
      if (aiLang === 'tr') {
        setSeoTitle(aiResult.seoTitle || '')
        setSeoDescription(aiResult.seoDescription || '')
      } else {
        setSeoTitleEn(aiResult.seoTitle || '')
        setSeoDescriptionEn(aiResult.seoDescription || '')
      }
    } else if (aiAction === 'generate_short') {
      if (aiLang === 'tr') {
        setShortDescription(aiResult.output || '')
      } else {
        setShortDescriptionEn(aiResult.output || '')
      }
    } else {
      if (aiLang === 'tr') {
        setDescription(aiResult.output || '')
      } else {
        setDescriptionEn(aiResult.output || '')
      }
    }
    showToast('AI içerik uygulandı.', 'success')
  }

  // Spec helper actions
  const addSpecRow = () => {
    setSpecs([...specs, { keyTr: '', valTr: '', keyEn: '', valEn: '' }])
  }

  const removeSpecRow = (idx: number) => {
    setSpecs(specs.filter((_, i) => i !== idx))
  }

  const updateSpecRow = (idx: number, field: keyof SpecRow, val: string) => {
    const next = [...specs]
    next[idx] = { ...next[idx], [field]: val }
    setSpecs(next)
  }

  // Media Picker helper
  const handleSelectMedia = (url: string) => {
    if (mediaPickerField === 'manual') {
      setManualPdfUrl(url)
    } else if (mediaPickerField === 'catalog') {
      setCatalogPdfUrl(url)
    } else if (mediaPickerField === 'images') {
      setImages(prev => {
        const combined = [...prev, url]
        return Array.from(new Set(combined))
      })
      showToast('Görsel kütüphaneden eklendi.', 'success')
    }
    setIsMediaOpen(false)
    setMediaPickerField(null)
  }

  // Variant Helpers
  const addVariantGroup = () => {
    setVariantGroups((prev) => [...prev, { groupName: '', items: [] }])
  }

  const removeVariantGroup = (groupIndex: number) => {
    setVariantGroups((prev) => prev.filter((_, idx) => idx !== groupIndex))
  }

  const updateGroupName = (groupIndex: number, newName: string) => {
    setVariantGroups((prev) => {
      const next = [...prev]
      next[groupIndex] = { ...next[groupIndex], groupName: newName }
      return next
    })
  }

  const addVariantItem = (groupIndex: number) => {
    setVariantGroups((prev) => {
      const next = [...prev]
      next[groupIndex] = {
        ...next[groupIndex],
        items: [...next[groupIndex].items, { value: '', link: '' }],
      }
      return next
    })
  }

  const removeVariantItem = (groupIndex: number, itemIndex: number) => {
    setVariantGroups((prev) => {
      const next = [...prev]
      next[groupIndex] = {
        ...next[groupIndex],
        items: next[groupIndex].items.filter((_, idx) => idx !== itemIndex),
      }
      return next
    })
  }

  const updateVariantItem = (groupIndex: number, itemIndex: number, field: 'value' | 'link', val: string) => {
    setVariantGroups((prev) => {
      const next = [...prev]
      const items = [...next[groupIndex].items]
      items[itemIndex] = { ...items[itemIndex], [field]: val }
      next[groupIndex] = { ...next[groupIndex], items }
      return next
    })
  }

  if (!open) return null

  return (
    <>
      <div className="fixed inset-0 z-[70]">
        <div className="absolute inset-0 bg-black/45 backdrop-blur-xs" onClick={handleModalClose} />
        <div className="absolute inset-0 flex items-center justify-center p-4">
          <div className="w-full max-w-6xl overflow-hidden rounded-3xl border border-zinc-200 bg-white shadow-2xl flex flex-col h-[90vh]">
            
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-zinc-100 px-6 py-4 bg-zinc-50/80">
              <div className="flex items-center gap-3">
                <div className="h-2 w-2 rounded-full bg-[#df0000] animate-pulse" />
                <div>
                  <div className="text-[10px] font-extrabold tracking-widest text-zinc-400 uppercase">
                    {localProductId ? 'ÜRÜN DÜZENLEME & METADATA' : 'YENİ ÜRÜN EKLE'}
                  </div>
                  <div className="text-sm font-bold text-zinc-950 mt-0.5">{name || 'Ürün Detayları'}</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {localProductId && (
                  <a
                    href={`/urun/${slug || 'preview'}/${localProductId}`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1.5 h-8 px-3 rounded-xl border border-zinc-200 bg-white text-[#df0000] hover:bg-zinc-50 transition text-xs font-bold shadow-xs mr-2"
                  >
                    <span className="material-symbols-outlined text-[16px]">visibility</span>
                    <span>Ürünü Önizle</span>
                  </a>
                )}
                {localProductId && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setAiDrawerOpen(!aiDrawerOpen)}
                    className={`border-[#df0000]/20 hover:border-[#df0000] ${
                      aiDrawerOpen ? 'bg-[#df0000]/5 text-[#df0000]' : 'text-zinc-700'
                    }`}
                    icon="auto_awesome"
                  >
                    AI Ürün Asistanı
                  </Button>
                )}
                <button
                  type="button"
                  onClick={handleModalClose}
                  className="grid h-8 w-8 place-items-center rounded-full hover:bg-zinc-200 text-zinc-400 hover:text-zinc-700 transition"
                >
                  <span className="material-symbols-outlined text-[20px]">close</span>
                </button>
              </div>
            </div>

            {/* Split workspace */}
            <div className="flex-1 flex overflow-hidden min-h-0">
              
              {/* Left Form Panel */}
              <div className="flex-1 flex flex-col overflow-hidden">
                {/* Navigation Tabs */}
                <div className="flex border-b border-zinc-100 px-6 bg-white gap-2">
                  {[
                    { id: 'settings', label: 'Ürün Bilgileri', icon: 'settings' },
                    { id: 'content', label: 'Dil & İçerik', icon: 'translate' },
                    { id: 'specs', label: 'Teknik Özellikler', icon: 'view_list' },
                    { id: 'variants', label: 'Varyantlar', icon: 'layers' },
                  ].map((t) => (
                    <button
                      key={t.id}
                      onClick={() => handleTabClick(t.id as any)}
                      type="button"
                      className={`flex items-center gap-2 py-3.5 px-4 font-bold text-xs uppercase border-b-2 transition-all -mb-[1px] ${
                        activeTab === t.id
                          ? 'border-[#df0000] text-[#df0000]'
                          : 'border-transparent text-zinc-500 hover:text-zinc-800'
                      }`}
                    >
                      <span className="material-symbols-outlined text-[16px]">{t.icon}</span>
                      {t.label}
                    </button>
                  ))}
                </div>

                {/* Form Body Scroll area */}
                <div className="p-6 overflow-y-auto flex-1 custom-scrollbar">
                  {error && (
                    <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs font-bold text-rose-700 flex items-center gap-2">
                      <span className="material-symbols-outlined text-[18px]">error</span>
                      {error}
                    </div>
                  )}

                  {draftAvailable && (
                    <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50/70 p-4 text-xs text-amber-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3 font-semibold shadow-xs">
                      <div className="flex items-center gap-2">
                        <span className="material-symbols-outlined text-amber-600 text-[18px]">history</span>
                        <span>Bu ürün için tarayıcınızda kaydedilmemiş bir taslak çalışma bulundu. Yüklemek ister misiniz?</span>
                      </div>
                      <div className="flex items-center gap-2 self-end sm:self-auto">
                        <Button
                          variant="primary"
                          size="sm"
                          className="bg-amber-600 hover:bg-amber-700 text-white border-none text-[10px] font-bold py-1.5 px-3 rounded-lg"
                          onClick={() => {
                            applyCachedDraft(draftAvailable)
                            setDraftAvailable(null)
                            showToast('Taslak başarıyla yüklendi.', 'success')
                          }}
                        >
                          Taslağı Yükle
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="border-amber-300 text-amber-700 hover:bg-amber-100 text-[10px] font-bold py-1.5 px-3 rounded-lg"
                          onClick={() => {
                            localStorage.removeItem(`stilsoft_draft_${localProductId}`)
                            setDraftAvailable(null)
                            showToast('Taslak yoksayıldı ve silindi.', 'success')
                          }}
                        >
                          Yoksay ve Sil
                        </Button>
                      </div>
                    </div>
                  )}

                  {loading ? (
                    <div className="flex items-center justify-center py-20">
                      <div className="w-8 h-8 border-4 border-[#df0000]/20 border-t-[#df0000] rounded-full animate-spin" />
                    </div>
                  ) : (
                    <>
                      {/* TAB 1: GENERAL SETTINGS */}
                      {activeTab === 'settings' && (
                        <div className="space-y-6">
                          
                          {/* Temel Bilgiler */}
                          <div className="rounded-2xl border border-zinc-200 bg-white p-5 space-y-4 shadow-sm">
                            <h3 className="text-xs font-extrabold text-zinc-800 uppercase tracking-wider border-b border-zinc-100 pb-2 flex items-center gap-2">
                              <span className="material-symbols-outlined text-[18px] text-zinc-500">info</span>
                              Temel Bilgiler
                            </h3>
                            
                            <Input
                              label="Ürün Adı *"
                              value={name}
                              onChange={(e) => setName(e.target.value)}
                              placeholder="Örn: Samsung Galaxy S24 Ultra"
                              className="rounded-xl"
                            />

                            <div className="space-y-1">
                              <label className="text-[11px] font-extrabold tracking-wider text-zinc-400 uppercase">Ürün Bağlantısı (Slug)</label>
                              <div className="flex rounded-xl border border-zinc-200 overflow-hidden bg-zinc-50 focus-within:ring-2 focus-within:ring-[#df0000]/20 focus-within:border-[#df0000] transition-all">
                                <span className="bg-zinc-100 px-3.5 py-2 text-xs font-semibold text-zinc-500 border-r border-zinc-200 flex items-center">
                                  example.com/urun/
                                </span>
                                <input
                                  value={slug}
                                  onChange={(e) => setSlug(e.target.value)}
                                  className="bg-transparent px-3 py-2 text-xs font-semibold text-zinc-800 outline-none flex-1"
                                />
                              </div>
                            </div>
                          </div>

                          {/* Ürün Açıklamaları */}
                          <div className="rounded-2xl border border-zinc-200 bg-white p-5 space-y-4 shadow-sm">
                            <h3 className="text-xs font-extrabold text-zinc-800 uppercase tracking-wider border-b border-zinc-100 pb-2 flex items-center gap-2">
                              <span className="material-symbols-outlined text-[18px] text-zinc-500">description</span>
                              Ürün Açıklamaları (Türkçe)
                            </h3>
                            
                            <div className="flex flex-col gap-1">
                              <label className="text-xs font-bold text-zinc-700 font-extrabold uppercase tracking-wide text-zinc-400">Kısa Açıklama</label>
                              <textarea
                                value={shortDescription}
                                onChange={(e) => setShortDescription(e.target.value)}
                                className="w-full min-h-[50px] p-3 text-xs border border-zinc-200 rounded-xl outline-none focus:ring-2 focus:ring-[#df0000]/20 focus:border-[#df0000] transition"
                                placeholder="Sepete ekle kısmında listelenecek çarpıcı kısa açıklama..."
                              />
                            </div>

                            <div className="flex flex-col gap-1">
                              <label className="text-xs font-bold text-zinc-700 font-extrabold uppercase tracking-wide text-zinc-400">Ürün Açıklaması</label>
                              <RichTextEditor value={description} onChange={setDescription} />
                            </div>
                          </div>

                          {/* Ürün Görselleri */}
                          <div className="rounded-2xl border border-zinc-200 bg-white p-5 space-y-4 shadow-sm">
                            <div className="flex justify-between items-center border-b border-zinc-100 pb-2">
                              <h3 className="text-xs font-extrabold text-zinc-800 uppercase tracking-wider flex items-center gap-2">
                                <span className="material-symbols-outlined text-[18px] text-zinc-500">image</span>
                                Ürün Görselleri
                              </h3>
                              <button
                                type="button"
                                onClick={() => { setMediaPickerField('images'); setIsMediaOpen(true); }}
                                className="flex items-center gap-1.5 h-8 px-3 rounded-lg border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 transition text-[11px] font-bold shadow-xs"
                              >
                                <span className="material-symbols-outlined text-[15px] text-[#df0000]">image_search</span>
                                <span>Kütüphaneden Seç</span>
                              </button>
                            </div>
                            
                            <div className="grid grid-cols-1 sm:grid-cols-5 gap-4">
                              <div
                                onClick={() => document.getElementById('modal-product-image-file-input')?.click()}
                                onDragOver={(e) => e.preventDefault()}
                                onDrop={(e) => {
                                  e.preventDefault();
                                  if (e.dataTransfer.files) handleImageUpload(e.dataTransfer.files);
                                }}
                                className="sm:col-span-1 border-2 border-dashed border-zinc-200 hover:border-[#df0000] hover:bg-zinc-50/50 rounded-2xl p-4 flex flex-col items-center justify-center text-center cursor-pointer transition-all bg-white relative min-h-[90px]"
                              >
                                {uploadingImages ? (
                                  <div className="flex flex-col items-center justify-center">
                                    <div className="w-5 h-5 border-2 border-zinc-200 border-t-[#df0000] rounded-full animate-spin mb-1" />
                                    <span className="text-[10px] font-bold text-zinc-500">Yükleniyor...</span>
                                  </div>
                                ) : (
                                  <>
                                    <span className="material-symbols-outlined text-[24px] text-zinc-400 mb-0.5">cloud_upload</span>
                                    <span className="text-[10px] font-bold text-zinc-600">Dosya Yükle</span>
                                    <span className="text-[8px] text-zinc-400">Tıklayın/Sürükleyin</span>
                                  </>
                                )}
                                <input
                                  id="modal-product-image-file-input"
                                  type="file"
                                  multiple
                                  accept="image/*"
                                  className="hidden"
                                  onChange={(e) => e.target.files && handleImageUpload(e.target.files)}
                                  disabled={uploadingImages}
                                />
                              </div>
                              <div className="sm:col-span-4 grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 gap-3">
                                {images.map((imgUrl, idx) => (
                                  <div key={idx} className="group relative border border-zinc-200 rounded-xl overflow-hidden aspect-square flex flex-col items-center justify-between bg-zinc-50 shadow-xs">
                                    <div className="relative w-full flex-1 overflow-hidden bg-white flex items-center justify-center">
                                      <img src={imgUrl} alt={`Görsel ${idx + 1}`} className="w-full h-full object-contain" />
                                      {idx === 0 ? (
                                        <span className="absolute top-1 left-1 bg-[#df0000] text-white text-[8px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded-md select-none">Kapak</span>
                                      ) : (
                                        <button
                                          type="button"
                                          onClick={() => setCoverImage(imgUrl)}
                                          className="absolute top-1 left-1 bg-white hover:bg-[#df0000] hover:text-white text-zinc-700 text-[8px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md border border-zinc-200 transition-colors shadow-xs"
                                        >
                                          Kapak Yap
                                        </button>
                                      )}
                                      <button
                                        type="button"
                                        onClick={() => removeImage(imgUrl)}
                                        className="absolute top-1 right-1 w-5 h-5 rounded-full bg-white hover:bg-rose-600 hover:text-white text-zinc-550 flex items-center justify-center transition-colors shadow-xs border border-zinc-200"
                                      >
                                        <span className="material-symbols-outlined text-xs">delete</span>
                                      </button>
                                    </div>
                                    <div className="w-full bg-white border-t border-zinc-100 p-1 flex items-center justify-between gap-1">
                                      <span className="text-[9px] font-extrabold text-zinc-400 pl-1">Sıra:</span>
                                      <select
                                        value={idx}
                                        onChange={(e) => reorderImage(idx, Number(e.target.value))}
                                        className="text-[10px] font-bold border border-zinc-200 rounded bg-white px-1 py-0.5 outline-none focus:border-[#df0000] cursor-pointer"
                                      >
                                        {images.map((_, i) => (
                                          <option key={i} value={i}>{i + 1}</option>
                                        ))}
                                      </select>
                                    </div>
                                  </div>
                                ))}
                                {images.length === 0 && (
                                  <div className="col-span-full border border-dashed border-zinc-200 rounded-xl bg-zinc-50/50 flex items-center justify-center py-6 text-center text-[10px] font-bold text-zinc-400">
                                    Henüz görsel eklenmedi.
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>

                          {/* Fiyatlandırma & Stok */}
                          <div className="rounded-2xl border border-zinc-200 bg-white p-5 space-y-4 shadow-sm">
                            <h3 className="text-xs font-extrabold text-zinc-800 uppercase tracking-wider border-b border-zinc-100 pb-2 flex items-center gap-2">
                              <span className="material-symbols-outlined text-[18px] text-zinc-500">payments</span>
                              Fiyatlandırma & Stok
                            </h3>
                            
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              <div className="space-y-1">
                                <label className="text-[11px] font-extrabold tracking-wider text-zinc-400 uppercase">Satış Fiyatı (TL) *</label>
                                <input
                                  type="number"
                                  value={price || ''}
                                  onChange={(e) => setPrice(Number(e.target.value))}
                                  placeholder="0.00"
                                  className="w-full h-10 px-3 border border-zinc-200 rounded-xl text-xs font-semibold text-zinc-800 outline-none focus:ring-2 focus:ring-[#df0000]/20 focus:border-[#df0000] transition-all"
                                />
                              </div>

                              <div className="space-y-1">
                                <label className="text-[11px] font-extrabold tracking-wider text-zinc-400 uppercase">Maliyet Fiyatı (TL)</label>
                                <input
                                  type="number"
                                  value={cost || ''}
                                  onChange={(e) => setCost(Number(e.target.value))}
                                  placeholder="0.00"
                                  className="w-full h-10 px-3 border border-zinc-200 rounded-xl text-xs font-semibold text-zinc-800 outline-none focus:ring-2 focus:ring-[#df0000]/20 focus:border-[#df0000] transition-all"
                                />
                              </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                              <div className="space-y-1">
                                <label className="text-[11px] font-extrabold tracking-wider text-zinc-400 uppercase">İndirimli Fiyat (TL)</label>
                                <input
                                  type="number"
                                  value={discountPrice || ''}
                                  onChange={(e) => setDiscountPrice(Number(e.target.value))}
                                  placeholder="İndirim yok"
                                  className="w-full h-10 px-3 border border-zinc-200 rounded-xl text-xs font-semibold text-zinc-800 outline-none focus:ring-2 focus:ring-[#df0000]/20 focus:border-[#df0000] transition-all"
                                />
                              </div>

                              <div className="space-y-1">
                                <label className="text-[11px] font-extrabold tracking-wider text-zinc-400 uppercase">İndirim Bitiş Tarihi</label>
                                <input
                                  type="date"
                                  value={discountExpiry}
                                  onChange={(e) => setDiscountExpiry(e.target.value)}
                                  className="w-full h-10 px-3 border border-zinc-200 rounded-xl text-xs font-semibold text-zinc-700 outline-none focus:ring-2 focus:ring-[#df0000]/20 focus:border-[#df0000] transition-all"
                                />
                              </div>

                              <div className="bg-zinc-50 border border-zinc-150 rounded-xl p-3 flex flex-col justify-center">
                                <span className="text-[9px] font-extrabold text-zinc-400 uppercase tracking-wider">Tahmini Kar Marjı</span>
                                <span className={`text-md font-black mt-0.5 ${profitMargin >= 30 ? 'text-green-600' : profitMargin >= 10 ? 'text-amber-500' : 'text-rose-500'}`}>
                                  %{profitMargin}
                                </span>
                              </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 pt-2 border-t border-zinc-100">
                              <div className="space-y-1 md:col-span-2">
                                <label className="text-[11px] font-extrabold tracking-wider text-zinc-400 uppercase">Stok Kodu (SKU) *</label>
                                <Input value={sku} onChange={(e) => setSku(e.target.value)} placeholder="Örn: SG-S24U" className="rounded-xl h-10" />
                              </div>
                              <div className="space-y-1 md:col-span-2">
                                <label className="text-[11px] font-extrabold tracking-wider text-zinc-400 uppercase">Barkod</label>
                                <Input value={barcode} onChange={(e) => setBarcode(e.target.value)} placeholder="Örn: 8690000000001" className="rounded-xl h-10" />
                              </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                              <div className="space-y-1">
                                <label className="text-[11px] font-extrabold tracking-wider text-zinc-400 uppercase">Stok Adedi</label>
                                <input
                                  type="number"
                                  value={stock || ''}
                                  onChange={(e) => setStock(Number(e.target.value))}
                                  placeholder="0"
                                  className="w-full h-10 px-3 border border-zinc-200 rounded-xl text-xs font-semibold text-zinc-800 outline-none focus:ring-2 focus:ring-[#df0000]/20 focus:border-[#df0000] transition-all"
                                />
                              </div>

                              <div className="space-y-1">
                                <label className="text-[11px] font-extrabold tracking-wider text-zinc-400 uppercase">Kritik Stok Uyarısı</label>
                                <input
                                  type="number"
                                  value={alertLimit || ''}
                                  onChange={(e) => setAlertLimit(Number(e.target.value))}
                                  placeholder="5"
                                  className="w-full h-10 px-3 border border-zinc-200 rounded-xl text-xs font-semibold text-zinc-800 outline-none focus:ring-2 focus:ring-[#df0000]/20 focus:border-[#df0000] transition-all"
                                />
                              </div>

                            </div>
                          </div>

                          {/* Organizasyon */}
                          <div className="rounded-2xl border border-zinc-200 bg-white p-5 space-y-4 shadow-sm">
                            <h3 className="text-xs font-extrabold text-zinc-800 uppercase tracking-wider border-b border-zinc-100 pb-2 flex items-center gap-2">
                              <span className="material-symbols-outlined text-[18px] text-zinc-500">lan</span>
                              Organizasyon
                            </h3>

                            <div className="grid gap-4 sm:grid-cols-2">
                              <div className="flex flex-col gap-1">
                                <label className="text-xs font-bold text-zinc-700">Yayın Durumu</label>
                                <select
                                  value={status}
                                  onChange={(e) => setStatus(e.target.value)}
                                  className="w-full p-2.5 text-xs font-bold border border-zinc-200 rounded-xl bg-white outline-none focus:ring-2 focus:ring-[#df0000]/20 focus:border-[#df0000] transition"
                                >
                                  <option value="Draft">Taslak</option>
                                  <option value="Published">Yayında (E-ticaret)</option>
                                </select>
                              </div>
                              <div className="flex flex-col gap-1">
                                <label className="text-xs font-bold text-zinc-700">Marka</label>
                                <select
                                  value={brand}
                                  onChange={(e) => setBrand(e.target.value)}
                                  className="w-full p-2.5 text-xs font-semibold border border-zinc-200 rounded-xl bg-white outline-none focus:ring-2 focus:ring-[#df0000]/20 focus:border-[#df0000] transition"
                                >
                                  <option value="">Seçiniz (Markasız)</option>
                                  {brands.map((b) => (
                                    <option key={b.id} value={b.name}>
                                      {b.name}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            </div>

                            <div className="grid gap-4 sm:grid-cols-3">
                              <div className="flex flex-col gap-1">
                                <label className="text-xs font-bold text-zinc-700">Ana Kategori</label>
                                <select
                                  value={selectedMainCat}
                                  onChange={(e) => {
                                    setSelectedMainCat(e.target.value)
                                    setSelectedSubCat('')
                                    setSelectedSubSubCat('')
                                  }}
                                  className="w-full p-2.5 text-xs font-semibold border border-zinc-200 rounded-xl bg-white outline-none focus:ring-2 focus:ring-[#df0000]/20 focus:border-[#df0000] transition"
                                >
                                  <option value="">Seçiniz</option>
                                  {categories.filter(c => !c.parentId).map(c => (
                                    <option key={c.id} value={c.id}>{c.name}</option>
                                  ))}
                                </select>
                              </div>
                              <div className="flex flex-col gap-1">
                                <label className="text-xs font-bold text-zinc-700">Alt Kategori</label>
                                <select
                                  value={selectedSubCat}
                                  onChange={(e) => {
                                    setSelectedSubCat(e.target.value)
                                    setSelectedSubSubCat('')
                                  }}
                                  disabled={!selectedMainCat}
                                  className="w-full p-2.5 text-xs font-semibold border border-zinc-200 rounded-xl bg-white outline-none focus:ring-2 focus:ring-[#df0000]/20 focus:border-[#df0000] transition disabled:opacity-50 disabled:bg-zinc-50"
                                >
                                  <option value="">Seçiniz</option>
                                  {categories.filter(c => c.parentId === selectedMainCat).map(c => (
                                    <option key={c.id} value={c.id}>{c.name}</option>
                                  ))}
                                </select>
                              </div>
                              <div className="flex flex-col gap-1">
                                <label className="text-xs font-bold text-zinc-700">Alt Alt Kategori</label>
                                <select
                                  value={selectedSubSubCat}
                                  onChange={(e) => setSelectedSubSubCat(e.target.value)}
                                  disabled={!selectedSubCat || subSubCategories.length === 0}
                                  className="w-full p-2.5 text-xs font-semibold border border-zinc-200 rounded-xl bg-white outline-none focus:ring-2 focus:ring-[#df0000]/20 focus:border-[#df0000] transition disabled:opacity-50 disabled:bg-zinc-50"
                                >
                                  <option value="">{subSubCategories.length === 0 ? 'Mevcut Değil' : 'Seçiniz'}</option>
                                  {subSubCategories.map(c => (
                                    <option key={c.id} value={c.id}>{c.name}</option>
                                  ))}
                                </select>
                              </div>
                            </div>

                            <div className="grid gap-4 sm:grid-cols-2">
                              <Input
                                label="Garanti Süresi (Ay)"
                                type="number"
                                min={0}
                                value={warrantyMonths || ''}
                                onChange={(e) => setWarrantyMonths(Math.max(0, parseInt(e.target.value) || 0))}
                                placeholder="12"
                              />

                              <div className="flex flex-col gap-1">
                                <label className="text-xs font-bold text-zinc-700 font-semibold mb-1">Etiketler</label>
                                <Input
                                  value={tagInput}
                                  onChange={(e) => setTagInput(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter' && tagInput.trim()) {
                                      e.preventDefault();
                                      if (!tags.includes(tagInput.trim())) {
                                        setTags([...tags, tagInput.trim()]);
                                      }
                                      setTagInput('');
                                    }
                                  }}
                                  placeholder="Yazıp Enter'a basın..."
                                  className="rounded-xl h-10"
                                />
                                <div className="flex flex-wrap gap-1.5 pt-1.5">
                                  {tags.map((tag) => (
                                    <span key={tag} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-zinc-50 border border-zinc-200 text-[10px] font-bold text-zinc-700">
                                      {tag}
                                      <button type="button" onClick={() => setTags(tags.filter((t) => t !== tag))} className="text-zinc-400 hover:text-rose-600 flex items-center">
                                        <span className="material-symbols-outlined text-[12px]">close</span>
                                      </button>
                                    </span>
                                  ))}
                                </div>
                              </div>
                            </div>
                          </div>

                          {/* Öne Çıkar */}
                          <div className="rounded-2xl border border-zinc-200 bg-white p-5 space-y-4 shadow-sm">
                            <h3 className="text-xs font-extrabold text-zinc-800 uppercase tracking-wider border-b border-zinc-100 pb-2 flex items-center gap-2">
                              <span className="material-symbols-outlined text-[18px] text-zinc-500">campaign</span>
                              Öne Çıkar & Vitrin
                            </h3>

                            <div className="grid gap-4 sm:grid-cols-2">
                              <div className="flex items-center gap-2 h-10 bg-zinc-50 border border-zinc-200 rounded-xl px-4">
                                <input
                                  type="checkbox"
                                  id="showOnHomeCheckbox"
                                  checked={showOnHome}
                                  onChange={(e) => setShowOnHome(e.target.checked)}
                                  className="w-4 h-4 accent-[#df0000] cursor-pointer"
                                />
                                <label htmlFor="showOnHomeCheckbox" className="text-xs font-bold text-zinc-700 cursor-pointer select-none">
                                  Ana Sayfada Vitrinde Göster
                                </label>
                              </div>
                              <div className="flex items-center gap-2 h-10 bg-zinc-50 border border-zinc-200 rounded-xl px-4">
                                <input
                                  type="checkbox"
                                  id="isCampaignCheckbox"
                                  checked={isCampaign}
                                  onChange={(e) => setIsCampaign(e.target.checked)}
                                  className="w-4 h-4 accent-[#df0000] cursor-pointer"
                                />
                                <label htmlFor="isCampaignCheckbox" className="text-xs font-bold text-zinc-700 cursor-pointer select-none">
                                  Kampanyalı Fırsat Ürünü
                                </label>
                              </div>
                              <div className="flex items-center gap-2 h-10 bg-zinc-50 border border-zinc-200 rounded-xl px-4">
                                <input
                                  type="checkbox"
                                  id="isFreeShippingCheckbox"
                                  checked={isFreeShipping}
                                  onChange={(e) => setIsFreeShipping(e.target.checked)}
                                  className="w-4 h-4 accent-[#df0000] cursor-pointer"
                                />
                                <label htmlFor="isFreeShippingCheckbox" className="text-xs font-bold text-zinc-700 cursor-pointer select-none">
                                  Kargo Ücretsiz (Kargo Bedava)
                                </label>
                              </div>
                            </div>

                            <div className="grid gap-4 sm:grid-cols-2">
                              <div className="flex items-center gap-2 h-10 bg-zinc-50 border border-zinc-200 rounded-xl px-4">
                                <input
                                  type="checkbox"
                                  id="isNewCheckbox"
                                  checked={isNew}
                                  onChange={(e) => setIsNew(e.target.checked)}
                                  className="w-4 h-4 accent-[#df0000] cursor-pointer"
                                />
                                <label htmlFor="isNewCheckbox" className="text-xs font-bold text-zinc-700 cursor-pointer select-none">
                                  Yeni Ürün Olarak İşaretle
                                </label>
                              </div>
                              <div className="flex items-center gap-2 h-10 bg-zinc-50 border border-zinc-200 rounded-xl px-4">
                                <input
                                  type="checkbox"
                                  id="isBestSellerCheckbox"
                                  checked={isBestSeller}
                                  onChange={(e) => setIsBestSeller(e.target.checked)}
                                  className="w-4 h-4 accent-[#df0000] cursor-pointer"
                                />
                                <label htmlFor="isBestSellerCheckbox" className="text-xs font-bold text-zinc-700 cursor-pointer select-none">
                                  Çok Satan Ürün Olarak İşaretle
                                </label>
                              </div>
                            </div>
                          </div>

                          {/* Ürün Dosyaları */}
                          <div className="rounded-2xl border border-zinc-200 bg-white p-5 space-y-4 shadow-sm">
                            <h3 className="text-xs font-extrabold text-zinc-800 uppercase tracking-wider border-b border-zinc-100 pb-2 flex items-center gap-2">
                              <span className="material-symbols-outlined text-[18px] text-zinc-500">picture_as_pdf</span>
                              Ürün Dosyaları
                            </h3>

                            <div className="space-y-1">
                              <label className="text-xs font-bold text-zinc-700 block">Kullanım Kılavuzu PDF URL</label>
                              <div className="flex gap-2">
                                <Input
                                  value={manualPdfUrl}
                                  onChange={(e) => setManualPdfUrl(e.target.value)}
                                  placeholder="PDF dosya linkini girin veya seçin"
                                />
                                <Button
                                  type="button"
                                  variant="outline"
                                  onClick={() => { setMediaPickerField('manual'); setIsMediaOpen(true); }}
                                  icon="image_search"
                                  className="shrink-0"
                                >
                                  Seç
                                </Button>
                              </div>
                            </div>

                            <div className="space-y-1">
                              <label className="text-xs font-bold text-zinc-700 block">Katalog PDF URL</label>
                              <div className="flex gap-2">
                                <Input
                                  value={catalogPdfUrl}
                                  onChange={(e) => setCatalogPdfUrl(e.target.value)}
                                  placeholder="Katalog PDF dosya linkini girin veya seçin"
                                />
                                <Button
                                  type="button"
                                  variant="outline"
                                  onClick={() => { setMediaPickerField('catalog'); setIsMediaOpen(true); }}
                                  icon="image_search"
                                  className="shrink-0"
                                >
                                  Seç
                                </Button>
                              </div>
                            </div>
                          </div>

                          {/* İlgili Ürünler */}
                          <div className="rounded-2xl border border-zinc-200 bg-white p-5 space-y-4 shadow-sm relative">
                            <h3 className="text-xs font-extrabold text-zinc-800 uppercase tracking-wider border-b border-zinc-100 pb-2 flex items-center gap-2">
                              <span className="material-symbols-outlined text-[18px] text-zinc-500">link</span>
                              İlgili Ürünler
                            </h3>
                            
                            <div className="relative z-40">
                              <Input
                                placeholder="İlgili ürün adına veya stok koduna göre ara..."
                                value={productSearch}
                                onChange={(e) => {
                                  setProductSearch(e.target.value)
                                  setShowDropdown(true)
                                }}
                                onFocus={() => setShowDropdown(true)}
                              />
                              
                              {showDropdown && productSearch.trim() && (
                                <div className="absolute left-0 right-0 z-35 mt-1 max-h-48 overflow-y-auto rounded-xl border border-zinc-200 bg-white shadow-lg p-2 space-y-1">
                                  {filteredSearchProducts.length === 0 ? (
                                    <div className="px-4 py-2.5 text-xs text-zinc-400 italic text-center font-medium">
                                      Sonuç bulunamadı
                                    </div>
                                  ) : (
                                    filteredSearchProducts.map((p) => (
                                      <button
                                        key={p.id}
                                        type="button"
                                        onClick={() => {
                                          setRelatedProductIds(prev => [...prev, p.id])
                                          setProductSearch('')
                                          setShowDropdown(false)
                                        }}
                                        className="w-full flex items-center gap-3 px-3 py-1.5 text-left text-xs font-bold text-zinc-700 hover:bg-zinc-50 hover:text-zinc-950 rounded-lg transition-colors"
                                      >
                                        {p.imageUrl ? (
                                          <img src={p.imageUrl} alt={p.name} className="w-7 h-7 rounded object-cover" />
                                        ) : (
                                          <div className="w-7 h-7 rounded bg-zinc-100 flex items-center justify-center">
                                            <span className="material-symbols-outlined text-zinc-455 text-[16px]">image</span>
                                          </div>
                                        )}
                                        <div className="flex-1 min-w-0">
                                          <div className="truncate font-semibold">{p.name}</div>
                                          <div className="text-[10px] text-zinc-400 font-mono font-bold mt-0.5">{p.stockCode}</div>
                                        </div>
                                        <span className="material-symbols-outlined text-zinc-400 text-[16px]">add</span>
                                      </button>
                                    ))
                                  )}
                                </div>
                              )}
                            </div>

                            {showDropdown && (
                              <div className="fixed inset-0 z-30" onClick={() => setShowDropdown(false)} />
                            )}

                            {selectedRelatedProducts.length === 0 ? (
                              <div className="text-center py-4 text-zinc-450 font-medium italic text-[11px] bg-zinc-50/50 rounded-xl border border-zinc-100">
                                İlgili ürün seçilmedi.
                              </div>
                            ) : (
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto pr-1">
                                {selectedRelatedProducts.map((p) => (
                                  <div key={p.id} className="flex items-center justify-between gap-3.5 p-2 bg-zinc-50 border border-zinc-200 rounded-xl">
                                    <div className="flex items-center gap-2.5 min-w-0">
                                      {p.imageUrl ? (
                                        <img src={p.imageUrl} alt={p.name} className="w-7 h-7 rounded object-cover" />
                                      ) : (
                                        <div className="w-7 h-7 rounded bg-zinc-200 flex items-center justify-center">
                                          <span className="material-symbols-outlined text-zinc-500 text-[16px]">image</span>
                                        </div>
                                      )}
                                      <div className="min-w-0">
                                        <div className="text-xs font-bold text-zinc-800 truncate">{p.name}</div>
                                        <div className="text-[9px] text-zinc-400 font-mono font-bold mt-0.5">{p.stockCode}</div>
                                      </div>
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() => setRelatedProductIds(prev => prev.filter(id => id !== p.id))}
                                      className="w-6 h-6 rounded-lg hover:bg-rose-50 text-zinc-400 hover:text-rose-600 flex items-center justify-center transition-colors"
                                    >
                                      <span className="material-symbols-outlined text-[16px]">close</span>
                                    </button>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      {/* TAB 2: MULTI-LANGUAGE CONTENT */}
                      {activeTab === 'content' && (
                        <div className="space-y-6">
                          {/* Inner Lang Switcher */}
                          <div className="flex gap-1.5 p-1 bg-zinc-100 rounded-xl w-fit">
                            <button
                              type="button"
                              onClick={() => setContentLang('tr')}
                              className={`px-4 py-1.5 text-xs font-bold rounded-lg transition-all ${
                                contentLang === 'tr' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-900'
                              }`}
                            >
                              Türkçe (TR)
                            </button>
                            <button
                              type="button"
                              onClick={() => setContentLang('en')}
                              className={`px-4 py-1.5 text-xs font-bold rounded-lg transition-all ${
                                contentLang === 'en' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-900'
                              }`}
                            >
                              English (EN)
                            </button>
                          </div>

                          {contentLang === 'tr' ? (
                            <div className="space-y-4">
                              <div className="flex flex-col gap-1">
                                <label className="text-xs font-bold text-zinc-700 font-extrabold uppercase tracking-wide text-zinc-400">Kısa Açıklama (TR)</label>
                                <textarea
                                  value={shortDescription}
                                  onChange={(e) => setShortDescription(e.target.value)}
                                  className="w-full min-h-[50px] p-3 text-xs border border-zinc-200 rounded-xl outline-none focus:ring-2 focus:ring-[#df0000]/20 focus:border-[#df0000] transition"
                                  placeholder="Sepete ekle kısmında listelenecek çarpıcı kısa açıklama..."
                                />
                              </div>

                              <div className="flex flex-col gap-1">
                                <label className="text-xs font-bold text-zinc-700 font-extrabold uppercase tracking-wide text-zinc-400">Ürün Açıklaması (TR)</label>
                                <RichTextEditor value={description} onChange={setDescription} />
                              </div>

                              <div className="flex flex-col gap-1">
                                <label className="text-xs font-bold text-zinc-700 font-extrabold uppercase tracking-wide text-zinc-400">Öne Çıkan Özellikler (TR - Satır başına tek özellik)</label>
                                <textarea
                                  value={featuresText}
                                  onChange={(e) => setFeaturesText(e.target.value)}
                                  className="w-full min-h-[80px] p-3 text-xs font-mono border border-zinc-200 rounded-xl outline-none focus:ring-2 focus:ring-[#df0000]/20 focus:border-[#df0000] transition"
                                  placeholder="Örn: 2200 Watt Güç&#10;Seramik Taban&#10;Dikey Ütüleme Teknolojisi"
                                />
                              </div>

                              <div className="grid gap-4 sm:grid-cols-2 pt-2 border-t border-zinc-100">
                                <Input
                                  label="SEO Meta Title (TR)"
                                  value={seoTitle}
                                  onChange={(e) => setSeoTitle(e.target.value)}
                                  placeholder="silk-max-utu-stilsoft"
                                />
                                <div className="flex flex-col gap-1">
                                  <label className="text-xs font-bold text-zinc-700">SEO Meta Description (TR)</label>
                                  <textarea
                                    value={seoDescription}
                                    onChange={(e) => setSeoDescription(e.target.value)}
                                    className="w-full min-h-[50px] p-3 text-xs border border-zinc-200 rounded-xl outline-none focus:ring-2 focus:ring-[#df0000]/20 focus:border-[#df0000] transition"
                                    placeholder="Arama motoru sonuçlarında listelenecek açıklama..."
                                  />
                                </div>
                              </div>
                            </div>
                          ) : (
                            <div className="space-y-4">
                              <div className="flex flex-col gap-1">
                                <label className="text-xs font-bold text-zinc-700 font-extrabold uppercase tracking-wide text-zinc-400">Short Description (EN)</label>
                                <textarea
                                  value={shortDescriptionEn}
                                  onChange={(e) => setShortDescriptionEn(e.target.value)}
                                  className="w-full min-h-[50px] p-3 text-xs border border-zinc-200 rounded-xl outline-none focus:ring-2 focus:ring-[#df0000]/20 focus:border-[#df0000] transition"
                                  placeholder="Engaging summary list to show near buy buttons..."
                                />
                              </div>

                              <div className="flex flex-col gap-1">
                                <label className="text-xs font-bold text-zinc-700 font-extrabold uppercase tracking-wide text-zinc-400">Product Description (EN)</label>
                                <RichTextEditor value={descriptionEn} onChange={setDescriptionEn} />
                              </div>

                              <div className="flex flex-col gap-1">
                                <label className="text-xs font-bold text-zinc-700 font-extrabold uppercase tracking-wide text-zinc-400">Key Features (EN - One feature per line)</label>
                                <textarea
                                  value={featuresTextEn}
                                  onChange={(e) => setFeaturesTextEn(e.target.value)}
                                  className="w-full min-h-[80px] p-3 text-xs font-mono border border-zinc-200 rounded-xl outline-none focus:ring-2 focus:ring-[#df0000]/20 focus:border-[#df0000] transition"
                                  placeholder="E.g. 2200 Watt Power&#10;Ceramic Soleplate&#10;Vertical Steaming"
                                />
                              </div>

                              <div className="grid gap-4 sm:grid-cols-2 pt-2 border-t border-zinc-100">
                                <Input
                                  label="SEO Meta Title (EN)"
                                  value={seoTitleEn}
                                  onChange={(e) => setSeoTitleEn(e.target.value)}
                                  placeholder="stilsoft-silk-max-steam-iron"
                                />
                                <div className="flex flex-col gap-1">
                                  <label className="text-xs font-bold text-zinc-700">SEO Meta Description (EN)</label>
                                  <textarea
                                    value={seoDescriptionEn}
                                    onChange={(e) => setSeoDescriptionEn(e.target.value)}
                                    className="w-full min-h-[50px] p-3 text-xs border border-zinc-200 rounded-xl outline-none focus:ring-2 focus:ring-[#df0000]/20 focus:border-[#df0000] transition"
                                    placeholder="Description to list in search engine results (English)..."
                                  />
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {/* TAB 3: TECHNICAL SPECS BUILDER */}
                      {activeTab === 'specs' && (
                        <div className="space-y-4">
                          <div className="flex items-center justify-between">
                            <h4 className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Teknik Parametre Değerleri</h4>
                            <Button variant="outline" size="sm" onClick={addSpecRow} icon="add">Özellik Ekle</Button>
                          </div>

                          {specs.length === 0 ? (
                            <div className="bg-zinc-50 rounded-xl p-8 border border-zinc-200 text-center text-zinc-400 select-none">
                              <span className="material-symbols-outlined text-[32px] mb-1">list</span>
                              <p className="text-xs font-bold text-zinc-700">Teknik Özellik Bulunmuyor.</p>
                              <p className="text-[10px] text-zinc-500">"Özellik Ekle" butonuna basarak güç, hazne hacmi, ağırlık vb. değerleri girin.</p>
                            </div>
                          ) : (
                            <div className="space-y-2 max-h-[380px] overflow-y-auto pr-2 custom-scrollbar">
                              {specs.map((row, idx) => (
                                <div key={idx} className="flex gap-2 items-center bg-zinc-50 p-3 rounded-xl border border-zinc-200">
                                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 flex-1">
                                    <Input
                                      placeholder="Özellik TR (Güç)"
                                      value={row.keyTr}
                                      onChange={(e) => updateSpecRow(idx, 'keyTr', e.target.value)}
                                    />
                                    <Input
                                      placeholder="Değer TR (2200W)"
                                      value={row.valTr}
                                      onChange={(e) => updateSpecRow(idx, 'valTr', e.target.value)}
                                    />
                                    <Input
                                      placeholder="Özellik EN (Power)"
                                      value={row.keyEn}
                                      onChange={(e) => updateSpecRow(idx, 'keyEn', e.target.value)}
                                    />
                                    <Input
                                      placeholder="Değer EN (2200W)"
                                      value={row.valEn}
                                      onChange={(e) => updateSpecRow(idx, 'valEn', e.target.value)}
                                    />
                                  </div>
                                  <button
                                    onClick={() => removeSpecRow(idx)}
                                    className="p-2 text-zinc-400 hover:text-red-600 transition"
                                    title="Sil"
                                  >
                                    <span className="material-symbols-outlined text-[18px]">delete</span>
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      {/* TAB 4: ADVANCED PRODUCT VARIANTS */}
                      {activeTab === 'variants' && (
                        <div className="space-y-6">
                          <div className="flex items-center gap-3 bg-zinc-50 border border-zinc-200 rounded-xl p-4">
                            <input
                              type="checkbox"
                              id="enableVariantsCheckbox"
                              checked={variantsEnabled}
                              onChange={(e) => setVariantsEnabled(e.target.checked)}
                              className="w-4 h-4 accent-[#df0000] rounded cursor-pointer"
                            />
                            <label htmlFor="enableVariantsCheckbox" className="text-xs font-bold text-zinc-800 cursor-pointer select-none">
                              Bu ürün için gelişmiş varyant sistemini etkinleştir
                            </label>
                          </div>

                          {variantsEnabled && (
                            <div className="space-y-4">
                              <div className="flex items-center justify-between">
                                <h4 className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Gruplanmış Varyant Yönlendirmeleri (Renk, Boyut vb.)</h4>
                                <Button variant="outline" size="sm" onClick={addVariantGroup} icon="add">Varyant Grubu Ekle</Button>
                              </div>

                              {variantGroups.length === 0 ? (
                                <div className="bg-zinc-50 rounded-xl p-8 border border-zinc-200 text-center text-zinc-400 select-none">
                                  <span className="material-symbols-outlined text-[32px] mb-1">layers</span>
                                  <p className="text-xs font-bold text-zinc-700">Varyant Grubu Bulunmuyor.</p>
                                  <p className="text-[10px] text-zinc-500">"Varyant Grubu Ekle" butonuna basarak yeni bir başlık (örn: Renk) ve seçeneklerini tanımlayın.</p>
                                </div>
                              ) : (
                                <div className="space-y-4 max-h-[420px] overflow-y-auto pr-2 custom-scrollbar">
                                  {variantGroups.map((group, gIdx) => (
                                    <div key={gIdx} className="bg-zinc-50 border border-zinc-200 rounded-2xl p-4 space-y-3 shadow-xs hover:border-zinc-300 transition-colors">
                                      {/* Group Header */}
                                      <div className="flex gap-2 items-center justify-between">
                                        <div className="flex-1 max-w-md">
                                          <Input
                                            placeholder="Grup Adı (Örn: Renk, Boyut, Model Yılı)"
                                            value={group.groupName}
                                            onChange={(e) => updateGroupName(gIdx, e.target.value)}
                                            className="font-bold text-xs uppercase"
                                          />
                                        </div>
                                        <div className="flex items-center gap-2">
                                          <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            className="border-zinc-205 text-zinc-750 hover:border-zinc-300"
                                            onClick={() => addVariantItem(gIdx)}
                                            icon="add"
                                          >
                                            Seçenek Ekle
                                          </Button>
                                          <button
                                            type="button"
                                            onClick={() => removeVariantGroup(gIdx)}
                                            className="p-2 text-zinc-400 hover:text-red-650 transition"
                                            title="Grubu Komple Sil"
                                          >
                                            <span className="material-symbols-outlined text-[20px]">delete_forever</span>
                                          </button>
                                        </div>
                                      </div>

                                      {/* Nested Items */}
                                      {group.items.length === 0 ? (
                                        <p className="text-[10px] text-zinc-400 font-semibold italic pl-1">Bu gruba henüz seçenek eklenmedi. Seçenek Ekle butonuna basın.</p>
                                      ) : (
                                        <div className="grid gap-2 pl-2 border-l-2 border-zinc-200 ml-1">
                                          {group.items.map((row, itemIdx) => (
                                            <div key={itemIdx} className="flex gap-2 items-center bg-white p-2.5 rounded-xl border border-zinc-150">
                                              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 flex-1">
                                                <Input
                                                  placeholder="Seçenek Değeri (Örn: Kırmızı, 42 Numara, 2026)"
                                                  value={row.value}
                                                  onChange={(e) => updateVariantItem(gIdx, itemIdx, 'value', e.target.value)}
                                                />
                                                <Input
                                                  placeholder="Yönlendirme Linki (Örn: /products/urun-id)"
                                                  value={row.link}
                                                  onChange={(e) => updateVariantItem(gIdx, itemIdx, 'link', e.target.value)}
                                                />
                                              </div>
                                              <button
                                                type="button"
                                                onClick={() => removeVariantItem(gIdx, itemIdx)}
                                                className="p-2 text-zinc-400 hover:text-rose-655 transition"
                                                title="Seçeneği Sil"
                                              >
                                                <span className="material-symbols-outlined text-[18px]">close</span>
                                              </button>
                                            </div>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>

                {/* Modal Footer actions */}
                <div className="flex items-center justify-between border-t border-zinc-100 px-6 py-4 bg-zinc-50">
                  <div>
                    {activeTab !== 'settings' && (
                      <Button variant="outline" onClick={handleBack} disabled={saving}>
                        Geri
                      </Button>
                    )}
                  </div>
                  
                  <div className="flex items-center gap-2">
                    <Button variant="outline" onClick={handleModalClose} disabled={saving}>
                      Kapat / Vazgeç
                    </Button>
                    
                    <Button
                      variant="outline"
                      onClick={handleSave}
                      loading={saving}
                      disabled={saving}
                      className="text-zinc-700 border-zinc-300"
                    >
                      Kaydet ve Çık
                    </Button>

                    <Button
                      variant="primary"
                      onClick={handleNext}
                      loading={saving}
                      disabled={loading || saving}
                    >
                      {activeTab === 'variants' ? 'Değişiklikleri Kaydet & Bitir' : 'İlerle'}
                    </Button>
                  </div>
                </div>
              </div>

              {/* Right Side Drawer - AI Assistant */}
              {aiDrawerOpen && localProductId && (
                <div className="w-80 border-l border-zinc-200 bg-zinc-50 flex flex-col overflow-hidden animate-slide-in">
                  <div className="p-4 bg-zinc-100/80 border-b border-zinc-200 flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs font-bold text-zinc-800 uppercase tracking-wide">
                      <span className="material-symbols-outlined text-primary text-[18px]">auto_awesome</span>
                      AI Ürün Asistanı
                    </div>
                    <button
                      onClick={() => setAiDrawerOpen(false)}
                      className="text-zinc-400 hover:text-zinc-700"
                    >
                      <span className="material-symbols-outlined text-[18px]">close</span>
                    </button>
                  </div>

                  <div className="p-4 flex-1 overflow-y-auto space-y-4 custom-scrollbar text-xs">
                    <div className="flex flex-col gap-1">
                      <label className="font-bold text-zinc-700">AI Görevi</label>
                      <select
                        value={aiAction}
                        onChange={(e) => setAiAction(e.target.value)}
                        className="w-full p-2.5 border border-zinc-200 rounded-xl bg-white outline-none focus:ring-2 focus:ring-[#df0000]/20 focus:border-[#df0000] transition"
                      >
                        <option value="fix_description">Açıklamayı İyileştir / Yaz</option>
                        <option value="generate_short">Kısa Açıklama Üret</option>
                        <option value="generate_seo">SEO Başlık & Açıklama Üret</option>
                        <option value="specs_to_desc">Özelliklerden Açıklama Üret</option>
                      </select>
                    </div>

                    <div className="flex flex-col gap-1">
                      <label className="font-bold text-zinc-700">İçerik Dili</label>
                      <select
                        value={aiLang}
                        onChange={(e) => setAiLang(e.target.value)}
                        className="w-full p-2.5 border border-zinc-200 rounded-xl bg-white outline-none focus:ring-2 focus:ring-[#df0000]/20 focus:border-[#df0000] transition"
                      >
                        <option value="tr">Türkçe (TR)</option>
                        <option value="en">English (EN)</option>
                      </select>
                    </div>

                    <Button
                      variant="primary"
                      onClick={runAiAssistant}
                      loading={aiLoading}
                      className="w-full text-center py-2.5 font-bold"
                      icon="auto_awesome"
                    >
                      AI ile Oluştur
                    </Button>

                    <div className="pt-4 border-t border-zinc-200 space-y-2">
                      <label className="font-bold text-zinc-500 uppercase tracking-wider block">AI Önizleme Çıktısı</label>
                      {aiResult ? (
                        <div className="space-y-3">
                          {aiAction === 'generate_seo' ? (
                            <div className="bg-white border border-zinc-200 rounded-xl p-3 space-y-2">
                              <div>
                                <span className="text-[10px] text-zinc-400 block font-bold uppercase">SEO Başlığı</span>
                                <p className="font-semibold text-zinc-900 mt-0.5">{aiResult.seoTitle}</p>
                              </div>
                              <div>
                                <span className="text-[10px] text-zinc-400 block font-bold uppercase">SEO Açıklaması</span>
                                <p className="text-zinc-600 mt-0.5">{aiResult.seoDescription}</p>
                              </div>
                            </div>
                          ) : (
                            <div className="bg-white border border-zinc-200 rounded-xl p-3 font-mono text-[10px] leading-relaxed max-h-[220px] overflow-y-auto whitespace-pre-wrap">
                              {aiResult.output}
                            </div>
                          )}

                          <Button
                            variant="primary"
                            onClick={applyAiResult}
                            className="w-full py-2 bg-green-600 hover:bg-green-700 hover:shadow-none"
                            icon="check"
                          >
                            İçeriği Ürüne Uygula
                          </Button>
                        </div>
                      ) : (
                        <div className="bg-zinc-100 rounded-xl p-8 border border-zinc-200 border-dashed text-center text-zinc-400 italic select-none">
                          Henüz bir sonuç oluşturulmadı.
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

            </div>
          </div>
        </div>
      </div>

      {showCloseConfirm && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 backdrop-blur-xs">
          <div className="bg-white rounded-3xl border border-zinc-200 shadow-2xl p-6 max-w-sm w-full mx-4 text-center space-y-4 animate-scale-in">
            <span className="material-symbols-outlined text-amber-500 text-[54px] bg-amber-50 p-3 rounded-full animate-bounce">warning</span>
            <div className="space-y-1">
              <h3 className="text-sm font-extrabold text-zinc-900 uppercase tracking-wide">Kaydedilmemiş Değişiklikler</h3>
              <p className="text-xs text-zinc-500 font-semibold leading-relaxed">
                Üzerinde çalıştığınız değişiklikler henüz kaydedilmedi. Çıkmak istediğinizden emin misiniz?
              </p>
              <p className="text-[10px] text-zinc-400 font-medium">
                (Çıksanız dahi tarayıcınız taslağı otomatik olarak saklayacaktır.)
              </p>
            </div>
            <div className="flex gap-2 justify-center pt-2">
              <Button
                variant="outline"
                onClick={() => setShowCloseConfirm(false)}
                className="font-bold text-[11px]"
              >
                Düzenlemeye Devam Et
              </Button>
              <Button
                variant="primary"
                className="bg-amber-600 hover:bg-amber-700 text-white border-none font-bold text-[11px]"
                onClick={() => {
                  setShowCloseConfirm(false)
                  onClose()
                }}
              >
                Değişiklikleri Vazgeç / Çık
              </Button>
            </div>
          </div>
        </div>
      )}

      <MediaLibraryModal
        isOpen={isMediaOpen}
        onClose={() => { setIsMediaOpen(false); setMediaPickerField(null); }}
        onSelect={handleSelectMedia}
        title={
          mediaPickerField === 'manual'
            ? 'Kullanım Kılavuzu Dosyası Seç'
            : mediaPickerField === 'catalog'
            ? 'Katalog Dosyası Seç'
            : 'Varyant Görseli Seç'
        }
        activeFolder={
          mediaPickerField === 'manual' || mediaPickerField === 'catalog'
            ? 'PDF Dokümanları'
            : 'Ürünler'
        }
      />
    </>
  )
}
