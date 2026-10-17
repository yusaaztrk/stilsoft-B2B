using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;
using Microsoft.Extensions.Configuration;

namespace ServiceOps.Infrastructure.Data;

public sealed class ApplicationDbContextFactory : IDesignTimeDbContextFactory<ApplicationDbContext>
{
    public ApplicationDbContext CreateDbContext(string[] args)
    {
        var basePath = Directory.GetCurrentDirectory();
        var parentPath = Directory.GetParent(basePath)?.FullName;

        var configuration = new ConfigurationBuilder()
            .AddJsonFile(Path.Combine(basePath, "appsettings.json"), optional: true)
            .AddJsonFile(Path.Combine(basePath, "appsettings.Development.json"), optional: true)
            .AddJsonFile(parentPath == null ? "" : Path.Combine(parentPath, "appsettings.json"), optional: true)
            .AddJsonFile(parentPath == null ? "" : Path.Combine(parentPath, "appsettings.Development.json"), optional: true)
            .AddEnvironmentVariables()
            .Build();

        var connectionString =
            configuration.GetConnectionString("DefaultConnection")
            ?? configuration.GetConnectionString("ServiceOpsBase");

        if (string.IsNullOrWhiteSpace(connectionString))
        {
            throw new InvalidOperationException(
                "Database connection string bulunamadı. ConnectionStrings:DefaultConnection veya ConnectionStrings:ServiceOpsBase tanımlı olmalı.");
        }

        var optionsBuilder = new DbContextOptionsBuilder<ApplicationDbContext>();
        optionsBuilder.UseNpgsql(connectionString, npgsqlOptions =>
        {
            npgsqlOptions.MigrationsAssembly("ServiceOps.Infrastructure");
        });

        return new ApplicationDbContext(optionsBuilder.Options);
    }
}
