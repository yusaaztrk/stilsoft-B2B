using System;

namespace ServiceOps.Domain.Entities;

/// <summary>
/// Girişi teknisyen kaydına bağlayan EŞLEME satırı — kimlik doğrulama kaydı DEĞİL.
///
/// Şifre ve rol burada TUTULMAZ. Tek kaynak B2B `Users` tablosudur: giriş oraya sorulur
/// (BCrypt), sayfa yetkileri `Users.RoleId → RolePagePermissions` üzerinden okunur. Burada
/// ikinci bir şifre (SHA256) ve ikinci bir rol daha duruyordu; ikisi tek bir işlemde birlikte
/// güncellenmediği için zamanla ayrışıyordu — şifre değiştirme uçlarından biri ServiceOps'u,
/// diğeri B2B'yi yazıyor, kullanıcı hangisinin geçerli olduğunu bilemiyordu.
///
/// Bu satırın taşıdığı tek bilgi: hangi kullanıcı adı hangi `Technician` kaydına ait. İşler,
/// bölge, araç deposu ve hak ediş o kayda bağlı olduğu için bu eşleme gerekli — ServiceOps ve
/// B2B ayrı veritabanlarında olduğundan doğrudan foreign key kurulamıyor.
/// </summary>
public class ServiceUser
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Username { get; set; } = string.Empty;

    public Guid? TechnicianId { get; set; }
    public Technician? Technician { get; set; }
    public string? TenantCode { get; set; }
    public string? DealerCode { get; set; }

    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }
    public DateTime? LastLoginAt { get; set; }
}
