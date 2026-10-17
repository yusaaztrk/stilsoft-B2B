using System.Security.Cryptography;

namespace Shop.Api.Members;

/// <summary>
/// Üye şifreleri.
///
/// PBKDF2-SHA256, rastgele tuz, 210.000 tur. Şifreler geri çevrilemez biçimde saklanır —
/// veritabanı bir şekilde dışarı çıksa bile şifreler kullanılamaz.
///
/// ERP'nin bazı yerlerinde kullanılan düz SHA256 burada TERCİH EDİLMEDİ: tuzsuz ve hızlı
/// olduğu için sızan bir tabloda milyonlarca deneme saniyeler sürer. Müşteri şifreleri
/// personel şifrelerinden farklı bir risk sınıfında.
///
/// Karşılaştırma sabit zamanlıdır; "kaç karakteri tuttu" bilgisi zamanlamadan sızmaz.
/// </summary>
public static class PasswordHasher
{
    private const int SaltSize = 16;
    private const int KeySize = 32;
    private const int Iterations = 210_000;

    public static string Hash(string password)
    {
        var salt = RandomNumberGenerator.GetBytes(SaltSize);
        var key = Rfc2898DeriveBytes.Pbkdf2(password, salt, Iterations, HashAlgorithmName.SHA256, KeySize);

        return $"pbkdf2-sha256${Iterations}${Convert.ToBase64String(salt)}${Convert.ToBase64String(key)}";
    }

    public static bool Verify(string password, string stored)
    {
        if (string.IsNullOrWhiteSpace(stored)) return false;

        var parts = stored.Split('$');
        if (parts.Length != 4 || parts[0] != "pbkdf2-sha256") return false;
        if (!int.TryParse(parts[1], out var iterations) || iterations <= 0) return false;

        try
        {
            var salt = Convert.FromBase64String(parts[2]);
            var expected = Convert.FromBase64String(parts[3]);
            var actual = Rfc2898DeriveBytes.Pbkdf2(password, salt, iterations, HashAlgorithmName.SHA256, expected.Length);

            return CryptographicOperations.FixedTimeEquals(actual, expected);
        }
        catch
        {
            return false;
        }
    }

    /// <summary>Oturum anahtarı — tahmin edilemez olması yeterli, anlam taşımaz.</summary>
    public static string NewSessionToken()
        => Convert.ToBase64String(RandomNumberGenerator.GetBytes(32))
            .Replace("+", "-").Replace("/", "_").TrimEnd('=');
}
