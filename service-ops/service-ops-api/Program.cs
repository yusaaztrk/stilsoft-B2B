using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.IdentityModel.Tokens;
using Npgsql;
using ServiceOps.Application;
using ServiceOps.Infrastructure;

AppContext.SetSwitch("Npgsql.EnableLegacyTimestampBehavior", true);

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddOpenApi();

builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        var issuer = builder.Configuration["Jwt:Issuer"];
        var audience = builder.Configuration["Jwt:Audience"];
        var key = builder.Configuration["Jwt:Key"];
        if (string.IsNullOrWhiteSpace(key)) throw new InvalidOperationException("Jwt:Key bulunamadı");

        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidateAudience = true,
            ValidateIssuerSigningKey = true,
            ValidateLifetime = true,
            ValidIssuer = issuer,
            ValidAudience = audience,
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(key))
        };
    });

builder.Services.AddAuthorization();

builder.Services.AddHttpClient("ErpApi", client =>
{
    var baseUrl = builder.Configuration["ErpApi:BaseUrl"] ?? "http://localhost:5200";
    if (!baseUrl.EndsWith("/", StringComparison.Ordinal)) baseUrl += "/";
    client.BaseAddress = new Uri(baseUrl);
});

builder.Services.AddCors(options =>
{
    options.AddPolicy("DevCors", policy =>
    {
        policy
            .AllowAnyHeader()
            .AllowAnyMethod()
            .SetIsOriginAllowed(_ => true)
            .AllowCredentials();
    });
});

// Add Application and Infrastructure services
builder.Services.AddApplication();
builder.Services.AddInfrastructure(builder.Configuration);

var app = builder.Build();

using (var scope = app.Services.CreateScope())
{
    try
    {
        var cfg = scope.ServiceProvider.GetRequiredService<IConfiguration>();
        var mainConnStr = cfg.GetConnectionString("ServiceOpsBase") ?? "Host=localhost;Port=5434;Database=serviceops_dev;Username=b2b;Password=b2b;";
        var builderConn = new Npgsql.NpgsqlConnectionStringBuilder(mainConnStr) { Database = "postgres" };
        using var conn = new Npgsql.NpgsqlConnection(builderConn.ConnectionString);
        await conn.OpenAsync();
        using var cmd = new Npgsql.NpgsqlCommand("SELECT datname FROM pg_database WHERE datname LIKE 'serviceops%' OR datname LIKE 'b2b_serviceops%';", conn);
        using var reader = await cmd.ExecuteReaderAsync();
        var dbs = new List<string>();
        while (await reader.ReadAsync())
        {
            dbs.Add(reader.GetString(0));
        }
        await reader.CloseAsync();

        foreach (var dbName in dbs)
        {
            try
            {
                var targetConnStr = new Npgsql.NpgsqlConnectionStringBuilder(mainConnStr) { Database = dbName }.ConnectionString;
                using var tConn = new Npgsql.NpgsqlConnection(targetConnStr);
                await tConn.OpenAsync();
                using var alterCmd = new Npgsql.NpgsqlCommand("ALTER TABLE \"ServiceRecords\" ADD COLUMN IF NOT EXISTS \"ProductStockCode\" text;", tConn);
                await alterCmd.ExecuteNonQueryAsync();
            }
            catch { }
        }
    }
    catch { }
}

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

app.MapGet("/api/seed/regions", async (ServiceOps.Infrastructure.Data.ApplicationDbContext dbContext) => {
    if (!dbContext.Regions.Any()) {
        dbContext.Regions.Add(new ServiceOps.Domain.Entities.Region {
            Id = Guid.NewGuid(),
            Name = "Marmara Bölgesi",
            Description = "İstanbul ve çevresi",
            IsActive = true,
            CreatedAt = DateTime.UtcNow
        });
        dbContext.Regions.Add(new ServiceOps.Domain.Entities.Region {
            Id = Guid.NewGuid(),
            Name = "Ege Bölgesi",
            Description = "İzmir ve çevresi",
            IsActive = true,
            CreatedAt = DateTime.UtcNow
        });
        await dbContext.SaveChangesAsync();
        return Results.Ok(new { message = "Seeded 2 regions" });
    }
    return Results.Ok(new { message = "Already seeded" });
}).AllowAnonymous();

app.MapGet("/api/tenants/public", async (IHttpClientFactory httpClientFactory, CancellationToken cancellationToken) =>
{
    var client = httpClientFactory.CreateClient("ErpApi");

    using var res = await client.GetAsync("api/tenants/public?serviceOpsOnly=true", cancellationToken);
    var body = await res.Content.ReadAsStringAsync(cancellationToken);

    if (!res.IsSuccessStatusCode)
    {
        return Results.Problem(
            title: "ERP tenant listesi alınamadı",
            detail: string.IsNullOrWhiteSpace(body) ? res.ReasonPhrase : body,
            statusCode: (int)res.StatusCode);
    }

    try
    {
        var json = JsonSerializer.Deserialize<JsonElement>(body);
        return Results.Ok(json);
    }
    catch
    {
        return Results.Ok(new { success = true, data = Array.Empty<object>() });
    }
}).AllowAnonymous();

// Proxy: B2B ERP ürünlerini service-ops token'ı ile çeker
// Cache ERP token
string? _erpToken = null;
DateTime _erpTokenExpiry = DateTime.MinValue;

async Task<string?> GetErpToken(IHttpClientFactory factory, IConfiguration cfg, CancellationToken ct)
{
    if (_erpToken != null && DateTime.UtcNow < _erpTokenExpiry) return _erpToken;
    var client = factory.CreateClient("ErpApi");
    var tenantCode = cfg["ErpApi:ServiceAccount:TenantCode"];
    var username   = cfg["ErpApi:ServiceAccount:Username"]   ?? "ssa";
    var password   = cfg["ErpApi:ServiceAccount:Password"]   ?? "123";

    if (string.Equals(username, "ssa", StringComparison.OrdinalIgnoreCase))
    {
        tenantCode = "";
    }
    else if (string.IsNullOrWhiteSpace(tenantCode))
    {
        tenantCode = "SERVIS";
    }

    var body = JsonSerializer.Serialize(new { tenantCode, username, password });
    try
    {
        var request = new HttpRequestMessage(HttpMethod.Post, "api/auth/login")
        {
            Content = new StringContent(body, Encoding.UTF8, "application/json")
        };
        if (!string.IsNullOrWhiteSpace(tenantCode))
        {
            request.Headers.Add("X-Tenant-Code", tenantCode);
        }
        var res = await client.SendAsync(request, ct);
        if (!res.IsSuccessStatusCode) return null;
        var json = await res.Content.ReadAsStringAsync(ct);
        using var doc = JsonDocument.Parse(json);
        var token = doc.RootElement.TryGetProperty("accessToken", out var t) ? t.GetString() 
            : doc.RootElement.TryGetProperty("data", out var d) && d.TryGetProperty("accessToken", out var t2) ? t2.GetString()
            : null;
        if (!string.IsNullOrEmpty(token))
        {
            _erpToken = token;
            var expiry = DateTime.UtcNow.AddMinutes(2); // Fallback to 2 minutes
            try
            {
                var parts = token.Split('.');
                if (parts.Length > 1)
                {
                    var payloadBase64 = parts[1].Replace('-', '+').Replace('_', '/');
                    switch (payloadBase64.Length % 4)
                    {
                        case 2: payloadBase64 += "=="; break;
                        case 3: payloadBase64 += "="; break;
                    }
                    var payloadBytes = Convert.FromBase64String(payloadBase64);
                    var payloadJson = System.Text.Encoding.UTF8.GetString(payloadBytes);
                    using var payloadDoc = JsonDocument.Parse(payloadJson);
                    if (payloadDoc.RootElement.TryGetProperty("exp", out var expProp))
                    {
                        var expSeconds = expProp.GetInt64();
                        expiry = DateTimeOffset.FromUnixTimeSeconds(expSeconds).UtcDateTime.AddSeconds(-15);
                    }
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[ERP_AUTH] Expiry parse error: {ex.Message}");
            }
            _erpTokenExpiry = expiry;
            Console.WriteLine($"[ERP_AUTH] Token expiry set to: {_erpTokenExpiry} (UTC), Current time: {DateTime.UtcNow} (UTC)");
        }
        return _erpToken;
    }
    catch { return null; }
}

app.MapGet("/api/erp/products", async (
    HttpContext httpContext,
    IHttpClientFactory httpClientFactory,
    IConfiguration configuration,
    string? q, string? main, string? sub,
    int pageSize = 200, int page = 1,
    CancellationToken cancellationToken = default) =>
{
    if (pageSize > 10000) pageSize = 10000;
    var qs = $"?pageSize={pageSize}&page={page}";
    if (!string.IsNullOrWhiteSpace(q))    qs += $"&q={Uri.EscapeDataString(q)}";
    if (!string.IsNullOrWhiteSpace(main)) qs += $"&main={Uri.EscapeDataString(main)}";
    if (!string.IsNullOrWhiteSpace(sub))  qs += $"&sub={Uri.EscapeDataString(sub)}";

    var erpToken = await GetErpToken(httpClientFactory, configuration, cancellationToken);
    var client = httpClientFactory.CreateClient("ErpApi");
    var request = new HttpRequestMessage(HttpMethod.Get, $"api/products{qs}");
    if (!string.IsNullOrEmpty(erpToken))
        request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", erpToken);

    var tenantCode = httpContext.User.FindFirstValue("tenantCode") 
                     ?? httpContext.User.FindFirstValue("tenant") 
                     ?? (httpContext.Request.Headers.TryGetValue("X-Tenant-Code", out var hdr) ? hdr.ToString() : "")
                     ?? configuration["ErpApi:ServiceAccount:TenantCode"]
                     ?? "SERVIS";
    if (string.IsNullOrWhiteSpace(tenantCode)) tenantCode = "SERVIS";
    request.Headers.Add("X-Tenant-Code", tenantCode);

    try
    {
        var res = await client.SendAsync(request, cancellationToken);
        var bodyText = await res.Content.ReadAsStringAsync(cancellationToken);
        return res.IsSuccessStatusCode
            ? Results.Content(bodyText, "application/json")
            : Results.Problem(bodyText, statusCode: (int)res.StatusCode);
    }
    catch (Exception ex)
    {
        return Results.Problem(ex.Message, statusCode: 500);
    }
}).RequireAuthorization();

app.MapGet("/api/erp/dealers", async (
    HttpContext httpContext,
    IHttpClientFactory httpClientFactory,
    IConfiguration configuration,
    string? q,
    int pageSize = 200,
    CancellationToken cancellationToken = default) =>
{
    if (pageSize > 500) pageSize = 500;
    var qs = $"?pageSize={pageSize}&page=1&includeInactive=false";
    if (!string.IsNullOrWhiteSpace(q)) qs += $"&q={Uri.EscapeDataString(q)}";

    var erpToken = await GetErpToken(httpClientFactory, configuration, cancellationToken);
    var client = httpClientFactory.CreateClient("ErpApi");
    var request = new HttpRequestMessage(HttpMethod.Get, $"api/customers{qs}");
    if (!string.IsNullOrEmpty(erpToken))
        request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", erpToken);

    var tenantCode = httpContext.User.FindFirstValue("tenantCode") 
                     ?? httpContext.User.FindFirstValue("tenant") 
                     ?? (httpContext.Request.Headers.TryGetValue("X-Tenant-Code", out var hdr) ? hdr.ToString() : "")
                     ?? configuration["ErpApi:ServiceAccount:TenantCode"]
                     ?? "SERVIS";
    if (string.IsNullOrWhiteSpace(tenantCode)) tenantCode = "SERVIS";
    request.Headers.Add("X-Tenant-Code", tenantCode);

    try
    {
        var res = await client.SendAsync(request, cancellationToken);
        var bodyText = await res.Content.ReadAsStringAsync(cancellationToken);
        return res.IsSuccessStatusCode
            ? Results.Content(bodyText, "application/json")
            : Results.Problem(bodyText, statusCode: (int)res.StatusCode);
    }
    catch (Exception ex)
    {
        return Results.Problem(ex.Message, statusCode: 500);
    }
}).RequireAuthorization();

async Task<NpgsqlConnection> OpenTenantConnectionAsync(string tenantCode, CancellationToken cancellationToken)
{
    var dbName = GetServiceOpsDbName(tenantCode);
    var connStr = BuildServiceOpsConnStr(dbName);
    var conn = new NpgsqlConnection(connStr);
    await conn.OpenAsync(cancellationToken);
    return conn;
}

static async Task EnsureMontajTablesAsync(NpgsqlConnection conn, CancellationToken cancellationToken)
{
    await using var cmd = conn.CreateCommand();
    cmd.CommandText = @"
CREATE TABLE IF NOT EXISTS public.""Installations"" (
  ""Id"" integer GENERATED BY DEFAULT AS IDENTITY,
  ""DealerCode"" character varying(50) NOT NULL DEFAULT '',
  ""DealerName"" character varying(200) NOT NULL DEFAULT '',
  ""ProductName"" character varying(400) NOT NULL DEFAULT '',
  ""Quantity"" numeric(18,2) NOT NULL DEFAULT 1,
  ""InstallationName"" character varying(200) NULL,
  ""InstallationPhone"" character varying(50) NULL,
  ""Address"" character varying(2000) NOT NULL DEFAULT '',
  ""Region"" character varying(200) NOT NULL DEFAULT '',
  ""DealerDescription"" character varying(4000) NULL,
  ""Type"" character varying(30) NOT NULL DEFAULT 'Montaj',
  ""Status"" character varying(50) NOT NULL DEFAULT 'Yeni Kayıt',
  ""PlannedDateUtc"" timestamp with time zone NULL,
  ""Technician"" character varying(120) NULL,
  ""CreateUser"" character varying(80) NOT NULL DEFAULT '',
  ""CreateTime"" timestamp with time zone NOT NULL,
  ""EditUser"" character varying(80) NULL,
  ""EditTime"" timestamp with time zone NULL,
  CONSTRAINT ""PK_Installations"" PRIMARY KEY (""Id"")
);

CREATE INDEX IF NOT EXISTS ""IX_Installations_CreateTime"" ON public.""Installations"" (""CreateTime"" DESC);
CREATE INDEX IF NOT EXISTS ""IX_Installations_DealerCode"" ON public.""Installations"" (""DealerCode"");

CREATE TABLE IF NOT EXISTS public.""InstallationDocuments"" (
  ""Id"" integer GENERATED BY DEFAULT AS IDENTITY,
  ""InstallationId"" integer NOT NULL,
  ""DocumentUrl"" character varying(2000) NOT NULL,
  ""UploadedDateUtc"" timestamp with time zone NOT NULL,
  ""CreateUser"" character varying(80) NOT NULL DEFAULT '',
  ""CreateTime"" timestamp with time zone NOT NULL,
  ""EditUser"" character varying(80) NULL,
  ""EditTime"" timestamp with time zone NULL,
  CONSTRAINT ""PK_InstallationDocuments"" PRIMARY KEY (""Id""),
  CONSTRAINT ""FK_InstallationDocuments_Installations"" FOREIGN KEY (""InstallationId"") REFERENCES public.""Installations""(""Id"") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS ""IX_InstallationDocuments_InstallationId"" ON public.""InstallationDocuments"" (""InstallationId"");
";
    await cmd.ExecuteNonQueryAsync(cancellationToken);
}

static async Task EnsureUsersTableAsync(NpgsqlConnection conn, CancellationToken cancellationToken)
{
    await using var cmd = conn.CreateCommand();
    cmd.CommandText = @"
CREATE TABLE IF NOT EXISTS public.""ServiceUsers"" (
  ""Id"" integer GENERATED BY DEFAULT AS IDENTITY,
  ""Username"" character varying(80) NOT NULL,
  ""Password"" character varying(100) NOT NULL,
  ""Email"" character varying(120) NULL,
  ""FirstName"" character varying(50) NULL,
  ""LastName"" character varying(50) NULL,
  ""IsActive"" boolean NOT NULL DEFAULT true,
  ""RoleCode"" character varying(20) NULL,
  ""RoleName"" character varying(50) NULL,
  ""TenantCode"" character varying(20) NULL,
  ""CreatedAt"" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT ""PK_ServiceUsers"" PRIMARY KEY (""Id""),
  CONSTRAINT ""UQ_ServiceUsers_Username"" UNIQUE (""Username"")
);

CREATE INDEX IF NOT EXISTS ""IX_ServiceUsers_TenantCode"" ON public.""ServiceUsers"" (""TenantCode"");
CREATE INDEX IF NOT EXISTS ""IX_ServiceUsers_IsActive"" ON public.""ServiceUsers"" (""IsActive"");
";
    await cmd.ExecuteNonQueryAsync(cancellationToken);
}

static string NormalizeStatus(string? value) => string.IsNullOrWhiteSpace(value) ? string.Empty : value.Trim();

static bool IsTerminalStatus(string status)
{
    return string.Equals(status, "Gerçekleşti", StringComparison.OrdinalIgnoreCase) ||
           string.Equals(status, "İptal", StringComparison.OrdinalIgnoreCase);
}

static bool IsArizaType(string? type)
{
    var t = string.IsNullOrWhiteSpace(type) ? string.Empty : type.Trim();
    return string.Equals(t, "Arıza", StringComparison.OrdinalIgnoreCase) ||
           string.Equals(t, "Ariza", StringComparison.OrdinalIgnoreCase);
}

static HashSet<string> AllowedNextStatuses(string currentStatus, bool isAriza)
{
    currentStatus = NormalizeStatus(currentStatus);

    if (string.Equals(currentStatus, "Yeni Kayıt", StringComparison.OrdinalIgnoreCase))
    {
        return new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "Planlandı", "İptal" };
    }

    if (string.Equals(currentStatus, "Planlandı", StringComparison.OrdinalIgnoreCase))
    {
        var set = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "Gerçekleşti", "Ertelendi", "İptal" };
        if (isAriza) set.Add("Atölyeye Alındı");
        return set;
    }

    if (string.Equals(currentStatus, "Ertelendi", StringComparison.OrdinalIgnoreCase))
    {
        return new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "Planlandı", "İptal" };
    }

    if (string.Equals(currentStatus, "Atölyeye Alındı", StringComparison.OrdinalIgnoreCase))
    {
        return new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "Atölye Hazır" };
    }

    if (string.Equals(currentStatus, "Atölye Hazır", StringComparison.OrdinalIgnoreCase))
    {
        return new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "Planlandı" };
    }

    if (IsTerminalStatus(currentStatus))
    {
        return new HashSet<string>(StringComparer.OrdinalIgnoreCase);
    }

    return new HashSet<string>(StringComparer.OrdinalIgnoreCase);
}

app.UseHttpsRedirection();

if (app.Environment.IsDevelopment())
{
    app.UseCors("DevCors");
}

app.UseStaticFiles();

app.UseAuthentication();
app.UseAuthorization();

static string NormalizeTenantCode(string? tenantCode)
{
    var code = (tenantCode ?? string.Empty).Trim().ToUpperInvariant();
    if (code.Length == 0) return string.Empty;

    var sb = new StringBuilder(code.Length);
    foreach (var ch in code)
    {
        if ((ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9') || ch == '_')
        {
            sb.Append(ch);
        }
        else
        {
            sb.Append('_');
        }
    }

    var normalized = sb.ToString();
    while (normalized.Contains("__", StringComparison.Ordinal)) normalized = normalized.Replace("__", "_", StringComparison.Ordinal);
    normalized = normalized.Trim('_');
    return normalized;
}

static string GetServiceOpsDbName(string tenantCode) => $"b2b_serviceops_tenant_{tenantCode}";

string BuildServiceOpsConnStr(string dbName)
{
    var template = builder.Configuration.GetConnectionString("ServiceOpsBase");
    if (string.IsNullOrWhiteSpace(template)) throw new InvalidOperationException("ConnectionStrings:ServiceOpsBase bulunamadı");
    return template.Replace("{DB_NAME}", dbName, StringComparison.Ordinal);
}

string CreateJwt(string tenantCode, string username)
{
    var issuer = builder.Configuration["Jwt:Issuer"];
    var audience = builder.Configuration["Jwt:Audience"];
    var key = builder.Configuration["Jwt:Key"];
    if (string.IsNullOrWhiteSpace(key)) throw new InvalidOperationException("Jwt:Key bulunamadı");

    var creds = new SigningCredentials(new SymmetricSecurityKey(Encoding.UTF8.GetBytes(key)), SecurityAlgorithms.HmacSha256);

    var claims = new List<Claim>
    {
        new("tenant", tenantCode),
        new(ClaimTypes.Name, username)
    };

    var token = new JwtSecurityToken(
        issuer: issuer,
        audience: audience,
        claims: claims,
        expires: DateTime.UtcNow.AddHours(12),
        signingCredentials: creds);

    return new JwtSecurityTokenHandler().WriteToken(token);
}

app.MapPost("/api/auth/login", async (LoginRequest request, CancellationToken cancellationToken) =>
{
    var tenantCode = NormalizeTenantCode(request.TenantCode);
    if (string.IsNullOrWhiteSpace(tenantCode)) return Results.BadRequest(new { success = false, message = "Tenant code zorunlu" });

    var username = (request.Username ?? string.Empty).Trim();
    var password = request.Password ?? string.Empty;
    if (string.IsNullOrWhiteSpace(username) || string.IsNullOrWhiteSpace(password))
    {
        return Results.BadRequest(new { success = false, message = "Kullanıcı adı ve şifre zorunlu" });
    }

    var dbName = GetServiceOpsDbName(tenantCode);
    var connStr = BuildServiceOpsConnStr(dbName);

    await using var conn = new NpgsqlConnection(connStr);
    try
    {
        await conn.OpenAsync(cancellationToken);
    }
    catch (PostgresException ex) when (ex.SqlState == "3D000")
    {
        return Results.Problem(
            title: "Servis veritabanı bulunamadı",
            detail: $"'{dbName}' veritabanı yok. Bu firmada Servis İşlemleri etkinleştirilmemiş veya provisioning tamamlanmamış olabilir.",
            statusCode: StatusCodes.Status400BadRequest);
    }

    await using var cmd = conn.CreateCommand();
    cmd.CommandText = @"
SELECT ""Id"", ""Password"", ""IsActive""
FROM public.""ServiceUsers""
WHERE lower(""Username"") = lower(@u)
LIMIT 1;
";
    cmd.Parameters.AddWithValue("u", username);

    await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
    if (!await reader.ReadAsync(cancellationToken))
    {
        return Results.Problem(
            statusCode: 401,
            title: "Unauthorized",
            detail: "Kullanıcı adı veya şifre hatalı");
    }

    var isActive = reader.GetBoolean(reader.GetOrdinal("IsActive"));
    var storedPassword = reader.GetString(reader.GetOrdinal("Password"));
    if (!isActive) return Results.Problem(
        statusCode: 401,
        title: "Unauthorized", 
        detail: "Kullanıcı pasif");
    if (!string.Equals(storedPassword, password, StringComparison.Ordinal)) return Results.Problem(
        statusCode: 401,
        title: "Unauthorized",
        detail: "Kullanıcı adı veya şifre hatalı");

    var token = CreateJwt(tenantCode, username);
    return Results.Ok(new { success = true, data = new { accessToken = token, tenantCode, username } });
});

app.MapGet("/api/auth/me", (ClaimsPrincipal user) =>
{
    var tenant = user.FindFirst("tenant")?.Value ?? string.Empty;
    var username = user.Identity?.Name ?? string.Empty;
    return Results.Ok(new { success = true, data = new { tenantCode = tenant, username } });
}).RequireAuthorization();

app.MapGet("/api/erp/users", async (ClaimsPrincipal user, CancellationToken cancellationToken) =>
{
    var tenantCode = user.FindFirst("tenant")?.Value ?? string.Empty;
    if (string.IsNullOrWhiteSpace(tenantCode)) return Results.Unauthorized();

    await using var conn = await OpenTenantConnectionAsync(tenantCode, cancellationToken);
    await EnsureUsersTableAsync(conn, cancellationToken);

    var list = new List<object>();
    await using var cmd = conn.CreateCommand();
    cmd.CommandText = @"
SELECT ""Id"", ""Username"", ""Email"", ""FirstName"", ""LastName"", 
       ""IsActive"", ""RoleCode"", ""RoleName"", ""TenantCode"", ""CreatedAt""
FROM public.""ServiceUsers""
ORDER BY ""Id"";
";
    await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
    while (await reader.ReadAsync(cancellationToken))
    {
        list.Add(new
        {
            id = reader.IsDBNull(0) ? 0 : reader.GetInt32(0),
            username = reader.IsDBNull(1) ? "" : reader.GetString(1),
            email = reader.IsDBNull(2) ? null : reader.GetString(2),
            firstName = reader.IsDBNull(3) ? null : reader.GetString(3),
            lastName = reader.IsDBNull(4) ? null : reader.GetString(4),
            isActive = reader.IsDBNull(5) ? true : reader.GetBoolean(5),
            roleCode = reader.IsDBNull(6) ? null : reader.GetString(6),
            roleName = reader.IsDBNull(7) ? null : reader.GetString(7),
            tenantCode = reader.IsDBNull(8) ? null : reader.GetString(8),
            createdAt = reader.IsDBNull(9) ? null : reader.GetDateTime(9).ToString("yyyy-MM-dd HH:mm:ss")
        });
    }

    return Results.Ok(new { success = true, data = list });
}).RequireAuthorization();

app.MapGet("/api/montaj/list", async (ClaimsPrincipal user, CancellationToken cancellationToken) =>
{
    var tenantCode = user.FindFirst("tenant")?.Value ?? string.Empty;
    if (string.IsNullOrWhiteSpace(tenantCode)) return Results.Unauthorized();

    await using var conn = await OpenTenantConnectionAsync(tenantCode, cancellationToken);
    await EnsureMontajTablesAsync(conn, cancellationToken);

    await using var cmd = conn.CreateCommand();
    cmd.CommandText = @"
SELECT
  ""Id"",
  ""DealerCode"",
  ""Type"",
  ""Status"",
  ""DealerName"",
  ""ProductName"",
  ""Quantity"",
  ""InstallationName"" AS ""CustomerName"",
  ""InstallationPhone"" AS ""CustomerPhone"",
  ""Address"",
  ""Region"",
  ""PlannedDateUtc"",
  ""Technician"",
  ""DealerDescription"",
  ""CreateUser"",
  ""CreateTime""
FROM public.""Installations""
ORDER BY ""CreateTime"" DESC
LIMIT 500;
";

    await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
    var list = new List<object>();
    while (await reader.ReadAsync(cancellationToken))
    {
        list.Add(new
        {
            id = reader.GetInt32(reader.GetOrdinal("Id")),
            dealerCode = reader.GetString(reader.GetOrdinal("DealerCode")),
            type = reader.GetString(reader.GetOrdinal("Type")),
            status = reader.GetString(reader.GetOrdinal("Status")),
            dealerName = reader.GetString(reader.GetOrdinal("DealerName")),
            productName = reader.GetString(reader.GetOrdinal("ProductName")),
            quantity = reader.GetDecimal(reader.GetOrdinal("Quantity")),
            customerName = reader.IsDBNull(reader.GetOrdinal("CustomerName")) ? null : reader.GetString(reader.GetOrdinal("CustomerName")),
            customerPhone = reader.IsDBNull(reader.GetOrdinal("CustomerPhone")) ? null : reader.GetString(reader.GetOrdinal("CustomerPhone")),
            address = reader.GetString(reader.GetOrdinal("Address")),
            region = reader.GetString(reader.GetOrdinal("Region")),
            plannedDateUtc = reader.IsDBNull(reader.GetOrdinal("PlannedDateUtc")) ? (DateTime?)null : reader.GetDateTime(reader.GetOrdinal("PlannedDateUtc")),
            technician = reader.IsDBNull(reader.GetOrdinal("Technician")) ? null : reader.GetString(reader.GetOrdinal("Technician")),
            dealerDescription = reader.IsDBNull(reader.GetOrdinal("DealerDescription")) ? null : reader.GetString(reader.GetOrdinal("DealerDescription")),
            createUser = reader.GetString(reader.GetOrdinal("CreateUser")),
            createTime = reader.GetDateTime(reader.GetOrdinal("CreateTime"))
        });
    }

    return Results.Ok(new { success = true, data = list });
}).RequireAuthorization();

app.MapGet("/api/montaj/report", async (ClaimsPrincipal user, CancellationToken cancellationToken) =>
{
    var tenantCode = user.FindFirst("tenant")?.Value ?? string.Empty;
    if (string.IsNullOrWhiteSpace(tenantCode)) return Results.Unauthorized();

    await using var conn = await OpenTenantConnectionAsync(tenantCode, cancellationToken);
    await EnsureMontajTablesAsync(conn, cancellationToken);

    await using var cmd = conn.CreateCommand();
    cmd.CommandText = @"
SELECT
  ""Id"",
  ""DealerCode"",
  ""Type"",
  ""Status"",
  ""DealerName"",
  ""ProductName"",
  ""Quantity"",
  ""InstallationName"" AS ""CustomerName"",
  ""InstallationPhone"" AS ""CustomerPhone"",
  ""Address"",
  ""Region"",
  ""PlannedDateUtc"",
  ""Technician"",
  ""DealerDescription"",
  ""CreateUser"",
  ""CreateTime""
FROM public.""Installations""
ORDER BY ""CreateTime"" DESC
LIMIT 500;
";

    await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
    var list = new List<object>();
    while (await reader.ReadAsync(cancellationToken))
    {
        list.Add(new
        {
            id = reader.GetInt32(reader.GetOrdinal("Id")),
            dealerCode = reader.GetString(reader.GetOrdinal("DealerCode")),
            type = reader.GetString(reader.GetOrdinal("Type")),
            status = reader.GetString(reader.GetOrdinal("Status")),
            dealerName = reader.GetString(reader.GetOrdinal("DealerName")),
            productName = reader.GetString(reader.GetOrdinal("ProductName")),
            quantity = reader.GetDecimal(reader.GetOrdinal("Quantity")),
            customerName = reader.IsDBNull(reader.GetOrdinal("CustomerName")) ? null : reader.GetString(reader.GetOrdinal("CustomerName")),
            customerPhone = reader.IsDBNull(reader.GetOrdinal("CustomerPhone")) ? null : reader.GetString(reader.GetOrdinal("CustomerPhone")),
            address = reader.GetString(reader.GetOrdinal("Address")),
            region = reader.GetString(reader.GetOrdinal("Region")),
            plannedDateUtc = reader.IsDBNull(reader.GetOrdinal("PlannedDateUtc")) ? (DateTime?)null : reader.GetDateTime(reader.GetOrdinal("PlannedDateUtc")),
            technician = reader.IsDBNull(reader.GetOrdinal("Technician")) ? null : reader.GetString(reader.GetOrdinal("Technician")),
            dealerDescription = reader.IsDBNull(reader.GetOrdinal("DealerDescription")) ? null : reader.GetString(reader.GetOrdinal("DealerDescription")),
            createUser = reader.GetString(reader.GetOrdinal("CreateUser")),
            createTime = reader.GetDateTime(reader.GetOrdinal("CreateTime"))
        });
    }

    return Results.Ok(new { success = true, data = list });
}).RequireAuthorization();

app.MapPost("/api/montaj", async (ClaimsPrincipal user, CreateMontajRequest request, CancellationToken cancellationToken) =>
{
    var tenantCode = user.FindFirst("tenant")?.Value ?? string.Empty;
    var username = user.Identity?.Name ?? "System";
    if (string.IsNullOrWhiteSpace(tenantCode)) return Results.Unauthorized();

    var dealerCode = string.IsNullOrWhiteSpace(request.DealerCode) ? tenantCode : request.DealerCode.Trim();
    var dealerName = string.IsNullOrWhiteSpace(request.DealerName) ? dealerCode : request.DealerName.Trim();

    var typeRaw = string.IsNullOrWhiteSpace(request.Type) ? "Montaj" : request.Type.Trim();
    var type = IsArizaType(typeRaw) ? "Arıza" : "Montaj";

    var productName = string.IsNullOrWhiteSpace(request.ProductName) ? "-" : request.ProductName.Trim();
    var qty = request.Quantity <= 0 ? 1 : request.Quantity;
    var customerName = string.IsNullOrWhiteSpace(request.CustomerName) ? null : request.CustomerName.Trim();
    var phone = string.IsNullOrWhiteSpace(request.Phone) ? null : request.Phone.Trim();
    var address = string.IsNullOrWhiteSpace(request.Address) ? "-" : request.Address.Trim();
    var region = string.IsNullOrWhiteSpace(request.Region) ? "-" : request.Region.Trim();
    var note = string.IsNullOrWhiteSpace(request.Note) ? null : request.Note.Trim();

    await using var conn = await OpenTenantConnectionAsync(tenantCode, cancellationToken);
    await EnsureMontajTablesAsync(conn, cancellationToken);

    await using var cmd = conn.CreateCommand();
    cmd.CommandText = @"
INSERT INTO public.""Installations""(
  ""DealerCode"", ""DealerName"", ""ProductName"", ""Quantity"",
  ""InstallationName"", ""InstallationPhone"", ""Address"", ""Region"",
  ""DealerDescription"", ""Type"", ""Status"",
  ""PlannedDateUtc"", ""Technician"",
  ""CreateUser"", ""CreateTime""
)
VALUES(
  @dealerCode, @dealerName, @productName, @qty,
  @customerName, @phone, @address, @region,
  @note, @type, 'Yeni Kayıt',
  NULL, NULL,
  @createUser, now()
)
RETURNING ""Id"";
";
    cmd.Parameters.AddWithValue("dealerCode", dealerCode);
    cmd.Parameters.AddWithValue("dealerName", dealerName);
    cmd.Parameters.AddWithValue("productName", productName);
    cmd.Parameters.AddWithValue("qty", qty);
    cmd.Parameters.AddWithValue("customerName", (object?)customerName ?? DBNull.Value);
    cmd.Parameters.AddWithValue("phone", (object?)phone ?? DBNull.Value);
    cmd.Parameters.AddWithValue("address", address);
    cmd.Parameters.AddWithValue("region", region);
    cmd.Parameters.AddWithValue("note", (object?)note ?? DBNull.Value);
    cmd.Parameters.AddWithValue("type", type);
    cmd.Parameters.AddWithValue("createUser", username);

    var idObj = await cmd.ExecuteScalarAsync(cancellationToken);
    var id = idObj is null ? 0 : Convert.ToInt32(idObj);
    if (id <= 0) return Results.BadRequest(new { success = false, message = "Kayıt oluşturulamadı" });
    return Results.Ok(new { success = true, data = new { id } });
}).RequireAuthorization();

app.MapPut("/api/montaj/{id:int}/plan", async (ClaimsPrincipal user, int id, PlanMontajRequest request, CancellationToken cancellationToken) =>
{
    var tenantCode = user.FindFirst("tenant")?.Value ?? string.Empty;
    var username = user.Identity?.Name ?? "System";
    if (string.IsNullOrWhiteSpace(tenantCode)) return Results.Unauthorized();

    if (!request.PlannedDateUtc.HasValue) return Results.BadRequest(new { success = false, message = "Plan tarihi zorunlu" });
    var tech = string.IsNullOrWhiteSpace(request.Technician) ? null : request.Technician.Trim();
    if (string.IsNullOrWhiteSpace(tech)) return Results.BadRequest(new { success = false, message = "Teknisyen zorunlu" });

    await using var conn = await OpenTenantConnectionAsync(tenantCode, cancellationToken);
    await EnsureMontajTablesAsync(conn, cancellationToken);

    string currentStatus;
    string currentType;
    await using (var getCmd = conn.CreateCommand())
    {
        getCmd.CommandText = @"SELECT ""Status"", ""Type"" FROM public.""Installations"" WHERE ""Id""=@id LIMIT 1;";
        getCmd.Parameters.AddWithValue("id", id);
        await using var r = await getCmd.ExecuteReaderAsync(cancellationToken);
        if (!await r.ReadAsync(cancellationToken)) return Results.NotFound(new { success = false, message = "Kayıt bulunamadı" });
        currentStatus = r.GetString(0);
        currentType = r.GetString(1);
    }

    var st = NormalizeStatus(currentStatus);
    if (!(string.Equals(st, "Yeni Kayıt", StringComparison.OrdinalIgnoreCase) ||
          string.Equals(st, "Ertelendi", StringComparison.OrdinalIgnoreCase) ||
          string.Equals(st, "Atölye Hazır", StringComparison.OrdinalIgnoreCase)))
    {
        return Results.BadRequest(new { success = false, message = "Bu kayıt planlanamaz (geçersiz durum geçişi)." });
    }

    await using var upd = conn.CreateCommand();
    upd.CommandText = @"
UPDATE public.""Installations""
SET ""PlannedDateUtc""=@dt, ""Technician""=@tech, ""Status""='Planlandı', ""EditUser""=@u, ""EditTime""=now()
WHERE ""Id""=@id;
";
    upd.Parameters.AddWithValue("dt", DateTime.SpecifyKind(request.PlannedDateUtc.Value, DateTimeKind.Utc));
    upd.Parameters.AddWithValue("tech", tech);
    upd.Parameters.AddWithValue("u", username);
    upd.Parameters.AddWithValue("id", id);
    await upd.ExecuteNonQueryAsync(cancellationToken);
    return Results.Ok(new { success = true });
}).RequireAuthorization();

app.MapPut("/api/montaj/{id:int}/status", async (ClaimsPrincipal user, int id, UpdateMontajStatusRequest request, CancellationToken cancellationToken) =>
{
    var tenantCode = user.FindFirst("tenant")?.Value ?? string.Empty;
    var username = user.Identity?.Name ?? "System";
    if (string.IsNullOrWhiteSpace(tenantCode)) return Results.Unauthorized();

    var nextStatus = NormalizeStatus(request.Status);
    if (string.IsNullOrWhiteSpace(nextStatus)) return Results.BadRequest(new { success = false, message = "Durum zorunlu" });

    await using var conn = await OpenTenantConnectionAsync(tenantCode, cancellationToken);
    await EnsureMontajTablesAsync(conn, cancellationToken);

    string currentStatus;
    string currentType;
    await using (var getCmd = conn.CreateCommand())
    {
        getCmd.CommandText = @"SELECT ""Status"", ""Type"" FROM public.""Installations"" WHERE ""Id""=@id LIMIT 1;";
        getCmd.Parameters.AddWithValue("id", id);
        await using var r = await getCmd.ExecuteReaderAsync(cancellationToken);
        if (!await r.ReadAsync(cancellationToken)) return Results.NotFound(new { success = false, message = "Kayıt bulunamadı" });
        currentStatus = r.GetString(0);
        currentType = r.GetString(1);
    }

    var isAriza = IsArizaType(currentType);
    var allowed = AllowedNextStatuses(currentStatus, isAriza);
    if (!allowed.Contains(nextStatus))
    {
        return Results.BadRequest(new { success = false, message = "Geçersiz durum geçişi" });
    }

    await using var upd = conn.CreateCommand();
    upd.CommandText = @"
UPDATE public.""Installations""
SET ""Status""=@st,
    ""PlannedDateUtc"" = CASE WHEN lower(@st)=lower('Atölye Hazır') THEN NULL ELSE ""PlannedDateUtc"" END,
    ""Technician"" = CASE WHEN lower(@st)=lower('Atölye Hazır') THEN NULL ELSE ""Technician"" END,
    ""EditUser""=@u,
    ""EditTime""=now()
WHERE ""Id""=@id;
";
    upd.Parameters.AddWithValue("st", nextStatus);
    upd.Parameters.AddWithValue("u", username);
    upd.Parameters.AddWithValue("id", id);
    await upd.ExecuteNonQueryAsync(cancellationToken);
    return Results.Ok(new { success = true });
}).RequireAuthorization();

app.MapGet("/api/montaj/{id:int}/documents", async (ClaimsPrincipal user, int id, CancellationToken cancellationToken) =>
{
    var tenantCode = user.FindFirst("tenant")?.Value ?? string.Empty;
    if (string.IsNullOrWhiteSpace(tenantCode)) return Results.Unauthorized();

    await using var conn = await OpenTenantConnectionAsync(tenantCode, cancellationToken);
    await EnsureMontajTablesAsync(conn, cancellationToken);

    await using var cmd = conn.CreateCommand();
    cmd.CommandText = @"
SELECT ""Id"", ""InstallationId"", ""DocumentUrl"", ""UploadedDateUtc""
FROM public.""InstallationDocuments""
WHERE ""InstallationId""=@id
ORDER BY ""UploadedDateUtc"" DESC;
";
    cmd.Parameters.AddWithValue("id", id);

    await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
    var list = new List<object>();
    while (await reader.ReadAsync(cancellationToken))
    {
        list.Add(new
        {
            id = reader.GetInt32(0),
            installationId = reader.GetInt32(1),
            documentUrl = reader.GetString(2),
            uploadedDateUtc = reader.GetDateTime(3)
        });
    }

    return Results.Ok(new { success = true, data = list });
}).RequireAuthorization();

app.MapPost("/api/montaj/{id:int}/document", async (HttpRequest httpRequest, ClaimsPrincipal user, int id, IFormFile file, CancellationToken cancellationToken) =>
{
    var tenantCode = user.FindFirst("tenant")?.Value ?? string.Empty;
    var username = user.Identity?.Name ?? "System";
    if (string.IsNullOrWhiteSpace(tenantCode)) return Results.Unauthorized();
    if (file is null || file.Length == 0) return Results.BadRequest(new { success = false, message = "Dosya zorunlu" });

    await using var conn = await OpenTenantConnectionAsync(tenantCode, cancellationToken);
    await EnsureMontajTablesAsync(conn, cancellationToken);

    // Ensure installation exists
    await using (var existsCmd = conn.CreateCommand())
    {
        existsCmd.CommandText = @"SELECT 1 FROM public.""Installations"" WHERE ""Id""=@id LIMIT 1;";
        existsCmd.Parameters.AddWithValue("id", id);
        var ex = await existsCmd.ExecuteScalarAsync(cancellationToken);
        if (ex is null) return Results.NotFound(new { success = false, message = "Kayıt bulunamadı" });
    }

    var ext = Path.GetExtension(file.FileName);
    ext = string.IsNullOrWhiteSpace(ext) ? ".bin" : ext;
    ext = ext.Length > 10 ? ext[..10] : ext;

    var folder = Path.Combine(Directory.GetCurrentDirectory(), "wwwroot", "uploads", "montaj");
    Directory.CreateDirectory(folder);

    var fileName = $"{Guid.NewGuid():N}{ext}";
    var fullPath = Path.Combine(folder, fileName);

    await using (var stream = File.Create(fullPath))
    {
        await file.CopyToAsync(stream, cancellationToken);
    }

    var relativeUrl = $"/uploads/montaj/{fileName}";
    var absoluteUrl = $"{httpRequest.Scheme}://{httpRequest.Host}{relativeUrl}";

    await using var cmd = conn.CreateCommand();
    cmd.CommandText = @"
INSERT INTO public.""InstallationDocuments""(
  ""InstallationId"", ""DocumentUrl"", ""UploadedDateUtc"", ""CreateUser"", ""CreateTime""
)
VALUES(@id, @url, now(), @u, now())
RETURNING ""Id"";
";
    cmd.Parameters.AddWithValue("id", id);
    cmd.Parameters.AddWithValue("url", absoluteUrl);
    cmd.Parameters.AddWithValue("u", username);
    var docIdObj = await cmd.ExecuteScalarAsync(cancellationToken);
    var docId = docIdObj is null ? 0 : Convert.ToInt32(docIdObj);
    if (docId <= 0) return Results.BadRequest(new { success = false, message = "Belge yüklenemedi" });

    return Results.Ok(new { success = true, data = new { id = docId, url = absoluteUrl } });
}).DisableAntiforgery().RequireAuthorization();

app.Run();

public sealed record LoginRequest(string TenantCode, string Username, string Password);

public sealed record CreateMontajRequest(
    string? DealerCode,
    string? DealerName,
    string ProductName,
    decimal Quantity,
    string CustomerName,
    string Phone,
    string Address,
    string Region,
    string? Note,
    string? Type);

public sealed record PlanMontajRequest(DateTime? PlannedDateUtc, string Technician);

public sealed record UpdateMontajStatusRequest(string Status);
