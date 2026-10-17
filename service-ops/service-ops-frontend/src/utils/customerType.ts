/** `ServiceRecord.PickupSourceId` = 1 → ürün mağazadan teslim alınacak. */
export const TESLIM_KAYNAGI_MAGAZA = 1

/**
 * `ServiceRecord.PickupSourceId` = 2 → ürün BAYİYE teslim edilecek (2026-08-28 kullanıcı isteği).
 *
 * Mağaza seçimiyle AYNI kolonu paylaşır, dolayısıyla ikisi birbirini dışlar: bir kayıt ya
 * mağazadan alınır ya bayiye teslim edilir. Kabul ekranındaki iki kutu da bunu görünür
 * kılar — biri işaretlenince diğeri kendiliğinden kalkar, seçim sessizce yutulmaz.
 */
export const TESLIM_KAYNAGI_BAYI = 2

export type MusteriTipi = 'Bayi' | 'Mağaza' | 'Müşteri' | 'Bayiye Teslim'

/**
 * Müşteri tipi rozetinin rengi. Dört sayfa (Ürün Kabul, Atölye Arıza, Saha Arıza, Montaj
 * Kabul) aynı rozeti çiziyordu ve renk eşlemesi dördüne de kopyalanmıştı; "Bayiye Teslim"
 * eklenirken dördü birden unutulursa yeni tip sessizce yeşil (Müşteri rengi) görünürdü.
 */
export const getCustomerTypeBadgeClass = (type: MusteriTipi): string => {
  if (type === 'Bayi') return 'bg-blue-100 text-blue-800 border-blue-200 font-bold'
  if (type === 'Mağaza') return 'bg-purple-100 text-purple-800 border-purple-200 font-bold'
  if (type === 'Bayiye Teslim') return 'bg-red-100 text-red-800 border-red-300 font-bold'
  return 'bg-emerald-100 text-emerald-800 border-emerald-200 font-bold'
}

export const getCustomerOrDealerType = (r: any): MusteriTipi => {
  if (!r) return 'Bayi'

  /*
    0. AÇIK SEÇİM, ÇIKARIMIN ÖNÜNDE (2026-08-27 kullanıcı isteği).

    Kabul ekranında "mağazadan teslim alınacak" işaretlenmişse kayıt MAĞAZA'dır. Bu kontrol
    en başta olmak zorunda: aşağıdaki ilk kural cari kodundan çıkarım yapıyor ve bayi kodu
    (`120-01-`) taşıyan her kayda "Bayi" diyor. Sonraya konsaydı seçim hiçbir zaman
    görünmezdi — kullanıcı kutuyu işaretler, tablo yine "Bayi" yazardı.

    Yalnızca bu alan öne alındı; `installationType`/`customerType` aşağıda kaldı. Sebebi:
    sunucu montaj kayıtlarına varsayılan olarak "Bayi" yazıyor, o değeri de öne almak
    mağaza carisine (`120-04-`) açılmış montajları yanlışlıkla "Bayi" gösterirdi.
  */
  if (Number(r.pickupSourceId) === TESLIM_KAYNAGI_MAGAZA) return 'Mağaza'
  if (Number(r.pickupSourceId) === TESLIM_KAYNAGI_BAYI) return 'Bayiye Teslim'

  // 1. Check dealerCode / customerCode / dealerName / customerName for Cari Code prefix
  const rawStr = `${r.dealerCode || ''} ${r.customerCode || ''} ${r.dealerName || ''} ${r.customerName || ''}`
  if (/120-04-/i.test(rawStr)) return 'Mağaza'
  if (/120-03-/i.test(rawStr)) return 'Müşteri'
  if (/120-01-/i.test(rawStr)) return 'Bayi'

  // 2. Check problemDescription / notes for parsed Müşteri Tipi
  const notesStr = String(r.problemDescription || r.notes || '')
  if (notesStr.includes('Müşteri Tipi: Mağaza') || notesStr.includes('Müşteri Tipi: Magaza')) return 'Mağaza'
  if (notesStr.includes('Müşteri Tipi: Müşteri') || notesStr.includes('Müşteri Tipi: Musteri')) return 'Müşteri'
  if (notesStr.includes('Müşteri Tipi: Bayi')) return 'Bayi'

  // 3. Check installationType / customerType
  const instType = String(r.installationType || r.customerType || '')
  if (instType === 'Mağaza' || instType === 'Magaza') return 'Mağaza'
  if (instType === 'Müşteri' || instType === 'Musteri') return 'Müşteri'
  if (instType === 'Bayi') return 'Bayi'

  return 'Bayi'
}
