/**
 * Banka hesabı türleri — tek kaynak.
 *
 * Değerler `BankAccountDefinition.AccountType` kolonundan gelir. Hesap tanımı ekranı
 * (`BankAccountDefinitionsPage`) ve banka raporu kendi listelerini "0 vadesiz hesap" gibi
 * numara önekli etiketlerle tutuyor; buradaki etiketler SEÇİM kutuları içindir, o yüzden
 * numarasız ve okunur.
 *
 * Yeni bir tür eklenirse ÜÇ YERE birden eklenmeli — aksi halde hesap tanımlanabilir ama
 * Havale/EFT ekranındaki tür süzgecinde görünmez:
 *   1. bu dosya                                (Havale/EFT tür seçici — numarasız etiket)
 *   2. `pages/BankAccountDefinitionsPage.tsx`  (hesap tanımı — "300 şirket kredi kartı" düzeni)
 *   3. `pages/BankaRaporlariReport.tsx`        (rapor — kendi gruplama sözcükleri, bilerek farklı;
 *                                               orada 14 "Kredi Kartları" diye geçer)
 *
 * Kodun anlam yüklediği türler: 3 teminat (çek cirosu), 14 POS (fatura tahsilatı ve süpürme).
 * 300 şirket kredi kartı bunların hiçbirine girmez — yalnızca sınıflandırma.
 */
export const BANK_ACCOUNT_TYPES: Array<{ value: number; label: string }> = [
  { value: 0, label: 'Vadesiz Hesap' },
  { value: 3, label: 'Teminat Hesabı' },
  { value: 7, label: 'Kredi Hesabı' },
  { value: 20, label: 'Taksitli Kredi Hesabı' },
  { value: 14, label: 'POS Hesabı' },
  { value: 300, label: 'Şirket Kredi Kartı' }
]

export function bankAccountTypeLabel(v: any): string {
  const n = Number(v ?? 0)
  return BANK_ACCOUNT_TYPES.find((x) => x.value === n)?.label ?? `Tür ${n}`
}
