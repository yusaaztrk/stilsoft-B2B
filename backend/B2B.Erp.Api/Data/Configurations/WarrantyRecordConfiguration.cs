using B2B.Erp.Api.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace B2B.Erp.Api.Data.Configurations;

public sealed class WarrantyRecordConfiguration : IEntityTypeConfiguration<WarrantyRecord>
{
    public void Configure(EntityTypeBuilder<WarrantyRecord> builder)
    {
        builder.ToTable("WarrantyRecords");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.TransactionType)
            .IsRequired()
            .HasMaxLength(50);

        builder.Property(x => x.RecordDate)
            .IsRequired();

        builder.Property(x => x.WarrantyNo)
            .IsRequired()
            .HasMaxLength(50);

        builder.Property(x => x.CustomerCode)
            .IsRequired()
            .HasMaxLength(50);

        builder.Property(x => x.CustomerName)
            .IsRequired()
            .HasMaxLength(255);

        builder.Property(x => x.Status)
            .IsRequired()
            .HasMaxLength(50);

        builder.Property(x => x.GrossAmount)
            .HasPrecision(18, 2)
            .IsRequired();

        builder.Property(x => x.DiscountAmount)
            .HasPrecision(18, 2)
            .IsRequired();

        builder.Property(x => x.NetAmount)
            .HasPrecision(18, 2)
            .IsRequired();

        builder.Property(x => x.VatAmount)
            .HasPrecision(18, 2)
            .IsRequired();

        builder.Property(x => x.TotalAmount)
            .HasPrecision(18, 2)
            .IsRequired();

        builder.Property(x => x.SalesmanCode)
            .HasMaxLength(50);

        builder.Property(x => x.CreatedByUserName)
            .IsRequired()
            .HasMaxLength(255);

        builder.Property(x => x.SerialNo)
            .HasMaxLength(100);

        builder.Property(x => x.ProductCode)
            .IsRequired()
            .HasMaxLength(50);

        builder.Property(x => x.ProductName)
            .IsRequired()
            .HasMaxLength(255);

        builder.Property(x => x.BrandModel)
            .HasMaxLength(255);

        builder.Property(x => x.WarrantyStatus)
            .HasMaxLength(100);

        builder.Property(x => x.LastStatusDate)
            .IsRequired();

        builder.Property(x => x.FaultDescription)
            .HasMaxLength(2000);

        builder.Property(x => x.WarrantyPeriodMonths)
            .IsRequired();

        builder.Property(x => x.CompletedDate);

        AuditableEntityConfiguration.ConfigureAudit(builder);

        builder.HasMany(x => x.Histories)
            .WithOne(x => x.WarrantyRecord)
            .HasForeignKey(x => x.WarrantyRecordId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
