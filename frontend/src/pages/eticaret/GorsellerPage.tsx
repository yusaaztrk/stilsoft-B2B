import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Image as ImageIcon, Plus, Trash2, Star, Info, Store, Save } from 'lucide-react'
import { MessageBanner, PageHeader, SaveBar, SHOP_API, authHeaders, input, label, usePanelMessage, useStorefrontSettings, type Banner } from './shared'

export default function GorsellerPage() {
  const { message, notify } = usePanelMessage()
  const { settings, update, saveSettings, saving } = useStorefrontSettings(notify)

  const uploadImage = async (file: File): Promise<string | null> => {
    const form = new FormData()
    form.append('file', file)

    try {
      const res = await fetch(`${SHOP_API}/api/admin/storefront/media`, {
        method: 'POST',
        headers: authHeaders(false),
        body: form
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        notify('err', body?.message ?? 'Görsel yüklenemedi.')
        return null
      }
      const data = await res.json()
      return `${SHOP_API}${data.url}` as string
    } catch {
      notify('err', 'Görsel yüklenemedi.')
      return null
    }
  }

  const banners = useMemo(() => settings?.banners ?? [], [settings])

  return (
    <div className="p-4 lg:p-6">
      <PageHeader title="Görseller" desc="Anasayfa görselleri ve kampanya bannerları."  />
      <MessageBanner message={message} />

      {settings && (
        <div className="max-w-4xl">
          <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 bg-gradient-to-b from-gray-50 to-white flex items-center gap-2">
              <ImageIcon size={16} className="text-gray-500" />
              <div className="text-sm font-extrabold text-gray-900">Anasayfa görseli</div>
            </div>

            <div className="p-5">
              <div className="flex flex-wrap items-center gap-4">
                <div className="w-40 h-32 rounded-2xl border border-gray-200 bg-gray-50 flex items-center justify-center overflow-hidden">
                  {settings.heroImageUrl ? (
                    <img src={settings.heroImageUrl} alt="" className="max-w-full max-h-full object-contain" />
                  ) : (
                    <span className="text-[11px] text-gray-400 px-3 text-center">
                      Yüklenmedi — öne çıkan ilk ürünün görseli kullanılır
                    </span>
                  )}
                </div>

                <div className="flex flex-col gap-2">
                  <input
                    type="file"
                    accept="image/webp,image/jpeg,image/png"
                    onChange={async (e) => {
                      const file = e.target.files?.[0]
                      if (!file) return
                      const url = await uploadImage(file)
                      if (url) update('heroImageUrl', url)
                      e.target.value = ''
                    }}
                    className="text-sm"
                  />
                  {settings.heroImageUrl && (
                    <button
                      type="button"
                      onClick={() => update('heroImageUrl', null)}
                      className="self-start text-xs font-semibold text-red-600 hover:underline"
                    >
                      Görseli kaldır
                    </button>
                  )}
                  <span className="text-[11px] text-gray-500">webp, jpg veya png · en fazla 4 MB</span>
                  <span className="text-[11px] text-gray-500">
                    Anasayfanın ilk slaytında görünür. Yüklenmezse slayt tek sütun ve ortalanmış
                    olarak çıkar — ilgisiz bir görsel basmaktansa metnin tek başına durması
                    tercih edildi.
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/*
            Logo. Başlıkta bugüne kadar düz yazı ("STILSOFT | DEMO") duruyordu; kurumsal bir
            mağazanın başlığında marka işareti bulunmaması siteyi yarım gösteriyor.
            Yüklenene kadar yazı hâli devrede kalıyor — logosuz bir başlık, bozuk bir görsel
            kutusundan iyidir.
          */}
          <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden mt-4">
            <div className="px-5 py-4 border-b border-gray-100 bg-gradient-to-b from-gray-50 to-white flex items-center gap-2">
              <ImageIcon size={16} className="text-gray-500" />
              <div className="text-sm font-extrabold text-gray-900">Logo (başlıkta görünür)</div>
            </div>

            <div className="p-5">
              <div className="flex flex-wrap items-center gap-4">
                <div className="w-40 h-16 rounded-2xl border border-gray-200 bg-gray-50 flex items-center justify-center overflow-hidden px-3">
                  {settings.logoImageUrl ? (
                    <img src={settings.logoImageUrl} alt="" className="max-w-full max-h-full object-contain" />
                  ) : (
                    <span className="text-[11px] text-gray-400 text-center">Yüklenmedi — yazı logosu kullanılır</span>
                  )}
                </div>

                <div className="flex flex-col gap-2">
                  <input
                    type="file"
                    accept="image/webp,image/jpeg,image/png"
                    onChange={async (e) => {
                      const file = e.target.files?.[0]
                      if (!file) return
                      const url = await uploadImage(file)
                      if (url) update('logoImageUrl', url)
                      e.target.value = ''
                    }}
                    className="text-sm"
                  />
                  {settings.logoImageUrl && (
                    <button
                      type="button"
                      onClick={() => update('logoImageUrl', null)}
                      className="self-start text-xs font-semibold text-red-600 hover:underline"
                    >
                      Logoyu kaldır
                    </button>
                  )}
                  <span className="text-[11px] text-gray-500">
                    Başlıkta 34 piksel yüksekliğinde gösterilir; genişlik oranına göre ayarlanır.
                    Şeffaf zeminli (webp/png) yatay logo en iyi sonucu verir.
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden mt-4">
            <div className="px-5 py-4 border-b border-gray-100 bg-gradient-to-b from-gray-50 to-white flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Store size={16} className="text-gray-500" />
                <div className="text-sm font-extrabold text-gray-900">Kampanya bannerları</div>
              </div>
              <button
                type="button"
                onClick={() =>
                  update('banners', [
                    ...banners,
                    {
                      id: Math.random().toString(36).slice(2),
                      title: 'Yeni kampanya',
                      subtitle: '',
                      imageUrl: null,
                      link: '/urunler',
                      sortOrder: banners.length,
                      isActive: true
                    }
                  ])
                }
                className="h-9 px-4 rounded-xl border border-gray-200 text-xs font-bold text-gray-700 hover:bg-gray-50"
              >
                + Banner ekle
              </button>
            </div>

            <div className="p-5 flex flex-col gap-4">
              {banners.length === 0 && <div className="text-sm text-gray-500">Henüz banner eklenmedi.</div>}

              {banners.map((banner, index) => (
                <div key={banner.id} className="rounded-2xl border border-gray-150 p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <span className={label}>Başlık</span>
                    <input
                      className={input}
                      value={banner.title}
                      onChange={(e) => {
                        const next = [...banners]
                        next[index] = { ...banner, title: e.target.value }
                        update('banners', next)
                      }}
                    />
                  </div>
                  <div>
                    <span className={label}>Alt yazı</span>
                    <input
                      className={input}
                      value={banner.subtitle ?? ''}
                      onChange={(e) => {
                        const next = [...banners]
                        next[index] = { ...banner, subtitle: e.target.value }
                        update('banners', next)
                      }}
                    />
                  </div>
                  <div>
                    <span className={label}>Bağlantı</span>
                    <input
                      className={input}
                      value={banner.link ?? ''}
                      onChange={(e) => {
                        const next = [...banners]
                        next[index] = { ...banner, link: e.target.value }
                        update('banners', next)
                      }}
                    />
                  </div>

                  <div className="flex items-end gap-3">
                    <div className="w-24 h-16 rounded-xl border border-gray-200 bg-gray-50 flex items-center justify-center overflow-hidden shrink-0">
                      {banner.imageUrl ? (
                        <img src={banner.imageUrl} alt="" className="max-w-full max-h-full object-contain" />
                      ) : (
                        <span className="text-[10px] text-gray-400">Görsel yok</span>
                      )}
                    </div>
                    <div className="flex flex-col gap-1">
                      <input
                        type="file"
                        accept="image/webp,image/jpeg,image/png"
                        className="text-xs"
                        onChange={async (e) => {
                          const file = e.target.files?.[0]
                          if (!file) return
                          const url = await uploadImage(file)
                          if (url) {
                            const next = [...banners]
                            next[index] = { ...banner, imageUrl: url }
                            update('banners', next)
                          }
                          e.target.value = ''
                        }}
                      />
                      <div className="flex items-center gap-3">
                        <label className="flex items-center gap-1.5 text-xs font-semibold text-gray-700">
                          <input
                            type="checkbox"
                            checked={banner.isActive}
                            onChange={(e) => {
                              const next = [...banners]
                              next[index] = { ...banner, isActive: e.target.checked }
                              update('banners', next)
                            }}
                          />
                          Yayında
                        </label>
                        <button
                          type="button"
                          onClick={() => update('banners', banners.filter((x) => x.id !== banner.id))}
                          className="text-xs font-semibold text-red-600 hover:underline"
                        >
                          Sil
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 mt-4">
            <button
              type="button"
              disabled={saving}
              onClick={() => void saveSettings()}
              className="h-11 px-5 rounded-2xl bg-gray-900 text-white text-sm font-semibold hover:bg-black disabled:opacity-60 inline-flex items-center gap-2"
            >
              <Save size={16} />
              {saving ? 'Kaydediliyor...' : 'Kaydet'}
            </button>
          </div>
        </div>
      )}

    </div>
  )
}
