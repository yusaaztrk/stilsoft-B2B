import React, { createContext, useContext, useEffect, useMemo, useState, useCallback, useRef } from 'react'
import { fetchProducts } from '../api/products'
import { API_BASE_URL } from '../config/api'

export type CartProduct = {
  id: string
  stockCode: string
  name: string
  unitPrice: number
  displayUnitPrice?: number | null
  kdvRate: number
  imageUrl?: string | null
  isInstallable?: boolean
  installationFee?: number
  currency?: string | null
}

export type CartDealer = {
  id: string
  label: string
}

export type MontajSnapshot = {
  bayiAdi?: string
  urunAdi?: string
  miktar?: number
  isimSoyisim?: string
  telefon?: string
  adres?: string
  bolge?: string
  bayiAciklama?: string
}

export type CartLine = {
  key: string
  lineageId?: string
  product: CartProduct
  dealer: CartDealer
  montaj: 'Montaj istemiyorum.' | 'Montaj istiyorum.'
  montajDetails?: MontajSnapshot
  qty: number
  note: string
  campaignTitle?: string
  discountAmount?: number
  discountRate?: number
  isGift?: boolean
}

type CartState = {
  lines: CartLine[]
}

export type SyncProductItem = {
  id: string | number
  stockCode?: string | null
  unitPrice?: number | null
  displayUnitPrice?: number | null
  kdvRate?: number | null
  taxRate?: number | null
  currency?: string | null
  stock?: number | null
  bsyVisibleFlag?: string | null
}

// Sepete ekleme sonucu. Para birimi uyuşmazlığında satır EKLENMEZ ve çağıran taraf
// kullanıcıya uyarıyı kendi ekranında gösterir (bkz. AddLineResult kullanımları).
export type AddLineResult =
  | { ok: true }
  | { ok: false; reason: 'CURRENCY_MISMATCH'; cartCurrency: string; productCurrency: string }

type CartContextValue = {
  lines: CartLine[]
  lineCount: number
  cartCurrencyForDealer: (dealerId?: string | null) => string | null
  addLine: (input: {
    product: CartProduct
    dealer: CartDealer
    montaj: CartLine['montaj']
    montajDetails?: MontajSnapshot
    qty: number
    campaignTitle?: string
    discountAmount?: number
    discountRate?: number
    isGift?: boolean
    lineageId?: string
  }) => AddLineResult
  setNote: (key: string, note: string) => void
  updateMontajDetails: (key: string, details: MontajSnapshot) => void
  updateLineMontaj: (key: string, montaj: CartLine['montaj'], details?: MontajSnapshot) => void
  updateQty: (key: string, delta: number) => void
  removeLine: (key: string) => void
  /** Sepeti temizler (veritabanı dahil). `dealerId` verilirse YALNIZ o carinin sepeti. */
  clear: (dealerId?: string | null) => void
  /** Sipariş sonrası: yalnız o carinin satırları yerelden düşer; sunucu sepeti siparişte siler. */
  clearAfterOrder: (dealerId: string) => void
  /** Yalnız BU TARAYICIDAKİ sepeti boşaltır; veritabanındaki sepete dokunmaz (zorla çıkış). */
  resetLocal: () => void
  syncProductPrices: (products: SyncProductItem[], dealerId?: string | null) => void
  refreshCartPrices: (dealerCode?: string | null) => Promise<void>
  loadCustomerBasket: (customerCode: string) => Promise<void>
}

const STORAGE_KEY = 'cart_v1'

const CartContext = createContext<CartContextValue | null>(null)

function safeParse(json: string | null): CartState | null {
  if (!json) return null
  try {
    const parsed = JSON.parse(json)
    if (!parsed || typeof parsed !== 'object') return null
    if (!Array.isArray((parsed as any).lines)) return null
    return { lines: (parsed as any).lines as CartLine[] }
  } catch {
    return null
  }
}

// Sepet TEK PARA BİRİMLİDİR (2026-08-17, kullanıcı kararı): fatura başlığı tek para birimi
// taşıdığı için USD ürünle TL ürün aynı sepette toplanamaz. Ürün eklenirken kapı burada.
export function normalizeCurrencyCode(currency?: string | null): string {
  const c = String(currency ?? '').trim().toUpperCase()
  return c === 'EUR' || c === 'USD' || c === 'GBP' ? c : 'TRY'
}

function cleanDealerCode(code?: string | null): string {
  if (!code) return ''
  const str = String(code).trim()
  const match = str.match(/\[(.*?)\]/)
  if (match && match[1]) return match[1].trim().toUpperCase()
  return str.split(' ')[0].trim().toUpperCase()
}

function buildLinePayload(l: CartLine) {
  return {
    key: l.key,
    product: {
      id: String(l.product?.id ?? ''),
      stockCode: String(l.product?.stockCode ?? ''),
      name: String(l.product?.name ?? ''),
      unitPrice: Number(l.product?.unitPrice ?? 0),
      kdvRate: Number(l.product?.kdvRate ?? 0),
      currency: l.product?.currency ? String(l.product.currency) : null
    },
    dealer: {
      id: String(l.dealer?.id ?? ''),
      label: String(l.dealer?.label ?? '')
    },
    montaj: l.montaj,
    qty: Number(l.qty ?? 0),
    note: String(l.note ?? ''),
    campaignTitle: l.campaignTitle || null,
    discountAmount: Number(l.discountAmount ?? 0),
    discountRate: Number(l.discountRate ?? 0),
    isGift: Boolean(l.isGift),
    /*
      MONTAJ BİLGİSİ SUNUCUYA DA GİDER (2026-10-13, kullanıcı: "sepette montajlı ürünlerin montaj
      bilgileri siliniyor"). Eskiden yalnız bu tarayıcıda tutuluyordu: sepet sunucudan yeniden
      yüklenince, başka bilgisayarda ya da tarayıcı hafızası silinince ad/telefon/adres kayboluyordu.
      null giderse sunucu mevcut kaydı KORUR (form henüz bu cihaza gelmemiş olabilir).
    */
    montajDetails: l.montaj === 'Montaj istiyorum.' ? (l.montajDetails ?? null) : null,
    lineageId: l.lineageId ?? null
  }
}

/*
  AÇILIŞTA SUNUCU ESASTIR (2026-09-27, "hayalet sepet").
  Eskiden yerel kopya doluysa korunuyor, sunucudan yalnız EKSİK satırlar ekleniyordu. Yerel
  kopyada kalmış ama sunucuda artık OLMAYAN satırlar (sepet başka bilgisayardan siparişe
  dönmüş ya da temizlenmiş) 15 saniyelik senkronla veritabanına GERİ yazılıyor, siparişi
  verilmiş sepet aktif sepet raporunda yeniden beliriyordu.

  Artık bu kullanıcının sunucudaki satırları esas. Sunucuda olmayan yerel satır düşer —
  başka kullanıcının eklediği satır da (veritabanında durur; cari seçilince `customer-basket`
  onu yeniden yükler). Yalnız montajlı satır korunur: montaj ayrıntısı yalnız yerelde
  tutuluyor (`loadCustomerBasket` ile aynı kural).
*/
function mergeHydration(prev: CartState, remoteLines: CartLine[]): CartState {
  const remoteKeys = new Set(remoteLines.map((l) => l.key))
  const kalanYereller = prev.lines.filter((l) => !remoteKeys.has(l.key) && l.montaj === 'Montaj istiyorum.')
  const yerelByKey = new Map(prev.lines.map((l) => [l.key, l]))
  const tazelenmis = remoteLines.map((r) => {
    const y = yerelByKey.get(r.key)
    // Yerel kopya varsa o (en son düzenleme), yoksa sunucudaki montaj bilgisi.
    return y
      ? { ...r, montajDetails: y.montajDetails ?? r.montajDetails, lineageId: y.lineageId ?? r.lineageId, product: { ...r.product, imageUrl: r.product.imageUrl || y.product.imageUrl } }
      : r
  })
  return { lines: [...tazelenmis, ...kalanYereller] }
}

async function syncWithBackend(
  cartLines: CartLine[],
  options: { clearExplicitly?: boolean; removedKeys?: string[]; customerCodes?: string[] } = {}
) {
  const token = localStorage.getItem('accessToken')
  if (!token) return

  try {
    const payload = {
      clearExplicitly: options.clearExplicitly ?? false,
      removedKeys: options.removedKeys ?? [],
      /*
        TEMİZLENECEK CARİ KODLARI AÇIKÇA GÖNDERİLİR (2026-08-24, kullanıcı bildirimi:
        "plasiyerde sepeti temizliyorum, sayfayı yenileyince geri geliyor").

        Temizlemede `lines` BOŞ gidiyor — doğal, sepet boşaltılıyor. Sunucu bu yüzden hangi
        carinin sepetini sileceğini kullanıcının `Carikodu` alanından tahmin ediyordu. O alan
        tek bir kod DEĞİL: plasiyerde virgüllü liste, yetkili kullanıcıda '*' ya da boş.
        Düz eşitlik hiçbir satırla tutmuyor, silme sessizce 0 satır etkiliyor ve sepet
        sunucuda duruyordu; ekran boşalıyor, yenileyince geri geliyordu.

        Artık hangi carinin sepeti temizleniyorsa kodu burada gidiyor.
      */
      customerCodes: options.customerCodes ?? [],
      lines: cartLines.map(buildLinePayload)
    }
    await fetch(`${API_BASE_URL}/api/baskets/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(payload)
    })
  } catch {
    // ignore
  }
}

function mapDbItemToCartLine(item: any): CartLine {
  return {
    key: String(item.key || `${item.customerCode}::${item.productId}::${item.montaj}`),
    product: {
      id: String(item.productId ?? ''),
      stockCode: String(item.stockCode ?? ''),
      name: String(item.productName ?? ''),
      unitPrice: Number(item.unitPrice ?? 0),
      kdvRate: Number(item.vatRate ?? 0),
      currency: item.currency || null,
      imageUrl: item.imageUrl || item.product?.imageUrl || null,
      isInstallable: item.isInstallable ?? item.product?.isInstallable,
      installationFee: item.installationFee ?? item.product?.installationFee,
    },
    dealer: {
      /*
        CARİ KODU ANAHTARDAN OKUNUR — SATIRIN `customerCode` ALANINDAN DEĞİL (2026-08-26).

        (Kullanıcı: "şubelerin sepeti çalışmıyor, şube seçince sepet boş geliyor".)

        Sepet satırının anahtarı ürün eklenirken `${dealer.id}::${product.id}::${montaj}`
        diye kuruluyor, yani SEÇİLİ CARİYİ (şubeyi) taşıyor. Burada ise `dealer.id`
        satırın `customerCode` alanından okunuyordu.

        Bu, KENDİ KENDİNİ BESLEYEN bir döngü yaratıyordu: satır bir kez ana cari koduyla
        yazıldığında, sepet her yüklenişinde `dealer.id` ana cari oluyor, bir sonraki
        `sync` de onu tekrar ana cari olarak yazıyordu. Şube kodu yalnızca anahtarın
        içinde hayatta kalıyor, sepet hiçbir şubede görünmüyordu.

        Doğru kaynak anahtarın ilk parçası: satır hangi cari seçiliyken eklendiyse o.
        Anahtar eski/bozuk biçimdeyse eski davranışa düşülür.
      */
      id: (() => {
        const k = String(item.key ?? '')
        const first = k.includes('::') ? k.split('::')[0].trim() : ''
        return first || String(item.customerCode ?? '')
      })(),
      label: String(item.customerName || item.customerCode)
    },
    montaj: item.montaj || 'Montaj istemiyorum.',
    // Sunucuda saklanan montaj formu (2026-10-13).
    montajDetails: item.montajDetails ?? undefined,
    lineageId: item.lineageId ?? undefined,
    qty: Number(item.quantity ?? 1),
    note: String(item.note ?? ''),
    campaignTitle: item.campaignTitle || undefined,
    discountAmount: Number(item.discountAmount ?? 0),
    discountRate: Number(item.discountRate ?? 0),
    isGift: Boolean(item.isGift)
  }
}

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<CartState>(() => safeParse(localStorage.getItem(STORAGE_KEY)) ?? { lines: [] })
  const isHydratedRef = useRef(false)
  // Track keys removed by user so we can tell backend to delete them
  const pendingRemovedKeysRef = useRef<Set<string>>(new Set())
  const suppressedRemoteKeysRef = useRef<Set<string>>(new Set())
  /*
    BEKLEYEN TEMİZLEME İSTEĞİ (2026-09-27). Eskiden burada "tek seferlik kilit" vardı: temizlenen
    carilerin kodu bir listeye yazılıyor, o carinin SONRAKİ İLK yüklemesi yutuluyordu. Sipariş
    sonrası temizlik sepetteki BÜTÜN carileri listeye yazdığı için, sonra seçilen başka bir şubenin
    sepeti "ilk seferde gelmiyor, başka sayfaya gidip dönünce geliyordu" (kullanıcı bildirimi).
    Amaç yalnız yarışı önlemekti (silme bitmeden okunan satırlar geri gelmesin); artık yükleme,
    varsa bekleyen temizleme isteğinin bitmesini BEKLİYOR ve hiçbir yükleme yutulmuyor.
  */
  const pendingClearRef = useRef<Promise<void> | null>(null)
  const linesRef = useRef(state.lines)

  useEffect(() => {
    linesRef.current = state.lines
  }, [state.lines])

  // Save to localStorage on state change
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  }, [state])

  /**
   * SEKMELER ARASI SEPET EŞİTLEME (denetim md. 241).
   *
   * Sepet `localStorage`'a yazılıyordu ama başka bir sekmedeki değişiklik dinlenmiyordu:
   * bir sekmede sepeti boşaltan bayi, açık kalan diğer sekmede ESKİ sepeti onaylayıp
   * istemediği ürünlerin siparişini geçebiliyordu.
   *
   * `storage` olayı yalnız DİĞER sekmelerde tetiklenir (kendi yazdığımızda tetiklenmez),
   * dolayısıyla döngü riski yok.
   */
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return
      const next = safeParse(e.newValue) ?? { lines: [] }
      setState(next)
    }

    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  // Sync to backend on state change ONLY after initial hydration
  useEffect(() => {
    if (!isHydratedRef.current) return

    // Read & clear removedKeys INSIDE the timer so rapid deletions accumulate
    const timer = setTimeout(() => {
      const removedKeys = Array.from(pendingRemovedKeysRef.current)
      pendingRemovedKeysRef.current.clear()
      void syncWithBackend(state.lines, { removedKeys })
    }, 500)
    return () => clearTimeout(timer)
  }, [state])

  // Periodic heartbeat sync every 15 seconds to guarantee persistence
  useEffect(() => {
    const interval = setInterval(() => {
      if (isHydratedRef.current && state.lines.length > 0) {
        void syncWithBackend(state.lines)
      }
    }, 15000)
    return () => clearInterval(interval)
  }, [state.lines])

  // Initial hydration from remote database
  useEffect(() => {
    const token = localStorage.getItem('accessToken')
    if (!token) {
      isHydratedRef.current = true
      return
    }
    void (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/baskets/my-basket`, {
          headers: { Authorization: `Bearer ${token}` }
        })
        if (res.ok) {
          const json = await res.json()
          if (json?.data && Array.isArray(json.data)) {
            const remoteLines: CartLine[] = json.data.map(mapDbItemToCartLine)
            setState((prev) => mergeHydration(prev, remoteLines))
          }
        }
      } catch {
        // ignore
      } finally {
        isHydratedRef.current = true
      }
    })()
  }, [])

  const loadCustomerBasket = useCallback(async (customerCode: string) => {
    if (!customerCode) return
    const cleanCustomerCode = String(customerCode).trim()
    /*
      TEMİZLEME KİLİDİ ARTIK TEK SEFERLİK (2026-08-26, kullanıcı: "sepet boş geliyor ama
      Sepeti Temizle deyince aktif sepet raporundan siliniyor").

      Bu kara listenin amacı dar: sepet temizlendikten hemen sonra araya giren bir yükleme,
      silinen satırları geri getirmesin. Ama kayıt listeden YALNIZCA `addLine` içinde
      siliniyordu (satır 565) ve orada kullanılan kod ile buraya gelen kod farklı olabiliyor
      (biri ana cari, diğeri şube). Kodlar tutmayınca kayıt listede KALICI olarak kalıyor ve
      o cari için sepet bir daha HİÇ yüklenmiyordu: satırlar veritabanında duruyor, rapor
      gösteriyor, sipariş oluşturunca faturaya gidiyor — ama ekranda sepet boş.

      Artık kilit bir kez iş görüp kendini siliyor: hemen ardından gelen yükleme bastırılır,
      sonraki yüklemeler normal çalışır. Yarış korunuyor, kalıcı kilitlenme kalkıyor.
    */
    if (pendingClearRef.current) {
      try { await pendingClearRef.current } catch { /* yoksay */ }
    }
    const token = localStorage.getItem('accessToken')
    if (!token) return
    try {
      const res = await fetch(`${API_BASE_URL}/api/baskets/customer-basket?customerCode=${encodeURIComponent(customerCode)}`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (res.ok) {
        const json = await res.json()
        if (json?.data && Array.isArray(json.data)) {
          setState((prev) => {
            // Build lookup of existing local lines by key to preserve imageUrl etc.
            const existingByKey = new Map(prev.lines.map((l) => [l.key, l]))

            const suppressedKeys = suppressedRemoteKeysRef.current
            const remoteLines: CartLine[] = json.data
              .filter((item: any) => {
                const key = String(item.key || `${item.customerCode}::${item.productId}::${item.montaj}`)
                return !suppressedKeys.has(key)
              })
              .map((item: any) => {
              const key = String(item.key || `${item.customerCode}::${item.productId}::${item.montaj}`)
              const existing = existingByKey.get(key)
              return {
                key,
                product: {
                  id: String(item.productId ?? ''),
                  stockCode: String(item.stockCode ?? ''),
                  name: String(item.productName ?? ''),
                  unitPrice: Number(item.unitPrice ?? 0),
                  kdvRate: Number(item.vatRate ?? 0),
                  currency: item.currency || null,
                  imageUrl: item.imageUrl || item.product?.imageUrl || existing?.product?.imageUrl || null,
                  isInstallable: item.isInstallable ?? item.product?.isInstallable ?? existing?.product?.isInstallable,
                  installationFee: item.installationFee ?? item.product?.installationFee ?? existing?.product?.installationFee,
                },
                dealer: {
                  id: String(item.customerCode ?? ''),
                  label: String(item.customerName || item.customerCode)
                },
                montaj: item.montaj || 'Montaj istemiyorum.',
                // Montaj bilgisi: önce yerel kopya (en son düzenleme), yoksa SUNUCUDAKİ kayıt
                // (2026-10-13'ten beri sunucuda da saklanıyor). Eskiden yalnız yerel kopyaya
                // bakılıyordu; başka cihazda/temizlenmiş tarayıcıda montaj bilgileri boş geliyordu.
                montajDetails: existing?.montajDetails ?? item.montajDetails ?? undefined,
                lineageId: existing?.lineageId ?? item.lineageId ?? undefined,
                qty: Number(item.quantity ?? 1),
                note: String(item.note ?? ''),
                campaignTitle: item.campaignTitle || undefined,
                discountAmount: Number(item.discountAmount ?? 0),
                discountRate: Number(item.discountRate ?? 0),
                isGift: Boolean(item.isGift)
              }
            })

            const otherLines = prev.lines.filter((l) => l.dealer?.id !== customerCode)

            // Montajlı satırın yerel anahtarı `...::Montaj istiyorum.::{lineageId}` biçiminde;
            // sunucu anahtarı lineageId TAŞIMIYOR. Eşleşme tutmadığı için bu satırlar
            // remoteLines'ta karşılıksız kalıyor ve aşağıdaki değiştirme onları SİLİYORDU —
            // kullanıcı sepete montajlı ürün ekliyor, senkron sonrası ürün kayboluyordu.
            // Sunucunun bilmediği montajlı satırlar korunur.
            const remoteKeys = new Set(remoteLines.map((l) => l.key))
            const korunanMontajlilar = prev.lines.filter(
              (l) => l.dealer?.id === customerCode
                && l.montaj === 'Montaj istiyorum.'
                && !remoteKeys.has(l.key)
            )

            return { lines: [...otherLines, ...remoteLines, ...korunanMontajlilar] }
          })
        }
      }
    } catch {
      // ignore
    }
  }, [])


  const syncProductPrices = useCallback((products: SyncProductItem[], dealerId?: string | null) => {
    if (!products || products.length === 0) return

    const mapByPid = new Map<string, { unitPrice: number; displayUnitPrice?: number | null; kdvRate: number; currency: string }>()
    const mapByCode = new Map<string, { unitPrice: number; displayUnitPrice?: number | null; kdvRate: number; currency: string }>()

    for (const p of products) {
      if (!p) continue
      const pid = String(p.id ?? '').trim()
      const pcode = String(p.stockCode ?? '').trim().toUpperCase()
      const price = p.unitPrice !== null && p.unitPrice !== undefined ? Number(p.unitPrice) : null
      const displayPrice = p.displayUnitPrice !== null && p.displayUnitPrice !== undefined ? Number(p.displayUnitPrice) : null
      const kdv = Number(p.kdvRate ?? p.taxRate ?? 0)
      const curr = String(p.currency ?? '').trim().toUpperCase()

      if (price !== null && Number.isFinite(price) && price >= 0) {
        const itemData = { unitPrice: price, displayUnitPrice: displayPrice, kdvRate: kdv, currency: curr }
        if (pid) mapByPid.set(pid, itemData)
        if (pcode) mapByCode.set(pcode, itemData)
      }
    }

    setState((prev) => {
      let changed = false
      const nextLines = prev.lines.map((line) => {
        const paramDealerClean = cleanDealerCode(dealerId)
        const lineDealerClean = cleanDealerCode(line.dealer?.id)

        if (paramDealerClean && lineDealerClean && lineDealerClean !== paramDealerClean) {
          return line
        }

        const match = mapByPid.get(String(line.product.id)) || mapByCode.get(String(line.product.stockCode ?? '').trim().toUpperCase())
        if (!match) return line

        const newPrice = match.unitPrice
        const newDisplayPrice = match.displayUnitPrice !== undefined ? match.displayUnitPrice : line.product.displayUnitPrice
        const newKdv = match.kdvRate !== undefined ? match.kdvRate : line.product.kdvRate
        const newCurrency = match.currency || line.product.currency

        const priceDiff = Math.abs((line.product.unitPrice ?? 0) - newPrice) > 0.001
        const displayPriceDiff = Math.abs((line.product.displayUnitPrice ?? 0) - (newDisplayPrice ?? 0)) > 0.001
        const kdvDiff = Math.abs((line.product.kdvRate ?? 0) - newKdv) > 0.01
        const currDiff = line.product.currency !== newCurrency

        if (priceDiff || displayPriceDiff || kdvDiff || currDiff) {
          changed = true
          return {
            ...line,
            product: {
              ...line.product,
              unitPrice: newPrice,
              displayUnitPrice: newDisplayPrice,
              kdvRate: newKdv,
              currency: newCurrency
            }
          }
        }

        return line
      })

      return changed ? { ...prev, lines: nextLines } : prev
    })
  }, [])

  const refreshCartPrices = useCallback(async (dealerCode?: string | null) => {
    const currentLines = linesRef.current;
    if (currentLines.length === 0) return
    const productIds = Array.from(new Set(currentLines.map((l) => l.product?.id).filter(Boolean))).map(String)
    if (productIds.length === 0) return

    try {
      const res = await fetchProducts({
        ids: productIds.join(','),
        includeDealer: Boolean(dealerCode),
        dealerCode: dealerCode || undefined,
        pageSize: 100
      })
      if (res?.items && res.items.length > 0) {
        syncProductPrices(res.items, dealerCode)
      }
    } catch (err) {
      console.warn('Failed to refresh cart product prices:', err)
    }
  }, [syncProductPrices])

  useEffect(() => {
    if (state.lines.length > 0) {
      const firstDealer = state.lines[0]?.dealer?.id
      void refreshCartPrices(firstDealer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const generateGuid = () => {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID()
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = (Math.random() * 16) | 0
      const v = c === 'x' ? r : (r & 0x3) | 0x8
      return v.toString(16)
    })
  }

  // Sepetin para birimi BAYİ BAZINDA yürür: sepet aynı anda birden çok bayinin satırını
  // tutabiliyor (her ekran kendi bayisinin satırlarını gösteriyor), o yüzden kilit de
  // bayiye göre. Bayinin hiç satırı yoksa null = "her para birimi serbest".
  const cartCurrencyForDealer = useCallback(
    (dealerId?: string | null): string | null => {
      const target = String(dealerId ?? '').trim()
      if (!target) return null
      const firstReal = state.lines.find(
        (l) => !l.isGift && String(l.dealer?.id ?? '').trim() === target
      )
      return firstReal ? normalizeCurrencyCode(firstReal.product?.currency) : null
    },
    [state.lines]
  )

  const value = useMemo<CartContextValue>(() => {
    const addLine: CartContextValue['addLine'] = ({ product, dealer, montaj, montajDetails, qty, campaignTitle, discountAmount, discountRate, isGift, lineageId }) => {
      // Para birimi kapısı: bayinin sepetinde USD ürün varken TL ürün eklenemez (ve tersi).
      // Ekranlar bunu zaten kendi uyarı kutusuyla engelliyor; burası son emniyet kapısı,
      // yeni bir ekran eklendiğinde karışık sepet sessizce oluşmasın diye.
      // Hediye satırları kampanyanın kendi ürününü taşıdığı için kapıdan muaftır.
      const incomingCurrency = normalizeCurrencyCode(product?.currency)
      const dealerCurrency = cartCurrencyForDealer(dealer?.id)
      if (!isGift && dealerCurrency && incomingCurrency !== dealerCurrency) {
        return {
          ok: false,
          reason: 'CURRENCY_MISMATCH',
          cartCurrency: dealerCurrency,
          productCurrency: incomingCurrency
        }
      }

      const q = Math.max(1, Number(qty || 1))
      const isMontaj = montaj === 'Montaj istiyorum.'
      const lid = lineageId || (isMontaj ? generateGuid() : undefined)
      const key = isMontaj
        ? `${dealer.id}::${product.id}::Montaj istiyorum.::${lid}`
        : `${dealer.id}::${product.id}::Montaj istemiyorum.`

      suppressedRemoteKeysRef.current.delete(key)
      setState((prev) => {
        const idx = prev.lines.findIndex((l) => l.key === key)
        if (idx === -1 || isMontaj) {
          // Montajlı items NEVER merge (always distinct cart line with unique key)
          return {
            ...prev,
            lines: [...prev.lines, { key, lineageId: lid, product, dealer, montaj, montajDetails, qty: q, note: '', campaignTitle, discountAmount, discountRate, isGift }]
          }
        }

        // Montajsız items MERGE as before!
        const next = [...prev.lines]
        next[idx] = { ...next[idx], qty: next[idx].qty + q, campaignTitle: campaignTitle || next[idx].campaignTitle, discountAmount, discountRate, isGift }
        return { ...prev, lines: next }
      })

      return { ok: true }
    }

    const setNote: CartContextValue['setNote'] = (key, note) => {
      setState((prev) => ({
        ...prev,
        lines: prev.lines.map((l) => (l.key === key ? { ...l, note } : l))
      }))
    }

    const updateMontajDetails: CartContextValue['updateMontajDetails'] = (key, details) => {
      setState((prev) => ({
        ...prev,
        lines: prev.lines.map((l) => (l.key === key ? { ...l, montajDetails: details } : l))
      }))
    }

    const updateQty: CartContextValue['updateQty'] = (key, delta) => {
      setState((prev) => {
        const next = prev.lines
          .map((l) => (l.key === key ? { ...l, qty: Math.max(0, l.qty + delta) } : l))
          .filter((l) => {
            if (l.qty === 0) {
              // Track this key as removed so backend can delete it
              pendingRemovedKeysRef.current.add(l.key)
              suppressedRemoteKeysRef.current.add(l.key)
            }
            return l.qty > 0
          })
        return { ...prev, lines: next }
      })
    }

    const removeLine: CartContextValue['removeLine'] = (key) => {
      // Track removed key so backend deletes it
      pendingRemovedKeysRef.current.add(key)
      suppressedRemoteKeysRef.current.add(key)
      setState((prev) => ({ ...prev, lines: prev.lines.filter((l) => l.key !== key) }))
    }

    /*
      TEMİZLİK YALNIZ İLGİLİ CARİYE UYGULANIR (2026-09-27, "her şubenin sepeti ayrı").
      `clear()` eskiden yerel sepetteki BÜTÜN carileri temizleyip sunucuya da hepsini
      bildiriyordu: bir şubenin siparişi ya da "Sepeti Temizle", o an görünmeyen diğer
      şubelerin sepetlerini veritabanından da siliyordu.
    */
    const hedefSatirlar = (dealerId?: string | null) => {
      const hedef = String(dealerId ?? '').trim()
      return linesRef.current.filter((l) => !hedef || String(l.dealer?.id ?? '').trim() === hedef)
    }

    const yereldenDusur = (dusenler: CartLine[]) => {
      const keys = new Set(dusenler.map((l) => l.key))
      for (const k of keys) if (k) suppressedRemoteKeysRef.current.add(k)
      setState((prev) => ({ ...prev, lines: prev.lines.filter((l) => !keys.has(l.key)) }))
    }

    const clear: CartContextValue['clear'] = (dealerId) => {
      const dusenler = hedefSatirlar(dealerId)
      const kodlar = new Set<string>()
      for (const l of dusenler) {
        const d = String(l.dealer?.id ?? '').trim()
        if (d) kodlar.add(d)
      }
      const hedef = String(dealerId ?? '').trim()
      if (hedef) kodlar.add(hedef)
      yereldenDusur(dusenler)
      // Temizlenen carilerin kodu sunucuya BILDIRILIR; sunucu tahmin etmek zorunda kalmasin.
      if (kodlar.size > 0) {
        const p = syncWithBackend([], { clearExplicitly: true, customerCodes: Array.from(kodlar) })
        pendingClearRef.current = p
        void p.finally(() => { if (pendingClearRef.current === p) pendingClearRef.current = null })
      }
    }

    // Sipariş sunucuda o carinin sepetini ZATEN siliyor (SalesOrdersController.Confirm);
    // burada yalnız yerel satırlar düşer, ikinci bir silme isteği gönderilmez.
    const clearAfterOrder: CartContextValue['clearAfterOrder'] = (dealerId) => {
      yereldenDusur(hedefSatirlar(dealerId))
    }

    /*
      ZORLA ÇIKIŞ VERİTABANI SEPETİNE DOKUNMAZ (2026-09-27, kullanıcı onayı). Oturum süresi
      dolunca `forceLogin` `clear()` çağırıyor, sepet veritabanından SİLİNİYORDU ("bir saat
      sonra geldim, sepet gitmişti"). Elle çıkışta bu zaten yapılmıyordu (AppLayout notu).
      Yalnız bu tarayıcıdaki kopya boşalır; tekrar girilip cari seçilince sepet geri gelir.
    */
    const resetLocal: CartContextValue['resetLocal'] = () => {
      pendingRemovedKeysRef.current.clear()
      setState({ lines: [] })
    }

    const updateLineMontaj: CartContextValue['updateLineMontaj'] = (key, montaj, details) => {
      setState((prev) => {
        const target = prev.lines.find((l) => l.key === key)
        if (!target) return prev

        if (montaj === 'Montaj istiyorum.') {
          const nextLines = prev.lines.map((l) => {
            if (l.key === key) {
              return {
                ...l,
                montaj: 'Montaj istiyorum.' as const,
                montajDetails: details || l.montajDetails
              }
            }
            return l
          })
          return { ...prev, lines: nextLines }
        } else {
          const targetDealerId = target.dealer.id
          const targetProductId = target.product.id

          const existingNonMontajIdx = prev.lines.findIndex(
            (l) => l.key !== key && l.dealer.id === targetDealerId && l.product.id === targetProductId && l.montaj === 'Montaj istemiyorum.'
          )

          if (existingNonMontajIdx !== -1) {
            pendingRemovedKeysRef.current.add(key)
            const nextLines = prev.lines
              .filter((l) => l.key !== key)
              .map((l, idx) => {
                if (idx === existingNonMontajIdx) {
                  return { ...l, qty: l.qty + target.qty }
                }
                return l
              })
            return { ...prev, lines: nextLines }
          } else {
            const nonMontajKey = `${targetDealerId}::${targetProductId}::Montaj istemiyorum.`
            if (key !== nonMontajKey) {
              pendingRemovedKeysRef.current.add(key)
            }
            const nextLines = prev.lines.map((l) => {
              if (l.key === key) {
                return {
                  ...l,
                  key: nonMontajKey,
                  montaj: 'Montaj istemiyorum.' as const,
                  montajDetails: undefined
                }
              }
              return l
            })
            return { ...prev, lines: nextLines }
          }
        }
      })
    }

    return {
      lines: state.lines,
      lineCount: state.lines.length,
      cartCurrencyForDealer,
      addLine,
      setNote,
      updateMontajDetails,
      updateLineMontaj,
      updateQty,
      removeLine,
      clear,
      clearAfterOrder,
      resetLocal,
      syncProductPrices,
      refreshCartPrices,
      loadCustomerBasket
    }
  }, [state.lines, cartCurrencyForDealer, syncProductPrices, refreshCartPrices, loadCustomerBasket])

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>
}

export function useCart() {
  const ctx = useContext(CartContext)
  if (!ctx) throw new Error('useCart must be used within CartProvider')
  return ctx
}
