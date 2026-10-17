/**
 * Mesai giriş/çıkışında konum (2026-10-16).
 *
 * Eskiden konum alınamazsa sessizce 0,0 gönderiliyordu: personel ne olduğunu anlamıyor,
 * yüz ekranı "Yüz aranıyor…" diye dönüp duruyor, kayıt konumsuz oluşuyordu. Artık sebebi
 * (izin reddedildi / konum kapalı / zaman aşımı) ayırıp personele ne yapacağını söylüyoruz.
 */
export type GeoResult =
  | { ok: true; latitude: number; longitude: number; accuracy: number }
  | { ok: false; reason: 'unsupported' | 'denied' | 'unavailable' | 'timeout' | 'insecure'; message: string }

export const GEO_MESSAGES: Record<Exclude<GeoResult, { ok: true }>['reason'], string> = {
  denied:
    'Konum izni kapalı. Tarayıcının adres çubuğundaki kilit / ayarlar simgesinden bu siteye KONUM izni verin, sonra "Tekrar Dene"ye basın.',
  unavailable:
    'Konumunuz bulunamadı. Lütfen telefonunuzun KONUM (GPS) ayarını açın, sonra "Tekrar Dene"ye basın.',
  timeout: 'Konum zamanında alınamadı. Konumun (GPS) açık olduğundan emin olup "Tekrar Dene"ye basın.',
  unsupported: 'Bu tarayıcı konum vermiyor. Lütfen telefonunuzun güncel tarayıcısını (Chrome / Safari) kullanın.',
  insecure: 'Konum yalnızca güvenli bağlantıda (https) alınabilir. Lütfen size verilen https bağlantısını kullanın.'
}

export function getPosition(timeoutMs = 12000): Promise<GeoResult> {
  return new Promise((resolveOnce) => {
    /*
      KESİN ÜST SÜRE. Tarayıcının kendi `timeout`u izin sorusu CEVAPLANINCA işlemeye başlar;
      soru ekranda bekliyorsa (özellikle telefon kamerası açıkken arkada kalıyorsa) söz hiç
      dönmüyor, ekran "doğrulanıyor…"da takılı kalıyordu. Burada süre her durumda işler.
    */
    let done = false
    const resolve = (r: GeoResult) => {
      if (done) return
      done = true
      window.clearTimeout(guard)
      resolveOnce(r)
    }
    const guard = window.setTimeout(
      () => resolve({ ok: false, reason: 'timeout', message: GEO_MESSAGES.timeout }),
      timeoutMs + 3000
    )
    if (typeof window !== 'undefined' && window.isSecureContext === false) {
      resolve({ ok: false, reason: 'insecure', message: GEO_MESSAGES.insecure })
      return
    }
    if (!navigator.geolocation) {
      resolve({ ok: false, reason: 'unsupported', message: GEO_MESSAGES.unsupported })
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords
        if (!latitude || !longitude) {
          resolve({ ok: false, reason: 'unavailable', message: GEO_MESSAGES.unavailable })
          return
        }
        resolve({ ok: true, latitude, longitude, accuracy })
      },
      (err) => {
        const reason = err.code === err.PERMISSION_DENIED ? 'denied' : err.code === err.TIMEOUT ? 'timeout' : 'unavailable'
        resolve({ ok: false, reason, message: GEO_MESSAGES[reason] })
      },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 15000 }
    )
  })
}

/** Sunucunun konum hatası kodları — ekran bunlarda taramayı durdurup kullanıcıyı uyarır. */
export const LOCATION_ERROR_CODES = new Set(['location_required', 'outside_area'])
