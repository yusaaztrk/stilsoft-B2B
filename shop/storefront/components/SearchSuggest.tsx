'use client'

import { useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { displayName, formatPrice, mediaUrl } from '@/lib/format'

/*
  ARAMA ÖNERİSİ (2026-09-20).

  Arama kutusu düz bir form'du: müşteri yazıp Enter'a basıyor, sonuç sayfası açılıyor, ürün
  yoksa geri dönüp yeniden yazıyordu. Bu kitlede o döngü çoğunlukla "kapat"la bitiyor.

  Artık iki harften sonra ürünler ve kategoriler açılır listede görünüyor; müşteri doğrudan
  ürüne gidiyor. Arama sayfası da yerinde duruyor (Enter ile), yani hiçbir davranış kaybolmadı.

  İSTEK SAYISI: 250 ms geciktirme + her yeni harfte öncekini iptal. Yazarken her tuşta istek
  atmak hem sunucuyu hem müşterinin veri paketini yorar.
*/

type Urun = {
  name: string
  slug: string
  imageUrl?: string | null
  grossPrice: number
  currency: string
  inStock: boolean
}

type Kategori = { name: string; slug: string; productCount: number }

export default function SearchSuggest({
  placeholder,
  variant = 'header',
}: {
  placeholder?: string
  /** 'drawer' = mobil menü içindeki dar kutu; sınıflar oradaki mevcut biçime uyar. */
  variant?: 'header' | 'drawer'
}) {
  const router = useRouter()
  const [terim, setTerim] = useState('')
  const [urunler, setUrunler] = useState<Urun[]>([])
  const [kategoriler, setKategoriler] = useState<Kategori[]>([])
  const [acik, setAcik] = useState(false)
  const kutuRef = useRef<HTMLDivElement>(null)

  // Dışarı tıklayınca kapansın.
  useEffect(() => {
    const dinle = (e: MouseEvent) => {
      if (kutuRef.current && !kutuRef.current.contains(e.target as Node)) setAcik(false)
    }
    document.addEventListener('mousedown', dinle)
    return () => document.removeEventListener('mousedown', dinle)
  }, [])

  useEffect(() => {
    const q = terim.trim()
    if (q.length < 2) {
      setUrunler([])
      setKategoriler([])
      return
    }

    const kontrol = new AbortController()
    const zaman = setTimeout(async () => {
      try {
        const res = await fetch(`/api/catalog/suggest?ara=${encodeURIComponent(q)}`, {
          signal: kontrol.signal,
        })
        if (!res.ok) return
        const json = await res.json()
        setUrunler(Array.isArray(json?.items) ? json.items : [])
        setKategoriler(Array.isArray(json?.categories) ? json.categories : [])
        setAcik(true)
      } catch {
        /* İptal edilen istek ya da ağ hatası: öneri gösterilmez, arama yine çalışır. */
      }
    }, 250)

    return () => {
      clearTimeout(zaman)
      kontrol.abort()
    }
  }, [terim])

  const gonder = (e: React.FormEvent) => {
    e.preventDefault()
    const q = terim.trim()
    if (q.length === 0) return
    setAcik(false)
    router.push(`/arama?q=${encodeURIComponent(q)}`)
  }

  const sonucVar = urunler.length > 0 || kategoriler.length > 0

  return (
    <div className={variant === 'drawer' ? 'drawer-search-wrap' : 'site-search-wrap'} ref={kutuRef}>
      <form className={variant === 'drawer' ? 'drawer-search' : 'site-search-form'} role="search" onSubmit={gonder}>
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          className="search-icon"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.35-4.35" />
        </svg>
        <input
          type="search"
          name="q"
          value={terim}
          onChange={(e) => setTerim(e.target.value)}
          onFocus={() => sonucVar && setAcik(true)}
          placeholder={placeholder ?? 'Airfryer, Ankastre, Çaycı, Blender veya model ara...'}
          aria-label="Ürün, marka veya model ara"
          className="search-input"
          autoComplete="off"
        />
        {variant === 'header' && (
          <button type="submit" className="search-submit-btn" aria-label="Ara">
            Ara
          </button>
        )}
      </form>

      {acik && sonucVar && (
        <div className="search-suggest">
          {kategoriler.length > 0 && (
            <div className="suggest-group">
              <div className="suggest-title">Kategoriler</div>
              {kategoriler.map((k) => (
                <button
                  key={k.slug}
                  type="button"
                  className="suggest-cat"
                  onClick={() => {
                    setAcik(false)
                    router.push(`/kategori/${k.slug}`)
                  }}
                >
                  <span>{k.name}</span>
                  <span className="suggest-cat-count">{k.productCount} ürün</span>
                </button>
              ))}
            </div>
          )}

          {urunler.length > 0 && (
            <div className="suggest-group">
              <div className="suggest-title">Ürünler</div>
              {urunler.map((u) => {
                const gorsel = mediaUrl(u.imageUrl)
                return (
                  <button
                    key={u.slug}
                    type="button"
                    className="suggest-item"
                    onClick={() => {
                      setAcik(false)
                      router.push(`/urun/${u.slug}`)
                    }}
                  >
                    {gorsel && (
                      <Image src={gorsel} alt="" width={40} height={40} className="suggest-item-img" />
                    )}
                    <span className="suggest-item-name">{displayName(u.name)}</span>
                    <span className="suggest-item-price num">{formatPrice(u.grossPrice, u.currency)}</span>
                  </button>
                )
              })}
            </div>
          )}

          <button type="button" className="suggest-all" onClick={gonder}>
            &quot;{terim.trim()}&quot; için tüm sonuçlar
          </button>
        </div>
      )}
    </div>
  )
}
