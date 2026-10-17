using B2B.Erp.Api.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace B2B.Erp.Api.Data.Configurations;

// Tablolar InvoiceTrackingSchema'daki SQL ile kuruluyor; burada yalnızca eşleme var.
public sealed class InvoiceTrackingConfiguration : IEntityTypeConfiguration<InvoiceTracking>
{
    public void Configure(EntityTypeBuilder<InvoiceTracking> builder)
    {
        builder.ToTable("InvoiceTrackings");
        builder.HasKey(x => x.Id);
        builder.HasIndex(x => x.InvoiceId).IsUnique();
        builder.Property(x => x.Status).HasConversion<int>();
        builder.Property(x => x.InvoiceNo).HasMaxLength(50);
        builder.Property(x => x.TechnicianName).HasMaxLength(200);
        builder.Property(x => x.TechnicianUsername).HasMaxLength(100);
        builder.Property(x => x.CompletedBy).HasMaxLength(200);
        builder.Property(x => x.CreateUser).HasMaxLength(100);
        builder.Property(x => x.EditUser).HasMaxLength(100);
    }
}

public sealed class InvoiceTrackingEventConfiguration : IEntityTypeConfiguration<InvoiceTrackingEvent>
{
    public void Configure(EntityTypeBuilder<InvoiceTrackingEvent> builder)
    {
        builder.ToTable("InvoiceTrackingEvents");
        builder.HasKey(x => x.Id);
        builder.Property(x => x.InvoiceNo).HasMaxLength(50);
        builder.Property(x => x.EventType).HasMaxLength(30);
        builder.Property(x => x.TechnicianName).HasMaxLength(200);
        builder.Property(x => x.Note).HasMaxLength(2000);
        builder.Property(x => x.Source).HasMaxLength(20);
        builder.Property(x => x.Actor).HasMaxLength(200);
    }
}

public sealed class InvoiceTrackingPhotoConfiguration : IEntityTypeConfiguration<InvoiceTrackingPhoto>
{
    public void Configure(EntityTypeBuilder<InvoiceTrackingPhoto> builder)
    {
        builder.ToTable("InvoiceTrackingPhotos");
        builder.HasKey(x => x.Id);
        builder.Property(x => x.FileName).HasMaxLength(100);
        builder.Property(x => x.Source).HasMaxLength(20);
        builder.Property(x => x.UploadedBy).HasMaxLength(200);
    }
}
