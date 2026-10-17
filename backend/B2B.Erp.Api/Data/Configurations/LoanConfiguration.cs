using B2B.Erp.Api.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace B2B.Erp.Api.Data.Configurations;

public sealed class LoanConfiguration : IEntityTypeConfiguration<Loan>
{
    public void Configure(EntityTypeBuilder<Loan> builder)
    {
        builder.ToTable("Loans");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.LoanCode)
            .IsRequired()
            .HasMaxLength(30);

        builder.Property(x => x.ContractNo)
            .HasMaxLength(50);

        builder.Property(x => x.PrincipalAmount)
            .HasPrecision(18, 2)
            .IsRequired();

        builder.Property(x => x.CurrencyTypeId)
            .IsRequired();

        builder.Property(x => x.InterestRate)
            .HasPrecision(18, 6)
            .IsRequired();

        builder.Property(x => x.InterestRatePeriod)
            .IsRequired();

        builder.Property(x => x.InstallmentCount)
            .IsRequired();

        builder.Property(x => x.Fees)
            .HasPrecision(18, 2)
            .IsRequired()
            .HasDefaultValue(0m);

        // BSİV oranı — faiz üzerinden yüzde, taksit tutarına dahil.
        builder.Property(x => x.BsivRate)
            .HasPrecision(18, 6)
            .IsRequired()
            .HasDefaultValue(3m);

        // Bankanın belgesindeki taksit tutarı; 0 ise plan hesaplanarak üretilir.
        builder.Property(x => x.InstallmentAmount)
            .HasPrecision(18, 2)
            .IsRequired()
            .HasDefaultValue(0m);

        // Banka belgesindeki üst bilgi alanları. Hesaba girmezler; mutabakatta aranan
        // numaralar ve kredinin bankadaki tanımı burada duruyor.
        builder.Property(x => x.AccountNo).HasMaxLength(50);
        builder.Property(x => x.Iban).HasMaxLength(50);
        builder.Property(x => x.ProductName).HasMaxLength(100);
        builder.Property(x => x.CustomerCrmNo).HasMaxLength(50);
        builder.Property(x => x.PlanType).HasMaxLength(60);
        builder.Property(x => x.CapitalizePeriod).HasMaxLength(40);

        builder.Property(x => x.Description)
            .HasMaxLength(2000);

        builder.HasIndex(x => x.LoanCode).IsUnique();
        builder.HasIndex(x => new { x.BankAccountDefinitionId, x.StartDate });

        builder.HasOne(x => x.BankAccountDefinition)
            .WithMany()
            .HasForeignKey(x => x.BankAccountDefinitionId)
            .OnDelete(DeleteBehavior.Restrict);

        AuditableEntityConfiguration.ConfigureAudit(builder);
    }
}
