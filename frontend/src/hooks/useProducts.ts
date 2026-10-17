import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { fetchProducts } from '../api/products'
import type { Product } from '../types/Product'

function parsePositiveInt(value: string | null | undefined, fallback: number) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  const i = Math.floor(n)
  return i >= 1 ? i : fallback
}

function useDebouncedValue<T>(value: T, delayMs: number) {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(t)
  }, [delayMs, value])

  return debounced
}

export type UseProductsOptions = {
  includeDealer?: boolean
  dealerCode?: string
  priceCustomerCode?: string
  displayPriceGroupCode?: number
  defaultIncludeInactive?: boolean
  defaultPageSize?: number
  useUrlParams?: boolean
  currencyCode?: number
  enabled?: boolean
  /**
   * true ise sunucu süzgecinin sonucu SAYFA SAYFA tamamen çekilir ve tek listede toplanır.
   * Sayfalama/süzme/sıralamayı istemcide yapan ekranlar için — bkz. fetch içindeki not.
   */
  fetchAllPages?: boolean
}

function cleanCategoryParam(val: string | null | undefined): string | undefined {
  if (!val) return undefined
  const s = String(val).trim().toUpperCase()
    .replace(/İ/g, 'I')
    .replace(/ı/g, 'I')
    .replace(/Ğ/g, 'G')
    .replace(/ğ/g, 'G')
    .replace(/Ü/g, 'U')
    .replace(/ü/g, 'U')
    .replace(/Ş/g, 'S')
    .replace(/ş/g, 'S')
    .replace(/Ö/g, 'O')
    .replace(/ö/g, 'O')
    .replace(/Ç/g, 'C')
    .replace(/ç/g, 'C')
    .replace(/_/g, ' ')
  if (s === '' || s === 'TUM URUNLER' || s === 'TUM URUNLERI' || s === 'ALL' || s === 'ALL PRODUCTS' || s === 'TUM_URUNLER') {
    return undefined
  }
  return val.trim()
}

export function useProducts(options?: UseProductsOptions) {
  const useUrl = options?.useUrlParams ?? true

  const [searchParams, setSearchParams] = useSearchParams()

  const [localMain, setLocalMain] = useState('')
  const [localSub, setLocalSub] = useState('')
  const [localQ, setLocalQ] = useState('')
  const [localPage, setLocalPage] = useState(1)
  const [localPageSize, setLocalPageSize] = useState(options?.defaultPageSize ?? 100)
  const [localIncludeInactive, setLocalIncludeInactive] = useState(Boolean(options?.defaultIncludeInactive))

  const main = useUrl ? String(searchParams.get('main') ?? searchParams.get('ust') ?? '').trim() : localMain
  const sub = useUrl ? String(searchParams.get('sub') ?? searchParams.get('alt') ?? '').trim() : localSub
  const q = useUrl ? String(searchParams.get('q') ?? '').trim() : localQ
  const hasIncludeInactive = useUrl ? searchParams.has('includeInactive') : true
  const includeInactiveRaw = useUrl ? String(searchParams.get('includeInactive') ?? '').trim().toLowerCase() : ''
  const includeInactiveFromQuery = includeInactiveRaw === '1' || includeInactiveRaw === 'true'
  const includeInactive = useUrl 
    ? (hasIncludeInactive ? includeInactiveFromQuery : Boolean(options?.defaultIncludeInactive)) 
    : localIncludeInactive
  const page = useUrl ? parsePositiveInt(searchParams.get('page'), 1) : localPage
  const pageSize = useUrl ? Math.min(200, parsePositiveInt(searchParams.get('pageSize'), options?.defaultPageSize ?? 100)) : localPageSize

  const qDebounced = useDebouncedValue(q, 400)

  const [items, setItems] = useState<Product[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refreshTick, setRefreshTick] = useState(0)

  const setMainSub = (nextMain: string, nextSub: string, clearQ?: boolean) => {
    if (useUrl) {
      setSearchParams((prev) => {
        const p = new URLSearchParams(prev)
        p.set('main', nextMain)
        p.set('sub', nextSub)
        p.delete('ust')
        p.delete('alt')
        if (clearQ) p.delete('q')
        p.set('page', '1')
        return p
      })
    } else {
      setLocalMain(nextMain)
      setLocalSub(nextSub)
      if (clearQ) setLocalQ('')
      setLocalPage(1)
    }
  }

  const setQ = (next: string) => {
    if (useUrl) {
      setSearchParams((prev) => {
        const p = new URLSearchParams(prev)
        if (next.trim()) p.set('q', next)
        else p.delete('q')
        p.set('page', '1')
        return p
      })
    } else {
      setLocalQ(next)
      setLocalPage(1)
    }
  }

  const setPage = (nextPage: number) => {
    if (useUrl) {
      setSearchParams((prev) => {
        const p = new URLSearchParams(prev)
        p.set('page', String(Math.max(1, nextPage)))
        return p
      })
    } else {
      setLocalPage(Math.max(1, nextPage))
    }
  }

  const setPageSize = (nextPageSize: number) => {
    if (useUrl) {
      setSearchParams((prev) => {
        const p = new URLSearchParams(prev)
        const safe = Math.min(200, Math.max(1, Math.floor(Number(nextPageSize) || 20)))
        p.set('pageSize', String(safe))
        p.set('page', '1')
        return p
      })
    } else {
      setLocalPageSize(Math.min(200, Math.max(1, Math.floor(Number(nextPageSize) || 20))))
      setLocalPage(1)
    }
  }

  const setIncludeInactive = (next: boolean) => {
    if (useUrl) {
      setSearchParams((prev) => {
        const p = new URLSearchParams(prev)
        if (next) p.set('includeInactive', 'true')
        else p.delete('includeInactive')
        p.set('page', '1')
        return p
      })
    } else {
      setLocalIncludeInactive(next)
      setLocalPage(1)
    }
  }

  const refetch = () => setRefreshTick((x) => x + 1)

  useEffect(() => {
    if (options?.enabled === false) {
      return
    }

    if (options?.includeDealer && !options?.dealerCode) {
      setItems([])
      setTotal(0)
      setLoading(false)
      return
    }

    const ac = new AbortController()

    void (async () => {
      try {
        setLoading(true)
        setError(null)
        const requestParams = {
          main: qDebounced ? undefined : cleanCategoryParam(main),
          sub: qDebounced ? undefined : cleanCategoryParam(sub),
          q: qDebounced || undefined,
          page,
          pageSize,
          includeInactive,
          includeDealer: Boolean(options?.includeDealer),
          dealerCode: options?.dealerCode,
          priceCustomerCode: options?.priceCustomerCode,
          displayPriceGroupCode: options?.displayPriceGroupCode,
          currencyCode: options?.currencyCode
        }

        /**
         * `fetchAllPages` — SUNUCU SÜZGECİNİN TAMAMINI YÜKLE (2026-08-22).
         *
         * Ürün Yönetimi gibi ekranlarda tablo sütun süzgeçleri ve sıralama İSTEMCİDE
         * çalışıyor; sunucudan tek sayfa (100 satır) gelince bu süzgeçler yalnızca o
         * pencereyi tarıyor ve kullanıcıya "bozuk" görünüyordu — aradığı ürün 3. sayfada
         * olduğu halde "bulunamadı" diyordu.
         *
         * Bu bayrakla, sunucunun uyguladığı süzgecin (kategori + arama) SONUCUNUN TAMAMI
         * sayfa sayfa çekilir; sayfalama da süzme de istemcide, tam küme üzerinde yapılır.
         * Kategori ya da arama seçiliyken küme zaten küçüktür; hiç süzgeç yokken tüm ürün
         * listesi gelir ve bu ekran için doğrusu budur.
         *
         * Bayrağı GÖNDERMEYEN her çağıran eskisi gibi tek sayfa alır.
         */
        let res = await fetchProducts(requestParams, { signal: ac.signal })

        if (options?.fetchAllPages) {
          const collected = [...(res.items ?? [])]
          const totalCount = Number(res.total ?? 0)
          let nextPage = Number(page) + 1
          // Güvenlik sayacı: uç bozuk `total` döndürse bile döngü sonsuza gitmez.
          for (let guard = 0; guard < 100; guard++) {
            if ((res.items?.length ?? 0) < Number(pageSize)) break
            if (totalCount > 0 && collected.length >= totalCount) break
            res = await fetchProducts({ ...requestParams, page: nextPage }, { signal: ac.signal })
            if (ac.signal.aborted) return
            collected.push(...(res.items ?? []))
            nextPage += 1
          }
          if (ac.signal.aborted) return
          setItems(collected)
          setTotal(totalCount > 0 ? totalCount : collected.length)
          setLoading(false)
          return
        }

        if (ac.signal.aborted) return
        setItems(res.items)
        setTotal(res.total)
      } catch (e: any) {
        if (e?.name === 'AbortError') return
        const msg = String(e?.message ?? 'Ürünler alınamadı')

        setError(msg)
        setItems([])
        setTotal(0)
      } finally {
        if (!ac.signal.aborted) setLoading(false)
      }
    })()

    return () => {
      ac.abort()
    }

  }, [options?.enabled, includeInactive, main, options?.dealerCode, options?.displayPriceGroupCode, options?.includeDealer, options?.priceCustomerCode, options?.currencyCode, page, pageSize, qDebounced, refreshTick, sub])

  const result = useMemo(
    () => ({ items, total, loading, error, main, sub, q, page, pageSize, includeInactive, setMainSub, setQ, setPage, setPageSize, setIncludeInactive, refetch }),
    [error, includeInactive, items, loading, main, page, pageSize, q, sub, total]
  )

  return result
}
