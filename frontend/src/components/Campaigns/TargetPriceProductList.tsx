import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, Trash2, Plus } from 'lucide-react'
import { fetchProducts } from '../../api/products'
import type { Product } from '../../types/Product'
import type { PriceGroupDto } from '../../api/priceGroups'
import { evalPriceGroupFormula } from '../../utils/priceFormula'

/*
  ÜRÜNE ÖZEL KAMPANYALI FİYAT LİSTESİ (2026-10-07 kullanıcı isteği: "seçili ürün indiriminde
  birden fazla ürünü seçeriz listeye ekleriz, listede hepsinin yeni fiyatını koyarız; bir
  kampanyada 25'e yakın ürün").

  Her satıra yalnız KAMPANYALI FİYAT 4 yazılır. Diğer fiyat grupları (Peşin, Fiyat 2, Fiyat 3 …)
  kendi formülleriyle hesaplanır ve satırda önizleme olarak görünür — sepet ve faturada aynı
  formül kullanıldığı için önizleme ile gerçek fiyat aynıdır (bkz. utils/priceFormula.ts ve
  sunucuda Core/Helpers/CampaignCatalogDiscount.cs). Ürünler farklı kategorilerden olabilir.
*/

export type TargetRow = {
  stockCode: string
  productId?: string
  name: string
  /** Normal Fiyat 4 (katalog), ürünün F4 para biriminde. */
  f4: number | null
  currency: string
  taxRate: number
  discountRate: number
  /** Kullanıcının yazdığı kampanyalı F4 (ham metin). */
  targetText: string
}

/** "21.000", "21000,50", "2.990" (Türkçe binlik) ya da "2990.5" → sayı. */
export function parseTrNumber(text: string): number | null {
  let s = String(text ?? '').trim().replace(/\s/g, '').replace(/₺|TL/gi, '')
  if (!s) return null
  if (s.includes(',')) {
    s = s.replace(/\./g, '').replace(',', '.')
  } else {
    const dots = (s.match(/\./g) ?? []).length
    if (dots > 1 || /^\d{1,3}\.\d{3}$/.test(s)) s = s.replace(/\./g, '')
  }
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

const fmt = (n: number | null | undefined, digits = 2) =>
  n == null || !Number.isFinite(n)
    ? '—'
    : n.toLocaleString('tr-TR', { minimumFractionDigits: digits, maximumFractionDigits: digits })

export function rowFromProduct(p: Product): TargetRow {
  return {
    stockCode: String(p.stockCode ?? '').trim(),
    productId: p.id,
    name: String(p.name ?? '').trim(),
    f4: p.catalogUnitPrice != null && Number(p.catalogUnitPrice) > 0 ? Number(p.catalogUnitPrice) : null,
    currency: String(p.catalogCurrency ?? 'TL'),
    taxRate: Number(p.taxRate ?? 0),
    discountRate: Number(p.discountRate ?? 0),
    targetText: ''
  }
}

/** Satırın hatası; geçerliyse null. */
export function rowError(r: TargetRow): string | null {
  if (r.f4 == null) return 'Fiyat 4 tanımlı değil'
  const t = parseTrNumber(r.targetText)
  if (t == null) return 'Kampanyalı fiyat yazın'
  if (t <= 0) return "0'dan büyük olmalı"
  if (t >= r.f4) return 'Normal F4’ten küçük olmalı'
  return null
}

type Props = {
  rows: TargetRow[]
  onChange: (rows: TargetRow[]) => void
  priceGroups: PriceGroupDto[]
}

export default function TargetPriceProductList({ rows, onChange, priceGroups }: Props) {
  const [term, setTerm] = useState('')
  const [results, setResults] = useState<Product[]>([])
  const [searching, setSearching] = useState(false)
  const [bulkPercent, setBulkPercent] = useState('')
  const abortRef = useRef<AbortController | null>(null)

  // Önizlemede gösterilecek gruplar: 1-4 (Peşin, Fiyat 2, Fiyat 3, Fiyat 4).
  const previewGroups = useMemo(
    () =>
      (priceGroups ?? [])
        .filter((g: any) => [1, 2, 3, 4].includes(Number(g.code)))
        .sort((a: any, b: any) => Number(a.code) - Number(b.code)),
    [priceGroups]
  )

  useEffect(() => {
    const q = term.trim()
    abortRef.current?.abort()
    if (q.length < 2) {
      setResults([])
      setSearching(false)
      return
    }
    const ac = new AbortController()
    abortRef.current = ac
    setSearching(true)
    const timer = setTimeout(() => {
      fetchProducts({ q, page: 1, pageSize: 15 }, { signal: ac.signal })
        .then((res) => setResults((res.items ?? []) as Product[]))
        .catch(() => { if (!ac.signal.aborted) setResults([]) })
        .finally(() => { if (!ac.signal.aborted) setSearching(false) })
    }, 300)
    return () => {
      clearTimeout(timer)
      ac.abort()
    }
  }, [term])

  const added = useMemo(() => new Set(rows.map((r) => r.stockCode.toUpperCase())), [rows])

  const addProduct = (p: Product) => {
    const r = rowFromProduct(p)
    if (!r.stockCode || added.has(r.stockCode.toUpperCase())) return
    onChange([...rows, r])
  }

  const updateTarget = (code: string, text: string) =>
    onChange(rows.map((r) => (r.stockCode === code ? { ...r, targetText: text } : r)))

  const removeRow = (code: string) => onChange(rows.filter((r) => r.stockCode !== code))

  const applyBulk = () => {
    const pct = parseTrNumber(bulkPercent)
    if (pct == null || pct <= 0 || pct >= 100) return
    onChange(
      rows.map((r) =>
        r.f4 == null ? r : { ...r, targetText: String(Math.round(r.f4 * (1 - pct / 100) * 100) / 100).replace('.', ',') }
      )
    )
  }

  return (
    <div className="space-y-3">
      {/* Ürün arama */}
      <div className="relative">
        <div className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 h-10 focus-within:ring-2 focus-within:ring-blue-200">
          <Search className="w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Ürün ekle: stok kodu, ürün adı ya da barkod yazın (en az 2 harf)"
            className="flex-1 text-sm outline-none bg-transparent"
          />
          {searching && <span className="text-[11px] text-gray-400">aranıyor…</span>}
        </div>
        {term.trim().length >= 2 && (results.length > 0 || !searching) && (
          <div className="absolute z-20 mt-1 w-full max-h-72 overflow-auto rounded-lg border border-gray-200 bg-white shadow-lg">
            {results.length === 0 && !searching && <div className="p-3 text-xs text-gray-500">Ürün bulunamadı.</div>}
            {results.map((p) => {
              const code = String(p.stockCode ?? '').trim()
              const varMi = added.has(code.toUpperCase())
              const f4 = p.catalogUnitPrice != null && Number(p.catalogUnitPrice) > 0 ? Number(p.catalogUnitPrice) : null
              return (
                <div key={p.id ?? code} className="flex items-center gap-3 px-3 py-2 border-b last:border-b-0 hover:bg-gray-50">
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-bold text-gray-900">{code}</div>
                    <div className="text-xs text-gray-600 truncate">{p.name}</div>
                  </div>
                  <div className="text-xs text-gray-700 whitespace-nowrap">
                    F4: <b>{f4 == null ? 'yok' : `${fmt(f4)} ${p.catalogCurrency ?? 'TL'}`}</b>
                  </div>
                  <button
                    type="button"
                    disabled={varMi || f4 == null}
                    onClick={() => addProduct(p)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded bg-blue-600 text-white hover:bg-blue-700 disabled:bg-gray-200 disabled:text-gray-500"
                    title={f4 == null ? 'Fiyat 4 tanımlı olmayan ürüne kampanyalı fiyat yazılamaz' : undefined}
                  >
                    {varMi ? 'Listede' : (<><Plus className="w-3 h-3" /> Ekle</>)}
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Toplu doldurma */}
      {rows.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-gray-700">
          <span className="font-semibold">{rows.length} ürün</span>
          <span className="text-gray-300">|</span>
          <span>Hepsine normal F4'ten</span>
          <input
            value={bulkPercent}
            onChange={(e) => setBulkPercent(e.target.value)}
            inputMode="decimal"
            placeholder="%"
            className="w-16 h-7 px-2 border border-gray-300 rounded text-right"
          />
          <span>indirim yaz</span>
          <button type="button" onClick={applyBulk} className="h-7 px-2.5 rounded border border-gray-300 font-semibold hover:bg-gray-50">
            Uygula
          </button>
          <span className="text-gray-400">(sonra satır satır değiştirebilirsiniz)</span>
        </div>
      )}

      {/* Liste */}
      <div className="border border-gray-200 rounded-lg overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              <th className="text-left px-3 py-2 font-semibold">Ürün</th>
              <th className="text-right px-3 py-2 font-semibold whitespace-nowrap">Normal F4</th>
              <th className="text-right px-3 py-2 font-semibold whitespace-nowrap">Kampanyalı F4</th>
              <th className="text-right px-3 py-2 font-semibold">İndirim</th>
              {previewGroups.map((g: any) => (
                <th key={g.id} className="text-right px-2 py-2 font-semibold whitespace-nowrap" title={g.formula ?? ''}>
                  → {g.name}
                </th>
              ))}
              <th className="px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={5 + previewGroups.length} className="px-3 py-6 text-center text-gray-500">
                  Henüz ürün yok. Yukarıdaki kutudan ürün arayıp ekleyin.
                </td>
              </tr>
            )}
            {rows.map((r) => {
              const hedef = parseTrNumber(r.targetText)
              const hata = r.targetText.trim() ? rowError(r) : r.f4 == null ? rowError(r) : null
              const fark = r.f4 != null && hedef != null ? r.f4 - hedef : null
              const yuzde = r.f4 != null && fark != null && r.f4 > 0 ? (fark / r.f4) * 100 : null
              const gecerli = hedef != null && !rowError(r)
              return (
                <tr key={r.stockCode} className="border-t border-gray-100 align-top">
                  <td className="px-3 py-2 min-w-[180px]">
                    <div className="font-bold text-gray-900">{r.stockCode}</div>
                    <div className="text-gray-600 truncate max-w-[260px]" title={r.name}>{r.name}</div>
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {r.f4 == null ? <span className="text-red-600 font-semibold">yok</span> : `${fmt(r.f4)} ${r.currency}`}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <input
                      value={r.targetText}
                      onChange={(e) => updateTarget(r.stockCode, e.target.value)}
                      inputMode="decimal"
                      placeholder="yeni fiyat"
                      className={
                        'w-28 h-8 px-2 border rounded text-right font-semibold ' +
                        (hata ? 'border-red-400 bg-red-50' : 'border-gray-300')
                      }
                    />
                    {hata && <div className="mt-0.5 text-[10px] text-red-600 font-semibold">{hata}</div>}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {gecerli && fark != null ? (
                      <>
                        <div className="font-semibold text-emerald-700">−{fmt(fark)}</div>
                        <div className="text-[10px] text-gray-500">%{fmt(yuzde, 1)}</div>
                      </>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                  {previewGroups.map((g: any) => {
                    const once = r.f4 == null ? null : evalPriceGroupFormula(g.formula, r.f4, r.taxRate, r.discountRate)
                    const sonra = gecerli && hedef != null ? evalPriceGroupFormula(g.formula, hedef, r.taxRate, r.discountRate) : null
                    return (
                      <td key={g.id} className="px-2 py-2 text-right whitespace-nowrap">
                        {sonra != null ? (
                          <>
                            <div className="font-semibold text-gray-900">{fmt(sonra)}</div>
                            <div className="text-[10px] text-gray-400 line-through">{fmt(once)}</div>
                          </>
                        ) : (
                          <span className="text-gray-400">{fmt(once)}</span>
                        )}
                      </td>
                    )
                  })}
                  <td className="px-2 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => removeRow(r.stockCode)}
                      className="p-1.5 rounded text-gray-400 hover:text-red-600 hover:bg-red-50"
                      title="Listeden çıkar"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="text-[11px] text-gray-500 leading-relaxed">
        Yalnız kampanyalı Fiyat 4 yazılır; diğer fiyat grupları kendi formülleriyle hesaplanır
        (önizleme sütunları). Ürünün normal F4'ü sonradan değişse de kampanyalı F4 burada
        yazdığınız fiyat kalır.
      </div>
    </div>
  )
}
