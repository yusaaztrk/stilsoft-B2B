import { useEffect, useMemo, useState } from 'react'
import { AdminLayout } from '../components/admin/AdminLayout'
import { getAdminToken, readApiResponse } from '../lib/api'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { MediaLibraryModal } from '../components/ui/MediaLibraryModal'
import { useToast } from '../components/ui/ToastContext'
import { useConfirm } from '../components/ui/ConfirmContext'

type PdfCatalogItem = {
  id: string
  name: string
  coverImageUrl: string | null
  pdfUrl: string
  description: string | null
  sortOrder: number
  isActive: boolean
  createdAt?: string
}

export function AdminPdfCatalogsPage() {
  const { showToast } = useToast()
  const confirm = useConfirm()
  const [catalogs, setCatalogs] = useState<PdfCatalogItem[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  
  // Modal editor states
  const [modalOpen, setModalOpen] = useState(false)
  const [editingItem, setEditingItem] = useState<PdfCatalogItem | null>(null)
  
  // Form states
  const [name, setName] = useState('')
  const [coverImageUrl, setCoverImageUrl] = useState('')
  const [pdfUrl, setPdfUrl] = useState('')
  const [description, setDescription] = useState('')
  const [sortOrder, setSortOrder] = useState('0')
  const [isActive, setIsActive] = useState(true)

  // Media picker states
  const [mediaPickerOpen, setMediaPickerOpen] = useState(false)
  const [activePickerField, setActivePickerField] = useState<'cover' | 'pdf' | null>(null)

  // Catalog Title states
  const [storeDesign, setStoreDesign] = useState<any>(null)
  const [pdfTitle, setPdfTitle] = useState('')
  const [savingTitle, setSavingTitle] = useState(false)

  const authHeader = useMemo(() => {
    const token = getAdminToken()
    return token ? { Authorization: `Bearer ${token}` } : null
  }, [])

  const fetchStoreDesign = async () => {
    try {
      const res = await fetch('/api/store-design')
      const json = await readApiResponse(res)
      if (res.ok && json?.data) {
        setStoreDesign(json.data)
        setPdfTitle(json.data.pdfCatalogsTitle || "Stilsoft'un Renkli Dünyasına Açılan Kapılar")
      }
    } catch (err) {
      console.error('Tasarım ayarları yüklenemedi:', err)
    }
  }

  const handleSaveTitle = async () => {
    if (!authHeader) return
    setSavingTitle(true)
    try {
      const updatedDesign = {
        ...storeDesign,
        pdfCatalogsTitle: pdfTitle.trim()
      }
      
      const res = await fetch('/api/store-design', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...authHeader,
        },
        body: JSON.stringify(updatedDesign),
      })
      const json = await readApiResponse(res)
      if (res.ok && json?.success) {
        showToast('Katalog bölümü başlığı güncellendi.', 'success')
        setStoreDesign(updatedDesign)
      } else {
        throw new Error(json?.message || 'Güncellenemedi')
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Başlık güncellenemedi', 'error')
    } finally {
      setSavingTitle(false)
    }
  }

  const fetchCatalogs = async () => {
    if (!authHeader) return
    setLoading(true)
    try {
      const res = await fetch('/api/admin/pdf-catalogs', { headers: authHeader })
      const json = await readApiResponse(res)
      if (res.ok && json?.success) {
        setCatalogs(json.data || [])
      }
    } catch (err) {
      showToast('Kataloglar yüklenemedi.', 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchCatalogs()
    fetchStoreDesign()
  }, [authHeader])

  const openUpsertModal = (item?: PdfCatalogItem) => {
    if (item) {
      setEditingItem(item)
      setName(item.name)
      setCoverImageUrl(item.coverImageUrl || '')
      setPdfUrl(item.pdfUrl)
      setDescription(item.description || '')
      setSortOrder(String(item.sortOrder))
      setIsActive(item.isActive)
    } else {
      setEditingItem(null)
      setName('')
      setCoverImageUrl('')
      setPdfUrl('')
      setDescription('')
      setSortOrder('0')
      setIsActive(true)
    }
    setModalOpen(true)
  }

  const handleUpsert = async () => {
    if (!authHeader) return
    if (!name.trim() || !pdfUrl.trim()) {
      showToast('Ad ve PDF linki alanları zorunludur.', 'error')
      return
    }

    setSaving(true)
    try {
      const payload: Partial<PdfCatalogItem> = {
        name: name.trim(),
        coverImageUrl: coverImageUrl.trim() ? coverImageUrl.trim() : null,
        pdfUrl: pdfUrl.trim(),
        description: description.trim() ? description.trim() : null,
        sortOrder: parseInt(sortOrder) || 0,
        isActive,
      }

      if (editingItem) {
        payload.id = editingItem.id
      }

      const res = await fetch('/api/admin/pdf-catalogs', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...authHeader,
        },
        body: JSON.stringify(payload),
      })
      const json = await readApiResponse(res)
      if (!res.ok || !json?.success) throw new Error(json?.message || 'Kaydedilemedi')
      
      showToast(editingItem ? 'Katalog güncellendi.' : 'Katalog başarıyla eklendi.', 'success')
      setModalOpen(false)
      fetchCatalogs()
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Kaydedilemedi', 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!authHeader) return
    const ok = await confirm('Bu kataloğu kalıcı olarak silmek istediğinizden emin misiniz?', { type: 'danger', confirmText: 'Evet, Sil', title: 'Kataloğu Sil' })
    if (!ok) return

    try {
      const res = await fetch(`/api/admin/pdf-catalogs/${id}`, {
        method: 'DELETE',
        headers: authHeader,
      })
      const json = await readApiResponse(res)
      if (res.ok && json?.success) {
        showToast('Katalog silindi.', 'success')
        fetchCatalogs()
      } else {
        showToast(json?.message || 'Silme işlemi başarısız.', 'error')
      }
    } catch (err) {
      showToast('Bağlantı hatası.', 'error')
    }
  }

  const openMediaPicker = (field: 'cover' | 'pdf') => {
    setActivePickerField(field)
    setMediaPickerOpen(true)
  }

  const handleMediaSelect = (url: string) => {
    if (activePickerField === 'cover') {
      setCoverImageUrl(url)
    } else if (activePickerField === 'pdf') {
      setPdfUrl(url)
    }
    setMediaPickerOpen(false)
    setActivePickerField(null)
    showToast('Görsel/Dosya kütüphaneden seçildi.', 'success')
  }

  return (
    <AdminLayout
      title="PDF Kataloglar"
      subtitle="E-ticaret sitesinde listelenecek broşür, e-katalog ve mevsimlik ürün PDF'lerini yönetin."
    >
      <div className="space-y-6">
        {/* Catalog Page Section Title Editor */}
        <div className="border border-zinc-200/80 bg-white rounded-3xl p-6 shadow-[0_2px_8px_rgba(0,0,0,0.02),0_8px_24px_rgba(0,0,0,0.02)] space-y-4 transition-all duration-300 hover:shadow-md hover:border-zinc-300/80">
          <h3 className="text-[10px] font-extrabold text-zinc-400 uppercase tracking-widest border-b border-zinc-150 pb-3 flex items-center gap-2">
            <span className="material-symbols-outlined text-[#df0000] text-[18px]">title</span>
            PDF Katalog Bölümü Başlığı
          </h3>
          <div className="flex flex-col sm:flex-row items-end gap-4">
            <div className="flex-1 w-full">
              <Input
                label="Bölüm Başlığı"
                value={pdfTitle}
                onChange={(e) => setPdfTitle(e.target.value)}
                className="rounded-2xl focus:ring-[#df0000]/5 focus:border-[#df0000]"
                placeholder="Örn: Stilsoft'un Renkli Dünyasına Açılan Kapılar"
              />
            </div>
            <Button
              variant="primary"
              onClick={handleSaveTitle}
              loading={savingTitle}
              icon="save"
              className="rounded-2xl bg-[#df0000] hover:bg-[#c00000] active:scale-[0.98] transition-all px-6 h-[42px] sm:h-[46px] w-full sm:w-auto flex justify-center"
            >
              Başlığı Kaydet
            </Button>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4 bg-white p-5 border border-zinc-200/80 rounded-3xl shadow-[0_2px_8px_rgba(0,0,0,0.02)]">
          <div className="text-xs font-bold text-zinc-500 uppercase tracking-wider">
            <span className="inline-flex items-center justify-center px-3 py-1 rounded-full text-xs font-bold bg-[#df0000]/5 text-[#df0000] border border-[#df0000]/10">
              Toplam Katalog: {catalogs.length}
            </span>
          </div>
          <Button 
            variant="primary" 
            onClick={() => openUpsertModal()} 
            icon="add"
            className="rounded-2xl bg-[#df0000] hover:bg-[#c00000] active:scale-[0.98] transition-all px-4"
          >
            Yeni Katalog Ekle
          </Button>
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center py-24 bg-white rounded-3xl border border-zinc-200/80 shadow-[0_2px_8px_rgba(0,0,0,0.02)]">
            <div className="w-10 h-10 border-4 border-zinc-200 border-t-[#df0000] rounded-full animate-spin mb-3" />
            <span className="text-sm text-zinc-400 font-medium">Kataloglar yükleniyor...</span>
          </div>
        ) : catalogs.length === 0 ? (
          <div className="bg-white rounded-3xl border border-zinc-200/80 p-16 text-center shadow-[0_2px_8px_rgba(0,0,0,0.02)]">
            <div className="w-16 h-16 bg-zinc-50 rounded-full flex items-center justify-center mx-auto mb-4 border border-zinc-100">
              <span className="material-symbols-outlined text-[32px] text-zinc-400">picture_as_pdf</span>
            </div>
            <h4 className="text-base font-bold text-zinc-850">Kayıtlı Katalog Bulunmuyor</h4>
            <p className="text-xs text-zinc-500 mt-2 max-w-sm mx-auto">
              "Yeni Katalog Ekle" butonuna basarak ilk PDF kataloğu sisteme yükleyin.
            </p>
          </div>
        ) : (
          <div className="grid gap-6 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            {catalogs.map((item) => (
              <div
                key={item.id}
                className="border border-zinc-200/80 rounded-3xl bg-white shadow-[0_2px_8px_rgba(0,0,0,0.02),0_8px_24px_rgba(0,0,0,0.02)] overflow-hidden flex flex-col justify-between hover:shadow-md hover:border-zinc-300 transition-all duration-300"
              >
                <div>
                  <div className="aspect-[3/4] w-full bg-zinc-50/50 relative group overflow-hidden border-b border-zinc-200/80">
                    {item.coverImageUrl ? (
                      <img src={item.coverImageUrl} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" alt={item.name} />
                    ) : (
                      <div className="absolute inset-0 flex flex-col items-center justify-center text-zinc-450 bg-zinc-50/30 p-4 text-center">
                        <span className="material-symbols-outlined text-[48px] text-[#df0000] mb-2">picture_as_pdf</span>
                        <span className="text-xs font-bold text-zinc-800 truncate w-full">{item.name}</span>
                      </div>
                    )}
                    <div className="absolute top-3 right-3">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[9px] font-bold border uppercase tracking-wider ${
                        item.isActive ? 'bg-green-50 border-green-200 text-green-700' : 'bg-zinc-50 border-zinc-200 text-zinc-500'
                      }`}>
                        {item.isActive ? 'Aktif' : 'Pasif'}
                      </span>
                    </div>
                  </div>

                  <div className="p-5 space-y-1.5">
                    <h4 className="font-bold text-zinc-900 text-sm truncate" title={item.name}>{item.name}</h4>
                    {item.description && (
                      <p className="text-xs text-zinc-500 line-clamp-2 leading-relaxed">{item.description}</p>
                    )}
                    <div className="text-[10px] text-zinc-400 font-extrabold uppercase tracking-wider mt-3">
                      Sıra: {item.sortOrder}
                    </div>
                  </div>
                </div>

                <div className="bg-zinc-50/80 px-5 py-3.5 border-t border-zinc-150/60 flex items-center justify-between">
                  <a
                    href={item.pdfUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs font-bold text-zinc-650 hover:text-zinc-950 flex items-center gap-1.5 transition-colors"
                  >
                    <span className="material-symbols-outlined text-[16px]">visibility</span>
                    Dosyayı Aç
                  </a>
                  <div className="flex gap-2">
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
                </div>
              </div>
            ))}
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
                  <span className="material-symbols-outlined text-zinc-400">picture_as_pdf</span>
                  {editingItem ? 'Katalog Düzenle' : 'Katalog Ekle'}
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
                  label="Katalog Adı *"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Örn: 2026 Yaz Sezonu Kataloğu"
                  className="rounded-2xl focus:ring-[#df0000]/5 focus:border-[#df0000]"
                />
                
                <div className="space-y-1.5">
                  <label className="block text-[11px] font-extrabold tracking-wider text-zinc-400 uppercase">Kapak Görseli URL</label>
                  <div className="flex gap-2">
                    <Input
                      value={coverImageUrl}
                      onChange={(e) => setCoverImageUrl(e.target.value)}
                      placeholder="Medya kütüphanesinden kapak görseli seçin"
                      className="rounded-2xl focus:ring-[#df0000]/5 focus:border-[#df0000]"
                    />
                    <Button 
                      variant="outline" 
                      onClick={() => openMediaPicker('cover')}
                      className="rounded-2xl hover:bg-zinc-50 active:scale-[0.98] transition-all px-4 h-11 shrink-0"
                    >
                      Seç
                    </Button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-[11px] font-extrabold tracking-wider text-zinc-400 uppercase">PDF Dosya Linki (URL) *</label>
                  <div className="flex gap-2">
                    <Input
                      value={pdfUrl}
                      onChange={(e) => setPdfUrl(e.target.value)}
                      placeholder="Medya kütüphanesinden PDF dosyasını seçin veya girin"
                      className="rounded-2xl focus:ring-[#df0000]/5 focus:border-[#df0000]"
                    />
                    <Button 
                      variant="outline" 
                      onClick={() => openMediaPicker('pdf')}
                      className="rounded-2xl hover:bg-zinc-50 active:scale-[0.98] transition-all px-4 h-11 shrink-0"
                    >
                      Seç
                    </Button>
                  </div>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-[11px] font-extrabold tracking-wider text-zinc-400 uppercase">Açıklama</label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className="w-full min-h-[80px] p-4 text-xs font-semibold text-zinc-700 bg-white border border-zinc-200 rounded-2xl outline-none focus:ring-4 focus:ring-[#df0000]/5 focus:border-[#df0000] transition-all duration-200"
                    placeholder="Katalog hakkında kısa bir tanıtım..."
                  />
                </div>

                <div className="grid gap-4 grid-cols-2">
                  <Input
                    label="Görüntüleme Sırası"
                    type="number"
                    value={sortOrder}
                    onChange={(e) => setSortOrder(e.target.value)}
                    className="rounded-2xl focus:ring-[#df0000]/5 focus:border-[#df0000]"
                  />
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
