import { useEffect, useState } from 'react';
import { AdminLayout } from '../components/admin/AdminLayout';
import { getAdminToken, readApiResponse } from '../lib/api';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Dropdown } from '../components/ui/Dropdown';
import { MediaLibraryModal } from '../components/ui/MediaLibraryModal';
import { useToast } from '../components/ui/ToastContext';



type SliderItem = {
  id: string;
  imageUrl: string;
  title: string;
  subtitle: string;
  link: string;
  order: number;
};

type CampaignItem = {
  id: string;
  imageUrl: string;
  title: string;
  link: string;
  colSpan: string;
};

type StoreDesign = {
  brandName: string;
  logoUrl: string;
  primaryColor: string;
  accentColor: string;
  heroTitle: string;
  heroSubtitle: string;
  heroImageUrl: string;
  announcement: string;
  footerText: string;
  // Banners
  topBannerUrl: string;
  topBannerLink: string;
  middleBannerUrl: string;
  middleBannerLink: string;
  bottomBannerUrl: string;
  bottomBannerLink: string;
  // Contact & Settings
  sitePhone: string;
  siteEmail: string;
  siteAddress: string;
  sitePhoneDesc?: string;
  siteServiceDesc?: string;
  siteEmailDesc?: string;
  siteAddressDesc?: string;
  cargoFee: number;
  currency: string;
  seoTitle: string;
  seoDescription: string;
  // Social
  facebookUrl: string;
  instagramUrl: string;
  twitterUrl: string;
  youtubeUrl: string;
  // Page HTMLs;
  aboutUsHtml: string;
  kvkkHtml: string;
  privacyHtml: string;
  distanceSellingHtml: string;
  returnsHtml: string;
  helpHtml: string;
  // Lists
  sliders: SliderItem[];
  campaigns: CampaignItem[];
};

const fallback: StoreDesign = {
  brandName: 'Stilsoft KKTC',
  logoUrl: '',
  primaryColor: '#df0000',
  accentColor: '#121212',
  heroTitle: 'Online Teknolojik Alışveriş',
  heroSubtitle: 'Aradığınız tüm ürünler en uygun fiyatlarla burada.',
  heroImageUrl: '',
  announcement: 'Tüm siparişlerde kargo ücretsiz! Yeni kampanyaları keşfedin.',
  footerText: 'Güvenli alışveriş, hızlı teslimat ve kolay iade.',
  topBannerUrl: '',
  topBannerLink: '',
  middleBannerUrl: '',
  middleBannerLink: '',
  bottomBannerUrl: '',
  bottomBannerLink: '',
  sitePhone: '',
  siteEmail: '',
  siteAddress: '',
  sitePhoneDesc: 'Hafta içi 09:00 - 18:00 saatleri arasında kesintisiz destek.',
  siteServiceDesc: 'Arıza kaydı ve parça talepleriniz için uzman birimimiz.',
  siteEmailDesc: 'Soru ve önerileriniz için e-posta gönderin.',
  siteAddressDesc: 'Merkez ofis ve mağaza adres bilgilerimiz.',
  cargoFee: 0,
  currency: 'TL',
  seoTitle: 'Stilsoft KKTC | Mutfak ve Ev Aletleri',
  seoDescription: 'KKTC\'de Stilsoft küçük ev aletleri, mutfak robotları, süpürgeler ve ev teknolojisi ürünleri.',
  facebookUrl: '',
  instagramUrl: '',
  twitterUrl: '',
  youtubeUrl: '',
  aboutUsHtml: '<h1>Hakkımızda</h1><p>Biz en kaliteli ürünleri sunan bir teknoloji mağazasıyız.</p>',
  kvkkHtml: '<h1>KVKK Aydınlatma Metni</h1><p>Kişisel verilerinizin korunması politikamız...</p>',
  privacyHtml: '<h1>Gizlilik Sözleşmesi</h1><p>Gizlilik şartlarımız...</p>',
  distanceSellingHtml: '<h1>Mesafeli Satış Sözleşmesi</h1><p>Satış koşulları...</p>',
  returnsHtml: '<h1>İade Koşulları</h1><p>İade ve değişim süreçleri...</p>',
  helpHtml: '<h1>Destek ve Yardım</h1><p>Sıkça sorulan sorular...</p>',
  sliders: [],
  campaigns: []
};

type ActiveTab = 'brand' | 'sliders' | 'banners' | 'campaigns' | 'settings' | 'pages';

export function AdminDesignPage() {
  const { showToast } = useToast();
  const [design, setDesign] = useState<StoreDesign>(fallback);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<ActiveTab>('brand');
  
  // Media Picker state
  const [mediaPickerOpen, setMediaPickerOpen] = useState(false);
  const [activePickerTarget, setActivePickerTarget] = useState<string | null>(null);



  // Fetch store design
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/store-design');
        const json = await readApiResponse(res);
        if (res.ok && json?.data) {
          setDesign({
            ...fallback,
            ...json.data,
            sliders: json.data.sliders || [],
            campaigns: json.data.campaigns || []
          });
        }
      } catch (err) {
        showToast('Tasarım ayarları yüklenemedi.', 'error');
      }
    })();
  }, []);

  const openMediaPicker = (targetKey: string) => {
    setActivePickerTarget(targetKey);
    setMediaPickerOpen(true);
  };

  const handleMediaSelect = (url: string) => {
    if (!activePickerTarget) return;

    if (activePickerTarget.startsWith('slider-')) {
      const idx = parseInt(activePickerTarget.split('-')[1]);
      setDesign((prev) => {
        const nextSliders = [...prev.sliders];
        nextSliders[idx].imageUrl = url;
        return { ...prev, sliders: nextSliders };
      });
    } else if (activePickerTarget.startsWith('campaign-')) {
      const idx = parseInt(activePickerTarget.split('-')[1]);
      setDesign((prev) => {
        const nextCamps = [...prev.campaigns];
        nextCamps[idx].imageUrl = url;
        return { ...prev, campaigns: nextCamps };
      });
    } else {
      setDesign((prev) => ({ ...prev, [activePickerTarget]: url }));
    }
    
    setMediaPickerOpen(false);
    setActivePickerTarget(null);
    showToast('Görsel kütüphaneden seçildi.', 'success');
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/store-design', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${getAdminToken()}`
        },
        body: JSON.stringify(design),
      });
      const json = await readApiResponse(res);
      if (!res.ok || !json?.success) throw new Error(json?.message || 'Kaydedilemedi');
      showToast('Tasarım ayarları başarıyla kaydedildi.', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Kaydedilemedi', 'error');
    } finally {
      setSaving(false);
    }
  };

  // Slider controls
  const addSlider = () => {
    setDesign((prev) => ({
      ...prev,
      sliders: [
        ...prev.sliders,
        {
          id: Math.random().toString(36).substring(2, 9),
          imageUrl: '',
          title: 'Yeni Slayt Başlığı',
          subtitle: 'Açıklama Metni',
          link: '#',
          order: prev.sliders.length + 1
        }
      ]
    }));
  };

  const removeSlider = (idx: number) => {
    setDesign((prev) => ({
      ...prev,
      sliders: prev.sliders.filter((_, i) => i !== idx)
    }));
  };

  // Campaign controls
  const addCampaign = () => {
    setDesign((prev) => ({
      ...prev,
      campaigns: [
        ...prev.campaigns,
        {
          id: Math.random().toString(36).substring(2, 9),
          imageUrl: '',
          title: 'Kampanya Fırsatı',
          link: '#',
          colSpan: '1'
        }
      ]
    }));
  };

  const removeCampaign = (idx: number) => {
    setDesign((prev) => ({
      ...prev,
      campaigns: prev.campaigns.filter((_, i) => i !== idx)
    }));
  };

  return (
    <AdminLayout title="Tasarım ve İçerik Yönetimi" subtitle="Vitrin, kampanya, banner ve sayfa içeriklerini yönetin.">
      <div className="flex flex-col gap-6">
        {/* Navigation Tabs */}
        <div className="flex border-b border-outline-variant gap-2 overflow-x-auto">
          {[
            { id: 'brand', label: 'Genel Vitrin', icon: 'storefront' },
            { id: 'sliders', label: 'Slider Yönetimi', icon: 'linear_scale' },
            { id: 'banners', label: 'Banner Yönetimi', icon: 'view_quilt' },
            { id: 'campaigns', label: 'Kampanyalar', icon: 'campaign' },
            { id: 'settings', label: 'İletişim & SEO', icon: 'settings' },
            { id: 'pages', label: 'Sayfa Yönetimi', icon: 'description' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as ActiveTab)}
              className={`flex items-center gap-1.5 px-4 py-3 text-xs font-bold uppercase transition-all whitespace-nowrap border-b-2 -mb-[2px] ${
                activeTab === tab.id
                  ? 'border-primary text-primary'
                  : 'border-transparent text-tertiary hover:text-on-surface'
              }`}
            >
              <span className="material-symbols-outlined text-[18px]">{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content container */}
        <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
          {/* Editor form card */}
          <div className="border border-outline-variant bg-surface-container-lowest rounded-lg shadow-xs p-5">
            {activeTab === 'brand' && (
              <div className="flex flex-col gap-4">
                <h4 className="text-sm font-bold text-on-surface mb-2">Genel Vitrin Ayarları</h4>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Input
                    label="Marka Adı"
                    value={design.brandName}
                    onChange={(e) => setDesign((p) => ({ ...p, brandName: e.target.value }))}
                  />
                  <div className="flex items-end gap-2">
                    <Input
                      label="Logo URL"
                      value={design.logoUrl}
                      onChange={(e) => setDesign((p) => ({ ...p, logoUrl: e.target.value }))}
                    />
                    <Button variant="outline" onClick={() => openMediaPicker('logoUrl')}>Seç</Button>
                  </div>
                  <div className="flex items-end gap-2">
                    <div className="flex-grow">
                      <Input
                        label="Ana Tema Rengi (HEX)"
                        value={design.primaryColor}
                        onChange={(e) => setDesign((p) => ({ ...p, primaryColor: e.target.value }))}
                      />
                    </div>
                    <input
                      type="color"
                      value={design.primaryColor.startsWith('#') && design.primaryColor.length === 7 ? design.primaryColor : '#df0000'}
                      onChange={(e) => setDesign((p) => ({ ...p, primaryColor: e.target.value }))}
                      className="h-10 w-12 rounded-xl border border-zinc-250 cursor-pointer mb-[3px] bg-white p-0.5"
                    />
                  </div>

                  <div className="flex items-end gap-2">
                    <div className="flex-grow">
                      <Input
                        label="Vurgu Rengi (HEX)"
                        value={design.accentColor}
                        onChange={(e) => setDesign((p) => ({ ...p, accentColor: e.target.value }))}
                      />
                    </div>
                    <input
                      type="color"
                      value={design.accentColor.startsWith('#') && design.accentColor.length === 7 ? design.accentColor : '#121212'}
                      onChange={(e) => setDesign((p) => ({ ...p, accentColor: e.target.value }))}
                      className="h-10 w-12 rounded-xl border border-zinc-250 cursor-pointer mb-[3px] bg-white p-0.5"
                    />
                  </div>
                  <Input
                    label="Hero Ana Başlık"
                    value={design.heroTitle}
                    onChange={(e) => setDesign((p) => ({ ...p, heroTitle: e.target.value }))}
                    className="sm:col-span-2"
                  />
                  <div className="flex items-end gap-2 sm:col-span-2">
                    <Input
                      label="Hero Görsel URL"
                      value={design.heroImageUrl}
                      onChange={(e) => setDesign((p) => ({ ...p, heroImageUrl: e.target.value }))}
                    />
                    <Button variant="outline" onClick={() => openMediaPicker('heroImageUrl')}>Seç</Button>
                  </div>
                  <div className="sm:col-span-2">
                    <label className="text-xs font-semibold text-on-surface-variant mb-1 block">Hero Alt Metin</label>
                    <textarea
                      value={design.heroSubtitle}
                      onChange={(e) => setDesign((p) => ({ ...p, heroSubtitle: e.target.value }))}
                      className="w-full min-h-[80px] p-3 text-sm border border-outline-variant bg-surface rounded outline-none focus:border-primary transition"
                    />
                  </div>
                  <Input
                    label="Duyuru Bandı Metni"
                    value={design.announcement}
                    onChange={(e) => setDesign((p) => ({ ...p, announcement: e.target.value }))}
                    className="sm:col-span-2"
                  />
                  <Input
                    label="Footer Telif/Açıklama Metni"
                    value={design.footerText}
                    onChange={(e) => setDesign((p) => ({ ...p, footerText: e.target.value }))}
                    className="sm:col-span-2"
                  />
                </div>
              </div>
            )}

            {activeTab === 'sliders' && (
              <div className="flex flex-col gap-4">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-sm font-bold text-on-surface">Ana Sayfa Slider Kartları</h4>
                  <Button variant="primary" size="sm" onClick={addSlider} icon="add">Slayt Ekle</Button>
                </div>
                {design.sliders.length === 0 ? (
                  <p className="text-xs text-tertiary">Eklenmiş slayt yok.</p>
                ) : (
                  <div className="flex flex-col gap-4">
                    {design.sliders.map((slide, idx) => (
                      <div key={slide.id} className="border border-outline-variant rounded-lg p-4 bg-surface-container-low flex flex-col gap-3">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-primary">Slayt #{idx + 1}</span>
                          <button onClick={() => removeSlider(idx)} className="text-error hover:text-error/80 flex items-center">
                            <span className="material-symbols-outlined text-[18px]">delete</span>
                          </button>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <Input
                            label="Başlık"
                            value={slide.title}
                            onChange={(e) => {
                              const s = [...design.sliders];
                              s[idx].title = e.target.value;
                              setDesign((p) => ({ ...p, sliders: s }));
                            }}
                          />
                          <Input
                            label="Alt Başlık"
                            value={slide.subtitle}
                            onChange={(e) => {
                              const s = [...design.sliders];
                              s[idx].subtitle = e.target.value;
                              setDesign((p) => ({ ...p, sliders: s }));
                            }}
                          />
                          <div className="flex items-end gap-2">
                            <Input
                              label="Görsel URL"
                              value={slide.imageUrl}
                              onChange={(e) => {
                                const s = [...design.sliders];
                                s[idx].imageUrl = e.target.value;
                                setDesign((p) => ({ ...p, sliders: s }));
                              }}
                            />
                            <Button variant="outline" size="sm" onClick={() => openMediaPicker(`slider-${idx}`)}>Seç</Button>
                          </div>
                          <Input
                            label="Yönlendirme Linki"
                            value={slide.link}
                            onChange={(e) => {
                              const s = [...design.sliders];
                              s[idx].link = e.target.value;
                              setDesign((p) => ({ ...p, sliders: s }));
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {activeTab === 'banners' && (
              <div className="flex flex-col gap-4">
                <h4 className="text-sm font-bold text-on-surface mb-2">Banner Yerleşim Alanları</h4>
                <div className="grid gap-4">
                  {/* Top Banner */}
                  <div className="border border-outline-variant rounded-lg p-4 bg-surface-container-low flex flex-col gap-3">
                    <h5 className="text-xs font-bold text-on-surface">Üst Banner (3 Çeyrek Genişlik)</h5>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="flex items-end gap-2">
                        <Input
                          label="Görsel URL"
                          value={design.topBannerUrl}
                          onChange={(e) => setDesign((p) => ({ ...p, topBannerUrl: e.target.value }))}
                        />
                        <Button variant="outline" onClick={() => openMediaPicker('topBannerUrl')}>Seç</Button>
                      </div>
                      <Input
                        label="Yönlendirme Linki"
                        value={design.topBannerLink}
                        onChange={(e) => setDesign((p) => ({ ...p, topBannerLink: e.target.value }))}
                      />
                    </div>
                  </div>

                  {/* Middle Banner */}
                  <div className="border border-outline-variant rounded-lg p-4 bg-surface-container-low flex flex-col gap-3">
                    <h5 className="text-xs font-bold text-on-surface">Orta Kampanya Bannerı (Genişlik Boyu)</h5>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="flex items-end gap-2">
                        <Input
                          label="Görsel URL"
                          value={design.middleBannerUrl}
                          onChange={(e) => setDesign((p) => ({ ...p, middleBannerUrl: e.target.value }))}
                        />
                        <Button variant="outline" onClick={() => openMediaPicker('middleBannerUrl')}>Seç</Button>
                      </div>
                      <Input
                        label="Yönlendirme Linki"
                        value={design.middleBannerLink}
                        onChange={(e) => setDesign((p) => ({ ...p, middleBannerLink: e.target.value }))}
                      />
                    </div>
                  </div>

                  {/* Bottom Banner */}
                  <div className="border border-outline-variant rounded-lg p-4 bg-surface-container-low flex flex-col gap-3">
                    <h5 className="text-xs font-bold text-on-surface">Alt Fırsat Bannerı</h5>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="flex items-end gap-2">
                        <Input
                          label="Görsel URL"
                          value={design.bottomBannerUrl}
                          onChange={(e) => setDesign((p) => ({ ...p, bottomBannerUrl: e.target.value }))}
                        />
                        <Button variant="outline" onClick={() => openMediaPicker('bottomBannerUrl')}>Seç</Button>
                      </div>
                      <Input
                        label="Yönlendirme Linki"
                        value={design.bottomBannerLink}
                        onChange={(e) => setDesign((p) => ({ ...p, bottomBannerLink: e.target.value }))}
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'campaigns' && (
              <div className="flex flex-col gap-4">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-sm font-bold text-on-surface">Öne Çıkan Kampanya Grid Kartları</h4>
                  <Button variant="primary" size="sm" onClick={addCampaign} icon="add">Kart Ekle</Button>
                </div>
                {design.campaigns.length === 0 ? (
                  <p className="text-xs text-tertiary">Eklenmiş kampanya kartı yok.</p>
                ) : (
                  <div className="flex flex-col gap-4">
                    {design.campaigns.map((camp, idx) => (
                      <div key={camp.id} className="border border-outline-variant rounded-lg p-4 bg-surface-container-low flex flex-col gap-3">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-primary">Kart #{idx + 1}</span>
                          <button onClick={() => removeCampaign(idx)} className="text-error hover:text-error/80 flex items-center">
                            <span className="material-symbols-outlined text-[18px]">delete</span>
                          </button>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <Input
                            label="Kampanya Kart Başlığı"
                            value={camp.title}
                            onChange={(e) => {
                              const c = [...design.campaigns];
                              c[idx].title = e.target.value;
                              setDesign((p) => ({ ...p, campaigns: c }));
                            }}
                          />
                          <Dropdown
                            label="Genişlik (Grid Sütunu)"
                            value={camp.colSpan}
                            onChange={(e) => {
                              const c = [...design.campaigns];
                              c[idx].colSpan = e.target.value;
                              setDesign((p) => ({ ...p, campaigns: c }));
                            }}
                            options={[
                              { value: '1', label: '1 Sütun (Normal)' },
                              { value: '2', label: '2 Sütun (Geniş)' }
                            ]}
                          />
                          <div className="flex items-end gap-2">
                            <Input
                              label="Görsel URL"
                              value={camp.imageUrl}
                              onChange={(e) => {
                                const c = [...design.campaigns];
                                c[idx].imageUrl = e.target.value;
                                setDesign((p) => ({ ...p, campaigns: c }));
                              }}
                            />
                            <Button variant="outline" size="sm" onClick={() => openMediaPicker(`campaign-${idx}`)}>Seç</Button>
                          </div>
                          <Input
                            label="Yönlendirme Linki"
                            value={camp.link}
                            onChange={(e) => {
                              const c = [...design.campaigns];
                              c[idx].link = e.target.value;
                              setDesign((p) => ({ ...p, campaigns: c }));
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {activeTab === 'settings' && (
              <div className="flex flex-col gap-4">
                <h4 className="text-sm font-bold text-on-surface mb-2">İletişim & SEO Ayarları</h4>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Input
                    label="Mağaza Telefon"
                    value={design.sitePhone}
                    onChange={(e) => {
                      const val = e.target.value.replace(/[^0-9]/g, '').slice(0, 11);
                      setDesign((p) => ({ ...p, sitePhone: val }));
                    }}
                  />
                  <Input
                    label="Mağaza E-posta"
                    value={design.siteEmail}
                    onChange={(e) => setDesign((p) => ({ ...p, siteEmail: e.target.value }))}
                  />
                  <Input
                    label="Kargo Ücreti (TL)"
                    type="number"
                    value={design.cargoFee}
                    onChange={(e) => setDesign((p) => ({ ...p, cargoFee: parseFloat(e.target.value) || 0 }))}
                  />
                  <Input
                    label="Para Birimi"
                    value={design.currency}
                    onChange={(e) => setDesign((p) => ({ ...p, currency: e.target.value }))}
                  />
                  <Input
                    label="Mağaza Adresi"
                    value={design.siteAddress}
                    onChange={(e) => setDesign((p) => ({ ...p, siteAddress: e.target.value }))}
                    className="sm:col-span-2"
                  />
                  <Input
                    label="Müşteri Hizmetleri Açıklaması"
                    value={design.sitePhoneDesc || ''}
                    onChange={(e) => setDesign((p) => ({ ...p, sitePhoneDesc: e.target.value }))}
                  />
                  <Input
                    label="Genel Müdürlük E-posta Açıklaması"
                    value={design.siteEmailDesc || ''}
                    onChange={(e) => setDesign((p) => ({ ...p, siteEmailDesc: e.target.value }))}
                  />
                  <Input
                    label="Adres Bilgisi Açıklaması"
                    value={design.siteAddressDesc || ''}
                    onChange={(e) => setDesign((p) => ({ ...p, siteAddressDesc: e.target.value }))}
                  />
                  <Input
                    label="Teknik Servis Açıklaması"
                    value={design.siteServiceDesc || ''}
                    onChange={(e) => setDesign((p) => ({ ...p, siteServiceDesc: e.target.value }))}
                  />
                  <Input
                    label="SEO Başlık (Title)"
                    value={design.seoTitle}
                    onChange={(e) => setDesign((p) => ({ ...p, seoTitle: e.target.value }))}
                    className="sm:col-span-2"
                  />
                  <div className="sm:col-span-2">
                    <label className="text-xs font-semibold text-on-surface-variant mb-1 block">SEO Açıklama (Meta Description)</label>
                    <textarea
                      value={design.seoDescription}
                      onChange={(e) => setDesign((p) => ({ ...p, seoDescription: e.target.value }))}
                      className="w-full min-h-[80px] p-3 text-sm border border-outline-variant bg-surface rounded outline-none focus:border-primary transition"
                    />
                  </div>
                  {/* Social links */}
                  <h5 className="text-xs font-bold text-on-surface sm:col-span-2 border-t border-outline-variant pt-3 mt-1">Sosyal Medya Hesapları</h5>
                  <Input
                    label="Facebook URL"
                    value={design.facebookUrl}
                    onChange={(e) => setDesign((p) => ({ ...p, facebookUrl: e.target.value }))}
                  />
                  <Input
                    label="Instagram URL"
                    value={design.instagramUrl}
                    onChange={(e) => setDesign((p) => ({ ...p, instagramUrl: e.target.value }))}
                  />
                  <Input
                    label="Twitter / X URL"
                    value={design.twitterUrl}
                    onChange={(e) => setDesign((p) => ({ ...p, twitterUrl: e.target.value }))}
                  />
                  <Input
                    label="YouTube URL"
                    value={design.youtubeUrl}
                    onChange={(e) => setDesign((p) => ({ ...p, youtubeUrl: e.target.value }))}
                  />
                </div>
              </div>
            )}

            {activeTab === 'pages' && (
              <div className="flex flex-col gap-4">
                <h4 className="text-sm font-bold text-on-surface mb-2">Kurumsal ve Sözleşme Sayfaları (HTML Editor)</h4>
                
                {[
                  { key: 'aboutUsHtml', label: 'Hakkımızda Sayfa İçeriği' },
                  { key: 'kvkkHtml', label: 'KVKK Metni' },
                  { key: 'privacyHtml', label: 'Gizlilik Sözleşmesi' },
                  { key: 'distanceSellingHtml', label: 'Mesafeli Satış Sözleşmesi' },
                  { key: 'returnsHtml', label: 'İade ve Değişim Politikası' },
                  { key: 'helpHtml', label: 'Yardım / SSS' },
                ].map((pg) => (
                  <div key={pg.key} className="flex flex-col gap-1.5 border border-outline-variant rounded-lg p-4 bg-surface-container-low">
                    <label className="text-xs font-bold text-on-surface">{pg.label}</label>
                    <textarea
                      value={(design as any)[pg.key]}
                      onChange={(e) => setDesign((p) => ({ ...p, [pg.key]: e.target.value }))}
                      className="w-full min-h-[120px] p-3 text-sm font-mono border border-outline-variant bg-surface rounded outline-none focus:border-primary transition"
                    />
                  </div>
                ))}
              </div>
            )}

            {/* Save Action */}
            <Button
              onClick={save}
              disabled={saving}
              className="mt-6 w-full"
              loading={saving}
            >
              Ayarları Kaydet ve Yayına Al
            </Button>
          </div>

          {/* Sidebar Live Preview Device Mockup */}
          <div className="hidden lg:block">
            <div className="sticky top-6 border border-outline-variant bg-surface-container-lowest text-on-surface rounded-lg shadow-md overflow-hidden">
              <div className="bg-primary text-on-primary px-4 py-2.5 text-xs text-center font-bold tracking-wide">
                {design.announcement || 'Duyuru bandı önizlemesi'}
              </div>
              <div className="px-5 py-4 border-b border-outline-variant flex items-center justify-between bg-surface">
                <span className="text-md font-black text-primary uppercase">{design.brandName || 'MARKA'}</span>
                <span className="material-symbols-outlined text-tertiary text-[20px]">shopping_bag</span>
              </div>
              
              {/* Preview Hero Area */}
              <div className="relative min-h-[220px] bg-zinc-950 flex flex-col justify-end p-5 text-white">
                {design.heroImageUrl ? (
                  <img src={design.heroImageUrl} className="absolute inset-0 h-full w-full object-cover opacity-60" />
                ) : (
                  <div className="absolute inset-0 bg-gradient-to-tr from-primary to-zinc-900 opacity-80" />
                )}
                <div className="relative z-10">
                  <h3 className="text-lg font-extrabold leading-tight text-white mb-1.5">{design.heroTitle || 'Vitrin Başlığı'}</h3>
                  <p className="text-[10px] text-white/80 line-clamp-2 mb-3">{design.heroSubtitle || 'Açıklama...'}</p>
                  <button className="bg-primary text-on-primary text-[10px] font-bold px-3 py-1.5 rounded uppercase hover:bg-primary-container transition">
                    Alışverişe Başla
                  </button>
                </div>
              </div>
              
              {/* Footer preview */}
              <div className="p-4 bg-surface-container-low text-[10px] text-tertiary border-t border-outline-variant">
                <p className="font-semibold text-on-surface mb-1">{design.brandName} Teknoloji Mağazası</p>
                <p>{design.footerText}</p>
                <div className="mt-3 flex gap-2 text-primary font-bold">
                  {design.facebookUrl && <span>FB</span>}
                  {design.instagramUrl && <span>IG</span>}
                  {design.twitterUrl && <span>X</span>}
                  {design.youtubeUrl && <span>YT</span>}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Media Picker Modal Overlay */}
      <MediaLibraryModal
        isOpen={mediaPickerOpen}
        onClose={() => setMediaPickerOpen(false)}
        onSelect={handleMediaSelect}
        activeFolder={activeTab === 'sliders' ? 'Slider' : activeTab === 'banners' ? 'Banners' : 'Genel'}
      />
    </AdminLayout>
  );
}
