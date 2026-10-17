/**
 * ATÖLYE GÜN SAYACI (2026-10-04 kullanıcı isteği).
 *
 * Arıza ekranlarında "Geçen Gün"ün yanındaki ikinci sayaç. Kural:
 *  - Ürün İLK KEZ atölyeye alındığı an saymaya başlar (sunucu `workshopEnteredAt`'i işlem
 *    geçmişinden türetir: Atölyede / Tamirde / Parça Bekliyor durumlarından ilki).
 *  - Durum sonradan değişse de saymaya devam eder.
 *  - İş tamamlanınca durur — bitiş anı "Geçen Gün" ile AYNI kuralla bulunur, iki sayaç
 *    aynı güne kadar sayar.
 *  - Hiç atölyeye girmediyse sayı yok, ekran "Atölyeye girmedi" yazar.
 */

/** Atölye sayacını başlatan durumlar — sunucudaki `WorkshopStatuses` ile aynı küme. */
export const WORKSHOP_STATUSES = new Set(['Workshop', 'InRepair', 'WaitingForParts'])

/** "Geçen Gün" sayacının kullandığı tamamlanma kuralı; iki sayaç aynı anda durmalı. */
export const isRecordFinished = (item: any): boolean =>
  item?.status === 'Completed' ||
  item?.status === 'Delivered' ||
  item?.status === 'Cancelled' ||
  item?.derivedState === 'Completed' ||
  item?.derivedState === 'CompletedWithCancellations' ||
  item?.derivedState === 'Cancelled' ||
  item?.status === 'ready' ||
  item?.status === 'delivered' ||
  item?.status === 'cancelled'

/** Atölyede geçen gün; atölyeye hiç girmediyse null. */
export const workshopDaysOf = (item: any): number | null => {
  const startStr = item?.workshopEnteredAt
  if (!startStr) return null
  const start = new Date(startStr)
  if (Number.isNaN(start.getTime())) return null
  const endStr = isRecordFinished(item)
    ? (item.completedAt || item.CompletedAt || item.updatedAt || item.UpdatedAt)
    : null
  const end = endStr ? new Date(endStr) : new Date()
  return Math.max(0, Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)))
}

/**
 * Tek kayıt güncellendiğinde (durum, atama, plan, basım) sunucu kaydı liste ucundan değil
 * tekil uçtan döner ve `workshopEnteredAt` taşımaz. Önceki değer korunur; kayıt şimdi atölyeye
 * alındıysa sayaç bu andan başlar. Sonraki sessiz yenileme sunucudaki kesin değeri getirir.
 */
export const keepWorkshopEnteredAt = <T extends { status?: string; workshopEnteredAt?: string | null }>(
  prev: T | undefined,
  next: T,
): T => {
  if (next.workshopEnteredAt) return next
  const onceki = prev?.workshopEnteredAt ?? null
  if (onceki) return { ...next, workshopEnteredAt: onceki }
  if (next.status && WORKSHOP_STATUSES.has(next.status)) {
    return { ...next, workshopEnteredAt: new Date().toISOString() }
  }
  return next
}
