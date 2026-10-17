using B2B.Erp.Api.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace B2B.Erp.Api.Data.Configurations;

public sealed class LoanInstallmentConfiguration : IEntityTypeConfiguration<LoanInstallment>
{
    public void Configure(EntityTypeBuilder<LoanInstallment> builder)
    {
        builder.ToTable("LoanInstallments");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.InstallmentNo).IsRequired();
        builder.Property(x => x.DueDate).IsRequired();

        builder.Property(x => x.Amount)
            .HasPrecision(18, 2)
            .IsRequired();

        builder.Property(x => x.PrincipalPart)
            .HasPrecision(18, 2)
            .IsRequired()
            .HasDefaultValue(0m);

        builder.Property(x => x.InterestPart)
            .HasPrecision(18, 2)
            .IsRequired()
            .HasDefaultValue(0m);

        // BSİV faize eklenip geçilmiyor: ayrı kolonda durmazsa "ne kadarı faiz, ne kadarı
        // vergi" ayrımı bir daha yapılamaz.
        builder.Property(x => x.BsivPart)
            .HasPrecision(18, 2)
            .IsRequired()
            .HasDefaultValue(0m);

        // Aynı kredide aynı taksit numarası iki kez olamaz — plan yeniden üretilirken
        // eskisi silinmeden yazılırsa liste sessizce ikiye katlanırdı.
        builder.HasIndex(x => new { x.LoanId, x.InstallmentNo }).IsUnique();
        builder.HasIndex(x => x.DueDate);

        builder.HasOne(x => x.Loan)
            .WithMany(x => x.Installments)
            .HasForeignKey(x => x.LoanId)
            .OnDelete(DeleteBehavior.Cascade);

        AuditableEntityConfiguration.ConfigureAudit(builder);
    }
}
