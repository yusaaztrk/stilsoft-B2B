import React, { useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { Pencil, Image as ImageIcon, RefreshCcw } from 'lucide-react'
import DataGrid, { type DataGridColumn } from '../components/datagrid/DataGrid'
import FormInput from '../components/forms/FormInput'
import FormSelect from '../components/forms/FormSelect'
import Modal from '../components/Modal'
import { fetchProducts } from '../api/products'
import type { Product } from '../types/Product'
import { bulkUpsertProductPrices, fetchProductPricesByProducts, upsertProductPrice, type ProductPriceResponse } from '../api/productPrices'
import { fetchPriceGroups, type PriceGroupDto } from '../api/priceGroups'
import { API_BASE_URL, apiUrl } from '../config/api'
import { computePricesFromFormulas } from '../utils/priceFormula'

type Row = {
  product: Product
  pricesByGroupId: Record<string, { price: number; currency: string }>
  taxRate: number
  discountRate: number
}

function isSpareProduct(p: any) {
  if (!p) return false
  const pType = String(p.productType ?? '').trim().toUpperCase()
  const rawGroup = String(p.groupCode ?? '').trim().toLowerCase().replace(/_/g, ' ')
  const hasPartNo = String(p.kod5 ?? '').trim().length > 0
  const kod4Val = String(p.kod4 ?? '').trim()
  const isImage = kod4Val.startsWith('http://') || kod4Val.startsWith('https://') || kod4Val.includes('/uploads/')
  const hasParentStock = kod4Val.length > 0 && !isImage
  return pType === 'YEDEKPARCA' || rawGroup === 'servis yedek parca malzeme' || hasPartNo || hasParentStock
}

function computeInstallationWithKdv(args: { installationFee: number; kdvRate: number }) {
  const fee = Number(args.installationFee ?? 0)
  if (!Number.isFinite(fee) || fee <= 0) return 0
  const kdv = Number(args.kdvRate ?? 0)
  if (!Number.isFinite(kdv) || kdv <= 0) return round2(fee)
  return round2(fee * (1 + kdv / 100))
}

function formatMoney(value: number | null | undefined) {
  const n = Number(value ?? 0)
  if (!Number.isFinite(n)) return ''
  return n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function round2(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

const MAX_PRICE_DEC18_2 = 9999999999999999.99

function clamp(n: number, min: number, max: number) {
  if (!Number.isFinite(n)) return min
  return Math.min(max, Math.max(min, n))
}

function sanitizeDecimalText(input: string, opts: { max: number; decimals: number }) {
  const raw = String(input ?? '')

  // Keep digits and separators only.
  let cleaned = raw.replace(/[^0-9,\.]/g, '')

  // Keep only the first separator.
  const firstComma = cleaned.indexOf(',')
  const firstDot = cleaned.indexOf('.')
  const sepIndex =
    firstComma === -1 ? firstDot : firstDot === -1 ? firstComma : Math.min(firstComma, firstDot)

  if (sepIndex >= 0) {
    const sep = cleaned[sepIndex]
    const left = cleaned.slice(0, sepIndex).replace(/[^0-9]/g, '')
    const right = cleaned
      .slice(sepIndex + 1)
      .replace(/[^0-9]/g, '')
      .slice(0, Math.max(0, opts.decimals))
    cleaned = left + sep + right
  } else {
    cleaned = cleaned.replace(/[^0-9]/g, '')
  }

  // Cap integer digits to 16 for decimal(18,2).
  const parts = cleaned.split(/[,.]/)
  const intPart = (parts[0] ?? '').slice(0, 16)
  const decPart = parts[1] ?? ''
  const hasSep = cleaned.includes(',') || cleaned.includes('.')
  const normalized = hasSep ? `${intPart}.${decPart}` : intPart

  const parsed = Number(normalized)
  if (!Number.isFinite(parsed)) {
    return hasSep ? `${intPart}${decPart ? '.' + decPart : ''}` : intPart
  }

  const clamped = clamp(parsed, 0, opts.max)
  // Keep user's ongoing typing if it ends with separator.
  const endsWithSep = raw.endsWith(',') || raw.endsWith('.')
  if (endsWithSep) {
    return intPart + '.'
  }

  // If user typed decimals, keep them (up to max decimals) without forcing trailing zeros.
  if (hasSep) {
    const dec = String(decPart).slice(0, opts.decimals)
    const base = String(Math.floor(clamped))
    return dec ? `${base}.${dec}` : base
  }

  return String(Math.floor(clamped))
}

function sanitizeDiscountText(input: string) {
  const txt = sanitizeDecimalText(input, { max: 100, decimals: 2 })
  const n = parseDecimalInput(txt)
  if (n == null) return txt
  return String(clamp(n, 0, 100))
}

function parseDecimalInput(s: string) {
  const raw = String(s ?? '').trim()
  if (!raw) return null

  // Support both TR (1.234,56) and EN (1234.56) inputs.
  const hasComma = raw.includes(',')
  const hasDot = raw.includes('.')

  let normalized = raw
  if (hasComma && hasDot) {
    // Assume dot is thousands separator and comma is decimal separator.
    normalized = raw.replace(/\./g, '').replace(',', '.')
  } else if (hasComma) {
    // Comma decimal.
    normalized = raw.replace(/\./g, '').replace(',', '.')
  } else {
    // Dot decimal (or plain integer).
    normalized = raw.replace(/,/g, '')
  }

  const n = Number(normalized)
  return Number.isFinite(n) ? n : null
}

function computePricesFromF4(f4Gross: number, kdvRate: number, discountRate: number) {
  const k = Number(kdvRate ?? 0)
  const denom = 1 + k / 100

  const fiyat4 = round2(f4Gross)
  const fiyat6 = round2(fiyat4 * (1 - discountRate / 100))
  const fiyat5 = round2(fiyat4 * 0.88)

  const fiyat1 = round2(fiyat4 / denom)
  const fiyat2 = round2(fiyat5 / denom)
  const fiyat3 = round2(fiyat6 / denom)

  return {
    F1: fiyat1,
    F2: fiyat2,
    F3: fiyat3,
    F4: fiyat4,
    F5: fiyat5,
    F6: fiyat6
  } as Record<'F1' | 'F2' | 'F3' | 'F4' | 'F5' | 'F6', number>
}

const toImageSrc = (url: unknown) => {
  const s = String(url ?? '').trim()
  if (!s) return ''
  if (s.startsWith('http://') || s.startsWith('https://') || s.startsWith('blob:') || s.startsWith('data:')) return s
  return apiUrl(s)
}

export default function AtliFiyatlandirmaPage() {
  const location = useLocation()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [items, setItems] = useState<Product[]>([])
  const [prices, setPrices] = useState<ProductPriceResponse[]>([])
  const [priceGroups, setPriceGroups] = useState<PriceGroupDto[]>([])

  const [filterName, setFilterName] = useState('')
  const [filterStockCode, setFilterStockCode] = useState('')
  const [filterStockMin, setFilterStockMin] = useState('')

  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewProduct, setPreviewProduct] = useState<Product | null>(null)

  const [editOpen, setEditOpen] = useState(false)
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  const [editProduct, setEditProduct] = useState<Product | null>(null)
  const [editBaseGroupId, setEditBaseGroupId] = useState('')
  const [editTaxRate, setEditTaxRate] = useState('20')
  const [editDiscount, setEditDiscount] = useState('20')
  const [editBasePrice, setEditBasePrice] = useState('')
  const [editCurrency, setEditCurrency] = useState('TL')
  const [editPricesByGroupId, setEditPricesByGroupId] = useState<Record<string, string>>({})

  const priceIndex = useMemo(() => {
    const map = new Map<string, ProductPriceResponse[]>()
    prices.forEach((p) => {
      const list = map.get(p.productId) ?? []
      list.push(p)
      map.set(p.productId, list)
    })
    return map
  }, [prices])

  const priceGroupById = useMemo(() => {
    const m: Record<string, PriceGroupDto> = {}
    priceGroups.forEach((pg) => {
      m[pg.id] = pg
    })
    return m
  }, [priceGroups])

  const priceGroupIdByCode = useMemo(() => {
    const m: Record<string, string> = {}
    priceGroups.forEach((pg) => {
      m[String(pg.code)] = pg.id
    })
    return m
  }, [priceGroups])

  const rows = useMemo(() => {
    return items.map((p) => {
      const list = priceIndex.get(p.id) ?? []
      const pricesByGroupId: Record<string, { price: number; currency: string }> = {}
      list.forEach((pp) => {
        pricesByGroupId[pp.priceGroupId] = { price: Number(pp.price), currency: pp.currency }
      })

      return {
        product: p,
        pricesByGroupId,
        taxRate: Number(p.taxRate ?? 0),
        discountRate: Number((p as any).discountRate ?? 0)
      } satisfies Row
    })
  }, [items, priceIndex])

  /**
   * FİYAT 4'E GÖRE TOPLU GÜNCELLEME.
   *
   * Fiyat 4 dışındaki gruplar Fiyat 4'ten TÜREMEK zorunda; ama Fiyat 4 dışarıdan
   * (ör. toplu içe aktarma) değiştirildiğinde diğer gruplar eski değerde kalıyor ve tablo
   * kendi içinde tutarsızlaşıyor. Bu işlem her ürünün MEVCUT Fiyat 4'ünü okuyup diğer
   * grupları yeniden hesaplar.
   *
   * Hesap, ürün kartındaki düzenleme kipiyle AYNI motordan geçer
   * (`computePricesFromFormulas` + `PriceGroups.Formula`), yoksa "elle düzenleyince başka,
   * toplu güncelleyince başka" sonuç çıkardı.
   *
   * Yalnız EKRANDAKİ (filtrelenmiş) ürünlere uygulanır — süzgeç varsa kapsam odur.
   * Fiyat 4'ü olmayan ya da 0 olan ürüne dokunulmaz: türetilecek bir taban yok.
   */
  const buildBulkRows = () => {
    const group4 = priceGroups.find((pg) => Number(pg.code) === 4)
    if (!group4) return { rows: [], productCount: 0, skipped: 0 }

    const out: Array<{ productId: string; priceGroupId: string; price: number; currency: string }> = []
    let productCount = 0
    let skipped = 0

    for (const r of filteredRows) {
      const f4 = Number(r.pricesByGroupId[group4.id]?.price ?? 0)
      if (!Number.isFinite(f4) || f4 <= 0) {
        skipped++
        continue
      }

      const computed = computePricesFromFormulas({
        f4,
        kdvRate: r.taxRate,
        discountRate: r.discountRate,
        priceGroups
      })

      // Para birimi ÜRÜNÜN mevcut fiyat satırından gelir; burada döviz çevirmiyoruz.
      // Fiyat 4 satırının dövizi referans: diğer gruplar da aynı para biriminde durmalı.
      const currency = String(r.pricesByGroupId[group4.id]?.currency ?? 'TL')

      let touched = false
      for (const pg of priceGroups) {
        const value = computed[pg.id]
        if (!Number.isFinite(value) || value <= 0) continue
        if (value > MAX_PRICE_DEC18_2) continue

        const current = r.pricesByGroupId[pg.id]?.price
        // Kuruş altı farkı değişiklik saymıyoruz; yoksa her çalıştırma geçmişi şişirirdi.
        if (current != null && Math.abs(Number(current) - value) < 0.005) continue

        out.push({ productId: r.product.id, priceGroupId: pg.id, price: round2(value), currency })
        touched = true
      }

      if (touched) productCount++
    }

    return { rows: out, productCount, skipped }
  }

  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false)
  const [bulkPlan, setBulkPlan] = useState<{ rows: number; productCount: number; skipped: number }>({ rows: 0, productCount: 0, skipped: 0 })
  const [bulkMessage, setBulkMessage] = useState<string | null>(null)

  const openBulkConfirm = () => {
    const plan = buildBulkRows()
    setBulkPlan({ rows: plan.rows.length, productCount: plan.productCount, skipped: plan.skipped })
    setBulkMessage(null)
    setBulkConfirmOpen(true)
  }

  const runBulkRecalc = async () => {
    try {
      setBulkBusy(true)
      setBulkMessage(null)

      const plan = buildBulkRows()
      if (plan.rows.length === 0) {
        setBulkMessage('Guncellenecek fiyat bulunamadi - tum gruplar zaten Fiyat 4 ile uyumlu.')
        return
      }

      const res = await bulkUpsertProductPrices(plan.rows)
      setBulkMessage(
        `${plan.productCount} urun guncellendi - ${res.updated} fiyat degisti, ${res.created} yeni satir acildi` +
        (res.failed > 0 ? `, ${res.failed} satir yazilamadi` : '') +
        (plan.skipped > 0 ? `. Fiyat 4'u olmayan ${plan.skipped} urune dokunulmadi.` : '.')
      )
      setBulkConfirmOpen(false)
      await reload()
    } catch (e: any) {
      setBulkMessage(String(e?.message ?? 'Toplu guncelleme basarisiz'))
    } finally {
      setBulkBusy(false)
    }
  }

  const filteredRows = useMemo(() => {
    const qName = filterName.trim().toLowerCase()
    const qCode = filterStockCode.trim().toLowerCase()
    const stockMin = parseDecimalInput(filterStockMin)

    return rows.filter((r) => {
      const p = r.product
      const okName = !qName || p.name.toLowerCase().includes(qName)
      const okCode = !qCode || p.stockCode.toLowerCase().includes(qCode)
      const okStock = stockMin == null || Number(p.stock ?? 0) >= stockMin
      return okName && okCode && okStock
    })
  }, [filterName, filterStockCode, filterStockMin, rows])

  const reload = async () => {
    try {
      setLoading(true)
      setError(null)

      const pg = await fetchPriceGroups({ includeInactive: false })
      setPriceGroups(pg)

      /**
       * ÜRÜNLERİN TAMAMI SAYFA SAYFA ÇEKİLİR (2026-08-22 düzeltmesi).
       *
       * Eskiden tek istekte `pageSize: 500` isteniyordu. Uç `includeInactive: true`
       * durumunda sayfa boyutunu **200'e kırpıyor** (`ProductsController` `maxPageSize`),
       * yani sayfa 500 sanıp 200 alıyordu. Sayfalama arayüzü de olmadığı için 1.217
       * ürünün 1.017'si BU EKRANDA HİÇ GÖRÜNMÜYORDU — "yeni eklenen ürünler gelmiyor"
       * şikâyetinin sebebi buydu; ürünler alfabetik sıralandığı için yeni eklenenler
       * çoğunlukla ilk 200'ün dışında kalıyor.
       *
       * Sunucunun kendi sınırıyla (200) sayfalanıyor ve `total` bitene kadar sürüyor.
       * Döngü güvenlik sayacıyla sınırlı: uç bozuk `total` döndürse bile sonsuza gitmez.
       */
      const PAGE = 200
      const allItems: typeof items = []
      let pageNo = 1
      let expectedTotal = 0
      for (let guard = 0; guard < 100; guard++) {
        const chunk = await fetchProducts({ page: pageNo, pageSize: PAGE, includeInactive: true })
        expectedTotal = Number(chunk.total ?? 0)
        allItems.push(...(chunk.items ?? []))
        if ((chunk.items?.length ?? 0) < PAGE) break
        if (expectedTotal > 0 && allItems.length >= expectedTotal) break
        pageNo += 1
      }

      setItems(allItems)

      const ids = allItems.map((x) => x.id)
      if (ids.length === 0) {
        setPrices([])
        return
      }

      const pp = await fetchProductPricesByProducts(ids)
      setPrices(pp)
    } catch (e: any) {
      setError(String(e?.message ?? 'Yüklenemedi'))
      setItems([])
      setPrices([])
      setPriceGroups([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const openPreview = (p: Product) => {
    setPreviewProduct(p)
    setPreviewOpen(true)
  }

  const openEdit = (row: Row) => {
    const p = row.product
    setEditProduct(p)
    setEditError(null)

    const baseId = priceGroupIdByCode['4'] ?? priceGroups[0]?.id ?? ''
    setEditBaseGroupId(baseId)

    const baseCurrency = (row.pricesByGroupId[baseId]?.currency ?? p.currency ?? 'TL') as string
    setEditCurrency(baseCurrency)

    const discount = Number(row.discountRate)
    setEditDiscount(String(Number.isFinite(discount) ? discount : Number((p as any).discountRate ?? 0)))

    const tax = Number(row.taxRate)
    setEditTaxRate(String(Number.isFinite(tax) ? tax : Number(p.taxRate ?? 0)))

    const basePrice = row.pricesByGroupId[baseId]?.price
    if (basePrice == null) {
      setEditBasePrice('')
    } else {
      setEditBasePrice(formatMoney(Math.max(0, Number(basePrice))).replace(/\./g, '').replace(',', '.'))
    }

    const initialPrices: Record<string, string> = {}
    priceGroups.forEach((pg) => {
      const v = row.pricesByGroupId[pg.id]?.price
      initialPrices[pg.id] = v != null ? formatMoney(v).replace(/\./g, '').replace(',', '.') : ''
    })
    setEditPricesByGroupId(initialPrices)

    setEditOpen(true)
  }

  const queryProductId = useMemo(() => {
    const sp = new URLSearchParams(String(location.search ?? ''))
    return String(sp.get('productId') ?? '').trim()
  }, [location.search])

  const [handledQueryProductId, setHandledQueryProductId] = useState<string>('')

  useEffect(() => {
    if (!queryProductId) return
    if (handledQueryProductId === queryProductId) return
    if (loading) return
    if (items.length === 0) return
    if (priceGroups.length === 0) return
    if (editOpen) return

    const row = rows.find((r) => String(r.product?.id ?? '').trim() === queryProductId)
    setHandledQueryProductId(queryProductId)
    if (!row) return
    openEdit(row)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editOpen, handledQueryProductId, items.length, loading, priceGroups.length, queryProductId, rows])

  const editComputed = useMemo(() => {
    const p = editProduct
    if (!p) return null
    const kdvParsed = parseDecimalInput(editTaxRate)
    const kdv = kdvParsed == null ? Number(p.taxRate ?? 0) : clamp(kdvParsed, 0, 100)

    const baseId = String(editBaseGroupId || '')
    if (!baseId) return null

    const basePrice = parseDecimalInput(editBasePrice)
    if (basePrice == null || basePrice <= 0) return null

    const effectiveBasePrice = round2(basePrice)

    if (isSpareProduct(p)) {
      const kdv = kdvParsed == null ? Number(p.taxRate ?? 0) : kdvParsed
      const denom = kdv > 0 ? (1 + kdv / 100) : 1
      const kdvHaricPrice = round2(effectiveBasePrice / denom)

      const spareMap: Record<string, number> = {}
      priceGroups.forEach((pg) => {
        const code = String(pg.code ?? '').trim()
        if (code === '1' || code === '2' || code === '3' || code === '7') {
          spareMap[pg.id] = kdvHaricPrice
        } else {
          spareMap[pg.id] = effectiveBasePrice
        }
      })
      return spareMap
    }

    const disc = parseDecimalInput(editDiscount)
    const discountRate = disc == null ? 0 : clamp(disc, 0, 100)

    const byId = computePricesFromFormulas({ f4: effectiveBasePrice, kdvRate: kdv, discountRate, priceGroups })
    return byId
  }, [editBaseGroupId, editBasePrice, editDiscount, editProduct, editTaxRate, priceGroups])

  useEffect(() => {
    if (!editOpen) return
    if (!editProduct) return
    const computed = editComputed
    if (!computed) return

    setEditPricesByGroupId((prev) => {
      const next = { ...prev }
      const computedById = computed as any
      for (const pg of priceGroups) {
        const price = computedById[pg.id]
        if (price == null) continue
        next[pg.id] = String(price)
      }
      return next
    })
  }, [editComputed, editOpen, editProduct, priceGroups])

  const submitEdit = async () => {
    if (!editProduct) return
    const computed = editComputed

    const currency = (editCurrency || 'TL').trim().toUpperCase()
    if (currency.length < 2 || currency.length > 3) {
      setEditError('Para birimi geçersiz (ör: TL, USD, EUR, GBP)')
      return
    }

    const kdvRaw = parseDecimalInput(editTaxRate)
    if (kdvRaw == null || kdvRaw < 0 || kdvRaw > 100) {
      setEditError('KDV 0 ile 100 arasında olmalıdır')
      return
    }
    const taxRate = Math.round(kdvRaw)

    const disc = parseDecimalInput(editDiscount)
    if (disc != null && (disc < 0 || disc > 100)) {
      setEditError('İskonto 0 ile 100 arasında olmalıdır')
      return
    }
    const discountRate = disc == null ? 0 : clamp(disc, 0, 100)

    const basePrice = parseDecimalInput(editBasePrice)
    if (basePrice == null || basePrice <= 0) {
      setEditError('Baz fiyat geçerli değil')
      return
    }

    const effectiveBasePrice = round2(basePrice)

    if (effectiveBasePrice > MAX_PRICE_DEC18_2) {
      setEditError('Baz fiyat çok büyük. Daha küçük bir değer giriniz.')
      return
    }

    const baseGroupId = String(editBaseGroupId || '')
    if (!baseGroupId) {
      setEditError('Baz fiyat kategorisi seçiniz')
      return
    }

    const baseCode = Number(priceGroupById[String(baseGroupId)]?.code)

    const toSave = new Map<string, number>()

    // Save computed values for spare products or F4 base group.
    if (isSpareProduct(editProduct) || baseCode === 4) {
      if (!computed) {
        setEditError('Hesaplanan fiyatlar bulunamadı')
        return
      }

      const computedByGroupId = computed as Record<string, number>

      for (const pg of priceGroups) {
        const code = Number(pg.code)
        const raw = code === 4 ? (computedByGroupId[pg.id] ?? effectiveBasePrice) : computedByGroupId[pg.id]
        const n = Number(raw)
        if (!Number.isFinite(n) || n <= 0) continue
        if (n > MAX_PRICE_DEC18_2) continue
        toSave.set(pg.id, round2(n))
      }
    } else {
      toSave.set(baseGroupId, effectiveBasePrice)
    }

    if (toSave.size === 0) {
      setEditError('Kaydedilecek fiyat bulunamadı')
      return
    }

    try {
      setEditSaving(true)
      setEditError(null)

      const entries = Array.from(toSave.entries()).map(([priceGroupId, price]) => ({ priceGroupId, price }))

      await Promise.all(
        entries.map((x) =>
          upsertProductPrice({
            productId: editProduct.id,
            priceGroupId: x.priceGroupId,
            price: x.price,
            currency
          })
        )
      )

      const resRate = await fetch(`${API_BASE_URL}/api/products/${editProduct.id}/rates`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('accessToken') ?? ''}`
        },
        body: JSON.stringify({ taxRate, discountRate })
      })

      if (!resRate.ok) {
        const t = await resRate.text().catch(() => '')
        throw new Error(t || `KDV/İskonto kaydedilemedi (${resRate.status})`)
      }

      setEditOpen(false)
      await reload()
    } catch (e: any) {
      setEditError(String(e?.message ?? 'Kaydedilemedi'))
    } finally {
      setEditSaving(false)
    }
  }

  const applyComputedToInputs = () => {
    if (!editProduct) return
    const computed = editComputed
    if (!computed) {
      setEditError('Baz fiyat geçerli değil')
      return
    }

    const baseCode = Number(priceGroupById[String(editBaseGroupId || '')]?.code)
    if (baseCode !== 4) return
    const computedByGroupId = computed as Record<string, number>

    setEditPricesByGroupId((prev) => {
      const next = { ...prev }
      for (const pg of priceGroups) {
        const price = computedByGroupId[pg.id]
        if (price == null) continue
        next[pg.id] = String(price)
      }
      return next
    })
  }

  const columns: Array<DataGridColumn<Row>> = useMemo(
    () => {
      const priceColumns: Array<DataGridColumn<Row>> = priceGroups
        .slice()
        .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || Number(a.code ?? 0) - Number(b.code ?? 0))
        .map((pg) => {
          return {
            key: `price_${pg.id}`,
            header: `${pg.code} - ${pg.name}`,
            width: 120,
            align: 'right',
            render: (r) => {
              const v = r.pricesByGroupId[pg.id]?.price
              return v == null ? '' : formatMoney(v)
            }
          } satisfies DataGridColumn<Row>
        })

      return [
      {
        key: 'img',
        header: '',
        width: 54,
        align: 'center',
        render: (r) => {
          const url = r.product.imageUrl
          return (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                openPreview(r.product)
              }}
              className="h-10 w-10 border border-gray-200 bg-gray-50 overflow-hidden flex items-center justify-center"
              title="Önizleme"
            >
              {url ? <img src={toImageSrc(url)} alt="" className="h-10 w-10 object-cover" /> : <ImageIcon size={16} className="text-gray-400" />}
            </button>
          )
        }
      },
      {
        key: 'stockCode',
        header: 'STOK KODU',
        width: 140,
        render: (r) => <span className="font-mono text-xs">{r.product.stockCode}</span>
      },
      {
        key: 'name',
        header: 'ÜRÜN ADI',
        width: 320,
        render: (r) => (
          <div className="flex items-center gap-1.5">
            <span className="text-sm">{r.product.name}</span>
            {isSpareProduct(r.product) && (
              <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-sky-100 text-sky-800 border border-sky-300">
                YEDEK PARÇA
              </span>
            )}
          </div>
        )
      },
      {
        key: 'stock',
        header: 'STOK',
        width: 90,
        align: 'right',
        render: (r) => String(r.product.stock ?? 0)
      },
      {
        key: 'kdv',
        header: 'KDV ORA',
        width: 90,
        align: 'right',
        render: (r) => String(r.taxRate ?? 0)
      },
      {
        key: 'iskonto',
        header: 'İSKONTO',
        width: 90,
        align: 'right',
        render: (r) => formatMoney(r.discountRate)
      },
      ...priceColumns,
      {
        key: 'actions',
        header: '',
        width: 80,
        pin: 'right',
        align: 'right',
        render: (r) => (
          <div className="flex items-center justify-end">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                openEdit(r)
              }}
              className="h-8 w-8 flex items-center justify-center rounded hover:bg-gray-100"
              title="Fiyat Düzenle"
            >
              <Pencil size={16} className="text-gray-700" />
            </button>
          </div>
        )
      }
      ]
    },
    [priceGroups]
  )

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900 tracking-tight">Fiyat Atama</h1>
          <p className="text-xs text-gray-400 mt-0.5">Fiyatlandırma / Toplu Fiyat Atama</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={openBulkConfirm}
            disabled={loading || bulkBusy || priceGroups.length === 0}
            title="Her ürünün mevcut Fiyat 4'üne bakarak diğer fiyat gruplarını yeniden hesaplar"
            className="h-[34px] inline-flex items-center gap-1.5 px-4 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white shadow-sm transition"
          >
            <RefreshCcw size={13} />
            Fiyat 4'e Göre Toplu Güncelle
          </button>
          <button
            type="button"
            onClick={() => void reload()}
            className="h-[34px] inline-flex items-center gap-1.5 px-4 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
            Yenile
          </button>
        </div>
      </div>

      {bulkMessage && !bulkConfirmOpen ? (
        <div className="bg-indigo-50 border border-indigo-200 text-indigo-900 text-xs font-semibold rounded-lg px-3 py-2">
          {bulkMessage}
        </div>
      ) : null}

      <Modal
        isOpen={bulkConfirmOpen}
        onClose={() => {
          if (bulkBusy) return
          setBulkConfirmOpen(false)
        }}
        title="Fiyat 4'e Göre Toplu Güncelle"
        footer={
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              disabled={bulkBusy}
              onClick={() => setBulkConfirmOpen(false)}
              className="px-4 py-2 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-800 font-semibold disabled:opacity-60"
            >
              Vazgeç
            </button>
            <button
              type="button"
              disabled={bulkBusy || bulkPlan.rows === 0}
              onClick={() => void runBulkRecalc()}
              className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-semibold disabled:opacity-60"
            >
              {bulkBusy ? 'Güncelleniyor...' : 'Güncelle'}
            </button>
          </div>
        }
      >
        <div className="space-y-3 text-sm text-gray-700">
          <p>
            Ekrandaki her ürünün <b>mevcut Fiyat 4</b> değeri temel alınarak diğer fiyat grupları
            (Askeriye dâhil) yeniden hesaplanacak. Fiyat 4'e dokunulmaz.
          </p>

          {bulkPlan.rows === 0 ? (
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 text-emerald-900 text-xs font-semibold">
              Güncellenecek bir şey yok — tüm gruplar Fiyat 4 ile zaten uyumlu.
            </div>
          ) : (
            <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-amber-900 text-xs font-semibold space-y-1">
              <div>{bulkPlan.productCount} üründe {bulkPlan.rows} fiyat satırı değişecek.</div>
              {bulkPlan.skipped > 0 ? (
                <div>Fiyat 4'ü olmayan / 0 olan {bulkPlan.skipped} ürüne dokunulmayacak.</div>
              ) : null}
            </div>
          )}

          <p className="text-[11px] text-gray-500 leading-relaxed">
            Hesap, ürün kartındaki düzenleme ekranıyla aynı formülleri kullanır. Değişen her fiyat
            geçmişe yazılır, sonradan "neyi neye çevirdi" görülebilir. Süzgeç uygularsanız yalnızca
            süzülen ürünler güncellenir.
          </p>

          {bulkMessage ? (
            <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs">{bulkMessage}</div>
          ) : null}
        </div>
      </Modal>

      <div className="bg-white border border-gray-100 rounded-xl shadow-sm p-3 grid grid-cols-1 md:grid-cols-3 gap-3">
        <FormInput label="Ürün Adı" value={filterName} onChange={(e) => setFilterName(e.target.value)} placeholder="Ara..." />
        <FormInput label="Stok Kodu" value={filterStockCode} onChange={(e) => setFilterStockCode(e.target.value)} placeholder="Ara..." />
        <FormInput
          label="Stok (min)"
          value={filterStockMin}
          onChange={(e) => setFilterStockMin(e.target.value)}
          inputMode="numeric"
          placeholder="0"
        />
      </div>

      {error && <div className="text-xs font-semibold text-red-600">{error}</div>}

      <DataGrid<Row>
        columns={columns}
        rows={filteredRows}
        rowKey={(r) => r.product.id}
        isLoading={loading}
        emptyText="Ürün bulunamadı."
        heightClassName="max-h-[calc(100vh-260px)]"
      />

      <Modal
        isOpen={previewOpen}
        onClose={() => setPreviewOpen(false)}
        title={previewProduct ? `${previewProduct.stockCode} - ${previewProduct.name}` : 'Önizleme'}
        footer={
          <button
            type="button"
            onClick={() => setPreviewOpen(false)}
            className="h-[34px] px-4 text-xs font-semibold rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 transition"
          >
            Kapat
          </button>
        }
      >
        <div className="space-y-3">
          <div className="text-xs text-gray-600">Stok: {previewProduct?.stock ?? 0} | KDV: {previewProduct?.taxRate ?? 0}%</div>
          <div className="border border-gray-200 bg-gray-50 overflow-hidden">
            {previewProduct?.imageUrl ? (
              <img src={toImageSrc(previewProduct.imageUrl)} alt="" className="w-full max-h-[60vh] object-contain" />
            ) : (
              <div className="p-8 text-sm text-gray-500">Görsel yok.</div>
            )}
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={editOpen}
        onClose={() => {
          if (editSaving) return
          setEditOpen(false)
        }}
        title={editProduct ? `Fiyat Düzenle - ${editProduct.stockCode}` : 'Fiyat Düzenle'}
        footer={
          <>
            <button
              type="button"
              disabled={editSaving}
              onClick={() => setEditOpen(false)}
              className="h-[34px] px-4 text-xs font-semibold rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 transition"
            >
              Vazgeç
            </button>
            <button
              type="button"
              disabled={editSaving}
              onClick={() => applyComputedToInputs()}
              className="h-[34px] inline-flex items-center gap-1.5 px-4 text-xs font-semibold rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 transition"
            >
              Hesapla
            </button>
            <button
              type="button"
              disabled={editSaving}
              onClick={() => void submitEdit()}
              className="h-[34px] inline-flex items-center gap-1.5 px-4 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition disabled:opacity-60"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
              {editSaving ? 'Kaydediliyor...' : 'Kaydet'}
            </button>
          </>
        }
      >
        {editError && <div className="mb-3 text-xs font-semibold text-red-600">{editError}</div>}

        {editProduct && isSpareProduct(editProduct) ? (
          <div className="mb-4 bg-sky-50 border border-sky-200 rounded-lg p-3 text-xs text-sky-800 flex items-center gap-2">
            <span className="text-base">🛠️</span>
            <div>
              <strong>Yedek Parça Fiyatlandırması:</strong> 1, 2, 3 gruplarında KDV düşülerek hesaplanır (satış faturasında KDV ekleneceğinden net tutar KDV dahil baz fiyata ulaşır). 4, 5, 6 gruplarında ise baz fiyat uygulanır.
            </div>
          </div>
        ) : null}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <FormInput
            label="KDV (%)"
            value={editTaxRate}
            onChange={(e) => setEditTaxRate(sanitizeDecimalText(e.target.value, { max: 100, decimals: 0 }))}
            placeholder="20"
            inputMode="numeric"
          />
          <FormInput
            label="İskonto (%)"
            value={editDiscount}
            onChange={(e) => setEditDiscount(sanitizeDiscountText(e.target.value))}
            placeholder="20"
            inputMode="decimal"
            disabled={Boolean(editProduct && isSpareProduct(editProduct))}
          />
          <FormInput
            label="Baz Fiyat (Tüm Gruplar İçin Tek Fiyat)"
            value={editBasePrice}
            onChange={(e) => setEditBasePrice(sanitizeDecimalText(e.target.value, { max: MAX_PRICE_DEC18_2, decimals: 2 }))}
            placeholder="0"
            inputMode="decimal"
          />
          {editProduct && Boolean((editProduct as any).isInstallable) && Number((editProduct as any).installationFee ?? 0) > 0 ? (
            <div className="md:col-span-3 -mt-2">
              <div className="text-[11px] text-gray-500">
                {(() => {
                  const kdvRaw = parseDecimalInput(editTaxRate)
                  const kdvRate = kdvRaw == null ? Number(editProduct.taxRate ?? 0) : clamp(Number(kdvRaw), 0, 100)
                  const gross = Math.max(0, Number((editProduct as any).installationFee ?? 0))
                  const net = kdvRate > 0 ? gross / (1 + kdvRate / 100) : gross
                  const vat = Math.max(0, gross - net)
                  const cur = String(editCurrency || 'TL').trim().toUpperCase()
                  return (
                    <>
                      Montaj: <span className="font-semibold text-gray-700">{formatMoney(net)} {cur}</span>
                      {' '}| KDV (%{Math.round(kdvRate)}): <span className="font-semibold text-gray-700">{formatMoney(vat)} {cur}</span>
                      {' '}| KDV Dahil: <span className="font-semibold text-gray-700">{formatMoney(gross)} {cur}</span>
                    </>
                  )
                })()}
              </div>
            </div>
          ) : null}
          <FormSelect
            label="Baz Fiyat Kategorisi"
            value={editBaseGroupId}
            onChange={(e) => {
              const nextId = String(e.target.value || '')
              setEditBaseGroupId(nextId)
              const p = editProduct
              if (!p) return
              const row = rows.find((r) => r.product.id === p.id)
              if (!row) return
              const nextPrice = row.pricesByGroupId[nextId]?.price
              if (nextPrice == null) {
                setEditBasePrice('')
              } else {
                setEditBasePrice(formatMoney(Math.max(0, Number(nextPrice))).replace(/\./g, '').replace(',', '.'))
              }
              const nextCur = (row.pricesByGroupId[nextId]?.currency ?? p.currency ?? 'TL') as string
              setEditCurrency(nextCur)
            }}
            options={priceGroups
              .slice()
              .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || String(a.code).localeCompare(String(b.code)))
              .map((pg) => ({
                value: pg.id,
                label: `${String(pg.code || '').toUpperCase()} - ${pg.name}`
              }))}
          />
          <FormSelect
            label="Currency"
            value={editCurrency}
            onChange={(e) => setEditCurrency(e.target.value)}
            options={[
              { value: 'TL', label: 'TL' },
              { value: 'USD', label: 'USD' },
              { value: 'EUR', label: 'EUR' },
              { value: 'GBP', label: 'GBP (Sterlin)' }
            ]}
          />
        </div>

        <div className="mt-4 border border-gray-200 rounded overflow-hidden">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-0">
            {priceGroups
              .slice()
              .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || Number(a.code ?? 0) - Number(b.code ?? 0))
              .map((pg) => (
                <div key={pg.id} className="px-3 py-2 border-b border-gray-200">
                  <div className="text-[11px] font-semibold text-gray-600">{pg.code} - {pg.name}</div>
                  <input
                    value={editPricesByGroupId[pg.id] ?? ''}
                    onChange={(e) => {
                      const v = sanitizeDecimalText(e.target.value, { max: MAX_PRICE_DEC18_2, decimals: 2 })
                      if (editProduct && isSpareProduct(editProduct)) {
                        const code = String(pg.code ?? '').trim()
                        if (code === '1' || code === '2' || code === '3') {
                          setEditPricesByGroupId((p) => ({ ...p, [pg.id]: v }))
                        } else {
                          setEditBasePrice(v)
                        }
                      } else {
                        setEditPricesByGroupId((p) => ({ ...p, [pg.id]: v }))
                      }
                    }}
                    inputMode="decimal"
                    placeholder="0"
                    className="mt-1 w-full h-9 px-3 rounded-md border border-gray-200 text-sm"
                  />
                </div>
              ))}
          </div>
        </div>

        <div className="mt-4 border border-gray-200 rounded overflow-hidden">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-0">
            {editComputed
              ? priceGroups
                  .slice()
                  .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || Number(a.code ?? 0) - Number(b.code ?? 0))
                  .map((pg) => {
                    const v = (editComputed as Record<string, number>)[pg.id]
                    if (v == null) return null
                    return (
                      <div key={pg.id} className="px-3 py-2 border-b border-gray-200">
                        <div className="text-[11px] font-semibold text-gray-600">
                          {pg.code} - {pg.name}
                        </div>
                        <div className="text-sm font-semibold text-gray-800">
                          {formatMoney(v)} {String(editCurrency || 'TL').trim().toUpperCase()}
                        </div>
                      </div>
                    )
                  })
              : null}
          </div>
        </div>

        <div className="mt-3 text-[11px] text-gray-500">
          {editProduct && isSpareProduct(editProduct) ? (
            <span className="text-sky-700 font-semibold">ℹ️ Yedek parçalarda F1, F2, F3 gruplarında fiyat KDV düşülerek hesaplanır (satış faturasında KDV eklendiğinde net tutar 1.000 TL'ye ulaşır). F4, F5, F6 gruplarına baz fiyat uygulanır.</span>
          ) : (
            'Baz kategori F4 ise (mevcut sistemle uyumlu) FIYAT-4 baz alınır. FIYAT-5 = FIYAT-4 * 0.88, FIYAT-6 = FIYAT-4 * (1-İskonto). FIYAT-1..3 ilgili fiyatların KDV hariç halleridir.'
          )}
        </div>
      </Modal>
    </div>
  )
}
