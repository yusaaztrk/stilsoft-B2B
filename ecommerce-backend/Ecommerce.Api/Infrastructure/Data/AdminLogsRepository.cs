using Npgsql;

namespace Ecommerce.Api.Infrastructure.Data;

public sealed class AdminLogEntity
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string UserEmail { get; set; } = string.Empty;
    public string Action { get; set; } = string.Empty;
    public string Details { get; set; } = string.Empty;
    public string IpAddress { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public sealed class AdminLogsRepository
{
    private readonly string _connStr;

    public AdminLogsRepository(IConfiguration config)
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
CREATE TABLE IF NOT EXISTS admin_logs (
  id uuid PRIMARY KEY,
  user_email text NOT NULL,
  action text NOT NULL,
  details text NOT NULL,
  ip_address text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT (now() AT TIME ZONE 'utc')
);
CREATE INDEX IF NOT EXISTS ix_admin_logs_created ON admin_logs (created_at DESC);
";
        await cmd.ExecuteNonQueryAsync(cancellationToken);
    }

    public async Task<List<AdminLogEntity>> ListAllAsync(int limit, CancellationToken cancellationToken)
    {
        var result = new List<AdminLogEntity>();
        await using var conn = new NpgsqlConnection(_connStr);
        await conn.OpenAsync(cancellationToken);

        await using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT id, user_email, action, details, ip_address, created_at FROM admin_logs ORDER BY created_at DESC LIMIT @limit";
        cmd.Parameters.AddWithValue("limit", limit > 0 ? limit : 100);

        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            result.Add(new AdminLogEntity
            {
                Id = reader.GetGuid(0),
                UserEmail = reader.GetString(1),
                Action = reader.GetString(2),
                Details = reader.GetString(3),
                IpAddress = reader.GetString(4),
                CreatedAt = reader.GetFieldValue<DateTimeOffset>(5).UtcDateTime
            });
        }
        return result;
    }

    public async Task LogAsync(string userEmail, string action, string details, string ipAddress, CancellationToken cancellationToken)
    {
        await using var conn = new NpgsqlConnection(_connStr);
        await conn.OpenAsync(cancellationToken);

        await using var cmd = conn.CreateCommand();
        cmd.CommandText = @"
INSERT INTO admin_logs (id, user_email, action, details, ip_address, created_at)
VALUES (@id, @user_email, @action, @details, @ip_address, @created_at)
";
        cmd.Parameters.AddWithValue("id", Guid.NewGuid());
        cmd.Parameters.AddWithValue("user_email", string.IsNullOrWhiteSpace(userEmail) ? "system" : userEmail);
        cmd.Parameters.AddWithValue("action", action);
        cmd.Parameters.AddWithValue("details", details);
        cmd.Parameters.AddWithValue("ip_address", string.IsNullOrWhiteSpace(ipAddress) ? "0.0.0.0" : ipAddress);
        cmd.Parameters.AddWithValue("created_at", new DateTimeOffset(DateTime.UtcNow));

        await cmd.ExecuteNonQueryAsync(cancellationToken);
    }
}
