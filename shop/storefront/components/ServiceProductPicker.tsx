'use client'

import { useEffect, useRef, useState } from 'react'

export type ServiceProduct = {
  stockCode: string
  name: string
  categoryName?: string | null
}

/**
 * Servis kaydında ÜRÜN SEÇİCİ — ServiceOps'taki arıza kabul ekranının vitrindeki karşılığı.
 *
 * NEDEN: form "Model veya Ürün Kodu" diye serbest bir metin kutusu istiyordu. Müşteri
 * cihazın model kodunu bilmiyor; "fırın", "beyaz buzdolabı", "ST 700 galiba" gibi şeyler
 * yazılıyordu. Servis o kayıtla ürünü bulamıyor, hangi cihaz için parça hazırlayacağını
 * bilemiyordu. ServiceOps'ta arıza kabul yapan personel ürünü ARAYIP SEÇİYOR; müşteri de
 * aynı şeyi yapabilmeli.
 *
 * ARAMA VİTRİN ARAMASINDAN AYRI BİR UÇTA (`/api/catalog/service-products`): servise gelen
 * cihaz çoğunlukla yıllar önce alınmış ve artık yayında olmayabilir. Vitrin araması
 * kullanılsaydı müşteri kendi cihazını bulamaz, yine elle yazmak zorunda kalırdı.
 *
 * "LİSTEDE YOK" YOLU KAPATILMADI: katalogda hiç olmayan (çok eski ya da hediye) bir cihaz
 * da servise gelebilir. O hâlde serbest metin açılıyor — ama varsayılan yol arama, çünkü
 * seçilen ürün stok koduyla geliyor ve servis tarafında tek anlama geliyor.
 */
export default function ServiceProductPicker() {
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<ServiceProduct[]>([])
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [selected, setSelected] = useState<ServiceProduct | null>(null)
  const [manual, setManual] = useState(false)

  const boxRef = useRef<HTMLDivElement | null>(null)

  // Dışarı tıklayınca liste kapanır; açık kalan liste altındaki alanları örtüyordu.
  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  /*
    Her tuşta istek atılmıyor: 300 ms yazma durunca aranıyor. Kutuya "buzdolabı" yazan
    müşteri aksi hâlde dokuz ayrı sorgu tetikler.

    `iptal` bayrağı yarış durumunu kapatıyor: geç dönen eski istek, yeni sonucun üstüne
    yazabilirdi — kullanıcı "buzdolabı" yazmışken ekranda "buz" sonuçları kalırdı.
  */
  useEffect(() => {
    if (selected || manual) return
    const q = query.trim()
    if (q.length < 2) {
      setHits([])
      return
    }

    let iptal = false
    const zaman = window.setTimeout(async () => {
      setBusy(true)
      try {
        const res = await fetch(`/api/catalog/service-products?ara=${encodeURIComponent(q)}`)
        if (!res.ok) throw new Error()
        const data = (await res.json()) as ServiceProduct[]
        if (!iptal) {
          setHits(Array.isArray(data) ? data : [])
          setOpen(true)
        }
      } catch {
        if (!iptal) setHits([])
      } finally {
        if (!iptal) setBusy(false)
      }
    }, 300)

    return () => {
      iptal = true
      window.clearTimeout(zaman)
    }
  }, [query, selected, manual])

  if (manual) {
    return (
      <div className="form-group">
        <label htmlFor="srv-model">Ürün / Model</label>
        <input
          id="srv-model"
          name="model"
          type="text"
          placeholder="Cihazın model kodu ya da adı"
          className="c-input"
        />
        <button
          type="button"
          className="picker-link"
          onClick={() => { setManual(false); setQuery(''); }}
        >
          ← Listeden aramaya dön
        </button>
      </div>
    )
  }

  if (selected) {
    return (
      <div className="form-group">
        <label>Ürün *</label>
        {/* Seçilen ürün forma stok koduyla gidiyor: servis tarafında tek anlama geliyor. */}
        <input type="hidden" name="model" value={`${selected.name} (${selected.stockCode})`} />
        <input type="hidden" name="productStockCode" value={selected.stockCode} />

        <div className="picked-product">
          <div className="picked-info">
            <strong>{selected.name}</strong>
            <span className="picked-code">
              {selected.stockCode}
              {selected.categoryName ? ` · ${selected.categoryName}` : ''}
            </span>
          </div>
          <button
            type="button"
            className="picked-clear"
            onClick={() => { setSelected(null); setQuery(''); setHits([]); }}
            aria-label="Seçimi değiştir"
          >
            Değiştir
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="form-group product-picker" ref={boxRef}>
      <label htmlFor="srv-product-search">Ürün *</label>
      <input
        id="srv-product-search"
        type="text"
        autoComplete="off"
        className="c-input"
        placeholder="Ürün adı, model ya da kategori yazın (ör. buzdolabı)"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => hits.length > 0 && setOpen(true)}
      />

      {/* Ürün seçilmeden gönderilmesin diye gizli ve zorunlu bir alan tutuluyor. */}
      <input
        tabIndex={-1}
        aria-hidden="true"
        className="picker-required-guard"
        required
        value=""
        onChange={() => {}}
      />

      {busy && <span className="picker-hint">Aranıyor…</span>}

      {open && hits.length > 0 && (
        <ul className="picker-list" role="listbox">
          {hits.map((h) => (
            <li key={h.stockCode}>
              <button
                type="button"
                onClick={() => { setSelected(h); setOpen(false); }}
              >
                <strong>{h.name}</strong>
                <span>
                  {h.stockCode}
                  {h.categoryName ? ` · ${h.categoryName}` : ''}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {open && !busy && hits.length === 0 && query.trim().length >= 2 && (
        <div className="picker-empty">Bu aramaya uygun ürün bulunamadı.</div>
      )}

      <button type="button" className="picker-link" onClick={() => setManual(true)}>
        Ürünüm listede yok, elle yazayım
      </button>
    </div>
  )
}
