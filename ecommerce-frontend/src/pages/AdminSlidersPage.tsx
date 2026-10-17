import { useEffect, useState } from 'react'
import { AdminLayout } from '../components/admin/AdminLayout'
import { getAdminToken, readApiResponse } from '../lib/api'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { MediaLibraryModal } from '../components/ui/MediaLibraryModal'
import { useToast } from '../components/ui/ToastContext'
import { useConfirm } from '../components/ui/ConfirmContext'

type SliderItem = {
  id: string
  imageUrl: string
  title: string
  subtitle: string
  link: string
  order: number
}

type StoreDesign = {
  sliders: SliderItem[]
  [key: string]: any
}

export function AdminSlidersPage() {
  const { showToast } = useToast()
  const confirm = useConfirm()
  const [design, setDesign] = useState<StoreDesign>({ sliders: [] })
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  
  // Media Picker state
  const [mediaPickerOpen, setMediaPickerOpen] = useState(false)
  const [activePickerIdx, setActivePickerIdx] = useState<number | null>(null)

  const fetchDesign = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/store-design')
      const json = await readApiResponse(res)
      if (res.ok && json?.data) {
        setDesign({
          ...json.data,
          sliders: json.data.sliders || [],
        })
      }
    } catch (err) {
      showToast('Slayt ayarları yüklenemedi.', 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchDesign()
  }, [])

  const save = async () => {
    setSaving(true)
    try {
      // Re-assign correct orders before saving
      const sortedSliders = design.sliders.map((s, idx) => ({
        ...s,
        order: idx + 1,
      }))
      const updatedDesign = {
        ...design,
        sliders: sortedSliders,
      }
      
      const res = await fetch('/api/store-design', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${getAdminToken()}`,
        },
        body: JSON.stringify(updatedDesign),
      })
      const json = await readApiResponse(res)
      if (!res.ok || !json?.success) throw new Error(json?.message || 'Kaydedilemedi')
      setDesign(updatedDesign)
      showToast('Slider değişiklikleri başarıyla kaydedildi.', 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Kaydedilemedi', 'error')
    } finally {
      setSaving(false)
    }
  }

  const addSlider = () => {
    const newSlide: SliderItem = {
      id: Math.random().toString(36).substring(2, 9),
      imageUrl: '',
      title: 'Yeni Slayt Başlığı',
      subtitle: 'Slayt Alt Açıklaması',
      link: '#',
      order: design.sliders.length + 1,
    }
    setDesign((prev) => ({
      ...prev,
      sliders: [...prev.sliders, newSlide],
    }))
  }

  const removeSlider = async (idx: number) => {
    const ok = await confirm('Bu slaytı silmek istediğinizden emin misiniz?', { type: 'danger', confirmText: 'Evet, Sil', title: 'Slaytı Sil' })
    if (!ok) return
    setDesign((prev) => {
      const nextSliders = prev.sliders.filter((_, i) => i !== idx)
      return { ...prev, sliders: nextSliders }
    })
  }

  const updateSlideField = (idx: number, field: keyof SliderItem, value: any) => {
    setDesign((prev) => {
      const nextSliders = [...prev.sliders]
      nextSliders[idx] = {
        ...nextSliders[idx],
        [field]: value,
      }
      return { ...prev, sliders: nextSliders }
    })
  }

  const openMediaPicker = (idx: number) => {
    setActivePickerIdx(idx)
    setMediaPickerOpen(true)
  }

  const handleMediaSelect = (url: string) => {
    if (activePickerIdx !== null) {
      updateSlideField(activePickerIdx, 'imageUrl', url)
    }
    setMediaPickerOpen(false)
    setActivePickerIdx(null)
    showToast('Görsel kütüphaneden seçildi.', 'success')
  }

  const moveUp = (idx: number) => {
    if (idx === 0) return
    setDesign((prev) => {
      const list = [...prev.sliders]
      const temp = list[idx]
      list[idx] = list[idx - 1]
      list[idx - 1] = temp
      return { ...prev, sliders: list }
    })
  }

  const moveDown = (idx: number) => {
    if (idx === design.sliders.length - 1) return
    setDesign((prev) => {
      const list = [...prev.sliders]
      const temp = list[idx]
      list[idx] = list[idx + 1]
      list[idx + 1] = temp
      return { ...prev, sliders: list }
    })
  }

  return (
    <AdminLayout
      title="Slider Yönetimi"
      subtitle="E-ticaret ana sayfasındaki büyük kampanya slaytlarını ekleyin, sıralayın ve düzenleyin."
    >
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4 bg-white p-5 border border-zinc-200/80 rounded-3xl shadow-[0_2px_8px_rgba(0,0,0,0.02),0_8px_20px_rgba(0,0,0,0.01)]">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center justify-center px-3 py-1 rounded-full text-xs font-bold bg-[#df0000]/5 text-[#df0000] border border-[#df0000]/10">
              Aktif Slaytlar: {design.sliders.length}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <Button 
              variant="outline" 
              onClick={addSlider} 
              icon="add"
              className="rounded-2xl hover:bg-zinc-50 active:scale-[0.98] transition-all"
            >
              Yeni Slayt Ekle
            </Button>
            <Button 
              variant="primary" 
              loading={saving} 
              onClick={save} 
              icon="save"
              className="rounded-2xl bg-[#df0000] hover:bg-[#c00000] active:scale-[0.98] transition-all"
            >
              Kaydet
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center py-24 bg-white rounded-3xl border border-zinc-200/80 shadow-[0_2px_8px_rgba(0,0,0,0.02)]">
            <div className="w-10 h-10 border-4 border-zinc-200 border-t-[#df0000] rounded-full animate-spin mb-3" />
            <span className="text-sm text-zinc-400 font-medium">Slaytlar yükleniyor...</span>
          </div>
        ) : design.sliders.length === 0 ? (
          <div className="bg-white rounded-3xl border border-zinc-200/80 p-16 text-center shadow-[0_2px_8px_rgba(0,0,0,0.02)]">
            <div className="w-16 h-16 bg-zinc-50 rounded-full flex items-center justify-center mx-auto mb-4 border border-zinc-100">
              <span className="material-symbols-outlined text-[32px] text-zinc-400">slideshow</span>
            </div>
            <h4 className="text-base font-bold text-zinc-850">Henüz Slider Kampanyası Bulunmuyor</h4>
            <p className="text-xs text-zinc-500 mt-2 max-w-sm mx-auto">
              Ana sayfanızın en üstünde büyük bir slayt geçişi listelemek için "Yeni Slayt Ekle" butonuna basarak ilkini oluşturun.
            </p>
          </div>
        ) : (
          <div className="grid gap-6 md:grid-cols-2">
            {design.sliders.map((slide, idx) => (
              <div
                key={slide.id}
                className="border border-zinc-200/80 rounded-3xl bg-white shadow-[0_2px_8px_rgba(0,0,0,0.02),0_8px_24px_rgba(0,0,0,0.02)] overflow-hidden flex flex-col justify-between hover:shadow-md hover:border-zinc-300/80 transition-all duration-300"
              >
                {/* Image Preview / Picker */}
                <div className="aspect-[21/9] w-full bg-zinc-50 relative group overflow-hidden border-b border-zinc-200/80">
                  {slide.imageUrl ? (
                    <img src={slide.imageUrl} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" alt="" />
                  ) : (
                    <div className="absolute inset-0 flex flex-col items-center justify-center text-zinc-400 bg-zinc-50/50">
                      <span className="material-symbols-outlined text-[36px] text-zinc-300">image</span>
                      <span className="text-[11px] font-extrabold tracking-wider mt-2 text-zinc-400 uppercase">Görsel Seçilmemiş</span>
                    </div>
                  )}
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-center backdrop-blur-[2px]">
                    <Button 
                      variant="primary" 
                      size="sm" 
                      onClick={() => openMediaPicker(idx)}
                      className="rounded-xl bg-[#df0000] hover:bg-[#c00000] shadow-lg"
                    >
                      Görsel Seç
                    </Button>
                  </div>
                </div>

                <div className="p-6 space-y-5">
                  <div className="flex items-center justify-between">
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-[#df0000]/5 text-[#df0000] border border-[#df0000]/10 uppercase tracking-wider">
                      Slayt #{idx + 1}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => moveUp(idx)}
                        disabled={idx === 0}
                        className="w-8 h-8 rounded-full border border-zinc-200/80 text-zinc-500 hover:text-zinc-950 hover:bg-zinc-50 transition-all flex items-center justify-center disabled:opacity-30 disabled:hover:bg-transparent"
                        title="Yukarı Taşı"
                      >
                        <span className="material-symbols-outlined text-[18px]">arrow_upward</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => moveDown(idx)}
                        disabled={idx === design.sliders.length - 1}
                        className="w-8 h-8 rounded-full border border-zinc-200/80 text-zinc-500 hover:text-zinc-950 hover:bg-zinc-50 transition-all flex items-center justify-center disabled:opacity-30 disabled:hover:bg-transparent"
                        title="Aşağı Taşı"
                      >
                        <span className="material-symbols-outlined text-[18px]">arrow_downward</span>
                      </button>
                      <div className="w-px h-5 bg-zinc-200 mx-1" />
                      <button
                        type="button"
                        onClick={() => removeSlider(idx)}
                        className="w-8 h-8 rounded-full border border-zinc-200/80 text-zinc-400 hover:text-rose-600 hover:border-rose-200 hover:bg-rose-50/50 transition-all flex items-center justify-center"
                        title="Sil"
                      >
                        <span className="material-symbols-outlined text-[18px]">delete</span>
                      </button>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <Input
                      label="Slayt Başlığı"
                      value={slide.title}
                      onChange={(e) => updateSlideField(idx, 'title', e.target.value)}
                      placeholder="Örn: Stilsoft Anneler Günü Kampanyası"
                      className="rounded-2xl focus:ring-[#df0000]/5 focus:border-[#df0000]"
                    />
                    <Input
                      label="Slayt Alt Açıklaması"
                      value={slide.subtitle}
                      onChange={(e) => updateSlideField(idx, 'subtitle', e.target.value)}
                      placeholder="Örn: Seçili ürünlerde %30 indirim fırsatı başladı!"
                      className="rounded-2xl focus:ring-[#df0000]/5 focus:border-[#df0000]"
                    />
                    <Input
                      label="Yönlendirme Linki (Tıklama Hedefi)"
                      value={slide.link}
                      onChange={(e) => updateSlideField(idx, 'link', e.target.value)}
                      placeholder="Örn: /category/mutfak-robotlari veya /products/..."
                      className="rounded-2xl focus:ring-[#df0000]/5 focus:border-[#df0000]"
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="flex justify-end gap-3 bg-zinc-50 border border-zinc-200/80 rounded-3xl p-5">
          <Button 
            variant="primary" 
            loading={saving} 
            onClick={save} 
            icon="save"
            className="rounded-2xl bg-[#df0000] hover:bg-[#c00000] active:scale-[0.98] transition-all px-6 py-3"
          >
            Değişiklikleri Kaydet
          </Button>
        </div>
      </div>

      <MediaLibraryModal
        isOpen={mediaPickerOpen}
        onClose={() => setMediaPickerOpen(false)}
        onSelect={handleMediaSelect}
        activeFolder="Slider"
      />
    </AdminLayout>
  )
}
