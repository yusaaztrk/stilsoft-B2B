'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import type { AccountProfile } from '@/lib/account'

/**
 * Müşterinin kendi bilgilerini düzenlemesi.
 *
 * NEDEN GEREKLİ: mağaza API'sinde `PUT /api/account/profile` baştan beri vardı ve carinin
 * adresini de güncelliyordu, ama vitrinde onu çağıran hiçbir ekran yoktu — "Hesap bilgileri"
 * salt okunurdu ve adresi hiç göstermiyordu. Teslimat da fatura da carideki adrese gittiği için
 * (§6.6b: çok adresli teslimat yok) taşınan müşterinin tek yolu bayiyi aramaktı.
 *
 * E-POSTA DÜZENLENEMİYOR: giriş kimliği o ve e-posta doğrulaması kapalı (§2). Kullanıcının
 * kendi kimliğini doğrulanmamış bir adresle değiştirebilmesi, hesabı yanlış bir adrese
 * taşıyıp geri dönüşü olmayan bir hâle sokması demek olurdu. Cari kodu da aynı sebeple sabit:
 * geçmiş siparişlerin ve faturaların sahibi o.
 *
 * ADRES ZORUNLU DEĞİL ama boşsa uyarı var: siparişin nereye gideceği belirsizken sessiz kalmak,
 * sorunu teslimat gününe ertelemek olurdu.
 */
export default function ProfileForm({ profile }: { profile: AccountProfile }) {
  const router = useRouter()
  const [fullName, setFullName] = useState(profile.fullName ?? '')
  const [phone, setPhone] = useState(profile.phone ?? '')
  const [city, setCity] = useState(profile.city ?? '')
  const [district, setDistrict] = useState(profile.district ?? '')
  const [address, setAddress] = useState(profile.address ?? '')
  const [smsOptOut, setSmsOptOut] = useState(Boolean(profile.smsOptOut))
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setMessage(null)

    if (fullName.trim().length < 3) {
      setMessage({ ok: false, text: 'Ad soyad en az 3 karakter olmalı.' })
      return
    }
    if (phone.trim().length < 7) {
      setMessage({ ok: false, text: 'Telefon numarası eksik görünüyor.' })
      return
    }

    setBusy(true)
    try {
      const res = await fetch('/api/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: fullName.trim(),
          phone: phone.trim(),
          city: city.trim(),
          district: district.trim(),
          address: address.trim(),
          smsOptOut,
        }),
      })
      const data = await res.json().catch(() => null)

      if (!res.ok) {
        setMessage({ ok: false, text: data?.message ?? 'Bilgileriniz kaydedilemedi.' })
        return
      }

      setMessage({ ok: true, text: 'Bilgileriniz güncellendi.' })
      // Sayfadaki diğer alanlar (başlıktaki ad, özet kartı) sunucudan geliyor; tazelenmezse
      // kaydedilen bilgi ekranın bir yerinde eski hâliyle kalırdı.
      router.refresh()
    } catch {
      setMessage({ ok: false, text: 'Bağlantı kurulamadı. Lütfen tekrar deneyin.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="pw-form" onSubmit={submit}>
      <label>
        <span>Ad soyad</span>
        <input value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="name" required />
      </label>

      <label>
        <span>Telefon</span>
        <input value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" required />
      </label>

      <div className="pw-row">
        <label>
          <span>Şehir (KKTC)</span>
          <select value={city || 'Lefkoşa'} onChange={(e) => setCity(e.target.value)} autoComplete="address-level1">
            <option value="Lefkoşa">Lefkoşa</option>
            <option value="Girne">Girne</option>
            <option value="Gazimağusa">Gazimağusa</option>
            <option value="Güzelyurt">Güzelyurt</option>
            <option value="İskele">İskele</option>
            <option value="Lefke">Lefke</option>
          </select>
        </label>
        <label>
          <span>İlçe / Bölge</span>
          <input value={district} onChange={(e) => setDistrict(e.target.value)} placeholder="Örn: Ortaköy, Alsancak vb." autoComplete="address-level2" />
        </label>
      </div>

      <label>
        <span>Teslimat ve fatura adresi</span>
        <textarea
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          rows={3}
          autoComplete="street-address"
          maxLength={500}
        />
      </label>

      <label className="pw-check">
        <input type="checkbox" checked={smsOptOut} onChange={(e) => setSmsOptOut(e.target.checked)} />
        <span>Kampanya ve fırsat SMS'i almak istemiyorum (sipariş bilgilendirmeleri gelmeye devam eder)</span>
      </label>

      {!profile.addressAvailable && (
        <p className="pw-error">
          Adres bilgileriniz şu anda okunamadı. Kaydederseniz yazdığınız bilgiler geçerli olur;
          emin değilseniz kaydetmeden önce sayfayı yenileyin.
        </p>
      )}

      {profile.addressAvailable && !address.trim() && (
        <p className="pw-note">
          Kayıtlı bir teslimat adresiniz yok. Siparişleriniz buraya yazdığınız adrese teslim
          edilip faturası da aynı adrese kesildiği için doldurmanız gerekiyor.
        </p>
      )}

      {message && <p className={message.ok ? 'pw-ok' : 'pw-error'}>{message.text}</p>}

      <button type="submit" className="btn btn-dark btn-sm" disabled={busy}>
        {busy ? 'Kaydediliyor…' : 'Bilgilerimi kaydet'}
      </button>

      <p className="pw-note">
        E-posta adresiniz giriş kimliğiniz olduğu için buradan değiştirilemiyor; değişmesi
        gerekiyorsa bize ulaşın.
      </p>
    </form>
  )
}
