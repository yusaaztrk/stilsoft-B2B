using B2B.Erp.Api.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace B2B.Erp.Api.Data.Configurations;

public sealed class IrsaliyeConfiguration : IEntityTypeConfiguration<Irsaliye>
{
    public void Configure(EntityTypeBuilder<Irsaliye> builder)
    {
        builder.ToTable("Irsaliye");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.Id)
            .ValueGeneratedOnAdd();

        builder.Property(x => x.IrsaliyeNo)
            .IsRequired()
            .HasMaxLength(50);

        builder.Property(x => x.CustomerCode)
            .IsRequired()
            .HasMaxLength(50);

        builder.HasOne(x => x.Customer)
            .WithMany()
            .HasForeignKey(x => x.CustomerCode)
            .HasPrincipalKey(x => x.CustomerCode)
            .OnDelete(DeleteBehavior.Restrict);

        builder.Property(x => x.ProductId)
            .IsRequired();

        builder.HasOne(x => x.Product)
            .WithMany()
            .HasForeignKey(x => x.ProductId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.Property(x => x.Quantity)
            .IsRequired()
            .HasPrecision(18, 2);

        builder.Property(x => x.ShippedQuantity)
            .HasPrecision(18, 2);

        builder.Property(x => x.Description)
            .HasMaxLength(2000);

        builder.Property(x => x.Date)
            .IsRequired();

        builder.Property(x => x.Status)
            .IsRequired()
            .HasDefaultValue(IrsaliyeStatus.Beklemede);

        builder.Property(x => x.TransferredSalesOrderId);

        builder.Property(x => x.CreateUserRole)
            .IsRequired()
            .HasMaxLength(50)
            .HasDefaultValue(string.Empty);

        AuditableEntityConfiguration.ConfigureAudit(builder);

        builder.HasIndex(x => x.IrsaliyeNo);
        builder.HasIndex(x => new { x.CustomerCode, x.Date });
        builder.HasIndex(x => x.TransferredSalesOrderId);
    }
}
