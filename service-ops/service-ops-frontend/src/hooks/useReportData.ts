import { useEffect, useState } from 'react'
import type { ReportFilter } from '../api/reports'

/**
 * Filtre değiştikçe raporu yeniden çeken ortak kanca.
 *
 * Her istek kendi AbortController'ıyla iptal ediliyor: filtreye hızlı hızlı basıldığında
 * geç dönen eski cevap yeni sonucun üzerine yazıyordu — ekranda seçilenden başka bir dönem
 * görünmesinin sebebi buydu.
 */
export function useReportData<T>(
  loader: (filter: ReportFilter, signal: AbortSignal) => Promise<T>,
  filter: ReportFilter,
  deps: unknown[] = []
) {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const key = JSON.stringify(filter)

  useEffect(() => {
    const controller = new AbortController()
    let alive = true

    setLoading(true)
    setError(null)

    void (async () => {
      try {
        const result = await loader(filter, controller.signal)
        if (!alive || controller.signal.aborted) return
        setData(result)
      } catch (e: any) {
        if (!alive || controller.signal.aborted) return
        setError(String(e?.message ?? 'Rapor alınamadı'))
      } finally {
        if (alive && !controller.signal.aborted) setLoading(false)
      }
    })()

    return () => {
      alive = false
      controller.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ...deps])

  return { data, loading, error }
}
