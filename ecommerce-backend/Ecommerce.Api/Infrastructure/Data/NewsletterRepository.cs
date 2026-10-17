using Npgsql;

namespace Ecommerce.Api.Infrastructure.Data;

public sealed class NewsletterSubscriberEntity
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Email { get; set; } = string.Empty;
    public DateTime SubscribedAt { get; set; } = DateTime.UtcNow;
    public bool IsActive { get; set; } = true;
}

public sealed class NewsletterRepository
{
    private readonly string _connStr;

    public NewsletterRepository(IConfiguration config)
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
CREATE TABLE IF NOT EXISTS newsletter_subscribers (
  id uuid PRIMARY KEY,
  email text NOT NULL UNIQUE,
  subscribed_at timestamptz NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
  is_active boolean NOT NULL DEFAULT true
);
CREATE INDEX IF NOT EXISTS ix_newsletter_subscribers_email ON newsletter_subscribers (email);
";
        await cmd.ExecuteNonQueryAsync(cancellationToken);
    }

    public async Task<List<NewsletterSubscriberEntity>> ListAllAsync(CancellationToken cancellationToken)
    {
        var result = new List<NewsletterSubscriberEntity>();
        await using var conn = new NpgsqlConnection(_connStr);
        await conn.OpenAsync(cancellationToken);

        await using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT id, email, subscribed_at, is_active FROM newsletter_subscribers ORDER BY subscribed_at DESC";

        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            result.Add(new NewsletterSubscriberEntity
            {
                Id = reader.GetGuid(0),
                Email = reader.GetString(1),
                SubscribedAt = reader.GetFieldValue<DateTimeOffset>(2).UtcDateTime,
                IsActive = reader.GetBoolean(3)
            });
        }
        return result;
    }

    public async Task SubscribeAsync(string email, CancellationToken cancellationToken)
    {
        email = (email ?? string.Empty).Trim().ToLowerInvariant();
        if (string.IsNullOrWhiteSpace(email)) return;

        await using var conn = new NpgsqlConnection(_connStr);
        await conn.OpenAsync(cancellationToken);

        await using var cmd = conn.CreateCommand();
        cmd.CommandText = @"
INSERT INTO newsletter_subscribers (id, email, subscribed_at, is_active)
VALUES (@id, @email, @subscribed_at, @is_active)
ON CONFLICT (email) DO UPDATE SET
  is_active = true;
";
        cmd.Parameters.AddWithValue("id", Guid.NewGuid());
        cmd.Parameters.AddWithValue("email", email);
        cmd.Parameters.AddWithValue("subscribed_at", new DateTimeOffset(DateTime.UtcNow));
        cmd.Parameters.AddWithValue("is_active", true);

        await cmd.ExecuteNonQueryAsync(cancellationToken);
    }

    public async Task UnsubscribeAsync(string email, CancellationToken cancellationToken)
    {
        email = (email ?? string.Empty).Trim().ToLowerInvariant();
        if (string.IsNullOrWhiteSpace(email)) return;

        await using var conn = new NpgsqlConnection(_connStr);
        await conn.OpenAsync(cancellationToken);

        await using var cmd = conn.CreateCommand();
        cmd.CommandText = "UPDATE newsletter_subscribers SET is_active = false WHERE email = @email";
        cmd.Parameters.AddWithValue("email", email);

        await cmd.ExecuteNonQueryAsync(cancellationToken);
    }

    public async Task DeleteAsync(Guid id, CancellationToken cancellationToken)
    {
        await using var conn = new NpgsqlConnection(_connStr);
        await conn.OpenAsync(cancellationToken);

        await using var cmd = conn.CreateCommand();
        cmd.CommandText = "DELETE FROM newsletter_subscribers WHERE id = @id";
        cmd.Parameters.AddWithValue("id", id);

        await cmd.ExecuteNonQueryAsync(cancellationToken);
    }
}
