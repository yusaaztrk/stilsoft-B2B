using BCrypt.Net;

namespace B2B.Erp.Api.Core.Security;

public static class PasswordHasher
{
    public static string HashPassword(string password)
    {
        if (string.IsNullOrEmpty(password)) return string.Empty;
        if (IsHashed(password)) return password;
        return BCrypt.Net.BCrypt.HashPassword(password);
    }

    public static bool VerifyPassword(string password, string? storedPassword)
    {
        if (storedPassword == null) return false;
        
        if (storedPassword.StartsWith("$2a$") || storedPassword.StartsWith("$2b$") || storedPassword.StartsWith("$2y$") || storedPassword.StartsWith("$2x$"))
        {
            try
            {
                return BCrypt.Net.BCrypt.Verify(password, storedPassword);
            }
            catch
            {
                return false;
            }
        }

        // Fallback for plaintext passwords
        return password == storedPassword;
    }

    public static bool IsHashed(string? password)
    {
        if (string.IsNullOrEmpty(password)) return false;
        return password.Length == 60 && 
               (password.StartsWith("$2a$") || password.StartsWith("$2b$") || password.StartsWith("$2y$") || password.StartsWith("$2x$"));
    }
}
