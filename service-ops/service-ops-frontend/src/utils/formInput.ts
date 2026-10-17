export function toTurkishUpper(value: string): string {
  return value.toLocaleUpperCase('tr-TR')
}

// TELEFON: YURT DISI NUMARALARINI DA ALIR (2026-08-20).
//
// 11 haneye kirpiliyordu — Turkiye/KKTC numarasinin uzunlugu. Yurt disindan musterisi olan
// firmada numaranin sonu SESSIZCE kesiliyordu. Bicim 4-3-4 gruplarindan sonra kalan haneleri
// dorduncu gruba ekler; 11 haneli mevcut numaralar birebir ayni gorunur.
//
// Ust sinir 17: E.164 en fazla 15 hane, Turkiye'de yurt disi numarasi "00" onekiyle yazildigi
// icin +2. ERP'deki `frontend/src/utils/phone.ts` ile AYNI kural — biri degisirse digeri de
// degismeli, yoksa ServiceOps'tan acilan cari ERP'de reddedilir.
export const PHONE_MAX_DIGITS = 17
export const PHONE_MAX_LENGTH = PHONE_MAX_DIGITS + 3
export const PHONE_PATTERN = /^0\d{3} \d{3} \d{4}( \d{1,6})?$/

export function sanitizePhone(value: string) {
  const digits = String(value ?? '').replace(/\D/g, '').slice(0, PHONE_MAX_DIGITS)
  if (!digits) return ''

  const groups = [digits.slice(0, 4), digits.slice(4, 7), digits.slice(7, 11), digits.slice(11)]
  return groups.filter(Boolean).join(' ')
}

export function sanitizeEmail(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, '').slice(0, 120)
}

export function sanitizeName(value: string) {
  const clean = value.replace(/[^\p{L}\s.'-]/gu, '').replace(/\s{2,}/g, ' ').slice(0, 80)
  return toTurkishUpper(clean)
}

export function sanitizeSerial(value: string) {
  const clean = value.replace(/[^a-zA-Z0-9._/-]/g, '').slice(0, 80)
  return toTurkishUpper(clean)
}

export function isValidEmail(value: string) {
  if (!value.trim()) return true
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
}

// Bicimlendirici 17 haneye acilmisti ama bu dogrulayici 11'de kalmisti: kullanici yurt disi
// numarasini yazabiliyor, kaydederken reddediliyordu. Alt sinir 11'de BIRAKILDI (eksik numara
// ayri bir sorun); yalnizca ust sinir acildi.
//
// Bos deger burada GECERSIZ sayilir — MusterilerPage kaydet dugmesini buna bagliyor.
export function isValidPhone(value: string) {
  const digits = String(value ?? '').replace(/\D/g, '')
  return digits.length >= 11 && digits.length <= PHONE_MAX_DIGITS && digits.startsWith('0')
}
