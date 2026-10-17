namespace B2B.Erp.Api.Entities;

/// <summary>
/// GARANTİ DEPOSU AYARI — firma başına TEK satır (<see cref="Id"/> her zaman 1).
///
/// Arızalı ürünlerin toplandığı depo burada seçilir. Ayrı bir depo tipi/bayrağı eklenmedi:
/// garanti deposu sıradan bir depo, tek fark hangisi olduğunun seçilmiş olması. Depo tablosuna
/// bayrak eklemek "iki depo birden garanti deposu" gibi anlamsız bir hâli mümkün kılardı.
///
/// Tek satır kuralı veritabanında da zorlanıyor (<c>CHECK (""Id"" = 1)</c>): ikinci bir satır
/// "hangisi geçerli" sorusunu doğurur ve ekran sessizce yanlış depoya yazar.
/// </summary>
public sealed class WarrantyExchangeSetting : AuditableEntity
{
    public int Id { get; set; } = 1;

    /// <summary>Seçili garanti deposu. 0 = henüz seçilmedi; işlem ekranı o hâlde uyarı verir.</summary>
    public int WarehouseCode { get; set; }
}
