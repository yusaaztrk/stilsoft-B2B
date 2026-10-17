using B2B.Erp.Api.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace B2B.Erp.Api.Data.Configurations;

public sealed class UserCashAccountConfiguration : IEntityTypeConfiguration<UserCashAccount>
{
    public void Configure(EntityTypeBuilder<UserCashAccount> builder)
    {
        builder.ToTable("UserCashAccounts");

        builder.HasKey(x => new { x.UserId, x.CashAccountId });

        builder.HasOne(x => x.User)
            .WithMany(u => u.UserCashAccounts)
            .HasForeignKey(x => x.UserId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasOne(x => x.CashAccount)
            .WithMany()
            .HasForeignKey(x => x.CashAccountId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasIndex(x => x.CashAccountId);
    }
}
