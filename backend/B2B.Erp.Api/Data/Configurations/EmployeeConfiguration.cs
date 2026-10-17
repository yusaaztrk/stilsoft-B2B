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
            .IsRequired()
            .HasMaxLength(20);

        builder.Property(x => x.FirstName)
            .IsRequired()
            .HasMaxLength(100);

        builder.Property(x => x.LastName)
            .IsRequired()
            .HasMaxLength(100);

        builder.Property(x => x.Mail)
            .IsRequired()
            .HasMaxLength(200);

        builder.Property(x => x.Tc)
            .IsRequired()
            .HasMaxLength(20);

        builder.Property(x => x.Phone)
            .IsRequired()
            .HasMaxLength(30);

        builder.Property(x => x.TaxNo)
            .IsRequired()
            .HasMaxLength(30);

        builder.Property(x => x.TaxOffice)
            .IsRequired()
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
            .HasDefaultValue(0m);

        builder.Property(x => x.SalaryDay)
            .IsRequired()
            .HasDefaultValue(1);

        builder.Property(x => x.MealAmount)
            .HasPrecision(18, 2)
            .IsRequired()
            .HasDefaultValue(0m);

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

        AuditableEntityConfiguration.ConfigureAudit(builder);
    }
}
