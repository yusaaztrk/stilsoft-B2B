import { useEffect, useState } from 'react'
import { AdminLayout } from '../components/admin/AdminLayout'
import { getAdminToken, readApiResponse } from '../lib/api'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { MediaLibraryModal } from '../components/ui/MediaLibraryModal'
import { useToast } from '../components/ui/ToastContext'

type StoreDesign = {
  grid4WideUrl: string
  grid4WideLink: string
  grid4Vert1Url: string
  grid4Vert1Link: string
  grid4Vert2Url: string
  grid4Vert2Link: string
  grid4Vert3Url: string
  grid4Vert3Link: string
  [key: string]: any
}

export function AdminGridImagesPage() {
  const { showToast } = useToast()
  const [design, setDesign] = useState<StoreDesign>({
    grid4WideUrl: '',
    grid4WideLink: '',
    grid4Vert1Url: '',
    grid4Vert1Link: '',
    grid4Vert2Url: '',
    grid4Vert2Link: '',
    grid4Vert3Url: '',
    grid4Vert3Link: '',
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
          grid4WideUrl: json.data.grid4WideUrl || '',
          grid4WideLink: json.data.grid4WideLink || '',
          grid4Vert1Url: json.data.grid4Vert1Url || '',
          grid4Vert1Link: json.data.grid4Vert1Link || '',
          grid4Vert2Url: json.data.grid4Vert2Url || '',
          grid4Vert2Link: json.data.grid4Vert2Link || '',
          grid4Vert3Url: json.data.grid4Vert3Url || '',
          grid4Vert3Link: json.data.grid4Vert3Link || '',
        })
      }
    } catch (err) {
      showToast('Ayarlar yüklenemedi.', 'error')
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
      showToast('Görsel yerleşim ayarları başarıyla kaydedildi.', 'success')
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
      title="4'lü Görsel Yönetimi"
      subtitle="Ana sayfadaki 1 adet geniş üst görsel ve 3 adet dikey alt görsel yerleşimini düzenleyin."
    >
      {loading ? (
        <div className="flex flex-col items-center justify-center py-24 bg-white rounded-3xl border border-zinc-200/80 shadow-[0_2px_8px_rgba(0,0,0,0.02)]">
          <div className="w-10 h-10 border-4 border-zinc-200 border-t-[#df0000] rounded-full animate-spin mb-3" />
          <span className="text-sm text-zinc-400 font-medium">Ayarlar yükleniyor...</span>
        </div>
      ) : (
        <div className="space-y-6 max-w-4xl">
          {/* Top Wide Banner */}
          <div className="border border-zinc-200/80 rounded-3xl bg-white p-6 shadow-[0_2px_8px_rgba(0,0,0,0.02),0_8px_24px_rgba(0,0,0,0.02)] space-y-5 transition-all duration-300 hover:shadow-md hover:border-zinc-300/80">
            <div className="flex items-center gap-2.5 text-zinc-800 font-bold border-b border-zinc-150 pb-3">
              <span className="material-symbols-outlined text-[#df0000] text-[20px]">view_stream</span>
              <span className="text-sm">Geniş Üst Görsel (1. Satır)</span>
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
              <div className="space-y-2">
                <label className="block text-[11px] font-extrabold tracking-wider text-zinc-400 uppercase">Görsel</label>
                <div className="flex gap-2">
                  <Input
                    value={design.grid4WideUrl}
                    onChange={(e) => setDesign((prev) => ({ ...prev, grid4WideUrl: e.target.value }))}
                    placeholder="Görsel URL veya kütüphaneden seçin"
                    className="rounded-2xl focus:ring-[#df0000]/5 focus:border-[#df0000]"
                  />
                  <Button 
                    variant="outline" 
                    onClick={() => openMediaPicker('grid4WideUrl')}
                    className="rounded-2xl hover:bg-zinc-50 active:scale-[0.98] transition-all px-4"
                  >
                    Seç
                  </Button>
                </div>
              </div>
              <div className="space-y-2">
                <label className="block text-[11px] font-extrabold tracking-wider text-zinc-400 uppercase">Yönlendirme Linki</label>
                <Input
                  value={design.grid4WideLink}
                  onChange={(e) => setDesign((prev) => ({ ...prev, grid4WideLink: e.target.value }))}
                  placeholder="Yönlendirilecek adres (örn: /mutfak-robotu)"
                  className="rounded-2xl focus:ring-[#df0000]/5 focus:border-[#df0000]"
                />
              </div>
            </div>
            {design.grid4WideUrl && (
              <div className="aspect-[3/1] w-full rounded-2xl overflow-hidden border border-zinc-200 bg-zinc-50 max-h-[140px] shadow-sm">
                <img src={design.grid4WideUrl} className="w-full h-full object-cover" alt="Geniş Görsel Önizleme" />
              </div>
            )}
          </div>

          {/* Bottom 3 Vertical Banners */}
          <div className="border border-zinc-200/80 rounded-3xl bg-white p-6 shadow-[0_2px_8px_rgba(0,0,0,0.02),0_8px_24px_rgba(0,0,0,0.02)] space-y-6 transition-all duration-300 hover:shadow-md hover:border-zinc-300/80">
            <div className="flex items-center gap-2.5 text-zinc-800 font-bold border-b border-zinc-150 pb-3">
              <span className="material-symbols-outlined text-[#df0000] text-[20px]">grid_on</span>
              <span className="text-sm">Dikey Alt Görseller (2. Satır)</span>
            </div>

            <div className="grid gap-6 md:grid-cols-3">
              {/* Column 1 */}
              <div className="space-y-4 border border-zinc-150 p-4 rounded-2xl bg-zinc-50/20">
                <div className="text-[11px] font-black text-zinc-700 uppercase tracking-wider border-b border-zinc-150 pb-2">Sol Dikey Görsel</div>
                <div className="space-y-3">
                  <div className="space-y-1">
                    <label className="block text-[9px] font-extrabold text-zinc-400 uppercase">Görsel</label>
                    <div className="flex gap-2">
                      <Input
                        value={design.grid4Vert1Url}
                        onChange={(e) => setDesign((prev) => ({ ...prev, grid4Vert1Url: e.target.value }))}
                        placeholder="Görsel URL"
                        className="rounded-2xl text-xs py-1"
                      />
                      <Button variant="outline" size="sm" onClick={() => openMediaPicker('grid4Vert1Url')} className="rounded-2xl">Seç</Button>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="block text-[9px] font-extrabold text-zinc-400 uppercase">Link</label>
                    <Input
                      value={design.grid4Vert1Link}
                      onChange={(e) => setDesign((prev) => ({ ...prev, grid4Vert1Link: e.target.value }))}
                      placeholder="Link"
                      className="rounded-2xl text-xs py-1"
                    />
                  </div>
                </div>
                {design.grid4Vert1Url && (
                  <div className="aspect-[3/4] w-full rounded-xl overflow-hidden border border-zinc-200 bg-zinc-50 max-h-[140px] shadow-sm">
                    <img src={design.grid4Vert1Url} className="w-full h-full object-cover" alt="Sol Görsel Önizleme" />
                  </div>
                )}
              </div>

              {/* Column 2 */}
              <div className="space-y-4 border border-zinc-150 p-4 rounded-2xl bg-zinc-50/20">
                <div className="text-[11px] font-black text-zinc-700 uppercase tracking-wider border-b border-zinc-150 pb-2">Orta Dikey Görsel</div>
                <div className="space-y-3">
                  <div className="space-y-1">
                    <label className="block text-[9px] font-extrabold text-zinc-400 uppercase">Görsel</label>
                    <div className="flex gap-2">
                      <Input
                        value={design.grid4Vert2Url}
                        onChange={(e) => setDesign((prev) => ({ ...prev, grid4Vert2Url: e.target.value }))}
                        placeholder="Görsel URL"
                        className="rounded-2xl text-xs py-1"
                      />
                      <Button variant="outline" size="sm" onClick={() => openMediaPicker('grid4Vert2Url')} className="rounded-2xl">Seç</Button>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="block text-[9px] font-extrabold text-zinc-400 uppercase">Link</label>
                    <Input
                      value={design.grid4Vert2Link}
                      onChange={(e) => setDesign((prev) => ({ ...prev, grid4Vert2Link: e.target.value }))}
                      placeholder="Link"
                      className="rounded-2xl text-xs py-1"
                    />
                  </div>
                </div>
                {design.grid4Vert2Url && (
                  <div className="aspect-[3/4] w-full rounded-xl overflow-hidden border border-zinc-200 bg-zinc-50 max-h-[140px] shadow-sm">
                    <img src={design.grid4Vert2Url} className="w-full h-full object-cover" alt="Orta Görsel Önizleme" />
                  </div>
                )}
              </div>

              {/* Column 3 */}
              <div className="space-y-4 border border-zinc-150 p-4 rounded-2xl bg-zinc-50/20">
                <div className="text-[11px] font-black text-zinc-700 uppercase tracking-wider border-b border-zinc-150 pb-2">Sağ Dikey Görsel</div>
                <div className="space-y-3">
                  <div className="space-y-1">
                    <label className="block text-[9px] font-extrabold text-zinc-400 uppercase">Görsel</label>
                    <div className="flex gap-2">
                      <Input
                        value={design.grid4Vert3Url}
                        onChange={(e) => setDesign((prev) => ({ ...prev, grid4Vert3Url: e.target.value }))}
                        placeholder="Görsel URL"
                        className="rounded-2xl text-xs py-1"
                      />
                      <Button variant="outline" size="sm" onClick={() => openMediaPicker('grid4Vert3Url')} className="rounded-2xl">Seç</Button>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="block text-[9px] font-extrabold text-zinc-400 uppercase">Link</label>
                    <Input
                      value={design.grid4Vert3Link}
                      onChange={(e) => setDesign((prev) => ({ ...prev, grid4Vert3Link: e.target.value }))}
                      placeholder="Link"
                      className="rounded-2xl text-xs py-1"
                    />
                  </div>
                </div>
                {design.grid4Vert3Url && (
                  <div className="aspect-[3/4] w-full rounded-xl overflow-hidden border border-zinc-200 bg-zinc-50 max-h-[140px] shadow-sm">
                    <img src={design.grid4Vert3Url} className="w-full h-full object-cover" alt="Sağ Görsel Önizleme" />
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-3 pt-2">
            <Button
              onClick={save}
              disabled={saving}
              className="rounded-2xl bg-primary text-white hover:bg-primary/90 px-8 py-3 text-xs uppercase tracking-wider font-extrabold"
            >
              {saving ? 'Kaydediliyor...' : 'Değişiklikleri Kaydet'}
            </Button>
            <Button
              variant="outline"
              onClick={fetchDesign}
              disabled={saving}
              className="rounded-2xl px-6 py-3 text-xs uppercase tracking-wider font-extrabold border-zinc-200"
            >
              Vazgeç
            </Button>
          </div>
        </div>
      )}

      {/* Media Picker Modal */}
      <MediaLibraryModal
        isOpen={mediaPickerOpen}
        onClose={() => setMediaPickerOpen(false)}
        onSelect={handleMediaSelect}
      />
    </AdminLayout>
  )
}
