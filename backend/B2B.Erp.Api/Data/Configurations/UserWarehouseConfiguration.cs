using B2B.Erp.Api.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace B2B.Erp.Api.Data.Configurations;

public sealed class UserWarehouseConfiguration : IEntityTypeConfiguration<UserWarehouse>
{
    public void Configure(EntityTypeBuilder<UserWarehouse> builder)
    {
        builder.ToTable("UserWarehouses");

        builder.HasKey(x => new { x.UserId, x.WarehouseCode });

        builder.HasOne(x => x.User)
            .WithMany(u => u.UserWarehouses)
            .HasForeignKey(x => x.UserId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasOne(x => x.Warehouse)
            .WithMany()
            .HasForeignKey(x => x.WarehouseCode)
            .HasPrincipalKey(x => x.WarehouseCode)
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasIndex(x => x.WarehouseCode);
    }
}
