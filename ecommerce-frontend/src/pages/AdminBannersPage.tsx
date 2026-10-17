import { useEffect, useState } from 'react'
import { AdminLayout } from '../components/admin/AdminLayout'
import { getAdminToken, readApiResponse } from '../lib/api'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { MediaLibraryModal } from '../components/ui/MediaLibraryModal'
import { useToast } from '../components/ui/ToastContext'

type StoreDesign = {
  topBannerUrl: string
  topBannerLink: string
  middleBannerUrl: string
  middleBannerLink: string
  bottomBannerUrl: string
  bottomBannerLink: string
  [key: string]: any
}

export function AdminBannersPage() {
  const { showToast } = useToast()
  const [design, setDesign] = useState<StoreDesign>({
    topBannerUrl: '',
    topBannerLink: '',
    middleBannerUrl: '',
    middleBannerLink: '',
    bottomBannerUrl: '',
    bottomBannerLink: '',
  })
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  // Media Picker state
  const [mediaPickerOpen, setMediaPickerOpen] = useState(false)
  const [activePickerTarget, setActivePickerTarget] = useState<string | null>(null)

  const fetchDesign = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/store-design')
      const json = await readApiResponse(res)
      if (res.ok && json?.data) {
        setDesign({
          ...json.data,
          topBannerUrl: json.data.topBannerUrl || '',
          topBannerLink: json.data.topBannerLink || '',
          middleBannerUrl: json.data.middleBannerUrl || '',
          middleBannerLink: json.data.middleBannerLink || '',
          bottomBannerUrl: json.data.bottomBannerUrl || '',
          bottomBannerLink: json.data.bottomBannerLink || '',
        })
      }
    } catch (err) {
      showToast('Banner ayarları yüklenemedi.', 'error')
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
      showToast('Banner ayarları başarıyla kaydedildi.', 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Kaydedilemedi', 'error')
    } finally {
      setSaving(false)
    }
  }

  const openMediaPicker = (targetKey: string) => {
    setActivePickerTarget(targetKey)
    setMediaPickerOpen(true)
  }

  const handleMediaSelect = (url: string) => {
    if (activePickerTarget) {
      setDesign((prev) => ({ ...prev, [activePickerTarget]: url }))
    }
    setMediaPickerOpen(false)
    setActivePickerTarget(null)
    showToast('Görsel kütüphaneden seçildi.', 'success')
  }

  return (
    <AdminLayout
      title="Banner Yönetimi"
      subtitle="E-ticaret ana sayfasındaki reklam ve kampanya banner görsel/link yerleşimlerini düzenleyin."
    >
      {loading ? (
        <div className="flex flex-col items-center justify-center py-24 bg-white rounded-3xl border border-zinc-200/80 shadow-[0_2px_8px_rgba(0,0,0,0.02)]">
          <div className="w-10 h-10 border-4 border-zinc-200 border-t-[#df0000] rounded-full animate-spin mb-3" />
          <span className="text-sm text-zinc-400 font-medium">Banner ayarları yükleniyor...</span>
        </div>
      ) : (
        <div className="space-y-6 max-w-4xl">
          {/* Top Banner */}
          <div className="border border-zinc-200/80 rounded-3xl bg-white p-6 shadow-[0_2px_8px_rgba(0,0,0,0.02),0_8px_24px_rgba(0,0,0,0.02)] space-y-5 transition-all duration-300 hover:shadow-md hover:border-zinc-300/80">
            <div className="flex items-center gap-2.5 text-zinc-800 font-bold border-b border-zinc-150 pb-3">
              <span className="material-symbols-outlined text-[#df0000] text-[20px]">view_carousel</span>
              <span className="text-sm">Üst Banner Alanı (Ana Sayfa Başı)</span>
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
              <div className="space-y-2">
                <label className="block text-[11px] font-extrabold tracking-wider text-zinc-400 uppercase">Banner Görseli</label>
                <div className="flex gap-2">
                  <Input
                    value={design.topBannerUrl}
                    onChange={(e) => setDesign((prev) => ({ ...prev, topBannerUrl: e.target.value }))}
                    placeholder="Görsel URL veya kütüphaneden seçin"
                    className="rounded-2xl focus:ring-[#df0000]/5 focus:border-[#df0000]"
                  />
                  <Button 
                    variant="outline" 
                    onClick={() => openMediaPicker('topBannerUrl')}
                    className="rounded-2xl hover:bg-zinc-50 active:scale-[0.98] transition-all px-4"
                  >
                    Seç
                  </Button>
                </div>
              </div>
              <div className="space-y-2">
                <label className="block text-[11px] font-extrabold tracking-wider text-zinc-400 uppercase">Yönlendirme Linki</label>
                <Input
                  value={design.topBannerLink}
                  onChange={(e) => setDesign((prev) => ({ ...prev, topBannerLink: e.target.value }))}
                  placeholder="Tıklayınca yönlendirilecek adres (örn: /kampanya-detay)"
                  className="rounded-2xl focus:ring-[#df0000]/5 focus:border-[#df0000]"
                />
              </div>
            </div>
            {design.topBannerUrl && (
              <div className="aspect-[4/1] w-full rounded-2xl overflow-hidden border border-zinc-200 bg-zinc-50 max-h-[120px] shadow-sm">
                <img src={design.topBannerUrl} className="w-full h-full object-cover" alt="Üst Banner Önizleme" />
              </div>
            )}
          </div>

          {/* Middle Banner */}
          <div className="border border-zinc-200/80 rounded-3xl bg-white p-6 shadow-[0_2px_8px_rgba(0,0,0,0.02),0_8px_24px_rgba(0,0,0,0.02)] space-y-5 transition-all duration-300 hover:shadow-md hover:border-zinc-300/80">
            <div className="flex items-center gap-2.5 text-zinc-800 font-bold border-b border-zinc-150 pb-3">
              <span className="material-symbols-outlined text-[#df0000] text-[20px]">view_stream</span>
              <span className="text-sm">Orta Geniş Banner Alanı (Kategori Listesi Altı)</span>
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
              <div className="space-y-2">
                <label className="block text-[11px] font-extrabold tracking-wider text-zinc-400 uppercase">Banner Görseli</label>
                <div className="flex gap-2">
                  <Input
                    value={design.middleBannerUrl}
                    onChange={(e) => setDesign((prev) => ({ ...prev, middleBannerUrl: e.target.value }))}
                    placeholder="Görsel URL veya kütüphaneden seçin"
                    className="rounded-2xl focus:ring-[#df0000]/5 focus:border-[#df0000]"
                  />
                  <Button 
                    variant="outline" 
                    onClick={() => openMediaPicker('middleBannerUrl')}
                    className="rounded-2xl hover:bg-zinc-50 active:scale-[0.98] transition-all px-4"
                  >
                    Seç
                  </Button>
                </div>
              </div>
              <div className="space-y-2">
                <label className="block text-[11px] font-extrabold tracking-wider text-zinc-400 uppercase">Yönlendirme Linki</label>
                <Input
                  value={design.middleBannerLink}
                  onChange={(e) => setDesign((prev) => ({ ...prev, middleBannerLink: e.target.value }))}
                  placeholder="Tıklayınca yönlendirilecek adres"
                  className="rounded-2xl focus:ring-[#df0000]/5 focus:border-[#df0000]"
                />
              </div>
            </div>
            {design.middleBannerUrl && (
              <div className="aspect-[5/1] w-full rounded-2xl overflow-hidden border border-zinc-200 bg-zinc-50 max-h-[100px] shadow-sm">
                <img src={design.middleBannerUrl} className="w-full h-full object-cover" alt="Orta Banner Önizleme" />
              </div>
            )}
          </div>

          {/* Bottom Banner */}
          <div className="border border-zinc-200/80 rounded-3xl bg-white p-6 shadow-[0_2px_8px_rgba(0,0,0,0.02),0_8px_24px_rgba(0,0,0,0.02)] space-y-5 transition-all duration-300 hover:shadow-md hover:border-zinc-300/80">
            <div className="flex items-center gap-2.5 text-zinc-800 font-bold border-b border-zinc-150 pb-3">
              <span className="material-symbols-outlined text-[#df0000] text-[20px]">view_day</span>
              <span className="text-sm">Alt Promosyon Banner Alanı (Footer Üstü)</span>
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
              <div className="space-y-2">
                <label className="block text-[11px] font-extrabold tracking-wider text-zinc-400 uppercase">Banner Görseli</label>
                <div className="flex gap-2">
                  <Input
                    value={design.bottomBannerUrl}
                    onChange={(e) => setDesign((prev) => ({ ...prev, bottomBannerUrl: e.target.value }))}
                    placeholder="Görsel URL veya kütüphaneden seçin"
                    className="rounded-2xl focus:ring-[#df0000]/5 focus:border-[#df0000]"
                  />
                  <Button 
                    variant="outline" 
                    onClick={() => openMediaPicker('bottomBannerUrl')}
                    className="rounded-2xl hover:bg-zinc-50 active:scale-[0.98] transition-all px-4"
                  >
                    Seç
                  </Button>
                </div>
              </div>
              <div className="space-y-2">
                <label className="block text-[11px] font-extrabold tracking-wider text-zinc-400 uppercase">Yönlendirme Linki</label>
                <Input
                  value={design.bottomBannerLink}
                  onChange={(e) => setDesign((prev) => ({ ...prev, bottomBannerLink: e.target.value }))}
                  placeholder="Tıklayınca yönlendirilecek adres"
                  className="rounded-2xl focus:ring-[#df0000]/5 focus:border-[#df0000]"
                />
              </div>
            </div>
            {design.bottomBannerUrl && (
              <div className="aspect-[6/1] w-full rounded-2xl overflow-hidden border border-zinc-200 bg-zinc-50 max-h-[90px] shadow-sm">
                <img src={design.bottomBannerUrl} className="w-full h-full object-cover" alt="Alt Banner Önizleme" />
              </div>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex justify-end gap-3 bg-zinc-50 border border-zinc-200/80 rounded-3xl p-5">
            <Button 
              variant="primary" 
              loading={saving} 
              onClick={save}
              className="rounded-2xl bg-[#df0000] hover:bg-[#c00000] active:scale-[0.98] transition-all px-6 py-3"
            >
              Değişiklikleri Kaydet
            </Button>
          </div>
        </div>
      )}

      <MediaLibraryModal
        isOpen={mediaPickerOpen}
        onClose={() => setMediaPickerOpen(false)}
        onSelect={handleMediaSelect}
        activeFolder="Banners"
      />
    </AdminLayout>
  )
}
