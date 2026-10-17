import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Megaphone, BarChart3, MessageSquare } from 'lucide-react'
import { MessageBanner, PageHeader, SaveBar, input, label, usePanelMessage, useStorefrontSettings } from './shared'

export default function PazarlamaPage() {
  const { message, notify } = usePanelMessage()
  const { settings, update, saveSettings, saving } = useStorefrontSettings(notify)


  return (
    <div className="p-4 lg:p-6">
      <PageHeader title="Pazarlama & Güven" desc="Teslimat/değişim vaatleri, müşteri yorumları, Google yorumları, ölçüm kimlikleri ve sepet hatırlatma SMS'i."  />
      <MessageBanner message={message} />

      {(
        <div className="max-w-4xl">
          {!settings ? (
            <div className="text-sm text-gray-500">Yükleniyor...</div>
          ) : (
            <>
              <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden mt-4">
                <div className="px-5 py-4 border-b border-gray-100 bg-gradient-to-b from-gray-50 to-white flex items-center gap-2">
                  <Megaphone size={16} className="text-gray-500" />
                  <div className="text-sm font-extrabold text-gray-900">Güven ve vaatler (ürün sayfası, sepet, SSS)</div>
                </div>
                <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <span className={label}>Türkiye sitesi adresi (üst şeritte bağlantı)</span>
                    <input className={input} placeholder="https://www.example.com" value={settings.turkeySiteUrl ?? ''} onChange={(e) => update('turkeySiteUrl', e.target.value)} />
                    <div className="mt-1 text-[11px] text-gray-500">Doluysa her sayfanın üstünde "Teslimat yalnız KKTC · Türkiye için …" şeridi çıkar; yanlış siteye gelen Türkiye müşterisi sepete gelmeden ayrılır.</div>
                  </div>
                  <div>
                    <span className={label}>Teslimat vaadi</span>
                    <input className={input} value={settings.deliveryPromise ?? ''} onChange={(e) => update('deliveryPromise', e.target.value)} />
                  </div>
                  <div>
                    <span className={label}>Değişim / iade vaadi</span>
                    <input className={input} value={settings.exchangePolicy ?? ''} onChange={(e) => update('exchangePolicy', e.target.value)} />
                  </div>
                  <div>
                    <span className={label}>Google yorumları bağlantısı</span>
                    <input className={input} placeholder="https://g.page/r/..." value={settings.googleReviewsUrl ?? ''} onChange={(e) => update('googleReviewsUrl', e.target.value)} />
                  </div>
                  <div className="md:col-span-2">
                    <span className={label}>Müşteri yorumları (anasayfa — boşsa bölüm görünmez)</span>
                    <div className="space-y-2">
                      {(settings.testimonials ?? []).map((t, idx) => (
                        <div key={idx} className="grid grid-cols-1 md:grid-cols-5 gap-2 items-start">
                          <input className={input} placeholder="Ad Soyad" value={t.name} onChange={(e) => update('testimonials', (settings.testimonials ?? []).map((a, i) => (i === idx ? { ...a, name: e.target.value } : a)))} />
                          <input className={input} placeholder="Girne / Alsancak" value={t.location} onChange={(e) => update('testimonials', (settings.testimonials ?? []).map((a, i) => (i === idx ? { ...a, location: e.target.value } : a)))} />
                          <input className={`${input} md:col-span-2`} placeholder="Yorum" value={t.text} onChange={(e) => update('testimonials', (settings.testimonials ?? []).map((a, i) => (i === idx ? { ...a, text: e.target.value } : a)))} />
                          <div className="flex items-center gap-2">
                            <input className={input} placeholder="Eylül 2026" value={t.date} onChange={(e) => update('testimonials', (settings.testimonials ?? []).map((a, i) => (i === idx ? { ...a, date: e.target.value } : a)))} />
                            <button type="button" className="text-xs font-semibold text-red-600 hover:text-red-700 whitespace-nowrap" onClick={() => update('testimonials', (settings.testimonials ?? []).filter((_, i) => i !== idx))}>Sil</button>
                          </div>
                        </div>
                      ))}
                      <button type="button" className="text-xs font-semibold text-indigo-700 hover:text-indigo-900" onClick={() => update('testimonials', [...(settings.testimonials ?? []), { name: '', location: '', text: '', date: '', rating: 5 }])}>+ Yorum ekle</button>
                    </div>
                  </div>
                </div>
              </div>
              <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden mt-4">
                <div className="px-5 py-4 border-b border-gray-100 bg-gradient-to-b from-gray-50 to-white flex items-center gap-2">
                  <BarChart3 size={16} className="text-gray-500" />
                  <div className="text-sm font-extrabold text-gray-900">Ölçüm (GA4 · Meta Pixel · Clarity)</div>
                </div>
                <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <span className={label}>Google Analytics 4 (G-XXXX)</span>
                    <input className={input} placeholder="G-XXXXXXXXXX" value={settings.gaMeasurementId ?? ''} onChange={(e) => update('gaMeasurementId', e.target.value)} />
                  </div>
                  <div>
                    <span className={label}>Meta Pixel kimliği</span>
                    <input className={input} placeholder="1234567890" value={settings.metaPixelId ?? ''} onChange={(e) => update('metaPixelId', e.target.value)} />
                  </div>
                  <div>
                    <span className={label}>Microsoft Clarity proje kimliği</span>
                    <input className={input} placeholder="abcdefgh" value={settings.clarityProjectId ?? ''} onChange={(e) => update('clarityProjectId', e.target.value)} />
                    <div className="mt-1 text-[11px] text-gray-500">Üçü de boşsa hiçbir ölçüm betiği basılmaz.</div>
                  </div>
                </div>
              </div>
              <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden mt-4">
                <div className="px-5 py-4 border-b border-gray-100 bg-gradient-to-b from-gray-50 to-white flex items-center gap-2">
                  <MessageSquare size={16} className="text-gray-500" />
                  <div className="text-sm font-extrabold text-gray-900">Sepet hatırlatma SMS'i</div>
                </div>
                <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="md:col-span-2 text-[11px] text-gray-500">Sepete ürün atıp ödemeye gelmeyen üyeye bir kez gider; SMS servisi (TMessage) açık olmalı.</div>
                  <div className="md:col-span-2 rounded-lg border border-gray-200 bg-gray-50/60 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <span className={label}>Sepet hatırlatma SMS'i</span>
                      <label className="inline-flex items-center gap-2 text-xs font-semibold text-gray-700">
                        <input type="checkbox" checked={settings.cartReminderEnabled ?? true} onChange={(e) => update('cartReminderEnabled', e.target.checked)} />
                        Açık
                      </label>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-2 mt-2">
                      <div>
                        <span className={label}>Kaç saat sonra</span>
                        <input className={input} type="number" min={1} max={72} value={settings.cartReminderDelayHours ?? 3} onChange={(e) => update('cartReminderDelayHours', Number(e.target.value) || 3)} />
                      </div>
                      <div className="md:col-span-3">
                        <span className={label}>Metin</span>
                        <textarea className={input} rows={2} value={settings.cartReminderText ?? ''} onChange={(e) => update('cartReminderText', e.target.value)} />
                        <div className="mt-1 text-[11px] text-gray-500">Yer tutucular: {'{ad}'} üye adı · {'{urun}'} ilk ürün · {'{adet}'} satır sayısı · {'{link}'} sepet adresi. Sepete ürün atıp ödemeye gelmeyen üyeye bir kez gider; aynı sepet için tekrar gitmez. SMS servisi açık olmalı.</div>
                      </div>
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
