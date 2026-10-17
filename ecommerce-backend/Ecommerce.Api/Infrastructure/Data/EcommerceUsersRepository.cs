using System.Security.Cryptography;
using System.Text;
using Npgsql;

namespace Ecommerce.Api.Infrastructure.Data;

public sealed class EcommerceUsersRepository
{
    private readonly string _connStr;

    public EcommerceUsersRepository(IConfiguration config)
    {
        _connStr = config.GetConnectionString("EcommerceDb") ?? string.Empty;
        if (string.IsNullOrWhiteSpace(_connStr))
            throw new InvalidOperationException("ConnectionStrings:EcommerceDb must be configured.");
    }

    public async Task EnsureCreatedAsync(CancellationToken cancellationToken)
    {
        await using var conn = new NpgsqlConnection(_connStr);
        await conn.OpenAsync(cancellationToken);

        await using var cmd = conn.CreateCommand();
        cmd.CommandText = @"
CREATE TABLE IF NOT EXISTS ecommerce_users (
  id uuid PRIMARY KEY,
  email text NOT NULL UNIQUE,
  full_name text NOT NULL,
  phone text NOT NULL DEFAULT '',
  password_hash text NOT NULL,
  role text NOT NULL,
  permissions_csv text NOT NULL DEFAULT '',
  is_active boolean NOT NULL DEFAULT TRUE,
  google_id text NULL,
  profile_picture_url text NULL,
  created_at_utc timestamptz NOT NULL DEFAULT (now() AT TIME ZONE 'utc')
);

CREATE INDEX IF NOT EXISTS ix_ecommerce_users_role ON ecommerce_users (role);
";
        await cmd.ExecuteNonQueryAsync(cancellationToken);

        await using var alter = conn.CreateCommand();
        alter.CommandText = @"
            ALTER TABLE ecommerce_users ADD COLUMN IF NOT EXISTS phone text NOT NULL DEFAULT '';
            ALTER TABLE ecommerce_users ADD COLUMN IF NOT EXISTS google_id text NULL;
            ALTER TABLE ecommerce_users ADD COLUMN IF NOT EXISTS profile_picture_url text NULL;
        ";
        await alter.ExecuteNonQueryAsync(cancellationToken);

        if (await GetByEmailAsync("admin@site.local", cancellationToken) is null)
        {
            await CreateAsync(new EcommerceUser
            {
                Id = Guid.NewGuid(),
                Email = "admin@site.local",
                FullName = "Site Admin",
                PasswordHash = HashPassword("Admin123!"),
                Role = "Owner",
                PermissionsCsv = "dashboard,products,categories,orders,customers,campaigns,design,reports,settings,users",
                IsActive = true
            }, cancellationToken);
        }
    }

    public async Task<EcommerceUser> CreateAsync(EcommerceUser user, CancellationToken cancellationToken)
    {
        user.Id = user.Id == Guid.Empty ? Guid.NewGuid() : user.Id;
        user.Email = NormalizeEmail(user.Email);
        user.Role = NormalizeRole(user.Role);

        await using var conn = new NpgsqlConnection(_connStr);
        await conn.OpenAsync(cancellationToken);

        await using var cmd = conn.CreateCommand();
        cmd.CommandText = @"
INSERT INTO ecommerce_users (id, email, full_name, phone, password_hash, role, permissions_csv, is_active, google_id, profile_picture_url, created_at_utc)
VALUES (@id, @email, @name, @phone, @hash, @role, @permissions, @active, @googleId, @profilePicture, (now() AT TIME ZONE 'utc'))
RETURNING created_at_utc;";
        cmd.Parameters.AddWithValue("id", user.Id);
        cmd.Parameters.AddWithValue("email", user.Email);
        cmd.Parameters.AddWithValue("name", user.FullName.Trim());
        cmd.Parameters.AddWithValue("phone", (user.Phone ?? string.Empty).Trim());
        cmd.Parameters.AddWithValue("hash", user.PasswordHash);
        cmd.Parameters.AddWithValue("role", user.Role);
        cmd.Parameters.AddWithValue("permissions", user.PermissionsCsv.Trim());
        cmd.Parameters.AddWithValue("active", user.IsActive);
        cmd.Parameters.AddWithValue("googleId", (object?)user.GoogleId ?? DBNull.Value);
        cmd.Parameters.AddWithValue("profilePicture", (object?)user.ProfilePictureUrl ?? DBNull.Value);
        user.CreatedAtUtc = await cmd.ExecuteScalarAsync(cancellationToken) as DateTimeOffset? ?? DateTimeOffset.UtcNow;
        return user;
    }

    public async Task<List<EcommerceUser>> ListAsync(CancellationToken cancellationToken)
    {
        var result = new List<EcommerceUser>();
        await using var conn = new NpgsqlConnection(_connStr);
        await conn.OpenAsync(cancellationToken);

        await using var cmd = conn.CreateCommand();
        cmd.CommandText = @"SELECT id, email, full_name, phone, password_hash, role, permissions_csv, is_active, google_id, profile_picture_url, created_at_utc FROM ecommerce_users ORDER BY created_at_utc DESC";

        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
            result.Add(ReadUser(reader));
        return result;
    }

    public async Task<List<EcommerceUser>> ListCustomersAsync(CancellationToken cancellationToken)
    {
        var result = new List<EcommerceUser>();
        await using var conn = new NpgsqlConnection(_connStr);
        await conn.OpenAsync(cancellationToken);

        await using var cmd = conn.CreateCommand();
        cmd.CommandText = @"SELECT id, email, full_name, phone, password_hash, role, permissions_csv, is_active, google_id, profile_picture_url, created_at_utc FROM ecommerce_users WHERE role='Customer' ORDER BY created_at_utc DESC";

        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
            result.Add(ReadUser(reader));
        return result;
    }

    public async Task<EcommerceUser?> GetByEmailAsync(string email, CancellationToken cancellationToken)
    {
        await using var conn = new NpgsqlConnection(_connStr);
        await conn.OpenAsync(cancellationToken);

        await using var cmd = conn.CreateCommand();
        cmd.CommandText = @"SELECT id, email, full_name, phone, password_hash, role, permissions_csv, is_active, google_id, profile_picture_url, created_at_utc FROM ecommerce_users WHERE email=@email LIMIT 1";
        cmd.Parameters.AddWithValue("email", NormalizeEmail(email));

        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
        return await reader.ReadAsync(cancellationToken) ? ReadUser(reader) : null;
    }

    public async Task SetActiveAsync(Guid id, bool isActive, CancellationToken cancellationToken)
    {
        await using var conn = new NpgsqlConnection(_connStr);
        await conn.OpenAsync(cancellationToken);
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = @"UPDATE ecommerce_users SET is_active=@active WHERE id=@id";
        cmd.Parameters.AddWithValue("id", id);
        cmd.Parameters.AddWithValue("active", isActive);
        await cmd.ExecuteNonQueryAsync(cancellationToken);
    }

    public async Task UpdateCustomerAsync(Guid id, string fullName, string phone, string? passwordHash = null, CancellationToken cancellationToken = default)
    {
        if (id == Guid.Empty) throw new InvalidOperationException("id is required");

        fullName = (fullName ?? string.Empty).Trim();
        phone = new string(((phone ?? string.Empty).Trim()).Where(char.IsDigit).ToArray());

        if (string.IsNullOrWhiteSpace(fullName))
            throw new InvalidOperationException("fullName is required");
        if (phone.Length != 11)
            throw new InvalidOperationException("phone must be 11 digits");

        await using var conn = new NpgsqlConnection(_connStr);
        await conn.OpenAsync(cancellationToken);

        await using var cmd = conn.CreateCommand();
        if (!string.IsNullOrEmpty(passwordHash))
        {
            cmd.CommandText = @"UPDATE ecommerce_users SET full_name=@name, phone=@phone, password_hash=@hash WHERE id=@id AND role='Customer'";
            cmd.Parameters.AddWithValue("hash", passwordHash);
        }
        else
        {
            cmd.CommandText = @"UPDATE ecommerce_users SET full_name=@name, phone=@phone WHERE id=@id AND role='Customer'";
        }
        cmd.Parameters.AddWithValue("id", id);
        cmd.Parameters.AddWithValue("name", fullName);
        cmd.Parameters.AddWithValue("phone", phone);
        var affected = await cmd.ExecuteNonQueryAsync(cancellationToken);
        if (affected == 0)
            throw new InvalidOperationException("Customer not found");
    }

    public static string HashPassword(string password)
    {
        var salt = RandomNumberGenerator.GetBytes(16);
        var hash = Rfc2898DeriveBytes.Pbkdf2(password, salt, 100_000, HashAlgorithmName.SHA256, 32);
        return $"PBKDF2${Convert.ToBase64String(salt)}${Convert.ToBase64String(hash)}";
    }

    public static bool VerifyPassword(string password, string stored)
    {
        var parts = (stored ?? string.Empty).Split('$');
        if (parts.Length != 3 || parts[0] != "PBKDF2") return false;
        var salt = Convert.FromBase64String(parts[1]);
        var expected = Convert.FromBase64String(parts[2]);
        var actual = Rfc2898DeriveBytes.Pbkdf2(password, salt, 100_000, HashAlgorithmName.SHA256, 32);
        return CryptographicOperations.FixedTimeEquals(actual, expected);
    }

    public async Task<EcommerceUser?> GetByGoogleIdAsync(string googleId, CancellationToken cancellationToken)
    {
        await using var conn = new NpgsqlConnection(_connStr);
        await conn.OpenAsync(cancellationToken);

        await using var cmd = conn.CreateCommand();
        cmd.CommandText = @"SELECT id, email, full_name, phone, password_hash, role, permissions_csv, is_active, google_id, profile_picture_url, created_at_utc FROM ecommerce_users WHERE google_id=@googleId LIMIT 1";
        cmd.Parameters.AddWithValue("googleId", googleId.Trim());

        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
        return await reader.ReadAsync(cancellationToken) ? ReadUser(reader) : null;
    }

    public async Task LinkGoogleAccountAsync(Guid id, string googleId, string? profilePictureUrl, CancellationToken cancellationToken)
    {
        await using var conn = new NpgsqlConnection(_connStr);
        await conn.OpenAsync(cancellationToken);

        await using var cmd = conn.CreateCommand();
        cmd.CommandText = @"UPDATE ecommerce_users SET google_id=@googleId, profile_picture_url=COALESCE(profile_picture_url, @profilePic) WHERE id=@id";
        cmd.Parameters.AddWithValue("id", id);
        cmd.Parameters.AddWithValue("googleId", googleId.Trim());
        cmd.Parameters.AddWithValue("profilePic", (object?)profilePictureUrl ?? DBNull.Value);
        await cmd.ExecuteNonQueryAsync(cancellationToken);
    }

    private static EcommerceUser ReadUser(NpgsqlDataReader reader) => new()
    {
        Id = reader.GetGuid(0),
        Email = reader.GetString(1),
        FullName = reader.GetString(2),
        Phone = reader.IsDBNull(3) ? string.Empty : reader.GetString(3),
        PasswordHash = reader.GetString(4),
        Role = reader.GetString(5),
        PermissionsCsv = reader.GetString(6),
        IsActive = reader.GetBoolean(7),
        GoogleId = reader.IsDBNull(8) ? null : reader.GetString(8),
        ProfilePictureUrl = reader.IsDBNull(9) ? null : reader.GetString(9),
        CreatedAtUtc = reader.GetFieldValue<DateTimeOffset>(10)
    };

    private static string NormalizeEmail(string email) => (email ?? string.Empty).Trim().ToLowerInvariant();

    private static string NormalizeRole(string role)
    {
        var r = (role ?? string.Empty).Trim();
        return string.IsNullOrWhiteSpace(r) ? "Customer" : r;
    }
}
