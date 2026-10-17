'use client'

import { useState } from 'react'
import ServiceProductPicker from '@/components/ServiceProductPicker'

/**
 * /servis sayfasındaki "Online Servis Kaydı" formu.
 *
 * Aynı iletişim formundaki hataya sahipti: `onSubmit` boş, düğme `type="button"` — müşteri
 * arıza/montaj talebini yazıp gönderdiğinde hiçbir yere gitmiyordu (2026-09-05 denetiminde
 * bulundu). Artık `/api/service-request` üzerinden bayinin firma e-postasına iletiliyor.
 */
export default function ServiceRequestForm() {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (busy) return

    const form = e.currentTarget
    const data = new FormData(form)
    const payload = {
      name: String(data.get('name') ?? '').trim(),
      phone: String(data.get('phone') ?? '').trim(),
      city: String(data.get('city') ?? ''),
      category: String(data.get('category') ?? ''),
      model: String(data.get('model') ?? '').trim() || undefined,
      // Seçilen ürünün stok kodu ayrı gidiyor: servis tarafında ürünü tek anlama getiren
      // alan bu. Müşteri "elle yazayım" dediyse boş kalır.
      productStockCode: String(data.get('productStockCode') ?? '').trim() || undefined,
      warranty: String(data.get('warranty') ?? '').trim() || undefined,
      purchaseDate: String(data.get('purchaseDate') ?? '').trim() || undefined,
      invoice: String(data.get('invoice') ?? '').trim() || undefined,
      address: String(data.get('address') ?? '').trim(),
      description: String(data.get('description') ?? '').trim(),
    }

    setBusy(true)
    setResult(null)
    try {
      const res = await fetch('/api/service-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const body = await res.json().catch(() => null)

      if (!res.ok) {
        setResult({ kind: 'err', text: body?.message ?? 'Talebiniz gönderilemedi. Lütfen tekrar deneyin.' })
        return
      }

      setResult({ kind: 'ok', text: 'Servis talebiniz alındı. Ekibimiz randevu için sizi arayacaktır.' })
      form.reset()
    } catch {
      setResult({ kind: 'err', text: 'Bağlantı hatası oluştu. Lütfen tekrar deneyin.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="modern-service-form" onSubmit={onSubmit}>
      <div className="form-row-2">
        <div className="form-group">
          <label htmlFor="srv-name">Adınız Soyadınız *</label>
          <input id="srv-name" name="name" type="text" placeholder="Örn: Mehmet Özkan" className="c-input" required />
        </div>
        <div className="form-group">
          <label htmlFor="srv-phone">Telefon Numaranız *</label>
          <input id="srv-phone" name="phone" type="tel" placeholder="0533 000 00 00" className="c-input" required />
        </div>
      </div>

      <div className="form-row-2">
        <div className="form-group">
          <label htmlFor="srv-city">İlçe / Bölge *</label>
          <select id="srv-city" name="city" className="c-select" required defaultValue="lefkosa">
            <option value="lefkosa">Lefkoşa &amp; Çevresi</option>
            <option value="girne">Girne &amp; Çevresi</option>
            <option value="gazimagusa">Gazimağusa &amp; Çevresi</option>
            <option value="guzelyurt">Güzelyurt &amp; Lefke</option>
            <option value="iskele">İskele &amp; Karpaz</option>
          </select>
        </div>
        <div className="form-group">
          <label htmlFor="srv-category">Ürün Grubu *</label>
          <select id="srv-category" name="category" className="c-select" required defaultValue="ankastre">
            <option value="ankastre">Ankastre Fırın / Ocak / Davlumbaz</option>
            <option value="airfryer">Airfryer &amp; Gıda Hazırlama</option>
            <option value="supurge">Şarjlı Süpürge / Toz Torbasız</option>
            <option value="icecek">Çay &amp; Kahve Makineleri</option>
            <option value="utu">Buharlı &amp; Kazanlı Ütü</option>
            <option value="beyaz-esya">Buzdolabı &amp; Beyaz Eşya</option>
          </select>
        </div>
      </div>

      {/*
        ÜRÜN ARTIK ARANIP SEÇİLİYOR (2026-09-09 kullanıcı isteği: "ürünler elle yazılmayacak,
        arama ile aranıp seçilecek — servisteki arıza modülünü düşünerek yap").

        Serbest metin kutusunda müşteri "fırın", "ST 700 galiba" gibi şeyler yazıyordu;
        servis hangi cihaz için parça hazırlayacağını bilemiyordu. ServiceOps'ta arıza kabul
        yapan personel ürünü arayıp seçiyor, müşteri de aynı şeyi yapıyor.
      */}
      <ServiceProductPicker />

      <div className="form-row-2">
        <div className="form-group">
          <label htmlFor="srv-warranty">Garanti Durumu *</label>
          <select id="srv-warranty" name="warranty" className="c-select" required defaultValue="">
            <option value="" disabled>Seçiniz</option>
            <option value="garantili">Garanti kapsamında (3 yıl içinde alındı)</option>
            <option value="garanti-disi">Garanti süresi doldu</option>
            <option value="bilmiyorum">Bilmiyorum</option>
          </select>
          {/*
            Garanti sorusu ZORUNLU ve üç seçenekli. "Bilmiyorum" bilerek var: müşterinin
            çoğu tarihi hatırlamıyor ve zorlanınca rastgele bir şey seçiyor — yanlış cevap,
            cevapsızlıktan kötü. Kesin karar faturaya bakan serviste veriliyor.
          */}
        </div>
        <div className="form-group">
          <label htmlFor="srv-purchase">Satın Alma Tarihi</label>
          <input id="srv-purchase" name="purchaseDate" type="date" className="c-input" />
        </div>
      </div>

      <div className="form-group">
        <label htmlFor="srv-invoice">Fatura veya Sipariş No</label>
        <input id="srv-invoice" name="invoice" type="text" placeholder="Örn: 2026000123" className="c-input" />
      </div>

      <div className="form-group">
        <label htmlFor="srv-address">Açık Adresiniz *</label>
        <input id="srv-address" name="address" type="text" placeholder="Mahalle, Cadde, Apartman, Kapı No" className="c-input" required />
      </div>

      <div className="form-group">
        <label htmlFor="srv-desc">Arıza veya Talep Açıklaması *</label>
        <textarea
          id="srv-desc"
          name="description"
          rows={4}
          placeholder="Cihazdaki sorunu veya montaj talebinizi kısaca belirtiniz..."
          className="c-textarea"
          required
        />
      </div>

      {result && <div className={result.kind === 'ok' ? 'auth-success' : 'auth-error'}>{result.text}</div>}

      <button type="submit" className="btn btn-dark btn-sm service-submit-btn" disabled={busy}>
        {busy ? 'Gönderiliyor…' : 'Servis Talebini Gönder'}
      </button>
    </form>
  )
}
