using System;

namespace B2B.Erp.Api.Entities;

public sealed class DeletionLog : AuditableEntity
{
    public int Id { get; set; }

    public string ModuleKey { get; set; } = string.Empty;
    public string PageKey { get; set; } = string.Empty;

    public string RecordType { get; set; } = string.Empty;
    public string RecordId { get; set; } = string.Empty;

    public string? ParentType { get; set; }
    public string? ParentId { get; set; }

    public string? Description { get; set; }
    public string? DetailsJson { get; set; }

    /// <summary>
    /// SİLME NEDENİ (2026-10-04 kullanıcı isteği: "silerken neden siliniyor diye sorulsun, neden
    /// Silinen Kayıtlar'da dursun"). Ekran silme isteğine <c>X-Delete-Reason</c> başlığıyla
    /// yollar; <c>AppDbContext.StampDeletionReasons</c> bu istekte eklenen her kayda yazar.
    /// Başlıksız silmelerde (servis/otomatik işler, eski istemci) boş kalır — silme ENGELLENMEZ.
    /// </summary>
    public string? Reason { get; set; }
}
