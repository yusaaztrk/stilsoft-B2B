namespace B2B.Erp.Api.DTOs;

public class LoginResponseDto
{
    public int UserId { get; set; }
    public string Username { get; set; } = string.Empty;
    public string Email { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public string? CurrentCode { get; set; }
    public string? SalesmanCode { get; set; }
    public string Role { get; set; } = string.Empty;
    public int RoleId { get; set; }
    public string RoleCode { get; set; } = string.Empty;
    public bool IsSuperAdmin { get; set; }
    public bool ServiceOpsAccess { get; set; }
    public bool EmployeeAccess { get; set; }
    public bool AsistanAccess { get; set; }
    public string AccessToken { get; set; } = string.Empty;
    public string RefreshToken { get; set; } = string.Empty;
}