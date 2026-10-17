import { useEffect, useMemo, useRef, useState } from 'react'
import { AdminLayout } from '../components/admin/AdminLayout'
import { getAdminToken } from '../lib/api'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { useToast } from '../components/ui/ToastContext'
import { useConfirm } from '../components/ui/ConfirmContext'

type MediaItem = {
  id: string
  name: string
  url: string
  type: string
  size: number
  uploadedAt: string
  folder: string
}

export function AdminMediaPage() {
  const { showToast, dismissToast } = useToast()
  const confirm = useConfirm()
  const [mediaItems, setMediaItems] = useState<MediaItem[]>([])
  const [loading, setLoading] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedFolder, setSelectedFolder] = useState('Genel')
  const [uploading, setUploading] = useState(false)
  const [isDragOver, setIsDragOver] = useState(false)
  const [previewItem, setPreviewItem] = useState<MediaItem | null>(null)
  const [renameItem, setRenameItem] = useState<MediaItem | null>(null)
  const [newNameVal, setNewNameVal] = useState('')
  
  const fileInputRef = useRef<HTMLInputElement>(null)

  const folders = ['Genel', 'Slider', 'Banners', 'Ürünler', 'PDF Dokümanları']

  const authHeader = useMemo(() => {
    const token = getAdminToken()
    return token ? { Authorization: `Bearer ${token}` } : null
  }, [])

  const fetchMedia = async () => {
    if (!authHeader) return
    setLoading(true)
    try {
      const response = await fetch('/api/admin/media', {
        headers: authHeader,
      })
      const res = await response.json()
      if (res.success) {
        setMediaItems(res.data || [])
      } else {
        showToast(res.message || 'Medyalar yüklenemedi', 'error')
      }
    } catch (e) {
      showToast('Bağlantı hatası oluştu', 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchMedia()
  }, [authHeader])

  const handleUpload = async (files: FileList) => {
    if (files.length === 0 || !authHeader) return
    setUploading(true)
    const toastId = showToast('Dosya yükleniyor...', 'loading', 0)
    try {
      const formData = new FormData()
      formData.append('file', files[0])
      formData.append('folder', selectedFolder)

      const response = await fetch('/api/admin/media', {
        method: 'POST',
        headers: authHeader,
        body: formData,
      })
      const res = await response.json()
      if (res.success) {
        setMediaItems((prev) => [res.data, ...prev])
        showToast('Dosya başarıyla yüklendi.', 'success')
      } else {
        showToast(res.message || 'Yükleme başarısız', 'error')
      }
    } catch (e) {
      showToast('Bağlantı hatası', 'error')
    } finally {
      setUploading(false)
      dismissToast(toastId)
      fetchMedia()
    }
  }

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!authHeader) return
    const ok = await confirm('Bu medyayı kalıcı olarak silmek istediğinizden emin misiniz?', { type: 'danger', confirmText: 'Evet, Sil', title: 'Medyayı Sil' })
    if (!ok) return

    try {
      const response = await fetch(`/api/admin/media/${id}`, {
        method: 'DELETE',
        headers: authHeader,
      })
      const res = await response.json()
      if (res.success) {
        setMediaItems((prev) => prev.filter((item) => item.id !== id))
        if (previewItem?.id === id) {
          setPreviewItem(null)
        }
        showToast('Medya silindi.', 'success')
      } else {
        showToast(res.message || 'Silme işlemi başarısız', 'error')
      }
    } catch (e) {
      showToast('Bağlantı hatası', 'error')
    }
  }

  const handleRename = (item: MediaItem) => {
    setRenameItem(item)
    setNewNameVal(item.name)
  }

  const submitRename = async () => {
    if (!renameItem) return
    const trimmed = newNameVal.trim()
    if (!trimmed) {
      showToast('Dosya adı boş olamaz.', 'error')
      return
    }

    if (!authHeader) return
    try {
      const response = await fetch(`/api/admin/media/${renameItem.id}/rename`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeader,
        },
        body: JSON.stringify({ name: trimmed }),
      })
      const res = await response.json()
      if (res.success) {
        setMediaItems((prev) =>
          prev.map((m) => (m.id === renameItem.id ? { ...m, name: trimmed } : m))
        )
        setPreviewItem((prev) =>
          prev && prev.id === renameItem.id ? { ...prev, name: trimmed } : prev
        )
        showToast('Dosya adı güncellendi.', 'success')
        setRenameItem(null)
      } else {
        showToast(res.message || 'İsim değiştirilemedi.', 'error')
      }
    } catch (e) {
      showToast('Bağlantı hatası', 'error')
    }
  }

  const handleCopyLink = (url: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const absoluteUrl = window.location.origin + url
    navigator.clipboard.writeText(absoluteUrl)
    showToast('Bağlantı panoya kopyalandı.', 'success')
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(true)
  }

  const handleDragLeave = () => {
    setIsDragOver(false)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
    if (e.dataTransfer.files) {
      handleUpload(e.dataTransfer.files)
    }
  }

  const filteredItems = useMemo(() => {
    return mediaItems.filter((item) => {
      const matchesSearch = item.name.toLowerCase().includes(searchTerm.toLowerCase())
      const matchesFolder = item.folder === selectedFolder
      return matchesSearch && matchesFolder
    })
  }, [mediaItems, selectedFolder, searchTerm])

  const formatSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes'
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  return (
    <AdminLayout
      title="Medya Kütüphanesi"
      subtitle="E-ticaret sitenizde yer alan slider, banner, ürün görselleri ve PDF kılavuzları organize edin."
    >
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Main media files explorer */}
        <div className="lg:col-span-3 space-y-6">
          {/* Top filter control bar */}
          <div className="flex flex-col sm:flex-row gap-4 items-center justify-between bg-white p-5 border border-zinc-200/80 rounded-3xl shadow-[0_2px_8px_rgba(0,0,0,0.02)]">
            {/* Folders navigation */}
            <div className="flex border-b border-zinc-200 w-full sm:w-auto overflow-x-auto">
              {folders.map((f) => (
                <button
                  key={f}
                  onClick={() => {
                    setSelectedFolder(f)
                    setPreviewItem(null)
                  }}
                  className={`px-4 py-3 text-xs font-bold uppercase transition-all border-b-2 whitespace-nowrap -mb-[2px] ${
                    selectedFolder === f
                      ? 'border-[#df0000] text-[#df0000]'
                      : 'border-transparent text-zinc-555 hover:text-zinc-950'
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-3 w-full sm:w-auto">
              <Input
                placeholder="Görsel veya PDF ara..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                icon="search"
                className="max-w-xs w-full rounded-2xl focus:ring-[#df0000]/5 focus:border-[#df0000]"
              />
              <Button
                variant="primary"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                icon="upload"
                className="rounded-2xl bg-[#df0000] hover:bg-[#c00000] active:scale-[0.98] transition-all shrink-0"
              >
                Dosya Yükle
              </Button>
              <input
                type="file"
                ref={fileInputRef}
                onChange={(e) => e.target.files && handleUpload(e.target.files)}
                accept="image/*,application/pdf"
                className="hidden"
              />
            </div>
          </div>

          {/* Explorer window container */}
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`min-h-[500px] border-2 border-dashed rounded-3xl p-6 transition-all duration-200 bg-white relative flex flex-col justify-between ${
              isDragOver ? 'border-[#df0000] bg-[#df0000]/5' : 'border-zinc-200/80'
            }`}
          >
            {isDragOver ? (
              <div className="flex-1 flex flex-col items-center justify-center pointer-events-none select-none text-[#df0000] py-24">
                <span className="material-symbols-outlined text-[64px] animate-bounce">cloud_upload</span>
                <p className="text-sm font-extrabold mt-2">Yüklemek için dosyayı buraya bırakın</p>
              </div>
            ) : loading ? (
              <div className="flex-1 flex flex-col items-center justify-center text-zinc-400 py-24">
                <div className="w-10 h-10 border-4 border-zinc-250 border-t-[#df0000] rounded-full animate-spin mb-3" />
                <p className="text-xs font-semibold">Dosyalar listeleniyor...</p>
              </div>
            ) : filteredItems.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-zinc-400 select-none py-24 text-center">
                <div className="w-16 h-16 bg-zinc-50 rounded-full flex items-center justify-center mb-4 border border-zinc-100">
                  <span className="material-symbols-outlined text-[32px] text-zinc-400">image</span>
                </div>
                <h4 className="text-sm font-bold text-zinc-805">Bu Klasör Boş</h4>
                <p className="text-xs text-zinc-500 mt-2 max-w-xs mx-auto">Sürükle-bırak yaparak veya "Dosya Yükle" butonu yardımıyla bu klasöre dosya ekleyin.</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 gap-4">
                {filteredItems.map((item) => {
                  const isPdf = item.type === 'application/pdf' || item.url.endsWith('.pdf')
                  const isSelected = previewItem?.id === item.id

                  return (
                    <div
                      key={item.id}
                      onClick={() => setPreviewItem(item)}
                      className={`group relative border rounded-2xl overflow-hidden cursor-pointer transition-all duration-200 bg-white ${
                        isSelected
                          ? 'border-[#df0000] ring-4 ring-[#df0000]/5 shadow-md'
                          : 'border-zinc-200/80 hover:border-zinc-350 hover:shadow-sm'
                      }`}
                    >
                      {/* Thumbnail frame */}
                      <div className="aspect-square w-full bg-zinc-50/50 flex items-center justify-center overflow-hidden relative">
                        {isPdf ? (
                          <div className="flex flex-col items-center justify-center text-zinc-400 p-2">
                            <span className="material-symbols-outlined text-[38px] text-rose-500">picture_as_pdf</span>
                            <span className="text-[9px] font-extrabold text-zinc-400 uppercase tracking-wider mt-1.5">PDF</span>
                          </div>
                        ) : (
                          <img
                            src={item.url}
                            alt={item.name}
                            loading="lazy"
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                          />
                        )}
                      </div>

                      {/* Info footer */}
                      <div className="p-3 border-t border-zinc-150/60 bg-white">
                        <p className="text-xs font-bold text-zinc-850 truncate" title={item.name}>
                          {item.name}
                        </p>
                        <p className="text-[10px] text-zinc-400 font-bold font-mono mt-0.5">
                          {formatSize(item.size)}
                        </p>
                      </div>

                      {/* Fast Action Hover Toolbar */}
                      <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity duration-150 flex gap-1 z-10">
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            handleRename(item)
                          }}
                          className="bg-white text-zinc-700 hover:text-zinc-950 p-1.5 rounded-xl shadow-md flex items-center justify-center border border-zinc-200/80 active:scale-95 transition-all"
                          title="Yeniden Adlandır"
                        >
                          <span className="material-symbols-outlined text-[15px]">edit</span>
                        </button>
                        <button
                          onClick={(e) => handleCopyLink(item.url, e)}
                          className="bg-white text-zinc-700 hover:text-zinc-950 p-1.5 rounded-xl shadow-md flex items-center justify-center border border-zinc-200/80 active:scale-95 transition-all"
                          title="Linki Kopyala"
                        >
                          <span className="material-symbols-outlined text-[15px]">link</span>
                        </button>
                        <button
                          onClick={(e) => handleDelete(item.id, e)}
                          className="bg-rose-650 text-white p-1.5 rounded-xl hover:bg-rose-700 shadow-md flex items-center justify-center active:scale-95 transition-all"
                          title="Sil"
                        >
                          <span className="material-symbols-outlined text-[15px]">delete</span>
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* Sidebar details panel */}
        <div className="lg:col-span-1">
          {previewItem ? (
            <div className="bg-white border border-zinc-200/80 rounded-3xl shadow-[0_2px_8px_rgba(0,0,0,0.02),0_8px_24px_rgba(0,0,0,0.02)] overflow-hidden sticky top-24">
              <div className="p-4.5 bg-zinc-50/80 border-b border-zinc-150 flex items-center justify-between">
                <h4 className="text-[10px] font-extrabold text-zinc-400 uppercase tracking-widest">Dosya Detayları</h4>
                <button
                  onClick={() => setPreviewItem(null)}
                  className="w-6 h-6 rounded-full hover:bg-zinc-150 text-zinc-500 flex items-center justify-center transition-colors"
                >
                  <span className="material-symbols-outlined text-[18px]">close</span>
                </button>
              </div>

              <div className="p-5 space-y-4">
                {/* Visual Preview */}
                <div className="aspect-video w-full rounded-2xl bg-zinc-50/50 border border-zinc-200/80 overflow-hidden flex items-center justify-center shadow-inner">
                  {previewItem.type === 'application/pdf' || previewItem.url.endsWith('.pdf') ? (
                    <div className="text-center p-4">
                      <span className="material-symbols-outlined text-[48px] text-rose-500 mb-1">picture_as_pdf</span>
                      <p className="text-xs font-bold text-zinc-800 truncate max-w-[180px]">{previewItem.name}</p>
                    </div>
                  ) : (
                    <img
                      src={previewItem.url}
                      className="w-full h-full object-contain"
                      alt={previewItem.name}
                    />
                  )}
                </div>

                <div className="space-y-3.5 text-xs border-b border-zinc-150 pb-4.5">
                  <div>
                    <span className="text-[10px] font-extrabold text-zinc-400 block uppercase tracking-wider mb-0.5">Dosya Adı</span>
                    <span className="font-semibold text-zinc-850 break-all">{previewItem.name}</span>
                  </div>
                  <div>
                    <span className="text-[10px] font-extrabold text-zinc-400 block uppercase tracking-wider mb-0.5">Klasör</span>
                    <span className="inline-flex px-2 py-0.5 rounded-lg text-[10px] font-bold bg-[#df0000]/5 text-[#df0000] border border-[#df0000]/10 uppercase tracking-wider">{previewItem.folder}</span>
                  </div>
                  <div>
                    <span className="text-[10px] font-extrabold text-zinc-400 block uppercase tracking-wider mb-0.5">Dosya Boyutu</span>
                    <span className="font-mono text-zinc-850 font-bold">{formatSize(previewItem.size)}</span>
                  </div>
                  <div>
                    <span className="text-[10px] font-extrabold text-zinc-400 block uppercase tracking-wider mb-0.5">Yükleme Tarihi</span>
                    <span className="font-semibold text-zinc-805">
                      {new Date(previewItem.uploadedAt).toLocaleString('tr-TR')}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] font-extrabold text-zinc-400 block uppercase tracking-wider mb-1">Dosya Tipi</span>
                    <span className="font-bold text-zinc-600 font-mono text-[9px] bg-zinc-100 border border-zinc-200 px-2 py-0.5 rounded-lg">
                      {previewItem.type}
                    </span>
                  </div>
                </div>

                {/* Actions */}
                <div className="space-y-2 pt-2">
                  <button
                    type="button"
                    onClick={(e) => handleCopyLink(previewItem.url, e)}
                    className="flex w-full items-center justify-center gap-2 rounded-2xl bg-zinc-950 text-white font-bold py-3 text-xs hover:bg-zinc-800 transition active:scale-[0.98] shadow-sm"
                  >
                    <span className="material-symbols-outlined text-[16px]">link</span>
                    Bağlantıyı Kopyala
                  </button>
                  <a
                    href={previewItem.url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex w-full items-center justify-center gap-2 rounded-2xl border border-zinc-200/80 bg-white text-zinc-700 font-bold py-3 text-xs hover:bg-zinc-50 transition active:scale-[0.98] shadow-sm"
                  >
                    <span className="material-symbols-outlined text-[16px]">visibility</span>
                    Dosyayı Aç / İndir
                  </a>
                  <button
                    type="button"
                    onClick={() => handleRename(previewItem)}
                    className="flex w-full items-center justify-center gap-2 rounded-2xl border border-zinc-200/80 bg-white text-zinc-700 font-bold py-3 text-xs hover:bg-zinc-50 transition active:scale-[0.98] shadow-sm"
                  >
                    <span className="material-symbols-outlined text-[16px]">edit</span>
                    Dosya Adını Değiştir
                  </button>
                  <button
                    type="button"
                    onClick={(e) => handleDelete(previewItem.id, e)}
                    className="flex w-full items-center justify-center gap-2 rounded-2xl bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-100 font-bold py-3 text-xs transition active:scale-[0.98] shadow-sm"
                  >
                    <span className="material-symbols-outlined text-[16px]">delete</span>
                    Medyayı Kalıcı Olarak Sil
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-zinc-50 border-2 border-zinc-200/80 border-dashed p-8 rounded-3xl text-center text-zinc-400 sticky top-24 select-none">
              <span className="material-symbols-outlined text-[32px] mb-2 text-zinc-350">info</span>
              <p className="text-xs font-bold text-zinc-700">Seçim Yapılmadı</p>
              <p className="text-[11px] text-zinc-500 mt-2 leading-relaxed">Görsellerin detaylarını incelemek, bağlantılarını kopyalamak ve silmek için üzerlerine tıklayın.</p>
            </div>
          )}
        </div>
      </div>

      {/* Rename Modal */}
      {renameItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/45 backdrop-blur-[2px]">
          <div className="bg-white rounded-3xl max-w-md w-full border border-zinc-200/80 shadow-2xl p-6 overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center gap-3 mb-4 text-[#df0000]">
              <span className="material-symbols-outlined text-2xl">edit</span>
              <h3 className="text-base font-bold text-zinc-900">Dosya Adını Değiştir</h3>
            </div>
            <p className="text-xs text-zinc-550 mb-4 leading-relaxed">
              "{renameItem.name}" dosyasının ismini güncellemek için yeni bir ad girin:
            </p>
            
            <div className="space-y-4">
              <input
                type="text"
                value={newNameVal}
                onChange={(e) => setNewNameVal(e.target.value)}
                className="w-full h-10 px-4 border border-zinc-200 rounded-xl text-xs font-semibold text-zinc-700 bg-white outline-none focus:ring-4 focus:ring-[#df0000]/5 focus:border-[#df0000] transition-all"
                placeholder="Dosya Adı"
                required
              />
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setRenameItem(null)}
                className="h-10 rounded-xl border border-zinc-200 bg-white px-5 text-xs font-bold text-zinc-650 transition-all hover:bg-zinc-50 active:scale-[0.98]"
              >
                Vazgeç
              </button>
              <button
                type="button"
                onClick={submitRename}
                className="h-10 rounded-xl bg-[#df0000] hover:bg-[#c00000] px-5 text-xs font-bold text-white transition-all active:scale-[0.98]"
              >
                Kaydet
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  )
}
