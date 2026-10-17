/**
 * Sekme ekranda mı? (2026-10-05 kullanıcı bildirimi: "servis genel olarak çok yavaş")
 *
 * Arka plandaki sekmeler — gün boyu açık bırakılan onlarca servis ekranı — her 15-60 saniyede
 * liste, rozet, teknisyen ve bildirim sorgusu atmaya devam ediyordu. Kimsenin bakmadığı
 * ekranı tazelemek sunucuyu boşuna yoruyor; sekmeye dönüldüğünde zaten yenileniyor.
 * Yoklamalar (setInterval) bu kontrolden geçiyor; kullanıcı işlemleri ve canlı olaylar geçmiyor.
 */
export function sekmeGorunur(): boolean {
  return typeof document === 'undefined' || document.visibilityState === 'visible'
}
