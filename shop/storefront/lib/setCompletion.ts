import type { CatalogItem } from '@/lib/api'

/**
 * ANKASTRE SET TAMAMLAMA (2026-09-20).
 *
 * NEDEN: fırın alan müşteri ocak ve davlumbaz da alır — mutfak ankastresi zaten set olarak
 * kurulur. Ürün sayfasındaki "benzer ürünler" bloğu AYNI KATEGORİDEN rastgele ürün
 * gösteriyordu; fırın bakan müşteriye başka bir fırın önermek sepeti büyütmez, kararı
 * zorlaştırır. Burada TAMAMLAYICI tip öneriliyor.
 *
 * Tip ürün ADINDAN çıkarılıyor: ERP'de "ürün tipi" diye kullanılabilir bir alan yok
 * (`ProductType` hepsinde "URUN"). Ad yeterince ayırt edici — kategori de ANKASTRE olduğu
 * için yanlış eşleşme alanı dar.
 */

export type SetTipi = 'firin' | 'ocak' | 'davlumbaz' | 'mikrodalga' | 'bulasik' | 'aspirator'

const ANAHTARLAR: Array<{ tip: SetTipi; kalip: RegExp }> = [
  // SIRA ÖNEMLİ: "mikrodalga fırın" önce mikrodalga olarak yakalanmalı, yoksa fırın sayılır
  // ve müşteriye ankastre fırın yerine mikrodalga önerilir.
  { tip: 'mikrodalga', kalip: /m[iı]krodalga/i },
  { tip: 'bulasik', kalip: /bula[sş][iı]k/i },
  { tip: 'davlumbaz', kalip: /davlumbaz/i },
  { tip: 'aspirator', kalip: /aspirat[oö]r/i },
  { tip: 'firin', kalip: /f[iı]r[iı]n/i },
  { tip: 'ocak', kalip: /ocak/i },
]

/** Tamamlayıcılar: müşteri bunu aldıysa sırasıyla şunlar önerilir. */
const TAMAMLAYICI: Record<SetTipi, SetTipi[]> = {
  firin: ['ocak', 'davlumbaz'],
  ocak: ['davlumbaz', 'firin'],
  davlumbaz: ['ocak', 'firin'],
  aspirator: ['ocak', 'firin'],
  mikrodalga: ['firin', 'ocak'],
  bulasik: [],          // bulaşık makinesi setin parçası değil; zorlama öneri yapılmıyor
}

/*
  YEDEK PARÇA / AKSESUAR ELENİR.

  Gerçek katalogda yakalandı: "YP-ST-DA-5001 60 DAVLUMBAZ KARBON FİLTRE" (700 TL) adında
  "DAVLUMBAZ" geçtiği ve en ucuz olduğu için, davlumbaz arayan müşteriye DAVLUMBAZ diye
  öneriliyordu. Filtre öneriyle cihaz önerisi karıştığında blok güven kaybettiriyor.

  ERP'de "aksesuar mı" diye bir alan yok; ayırt edici olan YP- öneki (yedek parça) ve
  ad içindeki filtre/aparat gibi kelimeler.
*/
const AKSESUAR = /^\s*YP\s*-|f[iı]ltre|yedek\s*par[çc]a|aparat|montaj\s*kiti|ba[ğg]lant[iı]\s*seti/i

/**
 * BELİRLİ BİR MODELE AİT yedek parça. `aksesuarMi`'den daha DAR.
 *
 * Ayrım gerekliydi: "TV ASKI APARATI" aksesuar sayılıp set parçası olarak seçilmemeli
 * (doğru), ama sepette çapraz satış önerisi olarak GÖSTERİLMELİ — kendi başına satılan,
 * kararı kolay, marjı iyi bir ürün. Karbon filtresi ise öyle değil: yalnız kendi modeline
 * uyuyor, sahibi olmayana önerilirse iade olarak geri geliyor.
 */
const YEDEK_PARCA = /^\s*YP\s*-|f[iı]ltre|yedek\s*par[çc]a/i

export function aksesuarMi(name: string | null | undefined): boolean {
  return AKSESUAR.test(name ?? '')
}

export function yedekParcaMi(name: string | null | undefined): boolean {
  return YEDEK_PARCA.test(name ?? '')
}

export function urunTipi(name: string | null | undefined): SetTipi | null {
  const ad = name ?? ''
  if (aksesuarMi(ad)) return null
  for (const { tip, kalip } of ANAHTARLAR) {
    if (kalip.test(ad)) return tip
  }
  return null
}

/**
 * Sepeti büyütecek öneriler: her tamamlayıcı tipten EN FAZLA BİR ürün.
 *
 * Aynı tipten üç ürün göstermek seçim yorgunluğu yaratır ve "hepsini ekle" düğmesini
 * anlamsızlaştırır; amaç karşılaştırma değil seti tamamlamak.
 *
 * Stokta olan tercih ediliyor: sepete eklenemeyecek ürünü önermek düğmeyi kırar.
 * Eşitlikte UCUZ olan: set tamamlama kararı verirken yüksek fiyat caydırıcı.
 */
export function setOnerileri(
  mevcut: CatalogItem,
  havuz: CatalogItem[],
  enFazla = 2,
): CatalogItem[] {
  const tip = urunTipi(mevcut.name)
  if (!tip) return []

  const hedefler = TAMAMLAYICI[tip]
  if (hedefler.length === 0) return []

  const secilenler: CatalogItem[] = []

  for (const hedef of hedefler) {
    if (secilenler.length >= enFazla) break

    const aday = havuz
      .filter((x) => x.stockCode !== mevcut.stockCode)
      .filter((x) => !secilenler.some((s) => s.stockCode === x.stockCode))
      .filter((x) => urunTipi(x.name) === hedef)
      .sort((a, b) => {
        if (a.inStock !== b.inStock) return a.inStock ? -1 : 1
        return a.grossPrice - b.grossPrice
      })[0]

    if (aday) secilenler.push(aday)
  }

  return secilenler
}

/** Blok başlığı: ne aldığına göre değişiyor, genel bir "birlikte alınanlar"dan daha ikna edici. */
export function setBasligi(tip: SetTipi | null): string {
  switch (tip) {
    case 'firin':
      return 'Ankastre setinizi tamamlayın'
    case 'ocak':
      return 'Ocağınızın yanına'
    case 'davlumbaz':
    case 'aspirator':
      return 'Davlumbazınızın yanına'
    case 'mikrodalga':
      return 'Birlikte iyi gider'
    default:
      return 'Birlikte iyi gider'
  }
}
