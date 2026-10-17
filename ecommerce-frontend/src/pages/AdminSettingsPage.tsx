import { useEffect, useState, useRef } from 'react'
import { AdminLayout } from '../components/admin/AdminLayout'
import { getAdminToken, readApiResponse } from '../lib/api'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { MediaLibraryModal } from '../components/ui/MediaLibraryModal'
import { useToast } from '../components/ui/ToastContext'



type StoreDesign = {
  brandName: string
  logoUrl: string
  primaryColor: string
  accentColor: string
  heroTitle: string
  heroSubtitle: string
  heroImageUrl: string
  announcement: string
  footerText: string
  sitePhone: string
  siteEmail: string
  siteAddress: string
  sitePhoneDesc?: string
  siteServiceDesc?: string
  siteEmailDesc?: string
  siteAddressDesc?: string
  cargoFee: number
  freeShippingThreshold: number
  currency: string
  seoTitle: string
  seoDescription: string
  facebookUrl: string
  instagramUrl: string
  twitterUrl: string
  youtubeUrl: string
  pdfCatalogsTitle: string
  [key: string]: any
}

const fallback: StoreDesign = {
  brandName: 'Stilsoft KKTC',
  logoUrl: '',
  primaryColor: '#df0000',
  accentColor: '#0d0d0d',
  heroTitle: 'Mutfakta Profesyonel Stilsoft Dokunuşu',
  heroSubtitle: 'İleri teknoloji ve zarif tasarımın buluştuğu ürünlerle yaşam alanınızı dönüştürün.',
  heroImageUrl: '',
  announcement: 'Kıbrıs genelinde hızlı teslimat! Stilsoft ile evinizi yenileyin.',
  footerText: "Kıbrıs'ta ev gereçlerinin güvenilir adresi.",
  sitePhone: '+90 392 444 88 99',
  siteEmail: 'info@example.com',
  siteAddress: 'Lefkoşa, Kuzey Kıbrıs',
  sitePhoneDesc: 'Hafta içi 09:00 - 18:00 saatleri arasında kesintisiz destek.',
  siteServiceDesc: 'Arıza kaydı ve parça talepleriniz için uzman birimimiz.',
  siteEmailDesc: 'Soru ve önerileriniz için e-posta gönderin.',
  siteAddressDesc: 'Merkez ofis ve mağaza adres bilgilerimiz.',
  cargoFee: 150,
  freeShippingThreshold: 2000,
  currency: 'TL',
  seoTitle: 'Stilsoft KKTC | Mutfak ve Ev Aletleri',
  seoDescription: "KKTC'de Stilsoft küçük ev aletleri, mutfak robotları, süpürgeler ve ev teknolojisi ürünleri.",
  facebookUrl: '',
  instagramUrl: '',
  twitterUrl: '',
  youtubeUrl: '',
  pdfCatalogsTitle: "Stilsoft'un Renkli Dünyasına Açılan Kapılar",
}

export function AdminSettingsPage() {
  const { showToast, dismissToast } = useToast()
  const [design, setDesign] = useState<StoreDesign>(fallback)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  
  // Media Picker state
  const [mediaPickerOpen, setMediaPickerOpen] = useState(false)
  const [activePickerTarget, setActivePickerTarget] = useState<string | null>(null)

  // Logo Upload State
  const [logoUploading, setLogoUploading] = useState(false)
  const logoFileInputRef = useRef<HTMLInputElement>(null)



  const handleLogoUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setLogoUploading(true)
    const toastId = showToast('Logo yükleniyor...', 'loading', 0)
    try {
      const token = localStorage.getItem('ecom_admin_token')
      const formData = new FormData()
      formData.append('file', files[0])
      formData.append('folder', 'Genel')

      const response = await fetch('/api/admin/media', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        },
        body: formData
      })
      const res = await response.json()
      if (res.success && res.data?.url) {
        setDesign((prev) => ({ ...prev, logoUrl: res.data.url }))
        showToast('Logo başarıyla yüklendi.', 'success')
      } else {
        showToast(res.message || 'Yükleme başarısız', 'error')
      }
    } catch (e) {
      showToast('Bağlantı hatası', 'error')
    } finally {
      setLogoUploading(false)
      dismissToast(toastId)
    }
  }

  const fetchDesign = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/store-design')
      const json = await readApiResponse(res)
      if (res.ok && json?.data) {
        setDesign({
          ...fallback,
          ...json.data,
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
      showToast('Site ayarları başarıyla güncellendi.', 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Kaydedilemedi', 'error')
    } finally {
      setSaving(false)
    }
  }

  const openMediaPicker = (target: string) => {
    setActivePickerTarget(target)
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
      title="Site Ayarları"
      subtitle="E-ticaret sitesinin marka adı, iletişim kanalları, para birimi, kargo ücreti, SEO ve sosyal medya hesaplarını yönetin."
    >
      {loading ? (
        <div className="flex flex-col items-center justify-center py-24 bg-white rounded-3xl border border-zinc-200/80 shadow-[0_2px_8px_rgba(0,0,0,0.02)]">
          <div className="w-10 h-10 border-4 border-zinc-200 border-t-[#df0000] rounded-full animate-spin mb-3" />
          <span className="text-sm text-zinc-400 font-medium">Site ayarları yükleniyor...</span>
        </div>
      ) : (
        <div className="space-y-6 max-w-5xl">
          <div className="grid gap-6 md:grid-cols-12">
            {/* Left side form */}
            <div className="md:col-span-8 space-y-6">
              {/* Brand & Theme */}
              <div className="border border-zinc-200/80 bg-white rounded-3xl p-6 shadow-[0_2px_8px_rgba(0,0,0,0.02),0_8px_24px_rgba(0,0,0,0.02)] space-y-5 transition-all duration-300 hover:shadow-md hover:border-zinc-300/80">
                <h3 className="text-[10px] font-extrabold text-zinc-400 uppercase tracking-widest border-b border-zinc-150 pb-3 flex items-center gap-2">
                  <span className="material-symbols-outlined text-[#df0000] text-[18px]">palette</span>
                  Marka & Tasarım Kimliği
                </h3>
                <div className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Input
                      label="Mağaza Adı"
                      value={design.brandName}
                      onChange={(e) => setDesign((p) => ({ ...p, brandName: e.target.value }))}
                      className="rounded-2xl focus:ring-[#df0000]/5 focus:border-[#df0000]"
                    />
                    <div className="flex items-end gap-3">
                      <div className="flex-grow">
                        <Input
                          label="Ana Tema Rengi (HEX)"
                          value={design.primaryColor}
                          onChange={(e) => setDesign((p) => ({ ...p, primaryColor: e.target.value }))}
                          className="rounded-2xl focus:ring-[#df0000]/5 focus:border-[#df0000]"
                        />
                      </div>
                      <input
                        type="color"
                        value={design.primaryColor.startsWith('#') && design.primaryColor.length === 7 ? design.primaryColor : '#df0000'}
                        onChange={(e) => setDesign((p) => ({ ...p, primaryColor: e.target.value }))}
                        className="h-10 w-12 rounded-xl border border-zinc-250 cursor-pointer mb-0.5 transition-all active:scale-95 bg-white p-0.5"
                      />
                    </div>
                  </div>

                  {/* Logo Management Section */}
                  <div className="border border-zinc-150 rounded-2xl p-4 bg-zinc-50/50 space-y-3">
                    <label className="text-[11px] font-extrabold tracking-wider text-zinc-400 uppercase">Site Logosu</label>
                    <div className="flex flex-col sm:flex-row items-center gap-5">
                      {/* Logo Preview box */}
                      <div className="relative w-full sm:w-48 h-24 border border-zinc-200 rounded-xl overflow-hidden flex items-center justify-center bg-zinc-150 shadow-inner group">
                        {/* Checkerboard background */}
                        <div className="absolute inset-0 opacity-5 bg-[linear-gradient(45deg,#000_25%,transparent_25%),linear-gradient(-45deg,#000_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#000_75%),linear-gradient(-45deg,transparent_75%,#000_75%)] bg-[size:10px_10px] bg-[position:0_0,0_5px,5px_-5px,-5px_0]" />
                        
                        {design.logoUrl ? (
                          <img 
                            src={design.logoUrl} 
                            alt="Logo Önizleme" 
                            className="max-w-full max-h-[80%] object-contain relative z-10 transition-transform group-hover:scale-105"
                          />
                        ) : (
                          <div className="flex flex-col items-center justify-center text-zinc-400 relative z-10">
                            <span className="material-symbols-outlined text-[32px] text-zinc-300">image</span>
                            <span className="text-[10px] font-bold mt-1 uppercase tracking-wider">Logo Yok</span>
                          </div>
                        )}
                      </div>

                      {/* Action buttons */}
                      <div className="flex-1 w-full space-y-2.5">
                        <div className="flex flex-wrap gap-2">
                          <input
                            type="file"
                            ref={logoFileInputRef}
                            onChange={(e) => handleLogoUpload(e.target.files)}
                            accept="image/*"
                            className="hidden"
                          />
                          <Button
                            variant="primary"
                            onClick={() => logoFileInputRef.current?.click()}
                            loading={logoUploading}
                            className="rounded-xl bg-zinc-900 hover:bg-zinc-800 active:scale-[0.98] transition-all px-4 py-2 text-xs font-bold text-white shadow-sm"
                          >
                            Yeni Logo Yükle
                          </Button>
                          <Button
                            variant="outline"
                            onClick={() => openMediaPicker('logoUrl')}
                            className="rounded-xl border border-zinc-250 hover:bg-zinc-50 active:scale-[0.98] transition-all px-4 py-2 text-xs font-bold text-zinc-700"
                          >
                            Kütüphaneden Seç
                          </Button>
                          {design.logoUrl && (
                            <Button
                              variant="outline"
                              onClick={() => setDesign((p) => ({ ...p, logoUrl: '' }))}
                              className="rounded-xl border border-red-200 text-red-650 hover:bg-red-50 hover:border-red-300 active:scale-[0.98] transition-all px-4 py-2 text-xs font-bold"
                            >
                              Kaldır
                            </Button>
                          )}
                        </div>
                        <p className="text-[10px] text-zinc-400 font-semibold leading-relaxed">
                          Yüklenecek logoların şeffaf (PNG/SVG) olması ve maksimum 500kb boyutunda olması önerilir. Logo yüklendiğinde otomatik olarak güncellenir ancak tüm ayarların kaydedilmesi için "Tüm Ayarları Kaydet" butonuna tıklamanız gerekir.
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="flex items-end gap-3">
                      <div className="flex-grow">
                        <Input
                          label="Vurgu Rengi (HEX)"
                          value={design.accentColor}
                          onChange={(e) => setDesign((p) => ({ ...p, accentColor: e.target.value }))}
                          className="rounded-2xl focus:ring-[#df0000]/5 focus:border-[#df0000]"
                        />
                      </div>
                      <input
                        type="color"
                        value={design.accentColor.startsWith('#') && design.accentColor.length === 7 ? design.accentColor : '#0d0d0d'}
                        onChange={(e) => setDesign((p) => ({ ...p, accentColor: e.target.value }))}
                        className="h-10 w-12 rounded-xl border border-zinc-250 cursor-pointer mb-0.5 transition-all active:scale-95 bg-white p-0.5"
                      />
                    </div>

                  </div>
                </div>
              </div>

              {/* Core Store Settings */}
              <div className="border border-zinc-200/80 bg-white rounded-3xl p-6 shadow-[0_2px_8px_rgba(0,0,0,0.02),0_8px_24px_rgba(0,0,0,0.02)] space-y-5 transition-all duration-300 hover:shadow-md hover:border-zinc-300/80">
                <h3 className="text-[10px] font-extrabold text-zinc-400 uppercase tracking-widest border-b border-zinc-150 pb-3 flex items-center gap-2">
                  <span className="material-symbols-outlined text-[#df0000] text-[18px]">local_shipping</span>
                  Fiyatlandırma & Lojistik
                </h3>
                <div className="grid gap-4 sm:grid-cols-3">
                  <Input
                    label="Mağaza Para Birimi"
                    value={design.currency}
                    onChange={(e) => setDesign((p) => ({ ...p, currency: e.target.value }))}
                    className="rounded-2xl focus:ring-[#df0000]/5 focus:border-[#df0000]"
                  />
                  <Input
                    label="Kargo Ücreti (TL)"
                    type="number"
                    value={design.cargoFee}
                    onChange={(e) => setDesign((p) => ({ ...p, cargoFee: parseFloat(e.target.value) || 0 }))}
                    className="rounded-2xl focus:ring-[#df0000]/5 focus:border-[#df0000]"
                  />
                  <Input
                    label="Ücretsiz Kargo Barajı (TL)"
                    type="number"
                    value={design.freeShippingThreshold}
                    onChange={(e) => setDesign((p) => ({ ...p, freeShippingThreshold: parseFloat(e.target.value) || 0 }))}
                    className="rounded-2xl focus:ring-[#df0000]/5 focus:border-[#df0000]"
                  />
                </div>
              </div>

              {/* Contact Info */}
              <div className="border border-zinc-200/80 bg-white rounded-3xl p-6 shadow-[0_2px_8px_rgba(0,0,0,0.02),0_8px_24px_rgba(0,0,0,0.02)] space-y-5 transition-all duration-300 hover:shadow-md hover:border-zinc-300/80">
                <h3 className="text-[10px] font-extrabold text-zinc-400 uppercase tracking-widest border-b border-zinc-150 pb-3 flex items-center gap-2">
                  <span className="material-symbols-outlined text-[#df0000] text-[18px]">contact_phone</span>
                  İletişim Bilgileri
                </h3>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Input
                    label="Müşteri Hizmetleri Telefonu"
                    value={design.sitePhone}
                    onChange={(e) => {
                      const val = e.target.value.replace(/[^0-9]/g, '').slice(0, 11);
                      setDesign((p) => ({ ...p, sitePhone: val }));
                    }}
                    className="rounded-2xl focus:ring-[#df0000]/5 focus:border-[#df0000]"
                  />
                  <Input
                    label="Müşteri Hizmetleri Açıklaması"
                    value={design.sitePhoneDesc || ''}
                    onChange={(e) => setDesign((p) => ({ ...p, sitePhoneDesc: e.target.value }))}
                    className="rounded-2xl focus:ring-[#df0000]/5 focus:border-[#df0000]"
                  />
                  <Input
                    label="Destek E-posta Adresi"
                    value={design.siteEmail}
                    onChange={(e) => setDesign((p) => ({ ...p, siteEmail: e.target.value }))}
                    className="rounded-2xl focus:ring-[#df0000]/5 focus:border-[#df0000]"
                  />
                  <Input
                    label="Genel Müdürlük E-posta Açıklaması"
                    value={design.siteEmailDesc || ''}
                    onChange={(e) => setDesign((p) => ({ ...p, siteEmailDesc: e.target.value }))}
                    className="rounded-2xl focus:ring-[#df0000]/5 focus:border-[#df0000]"
                  />
                  <Input
                    label="Mağaza Adresi"
                    value={design.siteAddress}
                    onChange={(e) => setDesign((p) => ({ ...p, siteAddress: e.target.value }))}
                    className="rounded-2xl focus:ring-[#df0000]/5 focus:border-[#df0000]"
                  />
                  <Input
                    label="Adres Bilgisi Açıklaması"
                    value={design.siteAddressDesc || ''}
                    onChange={(e) => setDesign((p) => ({ ...p, siteAddressDesc: e.target.value }))}
                    className="rounded-2xl focus:ring-[#df0000]/5 focus:border-[#df0000]"
                  />
                  <Input
                    label="Teknik Servis Açıklaması"
                    value={design.siteServiceDesc || ''}
                    onChange={(e) => setDesign((p) => ({ ...p, siteServiceDesc: e.target.value }))}
                    className="sm:col-span-2 rounded-2xl focus:ring-[#df0000]/5 focus:border-[#df0000]"
                  />
                </div>
              </div>

              {/* SEO Configurations */}
              <div className="border border-zinc-200/80 bg-white rounded-3xl p-6 shadow-[0_2px_8px_rgba(0,0,0,0.02),0_8px_24px_rgba(0,0,0,0.02)] space-y-5 transition-all duration-300 hover:shadow-md hover:border-zinc-300/80">
                <h3 className="text-[10px] font-extrabold text-zinc-400 uppercase tracking-widest border-b border-zinc-150 pb-3 flex items-center gap-2">
                  <span className="material-symbols-outlined text-[#df0000] text-[18px]">travel_explore</span>
                  SEO & Meta Etiketleri
                </h3>
                <div className="grid gap-4">
                  <Input
                    label="SEO Başlık (Title)"
                    value={design.seoTitle}
                    onChange={(e) => setDesign((p) => ({ ...p, seoTitle: e.target.value }))}
                    className="rounded-2xl focus:ring-[#df0000]/5 focus:border-[#df0000]"
                  />
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[11px] font-extrabold tracking-wider text-zinc-400 uppercase">SEO Açıklama (Meta Description)</label>
                    <textarea
                      value={design.seoDescription}
                      onChange={(e) => setDesign((p) => ({ ...p, seoDescription: e.target.value }))}
                      className="w-full min-h-[100px] p-4 text-xs font-semibold text-zinc-700 bg-white border border-zinc-200 rounded-2xl outline-none focus:ring-4 focus:ring-[#df0000]/5 focus:border-[#df0000] transition-all duration-200"
                      placeholder="Sitenizin Google arama sonuçlarında görüneceği özet açıklama metni..."
                    />
                  </div>
                </div>
              </div>

              {/* Social Accounts */}
              <div className="border border-zinc-200/80 bg-white rounded-3xl p-6 shadow-[0_2px_8px_rgba(0,0,0,0.02),0_8px_24px_rgba(0,0,0,0.02)] space-y-5 transition-all duration-300 hover:shadow-md hover:border-zinc-300/80">
                <h3 className="text-[10px] font-extrabold text-zinc-400 uppercase tracking-widest border-b border-zinc-150 pb-3 flex items-center gap-2">
                  <span className="material-symbols-outlined text-[#df0000] text-[18px]">share</span>
                  Sosyal Medya Hesapları
                </h3>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Input
                    label="Facebook Sayfa Linki"
                    value={design.facebookUrl}
                    onChange={(e) => setDesign((p) => ({ ...p, facebookUrl: e.target.value }))}
                    className="rounded-2xl focus:ring-[#df0000]/5 focus:border-[#df0000]"
                  />
                  <Input
                    label="Instagram Profil Linki"
                    value={design.instagramUrl}
                    onChange={(e) => setDesign((p) => ({ ...p, instagramUrl: e.target.value }))}
                    className="rounded-2xl focus:ring-[#df0000]/5 focus:border-[#df0000]"
                  />
                  <Input
                    label="Twitter / X Linki"
                    value={design.twitterUrl}
                    onChange={(e) => setDesign((p) => ({ ...p, twitterUrl: e.target.value }))}
                    className="rounded-2xl focus:ring-[#df0000]/5 focus:border-[#df0000]"
                  />
                  <Input
                    label="YouTube Kanal Linki"
                    value={design.youtubeUrl}
                    onChange={(e) => setDesign((p) => ({ ...p, youtubeUrl: e.target.value }))}
                    className="rounded-2xl focus:ring-[#df0000]/5 focus:border-[#df0000]"
                  />
                </div>
              </div>
            </div>

            {/* Right side save summary */}
            <div className="md:col-span-4 space-y-6">
              <div className="sticky top-[86px] space-y-4">
                <div className="border border-zinc-200/80 bg-white rounded-3xl p-6 shadow-[0_2px_8px_rgba(0,0,0,0.02),0_8px_24px_rgba(0,0,0,0.02)] flex flex-col gap-5">
                  <div className="text-center py-5 bg-zinc-50/50 border border-zinc-150 rounded-2xl shadow-inner">
                    <span className="material-symbols-outlined text-[48px] text-[#df0000]">settings</span>
                    <p className="text-xs font-black text-zinc-850 uppercase tracking-wider mt-2">
                      SİTE YAPILANDIRMASI
                    </p>
                    <p className="text-[10px] text-zinc-400 font-bold uppercase tracking-wider mt-0.5">Stilsoft KKTC E-Ticaret</p>
                  </div>

                  <div className="space-y-3.5 text-xs">
                    <div className="flex justify-between border-b border-zinc-100 pb-2 text-zinc-500 font-medium">
                      <span>Mağaza Adı:</span>
                      <span className="font-extrabold text-zinc-900">{design.brandName}</span>
                    </div>
                    <div className="flex justify-between border-b border-zinc-100 pb-2 text-zinc-500 font-medium">
                      <span>Para Birimi:</span>
                      <span className="font-extrabold text-zinc-900">{design.currency}</span>
                    </div>
                    <div className="flex justify-between border-b border-zinc-100 pb-2 text-zinc-500 font-medium">
                      <span>Kargo Ücreti:</span>
                      <span className="font-extrabold text-zinc-900">₺{design.cargoFee}</span>
                    </div>
                    <div className="flex justify-between text-zinc-500 font-medium">
                      <span>SEO Durumu:</span>
                      <span className="font-extrabold text-green-600 inline-flex items-center gap-0.5">
                        <span className="material-symbols-outlined text-[14px]">check_circle</span> Aktif
                      </span>
                    </div>
                  </div>

                  <Button 
                    variant="primary" 
                    loading={saving} 
                    onClick={save} 
                    className="w-full rounded-2xl bg-[#df0000] hover:bg-[#c00000] active:scale-[0.98] transition-all py-3 font-bold shadow-md shadow-[#df0000]/10"
                  >
                    Tüm Ayarları Kaydet
                  </Button>
                </div>
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
