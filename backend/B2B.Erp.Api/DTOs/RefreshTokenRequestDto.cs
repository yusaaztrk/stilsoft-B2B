using System.ComponentModel.DataAnnotations;

namespace B2B.Erp.Api.DTOs;

public class RefreshTokenRequestDto
{
    [Required(ErrorMessage = "Refresh token zorunludur")]
    public string RefreshToken { get; set; } = string.Empty;
}