import { useEffect, useMemo, useState } from 'react'
import { AdminLayout } from '../components/admin/AdminLayout'
import { getAdminToken, readApiResponse } from '../lib/api'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { MediaLibraryModal } from '../components/ui/MediaLibraryModal'
import { useToast } from '../components/ui/ToastContext'
import { useConfirm } from '../components/ui/ConfirmContext'

type ManualItem = {
  id: string
  productId: string | null
  productName: string | null
  pdfUrl: string
  title: string
  language: string
  isActive: boolean
  createdAt?: string
}

type ProductOption = {
  id: string
  name: string
  code: string
}

export function AdminManualsPage() {
  const { showToast } = useToast()
  const confirm = useConfirm()
  const [manuals, setManuals] = useState<ManualItem[]>([])
  const [products, setProducts] = useState<ProductOption[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  // Modal editor states
  const [modalOpen, setModalOpen] = useState(false)
  const [editingItem, setEditingItem] = useState<ManualItem | null>(null)

  // Form states
  const [title, setTitle] = useState('')
  const [selectedProductId, setSelectedProductId] = useState('')
  const [pdfUrl, setPdfUrl] = useState('')
  const [language, setLanguage] = useState('tr')
  const [isActive, setIsActive] = useState(true)

  // Media picker states
  const [mediaPickerOpen, setMediaPickerOpen] = useState(false)

  const authHeader = useMemo(() => {
    const token = getAdminToken()
    return token ? { Authorization: `Bearer ${token}` } : null
  }, [])

  const fetchData = async () => {
    if (!authHeader) return
    setLoading(true)
    try {
      // Fetch manuals
      const manualsRes = await fetch('/api/admin/manuals', { headers: authHeader })
      const manualsJson = await manualsRes.json()
      if (manualsRes.ok && manualsJson?.success) {
        setManuals(manualsJson.data || [])
      }

      // Fetch products for listing selection
      const prodRes = await fetch('/api/admin/products', { headers: authHeader })
      const prodJson = await readApiResponse(prodRes)
      if (prodRes.ok) {
        // Extract product list safely
        let prods: ProductOption[] = []
        if (Array.isArray(prodJson)) {
          prods = prodJson.map((p: any) => ({
            id: p.id || p.productId,
            name: p.name || p.productName || 'Adsız Ürün',
            code: p.code || p.productCode || '',
          }))
        } else if (Array.isArray(prodJson?.data)) {
          prods = prodJson.data.map((p: any) => ({
            id: p.id || p.productId,
            name: p.name || p.productName || 'Adsız Ürün',
            code: p.code || p.productCode || '',
          }))
        }
        setProducts(prods)
      }
    } catch (err) {
      showToast('Veriler yüklenemedi.', 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [authHeader])

  const openUpsertModal = (item?: ManualItem) => {
    if (item) {
      setEditingItem(item)
      setTitle(item.title)
      setSelectedProductId(item.productId || '')
      setPdfUrl(item.pdfUrl)
      setLanguage(item.language || 'tr')
      setIsActive(item.isActive)
    } else {
      setEditingItem(null)
      setTitle('')
      setSelectedProductId('')
      setPdfUrl('')
      setLanguage('tr')
      setIsActive(true)
    }
    setModalOpen(true)
  }

  const handleUpsert = async () => {
    if (!authHeader) return
    if (!title.trim() || !pdfUrl.trim()) {
      showToast('Kılavuz başlığı ve PDF linki zorunludur.', 'error')
      return
    }

    setSaving(true)
    try {
      const selectedProd = products.find((p) => p.id === selectedProductId)

      const payload: Partial<ManualItem> = {
        title: title.trim(),
        pdfUrl: pdfUrl.trim(),
        productId: selectedProductId ? selectedProductId : null,
        productName: selectedProd ? selectedProd.name : null,
        language,
        isActive,
      }

      if (editingItem) {
        payload.id = editingItem.id
      }

      const res = await fetch('/api/admin/manuals', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...authHeader,
        },
        body: JSON.stringify(payload),
      })
      const json = await res.json()
      if (!res.ok || !json?.success) throw new Error(json?.message || 'Kaydedilemedi')

      showToast(editingItem ? 'Kılavuz güncellendi.' : 'Kılavuz başarıyla eklendi.', 'success')
      setModalOpen(false)
      fetchData()
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Kaydedilemedi', 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!authHeader) return
    const ok = await confirm('Bu kullanım kılavuzunu kalıcı olarak silmek istediğinizden emin misiniz?', { type: 'danger', confirmText: 'Evet, Sil', title: 'Kılavuzu Sil' })
    if (!ok) return

    try {
      const res = await fetch(`/api/admin/manuals/${id}`, {
        method: 'DELETE',
        headers: authHeader,
      })
      const json = await res.json()
      if (res.ok && json?.success) {
        showToast('Kullanım kılavuzu silindi.', 'success')
        fetchData()
      } else {
        showToast(json?.message || 'Silme işlemi başarısız.', 'error')
      }
    } catch (err) {
      showToast('Bağlantı hatası.', 'error')
    }
  }

  const handleMediaSelect = (url: string) => {
    setPdfUrl(url)
    setMediaPickerOpen(false)
    showToast('PDF dosyası seçildi.', 'success')
  }

  return (
    <AdminLayout
      title="Kullanım Kılavuzları"
      subtitle="Ürünler için PDF formatında kullanım kılavuzları yükleyin, güncelleyin ve silin."
    >
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4 bg-white p-5 border border-zinc-200/80 rounded-3xl shadow-[0_2px_8px_rgba(0,0,0,0.02)]">
          <div className="text-xs font-bold text-zinc-500 uppercase tracking-wider">
            <span className="inline-flex items-center justify-center px-3 py-1 rounded-full text-xs font-bold bg-[#df0000]/5 text-[#df0000] border border-[#df0000]/10">
              Toplam Kılavuz: {manuals.length}
            </span>
          </div>
          <Button 
            variant="primary" 
            onClick={() => openUpsertModal()} 
            icon="add"
            className="rounded-2xl bg-[#df0000] hover:bg-[#c00000] active:scale-[0.98] transition-all px-4"
          >
            Yeni Kılavuz Ekle
          </Button>
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center py-24 bg-white rounded-3xl border border-zinc-200/80 shadow-[0_2px_8px_rgba(0,0,0,0.02)]">
            <div className="w-10 h-10 border-4 border-zinc-200 border-t-[#df0000] rounded-full animate-spin mb-3" />
            <span className="text-sm text-zinc-400 font-medium">Kullanım kılavuzları yükleniyor...</span>
          </div>
        ) : manuals.length === 0 ? (
          <div className="bg-white rounded-3xl border border-zinc-200/80 p-16 text-center shadow-[0_2px_8px_rgba(0,0,0,0.02)]">
            <div className="w-16 h-16 bg-zinc-50 rounded-full flex items-center justify-center mx-auto mb-4 border border-zinc-100">
              <span className="material-symbols-outlined text-[32px] text-zinc-450">menu_book</span>
            </div>
            <h4 className="text-base font-bold text-zinc-850">Kayıtlı Kullanım Kılavuzu Bulunmuyor</h4>
            <p className="text-xs text-zinc-500 mt-2 max-w-sm mx-auto">
              "Yeni Kılavuz Ekle" butonuna basarak ilk kılavuzu sisteme tanımlayın.
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-3xl border border-zinc-200/80 bg-white shadow-[0_2px_8px_rgba(0,0,0,0.02),0_8px_24px_rgba(0,0,0,0.02)]">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-zinc-50/80 border-b border-zinc-200/80 text-[10px] font-extrabold tracking-wider text-zinc-455 uppercase">
                    <th className="px-6 py-4">Kılavuz Başlığı</th>
                    <th className="px-6 py-4">İlişkili Ürün</th>
                    <th className="px-6 py-4 text-center">Dil</th>
                    <th className="px-6 py-4 text-center">Durum</th>
                    <th className="px-6 py-4 text-right">İşlemler</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-150/60 text-xs text-zinc-650">
                  {manuals.map((item) => (
                    <tr key={item.id} className="hover:bg-zinc-50/50 transition-colors duration-150">
                      <td className="px-6 py-4.5 font-bold text-zinc-950">
                        <div className="flex items-center gap-3">
                          <span className="material-symbols-outlined text-zinc-400">menu_book</span>
                          <span className="text-[13px]">{item.title}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4.5 text-zinc-600">
                        {item.productName ? (
                          <div className="flex flex-col">
                            <span className="font-semibold text-zinc-800 text-[12px]">{item.productName}</span>
                            <span className="text-[10px] text-zinc-400 font-mono mt-0.5">ID: {item.productId}</span>
                          </div>
                        ) : (
                          <span className="text-xs text-zinc-450 italic font-medium">Genel Kılavuz (Tüm ürünler)</span>
                        )}
                      </td>
                      <td className="px-6 py-4.5 text-center">
                        <span className="inline-flex items-center justify-center px-2.5 py-0.5 rounded-lg text-[10px] font-extrabold bg-zinc-100 border border-zinc-200 text-zinc-750 uppercase tracking-wider">
                          {item.language}
                        </span>
                      </td>
                      <td className="px-6 py-4.5 text-center">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[9px] font-bold border uppercase tracking-wider ${
                          item.isActive ? 'bg-green-50 border-green-200 text-green-700' : 'bg-zinc-50 border-zinc-200 text-zinc-500'
                        }`}>
                          {item.isActive ? 'Aktif' : 'Pasif'}
                        </span>
                      </td>
                      <td className="px-6 py-4.5 text-right">
                        <div className="flex justify-end gap-2">
                          <a
                            href={item.pdfUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="w-7 h-7 rounded-full border border-zinc-200/80 text-zinc-500 hover:text-zinc-950 hover:bg-zinc-100 transition-all flex items-center justify-center"
                            title="Dosyayı Gör"
                          >
                            <span className="material-symbols-outlined text-[16px]">visibility</span>
                          </a>
                          <button
                            type="button"
                            onClick={() => openUpsertModal(item)}
                            className="w-7 h-7 rounded-full border border-zinc-200/80 text-zinc-500 hover:text-zinc-950 hover:bg-zinc-100 transition-all flex items-center justify-center"
                            title="Düzenle"
                          >
                            <span className="material-symbols-outlined text-[16px]">edit</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(item.id)}
                            className="w-7 h-7 rounded-full border border-zinc-200/80 text-zinc-400 hover:text-rose-600 hover:border-rose-200 hover:bg-rose-50/50 transition-all flex items-center justify-center"
                            title="Sil"
                          >
                            <span className="material-symbols-outlined text-[16px]">delete</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Editor Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-[80] overflow-y-auto">
          <div className="absolute inset-0 bg-black/45 backdrop-blur-[2px]" onClick={() => setModalOpen(false)} />
          <div className="flex min-h-screen items-center justify-center p-4">
            <div className="relative w-full max-w-lg bg-white rounded-3xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
              <div className="flex items-center justify-between border-b border-zinc-150 px-6 py-4.5 bg-zinc-50/50">
                <span className="text-sm font-bold text-zinc-800 uppercase tracking-tight flex items-center gap-2">
                  <span className="material-symbols-outlined text-zinc-400">menu_book</span>
                  {editingItem ? 'Kılavuz Düzenle' : 'Kılavuz Ekle'}
                </span>
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="w-8 h-8 rounded-full hover:bg-zinc-150 text-zinc-500 flex items-center justify-center transition-colors"
                >
                  <span className="material-symbols-outlined text-[20px]">close</span>
                </button>
              </div>

              <div className="p-6 space-y-4.5 max-h-[70vh] overflow-y-auto">
                <Input
                  label="Kılavuz Başlığı *"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Örn: Silk Max Ütü Kullanım Kılavuzu"
                  className="rounded-2xl focus:ring-[#df0000]/5 focus:border-[#df0000]"
                />

                <div className="flex flex-col gap-1.5">
                  <label className="text-[11px] font-extrabold tracking-wider text-zinc-400 uppercase">İlişkili Ürün (Opsiyonel)</label>
                  <div className="relative">
                    <select
                      value={selectedProductId}
                      onChange={(e) => setSelectedProductId(e.target.value)}
                      className="w-full h-11 pl-4 pr-10 border border-zinc-200 rounded-2xl text-xs font-semibold text-zinc-700 bg-white outline-none focus:ring-4 focus:ring-[#df0000]/5 focus:border-[#df0000] appearance-none transition-all duration-200"
                    >
                      <option value="">Genel (Hiçbir Ürüne Bağlama)</option>
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} [{p.code}]
                        </option>
                      ))}
                    </select>
                    <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-zinc-400 flex items-center">
                      <span className="material-symbols-outlined text-[16px]">unfold_more</span>
                    </div>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-[11px] font-extrabold tracking-wider text-zinc-400 uppercase">PDF Kılavuz URL *</label>
                  <div className="flex gap-2">
                    <Input
                      value={pdfUrl}
                      onChange={(e) => setPdfUrl(e.target.value)}
                      placeholder="Medya kütüphanesinden PDF dosyasını seçin veya girin"
                      className="rounded-2xl focus:ring-[#df0000]/5 focus:border-[#df0000]"
                    />
                    <Button 
                      variant="outline" 
                      onClick={() => setMediaPickerOpen(true)}
                      className="rounded-2xl hover:bg-zinc-50 active:scale-[0.98] transition-all px-4 h-11 shrink-0"
                    >
                      Seç
                    </Button>
                  </div>
                </div>

                <div className="grid gap-4 grid-cols-2">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[11px] font-extrabold tracking-wider text-zinc-400 uppercase">Kılavuz Dili</label>
                    <div className="relative">
                      <select
                        value={language}
                        onChange={(e) => setLanguage(e.target.value)}
                        className="w-full h-11 pl-4 pr-10 border border-zinc-200 rounded-2xl text-xs font-semibold text-zinc-700 bg-white outline-none focus:ring-4 focus:ring-[#df0000]/5 focus:border-[#df0000] appearance-none transition-all duration-200"
                      >
                        <option value="tr">Türkçe (TR)</option>
                        <option value="en">English (EN)</option>
                      </select>
                      <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-zinc-400 flex items-center">
                        <span className="material-symbols-outlined text-[16px]">unfold_more</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col justify-end">
                    <div className="flex items-center gap-3.5 h-11 bg-zinc-50/50 border border-zinc-250 rounded-2xl px-4">
                      <input
                        type="checkbox"
                        id="isActiveCheckbox"
                        checked={isActive}
                        onChange={(e) => setIsActive(e.target.checked)}
                        className="w-4 h-4 accent-[#df0000] cursor-pointer"
                      />
                      <label htmlFor="isActiveCheckbox" className="text-xs font-bold text-zinc-700 cursor-pointer select-none">
                        Aktif / Yayında
                      </label>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-3 border-t border-zinc-150 px-6 py-4.5 bg-zinc-50/50">
                <Button 
                  variant="outline" 
                  onClick={() => setModalOpen(false)}
                  className="rounded-2xl active:scale-[0.98]"
                >
                  Vazgeç
                </Button>
                <Button 
                  variant="primary" 
                  loading={saving} 
                  onClick={handleUpsert}
                  className="rounded-2xl bg-[#df0000] hover:bg-[#c00000] active:scale-[0.98] transition-all px-5"
                >
                  Kaydet
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      <MediaLibraryModal
        isOpen={mediaPickerOpen}
        onClose={() => setMediaPickerOpen(false)}
        onSelect={handleMediaSelect}
        activeFolder="Genel"
      />
    </AdminLayout>
  )
}
