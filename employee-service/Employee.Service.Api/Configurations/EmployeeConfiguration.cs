using B2B.Erp.Api.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace B2B.Erp.Api.Data.Configurations;

public sealed class EmployeeConfiguration : IEntityTypeConfiguration<Employee>
{
    public void Configure(EntityTypeBuilder<Employee> builder)
    {
        builder.ToTable("Employees");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.Id)
            .ValueGeneratedOnAdd();

        builder.Property(x => x.EmployeeCode)
            .IsRequired(false)
            .HasMaxLength(20);

        builder.Property(x => x.FirstName)
            .IsRequired(false)
            .HasMaxLength(100);

        builder.Property(x => x.LastName)
            .IsRequired(false)
            .HasMaxLength(100);

        builder.Property(x => x.Mail)
            .IsRequired(false)
            .HasMaxLength(200);

        builder.Property(x => x.Tc)
            .IsRequired(false)
            .HasMaxLength(20);

        builder.Property(x => x.Phone)
            .IsRequired(false)
            .HasMaxLength(30);

        builder.Property(x => x.TaxNo)
            .IsRequired(false)
            .HasMaxLength(30);

        builder.Property(x => x.TaxOffice)
            .IsRequired(false)
            .HasMaxLength(100);

        builder.Property(x => x.BankName)
            .IsRequired(false)
            .HasMaxLength(120);

        builder.Property(x => x.Iban)
            .IsRequired(false)
            .HasMaxLength(34);

        builder.Property(x => x.HireDate)
            .IsRequired(false);

        builder.Property(x => x.WorkPermitRenewalFee)
            .HasPrecision(18, 2)
            .IsRequired()
            .HasDefaultValue(0m);

        builder.Property(x => x.Salary)
            .HasPrecision(18, 2)
            .IsRequired()
            .HasDefaultValue(50000m);

        builder.Property(x => x.SalaryDay)
            .IsRequired()
            .HasDefaultValue(1);

        builder.Property(x => x.MealAmount)
            .HasPrecision(18, 2)
            .IsRequired()
            .HasDefaultValue(7000m);

        builder.Property(x => x.WorkType)
            .IsRequired(false)
            .HasMaxLength(80);

        builder.Property(x => x.IsActive)
            .IsRequired()
            .HasDefaultValue(true);

        builder.HasIndex(x => x.Tc)
            .IsUnique();

        builder.HasIndex(x => x.EmployeeCode)
            .IsUnique();

        builder.Property(x => x.TerminationReason)
            .HasMaxLength(200);

        builder.Property(x => x.PassportNo).HasMaxLength(30);
        builder.Property(x => x.Nationality).HasMaxLength(60);
        builder.Property(x => x.BirthPlace).HasMaxLength(120);
        builder.Property(x => x.ProvidentFundNo).HasMaxLength(40);
        builder.Property(x => x.SocialSecurityNo).HasMaxLength(40);
        builder.Property(x => x.SsdNo).HasMaxLength(40);
        builder.Property(x => x.Address).HasMaxLength(500);
        builder.Property(x => x.AddressDetail).HasMaxLength(200);

        builder.HasOne(x => x.WorkScheduleSetting)
            .WithMany()
            .HasForeignKey(x => x.WorkScheduleSettingId)
            .OnDelete(DeleteBehavior.SetNull);

        AuditableEntityConfiguration.ConfigureAudit(builder);
    }
}
