/**
 * Kasa / banka hareketinin GİRİŞ olup olmadığını söyler.
 *
 * NEDEN AYRI BİR YARDIMCI: `direction` alanı uçtan uca aynı biçimde gelmiyor.
 * Liste uçları enum'u METİN olarak veriyor (`"In"` / `"Out"`), yazma tarafı ise SAYI
 * kullanıyor (1 = giriş, 2 = çıkış). Rapor sayfaları `Number(x.direction) === 1` diye
 * bakıyordu; metin geldiğinde `Number("In")` NaN olduğu için **bütün hareketler çıkış**
 * sayılıyordu. Kasa Rapor Detay ekranında dört hareketin dördü de çıkış görünüyor ve
 * bakiye ters işaretli çıkıyordu (₺-351.600 yerine ₺348.600).
 *
 * Çalışan ekranlar (CashPage, BankPage) bu toleransı kendi içlerinde tekrarlıyordu;
 * tek kaynağa alındı.
 */
export function isInflowDirection(direction: unknown): boolean {
  if (typeof direction === 'number') {
    return direction === 1
  }

  const s = String(direction ?? '').trim().toLowerCase()
  return s === '1' || s === 'in' || s === 'giris' || s === 'giriş'
}

/** Hareketin ÇIKIŞ olup olmadığı. Bilinmeyen/boş değerler çıkış sayılmaz. */
export function isOutflowDirection(direction: unknown): boolean {
  if (typeof direction === 'number') {
    return direction === 2
  }

  const s = String(direction ?? '').trim().toLowerCase()
  return s === '2' || s === 'out' || s === 'cikis' || s === 'çıkış'
}
