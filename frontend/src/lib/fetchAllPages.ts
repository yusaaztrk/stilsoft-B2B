/**
 * BÜTÜN KAYITLARI SAYFA SAYFA ÇEK (2026-10-08).
 *
 * Liste ekranlarının çoğu sunucudan "son 200" (bazıları 500) kaydı alıp arama, sütun
 * süzgeçleri ve sayfalamayı TARAYICIDA o pencerenin içinde yapıyordu. Pencerenin dışına
 * düşen eski bir kayıt (ör. alış faturalarında 25.08'deki 0081820) Fatura Dökümü'nde ve
 * cari ekstrede görünürken listede HİÇ bulunamıyordu.
 *
 * Bu yardımcı sunucunun `skip`/`take` uçlarını sırayla çağırır:
 *  - İlk sayfa gelir gelmez `onPage` ile ekrana basılır (ekran beklemez), kalanlar arkadan eklenir.
 *  - Yükleme sırasında yeni kayıt girilirse sayfalar bir kayıt kayabilir; aynı kayıt iki kez
 *    görünmesin diye `key` ile tekilleştirilir (sıra korunur: en yeni önce).
 *  - `maxPages` sonsuz döngüye karşı emniyettir.
 */
export async function fetchAllPages<T>(
  fetchPage: (skip: number, take: number) => Promise<T[] | null | undefined>,
  opts: {
    key: (item: T) => string
    pageSize?: number
    maxPages?: number
    /** Her sayfadan sonra o ana kadarki bütün liste; `first` ilk sayfada true. */
    onPage?: (all: T[], first: boolean) => void
  }
): Promise<T[]> {
  const pageSize = opts.pageSize ?? 500
  const maxPages = opts.maxPages ?? 40
  const byKey = new Map<string, T>()

  for (let page = 0; page < maxPages; page++) {
    const data = (await fetchPage(page * pageSize, pageSize)) ?? []
    for (const item of data) {
      const k = opts.key(item)
      if (!byKey.has(k)) byKey.set(k, item)
    }
    opts.onPage?.(Array.from(byKey.values()), page === 0)
    if (data.length < pageSize) break
  }

  return Array.from(byKey.values())
}
