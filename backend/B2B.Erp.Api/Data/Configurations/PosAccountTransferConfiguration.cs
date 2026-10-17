using B2B.Erp.Api.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace B2B.Erp.Api.Data.Configurations;

public sealed class PosAccountSettingConfiguration : IEntityTypeConfiguration<PosAccountSetting>
{
    public void Configure(EntityTypeBuilder<PosAccountSetting> builder)
    {
        builder.ToTable("PosAccountSettings");
        builder.HasKey(x => x.Id);

        // One setting per POS account: two rows pointing at the same account would give the
        // sweep two destinations for the same money.
        builder.HasIndex(x => x.PosBankAccountDefinitionId).IsUnique();

        builder.Property(x => x.TransferTime).IsRequired();
        builder.Property(x => x.IsAutoTransferEnabled).HasDefaultValue(true);
        builder.Property(x => x.IsActive).HasDefaultValue(true);
        builder.Property(x => x.CreateUser).HasMaxLength(50).IsRequired();
        builder.Property(x => x.EditUser).HasMaxLength(50);

        builder.HasOne(x => x.PosBankAccountDefinition)
            .WithMany()
            .HasForeignKey(x => x.PosBankAccountDefinitionId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.HasOne(x => x.TargetBankAccountDefinition)
            .WithMany()
            .HasForeignKey(x => x.TargetBankAccountDefinitionId)
            .OnDelete(DeleteBehavior.Restrict);
    }
}

public sealed class PosAccountTransferConfiguration : IEntityTypeConfiguration<PosAccountTransfer>
{
    public void Configure(EntityTypeBuilder<PosAccountTransfer> builder)
    {
        builder.ToTable("PosAccountTransfers");
        builder.HasKey(x => x.Id);

        // A day is settled once. Without this a retrying scheduler — or two servers — could
        // sweep the same day twice and move the money twice.
        builder.HasIndex(x => new { x.PosBankAccountDefinitionId, x.TransferDate }).IsUnique();

        builder.Property(x => x.Amount).HasPrecision(18, 2);
        builder.Property(x => x.CreateUser).HasMaxLength(50).IsRequired();
        builder.Property(x => x.EditUser).HasMaxLength(50);

        builder.HasOne(x => x.PosBankAccountDefinition)
            .WithMany()
            .HasForeignKey(x => x.PosBankAccountDefinitionId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.HasOne(x => x.TargetBankAccountDefinition)
            .WithMany()
            .HasForeignKey(x => x.TargetBankAccountDefinitionId)
            .OnDelete(DeleteBehavior.Restrict);
    }
}

public sealed class PosAccountTransferItemConfiguration : IEntityTypeConfiguration<PosAccountTransferItem>
{
    public void Configure(EntityTypeBuilder<PosAccountTransferItem> builder)
    {
        builder.ToTable("PosAccountTransferItems");
        builder.HasKey(x => x.Id);

        // A movement belongs to at most one sweep; settling it twice would double-count it.
        builder.HasIndex(x => x.BankAccountTransactionId).IsUnique();
        builder.HasIndex(x => x.PosAccountTransferId);

        builder.Property(x => x.Amount).HasPrecision(18, 2);
        builder.Property(x => x.CreateUser).HasMaxLength(50).IsRequired();
        builder.Property(x => x.EditUser).HasMaxLength(50);

        // Deleting a sweep releases its movements so they show as unsettled again and can be
        // swept afresh — which is exactly the correction path the user asked for.
        builder.HasOne(x => x.PosAccountTransfer)
            .WithMany()
            .HasForeignKey(x => x.PosAccountTransferId)
            .OnDelete(DeleteBehavior.Cascade);

        // No foreign key to BankAccountTransactions on purpose: that table is also written by
        // the personnel service, and a constraint from here would start blocking deletes that
        // this feature promised not to interfere with. The id is resolved by query instead.
    }
}
