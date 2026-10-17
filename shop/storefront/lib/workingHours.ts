/**
 * Çalışma saatleri — panelden gelen serbest metni ekrana çevirir.
 *
 * NEDEN AYAR: saatler vitrinde koda sabit yazılıydı ("Pzt – Cmt: 08:30 - 18:00") ve
 * mağazanın gerçek saatleriyle tutmuyordu; değiştirmek için derleme gerekiyordu.
 *
 * BİÇİM: her satır bir gün, `Gün|Saat`. Ayırıcı yoksa satır olduğu gibi basılır — bayram
 * duyurusu gibi serbest bir satır da yazılabilsin diye. Boş satırlar atılır.
 */
export type WorkingHourRow = { day: string; hours: string }

export function parseWorkingHours(raw?: string | null): WorkingHourRow[] {
  return String(raw ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const i = line.indexOf('|')
      if (i < 0) return { day: line, hours: '' }
      return { day: line.slice(0, i).trim(), hours: line.slice(i + 1).trim() }
    })
}

/**
 * Tek satırlık özet — altbilgi ve destek kutusu gibi yerin dar olduğu noktalar için.
 *
 * Aynı saate sahip ardışık günleri birleştirir ("Pazartesi – Cuma 08:00 - 18:00") ve
 * kapalı günü ayrıca yazar. Hiçbir şey çıkaramazsa boş döner; çağıran o zaman satırı
 * hiç göstermiyor — uydurma bir saat yazmaktansa hiç yazmamak doğru.
 */
export function summariseWorkingHours(raw?: string | null): string {
  const rows = parseWorkingHours(raw).filter((r) => r.hours.length > 0)
  if (rows.length === 0) return ''

  const parts: string[] = []
  let start = 0

  for (let i = 1; i <= rows.length; i++) {
    if (i === rows.length || rows[i].hours !== rows[start].hours) {
      const first = rows[start].day
      const last = rows[i - 1].day
      const label = start === i - 1 ? first : `${first} – ${last}`
      parts.push(`${label}: ${rows[start].hours}`)
      start = i
    }
  }

  return parts.join(' · ')
}
