namespace B2B.Erp.Api.Entities;

/// <summary>
/// Personel fotoğrafı (2026-10-16 kullanıcı isteği: maaş ödeme formundaki kişi resimleri programa alınacak).
///
/// <para>Ayrı tabloda durur, <c>Employees</c>'ta DEĞİL: o tablo ERP ile ortak ve her listede okunuyor;
/// fotoğraf baytı oraya girseydi her personel sorgusu megabaytlarca veri taşırdı. Personel başına tek
/// fotoğraf (anahtar = EmployeeId).</para>
/// </summary>
public sealed class EmployeePhoto
{
    public int EmployeeId { get; set; }
    public byte[] Data { get; set; } = Array.Empty<byte>();
    public string ContentType { get; set; } = "image/jpeg";
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    public string? UpdatedBy { get; set; }
}
