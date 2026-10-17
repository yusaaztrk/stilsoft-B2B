import { getDealerCodes, getSingleDealerCode, hasAllDealers } from './storage'

/**
 * Listeyi kullanıcıya ATANMIŞ carilerle sınırlar.
 *
 * Cari yetkisi bir liste ('*' = hepsi). Bu bir OTURUM KURALIDIR, kullanım yerine göre değişen
 * bir tercih değil: her ekranın ayrı ayrı hatırlaması gerekseydi, biri unutulduğunda sessizce
 * tüm cariler listelenirdi. Bu yüzden tek kopya burada duruyor ve hem `ErpCariSelect` hem de
 * arıza kabul ekranı buradan okur.
 *
 * Alt hesaplar da kapsanır: '120-01-000476' atanmışsa '120-01-000476-1' (FATURA/AÇIK/ASKERİYE)
 * da listeye girer, aksi halde atanmış carinin fatura hesabı seçilemez hale gelirdi.
 */
export function restrictToAssignedDealers<T extends { customerCode?: string | null }>(list: T[]): T[] {
  if (hasAllDealers()) return list

  const allowed = getDealerCodes().map((c) => c.toUpperCase())
  if (allowed.length === 0) return list

  return list.filter((item) => {
    const code = String(item.customerCode ?? '').toUpperCase()
    if (!code) return false
    return allowed.some((a) => code === a || code.startsWith(`${a}-`))
  })
}

/**
 * Müşteri carisi öneki. Arıza kabulünde cari seçimi yalnızca BAYİ carileri üzerinden yapılır
 * (kullanıcı kararı, 2026-08-21); müşteri carileri listeye hiç girmez.
 */
export const MUSTERI_CARI_ONEKI = '120-03'

/** Müşteri carilerini (120-03…) listeden düşürür. */
export function excludeMusteriCari<T extends { customerCode?: string | null }>(list: T[]): T[] {
  return list.filter((item) => {
    const code = String(item.customerCode ?? '').trim().toUpperCase()
    return !code.startsWith(MUSTERI_CARI_ONEKI)
  })
}

/** Kayıt bir müşteri carisi mi (120-03…)? */
function isMusteriCari(item: { customerCode?: string | null }): boolean {
  return String(item.customerCode ?? '').trim().toUpperCase().startsWith(MUSTERI_CARI_ONEKI)
}

/**
 * Müşteri carilerini (120-03…) görebilir mi?
 *
 * ÖLÇÜT "SINIRSIZ YETKİ" DEĞİL, "TEK CARİYE BAĞLI DEĞİL" (2026-08-28 düzeltmesi).
 *
 * İlk sürümde kapı `hasAllDealers()` idi; o yalnızca cari kodu HİÇ yokken ya da '*' iken
 * doğrudur. Oysa bizim çalışanların çoğunda virgülle ayrılmış bir cari portföyü var
 * ([[b2b-carikodu-claim-yapisi]]) — onlarda `hasAllDealers()` false döndüğü için istek
 * `type=bayi` gidiyor ve müşteri carileri ERP'den hiç istenmiyordu. Ekranda "-03'ler yok"
 * şikayetinin sebebi buydu; ağ günlüğünde `dealers?type=bayi` olarak görünür.
 *
 * Kullanıcının kuralı: "birden fazla cari atanmış olanlarda müşteriler de gelmeli, bayi
 * göremeyecek". `getSingleDealerCode() === null` bunu birebir karşılıyor: '*', boş ve çok
 * kodlu kullanıcılar geçer, TEK cariye bağlı bayi/alt bayi geçemez.
 */
export function canSeeMusteriCari(): boolean {
  return getSingleDealerCode() === null
}

/**
 * Arıza kabulünde seçilebilir cari listesi — kapsam kuralının tamamı.
 *
 * MÜŞTERİ CARİLERİ BAYİ KAPSAMINDAN MUAFTIR. Sebebi: müşteri kodları (120-03…) hiçbir zaman
 * kullanıcıya atanmış bayi kodlarının (120-01…) altında değildir, dolayısıyla
 * `restrictToAssignedDealers` onların HEPSİNİ eler. Kapı açılsa bile liste boş kalıyordu:
 * ERP'den gelen müşteriler istemcide sessizce çöpe gidiyordu. Bayi carileri için kapsam
 * kuralı aynen sürüyor.
 *
 * Giriş sırası korunur (açılır listede ERP'nin sıralaması bozulmasın).
 */
export function applyDealerScope<T extends { customerCode?: string | null }>(list: T[]): T[] {
  const musteriGorunur = canSeeMusteriCari()
  const izinliBayiler = new Set(restrictToAssignedDealers(list.filter((i) => !isMusteriCari(i))))
  return list.filter((item) => (isMusteriCari(item) ? musteriGorunur : izinliBayiler.has(item)))
}
