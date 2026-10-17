import { useState, useEffect } from 'react'
import { useSEO } from '../hooks/useSEO'
import { getMemberToken, readApiResponse } from '../lib/api'

export function TechnicalServicePage() {
  useSEO({
    title: 'Teknik Servis & Destek',
    description: 'Stilsoft KKTC yetkili teknik servis hizmetleri. Profesyonel bakım, onarım ve yedek parça desteği. Garanti kapsamında ücretsiz servis.',
    schema: {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      'mainEntity': [
        {
          '@type': 'Question',
          'name': 'Garanti sorgulamasını nasıl yapabilirim?',
          'acceptedAnswer': {
            '@type': 'Answer',
            'text': 'Ürününüzün faturasındaki seri numarasını "Garanti Sorgulama" sayfamıza girerek güncel durumu kontrol edebilirsiniz.'
          }
        },
        {
          '@type': 'Question',
          'name': 'Yedek parça siparişi verebilir miyim?',
          'acceptedAnswer': {
            '@type': 'Answer',
            'text': 'Evet, tüm yetkili servislerimizden ve resmi web sitemiz üzerinden orijinal yedek parça ve aksesuar siparişi verebilirsiniz.'
          }
        },
        {
          '@type': 'Question',
          'name': 'Ürünümün tamir süresi ne kadardır?',
          'acceptedAnswer': {
            '@type': 'Answer',
            'text': 'Yasal tamir süresi maksimum 20 iş günüdür. Ancak Stilsoft olarak arızaların %80\'ini ilk 3 iş günü içerisinde sonuçlandırmayı hedeflemekteyiz.'
          }
        },
        {
          '@type': 'Question',
          'name': 'Yetkili servis dışı müdahaleler garantiyi bozar mı?',
          'acceptedAnswer': {
            '@type': 'Answer',
            'text': 'Evet, yetkili servis personeli dışındaki kişilerce yapılan teknik müdahaleler ürünü garanti kapsamı dışına çıkarır.'
          }
        }
      ]
    }
  })

  // States
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [allCategories, setAllCategories] = useState<any[]>([])
  const [allProducts, setAllProducts] = useState<any[]>([])
  const [selectedCategoryId, setSelectedCategoryId] = useState('')
  const [selectedProductId, setSelectedProductId] = useState('')
  const [description, setDescription] = useState('')
  const [kvkkChecked, setKvkkChecked] = useState(false)
  
  const [loading, setLoading] = useState(false)
  const [loadingProducts, setLoadingProducts] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [showSuccessModal, setShowSuccessModal] = useState(false)

  // Fetch categories on load
  useEffect(() => {
    fetch('/api/storefront/categories')
      .then((r) => r.json())
      .then((json) => {
        if (json?.success && Array.isArray(json.data)) {
          setAllCategories(json.data)
        }
      })
      .catch((err) => console.error('Failed to fetch categories', err))
  }, [])

  // Fetch products when category selection changes
  useEffect(() => {
    if (!selectedCategoryId) {
      setAllProducts([])
      setSelectedProductId('')
      return
    }
    const cat = allCategories.find(c => c.id === selectedCategoryId)
    if (!cat) return

    setLoadingProducts(true)
    fetch(`/api/storefront/categories/${cat.slug}/products`)
      .then((r) => r.json())
      .then((json) => {
        if (json?.success && Array.isArray(json.data)) {
          setAllProducts(json.data)
        } else {
          setAllProducts([])
        }
        setSelectedProductId('')
      })
      .catch((err) => {
        console.error('Failed to fetch products', err)
        setAllProducts([])
      })
      .finally(() => {
        setLoadingProducts(false)
      })
  }, [selectedCategoryId, allCategories])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMessage(null)

    if (!fullName.trim()) {
      setErrorMessage('Lütfen Ad Soyad alanını doldurun.')
      return
    }

    if (!phone.trim() || phone.length !== 11) {
      setErrorMessage('Telefon numarası 11 haneli olmalıdır (Örn: 05xxxxxxxxx).')
      return
    }

    const cat = allCategories.find((c) => c.id === selectedCategoryId)
    const prod = allProducts.find((p) => p.id === selectedProductId)

    if (!cat) {
      setErrorMessage('Lütfen bir Ürün Grubu seçin.')
      return
    }

    if (!prod) {
      setErrorMessage('Lütfen bir Model seçin.')
      return
    }

    if (!description.trim()) {
      setErrorMessage('Lütfen sorununuzun özetini açıklayın.')
      return
    }

    if (!kvkkChecked) {
      setErrorMessage('Kişisel verilerinizin işlenmesine onay vermelisiniz.')
      return
    }

    setLoading(true)
    try {
      const token = getMemberToken()
      const headers: Record<string, string> = {
        'Content-Type': 'application/json'
      }
      if (token) {
        headers['Authorization'] = `Bearer ${token}`
      }

      const res = await fetch('/api/storefront/service-requests', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          fullName: fullName.trim(),
          phone: phone.trim(),
          productGroup: cat.name,
          modelNo: prod.name,
          description: description.trim()
        })
      })

      const json = await readApiResponse(res)
      if (res.ok && json?.success) {
        setShowSuccessModal(true)
      } else {
        setErrorMessage(json?.message || 'Servis talebi gönderilemedi.')
      }
    } catch {
      setErrorMessage('Bağlantı hatası oluştu.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="py-16 bg-surface-container-lowest min-h-[calc(100vh-400px)] flex items-center justify-center relative">
      {/* Support Request Form */}
      <section className="w-full max-w-4xl mx-auto px-6" id="support-form">
        <div className="text-center mb-12">
          <span className="inline-block px-4 py-1.5 bg-white text-primary text-[10px] font-bold uppercase tracking-[0.2em] rounded-full mb-4 shadow-sm border border-zinc-100">
            Online İşlem
          </span>
          <h1 className="text-3xl md:text-4xl font-bold text-on-surface mb-4">Teknik Destek Talebi</h1>
          <p className="text-zinc-500 max-w-2xl mx-auto leading-relaxed">
            Ürününüzle ilgili yaşadığınız sorunu bize bildirin, uzman ekibimiz en kısa sürede sizinle iletişime geçsin.
          </p>
        </div>
        <div className="bg-white p-8 md:p-12 rounded-3xl shadow-xl border border-zinc-100/50">
          <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-5">
            <div className="space-y-1.5">
              <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-[0.15em]">Ad Soyad</label>
              <input 
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all text-sm font-semibold" 
                placeholder="Mehmet Yılmaz" 
                type="text" 
              />
            </div>
            <div className="space-y-1.5">
              <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-[0.15em]">Telefon</label>
              <input 
                required
                value={phone}
                maxLength={11}
                onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 11))}
                className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all text-sm font-semibold" 
                placeholder="05xxxxxxxxx" 
                type="tel" 
              />
            </div>
            
            <div className="space-y-1.5">
              <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-[0.15em]">Ürün Grubu</label>
              <select 
                required
                value={selectedCategoryId}
                onChange={(e) => setSelectedCategoryId(e.target.value)}
                className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all text-sm text-zinc-700 font-semibold"
              >
                <option value="">Kategori Seçiniz</option>
                {allCategories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            
            <div className="space-y-1.5">
              <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-[0.15em]">Model No (Ürün)</label>
              <select 
                required
                value={selectedProductId}
                onChange={(e) => setSelectedProductId(e.target.value)}
                disabled={!selectedCategoryId || loadingProducts}
                className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all text-sm text-zinc-700 font-semibold disabled:opacity-50"
              >
                <option value="">
                  {loadingProducts ? 'Yükleniyor...' : !selectedCategoryId ? 'Önce Ürün Grubu Seçin' : 'Ürün Model Seçiniz'}
                </option>
                {allProducts.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            
            <div className="md:col-span-2 space-y-1.5 mt-2">
              <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-[0.15em]">Sorununuzun Özeti</label>
              <textarea 
                required
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all text-sm resize-none font-semibold" 
                placeholder="Lütfen karşılaştığınız sorunu detaylıca açıklayınız..." 
                rows={4} 
              />
            </div>
            <div className="md:col-span-2 flex items-start gap-3 mt-2">
              <input 
                required
                checked={kvkkChecked}
                onChange={(e) => setKvkkChecked(e.target.checked)}
                className="mt-1 w-4 h-4 rounded border-zinc-300 text-primary focus:ring-primary" 
                id="kvkk" 
                type="checkbox" 
              />
              <label className="text-xs text-zinc-500 leading-relaxed font-bold cursor-pointer" htmlFor="kvkk">
                Kişisel verilerimin işlenmesine dair <a className="text-primary hover:underline font-black" href="#">KVKK metnini</a> okudum ve onaylıyorum.
              </label>
            </div>

            {errorMessage && (
              <div className="md:col-span-2 p-4 bg-rose-50 border border-rose-100 rounded-xl text-xs font-bold text-rose-600">
                {errorMessage}
              </div>
            )}

            <div className="md:col-span-2 mt-4">
              <button 
                type="submit"
                disabled={loading}
                className="w-full bg-primary text-white py-4 rounded-xl font-bold text-sm uppercase tracking-wider shadow-lg shadow-primary/20 hover:bg-[#c00000] active:scale-[0.98] transition-all flex items-center justify-center gap-2 disabled:opacity-60"
              >
                <span className="material-symbols-outlined">{loading ? 'hourglass_empty' : 'send'}</span>
                {loading ? 'Gönderiliyor...' : 'Talep Oluştur'}
              </button>
            </div>
          </form>
        </div>
      </section>

      {/* Success Modal */}
      {showSuccessModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-[2px]">
          <div className="bg-white rounded-3xl p-6 md:p-8 max-w-sm w-full text-center shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            <div className="w-16 h-16 bg-green-50 border border-green-200 rounded-full flex items-center justify-center mx-auto mb-4 text-green-600">
              <span className="material-symbols-outlined text-[36px] font-bold">check_circle</span>
            </div>
            <h3 className="text-lg font-bold text-zinc-900">Talep Gönderildi</h3>
            <p className="text-xs text-zinc-500 mt-2 leading-relaxed font-semibold">
              Teknik destek talebiniz başarıyla oluşturulmuştur. Uzman ekibimiz en kısa sürede sizinle iletişime geçecektir.
            </p>
            <button
              onClick={() => {
                setShowSuccessModal(false)
                setFullName('')
                setPhone('')
                setSelectedCategoryId('')
                setSelectedProductId('')
                setDescription('')
                setKvkkChecked(false)
              }}
              className="mt-6 w-full py-3 bg-primary text-white font-bold text-xs uppercase tracking-wider rounded-xl hover:bg-[#c00000] transition active:scale-[0.98]"
            >
              Kapat
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
