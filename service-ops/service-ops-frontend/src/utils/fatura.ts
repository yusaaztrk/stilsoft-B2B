/**
 * SERVİS FATURASI — BOŞ ÇAĞRI YAPMA KURALI.
 *
 * ERP'deki `create-service-invoice` ucu, faturaya girecek hiçbir satır yoksa BİLEREK 400
 * döner ("Faturalanacak tutar yok"). Kural 2026-08-21'de kondu: bedelsiz kapatılan iş,
 * bayiye 0 TL'lik satış faturası taslağı olarak düşmesin diye.
 *
 * Servis ekranları o ucu KOŞULSUZ çağırıyordu; fiyat girilmeden kapatılan her işte 400
 * dönüyor ve hata bütün akışı düşürüyordu — bazı yerlerde kayıt kapanmıyordu bile
 * (2026-08-27 bildirimi: "fiyat yazmayınca fiyat girin diyor, bad request dönüyor").
 *
 * Koşul ERP'deki kuralın AYNISI olmalı: işçilik bedeli varsa ya da faturaya girecek kalem
 * varsa fatura istenir. İkisi ayrışırsa aradaki boşlukta yine 400 dönerdi.
 *
 * Garantili kalemler de sayılır: fiyatları 0 olsa bile ERP onları satır olarak ekliyor,
 * yani liste boş kalmıyor ve fatura oluşuyor.
 */
export function faturalanacakVar(fiyat: unknown, kalemler?: unknown): boolean {
  const f = Number(fiyat)
  if (Number.isFinite(f) && f > 0) return true
  return Array.isArray(kalemler) && kalemler.length > 0
}
