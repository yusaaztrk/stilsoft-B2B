namespace B2B.Erp.Api.Core.Enums;

public enum RoleType
{
    SuperAdmin = 0,
    Yonetim = 1,
    Mudur = 2,
    MontajMudur = 3,
    ServisMudur = 4,
    Admin = 5,
    Muhasebe = 6,
    Bayi = 7,
    AltBayi = 8,
    Plasiyer = 9,
    ServisPersonel = 10,
    Klima = 11,
    Kurumsal = 12
}

public static class RoleTypeExtensions
{
    public static string GetDisplayName(this RoleType roleType)
    {
        return roleType switch
        {
            RoleType.SuperAdmin => "Süper Admin",
            RoleType.Yonetim => "Yönetim",
            RoleType.Mudur => "Müdür",
            RoleType.MontajMudur => "Montaj Müdürü",
            RoleType.ServisMudur => "Servis Müdürü",
            RoleType.Admin => "Admin",
            RoleType.Muhasebe => "Muhasebe",
            RoleType.Bayi => "Bayi",
            RoleType.AltBayi => "Alt Bayi",
            RoleType.Plasiyer => "Plasiyer",
            RoleType.ServisPersonel => "Servis Personeli",
            RoleType.Klima => "Klima",
            RoleType.Kurumsal => "Kurumsal",
            _ => roleType.ToString()
        };
    }
    
    public static bool HasPermission(this RoleType userRole, RoleType requiredRole)
    {
        return (int)userRole <= (int)requiredRole;
    }
    
    public static bool IsManagerLevel(this RoleType roleType)
    {
        return roleType is 
            RoleType.SuperAdmin or 
            RoleType.Yonetim or 
            RoleType.Mudur or 
            RoleType.MontajMudur or 
            RoleType.ServisMudur or 
            RoleType.Admin;
    }
}