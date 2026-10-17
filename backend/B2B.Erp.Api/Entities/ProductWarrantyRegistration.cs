namespace B2B.Erp.Api.Entities;

public sealed class ProductWarrantyRegistration : AuditableEntity
{
    public int Id { get; set; }
    public Guid ProductId { get; set; }
    public string ProductCode { get; set; } = string.Empty;
    public string ProductName { get; set; } = string.Empty;
    public string SerialNumber { get; set; } = string.Empty;
    public string CustomerFullName { get; set; } = string.Empty;
    public string PhoneNumber { get; set; } = string.Empty;
    public string? Email { get; set; }
    public string? City { get; set; }
    public string? Description { get; set; }
    /// <summary>
    /// Buradaki başlangıç değeri KULLANILMAZ: kaydı açan uç bu alanı her zaman firmanın
    /// takvim gününden (<c>CompanyClock</c>) yazar. Varlık başlatıcısına saat dilimi
    /// enjekte edilemediği için UTC kaldı — "bugün"ün kaynağı burası sanılmasın (denetim md. D1).
    /// </summary>
    public DateTime WarrantyStartDate { get; set; } = DateTime.UtcNow.Date;
}
