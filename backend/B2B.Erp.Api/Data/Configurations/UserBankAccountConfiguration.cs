using B2B.Erp.Api.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace B2B.Erp.Api.Data.Configurations;

public sealed class UserBankAccountConfiguration : IEntityTypeConfiguration<UserBankAccount>
{
    public void Configure(EntityTypeBuilder<UserBankAccount> builder)
    {
        builder.ToTable("UserBankAccounts");

        builder.HasKey(x => new { x.UserId, x.BankAccountId });

        builder.HasOne(x => x.User)
            .WithMany(u => u.UserBankAccounts)
            .HasForeignKey(x => x.UserId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasOne(x => x.BankAccount)
            .WithMany()
            .HasForeignKey(x => x.BankAccountId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasIndex(x => x.BankAccountId);
    }
}
