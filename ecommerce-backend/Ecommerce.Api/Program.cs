using System.Text;
using Ecommerce.Api.Infrastructure;
using Ecommerce.Api.Infrastructure.Data;
using Ecommerce.Api.Infrastructure.Erp;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.IdentityModel.Tokens;

QuestPDF.Settings.License = QuestPDF.Infrastructure.LicenseType.Community;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers()
    .AddJsonOptions(options =>
    {
        options.JsonSerializerOptions.Converters.Add(new NullableGuidJsonConverter());
    });
builder.Services.AddEndpointsApiExplorer();

builder.Services.AddSwaggerGen(c =>
{
    c.SwaggerDoc("v1", new() { Title = "Stilsoft E-Commerce API", Version = "v1" });
    c.AddSecurityDefinition("Bearer", new()
    {
        Description = "JWT Authorization header using the Bearer scheme. Example: \"Bearer {token}\"",
        Name = "Authorization",
        In = Microsoft.OpenApi.Models.ParameterLocation.Header,
        Type = Microsoft.OpenApi.Models.SecuritySchemeType.ApiKey,
        Scheme = "Bearer"
    });
    c.AddSecurityRequirement(new()
    {
        {
            new()
            {
                Reference = new()
                {
                    Type = Microsoft.OpenApi.Models.ReferenceType.SecurityScheme,
                    Id = "Bearer"
                }
            },
            Array.Empty<string>()
        }
    });
});

builder.Services.Configure<ErpOptions>(builder.Configuration.GetSection("Erp"));
builder.Services.AddSingleton<ErpTenantGuard>();
builder.Services.AddSingleton<ErpTokenCache>();

builder.Services.AddHttpClient(ErpClient.HttpClientName)
    .ConfigureHttpClient((sp, http) =>
    {
        var opt = sp.GetRequiredService<Microsoft.Extensions.Options.IOptions<ErpOptions>>().Value;
        http.BaseAddress = new Uri(opt.BaseUrl.TrimEnd('/') + "/");
    });

builder.Services.AddScoped<ErpClient>();
builder.Services.AddHttpClient();

var jwt = builder.Configuration.GetSection("Jwt");
var jwtSecret = jwt["Secret"] ?? "";

builder.Services
    .AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(o =>
    {
        o.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = false,
            ValidateAudience = false,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtSecret))
        };
        o.Events = new JwtBearerEvents
        {
            OnMessageReceived = context =>
            {
                var accessToken = context.Request.Query["token"];
                var path = context.HttpContext.Request.Path;
                if (!string.IsNullOrEmpty(accessToken) && path.StartsWithSegments("/api/orders"))
                {
                    context.Token = accessToken;
                }
                return Task.CompletedTask;
            }
        };
    });

builder.Services.AddAuthorization(options =>
{
    var permissions = new[] { "dashboard", "products", "categories", "orders", "customers", "campaigns", "design", "reports", "settings", "users" };
    foreach (var permission in permissions)
    {
        options.AddPolicy($"perm:{permission}", policy =>
        {
            policy.RequireAuthenticatedUser();
            policy.RequireAssertion(ctx =>
                ctx.User.IsInRole("Owner") ||
                ctx.User.IsInRole("Admin") ||
                ctx.User.HasClaim("permission", permission));
        });
    }
});

builder.Services.AddCors(options =>
{
    options.AddPolicy("default", p =>
    {
        var origins = builder.Configuration.GetSection("Cors:Origins").Get<string[]>() ?? Array.Empty<string>();
        if (origins.Length == 0)
        {
            p.AllowAnyOrigin().AllowAnyHeader().AllowAnyMethod();
            return;
        }

        p.WithOrigins(origins)
            .AllowAnyHeader()
            .AllowAnyMethod();
    });
});

builder.Services.AddSingleton<JwtTokenService>();

builder.Services.AddSingleton<ProductSettingsRepository>();
builder.Services.AddSingleton<BrandsRepository>();

builder.Services.AddSingleton<ProductsRepository>();

builder.Services.AddSingleton<CategoriesRepository>();

builder.Services.AddSingleton<ProductMetadataRepository>();
builder.Services.AddSingleton<EcommerceUsersRepository>();
builder.Services.AddSingleton<StoreDesignRepository>();
builder.Services.AddSingleton<OrdersRepository>();
builder.Services.AddSingleton<InvoicesRepository>();
builder.Services.AddSingleton<FavoritesRepository>();
builder.Services.AddSingleton<MediaRepository>();
builder.Services.AddSingleton<PdfCatalogRepository>();
builder.Services.AddSingleton<ProductManualRepository>();
builder.Services.AddSingleton<NewsletterRepository>();
builder.Services.AddSingleton<AdminLogsRepository>();
builder.Services.AddSingleton<ContactMessagesRepository>();
builder.Services.AddSingleton<AdminModulesRepository>();
builder.Services.AddSingleton<LiveActivityService>();
builder.Services.AddSingleton<SurveyRepository>();
builder.Services.AddSingleton<InformationPagesRepository>();
builder.Services.AddSingleton<CampaignsRepository>();
builder.Services.AddSingleton<CampaignService>();

builder.WebHost.UseUrls(builder.Configuration["Urls"] ?? "http://localhost:5288");

var app = builder.Build();

using (var scope = app.Services.CreateScope())
{
    var repo = scope.ServiceProvider.GetRequiredService<ProductSettingsRepository>();
    await repo.EnsureCreatedAsync(CancellationToken.None);

    var brandsRepo = scope.ServiceProvider.GetRequiredService<BrandsRepository>();
    await brandsRepo.EnsureCreatedAsync(CancellationToken.None);

    var productsRepo = scope.ServiceProvider.GetRequiredService<ProductsRepository>();
    await productsRepo.EnsureCreatedAsync(CancellationToken.None);

    var categoriesRepo = scope.ServiceProvider.GetRequiredService<CategoriesRepository>();
    await categoriesRepo.EnsureCreatedAsync(CancellationToken.None);

    var metaRepo = scope.ServiceProvider.GetRequiredService<ProductMetadataRepository>();
    await metaRepo.EnsureCreatedAsync(CancellationToken.None);

    var usersRepo = scope.ServiceProvider.GetRequiredService<EcommerceUsersRepository>();
    await usersRepo.EnsureCreatedAsync(CancellationToken.None);

    var designRepo = scope.ServiceProvider.GetRequiredService<StoreDesignRepository>();
    await designRepo.EnsureCreatedAsync(CancellationToken.None);

    var ordersRepo = scope.ServiceProvider.GetRequiredService<OrdersRepository>();
    await ordersRepo.EnsureCreatedAsync(CancellationToken.None);

    var invoicesRepo = scope.ServiceProvider.GetRequiredService<InvoicesRepository>();
    await invoicesRepo.EnsureCreatedAsync(CancellationToken.None);

    var favoritesRepo = scope.ServiceProvider.GetRequiredService<FavoritesRepository>();
    await favoritesRepo.EnsureCreatedAsync(CancellationToken.None);

    var mediaRepo = scope.ServiceProvider.GetRequiredService<MediaRepository>();
    await mediaRepo.EnsureCreatedAsync(CancellationToken.None);

    var pdfRepo = scope.ServiceProvider.GetRequiredService<PdfCatalogRepository>();
    await pdfRepo.EnsureCreatedAsync(CancellationToken.None);

    var manualRepo = scope.ServiceProvider.GetRequiredService<ProductManualRepository>();
    await manualRepo.EnsureCreatedAsync(CancellationToken.None);

    var newsletterRepo = scope.ServiceProvider.GetRequiredService<NewsletterRepository>();
    await newsletterRepo.EnsureCreatedAsync(CancellationToken.None);

    var logsRepo = scope.ServiceProvider.GetRequiredService<AdminLogsRepository>();
    await logsRepo.EnsureCreatedAsync(CancellationToken.None);

    var contactRepo = scope.ServiceProvider.GetRequiredService<ContactMessagesRepository>();
    await contactRepo.EnsureCreatedAsync(CancellationToken.None);

    var adminModulesRepo = scope.ServiceProvider.GetRequiredService<AdminModulesRepository>();
    await adminModulesRepo.EnsureCreatedAsync(CancellationToken.None);

    var surveyRepo = scope.ServiceProvider.GetRequiredService<SurveyRepository>();
    await surveyRepo.EnsureCreatedAsync(CancellationToken.None);

    var infoPagesRepo = scope.ServiceProvider.GetRequiredService<InformationPagesRepository>();
    await infoPagesRepo.EnsureCreatedAsync(CancellationToken.None);

    var campaignsRepo = scope.ServiceProvider.GetRequiredService<CampaignsRepository>();
    await campaignsRepo.EnsureCreatedAsync(CancellationToken.None);
}

app.Use(async (context, next) =>
{
    try
    {
        await next();
    }
    catch (Exception ex)
    {
        if (!context.Response.HasStarted)
        {
            context.Response.StatusCode = StatusCodes.Status500InternalServerError;
            context.Response.ContentType = "application/json";
        }

        await context.Response.WriteAsJsonAsync(new
        {
            success = false,
            message = "Beklenmeyen bir hata oluştu",
            error = ex.Message
        });
    }
});

app.UseCors("default");

app.UseStaticFiles();

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseAuthentication();
app.UseAuthorization();

app.MapControllers();
app.MapGet("/health", () => Results.Ok(new { ok = true }));

app.Run();
