/**
 * Ekstre kalem satırındaki "Açıklama" hücresi boşken ne yazılacağı.
 *
 * İade faturasının kalemlerinde açıklama girilmiyor — ekranda tek başına `-` kalıyor ve
 * satırın bir İADE olduğu, üst satıra bakmadan anlaşılmıyordu (kullanıcı bildirimi
 * 2026-08-20). Boş hücreye belgenin NİTELİĞİ yazılıyor.
 *
 * Yalnız iade için: her boş açıklamaya "İade" yazmak, açıklaması olmayan normal satış
 * faturası kalemini de iade gibi gösterirdi. Kalemin kendi açıklaması varsa ona
 * DOKUNULMAZ — bu bir yedek, bir ezme değil.
 *
 * İki ekstre ekranı (cari + yönetim) aynı tabloyu basıyor; kural burada TEK yerde durur
 * ki biri düzeltilip diğeri unutulmasın.
 */
export function ekstreLineDescriptionFallback(transactionType: unknown): string {
  const t = String(transactionType ?? '').toLocaleLowerCase('tr')
  return t.includes('iade') ? 'İade' : ''
}
