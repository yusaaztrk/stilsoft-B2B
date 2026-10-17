import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { LayoutTemplate, Package } from 'lucide-react'
import { MessageBanner, PageHeader, SaveBar, input, label, usePanelMessage, useStorefrontSettings } from './shared'
import { useShopCategories } from './shared'

export default function KategorilerPage() {
  const { message, notify } = usePanelMessage()
  const { settings, update, saveSettings, saving } = useStorefrontSettings(notify)
  const { categories } = useShopCategories()


  return (
    <div className="p-4 lg:p-6">
      <PageHeader title="Kategoriler" desc="Vitrinde görünen kategori adı, sırası, adresi ve arama motoru için tanıtım metinleri."  />
      <MessageBanner message={message} />

      {(
        <div className="max-w-4xl">
          {!settings ? (
            <div className="text-sm text-gray-500">Yükleniyor...</div>
          ) : (
            <>

              {/*
                Kategori yönetimi.

                ERP'deki kategori adları OPERASYONEL: "Elektrikli Ev Aletleri2", "Başlık",
                "Baza", "Şilte" gibi. Depo için anlamlı ama müşteriye gösterilecek adlar değil
                ve menüde göründükleri sürece site derme çatma duruyor.

                ERP'deki ad DEĞİŞTİRİLMİYOR (stok, sipariş ve raporlar ona bağlı); burada
                yalnızca "vitrinde ne yazsın" ve "vitrinde görünsün mü" tutuluyor. Adres de
                ERP adından türemeye devam ediyor — değişseydi verilmiş bağlantılar kırılırdı.
              */}
              <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden mt-4">
                <div className="px-5 py-4 border-b border-gray-100 bg-gradient-to-b from-gray-50 to-white flex items-center gap-2">
                  <LayoutTemplate size={16} className="text-gray-500" />
                  <div className="text-sm font-extrabold text-gray-900">Kategoriler — vitrinde görünen ad ve sıra</div>
                </div>

                <div className="p-5">
                  <div className="text-[11px] text-gray-500 mb-3 leading-relaxed">
                    Soldaki ad ERP'deki kategori adıdır ve değişmez. Sağdaki kutuya yazdığın ad
                    vitrinde görünür. <b className="text-gray-600">Adres</b> kutusu kategorinin
                    internet adresini belirler (<code>/kategori/gida-hazirlama</code> gibi); boş
                    bırakılırsa ERP adından türetilir ve <code>/kategori/g-hazir</code> gibi
                    okunmaz bir adres çıkar. Adresi değiştirmek eski bağlantıları KIRMAZ — eski
                    adres kalıcı olarak yenisine yönlendirilir.
                    <b className="text-gray-600"> Sıra</b> küçükten büyüğe
                    dizilir; 0 bırakılanlar ürün sayısına göre sıralanır.
                    <b className="text-gray-600"> Gizle</b> işaretlenen kategori menüde,
                    anasayfada ve kategori sayfalarında hiç görünmez (ürünleri aramada durur).
                  </div>

                  <div className="space-y-2">
                    {categories.length === 0 && (
                      <div className="text-sm text-gray-500">Kategori bulunamadı.</div>
                    )}

                    {categories.map((category) => {
                      const rule = settings.categoryOverrides?.[category.slug] ?? {}
                      const patch = (next: { displayName?: string; slug?: string; hidden?: boolean; sortOrder?: number }) =>
                        update('categoryOverrides', {
                          ...(settings.categoryOverrides ?? {}),
                          [category.slug]: { ...rule, ...next }
                        })

                      return (
                        <div
                          key={category.slug}
                          className={`flex flex-wrap items-center gap-2 px-3 py-2 rounded-xl border ${
                            rule.hidden ? 'border-gray-200 bg-gray-50 opacity-70' : 'border-gray-100 bg-white'
                          }`}
                        >
                          <div className="min-w-[150px] flex-1">
                            <div className="text-sm font-bold text-gray-800">{category.erpName}</div>
                            <div className="text-[11px] text-gray-400">
                              /kategori/{(rule.slug ?? '').trim() || category.slug} · {category.productCount} ürün
                              {(rule.slug ?? '').trim() && (rule.slug ?? '').trim() !== category.slug && (
                                <span className="ml-1 text-gray-300">(eski: /{category.slug})</span>
                              )}
                            </div>
                          </div>

                          <input
                            className="h-10 px-3 rounded-xl border border-gray-200 text-sm font-semibold w-full sm:w-56"
                            placeholder="Vitrinde görünecek ad"
                            value={rule.displayName ?? ''}
                            onChange={(e) => patch({ displayName: e.target.value })}
                          />

                          {/*
                            Kategori adresi (2026-09-20). ERP kategori adları kısaltma olduğu için
                            adres /kategori/g-hazir gibi çıkıyordu; kimse öyle aramıyor ve menüdeki
                            okunur bağlantılar hiçbir ürüne denk gelmiyordu. Eski adres kırılmaz:
                            vitrin 301 ile yenisine yollar.
                          */}
                          <input
                            className="h-10 px-3 rounded-xl border border-gray-200 text-sm font-semibold w-full sm:w-52"
                            placeholder="Adres (örn. gida-hazirlama)"
                            title="Vitrindeki adres. Boş bırakılırsa ERP adından türetilir. Eski adres 301 ile buraya yönlendirilir."
                            value={rule.slug ?? ''}
                            onChange={(e) => patch({ slug: e.target.value })}
                          />

                          <input
                            type="number"
                            min={0}
                            className="h-10 px-3 rounded-xl border border-gray-200 text-sm font-semibold w-20"
                            title="Sıra (0 = otomatik)"
                            value={rule.sortOrder ?? 0}
                            onChange={(e) => patch({ sortOrder: Number(e.target.value || 0) })}
                          />

                          <label className="flex items-center gap-1.5 text-xs font-bold text-gray-600 px-2">
                            <input
                              type="checkbox"
                              checked={rule.hidden ?? false}
                              onChange={(e) => patch({ hidden: e.target.checked })}
                            />
                            Gizle
                          </label>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>

              {/*
                Kategori tanıtım metinleri.
                Yalnız ürün listesinden ibaret bir kategori sayfası, aynı ürünleri listeleyen
                yüzlerce sayfa arasından ayırt edilemiyor. Metin arama sıralamasını doğrudan
                etkiliyor; boş bırakılırsa sayfa yine çalışır, sadece ayırt edici olmaz.
              */}
              <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden mt-4">
                <div className="px-5 py-4 border-b border-gray-100 bg-gradient-to-b from-gray-50 to-white flex items-center gap-2">
                  <Package size={16} className="text-gray-500" />
                  <div className="text-sm font-extrabold text-gray-900">Kategori tanıtım metinleri (arama motoru için)</div>
                </div>

                <div className="p-5 space-y-4">
                  {categories.length === 0 && (
                    <div className="text-sm text-gray-500">Kategori bulunamadı.</div>
                  )}

                  {categories.map((category) => {
                    const value = settings.categoryTexts?.[category.slug] ?? ''
                    return (
                      <div key={category.slug}>
                        <span className={label}>
                          {settings.categoryOverrides?.[category.slug]?.displayName?.trim() || category.erpName}
                          <span className="ml-2 font-normal normal-case tracking-normal text-gray-400">
                            /kategori/{category.slug} · {category.productCount} ürün
                          </span>
                        </span>
                        <textarea
                          className={`${input} h-auto py-3`}
                          rows={3}
                          placeholder="Bu kategoriyi tanıtan birkaç cümle. İlk 160 karakter arama sonucunda görünür."
                          value={value}
                          onChange={(e) =>
                            update('categoryTexts', {
                              ...(settings.categoryTexts ?? {}),
                              [category.slug]: e.target.value
                            })
                          }
                        />
                        <div className="text-[11px] text-gray-400 mt-1 ml-1">
                          {value.trim().length} karakter
                          {value.trim().length > 0 && value.trim().length < 120 && ' — 120 karakterin altı arama sonucunda zayıf kalır'}
                        </div>
                      </div>
                    )
                  })}
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
