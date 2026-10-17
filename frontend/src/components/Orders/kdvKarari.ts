/**
 * SEPETTE KDV KARARI — TEK KAYNAK.
 *
 * Sepette bir satırın KDV'si eklenecek mi, fiyat net mi brüt mü sayılacak: bu karar iki ayrı
 * yerde (cartItems ve displayCartItems) kopyalanmış hâlde duruyordu ve her ikisi de eksik
 * bilgiyle TAHMİN yürütüyordu. Sonuç, 2026-08-24'te iki ayrı şikayet:
 *
 *  1. Fiyat grubu çözülemeyince fiyat "KDV dahil" sanılıp 1,16'ya bölünüyordu — aynı sepet
 *     rolden role farklı Genel Toplam gösteriyordu.
 *  2. Grup çözülemeyince fatura tipi "FATURA" varsayılıp KDV EKLENİYORDU — SERVİS HİZMET
 *     carisi (grup 4, AÇIK) müdür rolünde "700 + KDV", superadminde "700" görünüyordu.
 *     Doğrusu 700; grup 4 katalog fiyatıdır ve AÇIK tipte KDV eklenmez.
 *
 * Kural artık tek yerde ve BİLİNMEYEN durumu ayrı bir hâl olarak taşınıyor: bilinmiyorsa
 * hiçbir şey varsayılmıyor, fiyata dokunulmuyor ve çağıran taraf kullanıcıyı uyarıp sipariş
 * oluşturmayı kapatıyor.
 */

export type FaturaTipi = 'FATURA' | 'ACIK' | 'ASKERİYE' | 'BILINMIYOR'

export type FiyatGrubuBilgisi = {
  /**
   * KDV kararı verilebilir mi.
   *
   * DİKKAT — bu "grup bulundu mu" DEĞİL. Cariye hiç fiyat grubu atanmamış olabilir; o da
   * geçerli bir cevaptır ve karar verilebilir (FATURA sayılır, v28 öncesi davranış).
   * Burası yalnızca "cevabı HENÜZ ALAMADIK" durumunda false olmalı.
   *
   * İkisi v28'de karışmıştı: grubu boş olan cari "bilinmiyor" sayılıp KDV sessizce
   * düşüyordu — üstelik uyarı da çıkmıyordu, çünkü uyarı ayrı bir ölçüte bakıyordu.
   * Ekranda kesin görünen ama KDV'siz bir Genel Toplam kalıyordu.
   */
  cozuldu: boolean
  /** `PriceGroups.Code`. */
  kod?: number | null
  /** `PriceGroups.Formula` — `REMOVE_KDV` içeriyorsa fiyat NET saklanmış demektir. */
  formul?: string | null
  /** `PriceGroups.InvoiceType` — kod 4-6 dışındaki gruplar için tek ölçüt. */
  faturaTipi?: string | null
}

/**
 * Fatura tipini belirler.
 *
 * Sıra ÖNEMLİ ve kodun eski hâliyle aynı:
 *  - kod 7 → ASKERİYE (KDV uygulanmaz)
 *  - kod 4-6 → AÇIK (katalog/perakende fiyatı; KDV zaten fiyatın içinde, üstüne EKLENMEZ)
 *  - değilse grubun kendi `InvoiceType` alanı
 *  - o da boşsa FATURA
 *
 * Grup çözülemediyse **FATURA varsayılmaz**; `BILINMIYOR` döner. Eski kod burada FATURA
 * varsayıyordu ve AÇIK bir cariye KDV ekliyordu.
 */
export function faturaTipiBelirle(grup: FiyatGrubuBilgisi): FaturaTipi {
  if (!grup.cozuldu) return 'BILINMIYOR'

  const kod = Number(grup.kod ?? 0)
  if (Number.isFinite(kod) && kod === 7) return 'ASKERİYE'
  if (Number.isFinite(kod) && kod >= 4 && kod <= 6) return 'ACIK'

  const tip = String(grup.faturaTipi ?? '').trim().toUpperCase()
  if (tip === 'ACIK' || tip === 'AÇIK') return 'ACIK'
  if (tip === 'ASKERIYE' || tip === 'ASKERİYE') return 'ASKERİYE'
  return 'FATURA'
}

export type KdvKarari = {
  faturaTipi: FaturaTipi
  /** Fiyatın üstüne KDV eklenecek mi. */
  kdvEklenir: boolean
  /** Fiyat NET mi saklanmış (formülde REMOVE_KDV). Brütse KDV'ye bölünerek net bulunur. */
  fiyatZatenNet: boolean
  /** Karar eksik bilgiyle mi verildi — çağıran taraf kullanıcıyı uyarmalı. */
  belirsiz: boolean
}

/**
 * @param sadeceFiyat4Gosteriliyor Kullanıcı yalnızca Fiyat 4'ü görebiliyorsa ekrandaki fiyat
 *   perakende (KDV dahil) fiyattır; üstüne KDV eklenmez.
 */
export function kdvKarariVer(
  grup: FiyatGrubuBilgisi,
  sadeceFiyat4Gosteriliyor = false,
): KdvKarari {
  const faturaTipi = faturaTipiBelirle(grup)
  const belirsiz = faturaTipi === 'BILINMIYOR'

  // BİLİNMİYORSA HİÇBİR ŞEY YAPILMAZ: ne KDV eklenir ne fiyat bölünür. Ekrandaki rakam
  // fiyatın kendisi olur — en az dönüştürülmüş, dolayısıyla en az yanıltıcı değer. Sipariş
  // oluşturma bu sırada zaten kapalı.
  if (belirsiz) {
    return { faturaTipi, kdvEklenir: false, fiyatZatenNet: true, belirsiz: true }
  }

  const kdvEklenir = !sadeceFiyat4Gosteriliyor && faturaTipi === 'FATURA'

  /*
    FORMÜL BOŞSA BÖLME YAPILMAZ.

    Formül `REMOVE_KDV` içeriyorsa fiyat NET saklanmıştır, olduğu gibi kullanılır. Boş
    formül bir iş kuralı değil, VERİ EKSİKLİĞİDİR (grubu olmayan cari, listede karşılığı
    olmayan grup): orada fiyatı 1,16'ya bölmek, hiç bölmemekten daha yanlış bir toplam
    üretir. v28 öncesi kod da tam olarak böyle davranıyordu (`selectedPg ? ... : true`).
  */
  const formulMetni = String(grup.formul ?? '').trim().toUpperCase()
  const fiyatZatenNet = formulMetni.length === 0 || formulMetni.includes('REMOVE_KDV')

  return { faturaTipi, kdvEklenir, fiyatZatenNet, belirsiz: false }
}
