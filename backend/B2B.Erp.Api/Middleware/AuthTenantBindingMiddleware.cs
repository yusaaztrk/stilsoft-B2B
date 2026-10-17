using System;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;

namespace B2B.Erp.Api.Middleware;

/// <summary>
/// Giriş isteklerinde firmayı İSTEK GÖVDESİNDEN bağlar.
///
/// SORUN: <c>AppDbContext</c> hangi veritabanına bağlanacağını, DI onu ürettiği anda —
/// yani CONTROLLER OLUŞTURULURKEN — seçer. <c>AuthController.Login</c> ise gövdeden gelen
/// <c>tenantCode</c>'u <c>X-Tenant-Code</c> başlığına action'ın İÇİNDE yazıyordu; o noktada
/// bağlantı çoktan seçilmiş oluyor ve yazılan başlığın hiçbir etkisi kalmıyordu.
///
/// Sonucu şuydu: giriş ekranında seçilen firma, kullanıcının aranacağı veritabanını
/// BELİRLEMİYORDU. Belirleyen tek şey, tarayıcıdaki global fetch sarmalayıcısının
/// (frontend/src/main.tsx) localStorage'dan okuyup eklediği başlıktı — ve o değer bir ÖNCEKİ
/// oturumdan kalmadır. Yani:
///   - Varsayılan veritabanındaki (b2b_erp / DEMO) kullanıcılar giriş yapabiliyor,
///   - Başka firmadaki kullanıcılar "Kullanıcı adı veya şifre hatalı" alıyordu — hesap doğru,
///     şifre doğru, sadece yanlış veritabanında aranıyordu.
///
/// Doğrulandı (2026-08-10): DEMOTEST'teki 'ezgi' hesabı, gövdede tenantCode=DEMOTEST ile
/// 401; aynı istek X-Tenant-Code=DEMOTEST başlığıyla 200.
///
/// ÇÖZÜM: gövdeyi controller'dan önce, ara katmanda okuyup başlığı burada yazmak.
///
/// Gövde BAŞLIĞI EZER — bilinçli. Buradaki başlık bayat oturum durumu, gövdedeki değer ise
/// kullanıcının giriş ekranında az önce yaptığı açık seçim. Sadece "başlık yoksa yaz" demek,
/// asıl arızayı (yanlış firmada arama) çözmezdi.
///
/// Gövdede firma yoksa başlığa DOKUNULMAZ: yönetim (ssa) girişi firma seçmeden yapılır ve
/// kimlik master veritabanından doğrulanır.
///
/// Aynı desen ServiceOps tarafında da var (service-ops-api/ServiceOps.Api/Program.cs).
/// </summary>
public sealed class AuthTenantBindingMiddleware
{
    private const string TenantHeader = "X-Tenant-Code";

    /// <summary>Gövdesinde firma kodu taşıyan anonim kimlik uçları.</summary>
    private static readonly string[] BodyTenantPaths =
    {
        "/api/auth/login",
        "/api/auth/send-whatsapp-otp",
        "/api/auth/verify-whatsapp-otp",
    };

    private readonly RequestDelegate _next;

    public AuthTenantBindingMiddleware(RequestDelegate next)
    {
        _next = next;
    }

    public async Task InvokeAsync(HttpContext context)
    {
        if (!HttpMethods.IsPost(context.Request.Method) || !IsBodyTenantPath(context.Request.Path))
        {
            await _next(context);
            return;
        }

        try
        {
            // Gövde model binding tarafından tekrar okunacak; geri sarılabilir olmalı.
            context.Request.EnableBuffering();

            using (var reader = new StreamReader(
                context.Request.Body, Encoding.UTF8, detectEncodingFromByteOrderMarks: false, leaveOpen: true))
            {
                var body = await reader.ReadToEndAsync();
                context.Request.Body.Position = 0;

                var tenantCode = ExtractTenantCode(body);
                if (!string.IsNullOrWhiteSpace(tenantCode))
                {
                    context.Request.Headers[TenantHeader] = tenantCode;
                }
            }
        }
        catch
        {
            // Gövde okunamadıysa giriş yine denenir; yalnızca firma bağlama atlanır. Buradaki bir
            // arıza, kimlik doğrulamasını tamamen durdurmamalı.
            try { context.Request.Body.Position = 0; } catch { /* ignore */ }
        }

        await _next(context);
    }

    private static bool IsBodyTenantPath(PathString path)
    {
        foreach (var candidate in BodyTenantPaths)
        {
            if (path.StartsWithSegments(candidate, StringComparison.OrdinalIgnoreCase)) return true;
        }
        return false;
    }

    /// <summary>
    /// Gövdedeki <c>tenantCode</c>. Yalnızca string değer kabul edilir ve değer veritabanı adına
    /// dönüştüğü için karakter kümesi kısıtlanır — bozuk bir değer, olmayan bir veritabanına
    /// yönlenip kapalı başarısız olur.
    /// </summary>
    private static string? ExtractTenantCode(string body)
    {
        if (string.IsNullOrWhiteSpace(body)) return null;

        using var doc = JsonDocument.Parse(body);
        if (doc.RootElement.ValueKind != JsonValueKind.Object) return null;

        if (!doc.RootElement.TryGetProperty("tenantCode", out var element)
            || element.ValueKind != JsonValueKind.String)
        {
            return null;
        }

        var code = (element.GetString() ?? string.Empty).Trim();
        if (code.Length == 0 || code.Length > 40) return null;

        foreach (var c in code)
        {
            if (!char.IsLetterOrDigit(c) && c != '_' && c != '-') return null;
        }

        return code;
    }
}
