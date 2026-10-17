using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using ServiceOps.Infrastructure.Data;

namespace ServiceOps.Infrastructure;

public static class ServiceCollectionExtensions
{
    public static IServiceCollection AddInfrastructure(this IServiceCollection services, IConfiguration configuration)
    {
        services.AddDbContext<ApplicationDbContext>((sp, options) =>
        {
            var resolver = sp.GetService<ITenantConnectionStringResolver>();
            var connectionString = resolver != null 
                ? resolver.Resolve() 
                : (configuration.GetConnectionString("DefaultConnection") ?? configuration.GetConnectionString("ServiceOpsBase"));

            if (string.IsNullOrWhiteSpace(connectionString))
                throw new InvalidOperationException("Database connection string bulunamadı. ConnectionStrings:DefaultConnection veya ConnectionStrings:ServiceOpsBase tanımlı olmalı.");

            options.UseNpgsql(connectionString, npgsqlOptions =>
            {
                npgsqlOptions.MigrationsAssembly("ServiceOps.Infrastructure");
            });
        });

        return services;
    }
}
