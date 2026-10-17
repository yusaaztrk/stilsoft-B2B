/**
 * Cari seçim kutusunun SUNUCU ARAMASI için ortak parçalar.
 *
 * `SearchableCariSelect` isteğe bağlı bir `remoteSearch` alıyor; verilince listeyi indirmek
 * yerine her aramada sunucudan en fazla `CARI_SEARCH_LIMIT` satır çekiyor. Cari Ekstre bu
 * şekilde açılışta iki sınırsız istekten kurtuldu (5855 cari + tedarikçi listesinin ikinci
 * kopyası) ve kutu artık veri beklemeden tıklanabiliyor.
 *
 * BURADA YALNIZCA ORTAK OLAN DURUYOR — sorgu kelimesi ve sınır. Hangi ucun çağrılacağı ve
 * hangi parametrelerle (`forOrder`, `includeMuhtelif`, `onlyWithProducts`, plasiyer kapsamı…)
 * her ekranın KENDİ kararı; tek bir "hepsi için arama" yazmak o ekranların listelerini
 * sessizce değiştirirdi. Bu yüzden her sayfa kendi `remoteSearch`ünü kurar, buradan yalnızca
 * sorguyu ve sınırı alır.
 */

/** Bir aramada sunucudan istenen en fazla satır. Kutu zaten ilk 100'ü gösteriyor. */
export const CARI_SEARCH_LIMIT = 50

/**
 * Tür pastilinin sunucuya SORGU KELİMESİ olarak gönderilecek karşılığı.
 *
 * Uç, kod + ad + telefonu birleştirip tarıyor ve normalleştirmede ayraçları atıyor; bu yüzden
 * "120-01" yazmak o türün kodlarını yakalar. "Tümü" ve "Gider" burada YOK: gider carileri hem
 * 600 hem 770 ile başlayabiliyor, tek önekle ifade edilemiyor — onlar istemcideki pastil
 * süzgeciyle daraltılıyor.
 */
export const CARI_TYPE_QUERY_PREFIX: Record<string, string> = {
  customer: '120-03',
  dealer: '120-01',
  sub_dealer: '120-02',
  store: '120-04',
  employee: '120-05',
  retail: '120-06',
  service: '120-07',
  supplier: '320'
}

/**
 * Kutudan gelen serbest metni ve seçili tür pastilini tek bir sunucu sorgusuna çevirir.
 * Uç birden çok kelimede "hepsi geçmeli" kuralını uyguluyor, yani "12001 ali" hem türü hem
 * ismi daraltır.
 */
export function buildCariSearchQuery(query: string, accountTypeKey?: string): string {
  const prefix = accountTypeKey ? (CARI_TYPE_QUERY_PREFIX[accountTypeKey] ?? '') : ''
  return [prefix, String(query ?? '').trim()].filter(Boolean).join(' ')
}
