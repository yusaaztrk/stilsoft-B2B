using System.Collections.Generic;
using System.Linq;
using B2B.Erp.Api.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace B2B.Erp.Api.Data.Configurations;

public sealed class RolePagePermissionConfiguration : IEntityTypeConfiguration<RolePagePermission>
{
    public void Configure(EntityTypeBuilder<RolePagePermission> builder)
    {
        builder.ToTable("RolePagePermissions");

        builder.HasKey(rp => rp.Id);

        builder.Property(rp => rp.CanAccess)
            .IsRequired()
            .HasDefaultValue(true);

        builder.HasIndex(rp => new { rp.RoleId, rp.PageId })
            .IsUnique();

        builder.HasOne(rp => rp.Role)
            .WithMany(r => r.PagePermissions)
            .HasForeignKey(rp => rp.RoleId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasOne(rp => rp.Page)
            .WithMany(p => p.RolePermissions)
            .HasForeignKey(rp => rp.PageId)
            .OnDelete(DeleteBehavior.Cascade);

        SeedDefaultPermissions(builder);
    }

    private static void SeedDefaultPermissions(EntityTypeBuilder<RolePagePermission> builder)
    {
        // Role IDs come from RoleConfiguration seed:
        // 1 SuperAdmin, 2 Yonetim, 3 Mudur, 4 MontajMudur, 5 ServisMudur, 6 Admin, 7 Muhasebe, 8 Bayi, 9 AltBayi, 10 Plasiyer, 11 ServisPersonel, 12 Kurumsal

        var moduleToRoles = new Dictionary<string, int[]>
        {
            // Banka İşlemleri
            ["bank"] = new[] { 6, 3, 2 },

            // Fatura İşlemleri
            ["invoice"] = new[] { 6, 9, 8, 12, 3, 10, 2 },

            // Kasa İşlemleri
            ["cash"] = new[] { 6, 9, 8, 3, 10, 2 },

            // Çek/Senet İşlemleri
            ["check"] = new[] { 6, 3, 2 },

            // Raporlar
            ["reports"] = new[] { 6, 7, 3, 10, 2 },

            // Servis İşlemleri
            ["service"] = new[] { 6, 9, 8, 4, 3, 10, 5, 11, 2 },

            // Sanayi POS
            ["pos"] = new[] { 6, 9, 8, 3, 10, 2 },

            // Kullanıcı İşlemleri
            ["users"] = new[] { 6, 2 }
        };

        // Pages seeded in PageConfiguration with deterministic incremental IDs.
        // Build permission rows for each page in each module.
        var pageIdsByModule = new Dictionary<string, int[]> 
        {
            ["invoice"] = Enumerable.Range(1, 13).Concat(new[] { 100, 101, 102, 103, 110, 111, 112, 113, 114, 120, 121, 122, 123, 130, 131, 132, 140, 160, 161 }).ToArray(),
            ["cash"] = Enumerable.Range(14, 2).ToArray(),
            ["pos"] = Enumerable.Range(16, 2).ToArray(),
            ["check"] = Enumerable.Range(18, 3).ToArray(),
            ["bank"] = new[] { 21 },
            ["service"] = Enumerable.Range(22, 4).ToArray(),
            ["reports"] = Enumerable.Range(26, 15).ToArray(),
            ["users"] = Enumerable.Range(41, 15).Concat(new[] { 400, 401 }).ToArray()
        };

        var rows = new List<RolePagePermission>();
        var id = 1;

        // SuperAdmin: full access.
        // DİKKAT: Bu blok kaldırılamaz. İki şeyi birden tutuyor:
        //   1) SuperAdmin (RoleId 1) rolünün sayfa yetkileri YALNIZCA bu tablodan gelir —
        //      PageAuthorizationFilter'da isSuperAdmin bypass'ı YOK, sadece SSA claim'i geçer.
        //      Blok kalkarsa yeni açılan her firmada superadmin hiçbir sayfayı açamaz.
        //   2) HasData kimlikleri sıralı üretiliyor; bu blok kalkınca sonraki BÜTÜN satırların
        //      Id'si kayıyor ve mevcut veritabanlarıyla tohum kimlikleri tutmuyor.
        foreach (var modulePages in pageIdsByModule.Values)
        {
            foreach (var pageId in modulePages)
            {
                rows.Add(new RolePagePermission { Id = id++, RoleId = 1, PageId = pageId, CanAccess = true });
            }
        }

        foreach (var (moduleKey, roleIds) in moduleToRoles)
        {
            if (!pageIdsByModule.TryGetValue(moduleKey, out var pageIds)) continue;

            foreach (var roleId in roleIds)
            {
                foreach (var pageId in pageIds)
                {
                    rows.Add(new RolePagePermission { Id = id++, RoleId = roleId, PageId = pageId, CanAccess = true });
                }
            }
        }

        // Fatura Dökümü tip görünürlükleri. SuperAdmin ve Yönetim ALIŞ dahil tüm tipleri görür;
        // Fatura Dökümü açık diğer varsayılan roller ALIŞ hariç tipleri görür.
        var invoiceListTypePageIds = new[] { 115, 116, 117, 118, 119 };
        foreach (var roleId in new[] { 1, 2 })
        {
            foreach (var pageId in invoiceListTypePageIds)
            {
                rows.Add(new RolePagePermission { Id = 30000 + (roleId * 100) + pageId, RoleId = roleId, PageId = pageId, CanAccess = true });
            }
        }

        foreach (var roleId in new[] { 3, 6, 8, 9, 10, 12 })
        {
            foreach (var pageId in invoiceListTypePageIds.Where(x => x != 118))
            {
                rows.Add(new RolePagePermission { Id = 30000 + (roleId * 100) + pageId, RoleId = roleId, PageId = pageId, CanAccess = true });
            }
        }
        // Manually seed permissions for the new "bildirimler" page (PageId = 56) to avoid shifting existing seed IDs
        rows.Add(new RolePagePermission { Id = 10001, RoleId = 1, PageId = 56, CanAccess = true }); // SuperAdmin
        rows.Add(new RolePagePermission { Id = 10002, RoleId = 6, PageId = 56, CanAccess = true }); // Admin
        rows.Add(new RolePagePermission { Id = 10003, RoleId = 2, PageId = 56, CanAccess = true }); // Yonetim

        // BİLDİRİM ALMA (PageId = 403): HER role açık.
        // Bildirim almak bir ayrıcalık değil; kendisine iş atanan herkesin görmesi gerekiyor.
        for (int r = 1; r <= 12; r++)
        {
            rows.Add(new RolePagePermission { Id = 20000 + r, RoleId = r, PageId = 403, CanAccess = true });
        }

        // BİLDİRİM GÖNDERME (PageId = 404): ŞİMDİLİK HİÇBİR ROLE AÇIK DEĞİL.
        //
        // Eskiden Yönetim (2), Müdür (3) ve Servis Müdürü (5) rollerine tohumlanıyordu; kullanıcı
        // isteğiyle kapatıldı. Kapalı olması "yok" demek değil — Rol Yetkileri ekranından
        // istenen role istenildiği zaman açılabilir; burada satır YAZMAMAK, o ekranın kararını
        // her açılışta ezmemek demek.
        //
        // SSA'nın gönderme hakkı bu tablodan GELMİYOR: süper admin kontrolü kodda
        // (isSuperAdmin bypass). Kullanıcının "sadece SSA hardcode olsun" isteği bu.

        // Manually seed permissions for the new "accountingSalesReport" page (PageId = 500)
        rows.Add(new RolePagePermission { Id = 10011, RoleId = 1, PageId = 500, CanAccess = true }); // SuperAdmin
        rows.Add(new RolePagePermission { Id = 10012, RoleId = 6, PageId = 500, CanAccess = true }); // Admin
        rows.Add(new RolePagePermission { Id = 10013, RoleId = 2, PageId = 500, CanAccess = true }); // Yonetim

        // Seed permissions for "userActivities" (PageId = 405)
        rows.Add(new RolePagePermission { Id = 10031, RoleId = 1, PageId = 405, CanAccess = true }); // SuperAdmin
        rows.Add(new RolePagePermission { Id = 10032, RoleId = 6, PageId = 405, CanAccess = true }); // Admin
        rows.Add(new RolePagePermission { Id = 10033, RoleId = 2, PageId = 405, CanAccess = true }); // Yonetim
        rows.Add(new RolePagePermission { Id = 10034, RoleId = 3, PageId = 405, CanAccess = true }); // Mudur

        // Seed permissions for "systemErrorLogs" (PageId = 406)
        rows.Add(new RolePagePermission { Id = 10041, RoleId = 1, PageId = 406, CanAccess = true }); // SuperAdmin
        rows.Add(new RolePagePermission { Id = 10042, RoleId = 6, PageId = 406, CanAccess = true }); // Admin
        rows.Add(new RolePagePermission { Id = 10043, RoleId = 2, PageId = 406, CanAccess = true }); // Yonetim

        builder.HasData(rows);
    }
}


