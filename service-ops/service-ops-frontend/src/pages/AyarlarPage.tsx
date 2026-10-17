import { useEffect, useMemo, useState } from 'react'
import { User, Bell, Shield, Palette, Database, ChevronRight, RefreshCw, AlertCircle, CheckCircle2, Package } from 'lucide-react'
import { me as fetchMe } from '../api/auth'
import { clearSession, getAccessToken, getTenantCode, getUsername, isTechnicianSession, getTechnicianId } from '../auth/storage'
import { createServiceProduct, fetchServiceProductDetail, fetchServiceProducts, uploadExplodedDiagram, type ServiceProductDetailDto, type ServiceProductListItemDto } from '../api/serviceProducts'
import { createSparePart } from '../api/spareParts'
import { apiJson } from '../api/client'
import { logoutShared } from '../api/session'


type ProfileDto = { id?: string; name?: string; role?: string; tenantCode?: string }

const STATUS_LABELS: Record<string, string> = {
  New: 'Yeni Kayıt', Planned: 'Planlandı', Workshop: 'Atölyede',
  InRepair: 'Tamirde', WaitingForParts: 'Parça Bekliyor',
  Ready: 'Hazır', Delivered: 'Teslim Edildi',
  Cancelled: 'İptal', Delayed: 'Gecikti',
}

const NOTIF_KEYS = ['Yeni servis kaydı', 'Teknisyen atama', 'Görev tamamlama', 'Stok kritik seviye']
const NOTIF_STORAGE_KEY = 'serviceOpsNotifPrefs'
const THEME_STORAGE_KEY = 'serviceOpsThemePref'

function loadNotifPrefs(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(NOTIF_STORAGE_KEY)
    if (!raw) return Object.fromEntries(NOTIF_KEYS.map((k) => [k, true]))
    const parsed = JSON.parse(raw) as Record<string, boolean>
    return Object.fromEntries(NOTIF_KEYS.map((k) => [k, parsed?.[k] ?? true]))
  } catch {
    return Object.fromEntries(NOTIF_KEYS.map((k) => [k, true]))
  }
}

function loadTheme(): 'light' | 'dark' {
  const v = localStorage.getItem(THEME_STORAGE_KEY)
  return v === 'dark' ? 'dark' : 'light'
}

export default function AyarlarPage() {
  const [activeTab, setActiveTab] = useState('profil')
  const technicianMode = isTechnicianSession()
  const [profile, setProfile] = useState<ProfileDto | null>(null)
  const [profileLoading, setProfileLoading] = useState(false)
  const [profileError, setProfileError] = useState<string | null>(null)
  const [notifPrefs, setNotifPrefs] = useState<Record<string, boolean>>(() => loadNotifPrefs())
  const [theme, setTheme] = useState<'light' | 'dark'>(() => loadTheme())
  const [savedFlash, setSavedFlash] = useState<string | null>(null)
  const [myStats, setMyStats] = useState<{ total: number; active: number; completed: number; recent: Array<{ id: string; serviceNumber: string; productName: string; status: string }> }>({ total: 0, active: 0, completed: 0, recent: [] })

  const tabs = [
    { id: 'profil', name: 'Profil', icon: User },
    ...(technicianMode ? [{ id: 'islerim', name: 'İşlerim', icon: CheckCircle2 }] : []),
    { id: 'bildirim', name: 'Bildirimler', icon: Bell },
    { id: 'guvenlik', name: 'Güvenlik', icon: Shield },
    { id: 'tema', name: 'Tema', icon: Palette },
    { id: 'urun', name: 'Ürün Yönetimi', icon: Package },
    { id: 'veri', name: 'Veri Yönetimi', icon: Database },
  ]

  const [productQ, setProductQ] = useState('')
  const [products, setProducts] = useState<ServiceProductListItemDto[]>([])
  const [productsLoading, setProductsLoading] = useState(false)
  const [productsError, setProductsError] = useState<string | null>(null)

  const [selectedProductId, setSelectedProductId] = useState<string>('')
  const [productDetail, setProductDetail] = useState<ServiceProductDetailDto | null>(null)
  const [productDetailLoading, setProductDetailLoading] = useState(false)
  const [productDetailError, setProductDetailError] = useState<string | null>(null)

  const [createProductOpen, setCreateProductOpen] = useState(false)
  const [createSparePartOpen, setCreateSparePartOpen] = useState(false)

  const [newProduct, setNewProduct] = useState({ name: '', stockCode: '' })
  const [diagramFile, setDiagramFile] = useState<File | null>(null)
  const [newSparePart, setNewSparePart] = useState({
    name: '',
    partNumber: '',
    stockQuantity: 0,
    minStockLevel: 0,
    explodedViewPartNumber: '',
  })

  const activeProduct = useMemo(() => {
    return products.find(p => p.id === selectedProductId) ?? null
  }, [products, selectedProductId])

  useEffect(() => {
    if (activeTab !== 'urun') return
    let active = true
    setProductsLoading(true)
    setProductsError(null)
    fetchServiceProducts(productQ.trim() || undefined)
      .then((res) => {
        if (!active) return
        setProducts(res)
      })
      .catch((e: any) => {
        if (!active) return
        setProducts([])
        setProductsError(String(e?.message ?? 'Ürünler getirilemedi'))
      })
      .finally(() => {
        if (!active) return
        setProductsLoading(false)
      })
    return () => { active = false }
  }, [activeTab, productQ])

  useEffect(() => {
    if (activeTab !== 'urun') return
    if (!selectedProductId) {
      setProductDetail(null)
      setProductDetailError(null)
      setProductDetailLoading(false)
      return
    }

    let active = true
    setProductDetailLoading(true)
    setProductDetailError(null)
    fetchServiceProductDetail(selectedProductId)
      .then((d) => {
        if (!active) return
        setProductDetail(d)
      })
      .catch((e: any) => {
        if (!active) return
        setProductDetail(null)
        setProductDetailError(String(e?.message ?? 'Ürün detayı getirilemedi'))
      })
      .finally(() => {
        if (!active) return
        setProductDetailLoading(false)
      })

    return () => { active = false }
  }, [activeTab, selectedProductId])

  useEffect(() => {
    const token = getAccessToken()
    if (!token) return
    let cancelled = false
    void (async () => {
      try {
        setProfileLoading(true)
        setProfileError(null)
        const json = await fetchMe()
        if (!cancelled) setProfile(json as ProfileDto)
      } catch (e: any) {
        if (!cancelled) setProfileError(String(e?.message ?? 'Profil bilgisi alınamadı.'))
      } finally {
        if (!cancelled) setProfileLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!technicianMode) return
    let cancelled = false
    void (async () => {
      try {
        const data = await apiJson<any>('/api/servicerecords/paged?page=1&pageSize=50')
        const items = Array.isArray(data?.items) ? data.items : []
        if (cancelled) return
        setMyStats({
          total: Number(data?.totalCount ?? items.length),
          active: items.filter((x: any) => x.status !== 'Delivered' && x.status !== 'Cancelled' && x.status !== 'Ready').length,
          completed: items.filter((x: any) => x.status === 'Delivered' || x.status === 'Ready').length,
          recent: items.slice(0, 5).map((x: any) => ({
            id: String(x.id),
            serviceNumber: String(x.serviceNumber ?? ''),
            productName: String(x.productName ?? ''),
            status: String(x.status ?? ''),
          }))
        })
      } catch {
        if (!cancelled) setMyStats({ total: 0, active: 0, completed: 0, recent: [] })
      }
    })()
    return () => { cancelled = true }
  }, [technicianMode])

  const flash = (msg: string) => {
    setSavedFlash(msg)
    window.setTimeout(() => setSavedFlash(null), 2500)
  }

  const toggleNotif = (key: string) => {
    setNotifPrefs((prev) => {
      const next = { ...prev, [key]: !prev[key] }
      localStorage.setItem(NOTIF_STORAGE_KEY, JSON.stringify(next))
      return next
    })
    flash('Bildirim tercihleri güncellendi.')
  }

  const applyTheme = (next: 'light' | 'dark') => {
    setTheme(next)
    localStorage.setItem(THEME_STORAGE_KEY, next)
    document.documentElement.classList.toggle('dark', next === 'dark')
    flash('Tema tercihi güncellendi.')
  }

  const clearLocalCache = () => {
    const keep = new Set(['serviceOpsAccessToken', 'serviceOpsTenantCode', 'serviceOpsUsername'])
    const removable: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && !keep.has(k)) removable.push(k)
    }
    removable.forEach((k) => localStorage.removeItem(k))
    setNotifPrefs(loadNotifPrefs())
    setTheme(loadTheme())
    flash('Yerel önbellek temizlendi. Sayfa yenileniyor...')
    setTimeout(() => {
      window.location.reload()
    }, 1500)
  }

  return (
    <div className="p-4 lg:p-6">
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl lg:text-2xl font-bold text-gray-900 dark:text-white transition-colors">Ayarlar</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 transition-colors">Hesap ve sistem ayarlarını yönetin.</p>
        </div>
        {savedFlash ? (
          <div className="inline-flex items-center gap-2 rounded-lg bg-green-50 text-green-700 border border-green-200 px-3 py-1.5 text-sm">
            <CheckCircle2 className="w-4 h-4" /> {savedFlash}
          </div>
        ) : null}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <div className="lg:col-span-1 flex lg:flex-col overflow-x-auto no-scrollbar gap-1.5 pb-2 lg:pb-0">
          {tabs.map((tab) => {
            const Icon = tab.icon
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex-shrink-0 lg:flex-shrink flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-medium transition-colors whitespace-nowrap ${
                  activeTab === tab.id ? 'bg-[#B91C1C] text-white shadow-md shadow-red-900/20 font-bold' : 'bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 border border-gray-100 dark:border-gray-800'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span>{tab.name}</span>
                <ChevronRight className="w-4 h-4 ml-auto hidden lg:block" />
              </button>
            )
          })}
        </div>

        <div className="lg:col-span-3">
          {activeTab === 'profil' && (
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-6 transition-colors">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-gray-900 dark:text-white">Profil Bilgileri</h3>
                {profileLoading ? <RefreshCw className="w-4 h-4 animate-spin text-gray-400 dark:text-gray-500" /> : null}
              </div>
              {profileError ? (
                <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  <AlertCircle className="w-4 h-4" /> {profileError}
                </div>
              ) : null}
              <div className="space-y-4">
                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Kullanıcı Adı</label>
                    <input
                      type="text"
                      readOnly
                      value={profile?.name ?? getUsername() ?? ''}
                      className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg text-sm bg-gray-50 dark:bg-gray-900 text-gray-700 dark:text-gray-300 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Rol</label>
                    <input
                      type="text"
                      readOnly
                      value={profile?.role ?? ''}
                      className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg text-sm bg-gray-50 dark:bg-gray-900 text-gray-700 dark:text-gray-300 focus:outline-none"
                    />
                  </div>
                </div>
                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Firma Kodu</label>
                    <input
                      type="text"
                      readOnly
                      value={profile?.tenantCode ?? getTenantCode() ?? ''}
                      className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg text-sm bg-gray-50 dark:bg-gray-900 text-gray-700 dark:text-gray-300 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Kullanıcı Kimliği</label>
                    <input
                      type="text"
                      readOnly
                      value={profile?.id ?? ''}
                      className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg text-sm bg-gray-50 dark:bg-gray-900 text-gray-700 dark:text-gray-300 font-mono text-xs focus:outline-none"
                    />
                  </div>
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400">Profil bilgileri ERP üzerinden senkronize edilir; düzenleme ERP yönetim panelinden yapılır.</p>
              </div>
            </div>
          )}

          {activeTab === 'urun' && (
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-6 transition-colors">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4">
                <div>
                  <h3 className="font-semibold text-gray-900 dark:text-white">Ürün Yönetimi</h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Firma ürünleri, patlak şemalar ve yedek parçalar.</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setNewProduct({ name: '', stockCode: '' })
                      setDiagramFile(null)
                      setCreateProductOpen(true)
                    }}
                    className="px-4 py-2 bg-[#B91C1C] text-white rounded-lg text-sm font-medium hover:bg-[#991B1B]"
                  >
                    Yeni Ürün
                  </button>
                  <button
                    type="button"
                    disabled={!selectedProductId}
                    onClick={() => {
                      setNewSparePart({ name: '', partNumber: '', stockQuantity: 0, minStockLevel: 0, explodedViewPartNumber: '' })
                      setCreateSparePartOpen(true)
                    }}
                    className={
                      'px-4 py-2 rounded-lg text-sm font-medium ' +
                      (!selectedProductId ? 'bg-gray-200 text-gray-400 cursor-not-allowed' : 'bg-gray-900 text-white hover:bg-black')
                    }
                  >
                    Yedek Parça Ekle
                  </button>
                </div>
              </div>

              <div className="grid md:grid-cols-3 gap-4">
                <div className="md:col-span-1">
                  <div className="mb-3">
                    <input
                      value={productQ}
                      onChange={(e) => setProductQ(e.target.value)}
                      placeholder="Ürün ara..."
                      className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-600 rounded-lg text-sm"
                    />
                  </div>

                  {productsError ? (
                    <div className="mb-3 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                      <AlertCircle className="w-4 h-4" /> {productsError}
                    </div>
                  ) : null}

                  <div className="border border-gray-100 dark:border-gray-700 rounded-xl overflow-hidden">
                    <div className="max-h-[420px] overflow-auto">
                      {productsLoading ? (
                        <div className="p-4 text-sm text-gray-500">Yükleniyor...</div>
                      ) : products.length === 0 ? (
                        <div className="p-4 text-sm text-gray-500">Ürün bulunamadı.</div>
                      ) : (
                        <div className="divide-y divide-gray-100 dark:divide-gray-700">
                          {products.map((p) => (
                            <button
                              key={p.id}
                              type="button"
                              onClick={() => setSelectedProductId(p.id)}
                              className={
                                'w-full text-left px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors ' +
                                (selectedProductId === p.id ? 'bg-red-50 dark:bg-red-900/20' : '')
                              }
                            >
                              <div className="text-sm font-semibold text-gray-900 dark:text-white">{p.name}</div>
                              <div className="text-xs text-gray-500 dark:text-gray-400">{p.stockCode ?? '-'}</div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="md:col-span-2">
                  {!selectedProductId ? (
                    <div className="h-full border border-dashed border-gray-200 dark:border-gray-700 rounded-xl p-6 text-sm text-gray-500 dark:text-gray-400">
                      Soldan bir ürün seç.
                    </div>
                  ) : productDetailLoading ? (
                    <div className="h-full border border-gray-100 dark:border-gray-700 rounded-xl p-6 text-sm text-gray-500">Yükleniyor...</div>
                  ) : productDetailError ? (
                    <div className="h-full border border-gray-100 dark:border-gray-700 rounded-xl p-6 text-sm text-red-700 bg-red-50 border-red-200">{productDetailError}</div>
                  ) : (
                    <div className="space-y-4">
                      <div className="border border-gray-100 dark:border-gray-700 rounded-xl p-4">
                        <div className="text-sm font-semibold text-gray-900 dark:text-white">{activeProduct?.name}</div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">Stok Kodu: {activeProduct?.stockCode ?? '-'}</div>
                      </div>

                      <div className="border border-gray-100 dark:border-gray-700 rounded-xl p-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="text-sm font-semibold text-gray-900 dark:text-white">Patlak Şema</div>
                          <button
                            type="button"
                            onClick={() => {
                              setDiagramFile(null)
                              setCreateProductOpen(true)
                              setNewProduct({ name: activeProduct?.name ?? '', stockCode: activeProduct?.stockCode ?? '' })
                            }}
                            className="text-xs font-semibold text-[#B91C1C]"
                          >
                            Şema Yükle
                          </button>
                        </div>

                        {productDetail?.explodedDiagrams?.length ? (
                          <div className="rounded-xl overflow-hidden border border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
                            <img
                              src={productDetail.explodedDiagrams[0].url}
                              alt={productDetail.explodedDiagrams[0].fileName}
                              className="w-full h-auto"
                            />
                          </div>
                        ) : (
                          <div className="text-xs text-gray-500 dark:text-gray-400">Bu ürün için şema yok.</div>
                        )}
                      </div>

                      <div className="border border-gray-100 dark:border-gray-700 rounded-xl p-4">
                        <div className="text-sm font-semibold text-gray-900 dark:text-white mb-3">Yedek Parçalar</div>
                        {productDetail?.spareParts?.length ? (
                          <div className="space-y-2">
                            {productDetail.spareParts.map((sp) => {
                              const isOut = sp.stockQuantity === 0
                              const isLow = !isOut && sp.stockQuantity <= sp.minStockLevel
                              return (
                                <div key={sp.id} className="flex items-center justify-between gap-3 p-3 rounded-xl border border-gray-100 dark:border-gray-700">
                                  <div className="min-w-0">
                                    <div className="text-sm font-semibold text-gray-900 dark:text-white truncate">{sp.name}</div>
                                    <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                                      {sp.partNumber ? `Parça No: ${sp.partNumber}` : 'Parça No: -'}
                                      {sp.explodedViewPartNumber ? ` • Şema No: ${sp.explodedViewPartNumber}` : ''}
                                    </div>
                                  </div>
                                  <div className="text-right">
                                    <div className={
                                      'text-sm font-bold ' +
                                      (isOut ? 'text-red-600' : isLow ? 'text-amber-600' : 'text-gray-900 dark:text-white')
                                    }>
                                      {sp.stockQuantity}
                                    </div>
                                    <div className="text-[11px] text-gray-500 dark:text-gray-400">Min: {sp.minStockLevel}</div>
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        ) : (
                          <div className="text-xs text-gray-500 dark:text-gray-400">Yedek parça yok.</div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {createProductOpen && (
                <>
                  <div className="fixed inset-0 bg-black/30 z-40" onClick={() => setCreateProductOpen(false)} />
                  <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <div className="w-full max-w-xl bg-white rounded-2xl shadow-2xl overflow-hidden">
                      <div className="p-5 border-b border-gray-100 flex items-center justify-between">
                        <div>
                          <div className="text-lg font-bold text-gray-900">Ürün / Şema</div>
                          <div className="text-xs text-gray-500">Ürün oluşturabilir veya seçili ürüne şema ekleyebilirsin.</div>
                        </div>
                        <button onClick={() => setCreateProductOpen(false)} className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm font-semibold hover:bg-gray-50">Kapat</button>
                      </div>
                      <div className="p-5 space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="space-y-1">
                            <div className="text-xs font-semibold text-gray-500">Ürün Adı</div>
                            <input value={newProduct.name} onChange={(e) => setNewProduct(p => ({ ...p, name: e.target.value }))} className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm w-full" />
                          </div>
                          <div className="space-y-1">
                            <div className="text-xs font-semibold text-gray-500">Stok Kodu</div>
                            <input value={newProduct.stockCode} onChange={(e) => setNewProduct(p => ({ ...p, stockCode: e.target.value }))} className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm w-full" />
                          </div>
                        </div>
                        <div className="space-y-1">
                          <div className="text-xs font-semibold text-gray-500">Patlak Şema Görseli</div>
                          <input type="file" accept="image/*" onChange={(e) => setDiagramFile(e.target.files?.[0] ?? null)} className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm w-full" />
                        </div>
                      </div>
                      <div className="p-5 border-t border-gray-100 flex items-center justify-end gap-2">
                        <button onClick={() => setCreateProductOpen(false)} className="px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm font-semibold hover:bg-gray-50">Vazgeç</button>
                        <button
                          disabled={profileLoading || !newProduct.name.trim()}
                          onClick={async () => {
                            try {
                              let productId = selectedProductId
                              if (!productId || (activeProduct?.name ?? '') !== newProduct.name.trim()) {
                                const created = await createServiceProduct({
                                  name: newProduct.name,
                                  stockCode: newProduct.stockCode || undefined,
                                })
                                productId = created?.data?.id
                              }
                              if (!productId) throw new Error('Ürün oluşturulamadı')

                              if (diagramFile) {
                                await uploadExplodedDiagram(productId, diagramFile)
                              }

                              const refreshed = await fetchServiceProducts(productQ.trim() || undefined)
                              setProducts(refreshed)
                              setSelectedProductId(productId)
                              flash('Ürün kaydedildi.')
                              setCreateProductOpen(false)
                            } catch (e: any) {
                              flash(String(e?.message ?? 'İşlem başarısız'))
                            }
                          }}
                          className="px-4 py-2 bg-[#B91C1C] text-white rounded-lg text-sm font-semibold hover:bg-[#991B1B]"
                        >
                          Kaydet
                        </button>
                      </div>
                    </div>
                  </div>
                </>
              )}

              {createSparePartOpen && selectedProductId && (
                <>
                  <div className="fixed inset-0 bg-black/30 z-40" onClick={() => setCreateSparePartOpen(false)} />
                  <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <div className="w-full max-w-xl bg-white rounded-2xl shadow-2xl overflow-hidden">
                      <div className="p-5 border-b border-gray-100 flex items-center justify-between">
                        <div>
                          <div className="text-lg font-bold text-gray-900">Yedek Parça Ekle</div>
                          <div className="text-xs text-gray-500">Ürün: {activeProduct?.name ?? '-'}</div>
                        </div>
                        <button onClick={() => setCreateSparePartOpen(false)} className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm font-semibold hover:bg-gray-50">Kapat</button>
                      </div>
                      <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-1 md:col-span-2">
                          <div className="text-xs font-semibold text-gray-500">Yedek Parça Adı</div>
                          <input value={newSparePart.name} onChange={(e) => setNewSparePart(p => ({ ...p, name: e.target.value }))} className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm w-full" />
                        </div>
                        <div className="space-y-1">
                          <div className="text-xs font-semibold text-gray-500">Parça No</div>
                          <input value={newSparePart.partNumber} onChange={(e) => setNewSparePart(p => ({ ...p, partNumber: e.target.value }))} className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm w-full" />
                        </div>
                        <div className="space-y-1">
                          <div className="text-xs font-semibold text-gray-500">Şema Parça Numarası</div>
                          <input value={newSparePart.explodedViewPartNumber} onChange={(e) => setNewSparePart(p => ({ ...p, explodedViewPartNumber: e.target.value }))} className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm w-full" />
                        </div>
                        <div className="space-y-1">
                          <div className="text-xs font-semibold text-gray-500">Stok</div>
                          <input type="number" value={newSparePart.stockQuantity} onChange={(e) => setNewSparePart(p => ({ ...p, stockQuantity: Number(e.target.value) }))} className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm w-full" />
                        </div>
                        <div className="space-y-1">
                          <div className="text-xs font-semibold text-gray-500">Min. Stok</div>
                          <input type="number" value={newSparePart.minStockLevel} onChange={(e) => setNewSparePart(p => ({ ...p, minStockLevel: Number(e.target.value) }))} className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm w-full" />
                        </div>
                      </div>
                      <div className="p-5 border-t border-gray-100 flex items-center justify-end gap-2">
                        <button onClick={() => setCreateSparePartOpen(false)} className="px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm font-semibold hover:bg-gray-50">Vazgeç</button>
                        <button
                          disabled={!newSparePart.name.trim()}
                          onClick={async () => {
                            try {
                              await createSparePart({
                                productId: selectedProductId,
                                name: newSparePart.name,
                                partNumber: newSparePart.partNumber || undefined,
                                stockQuantity: Number.isFinite(newSparePart.stockQuantity) ? newSparePart.stockQuantity : 0,
                                minStockLevel: Number.isFinite(newSparePart.minStockLevel) ? newSparePart.minStockLevel : 0,
                                explodedViewPartNumber: newSparePart.explodedViewPartNumber || undefined,
                              })
                              const d = await fetchServiceProductDetail(selectedProductId)
                              setProductDetail(d)
                              flash('Yedek parça eklendi.')
                              setCreateSparePartOpen(false)
                            } catch (e: any) {
                              flash(String(e?.message ?? 'Yedek parça eklenemedi'))
                            }
                          }}
                          className="px-4 py-2 bg-gray-900 text-white rounded-lg text-sm font-semibold hover:bg-black"
                        >
                          Kaydet
                        </button>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {activeTab === 'bildirim' && (
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-6 transition-colors">
              <h3 className="font-semibold text-gray-900 dark:text-white mb-4">Bildirim Ayarları</h3>
              <div className="space-y-3">
                {NOTIF_KEYS.map((item) => (
                  <label key={item} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-900 rounded-lg cursor-pointer transition-colors">
                    <span className="text-sm text-gray-700 dark:text-gray-300">{item}</span>
                    <input
                      type="checkbox"
                      checked={!!notifPrefs[item]}
                      onChange={() => toggleNotif(item)}
                      className="w-4 h-4 text-[#B91C1C] rounded border-gray-300"
                    />
                  </label>
                ))}
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-3">Tercihler bu cihazda saklanır.</p>
            </div>
          )}

          {activeTab === 'islerim' && (
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-6 transition-colors">
              <h3 className="font-semibold text-gray-900 dark:text-white mb-4">Kişisel İstatistikler</h3>
              <div className="grid grid-cols-1 gap-3 mb-5 sm:grid-cols-3">
                <div className="rounded-lg bg-gray-50 dark:bg-gray-900 p-3">
                  <div className="text-xs text-gray-500">Toplam</div>
                  <div className="text-xl font-bold text-gray-900 dark:text-white">{myStats.total}</div>
                </div>
                <div className="rounded-lg bg-amber-50 dark:bg-gray-900 p-3">
                  <div className="text-xs text-gray-500">Aktif</div>
                  <div className="text-xl font-bold text-amber-700">{myStats.active}</div>
                </div>
                <div className="rounded-lg bg-green-50 dark:bg-gray-900 p-3">
                  <div className="text-xs text-gray-500">Tamamlanan</div>
                  <div className="text-xl font-bold text-green-700">{myStats.completed}</div>
                </div>
              </div>
              <div className="space-y-2">
                {myStats.recent.length === 0 ? (
                  <div className="text-sm text-gray-500">Atanmış iş bulunamadı.</div>
                ) : myStats.recent.map((item) => (
                  <div key={item.id} className="flex items-center justify-between rounded-lg border border-gray-100 dark:border-gray-700 px-3 py-2">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-gray-900 dark:text-white truncate">{item.serviceNumber}</div>
                      <div className="text-xs text-gray-500 truncate">{item.productName}</div>
                    </div>
                    <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">{STATUS_LABELS[item.status] ?? item.status}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'guvenlik' && (
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-6 transition-colors">
              <h3 className="font-semibold text-gray-900 dark:text-white mb-4">Güvenlik</h3>
              <div className="space-y-4">
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  Şifre değişikliği ve iki faktörlü doğrulama ERP yönetim modülü üzerinden yapılır. Bu sayfadan oturum sonlandırılabilir.
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    if (isTechnicianSession()) {
                      const techId = getTechnicianId()
                      if (techId) {
                        try {
                          await fetch(`/api/technicians/${techId}/online`, {
                            method: 'PATCH',
                            headers: {
                              'Content-Type': 'application/json',
                              'Authorization': `Bearer ${getAccessToken()}`,
                              'X-Tenant-Code': getTenantCode() || ''
                            },
                            body: JSON.stringify({ isOnline: false })
                          })
                        } catch (e) {
                          console.error(e)
                        }
                      }
                    }
                    // Ortak oturum kapatılır: bayi tarafındaki oturum da düşer.
                    await logoutShared()
                    clearSession()
                    window.location.assign('/login')
                  }}
                  className="px-4 py-2 bg-[#B91C1C] text-white rounded-lg text-sm font-medium hover:bg-[#991B1B]"
                >
                  Tüm Cihazlardan Çıkış Yap
                </button>
              </div>
            </div>
          )}

          {activeTab === 'tema' && (
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-6 transition-colors">
              <h3 className="font-semibold text-gray-900 dark:text-white mb-4">Tema</h3>
              <div className="grid grid-cols-2 gap-3 max-w-md">
                {(['light', 'dark'] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => applyTheme(t)}
                    className={`px-4 py-3 rounded-xl border text-sm font-medium transition-colors ${
                      theme === t ? 'border-[#B91C1C] bg-red-50 dark:bg-red-900/20 text-[#B91C1C]' : 'border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300'
                    }`}
                  >
                    {t === 'light' ? 'Açık' : 'Koyu'}
                  </button>
                ))}
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-3">Tema tercihi bu cihazda saklanır.</p>
            </div>
          )}

          {activeTab === 'veri' && (
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-6 transition-colors">
              <h3 className="font-semibold text-gray-900 dark:text-white mb-4">Veri Yönetimi</h3>
              <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">Yerel olarak saklanan tercih ve önbellek verilerini temizler. Oturum bilgisi korunur.</p>
              <button
                type="button"
                onClick={clearLocalCache}
                className="px-4 py-2 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-black"
              >
                Yerel Önbelleği Temizle
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
