/**
 * Fatura iskontosunun net / KDV ayrımı — sunucudaki `InvoiceDiscountMath` ile BİREBİR aynı.
 *
 * Satıcı iskontoyu müşterinin ÖDEYECEĞİ tutar üzerinden girer (KDV dahil). Bu yüzden iskonto
 * net ile KDV'ye oranlı dağıtılmalı; genel toplam değişmez, yalnızca içindeki ayrım düzelir.
 *
 * Ayrı dosya olmasının sebebi: aynı hesap satış faturası ekranında iki yerde (TL özeti ve
 * dövizli özet) tekrarlanıyordu ve sunucudan ayrı düşmüştü. Fatura kaydedildiğinde sunucu
 * doğru rakamı yazıyor, ekran ise eskisini gösteriyordu — kullanıcı basımla ekranı
 * karşılaştırınca farklı iki KDV görüyordu (2026-08-26 bildirimi).
 */
export type IskontoSonuc = {
  netToplam: number
  kdvToplam: number
  genelToplam: number
  /** İskontonun NET karşılığı — ekranda "Fatura İndirimi" olarak bu gösterilir. */
  netIskonto: number
}

const yuvarla = (v: number) => Math.round((Number(v) + Number.EPSILON) * 100) / 100

/**
 * @param brut       Kalemlerin KDV hariç toplamı
 * @param brutKdv    Kalemlerin KDV'si, iskonto UYGULANMADAN
 * @param kdvDahilIskonto Kullanıcının girdiği iskonto (KDV dahil)
 */
export function iskontoyuAyristir(
  brut: number,
  brutKdv: number,
  kdvDahilIskonto: number
): IskontoSonuc {
  let b = Number(brut)
  let k = Number(brutKdv)
  let i = Number(kdvDahilIskonto)

  if (!Number.isFinite(b) || b < 0) b = 0
  if (!Number.isFinite(k) || k < 0) k = 0
  if (!Number.isFinite(i) || i < 0) i = 0

  const kdvDahilTaban = b + k
  if (i > kdvDahilTaban) i = kdvDahilTaban

  if (kdvDahilTaban <= 0) {
    return { netToplam: 0, kdvToplam: 0, genelToplam: 0, netIskonto: 0 }
  }

  const kalanOran = (kdvDahilTaban - i) / kdvDahilTaban

  // Genel toplam ÖNCE ve tam: müşteriyle anlaşılan tutar budur.
  const genelToplam = yuvarla(kdvDahilTaban - i)
  const netToplam = yuvarla(b * kalanOran)

  // KDV genel toplamdan türetilir; net + KDV her zaman birebir tutar.
  const kdvToplam = Math.max(0, yuvarla(genelToplam - netToplam))
  const netIskonto = Math.max(0, yuvarla(b - netToplam))

  return { netToplam, kdvToplam, genelToplam, netIskonto }
}

/**
 * Faturadaki kampanyanın iki parçası (belgenin parasında).
 *
 * Kalem kampanyası (`discountAmount`) KDV HARİÇ bir tutardır ve yalnız KENDİ KALEMİNİ küçültür;
 * sipariş geneli kampanya (tutarlı sepet indirimi gibi) ise genel toplamdan düşer, KDV dahildir.
 */
export type KampanyaAyrimi = {
  /** Kalem kampanyalarının KDV hariç toplamı. */
  satirNet: number
  /** Kalem kampanyalarının kendi KDV oranlarıyla KDV'si. */
  satirKdv: number
  /** Sipariş geneli kampanya payı (KDV dahil). */
  siparisGeneli: number
}

export type KampanyaliSonuc = IskontoSonuc & {
  /** Kampanyanın NET karşılığı — faturaya `CampaignDiscount` olarak yazılan. */
  kampanyaNet: number
  /** Elle girilen iskontonun NET karşılığı. */
  elleIskontoNet: number
}

/**
 * KAMPANYALI FATURA TOPLAMI — sunucudaki `CreateSalesInvoice` ile BİREBİR (2026-09-30).
 *
 * Kalem kampanyası brütten VE kendi oranıyla KDV'den düşülür; elle iskonto ile sipariş geneli
 * kampanya KDV DAHİL kalır ve kalan tabana `iskontoyuAyristir` ile uygulanır. Eskiden kalem
 * kampanyası da KDV dahil sayılıyordu; kampanyanın KDV'si müşteriden fazladan alınıyor, ekran
 * ve fatura siparişi tutmuyordu (A00000000072141: sipariş 16.800,00 — fatura 16.990,48).
 *
 * @param brut        Kalemlerin KDV hariç toplamı
 * @param brutKdv     Kalemlerin KDV'si, iskonto ve kampanya UYGULANMADAN (KDV'siz caride 0)
 * @param kampanya    Kampanyanın parçaları
 * @param elleIskonto Kullanıcının girdiği iskonto (KDV dahil)
 */
export function kampanyaliToplam(
  brut: number,
  brutKdv: number,
  kampanya: KampanyaAyrimi,
  elleIskonto: number
): KampanyaliSonuc {
  const sayi = (v: number) => {
    const n = Number(v)
    return Number.isFinite(n) && n > 0 ? n : 0
  }

  const b = sayi(brut)
  const k = sayi(brutKdv)
  const satirNet = Math.min(sayi(kampanya.satirNet), b)
  const satirKdv = Math.min(sayi(kampanya.satirKdv), k)
  const siparisGeneli = sayi(kampanya.siparisGeneli)

  const kalanBrut = b - satirNet
  const kalanKdv = k - satirKdv
  const kdvDahilIskonto = sayi(elleIskonto) + siparisGeneli
  const s = iskontoyuAyristir(kalanBrut, kalanKdv, kdvDahilIskonto)

  // Sipariş geneli kampanya, elle iskontoyla AYNI oranda net karşılığına çekilir.
  const uygulanan = Math.min(kdvDahilIskonto, kalanBrut + kalanKdv)
  const siparisGeneliNet = uygulanan > 0 ? Math.min(siparisGeneli, uygulanan) * (s.netIskonto / uygulanan) : 0

  const kampanyaNet = yuvarla(satirNet + siparisGeneliNet)
  const netIskonto = Math.max(0, yuvarla(b - s.netToplam))

  return {
    netToplam: s.netToplam,
    kdvToplam: s.kdvToplam,
    genelToplam: s.genelToplam,
    netIskonto,
    kampanyaNet,
    elleIskontoNet: Math.max(0, yuvarla(netIskonto - kampanyaNet))
  }
}
