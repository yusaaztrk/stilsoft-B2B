using B2B.Erp.Api.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace B2B.Erp.Api.Data.Configurations;

public sealed class InstallmentRuleConfiguration : IEntityTypeConfiguration<InstallmentRule>
{
    public void Configure(EntityTypeBuilder<InstallmentRule> builder)
    {
        builder.ToTable("InstallmentRules");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.Id)
            .ValueGeneratedNever();

        builder.Property(x => x.BankName)
            .IsRequired()
            .HasMaxLength(200);

        builder.Property(x => x.InstallmentText)
            .IsRequired()
            .HasMaxLength(2000);

        builder.Property(x => x.MinAmountText)
            .IsRequired()
            .HasMaxLength(2000);

        builder.Property(x => x.DescriptionText)
            .IsRequired()
            .HasMaxLength(4000);

        builder.Property(x => x.SortOrder)
            .IsRequired();

        builder.Property(x => x.IsActive)
            .IsRequired()
            .HasDefaultValue(true);

        builder.HasIndex(x => new { x.IsActive, x.SortOrder });

        builder.HasData(
            new InstallmentRule
            {
                Id = new Guid("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1"),
                BankName = "CREDITWEST BANK LTD.",
                InstallmentText = "0 TAKSİT\n3 TAKSİT",
                MinAmountText = "1\n250",
                DescriptionText = "1 TL VE ÜZERİ ÇEKİMLERDE UYGULANMAKTADIR.\n250 TL VE ÜZERİ ÇEKİMLERDE UYGULANMAKTADIR.",
                SortOrder = 1,
                IsActive = true
            },
            new InstallmentRule
            {
                Id = new Guid("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2"),
                BankName = "HALK BANKASI",
                InstallmentText = "TEK ÇEKİM\n3 TAKSİT",
                MinAmountText = "1\n1500",
                DescriptionText = "\n1500 TL VE ÜZERİ ÇEKİMLERDE UYGULANMAKTADIR.",
                SortOrder = 2,
                IsActive = true
            },
            new InstallmentRule
            {
                Id = new Guid("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3"),
                BankName = "K.T.KOOPMERKEZ BANKASI LTD.",
                InstallmentText = "TEK ÇEKİM",
                MinAmountText = "1",
                DescriptionText = "",
                SortOrder = 3,
                IsActive = true
            },
            new InstallmentRule
            {
                Id = new Guid("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4"),
                BankName = "T. GARANTİ BANKASI A.Ş.",
                InstallmentText = "3 TAKSİT\nTEK ÇEKİM",
                MinAmountText = "1500\n1",
                DescriptionText = "1500 TL VE ÜZERİ ÇEKİMLERDE UYGULANMAKTADIR.\n",
                SortOrder = 4,
                IsActive = true
            },
            new InstallmentRule
            {
                Id = new Guid("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5"),
                BankName = "T.C. ZİRAAT BANKASI A.Ş.",
                InstallmentText = "TEK ÇEKİM\n3 TAKSİT",
                MinAmountText = "1\n250",
                DescriptionText = "\n250 TL VE ÜZERİ ÇEKİMLERDE UYGULANMAKTADIR.",
                SortOrder = 5,
                IsActive = true
            },
            new InstallmentRule
            {
                Id = new Guid("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa6"),
                BankName = "TÜRKİYE İŞ BANKASI A.Ş.",
                InstallmentText = "TEK ÇEKİM\n3 TAKSİT",
                MinAmountText = "1\n1000",
                DescriptionText = "\n1000 TL VE ÜZERİ ÇEKİMLERDE UYGULANMAKTADIR.",
                SortOrder = 6,
                IsActive = true
            }
        );
    }
}
