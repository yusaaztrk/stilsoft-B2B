using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.IdentityModel.Tokens;

namespace Shop.Api.Admin;

/// <summary>
/// Vitrin yönetim uçlarının kapısı: isteği yapan, bayi panelinde oturum açmış bir PERSONEL olmalı.
///
/// Mağaza kendi personel kullanıcısı tutmuyor — tutsaydı ikinci bir kullanıcı yönetimi, ikinci
/// bir şifre ve "hangi paneldeydi" karmaşası çıkardı. Bunun yerine bayinin verdiği token burada
/// DOĞRULANIYOR: imza, süre ve firma kontrol ediliyor.
///
/// Token yalnızca kimlik kanıtı olarak kullanılır; bu API onunla ERP'ye gidip bir şey yapmaz.
/// ERP'ye yazma işlemleri ayrı bir servis anahtarıyla yürür (bkz. ErpWriteClient).
///
/// ServiceOps'taki devir ucu da aynı yaklaşımı kullanıyor: başka bir sistemin imzasını
/// doğrulamak, o sistemin kullanıcı listesini kopyalamaktan iyidir.
/// </summary>
[AttributeUsage(AttributeTargets.Method | AttributeTargets.Class)]
public sealed class B2BAdminAuthAttribute : Attribute, IAsyncAuthorizationFilter, IAllowAnonymous
{
    public const string PrincipalItemKey = "Shop.B2BPrincipal";

    public Task OnAuthorizationAsync(AuthorizationFilterContext context)
    {
        var configuration = context.HttpContext.RequestServices.GetRequiredService<IConfiguration>();

        var key = configuration["B2BJwt:SecretKey"];
        if (string.IsNullOrWhiteSpace(key))
        {
            // Anahtar yoksa doğrulama yapılamaz; token'ı doğrulamadan kabul etmek yönetim
            // uçlarını herkese açardı. Kapalı başarısız olunuyor.
            context.Result = new ObjectResult(new { message = "Yönetim doğrulaması yapılandırılmamış." })
            {
                StatusCode = StatusCodes.Status503ServiceUnavailable
            };
            return Task.CompletedTask;
        }

        var raw = context.HttpContext.Request.Headers.Authorization.ToString();
        if (raw.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase)) raw = raw[7..].Trim();

        if (string.IsNullOrWhiteSpace(raw))
        {
            context.Result = new UnauthorizedResult();
            return Task.CompletedTask;
        }

        ClaimsPrincipal principal;
        try
        {
            var issuer = configuration["B2BJwt:Issuer"];
            var audience = configuration["B2BJwt:Audience"];

            principal = new JwtSecurityTokenHandler().ValidateToken(raw, new TokenValidationParameters
            {
                ValidateIssuerSigningKey = true,
                IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(key)),
                ValidateIssuer = !string.IsNullOrWhiteSpace(issuer),
                ValidIssuer = issuer,
                ValidateAudience = !string.IsNullOrWhiteSpace(audience),
                ValidAudience = audience,
                ValidateLifetime = true,
                ClockSkew = TimeSpan.FromMinutes(1)
            }, out _);
        }
        catch
        {
            // Sebep dışarı verilmiyor: "imza mı bozuk, süresi mi doldu" bilgisi denemeyi kolaylaştırır.
            context.Result = new UnauthorizedResult();
            return Task.CompletedTask;
        }

        context.HttpContext.Items[PrincipalItemKey] = principal;
        return Task.CompletedTask;
    }
}
