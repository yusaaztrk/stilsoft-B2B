using System;
using System.Buffers;
using System.Data;
using System.IO;
using System.Linq;
using System.Net;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using B2B.Erp.Api.Data;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace B2B.Erp.Api.Middleware
{
    public sealed class GlobalExceptionMiddleware
    {
        private const int MaxBodyChars = 4000;
        private readonly RequestDelegate _next;
        private readonly ILogger<GlobalExceptionMiddleware> _logger;
        private readonly IServiceScopeFactory _scopeFactory;

        public GlobalExceptionMiddleware(RequestDelegate next, ILogger<GlobalExceptionMiddleware> logger, IServiceScopeFactory scopeFactory)
        {
            _next = next;
            _logger = logger;
            _scopeFactory = scopeFactory;
        }

        public async Task InvokeAsync(HttpContext context)
        {
            if (!ShouldInspect(context))
            {
                try
                {
                    await _next(context);
                }
                catch (OperationCanceledException)
                {
                    _logger.LogInformation("[GlobalExceptionMiddleware]: Request canceled by client ({Path})", context.Request.Path);
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "[GlobalExceptionMiddleware caught exception]: {Message}", ex.Message);
                    await LogExceptionToDatabaseAsync(context, ex, null);
                    await HandleResponseAsync(context, ex);
                }

                return;
            }

            var originalBody = context.Response.Body;
            await using var capturedBody = new MemoryStream();
            context.Response.Body = capturedBody;
            var requestBodySummary = await ReadRequestBodySummaryAsync(context);

            try
            {
                await _next(context);

                capturedBody.Position = 0;
                var responseBody = await new StreamReader(capturedBody, Encoding.UTF8, detectEncodingFromByteOrderMarks: false, leaveOpen: true).ReadToEndAsync();

                if (ShouldLogStatus(context.Response.StatusCode))
                {
                    await LogHttpStatusToDatabaseAsync(context, responseBody, requestBodySummary);
                }

                capturedBody.Position = 0;
                context.Response.Body = originalBody;
                await capturedBody.CopyToAsync(originalBody);
            }
            catch (OperationCanceledException)
            {
                context.Response.Body = originalBody;
                _logger.LogInformation("[GlobalExceptionMiddleware]: Request canceled by client ({Path})", context.Request.Path);
            }
            catch (Exception ex)
            {
                context.Response.Body = originalBody;
                _logger.LogError(ex, "[GlobalExceptionMiddleware caught exception]: {Message}", ex.Message);
                await LogExceptionToDatabaseAsync(context, ex, requestBodySummary);
                await HandleResponseAsync(context, ex);
            }
            finally
            {
                context.Response.Body = originalBody;
            }
        }

        private static bool ShouldInspect(HttpContext context)
        {
            if (!context.Request.Path.StartsWithSegments("/api")) return false;
            if (context.Request.Path.StartsWithSegments("/api/system-error-logs")) return false;
            if (HttpMethods.IsOptions(context.Request.Method)) return false;
            return true;
        }

        private static bool ShouldLogStatus(int statusCode)
        {
            if (statusCode is 401 or 403) return false;
            return statusCode >= 400;
        }

        private async Task LogExceptionToDatabaseAsync(HttpContext context, Exception ex, string? requestBodySummary)
        {
            var details = BuildBaseDetails(context, requestBodySummary);
            var innerMsg = ex.InnerException?.Message;
            if (ex.InnerException?.InnerException != null)
            {
                innerMsg += " ---> " + ex.InnerException.InnerException.Message;
            }

            await InsertLogAsync(
                details,
                ex.GetType().FullName ?? ex.GetType().Name,
                ex.Message,
                innerMsg,
                ex.StackTrace,
                context.Response.StatusCode == 200 ? 500 : context.Response.StatusCode,
                "B2B.Erp.Api");
        }

        private async Task LogHttpStatusToDatabaseAsync(HttpContext context, string responseBody, string? requestBodySummary)
        {
            var details = BuildBaseDetails(context, requestBodySummary);
            var message = ExtractResponseMessage(responseBody);
            if (string.IsNullOrWhiteSpace(message))
            {
                message = $"HTTP {context.Response.StatusCode} response returned.";
            }

            await InsertLogAsync(
                details,
                $"HttpStatus{context.Response.StatusCode}",
                message,
                Truncate(responseBody),
                null,
                context.Response.StatusCode,
                "B2B.Erp.Api");
        }

        private async Task InsertLogAsync(LogDetails details, string exceptionType, string errorMessage, string? innerExceptionMessage, string? stackTrace, int statusCode, string sourceModule)
        {
            try
            {
                using var scope = _scopeFactory.CreateScope();
                var dbContext = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                await EnsureTableExistsAsync(dbContext);

                var connection = dbContext.Database.GetDbConnection();
                if (connection.State != ConnectionState.Open)
                {
                    await connection.OpenAsync();
                }

                await using var command = connection.CreateCommand();
                command.CommandText = @"
INSERT INTO ""SystemErrorLogs"" (
    ""CreatedAt"", ""LocalTime"", ""UserId"", ""Username"", ""UserDisplayName"", ""RoleName"", ""CariKodu"", ""UserIp"",
    ""HttpMethod"", ""RequestPath"", ""QueryString"", ""RequestBodySummary"", ""ExceptionType"", ""ErrorMessage"",
    ""InnerExceptionMessage"", ""StackTrace"", ""StatusCode"", ""SourceModule"", ""TenantCode"", ""IsResolved""
) VALUES (
    @createdAt, @localTime, @userId, @username, @userDisplayName, @roleName, @cariKodu, @userIp,
    @httpMethod, @requestPath, @queryString, @requestBodySummary, @exceptionType, @errorMessage,
    @innerExceptionMessage, @stackTrace, @statusCode, @sourceModule, @tenantCode, FALSE
);";

                AddParameter(command, "@createdAt", DateTime.UtcNow);
                AddParameter(command, "@localTime", DateTime.Now);
                AddParameter(command, "@userId", details.UserId);
                AddParameter(command, "@username", details.Username);
                AddParameter(command, "@userDisplayName", details.UserDisplayName);
                AddParameter(command, "@roleName", details.RoleName);
                AddParameter(command, "@cariKodu", details.CariKodu);
                AddParameter(command, "@userIp", details.UserIp);
                AddParameter(command, "@httpMethod", details.HttpMethod);
                AddParameter(command, "@requestPath", details.RequestPath);
                AddParameter(command, "@queryString", details.QueryString);
                AddParameter(command, "@requestBodySummary", details.RequestBodySummary);
                AddParameter(command, "@exceptionType", Truncate(exceptionType));
                AddParameter(command, "@errorMessage", Truncate(errorMessage));
                AddParameter(command, "@innerExceptionMessage", Truncate(innerExceptionMessage));
                AddParameter(command, "@stackTrace", Truncate(stackTrace, 12000));
                AddParameter(command, "@statusCode", statusCode);
                AddParameter(command, "@sourceModule", sourceModule);
                AddParameter(command, "@tenantCode", details.TenantCode);

                await command.ExecuteNonQueryAsync();
            }
            catch (Exception dbEx)
            {
                _logger.LogError(dbEx, "[GlobalExceptionMiddleware - Failed to save error log to DB]: {Message}", dbEx.Message);
            }
        }

        // Şema DDL'i her hata kaydında değil, veritabanı başına bir kez çalışır —
        // bkz. B2B.Erp.Api.Core.Services.SystemErrorLogSchema.
        private static Task EnsureTableExistsAsync(AppDbContext dbContext)
            => B2B.Erp.Api.Core.Services.SystemErrorLogSchema.EnsureAsync(dbContext);

        private static LogDetails BuildBaseDetails(HttpContext context, string? requestBodySummary)
        {
            var user = context.User;
            var username = user.FindFirst("username")?.Value
                ?? user.FindFirst(ClaimTypes.Name)?.Value
                ?? user.FindFirst(ClaimTypes.NameIdentifier)?.Value
                ?? "Anonim";

            var userDisplayName = user.FindFirst("unvan")?.Value
                ?? user.FindFirst("Unvan")?.Value
                ?? user.FindFirst("fullName")?.Value
                ?? user.FindFirst("name")?.Value
                ?? username;

            var roleName = user.FindFirst("role")?.Value
                ?? user.FindFirst(ClaimTypes.Role)?.Value
                ?? string.Empty;

            var cariKodu = user.FindFirst("cariKodu")?.Value
                ?? user.FindFirst("CariKodu")?.Value
                ?? user.FindFirst("employeeNumber")?.Value;

            int? userId = null;
            var userIdClaim = user.FindFirst("id")?.Value ?? user.FindFirst(ClaimTypes.NameIdentifier)?.Value;
            if (int.TryParse(userIdClaim, out var parsedId)) userId = parsedId;

            var ip = context.Connection.RemoteIpAddress?.ToString() ?? string.Empty;
            if (context.Request.Headers.TryGetValue("X-Forwarded-For", out var fwd))
            {
                ip = fwd.ToString().Split(',')[0].Trim();
            }

            var tenantCode = context.Request.Headers["X-Tenant-Code"].FirstOrDefault()
                ?? user.FindFirst("TenantCode")?.Value
                ?? user.FindFirst("tenantCode")?.Value
                ?? "DEMO";

            return new LogDetails(
                userId,
                username,
                userDisplayName,
                roleName,
                cariKodu,
                ip,
                context.Request.Method,
                context.Request.Path.Value ?? string.Empty,
                context.Request.QueryString.HasValue ? context.Request.QueryString.Value : null,
                requestBodySummary,
                tenantCode);
        }

        private static async Task<string?> ReadRequestBodySummaryAsync(HttpContext context)
        {
            if (HttpMethods.IsGet(context.Request.Method) || HttpMethods.IsHead(context.Request.Method)) return null;
            if (context.Request.ContentLength is null or 0) return null;

            try
            {
                context.Request.EnableBuffering();
                context.Request.Body.Position = 0;
                using var reader = new StreamReader(context.Request.Body, Encoding.UTF8, detectEncodingFromByteOrderMarks: false, leaveOpen: true);
                var body = await reader.ReadToEndAsync();
                context.Request.Body.Position = 0;
                return Truncate(ScrubSensitive(body));
            }
            catch
            {
                return null;
            }
        }

        private static string ExtractResponseMessage(string responseBody)
        {
            if (string.IsNullOrWhiteSpace(responseBody)) return string.Empty;
            try
            {
                using var doc = JsonDocument.Parse(responseBody);
                var root = doc.RootElement;
                if (root.TryGetProperty("message", out var message)) return message.ToString();
                if (root.TryGetProperty("error", out var error)) return error.ToString();
                if (root.TryGetProperty("title", out var title)) return title.ToString();
                if (root.TryGetProperty("detail", out var detail)) return detail.ToString();
            }
            catch
            {
                // Plain text or non-JSON response.
            }

            // Bilinen bir mesaj alanı bulunamadıysa gövdenin tamamı yazılıyor; o yüzden burada da
            // maskeden geçiyor. İstek gövdesi maskeleniyorken yanıtın ham geçmesi, aynı veriyi
            // yankılayan bir uçta maskelemeyi anlamsız kılardı.
            return Truncate(ScrubSensitive(responseBody)) ?? string.Empty;
        }

        private static string ScrubSensitive(string value)
        {
            if (string.IsNullOrWhiteSpace(value)) return value;
            try
            {
                using var doc = JsonDocument.Parse(value);
                return ScrubElement(doc.RootElement).GetRawText();
            }
            catch
            {
                return value;
            }
        }

        private static JsonElement ScrubElement(JsonElement element)
        {
            var buffer = new ArrayBufferWriter<byte>();
            using (var writer = new Utf8JsonWriter(buffer))
            {
                WriteScrubbedElement(writer, element);
            }

            using var doc = JsonDocument.Parse(buffer.WrittenMemory);
            return doc.RootElement.Clone();
        }

        private static void WriteScrubbedElement(Utf8JsonWriter writer, JsonElement element)
        {
            switch (element.ValueKind)
            {
                case JsonValueKind.Object:
                    writer.WriteStartObject();
                    foreach (var property in element.EnumerateObject())
                    {
                        writer.WritePropertyName(property.Name);
                        if (IsSensitiveKey(property.Name)) writer.WriteStringValue("***");
                        else WriteScrubbedElement(writer, property.Value);
                    }
                    writer.WriteEndObject();
                    break;
                case JsonValueKind.Array:
                    writer.WriteStartArray();
                    foreach (var item in element.EnumerateArray()) WriteScrubbedElement(writer, item);
                    writer.WriteEndArray();
                    break;
                default:
                    element.WriteTo(writer);
                    break;
            }
        }

        /// <summary>
        /// Gövdesi log'a yazılmadan önce değeri "***" ile değiştirilecek alan adları.
        ///
        /// Parola/token/secret zaten kapsanıyordu; KART ALANLARI kapsanmıyordu. 400 ve 500
        /// dönen her istek gövdesi SystemErrorLogs'a yazıldığı için, doğrulamadan geçemeyen bir
        /// `POST /api/ecommerce/payments/start` çağrısı kart numarasını, son kullanma tarihini
        /// ve CVC'yi veritabanına düz metin olarak bırakıyordu.
        ///
        /// Eşleşme "içerir" mantığında: alan adı camelCase, PascalCase ya da Türkçe olabilir
        /// (cardNumber / CardNumber / kartNo) ve hepsini tek tek saymak, bir sonraki alan
        /// eklendiğinde sessizce eksik kalırdı.
        /// </summary>
        private static readonly string[] SensitiveKeyFragments =
        {
            "password", "sifre", "şifre", "token", "secret", "apikey", "authorization",
            // Kart ve ödeme materyali
            "card", "kart", "pan", "cvc", "cvv", "expmonth", "expyear", "sonkullanma",
            // Banka / kimlik
            "iban", "hash",
        };

        private static bool IsSensitiveKey(string key)
        {
            var k = key.ToLowerInvariant();
            foreach (var fragment in SensitiveKeyFragments)
            {
                if (k.Contains(fragment, StringComparison.Ordinal)) return true;
            }
            return false;
        }

        private static string? Truncate(string? value, int max = MaxBodyChars)
        {
            if (string.IsNullOrEmpty(value)) return value;
            return value.Length <= max ? value : value[..max] + "...";
        }

        private static void AddParameter(IDbCommand command, string name, object? value)
        {
            var parameter = command.CreateParameter();
            parameter.ParameterName = name;
            parameter.Value = value ?? DBNull.Value;
            command.Parameters.Add(parameter);
        }

        private static async Task HandleResponseAsync(HttpContext context, Exception ex)
        {
            if (!context.Response.HasStarted)
            {
                context.Response.Clear();
                context.Response.ContentType = "application/json";
                context.Response.StatusCode = (int)HttpStatusCode.InternalServerError;

                var responsePayload = new
                {
                    success = false,
                    message = $"Sistem hatası oluştu ve hata loglarına kaydedildi: {ex.Message}",
                    errorType = ex.GetType().Name,
                    path = context.Request.Path.Value,
                    timestamp = DateTime.Now.ToString("dd.MM.yyyy HH:mm:ss")
                };

                var options = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
                await context.Response.WriteAsync(JsonSerializer.Serialize(responsePayload, options));
            }
        }

        private sealed record LogDetails(
            int? UserId,
            string Username,
            string UserDisplayName,
            string RoleName,
            string? CariKodu,
            string UserIp,
            string HttpMethod,
            string RequestPath,
            string? QueryString,
            string? RequestBodySummary,
            string TenantCode);
    }
}

