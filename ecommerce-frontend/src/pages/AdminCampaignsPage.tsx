import { useEffect, useState } from 'react'
import { AdminLayout } from '../components/admin/AdminLayout'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { MediaLibraryModal } from '../components/ui/MediaLibraryModal'
import { getAdminToken, readApiResponse } from '../lib/api'
import { useToast } from '../components/ui/ToastContext'
import { useConfirm } from '../components/ui/ConfirmContext'

type CampaignItem = {
  id: string
  imageUrl: string
  title: string
  link: string
  colSpan: string
}

type StoreDesign = {
  campaigns: CampaignItem[]
  [key: string]: any
}

export function AdminCampaignsPage() {
  const { showToast } = useToast()
  const confirm = useConfirm()
  const [design, setDesign] = useState<StoreDesign>({ campaigns: [] })
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
          campaigns: json.data.campaigns || [],
        })
      }
    } catch (err) {
      showToast('Kampanya ayarları yüklenemedi.', 'error')
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
      const res = await fetch('/api/store-design', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${getAdminToken()}`,
        },
        body: JSON.stringify(design),
      })
      const json = await readApiResponse(res)
      if (!res.ok || !json?.success) throw new Error(json?.message || 'Kaydedilemedi')
      showToast('Kampanyalar başarıyla kaydedildi.', 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Kaydedilemedi', 'error')
    } finally {
      setSaving(false)
    }
  }

  const addCampaign = () => {
    const newCamp: CampaignItem = {
      id: Math.random().toString(36).substring(2, 9),
      imageUrl: '',
      title: 'Yeni Kampanya Görseli',
      link: '#',
      colSpan: '1',
    }
    setDesign((prev) => ({
      ...prev,
      campaigns: [...prev.campaigns, newCamp],
    }))
  }

  const removeCampaign = async (idx: number) => {
    const ok = await confirm('Bu kampanyayı silmek istediğinizden emin misiniz?', { type: 'danger', confirmText: 'Evet, Sil', title: 'Kampanyayı Sil' })
    if (!ok) return
    setDesign((prev) => {
      const next = prev.campaigns.filter((_, i) => i !== idx)
      return { ...prev, campaigns: next }
    })
  }

  const updateCampaignField = (idx: number, field: keyof CampaignItem, value: string) => {
    setDesign((prev) => {
      const next = [...prev.campaigns]
      next[idx] = {
        ...next[idx],
        [field]: value,
      }
      return { ...prev, campaigns: next }
    })
  }

  const openMediaPicker = (idx: number) => {
    setActivePickerIdx(idx)
    setMediaPickerOpen(true)
  }

  const handleMediaSelect = (url: string) => {
    if (activePickerIdx !== null) {
      updateCampaignField(activePickerIdx, 'imageUrl', url)
    }
    setMediaPickerOpen(false)
    setActivePickerIdx(null)
    showToast('Görsel kütüphaneden seçildi.', 'success')
  }

  const moveUp = (idx: number) => {
    if (idx === 0) return
    setDesign((prev) => {
      const list = [...prev.campaigns]
      const temp = list[idx]
      list[idx] = list[idx - 1]
      list[idx - 1] = temp
      return { ...prev, campaigns: list }
    })
  }

  const moveDown = (idx: number) => {
    if (idx === design.campaigns.length - 1) return
    setDesign((prev) => {
      const list = [...prev.campaigns]
      const temp = list[idx]
      list[idx] = list[idx + 1]
      list[idx + 1] = temp
      return { ...prev, campaigns: list }
    })
  }

  return (
    <AdminLayout
      title="Ana Sayfa Kampanyaları"
      subtitle="E-ticaret ana sayfasındaki bento grid/kutu kampanya yerleşimlerini yönetin."
    >
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4 bg-white p-5 border border-zinc-200/80 rounded-3xl shadow-[0_2px_8px_rgba(0,0,0,0.02),0_8px_20px_rgba(0,0,0,0.01)]">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center justify-center px-3 py-1 rounded-full text-xs font-bold bg-[#df0000]/5 text-[#df0000] border border-[#df0000]/10">
              Aktif Kampanyalar: {design.campaigns.length}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <Button 
              variant="outline" 
              onClick={addCampaign} 
              icon="add"
              className="rounded-2xl hover:bg-zinc-50 active:scale-[0.98] transition-all"
            >
              Yeni Kampanya Ekle
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
            <span className="text-sm text-zinc-400 font-medium">Kampanyalar yükleniyor...</span>
          </div>
        ) : design.campaigns.length === 0 ? (
          <div className="bg-white rounded-3xl border border-zinc-200/80 p-16 text-center shadow-[0_2px_8px_rgba(0,0,0,0.02)]">
            <div className="w-16 h-16 bg-zinc-50 rounded-full flex items-center justify-center mx-auto mb-4 border border-zinc-100">
              <span className="material-symbols-outlined text-[32px] text-zinc-400">campaign</span>
            </div>
            <h4 className="text-base font-bold text-zinc-850">Henüz Kampanya Bulunmuyor</h4>
            <p className="text-xs text-zinc-500 mt-2 max-w-sm mx-auto">
              Ana sayfanızda bento grid kutu şeklinde reklam veya kampanyaları listelemek için "Yeni Kampanya Ekle" butonuna basarak ilkini oluşturun.
            </p>
          </div>
        ) : (
          <div className="grid gap-6 md:grid-cols-2">
            {design.campaigns.map((camp, idx) => (
              <div
                key={camp.id}
                className="border border-zinc-200/80 rounded-3xl bg-white shadow-[0_2px_8px_rgba(0,0,0,0.02),0_8px_24px_rgba(0,0,0,0.02)] overflow-hidden flex flex-col justify-between hover:shadow-md hover:border-zinc-300/80 transition-all duration-300"
              >
                {/* Image Preview / Picker */}
                <div className="aspect-[16/7] w-full bg-zinc-50 relative group overflow-hidden border-b border-zinc-200/80">
                  {camp.imageUrl ? (
                    <img src={camp.imageUrl} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" alt="" />
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
                      Kampanya #{idx + 1}
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
                        disabled={idx === design.campaigns.length - 1}
                        className="w-8 h-8 rounded-full border border-zinc-200/80 text-zinc-500 hover:text-zinc-950 hover:bg-zinc-50 transition-all flex items-center justify-center disabled:opacity-30 disabled:hover:bg-transparent"
                        title="Aşağı Taşı"
                      >
                        <span className="material-symbols-outlined text-[18px]">arrow_downward</span>
                      </button>
                      <div className="w-px h-5 bg-zinc-200 mx-1" />
                      <button
                        type="button"
                        onClick={() => removeCampaign(idx)}
                        className="w-8 h-8 rounded-full border border-zinc-200/80 text-zinc-400 hover:text-rose-600 hover:border-rose-200 hover:bg-rose-50/50 transition-all flex items-center justify-center"
                        title="Sil"
                      >
                        <span className="material-symbols-outlined text-[18px]">delete</span>
                      </button>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <Input
                      label="Kampanya Başlığı"
                      value={camp.title}
                      onChange={(e) => updateCampaignField(idx, 'title', e.target.value)}
                      placeholder="Örn: Küçük Ev Aletlerinde Sezon Fırsatları"
                      className="rounded-2xl focus:ring-[#df0000]/5 focus:border-[#df0000]"
                    />
                    <Input
                      label="Yönlendirme Linki (Tıklama Hedefi)"
                      value={camp.link}
                      onChange={(e) => updateCampaignField(idx, 'link', e.target.value)}
                      placeholder="Örn: /category/mutfak or /products/..."
                      className="rounded-2xl focus:ring-[#df0000]/5 focus:border-[#df0000]"
                    />

                    <div>
                      <label className="block text-[11px] font-extrabold tracking-wider text-zinc-400 uppercase mb-2">Genişlik Oranı (Bento Grid)</label>
                      <div className="relative">
                        <select
                          value={camp.colSpan}
                          onChange={(e) => updateCampaignField(idx, 'colSpan', e.target.value)}
                          className="w-full h-11 pl-4 pr-10 border border-zinc-200 rounded-2xl text-xs font-semibold text-zinc-700 bg-white outline-none focus:ring-4 focus:ring-[#df0000]/5 focus:border-[#df0000] appearance-none transition-all duration-200"
                        >
                          <option value="1">1 Sütun Genişliği (1x - Standart)</option>
                          <option value="2">2 Sütun Genişliği (2x - Geniş Görünüm)</option>
                        </select>
                        <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-zinc-400 flex items-center">
                          <span className="material-symbols-outlined text-[18px]">unfold_more</span>
                        </div>
                      </div>
                    </div>
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
        activeFolder="Banners"
      />
    </AdminLayout>
  )
}
