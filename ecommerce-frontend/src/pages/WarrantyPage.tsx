import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useSEO } from '../hooks/useSEO'
import { getMemberToken } from '../lib/api'

export function WarrantyPage() {
  useSEO({
    title: 'Garanti Sorgulama',
    description: 'Stilsoft KKTC ürün garanti sorgulama. Seri numaranızla ürün garanti durumunuzu hızlıca kontrol edin. 2 yıl resmi garanti.'
  })

  const [design, setDesign] = useState({ sitePhone: '' })
  const [token] = useState(() => getMemberToken())
  const [myWarranties, setMyWarranties] = useState<any[]>([])
  const [loadingWarranties, setLoadingWarranties] = useState(false)

  // Search state
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResult, setSearchResult] = useState<any | null | undefined>(undefined) // undefined: not searched, null: not found
  const [searching, setSearching] = useState(false)

  useEffect(() => {
    // Load store design
    try {
      const cached = localStorage.getItem('ecom_store_design')
      if (cached) {
        setDesign(JSON.parse(cached))
      }
    } catch {}

    fetch('/api/store-design')
      .then(res => res.json())
      .then(json => {
        if (json?.data) setDesign(json.data)
      })
      .catch(() => {})

    // Load registered warranties if user is logged in
    if (token) {
      setLoadingWarranties(true)
      fetch('/api/storefront/warranties', {
        headers: { Authorization: `Bearer ${token}` }
      })
        .then(res => res.json())
        .then(json => {
          if (json?.success && Array.isArray(json.data)) {
            setMyWarranties(json.data)
          }
        })
        .catch(() => {})
        .finally(() => setLoadingWarranties(false))
    }
  }, [token])

  const handleSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    if (!searchQuery.trim()) return

    setSearching(true)
    setSearchResult(undefined)
    try {
      const res = await fetch(`/api/storefront/warranty/query?code=${encodeURIComponent(searchQuery.trim())}`)
      const json = await res.json()
      if (res.ok && json?.success && json?.data) {
        setSearchResult(json.data)
      } else {
        setSearchResult(null)
      }
    } catch (err) {
      setSearchResult(null)
    } finally {
      setSearching(false)
    }
  }

  return (
    <div className="max-w-7xl mx-auto px-6 pb-20">
      {/* Hero */}
      <section className="mb-16 text-center pt-8">
        <span className="inline-block px-4 py-1.5 mb-5 rounded-full bg-primary/10 text-primary font-bold text-[10px] tracking-[0.2em] uppercase">Güven ve Teknoloji</span>
        <h1 className="text-4xl md:text-5xl font-bold tracking-tight text-on-surface mb-6">Garanti Yönetim Merkezi</h1>
        <p className="text-lg text-secondary max-w-2xl mx-auto leading-relaxed">Stilsoft ürünlerinizin garanti süreçlerini tek bir noktadan yönetin. Garanti durumunuzu anında sorgulayın.</p>
      </section>

      {/* Bento Layout */}
      <div className="mb-20">
        {!token ? (
          /* GUEST VIEW - Centered Search Layout */
          <div className="max-w-3xl mx-auto space-y-6">
            <div className="bg-white rounded-2xl p-8 md:p-10 shadow-xl border border-zinc-100">
              <div className="flex items-center gap-3.5 mb-6">
                <div className="w-12 h-12 rounded-xl bg-primary/5 text-primary flex items-center justify-center">
                  <span className="material-symbols-outlined text-2xl">search</span>
                </div>
                <div>
                  <h2 className="text-2xl font-bold text-on-surface">Garanti Sorgula</h2>
                  <p className="text-xs text-zinc-400 mt-1">Ürününüzün seri numarasını girerek kalan garanti süresini sorgulayın.</p>
                </div>
              </div>

              <form onSubmit={handleSearch} className="space-y-4">
                <div className="flex flex-col sm:flex-row gap-3">
                  <input
                    className="flex-grow px-4 py-4 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all placeholder:text-zinc-400 text-sm font-mono font-bold uppercase"
                    placeholder="Seri Numarası (Örn: STL-2026-XXXX)"
                    type="text"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                  />
                  <button
                    type="submit"
                    disabled={searching}
                    className="sm:px-8 py-4 bg-on-surface text-white font-bold rounded-xl hover:bg-zinc-800 transition-all active:scale-[0.98] text-sm uppercase tracking-wider flex items-center justify-center gap-2 disabled:opacity-60"
                  >
                    <span className="material-symbols-outlined text-lg">manage_search</span>
                    {searching ? 'Sorgulanıyor...' : 'Sorgula'}
                  </button>
                </div>
              </form>

              {/* Guest Search Result display */}
              {searchResult !== undefined && (
                <div className="mt-6 p-6 bg-zinc-50/70 border border-zinc-100 rounded-2xl shadow-inner">
                  {searchResult === null ? (
                    <div className="flex items-start gap-3 text-red-600">
                      <span className="material-symbols-outlined text-xl mt-0.5">error</span>
                      <p className="text-sm font-semibold leading-relaxed">
                        Bu seri numarasına ait garanti kaydı bulunamadı. Lütfen seri numarasını kontrol edip yeniden deneyin.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="flex justify-between items-start border-b border-zinc-150 pb-3">
                        <div>
                          <h4 className="font-bold text-lg text-on-surface">{searchResult.productName}</h4>
                          <p className="text-xs text-zinc-400 font-mono mt-1">Seri No: {searchResult.warrantyCode}</p>
                        </div>
                        <span className={`px-3 py-1 text-xs font-bold uppercase rounded-full ${
                          searchResult.status === 'active' ? 'bg-green-50 text-green-700 border border-green-150' : 'bg-red-50 text-red-700 border border-red-150'
                        }`}>
                          {searchResult.status === 'active' ? 'Aktif' : 'Süresi Doldu'}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-4 text-sm text-zinc-600">
                        <div>
                          <p className="text-xs text-zinc-400">Satın Alım Tarihi</p>
                          <p className="font-bold mt-0.5">{new Date(searchResult.soldDate).toLocaleDateString('tr-TR')}</p>
                        </div>
                        <div>
                          <p className="text-xs text-zinc-400">Kayıt Sahibi</p>
                          <p className="font-bold mt-0.5">{searchResult.customerName || 'Bilinmiyor'}</p>
                        </div>
                      </div>
                      <div className="pt-2 border-t border-zinc-150 flex items-center justify-between">
                        <span className="text-sm font-semibold text-secondary">Kalan Garanti Süresi</span>
                        <span className={`text-base font-extrabold ${searchResult.status === 'active' ? 'text-primary' : 'text-zinc-500'}`}>
                          {searchResult.remainingText}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="mt-8 p-4 rounded-xl bg-zinc-50 border border-dashed border-zinc-200 flex items-start gap-3">
                <span className="material-symbols-outlined text-zinc-400 text-lg mt-0.5">info</span>
                <p className="text-xs text-zinc-500 leading-relaxed">
                  Seri numaranız, ürünün alt kısmındaki gümüş etikette veya kutu üzerindeki barkodun altında yer alır.
                </p>
              </div>
            </div>

            {/* Prompt Login Banner */}
            <div className="bg-surface-container-low p-6 rounded-2xl border border-zinc-150 text-center space-y-4 shadow-sm">
              <p className="text-sm text-zinc-600">
                Tüm garantili ürünlerinizi tek bir çatı altında listelemek ve sürelerini takip etmek ister misiniz?
              </p>
              <Link
                to="/giris"
                className="inline-flex items-center gap-2 px-6 py-2.5 bg-primary text-white font-bold text-xs uppercase tracking-wider rounded-xl hover:bg-primary-container active:scale-95 transition-all shadow-md shadow-primary/10"
              >
                <span className="material-symbols-outlined text-sm">login</span>
                Üye Girişi Yap
              </Link>
            </div>
          </div>
        ) : (
          /* MEMBER VIEW - Split Search & Registered Products Grid */
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Search Box on the Left */}
            <div className="lg:col-span-4 bg-white rounded-2xl p-6 shadow-lg border border-zinc-100 flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-10 h-10 rounded-xl bg-primary/5 text-primary flex items-center justify-center">
                    <span className="material-symbols-outlined text-2xl">search</span>
                  </div>
                  <h2 className="text-lg font-bold text-on-surface">Garanti Sorgula</h2>
                </div>
                <div className="space-y-4">
                  <input
                    className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all placeholder:text-zinc-400 text-xs font-mono font-bold uppercase"
                    placeholder="Seri No (Örn: STL-XXXX)"
                    type="text"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                  />
                  <button
                    onClick={() => handleSearch()}
                    disabled={searching}
                    className="w-full py-3 bg-on-surface text-white font-bold rounded-xl hover:bg-zinc-800 transition-all active:scale-[0.98] text-xs uppercase tracking-wider flex items-center justify-center gap-2 disabled:opacity-60"
                  >
                    <span className="material-symbols-outlined text-base">manage_search</span>
                    {searching ? 'Sorgulanıyor...' : 'Sorgula'}
                  </button>
                </div>

                {/* Member Search Result display */}
                {searchResult !== undefined && (
                  <div className="mt-5 p-4 bg-zinc-50 border border-zinc-100 rounded-xl shadow-inner text-xs">
                    {searchResult === null ? (
                      <div className="flex items-start gap-2.5 text-red-600">
                        <span className="material-symbols-outlined text-base mt-0.5">error</span>
                        <p className="leading-relaxed font-semibold">Bu seri numarasına ait garanti kaydı bulunamadı.</p>
                      </div>
                    ) : (
                      <div className="space-y-2.5">
                        <div className="flex justify-between items-center">
                          <h4 className="font-bold text-on-surface truncate pr-2 max-w-[150px]">{searchResult.productName}</h4>
                          <span className={`px-2 py-0.5 text-[9px] font-extrabold uppercase rounded-full ${
                            searchResult.status === 'active' ? 'bg-green-50 text-green-700 border border-green-100' : 'bg-red-50 text-red-700 border border-red-100'
                          }`}>
                            {searchResult.status === 'active' ? 'Aktif' : 'Süresi Doldu'}
                          </span>
                        </div>
                        <p className="text-[10px] text-zinc-400 font-mono">Seri No: {searchResult.warrantyCode}</p>
                        <div className="border-t border-zinc-150 pt-2 space-y-1 text-zinc-500">
                          <p>Fatura Tarihi: {new Date(searchResult.soldDate).toLocaleDateString('tr-TR')}</p>
                          <p>Kayıt Sahibi: {searchResult.customerName}</p>
                        </div>
                        <div className="pt-1.5 border-t border-zinc-150 flex items-center justify-between font-semibold">
                          <span className="text-[10px] text-secondary">Kalan Garanti</span>
                          <span className={`text-xs font-bold ${searchResult.status === 'active' ? 'text-primary' : 'text-zinc-500'}`}>
                            {searchResult.remainingText}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div className="mt-6 p-4 rounded-xl bg-zinc-50 border border-dashed border-zinc-200 flex items-start gap-2.5 text-[11px] text-zinc-500">
                <span className="material-symbols-outlined text-zinc-400 text-base mt-0.5">info</span>
                <p className="leading-relaxed">
                  Seri numarası gümüş barkod etiketlerinde STL-2026 formatında başlar.
                </p>
              </div>
            </div>

            {/* Registered Warranties List on the Right */}
            <div className="lg:col-span-8 bg-white rounded-2xl shadow-lg border border-zinc-100 overflow-hidden">
              <div className="p-6 border-b border-zinc-100 bg-zinc-50/50 flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-lg text-on-surface">Garantili Ürünlerim</h3>
                  <p className="text-xs text-zinc-400 mt-0.5">Satın aldığınız ve sisteme kayıtlı tüm ürünlerin garanti listesi.</p>
                </div>
                <span className="px-3 py-1 bg-primary/10 text-primary text-xs font-bold rounded-lg">
                  {myWarranties.length} Ürün
                </span>
              </div>
              
              <div className="p-6">
                {loadingWarranties ? (
                  <div className="py-12 flex flex-col items-center justify-center text-zinc-400 gap-2">
                    <span className="material-symbols-outlined animate-spin text-3xl">sync</span>
                    <span className="text-xs font-semibold">Garantiler yükleniyor...</span>
                  </div>
                ) : myWarranties.length === 0 ? (
                  <div className="py-12 text-center text-zinc-400">
                    <span className="material-symbols-outlined text-4xl mb-3 block">verified_user</span>
                    <p className="text-sm font-semibold">Henüz kayıtlı garantili ürününüz bulunmamaktadır.</p>
                    <p className="text-xs text-zinc-400 mt-1">Satın aldığınız ürünlerin garantileri otomatik tanımlanır.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {myWarranties.map((w) => (
                      <div key={w.id} className="border border-zinc-100 bg-white rounded-2xl p-5 hover:shadow-md transition-all flex flex-col justify-between">
                        <div>
                          <div className="flex justify-between items-start mb-3">
                            <span className="material-symbols-outlined text-2xl text-primary">verified</span>
                            <span className={`px-2 py-0.5 text-[9px] font-extrabold uppercase rounded-full ${
                              w.status === 'active' ? 'bg-green-50 text-green-700 border border-green-100' : 'bg-red-50 text-red-700 border border-red-100'
                            }`}>
                              {w.status === 'active' ? 'Aktif' : 'Süresi Doldu'}
                            </span>
                          </div>
                          <h4 className="font-bold text-sm text-on-surface mb-1">{w.productName}</h4>
                          <p className="text-xs text-zinc-400 font-mono mb-4">Seri: {w.warrantyCode}</p>
                        </div>
                        <div className="border-t border-zinc-50 pt-3 text-[10px] text-zinc-500 space-y-1">
                          <p>Satın Alım: {new Date(w.soldDate).toLocaleDateString('tr-TR')}</p>
                          <p className="font-bold text-primary">Kalan Süre: {w.remainingText}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Info Cards Removed */}

      {/* Help Banner */}
      <div className="bg-on-surface rounded-2xl p-12 flex flex-col md:flex-row items-center justify-between gap-8 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-primary/5 rounded-full -mr-20 -mt-20" />
        <div className="relative z-10">
          <h3 className="text-white text-2xl font-bold mb-2">Sorunuz mu var?</h3>
          <p className="text-zinc-400">Müşteri hizmetlerimiz size destek vermeye hazır.</p>
        </div>
        <div className="flex items-center gap-4 relative z-10 w-full md:w-auto">
          <a
            className="w-full md:w-auto text-center px-8 py-4 bg-white text-on-surface font-bold rounded-lg hover:bg-zinc-100 transition-all active:scale-95 text-sm flex items-center justify-center gap-2"
            href={design.sitePhone ? `tel:${design.sitePhone.replace(/\s+/g, '')}` : 'tel:08500000000'}
          >
            <span className="material-symbols-outlined text-base">call</span>
            {design.sitePhone || '0850 000 00 00'}
          </a>
        </div>
      </div>
    </div>
  )
}
