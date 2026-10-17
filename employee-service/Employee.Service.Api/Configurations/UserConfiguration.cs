using B2B.Erp.Api.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace B2B.Erp.Api.Data.Configurations;

/// <summary>
/// ERP'nin <c>Users</c> tablosunun personel servisindeki salt okunur eşlemesi.
/// Tohumlama YOK ve alan kümesi bilerek dar — bkz. <see cref="User"/>.
/// </summary>
public sealed class UserConfiguration : IEntityTypeConfiguration<User>
{
    public void Configure(EntityTypeBuilder<User> builder)
    {
        builder.ToTable("Users");

        builder.HasKey(u => u.Id);

        builder.Property(u => u.Username).IsRequired().HasMaxLength(50);
        builder.Property(u => u.Password).IsRequired().HasMaxLength(500);
        builder.Property(u => u.Mail).IsRequired().HasMaxLength(255);
        builder.Property(u => u.Unvan).IsRequired().HasMaxLength(200);
        builder.Property(u => u.IsActive).IsRequired();
        builder.Property(u => u.EmployeeAccess).IsRequired();
        builder.Property(u => u.RoleId).IsRequired();
    }
}
