/**
 * DURUM TARİHİ — kaydın bugünkü durumuna ne zaman geçtiği (2026-09-18 kullanıcı isteği:
 * "durum sütununda altta o duruma alınma tarihi de gelsin; iptal ise iptal tarihi").
 *
 * Kapanmış kayıtta `completedAt`, diğerlerinde `updatedAt` okunur; ikisi de yoksa kaydın
 * açılış tarihine düşülür — boş hücre "tarih yok" gibi görünüp kullanıcıyı yanıltıyordu.
 *
 * ÖNEMLİ: geriye dönük işlenen işte (Kalem İşlemi'ndeki "İşlem Tarihi") sunucu bu damgaları
 * SEÇİLEN güne yazıyor. Yani kullanıcı işi ayın 25'ine işlediyse listede de 25 görünür.
 */
export function kayitDurumTarihi(row: any): string {
  const ham = row?.completedAt ?? row?.updatedAt ?? row?.createdAt ?? null
  if (!ham) return ''
  const d = new Date(String(ham))
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('tr-TR')
}
