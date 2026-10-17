using B2B.Erp.Api.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace B2B.Erp.Api.Data.Configurations;

public sealed class CustomerConfiguration : IEntityTypeConfiguration<Customer>
{
    public void Configure(EntityTypeBuilder<Customer> builder)
    {
        builder.ToTable("Customers");

        builder.HasKey(x => x.CustomerCode);

        builder.Property(x => x.CustomerCode)
            .IsRequired()
            .HasMaxLength(50);

        builder.Property(x => x.Name)
            .IsRequired()
            .HasMaxLength(255);

        builder.Property(x => x.Address)
            .HasMaxLength(500);

        builder.Property(x => x.City)
            .HasMaxLength(100);

        builder.Property(x => x.District)
            .HasMaxLength(100);

        builder.Property(x => x.Phone)
            .HasMaxLength(50);

        builder.Property(x => x.Fax)
            .HasMaxLength(50);

        builder.Property(x => x.Email)
            .HasMaxLength(255);

        builder.Property(x => x.TaxOffice)
            .HasMaxLength(100);

        builder.Property(x => x.TaxNumber)
            .HasMaxLength(50);

        builder.Property(x => x.IdentityNumber)
            .HasMaxLength(50);

        builder.Property(x => x.CustomerType)
            .IsRequired()
            .HasMaxLength(50)
            .HasDefaultValue(string.Empty);

        builder.Property(x => x.InvoiceType)
            .IsRequired()
            .HasMaxLength(50)
            .HasDefaultValue(string.Empty);

        builder.Property(x => x.AccountRole)
            .IsRequired()
            .HasMaxLength(50)
            .HasDefaultValue(CustomerAccountRole.Normal);

        builder.Property(x => x.MainCustomerCode)
            .HasMaxLength(50);

        builder.HasOne(x => x.MainCustomer)
            .WithMany()
            .HasForeignKey(x => x.MainCustomerCode)
            .HasPrincipalKey(x => x.CustomerCode)
            .OnDelete(DeleteBehavior.Restrict);

        builder.HasIndex(x => x.MainCustomerCode)
            .IsUnique(false)
            .HasFilter("\"MainCustomerCode\" IS NOT NULL");

        builder.Ignore(x => x.InvoiceAccount);

        builder.Property(x => x.ProductCategory)
            .HasMaxLength(255);

        builder.Property(x => x.CategoryAccessMode)
            .HasDefaultValue(CategoryAccessMode.All);

        builder.Property(x => x.IsActive)
            .IsRequired()
            .HasDefaultValue(true);

        builder.Property(x => x.PriceGroupId);

        builder.HasOne(x => x.PriceGroupEntity)
            .WithMany()
            .HasForeignKey(x => x.PriceGroupId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.Property(x => x.DiscountRate)
            .IsRequired()
            .HasDefaultValue(0d);

        builder.Property(x => x.SalesmanCode)
            .HasMaxLength(50);

        builder.Property(x => x.CreditLimit)
            .IsRequired()
            .HasPrecision(18, 2)
            .HasDefaultValue(0m);

        // Para birimi başına ayrı limit (2026-08-19). Kolonlar Program.cs drift-fix
        // bloklarıyla ekleniyor; bkz. Customer entity'sindeki not.
        builder.Property(x => x.CreditLimitUsd)
            .IsRequired()
            .HasPrecision(18, 2)
            .HasDefaultValue(0m);

        builder.Property(x => x.CreditLimitEur)
            .IsRequired()
            .HasPrecision(18, 2)
            .HasDefaultValue(0m);

        builder.Property(x => x.CreditLimitGbp)
            .IsRequired()
            .HasPrecision(18, 2)
            .HasDefaultValue(0m);

        builder.Property(x => x.ParentCustomerCode)
            .HasMaxLength(50);

        builder.HasOne(x => x.ParentCustomer)
            .WithMany(x => x.ChildCustomers)
            .HasForeignKey(x => x.ParentCustomerCode)
            .HasPrincipalKey(x => x.CustomerCode)
            .OnDelete(DeleteBehavior.Restrict);

        builder.Property(x => x.CurrencyTypeId)
            .IsRequired()
            .HasDefaultValue(0);

        AuditableEntityConfiguration.ConfigureAudit(builder);
    }
}
