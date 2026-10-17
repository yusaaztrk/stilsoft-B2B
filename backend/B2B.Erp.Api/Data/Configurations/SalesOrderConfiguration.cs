using B2B.Erp.Api.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace B2B.Erp.Api.Data.Configurations;

public sealed class SalesOrderConfiguration : IEntityTypeConfiguration<SalesOrder>
{
    public void Configure(EntityTypeBuilder<SalesOrder> builder)
    {
        builder.ToTable("SalesOrders");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.Id)
            .ValueGeneratedOnAdd();

        builder.Property(x => x.CustomerCode)
            .IsRequired()
            .HasMaxLength(50);

        builder.Property(x => x.DeliveryCustomerCode)
            .IsRequired()
            .HasMaxLength(50);

        // Teslimat adresi anlık görüntüsü — yalnızca e-ticaret yolunda dolar, bkz. SalesOrder.
        // Uzunluklar Program.cs'teki drift-fix DDL'iyle AYNI olmak zorunda; ayrışırsa EF'in
        // ürettiği sorgu ile tablodaki kolon boyu tutmaz.
        builder.Property(x => x.DeliveryName).HasMaxLength(200);
        builder.Property(x => x.DeliveryPhone).HasMaxLength(40);
        builder.Property(x => x.DeliveryAddress).HasMaxLength(500);
        builder.Property(x => x.DeliveryCity).HasMaxLength(120);
        builder.Property(x => x.DeliveryDistrict).HasMaxLength(120);

        builder.Property(x => x.Subtotal)
            .HasPrecision(18, 2);

        builder.Property(x => x.VatTotal)
            .HasPrecision(18, 2);

        builder.Property(x => x.GrandTotal)
            .HasPrecision(18, 2);

        builder.Property(x => x.Status);

        builder.Property(x => x.OrderNo)
            .IsRequired()
            .HasMaxLength(30);

        builder.HasIndex(x => x.OrderNo)
            .IsUnique();

        builder.Property(x => x.ProcessedBy)
            .IsRequired()
            .HasMaxLength(50);

        builder.Property(x => x.ProcessedAt);

        builder.HasMany(x => x.Lines)
            .WithOne(x => x.SalesOrder)
            .HasForeignKey(x => x.SalesOrderId)
            .OnDelete(DeleteBehavior.Cascade);

        AuditableEntityConfiguration.ConfigureAudit(builder);
    }
}
