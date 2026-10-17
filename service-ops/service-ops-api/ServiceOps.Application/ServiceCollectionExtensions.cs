using Microsoft.Extensions.DependencyInjection;
using ServiceOps.Application.Interfaces;
using ServiceOps.Application.Services;

namespace ServiceOps.Application;

public static class ServiceCollectionExtensions
{
    public static IServiceCollection AddApplication(this IServiceCollection services)
    {
        // Register services
        services.AddHttpClient<GeocodingService>();
        services.AddScoped<GeocodingService>();
        services.AddScoped<IServiceRecordService, ServiceRecordService>();
        services.AddScoped<ITechnicianService, TechnicianService>();
        services.AddScoped<IRouteService, RouteService>();

        // AutoMapper
        services.AddAutoMapper(cfg => cfg.AddMaps(typeof(ServiceCollectionExtensions).Assembly));

        return services;
    }
}
