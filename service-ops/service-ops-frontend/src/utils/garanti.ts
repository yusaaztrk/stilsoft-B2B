/**
 * GARANTİ BİLGİSİ — TEK KAYNAK.
 *
 * Arıza listelerindeki "Garanti" sütunu iki şey gösterir: Evet/Hayır ve garanti başlangıç
 * tarihi. Tarih üç ekranda birden çiziliyor (Arıza Kabul, Saha/Beyaz Eşya Arıza, Atölye Arıza);
 * okuma kuralı tek yerde durmazsa biri eski kayıtları gösterip diğeri göstermez.
 *
 * İKİ KAYNAK VAR ve bu geçicidir:
 *  1. `warrantyStartDate` — kaydın kendi alanı (sunucuda `ServiceRecord.PurchaseDate`).
 *     Yeni kayıtlar buraya yazar.
 *  2. Açıklama metnindeki `Garanti Başlangıcı: ...` satırı — ESKİ kayıtlar. Montaj Kabul
 *     ekranı tarihi bugüne kadar arıza açıklamasının içine metin olarak yazıyordu; Arıza
 *     Kabul ekranı ise formda soruyor ama HİÇ KAYDETMİYORDU (alan forma girilip kayboluyordu).
 *     Bu yüzden 26.08.2026 öncesi arıza kayıtlarının çoğunda tarih hiç yok.
 *
 * Yedek kaynak bilerek duruyor: silinirse metne yazılmış eski tarihler ekrandan kaybolur.
 */

const ESKI_ETIKET = 'Garanti Başlangıcı: '

/** Açıklama metnine gömülmüş eski tarihi çıkarır (yoksa null). */
function aciklamadanOku(problemDescription?: string | null): string | null {
  for (const line of (problemDescription || '').split('\n')) {
    if (line.startsWith(ESKI_ETIKET)) {
      const deger = line.substring(ESKI_ETIKET.length).trim()
      if (deger) return deger
    }
  }
  return null
}

/**
 * Tarihi gg.AA.yyyy olarak bicimler.
 *
 * `new Date(...).toLocaleDateString()` KULLANILMIYOR: sunucu tarihi UTC gece yarısı olarak
 * tutuyor, yerel saate çevrilince +03'ün gerisindeki bir tarayıcıda gün bir geri kayar.
 * ISO metnin ilk 10 karakteri zaten takvim günüdür, ondan okunuyor.
 */
function bicimle(deger: string): string {
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(deger)
  if (iso) return `${iso[3]}.${iso[2]}.${iso[1]}`

  // Zaten gg.AA.yyyy yazılmış eski metinler olduğu gibi geçer.
  if (/^\d{2}\.\d{2}\.\d{4}$/.test(deger)) return deger

  const d = new Date(deger)
  return Number.isNaN(d.getTime()) ? deger : d.toLocaleDateString('tr-TR')
}

/** Listede gösterilecek garanti başlangıç tarihi (gg.AA.yyyy) — yoksa null. */
export function garantiBaslangici(row: {
  warrantyStartDate?: string | null
  problemDescription?: string | null
}): string | null {
  const ham = row?.warrantyStartDate || aciklamadanOku(row?.problemDescription)
  return ham ? bicimle(ham) : null
}

/** Düzenleme formundaki `<input type="date">` için yyyy-MM-dd — yoksa boş metin. */
export function garantiBaslangiciInput(row: {
  warrantyStartDate?: string | null
  problemDescription?: string | null
}): string {
  const ham = row?.warrantyStartDate || aciklamadanOku(row?.problemDescription)
  if (!ham) return ''

  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(ham)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`

  const tr = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(ham)
  if (tr) return `${tr[3]}-${tr[2]}-${tr[1]}`

  return ''
}
