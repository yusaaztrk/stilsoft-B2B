using Ecommerce.Api.Infrastructure;
using Ecommerce.Api.Infrastructure.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using System.Security.Claims;
using System.Linq;
using System.Net.Http.Json;

namespace Ecommerce.Api.Controllers;

[ApiController]
[Route("api/auth")]
public sealed class AuthController : ControllerBase
{
    private readonly EcommerceUsersRepository _users;
    private readonly JwtTokenService _jwt;
    private readonly IConfiguration _configuration;
    private readonly IHttpClientFactory _clientFactory;
    private readonly AdminModulesRepository _adminModules;

    public AuthController(
        EcommerceUsersRepository users, 
        JwtTokenService jwt, 
        IConfiguration configuration, 
        IHttpClientFactory clientFactory, 
        AdminModulesRepository adminModules)
    {
        _users = users;
        _jwt = jwt;
        _configuration = configuration;
        _clientFactory = clientFactory;
        _adminModules = adminModules;
    }

    public sealed class RegisterRequest
    {
        public string FullName { get; set; } = string.Empty;
        public string Email { get; set; } = string.Empty;
        public string Phone { get; set; } = string.Empty;
        public string Password { get; set; } = string.Empty;
    }

    public sealed class LoginRequest
    {
        public string Email { get; set; } = string.Empty;
        public string Password { get; set; } = string.Empty;
    }

    [HttpPost("register")]
    public async Task<IActionResult> Register([FromBody] RegisterRequest request, CancellationToken cancellationToken)
    {
        var email = (request.Email ?? string.Empty).Trim().ToLowerInvariant();
        var fullName = (request.FullName ?? string.Empty).Trim();
        var phoneRaw = (request.Phone ?? string.Empty).Trim();
        var phone = new string(phoneRaw.Where(char.IsDigit).ToArray());

        if (string.IsNullOrWhiteSpace(fullName))
            return BadRequest(new { success = false, message = "Ad soyad zorunlu" });

        if (string.IsNullOrWhiteSpace(email) || !email.Contains('@', StringComparison.Ordinal))
            return BadRequest(new { success = false, message = "Geçerli bir e-posta girin" });

        if (string.IsNullOrWhiteSpace(phone) || phone.Length != 11)
            return BadRequest(new { success = false, message = "Telefon numarası 11 haneli olmalıdır" });

        if ((request.Password ?? string.Empty).Length < 8)
            return BadRequest(new { success = false, message = "Şifre en az 8 karakter olmalı" });

        if (await _users.GetByEmailAsync(email, cancellationToken) is not null)
            return Conflict(new { success = false, message = "Bu e-posta zaten kayitli" });

        // Generate a 6-digit confirmation code
        var code = new System.Random().Next(100000, 999999).ToString();
        var passwordHash = EcommerceUsersRepository.HashPassword(request.Password ?? string.Empty);

        // Store registration info in pending_registrations
        var insertSql = @"
            INSERT INTO pending_registrations (id, email, full_name, phone, password_hash, code, created_at_utc)
            VALUES (@Id, @Email, @FullName, @Phone, @PasswordHash, @Code, (now() AT TIME ZONE 'utc'))
            ON CONFLICT (email) DO UPDATE SET
                full_name = EXCLUDED.full_name,
                phone = EXCLUDED.phone,
                password_hash = EXCLUDED.password_hash,
                code = EXCLUDED.code,
                created_at_utc = (now() AT TIME ZONE 'utc');";

        try
        {
            await _adminModules.ExecuteSqlAsync(insertSql, new {
                Id = Guid.NewGuid(),
                Email = email,
                FullName = fullName,
                Phone = phone,
                PasswordHash = passwordHash,
                Code = code
            }, cancellationToken);
        }
        catch (Exception ex)
        {
            return BadRequest(new { success = false, message = $"Kayıt işlemi başlatılamadı: {ex.Message}" });
        }

        // Send confirmation email
        var subject = "B2B ERP Üyelik Onay Kodu";
        var emailBody = $@"
            <div style=""font-family: sans-serif; padding: 20px; color: #333;"">
                <h3 style=""color: #3b82f6;"">B2B ERP E-Ticaret Sistemine Hoş Geldiniz!</h3>
                <p>Üyelik kaydınızı tamamlamak için aşağıdaki 6 haneli onay kodunu ilgili ekrana giriniz:</p>
                <div style=""background: #f3f4f6; padding: 15px; border-radius: 8px; display: inline-block; font-size: 24px; font-weight: bold; letter-spacing: 5px; color: #1e3a8a; margin: 15px 0;"">
                    {code}
                </div>
                <p style=""font-size: 12px; color: #6b7280;"">Bu onay kodu 15 dakika süreyle geçerlidir.</p>
                <p>Bizi tercih ettiğiniz için teşekkür ederiz.</p>
                <hr style=""border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;"" />
                <p style=""font-size: 11px; color: #9ca3af;"">Saygılarımızla,<br/>B2B ERP E-Ticaret Ekibi</p>
            </div>";

        await SendEmailAsync(email, subject, emailBody, cancellationToken);

        return Ok(new { success = true, verificationRequired = true, email = email });
    }

    public sealed class VerifyRegisterRequest
    {
        public string Email { get; set; } = string.Empty;
        public string Code { get; set; } = string.Empty;
    }

    [HttpPost("verify-register")]
    public async Task<IActionResult> VerifyRegister([FromBody] VerifyRegisterRequest request, CancellationToken cancellationToken)
    {
        var email = (request.Email ?? string.Empty).Trim().ToLowerInvariant();
        var code = (request.Code ?? string.Empty).Trim();

        if (string.IsNullOrWhiteSpace(email) || string.IsNullOrWhiteSpace(code))
            return BadRequest(new { success = false, message = "E-posta ve onay kodu gereklidir." });

        var selectSql = "SELECT id, email, full_name AS \"fullName\", phone, password_hash AS \"passwordHash\", code, created_at_utc AS \"createdAtUtc\" FROM pending_registrations WHERE LOWER(email) = @Email";
        var rows = await _adminModules.QuerySqlAsync(selectSql, new { Email = email }, cancellationToken);

        if (rows.Count == 0)
            return BadRequest(new { success = false, message = "Kayıt talebi bulunamadı veya süresi dolmuş." });

        var row = rows[0];
        var dbCode = row["code"]?.ToString() ?? string.Empty;
        var createdAt = Convert.ToDateTime(row["createdAtUtc"]);

        if (dbCode != code)
            return BadRequest(new { success = false, message = "Hatalı onay kodu girdiniz." });

        if (DateTime.UtcNow - createdAt.ToUniversalTime() > TimeSpan.FromMinutes(15))
            return BadRequest(new { success = false, message = "Onay kodunun süresi dolmuş (15 dakika). Lütfen tekrar kaydolun." });

        var fullName = row["fullName"]?.ToString() ?? string.Empty;
        var phone = row["phone"]?.ToString() ?? string.Empty;
        var passwordHash = row["passwordHash"]?.ToString() ?? string.Empty;

        // Double check email presence
        if (await _users.GetByEmailAsync(email, cancellationToken) is not null)
            return Conflict(new { success = false, message = "Bu e-posta zaten kayıtlı." });

        var user = await _users.CreateAsync(new EcommerceUser
        {
            Email = email,
            FullName = fullName,
            Phone = phone,
            PasswordHash = passwordHash,
            Role = "Customer",
            PermissionsCsv = ""
        }, cancellationToken);

        // Delete from pending registrations
        try
        {
            var deleteSql = "DELETE FROM pending_registrations WHERE LOWER(email) = @Email";
            await _adminModules.ExecuteSqlAsync(deleteSql, new { Email = email }, cancellationToken);
        }
        catch {}

        var token = _jwt.CreateToken(user.Email, user.Role, Array.Empty<string>(), user.Id);
        return Ok(new { success = true, data = new { accessToken = token, user = SafeUser(user) } });
    }

    private async Task SendEmailAsync(string recipient, string subject, string body, CancellationToken cancellationToken)
    {
        try
        {
            var emailServiceUrl = (_configuration["EmailService:BaseUrl"] ?? "http://localhost:5250").TrimEnd('/');
            var apiKey = _configuration["EmailService:ApiKey"] ?? "B2B_ERP_EmailService_Default_Secret_API_Key_123!";

            var client = _clientFactory.CreateClient();
            client.DefaultRequestHeaders.Add("X-API-Key", apiKey);

            var payload = new
            {
                tenantId = "DEFAULT",
                recipient = recipient.Trim(),
                subject = subject.Trim(),
                body = body,
                attachments = (object?)null,
                scheduledFor = (object?)null
            };

            var json = System.Text.Json.JsonSerializer.Serialize(payload);
            var content = new System.Net.Http.StringContent(json, System.Text.Encoding.UTF8, "application/json");

            var response = await client.PostAsync($"{emailServiceUrl}/api/email/send", content, cancellationToken);
            if (!response.IsSuccessStatusCode)
            {
                var error = await response.Content.ReadAsStringAsync(cancellationToken);
                Console.WriteLine($"Email service error: {response.StatusCode} - {error}");
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine($"Failed to contact email service: {ex.Message}");
        }
    }

    [HttpPost("login")]
    public async Task<IActionResult> Login([FromBody] LoginRequest request, CancellationToken cancellationToken)
    {
        var user = await _users.GetByEmailAsync(request.Email, cancellationToken);
        if (user is null)
            return Unauthorized(new { success = false, message = "E-posta veya sifre hatali" });

        if (!user.IsActive)
            return Unauthorized(new { success = false, message = "Hesabınız sistem tarafından engellenmiştir" });

        if (!EcommerceUsersRepository.VerifyPassword(request.Password, user.PasswordHash))
            return Unauthorized(new { success = false, message = "E-posta veya sifre hatali" });

        var permissions = user.PermissionsCsv.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        var token = _jwt.CreateToken(user.Email, user.Role, permissions, user.Id);
        return Ok(new { success = true, data = new { accessToken = token, user = SafeUser(user) } });
    }

    public sealed class UpdateProfileRequest
    {
        public string FullName { get; set; } = string.Empty;
        public string Phone { get; set; } = string.Empty;
        public string? Password { get; set; }
        public string? OldPassword { get; set; }
    }

    [Authorize]
    [HttpGet("me")]
    public async Task<IActionResult> Me(CancellationToken cancellationToken)
    {
        var email = User.FindFirstValue(ClaimTypes.Email) ?? User.Identity?.Name ?? "";
        var user = await _users.GetByEmailAsync(email, cancellationToken);
        return user is null ? Unauthorized(new { success = false }) : Ok(new { success = true, data = SafeUser(user) });
    }

    [Authorize]
    [HttpPost("update-profile")]
    public async Task<IActionResult> UpdateProfile([FromBody] UpdateProfileRequest request, CancellationToken cancellationToken)
    {
        var email = User.FindFirstValue(ClaimTypes.Email) ?? User.Identity?.Name ?? "";
        var user = await _users.GetByEmailAsync(email, cancellationToken);
        if (user is null)
            return Unauthorized(new { success = false, message = "Kullanıcı bulunamadı" });

        var fullName = (request.FullName ?? string.Empty).Trim();
        var phoneRaw = (request.Phone ?? string.Empty).Trim();
        var phone = new string(phoneRaw.Where(char.IsDigit).ToArray());

        if (string.IsNullOrWhiteSpace(fullName))
            return BadRequest(new { success = false, message = "Ad soyad zorunlu" });

        if (string.IsNullOrWhiteSpace(phone) || phone.Length != 11)
            return BadRequest(new { success = false, message = "Telefon numarası 11 haneli olmalıdır" });

        string? passwordHash = null;
        if (!string.IsNullOrWhiteSpace(request.Password))
        {
            if (string.IsNullOrWhiteSpace(request.OldPassword))
                return BadRequest(new { success = false, message = "Eski şifrenizi girmelisiniz" });

            if (!EcommerceUsersRepository.VerifyPassword(request.OldPassword, user.PasswordHash))
                return BadRequest(new { success = false, message = "Eski şifreniz doğru değil" });

            if (request.Password.Length < 8)
                return BadRequest(new { success = false, message = "Şifre en az 8 karakter olmalı" });

            passwordHash = EcommerceUsersRepository.HashPassword(request.Password);
        }

        try
        {
            await _users.UpdateCustomerAsync(user.Id, fullName, phone, passwordHash, cancellationToken);
            var updatedUser = await _users.GetByEmailAsync(email, cancellationToken);
            return Ok(new { success = true, data = SafeUser(updatedUser!) });
        }
        catch (Exception ex)
        {
            return BadRequest(new { success = false, message = ex.Message });
        }
    }

    private static object SafeUser(EcommerceUser user) => new
    {
        user.Id,
        user.Email,
        user.FullName,
        user.Phone,
        user.Role,
        googleId = user.GoogleId,
        profilePictureUrl = user.ProfilePictureUrl,
        permissions = user.PermissionsCsv.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
    };

    public sealed class GoogleLoginRequest
    {
        public string IdToken { get; set; } = string.Empty;
    }

    private sealed class GoogleTokenInfo
    {
        [System.Text.Json.Serialization.JsonPropertyName("sub")]
        public string Sub { get; set; } = string.Empty;

        [System.Text.Json.Serialization.JsonPropertyName("aud")]
        public string Aud { get; set; } = string.Empty;

        [System.Text.Json.Serialization.JsonPropertyName("email")]
        public string Email { get; set; } = string.Empty;

        [System.Text.Json.Serialization.JsonPropertyName("email_verified")]
        public string EmailVerified { get; set; } = string.Empty;

        [System.Text.Json.Serialization.JsonPropertyName("name")]
        public string Name { get; set; } = string.Empty;

        [System.Text.Json.Serialization.JsonPropertyName("picture")]
        public string Picture { get; set; } = string.Empty;

        [System.Text.Json.Serialization.JsonPropertyName("given_name")]
        public string GivenName { get; set; } = string.Empty;

        [System.Text.Json.Serialization.JsonPropertyName("family_name")]
        public string FamilyName { get; set; } = string.Empty;
    }

    [HttpPost("google")]
    public async Task<IActionResult> GoogleLogin([FromBody] GoogleLoginRequest request, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.IdToken))
            return BadRequest(new { success = false, message = "ID Token gereklidir." });

        try
        {
            var client = _clientFactory.CreateClient();
            var response = await client.GetAsync($"https://oauth2.googleapis.com/tokeninfo?id_token={Uri.EscapeDataString(request.IdToken)}", cancellationToken);
            
            if (!response.IsSuccessStatusCode)
            {
                return BadRequest(new { success = false, message = "Geçersiz Google ID Token." });
            }

            var tokenInfo = await response.Content.ReadFromJsonAsync<GoogleTokenInfo>(cancellationToken: cancellationToken);
            if (tokenInfo == null || string.IsNullOrWhiteSpace(tokenInfo.Sub))
            {
                return BadRequest(new { success = false, message = "Google token bilgileri okunamadı." });
            }

            // Verify audience/client ID
            var configuredClientId = _configuration["Authentication:Google:ClientId"];
            if (!string.IsNullOrWhiteSpace(configuredClientId) && tokenInfo.Aud != configuredClientId)
            {
                return BadRequest(new { success = false, message = "Google token client ID uyuşmazlığı." });
            }

            var email = (tokenInfo.Email ?? string.Empty).Trim().ToLowerInvariant();
            if (string.IsNullOrWhiteSpace(email))
            {
                return BadRequest(new { success = false, message = "Google hesabından e-posta adresi alınamadı." });
            }

            // Check if user exists by Google ID first
            var user = await _users.GetByGoogleIdAsync(tokenInfo.Sub, cancellationToken);
            if (user == null)
            {
                // Check if user exists by Email
                user = await _users.GetByEmailAsync(email, cancellationToken);
                if (user != null)
                {
                    // Link Google account to this existing user
                    await _users.LinkGoogleAccountAsync(user.Id, tokenInfo.Sub, tokenInfo.Picture, cancellationToken);
                    user.GoogleId = tokenInfo.Sub;
                    if (string.IsNullOrEmpty(user.ProfilePictureUrl))
                    {
                        user.ProfilePictureUrl = tokenInfo.Picture;
                    }
                }
                else
                {
                    // Create a new user from Google profile
                    user = new EcommerceUser
                    {
                        Id = Guid.NewGuid(),
                        Email = email,
                        FullName = tokenInfo.Name ?? $"{tokenInfo.GivenName} {tokenInfo.FamilyName}".Trim(),
                        Phone = "",
                        PasswordHash = "", // OAuth only
                        Role = "Customer",
                        PermissionsCsv = "",
                        IsActive = true,
                        GoogleId = tokenInfo.Sub,
                        ProfilePictureUrl = tokenInfo.Picture
                    };
                    await _users.CreateAsync(user, cancellationToken);
                }
            }

            if (!user.IsActive)
                return Unauthorized(new { success = false, message = "Hesabınız sistem tarafından engellenmiştir" });

            var permissions = user.PermissionsCsv.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
            var token = _jwt.CreateToken(user.Email, user.Role, permissions, user.Id);
            return Ok(new { success = true, data = new { accessToken = token, user = SafeUser(user) } });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { success = false, message = $"Google giriş hatası: {ex.Message}" });
        }
    }

    [HttpGet("google-client-id")]
    public IActionResult GetGoogleClientId()
    {
        var clientId = _configuration["Authentication:Google:ClientId"] ?? "";
        return Ok(new { success = true, clientId });
    }

    public sealed class ForgotPasswordRequest
    {
        public string Email { get; set; } = string.Empty;
    }

    public sealed class ResetPasswordRequest
    {
        public string Email { get; set; } = string.Empty;
        public string Token { get; set; } = string.Empty;
        public string NewPassword { get; set; } = string.Empty;
    }

    [HttpPost("forgot-password")]
    public async Task<IActionResult> ForgotPassword([FromBody] ForgotPasswordRequest request, CancellationToken cancellationToken)
    {
        var email = (request.Email ?? string.Empty).Trim().ToLowerInvariant();
        if (string.IsNullOrWhiteSpace(email) || !email.Contains('@', StringComparison.Ordinal))
            return BadRequest(new { success = false, message = "Geçerli bir e-posta adresi girin." });

        var user = await _users.GetByEmailAsync(email, cancellationToken);
        if (user is null)
        {
            return BadRequest(new { success = false, message = "Bu e-posta adresiyle kayıtlı bir hesap bulunamadı." });
        }

        // Generate token and delete old resets
        var token = Guid.NewGuid().ToString("N");
        await _adminModules.ExecuteSqlAsync("DELETE FROM password_resets WHERE LOWER(email) = @Email", new { Email = email }, cancellationToken);

        var insertSql = @"
            INSERT INTO password_resets (id, email, token, created_at_utc)
            VALUES (@Id, @Email, @Token, (now() AT TIME ZONE 'utc'))";
        
        await _adminModules.ExecuteSqlAsync(insertSql, new {
            Id = Guid.NewGuid(),
            Email = email,
            Token = token
        }, cancellationToken);

        // Build reset link
        var origin = Request.Headers["Origin"].ToString();
        if (string.IsNullOrEmpty(origin)) origin = "http://localhost:5175";
        var resetLink = $"{origin}/?resetToken={token}&email={Uri.EscapeDataString(email)}";

        // Send email
        var subject = "Stilsoft B2B Şifre Sıfırlama";
        var emailBody = $@"
            <div style=""font-family: sans-serif; padding: 20px; color: #333;"">
                <h3 style=""color: #df0000;"">Şifre Sıfırlama Talebi</h3>
                <p>Hesabınız için şifre sıfırlama talebinde bulundunuz.</p>
                <p>Şifrenizi yenilemek için lütfen aşağıdaki bağlantıya tıklayın:</p>
                <p style=""margin: 20px 0;"">
                    <a href=""{resetLink}"" style=""background: #df0000; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; display: inline-block; font-weight: bold;"">Şifremi Yenile</a>
                </p>
                <p>Eğer bu talebi siz yapmadıysanız bu e-postayı görmezden gelebilirsiniz.</p>
                <hr style=""border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;"" />
                <p style=""font-size: 11px; color: #9ca3af;"">Saygılarımızla,<br/>Stilsoft E-Ticaret Ekibi</p>
            </div>";

        await SendEmailAsync(email, subject, emailBody, cancellationToken);

        return Ok(new { success = true, resetLink, message = "Şifre sıfırlama bağlantısı e-posta adresinize gönderildi." });
    }

    [HttpPost("reset-password")]
    public async Task<IActionResult> ResetPassword([FromBody] ResetPasswordRequest request, CancellationToken cancellationToken)
    {
        var email = (request.Email ?? string.Empty).Trim().ToLowerInvariant();
        var token = (request.Token ?? string.Empty).Trim();
        var newPassword = request.NewPassword ?? string.Empty;

        if (string.IsNullOrWhiteSpace(email) || string.IsNullOrWhiteSpace(token))
            return BadRequest(new { success = false, message = "E-posta ve sıfırlama tokenı gereklidir." });

        if (newPassword.Length < 8)
            return BadRequest(new { success = false, message = "Yeni şifre en az 8 karakter olmalı." });

        var selectSql = "SELECT id, email, token, created_at_utc AS \"createdAtUtc\" FROM password_resets WHERE LOWER(email) = @Email AND token = @Token";
        var rows = await _adminModules.QuerySqlAsync(selectSql, new { Email = email, Token = token }, cancellationToken);

        if (rows.Count == 0)
            return BadRequest(new { success = false, message = "Geçersiz veya süresi dolmuş sıfırlama talebi." });

        var createdAt = Convert.ToDateTime(rows[0]["createdAtUtc"]);
        if (DateTime.UtcNow - createdAt.ToUniversalTime() > TimeSpan.FromHours(1))
            return BadRequest(new { success = false, message = "Şifre sıfırlama bağlantısının süresi dolmuş (60 dakika). Lütfen tekrar talep edin." });

        // Reset the password in ecommerce_users
        var passwordHash = EcommerceUsersRepository.HashPassword(newPassword);
        var updateSql = "UPDATE ecommerce_users SET password_hash = @Hash WHERE LOWER(email) = @Email";
        await _adminModules.ExecuteSqlAsync(updateSql, new { Hash = passwordHash, Email = email }, cancellationToken);

        // Delete the used token
        await _adminModules.ExecuteSqlAsync("DELETE FROM password_resets WHERE LOWER(email) = @Email", new { Email = email }, cancellationToken);

        return Ok(new { success = true, message = "Şifreniz başarıyla sıfırlandı. Yeni şifrenizle giriş yapabilirsiniz." });
    }
}
