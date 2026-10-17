using B2B.Erp.Api.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace B2B.Erp.Api.Data.Configurations;

public sealed class WarehouseConfiguration : IEntityTypeConfiguration<Warehouse>
{
    public void Configure(EntityTypeBuilder<Warehouse> builder)
    {
        builder.ToTable("Warehouses");

        builder.HasKey(x => x.WarehouseCode);

        builder.Property(x => x.WarehouseCode)
            .IsRequired();

        builder.Property(x => x.Name)
            .HasMaxLength(255);

        builder.Property(x => x.SalesmanCode)
            .HasMaxLength(50);

        builder.Property(x => x.IsVehicle)
            .IsRequired()
            .HasDefaultValue(false);

        builder.Property(x => x.Plate)
            .HasMaxLength(30);

        builder.Property(x => x.DriverName)
            .HasMaxLength(100);

        builder.Property(x => x.VehicleType)
            .HasMaxLength(50);

        builder.Property(x => x.VehicleModel)
            .HasMaxLength(100);

        builder.Property(x => x.NegativeBalanceControl)
            .IsRequired()
            .HasDefaultValue(false);

        builder.Property(x => x.IsActive)
            .IsRequired()
            .HasDefaultValue(true);

        AuditableEntityConfiguration.ConfigureAudit(builder);
    }
}
