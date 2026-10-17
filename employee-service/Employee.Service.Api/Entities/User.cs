namespace B2B.Erp.Api.Entities;

/// <summary>
/// Kiracı veritabanındaki ERP kullanıcısı — personel servisi için SALT OKUNUR.
///
/// <para>Bu servis kullanıcı YAZMAZ; tablonun sahibi ERP (<c>backend/B2B.Erp.Api</c>) ve
/// şeması oranın <c>Program.cs</c> drift-fix bloklarıyla taşınıyor. Burada yalnızca portala
/// yönetici olarak giriş yapabilmek için gereken alanlar var; ERP'nin <c>User</c> varlığındaki
/// diğer kolonlar (cari kapsamı, depo, iskonto...) bu servisi ilgilendirmiyor.</para>
///
/// <para>Sadece bu alanları eşlemek güvenli: EF eşlenmemiş kolonu SELECT etmez, tabloya
/// yazmadığımız için de eksik alan bir kısıt ihlali doğurmaz.</para>
/// </summary>
public sealed class User
{
    public int Id { get; set; }
    public string Username { get; set; } = string.Empty;
    public string Password { get; set; } = string.Empty;
    public string Mail { get; set; } = string.Empty;
    public string Unvan { get; set; } = string.Empty;
    public bool IsActive { get; set; }

    /// <summary>
    /// Portala YÖNETİCİ olarak girme izni. ERP'deki kullanıcı düzenleme ekranındaki
    /// "Çalışan Yönetimi" kutusu. Süper admin bypass'ı BİLEREK yok: kutu işaretlenmeden
    /// kimse giremez.
    /// </summary>
    public bool EmployeeAccess { get; set; }

    public int RoleId { get; set; }
}
