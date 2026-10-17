/**
 * Kıbrıs (KKTC) Coğrafi Konum ve Şehir Doğrulama Servisi
 *
 * Stilsoft KKTC e-ticaret platformu yalnızca Kuzey Kıbrıs Türk Cumhuriyeti sınırları
 * içerisinde teslimat ve satış yapmaktadır.
 */

export const KKTC_CITIES = [
  'Lefkoşa',
  'Girne',
  'Gazimağusa',
  'Güzelyurt',
  'İskele',
  'Lefke',
] as const

export type KktcCity = (typeof KKTC_CITIES)[number]

/**
 * Kıbrıs Adası Coğrafi Koordinat Sınırları (Bounding Box)
 * Enlem (Latitude): 34.50° - 35.75° N
 * Boylam (Longitude): 32.20° - 34.65° E
 */
export const CYPRUS_GEO_BOUNDS = {
  minLat: 34.50,
  maxLat: 35.75,
  minLng: 32.20,
  maxLng: 34.65,
}

/**
 * Verilen koordinatların Kıbrıs / KKTC coğrafi sınırları içerisinde olup olmadığını denetler.
 */
export function isWithinCyprus(lat: number, lng: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false
  return (
    lat >= CYPRUS_GEO_BOUNDS.minLat &&
    lat <= CYPRUS_GEO_BOUNDS.maxLat &&
    lng >= CYPRUS_GEO_BOUNDS.minLng &&
    lng <= CYPRUS_GEO_BOUNDS.maxLng
  )
}

/**
 * Türkçe harfleri ASCII'ye indirger. `toLocaleLowerCase('tr-TR')` yalnızca BÜYÜK/küçük harf
 * dönüşümünü Türkçe kurallarına göre yapar — "Lefkosa" (cedilla'sız, Türkçe klavyesi olmayan
 * biri veya İngilizce klavye ile yazan biri için tipik) ile "Lefkoşa" arasındaki ş/s farkını
 * KAPATMAZ, ikisi hâlâ farklı string olarak kalır. Bu yüzden şehir doğrulaması "Lefkosa" gibi
 * geçerli ama aksansız yazımları KKTC dışı sanıp reddediyordu (2026-09-05 denetiminde, kayıtlı
 * bir adresle canlı ödeme sayfasında test edilirken bulundu — aynı bug sınıfı katalog aramasında
 * da vardı). Karakter karşılığı elle eşlemek `tr-TR` kültüründen bağımsız, tek ve tutarlı bir
 * sonuç verir; sunucudaki `KktcCityValidator.cs` da bilerek aynı yöntemi kullanıyor.
 */
function foldTurkish(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/ı/g, 'i')
    .replace(/ş/g, 's')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
}

/**
 * Şehir isminin geçerli bir KKTC şehri olup olmadığını denetler.
 */
export function isValidKktcCity(cityName?: string | null): boolean {
  if (!cityName) return false
  const clean = foldTurkish(cityName)
  return KKTC_CITIES.some(
    (c) =>
      foldTurkish(c) === clean ||
      clean.includes(foldTurkish(c)) ||
      (clean === 'magusa' && c === 'Gazimağusa') ||
      (clean === 'nicosia' && c === 'Lefkoşa') ||
      (clean === 'kyrenia' && c === 'Girne') ||
      (clean === 'famagusta' && c === 'Gazimağusa') ||
      (clean === 'morphou' && c === 'Güzelyurt') ||
      (clean === 'trikomo' && c === 'İskele')
  )
}

/**
 * Metin içerisinde Türkiye veya KKTC dışı bir ibare olup olmadığını veya KKTC şehri içerip içermediğini kontrol eder.
 */
export function checkAddressEligibility(
  city?: string | null,
  address?: string | null
): { isEligible: boolean; reason?: string } {
  // ASCII'ye indirgenmiş metinle karşılaştırılıyor: aksi hâlde "Turkiye" (ü'süz) ya da
  // "Diyarbakir" (ı'sız) gibi Türkçe klavyesi olmayan biri tarafından yazılmış YASAKLI bir
  // adres, aşağıdaki anahtar kelime listesindeki aksanlı yazımla eşleşmediği için sessizce
  // geçerdi — engel var görünüp aslında delinebilirdi (2026-09-05 denetiminde bulundu).
  const fullText = foldTurkish(`${city ?? ''} ${address ?? ''}`)

  // Türkiye veya yabancı ülke kontrolü
  const forbiddenKeywords = [
    'türkiye',
    'turkey',
    'istanbul',
    'ankara',
    'izmir',
    'bursa',
    'antalya',
    'adana',
    'konya',
    'gaziantep',
    'mersin',
    'diyarbakır',
  ].map(foldTurkish)

  for (const kw of forbiddenKeywords) {
    if (fullText.includes(kw)) {
      return {
        isEligible: false,
        reason: 'Teslimat adresiniz Türkiye olarak görünüyor. Siparişlerimiz yalnızca KKTC sınırları için geçerlidir.',
      }
    }
  }

  if (city && !isValidKktcCity(city)) {
    return {
      isEligible: false,
      reason: `Seçilen şehir (${city}) KKTC sınırları dışındadır. Lütfen KKTC şehirlerinden birini seçin.`,
    }
  }

  return { isEligible: true }
}
