using System.ComponentModel.DataAnnotations;

namespace B2B.Erp.Api.DTOs;

public class LoginRequestDto
{
    [Required(ErrorMessage = "Kullanıcı adı zorunludur")]
    public string Username { get; set; } = string.Empty;

    [Required(ErrorMessage = "Şifre zorunludur")]
    public string Password { get; set; } = string.Empty;

    public string? TenantCode { get; set; }
}