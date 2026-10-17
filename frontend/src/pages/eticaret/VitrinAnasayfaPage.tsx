import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { LayoutTemplate, Info } from 'lucide-react'
import { MessageBanner, PageHeader, SaveBar, input, label, usePanelMessage, useStorefrontSettings } from './shared'

export default function VitrinAnasayfaPage() {
  const { message, notify } = usePanelMessage()
  const { settings, update, saveSettings, saving } = useStorefrontSettings(notify)


  return (
    <div className="p-4 lg:p-6">
      <PageHeader title="Anasayfa & Vitrin" desc="Anasayfa üst alanı, telefon/WhatsApp, öne çıkan ürün sayısı, stok gösterimi ve yayın kuralları."  />
      <MessageBanner message={message} />

      {(
        <div className="max-w-4xl">
          {!settings ? (
            <div className="text-sm text-gray-500">Yükleniyor...</div>
          ) : (
            <>
              <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
                <div className="px-5 py-4 border-b border-gray-100 bg-gradient-to-b from-gray-50 to-white flex items-center gap-2">
                  <LayoutTemplate size={16} className="text-gray-500" />
                  <div className="text-sm font-extrabold text-gray-900">Anasayfa üst alanı</div>
                </div>

                <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <span className={label}>Üst etiket</span>
                    <input className={input} value={settings.heroKicker} onChange={(e) => update('heroKicker', e.target.value)} />
                  </div>
                  <div>
                    <span className={label}>Telefon</span>
                    <input className={input} value={settings.phoneNumber} onChange={(e) => update('phoneNumber', e.target.value)} />
                  </div>

                  <div>
                    <span className={label}>WhatsApp Numarası</span>
                    <input
                      className={input}
                      placeholder="Örn: 905338408837"
                      value={settings.whatsAppNumber ?? ''}
                      onChange={(e) => update('whatsAppNumber', e.target.value)}
                    />
                    <div className="text-[11px] text-gray-500 mt-1 ml-1">
                      Ülke koduyla, boşluksuz yazılır. Sitedeki yüzen WhatsApp butonu bu numarayı kullanır — telefon
                      alanından ayrı, çünkü o alan sabit hat olabilir. Boş bırakılırsa buton görünmez.
                    </div>
                  </div>

                  <div className="md:col-span-2">
                    <span className={label}>Başlık</span>
                    <input className={input} value={settings.heroTitle} onChange={(e) => update('heroTitle', e.target.value)} />
                    <div className="text-[11px] text-gray-500 mt-1 ml-1">
                      Aşağıdaki kelime başlıkta kalın gösterilir.
                    </div>
                  </div>

                  <div>
                    <span className={label}>Kalın gösterilecek kelime</span>
                    <input
                      className={input}
                      value={settings.heroTitleStrong}
                      onChange={(e) => update('heroTitleStrong', e.target.value)}
                    />
                  </div>

                  <div>
                    <span className={label}>Buton yazısı</span>
                    <input className={input} value={settings.heroButtonText} onChange={(e) => update('heroButtonText', e.target.value)} />
                  </div>

                  <div className="md:col-span-2">
                    <span className={label}>Açıklama</span>
                    <textarea
                      className={`${input} h-auto py-3`}
                      rows={3}
                      value={settings.heroText}
                      onChange={(e) => update('heroText', e.target.value)}
                    />
                  </div>

                  <div>
                    <span className={label}>Buton bağlantısı</span>
                    <input className={input} value={settings.heroButtonLink} onChange={(e) => update('heroButtonLink', e.target.value)} />
                  </div>

                  <div>
                    <span className={label}>Öne çıkan ürün sayısı</span>
                    <input
                      type="number"
                      min={4}
                      max={24}
                      className={input}
                      value={settings.featuredCount}
                      onChange={(e) => update('featuredCount', Number(e.target.value || 8))}
                    />
                  </div>

                  {/*
                    ÇOK SATANLAR ŞERİDİ (2026-09-21 kullanıcı isteği: "çok satan ürünleri
                    nereden ayarlayacağız").

                    Bölüm bugüne kadar tamamen otomatikti: son 90 günün gerçek sipariş
                    adetleri. Dürüst ama yönlendirilemez — "bu ay beyaz eşya öne çıksın"
                    denemiyordu. Kutu BOŞ bırakılırsa eski davranış aynen sürüyor.
                  */}
                  <div className="md:col-span-2">
                    <span className={label}>&quot;Çok satanlar&quot; şeridine elle ürün koy</span>
                    <textarea
                      rows={2}
                      className={input}
                      placeholder="Stok kodlarını virgülle ayırın — örn: SBE90575, SBE92002, STV70734"
                      value={(settings.bestSellerStockCodes ?? []).join(', ')}
                      onChange={(e) =>
                        update(
                          'bestSellerStockCodes',
                          e.target.value
                            .split(',')
                            .map((x) => x.trim())
                            .filter(Boolean)
                        )
                      }
                    />
                    <p className="mt-1 text-[11px] text-gray-500">
                      <b>Boş bırakırsanız</b> şerit son 90 günün gerçek satış adetlerinden
                      kendiliğinden dolar ve başlık &quot;Son 3 Ayın En Çok Satanları&quot; olur.
                      {' '}Kod girerseniz şerit tam olarak bu sıradaki ürünleri gösterir ve başlık
                      {' '}<b>&quot;Bu Ayın Öne Çıkanları&quot;</b>na döner — elle seçilmiş ürüne
                      &quot;en çok satan&quot; demek müşteriye yanlış bilgi vermek olurdu.
                      {' '}Yayında olmayan kod (stoğu bitmiş, fotoğrafı yok) sessizce elenir.
                    </p>
                  </div>

                  <div>
                    <span className={label}>&quot;Son N adet&quot; uyarı eşiği</span>
                    <input
                      type="number"
                      min={1}
                      max={50}
                      className={input}
                      value={settings.lowStockThreshold ?? 5}
                      onChange={(e) => update('lowStockThreshold', Number(e.target.value || 5))}
                    />
                    <p className="mt-1 text-[11px] text-gray-500">
                      Stok bu sayının altına düştüğünde ürün kartında turuncu &quot;Son N adet&quot; uyarısı çıkar.
                      Adedi göstermeyi kapatsanız bile çalışır.
                    </p>
                  </div>

                  <div className="md:col-span-2 flex flex-wrap gap-5 pt-1">
                    <label className="flex items-center gap-2 text-sm font-semibold text-gray-700">
                      <input
                        type="checkbox"
                        checked={settings.showCategories}
                        onChange={(e) => update('showCategories', e.target.checked)}
                      />
                      Kategoriler bölümü görünsün
                    </label>
                    <label className="flex items-center gap-2 text-sm font-semibold text-gray-700">
                      <input
                        type="checkbox"
                        checked={settings.showFeatured}
                        onChange={(e) => update('showFeatured', e.target.checked)}
                      />
                      Öne çıkan ürünler görünsün
                    </label>
                  </div>

                  {/*
                    STOK GÖRÜNÜRLÜĞÜ VE STOKSUZ SATIŞ.
                    İkisi ayrı karar: birincisi müşteri kaç adet kaldığını görsün mü,
                    ikincisi stok bittiğinde satış devam etsin mi. Vitrin bugüne kadar
                    "Tükendi" yazıp yine de sepete eklenmeye izin veriyordu.
                  */}
                  <div className="md:col-span-2 rounded-xl border border-gray-200 bg-gray-50 p-4">
                    <div className="text-xs font-black text-gray-700 uppercase tracking-wide mb-3">
                      Stok
                    </div>
                    <div className="flex flex-col gap-3">
                      <label className="flex items-start gap-2 text-sm font-semibold text-gray-700">
                        <input
                          type="checkbox"
                          className="mt-1"
                          checked={settings.showStockQuantity ?? false}
                          onChange={(e) => update('showStockQuantity', e.target.checked)}
                        />
                        <span>
                          Kalan adet müşteriye gösterilsin
                          <span className="block text-[11px] font-normal text-gray-500">
                            Kapalıyken yalnızca &quot;Stokta / Tükendi&quot; yazar; adet mağaza
                            API&apos;sinden hiç çıkmaz.
                          </span>
                        </span>
                      </label>

                      {settings.showStockQuantity ? (
                        <div className="pl-6">
                          <span className={label}>Gösterim tavanı</span>
                          <input
                            type="number"
                            min={0}
                            max={999}
                            className={input}
                            value={settings.stockDisplayCap ?? 12}
                            onChange={(e) => update('stockDisplayCap', Number(e.target.value || 0))}
                          />
                          <p className="mt-1 text-[11px] text-gray-500">
                            Fatura, proforma ve depo transferi ekranlarındaki kuralın aynısı:
                            12 iken stok 5 ise &quot;5&quot;, 11 ise &quot;11&quot;, 12 ve
                            üzeri ise &quot;12+&quot; yazar. Gerçek adet müşteriye hiç
                            gönderilmez. 0 yazarsan tavan uygulanmaz.
                          </p>
                        </div>
                      ) : null}
                      <label className="flex items-start gap-2 text-sm font-semibold text-gray-700">
                        <input
                          type="checkbox"
                          className="mt-1"
                          checked={settings.allowOutOfStockOrders ?? false}
                          onChange={(e) => update('allowOutOfStockOrders', e.target.checked)}
                        />
                        <span>
                          Stokta olmayan ürün de sipariş edilebilsin
                          <span className="block text-[11px] font-normal text-gray-500">
                            Kapalı tutulması önerilir: açıkken müşteri teslim edemeyeceğiniz
                            ürünün parasını ödeyebilir.
                          </span>
                        </span>
                      </label>

                      {/*
                        YAYIN KURALLARI (2026-09-09).
                        Önceden vitrin kataloğu stok durumuna hiç bakmıyordu: tükenen ürün
                        "Tükendi" rozetiyle listede kalıyor, B2B'de bayiye satışa kapanmış
                        ürün ise vitrinde satılmaya devam ediyordu. İki kanalın aynı ürünü
                        farklı kurallarla satması, satılamayan siparişin kaynağıydı.
                      */}
                      <label className="flex items-start gap-2 text-sm font-semibold text-gray-700">
                        <input
                          type="checkbox"
                          className="mt-1"
                          checked={settings.hideOutOfStock ?? true}
                          onChange={(e) => update('hideOutOfStock', e.target.checked)}
                        />
                        <span>
                          Stoğu biten ürün vitrinde hiç görünmesin
                          <span className="block text-[11px] font-normal text-gray-500">
                            Açıkken tükenen ürün listeden de arama sonuçlarından da kalkar;
                            stok gelince kendiliğinden geri döner. Kapatırsan ürün
                            &quot;Tükendi&quot; rozetiyle listede kalır.
                          </span>
                        </span>
                      </label>

                      {/*
                        RENK GRUPLAMA (2026-09-20). ERP'de her renk ayrı stok kodu olduğu için
                        vitrinde aynı ürün iki (bazen üç) kart olarak duruyordu. KAPALI
                        başlıyor: gruplama ürün ADINA bakan bir sezgi, bayi sonucu görüp açsın.
                      */}
                      <label className="flex items-start gap-2 text-sm font-semibold text-gray-700">
                        <input
                          type="checkbox"
                          className="mt-1"
                          checked={settings.groupColorVariants ?? false}
                          onChange={(e) => update('groupColorVariants', e.target.checked)}
                        />
                        <span>
                          Aynı ürünün renkleri listede tek kart olsun
                          <span className="block text-[11px] font-normal text-gray-500">
                            ERP'de her renk ayrı stok kodu; vitrinde aynı ürün iki kart olarak
                            görünüyor. Açıkken listede tek kart çıkar (&quot;3 renk&quot;
                            rozetiyle), renk seçimi ürün sayfasında yapılır. Ürünlerin kendi
                            adresleri, araması ve sepeti değişmez. Gruplama ürün adına bakarak
                            çalışır; yanlış birleştirdiğini görürsen kapatman yeter.
                          </span>
                        </span>
                      </label>

                      <label className="flex items-start gap-2 text-sm font-semibold text-gray-700">
                        <input
                          type="checkbox"
                          className="mt-1"
                          checked={settings.stopPublishingBelowCriticalStock ?? true}
                          onChange={(e) => update('stopPublishingBelowCriticalStock', e.target.checked)}
                        />
                        <span>
                          Kritik stok eşiğinin altına düşünce yayın otomatik dursun
                          <span className="block text-[11px] font-normal text-gray-500">
                            Eşik ürün kartındaki <b>Satışa Kapanma Eşiği</b> (varsayılan 12;
                            0 yazılan üründe eşik uygulanmaz) — B2B'de bayiye satışı kapatan
                            sayının aynısı. Ürün Yönetimi sekmesinde hangi ürünlerin bu
                            yüzden durduğunu görebilir, tek tek muaf tutabilirsin.
                          </span>
                        </span>
                      </label>

                      <label className="flex items-start gap-2 text-sm font-semibold text-gray-700">
                        <input
                          type="checkbox"
                          className="mt-1"
                          checked={settings.hideClosedToSale ?? true}
                          onChange={(e) => update('hideClosedToSale', e.target.checked)}
                        />
                        <span>
                          Ürün kartında “Satışa Açık: Hayır” olanlar vitrinde görünmesin
                          <span className="block text-[11px] font-normal text-gray-500">
                            Bu, stoktan bağımsız <b>elle</b> konan bir işaret. Kapatırsan
                            satışa kapalı işaretli ürünler internetten satılmaya devam eder —
                            B2B'de bayiye kapalı olsalar bile. Canlıda bu işaretli ürün sayısı
                            beklediğinden fazla olabilir, Ürün Yönetimi sekmesindeki
                            <b> Satışa kapalı</b> kutusundan görebilirsin.
                          </span>
                        </span>
                      </label>

                      {(settings.alwaysPublishStockCodes?.length ?? 0) > 0 && (
                        <div className="rounded-xl bg-blue-50 border border-blue-100 px-3 py-2 text-[11px] text-blue-900">
                          <b>{settings.alwaysPublishStockCodes?.length}</b> ürün kritik stok
                          kuralından muaf tutuldu. Listesi Ürün Yönetimi sekmesinde
                          &quot;Kritik Muafiyet&quot; sütununda.
                        </div>
                      )}
                    </div>
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
