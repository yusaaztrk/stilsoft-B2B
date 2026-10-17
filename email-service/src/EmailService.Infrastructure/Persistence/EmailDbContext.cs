using EmailService.Domain.Entities;
using EmailService.Domain.Repositories;
using Microsoft.EntityFrameworkCore;

namespace EmailService.Infrastructure.Persistence;

public class EmailDbContext : DbContext, IUnitOfWork
{
    public EmailDbContext(DbContextOptions<EmailDbContext> options) : base(options) { }

    public DbSet<TenantSmtpConfig> TenantSmtpConfigs => Set<TenantSmtpConfig>();
    public DbSet<EmailTemplate> EmailTemplates => Set<EmailTemplate>();
    public DbSet<EmailMessage> EmailMessages => Set<EmailMessage>();
    public DbSet<EmailAttachment> EmailAttachments => Set<EmailAttachment>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        modelBuilder.Entity<TenantSmtpConfig>(entity =>
        {
            entity.ToTable("tenant_smtp_configs");
            entity.HasKey(e => e.Id);
            entity.HasIndex(e => e.TenantId).IsUnique();
            entity.Property(e => e.TenantId).HasMaxLength(100).IsRequired();
            entity.Property(e => e.Host).HasMaxLength(255).IsRequired();
            entity.Property(e => e.Username).HasMaxLength(255);
            entity.Property(e => e.SenderName).HasMaxLength(255);
            entity.Property(e => e.SenderEmail).HasMaxLength(255).IsRequired();
        });

        modelBuilder.Entity<EmailTemplate>(entity =>
        {
            entity.ToTable("email_templates");
            entity.HasKey(e => e.Id);
            entity.HasIndex(e => new { e.TenantId, e.Name }).IsUnique();
            entity.Property(e => e.TenantId).HasMaxLength(100).IsRequired();
            entity.Property(e => e.Name).HasMaxLength(150).IsRequired();
        });

        modelBuilder.Entity<EmailMessage>(entity =>
        {
            entity.ToTable("email_messages");
            entity.HasKey(e => e.Id);
            entity.HasIndex(e => e.TenantId);
            entity.HasIndex(e => e.ScheduledFor);
            entity.Property(e => e.TenantId).HasMaxLength(100).IsRequired();
            entity.Property(e => e.Recipient).HasMaxLength(255).IsRequired();
            entity.Property(e => e.Subject).HasMaxLength(255).IsRequired();
            
            // Map Enum as string
            entity.Property(e => e.Status)
                  .HasConversion<string>()
                  .HasMaxLength(50);
            
            // Rich domain property navigation mapping
            entity.HasMany(e => e.Attachments)
                  .WithOne()
                  .HasForeignKey(a => a.EmailMessageId)
                  .OnDelete(DeleteBehavior.Cascade);

            var navigation = entity.Metadata.FindNavigation(nameof(EmailMessage.Attachments));
            navigation?.SetPropertyAccessMode(PropertyAccessMode.Field);
        });

        modelBuilder.Entity<EmailAttachment>(entity =>
        {
            entity.ToTable("email_attachments");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.FileName).HasMaxLength(255).IsRequired();
            entity.Property(e => e.ContentType).HasMaxLength(100).IsRequired();
        });
    }
}
