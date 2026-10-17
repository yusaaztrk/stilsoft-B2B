import type { CatalogItem } from '@/lib/api'
import { listProducts } from '@/lib/api'
import type { CartLine } from '@/lib/cart'
import { aksesuarMi, urunTipi, yedekParcaMi, type SetTipi } from '@/lib/setCompletion'

/**
 * SEPET ÖNERİLERİ (2026-09-20) — sunucu tarafı hesap.
 *
 * Üç tür, bu öncelikle:
 *  1. AKSESUAR — sepetteki davlumbazın karbon filtresi gibi. Ucuz, kararı kolay, marjı iyi.
 *  2. EKSİK SET PARÇASI — sepette fırın var, ocak yok.
 *  3. AYNI KATEGORİDEN ucuz tamamlayıcı — ankastre dışındaki sepetler de boş kalmasın.
 *
 * KATEGORİ SEPETTEN GELİYOR, sabit değil: ilk sürüm yalnız "ankastre" havuzuna bakıyordu,
 * dolayısıyla süpürge ya da küçük ev aleti alan müşteriye hiçbir öneri çıkmıyordu.
 *
 * Aksesuar eşleşmesi MODEL KODU üzerinden: "DA-5001" davlumbazına "YP-ST-DA-5001 60 DAVLUMBAZ
 * KARBON FİLTRE" eşleşir. Yalnız kelime benzerliğine bakmak her davlumbaza her filtreyi
 * önermek olurdu; müşteri yanlış filtreyi alır ve iade açar. Model kodu yoksa aksesuar
 * önerisi hiç yapılmaz — yanlış öneri, öneri yapmamaktan kötü.
 */

export type Oneri = CatalogItem & { oneriTuru: 'set' | 'aksesuar' | 'kategori' }

/**
 * Öneri motorunun satırdan ihtiyaç duyduğu alanlar. Sepet satırı (`CartLine`) bunları zaten
 * taşıyor; sipariş sonrası öneri (2026-09-21) sipariş satırlarından aynı biçime indirgeyip
 * çağırıyor — motor iki kez yazılmasın.
 */
export type OneriSatiri = Pick<CartLine, 'stockCode' | 'name' | 'categorySlug' | 'unitGrossPrice' | 'lineGross'>

/** Ankastre setin parçaları; sepette hangisi eksikse o öneriliyor. */
const SET_PARCALARI: SetTipi[] = ['firin', 'ocak', 'davlumbaz']

/** Aynı anda kaç kategori havuzu çekilir — sepette 10 farklı kategori varsa 10 istek atmayalım. */
const MAKS_KATEGORI = 3

/**
 * Addan model kodu çıkarır: harf VE rakam içeren, en az 4 karakterlik ilk jeton.
 * "ST-DA-5001 60 WHITE DAVLUMBAZ" -> "DA5001"
 */
function modelKodu(name: string): string | null {
  const temiz = name.replace(/^\s*(YP\s*-\s*)?ST\s*-\s*/i, '')
  for (const ham of temiz.split(/[\s(),]+/)) {
    const jeton = ham.replace(/[^A-Za-z0-9-]/g, '')
    if (jeton.length < 4) continue
    if (!/[A-Za-z]/.test(jeton) || !/\d/.test(jeton)) continue
    return jeton.replace(/-/g, '').toUpperCase()
  }
  return null
}

/**
 * İki model kodu aynı ürünü mü gösteriyor.
 *
 * TAM EŞİTLİK YETMİYOR: cihazın adı "ST-DA-F1760 BLACK DAVLUMBAZ" (kod DAF1760), ona ait
 * filtrenin adı ise "YP-ST-F1760 DAVLUMBAZ KARBON FİLTRE" (kod F1760) — aynı ürün, kodun
 * baştaki "DA" tipi öneki aksesuarda yazılmamış. Tam eşitlik arandığı sürece bu çiftler
 * hiç eşleşmiyordu.
 *
 * Biri diğerinin SONUYLA bitiyorsa aynı sayılıyor; kısa olanın en az 5 karakter ve 2 rakam
 * içermesi şart, yoksa "605" gibi parçalar alakasız ürünleri birbirine bağlardı.
 */
function modelEslesiyor(a: string | null, b: string | null): boolean {
  if (!a || !b) return false
  if (a === b) return true

  const kisa = a.length <= b.length ? a : b
  const uzun = a.length <= b.length ? b : a

  if (kisa.length < 5) return false
  if ((kisa.match(/\d/g) ?? []).length < 2) return false

  return uzun.endsWith(kisa)
}

export async function sepetOnerileri(lines: OneriSatiri[], enFazla = 3): Promise<Oneri[]> {
  if (lines.length === 0) return []

  const sepetKodlari = new Set(lines.map((l) => l.stockCode))
  const sepetTipleri = new Set(lines.map((l) => urunTipi(l.name)).filter((x): x is SetTipi => x !== null))

  // Sepetteki ürünlerin KENDİ kategorileri; sırayı koruyor, tekrarı atıyor.
  const kategoriler = [...new Set(lines.map((l) => l.categorySlug).filter((x): x is string => !!x))]
    .slice(0, MAKS_KATEGORI)

  if (kategoriler.length === 0) return []

  const havuzlar = await Promise.all(
    kategoriler.map((k) => listProducts({ kategori: k, adet: 96 }).then((p) => p.items)),
  )
  const havuz = havuzlar.flat()

  const uygun = (x: CatalogItem) =>
    !sepetKodlari.has(x.stockCode) && x.inStock

  /*
   * SEPETTEKİNİN AYNISINI ÖNERME.
   *
   * Gerçek veride görüldü: sepette bir TV askı aparatı varken üç TV askı aparatı daha
   * öneriliyordu. Müşteri aynı işi gören ikinci bir ürünü almaz; öneri alanını harcamış olur.
   *
   * `urunTipi` yalnız ankastre tiplerini biliyor, dolayısıyla genel bir ölçüt gerekiyordu:
   * adlarda ORTAK ANLAMLI KELİME sayısı. İki ve üzeri ortak kelime (ASKI + APARATI gibi)
   * "aynı şey" demek için yeterli; tek ortak kelime ("SİYAH") değil.
   */
  const anlamliKelimeler = (ad: string) =>
    new Set(
      ad
        .toLocaleUpperCase('tr')
        .split(/[^A-Za-zÇĞİÖŞÜ]+/)
        .filter((w) => w.length >= 4),
    )

  const sepetKelimeleri = lines.map((l) => anlamliKelimeler(l.name))

  const sepettekineBenziyor = (x: CatalogItem) => {
    const kelimeler = anlamliKelimeler(x.name)
    return sepetKelimeleri.some((s) => {
      let ortak = 0
      for (const w of kelimeler) if (s.has(w)) ortak++
      return ortak >= 2
    })
  }

  const oneriler: Oneri[] = []
  const ekle = (x: CatalogItem, tur: Oneri['oneriTuru']) => {
    if (oneriler.some((o) => o.stockCode === x.stockCode)) return
    oneriler.push({ ...x, oneriTuru: tur })
  }

  // 1) AKSESUAR — model kodu eşleşen yedek parça/filtre.
  for (const line of lines) {
    if (oneriler.length >= enFazla) break
    const kod = modelKodu(line.name)
    if (!kod) continue

    const aksesuar = havuz.find((x) => uygun(x) && aksesuarMi(x.name) && modelEslesiyor(kod, modelKodu(x.name)))
    if (aksesuar) ekle(aksesuar, 'aksesuar')
  }

  // 2) EKSİK SET PARÇASI — yalnız sepette ankastre parçası varsa anlamlı.
  if (SET_PARCALARI.some((t) => sepetTipleri.has(t))) {
    for (const tip of SET_PARCALARI) {
      if (oneriler.length >= enFazla) break
      if (sepetTipleri.has(tip)) continue

      const aday = havuz
        .filter((x) => uygun(x) && urunTipi(x.name) === tip)
        .sort((a, b) => a.grossPrice - b.grossPrice)[0]

      if (aday) ekle(aday, 'set')
    }
  }

  /*
   * 3) AYNI KATEGORİDEN UCUZ TAMAMLAYICI.
   *
   * Ankastre dışındaki sepetler (süpürge, küçük ev aleti, tekstil) yukarıdaki iki kuraldan
   * hiç öneri almıyordu. Burada sepetin en ucuz ürününden daha ucuz, aynı kategoriden bir
   * ürün öneriliyor: "yanına bir tane daha" kararı, pahalı bir ürün kararından çok daha kolay.
   */
  if (oneriler.length < enFazla) {
    /*
     * TAVAN: sepetin en ucuz ürünü ile sepet toplamının dörtte birinden BÜYÜK olanı.
     *
     * Yalnız "en ucuz ürün"e bakmak, 18.600 TL'lik bir sepette 450 TL'lik bir TV aparatı
     * varsa tavanı 450'ye düşürüyor ve makul her öneriyi eliyordu. Yalnız yüzdeye bakmak da
     * küçük sepetlerde tavanı gereksiz kısıyor. İkisinin büyüğü her iki durumu da tutuyor.
     */
    const sepetEnUcuz = Math.min(...lines.map((l) => l.unitGrossPrice))
    const sepetToplam = lines.reduce((t, l) => t + l.lineGross, 0)
    const tavan = Math.max(sepetEnUcuz, sepetToplam * 0.25)

    const adaylar = havuz
      // YEDEK PARÇA elenir (modele özel filtre gibi), AKSESUAR elenmez: TV askı aparatı
      // kendi başına satılan, kararı kolay bir ürün ve tam da önerilmesi gereken şey.
      .filter((x) => uygun(x) && !yedekParcaMi(x.name) && !sepettekineBenziyor(x) && x.grossPrice <= tavan)
      .sort((a, b) => b.grossPrice - a.grossPrice)   // tavana en yakın: değeri en yüksek ekleme

    for (const aday of adaylar) {
      if (oneriler.length >= enFazla) break
      ekle(aday, 'kategori')
    }
  }

  return oneriler.slice(0, enFazla)
}
