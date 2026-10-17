using B2B.Erp.Api.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace B2B.Erp.Api.Data.Configurations;

public sealed class CustomerAuthorizedContactConfiguration : IEntityTypeConfiguration<CustomerAuthorizedContact>
{
    public void Configure(EntityTypeBuilder<CustomerAuthorizedContact> builder)
    {
        builder.ToTable("CustomerAuthorizedContacts");

        builder.HasKey(x => x.CustomerCode);

        builder.Property(x => x.CustomerCode)
            .IsRequired()
            .HasMaxLength(50);

        builder.Property(x => x.FullName)
            .IsRequired()
            .HasMaxLength(100)
            .HasDefaultValue(string.Empty);

        builder.Property(x => x.Phone)
            .HasMaxLength(50);

        builder.HasOne(x => x.Customer)
            .WithMany()
            .HasForeignKey(x => x.CustomerCode)
            .HasPrincipalKey(x => x.CustomerCode)
            .OnDelete(DeleteBehavior.Cascade);

        AuditableEntityConfiguration.ConfigureAudit(builder);
    }
}
