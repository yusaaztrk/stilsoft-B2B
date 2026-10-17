using System;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace EmailService.Api.Filters;

[AttributeUsage(AttributeTargets.Class | AttributeTargets.Method)]
public class ApiKeyAttribute : Attribute, IAsyncAuthorizationFilter
{
    private const string ApiKeyHeaderName = "X-API-Key";

    public async Task OnAuthorizationAsync(AuthorizationFilterContext context)
    {
        if (!context.HttpContext.Request.Headers.TryGetValue(ApiKeyHeaderName, out var extractedApiKey))
        {
            context.Result = new ContentResult
            {
                StatusCode = 401,
                Content = "API Key was not provided in 'X-API-Key' header."
            };
            return;
        }

        var configuration = context.HttpContext.RequestServices.GetRequiredService<IConfiguration>();
        var apiKey = configuration["Authentication:ApiKey"] ?? "B2B_ERP_EmailService_Default_Secret_API_Key_123!";

        if (!apiKey.Equals(extractedApiKey))
        {
            context.Result = new ContentResult
            {
                StatusCode = 403,
                Content = "Unauthorized client. Invalid API Key."
            };
            return;
        }

        await Task.CompletedTask;
    }
}
