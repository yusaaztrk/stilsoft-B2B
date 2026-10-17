using System.Security.Cryptography;
using System.Text;
using BCrypt.Net;

namespace B2B.Erp.Api.Core.Security;

public static class PasswordHasher
{
    /// <summary>
    /// BCrypt parolanın ilk 72 BAYTINI hesaba katar, gerisini SESSİZCE atar. Yani 80 karakterlik
    /// bir parolada son 8 karakter hiçbir şey ifade etmez; kullanıcı yanlış yazsa bile giriş açılır.
    /// Parola belirleyen uçlar bu sınırı <see cref="ExceedsBcryptLimit"/> ile kontrol etmelidir.
    /// (Türkçe karakterler UTF-8'de 2 bayt tuttuğu için sınır karakter değil BAYT üzerinden.)
    /// </summary>
    public const int MaxPasswordBytes = 72;

    /// <summary>Parola BCrypt'in dikkate aldığı 72 baytı aşıyor mu?</summary>
    public static bool ExceedsBcryptLimit(string? password)
        => !string.IsNullOrEmpty(password) && Encoding.UTF8.GetByteCount(password) > MaxPasswordBytes;

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

        // DÜZ METİN PAROLA KARŞILAŞTIRMASI SABİT ZAMANLI YAPILIR.
        //
        // `password == storedPassword` ilk farklı karakterde döner; ağ üzerinden ölçülebilecek
        // kadar büyük olmasa da bu bir yan kanal (timing) sızıntısıdır ve düz metin parolalar
        // zaten en zayıf halka. `FixedTimeEquals` uzunluk farkında da erken dönmesin diye
        // karşılaştırma öncesi uzunluk EŞİTLENMEZ; farklı uzunlukta doğrudan false döner
        // (uzunluk bilgisi parolanın kendisini vermez).
        var candidate = Encoding.UTF8.GetBytes(password ?? string.Empty);
        var stored = Encoding.UTF8.GetBytes(storedPassword);
        if (candidate.Length != stored.Length) return false;
        return CryptographicOperations.FixedTimeEquals(candidate, stored);
    }

    public static bool IsHashed(string? password)
    {
        if (string.IsNullOrEmpty(password)) return false;
        return password.Length == 60 && 
               (password.StartsWith("$2a$") || password.StartsWith("$2b$") || password.StartsWith("$2y$") || password.StartsWith("$2x$"));
    }
}
