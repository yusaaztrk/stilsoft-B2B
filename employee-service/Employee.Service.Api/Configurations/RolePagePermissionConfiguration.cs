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
            ["invoice"] = Enumerable.Range(1, 13).Concat(new[] { 100, 102 }).ToArray(),
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

        // SuperAdmin: full access
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

        builder.HasData(rows);
    }
}
