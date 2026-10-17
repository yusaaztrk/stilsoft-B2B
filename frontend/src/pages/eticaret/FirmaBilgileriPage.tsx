import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Store } from 'lucide-react'
import { MessageBanner, PageHeader, SaveBar, input, label, usePanelMessage, useStorefrontSettings } from './shared'

export default function FirmaBilgileriPage() {
  const { message, notify } = usePanelMessage()
  const { settings, update, saveSettings, saving } = useStorefrontSettings(notify)


  return (
    <div className="p-4 lg:p-6">
      <PageHeader title="Firma & İletişim" desc="Yasal metinlerde görünen firma bilgileri, destek e-postası, sosyal medya, harita ve çalışma saatleri."  />
      <MessageBanner message={message} />

      {(
        <div className="max-w-4xl">
          {!settings ? (
            <div className="text-sm text-gray-500">Yükleniyor...</div>
          ) : (
            <>
              {/*
                Yasal metinlerdeki satıcı bilgileri.
                Sözleşme ve politika sayfalarında satıcının kim olduğu yazılı olmak zorunda;
                bu alanlar boşken o sayfalar "yayına hazır değil" uyarısı gösteriyor.
              */}
              <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden mt-4">
                <div className="px-5 py-4 border-b border-gray-100 bg-gradient-to-b from-gray-50 to-white flex items-center gap-2">
                  <Store size={16} className="text-gray-500" />
                  <div className="text-sm font-extrabold text-gray-900">Firma bilgileri (yasal metinlerde görünür)</div>
                </div>

                <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <span className={label}>Firma unvanı</span>
                    <input
                      className={input}
                      placeholder="Örn. Stilsoft Ltd."
                      value={settings.companyName ?? ''}
                      onChange={(e) => update('companyName', e.target.value)}
                    />
                  </div>
                  <div>
                    <span className={label}>E-posta</span>
                    <input
                      className={input}
                      placeholder="info@..."
                      value={settings.companyEmail ?? ''}
                      onChange={(e) => update('companyEmail', e.target.value)}
                    />
                  </div>
                  <div className="md:col-span-2">
                    <span className={label}>Adres</span>
                    <textarea
                      className={`${input} h-auto py-3`}
                      rows={2}
                      value={settings.companyAddress ?? ''}
                      onChange={(e) => update('companyAddress', e.target.value)}
                    />
                  </div>
                  <div className="md:col-span-2">
                    <span className={label}>Vergi dairesi ve numarası</span>
                    <input
                      className={input}
                      value={settings.companyTaxInfo ?? ''}
                      onChange={(e) => update('companyTaxInfo', e.target.value)}
                    />
                  </div>

                  <div className="md:col-span-2">
                    <span className={label}>Destek e-postası (form mesajları buraya düşer)</span>
                    <input
                      className={input}
                      placeholder="support@example.com"
                      value={settings.supportEmail ?? ''}
                      onChange={(e) => update('supportEmail', e.target.value)}
                    />
                    <div className="mt-1 text-[11px] text-gray-500">
                      İletişim ve yetkili servis formlarından gelen mesajlar bu kutuya gider.
                      Boş bırakılırsa yukarıdaki firma e-postası kullanılır.
                    </div>
                  </div>

                  <div className="md:col-span-2 text-[11px] text-gray-500">
                    Bu alanlar mesafeli satış sözleşmesi, gizlilik politikası, KVKK metni ve
                    iletişim sayfasında görünür. Boş bırakılırsa sayfalar eksik olduklarını
                    ziyaretçiye yazar.
                  </div>
                  <div className="md:col-span-2 border-t border-gray-100 pt-4 -mb-1 text-xs font-bold text-gray-700">
                    Sosyal medya ve harita
                  </div>
                  <div>
                    <span className={label}>Instagram adresi</span>
                    <input
                      className={input}
                      placeholder="https://www.instagram.com/"
                      value={settings.instagramUrl ?? ''}
                      onChange={(e) => update('instagramUrl', e.target.value)}
                    />
                  </div>
                  <div>
                    <span className={label}>Facebook adresi</span>
                    <input
                      className={input}
                      placeholder="https://www.facebook.com/"
                      value={settings.facebookUrl ?? ''}
                      onChange={(e) => update('facebookUrl', e.target.value)}
                    />
                  </div>
                  <div>
                    <span className={label}>YouTube adresi</span>
                    <input
                      className={input}
                      placeholder="https://www.youtube.com/"
                      value={settings.youtubeUrl ?? ''}
                      onChange={(e) => update('youtubeUrl', e.target.value)}
                    />
                  </div>
                  <div className="md:col-span-2">
                    <span className={label}>Merkez ofis haritası (iframe kodu ya da src adresi)</span>
                    <textarea
                      className={`${input} h-auto py-3 font-mono text-[11px]`}
                      rows={3}
                      placeholder='<iframe src="https://www.google.com/maps/embed?..."></iframe>'
                      value={settings.mapsEmbedSrc ?? ''}
                      onChange={(e) => update('mapsEmbedSrc', e.target.value)}
                    />
                    <div className="text-[11px] text-gray-500 mt-1 ml-1">
                      <b className="text-gray-600">Altbilgide (footer) ve iletişim sayfasında</b> gösterilir.
                      Google Haritalar'da "Paylaş → Haritayı yerleştir" ile kopyalanan tam kodu
                      yapıştırabilirsiniz; sistem yalnızca <code>src</code> adresini alır. Yalnızca
                      google.com/maps/embed adresleri kabul edilir. Boşsa harita hiç çıkmaz.
                    </div>
                  </div>

                  {/*
                    Showroom haritası AYRI (2026-09-09).
                    Mağaza ile merkez ofis farklı adreslerde; tek harita varken müşteri
                    mağazaya gitmek isterken ofise gidebiliyordu.
                  */}
                  <div className="md:col-span-2">
                    <span className={label}>Showroom (mağaza) haritası</span>
                    <textarea
                      className={`${input} h-auto py-3 font-mono text-[11px]`}
                      rows={3}
                      placeholder='<iframe src="https://www.google.com/maps/embed?..."></iframe>'
                      value={settings.showroomMapsEmbedSrc ?? ''}
                      onChange={(e) => update('showroomMapsEmbedSrc', e.target.value)}
                    />
                    <div className="text-[11px] text-gray-500 mt-1 ml-1">
                      İletişim sayfasında merkez ofisin <b className="text-gray-600">yanında</b>
                      {' '}gösterilir. Boşsa yalnızca merkez ofis haritası çıkar.
                    </div>
                  </div>

                  <div className="md:col-span-2">
                    <span className={label}>Çalışma saatleri</span>
                    <textarea
                      className={`${input} h-auto py-3 font-mono text-[12px]`}
                      rows={7}
                      placeholder={'Pazartesi|08:00 - 18:00\nCumartesi|08:00 - 15:00\nPazar|Kapalı'}
                      value={settings.workingHours ?? ''}
                      onChange={(e) => update('workingHours', e.target.value)}
                    />
                    <div className="text-[11px] text-gray-500 mt-1 ml-1">
                      Her satır bir gün: <code>Gün|Saat</code>. İletişim sayfasında tablo olarak,
                      altbilgide ve sipariş takibinde tek satırlık özet olarak çıkar (aynı saatteki
                      ardışık günler birleştirilir). Ayırıcı koymadan yazılan satır olduğu gibi basılır —
                      bayram duyurusu gibi. Boş bırakılırsa saat hiç gösterilmez.
                    </div>
                  </div>

                  <div className="md:col-span-2 text-[11px] text-gray-500">
                    Sosyal medya alanları boş bırakılırsa footer ve iletişim sayfası gerçek
                    Stilsoft KKTC hesaplarını kullanır.
                  </div>
                </div>
              </div>
              <SaveBar saving={saving} onSave={() => void saveSettings()} />
            </>
          )}
        </div>
      )}

    </div>
  )
}
