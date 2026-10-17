using B2B.Erp.Api.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace B2B.Erp.Api.Data.Configurations;

public sealed class ServiceCatalogItemConfiguration : IEntityTypeConfiguration<ServiceCatalogItem>
{
    private static readonly DateTime SeedCreatedAt = new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc);

    public void Configure(EntityTypeBuilder<ServiceCatalogItem> builder)
    {
        builder.ToTable("ServiceCatalogItems");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.Id)
            .ValueGeneratedOnAdd();

        builder.Property(x => x.Code)
            .IsRequired()
            .HasMaxLength(50);

        builder.HasIndex(x => x.Code)
            .IsUnique();

        builder.Property(x => x.Name)
            .IsRequired()
            .HasMaxLength(200);

        builder.Property(x => x.IsActive)
            .IsRequired();

        // 0 = TL, tıpkı diğer para birimi kolonlarında olduğu gibi. Tohum kayıtları ve mevcut
        // satırlar bu varsayılanla TL kalır; yeni hizmet eklerken ekrandan seçilir.
        builder.Property(x => x.CurrencyTypeId)
            .IsRequired()
            .HasDefaultValue(0);

        AuditableEntityConfiguration.ConfigureAudit(builder);

        builder.HasData(
            new ServiceCatalogItem { Id = 1, Code = "HIZ-ELEKTRIK", Name = "ELEKTRIK SU MASRAF", IsActive = true, CreateUser = "System", CreateTime = SeedCreatedAt },
            new ServiceCatalogItem { Id = 2, Code = "HIZ-GUMRUK", Name = "GÜMRÜK MASRAFLARI", IsActive = true, CreateUser = "System", CreateTime = SeedCreatedAt },
            new ServiceCatalogItem { Id = 3, Code = "HIZ-IHTIYAT", Name = "IHTIYAT SANDIGI DAIRESI", IsActive = true, CreateUser = "System", CreateTime = SeedCreatedAt },
            new ServiceCatalogItem { Id = 4, Code = "HIZ-KIRA", Name = "VAKIFLAR IDARESI KIRA", IsActive = true, CreateUser = "System", CreateTime = SeedCreatedAt },
            new ServiceCatalogItem { Id = 5, Code = "HIZ-KLIMA", Name = "KLIMA MONTAJ", IsActive = true, CreateUser = "System", CreateTime = SeedCreatedAt },
            new ServiceCatalogItem { Id = 6, Code = "HIZ-MATBAA", Name = "MATBAA KIRTASIYE", IsActive = true, CreateUser = "System", CreateTime = SeedCreatedAt },
            new ServiceCatalogItem { Id = 7, Code = "HIZ-MUHASEBE", Name = "MUHASEBE", IsActive = true, CreateUser = "System", CreateTime = SeedCreatedAt },
            new ServiceCatalogItem { Id = 8, Code = "HIZ-MUHTELIF", Name = "MUHTELIF MASRAF", IsActive = true, CreateUser = "System", CreateTime = SeedCreatedAt },
            new ServiceCatalogItem { Id = 9, Code = "HIZ-MUTFAK", Name = "MUTFAK MASRAF", IsActive = true, CreateUser = "System", CreateTime = SeedCreatedAt },
            new ServiceCatalogItem { Id = 10, Code = "HIZ-NAKLIYE", Name = "NAKLIYE ÖDEMELER", IsActive = true, CreateUser = "System", CreateTime = SeedCreatedAt },
            new ServiceCatalogItem { Id = 11, Code = "HIZ-REKLAM", Name = "TABELA REKLAM STAND", IsActive = true, CreateUser = "System", CreateTime = SeedCreatedAt },
            new ServiceCatalogItem { Id = 12, Code = "HIZ-SERVIS", Name = "SERVIS YEDEK PARCA MALZEME", IsActive = true, CreateUser = "System", CreateTime = SeedCreatedAt },
            new ServiceCatalogItem { Id = 13, Code = "HIZ-SGK", Name = "SOSYAL SIGORTALAR DAIRESI", IsActive = true, CreateUser = "System", CreateTime = SeedCreatedAt },
            new ServiceCatalogItem { Id = 14, Code = "HIZ-SIGORTA", Name = "SIGORTA MASRAFLARI", IsActive = true, CreateUser = "System", CreateTime = SeedCreatedAt },
            new ServiceCatalogItem { Id = 15, Code = "HIZ-TAMIR", Name = "HIZ-TAMIR", IsActive = true, CreateUser = "System", CreateTime = SeedCreatedAt },
            new ServiceCatalogItem { Id = 16, Code = "HIZ-VDAIRESI", Name = "VERGİ DAİRESİ", IsActive = true, CreateUser = "System", CreateTime = SeedCreatedAt },
            new ServiceCatalogItem { Id = 17, Code = "HIZ-YEMEK", Name = "PERSONEL YEMEK", IsActive = true, CreateUser = "System", CreateTime = SeedCreatedAt }
        );
    }
}
