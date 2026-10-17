import { useEffect, useState, useMemo } from 'react'
import { getMemberToken, readApiResponse } from '../lib/api'
import { useSEO } from '../hooks/useSEO'

export function ContactPage() {
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [subject, setSubject] = useState('Ürün Bilgisi')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const [design, setDesign] = useState({
    sitePhone: '',
    siteEmail: '',
    siteAddress: '',
    sitePhoneDesc: '',
    siteEmailDesc: '',
    siteAddressDesc: '',
  })

  useEffect(() => {
    // 1. Try to load initial design settings from localStorage
    try {
      const cached = localStorage.getItem('ecom_store_design')
      if (cached) {
        const parsed = JSON.parse(cached)
        setDesign({
          sitePhone: parsed.sitePhone || '',
          siteEmail: parsed.siteEmail || '',
          siteAddress: parsed.siteAddress || '',
          sitePhoneDesc: parsed.sitePhoneDesc || '',
          siteEmailDesc: parsed.siteEmailDesc || '',
          siteAddressDesc: parsed.siteAddressDesc || '',
        })
      }
    } catch (e) {
      // Ignore
    }

    // 2. Fetch latest store-design configuration from API
    fetch('/api/store-design')
      .then((res) => res.json())
      .then((json) => {
        if (json?.data) {
          setDesign({
            sitePhone: json.data.sitePhone || '',
            siteEmail: json.data.siteEmail || '',
            siteAddress: json.data.siteAddress || '',
            sitePhoneDesc: json.data.sitePhoneDesc || '',
            siteEmailDesc: json.data.siteEmailDesc || '',
            siteAddressDesc: json.data.siteAddressDesc || '',
          })
        }
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    const token = getMemberToken()
    if (!token) return

    ;(async () => {
      try {
        const res = await fetch('/api/auth/me', {
          headers: { Authorization: `Bearer ${token}` }
        })
        const json = await readApiResponse(res)
        if (res.ok && json?.success && json?.data) {
          setFullName(json.data.fullName || '')
          setEmail(json.data.email || '')
        }
      } catch {
        // Silently fail if unable to fetch user profile
      }
    })()
  }, [])

  const schema = useMemo(() => ({
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    'name': 'Stilsoft KKTC',
    'telephone': design.sitePhone || '0850 000 00 00',
    'email': design.siteEmail || 'info@example.com',
    'address': {
      '@type': 'PostalAddress',
      'streetAddress': design.siteAddress || 'İkitelli OSB, Mutfakçılar Sitesi No: 123, Başakşehir / İstanbul',
    },
    'openingHours': 'Mo-Fr 09:00-18:00',
    'url': window.location.origin + '/iletisim'
  }), [design])

  useSEO({
    title: 'İletişim',
    description: 'Stilsoft KKTC iletişim bilgileri. Müşteri hizmetleri, teknik destek ve genel müdürlük adres ve telefon bilgileri.',
    schema
  })

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setStatusMsg(null)

    const cleanedPhone = phone.replace(/\D/g, '')
    if (cleanedPhone.length !== 11) {
      setStatusMsg({ type: 'error', text: 'Telefon numarası tam olarak 11 haneli olmalıdır (Örn: 05001234567).' })
      setLoading(false)
      return
    }

    try {
      const res = await fetch('/api/storefront/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fullName, email, phone: cleanedPhone, subject, message })
      })
      const json = await readApiResponse(res)
      if (!res.ok || !json?.success) {
        throw new Error(json?.message || 'Mesajınız gönderilemedi.')
      }

      setStatusMsg({ type: 'success', text: json.message || 'Mesajınız başarıyla iletildi!' })
      const token = getMemberToken()
      if (!token) {
        setFullName('')
        setEmail('')
      }
      setPhone('')
      setSubject('Ürün Bilgisi')
      setMessage('')
    } catch (err) {
      setStatusMsg({ type: 'error', text: err instanceof Error ? err.message : 'Bir hata oluştu.' })
    } finally {
      setLoading(false)
    }
  }

  // Format tel link to remove spaces
  const telHref = design.sitePhone ? `tel:${design.sitePhone.replace(/\s+/g, '')}` : 'tel:08500000000'
  const emailHref = design.siteEmail ? `mailto:${design.siteEmail}` : 'mailto:info@example.com'

  return (
    <div className="pb-20">
      {/* Hero */}
      <section className="relative h-[420px] flex items-center justify-center overflow-hidden bg-on-surface">
        <div className="absolute inset-0 opacity-30">
          <img className="w-full h-full object-cover" src="https://lh3.googleusercontent.com/aida-public/AB6AXuDSNP2fHFRpOCxqkM7_Jm9e7pzdThhSEIqJ2B5Qq6QOokxWq2aTdwifQe695uqOSlTl4MTI5xJLZXWz59tzRj2nMlfLgLWw1Ow0_tTAsEvgcN8ivjDvvYscAyxDP3owFZrYaxzjRNX3WCiWZd79AUKJbI_ZRmqlbhDIuQXkar2E62uKLEZw9mmxYFMyC_cVVESzcxqKwgE6FA3QJcOIaENSVtPvjoeVlPdRgKNZkeHK7lkXBQlgqMTY6A55IyBmM7PSsjzWEuy638o" alt="Kurumsal ofis" />
        </div>
        <div className="relative z-10 text-center px-6">
          <span className="inline-block px-4 py-1.5 bg-primary text-white text-[10px] font-bold uppercase tracking-[0.2em] rounded-full mb-6">İLETİŞİM</span>
          <h1 className="text-4xl md:text-5xl font-bold text-white mb-4 tracking-tight">Size Nasıl Yardımcı Olabiliriz?</h1>
          <p className="text-lg text-zinc-300 max-w-2xl mx-auto leading-relaxed">Sorularınız, önerileriniz veya teknik destek ihtiyaçlarınız için profesyonel ekibimizle her zaman yanınızdayız.</p>
        </div>
      </section>

      {/* Contact Cards */}
      <section className="max-w-7xl mx-auto px-6 -mt-16 relative z-20 mb-16">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {/* Card 1: Müşteri Hizmetleri */}
          <div className="bg-white p-8 rounded-xl shadow-xl border border-zinc-100 flex flex-col items-center text-center group hover:-translate-y-1 transition-all duration-300 justify-between min-h-[280px]">
            <div className="flex flex-col items-center">
              <div className="w-16 h-16 bg-primary/5 text-primary rounded-2xl flex items-center justify-center mb-6 group-hover:bg-primary group-hover:text-white transition-colors">
                <span className="material-symbols-outlined text-3xl">headset_mic</span>
              </div>
              <h3 className="text-xl font-bold text-on-surface mb-2">Müşteri Hizmetleri</h3>
              <p className="text-zinc-500 text-sm mb-4">
                {design.sitePhoneDesc || 'Hafta içi 09:00 - 18:00 saatleri arasında kesintisiz destek.'}
              </p>
            </div>
            <a className="text-2xl font-bold text-primary" href={telHref}>
              {design.sitePhone || '0850 000 00 00'}
            </a>
          </div>

          {/* Card 2: Teknik Servis */}
          <div className="bg-white p-8 rounded-xl shadow-xl border border-zinc-100 flex flex-col items-center text-center group hover:-translate-y-1 transition-all duration-300 justify-between min-h-[280px]">
            <div className="flex flex-col items-center">
              <div className="w-16 h-16 bg-primary/5 text-primary rounded-2xl flex items-center justify-center mb-6 group-hover:bg-primary group-hover:text-white transition-colors">
                <span className="material-symbols-outlined text-3xl">build</span>
              </div>
              <h3 className="text-xl font-bold text-on-surface mb-2">Teknik Servis</h3>
            </div>
            <a className="text-sm font-bold text-on-surface border-b-2 border-primary pb-1 hover:text-primary transition-colors" href="/teknik-servis">Servis Sorgulama</a>
          </div>

          {/* Card 3: Genel Müdürlük (E-posta) */}
          <div className="bg-white p-8 rounded-xl shadow-xl border border-zinc-100 flex flex-col items-center text-center group hover:-translate-y-1 transition-all duration-300 justify-between min-h-[280px]">
            <div className="flex flex-col items-center w-full">
              <div className="w-16 h-16 bg-primary/5 text-primary rounded-2xl flex items-center justify-center mb-6 group-hover:bg-primary group-hover:text-white transition-colors">
                <span className="material-symbols-outlined text-3xl">mail</span>
              </div>
              <h3 className="text-xl font-bold text-on-surface mb-2">Genel Müdürlük</h3>
              <p className="text-zinc-500 text-sm mb-4">
                {design.siteEmailDesc || 'Soru ve önerileriniz için e-posta gönderin.'}
              </p>
            </div>
            <a className="text-sm font-bold text-on-surface hover:text-primary transition-colors break-all" href={emailHref}>
              {design.siteEmail || 'info@example.com'}
            </a>
          </div>

          {/* Card 4: Adres Bilgisi */}
          <div className="bg-white p-8 rounded-xl shadow-xl border border-zinc-100 flex flex-col items-center text-center group hover:-translate-y-1 transition-all duration-300 justify-between min-h-[280px]">
            <div className="flex flex-col items-center">
              <div className="w-16 h-16 bg-primary/5 text-primary rounded-2xl flex items-center justify-center mb-6 group-hover:bg-primary group-hover:text-white transition-colors">
                <span className="material-symbols-outlined text-3xl">location_on</span>
              </div>
              <h3 className="text-xl font-bold text-on-surface mb-2">Adres Bilgisi</h3>
              <p className="text-zinc-500 text-sm mb-4">
                {design.siteAddressDesc || 'Merkez ofis ve mağaza adres bilgilerimiz.'}
              </p>
            </div>
            <span className="text-sm font-semibold text-zinc-700 leading-relaxed">
              {design.siteAddress || 'İkitelli OSB, Mutfakçılar Sitesi No: 123, Başakşehir / İstanbul'}
            </span>
          </div>
        </div>
      </section>

      {/* Form Section */}
      <section className="max-w-3xl mx-auto px-6 mb-16">
        <div className="bg-surface-container-low p-10 rounded-2xl border border-zinc-100 shadow-sm">
          <h2 className="text-3xl font-bold text-on-surface mb-2">Bize Mesaj Gönderin</h2>
          <p className="text-sm text-zinc-500 mb-8">Formu doldurun, en kısa sürede geri dönüş sağlayalım.</p>
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              <div className="space-y-2">
                <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-[0.15em]">Adınız Soyadınız</label>
                <input 
                  required 
                  value={fullName} 
                  onChange={e => setFullName(e.target.value)} 
                  className="w-full border border-zinc-200 rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary py-3 px-4 outline-none transition-all text-sm bg-white" 
                  placeholder="Örn: Ahmet Yılmaz" 
                  type="text" 
                />
              </div>
              <div className="space-y-2">
                <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-[0.15em]">E-posta Adresiniz</label>
                <input 
                  required 
                  value={email} 
                  onChange={e => setEmail(e.target.value)} 
                  className="w-full border border-zinc-200 rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary py-3 px-4 outline-none transition-all text-sm bg-white" 
                  placeholder="ahmet@email.com" 
                  type="email" 
                />
              </div>
              <div className="space-y-2">
                <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-[0.15em]">Telefon Numaranız</label>
                <input 
                  required 
                  value={phone} 
                  onChange={e => {
                    const digits = e.target.value.replace(/\D/g, '')
                    if (digits.length <= 11) setPhone(digits)
                  }} 
                  className="w-full bg-white border border-zinc-200 rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary py-3 px-4 outline-none transition-all text-sm"
                  placeholder="Örn: 05301234567" 
                  type="tel" 
                />
              </div>
            </div>
            <div className="space-y-2">
              <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-[0.15em]">Konu</label>
              <select value={subject} onChange={e => setSubject(e.target.value)} className="w-full bg-white border border-zinc-200 rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary py-3 px-4 outline-none text-sm">
                <option value="Ürün Bilgisi">Ürün Bilgisi</option>
                <option value="Teknik Destek">Teknik Destek</option>
                <option value="Şikayet / Öneri">Şikayet / Öneri</option>
                <option value="Kurumsal İşbirliği">Kurumsal İşbirliği</option>
              </select>
            </div>
            <div className="space-y-2">
              <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-[0.15em]">Mesajınız</label>
              <textarea required value={message} onChange={e => setMessage(e.target.value)} className="w-full bg-white border border-zinc-200 rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary py-3 px-4 outline-none transition-all text-sm" placeholder="Mesajınızı buraya yazınız..." rows={5} />
            </div>
            
            {statusMsg && (
              <div className={`p-4 rounded-xl text-xs font-bold ${
                statusMsg.type === 'success' ? 'bg-green-50 text-green-700 border border-green-150' : 'bg-red-50 text-red-700 border border-red-150'
              }`}>
                {statusMsg.text}
              </div>
            )}

            <button disabled={loading} className="w-full py-4 bg-primary text-white font-bold rounded-lg hover:bg-primary-container transition-all shadow-lg shadow-primary/20 active:scale-[0.98] text-sm uppercase tracking-wider disabled:opacity-60" type="submit">
              {loading ? 'Gönderiliyor...' : 'Gönder'}
            </button>
          </form>
        </div>
      </section>

      {/* CTA Banner */}
      <section className="max-w-7xl mx-auto px-6">
        <div className="bg-on-surface text-white p-12 rounded-2xl flex flex-col md:flex-row items-center justify-between gap-8 relative overflow-hidden">
          <div className="relative z-10">
            <h2 className="text-3xl font-bold mb-2">Bize Her Zaman Ulaşın</h2>
            <p className="text-zinc-400">Kampanyalar ve yeni ürünlerden ilk siz haberdar olun.</p>
          </div>
          <div className="flex w-full md:w-auto gap-3 relative z-10">
            <input className="bg-zinc-800 border border-zinc-700 text-white placeholder:text-zinc-500 rounded-lg py-3 px-6 w-full md:w-80 focus:ring-2 focus:ring-primary focus:border-primary outline-none transition-all text-sm" placeholder="E-posta adresiniz" type="email" />
            <button className="bg-primary text-white font-bold px-8 py-3 rounded-lg hover:bg-primary-container transition-all active:scale-95 text-sm uppercase tracking-wider whitespace-nowrap">Kayıt Ol</button>
          </div>
          <div className="absolute top-0 right-0 w-72 h-72 bg-primary/5 rounded-full -mr-20 -mt-20" />
        </div>
      </section>
    </div>
  )
}
