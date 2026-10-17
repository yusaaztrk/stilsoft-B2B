import React, { useEffect, useMemo, useState, useCallback } from 'react'
import { RefreshCw, Check, Search, Info, AlertTriangle, Settings, Download } from 'lucide-react'
import Modal from '../components/Modal'
import TerminDetayModal from '../components/TerminDetayModal'
import * as XLSX from 'xlsx'
import { fetchAuthorizedStockBalances } from '../api/warehouses'
import {
  fetchBulkPricingProducts,
  fetchBulkPricingCategories,
  applyBulkPricing,
  updateProductCost,
  type BulkPricingProductDto,
  type BulkPricingCategoryDto
} from '../api/bulkPricing'

/**
 * TOPLU FİYAT ATAMA
 *
 * Referans: "KIBRIS fiyat guncelle.xlsm" (NETSIS sayfası).
 *
 * MALİYET — girdiler ÜRÜN KARTINDAN, kur SİSTEMDEN gelir; ekranda elle girilmez:
 *   alış TL           = PurchasePrice × anlık kur       (alış TL ise kur 1)
 *   adet başı navlun  = navlun USD / ContainerQuantity  → TL'ye çevrilir
 *   maliyet TL        = alış TL + adet başı navlun TL
 *   maliyet KDV dahil = maliyet TL × (1 + KDV/100)
 *
 * Excel her şeyi USD varsayıp topluyor (S + U/T) sonra tek kurla çarpıyor. Burada alış ve
 * navlun AYRI AYRI TL'ye çevrilip toplanıyor: alış TL, navlun USD olabiliyor ve ikisini
 * doğrudan toplamak yanlış olur. Alışın da USD olduğu satırlarda sonuç Excel ile aynıdır.
 *
 * SATIŞ FİYATLARI — hepsi FİYAT 4'ten türer:
 *   Fiyat 6 = Fiyat 4 × (1 − iskonto/100)
 *   Fiyat 5 = Fiyat 6 × 1.1
 *   Fiyat 1/2/3 = Fiyat 4/5/6 ÷ (1 + KDV/100)
 *   Kâr%  = (Fiyat 6 − maliyet KDV dahil) / maliyet KDV dahil
 *
 * KDV ve iskonto SATIR BAZINDA değişir (ürünün kendi oranı).
 */

function parseNum(text: string): number | null {
  const s = String(text ?? '').trim().replace(/\./g, '').replace(',', '.')
  if (!s) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

/**
 * KUR alanı para gibi ayrıştırılmaz. tr-TR'de "1.234" bin iki yüz otuz dörttür; kurda tek
 * ayraç HER ZAMAN ondalıktır (47,7364). Para parser'ıyla okunursa 4 ondalıklı kur on binlerce
 * katına çıkar — bu hata bu projede banka ekranında bir kez yaşandı.
 */
function parseRate(text: string): number | null {
  const s = String(text ?? '').trim().replace(',', '.')
  if (!s) return null
  const n = Number(s)
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * "ANA GRUP / ALT GRUP" birleşik etiketi. Aynı ad birden çok ağaçta olabildiği için
 * (DEMO/Gıda Hazırlama ile YED-STIL/Gıda Hazırlama ayrı kategoriler) alt grup tek
 * başına yeterli değil — hangi ağaçtan olduğu ana grupla birlikte gösterilir/süzülür.
 */
function grupLabelOf(r: { mainCategory?: string | null; subCategory?: string | null }): string {
  return [r.mainCategory, r.subCategory].map((x) => String(x ?? '').trim()).filter(Boolean).join(' / ')
}

function money(n: number, digits = 2) {
  if (!Number.isFinite(n)) return '-'
  return n.toLocaleString('tr-TR', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

function pct(n: number | null) {
  if (n === null || !Number.isFinite(n)) return '-'
  return `%${(n * 100).toLocaleString('tr-TR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}`
}

/** Fiyat 4'ten türeyen altı fiyat. Sunucudaki DerivePrices ile AYNI kural. */
export function derivePrices(price4: number, taxRate: number, discountRate: number) {
  const divisor = 1 + taxRate / 100
  const d = divisor > 0 ? divisor : 1
  const p4 = price4
  const p6 = p4 - (p4 * discountRate) / 100
  const p5 = p6 * 1.1
  return { p1: p4 / d, p2: p5 / d, p3: p6 / d, p4, p5, p6 }
}

export default function BulkPricingPage() {
  const [rows, setRows] = useState<BulkPricingProductDto[]>([])
  const [categories, setCategories] = useState<BulkPricingCategoryDto[]>([])
  const [rates, setRates] = useState<Record<string, number>>({})
  const [rateDate, setRateDate] = useState<string | null>(null)
  const [rateWarning, setRateWarning] = useState<string | null>(null)
  const [rateProvider, setRateProvider] = useState<string | null>(null)

  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [q, setQ] = useState('')
  const [category, setCategory] = useState('')
  // Varsayılan yalnızca aktif ürünler. 264 üründen 161'i aktif; kalan 103'ü görmek için.
  const [includeInactive, setIncludeInactive] = useState(false)

  // Navlun ÜRÜN KARTINDAN gelir (Products.Freight). Buradaki sözlük yalnızca o satır için
  // geçici olarak ezmek içindir; boşsa ürünün kendi navlunu kullanılır.
  const [freightOverrides, setFreightOverrides] = useState<Record<string, string>>({})

  // Sütun süzgeçleri
  const [fStok, setFStok] = useState('')
  const [fAd, setFAd] = useState('')
  const [fAltGrup, setFAltGrup] = useState('')
  const [fKdv, setFKdv] = useState('')
  const [fIsk, setFIsk] = useState('')
  const [fPara, setFPara] = useState('')
  const [fSatis, setFSatis] = useState('')
  const [fTedarik, setFTedarik] = useState('')

  // Elle girilen kur. Boşsa sistemden gelen kullanılır; doluysa O satır para birimi için
  // sistem kuru EZİLİR. TCMB'ye ulaşılamadığında veya anlaşmalı kur kullanılırken gerekir.
  const [rateOverrides, setRateOverrides] = useState<Record<string, string>>({})

  const [priceDrafts, setPriceDrafts] = useState<Record<string, string>>({})
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [editProductId, setEditProductId] = useState<string | null>(null)

  // Depo bazlı stok. `includeAll` ile: PASİF depolar dahil, gerçek (maskesiz) rakam.
  // Sunucu bunu yalnız tam stok yetkisi olan kullanıcıda dikkate alır.
  const [stockByCode, setStockByCode] = useState<
    Record<
      string,
      {
        total: number
        /** Tüm depoların ham net toplamı (pasif dahil). includeAll + yetki varsa dolu. */
        trueTotal: number | null
        balances: Array<{ warehouseName: string; balance: number; isActive: boolean }>
      }
    >
  >({})
  const [stockLoading, setStockLoading] = useState(false)
  const [stockModalCode, setStockModalCode] = useState<string | null>(null)
  /** Termin kırılımı açılan stok; null ise pencere kapalı. */
  const [terminStok, setTerminStok] = useState<{ kod: string; ad: string } | null>(null)

  const handleToggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const handleEdit = useCallback((id: string) => {
    setEditProductId(id)
  }, [])

  const handleShowStock = useCallback((code: string) => {
    setStockModalCode(code)
  }, [])

  const handleFreightChange = useCallback((id: string, val: string) => {
    setFreightOverrides((prev) => ({ ...prev, [id]: val }))
  }, [])

  const handlePriceChange = useCallback((id: string, val: string) => {
    setPriceDrafts((prev) => ({ ...prev, [id]: val }))
  }, [])

  const load = async () => {
    try {
      setLoading(true)
      setError(null)
      const [data, cats] = await Promise.all([
        fetchBulkPricingProducts({ q, mainCategory: category, pageSize: 500, includeInactive }),
        categories.length === 0 ? fetchBulkPricingCategories() : Promise.resolve(categories)
      ])
      setRows(data.items)
      setRates(data.rates ?? {})
      setRateDate(data.rateDate ?? null)
      setRateWarning(data.rateWarning ?? null)
      setRateProvider(data.rateProvider ?? null)
      setCategories(cats)
    } catch (e: any) {
      setError(String(e?.message ?? 'Ürünler alınamadı'))
      setRows([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category, includeInactive])

  // Stok bakiyeleri satırlar gelince toplu çekilir. Uç tek çağrıda EN FAZLA 200 stok kodu
  // kabul ediyor; ürün sayısı bunu aşabildiği için parçalara bölünür.
  useEffect(() => {
    if (rows.length === 0) {
      setStockByCode({})
      return
    }
    const ac = new AbortController()
    void (async () => {
      try {
        setStockLoading(true)
        const codes = rows.map((r) => r.stockCode).filter(Boolean)
        const chunks: string[][] = []
        for (let i = 0; i < codes.length; i += 200) chunks.push(codes.slice(i, i + 200))

        const promises = chunks.map(chunk => fetchAuthorizedStockBalances(chunk, { signal: ac.signal, includeAll: true }))
        const results = await Promise.all(promises)

        const map: Record<
          string,
          { total: number; trueTotal: number | null; balances: Array<{ warehouseName: string; balance: number; isActive: boolean }> }
        > = {}
        for (const data of results) {
          const whInfo = new Map(
            (data.warehouses ?? []).map((w: any) => [
              w.warehouseCode,
              { name: w.name ?? `Depo ${w.warehouseCode}`, isActive: w.isActive !== false }
            ])
          )
          for (const item of (data.items ?? [])) {
            const balances = (item.balances ?? [])
              .map((b: any) => {
                const info = whInfo.get(b.warehouseCode)
                return {
                  warehouseName: String(info?.name ?? `Depo ${b.warehouseCode}`),
                  balance: Number(b.balance ?? 0),
                  isActive: info?.isActive !== false
                }
              })
              .filter((b) => b.balance !== 0)
              .sort((a, b) => b.balance - a.balance)
            map[String(item.stockCode)] = {
              total: balances.reduce((acc, b) => acc + b.balance, 0),
              trueTotal: item.trueTotal == null ? null : Number(item.trueTotal),
              balances
            }
          }
        }
        setStockByCode(map)
      } catch {
        // Stok alınamazsa sayfa çalışmaya devam eder; kolonda "-" görünür.
        setStockByCode({})
      } finally {
        setStockLoading(false)
      }
    })()
    return () => ac.abort()
  }, [rows])

  const stockOf = (code: string) => stockByCode[code] ?? null

  /** Kullanılacak kur: elle girilen varsa o, yoksa sistemden gelen. */
  const effectiveRate = (code: string): number => {
    const c = String(code ?? '').toUpperCase()
    if (c === 'TRY') return 1
    return parseRate(rateOverrides[c] ?? '') ?? Number(rates[c] ?? 0)
  }

  const isOverridden = (code: string) => parseRate(rateOverrides[String(code).toUpperCase()] ?? '') !== null

  const usdRate = effectiveRate('USD')

  /** Satırın tüm hesapları. Maliyet girdisi eksikse kâr oranları null (bilinmiyor). */
  const computeRow = (r: BulkPricingProductDto) => {
    // Navlun HER ZAMAN USD üzerinden hesaplanır (konteyner başına USD → adet başı → TL).
    const freight = parseNum(freightOverrides[r.id] ?? '') ?? (r.freight > 0 ? r.freight : null)

    // Adet başı navlun: konteyner başına USD navlun / konteynerdeki adet → TL'ye çevir.
    let freightPerUnitTry: number | null = null
    if (freight !== null && r.containerQuantity > 0 && usdRate > 0) {
      freightPerUnitTry = (freight / r.containerQuantity) * usdRate
    }

    // Alışın TL karşılığı BURADA hesaplanır, sunucudan gelen purchasePriceTry kullanılmaz:
    // o değer sistem kuruyla üretilir ve elle kur girildiğinde güncellenmezdi.
    const pRate = effectiveRate(r.purchaseCurrency)
    const purchaseTry = r.purchasePrice > 0 && pRate > 0 ? r.purchasePrice * pRate : null
    const costTry =
      purchaseTry !== null && purchaseTry > 0 && freightPerUnitTry !== null
        ? purchaseTry + freightPerUnitTry
        : null
    const costWithVat = costTry !== null ? costTry * (1 + r.taxRate / 100) : null

    const newPrice4 = parseNum(priceDrafts[r.id] ?? '')
    const hasNew = newPrice4 !== null && newPrice4 > 0
    const next = hasNew ? derivePrices(newPrice4 as number, r.taxRate, r.discountRate) : null

    const marginOf = (p6: number) => (costWithVat && costWithVat > 0 ? (p6 - costWithVat) / costWithVat : null)

    // KÂR = mevcut fiyatın (Fiyat 6) kârı.
    const margin = marginOf(r.price6)

    // ESKİ KÂR = BİR ÖNCEKİ fiyatın kârı. Geçmişte tutulan eski Fiyat 4'ten aynı kuralla
    // Fiyat 6 türetilir; kâr her zaman Fiyat 6 üzerinden ölçülür.
    const prev = (r.priceHistory ?? [])[0]
    const prevMargin = prev
      ? marginOf(derivePrices(prev.oldPrice, r.taxRate, r.discountRate).p6)
      : null
    const newMargin = next ? marginOf(next.p6) : null
    const raisePct = next && r.price6 > 0 ? (next.p6 - r.price6) / r.price6 : null

    return { freightPerUnitTry, purchaseTry, costTry, costWithVat, hasNew, next, margin, prevMargin, newMargin, raisePct }
  }

  /**
   * SÜTUN SIRALAMA (2026-08-23).
   *
   * Bu ekran ortak `Table` bileşenini KULLANMIYOR (25 sütunlu, hücrelerinde giriş kutuları
   * olan elle yazılmış bir tablo), o yüzden sıralama da elle kuruldu. Döngü ve ikonlar ortak
   * tablodakiyle AYNI: artan (▲) → azalan (▼) → sıralama yok (⇅).
   *
   * Hesaplanan sütunlar (maliyet, kâr %, yeni F4 ...) `computeRow` üzerinden okunur; ekranda
   * ne görünüyorsa ona göre sıralanır, ham alana göre değil.
   */
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  const toggleSort = (key: string) => {
    if (sortKey !== key) {
      setSortKey(key)
      setSortDir('asc')
      return
    }
    if (sortDir === 'asc') {
      setSortDir('desc')
      return
    }
    // Üçüncü tık sıralamayı kaldırır — ortak tablodaki davranışın aynısı.
    setSortKey(null)
    setSortDir('asc')
  }

  const sortValue = (r: BulkPricingProductDto, key: string): string | number | null => {
    const c = computeRow(r)
    switch (key) {
      case 'stockCode': return r.stockCode ?? ''
      case 'name': return r.name ?? ''
      case 'subCategory': return grupLabelOf(r)
      case 'supplier': return r.supplierName ?? r.supplierCode ?? ''
      case 'saleOpen': return r.saleOpen ?? ''
      case 'stock': return Number(r.totalStock ?? 0)
      case 'termin': return Number(r.terminQuantity ?? 0)
      case 'taxRate': return Number(r.taxRate ?? 0)
      case 'discountRate': return Number(r.discountRate ?? 0)
      case 'purchase': return Number(r.purchasePrice ?? 0)
      case 'rate': return effectiveRate(r.purchaseCurrency)
      case 'purchaseTry': return c.purchaseTry
      case 'containerQuantity': return Number(r.containerQuantity ?? 0)
      case 'boxQuantity': return Number((r as any).boxQuantity ?? 0)
      case 'freight': return parseNum(freightOverrides[r.id] ?? '') ?? (r.freight > 0 ? r.freight : null)
      case 'freightPerUnit': return c.freightPerUnitTry
      case 'costTry': return c.costTry
      case 'costWithVat': return c.costWithVat
      case 'price4': return Number(r.price4 ?? 0)
      case 'newPrice4': return parseNum(priceDrafts[r.id] ?? '')
      case 'prevPrice': return Number((r.priceHistory ?? [])[0]?.oldPrice ?? 0)
      case 'prevMargin': return c.prevMargin
      case 'margin': return c.margin
      case 'newMargin': return c.newMargin
      case 'raisePct': return c.raisePct
      default: return null
    }
  }

  /** Sıralanabilir başlık hücresi. Ok, ortak tablodaki karakterlerin aynısı. */
  const SortTh = ({ k, label, className }: { k: string; label: React.ReactNode; className?: string }) => {
    const active = sortKey === k
    const align = String(className ?? '').includes('text-right')
      ? 'justify-end'
      : String(className ?? '').includes('text-left')
        ? 'justify-start'
        : 'justify-center'
    return (
      <th
        className={(className ?? th) + ' select-none'}
        aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}
      >
        <div
          className={`flex items-center gap-1.5 cursor-pointer hover:text-slate-900 ${align}`}
          onClick={() => toggleSort(k)}
          title={
            !active
              ? 'Küçükten büyüğe sırala'
              : sortDir === 'asc'
                ? 'Büyükten küçüğe sırala'
                : 'Sıralamayı kaldır'
          }
        >
          <span className="truncate">{label}</span>
          <span className="text-[10px] text-slate-400 shrink-0">
            {active ? (sortDir === 'asc' ? '▲' : '▼') : '⇅'}
          </span>
        </div>
      </th>
    )
  }

  /** Sütun süzgeçleri sunucuya gitmez; getirilen sayfa üzerinde çalışır. */
  const visibleRows = useMemo(() => {
    const nrm = (v: any) => String(v ?? '').toLocaleLowerCase('tr')
    const filtered = rows.filter((r) => {
      if (fStok && !nrm(r.stockCode).includes(nrm(fStok))) return false
      if (fAd && !nrm(r.name).includes(nrm(fAd))) return false
      if (fAltGrup && grupLabelOf(r) !== fAltGrup) return false
      if (fKdv && String(r.taxRate) !== fKdv) return false
      if (fIsk && String(r.discountRate) !== fIsk) return false
      if (fPara && r.purchaseCurrency !== fPara) return false
      if (fSatis && r.saleOpen !== fSatis) return false
      if (fTedarik && (r.supplierName ?? r.supplierCode ?? '') !== fTedarik) return false
      return true
    })

    if (!sortKey) return filtered

    // Bos deger (null) HER ZAMAN sona gider; yon degisince basa gecip listeyi bosla
    // doldurmasin diye yon carpaninin disinda tutuluyor.
    const dir = sortDir === 'asc' ? 1 : -1
    return [...filtered].sort((a, b) => {
      const va = sortValue(a, sortKey)
      const vb = sortValue(b, sortKey)
      const ea = va === null || va === undefined || va === ''
      const eb = vb === null || vb === undefined || vb === ''
      if (ea && eb) return 0
      if (ea) return 1
      if (eb) return -1
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir
      return String(va).localeCompare(String(vb), 'tr') * dir
    })
    // `sortValue` her render'da yeniden kuruluyor; bagimliliga eklenirse liste her seferinde
    // yeniden siralanir. Siralamayi etkileyen girdiler (taslak fiyat, navlun, kur) asagida.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, fStok, fAd, fAltGrup, fKdv, fIsk, fPara, fSatis, fTedarik, sortKey, sortDir, priceDrafts, freightOverrides, rateOverrides, rates])

  const altGrupOptions = useMemo(
    () => [...new Set(rows.map((r) => grupLabelOf(r)).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'tr')),
    [rows]
  )
  const kdvOptions = useMemo(() => [...new Set(rows.map((r) => String(r.taxRate)))].sort((a, b) => Number(a) - Number(b)), [rows])
  const iskOptions = useMemo(() => [...new Set(rows.map((r) => String(r.discountRate)))].sort((a, b) => Number(a) - Number(b)), [rows])
  const paraOptions = useMemo(() => [...new Set(rows.map((r) => r.purchaseCurrency))].sort(), [rows])
  const tedarikOptions = useMemo(
    () => [...new Set(rows.map((r) => r.supplierName ?? r.supplierCode ?? '').filter(Boolean))].sort((a, b) => a.localeCompare(b, 'tr')),
    [rows]
  )

  const pendingIds = useMemo(() => {
    return visibleRows
      .filter((r) => {
        const val = parseNum(priceDrafts[r.id] ?? '')
        return val !== null && val > 0
      })
      .map((r) => r.id)
  }, [visibleRows, priceDrafts])

  const selectedPending = useMemo(() => pendingIds.filter((id) => selected.has(id)), [pendingIds, selected])

  const toggleRow = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleAllPending = () => {
    setSelected((prev) => {
      const allChosen = pendingIds.length > 0 && pendingIds.every((id) => prev.has(id))
      return allChosen ? new Set() : new Set(pendingIds)
    })
  }

  const confirmSelected = async () => {
    if (selectedPending.length === 0) return
    try {
      setSaving(true)
      setError(null)
      setNotice(null)

      const items = selectedPending
        .map((id) => {
          const v = parseNum(priceDrafts[id] ?? '')
          return v && v > 0 ? { productId: id, price4: v } : null
        })
        .filter(Boolean) as Array<{ productId: string; price4: number }>

      const res = await applyBulkPricing(items)

      setPriceDrafts((prev) => {
        const next = { ...prev }
        for (const id of selectedPending) delete next[id]
        return next
      })
      setSelected(new Set())
      setNotice(`${res.updated} ürünün fiyatları güncellendi.`)
      await load()
    } catch (e: any) {
      setError(String(e?.message ?? 'Fiyatlar güncellenemedi'))
    } finally {
      setSaving(false)
    }
  }

  // Başlık hücreleri TEK TEK sabitlenir: <thead> üzerindeki sticky bütün tarayıcılarda
  // çalışmıyor. Arka plan şart, yoksa altından kayan satırlar başlığın içinden görünür.
  /**
   * Excel'e aktarım — EKRANDA GÖRÜNEN neyse o (süzgeçlerden geçmiş `visibleRows`).
   *
   * Yalnızca MEVCUT durum aktarılır: onaylanmamış önizleme değerleri (Yeni F4, Yeni Kâr %,
   * Zam %) dışarıda bırakıldı. Kaydedilmemiş bir sayının rapora karışması, dosyayı açan
   * kişide "bu fiyat geçerli" izlenimi bırakır.
   *
   * Sayılar metin değil SAYI olarak yazılır ki Excel'de toplanabilsin.
   */
  const exportToExcel = () => {
    const data = visibleRows.map((r) => {
      const c = computeRow(r)
      const h = (r.priceHistory ?? [])[0]
      return {
        'Stok Kodu': r.stockCode,
        'Stok Adı': r.name,
        'Ana Grup': r.mainCategory ?? '',
        'Ürün Alt Grubu': r.subCategory ?? '',
        'Tedarikçi': r.supplierName ?? r.supplierCode ?? '',
        'Durum': r.isActive ? 'Aktif' : 'Pasif',
        'Satışa Açık': r.saleOpen,
        'Stok (Depolar)': stockOf(r.stockCode)?.total ?? '',
        'Stok (Ürün Kartı)': r.totalStock,
        'Termin': r.terminQuantity ?? 0,
        'KDV %': r.taxRate,
        'İskonto %': r.discountRate,
        'Alış': r.purchasePrice,
        'Para Birimi': r.purchaseCurrency,
        'Kur': effectiveRate(r.purchaseCurrency),
        'Alış ₺': c.purchaseTry ?? '',
        'Konteyner Adedi': r.containerQuantity,
        'Kutudaki Adet': r.boxQuantity,
        'Navlun USD': parseNum(freightOverrides[r.id] ?? '') ?? r.freight,
        'Adet Başı Navlun ₺': c.freightPerUnitTry ?? '',
        'Maliyet ₺': c.costTry ?? '',
        'Maliyet (KDV Dahil)': c.costWithVat ?? '',
        'Mevcut F4': r.price4,
        'Önceki Fiyat': h ? h.oldPrice : '',
        'Önceki Fiyat Tarihi': h ? String(h.changedAt).slice(0, 10) : '',
        'Eski Kâr %': c.prevMargin === null ? '' : Number((c.prevMargin * 100).toFixed(1)),
        'Kâr %': c.margin === null ? '' : Number((c.margin * 100).toFixed(1))
      }
    })

    const ws = XLSX.utils.json_to_sheet(data)
    // Genişlikler yukarıdaki 23 kolonla BİREBİR aynı sırada olmalı.
    ws['!cols'] = [
      { wch: 14 }, // Stok Kodu
      { wch: 38 }, // Stok Adı
      { wch: 18 }, // Ürün Alt Grubu
      { wch: 16 }, // Tedarikçi
      { wch: 8 },  // Durum
      { wch: 11 }, // Satışa Açık
      { wch: 14 }, // Stok (Depolar)
      { wch: 16 }, // Stok (Ürün Kartı)
      { wch: 7 },  // KDV %
      { wch: 10 }, // İskonto %
      { wch: 10 }, // Alış
      { wch: 12 }, // Para Birimi
      { wch: 10 }, // Kur
      { wch: 12 }, // Alış ₺
      { wch: 15 }, // Konteyner Adedi
      { wch: 13 }, // Kutudaki Adet
      { wch: 12 }, // Navlun USD
      { wch: 17 }, // Adet Başı Navlun ₺
      { wch: 12 }, // Maliyet ₺
      { wch: 17 }, // Maliyet (KDV Dahil)
      { wch: 12 }, // Mevcut F4
      { wch: 13 }, // Önceki Fiyat
      { wch: 18 }, // Önceki Fiyat Tarihi
      { wch: 11 }, // Eski Kâr %
      { wch: 9 }   // Kâr %
    ]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Toplu Fiyat')
    const bugun = new Date().toISOString().slice(0, 10)
    XLSX.writeFile(wb, `toplu-fiyat-atama-${bugun}.xlsx`)
  }

  const th =
    'sticky top-0 z-20 bg-gray-50 border-b border-gray-200 px-2 py-2 text-[11px] font-semibold ' +
    'text-gray-600 uppercase tracking-wide whitespace-nowrap'
  // Süzgeç satırı başlığın hemen altına yapışır.
  const thFilter = 'sticky top-[34px] z-20 bg-white border-b border-gray-200 px-2 py-1'
  const td = 'px-2 py-1.5 text-xs text-gray-800 whitespace-nowrap'
  const filterInput =
    'w-full text-[11px] border border-gray-200 rounded px-1.5 py-1 bg-white focus:outline-none focus:ring-2 focus:ring-blue-200'
  const numInput =
    'w-24 text-xs text-right border border-gray-200 rounded px-1.5 py-1 focus:outline-none focus:ring-2 focus:ring-blue-200'

  const CURRENCY_ORDER = ['USD', 'EUR', 'GBP']

  const rateChips = Object.entries(rates)
    .filter(([k]) => CURRENCY_ORDER.includes(k))
    .sort(([a], [b]) => CURRENCY_ORDER.indexOf(a) - CURRENCY_ORDER.indexOf(b))

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900 tracking-tight">Toplu Fiyat Atama</h1>
          <p className="text-xs text-gray-400 mt-0.5">Ayarlar / Toplu Fiyat Atama</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={exportToExcel}
            disabled={loading || visibleRows.length === 0}
            title="Ekranda görünen satırları Excel'e aktarır"
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            <Download size={14} />
            Excel'e Aktar
          </button>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            <RefreshCw size={14} />
            Yenile
          </button>
          <button
            type="button"
            onClick={() => void confirmSelected()}
            disabled={saving || selectedPending.length === 0}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Check size={14} />
            {saving ? 'Kaydediliyor...' : `Onayla (${selectedPending.length})`}
          </button>
        </div>
      </div>

      {error && <div className="mb-3 px-3 py-2 text-xs rounded bg-red-50 border border-red-200 text-red-700">{error}</div>}
      {notice && (
        <div className="mb-3 px-3 py-2 text-xs rounded bg-emerald-50 border border-emerald-200 text-emerald-700">
          {notice}
        </div>
      )}
      {rateWarning && (
        <div className="mb-3 px-3 py-2 text-xs rounded bg-amber-50 border border-amber-300 text-amber-800 flex items-center gap-2">
          <AlertTriangle size={14} />
          {rateWarning}
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-lg p-3 mb-3">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
          <div className="md:col-span-2">
            <label className="block text-[11px] font-semibold text-gray-600 mb-1">Ürün Ara</label>
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void load()
                }}
                placeholder="Stok kodu veya ad..."
                className="w-full pl-8 pr-2 py-1.5 text-xs border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-blue-200"
              />
            </div>
          </div>

          <div className="flex items-end pb-1">
            <label className="flex items-center gap-2 text-xs text-gray-700 cursor-pointer">
              <input
                type="checkbox"
                checked={includeInactive}
                onChange={(e) => setIncludeInactive(e.target.checked)}
              />
              <span>Pasif ürünleri de göster</span>
            </label>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-gray-600 mb-1">Kategori</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full text-xs border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-200"
            >
              <option value="">Tümü</option>
              {categories.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.name || c.key}
                </option>
              ))}
            </select>
          </div>

        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-semibold text-gray-600">Kur:</span>
          {rateChips.length === 0 ? (
            <span className="text-[11px] text-gray-400">alınamadı</span>
          ) : (
            rateChips.map(([code, v]) => {
              const over = isOverridden(code)
              return (
                <span
                  key={code}
                  className={
                    'flex items-center gap-1 px-2 py-1 text-[11px] rounded border font-semibold ' +
                    (over ? 'bg-blue-50 text-blue-800 border-blue-300' : 'bg-gray-50 text-gray-700 border-gray-200')
                  }
                >
                  1 {code} = ₺
                  <input
                    value={rateOverrides[code] ?? ''}
                    onChange={(e) => setRateOverrides((prev) => ({ ...prev, [code]: e.target.value }))}
                    placeholder={money(Number(v), 4)}
                    title={over ? 'Elle girilen kur — sistem kurunu ezer' : `Sistem kuru: ${money(Number(v), 4)}`}
                    className="w-20 text-[11px] text-right bg-white border border-gray-300 rounded px-1 py-0.5 focus:outline-none focus:ring-2 focus:ring-blue-200"
                  />
                  {over && (
                    <button
                      type="button"
                      onClick={() =>
                        setRateOverrides((prev) => {
                          const next = { ...prev }
                          delete next[code]
                          return next
                        })
                      }
                      title="Sistem kuruna dön"
                      className="text-blue-700 hover:text-blue-900 font-bold leading-none"
                    >
                      ×
                    </button>
                  )}
                </span>
              )
            })
          )}
          {Object.keys(rateOverrides).some((k) => isOverridden(k)) && (
            <button
              type="button"
              onClick={() => setRateOverrides({})}
              className="px-2 py-1 text-[11px] font-semibold rounded border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
            >
              Tüm kurları sisteme döndür
            </button>
          )}
          {rateDate && (
            <span className="text-[11px] text-gray-400">({String(rateDate).slice(0, 10)})</span>
          )}
          {rateProvider && (
            <span
              className={
                'px-2 py-0.5 text-[11px] rounded border font-semibold ' +
                (rateProvider.toLowerCase() === 'fallback'
                  ? 'bg-amber-50 text-amber-800 border-amber-300'
                  : 'bg-gray-50 text-gray-600 border-gray-200')
              }
              title="Kurun geldiği kaynak. Fallback ise TCMB'ye ulaşılamamış demektir."
            >
              kaynak: {rateProvider}
            </span>
          )}
        </div>

        <div className="mt-2 flex items-start gap-1.5 text-[11px] text-gray-500">
          <Info size={13} className="mt-0.5 shrink-0" />
          <span>
            Alış fiyatı, para birimi ve konteyner adedi <b>ürün kartından</b> gelir; kur <b>sistemden</b> anlık çekilir ve kutulara yazarak <b>elle ezilebilir</b> (mavi = elle girilmiş).
            Navlun da ürün kartından gelir; satırdaki kutuya yazarsanız o satır için geçici olarak ezilir. Navlun her zaman USD üzerinden hesaplanır.
            Kaydedilen tek şey fiyatlardır.
          </span>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        {/* SABİT BAŞLIK: kapsayıcıda yalnızca `overflow-x-auto` varken tarayıcı `overflow-y`yi de
            `auto` sayar; sticky o kapsayıcıya göre çalışır ama kapsayıcının kendi dikey kaydırması
            olmadığı için hiç tetiklenmez. Yükseklik sınırı + `overflow-auto` ile tablo KENDİ İÇİNDE
            kayar ve başlık gerçekten sabit kalır. */}
        <div className="overflow-auto max-h-[calc(100vh-320px)] min-h-[300px]">
          <table className="min-w-full border-separate border-spacing-0">
            <thead>
              <tr>
                <th className={th}>
                  <input
                    type="checkbox"
                    checked={pendingIds.length > 0 && pendingIds.every((id) => selected.has(id))}
                    onChange={toggleAllPending}
                    disabled={pendingIds.length === 0}
                  />
                </th>
                <th className={th}></th>
                <SortTh k="stockCode" label="Stok Kodu" className={th + ' text-left'} />
                <SortTh k="name" label="Stok Adı" className={th + ' text-left'} />
                <SortTh k="subCategory" label="Ana / Alt Grup" className={th + ' text-left'} />
                <SortTh k="supplier" label="Tedarikçi" className={th + ' text-left'} />
                <SortTh k="saleOpen" label="Satışa Açık" className={th} />
                <SortTh k="stock" label="Stok" className={th + ' text-right'} />
                {/* Termin: yolda olan, stoğa girmemiş miktar. Stoğun hemen sağında duruyor. */}
                <SortTh k="termin" label="Termin" className={th + ' text-right'} />
                <SortTh k="taxRate" label="KDV" className={th} />
                <SortTh k="discountRate" label="İsk." className={th} />
                <SortTh k="purchase" label="Alış" className={th + ' text-right bg-sky-50'} />
                <SortTh k="rate" label="Kur" className={th + ' text-right bg-sky-50'} />
                <SortTh k="purchaseTry" label="Alış ₺" className={th + ' text-right bg-sky-50'} />
                <SortTh k="containerQuantity" label="Ktnr. Adet" className={th + ' text-right bg-sky-50'} />
                <SortTh k="boxQuantity" label="Kutu Adet" className={th + ' text-right bg-sky-50'} />
                <SortTh k="freight" label="Navlun $" className={th + ' bg-sky-50'} />
                <SortTh k="freightPerUnit" label="Adet Başı Navlun" className={th + ' text-right'} />
                <SortTh k="costTry" label="Maliyet ₺" className={th + ' text-right'} />
                <SortTh k="costWithVat" label="Maliyet (KDV Dhl)" className={th + ' text-right'} />
                <SortTh k="price4" label="Mevcut F4" className={th + ' text-right'} />
                <SortTh k="newPrice4" label="YENİ F4" className={th + ' text-right bg-amber-50'} />
                <SortTh k="prevPrice" label="Önceki Fiyat" className={th + ' text-left'} />
                <SortTh k="prevMargin" label="Eski Kâr %" className={th + ' text-right'} />
                <SortTh k="margin" label="Kâr %" className={th + ' text-right'} />
                <SortTh k="newMargin" label="YENİ KÂR%" className={th + ' text-right bg-emerald-50'} />
                <SortTh k="raisePct" label="Zam%" className={th + ' text-right'} />
              </tr>

              {/* Süzgeç satırı — getirilen sayfa üzerinde anında çalışır. */}
              <tr>
                <th className={thFilter}></th>
                <th className={thFilter}></th>
                <th className={thFilter}>
                  <input value={fStok} onChange={(e) => setFStok(e.target.value)} placeholder="Ara..." className={filterInput} />
                </th>
                <th className={thFilter}>
                  <input value={fAd} onChange={(e) => setFAd(e.target.value)} placeholder="Ara..." className={filterInput} />
                </th>
                <th className={thFilter}>
                  <select value={fAltGrup} onChange={(e) => setFAltGrup(e.target.value)} className={filterInput}>
                    <option value="">Tümü</option>
                    {altGrupOptions.map((o) => (<option key={o} value={o}>{o}</option>))}
                  </select>
                </th>
                <th className={thFilter}>
                  <select value={fTedarik} onChange={(e) => setFTedarik(e.target.value)} className={filterInput}>
                    <option value="">Tümü</option>
                    {tedarikOptions.map((o) => (<option key={o} value={o}>{o}</option>))}
                  </select>
                </th>
                <th className={thFilter}>
                  <select value={fSatis} onChange={(e) => setFSatis(e.target.value)} className={filterInput}>
                    <option value="">Tümü</option>
                    <option value="E">E</option>
                    <option value="H">H</option>
                  </select>
                </th>
                <th className={thFilter}></th>
                <th className={thFilter}>
                  <select value={fKdv} onChange={(e) => setFKdv(e.target.value)} className={filterInput}>
                    <option value="">Tümü</option>
                    {kdvOptions.map((o) => (<option key={o} value={o}>%{o}</option>))}
                  </select>
                </th>
                <th className={thFilter}>
                  <select value={fIsk} onChange={(e) => setFIsk(e.target.value)} className={filterInput}>
                    <option value="">Tümü</option>
                    {iskOptions.map((o) => (<option key={o} value={o}>%{o}</option>))}
                  </select>
                </th>
                <th className={thFilter}>
                  <select value={fPara} onChange={(e) => setFPara(e.target.value)} className={filterInput}>
                    <option value="">Tümü</option>
                    {paraOptions.map((o) => (<option key={o} value={o}>{o}</option>))}
                  </select>
                </th>
                <th className={thFilter} colSpan={15}></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={26} className="px-3 py-8 text-center text-xs text-gray-500">
                    Yükleniyor...
                  </td>
                </tr>
              ) : visibleRows.length === 0 ? (
                <tr>
                  <td colSpan={26} className="px-3 py-8 text-center text-xs text-gray-500">
                    Ürün bulunamadı
                  </td>
                </tr>
              ) : (
                visibleRows.map((r) => (
                  <PricingRow
                    key={r.id}
                    r={r}
                    stock={stockOf(r.stockCode)}
                    stockLoading={stockLoading}
                    usdRate={usdRate}
                    effectiveRate={effectiveRate(r.purchaseCurrency)}
                    isRateOverridden={isOverridden(r.purchaseCurrency)}
                    freightOverride={freightOverrides[r.id] ?? ''}
                    priceDraft={priceDrafts[r.id] ?? ''}
                    isSelected={selected.has(r.id)}
                    onToggle={handleToggle}
                    onEdit={handleEdit}
                    onFreightChange={handleFreightChange}
                    onPriceChange={handlePriceChange}
                    onShowStock={handleShowStock}
                    onShowTermin={(kod, ad) => setTerminStok({ kod, ad })}
                  />
                ))
              )
              }
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between px-3 py-2 border-t border-gray-200 bg-gray-50">
          <div className="text-xs text-gray-600">
            {visibleRows.length} / {rows.length} ürün
            {pendingIds.length > 0 && (
              <>
                {' — '}
                <span className="text-amber-700 font-semibold">{pendingIds.length} satır beklemede</span>
                {selectedPending.length > 0 && (
                  <span className="text-emerald-700 font-semibold"> · {selectedPending.length} seçili</span>
                )}
              </>
            )}
          </div>
          <div className="flex items-center gap-3 text-[11px] text-gray-500">
            <span className="flex items-center gap-1">
              <span className="inline-block w-3 h-3 rounded bg-amber-100 border border-amber-300" /> Onay bekliyor
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-3 h-3 rounded bg-emerald-100 border border-emerald-300" /> Onaya seçildi
            </span>
          </div>
        </div>
      </div>

      {/* TERMİN KIRILIMI — hangi alış siparişinde ne kadar bekliyor. */}
      <TerminDetayModal
        acik={!!terminStok}
        onKapat={() => setTerminStok(null)}
        stockCode={terminStok?.kod ?? null}
        stockName={terminStok?.ad ?? null}
        kaynak="bulkPricing"
      />

      {/* DEPO BAZLI STOK — ürün yönetimindeki ile aynı kaynak. */}
      <Modal
        isOpen={stockModalCode !== null}
        onClose={() => setStockModalCode(null)}
        title={`${stockModalCode ?? ''} — Depo Stok Dağılımı`}
        footer={
          <button
            type="button"
            onClick={() => setStockModalCode(null)}
            className="px-4 py-2 text-xs font-semibold bg-red-600 hover:bg-red-700 text-white rounded"
          >
            Kapat
          </button>
        }
      >
        {(() => {
          const st = stockModalCode ? stockOf(stockModalCode) : null
          if (!st || st.balances.length === 0) {
            return <div className="px-3 py-6 text-center text-xs text-gray-500">Hiçbir depoda stok bulunmuyor.</div>
          }
          return (
            <div className="border border-gray-200 rounded-lg overflow-hidden">
              {st.balances.map((b, i) => (
                <div key={`${b.warehouseName}-${i}`} className="flex items-center justify-between px-3 py-2 border-b border-gray-100 last:border-b-0">
                  <span className="text-xs text-gray-800">
                    {b.warehouseName}
                    {!b.isActive && <span className="ml-1.5 text-[10px] font-semibold text-gray-400 uppercase">(pasif)</span>}
                  </span>
                  <span className={'text-xs font-semibold ' + (b.balance < 0 ? 'text-red-600' : 'text-gray-900')}>
                    {b.balance.toLocaleString('tr-TR')}
                  </span>
                </div>
              ))}
              <div className="flex items-center justify-between px-3 py-2 bg-gray-50 border-t border-gray-200">
                <span className="text-xs font-bold text-gray-700">TOPLAM</span>
                <span className={'text-xs font-bold ' + (st.total < 0 ? 'text-red-600' : 'text-gray-900')}>
                  {st.total.toLocaleString('tr-TR')}
                </span>
              </div>
              {/*
                "Kart alanı sapmış" uyarısı KALDIRILDI (2026-09-03).

                Toplam artık `Products.Stock` int önbelleğinden değil, doğrudan stok
                hareketlerinin net toplamından (tüm depolar, pasif dahil) geliyor — bu ekranda
                ve TOPLAM satırında aynı kaynak. Dolayısıyla açıklanacak bir fark yok.
              */}
            </div>
          )
        })()}
      </Modal>

      {/* ÜRÜN DÜZENLEME — yalnızca bu tabloda görünen maliyet alanları. Fiyatlar buradan
          değişmez; onlar YENİ F4 + Onayla akışından, geçmiş kaydıyla birlikte değişir. */}
      <ProductCostModal
        product={rows.find((x) => x.id === editProductId) ?? null}
        onClose={() => setEditProductId(null)}
        onSaved={async () => {
          setEditProductId(null)
          await load()
        }}
      />
    </div>
  )
}

function ProductCostModal({
  product,
  onClose,
  onSaved
}: {
  product: BulkPricingProductDto | null
  onClose: () => void
  onSaved: () => void | Promise<void>
}) {
  const [buy, setBuy] = useState('')
  const [cur, setCur] = useState('3')
  const [ktnr, setKtnr] = useState('')
  const [box, setBox] = useState('')
  const [freight, setFreight] = useState('')
  const [sale, setSale] = useState('E')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!product) return
    setErr(null)
    setBuy(String(product.purchasePrice ?? 0))
    setCur(product.purchaseCurrency === 'USD' ? '3' : product.purchaseCurrency === 'EUR' ? '2' : product.purchaseCurrency === 'GBP' ? '4' : '1')
    setKtnr(String(product.containerQuantity ?? 0))
    setBox(String(product.boxQuantity ?? 0))
    setFreight(String(product.freight ?? 0))
    setSale(product.saleOpen === 'H' ? 'H' : 'E')
  }, [product])

  const save = async () => {
    if (!product) return
    try {
      setBusy(true)
      setErr(null)
      await updateProductCost(product.id, {
        purchasePrice: parseNum(buy) ?? 0,
        currencyCode: Number(cur),
        containerQuantity: Math.trunc(parseNum(ktnr) ?? 0),
        boxQuantity: Math.trunc(parseNum(box) ?? 0),
        freight: parseNum(freight) ?? 0,
        saleOpen: sale
      })
      await onSaved()
    } catch (e: any) {
      setErr(String(e?.message ?? 'Kaydedilemedi'))
    } finally {
      setBusy(false)
    }
  }

  const inp = 'w-full text-xs border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-200'

  return (
    <Modal
      isOpen={product !== null}
      onClose={onClose}
      title={product ? `${product.stockCode} — Ürün Düzenle` : 'Ürün Düzenle'}
      footer={
        <div className="flex items-center gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-xs font-semibold border border-gray-200 text-gray-700 rounded hover:bg-gray-50">
            Vazgeç
          </button>
          <button type="button" onClick={() => void save()} disabled={busy}
            className="px-4 py-2 text-xs font-bold rounded bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-40">
            {busy ? 'Kaydediliyor...' : 'Kaydet'}
          </button>
        </div>
      }
    >
      {product && (
        <div className="space-y-3">
          <div className="text-xs text-gray-500">{product.name}</div>
          {err && <div className="px-3 py-2 text-xs rounded bg-red-50 border border-red-200 text-red-700">{err}</div>}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-gray-600 mb-1">Alış Fiyatı</label>
              <input value={buy} onChange={(e) => setBuy(e.target.value)} className={inp} />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-gray-600 mb-1">Para Birimi</label>
              <select value={cur} onChange={(e) => setCur(e.target.value)} className={inp}>
                <option value="3">USD</option>
                <option value="2">EUR</option>
                <option value="4">GBP</option>
                <option value="1">TL</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-gray-600 mb-1">Konteyner Adedi</label>
              <input value={ktnr} onChange={(e) => setKtnr(e.target.value)} className={inp} />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-gray-600 mb-1">Kutudaki Adet</label>
              <input value={box} onChange={(e) => setBox(e.target.value)} className={inp} />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-gray-600 mb-1">Navlun (USD / konteyner)</label>
              <input value={freight} onChange={(e) => setFreight(e.target.value)} className={inp} />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-gray-600 mb-1">Satışa Açık</label>
              {/* Pasif üründe kilitli: sunucu kaydederken "H"ye zorluyor (bkz. BulkPricingController),
                  ekran "E" gösterirse kullanıcı kaydettikten sonra değerin değiştiğini görür.
                  Aynı kural ürün kartında da uygulanıyor — bkz. utils/productSaleStatus.ts */}
              <select
                value={product.isActive ? sale : 'H'}
                disabled={!product.isActive}
                onChange={(e) => setSale(e.target.value)}
                className={inp + (product.isActive ? '' : ' bg-gray-100 text-gray-500')}
              >
                <option value="E">E — Açık</option>
                <option value="H">H — Kapalı</option>
              </select>
              {!product.isActive && (
                <p className="text-[10px] text-gray-500 mt-1">Pasif ürün her koşulda satışa kapalıdır.</p>
              )}
            </div>
          </div>

          <div className="text-[11px] text-gray-500">
            Burada yalnızca maliyet alanları değişir. Satış fiyatları tablodaki <b>YENİ F4</b> +
            <b> Onayla</b> akışından güncellenir ve geçmişe kaydedilir.
          </div>
        </div>
      )}
    </Modal>
  )
}

const computeRowInternal = (
  r: BulkPricingProductDto,
  usdRate: number,
  effectiveRate: number,
  freightOverride: string,
  priceDraft: string
) => {
  const freight = parseNum(freightOverride) ?? (r.freight > 0 ? r.freight : null)

  let freightPerUnitTry: number | null = null
  if (freight !== null && r.containerQuantity > 0 && usdRate > 0) {
    freightPerUnitTry = (freight / r.containerQuantity) * usdRate
  }

  const pRate = effectiveRate
  const purchaseTry = r.purchasePrice > 0 && pRate > 0 ? r.purchasePrice * pRate : null
  const costTry =
    purchaseTry !== null && purchaseTry > 0 && freightPerUnitTry !== null
      ? purchaseTry + freightPerUnitTry
      : null
  const costWithVat = costTry !== null ? costTry * (1 + r.taxRate / 100) : null

  const newPrice4 = parseNum(priceDraft)
  const hasNew = newPrice4 !== null && newPrice4 > 0
  const next = hasNew ? derivePrices(newPrice4 as number, r.taxRate, r.discountRate) : null

  const marginOf = (p6: number) => (costWithVat && costWithVat > 0 ? (p6 - costWithVat) / costWithVat : null)

  const margin = marginOf(r.price6)

  const prev = (r.priceHistory ?? [])[0]
  const prevMargin = prev
    ? marginOf(derivePrices(prev.oldPrice, r.taxRate, r.discountRate).p6)
    : null
  const newMargin = next ? marginOf(next.p6) : null
  const raisePct = next && r.price6 > 0 ? (next.p6 - r.price6) / r.price6 : null

  return { freightPerUnitTry, purchaseTry, costTry, costWithVat, hasNew, next, margin, prevMargin, newMargin, raisePct }
}

interface PricingRowProps {
  r: BulkPricingProductDto
  stock: { total: number; balances: any[] } | null
  stockLoading: boolean
  usdRate: number
  effectiveRate: number
  isRateOverridden: boolean
  freightOverride: string
  priceDraft: string
  isSelected: boolean
  onToggle: (id: string) => void
  onEdit: (id: string) => void
  onFreightChange: (id: string, val: string) => void
  onPriceChange: (id: string, val: string) => void
  onShowStock: (code: string) => void
  onShowTermin: (code: string, name: string) => void
}

const PricingRow = React.memo(({
  r,
  stock,
  stockLoading,
  usdRate,
  effectiveRate,
  isRateOverridden,
  freightOverride,
  priceDraft,
  isSelected,
  onToggle,
  onEdit,
  onFreightChange,
  onPriceChange,
  onShowStock,
  onShowTermin
}: PricingRowProps) => {
  const c = useMemo(() => {
    return computeRowInternal(r, usdRate, effectiveRate, freightOverride, priceDraft)
  }, [r, usdRate, effectiveRate, freightOverride, priceDraft])

  const isPending = c.hasNew
  const costMissing = c.costWithVat === null
  const h = (r.priceHistory ?? [])[0]

  const td = 'px-2 py-1.5 text-xs text-gray-800 whitespace-nowrap'
  const numInput = 'w-24 text-xs text-right border border-gray-200 rounded px-1.5 py-1 focus:outline-none focus:ring-2 focus:ring-blue-200'

  return (
    <tr
      className={
        'border-b border-gray-100 ' +
        (isPending ? (isSelected ? 'bg-emerald-50' : 'bg-amber-50') : 'hover:bg-gray-50')
      }
    >
      <td className={td}>
        <input
          type="checkbox"
          checked={isSelected}
          disabled={!isPending}
          onChange={() => onToggle(r.id)}
          title={isPending ? 'Onaya al' : 'Önce yeni Fiyat 4 girin'}
        />
      </td>
      <td className={td}>
        <button
          type="button"
          onClick={() => onEdit(r.id)}
          title="Ürünü düzenle"
          className="p-1 rounded text-gray-500 hover:text-gray-900 hover:bg-gray-200"
        >
          <Settings size={14} />
        </button>
      </td>
      <td className={td + ' font-semibold'}>
        {r.stockCode}
        {!r.isActive && (
          <span
            className="ml-1 px-1 py-0.5 rounded bg-gray-200 text-gray-600 text-[10px] font-bold"
            title="Ürün sistemde pasif"
          >
            PASİF
          </span>
        )}
      </td>
      <td className={td + ' max-w-[240px] truncate'} title={r.name}>
        {r.name}
      </td>
      <td className={td + ' max-w-[190px] truncate text-gray-600'} title={grupLabelOf(r) || '-'}>
        {r.mainCategory && r.subCategory
          ? <><span className="text-gray-400">{r.mainCategory}</span> / {r.subCategory}</>
          : (r.subCategory || r.mainCategory || '-')}
      </td>
      <td className={td + ' max-w-[130px] truncate'} title={r.supplierCode ?? ''}>
        {r.supplierName ?? r.supplierCode ?? '-'}
      </td>
      <td className={td + ' text-center'}>
        <span
          className={
            'inline-block px-1.5 py-0.5 rounded text-[11px] font-bold ' +
            (r.saleOpen === 'E'
              ? 'bg-emerald-100 text-emerald-700'
              : 'bg-gray-200 text-gray-600')
          }
          title={r.saleOpen === 'E' ? 'Satışa açık' : 'Satışa kapalı'}
        >
          {r.saleOpen}
        </span>
      </td>
      <td className={td + ' text-right'}>
        {(() => {
          if (stockLoading && !stock) return <span className="text-[11px] text-gray-300">…</span>
          if (!stock) return <span className="text-[11px] text-gray-400">-</span>
          const fark = Number(r.totalStock ?? 0) - stock.total
          return (
            <button
              type="button"
              onClick={() => onShowStock(r.stockCode)}
              title={
                fark !== 0
                  ? `Depolarda görünen: ${stock.total} — ürün kartındaki toplam: ${r.totalStock} (fark ${fark}: pasif/yetkisiz depolar)`
                  : 'Depo bazlı stok dağılımını göster'
              }
              className={
                'font-semibold underline decoration-dotted underline-offset-2 hover:text-blue-700 ' +
                (stock.total > 0 ? 'text-gray-800' : 'text-red-600')
              }
            >
              {stock.total.toLocaleString('tr-TR')}
              {fark !== 0 && <span className="ml-0.5 text-amber-600 font-bold">*</span>}
            </button>
          )
        })()}
      </td>
      <td className={td + ' text-right'}>
        {(() => {
          const trm = Number(r.terminQuantity ?? 0)
          if (trm <= 0) return <span className="text-[11px] text-gray-300">-</span>
          return (
            <button
              type="button"
              onClick={() => onShowTermin(r.stockCode, r.name)}
              title="Hangi alış siparişinde ne kadar bekliyor?"
              className="font-semibold text-amber-600 hover:text-amber-800 underline decoration-dotted underline-offset-2"
            >
              {trm.toLocaleString('tr-TR')}
            </button>
          )
        })()}
      </td>
      <td className={td + ' text-center'}>%{r.taxRate}</td>
      <td className={td + ' text-center'}>%{r.discountRate}</td>

      <td className={td + ' text-right bg-sky-50/50'}>
        {r.purchasePrice > 0 ? `${money(r.purchasePrice)} ${r.purchaseCurrency}` : '-'}
      </td>
      <td
        className={
          td + ' text-right bg-sky-50/50 ' +
          (isRateOverridden ? 'text-blue-700 font-semibold' : 'text-gray-500')
        }
        title={isRateOverridden ? 'Elle girilen kur' : 'Sistem kuru'}
      >
        {effectiveRate > 0 ? money(effectiveRate, 4) : '-'}
      </td>
      <td className={td + ' text-right bg-sky-50/50'}>
        {c.purchaseTry === null ? '-' : `₺${money(c.purchaseTry)}`}
      </td>
      <td className={td + ' text-right bg-sky-50/50'}>
        {r.containerQuantity > 0 ? r.containerQuantity.toLocaleString('tr-TR') : '-'}
      </td>
      <td className={td + ' text-right bg-sky-50/50 text-gray-500'}>
        {r.boxQuantity > 0 ? r.boxQuantity.toLocaleString('tr-TR') : '-'}
      </td>
      <td className={td + ' bg-sky-50/50'}>
        <input
          value={freightOverride}
          onChange={(e) => onFreightChange(r.id, e.target.value)}
          placeholder={r.freight > 0 ? String(r.freight) : '0'}
          title="Ürün kartındaki navlun. Yazarsanız bu satır için geçici olarak ezilir."
          className={numInput + ' w-20'}
        />
      </td>

      <td className={td + ' text-right text-gray-500'}>
        {c.freightPerUnitTry === null ? '-' : `₺${money(c.freightPerUnitTry)}`}
      </td>
      <td className={td + ' text-right text-gray-500'}>
        {c.costTry === null ? '-' : `₺${money(c.costTry)}`}
      </td>
      <td
        className={td + ' text-right font-semibold ' + (costMissing ? 'text-amber-600' : '')}
        title={costMissing ? 'Ürün kartında alış fiyatı / konteyner adedi eksik ya da kur alınamadı' : ''}
      >
        {c.costWithVat === null ? 'eksik' : `₺${money(c.costWithVat)}`}
      </td>

      <td className={td + ' text-right text-gray-500'}>₺{money(r.price4)}</td>

      <td className={td + ' bg-amber-50/60'}>
        <input
          value={priceDraft}
          onChange={(e) => onPriceChange(r.id, e.target.value)}
          placeholder={String(r.price4 || '')}
          className={numInput + ' w-24 font-semibold ' + (isPending ? 'border-amber-400 bg-amber-50' : '')}
        />
      </td>

      <td className={td}>
        {!h ? (
          <span className="text-[11px] text-gray-400">-</span>
        ) : (
          <div className="leading-tight">
            <div className="text-[11px] font-semibold text-gray-800">
              ₺{money(h.oldPrice)}
            </div>
            <div className="text-[10px] text-gray-400">
              {String(h.changedAt).slice(0, 10)}
            </div>
          </div>
        )}
      </td>
      <td className={td + ' text-right text-gray-400'} title="Bir önceki fiyatın kâr oranı">
        {pct(c.prevMargin)}
      </td>
      <td className={td + ' text-right text-gray-700 font-semibold'} title="Mevcut fiyatın kâr oranı">
        {pct(c.margin)}
      </td>
      <td
        className={
          td +
          ' text-right font-bold bg-emerald-50/60 ' +
          (c.newMargin === null ? 'text-gray-400' : c.newMargin < 0 ? 'text-red-600' : 'text-emerald-700')
        }
      >
        {pct(c.newMargin)}
      </td>
      <td
        className={
          td +
          ' text-right ' +
          (c.raisePct === null ? 'text-gray-400' : c.raisePct < 0 ? 'text-red-600' : 'text-gray-700')
        }
      >
        {pct(c.raisePct)}
      </td>
    </tr>
  )
})

