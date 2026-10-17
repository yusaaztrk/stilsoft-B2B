using System;
using System.Threading;
using System.Threading.Tasks;
using EmailService.Api.BackgroundWorkers;
using EmailService.Application.Abstractions;
using EmailService.Application.Features.Emails;
using EmailService.Domain.Repositories;
using EmailService.Infrastructure.Encryption;
using EmailService.Infrastructure.Messaging;
using EmailService.Infrastructure.Persistence;
using EmailService.Infrastructure.Persistence.Repositories;
using EmailService.Infrastructure.Providers;
using EmailService.Infrastructure.SMTP;
using EmailService.Infrastructure.Templates;
using MediatR;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Diagnostics.HealthChecks;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Diagnostics.HealthChecks;
using Microsoft.Extensions.Hosting;
using OpenTelemetry.Resources;
using OpenTelemetry.Trace;
using RabbitMQ.Client;
using Serilog;

var builder = WebApplication.CreateBuilder(args);

// Configure Serilog
Log.Logger = new LoggerConfiguration()
    .ReadFrom.Configuration(builder.Configuration)
    .Enrich.FromLogContext()
    .CreateLogger();

builder.Host.UseSerilog();

// Add EF Core PostgreSQL
builder.Services.AddDbContext<EmailDbContext>(options =>
    options.UseNpgsql(
        builder.Configuration.GetConnectionString("DefaultConnection"),
        npgsqlOptions => npgsqlOptions.MigrationsAssembly(typeof(EmailDbContext).Assembly.FullName)
    )
);

// Register repositories and Unit of Work
builder.Services.AddScoped<ITenantSmtpConfigRepository, TenantSmtpConfigRepository>();
builder.Services.AddScoped<IEmailTemplateRepository, EmailTemplateRepository>();
builder.Services.AddScoped<IEmailMessageRepository, EmailMessageRepository>();
builder.Services.AddScoped<IUnitOfWork>(provider => provider.GetRequiredService<EmailDbContext>());

// Register Application abstractions
builder.Services.AddSingleton<IEncryptionService, AesEncryptionService>();
builder.Services.AddTransient<ITemplateEngine, HandlebarsTemplateEngine>();
builder.Services.AddTransient<ISmtpEmailSender, MailKitSmtpEmailSender>();
builder.Services.AddSingleton<IEmailEventPublisher, RabbitMqEmailEventPublisher>();
builder.Services.AddSingleton<IDateTimeProvider, DateTimeProvider>();

// Register MediatR
builder.Services.AddMediatR(cfg => cfg.RegisterServicesFromAssembly(typeof(QueueEmailCommand).Assembly));

// Register Background Workers
builder.Services.AddHostedService<RabbitMqEmailConsumer>();
builder.Services.AddHostedService<ScheduledEmailProcessor>();

// Add Controllers and Swagger
builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

// Configure Custom Health Checks
builder.Services.AddHealthChecks()
    .AddCheck<DbHealthCheck>("database_check", tags: new[] { "db" })
    .AddCheck<RabbitMqHealthCheck>("rabbitmq_check", tags: new[] { "rabbitmq" });

// Configure OpenTelemetry Tracing
builder.Services.AddOpenTelemetry()
    .WithTracing(tracing =>
    {
        tracing.AddSource("EmailService")
               .SetResourceBuilder(ResourceBuilder.CreateDefault().AddService("EmailService"))
               .AddAspNetCoreInstrumentation()
               .AddHttpClientInstrumentation()
               .AddOtlpExporter(opt =>
               {
                   opt.Endpoint = new Uri(builder.Configuration["OTEL_EXPORTER_OTLP_ENDPOINT"] ?? "http://localhost:4317");
               });
    });

var app = builder.Build();

// Auto-run Migrations for Database at Startup in non-production or docker environments
using (var scope = app.Services.CreateScope())
{
    try
    {
        var db = scope.ServiceProvider.GetRequiredService<EmailDbContext>();
        db.Database.Migrate();
        Log.Information("PostgreSQL database migrations applied successfully.");

        // Seed default SMTP configuration from settings/environment variables
        var encryptor = scope.ServiceProvider.GetRequiredService<IEncryptionService>();
        var configuration = scope.ServiceProvider.GetRequiredService<IConfiguration>();

        var smtpHost = configuration["Smtp:Host"] ?? "maildev";
        var smtpPortStr = configuration["Smtp:Port"];
        int smtpPort = int.TryParse(smtpPortStr, out var p) ? p : 1025;
        var smtpUser = configuration["Smtp:Username"] ?? "";
        var smtpPass = configuration["Smtp:Password"] ?? "";
        var smtpSslStr = configuration["Smtp:EnableSsl"];
        bool smtpSsl = bool.TryParse(smtpSslStr, out var ssl) && ssl;
        var smtpName = configuration["Smtp:SenderName"] ?? "B2B ERP E-Ticaret";
        var smtpEmail = configuration["Smtp:SenderEmail"] ?? "no-reply@b2berp.com";

        var defaultConfig = db.TenantSmtpConfigs.FirstOrDefault(c => c.TenantId == "DEFAULT");
        if (defaultConfig == null)
        {
            var defaultSmtp = new EmailService.Domain.Entities.TenantSmtpConfig(
                "DEFAULT",
                smtpHost,
                smtpPort,
                smtpUser,
                encryptor.Encrypt(smtpPass),
                smtpSsl,
                smtpName,
                smtpEmail
            );
            db.TenantSmtpConfigs.Add(defaultSmtp);
            db.SaveChanges();
            Log.Information("Default SMTP configuration seeded for tenant 'DEFAULT'.");
        }
        else
        {
            var decryptedPass = string.Empty;
            try
            {
                decryptedPass = encryptor.Decrypt(defaultConfig.EncryptedPassword);
            }
            catch {}

            if (defaultConfig.Host != smtpHost || 
                defaultConfig.Port != smtpPort || 
                defaultConfig.Username != smtpUser || 
                decryptedPass != smtpPass || 
                defaultConfig.EnableSsl != smtpSsl || 
                defaultConfig.SenderName != smtpName || 
                defaultConfig.SenderEmail != smtpEmail)
            {
                defaultConfig.Update(
                    smtpHost,
                    smtpPort,
                    smtpUser,
                    encryptor.Encrypt(smtpPass),
                    smtpSsl,
                    smtpName,
                    smtpEmail
                );
                db.SaveChanges();
                Log.Information("Synchronized tenant 'DEFAULT' SMTP configuration from application settings.");
            }
        }
    }
    catch (Exception ex)
    {
        Log.Error(ex, "An error occurred while applying database migrations.");
    }
}

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseSerilogRequestLogging();
app.UseHttpsRedirection();
app.UseAuthorization();
app.MapControllers();

// Health Check Endpoint Mapping
app.MapHealthChecks("/health", new HealthCheckOptions
{
    ResponseWriter = async (context, report) =>
    {
        context.Response.ContentType = "application/json";
        var json = System.Text.Json.JsonSerializer.Serialize(new
        {
            status = report.Status.ToString(),
            checks = report.Entries.Select(e => new
            {
                name = e.Key,
                status = e.Value.Status.ToString(),
                description = e.Value.Description,
                exception = e.Value.Exception?.Message
            })
        });
        await context.Response.WriteAsync(json);
    }
});

try
{
    Log.Information("Email Microservice starting up...");
    app.Run();
}
catch (Exception ex)
{
    Log.Fatal(ex, "Host terminated unexpectedly.");
}
finally
{
    Log.CloseAndFlush();
}

#region Custom Health Check Implementations

public class DbHealthCheck : IHealthCheck
{
    private readonly EmailDbContext _context;
    public DbHealthCheck(EmailDbContext context) => _context = context;

    public async Task<HealthCheckResult> CheckHealthAsync(HealthCheckContext context, CancellationToken cancellationToken = default)
    {
        try
        {
            var canConnect = await _context.Database.CanConnectAsync(cancellationToken);
            return canConnect 
                ? HealthCheckResult.Healthy("PostgreSQL connection is healthy.") 
                : HealthCheckResult.Unhealthy("Cannot connect to PostgreSQL.");
        }
        catch (Exception ex)
        {
            return HealthCheckResult.Unhealthy("PostgreSQL health check failed.", ex);
        }
    }
}

public class RabbitMqHealthCheck : IHealthCheck
{
    private readonly IConfiguration _configuration;
    public RabbitMqHealthCheck(IConfiguration configuration) => _configuration = configuration;

    public async Task<HealthCheckResult> CheckHealthAsync(HealthCheckContext context, CancellationToken cancellationToken = default)
    {
        try
        {
            var host = _configuration["RabbitMq:Host"] ?? "localhost";
            var user = _configuration["RabbitMq:Username"] ?? "guest";
            var pass = _configuration["RabbitMq:Password"] ?? "guest";
            int port = int.TryParse(_configuration["RabbitMq:Port"], out var p) ? p : 5672;
            
            var factory = new ConnectionFactory { HostName = host, UserName = user, Password = pass, Port = port };
            using var connection = await factory.CreateConnectionAsync(cancellationToken);
            return HealthCheckResult.Healthy("RabbitMQ connection is healthy.");
        }
        catch (Exception ex)
        {
            return HealthCheckResult.Unhealthy("RabbitMQ health check failed.", ex);
        }
    }
}

#endregion
