/**
 * MONTAJ LİSTESİNDEKİ "BAYİ" SÜTUNU İÇİN TEK BİÇİM (2026-09-22).
 *
 * <b>Sorun:</b> Aynı sütunda dört ayrı biçim görünüyordu:
 *   [120-01-000865] FATİH GÜNER TİCARET LTD.   ← eski biçim
 *   FATİH GÜNER TİCARET LTD. (120-01-000885)   ← `formatCariLabel` (güncel)
 *   120-01-000959-1                            ← ad hiç gelmemiş, KOD yazılmış
 *   Çağatay koç                                ← elle yazılmış, kod yok
 *
 * <b>Sebebi kayıt anında:</b> `Installations.DealerName` düz metin bir sütun; liste
 * okunurken cariye bakılmıyor, kayıt oluşurken ne yazıldıysa o donuyor. İki yerde de
 * ad gelmediğinde KOD ada yazılıyor:
 *   ServiceOps `MontajController.cs:243`  -> `Trimmed(req.DealerName) ?? Trimmed(req.DealerCode)`
 *   ERP        `InvoicesController.cs:3729` -> ad boşsa `invoice.CustomerCode`
 * ERP'de adı cariden çeken bir yol da var (`InvoicesController.cs:6280`); bir akış adı
 * çözüyor, diğeri çözmüyor — ekrandaki karışıklığın kaynağı bu.
 *
 * <b>Bu dosya neyi çözer, neyi çözmez:</b> GÖRÜNÜMÜ tek biçime indirir. Kaydedilmemiş bir
 * adı UYDURMAZ — ad yoksa kodu dürüstçe kod olarak gösterir. Adın kalıcı olarak dolması
 * backend işi (yazarken cariden çekmek + mevcut kayıtlar için tek seferlik düzeltme).
 */

/**
 * Cari kodu kalıbı: rakam grupları, aralarında tire.
 * `120-01-000865`, `01-000576-003`, `120-07-000016` ve alt hesaplı `120-01-000959-1`
 * biçimlerinin hepsini karşılıyor. En az üç grup şartı, "3 Cam" gibi ürün metinlerinin
 * yanlışlıkla kod sayılmasını önlüyor.
 */
const KOD_KALIBI = /^\d{1,4}(?:-\d{1,6}){2,}$/

export function cariKoduMu(metin: string): boolean {
  return KOD_KALIBI.test(metin.trim())
}

/** `120-01-000626-1` → `120-01-000626`. Alt hesap eki (1–2 hane) yoksa kod aynen döner. */
export function anaCariKodu(kod: string): string {
  const k = kod.trim()
  return /^\d{1,4}-\d{1,6}-\d{3,}-\d{1,2}$/.test(k) ? k.replace(/-\d{1,2}$/, '') : k
}

export type BayiEtiket = {
  /** Ekranda birinci satır. Ad yoksa boş döner. */
  ad: string
  /** İkinci satır (soluk). Kod yoksa boş döner. */
  kod: string
  /** Ad hiç bilinmiyor; ekranda yalnız kod var. Satırı ayırt etmek için. */
  adYok: boolean
}

/**
 * Kayıttaki serbest metni ve (varsa) ayrı gelen kodu tek biçime indirir.
 *
 * `dealerCode` liste ucundan AYRI geliyor ve daha güvenilir: metin elle yazılmış olabilir
 * ama kod kaydın kendi alanı. Bu yüzden kod çakışırsa `dealerCode` esas alınıyor.
 */
export function bayiEtiketi(dealerName?: string | null, dealerCode?: string | null): BayiEtiket {
  const ham = String(dealerName ?? '').trim()
  const ayriKod = String(dealerCode ?? '').trim()

  let ad = ham
  let kod = ayriKod

  if (ham) {
    // "[120-01-000865] FATİH GÜNER TİCARET LTD."
    const koseli = ham.match(/^\[([^\]]+)\]\s*(.*)$/)
    if (koseli) {
      const icerik = koseli[1].trim()
      if (cariKoduMu(icerik)) {
        if (!kod) kod = icerik
        ad = koseli[2].trim()
      }
    } else {
      // "FATİH GÜNER TİCARET LTD. (120-01-000885)"
      // Parantez SONDA olmalı: "AURASAN TİCARET LİMİTED (GİRNE)" gibi şube ekleri
      // kod kalıbına uymadığı için zaten adın parçası olarak kalıyor.
      const parantezli = ham.match(/^(.*?)\s*\(([^()]+)\)\s*$/)
      if (parantezli && cariKoduMu(parantezli[2])) {
        if (!kod) kod = parantezli[2].trim()
        ad = parantezli[1].trim()
      }
    }
  }

  // Geriye kalan metnin kendisi bir kodsa, o ad değil koddur.
  if (ad && cariKoduMu(ad)) {
    if (!kod) kod = ad
    ad = ''
  }

  return { ad, kod, adYok: ad.length === 0 }
}

/** Tek satıra sığdırmak gerektiğinde (dışa aktarma, arama, başlık) kullanılır. */
export function bayiTekSatir(dealerName?: string | null, dealerCode?: string | null): string {
  const { ad, kod } = bayiEtiketi(dealerName, dealerCode)
  if (ad && kod) return `${ad} (${kod})`
  return ad || kod || '-'
}
